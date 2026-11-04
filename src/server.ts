import * as path from 'node:path';
import { findJava, JavaNotFoundError, type JavaEnvironment } from './java';
import { SECTION, type Settings } from './settings';

/** The command line that starts the language server. */
export interface ServerLaunch {
	command: string;
	args: string[];
}

/** The JAR of the server to start, and what to call it in messages. */
export interface ServerJar {
	path: string;
	description: string;
}

/** What {@link serverJar} needs of the extension, so that it can be tested without VS Code. */
export interface ExtensionInfo {
	extensionPath: string;
	packageJSON: unknown;
	/** Whether the extension runs from its sources or under test, not installed. */
	development: boolean;
}

/** The server cannot be started. The message says why, and the setting, if there is one, fixes it. */
export class LaunchError extends Error {
	constructor(
		message: string,
		/** The full key of the setting that fixes it, e.g. `markdownSupport.java.home`. */
		readonly setting?: string,
	) {
		super(message);
		this.name = 'LaunchError';
	}
}

const JAVA_SETTING = `${SECTION}.java.home`;
/** Names another server to start in place of the bundled one, but only while the extension is developed or tested. */
const TEST_SERVER_JAR = 'MARKDOWN_SUPPORT_TEST_SERVER_JAR';
/** Keeps the extension from starting a server, but only while it is tested, e.g. by tests that need none. */
export const TEST_NO_SERVER = 'MARKDOWN_SUPPORT_TEST_NO_SERVER';

/** Whether the tests asked for no server; `test` says whether the extension is tested at all. */
export function startsNoServer(test: boolean, env: NodeJS.ProcessEnv): boolean {
	return test && (env[TEST_NO_SERVER]?.trim() ?? '') !== '';
}

/** The server bundled with the extension, or, while the extension is developed or tested, the one named instead. */
export function serverJar(extension: ExtensionInfo, env: NodeJS.ProcessEnv): ServerJar {
	const named = env[TEST_SERVER_JAR]?.trim();
	if (extension.development && named) {
		return { path: named, description: `the server ${TEST_SERVER_JAR} names` };
	}
	const version = (extension.packageJSON as { markdownSupport?: { server?: { version?: unknown } } }).markdownSupport
		?.server?.version;
	const name = typeof version === 'string' ? `markdown-ls ${version}` : 'markdown-ls';
	return {
		path: path.join(extension.extensionPath, 'server', 'markdown-ls.jar'),
		description: `${name}, bundled with the extension`,
	};
}

/**
 * Prepares `java -jar <JAR>`. The JAR is checked first, since looking for Java runs executables and is in vain
 * without a server to start.
 */
export async function prepareLaunch(
	jar: ServerJar,
	settings: Settings,
	environment: JavaEnvironment,
): Promise<ServerLaunch> {
	if (!(await environment.isFile(jar.path))) {
		throw new LaunchError(`The JAR of ${jar.description}, does not exist: ${jar.path}`);
	}

	let java;
	try {
		java = await findJava(settings.javaHome, environment);
	} catch (error) {
		if (error instanceof JavaNotFoundError) {
			throw new LaunchError(error.message, JAVA_SETTING);
		}
		throw error;
	}
	return { command: java.executable, args: ['-jar', jar.path] };
}