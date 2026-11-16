<script setup>
import { reactive, watch, nextTick, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Box, Coin, Aim } from '@element-plus/icons-vue'
import { useStore } from '../store'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const { state, saveThresholds } = useStore()

const form = reactive({
  versionThreshold: 15,
  sizeThreshold: 500,
  exceptions: [],
})
let autoSaveTimer = null
let syncing = false

watch(
  () => state.threshold,
  (t) => {
    syncing = true
    form.versionThreshold = t.versionThreshold
    form.sizeThreshold = t.sizeThreshold
    form.exceptions = t.exceptions.map(e => ({ ...e }))
    nextTick(() => { syncing = false })
  },
  { immediate: true, deep: true },
)

// 自动保存：阈值或例外变化后防抖 500ms 落库
watch(
  () => [form.versionThreshold, form.sizeThreshold, form.exceptions],
  () => {
    if (syncing) return
    clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(doAutoSave, 500)
  },
  { deep: true },
)

// 抽屉关闭时清掉未触发的防抖，避免组件已卸载还发起一次保存
onUnmounted(() => clearTimeout(autoSaveTimer))

// 新增例外表单
const addForm = reactive({ pkgName: '', versionThreshold: 15, sizeThreshold: 500 })

function clamp(v, min, max) {
  const n = Number(v)
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

const versionMax = 100
const sizeMax = 10000 // MB

function setVersion(v) {
  form.versionThreshold = clamp(v, 1, versionMax)
}
function setSize(v) {
  form.sizeThreshold = clamp(v, 1, sizeMax)
}

function removeException(name) {
  form.exceptions = form.exceptions.filter(e => e.pkgName !== name)
}

async function doAutoSave() {
  const res = await saveThresholds({
    versionThreshold: clamp(form.versionThreshold, 1, versionMax),
    sizeThreshold: clamp(form.sizeThreshold, 1, sizeMax),
    exceptions: form.exceptions,
  })
  // 只有后端确认落库才报「已保存」：入参契约层/网络失败现在都会带 message 回来
  if (res.ok) ElMessage.success('设置已自动保存，包列表状态已更新')
  else ElMessage.error(res.message || '设置保存失败，请检查后重试')
}

function addException() {
  const name = addForm.pkgName.trim()
  if (!name) {
    ElMessage.warning('请输入包名')
    return
  }
  if (form.exceptions.some(e => e.pkgName === name)) {
    ElMessage.warning('该包已有例外配置')
    return
  }
  form.exceptions.push({
    pkgName: name,
    versionThreshold: clamp(addForm.versionThreshold, 1, versionMax),
    sizeThreshold: clamp(addForm.sizeThreshold, 1, sizeMax),
  })
  addForm.pkgName = ''
  addForm.versionThreshold = 15
  addForm.sizeThreshold = 500
}

// 命中状态：该包是否存在于当前缓存
function hitOf(name) {
  return state.packages.some(p => p.name === name)
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
      <aside v-if="modelValue" class="th-drawer">
        <div class="th-drawer-head">
          <div class="th-head-title">
            <span class="th-head-name">阈值配置</span>
            <span class="th-head-sub">全局阈值与单包例外，修改后自动重算包列表状态</span>
          </div>
          <div class="th-drawer-close" @click="close"><el-icon><Close /></el-icon></div>
        </div>

        <div class="th-body">
          <!-- 全局阈值（合并单卡） -->
          <div class="th-card">
            <div class="th-sec">
              <div class="th-head">
                <span class="th-title"><el-icon class="ico" :size="15"><Box /></el-icon>版本数阈值</span>
                <span class="th-tag">默认 15 · 范围 1~100</span>
              </div>
              <div class="th-desc">版本数超过阈值的包将标记为<b>预警</b>并置顶，提示清理。</div>
              <div class="th-row">
                <div class="th-num">
                  <button @click="setVersion(form.versionThreshold - 1)">−</button>
                  <input v-model.number="form.versionThreshold" type="number" min="1" :max="versionMax" @change="setVersion(form.versionThreshold)" />
                  <button @click="setVersion(form.versionThreshold + 1)">+</button>
                </div>
                <span class="th-unit">个版本</span>
                <span class="th-actions"><span class="th-reset" @click="form.versionThreshold = 15">恢复默认</span></span>
              </div>
            </div>

            <div class="th-divider"></div>

            <div class="th-sec">
              <div class="th-head">
                <span class="th-title"><el-icon class="ico" :size="15"><Coin /></el-icon>单包大小阈值</span>
                <span class="th-tag">默认 500 MB</span>
              </div>
              <div class="th-desc">单包占用超过该值的包标记为<b>大包</b>，便于定位体积异常缓存。</div>
              <div class="th-row">
                <div class="th-num">
                  <button @click="setSize(form.sizeThreshold - 100)">−</button>
                  <input v-model.number="form.sizeThreshold" type="number" min="1" :max="sizeMax" @change="setSize(form.sizeThreshold)" />
                  <button @click="setSize(form.sizeThreshold + 100)">+</button>
                </div>
                <span class="th-unit">MB</span>
                <span class="th-actions"><span class="th-reset" @click="form.sizeThreshold = 500">恢复默认</span></span>
              </div>
            </div>
          </div>

          <!-- 单包例外 -->
          <div class="ex-head">
            <span class="ex-title"><el-icon :size="14" style="vertical-align:-2px"><Aim /></el-icon> 单包例外</span>
            <span class="ex-sub">为指定包覆盖全局阈值</span>
          </div>

          <div class="vtable ex-table">
            <table>
              <thead>
                <tr>
                  <th>包名</th>
                  <th style="width: 114px">版本数阈值</th>
                  <th style="width: 110px">大小阈值</th>
                  <th style="width: 84px">命中</th>
                  <th style="width: 72px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in form.exceptions" :key="e.pkgName">
                  <td><span class="pkg-cell">{{ e.pkgName }}</span></td>
                  <td><span class="num-cell">{{ e.versionThreshold }}</span></td>
                  <td><span class="num-cell">{{ e.sizeThreshold }} MB</span></td>
                  <td>
                    <span class="tag" :class="hitOf(e.pkgName) ? 'ok' : 'ign'">
                      {{ hitOf(e.pkgName) ? '命中' : '未命中' }}
                    </span>
                  </td>
                  <td><button class="btn remove" @click="removeException(e.pkgName)">删除</button></td>
                </tr>
              </tbody>
            </table>
            <div v-if="!form.exceptions.length" class="empty-tip">暂无例外配置，可在下方添加</div>
          </div>

          <!-- 添加例外 -->
          <div class="add-ex">
            <input v-model="addForm.pkgName" class="ae-pkg" type="text" placeholder="包名，如 lodash 或 @scope/name" @keyup.enter="addException" />
            <input v-model.number="addForm.versionThreshold" class="ae-num" type="number" min="1" max="100" placeholder="版本阈值" />
            <input v-model.number="addForm.sizeThreshold" class="ae-num" type="number" min="1" placeholder="大小阈值(MB)" />
            <button class="btn clean" @click="addException">添加例外</button>
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
.th-drawer {
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
.th-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
}
.th-head-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.th-head-name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}
.th-head-sub {
  font-size: 12px;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  background: var(--card);
  border: 1px solid var(--line);
  color: var(--ink-dim);
  font-size: 13px;
  cursor: pointer;
}
.th-drawer-close:hover { background: var(--dgr-soft); color: var(--dgr); border-color: var(--dgr-line); }
.th-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 24px;
}

