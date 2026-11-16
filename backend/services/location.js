/**
 * 部署地定位 —— 按 NAS 部署地公网 IP 获取经纬度
 * - 优先级：环境变量 VCM_LAT/VCM_LNG（手动指定）> 公网 IP 定位（ipinfo.io → ip-api.com）> 上海默认坐标
 * - IP 定位结果在内存缓存 7 天，避免每次请求都访问外部接口
 * - 定位是 best-effort：外部接口挂了不影响 Verdaccio Mate，因此 maxBackoff 0 关闭退避（冷启动不能等 256s），异常一律吞成 null
 */
import { fetchJson } from '../net.js'

const SHANGHAI = { lat: 31.23, lng: 121.47 }
const CACHE_TTL = 7 * 24 * 3600 * 1000 // 7 天

let cached = null // { lat, lng, src, ts }

async function tryFetch(url) {
  try {
    return await fetchJson(url, 5000, { maxBackoff: 0, label: '定位接口' })
  } catch {
    return null
  }
}

export async function getDeployLocation() {
  // 1) 环境变量手动指定优先
  const envLat = Number(process.env.VCM_LAT)
  const envLng = Number(process.env.VCM_LNG)
  if (Number.isFinite(envLat) && Number.isFinite(envLng) && process.env.VCM_LAT !== '' && process.env.VCM_LNG !== '') {
    return { lat: envLat, lng: envLng, src: 'env' }
  }
  // 2) 缓存未过期直接复用
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached
  // 3) 公网 IP 定位
  for (const [url, parse] of [
    ['https://ipinfo.io/json', j => (j && j.loc ? j.loc.split(',').map(Number) : null)],
    ['http://ip-api.com/json', j => (j && typeof j.lat === 'number' && typeof j.lon === 'number' ? [j.lat, j.lon] : null)],
  ]) {
    const j = await tryFetch(url)
    const xy = j && parse(j)
    if (xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) {
      cached = { lat: xy[0], lng: xy[1], src: 'ip', ts: Date.now() }
      return cached
    }
  }
  // 4) 全部失败（离线/被墙）→ 上海默认
  cached = { ...SHANGHAI, src: 'fallback', ts: Date.now() }
  return cached
}
