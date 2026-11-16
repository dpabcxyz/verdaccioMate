/**
 * 日志与通知 API —— 操作日志（分页/筛选/检索）+ 消息中心
 */
import { authFetch } from '../http.js'
import { USE_MOCK, mockState, delay, clone } from '../mock.js'

export default {
  /**
   * 操作日志（分页 + 筛选），counts 为各动作的总数（供筛选条展示）
   * @returns {Promise<import('../../types.js').LogsResponse>}
   */
  async getLogs({ action = null, actions = null, batchId = null, q = null, page = 1, pageSize = 50 } = {}) {
    if (USE_MOCK) {
      await delay(80)
      let list = clone(mockState.logs)
      if (action) list = list.filter(l => l.action === action)
      if (Array.isArray(actions) && actions.length) list = list.filter(l => actions.includes(l.action))
      if (q) {
        const kw = String(q).toLowerCase()
        const hay = l => [l.pkgName, l.version, l.result, l.message, l.batchId, l.ip, l.action, (l.meta||'')].join(' ').toLowerCase()
        list = list.filter(l => hay(l).includes(kw))
      }
      const total = list.length
      const start = (page - 1) * pageSize
      return { list: list.slice(start, start + pageSize).map(o => ({ ...o, pkgName: o.pkgName, batchId: o.batchId })), total, page, pageSize }
    }
    const qs = new URLSearchParams()
    if (action) qs.set('action', action)
    if (Array.isArray(actions) && actions.length) actions.forEach(a => qs.append('actions', a))
    if (batchId) qs.set('batchId', batchId)
    if (q) qs.set('q', q)
    qs.set('page', String(page))
    qs.set('pageSize', String(pageSize))
    const r = await authFetch(`/api/logs?${qs}`)
    const data = await r.json()
    // 后端 logs 表列为 pkg_name / batch_id（蛇形），前端统一用 pkgName / batchId 读取
    data.list = (data.list || []).map(o => ({
      ...o,
      pkgName: o.pkgName != null ? o.pkgName : o.pkg_name || null,
      batchId: o.batchId != null ? o.batchId : o.batch_id || null,
    }))
    return data
  },

  /**
   * 增量拉取消息通知（sinceId 之后的新消息）
   * @returns {Promise<import('../../types.js').NotificationsResponse>}
   */
  async getNotifications(sinceId = 0, limit = 20) {
    if (USE_MOCK) {
      await delay(60)
      return { list: [], unreadCount: 0, lastId: sinceId }
    }
    const r = await authFetch(`/api/notifications?sinceId=${sinceId}&limit=${limit}`)
    return r.json()
  },

  /**
   * 标记单条通知已读
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async markNotificationRead(id) {
    const r = await authFetch(`/api/notifications/${id}/read`, { method: 'POST' })
    return r.json()
  },

  /**
   * 全部标记已读
   * @returns {Promise<{ok: boolean, updated: number}>}
   */
  async markAllNotificationsRead() {
    const r = await authFetch('/api/notifications/read-all', { method: 'POST' })
    return r.json()
  },
}
