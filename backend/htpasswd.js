/**
 * 原版 Verdaccio 原版 htpasswd 用户文件解析与写入（只读列表 + 增删改密码）
 * - 路径优先级：VERDACCIO_HTPASSWD 环境变量 → 探测 storage 同级/常见位置
 *   （NAS 上常见于 verdaccio 配置目录：与 storage 同卷的 ../htpasswd）
 * - 每行格式：username:hash[:meta]，hash 支持 bcrypt（$2a$/$2b$/$2y$）或旧格式 {SHA}（登录成功后自动升级为 bcrypt）
 * - 只读接口不返回 hash 明文；写入接口用 bcryptjs 生成与原版 Verdaccio 一致的 $2a$10$ 哈希
 * - 写入采用「读全量 → 修改 → 同目录临时文件 + rename」原子替换，避免写一半损坏文件
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveStorageDir } from './scanner.js'

/** 解析 htpasswd 文件路径：环境变量显式指定 → 常见位置探测 */
export function resolveHtpasswdFile() {
  if (process.env.VERDACCIO_HTPASSWD) return process.env.VERDACCIO_HTPASSWD
  const storage = resolveStorageDir()
  const candidates = []
  if (storage) {
    // 与 storage 同级（verdaccio 数据卷里 conf 与 storage 相邻）最常见；storage 内也兜底探测
    candidates.push(path.join(storage, '..', 'htpasswd'))
    candidates.push(path.join(storage, '..', '.htpasswd'))
    candidates.push(path.join(storage, 'htpasswd'))
  }
  candidates.push('/verdaccio/htpasswd', 'htpasswd', '.htpasswd')
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch { /* 候选路径不存在（ENOENT）属预期，继续试下一个 */ }
  }
  return null
}

// —— 惰性读取 + 文件 mtime 缓存（避免每次请求读盘） ——
let cached = null // { file, users }
let cachedMtime = -1

/** 提取 hash 算法名：$2a$10$... → '2a'；{SHA}xxx → 'SHA'；$apr1$... → 'apr1'；crypt/明文 → 'plain' */
function algoOf(hash) {
  if (hash.startsWith('$')) {
    const end = hash.indexOf('$', 1)
    return end > 1 ? hash.slice(1, end) : hash.slice(1)
  }
  const brace = hash.indexOf('}')
  return brace > 0 ? hash.slice(1, brace) : 'plain'
}

/** 每种哈希格式的登录支持与迁移备注（与 verifyHtpasswdPassword 口径保持一致）。
 * login：能否登录 Verdaccio Mate；upgrade：登录一次后是否自动升级 bcrypt */
export function supportOf(algo) {
  if (algo === '2a' || algo === '2b' || algo === '2y') return { login: true, upgrade: false, remark: '支持登录面板' }
  if (algo === 'SHA') return { login: true, upgrade: true, remark: '可登录面板；登录一次后自动升级为 bcrypt' }
  if (algo === 'apr1') return { login: false, upgrade: false, remark: '不支持登录面板（Apache MD5 弱哈希）；重置密码后自动迁移为 bcrypt' }
  if (algo === 'plain') return { login: false, upgrade: false, remark: '不支持登录面板（crypt/明文等旧格式）；重置密码后自动迁移为 bcrypt' }
  return { login: false, upgrade: false, remark: '未知哈希格式，不支持登录面板；重置密码后自动迁移为 bcrypt' }
}

/**
 * 读取并解析 htpasswd 文件
 * @returns {null | { file: string, users: Array<{ name, algo, meta }> }}
 * 文件不存在/不可读返回 null；users 不含 hash 明文
 */
export function readHtpasswd() {
  const file = resolveHtpasswdFile()
  if (!file) return null
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  if (cached && cachedMtime === st.mtimeMs) return cached
  try {
    const users = []
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const [name, hash, ...rest] = t.split(':')
      if (!name || !hash) continue
      const algo = algoOf(hash)
      users.push({ name, algo, meta: rest.join(':') || null, ...supportOf(algo) })
    }
    cached = { file, users }
    cachedMtime = st.mtimeMs
  } catch {
    return null
  }
  return cached
}

