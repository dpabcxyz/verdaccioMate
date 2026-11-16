/**
 * npm Top1000 周榜缓存 —— 抓取 npm 周下载量榜单，与私服 storage 比对标记三态缓存状态
 *
 * 实现原理：
 * 1. Search 阶段：22 个关键词调用 npm Search API 各取 size=400，粗排取前 2500 候选
 * 2. Recheck 阶段：Downloads API 复核真实周下载量（非 @ 包批量 70/批，@ 包逐个 4 并发），
 *    用复核值覆盖快照值，降序截取前 1000 入榜（候选不足则取实际数）
 * 3. Compare 阶段：榜单与私服 rawCache 实时比对，标记 cached / latestCached 三态
 * 4. Pull 阶段：拉取 cached=false（待拉取）与 latestCached=false（需更新）的包，
 *    经 原版 Verdaccio ⚙ 代理落盘，与 sync-latest 同机制
 *
 * 环境变量：VERDACCIO_BASE_URL（复用 sync-latest）
 * 不引入新依赖：网络复用 Node 内置 fetch；落盘复用 sync-latest 的 triggerVerdaccio
 */
import { getSetting, getTopListRows, replaceTopList } from './db.js'
import { triggerVerdaccio, VERDACCIO_BASE, QUERY_TIMEOUT } from './sync-latest.js'
import { fetchJson, sleep } from './net.js'
import { randomUUID } from 'node:crypto'

// 编码包名（与 sync-latest 一致）
const enc = name => encodeURIComponent(name)

// —— 抓榜状态（前端轮询进度，与 syncState 模式对称） ——
export const toplistState = {
  running: false, done: false,
  phase: 'idle',           // 'idle' | 'search' | 'recheck' | 'compare' | 'done'
  total: 0, processed: 0,
  success: 0, skipped: 0, failed: 0,
  failedList: [],          // [{name, reason}]
  current: null,           // 当前处理的关键词或包名
  error: null,
  startedAt: null, finishedAt: null,
  // 拉取子状态（与 sync-latest 对称）
  pullRunning: false, pullTotal: 0, pullProcessed: 0,
  pullSuccess: 0, pullSkipped: 0, pullFailed: 0, pullFailedList: [],
  pullCurrent: null, pullStartedAt: null, pullFinishedAt: null,
}

// npm 公共匿名接口，隐性速率限制（超了返回 429 或临时封 IP）；用户明确"不急、接口慢慢调"
const KEYWORDS = ['javascript', 'node', 'react', 'vue', 'css', 'util', 'web', 'frontend',
  'angular', 'typescript', 'api', 'test', 'tool', 'cli', 'server', 'build', 'http',
  'data', 'component', 'style', 'message', 'theme']
const SEARCH_API = 'https://registry.npmjs.org/-/v1/search'
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week'
const SEARCH_SIZE = 400
const COARSE_TOP = 2500
const FINAL_TOP = 1000
const REQ_INTERVAL_MS = 1500      // 请求间隔：避开 npm 匿名隐性限流（用户允许慢）
const RECHECK_CONCURRENCY = 4     // @ 包逐个复核并发
const RECHECK_BATCH = 70          // 非 @ 包批量复核每批大小（一次请求复核 70 个）
const PULL_CONCURRENT = 3         // 拉取并发（与 sync-latest 一致）
const FETCH_TIMEOUT = 20_000

function resetFetchState() {
  toplistState.done = false
  toplistState.phase = 'idle'
  toplistState.total = 0
  toplistState.processed = 0
  toplistState.success = 0
  toplistState.skipped = 0
  toplistState.failed = 0
  toplistState.failedList = []
  toplistState.current = null
  toplistState.error = null
  toplistState.startedAt = new Date().toISOString()
}

