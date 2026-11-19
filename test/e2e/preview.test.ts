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
import { describeRendering, RENDER_TIMEOUT, renderingOf } from '../rendering/suite';
import { BUNDLED_JAR, EXTENSION_ID, requireJavaAndServer } from './support';

// Shows the preview of a document as the language server bundled with the extension renders it.


const DOCUMENT = [
	'# Preview',
	'',
	'The formula $a^2 + b^2 = c^2$ in a line.',
	'',
	'```java',
	'class Hello {',
	'    String greeting = "Hello";',
	'}',
	'```',
	'',
	'```plantuml',
	'@startuml',
	'Alice -> Bob: Hello',
	'@enduml',
	'```',
	'',
].join('\n');

describe('the preview with the language server markdown-ls', function () {
	this.timeout(RENDER_TIMEOUT + 10_000);

	let directory: string | undefined;

	before(async function () {
		requireJavaAndServer(BUNDLED_JAR);
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-e2e-preview-'));
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (directory) {
			await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	});

	it('shows the formulas typeset, the code highlighted and the diagrams drawn', async () => {
		const file = path.join(directory!, 'preview.md');
		await writeFile(file, DOCUMENT);
		const uri = vscode.Uri.file(file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
		const extension = vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);
		const api = await extension.activate();

		const rendering = renderingOf(api, uri);
		await vscode.commands.executeCommand('markdownSupport.preview.openToSide');

		const rendered = await rendering;
		assert.equal(rendered.math, 1, 'one formula typeset');
		assert.equal(rendered.code, 1, 'one code block highlighted');
		assert.equal(rendered.figures, 1, 'one diagram drawn');
	});

	// markdown-core links text like HMR-122 to a placeholder Jira for now; it is not meant to, and once it no longer
	// does, the suite runs without ticketLink again and expects the text to stay text.
	describeRendering({ ticketLink: /^https:\/\/your\.atlassian\.net\/browse\/HMR-122$/ });
});
