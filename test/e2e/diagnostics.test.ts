import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/*
 * Runs the extension against the real language server. It needs the server's JAR and a Java 21, named by the
 * environment variables below; without them the tests are skipped.
 */
const SERVER_JAR = process.env.MARKDOWN_SUPPORT_TEST_SERVER_JAR;
const JAVA = process.env.MARKDOWN_SUPPORT_TEST_JAVA;

const DIAGNOSTICS_TIMEOUT = 60_000;

describe('the extension with the language server markdown-ls', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		if (!SERVER_JAR || !JAVA) {
			console.log('    Skipped: set MARKDOWN_SUPPORT_TEST_SERVER_JAR and MARKDOWN_SUPPORT_TEST_JAVA to run these tests.');
			this.skip();
		}
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-'));
	});

	after(async () => {
		const configuration = vscode.workspace.getConfiguration('markdownSupport');
		await configuration.update('server.jar', undefined, vscode.ConfigurationTarget.Global);
		await configuration.update('java.path', undefined, vscode.ConfigurationTarget.Global);
		if (directory) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('shows the diagnostics of the server once the server is configured', async () => {
		const file = path.join(directory!, 'broken-link.md');
		await writeFile(file, '# Title\n\nSee [there](#nowhere).\n');
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));

		const configuration = vscode.workspace.getConfiguration('markdownSupport');
		await configuration.update('java.path', JAVA, vscode.ConfigurationTarget.Global);
		await configuration.update('server.jar', SERVER_JAR, vscode.ConfigurationTarget.Global);

		const diagnostics = await diagnosticsFrom('markdown-ls', uri);
		assert.ok(
			diagnostics.some((diagnostic) => diagnostic.range.start.line === 2),
			`a diagnostic on the link in line 3: ${JSON.stringify(diagnostics)}`,
		);
	});
});

function diagnosticsFrom(source: string, uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
	const current = () => vscode.languages.getDiagnostics(uri).filter((diagnostic) => diagnostic.source === source);
	return new Promise((resolve, reject) => {
		const found = current();
		if (found.length > 0) {
			resolve(found);
			return;
		}
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`no diagnostics from ${source} within ${DIAGNOSTICS_TIMEOUT} ms`));
		}, DIAGNOSTICS_TIMEOUT);
		const listener = vscode.languages.onDidChangeDiagnostics(() => {
			const diagnostics = current();
			if (diagnostics.length > 0) {
				clearTimeout(timer);
				listener.dispose();
				resolve(diagnostics);
			}
		});
	});
}
