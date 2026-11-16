/** MCP 一期集成测试：真实登录/SDK，独立临时数据及 storage，不加载生产 server.js。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// db/auth 在模块加载时读取环境；密码随机生成，不使用真实账号/存储目录。
const envNames = ['DATA_DIR', 'VCM_DEMO', 'VCM_USERNAME', 'VCM_PASSWORD', 'VERDACCIO_STORAGE', 'VERDACCIO_HTPASSWD', 'MCP_ALLOWED_HOSTS']
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-mcp-test-'))
process.env.DATA_DIR = tmpData
process.env.VCM_DEMO = '1'
process.env.VCM_USERNAME = `test-${randomBytes(8).toString('hex')}`
process.env.VCM_PASSWORD = randomBytes(32).toString('base64url')
process.env.VERDACCIO_STORAGE = path.join(tmpData, 'storage')
process.env.VERDACCIO_HTPASSWD = path.join(tmpData, 'htpasswd')
process.env.MCP_ALLOWED_HOSTS = ''

const express = (await import('express')).default
const { mcpRequestHandler, resetMcpAuthFails } = await import('../mcp/index.js')
const { generateMcpKey, hashMcpKey, maskMcpKey, encryptMcpKey, decryptMcpKey, MCP_SCOPES } = await import('../mcp/keys.js')
const { truncateList, LIST_LIMIT, MCP_TOOLS, visibleTools } = await import('../mcp/tools.js')
const { mcpRouter } = await import('../routes/mcp.js')
const { authRouter, authMiddleware } = await import('../routes/auth.js')
const { default: db, getLogs, getMcpKeyByHash, getMcpKeyById, addIgnored, removeIgnored, setSetting } = await import('../db.js')
const { scanState, runScanAsync, ensureScan, getRawPackages, invalidateScan, isDemoMode } = await import('../scan-manager.js')
const { demoPackages } = await import('../scanner.js')

const app = express()
// 故意不挂全局 authMiddleware，以验证管理路由自身确实受到保护。
app.use(express.json())
app.use('/api', authRouter)
app.use('/api', mcpRouter)
app.get('/api/public', (req, res) => res.json({ ok: true }))
app.get('/api/panel-only', authMiddleware, (req, res) => res.json({ user: req.user }))
app.all('/mcp', mcpRequestHandler)
const srv = app.listen(0, '127.0.0.1')
await new Promise(r => srv.once('listening', r))
const base = `http://127.0.0.1:${srv.address().port}`
const clients = new Set()
let panelToken
let requestId = 0
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
}

async function httpJson(url, { body, ...opts }) {
  // Node fetch 会忽略自定义 Host；用原生 HTTP 确实将攻击/部署 Host 发上线路。
  const r = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { timeout: 5000, ...opts }, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(res.headers), raw }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('测试 HTTP 请求超时')))
    req.end(body)
  })
  return { status: r.status, headers: r.headers, data: r.raw ? JSON.parse(r.raw) : null }
}

async function panel(route, { token = panelToken, headers, ...opts } = {}) {
  const r = await httpJson(`${base}/api${route}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  })
  if (route.startsWith('/mcp/keys')) assert.equal(r.headers.get('cache-control'), 'no-store')
  return r
}

async function postRpc(body, key, headers = {}) {
  const r = await httpJson(`${base}/mcp`, {
    method: 'POST',
    headers: { ...HEADERS, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: JSON.stringify(body),
  })
  assert.equal(r.headers.get('cache-control'), 'no-store')
  return r
}

function rpc(method, params, key, headers) {
  return postRpc({ jsonrpc: '2.0', id: ++requestId, method, params }, key, headers)
}

async function call(name, args, key) {
  const r = await rpc('tools/call', { name, arguments: args }, key)
  assert.equal(r.status, 200)
  return r.data.result
}

function payload(result) {
  assert.notEqual(result.isError, true)
  const parsed = JSON.parse(result.content[0].text)
  assert.deepEqual(result.structuredContent, parsed)
  return parsed
}

async function makeKey(scope = 'read', name = '测试客户端') {
  const r = await panel('/mcp/keys', { method: 'POST', body: JSON.stringify({ name, scope }) })
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  return r.data.key
}

function auditRows(key) {
  const id = getMcpKeyByHash(hashMcpKey(key)).id
  return getLogs({ action: 'mcp_call', limit: 10_000 }).list
    .map(row => ({ ...row, meta: JSON.parse(row.meta) }))
    .filter(row => row.meta.keyId === id)
}

/** 认证失败审计行（含已解析的 meta），用于断言原因/IP/指纹与节流 */
function authFailRows() {
  return getLogs({ action: 'mcp_auth_fail', limit: 10_000 }).list
    .map(row => ({ ...row, meta: JSON.parse(row.meta) }))
}

function newAuthFailIds(rows) {
  const before = new Set(rows.map(r => r.id))
  return authFailRows().filter(r => !before.has(r.id))
}

async function connectClient(key) {
  const client = new Client({ name: 'mcp-integration', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  })
  clients.add(client)
  await client.connect(transport)
  return { client, transport }
}

async function closeClient(client) {
  await client.close()
  clients.delete(client)
}

test.before(async () => {
  const r = await panel('/login', {
    token: null, method: 'POST',
    body: JSON.stringify({ username: process.env.VCM_USERNAME, password: process.env.VCM_PASSWORD }),
  })
  assert.equal(r.status, 200)
  assert.ok(r.data.token)
  panelToken = r.data.token
})

