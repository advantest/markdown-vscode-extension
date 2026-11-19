/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Finds the third-party components the extension ships and what their licences ask to be passed on with them.

import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

/** A third-party component the VSIX holds, with the texts of its licence and notices. */
export interface Component {
	name: string;
	version: string;
	/** An SPDX licence expression. */
	licence: string;
	/** Where the component comes from, a web address. */
	origin?: string;
	/** Who holds the copyright, where the licence texts do not say it. */
	copyright?: string;
	/** Where the component comes from and how it was changed, in lines of text. */
	about?: string[];
	/** Where the component lies in the VSIX. */
	shippedIn: string;
	/** The licence and notice files, each with its name and text. */
	texts: { file: string; text: string }[];
}

/** The npm packages esbuild.mjs copies into the preview's media rather than bundles, and where they land. */
export const COPIED_PACKAGES: Record<string, string> = {
	'@highlightjs/cdn-assets': 'dist/media/highlight/',
	mathjax: 'dist/media/mathjax/',
};

/** A stylesheet the VSIX holds that no package declares under its own licence, with the folder of its licence texts. */
export interface Stylesheet {
	name: string;
	licence: string;
	origin: string;
	copyright: string;
	about: string[];
	/** Where the stylesheet lies in the VSIX, as the notices say it. */
	shippedIn: string;
	/** Each of its files in the VSIX, which the SBOM lists. */
	files: string[];
	folder: string;
}

/** The preview's stylesheet, taken from FluentMark AE, which is under the licences of the projects it comes from. */
export const DEFAULT_CSS: Stylesheet = {
	name: 'default.css of the preview',
	licence: 'EPL-1.0 AND MIT',
	origin: 'https://github.com/advantest/fluentmark',
	copyright: 'Certiv Analytics (Gerald Rosenberg), Advantest Europe GmbH, Andy Ferra, Nicolas Gallagher and Jonathan Neal',
	about: [
		'FluentMark AE\'s advantest.css: FluentMark\'s github.css by Certiv Analytics (Gerald Rosenberg) under the',
		'Eclipse Public License 1.0, adapted by Advantest Europe GmbH. It is based on the stylesheet',
		'https://gist.github.com/andyferra/2554919 by Andy Ferra and embeds normalize.css 8.0.0 by Nicolas',
		'Gallagher and Jonathan Neal, under the MIT License.',
	],
	shippedIn: 'dist/media/default.css',
	files: ['dist/media/default.css'],
	folder: 'third-party/default.css',
};

/**
 * The styles of code highlight.js brings for Stack Overflow. They come with @highlightjs/cdn-assets, which is under
 * the BSD 3-Clause License, but they are under the MIT License of Stack Exchange's design system.
 */
export const STACKOVERFLOW_CSS: Stylesheet = {
	name: 'StackOverflow styles of highlight.js',
	licence: 'MIT',
	origin: 'https://github.com/StackExchange/Stacks',
	copyright: 'Stack Exchange Inc.',
	about: [
		'stackoverflow-light.min.css and stackoverflow-dark.min.css of @highlightjs/cdn-assets, unchanged: the colours',
		'of code on stackoverflow.com, from Stack Exchange\'s design system Stacks, under the MIT License.',
	],
	shippedIn: 'dist/media/highlight/stackoverflow-light.min.css and stackoverflow-dark.min.css',
	files: ['dist/media/highlight/stackoverflow-light.min.css', 'dist/media/highlight/stackoverflow-dark.min.css'],
	folder: 'third-party/stackoverflow.css',
};

/** The stylesheets declared by hand, in the order the notices list them after the packages. */
export const STYLESHEETS: Stylesheet[] = [DEFAULT_CSS, STACKOVERFLOW_CSS];

const LICENCE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotices)(\.[a-z]+)?$/i;

/**
 * The folders of the npm packages whose files esbuild bundled, from the inputs of its metafile, e.g.
 * `node_modules/a/node_modules/b/lib/x.js` yields `node_modules/a/node_modules/b`.
 */
export function bundledPackages(inputs: string[]): string[] {
	const folders = new Set<string>();
	for (const input of inputs) {
		const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, '/'));
		if (match) {
			folders.add(match[1]);
		}
	}
	return [...folders].sort();
}

