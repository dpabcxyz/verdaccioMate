/**
 * {SHA} 旧哈希登录自动升级测试 —— 登录即迁移（路线 B）
 * 覆盖：{SHA} 原密码登录成功且该行升级为 bcrypt；密码错误不升级；
 *       bcrypt 用户登录不触发升级；过短密码升级失败降级（登录仍成功 + user_upgrade 审计）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const previousEnv = Object.fromEntries(
  ['DATA_DIR', 'VCM_USERNAME', 'VCM_PASSWORD', 'VCM_DEMO', 'VERDACCIO_HTPASSWD', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]),
)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-sha-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE
delete process.env.VERDACCIO_HTPASSWD

const { verifyHtpasswdPassword, addHtpasswdUser } = await import('../htpasswd.js')
const { authRouter, authMiddleware } = await import('../routes/auth.js')
const { getLogs } = await import('../db.js')
const express = (await import('express')).default

/** 生成 Apache htpasswd -s 口径的 {SHA} 行哈希：'{SHA}' + Base64(SHA1(密码)) */
const shaHash = pwd => `{SHA}${createHash('sha1').update(pwd, 'utf8').digest('base64')}`

let htpasswdFile

test.beforeEach(() => {
  // 每条用例独立 htpasswd 文件（空文件起步）
  htpasswdFile = path.join(os.tmpdir(), `vcm-sha-${Date.now()}-${Math.random().toString(36).slice(2)}.htpasswd`)
  fs.writeFileSync(htpasswdFile, '')
  process.env.VERDACCIO_HTPASSWD = htpasswdFile
})

test.afterEach(() => {
  try { fs.rmSync(htpasswdFile, { force: true }) } catch {}
})

test.after(() => {
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch {}
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** 读取文件中指定用户的原始行（name:hash[:meta]） */
function lineOf(name) {
  return fs.readFileSync(htpasswdFile, 'utf8').split('\n').find(l => l.startsWith(`${name}:`)) || null
}

/** 启动带鉴权路由的 mini express（复用 htpasswd-write.test.js 的接线模式），返回 base URL */
async function startServer(t) {
  const mini = express()
  mini.use(express.json())
  mini.use('/api', authRouter)
  mini.use('/api', authMiddleware)
  const srv = mini.listen(0, '127.0.0.1')
  await new Promise(resolve => srv.once('listening', resolve)) // listen(0) 异步绑定，等端口就绪
  t.after(() => srv.close())
  return `http://127.0.0.1:${srv.address().port}`
}

async function login(base, username, password) {
  return fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

test('{SHA} 用户原密码登录成功：该行自动升级为 bcrypt，原密码继续可用', async t => {
  fs.writeFileSync(htpasswdFile, `shauser:${shaHash('oldpass123')}\n`)
  const base = await startServer(t)

  const res = await login(base, 'shauser', 'oldpass123')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(body.token, '应颁发会话 token')

  const line = lineOf('shauser')
  assert.match(line, /^shauser:\$2[aby]\$/, '{SHA} 行应已在登录时升级为 bcrypt')
  const v = verifyHtpasswdPassword('shauser', 'oldpass123')
  assert.equal(v.ok, true, '升级后原密码仍通过 bcrypt 校验')
  assert.ok(!v.needsUpgrade, '升级后不应再标记 needsUpgrade')

  // 升级审计：恰好一条 success
  const logs = getLogs({ action: 'user_upgrade', limit: 20 })
  const hits = logs.list.filter(l => l.pkg_name === 'shauser')
  assert.equal(hits.length, 1, '同一用户登录一次只应产生一条升级审计')
  assert.equal(hits[0].result, 'success')
})

test('{SHA} 密码错误：登录 401，该行保持 {SHA} 不升级', async t => {
  fs.writeFileSync(htpasswdFile, `shabad:${shaHash('rightpass1')}\n`)
  const base = await startServer(t)

  const res = await login(base, 'shabad', 'wrongpass9')
  assert.equal(res.status, 401)
  assert.match(lineOf('shabad'), /^shabad:\{SHA\}/, '校验失败不应重写该行')
})

test('bcrypt 用户登录：不触发升级，行哈希保持不变', async t => {
  addHtpasswdUser('buser', 'secret123')
  const before = lineOf('buser').split(':')[1]
  const base = await startServer(t)

  const res = await login(base, 'buser', 'secret123')
  assert.equal(res.status, 200)
  assert.equal(lineOf('buser').split(':')[1], before, 'bcrypt 行不应被重写')
})

test('{SHA} + 过短密码：登录成功但升级失败降级，行保持 {SHA}，审计记 fail', async t => {
  fs.writeFileSync(htpasswdFile, `shortsha:${shaHash('abc')}\n`)
  const base = await startServer(t)

  // 密码哈希校验（SHA1）通过，登录不应被升级失败阻断；但 ≥6 位校验不过，升级降级为保留原行
  const res = await login(base, 'shortsha', 'abc')
  assert.equal(res.status, 200)
  assert.match(lineOf('shortsha'), /^shortsha:\{SHA\}/, '升级失败应保留原 {SHA} 行')

  const logs = getLogs({ action: 'user_upgrade', limit: 20 })
  const hit = logs.list.find(l => l.pkg_name === 'shortsha' && l.result === 'fail')
  assert.ok(hit, '升级失败应写 user_upgrade fail 审计')
  assert.match(hit.message, /失败|过短|6 位/, '失败审计应携带原因')
})
