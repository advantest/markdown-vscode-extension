/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Bundles the extension and everything it imports into dist/extension.js and the script of the preview page
// into dist/media/preview.js, and copies what else the preview page loads into dist/media.
//
//   node esbuild.mjs               a build for development, with source maps
//   node esbuild.mjs --production  a minified build, as it is packaged
//   node esbuild.mjs --watch       rebuilds on every change
//
// Types are not checked here; "npm run check" does that.

import { cpSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The preview loads everything from the extension, nothing from a CDN.
function copyMedia() {
	rmSync('dist/media', { recursive: true, force: true });
	cpSync('media', 'dist/media', { recursive: true });
	const highlight = 'node_modules/@highlightjs/cdn-assets';
	cpSync(`${highlight}/highlight.min.js`, 'dist/media/highlight/highlight.min.js');
	cpSync(`${highlight}/styles/default.min.css`, 'dist/media/highlight/default.min.css');
	cpSync(`${highlight}/LICENSE`, 'dist/media/highlight/LICENSE');
	cpSync('node_modules/mathjax/es5', 'dist/media/mathjax/es5', { recursive: true });
	cpSync('node_modules/mathjax/LICENSE', 'dist/media/mathjax/LICENSE');
}

copyMedia();

const extension = await esbuild.context({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node20',
	outfile: 'dist/extension.js',
	// Provided by VS Code at run time, never bundled.
	external: ['vscode'],
	minify: production,
	sourcemap: !production,
	logLevel: 'info',
});

// The script of the preview page runs in the webview, a browser.
const page = await esbuild.context({
	entryPoints: ['src/webview/preview.ts'],
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2022',
	outfile: 'dist/media/preview.js',
	minify: production,
	sourcemap: production ? false : 'inline',
	logLevel: 'info',
});

for (const context of [extension, page]) {
	if (watch) {
		await context.watch();
	} else {
		await context.rebuild();
		await context.dispose();
	}
}
