import * as vscode from 'vscode';
import { dependenciesText, type EnvironmentAnswer, type ExtensionVersion, plantUmlText } from './environment';

/** The scheme of the read-only documents that show what the language server runs with. */
export const ENVIRONMENT_SCHEME = 'markdown-support-info';

/** What a view shows: the server's answer, and the extensions whose server runs. */
export interface ViewInput {
	answer: EnvironmentAnswer;
	extensions: ExtensionVersion[];
}

const VIEWS: Record<string, (input: ViewInput) => string> = {
	'/PlantUML and Graphviz': (input) => plantUmlText(input.answer),
	'/Dependencies': (input) => dependenciesText(input.answer, input.extensions),
};

export const PLANTUML_VIEW = vscode.Uri.from({ scheme: ENVIRONMENT_SCHEME, path: '/PlantUML and Graphviz' });
export const DEPENDENCIES_VIEW = vscode.Uri.from({ scheme: ENVIRONMENT_SCHEME, path: '/Dependencies' });

/**
 * Provides the views of what the language server runs with. Their text is asked from the server each time a view is
 * opened or refreshed, so that it is never older than the server.
 */
export class EnvironmentViews implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly changes = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changes.event;

	constructor(private readonly ask: () => Promise<ViewInput>) {}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const view = VIEWS[uri.path];
		return view === undefined ? '' : view(await this.ask());
	}

	/** Opens the view, asking the server again where it is open already. */
	async show(uri: vscode.Uri): Promise<void> {
		this.refresh(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: false });
	}

	/** Asks the server again for the views that are open. */
	refreshAll(): void {
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.scheme === ENVIRONMENT_SCHEME) {
				this.refresh(document.uri);
			}
		}
	}

	private refresh(uri: vscode.Uri): void {
		if (vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri.toString())) {
			this.changes.fire(uri);
		}
	}

	dispose(): void {
		this.changes.dispose();
	}
}
