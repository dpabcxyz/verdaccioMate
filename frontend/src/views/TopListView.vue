<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useStore } from '../store'
import PkgLogo from '../components/PkgLogo.vue'
import { Trophy, Refresh, Download } from '@element-plus/icons-vue'

const { state, refreshTopList, fetchTopList, pullTopList } = useStore()

const filter = ref('') // '' | missing | outdated | ready

// —— 虚拟滚动：榜单最多 1000 行，仅渲染可视区 ——
const ROW_H = 46            // 每行高度（px），需与 CSS 一致
const EXTRA = 10            // 可视区外上下各多渲染的行数，避免滚动穿帮
const BODY_MIN = 300        // 表格主体最小高度（px）
const gbodyH = ref(BODY_MIN) // 表格主体高度：基于浏览器可视高度动态计算
const bodyEl = ref(null)
const scrollTop = ref(0)

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - EXTRA))
const endIndex = computed(() => Math.min(rows.value.length, Math.ceil((scrollTop.value + gbodyH.value) / ROW_H) + EXTRA))
const visibleRows = computed(() => rows.value.slice(startIndex.value, endIndex.value))

function onScroll() {
  scrollTop.value = bodyEl.value ? bodyEl.value.scrollTop : 0
}

// 表格高度：填满剩余可视高度（min 300px），页面本身不出现垂直滚动条
function calcBody() {
  const el = bodyEl.value
  if (!el) return
  const reserve = window.innerWidth < 768 ? 96 : 34 // 底部预留：移动 Tabbar(≈56)+padding(40) / 桌面 padding(24)+容差，贴近底部充分利用高度
  gbodyH.value = Math.max(BODY_MIN, Math.floor(window.innerHeight - el.getBoundingClientRect().top - reserve))
}
let resizeTimer = null
function onWinResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(calcBody, 100)
}

onBeforeUnmount(() => {
  bodyEl.value = null
  window.removeEventListener('resize', onWinResize)
  clearTimeout(resizeTimer)
})

const PHASE_TEXT = {
  idle: '空闲',
  search: '搜索关键词中',
  recheck: '复核下载量中',
  compare: '比对缓存中',
  done: '完成',
}

/** 当前筛选下的列表 */
const rows = computed(() => {
  if (!filter.value) return state.toplist
  return state.toplist.filter(e => {
    if (filter.value === 'missing') return !e.cached
    if (filter.value === 'outdated') return e.cached && !e.latestCached
    if (filter.value === 'ready') return e.cached && e.latestCached
    return true
  })
})

const phaseText = computed(() => state.toplistProgress.running
  ? PHASE_TEXT[state.toplistProgress.phase] || '处理中'
  : '')

const fetchPercent = computed(() => {
  const t = state.toplistProgress.total
  return t ? Math.min(100, Math.round((state.toplistProgress.processed / t) * 100)) : 0
})
const pullPercent = computed(() => {
  const t = state.toplistPullProgress.total
  return t ? Math.min(100, Math.round((state.toplistPullProgress.processed / t) * 100)) : 0
})

function fmt(n) {
  if (n == null) return '0'
  return Number(n).toLocaleString('en-US')
}

function fmtDate(iso) {
  if (!iso) return '—'
  // ISO 字符串中的 T 替换为空格，截取到分钟（YYYY-MM-DD HH:mm）
  return String(iso).replace('T', ' ').slice(0, 16)
}

async function doFetch() {
  const r = await fetchTopList()
  if (!r.ok) ElMessage.error(r.message || '发起抓榜失败，请稍后重试')
}

async function doPull() {
  const r = await pullTopList()
  if (!r.ok) ElMessage.error(r.message || '发起拉取失败，请稍后重试')
}

onMounted(() => {
  window.addEventListener('resize', onWinResize)
  refreshTopList().then(() => nextTick(calcBody))
  setTimeout(calcBody, 400) // 路由过渡动画结束后重算，避免页面叠加期间 top 计算偏差
})

// 抓榜/拉取进度条出现或消失会改变表格位置，过渡后重算高度
watch([() => state.toplistProgress.running, () => state.toplistPullProgress.running], () => setTimeout(calcBody, 250))
</script>

