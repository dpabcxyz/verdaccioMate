<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Bell, Timer, Loading, Refresh, Moon, Sunny, Setting, Tickets, InfoFilled, SwitchButton,
  HomeFilled, Search, Trophy, UserFilled, Clock, ArrowDown, Connection,
  WarnTriangleFilled, Download, Pointer, Histogram, AlarmClock,
} from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'
import { useStore } from '../store'
import { storage } from '../utils/storage'
import api from '../api'

const route = useRoute()
const router = useRouter()
const { theme, toggle } = useTheme()
const { state, refreshNotifications, markNotifRead, markAllNotifsRead, stopAllPolling } = useStore()

const emit = defineEmits(['rescan', 'open-thresholds', 'open-ignored', 'open-mcp'])

// —— 数据时效（上次扫描时间）：顶栏右侧低调呈现，点击可重新扫描 ——
const SCAN_PAD = n => String(n).padStart(2, '0')
const scanFull = computed(() => {
  const t = state.scannedAt
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${SCAN_PAD(d.getMonth() + 1)}-${SCAN_PAD(d.getDate())} ${SCAN_PAD(d.getHours())}:${SCAN_PAD(d.getMinutes())}`
})
const scanShort = computed(() => (scanFull.value ? scanFull.value.slice(5) : '')) // MM-DD HH:mm
const scanTitle = computed(() =>
  state.scanMask ? '正在扫描缓存目录…' : scanFull.value ? `数据基于 ${scanFull.value} 扫描 · 点击重新扫描` : '扫描缓存目录',
)

const menuOpen = ref(false)
const notifOpen = ref(false)
const notifWrap = ref(null)

const user = storage.getJSON('vcm-user', { name: 'Verdaccio Mate 用户', email: 'admin@verdaccio.local' })
const avatarChar = computed(() => (user.name || 'V').trim().charAt(0).toUpperCase())

// 通知类型 → 图标映射
const NOTIF_TYPE_META = {
  version_warning: { icon: WarnTriangleFilled },
  sync_batch: { icon: Download },
  pull_manual: { icon: Pointer },
  toplist_pull: { icon: Trophy },
  toplist_change: { icon: Histogram },
  daily_preview: { icon: AlarmClock },
}
function typeMeta(type) {
  return NOTIF_TYPE_META[type] || { icon: Bell }
}

function fmtNotifTime(t) {
  return (t || '').replace('T', ' ').slice(0, 16)
}

async function toggleNotif() {
  notifOpen.value = !notifOpen.value
  if (notifOpen.value) await refreshNotifications()
}

async function markAllRead() {
  await markAllNotifsRead()
}

/** 点击通知：按类型跳转 + 标记已读 + 关闭下拉 Verdaccio Mate */
async function handleNotifClick(n) {
  const b = n.batch_id
  switch (n.type) {
    case 'sync_batch': await router.push({ path: '/logs', query: { action: 'sync_latest', batchId: b } }); break
    case 'pull_manual': await router.push({ path: '/logs', query: { action: 'pull_manual', batchId: b } }); break
    case 'toplist_pull': await router.push({ path: '/logs', query: { action: 'pull_toplist', batchId: b } }); break
    case 'toplist_change': await router.push('/toplist'); break
    case 'version_warning': await router.push({ path: '/search', query: { status: 'warn' } }); break
    default: await router.push('/')
  }
  await markNotifRead(n.id)
  notifOpen.value = false
}

const navs = [
  { path: '/', label: '首页', icon: HomeFilled },
  { path: '/search', label: '软件包', icon: Search },
  { path: '/toplist', label: 'Top榜单', icon: Trophy },
  { path: '/users', label: '用户管理', icon: UserFilled },
  { path: '/logs', label: '操作日志', icon: Clock },
]

function go(path) {
  if (route.path !== path) router.push(path)
}

async function pick(action) {
  if (action === 'theme') {
    // 主题切换即时生效，保持菜单打开以便反复对比
    toggle()
    return
  }
  menuOpen.value = false
  if (action === 'rescan') emit('rescan')
  else if (action === 'thresholds') emit('open-thresholds')
  else if (action === 'ignored') emit('open-ignored')
  else if (action === 'mcp') emit('open-mcp')
  else if (action === 'about') window.open('/about', '_blank') // 新页签：项目背景/功能/仓库地址
  else if (action === 'logout') {
    stopAllPolling() // 先断掉所有轮询，避免会话销毁后后台 tick 继续打 /api
    await api.logout() // 再销毁后端会话并清本地 token，然后跳登录页（否则守卫会因 token 仍在而重定向回首页）
    router.push('/login')
  }
}

function onDocClick(e) {
  if (!e.target.closest('.avatar-wrap')) menuOpen.value = false
  if (!e.target.closest('.notif-wrap')) notifOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="topbar">
    <div class="brand" @click="go('/')">
      <div class="logo-emoji"><img class="logo-img" src="/logo.svg" alt="Verdaccio Mate" /></div>
      <div class="brand-name">Verdaccio Mate</div>
      <div class="brand-sub">原版 Verdaccio 的得力伙伴</div>
    </div>

    <nav class="nav">
      <span
        v-for="n in navs"
        :key="n.path"
        class="nav-item"
        :class="{ active: route.path === n.path }"
        @click="go(n.path)"
      >
        <el-icon :size="14"><component :is="n.icon" /></el-icon>{{ n.label }}
      </span>
    </nav>

    <div class="topbar-right">
      <span v-if="state.scanning" class="scan-scanning">正在后台扫描</span>
      <button
        v-if="state.scanMask || scanFull"
        class="scan-time"
        :class="{ loading: state.scanMask }"
        :title="scanTitle"
        :disabled="state.scanMask"
        @click="emit('rescan')"
      >
        <el-icon v-if="state.scanMask" class="st-ico is-loading"><Loading /></el-icon>
        <el-icon v-else class="st-ico"><Timer /></el-icon>
        <span class="st-txt">{{ state.scanMask ? '扫描中…' : scanShort }}</span>
      </button>

      <div class="notif-wrap" ref="notifWrap">
        <button class="notif-bell" title="消息通知" @click="toggleNotif">
          <el-icon :size="16"><Bell /></el-icon>
          <span v-if="state.unreadCount" class="notif-badge">{{ state.unreadCount > 99 ? '99+' : state.unreadCount }}</span>
        </button>
        <transition name="pop">
          <div v-if="notifOpen" class="notif-panel">
            <div class="notif-header">
              <span class="notif-header-t"><el-icon :size="14"><Bell /></el-icon> 消息通知</span>
              <button v-if="state.unreadCount" class="notif-readall" @click="markAllRead">全部已读</button>
            </div>
            <div class="notif-list">
              <div
                v-for="n in state.notifications"
                :key="n.id"
                class="notif-item"
                :class="{ unread: !n.read_at }"
                @click="handleNotifClick(n)"
              >
                <el-icon class="notif-ico" :size="15"><component :is="typeMeta(n.type).icon" /></el-icon>
                <div class="notif-body">
                  <div class="notif-title">{{ n.title }}</div>
                  <div class="notif-sub">{{ n.body }} · {{ fmtNotifTime(n.created_at) }}</div>
                </div>
                <span class="notif-go">→</span>
              </div>
              <div v-if="!state.notifications.length" class="notif-empty">暂无通知</div>
            </div>
          </div>
        </transition>
      </div>

      <div class="avatar-wrap">
        <button
          type="button"
          class="user-trigger"
          title="用户菜单"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span class="avatar">{{ avatarChar }}</span>
          <el-icon class="avatar-caret" :class="{ open: menuOpen }" :size="12"><ArrowDown /></el-icon>
        </button>
        <transition name="pop">
          <div v-if="menuOpen" class="avatar-menu">
            <button class="am-item" :disabled="state.scanMask" @click="pick('rescan')">
              <el-icon :size="14"><Loading v-if="state.scanMask" class="is-loading" /><Refresh v-else /></el-icon>
              <span>{{ state.scanMask ? '扫描中…' : '扫描缓存目录' }}</span>
            </button>
            <button class="am-item" @click="pick('theme')">
              <el-icon :size="14"><Moon v-if="theme === 'dark'" /><Sunny v-else /></el-icon>
              <span>{{ theme === 'dark' ? '暗色' : '亮色' }}</span>
            </button>
            <button class="am-item" @click="pick('thresholds')"><el-icon :size="14"><Setting /></el-icon><span>阈值配置</span></button>
            <button class="am-item" @click="pick('ignored')"><el-icon :size="14"><Tickets /></el-icon><span>忽略列表</span></button>
            <button class="am-item" @click="pick('mcp')"><el-icon :size="14"><Connection /></el-icon><span>MCP 接入</span></button>
            <button class="am-item" @click="pick('about')"><el-icon :size="14"><InfoFilled /></el-icon><span>关于</span></button>
            <button class="am-item danger" @click="pick('logout')"><el-icon :size="14"><SwitchButton /></el-icon><span>退出登录</span></button>
          </div>
        </transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 60px;
  padding: 0 28px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 100;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
  flex-shrink: 0;
}
.logo-emoji {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.logo-img {
  width: 34px;
  height: 34px;
  display: block;
  border-radius: 6px;
}
.brand-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -.2px;
}
.brand-sub {
  font-size: 11px;
  color: var(--ink-faint);
  margin-top: 1px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  justify-content: center;
  min-width: 0;
}
.nav-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-dim);
  cursor: pointer;
  transition: .15s;
  white-space: nowrap;
}
/* 选中态：与官网一致——文字底部品牌红横线，hover 淡入短横线 */
.nav-item::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 1px;
  height: 2px;
  border-radius: 2px;
  background: var(--acc);
  transform: scaleX(0);
  transform-origin: center;
  opacity: 0;
  transition: transform .18s ease, opacity .18s ease;
}
.nav-item:hover { color: var(--acc); }
.nav-item:hover::after { transform: scaleX(.45); opacity: .5; }
.nav-item.active { color: var(--acc); font-weight: 600; }
.nav-item.active::after { transform: scaleX(1); opacity: 1; }
.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
/* —— 数据时效：顶栏右侧低调徽标 —— */
.scan-scanning {
  font-size: 12px;
  font-weight: 500;
  color: var(--acc);
  white-space: nowrap;
}
.scan-time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  font-family: var(--num);
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-faint);
  cursor: pointer;
  transition: .15s;
  white-space: nowrap;
}
.scan-time:hover {
  color: var(--ink);
  border-color: var(--line);
  background: var(--toggle-bg);
}
.scan-time.loading { cursor: default; color: var(--acc); }
.scan-time .st-ico { font-size: 13px; }
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--pri);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
}
html.dark .avatar { color: #141414; }
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px 2px 2px;
  border: none;
  border-radius: 99px;
  background: transparent;
  cursor: pointer;
  transition: background .15s;
}
.user-trigger:hover { background: var(--nav-hover-bg); }
.avatar-caret {
  color: var(--ink-dim);
  transition: transform .18s, color .15s;
}
.user-trigger:hover .avatar-caret { color: var(--ink); }
.avatar-caret.open { transform: rotate(180deg); }

/* —— 通知铃铛 + 下拉面板 —— */
.notif-wrap {
  position: relative;
}
.notif-bell {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink-dim);
  cursor: pointer;
  transition: .15s;
}
.notif-bell:hover {
  border-color: var(--acc);
  color: var(--acc);
}
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--acc);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--num);
  display: grid;
  place-items: center;
  line-height: 1;
}
.notif-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: min(360px, 86vw);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: var(--shadow-hover);
  z-index: 300;
  overflow: hidden;
}
.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}
.notif-header-t {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.notif-readall {
  border: none;
  background: transparent;
  color: var(--acc);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.notif-readall:hover { color: var(--acc-h); }
.notif-list {
  max-height: 420px;
  overflow-y: auto;
}
.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--line-soft);
  transition: background .15s;
}
.notif-item:hover {
  background: var(--panel-soft);
}
.notif-item.unread {
  background: var(--acc-soft);
}
.notif-ico {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--ink-dim);
}
.notif-item.unread .notif-ico { color: var(--acc); }
.notif-body {
  flex: 1;
  min-width: 0;
}
.notif-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.notif-sub {
  font-size: 11.5px;
  color: var(--ink-faint);
  margin-top: 2px;
  word-break: break-all;
}
.notif-go {
  color: var(--ink-faint);
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
.notif-empty {
  padding: 40px 0;
  text-align: center;
  color: var(--ink-faint);
  font-size: 13px;
}

/* —— 头像下拉菜单 —— */
.avatar-wrap {
  position: relative;
}
.avatar-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  min-width: 168px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: var(--shadow-hover);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 300;
}
.am-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background .15s, color .15s;
  white-space: nowrap;
}
.am-item .el-icon { color: var(--ink-faint); }
.am-item:hover {
  background: var(--nav-hover-bg);
  color: var(--acc);
}
.am-item:hover .el-icon { color: var(--acc); }
.am-item:disabled {
  color: var(--ink-faint);
  cursor: not-allowed;
}
.am-item.danger {
  color: var(--dgr);
}
.am-item.danger .el-icon { color: var(--dgr); }
.am-item.danger:hover {
  background: var(--dgr-soft);
  color: var(--dgr);
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity .16s, transform .16s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(.96);
}

/* 平板（768~1023）：压缩导航 */
@media (max-width: 1023px) {
  .topbar { padding: 0 16px; gap: 12px; }
  .brand-sub { display: none; }
  .nav-item { padding: 7px 12px; font-size: 13px; }
  .nav-item::after { left: 12px; right: 12px; }
}

/* 手机 <768：顶栏转为移动端顶栏（菜单 + 品牌） */
@media (max-width: 767px) {
  .topbar {
    display: none;
  }
}
</style>
