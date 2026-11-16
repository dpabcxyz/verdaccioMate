/**
 * MCP Key 管理 API（Verdaccio Mate 设置页）—— server.js 抽离
 * - GET  /api/mcp/keys          列表（含端点地址；掩码展示，不含明文）
 * - POST /api/mcp/keys          生成 Key（明文以 AES-256-GCM 密文入库）
 * - POST /api/mcp/keys/:id/reveal 回看明文（供「复制配置」；需登录，逐次审计）
 * - DELETE /api/mcp/keys/:id    吊销（即时生效，不可恢复，同时抹掉密文）
 */
import express from 'express'
import { z } from 'zod'
import { addLog, deleteMcpKey, getMcpKeyById, insertMcpKey, listMcpKeys, revokeMcpKey } from '../db.js'
import { decryptMcpKey, encryptMcpKey, generateMcpKey, MCP_SCOPES } from '../mcp/keys.js'
import { authMiddleware } from './auth.js'
import { apiValidate, zId } from '../validate.js'

export const mcpRouter = express.Router()

const zKeyBody = z.object({
  name: z.string({ error: '请填写 Key 名称' }).trim().min(1, '请填写 Key 名称').max(40, 'Key 名称最长 40 字符'),
  scope: z.enum(MCP_SCOPES, { error: '权限级别不合法' }).default('read'),
})
const zIdParam = z.object({ id: zId })

function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

// 路由独立挂载也必须鉴权；不对其他 /api 路径增加登录要求。
mcpRouter.use('/mcp/keys', noStore, authMiddleware)

mcpRouter.get('/mcp/keys', (req, res) => {
  const keys = listMcpKeys().map(k => ({
    id: k.id,
    name: k.name,
    mask: k.key_mask,
    scope: k.scope,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revoked: !!k.revoked_at,
  }))
  res.json({ ok: true, endpoint: '/mcp', keys })
})

mcpRouter.post('/mcp/keys', apiValidate({ body: zKeyBody }), (req, res) => {
  const { name, scope } = req.body
  const { key, hash, mask } = generateMcpKey()
  const id = insertMcpKey({ name, keyHash: hash, keyMask: mask, keyValueEnc: encryptMcpKey(key), scope })
  addLog({
    action: 'mcp_key', result: 'success', message: `生成 MCP Key「${name}」`,
    meta: { op: 'create', id, keyName: name, scope, user: req.user },
  })
  res.json({ ok: true, id, key })
})

/** 回看明文：密文在主密钥文件缺失/轮换/早于本功能时不可解，统一提示重新生成，不区分原因以免泄露存储细节 */
mcpRouter.post('/mcp/keys/:id/reveal', apiValidate({ params: zIdParam }), (req, res) => {
  const id = req.params.id
  const key = getMcpKeyById(id)
  if (!key || key.revoked_at) return res.status(404).json({ ok: false, message: 'Key 不存在或已吊销' })
  const plain = decryptMcpKey(key.key_value_enc)
  if (!plain) {
    addLog({
      action: 'mcp_key', result: 'fail', message: `回看 MCP Key「${key.name}」#${id} 失败：明文不可恢复`,
      meta: { op: 'reveal', id, keyName: key.name, scope: key.scope, reason: 'unrecoverable', user: req.user },
    })
    return res.status(409).json({ ok: false, message: '该 Key 无法恢复明文（早于回看功能创建），请重新生成后更新客户端配置' })
  }
  addLog({
    action: 'mcp_key', result: 'success', message: `回看 MCP Key「${key.name}」#${id}`,
    meta: { op: 'reveal', id, keyName: key.name, scope: key.scope, user: req.user },
  })
  res.json({ ok: true, key: plain })
})

mcpRouter.delete('/mcp/keys/:id', apiValidate({ params: zIdParam }), (req, res) => {
  const id = req.params.id
  const key = getMcpKeyById(id)
  if (!key || key.revoked_at || !revokeMcpKey(id)) return res.status(404).json({ ok: false, message: 'Key 不存在或已吊销' })
  addLog({
    action: 'mcp_key', result: 'success', message: `吊销 MCP Key「${key.name}」#${id}`,
    meta: { op: 'revoke', id, keyName: key.name, scope: key.scope, user: req.user },
  })
  res.json({ ok: true })
})

// 彻底删除已吊销记录：有效 Key 必须先吊销，避免误删还能用的凭据
mcpRouter.delete('/mcp/keys/:id/purge', apiValidate({ params: zIdParam }), (req, res) => {
  const id = req.params.id
  const key = getMcpKeyById(id)
  if (!key) return res.status(404).json({ ok: false, message: 'Key 不存在' })
  if (!key.revoked_at) return res.status(409).json({ ok: false, message: '请先吊销该 Key' })
  deleteMcpKey(id)
  addLog({
    action: 'mcp_key', result: 'success', message: `删除已吊销 MCP Key「${key.name}」#${id}`,
    meta: { op: 'purge', id, keyName: key.name, scope: key.scope, user: req.user },
  })
  res.json({ ok: true })
})

mcpRouter.use('/mcp/keys', (err, req, res, next) => {
  if (res.headersSent) return next(err)
  res.setHeader('Cache-Control', 'no-store')
  res.status(500).json({ ok: false, message: 'MCP Key 管理暂时不可用' })
})
