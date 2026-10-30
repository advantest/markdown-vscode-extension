import { posix } from 'node:path';
import * as vscode from 'vscode';
import { SECTION } from '../settings';
import { resolveLink } from './links';
import type { FromPage, ScrollToMessage, ShowElementMessage, ToPage } from './messages';
import { previewPage } from './page';

/** The view type of the preview's webview panels. */
export const VIEW_TYPE = 'markdownSupport.preview';
/** How long the preview waits after a change before it asks for the new HTML; a save updates it at once. */
export const UPDATE_DELAY_MS = 300;
/** The command of VS Code's integrated browser; older versions of VS Code have none. */
const INTEGRATED_BROWSER = 'workbench.action.browser.open';

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

/** A preview scrolled to an anchor, or did not find it. */
export interface Revealed {
	readonly uri: vscode.Uri;
	readonly anchor: string;
	readonly found: boolean;
}

/** A preview showed the element rendered from a part of its document, or found none; in UTF-16 code units. */
export interface ShownElement {
	readonly uri: vscode.Uri;
	readonly offset: number;
	readonly length: number;
	/** The part of the document the element shown was rendered from. */
	readonly element: { readonly offset: number; readonly length: number } | undefined;
}

export interface Log {
	error(message: string): void;
}

/** What the preview needs of VS Code's environment, to open addresses outside VS Code. */
export interface Environment {
	openExternal(uri: vscode.Uri): Thenable<boolean>;
}

type RevealMessage = ScrollToMessage | ShowElementMessage;

