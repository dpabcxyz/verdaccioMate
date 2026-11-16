/**
 * 用户管理 API —— 原版 Verdaccio 用户（htpasswd 读写：列表 + 新增/同步/改密/删除）
 */
import { authFetch } from '../http.js'
import { USE_MOCK, delay } from '../mock.js'

export default {
  /**
   * htpasswd 用户名单（不含密码与哈希）
   * @returns {Promise<import('../../types.js').HtpasswdUsersResult>}
   */
  async getHtpasswdUsers() {
    if (USE_MOCK) {
      await delay(150)
      return { ok: true, enabled: true, users: [
        { name: 'chenxuan', algo: '2a', meta: 'autocreated 2025-03-25T17:21:18.172Z' },
        { name: 'p6006197', algo: '2a', meta: 'autocreated 2025-03-25T17:22:03.723Z' },
        { name: 'admin', algo: '2a', meta: 'autocreated 2025-06-10T01:42:16.732Z' },
      ] }
    }
    const r = await authFetch('/api/htpasswd/users')
    return r.json()
  },
  /**
   * 新增 原版 Verdaccio 用户（写 htpasswd，私服侧立即可登录）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async addHtpasswdUser(name, password) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: `已新增用户 ${name}` } }
    const r = await authFetch('/api/htpasswd/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })
    return r.json()
  },
  /**
   * 用户名并集拉平：把 Verdaccio Mate 内置账号补写进 htpasswd
   * @returns {Promise<import('../../types.js').HtpasswdSyncResult>}
   */
  async syncHtpasswdUsers() {
    if (USE_MOCK) { await delay(200); return { ok: true, added: false, name: 'admin', message: 'htpasswd 已存在同名用户，同步跳过（不覆盖其密码）' } }
    const r = await authFetch('/api/htpasswd/sync', { method: 'POST' })
    return r.json()
  },
  /**
   * 重置用户密码（仅重写该行 bcrypt 哈希，保留 meta）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async resetHtpasswdPassword(name, password) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: `已重置 ${name} 的密码` } }
    const r = await authFetch(`/api/htpasswd/users/${encodeURIComponent(name)}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    return r.json()
  },
  /**
   * 删除用户（当前登录的 Verdaccio Mate 账号不可删，防自锁）
   * @returns {Promise<import('../../types.js').ApiBoolResult>}
   */
  async removeHtpasswdUser(name) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: `已删除用户 ${name}` } }
    const r = await authFetch(`/api/htpasswd/users/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return r.json()
  },
}
