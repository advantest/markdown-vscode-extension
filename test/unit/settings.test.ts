/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { initializationOptions, readSettings, type Configuration } from '../../src/settings';

describe('readSettings', () => {
	it('reads the Java path and no VM arguments', () => {
		const settings = readSettings(
			configuration({
				'java.home': '/opt/jdk-21/bin/java',
				'server.vmArgs': ['-Xmx1g', '-Dfile.encoding=UTF-8'],
			}),
		);

		assert.deepEqual(settings, { javaHome: '/opt/jdk-21/bin/java', dotExecutable: undefined });
	});

	it('takes settings that are not set as absent', () => {
		assert.deepEqual(readSettings(configuration({})), { javaHome: undefined, dotExecutable: undefined });
	});

	it('takes an empty or blank path as absent', () => {
		const settings = readSettings(configuration({ 'java.home': '   ' }));

		assert.equal(settings.javaHome, undefined);
	});

	it('trims the path', () => {
		const settings = readSettings(configuration({ 'java.home': ' /bin/java\t' }));

		assert.equal(settings.javaHome, '/bin/java');
	});

	it('ignores values of the wrong type', () => {
		const settings = readSettings(configuration({ 'java.home': 21, 'plantUml.dotExecutable': true }));

		assert.deepEqual(settings, { javaHome: undefined, dotExecutable: undefined });
	});

	it('reads the dot executable of Graphviz, trimmed', () => {
		const settings = readSettings(configuration({ 'plantUml.dotExecutable': ' /usr/bin/dot ' }));

		assert.equal(settings.dotExecutable, '/usr/bin/dot');
	});
});

describe('initializationOptions', () => {
	it('gives the server the dot executable', () => {
		assert.deepEqual(initializationOptions({ javaHome: undefined, dotExecutable: '/usr/bin/dot' }), {
			plantUml: { dotExecutable: '/usr/bin/dot' },
		});
	});

	it('gives an empty dot executable where none is set, so that the server searches for one', () => {
		assert.deepEqual(initializationOptions({ javaHome: '/jdk', dotExecutable: undefined }), {
			plantUml: { dotExecutable: '' },
		});
	});
});

function configuration(values: Record<string, unknown>): Configuration {
	return {
		get: <T>(key: string): T | undefined => values[key] as T | undefined,
	};
}
