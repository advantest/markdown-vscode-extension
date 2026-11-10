/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Writes ThirdPartyNotices.txt, which the VSIX carries: the third-party components the extension holds besides the
// server, each with the texts of its licence and notices. Run after "node esbuild.mjs", which writes out/bundled.json.
//
//   npm run notices

import { readFile, writeFile } from 'node:fs/promises';
import { renderNotices, shippedComponents } from './thirdParty';

const TARGET = 'ThirdPartyNotices.txt';

async function main(): Promise<void> {
	const extension = JSON.parse(await readFile('package.json', 'utf8')) as { displayName: string; version: string };
	const bundled = JSON.parse(await readFile('out/bundled.json', 'utf8')) as string[];
	const components = await shippedComponents('.', bundled);
	await writeFile(TARGET, renderNotices(extension, components));
	console.log(`Listed ${components.length} third-party components in ${TARGET}.`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