// —— 写入（增删改密码）：读全量行 → 修改 → 同目录临时文件 + rename 原子替换 ——
import bcrypt from 'bcryptjs'

/** 用户名规范：npm 用户名规则（小写字母/数字/-/./_，不以 . 或 - 开头，≤32 位） */
export function validateUsername(name) {
  const n = String(name || '').trim()
  if (!n) return { ok: false, message: '用户名不能为空' }
  if (n.length > 32) return { ok: false, message: '用户名过长（最多 32 字符）' }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(n)) return { ok: false, message: '用户名仅支持小写字母、数字及 - . _，且不能以 . 或 - 开头' }
  return { ok: true, value: n }
}

/** 密码强度：与 Verdaccio Mate 内置账号口径一致 ≥6 位 */
export function validatePassword(pw) {
  const p = String(pw || '')
  if (p.length < 6) return { ok: false, message: '密码至少 6 位' }
  return { ok: true, value: p }
}

/** 逐行读取 htpasswd 原始内容（跳过空行/注释），返回 { lines, userMap } */
function readLines() {
  const file = resolveHtpasswdFile()
  if (!file) return { file: null, lines: [], userMap: new Map() }
  let lines = []
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  } catch {
    return { file: null, lines: [], userMap: new Map() }
  }
  const userMap = new Map()
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [name] = t.split(':')
    if (name) userMap.set(name, line)
  }
  return { file, lines, userMap }
}

/** 原子替换文件内容：同目录临时文件 + rename（避免写一半损坏，原版 Verdaccio 下次读取也是原子可见） */
function atomicWrite(file, content) {
  const tmp = path.join(path.dirname(file), `.htpasswd.tmp-${process.pid}-${Date.now()}`)
  try {
    fs.writeFileSync(tmp, content, { mode: 0o644 })
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* 清理临时文件自身失败无需处理：原写入错误 err 继续上抛 */ }
    throw err
  }
}

/** 使只读缓存失效（写操作后 mtime 已变，正常会自动失效，此处双保险） */
function invalidateCache() {
  cached = null
  cachedMtime = -1
}

/** 校验 htpasswd 用户名密码（供 Verdaccio Mate 登录双通道：Verdaccio Mate 内置账号优先，htpasswd 原版 Verdaccio 用户兜底）。
 * 支持 bcrypt（$2a/$2b/$2y，原版 Verdaccio 默认格式）与旧格式 {SHA}（Apache htpasswd -s 产物：'{SHA}' + Base64(SHA1)）。
 * {SHA} 校验通过时返回 needsUpgrade=true，由调用方在登录成功后把该行重写为 bcrypt（登录即迁移）；
 * 其余旧格式（$apr1$/crypt）仍不支持，返回 exists=true 但无法校验 */
export function verifyHtpasswdPassword(name, password) {
  const { file, userMap } = readLines()
  if (!file || !userMap.has(name)) return { ok: false, exists: false }
  const hash = userMap.get(name).split(':')[1] || ''
  // {SHA} 为单轮 SHA1，已属弱哈希：仅作迁移桥让老用户免重置登录，成功后立即升级 bcrypt
  if (hash.startsWith('{SHA}')) {
    const digest = createHash('sha1').update(String(password || ''), 'utf8').digest('base64')
    const ok = hash === `{SHA}${digest}`
    return ok ? { ok: true, exists: true, needsUpgrade: true } : { ok: false, exists: true }
  }
  if (!/^\$(2a|2b|2y)\$/.test(hash)) return { ok: false, exists: true, message: '该用户为旧版哈希，暂不支持登录 Verdaccio Mate' }
  const ok = bcrypt.compareSync(String(password || ''), hash)
  return ok ? { ok: true, exists: true } : { ok: false, exists: true }
}

