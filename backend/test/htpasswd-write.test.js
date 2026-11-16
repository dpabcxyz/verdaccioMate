/**
 * htpasswd 写路径测试 —— 高危操作（写 原版 Verdaccio 用户文件）此前零覆盖
 * 覆盖：候选路径解析、行解析、用户增/改密/删/Verdaccio Mate 内置账号同步（纯函数层）+ HTTP 路由层（真实 express）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousEnv = Object.fromEntries(
  ['DATA_DIR', 'VCM_USERNAME', 'VCM_DEMO', 'VERDACCIO_HTPASSWD', 'VERDACCIO_STORAGE'].map(k => [k, process.env[k]]),
)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-htp-data-'))
process.env.VCM_DEMO = '1'
delete process.env.VERDACCIO_STORAGE
delete process.env.VERDACCIO_HTPASSWD

const {
  resolveHtpasswdFile, readHtpasswd, validateUsername, validatePassword,
  verifyHtpasswdPassword, addHtpasswdUser, updateHtpasswdPassword,
  removeHtpasswdUser, ensureBuiltinUser,
} = await import('../htpasswd.js')
const { authRouter, authMiddleware } = await import('../routes/auth.js')
const { default: db } = await import('../db.js')
const express = (await import('express')).default

let htpasswdFile

test.beforeEach(() => {
  // 每条用例独立 htpasswd 文件（空文件起步）
  htpasswdFile = path.join(os.tmpdir(), `vcm-htp-${Date.now()}-${Math.random().toString(36).slice(2)}.htpasswd`)
  fs.writeFileSync(htpasswdFile, '')
  process.env.VERDACCIO_HTPASSWD = htpasswdFile
})

test.afterEach(() => {
  try { fs.rmSync(htpasswdFile, { force: true }) } catch {}
})

test.after(() => {
  try { db.close() } catch {}
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch {}
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** 读取文件中指定用户的原始行（name:hash:meta 格式，字段名无关断言用） */
function lineOf(name) {
  return fs.readFileSync(htpasswdFile, 'utf8').split('\n').find(l => l.startsWith(`${name}:`)) || null
}

// —— 路径解析 ——
test('resolveHtpasswdFile：环境变量优先', () => {
  assert.equal(resolveHtpasswdFile(), htpasswdFile)
})

// —— 行解析 ——
test('readHtpasswd：解析 bcrypt 行与 meta，跳过异常行，文件缺失返回 null', () => {
  const rows = [
    'tester1:$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy:autocreated 2026-01-01',
    '# 注释行',
    'broken-line-no-hash',
    'tester2:{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=',
  ]
  fs.writeFileSync(htpasswdFile, rows.join('\n') + '\n')
  const data = readHtpasswd()
  assert.ok(data?.enabled !== false)
  assert.equal(data.file, htpasswdFile)
  const names = data.users.map(u => u.name)
  assert.deepEqual(names, ['tester1', 'tester2'])
  assert.equal(data.users[0].algo, '2y')
  assert.match(data.users[0].meta, /autocreated/)
  assert.equal(data.users[1].algo, 'SHA')
  // 文件缺失 → null（调用方据此返回「未找到 htpasswd」）
  fs.rmSync(htpasswdFile, { force: true })
  assert.equal(readHtpasswd(), null)
})

// —— 校验 ——
test('validateUsername/validatePassword：空值与非法输入返回错误信息', () => {
  assert.ok(validateUsername(''), '空用户名应被拦截')
  assert.ok(validateUsername('has space'), '含空格用户名应被拦截')
  assert.ok(validatePassword('abc'), '过短密码应被拦截')
})

// —— 增 / 改密 / 删 ——
test('addHtpasswdUser：成功写入 bcrypt 行；重复与文件缺失安全失败', () => {
  const r = addHtpasswdUser('tester1', 'secret123')
  assert.equal(r.ok, true)
  const content = fs.readFileSync(htpasswdFile, 'utf8')
  assert.match(content, /tester1:\$2[aby]\$/, '应为 bcrypt 哈希行')
  assert.ok(!fs.existsSync(htpasswdFile + '.tmp'), '原子写不应残留 tmp 文件')
  const dup = addHtpasswdUser('tester1', 'secret123')
  assert.equal(dup.ok, false, '重复用户应被拦截')
  fs.rmSync(htpasswdFile, { force: true })
  const missing = addHtpasswdUser('tester2', 'secret123')
  assert.equal(missing.ok, false, 'htpasswd 文件不存在应报错而非自动创建')
})

