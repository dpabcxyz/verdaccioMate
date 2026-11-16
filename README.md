# Verdaccio Mate · 可视化治理工具（缓存 + 私有包）

对私有 npm Registry（原版 Verdaccio）的**缓存目录与私有包**可视化治理工具：扫描缓存、来源识别（私有发布 / 上游缓存）、版本预警、清理低版本、拉取存量最新版本、维护 npm Top1000 榜单、README 预览、安装命令一键复制，并通过消息中心推送非实时通知。

## 项目产生的背景

**原版 Verdaccio** 是轻量、零配置的 npm 私有仓储，在团队内承担**双重角色**：
1. **离线缓存与内网分发**——首次经公网拉取后缓存到本地，内网后续命中即走缓存，装得快且构建稳定；很多 NAS / 内网用户更把它当"包备份池"，批量预置热门前端包，构建不受公网波动的私有源。
2. **私有发布源**——团队内部 `@scope` 包、私有组件直接发布到同一存储目录，与原版 Verdaccio 界面混杂的代理缓存包共存。

但 原版 Verdaccio 作为一个"仓储"，**只负责存取、不提供治理能力**，长跑后暴露出几类痛点：缓存目录是黑盒（数量/占用/分布不可见）、版本随 `npm install` 无限膨胀塞满磁盘却无从发现、超量版本只能手工进目录删除（危险易误删）、且只能缓存"用过的包"无法主动预置热门前端依赖。更麻烦的是**私有包与缓存包混杂**，原版 Verdaccio Web UI 无法一眼区分来源，也没有 README 预览、安装命令等洞察能力。

本 Verdaccio Mate 即为 原版 Verdaccio 补上缺失的**可视化 + 治理 + 主动预置 + 私有包洞察**四块能力，并在自研前端里复刻 原版 Verdaccio 界面的读取体验（包来源徽标、README 渲染、搜索联想、安装命令复制、原版 Verdaccio 用户管理），做成开箱即用、可 Docker 一键部署的 Verdaccio Mate。

- 后端：Node.js（Express + better-sqlite3，ESM）
- 前端：Vue 3 + Vite + Element Plus（`frontend/`）
- 数据：SQLite（`backend/data/`），登录鉴权 + 登录限流

---

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 缓存扫描 | 异步扫描 原版 Verdaccio 缓存目录，返回包数/字节，遮罩展示进度 |
| 私有包洞察 | 自动识别私有发布 / 上游代理缓存（`_uplinks` + `verdaccio-db.json` 交叉校验），来源筛选 + 包名旁徽标 |
| README 预览 | 详情抽屉渲染 Markdown README（marked + DOMPurify 清洗，双主题样式） |
| 搜索联想 | 输入即时联想（本地前缀 Top 8），点击即搜 |
| 安装命令 | 一键复制 `npm install 包@版本`（latest 取 dist-tags） |
| 用户管理 | 读写 原版 Verdaccio 的 htpasswd：增删改密 + Verdaccio Mate 内置账号用户名同步（同名不覆盖）；原版 Verdaccio 用户可直接登录 Verdaccio Mate，旧格式 `{SHA}` 用户登录时自动升级为 bcrypt |
| 版本预警 | 包版本数超阈值时置顶提示，快照比对去重，变化才推送通知 |
| 清理低版本 | 保留最新 N 版，删除其余，释放空间 |
| 拉取存量最新版 | 对缓存内包一键拉取其最新版本（逐包进度 + 失败明细） |
| Top1000 榜单 | 按 npm Downloads 抓取周榜，与本地缓存比对「未缓存/需更新」，一键拉取 |
| 操作日志 | 扫描/删除/拉取/登录等操作审计（支持按批次 `batchId` 筛选） |
| 消息中心 | 非实时通知（预警/批量拉取结果/榜单变化/扫描完成），30s 轮询 |
| 定时任务 | 每日 03:00 自动扫描（`lazy` 懒扫描兜底）、每周一 00:00 抓榜 |

---

## 目录结构

