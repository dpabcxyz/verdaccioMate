# PRD：Verdaccio Mate MCP 服务

**版本**：v1.1（一期扩展：新增 4 个只读工具与 scope 强制）
**作者**：chenxuan
**日期**：2026-10-30
**状态**：草稿（待评审）

---

## 1. 背景与目标

### 1.1 背景

Verdaccio Mate 目前的所有缓存管理能力（扫描、包检索、删除/清理、阈值/忽略、一键拉取、日志/通知、用户管理）只存在于 Web 界面，AI 助手（Claude Desktop、Cursor、Qoder 等）无法直接触达。日常协作中，开发者只能人工打开 Verdaccio Mate、截图或复制数据喂给 AI，再由 AI 口述操作、人工执行，链路断裂且易出错。

部分 AI 客户端支持 MCP（Model Context Protocol）远程接入，具体传输方式与配置格式需逐客户端验证。本服务以支持 2025-06-18 修订的 Streamable HTTP 客户端为接入目标；Verdaccio Mate 现有查询接口、登录认证与操作日志体系可用于本次扩展。

- 不做会怎样：AI 始终是"旁观者"，缓存排查、版本审计、空间治理等高频运维动作无法自动化。
- 做了能怎样：AI 直接通过标准协议查询缓存状态、检索包信息、在授权范围内执行操作；所有动作有审计可追溯。

### 1.2 目标用户

| 用户角色 | 特征描述 | 核心诉求 | 使用场景 |
|---------|---------|---------|---------|
| AI 助手（MCP 客户端） | 运行在开发者本机或自动化环境，通过 URL + Key 接入 | 以自然语言驱动缓存查询与操作，返回结构化数据 | "帮我看看 lodash 缓存了多少版本、占多少空间" |
| 开发者/缓存管理员 | Verdaccio Mate 既有用户，习惯对话式工作流 | 让 AI 代查代管，自己保留最终确认权 | 排查某包缓存异常、批量核对版本 |
| 自动化脚本/CI | 无人工值守的定时任务 | 程序化获取扫描结果与包清单 | 每日扫描后把异常包清单推送到 IM |

### 1.3 业务目标与成功指标

| 目标 | 衡量指标 | 目标值 | 监测方式 |
|------|---------|--------|---------|
| AI 客户端真实接入 | 生成并使用中的 MCP Key 数量 | 上线 4 周内 ≥ 2 个活跃 Key | 审计日志按月统计去重 Key 调用数 |
| 查询体验达标 | 包列表检索类工具响应时间 | p95 < 2 秒（7000+ 包场景） | 工具调用耗时埋点 |
| 操作安全可追溯 | MCP 调用审计覆盖率 / 误操作事故 | 100% 进审计日志 / 0 起未确认的危险操作 | 日志核对 + 事故复盘 |
| 不影响 Verdaccio Mate 主流程 | MCP 高峰调用下 Verdaccio Mate 页面可用性 | Verdaccio Mate 核心接口无 P99 劣化 | 压测对比 |

## 2. 需求概述

Verdaccio Mate 开放标准 MCP 服务：AI 通过 URL + API Key 直连，查询缓存、检索包、按权限分级执行管理操作，全程审计。

## 3. 功能详细设计

### 3.1 MCP 端点与协议接入（P0）

**功能描述**：在 Verdaccio Mate 服务内提供符合 MCP 规范的远程接入端点，客户端可完成握手、枚举工具、调用工具。

**用户故事**：作为 AI 助手，我希望用标准的 MCP 配置（URL + Key）接入 Verdaccio Mate，以便无需任何定制代码即可使用缓存管理能力。

**优先级**：P0

