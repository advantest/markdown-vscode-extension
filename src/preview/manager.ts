/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { posix } from 'node:path';
import * as vscode from 'vscode';
import { SECTION } from '../settings';
import { type ColorScheme, colorScheme } from './colorScheme';
import { resolveLink } from './links';
import type { FromPage, PageContent, PageStyle, ScrollToMessage, ShowElementMessage, ToPage } from './messages';
import { previewPage } from './page';
import { fileSystemRoots } from './roots';

/** The view type of the preview's webview panels. */
export const VIEW_TYPE = 'markdownSupport.preview';
/** How long the preview waits after a change before it asks for the new HTML; a save updates it at once. */
export const UPDATE_DELAY_MS = 300;
/** The command of VS Code's integrated browser; older versions of VS Code have none. */
const INTEGRATED_BROWSER = 'workbench.action.browser.open';
/** The schemes of the documents the server is given, so the only ones it can render. */
const PREVIEWED_SCHEMES = ['file', 'untitled'];

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
	readonly figures: number;
	readonly images: readonly string[];
	readonly imageWidths: readonly number[];
	readonly style: PageStyle;
	readonly content: PageContent;
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
	/** The folders the page may load from. */
	private roots: vscode.Uri[] = [];
	/** The local images of the page, by their webview address, and when they were modified as it first loaded them. */
	private readonly images = new Map<string, { readonly file: vscode.Uri; readonly modified: number }>();

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
		const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => workspaceFolder.uri);
		const localFolders = [...(folder ? [folder] : []), ...workspaceFolders].filter((uri) => uri.scheme === 'file');
		this.roots = [
			this.manager.media,
			...(folder ? [folder] : []),
			...workspaceFolders,
			...fileSystemRoots(process.platform, localFolders.map((uri) => uri.fsPath)).map((root) => vscode.Uri.file(root)),
		];
		webview.options = { enableScripts: true, localResourceRoots: this.roots };
		this.panel.title = `Preview ${posix.basename(this.uri.path)}`;
		this.rendered = false;
		this.shown = undefined;
		const html = previewPage({
			cspSource: webview.cspSource,
			media: webview.asWebviewUri(this.manager.media).toString(),
			base: folder ? `${webview.asWebviewUri(folder).toString()}/` : undefined,
			colorScheme: this.manager.colorScheme(),
		});
		// VS Code keeps a page whose HTML did not change, e.g. for another document in the same folder.
		if (html !== webview.html) {
			this.pageReady = false;
			this.images.clear();
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
		const shown = this.shown;
		if (!this.pageReady || !shown) {
			return;
		}
		void this.imageStamps().then((imageStamps) => {
			if (this.pageReady && this.shown === shown && !this.disposed) {
				this.post({ type: 'update', uri: this.uri.toString(), version: shown.version, html: shown.html, imageStamps });
			}
		});
	}

	/**
	 * The stamps of the local images changed on disk since the page first loaded them. The page keeps an image it has
	 * loaded and shows it again for the same address, so FluentMark's reloadLocalImages, which leaves out web
	 * addresses as the webview's are, would not show the change.
	 */
	private async imageStamps(): Promise<[string, string][]> {
		const stamps = await Promise.all(
			Array.from(this.images, async ([address, { file, modified }]): Promise<[string, string] | undefined> => {
				const now = await modifiedAt(file);
				return now === modified ? undefined : [address, String(now)];
			}),
		);
		return stamps.filter((stamp) => stamp !== undefined);
	}

	/** Notes when the local images the page loaded for the first time were modified. */
	private async noteImages(addresses: readonly string[]): Promise<void> {
		for (const address of addresses) {
			const file = this.images.has(address) ? undefined : this.resourceOf(address);
			if (file) {
				const modified = await modifiedAt(file);
				if (!this.images.has(address)) {
					this.images.set(address, { file, modified });
				}
			}
		}
	}

	/** The file a webview address stands for, where it is in one of the folders the page may load from. */
	private resourceOf(address: string): vscode.Uri | undefined {
		try {
			// The page writes the addresses as a browser does, e.g. "file+" where VS Code writes "file%2B".
			const normalised = new URL(address).href;
			for (const root of this.roots) {
				// The address of a root of the file system ends in a slash already.
				const prefix = new URL(`${this.panel.webview.asWebviewUri(root).toString().replace(/\/$/, '')}/`).href;
				if (normalised.startsWith(prefix)) {
					const path = normalised.slice(prefix.length).replace(/[?#].*$/s, '');
					return vscode.Uri.joinPath(root, ...path.split('/').map(decodeURIComponent));
				}
			}
		} catch {
			// An address that is no URL or a path that cannot be decoded stands for no file.
		}
		return undefined;
	}

	post(message: ToPage): void {
		void this.panel.webview.postMessage(message);
	}

	private receive(message: FromPage): void {
		switch (message.type) {
			case 'ready':
				this.pageReady = true;
				// VS Code loads a hidden page again from its HTML, whose colour scheme may have changed since.
				this.post({ type: 'colorScheme', ...this.manager.colorScheme() });
				this.show();
				break;
			case 'rendered': {
				// The page may still finish the content of the document shown before, after the preview moved on.
				if (message.uri !== this.uri.toString()) {
					break;
				}
				this.rendered = true;
				this.reveals.splice(0).forEach((reveal) => this.post(reveal));
				const rendered: Rendered = {
					uri: this.uri,
					version: message.version,
					math: message.math,
					code: message.code,
					figures: message.figures,
					images: message.images,
					imageWidths: message.imageWidths,
					style: message.style,
					content: message.content,
				};
				// Reported once the images are noted, so that an image changed on disk afterwards is noted as changed.
				void this.noteImages(message.images).then(() => this.manager.rendered(rendered));
				break;
			}
			case 'openLink':
				void this.manager.openLink(this.uri, message.href);
				break;
			case 'revealed':
				this.manager.revealed({ uri: this.uri, anchor: message.anchor, found: message.found }, message.source);
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

/** Opens the preview of Markdown documents and keeps it up to date; there is at most one, showing one document. */
export class PreviewManager implements vscode.Disposable {
	readonly media: vscode.Uri;
	private readonly images: vscode.Uri;
	private preview: Preview | undefined;
	/** The anchor a link led to, whose section the editor of the anchor's document scrolls to as well. */
	private followedAnchor: { readonly uri: vscode.Uri; readonly anchor: string } | undefined;
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
		this.images = vscode.Uri.joinPath(extensionUri, 'images');
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length > 0) {
					this.previewOf(event.document.uri)?.update(UPDATE_DELAY_MS);
				}
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				this.previewOf(document.uri)?.update(0);
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => this.follow(editor?.document)),
			vscode.window.onDidChangeActiveColorTheme(() => this.showColorScheme()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(`${SECTION}.preview.colorScheme`)) {
					this.showColorScheme();
				}
			}),
		);
	}

	/** The colour scheme the setting and VS Code's colour theme give the preview. */
	colorScheme(): ColorScheme {
		const kind = vscode.window.activeColorTheme.kind;
		const darkTheme = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
		return colorScheme(vscode.workspace.getConfiguration(SECTION).get('preview.colorScheme'), darkTheme);
	}

	private showColorScheme(): void {
		this.preview?.post({ type: 'colorScheme', ...this.colorScheme() });
	}

	/**
	 * Shows the Markdown document of the active editor in the preview, unless it shows it already, so that the preview
	 * follows the editor, e.g. to another file or back with the back button.
	 */
	private follow(document: vscode.TextDocument | undefined): void {
		if (
			document?.languageId !== 'markdown' ||
			!PREVIEWED_SCHEMES.includes(document.uri.scheme) ||
			this.previewOf(document.uri)
		) {
			return;
		}
		this.preview?.retarget(document.uri);
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

	/**
	 * Follows a link in the preview of a document, as FluentMark does: an anchor scrolls the preview, a Markdown file
	 * opens in the editor and the preview, another file in its default editor, a web address in a browser.
	 */
	async openLink(documentUri: vscode.Uri, href: string): Promise<void> {
		const preview = this.previewOf(documentUri);
		const link = resolveLink(href, documentUri.toString());
		try {
			switch (link.kind) {
				case 'anchor':
					if (preview) {
						this.scrollToAnchor(preview, link.anchor);
					}
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
		const preview = this.previewOf(target) ?? this.previewOf(from);
		if (preview === undefined) {
			return;
		}
		if (!same(preview.uri, target)) {
			preview.retarget(target);
		}
		preview.panel.reveal(undefined, true);
		this.scrollToAnchor(preview, anchor);
	}

	/** Scrolls the preview to an anchor; the editor follows, once the preview found the section of the anchor. */
	private scrollToAnchor(preview: Preview, anchor: string): void {
		this.followedAnchor = anchor === '' ? undefined : { uri: preview.uri, anchor };
		preview.reveal({ type: 'scrollTo', anchor });
	}

	private async openWeb(address: string): Promise<void> {
		const target = vscode.workspace.getConfiguration(SECTION).get<string>('preview.openWebLinksIn');
		if (target !== 'systemBrowser' && (await vscode.commands.getCommands(true)).includes(INTEGRATED_BROWSER)) {
			// The first browser open whose address matches the glob pattern, as every web address does, goes to the
			// address; there is a new one only where none is open. VS Code before 1.114 ignores the pattern.
			await vscode.commands.executeCommand(INTEGRATED_BROWSER, { url: address, reuseUrlFilter: '/**' });
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

	/** Asks for the HTML of the preview again, e.g. after the server started. */
	refreshAll(): void {
		this.preview?.update(0);
	}

	/**
	 * Shows the document in the preview, in the given column or beside the editor. The one preview shows the document
	 * in place of another one; it is opened anew where there is none or where it moves to another column, as a panel
	 * revealed in another group would be opened there as an editor's preview, which the next editor opened replaces.
	 */
	private show(uri: vscode.Uri, viewColumn: vscode.ViewColumn, preserveFocus: boolean): Preview {
		const existing = this.preview;
		const column = existing ? this.placement(existing, uri, viewColumn) : viewColumn;
		if (existing && column === existing.panel.viewColumn) {
			if (!same(existing.uri, uri)) {
				existing.retarget(uri);
			}
			existing.panel.reveal(column, preserveFocus);
			return existing;
		}
		existing?.panel.dispose();
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			'Preview',
			{ viewColumn: column, preserveFocus },
			{ enableScripts: true, enableFindWidget: true, retainContextWhenHidden: true },
		);
		this.preview = new Preview(this, panel, uri);
		panel.iconPath = {
			light: vscode.Uri.joinPath(this.images, 'preview-light.svg'),
			dark: vscode.Uri.joinPath(this.images, 'preview-dark.svg'),
		};
		return this.preview;
	}

	/**
	 * Where the existing preview goes: in the given column, or beside the editor, where it stays if it is visible
	 * there already, i.e. in another column than the editor of the document, or than the active editor.
	 */
	private placement(preview: Preview, uri: vscode.Uri, viewColumn: vscode.ViewColumn): vscode.ViewColumn {
		if (viewColumn !== vscode.ViewColumn.Beside) {
			return viewColumn;
		}
		const editor =
			vscode.window.visibleTextEditors.find((candidate) => same(candidate.document.uri, uri)) ??
			vscode.window.activeTextEditor;
		const { panel } = preview;
		if (panel.visible && editor?.viewColumn !== undefined && panel.viewColumn !== editor.viewColumn) {
			return panel.viewColumn ?? viewColumn;
		}
		return vscode.ViewColumn.Beside;
	}

	/** The preview, where it shows the document. */
	private previewOf(uri: vscode.Uri): Preview | undefined {
		return this.preview && same(this.preview.uri, uri) ? this.preview : undefined;
	}

	/** @internal */
	rendered(rendered: Rendered): void {
		this.renderedEmitter.fire(rendered);
	}

	/** @internal */
	revealed(revealed: Revealed, source: { offset: number; length: number } | null): void {
		const followed = this.followedAnchor;
		if (followed && same(followed.uri, revealed.uri) && followed.anchor === revealed.anchor) {
			this.followedAnchor = undefined;
			if (revealed.found && source) {
				this.scrollEditor(revealed.uri, source.offset);
			}
		}
		this.revealedEmitter.fire(revealed);
	}

	/** Puts the cursor at an offset in the visible editor of a document and scrolls the editor to put it on top. */
	private scrollEditor(uri: vscode.Uri, offset: number): void {
		const editor = vscode.window.visibleTextEditors.find((candidate) => same(candidate.document.uri, uri));
		if (editor === undefined || Number.isNaN(offset)) {
			return;
		}
		const position = editor.document.positionAt(offset);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
	}

	/** @internal */
	elementShown(shown: ShownElement): void {
		this.shownElementEmitter.fire(shown);
	}

	/** @internal */
	forget(preview: Preview): void {
		if (this.preview === preview) {
			this.preview = undefined;
		}
	}

	dispose(): void {
		this.preview?.panel.dispose();
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

/** When a file was last modified, or -1 where it cannot be read. */
async function modifiedAt(file: vscode.Uri): Promise<number> {
	try {
		return (await vscode.workspace.fs.stat(file)).mtime;
	} catch {
		return -1;
	}
}
