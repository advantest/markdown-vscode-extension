import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { nodeJavaEnvironment } from './java';
import { PreviewManager, type Rendered, type RenderResult } from './preview/manager';
import { LaunchError, prepareLaunch } from './server';
import { readSettings, SECTION } from './settings';

const CLIENT_ID = SECTION;
const NAME = 'Markdown Support';
/** The settings that change the command line of the server; the server is restarted if one of them changes. */
const LAUNCH_SETTINGS = ['java.home', 'server.jar', 'server.vmArgs'].map((key) => `${SECTION}.${key}`);
/** The server's request for the HTML of an open document. */
const RENDER_HTML = 'markdown/renderHtml';

let client: LanguageClient | undefined;
let output: vscode.LogOutputChannel | undefined;
let previews: PreviewManager | undefined;
/** Starts and stops run one after the other, so that a restart never overtakes the start before it. */
let pending: Promise<void> = Promise.resolve();

/** What the extension offers other extensions, and its end-to-end tests. */
export interface MarkdownSupportApi {
	/** Fires when a preview shows a new content, after highlight.js and MathJax ran. */
	readonly onDidRenderPreview: vscode.Event<Rendered>;
}

export function activate(context: vscode.ExtensionContext): MarkdownSupportApi {
	output = vscode.window.createOutputChannel(NAME, { log: true });
	const log = output;
	previews = new PreviewManager(context.extensionUri, renderHtml, { error: (message) => log.error(message) });
	const manager = previews;
	context.subscriptions.push(
		output,
		manager,
		vscode.commands.registerCommand(`${SECTION}.preview.open`, (uri?: vscode.Uri) => manager.openPreview(uri)),
		vscode.commands.registerCommand(`${SECTION}.preview.openToSide`, (uri?: vscode.Uri) =>
			manager.openPreviewToSide(uri),
		),
		vscode.commands.registerCommand(`${SECTION}.preview.toggle`, () => manager.togglePreview()),
		vscode.commands.registerCommand(`${SECTION}.preview.showElement`, () => manager.showElement()),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (LAUNCH_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
				void schedule(restart);
			}
		}),
	);
	void schedule(start);
	return { onDidRenderPreview: manager.onDidRender };
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
		return;
	}
	previews?.refreshAll();
}

async function renderHtml(uri: vscode.Uri): Promise<RenderResult> {
	// A start or restart in progress is waited for.
	await pending;
	const running = client;
	if (running === undefined || !running.isRunning()) {
		throw new Error('the language server is not running');
	}
	// The server renders only documents open in VS Code, but a preview may outlive the editor of its document.
	await vscode.workspace.openTextDocument(uri);
	const result = await running.sendRequest<{ version: number; html: string }>(RENDER_HTML, {
		textDocument: { uri: running.code2ProtocolConverter.asUri(uri) },
	});
	return { version: result.version, html: result.html };
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
