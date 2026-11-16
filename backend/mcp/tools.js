/**
 * MCP 工具定义与注册（只读查询；read Key 与 full Key 可见集合按 MCP_TOOLS.scope 区分）
 * - 审计在请求层，覆盖 SDK 的工具名/schema 校验失败
 * - 口径与 Verdaccio Mate 一致：排序/状态计算/检索规则复用 scan-manager 与既有路由逻辑
 */
import { z } from 'zod'
import { getSetting, getIgnoredRows } from '../db.js'
import { readHtpasswd } from '../htpasswd.js'
import {
  buildPackages, getRawPackages, scanState, getScannedAt, isDemoMode,
} from '../scan-manager.js'
import { demoPackages, parseVersion, readPackageManifest, shDate } from '../scanner.js'
import { DEFAULT_VERSION_THRESHOLD } from '../util.js'

// 工具 → 所需权限级别（scope: 'read' 对所有 Key 开放；'full' 仅全量 Key 可见可调用）
export const MCP_TOOLS = {
  get_scan_status: { scope: 'read', description: '查询缓存扫描状态：是否扫描中、起止时间、包总数、总占用与最近错误' },
  get_scan_progress: { scope: 'read', description: '查询扫描实时进度：已扫包数与字节数' },
  list_packages: { scope: 'read', description: '检索缓存包清单：按名称关键词、来源、状态筛选；返回名称、版本数、占用、最近更新与状态' },
  get_package_detail: { scope: 'read', description: '查询单个包的版本明细、占用、来源与说明' },
  get_storage_stats: { scope: 'read', description: '查询缓存总览：包总数与私有/代理分布、版本总数、占用空间（mb 为 .tgz 合计，diskMb/diskBytes 为真实磁盘占用）、预警数与可清理空间' },
  top_packages: { scope: 'read', description: '查询缓存占用排行（默认前 20）：包名、占用空间(MB，.tgz 口径)、版本数、来源与访问量，可按占用或访问量排序' },
  get_package_versions: { scope: 'read', description: '查询单个包的版本记录与依赖：逐版本返回 dependencies / devDependencies（读本地元数据，默认最多 100 个版本，超限带 truncated 标记）' },
  list_registry_users: { scope: 'read', description: '查询 原版 Verdaccio 注册用户名单（仅用户名与创建时间，不含密码、哈希与算法）' },
}

// 本期 8 个工具全部只读，read 与 full 可见集合相同；full 是给后续写工具预留的授权级别，
// 别把「read Key 现在什么都能查」当成可以取消 scope 裁剪——写工具上线时它必须已经生效。

export const LIST_LIMIT = 500
const VERSIONS_LIMIT = 100
const VERSIONS_MAX = 500
const DEP_MAP_LIMIT = 200 // 单版本依赖条数上限：异常包（上千依赖）不至于撑爆响应
const SCAN_RETRY_COOLDOWN_MS = 5 * 60_000 // 与 scan-manager 失败冷却一致

/** 该 Key 可见的工具名（read Key 看不到 full 工具，tools/list 与调用校验同源） */
export function visibleTools(scope) {
  return Object.entries(MCP_TOOLS)
    .filter(([, tool]) => tool.scope === 'read' || scope === 'full')
    .map(([name]) => name)
}

/** 截断大结果：超限返回前 N 条 + truncated 标记（PRD §3.4 规则 3） */
export function truncateList(list) {
  return {
    truncated: list.length > LIST_LIMIT,
    total: list.length,
    packages: list.slice(0, LIST_LIMIT),
  }
}

/** 列表排序：与 Verdaccio Mate 一致（预警置顶 → 正常 → 忽略 → 异常；同状态按版本数降序） */
export function sortPackages(list) {
  const rank = { warn: 0, ok: 1, ignored: 2, broken: 3 }
  return [...list].sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || b.versions - a.versions)
}

function pkgStatus(p, threshold, ignoredSet) {
  if (p.status === 'broken') return 'broken'
  if (ignoredSet.has(p.name)) return 'ignored'
  return p.versions > threshold ? 'warn' : 'ok'
}

