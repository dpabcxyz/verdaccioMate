<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Hide, Plus, Refresh } from '@element-plus/icons-vue'
import api from '../api'
import { useCopyText } from '../composables/useCopyText.js'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const step = ref('list')
const loading = ref(false)
const creating = ref(false)
const revoking = ref(null)
const revealing = ref(null)
const deleting = ref(null)
const error = ref('')
const keys = ref([])
const name = ref('')
const scope = ref('read')
const newKey = ref('')
const configOpen = ref(false)
// details/toggle 事件回调：同步折叠状态。全局构造函数类型断言在模板表达式里无法被 vue-tsc 解析，收敛到 script
function onConfigToggle(e) {
  configOpen.value = /** @type {HTMLDetailsElement} */ (e.target).open
}
const revealed = ref(null)
const endpoint = `${location.origin}/mcp`
const busy = computed(() => creating.value || revoking.value !== null || revealing.value !== null || deleting.value !== null)
const activeKeys = computed(() => keys.value.filter(key => !key.revoked))
const revokedKeys = computed(() => keys.value.filter(key => key.revoked))
const config = JSON.stringify({
  mcpServers: { 'verdaccio-mate': { url: endpoint, headers: { Authorization: 'Bearer <替换为你的 MCP Key>' } } },
}, null, 2)

/** 含真实 Key 的完整配置：仅生成成功那一刻可得（服务端只存哈希，事后再取不到明文） */
function configWith(keyValue) {
  return JSON.stringify({
    mcpServers: { 'verdaccio-mate': { url: endpoint, headers: { Authorization: `Bearer ${keyValue}` } } },
  }, null, 2)
}
const fullConfig = computed(() => configWith(newKey.value))

watch(() => props.modelValue, open => {
  newKey.value = ''
  step.value = 'list'
  error.value = ''
  configOpen.value = false
  revealed.value = null
  if (open) loadKeys()
}, { flush: 'sync' })

