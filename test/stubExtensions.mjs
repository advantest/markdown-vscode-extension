/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Builds the extensions the end-to-end tests install next to the extension under test: extensions without code that
// only declare a language server in their package.json, under markdownSupport.server, as D-49 describes.
//
// The JAR a stub declares is a launcher: a JAR with nothing but a manifest that names the main class of the bundled
// server and puts the bundled server on its class path, so that the extension can really start it.

import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';

const LAUNCHER = 'server/launcher.jar';

/**
 * Writes the stubs into the folder and answers their folders by name. The stubs declaring a launcher are only
 * complete if the bundled server is there, since the launcher takes its main class from it.
 */
export async function writeStubExtensions(folder, bundledJar, markdownLs) {
	rmSync(folder, { recursive: true, force: true });
	const mainClass = await mainClassOf(bundledJar).catch(() => undefined);
	const stubs = {
		// Declares the bundled server's version through a launcher of its own.
		valid: { server: { jar: LAUNCHER, markdownLs }, launcher: true },
		// Declares a version of markdown-ls no extension accepts.
		unaccepted: { server: { jar: LAUNCHER, markdownLs: '0.1.0' }, launcher: true },
	};
	const folders = {};
	for (const [name, stub] of Object.entries(stubs)) {
		const stubFolder = join(folder, name);
		folders[name] = stubFolder;
		mkdirSync(stubFolder, { recursive: true });
		writeFileSync(
			join(stubFolder, 'package.json'),
			JSON.stringify(
				{
					name: `declared-${name}`,
					displayName: `Stub declaring a ${name} server`,
					publisher: 'stub',
					version: '0.0.1',
					engines: { vscode: '^1.91.0' },
					markdownSupport: { server: stub.server },
				},
				null,
				'\t',
			),
		);
		if (stub.launcher && mainClass) {
			const jar = join(stubFolder, ...LAUNCHER.split('/'));
			const classPath = relative(dirname(jar), bundledJar).split(sep).map(encodeURIComponent).join('/');
			await writeLauncher(jar, mainClass, classPath);
		}
	}
	return folders;
}

/** The main class in the manifest of a JAR. */
async function mainClassOf(jar) {
	const zip = await new Promise((resolve, reject) =>
		yauzl.fromBuffer(readFileSync(jar), { lazyEntries: true }, (error, opened) => (error ? reject(error) : resolve(opened))),
	);
	const manifest = await new Promise((resolve, reject) => {
		zip.on('entry', (entry) => {
			if (entry.fileName !== 'META-INF/MANIFEST.MF') {
				zip.readEntry();
				return;
			}
			zip.openReadStream(entry, (error, stream) => {
				if (error) {
					reject(error);
					return;
				}
				const chunks = [];
				stream.on('data', (chunk) => chunks.push(chunk));
				stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
				stream.on('error', reject);
			});
		});
		zip.on('end', () => reject(new Error(`${jar} has no manifest`)));
		zip.on('error', reject);
		zip.readEntry();
	});
	const line = manifest
		.replace(/\r?\n /g, '')
		.split(/\r?\n/)
		.find((candidate) => candidate.startsWith('Main-Class: '));
	if (!line) {
		throw new Error(`${jar} names no main class`);
	}
	return line.slice('Main-Class: '.length);
}

async function writeLauncher(jar, mainClass, classPath) {
	mkdirSync(dirname(jar), { recursive: true });
	const manifest = ['Manifest-Version: 1.0', `Main-Class: ${mainClass}`, `Class-Path: ${classPath}`]
		.map(wrapManifestLine)
		.join('');
	const zip = new yazl.ZipFile();
	zip.addBuffer(Buffer.from(manifest + '\r\n'), 'META-INF/MANIFEST.MF');
	zip.end();
	const chunks = [];
	for await (const chunk of zip.outputStream) {
		chunks.push(chunk);
	}
	writeFileSync(jar, Buffer.concat(chunks));
}

/** A manifest line is at most 72 bytes long; it goes on in lines that begin with a space. */
function wrapManifestLine(line) {
	const parts = [line.slice(0, 72)];
	for (let start = 72; start < line.length; start += 71) {
		parts.push(' ' + line.slice(start, start + 71));
	}
	return parts.map((part) => part + '\r\n').join('');
}
