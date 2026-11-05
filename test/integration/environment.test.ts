import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

// The integration tests start no server, so the views say that it does not run.

describe('The views of what the language server runs with', () => {
	afterEach(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	for (const [command, title] of [
		['markdownSupport.environment.showPlantUml', 'PlantUML and Graphviz'],
		['markdownSupport.environment.showDependencies', 'Dependencies'],
	] as const) {
		it(`opens "${title}" read-only, saying that the server is not running`, async () => {
			await vscode.commands.executeCommand(command);

			const document = vscode.window.activeTextEditor?.document;
			assert.ok(document, 'a document is shown');
			assert.notEqual(document.uri.scheme, 'file', 'a document of no file, which cannot be saved');
			assert.equal(document.uri.path, `/${title}`);
			assert.match(document.getText(), /^The language server is not running/);
		});
	}
});
