import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

const regrasComuns = {
  ...js.configs.recommended.rules,
  'no-console': 'off',
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }
  ]
};

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    'coverage/**',
    'storage/**',
    'test-results/**',
    'playwright-report/**',
    'artifacts/**',
    // Cópia local de um projeto externo mantida apenas como referência
    // visual do redesenho; possui repositório e ferramental próprios.
    'Evidentia/**'
  ]),
  {
    files: ['src/server/**/*.js', 'tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module'
    },
    rules: regrasComuns
  },
  {
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      sourceType: 'script'
    },
    rules: {
      ...regrasComuns,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
        ...globals.browser
      },
      sourceType: 'module'
    },
    rules: regrasComuns
  },
  {
    files: ['src/server/modules/integrations/google-calendar/google-calendar.routes.js'],
    rules: {
      'no-control-regex': 'off'
    }
  }
]);
