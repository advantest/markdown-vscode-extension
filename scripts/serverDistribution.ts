// Fetches the distribution of the language server markdown-ls and takes from it what the extension bundles.

import { readFile } from 'node:fs/promises';
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

/**
 * Takes the server's JAR and the libraries next to it out of the distribution, without the distribution's own
 * folder, and checks that the JAR is of the version pinned.
 */
export async function unpackServer(distribution: Buffer, version: string): Promise<ServerFile[]> {
	const selected = (await readZip(distribution))
		.map((entry) => ({ entry, path: entry.name.replace(/^[^/]+\//, '') }))
		.filter(({ entry, path }) => !entry.name.endsWith('/') && (path === JAR || /^lib\/[^/]+\.jar$/.test(path)));
	const files: ServerFile[] = [];
	for (const { entry, path } of selected) {
		files.push({ path, data: await entry.read() });
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	const jar = files.find((file) => file.path === JAR);
	if (jar === undefined) {
		throw new Error(`The distribution holds no ${JAR}.`);
	}
	const manifest = (await readZip(jar.data)).find((entry) => entry.name === 'META-INF/MANIFEST.MF');
	const found = manifest && manifestAttribute((await manifest.read()).toString('utf8'), 'Implementation-Version');
	if (found === undefined) {
		throw new Error(`The manifest of ${JAR} names no Implementation-Version.`);
	}
	if (found !== version) {
		throw new Error(`The distribution holds markdown-ls ${found}, but package.json pins ${version}.`);
	}
	return files;
}
