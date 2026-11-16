/**
 * 认证 API —— 登录 / 退出
 */
import { storage } from '../../utils/storage.js'
import { authFetch, TOKEN_KEY, USER_KEY, clearSession } from '../http.js'
import { USE_MOCK, delay } from '../mock.js'

export default {
  /**
   * 登录：校验后端 Verdaccio Mate 内置账号（Docker 部署由 VCM_USERNAME/VCM_PASSWORD 决定）；remember 决定 token 存 localStorage 还是 sessionStorage
   * @returns {Promise<import('../../types.js').LoginResult>}
   */
  async login(username, password, remember = true) {
    if (USE_MOCK) {
      await delay(400)
      if (username !== 'admin' || password !== '666666') return { ok: false, message: '用户名或密码错误' }
      const token = `mock-${Date.now()}`
      if (remember) storage.set(TOKEN_KEY, token)
      else storage.setSession(TOKEN_KEY, token)
      storage.set(USER_KEY, JSON.stringify({ name: username, email: `${username}@verdaccio.local` }))
      return { ok: true, user: { name: username } }
    }
    // 登录接口公开：错误密码的 401 是业务响应，不能用 authFetch（会误判为会话失效并抛异常）
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.ok) return { ok: false, message: data.message || '登录失败' }
    if (remember) storage.set(TOKEN_KEY, data.token)
    else storage.setSession(TOKEN_KEY, data.token)
    storage.set(USER_KEY, JSON.stringify({ name: data.user?.name || username }))
    return { ok: true, user: data.user }
  },

  /**
   * 退出登录：通知后端销毁会话并清除本地 token（后端失败不影响本地登出）
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      if (!USE_MOCK) await authFetch('/api/logout', { method: 'POST' })
    } catch { /* 忽略网络错误，本地清除即可 */ }
    clearSession()
  },
}
