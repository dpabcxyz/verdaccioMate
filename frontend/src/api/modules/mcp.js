/**
 * MCP 接入 API —— API Key 管理（设置抽屉）
 */
import { authFetch } from '../http.js'
import { USE_MOCK, mockState, mockMcpKeyValues, delay, clone } from '../mock.js'

export default {
  /**
   * Key 列表（仅掩码，不含明文）
   * @returns {Promise<import('../../types.js').McpKeysResult>}
   */
  async getMcpKeys() {
    if (USE_MOCK) { await delay(80); return { ok: true, endpoint: '/mcp', keys: clone(mockState.mcpKeys) } }
    const r = await authFetch('/api/mcp/keys')
    return r.json()
  },
  /**
   * 生成 Key：明文只在本次响应里出现一次，库里存 AES-256-GCM 密文
   * @returns {Promise<import('../../types.js').McpKeysResult>}
   */
  async createMcpKey(name, scope) {
    if (USE_MOCK) {
      await delay(120)
      if (!name.trim() || name.length > 40 || !['read', 'full'].includes(scope)) return { ok: false, message: '名称或权限不合法' }
      const key = `vcm_mock_${crypto.randomUUID()}`
      const id = Date.now()
      mockState.mcpKeys.unshift({ id, name, scope, mask: `vcm_…${key.slice(-4)}`, createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false })
      mockMcpKeyValues.set(id, key)
      return { ok: true, id, key }
    }
    const r = await authFetch('/api/mcp/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope }),
    })
    return r.json()
  },
  /**
   * 吊销 Key：下一次请求即失效，同时抹掉密文
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async revokeMcpKey(id) {
    if (USE_MOCK) {
      await delay(80)
      const key = mockState.mcpKeys.find(row => row.id === id && !row.revoked)
      if (!key) return { ok: false, message: 'Key 不存在或已吊销' }
      key.revoked = true
      mockMcpKeyValues.delete(id)
      return { ok: true }
    }
    const r = await authFetch(`/api/mcp/keys/${id}`, { method: 'DELETE' })
    return r.json()
  },
  /**
   * 回看明文（供「复制配置」）；早于回看功能创建的旧 Key 取不回
   * @returns {Promise<import('../../types.js').McpKeysResult>}
   */
  async revealMcpKey(id) {
    if (USE_MOCK) {
      await delay(80)
      const key = mockState.mcpKeys.find(row => row.id === id)
      if (!key || key.revoked) return { ok: false, message: 'Key 不存在或已吊销' }
      const plain = mockMcpKeyValues.get(id)
      return plain ? { ok: true, key: plain } : { ok: false, message: '该 Key 无法恢复明文，请重新生成' }
    }
    const r = await authFetch(`/api/mcp/keys/${id}/reveal`, { method: 'POST' })
    return r.json()
  },
  /**
   * 彻底删除已吊销记录（有效 Key 必须先吊销）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async purgeMcpKey(id) {
    if (USE_MOCK) {
      await delay(80)
      const index = mockState.mcpKeys.findIndex(row => row.id === id)
      if (index < 0) return { ok: false, message: 'Key 不存在' }
      if (!mockState.mcpKeys[index].revoked) return { ok: false, message: '请先吊销该 Key' }
      mockState.mcpKeys.splice(index, 1)
      return { ok: true }
    }
    const r = await authFetch(`/api/mcp/keys/${id}/purge`, { method: 'DELETE' })
    return r.json()
  },
}
