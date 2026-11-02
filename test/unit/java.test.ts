import * as assert from 'node:assert/strict';
import {
	findJava,
	JavaNotFoundError,
	nodeJavaEnvironment,
	parseJavaVersion,
	type JavaEnvironment,
} from '../../src/java';

const PROPERTIES_21 = 'Property settings:\n    java.home = /jdk-21\n    java.specification.version = 21\n    java.version = 21.0.5\n';
const PROPERTIES_17 = 'Property settings:\n    java.specification.version = 17\n';
const PROPERTIES_8 = 'Property settings:\n    java.specification.version = 1.8\n';

describe('parseJavaVersion', () => {
	it('reads the feature version from java.specification.version', () => {
		assert.equal(parseJavaVersion(PROPERTIES_21), 21);
		assert.equal(parseJavaVersion('    java.specification.version = 25\r\n'), 25);
	});

	it('reads the versions before Java 9, which start with "1."', () => {
		assert.equal(parseJavaVersion(PROPERTIES_8), 8);
	});

	it('finds no version where the property is missing or not a number', () => {
		assert.equal(parseJavaVersion('Error: Could not create the Java Virtual Machine.'), undefined);
		assert.equal(parseJavaVersion('    java.specification.version = beta\n'), undefined);
		assert.equal(parseJavaVersion('    java.vm.specification.version = 21\n'), undefined);
	});
});

