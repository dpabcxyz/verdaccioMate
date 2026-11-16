<script setup>
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Close, Link, Files, Document, User, CopyDocument, Delete } from '@element-plus/icons-vue'
import StatusTag from './StatusTag.vue'
import PkgLogo from './PkgLogo.vue'
import api from '../api'
import { fmtSize } from '../store'
import { ElMessage } from 'element-plus'
import { useCopyText } from '../composables/useCopyText.js'

marked.use({ gfm: true, breaks: true }) // GitHub 风格 + 单换行即换行

const props = defineProps({
  visible: Boolean,
  pkg: { type: Object, default: null },
  threshold: { type: Number, default: 15 },
})
const emit = defineEmits(['update:visible', 'clean', 'ignore', 'unignore', 'delete-version'])

// 版本明细按需加载：列表接口不含明细，打开抽屉时异步获取
const loadingVer = ref(false)
const verFail = ref(false)
const detailPkg = ref(null)
const verList = computed(() => detailPkg.value?.versionsDetail || props.pkg?.versionsDetail || [])

// README：列表接口不携带，来自详情接口（详情接口在 watch 中一并拉取）
const readmeHtml = computed(() => {
  const md = (detailPkg.value?.readme || props.pkg?.readme || '').trim()
  if (!md) return ''
  try {
    return DOMPurify.sanitize(marked.parse(md, { async: false }))
  } catch {
    return ''
  }
})
const hasReadme = computed(() => !!readmeHtml.value)

// 包信息（介绍/主页/仓库/许可/作者）：列表接口不含，来自详情接口或列表已有字段
const desc = computed(() => detailPkg.value?.description || props.pkg?.description || '')
const homepage = computed(() => detailPkg.value?.homepage || props.pkg?.homepage || '')
const repo = computed(() => detailPkg.value?.repository || props.pkg?.repository || '')
const license = computed(() => detailPkg.value?.license || props.pkg?.license || '')
const author = computed(() => detailPkg.value?.author || props.pkg?.author || '')
const hasMeta = computed(() => homepage.value || repo.value || license.value || author.value)
const repoUrl = computed(() => repo.value.replace(/^git\+/, '').replace(/\.git$/, ''))

// 请求序号：快速切换包时只采纳最后一次请求的结果，防止旧响应覆盖新包
let loadSeq = 0

watch(() => props.pkg, async (p) => {
  verFail.value = false
  detailPkg.value = null
  if (!p) { loadingVer.value = false; return }
  if (Array.isArray(p.versionsDetail) && p.versionsDetail.length) { loadingVer.value = false; return }
  const seq = ++loadSeq
  loadingVer.value = true
  try {
    const d = await api.getPackageDetail(p.name)
    if (seq !== loadSeq) return
    if (d.ok && d.pkg) detailPkg.value = d.pkg
    else verFail.value = true
  } catch {
    if (seq === loadSeq) verFail.value = true
  } finally {
    if (seq === loadSeq) loadingVer.value = false
  }
}, { immediate: true })

function splitName(name) {
  if (!name) return { scope: '', base: '' }
  const i = name.lastIndexOf('/')
  if (i > 0) return { scope: name.slice(0, i + 1), base: name.slice(i + 1) }
  return { scope: '', base: name }
}

function fmtDate(d) {
  return d || '—'
}

// —— 安装命令（原版 Verdaccio 界面体验）：latest 兜底 dist-tags，版本行可复制对应命令 ——
const installCmd = computed(() => {
  const n = props.pkg?.name
  if (!n) return ''
  return `npm install ${n}${props.pkg?.latest ? '@' + props.pkg?.latest : ''}`
})
// 复制走全站共享的降级实现（useCopyText：writeText → execCommand → 选中文本兜底），体验与 McpDialog 拉齐
const { copyText: copyToClipboard } = useCopyText()
function copyText(text) {
  return copyToClipboard(text, '', '已复制安装命令')
}

