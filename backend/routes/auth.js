/**
 * 登录鉴权 —— server.js 抽离
 * - Verdaccio Mate 内置账号（Docker 部署通过 VCM_USERNAME/VCM_PASSWORD 环境变量覆盖）
 * - 会话为内存态，进程重启后需重新登录
 * - 登录限速：滑动窗口内失败达阈值即锁定（按客户端 IP）
 */
import express from 'express'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { addLog, nowIso, getSetting, setSetting } from '../db.js'
import { readHtpasswd, addHtpasswdUser, updateHtpasswdPassword, removeHtpasswdUser, verifyHtpasswdPassword, ensureBuiltinUser } from '../htpasswd.js'

const AUTH_USERNAME = process.env.VCM_USERNAME || 'admin'
// 启动即哈希：内存中不驻留明文口令；比较经 timingSafeEqual 消除时序侧信道（sha256 摘要恒 32 字节等长）
const AUTH_PASSWORD_HASH = createHash('sha256').update(process.env.VCM_PASSWORD || '666666').digest()
const SESSION_TTL_MS = 12 * 3600_000 // 会话有效期 12 小时，防长期 token 泄漏
const LOGIN_LOCK = { failures: 3, windowMs: 5 * 60_000, lockMs: 15 * 60_000 } // 3 次失败锁 15 分钟
const sessions = new Map() // token -> { name, at, exp }；内存态，进程重启后需重新登录
const loginFail = new Map() // ip -> { count, firstAt, lockedUntil }

// 登录限速：滑动窗口内失败达阈值即锁定（按客户端 IP）
function loginGuard(ip) {
  const now = Date.now()
  const rec = loginFail.get(ip)
  if (!rec) return { locked: false }
  if (rec.lockedUntil && now < rec.lockedUntil) {
    return { locked: true, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) }
  }
  if (rec.firstAt && now - rec.firstAt > LOGIN_LOCK.windowMs) {
    loginFail.delete(ip) // 窗口过期重置
    return { locked: false }
  }
  return { locked: false }
}

function recordLoginFail(ip) {
  const now = Date.now()
  let rec = loginFail.get(ip)
  if (!rec || now - rec.firstAt > LOGIN_LOCK.windowMs) rec = { count: 0, firstAt: now, lockedUntil: null }
  rec.count += 1
  if (rec.count >= LOGIN_LOCK.failures) {
    rec.lockedUntil = now + LOGIN_LOCK.lockMs
    console.warn(`[auth] IP ${ip} 登录失败 ${rec.count} 次，锁定 ${LOGIN_LOCK.lockMs / 60000} 分钟`)
  }
  loginFail.set(ip, rec)
}

function recordLoginOk(ip) {
  loginFail.delete(ip)
}

// 清理登录限速表：超过窗口 + 锁定期的记录不再保留（防 Map 无限增长）
setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of loginFail) {
    const stale = rec.lockedUntil
      ? now > rec.lockedUntil
      : now - rec.firstAt > LOGIN_LOCK.windowMs
    if (stale) loginFail.delete(ip)
  }
}, 10 * 60_000).unref()

export const authRouter = express.Router()

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent']
  const guard = loginGuard(ip)
  if (guard.locked) {
    addLog({ action: 'login', pkgName: String(username || ''), result: 'fail', message: '触发锁定', ip, meta: { retryAfter: guard.retryAfter, userAgent } })
    return res.status(429).json({ ok: false, message: `尝试过于频繁，请 ${guard.retryAfter} 秒后再试` })
  }
  const uname = String(username || '')
  const pwd = String(password || '')
  // 双通道登录：Verdaccio Mate 内置账号（VCM_USERNAME）优先；否则尝试 htpasswd 原版 Verdaccio 用户（原版 Verdaccio 用户可直接登录 Verdaccio Mate）
  let authedName = null
  let htErr = null
  // Verdaccio Mate 内置账号链路：口令启动时已哈希，此处对输入做同样哈希后 timingSafeEqual（sha256 恒 32 字节等长，无时序面）
  const inputHash = createHash('sha256').update(pwd).digest()
  if (uname === AUTH_USERNAME && timingSafeEqual(inputHash, AUTH_PASSWORD_HASH)) {
    authedName = AUTH_USERNAME
  } else {
    const v = verifyHtpasswdPassword(uname, pwd)
    if (v.ok) {
      authedName = uname
      // {SHA} 旧格式登录即升级：透明重写为 bcrypt，一次登录完成迁移；失败仅记审计不阻断登录。
      // updateHtpasswdPassword 有 ≥6 位密码校验，过短密码会升级失败，用户下次登录仍会自动重试。
      if (v.needsUpgrade) {
        const up = updateHtpasswdPassword(uname, pwd)
        addLog({
          action: 'user_upgrade', result: up.ok ? 'success' : 'fail', pkgName: uname,
          message: up.ok ? '旧哈希 {SHA} 已于登录时自动升级为 bcrypt' : `{SHA} 升级 bcrypt 失败：${up.message}`,
          ip, meta: { op: 'sha_upgrade', user: uname },
        })
      }
    } else {
      htErr = v.message || null
    }
  }
  if (!authedName) {
    recordLoginFail(ip)
    const rec = loginFail.get(ip)
    const left = rec && rec.lockedUntil ? Math.ceil((rec.lockedUntil - Date.now()) / 1000) : 0
    const msg = left > 0 ? '用户名或密码错误，已触发锁定' : (htErr || '用户名或密码错误')
    addLog({ action: 'login', pkgName: uname, result: 'fail', message: left > 0 ? `触发锁定，剩余 ${left} 秒` : msg, ip, meta: { userAgent } })
    return res.status(401).json({ ok: false, message: msg })
  }
  recordLoginOk(ip)
  const token = randomUUID()
  const now = Date.now()
  sessions.set(token, { name: authedName, at: now, exp: now + SESSION_TTL_MS })
  addLog({ action: 'login', pkgName: authedName, result: 'success', message: '登录成功', ip, meta: { userAgent } })
  res.json({ ok: true, token, user: { name: authedName } })
})

