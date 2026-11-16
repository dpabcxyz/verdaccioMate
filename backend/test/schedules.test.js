/**
 * 定时任务排期纯函数测试 —— 时间推算此前内联在 setTimeout 前，抽取后可测边界
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousEnv = Object.fromEntries(['DATA_DIR', 'VCM_DEMO', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]))
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-sched-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE

const { nextDailyRun3am, nextMondayMidnight } = await import('../schedules.js')
const { default: db } = await import('../db.js')

test.after(() => {
  try { db.close() } catch {}
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch {}
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const D = (y, m, d, h = 0, min = 0, sec = 0, ms = 0) => new Date(y, m - 1, d, h, min, sec, ms)
const same = (a, b) => assert.equal(a.getTime(), b.getTime())

// —— nextDailyRun3am：今天 03:00 未过则今天，否则明天 ——
test('03:00 前 → 今天 03:00', () => {
  same(nextDailyRun3am(D(2026, 11, 5, 2, 59)), D(2026, 11, 5, 3))
})
test('恰好 03:00 → 明天 03:00（<= 判已过）', () => {
  same(nextDailyRun3am(D(2026, 11, 5, 3, 0, 0, 0)), D(2026, 11, 6, 3))
})
test('03:00 后 → 明天 03:00', () => {
  same(nextDailyRun3am(D(2026, 11, 5, 3, 1)), D(2026, 11, 6, 3))
})
test('深夜 23:59 → 明天 03:00', () => {
  same(nextDailyRun3am(D(2026, 11, 5, 23, 59)), D(2026, 11, 6, 3))
})

// —— nextMondayMidnight：周一 00:00 已过则推下周 ——
test('周日白天 → 明天（周一）00:00', () => {
  same(nextMondayMidnight(D(2026, 11, 8, 10)), D(2026, 11, 9)) // 2026-11-08 是周日
})
test('周一白天 → 下周一 00:00', () => {
  same(nextMondayMidnight(D(2026, 11, 9, 8)), D(2026, 11, 16)) // 2026-11-09 是周一
})
test('恰逢周一 00:00 → 本周一（尚未过）', () => {
  same(nextMondayMidnight(D(2026, 11, 9, 0, 0, 0, 0)), D(2026, 11, 9))
})
test('周六 → 后天（周一）00:00', () => {
  same(nextMondayMidnight(D(2026, 11, 14, 12)), D(2026, 11, 16))
})
test('周日深夜 23:59 → 次日 00:00', () => {
  same(nextMondayMidnight(D(2026, 11, 8, 23, 59)), D(2026, 11, 9))
})
test('nowIso：接受未来时刻参数（修复 toplist_next_run 恒等于现在）', async () => {
  const { nowIso } = await import('../db.js')
  // 构造固定 UTC 时刻（2026-11-15 16:00 UTC = 北京 2026-11-16 00:00），与本机时区无关
  const future = new Date(Date.UTC(2026, 10, 15, 16, 0, 0))
  assert.equal(nowIso(future), '2026-11-16 00:00:00')
  // 未来时刻的排期应晚于当前时刻：用「当前 + 1 天」的动态时刻，避免固定日期随真实时间流逝而失效
  const tomorrow = new Date(Date.now() + 24 * 3600_000)
  assert.ok(nowIso(tomorrow) > nowIso())
})