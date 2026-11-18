/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewManager, type Rendered, type RenderResult, UPDATE_DELAY_MS } from '../../src/preview/manager';
import type { PageStyle } from '../../src/preview/messages';

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

	it('typesets a formula whose command MathJax loads only when it meets it, e.g. \\color', async () => {
		const editor = await showDocument('color.md', 'any');
		renderer = async () => ({ version: editor.document.version, html: '<p>Started: $x^2$</p>' });
		let rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		assert.equal((await rendering).math, 1, 'MathJax has started');

		renderer = async () => ({
			version: editor.document.version,
			html: '<p>In-line formula: $n! = \\prod_{\\color{red}{i=1..n}}i$</p><p>$$\\sum_{i=1}^{n}=\\frac{n(n+1)}{2}$$</p>',
		});
		rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
		await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
		const rendered = await rendering;

		assert.equal(rendered.math, 2, 'both formulas typeset');
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

	/** Runs with the given colour theme and the given colour scheme of the preview, in the user settings. */
	async function withAppearance(colorTheme: string, colorScheme: string | undefined, run: () => Promise<void>) {
		const workbench = vscode.workspace.getConfiguration('workbench');
		const settings = vscode.workspace.getConfiguration('markdownSupport');
		const theme = workbench.inspect<string>('colorTheme')?.globalValue;
		const scheme = settings.inspect<string>('preview.colorScheme')?.globalValue;
		await workbench.update('colorTheme', colorTheme, vscode.ConfigurationTarget.Global);
		await settings.update('preview.colorScheme', colorScheme, vscode.ConfigurationTarget.Global);
		try {
			await run();
		} finally {
			await settings.update('preview.colorScheme', scheme, vscode.ConfigurationTarget.Global);
			await workbench.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
		}
	}

	/** Shows a document with a link, code, a quote and an image in the preview; returns how the page looks. */
	async function styleOf(name: string): Promise<PageStyle> {
		const editor = await showDocument(name, 'any');
		renderer = async () => ({ version: editor.document.version, html: STYLED });
		const rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		return (await rendering).style;
	}

	function assertFluentMarkColours(style: PageStyle): void {
		assert.equal(style.colorScheme, 'light');
		assert.equal(style.colors, null);
		assert.equal(style.body.color, 'rgb(0, 0, 0)');
		assert.equal(style.body.backgroundColor, 'rgb(255, 255, 255)');
		assert.equal(style.link?.color, 'rgb(65, 131, 196)');
		assert.equal(style.code?.color, 'rgb(0, 0, 0)');
		assert.equal(style.code?.backgroundColor, 'rgb(248, 248, 248)');
		assert.equal(style.blockquote?.color, 'rgb(119, 119, 119)');
		assert.equal(style.blockquote?.backgroundColor, 'rgba(0, 0, 0, 0)');
	}

	it("looks like FluentMark's preview with light under a dark theme, without VS Code's default styles", async () => {
		await withAppearance(DARK_THEME, 'light', async () => {
			assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Dark, 'a dark theme is active');
			const style = await styleOf('light.md');

			assert.equal(style.vscodeDefaults, false, "VS Code's default styles are removed");
			assertFluentMarkColours(style);
			assert.equal(style.body.padding, '30px');
			assert.match(style.body.fontFamily, /^-apple-system,/);
			assert.equal(style.image?.maxWidth, '100%');
			assert.equal(style.image?.maxHeight, 'none');
		});
	});

	it("has FluentMark's colours under a light theme by default", async () => {
		await withAppearance(LIGHT_THEME, undefined, async () => {
			assertFluentMarkColours(await styleOf('auto-light.md'));
		});
	});

	it('is dark with the colours of a dark theme by default', async () => {
		await withAppearance(DARK_THEME, undefined, async () => {
			const style = await styleOf('auto-dark.md');

			assert.equal(style.colorScheme, 'dark');
			assert.equal(style.colors, 'theme');
			assert.equal(style.body.backgroundColor, rgb(style.theme.background), "the theme's background");
			assert.equal(style.link?.color, rgb(style.theme.link), "the theme's colour of links");
			assert.equal(style.body.padding, '30px');
		});
	});

	it('is dark with a palette of its own with dark under a light theme', async () => {
		await withAppearance(LIGHT_THEME, 'dark', async () => {
			assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Light, 'a light theme is active');
			const style = await styleOf('dark.md');

			assert.equal(style.colorScheme, 'dark');
			assert.equal(style.colors, null);
			assert.equal(style.body.color, 'rgb(204, 204, 204)');
			assert.equal(style.body.backgroundColor, 'rgb(31, 31, 31)');
			assert.equal(style.link?.color, 'rgb(77, 170, 252)');
			assert.equal(style.code?.backgroundColor, 'rgb(43, 43, 43)');
			assert.equal(style.blockquote?.color, 'rgb(157, 157, 157)');
		});
	});

	it('changes the colours of the page it shows as the setting changes', async () => {
		await withAppearance(LIGHT_THEME, 'light', async () => {
			const editor = await showDocument('switching.md', 'any');
			renderer = async () => ({ version: editor.document.version, html: STYLED });
			let rendering = nextRendering(editor.document.uri);
			manager.openPreviewToSide(editor.document.uri);
			assert.equal((await rendering).style.colorScheme, 'light');

			await vscode.workspace
				.getConfiguration('markdownSupport')
				.update('preview.colorScheme', 'dark', vscode.ConfigurationTarget.Global);
			rendering = nextRendering(editor.document.uri, (rendered) => rendered.version === editor.document.version);
			await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
			const { style } = await rendering;

			assert.equal(style.colorScheme, 'dark');
			assert.equal(style.body.backgroundColor, 'rgb(31, 31, 31)');
		});
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

	it('has icons of its own, for light and dark themes, on its tab and on the button that opens it', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
		const command = extension.packageJSON.contributes.commands.find(
			(candidate: { command: string }) => candidate.command === 'markdownSupport.preview.openToSide',
		);
		assert.deepEqual(command.icon, {
			light: 'images/preview-to-side-light.svg',
			dark: 'images/preview-to-side-dark.svg',
		});
		const editor = await showDocument('icon.md', '# Icon\n');
		const rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		await rendering;

		const icon = manager['preview']?.panel.iconPath as { light: vscode.Uri; dark: vscode.Uri } | undefined;
		const image = (name: string) => vscode.Uri.joinPath(extension.extensionUri, 'images', name).toString();
		assert.deepEqual(
			[icon?.light.toString(), icon?.dark.toString()],
			[image('preview-light.svg'), image('preview-dark.svg')],
		);
		for (const name of ['preview-to-side-light', 'preview-to-side-dark', 'preview-light', 'preview-dark']) {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, 'images', `${name}.svg`));
		}
	});

	it('offers no command that replaces it with its source', async () => {
		const contributes = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.contributes;
		const toggle = 'markdownSupport.preview.toggle';
		assert.deepEqual(
			contributes.menus['editor/title'].filter((item: { when?: string }) => item.when?.includes(VIEW_TYPE)),
			[],
			'the preview has no button in its title bar',
		);
		assert.ok(!contributes.commands.some((command: { command: string }) => command.command === toggle));
		assert.ok(!(await vscode.commands.getCommands(true)).includes(toggle));
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

	it('follows the editor to another Markdown document, also when going back, and is updated on its changes', async () => {
		const first = await showDocument('follow-first.md', '# First\n');
		let rendering = nextRendering(first.document.uri);
		manager.openPreviewToSide(first.document.uri);
		await rendering;

		const second = await showDocument('follow-second.md', '# Second\n');
		rendering = nextRendering(second.document.uri);
		await vscode.window.showTextDocument(second.document, vscode.ViewColumn.One);
		await rendering;
		assert.deepEqual(
			previewTabs().map((tab) => tab.label),
			['Preview follow-second.md'],
		);

		rendering = nextRendering(second.document.uri, (rendered) => rendered.version === second.document.version);
		await second.edit((edit) => edit.insert(new vscode.Position(1, 0), 'Changed\n'));
		await rendering;

		rendering = nextRendering(first.document.uri);
		await vscode.commands.executeCommand('workbench.action.navigateBack');
		await rendering;
		assert.deepEqual(
			previewTabs().map((tab) => tab.label),
			['Preview follow-first.md'],
		);
	});

	it('does not follow the editor to a document that is no Markdown', async () => {
		const editor = await showDocument('stay.md', '# Stay\n');
		const rendering = nextRendering(editor.document.uri);
		manager.openPreviewToSide(editor.document.uri);
		await rendering;

		await showDocument('notes.txt', 'plain text');
		await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY_MS * 2));

		assert.deepEqual(
			previewTabs().map((tab) => tab.label),
			['Preview stay.md'],
		);
	});

	it('is only ever one, which the commands show the document in, in place or beside the editor', async () => {
		const first = await showDocument('single-first.md', '# First\n');
		let rendering = nextRendering(first.document.uri);
		manager.openPreviewToSide(first.document.uri);
		await rendering;

		const other = vscode.Uri.file(path.join(directory, 'single-other.md'));
		await writeFile(other.fsPath, '# Other\n');
		rendering = nextRendering(other);
		manager.openPreviewToSide(other);
		await rendering;
		assert.deepEqual(
			previewTabs().map((tab) => [tab.label, tab.group.viewColumn]),
			[['Preview single-other.md', vscode.ViewColumn.Two]],
		);

		rendering = nextRendering(first.document.uri);
		manager.openPreview(first.document.uri);
		await rendering;
		assert.deepEqual(
			previewTabs().map((tab) => [tab.label, tab.group.viewColumn]),
			[['Preview single-first.md', vscode.ViewColumn.One]],
		);

		manager.openPreviewToSide(first.document.uri);
		await waitUntil(
			() =>
				previewTabs().length === 1 &&
				previewTabs()[0].group.viewColumn === vscode.ViewColumn.Two &&
				previewTabs()[0].label === 'Preview single-first.md',
		);
		assert.deepEqual(
			previewTabs().map((tab) => [tab.label, tab.group.viewColumn]),
			[['Preview single-first.md', vscode.ViewColumn.Two]],
		);
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
const DARK_THEME = 'Default Dark Modern';
const LIGHT_THEME = 'Default Light Modern';
/** A link, code, a quote and an image, whose colours tell the colour scheme of the page. */
const STYLED =
	'<p><a href="#here">A link</a> and <code>code</code></p><blockquote><p>A quote</p></blockquote>' +
	`<p><img src="${PIXEL}"></p>`;

/** The colour #rrggbb as the computed style gives it. */
function rgb(hex: string): string {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	assert.ok(match, `${hex} is a colour #rrggbb`);
	return `rgb(${match
		.slice(1)
		.map((part) => Number.parseInt(part, 16))
		.join(', ')})`;
}


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
