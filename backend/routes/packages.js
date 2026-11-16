/**
 * 包列表 / 扫描 / storage 配置 API —— server.js 抽离
 * - GET /api/packages：包列表（含扫描状态，前端据此轮询）
 * - GET /api/packages/:pkgName：单包详情（只读缓存，绝不触发同步扫描）
 * - POST /api/scan：手动重扫（异步）
 * - GET /api/scan/progress：扫描进度
 * - GET/POST /api/storage：缓存目录配置
 */
import express from 'express'
import { z } from 'zod'
import { getSetting, getIgnoredRows, setSetting } from '../db.js'
import { validateStorage, demoPackages, demoSummary } from '../scanner.js'
import {
  currentStorage, isDemoMode, ensureScan, buildPackages,
  getRawPackages, invalidateScan, runScanAsync, scanState, getScannedAt,
} from '../scan-manager.js'
import { DEFAULT_VERSION_THRESHOLD } from '../util.js'
import { rejectWhileScanning } from '../http.js'
import { apiValidate } from '../validate.js'

export const packagesRouter = express.Router()

// —— 包列表（扫描） ——
packagesRouter.get('/packages', (req, res) => {
  const demo = isDemoMode()
  const storage = currentStorage()
  const validation = demo ? { ok: true, message: 'demo' } : validateStorage(storage)
  ensureScan() // 懒触发：登录后首次拉包自动启动扫描（rawCache 缺失时），返回 scanning 状态供前端轮询
  const origin = req.query.origin || 'all'
  const packages = buildPackages(req.query.keyword || '', origin) // 先构建（填充缓存）
  res.json({
    demo,
    storageDir: storage || null,
    storageValid: validation.ok,
    storageMessage: validation.message,
    threshold: Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD)),
    scannedAt: demo ? new Date().toISOString() : (getScannedAt() || null),
    scanning: scanState.scanning,
    // 首次部署：只有「部署后启动扫描」进行中才遮罩；手动/定时/懒触发重建一律后台静默
    firstScan: scanState.startupScanning,
    scanPackages: scanState.packages,
    scanBytes: scanState.bytes,
    totalBytes: demo ? null : (scanState.diskBytes ?? scanState.bytes), // 磁盘占用（跨平台字节和）
    packages,
    ...(demo ? demoSummary() : {}),
  })
})

// —— 单包详情（含版本明细，抽屉打开时按需加载）
// 只读现有扫描缓存，绝不触发同步扫描（缓存被失效时直接 404，
// 前端用列表数据兜底 + 提示，避免打开抽屉卡几十秒） ——
packagesRouter.get('/packages/:pkgName', (req, res) => {
  const name = decodeURIComponent(req.params.pkgName)
  const raw = isDemoMode() ? demoPackages() : (getRawPackages() || null)
  const p = raw ? raw.find(x => x.name === name) : null
  if (!p) return res.status(404).json({ ok: false, message: '包不存在或正在扫描中' })
  const threshold = Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD))
  const ignoredSet = new Set(getIgnoredRows().map(r => r.pkg_name))
  let status
  if (p.status === 'broken') status = 'broken'
  else if (ignoredSet.has(p.name)) status = 'ignored'
  else status = p.versions > threshold ? 'warn' : 'ok'
  res.json({ ok: true, pkg: { ...p, status } })
})

// —— 手动重新扫描缓存目录（异步，扫描期间前端轮询进度） ——
packagesRouter.post('/scan', rejectWhileScanning, (req, res) => {
  invalidateScan()
  const demo = isDemoMode()
  if (demo) {
    const scannedAt = new Date().toISOString()
    return res.json({ ok: true, demo, scanning: false, scannedAt })
  }
  runScanAsync() // 后台启动，不阻塞响应
  res.json({
    ok: true,
    demo: false,
    scanning: scanState.scanning,
    startedAt: scanState.startedAt,
    packages: scanState.packages,
    bytes: scanState.bytes,
  })
})

// —— 扫描进度（重扫/首扫期间由前端轮询） ——
packagesRouter.get('/scan/progress', (req, res) => {
  res.json({
    scanning: scanState.scanning,
    done: scanState.done,
    packages: scanState.packages,
    bytes: scanState.bytes,
    tgzBytes: scanState.tgzBytes,
    diskBytes: scanState.diskBytes,
    error: scanState.error,
    startedAt: scanState.startedAt,
    finishedAt: scanState.finishedAt,
  })
})

// —— storage 配置（UI 设置页） ——
packagesRouter.get('/storage', (req, res) => {
  const storage = currentStorage()
  const demo = isDemoMode()
  res.json({
    storageDir: storage,
    envDir: process.env.VERDACCIO_STORAGE || null,
    demo,
    validation: demo ? { ok: true, message: 'demo' } : validateStorage(storage),
  })
})

packagesRouter.post('/storage', apiValidate({ body: z.object({ storageDir: z.string({ error: '缺少 storageDir' }).trim().min(1, '缺少 storageDir') }) }), (req, res) => {
  const { storageDir } = req.body
  const v = validateStorage(storageDir)
  if (!v.ok) return res.status(400).json(v)
  setSetting('storage_dir', storageDir)
  invalidateScan() // 目录切换 → 废弃旧缓存，下次请求懒扫描重建，避免列表仍显示旧目录
  res.json({ ok: true })
})