import * as assert from 'node:assert/strict';
import { reportDeclaredServerProblem, reportStartFailure, type ReportTarget } from '../../src/report';
import { LaunchError } from '../../src/server';

describe('reportStartFailure', () => {
	it('shows the message of a wrong setting with a button that opens the settings editor at that setting', async () => {
		const target = fake('Open Settings');

		const message = 'No Java 21 was found in /jdk-17 set in markdownSupport.java.home.';

		await reportStartFailure(new LaunchError(message, 'markdownSupport.java.home'), target);

		assert.deepEqual(target.shown, [[message, 'Open Settings']]);
		assert.deepEqual(target.commands, [['workbench.action.openSettings', '@id:markdownSupport.java.home']]);
	});

	it('shows a failure that no setting fixes without a button', async () => {
		const target = fake(undefined);

		await reportStartFailure(new LaunchError('The JAR /ext/server/markdown-ls.jar does not exist.'), target);

		assert.deepEqual(target.shown, [
			['The Markdown language server could not be started: The JAR /ext/server/markdown-ls.jar does not exist.'],
		]);
	});

	it('opens nothing if the message is dismissed', async () => {
		const target = fake(undefined);

		await reportStartFailure(new LaunchError('wrong', 'markdownSupport.java.home'), target);

		assert.deepEqual(target.commands, []);
	});

	it('shows another failure without a button', async () => {
		const target = fake(undefined);

		await reportStartFailure(new Error('Server initialization failed.'), target);

		assert.deepEqual(target.shown, [
			['The Markdown language server could not be started: Server initialization failed.'],
		]);
	});

	it('logs every failure', async () => {
		const target = fake(undefined);

		await reportStartFailure(new LaunchError('wrong', 'markdownSupport.java.home'), target);
		await reportStartFailure('broken', target);

		assert.deepEqual(target.logged, ['wrong', 'broken']);
	});
});

describe('reportDeclaredServerProblem', () => {
	it('logs the problem and shows that the features of the declared server are missing', async () => {
		const target = fake(undefined);

		await reportDeclaredServerProblem('several extensions declare a server, only one may: a.one, b.two', target);

		assert.deepEqual(target.logged, ['several extensions declare a server, only one may: a.one, b.two']);
		assert.deepEqual(target.shown, [
			[
				'The language server another extension declares is not started, so the features it adds are missing: ' +
					'several extensions declare a server, only one may: a.one, b.two. ' +
					'The server bundled with the extension is started instead.',
			],
		]);
	});
});

type FakeTarget = ReportTarget & { shown: string[][]; commands: unknown[][]; logged: string[] };

function fake(choice: string | undefined): FakeTarget {
	const target = {
		shown: [] as string[][],
		commands: [] as unknown[][],
		logged: [] as string[],
		log: (message: string) => {
			target.logged.push(message);
		},
		showError: async (message: string, ...actions: string[]) => {
			target.shown.push([message, ...actions]);
			return choice;
		},
		executeCommand: async (command: string, ...args: unknown[]) => {
			target.commands.push([command, ...args]);
		},
	};
	return target;
}
