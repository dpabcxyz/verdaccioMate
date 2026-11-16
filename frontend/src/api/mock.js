/**
 * Mock 基础设施 —— 演示模式开关、内存态与辅助函数
 * 各领域 API 模块通过 USE_MOCK 分支复用这里的内存态，模拟服务端持久化
 */
import { reactive } from 'vue'
import * as mock from '../mock/data.js'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// —— mock 内存态（模拟服务端持久化） ——
export const mockState = reactive({
  versionThreshold: 15,
  sizeThreshold: 500,
  exceptions: [
    { pkgName: 'tensorflow', versionThreshold: 30, sizeThreshold: 2000 },
  ],
  ignored: new Set(['moment', '@vue/compiler-sfc', 'mocha', 'cheerio']),
  packages: /** @type {import('../types.js').PackageInfo[]} */ ([...mock.packages]),
  logs: /** @type {import('../types.js').LogEntry[]} */ ([...mock.logs]),
  mcpKeys: [],
})

// 演示态的 Key 明文表：列表仍只出掩码，reveal 从这里取，与后端的「密文可回看」保持一致
export const mockMcpKeyValues = new Map()

export function delay(ms = 180) {
  return new Promise(r => setTimeout(r, ms))
}

export function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

// 包排序：预警置顶 → 正常 → 忽略；同状态按版本数降序
export function sortPackages(list) {
  const rank = { warn: 0, ok: 1, ignored: 2, broken: 3 }
  return [...list].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    return b.versions - a.versions
  })
}

export function computeStatus(p, threshold) {
  if (p.status === 'ignored') return 'ignored'
  if (p.status === 'broken') return 'broken'
  return p.versions > threshold ? 'warn' : 'ok'
}