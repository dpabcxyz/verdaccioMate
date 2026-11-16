/**
 * semver 完整比较（与 npm semver 语义一致，无第三方依赖）
 * - 支持 v 前缀、build 元数据（+xxx，比较时忽略）
 * - prerelease 规则：正式版 > 任何带 prerelease 的版本；
 *   两个 prerelease 逐标识比较：纯数字按数值、混合按 ASCII 字典序、数字 < 非数字
 * - 用途：清理时「保留最新 N 个版本」的排序基准，保证不会把正式版删掉却留下 beta
 */
export default function compare(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

function parse(v) {
  const s = String(v).replace(/^v/, '')
  const [core, pre] = s.split('-')
  const [majorRaw, minorRaw, patchRaw] = core.split('.')
  return {
    major: toInt(majorRaw),
    minor: toInt(minorRaw),
    patch: toInt(patchRaw),
    // build 元数据（+metadata）在比较中忽略；prerelease 与 build 之间以第一个 + 分隔
    prerelease: pre ? pre.split('+')[0].split('.') : null,
  }
}

function toInt(s) {
  const n = parseInt(s, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * prerelease 标识数组比较（null 表示无 prerelease = 正式版）
 * 结果语义与 compare 一致：负数 a<b / 0 / 正数 a>b
 */
function comparePrerelease(a, b) {
  if (a === b) return 0
  if (a === null) return 1        // 正式版 > prerelease
  if (b === null) return -1
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === bi) continue
    const an = /^\d+$/.test(ai)
    const bn = /^\d+$/.test(bi)
    if (an && bn) return Number(ai) - Number(bi)
    if (an) return -1             // 数字标识 < 非数字标识
    if (bn) return 1
    return ai < bi ? -1 : 1       // 非数字按 ASCII 字典序
  }
  // 公共前缀相同：标识更多者更大（1.0.0-rc < 1.0.0-rc.1）
  return a.length - b.length
}