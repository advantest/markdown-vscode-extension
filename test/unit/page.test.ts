/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ColorScheme } from '../../src/preview/colorScheme';
import { previewPage } from '../../src/preview/page';

const CSP_SOURCE = 'https://*.vscode-cdn.net';
const MEDIA = 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/media';
const BASE = 'https://file+.vscode-resource.vscode-cdn.net/docs/';

const LIGHT: ColorScheme = { scheme: 'light', themeColors: false };

function page(base: string | undefined = BASE, colorScheme: ColorScheme = LIGHT): string {
	return previewPage({ cspSource: CSP_SOURCE, media: MEDIA, base, colorScheme });
}

function pageWithoutBase(): string {
	return previewPage({ cspSource: CSP_SOURCE, media: MEDIA, base: undefined, colorScheme: LIGHT });
}

function attributes(html: string, tag: string, attribute: string): string[] {
	const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attribute}="([^"]*)"`, 'g');
	return [...html.matchAll(pattern)].map((match) => match[1]);
}

function contentSecurityPolicy(html: string): Map<string, string[]> {
	const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
	assert.ok(match, 'the page has a content security policy');
	return new Map(
		match[1]
			.split(';')
			.map((directive) => directive.trim().split(/\s+/))
			.filter((parts) => parts[0] !== '')
			.map(([name, ...sources]) => [name, sources]),
	);
}

describe('the preview page', () => {
	it('allows scripts only from the extension', () => {
		const csp = contentSecurityPolicy(page());
		assert.deepEqual(csp.get('default-src'), ["'none'"]);
		assert.deepEqual(csp.get('script-src'), [CSP_SOURCE]);
	});

	it('allows stylesheets from the extension and inline styles', () => {
		assert.deepEqual(contentSecurityPolicy(page()).get('style-src'), [CSP_SOURCE, "'unsafe-inline'"]);
	});

	it('allows images from the extension, the document folder, the web and data URIs', () => {
		assert.deepEqual(contentSecurityPolicy(page()).get('img-src'), [CSP_SOURCE, 'https:', 'http:', 'data:']);
	});

	it('resolves relative addresses against the folder of the document', () => {
		assert.deepEqual(attributes(page(), 'base', 'href'), [BASE]);
	});

	it('has no base where the document has no folder', () => {
		assert.deepEqual(attributes(pageWithoutBase(), 'base', 'href'), []);
	});

	it('escapes the addresses it inserts', () => {
		assert.deepEqual(attributes(page('https://host/a"b&c/'), 'base', 'href'), ['https://host/a&quot;b&amp;c/']);
	});

	it('loads the default stylesheet, the colours, its own one and the style of highlight.js, in that order', () => {
		assert.deepEqual(attributes(page(), 'link', 'href'), [
			`${MEDIA}/default.css`,
			`${MEDIA}/color-scheme.css`,
			`${MEDIA}/vscode-colors.css`,
			`${MEDIA}/preview.css`,
			`${MEDIA}/highlight/default.min.css`,
		]);
	});

	it('shows the colour scheme it is given, with the colours of the theme only where they fit', () => {
		assert.deepEqual(attributes(page(), 'body', 'data-color-scheme'), ['light']);
		assert.deepEqual(attributes(page(), 'body', 'data-colors'), []);
		const dark = page(BASE, { scheme: 'dark', themeColors: false });
		assert.deepEqual(attributes(dark, 'body', 'data-color-scheme'), ['dark']);
		assert.deepEqual(attributes(dark, 'body', 'data-colors'), []);
		const themed = page(BASE, { scheme: 'dark', themeColors: true });
		assert.deepEqual(attributes(themed, 'body', 'data-color-scheme'), ['dark']);
		assert.deepEqual(attributes(themed, 'body', 'data-colors'), ['theme']);
	});

	it('loads highlight.js, MathJax with its configuration and its own script last', () => {
		const html = page();
		const scripts = attributes(html, 'script', 'src');
		assert.deepEqual(scripts.slice(0, 3), [
			`${MEDIA}/highlight/highlight.min.js`,
			`${MEDIA}/mathjax-config.js`,
			`${MEDIA}/mathjax/es5/tex-mml-svg.js`,
		]);
		assert.equal(scripts.at(-1), `${MEDIA}/preview.js`);
		assert.match(html, /<script id="MathJax-script" async src="[^"]*\/mathjax\/es5\/tex-mml-svg\.js"><\/script>/);
	});

	it('loads the script that zooms and moves images just before its own script', () => {
		assert.deepEqual(attributes(page(), 'script', 'src').slice(-2), [`${MEDIA}/zoom.js`, `${MEDIA}/preview.js`]);
	});

	it('has the hint on zooming and moving images of FluentMark', () => {
		assert.match(
			page(),
			/<div id="zoom-hint">\s*<div>Use <em>Alt \+ mouse wheel<\/em> to zoom\.<\/div>\s*<div>Use <em>left mouse button<\/em> to grab and move\.<\/div>\s*<div>Use <em>right mouse button<\/em> to reset\.<\/div>\s*<\/div>/,
		);
	});

	it('loads the script that connects rendered elements and their source before the one that zooms', () => {
		assert.deepEqual(attributes(page(), 'script', 'src').slice(-3, -1), [`${MEDIA}/source.js`, `${MEDIA}/zoom.js`]);
	});

	it('has the hint on jumping to the source of FluentMark', () => {
		assert.match(
			page(),
			/<div id="jump-to-source-hint">\s*<div>Jump to source with <em>Ctrl \+ mouse click<\/em>\.<\/div>\s*<\/div>/,
		);
	});

	it('has no inline script', () => {
		assert.doesNotMatch(page(), /<script(?![^>]*\ssrc=)[^>]*>/);
	});

	it('has the element the content goes into', () => {
		assert.match(page(), /<span id="app"><\/span>/);
	});

	it('loads only files that the build puts into dist/media', () => {
		const html = page();
		const loaded = [...attributes(html, 'link', 'href'), ...attributes(html, 'script', 'src')];
		for (const address of loaded) {
			assert.ok(address.startsWith(`${MEDIA}/`), `${address} comes from the extension`);
			const file = join('dist/media', address.substring(MEDIA.length + 1));
			assert.ok(existsSync(file), `${file} exists`);
		}
	});
});

describe('the MathJax configuration of the preview', () => {
	it('is the one of FluentMark', () => {
		const window: { MathJax?: unknown } = {};
		runInNewContext(readFileSync('media/mathjax-config.js', 'utf8'), { window });
		// Through JSON, since objects made in another context have other prototypes.
		assert.deepEqual(JSON.parse(JSON.stringify(window.MathJax)), {
			options: {
				enableMenu: true,
				ignoreHtmlClass: 'tex2jax_ignore',
				processHtmlClass: 'tex2jax_process',
			},
			tex: {
				inlineMath: [
					['$', '$'],
					['\\(', '\\)'],
				],
				displayMath: [
					['$$', '$$'],
					['\\[', '\\]'],
				],
				processEscapes: true,
				tags: 'ams',
				autoload: {
					color: [],
					colorv2: ['color'],
				},
			},
			loader: {
				load: ['input/asciimath'],
			},
		});
	});
});
