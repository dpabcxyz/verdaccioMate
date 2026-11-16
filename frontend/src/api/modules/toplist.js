/**
 * Top1000 榜单 API —— 榜单查询、抓取与一键拉取（均为异步任务 + 轮询进度）
 */
import { authFetch } from '../http.js'
import { USE_MOCK, delay } from '../mock.js'

// mock 模式下榜单为空、任务从未跑过：给全字段，别让 UI 读到 undefined
/** @type {import('../../types.js').TopListSummary} */
const MOCK_SUMMARY = { total: 0, cached: 0, latestCached: 0, missing: 0, outdated: 0 }
/** @type {import('../../types.js').TopListState} */
const MOCK_STATE = {
  running: false, done: false, phase: 'idle', total: 0, processed: 0,
  success: 0, skipped: 0, failed: 0, failedList: [], current: null, error: null,
  startedAt: null, finishedAt: null,
  pullRunning: false, pullTotal: 0, pullProcessed: 0, pullSuccess: 0, pullSkipped: 0,
  pullFailed: 0, pullFailedList: [], pullCurrent: null, pullStartedAt: null, pullFinishedAt: null,
}

export default {
  /**
   * 榜单 + 实时缓存比对（filter: missing|outdated|ready）
   * @returns {Promise<import('../../types.js').TopListResult>}
   */
  async getTopList(filter = '') {
    if (USE_MOCK) {
      await delay(80)
      return { list: [], summary: MOCK_SUMMARY, state: MOCK_STATE, lastRun: null, nextRun: null }
    }
    const qs = filter ? `?filter=${encodeURIComponent(filter)}` : ''
    const r = await authFetch(`/api/toplist${qs}`)
    return r.json()
  },
  /**
   * 触发抓榜（异步，触发后轮询 /api/toplist/progress）
   * @returns {Promise<import('../../types.js').TopListFetchResult>}
   */
  async fetchTopList() {
    const r = await authFetch('/api/toplist/fetch', { method: 'POST' })
    return r.json()
  },
  /**
   * 抓榜状态机（含拉取子状态）
   * @returns {Promise<import('../../types.js').TopListState>}
   */
  async getTopListProgress() {
    const r = await authFetch('/api/toplist/progress')
    return r.json()
  },
  /**
   * 一键拉取榜单待缓存包（异步，触发后轮询 pull/progress）
   * @returns {Promise<import('../../types.js').SyncTriggerResult>}
   */
  async pullTopList() {
    const r = await authFetch('/api/toplist/pull', { method: 'POST' })
    return r.json()
  },
  /**
   * 榜单拉取进度（成功/跳过/失败汇总 + 失败明细）
   * @returns {Promise<import('../../types.js').ProgressState>}
   */
  async getTopListPullProgress() {
    const r = await authFetch('/api/toplist/pull/progress')
    return r.json()
  },
}
