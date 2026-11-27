import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'server/dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Server and shared code must stay free of browser stores, services and
    // browser-only modules (frontend state, UI libraries, the `@/` alias).
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/store/**', '**/src/services/**'],
              message:
                'server/ and shared/ must not import src/store/* or src/services/* (browser state and mock services).',
            },
            {
              group: [
                '**/src/components/**',
                '**/src/hooks/**',
                '**/src/app/**',
                '@/*',
              ],
              message:
                'server/ and shared/ must not import browser-only frontend modules.',
            },
            {
              group: [
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'react-router-dom',
                'zustand',
                'zustand/*',
                '@tanstack/react-query',
                '@radix-ui/*',
                'framer-motion',
                'lucide-react',
                'jspdf',
                'jsqr',
                'qrcode',
              ],
              message: 'Browser-only package; not allowed in server/ or shared/.',
            },
          ],
        },
      ],
    },
  }
);
