import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
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

/** Feature-Sliced Design layers, top first. A layer may import only the layers after it. */
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const SLICED = ['pages', 'widgets', 'features', 'entities'];
const element = (type) => ({ element: { type } });

const layerPolicies = LAYERS.flatMap((layer, index) => {
  const below = [...LAYERS.slice(index + 1), 'config'];
  const allowed = [
    { from: element(layer), allow: { to: { element: { types: below } } } },
    // `app` and `shared` have no slices, so their own folders may use each other.
    ...(SLICED.includes(layer) ? [] : [{ from: element(layer), allow: { to: element(layer) } }]),
  ];
  const ownSlice = SLICED.includes(layer)
    ? [
        {
          from: element(layer),
          allow: {
            to: {
              element: {
                type: layer,
                captured: { slice: '{{ from.element.captured.slice }}' },
              },
            },
          },
        },
      ]
    : [];
  return [...allowed, ...ownSlice];
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/next-env.d.ts',
    ],
  },
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
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-restricted-syntax': ['error', noDefaultExport, noProcessEnv],
    },
  },
  {
    // NestJS and Express describe plain option objects with classes.
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    rules: { '@typescript-eslint/no-unsafe-class-instance-assignment': 'off' },
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
    files: ['**/*.spec.ts', 'apps/*/test/**/*.ts', 'tests/**/*.ts', 'apps/web/e2e/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', noDefaultExport] },
  },
  {
    files: ['**/*.config.{ts,mts,mjs}', 'vitest.database.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', URL: 'readonly' } },
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, boundaries },
    settings: {
      'boundaries/root-path': `${import.meta.dirname}/apps/web`,
      'boundaries/elements': [
        ...SLICED.map((layer) => ({
          type: layer,
          pattern: `src/${layer}/*`,
          capture: ['slice'],
        })),
        { type: 'app', pattern: 'src/app' },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'config', pattern: 'src/config' },
      ],
      'import/resolver': {
        typescript: { project: `${import.meta.dirname}/apps/web/tsconfig.json` },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'boundaries/dependencies': ['error', { default: 'disallow', policies: layerPolicies }],
    },
  },
  {
    // Next route files must default-export; they stay thin wrappers around `src/pages`.
    files: ['apps/web/app/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', noProcessEnv] },
  },
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
);