test.after(async () => {
  try {
    await Promise.all([...clients].map(client => client.close()))
    await new Promise((resolve, reject) => srv.close(err => err ? reject(err) : resolve()))
  } finally {
    // Windows 必须先关闭 SQLite/WAL 句柄，清理失败让测试失败，不能静默吞掉。
    db.close()
    try {
      await fs.promises.rm(tmpData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      assert.equal(fs.existsSync(tmpData), false)
    } finally {
      for (const name of envNames) {
        if (previousEnv[name] === undefined) delete process.env[name]
        else process.env[name] = previousEnv[name]
      }
    }
  }
})

test('generateMcpKey：格式/哈希/掩码', () => {
  const { key, hash, mask } = generateMcpKey()
  assert.match(key, /^vcm_[0-9a-f]{64}$/)
  assert.equal(hash, hashMcpKey(key))
  assert.equal(mask, `${key.slice(0, 4)}…${key.slice(-4)}`)
  assert.deepEqual(MCP_SCOPES, ['read', 'full'])
})

test('encryptMcpKey/decryptMcpKey：可逆、密文随机、篡改与脏输入返回 null', () => {
  const { key } = generateMcpKey()
  const enc = encryptMcpKey(key)
  assert.match(enc, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(enc.includes(key), false)
  assert.equal(decryptMcpKey(enc), key)
  assert.notEqual(encryptMcpKey(key), enc, 'IV 随机：同一明文两次加密不得相同')
  const [prefix, iv, tag, ct] = enc.split('.')
  const flipped = Buffer.from(ct, 'base64url')
  flipped[0] ^= 0x01
  for (const bad of [null, undefined, '', 'garbage', `${prefix}.a.b`, [prefix, iv, tag, flipped.toString('base64url')].join('.'),
    [prefix, iv, Buffer.from('AAAA').toString('base64url'), ct].join('.')]) {
    assert.equal(decryptMcpKey(bad), null)
  }
})

test('主密钥文件：落在 DATA_DIR 下且为 32 字节', () => {
  const file = path.join(tmpData, 'mcp_key_vault.key')
  assert.equal(fs.statSync(file).size, 32)
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('truncateList：超限截断 + truncated 标记（AC-9）', () => {
  const list = Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ i }))
  const r = truncateList(list)
  assert.equal(r.truncated, true)
  assert.equal(r.total, LIST_LIMIT + 1)
  assert.equal(r.packages.length, LIST_LIMIT)
  assert.deepEqual(truncateList([1, 2]), { truncated: false, total: 2, packages: [1, 2] })
  assert.equal(truncateList(list.slice(0, LIST_LIMIT)).truncated, false)
})

test('管理接口：无登录 GET/POST/DELETE 均 401，其他路径不受影响', async () => {
  for (const [method, route] of [
    ['GET', '/mcp/keys'], ['POST', '/mcp/keys'], ['DELETE', '/mcp/keys/1'],
    ['POST', '/mcp/keys/1/reveal'], ['DELETE', '/mcp/keys/1/purge'],
  ]) {
    const r = await panel(route, { token: null, method })
    assert.equal(r.status, 401)
  }
  assert.equal((await panel('/public', { token: null })).status, 200)
})

test('Verdaccio Mate token 与 MCP Key 双向隔离', async () => {
  const key = await makeKey()
  const mcp = await rpc('tools/list', {}, panelToken)
  assert.equal(mcp.status, 401)
  assert.equal(mcp.data.error.code, -32001)
  assert.equal((await panel('/mcp/keys', { token: key })).status, 401)
  assert.equal((await panel('/panel-only', { token: key })).status, 401)
  assert.equal((await panel('/panel-only')).data.user, process.env.VCM_USERNAME)
})

test('未携带 Key：HTTP401 + challenge + -32001（AC-2），不回显凭据', async () => {
  resetMcpAuthFails()
  for (const key of [undefined, generateMcpKey().key, 'vcm_deadbeef']) {
    const r = await rpc('tools/list', {}, key)
    assert.equal(r.status, 401)
    assert.equal(r.data.error.code, -32001)
    assert.equal(r.headers.get('www-authenticate'), 'Bearer realm="mcp"')
    if (key) assert.equal(JSON.stringify(r.data).includes(key), false)
  }
})

test('认证失败逐原因写 mcp_auth_fail 审计：含来源 IP 与 Key 哈希前缀，不落明文与完整哈希', async () => {
  resetMcpAuthFails()
  const revokedKey = await makeKey('read', '审计用吊销')
  const row = (await panel('/mcp/keys')).data.keys.find(k => k.name === '审计用吊销')
  await panel(`/mcp/keys/${row.id}`, { method: 'DELETE' })
  const unknownKey = generateMcpKey().key
  const seen = authFailRows()
  await rpc('tools/list', {}, undefined)      // 完全没带 Authorization
  await rpc('tools/list', {}, unknownKey)     // 格式合法但不存在
  await rpc('tools/list', {}, 'vcm_deadbeef') // 格式不合法
  await rpc('tools/list', {}, revokedKey)     // 已吊销
  const rows = newAuthFailIds(seen).sort((a, b) => a.id - b.id)
  assert.deepEqual(rows.map(r => r.meta.reason), ['missing', 'unknown', 'malformed', 'revoked'])
  for (const r of rows) {
    assert.equal(r.result, 'fail')
    assert.ok(r.ip?.includes('127.0.0.1'), `审计必须带来源 IP，实际为 ${r.ip}`)
    assert.ok(r.message, '每条都要有可读的原因说明')
  }
  assert.equal(rows[1].meta.keyFingerprint, hashMcpKey(unknownKey).slice(0, 8), '格式合法的失败要给指纹')
  assert.ok(!('keyFingerprint' in rows[0].meta) && !('keyFingerprint' in rows[2].meta), '没带 Key / 格式不合法不该有指纹')
  const serialized = JSON.stringify(rows)
  assert.equal(serialized.includes(unknownKey), false, '审计不得含 Key 明文')
  assert.equal(serialized.includes(hashMcpKey(unknownKey)), false, '审计不得含完整哈希')
  assert.equal(serialized.includes(process.env.VCM_PASSWORD), false)
})

test('同一来源 IP 认证失败满 10 次：429/-32031 + Retry-After，锁定只拦失败请求且审计按分钟节流', async () => {
  resetMcpAuthFails()
  const goodKey = await makeKey('read', '锁定期间仍可用')
  for (let i = 0; i < 9; i++) {
    assert.equal((await rpc('tools/list', {}, 'vcm_deadbeef')).status, 401, `第 ${i + 1} 次失败应仍是 401`)
  }
  const trip = await rpc('tools/list', {}, 'vcm_deadbeef')
  assert.equal(trip.status, 429, '第 10 次失败应触发锁定')
  assert.equal(trip.data.error.code, -32031)
  assert.ok(Number(trip.headers.get('retry-after')) > 0, '锁定必须回 Retry-After')
  assert.equal((await rpc('tools/list', {}, 'vcm_deadbeef')).status, 429)
  assert.equal((await rpc('tools/list', {}, goodKey)).status, 200, '锁定只作用于认证失败，不能误伤共用出口 IP 的正常客户端')
  const lockedRows = authFailRows().filter(r => r.meta.reason === 'locked')
  assert.equal(lockedRows.length, 1, '锁定事件只记一条')
  const before = authFailRows().length
  for (let i = 0; i < 5; i++) assert.equal((await rpc('tools/list', {}, 'vcm_deadbeef')).status, 429)
  assert.equal(authFailRows().length, before, '锁定期内的重复失败不再逐条落审计')
  resetMcpAuthFails()
  assert.equal((await rpc('tools/list', {}, undefined)).status, 401, '锁定解除后恢复 401 语义')
  resetMcpAuthFails()
})

test('吊销后 Key 立即失效（AC-5），列表仅掩码，日志含名称/scope/id', async () => {
  resetMcpAuthFails()
  const key = await makeKey('read', '吊销测试')
  assert.ok((await rpc('tools/list', {}, key)).data.result.tools)
  const list = await panel('/mcp/keys', { headers: { Host: 'untrusted.example', 'X-Forwarded-Host': 'other.example' } })
  assert.equal(list.data.endpoint, '/mcp')
  const row = list.data.keys.find(k => k.name === '吊销测试')
  assert.equal(row.mask, maskMcpKey(key))
  assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'id', 'lastUsedAt', 'mask', 'name', 'revoked', 'scope'])
  assert.ok(row.lastUsedAt)
  assert.equal(JSON.stringify(list.data).includes(hashMcpKey(key)), false)
  assert.equal(JSON.stringify(list.data).includes(key), false)
  assert.equal((await panel(`/mcp/keys/${row.id}`, { method: 'DELETE' })).status, 200)
  const after = await rpc('tools/list', {}, key)
  assert.equal(after.status, 401)
  assert.equal(after.data.error.code, -32001)
  assert.equal((await panel(`/mcp/keys/${row.id}`, { method: 'DELETE' })).status, 404)
  const log = getLogs({ action: 'mcp_key' }).list.find(log => JSON.parse(log.meta).op === 'revoke')
  assert.deepEqual(JSON.parse(log.meta), { op: 'revoke', id: row.id, keyName: row.name, scope: row.scope, user: process.env.VCM_USERNAME })
})

