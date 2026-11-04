/** The section of the extension's settings: every key below is prefixed with it. */
export const SECTION = 'markdownSupport';

/** What the reader needs of `vscode.WorkspaceConfiguration`, so that it can be tested without VS Code. */
export interface Configuration {
	get<T>(key: string): T | undefined;
}

/** The settings that decide how the language server is started. */
export interface Settings {
	/** The Java executable to run the server with, or `undefined` to search `JAVA_HOME` and the `PATH`. */
	javaHome: string | undefined;
}

/**
 * Reads the settings of the section {@link SECTION}. A value of the wrong type is ignored, as if it were not set,
 * and a blank path counts as not set.
 */
export function readSettings(configuration: Configuration): Settings {
	return {
		javaHome: path(configuration.get('java.home')),
	};
}

function path(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}
