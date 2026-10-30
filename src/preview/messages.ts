/** The messages between the extension and the page of the preview. */

/** New content for the page: the HTML the server rendered from the given version of the document. */
export interface UpdateMessage {
	readonly type: 'update';
	readonly version: number;
	readonly html: string;
}

/** Scroll to an anchor; an empty one stands for the top. */
export interface ScrollToMessage {
	readonly type: 'scrollTo';
	readonly anchor: string;
}

export type ToPage = UpdateMessage | ScrollToMessage;

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
	/** The resolved addresses of the images. */
	readonly images: readonly string[];
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
}

export type FromPage = ReadyMessage | RenderedMessage | OpenLinkMessage | RevealedMessage;
