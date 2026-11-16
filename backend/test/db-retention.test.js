/**
 * 数据保留策略测试 —— logs/notifications 的裁剪行为与热路径索引
 * 背景：notifications 有内置裁剪（保留 100 条），logs 此前只增不删且 action/batch_id 无索引
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousEnv = Object.fromEntries(['DATA_DIR', 'VCM_DEMO', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]))
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-retention-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE

const { addLog, pruneLogs, getLogs, addNotification, getNotifications, default: db } = await import('../db.js')

test.after(() => {
  // Windows 下 SQLite WAL 文件句柄未释放会导致 rmSync EPERM：先显式关闭连接
  try { db.close() } catch {}
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch {}
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('pruneLogs 只保留最近 keep 条，最旧的先删', () => {
  for (let i = 0; i < 30; i++) addLog({ action: 'scan', message: `retention-log-${i}` })
  pruneLogs(20)
  const { list, total } = getLogs({ limit: 100 })
  assert.equal(total, 20)
  assert.ok(!list.some(l => l.message === 'retention-log-0'), '最旧的 log-0 应被裁掉')
  assert.ok(list.some(l => l.message === 'retention-log-29'), '最新的 log-29 应保留')
})

test('notifications 保留 100 条：addNotification 每次插入内置裁剪', () => {
  for (let i = 0; i < 105; i++) addNotification({ type: 'sync_batch', title: `retention-n-${i}` })
  const list = getNotifications({ sinceId: 0, limit: 200 }) // getNotifications 直接返回数组（非 {list} 包装）
  assert.equal(list.length, 100)
  assert.ok(!list.some(n => n.title === 'retention-n-0'), '最旧的 n-0 应被裁掉')
  assert.ok(list.some(n => n.title === 'retention-n-104'), '最新的 n-104 应保留')
})

test('logs 热路径索引存在（idx_logs_action / idx_logs_batch_id）', () => {
  const indexes = db.prepare('PRAGMA index_list(logs)').all().map(r => r.name)
  assert.ok(indexes.includes('idx_logs_action'), 'action 索引缺失：getLogs 筛选与计数会全表扫描')
  assert.ok(indexes.includes('idx_logs_batch_id'), 'batch_id 索引缺失：批次筛选会全表扫描')
})