/** Search 阶段：顺序抓 22 个关键词 → 合并去重候选（name 唯一，保留最大周下载） */
async function runSearch(pool) {
  toplistState.phase = 'search'
  toplistState.total = KEYWORDS.length
  toplistState.processed = 0
  for (const kw of KEYWORDS) {
    toplistState.current = `搜索:${kw}`
    try {
      const data = await fetchJson(`${SEARCH_API}?text=${encodeURIComponent(kw)}&size=${SEARCH_SIZE}`, FETCH_TIMEOUT)
      for (const obj of (data && data.objects) || []) {
        const p = obj.package
        if (!p || !p.name || !p.version) continue
        const weekly = Math.max(0, Number((obj.downloads && obj.downloads.weekly) || 0))
        const prev = pool.get(p.name)
        if (!prev || weekly > (prev.search_weekly || 0)) {
          pool.set(p.name, {
            pkg_name: p.name,
            latest_version: p.version,
            search_weekly: weekly,
            keyword: kw,
          })
        }
      }
      toplistState.success += 1
    } catch (e) {
      const reason = e && e.message
      toplistState.failed += 1
      toplistState.failedList.push({ name: `关键词:${kw}`, reason })
    } finally {
      toplistState.processed += 1
      await sleep(REQ_INTERVAL_MS)
    }
  }
  // 粗排截前 2500
  const cands = [...pool.values()].sort((a, b) => (b.search_weekly || 0) - (a.search_weekly || 0)).slice(0, COARSE_TOP)
  return cands
}

/** Downloads API 批量复核非 @ 包（70/批） */
async function recheckBatch(names, map) {
  for (let i = 0; i < names.length; i += RECHECK_BATCH) {
    const chunk = names.slice(i, i + RECHECK_BATCH)
    try {
      const data = await fetchJson(`${DOWNLOADS_API}/${chunk.join(',')}`, FETCH_TIMEOUT) || {}
      for (const name of chunk) {
        if (data[name] && data[name].downloads != null) map.get(name).weekly_downloads = Number(data[name].downloads) || 0
      }
    } catch (e) {
      toplistState.failed += 1
      toplistState.failedList.push({ name: `批量复核[${i}-${Math.min(i + RECHECK_BATCH, names.length)}]`, reason: e.message })
    }
    await sleep(REQ_INTERVAL_MS)
  }
}

/** Downloads API 逐个复核 @ 包（4 并发 worker pool） */
async function recheckScoped(cands, map) {
  const items = cands.slice()
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const c = items[next++]
      toplistState.current = `复核:${c.pkg_name}`
      try {
        const data = await fetchJson(`${DOWNLOADS_API}/${encodeURIComponent(c.pkg_name)}`, FETCH_TIMEOUT)
        if (data && data.downloads != null) map.get(c.pkg_name).weekly_downloads = Number(data.downloads) || 0
        toplistState.processed += 1
      } catch (e) {
        toplistState.failed += 1
        toplistState.failedList.push({ name: c.pkg_name, reason: e.message })
        toplistState.processed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RECHECK_CONCURRENCY, items.length) }, worker))
}

/** Recheck 阶段：复核真实下载量 → 降序截取前 1000 */
async function runRecheck(cands) {
  toplistState.phase = 'recheck'
  toplistState.total = cands.length
  toplistState.processed = 0
  const map = new Map(cands.map(c => [c.pkg_name, c]))
  const scoped = cands.filter(c => c.pkg_name.startsWith('@'))
  const unscoped = cands.filter(c => !c.pkg_name.startsWith('@'))
  toplistState.current = `复核批量 ${unscoped.length} 个`
  await recheckBatch(unscoped.map(c => c.pkg_name), map)
  if (scoped.length) await recheckScoped(scoped, map)
  return [...map.values()]
    .sort((a, b) => (b.weekly_downloads || 0) - (a.weekly_downloads || 0))
    .slice(0, FINAL_TOP)
    .map((c, i) => ({ ...c, rank: i + 1 }))
}

/** Compare 阶段：榜单与私服 rawCache 实时比对，标记三态 */
export function compareWithCache(topList, rawPackages) {
  const pkgMap = new Map((rawPackages || []).map(p => [p.name, p]))
  return (topList || []).map(entry => {
    const pkg = pkgMap.get(entry.pkg_name)
    const vs = pkg && Array.isArray(pkg.versionsDetail) ? pkg.versionsDetail : []
    const versionSet = new Set(vs.map(v => v.version))
    return {
      ...entry,
      cached: versionSet.size > 0,
      latestCached: versionSet.has(entry.latest_version),
      cachedVersions: [...versionSet],
      // 兼容前端易读字段名
      name: entry.pkg_name,
      latestVersion: entry.latest_version,
      weeklyDownload: entry.weekly_downloads,
    }
  })
}

/** 拉取子状态重置 */
function resetPullState() {
  toplistState.pullRunning = false
  toplistState.pullDone = false
  toplistState.pullTotal = 0
  toplistState.pullProcessed = 0
  toplistState.pullSuccess = 0
  toplistState.pullSkipped = 0
  toplistState.pullFailed = 0
  toplistState.pullFailedList = []
  toplistState.pullCurrent = null
  toplistState.pullError = null
  toplistState.pullStartedAt = null
  toplistState.pullFinishedAt = null
}

