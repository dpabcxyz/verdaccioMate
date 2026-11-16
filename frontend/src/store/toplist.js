/**
 * Top1000 榜单状态与轮询 —— store/index.js 抽离
 */
import { ElMessage } from 'element-plus'
import api from '../api'
import { notifyError, toFailure } from '../utils/notify.js'
import { state } from './state.js'
import { refreshLogs } from './refreshers.js'

let toplistFetchTimer = null
let toplistPullTimer = null
// 轮询代号：stopTopListPoll() 自增，飞行中的 tick 通过比对代号感知自己已被作废
// （clearTimeout 只能拦未启动的回调，await 之后的续体只能靠代号丢弃）
let toplistPollEpoch = 0

/** 刷新榜单数据（含实时缓存比对状态），可传 filter 筛选子集 */
export async function refreshTopList(filter = '') {
  const epoch = toplistPollEpoch
  let data
  try {
    data = await api.getTopList(filter)
  } catch (e) {
    return notifyError(e, '榜单数据加载失败，请稍后重试')
  }
  // pull/清理后 rawCache 会被清空并触发懒扫描；此时实时比对拿到的是空缓存，
  // 全部包会被误判为「待拉取」。等待扫描结束后再取真实比对结果。
  if (data.scanning) {
    // 复用包列表的扫描进度轮询（等待后端重建缓存）
    const started = Date.now()
    for (;;) {
      await new Promise(r => setTimeout(r, 800))
      if (epoch !== toplistPollEpoch) return null // 已登出/停止，不再写状态
      let p
      try { p = await api.getScanProgress() } catch { break }
      if (!p.scanning) break
      if (Date.now() - started > 120_000) break // 兜底超时，避免无限等待
    }
    try {
      data = await api.getTopList(filter)
    } catch (e) {
      return notifyError(e, '榜单数据加载失败，请稍后重试')
    }
  }
  if (epoch !== toplistPollEpoch) return null
  state.toplist = data.list || []
  state.toplistSummary = data.summary || { total: 0, cached: 0, latestCached: 0, missing: 0, outdated: 0 }
  state.toplistNextRun = data.nextRun || null
  state.toplistLastRun = data.lastRun || null
  state.toplistProgress = data.state || state.toplistProgress
  return data
}

/** 立即抓榜：触发后端任务并轮询进度 */
export async function fetchTopList() {
  try {
    const res = await api.fetchTopList()
    if (res.ok === false) return res
    state.toplistProgress.running = true
    state.toplistProgress.phase = res.phase || 'search'
    pollTopListProgress()
    return res
  } catch (e) {
    return toFailure(e, '发起抓榜失败，请稍后重试')
  }
}

/** 停止榜单抓榜/拉取轮询（登出时调用，避免已失效会话继续打接口） */
export function stopTopListPoll() {
  toplistPollEpoch++
  clearTimeout(toplistFetchTimer)
  clearTimeout(toplistPullTimer)
}

/** 轮询抓榜进度，任务结束后刷新榜单 */
export function pollTopListProgress() {
  const epoch = toplistPollEpoch
  clearTimeout(toplistFetchTimer)
  const tick = async () => {
    if (epoch !== toplistPollEpoch) return
    let p
    try {
      p = await api.getTopListProgress()
    } catch {
      if (epoch !== toplistPollEpoch) return
      state.toplistProgress.running = false
      state.toplistProgress.error = '抓榜进度查询失败'
      return
    }
    if (epoch !== toplistPollEpoch) return
    Object.assign(state.toplistProgress, {
      running: !!p.running, done: !!p.done, phase: p.phase || 'idle',
      total: p.total || 0, processed: p.processed || 0,
      success: p.success || 0, skipped: p.skipped || 0, failed: p.failed || 0,
      failedList: p.failedList || [], error: p.error || null,
    })
    if (p.running) {
      toplistFetchTimer = setTimeout(tick, 800)
    } else {
      clearTimeout(toplistFetchTimer)
      await refreshTopList()
    }
  }
  tick()
}

/** 一键拉取待缓存/需更新的榜单包：触发后端任务并轮询进度 */
export async function pullTopList() {
  try {
    const res = await api.pullTopList()
    if (!res.ok) return res
    if (res.demo) return res
    state.toplistPullProgress.running = true
    state.toplistPullProgress.done = false
    state.toplistPullProgress.total = res.total || 0
    pollTopListPullProgress()
    return res
  } catch (e) {
    return toFailure(e, '发起拉取失败，请稍后重试')
  }
}

/** 轮询拉取进度，任务结束后刷新榜单与日志 */
export function pollTopListPullProgress() {
  const epoch = toplistPollEpoch
  clearTimeout(toplistPullTimer)
  const tick = async () => {
    if (epoch !== toplistPollEpoch) return
    let p
    try {
      p = await api.getTopListPullProgress()
    } catch {
      if (epoch !== toplistPollEpoch) return
      state.toplistPullProgress.running = false
      state.toplistPullProgress.error = '拉取进度查询失败'
      return
    }
    if (epoch !== toplistPollEpoch) return
    Object.assign(state.toplistPullProgress, {
      running: !!p.running, done: !!p.done,
      total: p.total || 0, processed: p.processed || 0,
      success: p.success || 0, skipped: p.skipped || 0, failed: p.failed || 0,
      failedList: p.failedList || [], error: p.error || null,
    })
    if (p.running) {
      toplistPullTimer = setTimeout(tick, 800)
    } else {
      clearTimeout(toplistPullTimer)
      const total = p.total || 0
      const success = p.success || 0
      const failed = p.failed || 0
      if (total === 0) {
        // targets 为空：后端不 invalidateScan、不触发重扫，直接提示无包可拉
        ElMessage.success('榜单已是最新，无需拉取')
      } else if (failed > 0 && success === 0) {
        // 全部失败：这不是"完成"，而是没拉到，把真实原因暴露出来便于排查
        const reason = (p.failedList && p.failedList[0] && p.failedList[0].reason) || '请检查私服可达性（VERDACCIO_BASE_URL）'
        ElMessage.error(`榜单拉取失败 ${failed} 个：${reason}`)
      } else {
        // 有包真拉成功 → invalidateScan 已在后端执行，后台重扫后更新比对结果
        ElMessage.info(`榜单拉取完成（成功 ${success} · 失败 ${failed}），正在后台重新扫描缓存目录以更新比对结果`)
      }
      if (total > 0) await Promise.all([refreshTopList(), refreshLogs()])
    }
  }
  tick()
}