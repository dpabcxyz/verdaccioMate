/**
 * SQLite 数据层（§4.1）
 * 表：settings / ignored_packages / logs
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 数据目录：环境变量 DATA_DIR 可覆盖（Docker 挂载 manager-data）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
export { DATA_DIR }

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'manager.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS ignored_packages (
  pkg_name   TEXT PRIMARY KEY,
  ignored_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  action           TEXT DEFAULT 'clean',
  pkg_name         TEXT,
  deleted_versions TEXT,
  deleted_count    INTEGER,
  freed_space      TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS top_list (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  rank             INTEGER NOT NULL,
  pkg_name         TEXT NOT NULL UNIQUE,
  latest_version   TEXT NOT NULL,
  weekly_downloads INTEGER NOT NULL DEFAULT 0,
  search_weekly    INTEGER DEFAULT 0,
  keyword          TEXT,
  fetched_at       DATETIME
);
CREATE INDEX IF NOT EXISTS idx_top_list_rank ON top_list(rank);
CREATE TABLE IF NOT EXISTS notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  level             TEXT DEFAULT 'info',
  related_action_id INTEGER,
  batch_id          TEXT,
  meta              TEXT,
  read_at           DATETIME,
  created_at        DATETIME
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE TABLE IF NOT EXISTS mcp_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_mask     TEXT NOT NULL,
  key_value_enc TEXT,
  scope        TEXT NOT NULL DEFAULT 'read',
  created_at   DATETIME,
  last_used_at DATETIME,
  revoked_at   DATETIME
);
`)

// 北京时间（Asia/Shanghai 固定 UTC+8，无夏令时）：SQLite DEFAULT CURRENT_TIMESTAMP 是 UTC，
// 与前端按本地时间展示相差 8 小时，故写入与迁移统一显式使用北京时间墙上时间字符串
// （格式与前端 slice 兼容：YYYY-MM-DD HH:MM:SS，不带时区后缀，避免被二次误解）
const pad2 = n => String(n).padStart(2, '0')
export function nowIso(input) {
  // 北京时间固定 UTC+8（无夏令时）：无参=当前时刻；可传 Date/毫秒时间戳/可解析字符串
  // （schedules.js 的榜单「下次运行」排期传未来 Date——参数被吞会导致排期恒等于现在）
  const ts = input == null ? Date.now()
    : input instanceof Date ? input.getTime()
    : typeof input === 'number' ? input
    : Date.parse(input)
  const d = new Date(ts + 8 * 3600_000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

function utcToShanghai(iso) {
  try {
    const ts = Date.parse(iso)
    if (!Number.isFinite(ts)) return null
    const d = new Date(ts + 8 * 3600_000)
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  } catch {
    return null
  }
}

// 旧库迁移：早期 logs 表无 action 列，运行时补齐（忽略/取消忽略等操作依赖该列区分类型）
const logCols = db.prepare('PRAGMA table_info(logs)').all().map(c => c.name)
if (!logCols.includes('action')) {
  db.exec("ALTER TABLE logs ADD COLUMN action TEXT DEFAULT 'clean'")
}
if (!logCols.includes('batch_id')) {
  db.exec('ALTER TABLE logs ADD COLUMN batch_id TEXT')
}

// logs 热路径索引（getLogs 按 action/batch_id 筛选、getLogTypeCounts GROUP BY action）：
// 必须建在 batch_id 列迁移之后（旧库该列由上方 ALTER 补齐），IF NOT EXISTS 保证幂等
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
  CREATE INDEX IF NOT EXISTS idx_logs_batch_id ON logs(batch_id);
`)

// 旧库迁移 v1：历史日志/忽略记录的时间戳是 UTC，统一转成北京时间；settings 标志位防重复执行
function migrateTimezone() {
  if (getSetting('timezone_migrated_v1')) return
  db.transaction(() => {
    for (const { id, created_at: t } of db.prepare('SELECT id, created_at FROM logs').all()) {
      if (t) {
        const local = utcToShanghai(t)
        if (local) db.prepare('UPDATE logs SET created_at = ? WHERE id = ?').run(local, id)
      }
    }
    for (const { pkg_name: n, ignored_at: t } of db.prepare('SELECT pkg_name, ignored_at FROM ignored_packages').all()) {
      if (t) {
        const local = utcToShanghai(t)
        if (local) db.prepare('UPDATE ignored_packages SET ignored_at = ? WHERE pkg_name = ?').run(local, n)
      }
    }
    setSetting('timezone_migrated_v1', '1')
  })()
}

// —— settings ——
export function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : def
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value))
}

// —— ignored ——
export function getIgnored() {
  return db.prepare('SELECT pkg_name FROM ignored_packages ORDER BY ignored_at DESC').all().map(r => r.pkg_name)
}

export function getIgnoredRows() {
  return db.prepare('SELECT pkg_name, ignored_at FROM ignored_packages ORDER BY ignored_at DESC').all()
}

export function isIgnored(pkgName) {
  return !!db.prepare('SELECT 1 FROM ignored_packages WHERE pkg_name = ?').get(pkgName)
}

export function addIgnored(pkgName) {
  db.prepare(
    'INSERT INTO ignored_packages (pkg_name, ignored_at) VALUES (?, ?) ON CONFLICT(pkg_name) DO NOTHING',
  ).run(pkgName, nowIso())
}

export function removeIgnored(pkgName) {
  db.prepare('DELETE FROM ignored_packages WHERE pkg_name = ?').run(pkgName)
}

// 旧库迁移 v2：logs 表扩展 6 个字段承载 6 类操作日志（登录/扫描/批量逐包/手工拉取/榜单拉取），幂等
function migrateLogsV2() {
  if (getSetting('logs_v2_migrated')) return
  const cols = db.prepare('PRAGMA table_info(logs)').all().map(c => c.name)
  const adds = {
    version: 'ALTER TABLE logs ADD COLUMN version TEXT',          // 单版本操作目标版本
    result: 'ALTER TABLE logs ADD COLUMN result TEXT',            // 'success' | 'fail' | 'skipped'
    message: 'ALTER TABLE logs ADD COLUMN message TEXT',          // 详细信息/失败原因
    duration_ms: 'ALTER TABLE logs ADD COLUMN duration_ms INTEGER', // 任务耗时（扫描/批量拉取汇总）
    meta: 'ALTER TABLE logs ADD COLUMN meta TEXT',                // JSON 扩展字段
    ip: 'ALTER TABLE logs ADD COLUMN ip TEXT',                    // 登录 IP
  }
  for (const [col, sql] of Object.entries(adds)) {
    if (!cols.includes(col)) db.exec(sql)
  }
  setSetting('logs_v2_migrated', '1')
}

// —— logs ——
export function addLog({
  action = 'clean', pkgName, deletedVersions = null, deletedCount = 0, freedSpace = null,
  version = null, result = null, message = null, durationMs = null, meta = null, ip = null,
  batchId = null,
} = {}) {
  const info = db.prepare(
    `INSERT INTO logs (action, pkg_name, deleted_versions, deleted_count, freed_space,
      version, result, message, duration_ms, meta, ip, batch_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(action, pkgName, deletedVersions, deletedCount, freedSpace,
    version, result, message, durationMs, meta ? JSON.stringify(meta) : null, ip, batchId, nowIso())
  // 节流裁剪：每累积 500 条触发一次，保留最近 5000 条（logs 只增不删会拖慢筛选/统计的全表扫描）
  if (Number(info.lastInsertRowid) % 500 === 0) pruneLogs(5000)
  return info.lastInsertRowid
}

/** 日志裁剪：仅保留最近 keep 条（addLog 按 id 间隔节流触发，也可手动调用） */
export function pruneLogs(keep = 5000) {
  db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)').run(keep)
}

