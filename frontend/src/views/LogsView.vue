<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Clock, Search, Close, Box } from '@element-plus/icons-vue'
import { useStore } from '../store'

const { state, refreshLogs } = useStore()
const route = useRoute()
const router = useRouter()
const detail = ref(null) // 查看日志详情的当前条
const filter = ref('pull') // 默认展示「拉取」日志
const filterOpen = ref(false) // 筛选面板展开/收起
const page = ref(1) // 当前页
const searchText = ref('') // 模糊检索关键字
const batchId = ref(null) // 来自通知跳转的批次筛选
const vtableEl = ref(null) // 表格容器：高度基于可视高度动态计算
const tableHeight = ref(300) // 表格可视高度（min 300px）
const pagerEl = ref(null) // 分页器：动态测量其高度计入底部预留

// 是否处于筛选状态（非默认「拉取」即视为已筛选，筛选按钮显示强调态）
const hasFilter = computed(() => filter.value !== 'pull')
// 各类型日志计数（后端返回，标签旁展示）
const counts = computed(() => state.logCounts || {})

// 筛选 tab：各日志类型（已移除「全部」，默认展示拉取）
const FILTERS = [
  { key: 'pull', label: '拉取' },
  { key: 'delete_version', label: '删除版本' },
  { key: 'scan', label: '扫描' },
  { key: 'login', label: '登录' },
  { key: 'user_sync', label: '同步' },
  { key: 'ignore', label: '忽略' },
  { key: 'mcp_call', label: 'MCP 调用' },
  { key: 'mcp_auth_fail', label: 'MCP 鉴权' },
  { key: 'mcp_key', label: 'MCP Key' },
]

// 拉取类 action 归为「拉取」分组；已剔除汇总行（sync / pull_toplist_summary），
// 只展示逐包拉取单（每包一条带批次号）
const PULL_ACTIONS = new Set(['sync_latest', 'pull_manual', 'pull_toplist'])
// 删除版本分组：delete_version + clean（旧批量清理汇总日志，向后兼容展示）
const DELETE_ACTIONS = new Set(['delete_version', 'clean'])
const PAGESIZE = 50

// 筛选 → 后端查询参数：分组用 actions 数组（多 action），其余用单 action
function tabQuery(key) {
  if (key === '' ) return { action: null, actions: null }
  if (key === 'pull') return { action: null, actions: [...PULL_ACTIONS] }
  if (key === 'delete_version') return { action: null, actions: [...DELETE_ACTIONS] }
  return { action: key, actions: null } // clean/scan/login/ignore 等单个 action
}

// 按当前筛选 + 页码加载（批号筛选时 batchId 生效，模糊检索时 q 生效）
async function loadLogs(p = 1) {
  const { action, actions } = tabQuery(filter.value)
  page.value = p
  await refreshLogs({
    action, actions,
    batchId: batchId.value || null,
    q: searchText.value.trim() || null,
    page: p, pageSize: PAGESIZE,
  })
}

// 搜索输入防抖：停止输入 300ms 后回到第 1 页重新检索
let searchTimer = null
watch(searchText, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadLogs(1), 300)
})

// 筛选面板展开/收起会改变表格位置，过渡结束后重算高度
let filterFitTimer = null
watch(filterOpen, () => {
  clearTimeout(filterFitTimer)
  filterFitTimer = setTimeout(calcTableHeight, 220)
})

function totalPages() {
  return Math.max(1, Math.ceil(state.logTotal / PAGESIZE))
}

function gotoPage(p) {
  const clamped = Math.min(Math.max(1, p), totalPages())
  if (clamped === page.value) return
  loadLogs(clamped)
}

let mountFitTimer = null
onMounted(() => {
  const { action, batchId: bid } = route.query
  if (bid) {
    batchId.value = String(bid)
    refreshLogs({ action: action || null, batchId: String(bid), page: 1, pageSize: PAGESIZE })
  } else {
    loadLogs(1)
  }
  window.addEventListener('resize', onWinResize)
  calcTableHeight() // 首帧渲染前先算好高度，避免 300px 占位期出现内部滚动条闪烁
  requestAnimationFrame(calcTableHeight) // 首帧后再校准一次
  nextTick(calcTableHeight)
  mountFitTimer = setTimeout(calcTableHeight, 400) // 路由过渡动画结束后重算，避免页面叠加期间 top 计算偏差
})

