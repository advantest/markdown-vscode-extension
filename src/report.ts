import { LaunchError } from './server';

/** What reporting a failure needs of VS Code, so that it can be tested without it. */
export interface ReportTarget {
	log(message: string): void;
	showError(message: string, ...actions: string[]): Thenable<string | undefined>;
	executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
}

const OPEN_SETTINGS = 'Open Settings';

/**
 * Reports that the server could not be started. A wrong setting comes with a button that opens the settings editor
 * filtered to that very setting.
 */
export async function reportStartFailure(error: unknown, target: ReportTarget): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	target.log(message);
	if (!(error instanceof LaunchError) || error.setting === undefined) {
		await target.showError(`The Markdown language server could not be started: ${message}`);
		return;
	}
	if ((await target.showError(message, OPEN_SETTINGS)) === OPEN_SETTINGS) {
		await target.executeCommand('workbench.action.openSettings', `@id:${error.setting}`);
	}
}

/** Reports why the server another extension declares is not started; the bundled one is started in its place. */
export async function reportDeclaredServerProblem(problem: string, target: ReportTarget): Promise<void> {
	target.log(problem);
	await target.showError(
		'The language server another extension declares is not started, so the features it adds are missing: ' +
			`${problem}. The server bundled with the extension is started instead.`,
	);
}
