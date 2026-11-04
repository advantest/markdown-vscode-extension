// Runs the tests inside VS Code, against the bundled extension in dist/.
// The oldest VS Code the extension supports is used, so that a newer API cannot slip in unnoticed.

import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// User data of the end-to-end tests, emptied before every run.
const e2eUserData = resolve('.vscode-test/user-data-e2e');
rmSync(e2eUserData, { recursive: true, force: true });
// The Java the end-to-end tests run the server with is set before VS Code starts, so that the extension finds it
// when it is activated and the tests need not change it.
const javaHome = process.env.MARKDOWN_SUPPORT_TEST_JAVA_HOME;
if (javaHome) {
	mkdirSync(resolve(e2eUserData, 'User'), { recursive: true });
	writeFileSync(
		resolve(e2eUserData, 'User', 'settings.json'),
		JSON.stringify({ 'markdownSupport.java.home': javaHome }, null, '\t'),
	);
}

const common = {
	version: '1.91.0',
	mocha: {
		ui: 'bdd',
		timeout: 20_000,
	},
};

export default defineConfig([
	{
		...common,
		// Without a server, so that the tests behave the same whether or not a Java 21 is found.
		label: 'integration',
		env: { MARKDOWN_SUPPORT_TEST_NO_SERVER: '1' },
		files: 'out/test/integration/**/*.test.js',
		launchArgs: ['--disable-extensions'],
	},
	{
		// Against the real language server. The tests change user settings, so they get user data of their own,
		// emptied before every run.
		...common,
		label: 'e2e',
		files: 'out/test/e2e/**/*.test.js',
		launchArgs: ['--disable-extensions', `--user-data-dir=${e2eUserData}`],
	},
]);
