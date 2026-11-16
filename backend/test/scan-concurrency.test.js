/**
 * 扫描并发正确性 —— README「懒扫描/并发保护」这条承诺的落地守护
 * 根因：扫描完成时无条件清 dirty，会把飞行期间写操作的失效标记一起吞掉，
 * 于是「删了等于没删」，列表要等到下一次定时扫描才纠正。
 * 修法是世代比对（scan-manager.js invalidationEpoch），因此这里守的是：
 * ① 飞行中的失效标记必须活过本次扫描；② 删除在扫描期间照常生效（不再被忙态拒绝）；
 * ③ 标记活下来之后，下一次请求就能收敛到删除后的快照（不必等定时扫描）；
 * ④ POST /api/scan 的重入保护仍然有效（忙态 200 + code SCANNING）。
 * 走真实 app.js 接线 + 真实 storage 目录，断文件与断列表，不只断响应形状。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousEnv = Object.fromEntries(['DATA_DIR', 'VCM_DEMO', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]))
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-conc-data-'))
process.env.VCM_DEMO = '0'
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-conc-storage-'))
process.env.VERDACCIO_STORAGE = storage

const { app } = await import('../app.js')
const { default: db } = await import('../db.js')
const { scanState, runScanAsync, invalidateScan } = await import('../scan-manager.js')

const srv = app.listen(0, '127.0.0.1')
await new Promise(resolve => srv.once('listening', resolve))
const base = `http://127.0.0.1:${srv.address().port}`

const VERSIONS = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0']
const pkgDir = path.join(storage, 'lodash')

/** 重建 5 个版本的包（用例之间复位现场，避免相互污染） */
function seedPkg() {
  fs.rmSync(pkgDir, { recursive: true, force: true })
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: 'lodash',
    versions: Object.fromEntries(VERSIONS.map(v => [v, {
      name: 'lodash', version: v, dist: { tarball: `lodash/-/${v}.tgz`, unpackedSize: 1024 },
    }])),
    time: Object.fromEntries(VERSIONS.map((v, i) => [v, `2026-01-0${i + 1}T00:00:00.000Z`])),
    'dist-tags': { latest: VERSIONS[VERSIONS.length - 1] },
  }, null, 2))
  for (const v of VERSIONS) fs.writeFileSync(path.join(pkgDir, `${v}.tgz`), Buffer.alloc(1024 * 1024, 7))
}
seedPkg()

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '666666' }),
})
const { token } = await login.json()

async function call(route, opts = {}) {
  const r = await fetch(`${base}/api${route}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  })
  return { status: r.status, data: await r.json() }
}

const cleanBody = (keep) => ({ method: 'POST', body: JSON.stringify({ pkgName: 'lodash', keep }) })
const tgzCount = () => fs.readdirSync(pkgDir).filter(f => f.endsWith('.tgz')).length
const versionsOf = (list, name = 'lodash') => list.find(p => p.name === name)?.versions ?? null

/** 等当前扫描收尾（不跨越 ensureScan 的触发时机） */
async function waitScanEnds(timeoutMs = 15000) {
  const t0 = Date.now()
  while (scanState.scanning) {
    if (Date.now() - t0 > timeoutMs) throw new Error('扫描未在预期时间内结束')
    await new Promise(r => setTimeout(r, 10))
  }
}

test.after(() => {
  srv.close()
  try { db.close() } catch { /* 已关闭 */ }
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  try { fs.rmSync(storage, { recursive: true, force: true }) } catch { /* 同上 */ }
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('扫描飞行期间的失效标记不被本次扫描吞掉（世代比对）', async () => {
  // runScanAsync 同步跑到第一个 IO await 才让出，此处 invalidateScan 必然落在飞行窗口内
  const flight = runScanAsync()
  invalidateScan()
  await flight
  assert.equal(scanState.scanning, false)
  assert.equal(scanState.dirty, true, '扫描完成不得清掉飞行期间新置的失效标记')
})

test('扫描进行中删除照常生效（不再被忙态拒绝），且标记活到扫描结束', async () => {
  seedPkg()
  scanState.dirty = false
  const flight = runScanAsync()
  const { status, data } = await call('/clean', cleanBody(2))
  await flight
  assert.equal(status, 200)
  assert.equal(data.ok, true, `删除不应被忙态拒绝：${JSON.stringify(data)}`)
  assert.notEqual(data.code, 'SCANNING')
  assert.equal(data.deletedCount, VERSIONS.length - 2)
  assert.equal(tgzCount(), 2, '清理必须真的落盘')
  assert.equal(scanState.dirty, true, '飞行中的删除标记必须保留到下一次重建')
})

test('标记保留后下一次请求即收敛到删除后的快照（不必等定时扫描）', async () => {
  assert.equal(scanState.scanning, false)
  const first = await call('/packages') // dirty 缓存 → 触发懒重扫，本次响应仍取自旧快照
  assert.equal(first.data.scanning, true, 'dirty 标记必须让下一次请求发起重建')
  await waitScanEnds()
  const second = await call('/packages')
  assert.equal(second.data.scanning, false)
  assert.equal(versionsOf(second.data.packages), 2, '重建后必须反映已删除的版本')
  assert.equal(scanState.dirty, false, '无新失效时重建完成应清零 dirty')
})

test('忙态重扫仍走重入保护：HTTP 200 + code SCANNING', async () => {
  scanState.scanning = true
  try {
    const { status, data } = await call('/scan', { method: 'POST' })
    assert.equal(status, 200)
    assert.equal(data.ok, false)
    assert.equal(data.code, 'SCANNING')
    assert.equal(data.scanning, true)
    assert.ok(data.message)
  } finally {
    scanState.scanning = false
  }
})

test('单版本删除接口不因扫描忙被挡（守卫已撤出删除面）', async () => {
  seedPkg()
  scanState.scanning = true
  try {
    const { status, data } = await call('/packages/lodash/versions/1.0.0', { method: 'DELETE' })
    assert.equal(status, 200)
    assert.equal(data.ok, true, `单版本删除不应被忙态拒绝：${JSON.stringify(data)}`)
    assert.equal(fs.existsSync(path.join(pkgDir, '1.0.0.tgz')), false, '版本文件必须被删除')
  } finally {
    scanState.scanning = false
  }
})

test('非扫描期清理照常生效（回归基线）', async () => {
  seedPkg()
  scanState.dirty = false
  const { status, data } = await call('/clean', cleanBody(3))
  assert.equal(status, 200)
  assert.equal(data.ok, true, data.message)
  assert.equal(data.deletedCount, VERSIONS.length - 3)
  assert.equal(tgzCount(), 3)
})
