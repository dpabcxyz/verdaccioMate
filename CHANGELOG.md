# 更新日志

本项目所有显著变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **MCP 一期只读服务**：开放 `/mcp` Streamable HTTP 端点，提供 `get_scan_status`、`list_packages`、`get_storage_stats` 等 8 个只读工具，支持 AI Agent（如 Claude、CodeArts）直接查询私服状态
- MCP API Key 管理：Verdaccio Mate 内创建/吊销/清除 Key，`read` / `full` 权限裁剪，密文 AES-256-GCM 加密存储、创建时明文可回看
- MCP 安全加固：认证失败审计（仅记哈希前 8 位）、来源 IP 限速（30 次/分钟）、登录失败滑动窗口锁定
- MCP Key 一键复制完整接入配置（HTTP+IP 场景自动回退 `execCommand`）
- Agent 提示词模板（触发关键字「npm私服」）
- 用户登录兼容：旧格式 `{SHA}`（Apache htpasswd -s 产物）用户可用原密码登录 Verdaccio Mate，登录成功后该行自动升级为 bcrypt（登录即迁移，失败降级并记 `user_upgrade` 审计；`$apr1$`/crypt 仍不支持，可经 Verdaccio Mate 重置密码迁移）

### 变更

- GitHub Actions CI 上线：后端测试 + 前端构建双 job，Node 20 + npmmirror 加速
- 新增 `check-ui.mjs` 前端 UI 规范守护测试（禁 emoji 图标、禁 `!important`、主题 token 白名单）
- 设计规范文档常规化重写，移除旧效果图
- 包管理器统一为 npm（移除历史遗留的 pnpm-lock.yaml）

## [1.0.0] - 2026-09-27

首个正式版本：Verdaccio Mate · 可视化治理工具（缓存 + 私有包）。

### 新增

- **缓存可视化**：异步扫描 原版 Verdaccio 缓存目录（状态机 + 进度遮罩 + 懒扫描兜底 + 失败 5 分钟冷却），包数量/占用/分布一目了然
- **来源识别**：私有发布与上游代理缓存包自动区分（`_uplinks` + verdaccio-db.json 交叉校验）
- **版本预警与清理**：全局阈值 + 单包例外，超量版本一键清理（保留最新 N 版），每次删除记录操作日志
- **存量同步**：一键拉取存量包最新版本（经 原版 Verdaccio 代理落盘），逐包进度 + 失败明细
- **Top1000 榜单**：两阶段抓取（Search 粗排 → Downloads 复核），与本地缓存三态比对（cached / latestCached / missing），一键预置热门依赖，每日/每周定时任务
- **原版 Verdaccio Web UI 体验复刻**：包来源徽标、README Markdown 渲染（marked + DOMPurify 清洗）、搜索联想、安装命令复制、favicon 懒加载、列表虚拟滚动
- **用户管理**：读写 htpasswd 管理 原版 Verdaccio 用户：新增 / 同步用户名 / 重置密码 / 删除
- **操作日志与消息中心**：后端分页、批次号筛选、全字段模糊检索、去重推送
- **Verdaccio Mate 内置账号认证**：Bearer 会话（12h TTL）+ 记住我 + 登录失败锁定
- **Docker 一键部署**：多阶段构建、非 root 运行、国内二进制镜像加速，适配 NAS 场景

### 变更

- 项目更名为 **Verdaccio Mate**，全站标语「原版 Verdaccio 的得力伙伴」
- 生产构建强制走真实后端 API（`VITE_USE_MOCK=false`），避免镜像内使用演示数据

### 工程化

- ESLint（后端 flat config）+ `node --check` 全量语法校验
- 后端 `node --test` 测试（MCP 集成测试达千行级：真实 HTTP + SDK + 临时数据目录）
- 前端演示模式（`VITE_USE_MOCK=true`）可脱离后端独立运行

[Unreleased]: V1.0.0 之后（feat/mcp-service 分支）
[1.0.0]: 标签 V1.0.0（2026-09-27）