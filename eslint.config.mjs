/*
 * Copyright © 2026 Advantest Europe GmbH
 * SPDX-License-Identifier: BSD-3-Clause
 */

import css from '@eslint/css';
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Every file of our own starts with the copyright notice and the SPDX identifier of its licence. The year or year
// range is left as the authors wrote it. "npx eslint --fix" adds a missing header with the current year.
const HEADER = /^\/\*\r?\n \* Copyright © \d{4}(-\d{4})? Advantest Europe GmbH\r?\n \* SPDX-License-Identifier: BSD-3-Clause\r?\n \*\/\r?\n/;

const licence = {
	rules: {
		header: {
			meta: {
				type: 'problem',
				fixable: 'code',
				messages: { missing: 'The file does not start with the copyright notice and the SPDX licence identifier.' },
			},
			create(context) {
				const text = context.sourceCode.text;
				if (!HEADER.test(text)) {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: 'missing',
						fix: (fixer) => fixer.insertTextBeforeRange([0, 0],
							`/*\n * Copyright © ${new Date().getFullYear()} Advantest Europe GmbH\n * SPDX-License-Identifier: BSD-3-Clause\n */\n\n`),
					});
				}
				return {};
			},
		},
	},
};

const code = ['**/*.ts', '**/*.mjs'];

export default defineConfig(
	{
		ignores: [
			'dist/', 'out/', 'coverage/', '.vscode-test/', 'server/',
			// Taken from FluentMark AE; it is not ours alone and keeps the notices of its authors.
			'media/default.css',
		],
	},
	{
		files: code,
		extends: [eslint.configs.recommended, tseslint.configs.recommended],
		rules: {
			// A parameter a signature requires but the implementation does not use is named with a leading "_".
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['**/*.mjs'],
		languageOptions: {
			globals: { console: 'readonly', process: 'readonly' },
		},
	},
	{
		files: [...code, 'media/**/*.js'],
		plugins: { licence },
		rules: { 'licence/header': 'error' },
	},
	{
		files: ['**/*.css'],
		language: 'css/css',
		plugins: { css, licence },
		rules: { 'licence/header': 'error' },
	},
);