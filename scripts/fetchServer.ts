/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Fetches the distribution of markdown-ls whose version package.json pins and unpacks the server's JAR and its
// libraries into server/, where the extension starts it from and whence it is packaged.
//
//   npm run fetch-server
//
// The distribution is taken from the Maven repository MARKDOWN_LS_REPOSITORY names, a folder or a web address; by
// default the local one, ~/.m2/repository, into which "mvn install" in markdown-ls puts it.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { distributionLocation, load, readCoordinates, unpackServer } from './serverDistribution';

const TARGET = 'server';

async function main(): Promise<void> {
	const coordinates = readCoordinates(JSON.parse(await readFile('package.json', 'utf8')));
	const repository = process.env.MARKDOWN_LS_REPOSITORY?.trim() || path.join(homedir(), '.m2', 'repository');
	const location = distributionLocation(repository, coordinates);
	const files = await unpackServer(await load(location), coordinates.version);

	await rm(TARGET, { recursive: true, force: true });
	for (const file of files) {
		const target = path.join(TARGET, file.path);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, file.data);
	}
	console.log(`Unpacked markdown-ls ${coordinates.version} from ${location} into ${TARGET}/, ${files.length} JARs.`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
