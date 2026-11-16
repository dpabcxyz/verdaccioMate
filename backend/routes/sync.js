/**
 * 同步拉取 API —— server.js 抽离
 * - POST /api/sync/latest：一键拉取存量包最新版本（异步）
 * - GET /api/sync/progress：拉取进度
 * - POST /api/pull：手工拉取指定包版本（经私服代理落盘）
 */
import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { addLog } from '../db.js'
import { notify } from '../notifier.js'
import { isDemoMode, invalidateScan } from '../scan-manager.js'
import { syncState, runSyncLatest, triggerVerdaccio } from '../sync-latest.js'
import { apiValidate, zPkgName, zVersion } from '../validate.js'

export const syncRouter = express.Router()

// —— 一键拉取存量包最新版本（异步，期间前端轮询进度） ——
syncRouter.post('/sync/latest', (req, res) => {
  if (isDemoMode()) {
    return res.json({ ok: true, demo: true, running: false, message: '演示模式：未配置 原版 Verdaccio 缓存目录，不支持拉取' })
  }
  if (!syncState.running) {
    runSyncLatest({
      addLog,
      invalidateScan,
      notify,
      source: { taskType: 'manual', user: req.user || null },
    })
  }
  res.json({
    ok: true,
    demo: false,
    running: syncState.running,
    total: syncState.total,
    startedAt: syncState.startedAt,
  })
})

// —— 拉取进度（拉取期间由前端轮询） ——
syncRouter.get('/sync/progress', (req, res) => {
  res.json({
    running: syncState.running,
    done: syncState.done,
    total: syncState.total,
    processed: syncState.processed,
    success: syncState.success,
    skipped: syncState.skipped,
    failed: syncState.failed,
    failedList: syncState.failedList,
    current: syncState.current,
    error: syncState.error,
    startedAt: syncState.startedAt,
    finishedAt: syncState.finishedAt,
  })
})

// —— 手工拉取指定包版本（经私服代理落盘，与 sync-latest 同机制） ——
syncRouter.post('/pull', apiValidate({ body: z.object({ pkgName: zPkgName, version: zVersion }) }), async (req, res) => {
  const { pkgName, version } = req.body
  if (isDemoMode()) return res.json({ ok: false, message: '演示模式不支持拉取' })
  const batchId = randomUUID()
  const taskType = 'manual'
  const user = req.user || null
  try {
    await triggerVerdaccio(pkgName, version)
    const logId = addLog({ action: 'pull_manual', pkgName, version, result: 'success', message: `已拉取 ${pkgName}@${version}`, batchId, meta: { taskType, user } })
    notify({ type: 'pull_manual', title: `已拉取 ${pkgName}@${version}`, level: 'info', relatedActionId: logId, batchId, meta: { pkgName, version, result: 'success', taskType, user } })
    invalidateScan()
    res.json({ ok: true })
  } catch (e) {
    const msg = (e && e.message) || '拉取失败'
    const logId = addLog({ action: 'pull_manual', pkgName, version, result: 'fail', message: msg, batchId, meta: { taskType, user } })
    notify({ type: 'pull_manual', title: `拉取失败：${pkgName}@${version}`, body: msg, level: 'error', relatedActionId: logId, batchId, meta: { pkgName, version, result: 'fail', error: msg, taskType, user } })
    res.json({ ok: false, message: msg })
  }
})