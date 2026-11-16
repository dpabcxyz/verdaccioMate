/**
 * 前端数据契约（JSDoc 类型定义）—— 与后端 REST API 返回结构对齐
 * 仅类型无运行时代码；api/modules 各方法通过 @returns {Promise<import('../types.js').Xxx>} 引用。
 * 后续迁移 .ts 时可将本文件转为 src/types.ts，@typedef 结构原样保留。
 */

/** 包状态：预警 / 正常 / 已忽略 / 异常（元数据损坏） @typedef {'warn'|'ok'|'ignored'|'broken'} PkgStatus */

/** 单版本明细 @typedef {{version: string, size: number, date: string|null}} VersionDetail */

/**
 * 包信息（GET /api/packages 列表项 / GET /api/packages/:name 详情）
 * 后端扫描器返回完整字段（见 backend/scanner.js）；mock/精简场景允许缺省可选字段
 * @typedef {{
 *   name: string,
 *   versions: number,
 *   size: number,
 *   status: PkgStatus,
 *   lastUpdated?: string|null,
 *   versionsDetail: VersionDetail[],
 *   origin?: 'private'|'proxy'|null,
 *   latest?: string|null,
 *   readme?: string|null,
 *   description?: string|null,
 *   homepage?: string|null,
 *   repository?: string|null,
 *   author?: string|null,
 *   license?: string|null,
 *   ignoredAt?: string,
 *   visits?: number,
 *   distTags?: Record<string, string>,
 * }} PackageInfo
 */

/** GET /api/packages @typedef {{packages: PackageInfo[], scannedAt: string|null, scanning: boolean, firstScan?: boolean, scanPackages?: number, scanBytes?: number, totalBytes?: number|null}} PackagesResponse */

/** 概览统计 @typedef {{pkgCount: number, totalSize: number, warnCount: number, cleanable: number}} Summary */

/** 清理/删除响应（POST /api/clean、DELETE /api/packages/:name/versions/:version） @typedef {{ok: boolean, pkgName?: string, deletedVersions?: string, deletedCount?: number, freedSpace?: string, freedBytes?: number, message?: string, code?: ApiErrorCode}} CleanResult */

/** 响应错误码：INVALID_PARAM（入参契约层）、SCANNING（重扫重入）、UPSTREAM_UNAVAILABLE（原版 Verdaccio 不可达） @typedef {'INVALID_PARAM'|'SCANNING'|'UPSTREAM_UNAVAILABLE'|string} ApiErrorCode */

/** 通用布尔响应 @typedef {{ok: boolean, message?: string, code?: ApiErrorCode}} ApiBoolResult */

/** 忽略包名单（GET /api/ignored） @typedef {string[]} IgnoredList */

/** 单包详情响应（GET /api/packages/:name；缓存失效时为 ok:false + pkg:null） @typedef {{ok: boolean, pkg: PackageInfo|null}} PackageDetailResult */

/** 手动重扫触发结果（POST /api/scan；扫描忙时 ok:false + code SCANNING，HTTP 仍 200） @typedef {{ok: boolean, demo?: boolean, scanning?: boolean, scannedAt?: string, startedAt?: string|null, packages?: number, bytes?: number, code?: ApiErrorCode, message?: string}} ScanTriggerResult */

/** 一键拉最新版触发结果（POST /api/sync/latest） @typedef {{ok: boolean, demo?: boolean, running?: boolean, total?: number, startedAt?: string|null, message?: string}} SyncTriggerResult */

/** 榜单条目（DB 列名 + 后端 compareWithCache 补的驼峰兼容字段与缓存比对结果） @typedef {{id: number, rank: number, pkg_name: string, latest_version: string, weekly_downloads: number, search_weekly?: number, keyword?: string|null, fetched_at?: string|null, name: string, latestVersion: string, weeklyDownload: number, cached: boolean, latestCached: boolean, cachedVersions: string[]}} TopListEntry */

/** 榜单概览 @typedef {{total: number, cached: number, latestCached: number, missing: number, outdated: number}} TopListSummary */

