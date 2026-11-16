/**
 * 原版 Verdaccio 缓存目录扫描（§12.1）
 * - storage 目录解析优先级：VERDACCIO_STORAGE 环境变量 → UI 设置（settings.storage_dir）
 * - 递归扫描目录内所有 package.json，解析 versions/time，匹配 .tgz 计算占用，支持 scoped 包
 * - 未配置或无效时进入 demo 模式（VCM_DEMO=1 或首次无配置）
 */
import fs from 'node:fs'
import path from 'node:path'
import { getSetting } from './db.js'


// —— storage 目录解析 ——
export function resolveStorageDir() {
  return process.env.VERDACCIO_STORAGE || getSetting('storage_dir') || null
}

export function isValidStorage(dir) {
  if (!dir) return false
  try {
    const st = fs.statSync(dir)
    if (!st.isDirectory()) return false
    fs.accessSync(dir, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

export function validateStorage(dir) {
  if (!isValidStorage(dir)) return { ok: false, message: '目录不存在或不可读' }
  // 至少包含 package.json 或 .tgz 之一，才算有效缓存目录
  const files = listFiles(dir, 1)
  const hasPkg = files.some(f => f.endsWith('package.json'))
  const hasTgz = files.some(f => f.endsWith('.tgz'))
  if (!hasPkg && !hasTgz) {
    return { ok: false, message: '目录中未找到 package.json / .tgz，不是有效的 原版 Verdaccio 缓存目录' }
  }
  return { ok: true, message: 'ok' }
}

function listFiles(dir, depth = Infinity, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '.DS_Store') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth > 0) listFiles(full, depth - 1, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function fmtMb(bytes) {
  // 保留到 KB 级精度：toFixed(1) 会把 <0.05MB 的轻量包（几 KB~几十 KB）截成 0
  return Math.round((bytes / 1024 / 1024) * 1024) / 1024
}

// —— 存储根 DB（verdaccio-db.json）私有包清单 ——
// 原版 Verdaccio 6.x 把本地已知包名写在 storage 根目录的 verdaccio-db.json（list 字段），
// 与包目录 package.json 的 _uplinks 交叉校验 origin：私有发布包必然 _uplinks 为空。
let dbListCache = { dir: null, mtimeMs: 0, set: null }
function readStorageDbList(storageDir) {
  if (!storageDir) return null
  const files = ['verdaccio-db.json', '.verdaccio-db.json'] // 6.x 主用前者，兜底旧命名
  let file = null
  for (const f of files) {
    const p = path.join(storageDir, f)
    try {
      if (fs.statSync(p).isFile()) { file = p; break }
    } catch { /* 候选命名不存在（ENOENT）属预期，继续试下一个 */ }
  }
  if (!file) return null
  let mtimeMs
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { return null }
  if (dbListCache.dir === file && dbListCache.mtimeMs === mtimeMs) return dbListCache.set
  let set = null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(raw.list)) set = new Set(raw.list)
  } catch { /* DB 文件损坏/被写一半 → set 保持 null，来源判定回退仅凭 _uplinks */ }
  dbListCache = { dir: file, mtimeMs, set }
  return set
}

// —— origin 判定（私有发布 vs 上游代理缓存） ——
// _uplinks 非空（任一版本来自上游）→ proxy；为空/缺失 → private。
// 存储 DB list 交叉校验：私有发布包必然 _uplinks 空且（若 DB 可读）命中 list；
// 但代理缓存也会被 原版 Verdaccio 写入 list，故 _uplinks 是权威信号，list 仅作确认（注释留档）。
function originOf(meta) {
  const uplinks = meta['_uplinks']
  const has = uplinks && typeof uplinks === 'object' && Object.keys(uplinks).length > 0
  return has ? 'proxy' : 'private'
}

// 目录名 → 包名（支持 scoped：@scope/name）
function dirToPkgName(segments) {
  if (segments.length >= 2 && segments[0].startsWith('@')) {
    return `${segments[0]}/${segments[1]}`
  }
  return segments[segments.length - 1]
}

// 从 package.json 所在目录向上推导包名
function pkgNameFromDir(pkgDir, storageDir) {
  const rel = path.relative(storageDir, pkgDir).split(path.sep)
  return dirToPkgName(rel)
}

// —— 按需读取单个包的落盘元数据（MCP 版本/依赖查询；不进扫描缓存，不缓存以避开陈旧元数据） ——
const MANIFEST_MAX_BYTES = 32 * 1024 * 1024 // 超大元数据视为异常目录，直接放弃读取

/** 包名 → 目录段（仅 1–2 段、scoped 以 @ 开头）；非法名返回 null，防目录穿越 */
export function pkgNameToSegments(pkgName) {
  if (typeof pkgName !== 'string' || !pkgName || pkgName.length > 214) return null
  const segments = pkgName.split('/')
  const leaf = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,213}$/
  if (segments.length === 1) return leaf.test(segments[0]) ? segments : null
  if (segments.length === 2 && segments[0].startsWith('@')) {
    return /^@[a-zA-Z0-9._-]{1,213}$/.test(segments[0]) && leaf.test(segments[1]) ? segments : null
  }
  return null
}

