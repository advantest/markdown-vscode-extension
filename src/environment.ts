/** A library the language server runs with. */
export interface Library {
	name: string;
	version: string;
}

/** What the language server knows of PlantUML and Graphviz. */
export interface PlantUmlEnvironment {
	version: string;
	securityProfile: string;
	urlAllowList: string[];
	/** The dot executable in effect; null or left out where none was found. */
	dotExecutable?: string | null;
	graphvizVersion?: string | null;
}

/** The answer to the server's request `markdown/environment`. */
export interface ServerEnvironment {
	/** In the order to show them. */
	libraries: Library[];
	plantUml: PlantUmlEnvironment;
}

/** The request asking the language server what it runs with. */
export const ENVIRONMENT_REQUEST = 'markdown/environment';

/** What the server told, or why it told nothing. */
export type EnvironmentAnswer = { environment: ServerEnvironment } | { notRunning: true } | { error: string };

const NOT_RUNNING =
	'The language server is not running, so it cannot tell. The output "Markdown Support" says why.\n';

/** The text of the view "PlantUML and Graphviz", laid out as FluentMark's preference page. */
export function plantUmlText(answer: EnvironmentAnswer): string {
	if (!('environment' in answer)) {
		return failure(answer);
	}
	const plantUml = answer.environment.plantUml;
	const urls = plantUml.urlAllowList.length === 0 ? ['-'] : plantUml.urlAllowList;
	return [
		`PlantUML library version: ${known(plantUml.version)}`,
		`PlantUML security profile: ${known(plantUml.securityProfile)}`,
		'PlantUML URL allowlist (for the security profile):',
		...urls.map((url) => `    ${url}`),
		`Graphviz dot executable: ${known(plantUml.dotExecutable)}`,
		`Graphviz version: ${known(plantUml.graphvizVersion)}`,
		'',
		'The setting markdownSupport.plantUml.dotExecutable names the dot executable.',
		'',
	].join('\n');
}

/** The text of the view "Dependencies": the extensions, then the libraries of the server, versions aligned per group. */
export function dependenciesText(answer: EnvironmentAnswer, extensions: readonly ExtensionVersion[]): string {
	return [
		'Extensions:',
		'',
		...aligned(extensions),
		'',
		'Libraries of the language server:',
		'',
		librariesText(answer),
	].join('\n');
}

/** An extension shown on the view "Dependencies". */
export interface ExtensionVersion {
	name: string;
	version: string;
}

/** Names an extension by the display name in its package.json, else its name, else its id. */
export function extensionVersion(packageJSON: unknown, id: string): ExtensionVersion {
	const json = (typeof packageJSON === 'object' && packageJSON !== null ? packageJSON : {}) as Record<string, unknown>;
	const text = (value: unknown): string | undefined =>
		typeof value === 'string' && value.trim() !== '' ? value : undefined;
	return {
		name: text(json.displayName) ?? text(json.name) ?? id,
		version: text(json.version) ?? 'unknown',
	};
}

function librariesText(answer: EnvironmentAnswer): string {
	if (!('environment' in answer)) {
		return failure(answer);
	}
	const libraries = answer.environment.libraries;
	if (libraries.length === 0) {
		return 'The language server names none of the libraries it runs with.\n';
	}
	return [...aligned(libraries), ''].join('\n');
}

function aligned(entries: readonly { name: string; version: string | null | undefined }[]): string[] {
	const width = Math.max(...entries.map((entry) => entry.name.length));
	return entries.map((entry) => `${entry.name.padEnd(width)}  ${known(entry.version)}`);
}

function failure(answer: { notRunning: true } | { error: string }): string {
	return 'error' in answer ? `The language server could not tell: ${answer.error}\n` : NOT_RUNNING;
}

function known(value: string | null | undefined): string {
	return value === null || value === undefined || value.trim() === '' ? 'unknown' : value;
}
