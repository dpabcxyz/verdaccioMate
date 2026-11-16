/**
 * 消息通知入口 —— 单一 notify() 供 server.js / sync-latest.js / npm-toplist.js 复用
 * 非实时通知：写 DB，前端 30s 轮询拉取（拉取包耗时久，无法实时）
 */
import { addNotification } from './db.js'

/**
 * 发送通知（写 DB；前端轮询拉取）
 * @param {Object} opts
 * @param {string} opts.type - 6 类之一：version_warning / sync_batch / pull_manual / toplist_pull / toplist_change / daily_preview
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {'info'|'warn'|'error'} [opts.level]
 * @param {number} [opts.relatedActionId] - 关联 summary log id
 * @param {string} [opts.batchId]
 * @param {Object} [opts.meta]
 * @returns {number} notification id
 */
export function notify(opts) {
  const id = addNotification({
    type: opts.type,
    title: opts.title,
    body: opts.body || '',
    level: opts.level || 'info',
    relatedActionId: opts.relatedActionId || null,
    batchId: opts.batchId || null,
    meta: opts.meta || null,
  })
  console.log(`[notify] #${id} [${opts.type}] ${opts.title}`)
  return id
}
