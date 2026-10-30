// Runs the integration tests inside VS Code, against the bundled extension in dist/.
// The oldest VS Code the extension supports is used, so that a newer API cannot slip in unnoticed.

import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	label: 'integration',
	files: 'out/test/integration/**/*.test.js',
	version: '1.91.0',
	launchArgs: ['--disable-extensions'],
	mocha: {
		ui: 'bdd',
		timeout: 20_000,
	},
});
