import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from 'vue/compiler-sfc'
import { ref, computed, watch, reactive, effectScope, nextTick } from 'vue'
import { useCopyText } from '../src/composables/useCopyText.js'

const filename = new URL('../src/components/McpDialog.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'mcp-test', genDefaultAs: 'component' }).content.replace(/^import[^\n]*\n/gm, '')

function mount(api = {}) {
  const effects = effectScope()
  const props = reactive({ modelValue: false })
  const messages = []
  const toasts = []
  const push = type => text => { messages.push(text); toasts.push({ type, text }) }
  const messageBox = { confirm: async () => {} }
  const component = new Function('ref', 'computed', 'watch', 'nextTick', 'api', 'ElMessage', 'ElMessageBox', 'CopyDocument', 'Hide', 'Plus', 'Refresh', 'location', 'useCopyText', `${script}; return component`)(
    ref, computed, watch, nextTick,
    { getMcpKeys: async () => ({ ok: true, keys: [] }), ...api },
    { success: push('success'), warning: push('warning'), info: push('info') }, messageBox,
    {}, {}, {}, {}, { origin: 'http://localhost' },
    // 包装注入：toast 走测试的 push 收集（toasts 断言依赖），降级逻辑仍是真实实现
    () => useCopyText({ message: { success: push('success'), info: push('info'), warning: push('warning') } }),
  )
  const state = effects.run(() => component.setup(props, { expose() {}, emit() {} }))
  return { state, props, messages, toasts, messageBox, stop: () => effects.stop() }
}

/** 模拟浏览器复制环境：clipboard 是否可用、execCommand 结果、可被选中的目标元素 */
function stubDom({ clipboard, execResult = true, target = null }) {
  class FakeField {
    constructor(value) {
      this.value = value
      this.selection = null
      this.focused = false
      this.style = {}
      this.removed = false
    }
    focus() { this.focused = true }
    setAttribute() {}
    select() { this.selection = 'all' }
    setSelectionRange(start, end) { this.selection = [start, end] }
    remove() { this.removed = true }
  }
  const created = []
  const names = ['navigator', 'document', 'getSelection', 'HTMLInputElement', 'HTMLTextAreaElement']
  const saved = names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)])
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true })
  globalThis.HTMLInputElement = FakeField
  globalThis.HTMLTextAreaElement = FakeField
  globalThis.document = {
    createElement: () => { const el = new FakeField(''); created.push(el); return el },
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => execResult,
    querySelector: () => target,
    createRange: () => ({ selectNodeContents() {} }),
  }
  globalThis.getSelection = () => ({ removeAllRanges() {}, addRange() {} })
  return {
    FakeField,
    created,
    restore: () => {
      for (const [n, d] of saved) {
        if (d) Object.defineProperty(globalThis, n, d)
        else delete globalThis[n]
      }
    },
  }
}

test('复制：安全上下文走 clipboard.writeText，不建临时 textarea', async t => {
  const vm = mount()
  t.after(vm.stop)
  let written = null
  const dom = stubDom({ clipboard: { writeText: async v => { written = v } } })
  t.after(dom.restore)
  await vm.state.copyText('vcm-secret', '#mcp-endpoint')
  assert.equal(written, 'vcm-secret')
  assert.equal(dom.created.length, 0)
  assert.deepEqual(vm.toasts, [{ type: 'success', text: '已复制' }])
})

test('复制：HTTP+IP 无 clipboard 时回退 execCommand（AC：非安全上下文仍可复制）', async t => {
  const vm = mount()
  t.after(vm.stop)
  const dom = stubDom({ clipboard: undefined, execResult: true })
  t.after(dom.restore)
  await vm.state.copyText('vcm-secret', '#mcp-endpoint')
  assert.equal(dom.created.length, 1)
  assert.equal(dom.created[0].removed, true, '临时 textarea 必须移除，避免密钥残留在 DOM')
  assert.deepEqual(vm.toasts, [{ type: 'success', text: '已复制' }])
})

test('复制：execCommand 被拒时选中文本提示手动 Ctrl+C，不留临时元素', async t => {
  const vm = mount()
  t.after(vm.stop)
  const target = {}
  const dom = stubDom({ clipboard: undefined, execResult: false, target })
  t.after(dom.restore)
  await vm.state.copyText('vcm-secret', '#mcp-endpoint')
  assert.deepEqual(vm.toasts, [{ type: 'info', text: '已选中文本，请按 Ctrl+C 复制' }])
})

test('复制：目标元素已消失时降级为普通告警', async t => {
  const vm = mount()
  t.after(vm.stop)
  const dom = stubDom({ clipboard: undefined, execResult: false, target: null })
  t.after(dom.restore)
  await vm.state.copyText('vcm-secret', '#mcp-new-key')
  assert.deepEqual(vm.toasts, [{ type: 'warning', text: '复制失败，请手动选中文本复制' }])
})