test('回看明文：reveal 取回生成时的 Key，列表与密文都不泄露明文', async () => {
  const key = await makeKey('full', '回看测试')
  const row = getMcpKeyByHash(hashMcpKey(key))
  assert.equal(decryptMcpKey(getMcpKeyById(row.id).key_value_enc), key, '入库的必须是可解密的密文')
  const list = await panel('/mcp/keys')
  const item = list.data.keys.find(k => k.id === row.id)
  assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'id', 'lastUsedAt', 'mask', 'name', 'revoked', 'scope'])
  assert.equal(JSON.stringify(list.data).includes(key), false)
  const r = await panel(`/mcp/keys/${row.id}/reveal`, { method: 'POST' })
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.equal(r.data.key, key)
  const log = getLogs({ action: 'mcp_key', limit: 200 }).list
    .find(l => JSON.parse(l.meta).op === 'reveal' && JSON.parse(l.meta).id === row.id)
  assert.ok(log)
  assert.equal(JSON.stringify(log).includes(key), false, '审计不得记录明文')
  assert.equal(JSON.stringify(log).includes(row.key_hash), false)
})

test('回看边界：非法 id 400、不存在或已吊销 404、无密文的旧 Key 409', async () => {
  for (const bad of ['abc', '0', '-1', '1.5']) {
    assert.equal((await panel(`/mcp/keys/${bad}/reveal`, { method: 'POST' })).status, 400)
  }
  assert.equal((await panel('/mcp/keys/999999/reveal', { method: 'POST' })).status, 404)
  const key = await makeKey('read', '旧库 Key')
  const id = getMcpKeyByHash(hashMcpKey(key)).id
  db.prepare('UPDATE mcp_keys SET key_value_enc = NULL WHERE id = ?').run(id)
  const r = await panel(`/mcp/keys/${id}/reveal`, { method: 'POST' })
  assert.equal(r.status, 409)
  assert.match(r.data.message, /重新生成/)
  assert.equal((await rpc('tools/list', {}, key)).status, 200, '回看失败不影响 Key 本身可用')
})

test('删除已吊销记录：有效 Key 需先吊销，删除后密文与认证一并失效', async () => {
  const key = await makeKey('read', '待删除')
  const row = getMcpKeyByHash(hashMcpKey(key))
  assert.equal((await panel(`/mcp/keys/${row.id}/purge`, { method: 'DELETE' })).status, 409)
  assert.equal((await panel(`/mcp/keys/${row.id}`, { method: 'DELETE' })).status, 200)
  assert.equal(getMcpKeyById(row.id).key_value_enc, null, '吊销即抹掉密文')
  assert.equal((await panel(`/mcp/keys/${row.id}/reveal`, { method: 'POST' })).status, 404)
  assert.equal((await panel(`/mcp/keys/${row.id}/purge`, { method: 'DELETE' })).status, 200)
  assert.equal(getMcpKeyById(row.id), null)
  assert.equal((await panel(`/mcp/keys/${row.id}/purge`, { method: 'DELETE' })).status, 404)
  assert.equal((await panel('/mcp/keys')).data.keys.some(k => k.id === row.id), false)
  assert.equal((await rpc('tools/list', {}, key)).status, 401, '记录删除后该 Key 不再可认证')
})

test('initialize：返回协议版本与服务信息，无会话 ID（AC-1）', async () => {
  const key = await makeKey()
  const r = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' },
  }, key)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('mcp-session-id'), null)
  assert.equal(r.data.result.protocolVersion, '2025-06-18')
  assert.equal(r.data.result.serverInfo.name, 'verdaccio-cache-manager')
})

test('tools/list：两种 Key 都可见全部 8 个只读工具（AC-3：清单里没有任何写工具）', async () => {
  const allTools = ['get_package_detail', 'get_package_versions', 'get_scan_progress', 'get_scan_status',
    'get_storage_stats', 'list_packages', 'list_registry_users', 'top_packages']
  for (const scope of MCP_SCOPES) {
    const key = await makeKey(scope)
    const r = await rpc('tools/list', {}, key)
    assert.deepEqual(r.data.result.tools.map(t => t.name).sort(), allTools, `${scope} Key 的工具清单`)
    for (const tool of r.data.result.tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
    }
    assert.equal(auditRows(key).length, 0, '非 tools/call 不写调用审计')
  }
})

