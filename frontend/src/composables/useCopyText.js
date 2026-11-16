/**
 * 剪贴板复制 composable —— 全站唯一的复制降级实现（原 McpDialog / PackageDrawer 各写一遍）
 * 策略：navigator.clipboard.writeText → 非安全上下文（HTTP+IP 的 NAS 部署）降级隐藏 textarea + execCommand
 *       → 仍失败则按 selector 选中文本，提示用户手动 Ctrl+C
 * message 可注入：默认 element-plus 的 ElMessage；测试环境注入收集器以断言 toast（依赖注入，生产零改动）
 */
import { ElMessage } from 'element-plus'

/** 按 CSS 选择器把目标元素文本选中（execCommand 需真实用户手势，失败时至少让用户可直接 Ctrl+C） */
function selectFallback(selector) {
  if (!selector) return false
  const el = document.querySelector(selector)
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    el.select()
    el.setSelectionRange(0, el.value.length)
  } else {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}

export function useCopyText({ message = ElMessage } = {}) {
  const toast = (type, text) => message[type]?.(text)

  /**
   * @param {string} text 要复制的文本
   * @param {string} [selector] 降级选中文本的目标元素选择器（可省略）
   * @param {string} [notice] 成功提示文案（默认「已复制」）
   */
  async function copyText(text, selector, notice) {
    const value = String(text || '')
    try {
      // Verdaccio Mate 以 HTTP + IP 访问时属非安全上下文，navigator.clipboard 不存在，需回退 execCommand
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        toast('success', notice || '已复制')
        return
      }
    } catch { /* 权限被拒或写入失败，落到下方回退 */ }
    let ta
    try {
      ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, value.length)
      if (document.execCommand('copy')) {
        toast('success', notice || '已复制')
        return
      }
    } catch { /* 走选中兜底 */ } finally {
      ta?.remove()
    }
    const selected = selectFallback(selector)
    toast(selected ? 'info' : 'warning', selected ? '已选中文本，请按 Ctrl+C 复制' : '复制失败，请手动选中文本复制')
  }

  return { copyText }
}