test('复制：非表单元素走 Range 选中分支', async t => {
  const vm = mount()
  t.after(vm.stop)
  let ranged = false
  const dom = stubDom({ clipboard: undefined, execResult: false, target: { textContent: 'x' } })
  t.after(dom.restore)
  globalThis.document.createRange = () => ({ selectNodeContents: () => { ranged = true } })
  await vm.state.copyText('config-json', '.mcp-config pre')
  assert.equal(ranged, true)
  assert.equal(vm.toasts[0].text, '已选中文本，请按 Ctrl+C 复制')
})

test('复制配置：取回明文后复制真实配置，并展开同一份文本供手动兜底', async t => {
  const vm = mount({ revealMcpKey: async id => ({ ok: true, key: `vcm_key_${id}` }) })
  t.after(vm.stop)
  let written = ''
  const dom = stubDom({ clipboard: { writeText: async v => { written = v } } })
  t.after(dom.restore)
  assert.equal(vm.state.configOpen.value, false)
  await vm.state.copyKeyConfig({ id: 7, name: '我的助手' })
  await new Promise(r => setImmediate(r))
  assert.match(written, /"Authorization": "Bearer vcm_key_7"/)
  assert.equal(vm.state.revealed.value.name, '我的助手')
  assert.equal(vm.state.revealed.value.text, written, '展开的文本必须与复制到剪贴板的一致')
  assert.equal(vm.state.configOpen.value, true, '复制前先展开示例块，否则选中落在隐藏节点上')
  assert.deepEqual(vm.toasts, [{ type: 'success', text: '已复制「我的助手」的完整接入配置' }])
  assert.equal(vm.state.revealing.value, null)
})

test('复制配置：明文不可恢复时报错引导重新生成，不带出占位符模板', async t => {
  const vm = mount({ revealMcpKey: async () => ({ ok: false, message: '该 Key 无法恢复明文（早于回看功能创建），请重新生成后更新客户端配置' }) })
  t.after(vm.stop)
  let written = ''
  const dom = stubDom({ clipboard: { writeText: async v => { written = v } } })
  t.after(dom.restore)
  await vm.state.copyKeyConfig({ id: 1, name: '旧 Key' })
  await new Promise(r => setImmediate(r))
  assert.equal(written, '')
  assert.equal(vm.state.revealed.value, null)
  assert.match(vm.state.error.value, /重新生成/)
})

test('复制配置：取回期间重复点击不发第二次请求，隐藏明文与刷新列表均清空', async t => {
  let release
  let calls = 0
  const vm = mount({ revealMcpKey: () => { calls++; return new Promise(resolve => { release = resolve }) } })
  t.after(vm.stop)
  const dom = stubDom({ clipboard: { writeText: async () => {} } })
  t.after(dom.restore)
  const pending = vm.state.copyKeyConfig({ id: 3, name: '测试' })
  await vm.state.copyKeyConfig({ id: 3, name: '测试' })
  assert.equal(calls, 1)
  assert.equal(vm.state.busy.value, true, '取回明文期间应锁定其它操作')
  release({ ok: true, key: 'vcm_test_key' })
  await pending
  assert.equal(vm.state.revealed.value.id, 3)
  vm.state.hideRevealed()
  assert.equal(vm.state.revealed.value, null)
  assert.equal(vm.state.configOpen.value, false)
  const second = vm.state.copyKeyConfig({ id: 3, name: '测试' })
  release({ ok: true, key: 'vcm_test_key' })
  await second
  assert.equal(vm.state.revealed.value.id, 3)
  await vm.state.loadKeys()
  assert.equal(vm.state.revealed.value, null, '列表刷新后不得残留上一次的明文')
})

test('结果页配置含真实 Key，示例块默认只含占位符', async t => {
  const vm = mount()
  t.after(vm.stop)
  let written = ''
  const dom = stubDom({ clipboard: { writeText: async v => { written = v } } })
  t.after(dom.restore)
  vm.state.newKey.value = 'vcm_aa11bb22'
  await vm.state.copyText(vm.state.fullConfig.value, '#mcp-full-config')
  assert.match(written, /"Authorization": "Bearer vcm_aa11bb22"/)
  assert.match(written, new RegExp(`"url": "${vm.state.endpoint}`))
  assert.match(vm.state.config, /Bearer <替换为你的 MCP Key>/)
})

test('删除已吊销记录：取消不发请求，确认后刷新列表', async t => {
  let calls = 0
  const vm = mount({ purgeMcpKey: async () => { calls++; return { ok: true } } })
  t.after(vm.stop)
  vm.messageBox.confirm = async () => { throw 'cancel' }
  await vm.state.purgeKey({ id: 1, name: '旧 Key' })
  assert.equal(calls, 0)
  assert.equal(vm.state.deleting.value, null)
  assert.equal(vm.state.error.value, '')
  vm.messageBox.confirm = async () => {}
  await vm.state.purgeKey({ id: 1, name: '旧 Key' })
  assert.equal(calls, 1)
  assert.equal(vm.state.deleting.value, null)
  assert.ok(vm.messages.includes('已删除'))
})

