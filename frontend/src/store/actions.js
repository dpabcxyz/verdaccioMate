/**
 * 用户操作动作 —— store/index.js 抽离
 * - refreshAll / saveThresholds / ignore / unignore / clean / deleteVersion
 *
 * 失败口径：api 层对超时/网络/401 抛异常，对业务与入参错误返回 { ok:false, message }。
 * 这里把前者折算成后者，调用方只需判 res.ok 并在失败分支提示一次，不必再包 try/catch。
 */
import api from '../api'
import { toFailure } from '../utils/notify.js'
import { refreshPackages, refreshThresholds, refreshLogs, silentRefresh } from './refreshers.js'
import { doRefresh } from './scan.js'

export async function refreshAll() {
  // 遮罩由 doRefresh 内的扫描阶段控制：仅「确实发生扫描」（首次部署/缓存缺失）时显示，
  // 后端已有缓存则不遮罩，避免每次进入页面闪现 loading
  await doRefresh(true)
}

export async function saveThresholds(payload) {
  let res
  try {
    res = await api.saveThresholds(payload)
  } catch (e) {
    return toFailure(e, '保存阈值失败，请稍后重试')
  }
  if (res.ok) {
    await refreshThresholds()
    await refreshPackages()
  }
  return res
}

export async function ignorePkg(name, versionCount) {
  let res
  try {
    res = await api.ignore(name, versionCount)
    if (!res.ok) return res
  } catch (e) {
    return toFailure(e, '忽略失败，请稍后重试')
  }
  await refreshPackages()
  return res
}

export async function unignorePkg(name, versionCount) {
  let res
  try {
    res = await api.unignore(name, versionCount)
    if (!res.ok) return res
  } catch (e) {
    return toFailure(e, '取消忽略失败，请稍后重试')
  }
  await refreshPackages()
  return res
}

export async function cleanPkg(name, keep) {
  let res
  try {
    res = await api.clean(name, keep)
  } catch (e) {
    return toFailure(e, '清理失败，请稍后重试')
  }
  if (res.ok) {
    silentRefresh().then(() => refreshLogs())
  }
  return res
}

export async function deleteVersion(name, version) {
  let res
  try {
    res = await api.deleteVersion(name, version)
  } catch (e) {
    return toFailure(e, '删除版本失败，请稍后重试')
  }
  if (res.ok) {
    silentRefresh().then(() => refreshLogs())
  }
  return res
}