test('updateHtpasswdPassword：改密后哈希变化、meta 保留；用户不存在安全失败', () => {
  addHtpasswdUser('tester1', 'secret123')
  const lineBefore = lineOf('tester1')
  assert.ok(lineBefore)
  const r = updateHtpasswdPassword('tester1', 'newsecret456')
  assert.equal(r.ok, true)
  const lineAfter = lineOf('tester1')
  assert.ok(lineAfter)
  // 字段名无关断言：行格式 name:hash:meta，直接比对哈希段与 meta 段
  assert.notEqual(lineBefore.split(':')[1], lineAfter.split(':')[1], '哈希段应已更新')
  assert.equal(
    lineBefore.split(':').slice(2).join(':'),
    lineAfter.split(':').slice(2).join(':'),
    'meta 应保留',
  )
  const missing = updateHtpasswdPassword('ghost', 'newsecret456')
  assert.equal(missing.ok, false)
})

test('removeHtpasswdUser：删除生效；不存在安全失败', () => {
  addHtpasswdUser('tester1', 'secret123')
  assert.equal(removeHtpasswdUser('tester1').ok, true)
  assert.ok(!readHtpasswd().users.some(u => u.name === 'tester1'))
  assert.equal(removeHtpasswdUser('tester1').ok, false, '重复删除应报用户不存在')
})

// —— Verdaccio Mate 内置账号同步 ——
test('ensureBuiltinUser：缺失则补写 Verdaccio Mate 内置账号，重复调用幂等', () => {
  const first = ensureBuiltinUser()
  assert.equal(first.ok, true)
  assert.equal(first.added, true, '空文件应补写 Verdaccio Mate 内置账号')
  assert.ok(readHtpasswd().users.some(u => u.name === 'admin'))
  const second = ensureBuiltinUser()
  assert.equal(second.added, false, '已存在时不应重复添加')
  assert.match(second.message, /已存在同名用户，同步跳过/, '跳过提示应说明同名存在且不覆盖密码')
})

// —— 验证 ——
test('verifyHtpasswdPassword：正确密码通过、错误密码拒绝', () => {
  addHtpasswdUser('tester1', 'secret123')
  assert.equal(verifyHtpasswdPassword('tester1', 'secret123').ok, true)
  assert.equal(verifyHtpasswdPassword('tester1', 'wrongpass').ok, false)
})

// —— HTTP 路由层（真实 express + Verdaccio Mate 内置账号登录链路） ——
test('htpasswd REST 路由：增/改密/删走通，删除当前登录账号被拦', async t => {
  const mini = express()
  mini.use(express.json())
  mini.use('/api', authRouter)
  mini.use('/api', authMiddleware)
  const srv = mini.listen(0, '127.0.0.1')
  await new Promise(resolve => srv.once('listening', resolve)) // listen(0) 异步绑定，等端口就绪
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${srv.address().port}`

  // 未登录 → 401（authMiddleware 显式挂载生效）
  const anon = await fetch(`${base}/api/htpasswd/users`)
  assert.equal(anon.status, 401)

  // 登录拿 token（Verdaccio Mate 内置账号 admin/666666）
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '666666' }),
  })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  // 列表（只读）
  const list = await fetch(`${base}/api/htpasswd/users`, { headers: auth })
  assert.equal(list.status, 200)
  assert.equal((await list.json()).ok, true)

  // 新增
  const add = await fetch(`${base}/api/htpasswd/users`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: 'routetester', password: 'secret123' }),
  })
  assert.equal(add.status, 200)
  assert.ok(fs.readFileSync(htpasswdFile, 'utf8').includes('routetester:'))

  // 改密
  const reset = await fetch(`${base}/api/htpasswd/users/routetester/password`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ password: 'newsecret456' }),
  })
  assert.equal(reset.status, 200)
  assert.equal(verifyHtpasswdPassword('routetester', 'newsecret456').ok, true)

  // 删除当前登录账号被拦（防自锁保护）
  const selfDelete = await fetch(`${base}/api/htpasswd/users/admin`, { method: 'DELETE', headers: auth })
  assert.equal(selfDelete.status, 400)

  // 删除普通用户
  const del = await fetch(`${base}/api/htpasswd/users/routetester`, { method: 'DELETE', headers: auth })
  assert.equal(del.status, 200)
  assert.ok(!fs.readFileSync(htpasswdFile, 'utf8').includes('routetester:'))
})