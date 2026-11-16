# 用户体系

Verdaccio Mate 不自建用户表：用户名单的唯一来源是原版 Verdaccio 的 htpasswd 文件。本文写清登录通道、用户管理能力、与原版 Verdaccio 用户的关系边界，以及部署时的注意事项——涉及权限与凭据的地方按代码实际行为描述，不做美化。

## 三种可认证身份

Verdaccio Mate 里共有三种可认证身份。它们的名单来源、凭据存储、认证方式彼此独立，互不共享、互不回写。

### Verdaccio Mate 内置账号

由环境变量 `VCM_USERNAME` / `VCM_PASSWORD` 定义，是 Verdaccio Mate 唯一「自有」的账号。口令在启动时做 sha256 进内存，不落库。**默认不存入原版 Verdaccio 的 htpasswd**——只有在用户管理页点击「同步用户名」按钮，才会把该用户名（连同内置密码的 bcrypt 哈希）追加进 htpasswd，且同名已存在时不覆盖其密码。

### 原版 Verdaccio 用户

来自原版 Verdaccio 的 `htpasswd` 文件（bcrypt `$2a$10$` 行）。用户管理页读写的就是这份文件，不另建名单；这些用户可以直接登录 Verdaccio Mate。

### MCP Key

给 AI 客户端用的第三套身份：认证走 sha256 哈希、回看走 AES-256-GCM 密文，与 Verdaccio Mate 登录令牌、htpasswd 密码均相互隔离。详见 [MCP 接入](#mcp)。

## 双通道登录与内存会话

登录接口先试 Verdaccio Mate 内置账号，不命中再校验 htpasswd 行——所以原版 Verdaccio 的用户无需任何注册即可登录 Verdaccio Mate。

- **通道一：Verdaccio Mate 内置账号（优先）**。用户名匹配 `VCM_USERNAME` 时走此通道，口令经常量时间比较（sha256 摘要 + `timingSafeEqual`），htpasswd 里同名行的密码对 Verdaccio Mate 登录无效。
- **通道二：htpasswd 用户（兜底）**。用 `bcrypt.compareSync` 校验。只支持 `$2a` / `$2b` / `$2y` 格式；旧格式 `{SHA}` 可用原密码登录并自动升级，`$apr1$` / crypt 仍不支持。
- **会话内存态**。登录成功颁发随机 UUID 令牌，有效期 12 小时；「记住我」决定令牌存 localStorage 还是 sessionStorage。会话不落盘，容器重启后需重新登录。
- **登录限流按 IP**。滑动窗口内失败 3 次即锁定 15 分钟，两条通道共用同一个失败计数器；登出或过期由前端清除令牌并跳回登录页。
- **旧格式 `{SHA}` 登录即升级**。用 Apache `htpasswd -s` 时代产生的 `{SHA}` 用户可用原密码登录，成功后该行自动重写为 bcrypt（登录即迁移），并写 `user_upgrade` 审计；升级失败（如密码不足 6 位）只降级保留原行，不影响本次登录。
- **无法登录的情形**。htpasswd 文件未挂载或探测不到时，仅 Verdaccio Mate 内置账号通道可用；`$apr1$` / crypt 等更旧格式的用户会被明确拒绝——可在 Verdaccio Mate 用户管理页重置密码迁移为 bcrypt。

## 用户管理：htpasswd 的可写视图

界面上叫「用户管理」，实际操作对象就是原版 Verdaccio 的用户文件——Verdaccio Mate 里发生的是真实的用户增删改，不是内部影子数据。

- **列表与来源标注**。读取 htpasswd 返回用户名、密码算法与创建时间，不返回哈希明文；Verdaccio Mate 内置账号在列表中单独标注来源，与原版 Verdaccio 用户区分展示。
- **新增 / 重置密码 / 删除**。写入格式与原版 Verdaccio 一致（bcrypt `$2a$10$`），走临时文件 + rename 原子替换。新增的用户可立即 `npm login`，被删除的用户无法再拉取/发布。
- **用户名同步**。把 Verdaccio Mate 内置账号的**用户名**单向补写进 htpasswd：缺名才追加，同名不覆盖已有哈希。只同步名字，不做密码双向同步。
- **保护规则**。不能删除当前登录的账号；前端对 Verdaccio Mate 内置账号行禁用改密与删除。所有用户操作写入操作日志，可在日志页按类型筛选复查。
- **挂载要求**。htpasswd 需**读写**挂载（`VERDACCIO_HTPASSWD` 可显式指定路径）；只读或未挂载时列表给出空态提示，写接口返回 400，Verdaccio Mate 内置账号登录不受影响。
- **权限模型：无角色**。Verdaccio Mate 没有角色体系——任何能登录的用户（含原版 Verdaccio 用户）权限完全相同，可管理用户、MCP Key 与缓存治理。唯一的权限维度是 MCP Key 的 read / full。

## 与原版 Verdaccio 用户的关系边界

一句话：注册名单只有一份（htpasswd），凭据有三套权威来源；同步只有一条单向通道。以下边界按代码实际行为归纳。

- **名单一份、两个视图**。Verdaccio Mate 用户管理页是 htpasswd 的**可写**视图；MCP 的 `list_registry_users` 是同一文件的**只读**视图（仅用户名与创建时间）。
- **凭据三个权威源**。Verdaccio Mate 登录只认环境变量内置口令；原版 Verdaccio 登录只认 htpasswd 哈希；MCP 认证只认 SQLite 里的 Key 哈希。互不读取、互不校验。
- **同步单向**。只有「Verdaccio Mate 内置账号用户名 → htpasswd」一条通道，且同名时不覆盖原哈希；htpasswd 用户不会反向变成 Verdaccio Mate 账号（Verdaccio Mate 没有用户表）。
- **会话零交互**。Verdaccio Mate 令牌与原版 Verdaccio 的 npm token / `.npmrc` 完全隔离；Verdaccio Mate 也不读取原版 Verdaccio 的 `config.yaml` 与 packages ACL。
- **同名 ≠ 同密码**。同步后 Verdaccio Mate 内置账号在 htpasswd 里有一行影子哈希，但 Verdaccio Mate 登录用的是环境变量口令。改 `VCM_PASSWORD` 不回写该行，在 Verdaccio Mate 重置该行密码也不影响 Verdaccio Mate 登录，两侧密码可能长期不一致。
- **登录互通 ≠ 权限互通**。原版 Verdaccio 侧的发布/访问权限由 `config.yaml` 的 ACL 决定，Verdaccio Mate 不继承。一个只能只读拉包的用户，登录 Verdaccio Mate 后拥有完整治理权限（含改密、删用户）。
- **删除保护按登录名**。后端只禁止删除「当前登录用户名」；与 Verdaccio Mate 内置账号同名的 htpasswd 行被普通用户删除后，原版 Verdaccio 侧该账号失效，但 Verdaccio Mate 内置账号不受影响。
- **MCP 只读一期**。8 个工具全部只读，不提供删除、清理与用户管理能力；用户名单只出用户名与创建时间。

## 部署与日常使用注意事项

涉及凭据与权限的默认行为，宁可不方便，也不要想当然。

- **必须覆盖默认口令**。Verdaccio Mate 内置账号默认 `admin` / `666666`，启动日志会告警；登录页会预填这组默认凭据，生产部署务必通过环境变量覆盖强口令。
- **用户操作即时影响原版 Verdaccio**。Verdaccio Mate 里的删除与改密直接写 htpasswd，被改/被删用户的 `npm login` 与发布能力立即变化，操作前请确认影响面。
- **原子写的属主副作用**。Verdaccio Mate 常以 root 写 htpasswd（临时文件 + rename 替换 inode），文件属主会变为 Verdaccio Mate 进程；若原版 Verdaccio 之后要自行创建用户（`npm adduser`），可能因属主/权限变化失败。
- **无角色，控制暴露面**。任何能打开 Verdaccio Mate 并登录的用户都是全权。建议只把 Verdaccio Mate 端口暴露给可信网段，不要当作多租户工具使用。
- **会话与备份口径**。会话在内存、不落盘，重启即失效；备份 `DATA_DIR` 只带走日志/阈值/MCP Key，**带不走会话，也带不走 htpasswd**（它在原版 Verdaccio 的挂载卷里）。
- **旧哈希迁移**。`{SHA}` 用户登录一次即自动升级；`$apr1$` / crypt 用户需管理员在 Verdaccio Mate 重置密码后迁移，原密码无法恢复。
