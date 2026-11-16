/**
 * Top1000 榜单 API —— server.js 抽离
 * - GET /api/toplist：榜单 + 实时缓存比对（支持 filter）
 * - GET /api/toplist/progress、POST /api/toplist/fetch：抓榜
 * - POST /api/toplist/pull、GET /api/toplist/pull/progress：拉取待缓存包
 */
import express from 'express'
import { addLog, setSetting } from '../db.js'
import { notify } from '../notifier.js'
import { isDemoMode, ensureScan, hasScanCache, getRawPackages, invalidateScan, scanState } from '../scan-manager.js'
import { toplistState, getTopList, runTopListFetch, runTopListPull } from '../npm-toplist.js'

export const toplistRouter = express.Router()

toplistRouter.get('/toplist', (req, res) => {
  const { filter } = req.query
  // pull/清理后 invalidateScan 会清空 rawCache；此接口也懒触发重建，
  // 否则实时比对会拿到空缓存，导致所有包被误判为「待拉取」
  if (!isDemoMode() && !hasScanCache()) ensureScan()
  const data = getTopList(getRawPackages)
  // 透传扫描状态，供前端在扫描结束后再刷新榜单比对结果
  data.scanning = scanState.scanning
  if (filter === 'missing') {
    data.list = data.list.filter(e => !e.cached)
  } else if (filter === 'outdated') {
    data.list = data.list.filter(e => e.cached && !e.latestCached)
  } else if (filter === 'ready') {
    data.list = data.list.filter(e => e.cached && e.latestCached)
  }
  res.json(data)
})

toplistRouter.get('/toplist/progress', (req, res) => {
  res.json(toplistState)
})

toplistRouter.post('/toplist/fetch', (req, res) => {
  if (!toplistState.running) {
    runTopListFetch({
      addLog,
      getRawPackages,
      invalidateScan,
      setSetting,
      notify,
      source: { taskType: 'manual', user: req.user || null },
    })
  }
  res.json({
    ok: true,
    running: toplistState.running,
    phase: toplistState.phase,
    startedAt: toplistState.startedAt,
  })
})

toplistRouter.post('/toplist/pull', (req, res) => {
  if (isDemoMode()) {
    return res.json({ ok: true, demo: true, running: false, message: '演示模式：未配置 原版 Verdaccio 缓存目录，不支持拉取' })
  }
  if (!toplistState.pullRunning) {
    runTopListPull({
      addLog,
      getRawPackages,
      invalidateScan,
      notify,
      source: { taskType: 'manual', user: req.user || null },
    })
  }
  res.json({
    ok: true,
    demo: false,
    running: toplistState.pullRunning,
    total: toplistState.pullTotal,
    startedAt: toplistState.pullStartedAt,
  })
})

toplistRouter.get('/toplist/pull/progress', (req, res) => {
  res.json({
    running: toplistState.pullRunning,
    done: toplistState.pullDone,
    total: toplistState.pullTotal,
    processed: toplistState.pullProcessed,
    success: toplistState.pullSuccess,
    skipped: toplistState.pullSkipped,
    failed: toplistState.pullFailed,
    failedList: toplistState.pullFailedList,
    current: toplistState.pullCurrent,
    error: toplistState.pullError,
    startedAt: toplistState.pullStartedAt,
    finishedAt: toplistState.pullFinishedAt,
  })
})