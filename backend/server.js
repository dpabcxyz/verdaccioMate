/**
 * 原版 Verdaccio 缓存可视化管理工具 — 后端服务入口
 * Express + better-sqlite3，§4.2 REST API
 *
 * 环境变量：
 *   VERDACCIO_STORAGE   原版 Verdaccio 缓存目录（优先于 UI 设置）
 *   PORT                监听端口（默认 3000）
 *   DATA_DIR            SQLite 数据目录（默认 backend/data）
 *   VCM_USERNAME        Verdaccio Mate 登录账号（默认 admin）
 *   VCM_PASSWORD        Verdaccio Mate 登录密码（默认 666666，Docker 部署务必通过 compose 覆盖）
 *   UV_THREADPOOL_SIZE  libuv IO 线程池大小（默认 4 → 8：扫描/stat/readFile 并发更高，NAS 四核安全）
 *
 * 模块划分：
 *   - scan-manager.js  扫描状态机与业务编排（缓存/进度/状态构建）
 *   - schedules.js     每日扫描 + 每周抓榜定时任务
 *   - routes/*         REST 路由（按领域拆分）
 */
// 必须在 libuv 线程池首次使用前设置：扫描大量目录/文件时默认 4 线程是主要瓶颈
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '8'

// —— 全局异常兜底 ——
// Express 4 不会自动捕获 async 路由 handler 的 rejection，漏包时 Node ≥15 默认直接崩溃退出。
// unhandledRejection：记日志不退出（单个任务失败不应拖垮整个 Verdaccio Mate）；
// uncaughtException：运行时一致性已破坏，记日志后受控退出，交给容器/进程管理器重启。
process.on('unhandledRejection', (reason) => {
  console.error('[global] unhandledRejection:', reason instanceof Error ? reason.stack : reason)
  try {
    addLog({ action: 'unhandled_rejection', result: 'fail', message: String(reason instanceof Error ? reason.stack : reason).slice(0, 500) })
  } catch { /* 审计失败不再抛出，避免兜底链二次异常 */ }
})
process.on('uncaughtException', (err) => {
  console.error('[global] uncaughtException，进程即将退出:', err.stack || err)
  try {
    addLog({ action: 'uncaught_exception', result: 'fail', message: String(err.stack || err).slice(0, 500) })
  } catch { /* 退出前尽力审计，失败不阻断退出 */ }
  process.exit(1)
})

// Express app 装配已抽离至 app.js：接线冒烟测试可绕过 listen 以受控端口直接驱动
import { app } from './app.js'
import { resolveStorageDir } from './scanner.js'
import { isDemoMode, scanState, runScanAsync } from './scan-manager.js'
import { scheduleDailyScan, scheduleWeeklyTopList } from './schedules.js'
import { addLog } from './db.js'

const PORT = Number(process.env.PORT || 3000)

app.listen(PORT, () => {
  const storage = resolveStorageDir()
  const mode = isDemoMode() ? 'demo' : 'storage'
  if (!process.env.VCM_PASSWORD) {
    console.warn(
      '[auth] ⚠ 未设置 VCM_PASSWORD 环境变量，正在使用默认口令 666666。' +
      '生产部署请务必通过 docker-compose 的环境变量覆盖，否则 Verdaccio Mate 可被任意登录！',
    )
  }
  console.log(`[verdaccio-manager] listening on :${PORT} (mode=${mode})`)
  if (mode === 'storage') console.log(`[verdaccio-manager] storage: ${storage}`)
  else console.log('[verdaccio-manager] 未配置 VERDACCIO_STORAGE，运行于演示模式（设置 VCM_DEMO=0 + 真实目录可关闭）')
  // 启动即扫描：容器部署后无需打开前端即可预置缓存（demo 模式跳过；
  // 启动时 rawCache 恒为 null，直接触发即可，无需 invalidateScan）
  if (mode === 'storage' && !scanState.scanning) {
    scanState._triggerSource = 'startup'
    scanState.startupScanning = true // 部署后启动扫描：供前端显示首次扫描遮罩，扫描结束即清零
    runScanAsync()
    console.log(`[auto-scan] 启动后立即扫描缓存目录：${storage}`)
  }
  scheduleDailyScan()
  scheduleWeeklyTopList()
})