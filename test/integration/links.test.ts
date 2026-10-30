import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewManager, type Rendered, type Revealed } from '../../src/preview/manager';

const EXTENSION_ID = 'advantest.markdown-support';
const INTEGRATED_BROWSER = 'workbench.action.browser.open';
const TIMEOUT = 15_000;

/** Every document renders to the same headings, so that each has the anchors "top", "part" and "end". */
const HTML = '<h1 id="top">Top</h1><p style="height: 3000px">Text</p><h2 id="part">Part</h2><h2 id="end">End</h2>';

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

	it('opens a web address in the integrated browser of VS Code by default', async () => {
		fakeIntegratedBrowser();
		const uri = await preview('web-integrated.md');

		await manager.openLink(uri, 'https://example.com/page');

		assert.deepEqual(browsed, ['https://example.com/page']);
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
