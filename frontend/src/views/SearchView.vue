<script setup>
import { ref, watch, onMounted } from 'vue'
import { Loading, Download, Pointer, Operation, Check, Sort, Close } from '@element-plus/icons-vue'
import SearchBar from '../components/SearchBar.vue'
import SearchDialogs from '../components/SearchDialogs.vue'
import PackageDrawer from '../components/PackageDrawer.vue'
import CleanDialog from '../components/CleanDialog.vue'
import StatusTag from '../components/StatusTag.vue'
import PkgLogo from '../components/PkgLogo.vue'
import { useStore, fmtSize } from '../store'
// ElMessageBox 此前未显式 import（函数式 API 不在 auto-import resolver 覆盖内），此处补齐
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePackageSearch } from '../composables/usePackageSearch'
import { useVirtualScroll } from '../composables/useVirtualScroll'

const { state, refreshPackages, ignorePkg, unignorePkg, deleteVersion, syncLatest } = useStore()

// —— 搜索/筛选/历史/联想/下拉菜单（composable 抽离） ——
const {
  keyword, statusFilter, originFilter, sortMode,
  todayStr, todayFilter, clearTodayFilter,
  searchHistory, submitSearch, useHistory, clearHistory,
  suggestOpen, suggestList, useSuggest,
  filterOpen, sortOpen, toggleFilter, toggleSort, pickFilter, pickOrigin, pickSort,
  filtered, initFromRoute, pills,
} = usePackageSearch({ state, refreshPackages })
onMounted(initFromRoute)

// —— 虚拟滚动与容器限高（composable 抽离） ——
const { vWrapEl, pageRoot, visibleRows, vTopPad, vBottomPad, onVScroll } = useVirtualScroll({ filtered, state, searchHistory })

// —— 抽屉 / 清理 ——
const drawerPkg = ref(null)
const drawerVisible = ref(false)
const cleanVisible = ref(false)
const cleanPkgData = ref(null)

function openDrawer(pkg) {
  // 版本明细由 PackageDrawer 打开后按需加载
  drawerPkg.value = pkg
  drawerVisible.value = true
}
function openClean(pkg) {
  cleanPkgData.value = pkg
  cleanVisible.value = true
}
async function doIgnore(pkg) {
  const r = await ignorePkg(pkg.name, pkg.versions)
  if (r.ok) ElMessage.success(`已忽略 ${pkg.name}`)
  else ElMessage.error(r.message || '忽略失败，请稍后重试')
}
async function doUnignore(pkg) {
  const r = await unignorePkg(pkg.name, pkg.versions)
  if (r.ok) ElMessage.success(`已移出忽略 ${pkg.name}`)
  else ElMessage.error(r.message || '移出忽略失败，请稍后重试')
}
async function doDeleteVersion(pkg, version) {
  try {
    await ElMessageBox.confirm(
      `确定删除 ${pkg.name} 的版本 ${version} 吗？删除后不可恢复。`,
      '删除版本',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'is-danger' },
    )
  } catch {
    return // 用户取消
  }
  const r = await deleteVersion(pkg.name, version)
  if (r.ok) ElMessage.success(`已删除 ${version}，释放 ${r.freedSpace}，后台扫描中`)
  else ElMessage.warning(r.message || '删除失败')
}
async function onCleanConfirmed(res) {
  ElMessage.success(`已清理 ${res.deletedCount} 个版本，释放 ${res.freedSpace}，后台扫描中`)
  drawerVisible.value = false
}

// —— 一键拉取存量包最新版本 ——
const summaryShown = ref(false)
const syncConfirmOpen = ref(false)
const syncResultOpen = ref(false)
const syncResultDetail = ref('')
const syncResultFailed = ref(false)
// 手工拉取弹窗开关（表单状态内聚在 SearchDialogs）
const pullOpen = ref(false)

function openSyncConfirm() {
  if (state.syncProgress.running) return
  syncConfirmOpen.value = true
}
async function confirmSyncLatest() {
  syncConfirmOpen.value = false
  summaryShown.value = false
  const res = await syncLatest()
  if (!res.ok) {
    ElMessage.error(res.message || '发起拉取失败，请稍后重试')
    return
  }
  if (res.demo) {
    ElMessage.info(res.message || '演示模式：不支持拉取最新版本')
    return
  }
  // 任务异步执行，完成后由下方 watch 弹出汇总
}

