import js from '@eslint/js'
import globals from 'globals'

/** 后端 ESLint（flat config）：Node.js 环境、ESM，宽松规则以适配存量代码 */
export default [
  {
    ignores: ['node_modules/**', 'data/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // 未使用变量降为 warn（不阻塞 CI），带下划线前缀视为有意省略
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // 空 catch 允许（探测路径存在性、并发间隙文件消失等可忽略错误）；约定：每个空 catch 必须带行内注释说明「为什么可吞」
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]