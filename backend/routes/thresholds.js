/**
 * 阈值配置 API —— server.js 抽离
 * - GET/POST /api/threshold：版本阈值（兼容旧字段）
 * - GET/POST /api/thresholds：版本 + 大小阈值 + 单包例外
 * 入参经 validate.js 契约层：取值域与旧 clampInt 一致，但越界从「静默钳制」改为显式 400，
 * 免得前端填错时把 0/负数/小数悄悄写成 1 却毫无提示。
 */
import express from 'express'
import { z } from 'zod'
import { getSetting, setSetting } from '../db.js'
import { DEFAULT_VERSION_THRESHOLD, DEFAULT_SIZE_THRESHOLD } from '../util.js'
import { apiValidate, zVersionThreshold, zSizeThreshold } from '../validate.js'

export const thresholdsRouter = express.Router()

// 单包例外条目：包名可为空串（沿用旧规则，空名条目由路由丢弃），阈值仍须在取值域内
const zException = z.object({
  pkgName: z.string().trim(),
  versionThreshold: zVersionThreshold,
  sizeThreshold: zSizeThreshold,
})

// spec §4.2：GET/POST /api/threshold（版本阈值）
thresholdsRouter.get('/threshold', (req, res) => {
  res.json({ versionThreshold: Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD)) })
})

thresholdsRouter.post(
  '/threshold',
  apiValidate({
    body: z
      .object({ versionThreshold: zVersionThreshold.optional(), value: zVersionThreshold.optional() })
      .transform(o => ({ versionThreshold: o.versionThreshold ?? o.value }))
      .refine(o => o.versionThreshold !== undefined, { message: '缺少 versionThreshold' }), // 兼容 versionThreshold / value 两种字段名
  }),
  (req, res) => {
    const { versionThreshold: v } = req.body
    setSetting('version_threshold', v)
    res.json({ ok: true, versionThreshold: v })
  },
)

// 扩展：GET/POST /api/thresholds（版本 + 大小 + 单包例外）
thresholdsRouter.get('/thresholds', (req, res) => {
  let exceptions = []
  try { exceptions = JSON.parse(getSetting('exceptions', '[]')) } catch { exceptions = [] }
  res.json({
    versionThreshold: Number(getSetting('version_threshold', DEFAULT_VERSION_THRESHOLD)),
    sizeThreshold: Number(getSetting('size_threshold', DEFAULT_SIZE_THRESHOLD)),
    exceptions,
  })
})

thresholdsRouter.post(
  '/thresholds',
  apiValidate({
    body: z.object({
      versionThreshold: zVersionThreshold,
      sizeThreshold: zSizeThreshold,
      exceptions: z.array(zException).optional(),
    }),
  }),
  (req, res) => {
    const { versionThreshold, sizeThreshold, exceptions } = req.body
    setSetting('version_threshold', versionThreshold)
    setSetting('size_threshold', sizeThreshold)
    setSetting('exceptions', JSON.stringify((exceptions || []).filter(e => e.pkgName)))
    res.json({ ok: true })
  },
)
