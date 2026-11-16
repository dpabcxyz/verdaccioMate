/**
 * Express 统一错误处理 / 404 / 忙态拒绝中间件 —— 抽离自 server.js
 * Express4 仅自动捕获「同步 throw」并交给错误中间件；此处确保任何未捕获错误
 * 都返回统一 JSON 而非默认 HTML 500，避免前端 JSON 解析失败。
 * （所有异步路由业务均在内部自带 try/catch，故无需 async 包装器。）
 */
import { scanState } from './scan-manager.js'

/** /api 路径未匹配任何路由 → JSON 404（Express 默认对非 GET 返回 HTML） */
export function apiNotFound(req, res) {
  res.status(404).json({ ok: false, message: 'not found' })
}

/**
 * 扫描进行中拒绝再次发起扫描（目前只挂 POST /api/scan）：
 * 两个 runScanAsync 并发会互相覆写 scanState 与 rawCache，进度与完成时间都不可信，
 * 因此这是「重入保护」而不是「写操作保护」——删除/清理/目录切换在扫描期间照常放行
 * （失效标记由 scan-manager.js 的世代比对保住，见其注释）。
 * 统一 200 + `code: 'SCANNING'`（不是 4xx）：忙态是「稍后再试」，请求本身没写错，
 * 前端 store/scan.js 的 scanNow 按 code 识别后静默转入轮询，与「服务器出错」区分开。
 */
export function rejectWhileScanning(req, res, next) {
  if (scanState.scanning) {
    return res.json({ ok: false, code: 'SCANNING', message: '扫描进行中，请稍后重试', scanning: true })
  }
  next()
}

// Express 错误中间件需 4 参签名（next 必须保留，即便未直接使用）
export function errorHandler(err, req, res, next) {
  console.error('[api] 未捕获错误:', err)
  if (res.headersSent) return next(err)
  // err.expose（如 body-parser 400）时透出具体消息，其余统一脱敏
  const message = err.expose ? err.message : '服务器内部错误'
  res.status(err.statusCode || 500).json({ ok: false, message })
}