**业务规则**：
1. 传输采用 Streamable HTTP（MCP 协议 2025-06-18 修订），JSON-RPC 2.0 语义；客户端通过 HTTP POST 调用，服务端可流式返回响应。
2. 端点与 Verdaccio Mate 同进程同端口部署，不新增独立服务；Verdaccio Mate 容器重启后端点随容器恢复，无需客户端改配置（Key 不变则配置不变）。
3. 能力声明仅 tools，一期不提供 resources / prompts；`tools/list` 按 Key 权限级别动态裁剪（read Key 看不到写工具，避免客户端误解能力边界）。
4. 协议错误语义：未认证返回 HTTP 401（JSON-RPC -32001）；跨源请求拒绝返回 HTTP 403；限速返回 HTTP 429（JSON-RPC -32029）与 Retry-After；同一来源 IP 认证失败过多返回 HTTP 429（JSON-RPC -32031）与 Retry-After。工具业务失败返回 `isError: true` + 中文错误信息，不得伪造成功结果。
5. 认证失败可追溯：每次 401 写一条 `mcp_auth_fail` 审计（原因 missing/malformed/unknown/revoked、来源 IP、Key 哈希前 8 位），不记录来访者提交的密钥明文与完整哈希。
6. 工具调用为无状态请求，不依赖会话；每个请求携带 API Key 独立认证。

**交互流程**：
1. 用户在 Verdaccio Mate「设置」中生成 MCP Key（见 3.2），拿到 URL（当前 Verdaccio Mate 地址 + `/mcp`）与 Key。
2. 用户在 AI 客户端（Claude Desktop / Cursor / Qoder）中添加 MCP 服务器配置（类型 streamableHttp，URL + Authorization 头）。
3. 客户端连接：`initialize` → 服务端返回协议版本与能力 → `tools/list` → 返回该 Key 权限内可见的工具清单。
4. 客户端 `tools/call` → 服务端校验 Key → 执行 → 返回结构化结果。
5. 失败：未认证 / 权限不足 / 参数非法 / 后端异常，均按规则 4 返回明确错误，客户端可读。

**异常处理**：

| 异常场景 | 处理方式 | 客户端提示 |
|---------|---------|---------|
| Key 缺失或无效 | 返回 -32001，写一条 `mcp_auth_fail` 审计 | "认证失败：请检查 MCP Key" |
| Key 已吊销 | 返回 -32001，审计原因记 `revoked` | "该 Key 已被吊销" |
| 权限级别不足 | 返回 -32002 | "权限不足：当前 Key 为只读" |
| 后端未就绪（启动扫描中） | 查询工具返回当前可用缓存数据 + `scanning: true` 标记 | "数据为扫描中快照" |
| 请求超频 | 返回 -32029 + Retry-After | "请求过于频繁" |
| 来源 IP 认证失败过多 | 1 分钟内累计 10 次失败即锁定该 IP 5 分钟，锁定期内的失败请求返回 429 + -32031 + Retry-After；持有效 Key 的请求不受影响；锁定期内审计按每分钟最多一条 | "认证失败次数过多，来源 IP 已临时锁定" |

### 3.2 API Key 管理（P0）

**功能描述**：Verdaccio Mate「设置」页新增「MCP 接入」区：生成/吊销 Key、命名、选权限级别、查看调用概览。

**用户故事**：作为缓存管理员，我希望在 Verdaccio Mate 上自助生成和吊销 MCP Key，以便随时控制哪些 AI 客户端有权接入、权限多大。

**优先级**：P0

**业务规则**：
1. Key 权限级别两级：
   - **read（只读）**：仅可调用查询类工具（扫描状态/进度、总览统计、占用排行、包列表/详情、版本与依赖）；
   - **full（全量）**：可调用全部工具，一期额外可见 原版 Verdaccio 用户名单（只读），后续含安全写（手动重扫、忽略、阈值）；危险工具（删除版本、清理、拉取、改存储目录、用户管理）在 full 基础上每次调用还须携带 `confirm` 参数（见 3.6）。
