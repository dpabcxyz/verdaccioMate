/**
 * 扫描状态机与业务编排 —— server.js 抽离
 * - 维护内存扫描缓存（rawCache）与异步扫描进度（scanState）
 * - 负责扫描触发、状态构建（buildPackages）、缓存失效、demo 模式判断
 * - routes/* 通过本模块共享扫描状态，避免每次请求重复扫描
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  getSetting, setSetting, getIgnoredRows, addLog,
} from './db.js'
import {
  resolveStorageDir, isValidStorage, validateStorage, scanStorageAsync, clearPkgCache,
} from './scanner.js'
import { notify } from './notifier.js'
import { DEFAULT_VERSION_THRESHOLD } from './util.js'

// —— 当前生效的 storage 目录（每次请求动态解析，UI 保存后立即生效） ——
export function currentStorage() {
  return resolveStorageDir()
}

export function isDemoMode() {
  return process.env.VCM_DEMO === '1' || !isValidStorage(currentStorage())
}

// —— 扫描结果缓存：真实目录全量扫描 IO 重，缓存避免每次请求/刷新页面重扫 ——
let rawCache = null
let rawCacheAt = null

// 失效世代计数：每次 invalidateScan 递增。扫描开始时取快照，结束时比对，
// 据此判断「本次飞行期间是否又有写操作标记过失效」——见 runScanAsync 收尾。
let invalidationEpoch = 0

// 包列表构建缓存（rawCache/ignored/threshold 不变时复用，避免每次请求全量 map 7000+ 条）
let packagesCache = null

// —— 异步扫描状态（后台重扫时供前端轮询进度） ——
export const scanState = {
  scanning: false, done: false, packages: 0, bytes: 0, tgzBytes: 0, diskBytes: null,
  startedAt: null, finishedAt: null, error: null, lastErrorAt: null,
  // 是否处于「部署后启动扫描」（仅 server.js 启动时置 true，扫描结束清零）。
  // 供前端 /api/packages 返回 firstScan，决定是否显示首次扫描遮罩；手动/定时/懒触发均不解此。
  startupScanning: false,
  pendingDailyScan: false, // 定时扫描被并发扫描挤掉时标记，扫描结束后自动补扫
  _triggerSource: 'manual', // 'startup' | 'manual' | 'daily' | 'pending' | 'lazy'
  dirty: false, // 缓存失效标记：invalidateScan 置 true；扫描结束仅在本次飞行期间无新失效时清零
}

/** 磁盘占用（跨平台）：递归统计目录内所有文件字节和
 * 原实现 execSync('du -sk') 依赖 Linux du，Windows 下不可用；
 * 改为 Node 原生递归统计，语义与「文件字节和」一致，避免外部命令差异 */
async function diskBytesOf(dir) {
  let total = 0
  async function walk(d) {
    let entries
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async e => {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '.DS_Store') return
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else {
        try {
          const st = await fs.promises.stat(full)
          total += st.size
        } catch { /* 并发扫描间隙文件可能被删除（清理操作/原版 Verdaccio 写入），跳过不计 */ }
      }
    }))
  }
  try {
    await walk(dir)
    return total
  } catch {
    return null
  }
}

