/**
 * 扫描与整体刷新编排 —— store/index.js 抽离
 */
import { ElMessage } from 'element-plus'
import api, { getToken } from '../api'
import { state } from './state.js'
import { refreshPackages, pollScanProgress, refreshThresholds, refreshLogs } from './refreshers.js'
import { pollSyncProgress } from './sync.js'
import { pollNotifications } from './notifications.js'

/** 刷新数据：若后端正在扫描则轮询进度，扫完再拉取完整数据。
 *  遮罩只在「首次部署扫描中」（scanning && firstScan）时显示；手动重扫/失效重建一律后台静默。 */
export async function doRefresh(mask = true) {
  if (!getToken()) return // 已登出：别在登录页后台拉数据或起轮询
  try {
    const first = await refreshPackages()
    if (first.scanning) {
      // 仅首次部署扫描中才遮罩；其余扫描（手动重扫等）后台进行，不遮罩
      if (mask && first.firstScan) state.scanMask = true
      await pollScanProgress()
      await refreshPackages()
      if (mask && first.firstScan) state.scanMask = false
    }

    // 刷新后检查一键拉取是否仍在运行（浏览器刷新后恢复沙漏旋转）
    if (!getToken()) return // 上述 await 期间登出：放弃起轮询，否则登录后台任务会在登录页继续跑
    // 可选的状态恢复探测：失败只跳过沙漏恢复，不该打断后面的阈值/日志刷新与通知轮询
    const sp = await api.getSyncProgress().catch(() => null)
    if (sp && sp.running) {
      state.syncProgress.running = true
      state.syncProgress.done = false
      state.syncProgress.total = sp.total || 0
      state.syncProgress.processed = sp.processed || 0
      state.syncProgress.success = sp.success || 0
      state.syncProgress.skipped = sp.skipped || 0
      state.syncProgress.failed = sp.failed || 0
      state.syncProgress.failedList = sp.failedList || []
      state.syncProgress.current = sp.current || null
      state.syncProgress.error = sp.error || null
      pollSyncProgress()
    }

    await Promise.all([refreshThresholds(), refreshLogs()])
    pollNotifications() // 启动 30s 通知轮询（首次拉最新 20 条）
  } catch (e) {
    // 网络/后端异常统一提示一次，避免向上穿透成未处理的 Promise rejection
    ElMessage.error(e?.message || '数据加载失败，请稍后重试')
  } finally {
    state.scanMask = false
  }
}

/** 手动重新扫描：后台静默执行，给出提示，完成后在消息中心通知（不遮罩） */
export async function scanNow() {
  try {
    const res = await api.scanNow()
    // 忙态（后端已有扫描在跑）走 200 + code SCANNING：提示语用后端原文，别谎报「已开始」
    if (res.code === 'SCANNING') ElMessage.info(res.message || '扫描进行中，请稍后重试')
    else if (!res.ok) return res
    else ElMessage.info('已开始后台扫描，完成后将在消息中心收到通知')
    // 静默等待扫描完成并刷新数据（无论本次是否重新触发，都不置遮罩）
    await doRefresh(false)
    return res
  } catch (e) {
    ElMessage.error(e?.message || '发起扫描失败，请稍后重试')
    return { ok: false }
  }
}