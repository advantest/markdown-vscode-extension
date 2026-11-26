/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { ZipFile } from 'yazl';
import {
	checkBundledServer,
	distributionLocation,
	load,
	manifestAttribute,
	readCoordinates,
	readZip,
	repositoryOf,
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
	it('reads stored and deflated entries', async () => {
		const entries = await readZip(
			await zip({ 'a/': '', 'a/stored.txt': 'stored' }, { 'a/deflated.txt': 'deflated '.repeat(50) }),
		);

		assert.deepEqual(
			entries.map((entry) => entry.name),
			['a/', 'a/stored.txt', 'a/deflated.txt'],
		);
		assert.equal((await entries[1].read()).toString(), 'stored');
		assert.equal((await entries[2].read()).toString(), 'deflated '.repeat(50));
	});

	it('fails on what is not a ZIP archive', async () => {
		await assert.rejects(readZip(Buffer.from('no archive')), /not a ZIP archive/);
	});

	it('fails on a broken entry', async () => {
		const archive = await zip({}, { 'a.txt': 'deflated '.repeat(50) });
		const entries = await readZip(Buffer.concat([archive.subarray(0, 40), Buffer.alloc(8), archive.subarray(48)]));

		await assert.rejects(entries[0].read());
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
	it('takes the JAR, its libraries and their licences, without the folder of the distribution', async () => {
		const files = await unpackServer(await distribution('1.2.3'), '1.2.3');

		assert.deepEqual(
			files.map((file) => [file.path, file.data.length > 0]),
			[
				['bom.json', true],
				['lib/one.jar', true],
				['lib/two.jar', true],
				['LICENSE', true],
				['licenses/apache.txt', true],
				['markdown-ls.jar', true],
				['notices/one-jar/NOTICE', true],
				['sources/one-sources.jar', true],
				['THIRD-PARTY.txt', true],
			],
		);
		assert.equal(files.find((file) => file.path === 'lib/one.jar')?.data.toString(), 'one');
	});

	it('fails if the server is of another version than the one pinned', async () => {
		await assert.rejects(unpackServer(await distribution('1.2.4'), '1.2.3'), /markdown-ls 1\.2\.4.*1\.2\.3/);
		await assert.rejects(unpackServer(await distribution(undefined), '1.2.3'), /no Implementation-Version/);
	});

	it('fails if the distribution holds no markdown-ls.jar', async () => {
		await assert.rejects(unpackServer(await zip({ 'x/lib/one.jar': 'one' }), '1.2.3'), /no markdown-ls\.jar/);
	});
});

describe('repositoryOf', () => {
	it('takes the Maven repository MARKDOWN_LS_REPOSITORY names, by default the local one', () => {
		assert.equal(repositoryOf({ MARKDOWN_LS_REPOSITORY: ' https://repo.example.org/maven2 ' }), 'https://repo.example.org/maven2');
		assert.equal(repositoryOf({ MARKDOWN_LS_REPOSITORY: ' ' }), path.join(homedir(), '.m2', 'repository'));
		assert.equal(repositoryOf({}), path.join(homedir(), '.m2', 'repository'));
	});
});

describe('checkBundledServer', () => {
	const REPOSITORY = path.join('home', '.m2', 'repository');
	let directory: string;
	let server: string;
	let archive: Buffer;
	const fromRepository = async (location: string) => {
		assert.equal(location, distributionLocation(REPOSITORY, COORDINATES));
		return archive;
	};
	const check = () => checkBundledServer(server, COORDINATES, REPOSITORY, fromRepository);

	beforeEach(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'markdown-support-check-'));
		server = path.join(directory, 'server');
		archive = await distribution('1.2.3');
		for (const file of await unpackServer(archive, '1.2.3')) {
			await mkdir(path.dirname(path.join(server, file.path)), { recursive: true });
			await writeFile(path.join(server, file.path), file.data);
		}
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('passes a server unpacked from the distribution in the Maven repository', async () => {
		assert.equal(await check(), undefined);
	});

	it('fails without a server', async () => {
		await rm(server, { recursive: true });

		await assert.rejects(check(), /holds no markdown-ls\.jar\. Run "npm run fetch-server"/);
	});

	it('fails on a server of another version than the one pinned', async () => {
		await writeFile(path.join(server, 'markdown-ls.jar'), await jar('1.2.4'));

		await assert.rejects(check(), /holds markdown-ls 1\.2\.4, but package\.json pins 1\.2\.3\. Run "npm run fetch-server"/);
	});

	it('fails on a JAR whose version cannot be read', async () => {
		await writeFile(path.join(server, 'markdown-ls.jar'), 'no archive');

		await assert.rejects(check(), /markdown-ls\.jar: not a ZIP archive.*Run "npm run fetch-server"/);
	});

	it('fails on a server that differs from the distribution, naming the files', async () => {
		await writeFile(path.join(server, 'lib', 'one.jar'), 'changed');
		await assert.rejects(check(), /in 1 file: lib\/one\.jar\./);

		await rm(path.join(server, 'licenses', 'apache.txt'));
		await writeFile(path.join(server, 'lib', 'old.jar'), 'old');

		await assert.rejects(
			check(),
			/differs from .*markdown-ls-1\.2\.3-distribution\.zip in 3 files: lib\/old\.jar, lib\/one\.jar, licenses\/apache\.txt\. Run "npm run fetch-server"/,
		);
	});

	it('only warns if the distribution cannot be read, having checked the version', async () => {
		const warning = await checkBundledServer(server, COORDINATES, REPOSITORY, async () => {
			throw new Error('ENOENT');
		});

		assert.match(warning ?? '', /markdown-ls-1\.2\.3-distribution\.zip cannot be read \(ENOENT\).*markdown-ls 1\.2\.3/);
	});
});

