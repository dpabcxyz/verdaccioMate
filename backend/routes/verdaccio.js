/**
 * 原版 Verdaccio Web API 代理（原版 Verdaccio 界面读取能力）—— P1
 * - GET /api/verdaccio/* → {VERDACCIO_BASE_URL}/-/verdaccio/* 透传
 * - 读取类端点（sidebar / manifest / search / data/packages 等）上游公开，无需 npm token；
 *   Verdaccio Mate 侧仍由全局 authMiddleware 保护（挂载在其后）
 * - 5s 超时降级：上游不可达返回 502 JSON，前端据此展示降级提示，不挂死
 */
import express from 'express'

export const verdaccioRouter = express.Router()

function upstream() {
  return (process.env.VERDACCIO_BASE_URL || 'http://127.0.0.1:4873').replace(/\/+$/, '')
}

verdaccioRouter.get('/verdaccio/*', async (req, res) => {
  const sub = req.params[0] || ''
  const url = new URL(`/-/verdaccio/${sub}`, `${upstream()}/`)
  const q = req.originalUrl.indexOf('?') // query 不经过通配匹配，需手动拼回
  if (q >= 0) url.search = req.originalUrl.slice(q)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const up = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'verdaccio-cache-manager/1.0' },
    })
    const body = await up.text()
    res.status(up.status)
    const ct = up.headers.get('content-type')
    if (ct) res.set('content-type', ct)
    res.send(body)
  } catch (e) {
    const cause = e.name === 'AbortError'
      ? '上游超时（5s）'
      : (e.cause && (e.cause.code || e.cause.message)) || e.message
    res.status(502).json({
      ok: false,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `无法连接 原版 Verdaccio（${upstream()}）：${cause}`,
    })
  } finally {
    clearTimeout(timer)
  }
})