/** 全量包快照（含状态计算）；demo 模式用内置演示数据，真实模式用扫描缓存 */
function snapshotPackages() {
  const threshold = Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD))
  const ignoredSet = new Set(getIgnoredRows().map(r => r.pkg_name))
  if (isDemoMode()) {
    return demoPackages().map(p => ({ ...p, status: pkgStatus(p, threshold, ignoredSet) }))
  }
  return buildPackages('', 'all')
}

function text(o) {
  return { content: [{ type: 'text', text: JSON.stringify(o) }], structuredContent: o }
}

function scanStatusPayload() {
  const lastErrorAt = scanState.lastErrorAt ? new Date(scanState.lastErrorAt).getTime() : NaN
  const cooldownRemainingMs = Number.isFinite(lastErrorAt)
    ? Math.max(0, Math.min(SCAN_RETRY_COOLDOWN_MS, SCAN_RETRY_COOLDOWN_MS - (Date.now() - lastErrorAt)))
    : 0
  return {
    demo: isDemoMode(),
    scanning: scanState.scanning,
    firstScan: scanState.startupScanning,
    done: scanState.done,
    startedAt: scanState.startedAt,
    finishedAt: scanState.finishedAt,
    scannedAt: getScannedAt(),
    packages: scanState.packages,
    bytes: scanState.bytes,
    diskBytes: scanState.diskBytes,
    error: scanState.error,
    lastError: scanState.error,
    lastErrorAt: scanState.lastErrorAt,
    cooldownRemainingMs,
  }
}

/** Verdaccio Mate 同口径的总览统计：broken 包不计入包数/版本数（其物理占用仍体现在 scanState 字节数里） */
function statsPayload() {
  const list = snapshotPackages()
  const valid = list.filter(p => p.status !== 'broken')
  const sum = (arr, pick) => arr.reduce((s, p) => s + (pick(p) || 0), 0)
  const ofOrigin = origin => valid.filter(p => p.origin === origin)
  const warn = valid.filter(p => p.status === 'warn')
  const mb = n => Number.isFinite(n) ? Math.round(n * 10) / 10 : null
  const toMb = bytes => mb(bytes == null ? NaN : bytes / 1024 / 1024)
  return {
    demo: isDemoMode(),
    scannedAt: getScannedAt(),
    versionThreshold: Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD)),
    packages: {
      total: valid.length,
      private: ofOrigin('private').length,
      proxy: ofOrigin('proxy').length,
      broken: list.length - valid.length,
    },
    versions: {
      total: sum(valid, p => p.versions),
      private: sum(ofOrigin('private'), p => p.versions),
      proxy: sum(ofOrigin('proxy'), p => p.versions),
    },
    size: {
      unit: 'MB',
      mb: mb(sum(valid, p => p.size)),
      cleanableMb: mb(sum(warn, p => p.size)),
      tgzMb: toMb(scanState.tgzBytes),
      diskMb: toMb(scanState.diskBytes),
      bytes: scanState.bytes,
      tgzBytes: scanState.tgzBytes,
      diskBytes: scanState.diskBytes,
      note: 'mb/cleanableMb/tgzMb 与 top_packages 的 size 同为 .tgz 体积合计；真实磁盘占用看 diskMb/diskBytes（含包目录内元数据与其他文件），回答「占了多大空间」时以后者为准',
    },
    warnings: warn.length,
  }
}

/** 占用排行：与 Verdaccio Mate Top20 同源（默认按占用降序，占用相同按版本数；访问量口径留给 Verdaccio Mate 热度） */
function topPackagesPayload(by, limit) {
  const list = snapshotPackages().filter(p => p.status !== 'broken')
  const sorted = [...list].sort(by === 'visits'
    ? (a, b) => (b.visits || 0) - (a.visits || 0) || b.size - a.size
    : (a, b) => b.size - a.size || b.versions - a.versions)
  const picked = sorted.slice(0, limit)
  return {
    demo: isDemoMode(), sortBy: by, sizeUnit: 'MB',
    total: sorted.length, truncated: sorted.length > picked.length,
    packages: picked.map((p, i) => ({
      rank: i + 1, name: p.name, size: p.size, versions: p.versions,
      visits: p.visits || 0, origin: p.origin || null, status: p.status,
    })),
  }
}