authRouter.post('/logout', (req, res) => {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) sessions.delete(auth.slice(7))
  res.json({ ok: true })
})

// 只读展示 原版 Verdaccio 原版 htpasswd 用户（登录不依赖它，也不做密码校验）
// authRouter 先于全局 authMiddleware 挂载，故此处显式套一层鉴权
authRouter.get('/htpasswd/users', authMiddleware, (req, res) => {
  const data = readHtpasswd()
  if (!data) {
    return res.json({ ok: false, enabled: false, message: '未找到 htpasswd 文件（可用 VERDACCIO_HTPASSWD 环境变量指定路径）' })
  }
  res.json({ ok: true, enabled: true, file: data.file, users: data.users, builtin: process.env.VCM_USERNAME || 'admin' })
})

// 新增用户（写入 原版 Verdaccio htpasswd；需容器以 rw 挂载 htpasswd，原版 Verdaccio 侧立即可登录）
authRouter.post('/htpasswd/users', authMiddleware, (req, res) => {
  const { name, password } = req.body || {}
  const r = addHtpasswdUser(name, password)
  if (!r.ok) return res.status(400).json({ ok: false, message: r.message })
  addLog({ action: 'user', pkgName: r.name || name, result: 'success', message: `新增用户 ${name}`, meta: { op: 'add', user: req.user } })
  // 创建成功后同步：把 Verdaccio Mate 内置账号（VCM_USERNAME）兜底补写进 htpasswd，保证双方用户名并集一致
  ensureBuiltinUser()
  res.json({ ok: true, message: r.message })
})

// 同步用户名：并集拉平 —— 把 Verdaccio Mate 内置账号补写进 htpasswd（缺则追加、同名以原版 Verdaccio 侧为准）
authRouter.post('/htpasswd/sync', authMiddleware, (req, res) => {
  const r = ensureBuiltinUser()
  setSetting('last_user_sync_at', nowIso())
  setSetting('last_user_sync_result', JSON.stringify(r))
  addLog({
    action: 'user_sync', result: r.ok ? 'success' : 'fail', message: r.message,
    meta: { added: !!r.added, name: r.name, user: req.user },
  })
  res.json({ ok: r.ok, ...r, syncedAt: nowIso() })
})

// 最近一次同步结果（供前端展示/复查）
authRouter.get('/htpasswd/sync/status', authMiddleware, (req, res) => {
  let result = null
  try { result = JSON.parse(getSetting('last_user_sync_result') || 'null') } catch { result = null }
  res.json({ ok: true, syncedAt: getSetting('last_user_sync_at'), result })
})

// 重置密码（重写该行 bcrypt 哈希，保留 meta）
authRouter.put('/htpasswd/users/:name/password', authMiddleware, (req, res) => {
  const name = req.params.name
  const { password } = req.body || {}
  const r = updateHtpasswdPassword(name, password)
  if (!r.ok) return res.status(400).json({ ok: false, message: r.message })
  addLog({ action: 'user', pkgName: name, result: 'success', message: `重置密码 ${name}`, meta: { op: 'password', user: req.user } })
  res.json({ ok: true, message: r.message })
})

// 删除用户（标准保护：禁止删除当前登录的 Verdaccio Mate 账号，避免把自己锁在门外）
authRouter.delete('/htpasswd/users/:name', authMiddleware, (req, res) => {
  const name = req.params.name
  if (name === req.user) return res.status(400).json({ ok: false, message: '不能删除当前登录的账号' })
  const r = removeHtpasswdUser(name)
  if (!r.ok) return res.status(400).json({ ok: false, message: r.message })
  addLog({ action: 'user', pkgName: name, result: 'success', message: `删除用户 ${name}`, meta: { op: 'remove', user: req.user } })
  res.json({ ok: true, message: r.message })
})

// 保护全部 /api/*（/login、/logout 除外）：未登录或会话过期返回 401，前端据此跳转登录页
export function authMiddleware(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') return next()
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const sess = token ? sessions.get(token) : null
  if (!sess) {
    return res.status(401).json({ ok: false, message: '未登录或会话已失效' })
  }
  if (Date.now() > sess.exp) {
    sessions.delete(token) // 过期 token 立即作废
    return res.status(401).json({ ok: false, message: '登录已过期，请重新登录' })
  }
  req.user = sess.name // 供路由在写拉取日志等时记录触发用户名
  next()
}