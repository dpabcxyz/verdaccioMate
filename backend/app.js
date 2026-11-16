/**
 * Express app 装配 —— 与 server.js（listen 接线）分离：
 * app 以独立模块导出后，接线冒烟测试可直接以受控端口驱动（无需真启动生产服务）
 * 环境变量：VERDACCIO_STORAGE / VCM_USERNAME / VCM_PASSWORD 等，见 README
 */
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { authRouter, authMiddleware } from './routes/auth.js'
import { thresholdsRouter } from './routes/thresholds.js'
import { ignoredRouter } from './routes/ignored.js'
import { packagesRouter } from './routes/packages.js'
import { syncRouter } from './routes/sync.js'
import { toplistRouter } from './routes/toplist.js'
import { cleanRouter } from './routes/clean.js'
import { logsRouter } from './routes/logs.js'
import { mcpRouter } from './routes/mcp.js'
import { mcpRequestHandler } from './mcp/index.js'
import { themeRouter } from './routes/theme.js'
import { verdaccioRouter } from './routes/verdaccio.js'
import { apiNotFound, errorHandler } from './http.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '1mb' }))

// gzip 压缩：大响应（如 /api/packages 7000+ 条）减少传输体积 60-80%，Node 内置 zlib 无需新依赖
app.use((req, res, next) => {
  const accept = req.headers['accept-encoding'] || ''
  if (!accept.includes('gzip')) return next()
  const originalJson = res.json.bind(res)
  res.json = (data) => {
    try {
      const json = JSON.stringify(data)
      if (json.length < 1024) return originalJson(data) // 小响应不压缩，避免开销
      const compressed = zlib.gzipSync(json)
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Content-Type', 'application/json')
      res.send(compressed)
    } catch {
      originalJson(data)
    }
  }
  next()
})

// —— 路由装配：登录/登出/主题公开，其余 /api/* 需鉴权 ——
app.use('/api', themeRouter) // 公开：登录页加载时也需要主题
app.use('/api', authRouter)
app.use('/api', authMiddleware)
app.use('/api', verdaccioRouter) // 原版 Verdaccio Web API 透传（读取类；Verdaccio Mate 侧需登录）
app.use('/api', thresholdsRouter)
app.use('/api', ignoredRouter)
app.use('/api', packagesRouter)
app.use('/api', syncRouter)
app.use('/api', toplistRouter)
app.use('/api', cleanRouter)
app.use('/api', logsRouter)
app.use('/api', mcpRouter)
// —— /api 未匹配任何路由 → JSON 404（Express 默认对非 GET 返回 HTML） ——
app.use('/api', apiNotFound)

// —— MCP Streamable HTTP 端点（无状态 JSON 模式）：独立于 /api 鉴权，Bearer MCP Key 认证 ——
app.post('/mcp', mcpRequestHandler)
app.all('/mcp', (req, res) => {
  res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: '仅支持 POST' } })
})

// —— 生产：托管前端 dist ——
const distDir = path.join(__dirname, '..', 'frontend', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, message: 'not found' })
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// —— 统一错误处理：Express4 同步 throw 会跳到这里，返回 JSON 而非 HTML 500 ——
app.use(errorHandler)

export { app }
export default app