describe('findJava', () => {
	describe('with a configured Java installation', () => {
		it('takes its bin/java if it is a Java 21', async () => {
			const environment = fake({
				files: { '/jdk-21/bin/java': PROPERTIES_21, '/jdk-25/bin/java': '    java.specification.version = 25\n' },
				env: { JAVA_HOME: '/jdk-25' },
			});

			assert.deepEqual(await findJava('/jdk-21', environment), { executable: '/jdk-21/bin/java', version: 21 });
		});

		it('accepts the folder with a slash at its end', async () => {
			const environment = fake({ files: { '/jdk-21/bin/java': PROPERTIES_21 } });

			assert.equal((await findJava('/jdk-21/', environment)).executable, '/jdk-21/bin/java');
		});

		it('takes its bin\\java.exe on Windows', async () => {
			const environment = fake({
				platform: 'win32',
				files: { 'C:\\Program Files\\jdk-21\\bin\\java.exe': PROPERTIES_21 },
			});

			assert.equal(
				(await findJava('C:\\Program Files\\jdk-21', environment)).executable,
				'C:\\Program Files\\jdk-21\\bin\\java.exe',
			);
		});

		it('asks its Java for its properties and its version', async () => {
			const environment = fake({ files: { '/jdk-21/bin/java': PROPERTIES_21 } });

			await findJava('/jdk-21', environment);

			assert.deepEqual(environment.runs, [['/jdk-21/bin/java', '-XshowSettings:properties', '-version']]);
		});

		it('rejects a file, e.g. the Java executable itself, and names the folder to set instead', async () => {
			const environment = fake({ files: { '/jdk-21/bin/java': PROPERTIES_21 } });

			const error = await rejection(findJava('/jdk-21/bin/java', environment));

			assert.match(error.message, /markdownSupport\.java\.home/);
			assert.match(error.message, /\/jdk-21\/bin\/java is a file, not the folder of a Java installation/);
			assert.match(error.message, /e\.g\. \/jdk-21[^/]/);
			assert.deepEqual(environment.runs, []);
		});

		it('rejects a folder without bin/java, without searching elsewhere', async () => {
			const environment = fake({ files: { '/jdk-21/bin/java': PROPERTIES_21 }, env: { JAVA_HOME: '/jdk-21' } });

			const error = await rejection(findJava('/missing', environment));

			assert.match(error.message, /markdownSupport\.java\.home/);
			assert.match(error.message, /The folder \/missing set in/);
			assert.match(error.message, /no Java installation/);
			assert.match(error.message, /\/missing\/bin\/java does not exist/);
		});

		it('rejects it if it is older than Java 21, without searching elsewhere', async () => {
			const environment = fake({
				files: { '/jdk-17/bin/java': PROPERTIES_17, '/jdk-21/bin/java': PROPERTIES_21 },
				env: { JAVA_HOME: '/jdk-21' },
			});

			const error = await rejection(findJava('/jdk-17', environment));

			assert.match(error.message, /The Java \/jdk-17 set in markdownSupport\.java\.home is Java 17/);
			assert.match(error.message, /Java 21 or newer/);
		});

		it('rejects it if it tells no version', async () => {
			const environment = fake({ files: { '/not-java/bin/java': 'usage: not-java' } });

			const error = await rejection(findJava('/not-java', environment));

			assert.match(error.message, /The Java \/not-java set in markdownSupport\.java\.home/);
			assert.match(error.message, /version/);
		});

		it('rejects it if it cannot be run', async () => {
			const environment = fake({ files: { '/jdk/bin/java': failure('EACCES') } });

			const error = await rejection(findJava('/jdk', environment));

			assert.match(error.message, /The Java \/jdk set in markdownSupport\.java\.home could not be run/);
			assert.match(error.message, /EACCES/);
		});
	});
	describe('without a configured Java executable', () => {
		it('takes the Java of JAVA_HOME', async () => {
			const environment = fake({
				files: { '/jdk-21/bin/java': PROPERTIES_21, '/usr/bin/java': PROPERTIES_21 },
				env: { JAVA_HOME: '/jdk-21', PATH: '/usr/bin' },
			});

			assert.equal((await findJava(undefined, environment)).executable, '/jdk-21/bin/java');
		});

		it('takes the first Java on the PATH if JAVA_HOME is not set', async () => {
			const environment = fake({
				files: { '/opt/jdk/bin/java': PROPERTIES_21, '/usr/bin/java': PROPERTIES_21 },
				env: { PATH: '/bin:/opt/jdk/bin:/usr/bin' },
			});

			assert.equal((await findJava(undefined, environment)).executable, '/opt/jdk/bin/java');
		});

		it('passes over a Java older than Java 21 and takes the next one', async () => {
			const environment = fake({
				files: { '/jdk-17/bin/java': PROPERTIES_17, '/usr/bin/java': PROPERTIES_8, '/opt/jdk/bin/java': PROPERTIES_21 },
				env: { JAVA_HOME: '/jdk-17', PATH: '/usr/bin:/opt/jdk/bin' },
			});

			assert.deepEqual(await findJava(undefined, environment), { executable: '/opt/jdk/bin/java', version: 21 });
		});

		it('passes over a Java that cannot be run or tells no version', async () => {
			const environment = fake({
				files: { '/a/java': failure('EACCES'), '/b/java': 'garbage', '/c/java': PROPERTIES_21 },
				env: { PATH: '/a:/b:/c' },
			});

			assert.equal((await findJava(undefined, environment)).executable, '/c/java');
		});

		it('asks every executable once, even if it is found twice', async () => {
			const environment = fake({
				files: { '/jdk-17/bin/java': PROPERTIES_17 },
				env: { JAVA_HOME: '/jdk-17', PATH: '/jdk-17/bin:/jdk-17/bin' },
			});

			await rejection(findJava(undefined, environment));

			assert.equal(environment.runs.length, 1);
		});

		it('names every Java it found if none is new enough', async () => {
			const environment = fake({
				files: { '/jdk-17/bin/java': PROPERTIES_17, '/usr/bin/java': PROPERTIES_8, '/x/java': 'garbage' },
				env: { JAVA_HOME: '/jdk-17', PATH: '/usr/bin:/x' },
			});

			const error = await rejection(findJava(undefined, environment));

			assert.match(error.message, /No Java 21 or newer/);
			assert.match(error.message, /\/jdk-17\/bin\/java \(Java 17\)/);
			assert.match(error.message, /\/usr\/bin\/java \(Java 8\)/);
			assert.match(error.message, /\/x\/java \(version unknown\)/);
			assert.match(error.message, /markdownSupport\.java\.home/);
		});

		it('says so if it found no Java at all', async () => {
			const error = await rejection(findJava(undefined, fake({ env: { JAVA_HOME: '/none', PATH: '/bin' } })));

			assert.match(error.message, /No Java was found in JAVA_HOME or on the PATH/);
			assert.match(error.message, /markdownSupport\.java\.home/);
		});

		it('ignores empty entries of the PATH and an empty JAVA_HOME', async () => {
			const environment = fake({ files: { '/usr/bin/java': PROPERTIES_21 }, env: { JAVA_HOME: '', PATH: '::/usr/bin:' } });

			assert.equal((await findJava(undefined, environment)).executable, '/usr/bin/java');
			assert.deepEqual(environment.checked, ['/usr/bin/java']);
		});
	});

	describe('on Windows', () => {
		it('looks for java.exe, splits the PATH at ";" and drops quotes around its entries', async () => {
			const environment = fake({
				platform: 'win32',
				files: { 'C:\\Program Files\\jdk-21\\bin\\java.exe': PROPERTIES_21 },
				env: { PATH: 'C:\\Windows;"C:\\Program Files\\jdk-21\\bin"' },
			});

			assert.equal((await findJava(undefined, environment)).executable, 'C:\\Program Files\\jdk-21\\bin\\java.exe');
			assert.deepEqual(environment.checked, ['C:\\Windows\\java.exe', 'C:\\Program Files\\jdk-21\\bin\\java.exe']);
		});

		it('reads the environment variables whatever their case', async () => {
			const environment = fake({
				platform: 'win32',
				files: { 'C:\\jdk-21\\bin\\java.exe': PROPERTIES_21, 'C:\\jdk-25\\bin\\java.exe': PROPERTIES_21 },
				env: { Java_Home: 'C:\\jdk-21', Path: 'C:\\jdk-25\\bin' },
			});

			assert.equal((await findJava(undefined, environment)).executable, 'C:\\jdk-21\\bin\\java.exe');
		});
	});
});

