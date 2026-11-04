import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';
import { BUNDLED_JAR, DIAGNOSTICS_TIMEOUT, diagnosticsFrom, EXTENSION_ID, JAVA_HOME, SKIPPED } from '../e2e/support';

// Runs the extension next to an extension without code, test/stubExtensions.mjs builds, that declares a server.

const STUB_ID = 'stub.declared-valid';

describe('the extension next to an extension that declares a server', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		if (!JAVA_HOME || !existsSync(BUNDLED_JAR)) {
			console.log(`    ${SKIPPED}`);
			this.skip();
		}
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-declared-'));
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (directory) {
			await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	});

	it('sees the declaration, though the declaring extension has no code and is never activated', () => {
		const stub = vscode.extensions.getExtension(STUB_ID);

		assert.ok(stub, `${STUB_ID} is installed`);
		assert.equal(stub.isActive, false);
		assert.equal(stub.packageJSON.markdownSupport.server.jar, 'server/launcher.jar');
	});

	it('starts the declared server and shows its diagnostics', async () => {
		const file = path.join(directory!, 'declared.md');
		await writeFile(file, '# Title\n\nSee [there](#nowhere).\n');
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();

		await diagnosticsFrom('markdown-ls', uri);

		const running = await api.runningServer();
		const stub = vscode.extensions.getExtension(STUB_ID)!;
		assert.equal(running?.path, path.join(stub.extensionPath, 'server', 'launcher.jar'));
		assert.match(running?.description ?? '', /, declared by the extension stub\.declared-valid$/);
	});
});
