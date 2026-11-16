/**
 * 全局 store 统一出口 —— 状态 / 统计 / 动作按领域拆分为子模块
 * - state.js          全局响应式状态
 * - stats.js          派生统计与格式化工具
 * - refreshers.js     基础数据刷新（包/阈值/日志/静默刷新）
 * - scan.js           扫描与整体刷新编排
 * - sync.js           存量包最新版本拉取
 * - toplist.js        Top1000 榜单
 * - notifications.js  消息通知
 * - actions.js        用户操作动作
 */
import { state } from './state.js'
import { stats, fmtSize, fmtBytes } from './stats.js'
import { refreshPackages, refreshThresholds, refreshLogs, stopScanProgressPoll } from './refreshers.js'
import { scanNow } from './scan.js'
import { syncLatest, stopPollSyncProgress } from './sync.js'
import { refreshTopList, fetchTopList, pullTopList, stopTopListPoll } from './toplist.js'
import { refreshNotifications, markNotifRead, markAllNotifsRead, stopPollNotifications } from './notifications.js'
import { refreshAll, saveThresholds, ignorePkg, unignorePkg, cleanPkg, deleteVersion } from './actions.js'

export { fmtSize, fmtBytes }

/** 停止所有后台轮询与进度等待：登出时调用，避免会话已失效仍持续打 /api */
export function stopAllPolling() {
  stopPollNotifications()
  stopPollSyncProgress()
  stopTopListPoll()
  stopScanProgressPoll()
}

export function useStore() {
  return {
    state,
    stats,
    fmtSize,
    refreshAll,
    refreshPackages,
    refreshThresholds,
    refreshLogs,
    scanNow,
    syncLatest,
    refreshTopList,
    fetchTopList,
    pullTopList,
    refreshNotifications,
    markNotifRead,
    markAllNotifsRead,
    saveThresholds,
    ignorePkg,
    unignorePkg,
    cleanPkg,
    deleteVersion,
    stopAllPolling,
  }
}