/** 读 <storage>/[@scope/]name/package.json；名称非法、越界、缺失或过大返回 null */
export function readPackageManifest(pkgName, storageDir = resolveStorageDir()) {
  const segments = pkgNameToSegments(pkgName)
  if (!segments || !isValidStorage(storageDir)) return null
  const root = path.resolve(storageDir)
  const file = path.resolve(path.join(root, ...segments, 'package.json'))
  if (!file.startsWith(root + path.sep)) return null
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > MANIFEST_MAX_BYTES) return null
  } catch {
    return null
  }
  return readJson(file)
}

export function parseVersion(v) {
  // 去前缀 v、prerelease 后缀仅比较主体
  return (String(v).replace(/^v/, '') || '').trim()
}

// —— 日期口径（项目统一北京时间，避免 UTC slice 跨日偏差） ——
const SH_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
/** ISO 字符串 → 北京时间日期（YYYY-MM-DD）；time 字段为 UTC，直接 slice 会与本地跨日 */
export function shDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : SH_DATE.format(d)
}
/** 本地时区日期（YYYY-MM-DD）：.tgz 文件 mtime 为本地时间，与前端 todayStr 同口径 */
function localDate(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** 最近更新 = max(元数据最新版本发布日, 最新 .tgz 缓存日) —— 今天拉取缓存也算「今天更新」 */
function latestDate(metaUpdated, tgzMtime) {
  const tgzUpdated = tgzMtime ? localDate(new Date(tgzMtime)) : null
  return [metaUpdated, tgzUpdated].filter(Boolean).sort().pop() || null
}

/**
 * 包信息字段提取（description/homepage/repository/author/license）
 * 原版 Verdaccio 落盘的元数据顶层不含这些字段（实测只有 name/versions/time/dist-tags/readme 等），
 * 但每个 versions[v] 里都有完整字段。因此先读顶层，取不到时按 semver 数值排序回退到最新版本。
 * @param {object} meta 落盘的 package.json 元数据
 * @param {object} versionsObj meta.versions
 * @param {string} key 字段名
 * @param {(src:any)=>string} [picker] 字段为对象时（repository.url / author.name）取值
 */
function metaField(meta, versionsObj, key, picker) {
  const pick = src => {
    if (!src) return null
    const v = typeof src === 'string' ? src : (picker ? picker(src) : null)
    return typeof v === 'string' && v ? v : null
  }
  const top = pick(meta[key])
  if (top) return top
  const sorted = Object.entries(versionsObj).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  for (let i = sorted.length - 1; i >= 0; i--) {
    const v = pick(sorted[i][1] && sorted[i][1][key])
    if (v) return v
  }
  return null
}


/** 异步递归列文件（fs.promises，目录并行读取） */
async function listFilesAsync(dir, depth = Infinity) {
  const out = []
  async function walk(d, dth) {
    let entries
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async e => {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '.DS_Store') return
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (dth > 0) await walk(full, dth - 1)
      } else out.push(full)
    }))
  }
  await walk(dir, depth)
  return out
}

