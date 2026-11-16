/**
 * 搜索与筛选状态 —— SearchView 抽离
 * 覆盖：关键词防抖检索、搜索历史（localStorage 最近 5 条）、本地前缀联想、
 * 状态/来源筛选、排序、今日更新筛选、筛选/排序下拉菜单开关与外部点击关闭
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storage } from '../utils/storage'

export function usePackageSearch({ state, refreshPackages }) {
  const route = useRoute()
  const router = useRouter()

  const keyword = ref('')
  const statusFilter = ref('all') // all | warn | ok | ignored | broken
  const originFilter = ref('all') // all | private | proxy
  const sortMode = ref('default') // default | versions-asc/desc | size-asc/desc | date-asc/desc
  let debounceTimer = null

  // —— 今日更新筛选（从概览「今日更新包数」卡片跳转进入），与后端 lastUpdated 同口径：北京时间 ——
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const todayFilter = ref(false)
  function clearTodayFilter() {
    todayFilter.value = false
    router.replace({ path: '/search' })
  }

  // —— 搜索历史（localStorage 最近 5 条，提交时记录） ——
  const HISTORY_KEY = 'vcm-search-history'
  const searchHistory = ref(storage.getJSON(HISTORY_KEY, []))
  function addHistory(kw) {
    const k = (kw || '').trim()
    if (!k) return
    const h = [k, ...searchHistory.value.filter(x => x !== k)].slice(0, 5)
    searchHistory.value = h
    storage.set(HISTORY_KEY, JSON.stringify(h))
  }
  function submitSearch() {
    addHistory(keyword.value)
    suggestOpen.value = false
  }
  function useHistory(kw) {
    keyword.value = kw
    refreshPackages(kw)
  }
  function clearHistory() {
    searchHistory.value = []
    storage.remove(HISTORY_KEY)
  }

  // —— 搜索联想：本地包名前缀匹配，即时下拉 ——
  const suggestOpen = ref(false)
  const suggestList = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return []
    return state.packages.filter(p => p.name.toLowerCase().startsWith(kw)).slice(0, 8)
  })
  function useSuggest(name) {
    keyword.value = name
    addHistory(name)
    refreshPackages(name)
    suggestOpen.value = false
  }

  // —— 筛选/排序下拉 ——
  const filterOpen = ref(false)
  const sortOpen = ref(false)
  function toggleFilter() {
    filterOpen.value = !filterOpen.value
    sortOpen.value = false
  }
  function toggleSort() {
    sortOpen.value = !sortOpen.value
    filterOpen.value = false
  }
  function pickFilter(key) {
    statusFilter.value = key
    filterOpen.value = false
  }
  function pickOrigin(key) {
    originFilter.value = key
    filterOpen.value = false
  }
  function pickSort(mode) {
    sortMode.value = mode
    sortOpen.value = false
  }
  function closeMenus() {
    filterOpen.value = false
    sortOpen.value = false
    suggestOpen.value = false
  }
  onMounted(() => document.addEventListener('click', closeMenus))
  onUnmounted(() => document.removeEventListener('click', closeMenus))

  // —— 筛选 + 排序计算（原 SearchView.filtered） ——
  const filtered = computed(() => {
    let list = state.packages
    if (todayFilter.value) list = list.filter(p => p.lastUpdated === todayStr)
    if (originFilter.value !== 'all') {
      list = list.filter(p => p.origin === originFilter.value) // broken 无 origin，不命中任一来源
    }
    if (statusFilter.value !== 'all') {
      list = list.filter(p => p.status === statusFilter.value)
    }
    if (sortMode.value === 'versions-asc' || sortMode.value === 'versions-desc') {
      const dir = sortMode.value === 'versions-desc' ? -1 : 1
      list = [...list].sort((a, b) => (b.versions - a.versions) * dir)
    } else if (sortMode.value === 'size-asc' || sortMode.value === 'size-desc') {
      const dir = sortMode.value === 'size-desc' ? -1 : 1
      list = [...list].sort((a, b) => (b.size - a.size) * dir)
    } else if (sortMode.value === 'date-desc' || sortMode.value === 'date-asc') {
      // lastUpdated 为 YYYY-MM-DD，字符串可比较；无日期的包（broken 等）固定排最后
      const dir = sortMode.value === 'date-desc' ? -1 : 1
      list = [...list].sort((a, b) => {
        if (!a.lastUpdated) return 1
        if (!b.lastUpdated) return -1
        return a.lastUpdated.localeCompare(b.lastUpdated) * dir
      })
    }
    return list
  })

  // 关键词防抖检索（300ms）
  watch(keyword, () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => refreshPackages(keyword.value), 300)
  })

  // route.query 初始化（切页时统一调用；query 归一：LocationQueryValue | LocationQueryValue[]）
  function initFromRoute() {
    const statusQuery = Array.isArray(route.query.status) ? route.query.status[0] : route.query.status
    if (statusQuery && ['all', 'warn', 'ok', 'ignored', 'broken'].includes(statusQuery)) {
      statusFilter.value = statusQuery
    }
    if (route.query.updatedToday === '1') todayFilter.value = true
  }

  const pills = [
    { key: 'all', label: '全部' },
    { key: 'warn', label: '预警' },
    { key: 'ok', label: '正常' },
    { key: 'ignored', label: '已忽略' },
    { key: 'broken', label: '异常' },
  ]

  return {
    keyword, statusFilter, originFilter, sortMode,
    todayStr, todayFilter, clearTodayFilter,
    searchHistory, submitSearch, useHistory, clearHistory,
    suggestOpen, suggestList, useSuggest,
    filterOpen, sortOpen, toggleFilter, toggleSort, pickFilter, pickOrigin, pickSort, closeMenus,
    filtered, initFromRoute, pills,
  }
}