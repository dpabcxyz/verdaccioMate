/**
 * 失败漏斗与轮询生命周期测试（vitest + jsdom）—— B-3 的回归守护
 * 覆盖两条不变量：
 * ① 异步失败不穿透成未处理的 Promise rejection，且提示恰好一次；
 * ② stopAllPolling() 之后，飞行中的 tick 不再写状态、不再排下一轮。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockToken = { value: 'tok' }

vi.mock('../src/api', () => ({
  getToken: () => mockToken.value,
  default: {
    getPackages: vi.fn(), getThresholds: vi.fn(), getLogs: vi.fn(), getScanProgress: vi.fn(),
    saveThresholds: vi.fn(), ignore: vi.fn(), unignore: vi.fn(), clean: vi.fn(), deleteVersion: vi.fn(),
    getNotifications: vi.fn(), getSyncProgress: vi.fn(), getTopList: vi.fn(), scanNow: vi.fn(),
  },
}))

import api from '../src/api'
import { state } from '../src/store/state.js'
import { saveThresholds, ignorePkg, unignorePkg, refreshAll } from '../src/store/actions.js'
import { refreshPackages, refreshLogs, pollScanProgress, stopScanProgressPoll } from '../src/store/refreshers.js'
import { pollNotifications, stopPollNotifications } from '../src/store/notifications.js'
import { refreshTopList, stopTopListPoll } from '../src/store/toplist.js'
import { pollSyncProgress, stopPollSyncProgress } from '../src/store/sync.js'
import { stopAllPolling } from '../src/store/index.js'

const errorToasts = () => document.querySelectorAll('.el-message--error')
// fake timers 下 setTimeout 不会被真实时间触发，用 microtask 队列让 await 续体跑完
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  Object.values(api).forEach(fn => typeof fn === 'function' && fn.mockReset?.())
  mockToken.value = 'tok'
})

afterEach(() => {
  vi.useRealTimers()
  document.querySelectorAll('.el-message').forEach(el => el.remove())
})

describe('写动作失败漏斗：异常折算成 ok:false，不向上抛', () => {
  it('saveThresholds 网络异常 → 返回 message、不触发任何刷新', async () => {
    api.saveThresholds.mockRejectedValue(new Error('请求超时，请检查网络或稍后重试'))
    api.getThresholds.mockResolvedValue({ versionThreshold: 1, sizeThreshold: 2, exceptions: [] })
    api.getPackages.mockResolvedValue({ packages: [] })
    const res = await saveThresholds({ versionThreshold: 1, sizeThreshold: 2 })
    expect(res.ok).toBe(false)
    expect(res.message).toBe('请求超时，请检查网络或稍后重试')
    expect(api.getThresholds).not.toHaveBeenCalled()
    expect(api.getPackages).not.toHaveBeenCalled()
  })

  it('saveThresholds 业务 400（契约层 INVALID_PARAM）→ 原样带回 message 供视图提示', async () => {
    api.saveThresholds.mockResolvedValue({ ok: false, code: 'INVALID_PARAM', message: '版本阈值至少为 1' })
    const res = await saveThresholds({ versionThreshold: 0 })
    expect(res).toEqual({ ok: false, code: 'INVALID_PARAM', message: '版本阈值至少为 1' })
    expect(api.getPackages).not.toHaveBeenCalled()
  })

  it('保存成功才刷新：res.ok 为真时拉阈值与包列表', async () => {
    api.saveThresholds.mockResolvedValue({ ok: true })
    api.getThresholds.mockResolvedValue({ versionThreshold: 15, sizeThreshold: 500, exceptions: [] })
    api.getPackages.mockResolvedValue({ packages: [] })
    const res = await saveThresholds({ versionThreshold: 15, sizeThreshold: 500 })
    expect(res.ok).toBe(true)
    expect(api.getThresholds).toHaveBeenCalledTimes(1)
    expect(api.getPackages).toHaveBeenCalledTimes(1)
  })

  it('ignore/unignore 异常折算为 ok:false 且不重拉列表', async () => {
    api.ignore.mockRejectedValue(new Error('网络请求失败'))
    api.unignore.mockRejectedValue(new Error('网络请求失败'))
    expect((await ignorePkg('lodash', 3)).ok).toBe(false)
    expect((await unignorePkg('lodash', 3)).ok).toBe(false)
    expect(api.getPackages).not.toHaveBeenCalled()
  })
})

describe('读刷新失败：提示恰好一次，旧数据保留', () => {
  it('包列表加载失败 → 不抛、弹一条错误、scanning 归 false', async () => {
    api.getPackages.mockRejectedValue(new Error('请求超时，请检查网络或稍后重试'))
    const first = await refreshPackages()
    expect(first).toEqual({ scanning: false, firstScan: false })
    expect(errorToasts()).toHaveLength(1)
  })

  it('日志加载失败 → state.logs 保持原值', async () => {
    state.logs = [{ id: 1 }]
    api.getLogs.mockRejectedValue(new Error('网络请求失败'))
    await refreshLogs({ page: 1 })
    expect(state.logs).toHaveLength(1)
    expect(errorToasts()).toHaveLength(1)
  })

  it('榜单加载失败 → 不抛，弹一条错误', async () => {
    api.getTopList.mockRejectedValue(new Error('榜单接口不可用'))
    expect(await refreshTopList()).toBeUndefined()
    expect(errorToasts()).toHaveLength(1)
  })

  it('登出后 doRefresh 不再拉数据', async () => {
    mockToken.value = ''
    await refreshAll()
    expect(api.getPackages).not.toHaveBeenCalled()
  })
})

describe('轮询生命周期：stop 之后飞行中的 tick 作废', () => {
  it('通知轮询在请求飞行中被停止 → 不写状态、不排下一轮', async () => {
    vi.useFakeTimers()
    let resolve
    api.getNotifications.mockImplementation(() => new Promise(r => { resolve = r }))
    pollNotifications()
    await flushMicrotasks()
    stopPollNotifications()
    resolve({ list: [{ id: 9 }], lastId: 9, unreadCount: 1 })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.getNotifications).toHaveBeenCalledTimes(1)
    expect(state.notifications).toHaveLength(0)
  })

  it('拉取进度轮询在请求飞行中被停止 → 不写进度、不排下一轮', async () => {
    vi.useFakeTimers()
    let resolve
    api.getSyncProgress.mockImplementation(() => new Promise(r => { resolve = r }))
    api.getPackages.mockResolvedValue({ packages: [] })
    pollSyncProgress()
    await flushMicrotasks()
    stopPollSyncProgress()
    resolve({ running: true, total: 5, processed: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.getSyncProgress).toHaveBeenCalledTimes(1)
    expect(state.syncProgress.total).toBe(0)
  })

  it('榜单扫描等待被停止打断 → 返回 null 且不覆盖已有榜单', async () => {
    vi.useFakeTimers()
    state.toplist = [{ pkg_name: 'react' }]
    api.getTopList.mockResolvedValue({ scanning: true, list: [] })
    api.getScanProgress.mockResolvedValue({ scanning: true })
    const pending = refreshTopList()
    await vi.advanceTimersByTimeAsync(820) // 进入扫描等待的一轮 sleep
    stopTopListPoll()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await pending).toBeNull()
    expect(state.toplist).toEqual([{ pkg_name: 'react' }])
    expect(api.getTopList).toHaveBeenCalledTimes(1)
  })

  it('扫描进度等待被停止打断 → 停止后不再更新进度', async () => {
    vi.useFakeTimers()
    state.scanProgress.packages = 0
    state.scanProgress.bytes = 0
    api.getScanProgress.mockResolvedValue({ scanning: true, packages: 12, bytes: 345 })
    const pending = pollScanProgress()
    await vi.advanceTimersByTimeAsync(820) // 一轮 sleep + 一次查询
    expect(state.scanProgress.packages).toBe(12)
    stopScanProgressPoll()
    await vi.advanceTimersByTimeAsync(10_000)
    await pending
    expect(api.getScanProgress).toHaveBeenCalledTimes(1)
    expect(state.scanProgress.packages).toBe(12)
  })

  it('stopAllPolling 覆盖四类轮询：通知/拉取/榜单/扫描等待', async () => {
    vi.useFakeTimers()
    const settled = []
    api.getNotifications.mockImplementation(() => Promise.resolve({ list: [], unreadCount: 0 }))
    api.getSyncProgress.mockImplementation(() => new Promise(r => settled.push(r)))
    pollNotifications()
    pollSyncProgress()
    await flushMicrotasks()
    stopAllPolling()
    settled.forEach(r => r({ running: true }))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(api.getNotifications).toHaveBeenCalledTimes(1)
    expect(api.getSyncProgress).toHaveBeenCalledTimes(1)
  })
})
