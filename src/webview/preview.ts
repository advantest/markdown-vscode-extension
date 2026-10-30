/*
 * The script of the preview page. It takes the part of FluentMark's Vue application: it puts the HTML the extension
 * sends into the page, then highlights the code with highlight.js and typesets the formulas with MathJax.
 */
import type { FromPage, ToPage } from '../preview/messages';

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
declare global {
	interface Window {
		MathJax?: MathJaxApi;
	}
}

const vscode = acquireVsCodeApi();
const app = document.getElementById('app') as HTMLElement;
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

async function refresh(version: number): Promise<void> {
	for (const block of app.querySelectorAll('pre code')) {
		hljs.highlightElement(block);
	}
	const mathJax = window.MathJax;
	if (typeof mathJax?.typeset === 'function' && typeof mathJax.typesetClear === 'function') {
		mathJax.typesetClear();
		mathJax.typeset();
	}
	await mathJaxReady;
	if (version !== shownVersion) {
		return;
	}
	vscode.postMessage({
		type: 'rendered',
		version,
		math: app.querySelectorAll('mjx-container').length,
		code: app.querySelectorAll('pre code.hljs').length,
		images: Array.from(app.querySelectorAll('img'), (image) => image.src),
	});
}

window.addEventListener('message', (event: MessageEvent<ToPage>) => {
	const message = event.data;
	switch (message.type) {
		case 'update':
			shownVersion = message.version;
			app.innerHTML = message.html;
			void refresh(message.version);
			break;
	}
});

vscode.postMessage({ type: 'ready' });
