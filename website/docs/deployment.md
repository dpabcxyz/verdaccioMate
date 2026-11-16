# 部署与配置

Verdaccio Mate 与原版 Verdaccio 分开部署，只共享同一份存储目录。镜像内含后端运行时与前端静态产物，默认监听 `3000`；唯一需要仔细确认的是挂载与写权限——这决定了清理功能能不能用。

## 前置条件

- **原版 Verdaccio 已在跑**：Verdaccio Mate 不改原版 Verdaccio 的配置，也不需要它重启；只要知道它的存储目录（`storage`）与用户文件（`htpasswd`）在哪。
- **可访问私服地址**：批量拉取最新版与榜单预置都经 `VERDACCIO_BASE_URL` 查元数据、代拉归档。容器内不能用 `127.0.0.1`，要填宿主机或私服的实际可达地址。
- **Docker 与出网策略**：单容器即可运行，无数据库服务依赖。抓取 npm 周榜需要容器能出公网；纯内网部署可只用已缓存数据，榜单留空。

## 构建镜像

镜像是单阶段的：前端先在本机 build 出 `dist`，再连同后端一起拷进镜像，容器内不装构建工具链。

```bash
cd frontend && npm install && npm run build   # 产物在 frontend/dist
cd .. && docker build --platform linux/amd64 -t verdaccio-mate:latest .
docker save -o verdaccio-mate-amd64.tar verdaccio-mate:latest   # NAS 上 docker load 这个 tar
```

- **基础镜像**：`node:20-slim`，只装 `express` 与 `better-sqlite3` 两个运行时依赖。
- **原生模块**：`better-sqlite3` 的预编译二进制经国内镜像下载，避免容器内回退源码编译失败。
- **NAS 架构**：群晖 / 威联通多为 amd64；ARM 设备需按目标架构重新 `--platform` 构建。

## docker-compose 示例

宿主机路径按你的实际目录替换；账号密码建议放在同目录 `.env` 里覆盖，不要写死在文件里。

```yaml
services:
  verdaccio-mate:
    image: verdaccio-mate:latest
    restart: unless-stopped
    user: "0:0"                              # 清理需写原版 Verdaccio 缓存卷，见下一节
    environment:
      - VERDACCIO_STORAGE=/verdaccio/storage # 容器内路径，对应下方挂载右侧
      - VERDACCIO_BASE_URL=http://192.168.1.10:4873
      - VERDACCIO_HTPASSWD=/verdaccio/htpasswd
      - PORT=3000
      - TZ=Asia/Shanghai                     # 定时任务与「按日出日落换主题」都按此时区
      - VCM_USERNAME=${VCM_USERNAME:-admin}
      - VCM_PASSWORD=${VCM_PASSWORD}         # 生产必须覆盖默认弱密码
      - DATA_DIR=/app/data
      - UV_THREADPOOL_SIZE=8                 # 目录/stat 并发，四核 NAS 安全
      # - MCP_ALLOWED_HOSTS=mcp.example.com  # 改用域名访问 /mcp 时必须填，否则 403
      # - VCM_LAT=31.23
      # - VCM_LNG=121.47                     # 手动固定坐标后不再访问外部 IP 定位
    volumes:
      - /volume1/docker/verdaccio/verdaccio_storage:/verdaccio/storage   # 缓存目录（读写）
      - /volume1/docker/verdaccio/verdaccio_conf/htpasswd:/verdaccio/htpasswd
      - /volume1/docker/verdaccio-mate/data:/app/data                   # SQLite + Key 主密钥
    ports:
      - "42338:3000"
```

## 挂载与写权限：为什么是 root

- **扫描只需读**：读取存储目录、解析包元数据与归档文件，只读挂载就够。
- **清理需要写**：删除低版本要移除 `.tgz` 并回写包目录内的 `package.json`；只读挂载会直接报 `EROFS`。
- **uid 对不上**：原版 Verdaccio 卷属主通常是 `10001`，镜像默认用户是 `10000`，写不进去，因此实际部署常用 `user: "0:0"` 覆盖。
- **数据卷可写**：`/app/data` 需可写，SQLite 要建 `-wal` 与 `-shm` 文件。
- **htpasswd 可写**：只有在 Verdaccio Mate 里增删用户、改密才需要；不挂载时该页返回未找到，其余功能不受影响。

