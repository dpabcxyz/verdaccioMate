<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Box, Coin, WarningFilled, Brush, Calendar, Tickets, MostlyCloudy, Clock, Histogram, WarnTriangleFilled } from '@element-plus/icons-vue'
import StatCard from '../components/StatCard.vue'
import StatMini from '../components/StatMini.vue'
import Top30Panel from '../components/Top30Panel.vue'
import PackageCard from '../components/PackageCard.vue'
import PackageDrawer from '../components/PackageDrawer.vue'
import CleanDialog from '../components/CleanDialog.vue'
import { useStore, fmtSize } from '../store'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const { state, stats, refreshAll, ignorePkg, unignorePkg, cleanPkg } = useStore()

const drawerPkg = ref(null)
const drawerVisible = ref(false)
const cleanVisible = ref(false)
const cleanPkgData = ref(null)
const showTop30 = ref(true)

const warningExcess = computed(() =>
  stats.value.warnCount
    ? state.packages
        .filter(p => p.status === 'warn')
        .reduce((s, p) => s + (p.versions - state.threshold.versionThreshold), 0)
    : 0,
)

const top30WithIcon = computed(() => stats.value.top30)

// 私有 / 缓存拆分（分段条 + 图例）
function split2(privateVal, proxyVal, fmt = v => v.toLocaleString()) {
  const total = privateVal + proxyVal
  const pPct = total > 0 ? Math.round((privateVal / total) * 100) : 0
  return [
    { label: '私有包', value: fmt(privateVal), pct: pPct, tone: 'private' },
    { label: '缓存包', value: fmt(proxyVal), pct: 100 - pPct, tone: 'proxy' },
  ]
}
const pkgCountSplit = computed(() => split2(stats.value.privateCount, stats.value.proxyCount))
const sizeSplit = computed(() => split2(stats.value.privateSize, stats.value.proxySize, fmtSize))
const versionSplit = computed(() => split2(stats.value.privateVersions, stats.value.proxyVersions))
const todaySplit = computed(() => split2(stats.value.todayUpdatedPrivate, stats.value.todayUpdatedProxy))

// 单包指标的视觉平衡条（非来源）：最大包=占总缓存比例，最老包=停滞时长（满条≈1年）
const maxSizeSplit = computed(() => {
  const p = stats.value.maxPkg
  const total = stats.value.totalSize
  if (!p || !total) return null
  const pct = Math.max(1, Math.round((p.size / total) * 1000) / 10)
  return [{ label: '占总缓存', value: pct + '%', pct, tone: 'orange' }]
})
const oldestStaleSplit = computed(() => {
  const p = stats.value.oldestPkg
  if (!p?.lastUpdated) return null
  const days = Math.max(0, Math.floor((Date.now() - new Date(p.lastUpdated).getTime()) / 86400000))
  const pct = Math.min(100, Math.max(2, Math.round((days / 365) * 100)))
  return [{ label: '已停滞', value: `${days} 天`, pct, tone: 'purple' }]
})

// 版本数分布：超阈值版本按 私有包 / 缓存包 来源拆分
const warningExcessPrivate = computed(() =>
  state.packages
    .filter(p => p.status === 'warn' && p.origin === 'private')
    .reduce((s, p) => s + (p.versions - state.threshold.versionThreshold), 0),
)
const warningExcessProxy = computed(() =>
  state.packages
    .filter(p => p.status === 'warn' && p.origin === 'proxy')
    .reduce((s, p) => s + (p.versions - state.threshold.versionThreshold), 0),
)
const excessSplit = computed(() => split2(warningExcessPrivate.value, warningExcessProxy.value))

// 概览只展示需关注项（预警 + 异常），完整列表去检索页
const attentionPackages = computed(() =>
  state.packages.filter(p => p.status === 'warn' || p.status === 'broken'),
)

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
  if (r.ok) ElMessage.success(`已忽略 ${pkg.name}，不再预警`)
  else ElMessage.error(r.message || '忽略失败，请稍后重试')
}

async function doUnignore(pkg) {
  const r = await unignorePkg(pkg.name, pkg.versions)
  if (r.ok) ElMessage.success(`已移出忽略，${pkg.name} 恢复状态判断`)
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
  const r = await useStore().deleteVersion(pkg.name, version)
  if (r.ok) ElMessage.success(`已删除 ${version}，释放 ${r.freedSpace}，后台扫描中`)
  else ElMessage.warning(r.message || '删除失败')
}

async function onCleanConfirmed(res) {
  ElMessage.success(`已清理 ${res.deletedCount} 个版本，释放 ${res.freedSpace}，后台扫描中`)
  drawerVisible.value = false
}

function quickClean() {
  const warnPkg = state.packages.find(p => p.status === 'warn')
  if (warnPkg) openClean(warnPkg)
  else ElMessage.info('暂无预警包需要清理')
}
</script>

