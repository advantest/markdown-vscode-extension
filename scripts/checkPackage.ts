/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Checks the packaged extension, the VSIX "npm run package" writes, or the one named on the command line:
//
//   npm run check-package [-- <vsix>]

import { readFile } from 'node:fs/promises';
import { checkVsix, type PackagedDocument } from './vsix';

/** The documents VS Code shows in the Details and the Changelog tab, by the files "npm run package" takes them from. */
const DOCUMENTS = [
	{ name: 'readme.md', source: 'EXTENSION-DETAILS.md' },
	{ name: 'changelog.md', source: 'CHANGELOG.md' },
];

async function main(): Promise<void> {
	const { name, version } = JSON.parse(await readFile('package.json', 'utf8')) as { name: string; version: string };
	const vsix = process.argv[2] ?? `${name}-${version}.vsix`;
	const documents: PackagedDocument[] = await Promise.all(
		DOCUMENTS.map(async (document) => ({ ...document, text: await readFile(document.source, 'utf8') })),
	);
	await checkVsix(await readFile(vsix), documents);
	console.log(`${vsix} carries ${documents.map((document) => document.source).join(' and ')}.`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