2. Key 创建时：可命名（便于审计辨识）、必选权限级别；列表默认只显示掩码（前 4 位 + 后 4 位）。认证走 SHA-256 哈希；明文另以 AES-256-GCM 密文入库，主密钥存于数据目录的 `mcp_key_vault.key`，因此 Verdaccio Mate 可随时「复制配置」回看明文（每次回看写审计日志，吊销即抹掉密文）。仅存哈希、不可回取的旧 Key 需重新生成。
3. Key 吊销后，下一次请求立即认证失败；已通过认证并执行中的请求不会被回滚。吊销不可恢复。已吊销记录可「删除」，仅删除已吊销行（有效 Key 须先吊销），删除后掩码记录与密文一并消失。
4. 同一 Key 并发限速：默认 30 次/分钟，超限返回 -32029（规则见 3.1 异常表）；限速值一期固定，不做 UI 配置。
5. 每次经过认证的工具调用均记审计日志（见第 5 章），包含参数校验失败和未知工具；记录 Key ID、名称、权限、耗时、结果与截断标志，不存原始参数或明文 Key。
6. 一期沿用既有 Verdaccio Mate 权限模型：已登录 Verdaccio Mate 账号均可管理 Key；MCP Key 本身不能访问管理接口。Verdaccio Mate 当前未区分管理员与普通用户，后续引入角色体系时须同步收紧该入口。
7. 一期开放 8 个工具且全部只读，read Key 与 full Key 可见集合相同（含 `list_registry_users`）；均不含删除、清理、重扫与用户改动。用户名单不算敏感操作：只有用户名与创建时间，不含密码、哈希与文件路径。full 是后续授权扩展级别，创建界面须提示升级后可能获得写能力。

**交互流程**：
1. 管理员打开 Verdaccio Mate → 设置抽屉 → 「MCP 接入」区。
2. 点击「生成 Key」→ 输入名称、选择权限级别 → 确认。
3. 成功：弹层显示完整 Key（含一键复制）+ 接入 URL 提示；关闭后不再展示完整 Key。
4. 列表展示：名称、掩码 Key、权限级别、创建时间、最近调用时间。
5. 点击「吊销」→ 二次确认 → 成功：该 Key 立即失效并移入已吊销列表（保留审计记录）。

**异常处理**：

| 异常场景 | 处理方式 | 用户提示 |
|---------|---------|---------|
| 未登录访问设置 | 沿用 Verdaccio Mate 登录态，未登录跳登录页 | 同 Verdaccio Mate 既有行为 |
| 生成 Key 时后端异常 | 不落库、明确报错 | "生成失败，请重试" |
| 误吊销 | 不可恢复，需重新生成并更新客户端配置 | 吊销确认弹层中明示"不可恢复" |

### 3.3 扫描查询工具（P0，一期 MVP）

**功能描述**：AI 可查询缓存扫描状态、实时进度与最近一次扫描结果概况。

**用户故事**：作为 AI 助手，我希望查询 Verdaccio Mate 的扫描状态与进度，以便判断当前缓存数据是否最新、排查扫描异常。

**优先级**：P0

**工具定义**：

| 工具名 | 参数 | 返回 | 权限 |
|--------|------|------|------|
| `get_scan_status` | 无 | 是否扫描中、起止时间、包总数、总占用、最近错误（如有） | read |
| `get_scan_progress` | 无 | 扫描中时：已扫包数、已扫字节数；非扫描中时：返回最近完成状态 | read |

**业务规则**：
1. 扫描是长任务：工具永不阻塞等待扫描完成，立即返回当前状态/进度快照。
2. Verdaccio Mate「启动扫描」（部署后首次）进行中时，查询返回 `scanning: true` + 实时进度 + `firstScan: true` 标记；此时包列表工具返回扫描中的缓存快照并标注。
3. 扫描失败进入 5 分钟冷却期（既有后端机制），`get_scan_status` 返回 `lastError` 与冷却剩余时间，AI 可据此解释为何重扫未生效。
4. 数据口径与 Verdaccio Mate 一致：包数 = 扫描发现的包目录数，字节 = 目录内文件字节和（与 du 同口径）。

