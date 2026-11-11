/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { MarkdownSupportApi } from '../../src/extension';
import { BUNDLED_JAR, DIAGNOSTICS_TIMEOUT, EXTENSION_ID, requireJavaAndServer } from './support';

// Asks the bundled language server what it runs with.

describe('the views of what the language server markdown-ls runs with', function () {
	this.timeout(DIAGNOSTICS_TIMEOUT + 10_000);

	before(async function () {
		requireJavaAndServer(BUNDLED_JAR);
		await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Title\n' });
		const api = await vscode.extensions.getExtension<MarkdownSupportApi>(EXTENSION_ID)!.activate();
		assert.ok(await api.runningServer(), 'the server runs');
	});

	afterEach(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('shows the version of PlantUML, its security profile and what it knows of Graphviz', async () => {
		const text = await shown('markdownSupport.environment.showPlantUml');

		assert.match(text, /^PlantUML library version: \d\S*$/m);
		assert.match(text, /^PlantUML security profile: [A-Z_]+$/m);
		assert.match(text, /^PlantUML URL allowlist \(for the security profile\):\n( {4}\S+\n)+Graphviz/m);
		assert.match(text, /^Graphviz dot executable: .+$/m);
		assert.match(text, /^Graphviz version: .+$/m);
	});

	it('shows its own extension, then the libraries and their versions', async () => {
		const text = await shown('markdownSupport.environment.showDependencies');

		assert.match(
			text,
			/^Extensions:\n\nMarkdown Support +\S+\n\nLibraries of the language server:\n\n(\S+ +\S+\n)+$/,
		);
	});
});

async function shown(command: string): Promise<string> {
	await vscode.commands.executeCommand(command);
	const document = vscode.window.activeTextEditor?.document;
	assert.ok(document, 'a document is shown');
	return document.getText();
}
