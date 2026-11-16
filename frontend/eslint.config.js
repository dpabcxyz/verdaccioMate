import { readFileSync } from 'node:fs'
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

// unplugin-auto-import 生成的全局 API 清单（dev/build 后产出；文件尚未生成时静默跳过）
let autoImportGlobals = {}
try {
  autoImportGlobals = JSON.parse(readFileSync(new URL('./.eslintrc-auto-import.json', import.meta.url), 'utf8')).globals || {}
} catch { /* 尚未生成，忽略 */ }

/** 前端 ESLint（flat config）：浏览器环境 + Vue3，宽松规则以适配存量代码（与 backend/eslint.config.js 风格对齐） */
export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.tmp-api-verify/**'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...autoImportGlobals },
    },
    rules: {
      // 未使用变量降为 warn（不阻塞 CI），带下划线前缀视为有意省略
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // 空 catch 允许（探测路径存在性、可忽略错误等）；约定：每个空 catch 必须带行内注释说明「为什么可吞」
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Node 环境文件：构建配置与测试/守护脚本
    files: ['vite.config.js', 'scripts/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]