// 通知跳转带 batchId 时按批次筛选；切换回无 batchId 时恢复 tab 筛选
watch(() => route.query, (q) => {
  if (q.batchId) {
    batchId.value = String(q.batchId)
    refreshLogs({ action: q.action || null, batchId: String(q.batchId), page: 1, pageSize: PAGESIZE })
  } else {
    batchId.value = null
    loadLogs(1)
  }
})

function clearBatch() {
  router.replace('/logs')
}

async function switchFilter(key) {
  filter.value = key
  await loadLogs(1)
}

// 「清除筛选」：回到默认「拉取」并收起筛选 Verdaccio Mate
async function clearFilter() {
  filterOpen.value = false
  filter.value = 'pull'
  await loadLogs(1)
}

// 表格高度：基于浏览器可视高度动态计算（min 300px）
// 预留 = 分页器实际高度 + .page-inner 实际 padding-bottom（40px 桌面 / 96px 移动），充分利用高度且页面不出现垂直滚动条
function calcTableHeight() {
  const el = vtableEl.value
  if (!el) return
  const inner = el.closest('.page-inner')
  const bottomPad = inner ? (parseFloat(getComputedStyle(inner).paddingBottom) || 40) : 40
  const pagerH = pagerEl.value ? pagerEl.value.offsetHeight : 0
  tableHeight.value = Math.max(300, Math.floor(window.innerHeight - el.getBoundingClientRect().top - pagerH - bottomPad))
}
let resizeTimer = null
function onWinResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(calcTableHeight, 100)
}
// 分页器/筛选面板/批次横幅出现或消失都会改变表格顶部位置，渲染后重算，避免挤压出滚动条
watch([() => state.logTotal, filterOpen, batchId], () => nextTick(calcTableHeight))

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  clearTimeout(resizeTimer)
  clearTimeout(searchTimer)
  clearTimeout(filterFitTimer)
  clearTimeout(mountFitTimer)
})

/** 拉取汇总明细：优先 meta（结构化），回退旧 deletedVersions JSON */
function syncMeta(log) {
  try {
    if (log.meta) return JSON.parse(log.meta)
    return JSON.parse(log.deletedVersions || '{}')
  } catch {
    return {}
  }
}

// meta 字段是后端写入的 JSON 字符串，脏数据/截断都可能让解析抛错，
// 统一走这层兜底：模板里裸调 JSON.parse 会让整条详情抽屉渲染失败
function metaOf(log) {
  try {
    return JSON.parse(log.meta || '{}') || {}
  } catch {
    return {}
  }
}

function scanDetailText(log) {
  const m = metaOf(log)
  return log.message || (m.packages ? `${m.packages} 个包` : '—')
}

function fmtTime(t) {
  return (t || '').replace('T', ' ').slice(0, 19)
}

// 版本/详情列：按 action 显示版本号或计数
function versionText(log) {
  if (log.action === 'clean') return `− ${log.deletedCount} 版`
  if (log.version) return log.version
  return '—'
}

