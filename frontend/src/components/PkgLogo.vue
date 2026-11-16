<script setup>
// 包 logo：优先取主页域名的 favicon（浏览器端加载，离线/加载失败回退首字母徽标）
// 懒加载：仅当组件进入视口（提前 120px）才发起图标请求，大列表不一次性并发数百个请求
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 36 },
  homepage: { type: String, default: '' },
})

// —— 视口懒加载状态 ——
const inView = ref(false)
const rootEl = ref(null)
let io = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !rootEl.value) {
    inView.value = true // 不支持 IO 时退化为立即加载
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      if (entries[0] && entries[0].isIntersecting) {
        inView.value = true
        if (io) io.disconnect()
      }
    },
    { rootMargin: '120px 0px' },
  )
  io.observe(rootEl.value)
})
onBeforeUnmount(() => {
  if (io) io.disconnect()
})

const letter = computed(() => {
  const base = (props.name.split('/').pop() || props.name || '?').trim()
  return (base[0] || '?').toUpperCase()
})

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.46)}px`,
  borderRadius: `${Math.round(props.size * 0.3)}px`,
}))

// favicon 来源：
// - GitHub 仓库主页 → 组织/用户头像 {owner}.png（GitHub 全站 favicon 是章鱼猫无区分度，头像才是该项目的 logo）
// - 其他主页 → 域名根路径 /favicon.ico
// 加载失败一律回退首字母徽标
const imgOk = ref(false)
const actualSrc = ref('')

const faviconUrl = computed(() => {
  const hp = props.homepage
  if (!hp) return ''
  try {
    const u = new URL(hp)
    // 过滤明显无效的 GitHub 子域名（如 epeli.github.com，正确应为 *.github.io）
    if (u.hostname.endsWith('.github.com') && u.hostname !== 'www.github.com') return ''
    if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
      const m = hp.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/[^/?#]+/)
      if (m) return `https://github.com/${m[1]}.png`
    }
    return u.origin + '/favicon.ico'
  } catch {
    return ''
  }
})

// ===== 共享 URL 探测缓存（跨组件全局）=====
// 策略：用 fetch(no-cors) 预检代替直接 img.src。
// fetch 的网络层失败（DNS/连接/超时）不会涌入控制台红色报错；
// 同 URL 所有组件实例共用一个 Promise，避免重复并发。
// 404 等 no-cors 下 opaque resolve，由 img @error 兜底（少量且可控）。
const _urlCache = new Map()   // url -> { ok, expires }
const _urlPending = new Map() // url -> Promise<boolean>
const TTL = 24 * 3600 * 1000  // 失败缓存 24h，避免反复探测已知的死链
const PROBE_TIMEOUT = 8000    // 探测超时 8s

function getUrlCache(url) {
  const entry = _urlCache.get(url)
  if (!entry) return null
  if (entry.expires < Date.now()) { _urlCache.delete(url); return null }
  return entry.ok
}

async function probeUrl(url) {
  const cached = getUrlCache(url)
  if (cached !== null) return cached
  if (_urlPending.has(url)) return _urlPending.get(url)

  const p = (async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
      await fetch(url, { mode: 'no-cors', signal: ctrl.signal, referrerPolicy: 'no-referrer' })
      clearTimeout(t)
      _urlCache.set(url, { ok: true, expires: Date.now() + TTL })
      return true
    } catch {
      _urlCache.set(url, { ok: false, expires: Date.now() + TTL })
      return false
    }
  })()

  _urlPending.set(url, p)
  try { return await p } finally { _urlPending.delete(url) }
}

watch([() => inView.value, () => faviconUrl.value], async ([v, url]) => {
  if (!v || !url) { actualSrc.value = ''; imgOk.value = false; return }
  const ok = await probeUrl(url)
  if (ok) actualSrc.value = url
  else { actualSrc.value = ''; imgOk.value = false }
}, { immediate: true })

function onImgOk() { imgOk.value = true }
function onImgErr() { imgOk.value = false }
</script>

<template>
  <span ref="rootEl" class="pkg-logo" :style="style" :title="name">
    <!-- fetch 预检通过后才挂载 img；加载成功后显示，失败回退字母徽标 -->
    <img v-if="actualSrc" class="fav" :class="{ on: imgOk }" :src="actualSrc" alt="" referrerpolicy="no-referrer" @load="onImgOk" @error="onImgErr" />
    <span v-show="!imgOk" class="lt">{{ letter }}</span>
  </span>
</template>

<style scoped>
.pkg-logo {
  display: inline-grid;
  place-items: center;
  color: var(--ink-dim);
  background: var(--num-bg);
  border: 1px solid var(--line);
  font-family: var(--num);
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
}
.lt { grid-area: 1 / 1; }
.fav {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
  opacity: 0;
}
.fav.on { opacity: 1; }
</style>