| 挂载 | 用途 | 权限 |
| --- | --- | --- |
| `VERDACCIO_STORAGE` | 缓存与私有包目录，扫描对象 | 扫描只读 / 清理读写 |
| `DATA_DIR` | `manager.db`、WAL、`mcp_key_vault.key` | 读写 |
| `VERDACCIO_HTPASSWD` | 原版用户文件，用户页读写 | 不挂则只影响用户管理 |
| Verdaccio Mate 端口 `3000` | Web 界面与 `/api`、`/mcp` | 按需映射 |

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VERDACCIO_STORAGE` | — | 原版 Verdaccio 缓存目录，优先于界面里的设置；未配置或目录无效时进入演示模式 |
| `PORT` | `3000` | Verdaccio Mate 监听端口 |
| `DATA_DIR` | `backend/data` | SQLite 数据目录 |
| `VCM_USERNAME` | `admin` | Verdaccio Mate 内置登录账号 |
| `VCM_PASSWORD` | `666666` | Verdaccio Mate 登录密码，生产环境必须覆盖 |
| `VCM_DEMO` | — | 置 `1` 强制演示模式（mock 数据、禁止拉取） |
| `VERDACCIO_BASE_URL` | `http://127.0.0.1:4873` | 私服地址，批量拉取与榜单拉取经它查元数据、代拉归档 |
| `VERDACCIO_HTPASSWD` | 自动探测 | 原版 Verdaccio 用户文件路径，供用户页与 MCP 用户名单读取 |
| `MCP_ALLOWED_HOSTS` | — | `/mcp` 额外信任的 Host 精确值，逗号分隔可含端口；字面 IP、`localhost` 与主机名默认放行，用域名访问时必须配置 |
| `VCM_LAT` / `VCM_LNG` | — | 手动指定部署地坐标，两者都设置后不再访问外部 IP 定位接口 |
| `UV_THREADPOOL_SIZE` | `8` | libuv IO 线程池，决定目录与文件扫描并发 |
| `TZ` | — | 容器时区，影响定时任务时间与按日出日落切换主题 |

## 首次登录与自检

1. **改密码**：用 `VCM_USERNAME` / `VCM_PASSWORD` 登录后先确认默认弱密码已被覆盖。
2. **确认目录**：设置页检查存储目录是否指向真实缓存；为空时概览会显示演示数据标记。
3. **触发扫描**：点「重新扫描」，首次部署会走完整扫描并显示进度遮罩；结束后统计卡给出包数、版本数与占用。
4. **核对口径**：把概览的占用与 `du -sh` 对一下——Verdaccio Mate 的 `mb` 只算 `.tgz` 合计，磁盘真实占用看 `diskMb`。
5. **试清理**：挑一个版本数超阈值的缓存包清理，若报 `EROFS` 或权限错误，说明挂载或运行用户没配好。

## 数据与备份

- **需要备份的**：`DATA_DIR` 整个目录：SQLite 主库与 WAL、MCP Key 主密钥 `mcp_key_vault.key`。
- **丢了会怎样**：数据库丢失只影响历史日志与阈值设置，缓存清单重扫即回；主密钥丢失只影响 Verdaccio Mate 回看 Key 明文，客户端认证走哈希，不受影响。
- **升级与回滚**：镜像无状态，换 tag 重启即可；数据目录格式向后兼容，回滚时保留数据目录再换旧镜像。

## 本地开发

Node 要求 `>=20.19`；`better-sqlite3@11` 对 Node 24 没有预编译二进制，建议使用 22.x（≥22.12）。

```bash
# 终端 A：后端，默认 3000
cd backend && npm install && npm run dev

# 终端 B：前端，5173 代理 /api 与 /mcp 到后端
cd frontend && npm install && npm run dev

# 指向自建后端地址
VCM_DEV_BACKEND=http://127.0.0.1:3000 npm run dev
```

后端 `npm test` 跑单元测试，`npm run lint` 与 `npm run typecheck` 做静态检查；前端 `npm test` 含 UI 规范守护脚本。

## 技术规格

| 项 | 说明 |
| --- | --- |
| 后端 | Node.js（Express + better-sqlite3，ESM），单进程 REST API 与扫描状态机 |
| 前端 | Vue 3 + Vite + Element Plus，自绘控件与 Element Plus 观感对齐同一套 token |
| 数据 | SQLite 单文件（`backend/data/` 或 `DATA_DIR`），登录会话 12 小时 TTL |
| 部署 | Docker 单容器，镜像基于 `node:20-slim`，默认监听 3000，非 root 用户 10000 |
| 目录要求 | 扫描只需读权限；清理低版本需要写原版 Verdaccio 缓存卷 |
| 定时任务 | 每日 03:00 自动扫描（懒扫描兜底），每周一 00:00 抓取 npm 周榜 |
| MCP | Streamable HTTP 端点 `/mcp`，Bearer Key 认证，8 个只读工具 |
| 浏览器 | 现代常青浏览器（Chrome / Edge / Firefox / Safari 近期版本），桌面 ≥1024px、平板 768~1023px、手机 <768px |
| 协议 | Apache License 2.0 |
