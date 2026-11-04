import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { acceptedVersion, type InstalledExtension, parseVersion } from '../../src/declaration';
import { chooseServer, type ExtensionInfo } from '../../src/server';

const PIN = { defaultServer: { version: '1.2.0-SNAPSHOT' }, declaredServer: { minimumVersion: '1.1' } };
const own = (development = false, pin: unknown = PIN): ExtensionInfo => ({
	extensionPath: '/ext',
	packageJSON: { markdownSupport: pin },
	development,
});
const BUNDLED = {
	path: path.join('/ext', 'server', 'markdown-ls.jar'),
	description: 'markdown-ls 1.2.0-SNAPSHOT, bundled with the extension',
};
const OTHER: InstalledExtension = { id: 'some.other', extensionPath: '/other', packageJSON: { name: 'other' } };

function declaring(id: string, server: unknown): InstalledExtension {
	return { id, extensionPath: path.join('/stubs', id), packageJSON: { markdownSupport: { server } } };
}
const VALID = declaring('stub.valid', { jar: 'server/launcher.jar', markdownLs: '1.1.0' });
const VALID_JAR = path.join('/stubs', 'stub.valid', 'server', 'launcher.jar');

/** Answers whether a path is a file: only the paths given are. */
function files(...paths: string[]): (candidate: string) => Promise<boolean> {
	return async (candidate) => paths.includes(candidate);
}

describe('chooseServer', () => {
	it('is the bundled server if no extension declares one', async () => {
		assert.deepEqual(await chooseServer(own(), [OTHER], {}, files()), { jar: BUNDLED });
	});

	it('is the server an extension declares, its JAR relative to the folder of that extension', async () => {
		assert.deepEqual(await chooseServer(own(), [OTHER, VALID], {}, files(VALID_JAR)), {
			jar: { path: VALID_JAR, description: 'markdown-ls 1.1.0, declared by the extension stub.valid' },
		});
	});

	it('accepts markdown-ls of the bundled major version from the minimum minor version on, pre-releases as well', async () => {
		for (const version of ['1.1.0', '1.1.0-SNAPSHOT', '1.1.7', '1.9.0', '1.3.0+build.5']) {
			const declared = declaring('stub.valid', { jar: 'server/launcher.jar', markdownLs: version });

			const choice = await chooseServer(own(), [declared], {}, files(VALID_JAR));

			assert.equal(choice.jar.path, VALID_JAR, version);
			assert.equal(choice.problem, undefined, version);
		}
	});

	it('starts the bundled server and names the problem for a version not accepted', async () => {
		for (const version of ['2.0.0', '0.9.0', '1.0.9', '1.0.0-SNAPSHOT']) {
			const declared = declaring('stub.old', { jar: 'server/launcher.jar', markdownLs: version });

			const choice = await chooseServer(own(), [declared], {}, files(path.join('/stubs', 'stub.old', 'server', 'launcher.jar')));

			assert.deepEqual(choice.jar, BUNDLED, version);
			assert.equal(
				choice.problem,
				`the extension stub.old declares a server with markdown-ls ${version}, but only markdown-ls 1.x from 1.1 on is accepted`,
			);
		}
	});

	it('starts the bundled server and names the problem for a declared JAR that does not exist', async () => {
		const choice = await chooseServer(own(), [VALID], {}, files());

		assert.deepEqual(choice, {
			jar: BUNDLED,
			problem: `the JAR ${VALID_JAR}, which the extension stub.valid declares, does not exist`,
		});
	});

	it('starts the bundled server and names the problem for an invalid declaration', async () => {
		const cases: [unknown, RegExp][] = [
			['server.jar', /stub\.bad declares a server without a JAR in markdownSupport\.server\.jar/],
			[{}, /stub\.bad declares a server without a JAR/],
			[{ jar: ' ', markdownLs: '1.1.0' }, /stub\.bad declares a server without a JAR/],
			[{ jar: 'a.jar' }, /stub\.bad declares a server without the version of markdown-ls in markdownSupport\.server\.markdownLs/],
			[{ jar: 'a.jar', markdownLs: 'latest' }, /stub\.bad declares markdown-ls "latest", which is no version/],
			[{ jar: 'a.jar', markdownLs: 1 }, /stub\.bad declares markdown-ls 1, which is no version/],
			[{ jar: path.resolve('/elsewhere/a.jar'), markdownLs: '1.1.0' }, /stub\.bad declares the JAR .*a\.jar, which is not in its folder/],
			[{ jar: '../a.jar', markdownLs: '1.1.0' }, /stub\.bad declares the JAR \.\.\/a\.jar, which is not in its folder/],
		];
		for (const [server, problem] of cases) {
			const choice = await chooseServer(own(), [declaring('stub.bad', server)], {}, async () => true);

			assert.deepEqual(choice.jar, BUNDLED, JSON.stringify(server));
			assert.match(choice.problem ?? '', problem);
		}
	});

	it('starts the bundled server if several extensions declare one, even if each is valid', async () => {
		const second = declaring('stub.second', { jar: 'server/launcher.jar', markdownLs: '1.1.0' });

		const choice = await chooseServer(own(), [VALID, OTHER, second], {}, async () => true);

		assert.deepEqual(choice, {
			jar: BUNDLED,
			problem: 'several extensions declare a server, only one may: stub.valid, stub.second',
		});
	});

	it('accepts no declared server if the extension pins no version of its bundled server', async () => {
		const choice = await chooseServer(own(false, {}), [VALID], {}, files(VALID_JAR));

		assert.equal(choice.jar.path, BUNDLED.path);
		assert.match(choice.problem ?? '', /names no version of the server it bundles/);
	});

	it('prefers the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names to a declared one, and reads no declaration', async () => {
		const choice = await chooseServer(
			own(true),
			[VALID, declaring('stub.bad', {})],
			{ MARKDOWN_SUPPORT_TEST_SERVER_JAR: '/dev/markdown-ls.jar' },
			files(VALID_JAR),
		);

		assert.deepEqual(choice, {
			jar: { path: '/dev/markdown-ls.jar', description: 'the server MARKDOWN_SUPPORT_TEST_SERVER_JAR names' },
		});
	});

	it('ignores MARKDOWN_SUPPORT_TEST_SERVER_JAR in an installed extension', async () => {
		const choice = await chooseServer(
			own(false),
			[VALID],
			{ MARKDOWN_SUPPORT_TEST_SERVER_JAR: '/dev/markdown-ls.jar' },
			files(VALID_JAR),
		);

		assert.equal(choice.jar.path, VALID_JAR);
	});
});