export function getLogActions() {
  return db.prepare('SELECT DISTINCT action FROM logs ORDER BY action').all().map(r => r.action)
}

export function getLogs({ action = null, actions = null, batchId = null, q = null, offset = 0, limit = 50 } = {}) {
  // 兼容旧调用 getLogs(50)：首参为数字时视为旧版 limit
  if (typeof action === 'number') {
    return { list: db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(action), total: 0 }
  }
  const where = []
  const params = []
  if (action) { where.push('action = ?'); params.push(action) }
  if (Array.isArray(actions) && actions.length) {
    where.push(`action IN (${actions.map(() => '?').join(',')})`)
    params.push(...actions)
  }
  if (batchId) { where.push('batch_id = ?'); params.push(batchId) }
  if (q) {
    // 模糊检索覆盖日志全部文本字段（包名/版本/结果/消息/meta/批次号/IP/操作类型/时间）
    const esc = String(q).replace(/[%_\\]/g, m => '\\' + m)
    const like = `%${esc}%`
    where.push(`(pkg_name LIKE ? ESCAPE '\\' OR version LIKE ? ESCAPE '\\' OR result LIKE ? ESCAPE '\\'
      OR message LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\' OR batch_id LIKE ? ESCAPE '\\'
      OR ip LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR created_at LIKE ? ESCAPE '\\')`)
    params.push(like, like, like, like, like, like, like, like, like)
  }
  const wsql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM logs${wsql}`).get(...params).c
  const list = db.prepare(`SELECT * FROM logs${wsql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { list, total }
}

/** 各操作类型日志计数（供筛选标签展示计数；按前端分组聚合） */
export function getLogTypeCounts() {
  const rows = db.prepare('SELECT action, COUNT(*) c FROM logs GROUP BY action').all()
  const m = {}
  for (const r of rows) m[r.action] = r.c
  const sum = keys => keys.reduce((s, a) => s + (m[a] || 0), 0)
  return {
    pull: sum(['sync_latest', 'pull_manual', 'pull_toplist']),
    delete_version: sum(['delete_version', 'clean']),
    scan: m.scan || 0,
    login: m.login || 0,
    ignore: m.ignore || 0,
    user_sync: m.user_sync || 0,
    user: m.user || 0,
    mcp_call: m.mcp_call || 0,
    mcp_auth_fail: m.mcp_auth_fail || 0,
    mcp_key: m.mcp_key || 0,
  }
}

// —— top_list ——
const insertTop = db.prepare(
  `INSERT OR REPLACE INTO top_list (rank, pkg_name, latest_version, weekly_downloads, search_weekly, keyword, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
export function replaceTopList(rows) {
  db.transaction(rows => {
    db.prepare('DELETE FROM top_list').run()
    for (const r of rows || []) {
      insertTop.run(r.rank, r.pkg_name, r.latest_version, r.weekly_downloads || 0, r.search_weekly || 0, r.keyword || null, nowIso())
    }
  })(rows)
}

export function getTopListRows() {
  return db.prepare('SELECT * FROM top_list ORDER BY rank').all()
}

export function getTopListCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM top_list').get().c
}

// —— notifications ——
export function addNotification({
  type, title, body = '', level = 'info', relatedActionId = null, batchId = null, meta = null,
}) {
  const info = db.prepare(
    `INSERT INTO notifications (type, title, body, level, related_action_id, batch_id, meta, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(type, title, body, level, relatedActionId, batchId, meta ? JSON.stringify(meta) : null, nowIso())
  pruneNotifications(100)
  return info.lastInsertRowid
}

export function getNotifications({ sinceId = 0, limit = 20 } = {}) {
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE id > ? ORDER BY id DESC LIMIT ?',
  ).all(sinceId, limit)
  return rows.map(r => {
    let m = null
    if (r.meta) { try { m = JSON.parse(r.meta) } catch { m = null } }
    return { ...r, meta: m }
  })
}

export function getUnreadNotificationCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read_at IS NULL').get().c
}

