import * as path from 'node:path';
import * as vscode from 'vscode';

/*
 * What the end-to-end tests share. They run the extension against a real language server, which needs a Java 21,
 * named by the environment variable below, and the server, fetched by "npm run fetch-server"; without them the tests
 * are skipped.
 */
export const JAVA_HOME = process.env.MARKDOWN_SUPPORT_TEST_JAVA_HOME;
/** The root of this repository, the folder of the extension under test. */
export const ROOT = path.resolve(__dirname, '..', '..', '..');
/** The server bundled with the extension under test. */
export const BUNDLED_JAR = path.join(ROOT, 'server', 'markdown-ls.jar');
export const EXTENSION_ID = 'advantest.markdown-support';
export const SKIPPED = 'Skipped: set MARKDOWN_SUPPORT_TEST_JAVA_HOME and run npm run fetch-server to run these tests.';

export const DIAGNOSTICS_TIMEOUT = 60_000;

/** The diagnostics of the source for the document, once they are as expected: by default, once there are some. */
export function diagnosticsFrom(
	source: string,
	uri: vscode.Uri,
	expected: (diagnostics: vscode.Diagnostic[]) => boolean = (diagnostics) => diagnostics.length > 0,
): Promise<vscode.Diagnostic[]> {
	const current = () => vscode.languages.getDiagnostics(uri).filter((diagnostic) => diagnostic.source === source);
	return new Promise((resolve, reject) => {
		const found = current();
		if (expected(found)) {
			resolve(found);
			return;
		}
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`no expected diagnostics from ${source} within ${DIAGNOSTICS_TIMEOUT} ms: ${JSON.stringify(current())}`));
		}, DIAGNOSTICS_TIMEOUT);
		const listener = vscode.languages.onDidChangeDiagnostics(() => {
			const diagnostics = current();
			if (expected(diagnostics)) {
				clearTimeout(timer);
				listener.dispose();
				resolve(diagnostics);
			}
		});
	});
}
