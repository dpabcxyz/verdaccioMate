<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Close, Refresh, Moon, Sunrise, Setting, Tickets, SwitchButton, Connection } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'
import { useStore, stopAllPolling } from '../store'
import api from '../api'
import { storage } from '../utils/storage'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'rescan', 'open-thresholds', 'open-ignored', 'open-mcp'])
const router = useRouter()
const { theme, toggle, auto, setAuto, todayInfo } = useTheme()
const { state } = useStore()

const user = storage.getJSON('vcm-user', { name: 'Verdaccio Mate 用户', email: 'admin@verdaccio.local' })

// 坐标来源文案：手动配置 / IP 定位 / 上海默认
const srcText = computed(() => {
  if (todayInfo.value.src === 'env') return '手动配置'
  if (todayInfo.value.src === 'ip') return 'IP 定位'
  return '上海默认'
})

function close() {
  emit('update:modelValue', false)
}

function goRescan() {
  if (state.scanMask) return
  close()
  emit('rescan')
}

function goThresholds() {
  close()
  emit('open-thresholds')
}

function goIgnored() {
  close()
  emit('open-ignored')
}

async function logout() {
  stopAllPolling() // 先断掉所有轮询，避免会话销毁后后台 tick 继续打 /api
  await api.logout() // 再销毁后端会话并清本地 token，然后跳登录页
  close()
  router.push('/login')
}

function openMcp() {
  close()
  emit('open-mcp')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="overlay" @click.self="close"></div>
    </Transition>
    <Transition name="drawer-r">
      <aside v-if="modelValue" class="m-drawer">
        <div class="m-drawer-head">
          <span>设置</span>
          <div class="m-drawer-close" @click="close"><el-icon><Close /></el-icon></div>
        </div>
        <div class="m-drawer-body">
          <div class="m-user">
            <div class="m-user-avatar">{{ (user.name || '?').charAt(0).toUpperCase() }}</div>
            <div>
              <b>{{ user.name }}</b>
              <span>{{ user.email }}</span>
            </div>
          </div>
          <div class="m-drawer-item" :class="{ disabled: state.scanMask }" @click="goRescan">
            <span class="mi-label"><el-icon :size="14"><Refresh /></el-icon>{{ state.scanMask ? '扫描中…' : '扫描缓存目录' }}</span>
          </div>
          <div class="m-drawer-item" @click="toggle">
            <span class="mi-label"><el-icon :size="14"><Moon /></el-icon>主题</span>
            <span>{{ theme === 'dark' ? '暗色' : '亮色' }}</span>
          </div>
          <div class="m-drawer-item" @click="setAuto(!auto)">
            <span class="mi-label"><el-icon :size="14"><Sunrise /></el-icon>自动主题</span>
            <span class="m-auto-switch" :class="{ on: auto }"><i></i></span>
          </div>
          <div class="m-drawer-item">
            <span class="mi-label"><el-icon :size="14"><Sunrise /></el-icon>日出 / 日落</span>
            <span>{{ todayInfo.sunrise }} / {{ todayInfo.sunset }} · {{ srcText }}</span>
          </div>
          <div class="m-drawer-item" @click="goThresholds">
            <span class="mi-label"><el-icon :size="14"><Setting /></el-icon>阈值配置</span>
            <span>阈值</span>
          </div>
          <div class="m-drawer-item" @click="goIgnored">
            <span class="mi-label"><el-icon :size="14"><Tickets /></el-icon>忽略列表</span>
            <span>已忽略包</span>
          </div>
          <button class="m-drawer-item m-mcp-entry" @click="openMcp">
            <span class="mi-label"><el-icon :size="14"><Connection /></el-icon>MCP 接入</span>
            <span>API Key</span>
          </button>
        </div>
        <div class="m-drawer-foot">
          <button class="m-logout" @click="logout"><el-icon :size="14"><SwitchButton /></el-icon>退出登录</button>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .45);
  z-index: 120;
}
.m-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(340px, 84vw);
  z-index: 121;
  display: flex;
  flex-direction: column;
  background: var(--card);
  box-shadow: -16px 0 40px -16px rgba(0, 0, 0, .3);
}
.m-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 16px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
  font-weight: 600;
}
.m-drawer-close {
  width: 28px;
  height: 28px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--card);
  color: var(--ink-dim);
  font-size: 14px;
  cursor: pointer;
}
.m-drawer-close:hover { background: var(--dgr-soft); color: var(--dgr); }
.m-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}
.m-user {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px;
  background: var(--card-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  margin-bottom: 12px;
}
.m-user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 15px;
  background: var(--pri);
  flex-shrink: 0;
}
html.dark .m-user-avatar { color: #141414; }
.m-user b { font-size: 13.5px; display: block; }
.m-user span { font-size: 11px; color: var(--ink-faint); }
.m-drawer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  font-size: 13px;
  border-radius: var(--r-md);
  margin-bottom: 4px;
  cursor: pointer;
  transition: background .12s;
}
.mi-label { display: inline-flex; align-items: center; gap: 8px; font-family: var(--sans); font-size: 13px; color: var(--ink); }
.m-auto-switch {
  width: 36px;
  height: 20px;
  border-radius: 99px;
  background: var(--line);
  position: relative;
  transition: background .15s;
  flex-shrink: 0;
}
.m-auto-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
  transition: left .15s;
}
.m-auto-switch.on {
  background: var(--pri);
}
.m-auto-switch.on i {
  left: 18px;
}
.m-mcp-entry { width: 100%; border: 0; background: transparent; text-align: left; }
.m-drawer-item:hover { background: var(--nav-hover-bg); }
.m-drawer-item.disabled { opacity: .5; pointer-events: none; }
.m-drawer-item > span:last-child { font-family: var(--num); font-size: 11px; color: var(--ink-faint); white-space: nowrap; }
.m-drawer-foot { padding: 12px 14px; border-top: 1px solid var(--line); }
.m-logout {
  width: 100%;
  padding: 10px 0;
  border: 1px solid var(--dgr-line);
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: 13px;
  background: var(--dgr-soft);
  color: var(--dgr);
  transition: .12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.m-logout:hover { background: var(--dgr); color: #fff; }

.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.drawer-r-enter-active { transition: transform .25s ease; }
.drawer-r-leave-active { transition: transform .2s ease-in; }
.drawer-r-enter-from, .drawer-r-leave-to { transform: translateX(100%); }
</style>
