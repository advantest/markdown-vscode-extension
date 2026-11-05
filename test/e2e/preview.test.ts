import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';
import type { Rendered } from '../../src/preview/manager';
import { BUNDLED_JAR, EXTENSION_ID, JAVA_HOME, SKIPPED } from './support';

// Shows the preview of a document as the language server bundled with the extension renders it.

const RENDER_TIMEOUT = 60_000;

const DOCUMENT = [
	'# Preview',
	'',
	'The formula $a^2 + b^2 = c^2$ in a line.',
	'',
	'```java',
	'class Hello {',
	'    String greeting = "Hello";',
	'}',
	'```',
	'',
	'```plantuml',
	'@startuml',
	'Alice -> Bob: Hello',
	'@enduml',
	'```',
	'',
].join('\n');

describe('the preview with the language server markdown-ls', function () {
	this.timeout(RENDER_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		if (!JAVA_HOME || !existsSync(BUNDLED_JAR)) {
			console.log(`    ${SKIPPED}`);
			this.skip();
		}
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-preview-'));
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (directory) {
			await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	});

	it('shows the formulas typeset, the code highlighted and the diagrams drawn', async () => {
		const file = path.join(directory!, 'preview.md');
		await writeFile(file, DOCUMENT);
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
		const extension = vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);
		const api = await extension.activate();

		const rendering = renderingOf(api, uri);
		await vscode.commands.executeCommand('markdownSupport.preview.openToSide');

		const rendered = await rendering;
		assert.equal(rendered.math, 1, 'one formula typeset');
		assert.equal(rendered.code, 1, 'one code block highlighted');
		assert.equal(rendered.figures, 1, 'one diagram drawn');
	});

	describe('of a document with every kind of content', () => {
		let rendered: Rendered;

		before(async () => {
			await mkdir(path.join(directory!, 'docs'));
			await mkdir(path.join(directory!, 'images'));
			await writeFile(path.join(directory!, 'images', 'bitmap.png'), Buffer.from(PNG, 'base64'));
			await writeFile(path.join(directory!, 'images', 'drawing.svg'), SVG);
			await writeFile(path.join(directory!, 'other.md'), '# Other\n');
			const file = path.join(directory!, 'docs', 'content.md');
			await writeFile(file, CONTENT);
			const uri = vscode.Uri.file(file);
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
			const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();
			const rendering = renderingOf(api, uri);
			await vscode.commands.executeCommand('markdownSupport.preview.openToSide');
			rendered = await rendering;
		});

		it('loads a PNG and an SVG image from the folder above the document', () => {
			assert.equal(rendered.images.length, 2, 'two images');
			const [bitmap, drawing] = rendered.images.map((image) => new URL(image));
			for (const [address, name] of [
				[bitmap, 'bitmap.png'],
				[drawing, 'drawing.svg'],
			] as const) {
				assert.match(address.protocol, /^(https|vscode-webview-resource):$/, `${name} is a webview resource`);
				assert.ok(
					decodeURIComponent(address.pathname)
						.toLowerCase()
						.endsWith(vscode.Uri.file(path.join(directory!, 'images', name)).path.toLowerCase()),
					`${address.href} names ${name}`,
				);
			}
			assert.deepEqual(rendered.imageWidths, [PNG_WIDTH, SVG_WIDTH], 'both images loaded in their widths');
		});

		it('shows the links with their targets as written', () => {
			const links = rendered.content.links.map((link) => [link.text, link.href]);
			assert.deepEqual(links, [
				['another document', '../other.md'],
				['a heading', '#rendering'],
				['a web page', 'https://example.com/page'],
				['https://example.org/', 'https://example.org/'],
				['a reference', '../other.md#other'],
			]);
		});

		it('draws the PlantUML code block as an SVG figure', () => {
			assert.equal(rendered.figures, 1, 'one figure holding an SVG');
			assert.doesNotMatch(rendered.content.text, /@startuml|Alice -> Bob/, 'the source of the diagram is not shown');
		});

		it('shows no comment', () => {
			assert.doesNotMatch(rendered.content.text, /comment nobody sees|<!--/);
		});

		it('shows the table as a table', () => {
			assert.deepEqual(rendered.content.tables, [{ headers: ['Fruit', 'Price'], rows: 2 }]);
		});

		it('typesets the formulas in a line and in display mode', () => {
			assert.equal(rendered.content.inlineMath, 1, 'one formula in a line');
			assert.equal(rendered.content.displayMath, 1, 'one formula in display mode');
			assert.doesNotMatch(rendered.content.text, /\$|\\sum|\\frac/, 'no formula is shown in its source');
		});

		it('shows the code in a line and the fenced code block', () => {
			assert.equal(rendered.content.inlineCode, 1, 'one code in a line');
			assert.equal(rendered.content.codeBlocks, 1, 'one code block');
			assert.equal(rendered.code, 1, 'the code block highlighted');
			assert.match(rendered.content.text, /class Hello/);
		});
	});
});

// An image 8 by 4 pixels.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGM4YSOCFTFQTwIA7T4jASdNc+EAAAAASUVORK5CYII=';
const PNG_WIDTH = 8;
const SVG_WIDTH = 40;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="20"><rect width="40" height="20" fill="teal"/></svg>`;

const CONTENT = [
	'# Rendering',
	'',
	'![A bitmap](../images/bitmap.png)',
	'',
	'![A drawing](../images/drawing.svg)',
	'',
	'Links to [another document](../other.md), [a heading](#rendering), [a web page](https://example.com/page),',
	'<https://example.org/> and [a reference][other].',
	'',
	'[other]: ../other.md#other',
	'',
	'<!-- a comment nobody sees -->',
	'',
	'| Fruit | Price |',
	'|-------|------:|',
	'| Apple |  1.50 |',
	'| Pear  |  2.25 |',
	'',
	'The formula $a^2 + b^2 = c^2$ in a line.',
	'',
	'$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$',
	'',
	'The `code` in a line.',
	'',
	'```java',
	'class Hello {}',
	'```',
	'',
	'```plantuml',
	'@startuml',
	'Alice -> Bob: Hello',
	'@enduml',
	'```',
	'',
].join('\n');

function renderingOf(api: MarkdownSupportApi, uri: vscode.Uri): Promise<Rendered> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`no preview of ${uri.toString()} within ${RENDER_TIMEOUT} ms`));
		}, RENDER_TIMEOUT);
		const listener = api.onDidRenderPreview((rendered) => {
			if (rendered.uri.toString() === uri.toString()) {
				clearTimeout(timer);
				listener.dispose();
				resolve(rendered);
			}
		});
	});
}
