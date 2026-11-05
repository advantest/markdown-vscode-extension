import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import type { JavaEnvironment } from '../../src/java';
import { LaunchError, prepareLaunch, serverJar, startsNoServer } from '../../src/server';
import type { Settings } from '../../src/settings';

const PROPERTIES_21 = '    java.specification.version = 21\n';
const PROPERTIES_17 = '    java.specification.version = 17\n';

const BUNDLED = { path: '/ls/markdown-ls.jar', description: 'markdown-ls 1.2.3, bundled with the extension' };

describe('serverJar', () => {
	const extension = (development: boolean) => ({
		extensionPath: '/ext',
		packageJSON: { markdownSupport: { defaultServer: { version: '1.2.3' } } },
		development,
	});
	const bundled = {
		path: path.join('/ext', 'server', 'markdown-ls.jar'),
		description: 'markdown-ls 1.2.3, bundled with the extension',
	};

	it('is the server bundled with the extension, of the version package.json names', () => {
		assert.deepEqual(serverJar(extension(false), {}), bundled);
	});

	it('is the one MARKDOWN_SUPPORT_TEST_SERVER_JAR names while the extension is developed or tested', () => {
		assert.deepEqual(serverJar(extension(true), { MARKDOWN_SUPPORT_TEST_SERVER_JAR: ' /dev/markdown-ls.jar ' }), {
			path: '/dev/markdown-ls.jar',
			description: 'the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names',
		});
		assert.deepEqual(serverJar(extension(true), { MARKDOWN_SUPPORT_TEST_SERVER_JAR: ' ' }), bundled);
	});

	it('ignores MARKDOWN_SUPPORT_TEST_SERVER_JAR in an installed extension', () => {
		assert.deepEqual(serverJar(extension(false), { MARKDOWN_SUPPORT_TEST_SERVER_JAR: '/dev/markdown-ls.jar' }), bundled);
	});

	it('leaves the version out if package.json names none', () => {
		const described = serverJar({ extensionPath: '/ext', packageJSON: {}, development: false }, {}).description;

		assert.equal(described, 'markdown-ls, bundled with the extension');
	});
});

describe('startsNoServer', () => {
	it('is true under test if MARKDOWN_SUPPORT_TEST_NO_SERVER is set', () => {
		assert.equal(startsNoServer(true, { MARKDOWN_SUPPORT_TEST_NO_SERVER: '1' }), true);
	});

	it('is false if MARKDOWN_SUPPORT_TEST_NO_SERVER is not set or blank', () => {
		assert.equal(startsNoServer(true, {}), false);
		assert.equal(startsNoServer(true, { MARKDOWN_SUPPORT_TEST_NO_SERVER: ' ' }), false);
	});

	it('ignores MARKDOWN_SUPPORT_TEST_NO_SERVER unless the extension is tested', () => {
		assert.equal(startsNoServer(false, { MARKDOWN_SUPPORT_TEST_NO_SERVER: '1' }), false);
	});
});

describe('prepareLaunch', () => {
	const LAUNCH = { command: '/jdk-21/bin/java', args: ['-jar', 'markdown-ls.jar'], cwd: path.dirname(BUNDLED.path) };

	it('starts the server JAR with java -jar and no VM arguments, which JAVA_TOOL_OPTIONS can give', async () => {
		const launch = await prepareLaunch(
			BUNDLED,
			settings({ javaHome: '/jdk-21' }),
			environment({ '/jdk-21/bin/java': PROPERTIES_21, '/ls/markdown-ls.jar': '' }),
		);

		assert.deepEqual(launch, LAUNCH);
	});

	it('starts Java in the folder of the JAR and names the JAR by its file name alone', async () => {
		// On Windows, Java reads its command line in the ANSI code page, which cannot represent every path.
		const jar = { path: path.join('/Ελληνικά-日本語', 'server', 'launcher.jar'), description: 'a declared server' };

		const launch = await prepareLaunch(
			jar,
			settings({ javaHome: '/jdk-21' }),
			environment({ '/jdk-21/bin/java': PROPERTIES_21, [jar.path]: '' }),
		);

		assert.deepEqual(launch.args, ['-jar', 'launcher.jar']);
		assert.equal(launch.cwd, path.join('/Ελληνικά-日本語', 'server'));
	});

	it('starts the server with the Java found in JAVA_HOME or on the PATH if none is set', async () => {
		const launch = await prepareLaunch(
			BUNDLED,
			settings({}),
			environment({ '/jdk-21/bin/java': PROPERTIES_21, '/ls/markdown-ls.jar': '' }, { JAVA_HOME: '/jdk-21' }),
		);

		assert.deepEqual(launch, LAUNCH);
	});

	it('fails, pointing to no setting, if the JAR does not exist', async () => {
		const error = await rejection(
			prepareLaunch(BUNDLED, settings({ javaHome: '/jdk-21' }), environment({ '/jdk-21/bin/java': PROPERTIES_21 })),
		);

		assert.equal(error.setting, undefined);
		assert.equal(
			error.message,
			'The JAR /ls/markdown-ls.jar does not exist (markdown-ls 1.2.3, bundled with the extension).',
		);
	});

	it('names the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names if its JAR does not exist', async () => {
		const named = { path: '/dev/markdown-ls.jar', description: 'the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names' };

		const error = await rejection(prepareLaunch(named, settings({}), environment({})));

		assert.equal(
			error.message,
			'The JAR /dev/markdown-ls.jar does not exist (the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names).',
		);
	});

	it('looks for Java only once the JAR is found', async () => {
		const env = environment({ '/jdk-21/bin/java': PROPERTIES_21 });

		await rejection(prepareLaunch(BUNDLED, settings({ javaHome: '/jdk-21' }), env));

		assert.deepEqual(env.runs, []);
	});

	it('points to the setting of Java if no Java 21 is found', async () => {
		const error = await rejection(
			prepareLaunch(
				BUNDLED,
				settings({ javaHome: '/jdk-17' }),
				environment({ '/jdk-17/bin/java': PROPERTIES_17, '/ls/markdown-ls.jar': '' }),
			),
		);

		assert.equal(error.setting, 'markdownSupport.java.home');
		assert.match(error.message, /Java 17/);
	});

	it('passes on other failures', async () => {
		const failing = environment({ '/ls/markdown-ls.jar': '' });
		failing.isFile = async (path) => {
			if (path.startsWith('/jdk')) {
				throw new TypeError('broken');
			}
			return true;
		};

		await assert.rejects(prepareLaunch(BUNDLED, settings({ javaHome: '/jdk' }), failing), TypeError);
	});
});

function settings(values: Partial<Settings>): Settings {
	return { javaHome: undefined, ...values };
}
function environment(
	files: Record<string, string>,
	env: Record<string, string> = {},
): JavaEnvironment & { runs: string[] } {
	const result = {
		platform: 'linux' as NodeJS.Platform,
		env,
		runs: [] as string[],
		isFile: async (path: string) => path in files,
		run: async (executable: string) => {
			result.runs.push(executable);
			return files[executable] ?? '';
		},
	};
	return result;
}

async function rejection(promise: Promise<unknown>): Promise<LaunchError> {
	try {
		await promise;
	} catch (error) {
		assert.ok(error instanceof LaunchError, `${String(error)} is a LaunchError`);
		return error;
	}
	assert.fail('no error was thrown');
}
