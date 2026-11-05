import * as path from 'node:path';
import { acceptedVersion, accepts, declaringExtensions, type InstalledExtension, readDeclaration } from './declaration';
import { type ExtensionVersion, extensionVersion } from './environment';
import { findJava, JavaNotFoundError, type JavaEnvironment } from './java';
import { SECTION, type Settings } from './settings';

/** The command line that starts the language server, and the folder it is started in. */
export interface ServerLaunch {
	command: string;
	args: string[];
	cwd: string;
}

/** The JAR of the server to start, and what to call it in messages. */
export interface ServerJar {
	path: string;
	description: string;
	/** The extension that declares the server, if another one does. */
	declaredBy?: ExtensionVersion;
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

function testServerJar(extension: ExtensionInfo, env: NodeJS.ProcessEnv): string | undefined {
	const named = env[TEST_SERVER_JAR]?.trim();
	return extension.development && named ? named : undefined;
}

/** The server bundled with the extension, or, while the extension is developed or tested, the one named instead. */
export function serverJar(extension: ExtensionInfo, env: NodeJS.ProcessEnv): ServerJar {
	const named = testServerJar(extension, env);
	if (named) {
		return { path: named, description: `the server ${TEST_SERVER_JAR} names` };
	}
	const version = (extension.packageJSON as { markdownSupport?: { defaultServer?: { version?: unknown } } }).markdownSupport
		?.defaultServer?.version;
	const name = typeof version === 'string' ? `markdown-ls ${version}` : 'markdown-ls';
	return {
		path: path.join(extension.extensionPath, 'server', 'markdown-ls.jar'),
		description: `${name}, bundled with the extension`,
	};
}

/** The server to start, and why it is not the one another extension declares, if one does. */
export interface ServerChoice {
	jar: ServerJar;
	problem?: string;
}

/**
 * Chooses the server to start. While the extension is developed or tested, the server MARKDOWN_SUPPORT_TEST_SERVER_JAR
 * names comes first, and no declaration is read. Otherwise it is the server exactly one installed extension declares,
 * if that declaration is valid, its version accepted and its JAR there; the bundled server in any other case. If any
 * extension declares a server that is not chosen, the problem says why.
 */
export async function chooseServer(
	extension: ExtensionInfo,
	installed: readonly InstalledExtension[],
	env: NodeJS.ProcessEnv,
	isFile: (candidate: string) => Promise<boolean>,
): Promise<ServerChoice> {
	const own = serverJar(extension, env);
	if (testServerJar(extension, env)) {
		return { jar: own };
	}
	const declaring = declaringExtensions(installed);
	if (declaring.length === 0) {
		return { jar: own };
	}
	if (declaring.length > 1) {
		const ids = declaring.map((candidate) => candidate.id).join(', ');
		return { jar: own, problem: `several extensions declare a server, only one may: ${ids}` };
	}
	const declaration = readDeclaration(declaring[0]);
	if (typeof declaration === 'string') {
		return { jar: own, problem: declaration };
	}
	const accepted = acceptedVersion(extension.packageJSON);
	if (!accepted) {
		return {
			jar: own,
			problem: `the extension names no version of the server it bundles, so it accepts no server ${declaration.id} declares`,
		};
	}
	if (!accepts(accepted, declaration.version)) {
		return {
			jar: own,
			problem:
				`the extension ${declaration.id} declares a server with markdown-ls ${declaration.markdownLs}, ` +
				`but only markdown-ls ${accepted.major}.x from ${accepted.major}.${accepted.minor} on is accepted`,
		};
	}
	if (!(await isFile(declaration.jar))) {
		return {
			jar: own,
			problem: `the JAR ${declaration.jar}, which the extension ${declaration.id} declares, does not exist`,
		};
	}
	return {
		jar: {
			path: declaration.jar,
			description: `markdown-ls ${declaration.markdownLs}, declared by the extension ${declaration.id}`,
			declaredBy: extensionVersion(declaring[0].packageJSON, declaration.id),
		},
	};
}

/**
 * Prepares `java -jar <JAR>`, started in the folder of the JAR with its file name alone: on Windows, Java reads its
 * command line in the ANSI code page, which cannot represent every path, e.g. one through a user's folder named with
 * Greek or Japanese characters. The JAR is checked first, since looking for Java runs executables and is in vain
 * without a server to start.
 */
export async function prepareLaunch(
	jar: ServerJar,
	settings: Settings,
	environment: JavaEnvironment,
): Promise<ServerLaunch> {
	if (!(await environment.isFile(jar.path))) {
		throw new LaunchError(`The JAR ${jar.path} does not exist (${jar.description}).`);
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
	return { command: java.executable, args: ['-jar', path.basename(jar.path)], cwd: path.dirname(jar.path) };
}
