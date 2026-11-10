/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { fileSystemRoots } from '../../src/preview/roots';

describe('fileSystemRoots', () => {
	it('is the root of the file system outside of Windows', () => {
		assert.deepEqual(fileSystemRoots('linux', ['/home/user/doc']), ['/']);
		assert.deepEqual(fileSystemRoots('darwin', []), ['/']);
	});

	it('is every drive on Windows, whether it exists or not', () => {
		const roots = fileSystemRoots('win32', []);

		assert.equal(roots.length, 26);
		assert.equal(roots[0], 'A:\\');
		assert.equal(roots[25], 'Z:\\');
	});

	it('adds the shares of the given paths on Windows, each once', () => {
		const roots = fileSystemRoots('win32', [
			'\\\\server\\share\\docs\\a',
			'\\\\server\\share\\pictures',
			'C:\\docs',
			'\\\\other\\data\\x',
		]);

		assert.deepEqual(roots.slice(26), ['\\\\server\\share\\', '\\\\other\\data\\']);
	});
});
