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
import { DIAGNOSTICS_TIMEOUT, diagnosticsFrom, EXTENSION_ID, requireJavaAndServer } from '../e2e/support';

// Runs the extension with a copy of the bundled server, which .vscode-test.mjs puts into a folder whose name the ANSI
// code page of Windows cannot represent, e.g. Windows-1252, as the folder of a user may be named.

const JAR = process.env.MARKDOWN_SUPPORT_TEST_SERVER_JAR ?? '';

describe('the extension with its server in a folder whose name the ANSI code page cannot represent', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		requireJavaAndServer(JAR);
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-non-ansi-'));
	});

	after(async function () {
		this.timeout(60_000);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (directory) {
			await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	});

	it('starts the server and shows its diagnostics', async () => {
		assert.match(JAR, /Ελληνικά-日本語/);
		const file = path.join(directory!, 'non-ansi.md');
		await writeFile(file, '# Title\n\nSee [there](#nowhere).\n');
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();

		await diagnosticsFrom('markdown-ls', uri);

		assert.equal((await api.runningServer())?.path, JAR);
	});
});
