import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';

/** Just as much of an element as the zoom script uses. */
class FakeElement {
	readonly style: Record<string, string | number> = {};
	readonly classes = new Set<string>();
	readonly classList = {
		contains: (name: string) => this.classes.has(name),
		add: (name: string) => this.classes.add(name),
		remove: (name: string) => this.classes.delete(name),
	};
	readonly listeners = new Map<string, (event: unknown) => void>();
	onwheel?: (event: unknown) => void;
	onmousedown?: (event: unknown) => void;
	onmouseup?: (event: unknown) => void;
	onmousemove?: (event: unknown) => void;
	onmouseenter?: (event: unknown) => void;
	onmouseleave?: (event: unknown) => void;

	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.set(type, listener);
	}

	getBoundingClientRect(): { left: number; top: number } {
		return { left: 0, top: 0 };
	}
}

function event(properties: Record<string, unknown> = {}): Record<string, unknown> {
	return { clientX: 0, clientY: 0, preventDefault: () => undefined, ...properties };
}

describe('the script of the preview that zooms and moves images', () => {
	let images: FakeElement[];
	let hint: FakeElement;
	let context: Context;
	let selectors: string[];

	beforeEach(() => {
		images = [new FakeElement(), new FakeElement()];
		hint = new FakeElement();
		selectors = [];
		const body = {
			querySelectorAll: (selector: string) => {
				selectors.push(selector);
				return images;
			},
			getElementsByTagName: () => [],
		};
		context = createContext({ document: { body, getElementById: (id: string) => (id === 'zoom-hint' ? hint : null) } });
		runInContext(readFileSync('media/zoom.js', 'utf8'), context);
		runInContext('refreshImages()', context);
	});

	it('handles figures and the images outside of figures, as FluentMark does', () => {
		assert.deepEqual(selectors, ['figure, :not(figure) > img']);
	});

	it('resets the images it finds', () => {
		for (const image of images) {
			assert.equal(image.style.transform, 'translate(0px, 0px) scale(1)');
		}
	});

	it('zooms an image with Alt and the mouse wheel', () => {
		images[0].onwheel?.(event({ altKey: true, deltaY: -1 }));
		assert.equal(images[0].style.transform, 'translate(0px, 0px) scale(1.01)');
		assert.equal(images[0].style.cursor, 'zoom-in');
		assert.ok(images[0].classes.has('fluentmark_zoom'));
		assert.equal(hint.style.opacity, 0);
	});

	it('zooms out with the mouse wheel turned the other way', () => {
		images[0].onwheel?.(event({ altKey: true, deltaY: 1 }));
		assert.equal(images[0].style.transform, `translate(0px, 0px) scale(${1 / 1.01})`);
		assert.equal(images[0].style.cursor, 'zoom-out');
	});

	it('leaves the mouse wheel alone without Alt', () => {
		images[0].onwheel?.(event({ altKey: false, deltaY: -1 }));
		assert.equal(images[0].style.transform, 'translate(0px, 0px) scale(1)');
	});

	it('moves an image dragged with the mouse', () => {
		images[0].onmousedown?.(event({ clientX: 10, clientY: 10 }));
		assert.equal(images[0].style.cursor, 'grabbing');
		images[0].onmousemove?.(event({ clientX: 15, clientY: 30 }));
		assert.equal(images[0].style.transform, 'translate(5px, 20px) scale(1)');
		images[0].onmouseup?.(event());
		assert.equal(images[0].style.cursor, 'zoom-in');
	});

	it('resets all images with the right mouse button', () => {
		images[0].onwheel?.(event({ altKey: true, deltaY: -1 }));
		images[0].listeners.get('contextmenu')?.(event());
		assert.equal(images[0].style.transform, 'translate(0px, 0px) scale(1)');
		assert.ok(!images[0].classes.has('fluentmark_zoom'));
	});

	it('shows its hint while the mouse is over an image', () => {
		images[1].onmouseenter?.(event());
		assert.equal(hint.style.opacity, 1);
		images[1].onmousemove?.(event({ clientX: 40, clientY: 50 }));
		assert.deepEqual([hint.style.left, hint.style.top], ['40px', '70px']);
		images[1].onmouseleave?.(event());
		assert.equal(hint.style.opacity, 0);
	});
});
