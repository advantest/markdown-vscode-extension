/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { ENVIRONMENT_REQUEST, type ExtensionVersion, extensionVersion, type ServerEnvironment } from './environment';
import {
	DEPENDENCIES_VIEW,
	ENVIRONMENT_SCHEME,
	EnvironmentViews,
	PLANTUML_VIEW,
	type ViewInput,
} from './environmentViews';
import { nodeJavaEnvironment } from './java';
import { PreviewManager, type Rendered, type RenderResult } from './preview/manager';
import { reportDeclaredServerProblem, reportStartFailure, type ReportTarget } from './report';
import {
	chooseServer,
	type ExtensionInfo,
	prepareLaunch,
	type ServerChoice,
	type ServerJar,
	startsNoServer,
	TEST_NO_SERVER,
} from './server';
import { initializationOptions, readSettings, SECTION } from './settings';

const CLIENT_ID = SECTION;
const NAME = 'Markdown Support';
/** The settings that change the command line of the server; the server is restarted if one of them changes. */
const LAUNCH_SETTINGS = [`${SECTION}.java.home`];
/** The server's request for the HTML of an open document. */
const RENDER_HTML = 'markdown/renderHtml';

let client: LanguageClient | undefined;
/** The JAR of the server that started and has not been stopped since. */
let running: ServerJar | undefined;
/**
 * The server chosen when the extension started the first one. Restarts start the same, so that a declared server is
 * never replaced, and a problem with a declaration is shown only once.
 */
let choice: Promise<ServerChoice> | undefined;
let output: vscode.LogOutputChannel | undefined;
let previews: PreviewManager | undefined;
let environmentViews: EnvironmentViews | undefined;
let extension: ExtensionInfo | undefined;
/** This extension as the view "Dependencies" names it. */
let ownExtension: ExtensionVersion = { name: NAME, version: 'unknown' };
/** Whether the tests asked for no server, so that the extension looks for no Java either. */
let noServer = false;
/** Starts and stops run one after the other, so that a restart never overtakes the start before it. */
let pending: Promise<void> = Promise.resolve();

/** What the extension offers other extensions, and its end-to-end tests. */
export interface MarkdownSupportApi {
	/** Fires when a preview shows a new content, after highlight.js and MathJax ran. */
	readonly onDidRenderPreview: vscode.Event<Rendered>;
	/** The JAR of the server that runs, once a start in progress is over; undefined if none runs. */
	runningServer(): Promise<ServerJar | undefined>;
}

export function activate(context: vscode.ExtensionContext): MarkdownSupportApi {
	extension = {
		extensionPath: context.extensionPath,
		packageJSON: context.extension.packageJSON,
		development: context.extensionMode !== vscode.ExtensionMode.Production,
	};
	ownExtension = extensionVersion(context.extension.packageJSON, context.extension.id);
	choice = undefined;
	noServer = startsNoServer(context.extensionMode === vscode.ExtensionMode.Test, process.env);
	output = vscode.window.createOutputChannel(NAME, { log: true });
	const log = output;
	previews = new PreviewManager(context.extensionUri, renderHtml, { error: (message) => log.error(message) });
	const manager = previews;
	const views = new EnvironmentViews(askEnvironment);
	environmentViews = views;
	context.subscriptions.push(
		output,
		manager,
		vscode.commands.registerCommand(`${SECTION}.preview.open`, (uri?: vscode.Uri) => manager.openPreview(uri)),
		vscode.commands.registerCommand(`${SECTION}.preview.openToSide`, (uri?: vscode.Uri) =>
			manager.openPreviewToSide(uri),
		),
		vscode.commands.registerCommand(`${SECTION}.preview.showElement`, () => manager.showElement()),
		views,
		vscode.workspace.registerTextDocumentContentProvider(ENVIRONMENT_SCHEME, views),
		vscode.commands.registerCommand(`${SECTION}.environment.showPlantUml`, () => views.show(PLANTUML_VIEW)),
		vscode.commands.registerCommand(`${SECTION}.environment.showDependencies`, () => views.show(DEPENDENCIES_VIEW)),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (LAUNCH_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
				void schedule(restart);
			}
		}),
	);
	void schedule(start);
	return {
		onDidRenderPreview: manager.onDidRender,
		runningServer: async () => {
			await pending;
			return running;
		},
	};
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
	// The views of the server that ran show what the new one runs with, or that none runs.
	environmentViews?.refreshAll();
}

