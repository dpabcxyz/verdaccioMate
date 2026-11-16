<template>
  <div class="about-page">
    <div class="about-card">
      <div class="ab-head">
        <img class="ab-logo" src="/logo.svg" alt="Verdaccio Mate" />
        <div class="ab-title">Verdaccio Mate · 可视化治理工具</div>
        <div class="ab-sub">缓存 + 私有包 · 双重治理</div>
      </div>

      <section class="ab-sec">
        <h3><el-icon :size="14"><Aim /></el-icon> 项目背景</h3>
        <p>
          <strong>原版 Verdaccio</strong> 是轻量、零配置的 npm 私有仓储，在团队内承担
          <em>双重角色</em>：① 离线缓存与内网分发——公网拉取后缓存到本地，内网命中即走缓存，装得快、构建稳；
          ② 私有发布源——团队内部 <code>@scope</code> 包直接发布到同一存储目录，与缓存包共存。
        </p>
        <p>
          但 原版 Verdaccio 作为仓储「只负责存取、不提供治理」：缓存目录是黑盒、版本随
          <code>npm install</code> 无限膨胀、超量版本只能手工进目录删除（危险易误删）、无法主动预置热门前端依赖；
          私有包与缓存包混杂，原版 Verdaccio Web UI 也无法区分来源、没有 README 与安装命令洞察。
        </p>
        <p>
          本 Verdaccio Mate 为 原版 Verdaccio 补上缺失的 <strong>可视化 + 治理 + 主动预置 + 私有包洞察</strong> 四块能力，
          并通过标准 <strong>MCP</strong> 向 AI 助手开放缓存查询；
          自研前端复刻 原版 Verdaccio 界面的读取体验，开箱即用、可 Docker 一键部署。
        </p>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><MagicStick /></el-icon> 功能一览</h3>
        <div class="ab-grid">
          <div class="ab-fn" v-for="f in funcs" :key="f.t">
            <el-icon class="fn-ico" :size="16"><component :is="f.e" /></el-icon>
            <div>
              <div class="fn-t">{{ f.t }}</div>
              <div class="fn-d">{{ f.d }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><Connection /></el-icon> MCP 接入（AI 助手）</h3>
        <p>
          Verdaccio Mate 内置标准 <strong>MCP</strong>（Model Context Protocol）服务，AI 客户端经
          <code>Streamable HTTP</code> 以 URL + Key 直连，即可查询缓存与包信息，无需定制代码。
        </p>
        <div class="ab-repo">
          <code class="repo-url">{{ mcpEndpoint }}</code>
          <span class="ab-mcp-auth">Authorization: Bearer &lt;Key&gt;</span>
        </div>
        <p>
          通过 Verdaccio Mate 的「MCP 接入」生成或吊销 Key（认证走哈希，明文加密入库、可按需回看并写审计）。
          一期开放 8 个只读工具，不会删除或修改缓存与用户；
          每个 Key 限速 30 次/分钟，所有调用写入操作日志。
        </p>
        <div class="ab-stack ab-mcp-tools">
          <span v-for="t in mcpTools" :key="t">{{ t }}</span>
        </div>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><SetUp /></el-icon> 技术栈</h3>
        <div class="ab-stack">
          <span v-for="s in stack" :key="s">{{ s }}</span>
        </div>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><Star /></el-icon> 致谢</h3>
        <p class="ab-credit">感谢 <strong>Verdaccio 团队</strong>开源轻量、零配置的 npm 私有仓储。Verdaccio Mate 站在原版 Verdaccio 的肩膀上，为它补上可视化与治理能力——愿 npm 生态与原版 Verdaccio 一同越来越好。</p>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><FolderOpened /></el-icon> 代码仓库</h3>
        <div class="ab-repo">
          <code class="repo-url">{{ repoUrl }}</code>
          <a class="repo-link" :href="repoUrl" target="_blank" rel="noopener">前往仓库 ↗</a>
        </div>
      </section>

      <section class="ab-sec">
        <h3><el-icon :size="14"><Document /></el-icon> 开源协议</h3>
        <p class="ab-credit">Verdaccio Mate 基于 <strong>Apache License 2.0</strong> 开源发布，可自由使用、修改与分发；完整条款见仓库根目录的 LICENSE 文件。第三方依赖各自遵循其原有许可证。</p>
      </section>

      <div class="ab-version"><el-icon :size="13" style="vertical-align:-2px"><Box /></el-icon> 版本信息 <span>v1.0.0</span></div>
      <div class="ab-foot">Verdaccio Mate · 原版 Verdaccio 的得力伙伴</div>
    </div>
  </div>
</template>

<script setup>
import { Aim, MagicStick, SetUp, Star, FolderOpened, Search, PriceTag, Document, Lightning, Box, User, WarnTriangleFilled, Brush, Top, Trophy, Clock, Bell, Connection } from '@element-plus/icons-vue'

const repoUrl = 'http://218.61.196.156:41695/chenxuan/verdaccio-cache-manager.git'
const mcpEndpoint = `${location.origin}/mcp`
const mcpTools = [
  'get_scan_status', 'get_scan_progress', 'get_storage_stats', 'top_packages',
  'list_packages', 'get_package_detail', 'get_package_versions', 'list_registry_users',
]

const funcs = [
  { e: Search, t: '缓存扫描', d: '异步扫描 原版 Verdaccio 缓存目录，遮罩实时进度' },
  { e: PriceTag, t: '私有包洞察', d: '自动识别私有包 / 缓存包，来源筛选 + 徽标' },
  { e: Document, t: 'README 预览', d: '详情抽屉渲染 Markdown README（双主题，XSS 清洗）' },
  { e: Lightning, t: '搜索联想', d: '输入即时联想（本地 Top 8），点击即搜' },
  { e: Box, t: '安装命令', d: '一键复制 npm install 包@版本' },
  { e: User, t: '用户管理', d: '读写 原版 Verdaccio 的 htpasswd 用户' },
  { e: WarnTriangleFilled, t: '版本预警', d: '版本数超阈值置顶提示，变化才推送' },
  { e: Brush, t: '清理低版本', d: '保留最新 N 版，删除其余释放空间' },
  { e: Top, t: '拉取存量最新版', d: '对缓存内包一键拉取最新版本' },
  { e: Trophy, t: 'Top1000 榜单', d: 'npm 周榜与本地缓存比对，一键拉取' },
  { e: Clock, t: '操作日志', d: '扫描 / 删除 / 拉取 / 登录审计' },
  { e: Bell, t: '消息中心', d: '预警 / 拉取结果 / 榜单变化非实时通知' },
  { e: Connection, t: 'MCP 接入', d: 'AI 客户端经 URL + Key 直连，只读查询缓存与包信息' },
]

const stack = ['Node.js 20', 'Express + better-sqlite3', 'Vue 3 + Vite', 'Element Plus', 'MCP (Streamable HTTP)', 'Docker / NAS']
</script>

<style scoped>
.about-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 44px 20px 60px;
}
.about-card {
  width: min(860px, 100%);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 40px 44px;
  box-shadow: var(--shadow);
}
.ab-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 30px;
  text-align: center;
}
.ab-logo { width: 56px; height: 56px; margin-bottom: 6px; }
.ab-title { font-size: 22px; font-weight: 600; color: var(--ink); letter-spacing: .3px; }
.ab-sub { font-size: 13px; color: var(--ink-faint); letter-spacing: 1px; }

