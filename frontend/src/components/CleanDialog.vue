<script setup>
import { ref, computed, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useStore, fmtSize } from '../store'
import api from '../api'
import semverCompare from '../utils/semver'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: Boolean,
  pkg: { type: Object, default: null },
  threshold: { type: Number, default: 15 },
})
const emit = defineEmits(['close', 'confirmed'])

const keep = ref(15)
const cleaning = ref(false)
const loadingVer = ref(false)
const detailPkg = ref(null)
// 请求序号：用户快速切换包/反复开关时，只采纳最后一次请求的结果，防止旧响应覆盖新包
let loadSeq = 0

function loadDetail() {
  if (!props.visible || !props.pkg) return
  keep.value = props.threshold
  detailPkg.value = null
  // 列表接口为瘦身不含 versionsDetail，打开时按需加载
  if (props.pkg.versionsDetail?.length) return
  const seq = ++loadSeq
  loadingVer.value = true
  api
    .getPackageDetail(props.pkg.name)
    .then((d) => {
      if (seq !== loadSeq) return
      if (d.ok && d.pkg) detailPkg.value = d.pkg
    })
    .catch(() => {})
    .finally(() => {
      if (seq === loadSeq) loadingVer.value = false
    })
}

watch(() => props.visible, (v) => { if (v) loadDetail() })
watch(() => props.pkg, () => loadDetail())

// 版本明细：优先详情接口加载结果，其次列表携带（如有）
const verList = computed(() => detailPkg.value?.versionsDetail || props.pkg?.versionsDetail || [])

// 按完整 semver 语义排序（与后端一致）：旧版本在前
const toDelete = computed(() => {
  const list = verList.value
  if (!list.length) return []
  const sorted = [...list].sort((a, b) => semverCompare(a.version, b.version))
  const n = Math.max(0, sorted.length - keep.value)
  return sorted.slice(0, n)
})

const freedSpace = computed(() => toDelete.value.reduce((s, v) => s + v.size, 0))

async function confirm() {
  cleaning.value = true
  try {
    const res = await useStore().cleanPkg(props.pkg.name, keep.value)
    if (res.ok) {
      emit('confirmed', res)
      emit('close')
    } else {
      ElMessage.warning(res.message || '清理失败')
    }
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="cd-overlay" @click.self="emit('close')"></div>
    </Transition>
    <Transition name="pop">
      <div v-if="visible && pkg" class="cd-dialog">
        <div class="cd-head">
          <span class="cd-title">确认清理</span>
          <div class="cd-close" @click="emit('close')"><el-icon><Close /></el-icon></div>
        </div>

        <div class="cd-body">
          <div class="cd-pkg">
            <span class="cd-pkg-name">{{ pkg.name }}</span>
            <span class="cd-pkg-meta">当前 {{ pkg.versions }} 个版本 · {{ fmtSize(pkg.size) }}</span>
          </div>

          <div class="cd-row">
            <label class="cd-label">保留最新版本数</label>
            <div class="th-num">
              <button @click="keep = Math.max(1, keep - 1)">−</button>
              <input v-model.number="keep" type="number" min="1" :max="pkg.versions" />
              <button @click="keep = Math.min(pkg.versions, keep + 1)">+</button>
            </div>
            <span class="th-unit">将删除 {{ toDelete.length }} 个版本</span>
          </div>

          <div v-if="toDelete.length" class="cd-del">
            <div class="cd-del-title">将删除版本（{{ toDelete.length }} 个）</div>
            <div class="cd-del-list">
              <span v-for="v in toDelete" :key="v.version" class="cd-del-tag">{{ v.version }}</span>
            </div>
          </div>
          <div v-else-if="loadingVer" class="cd-none">正在加载版本信息…</div>
          <div v-else class="cd-none">当前版本数未超过保留值，无需清理</div>
        </div>

        <div class="cd-foot">
          <span class="cd-freed">预计释放 {{ fmtSize(freedSpace) }}</span>
          <button class="btn unignore" @click="emit('close')">取消</button>
          <button class="btn clean" :class="{ disabled: !toDelete.length }" :disabled="cleaning || !toDelete.length" @click="confirm">
            {{ cleaning ? '清理中…' : `确认清理 ${toDelete.length} 个` }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .45);
  z-index: 140;
}
.cd-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(480px, 92vw);
  max-height: 84vh;
  z-index: 141;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: 0 16px 48px -16px rgba(0, 0, 0, .3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.cd-title { font-size: 15px; font-weight: 600; }
.cd-close {
  width: 28px;
  height: 28px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--ink-dim);
  font-size: 14px;
}
.cd-close:hover { background: var(--dgr-soft); color: var(--dgr); }
.cd-body { padding: 16px 20px; overflow-y: auto; }
.cd-pkg { margin-bottom: 16px; }
.cd-pkg-name {
  font-size: 15px;
  font-weight: 600;
  word-break: break-all;
  color: var(--ink);
  font-family: var(--num);
}
.cd-pkg-meta { display: block; font-size: 11.5px; color: var(--ink-faint); margin-top: 3px; }
.cd-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cd-label { font-size: 12.5px; color: var(--ink-dim); }
.th-num {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 4px;
  transition: border-color .12s;
}
.th-num:focus-within { border-color: var(--pri); }
.th-num button {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  border: 1px solid var(--line);
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-dim);
  background: var(--card);
  transition: .12s;
}
.th-num button:hover { color: var(--acc); border-color: var(--acc); }
.th-num input {
  width: 64px;
  border: none;
  outline: none;
  text-align: center;
  background: transparent;
  font-family: var(--num);
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  -moz-appearance: textfield;
}
.th-num input::-webkit-outer-spin-button,
.th-num input::-webkit-inner-spin-button { -webkit-appearance: none; }
.th-unit { font-size: 12px; color: var(--ink-dim); font-family: var(--num); }
.cd-del { margin-top: 16px; }
.cd-del-title { font-size: 12px; font-weight: 600; margin-bottom: 9px; color: var(--ink-dim); }
.cd-del-list { display: flex; flex-wrap: wrap; gap: 7px; max-height: 150px; overflow-y: auto; }
.cd-del-tag {
  font-family: var(--num);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 3px;
  background: var(--warn-soft);
  color: var(--warn);
  border: 1px solid var(--warn-line);
}
.cd-none {
  margin-top: 16px;
  padding: 16px;
  text-align: center;
  color: var(--ink-faint);
  font-size: 12.5px;
  background: var(--bg);
  border-radius: var(--r-md);
  border: 1px dashed var(--line);
}
.cd-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  background: var(--panel-soft);
}
.cd-freed { font-family: var(--num); font-size: 12.5px; color: var(--suc-deep); font-weight: 600; margin-right: auto; }

.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.pop-enter-active { transition: transform .2s ease, opacity .2s; }
.pop-leave-active { transition: transform .15s ease-in, opacity .15s; }
.pop-enter-from, .pop-leave-to { transform: translate(-50%, -46%) scale(.97); opacity: 0; }
</style>
