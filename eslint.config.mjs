import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
	{ ignores: ['dist/', 'out/', 'coverage/', '.vscode-test/'] },
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ['**/*.mjs'],
		languageOptions: {
			globals: { console: 'readonly', process: 'readonly' },
		},
	},
	{
		rules: {
			// A parameter a signature requires but the implementation does not use is named with a leading "_".
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
);