describe('nodeJavaEnvironment', () => {
	let environment: JavaEnvironment;

	before(() => {
		environment = nodeJavaEnvironment();
	});

	it('describes the platform and the environment of this process', () => {
		assert.equal(environment.platform, process.platform);
		assert.equal(environment.env, process.env);
	});

	it('tells files from folders and from paths that do not exist', async () => {
		assert.equal(await environment.isFile(__filename), true);
		assert.equal(await environment.isFile(__dirname), false);
		assert.equal(await environment.isFile(`${__filename}.missing`), false);
	});

	it('returns what a process writes to standard output and standard error', async () => {
		const output = await environment.run(process.execPath, ['-e', 'console.log("out"); console.error("err")']);

		assert.match(output, /out/);
		assert.match(output, /err/);
	});

	it('returns the output of a process that exits with an error', async () => {
		const output = await environment.run(process.execPath, ['-e', 'console.error("failed"); process.exit(3)']);

		assert.match(output, /failed/);
	});

	it('fails for an executable that does not exist', async () => {
		await assert.rejects(environment.run(`${__dirname}/missing-executable`, []));
	});
});

type Outcome = string | Error;

interface FakeEnvironment extends JavaEnvironment {
	/** The executables run, each with its arguments. */
	runs: string[][];
	/** The paths asked whether they are a file. */
	checked: string[];
}

function fake(options: {
	files?: Record<string, Outcome>;
	env?: Record<string, string>;
	platform?: NodeJS.Platform;
}): FakeEnvironment {
	const files = options.files ?? {};
	const environment: FakeEnvironment = {
		platform: options.platform ?? 'linux',
		env: options.env ?? {},
		runs: [],
		checked: [],
		isFile: async (path) => {
			environment.checked.push(path);
			return path in files;
		},
		run: async (executable, args) => {
			environment.runs.push([executable, ...args]);
			const outcome = files[executable];
			if (outcome === undefined) {
				throw new Error(`spawn ${executable} ENOENT`);
			}
			if (outcome instanceof Error) {
				throw outcome;
			}
			return outcome;
		},
	};
	return environment;
}

function failure(code: string): Error {
	return new Error(`spawn ${code}`);
}

async function rejection(promise: Promise<unknown>): Promise<JavaNotFoundError> {
	try {
		await promise;
	} catch (error) {
		assert.ok(error instanceof JavaNotFoundError, `${String(error)} is a JavaNotFoundError`);
		return error;
	}
	assert.fail('no error was thrown');
}
