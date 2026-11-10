/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as assert from 'node:assert/strict';
import { type Bom, type BomComponent, defaultCssComponent, mergeBoms } from '../../scripts/sbom';

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

const STYLESHEET: BomComponent = { 'bom-ref': 'style.css', type: 'file', name: 'style.css' };

describe('mergeBoms', () => {
	it('adds the server and all it holds to the extension, and makes the extension depend on it and the stylesheet', () => {
		const extension = bom('ext', ['a'], [{ ref: 'ext', dependsOn: ['a'] }, { ref: 'a' }], 'cyclonedx-npm');
		const server = bom('ls', ['j'], [{ ref: 'ls', dependsOn: ['j'] }, { ref: 'j' }], 'cyclonedx-maven-plugin');

		const merged = mergeBoms(extension, server, STYLESHEET);

		assert.equal(merged.metadata.component.name, 'ext');
		assert.deepEqual(merged.metadata.tools?.components?.map((tool) => tool.name), ['cyclonedx-npm', 'cyclonedx-maven-plugin']);
		assert.deepEqual(merged.components?.map((component) => component['bom-ref']), ['a', 'ls', 'j', 'style.css']);
		assert.deepEqual(merged.dependencies, [
			{ ref: 'ext', dependsOn: ['a', 'ls', 'style.css'] },
			{ ref: 'a' },
			{ ref: 'ls', dependsOn: ['j'] },
			{ ref: 'j' },
			{ ref: 'style.css' },
		]);
	});

	it('fails on a reference two components share, and on an SBOM of another format', () => {
		const extension = bom('ext', ['a'], [], 'x');

		assert.throws(() => mergeBoms(extension, bom('ls', ['a'], [], 'y'), STYLESHEET), /reference a/);
		assert.throws(() => mergeBoms(extension, { ...bom('ls', [], [], 'y'), specVersion: '1.5' }, STYLESHEET), /not CycloneDX 1\.6/);
	});
});

describe('defaultCssComponent', () => {
	it('declares the stylesheet as a file under both its licences', () => {
		const component = defaultCssComponent();

		assert.equal(component.type, 'file');
		assert.equal(component['bom-ref'], 'dist/media/default.css');
		assert.deepEqual(component.licenses, [{ expression: 'EPL-1.0 AND MIT' }]);
	});
});