describe('parseVersion', () => {
	it('reads the major and the minor version, ignoring the patch, a pre-release and build metadata', () => {
		assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2 });
		assert.deepEqual(parseVersion('1.2'), { major: 1, minor: 2 });
		assert.deepEqual(parseVersion('10.20.30-SNAPSHOT'), { major: 10, minor: 20 });
		assert.deepEqual(parseVersion('1.2.3-rc.1+build.7'), { major: 1, minor: 2 });
	});

	it('answers undefined for what is no version', () => {
		for (const text of ['', '1', 'one.two', ' 1.2.3', '1.2.3.4', 'v1.2.3', 1.2, undefined]) {
			assert.equal(parseVersion(text), undefined, String(text));
		}
	});
});

describe('acceptedVersion', () => {
	it('is the major version of the bundled server from the minimum minor version on', () => {
		assert.deepEqual(acceptedVersion({ markdownSupport: PIN }), { major: 1, minor: 1 });
	});

	it('is every minor version of the bundled major version if no minimum is named, or one of another major version', () => {
		assert.deepEqual(acceptedVersion({ markdownSupport: { defaultServer: { version: '1.2.0' } } }), { major: 1, minor: 0 });
		assert.deepEqual(
			acceptedVersion({ markdownSupport: { defaultServer: { version: '2.2.0' }, declaredServer: { minimumVersion: '1.1' } } }),
			{ major: 2, minor: 0 },
		);
	});

	it('is undefined without a version of the bundled server', () => {
		assert.equal(acceptedVersion({}), undefined);
	});
});

describe('the package.json of the extension', () => {
	const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
		markdownSupport: { server?: unknown; defaultServer: { version: string }; declaredServer: { minimumVersion: string } };
	};

	it('names a minimum version of a declared server of the major version it bundles, no newer than that', () => {
		const bundled = parseVersion(manifest.markdownSupport.defaultServer.version);
		const minimum = parseVersion(manifest.markdownSupport.declaredServer.minimumVersion);

		assert.ok(bundled && minimum, 'both are versions');
		assert.equal(minimum.major, bundled.major);
		assert.ok(minimum.minor <= bundled.minor, 'the bundled server is accepted itself');
	});

	it('declares no server itself, since that key is for other extensions', () => {
		assert.equal(manifest.markdownSupport.server, undefined);
	});
});
