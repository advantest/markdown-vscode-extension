// Fetches the distribution of the language server markdown-ls and takes from it what the extension bundles.

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** The Maven coordinates of the server's distribution, pinned in package.json under `markdownSupport.server`. */
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
	read(): Buffer;
}

const CLASSIFIER = 'distribution';
const JAR = 'markdown-ls.jar';

export function readCoordinates(packageJson: unknown): Coordinates {
	const server = (packageJson as { markdownSupport?: { server?: Record<string, unknown> } }).markdownSupport?.server;
	const coordinate = (key: keyof Coordinates): string => {
		const value = server?.[key];
		if (typeof value !== 'string' || value.trim() === '') {
			throw new Error(`package.json names no markdownSupport.server.${key}.`);
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

/** Lists the entries of a ZIP archive; entries are stored or deflated, and the archive is not a ZIP64 one. */
export function readZip(archive: Buffer): ZipEntry[] {
	const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0 || archive.length - end < 22) {
		throw new Error('not a ZIP archive');
	}
	const count = archive.readUInt16LE(end + 10);
	let offset = archive.readUInt32LE(end + 16);
	const entries: ZipEntry[] = [];
	for (let i = 0; i < count; i++) {
		if (archive.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error('not a ZIP archive: broken central directory');
		}
		const method = archive.readUInt16LE(offset + 10);
		const size = archive.readUInt32LE(offset + 20);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const local = archive.readUInt32LE(offset + 42);
		const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		entries.push({
			name,
			read: () => {
				const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
				const data = archive.subarray(start, start + size);
				if (method === 0) {
					return Buffer.from(data);
				}
				if (method === 8) {
					return inflateRawSync(data);
				}
				throw new Error(`${name} is compressed with the unsupported method ${method}`);
			},
		});
	}
	return entries;
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
export function unpackServer(distribution: Buffer, version: string): ServerFile[] {
	const files = readZip(distribution)
		.map((entry) => ({ entry, path: entry.name.replace(/^[^/]+\//, '') }))
		.filter(({ entry, path }) => !entry.name.endsWith('/') && (path === JAR || /^lib\/[^/]+\.jar$/.test(path)))
		.map(({ entry, path }) => ({ path, data: entry.read() }))
		.sort((a, b) => a.path.localeCompare(b.path));
	const jar = files.find((file) => file.path === JAR);
	if (jar === undefined) {
		throw new Error(`The distribution holds no ${JAR}.`);
	}
	const manifest = readZip(jar.data).find((entry) => entry.name === 'META-INF/MANIFEST.MF');
	const found = manifest && manifestAttribute(manifest.read().toString('utf8'), 'Implementation-Version');
	if (found === undefined) {
		throw new Error(`The manifest of ${JAR} names no Implementation-Version.`);
	}
	if (found !== version) {
		throw new Error(`The distribution holds markdown-ls ${found}, but package.json pins ${version}.`);
	}
	return files;
}
