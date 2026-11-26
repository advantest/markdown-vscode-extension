/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Fetches the distribution of the language server markdown-ls and takes from it what the extension bundles.

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import * as yauzl from 'yauzl';

/** The Maven coordinates of the server's distribution, pinned in package.json under `markdownSupport.defaultServer`. */
export interface Coordinates {
	groupId: string;
	artifactId: string;
	version: string;
}

/** A file of the server, its path relative to the folder the server is unpacked into. */
export interface ServerFile {
	path: string;
	data: Buffer;
}

/** An entry of a ZIP archive; a folder's name ends in `/`. */
export interface ZipEntry {
	name: string;
	read(): Promise<Buffer>;
}

const CLASSIFIER = 'distribution';
const JAR = 'markdown-ls.jar';

export function readCoordinates(packageJson: unknown): Coordinates {
	const server = (packageJson as { markdownSupport?: { defaultServer?: Record<string, unknown> } }).markdownSupport?.defaultServer;
	const coordinate = (key: keyof Coordinates): string => {
		const value = server?.[key];
		if (typeof value !== 'string' || value.trim() === '') {
			throw new Error(`package.json names no markdownSupport.defaultServer.${key}.`);
		}
		return value;
	};
	return { groupId: coordinate('groupId'), artifactId: coordinate('artifactId'), version: coordinate('version') };
}

/**
 * Where the distribution lies in a Maven repository, a folder or a web address. A published release can be taken from
 * a remote repository; a snapshot only from a local one, since a remote one names it by the time it was deployed.
 */
export function distributionLocation(repository: string, coordinates: Coordinates): string {
	const { groupId, artifactId, version } = coordinates;
	const parts = [...groupId.split('.'), artifactId, version, `${artifactId}-${version}-${CLASSIFIER}.zip`];
	if (/^https?:\/\//.test(repository)) {
		return `${repository.replace(/\/+$/, '')}/${parts.join('/')}`;
	}
	return path.join(repository, ...parts);
}