**交互流程**：
1. AI 发起 `get_scan_status` → 返回状态快照。
2. 若 `scanning: true`，AI 可间隔调用 `get_scan_progress` 追踪进度（客户端自行决定轮询频率，受 Key 限速约束）。
3. 成功：结构化 JSON；失败（未认证/后端异常）：按 3.1 规则返回错误。

**异常处理**：

| 异常场景 | 处理方式 | 客户端提示 |
|---------|---------|---------|
| 扫描进行中 | 返回快照 + scanning 标记，不阻塞 | 见业务规则 2 |
| 扫描近期失败 | 返回 lastError + 冷却时间 | "扫描失败：{原因}，冷却中" |
| 后端重启导致状态丢失 | 返回"尚未扫描"，引导触发扫描（full Key）或人工 Verdaccio Mate 操作 | "暂无扫描记录" |

### 3.4 包检索工具（P0，一期 MVP）

**功能描述**：AI 可检索缓存包清单（关键词过滤、来源/状态筛选）并查看单个包的版本明细、占用、来源与说明。

**用户故事**：作为 AI 助手，我希望按名称检索缓存包并查看包详情，以便回答"某包缓存了哪些版本、占多少空间、来自私有还是代理"这类问题。

**优先级**：P0

**工具定义**：

| 工具名 | 参数 | 返回 | 权限 |
|--------|------|------|------|
| `list_packages` | `keyword`（可选，不区分大小写子串）、`origin`（可选：all/private/proxy）、`status`（可选：all/warn/ok/ignored/broken） | 包列表：名称、版本数、占用、最近更新、访问次数、状态、来源、最新版本 | read |
| `get_package_detail` | `pkgName`（必填） | 单包详情：版本明细（版本号/大小/时间）、总占用、来源、readme、状态 | read |

**业务规则**：
1. 检索口径与 Verdaccio Mate 一致：不区分大小写子串匹配包名或大小字符串；版本号匹配由客户端在结果内本地完成。
2. 列表排序规则与 Verdaccio Mate 一致：预警置顶 → 正常 → 忽略 → 异常，同状态按版本数降序；不提供自定义排序参数。
3. 一期列表全量返回（不设分页参数）；若结果超 500 条，返回前 500 条并在结果中标注 `truncated: true` 与总条数，客户端可用更精确 keyword 收敛。
4. 包详情按需返回 readme 与版本明细（数据体大，列表接口不携带）；包不存在返回 `isError: true` + "包不存在"。
5. 扫描进行中时允许调用，返回当前缓存快照并标注 `scanning: true`（数据可能不完整）。

**交互流程**：
1. AI 发起 `list_packages(keyword="lodash")` → 返回匹配清单。
2. AI 对目标包发起 `get_package_detail(pkgName)` → 返回版本明细等。
3. 无匹配：返回空列表 + 总条数 0（不是错误）；包名非法/不存在：按规则 4 报错。

**异常处理**：

| 异常场景 | 处理方式 | 客户端提示 |
|---------|---------|---------|
| 结果超 500 条 | 截断返回 + truncated 标记 | "共 N 条，已返回前 500 条，请细化关键词" |
| 包不存在 | isError + 中文信息 | "包 {name} 不存在" |
| 扫描中数据不全 | 返回快照 + scanning 标记 | "扫描中，数据为当前快照" |

### 3.5 总览统计、占用排行、版本依赖与用户名单（P0，一期扩展）

**功能描述**：AI 可查询缓存总览（私有/代理包数、版本总数、占用空间）、占用/热度排行、单个包的逐版本依赖，以及 原版 Verdaccio 注册用户名单。

**用户故事**：作为 AI 助手，我希望回答"私服里有多少私有包和公网包、占了多少空间、哪些包最占地方的、这个包依赖了什么、有哪些用户"这类问题，而无需下载包内容或改动任何数据。

**优先级**：P0

**工具定义**：