export async function runScanAsync() {
  scanState.scanning = true
  scanState.done = false
  scanState.error = null
  scanState.packages = 0
  scanState.bytes = 0
  scanState.tgzBytes = 0
  scanState.diskBytes = null
  scanState.startedAt = new Date().toISOString()
  const storage = currentStorage()
  // 本次扫描覆盖到的失效世代起点：结束时若计数变大，说明飞行期间有写操作，
  // 这批变更不在本次快照里，dirty 必须保留（由下一次请求懒扫描收敛）
  const epochAtStart = invalidationEpoch
  console.log(`[scan] 开始扫描存储目录: ${storage}`)
  try {
    // 分片异步扫描：期间 /api/scan/progress 等请求仍可被响应
    rawCache = await scanStorageAsync(storage, (p) => {
      scanState.packages = p.packages
      scanState.bytes = p.bytes        // 目录内所有文件字节和
      scanState.tgzBytes = p.tgzBytes || 0 // 仅 .tgz
    })
    rawCacheAt = new Date().toISOString()
    scanState.done = true
    scanState.error = null
    // dirty 只在「本次飞行期间没有新的失效请求」时清零：无条件清掉会把扫描进行中
    // 发生的删除/同步/目录切换的失效标记一起吞掉，而这些变更并不在本次快照里，
    // 标记一旦被吞，列表就要等到下一次定时扫描（03:00）才纠正。
    scanState.dirty = invalidationEpoch > epochAtStart
    scanState.lastErrorAt = null // 成功后清除错误状态，解除冷却
    scanState.finishedAt = rawCacheAt
    scanState.diskBytes = await diskBytesOf(storage) // 磁盘占用（跨平台字节和）
    console.log('[scan] 完成 ' + JSON.stringify({
      storage,
      packages: rawCache.length,
      tgzBytes: scanState.tgzBytes,
      bytes: scanState.bytes,
      diskBytes: scanState.diskBytes,
    }))
  } catch (e) {
    scanState.error = e.message
    scanState.lastErrorAt = new Date().toISOString()
    console.error('[scan] 扫描失败:', e.message)
  } finally {
    scanState.scanning = false
    scanState.startupScanning = false // 启动扫描结束即清零，首次遮罩随之解除
    // 写扫描日志（含触发源：manual / daily / pending）
    addLog({
      action: 'scan',
      result: scanState.error ? 'fail' : 'success',
      message: scanState.error || `扫描完成 ${scanState.packages} 个包`,
      durationMs: Date.now() - new Date(scanState.startedAt).getTime(),
      meta: {
        packages: scanState.packages,
        bytes: scanState.bytes,
        tgzBytes: scanState.tgzBytes,
        diskBytes: scanState.diskBytes,
        triggeredBy: scanState._triggerSource || 'manual',
      },
    })
    // 记录本次触发源（复位前捕获），用于预警 / 定时预告通知
    const triggerSource = scanState._triggerSource || 'manual'

    // 通知类型：扫描完成（首次懒扫描、手动重扫、写操作后重扫、每日/补扫通用）。
    // 前端「首次部署后打开页面」用遮罩呈现；其余后台静默扫描靠此通知在消息中心回执。
    notify({
      type: 'scan_done',
      title: scanState.error ? '缓存扫描失败' : '缓存扫描完成',
      body: scanState.error
        ? `扫描失败：${scanState.error}`
        : `已扫描 ${scanState.packages} 个包${scanState.tgzBytes ? ` · ${(scanState.tgzBytes / 1024 / 1024).toFixed(1)} MB` : ''}`,
      level: scanState.error ? 'error' : 'info',
      meta: {
        scan: true,
        success: !scanState.error,
        packages: scanState.packages,
        bytes: scanState.bytes,
        tgzBytes: scanState.tgzBytes,
        triggeredBy: triggerSource,
        finishedAt: scanState.finishedAt || new Date().toISOString(),
      },
    })

    // 通知类型 1：包版本过多预警（仅扫描成功时；快照比对去重，超阈值集合变化才发）
    if (!scanState.error && rawCache) {
      const threshold = Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD))
      const warnPkgs = (rawCache || [])
        .filter(p => p.versions > threshold && p.status !== 'broken')
        .sort((a, b) => b.versions - a.versions)
      if (warnPkgs.length > 0) {
        const snapshot = warnPkgs.map(p => `${p.name}:${p.versions}`).sort().join('|')
        const last = getSetting('last_warning_snapshot', '')
        if (snapshot !== last) {
          setSetting('last_warning_snapshot', snapshot)
          notify({
            type: 'version_warning',
            title: `${warnPkgs.length} 个包版本数超阈值（${threshold}）`,
            body: warnPkgs.slice(0, 3).map(p => `${p.name}(${p.versions})`).join('、') + (warnPkgs.length > 3 ? '…' : ''),
            level: 'warn',
            meta: {
              packageCount: warnPkgs.length, threshold,
              topPackages: warnPkgs.slice(0, 10).map(p => ({ name: p.name, versions: p.versions })),
            },
          })
        }
      }
    }

    // 通知类型 6：定时扫描预告（仅自动扫描完成后发一次，手动扫描不触发）
    if (triggerSource === 'daily' || triggerSource === 'pending') {
      const next = new Date()
      next.setHours(3, 0, 0, 0)
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
      const p = n => String(n).padStart(2, '0')
      notify({
        type: 'daily_preview',
        title: '下次自动扫描预告',
        body: `明日 ${p(next.getMonth() + 1)}-${p(next.getDate())} 03:00 将自动扫描缓存目录`,
        level: 'info',
        meta: { taskType: 'scan', nextRunAt: next.toISOString() },
      })
    }

    scanState._triggerSource = 'manual' // 复位，避免下次复用
    // 定时扫描被并发扫描挤掉时，扫描结束后立即补扫
    if (scanState.pendingDailyScan) {
      scanState.pendingDailyScan = false
      invalidateScan()
      console.log('[auto-scan] 并发扫描结束，开始补扫')
      scanState._triggerSource = 'pending'
      runScanAsync()
    }
  }
}

