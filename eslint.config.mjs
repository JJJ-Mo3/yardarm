import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'vendor/**', 'build/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // The codebase intentionally syncs server state into local editable
      // state inside effects (guarded by dirty flags); these v7 compiler
      // rules flag that pattern wholesale.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off'
    }
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  },
  prettier
)