| 工具名 | 参数 | 返回 | 权限 |
|--------|------|------|------|
| `get_storage_stats` | 无 | `packages`（total/private/proxy/broken）、`versions`（同口径拆分）、`size`（`mb`/`cleanableMb`/`tgzMb` 为 .tgz 口径，`diskMb`/`bytes`/`tgzBytes`/`diskBytes` 为字节与真实磁盘占用，附 `note` 口径说明）、`warnings`、`versionThreshold` | read |
| `top_packages` | `limit`（可选，默认 20，最大 100）、`sortBy`（可选：size 默认/visits） | 排行：`rank`、包名、占用(MB)、版本数、访问量、来源、状态 + `total` 与 `truncated` | read |
| `get_package_versions` | `pkgName`（必填）、`version`（可选，精确匹配单版本）、`limit`（可选，默认 100，最大 500） | 逐版本：版本号、大小、日期、`cached`、`dependencies`、`devDependencies`、`depsTruncated` + `total` 与 `truncated` | read |
| `list_registry_users` | 无 | `available`、`total`、`users`（仅 `name` 与 `createdAt`） | read |

**业务规则**：
1. 口径与 Verdaccio Mate 一致：包数/版本数/占用取扫描缓存快照，`broken` 包不计入包数与版本数（其物理占用仍体现在 `size.bytes`/`diskBytes`）；`cleanableMb` = 预警（版本数超阈值）包的占用之和。
2. 占用两套口径必须可区分：`mb`/`cleanableMb`/`tgzMb` 与 `top_packages.size` 都是 .tgz 体积合计（不含包目录内的 `package.json` 等文件），真实磁盘占用是 `diskMb`/`diskBytes`，二者可相差明显。响应自带 `size.note`，文档与 Agent 提示词须要求回答「占了多大空间」时以 `diskMb`/`diskBytes` 为准。
3. 私有与代理按 `_uplinks` 判定：带 uplink 的算代理缓存，否则算私有包，与包列表 `origin` 同规则。
4. 排行默认按占用降序、占用相同按版本数；`sortBy=visits` 按访问量降序、相同再按占用。异常包不参与排行。
5. `get_package_versions` 按需读取该包的本地 `package.json`：路径由包名分段推导，必须落在存储目录内且文件 ≤32MB，否则返回"元数据不可读"；包名必须先在扫描缓存中存在，否则返回"包不存在"（可拦截穿越与任意路径探测）。
6. 依赖表只收录字符串范围值，对象/数组等异常值整体丢弃；单版本最多 200 条，超出带 `depsTruncated: true`。版本按旧→新排列，`limit` 截断保留最新的 N 个。
7. `list_registry_users` 只读：不返回密码、bcrypt 哈希、哈希算法与文件路径；不提供创建、改密、删除用户能力（属 P2 危险操作，需人工审批机制先行评审）。
8. scope 强制执行（本期空转，为二期写工具预留）：`full` 工具对 read Key 既不在 `tools/list` 出现，调用也直接返回 HTTP 403 + JSON-RPC `-32030`（权限不足），并写一条失败审计。本期没有 full 专属工具，两种 Key 清单一致；一旦写工具上线，只读 Key 会自动看不到、调不动。客户端换 Key 后需重连，工具清单按连接缓存。
9. 演示模式下 `get_storage_stats` / `top_packages` 走内置演示数据；`get_package_versions` 的依赖字段为 `null` 并附 `note` 说明本地无元数据。磁盘字段在演示模式为 `null`/`0`，不得编造 MB 数字。

**交互流程**：
1. AI 发起 `get_storage_stats` → 得到总量与可清理空间，再按需 `top_packages` 定位大户。
2. AI 对目标包发起 `get_package_versions(pkgName)` → 得到版本依赖链；`truncated: true` 时用 `limit` 放大或 `version` 收敛。
3. 任意 Key 用 `list_registry_users` 回答"有哪些账号"；两种权限都能查。

**异常处理**：

