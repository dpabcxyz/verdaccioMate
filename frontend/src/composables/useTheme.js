/**
 * 主题管理 —— 手动切换 + 按日出/日落自动切换
 * - 手动切换：立即生效；自动模式下记为「今日手动覆盖」，次日自动恢复自动模式
 * - 自动模式（默认开启）：用 NOAA 日出日落算法按部署地经纬度算当天日出/日落时刻，
 *   日出 → 亮色、日落 → 暗色；每 30s 校验一次，跨天自动重算
 * - 坐标来源：后端 /api/location（按 NAS 部署地公网 IP 定位），定位失败回退上海坐标，
 *   结果缓存于 localStorage（vcm-coords），登录后拉取一次
 */
import { ref, computed } from 'vue'
import { storage } from '../utils/storage'

const THEME_KEY = 'vcm-theme'
const AUTO_KEY = 'vcm-theme-auto'
const COORDS_KEY = 'vcm-coords'
const OVERRIDE_KEY = 'vcm-theme-override' // 值为日期字符串，当日手动覆盖后自动模式暂停
const SHANGHAI = { lat: 31.23, lng: 121.47 }
const ZENITH = 90.833 // 日出/日落定义高度角（含大气折射）

const theme = ref(storage.get(THEME_KEY) === 'dark' ? 'dark' : 'bright')
const auto = ref(storage.get(AUTO_KEY) !== '0') // 默认开启
const coords = ref(loadCoords())

let schedule = null // { date, sunrise: Date, sunset: Date }
let timer = null

// —— 坐标 ——
function loadCoords() {
  const raw = storage.get(COORDS_KEY)
  if (raw) {
    try {
      const c = JSON.parse(raw)
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) return c
    } catch { /* 解析失败按无坐标处理 */ }
  }
  return null
}

function saveCoords(c) {
  storage.set(COORDS_KEY, JSON.stringify(c))
}

function applyTheme(t) {
  theme.value = t
  storage.set(THEME_KEY, t)
  // 对齐 Element Plus 暗色机制：html.dark class + dark/css-vars.css
  document.documentElement.classList.toggle('dark', t === 'dark')
}

// —— NOAA 日出日落算法（零依赖，精确到分钟） ——
const toRad = d => (d * Math.PI) / 180
const toDeg = r => (r * 180) / Math.PI
// dayOfYear 用 UTC 组件（NOAA 算法以 UTC 为基准）
const dayOfYearUTC = d => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)

/**
 * 返回当天本地时间的日出/日落 Date（算法输出 UTC 时刻转本地），极昼/极夜返回 null。
 * ut 的含义：hour=6/18 是「本地标准时间日出日落的估算值」，算法输出 ut 是对应的 UTC 小时。
 *  - 对东八区（lng>0）：sunrise ut≈22（UTC 前一天），sunset ut≈10（UTC 当天）
 *  - 对中时区（lng≈0）：ut≈6/18（UTC 当天）
 * 判定规则：ut > 12 → UTC 日期减 1；否则用当天 UTC 日期
 */
function sunTimes(date, lat, lng) {
  const N = dayOfYearUTC(date)
  const lngHour = lng / 15
  const calc = hour => {
    const t = N + (hour - lngHour) / 24
    const M = 0.9856 * t - 3.289
    const L = M + 1.916 * Math.sin(toRad(M)) + 0.02 * Math.sin(toRad(2 * M)) + 282.634
    // 右赤经：atan 主值范围 [-90,90]，需把 RA 校正到与太阳黄经 λ 同象限（否则日出/日落会颠倒 ~12h）
    let RA = toDeg(Math.atan(0.91764 * Math.tan(toRad(L))))
    RA = ((RA % 360) + 360) % 360
    const lam = ((L % 360) + 360) % 360
    while (Math.floor(RA / 90) % 4 !== Math.floor(lam / 90) % 4) RA += 180
    RA = (RA % 360) / 15
    const sinDec = 0.39782 * Math.sin(toRad(L))
    const cosDec = Math.cos(Math.asin(sinDec))
    const cosH = (Math.cos(toRad(ZENITH)) - sinDec * Math.sin(toRad(lat))) / (cosDec * Math.cos(toRad(lat)))
    if (cosH > 1 || cosH < -1) return null // 极夜不日出 / 极昼不日落
    const H = hour < 12 ? (360 - toDeg(Math.acos(cosH))) / 15 : toDeg(Math.acos(cosH)) / 15
    const ut = (H + RA - 0.0653 * t - 6.622 - lngHour + 24) % 24
    // ut 是 UTC 小时（0-24），用 date 的 UTC 组件构造日期
    // ut > 12 → 事件落在 UTC 前一天（东八区 sunrise 恰是这种情况）
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth()
    const d = date.getUTCDate() + (ut > 12 ? -1 : 0)
    return new Date(Date.UTC(y, m, d, Math.floor(ut), Math.round((ut % 1) * 60)))
  }
  return { sunrise: calc(6), sunset: calc(18) }
}

