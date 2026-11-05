import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';
import type { Rendered } from '../../src/preview/manager';

/*
 * The tests of what the preview shows of every kind of content, against whichever language server is running. They
 * load nothing else of this repository at run time and write their documents themselves, so that another extension,
 * which declares a server of its own, can run the same tests by requiring the compiled suite.
 */

/** The extension whose preview is tested; it shows the preview whichever server is running. */
const EXTENSION_ID = 'advantest.markdown-support';
export const RENDER_TIMEOUT = 60_000;

/** What another extension, whose server renders some content differently, sets for its run of the suite. */
export interface RenderingOptions {
	/** Runs once the extension is active and before the document is previewed, e.g. to check which server runs. */
	before?: (api: MarkdownSupportApi) => Promise<void> | void;
	/** The address a server links text looking like a ticket number to, e.g. HMR-122; without it, it stays text. */
	ticketLink?: RegExp;
}

/** Defines, within the caller's describe, the tests of the preview of a document with every kind of content. */
export function describeRendering(options: RenderingOptions = {}): void {
	describe('of a document with every kind of content', function () {
		this.timeout(RENDER_TIMEOUT + 10_000);

		let directory: string | undefined;
		let rendered: Rendered;

		before(async () => {
			directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-rendering-'));
			await mkdir(path.join(directory, 'docs'));
			await mkdir(path.join(directory, 'images'));
			await writeFile(path.join(directory, 'images', 'bitmap.png'), Buffer.from(PNG, 'base64'));
			await writeFile(path.join(directory, 'images', 'drawing.svg'), SVG);
			await mkdir(path.join(directory, 'diagrams'));
			await writeFile(path.join(directory, 'diagrams', 'classes.puml'), PUML);
			await writeFile(path.join(directory, 'other.md'), '# Other\n');
			const file = path.join(directory, 'docs', 'content.md');
			await writeFile(file, CONTENT);
			const uri = vscode.Uri.file(file);
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
			const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();
			await options.before?.(api);
			const rendering = renderingOf(api, uri);
			await vscode.commands.executeCommand('markdownSupport.preview.openToSide');
			rendered = await rendering;
		});

		after(async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			if (directory) {
				await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
			}
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
			const links = rendered.content.links
				.filter((link) => !options.ticketLink || link.text !== 'HMR-122')
				.map((link) => [link.text, link.href]);
			assert.deepEqual(links, [
				['another document', '../other.md'],
				['a heading', '#rendering'],
				['a web page', 'https://example.com/page'],
				['https://example.org/', 'https://example.org/'],
				['a reference', '../other.md#other'],
				...BARE_LINKS,
				['1', '#fn-1'],
				['the section', '#own-anchor'],
				['↩', '#fnref-1'],
			]);
		});

		it('links bare web and mail addresses, without the period ending the sentence', () => {
			const links = rendered.content.links.map((link) => [link.text, link.href]);
			for (const link of BARE_LINKS) {
				assert.ok(
					links.some(([text, href]) => text === link[0] && href === link[1]),
					`${link[0]} links to ${link[1]}`,
				);
			}
		});

		it('leaves web addresses in code as text', () => {
			assert.match(rendered.content.text, /https:\/\/example\.com\/code/);
			assert.match(rendered.content.text, /https:\/\/example\.com\/block/);
			assert.ok(!rendered.content.links.some((link) => /\/(code|block)$/.test(link.href)), 'no link into code');
		});

		it('finds the target of every link within the page', () => {
			for (const link of rendered.content.links.filter((link) => link.href.startsWith('#'))) {
				assert.ok(rendered.content.ids.includes(link.href.slice(1)), `${link.href} is in the page`);
			}
		});

		it('gives the headings their explicit anchors', () => {
			assert.ok(rendered.content.ids.includes('rendering'));
			assert.ok(rendered.content.ids.includes('own-anchor'));
			assert.doesNotMatch(rendered.content.text, /\{#/, 'no anchor is shown in its source');
		});

		it('resolves the reference link and shows no definition', () => {
			assert.doesNotMatch(rendered.content.text, /\[other\]|The other document/);
		});

		it('shows the footnote reference and the footnote', () => {
			assert.ok(rendered.content.links.some((link) => link.href === '#fn-1'), 'the reference links to the footnote');
			assert.ok(rendered.content.ids.includes('fn-1'), 'the footnote is in the page');
			assert.match(rendered.content.text, /The footnote text\./);
			assert.doesNotMatch(rendered.content.text, /\[\^note\]/, 'no footnote is shown in its source');
		});

		it('shows the HTML block with the Markdown inside it rendered', () => {
			assert.equal(rendered.content.elements.details, 1, 'one details element');
			assert.equal(rendered.content.elements.summary, 1, 'one summary element');
			assert.equal(rendered.content.elements.strong, 1, 'the bold text inside it');
			assert.doesNotMatch(rendered.content.text, /\*\*|<details>/);
		});

		if (options.ticketLink) {
			const address = options.ticketLink;
			it('links text that looks like a ticket number to the ticket', () => {
				assert.match(rendered.content.text, /The ticket HMR-122 in a sentence\./);
				const tickets = rendered.content.links.filter((link) => link.text.includes('HMR-122'));
				assert.equal(tickets.length, 1, 'one link to HMR-122');
				assert.equal(tickets[0].text, 'HMR-122', 'the link shows the ticket number only');
				assert.match(tickets[0].href, address);
			});
		} else {
			it('leaves text that looks like a ticket number as text', () => {
				assert.match(rendered.content.text, /The ticket HMR-122 in a sentence\./);
				assert.ok(!rendered.content.links.some((link) => link.text.includes('HMR-122')), 'HMR-122 is no link');
			});
		}

		it('draws the PlantUML code block as an SVG figure', () => {
			assert.ok(
				rendered.content.figures.some((figure) => /Alice.*Bob/s.test(figure)),
				'a figure draws the diagram of the code block',
			);
			assert.doesNotMatch(rendered.content.text, /@startuml|Alice -> Bob/, 'the source of the diagram is not shown');
		});

		it('draws the image of a PlantUML file as an SVG figure, not as an image', () => {
			assert.ok(rendered.images.every((image) => !image.endsWith('.puml')), 'no image of the diagram file');
			assert.ok(
				rendered.content.figures.some((figure) => figure.includes('Shown')),
				'a figure draws the diagram of the file',
			);
			assert.equal(rendered.figures, 2, 'one figure each for the code block and the diagram file');
		});

		it('keeps the link inside a diagram apart from the links of the text', () => {
			assert.deepEqual(rendered.content.figureLinks, ['https://example.com/diagram']);
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
}

/** What the preview of the document reports once it shows its version; rejected after RENDER_TIMEOUT. */
export function renderingOf(api: MarkdownSupportApi, uri: vscode.Uri): Promise<Rendered> {
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


// An image 8 by 4 pixels.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGM4YSOCFTFQTwIA7T4jASdNc+EAAAAASUVORK5CYII=';
const PNG_WIDTH = 8;
const SVG_WIDTH = 40;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="20"><rect width="40" height="20" fill="teal"/></svg>`;
/** The links the server makes of the bare addresses in the document, as flexmark's autolinks render them. */
const BARE_LINKS = [
	['https://example.com/auto', 'https://example.com/auto'],
	['https://example.com/path', 'https://example.com/path'],
	['https://example.com/search?q=a&b=c#part', 'https://example.com/search?q=a&b=c#part'],
	['www.example.com', 'http://www.example.com'],
	['someone@example.com', 'mailto:someone@example.com'],
];
const PUML = ['@startuml', 'class Shown [[https://example.com/diagram]]', '@enduml', ''].join('\n');

const CONTENT = [
	'# Rendering {#rendering}',
	'',
	'![A bitmap](../images/bitmap.png)',
	'',
	'![A drawing](../images/drawing.svg)',
	'',
	'![A diagram](../diagrams/classes.puml)',
	'',
	'Links to [another document](../other.md), [a heading](#rendering), [a web page](https://example.com/page),',
	'<https://example.org/> and [a reference][other].',
	'',
	'Bare addresses: https://example.com/auto in a sentence, see https://example.com/path.',
	'With a query https://example.com/search?q=a&b=c#part, without a scheme www.example.com, a mail someone@example.com.',
	'',
	'[other]: ../other.md#other "The other document"',
	'',
	'<!-- a comment nobody sees -->',
	'',
	'<details>',
	'<summary>More</summary>',
	'',
	'Some **bold** text inside.',
	'',
	'</details>',
	'',
	'A claim[^note] with a footnote.',
	'',
	'[^note]: The footnote text.',
	'',
	'The ticket HMR-122 in a sentence.',
	'',
	'## A section with an anchor {#own-anchor}',
	'',
	'A link to [the section](#own-anchor).',
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
	'The `https://example.com/code` in a line.',
	'',
	'```java',
	'class Hello {} // https://example.com/block',
	'```',
	'',
	'```plantuml',
	'@startuml',
	'Alice -> Bob: Hello',
	'@enduml',
	'```',
	'',
].join('\n');
