/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Checks that server/ holds the server "npm run fetch-server" would unpack now: of the version package.json pins and
// with the very files of its distribution in the Maven repository. server/ is ignored by git, so neither a checkout
// nor a new build of the server updates it. The tests inside VS Code run this check before they start.
//
//   npm run check-server

import { readFile } from 'node:fs/promises';
import { checkBundledServer, readCoordinates, repositoryOf } from './serverDistribution';

const TARGET = 'server';

async function main(): Promise<void> {
	const coordinates = readCoordinates(JSON.parse(await readFile('package.json', 'utf8')));
	const warning = await checkBundledServer(TARGET, coordinates, repositoryOf(process.env));
	if (warning !== undefined) {
		console.warn(`Warning: ${warning}`);
	} else {
		console.log(`${TARGET} holds markdown-ls ${coordinates.version} as its distribution in the Maven repository does.`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
