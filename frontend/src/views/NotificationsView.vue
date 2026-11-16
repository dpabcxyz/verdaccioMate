<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from '../store'
import { WarnTriangleFilled, Download, Pointer, Trophy, Histogram, AlarmClock, Bell, ArrowRight } from '@element-plus/icons-vue'

const router = useRouter()
const { state, refreshNotifications, markNotifRead, markAllNotifsRead } = useStore()

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
function fmtTime(t) {
  return (t || '').replace('T', ' ').slice(0, 16)
}

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
}

onMounted(() => refreshNotifications())
</script>

<template>
  <div class="page">
    <div class="head">
      <h2><el-icon class="pt-ico"><Bell /></el-icon>消息通知</h2>
      <button v-if="state.unreadCount" class="readall" @click="markAllNotifsRead">全部已读</button>
    </div>

    <div class="list">
      <div
        v-for="n in state.notifications"
        :key="n.id"
        class="item"
        :class="{ unread: !n.read_at }"
        @click="handleNotifClick(n)"
      >
        <el-icon class="nico" :size="16"><component :is="typeMeta(n.type).icon" /></el-icon>
        <div class="body">
          <div class="title">{{ n.title }}</div>
          <div class="sub">{{ n.body }}</div>
          <div class="time">{{ fmtTime(n.created_at) }}</div>
        </div>
        <el-icon class="go"><ArrowRight /></el-icon>
      </div>
      <div v-if="!state.notifications.length" class="empty">暂无通知</div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.head h2 { font-size: 18px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px; }
.head .pt-ico { color: var(--acc); }
.readall {
  border: none; background: transparent; color: var(--acc);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.list { display: flex; flex-direction: column; gap: 10px; }
.item {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--r-lg); cursor: pointer;
  transition: background .15s;
}
.item:hover { background: var(--panel-soft); }
.item.unread { background: var(--acc-soft); }
.nico { flex-shrink: 0; margin-top: 2px; color: var(--ink-dim); }
.item.unread .nico { color: var(--acc); }
.body { flex: 1; min-width: 0; }
.title { font-size: 14px; font-weight: 600; }
.sub { font-size: 12.5px; color: var(--ink-dim); margin-top: 3px; word-break: break-all; }
.time { font-size: 11px; color: var(--ink-faint); margin-top: 5px; font-family: var(--num); }
.go { color: var(--ink-faint); font-size: 14px; align-self: center; flex-shrink: 0; }
.empty { padding: 60px 0; text-align: center; color: var(--ink-faint); }
</style>
