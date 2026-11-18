/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { colorScheme } from '../../src/preview/colorScheme';

describe('colorScheme', () => {
	it('follows the colour theme with auto, with its colours in a dark one', () => {
		assert.deepEqual(colorScheme('auto', false), { scheme: 'light', themeColors: false });
		assert.deepEqual(colorScheme('auto', true), { scheme: 'dark', themeColors: true });
	});

	it('is light with light, with FluentMark colours in a dark theme as well', () => {
		assert.deepEqual(colorScheme('light', false), { scheme: 'light', themeColors: false });
		assert.deepEqual(colorScheme('light', true), { scheme: 'light', themeColors: false });
	});

	it('is dark with dark, with its own palette in a light theme', () => {
		assert.deepEqual(colorScheme('dark', false), { scheme: 'dark', themeColors: false });
		assert.deepEqual(colorScheme('dark', true), { scheme: 'dark', themeColors: true });
	});

	it('takes a value that is not set or none of the setting as auto', () => {
		assert.deepEqual(colorScheme(undefined, true), { scheme: 'dark', themeColors: true });
		assert.deepEqual(colorScheme('sepia', false), { scheme: 'light', themeColors: false });
	});
});
