// Lint of the three parts (core, runner, editor). Only two rules, both block the build:
// a semicolon at the end of every statement (and type member) and no explicit `any`.
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  {ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.local*/**']},
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {parser: tseslint.parser},
    plugins: {'@typescript-eslint': tseslint.plugin, '@stylistic': stylistic},
    linterOptions: {reportUnusedDisableDirectives: 'error'},
    rules: {
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/member-delimiter-style': ['error', {
        multiline: {delimiter: 'semi', requireLast: true},
        singleline: {delimiter: 'semi', requireLast: false},
      }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
