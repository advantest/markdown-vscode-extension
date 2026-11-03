import * as assert from 'node:assert/strict';
import { followLink } from '../../src/preview/linkClick';

/** An element in the page, in a link to the given target or in none. */
function element(href: string | undefined): unknown {
	return {
		closest: (selector: string) => {
			assert.equal(selector, 'a[href]');
			return href === undefined ? null : { getAttribute: (name: string) => (name === 'href' ? href : null) };
		},
	};
}

/** Clicks the element; what happened to the click and which targets were opened. */
function click(target: unknown): { calls: string[]; opened: string[] } {
	const calls: string[] = [];
	const opened: string[] = [];
	followLink(
		{
			target,
			preventDefault: () => calls.push('preventDefault'),
			stopPropagation: () => calls.push('stopPropagation'),
		} as Parameters<typeof followLink>[0],
		(href) => opened.push(href),
	);
	return { calls, opened };
}

describe('a click in the preview', () => {
	it('lets the extension open the link it is in, as written in the HTML', () => {
		assert.deepEqual(click(element('other.md#part')).opened, ['other.md#part']);
	});

	it('keeps the webview from following the link itself', () => {
		assert.ok(click(element('https://example.com/')).calls.includes('preventDefault'));
	});

	// VS Code's own handler in the webview would otherwise open the link as well, in the system's browser.
	it("does not reach VS Code's own handler of link clicks", () => {
		assert.ok(click(element('https://example.com/')).calls.includes('stopPropagation'));
	});

	it('is left alone outside of a link', () => {
		assert.deepEqual(click(element(undefined)), { calls: [], opened: [] });
	});

	it('is left alone where it has no element', () => {
		assert.deepEqual(click(null), { calls: [], opened: [] });
	});
});