function delVersion(v) {
  emit('delete-version', props.pkg, v)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible && pkg" class="drawer-overlay" @click.self="emit('update:visible', false)"></div>
    </Transition>
    <Transition :name="isMobile ? 'drawer-up' : 'drawer-r'">
      <aside v-if="visible && pkg" class="drawer">
        <div class="drawer-head">
          <div class="drawer-title">
            <PkgLogo :name="pkg.name" :size="42" :homepage="homepage" />
            <div style="min-width: 0">
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
                <span class="drawer-name">
                  <span v-if="splitName(pkg.name).scope" class="scope">{{ splitName(pkg.name).scope }}</span>{{ splitName(pkg.name).base }}
                </span>
                <StatusTag :status="pkg.status" />
              </div>
              <p v-if="desc" class="drawer-desc" :title="desc">{{ desc }}</p>
            </div>
          </div>
          <div class="drawer-close" @click="emit('update:visible', false)"><el-icon><Close /></el-icon></div>
        </div>

        <div class="drawer-body">
          <div class="install-row">
            <code class="install-cmd" :title="installCmd">{{ installCmd }}</code>
            <button class="copy-btn" @click="copyText(installCmd)">复制</button>
          </div>

          <div class="d-kv">
            <div class="kv">
              <div class="k">版本数</div>
              <div class="v">{{ pkg.versions }}</div>
            </div>
            <div class="kv">
              <div class="k">占用空间</div>
              <div class="v">{{ fmtSize(pkg.size) }}</div>
            </div>
            <div class="kv">
              <div class="k">最近更新</div>
              <div class="v">{{ fmtDate(pkg.lastUpdated) }}</div>
            </div>
            <div class="kv">
              <div class="k">预警阈值</div>
              <div class="v" :class="{ warn: pkg.versions > threshold }">{{ threshold }} 版</div>
            </div>
          </div>

          <div v-if="hasMeta" class="d-meta">
            <a v-if="homepage" class="d-meta-item" :href="homepage" target="_blank" rel="noopener"><el-icon :size="12"><Link /></el-icon> 主页</a>
            <a v-if="repoUrl" class="d-meta-item" :href="repoUrl" target="_blank" rel="noopener"><el-icon :size="12"><Files /></el-icon> 仓库</a>
            <span v-if="license" class="d-meta-item lic"><el-icon :size="12"><Document /></el-icon> {{ license }}</span>
            <span v-if="author" class="d-meta-item lic" :title="author"><el-icon :size="12"><User /></el-icon> {{ author }}</span>
          </div>

          <div class="d-sub">
            版本列表
            <span class="cnt">{{ verList.length || pkg.versions }} 个版本</span>
            <span v-if="pkg.status === 'warn'" class="excess">超阈值 {{ pkg.versions - threshold }} 个</span>
          </div>

          <div class="ver-list">
            <div v-if="loadingVer" class="empty-tip load">
              <span class="spin"></span>正在加载版本信息…
            </div>
            <div v-else-if="verFail" class="empty-tip">
              版本信息加载失败，请稍后重试
            </div>
            <div v-else-if="!verList.length" class="empty-tip">
              {{ pkg.status === 'broken' ? '元数据异常，无法读取版本列表' : '暂无版本信息' }}
            </div>
            <div v-for="v in verList" :key="v.version" class="ver-row">
              <span class="ver-no">{{ v.version }}</span>
              <span class="ver-size">{{ fmtSize(v.size) }}</span>
              <span class="ver-date">{{ fmtDate(v.date) }}</span>
              <button class="copy-mini" title="复制安装命令" @click="copyText(`npm install ${pkg.name}@${v.version}`)"><el-icon :size="13"><CopyDocument /></el-icon></button>
              <button class="del-btn" title="删除此版本" @click="delVersion(v.version)"><el-icon :size="13"><Delete /></el-icon></button>
            </div>
          </div>

          <div class="d-sub readme-sub">README<span class="cnt">{{ hasReadme ? 'Markdown' : '暂无' }}</span></div>
          <div v-if="hasReadme" class="readme-body" v-html="readmeHtml"></div>
          <div v-else class="readme-empty">该包未提供 README 说明</div>
        </div>

        <div class="drawer-foot">
          <template v-if="pkg.status === 'warn'">
            <button class="btn clean block" @click="emit('clean', pkg)">一键清理</button>
            <button class="btn ignore block" @click="emit('ignore', pkg)">忽略</button>
          </template>
          <template v-else-if="pkg.status === 'ignored'">
            <button class="btn unignore block" @click="emit('unignore', pkg)">取消忽略</button>
          </template>
          <template v-else>
            <button class="btn ignore block" @click="emit('ignore', pkg)">忽略</button>
          </template>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script>
// 非响应式：抽屉打开时根据当前视口决定滑入方向即可
export default {
  computed: {
    isMobile() {
      return window.matchMedia('(max-width: 767px)').matches
    },
  },
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .45);
  z-index: 120;
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 600px;
  z-index: 121;
  background: var(--card);
  box-shadow: -16px 0 40px -16px rgba(0, 0, 0, .3);
  display: flex;
  flex-direction: column;
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
}
.drawer-title { display: flex; align-items: center; gap: 12px; }
.drawer-name {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--num);
}
.drawer-title .scope { color: var(--ink-faint); font-weight: 500; }
.drawer-desc {
  font-size: 12.5px;
  color: var(--ink-dim);
  margin: 6px 0 0;
  line-height: 1.55;
  max-width: 430px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.d-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}
