/**
 * HTTP 入参契约层 —— 与 MCP 面同源（zod），把散落各路由的 `if (!x) return 400` 收敛成一条规则：
 *   形状/边界不合法 → 400 + `{ ok:false, code:'INVALID_PARAM', message }`
 * message 沿用各路由既有中文提示，前端与脚本的读数不变；新增的 `code` 供调用方分支。
 *
 * 刻意不管的事（守住单一事实源的边界）：
 * - 包名合法性仍由 scanner.pkgNameToSegments 白名单判定（目录映射规则只有一处）；
 *   本层只保证「是非空字符串」，把形状错误和越界错误分开。
 * - 版本是否存在、Key 是否可恢复等业务态仍由路由/服务判定（404/409 语义不变）。
 * - POST /api/login 不套本层：登录对任意输入一律 401，不给探测者区分「字段缺失」与「口令错误」的信号。
 *
 * 校验结果经 Object.defineProperty 写回 req.body/params/query（Express4 的 req.query 只有 getter，
 * 严格模式下直接赋值会抛 TypeError），路由体保持原样读取，无需改用第三个容器。
 */
import { z } from 'zod'

const MISSING = new Map([
  ['body', '请求体'],
  ['params', '路径参数'],
  ['query', '查询参数'],
])

function attach(req, source, value) {
  Object.defineProperty(req, source, { value, configurable: true, writable: true, enumerable: true })
}

/**
 * @param {{ body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType }} schemas
 * @returns Express 中间件；校验失败即中止并返回统一 400
 */
export function apiValidate(schemas) {
  const entries = Object.entries(schemas).filter(([, s]) => s)
  return (req, res, next) => {
    for (const [source, schema] of entries) {
      const parsed = schema.safeParse(req[source] ?? {})
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        // 字段级提示直接采用 schema 里的中文消息；无消息（如多余键）时补一句来源说明
        const message = issue.message || `${MISSING.get(source) || '参数'}格式不合法`
        return res.status(400).json({ ok: false, code: 'INVALID_PARAM', message })
      }
      attach(req, source, parsed.data)
    }
    next()
  }
}

// —— 跨路由复用的原子片段（区间与既有 clampInt 的取值域一致，只是从静默钳制改为显式拒绝）——
export const zPkgName = z.string({ error: '缺少 pkgName' }).trim().min(1, '缺少 pkgName')
export const zVersion = z.string({ error: '缺少 version' }).trim().min(1, '缺少 version')
export const zId = z.coerce.number({ error: '参数不合法' }).int('参数不合法').positive('参数不合法')
export const zKeep = z.coerce.number({ error: '保留版本数不合法' }).int('保留版本数须为整数').min(1, '保留版本数至少为 1').max(999, '保留版本数最高 999')
export const zVersionThreshold = z.coerce.number({ error: '版本阈值不合法' }).int('版本阈值须为整数').min(1, '版本阈值至少为 1').max(100, '版本阈值最高 100')
export const zSizeThreshold = z.coerce.number({ error: '大小阈值不合法' }).int('大小阈值须为整数').min(1, '大小阈值至少为 1').max(10000, '大小阈值最高 10000')
export const zCount = z.coerce.number().int().catch(0).transform(n => Math.max(0, n)) // 仅用于审计元信息：缺省/非法按 0，负数归 0，不拒绝请求
// 读路径的分页/限数是「钳制」而非「拒绝」：翻错页码不该弹错误，沿用旧 Math.min/max 口径
const clampLoose = (def, min, max) => z.coerce.number().int().catch(def).transform(n => Math.min(max, Math.max(min, n)))
export const zPage = clampLoose(1, 1, Number.MAX_SAFE_INTEGER)
export const zPageSize = clampLoose(50, 1, 500)
export const zLimit = clampLoose(20, 1, 100)
