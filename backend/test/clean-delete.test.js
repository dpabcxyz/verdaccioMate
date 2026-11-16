/**
 * 核心删除链路测试：clean.js（批量清理/单版本删除）+ scanner.js（扫描与来源识别）
 * 危险路径重点：
 * - 只删最旧 N-keep 个版本，绝不误删要保留的最新版本
 * - 物理文件与元数据严格一致（无 .tgz 空间泄漏、无幽灵版本）
 * - clean 之后增量扫描缓存正确失效（重扫不残留旧数据）
 * 环境隔离：独立临时 DATA_DIR / VERDACCIO_STORAGE，不触碰生产数据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// —— 环境隔离：db/scanner 在模块加载时读取，必须在 import 之前设置 ——
const previousEnv = Object.fromEntries(['DATA_DIR', 'VCM_DEMO', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]))
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-clean-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE

const { cleanPackage, deleteSingleVersion, locatePackageDir } = await import('../clean.js')
const { scanStorageAsync, clearPkgCache } = await import('../scanner.js')
const { default: db } = await import('../db.js')

const MB = 1024 * 1024
const VERSIONS = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0']

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** 构造 原版 Verdaccio 落盘元数据 */
function buildMeta(name, versions, { uplinks = null, distTags = null, unpackedSize = 1024 } = {}) {
  const versionsObj = {}
  const time = {}
  versions.forEach((v, i) => {
    versionsObj[v] = {
      name,
      version: v,
      dist: { tarball: `${name}/-/${name}-${v}.tgz`, unpackedSize },
    }
    time[v] = `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
  })
  const meta = {
    name,
    versions: versionsObj,
    time,
    'dist-tags': distTags || { latest: versions[versions.length - 1] },
  }
  if (uplinks) meta._uplinks = uplinks
  return meta
}

/** 写包目录：元数据 + 新命名 {version}.tgz（默认 1MB/个，便于精确断言 freedSpace） */
function writePkg(storage, segs, meta, { tgzBytes = MB, oldStyleName = null, skipTgz = [] } = {}) {
  const dir = path.join(storage, ...segs)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(meta, null, 2))
  for (const v of Object.keys(meta.versions)) {
    if (skipTgz.includes(v)) continue
    const fileName = oldStyleName ? `${oldStyleName}-${v}.tgz` : `${v}.tgz`
    fs.writeFileSync(path.join(dir, fileName), Buffer.alloc(tgzBytes, 7))
  }
  return dir
}

function listFilesIn(dir) {
  return fs.readdirSync(dir).sort()
}

test.after(() => {
  // Windows 下 SQLite WAL 文件句柄未释放会导致 rmSync EPERM：先显式关闭连接
  try { db.close() } catch { /* 已关闭或未初始化 */ }
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch { /* 清理失败不影响测试结果 */ }
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

// —— locatePackageDir ——
test('locatePackageDir：普通包与 scoped 包定位', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  writePkg(storage, ['@antv', 'g2'], buildMeta('@antv/g2', ['1.0.0']))
  assert.equal(locatePackageDir(storage, 'lodash'), path.join(storage, 'lodash'))
  assert.equal(locatePackageDir(storage, '@antv/g2'), path.join(storage, '@antv', 'g2'))
  assert.equal(locatePackageDir(storage, 'no-such-pkg'), null)
  fs.rmSync(storage, { recursive: true, force: true })
})

test('locatePackageDir：包名白名单防目录穿越（复用 scanner 的 pkgNameToSegments）', () => {
  const storage = tmpDir('vcm-clean-')
  // 白名单是第一道闸：无论越界目标是否存在 package.json，非法名一律拒绝
  assert.equal(locatePackageDir(storage, '..'), null, "'..' 单段不得命中 storage 父目录")
  assert.equal(locatePackageDir(storage, '../..'), null, "多段 '..' 不得越界")
  assert.equal(locatePackageDir(storage, '@x/../../evil'), null, 'scoped 夹带 .. 不得越界')
  assert.equal(locatePackageDir(storage, 'a/b/c'), null, '三段名（非法 npm 包名）直接拒绝')
  assert.equal(locatePackageDir(storage, 'a/b'), null, '无 @ 的两段名不属于合法包名')
  assert.equal(locatePackageDir(storage, '.'), null)
  assert.equal(locatePackageDir(storage, '..%2F..'), null, 'URL 编码形态同样不匹配白名单')
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— cleanPackage：核心危险路径 ——
test('cleanPackage：保留最新 N 版删其余——物理文件、元数据、统计三方一致', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const r = cleanPackage(storage, 'lodash', 2)
  assert.equal(r.ok, true)
  assert.equal(r.deletedCount, 3)
  assert.equal(r.deletedVersions, '1.0.0, 1.1.0, 1.2.0')
  assert.equal(r.freedBytes, 3 * MB)
  assert.equal(r.freedSpace, '3.0 MB')
  const dir = path.join(storage, 'lodash')
  // 物理文件：被删的 3 个消失，保留的 2 个原样存在
  assert.deepEqual(listFilesIn(dir), ['1.3.0.tgz', '1.4.0.tgz', 'package.json'])
  // 元数据：versions/time 键与保留版本完全一致，无幽灵残留
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(meta.versions).sort(), ['1.3.0', '1.4.0'])
  assert.deepEqual(Object.keys(meta.time).sort(), ['1.3.0', '1.4.0'])
  assert.equal(meta['dist-tags'].latest, '1.4.0')
  // .clean.tmp 临时文件不残留
  assert.ok(!fs.existsSync(path.join(dir, 'package.json.clean.tmp')))
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：版本数未超保留值时零改动（不误删保护）', () => {
  const storage = tmpDir('vcm-clean-')
  const dir = writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const before = listFilesIn(dir).join('|')
  const metaMtime = fs.statSync(path.join(dir, 'package.json')).mtimeMs
  const r = cleanPackage(storage, 'lodash', 5)
  assert.equal(r.ok, false)
  assert.match(r.message, /无需清理/)
  assert.equal(listFilesIn(dir).join('|'), before)
  assert.equal(fs.statSync(path.join(dir, 'package.json')).mtimeMs, metaMtime)
  // keep 大于版本数同样安全
  assert.equal(cleanPackage(storage, 'lodash', 99).ok, false)
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：dist-tags 指向被删旧版本时重定向到保留的最新版', () => {
  const storage = tmpDir('vcm-clean-')
  // latest 与 next 都指向将被清理的旧版本
  writePkg(storage, ['pkg-a'], buildMeta('pkg-a', VERSIONS, { distTags: { latest: '1.0.0', next: '1.2.0' } }))
  const r = cleanPackage(storage, 'pkg-a', 2)
  assert.equal(r.ok, true)
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'pkg-a', 'package.json'), 'utf8'))
  assert.equal(meta['dist-tags'].latest, '1.4.0')
  assert.equal(meta['dist-tags'].next, '1.4.0')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：dist-tags 指向保留版本时保持不变', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['pkg-b'], buildMeta('pkg-b', VERSIONS, { distTags: { latest: '1.4.0', lts: '1.3.0' } }))
  cleanPackage(storage, 'pkg-b', 2)
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'pkg-b', 'package.json'), 'utf8'))
  assert.equal(meta['dist-tags'].latest, '1.4.0')
  assert.equal(meta['dist-tags'].lts, '1.3.0')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：旧版命名 {pkgname}-{version}.tgz 同样被物理删除（防空间泄漏）', () => {
  const storage = tmpDir('vcm-clean-')
  const versions = ['2.0.0', '2.1.0', '2.2.0']
  writePkg(storage, ['cheerio'], buildMeta('cheerio', versions), { oldStyleName: 'cheerio' })
  const r = cleanPackage(storage, 'cheerio', 1)
  assert.equal(r.ok, true)
  assert.equal(r.deletedCount, 2)
  assert.deepEqual(listFilesIn(path.join(storage, 'cheerio')), ['cheerio-2.2.0.tgz', 'package.json'])
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：混合命名（新旧并存）按物理文件名精确匹配，两种都能删除', () => {
  const storage = tmpDir('vcm-clean-')
  const versions = ['2.9.0', '3.0.0', '3.1.0']
  const meta = buildMeta('mixed', versions)
  const dir = path.join(storage, 'mixed')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(meta, null, 2))
  fs.writeFileSync(path.join(dir, 'mixed-2.9.0.tgz'), Buffer.alloc(MB, 7)) // 旧命名
  fs.writeFileSync(path.join(dir, '3.0.0.tgz'), Buffer.alloc(MB, 7))      // 新命名
  fs.writeFileSync(path.join(dir, '3.1.0.tgz'), Buffer.alloc(MB, 7))      // 新命名
  const r = cleanPackage(storage, 'mixed', 1)
  assert.equal(r.ok, true)
  assert.equal(r.deletedCount, 2)
  assert.equal(r.freedBytes, 2 * MB)
  assert.deepEqual(listFilesIn(dir), ['3.1.0.tgz', 'package.json'])
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：元数据残留版本（无实体 tgz）被清理且不报错，体积按 unpackedSize 兜底', () => {
  const storage = tmpDir('vcm-clean-')
  const versions = ['1.0.0', '1.1.0', '1.2.0']
  writePkg(storage, ['ghost'], buildMeta('ghost', versions, { unpackedSize: 1024 }), { skipTgz: ['1.0.0'] })
  const r = cleanPackage(storage, 'ghost', 1)
  assert.equal(r.ok, true)
  assert.equal(r.deletedCount, 2)
  // 1.0.0 无实体文件 → freed 按元数据 unpackedSize 兜底；1.1.0 按真实 tgz
  assert.equal(r.freedBytes, 1024 + MB)
  assert.deepEqual(listFilesIn(path.join(storage, 'ghost')), ['1.2.0.tgz', 'package.json'])
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：包不存在与元数据损坏均安全返回失败，不做任何修改', () => {
  const storage = tmpDir('vcm-clean-')
  assert.equal(cleanPackage(storage, 'no-such', 1).ok, false)
  // package.json 是目录 → existsSync 通过但读取抛错 → 返回「读取元数据失败」
  const badDir = path.join(storage, 'badpkg')
  fs.mkdirSync(path.join(badDir, 'package.json'), { recursive: true })
  const r = cleanPackage(storage, 'badpkg', 1)
  assert.equal(r.ok, false)
  assert.match(r.message, /元数据失败/)
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— deleteSingleVersion ——
test('deleteSingleVersion：删除中间版本，其余版本与 latest 完好', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const r = deleteSingleVersion(storage, 'lodash', '1.2.0')
  assert.equal(r.ok, true)
  assert.equal(r.freedSpace, '1.0 MB')
  const dir = path.join(storage, 'lodash')
  assert.deepEqual(listFilesIn(dir), ['1.0.0.tgz', '1.1.0.tgz', '1.3.0.tgz', '1.4.0.tgz', 'package.json'])
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(meta.versions).sort(), ['1.0.0', '1.1.0', '1.3.0', '1.4.0'])
  assert.equal(meta['dist-tags'].latest, '1.4.0')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('deleteSingleVersion：删除 latest 指向的版本时重定向到剩余最新', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['pkg-c'], buildMeta('pkg-c', ['1.0.0', '1.1.0']))
  const r = deleteSingleVersion(storage, 'pkg-c', '1.1.0')
  assert.equal(r.ok, true)
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'pkg-c', 'package.json'), 'utf8'))
  assert.equal(meta['dist-tags'].latest, '1.0.0')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('deleteSingleVersion：不存在的版本/包安全失败', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  assert.equal(deleteSingleVersion(storage, 'lodash', '9.9.9').ok, false)
  assert.equal(deleteSingleVersion(storage, 'no-such', '1.0.0').ok, false)
  fs.rmSync(storage, { recursive: true, force: true })
})

test('deleteSingleVersion：删掉唯一版本后 versions 为空，dist-tags 清空（不指向幽灵版本）', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['solo'], buildMeta('solo', ['1.0.0']))
  const r = deleteSingleVersion(storage, 'solo', '1.0.0')
  assert.equal(r.ok, true)
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'solo', 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(meta.versions), [])
  assert.deepEqual(meta['dist-tags'], {}, 'latest 指向已删版本是损坏元数据，应清空（对齐 npm unpublish 全量行为）')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('cleanPackage：keep=0 全删（纯函数层边界）——versions/time/dist-tags 全空', () => {
  const storage = tmpDir('vcm-clean-')
  writePkg(storage, ['allgone'], buildMeta('allgone', ['1.0.0', '1.1.0']))
  const r = cleanPackage(storage, 'allgone', 0)
  assert.equal(r.ok, true)
  assert.equal(r.deletedCount, 2)
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'allgone', 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(meta.versions), [])
  assert.deepEqual(meta['dist-tags'], {}, 'slice(-0) 陷阱已修复：全删时标签清空而非指向已删版本')
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— scanStorageAsync：扫描与来源识别（生产唯一扫描路径，同步版已删除） ——
test('scanStorageAsync：版本数/大小/latest/排序正确，无 _uplinks 判定为私有包', async () => {
  const storage = tmpDir('vcm-scan-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const pkgs = await scanStorageAsync(storage)
  assert.equal(pkgs.length, 1)
  const p = pkgs[0]
  assert.equal(p.name, 'lodash')
  assert.equal(p.versions, 5)
  assert.equal(p.size, 5)
  assert.equal(p.latest, '1.4.0')
  assert.equal(p.origin, 'private')
  assert.deepEqual(p.versionsDetail.map(v => v.version), VERSIONS)
  assert.ok(p.versionsDetail.every(v => v.size === 1))
  fs.rmSync(storage, { recursive: true, force: true })
})

test('scanStorageAsync：_uplinks 非空判定为代理缓存包', async () => {
  const storage = tmpDir('vcm-scan-')
  writePkg(storage, ['vue'], buildMeta('vue', ['1.0.0'], { uplinks: { npmjs: { etag: 'x' } } }))
  assert.equal((await scanStorageAsync(storage))[0].origin, 'proxy')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('scanStorageAsync：scoped 包名解析为 @scope/name', async () => {
  const storage = tmpDir('vcm-scan-')
  writePkg(storage, ['@antv', 'g2'], buildMeta('@antv/g2', ['1.0.0']))
  const pkgs = await scanStorageAsync(storage)
  assert.equal(pkgs.length, 1)
  assert.equal(pkgs[0].name, '@antv/g2')
  fs.rmSync(storage, { recursive: true, force: true })
})

test('scanStorageAsync：元数据缺失/损坏标记 broken，占用按物理 tgz 计算，不影响其他包', async () => {
  const storage = tmpDir('vcm-scan-')
  writePkg(storage, ['good'], buildMeta('good', ['1.0.0']))
  const badDir = path.join(storage, 'brokenpkg')
  fs.mkdirSync(badDir, { recursive: true })
  fs.writeFileSync(path.join(badDir, 'brokenpkg-1.0.0.tgz'), Buffer.alloc(2 * MB, 7))
  const pkgs = await scanStorageAsync(storage)
  assert.equal(pkgs.length, 2)
  const bad = pkgs.find(p => p.status === 'broken')
  assert.equal(bad.name, 'brokenpkg')
  assert.equal(bad.versions, 0)
  assert.equal(bad.size, 2)
  assert.ok(pkgs.some(p => p.name === 'good' && p.status !== 'broken'))
  fs.rmSync(storage, { recursive: true, force: true })
})

test('scanStorageAsync：元数据有版本但无实体 tgz 不计入版本数（防版本数虚高）', async () => {
  const storage = tmpDir('vcm-scan-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS), { skipTgz: ['1.0.0', '1.1.0'] })
  const p = (await scanStorageAsync(storage))[0]
  assert.equal(p.versions, 3)
  assert.deepEqual(p.versionsDetail.map(v => v.version), ['1.2.0', '1.3.0', '1.4.0'])
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— scanStorageAsync：clean 后增量缓存失效（删除后重扫无幽灵版本） ——
test('scanStorageAsync：cleanPackage 之后增量重扫反映删除结果（缓存不残留）', async () => {
  clearPkgCache()
  const storage = tmpDir('vcm-scan-async-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const first = await scanStorageAsync(storage)
  assert.equal(first.length, 1)
  assert.equal(first[0].versions, 5)
  // 清理 3 个最旧版本（真实调用删除逻辑）
  const r = cleanPackage(storage, 'lodash', 2)
  assert.equal(r.ok, true)
  // 不清缓存直接重扫：目录 mtime 变化应触发重扫，结果与删除一致
  const second = await scanStorageAsync(storage)
  assert.equal(second.length, 1)
  assert.equal(second[0].versions, 2)
  assert.deepEqual(second[0].versionsDetail.map(v => v.version), ['1.3.0', '1.4.0'])
  assert.equal(second[0].size, 2)
  // 与清缓存后的全新扫描结果一致
  clearPkgCache()
  const fresh = await scanStorageAsync(storage)
  assert.deepEqual(
    { v: second[0].versions, s: second[0].size },
    { v: fresh[0].versions, s: fresh[0].size },
  )
  clearPkgCache()
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— 指纹不靠 mtime 单独说话：时间戳停在同一刻度时，删除仍必须被重扫看见 ——
// Windows 上实测过：清理后 dir/package.json 的 mtimeMs 与缓存值完全相等，只看 mtime 就命中缓存、
// 返回幽灵版本数。这里先把时间戳钉成整毫秒再扫，清理后原样钉回，稳定复现「mtime 未推进」
test('scanStorageAsync：mtime 未推进时按元数据字节数与目录项数失效缓存', async () => {
  clearPkgCache()
  const storage = tmpDir('vcm-tick-')
  const pkgDir = path.join(storage, 'lodash')
  const pkgFile = path.join(pkgDir, 'package.json')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const metaStamp = 1793900000000
  const dirStamp = metaStamp + 1000
  fs.utimesSync(pkgFile, new Date(metaStamp), new Date(metaStamp))
  fs.utimesSync(pkgDir, new Date(dirStamp), new Date(dirStamp))

  const first = await scanStorageAsync(storage)
  assert.equal(first[0].versions, 5)
  assert.equal(fs.statSync(pkgDir).mtimeMs, dirStamp)

  assert.equal(cleanPackage(storage, 'lodash', 2).ok, true)
  fs.utimesSync(pkgFile, new Date(metaStamp), new Date(metaStamp))
  fs.utimesSync(pkgDir, new Date(dirStamp), new Date(dirStamp))
  // 前提断言：mtime 确实回到了缓存里的那个刻度，否则本用例守不住任何东西
  assert.equal(fs.statSync(pkgDir).mtimeMs, dirStamp)
  assert.equal(fs.statSync(pkgFile).mtimeMs, metaStamp)

  const second = await scanStorageAsync(storage)
  assert.equal(second[0].versions, 2)
  assert.deepEqual(second[0].versionsDetail.map(v => v.version), ['1.3.0', '1.4.0'])
  clearPkgCache()
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— 反向守：加了失效判据不能把缓存本身写没（大目录靠复用省掉元数据解析） ——
test('scanStorageAsync：目录无变化时复用增量缓存（返回同一对象引用）', async () => {
  clearPkgCache()
  const storage = tmpDir('vcm-reuse-')
  writePkg(storage, ['lodash'], buildMeta('lodash', VERSIONS))
  const first = await scanStorageAsync(storage)
  const second = await scanStorageAsync(storage)
  assert.equal(second[0], first[0], '未变化的包应命中缓存，返回同一 pkg 对象')
  clearPkgCache()
  fs.rmSync(storage, { recursive: true, force: true })
})

// —— 集成回归：clean → rescan 全链路一致性 ——
test('集成：清理后重扫——版本数/大小/物理文件与 clean 返回值一致，无幽灵版本', async () => {
  const storage = tmpDir('vcm-int-')
  writePkg(storage, ['pkg-x'], buildMeta('pkg-x', VERSIONS, { uplinks: { npmjs: { etag: 'x' } } }))
  const before = (await scanStorageAsync(storage))[0]
  assert.equal(before.versions, 5)
  assert.equal(before.origin, 'proxy')
  const r = cleanPackage(storage, 'pkg-x', 2)
  assert.equal(r.ok, true)
  const after = (await scanStorageAsync(storage))[0]
  assert.equal(after.versions, r.deletedCount === 3 ? 2 : -1)
  assert.deepEqual(after.versionsDetail.map(v => v.version), ['1.3.0', '1.4.0'])
  assert.equal(after.size, 2)
  // 物理目录与元数据最终一致
  assert.deepEqual(listFilesIn(path.join(storage, 'pkg-x')), ['1.3.0.tgz', '1.4.0.tgz', 'package.json'])
  fs.rmSync(storage, { recursive: true, force: true })
})