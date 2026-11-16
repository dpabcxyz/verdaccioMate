/**
 * server 接线冒烟测试 —— 此前 /api/* 的路由装配、404/401 语义、公开接口均零覆盖
 * 直接驱动 app.js（app.listen(0) 随机端口），不启动生产 server.js（避免定时任务与端口占用）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousEnv = Object.fromEntries(['DATA_DIR', 'VCM_DEMO', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]))
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-wiring-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE

const { app } = await import('../app.js')
const { default: db } = await import('../db.js')

const srv = app.listen(0, '127.0.0.1')
await new Promise(resolve => srv.once('listening', resolve)) // listen(0) 异步绑定，等端口就绪
const base = `http://127.0.0.1:${srv.address().port}`

test.after(() => {
  srv.close()
  try { db.close() } catch {}
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch {}
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('已登录访问未知 /api 路由返回 JSON 404（apiNotFound 接线）', async () => {
  // 未登录时 authMiddleware 先行拦截统一返回 401（不向未认证者泄露路由存在性，见下方独立用例）
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '666666' }),
  })
  const { token } = await login.json()
  const r = await fetch(`${base}/api/__no_such__`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 404)
  const data = await r.json()
  assert.equal(data.ok, false)
})

test('未登录访问受保护接口返回 401 JSON（authMiddleware 接线）', async () => {
  const r = await fetch(`${base}/api/logs`)
  assert.equal(r.status, 401)
  assert.equal((await r.json()).ok, false)
})

test('Verdaccio Mate 内置账号登录成功签发 token（POST /api/login 接线）', async () => {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '666666' }),
  })
  assert.equal(r.status, 200)
  const data = await r.json()
  assert.equal(data.ok, true)
  assert.ok(data.token)
})

test('登录失败返回 401 与业务信息（单次失败不触发锁定）', async () => {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  })
  assert.equal(r.status, 401)
  const data = await r.json()
  assert.equal(data.ok, false)
  assert.ok(data.message)
})

test('带 token 访问 /api/logs 走通 logsRouter 接线', async () => {
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '666666' }),
  })
  const { token } = await login.json()
  const r = await fetch(`${base}/api/logs?page=1&pageSize=10`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200)
  const data = await r.json()
  assert.ok(Array.isArray(data.list))
  assert.equal(typeof data.total, 'number')
})

test('主题接口公开无需鉴权（themeRouter 挂载在 authMiddleware 之前）', async () => {
  const r = await fetch(`${base}/api/theme`)
  assert.equal(r.status, 200)
})

test('/mcp 无 Key 返回 401（MCP 端点独立鉴权接线）', async () => {
  const r = await fetch(`${base}/mcp`, { method: 'POST' })
  assert.equal(r.status, 401)
})

test('/mcp 非 POST 返回 405 并带 Allow 头', async () => {
  const r = await fetch(`${base}/mcp`, { method: 'GET' })
  assert.equal(r.status, 405)
  assert.equal(r.headers.get('allow'), 'POST')
})