function todaySchedule() {
  const now = new Date()
  const key = now.toDateString()
  if (schedule && schedule.date === key) return schedule
  const c = coords.value || SHANGHAI
  const s = sunTimes(now, c.lat, c.lng)
  schedule = { date: key, sunrise: s && s.sunrise, sunset: s && s.sunset }
  return schedule
}

// 服务端返回的当天日出/日落（页面加载时从 /api/theme 获取，优先采用）
let serverSchedule = null

/** 当前生效的日出/日落时刻表：优先服务端，离线回退本地 NOAA 计算 */
function currentSchedule() {
  if (serverSchedule && serverSchedule.sunrise && serverSchedule.sunset) return serverSchedule
  return todaySchedule()
}

function isManualOverrideToday() {
  return storage.get(OVERRIDE_KEY) === new Date().toDateString()
}

/** 定时校验：按当前时刻相对日出/日落校正主题；手动覆盖日与极昼极夜时跳过 */
function tick() {
  if (!auto.value || isManualOverrideToday()) return
  const s = currentSchedule()
  if (!s.sunrise || !s.sunset) return
  const now = new Date()
  const target = now < s.sunrise ? 'dark' : now < s.sunset ? 'bright' : 'dark'
  if (target !== theme.value) applyTheme(target)
}

/** 初始化（main.js 挂载前调用，同步应用避免首帧闪烁），并启动自动模式定时器 */
export function initTheme() {
  applyTheme(theme.value)
  if (auto.value) {
    tick()
    if (!timer) timer = setInterval(tick, 30000)
  }
  refreshFromServer() // 页面加载时从服务端获取主题（公开接口，登录页同样生效）
}

/** 手动切换：立即生效；自动模式下记为「今日手动覆盖」，次日恢复自动 */
export function toggleTheme() {
  applyTheme(theme.value === 'bright' ? 'dark' : 'bright')
  if (auto.value) storage.set(OVERRIDE_KEY, new Date().toDateString())
}

/** 自动模式开关（设置面板）：开启后立即校正并恢复定时器 */
export function setAuto(v) {
  auto.value = !!v
  storage.set(AUTO_KEY, auto.value ? '1' : '0')
  if (auto.value) {
    storage.remove(OVERRIDE_KEY)
    tick()
    if (!timer) timer = setInterval(tick, 30000)
  }
}

/** 页面加载时拉取服务端主题：GET /api/theme（公开，无需登录）
 * 成功 → 采用服务端判定的主题 + 日出/日落时刻表，并缓存坐标供离线兜底；
 * 失败（离线等）→ 保持本地算法（NOAA + 缓存的坐标/上海默认） */
export async function refreshFromServer() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch('/api/theme', { signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return
    const d = await r.json()
    if (!d || !d.theme) return // 极昼/极夜：服务端不判定，保持当前
    if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
      coords.value = { lat: d.lat, lng: d.lng, src: d.src || 'ip' }
      saveCoords(coords.value) // 缓存坐标，离线时本地算法仍可用
    }
    serverSchedule = {
      sunrise: d.sunrise ? new Date(d.sunrise) : null,
      sunset: d.sunset ? new Date(d.sunset) : null,
    }
    if (auto.value && !isManualOverrideToday()) applyTheme(d.theme)
  } catch { /* 离线：沿用本地算法 */ }
}

/** 今日日出/日落与坐标来源（设置面板展示用） */
export const todayInfo = computed(() => {
  const s = currentSchedule()
  const c = coords.value || SHANGHAI
  const fmt = d => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—')
  return {
    sunrise: fmt(s.sunrise),
    sunset: fmt(s.sunset),
    src: c.src || 'fallback',
    lat: c.lat,
    lng: c.lng,
  }
})

export function useTheme() {
  return { theme, auto, toggle: toggleTheme, setAuto, todayInfo, refreshFromServer }
}