// 在 SDK 启动后台 GET 探测之前检查精确生命周期数量，避免计入其他 client 的探测。
test('成功请求也分别创建并关闭独立 McpServer', async t => {
  const original = McpServer.prototype.close
  const closed = new Set()
  t.mock.method(McpServer.prototype, 'close', function () {
    closed.add(this)
    return original.call(this)
  })
  const key = await makeKey()
  const results = await Promise.all([rpc('tools/list', {}, key), rpc('tools/list', {}, key)])
  assert.ok(results.every(r => r.status === 200))
  assert.equal(closed.size, 2)
})

test('真实 SDK Client：connect/list/call/close，可反复连接', async () => {
  const key = await makeKey()
  for (let i = 0; i < 2; i++) {
    const { client, transport } = await connectClient(key)
    try {
      assert.equal(transport.sessionId, undefined)
      assert.equal((await client.listTools()).tools.length, 8)
      const status = payload(await client.callTool({ name: 'get_scan_status', arguments: {} }))
      assert.equal(status.demo, true)
    } finally { await closeClient(client) }
  }
  assert.equal(auditRows(key).length, 2)
})

test('已连接 SDK client 的 Key 吊销后，下一次工具调用立即 HTTP401', async () => {
  const key = await makeKey()
  const { client } = await connectClient(key)
  try {
    payload(await client.callTool({ name: 'get_scan_status', arguments: {} }))
    const row = getMcpKeyByHash(hashMcpKey(key))
    assert.equal((await panel(`/mcp/keys/${row.id}`, { method: 'DELETE' })).status, 200)
    await assert.rejects(client.callTool({ name: 'get_scan_status', arguments: {} }), err => err.code === 401)
    assert.equal(auditRows(key).length, 1, '吊销后的请求不再属于已认证调用')
  } finally { await closeClient(client) }
})

test('并行不同 SDK client/key：请求和审计上下文隔离', async () => {
  const keys = await Promise.all([makeKey('read', '并行只读'), makeKey('full', '并行全量')])
  await Promise.all(keys.map(async (key, index) => {
    const { client } = await connectClient(key)
    try {
      await client.listTools()
      const name = index ? 'list_packages' : 'get_scan_progress'
      const results = await Promise.all(Array.from({ length: 8 }, () => client.callTool({ name, arguments: {} })))
      for (const result of results) {
        const data = payload(result)
        assert.equal(index ? Array.isArray(data.packages) : typeof data.bytes === 'number', true)
      }
    } finally { await closeClient(client) }
  }))
  for (const [index, key] of keys.entries()) {
    const logs = auditRows(key)
    assert.equal(logs.length, 8)
    for (const log of logs) {
      assert.equal(log.result, 'success')
      assert.equal(log.meta.keyName, index ? '并行全量' : '并行只读')
      assert.equal(log.meta.scope, index ? 'full' : 'read')
      assert.equal(log.meta.tool, index ? 'list_packages' : 'get_scan_progress')
      assert.equal(log.meta.truncated, false)
      assert.ok(log.duration_ms >= 0)
    }
  }
})

test('get_scan_status：返回状态快照（AC-7）', async () => {
  const key = await makeKey()
  const data = payload(await call('get_scan_status', {}, key))
  assert.equal(data.demo, true)
  assert.equal(data.scanning, false)
  assert.equal(data.firstScan, false)
  assert.equal(data.lastError, null)
  assert.equal(data.cooldownRemainingMs, 0)
})

test('get_scan_progress：返回进度快照', async () => {
  const data = payload(await call('get_scan_progress', {}, await makeKey()))
  assert.equal(typeof data.packages, 'number')
  assert.equal(typeof data.bytes, 'number')
  assert.equal(typeof data.firstScan, 'boolean')
})

test('list_packages：字段完整 + 关键词/状态筛选（AC-8/AC-9）', async () => {
  const key = await makeKey()
  const all = payload(await call('list_packages', {}, key))
  assert.equal(all.truncated, false)
  assert.ok(all.total > 0)
  assert.equal(all.sizeUnit, 'MB')
  assert.equal(all.firstScan, false)
  const first = all.packages[0]
  for (const field of ['name', 'versions', 'size', 'status', 'origin', 'latest']) assert.ok(field in first)
  const keyword = first.name.slice(0, 3).toUpperCase()
  const hit = payload(await call('list_packages', { keyword }, key))
  assert.ok(hit.total >= 1)
  for (const p of hit.packages) assert.ok(p.name.toLowerCase().includes(keyword.toLowerCase()))
  const filtered = payload(await call('list_packages', { status: 'ok' }, key))
  for (const p of filtered.packages) assert.equal(p.status, 'ok')
})

test('demo 来源过滤：private 为空，proxy 与 all 一致，组合关键词仍生效', async () => {
  const key = await makeKey()
  const all = payload(await call('list_packages', {}, key))
  const proxy = payload(await call('list_packages', { origin: 'proxy' }, key))
  const privateOnly = payload(await call('list_packages', { origin: 'private' }, key))
  assert.deepEqual(proxy.packages, all.packages)
  assert.ok(proxy.packages.every(p => p.origin === 'proxy'))
  assert.equal(privateOnly.total, 0)
  assert.deepEqual(privateOnly.packages, [])
  const combined = payload(await call('list_packages', { origin: 'private', keyword: all.packages[0].name }, key))
  assert.equal(combined.total, 0)
})

test('get_package_detail：包不存在返回 isError（AC-11），不回显误传凭据', async () => {
  const key = await makeKey()
  const result = await call('get_package_detail', { pkgName: key }, key)
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /不存在/)
  assert.equal(JSON.stringify(result).includes(key), false)
  const logs = auditRows(key)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].result, 'fail')
  assert.equal(JSON.stringify(logs).includes(key), false)
})

test('详情：演示版本明细/来源/MB 与列表一致，忽略状态一致', async () => {
  const key = await makeKey()
  const expected = demoPackages()[0]
  addIgnored(expected.name)
  try {
    const detail = payload(await call('get_package_detail', { pkgName: expected.name }, key))
    assert.equal(detail.name, expected.name)
    assert.deepEqual(detail.versionsDetail, expected.versionsDetail)
    assert.equal(detail.versions, expected.versions)
    assert.equal(detail.origin, expected.origin)
    assert.equal(detail.description, expected.description)
    assert.equal(detail.size, expected.size)
    assert.equal(detail.sizeUnit, 'MB')
    assert.equal(detail.scanning, false)
    assert.equal(detail.firstScan, false)
    assert.equal(detail.status, 'ignored')
    const list = payload(await call('list_packages', { status: 'ignored' }, key))
    assert.ok(list.packages.some(p => p.name === expected.name))
  } finally { removeIgnored(expected.name) }
})

