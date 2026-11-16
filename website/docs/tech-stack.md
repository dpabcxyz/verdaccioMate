# 技术栈

Verdaccio Mate 是单仓库双端项目：`frontend/` 为 Vue 3 单页应用，`backend/` 为 Node.js 单进程服务，生产环境由一个 Docker 容器同时承载前端静态产物与后端 API。本文按依赖清单（`package.json`）介绍两端技术栈与构建链路。

## 总览

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | Vue 3 + Vite + Element Plus | 单页应用，构建产物由后端托管 |
| 后端 | Node.js + Express | ESM 单进程，REST API、静态托管与 MCP 端点同进程 |
| 数据 | SQLite（better-sqlite3） | 单文件落盘于 `DATA_DIR` |
| AI 接入 | MCP 官方 SDK | Streamable HTTP 端点 `/mcp`，8 个只读工具 |
| 运行时 | Node.js ≥20.19，Docker `node:20-slim` | 镜像内不装构建工具链 |

## 后端技术栈

运行时要求 Node.js `>=20.19.0`，全量 ESM（`"type": "module"`），入口 `server.js`，单进程同时提供 REST API、前端静态产物与 MCP 端点。

- **Express 4**：路由与中间件层，承载 `/api` 各业务接口、静态产物托管与 `/mcp` 端点。
- **better-sqlite3 11**：同步驱动的 SQLite 存储。登录会话与阈值设置、操作日志、消息与榜单结果都落在 `DATA_DIR` 下的一个数据库文件（WAL 模式）；预编译二进制经国内镜像下载，避免容器内源码编译失败。
- **@modelcontextprotocol/sdk 1.x**：MCP Streamable HTTP 端点的协议实现，8 个只读查询工具的注册、Bearer Key 认证与 JSON-RPC 响应都基于它。
- **zod 4**：MCP 工具入参的结构化校验，超限与非法参数在协议层直接拒绝。
- **bcryptjs 3**：htpasswd 行的 bcrypt 校验与写入（`$2a$10$`），配合临时文件 + rename 的原子替换写回用户文件。
- **node:crypto**：登录口令 sha256 摘要 + `timingSafeEqual` 常量时间比较；MCP Key 明文以 AES-256-GCM 密文入库，主密钥为数据目录内的 `mcp_key_vault.key`。
- **工具链**：单测用 Node 内置 `node:test`（`npm test`），静态检查用 ESLint 9（含 `@eslint/js`），另有 `npm run typecheck` 自检脚本；本地开发 `npm run dev` 走 `node --watch` 热重载。

后端刻意保持零框架膨胀：除上述依赖外无 ORM、无队列、无缓存服务，扫描状态机与定时任务都在同一进程内完成。

## 前端技术栈

运行时同样要求 Node.js `>=20.19.0`；本地开发建议 22.x（≥22.12），因 `better-sqlite3@11` 对 Node 24 无预编译二进制，会影响同机跑后端。

- **Vue 3.5 + vue-router 4**：Composition API 组织页面与组件，`vue-router` 管理概览、软件包、Top 榜、日志等页面切换。
- **Vite 8**：构建与开发服务器（`vite build` / `vite dev`），开发态经代理把 `/api` 与 `/mcp` 转发到后端，可用 `VCM_DEV_BACKEND` 指定自建后端地址。
- **Element Plus 2.14 + @element-plus/icons-vue**：组件库底座；经 `unplugin-auto-import` 与 `unplugin-vue-components` 自动按需引入。自绘控件与 Element Plus 共用同一套设计 token，亮暗双主题对齐 Element Plus 暗色变量。
- **TypeScript 6 + vue-tsc**：类型检查走 `npm run typecheck`（`vue-tsc --noEmit`）。
- **marked 18 + DOMPurify 3**：包详情抽屉的 README Markdown 渲染链路——marked 解析、DOMPurify 清洗后插入页面，仓库内容一律按不可信输入处理（本官网技术文档页也复用这一链路）。
- **Vitest 5 + @vue/test-utils + jsdom**：组件与工具函数单测，`@vitest/coverage-v8` 出覆盖率；`npm test` 还包含 `check-ui.mjs` UI 规范守护脚本，用静态检查约束样式与交互规范。

## 数据与部署链路

- **数据落盘**：SQLite 主库与 WAL、MCP Key 主密钥都在 `DATA_DIR`；htpasswd 不归 Verdaccio Mate 所有，它只读写原版 Verdaccio 的用户文件。
- **构建顺序**：前端先 `vite build` 出 `dist`，再与后端一起拷进单阶段镜像（`node:20-slim`，仅装 `express` 与 `better-sqlite3` 两个运行时依赖），容器内不装构建工具链。
- **镜像**：默认监听 `3000`，非 root 用户 `10000`；清理低版本需要写原版 Verdaccio 缓存卷，因此实际部署常用 `user: "0:0"`，原因详见[部署与配置](deployment.md)。

依赖版本以仓库内 `frontend/package.json` 与 `backend/package.json` 为准，升级依赖时同步核对本文口径。
