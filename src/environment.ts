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

/** The text of the view "Dependencies": the libraries, their versions aligned. */
export function dependenciesText(answer: EnvironmentAnswer): string {
	if (!('environment' in answer)) {
		return failure(answer);
	}
	const libraries = answer.environment.libraries;
	if (libraries.length === 0) {
		return 'The language server names none of the libraries it runs with.\n';
	}
	const width = Math.max(...libraries.map((library) => library.name.length));
	return [
		'The libraries the language server runs with:',
		'',
		...libraries.map((library) => `${library.name.padEnd(width)}  ${known(library.version)}`),
		'',
	].join('\n');
}

function failure(answer: { notRunning: true } | { error: string }): string {
	return 'error' in answer ? `The language server could not tell: ${answer.error}\n` : NOT_RUNNING;
}

function known(value: string | null | undefined): string {
	return value === null || value === undefined || value.trim() === '' ? 'unknown' : value;
}
