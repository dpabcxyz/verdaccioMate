<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, Menu } from '@element-plus/icons-vue'
import AppTopbar from './components/AppTopbar.vue'
import MobileTabbar from './components/MobileTabbar.vue'
import SettingDrawer from './components/SettingDrawer.vue'
import ThresholdsDrawer from './components/ThresholdsDrawer.vue'
import IgnoredDrawer from './components/IgnoredDrawer.vue'
import McpDialog from './components/McpDialog.vue'
import { useStore } from './store'

const route = useRoute()
const router = useRouter()
const { state, refreshAll, scanNow } = useStore()
const settingsOpen = ref(false)
const thresholdsOpen = ref(false)
const ignoredOpen = ref(false)
const mcpOpen = ref(false)
const isLogin = () => route.path === '/login'
const isMobile = () => window.matchMedia('(max-width: 767px)').matches
// 移动端软键盘弹出时隐藏底部 Tabbar：iOS Safari 会把 fixed 底部导航顶到视口中部
const kbOpen = ref(false)
function onFocusIn(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) kbOpen.value = true
}
function onFocusOut() {
  setTimeout(() => {
    const a = document.activeElement
    if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA')) kbOpen.value = false
  }, 120)
}
onMounted(async () => {
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  // 等待初始路由导航完成后再判断页面，避免登录页上误触发数据加载（此时 route.path 仍是 /）
  await router.isReady()
  if (!isLogin()) refreshAll()
})

// 从 /login 跳转到真实页面（登录成功/带 redirect 参数）时加载数据：
// onMounted 只在根组件首次挂载时执行一次，首次打开在登录页时不会加载，需在此补触发
watch(() => route.path, (nv, ov) => {
  if (ov === '/login' && nv !== '/login') refreshAll()
  if (nv === '/login') mcpOpen.value = false
})

async function doRescan() {
  await scanNow()
}

// 扫描进度字节数 → 可读文本
const fmtScanBytes = computed(() => {
  const b = state.scanProgress.bytes || 0
  const mb = b / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
})
</script>

<template>
  <div v-if="!isLogin()">
    <!-- 桌面/平板顶栏 -->
    <AppTopbar class="desktop-topbar" @rescan="doRescan" @open-thresholds="thresholdsOpen = true" @open-ignored="ignoredOpen = true" @open-mcp="mcpOpen = true" />
    <!-- 移动端顶栏：菜单 + 品牌 + 铃铛 -->
    <header class="m-topbar">
      <div class="m-brand">
        <div class="m-logo"><img class="m-logo-img" src="/logo.svg" alt="logo" /></div>
        <div><b>Verdaccio</b>&nbsp;<span>Mate</span></div>
      </div>
      <div class="m-actions">
        <button class="m-bell" @click="router.push('/notifications')">
          <el-icon :size="15"><Bell /></el-icon>
          <span v-if="state.unreadCount" class="m-bell-badge">{{ state.unreadCount > 99 ? '99+' : state.unreadCount }}</span>
        </button>
        <div class="m-menu" @click="settingsOpen = true"><el-icon :size="16"><Menu /></el-icon></div>
      </div>
    </header>

    <!-- 扫描遮罩：毛玻璃全覆盖 + 卡片 + loading + 实时进度 -->
    <div v-if="state.scanMask" class="scan-mask">
      <div class="scan-card">
        <div class="scan-spinner"></div>
        <div class="scan-title">正在扫描缓存目录…</div>
        <div class="scan-info">
          已扫描 <b>{{ state.scanProgress.packages.toLocaleString() }}</b> 个包
          <span class="dot">·</span> <b>{{ fmtScanBytes }}</b>
        </div>
        <div class="scan-bar"><i></i></div>
      </div>
    </div>
  </div>

  <router-view v-slot="{ Component }">
    <transition name="fade-slide" appear>
      <component :is="Component" :key="route.path" />
    </transition>
  </router-view>

  <MobileTabbar v-if="!isLogin() && isMobile()" :kb="kbOpen" />
  <SettingDrawer v-model="settingsOpen" @rescan="doRescan" @open-thresholds="thresholdsOpen = true" @open-ignored="ignoredOpen = true" @open-mcp="mcpOpen = true" />
  <ThresholdsDrawer v-model="thresholdsOpen" />
  <IgnoredDrawer v-model="ignoredOpen" />
  <McpDialog v-if="!isLogin()" v-model="mcpOpen" />
</template>

<style scoped>
.m-topbar { display: none; }

/* —— 扫描遮罩：毛玻璃全覆盖（backdrop 模糊背后内容）+ 居中卡片 + 加载动画 —— */
.scan-mask {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, .45);
  backdrop-filter: blur(14px);
}
.scan-card {
  position: relative;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 24px 60px -16px rgba(0, 0, 0, .35);
  padding: 28px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-width: 300px;
  max-width: 92vw;
}
.scan-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--line);
  border-top-color: var(--acc);
  animation: spin360 .8s linear infinite;
}
.scan-title { font-size: 14px; font-weight: 600; }
.scan-info { font-family: var(--num); font-size: 12.5px; color: var(--ink-dim); }
.scan-info b { color: var(--acc); font-weight: 600; }
.scan-info .dot { margin: 0 4px; color: var(--ink-faint); }
.scan-bar {
  width: 100%;
  height: 4px;
  border-radius: 99px;
  background: var(--num-bg);
  overflow: hidden;
  margin-top: 4px;
}
.scan-bar i {
  display: block;
  height: 100%;
  width: 42%;
  border-radius: 99px;
  background: var(--acc);
  animation: scan-slide 1.1s ease-in-out infinite;
}
@keyframes scan-slide {
  from { transform: translateX(-110%); }
  to { transform: translateX(340%); }
}

@media (max-width: 767px) {
  .desktop-topbar { display: none; }
  .m-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--card);
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .m-brand { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
  .m-logo {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .m-logo-img {
    width: 28px;
    height: 28px;
    display: block;
    border-radius: 6px;
  }
  .m-brand b { color: var(--ink); }
  .m-brand span { color: var(--ink-faint); font-weight: 500; font-size: 12px; }
  .m-menu {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: var(--card);
    border: 1px solid var(--line);
    font-size: 15px;
    color: var(--ink-dim);
    cursor: pointer;
  }
  .m-menu:hover { color: var(--acc); border-color: var(--acc); }
  .m-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .m-bell {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--ink-dim);
    font-size: 15px;
    cursor: pointer;
  }
  .m-bell:hover { color: var(--acc); border-color: var(--acc); }
  .m-bell-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--acc);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    font-family: var(--num);
    display: grid;
    place-items: center;
    line-height: 1;
  }
}
</style>