test('schema 字符串上下界与严格类型，错误不含输入值', async () => {
  const key = await makeKey()
  const tools = (await rpc('tools/list', {}, key)).data.result.tools
  assert.equal(tools.find(t => t.name === 'list_packages').inputSchema.properties.keyword.maxLength, 214)
  assert.equal(tools.find(t => t.name === 'get_package_detail').inputSchema.properties.pkgName.maxLength, 214)
  for (const args of [{ keyword: '' }, { keyword: 'x'.repeat(214) }]) payload(await call('list_packages', args, key))
  const maxName = await call('get_package_detail', { pkgName: 'x'.repeat(214) }, key)
  assert.match(maxName.content[0].text, /不存在/)
  for (const [name, args] of [
    ['list_packages', { keyword: 'x'.repeat(215) }], ['list_packages', { keyword: 1 }],
    ['list_packages', { origin: key }], ['list_packages', { status: key }],
    ['get_package_detail', { pkgName: 'x'.repeat(215) }], ['get_package_detail', { pkgName: '' }],
    ['get_package_detail', { pkgName: '  ' }], ['get_package_detail', { pkgName: 1 }],
  ]) {
    const result = await call(name, args, key)
    assert.equal(result.isError, true)
    assert.equal(JSON.stringify(result).includes(key), false)
  }
})

test('SDK 未知工具/schema 校验失败恰好一次审计，误传凭据不入日志/响应', async () => {
  const key = await makeKey('read', '错误审计')
  const { client } = await connectClient(key)
  try {
    for (const params of [
      { name: 'unknown_tool', arguments: { token: key } },
      { name: key, arguments: {} },
      { name: 'list_packages', arguments: { [key]: key } },
      { name: 'get_package_detail', arguments: { pkgName: { token: key } } },
    ]) {
      const result = await client.callTool(params)
      assert.equal(result.isError, true)
      assert.equal(JSON.stringify(result).includes(key), false)
    }
  } finally { await closeClient(client) }
  const malformed = await rpc('tools/call', { arguments: { authorization: key } }, key)
  assert.ok(malformed.data.error || malformed.data.result?.isError)
  assert.equal(JSON.stringify(malformed.data).includes(key), false)
  const logs = auditRows(key)
  assert.equal(logs.length, 5)
  assert.equal(logs.filter(row => row.meta.tool === '<unknown>').length, 3)
  assert.ok(logs.every(row => row.result === 'fail' && row.meta.truncated === false))
  const serialized = JSON.stringify(logs)
  assert.equal(serialized.includes(key), false)
  assert.equal(serialized.includes(hashMcpKey(key)), false)
  assert.equal(serialized.includes('arguments'), false)
})

test('每 Key 30 次/分钟：HTTP429 + Retry-After + -32029，拒绝也只审计一次', async () => {
  const key = await makeKey('read', '限速测试')
  for (let i = 0; i < 30; i++) payload(await call('get_scan_progress', {}, key))
  const r = await rpc('tools/call', { name: 'get_scan_progress', arguments: {} }, key)
  assert.equal(r.status, 429)
  assert.equal(r.data.error.code, -32029)
  assert.ok(r.data.error.data.retryAfterMs > 0 && r.data.error.data.retryAfterMs <= 60_000)
  assert.equal(Number(r.headers.get('retry-after')), Math.ceil(r.data.error.data.retryAfterMs / 1000))
  const logs = auditRows(key)
  assert.equal(logs.length, 31)
  assert.equal(logs.filter(row => row.result === 'fail').length, 1)
  assert.equal((await rpc('tools/list', {}, await makeKey())).status, 200)
})

test('限速窗口到期后允许再次调用', async t => {
  const key = await makeKey()
  const start = Date.now()
  t.mock.method(Date, 'now', () => start)
  for (let i = 0; i < 30; i++) assert.equal((await rpc('tools/list', {}, key)).status, 200)
  assert.equal((await rpc('tools/list', {}, key)).status, 429)
  Date.now.mock.mockImplementation(() => start + 60_001)
  assert.equal((await rpc('tools/list', {}, key)).status, 200)
})

test('Origin：拒绝跨域/null/畸形/伪造 forwarded，同 Host 允许', async () => {
  const key = await makeKey()
  for (const origin of ['https://evil.example', 'null', 'not-a-url', `${base}/path`, `http://user@${new URL(base).host}`, base.replace('http:', 'https:')]) {
    const r = await rpc('tools/call', { name: 'get_scan_status', arguments: {} }, key, {
      Origin: origin, 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https',
    })
    assert.equal(r.status, 403)
  }
  assert.equal((await rpc('tools/list', {}, key, { Origin: base })).status, 200)
  assert.equal((await rpc('tools/list', {}, key)).status, 200)
  assert.equal(auditRows(key).length, 6)
})

test('Host 防 DNS rebinding：拒绝陌生域名，支持动态 LAN/IP/显式域名', async () => {
  const key = await makeKey()
  app.set('trust proxy', true)
  try {
    for (const host of ['evil.example', 'localhost.evil.example', 'localhost@evil.example', 'localhost/invalid']) {
      const r = await rpc('tools/list', {}, key, { Host: host, 'X-Forwarded-Host': 'localhost' })
      assert.equal(r.status, 403, `必须拒绝 Host ${host}`)
    }
    for (const host of ['192.168.37.88:4874', '10.21.45.9:8080', '[fd00::12]:4874', 'localhost:4874']) {
      assert.equal((await rpc('tools/list', {}, key, { Host: host })).status, 200)
    }
    process.env.MCP_ALLOWED_HOSTS = 'cache.example:4874'
    assert.equal((await rpc('tools/list', {}, key, { Host: 'cache.example:4874' })).status, 200)
    assert.equal((await rpc('tools/list', {}, key, { Host: 'cache.example:9999' })).status, 403)
    assert.equal((await rpc('tools/list', {}, key, {
      Host: 'cache.example:4874', Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example',
    })).status, 403)
  } finally {
    app.set('trust proxy', false)
    process.env.MCP_ALLOWED_HOSTS = ''
  }
})