test('删除已吊销记录：业务错误落到可见提示，不抛未处理异常', async t => {
  const vm = mount({ purgeMcpKey: async () => ({ ok: false, message: '请先吊销该 Key' }) })
  t.after(vm.stop)
  await vm.state.purgeKey({ id: 1, name: '旧 Key' })
  assert.equal(vm.state.error.value, '请先吊销该 Key')
  assert.equal(vm.state.deleting.value, null)
})

test('MCP：名称为空不发请求，默认权限只读', async t => {
  let calls = 0
  const vm = mount({ createMcpKey: async () => { calls++; return { ok: true } } })
  t.after(vm.stop)
  vm.state.beginCreate()
  assert.equal(vm.state.scope.value, 'read')
  vm.state.name.value = '   '
  await vm.state.createKey()
  assert.equal(calls, 0)
  assert.match(vm.state.error.value, /名称/)
})

test('MCP：生成时禁止重复提交，关闭和返回列表均清空明文', async t => {
  let release
  let calls = 0
  const vm = mount({ createMcpKey: () => { calls++; return new Promise(resolve => { release = resolve }) } })
  t.after(vm.stop)
  vm.state.name.value = '测试'
  const pending = vm.state.createKey()
  await vm.state.createKey()
  assert.equal(calls, 1)
  let closed = false
  vm.state.close(() => { closed = true })
  assert.equal(closed, false)
  release({ ok: true, key: 'test-only-secret' })
  await pending
  assert.equal(vm.state.step.value, 'result')
  assert.equal(vm.state.newKey.value, 'test-only-secret')
  vm.state.close(() => { closed = true })
  assert.equal(closed, true)
  assert.equal(vm.state.newKey.value, '')
  vm.state.newKey.value = 'test-only-secret'
  vm.state.finishResult()
  assert.equal(vm.state.newKey.value, '')
  assert.equal(vm.state.step.value, 'list')
})

test('MCP：外部关闭时同步清理 Key，重新打开重载列表', async t => {
  const vm = mount()
  t.after(vm.stop)
  vm.props.modelValue = true
  vm.state.newKey.value = 'test-only-secret'
  vm.props.modelValue = false
  assert.equal(vm.state.newKey.value, '')
  assert.equal(vm.state.step.value, 'list')
})

test('MCP：加载及生成业务错误保持可重试状态', async t => {
  const vm = mount({ getMcpKeys: async () => ({ ok: false, message: '加载失败' }), createMcpKey: async () => ({ ok: false, message: '生成失败' }) })
  t.after(vm.stop)
  await vm.state.loadKeys()
  assert.equal(vm.state.loading.value, false)
  assert.equal(vm.state.error.value, '加载失败')
  vm.state.beginCreate()
  vm.state.name.value = '测试'
  await vm.state.createKey()
  assert.equal(vm.state.creating.value, false)
  assert.equal(vm.state.step.value, 'create')
  assert.equal(vm.state.newKey.value, '')
  assert.equal(vm.state.error.value, '生成失败')
})

test('MCP：取消吊销不发请求，确认后刷新列表', async t => {
  let calls = 0
  const vm = mount({ revokeMcpKey: async () => { calls++; return { ok: true } } })
  t.after(vm.stop)
  vm.messageBox.confirm = async () => { throw 'cancel' }
  await vm.state.revokeKey({ id: 1, name: '测试' })
  assert.equal(calls, 0)
  assert.equal(vm.state.revoking.value, null)
  assert.equal(vm.state.error.value, '')
  vm.messageBox.confirm = async () => {}
  await vm.state.revokeKey({ id: 1, name: '测试' })
  assert.equal(calls, 1)
  assert.equal(vm.state.revoking.value, null)
  assert.ok(vm.messages.includes('已吊销'))
})

// 回归守护（非行为测试）：对 LogsView.vue 源码做字符串断言，防止 MCP 鉴权失败筛选列被误删；
// 行为级验证需组件测试环境，当前以最小成本守住关键 UI 不回退
test('【源码守护】日志页源码含 MCP 鉴权失败筛选项与原因/IP/Key 指纹列', () => {
  const src = readFileSync(new URL('../src/views/LogsView.vue', import.meta.url), 'utf8')
  assert.match(src, /\{ key: 'mcp_auth_fail', label: 'MCP 鉴权' \}/, '筛选 tab 必须能单看鉴权失败')
  assert.match(src, /mcp_auth_fail: \[colIndex, colTime,/, '列集合按 tab 动态展示，否则原因与 IP 列不出来')
  assert.match(src, /detail\.action === 'mcp_auth_fail'/, '详情 Verdaccio Mate 要有专属分支')
  assert.match(src, /keyFingerprint/, 'Key 指纹用于归并同一把坏 Key 的重复尝试')
})