// ==== 动态列：按筛选类型展示不同字段 ====
const cellTime = l => ({ t: fmtTime(l.created_at), c: '' })
const cellPkg = l => ({ t: pkgNameText(l), c: 'pkg-cell' })
const cellType = l => { const m = actionMeta(l.action); return { t: m.text, c: 'act-badge ' + m.cls } }
const cellVer = l => {
  if (l.action === 'clean') return { t: `− ${l.deletedCount} 版`, c: 'chip n' }
  if (l.action === 'delete_version') return { t: l.version, c: 'ver' }
  if (l.version) return { t: l.version, c: 'ver' }
  return { t: '—', c: 'dash' }
}
const cellResult = l => {
  const t = resultText(l)
  if (t === '—') return { t, c: 'dash' }
  const cls = resultCls(l) === 'ok' ? 'ok' : (resultCls(l) === 'err' ? 'warn' : 'gray')
  return { t, c: 'tag ' + cls }
}
const cellVersion = l => {
  if (l.version) return { t: l.version, c: 'ver' }
  return { t: '—', c: 'dash' }
}
const cellDuration = l => ({ t: l.duration_ms ? (l.duration_ms / 1000).toFixed(1) + 's' : '—', c: '' })
const cellPkgs = l => {
  try {
    const m = JSON.parse(l.meta || '{}')
    return { t: m.packages ? `${m.packages} 个包` : '—', c: m.packages ? 'np' : '' }
  } catch { return { t: '—', c: '' } }
}
const cellScanBytes = l => {
  try {
    const m = JSON.parse(l.meta || '{}')
    const b = Number(m.bytes || 0)
    return { t: b ? (b / 1024 / 1024).toFixed(1) + ' MB' : '—', c: b ? '' : 'dash' }
  } catch { return { t: '—', c: 'dash' } }
}
const cellUser = l => ({ t: l.pkgName || '—', c: 'pkg-cell' })
const cellIp = l => ({ t: l.ip || '—', c: '' })
const cellPullType = l => {
  const isTop = ['pull_toplist', 'pull_toplist_summary'].includes(l.action)
  return { t: isTop ? '拉取榜单' : '拉取存量包', c: 'tag ign' }
}
// 任务类型：定时任务=自动，其余=手工（拉取日志 meta.taskType）
const cellTaskType = l => {
  let m = {}
  try { m = JSON.parse(l.meta || '{}') } catch {}
  return { t: m.taskType === 'auto' ? '自动' : '手工', c: 'chip ' + (m.taskType === 'auto' ? 'auto' : 'man') }
}
// 批次号：批量拉取用 batchId 派生的短批次号，单个手工拉取无批次显示 '—'
const cellBatch = l => {
  const b = l.batchId
  if (!b) return { t: '—', c: 'dash' }
  const short = String(b).replace(/-/g, '').slice(-8).toUpperCase()
  return { t: `#${short}`, c: 'chip batch' }
}
// 用户名：定时任务（user 为空）显示 '—'
const cellUserName = l => {
  let m = {}
  try { m = JSON.parse(l.meta || '{}') } catch {}
  return { t: m.user || '—', c: m.user ? '' : 'dash' }
}
// 版本数：忽略日志 meta.versionCount
const cellVerCount = l => {
  let m = {}
  try { m = JSON.parse(l.meta || '{}') } catch {}
  const v = Number(m.versionCount)
  return { t: v ? `${v} 版` : '—', c: v ? 'chip n' : 'dash' }
}
// MCP 鉴权失败：原因取 message；Key 指纹是哈希前 8 位，用于归并同一把坏 Key 的重复尝试
const cellMcpReason = l => ({ t: l.message || '—', c: '' })
const cellKeyFingerprint = l => {
  let m = {}
  try { m = JSON.parse(l.meta || '{}') } catch {}
  return { t: m.keyFingerprint ? `…${m.keyFingerprint}` : '—', c: m.keyFingerprint ? '' : 'dash' }
}

// 列：{ key, label, w?, cell }。key='op' 为详情按钮特殊列
const colTime = { key: 'time', label: '时间', cell: cellTime }
const colDelTime = { key: 'deltime', label: '删除时间', cell: cellTime }
const colPkg = { key: 'pkg', label: '包名', cell: cellPkg }
const colType = { key: 'type', label: '操作类型', w: '130px', cell: cellType }
const colVer = { key: 'ver', label: '版本/详情', w: '110px', cell: cellVer }
const colVersion = { key: 'version', label: '版本号', w: '140px', cell: cellVersion }
const colResult = { key: 'result', label: '结果', w: '100px', cell: cellResult }
const colOp = { key: 'op', label: '操作', w: '80px', cell: null }
const colDuration = { key: 'dur', label: '耗时', w: '80px', cell: cellDuration }
const colPkgs = { key: 'pkgs', label: '包数量', w: '120px', cell: cellPkgs }
const colScanBytes = { key: 'scanbytes', label: '占用空间', w: '110px', cell: cellScanBytes }
const colUser = { key: 'user', label: '用户名', w: '140px', cell: cellUser }
const colIp = { key: 'ip', label: 'IP', w: '130px', cell: cellIp }
const colPullType = { key: 'pulltype', label: '拉取类型', w: '110px', cell: cellPullType }
const colTaskType = { key: 'tasktype', label: '任务类型', w: '90px', cell: cellTaskType }
const colUserName = { key: 'username', label: '操作人', w: '100px', cell: cellUserName }
const colBatch = { key: 'batch', label: '批次号', w: '110px', cell: cellBatch }
const colOperator = { key: 'operator', label: '操作人', w: '100px', cell: cellUserName }
const colVerCount = { key: 'vercount', label: '版本数', w: '90px', cell: cellVerCount }
const colVerNum = { key: 'vernum', label: '版本号', w: '110px', cell: cellVer }

// 序号列（跨页连续编号）
const colIndex = { key: 'idx', label: '#', w: '64px', cell: null }

