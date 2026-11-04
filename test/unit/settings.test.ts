import * as assert from 'node:assert/strict';
import { readSettings, type Configuration } from '../../src/settings';

describe('readSettings', () => {
	it('reads the Java path and the VM arguments', () => {
		const settings = readSettings(
			configuration({
				'java.home': '/opt/jdk-21/bin/java',
				'server.vmArgs': ['-Xmx1g', '-Dfile.encoding=UTF-8'],
			}),
		);

		assert.deepEqual(settings, {
			javaHome: '/opt/jdk-21/bin/java',
			vmArgs: ['-Xmx1g', '-Dfile.encoding=UTF-8'],
		});
	});

	it('takes settings that are not set as absent', () => {
		assert.deepEqual(readSettings(configuration({})), {
			javaHome: undefined,
			vmArgs: [],
		});
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
		const settings = readSettings(
			configuration({ 'java.home': 21, 'server.vmArgs': '-Xmx1g' }),
		);

		assert.deepEqual(settings, { javaHome: undefined, vmArgs: [] });
	});

	it('drops VM arguments that are blank or no strings', () => {
		const settings = readSettings(configuration({ 'server.vmArgs': ['-Xmx1g', '', ' ', 42, null, '-ea'] }));

		assert.deepEqual(settings.vmArgs, ['-Xmx1g', '-ea']);
	});
});

function configuration(values: Record<string, unknown>): Configuration {
	return {
		get: <T>(key: string): T | undefined => values[key] as T | undefined,
	};
}