/** Reads a file, or downloads a web address. */
export async function load(location: string): Promise<Buffer> {
	if (!/^https?:\/\//.test(location)) {
		return readFile(location);
	}
	const response = await fetch(location);
	if (!response.ok) {
		throw new Error(`${location} could not be downloaded: HTTP ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

/** Lists the entries of a ZIP archive. */
export async function readZip(archive: Buffer): Promise<ZipEntry[]> {
	let zip: yauzl.ZipFile;
	try {
		zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
			yauzl.fromBuffer(archive, { lazyEntries: true }, (error, opened) => (error ? reject(error) : resolve(opened))),
		);
	} catch (error) {
		throw new Error(`not a ZIP archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const entries: ZipEntry[] = [];
	await new Promise<void>((resolve, reject) => {
		zip.on('entry', (entry: yauzl.Entry) => {
			entries.push({ name: entry.fileName, read: () => readEntry(zip, entry) });
			zip.readEntry();
		});
		zip.on('end', resolve);
		zip.on('error', reject);
		zip.readEntry();
	});
	return entries;
}

async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
	const stream = await new Promise<Readable>((resolve, reject) =>
		zip.openReadStream(entry, (error, opened) => (error ? reject(error) : resolve(opened))),
	);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** Reads an attribute of the main section of a JAR's manifest. */
export function manifestAttribute(manifest: string, name: string): string | undefined {
	const lines = manifest.replace(/\r?\n /g, '').split(/\r?\n/);
	const prefix = `${name}: `;
	return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

/** The version the manifest of the server's JAR names. */
export async function jarVersion(jar: Buffer): Promise<string> {
	const manifest = (await readZip(jar)).find((entry) => entry.name === 'META-INF/MANIFEST.MF');
	const found = manifest && manifestAttribute((await manifest.read()).toString('utf8'), 'Implementation-Version');
	if (found === undefined) {
		throw new Error(`The manifest of ${JAR} names no Implementation-Version.`);
	}
	return found;
}

/**
 * The Maven repository the distribution is taken from: the one the environment variable MARKDOWN_LS_REPOSITORY names,
 * a folder or a web address, by default the local one.
 */
export function repositoryOf(environment: NodeJS.ProcessEnv): string {
	return environment.MARKDOWN_LS_REPOSITORY?.trim() || path.join(homedir(), '.m2', 'repository');
}

/**
 * What the extension takes from the distribution: the server's JAR and the libraries next to it, and what the
 * licences of these libraries ask to be passed on with them — the server's licence, the list of the third-party
 * components, their licences and notices, the sources of the components under the GPL, and the bill of materials.
 */
const TAKEN = [/^markdown-ls\.jar$/, /^lib\/[^/]+\.jar$/, /^(LICENSE|THIRD-PARTY\.txt|bom\.json)$/, /^(licenses|notices|sources)\//];

/**
 * Takes what the extension bundles out of the distribution, without the distribution's own folder, and checks that
 * the JAR is of the version pinned.
 */
export async function unpackServer(distribution: Buffer, version: string): Promise<ServerFile[]> {
	const selected = (await readZip(distribution))
		.map((entry) => ({ entry, path: entry.name.replace(/^[^/]+\//, '') }))
		.filter(({ entry, path }) => !entry.name.endsWith('/') && TAKEN.some((taken) => taken.test(path)));
	const files: ServerFile[] = [];
	for (const { entry, path } of selected) {
		files.push({ path, data: await entry.read() });
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	const jar = files.find((file) => file.path === JAR);
	if (jar === undefined) {
		throw new Error(`The distribution holds no ${JAR}.`);
	}
	const found = await jarVersion(jar.data);
	if (found !== version) {
		throw new Error(`The distribution holds markdown-ls ${found}, but package.json pins ${version}.`);
	}
	return files;
}

const FETCH = 'Run "npm run fetch-server".';

/**
 * Checks the server unpacked into a folder, as "npm run fetch-server" does into server/, against the distribution it
 * would unpack now. Fails if the folder holds no server, one of another version than the one pinned, or one whose
 * files differ from the distribution's, e.g. an older build of the same snapshot. Answers a warning if the
 * distribution cannot be read, e.g. offline or where the Maven repository lacks it; then only the version is checked.
 */
export async function checkBundledServer(
	folder: string,
	coordinates: Coordinates,
	repository: string,
	read: (location: string) => Promise<Buffer> = load,
): Promise<string | undefined> {
	let jar: Buffer;
	try {
		jar = await readFile(path.join(folder, JAR));
	} catch {
		throw new Error(`${folder} holds no ${JAR}. ${FETCH}`);
	}
	let bundled: string;
	try {
		bundled = await jarVersion(jar);
	} catch (error) {
		throw new Error(`${path.join(folder, JAR)}: ${error instanceof Error ? error.message : String(error)} ${FETCH}`, {
			cause: error,
		});
	}
	if (bundled !== coordinates.version) {
		throw new Error(`${folder} holds markdown-ls ${bundled}, but package.json pins ${coordinates.version}. ${FETCH}`);
	}

	const location = distributionLocation(repository, coordinates);
	let distribution: Buffer;
	try {
		distribution = await read(location);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return `${location} cannot be read (${reason}), so ${folder} was only checked to hold markdown-ls ${bundled}.`;
	}
	const expected = new Map((await unpackServer(distribution, coordinates.version)).map((file) => [file.path, file.data]));
	const present = new Set(await filesIn(folder));
	const differing: string[] = [];
	for (const file of new Set([...expected.keys(), ...present])) {
		const data = expected.get(file);
		if (data === undefined || !present.has(file) || !data.equals(await readFile(path.join(folder, file)))) {
			differing.push(file);
		}
	}
	differing.sort();
	if (differing.length > 0) {
		const files = differing.length === 1 ? '1 file' : `${differing.length} files`;
		throw new Error(`${folder} differs from ${location} in ${files}: ${differing.join(', ')}. ${FETCH}`);
	}
	return undefined;
}

/** The files below a folder, by their paths relative to it with `/` between the names. */
async function filesIn(folder: string): Promise<string[]> {
	const entries = await readdir(folder, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
}
