import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // any を段階的に減らすなら warn に落とす
      '@typescript-eslint/no-explicit-any': 'warn',

      // 不可視空白は基本は直すの推奨だが、必要なら一時的に緩和も可能
      // 'no-irregular-whitespace': 'off',
    },
  },
  {
    files: ['src/**/*Context.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
