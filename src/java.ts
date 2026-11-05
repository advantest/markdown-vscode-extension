import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

/** The oldest Java feature version the language server runs on. */
export const MINIMUM_JAVA_VERSION = 21;

const SETTING = 'markdownSupport.java.home';

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
 * A configured installation folder is the only one considered, by its `bin/java`: if it is missing or too old, that
 * is an error, since the user chose it on purpose. Without one, the Java of `JAVA_HOME` is tried, then every `java` on the `PATH` in order, and
 * the first that is new enough is taken. Neither of the two can be relied on to name a Java 21, so an older one is
 * passed over rather than reported at once.
 */
export async function findJava(configuredHome: string | undefined, environment: JavaEnvironment): Promise<Java> {
	if (configuredHome !== undefined) {
		return checkConfigured(configuredHome, environment);
	}

	const found: string[] = [];
	let nonAnsi = false;
	for (const executable of candidates(environment)) {
		if (!(await environment.isFile(executable))) {
			continue;
		}
		const output = await environment.run(executable, VERSION_ARGS).catch(() => undefined);
		const version = output === undefined ? undefined : parseJavaVersion(output);
		if (version !== undefined && version >= MINIMUM_JAVA_VERSION) {
			return { executable, version };
		}
		if (version === undefined && startsNotFromNonAnsiPath(executable, output, environment)) {
			nonAnsi = true;
			found.push(`${executable} (cannot start)`);
			continue;
		}
		found.push(`${executable} (${version === undefined ? 'version unknown' : `Java ${version}`})`);
	}

	const advice = `Set the folder of a Java ${MINIMUM_JAVA_VERSION} or newer installation in the setting ${SETTING}.`;
	if (found.length === 0) {
		throw new JavaNotFoundError(
			`No Java was found in JAVA_HOME or on the PATH. The Markdown language server needs Java ${MINIMUM_JAVA_VERSION} or newer. ${advice}`,
		);
	}
	throw new JavaNotFoundError(
		`No Java ${MINIMUM_JAVA_VERSION} or newer was found in JAVA_HOME or on the PATH, only ${found.join(', ')}. ` +
			`${nonAnsi ? NON_ANSI_EXPLANATION + ' ' : ''}${advice}`,
	);
}

async function checkConfigured(home: string, environment: JavaEnvironment): Promise<Java> {
	const { paths, name } = platformOf(environment);
	if (await environment.isFile(home)) {
		const example = /[\\/]bin[\\/]java(?:\.exe)?$/i.test(home) ? `, e.g. ${paths.dirname(paths.dirname(home))}` : '';
		throw new JavaNotFoundError(
			`In ${SETTING}, ${home} is a file, not the folder of a Java installation. Set the folder that contains bin${paths.sep}${name}${example}.`,
		);
	}
	const executable = paths.join(home, 'bin', name);
	if (!(await environment.isFile(executable))) {
		throw new JavaNotFoundError(
			`The folder ${home} set in ${SETTING} is no Java installation: ${executable} does not exist.`,
		);
	}
	const prefix = `The Java ${home} set in ${SETTING}`;
	let output: string;
	try {
		output = await environment.run(executable, VERSION_ARGS);
	} catch (error) {
		throw new JavaNotFoundError(`${prefix} could not be run: ${messageOf(error)}`);
	}
	const version = parseJavaVersion(output);
	if (version === undefined && startsNotFromNonAnsiPath(executable, output, environment)) {
		throw new JavaNotFoundError(
			`${prefix} cannot start: ${NON_ANSI_EXPLANATION} Install Java in a folder whose path holds none of them and set that folder.`,
		);
	}
	if (version === undefined) {
		throw new JavaNotFoundError(`${prefix} did not tell its version. Is it a Java executable?`);
	}
	if (version < MINIMUM_JAVA_VERSION) {
		throw new JavaNotFoundError(
			`${prefix} is Java ${version}. The Markdown language server needs Java ${MINIMUM_JAVA_VERSION} or newer.`,
		);
	}
	return { executable, version };
}

const VERSION_ARGS = ['-XshowSettings:properties', '-version'];

const NON_ANSI_EXPLANATION =
	'On Windows, Java cannot start from a folder whose path holds characters the ANSI code page cannot represent, ' +
	'e.g. Greek or Japanese ones.';

/**
 * Whether a Java on Windows failed to start because the path of its folder holds characters the ANSI code page cannot
 * represent: its launcher then cannot find its own java.dll. The code page itself is not known, so any character
 * outside ASCII in the path is taken as the cause where the launcher says so.
 */
function startsNotFromNonAnsiPath(executable: string, output: string | undefined, environment: JavaEnvironment): boolean {
	// eslint-disable-next-line no-control-regex
	return environment.platform === 'win32' && /[^\x00-\x7f]/.test(executable) && /could not find java\.dll/i.test(output ?? '');
}

/** The executables to try, in order and each once: that of `JAVA_HOME`, then those on the `PATH`. */
function candidates(environment: JavaEnvironment): string[] {
	const windows = environment.platform === 'win32';
	const { paths, name } = platformOf(environment);

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

/** The path functions and the name of the Java executable on the platform. */
function platformOf(environment: JavaEnvironment): { paths: path.PlatformPath; name: string } {
	return environment.platform === 'win32' ? { paths: path.win32, name: 'java.exe' } : { paths: path.posix, name: 'java' };
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
