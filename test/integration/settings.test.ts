import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('The settings', () => {
	const configuration = () => vscode.workspace.getConfiguration('markdownSupport');

	for (const [key, defaultValue] of [
		['java.home', ''],
		['server.jar', ''],
		['server.vmArgs', []],
	] as const) {
		it(`contribute markdownSupport.${key}, which only the user settings may set`, () => {
			const inspected = configuration().inspect(key);

			assert.ok(inspected, `markdownSupport.${key} is contributed`);
			assert.deepEqual(inspected.defaultValue, defaultValue);
			assert.equal(contributedProperty(key).scope, 'machine');
		});
	}

	it('contribute the trace of the communication with the server, off by default', () => {
		assert.equal(configuration().inspect('trace.server')?.defaultValue, 'off');
		assert.deepEqual(contributedProperty('trace.server').enum, ['off', 'messages', 'verbose']);
	});
});

interface ContributedProperty {
	scope?: string;
	enum?: string[];
}

function contributedProperty(key: string): ContributedProperty {
	const extension = vscode.extensions.getExtension('advantest.markdown-support');
	const properties = extension?.packageJSON?.contributes?.configuration?.properties ?? {};
	const property = properties[`markdownSupport.${key}`];
	assert.ok(property, `markdownSupport.${key} is contributed in package.json`);
	return property;
}
