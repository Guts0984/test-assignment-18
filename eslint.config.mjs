import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports.',
};
const noClass = {
  selector: 'ClassDeclaration, ClassExpression',
  message: 'Classes are only allowed for NestJS constructs.',
};
const noProcessEnv = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'Only src/config/env.ts may read process.env.',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': ['error', noDefaultExport, noProcessEnv],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', noDefaultExport, noProcessEnv, noClass] },
  },
  {
    // The only readers of process.env.
    files: ['**/src/config/env.ts'],
    rules: { 'no-restricted-syntax': ['error', noDefaultExport, noClass] },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { 'no-restricted-syntax': ['error', noDefaultExport] },
  },
  {
    files: ['**/*.config.{ts,mts,mjs}', 'vitest.database.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
);