/**
 * 增量扫描缓存：包目录指纹 → 上次扫描结果。
 * 两次扫描间未变化的包直接复用旧结果，只重扫有增删/改写的包目录，
 * 大幅减少 package.json 读取与 .tgz stat（原版 Verdaccio 缓存目录绝大多数包长期不变）
 */
const pkgCache = new Map() // pkgDir -> { mtimeMs, metaSize, entries, bytes, tgzBytes, pkg }

/** 清理增量缓存（storage 目录切换/失效时调用，避免旧目录条目残留导致内存与口径污染） */
export function clearPkgCache() {
  pkgCache.clear()
}

/**
 * 异步扫描（fs.promises + 并发池，多目录并行 IO + 增量缓存）
 * 用于后台重扫：并发扫描期间仍能响应 /api/scan/progress 等请求，前端可实时展示进度
 * 相比旧版（逐个目录同步 IO + setImmediate 让出），数千包场景吞吐明显提升
 */
export async function scanStorageAsync(storageDir, onProgress) {
  const packages = []
  if (!isValidStorage(storageDir)) return packages

  const allFiles = await listFilesAsync(storageDir)
  // 包目录 = 含 package.json 的目录 ∪ 含 .tgz 的目录（避免只缓存了 tgz、缺元数据的目录被漏算）
  const pkgDirs = new Set()
  for (const f of allFiles) {
    if (f.endsWith('package.json') || f.endsWith('.tgz')) pkgDirs.add(path.dirname(f))
  }
  const storageRoot = path.resolve(storageDir)
  const dirs = [...pkgDirs].sort() // 排序保证输出顺序稳定（异步递归收集顺序不固定）
  let scanned = 0
  let scannedBytes = 0 // 所有文件字节和（总占用，与 du 同口径）
  let tgzBytes = 0     // 仅 .tgz 字节和（包粒度用）

  // 单包目录扫描：目录内文件 stat 并行，元数据损坏时按物理 .tgz 计算真实占用
  async function scanOne(pkgDir) {
    const pkgFile = path.join(pkgDir, 'package.json')
    let entries
    try {
      entries = await fs.promises.readdir(pkgDir, { withFileTypes: true })
    } catch {
      return null
    }
    // 指纹 = max(包目录 mtime, package.json mtime) + 元数据字节数 + 目录项数：
    // 单靠 mtime 会漏判——同一时间戳刻度内的删除/改写（清理低版本、批量拉取）拿不到新 mtime，
    // 缓存命中就返回幽灵版本数；字节数与目录项数把这类变化兜住
    let mtimeMs = 0
    let metaSize = -1
    try {
      mtimeMs = (await fs.promises.stat(pkgDir)).mtimeMs
      try {
        const ps = await fs.promises.stat(pkgFile)
        if (ps.mtimeMs > mtimeMs) mtimeMs = ps.mtimeMs
        metaSize = ps.size
      } catch { /* package.json 缺失/正被写入 → 指纹仅取目录 mtime */ }
    } catch {
      return null
    }
    const hit = pkgCache.get(pkgDir)
    if (hit && hit.mtimeMs === mtimeMs && hit.metaSize === metaSize && hit.entries === entries.length) {
      // 自上次扫描无变化：复用结果，补齐占用统计
      scannedBytes += hit.bytes
      tgzBytes += hit.tgzBytes
      return hit.pkg
    }
    const tgzSizes = new Map()
    let tgzTotal = 0
    let incBytes = 0 // 本次新增扫描的字节数（写缓存用）
    let tgzLatest = 0 // 最新 .tgz 文件 mtime（毫秒）：今天缓存了新版本也算「今天更新」
    const stats = (await Promise.all(entries.map(async e => {
      try {
        return { name: e.name, st: await fs.promises.stat(path.join(pkgDir, e.name)) }
      } catch {
        return null
      }
    }))).filter(Boolean)
    for (const { name, st } of stats) {
      scannedBytes += st.size
      incBytes += st.size
      if (name.endsWith('.tgz')) {
        tgzTotal += st.size
        tgzSizes.set(name.slice(0, -4), st.size)
        if (st.mtimeMs > tgzLatest) tgzLatest = st.mtimeMs
      }
    }
    tgzBytes += tgzTotal

    let meta = null
    try {
      meta = JSON.parse(await fs.promises.readFile(pkgFile, 'utf8'))
    } catch { /* 元数据损坏/读取失败 → meta 为 null，下方 !meta 分支按 broken 包处理 */ }
    if (!meta) {
      const pkg = {
        name: pkgNameFromDir(pkgDir, storageRoot),
        status: 'broken',
        versions: 0,
        size: fmtMb(tgzTotal),
        lastUpdated: latestDate(null, tgzLatest),
        versionsDetail: [],
        origin: null,
        readme: null,
        latest: null,
      }
      pkgCache.set(pkgDir, { mtimeMs, metaSize, entries: entries.length, bytes: incBytes, tgzBytes: tgzTotal, pkg })
      return pkg
    }

    const versionsObj = meta.versions || {}
    const timeObj = meta.time || {}
    const distTags = meta['dist-tags'] || {}
    // 包信息（来自本地元数据，离线可用）：介绍/主页/仓库/作者/许可
    // 顶层缺失时回退到最新版本里的字段（原版 Verdaccio 落盘元数据顶层不含这些）
    const description = metaField(meta, versionsObj, 'description')
    const homepage = metaField(meta, versionsObj, 'homepage')
    const repository = metaField(meta, versionsObj, 'repository', r => r.url)
    const author = metaField(meta, versionsObj, 'author', a => a.name)
    const license = metaField(meta, versionsObj, 'license')
    const versionsDetail = []
    // 总大小以实际 .tgz 文件为准
    const totalBytes = tgzTotal
    for (const [v, info] of Object.entries(versionsObj)) {
      let size = tgzSizes.get(v)
      if (typeof size !== 'number') {
        // 兼容 {pkgname}-{version}.tgz 命名：用元数据 dist.tarball 的文件名精确匹配
        const tb = info && info.dist && info.dist.tarball
        const bn = tb ? String(tb).split('/').pop() : ''
        if (bn.endsWith('.tgz')) {
          const hit = tgzSizes.get(bn.slice(0, -4))
          if (typeof hit === 'number') size = hit
        }
      }
      // 无物理 .tgz 文件的版本是元数据残留（实体已被清理），不计数，避免版本数虚高
      if (typeof size !== 'number') continue
      versionsDetail.push({
        version: parseVersion(v),
        size: fmtMb(size),
        date: timeObj[v] ? shDate(timeObj[v]) : null,
      })
    }
    // 按 semver 数值排序（旧 → 新）
    versionsDetail.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))

    // 最近更新：取「元数据最新版本发布日」与「最新 .tgz 缓存日」中较新者（今天拉缓存也算今天更新）
    const metaUpdated = Object.keys(timeObj).length
      ? Object.entries(timeObj).map(([, iso]) => shDate(iso)).filter(Boolean).sort().pop()
      : null
    const lastUpdated = latestDate(metaUpdated, tgzLatest)

    const pkg = {
      name: pkgNameFromDir(pkgDir, storageRoot),
      versions: versionsDetail.length,
      size: fmtMb(totalBytes),
      lastUpdated,
      visits: 0, // 真实环境无访问统计，界面不依赖真实值
      distTags,
      description,
      homepage,
      repository,
      author,
      license,
      origin: originOf(meta),
      readme: meta.readme || null,
      latest: distTags.latest || (versionsDetail.length ? versionsDetail[versionsDetail.length - 1].version : null),
      versionsDetail,
    }
    pkgCache.set(pkgDir, { mtimeMs, metaSize, entries: entries.length, bytes: incBytes, tgzBytes: tgzTotal, pkg })
    return pkg
  }

  // 并发池：同时处理 CONCURRENCY 个包目录，结果按下标回填保持稳定顺序
  const CONCURRENCY = 16
  const results = new Array(dirs.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const idx = next++
      if (idx >= dirs.length) return
      results[idx] = await scanOne(dirs[idx])
      scanned += 1
      if (onProgress) onProgress({ packages: scanned, bytes: scannedBytes, tgzBytes })
    }
  }
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dirs.length) }, worker))

  for (const p of results) if (p) packages.push(p)
  // 清理本次未扫到的旧缓存条目（目录被删除/替换后不留残留，防内存膨胀与过期口径）
  const current = new Set(dirs)
  for (const key of pkgCache.keys()) {
    if (!current.has(key)) pkgCache.delete(key)
  }
  return packages
}

