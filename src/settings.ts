/** The section of the extension's settings: every key below is prefixed with it. */
export const SECTION = 'markdownSupport';

/** What the reader needs of `vscode.WorkspaceConfiguration`, so that it can be tested without VS Code. */
export interface Configuration {
	get<T>(key: string): T | undefined;
}

/** The settings that decide how the language server is started. */
export interface Settings {
	/** The Java executable to run the server with, or `undefined` to search `JAVA_HOME` and the `PATH`. */
	javaPath: string | undefined;
	/** The server's JAR, started with `java -jar`, or `undefined` if none is configured. */
	serverJar: string | undefined;
	/** Options for the Java VM, passed before `-jar`. */
	vmArgs: string[];
}

/**
 * Reads the settings of the section {@link SECTION}. A value of the wrong type is ignored, as if it were not set,
 * and a blank path counts as not set.
 */
export function readSettings(configuration: Configuration): Settings {
	return {
		javaPath: path(configuration.get('java.path')),
		serverJar: path(configuration.get('server.jar')),
		vmArgs: strings(configuration.get('server.vmArgs')),
	};
}

function path(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}
