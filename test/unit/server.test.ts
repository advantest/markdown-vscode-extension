import * as assert from 'node:assert/strict';
import type { JavaEnvironment } from '../../src/java';
import { LaunchError, prepareLaunch } from '../../src/server';
import type { Settings } from '../../src/settings';

const PROPERTIES_21 = '    java.specification.version = 21\n';
const PROPERTIES_17 = '    java.specification.version = 17\n';

describe('prepareLaunch', () => {
	it('starts the server JAR with java -jar, the VM arguments before it', async () => {
		const launch = await prepareLaunch(
			settings({ javaPath: '/jdk-21/bin/java', serverJar: '/ls/markdown-ls.jar', vmArgs: ['-Xmx1g', '-ea'] }),
			environment({ '/jdk-21/bin/java': PROPERTIES_21, '/ls/markdown-ls.jar': '' }),
		);

		assert.deepEqual(launch, {
			command: '/jdk-21/bin/java',
			args: ['-Xmx1g', '-ea', '-jar', '/ls/markdown-ls.jar'],
		});
	});

	it('starts the server with the Java found in JAVA_HOME or on the PATH if none is set', async () => {
		const launch = await prepareLaunch(
			settings({ serverJar: '/ls/markdown-ls.jar' }),
			environment({ '/jdk-21/bin/java': PROPERTIES_21, '/ls/markdown-ls.jar': '' }, { JAVA_HOME: '/jdk-21' }),
		);

		assert.deepEqual(launch, { command: '/jdk-21/bin/java', args: ['-jar', '/ls/markdown-ls.jar'] });
	});

	it('points to the setting of the JAR if none is set', async () => {
		const error = await rejection(
			prepareLaunch(settings({ javaPath: '/jdk-21/bin/java' }), environment({ '/jdk-21/bin/java': PROPERTIES_21 })),
		);

		assert.equal(error.setting, 'markdownSupport.server.jar');
		assert.match(error.message, /No JAR of the language server/);
		assert.match(error.message, /markdownSupport\.server\.jar/);
	});

	it('points to the setting of the JAR if the JAR does not exist', async () => {
		const error = await rejection(
			prepareLaunch(
				settings({ javaPath: '/jdk-21/bin/java', serverJar: '/missing.jar' }),
				environment({ '/jdk-21/bin/java': PROPERTIES_21 }),
			),
		);

		assert.equal(error.setting, 'markdownSupport.server.jar');
		assert.match(error.message, /\/missing\.jar/);
		assert.match(error.message, /does not exist/);
	});

	it('looks for Java only once the JAR is found', async () => {
		const env = environment({ '/jdk-21/bin/java': PROPERTIES_21 });

		await rejection(prepareLaunch(settings({ javaPath: '/jdk-21/bin/java', serverJar: '/missing.jar' }), env));

		assert.deepEqual(env.runs, []);
	});

	it('points to the setting of Java if no Java 21 is found', async () => {
		const error = await rejection(
			prepareLaunch(
				settings({ javaPath: '/jdk-17/bin/java', serverJar: '/ls/markdown-ls.jar' }),
				environment({ '/jdk-17/bin/java': PROPERTIES_17, '/ls/markdown-ls.jar': '' }),
			),
		);

		assert.equal(error.setting, 'markdownSupport.java.path');
		assert.match(error.message, /Java 17/);
	});

	it('passes on other failures', async () => {
		const failing = environment({ '/ls/markdown-ls.jar': '' });
		failing.isFile = async (path) => {
			if (path.endsWith('java')) {
				throw new TypeError('broken');
			}
			return true;
		};

		await assert.rejects(
			prepareLaunch(settings({ javaPath: '/jdk/bin/java', serverJar: '/ls/markdown-ls.jar' }), failing),
			TypeError,
		);
	});
});

function settings(values: Partial<Settings>): Settings {
	return { javaPath: undefined, serverJar: undefined, vmArgs: [], ...values };
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
