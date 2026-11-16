/**
 * 存量包最新版本拉取 —— 一键把私服缓存中已有的包更新到上游最新版
 *
 * 实现原理：
 * 1. 查询：请求 原版 Verdaccio 私服上该包的元数据（GET /:pkg），取 dist-tags.latest；
 *    原版 Verdaccio 按自身 uplinks 配置（npm / 淘宝 / 华为等多源）路由到上游获取；
 * 2. 比对：本地 storage 已缓存该精确版本则跳过（不重复拉取）；
 * 3. 拉取：未缓存的版本请求 原版 Verdaccio HTTP 端点（GET /:pkg/-/:file.tgz），
 *    原版 Verdaccio 作为代理会从 uplinks 拉取并把 tgz + 元数据写入自身存储，
 *    元数据由 原版 Verdaccio 自己维护，格式与扫描器读取的完全一致。
 *
 * 环境变量：
 *   VERDACCIO_BASE_URL     私服地址（默认 http://127.0.0.1:4873；查询与代拉均走它，上游由 原版 Verdaccio 自行路由）
 */
import { scanStorageAsync, resolveStorageDir } from './scanner.js'
import { fetchJson } from './net.js'
import { randomUUID } from 'node:crypto'

export const VERDACCIO_BASE = (process.env.VERDACCIO_BASE_URL || 'http://127.0.0.1:4873').replace(/\/+$/, '')
export const QUERY_TIMEOUT = 15000 // 元数据查询超时（原版 Verdaccio 本地/uplink 转发通常较快）
const FETCH_TIMEOUT = 10 * 60_000 // tgz 拉取超时：大包（echarts 等）需要时间
const CONCURRENT = 3 // 同时拉取的包数：网络 IO 温和并发，避免打满 NAS 带宽

// —— 拉取状态（前端轮询进度，与 scanState 模式对称） ——
export const syncState = {
  running: false, done: false,
  total: 0, processed: 0,
  success: 0, skipped: 0, failed: 0,
  failedList: [], // [{ name, reason }]
  current: null, // 正在处理的包名
  error: null,
  startedAt: null, finishedAt: null,
}

function resetState() {
  syncState.done = false
  syncState.total = 0
  syncState.processed = 0
  syncState.success = 0
  syncState.skipped = 0
  syncState.failed = 0
  syncState.failedList = []
  syncState.current = null
  syncState.error = null
  syncState.startedAt = new Date().toISOString()
}

// 编码包名：scoped 包 @scope/name → %40scope%2fname（registry / verdaccio 均接受该编码）
const enc = name => encodeURIComponent(name)
// tarball 文件名：@scope/name → name-version.tgz（原版 Verdaccio 落盘命名不携带 scope 前缀）
const fileOf = (name, version) => `${name.split('/').pop()}-${version}.tgz`

/** 触发 原版 Verdaccio 代理拉取：走到该端点时 原版 Verdaccio 会从 uplink 拉取并落盘缓存
 * 导出供 server.js POST /api/pull（手工拉取）与 npm-toplist.js（榜单拉取）复用 */
