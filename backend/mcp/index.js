/** MCP Streamable HTTP：每请求 server/transport、独立 Bearer 认证、限速与请求级审计。 */
import { isIP } from 'node:net'
import { hostname } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { addLog, getMcpKeyByHash, touchMcpKeyUsed } from '../db.js'
import { hashMcpKey } from './keys.js'
import { registerMcpTools, MCP_TOOLS } from './tools.js'

const RATE_LIMIT = { max: 30, windowMs: 60_000 }
// 认证失败按来源 IP 限速：Key 是 256 位随机值、猜不出来，这一层的目的是止住公网爆破的审计噪声与成本。
const AUTH_FAIL_LIMIT = { max: 10, windowMs: 60_000, lockMs: 5 * 60_000 }
const rateHits = new Map()
const authFails = new Map() // ip -> { hits: [ts], lockedUntil, lastAuditAt }
setInterval(() => {
  const now = Date.now()
  for (const [id, hits] of rateHits) {
    const live = hits.filter(t => now - t < RATE_LIMIT.windowMs)
    if (live.length) rateHits.set(id, live)
    else rateHits.delete(id)
  }
  for (const [ip, rec] of authFails) {
    rec.hits = rec.hits.filter(t => now - t < AUTH_FAIL_LIMIT.windowMs)
    if (!rec.hits.length && (!rec.lockedUntil || rec.lockedUntil < now)) authFails.delete(ip)
  }
}, RATE_LIMIT.windowMs).unref()

/** 测试用：清空按 IP 的认证失败计数，避免用例之间互相触发锁定 */
export function resetMcpAuthFails() {
  authFails.clear()
}

function clientIp(req) {
  // 只取 socket 地址：Express 未设 trust proxy，X-Forwarded-For 可伪造，限速会打到无辜 IP。
  return req.socket.remoteAddress || 'unknown'
}

function jsonRpcError(res, id, status, code, message, data) {
  return res.status(status).json({
    jsonrpc: '2.0', id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  })
}

const AUTH_FAIL_LABEL = {
  missing: '未携带 Key',
  malformed: 'Key 格式不合法',
  unknown: 'Key 不存在',
  revoked: 'Key 已吊销',
  locked: '来源 IP 认证失败过多，已锁定',
}

/** 认证失败审计：只记原因、来源 IP 与 Key 哈希前 8 位（用于归并同一把坏 Key 的尝试），永不记明文。 */
function auditAuthFail(ip, reason, keyHash) {
  try {
    addLog({
      action: 'mcp_auth_fail', result: 'fail', message: AUTH_FAIL_LABEL[reason], ip,
      meta: { reason, ...(keyHash ? { keyFingerprint: keyHash.slice(0, 8) } : {}) },
    })
  } catch { console.error('[mcp] 写入鉴权失败审计失败') }
}

/**
 * 记一次认证失败：写审计 + 滑动窗口计数，窗口内满 AUTH_FAIL_LIMIT.max 次即锁定该来源 IP。
 * 锁定期内不再逐条写审计（公网扫描器会把日志刷爆），改为每分钟最多补一条。
 */
function onAuthFailure(ip, reason, keyHash) {
  const now = Date.now()
  const rec = authFails.get(ip) || { hits: [], lockedUntil: null, lastAuditAt: 0 }
  if (rec.lockedUntil && now < rec.lockedUntil) {
    if (now - rec.lastAuditAt >= AUTH_FAIL_LIMIT.windowMs) {
      rec.lastAuditAt = now
      auditAuthFail(ip, 'locked', keyHash)
    }
    authFails.set(ip, rec)
    return { retryAfterMs: rec.lockedUntil - now }
  }
  rec.lockedUntil = null // 锁定期已过，重新计窗
  rec.hits = rec.hits.filter(t => now - t < AUTH_FAIL_LIMIT.windowMs)
  rec.hits.push(now)
  auditAuthFail(ip, reason, keyHash)
  if (rec.hits.length >= AUTH_FAIL_LIMIT.max) {
    rec.lockedUntil = now + AUTH_FAIL_LIMIT.lockMs
    rec.lastAuditAt = now
    console.warn(`[mcp] IP ${ip} ${AUTH_FAIL_LIMIT.windowMs / 1000}s 内认证失败 ${rec.hits.length} 次，锁定 ${AUTH_FAIL_LIMIT.lockMs / 60000} 分钟`)
    auditAuthFail(ip, 'locked')
  }
  authFails.set(ip, rec)
  return rec.lockedUntil ? { retryAfterMs: rec.lockedUntil - now } : {}
}

