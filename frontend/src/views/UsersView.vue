<template>
  <div class="page-inner users-page">
    <div class="page-head">
      <div class="page-title"><el-icon :size="17" style="vertical-align:-2px;margin-right:6px;color:var(--ink-dim)"><User /></el-icon>用户管理</div>
      <div class="page-sub">
        Verdaccio Mate 与原版 Verdaccio 用户名单互通
        <span v-if="currentName" class="sub-tip">（当前登录 Verdaccio Mate 账号为 <b>{{ currentName }}</b>，不可删除）</span>
      </div>
    </div>
    <div class="page-action">
      <button class="tool-btn" :disabled="syncing" title="同步用户名（将 Verdaccio Mate 内置账号补写入 htpasswd；已存在同名用户时不覆盖其密码）" @click="syncUsers"><el-icon :size="14"><Loading v-if="syncing" class="is-loading" /><Refresh v-else /></el-icon></button>
      <button class="tool-btn" title="新增用户（立即写入原版 Verdaccio 的 htpasswd）" @click="openAdd"><el-icon :size="14"><Plus /></el-icon></button>
    </div>

    <div v-if="!enabled" class="empty-state">
      <el-icon class="empty-ico" :size="36"><Lock /></el-icon>
      <div class="empty-t">未找到 htpasswd 用户文件</div>
      <div class="empty-d">无法读取 原版 Verdaccio 用户文件。请在 docker-compose 挂载 htpasswd，或用环境变量 VERDACCIO_HTPASSWD 指定路径。</div>
    </div>

    <div v-else class="glass-card users-card">
      <el-table ref="tableEl" :data="displayUsers" v-loading="loading" class="users-table" empty-text="暂无用户" :max-height="tableMaxH">
        <el-table-column label="#" type="index" width="64" />
        <el-table-column label="用户名" min-width="180">
          <template #default="{ row }">
            <span class="uname">{{ row.name }}</span>
            <span v-if="row.name === currentName" class="tag-me">当前账号</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="140">
          <template #default="{ row }">
            <span v-if="row.source === 'builtin'" class="tag broken">Verdaccio Mate</span>
            <span v-else class="tag gray">原版 Verdaccio</span>
          </template>
        </el-table-column>
        <el-table-column label="加密算法" width="140">
          <template #default="{ row }">
            <span class="algo">{{ algoText(row.algo) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="240">
          <template #default="{ row }">
            <span class="remark" :class="remarkClass(row)">{{ row.remark || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="210">
          <template #default="{ row }">
            <span class="cell-time">{{ createdAt(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="176">
          <template #default="{ row }">
            <button class="btn ignore op-btn-cell" :disabled="row.source === 'builtin'" @click="openPwd(row)">修改密码</button>
            <button class="btn remove op-btn-cell" :disabled="row.source === 'builtin' || row.name === currentName" @click="del(row)">删除</button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新增用户（玻璃拟态自绘对话框，与全局一致） -->
    <Teleport to="body">
      <Transition name="pop">
        <div v-if="addVisible" class="cd-overlay">
          <div class="cd-dialog">
            <div class="cd-head">
              <span class="cd-title"><el-icon :size="14" style="vertical-align:-2px;margin-right:6px"><User /></el-icon>新增用户</span>
              <div class="cd-close" @click="addVisible = false"><el-icon :size="12"><Close /></el-icon></div>
            </div>
            <div class="cd-body">
              <div class="cd-field">
                <label>用户名</label>
                <input v-model="addForm.name" placeholder="小写字母、数字及 - _ ." maxlength="32" />
              </div>
              <div class="cd-field">
                <label>密码</label>
                <input v-model="addForm.password" type="password" placeholder="至少 6 位" />
              </div>
              <div class="cd-field">
                <label>确认密码</label>
                <input v-model="addForm.confirm" type="password" placeholder="再次输入密码" @keyup.enter="submitAdd" />
              </div>
            </div>
            <div class="cd-foot">
              <button class="btn unignore" @click="addVisible = false">取消</button>
              <button class="btn clean" :disabled="submitting" @click="submitAdd">{{ submitting ? '新增中…' : '确认新增' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 修改密码（玻璃拟态自绘对话框，与全局一致） -->
    <Teleport to="body">
      <Transition name="pop">
        <div v-if="pwdVisible" class="cd-overlay">
          <div class="cd-dialog">
            <div class="cd-head">
              <span class="cd-title"><el-icon :size="14" style="vertical-align:-2px;margin-right:6px"><Key /></el-icon>重置密码 · {{ pwdTarget }}</span>
              <div class="cd-close" @click="pwdVisible = false"><el-icon :size="12"><Close /></el-icon></div>
            </div>
            <div class="cd-body">
              <div class="cd-field">
                <label>新密码</label>
                <input v-model="pwdForm.password" type="password" placeholder="至少 6 位" />
              </div>
              <div class="cd-field">
                <label>确认密码</label>
                <input v-model="pwdForm.confirm" type="password" placeholder="再次输入新密码" @keyup.enter="submitPwd" />
              </div>
            </div>
            <div class="cd-foot">
              <button class="btn unignore" @click="pwdVisible = false">取消</button>
              <button class="btn clean" :disabled="submitting" @click="submitPwd">{{ submitting ? '重置中…' : '确认重置' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Loading, Plus, Lock, User, Key, Close } from '@element-plus/icons-vue'
import api from '../api/index.js'
import { notifyError } from '../utils/notify.js'

const users = ref([])
const enabled = ref(true)
const loading = ref(false)
const submitting = ref(false)
const builtin = ref('admin') // Verdaccio Mate 内置账号名（后端 VCM_USERNAME）

// 合并展示：htpasswd 用户标来源 file；Verdaccio Mate 内置账号（VCM_USERNAME）单独一行标来源 builtin（自建）
const displayUsers = computed(() => {
  const hs = users.value.map(u => ({ ...u, source: u.name === builtin.value ? 'builtin' : 'file' }))
  if (!hs.some(x => x.source === 'builtin')) {
    hs.unshift({
      name: builtin.value, algo: null, meta: null, source: 'builtin',
      login: false, upgrade: false,
      remark: '凭据来自环境变量（VCM_PASSWORD），不依赖本文件',
    })
  }
  return hs
})

const currentName = ref(null)
try {
  const u = JSON.parse(localStorage.getItem('vcm-user') || sessionStorage.getItem('vcm-user') || 'null')
  currentName.value = u?.name || null
} catch { currentName.value = null }

const algoText = a => (a === '2a' || a === '2b' || a === '2y' ? `bcrypt(${a})` : a || '—')
// 备注着色：可登录绿、登录即升级橙、不可登录红、内置账号虚拟行中性灰
const remarkClass = row => {
  if (row.source === 'builtin' && !row.algo) return 'dim'
  if (row.upgrade) return 'warn'
  return row.login ? 'ok' : 'bad'
}
const createdAt = row => {
  if (row.source === 'builtin') return 'Verdaccio Mate 内置账号（VCM_USERNAME）'
  if (!row.meta) return '—'
  const m = String(row.meta).match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/)
  if (!m) return row.meta
  const d = new Date(m[1])
  return Number.isNaN(d.getTime()) ? m[1] : d.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

async function load() {
  loading.value = true
  try {
    const r = await api.getHtpasswdUsers()
    if (!r.ok || !r.enabled) { enabled.value = false; users.value = [] }
    else {
      enabled.value = true
      users.value = r.users || []
      if (r.builtin) builtin.value = r.builtin
    }
  } catch (e) {
    enabled.value = false
    ElMessage.error(e?.message || '加载用户列表失败')
  } finally {
    loading.value = false
  }
}

// —— 同步用户名：Verdaccio Mate 内置账号补写入 htpasswd，原版 Verdaccio 侧即可用同一账号登录 ——
const syncing = ref(false)
async function syncUsers() {
  syncing.value = true
  try {
    const r = await api.syncHtpasswdUsers()
    if (!r.ok) return ElMessage.error(r.message || '同步失败')
    ElMessage.success(r.added ? `${r.message}（原版 Verdaccio 侧现可用此账号登录）` : r.message)
    load()
  } catch (e) {
    ElMessage.error(e?.message || '同步失败，请检查 htpasswd 挂载是否可写')
  } finally {
    syncing.value = false
  }
}

// —— 新增 ——
const addVisible = ref(false)
const addForm = ref({ name: '', password: '', confirm: '' })
function openAdd() {
  addForm.value = { name: '', password: '', confirm: '' }
  addVisible.value = true
}
async function submitAdd() {
  const { name, password, confirm } = addForm.value
  if (!name.trim()) return ElMessage.warning('请输入用户名')
  if (password.length < 6) return ElMessage.warning('密码至少 6 位')
  if (password !== confirm) return ElMessage.warning('两次输入的密码不一致')
  submitting.value = true
  try {
    const r = await api.addHtpasswdUser(name.trim(), password)
    if (!r.ok) return ElMessage.error(r.message || '新增失败')
    ElMessage.success(r.message)
    // 创建成功后同步：兜底补写 Verdaccio Mate 内置账号（VCM_USERNAME）到 htpasswd，双方用户名并集保持一致
    api.syncHtpasswdUsers().catch(() => {})
    addVisible.value = false
    load()
  } catch (e) {
    notifyError(e, '新增用户失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// —— 修改密码 ——
const pwdVisible = ref(false)
const pwdTarget = ref('')
const pwdForm = ref({ password: '', confirm: '' })
function openPwd(row) {
  pwdTarget.value = row.name
  pwdForm.value = { password: '', confirm: '' }
  pwdVisible.value = true
}
async function submitPwd() {
  const { password, confirm } = pwdForm.value
  if (password.length < 6) return ElMessage.warning('密码至少 6 位')
  if (password !== confirm) return ElMessage.warning('两次输入的密码不一致')
  submitting.value = true
  try {
    const r = await api.resetHtpasswdPassword(pwdTarget.value, password)
    if (!r.ok) return ElMessage.error(r.message || '重置失败')
    ElMessage.success(r.message)
    pwdVisible.value = false
  } catch (e) {
    notifyError(e, '重置密码失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// —— 删除（标准保护：当前登录账号禁用；admin 二次警告） ——
async function del(row) {
  const isAdmin = row.name === 'admin'
  const tip = isAdmin
    ? `删除用户 <b>${row.name}</b> 后，该用户将无法登录 原版 Verdaccio 拉取/发布包。<br/>该用户是默认管理员，请确认已准备好替代账号。`
    : `删除用户 <b>${row.name}</b> 后，该用户将无法登录 原版 Verdaccio 拉取/发布包。`
  try {
    await ElMessageBox.confirm(tip, '确认删除用户', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'is-danger',
      dangerouslyUseHTMLString: true,
    })
  } catch { return }
  submitting.value = true
  try {
    const r = await api.removeHtpasswdUser(row.name)
    if (!r.ok) return ElMessage.error(r.message || '删除失败')
    ElMessage.success(r.message)
    load()
  } catch (e) {
    notifyError(e, '删除用户失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// —— 表格高度自适应：max-height 撑满剩余可视高度 ——
// 行少时表格保持自然高度（无多余空白），行多时内部滚动；页面本身不出现垂直滚动条
const tableEl = ref(null)
const tableMaxH = ref(480)
function fitTable() {
  const el = tableEl.value?.$el
  if (!el) return
  const isMobile = window.innerWidth < 768
  const reserve = isMobile ? 100 : 56 // 移动：Tabbar(≈56)+padding(40)+容差；桌面：padding(48)+容差
  tableMaxH.value = Math.max(280, Math.floor(window.innerHeight - el.getBoundingClientRect().top - reserve))
}
let fitTimer = 0
function onWinResize() {
  clearTimeout(fitTimer)
  fitTimer = setTimeout(fitTable, 100)
}
onMounted(() => {
  load()
  window.addEventListener('resize', onWinResize)
  nextTick(fitTable)
  setTimeout(fitTable, 400) // 路由过渡动画结束、布局稳定后再校准，避免叠加期 top 偏差
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  clearTimeout(fitTimer)
})
</script>

<style scoped>
.page-inner {
  padding: 22px 24px 48px;
}
.page-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 10px;
}
.page-action {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 16px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
}
.page-sub {
  font-size: 12.5px;
  color: var(--ink-faint);
  flex: 1;
  min-width: 240px;
  line-height: 1;
  align-self: center;
}
.sub-tip b { color: var(--acc); }

.glass-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: var(--shadow);
  padding: 6px 14px;
  overflow: hidden;
}
.users-card :deep(.el-table) {
  --el-table-border-color: var(--line);
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--panel-soft);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  background: transparent;
  color: var(--ink);
}
.users-card :deep(.el-table th.el-table__cell) {
  color: var(--ink-faint);
  font-size: 12px;
  font-weight: 600;
  background: transparent;
}
.users-card :deep(.el-table td.el-table__cell) { border-bottom-color: var(--line); }
.uname { font-weight: 600; color: var(--ink); }
.tag-me {
  margin-left: 8px;
  font-size: 11px;
  color: var(--acc);
  border: 1px solid var(--acc-line);
  background: var(--acc-soft);
  border-radius: 3px;
  padding: 1px 8px;
}
.algo {
  font-size: 12px;
  color: var(--ink-dim);
  font-family: var(--mono, ui-monospace, Menlo, monospace);
}
/* 备注列：按登录支持情况分级着色 */
.remark { font-size: 12px; color: var(--ink-dim); }
.remark.ok { color: var(--suc-deep); }
html.dark .remark.ok { color: var(--suc); }
.remark.warn { color: var(--warn); }
.remark.bad { color: var(--dgr); }
.remark.dim { color: var(--ink-faint); }
}
.cell-time { font-size: 12.5px; color: var(--ink-dim); white-space: nowrap; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}
.empty-ico { color: var(--ink-faint); }
.empty-t { font-size: 15px; font-weight: 600; color: var(--ink); }
.empty-d { font-size: 12.5px; color: var(--ink-faint); max-width: 420px; line-height: 1.7; }

/* 自绘对话框（与 CleanDialog / 详情对话框同一风格） */
.cd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .45);
  z-index: 500;
}
.cd-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 92vw);
  z-index: 501;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 30px 80px -24px rgba(0, 0, 0, .5);
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
.cd-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.cd-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid var(--line);
  cursor: pointer;
  color: var(--ink-dim);
  font-size: 13px;
}
.cd-close:hover { background: var(--dgr-soft); color: var(--dgr); border-color: var(--dgr-line); }
.cd-body {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cd-field { display: flex; align-items: center; gap: 12px; }
.cd-field label { width: 72px; font-size: 13px; color: var(--ink-dim); flex-shrink: 0; }
.cd-field input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  font-size: 13px;
  outline: none;
  transition: border-color .15s;
}
.cd-field input:focus { border-color: var(--pri); }
.cd-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}
.pop-enter-active, .pop-leave-active { transition: opacity .18s ease, transform .18s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(.96); }

@media (max-width: 767px) {
  .page-inner { padding: 14px 12px 40px; }
  .page-head { flex-direction: column; align-items: flex-start; }
}
</style>
