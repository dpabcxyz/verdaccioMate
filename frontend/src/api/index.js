/**
 * API 聚合出口 —— 对接后端 §4.2 REST API
 * 按领域拆分至 modules/，此处合并为单一默认导出，保持调用方 `import api from '../api'` 不变
 */
import auth from './modules/auth.js'
import packages from './modules/packages.js'
import scan from './modules/scan.js'
import settings from './modules/settings.js'
import logs from './modules/logs.js'
import toplist from './modules/toplist.js'
import users from './modules/users.js'
import mcp from './modules/mcp.js'

export { getToken, clearSession } from './http.js'
export { USE_MOCK } from './mock.js'

const api = {
  ...auth,
  ...packages,
  ...scan,
  ...settings,
  ...logs,
  ...toplist,
  ...users,
  ...mcp,
}

export default api
