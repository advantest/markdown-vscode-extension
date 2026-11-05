import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

// The integration tests start no server, so the views say that it does not run.

describe('The views of what the language server runs with', () => {
	afterEach(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	for (const [command, title, text] of [
		['markdownSupport.environment.showPlantUml', 'PlantUML and Graphviz', /^The language server is not running/],
		[
			'markdownSupport.environment.showDependencies',
			'Dependencies',
			/^Extensions:\n\nMarkdown Support {2}\S+\n\nLibraries of the language server:\n\nThe language server is not running/,
		],
	] as const) {
		it(`opens "${title}" read-only, saying that the server is not running`, async () => {
			await vscode.commands.executeCommand(command);

			const document = vscode.window.activeTextEditor?.document;
			assert.ok(document, 'a document is shown');
			assert.notEqual(document.uri.scheme, 'file', 'a document of no file, which cannot be saved');
			assert.equal(document.uri.path, `/${title}`);
			assert.match(document.getText(), text);
		});
	}
});
