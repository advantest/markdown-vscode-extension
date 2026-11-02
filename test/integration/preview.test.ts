import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewManager, type Rendered, type RenderResult, UPDATE_DELAY_MS } from '../../src/preview/manager';

const EXTENSION_ID = 'advantest.markdown-support';
const VIEW_TYPE = 'markdownSupport.preview';
const RENDER_TIMEOUT = 15_000;

/** Renders like the server would, with the version of the document as it is open in VS Code. */
type FakeRenderer = (uri: vscode.Uri) => Promise<RenderResult>;

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const textRenderer: FakeRenderer = async (uri) => {
	const document = await vscode.workspace.openTextDocument(uri);
	return { version: document.version, html: `<p>${escape(document.getText())}</p>` };
};

describe('the preview', () => {
	let directory: string;
	let renderer: FakeRenderer;
	let manager: PreviewManager;
	const errors: string[] = [];

	before(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-preview-'));
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);
		manager = new PreviewManager(extension.extensionUri, (uri) => renderer(uri), {
			error: (message) => errors.push(message),
		});
	});

	beforeEach(() => {
		renderer = textRenderer;
		errors.length = 0;
	});

	afterEach(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	after(async () => {
		manager.dispose();
		// VS Code lets go of the folder only a while after its previews are closed.
		await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	});

	async function showDocument(name: string, content: string): Promise<vscode.TextEditor> {
		const file = path.join(directory, name);
		await writeFile(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		return vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	}

	function nextRendering(uri: vscode.Uri, accept: (rendered: Rendered) => boolean = () => true): Promise<Rendered> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				listener.dispose();
				reject(new Error(`no rendering of ${uri.toString()} within ${RENDER_TIMEOUT} ms; errors: ${errors}`));
			}, RENDER_TIMEOUT);
			const listener = manager.onDidRender((rendered) => {
				if (rendered.uri.toString() === uri.toString() && accept(rendered)) {
					clearTimeout(timer);
					listener.dispose();
					resolve(rendered);
				}
			});
		});
	}

	it('shows the HTML of the document with the code highlighted, the formulas typeset and the diagrams', async () => {
		const editor = await showDocument('content.md', 'any');
		renderer = async () => ({
			version: editor.document.version,
			html:
				'<p>A formula: $x^2$</p><pre><code class="language-java">class A {}</code></pre>' +
				'<figure><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg></figure>',
		});

		const rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		const rendered = await rendering;

		assert.equal(rendered.version, editor.document.version);
		assert.equal(rendered.math, 1);
		assert.equal(rendered.code, 1);
		assert.equal(rendered.figures, 1);
		assert.deepEqual(
			previewTabs().map((tab) => tab.group.viewColumn),
			[vscode.ViewColumn.Two],
		);
	});

	it('resolves relative images against the folder of the document', async () => {
		const editor = await showDocument('image.md', 'any');
		renderer = async () => ({ version: editor.document.version, html: '<p><img src="pictures/a.png"></p>' });

		const rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		const rendered = await rendering;

		assert.equal(rendered.images.length, 1);
		const image = vscode.Uri.parse(rendered.images[0]);
		assert.equal(path.basename(image.path), 'a.png');
		assert.equal(
			path.basename(path.dirname(path.dirname(image.path))).toLowerCase(),
			path.basename(directory).toLowerCase(),
		);
	});

	it("looks like FluentMark's preview under a dark theme, without VS Code's default styles", async () => {
		const workbench = vscode.workspace.getConfiguration('workbench');
		const theme = workbench.inspect<string>('colorTheme')?.globalValue;
		await workbench.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
		try {
			assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Dark, 'a dark theme is active');
			const editor = await showDocument('dark.md', 'any');
			renderer = async () => ({
				version: editor.document.version,
				html:
					'<p><a href="#here">A link</a> and <code>code</code></p><blockquote><p>A quote</p></blockquote>' +
					`<p><img src="${PIXEL}"></p>`,
			});

			const rendering = nextRendering(editor.document.uri);
			manager.openPreviewToSide(editor.document.uri);
			const { style } = await rendering;

			assert.equal(style.vscodeDefaults, false, "VS Code's default styles are removed");
			assert.equal(style.body.color, 'rgb(0, 0, 0)');
			assert.equal(style.body.backgroundColor, 'rgb(255, 255, 255)');
			assert.equal(style.body.padding, '30px');
			assert.match(style.body.fontFamily, /^-apple-system,/);
			assert.equal(style.link?.color, 'rgb(65, 131, 196)');
			assert.equal(style.code?.color, 'rgb(0, 0, 0)');
			assert.equal(style.code?.backgroundColor, 'rgb(248, 248, 248)');
			assert.equal(style.blockquote?.color, 'rgb(119, 119, 119)');
			assert.equal(style.blockquote?.backgroundColor, 'rgba(0, 0, 0, 0)');
			assert.equal(style.image?.maxWidth, '100%');
			assert.equal(style.image?.maxHeight, 'none');
		} finally {
			await workbench.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
		}
	});

	it('shows a local image changed on disk when the document is rendered again', async () => {
		const image = path.join(directory, 'changing pictures', 'changing.svg');
		await mkdir(path.dirname(image));
		await writeFile(image, square(10));
		const editor = await showDocument('changing-image.md', '![](<changing pictures/changing.svg>)\n');
		renderer = async () => ({
			version: editor.document.version,
			html: '<p><img src="changing%20pictures/changing.svg"></p>',
		});

		let rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		assert.deepEqual((await rendering).imageWidths, [10]);

		await writeFile(image, square(20));
		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), '\n'));
		const changed = await rendering;
		assert.deepEqual(changed.imageWidths, [20], 'the changed image is shown');
		assert.equal(path.basename(vscode.Uri.parse(changed.images[0]).path), 'changing.svg');

		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.document.save();
		assert.deepEqual((await rendering).imageWidths, [20], 'the image stays');
	});

	it("shows a local image outside of the document's folder and the workspace, and its changes", async () => {
		const image = path.join(directory, 'other pictures', 'outside.svg');
		await mkdir(path.dirname(image));
		await writeFile(image, square(10));
		await mkdir(path.join(directory, 'documents'));
		const editor = await showDocument(path.join('documents', 'outside.md'), '![](<../other pictures/outside.svg>)\n');
		assert.ok(!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(image)), 'the image is in no workspace folder');
		renderer = async () => ({
			version: editor.document.version,
			html: '<p><img src="../other%20pictures/outside.svg"></p>',
		});

		let rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		assert.deepEqual((await rendering).imageWidths, [10], 'the image is shown');

		await writeFile(image, square(20));
		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), '\n'));
		assert.deepEqual((await rendering).imageWidths, [20], 'the changed image is shown');
	});

	it('opens in place of the editor, and closing either leaves the other open', async () => {
		const editor = await showDocument('in-place.md', '# In place\n');

		let rendering = nextRendering(editor.document.uri);
		manager.openPreview(editor.document.uri);
		await rendering;
		assert.deepEqual(
			previewTabs().map((tab) => tab.group.viewColumn),
			[vscode.ViewColumn.One],
		);
		assert.ok(previewTabs()[0].isActive, 'the preview is in front');
		assert.equal(sourceTabs(editor.document.uri).length, 1, 'the editor is still open');

		await vscode.window.tabGroups.close(previewTabs());
		assert.equal(sourceTabs(editor.document.uri).length, 1, 'the editor is left');

		rendering = nextRendering(editor.document.uri);
		manager.openPreview(editor.document.uri);
		await rendering;
		await vscode.window.tabGroups.close(sourceTabs(editor.document.uri));
		assert.equal(previewTabs().length, 1, 'the preview is left');
	});

	it('toggles between the source and the preview', async () => {
		const editor = await showDocument('toggle.md', '# Toggle\n');

		const rendering = nextRendering(editor.document.uri);
		await manager.togglePreview();
		await rendering;
		assert.ok(previewTabs()[0]?.isActive, 'the preview is in front');

		await manager.togglePreview();
		await waitUntil(() => vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString());
		assert.ok(!previewTabs()[0]?.isActive, 'the source is in front');
		assert.equal(previewTabs().length, 1, 'the preview stays open');
	});

	it('is updated shortly after a change', async () => {
		const editor = await showDocument('change.md', '# Before\n');
		let rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		await rendering;

		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), 'After\n'));
		const rendered = await rendering;

		assert.equal(rendered.version, editor.document.version);
	});

	it('is updated at once when the document is saved', async () => {
		const editor = await showDocument('save.md', '# Save\n');
		let rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		await rendering;

		const calls: number[] = [];
		renderer = (uri) => {
			calls.push(Date.now());
			return textRenderer(uri);
		};
		await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), 'Saved\n'));
		const saved = Date.now();
		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.document.save();
		await rendering;

		assert.ok(calls.length > 0, 'rendered after the save');
		assert.ok(calls[0] - saved < UPDATE_DELAY_MS, `rendered ${calls[0] - saved} ms after the save`);
	});

	it('drops a result older than the one shown', async () => {
		const editor = await showDocument('stale.md', '# Stale\n');
		const versions = [5, 3];
		renderer = async () => ({ version: versions.shift() ?? 3, html: '<p>Rendered</p>' });

		const first = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		assert.equal((await first).version, 5);

		const shown: number[] = [];
		const listener = manager.onDidRender((rendered) => shown.push(rendered.version));
		try {
			await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), ' '));
			await editor.document.save();
			await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY_MS * 4));
		} finally {
			listener.dispose();
		}

		assert.equal(versions.length, 0, 'rendered again');
		assert.deepEqual(shown, [], 'the older result is not shown');
	});

	it('reports a failed rendering', async () => {
		const editor = await showDocument('failure.md', '# Failure\n');
		renderer = async () => {
			throw new Error('the server is not running');
		};

		manager.openPreviewToSide(editor.document.uri);

		await waitUntil(() => errors.length > 0);
		assert.match(errors[0], /the server is not running/);
	});

	it('is opened by the commands of the extension', async () => {
		await showDocument('command.md', '# Command\n');

		await vscode.commands.executeCommand('markdownSupport.preview.openToSide');

		await waitUntil(() => previewTabs().length === 1);
		assert.equal(previewTabs()[0].group.viewColumn, vscode.ViewColumn.Two);
	});
});

/** A transparent GIF of one pixel. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** An SVG image of a square of the given width. */
function square(width: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}"><rect width="${width}" height="${width}" fill="red"/></svg>`;
}

function previewTabs(): vscode.Tab[] {
	return vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(VIEW_TYPE));
}

function sourceTabs(uri: vscode.Uri): vscode.Tab[] {
	return vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
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
