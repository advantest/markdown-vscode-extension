import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('The settings', () => {
	const configuration = () => vscode.workspace.getConfiguration('markdownSupport');

	for (const [key, defaultValue] of [
		['java.home', ''],
		['server.vmArgs', []],
	] as const) {
		it(`contribute markdownSupport.${key}, which only the user settings may set`, () => {
			const inspected = configuration().inspect(key);

			assert.ok(inspected, `markdownSupport.${key} is contributed`);
			assert.deepEqual(inspected.defaultValue, defaultValue);
			assert.equal(contributedProperty(key).scope, 'machine');
		});
	}

	it('contribute no setting for the JAR of the server, which comes with the extension', () => {
		assert.equal(contributedProperties()['markdownSupport.server.jar'], undefined);
		assert.equal(configuration().inspect('server.jar')?.defaultValue, undefined);
	});

	it('contribute the trace of the communication with the server, off by default', () => {
		assert.equal(configuration().inspect('trace.server')?.defaultValue, 'off');
		assert.deepEqual(contributedProperty('trace.server').enum, ['off', 'messages', 'verbose']);
	});
});

interface ContributedProperty {
	scope?: string;
	enum?: string[];
}

function contributedProperties(): Record<string, ContributedProperty | undefined> {
	const extension = vscode.extensions.getExtension('advantest.markdown-support');
	return extension?.packageJSON?.contributes?.configuration?.properties ?? {};
}

function contributedProperty(key: string): ContributedProperty {
	const property = contributedProperties()[`markdownSupport.${key}`];
	assert.ok(property, `markdownSupport.${key} is contributed in package.json`);
	return property;
}
