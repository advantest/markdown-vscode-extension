/** Just as much of a clicked element as the page needs to find the link it is in. */
interface ClickedElement {
	closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Just as much of a click in the page as is needed to follow a link. */
export interface Click {
	readonly target: unknown;
	preventDefault(): void;
}

/**
 * Lets the extension open the link a click in the page is in, as the webview cannot navigate; the target as written
 * in the HTML. A click outside of a link is left alone.
 */
export function followLink(click: Click, open: (href: string) => void): void {
	const link = (click.target as ClickedElement | null)?.closest('a[href]');
	if (link) {
		click.preventDefault();
		open(link.getAttribute('href') ?? '');
	}
}