/** 抓榜/拉取状态机（后端 toplistState 原样透出） @typedef {{running: boolean, done: boolean, phase: 'idle'|'search'|'recheck'|'compare'|'done', total: number, processed: number, success: number, skipped: number, failed: number, failedList: Array<{name?: string, pkgName?: string, reason?: string}>, current: string|null, error: string|null, startedAt: string|null, finishedAt: string|null, pullRunning: boolean, pullTotal: number, pullProcessed: number, pullSuccess: number, pullSkipped: number, pullFailed: number, pullFailedList: Array<{name?: string, pkgName?: string, reason?: string}>, pullCurrent: string|null, pullStartedAt: string|null, pullFinishedAt: string|null}} TopListState */

/** GET /api/toplist @typedef {{list: TopListEntry[], summary: TopListSummary, state: TopListState, lastRun: string|null, nextRun: string|null, scanning?: boolean}} TopListResult */

/** 用户名同步结果（POST /api/htpasswd/sync） @typedef {{ok: boolean, added?: boolean, name?: string, message: string, syncedAt?: string}} HtpasswdSyncResult */

/** 单包例外阈值 @typedef {{pkgName: string, versionThreshold: number, sizeThreshold: number}} PackageException */

/** 阈值配置（GET/POST /api/thresholds） @typedef {{versionThreshold: number, sizeThreshold: number, exceptions: PackageException[]}} ThresholdsConfig */

/** 操作日志条目（GET /api/logs，后端列名蛇形已在前端归一为驼峰） @typedef {{id: number, action: string, pkgName?: string|null, version?: string|null, result?: string|null, message?: string|null, batchId?: string|null, ip?: string|null, meta?: string|null, deletedVersions?: string|null, deletedCount?: number|null, freedSpace?: string|null, created_at?: string}} LogEntry */

/** 操作日志响应 @typedef {{list: LogEntry[], total: number, page?: number, pageSize?: number, counts?: Record<string, number>}} LogsResponse */

/** 消息通知条目（后端 notifications 行，meta 已 JSON.parse） @typedef {{id: number, type: string, title: string, body?: string|null, level?: 'info'|'warn'|'error'|string, related_action_id?: number|null, batch_id?: string|null, meta?: Record<string, any>|null, read_at?: string|null, created_at?: string}} NotificationItem */

/** 消息通知响应（GET /api/notifications） @typedef {{list: NotificationItem[], unreadCount: number, lastId?: number}} NotificationsResponse */

/** 扫描进度（GET /api/scan/progress：口径与拉取进度不同，按 scanning/包数/字节数计） @typedef {{scanning: boolean, done: boolean, packages?: number, bytes?: number, tgzBytes?: number, diskBytes?: number|null, error?: string|null, startedAt?: string|null, finishedAt?: string|null}} ScanProgress */

/** 扫描/拉取异步任务进度（/api/sync/progress、/api/toplist/pull/progress） @typedef {{running: boolean, done?: boolean, total: number, processed?: number, success?: number, skipped?: number, failed?: number, failedList?: Array<{ name: string, reason: string }>, current?: string|null, error?: string|null, startedAt?: string|null, finishedAt?: string|null, packages?: number, bytes?: number}} ProgressState */

/** htpasswd 用户（GET /api/htpasswd/users） @typedef {{name: string, algo: string, meta: string}} HtpasswdUser */

/** htpasswd 用户列表响应 @typedef {{ok: boolean, enabled?: boolean, file?: string, builtin?: string, users?: HtpasswdUser[], message?: string, code?: ApiErrorCode}} HtpasswdUsersResult */

/** MCP API Key 记录（明文仅在创建响应中出现一次，列表只有掩码） @typedef {{id: number, name: string, scope: 'read'|'full', mask: string, createdAt: string, lastUsedAt: string|null, revoked: boolean}} McpKeyRecord */

/** MCP Key 列表/操作响应 @typedef {{ok: boolean, endpoint?: string, keys?: McpKeyRecord[], id?: number, key?: string, message?: string, code?: ApiErrorCode}} McpKeysResult */

/** 抓榜触发结果（POST /api/toplist/fetch） @typedef {{ok: boolean, running?: boolean, phase?: TopListState['phase'], startedAt: string|null, message?: string, code?: ApiErrorCode}} TopListFetchResult */

/** 登录响应（POST /api/login） @typedef {{ok: boolean, token?: string, user?: {name: string, email?: string}, message?: string}} LoginResult */
// 仅类型的模块也需要显式导出，import('../types.js').Xxx 才能解析
export {}