const jar = (version: string | undefined) =>
	zip({
		'META-INF/MANIFEST.MF': `Manifest-Version: 1.0\r\n${version ? `Implementation-Version: ${version}\r\n` : ''}`,
	});

const distribution = async (version: string | undefined) =>
	zip({
		'markdown-ls-1.2.3/': '',
		'markdown-ls-1.2.3/bin/markdown-ls': 'script',
		'markdown-ls-1.2.3/README.md': 'readme',
		'markdown-ls-1.2.3/lib/': '',
		'markdown-ls-1.2.3/lib/one.jar': 'one',
		'markdown-ls-1.2.3/lib/two.jar': 'two',
		'markdown-ls-1.2.3/markdown-ls.jar': await jar(version),
		'markdown-ls-1.2.3/LICENSE': 'licence',
		'markdown-ls-1.2.3/THIRD-PARTY.txt': 'list',
		'markdown-ls-1.2.3/bom.json': '{}',
		'markdown-ls-1.2.3/licenses/': '',
		'markdown-ls-1.2.3/licenses/apache.txt': 'apache',
		'markdown-ls-1.2.3/notices/one-jar/NOTICE': 'notice',
		'markdown-ls-1.2.3/sources/one-sources.jar': 'source',
	});

/** Builds a ZIP archive with yazl, the first entries stored, the second ones deflated; a name ending in `/` is a folder. */
async function zip(
	stored: Record<string, string | Buffer>,
	deflated: Record<string, string | Buffer> = {},
): Promise<Buffer> {
	const archive = new ZipFile();
	const add = (entries: Record<string, string | Buffer>, compress: boolean) => {
		for (const [name, content] of Object.entries(entries)) {
			if (name.endsWith('/')) {
				archive.addEmptyDirectory(name);
			} else {
				archive.addBuffer(Buffer.from(content), name, { compress });
			}
		}
	};
	add(stored, false);
	add(deflated, true);
	archive.end();
	const chunks: Buffer[] = [];
	for await (const chunk of archive.outputStream) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}