.th-card {
  background: var(--card-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow);
  margin-bottom: 14px;
}
.th-divider { border-top: 1px dashed var(--line); margin: 16px 0; }
.th-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.th-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
.th-title .ico { color: var(--ink-dim); }
.th-tag { font-size: 11.5px; font-weight: 500; padding: 3px 9px; border-radius: 3px; background: var(--num-bg); color: var(--ink-dim); white-space: nowrap; }
.th-desc { font-size: 12px; color: var(--ink-dim); margin: 9px 0 16px; line-height: 1.75; }
.th-desc b { color: var(--warn); }
.th-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.th-num {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 5px;
  transition: border-color .15s;
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
  transition: .15s;
}
.th-num button:hover { color: var(--acc); border-color: var(--acc); }
.th-num input {
  width: 96px;
  border: none;
  outline: none;
  text-align: center;
  background: transparent;
  font-family: var(--num);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  -moz-appearance: textfield;
}
.th-num input::-webkit-outer-spin-button,
.th-num input::-webkit-inner-spin-button { -webkit-appearance: none; }
.th-unit { font-size: 12.5px; color: var(--ink-faint); font-weight: 600; }
.th-actions { margin-left: auto; }
.th-reset { font-size: 12px; color: var(--ink-faint); cursor: pointer; text-decoration: underline dotted; }
.th-reset:hover { color: var(--acc); }

.ex-head { display: flex; align-items: baseline; gap: 10px; margin: 4px 2px 12px; }
.ex-title { font-size: 14px; font-weight: 600; }
.ex-sub { font-size: 12px; color: var(--ink-faint); }
.ex-table { margin-bottom: 14px; }
.pkg-cell { font-weight: 600; word-break: break-all; font-family: var(--num); }
.empty-tip { padding: 30px 0; text-align: center; color: var(--ink-faint); font-size: 12.5px; }

.add-ex {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  padding: 14px;
  flex-wrap: wrap;
}
.add-ex input {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink);
  font-family: var(--sans);
  outline: none;
  transition: border-color .15s;
}
.add-ex input::placeholder { color: var(--ink-faint); }
.add-ex input:focus { border-color: var(--pri); }
.ae-pkg { flex: 1; min-width: 180px; }
.ae-num { width: 120px; }

.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.drawer-r-enter-active { transition: transform .35s cubic-bezier(.2, .8, .25, 1); }
.drawer-r-leave-active { transition: transform .25s ease-in; }
.drawer-r-enter-from, .drawer-r-leave-to { transform: translateX(100%); }

/* 移动端：底部弹窗 85vh */
@media (max-width: 767px) {
  .th-drawer {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 85vh;
    border-radius: 6px 6px 0 0;
  }
  .th-body { padding: 18px 16px 22px; }
  .th-num input { width: 72px; font-size: 19px; }
  .add-ex { flex-direction: column; align-items: stretch; }
  .add-ex .ae-pkg, .add-ex .ae-num { width: 100%; }
  .ex-table { overflow-x: auto; }
  .ex-table table { min-width: 480px; }
}
</style>