// 各筛选 tab 的列集合：按日志类型动态展示各自字段
const COLSET = {
  all: [colIndex, colTime, colPkg, colType, colVer, colResult, colOp],
  delete_version: [colIndex, colDelTime, colPkg, colVersion, colOperator, colResult, colOp],
  pull: [colIndex, colTime, colPullType, colTaskType, colUserName, colBatch, colPkg, colVerNum, colResult, colOp],
  scan: [colIndex, colTime, colScanBytes, colPkgs, colResult, colOp],
  login: [colIndex, colTime, colUser, colResult, colOp],
  user_sync: [colIndex, colTime, colUser, colResult, colOp],
  ignore: [colIndex, colTime, colPkg, colVerCount, colOperator, colOp],
  mcp_call: [colIndex, colTime,
    { key: 'tool', label: '工具', cell: l => ({ t: syncMeta(l).tool || '—', c: '' }) },
    { key: 'keyName', label: 'Key 名称', cell: l => ({ t: syncMeta(l).keyName || '—', c: '' }) },
    { key: 'duration', label: '耗时', w: '80px', cell: l => ({ t: `${l.duration_ms || 0} ms`, c: '' }) },
    colResult, colOp],
  mcp_auth_fail: [colIndex, colTime,
    { key: 'reason', label: '原因', cell: cellMcpReason },
    { key: 'fingerprint', label: 'Key 指纹', w: '110px', cell: cellKeyFingerprint },
    colIp, colResult, colOp],
  mcp_key: [colIndex, colTime,
    { key: 'message', label: '事件', cell: l => ({ t: l.message || '—', c: '' }) },
    colResult, colOp],
}
const activeCols = computed(() => COLSET[filter.value] || COLSET.all)
function cellText(c, log) { return c.cell ? c.cell(log).t : '' }
function cellClass(c, log) { return c.cell ? c.cell(log).c : undefined }
// 包名列展示
function pkgNameText(log) {
  if (log.action === 'scan') return '全目录'
  if (log.action === 'login') return log.pkgName || '—'
  if (log.action === 'user_sync') return '同步用户名'
  if (log.action === 'sync') return '批量拉取汇总'
  return log.pkgName
}
// 结果徽章
function resultMeta(log) {
  const r = log.result
  if (r === 'success') return { text: '成功', cls: 'ok' }
  if (r === 'fail') return { text: '失败', cls: 'err' }
  if (r === 'skipped') return { text: '跳过', cls: 'skip' }
  return { text: '—', cls: 'na' }
}
function resultText(log) {
  if (log.action === 'scan') return log.result === 'success' ? '成功' : (log.result === 'fail' ? '失败' : '—')
  if (log.action === 'login') return log.result === 'success' ? '成功' : '失败'
  return resultMeta(log).text
}
function resultCls(log) {
  if (log.action === 'scan' || log.action === 'login') return log.result === 'success' ? 'ok' : (log.result === 'fail' ? 'err' : 'na')
  return resultMeta(log).cls
}

// 操作类型 → 徽标文案/class
function actionMeta(action) {
  const map = {
    clean: { text: '清理', cls: 'clean' },
    delete_version: { text: '删版本', cls: 'clean' },
    sync: { text: '批量拉取汇总', cls: 'sync' },
    user_sync: { text: '同步用户名', cls: 'sync' },
    sync_latest: { text: '拉取最新', cls: 'sync' },
    pull_manual: { text: '手工拉取', cls: 'sync' },
    pull_toplist: { text: '榜单拉取', cls: 'sync' },
    pull_toplist_summary: { text: '榜单拉取汇总', cls: 'sync' },
    scan: { text: '扫描', cls: 'scan' },
    login: { text: '登录', cls: 'login' },
    ignore: { text: '忽略', cls: 'ignore' },
    unignore: { text: '取消忽略', cls: 'unignore' },
    mcp_call: { text: 'MCP 调用', cls: 'scan' },
    mcp_auth_fail: { text: 'MCP 鉴权', cls: 'login' },
    mcp_key: { text: 'MCP Key', cls: 'login' },
  }
  return map[action] || { text: action, cls: 'clean' }
}

function detailTitle(log) {
  return actionMeta(log.action).text
}
</script>

