/**
 * 完整 npm 语义 semver 比较（与后端 backend/semver.js 保持一致）
 * 用于：清理预览排序、mock 清理逻辑——保证前端预览与后端实际删除顺序一致
 * 规则：major/minor/patch 数值比较；prerelease 逐标识比较
 *  （纯数字按数值、数字<非数字、非数字按 ASCII、公共前缀更长者更大）；
 *  v 前缀与 build 元数据（+xxx）忽略
 * @returns {number} <0 | 0 | >0
 */
export default function semverCompare(a, b) {
  const parse = (raw) => {
    let s = String(raw || '').trim().replace(/^v/i, '')
    if (s.startsWith('=')) s = s.slice(1).trim()
    // 拆 build 元数据（忽略）
    const plus = s.indexOf('+')
    if (plus !== -1) s = s.slice(0, plus)
    const core = s.split('-')[0]
    const pre = s.indexOf('-') !== -1 ? s.slice(s.indexOf('-') + 1) : ''
    const nums = core.split('.').map(n => (n === '' ? 0 : Number(n)))
    while (nums.length < 3) nums.push(0)
    return { nums: nums.map(n => (Number.isFinite(n) ? n : 0)), pre }
  }

  const pa = parse(a)
  const pb = parse(b)

  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  }
  // 主体相同：无 prerelease 的更大
  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1

  const ia = pa.pre.split('.')
  const ib = pb.pre.split('.')
  const len = Math.max(ia.length, ib.length)
  for (let i = 0; i < len; i++) {
    // 公共前缀更长者更大（如 rc.1 < rc.1.1）
    if (ia[i] === undefined) return -1
    if (ib[i] === undefined) return 1
    const na = /^\d+$/.test(ia[i])
    const nb = /^\d+$/.test(ib[i])
    if (na && nb) {
      const d = Number(ia[i]) - Number(ib[i])
      if (d !== 0) return d
    } else if (na !== nb) {
      return na ? -1 : 1 // 数字 < 非数字
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1
    }
  }
  return 0
}

/** 排序（低版本在前），返回新数组，不修改入参 */
export function sortSemver(list, getVersion = v => v) {
  return [...list].sort((x, y) => semverCompare(getVersion(x), getVersion(y)))
}