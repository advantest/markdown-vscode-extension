/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

interface Property {
	type: string;
	pattern?: string;
	patternErrorMessage?: string;
	markdownDescription?: string;
}

const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
	contributes: { configuration: { properties: Record<string, Property> }; commands: { command: string }[] };
};
const properties = manifest.contributes.configuration.properties;

/** As the settings editor compiles a pattern. */
function matcher(pattern: string | undefined): RegExp {
	assert.ok(pattern, 'a pattern is set');
	return new RegExp(pattern, 'u');
}

describe('the settings schema', () => {
	it('has no setting for the JAR of the server, which comes with the extension', () => {
		assert.equal(properties['markdownSupport.server.jar'], undefined);
	});

	it('has no setting for VM arguments, which JAVA_TOOL_OPTIONS can give', () => {
		assert.equal(properties['markdownSupport.server.vmArgs'], undefined);
	});

	describe('markdownSupport.java.home', () => {
		const property = properties['markdownSupport.java.home'];

		it('accepts nothing or a folder', () => {
			const pattern = matcher(property.pattern);
			for (const value of [
				'',
				'/usr/lib/jvm/java-21',
				'/opt/java',
				'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot',
				'C:\\Program Files\\Java\\jdk-21\\',
				'/opt/binaries/jdk',
			]) {
				assert.match(value, pattern);
			}
		});

		it('rejects the Java executable and its bin folder', () => {
			const pattern = matcher(property.pattern);
			for (const value of [
				'/usr/lib/jvm/java-21/bin',
				'/usr/lib/jvm/java-21/bin/',
				'/usr/lib/jvm/java-21/bin/java',
				'C:\\jdk-21\\BIN\\java.exe',
				'C:\\jdk-21\\bin\\',
				'C:\\tools\\java.exe ',
			]) {
				assert.doesNotMatch(value, pattern);
			}
		});

		it('says what a valid value is, with an example', () => {
			assert.match(property.patternErrorMessage ?? '', /folder/);
			assert.match(property.markdownDescription ?? '', /e\.g\. `[^`]+`/);
		});
	});

	describe('markdownSupport.plantUml.dotExecutable', () => {
		const property = properties['markdownSupport.plantUml.dotExecutable'];

		it('links to the views of PlantUML and Graphviz and of the dependencies, by contributed commands', () => {
			const commands = new Set(manifest.contributes.commands.map((command) => command.command));
			const links = [...(property.markdownDescription ?? '').matchAll(/\]\(command:([\w.]+)\)/g)].map(
				(match) => match[1],
			);

			assert.deepEqual(links, ['markdownSupport.environment.showPlantUml', 'markdownSupport.environment.showDependencies']);
			for (const link of links) {
				assert.ok(commands.has(link), `${link} is contributed`);
			}
		});
	});
});