export async function triggerVerdaccio(name, version) {
  const url = `${VERDACCIO_BASE}/${enc(name)}/-/${enc(fileOf(name, version))}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/octet-stream' } })
    if (!r.ok) {
      // 抓取响应体片段，便于诊断 401/403/404 等真实原因
      let bodyHint = ''
      try { bodyHint = (await r.text()).slice(0, 200) } catch { /* 诊断片段可选：读不到响应体就不附加提示，主错误照常上抛 */ }
      throw new Error(`私服响应 ${r.status}${bodyHint ? `：${bodyHint.replace(/\s+/g, ' ')}` : ''}`)
    }
    if (r.body) {
      // 丢弃响应体：原版 Verdaccio 已把包写进存储，本次只需等待传输完成
      for await (const _ of r.body) { /* drain */ }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('拉取超时')
    const cause = e && e.cause
    if (cause && cause.reason) {
      throw new Error(`私服连接失败：fetch failed（${cause.reason}）`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 本地是否已缓存该精确版本（versionsDetail 缺失时保守视为未缓存，交给原版 Verdaccio 层幂等判断） */
function hasLocalVersion(pkg, version) {
  const vs = pkg && pkg.versionsDetail
  if (!Array.isArray(vs)) return false
  return vs.some(v => String(v.version) === version)
}

async function handleOne(pkg, addLog, batchId, taskType, user) {
  try {
    const meta = await fetchJson(`${VERDACCIO_BASE}/${enc(pkg.name)}`, QUERY_TIMEOUT, { label: '私服' })
    const latest = meta && meta['dist-tags'] && meta['dist-tags'].latest
    if (!meta) {
      syncState.failed += 1
      syncState.failedList.push({ name: pkg.name, reason: '私服无此包（404）' })
      addLog({ action: 'sync_latest', pkgName: pkg.name, result: 'fail', message: '私服无此包（404）', batchId, meta: { taskType, user } })
      return
    }
    if (!latest) {
      syncState.failed += 1
      syncState.failedList.push({ name: pkg.name, reason: '私服未提供 latest 版本' })
      addLog({ action: 'sync_latest', pkgName: pkg.name, result: 'fail', message: '私服未提供 latest 版本', batchId, meta: { taskType, user } })
      return
    }
    if (hasLocalVersion(pkg, latest)) {
      syncState.skipped += 1 // 已是最新，不重复拉取
      addLog({ action: 'sync_latest', pkgName: pkg.name, version: latest, result: 'skipped', message: '已是最新版本，跳过', batchId, meta: { taskType, user } })
      return
    }
    await triggerVerdaccio(pkg.name, latest)
    syncState.success += 1
    addLog({ action: 'sync_latest', pkgName: pkg.name, version: latest, result: 'success', message: `已拉取 ${latest}`, batchId, meta: { taskType, user } })
  } catch (e) {
    const reason = (e && e.message) || '拉取失败'
    syncState.failed += 1
    syncState.failedList.push({ name: pkg.name, reason })
    addLog({ action: 'sync_latest', pkgName: pkg.name, result: 'fail', message: reason, batchId, meta: { taskType, user } })
  }
}

/**
 * 启动拉取任务（异步；running 时重复调用直接返回）
 * @param {{ addLog: Function, invalidateScan: Function, notify: Function }} services 依赖注入（避免与 server.js 循环引用）
 */
export async function runSyncLatest({ addLog, invalidateScan, notify, source = {} }) {
  if (syncState.running) return
  const batchId = randomUUID() // 本批次 ID，逐包日志 / 汇总日志 / 通知共用
  const taskType = source.taskType || 'manual' // 触发来源：manual（手工）| auto（定时任务）
  const user = source.user || null // 触发用户；定时任务为 null
  resetState()
  syncState.running = true
  console.log(`[sync-latest] 开始拉取存量包最新版本（经私服: ${VERDACCIO_BASE}，上游按 原版 Verdaccio uplinks 路由）`)
  try {
    // 存量包列表：优先直接扫描 storage（与 Verdaccio Mate 列表同源，且不依赖接口层扫描缓存是否就绪）
    let pkgs = []
    try {
      pkgs = await scanStorageAsync(resolveStorageDir())
    } catch (e) {
      syncState.error = `扫描缓存目录失败：${e.message}`
    }
    // 跳过异常包（元数据读取失败无法判断版本），其余全部纳入（含忽略中的包，它们同样是存量缓存）
    pkgs = (pkgs || []).filter(p => p && p.name && p.status !== 'broken')
    syncState.total = pkgs.length
    if (syncState.total === 0) {
      if (!syncState.error) syncState.error = '缓存目录为空，无可拉取的包'
    } else {
      let next = 0
      const worker = async () => {
        while (next < pkgs.length) {
          const pkg = pkgs[next++]
          syncState.current = pkg.name
          await handleOne(pkg, addLog, batchId, taskType, user)
          syncState.processed += 1
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENT, pkgs.length) }, worker))
    }
    // 汇总写操作日志（失败包名列表存 deletedVersions 兼容旧前端 + meta 存结构化结果）
    const summaryLogId = addLog({
      action: 'sync',
      pkgName: null,
      result: syncState.error ? 'fail' : 'success',
      message: syncState.error || `批量拉取完成：成功 ${syncState.success} · 跳过 ${syncState.skipped} · 失败 ${syncState.failed}`,
      durationMs: Date.now() - new Date(syncState.startedAt).getTime(),
      meta: { success: syncState.success, skipped: syncState.skipped, failed: syncState.failedList, taskType, user },
      deletedCount: syncState.success,
      deletedVersions: JSON.stringify({
        success: syncState.success,
        skipped: syncState.skipped,
        failed: syncState.failedList,
      }),
      batchId,
    })
    // 通知类型 2：批量拉取结果
    if (notify) {
      notify({
        type: 'sync_batch',
        title: syncState.error
          ? '批量拉取失败'
          : `批量拉取完成：成功 ${syncState.success} · 失败 ${syncState.failed}`,
        body: syncState.error || `共 ${syncState.total} 个包，跳过 ${syncState.skipped} 个已最新`,
        level: syncState.failed > 0 ? 'warn' : 'info',
        relatedActionId: summaryLogId,
        batchId,
        meta: { success: syncState.success, skipped: syncState.skipped, failed: syncState.failed, total: syncState.total },
      })
    }
    invalidateScan() // 有新版本入库 → 废弃扫描缓存，列表下次请求重扫
    console.log(`[sync-latest] 完成：成功 ${syncState.success} · 跳过 ${syncState.skipped} · 失败 ${syncState.failed}`)
  } catch (e) {
    syncState.error = e.message
    console.error('[sync-latest] 任务异常:', e.message)
  } finally {
    syncState.running = false
    syncState.done = true
    syncState.finishedAt = new Date().toISOString()
  }
}