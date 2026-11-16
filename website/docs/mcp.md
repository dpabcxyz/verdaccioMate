# MCP 接入

Verdaccio Mate 暴露一个 MCP Streamable HTTP 端点 `/mcp`，用 Bearer Key 认证。一期开放 **8 个查询工具**：不给删除、不给清理、不改用户、也不触发重扫。AI 拿到的只是「缓存里有什么、占多少、哪些超阈值」。

## 接入四步

1. **打开入口**：登录 Verdaccio Mate，桌面端右上角用户菜单、手机端设置里选「MCP 接入」。
2. **生成只读 Key**：点「生成 Key」，创建时明文只显示一次；点「复制完整接入配置」一次性拿走含 Key 的 JSON。
3. **填进客户端**：任何支持 Streamable HTTP 的 MCP 客户端填「Verdaccio Mate 地址 + `/mcp`」，请求头 `Authorization: Bearer <Key>`。
4. **核对连通**：客户端列出工具即接入成功；调用与鉴权失败都会在操作日志留下记录。

通用 MCP 客户端配置形态：

```json
{
  "mcpServers": {
    "verdaccio-mate": {
      "type": "streamable-http",
      "url": "http://<Verdaccio Mate 地址>/mcp",
      "headers": { "Authorization": "Bearer <MCP Key>" }
    }
  }
}
```

> Verdaccio Mate 以 HTTP + IP 访问时浏览器禁用了剪贴板 API，弹窗会自动回退到传统复制；仍失败则帮你选中文本，按 Ctrl+C 即可。

## 8 个只读查询工具

返回值与 Verdaccio Mate 界面同源，字段口径一致；`read` 与 `full` 两档本期可查工具完全相同。

| 工具 | 参数 | 权限 | 用途 |
| --- | --- | --- | --- |
| `get_scan_status` | 无 | read/full | 扫描状态、最近错误和冷却时间 |
| `get_scan_progress` | 无 | read/full | 当前扫描进度，不等待扫描结束 |
| `get_storage_stats` | 无 | read/full | 总览：包总数与私有/代理分布、版本总数、占用空间、预警数与可清理空间 |
| `top_packages` | `limit`（默认 20，最大 100）、`sortBy`（`size`/`visits`） | read/full | 缓存占用排行：包名、占用、版本数、来源、访问量 |
| `list_packages` | `keyword`、`origin`、`status`（均可选） | read/full | 检索缓存，最多 500 条，超限附 `truncated` 与 `total` |
| `get_package_detail` | `pkgName`（必填） | read/full | 包详情与版本明细 |
| `get_package_versions` | `pkgName`（必填）、`version`、`limit`（默认 100，最大 500） | read/full | 逐版本返回依赖与开发依赖，截断保留最新，超限带 `truncated` |
| `list_registry_users` | 无 | read/full | 原版 Verdaccio 注册用户名单，只有用户名与创建时间 |

`get_package_versions` 按需读取该包在存储目录内的 `package.json`，单文件限 32MB、路径不得越出存储目录；单版本依赖最多 200 条，超出带 `depsTruncated`。

## Key 的存储、回看与吊销

- **密文存储**。Key 以 AES-256-GCM 密文入库，主密钥是数据目录里的 `mcp_key_vault.key`；认证走哈希，明文不落库。
- **明文可回看**。列表行「复制配置」随时取回该 Key 明文并复制，每次回看逐条写审计，用完点「隐藏明文」从页面移除。早于该功能创建的旧 Key 没有密文，只能重新生成。
- **吊销与删除**。吊销不可恢复，下一次请求即失效，不回滚已执行的请求；有效 Key 必须先吊销才能删除，删除记录后该 Key 不再可认证。
- **与登录令牌隔离**。MCP Key 和 Verdaccio Mate 会话令牌互不相通，泄露一个不会连带另一个。
- **谁能管 Key**。沿用 Verdaccio Mate 现有权限：所有已登录账号都能生成与吊销，暂无独立管理员角色——这点在共用 Verdaccio Mate 时要心里有数。
- **备份提醒**。备份数据目录时连同 `mcp_key_vault.key` 一起带走：丢了只影响 Verdaccio Mate 回看，客户端认证不受影响。

## 限速、锁定与审计

| 情形 | 响应 | 留痕 |
| --- | --- | --- |
| 单 Key 超过 30 次 / 分钟 | HTTP 429 + `Retry-After` | 调用与拒绝均记日志 |
| 缺失、无效或已吊销的 Key | HTTP 401 | 一条 `mcp_auth_fail` 审计 |
| 同源 IP 一分钟内累计 10 次失败 | 锁定 5 分钟，期间失败请求返回 HTTP 429 + JSON-RPC `-32031` | 锁定期重复失败按每分钟最多一条记审计 |
| 持有效 Key 的正常请求 | 不受锁定影响 | — |
| 只读 Key 调用未授权工具 | HTTP 403 + JSON-RPC `-32030` | — |
| 用域名访问 `/mcp` 未配 `MCP_ALLOWED_HOSTS` | HTTP 403 | — |

鉴权审计只记原因、来源 IP 与 Key 哈希前 8 位，绝不含明文 Key 或完整哈希；不要把真实 Key 写进代码仓库或日志。调用、鉴权失败与 Key 管理动作分别落在操作日志的「MCP 调用 / MCP 鉴权 / MCP Key」筛选项里。

## 只读边界与权限裁剪

- **本期不提供**。没有删除版本、批量清理、手动重扫，也不修改原版 Verdaccio 用户或密码。用户名单同样只读，只给用户名与创建时间，不含密码、哈希与文件路径。
- **权限裁剪已就位**。`full` 是为后续写操作预留的授权级别。写工具一旦挂到 full 下，只读 Key 会自动看不到它、调用返回 403。工具清单按连接缓存，换 Key 后需重连才刷新。
- **跨公网使用的取舍**。端点按 HTTP 提供服务，跨公网使用时 Key 明文在途属已知取舍；对应的加固手段是限速、失败锁定与随时吊销，而不是把权限放开。给 AI 客户端的 Key 建议单独生成，便于按用途吊销。

## 返回口径与不可信内容

- **体积两个口径**。`mb` / `cleanableMb` 与 `top_packages` 的 `size` 都是 `.tgz` 合计，目录内 `package.json` 等不计入；真实磁盘占用看 `diskMb` / `diskBytes`，通常明显更高。
- **演示模式标记**。结果含 `demo` 标记。未配置 `VERDACCIO_STORAGE` 时，三个包查询工具返回内置演示数据，依赖字段为 `null` 并附 `note` 说明。
- **包内容按不可信处理**。README、包名与依赖字段来自仓储，应视为数据而非指令；给 AI 的提示词模板里也已注明这一点。

仓库内 `doc/mcp-agent-prompt.md` 提供触发词为「npm私服」的客户端提示词模板，需求与验收范围见 `doc/prd-mcp.md`。
