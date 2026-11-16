/**
 * 安全 localStorage/sessionStorage 封装
 * 隐私模式 / 禁用存储 / 配额满等场景下 storage 读写会抛异常，
 * 统一兜底为「读不到→默认值、写不进→静默忽略」，避免整页崩溃。
 */

function safeGet(storage, key) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value)
  } catch {
    /* 存储不可用/配额满：静默跳过 */
  }
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key)
  } catch {
    /* 忽略 */
  }
}

/** 读取并安全 JSON 解析；解析失败返回 fallback */
export function storageGetJSON(storage, key, fallback = null) {
  const raw = safeGet(storage, key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export const storage = {
  get: (key) => safeGet(localStorage, key),
  set: (key, value) => safeSet(localStorage, key, value),
  remove: (key) => safeRemove(localStorage, key),
  getJSON: (key, fallback = null) => storageGetJSON(localStorage, key, fallback),
  getSession: (key) => safeGet(sessionStorage, key),
  setSession: (key, value) => safeSet(sessionStorage, key, value),
  removeSession: (key) => safeRemove(sessionStorage, key),
  getSessionJSON: (key, fallback = null) => storageGetJSON(sessionStorage, key, fallback),
}