async function loadKeys() {
  loading.value = true
  error.value = ''
  revealed.value = null
  try {
    const result = await api.getMcpKeys()
    if (!result.ok) throw new Error(result.message || '加载失败')
    keys.value = result.keys
  } catch (e) {
    error.value = e.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function beginCreate() {
  name.value = ''
  scope.value = 'read'
  error.value = ''
  revealed.value = null
  step.value = 'create'
}

async function createKey() {
  if (creating.value) return
  if (!name.value.trim()) {
    error.value = '请填写 Key 名称'
    return
  }
  creating.value = true
  error.value = ''
  try {
    const result = await api.createMcpKey(name.value.trim(), scope.value)
    if (!result.ok) throw new Error(result.message || '生成失败')
    newKey.value = result.key
    step.value = 'result'
  } catch (e) {
    error.value = e.message || '生成失败，请重试'
  } finally {
    creating.value = false
  }
}

function finishResult() {
  newKey.value = ''
  revealed.value = null
  step.value = 'list'
  loadKeys()
}

function close(done) {
  if (busy.value) return
  newKey.value = ''
  revealed.value = null
  done()
}

// 复制降级逻辑收敛至全站共享 composable（原与本组件内实现重复，且与 PackageDrawer 的判定方式漂移）
const { copyText } = useCopyText()

/** 列表行的「复制配置」：向服务端取回明文后组装真实配置，并展开示例块展示同一份文本，
 *  这样自动复制失败时用户仍能手抄；取不回明文（早于加密落盘功能创建的旧 Key）则报错引导重新生成 */
async function copyKeyConfig(key) {
  if (busy.value) return
  revealing.value = key.id
  error.value = ''
  try {
    const result = await api.revealMcpKey(key.id)
    if (!result.ok || !result.key) throw new Error(result.message || '取回 Key 失败，请重试')
    revealed.value = { id: key.id, name: key.name, text: configWith(result.key) }
    configOpen.value = true
    await nextTick()
    copyText(revealed.value.text, '.mcp-config pre', `已复制「${key.name}」的完整接入配置`)
  } catch (e) {
    error.value = e.message || '取回 Key 失败，请重试'
  } finally {
    revealing.value = null
  }
}

function hideRevealed() {
  revealed.value = null
  configOpen.value = false
}

async function purgeKey(key) {
  if (busy.value) return
  deleting.value = key.id
  error.value = ''
  try {
    await ElMessageBox.confirm(`删除「${key.name}」的吊销记录后不可恢复，仅影响 Verdaccio Mate 展示，不改变该 Key 已失效的事实。`, '删除 MCP Key 记录', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消',
    })
    const result = await api.purgeMcpKey(key.id)
    if (!result.ok) throw new Error(result.message || '删除失败')
    ElMessage.success('已删除')
    await loadKeys()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = e.message || '删除失败，请重试'
  } finally {
    deleting.value = null
  }
}

async function revokeKey(key) {
  if (busy.value) return
  revoking.value = key.id
  try {
    await ElMessageBox.confirm(`吊销「${key.name}」后，后续请求立即失效且不可恢复。客户端需配置新的 Key。`, '吊销 MCP Key', {
      type: 'warning', confirmButtonText: '确认吊销', cancelButtonText: '取消',
    })
    const result = await api.revokeMcpKey(key.id)
    if (!result.ok) throw new Error(result.message || '吊销失败')
    ElMessage.success('已吊销')
    await loadKeys()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = e.message || '吊销失败，请重试'
  } finally {
    revoking.value = null
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue" title="MCP 接入" width="min(720px, 94vw)" append-to-body destroy-on-close
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="mcp-content">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <template v-if="step === 'list'">
        <p class="mcp-intro">让 AI 客户端查询扫描状态、占用统计、缓存排行、包列表、版本依赖与用户名单，共 8 个只读工具。全部只读，不会改动缓存与用户。</p>
        <label class="mcp-label" for="mcp-endpoint">Streamable HTTP 端点</label>
        <div class="mcp-copy-row">
          <el-input id="mcp-endpoint" :model-value="endpoint" readonly />
          <el-button :icon="CopyDocument" aria-label="复制端点" @click="copyText(endpoint, '#mcp-endpoint')" />
        </div>
        <p class="mcp-hint">每个 Key 最多 30 次请求/分钟。「复制配置」会取回该 Key 的明文并展开在下方，用完可点「隐藏明文」。远程连接请使用 HTTPS；明文 HTTP 会暴露 Key。</p>
        <div class="mcp-toolbar">
          <b>有效 Key（{{ activeKeys.length }}）</b>
          <div>
            <el-button :icon="Refresh" :loading="loading" :disabled="busy" aria-label="刷新 Key 列表" @click="loadKeys" />
            <el-button type="primary" :icon="Plus" :disabled="busy" @click="beginCreate">生成 Key</el-button>
          </div>
        </div>
        <p v-if="loading" role="status" class="mcp-empty">正在加载 Key…</p>
        <template v-else>
          <p v-if="!activeKeys.length && !error" class="mcp-empty">暂无有效 Key，生成一个即可接入 AI 客户端。</p>
          <article v-for="key in activeKeys" :key="key.id" class="mcp-key-row">
            <div class="mcp-key-info">
              <div class="mcp-key-title"><b>{{ key.name }}</b><el-tag size="small" type="info">{{ key.scope === 'read' ? '只读' : '全量' }}</el-tag></div>
              <code>{{ key.mask }}</code>
              <small>创建 {{ key.createdAt }} · 最近调用 {{ key.lastUsedAt || '尚未使用' }}</small>
            </div>
            <div class="mcp-key-actions">
              <el-button size="small" :icon="CopyDocument" :loading="revealing === key.id" :disabled="busy" :aria-label="`复制 ${key.name} 的接入配置`" @click="copyKeyConfig(key)">复制配置</el-button>
              <el-button type="danger" plain size="small" :loading="revoking === key.id" :disabled="busy" :aria-label="`吊销 ${key.name}`" @click="revokeKey(key)">吊销</el-button>
            </div>
          </article>
          <details v-if="revokedKeys.length" class="mcp-history">
            <summary>已吊销（{{ revokedKeys.length }}）</summary>
            <div v-for="key in revokedKeys" :key="key.id" class="mcp-key-row">
              <div class="mcp-key-info"><b>{{ key.name }}</b><code>{{ key.mask }}</code></div>
              <el-button type="danger" plain size="small" :loading="deleting === key.id" :disabled="busy" :aria-label="`删除已吊销 Key ${key.name} 的记录`" @click="purgeKey(key)">删除</el-button>
            </div>
          </details>
        </template>
        <details class="mcp-config" :open="configOpen" @toggle="onConfigToggle">
          <summary>{{ revealed ? `客户端配置（「${revealed.name}」· 含明文 Key）` : '客户端配置示例' }}</summary>
          <p class="mcp-hint">
            {{ revealed
              ? '明文 Key 已展开在下方，关闭弹窗或点「隐藏明文」即从页面移除。'
              : '在支持远程 HTTP MCP 的客户端填写 URL 和 Authorization 请求头；各客户端配置格式可能不同。' }}
          </p>
          <pre>{{ revealed ? revealed.text : config }}</pre>
          <div class="mcp-config-actions">
            <el-button v-if="!revealed" :icon="CopyDocument" @click="copyText(config, '.mcp-config pre')">复制配置模板</el-button>
            <el-button v-else :icon="Hide" @click="hideRevealed">隐藏明文</el-button>
          </div>
        </details>
      </template>
      <form v-else-if="step === 'create'" @submit.prevent="createKey">
        <p class="mcp-intro">为每个客户端创建独立 Key，便于审计与单独吊销。</p>
        <label class="mcp-label" for="mcp-name">Key 名称</label>
        <el-input id="mcp-name" v-model="name" maxlength="40" show-word-limit placeholder="例如：我的 AI 助手" :disabled="creating" />
        <div class="mcp-label" id="mcp-scope-label">权限级别</div>
        <el-radio-group v-model="scope" aria-labelledby="mcp-scope-label" :disabled="creating">
          <el-radio value="read">只读（推荐）</el-radio>
          <el-radio value="full">全量</el-radio>
        </el-radio-group>
        <p class="mcp-hint">本期两种权限可查的工具完全相同；全量是为后续写操作预留的级别，建议按最小权限选只读。</p>
        <div class="mcp-form-actions">
          <el-button :disabled="creating" @click="step = 'list'; error = ''">返回</el-button>
          <el-button type="primary" native-type="submit" :loading="creating">确认生成</el-button>
        </div>
      </form>
      <template v-else>
        <el-alert title="完整 Key 仅显示这一次，请立即保存。关闭后无法找回。" type="warning" :closable="false" show-icon />
        <label class="mcp-label" for="mcp-new-key">新生成的 Key</label>
        <el-input id="mcp-new-key" :model-value="newKey" type="textarea" :rows="3" readonly autocomplete="off" />
        <p class="mcp-hint">请求头：Authorization: Bearer &lt;你的 Key&gt;。请勿发送到聊天、日志或代码仓库。</p>
        <label class="mcp-label" for="mcp-full-config">完整接入配置（已含本 Key）</label>
        <el-input id="mcp-full-config" :model-value="fullConfig" type="textarea" :rows="8" readonly autocomplete="off" class="mcp-full-config" />
        <div class="mcp-form-actions">
          <el-button type="primary" :icon="CopyDocument" @click="copyText(fullConfig, '#mcp-full-config')">复制完整接入配置</el-button>
          <el-button :icon="CopyDocument" @click="copyText(newKey, '#mcp-new-key')">只复制 Key</el-button>
          <el-button type="primary" @click="finishResult">已保存，返回列表</el-button>
        </div>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.mcp-content { color: var(--ink); }
.mcp-intro { margin: 0 0 16px; line-height: 1.7; }
.mcp-content > .el-alert { margin-bottom: 16px; }
.mcp-label { display: block; margin: 16px 0 8px; font-weight: 600; }
.mcp-copy-row, .mcp-toolbar, .mcp-key-row, .mcp-key-title, .mcp-form-actions { display: flex; align-items: center; gap: 10px; }
.mcp-copy-row .el-input { min-width: 0; }
.mcp-hint { color: var(--ink-dim); font-size: 12px; line-height: 1.7; margin: 10px 0; }
.mcp-toolbar { justify-content: space-between; flex-wrap: wrap; margin: 22px 0 10px; }
.mcp-key-row { justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--line); }
.mcp-key-info { min-width: 0; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.mcp-key-title { flex-wrap: wrap; }
.mcp-key-info small { color: var(--ink-faint); line-height: 1.6; }
.mcp-key-info code, .mcp-config pre { font-family: var(--num); }
.mcp-empty { text-align: center; padding: 24px 0; color: var(--ink-dim); }
.mcp-history, .mcp-config { margin-top: 18px; }
.mcp-history summary, .mcp-config summary { cursor: pointer; padding: 6px 0; }
.mcp-config pre { overflow: auto; padding: 14px; background: var(--card-2); border: 1px solid var(--line); border-radius: var(--r-md); font-size: 12px; margin: 10px 0 14px; }
.mcp-config-actions { display: flex; justify-content: flex-end; }
.mcp-key-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.mcp-full-config :deep(textarea) { font-family: var(--num); font-size: 12px; line-height: 1.6; }
.mcp-form-actions { justify-content: flex-end; margin-top: 22px; flex-wrap: wrap; }
</style>
