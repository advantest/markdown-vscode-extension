/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The build copies what the preview page loads into dist/media; nothing comes from a CDN.
// "npm test" builds before it runs the tests.
const MEDIA = 'dist/media';

function sameFile(copy: string, original: string): void {
	assert.ok(existsSync(copy), `${copy} is missing`);
	assert.ok(readFileSync(copy).equals(readFileSync(original)), `${copy} differs from ${original}`);
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path).map((file) => join(name, file)) : [name];
	});
}

describe('the media of the preview', () => {
	it('contains the default stylesheet', () => {
		sameFile(join(MEDIA, 'default.css'), 'media/default.css');
	});

	it('contains highlight.js with its StackOverflow styles and its licence', () => {
		const highlight = 'node_modules/@highlightjs/cdn-assets';
		sameFile(join(MEDIA, 'highlight/highlight.min.js'), join(highlight, 'highlight.min.js'));
		sameFile(join(MEDIA, 'highlight/stackoverflow-light.min.css'), join(highlight, 'styles/stackoverflow-light.min.css'));
		sameFile(join(MEDIA, 'highlight/stackoverflow-dark.min.css'), join(highlight, 'styles/stackoverflow-dark.min.css'));
		sameFile(join(MEDIA, 'highlight/LICENSE'), join(highlight, 'LICENSE'));
	});

	it('contains the whole MathJax folder and its licence', () => {
		const mathjax = 'node_modules/mathjax';
		assert.deepEqual(files(join(MEDIA, 'mathjax/es5')).sort(), files(join(mathjax, 'es5')).sort());
		sameFile(join(MEDIA, 'mathjax/es5/tex-mml-svg.js'), join(mathjax, 'es5/tex-mml-svg.js'));
		sameFile(join(MEDIA, 'mathjax/es5/input/asciimath.js'), join(mathjax, 'es5/input/asciimath.js'));
		sameFile(join(MEDIA, 'mathjax/LICENSE'), join(mathjax, 'LICENSE'));
	});

	it('is packaged', () => {
		const ignore = readFileSync('.vscodeignore', 'utf8').split('\n').map((line) => line.trim());
		assert.ok(ignore.includes('!dist/media/**'), '.vscodeignore excludes dist/media');
	});
});
