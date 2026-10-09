import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // SQL built by hand is an injection waiting to happen: values always go through ? placeholders
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(query|execute)$/] > TemplateLiteral[expressions.length>0]',
          message:
            'SQL : utilise des ? et un tableau de valeurs, jamais ${} ni + dans la requete (injection SQL).',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(query|execute)$/] > BinaryExpression[operator='+']",
          message:
            'SQL : utilise des ? et un tableau de valeurs, jamais ${} ni + dans la requete (injection SQL).',
        },
      ],
    },
  },
]);
