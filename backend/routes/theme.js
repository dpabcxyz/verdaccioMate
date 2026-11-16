/**
 * 主题 API —— GET /api/theme（公开，无需登录：登录页加载时也要获取主题）
 * 返回服务端判定的主题与当天日出/日落时刻，前端据此应用主题并安排自动切换
 */
import express from 'express'
import { getThemeInfo } from '../services/theme.js'

export const themeRouter = express.Router()

themeRouter.get('/theme', async (req, res) => {
  try {
    res.json(await getThemeInfo())
  } catch {
    res.json({ theme: null, sunrise: null, sunset: null, lat: 31.23, lng: 121.47, src: 'fallback' })
  }
})