test('SDK HTTP 错误/notification/批量拒绝均 no-store', async () => {
  const key = await makeKey()
  assert.equal((await rpc('tools/list', {}, key, { Accept: 'application/json' })).status, 406)
  const notification = await postRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, key)
  assert.equal(notification.status, 202)
  assert.equal(notification.data, null)
  const badVersion = await rpc('tools/call', { name: 'get_scan_status', arguments: {} }, key, { 'MCP-Protocol-Version': key })
  assert.equal(badVersion.status, 400)
  assert.equal(JSON.stringify(badVersion.data).includes(key), false)
  const batch = await postRpc([1, 2].map(id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_scan_status' } })), key)
  assert.equal(batch.status, 400)
  assert.equal(batch.data.error.code, -32600)
  assert.equal(auditRows(key).length, 3)
})

test('Express4 connect 异常返回安全 JSON500，finally 关闭 server 且审计一次', async t => {
  const key = await makeKey()
  t.mock.method(McpServer.prototype, 'connect', async () => { throw new Error(key) })
  const close = t.mock.method(McpServer.prototype, 'close')
  const r = await rpc('tools/call', { name: 'get_scan_status', arguments: {} }, key)
  assert.equal(r.status, 500)
  assert.equal(r.data.error.code, -32603)
  assert.equal(JSON.stringify(r.data).includes(key), false)
  assert.equal(close.mock.callCount(), 1)
  assert.equal(auditRows(key).length, 1)
  assert.equal(auditRows(key)[0].result, 'fail')
})

test('生成 Key：名称/权限严格类型与长度校验', async () => {
  for (const body of [
    {}, { name: '' }, { name: ' ' }, { name: 123 }, { name: [] }, { name: {} }, { name: true },
    { name: 'x'.repeat(41) }, { name: 'x', scope: 'admin' }, { name: 'x', scope: null },
    { name: 'x', scope: ['read'] }, { name: 'x', scope: 1 }, { name: 'x', scope: false },
  ]) {
    assert.equal((await panel('/mcp/keys', { method: 'POST', body: JSON.stringify(body) })).status, 400)
  }
  const r = await panel('/mcp/keys', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(40), scope: 'full' }) })
  assert.equal(r.status, 200)
  assert.match(r.data.key, /^vcm_/)
  const list = await panel('/mcp/keys')
  assert.equal(list.data.keys.find(row => row.id === r.data.id).scope, 'full')
  assert.equal(list.data.endpoint, '/mcp')
})

function useRealStorage(t) {
  const savedState = { ...scanState }
  const previousStorage = process.env.VERDACCIO_STORAGE
  const root = fs.mkdtempSync(path.join(tmpData, 'storage-'))
  process.env.VCM_DEMO = '0'
  process.env.VERDACCIO_STORAGE = root
  invalidateScan()
  t.after(() => {
    process.env.VCM_DEMO = '1'
    process.env.VERDACCIO_STORAGE = previousStorage
    Object.assign(scanState, savedState)
    invalidateScan()
  })
  assert.equal(isDemoMode(), false)
  return root
}

function writePackage(root, name, extra = {}) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name, versions: { '1.0.0': { description: 'fixture package' } },
    'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2025-01-01T00:00:00Z' }, ...extra,
  }))
  fs.writeFileSync(path.join(dir, '1.0.0.tgz'), Buffer.alloc(1024 * 1024))
}

test('真实扫描缓存：scoped 详情/MB/来源/列表正确，读取不触发扫描', async t => {
  const root = useRealStorage(t)
  writePackage(root, '@local/fixture')
  writePackage(root, 'upstream', { _uplinks: { npmjs: {} } })
  await runScanAsync()
  assert.equal(scanState.error, null)
  const startedAt = scanState.startedAt
  const key = await makeKey()
  const detail = payload(await call('get_package_detail', { pkgName: '@local/fixture' }, key))
  assert.equal(detail.name, '@local/fixture')
  assert.equal(detail.versions, 1)
  assert.equal(detail.latest, '1.0.0')
  assert.equal(detail.origin, 'private')
  assert.equal(detail.description, 'fixture package')
  assert.equal(Number(detail.size), 1)
  assert.equal(detail.sizeUnit, 'MB')
  assert.equal(detail.versionsDetail[0].version, '1.0.0')
  assert.equal(Number(detail.versionsDetail[0].size), 1)
  assert.equal(detail.versionsDetail[0].date, '2025-01-01')
  const list = payload(await call('list_packages', { origin: 'private' }, key))
  assert.deepEqual(list.packages.map(p => p.name), ['@local/fixture'])
  const status = payload(await call('get_scan_status', {}, key))
  assert.equal(status.demo, false)
  assert.equal(status.done, true)
  assert.equal(status.packages, 2)
  assert.equal(status.startedAt, startedAt)
  assert.equal(scanState.startedAt, startedAt)
})

test('真实 runScanAsync 失败/五分钟冷却与恢复，lastError 兼容 PRD', async t => {
  const root = useRealStorage(t)
  // 无权限改动：不可转换的时间元数据触发真实扫描异常路径。
  writePackage(root, 'bad-time', { time: { '1.0.0': { toString: null, valueOf: null } } })
  await runScanAsync()
  assert.ok(scanState.error)
  assert.ok(scanState.lastErrorAt)
  const startedAt = scanState.startedAt
  const key = await makeKey()
  const data = payload(await call('get_scan_status', {}, key))
  assert.equal(data.demo, false)
  assert.equal(data.scanning, false)
  assert.equal(data.lastError, scanState.error)
  assert.equal(data.error, data.lastError)
  assert.ok(data.cooldownRemainingMs > 0 && data.cooldownRemainingMs <= 300_000)
  ensureScan()
  assert.equal(scanState.scanning, false)
  assert.equal(scanState.startedAt, startedAt)
  writePackage(root, 'bad-time')
  invalidateScan()
  await runScanAsync()
  const recovered = payload(await call('get_scan_status', {}, key))
  assert.equal(recovered.lastError, null)
  assert.equal(recovered.lastErrorAt, null)
  assert.equal(recovered.cooldownRemainingMs, 0)
})

test('真实扫描进行中：状态/进度/列表/详情返回 firstScan 快照，不等待扫描', async t => {
  const root = useRealStorage(t)
  writePackage(root, 'snapshot')
  await runScanAsync()
  const readdir = fs.promises.readdir.bind(fs.promises)
  let release
  const gate = new Promise(resolve => { release = resolve })
  t.mock.method(fs.promises, 'readdir', async (dir, opts) => {
    if (dir === root) await gate
    return readdir(dir, opts)
  })
  scanState.startupScanning = true
  const scanning = runScanAsync()
  const key = await makeKey()
  try {
    for (const [name, args] of [
      ['get_scan_status', {}], ['get_scan_progress', {}], ['list_packages', {}], ['get_package_detail', { pkgName: 'snapshot' }],
    ]) {
      const data = payload(await call(name, args, key))
      assert.equal(data.scanning, true)
      assert.equal(data.firstScan, true)
    }
    assert.equal(scanState.scanning, true)
  } finally {
    release()
    await scanning
  }
  assert.equal(scanState.startupScanning, false)
})