| 异常场景 | 处理方式 | 客户端提示 |
|---------|---------|-----------|
| 包不在扫描缓存 | isError + "包不存在" | "缓存中没有该包，可先 list_packages 确认" |
| 本地元数据缺失/越界/超大 | isError + "元数据不可读" | "该包元数据不可读，无法给出依赖" |
| 指定版本不存在 | isError + "版本不存在" | 不回显包名与版本号 |
| read Key 调用未来的 full 专属工具 | HTTP 403 + `-32030` | "权限不足：该工具需要全量（full）Key" |
| htpasswd 未配置 | `available: false` + `note`（不是错误） | "未找到 htpasswd 文件" |

### 3.6 二期/三期工具（P1/P2，仅登记范围，规则随对应 PRD 细化）

**P1（二期）—— 查询扩展 + 安全写**：
- 日志查询（按动作/关键词过滤，分页）、通知列表与已读；
- 阈值读取/修改、忽略列表读取/增删；
- `trigger_scan`（手动重扫，返回"已开始后台扫描"，不阻塞）。

**P2（三期）—— 危险操作**：
- `delete_package_version`、`clean_cache`（清理策略）、`sync_latest`/`pull_packages`（一键拉取）、`set_storage_dir`、htpasswd 用户管理。

**危险操作统一规则（P2 设计基线，一期先约定）**：
1. 仅 full Key 可见可调；每次调用必须携带 `confirm` 参数，其值须与将执行动作的摘要字符串完全一致（如 `confirm: "DELETE lodash@4.17.21"`），不一致则拒绝执行并返回期望值。
2. 每个危险工具参数白名单化（如删除仅允许单包单版本，不允许通配符/批量）；批量诉求通过多次调用完成，每次独立确认。
3. `confirm` 摘要只能防止参数误传，不能证明人类授权，因为模型可自行填写。三期必须单独评审可信的人工审批或一次性授权机制，未落实前不得开放危险工具；执行结果写通知（消息中心可见）。
4. 存储目录切换工具仅登记，一期不承诺开放（影响全局，建议长期仅限 Verdaccio Mate 操作）。

## 4. 非功能需求

| 类别 | 要求 | 验收标准 |
|------|------|---------|
| 性能 | 查询类工具轻量返回，不与扫描抢资源 | `list_packages` 7000+ 包关键词检索 p95 < 2s；工具调用期间 Verdaccio Mate 核心接口 P99 不劣化 |
| 安全 | Key 哈希认证 + 密文可回看；明文不进列表/日志 | 数据库与日志中无明文 Key；仅同时持有 `manager.db` 与 `mcp_key_vault.key` 才能还原；吊销后请求即时失败且密文清除 |
| 安全 | 传输安全 | Verdaccio Mate 若以 HTTPS 暴露则 MCP 全链路加密；当前内网 HTTP 部署为已知风险（见第 8 章），文档明示 |
| 可用性 | 端点随 Verdaccio Mate 容器部署，无独立组件 | Verdaccio Mate 重启后客户端仅需重试连接，无需改配置 |
| 兼容性 | 遵循 MCP 协议 2025-06-18 修订 + JSON-RPC 2.0 | Claude Desktop / Cursor / Qoder 至少两家实测通过接入与调用 |
| 可观测性 | 已认证工具调用与认证失败均可审计 | 每次已认证 `tools/call` 进入审计日志（含校验失败/未知工具/限速拒绝）；每次认证失败写 `mcp_auth_fail`（原因/来源 IP/Key 哈希前 8 位），不记录来访者提交的密钥明文与完整哈希 |

## 5. 数据需求

| 事件名 | 触发条件 | 关键属性 | 用途 |
|--------|---------|---------|------|
| mcp_tool_call | 每次通过认证的 MCP `tools/call`（含失败） | 工具名、Key ID/名称与权限级别、结果、耗时 ms、截断标记；不记录原始参数或密钥 | 审计 + 用量统计 + 排查 |
| mcp_key_event | Key 生成/吊销（一期不支持改权限） | 操作类型、Key ID/名称、权限级别、Verdaccio Mate 操作人 | 安全审计 |

