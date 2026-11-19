/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

/*
 * The script of the preview page. It takes the part of FluentMark's Vue application: it puts the HTML the extension
 * sends into the page, then highlights the code with highlight.js, typesets the formulas with MathJax and lets the
 * images zoom. A Ctrl- or Cmd-click on an element leads to its source.
 */
import { followLink } from '../preview/linkClick';
import type { ElementStyle, FromPage, PageContent, PageStyle, StatusMessage, ToPage } from '../preview/messages';

interface VsCodeApi {
	postMessage(message: FromPage): void;
}

interface MathJaxApi {
	typesetPromise?: (elements?: Element[]) => Promise<unknown>;
	typesetClear?: (elements?: Element[]) => void;
	startup?: { promise?: Promise<unknown> };
}

declare function acquireVsCodeApi(): VsCodeApi;
declare const hljs: { highlightElement(element: Element): void };
// From source.js and zoom.js, which the page loads before this script.
declare function scrollToElement(sourceOffset: number, sourceLength: number): void;
declare function jumpToSourceOnMouseClick(event: MouseEvent): void;
declare function reloadLocalImages(): void;
declare function refreshImages(): void;
declare global {
	interface Window {
		MathJax?: MathJaxApi;
		/** Called by jumpToSourceOnMouseClick, where FluentMark called into Java. */
		jumpToSource?: (offset: number, length: number) => void;
	}
}

const vscode = acquireVsCodeApi();
// VS Code puts its own default styles, which follow its theme, into every webview; the preview looks like FluentMark's.
document.getElementById('_defaultStyles')?.remove();
const app = document.getElementById('app') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const hint = document.getElementById('jump-to-source-hint') as HTMLElement;
/** The document and the version of it the page shows. */
let shown: { readonly uri: string; readonly version: number } | undefined;
/** What the extension is doing for the page; none once new content arrived. */
let doing: StatusMessage | undefined;

/** The text that tells what the page waits for, or where nothing is to be shown, that there is nothing. */
const NOTHING = 'Open a Markdown file to be rendered.';

/**
 * Shows what the extension is doing: over the content, after a moment, so that a quick update does not flicker, or in
 * place of content the page has not; a page without content and without a rendering says that there is nothing.
 */
function showStatus(): void {
	const empty = shown === undefined;
	const lines =
		doing?.state === 'rendering'
			? [`Rendering ${doing.document}\u2026`]
			: doing?.state === 'failed'
				? [`${doing.document} could not be rendered: ${doing.reason ?? ''}`, ...(empty ? [NOTHING] : [])]
				: empty
					? [NOTHING]
					: [];
	const placement = lines.length === 0 ? null : empty ? 'placeholder' : 'banner';
	status.replaceChildren(
		...lines.map((line) => {
			const element = document.createElement('div');
			element.textContent = line;
			return element;
		}),
	);
	status.className = [placement ?? '', doing?.state === 'rendering' ? 'busy' : '', doing?.state ?? ''].join(' ').trim();
	status.hidden = placement === null;
	vscode.postMessage({ type: 'statusShown', text: lines.join('\n'), placement });
}

/** Settles once MathJax is loaded and has typeset the page it found; MathJax is loaded asynchronously. */
const mathJaxReady: Promise<unknown> = new Promise<void>((resolve) => {
	if (window.MathJax?.startup) {
		resolve();
		return;
	}
	const script = document.getElementById('MathJax-script');
	script?.addEventListener('load', () => resolve());
	script?.addEventListener('error', () => resolve());
})
	.then(() => window.MathJax?.startup?.promise)
	.catch((error: unknown) => console.error(error));

/**
 * The typesetting of the latest content, each after the one before, as MathJax requires. The promise is needed: a
 * command such as \color makes MathJax load an extension first, which the synchronous typeset cannot wait for.
 */
let typesetting: Promise<unknown> = mathJaxReady;

/** Adds the stamps to the images changed on disk; returns the addresses of all images as they were. */
function stampImages(stamps: ReadonlyMap<string, string>): string[] {
	return Array.from(app.querySelectorAll('img'), (image) => {
		const source = image.src;
		const stamp = stamps.get(source);
		if (stamp !== undefined) {
			const address = new URL(source);
			address.searchParams.set('mtime', stamp);
			image.src = address.href;
		}
		return source;
	});
}

async function refresh(content: NonNullable<typeof shown>, sources: readonly string[]): Promise<void> {
	for (const block of app.querySelectorAll('pre code')) {
		hljs.highlightElement(block);
	}
	const mathJax = window.MathJax;
	if (typeof mathJax?.typesetPromise === 'function' && typeof mathJax.typesetClear === 'function') {
		typesetting = typesetting
			.then(() => {
				mathJax.typesetClear?.();
				return mathJax.typesetPromise?.();
			})
			.catch((error: unknown) => console.error(error));
	}
	// FluentMark's updateImages: makes the new images zoomable.
	reloadLocalImages();
	refreshImages();
	const images = Array.from(app.querySelectorAll('img'));
	await Promise.all([mathJaxReady, typesetting, ...images.map(loaded)]);
	// A later update replaced the content; its own refresh reports it.
	if (content !== shown) {
		return;
	}
	vscode.postMessage({
		type: 'rendered',
		uri: content.uri,
		version: content.version,
		math: app.querySelectorAll('mjx-container').length,
		code: app.querySelectorAll('pre code.hljs').length,
		figures: app.querySelectorAll('figure > svg').length,
		images: sources,
		imageWidths: images.map((image) => image.naturalWidth),
		style: pageStyle(),
		content: pageContent(),
	});
}