async function start(): Promise<void> {
	if (noServer) {
		output?.info(`No language server is started, since ${TEST_NO_SERVER} is set.`);
		return;
	}
	const settings = readSettings(vscode.workspace.getConfiguration(SECTION));
	if (extension === undefined) {
		return;
	}
	const { jar } = await chosenServer(extension);
	let launch;
	try {
		launch = await prepareLaunch(jar, settings, nodeJavaEnvironment());
	} catch (error) {
		report(error);
		return;
	}
	output?.info(`Starting ${jar.description}: ${launch.command} ${launch.args.join(' ')} in ${launch.cwd}`);

	const serverOptions: ServerOptions = { command: launch.command, args: launch.args, options: { cwd: launch.cwd } };
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ language: 'markdown', scheme: 'file' },
			{ language: 'markdown', scheme: 'untitled' },
		],
		outputChannel: output,
		initializationOptions: initializationOptions(settings),
		// The server reads the settings it needs, e.g. the dot executable, when they change.
		synchronize: { configurationSection: SECTION },
	};
	const started = new LanguageClient(CLIENT_ID, NAME, serverOptions, clientOptions);
	client = started;
	try {
		await started.start();
	} catch (error) {
		report(error);
		return;
	}
	running = jar;
	const info = started.initializeResult?.serverInfo;
	if (info) {
		output?.info(`Started ${info.name}${info.version ? ' ' + info.version : ''}`);
	}
	previews?.refreshAll();
}

async function askEnvironment(): Promise<ViewInput> {
	// A start or restart in progress is waited for.
	await pending;
	const own = ownExtension;
	const extensions = running?.declaredBy ? [own, running.declaredBy] : [own];
	const started = client;
	if (started === undefined || !started.isRunning()) {
		return { answer: { notRunning: true }, extensions };
	}
	try {
		return { answer: { environment: await started.sendRequest<ServerEnvironment>(ENVIRONMENT_REQUEST) }, extensions };
	} catch (error) {
		return { answer: { error: error instanceof Error ? error.message : String(error) }, extensions };
	}
}

async function renderHtml(uri: vscode.Uri, darkMode: boolean): Promise<RenderResult> {
	// A start or restart in progress is waited for.
	await pending;
	const running = client;
	if (running === undefined || !running.isRunning()) {
		throw new Error('the language server is not running');
	}
	// The server renders only documents open in VS Code, but a preview may outlive the editor of its document.
	await vscode.workspace.openTextDocument(uri);
	const result = await running.sendRequest<{ version: number; html: string; darkMode?: boolean }>(RENDER_HTML, {
		textDocument: { uri: running.code2ProtocolConverter.asUri(uri) },
		darkMode,
	});
	return { version: result.version, html: result.html, darkMode: result.darkMode };
}

async function stop(): Promise<void> {
	const stopping = client;
	client = undefined;
	running = undefined;
	if (stopping === undefined) {
		return;
	}
	try {
		await stopping.stop();
	} catch (error) {
		output?.warn(`The language server did not stop cleanly: ${String(error)}`);
	}
}

/**
 * Chooses the server once: the one another installed extension declares, or the bundled one. The declarations are read
 * from all installed extensions, whether activated or not; one without code is never activated.
 */
function chosenServer(info: ExtensionInfo): Promise<ServerChoice> {
	choice ??= chooseServer(
		info,
		vscode.extensions.all.map((installed) => ({
			id: installed.id,
			extensionPath: installed.extensionPath,
			packageJSON: installed.packageJSON as unknown,
		})),
		process.env,
		nodeJavaEnvironment().isFile,
	).then((chosen) => {
		if (chosen.problem !== undefined) {
			void reportDeclaredServerProblem(chosen.problem, reportTarget());
		}
		return chosen;
	});
	return choice;
}

function report(error: unknown): void {
	void reportStartFailure(error, reportTarget());
}

function reportTarget(): ReportTarget {
	return {
		log: (message) => output?.error(message),
		showError: (message, ...actions) => vscode.window.showErrorMessage(message, ...actions),
		executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
	};
}