/** 同步 GET 返回 DB 当前快照 + 实时比对结果（不写 DB），供 GET /api/toplist */
export function getTopList(getRawPackages) {
  const list = getTopListRows()
  const compared = compareWithCache(list, (getRawPackages && getRawPackages()) || [])
  const summary = {
    total: compared.length,
    cached: compared.filter(e => e.cached).length,
    latestCached: compared.filter(e => e.latestCached).length,
    missing: compared.filter(e => !e.cached).length,
    outdated: compared.filter(e => e.cached && !e.latestCached).length,
  }
  return {
    list: compared,
    summary,
    state: toplistState,
    lastRun: getSetting('toplist_last_run', null),
    nextRun: getSetting('toplist_next_run', null),
  }
}

/**
 * 抓榜主流程：search → recheck → compare → persist
 * @param {{ addLog, getRawPackages, invalidateScan, setSetting, notify }} services 依赖注入
 */
export async function runTopListFetch({ addLog, getRawPackages, invalidateScan, setSetting, notify, source = {} }) {
  if (toplistState.running) return { ok: false, running: true }
  const taskType = source.taskType || 'manual' // 触发来源：manual（手工）| auto（定时任务）
  const user = source.user || null // 触发用户；定时任务为 null
  resetFetchState()
  resetPullState()
  toplistState.running = true
  console.log('[toplist] 开始抓取 npm Top1000 周榜')
  try {
    const pool = new Map()
    await runSearch(pool)
    const cands = [...pool.values()].sort((a, b) => (b.search_weekly || 0) - (a.search_weekly || 0)).slice(0, COARSE_TOP)
    if (!cands.length) throw new Error('Search 阶段未获取到任何候选包')

    toplistState.phase = 'compare'
    // 复核前先算出真实下载，最后统一截取
    const ranked = await runRecheck(cands)

    // 通知类型 5：榜单发生变化（旧榜单非空且确有变化才发；首次抓榜无变化可比）
    if (notify) {
      const prevRows = getTopListRows()
      if (prevRows.length) {
        const newSet = new Map(ranked.map(e => [e.pkg_name, e]))
        const oldSet = new Map(prevRows.map(e => [e.pkg_name, e]))
        const newEntries = ranked.filter(e => !oldSet.has(e.pkg_name))
        const dropped = prevRows.filter(e => !newSet.has(e.pkg_name))
        const versionUpdates = ranked.filter(e => {
          const old = oldSet.get(e.pkg_name)
          return old && old.latest_version !== e.latest_version
        })
        if (newEntries.length || dropped.length || versionUpdates.length) {
          notify({
            type: 'toplist_change',
            title: `榜单更新：新进 ${newEntries.length} · 掉出 ${dropped.length} · 版本更新 ${versionUpdates.length}`,
            body: newEntries.slice(0, 3).map(e => `▲${e.pkg_name}`).join('、') || '无新进包',
            level: 'info',
            meta: {
              newEntries: newEntries.map(e => e.pkg_name),
              dropped: dropped.map(e => e.pkg_name),
              versionUpdates: versionUpdates.map(e => ({ name: e.pkg_name, from: oldSet.get(e.pkg_name)?.latest_version, to: e.latest_version })),
            },
          })
        }
      }
    }

    replaceTopList(ranked)

    const lastRun = new Date().toISOString()
    setSetting('toplist_last_run', lastRun)
    addLog({
      action: 'toplist_fetch',
      result: 'success',
      message: `Top1000 抓榜完成：${ranked.length} 个包入榜`,
      durationMs: Date.now() - new Date(toplistState.startedAt).getTime(),
      meta: { total: ranked.length, failed: toplistState.failedList, taskType, user },
      deletedCount: ranked.length,
    })
    toplistState.phase = 'done'
    console.log(`[toplist] 抓榜完成：${ranked.length} 个包入榜`)
  } catch (e) {
    toplistState.error = e.message
    addLog({ action: 'toplist_fetch', result: 'fail', message: e.message, meta: { taskType, user } })
    console.error('[toplist] 抓榜失败:', e.message)
  } finally {
    toplistState.running = false
    toplistState.done = true
    toplistState.finishedAt = new Date().toISOString()
  }
  return { ok: !toplistState.error }
}