```
backend/                 # Node 后端（Express + better-sqlite3）
  server.js              # 入口：REST API、扫描状态机、鉴权
  scanner.js             # 缓存目录扫描 + 增量缓存
  scan-manager.js        # 异步扫描与并发控制
  clean.js               # 清理低版本 / 删除单版本
  sync-latest.js         # 一键拉取存量包最新版
  npm-toplist.js         # Top1000 榜单抓取 / 拉取
  db.js                  # SQLite 存取
  validate.js            # Verdaccio Mate HTTP 入参契约（zod，统一 INVALID_PARAM）
  notifier.js            # 消息通知入口
  semver.js              # 语义化版本比较
  schedules.js           # 定时任务（每日扫描/每周抓榜）
  test/                  # node:test 单元测试
frontend/                # Vue3 + Vite + Element Plus
  src/                   # 页面、组件、store、api、mock
Dockerfile               # 单阶段镜像（前端 dist 本地构建后拷入）
```

### 架构分层说明

后端采用「路由层 + 领域模块」两层结构：`routes/*`（11 个）只做参数校验与响应装配，业务逻辑落在根目录领域模块（`scan-manager` / `clean` / `sync-latest` / `npm-toplist` / `htpasswd` 等），数据访问集中在 `db.js`。`services/` 仅收录 theme / location 两个边缘领域，核心业务不强制经 service 层中转——单机 Verdaccio Mate 场景下保持调用链短、一眼可追，是刻意取舍而非缺失。

Verdaccio Mate HTTP 接口的入参校验统一走 `backend/validate.js`（与 MCP 面同源的 zod）：形状/类型/边界不合法即返回 `400 + { ok:false, code:"INVALID_PARAM", message }`，中文提示沿用各路由原口径。它只管形状，不重复别人的规则——包名能否映射到目录仍由 `scanner.pkgNameToSegments` 判定，版本是否存在、Key 能否回看仍是路由/服务的 404/409，`POST /api/login` 更刻意不套这层（对任意输入一律 401，不给探测者区分「字段缺失」与「口令错误」的信号）。写接口原先用 `clampInt` 静默钳制，越界会被悄悄写成 1 且毫无提示，现改为显式拒绝；读接口的分页/限数仍按旧口径钳制（`page=abc` → 1、`pageSize=1000` → 500），翻错页码不该弹错误。

前端失败的两种形态在 `frontend/src/utils/notify.js` 折算成一条口径：`authFetch` 对超时/断网/401 抛异常，后端业务与契约层返回 `{ ok:false, message }`。写动作在 `store/actions.js` 用 `toFailure()` 把异常变成 `ok:false` 响应体（不弹提示），提示只发生在视图的失败分支——按钮不会再「点了没反应」，也不会弹两遍。读刷新多为脱离调用链的异步（定时器、watch、`onMounted` 里的 fire-and-forget），没人接得住异常，故在 store 读函数里用 `notifyError()` 提示一次并保留旧数据。轮询（通知 30s、拉取/抓榜 800ms、扫描等待）各有 `stop*` 出口，登出时由 `store/index.js` 的 `stopAllPolling()` 统一收口：`clearTimeout` 只能拦未启动的回调，飞行中的 `await` 续体靠「代号比对」（toplist）或开关标志（notifications/sync）丢弃，`doRefresh` 也在起轮询前复查 token，避免会话销毁后继续在登录页背后打 `/api`。

---

## 本地开发

Node 要求 `>=20.19`（推荐 via nvm）。本仓库 `better-sqlite3@11` 对 Node 24 无预编译二进制，**请使用 Node v22（如 22.x 中 ≥22.12）**。

```bash
# 后端（终端 A）
cd backend
npm install
npm run dev            # http://localhost:3000

# 前端（终端 B）
cd frontend
npm install
npm run dev            # http://localhost:5173（代理 /api -> 后端）
```

