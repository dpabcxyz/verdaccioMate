/**
 * 设置 API —— 版本/容量阈值与例外、忽略包管理
 */
import { authFetch } from '../http.js'
import { USE_MOCK, mockState, delay, clone, computeStatus } from '../mock.js'

export default {
  /**
   * 阈值配置（版本 + 大小 + 单包例外）
   * @returns {Promise<import('../../types.js').ThresholdsConfig>}
   */
  async getThresholds() {
    if (USE_MOCK) {
      await delay(80)
      return {
        versionThreshold: mockState.versionThreshold,
        sizeThreshold: mockState.sizeThreshold,
        exceptions: clone(mockState.exceptions),
      }
    }
    const r = await authFetch('/api/thresholds')
    return r.json()
  },

  /**
   * 保存阈值配置（整体覆盖，含例外清单）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async saveThresholds(payload) {
    if (USE_MOCK) {
      await delay()
      mockState.versionThreshold = payload.versionThreshold
      mockState.sizeThreshold = payload.sizeThreshold
      mockState.exceptions = clone(payload.exceptions || [])
      return { ok: true }
    }
    const r = await authFetch('/api/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return r.json()
  },

  /**
   * 忽略包名单（包名数组）
   * @returns {Promise<import('../../types.js').IgnoredList>}
   */
  async getIgnored() {
    if (USE_MOCK) {
      await delay(80)
      return [...mockState.ignored]
    }
    const r = await authFetch('/api/ignored')
    return r.json()
  },

  /**
   * 标记忽略（不再计入预警，versionCount 仅作为审计快照）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async ignore(pkgName, versionCount) {
    if (USE_MOCK) {
      await delay(100)
      mockState.ignored.add(pkgName)
      const p = mockState.packages.find(x => x.name === pkgName)
      if (p) { p.status = 'ignored'; p.ignoredAt = new Date().toISOString().slice(0, 10) }
      mockState.logs.unshift({
        id: Date.now(),
        action: 'ignore',
        pkgName,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      })
      return { ok: true }
    }
    const r = await authFetch('/api/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkgName, versionCount: Number(versionCount) || 0 }),
    })
    return r.json()
  },

  /**
   * 取消忽略
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async unignore(pkgName, versionCount) {
    if (USE_MOCK) {
      await delay(100)
      mockState.ignored.delete(pkgName)
      const p = mockState.packages.find(x => x.name === pkgName)
      if (p) {
        p.status = computeStatus(p, mockState.versionThreshold)
        delete p.ignoredAt
      }
      mockState.logs.unshift({
        id: Date.now(),
        action: 'unignore',
        pkgName,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      })
      return { ok: true }
    }
    const r = await authFetch(`/api/ignore/${encodeURIComponent(pkgName)}?versionCount=${Number(versionCount) || 0}`, { method: 'DELETE' })
    return r.json()
  },
}
