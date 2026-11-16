/**
 * HTTP 入参契约层（validate.js）—— Verdaccio Mate 写/配接口的 400 语义此前零覆盖：
 * 非法入参要么被 clampInt 静默改掉（写成 1 却毫无提示），要么直接 500（NaN 进 SQL）。
 * 这里守两件事：
 * ① 形状/边界错误统一 400 + code INVALID_PARAM + 中文提示（各路由原口径文案不变）；
 * ② 读路径的分页/限数是钳制不是拒绝，合法请求的响应形状与语义不被契约层改动。
 * 走真实 app.js 接线（demo 模式，不碰 原版 Verdaccio 与网络）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const envNames = ['DATA_DIR', 'VCM_DEMO', 'VCM_USERNAME', 'VCM_PASSWORD', 'VERDACCIO_STORAGE']
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-validate-data-'))
const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-validate-storage-'))
process.env.DATA_DIR = tmpData
process.env.VCM_DEMO = '1'
process.env.VCM_USERNAME = `validate-${process.pid}`
process.env.VCM_PASSWORD = 'validate-only-password'
delete process.env.VERDACCIO_STORAGE
// POST /api/storage 的正例需要一个真正有效的缓存目录
fs.writeFileSync(path.join(tmpStorage, 'package.json'), JSON.stringify({ name: 'seed', versions: {} }))

const { app } = await import('../app.js')
const { default: db } = await import('../db.js')

const srv = app.listen(0, '127.0.0.1')
await new Promise(resolve => srv.once('listening', resolve))
const base = `http://127.0.0.1:${srv.address().port}`

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.VCM_USERNAME, password: process.env.VCM_PASSWORD }),
})
const { token } = await login.json()

/** 带鉴权调用 /api 路由，返回 { status, data }（data 解析失败时为 null） */
async function api(route, opts = {}) {
  const r = await fetch(`${base}/api${route}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  })
  return { status: r.status, data: await r.json().catch(() => null) }
}

const post = (route, body) => api(route, { method: 'POST', body: JSON.stringify(body ?? {}) })

/** 断言统一 400 契约：HTTP 400 + ok:false + code INVALID_PARAM + 指定中文提示 */
async function expectInvalid(route, opts, message) {
  const { status, data } = await api(route, opts)
  assert.equal(status, 400, `${route} 非法入参应 400，实际 ${status}：${JSON.stringify(data)}`)
  assert.equal(data.ok, false)
  assert.equal(data.code, 'INVALID_PARAM', `${route} 应带 INVALID_PARAM：${JSON.stringify(data)}`)
  assert.equal(data.message, message)
}

const expectInvalidPost = (route, body, message) => expectInvalid(route, { method: 'POST', body: JSON.stringify(body) }, message)

/** 断言契约层放行（业务态由路由自决，可能是 200 或 400/404，但不得是 INVALID_PARAM） */
function assertPassedContract({ status, data }) {
  assert.notEqual(data?.code, 'INVALID_PARAM', `合法入参不该被判形状错误：${status} ${JSON.stringify(data)}`)
}

test.after(() => {
  srv.close()
  try { db.close() } catch { /* 已关闭 */ }
  for (const dir of [tmpData, tmpStorage]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  }
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('POST /api/clean：keep 的边界从静默钳制改为显式 400', async () => {
  await expectInvalidPost('/clean', { keep: 2 }, '缺少 pkgName')
  await expectInvalidPost('/clean', { pkgName: 'lodash', keep: 0 }, '保留版本数至少为 1')
  await expectInvalidPost('/clean', { pkgName: 'lodash', keep: 1000 }, '保留版本数最高 999')
  await expectInvalidPost('/clean', { pkgName: 'lodash', keep: 'abc' }, '保留版本数不合法')
  assertPassedContract(await post('/clean', { pkgName: 'lodash', keep: 2 }))
})

test('DELETE /api/packages/:pkgName/versions/:version：包名去空白后不得为空', async () => {
  await expectInvalid('/packages/%20/versions/1.0.0', { method: 'DELETE' }, '缺少 pkgName')
  assertPassedContract(await api('/packages/lodash/versions/9.9.9', { method: 'DELETE' }))
})

test('POST /api/pull：pkgName 与 version 分别提示，不再合并成一句', async () => {
  await expectInvalidPost('/pull', { pkgName: 'lodash' }, '缺少 version')
  await expectInvalidPost('/pull', { version: '1.0.0' }, '缺少 pkgName')
  assertPassedContract(await post('/pull', { pkgName: 'lodash', version: '1.0.0' }))
})

test('POST/DELETE /api/ignore：versionCount 仅作审计，缺省或非法都归 0 而不拒绝', async () => {
  await expectInvalidPost('/ignore', {}, '缺少 pkgName')
  const added = await post('/ignore', { pkgName: 'ignored-shape', versionCount: 'abc' })
  assert.equal(added.status, 200)
  assert.equal(added.data.ok, true)
  const list = await api('/ignored')
  assert.ok(JSON.stringify(list.data).includes('ignored-shape'), '忽略标记应已写入')
  const removed = await api('/ignore/ignored-shape', { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(removed.data.ok, true)
})

test('POST /api/storage：缺字段是形状错误，目录无效仍是业务 400', async () => {
  await expectInvalidPost('/storage', {}, '缺少 storageDir')
  const ok = await post('/storage', { storageDir: tmpStorage })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.ok, true, JSON.stringify(ok.data))
  const bad = await post('/storage', { storageDir: path.join(tmpStorage, 'nope') })
  assert.equal(bad.status, 400)
  assert.notEqual(bad.data.code, 'INVALID_PARAM')
  assert.equal(bad.data.ok, false)
})

test('POST /api/threshold：兼容 versionThreshold / value 两种字段名，越界显式拒绝', async () => {
  const viaValue = await post('/threshold', { value: '20' })
  assert.equal(viaValue.status, 200)
  assert.equal(viaValue.data.versionThreshold, 20, '字符串数字应归一为整数')
  const viaField = await post('/threshold', { versionThreshold: 5 })
  assert.equal(viaField.data.versionThreshold, 5)
  await expectInvalidPost('/threshold', {}, '缺少 versionThreshold')
  await expectInvalidPost('/threshold', { versionThreshold: 0 }, '版本阈值至少为 1')
  await expectInvalidPost('/threshold', { versionThreshold: 101 }, '版本阈值最高 100')
})

test('POST /api/thresholds：阈值必填、例外条目空名丢弃、越界拒绝', async () => {
  await expectInvalidPost('/thresholds', { versionThreshold: 12 }, '大小阈值不合法')
  await expectInvalidPost('/thresholds', {
    versionThreshold: 12, sizeThreshold: 300,
    exceptions: [{ pkgName: 'lodash' }],
  }, '版本阈值不合法')
  const saved = await post('/thresholds', {
    versionThreshold: 12,
    sizeThreshold: 300,
    exceptions: [{ pkgName: '  ', versionThreshold: 3, sizeThreshold: 50 }, { pkgName: 'lodash', versionThreshold: 3, sizeThreshold: 50 }],
  })
  assert.equal(saved.status, 200)
  const read = await api('/thresholds')
  assert.equal(read.data.versionThreshold, 12)
  assert.equal(read.data.sizeThreshold, 300)
  assert.equal(read.data.exceptions.length, 1, '空包名例外应被丢弃')
  assert.equal(read.data.exceptions[0].pkgName, 'lodash')
  await expectInvalidPost('/thresholds', {
    versionThreshold: 12,
    sizeThreshold: 300,
    exceptions: [{ pkgName: 'lodash', versionThreshold: 200, sizeThreshold: 50 }],
  }, '版本阈值最高 100')
})

test('读路径分页/限数是钳制而非拒绝（GET /api/logs、/api/notifications）', async () => {
  const logs = await api('/logs?page=abc&pageSize=1000')
  assert.equal(logs.status, 200)
  assert.equal(logs.data.page, 1)
  assert.equal(logs.data.pageSize, 500, 'pageSize 越界应夹到 500 而不是回退默认值')
  assert.ok(Array.isArray(logs.data.list))
  const pageZero = await api('/logs?page=0&pageSize=0')
  assert.equal(pageZero.data.page, 1)
  assert.equal(pageZero.data.pageSize, 1)
  const notes = await api('/notifications?sinceId=abc&limit=9999')
  assert.equal(notes.status, 200)
  assert.equal(notes.data.unreadCount, 0)
})

test('POST /api/notifications/:id/read：非数字 id 不再把 NaN 送进 SQL', async () => {
  await expectInvalidPost('/notifications/abc/read', {}, '参数不合法')
  const missing = await post('/notifications/999999/read')
  assert.equal(missing.status, 200, '不存在的 id 保持旧的静默成功语义')
})

test('MCP Key 管理：名称/权限/ id 走同一 400 契约', async () => {
  await expectInvalidPost('/mcp/keys', { name: '  ' }, '请填写 Key 名称')
  await expectInvalidPost('/mcp/keys', { name: 'x'.repeat(41) }, 'Key 名称最长 40 字符')
  await expectInvalidPost('/mcp/keys', { name: '契约用例', scope: 'admin' }, '权限级别不合法')
  const created = await post('/mcp/keys', { name: '契约用例' })
  assert.equal(created.status, 200)
  assert.ok(created.data.key.startsWith('vcm_'), '未指定 scope 应默认 read 并签发 Key')
  const revealed = await post(`/mcp/keys/${created.data.id}/reveal`, {})
  assert.equal(revealed.status, 200, '数字 id 应通过契约层并回看成功')
  assert.equal(revealed.data.key, created.data.key)
  await expectInvalid('/mcp/keys/abc/reveal', { method: 'POST' }, '参数不合法')
  await expectInvalid('/mcp/keys/abc', { method: 'DELETE' }, '参数不合法')
  await expectInvalid('/mcp/keys/abc/purge', { method: 'DELETE' }, '参数不合法')
  const gone = await api(`/mcp/keys/${created.data.id + 100000}`, { method: 'DELETE' })
  assert.equal(gone.status, 404, '数字 id 不存在仍是 404，不被契约层抢答成 400')
  const unrevoked = await api(`/mcp/keys/${created.data.id}/purge`, { method: 'DELETE' })
  assert.equal(unrevoked.status, 409, '未吊销的 Key 直接 purge 仍是业务 409')
  await api(`/mcp/keys/${created.data.id}`, { method: 'DELETE' })
})
