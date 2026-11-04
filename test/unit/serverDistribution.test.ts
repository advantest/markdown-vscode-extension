import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
	distributionLocation,
	load,
	manifestAttribute,
	readCoordinates,
	readZip,
	unpackServer,
} from '../../scripts/serverDistribution';

const COORDINATES = { groupId: 'org.example.md', artifactId: 'markdown-ls', version: '1.2.3' };

describe('readCoordinates', () => {
	it('reads the Maven coordinates of the server pinned in package.json', () => {
		assert.deepEqual(readCoordinates({ markdownSupport: { defaultServer: { ...COORDINATES, other: 1 } } }), COORDINATES);
	});

	it('fails if a coordinate is missing', () => {
		assert.throws(
			() => readCoordinates({ markdownSupport: { defaultServer: { groupId: 'g', artifactId: 'a' } } }),
			/markdownSupport\.defaultServer\.version/,
		);
		assert.throws(() => readCoordinates({}), /markdownSupport\.defaultServer\.groupId/);
	});
});

describe('distributionLocation', () => {
	it('lays out the distribution in a local Maven repository', () => {
		assert.equal(
			distributionLocation(path.join('home', '.m2', 'repository'), COORDINATES),
			path.join('home', '.m2', 'repository', 'org', 'example', 'md', 'markdown-ls', '1.2.3', 'markdown-ls-1.2.3-distribution.zip'),
		);
	});

	it('lays out the distribution in a remote Maven repository', () => {
		assert.equal(
			distributionLocation('https://repo.example.org/maven2/', COORDINATES),
			'https://repo.example.org/maven2/org/example/md/markdown-ls/1.2.3/markdown-ls-1.2.3-distribution.zip',
		);
		assert.equal(
			distributionLocation('http://repo.example.org/maven2', COORDINATES),
			'http://repo.example.org/maven2/org/example/md/markdown-ls/1.2.3/markdown-ls-1.2.3-distribution.zip',
		);
	});
});

describe('load', () => {
	let directory: string;
	let server: Server | undefined;

	before(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-distribution-'));
	});

	after(async () => {
		server?.close();
		await rm(directory, { recursive: true, force: true });
	});

	it('reads a file', async () => {
		const file = path.join(directory, 'archive.zip');
		await writeFile(file, 'content');

		assert.equal((await load(file)).toString(), 'content');
	});

	it('downloads a web address, and fails on an HTTP error', async () => {
		server = createServer((request, response) => {
			if (request.url === '/archive.zip') {
				response.end('downloaded');
			} else {
				response.statusCode = 404;
				response.end();
			}
		});
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

		assert.equal((await load(`${base}/archive.zip`)).toString(), 'downloaded');
		await assert.rejects(load(`${base}/missing.zip`), /404/);
	});
});

describe('readZip', () => {
	it('reads stored and deflated entries', () => {
		const entries = readZip(zip({ 'a/': '', 'a/stored.txt': 'stored' }, { 'a/deflated.txt': 'deflated '.repeat(50) }));

		assert.deepEqual(
			entries.map((entry) => entry.name),
			['a/', 'a/stored.txt', 'a/deflated.txt'],
		);
		assert.equal(entries[1].read().toString(), 'stored');
		assert.equal(entries[2].read().toString(), 'deflated '.repeat(50));
	});

	it('fails on what is not a ZIP archive', () => {
		assert.throws(() => readZip(Buffer.from('no archive')), /not a ZIP archive/);
	});
});

describe('manifestAttribute', () => {
	const manifest = [
		'Manifest-Version: 1.0',
		'Class-Path: lib/one.jar lib/tw',
		' o.jar',
		'Implementation-Version: 1.2.3',
		'',
	].join('\r\n');

	it('reads an attribute, joining its continuation lines', () => {
		assert.equal(manifestAttribute(manifest, 'Implementation-Version'), '1.2.3');
		assert.equal(manifestAttribute(manifest, 'Class-Path'), 'lib/one.jar lib/two.jar');
		assert.equal(manifestAttribute(manifest.replaceAll('\r\n', '\n'), 'Class-Path'), 'lib/one.jar lib/two.jar');
	});

	it('answers undefined for a missing attribute', () => {
		assert.equal(manifestAttribute(manifest, 'Main-Class'), undefined);
	});
});

describe('unpackServer', () => {
	const jar = (version: string | undefined) =>
		zip({
			'META-INF/MANIFEST.MF': `Manifest-Version: 1.0\r\n${version ? `Implementation-Version: ${version}\r\n` : ''}`,
		});
	const distribution = (version: string | undefined) =>
		zip({
			'markdown-ls-1.2.3/': '',
			'markdown-ls-1.2.3/bin/markdown-ls': 'script',
			'markdown-ls-1.2.3/README.md': 'readme',
			'markdown-ls-1.2.3/lib/': '',
			'markdown-ls-1.2.3/lib/one.jar': 'one',
			'markdown-ls-1.2.3/lib/two.jar': 'two',
			'markdown-ls-1.2.3/markdown-ls.jar': jar(version),
		});

	it('takes the JAR and its libraries, without the folder of the distribution', () => {
		const files = unpackServer(distribution('1.2.3'), '1.2.3');

		assert.deepEqual(
			files.map((file) => [file.path, file.data.length > 0]),
			[
				['lib/one.jar', true],
				['lib/two.jar', true],
				['markdown-ls.jar', true],
			],
		);
		assert.equal(files[0].data.toString(), 'one');
	});

	it('fails if the server is of another version than the one pinned', () => {
		assert.throws(() => unpackServer(distribution('1.2.4'), '1.2.3'), /markdown-ls 1\.2\.4.*1\.2\.3/);
		assert.throws(() => unpackServer(distribution(undefined), '1.2.3'), /no Implementation-Version/);
	});

	it('fails if the distribution holds no markdown-ls.jar', () => {
		assert.throws(() => unpackServer(zip({ 'x/lib/one.jar': 'one' }), '1.2.3'), /no markdown-ls\.jar/);
	});
});

/** Builds a ZIP archive, the first entries stored, the second ones deflated; CRCs are left 0, as nothing checks them. */
function zip(stored: Record<string, string | Buffer>, deflated: Record<string, string | Buffer> = {}): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	const entries = [
		...Object.entries(stored).map(([name, content]) => ({ name, content, method: 0 })),
		...Object.entries(deflated).map(([name, content]) => ({ name, content, method: 8 })),
	];
	for (const { name, content, method } of entries) {
		const raw = Buffer.from(content);
		const data = method === 8 ? deflateRawSync(raw) : raw;
		const fileName = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(fileName.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(fileName.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, fileName, data);
		centrals.push(central, fileName);
		offset += local.length + fileName.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
