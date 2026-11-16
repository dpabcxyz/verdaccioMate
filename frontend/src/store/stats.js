/**
 * 派生统计与格式化工具 —— store/index.js 抽离
 */
import { computed } from 'vue'
import { state } from './state.js'

export const stats = computed(() => {
  const valid = state.packages.filter(p => p.status !== 'broken')
  // 私有包 / 缓存包拆分（origin: 'private' | 'proxy'；异常包 origin 为 null 不纳入）
  const byOrigin = o => valid.filter(p => p.origin === o)
  const privatePkgs = byOrigin('private')
  const proxyPkgs = byOrigin('proxy')
  const sumBy = (list, k) => list.reduce((s, p) => s + (p[k] || 0), 0)
  // 总占用统计全部物理缓存（含元数据异常的包，其大小按实际 .tgz 计算）
  const totalSize = state.packages.reduce((s, p) => s + p.size, 0)
  const warnCount = valid.filter(p => p.status === 'warn').length
  const cleanable = valid.filter(p => p.status === 'warn').reduce((s, p) => s + p.size, 0)
  const maxPkg = [...valid].sort((a, b) => b.size - a.size)[0] || null
  const oldestPkg = [...valid].sort((a, b) => (a.lastUpdated || '').localeCompare(b.lastUpdated || ''))[0] || null
  // 今日更新包数：最近更新时间等于今天的包数量
  const d = new Date()
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayUpdated = valid.filter(p => (p.lastUpdated || '') === todayStr).length
  const todayUpdatedPrivate = privatePkgs.filter(p => (p.lastUpdated || '') === todayStr).length
  const todayUpdatedProxy = proxyPkgs.filter(p => (p.lastUpdated || '') === todayStr).length
  // 真实环境无访问统计（visits 全 0）时，Top20 降级为「缓存占用 Top 20」
  const hasVisits = valid.some(p => (p.visits || 0) > 0)
  const top30 = [...valid]
    .sort((a, b) => (hasVisits ? (b.visits || 0) - (a.visits || 0) : b.size - a.size))
    .slice(0, 20)
  const maxVisit = Math.max(...top30.map(p => p.visits || 0), 1)
  const maxSize = Math.max(...top30.map(p => p.size), 1)
  return {
    pkgCount: valid.length,
    totalVersions: state.packages.reduce((s, p) => s + (p.versions || 0), 0),
    totalSize,
    // 私有 / 缓存拆分（供统计卡分段条使用）
    privateCount: privatePkgs.length,
    proxyCount: proxyPkgs.length,
    privateVersions: sumBy(privatePkgs, 'versions'),
    proxyVersions: sumBy(proxyPkgs, 'versions'),
    privateSize: sumBy(privatePkgs, 'size'),
    proxySize: sumBy(proxyPkgs, 'size'),
    // 总占用优先用后端「目录所有文件字节和」（与 du 一致），否则回退到包大小之和
    totalSizeText: state.totalBytes != null ? fmtBytes(state.totalBytes) : fmtSize(totalSize),
    warnCount,
    cleanable,
    cleanableText: fmtSize(cleanable),
    todayUpdated,
    todayUpdatedPrivate,
    todayUpdatedProxy,
    maxPkg,
    oldestPkg,
    top30: top30.map(p => ({
      ...p,
      heat: hasVisits
        ? Math.round(((p.visits || 0) / maxVisit) * 100)
        : Math.round((p.size / maxSize) * 100),
    })),
    top30By: hasVisits ? 'visits' : 'size',
  }
})

export function fmtSize(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 0.05) return `${mb.toFixed(1)} MB`
  if (mb > 0) return `${Math.max(1, Math.round(mb * 1024))} KB`
  return '0 MB'
}

/** 字节 → 可读文本 */
export function fmtBytes(b) {
  const mb = b / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 0.05) return `${mb.toFixed(1)} MB`
  if (mb > 0) return `${Math.max(1, Math.round(mb * 1024))} KB`
  return '0 MB'
}