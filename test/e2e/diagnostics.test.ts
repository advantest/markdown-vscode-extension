import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BUNDLED_JAR, DIAGNOSTICS_TIMEOUT, diagnosticsFrom, JAVA_HOME, SKIPPED } from './support';

// Runs the extension against the language server bundled with it.

describe('the extension with the language server markdown-ls', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		if (!JAVA_HOME || !existsSync(BUNDLED_JAR)) {
			console.log(`    ${SKIPPED}`);
			this.skip();
		}
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-'));
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (directory) {
			await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	});

	it('shows the diagnostics of the server', async () => {
		const file = path.join(directory!, 'broken-link.md');
		await writeFile(file, '# Title\n\nSee [there](#nowhere).\n');
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));

		const diagnostics = await diagnosticsFrom('markdown-ls', uri);
		assert.ok(
			diagnostics.some((diagnostic) => diagnostic.range.start.line === 2),
			`a diagnostic on the link in line 3: ${JSON.stringify(diagnostics)}`,
		);
	});

	it('restarts the server when the folder of Java changes', async () => {
		const file = path.join(directory!, 'restart.md');
		await writeFile(file, '# Title\n\nSee [there](#nowhere).\n');
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		await diagnosticsFrom('markdown-ls', uri);

		// The same Java, written differently: the stopped server's diagnostics are cleared, the restarted one's come.
		await vscode.workspace
			.getConfiguration('markdownSupport')
			.update('java.home', JAVA_HOME + path.sep, vscode.ConfigurationTarget.Global);
		await diagnosticsFrom('markdown-ls', uri, (diagnostics) => diagnostics.length === 0);
		await diagnosticsFrom('markdown-ls', uri);
	});
});