// —— demo 模式数据（无真实目录时的演示） ——
const DEMO_SEED = [
  ['lodash', 25, 4, 12456], ['@antv/g2', 32, 12, 7654], ['axios', 18, 1.2, 9832],
  ['react', 14, 10, 6543], ['vue', 12, 9, 5218], ['express', 16, 0.8, 4376],
  ['tensorflow', 24, 90, 2103], ['typescript', 20, 22, 3421], ['webpack', 19, 18, 2876],
  ['echarts', 15, 16, 1987], ['dayjs', 8, 0.6, 1789], ['uuid', 11, 0.4, 1654],
  ['vite', 9, 14, 1432], ['prisma', 7, 28, 1120], ['pg', 6, 5, 986],
  ['three', 10, 30, 876], ['sharp', 5, 24, 654], ['chalk', 6, 0.3, 743],
  ['semver', 4, 0.3, 532], ['zod', 5, 0.5, 421],
  ['prettier', 3, 1, 388], ['rollup', 8, 6, 356], ['eslint', 13, 8, 342],
  ['moment', 20, 2, 312], ['mocha', 7, 1.4, 301], ['cheerio', 9, 3, 287],
  ['@vue/compiler-sfc', 11, 5, 265], ['ioredis', 10, 4, 254], ['graphql', 12, 7, 243],
['socket.io', 6, 2, 231], ['xlsx', 14, 20, 218], ['d3', 9, 12, 205],
  ['puppeteer', 4, 15, 187],
]

