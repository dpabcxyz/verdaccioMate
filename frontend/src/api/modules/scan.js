/**
 * 扫描与同步 API —— 缓存扫描、存量包最新版拉取（均为异步任务 + 轮询进度）
 */
import { authFetch } from '../http.js'
import { USE_MOCK, mockState, delay } from '../mock.js'

export default {
  /**
   * 手动触发后端重新扫描缓存目录（异步，返回后需轮询进度）
   * @returns {Promise<import('../../types.js').ScanTriggerResult>}
   */
  async scanNow() {
    if (USE_MOCK) {
      await delay(300)
      return { ok: true, scanning: false, scannedAt: new Date().toISOString() }
    }
    const r = await authFetch('/api/scan', { method: 'POST' })
    return r.json()
  },

  /**
   * 查询扫描进度（包数 / 字节数 / 是否完成）
   * @returns {Promise<import('../../types.js').ScanProgress>}
   */
  async getScanProgress() {
    if (USE_MOCK) {
      return { scanning: false, done: true, packages: 33, bytes: 0 }
    }
    const r = await authFetch('/api/scan/progress')
    return r.json()
  },

  /**
   * 一键拉取存量包最新版本（异步，触发后轮询进度）
   * @returns {Promise<import('../../types.js').SyncTriggerResult>}
   */
  async syncLatest() {
    if (USE_MOCK) {
      await delay(260)
      return { ok: true, demo: false, running: false, total: mockState.packages.length, startedAt: new Date().toISOString() }
    }
    const r = await authFetch('/api/sync/latest', { method: 'POST' })
    return r.json()
  },

  /**
   * 查询拉取进度（成功/跳过/失败汇总 + 失败明细）
   * @returns {Promise<import('../../types.js').ProgressState>}
   */
  async getSyncProgress() {
    if (USE_MOCK) {
      await delay(60)
      // mock：模拟一次已完成的拉取（少量包有新版本被拉取，其余已是最新）
      return {
        running: false, done: true,
        total: mockState.packages.length, processed: mockState.packages.length,
        success: 2, skipped: Math.max(0, mockState.packages.length - 2), failed: 0,
        failedList: [], current: null, error: null,
        startedAt: null, finishedAt: new Date().toISOString(),
      }
    }
    const r = await authFetch('/api/sync/progress')
    return r.json()
  },
}