function pageContent(): PageContent {
	return {
		text: app.innerText,
		links: Array.from(app.querySelectorAll<HTMLAnchorElement>('a[href]:not(svg a)'), (link) => ({
			text: link.innerText.trim(),
			href: link.getAttribute('href') ?? '',
		})),
		tables: Array.from(app.querySelectorAll('table'), (table) => ({
			headers: Array.from(table.querySelectorAll('thead th'), (cell) => (cell as HTMLElement).innerText.trim()),
			rows: table.querySelectorAll('tbody tr').length,
		})),
		inlineCode: app.querySelectorAll(':not(pre) > code').length,
		codeBlocks: app.querySelectorAll('pre > code').length,
		inlineMath: app.querySelectorAll('mjx-container:not([display="true"])').length,
		displayMath: app.querySelectorAll('mjx-container[display="true"]').length,
		ids: Array.from(app.querySelectorAll('[id]'), (element) => element.id),
		elements: Array.from(app.querySelectorAll('*')).reduce<Record<string, number>>((counts, element) => {
			const tag = element.tagName.toLowerCase();
			counts[tag] = (counts[tag] ?? 0) + 1;
			return counts;
		}, {}),
		figures: Array.from(app.querySelectorAll('figure > svg'), (svg) => svg.textContent ?? ''),
		figureLinks: Array.from(
			app.querySelectorAll('svg a'),
			(link) => link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '',
		),
	};
}

/** Settles once the image is loaded or failed to load. */
function loaded(image: HTMLImageElement): Promise<void> {
	return image.complete
		? Promise.resolve()
		: new Promise((resolve) => {
				image.addEventListener('load', () => resolve(), { once: true });
				image.addEventListener('error', () => resolve(), { once: true });
			});
}

function elementStyle(element: Element | null): ElementStyle | null {
	if (!element) {
		return null;
	}
	const style = getComputedStyle(element);
	return {
		color: style.color,
		backgroundColor: style.backgroundColor,
		fontFamily: style.fontFamily,
		padding: style.padding,
		maxWidth: style.maxWidth,
		maxHeight: style.maxHeight,
	};
}

function pageStyle(): PageStyle {
	const variables = getComputedStyle(document.documentElement);
	return {
		vscodeDefaults: document.getElementById('_defaultStyles') !== null,
		colorScheme: document.body.getAttribute('data-color-scheme'),
		colors: document.body.getAttribute('data-colors'),
		theme: {
			background: variables.getPropertyValue('--vscode-editor-background').trim(),
			link: variables.getPropertyValue('--vscode-textLink-foreground').trim(),
		},
		body: elementStyle(document.body) as ElementStyle,
		link: elementStyle(app.querySelector('a')),
		code: elementStyle(app.querySelector(':not(pre) > code')),
		blockquote: elementStyle(app.querySelector('blockquote')),
		image: elementStyle(app.querySelector('img')),
	};
}

function scrollTo(anchor: string): void {
	const target = anchor === '' ? app : (document.getElementById(anchor) ?? document.getElementsByName(anchor)[0]);
	if (anchor === '') {
		window.scrollTo(0, 0);
	} else {
		target?.scrollIntoView();
	}
	const element = anchor === '' ? null : target?.closest('[source-offset]');
	vscode.postMessage({
		type: 'revealed',
		anchor,
		found: target !== undefined && target !== null,
		source: element
			? {
					offset: Number.parseInt(element.getAttribute('source-offset') ?? '', 10),
					length: Number.parseInt(element.getAttribute('source-length') ?? '', 10),
				}
			: null,
	});
}

function showElement(offset: number, length: number): void {
	for (const element of document.querySelectorAll('.is-highlighted')) {
		element.classList.remove('is-highlighted');
	}
	scrollToElement(offset, length);
	const element = document.querySelector('.is-highlighted');
	vscode.postMessage({
		type: 'elementShown',
		offset,
		length,
		element: element && {
			offset: Number.parseInt(element.getAttribute('source-offset') ?? '', 10),
			length: Number.parseInt(element.getAttribute('source-length') ?? '', 10),
		},
	});
}

window.jumpToSource = (offset, length) => vscode.postMessage({ type: 'jumpToSource', offset, length });

// As FluentMark's Vue application did when it was mounted. The click is caught before a link would be followed.
app.addEventListener('click', jumpToSourceOnMouseClick, true);

app.addEventListener('mouseover', (event) => {
	if ((event.target as Element).closest('[source-offset]')) {
		hint.style.opacity = '1';
	}
});

app.addEventListener('mousemove', (event) => {
	if (hint.style.opacity === '1') {
		hint.style.left = `${event.clientX + 10}px`;
		hint.style.top = `${event.clientY + 2}px`;
	}
});

app.addEventListener('mouseout', (event) => {
	if ((event.target as Element).closest('[source-offset]')) {
		hint.style.opacity = '0';
	}
});

// The extension opens the links, as the webview cannot navigate.
app.addEventListener('click', (event) => followLink(event, (href) => vscode.postMessage({ type: 'openLink', href })));

window.addEventListener('message', (event: MessageEvent<ToPage>) => {
	const message = event.data;
	switch (message.type) {
		case 'update':
			shown = { uri: message.uri, version: message.version };
			app.innerHTML = message.html;
			doing = undefined;
			showStatus();
			void refresh(shown, stampImages(new Map(message.imageStamps)));
			break;
		case 'status':
			doing = message;
			showStatus();
			break;
		case 'scrollTo':
			scrollTo(message.anchor);
			break;
		case 'showElement':
			showElement(message.offset, message.length);
			break;
		case 'colorScheme':
			document.body.dataset.colorScheme = message.scheme;
			if (message.themeColors) {
				document.body.dataset.colors = 'theme';
			} else {
				delete document.body.dataset.colors;
			}
			break;
	}
});

showStatus();
vscode.postMessage({ type: 'ready' });