watch(
  () => state.syncProgress.running,
  async (running, prev) => {
    if (prev === true && running === false && state.syncProgress.done && !summaryShown.value) {
      summaryShown.value = true
      const sp = state.syncProgress
      const detail = [`本次共检查 ${sp.total} 个存量包：`, `已拉取最新版本 ${sp.success} 个`, `已是最新跳过 ${sp.skipped} 个`]
      if (sp.failed) {
        detail.push(`拉取失败 ${sp.failed} 个`)
        if (sp.failedList.length) detail.push(`失败明细：\n${sp.failedList.map(f => `· ${f.name}：${f.reason}`).join('\n')}`)
      }
      syncResultDetail.value = detail.join('\n')
      syncResultFailed.value = !!sp.failed
      syncResultOpen.value = true
    }
  },
)

function doSyncLatest() {
  openSyncConfirm()
}
</script>

<template>
  <div class="page-inner" ref="pageRoot">
    <SearchBar
      v-model:keyword="keyword"
      v-model:suggestOpen="suggestOpen"
      :suggest-list="suggestList"
      :search-history="searchHistory"
      @submit="submitSearch"
      @use-suggest="useSuggest"
      @use-history="useHistory"
      @clear-history="clearHistory"
    />

    <!-- 表格工具栏：左侧结果数 + 右侧筛选/排序下拉 -->
    <div class="toolbar">
      <div class="tb-count">
        共找到 <b>{{ filtered.length }}</b> 个包
        <template v-if="keyword">（关键词「{{ keyword }}」）</template>
        <template v-if="todayFilter">（<span class="today-chip">仅今日更新 {{ todayStr }} <i @click="clearTodayFilter" title="清除筛选"><el-icon :size="9"><Close /></el-icon></i></span>）</template>
      </div>
      <div class="tb-actions">
        <button
          class="dd-btn sync-btn"
          :class="{ on: state.syncProgress.running }"
          :title="state.syncProgress.running ? `正在拉取… ${state.syncProgress.processed}/${state.syncProgress.total}` : '一键拉取存量包最新版本'"
          @click.stop="doSyncLatest"
        >
          <span :class="state.syncProgress.running ? 'sync-spin' : ''">
            <el-icon :size="15"><Loading v-if="state.syncProgress.running" /><Download v-else /></el-icon>
          </span>
        </button>
        <button class="dd-btn" title="手工拉取指定包版本" @click.stop="pullOpen = true"><el-icon :size="15"><Pointer /></el-icon></button>
        <div class="dd">
          <button class="dd-btn" :class="{ on: filterOpen }" title="快捷筛选" @click.stop="toggleFilter"><el-icon :size="15"><Operation /></el-icon></button>
          <Transition name="dd">
            <div v-if="filterOpen" class="dd-menu">
              <div class="dd-title">快捷筛选</div>
              <div
                v-for="p in pills"
                :key="p.key"
                class="dd-item"
                :class="{ on: statusFilter === p.key }"
                @click="pickFilter(p.key)"
              >{{ p.label }}<span v-if="statusFilter === p.key" class="dd-check"><el-icon :size="12"><Check /></el-icon></span></div>
              <div class="dd-title">来源筛选</div>
              <div class="dd-item" :class="{ on: originFilter === 'all' }" @click="pickOrigin('all')">全部<span v-if="originFilter === 'all'" class="dd-check"><el-icon :size="12"><Check /></el-icon></span></div>
              <div class="dd-item" :class="{ on: originFilter === 'private' }" @click="pickOrigin('private')">私有包<span v-if="originFilter === 'private'" class="dd-check"><el-icon :size="12"><Check /></el-icon></span></div>
              <div class="dd-item" :class="{ on: originFilter === 'proxy' }" @click="pickOrigin('proxy')">缓存包<span v-if="originFilter === 'proxy'" class="dd-check"><el-icon :size="12"><Check /></el-icon></span></div>
            </div>
          </Transition>
        </div>
        <div class="dd">
          <button class="dd-btn" :class="{ on: sortOpen }" title="排序" @click.stop="toggleSort"><el-icon :size="15"><Sort /></el-icon></button>
          <Transition name="dd">
            <div v-if="sortOpen" class="dd-menu">
              <div class="dd-title">排序方式</div>
              <div class="dd-item" :class="{ on: sortMode === 'default' }" @click="pickSort('default')">默认<span class="dd-dim">按名称</span><span v-if="sortMode === 'default'" class="dd-check"><el-icon :size="12"><Check /></el-icon></span></div>
              <div class="dd-item sort-dim">
                <span>版本数</span>
                <span class="sort-arrows">
                  <button class="sort-arrow" :class="{ on: sortMode === 'versions-asc' }" title="升序：从少到多" @click.stop="pickSort('versions-asc')">↑</button>
                  <button class="sort-arrow" :class="{ on: sortMode === 'versions-desc' }" title="降序：从多到少" @click.stop="pickSort('versions-desc')">↓</button>
                </span>
              </div>
              <div class="dd-item sort-dim">
                <span>占用大小</span>
                <span class="sort-arrows">
                  <button class="sort-arrow" :class="{ on: sortMode === 'size-asc' }" title="升序：从小到大" @click.stop="pickSort('size-asc')">↑</button>
                  <button class="sort-arrow" :class="{ on: sortMode === 'size-desc' }" title="降序：从大到小" @click.stop="pickSort('size-desc')">↓</button>
                </span>
              </div>
              <div class="dd-item sort-dim">
                <span>最近更新</span>
                <span class="sort-arrows">
                  <button class="sort-arrow" :class="{ on: sortMode === 'date-asc' }" title="升序：从旧到新" @click.stop="pickSort('date-asc')">↑</button>
                  <button class="sort-arrow" :class="{ on: sortMode === 'date-desc' }" title="降序：从新到旧" @click.stop="pickSort('date-desc')">↓</button>
                </span>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div v-if="state.scanMask" class="loading-tip">加载中…</div>
    <div v-else ref="vWrapEl" class="vtable" @scroll.passive="onVScroll">
      <table>
        <thead>
          <tr>
            <th>包名</th>
            <th style="width: 240px">描述</th>
            <th style="width: 90px">版本数</th>
            <th style="width: 110px">占用空间</th>
            <th style="width: 120px">最近更新</th>
            <th style="width: 100px">状态</th>
            <th style="width: 160px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="vTopPad" class="vtr-ph" :style="{ height: vTopPad + 'px' }">
            <td colspan="7"></td>
          </tr>
          <tr v-for="p in visibleRows" :key="p.name" @click="openDrawer(p)">
            <td>
              <span class="pkg-name">
                <PkgLogo :name="p.name" :size="30" :homepage="p.homepage" />
                <span class="pkg-cell">{{ p.name }}</span>
                <span v-if="p.origin === 'private'" class="origin-badge prv" title="私有包">私有包</span>
                <span v-else-if="p.origin === 'proxy'" class="origin-badge proxy" title="缓存包">缓存包</span>
              </span>
            </td>
            <td><span class="pkg-desc" :title="p.description || ''">{{ p.description || '—' }}</span></td>
            <td><span class="num-cell" :class="{ over: p.versions > state.threshold.versionThreshold }">{{ p.versions }}</span></td>
            <td><span class="num-cell">{{ fmtSize(p.size) }}</span></td>
            <td><span class="date-cell">{{ p.lastUpdated || '—' }}</span></td>
            <td><StatusTag :status="p.status" /></td>
            <td @click.stop>
              <template v-if="p.status === 'warn'">
                <button class="btn clean op-btn-cell" @click="openClean(p)">清理</button>
                <button class="btn ignore op-btn-cell" @click="doIgnore(p)">忽略</button>
              </template>
              <template v-else-if="p.status === 'ignored'">
                <button class="btn unignore op-btn-cell" @click="doUnignore(p)">取消忽略</button>
              </template>
              <template v-else>
                <button class="btn ignore op-btn-cell" @click="doIgnore(p)">忽略</button>
              </template>
            </td>
          </tr>
          <tr v-if="vBottomPad" class="vtr-ph" :style="{ height: vBottomPad + 'px' }">
            <td colspan="7"></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!filtered.length" class="empty-tip">没有匹配的包</div>
    </div>
  </div>

  <PackageDrawer
    v-model:visible="drawerVisible"
    :pkg="drawerPkg"
    :threshold="state.threshold.versionThreshold"
    @clean="openClean"
    @ignore="doIgnore"
    @unignore="doUnignore"
    @delete-version="doDeleteVersion"
  />
  <CleanDialog
    :visible="cleanVisible"
    :pkg="cleanPkgData"
    :threshold="state.threshold.versionThreshold"
    @close="cleanVisible = false"
    @confirmed="onCleanConfirmed"
  />

  <SearchDialogs
    v-model:sync-confirm-open="syncConfirmOpen"
    v-model:sync-result-open="syncResultOpen"
    :sync-result-detail="syncResultDetail"
    :sync-result-failed="syncResultFailed"
    v-model:pull-open="pullOpen"
    @confirm-sync="confirmSyncLatest"
  />