<template>
  <div class="page">
    <!-- 第一行：核心指标 4 -->
    <div class="stats-1">
      <StatCard tone="green" label="包的数量" :value="stats.pkgCount.toLocaleString()" unit="个包" :icon="Box" :split="pkgCountSplit" />
      <StatCard tone="warn" label="占用空间" :value="stats.totalSizeText" unit="总计" :icon="Coin" :split="sizeSplit" />
      <StatCard tone="dgr" label="预警数量" :value="String(stats.warnCount)" unit="个需关注" :icon="WarningFilled" @cta="quickClean" cta="立即处理" />
      <StatCard tone="inf" label="可清理空间" :value="stats.cleanableText" unit="可释放" :icon="Brush" cta="立即清理" @cta="quickClean" />
    </div>

    <!-- 第二行：辅助指标 5 -->
    <div class="stats-2">
      <StatMini tone="inf" label="今日更新包数" :icon="Calendar" :main="String(stats.todayUpdated)" sub="今日有版本更新" :split="todaySplit" link="查看" @link="router.push({ path: '/search', query: { updatedToday: 1 } })" />
      <StatMini tone="suc" label="版本总数" :icon="Tickets" :main="stats.totalVersions.toLocaleString()" sub="全部包的版本数" :split="versionSplit" link="查看" @link="router.push('/search')" />
      <StatMini tone="warn" label="最大包" :icon="MostlyCloudy" :main="stats.maxPkg?.name || '—'" :unit="stats.maxPkg ? fmtSize(stats.maxPkg.size) : ''" :sub="`${stats.maxPkg?.versions || 0} 个版本`" :split="maxSizeSplit" link="详情" @link="stats.maxPkg && openDrawer(stats.maxPkg)" />
      <StatMini tone="inf" label="最老包时间" :icon="Clock" :main="stats.oldestPkg?.lastUpdated || '—'" :sub="stats.oldestPkg ? `${stats.oldestPkg.name} · 未更新` : ''" :split="oldestStaleSplit" link="详情" @link="stats.oldestPkg && openDrawer(stats.oldestPkg)" />
      <StatMini tone="acc" label="版本数分布" :icon="Histogram" main=">15 版本" :unit="`${stats.warnCount} 个`" :sub="`超阈值共 ${warningExcess} 个版本`" :split="excessSplit" link="查看" @link="router.push({ path: '/search', query: { status: 'warn' } })" />
    </div>

    <!-- Top 20 排行（可收起，点击行打开详情） -->
    <Top30Panel v-if="showTop30" :top30="top30WithIcon" :top30-by="stats.top30By" @open="openDrawer" />

    <!-- 包卡片列表：仅需关注项 -->
    <div class="sec-head">
      <span class="sec-title"><el-icon class="st-ico" :size="16"><WarnTriangleFilled /></el-icon>需要关注</span>
      <span class="sec-sub">共 {{ attentionPackages.length }} 个需关注 · 预警置顶</span>
      <button class="link-all" @click="router.push('/search')">查看全部 →</button>
    </div>

    <div v-if="state.scanMask" class="loading-tip">加载中…</div>
    <div v-else-if="!state.packages.length" class="empty-box">
      暂无缓存包，请检查 原版 Verdaccio 缓存目录配置
    </div>
    <template v-else>
      <div v-if="attentionPackages.length" class="pkg-grid">
        <PackageCard
          v-for="(p, i) in attentionPackages"
          :key="p.name"
          :pkg="p"
          :threshold="state.threshold.versionThreshold"
          :style="{ animationDelay: (i * 0.03) + 's' }"
          @open="openDrawer"
          @clean="openClean"
          @ignore="doIgnore"
          @unignore="doUnignore"
        />
      </div>
      <div v-else class="empty-box">暂无需要关注的包</div>
    </template>
  </div>

  <!-- 详情抽屉 + 清理确认 -->
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
</template>

<style scoped>
.stats-1 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin-bottom: 18px; }
.stats-2 { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
.sec-head { display: flex; align-items: center; justify-content: space-between; margin: 4px 2px 16px; gap: 12px; flex-wrap: wrap; }
.sec-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.sec-title .st-ico { color: var(--warn); }
.sec-sub { font-family: var(--num); font-size: 12px; color: var(--ink-faint); font-weight: 600; }
.link-all { padding: 5px 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--card); color: var(--acc); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: .15s; }
.link-all:hover { border-color: var(--acc); }
.pkg-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.loading-tip { text-align: center; padding: 40px 0; color: var(--ink-faint); font-size: 13px; }
.empty-box { text-align: center; padding: 60px 0; color: var(--ink-faint); font-size: 13px; }

@media (max-width: 1180px) {
  .stats-1 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stats-2 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stats-2 > :nth-child(5) { grid-column: 1 / -1; } /* 5 卡跨列铺满，避免 2+2+1 */
  .pkg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .stats-1 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stats-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stats-2 > :nth-child(5) { grid-column: 1 / -1; } /* 第 5 张跨整行 */
  .pkg-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .sec-head { padding: 4px 0 12px; gap: 8px; }
  .sec-title { font-size: 15px; }
  .sec-sub { font-size: 11px; }
  .link-all { font-size: 12px; padding: 5px 10px; }
}
</style>
