/**
 * 出站 JSON 请求 —— 全仓唯一的 GET JSON 实现（此前 sync-latest / npm-toplist / services/location 各写一份，
 * 退避策略与错误文案三处漂移）
 *
 * 语义约定（调用方据此判读，不再各写各的）：
 * - 404 → null：业务上的「不存在」，不是错误
 * - 429 / 5xx → 指数退避重试（2^n 秒，最高 256s）；`maxBackoff: 0` 表示不重试（best-effort 调用用）
 * - 其余非 2xx / 响应体解析失败 → 抛 `${label}响应 …` / `${label}响应体解析失败`
 * - 传输层失败 → 抛 `${label}连接失败：…`，与「服务端明确回了个错误码」区分开：
 *   后者说明链路是通的，把文案写成连接失败会把排障带到网络方向
 *
 * label 由调用方给出（私服 / 接口 / 定位接口），运维在失败列表里看文案就能定位是哪一端。
 * sleepFn / maxBackoff 供测试注入，生产调用只传 url + timeout（+ label）。
 */
export const RATE_LIMIT_BACKOFF_MAX = 8 // 429/5xx 退避最大重试指数（2^8=256s）

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function fetchJson(url, timeout, { sleepFn = sleep, maxBackoff = RATE_LIMIT_BACKOFF_MAX, label = '接口' } = {}) {
  let attempt = 0
  for (;;) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    let r
    try {
      r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('请求超时')
      const cause = e && e.cause
      // Node 原生 fetch 失败 message 固定为 "fetch failed"，真实 errno 在 e.cause.reason
      throw new Error(`${label}连接失败：${(e && e.code) || (e && e.message) || 'fetch failed'}${cause && cause.reason ? `（${cause.reason}）` : ''}`)
    } finally {
      clearTimeout(timer)
    }
    if (r.status === 404) return null
    if (r.status === 429 || r.status >= 500) {
      attempt += 1
      if (attempt > maxBackoff) {
        throw new Error(maxBackoff > 0 ? `${label}响应 ${r.status}（已重试 ${attempt - 1} 次）` : `${label}响应 ${r.status}`)
      }
      const waitMs = Math.min(256, 2 ** attempt) * 1000
      console.warn(`[net] ${label} ${r.status}，退避 ${waitMs / 1000}s 后重试（第 ${attempt} 次）`)
      await sleepFn(waitMs)
      continue
    }
    if (!r.ok) throw new Error(`${label}响应 ${r.status}`)
    try {
      return await r.json()
    } catch {
      throw new Error(`${label}响应体解析失败`)
    }
  }
}