<template>
  <div class="page">
    <div class="head">
      <div class="title">
        <h2><el-icon class="pt-ico"><Trophy /></el-icon>npm Top1000 周榜</h2>
        <span class="sub">每周一 00:00 自动抓取，据此缓存热门包最新版</span>
      </div>
    </div>

    <!-- 摘要条 -->
    <div class="summary">
      <span>共 <b>{{ state.toplistSummary.total || 0 }}</b></span>
      <span>已缓存 <b class="g">{{ state.toplistSummary.cached || 0 }}</b></span>
      <span>待拉取 <b class="r">{{ state.toplistSummary.missing || 0 }}</b></span>
      <span>需更新 <b class="y">{{ state.toplistSummary.outdated || 0 }}</b></span>
      <div class="dates">
        <span>下次抓榜 <b>{{ fmtDate(state.toplistNextRun) }}</b></span>
        <span>上次抓榜 <b>{{ fmtDate(state.toplistLastRun) }}</b></span>
      </div>
    </div>

    <!-- 抓榜进度 -->
    <div v-if="state.toplistProgress.running" class="bar">
      <div class="bar-head">
        <span>{{ phaseText }} · {{ state.toplistProgress.processed }}/{{ state.toplistProgress.total }}</span>
        <span>{{ fetchPercent }}%</span>
      </div>
      <div class="track"><div class="fill" :style="{ width: fetchPercent + '%' }"></div></div>
    </div>

    <!-- 拉取进度 -->
    <div v-if="state.toplistPullProgress.running" class="bar pull">
      <div class="bar-head">
        <span>正在拉取 {{ state.toplistPullProgress.current || '' }} · 成功 {{ state.toplistPullProgress.success }} · 失败 {{ state.toplistPullProgress.failed }}</span>
        <span>{{ state.toplistPullProgress.processed }}/{{ state.toplistPullProgress.total }}</span>
      </div>
      <div class="track"><div class="fill" :style="{ width: pullPercent + '%' }"></div></div>
    </div>

    <!-- 表格顶部工具栏：左筛选 tabs · 右抓榜/拉取按钮（两侧高度、圆角一致） -->
    <div class="toolbar">
      <div class="tabs">
        <span class="tab" :class="{ active: filter === '' }" @click="filter = ''">全部</span>
        <span class="tab" :class="{ active: filter === 'missing' }" @click="filter = 'missing'">待拉取</span>
        <span class="tab" :class="{ active: filter === 'outdated' }" @click="filter = 'outdated'">需更新</span>
        <span class="tab" :class="{ active: filter === 'ready' }" @click="filter = 'ready'">已就绪</span>
      </div>
      <div class="actions">
        <button class="tool-btn" :class="{ spin: state.toplistProgress.running }" :disabled="state.toplistProgress.running"
                title="立即抓榜（每周一 00:00 自动抓取 npm 周榜）" @click="doFetch"><span class="ico"><el-icon><Refresh /></el-icon></span></button>
        <button class="tool-btn" :class="{ spin: state.toplistPullProgress.running }" :disabled="state.toplistPullProgress.running"
                title="一键拉取榜单包最新版到缓存" @click="doPull"><span class="ico"><el-icon><Download /></el-icon></span></button>
      </div>
    </div>

    <!-- 空态 -->
    <div v-if="!state.toplist.length" class="empty">
      <div class="empty-emo"><el-icon><Trophy /></el-icon></div>
      <p>尚无 Top1000 数据，点击「立即抓榜」获取榜单</p>
    </div>

    <!-- 表格：固定表头 + 虚拟滚动主体 -->
    <div v-else class="gtable">
      <div class="ghead">
        <span>#</span>
        <span>包名</span>
        <span>最新版本</span>
        <span class="num">周下载</span>
        <span>状态</span>
        <span>已缓存版本</span>
      </div>
      <div ref="bodyEl" class="gbody" :style="{ height: gbodyH + 'px' }" @scroll.passive="onScroll">
        <div v-if="rows.length" class="gspacer" :style="{ height: rows.length * ROW_H + 'px' }">
          <div class="grow" v-for="(row, i) in visibleRows" :key="row.rank"
               :style="{ transform: `translateY(${(startIndex + i) * ROW_H}px)` }">
            <span class="dim">{{ row.rank }}</span>
            <span class="name"><PkgLogo :name="row.name" :size="22" /><span class="name-txt">{{ row.name }}</span></span>
            <span class="ver">{{ row.latestVersion }}</span>
            <span class="num">{{ fmt(row.weeklyDownload) }}</span>
            <span>
              <span v-if="!row.cached" class="tag warn">待拉取</span>
              <span v-else-if="!row.latestCached" class="tag broken">需更新</span>
              <span v-else class="tag ok">已就绪</span>
            </span>
            <span class="dim vs">{{ (row.cachedVersions || []).length ? row.cachedVersions.length + ' 个' : '—' }}</span>
          </div>
        </div>
        <div v-else class="no">当前筛选下无条目</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 22px 24px 24px; display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title h2 { font-size: 18px; margin: 0; letter-spacing: -.3px; line-height: 1; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.title .pt-ico { color: var(--acc); font-size: 19px; }
.sub { font-size: 12.5px; color: var(--ink-faint); display: inline-block; line-height: 1; }
.actions { display: flex; gap: 10px; }

.summary {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 14px 18px;
  background: var(--panel-soft); border: 1px solid var(--line); border-radius: var(--r-lg);
  font-size: 13px; color: var(--ink-dim);
}
.summary b { font-family: var(--num); color: var(--ink); }
.summary b.g { color: var(--suc-deep); }
.summary b.r { color: var(--dgr); }
.summary b.y { color: var(--warn); }
/* 大屏（≥1024px）：4 个统计项与日期行同占一行，日期推到最右 */
.summary .dates {
  flex: 1 1 auto;
  display: flex;
  justify-content: flex-end;
  column-gap: 24px;
  font-size: 12.5px;
}
/* 中小屏：日期行换到第二行独立展示，左右对齐 */
@media (max-width: 1023px) {
  .summary { gap: 10px 18px; }
  .summary .dates {
    width: 100%; flex: 0 0 100%;
    border-top: 1px dashed var(--line);
    padding-top: 10px;
    margin-top: 2px;
    justify-content: space-between;
  }
}

.bar .bar-head { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--ink-dim); margin-bottom: 7px; }
.track { height: 8px; border-radius: var(--r-md); background: var(--line); overflow: hidden; }
.fill { height: 100%; border-radius: var(--r-md); background: var(--pri); transition: width .3s; }
.bar.pull .fill { background: var(--acc); }

.toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.tab {
  padding: 7px 18px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
  color: var(--ink-dim); background: var(--card); border: 1.5px solid var(--line); cursor: pointer; transition: .16s;
}
.tab:hover { color: var(--acc); border-color: var(--acc); }
.tab.active { background: var(--pri); color: #fff; border-color: transparent; }
html.dark .tab.active { color: #141414; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 70px 0; color: var(--ink-faint);
}
.empty-emo { font-size: 34px; color: var(--ink-faint); }
.empty p { font-size: 14px; }

.gtable { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--card); overflow: hidden; }
.ghead, .grow {
  display: grid;
  grid-template-columns: 60px minmax(140px, 1fr) 120px 100px 110px 100px;
  align-items: center;
  padding: 0 16px;
  column-gap: 10px;
}
.ghead {
  height: 44px; font-size: 12px; color: var(--ink-faint); font-weight: 600;
  border-bottom: 1px solid var(--line); background: var(--panel-soft);
}
.gbody { position: relative; overflow-y: auto; }
.gspacer { position: relative; }
.grow {
  position: absolute; top: 0; left: 0; right: 0;
  height: 46px; font-size: 13.5px; border-bottom: 1px solid var(--line);
  will-change: transform;
}
.grow:hover { background: var(--panel-soft); }
.grow > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbody .num, .ghead .num { font-family: var(--num); }
.gbody .dim { color: var(--ink-faint); }
.gbody .name { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; font-family: var(--num); }
.gbody .name-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbody .ver { color: var(--suc-deep); font-family: var(--num); font-size: 12.5px; }
.gbody .vs { font-size: 12px; }
.no { text-align: center; color: var(--ink-faint); padding: 30px 0; }

@media (max-width: 767px) {
  .page { padding: 16px; }
  .actions { width: 100%; }
  .btn { flex: 1; }
  .summary { gap: 10px 14px; padding: 12px 14px; font-size: 12.5px; }
  .summary .dates { font-size: 12px; padding-top: 8px; }
}
</style>
