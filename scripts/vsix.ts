/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Checks a packaged extension: that it carries the documents VS Code shows in the extension's tabs.

import { readZip } from './serverDistribution';

/** The folder of a VSIX the extension's files are packaged into. */
const EXTENSION_FOLDER = 'extension';

/** A document the VSIX has to carry under its name, with the text of the file it is packaged from. */
export interface PackagedDocument {
	/** The name in the VSIX, e.g. `readme.md`. */
	name: string;
	/** The file it is packaged from, e.g. `EXTENSION-DETAILS.md`. */
	source: string;
	text: string;
}

/** Checks that a VSIX carries each document, with the text of the file it is packaged from. */
export async function checkVsix(vsix: Buffer, documents: readonly PackagedDocument[]): Promise<void> {
	const entries = await readZip(vsix);
	for (const document of documents) {
		const entry = entries.find((candidate) => candidate.name === `${EXTENSION_FOLDER}/${document.name}`);
		if (entry === undefined) {
			throw new Error(`The VSIX holds no ${document.name}.`);
		}
		if ((await entry.read()).toString('utf8') !== document.text) {
			throw new Error(`The ${document.name} in the VSIX is not ${document.source}.`);
		}
	}
}
