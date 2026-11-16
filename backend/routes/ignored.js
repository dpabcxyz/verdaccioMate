/**
 * 忽略标记 API —— server.js 抽离
 * - GET/POSt/DELETE /api/ignore(d)
 */
import express from 'express'
import { z } from 'zod'
import { getIgnored, addIgnored, removeIgnored, addLog } from '../db.js'
import { apiValidate, zPkgName, zCount } from '../validate.js'

export const ignoredRouter = express.Router()

ignoredRouter.get('/ignored', (req, res) => {
  res.json(getIgnored())
})

ignoredRouter.post('/ignore', apiValidate({ body: z.object({ pkgName: zPkgName, versionCount: zCount }) }), (req, res) => {
  const { pkgName, versionCount } = req.body
  addIgnored(pkgName)
  addLog({ action: 'ignore', pkgName, meta: { versionCount, user: req.user || null } })
  res.json({ ok: true })
})

ignoredRouter.delete('/ignore/:pkgName', apiValidate({ params: z.object({ pkgName: zPkgName }), query: z.object({ versionCount: zCount }) }), (req, res) => {
  const pkgName = decodeURIComponent(req.params.pkgName)
  const { versionCount } = req.query
  removeIgnored(pkgName)
  addLog({ action: 'unignore', pkgName, meta: { versionCount, user: req.user || null } })
  res.json({ ok: true })
})