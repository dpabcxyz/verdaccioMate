/**
 * .tgz 物理文件扫描 —— scanner 与 clean 共用
 *
 * 原版 Verdaccio 各版本落盘命名不同：`{version}.tgz` 或 `{pkgname}-{version}.tgz`，
 * 因此清理时按「物理文件名 → 版本后缀」精确匹配，而不是按版本号拼接文件名，
 * 否则会出现「元数据已删、物理 .tgz 删不掉」的空间泄漏。
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * 列出包目录下全部 .tgz 文件
 * @param {string} pkgDir
 * @returns {Array<{name:string, key:string, path:string, size:number, mtimeMs:number}>}
 *   key = 去 .tgz 后缀的文件名（`1.0.0` 或 `lodash-1.0.0`）
 */
export function listTgzFiles(pkgDir) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(pkgDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.tgz')) continue
    const full = path.join(pkgDir, e.name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    out.push({
      name: e.name,
      key: e.name.slice(0, -4),
      path: full,
      size: st.size,
      mtimeMs: st.mtimeMs,
    })
  }
  return out
}

/**
 * 匹配单个版本对应的物理文件
 * - 优先 `key === version`（新版命名 `{version}.tgz`）
 * - 其次 `key.endsWith('-'+version)`（旧版命名 `{pkgname}-{version}.tgz`）
 * @param {Array} tgzFiles listTgzFiles 的结果
 * @param {string} version
 * @returns {object|null} 无实体文件返回 null（版本只剩元数据残留）
 */
export function findTgzForVersion(tgzFiles, version) {
  if (!Array.isArray(tgzFiles)) return null
  const exact = tgzFiles.find(f => f.key === version)
  if (exact) return exact
  const suffix = `-${version}`
  return tgzFiles.find(f => f.key.endsWith(suffix)) || null
}