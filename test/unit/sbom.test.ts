/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { type Bom, type BomComponent, mergeBoms, stylesheetComponents } from '../../scripts/sbom';

function bom(root: string, components: string[], dependencies: Bom['dependencies'], tool: string): Bom {
	return {
		bomFormat: 'CycloneDX',
		specVersion: '1.6',
		metadata: {
			component: { 'bom-ref': root, type: 'application', name: root },
			tools: { components: [{ type: 'application', name: tool }] },
		},
		components: components.map((ref) => ({ 'bom-ref': ref, type: 'library', name: ref })),
		dependencies,
	};
}

const STYLESHEETS: BomComponent[] = ['a.css', 'b.css'].map((name) => ({ 'bom-ref': name, type: 'file', name }));

describe('mergeBoms', () => {
	it('adds the server and all it holds to the extension, and makes the extension depend on it and the stylesheets', () => {
		const extension = bom('ext', ['a'], [{ ref: 'ext', dependsOn: ['a'] }, { ref: 'a' }], 'cyclonedx-npm');
		const server = bom('ls', ['j'], [{ ref: 'ls', dependsOn: ['j'] }, { ref: 'j' }], 'cyclonedx-maven-plugin');

		const merged = mergeBoms(extension, server, STYLESHEETS);

		assert.equal(merged.metadata.component.name, 'ext');
		assert.deepEqual(merged.metadata.tools?.components?.map((tool) => tool.name), ['cyclonedx-npm', 'cyclonedx-maven-plugin']);
		assert.deepEqual(merged.components?.map((component) => component['bom-ref']), ['a', 'ls', 'j', 'a.css', 'b.css']);
		assert.deepEqual(merged.dependencies, [
			{ ref: 'ext', dependsOn: ['a', 'ls', 'a.css', 'b.css'] },
			{ ref: 'a' },
			{ ref: 'ls', dependsOn: ['j'] },
			{ ref: 'j' },
			{ ref: 'a.css' },
			{ ref: 'b.css' },
		]);
	});

	it('fails on a reference two components share, and on an SBOM of another format', () => {
		const extension = bom('ext', ['a'], [], 'x');

		assert.throws(() => mergeBoms(extension, bom('ls', ['a'], [], 'y'), STYLESHEETS), /reference a/);
		assert.throws(() => mergeBoms(extension, { ...bom('ls', [], [], 'y'), specVersion: '1.5' }, STYLESHEETS), /not CycloneDX 1\.6/);
	});
});

describe('stylesheetComponents', () => {
	it('declares each file of the stylesheets under the licence of its stylesheet', () => {
		const components = stylesheetComponents();

		assert.ok(components.every((component) => component.type === 'file'));
		assert.deepEqual(
			components.map((component) => [component['bom-ref'], component.licenses]),
			[
				['dist/media/default.css', [{ expression: 'EPL-1.0 AND MIT' }]],
				['dist/media/highlight/stackoverflow-light.min.css', [{ expression: 'MIT' }]],
				['dist/media/highlight/stackoverflow-dark.min.css', [{ expression: 'MIT' }]],
			],
		);
	});
});