export function markNotificationRead(id) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(nowIso(), id)
}

export function markAllNotificationsRead() {
  const r = db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(nowIso())
  return r.changes
}

export function pruneNotifications(keep = 100) {
  db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)').run(keep)
}

// 旧库迁移 v3：mcp_keys 增加密文列，承载 Verdaccio Mate「复制配置」回看所需的可恢复 Key
function migrateMcpKeyVault() {
  if (getSetting('mcp_key_vault_migrated')) return
  const cols = db.prepare('PRAGMA table_info(mcp_keys)').all().map(c => c.name)
  if (cols.length && !cols.includes('key_value_enc')) {
    db.exec('ALTER TABLE mcp_keys ADD COLUMN key_value_enc TEXT')
  }
  setSetting('mcp_key_vault_migrated', '1')
}

// —— mcp_keys（MCP 接入密钥：Verdaccio Mate 生成、客户端 Bearer 认证；认证用哈希，回看用密文） ——
export function insertMcpKey({ name, keyHash, keyMask, keyValueEnc, scope }) {
  const info = db.prepare(
    `INSERT INTO mcp_keys (name, key_hash, key_mask, key_value_enc, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(name, keyHash, keyMask, keyValueEnc, scope, nowIso())
  return info.lastInsertRowid
}

export function getMcpKeyByHash(keyHash) {
  return db.prepare('SELECT * FROM mcp_keys WHERE key_hash = ?').get(keyHash) || null
}

export function getMcpKeyById(id) {
  return db.prepare('SELECT * FROM mcp_keys WHERE id = ?').get(id) || null
}

export function listMcpKeys() {
  return db.prepare('SELECT * FROM mcp_keys ORDER BY id DESC').all()
}

// 吊销即抹掉密文：Key 已失效，不留可恢复材料
export function revokeMcpKey(id) {
  const r = db.prepare(
    'UPDATE mcp_keys SET revoked_at = ?, key_value_enc = NULL WHERE id = ? AND revoked_at IS NULL',
  ).run(nowIso(), id)
  return r.changes
}

// 删除已吊销记录（Verdaccio Mate「删除」按钮）；有效 Key 由调用方挡在门外
export function deleteMcpKey(id) {
  const r = db.prepare('DELETE FROM mcp_keys WHERE id = ? AND revoked_at IS NOT NULL').run(id)
  return r.changes
}

export function touchMcpKeyUsed(id) {
  db.prepare('UPDATE mcp_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), id)
}

// 模块加载时执行时间迁移 + logs v2 字段迁移 + mcp_keys 密文列迁移（均幂等）
migrateTimezone()
migrateLogsV2()
migrateMcpKeyVault()

export default db
