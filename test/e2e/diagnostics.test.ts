/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';
import {
	BUNDLED_JAR,
	DIAGNOSTICS_TIMEOUT,
	diagnosticsFrom,
	EXTENSION_ID,
	JAVA_HOME,
	requireJavaAndServer,
} from './support';

// Runs the extension against the language server bundled with it.

describe('the extension with the language server markdown-ls', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		requireJavaAndServer(BUNDLED_JAR);
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-'));
	});

	after(async function () {
		this.timeout(60_000);
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

	it('starts the bundled server, since no extension declares one', async () => {
		const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();

		const running = await api.runningServer();

		assert.equal(running?.path, BUNDLED_JAR);
		assert.match(running?.description ?? '', /^markdown-ls .*, bundled with the extension$/);
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
