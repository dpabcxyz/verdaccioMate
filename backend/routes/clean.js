/**
 * 清理 / 单版本删除 API —— server.js 抽离
 * - POST /api/clean：预警批量清理（保留最新 N 个）
 * - DELETE /api/packages/:pkgName/versions/:version：单版本删除
 * 扫描进行中允许删除：元数据写入是 tmp+rename 原子操作、扫描对消失的文件按「跳过/broken」处理，
 * 且 invalidateScan 的失效标记不再被飞行中的扫描吞掉（scan-manager.js 世代比对），删除结果会由下一次请求重建缓存。
 * 含 demo 模式下的内存态清理实现
 */
import express from 'express'
import { addLog } from '../db.js'
import { demoPackages } from '../scanner.js'
import { currentStorage, isDemoMode, invalidateScan } from '../scan-manager.js'
import { apiValidate, zPkgName, zVersion, zKeep } from '../validate.js'
import { cleanPackage, deleteSingleVersion } from '../clean.js'
import semverCompare from '../semver.js'
import { z } from 'zod'

export const cleanRouter = express.Router()

// —— 清理（批量删除，保留最新 N 个；每个被删版本记一条日志） ——
cleanRouter.post('/clean', apiValidate({ body: z.object({ pkgName: zPkgName, keep: zKeep }) }), (req, res) => {
  const { pkgName, keep } = req.body
  if (isDemoMode()) {
    return demoClean(res, pkgName, keep)
  }
  const storage = currentStorage()
  const result = cleanPackage(storage, pkgName, keep)
  if (result.ok) {
    const user = req.user || null
    for (const v of String(result.deletedVersions).split(',').map(s => s.trim()).filter(Boolean)) {
      addLog({
        action: 'delete_version', pkgName, version: v, result: 'success',
        message: `已删除 ${v}`, deletedVersions: v, deletedCount: 1, meta: { user },
      })
    }
    invalidateScan()
  }
  res.json(result)
})

// —— 单版本删除 ——
cleanRouter.delete('/packages/:pkgName/versions/:version', apiValidate({ params: z.object({ pkgName: zPkgName, version: zVersion }) }), (req, res) => {
  const { pkgName, version } = req.params
  if (isDemoMode()) {
    return demoDeleteVersion(res, pkgName, version)
  }
  const storage = currentStorage()
  const result = deleteSingleVersion(storage, pkgName, version)
  if (result.ok) {
    addLog({
      action: 'delete_version',
      pkgName,
      version,
      result: 'success',
      message: `已删除 ${version}`,
      deletedVersions: version,
      deletedCount: 1,
      freedSpace: result.freedSpace,
      meta: { user: req.user || null },
    })
    invalidateScan()
  }
  res.json(result)
})

// —— demo 模式下的清理/删除（内存态） ——
function demoClean(res, pkgName, keep) {
  const p = demoPackages().find(x => x.name === pkgName)
  if (!p) return res.json({ ok: false, message: '包不存在' })
  const sorted = [...p.versionsDetail].sort((a, b) => semverCompare(a.version, b.version))
  const toDel = sorted.slice(0, Math.max(0, sorted.length - keep))
  if (!toDel.length) return res.json({ ok: false, message: '无需清理' })
  const freed = toDel.reduce((s, v) => s + v.size, 0)
  const result = {
    ok: true,
    pkgName,
    deletedVersions: toDel.map(v => v.version).join(', '),
    deletedCount: toDel.length,
    freedSpace: `${freed.toFixed(1)} MB`,
  }
  // demo 日志：每个被打掉的版本记一条，合并进 delete_version 动作
  for (const v of toDel) {
    addLog({ action: 'delete_version', pkgName, version: v.version, result: 'success', message: `已删除 ${v.version}`, deletedVersions: v.version, deletedCount: 1 })
  }
  res.json(result)
}

function demoDeleteVersion(res, pkgName, version) {
  const p = demoPackages().find(x => x.name === pkgName)
  const v = p?.versionsDetail?.find(x => x.version === version)
  if (!v) return res.json({ ok: false, message: '版本不存在' })
  addLog({ action: 'delete_version', pkgName, version, result: 'success', message: `已删除 ${version}`, deletedVersions: version, deletedCount: 1, freedSpace: `${v.size.toFixed(1)} MB` })
  res.json({ ok: true, freedSpace: `${v.size.toFixed(1)} MB` })
}