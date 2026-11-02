import { findJava, JavaNotFoundError, type JavaEnvironment } from './java';
import { SECTION, type Settings } from './settings';

/** The command line that starts the language server. */
export interface ServerLaunch {
	command: string;
	args: string[];
}

/** The server cannot be started as configured. The message says why, and the setting fixes it. */
export class LaunchError extends Error {
	constructor(
		message: string,
		/** The full key of the setting that fixes it, e.g. `markdownSupport.server.jar`. */
		readonly setting: string,
	) {
		super(message);
		this.name = 'LaunchError';
	}
}

const JAR_SETTING = `${SECTION}.server.jar`;
const JAVA_SETTING = `${SECTION}.java.home`;

/**
 * Prepares `java [VM arguments] -jar <JAR>`. The JAR is checked first, since looking for Java runs executables and
 * is in vain without a server to start.
 */
export async function prepareLaunch(settings: Settings, environment: JavaEnvironment): Promise<ServerLaunch> {
	const jar = settings.serverJar;
	if (jar === undefined) {
		throw new LaunchError(
			`No JAR of the language server is set. Set ${JAR_SETTING} to the markdown-ls.jar of markdown-ls.`,
			JAR_SETTING,
		);
	}
	if (!(await environment.isFile(jar))) {
		throw new LaunchError(`The JAR of the language server, ${jar}, does not exist. Check ${JAR_SETTING}.`, JAR_SETTING);
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
	return { command: java.executable, args: [...settings.vmArgs, '-jar', jar] };
}
