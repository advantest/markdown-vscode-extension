/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Writes bom.json, the CycloneDX SBOM the VSIX carries. It merges the SBOM cyclonedx-npm writes of the extension's
// npm dependencies, out/npm-bom.json, with the one the server's distribution brings, server/bom.json, and adds the
// stylesheets of the preview. Run after "npm run fetch-server".
//
//   npm run sbom

import { readFile, writeFile } from 'node:fs/promises';
import { STYLESHEETS } from './thirdParty';

const EXTENSION_BOM = 'out/npm-bom.json';
const SERVER_BOM = 'server/bom.json';
const TARGET = 'bom.json';

/** The parts of a CycloneDX component the merge looks at. */
export interface BomComponent {
	'bom-ref'?: string;
	type: string;
	name: string;
	[key: string]: unknown;
}

export interface BomDependency {
	ref: string;
	dependsOn?: string[];
}

/** The parts of a CycloneDX BOM the merge looks at. */
export interface Bom {
	bomFormat: string;
	specVersion: string;
	metadata: { component: BomComponent; tools?: { components?: BomComponent[] }; [key: string]: unknown };
	components?: BomComponent[];
	dependencies?: BomDependency[];
	[key: string]: unknown;
}

/** Each file of the preview's stylesheets as a CycloneDX component, under a licence no package manager knows of. */
export function stylesheetComponents(): BomComponent[] {
	return STYLESHEETS.flatMap((stylesheet) =>
		stylesheet.files.map((file) => ({
			'bom-ref': file,
			type: 'file',
			name: file,
			description: stylesheet.about.join(' '),
			copyright: stylesheet.copyright,
			licenses: [{ expression: stylesheet.licence }],
			externalReferences: [{ type: 'vcs', url: stylesheet.origin }],
		})),
	);
}

/**
 * Merges the server's SBOM into the extension's: the server's own component and all it holds join the extension's
 * components, its dependency graph joins the extension's, and the extension depends on the server and on the
 * stylesheets. Fails on two components with the same reference, which would make the graph ambiguous.
 */
export function mergeBoms(extension: Bom, server: Bom, stylesheets: BomComponent[]): Bom {
	for (const bom of [extension, server]) {
		if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') {
			throw new Error(`An SBOM is ${bom.bomFormat} ${bom.specVersion}, not CycloneDX 1.6.`);
		}
	}
	const root = reference(extension.metadata.component);
	const serverRoot = reference(server.metadata.component);
	const components = [
		...(extension.components ?? []),
		server.metadata.component,
		...(server.components ?? []),
		...stylesheets,
	];
	const seen = new Set<string>([root]);
	for (const component of components) {
		const ref = reference(component);
		if (seen.has(ref)) {
			throw new Error(`Two components of the SBOM have the reference ${ref}.`);
		}
		seen.add(ref);
	}
	const files = stylesheets.map(reference);
	const dependencies = (extension.dependencies ?? []).map((dependency) =>
		dependency.ref === root
			? { ...dependency, dependsOn: [...(dependency.dependsOn ?? []), serverRoot, ...files] }
			: dependency,
	);
	if (!dependencies.some((dependency) => dependency.ref === root)) {
		dependencies.unshift({ ref: root, dependsOn: [serverRoot, ...files] });
	}
	dependencies.push(...(server.dependencies ?? []), ...files.map((ref) => ({ ref })));
	return {
		...extension,
		metadata: {
			...extension.metadata,
			tools: {
				...extension.metadata.tools,
				components: [...(extension.metadata.tools?.components ?? []), ...(server.metadata.tools?.components ?? [])],
			},
		},
		components,
		dependencies,
	};
}

function reference(component: BomComponent): string {
	const ref = component['bom-ref'];
	if (!ref) {
		throw new Error(`The component ${component.name} of the SBOM has no reference.`);
	}
	return ref;
}

async function readBom(file: string): Promise<Bom> {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Bom;
	} catch (error) {
		throw new Error(`Cannot read the SBOM ${file}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}

async function main(): Promise<void> {
	const bom = mergeBoms(await readBom(EXTENSION_BOM), await readBom(SERVER_BOM), stylesheetComponents());
	await writeFile(TARGET, `${JSON.stringify(bom, null, '\t')}\n`);
	console.log(`Listed ${bom.components?.length ?? 0} components in ${TARGET}.`);
}

if (require.main === module) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
