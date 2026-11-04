// Runs the tests inside VS Code, against the bundled extension in dist/.
// The oldest VS Code the extension supports is used, so that a newer API cannot slip in unnoticed.

import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeStubExtensions } from './test/stubExtensions.mjs';

/**
 * User data of end-to-end tests, emptied before every run. The Java they run the server with is set before VS Code
 * starts, so that the extension finds it when it is activated and the tests need not change it.
 */
function e2eUserData(name) {
	const folder = resolve('.vscode-test', name);
	rmSync(folder, { recursive: true, force: true });
	const javaHome = process.env.MARKDOWN_SUPPORT_TEST_JAVA_HOME;
	if (javaHome) {
		mkdirSync(resolve(folder, 'User'), { recursive: true });
		writeFileSync(
			resolve(folder, 'User', 'settings.json'),
			JSON.stringify({ 'markdownSupport.java.home': javaHome }, null, '\t'),
		);
	}
	return folder;
}

// Extensions without code that declare a server, installed next to the extension under test by some of the runs.
const pinned = JSON.parse(readFileSync('package.json', 'utf8')).markdownSupport.defaultServer.version;
const stubs = await writeStubExtensions(resolve('.vscode-test', 'stubs'), resolve('server', 'markdown-ls.jar'), pinned);

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
		// Against the real language server. The tests change user settings, so they get user data of their own.
		...common,
		label: 'e2e',
		files: 'out/test/e2e/**/*.test.js',
		launchArgs: ['--disable-extensions', `--user-data-dir=${e2eUserData('user-data-e2e')}`],
	},
	{
		// With an extension that declares a server, which is started in place of the bundled one.
		...common,
		label: 'e2e-declared',
		extensionDevelopmentPath: [resolve('.'), stubs.valid],
		files: 'out/test/e2e-declared/**/*.test.js',
		launchArgs: ['--disable-extensions', `--user-data-dir=${e2eUserData('user-data-e2e-declared')}`],
	},
	{
		// With two extensions that declare a server, so that the bundled one is started.
		...common,
		label: 'e2e-several',
		extensionDevelopmentPath: [resolve('.'), stubs.valid, stubs.unaccepted],
		files: 'out/test/e2e-several/**/*.test.js',
		launchArgs: ['--disable-extensions', `--user-data-dir=${e2eUserData('user-data-e2e-several')}`],
	},
]);
