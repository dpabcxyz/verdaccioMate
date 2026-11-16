/**
 * 消息通知状态与轮询 —— store/index.js 抽离
 */
import api from '../api'
import { notifyError } from '../utils/notify.js'
import { state } from './state.js'

let notifPollTimer = null
let notifPollActive = false

/** 30s 轮询通知：新通知合并到头部并更新未读角标（消息经铃铛下拉展示，不再弹 toast） */
export function pollNotifications() {
  notifPollActive = true
  clearTimeout(notifPollTimer)
  const tick = async () => {
    try {
      const data = await api.getNotifications(state.lastNotifId, 20)
      if (!notifPollActive) return
      if (data.list && data.list.length) {
        state.notifications = [...data.list, ...state.notifications].slice(0, 50)
        state.lastNotifId = data.lastId
        state.unreadCount = data.unreadCount
      } else if (data.unreadCount !== undefined) {
        state.unreadCount = data.unreadCount
      }
    } catch { /* 静默失败，下个 tick 继续 */ }
    if (!notifPollActive) return
    notifPollTimer = setTimeout(tick, 30_000)
  }
  tick()
}

/** 停止通知轮询（登出时调用，避免已失效会话继续打接口） */
export function stopPollNotifications() {
  notifPollActive = false
  clearTimeout(notifPollTimer)
}

/** 下拉打开时手动刷新：重置游标拉最新 20 条 */
export async function refreshNotifications() {
  let data
  try {
    data = await api.getNotifications(0, 20)
  } catch (e) {
    return notifyError(e, '消息加载失败，请稍后重试')
  }
  state.notifications = data.list || []
  state.lastNotifId = data.lastId
  state.unreadCount = data.unreadCount
}

/** 标记单条已读：本地先行，后端失败只提示不回滚（下次拉取以服务端为准） */
export async function markNotifRead(id) {
  const n = state.notifications.find(x => x.id === id)
  if (n && !n.read_at) {
    n.read_at = new Date().toISOString()
    state.unreadCount = Math.max(0, state.unreadCount - 1)
  }
  try {
    await api.markNotificationRead(id)
  } catch (e) {
    notifyError(e, '标记已读失败，请稍后重试')
  }
}

export async function markAllNotifsRead() {
  state.notifications.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString() })
  state.unreadCount = 0
  try {
    await api.markAllNotificationsRead()
  } catch (e) {
    notifyError(e, '全部标记已读失败，请稍后重试')
  }
}
