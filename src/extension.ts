import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { nodeJavaEnvironment } from './java';
import { LaunchError, prepareLaunch } from './server';
import { readSettings, SECTION } from './settings';

const CLIENT_ID = SECTION;
const NAME = 'Markdown Support';
/** The settings that change the command line of the server; the server is restarted if one of them changes. */
const LAUNCH_SETTINGS = ['java.path', 'server.jar', 'server.vmArgs'].map((key) => `${SECTION}.${key}`);

let client: LanguageClient | undefined;
let output: vscode.LogOutputChannel | undefined;
/** Starts and stops run one after the other, so that a restart never overtakes the start before it. */
let pending: Promise<void> = Promise.resolve();

export function activate(context: vscode.ExtensionContext): void {
	output = vscode.window.createOutputChannel(NAME, { log: true });
	context.subscriptions.push(
		output,
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (LAUNCH_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
				void schedule(restart);
			}
		}),
	);
	void schedule(start);
}

export function deactivate(): Promise<void> {
	return schedule(stop);
}

function schedule(step: () => Promise<void>): Promise<void> {
	pending = pending.then(step, step);
	return pending;
}

async function restart(): Promise<void> {
	await stop();
	await start();
}

async function start(): Promise<void> {
	const settings = readSettings(vscode.workspace.getConfiguration(SECTION));
	let launch;
	try {
		launch = await prepareLaunch(settings, nodeJavaEnvironment());
	} catch (error) {
		report(error);
		return;
	}
	output?.info(`Starting the language server: ${launch.command} ${launch.args.join(' ')}`);

	const serverOptions: ServerOptions = { command: launch.command, args: launch.args };
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ language: 'markdown', scheme: 'file' },
			{ language: 'markdown', scheme: 'untitled' },
		],
		outputChannel: output,
	};
	const started = new LanguageClient(CLIENT_ID, NAME, serverOptions, clientOptions);
	client = started;
	try {
		await started.start();
	} catch (error) {
		report(error);
	}
}

async function stop(): Promise<void> {
	const stopping = client;
	client = undefined;
	if (stopping === undefined) {
		return;
	}
	try {
		await stopping.stop();
	} catch (error) {
		output?.warn(`The language server did not stop cleanly: ${String(error)}`);
	}
}

function report(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	output?.error(message);
	if (error instanceof LaunchError) {
		const openSettings = 'Open Settings';
		void vscode.window.showErrorMessage(message, openSettings).then((choice) => {
			if (choice === openSettings) {
				void vscode.commands.executeCommand('workbench.action.openSettings', error.setting);
			}
		});
	} else {
		void vscode.window.showErrorMessage(`The Markdown language server could not be started: ${message}`);
	}
}