/**
 * 拉取榜单中待缓存 / 需更新的包（经 原版 Verdaccio ⚙ 代理落盘）
 * @param {{ addLog, getRawPackages, invalidateScan, notify }} services
 */
export async function runTopListPull({ addLog, getRawPackages, invalidateScan, notify, source = {} }) {
  if (toplistState.pullRunning) return { ok: false, running: true }
  const batchId = randomUUID() // 本批次 ID，逐包日志 / 汇总日志 / 通知共用
  const taskType = source.taskType || 'manual' // 触发来源：manual（手工）| auto（定时任务）
  const user = source.user || null // 触发用户；定时任务为 null
  // 必须存在已入榜数据
  const snapshot = getTopList(getRawPackages)
  const targets = snapshot.list.filter(e => !e.cached || !e.latestCached)
  resetPullState()
  toplistState.pullRunning = true
  toplistState.pullStartedAt = new Date().toISOString()
  toplistState.pullTotal = targets.length
  console.log(`[toplist] 开始拉取榜单待缓存包：${targets.length} 个`)
  if (!targets.length) {
    toplistState.pullFinishedAt = new Date().toISOString()
    toplistState.pullRunning = false
    toplistState.pullDone = true
    return { ok: true, running: false, total: 0 }
  }
  let next = 0
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++]
      toplistState.pullCurrent = t.pkg_name
      try {
        // 先请求 原版 Verdaccio 元数据：确保 原版 Verdaccio 代理了该包（与 sync-latest handleOne 一致），
        // 并用 原版 Verdaccio 返回的 dist-tags.latest 作为实际拉取版本（避免榜单 latest_version
        // 与原版 Verdaccio 可代理版本不一致导致 404）
        const meta = await fetchJson(`${VERDACCIO_BASE}/${enc(t.pkg_name)}`, QUERY_TIMEOUT, { label: '私服' })
        if (!meta) throw new Error('私服无此包（404）')
        const latest = meta['dist-tags'] && meta['dist-tags'].latest
        if (!latest) throw new Error('私服未提供 latest 版本')
        await triggerVerdaccio(t.pkg_name, latest)
        toplistState.pullSuccess += 1
        addLog({
          action: 'toplist_pull', pkgName: t.pkg_name, version: latest,
          result: 'success', message: `已拉取 ${latest}`, batchId,
          meta: { taskType, user },
        })
      } catch (e) {
        const reason = (e && e.message) || '拉取失败'
        toplistState.pullFailed += 1
        toplistState.pullFailedList.push({ name: t.pkg_name, reason })
        addLog({ action: 'toplist_pull', pkgName: t.pkg_name, version: t.latest_version, result: 'fail', message: reason, batchId, meta: { taskType, user } })
      } finally {
        toplistState.pullProcessed += 1
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENT, targets.length) }, worker))
  } catch (e) {
    toplistState.pullError = e.message
  } finally {
    toplistState.pullRunning = false
    toplistState.pullDone = true
    toplistState.pullFinishedAt = new Date().toISOString()
    // 汇总日志
    const summaryLogId = addLog({
      action: 'toplist_pull_summary',
      result: toplistState.pullError ? 'fail' : 'success',
      message: `Top1000 拉取完成：成功 ${toplistState.pullSuccess} · 失败 ${toplistState.pullFailed}`,
      durationMs: Date.now() - new Date(toplistState.pullStartedAt).getTime(),
      meta: { success: toplistState.pullSuccess, failed: toplistState.pullFailedList, taskType, user },
      deletedCount: toplistState.pullSuccess,
      batchId,
    })
    // 通知类型 4：拉取排行榜包结果
    if (notify) {
      notify({
        type: 'toplist_pull',
        title: toplistState.pullError
          ? '榜单拉取失败'
          : `榜单拉取完成：成功 ${toplistState.pullSuccess} · 失败 ${toplistState.pullFailed}`,
        body: toplistState.pullError || `共 ${toplistState.pullTotal} 个待缓存/需更新包`,
        level: toplistState.pullFailed > 0 ? 'warn' : 'info',
        relatedActionId: summaryLogId,
        batchId,
        meta: { success: toplistState.pullSuccess, failed: toplistState.pullFailed, total: toplistState.pullTotal },
      })
    }
    // 仅当有包真拉成功时才废弃扫描缓存：全部失败时无需重扫，避免触发无意义的全量扫描
    if (toplistState.pullSuccess > 0) {
      invalidateScan()
    }
  }
  return { ok: !toplistState.pullError, running: false, total: targets.length }
}