/**
 * 组件渲染与行为测试（vitest + jsdom + @vue/test-utils）—— 此前前端零组件渲染测试
 * 与 node:test 风格的 mcp.test.mjs（逻辑级 vm mock）互补：这里走真实 DOM 挂载与真实 document
 * 扫描范围由 vitest.config.js 的 include 限定，避免误扫 node:test 风格的测试文件
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import OriginSplit from '../src/components/OriginSplit.vue'
import { useCopyText } from '../src/composables/useCopyText.js'

describe('OriginSplit 渲染（真实 DOM 挂载）', () => {
  it('按 props 渲染分段条与图例：数量/tone/宽度/文案', () => {
    const wrapper = mount(OriginSplit, {
      props: {
        parts: [
          { label: '私有包', value: '12 个', pct: 60, tone: 'private' },
          { label: '缓存包', value: '8 个', pct: 40, tone: 'proxy' },
        ],
      },
    })
    const segs = wrapper.findAll('.osplit-seg')
    expect(segs).toHaveLength(2)
    expect(segs[0].classes()).toContain('t-private')
    expect(segs[1].classes()).toContain('t-proxy')
    expect(segs[0].attributes('style')).toContain('width: 60%')
    expect(segs[1].attributes('style')).toContain('width: 40%')
    const items = wrapper.findAll('.osplit-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toBe('私有包12 个')
    expect(items[0].find('.osplit-dot').classes()).toContain('t-private')
  })

  it('value 缺省时不渲染 <b>（v-if 分支）', () => {
    const wrapper = mount(OriginSplit, {
      props: { parts: [{ label: '私有包', value: '', pct: 100, tone: 'private' }] },
    })
    expect(wrapper.findAll('.osplit-item b')).toHaveLength(0)
    expect(wrapper.text()).toContain('私有包')
  })
})

describe('useCopyText 降级行为（真实 document，非 vm mock）', () => {
  let originalExec
  beforeEach(() => {
    originalExec = document.execCommand
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.execCommand = originalExec
    document.querySelectorAll('.el-message').forEach(el => el.remove())
  })

  it('clipboard 可用 → writeText 直接复制', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { copyText } = useCopyText()
    await copyText('hello', '', '已复制测试')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('clipboard 缺失 → 回退 execCommand，textarea 建后即删不残留', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => true)
    const { copyText } = useCopyText()
    await copyText('fallback text')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('execCommand 失败 → 按 selector 选中文本兜底（Ctrl+C 提示路径）', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => false)
    document.body.innerHTML = '<pre id="mcp-snip">config text</pre>'
    const { copyText } = useCopyText()
    await copyText('config text', '#mcp-snip')
    const selection = window.getSelection()
    expect(selection.rangeCount).toBeGreaterThan(0)
    expect(selection.toString()).toBe('config text')
  })
})