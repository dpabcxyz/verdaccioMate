/**
 * 定时任务编排 —— server.js 抽离
 * - scheduleDailyScan：每天 03:00 自动重扫缓存
 * - scheduleWeeklyTopList：每周一 00:00 自动抓取 Top1000 榜单
 * 二者错峰（扫描 03:00 / 抓榜 00:00），避免并发撞车
 */
import { addLog, setSetting, nowIso } from './db.js'
import { notify } from './notifier.js'
import { scanState, invalidateScan, runScanAsync, getRawPackages } from './scan-manager.js'
import { runTopListFetch } from './npm-toplist.js'

/** 下次每日扫描时刻：今天 03:00 未过则今天，否则明天（本地时区；独立导出便于单测边界） */
export function nextDailyRun3am(from = new Date()) {
  const next = new Date(from)
  next.setHours(3, 0, 0, 0)
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1) // 今日 3 点已过 → 明日
  return next
}

/** 下次周一 00:00 时刻（本地时区）：每周榜单抓取排期；周一 00:00 已过则推下周 */
export function nextMondayMidnight(from = new Date()) {
  const next = new Date(from)
  next.setHours(0, 0, 0, 0)
  let days = (1 - next.getDay() + 7) % 7
  if (days === 0 && from.getTime() > next.getTime()) days = 7 // 周一 00:00 已过 → 下周一
  next.setDate(next.getDate() + days)
  return next
}

// —— 每天 03:00（服务器本地时区）自动重扫缓存，逻辑同 POST /api/scan ——
//   选 3 点而非 0 点：避开周一 0 点 Top1000 抓榜，减少并发撞车；凌晨 3 点用户访问最稀疏
export function scheduleDailyScan() {
  const now = new Date()
  const next = nextDailyRun3am(now)
  const wait = next.getTime() - now.getTime()
  setTimeout(() => {
    try {
      if (scanState.scanning) {
        // 扫描进行中：标记待扫，扫描结束后自动补扫（见 runScanAsync finally）
        scanState.pendingDailyScan = true
        console.log('[auto-scan] 扫描进行中，已排队待扫')
      } else {
        invalidateScan()
        scanState._triggerSource = 'daily'
        runScanAsync()
        console.log(`[auto-scan] ${new Date().toISOString()} 每日自动扫描已启动`)
      }
    } catch (e) {
      console.error('[auto-scan] 每日自动扫描失败:', e.message)
    }
    scheduleDailyScan() // 安排次日 03:00
  }, wait)
}

// —— 每周一 00:00（服务器本地时区）自动抓取 Top1000 榜单 ——
//   与每日扫描（03:00）错峰，避免并发冲突
export function scheduleWeeklyTopList() {
  const now = new Date()
  const next = nextMondayMidnight(now)
  setSetting('toplist_next_run', nowIso(next))
  setTimeout(async () => {
    try {
      await runTopListFetch({ addLog, getRawPackages, invalidateScan, setSetting, notify, source: { taskType: 'auto', user: null } })
      // 通知类型 6：榜单抓取预告（下次下周一 00:00，复用排期纯函数）
      const nextRun = nextMondayMidnight()
      const p = n => String(n).padStart(2, '0')
      notify({
        type: 'daily_preview',
        title: '下次榜单抓取预告',
        body: `下周一 ${p(nextRun.getMonth() + 1)}-${p(nextRun.getDate())} 00:00 将抓取 npm Top1000 榜单`,
        level: 'info',
        meta: { taskType: 'toplist_fetch', nextRunAt: nextRun.toISOString() },
      })
    } catch (e) {
      console.error('[toplist] 定时抓榜失败:', e.message)
    }
    scheduleWeeklyTopList()
  }, next.getTime() - now.getTime())
}