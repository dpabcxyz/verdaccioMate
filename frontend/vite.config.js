import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router'],
      // 生成 auto-imports.d.ts：tsc/vue-tsc 识别自动导入的全局 API；.eslintrc-auto-import.json 供 eslint 声明
      dts: true,
      eslintrc: { enabled: true },
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      // 生成 components.d.ts：模板中 el-* 组件的 props/事件类型
      dts: true,
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // 本地开发代理到后端 API
      '/api': {
        target: process.env.VCM_DEV_BACKEND || 'http://192.168.3.10:42338/',
        changeOrigin: true,
      },
      '/mcp': {
        target: process.env.VCM_DEV_BACKEND || 'http://192.168.3.10:42338/',
      },
    },
  },
})