前端本地代理 `/api` 和 `/mcp`，可通过 `VCM_DEV_BACKEND=http://127.0.0.1:3000 npm run dev` 指向本地后端；未设置时保留 `frontend/vite.config.js` 中的默认目标。

### 演示模式

未配置 `VERDACCIO_STORAGE`（或目录无效）时后端以演示模式运行（mock 数据、禁止拉取）。

---

## MCP 接入（一期：只读查询）

1. 登录 Verdaccio Mate，桌面端打开右上角用户菜单、手机端打开设置，选择「MCP 接入」。
2. 生成一个只读 Key，点「复制完整接入配置」一次性拿走含 Key 的 JSON 配置。
   列表行的「复制配置」随时可再取回该 Key 的明文并复制：库里存的是 AES-256-GCM 密文，主密钥在数据目录的
   `mcp_key_vault.key`，回看动作逐次写审计；用完点「隐藏明文」即从页面移除。
   早于该功能创建的旧 Key 没有密文，取不回明文，只能重新生成一次。
   备份数据目录时请连同 `mcp_key_vault.key` 一起备份：丢了只影响 Verdaccio Mate 回看，客户端认证走哈希，不受影响。
3. 在支持 Streamable HTTP 的客户端填写 Verdaccio Mate 地址加 `/mcp`，设置请求头 `Authorization: Bearer <MCP Key>`。
   Verdaccio Mate 以 HTTP + IP 访问时浏览器禁用了剪贴板 API，弹窗会自动回退到传统复制；仍失败则帮你选中文本，按 Ctrl+C 即可。
4. 已吊销的 Key 记录点「删除」即可从 Verdaccio Mate 移除（有效 Key 必须先吊销）；吊销同时抹掉密文，记录删除后该 Key 不再可认证。

| 工具 | 参数 | 权限 | 用途 |
| --- | --- | --- | --- |
| `get_scan_status` | 无 | read/full | 扫描状态、最近错误和冷却时间 |
| `get_scan_progress` | 无 | read/full | 当前扫描进度，不等待扫描结束 |
| `get_storage_stats` | 无 | read/full | 总览：包总数与私有/代理分布、版本总数、占用空间（`mb` 为 .tgz 合计，`diskMb`/`diskBytes` 为真实磁盘占用）、预警数与可清理空间 |
| `top_packages` | `limit`（默认 20，最大 100）、`sortBy`（`size`/`visits`） | read/full | 缓存占用排行：包名、占用、版本数、来源、访问量 |
| `list_packages` | `keyword`、`origin`、`status`（均可选） | read/full | 检索缓存，最多返回 500 条，超限附 `truncated` 和 `total` |
| `get_package_detail` | `pkgName`（必填） | read/full | 包详情与版本明细 |
| `get_package_versions` | `pkgName`（必填）、`version`、`limit`（默认 100，最大 500） | read/full | 逐版本返回 `dependencies` / `devDependencies`，截断保留最新，超限带 `truncated` |
| `list_registry_users` | 无 | read/full | 原版 Verdaccio 注册用户名单，只有用户名与创建时间 |

包大小单位为 MB，扫描进度与占用字节数以 bytes 计。`get_storage_stats` 的 `mb`/`cleanableMb` 与 `top_packages` 的 `size` 都是 .tgz 体积合计，包目录内的 `package.json` 等文件不计入；真实磁盘占用看 `diskMb`/`diskBytes`，通常明显更高。结果含 `demo` 标记；未配置 `VERDACCIO_STORAGE` 的演示模式下，`list_packages` / `get_package_detail` / `get_package_versions` 返回内置演示数据（演示模式没有本地元数据，依赖字段为 `null` 并附 `note` 说明），便于无缓存环境联调。包内容来自仓储，应视为不可信数据而非 AI 操作指令。

