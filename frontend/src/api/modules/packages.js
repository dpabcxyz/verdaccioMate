/**
 * 包管理 API —— 概览统计、包列表/详情、版本清理、手动拉取
 */
import semverCompare from '../../utils/semver.js'
import * as mock from '../../mock/data.js'
import { authFetch } from '../http.js'
import { USE_MOCK, mockState, delay, clone, computeStatus, sortPackages } from '../mock.js'

export default {
  /**
   * 概览统计（由包列表在前端聚合，与后端 summary 口径一致：不含 broken 包）
   * @returns {Promise<import('../../types.js').Summary>}
   */
  async getSummary() {
    if (USE_MOCK) {
      await delay()
      return mock.summary()
    }
    const r = await authFetch('/api/packages')
    const { packages } = await r.json()
    const valid = packages.filter(p => p.status !== 'broken')
    const warnCount = valid.filter(p => p.status === 'warn').length
    return {
      pkgCount: valid.length,
      totalSize: valid.reduce((s, p) => s + p.size, 0),
      warnCount,
      cleanable: valid.filter(p => p.status === 'warn').reduce((s, p) => s + p.size, 0),
    }
  },

  /**
   * 包列表 + 扫描状态（前端据此决定是否轮询进度）
   * @returns {Promise<import('../../types.js').PackagesResponse>}
   */
  async getPackages(keyword = '') {
    if (USE_MOCK) {
      await delay()
      const kw = keyword.trim().toLowerCase()
      let list = clone(mockState.packages)
      list = list.map(p => ({ ...p, status: computeStatus(p, mockState.versionThreshold) }))
      if (kw) list = list.filter(p => p.name.toLowerCase().includes(kw))
      return { packages: sortPackages(list), scannedAt: new Date().toISOString(), scanning: false }
    }
    const r = await authFetch(`/api/packages?keyword=${encodeURIComponent(keyword)}`)
    const data = await r.json()
    return {
      packages: data.packages || [],
      scannedAt: data.scannedAt || null,
      scanning: data.scanning || false,
      firstScan: data.firstScan || false,
      scanPackages: data.scanPackages || 0,
      scanBytes: data.scanBytes || 0,
      totalBytes: data.totalBytes || null,
    }
  },

  /**
   * 单包详情（含版本明细），抽屉打开时按需加载
   * @returns {Promise<import('../../types.js').PackageDetailResult>}
   */
  async getPackageDetail(name) {
    if (USE_MOCK) {
      await delay(80)
      const p = clone(mockState.packages).find(x => x.name === name) || null
      return { ok: !!p, pkg: p }
    }
    const r = await authFetch(`/api/packages/${encodeURIComponent(name)}`)
    if (!r.ok) return { ok: false, pkg: null }
    return r.json()
  },

  /**
   * 清理：保留最新 keep 个版本
   * @returns {Promise<import('../../types.js').CleanResult>}
   */
  async clean(pkgName, keep) {
    if (USE_MOCK) {
      await delay(420)
      const p = mockState.packages.find(x => x.name === pkgName)
      if (!p) return { ok: false, message: '包不存在' }
      const vers = [...p.versionsDetail].sort((a, b) => semverCompare(a.version, b.version))
      const toDel = vers.slice(0, Math.max(0, vers.length - keep))
      if (!toDel.length) return { ok: false, message: '无需清理' }
      const freed = toDel.reduce((s, v) => s + v.size, 0)
      p.versionsDetail = vers.slice(-keep)
      p.versions = p.versionsDetail.length
      p.size = Number(Math.max(0.1, p.size - freed).toFixed(1))
      p.status = computeStatus(p, mockState.versionThreshold)
      const log = {
        id: Date.now(),
        action: 'delete_version',
        pkgName,
        deletedVersions: toDel.map(v => v.version).join(', '),
        deletedCount: toDel.length,
        freedSpace: `${freed.toFixed(1)} MB`,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      }
      mockState.logs.unshift(log)
      return { ok: true, deletedCount: toDel.length, freedSpace: `${freed.toFixed(1)} MB`, deletedVersions: log.deletedVersions }
    }
    const r = await authFetch('/api/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkgName, keep }),
    })
    return r.json()
  },

  /**
   * 删除单个版本
   * @returns {Promise<import('../../types.js').CleanResult>}
   */
  async deleteVersion(pkgName, version) {
    if (USE_MOCK) {
      await delay(150)
      const p = mockState.packages.find(x => x.name === pkgName)
      if (!p) return { ok: false }
      const idx = p.versionsDetail.findIndex(v => v.version === version)
      if (idx === -1) return { ok: false }
      const [v] = p.versionsDetail.splice(idx, 1)
      p.versions = p.versionsDetail.length
      p.size = Number(Math.max(0.1, p.size - v.size).toFixed(1))
      p.status = computeStatus(p, mockState.versionThreshold)
      return { ok: true, freedSpace: `${v.size.toFixed(1)} MB` }
    }
    const r = await authFetch(`/api/packages/${encodeURIComponent(pkgName)}/versions/${encodeURIComponent(version)}`, {
      method: 'DELETE',
    })
    return r.json()
  },

  /**
   * 手工拉取指定包版本（经私服代理落盘）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async pullPackage(pkgName, version) {
    if (USE_MOCK) {
      await delay(250)
      mockState.logs.unshift({
        id: Date.now(),
        action: 'pull_manual',
        pkgName,
        version,
        result: 'success',
        message: `已拉取 ${pkgName}@${version}`,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      })
      return { ok: true }
    }
    const r = await authFetch('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkgName, version }),
    })
    return r.json()
  },
}