/**
 * 全局数据状态（模块级 reactive 单例，多页面共享）
 * - packages：包列表（已排序：预警置顶 → 正常 → 忽略）
 * - threshold：全局阈值 + 单包例外
 * - logs：操作日志
 */
import { reactive } from 'vue'
import { storage } from '../utils/storage'

export const state = reactive({
  packages: [],
  threshold: { versionThreshold: 15, sizeThreshold: 500, exceptions: [] },
  logs: [],
  logTotal: 0,
  logPage: 1,
  logPageSize: 50,
  // 各动作日志计数（GET /api/logs 的 counts 汇总，日志页筛选徽标用；null 表示未加载）
  logCounts: null,
  // 首次部署扫描遮罩：仅「部署后启动扫描，且从未成功扫描过」时为 true，控制全屏毛玻璃遮罩。
  // 手动/定时/失效重建等扫描一律后台静默，不置此位。
  scanMask: false,
  // 后台扫描状态：删除/清理后触发后台扫描时为 true，用于显示"正在后台扫描"提示
  scanning: false,
  scannedAt: null,
  storageDir: storage.get('vcm-storage-dir') || '',
  // 后端目录扫描总字节（所有文件，与 du 同口径；null 表示未知/演示模式）
  totalBytes: null,
  // 扫描进度（异步扫描期间实时更新，用于遮罩展示）
  scanProgress: { packages: 0, bytes: 0 },
  // 拉取进度（一键拉取存量包最新版本期间实时更新）
  syncProgress: {
    running: false, done: false, total: 0, processed: 0,
    success: 0, skipped: 0, failed: 0, failedList: [], error: null,
    current: null,
  },
  // Top1000 榜单数据与进度
  toplist: [],
  toplistSummary: { total: 0, cached: 0, latestCached: 0, missing: 0, outdated: 0 },
  toplistProgress: {
    running: false, done: false, phase: 'idle', total: 0, processed: 0,
    success: 0, skipped: 0, failed: 0, failedList: [], error: null,
  },
  toplistPullProgress: {
    running: false, done: false, total: 0, processed: 0,
    success: 0, skipped: 0, failed: 0, failedList: [], error: null,
    current: null,
  },
  toplistNextRun: null,
  toplistLastRun: null,
  // 消息通知
  notifications: [],   // 最近 50 条（下拉展示用）
  unreadCount: 0,
  lastNotifId: 0,      // 轮询游标（仅取 id > lastNotifId 的新通知）
})