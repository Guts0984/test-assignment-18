import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  { ignores: ['**/generated/**', '**/*.spec.ts'] },
  {
    // A slice used by one page is still a feature; it is not folded into that page.
    rules: { 'fsd/insignificant-slice': 'off', 'fsd/repetitive-naming': 'off' },
  },
]);