// 扫描失败后冷却期：避免持续异常（目录权限/挂载问题）时每次请求都触发扫描
const SCAN_RETRY_COOLDOWN_MS = 5 * 60_000 // 5 分钟

// 确保扫描已启动（缓存缺失或 dirty 时懒触发，不阻塞当前请求）
export function ensureScan() {
  if (isDemoMode()) return
  if (scanState.scanning) return
  // rawCache 存在但 dirty 时，也需要触发扫描重建缓存
  if (rawCache && !scanState.dirty) return
  // 失败冷却期内不重试，手动 POST /api/scan 不受此限制
  if (scanState.lastErrorAt) {
    const elapsed = Date.now() - new Date(scanState.lastErrorAt).getTime()
    if (elapsed < SCAN_RETRY_COOLDOWN_MS) return
  }
  scanState._triggerSource = 'lazy' // 懒触发（首次打开 / 写操作后重建缓存），区别于手动、每日、补扫
  runScanAsync()
}

export function getRawPackages() {
  return rawCache || []
}

/** 是否已有扫描缓存（rawCache 非 null；空目录扫描结果为 [] 也算已扫描） */
export function hasScanCache() {
  return rawCache !== null
}

export function invalidateScan() {
  // 保留 rawCache 供扫描期间使用，只标记 dirty；扫描结束时按世代比对决定是否清零
  invalidationEpoch += 1
  scanState.dirty = true
  packagesCache = null // 清空包列表构建缓存
  clearPkgCache() // storage 目录切换 / 清理动作后废弃增量缓存，避免旧目录条目残留
}

export function getScannedAt() {
  return rawCacheAt || null
}

// 构建包列表（统一状态计算 + 排序 + 忽略标记 + 来源筛选）
// 缓存全量列表：rawCache/ignored/threshold 不变时复用，避免每次请求全量 map 7000+ 条
export function buildPackages(keyword = '', origin = 'all') {
  const threshold = Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD))
  const ignoredRows = getIgnoredRows()
  const ignoredSet = new Set(ignoredRows.map(r => r.pkg_name))
  const ignoredAtMap = Object.fromEntries(ignoredRows.map(r => [r.pkg_name, (r.ignored_at || '').slice(0, 10)]))
  const raw = getRawPackages() || []

  // 缓存 key：raw 长度 + ignored 内容 hash + threshold（任一变化即失效）
  const ignoredHash = ignoredRows.map(r => `${r.pkg_name}:${r.ignored_at || ''}`).join('|')
  const cacheKey = `${raw.length}_${ignoredHash}_${threshold}`
  if (!packagesCache || packagesCache.key !== cacheKey) {
    const list = raw.map(p => {
      let status
      if (p.status === 'broken') status = 'broken'
      else if (ignoredSet.has(p.name)) status = 'ignored'
      else status = p.versions > threshold ? 'warn' : 'ok'
      return {
        name: p.name,
        versions: p.versions,
        size: p.size,
        lastUpdated: p.lastUpdated,
        visits: p.visits || 0,
        distTags: p.distTags || {},
        status,
        ignoredAt: ignoredAtMap[p.name] || null,
        description: p.description || null,
        homepage: p.homepage || null,
        // 原版 Verdaccio 界面字段：来源（private/proxy）与最新版本；列表不携带 readme/versionsDetail（响应体小），详情接口按需返回
        origin: p.origin || null,
        latest: p.latest || null,
      }
    })
    packagesCache = { key: cacheKey, list }
  }
  let list = packagesCache.list

  // 检索：不区分大小写子串，匹配包名（版本号匹配由前端本地完成，避免列表携带明细）
  const kw = keyword.trim().toLowerCase()
  if (kw) {
    list = list.filter(p => p.name.toLowerCase().includes(kw) || String(p.size).includes(kw))
  }
  // 来源筛选：all 不过滤；broken 无 origin 不命中 private/proxy
  if (origin === 'private' || origin === 'proxy') {
    list = list.filter(p => p.origin === origin)
  }

  // 排序：预警置顶 → 正常 → 忽略 → 异常；同状态按版本数降序
  const rank = { warn: 0, ok: 1, ignored: 2, broken: 3 }
  list = [...list].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    return b.versions - a.versions
  })
  return list
}