test('真实缓存超 500 条：返回截断并在单条审计中记录 truncated', async t => {
  useRealStorage(t)
  await runScanAsync()
  const raw = getRawPackages()
  raw.push(...Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({
    name: `fixture-${i}`, versions: 1, size: '1.00', origin: 'private', status: 'ok',
  })))
  setSetting('version_threshold', '10')
  const key = await makeKey()
  const data = payload(await call('list_packages', {}, key))
  assert.equal(data.total, LIST_LIMIT + 1)
  assert.equal(data.packages.length, LIST_LIMIT)
  assert.equal(data.truncated, true)
  const logs = auditRows(key)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].meta.truncated, true)
  assert.equal(logs[0].result, 'success')
})

test('get_storage_stats：demo 口径的包数/版本数/占用/预警与列表一致', async () => {
  const key = await makeKey()
  const stats = payload(await call('get_storage_stats', {}, key))
  const list = payload(await call('list_packages', {}, key))
  assert.equal(stats.demo, true)
  assert.equal(stats.size.unit, 'MB')
  assert.ok(stats.versionThreshold >= 1)
  assert.equal(stats.warnings, list.packages.filter(p => p.status === 'warn').length, '预警数与列表同源')
  assert.equal(stats.packages.broken, 0)
  assert.equal(stats.packages.private, 0, '演示数据全部来自上游代理')
  assert.equal(stats.packages.total, stats.packages.proxy)
  assert.equal(stats.packages.total, list.total)
  assert.equal(stats.versions.total, list.packages.reduce((s, p) => s + p.versions, 0))
  assert.equal(stats.versions.total, stats.versions.proxy)
  assert.ok(stats.size.mb > 0)
  assert.equal(stats.size.bytes, 0, '演示模式不产生真实扫描字节数')
  assert.equal(stats.size.diskBytes, null)
  assert.equal(stats.size.diskMb, null, '磁盘占用未知时不能编造 MB 数字')
  assert.equal(stats.size.tgzMb, 0)
  assert.ok(stats.warnings >= 0 && stats.size.cleanableMb >= 0 && stats.size.cleanableMb <= stats.size.mb)
})

test('get_storage_stats / top_packages：真实模式下私有与代理分开计数', async t => {
  const root = useRealStorage(t)
  writePackage(root, '@local/fixture')
  writePackage(root, 'upstream', { _uplinks: { npmjs: {} } })
  await runScanAsync()
  const key = await makeKey()
  const stats = payload(await call('get_storage_stats', {}, key))
  assert.deepEqual(stats.packages, { total: 2, private: 1, proxy: 1, broken: 0 })
  assert.equal(stats.demo, false)
  assert.ok(stats.size.diskBytes > 0)
  assert.equal(stats.size.diskMb, Math.round(stats.size.diskBytes / 1024 / 1024 * 10) / 10, 'diskMb 必须是 diskBytes 的 MB 换算')
  assert.equal(stats.size.tgzMb, Math.round(stats.size.tgzBytes / 1024 / 1024 * 10) / 10)
  assert.ok(stats.size.note.includes('diskBytes'), '占用口径说明必须点名真实磁盘字段')
  const top = payload(await call('top_packages', {}, key))
  assert.deepEqual(top.packages.map(p => p.name), ['@local/fixture', 'upstream'])
  assert.deepEqual(Object.keys(top.packages[0]).sort(), ['name', 'origin', 'rank', 'size', 'status', 'versions', 'visits'])
  assert.equal(top.total, 2)
  assert.equal(top.truncated, false)
})

test('top_packages：默认 20 条、按占用降序，limit/sortBy 参数生效并带截断标记', async () => {
  const key = await makeKey()
  const all = payload(await call('get_storage_stats', {}, key))
  const top = payload(await call('top_packages', {}, key))
  assert.equal(top.sortBy, 'size')
  assert.equal(top.packages.length, 20)
  assert.equal(top.total, all.packages.total)
  assert.equal(top.truncated, top.total > 20)
  assert.deepEqual(top.packages.map(p => p.rank), Array.from({ length: 20 }, (_, i) => i + 1))
  const sizes = top.packages.map(p => p.size)
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a))
  const visits = payload(await call('top_packages', { limit: 3, sortBy: 'visits' }, key))
  assert.equal(visits.packages.length, 3)
  const visitCounts = visits.packages.map(p => p.visits)
  assert.deepEqual(visitCounts, [...visitCounts].sort((a, b) => b - a))
  for (const args of [{ limit: 0 }, { limit: 101 }, { sortBy: 'name' }, { extra: 1 }]) {
    const r = await call('top_packages', args, key)
    assert.equal(r.isError, true, `非法参数 ${JSON.stringify(args)} 应被 schema 拒绝`)
  }
})

test('get_package_versions：demo 无元数据时依赖为 null 并给出说明', async () => {
  const key = await makeKey()
  const list = payload(await call('list_packages', {}, key))
  const name = list.packages[0].name
  const data = payload(await call('get_package_versions', { pkgName: name }, key))
  assert.equal(data.demo, true)
  assert.equal(data.name, name)
  assert.match(data.note, /演示模式/)
  assert.equal(data.truncated, false)
  assert.ok(data.versions.length > 0)
  assert.equal(data.versions[0].dependencies, null)
  assert.equal(data.versions[0].devDependencies, null)
  assert.equal(data.versions[0].cached, true)
})

