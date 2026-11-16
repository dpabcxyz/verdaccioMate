/**
 * 后端 typecheck：遍历 backend 下所有 .js 做 `node --check` 语法校验（零额外依赖）
 * 忽略 node_modules / 隐藏目录，Ctrl+C 或任一文件语法错误时非零退出。
 */
import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))) // backend/
const IGNORE_DIRS = new Set(['node_modules', '.git', '.cache', 'dist'])

function collectJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || IGNORE_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectJs(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

const files = collectJs(root)
let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    failed++
    console.error(`[check] FAIL ${path.relative(root, f)}`)
    if (r.stderr) console.error(r.stderr)
  }
}
console.log(`[typecheck] ${files.length - failed}/${files.length} files OK`)
process.exit(failed ? 1 : 0)