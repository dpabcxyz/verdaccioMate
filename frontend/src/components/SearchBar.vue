<script setup>
// 搜索区：搜索框 + 本地前缀联想下拉 + 最近搜索历史（原 SearchView 顶部区块）
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Search, Close } from '@element-plus/icons-vue'
import PkgLogo from './PkgLogo.vue'
import { fmtSize } from '../store'

const props = defineProps({
  keyword: { type: String, default: '' },
  suggestOpen: { type: Boolean, default: false },
  suggestList: { type: Array, default: () => [] },
  searchHistory: { type: Array, default: () => [] },
})
const emit = defineEmits([
  'update:keyword', 'update:suggestOpen', 'submit', 'useSuggest', 'useHistory', 'clearHistory',
])
// 运行时 props 无法表达元素结构，用 JSDoc 收紧后供模板遍历（OriginSplit 同款处理）
const suggests = computed(() => /** @type {import('../types.js').PackageInfo[]} */ (props.suggestList))
const history = computed(() => /** @type {string[]} */ (props.searchHistory))

// —— 响应式 placeholder：移动端精简，桌面端完整（独立 matchMedia，内聚在搜索栏自身） ——
const isMobile = ref(false)
function checkMobile() {
  isMobile.value = window.matchMedia('(max-width: 767px)').matches
}
onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})
onUnmounted(() => window.removeEventListener('resize', checkMobile))
const placeholderText = computed(() =>
  isMobile.value ? '搜索包名…（回车搜索 · 实时过滤）' : '搜索包名…（回车搜索 · 实时过滤 · 防抖 300ms）',
)
// input 事件收敛到 script：EventTarget 无 value 类型，JSDoc 断言收紧（McpDialog 同款处理）
function onKeywordInput(e) {
  emit('update:keyword', /** @type {HTMLInputElement} */ (e.target).value)
  emit('update:suggestOpen', true)
}
</script>

<template>
  <div class="search-hero">
    <div class="search-box" @click.stop>
      <el-icon class="s-ico" :size="16"><Search /></el-icon>
      <input
        :value="keyword"
        type="text"
        :placeholder="placeholderText"
        @focus="emit('update:suggestOpen', true)"
        @input="onKeywordInput"
        @keyup.esc="emit('update:keyword', '')"
        @keyup.enter="emit('submit')"
      />
      <span v-if="keyword" class="s-clear" @click="emit('update:keyword', '')"><el-icon :size="11"><Close /></el-icon></span>
      <button class="s-go" @click="emit('submit')">搜索</button>
    </div>

    <!-- 搜索联想（本地包名前缀匹配，即时下拉） -->
    <div v-if="suggestOpen && suggests.length" class="suggest" @mousedown.prevent>
      <div v-for="s in suggests" :key="s.name" class="suggest-item" @click="emit('useSuggest', s.name)">
        <PkgLogo :name="s.name" :size="20" :homepage="s.homepage" />
        <span class="si-name">{{ s.name }}</span>
        <span class="si-info">{{ s.versions }} 版 · {{ fmtSize(s.size) }}</span>
      </div>
    </div>

    <!-- 最近搜索（最近 5 条，localStorage 持久化） -->
    <div v-if="history.length" class="history-row">
      <span class="h-label">最近搜索</span>
      <span v-for="h in history" :key="h" class="h-chip" @click="emit('useHistory', h)">{{ h }}</span>
      <span class="h-clear" @click="emit('clearHistory')">清除</span>
    </div>
  </div>
</template>

<style scoped>
.search-hero { padding: 18px 0 12px; display: flex; flex-direction: column; align-items: center; }
.search-box {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(680px, 100%);
  height: 48px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 10px 0 16px;
  box-shadow: var(--shadow);
  transition: border-color .15s;
}
.search-box:focus-within { border-color: var(--pri); }
.s-ico { font-size: 16px; color: var(--ink-faint); }
.search-box input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: var(--sans);
  color: var(--ink);
  background: transparent;
  min-width: 0;
}
.search-box input::placeholder { color: var(--ink-faint); }
.s-clear {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  background: var(--num-bg);
  color: var(--ink-dim);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}
.s-clear:hover { background: var(--dgr-soft); color: var(--dgr); }
.s-go {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--pri);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  transition: background .15s;
  flex-shrink: 0;
}
html.dark .s-go { color: #141414; }
.s-go:hover { background: var(--pri-h); }
/* 搜索联想下拉（本地包名前缀匹配） */
.suggest {
  width: min(680px, 100%);
  margin-top: 8px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: var(--shadow-hover);
  overflow: hidden;
  z-index: 60;
  padding: 6px;
}
.suggest-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background .13s;
}
.suggest-item:hover { background: var(--num-bg); }
.si-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-info {
  margin-left: auto;
  font-family: var(--num);
  font-size: 11px;
  color: var(--ink-faint);
  flex-shrink: 0;
}
/* 最近搜索（搜索框下方，最近 5 条） */
.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  width: min(680px, 100%);
}
.h-label { font-size: 12px; color: var(--ink-faint); font-weight: 600; }
.h-chip {
  font-size: 12px;
  color: var(--ink-dim);
  background: var(--card);
  border: 1px solid var(--line);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: .15s;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.h-chip:hover { border-color: var(--acc); color: var(--acc); }
.h-clear { font-size: 11.5px; color: var(--ink-faint); cursor: pointer; margin-left: 2px; }
.h-clear:hover { color: var(--dgr); }

@media (max-width: 767px) {
  .search-box { height: 48px; }
  .search-box .s-go { display: none; }
  .history-row { width: 100%; }
}
</style>