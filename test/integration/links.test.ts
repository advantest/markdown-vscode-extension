import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewManager, type Rendered, type Revealed } from '../../src/preview/manager';

const EXTENSION_ID = 'advantest.markdown-support';
const INTEGRATED_BROWSER = 'workbench.action.browser.open';
const TIMEOUT = 15_000;

/** A document whose headings are where the headings of HTML say they are in the source. */
const SECTIONS = `# Top\n\n${'Text\n\n'.repeat(200)}## Part\n\nText\n\n## End\n\n${'Text\n\n'.repeat(200)}`;

/** The heading rendered from a part of SECTIONS, with the source offset and length the server would give it. */
function heading(tag: string, id: string, source: string): string {
	const offset = SECTIONS.indexOf(source);
	return `<${tag} id="${id}" source-offset="${offset}" source-length="${source.length}">${id}</${tag}>`;
}

/** Every document renders to the same headings, so that each has the anchors "top", "part" and "end". */
const HTML =
	heading('h1', 'top', '# Top') +
	'<p style="height: 3000px">Text</p>' +
	heading('h2', 'part', '## Part') +
	heading('h2', 'end', '## End');

describe('the links in the preview', () => {
	let directory: string;
	let manager: PreviewManager;
	let opened: string[];
	let integratedBrowser: vscode.Disposable | undefined;
	let browsed: unknown[];

	before(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-links-'));
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);
		manager = new PreviewManager(
			extension.extensionUri,
			async (uri) => ({ version: (await vscode.workspace.openTextDocument(uri)).version, html: HTML }),
			{ error: (message) => assert.fail(message) },
			{
				openExternal: async (uri) => {
					opened.push(uri.toString(true));
					return true;
				},
			},
		);
	});

	beforeEach(() => {
		opened = [];
		browsed = [];
	});

	afterEach(async () => {
		integratedBrowser?.dispose();
		integratedBrowser = undefined;
		await vscode.workspace
			.getConfiguration('markdownSupport')
			.update('preview.openWebLinksIn', undefined, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	after(async () => {
		manager.dispose();
		await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	});

	async function file(name: string, content = '# Title\n'): Promise<vscode.Uri> {
		const location = path.join(directory, name);
		await writeFile(location, content);
		return vscode.Uri.file(location);
	}

	/** Opens a document in the first column and its preview beside it. */
	async function preview(name: string): Promise<vscode.Uri> {
		const uri = await file(name);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
		const rendering = next(manager.onDidRender, (rendered: Rendered) => same(rendered.uri, uri));
		manager.openPreviewToSide(uri);
		await rendering;
		return uri;
	}

	function fakeIntegratedBrowser(): void {
		integratedBrowser = vscode.commands.registerCommand(INTEGRATED_BROWSER, (...args: unknown[]) => {
			browsed.push(...args);
		});
	}

	it('scrolls the preview to an anchor in the same document', async () => {
		const uri = await preview('anchor.md');

		const revealing = next(manager.onDidReveal, (revealed: Revealed) => same(revealed.uri, uri));
		await manager.openLink(uri, '#end');

		assert.deepEqual(plain(await revealing), { uri: uri.toString(), anchor: 'end', found: true });
	});

	it('opens a Markdown file in the editor and the preview, scrolled to its anchor', async () => {
		const uri = await preview('from.md');
		const other = await file('to.md', '# To\n');

		const revealing = next(manager.onDidReveal, (revealed: Revealed) => same(revealed.uri, other));
		await manager.openLink(uri, 'to.md#part');

		assert.deepEqual(plain(await revealing), { uri: other.toString(), anchor: 'part', found: true });
		assert.ok(
			vscode.window.visibleTextEditors.some((editor) => same(editor.document.uri, other)),
			'to.md is open in an editor',
		);
	});

	it('scrolls the editor of a linked Markdown file to the section of its anchor too', async () => {
		const uri = await preview('from-section.md');
		const other = await file('to-section.md', SECTIONS);
		const part = SECTIONS.indexOf('## Part');

		await manager.openLink(uri, 'to-section.md#part');

		let editor: vscode.TextEditor | undefined;
		await waitUntil(() => {
			editor = vscode.window.visibleTextEditors.find((candidate) => same(candidate.document.uri, other));
			return editor?.selection.active.isEqual(editor.document.positionAt(part)) === true;
		});
		const position = editor!.document.positionAt(part);
		assert.ok(editor!.selection.isEmpty, 'the cursor is put on the heading, nothing is selected');
		await waitUntil(() => editor!.visibleRanges.some((range) => range.contains(position)));
	});

	it('leaves the editor of a linked Markdown file alone where the preview does not find the anchor', async () => {
		const uri = await preview('from-missing.md');
		const other = await file('to-missing.md', SECTIONS);

		const revealing = next(manager.onDidReveal, (revealed: Revealed) => same(revealed.uri, other));
		await manager.openLink(uri, 'to-missing.md#missing');
		await revealing;

		const editor = vscode.window.visibleTextEditors.find((candidate) => same(candidate.document.uri, other));
		assert.equal(editor?.selection.active.line, 0);
	});

	it('opens another file in its default editor', async () => {
		const uri = await preview('to-text.md');
		const notes = await file('notes.txt', 'Notes\n');

		await manager.openLink(uri, 'notes.txt');

		await waitUntil(() => same(vscode.window.activeTextEditor?.document.uri, notes));
	});

	it('opens a web address in the system browser where VS Code has no integrated browser', async function () {
		if ((await vscode.commands.getCommands(true)).includes(INTEGRATED_BROWSER)) {
			this.skip();
		}
		const uri = await preview('web-default.md');

		await manager.openLink(uri, 'https://example.com/page');

		assert.deepEqual(opened, ['https://example.com/page']);
	});

	it('opens a web address in the integrated browser of VS Code by default, in the one open already', async () => {
		fakeIntegratedBrowser();
		const uri = await preview('web-integrated.md');

		await manager.openLink(uri, 'https://example.com/page');

		// VS Code navigates the first open browser whose address matches the glob pattern, which every web address does.
		assert.deepEqual(browsed, [{ url: 'https://example.com/page', reuseUrlFilter: '/**' }]);
		assert.deepEqual(opened, []);
	});

	it('opens a web address in the system browser if the setting says so', async () => {
		fakeIntegratedBrowser();
		await vscode.workspace
			.getConfiguration('markdownSupport')
			.update('preview.openWebLinksIn', 'systemBrowser', vscode.ConfigurationTarget.Global);
		const uri = await preview('web-system.md');

		await manager.openLink(uri, 'https://example.com/page');

		assert.deepEqual(opened, ['https://example.com/page']);
		assert.deepEqual(browsed, []);
	});

	it('leaves an address of another scheme to the system', async () => {
		fakeIntegratedBrowser();
		const uri = await preview('mail.md');

		await manager.openLink(uri, 'mailto:someone@example.com');

		assert.deepEqual(opened, ['mailto:someone@example.com']);
		assert.deepEqual(browsed, []);
	});

	it('ignores a data address', async () => {
		fakeIntegratedBrowser();
		const uri = await preview('data.md');
		const editors = vscode.window.tabGroups.all.flatMap((group) => group.tabs).length;

		await manager.openLink(uri, 'data:text/plain,hello');

		assert.deepEqual(opened, []);
		assert.deepEqual(browsed, []);
		assert.equal(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, editors);
	});

	it('contributes the setting where web addresses open, the integrated browser by default', () => {
		const setting = vscode.workspace.getConfiguration('markdownSupport').inspect('preview.openWebLinksIn');
		assert.equal(setting?.defaultValue, 'integratedBrowser');
	});
});

function plain(revealed: Revealed): object {
	return { ...revealed, uri: revealed.uri.toString() };
}

function same(a: vscode.Uri | undefined, b: vscode.Uri): boolean {
	return a?.toString() === b.toString();
}

function next<T>(event: vscode.Event<T>, accept: (value: T) => boolean): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`not within ${TIMEOUT} ms`));
		}, TIMEOUT);
		const listener = event((value) => {
			if (accept(value)) {
				clearTimeout(timer);
				listener.dispose();
				resolve(value);
			}
		});
	});
}

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const end = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > end) {
			assert.fail(`not reached within ${timeoutMs} ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