/** The preview of one Markdown document in a webview panel. */
class Preview {
	private shown: RenderResult | undefined;
	private pageReady = false;
	/** Whether the page shows the content of the current document. */
	private rendered = false;
	/** What to scroll to once the page shows the content of the current document. */
	private reveals: RevealMessage[] = [];
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
		this.rendered = false;
		this.shown = undefined;
		const html = previewPage({
			cspSource: webview.cspSource,
			media: webview.asWebviewUri(this.manager.media).toString(),
			base: folder ? `${webview.asWebviewUri(folder).toString()}/` : undefined,
		});
		// VS Code keeps a page whose HTML did not change, e.g. for another document in the same folder.
		if (html !== webview.html) {
			this.pageReady = false;
			webview.html = html;
		}
		this.update(0);
	}

	/** Shows another document in this preview. */
	retarget(uri: vscode.Uri): void {
		this.uri = uri;
		this.load();
	}

	/** Scrolls the page, once it shows the content of the current document. */
	reveal(message: RevealMessage): void {
		if (this.rendered) {
			this.post(message);
		} else {
			this.reveals.push(message);
		}
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
				this.rendered = true;
				this.reveals.splice(0).forEach((reveal) => this.post(reveal));
				this.manager.rendered({
					uri: this.uri,
					version: message.version,
					math: message.math,
					code: message.code,
					images: message.images,
				});
				break;
			case 'openLink':
				void this.manager.openLink(this.uri, message.href);
				break;
			case 'revealed':
				this.manager.revealed({ uri: this.uri, anchor: message.anchor, found: message.found });
				break;
			case 'jumpToSource':
				void this.manager.jumpToSource(this.uri, message.offset, message.length);
				break;
			case 'elementShown':
				this.manager.elementShown({
					uri: this.uri,
					offset: message.offset,
					length: message.length,
					element: message.element ?? undefined,
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
	private readonly revealedEmitter = new vscode.EventEmitter<Revealed>();
	private readonly shownElementEmitter = new vscode.EventEmitter<ShownElement>();
	private readonly disposables: vscode.Disposable[] = [this.renderedEmitter, this.revealedEmitter, this.shownElementEmitter];

	/** Fires when a preview shows a new content, after highlight.js and MathJax ran. */
	readonly onDidRender = this.renderedEmitter.event;
	/** Fires when a preview scrolled to an anchor, or did not find it. */
	readonly onDidReveal = this.revealedEmitter.event;
	/** Fires when a preview showed the element rendered from a part of its document, or found none. */
	readonly onDidShowElement = this.shownElementEmitter.event;

	constructor(
		extensionUri: vscode.Uri,
		readonly renderer: Renderer,
		readonly log: Log,
		private readonly environment: Environment = vscode.env,
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

	/**
	 * Follows a link in the preview of a document, as FluentMark does: an anchor scrolls the preview, a Markdown file
	 * opens in the editor and the preview, another file in its default editor, a web address in a browser.
	 */
	async openLink(documentUri: vscode.Uri, href: string): Promise<void> {
		const preview = this.previewsOf(documentUri)[0];
		const link = resolveLink(href, documentUri.toString());
		try {
			switch (link.kind) {
				case 'anchor':
					preview?.reveal({ type: 'scrollTo', anchor: link.anchor });
					break;
				case 'markdown':
					await this.openMarkdown(documentUri, vscode.Uri.parse(link.uri), link.anchor);
					break;
				case 'file':
					await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(link.uri));
					break;
				case 'web':
					await this.openWeb(link.uri);
					break;
				case 'external':
					await this.environment.openExternal(vscode.Uri.parse(link.uri));
					break;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.error(`The link ${href} could not be opened: ${message}`);
		}
	}

	private async openMarkdown(from: vscode.Uri, target: vscode.Uri, anchor: string): Promise<void> {
		const source = vscode.window.visibleTextEditors.find((editor) => same(editor.document.uri, from));
		const document = await vscode.workspace.openTextDocument(target);
		await vscode.window.showTextDocument(document, {
			viewColumn: source?.viewColumn ?? vscode.ViewColumn.Beside,
			preserveFocus: true,
		});
		const preview = this.previewsOf(target)[0] ?? this.previewsOf(from)[0];
		if (preview === undefined) {
			return;
		}
		if (!same(preview.uri, target)) {
			preview.retarget(target);
		}
		preview.panel.reveal(undefined, true);
		preview.reveal({ type: 'scrollTo', anchor });
	}

	private async openWeb(address: string): Promise<void> {
		const target = vscode.workspace.getConfiguration(SECTION).get<string>('preview.openWebLinksIn');
		if (target !== 'systemBrowser' && (await vscode.commands.getCommands(true)).includes(INTEGRATED_BROWSER)) {
			await vscode.commands.executeCommand(INTEGRATED_BROWSER, address);
		} else {
			await this.environment.openExternal(vscode.Uri.parse(address));
		}
	}

	/**
	 * Selects a part of a document in its editor, given in UTF-16 code units, as VS Code counts them too; the editor
	 * is opened where none shows the document.
	 */
	async jumpToSource(uri: vscode.Uri, offset: number, length: number): Promise<void> {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const source = vscode.window.visibleTextEditors.find((editor) => same(editor.document.uri, uri));
			const selection = new vscode.Selection(document.positionAt(offset), document.positionAt(offset + length));
			const editor = await vscode.window.showTextDocument(document, {
				viewColumn: source?.viewColumn ?? vscode.ViewColumn.Beside,
				selection,
			});
			editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.error(`The source of ${uri.toString()} could not be shown: ${message}`);
		}
	}

	/**
	 * Shows the element rendered from the selection of the active editor in the preview, scrolled into view and
	 * outlined for a moment; opens the preview beside the editor where there is none.
	 */
	showElement(): void {
		const editor = vscode.window.activeTextEditor;
		if (editor?.document.languageId !== 'markdown') {
			return;
		}
		const { document, selection } = editor;
		const offset = document.offsetAt(selection.start);
		const length = document.offsetAt(selection.end) - offset;
		const preview = this.show(document.uri, vscode.ViewColumn.Beside, true);
		preview.reveal({ type: 'showElement', offset, length });
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
		return [...this.previews].filter((preview) => same(preview.uri, uri));
	}

	/** @internal */
	rendered(rendered: Rendered): void {
		this.renderedEmitter.fire(rendered);
	}

	/** @internal */
	revealed(revealed: Revealed): void {
		this.revealedEmitter.fire(revealed);
	}

	/** @internal */
	elementShown(shown: ShownElement): void {
		this.shownElementEmitter.fire(shown);
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

function same(a: vscode.Uri, b: vscode.Uri): boolean {
	return a.toString() === b.toString();
}

function activeMarkdownDocument(): vscode.Uri | undefined {
	const document = vscode.window.activeTextEditor?.document;
	return document?.languageId === 'markdown' ? document.uri : undefined;
}
