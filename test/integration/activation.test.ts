import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';

const EXTENSION_ID = 'advantest.markdown-support';

describe('The extension', () => {
	it('is activated when a Markdown document is opened', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);

		await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Title\n' });

		await waitUntil(() => extension.isActive);
	});

	it('starts no server while the tests ask for none', async () => {
		const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();

		assert.equal(await api.runningServer(), undefined);
	});
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const end = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > end) {
			assert.fail(`not reached within ${timeoutMs} ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
