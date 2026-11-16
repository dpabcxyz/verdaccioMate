/**
 * 一键拉取存量包最新版本 —— store/index.js 抽离
 */
import api from '../api'
import { toFailure } from '../utils/notify.js'
import { state } from './state.js'
import { silentRefresh, refreshLogs } from './refreshers.js'

let syncPollTimer = null
let syncPollActive = false

/** 重置拉取进度状态（触发新一轮拉取时调用） */
export function resetSyncProgress(res) {
  state.syncProgress.running = true
  state.syncProgress.done = false
  state.syncProgress.total = res.total || 0
  state.syncProgress.processed = 0
  state.syncProgress.success = 0
  state.syncProgress.skipped = 0
  state.syncProgress.failed = 0
  state.syncProgress.failedList = []
  state.syncProgress.error = null
}

/**
 * 一键拉取存量包最新版本：触发后端任务并轮询进度，完成后刷新列表
 * @returns {Promise<import('../types.js').SyncTriggerResult>}
 */
export async function syncLatest() {
  try {
    const res = await api.syncLatest()
    if (!res.ok || res.demo) return res // demo 分支由调用方提示
    resetSyncProgress(res)
    pollSyncProgress()
    return res
  } catch (e) {
    return toFailure(e, '发起拉取失败，请稍后重试')
  }
}

/** 停止拉取进度轮询（登出/卸载时调用，避免已失效会话继续打接口） */
export function stopPollSyncProgress() {
  syncPollActive = false
  clearTimeout(syncPollTimer)
}

/** 轮询拉取进度，任务结束后刷新包列表与操作日志（新版本已入库） */
export function pollSyncProgress() {
  syncPollActive = true
  clearTimeout(syncPollTimer)
  const tick = async () => {
    let p
    try {
      p = await api.getSyncProgress()
    } catch {
      if (!syncPollActive) return
      state.syncProgress.running = false
      state.syncProgress.error = '拉取进度查询失败'
      return
    }
    if (!syncPollActive) return
    state.syncProgress.running = !!p.running
    state.syncProgress.done = !!p.done
    state.syncProgress.total = p.total || 0
    state.syncProgress.processed = p.processed || 0
    state.syncProgress.success = p.success || 0
    state.syncProgress.skipped = p.skipped || 0
    state.syncProgress.failed = p.failed || 0
    state.syncProgress.failedList = p.failedList || []
    state.syncProgress.error = p.error || null
    if (p.running) {
      syncPollTimer = setTimeout(tick, 800)
    } else {
      clearTimeout(syncPollTimer)
      // 拉取会 invalidateScan → 触发懒扫描重建缓存，静默等待完成后再刷新真实数据
      await Promise.all([silentRefresh(), refreshLogs()])
    }
  }
  tick()
}