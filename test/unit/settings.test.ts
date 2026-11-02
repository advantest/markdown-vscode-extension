import * as assert from 'node:assert/strict';
import { readSettings, type Configuration } from '../../src/settings';

describe('readSettings', () => {
	it('reads the Java path, the server JAR and the VM arguments', () => {
		const settings = readSettings(
			configuration({
				'java.home': '/opt/jdk-21/bin/java',
				'server.jar': '/opt/markdown-ls/markdown-ls.jar',
				'server.vmArgs': ['-Xmx1g', '-Dfile.encoding=UTF-8'],
			}),
		);

		assert.deepEqual(settings, {
			javaHome: '/opt/jdk-21/bin/java',
			serverJar: '/opt/markdown-ls/markdown-ls.jar',
			vmArgs: ['-Xmx1g', '-Dfile.encoding=UTF-8'],
		});
	});

	it('takes settings that are not set as absent', () => {
		assert.deepEqual(readSettings(configuration({})), {
			javaHome: undefined,
			serverJar: undefined,
			vmArgs: [],
		});
	});

	it('takes empty and blank paths as absent', () => {
		const settings = readSettings(configuration({ 'java.home': '', 'server.jar': '   ' }));

		assert.equal(settings.javaHome, undefined);
		assert.equal(settings.serverJar, undefined);
	});

	it('trims the paths', () => {
		const settings = readSettings(configuration({ 'java.home': ' /bin/java\t', 'server.jar': '\n/ls.jar ' }));

		assert.equal(settings.javaHome, '/bin/java');
		assert.equal(settings.serverJar, '/ls.jar');
	});

	it('ignores values of the wrong type', () => {
		const settings = readSettings(
			configuration({ 'java.home': 21, 'server.jar': ['/ls.jar'], 'server.vmArgs': '-Xmx1g' }),
		);

		assert.deepEqual(settings, { javaHome: undefined, serverJar: undefined, vmArgs: [] });
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