.d-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--acc);
  background: var(--acc-soft);
  padding: 4px 10px;
  border-radius: 3px;
  text-decoration: none;
  font-weight: 500;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-meta-item:hover { color: var(--acc-h); background: var(--acc-line); }
.d-meta-item.lic { color: var(--ink-dim); background: var(--num-bg); cursor: default; }
.d-meta-item.lic:hover { color: var(--ink-dim); background: var(--num-bg); }
.drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--card);
  border: 1px solid var(--line);
  color: var(--ink-dim);
  font-size: 13px;
  transition: .15s;
}
.drawer-close:hover { background: var(--dgr-soft); color: var(--dgr); border-color: var(--dgr-line); }
.drawer-body {
  padding: 20px 24px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
/* 安装命令条（原版 Verdaccio 界面：一键复制 npm install） */
.install-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 9px 14px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
}
.install-cmd {
  font-family: var(--num);
  font-size: 12.5px;
  color: var(--acc);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-btn {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--acc);
  background: var(--acc-soft);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  transition: .15s;
}
.copy-btn:hover { color: var(--acc-h); background: var(--acc-line); }
.copy-mini {
  border: 1px solid var(--line);
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: var(--card);
  color: var(--ink-dim);
  font-size: 13px;
  transition: .15s;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.copy-mini:hover { color: var(--acc); border-color: var(--acc); }
.d-kv {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  margin-bottom: 18px;
  padding: 14px 16px;
  background: var(--bg);
  border-radius: 4px;
  border: 1px dashed var(--line);
}
.d-kv .kv .k { font-size: 11px; color: var(--ink-faint); font-weight: 600; }
.d-kv .kv .v { font-family: var(--num); font-size: 15px; font-weight: 600; margin-top: 3px; }
.d-kv .kv .v.warn { color: var(--warn); }
.d-sub {
  font-size: 13px;
  font-weight: 600;
  margin: 2px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.d-sub .cnt {
  font-family: var(--num);
  font-size: 11px;
  font-weight: 500;
  color: var(--acc);
  background: var(--acc-soft);
  padding: 2px 9px;
  border-radius: 3px;
}
.d-sub .excess {
  font-family: var(--num);
  font-size: 11px;
  font-weight: 500;
  color: var(--warn);
  background: var(--warn-soft);
  padding: 2px 9px;
  border-radius: 3px;
}
.ver-list { flex: 1; }
.empty-tip {
  padding: 30px 0;
  text-align: center;
  color: var(--ink-faint);
  font-size: 12.5px;
}
.empty-tip.load {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}
.spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--acc);
  animation: spin360 .8s linear infinite;
  display: inline-block;
  flex-shrink: 0;
}
.ver-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 4px;
  margin-bottom: 9px;
  background: var(--card);
  transition: .15s;
}
.ver-row:hover { border-color: var(--acc); box-shadow: var(--shadow-hover); }
.ver-no {
  font-family: var(--num);
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  min-width: 88px;
  padding: 4px 12px;
  border-radius: 3px;
  background: var(--num-bg);
  text-align: center;
}
.ver-size { font-family: var(--num); font-size: 12px; color: var(--ink-dim); }
.ver-date { font-family: var(--num); font-size: 12px; color: var(--ink-faint); margin-left: auto; }
.del-btn {
  border: 1px solid transparent;
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: var(--dgr-soft);
  color: var(--dgr);
  font-size: 13px;
  transition: .15s;
  display: grid;
  place-items: center;
}
.del-btn:hover { background: var(--dgr); color: #fff; }
/* —— README 区块（Markdown 渲染，双主题走 CSS 变量） —— */
.readme-sub { margin-top: 22px; }
.readme-empty {
  padding: 26px 0 8px;
  text-align: center;
  color: var(--ink-faint);
  font-size: 12.5px;
}
.readme-body {
  font-size: 13px;
  line-height: 1.75;
  color: var(--ink-dim);
  word-break: break-word;
  overflow-wrap: break-word;
}
.readme-body :deep(h1), .readme-body :deep(h2), .readme-body :deep(h3), .readme-body :deep(h4) {
  color: var(--ink);
  font-weight: 600;
  line-height: 1.4;
  margin: 18px 0 8px;
}
.readme-body :deep(h1) { font-size: 18px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.readme-body :deep(h2) { font-size: 16px; }
.readme-body :deep(h3) { font-size: 14.5px; }
.readme-body :deep(h4) { font-size: 13.5px; }
.readme-body :deep(p) { margin: 8px 0; }
.readme-body :deep(a) { color: var(--acc); text-decoration: none; }
.readme-body :deep(a:hover) { text-decoration: underline; }
.readme-body :deep(code) {
  font-family: var(--num);
  font-size: 12px;
  background: var(--num-bg);
  color: var(--acc);
  padding: 2px 6px;
  border-radius: 3px;
}
.readme-body :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 12px 14px;
  overflow: auto;
  margin: 10px 0;
}
.readme-body :deep(pre code) { background: transparent; color: var(--ink); padding: 0; }
.readme-body :deep(blockquote) {
  margin: 10px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--acc);
  color: var(--ink-faint);
  background: var(--panel-soft);
  border-radius: 0 4px 4px 0;
}
.readme-body :deep(ul), .readme-body :deep(ol) { margin: 8px 0; padding-left: 22px; }
.readme-body :deep(li) { margin: 3px 0; }
.readme-body :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 12.5px;
}
.readme-body :deep(th), .readme-body :deep(td) {
  border: 1px solid var(--line);
  padding: 7px 10px;
  text-align: left;
}
.readme-body :deep(th) { background: var(--num-bg); color: var(--ink); font-weight: 600; }
.readme-body :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 16px 0; }
.readme-body :deep(img) { max-width: 100%; border-radius: 4px; }
.readme-body :deep(strong) { color: var(--ink); font-weight: 600; }
.drawer-foot {
  display: flex;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  background: var(--bg);
}

.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.drawer-r-enter-active { transition: transform .3s cubic-bezier(.2, .8, .25, 1); }
.drawer-r-leave-active { transition: transform .2s ease-in; }
.drawer-r-enter-from, .drawer-r-leave-to { transform: translateX(100%); }
.drawer-up-enter-active { transition: transform .3s cubic-bezier(.2, .8, .25, 1); }
.drawer-up-leave-active { transition: transform .2s ease-in; }
.drawer-up-enter-from, .drawer-up-leave-to { transform: translateY(100%); }

@media (max-width: 767px) {
  .drawer {
    top: auto;
    left: 0;
    right: 0;
    width: 100%;
    height: 85vh;
    border-radius: 6px 6px 0 0;
  }
  .drawer-head { padding: 14px 16px; }
  .drawer-body { padding: 14px 16px; }
  .drawer-foot { padding: 12px 16px; }
}
</style>
