/* 将 docs/*.md 打包为 assets/docs-content.js 的内嵌副本：
   HTTP 环境下官网前端仍优先实时 fetch md 文件；file:// 直开或 fetch 失败时回退本副本。
   修改 md 后重新运行：node tools/build-docs-content.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = ['deployment', 'users', 'mcp', 'tech-stack'];

let out = '/* 自动生成（node tools/build-docs-content.mjs），内容源为 docs/*.md，请勿手工编辑 */\n'
  + 'window.VCM_DOCS_MD = {\n';
for (const id of ids) {
  const md = readFileSync(join(siteRoot, 'docs', id + '.md'), 'utf8');
  out += '  ' + JSON.stringify(id) + ': ' + JSON.stringify(md) + ',\n';
}
out += '};\n';

writeFileSync(join(siteRoot, 'assets', 'docs-content.js'), out, 'utf8');
console.log('generated assets/docs-content.js from docs/*.md');