/** 依赖表只收字符串范围值；结构异常（数组/对象/嵌套）整体丢弃，不把不可信内容塞进响应 */
function pickDeps(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { deps: null, truncated: false }
  const entries = Object.entries(src).filter(([, range]) => typeof range === 'string')
  return { deps: Object.fromEntries(entries.slice(0, DEP_MAP_LIMIT)), truncated: entries.length > DEP_MAP_LIMIT }
}

/** 版本记录按「旧 → 新」返回；limit 截断时保留最新的 N 个 */
function versionsResponse(base, versions, version, limit) {
  if (version !== undefined) {
    const hit = versions.filter(v => v.version === version)
    if (!hit.length) return { isError: true, content: [{ type: 'text', text: '版本不存在' }] }
    return text({ ...base, total: versions.length, truncated: false, sizeUnit: 'MB', versions: hit })
  }
  const picked = versions.slice(-limit)
  return text({ ...base, total: versions.length, truncated: versions.length > picked.length, sizeUnit: 'MB', versions: picked })
}

/** 只读声明 + 安全业务错误；SDK 校验错误由请求层统一脱敏。 */
function registerReadTool(server, name, inputSchema, handler) {
  server.registerTool(name, {
    title: MCP_TOOLS[name].description,
    description: MCP_TOOLS[name].description,
    inputSchema: z.object(inputSchema).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      return await handler(args)
    } catch {
      return { isError: true, content: [{ type: 'text', text: '工具执行失败' }] }
    }
  })
}

