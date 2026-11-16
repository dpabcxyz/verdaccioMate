/**
 * HTTP 基础设施 —— 会话令牌管理与统一请求封装
 * 开发期默认走真实接口（VITE_USE_MOCK=true 时切 mock 数据）
 */
import { storage } from '../utils/storage.js'

// —— 登录会话：token 存 localStorage（记住我）或 sessionStorage（关浏览器失效） ——
export const TOKEN_KEY = 'vcm-token'
export const USER_KEY = 'vcm-user'
// 请求超时（毫秒）：后端异常/网络阻塞时避免请求永久挂起
export const FETCH_TIMEOUT = 15000

export function getToken() {
  return storage.get(TOKEN_KEY) || storage.getSession(TOKEN_KEY) || ''
}

/** 统一请求封装：自动附带 Bearer token；401 时清除会话并跳转登录页；超时/网络错误统一抛可读错误 */
export async function authFetch(url, options = {}) {
  const token = getToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  let r
  try {
    r = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时，请检查网络或稍后重试', { cause: e })
    // 这里只可能捕获 fetch 自身失败（断网/DNS/代理不可达），统一成中文可读提示，
    // 不把 Chromium 的 "Failed to fetch" 透到 Verdaccio Mate 上
    throw new Error('网络请求失败，请检查网络或后端是否可用', { cause: e })
  } finally {
    clearTimeout(timer)
  }
  if (r.status === 401) {
    clearSession()
    if (!location.pathname.startsWith('/login')) location.href = '/login'
    throw new Error('未登录或会话已失效')
  }
  return r
}

/** 清除本地会话（token + 用户信息） */
export function clearSession() {
  storage.remove(TOKEN_KEY)
  storage.removeSession(TOKEN_KEY)
  storage.remove(USER_KEY)
}