test('get_package_versions：真实元数据逐版本返回依赖，非字符串依赖值被丢弃', async t => {
  const root = useRealStorage(t)
  writePackage(root, '@local/deps', {
    'dist-tags': { latest: '2.0.0' },
    versions: {
      '1.0.0': { description: 'd', dependencies: { 'left-pad': '^1.0.0' }, devDependencies: { jest: '^29.0.0' } },
      '1.1.0': { dependencies: { ms: '2.1.3', bad: { nested: true } }, devDependencies: 'not-an-object' },
      '2.0.0': { dependencies: {} },
    },
    time: { '1.0.0': '2025-01-01T00:00:00Z', '1.1.0': '2025-02-01T00:00:00Z', '2.0.0': '2025-03-01T00:00:00Z' },
  })
  await runScanAsync()
  const key = await makeKey()
  const data = payload(await call('get_package_versions', { pkgName: '@local/deps' }, key))
  assert.equal(data.origin, 'private')
  assert.equal(data.latest, '2.0.0')
  assert.equal(data.total, 3)
  assert.deepEqual(data.versions.map(v => v.version), ['1.0.0', '1.1.0', '2.0.0'])
  const [first, second, third] = data.versions
  assert.deepEqual(first.dependencies, { 'left-pad': '^1.0.0' })
  assert.deepEqual(first.devDependencies, { jest: '^29.0.0' })
  assert.equal(first.cached, true, '有实体 .tgz 的版本才计 cached')
  assert.equal(Number(first.size), 1)
  assert.equal(first.date, '2025-01-01')
  assert.deepEqual(second.dependencies, { ms: '2.1.3' }, '非字符串范围值不进入响应')
  assert.equal(second.devDependencies, null)
  assert.equal(second.cached, false)
  assert.equal(second.size, null)
  assert.equal(second.date, '2025-02-01', '缺实体文件时日期回退元数据 time')
  assert.deepEqual(third.dependencies, {})
  assert.equal(third.depsTruncated, false)
})

test('get_package_versions：limit 截断保留最新、version 精确匹配、依赖条数上限、错误不回显输入', async t => {
  const root = useRealStorage(t)
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`d${i}`, '^1.0.0']))
  writePackage(root, 'huge-deps', { versions: { '1.0.0': { dependencies: many } }, time: { '1.0.0': '2025-01-01T00:00:00Z' } })
  writePackage(root, 'multi', {
    versions: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`1.${i}.0`, { dependencies: { a: '^1' } }])),
    time: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`1.${i}.0`, `2025-0${i + 1}-01T00:00:00Z`])),
  })
  await runScanAsync()
  const key = await makeKey()
  const huge = payload(await call('get_package_versions', { pkgName: 'huge-deps' }, key))
  assert.equal(Object.keys(huge.versions[0].dependencies).length, 200)
  assert.equal(huge.versions[0].depsTruncated, true)
  const limited = payload(await call('get_package_versions', { pkgName: 'multi', limit: 2 }, key))
  assert.deepEqual(limited.versions.map(v => v.version), ['1.3.0', '1.4.0'], '截断保留最新的 N 个')
  assert.equal(limited.truncated, true)
  assert.equal(limited.total, 5)
  const one = payload(await call('get_package_versions', { pkgName: 'multi', version: '1.2.0' }, key))
  assert.deepEqual(one.versions.map(v => v.version), ['1.2.0'])
  assert.equal(one.total, 5)
  for (const [args, message] of [
    [{ pkgName: 'nope' }, '包不存在'],
    [{ pkgName: '../../../etc/passwd' }, '包不存在'],
    [{ pkgName: 'multi', version: '9.9.9' }, '版本不存在'],
  ]) {
    const r = await call('get_package_versions', args, key)
    assert.equal(r.isError, true)
    assert.equal(r.content[0].text, message)
  }
})

test('list_registry_users：两种 Key 都可见可调，响应不含哈希与文件路径', async () => {
  fs.writeFileSync(process.env.VERDACCIO_HTPASSWD,
    'alice:$2b$08$abcdefghijklmnopabcdefghijklmnop:autocreated 2026-01-02T03:04:05.678Z\nbob:$2y$05$xyzxyz\n')
  for (const scope of MCP_SCOPES) {
    const key = await makeKey(scope, `${scope} 用户名单`)
    assert.equal((await rpc('tools/list', {}, key)).data.result.tools.some(t => t.name === 'list_registry_users'), true,
      `${scope} Key 的清单里必须有用户名单工具`)
    const data = payload(await call('list_registry_users', {}, key))
    assert.equal(data.available, true)
    assert.deepEqual(data.users, [
      { name: 'alice', createdAt: '2026-01-02T03:04:05.678Z' },
      { name: 'bob', createdAt: null },
    ])
    assert.equal(data.total, 2)
    const serialized = JSON.stringify(data)
    for (const secret of ['$2b$', '$2y$', 'autocreated', process.env.VERDACCIO_HTPASSWD]) {
      assert.equal(serialized.includes(secret), false, `响应不得含 ${secret}`)
    }
  }
})

test('scope 裁剪机制保留：本期虽无 full 专属工具，full-only 工具仍对 read Key 隐藏并拒绝', async () => {
  assert.equal(visibleTools('read').length, 8, '本期 8 个工具对 read Key 全可见')
  const probe = 'probe_full_only_tool'
  MCP_TOOLS[probe] = { scope: 'full', description: '测试探针' }
  try {
    assert.equal(visibleTools('read').includes(probe), false)
    assert.equal(visibleTools('full').includes(probe), true, '探针没被当成写工具就说明裁剪失效了')
    const key = await makeKey('read', '权限探针')
    const denied = await rpc('tools/call', { name: probe, arguments: {} }, key)
    assert.equal(denied.status, 403)
    assert.equal(denied.data.error.code, -32030)
    assert.match(denied.data.error.message, /权限不足/)
    const rows = auditRows(key)
    assert.equal(rows.length, 1, '越权调用只审计一次')
    assert.equal(rows[0].result, 'fail')
    assert.equal(rows[0].meta.tool, probe)
  } finally { delete MCP_TOOLS[probe] }
})

test('所有 MCP 审计（含鉴权失败）无 Key/hash/Verdaccio Mate token/测试密码，仅持久化必要字段', () => {
  const serialized = JSON.stringify([
    getLogs({ action: 'mcp_call', limit: 10_000 }).list,
    getLogs({ action: 'mcp_auth_fail', limit: 10_000 }).list,
  ])
  const keys = db.prepare('SELECT key_hash FROM mcp_keys').all()
  for (const row of keys) assert.equal(serialized.includes(row.key_hash), false)
  assert.equal(serialized.includes(panelToken), false)
  assert.equal(serialized.includes(process.env.VCM_PASSWORD), false)
  assert.doesNotMatch(serialized, /vcm_[0-9a-f]{64}/)
  assert.doesNotMatch(serialized, /\b[0-9a-f]{64}\b/, 'Key 指纹只能是哈希前缀，不能落完整哈希')
})
