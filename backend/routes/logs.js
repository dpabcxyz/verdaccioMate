/**
 * 日志与消息通知 API —— server.js 抽离
 * - GET /api/logs：操作日志（支持 action / batchId 筛选）
 * - GET/POST /api/notifications*：消息通知查询与已读标记
 */
import express from 'express'
import { z } from 'zod'
import {
  getLogs, getLogTypeCounts, getNotifications, getUnreadNotificationCount,
  markNotificationRead, markAllNotificationsRead,
} from '../db.js'
import { apiValidate, zId, zPage, zPageSize, zLimit, zCount } from '../validate.js'

export const logsRouter = express.Router()

// 可选字符串：空串与缺省一律归 null（沿用旧 `|| null` 语义，避免空筛选条件误当精确匹配）
const zOptStr = z.string().optional().transform(v => v || null)

// —— 日志（支持 action / actions 批量 / batchId 筛选 + page 分页） ——
logsRouter.get('/logs', apiValidate({
  query: z.object({
    action: zOptStr,
    actions: z.union([z.string(), z.array(z.string())]).optional().transform(v => (v == null ? null : Array.isArray(v) ? v : [v])),
    batchId: zOptStr,
    q: zOptStr,
    page: zPage,
    pageSize: zPageSize,
  }),
}), (req, res) => {
  const { action, actions, batchId, q, page, pageSize } = req.query
  const { list, total } = getLogs({ action, actions, batchId, q, offset: (page - 1) * pageSize, limit: pageSize })
  res.json({ list, total, page, pageSize, counts: getLogTypeCounts() })
})

// —— 消息通知 ——
logsRouter.get('/notifications', apiValidate({
  query: z.object({ sinceId: zCount, limit: zLimit }),
}), (req, res) => {
  const { sinceId, limit } = req.query
  const list = getNotifications({ sinceId, limit })
  res.json({
    list,
    unreadCount: getUnreadNotificationCount(),
    lastId: list.length ? list[0].id : sinceId,
  })
})

logsRouter.post('/notifications/:id/read', apiValidate({ params: z.object({ id: zId }) }), (req, res) => {
  markNotificationRead(req.params.id)
  res.json({ ok: true })
})

logsRouter.post('/notifications/read-all', (req, res) => {
  const updated = markAllNotificationsRead()
  res.json({ ok: true, updated })
})