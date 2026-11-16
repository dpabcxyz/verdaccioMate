<script setup>
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Tickets } from '@element-plus/icons-vue'
import { useStore, fmtSize } from '../store'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const { state, unignorePkg } = useStore()

const ignoredList = computed(() => state.packages.filter(p => p.status === 'ignored'))

async function doUnignore(pkg) {
  try {
    await ElMessageBox.confirm(`确定将 ${pkg.name} 移出忽略吗？移出后若仍超阈值将恢复预警。`, '移出忽略', {
      confirmButtonText: '移出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const res = await unignorePkg(pkg.name, pkg.versions)
  if (res.ok) ElMessage.success(`已移出忽略：${pkg.name}`)
  else ElMessage.error(res.message || '移出忽略失败，请稍后重试')
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="overlay" @click.self="close"></div>
    </Transition>
    <Transition name="drawer-r">
      <aside v-if="modelValue" class="ig-drawer">
        <div class="ig-drawer-head">
          <span class="ig-title"><el-icon :size="15"><Tickets /></el-icon>忽略列表</span>
          <div class="ig-drawer-close" @click="close"><el-icon><Close /></el-icon></div>
        </div>

        <div class="ig-body">
          <div class="page-sub">共 <b>{{ ignoredList.length }}</b> 个已忽略包 · 移出后自动恢复状态判断</div>

          <div v-if="state.scanMask" class="loading-tip">加载中…</div>
          <div v-else class="vtable">
            <table>
              <thead>
                <tr>
                  <th style="width: 48px">#</th>
                  <th>包名</th>
                  <th style="width: 90px">版本数</th>
                  <th style="width: 110px">占用空间</th>
                  <th style="width: 140px">忽略时间</th>
                  <th style="width: 96px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in ignoredList" :key="p.name">
                  <td><span class="idx">{{ i + 1 }}</span></td>
                  <td><span class="pkg-cell">{{ p.name }}</span></td>
                  <td><span class="num-cell">{{ p.versions }}</span></td>
                  <td><span class="num-cell">{{ fmtSize(p.size) }}</span></td>
                  <td><span class="ign-time">{{ p.ignoredAt || '—' }}</span></td>
                  <td>
                    <button class="btn unignore op-btn-cell" @click="doUnignore(p)">移出忽略</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!ignoredList.length" class="empty-tip">还没有忽略任何包</div>
          </div>
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
.ig-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(640px, 92vw);
  z-index: 121;
  display: flex;
  flex-direction: column;
  background: var(--card);
  box-shadow: -16px 0 40px -16px rgba(0, 0, 0, .3);
}
.ig-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 20px;
  border-bottom: 1px solid var(--line);
  font-size: 15px;
  font-weight: 600;
}
.ig-title { display: inline-flex; align-items: center; gap: 7px; }
.ig-drawer-close {
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
.ig-drawer-close:hover { background: var(--dgr-soft); color: var(--dgr); }
.ig-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px 26px;
}
.page-sub {
  font-size: 12.5px;
  color: var(--ink-dim);
  margin-bottom: 16px;
}

.pkg-cell { font-weight: 500; word-break: break-all; font-family: var(--num); }
.idx { font-family: var(--num); font-size: 12.5px; color: var(--ink-faint); }
.num-cell { font-family: var(--num); font-size: 13px; color: var(--ink); }
.ign-time { font-family: var(--num); font-size: 12.5px; color: var(--ink-dim); }
.empty-tip { padding: 60px 0; text-align: center; color: var(--ink-faint); font-size: 13px; }
.loading-tip { text-align: center; padding: 40px 0; color: var(--ink-faint); font-size: 13px; }

.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.drawer-r-enter-active { transition: transform .25s ease; }
.drawer-r-leave-active { transition: transform .2s ease-in; }
.drawer-r-enter-from, .drawer-r-leave-to { transform: translateX(100%); }

@media (max-width: 767px) {
  .ig-drawer {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 85vh;
    border-radius: 6px 6px 0 0;
  }
  .ig-body { padding: 16px 14px 20px; }
  .vtable { overflow-x: auto; }
  .vtable table { min-width: 560px; }
}
</style>
