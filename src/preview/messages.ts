/** The messages between the extension and the page of the preview. */

/** New content for the page: the HTML the server rendered from the given version of the document. */
export interface UpdateMessage {
	readonly type: 'update';
	readonly version: number;
	readonly html: string;
	/**
	 * The local images changed on disk since the page first loaded them: their resolved addresses and a stamp the page
	 * adds to them, so that it loads them again rather than showing what it has kept.
	 */
	readonly imageStamps: readonly (readonly [string, string])[];
}

/** Scroll to an anchor; an empty one stands for the top. */
export interface ScrollToMessage {
	readonly type: 'scrollTo';
	readonly anchor: string;
}

/** Show the element rendered from a part of the source, given in UTF-16 code units, as FluentMark's scrollToElement. */
export interface ShowElementMessage {
	readonly type: 'showElement';
	readonly offset: number;
	readonly length: number;
}

export type ToPage = UpdateMessage | ScrollToMessage | ShowElementMessage;

/** The page is loaded and waits for its content. */
export interface ReadyMessage {
	readonly type: 'ready';
}

/** The page shows the content of the given version, code highlighted and formulas typeset. */
export interface RenderedMessage {
	readonly type: 'rendered';
	readonly version: number;
	/** The number of typeset formulas. */
	readonly math: number;
	/** The number of highlighted code blocks. */
	readonly code: number;
	/** The number of figures drawn as SVG, as the server draws diagrams. */
	readonly figures: number;
	/** The resolved addresses of the images, without the stamps added to them. */
	readonly images: readonly string[];
	/** The natural widths of the images, once they are loaded; 0 for one that failed. */
	readonly imageWidths: readonly number[];
	/** How the page looks. */
	readonly style: PageStyle;
	/** What the page shows. */
	readonly content: PageContent;
}

/** What the page shows, as the elements and the text a reader sees. */
export interface PageContent {
	/** The text as shown, without what is hidden. */
	readonly text: string;
	/** The links, their targets as written in the HTML. */
	readonly links: readonly { readonly text: string; readonly href: string }[];
	/** The tables: the texts of their header cells and the number of their other rows. */
	readonly tables: readonly { readonly headers: readonly string[]; readonly rows: number }[];
	/** The number of code elements outside of a code block. */
	readonly inlineCode: number;
	/** The number of code blocks. */
	readonly codeBlocks: number;
	/** The number of formulas typeset in a line. */
	readonly inlineMath: number;
	/** The number of formulas typeset in display mode. */
	readonly displayMath: number;
}

/** A part of the computed style of an element. */
export interface ElementStyle {
	readonly color: string;
	readonly backgroundColor: string;
	readonly fontFamily: string;
	readonly padding: string;
	readonly maxWidth: string;
	readonly maxHeight: string;
}

/** How the page looks: the computed styles of the body and of the first element of some kinds. */
export interface PageStyle {
	/** Whether the page has the default styles VS Code puts into every webview. */
	readonly vscodeDefaults: boolean;
	readonly body: ElementStyle;
	readonly link: ElementStyle | null;
	/** Code outside of a code block. */
	readonly code: ElementStyle | null;
	readonly blockquote: ElementStyle | null;
	readonly image: ElementStyle | null;
}

/** A link was clicked; the target as written in the HTML. */
export interface OpenLinkMessage {
	readonly type: 'openLink';
	readonly href: string;
}

/** The page scrolled to an anchor, or did not find it. */
export interface RevealedMessage {
	readonly type: 'revealed';
	readonly anchor: string;
	readonly found: boolean;
	/** The part of the source the element scrolled to was rendered from, in UTF-16 code units; null for none. */
	readonly source: { readonly offset: number; readonly length: number } | null;
}

/** An element was Ctrl- or Cmd-clicked; the part of the source it was rendered from, in UTF-16 code units. */
export interface JumpToSourceMessage {
	readonly type: 'jumpToSource';
	readonly offset: number;
	readonly length: number;
}

/** The page showed the element rendered from a part of the source, or found none. */
export interface ElementShownMessage {
	readonly type: 'elementShown';
	readonly offset: number;
	readonly length: number;
	/** The part of the source the element shown was rendered from. */
	readonly element: { readonly offset: number; readonly length: number } | null;
}

export type FromPage =
	| ReadyMessage
	| RenderedMessage
	| OpenLinkMessage
	| RevealedMessage
	| JumpToSourceMessage
	| ElementShownMessage;