function requestHostAllowed(req) {
  // 只读取原始 Host；Express 的 req.host/hostname/protocol 可能受 trust proxy 影响。
  const host = req.headers.host
  if (typeof host !== 'string' || !host || /[\s/@\\?#,]/.test(host)) return false
  let url
  try { url = new URL(`http://${host}`) } catch { return false }
  const name = url.hostname.toLowerCase()
  // 字面 IP 不存在 DNS rebinding，允许动态 LAN/NAT 地址，不能默认锁死 localhost。
  // 域名部署可用 MCP_ALLOWED_HOSTS 逗号分隔的精确 Host（含端口）或 hostname；不支持通配符。
  const allowed = (process.env.MCP_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!isIP(name.replace(/^\[|\]$/g, '')) && name !== 'localhost' && name !== hostname().toLowerCase()
      && !allowed.includes(host.toLowerCase()) && !allowed.includes(name)) return false
  if (req.headers.origin !== undefined) {
    try {
      const origin = new URL(req.headers.origin)
      if (origin.protocol !== (req.socket.encrypted ? 'https:' : 'http:') || origin.origin !== req.headers.origin
          || origin.host.toLowerCase() !== url.host.toLowerCase()) return false
    } catch { return false }
  }
  return true
}

export async function mcpRequestHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const body = req.body
  const id = typeof body?.id === 'string' || Number.isFinite(body?.id) ? body.id : null
  const startedAt = Date.now()
  let server
  let key
  let calls = []
  try {
    const ip = clientIp(req)
    const auth = req.headers.authorization || ''
    // 格式隔离 Verdaccio Mate 会话 token；永不记录/回显 Authorization 或客户端原始参数。
    const shaped = /^Bearer vcm_[0-9a-f]{64}$/.test(auth)
    const keyHash = shaped ? hashMcpKey(auth.slice(7)) : null
    key = shaped ? getMcpKeyByHash(keyHash) : null
    if (!key || key.revoked_at) {
      const reason = !auth ? 'missing' : !shaped ? 'malformed' : key ? 'revoked' : 'unknown'
      key = null
      const { retryAfterMs } = onAuthFailure(ip, reason, keyHash)
      res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"')
      if (retryAfterMs !== undefined) {
        res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
        return jsonRpcError(res, id, 429, -32031, '认证失败次数过多，来源 IP 已临时锁定', { retryAfterMs })
      }
      return jsonRpcError(res, id, 401, -32001, '认证失败：MCP Key 无效、缺失或已吊销')
    }
    calls = (Array.isArray(body) ? body : [body])
      .filter(call => call?.method === 'tools/call')
      .map(call => ({
        // 未知名称也可能误传凭据，只记录固定标记，不持久化不受信任的名称。
        tool: typeof call.params?.name === 'string' && Object.hasOwn(MCP_TOOLS, call.params.name)
          ? call.params.name : '<unknown>',
        ok: false, truncated: false,
      }))
    if (!requestHostAllowed(req)) {
      return jsonRpcError(res, id, 403, -32000, 'Host 或 Origin 不受信任')
    }
    const now = Date.now()
    const hits = (rateHits.get(key.id) || []).filter(t => now - t < RATE_LIMIT.windowMs)
    if (hits.length >= RATE_LIMIT.max) {
      const retryAfterMs = RATE_LIMIT.windowMs - (now - hits[0])
      res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return jsonRpcError(res, id, 429, -32029, '请求过于频繁：每分钟最多 30 次', { retryAfterMs })
    }
    hits.push(now)
    rateHits.set(key.id, hits)
    touchMcpKeyUsed(key.id)
    // 一期只接受单条消息，避免批量请求绕过每 Key 限速及重复 ID 歧义。
    if (Array.isArray(body)) return jsonRpcError(res, null, 400, -32600, '不支持批量请求')
    const version = req.headers['mcp-protocol-version']
    if (version !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      return jsonRpcError(res, id, 400, -32000, '不支持的 MCP 协议版本')
    }
    // full 专属工具（如用户名单）对只读 Key 明确拒绝，而不是伪装成「工具不存在」
    if (body?.method === 'tools/call') {
      const tool = calls[0]?.tool
      if (tool && tool !== '<unknown>' && MCP_TOOLS[tool].scope === 'full' && key.scope !== 'full') {
        return jsonRpcError(res, id, 403, -32030, '权限不足：该工具需要全量（full）Key')
      }
    }

    server = new McpServer({ name: 'verdaccio-cache-manager', version: '1.0.0' })
    registerMcpTools(server, key.scope)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const send = transport.send.bind(transport)
    transport.send = async (message, options) => {
      // SDK 协议/schema 错误可能包含输入字段名，所有协议错误均不回显原始输入。
      if (message.error) message = { ...message, error: { code: message.error.code, message: '请求不合法' } }
      if (calls.length && message.id === id && ('result' in message || 'error' in message)) {
        const call = calls[0]
        call.ok = !!message.result && !message.result.isError
        call.truncated = message.result?.structuredContent?.truncated === true
        if (message.result?.isError) {
          const safeMessages = ['包不存在', '版本不存在', '元数据不可读', '工具执行失败']
          const original = message.result.content?.[0]?.text
          message = { ...message, result: {
            isError: true,
            content: [{ type: 'text', text: safeMessages.includes(original) ? original : '工具名或参数不合法' }],
          } }
        }
      }
      return send(message, options)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch {
    // Express 4 不会自动接住 async rejection；错误内容不能泄漏凭据/内部路径。
    for (const call of calls) call.ok = false
    if (!res.headersSent) jsonRpcError(res, id, 500, -32603, 'MCP 服务暂时不可用')
    else if (!res.writableEnded) res.destroy()
  } finally {
    if (server) {
      try { await server.close() } catch { console.error('[mcp] 关闭请求服务失败') }
    }
    // 包括未知工具、schema 错误、HTTP 拒绝，每个已认证 tools/call 恰好一条。
    for (const call of calls) {
      try {
        addLog({
          action: 'mcp_call', result: call.ok && res.statusCode < 400 ? 'success' : 'fail',
          message: call.tool, durationMs: Math.max(0, Date.now() - startedAt),
          meta: { tool: call.tool, keyId: key.id, keyName: key.name, scope: key.scope, truncated: call.truncated },
        })
      } catch { console.error('[mcp] 写入调用审计失败') }
    }
  }
}