说明：MCP 调用日志复用现有操作日志体系（`action=mcp_call`），Verdaccio Mate 日志页可按动作过滤查看；不新建独立存储。

## 6. 验收标准

| 编号 | 场景 | Given（前提） | When（操作） | Then（预期结果） |
|------|------|-------------|-------------|-----------------|
| AC-1 | 端点握手 | Verdaccio Mate 运行、客户端配置了有效 Key | 客户端发 `initialize` + `tools/list` | 返回协议版本、tools 能力，且工具清单与 Key 权限匹配 |
| AC-2 | 未认证调用 | 无 Key 或 Key 无效 | 客户端调 `tools/call` | 返回 -32001，不执行任何操作 |
| AC-3 | 权限裁剪 | 持有 read Key | 调用 `tools/list` | 返回全部 8 个只读工具，不含任何写工具；二期把写工具挂到 full 后，同一清单对 read Key 自动剔除且调用返回 403 + -32030 |
| AC-4 | Key 生成 | 管理员登录 Verdaccio Mate 设置页 | 生成 read Key | 完整 Key 仅显示一次，列表仅掩码；「复制配置」可随时经认证回看明文并写审计，吊销即抹掉密文；日志有 mcp_key_event |
| AC-5 | Key 吊销 | 某 Key 正在被客户端使用 | 管理员吊销该 Key | 该 Key 下一次调用返回 -32001；吊销不可恢复 |
| AC-6 | 扫描进度 | 后端扫描进行中 | 客户端调 `get_scan_progress` | <1s 返回已扫包数与字节数，不阻塞扫描 |
| AC-7 | 扫描失败态 | 上次扫描失败且在冷却期 | 客户端调 `get_scan_status` | 返回 lastError 与冷却剩余时间 |
| AC-8 | 包检索性能 | 缓存 7000+ 包 | `list_packages(keyword="lodash")` | p95 < 2s，结果仅含匹配包 |
| AC-9 | 结果截断 | 某 keyword 命中 >500 条 | `list_packages(keyword="a")` | 返回 500 条 + truncated:true + 总条数 |
| AC-10 | 包详情 | 包存在 | `get_package_detail(pkgName)` | 返回版本明细/大小/来源/readme/状态 |
| AC-11 | 包不存在 | 包名不存在 | `get_package_detail(pkgName)` | isError:true + "包不存在"，不返回空成功 |
| AC-12 | 审计闭环 | 任意客户端完成一次工具调用 | 管理员查 Verdaccio Mate 日志（action=mcp_call） | 可见工具名、Key 名称、耗时、结果 |
| AC-13 | 总览口径 | 缓存同时含私有包与代理缓存包 | 客户端调 `get_storage_stats` | 包数/版本数按 private+proxy 拆分且等于 total；broken 不计入；`mb` 为 .tgz 口径、`diskMb`/`diskBytes` 为真实磁盘占用且与字节字段换算一致，响应带 `note` 说明 |
| AC-14 | 占用排行 | 缓存包数 > limit | `top_packages(limit=20)` | 默认 20 条按占用降序，含包名/占用/版本数；超限返回 truncated:true + total |
| AC-15 | 版本依赖 | 私有包本地有 `package.json` | `get_package_versions(pkgName)` | 逐版本返回 dependencies / devDependencies、大小、日期、cached；非字符串依赖值不出现 |
| AC-16 | 依赖越界防护 | 包名尝试路径穿越或本地无元数据 | `get_package_versions(pkgName)` | 分别返回"包不存在"/"元数据不可读"，不泄漏存储路径 |
| AC-17 | 用户名单只读 | 持有任意 Key（read 或 full） | `list_registry_users` | 仅返回用户名与创建时间，响应不含密码/哈希/算法/文件路径；不提供增删改 |
| AC-18 | 认证失败留痕 | 客户端未带 Key / 带不存在或已吊销的 Key | 每次 `tools/call` 被拒为 401 | 逐条写入 `mcp_auth_fail` 审计，含原因（missing/malformed/unknown/revoked）、来源 IP、Key 哈希前 8 位；日志与响应均不含 Key 明文或完整哈希 |
| AC-19 | 来源 IP 爆破抑制 | 同一来源 IP 在 1 分钟内认证失败满 10 次 | 第 11 次仍用错误 Key 请求 | 返回 HTTP 429 + `-32031` + `Retry-After`（锁定 5 分钟），锁定期内审计按每分钟最多一条；同期持有效 Key 的请求照常 200 |

