/**
 * 共用出站 JSON 客户端 net.js —— 退避策略与错误文案口径
 * 重点守两类串味：服务端明确回了错误码（响应 4xx/5xx）不能被写成「连接失败」，
 * 否则失败列表里的文案会把排障带到网络方向（这条曾经真实发生在拉包路径上）。
 * 退避等待用 sleepFn 注入记录，不真实等待；fetch 用序列 mock，不依赖网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchJson, RATE_LIMIT_BACKOFF_MAX } from '../net.js'

const realFetch = globalThis.fetch
test.afterEach(() => { globalThis.fetch = realFetch })

/** fetch 按 statuses 顺序返回（超出序列后重复最后一个），返回调用记录 */
function mockFetchSequence(statuses, { body = { ok: true }, brokenJson = false } = {}) {
  const calls = []
  let i = 0
  globalThis.fetch = async url => {
    calls.push(url)
    const status = Array.isArray(statuses) ? statuses[Math.min(i++, statuses.length - 1)] : statuses
    return {
      status,
      ok: status >= 200 && status < 300,
      json: brokenJson ? async () => { throw new SyntaxError('Unexpected end of JSON input') } : async () => body,
    }
  }
  return calls
}

const recordSleep = () => {
  const sleeps = []
  return { sleeps, sleepFn: async ms => { sleeps.push(ms) } }
}

test('429 后 200——退避 2s 重试一次成功', async () => {
  const calls = mockFetchSequence([429, 200])
  const { sleeps, sleepFn } = recordSleep()
  const data = await fetchJson('http://registry.test/pkg', 1000, { sleepFn, label: '私服' })
  assert.deepEqual(data, { ok: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [2000])
})

test('5xx 同样走指数退避', async () => {
  const calls = mockFetchSequence([500, 200])
  const { sleeps, sleepFn } = recordSleep()
  const data = await fetchJson('http://registry.test/pkg', 1000, { sleepFn, label: '私服' })
  assert.deepEqual(data, { ok: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [2000])
})

test('连续 429 超过 maxBackoff 抛错，退避间隔指数增长', async () => {
  const calls = mockFetchSequence([429])
  const { sleeps, sleepFn } = recordSleep()
  await assert.rejects(fetchJson('http://registry.test/pkg', 1000, { sleepFn, maxBackoff: 2, label: '私服' }), /已重试 2 次/)
  assert.equal(calls.length, 3) // 首次 + 2 次重试
  assert.deepEqual(sleeps, [2000, 4000])
})

test('默认退避上限 8 次（最高单次 256s）', () => {
  assert.equal(RATE_LIMIT_BACKOFF_MAX, 8)
})

test('404 返回 null 不重试（业务上的不存在）', async () => {
  const calls = mockFetchSequence([404])
  const { sleeps, sleepFn } = recordSleep()
  assert.equal(await fetchJson('http://registry.test/pkg', 1000, { sleepFn, label: '私服' }), null)
  assert.equal(calls.length, 1)
  assert.deepEqual(sleeps, [])
})

test('非重试状态（400）立即抛错', async () => {
  const calls = mockFetchSequence([400])
  const { sleeps, sleepFn } = recordSleep()
  await assert.rejects(fetchJson('http://registry.test/pkg', 1000, { sleepFn, label: '私服' }), /私服响应 400/)
  assert.equal(calls.length, 1)
  assert.deepEqual(sleeps, [])
})

test('协议错误不得包装成连接失败（排障方向串味守护）', async () => {
  mockFetchSequence([400])
  const { sleepFn } = recordSleep()
  const err = await fetchJson('http://registry.test/pkg', 1000, { sleepFn, label: '私服' }).catch(e => e)
  assert.match(err.message, /^私服响应 400$/)
  assert.doesNotMatch(err.message, /连接失败/)
})

test('退避耗尽的错误同样不带「连接失败」前缀', async () => {
  mockFetchSequence([503])
  const { sleepFn } = recordSleep()
  const err = await fetchJson('http://registry.test/x', 1000, { sleepFn, maxBackoff: 1, label: '接口' }).catch(e => e)
  assert.equal(err.message, '接口响应 503（已重试 1 次）')
})

test('传输层失败才说连接失败，并解开 cause.reason 的真实 errno', async () => {
  globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { reason: 'ECONNREFUSED' } }) }
  const err = await fetchJson('http://127.0.0.1:1/pkg', 1000, { label: '私服' }).catch(e => e)
  assert.equal(err.message, '私服连接失败：fetch failed（ECONNREFUSED）')
})

test('响应体不是 JSON 时报解析失败，而不是原始 SyntaxError', async () => {
  mockFetchSequence([200], { brokenJson: true })
  const err = await fetchJson('http://registry.test/pkg', 1000, { label: '私服' }).catch(e => e)
  assert.equal(err.message, '私服响应体解析失败')
})

test('超时中止报请求超时，不混入连接失败', async () => {
  globalThis.fetch = async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) }
  const err = await fetchJson('http://registry.test/pkg', 1000, { label: '私服' }).catch(e => e)
  assert.equal(err.message, '请求超时')
})

test('maxBackoff: 0（best-effort 调用）遇限流立即放弃，不重试', async () => {
  const calls = mockFetchSequence([429])
  const { sleeps, sleepFn } = recordSleep()
  const err = await fetchJson('https://ipinfo.io/json', 1000, { sleepFn, maxBackoff: 0, label: '定位接口' }).catch(e => e)
  assert.equal(err.message, '定位接口响应 429') // 不带「已重试 0 次」这种无信息尾巴
  assert.equal(calls.length, 1)
  assert.deepEqual(sleeps, [])
})
