/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

/** The messages between the extension and the page of the preview. */

import type { ColorScheme } from './colorScheme';

/** New content for the page: the HTML the server rendered from the given version of the document. */
export interface UpdateMessage {
	readonly type: 'update';
	/** The address of the document the HTML was rendered from. */
	readonly uri: string;
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

/** Show the given colour scheme; the page changes its colours without new content. */
export interface ColorSchemeMessage extends ColorScheme {
	readonly type: 'colorScheme';
}

export type ToPage = UpdateMessage | ScrollToMessage | ShowElementMessage | ColorSchemeMessage;

/** The page is loaded and waits for its content. */
export interface ReadyMessage {
	readonly type: 'ready';
}

/** The page shows the content of the given version, code highlighted and formulas typeset. */
export interface RenderedMessage {
	readonly type: 'rendered';
	/** The address of the document, as the update gave it. */
	readonly uri: string;
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
	/** The links of the text, not those inside figures drawn as SVG, their targets as written in the HTML. */
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
	/** The ids of the elements, which links within the page lead to. */
	readonly ids: readonly string[];
	/** The number of elements of each tag name, in lower case. */
	readonly elements: Readonly<Record<string, number>>;
	/** The texts of the figures drawn as SVG. */
	readonly figures: readonly string[];
	/** The targets of the links inside the figures drawn as SVG. */
	readonly figureLinks: readonly string[];
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
	/** The attributes `data-color-scheme` and `data-colors` of the body; null where it has none. */
	readonly colorScheme: string | null;
	readonly colors: string | null;
	/** The colours of VS Code's theme the page could take, as VS Code gives them to it; empty where it gives none. */
	readonly theme: { readonly background: string; readonly link: string };
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
