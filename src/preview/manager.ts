import { posix } from 'node:path';
import * as vscode from 'vscode';
import type { FromPage, ToPage } from './messages';
import { previewPage } from './page';

/** The view type of the preview's webview panels. */
export const VIEW_TYPE = 'markdownSupport.preview';
/** How long the preview waits after a change before it asks for the new HTML; a save updates it at once. */
export const UPDATE_DELAY_MS = 300;

/** The HTML the server rendered from a version of the document. */
export interface RenderResult {
	readonly version: number;
	readonly html: string;
}

/** Asks the server for the HTML of an open document. */
export type Renderer = (uri: vscode.Uri) => Promise<RenderResult>;

/** A preview shows the given version of its document, code highlighted and formulas typeset. */
export interface Rendered {
	readonly uri: vscode.Uri;
	readonly version: number;
	readonly math: number;
	readonly code: number;
	readonly images: readonly string[];
}

export interface Log {
	error(message: string): void;
}

/** The preview of one Markdown document in a webview panel. */
class Preview {
	private shown: RenderResult | undefined;
	private pageReady = false;
	private timer: NodeJS.Timeout | undefined;
	private disposed = false;

	constructor(
		private readonly manager: PreviewManager,
		readonly panel: vscode.WebviewPanel,
		public uri: vscode.Uri,
	) {
		panel.webview.onDidReceiveMessage((message: FromPage) => this.receive(message));
		panel.onDidDispose(() => this.dispose());
		this.load();
	}

	/** Loads the page for the current document and asks for its HTML. */
	private load(): void {
		const webview = this.panel.webview;
		const folder = this.uri.scheme === 'file' ? vscode.Uri.joinPath(this.uri, '..') : undefined;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.manager.media,
				...(folder ? [folder] : []),
				...(vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => workspaceFolder.uri),
			],
		};
		this.panel.title = `Preview ${posix.basename(this.uri.path)}`;
		this.pageReady = false;
		this.shown = undefined;
		webview.html = previewPage({
			cspSource: webview.cspSource,
			media: webview.asWebviewUri(this.manager.media).toString(),
			base: folder ? `${webview.asWebviewUri(folder).toString()}/` : undefined,
		});
		this.update(0);
	}

	/** Asks for the HTML after the given delay; a later call replaces an earlier one that has not started. */
	update(delayMs: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.render(), delayMs);
	}

	private async render(): Promise<void> {
		const uri = this.uri;
		let result: RenderResult;
		try {
			result = await this.manager.renderer(uri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.manager.log.error(`The preview of ${uri.toString()} could not be rendered: ${message}`);
			return;
		}
		if (this.disposed || uri !== this.uri || (this.shown && result.version < this.shown.version)) {
			return;
		}
		this.shown = result;
		this.show();
	}

	private show(): void {
		if (this.pageReady && this.shown) {
			this.post({ type: 'update', version: this.shown.version, html: this.shown.html });
		}
	}

	post(message: ToPage): void {
		void this.panel.webview.postMessage(message);
	}

	private receive(message: FromPage): void {
		switch (message.type) {
			case 'ready':
				this.pageReady = true;
				this.show();
				break;
			case 'rendered':
				this.manager.rendered({
					uri: this.uri,
					version: message.version,
					math: message.math,
					code: message.code,
					images: message.images,
				});
				break;
		}
	}

	private dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
		this.manager.forget(this);
	}
}

/** Opens the previews of Markdown documents and keeps them up to date. */
export class PreviewManager implements vscode.Disposable {
	readonly media: vscode.Uri;
	private readonly previews = new Set<Preview>();
	private readonly renderedEmitter = new vscode.EventEmitter<Rendered>();
	private readonly disposables: vscode.Disposable[] = [this.renderedEmitter];

	/** Fires when a preview shows a new content, after highlight.js and MathJax ran. */
	readonly onDidRender = this.renderedEmitter.event;

	constructor(
		extensionUri: vscode.Uri,
		readonly renderer: Renderer,
		readonly log: Log,
	) {
		this.media = vscode.Uri.joinPath(extensionUri, 'dist', 'media');
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length > 0) {
					this.previewsOf(event.document.uri).forEach((preview) => preview.update(UPDATE_DELAY_MS));
				}
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				this.previewsOf(document.uri).forEach((preview) => preview.update(0));
			}),
		);
	}

	/** Opens the preview of the document, or of the active editor's, in place of the editor. */
	openPreview(uri?: vscode.Uri): void {
		const target = uri ?? activeMarkdownDocument();
		if (target) {
			this.show(target, vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active, false);
		}
	}

	/** Opens the preview of the document, or of the active editor's, beside the editor. */
	openPreviewToSide(uri?: vscode.Uri): void {
		const target = uri ?? activeMarkdownDocument();
		if (target) {
			this.show(target, vscode.ViewColumn.Beside, true);
		}
	}

	/** Shows the preview of the active editor in its place, or the source of the active preview in its place. */
	async togglePreview(): Promise<void> {
		const preview = [...this.previews].find((candidate) => candidate.panel.active);
		if (preview) {
			const document = await vscode.workspace.openTextDocument(preview.uri);
			await vscode.window.showTextDocument(document, preview.panel.viewColumn);
			return;
		}
		this.openPreview();
	}

	/** Asks for the HTML of every preview again, e.g. after the server started. */
	refreshAll(): void {
		this.previews.forEach((preview) => preview.update(0));
	}

	private show(uri: vscode.Uri, viewColumn: vscode.ViewColumn, preserveFocus: boolean): Preview {
		const existing = this.previewsOf(uri)[0];
		if (existing) {
			existing.panel.reveal(viewColumn === vscode.ViewColumn.Beside ? undefined : viewColumn, preserveFocus);
			return existing;
		}
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			'Preview',
			{ viewColumn, preserveFocus },
			{ enableScripts: true, enableFindWidget: true, retainContextWhenHidden: true },
		);
		const preview = new Preview(this, panel, uri);
		this.previews.add(preview);
		return preview;
	}

	private previewsOf(uri: vscode.Uri): Preview[] {
		return [...this.previews].filter((preview) => preview.uri.toString() === uri.toString());
	}

	/** @internal */
	rendered(rendered: Rendered): void {
		this.renderedEmitter.fire(rendered);
	}

	/** @internal */
	forget(preview: Preview): void {
		this.previews.delete(preview);
	}

	dispose(): void {
		[...this.previews].forEach((preview) => preview.panel.dispose());
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

function activeMarkdownDocument(): vscode.Uri | undefined {
	const document = vscode.window.activeTextEditor?.document;
	return document?.languageId === 'markdown' ? document.uri : undefined;
}