.ab-sec { margin: 26px 0; }
.ab-credit { line-height: 1.7; color: var(--ink-faint); font-size: 13px; margin: 0; }
.ab-sec h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.ab-sec h3 .el-icon { color: var(--ink-dim); }
.ab-sec p {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--ink-dim);
  margin: 10px 0;
}
.ab-sec strong { color: var(--acc); }
.ab-sec em { color: var(--pri); font-style: normal; font-weight: 600; }
.ab-sec code {
  font-family: var(--num);
  font-size: 12px;
  background: var(--num-bg);
  color: var(--acc);
  padding: 1px 6px;
  border-radius: 3px;
}

.ab-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}
.ab-fn {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-soft);
}
.fn-ico { color: var(--acc); flex-shrink: 0; margin-top: 1px; }
.fn-t { font-size: 13px; font-weight: 600; color: var(--ink); }
.fn-d { font-size: 11.5px; color: var(--ink-faint); margin-top: 3px; line-height: 1.5; }

.ab-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ab-stack span {
  font-size: 12px;
  font-weight: 500;
  color: var(--acc);
  background: var(--acc-soft);
  padding: 4px 12px;
  border-radius: 3px;
}
.ab-mcp-tools span { font-family: var(--num); font-size: 11.5px; }
.ab-mcp-auth {
  flex-shrink: 0;
  font-family: var(--num);
  font-size: 11.5px;
  color: var(--ink-faint);
}

.ab-repo {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
}
.repo-url {
  font-family: var(--num);
  font-size: 12.5px;
  color: var(--ink-dim);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repo-link {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  background: var(--pri);
  border-radius: 4px;
  padding: 6px 16px;
  text-decoration: none;
  transition: background .15s;
}
html.dark .repo-link { color: #141414; }
.repo-link:hover { background: var(--pri-h); }

.ab-foot {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-faint);
  letter-spacing: .5px;
}
.ab-version {
  margin-top: 28px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-dim);
}
.ab-version span { font-family: var(--num); color: var(--acc); }

@media (max-width: 767px) {
  .about-page { padding: 20px 12px 40px; }
  .about-card { padding: 26px 18px; }
  .ab-title { font-size: 18px; }
}
</style>
