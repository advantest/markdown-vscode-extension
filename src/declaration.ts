import * as path from 'node:path';

/**
 * An installed extension, as far as reading its declaration of a server needs it. Another extension may declare a
 * server in its package.json, `"markdownSupport": { "server": { "jar": …, "markdownLs": … } }`, which is started in
 * place of the bundled one. `jar` is relative to the folder of that extension; `markdownLs` is the version of
 * markdown-ls the declared server holds.
 */
export interface InstalledExtension {
	id: string;
	extensionPath: string;
	packageJSON: unknown;
}

/** The major and the minor version of a semantic version. */
export interface Version {
	major: number;
	minor: number;
}

/** A declaration that is valid as such; whether its version is accepted and its JAR exists is checked later. */
export interface Declaration {
	id: string;
	jar: string;
	markdownLs: string;
	version: Version;
}

const VERSION = /^(\d+)\.(\d+)(?:\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)?$/;

/** Reads the major and the minor version; a patch version, a pre-release such as `-SNAPSHOT` and build metadata are ignored. */
export function parseVersion(text: unknown): Version | undefined {
	const match = typeof text === 'string' ? VERSION.exec(text) : null;
	return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

/**
 * The versions of markdown-ls a declared server may hold: the major version of the bundled server, from the minimum
 * minor version on that the package.json of the extension names. Without a minimum of that major version, every minor
 * version is accepted. Undefined if the extension names no version of the server it bundles.
 */
export function acceptedVersion(packageJSON: unknown): Version | undefined {
	const settings = markdownSupport(packageJSON);
	const bundled = parseVersion(field(field(settings, 'defaultServer'), 'version'));
	if (!bundled) {
		return undefined;
	}
	const minimum = parseVersion(field(field(settings, 'declaredServer'), 'minimumVersion'));
	return { major: bundled.major, minor: minimum?.major === bundled.major ? minimum.minor : 0 };
}

export function accepts(accepted: Version, version: Version): boolean {
	return version.major === accepted.major && version.minor >= accepted.minor;
}

/** The extensions that declare a server, whether validly or not. */
export function declaringExtensions(installed: readonly InstalledExtension[]): InstalledExtension[] {
	return installed.filter((extension) => field(markdownSupport(extension.packageJSON), 'server') !== undefined);
}

/** Reads the declaration of an extension; a string says what is wrong with it. */
export function readDeclaration(extension: InstalledExtension): Declaration | string {
	const declared = field(markdownSupport(extension.packageJSON), 'server');
	const jar = field(declared, 'jar');
	const what = `the extension ${extension.id} declares`;
	if (typeof jar !== 'string' || jar.trim() === '') {
		return `${what} a server without a JAR in markdownSupport.server.jar`;
	}
	const markdownLs = field(declared, 'markdownLs');
	if (markdownLs === undefined) {
		return `${what} a server without the version of markdown-ls in markdownSupport.server.markdownLs`;
	}
	const version = parseVersion(markdownLs);
	if (!version) {
		return `${what} markdown-ls ${JSON.stringify(markdownLs)}, which is no version`;
	}
	const normalized = path.normalize(jar);
	if (path.isAbsolute(jar) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		return `${what} the JAR ${jar}, which is not in its folder`;
	}
	return { id: extension.id, jar: path.join(extension.extensionPath, jar), markdownLs: markdownLs as string, version };
}

function markdownSupport(packageJSON: unknown): unknown {
	return field(packageJSON, 'markdownSupport');
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
