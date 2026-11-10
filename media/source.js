/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

function scrollToElement(sourceOffset, sourceLength) {
	const candidates = Array.from(document.querySelectorAll('[source-offset]'))
		.filter(el => {
			const elOffset = Number.parseInt(el.getAttribute('source-offset'), 10);
			const elLength = Number.parseInt(el.getAttribute('source-length'), 10);
			return elOffset <= sourceOffset && (sourceLength == 0 || sourceOffset + sourceLength <= elOffset + elLength);
		});

	if (candidates.length > 0) {
		candidates.sort((a, b) => {
			const offsetA = Number.parseInt(a.getAttribute('source-offset'), 10);
			const offsetB = Number.parseInt(b.getAttribute('source-offset'), 10);
											
			const lenA = Number.parseInt(a.getAttribute('source-length'), 10);
			const lenB = Number.parseInt(b.getAttribute('source-length'), 10);
			if (offsetA != offsetB) {
				return offsetB - offsetA;
			} else {
				return lenA - lenB;
			}
		});

		const element = candidates[0];

		// scroll to element
		element.scrollIntoView({behavior: 'smooth', block: 'center'});

		// highlight the element
		element.classList.add('is-highlighted');
		setTimeout(() => element.classList.remove('is-highlighted'), 2000);
	}
}

function jumpToSourceOnMouseClick(event) {
	// only listen to Ctrl + left mouse click or on MacOS Command + left mouse click
	if (event.ctrlKey || event.metaKey) {
		// do not follow a link and do not open a menu
		event.preventDefault();
		event.stopPropagation();
		
		// Find the closest DOM element with source code offset
		const target = event.target.closest('[source-offset]');
		
		// if we have an element and the Java-side function 'jumpToSource' is available...
		if (target && window.jumpToSource) {
			const offset = parseInt(target.getAttribute('source-offset'), 10);
			const length = parseInt(target.getAttribute('source-length'), 10);

			// Call the Java function registered via BrowserFunction
			window.jumpToSource(offset, length);
		}
	}
}