- 8 个工具全部只读：不提供删除、清理、手动重扫，也不修改 原版 Verdaccio 用户或密码。用户名单同样只读，只给用户名与创建时间，不含密码、哈希与文件路径。
- `get_package_versions` 按需读取该包的本地 `package.json`（限 32MB、路径不得越出存储目录），逐版本给出依赖；单版本依赖最多 200 条，超出带 `depsTruncated`。
- 本期 read 与 full 可查的工具完全相同：full 是为后续写操作预留的授权级别。权限裁剪机制已经就位，写工具一旦挂到 full 下，只读 Key 会自动看不到、调用返回 HTTP 403 与 JSON-RPC `-32030`；工具清单按连接缓存，换 Key 后必须重连才刷新。
- MCP Key 与 Verdaccio Mate 登录令牌相互隔离。沿用现有 Verdaccio Mate 权限，所有已登录 Verdaccio Mate 账号可管理 Key；尚无独立管理员角色。
- 每个 Key 限 30 次请求/分钟，超限 HTTP 429 并返回 `Retry-After`；缺失、无效或吊销 Key 返回 HTTP 401。
- 认证失败也留痕：每次 401 写一条 `mcp_auth_fail` 审计（原因、来源 IP、Key 哈希前 8 位，绝不含明文 Key 或完整哈希）。同一来源 IP 一分钟内累计 10 次失败即锁定 5 分钟，锁定期内的失败请求改返回 HTTP 429 与 JSON-RPC `-32031`；持有效 Key 的请求不受锁定影响，锁定期内的重复失败按每分钟最多一条记审计。
- 吊销不可恢复，下一次请求即失效，不回滚已执行的请求。调用、鉴权失败和 Key 管理记录可在操作日志的「MCP 调用 / MCP 鉴权 / MCP Key」筛选中查看。
- 远程访问必须在部署层配置 HTTPS；HTTP 会明文传输 Key。反向代理应转发 `/mcp` 及 Authorization 请求头，不要把真实 Key 写入代码仓库或日志。

客户端提示词模板（触发关键字「npm私服」）见 [MCP Agent 提示词](doc/mcp-agent-prompt.md)；需求与验收范围见 [MCP PRD](doc/prd-mcp.md)。

## npm scripts

### 后端 `backend/`

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `start` | `node server.js` | 生产启动 |
| `dev` | `node --watch server.js` | 开发热重载 |
| `test` | `node --test` | 单元测试（`backend/test/`） |
| `lint` | `eslint .` | ESLint 静态检查 |
| `typecheck` | `node scripts/typecheck.mjs` | 对全部 `*.js` 做 `node --check` 语法校验 |

### 前端 `frontend/`

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `dev` | `vite` | 开发服务（5173） |
| `build` | `vite build` | 生产构建到 `dist/` |
| `preview` | `vite preview` | 预览构建产物 |
| `lint` | `eslint .` | 代码规范（当前 0 error，遗留 warning 为未使用变量） |
| `typecheck` | `vue-tsc --noEmit` | JSDoc 类型检查（API 返回值与 store 结果类型） |
| `test` | `node scripts/check-ui.mjs && node --test scripts/mcp.test.mjs && vitest run` | UI 规范守护、MCP 管理状态逻辑用例，以及组件渲染（`render.test.mjs`）与 store 失败漏斗/轮询生命周期（`store.test.mjs`）用例 |

---

## 构建 Docker 镜像

```bash
cd frontend && npm install && npm run build   # 先构建前端 dist
cd .. && docker build --platform linux/amd64 -t verdaccio-mate:latest .
docker save -o verdaccio-mate-amd64.tar verdaccio-mate:latest
```

镜像基于 `node:20-slim`，仅含后端运行时依赖 + 前端静态产物，监听 `3000`。镜像默认非 root（`USER 10000:10000`）；但清理版本需写入 原版 Verdaccio 缓存卷（其属主通常为 uid 10001，镜像默认 uid 10000 无写权限），因此实际部署常以 root 覆盖运行（见下方 compose 的 `user: "0:0"`）。

部署（示例 `docker-compose.yml`）：