/** 按 Key 权限注册可见工具：full 专属工具对只读 Key 既不出现在 tools/list，也无法调用 */
export function registerMcpTools(server, scope = 'read') {
  const visible = new Set(visibleTools(scope))
  const register = (name, inputSchema, handler) => {
    if (visible.has(name)) registerReadTool(server, name, inputSchema, handler)
  }

  register('get_scan_status', {}, () => text(scanStatusPayload()))

  register('get_scan_progress', {}, () => text({
    ...scanStatusPayload(),
    tgzBytes: scanState.tgzBytes,
  }))

  register('get_storage_stats', {}, () => text(statsPayload()))

  register('top_packages', {
    limit: z.number().int().min(1).max(100).optional().default(20).describe('返回条数，默认 20，最大 100'),
    sortBy: z.enum(['size', 'visits']).optional().default('size').describe('排序口径：size=占用（默认），visits=访问量'),
  }, async (args) => text(topPackagesPayload(args.sortBy || 'size', args.limit ?? 20)))

  register('list_packages', {
    keyword: z.string().max(214).optional().describe('最多 214 字符；不区分大小写子串，匹配包名或大小字符串'),
    origin: z.enum(['all', 'private', 'proxy']).optional().default('all').describe('来源筛选，默认 all'),
    status: z.enum(['all', 'warn', 'ok', 'ignored', 'broken']).optional().default('all').describe('状态筛选，默认 all'),
  }, async (args) => {
    const kw = String(args.keyword || '').trim().toLowerCase()
    const origin = args.origin || 'all'
    const status = args.status || 'all'
    let list
    if (isDemoMode()) {
      list = snapshotPackages()
      if (origin !== 'all') list = list.filter(p => p.origin === origin)
    } else {
      // 关键词/来源筛选复用 Verdaccio Mate 口径（buildPackages 内已含排序）
      list = buildPackages(args.keyword || '', origin)
    }
    if (kw && isDemoMode()) {
      list = list.filter(p => p.name.toLowerCase().includes(kw) || String(p.size).includes(kw))
    }
    if (status !== 'all') list = list.filter(p => p.status === status)
    if (isDemoMode()) list = sortPackages(list)
    const { truncated, total, packages } = truncateList(list)
    const summary = packages.map(p => ({
      name: p.name,
      versions: p.versions,
      size: p.size,
      lastUpdated: p.lastUpdated,
      visits: p.visits || 0,
      status: p.status,
      origin: p.origin || null,
      latest: p.latest || null,
      description: p.description || null,
    }))
    return text({
      demo: isDemoMode(), total, truncated, scanning: scanState.scanning, firstScan: scanState.startupScanning,
      sizeUnit: 'MB', packages: summary,
    })
  })

  register('get_package_detail', {
    pkgName: z.string().max(214).trim().min(1).describe('包名（必填，1–214 字符）'),
  }, async (args) => {
    const name = args.pkgName
    const raw = isDemoMode() ? demoPackages() : getRawPackages()
    const p = raw.find(x => x.name === name)
    if (!p) return { isError: true, content: [{ type: 'text', text: '包不存在' }] }
    const threshold = Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD))
    const ignoredSet = new Set(getIgnoredRows().map(r => r.pkg_name))
    return text({
      ...p, status: pkgStatus(p, threshold, ignoredSet), sizeUnit: 'MB',
      scanning: scanState.scanning, firstScan: scanState.startupScanning,
    })
  })

  register('get_package_versions', {
    pkgName: z.string().max(214).trim().min(1).describe('包名（必填，1–214 字符，支持 @scope/name）'),
    version: z.string().max(64).trim().min(1).optional().describe('只看单个版本（可选，精确匹配版本号）'),
    limit: z.number().int().min(1).max(VERSIONS_MAX).optional().default(VERSIONS_LIMIT)
      .describe(`返回版本数上限，默认 ${VERSIONS_LIMIT}，最大 ${VERSIONS_MAX}；截断时保留最新的 N 个`),
  }, async (args) => {
    const cached = (isDemoMode() ? demoPackages() : getRawPackages()).find(p => p.name === args.pkgName)
    if (!cached) return { isError: true, content: [{ type: 'text', text: '包不存在' }] }
    const base = {
      demo: isDemoMode(), name: cached.name, origin: cached.origin ?? null,
      latest: cached.latest ?? null, distTags: cached.distTags ?? null,
    }
    if (isDemoMode()) {
      // 演示数据没有真实元数据：依赖固定为 null，避免把编造内容当成事实
      return versionsResponse({ ...base, note: '演示模式：无本地元数据，依赖字段为 null' },
        (cached.versionsDetail || []).map(v => ({
          version: v.version, date: v.date, size: v.size, cached: true,
          dependencies: null, devDependencies: null, depsTruncated: false,
        })), args.version, args.limit ?? VERSIONS_LIMIT)
    }
    const meta = readPackageManifest(args.pkgName)
    if (!meta) return { isError: true, content: [{ type: 'text', text: '元数据不可读' }] }
    const versionsObj = meta.versions && typeof meta.versions === 'object' ? meta.versions : {}
    const timeObj = meta.time && typeof meta.time === 'object' ? meta.time : {}
    const detailBy = new Map((cached.versionsDetail || []).map(v => [v.version, v]))
    const versions = Object.entries(versionsObj).map(([key, info]) => {
      const version = parseVersion(key)
      const deps = pickDeps(info && info.dependencies)
      const dev = pickDeps(info && info.devDependencies)
      const detail = detailBy.get(version)
      return {
        version,
        // date/size 优先用扫描结果（含北京时间口径），元数据缺失时回退 time 字段
        date: detail ? detail.date : (timeObj[key] ? shDate(timeObj[key]) : null),
        size: detail ? detail.size : null,
        cached: !!detail, // false = 元数据里有、实体 .tgz 已被清理
        dependencies: deps.deps,
        devDependencies: dev.deps,
        depsTruncated: deps.truncated || dev.truncated,
      }
    }).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    return versionsResponse(base, versions, args.version, args.limit ?? VERSIONS_LIMIT)
  })

  register('list_registry_users', {}, () => {
    const data = readHtpasswd()
    if (!data) {
      return text({ available: false, total: 0, users: [], note: '未找到 htpasswd 文件（可用 VERDACCIO_HTPASSWD 指定路径）' })
    }
    return text({
      available: true,
      total: data.users.length,
      users: data.users.map(u => ({
        name: u.name,
        createdAt: String(u.meta || '').match(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/)?.[0] || null,
      })),
    })
  })
}