/** A web address for a package's repository as package.json names it, e.g. `git+https://x/y.git`. */
export function repositoryAddress(repository: unknown): string | undefined {
	const url = typeof repository === 'string' ? repository : (repository as { url?: unknown } | undefined)?.url;
	if (typeof url !== 'string') {
		return undefined;
	}
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
		return `https://github.com/${url}`;
	}
	return url
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/^ssh:\/\/git@/, 'https://')
		.replace(/^git@([^:]+):/, 'https://$1/')
		.replace(/\.git$/, '');
}

/** Reads the licence and notice files lying directly in a folder; fails if there is none. */
export async function readLicenceTexts(folder: string, accept: RegExp = LICENCE_FILE): Promise<{ file: string; text: string }[]> {
	const files = (await readdir(folder, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && accept.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	if (files.length === 0) {
		throw new Error(`${folder} holds no licence file.`);
	}
	return Promise.all(files.map(async (file) => ({ file, text: (await readFile(path.join(folder, file), 'utf8')).replace(/\r\n/g, '\n') })));
}

/** Reads an npm package: its name, version, licence and where it comes from, and the texts of its licence. */
export async function readPackage(folder: string, shippedIn: string): Promise<Component> {
	const json = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')) as Record<string, unknown>;
	const licence = json.license;
	if (typeof json.name !== 'string' || typeof json.version !== 'string' || typeof licence !== 'string') {
		throw new Error(`${folder}/package.json names no name, version or licence.`);
	}
	return {
		name: json.name,
		version: json.version,
		licence,
		origin: repositoryAddress(json.repository) ?? (typeof json.homepage === 'string' ? json.homepage : undefined),
		shippedIn,
		texts: await readLicenceTexts(folder),
	};
}

/** The components the VSIX holds besides the server: the bundled and copied npm packages and the stylesheets. */
export async function shippedComponents(root: string, bundledInputs: string[]): Promise<Component[]> {
	const components: Component[] = [];
	for (const folder of bundledPackages(bundledInputs)) {
		components.push(await readPackage(path.join(root, folder), 'dist/extension.js'));
	}
	for (const [name, shippedIn] of Object.entries(COPIED_PACKAGES)) {
		components.push(await readPackage(path.join(root, 'node_modules', name), shippedIn));
	}
	components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
	for (const { name, licence, origin, copyright, about, shippedIn, folder } of STYLESHEETS) {
		const texts = await readLicenceTexts(path.join(root, folder), /\.(txt|md)$/);
		components.push({ name, version: '', licence, origin, copyright, about, shippedIn, texts });
	}
	return components;
}

const RULE = '='.repeat(100);
const LINE = '-'.repeat(100);

/** The text of ThirdPartyNotices.txt: a summary of the components, then each with its licence and notices. */
export function renderNotices(extension: { displayName: string; version: string }, components: Component[]): string {
	const title = (component: Component) => `${component.name}${component.version ? ` ${component.version}` : ''}`;
	const out = [
		`${extension.displayName} ${extension.version}: third-party components`,
		'',
		'The extension is made available under the BSD 3-Clause License, see LICENSE. It holds the components',
		'below, each under its own licence. The language server markdown-ls in server/ and the libraries it',
		'needs are listed in server/THIRD-PARTY.txt, with the texts of their licences and notices in',
		'server/licenses/ and server/notices/ and the sources of those under the GPL in server/sources/.',
		'',
		...components.map((component) => `- ${title(component)} (${component.licence}), in ${component.shippedIn}`),
	];
	for (const component of components) {
		out.push('', RULE, title(component), `Licence: ${component.licence}`);
		if (component.origin) {
			out.push(`Source: ${component.origin}`);
		}
		if (component.copyright) {
			out.push(`Copyright: ${component.copyright}`);
		}
		out.push(`Shipped in: ${component.shippedIn}`);
		if (component.about) {
			out.push('', ...component.about);
		}
		for (const { file, text } of component.texts) {
			out.push(LINE, `${file}:`, '', text.trimEnd());
		}
	}
	return out.join('\n') + '\n';
}
