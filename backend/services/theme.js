/**
 * 主题信息 —— 服务端定位 + 计算日出/日落 + 判定当前主题
 * 前端页面加载时调用 GET /api/theme 获取，失败时才回退前端本地算法
 * 逻辑：部署地坐标（getDeployLocation）→ NOAA 算法算当天日出/日落 →
 *      当前时刻在日出前/日落后为暗色，日出至日落为亮色；极昼极夜返回 theme=null（不自动切）
 * 按日期 + 坐标内存缓存，避免每次请求都重复计算
 */
import { getDeployLocation } from './location.js'

const ZENITH = 90.833
const toRad = d => (d * Math.PI) / 180
const toDeg = r => (r * 180) / Math.PI
// dayOfYear 用 UTC 组件（NOAA 算法以 UTC 为基准）
const dayOfYearUTC = d => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)

/**
 * NOAA 日出日落：返回当天服务器本地时间的日出/日落 Date；极昼/极夜返回 null。
 *
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
    if (cosH > 1 || cosH < -1) return null
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

let cache = null // { dateKey, lat, lng, theme, sunrise, sunset }

export async function getThemeInfo() {
  const loc = await getDeployLocation()
  const now = new Date()
  const dateKey = now.toDateString() // 服务器本地日期（TZ=Asia/Shanghai）
  if (cache && cache.dateKey === dateKey && cache.lat === loc.lat && cache.lng === loc.lng) return cache
  const s = sunTimes(now, loc.lat, loc.lng)
  let theme = null
  if (s.sunrise && s.sunset) {
    theme = now < s.sunrise || now >= s.sunset ? 'dark' : 'bright'
  }
  cache = {
    dateKey, lat: loc.lat, lng: loc.lng, src: loc.src,
    theme,
    sunrise: s.sunrise ? s.sunrise.toISOString() : null,
    sunset: s.sunset ? s.sunset.toISOString() : null,
  }
  return cache
}