<template>
  <div class="page-inner">
    <div class="page-title"><el-icon class="pt-ico" :size="16"><Clock /></el-icon>最近动态</div>

    <!-- 模糊检索 + 筛选按钮 + 筛选面板 -->
    <div class="tool-bar">
      <div class="search-box">
        <el-icon class="search-ico" :size="13"><Search /></el-icon>
        <input
          v-model="searchText"
          class="search-input"
          placeholder="检索 包名 / 版本 / 结果 / 操作人 / 批次号…"
          @keydown.enter="loadLogs(1)"
        />
        <span v-if="searchText" class="search-clear" @click="searchText = ''"><el-icon :size="12"><Close /></el-icon></span>
      </div>
      <button
        class="filter-btn"
        :class="{ on: filterOpen || hasFilter }"
        :title="hasFilter ? '当前已筛选：' + FILTERS.find(f => f.key === filter).label : '筛选日志类型'"
        @click="filterOpen = !filterOpen"
      >筛选 <span class="fb-dot" v-if="hasFilter"></span> <span class="fb-arrow">{{ filterOpen ? '▲' : '▼' }}</span></button>
    </div>

    <Transition name="fp-drop">
      <div v-if="filterOpen" class="filter-panel">
        <div class="fp-title">操作类型（单选）</div>
        <div class="fp-tags">
          <button
            v-for="f in FILTERS"
            :key="f.key"
            class="fp-tag"
            :class="{ active: filter === f.key }"
            :aria-pressed="filter === f.key ? 'true' : 'false'"
            @click="switchFilter(f.key)"
          >{{ f.label }} <span class="fp-count">{{ counts[f.key] ?? 0 }}</span></button>
        </div>
        <div class="fp-foot">
          <button v-if="hasFilter" class="fp-clear" @click="clearFilter">清除筛选</button>
          <button v-else class="fp-clear" disabled>当前为默认类型</button>
        </div>
      </div>
    </Transition>

    <!-- 批次筛选横幅（来自通知跳转） -->
    <div v-if="batchId" class="batch-bar">
      <span class="batch-txt"><el-icon :size="13"><Box /></el-icon> 已按批次筛选，共 {{ state.logTotal }} 条</span>
      <button class="batch-clear" @click="clearBatch">清除</button>
    </div>

    <div ref="vtableEl" class="vtable" :style="{ height: tableHeight + 'px' }">
      <table>
        <thead>
          <tr>
            <th v-for="c in activeCols" :key="c.key" :style="c.w ? { width: c.w } : undefined">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(log, i) in state.logs" :key="log.id">
            <tr @click="detail = log">
              <td v-for="c in activeCols" :key="c.key" @click.stop>
                <template v-if="c.key === 'op'">
                  <button class="btn unignore op-btn-cell" @click.stop="detail = log">详情</button>
                </template>
                <template v-else-if="c.key === 'idx'">
                  <span class="idx">{{ (state.logPage - 1) * PAGESIZE + i + 1 }}</span>
                </template>
                <span v-else :class="cellClass(c, log)">{{ cellText(c, log) }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="!state.logs.length" class="empty-tip">暂无操作记录，清理、拉取、扫描、登录等操作会自动记录在这里</div>
    </div>

    <!-- 分页器 -->
    <div v-if="state.logTotal > 0" ref="pagerEl" class="paginator">
      <button class="pg-btn" :disabled="state.logPage <= 1" @click="gotoPage(state.logPage - 1)">‹ 上一页</button>
      <span class="pg-info">第 <b>{{ state.logPage }}</b> / {{ totalPages() }} 页 · 共 {{ state.logTotal }} 条</span>
      <button class="pg-btn" :disabled="state.logPage >= totalPages()" @click="gotoPage(state.logPage + 1)">下一页 ›</button>
    </div>
  </div>

  <!-- 日志详情弹窗 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="detail" class="ov" @click.self="detail = null"></div>
    </Transition>
    <Transition name="pop">
      <div v-if="detail" class="detail-dialog">
        <div class="dd-head">
          <span class="dd-title">{{ detailTitle(detail) }}</span>
          <div class="dd-close" @click="detail = null"><el-icon :size="12"><Close /></el-icon></div>
        </div>
        <div class="dd-body">
          <template v-if="detail.action === 'clean'">
            <div class="dd-row"><span class="k">包名</span><span class="v">{{ detail.pkgName }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">删除数量</span><span class="v red">− {{ detail.deletedCount }} 个版本</span></div>
            <div class="dd-row"><span class="k">释放空间</span><span class="v green">{{ detail.freedSpace }}</span></div>
            <div class="dd-row"><span class="k">删除版本</span>
              <div class="dd-tags">
                <span v-for="v in (detail.deletedVersions || '').split(',').map(s => s.trim()).filter(Boolean)" :key="v" class="dd-tag">{{ v }}</span>
              </div>
            </div>
          </template>

          <template v-else-if="detail.action === 'sync'">
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">批次结果</span><span class="v">成功 <b class="green">+{{ syncMeta(detail).success || 0 }}</b> · 跳过 <b>{{ syncMeta(detail).skipped || 0 }}</b> · 失败 <b class="red">{{ (syncMeta(detail).failed || []).length }}</b></span></div>
            <div class="dd-row"><span class="k">耗时</span><span class="v">{{ detail.duration_ms ? ((detail.duration_ms / 1000).toFixed(1) + 's') : '—' }}</span></div>
            <div v-if="(syncMeta(detail).failed || []).length" class="dd-row"><span class="k">失败包</span>
              <div class="dd-tags">
                <span v-for="f in syncMeta(detail).failed" :key="f.name" class="dd-tag" :title="f.reason">{{ f.name }}</span>
              </div>
            </div>
          </template>

          <template v-else-if="detail.action === 'scan'">
            <div class="dd-row"><span class="k">包名</span><span class="v">全目录</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">结果</span><span class="v" :class="detail.result === 'fail' ? 'red' : 'green'">{{ detail.result === 'success' ? '扫描成功' : '扫描失败' }}</span></div>
            <div class="dd-row"><span class="k">耗时</span><span class="v">{{ detail.duration_ms ? ((detail.duration_ms / 1000).toFixed(1) + 's') : '—' }}</span></div>
            <div v-if="detail.meta" class="dd-row"><span class="k">详情</span><span class="v">{{ scanDetailText(detail) }}</span></div>
            <div v-if="detail.message" class="dd-row"><span class="k">说明</span><span class="v" style="white-space:pre-wrap">{{ detail.message }}</span></div>
          </template>

          <template v-else-if="detail.action === 'login'">
            <div class="dd-row"><span class="k">用户名</span><span class="v">{{ detail.pkgName }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">结果</span><span class="v" :class="detail.result === 'success' ? 'green' : 'red'">{{ detail.result === 'success' ? '登录成功' : '登录失败' }}</span></div>
            <div class="dd-row"><span class="k">IP</span><span class="v">{{ detail.ip || '—' }}</span></div>
            <div v-if="detail.message" class="dd-row"><span class="k">原因</span><span class="v">{{ detail.message }}</span></div>
            <div v-if="detail.meta" class="dd-row"><span class="k">UA</span><span class="v" style="font-size:11px;font-weight:400">{{ metaOf(detail).userAgent || '—' }}</span></div>
          </template>

          <template v-else-if="detail.action === 'delete_version' || detail.action === 'pull_manual' || detail.action === 'pull_toplist'">
            <div class="dd-row"><span class="k">包名</span><span class="v">{{ detail.pkgName }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">版本</span><span class="v">{{ detail.version || '—' }}</span></div>
            <div class="dd-row"><span class="k">结果</span><span class="v" :class="resultCls(detail) === 'err' ? 'red' : (resultCls(detail) === 'ok' ? 'green' : '')">{{ resultText(detail) }}</span></div>
            <div v-if="detail.message" class="dd-row"><span class="k">说明</span><span class="v">{{ detail.message }}</span></div>
          </template>

          <template v-else-if="detail.action === 'sync_latest'">
            <div class="dd-row"><span class="k">包名</span><span class="v">{{ detail.pkgName }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">最新版</span><span class="v">{{ detail.version || '—' }}</span></div>
            <div class="dd-row"><span class="k">结果</span><span class="v" :class="resultCls(detail) === 'err' ? 'red' : (resultCls(detail) === 'ok' ? 'green' : '')">{{ resultText(detail) }}</span></div>
            <div v-if="detail.message" class="dd-row"><span class="k">说明</span><span class="v">{{ detail.message }}</span></div>
          </template>

          <template v-else-if="detail.action === 'mcp_auth_fail'">
            <div class="dd-row"><span class="k">原因</span><span class="v">{{ detail.message || '—' }}</span></div>
            <div class="dd-row"><span class="k">来源 IP</span><span class="v">{{ detail.ip || '—' }}</span></div>
            <div v-if="syncMeta(detail).keyFingerprint" class="dd-row"><span class="k">Key 指纹</span><span class="v">…{{ syncMeta(detail).keyFingerprint }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
          </template>

          <template v-else-if="detail.action === 'mcp_call' || detail.action === 'mcp_key'">
            <div class="dd-row"><span class="k">Key 名称</span><span class="v">{{ syncMeta(detail).keyName || '—' }}</span></div>
            <div class="dd-row"><span class="k">权限</span><span class="v">{{ syncMeta(detail).scope || '—' }}</span></div>
            <div v-if="detail.action === 'mcp_call'" class="dd-row"><span class="k">工具</span><span class="v">{{ syncMeta(detail).tool || '—' }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">结果</span><span class="v">{{ resultText(detail) }}</span></div>
            <div v-if="detail.action === 'mcp_call'" class="dd-row"><span class="k">耗时</span><span class="v">{{ detail.duration_ms || 0 }} ms</span></div>
            <div v-if="detail.message && detail.message !== syncMeta(detail).tool" class="dd-row"><span class="k">说明</span><span class="v">{{ detail.message }}</span></div>
          </template>

          <template v-else>
            <!-- ignore / unignore / 兜底 -->
            <div class="dd-row"><span class="k">包名</span><span class="v">{{ detail.pkgName }}</span></div>
            <div class="dd-row"><span class="k">操作时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
            <div class="dd-row"><span class="k">说明</span>
              <span class="v">{{ detail.action === 'ignore' ? '已将包加入忽略列表，不再提示超阈值警告' : detail.action === 'unignore' ? '已取消忽略，恢复超阈值提醒' : (detail.message || '—') }}</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 操作日志底部留白收敛：桌面 .page-inner padding-bottom 40→16，移动端保持 96 给底部 Tabbar 占流 */
.page-inner { padding-bottom: 16px; }
@media (max-width: 767px) {
  .page-inner { padding-bottom: 96px; }
}
.pkg-cell { font-weight: 600; word-break: break-all; }
.np { font-family: var(--num); font-weight: 600; white-space: nowrap; }
.page-title .pt-ico { color: var(--ink-dim); vertical-align: -2px; margin-right: 6px; }
.paginator { display: flex; align-items: center; justify-content: flex-start; gap: 14px; padding: 14px 2px 4px; }
.pg-btn { padding: 6px 16px; border: 1px solid var(--line); background: transparent; color: var(--ink-dim);
  border-radius: 4px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: .15s; }
.pg-btn:hover:not(:disabled) { border-color: var(--acc); color: var(--acc); }
.pg-btn:disabled { opacity: .4; cursor: default; }
.pg-info { font-size: 12.5px; color: var(--ink-dim); }
.pg-info b { color: var(--acc); font-family: var(--num); }
.act-badge { font-family: var(--num); font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 3px; display: inline-block; white-space: nowrap; }
.act-badge.clean { color: var(--dgr); background: var(--dgr-soft); }
.act-badge.ignore { color: var(--ink-dim); background: var(--num-bg); }
.act-badge.unignore { color: var(--suc-deep); background: var(--suc-soft); }
.act-badge.sync { color: var(--inf); background: var(--inf-soft); }
.act-badge.scan { color: var(--ink-dim); background: var(--num-bg); }
.act-badge.login { color: var(--acc); background: var(--acc-soft); }
.chip { font-family: var(--num); font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 3px; display: inline-block; white-space: nowrap; }
.chip.n { color: var(--warn); background: var(--warn-soft); }
.chip.batch { color: var(--inf); background: var(--inf-soft); }
.ver { font-family: var(--num); font-size: 12px; font-weight: 600; color: var(--acc); }
.dash { color: var(--ink-faint); }
.green { font-family: var(--num); font-size: 12px; font-weight: 600; color: var(--suc-deep); }
.empty-tip { padding: 50px 0; text-align: center; color: var(--ink-faint); font-size: 13px; }

/* 表格区域：高度由 JS 动态计算，内容超限时内部滚动，表头吸顶 */
.vtable { overflow-y: auto; overflow-x: hidden; }
.vtable thead th { position: sticky; top: 0; z-index: 2; }
.idx { font-family: var(--num); font-size: 12.5px; color: var(--ink-faint); }

/* 顶部：搜索 + 筛选按钮 + 筛选面板（按效果图：搜索主导、筛选辅助） */
.tool-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.search-box { position: relative; display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
.search-ico { position: absolute; left: 13px; font-size: 13px; color: var(--ink-faint); pointer-events: none; }
.search-input {
  width: 100%; padding: 9px 34px 9px 34px; border: 1px solid var(--line); border-radius: 4px;
  background: var(--card); color: var(--ink); font-size: 13px; outline: none; transition: .15s;
}
.search-input::placeholder { color: var(--ink-faint); }
.search-input:focus { border-color: var(--pri); }
.search-clear { position: absolute; right: 12px; color: var(--ink-dim); cursor: pointer; font-size: 12px; display: grid; place-items: center; }
.search-clear:hover { color: var(--acc); }

/* 筛选按钮：白底细边框圆角，与搜索框等高 */
.filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 14px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--card);
  color: var(--ink-dim); font-size: 13px; font-weight: 600; cursor: pointer; transition: .15s;
  flex-shrink: 0; position: relative;
}
.filter-btn:hover { border-color: var(--acc); color: var(--acc); }
.filter-btn.on { border-color: var(--acc); color: var(--acc); }
.fb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); }
.fb-arrow { font-size: 9px; opacity: .8; }

/* 筛选面板：白卡 + 阴影，单选标签 */
.filter-panel {
  margin: -2px 0 10px; padding: 14px 16px;
  background: var(--card); border: 1px solid var(--line); border-radius: 6px;
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, .18);
}
.fp-title { font-size: 12px; color: var(--ink-faint); margin-bottom: 10px; font-weight: 600; }
.fp-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.fp-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--card);
  color: var(--ink-dim); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: .15s;
}
.fp-tag .fp-count { font-family: var(--num); font-size: 11.5px; opacity: .6; }
.fp-tag:hover { border-color: var(--acc); color: var(--acc); }
.fp-tag.active { background: var(--pri); color: #fff; border-color: var(--pri); }
html.dark .fp-tag.active { color: #141414; }
.fp-tag.active .fp-count { opacity: .95; }
.fp-foot { display: flex; justify-content: flex-end; }
.fp-clear { border: none; background: transparent; color: var(--acc); font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 2px 4px; }
.fp-clear:hover { text-decoration: underline; }
.fp-clear:disabled { color: var(--ink-faint); cursor: default; text-decoration: none; }

/* 筛选面板展开动画 */
.fp-drop-enter-active { transition: opacity .2s, transform .2s; }
.fp-drop-leave-active { transition: opacity .15s, transform .15s; }
.fp-drop-enter-from, .fp-drop-leave-to { opacity: 0; transform: translateY(-4px); }

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: var(--acc-soft);
  border: 1px solid var(--acc-line);
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--acc);
  font-weight: 600;
}
.batch-txt { display: inline-flex; align-items: center; gap: 6px; }
.batch-clear {
  border: none;
  background: transparent;
  color: var(--acc);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.batch-clear:hover { color: var(--acc-h); }

.ov {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0, 0, 0, .45);
}
.detail-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(440px, 92vw);
  z-index: 501;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 30px 80px -24px rgba(0, 0, 0, .5);
  overflow: hidden;
}
.dd-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.dd-title { font-size: 14px; font-weight: 600; }
.dd-close {
  width: 28px; height: 28px; border-radius: 4px; display: grid; place-items: center;
  cursor: pointer; background: var(--card); border: 1px solid var(--line); color: var(--ink-dim); font-size: 12px;
}
.dd-close:hover { background: var(--dgr-soft); color: var(--dgr); border-color: var(--dgr-line); }
.dd-body { padding: 16px 20px; }
.dd-row { display: flex; align-items: flex-start; gap: 14px; padding: 8px 0; font-size: 13px; }
.dd-row .k { flex-shrink: 0; width: 70px; color: var(--ink-faint); font-size: 12px; padding-top: 2px; }
.dd-row .v { font-weight: 600; word-break: break-all; font-family: var(--num); }
.dd-row .v.red { color: var(--dgr); }
.dd-row .v.green { color: var(--suc-deep); }
.dd-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.dd-tag {
  font-family: var(--num); font-size: 12px; font-weight: 600;
  padding: 3px 10px; border-radius: 3px;
  background: var(--warn-soft); color: var(--warn);
}

.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.pop-enter-active { transition: transform .3s cubic-bezier(.2, .8, .25, 1), opacity .3s; }
.pop-leave-active { transition: transform .2s ease-in, opacity .2s; }
.pop-enter-from, .pop-leave-to { transform: translate(-50%, -46%) scale(.96); opacity: 0; }
</style>