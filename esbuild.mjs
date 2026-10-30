// Bundles the extension and everything it imports into dist/extension.js.
//
//   node esbuild.mjs               a build for development, with source maps
//   node esbuild.mjs --production  a minified build, as it is packaged
//   node esbuild.mjs --watch       rebuilds on every change
//
// Types are not checked here; "npm run check" does that.

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
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

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}
