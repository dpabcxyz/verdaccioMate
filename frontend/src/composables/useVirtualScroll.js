/**
 * 虚拟滚动 —— SearchView 抽离
 * 大列表（7000+ 条）仅渲染可视窗口行，上下透明占位行撑出总高度，避免十万级 DOM 卡顿；
 * 容器限高按视口剩余空间动态撑满（虚拟滚动依赖容器自身滚动）
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

export function useVirtualScroll({ filtered, state, searchHistory }) {
  const ROW_H = 58 // 单行高度（px）：td padding 14×2 + 内容 30（logo），与行内最大元素一致
  const OVERSCAN = 6 // 可视区外多渲染的缓冲行数
  const vWrapEl = ref(null)
  const pageRoot = ref(null)
  const vScrollTop = ref(0)
  // 容器可视区高度（响应式）：限高/缩放后必须同步刷新，vEnd 依赖它重算渲染窗口
  const vViewH = ref(600)

  function onVScroll() {
    if (vWrapEl.value) {
      vScrollTop.value = vWrapEl.value.scrollTop
      vViewH.value = vWrapEl.value.clientHeight
    }
  }

  const vTotal = computed(() => filtered.value.length)
  const vStart = computed(() => {
    const s = Math.floor(vScrollTop.value / ROW_H) - OVERSCAN
    return Math.max(0, s)
  })
  const vEnd = computed(() => {
    const e = Math.ceil((vScrollTop.value + vViewH.value) / ROW_H) + OVERSCAN
    return Math.min(vTotal.value, e)
  })
  const visibleRows = computed(() => filtered.value.slice(vStart.value, vEnd.value))
  const vTopPad = computed(() => vStart.value * ROW_H)
  const vBottomPad = computed(() => (vTotal.value - vEnd.value) * ROW_H)

  // 筛选/排序/搜索结果变化后回到列表顶部，避免停在旧位置
  watch(
    () => filtered.value,
    () => {
      if (vWrapEl.value) vWrapEl.value.scrollTop = 0
    },
  )

  // —— 表格容器限高：按视口剩余空间动态撑满 ——
  function fitTableHeight() {
    const el = vWrapEl.value
    if (!el) return false
    const top = el.getBoundingClientRect().top
    // 底部预留：直接取 .page-inner 实际 padding-bottom（40px 桌面 / 96px 移动），贴近底部充分利用高度且不出滚动条
    const inner = el.closest('.page-inner')
    const reserve = inner ? (parseFloat(getComputedStyle(inner).paddingBottom) || 40) : 40
    el.style.height = `${Math.max(300, Math.floor(window.innerHeight - top - reserve))}px`
    vViewH.value = el.clientHeight
    return true
  }
  // resize 防抖 100ms（窗口拖动期间不反复重排）
  let fitTimer = 0
  let fitDelay = 0
  let fitRaf = 0
  function onResizeFit() {
    clearTimeout(fitTimer)
    fitTimer = setTimeout(fitTableHeight, 100)
  }
  // 延迟再校准：进入动画/路由过渡期间（新旧页面并存叠加）测出的 top 偏大、高度被钳到最小值，
  // 若不做二次校准会永久锁死成几行。rAF 先试一次，过渡期(0.3s)后再定一次。
  function scheduleFit() {
    cancelAnimationFrame(fitRaf)
    clearTimeout(fitDelay)
    fitRaf = requestAnimationFrame(fitTableHeight)
    fitDelay = setTimeout(fitTableHeight, 400)
  }
  // .page-inner 的 fadeUp 动画结束后布局已稳定，此时测量最可靠，作为主要兜底
  function onLayoutSettled(e) {
    if (e && e.animationName === 'fadeUp') scheduleFit()
  }
  onMounted(() => {
    window.addEventListener('resize', onResizeFit)
    // 切页过渡期（fade-slide 新旧页面并存）布局未稳定，此时限高可能被错误钳到最小值，
    // 等 .page-inner 的 fadeUp / 路由过渡动画结束、布局稳定后再校准一次，避免表格缩成几行
    pageRoot.value?.addEventListener('animationend', onLayoutSettled)
    scheduleFit()
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResizeFit)
    pageRoot.value?.removeEventListener('animationend', onLayoutSettled)
    clearTimeout(fitTimer)
    clearTimeout(fitDelay)
    cancelAnimationFrame(fitRaf)
  })
  watch(
    () => state.scanMask,
    (v) => {
      if (!v) nextTick(scheduleFit)
    },
  )
  // 列表数据量变化后重新适配容器高度：数据已在 App 级缓存、loading 不翻转的场景也必须生效，
  // 否则 .vtable 无固定高度 → clientHeight=内容全高 → vEnd 扩大至全部 → 虚拟滚动退化为全量渲染
  watch(vTotal, () => nextTick(scheduleFit))
  if (searchHistory) watch(searchHistory, () => nextTick(scheduleFit))

  return { vWrapEl, pageRoot, visibleRows, vTopPad, vBottomPad, vTotal, onVScroll }
}