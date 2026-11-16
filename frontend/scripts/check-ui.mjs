/**
 * UI 规范守护脚本（npm test）
 * 校验 src 目录，违反任一规则即退出码 1：
 * 1. 不得残留 emoji 图标字符（图标统一使用 @element-plus/icons-vue）
 * 2. 样式不得使用 !important
 * 3. 不得引用旧主题变量（--orange / --blue / --purple / --pink / --green / --red / --grad-* 等）
 * 4. 不得残留 html[data-theme] 双主题选择器（统一 html.dark）
 * 5. 动画仅允许 fadeUp / spin 家族 / 进度条滑移（fadeUp / spin360 / toolSpin / sync-spin / scan-slide）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(import.meta.url), '..', '..', 'src')
const EXTS = new Set(['.vue', '.js', '.css'])

// 覆盖常用 emoji 区段：杂项符号/图形、象形文字、装饰符号、变体选择符
// eslint-disable-next-line no-misleading-character-class -- 本正则就是刻意匹配 emoji 组合字符
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u
const IMPORTANT_RE = /!important/
const LEGACY_VAR_RE = /(?:var\(--|--)(orange|blue|purple|pink|green|red|gold|cream|yellow|teal|grad)(?:-[\w-]*)?\b/
const DATA_THEME_RE = /data-theme/
const KEYFRAMES_RE = /@keyframes\s+([\w-]+)/g
const ALLOWED_KEYFRAMES = new Set(['toolSpin', 'fadeUp', 'spin360', 'sync-spin', 'scan-slide'])

const failures = []

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'dist') continue
    out.push(p)
  }
  return out
}

function collect(dir) {
  for (const p of walk(dir)) {
    if (statSync(p).isDirectory()) collect(p)
    else if (EXTS.has(extname(p))) checkFile(p)
  }
}

function checkFile(p) {
  const text = readFileSync(p, 'utf8')
  const lines = text.split('\n')

  const lineOf = (idx) => lines.slice(0, idx).join('\n').split('\n').length
  const report = (idx, msg) => failures.push(`${rel(p)}:${lineOf(idx)}  ${msg}`)

  let m
  EMOJI_RE.lastIndex = 0
  while ((m = EMOJI_RE.exec(text))) report(m.index, `emoji 图标字符 U+${m[0].codePointAt(0).toString(16).toUpperCase()}，请改用 @element-plus/icons-vue 图标`)

  let i
  IMPORTANT_RE.lastIndex = 0
  while ((i = IMPORTANT_RE.exec(text))) report(i.index, '不允许使用 !important')

  LEGACY_VAR_RE.lastIndex = 0
  while ((m = LEGACY_VAR_RE.exec(text))) report(m.index, `旧主题变量 --${m[1]}，请改用新 tokens（--pri/--acc/--suc/--warn/--dgr/--inf）`)

  DATA_THEME_RE.lastIndex = 0
  while ((m = DATA_THEME_RE.exec(text))) report(m.index, '不允许 data-theme 选择器，统一使用 html.dark')

  KEYFRAMES_RE.lastIndex = 0
  while ((m = KEYFRAMES_RE.exec(text))) {
    if (!ALLOWED_KEYFRAMES.has(m[1])) report(m.index, `不允许的动画 @keyframes ${m[1]}（仅允许 fadeUp / spin 家族 / scan-slide 进度条）`)
  }
}

function rel(p) {
  return p.replace(SRC + '\\', '').replace(SRC + '/', '').replaceAll('\\', '/')
}

collect(SRC)

if (failures.length) {
  console.error('[check-ui] 发现以下违规：')
  for (const f of failures) console.error('  x ' + f)
  console.error(`[check-ui] 共 ${failures.length} 处违规`)
  process.exit(1)
}
console.log('[check-ui] 全部通过：无 emoji、无 !important、无旧主题变量、无 data-theme、动画均在白名单内')
