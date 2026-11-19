/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PreviewManager, type Rendered, type ShownElement } from '../../src/preview/manager';

const EXTENSION_ID = 'advantest.markdown-support';
const SHOW_ELEMENT = 'markdownSupport.preview.showElement';
const TIMEOUT = 15_000;

/** Line ends of Windows and a character outside of the BMP, which counts as two UTF-16 code units. */
const SOURCE = '# Title\r\n\r\n😀 text **bold** end\r\n';
const BOLD = SOURCE.indexOf('**bold**');
const PARAGRAPH = SOURCE.indexOf('😀');
/** What the server renders from SOURCE, offsets and lengths in UTF-16 code units. */
const HTML =
	'<h1 source-offset="0" source-length="7">Title</h1>' +
	`<p source-offset="${PARAGRAPH}" source-length="20">😀 text ` +
	`<strong source-offset="${BOLD}" source-length="8">bold</strong> end</p>`;

describe('the connection between the preview and the source', () => {
	let directory: string;
	let manager: PreviewManager;

	before(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-source-'));
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} is installed`);
		manager = new PreviewManager(
			extension.extensionUri,
			async (uri) => ({ version: (await vscode.workspace.openTextDocument(uri)).version, html: HTML }),
			{ error: (message) => assert.fail(message) },
		);
	});

	afterEach(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	after(async () => {
		manager.dispose();
		await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	});

	async function showDocument(name: string): Promise<vscode.TextEditor> {
		const location = path.join(directory, name);
		await writeFile(location, SOURCE);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location));
		return vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	}

	async function openPreviewToSide(uri: vscode.Uri): Promise<void> {
		const rendering = next(manager.onDidRender, (rendered: Rendered) => same(rendered.uri, uri));
		manager.openPreviewToSide(uri);
		await rendering;
	}

	it('selects the source of a rendered element, counted in UTF-16 code units', async () => {
		const { document } = await showDocument('jump.md');
		await openPreviewToSide(document.uri);

		await manager.jumpToSource(document.uri, BOLD, 8);

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor && same(editor.document.uri, document.uri), 'the source is the active editor');
		assert.deepEqual(
			[editor.selection.start, editor.selection.end].map(({ line, character }) => [line, character]),
			[
				[2, 8],
				[2, 16],
			],
		);
		assert.equal(editor.document.getText(editor.selection), '**bold**');
	});

	it('opens the source of a rendered element where no editor shows it', async () => {
		const { document } = await showDocument('closed.md');
		await openPreviewToSide(document.uri);
		await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup', vscode.ViewColumn.One);

		await manager.jumpToSource(document.uri, PARAGRAPH, 20);

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor && same(editor.document.uri, document.uri), 'the source is open again');
		assert.equal(editor.document.getText(editor.selection), '😀 text **bold** end');
	});

	it('shows the element at the cursor in the preview', async () => {
		const editor = await showDocument('cursor.md');
		await openPreviewToSide(editor.document.uri);
		const cursor = new vscode.Position(2, 10);
		editor.selection = new vscode.Selection(cursor, cursor);

		const showing = next(manager.onDidShowElement, (shown: ShownElement) => same(shown.uri, editor.document.uri));
		await manager.showElement();

		const shown = await showing;
		assert.deepEqual([shown.offset, shown.length], [editor.document.offsetAt(cursor), 0]);
		assert.deepEqual(shown.element, { offset: BOLD, length: 8 });
	});

	it('shows the element that contains the selection, and opens the preview for it', async () => {
		const editor = await showDocument('selection.md');
		editor.selection = new vscode.Selection(2, 0, 2, 20);

		const showing = next(manager.onDidShowElement, (shown: ShownElement) => same(shown.uri, editor.document.uri));
		await manager.showElement();

		const shown = await showing;
		assert.deepEqual([shown.offset, shown.length], [PARAGRAPH, 20]);
		assert.deepEqual(shown.element, { offset: PARAGRAPH, length: 20 });
	});

	it('is a command of the editor of a Markdown document, without a default key', async () => {
		const contributes = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.contributes;
		assert.ok(contributes.commands.some((command: { command: string }) => command.command === SHOW_ELEMENT));
		assert.deepEqual(
			contributes.menus['editor/context'].filter((item: { command: string }) => item.command === SHOW_ELEMENT),
			[{ command: SHOW_ELEMENT, when: 'editorLangId == markdown', group: 'navigation' }],
		);
		assert.ok((await vscode.commands.getCommands(true)).includes(SHOW_ELEMENT));
	});
});

function same(a: vscode.Uri | undefined, b: vscode.Uri): boolean {
	return a?.toString() === b.toString();
}

function next<T>(event: vscode.Event<T>, accept: (value: T) => boolean): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error(`not within ${TIMEOUT} ms`));
		}, TIMEOUT);
		const listener = event((value) => {
			if (accept(value)) {
				clearTimeout(timer);
				listener.dispose();
				resolve(value);
			}
		});
	});
}
