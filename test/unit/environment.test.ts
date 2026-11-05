import * as assert from 'node:assert/strict';
import { dependenciesText, plantUmlText, type ServerEnvironment } from '../../src/environment';

const ENVIRONMENT: ServerEnvironment = {
	libraries: [
		{ name: 'markdown-ls', version: '1.0.0' },
		{ name: 'flexmark', version: '0.64.8' },
	],
	plantUml: {
		version: '1.2026.4',
		securityProfile: 'INSECURE',
		urlAllowList: [],
		dotExecutable: 'C:\\Program Files\\Graphviz\\bin\\dot.exe',
		graphvizVersion: '12.2.1 (20241206.2353)',
	},
};

describe('the view of PlantUML and Graphviz', () => {
	it('shows the versions, the security profile, its URL allowlist and the dot executable', () => {
		assert.equal(
			plantUmlText({ environment: ENVIRONMENT }),
			'PlantUML library version: 1.2026.4\n' +
				'PlantUML security profile: INSECURE\n' +
				'PlantUML URL allowlist (for the security profile):\n' +
				'    -\n' +
				'Graphviz dot executable: C:\\Program Files\\Graphviz\\bin\\dot.exe\n' +
				'Graphviz version: 12.2.1 (20241206.2353)\n' +
				'\n' +
				'The setting markdownSupport.plantUml.dotExecutable names the dot executable.\n',
		);
	});

	it('lists each URL of the allowlist on a line of its own', () => {
		const environment = {
			...ENVIRONMENT,
			plantUml: { ...ENVIRONMENT.plantUml, urlAllowList: ['https://a.example/', 'https://b.example/'] },
		};

		assert.match(
			plantUmlText({ environment }),
			/\(for the security profile\):\n {4}https:\/\/a\.example\/\n {4}https:\/\/b\.example\/\nGraphviz/,
		);
	});

	it('says "unknown" where Graphviz was not found', () => {
		const environment = {
			...ENVIRONMENT,
			plantUml: { ...ENVIRONMENT.plantUml, dotExecutable: null, graphvizVersion: null },
		};

		const text = plantUmlText({ environment });

		assert.match(text, /^Graphviz dot executable: unknown$/m);
		assert.match(text, /^Graphviz version: unknown$/m);
	});

	it('says that the server is not running', () => {
		assert.match(plantUmlText({ notRunning: true }), /^The language server is not running/);
	});

	it('says why the server could not tell', () => {
		assert.equal(
			plantUmlText({ error: 'Unhandled method markdown/environment' }),
			'The language server could not tell: Unhandled method markdown/environment\n',
		);
	});
});

describe('the view of the dependencies', () => {
	it('lists the libraries in the order the server gives, their versions aligned', () => {
		assert.equal(
			dependenciesText({ environment: ENVIRONMENT }),
			'The libraries the language server runs with:\n' +
				'\n' +
				'markdown-ls  1.0.0\n' +
				'flexmark     0.64.8\n',
		);
	});

	it('says so where the server names none', () => {
		assert.match(dependenciesText({ environment: { ...ENVIRONMENT, libraries: [] } }), /none/);
	});

	it('says that the server is not running', () => {
		assert.match(dependenciesText({ notRunning: true }), /^The language server is not running/);
	});
});