</template>

<style scoped>
/* 表格工具栏：左结果数 + 右筛选/排序下拉 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 20px 0 12px;
}
.tb-count {
  font-family: var(--num);
  font-size: 12.5px;
  color: var(--ink-faint);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-count b { color: var(--acc); }
.today-chip { color: var(--acc); font-weight: 600; }
.today-chip i {
  display: inline-grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 3px;
  background: var(--acc-soft);
  color: var(--acc);
  font-style: normal;
  font-size: 9px;
  cursor: pointer;
  margin-left: 4px;
  vertical-align: 1px;
}
.today-chip i:hover { background: var(--acc); color: #fff; }
.tb-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dd { position: relative; }
.dd-btn {
  width: 34px;
  height: 34px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 15px;
  color: var(--ink-dim);
  cursor: pointer;
  background: var(--card);
  border: 1px solid var(--line);
  transition: .15s;
}
.dd-btn:hover { border-color: var(--acc); color: var(--acc); }
.dd-btn.on { background: var(--acc-soft); border-color: var(--acc); color: var(--acc); }
.sync-btn { font-size: 15px; }
.sync-btn.on { background: var(--card); border-color: var(--line); color: var(--ink-dim); }
@keyframes sync-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.sync-spin { animation: sync-spin 1.1s linear infinite; display: inline-block; }
.dd-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 168px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: var(--shadow-hover);
  padding: 7px;
  z-index: 60;
}
.dd-title { font-size: 11px; color: var(--ink-faint); font-weight: 600; padding: 6px 10px 4px; letter-spacing: .3px; }
.dd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-dim);
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background .13s;
}
.dd-item:hover { background: var(--num-bg); color: var(--ink); }
.dd-item.on { color: var(--acc); background: var(--acc-soft); }
.dd-check { font-weight: 600; display: grid; place-items: center; }
.dd-dim { color: var(--ink-faint); font-weight: 500; margin-left: 6px; }
.dd-item.sort-dim { cursor: default; }
.dd-item.sort-dim:hover { background: transparent; color: var(--ink-dim); }
.sort-arrows { display: inline-flex; align-items: center; gap: 4px; }
.sort-arrow {
  width: 26px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  font-size: 13px;
  line-height: 1;
  font-weight: 600;
  color: var(--ink-faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  transition: .13s;
}
.sort-arrow:hover { color: var(--ink); border-color: var(--line); }
.sort-arrow.on { color: var(--acc); background: var(--acc-soft); border-color: transparent; }
.dd-enter-active { transition: transform .16s cubic-bezier(.2, .8, .25, 1), opacity .16s; }
.dd-leave-active { transition: transform .12s ease-in, opacity .12s; }
.dd-enter-from, .dd-leave-to { transform: translateY(-6px) scale(.97); opacity: 0; transform-origin: top right; }
.pkg-name { display: inline-flex; align-items: center; gap: 9px; min-width: 0; }
.pkg-name .pkg-cell { min-width: 0; }
.pkg-cell { font-weight: 600; word-break: break-all; }
/* 虚拟滚动支持：包名超长不换行，保证行高恒定 */
.pkg-name .pkg-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 来源徽标（原版 Verdaccio 界面：私有包 / 缓存包） */
.origin-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 3px;
  letter-spacing: .2px;
}
.origin-badge.prv { color: var(--acc); background: var(--acc-soft); }
.origin-badge.proxy { color: var(--inf); background: var(--inf-soft); }
/* 虚拟滚动容器：内部纵向滚动 + 表头吸顶 */
.vtable { overflow-y: auto; }
.vtable thead th { position: sticky; top: 0; z-index: 1; }
/* 占位行：不参与视觉（无内边距/边框/背景） */
.vtr-ph td { padding: 0; border-bottom: none; }
.vtr-ph { cursor: default; }
.vtr-ph:hover { background: transparent; }
.pkg-desc {
  display: block;
  max-width: 230px;
  font-size: 12px;
  color: var(--ink-dim);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.num-cell.over { color: var(--warn); }
/* 操作列：按钮横排一行，不换行 */
.vtable td:last-child { white-space: nowrap; }
.vtable td:last-child .btn { padding: 6px 13px; font-size: 12px; }
.vtable td:last-child .btn + .btn { margin-left: 7px; }
.empty-tip { padding: 40px 0; text-align: center; color: var(--ink-faint); font-size: 12.5px; }
.loading-tip { text-align: center; padding: 40px 0; color: var(--ink-faint); font-size: 13px; }

@media (max-width: 767px) {
  .toolbar { margin: 16px 0 10px; }
  .vtable { overflow: auto; -webkit-overflow-scrolling: touch; }
  .vtable table { min-width: 880px; width: auto; }
  .vtable th:first-child,
  .vtable td:first-child { min-width: 220px; }
  .pkg-cell { word-break: break-all; }
}
</style>
