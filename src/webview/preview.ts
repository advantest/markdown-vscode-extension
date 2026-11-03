/*
 * The script of the preview page. It takes the part of FluentMark's Vue application: it puts the HTML the extension
 * sends into the page, then highlights the code with highlight.js, typesets the formulas with MathJax and lets the
 * images zoom. A Ctrl- or Cmd-click on an element leads to its source.
 */
import { followLink } from '../preview/linkClick';
import type { ElementStyle, FromPage, PageStyle, ToPage } from '../preview/messages';

interface VsCodeApi {
	postMessage(message: FromPage): void;
}

interface MathJaxApi {
	typeset?: () => void;
	typesetClear?: () => void;
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
const hint = document.getElementById('jump-to-source-hint') as HTMLElement;
let shownVersion: number | undefined;

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

async function refresh(version: number, sources: readonly string[]): Promise<void> {
	for (const block of app.querySelectorAll('pre code')) {
		hljs.highlightElement(block);
	}
	const mathJax = window.MathJax;
	if (typeof mathJax?.typeset === 'function' && typeof mathJax.typesetClear === 'function') {
		mathJax.typesetClear();
		mathJax.typeset();
	}
	// FluentMark's updateImages: makes the new images zoomable.
	reloadLocalImages();
	refreshImages();
	const images = Array.from(app.querySelectorAll('img'));
	await Promise.all([mathJaxReady, ...images.map(loaded)]);
	if (version !== shownVersion) {
		return;
	}
	vscode.postMessage({
		type: 'rendered',
		version,
		math: app.querySelectorAll('mjx-container').length,
		code: app.querySelectorAll('pre code.hljs').length,
		figures: app.querySelectorAll('figure > svg').length,
		images: sources,
		imageWidths: images.map((image) => image.naturalWidth),
		style: pageStyle(),
	});
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
	return {
		vscodeDefaults: document.getElementById('_defaultStyles') !== null,
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
	vscode.postMessage({ type: 'revealed', anchor, found: target !== undefined && target !== null });
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
			shownVersion = message.version;
			app.innerHTML = message.html;
			void refresh(message.version, stampImages(new Map(message.imageStamps)));
			break;
		case 'scrollTo':
			scrollTo(message.anchor);
			break;
		case 'showElement':
			showElement(message.offset, message.length);
			break;
	}
});

vscode.postMessage({ type: 'ready' });