function pad(n) { return String(n).padStart(2, '0') }
function dateStr(offset) {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function genVersions(count) {
  const list = []
  for (let i = 0; i < count; i++) {
    list.push({
      version: `1.${rnd(0, 9)}.${rnd(0, 20)}`,
      size: Number((rnd(5, 400) / 10).toFixed(1)),
      date: dateStr((count - i) * rnd(3, 9)),
    })
  }
  list.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  return list
}

// demo 包信息（演示模式展示用，真实环境来自缓存元数据）
const DEMO_META = {
  lodash: { description: 'A modern JavaScript utility library delivering modularity, performance & extras.', homepage: 'https://lodash.com', repository: 'git+https://github.com/lodash/lodash.git', license: 'MIT' },
  react: { description: 'React is a JavaScript library for building user interfaces.', homepage: 'https://react.dev', repository: 'git+https://github.com/facebook/react.git', license: 'MIT' },
  vue: { description: 'The progressive JavaScript framework for building modern web UI.', homepage: 'https://vuejs.org', repository: 'git+https://github.com/vuejs/core.git', license: 'MIT' },
  axios: { description: 'Promise based HTTP client for the browser and node.js.', homepage: 'https://axios-http.com', repository: 'git+https://github.com/axios/axios.git', license: 'MIT' },
  typescript: { description: 'TypeScript is a language for application-scale JavaScript.', homepage: 'https://www.typescriptlang.org', repository: 'git+https://github.com/microsoft/TypeScript.git', license: 'Apache-2.0' },
  express: { description: 'Fast, unopinionated, minimalist web framework for node.', homepage: 'https://expressjs.com', repository: 'git+https://github.com/expressjs/express.git', license: 'MIT' },
  vite: { description: 'Native-ESM powered web dev build tool.', homepage: 'https://vitejs.dev', repository: 'git+https://github.com/vitejs/vite.git', license: 'MIT' },
  webpack: { description: 'Packs CommonJs/AMD modules for the browser.', homepage: 'https://webpack.js.org', repository: 'git+https://github.com/webpack/webpack.git', license: 'MIT' },
  echarts: { description: 'Apache ECharts is a powerful, interactive charting and visualization library for browser.', homepage: 'https://echarts.apache.org', repository: 'git+https://github.com/apache/echarts.git', license: 'Apache-2.0' },
  dayjs: { description: 'Day.js is a minimalist JavaScript library that parses, validates, manipulates, and displays dates and times for modern browsers.', homepage: 'https://day.js.org', repository: 'git+https://github.com/iamkun/dayjs.git', license: 'MIT' },
  prisma: { description: 'Prisma is a next-generation ORM that helps you build and query databases.', homepage: 'https://www.prisma.io', repository: 'git+https://github.com/prisma/prisma.git', license: 'Apache-2.0' },
  three: { description: 'JavaScript 3D library.', homepage: 'https://threejs.org', repository: 'git+https://github.com/mrdoob/three.js.git', license: 'MIT' },
  uuid: { description: 'RFC4122 (v1, v4, and v5) UUIDs.', homepage: 'https://github.com/uuidjs/uuid', repository: 'git+https://github.com/uuidjs/uuid.git', license: 'MIT' },
  zod: { description: 'TypeScript-first schema validation with static type inference.', homepage: 'https://zod.dev', repository: 'git+https://github.com/colinhacks/zod.git', license: 'MIT' },
}

// demo 包数据：模块加载时生成一次并固定
// 原实现每次调用 demoPackages() 都重新随机生成版本，导致演示数据每次刷新都变（
// 版本号/大小/日期全随机），清理演示也前后不一致。改为固定快照。
const DEMO_PACKAGES = buildDemoPackages()

function buildDemoPackages() {
  const seen = new Set()
  const out = []
  for (const [name, verCount, sizeBase, visits] of DEMO_SEED) {
    if (seen.has(name)) continue // 防御：seed 中重复条目只保留首个
    seen.add(name)
    const detail = genVersions(verCount)
    const meta = DEMO_META[name] || {}
    out.push({
      name,
      versions: detail.length,
      size: Number((detail.reduce((s, v) => s + v.size, 0)).toFixed(1)),
      lastUpdated: detail.length ? detail[detail.length - 1].date : null,
      visits,
      distTags: { latest: detail.length ? detail[detail.length - 1].version : '1.0.0' },
      description: meta.description || null,
      homepage: meta.homepage || null,
      repository: meta.repository || null,
      author: meta.author || null,
      license: meta.license || null,
      origin: 'proxy',
      readme: `${meta.description || name}（演示数据）`,
      latest: detail.length ? detail[detail.length - 1].version : '1.0.0',
      versionsDetail: detail,
    })
  }
  return out
}

export function demoPackages() {
  return DEMO_PACKAGES
}

export function demoSummary() {
  return {
    demo: true,
    todayDownloads: 1234,
    todayTrend: '+18%',
    note: '演示模式：未配置 原版 Verdaccio 缓存目录，展示内置演示数据。',
  }
}
