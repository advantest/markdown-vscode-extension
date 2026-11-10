/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';

/** Just as much of a rendered element as the script uses. */
class FakeElement {
	readonly classes = new Set<string>();
	readonly classList = {
		add: (name: string) => this.classes.add(name),
		remove: (name: string) => this.classes.delete(name),
	};
	scrolled: unknown;

	constructor(
		readonly name: string,
		private readonly offset: number,
		private readonly length: number,
	) {}

	getAttribute(attribute: string): string | null {
		switch (attribute) {
			case 'source-offset':
				return String(this.offset);
			case 'source-length':
				return String(this.length);
			default:
				return null;
		}
	}

	scrollIntoView(options: unknown): void {
		this.scrolled = options;
	}
}

// A heading, and a paragraph with an emphasis that starts with strong text, with offsets and lengths in the source.
const heading = new FakeElement('h1', 0, 3);
const paragraph = new FakeElement('p', 5, 18);
const strong = new FakeElement('strong', 10, 8);
const emphasis = new FakeElement('em', 10, 12);

describe('the script of the preview that connects rendered elements and their source', () => {
	let context: Context;
	let timers: { callback: () => void; delay: number }[];
	let jumps: [number, number][];

	beforeEach(() => {
		timers = [];
		jumps = [];
		for (const element of [heading, paragraph, strong, emphasis]) {
			element.classes.clear();
			element.scrolled = undefined;
		}
		const window: Record<string, unknown> = {};
		context = createContext({
			window,
			document: {
				querySelectorAll: (selector: string) => {
					assert.equal(selector, '[source-offset]');
					return [heading, paragraph, emphasis, strong];
				},
			},
			setTimeout: (callback: () => void, delay: number) => timers.push({ callback, delay }),
		});
		runInContext(readFileSync('media/source.js', 'utf8'), context);
		window.jumpToSource = (offset: number, length: number) => jumps.push([offset, length]);
	});

	function showElement(offset: number, length: number): FakeElement | undefined {
		runInContext(`scrollToElement(${offset}, ${length})`, context);
		return [heading, paragraph, strong, emphasis].find((element) => element.classes.has('is-highlighted'));
	}

	describe('shows the element at a position of the source', () => {
		it('as the innermost element that starts last before the cursor', () => {
			assert.equal(showElement(12, 0), strong);
		});

		it('as the shortest one of those that start at the same offset', () => {
			assert.equal(showElement(10, 0), strong);
		});

		it('as an element that contains all of a selection', () => {
			assert.equal(showElement(12, 9), emphasis);
			assert.equal(showElement(6, 15), paragraph);
		});

		it('scrolled into the middle of the preview', () => {
			assert.deepEqual(JSON.parse(JSON.stringify(showElement(1, 0)?.scrolled)), { behavior: 'smooth', block: 'center' });
		});

		it('outlined for two seconds', () => {
			const element = showElement(1, 0);
			assert.equal(timers.length, 1);
			assert.equal(timers[0].delay, 2000);
			timers[0].callback();
			assert.ok(!element?.classes.has('is-highlighted'));
		});

		it('not at all where there is no element', () => {
			assert.equal(showElement(30, 5), undefined);
		});
	});

	describe('jumps to the source of an element clicked', () => {
		function click(modifiers: { ctrlKey?: boolean; metaKey?: boolean }, element: FakeElement | null) {
			const calls: string[] = [];
			const event = {
				...modifiers,
				target: {
					closest: (selector: string) => {
						assert.equal(selector, '[source-offset]');
						return element;
					},
				},
				preventDefault: () => calls.push('preventDefault'),
				stopPropagation: () => calls.push('stopPropagation'),
			};
			(context.jumpToSourceOnMouseClick as (event: unknown) => void)(event);
			return calls;
		}

		it('with Ctrl, instead of following a link', () => {
			assert.deepEqual(click({ ctrlKey: true }, strong), ['preventDefault', 'stopPropagation']);
			assert.deepEqual(jumps, [[10, 8]]);
		});

		it('with Cmd on macOS', () => {
			click({ metaKey: true }, paragraph);
			assert.deepEqual(jumps, [[5, 18]]);
		});

		it('not without either', () => {
			assert.deepEqual(click({}, strong), []);
			assert.deepEqual(jumps, []);
		});

		it('not where the element has no source', () => {
			click({ ctrlKey: true }, null);
			assert.deepEqual(jumps, []);
		});
	});
});
