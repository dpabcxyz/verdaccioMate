/**
 * 基础数据刷新函数 —— store/index.js 抽离
 * 供 scan / sync / top-list / actions 各模块复用，避免循环依赖
 * 读刷新多处脱离调用链（定时器、watch、onMounted 里 fire-and-forget），异常在本层提示一次并保留旧数据
 */
import { ElMessage } from 'element-plus'
import api from '../api'
import { notifyError } from '../utils/notify.js'
import { state } from './state.js'

let scanPollCancelled = false

/** 拉取包列表（纯拉取，不控制遮罩；遮罩由 doRefresh 按首次扫描状态控制） */
export async function refreshPackages(keyword = '') {
  let pkg
  try {
    pkg = await api.getPackages(keyword)
  } catch (e) {
    notifyError(e, '包列表加载失败，请稍后重试')
    return { scanning: false, firstScan: false }
  }
  const { packages, scannedAt, scanning, scanPackages, scanBytes, totalBytes, firstScan } = pkg
  state.packages = packages || []
  if (scannedAt) state.scannedAt = scannedAt
  state.scanning = !!scanning // 后台扫描状态
  if (scanPackages !== undefined) state.scanProgress.packages = scanPackages
  if (scanBytes !== undefined) state.scanProgress.bytes = scanBytes
  if (totalBytes !== undefined && totalBytes !== null) state.totalBytes = totalBytes
  return { scanning: !!scanning, firstScan: !!firstScan }
}

/** 轮询后端扫描进度，直到扫描完成 */
export async function pollScanProgress() {
  scanPollCancelled = false
  for (;;) {
    await new Promise(r => setTimeout(r, 800))
    if (scanPollCancelled) return
    let p
    try {
      p = await api.getScanProgress()
    } catch {
      break // 接口异常时退出，避免遮罩永久拦截点击
    }
    if (scanPollCancelled) return
    state.scanProgress.packages = p.packages || 0
    state.scanProgress.bytes = p.bytes || 0
    if (!p.scanning) break
  }
}

/** 停止扫描进度轮询（登出时调用，避免已失效会话继续打接口） */
export function stopScanProgressPoll() {
  scanPollCancelled = true
}

/** 静默刷新：检测到扫描时提示「即将后台扫描」并等待完成后再取真实数据（无遮罩） */
export async function silentRefresh({ toast = false } = {}) {
  const first = await refreshPackages()
  if (first.scanning) {
    if (toast) ElMessage.info('缓存目录已变化，正在后台重新扫描，完成前部分数据可能不完整')
    await pollScanProgress()
    await refreshPackages()
  }
  return first.scanning
}

export async function refreshThresholds() {
  let t
  try {
    t = await api.getThresholds()
  } catch (e) {
    return notifyError(e, '阈值加载失败，请稍后重试')
  }
  state.threshold.versionThreshold = t.versionThreshold
  state.threshold.sizeThreshold = t.sizeThreshold
  state.threshold.exceptions = t.exceptions || []
}

export async function refreshLogs({ action = null, actions = null, batchId = null, q = null, page = 1, pageSize = 50 } = {}) {
  let res
  try {
    res = await api.getLogs({ action, actions, batchId, q, page, pageSize })
  } catch (e) {
    return notifyError(e, '日志加载失败，请稍后重试')
  }
  state.logs = res.list || []
  state.logTotal = res.total || 0
  state.logPage = res.page || page
  state.logPageSize = res.pageSize || pageSize
  state.logCounts = res.counts || null
}