/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

/** What a link in the preview leads to, as FluentMark tells its links apart. */
export type Link =
	/** An anchor in the document itself; empty for the top of it. */
	| { readonly kind: 'anchor'; readonly anchor: string }
	/** Another Markdown document, and an anchor in it, empty for none. */
	| { readonly kind: 'markdown'; readonly uri: string; readonly anchor: string }
	/** A file of another kind, for its default editor. */
	| { readonly kind: 'file'; readonly uri: string }
	/** An http or https address, for a browser. */
	| { readonly kind: 'web'; readonly uri: string }
	/** An address of another scheme, e.g. mailto, for the system. */
	| { readonly kind: 'external'; readonly uri: string }
	| { readonly kind: 'ignore' };

const IGNORED_SCHEMES = new Set(['data:', 'javascript:', 'vbscript:']);

function anchorOf(url: URL): string {
	const fragment = url.hash.substring(1);
	try {
		return decodeURIComponent(fragment);
	} catch {
		return fragment;
	}
}

function withoutHash(url: URL): string {
	const copy = new URL(url.href);
	copy.hash = '';
	return copy.href;
}

/**
 * Resolves the target of a link, as written in the HTML, against the address of the document the preview shows.
 */
export function resolveLink(href: string, documentUri: string): Link {
	if (href.trim() === '') {
		return { kind: 'ignore' };
	}
	if (href.startsWith('#')) {
		return { kind: 'anchor', anchor: anchorOf(new URL(`about:blank${href}`)) };
	}
	let url: URL;
	try {
		url = new URL(href, documentUri);
	} catch {
		// A relative link in a document without a folder, e.g. an untitled one.
		return { kind: 'ignore' };
	}
	if (IGNORED_SCHEMES.has(url.protocol)) {
		return { kind: 'ignore' };
	}
	if (url.protocol === 'http:' || url.protocol === 'https:') {
		return { kind: 'web', uri: url.href };
	}
	if (url.protocol !== 'file:') {
		return { kind: 'external', uri: url.href };
	}
	const anchor = anchorOf(url);
	const target = withoutHash(url);
	if (target === withoutHash(new URL(documentUri))) {
		return { kind: 'anchor', anchor };
	}
	if (/\.md$/i.test(url.pathname)) {
		return { kind: 'markdown', uri: target, anchor };
	}
	return { kind: 'file', uri: target };
}
