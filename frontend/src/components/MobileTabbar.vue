<script setup>
import { useRoute, useRouter } from 'vue-router'
import { HomeFilled, Search, Trophy, Clock } from '@element-plus/icons-vue'

defineProps({
  // 软键盘弹出（移动端 input 聚焦）时隐藏，避免 iOS Safari 把 fixed 底栏顶到屏幕中部
  kb: Boolean,
})

const route = useRoute()
const router = useRouter()

const tabs = [
  { path: '/', label: '首页', icon: HomeFilled },
  { path: '/search', label: '软件包', icon: Search },
  { path: '/toplist', label: 'Top榜', icon: Trophy },
  { path: '/logs', label: '操作日志', icon: Clock },
]

function go(path) {
  if (route.path !== path) router.push(path)
}
</script>

<template>
  <nav class="m-tabbar" :class="{ kb }">
    <div
      v-for="t in tabs"
      :key="t.path"
      class="tab"
      :class="{ active: route.path === t.path }"
      @click="go(t.path)"
    >
      <el-icon :size="19"><component :is="t.icon" /></el-icon>
      <i>{{ t.label }}</i>
    </div>
  </nav>
</template>

<style scoped>
.m-tabbar {
  display: flex;
  border-top: 1px solid var(--line);
  background: var(--card);
  padding: 6px 6px calc(12px + env(safe-area-inset-bottom, 0px));
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  transition: transform .22s ease, opacity .22s ease;
}
/* 软键盘弹出时滑出视口，避免 iOS 把 fixed 底栏顶到屏幕中部 */
.m-tabbar.kb {
  transform: translateY(110%);
  opacity: 0;
  pointer-events: none;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--ink-faint);
  padding: 4px 0;
  border-radius: 4px;
  cursor: pointer;
  transition: color .12s;
}
.tab i {
  font-style: normal;
  font-size: 10px;
  font-weight: 500;
  font-family: var(--sans);
}
.tab.active { color: var(--acc); }
.tab.active i { color: var(--acc); }
</style>
