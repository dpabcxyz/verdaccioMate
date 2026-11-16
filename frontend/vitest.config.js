import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// 渲染/行为测试专用配置：与 node --test（check-ui、mcp 逻辑测试）并存，互不越界
// 必须合并 vite.config.js——继承 vue() 插件（否则 .vue 单文件无法转换），AutoImport/Components 同理
// include 仅限 render/store 前缀，避免 vitest 扫到 node:test 风格的 mcp.test.mjs
export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    include: ['scripts/render.test.mjs', 'scripts/store.test.mjs'],
    globals: false,
  },
}))