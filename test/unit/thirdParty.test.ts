/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
	bundledPackages,
	type Component,
	readLicenceTexts,
	readPackage,
	renderNotices,
	repositoryAddress,
	shippedComponents,
} from '../../scripts/thirdParty';

describe('bundledPackages', () => {
	it('finds the folders of the npm packages, scoped and nested ones too, and nothing of our own', () => {
		assert.deepEqual(
			bundledPackages([
				'src/extension.ts',
				'node_modules/a/lib/x.js',
				'node_modules/a/lib/y.js',
				'node_modules/@s/b/index.js',
				'node_modules/a/node_modules/c/main.js',
				'node_modules\\d\\win.js',
			]),
			['node_modules/@s/b', 'node_modules/a', 'node_modules/a/node_modules/c', 'node_modules/d'],
		);
	});
});

describe('repositoryAddress', () => {
	it('turns what package.json names into a web address', () => {
		assert.equal(repositoryAddress({ type: 'git', url: 'git+https://github.com/x/y.git' }), 'https://github.com/x/y');
		assert.equal(repositoryAddress('git://github.com/x/y.git'), 'https://github.com/x/y');
		assert.equal(repositoryAddress('git@github.com:x/y'), 'https://github.com/x/y');
		assert.equal(repositoryAddress('ssh://git@github.com/x/y.git'), 'https://github.com/x/y');
		assert.equal(repositoryAddress('x/y'), 'https://github.com/x/y');
		assert.equal(repositoryAddress(undefined), undefined);
	});
});

describe('reading packages', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'third-party-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function writePackage(folder: string, json: object, files: Record<string, string>): Promise<void> {
		await mkdir(path.join(root, folder), { recursive: true });
		await writeFile(path.join(root, folder, 'package.json'), JSON.stringify(json));
		for (const [name, text] of Object.entries(files)) {
			await writeFile(path.join(root, folder, name), text);
		}
	}

	it('reads a package with its licence and notice files, and nothing else', async () => {
		await writePackage(
			'p',
			{ name: 'p', version: '1.0.0', license: 'MIT', repository: 'git+https://github.com/x/p.git' },
			{ 'License.txt': 'MIT text\r\n', 'thirdpartynotices.txt': 'notices', 'README.md': 'readme', 'index.js': '' },
		);

		const component = await readPackage(path.join(root, 'p'), 'dist/extension.js');

		assert.deepEqual(component, {
			name: 'p',
			version: '1.0.0',
			licence: 'MIT',
			origin: 'https://github.com/x/p',
			shippedIn: 'dist/extension.js',
			texts: [
				{ file: 'License.txt', text: 'MIT text\n' },
				{ file: 'thirdpartynotices.txt', text: 'notices' },
			],
		});
	});

	it('fails on a package without a licence file or without a licence', async () => {
		await writePackage('none', { name: 'none', version: '1.0.0', license: 'MIT' }, { 'README.md': '' });
		await writePackage('unnamed', { name: 'unnamed', version: '1.0.0' }, { LICENSE: '' });

		await assert.rejects(readLicenceTexts(path.join(root, 'none')), /holds no licence file/);
		await assert.rejects(readPackage(path.join(root, 'unnamed'), 'x'), /names no name, version or licence/);
	});

	it('lists the bundled packages, the copied ones and the stylesheet, which comes last', async () => {
		await writePackage('node_modules/zeta', { name: 'zeta', version: '2.0.0', license: 'ISC' }, { LICENSE: 'isc' });
		await writePackage('node_modules/@highlightjs/cdn-assets', { name: '@highlightjs/cdn-assets', version: '11.0.0', license: 'BSD-3-Clause' }, { LICENSE: 'bsd' });
		await writePackage('node_modules/mathjax', { name: 'mathjax', version: '3.0.0', license: 'Apache-2.0' }, { LICENSE: 'apache' });
		await mkdir(path.join(root, 'third-party/default.css'), { recursive: true });
		await writeFile(path.join(root, 'third-party/default.css/EPL-1.0.txt'), 'epl');

		const components = await shippedComponents(root, ['src/extension.ts', 'node_modules/zeta/index.js']);

		assert.deepEqual(
			components.map((component) => [component.name, component.shippedIn, component.texts.map((text) => text.file)]),
			[
				['@highlightjs/cdn-assets', 'dist/media/highlight/', ['LICENSE']],
				['mathjax', 'dist/media/mathjax/', ['LICENSE']],
				['zeta', 'dist/extension.js', ['LICENSE']],
				['default.css of the preview', 'dist/media/default.css', ['EPL-1.0.txt']],
			],
		);
	});
});

describe('renderNotices', () => {
	it('lists the components, then gives each with its licence texts', () => {
		const components: Component[] = [
			{ name: 'p', version: '1.0.0', licence: 'MIT', origin: 'https://x/p', shippedIn: 'dist/extension.js', texts: [{ file: 'LICENSE', text: 'MIT text\n\n' }] },
			{ name: 'css', version: '', licence: 'EPL-1.0', copyright: 'Someone', about: ['Taken from X.'], shippedIn: 'dist/media/x.css', texts: [{ file: 'EPL.txt', text: 'epl' }] },
		];

		const text = renderNotices({ displayName: 'Ext', version: '1.2.3' }, components);

		assert.match(text, /^Ext 1\.2\.3: third-party components\n/);
		assert.match(text, /\n- p 1\.0\.0 \(MIT\), in dist\/extension\.js\n- css \(EPL-1\.0\), in dist\/media\/x\.css\n/);
		assert.match(text, /\np 1\.0\.0\nLicence: MIT\nSource: https:\/\/x\/p\nShipped in: dist\/extension\.js\n-+\nLICENSE:\n\nMIT text\n\n=/);
		assert.match(text, /\ncss\nLicence: EPL-1\.0\nCopyright: Someone\nShipped in: dist\/media\/x\.css\n\nTaken from X\.\n-+\nEPL\.txt:\n\nepl\n$/);
	});
});