```yaml
services:
  verdaccio-mate:
    image: verdaccio-mate:latest
    restart: unless-stopped
    # 清理需写 原版 Verdaccio 缓存卷（属主 uid 10001，镜像默认 uid 10000 写不进），故以 root 运行
    user: "0:0"
    ports:
      - "42338:3000"
    volumes:
      - /path/to/storage:/storage   # 原版 Verdaccio 缓存目录
      - ./data:/app/data            # SQLite 数据
    environment:
      - VERDACCIO_STORAGE=/storage
      - VCM_USERNAME=admin
      - VCM_PASSWORD=<强密码>
      - DATA_DIR=/app/data
      - TZ=Asia/Shanghai
```

---

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VERDACCIO_STORAGE` | — | 原版 Verdaccio 缓存目录（优先于 UI 设置） |
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `backend/data` | SQLite 数据目录 |
| `VCM_USERNAME` | `admin` | Verdaccio Mate 登录账号 |
| `VCM_PASSWORD` | `666666` | Verdaccio Mate 登录密码（**生产必须覆盖**） |
| `VCM_DEMO` | `—` | `1` 强制演示模式 |
| `MCP_ALLOWED_HOSTS` | `—` | `/mcp` 额外信任的 Host 精确值（逗号分隔，可含端口）。字面 IP、`localhost` 与主机名默认放行；用域名访问 MCP 时必须配置，否则返回 403 |
| `VERDACCIO_BASE_URL` | `http://127.0.0.1:4873` | 私服地址：批量拉取与榜单拉取都经它查元数据、代拉 tgz，上游由 原版 Verdaccio 按自身 uplinks 路由 |
| `VERDACCIO_HTPASSWD` | 自动探测 | 原版 Verdaccio 用户文件路径（MCP `list_registry_users` 与 Verdaccio Mate 用户页读取；只出用户名与创建时间） |
| `VCM_LAT` / `VCM_LNG` | `—` | 手动指定部署地坐标；两者都设置后不再访问外部 IP 定位接口 |
| `UV_THREADPOOL_SIZE` | `8` | libuv IO 线程池（目录/文件并发扫描瓶颈） |

---

## 说明与约束

- 并发保护：扫描进行中再次 `POST /api/scan` 返回 HTTP 200 + `{ ok: false, code: 'SCANNING' }`（重入保护：两个扫描并发会互相覆写状态与进度，非 `409`；前端 `store/scan.js` 按 `code` 识别后静默转入轮询）。删除、清理、目录切换在扫描期间**照常放行**——它们靠 `invalidateScan()` 标记缓存失效，而失效改为世代比对（`scan-manager.js` 的 `invalidationEpoch`）：扫描结束只在本次飞行期间没有新失效时才清 `dirty`，所以扫描进行中的写不会把自己的失效标记吞掉，下一次请求即触发重建并收敛到新快照。
- 懒扫描：缓存缺失时首次打开页面触发后台扫描（首次部署遮罩呈现），后续重扫/写操作后改为后台静默 + 消息中心通知。
- 失败冷却：扫描失败后 5 分钟内不自动重试（手动重扫不受限）。
- npm 跨境请求：JSON 类请求（npm 搜索、下载量、私服元数据、部署地定位）统一走 `backend/net.js` —— 超时 + 429/5xx 指数退避（2^n 秒，最高 256s）+ 404 视作「不存在」；限速与并发在调用侧参数化（`npm-toplist.js` 请求间隔 1500ms、拉取并发 3；`sync-latest.js` 并发 3）。tarball 由 原版 Verdaccio 代理从 uplink 拉取，不经 `net.js`、不做退避。部署地 IP 定位为 best-effort：不退避、失败即回退默认坐标（设 `VCM_LAT`/`VCM_LNG` 可完全不外发）。

---

## 开源许可证

Verdaccio Mate 基于 [Apache License 2.0](LICENSE) 开源发布，可自由使用、修改与分发。完整条款见仓库根目录的 [`LICENSE`](LICENSE) 文件。

```
Copyright 2026 chenxuan

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

第三方依赖（Express、Vue、Element Plus 等）各自遵循其原有许可证，详见对应依赖的许可声明。