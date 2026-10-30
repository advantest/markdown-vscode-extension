import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

/** The oldest Java feature version the language server runs on. */
export const MINIMUM_JAVA_VERSION = 21;

const SETTING = 'markdownSupport.java.path';

/** What the search for Java needs of the system, so that it can be tested without one. */
export interface JavaEnvironment {
	platform: NodeJS.Platform;
	env: Record<string, string | undefined>;
	/** Whether the path names an existing file. */
	isFile(path: string): Promise<boolean>;
	/**
	 * Runs the executable and returns what it wrote to standard output and standard error, whatever its exit code.
	 * Fails if it cannot be started.
	 */
	run(executable: string, args: string[]): Promise<string>;
}

/** A Java executable that is new enough to run the server. */
export interface Java {
	executable: string;
	/** The feature version, e.g. 21. */
	version: number;
}

/** No Java to run the server with was found. Its message says what was found and how to fix it. */
export class JavaNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JavaNotFoundError';
	}
}

/**
 * Reads the feature version from the output of `java -XshowSettings:properties -version`, i.e. from the property
 * `java.specification.version`: "21" up from Java 9, "1.8" before.
 */
export function parseJavaVersion(output: string): number | undefined {
	const match = /^\s*java\.specification\.version\s*=\s*(?:1\.)?(\d+)\s*$/m.exec(output);
	return match ? Number(match[1]) : undefined;
}

/**
 * Finds a Java 21 or newer to run the server with.
 *
 * A configured executable is the only one considered: if it is missing or too old, that is an error, since the user
 * chose it on purpose. Without one, the Java of `JAVA_HOME` is tried, then every `java` on the `PATH` in order, and
 * the first that is new enough is taken. Neither of the two can be relied on to name a Java 21, so an older one is
 * passed over rather than reported at once.
 */
export async function findJava(configuredPath: string | undefined, environment: JavaEnvironment): Promise<Java> {
	if (configuredPath !== undefined) {
		return checkConfigured(configuredPath, environment);
	}

	const found: string[] = [];
	for (const executable of candidates(environment)) {
		if (!(await environment.isFile(executable))) {
			continue;
		}
		const version = await versionOf(executable, environment).catch(() => undefined);
		if (version !== undefined && version >= MINIMUM_JAVA_VERSION) {
			return { executable, version };
		}
		found.push(`${executable} (${version === undefined ? 'version unknown' : `Java ${version}`})`);
	}

	const advice = `Set the path of a Java ${MINIMUM_JAVA_VERSION} or newer in the setting ${SETTING}.`;
	if (found.length === 0) {
		throw new JavaNotFoundError(
			`No Java was found in JAVA_HOME or on the PATH. The Markdown language server needs Java ${MINIMUM_JAVA_VERSION} or newer. ${advice}`,
		);
	}
	throw new JavaNotFoundError(
		`No Java ${MINIMUM_JAVA_VERSION} or newer was found in JAVA_HOME or on the PATH, only ${found.join(', ')}. ${advice}`,
	);
}

async function checkConfigured(executable: string, environment: JavaEnvironment): Promise<Java> {
	const prefix = `The Java executable ${executable} set in ${SETTING}`;
	if (!(await environment.isFile(executable))) {
		throw new JavaNotFoundError(`${prefix} does not exist.`);
	}
	let version: number | undefined;
	try {
		version = await versionOf(executable, environment);
	} catch (error) {
		throw new JavaNotFoundError(`${prefix} could not be run: ${messageOf(error)}`);
	}
	if (version === undefined) {
		throw new JavaNotFoundError(`${prefix} did not tell its version. Is it a Java executable?`);
	}
	if (version < MINIMUM_JAVA_VERSION) {
		throw new JavaNotFoundError(
			`${executable} is Java ${version}, set in ${SETTING}. The Markdown language server needs Java ${MINIMUM_JAVA_VERSION} or newer.`,
		);
	}
	return { executable, version };
}

async function versionOf(executable: string, environment: JavaEnvironment): Promise<number | undefined> {
	return parseJavaVersion(await environment.run(executable, ['-XshowSettings:properties', '-version']));
}

/** The executables to try, in order and each once: that of `JAVA_HOME`, then those on the `PATH`. */
function candidates(environment: JavaEnvironment): string[] {
	const windows = environment.platform === 'win32';
	const paths = windows ? path.win32 : path.posix;
	const name = windows ? 'java.exe' : 'java';

	const result: string[] = [];
	const javaHome = variable(environment, 'JAVA_HOME');
	if (javaHome) {
		result.push(paths.join(javaHome, 'bin', name));
	}
	for (const entry of (variable(environment, 'PATH') ?? '').split(paths.delimiter)) {
		const folder = windows ? entry.replace(/"/g, '') : entry;
		if (folder.trim() !== '') {
			result.push(paths.join(folder, name));
		}
	}
	return [...new Set(result)];
}

/** Reads an environment variable, on Windows whatever the case of its name, as Windows itself does. */
function variable(environment: JavaEnvironment, name: string): string | undefined {
	if (environment.platform !== 'win32') {
		return environment.env[name];
	}
	const key = Object.keys(environment.env).find((candidate) => candidate.toUpperCase() === name);
	return key === undefined ? undefined : environment.env[key];
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The system this extension runs on. */
export function nodeJavaEnvironment(): JavaEnvironment {
	return {
		platform: process.platform,
		env: process.env,
		isFile: async (file) => {
			try {
				return (await stat(file)).isFile();
			} catch {
				return false;
			}
		},
		run: (executable, args) =>
			new Promise((resolve, reject) => {
				execFile(executable, args, { timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
					// A process that ran and exited with an error has its say in its output; one that never started has none.
					if (error && typeof error.code === 'string') {
						reject(error);
					} else {
						resolve(`${stdout}${stderr}`);
					}
				});
			}),
	};
}
