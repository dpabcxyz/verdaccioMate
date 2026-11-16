/**
 * 预警清理原子逻辑（§3.4 / AC-7 原子性）
 * 1. 读 package.json
 * 2. 按 semver 排序保留最新 N 个
 * 3. 删低版本 versions/time 记录
 * 4. 修正 dist-tags（latest 指向已删版本时指向保留的最新）
 * 5. 写回元数据
* 6. 物理删 .tgz（按物理文件名匹配，兼容 {version}.tgz 与 {pkgname}-{version}.tgz）
 * 7. 记日志
 * 8. 返回「删除数量、释放空间」
 * 失败时不做任何文件修改（先备份→写临时文件→rename 提交）
 */
import fs from 'node:fs'
import path from 'node:path'
import semverCompare from './semver.js'
import { listTgzFiles, findTgzForVersion } from './tgz.js'
import { pkgNameToSegments } from './scanner.js'

export function cleanPackage(storageDir, pkgName, keep) {
  const pkgDir = locatePackageDir(storageDir, pkgName)
  if (!pkgDir) return { ok: false, message: `未找到包 ${pkgName}` }

  const pkgFile = path.join(pkgDir, 'package.json')
  let meta
  try {
    meta = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  } catch {
    return { ok: false, message: `读取 ${pkgName} 元数据失败` }
  }

  const versions = Object.keys(meta.versions || {})
  if (!versions.length) return { ok: false, message: '包内没有可清理的版本' }

  // 按 semver 数值排序（旧 → 新），保留最新 keep 个
  const sorted = versions.sort((a, b) => semverCompare(a, b))
  const toDelete = sorted.slice(0, Math.max(0, sorted.length - keep))
  if (!toDelete.length) {
    return { ok: false, message: '版本数未超过保留值，无需清理' }
  }

// —— 准备提交内容 ——
  const nextMeta = JSON.parse(JSON.stringify(meta))
  const time = nextMeta.time || {}
  const freed = []
  // 先列物理 .tgz，按文件名匹配要删的版本（不猜命名规则）
  const tgzFiles = listTgzFiles(pkgDir)
  for (const v of toDelete) {
    const info = nextMeta.versions[v] || {}
    delete nextMeta.versions[v]
    delete time[v]
    const hit = findTgzForVersion(tgzFiles, v)
    freed.push({
      v,
      size: hit ? hit.size : (info.dist?.unpackedSize || 0),
      file: hit ? hit.path : null,
    })
  }
  nextMeta.time = time

  // —— 修正 dist-tags ——
  const distTags = nextMeta['dist-tags'] || {}
  // slice(-keep) 在 keep=0 时退化为 slice(0)（全数组），显式按 keep>0 切分避免陷阱
  const kept = keep > 0 ? sorted.slice(-keep) : []
  for (const [tag, v] of Object.entries(distTags)) {
    if (toDelete.includes(v)) {
      // 仍有保留版本 → 重定向到最新保留；全删光 → 清空标签（指向幽灵版本是损坏元数据，与 npm unpublish 全量行为一致）
      if (kept[kept.length - 1]) distTags[tag] = kept[kept.length - 1]
      else delete distTags[tag]
    }
  }
  nextMeta['dist-tags'] = distTags

  // —— 原子提交：临时文件写入 → rename ——
  const tmp = `${pkgFile}.clean.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(nextMeta, null, 2))
    fs.renameSync(tmp, pkgFile) // 同目录 rename 为原子操作
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    return { ok: false, message: `写回元数据失败：${err.message}` }
  }

// —— 物理删除 tgz（元数据已提交，删除失败仅记录不阻塞） ——
  const deletedBytes = freed.reduce((s, f) => s + f.size, 0)
  for (const f of freed) {
    if (!f.file) continue // 该版本无实体文件（元数据残留），无需删除
    try {
      if (fs.existsSync(f.file)) fs.unlinkSync(f.file)
    } catch {
      /* 忽略单个文件删除失败 */
    }
  }

  const freedText = `${(deletedBytes / 1024 / 1024).toFixed(1)} MB`
  return {
    ok: true,
    pkgName,
    deletedVersions: toDelete.join(', '),
    deletedCount: toDelete.length,
    freedSpace: freedText,
    freedBytes: deletedBytes,
  }
}

/** 删除单个版本（抽屉内单版本删除） */
export function deleteSingleVersion(storageDir, pkgName, version) {
  const pkgDir = locatePackageDir(storageDir, pkgName)
  if (!pkgDir) return { ok: false, message: `未找到包 ${pkgName}` }
  const pkgFile = path.join(pkgDir, 'package.json')

  let meta
  try {
    meta = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  } catch {
    return { ok: false, message: '读取元数据失败' }
  }
  if (!meta.versions || !meta.versions[version]) {
    return { ok: false, message: `版本 ${version} 不存在` }
  }

  const nextMeta = JSON.parse(JSON.stringify(meta))
  const info = nextMeta.versions[version]
  delete nextMeta.versions[version]
  if (nextMeta.time) delete nextMeta.time[version]

  // 修正 dist-tags
  const distTags = nextMeta['dist-tags'] || {}
  const remaining = Object.keys(nextMeta.versions).sort((a, b) => semverCompare(a, b))
  for (const [tag, v] of Object.entries(distTags)) {
    if (v === version) {
      // 仍有剩余版本 → 重定向到最新剩余；删光 → 清空标签（不指向幽灵版本）
      if (remaining[remaining.length - 1]) distTags[tag] = remaining[remaining.length - 1]
      else delete distTags[tag]
    }
  }
  nextMeta['dist-tags'] = distTags

  const tmp = `${pkgFile}.clean.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(nextMeta, null, 2))
    fs.renameSync(tmp, pkgFile)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    return { ok: false, message: `写回元数据失败：${err.message}` }
  }

let size = info.dist?.unpackedSize || 0
  const hit = findTgzForVersion(listTgzFiles(pkgDir), version)
  if (hit) {
    size = hit.size
    try {
      fs.unlinkSync(hit.path)
    } catch { /* ignore */ }
  }

  return {
    ok: true,
    freedSpace: `${(size / 1024 / 1024).toFixed(1)} MB`,
  }
}

/** 定位包目录（scoped 为 @scope/name 嵌套目录）；包名先过 scanner 白名单（防目录穿越），非法名直接拒绝 */
export function locatePackageDir(storageDir, pkgName) {
  const segments = pkgNameToSegments(pkgName)
  if (!segments) return null
  const dir = path.join(storageDir, ...segments)
  return fs.existsSync(path.join(dir, 'package.json')) ? dir : null
}
