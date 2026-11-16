<script setup>
// 三个弹窗：一键拉取确认 / 拉取结果汇总 / 手工拉取指定包（原 SearchView 尾部区块）
// 手工拉取表单的状态与提交逻辑内聚在本组件（pullName/pullVersion/pullLoading）
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { notifyError } from '../utils/notify.js'

defineProps({
  syncConfirmOpen: { type: Boolean, default: false },
  syncResultOpen: { type: Boolean, default: false },
  syncResultDetail: { type: String, default: '' },
  syncResultFailed: { type: Boolean, default: false },
  pullOpen: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update:syncConfirmOpen', 'update:syncResultOpen', 'update:pullOpen', 'confirmSync',
])

// —— 手工拉取指定包版本（组件内自管理表单状态） ——
const pullName = ref('')
const pullVersion = ref('')
const pullLoading = ref(false)
async function submitPull() {
  const name = pullName.value.trim()
  const ver = pullVersion.value.trim()
  if (!name || !ver) return ElMessage.warning('请填写包名和版本号')
  pullLoading.value = true
  try {
    const res = await api.pullPackage(name, ver)
    if (res.ok) {
      ElMessage.success(`已拉取 ${name}@${ver}`)
      emit('update:pullOpen', false)
      pullName.value = ''
      pullVersion.value = ''
    } else {
      ElMessage.error((res && res.message) || '拉取失败')
    }
  } catch (e) {
    notifyError(e, '拉取失败，请稍后重试')
  } finally {
    pullLoading.value = false
  }
}
</script>

<template>
  <!-- 一键拉取确认弹窗（统一风格） -->
  <Transition name="dd">
    <div v-if="syncConfirmOpen" class="sync-mask" @click.self="emit('update:syncConfirmOpen', false)">
      <div class="sync-confirm">
        <div class="sync-confirm-title">拉取最新版本</div>
        <div class="sync-confirm-body">将查询上游 npm registry，为存量包拉取每个包的最新版本（已缓存最新版会自动跳过）。</div>
        <div class="sync-confirm-ops">
          <button class="pld-btn" @click="emit('update:syncConfirmOpen', false)">取消</button>
          <button class="pld-btn primary" @click="emit('confirmSync')">开始拉取</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 拉取结果弹窗 -->
  <Transition name="dd">
    <div v-if="syncResultOpen" class="sync-mask" @click.self="emit('update:syncResultOpen', false)">
      <div class="sync-result" :class="{ warn: syncResultFailed }">
        <div class="sync-result-title">{{ syncResultFailed ? '拉取完成（部分失败）' : '拉取完成' }}</div>
        <pre class="sync-result-body">{{ syncResultDetail }}</pre>
        <div class="sync-result-ops">
          <button class="pld-btn primary" @click="emit('update:syncResultOpen', false)">知道了</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 手工拉取指定包弹窗 -->
  <Transition name="dd">
    <div v-if="pullOpen" class="sync-mask" @click.self="emit('update:pullOpen', false)">
      <div class="sync-confirm">
        <div class="sync-confirm-title">拉取指定包</div>
        <div class="pull-form">
          <input v-model="pullName" class="pull-input" placeholder="包名，如 lodash 或 @scope/pkg" @keyup.enter="submitPull" />
          <input v-model="pullVersion" class="pull-input" placeholder="版本号，如 1.2.3" @keyup.enter="submitPull" />
        </div>
        <div class="sync-confirm-body">将经 原版 Verdaccio 私服代理拉取 <b>{{ pullName || '??' }}@{{ pullVersion || '??' }}</b> 并写入缓存。</div>
        <div class="sync-confirm-ops">
          <button class="pld-btn" @click="emit('update:pullOpen', false)">取消</button>
          <button class="pld-btn primary" :disabled="pullLoading" @click="submitPull">{{ pullLoading ? '拉取中…' : '开始拉取' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* dd 过渡：弹窗淡入淡出（原 SearchView 样式随迁） */
.dd-enter-active { transition: transform .16s cubic-bezier(.2, .8, .25, 1), opacity .16s; }
.dd-leave-active { transition: transform .12s ease-in, opacity .12s; }
.dd-enter-from, .dd-leave-to { transform: translateY(-6px) scale(.97); opacity: 0; transform-origin: top right; }
/* —— 一键拉取弹窗（统一风格） —— */
.sync-mask {
  position: fixed; inset: 0; z-index: 500;
  display: grid; place-items: center;
  background: rgba(0, 0, 0, .45);
}
.sync-confirm, .sync-result {
  width: min(420px, 92vw);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 30px 70px -20px rgba(0, 0, 0, .5);
  padding: 20px 22px;
  display: flex; flex-direction: column; gap: 14px;
}
.sync-confirm-title, .sync-result-title { font-size: 14px; font-weight: 600; }
.sync-confirm-body { font-size: 13px; color: var(--ink-dim); line-height: 1.6; }
.pull-form { display: flex; flex-direction: column; gap: 10px; margin: 14px 0 4px; }
.pull-input {
  width: 100%; padding: 9px 12px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink);
  font-size: 13px; font-family: var(--num); outline: none; transition: border-color .15s;
}
.pull-input:focus { border-color: var(--pri); }
.sync-result-body {
  font-size: 12.5px; color: var(--ink-dim); line-height: 1.7;
  white-space: pre-wrap; max-height: 50vh; overflow: auto;
  padding: 10px 12px; border-radius: 4px; background: var(--panel-soft);
}
.sync-confirm-ops, .sync-result-ops {
  display: flex; justify-content: flex-end; gap: 10px;
}
.sync-result.warn .sync-result-title { color: var(--warn); }

/* —— 弹窗按钮 —— */
.pld-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 16px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--card);
  color: var(--ink-dim); font-size: 12.5px; font-weight: 600;
  cursor: pointer; transition: .15s;
}
.pld-btn:hover { border-color: var(--acc); color: var(--acc); }
.pld-btn.primary { background: var(--pri); border-color: var(--pri); color: #fff; }
html.dark .pld-btn.primary { color: #141414; }
.pld-btn.primary:hover { background: var(--pri-h); border-color: var(--pri-h); color: #fff; }
html.dark .pld-btn.primary:hover { color: #141414; }
</style>