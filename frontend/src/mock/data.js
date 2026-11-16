/**
 * Mock 数据层 —— 先行跑通 UI
 * 数据结构与后端 §4 对齐，之后切换 api 实现即可无缝替换
 */

// 常见包名池（含 scoped）
const PKG_POOL = [
  'lodash', 'axios', 'react', 'vue', 'express', 'webpack', 'typescript', 'eslint',
  'prettier', 'vite', 'rollup', 'jest', 'mocha', 'dayjs', 'moment', 'uuid',
  'dotenv', 'commander', 'chalk', 'semver', 'debug', 'ws', 'zod', 'yup',
  '@antv/g2', '@antv/g6', '@ant-design/icons', '@vue/compiler-sfc', '@vueuse/core',
  '@babel/core', '@types/node', '@types/react', '@types/lodash', '@element-plus/icons-vue',
  '@testing-library/react', 'tensorflow', 'sharp', 'puppeteer', 'cheerio', 'ioredis',
  'pg', 'mysql2', 'mongo-express', 'knex', 'sequelize', 'prisma', 'graphql',
  'apollo-server', 'socket.io', 'three', 'd3', 'echarts', 'chart.js', 'pdf-lib',
  'xlsx', 'csv-parse', 'js-yaml', 'fast-glob', 'execa', 'nanoid', 'clsx',
]

const SCOPED = new Set(['@antv', '@ant-design', '@vue', '@vueuse', '@babel', '@types', '@element-plus', '@testing-library'])

function pad(n) {
  return String(n).padStart(2, '0')
}

function dateStr(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function fmtSize(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`
}

// 生成单个包的版本明细
function genVersions(name, count, baseVersion) {
  const list = []
  const [major] = baseVersion.split('.')
  let curMajor = Number(major)
  for (let i = 0; i < count; i++) {
    // 版本号随时间自然递增：越新越靠后
    const minor = rnd(0, 9)
    const patch = rnd(0, 20)
    const v = `${curMajor}.${minor}.${patch}`
    const size = rnd(2, 40) * 0.1 + 0.5
    list.push({
      version: v,
      size: Number(size.toFixed(1)),
      date: dateStr((count - i - 1) * rnd(3, 9) + rnd(0, 2)),
    })
    if (i === count - 1) curMajor++
  }
  return list
}

/** @returns {import('../types.js').PackageInfo[]} */
function genPackages() {
  const threshold = 15
  /** @type {import('../types.js').PackageInfo[]} */
  const list = []
  /** @type {Array<[string, number, number, number]>} */
  const seed = [
    // [name, 版本数, 单版本大小基数, 访问次数, 标记]
    ['lodash', 25, 4, 12456],
    ['@antv/g2', 32, 12, 7654],
    ['axios', 18, 1.2, 9832],
    ['react', 14, 10, 6543],
    ['vue', 12, 9, 5218],
    ['express', 16, 0.8, 4376],
    ['tensorflow', 24, 90, 2103],
    ['typescript', 20, 22, 3421],
    ['webpack', 19, 18, 2876],
    ['echarts', 15, 16, 1987],
    ['dayjs', 8, 0.6, 1789],
    ['uuid', 11, 0.4, 1654],
    ['vite', 9, 14, 1432],
    ['prisma', 7, 28, 1120],
    ['pg', 6, 5, 986],
    ['three', 10, 30, 876],
    ['sharp', 5, 24, 654],
    ['chalk', 6, 0.3, 743],
    ['semver', 4, 0.3, 532],
    ['zod', 5, 0.5, 421],
  ]
  for (const [name, verCount, sizeBase, visits] of seed) {
    list.push({
      name,
      versions: verCount,
      size: Number((verCount * sizeBase).toFixed(1)),
      lastUpdated: dateStr(rnd(1, 40)),
      visits,
      status: verCount > threshold ? 'warn' : 'ok',
      versionsDetail: genVersions(name, verCount, `1.${rnd(0, 9)}.0`),
    })
  }

  // 程序化补充一批普通包
  const rest = PKG_POOL.filter(n => !seed.some(s => s[0] === n))
  for (const name of rest) {
    const verCount = rnd(1, 14)
    const sizeBase = rnd(3, 80) / 10
    list.push({
      name,
      versions: verCount,
      size: Number((verCount * sizeBase).toFixed(1)),
      lastUpdated: dateStr(rnd(1, 60)),
      visits: rnd(80, 1800),
      status: 'ok',
      versionsDetail: genVersions(name, verCount, `1.${rnd(0, 9)}.0`),
    })
  }

  // 忽略包
  const ignoredNames = ['moment', '@vue/compiler-sfc', 'mocha', 'cheerio']
  for (const name of ignoredNames) {
    const p = list.find(x => x.name === name)
    if (p) {
      p.status = 'ignored'
      p.ignoredAt = dateStr(rnd(3, 20))
    }
  }

  // 单个异常包（元数据损坏演示）
  const broken = list.find(x => x.name === 'prettier')
  if (broken) {
    broken.status = 'broken'
    broken.versionsDetail = []
  }

  return list
}

const packages = genPackages()

// 访问排行 Top30（按 visits 降序）
const top30 = [...packages]
  .filter(p => p.status !== 'broken')
  .sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0))
  .slice(0, 20)
  .map(p => ({ ...p, heat: Math.round(((p.visits ?? 0) / topMax(packages)) * 100) }))

function topMax(list) {
  return Math.max(...list.map(p => p.visits ?? 0), 1)
}

// 日志（action: clean=清理 / ignore=忽略 / unignore=取消忽略）
const logs = [
  { id: 3, action: 'clean', pkgName: '@antv/g2', deletedVersions: '1.0.0, 1.1.0, 1.2.0', deletedCount: 3, freedSpace: '36.5 MB', created_at: dateStr(0) + ' 09:12:04' },
  { id: 2, action: 'ignore', pkgName: 'moment', created_at: dateStr(1) + ' 18:40:22' },
  { id: 1, action: 'clean', pkgName: 'axios', deletedVersions: '0.19.0', deletedCount: 1, freedSpace: '1.1 MB', created_at: dateStr(2) + ' 11:05:47' },
]

// 状态统计（与 overview 对齐）
function summary() {
  const valid = packages.filter(p => p.status !== 'broken')
  const totalSize = valid.reduce((s, p) => s + p.size, 0)
  const warnCount = valid.filter(p => p.status === 'warn').length
  const cleanable = valid.filter(p => p.status === 'warn').reduce((s, p) => s + p.size, 0)
  const maxPkg = [...valid].sort((a, b) => b.size - a.size)[0]
  const oldest = [...valid].sort((a, b) => (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? ''))[0]
  return {
    pkgCount: valid.length,
    totalSize,
    totalSizeText: fmtSize(totalSize),
    warnCount,
    cleanable,
    cleanableText: fmtSize(cleanable),
    todayDownloads: 1234,
    todayTrend: '+18%',
    maxPkg,
    oldestPkg: oldest,
    versionDist: { over50: 12, over30: 41, overThreshold: warnCount },
  }
}

export { packages, top30, logs, summary, fmtSize }
