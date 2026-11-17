/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { ZipFile } from 'yazl';
import { checkVsix } from '../../scripts/vsix';

const DOCUMENTS = [
	{ name: 'readme.md', source: 'EXTENSION-DETAILS.md', text: '# For users' },
	{ name: 'changelog.md', source: 'CHANGELOG.md', text: '# Changelog' },
];

describe('checkVsix', () => {
	it('accepts a VSIX carrying every document with the text of its file', async () => {
		const vsix = await zip({ 'extension/readme.md': '# For users', 'extension/changelog.md': '# Changelog' });

		await checkVsix(vsix, DOCUMENTS);
	});

	it('fails if the VSIX lacks a document', async () => {
		const vsix = await zip({ 'extension/readme.md': '# For users', 'changelog.md': '# Changelog' });

		await assert.rejects(checkVsix(vsix, DOCUMENTS), /holds no changelog\.md/);
	});

	it('fails if a document was packaged from another file', async () => {
		const vsix = await zip({ 'extension/readme.md': '# For developers', 'extension/changelog.md': '# Changelog' });

		await assert.rejects(checkVsix(vsix, DOCUMENTS), /readme\.md in the VSIX is not EXTENSION-DETAILS\.md/);
	});
});

async function zip(entries: Record<string, string>): Promise<Buffer> {
	const archive = new ZipFile();
	for (const [name, content] of Object.entries(entries)) {
		archive.addBuffer(Buffer.from(content), name);
	}
	archive.end();
	const chunks: Buffer[] = [];
	for await (const chunk of archive.outputStream) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}