/** 新增用户（用户名已存在则报错；哈希格式与原版 Verdaccio 自动创建一致：$2a$10$ + autocreated 时间戳） */
export function addHtpasswdUser(name, password) {
  const nu = validateUsername(name)
  if (!nu.ok) return nu
  const np = validatePassword(password)
  if (!np.ok) return np
  const { file, lines, userMap } = readLines()
  if (!file) return { ok: false, message: '未找到 htpasswd 文件（无法写入）' }
  if (userMap.has(nu.value)) return { ok: false, message: `用户 ${nu.value} 已存在` }
  const hash = bcrypt.hashSync(np.value, 10)
  lines.push(`${nu.value}:${hash}:autocreated ${new Date().toISOString()}`)
  try {
    atomicWrite(file, lines.join('\n') + '\n')
    invalidateCache()
  } catch {
    return { ok: false, message: '写入 htpasswd 失败（检查容器挂载是否为读写）' }
  }
  return { ok: true, message: `已新增用户 ${nu.value}` }
}

/** 修改密码：重写该行 hash，保留 meta（原版 Verdaccio 侧登录、Verdaccio Mate 侧拉取均生效） */
export function updateHtpasswdPassword(name, password) {
  const np = validatePassword(password)
  if (!np.ok) return np
  const { file, lines, userMap } = readLines()
  if (!file) return { ok: false, message: '未找到 htpasswd 文件（无法写入）' }
  const target = userMap.get(name)
  if (!target) return { ok: false, message: `用户 ${name} 不存在` }
  const hash = bcrypt.hashSync(np.value, 10)
  const next = lines.map(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    if (t.split(':')[0] === name) return `${name}:${hash}${t.includes(':', t.indexOf(':') + 1) ? ':' + t.split(':').slice(2).join(':') : ''}`
    return line
  })
  try {
    atomicWrite(file, next.join('\n') + '\n')
    invalidateCache()
  } catch {
    return { ok: false, message: '写入 htpasswd 失败（检查容器挂载是否为读写）' }
  }
  return { ok: true, message: `已重置用户 ${name} 的密码` }
}

/** 删除用户（路由层负责禁止删除当前登录账号） */
export function removeHtpasswdUser(name) {
  const { file, lines, userMap } = readLines()
  if (!file) return { ok: false, message: '未找到 htpasswd 文件（无法写入）' }
  if (!userMap.has(name)) return { ok: false, message: `用户 ${name} 不存在` }
  const next = lines.filter(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return true
    return t.split(':')[0] !== name
  })
  try {
    atomicWrite(file, next.join('\n') + '\n')
    invalidateCache()
  } catch {
    return { ok: false, message: '写入 htpasswd 失败（检查容器挂载是否为读写）' }
  }
  return { ok: true, message: `已删除用户 ${name}` }
}

/** Verdaccio Mate 内置账号（VCM_USERNAME）补写进 htpasswd（用户名同步：并集拉平）。
 * 不存在 → 追加（bcrypt 内置密码 + autocreated 时间戳）；已存在 → 保持 htpasswd 哈希不变（同名以原版 Verdaccio 侧为准） */
export function ensureBuiltinUser() {
  const name = process.env.VCM_USERNAME || 'admin'
  const pwd = process.env.VCM_PASSWORD || '666666'
  const { file, lines, userMap } = readLines()
  if (!file) return { ok: false, message: '未找到 htpasswd 文件（无法写入）' }
  if (userMap.has(name)) return { ok: true, added: false, name, message: 'htpasswd 已存在同名用户，同步跳过（不覆盖其密码）' }
  const hash = bcrypt.hashSync(pwd, 10)
  lines.push(`${name}:${hash}:autocreated ${new Date().toISOString()}`)
  try {
    atomicWrite(file, lines.join('\n') + '\n')
    invalidateCache()
  } catch {
    return { ok: false, message: '写入 htpasswd 失败（检查容器挂载是否为读写）' }
  }
  return { ok: true, added: true, name, message: `已将 Verdaccio Mate 内置账号 ${name} 补写入 htpasswd` }
}