## 7. 排期建议

| 阶段 | 范围 | 预估工时 | 依赖 | 风险点 |
|------|------|---------|------|--------|
| 一期开发 | 端点 + Key 管理（后端）+ 8 个只读查询工具 + 设置页 MCP 区（前端） | 后端 3 人日 + 前端 2 人日 | 无 | 协议细节（流式响应）调通耗时 |
| 一期测试 | 单测（权限裁剪/错误语义/截断）+ 本地联调 + 两客户端实测 | 2 人日 | 一期开发 | 客户端配置差异（Qoder/Claude Desktop） |
| 一期发布 | 构建镜像 → 用户侧 NAS 部署 → 线上验证 | 0.5 人日 | 一期测试 | 部署通道依赖用户侧 |
| 二期 | 日志/通知/阈值/忽略/手动重扫 | 3 人日 | 一期发布 | 写工具权限回归 |
| 三期 | 危险操作（confirm 机制 + 通知） | 3 人日 | 二期 | 误操作风险，需演练 |

## 8. 风险与依赖

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Key 经明文 HTTP 传输（当前内网 HTTP 部署） | 中 | 高 | 文档明示风险；Key 按最小权限发放；建议部署层启用 HTTPS 后再开放 full Key；Key 可即时吊销 |
| 危险操作误触发（三期） | 低 | 高 | 独立可信人工审批 + full 权限 + 审计日志 + 消息中心通知；confirm 不作为人类授权证明，一期不开放 |
| AI 高频轮询扫描进度打满限速 | 中 | 低 | 每 Key 30 次/分钟限速；进度工具返回无需高频轮询的增量信息 |
| MCP 协议版本演进 | 低 | 中 | 固定 2025-06-18 修订；升级时走版本协商，不破坏既有客户端 |
| Verdaccio Mate API 变更导致 MCP 工具口径漂移 | 中 | 中 | MCP 工具复用既有路由逻辑；Verdaccio Mate 改动时执行 MCP 工具回归清单（AC-1~AC-12 子集） |
| 依赖：NAS 部署通道 | — | — | 本机无法直达 NAS，发布需用户侧 docker load + compose up -d |

## 附录

### A. 一期工具 ↔ 既有能力映射

| MCP 工具 | 对应既有 Verdaccio Mate 能力 | 权限 |
|---------|----------------|------|
| get_scan_status | 扫描状态（scanState）/ 最近完成时间与错误 | read |
| get_scan_progress | 扫描进度（已扫包数/字节数） | read |
| get_storage_stats | 首页总览统计（Verdaccio Mate 前端按同一口径计算：包数/版本数/占用/预警/可清理） | read |
| top_packages | Top 榜页面的占用与热度排序 | read |
| list_packages | 包列表检索（keyword / origin / status 筛选，Verdaccio Mate 排序口径） | read |
| get_package_detail | 包详情（版本明细 / readme / 来源） | read |
| get_package_versions | 包详情的版本明细 + 本地 `package.json` 里的 dependencies / devDependencies（Verdaccio Mate 未展示依赖，MCP 按需读取） | read |
| list_registry_users | 原版 Verdaccio 用户名单（htpasswd，仅用户名与创建时间） | read |

### B. 相关文档

- Verdaccio Mate 设计规范：`doc/design-spec.md`
- 后端路由清单：`backend/routes/`（auth / clean / ignored / logs / packages / sync / theme / thresholds / toplist / verdaccio）
