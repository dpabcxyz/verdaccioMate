# 原版 Verdaccio 缓存可视化管理工具 — 设计规范（编码阶段参考）

> 文档依据：
> 1. `doc/需求文档.md`（完整版：第一部分 功能需求 + 第二部分 前端界面设计）
> 2. `doc/bright/`、`doc/dark/`（亮色/暗色效果图：部署后以实际界面截图回填）
> 3. 手机版竖屏效果基准：部署后以实际界面截图回填（旧多巴胺风格截图已随风格定稿移除）
>
> 编码方式：**一套代码 + CSS 变量双主题**（bright=浅色默认 / dark=暗色），**三端适配（电脑 ≥1024px / 平板 768~1023px / 手机 <768px）**。
>
> 风格基调（2026-10 定稿）：**常规化开源风格——石墨灰主色 + 红点缀**，对齐 Element Plus 默认观感；弃用早期多巴胺色（橙渐变/emoji 图标/呼吸动效），全部代码已按本规范落库，`npm test`（`frontend/scripts/check-ui.mjs`）守护规范不回退。

---

## 0. 组件级 UI 规范存档（编码阶段配套，后续界面一律遵循）

> 以下组件级规范与本章第 13~15 章一一对应，均有**双主题效果图 HTML** 存档于 `doc/`，可直接浏览器打开核验；新增/修改相关 UI 时必须对照执行，禁止偏离。

| 章节 | 规范主题 | 效果图存档 | 全局样式落点（base.css） |
| --- | --- | --- | --- |
| 第 13 章 | 操作栏按钮（表格行内操作） | `doc/operation-buttons-spec.html` | `.btn.<变体>` + `.op-btn-cell`（4px 圆角小按钮） |
| 第 14 章 | 表格标签（状态/来源/类型） | `doc/tags-spec.html` | `.tag.<变体>`（20px 3px 圆角软底） |
| 第 15 章 | 表格顶部工具栏按钮（图标型 · 无背景色） | `doc/toolbar-buttons-spec.html` | `.tool-btn`（30×30 卡片底+细边框，与筛选 tabs 同高，图标即语义） |

> 编码铁律：以上三类 UI 一律使用全局声明的类，禁止组件 scoped 自写样式（el-table 单元格/工具栏内元素不携带 data-v，scoped 规则会失效）；同列同档、同工具栏同规格。

---

## 1. 设计 Token（bright / dark 双主题）

### 1.1 主色系：石墨 + 红点缀

| Token | bright（浅色） | dark（暗色） | 用途 |
| --- | --- | --- | --- |
| `--pri` | `#1F2328` | `#E6E8EB` | 实心控件/主按钮（暗色为白底深字反转） |
| `--pri-h` | `#3A4047` | `#FFFFFF` | 主按钮 hover |
| `--acc` | `#C4263B` | `#E2556B` | 红点缀：链接、选中态、品牌名、hover 强调 |
| `--acc-h` | `#9B1C31` | `#EF7B8D` | 红点缀 hover |
| `--acc-soft` | `#FBEDEF` | `rgba(226,85,107,.14)` | 红点缀软底（未读、选中底） |
| `--acc-line` | `#F5D7DB` | `rgba(226,85,107,.32)` | 红点缀描边 |

EP 主色变量同步覆盖为石墨（`--el-color-primary` 及 light-3/5/7/8/9、dark-2），保证 Element Plus 组件与自绘控件同色。

### 1.2 语义状态色（对齐 Element Plus 默认值）

| Token | bright | dark | 用途 |
| --- | --- | --- | --- |
| `--suc` / `--suc-soft` / `--suc-line` / `--suc-deep` | `#67C23A` / `#F0F9EB` / `#E1F3D8` / `#529B2E` | `#67C23A` / `rgba(103,194,58,.14)` / `rgba(103,194,58,.30)` / `#85CE61` | 正常/成功 |
| `--warn` / `--warn-soft` / `--warn-line` | `#E6A23C` / `#FDF6EC` / `#FAECD8` | 同值/半透明底 | 预警/需关注 |
| `--dgr` / `--dgr-soft` / `--dgr-line` | `#F56C6C` / `#FEF0F0` / `#FDE2E2` | 同值/半透明底 | 危险/异常 |
| `--inf` / `--inf-soft` / `--inf-line` | `#909399` / `#F4F4F5` / `#E9E9EB` | `#A3A6AD` + 半透明底 | 信息/忽略/次要 |

语义使用铁律：**危险动作（删除、清理按钮、remove hover）→ `--dgr`；预警状态（超阈值数字、待处理标签、需更新）→ `--warn`；链接与强调 → `--acc`；信息/中性 → `--inf`/`--num-bg`。**

### 1.3 中性色 / 背景

| Token | bright | dark | 用途 |
| --- | --- | --- | --- |
| `--ink` | `#303133` | `#E5EAF3` | 主文字 |
| `--ink-dim` | `#606266` | `#A3A6AD` | 次级文字 |
| `--ink-faint` | `#909399` | `#73767A` | 弱化文字/提示 |
| `--line` | `#E4E7ED` | `#414243` | 边框、分隔线 |
| `--line-soft` | `#EBEEF5` | `#363637` | 次级边框 |
| `--card` | `#FFFFFF` | `#1D1E1F` | 卡片/Verdaccio Mate 底色 |
| `--card-2` | `#FFFFFF` | `#262627` | 次级 Verdaccio Mate |
| `--bg` | `#F5F7FA` | `#141414` | 页面底色 |
| `--bg-deep` | `#FFFFFF` | `#0A0A0A` | 深一档背景 |
| `--panel-soft` | `#FAFAFA` | `#262627` | 表头/表格 hover 底 |
| `--num-bg` / `--num-bg-2` | `#F5F7FA` / `#EBEEF5` | `#262627` / `#363637` | 数字底/中性按钮底、进度条轨道 |

### 1.4 字体

| Token | 值 | 用途 |
| --- | --- | --- |
| `--num` | `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | 包名/版本号/数字/徽章 |
| `--sans` | 系统字体栈（-apple-system / Segoe UI / Roboto / PingFang SC / Microsoft YaHei） | 正文 |
| `--display` | `var(--sans)` | 标题（不再使用展示性艺术字体） |

字重上限 **600**（标题、强调均不超 600，禁 700/800）。字号梯度：18（页面标题）/ 14–15（卡片标题）/ 13.5（导航）/ 12–12.5（次要）/ 11–11.5（弱化）。

### 1.5 圆角 / 阴影

| Token | 值 | 用途 |
| --- | --- | --- |
| `--r-lg` | `6px` | 卡片/Verdaccio Mate/表格容器 |
| `--r-md` | `4px` | 按钮/输入框/控件/tool-btn |
| 标签圆角 | `3px` | `.tag` 体系 |
| `--shadow` | bright：`0 2px 8px rgba(0,0,0,.06)` / dark：`0 1px 2px rgba(0,0,0,.4)` | 卡片常态 |
| `--shadow-hover` | bright：`0 4px 16px rgba(0,0,0,.10)` / dark：`0 6px 18px rgba(0,0,0,.45)` | hover |

**禁止 99px 胶囊与渐变**：所有胶囊按钮/标签/搜索框一律改为 3~6px 小圆角；主按钮为 `--pri` 实心，禁止 `--grad-*` 渐变。

---

## 2. 双主题实现方案

```css
:root { /* bright 浅色 token（默认） */ }
html.dark { /* 覆盖 dark token（对齐 Element Plus dark css-vars 数值） */ }
```

- **机制**：`main.js` 引入 `element-plus/theme-chalk/dark/css-vars.css`；`useTheme.js` 以 `document.documentElement.classList.toggle('dark', theme === 'dark')` 切换；EP 组件随 `html.dark` 自动变暗
- **切换入口**：顶栏头像菜单「深色模式 / 浅色模式」（Sunny/Moon 图标）；登录页右上角图标按钮
- **自动模式**：默认开启日出日落自动切换（`vcm-theme-auto` + `vcm-coords` 坐标），手动切换后当日暂停自动（`vcm-theme-override`）
- **记忆**：`localStorage` 键 `vcm-theme`（值 `bright` / `dark`），加载时读取
- **暗色特例**：`--pri` 暗色为浅色（白底按钮），实心控件文字需深色——`html.dark .btn.clean { color:#141414 }`、`html.dark .el-button--primary { --el-button-text-color:#141414 }` 等（base.css 已统一声明）

---

## 3. 功能需求要点（编码约束，来自第一部分）

### 3.1 包列表与状态
- 字段：包名 / 版本数 / 占用空间 / 状态（正常·预警·已忽略）/ 操作（清理、忽略、取消忽略）
- 状态规则：正常 = 版本数 ≤ 阈值；预警 = 版本数 > 阈值 且未被忽略；已忽略 = 用户手动标记
- 排序：预警置顶 → 正常居中 → 已忽略垫底；同状态按版本数降序

### 3.2 检索
- 输入框实时过滤（防抖 300ms），一键清空；匹配：不区分大小写子串，仅匹配包名（界面文档扩展为包名/版本号/文件大小，编码以扩展版为准）
- 反馈：实时更新 + 「共找到 X 个包」；清空恢复完整列表

### 3.3 阈值配置
- **版本数阈值：取值范围 1~100，默认 15**（功能需求为准；界面设计稿示例为 50，编码以 15 为默认并可在 UI 调整）
- 持久化：保存到 SQLite `settings` 表，重启不丢失，加载时读取；修改后列表状态立即重算
- 界面扩展配置项（设计稿已实现）：单包大小阈值（默认 500MB）、单包例外（覆盖全局）、恢复默认、保存生效提示

### 3.4 预警清理
- 超阈值包：预警标签、自动置顶、清理按钮可用
- 清理确认弹窗：包名、当前版本数、保留版本数输入（默认=阈值）、将删除版本列表（Tag）、将删除数量、取消、确认清理（loading）
- 清理原子逻辑：读 package.json → 按 semver 排序保留最新 N 个 → 删低版本 versions/time 记录 → 修正 dist-tags（如 latest 指向已删版本）→ 写回元数据 → 物理删 .tgz → 记日志 → 返回「删除数量、释放空间」
- 反馈：成功「已清理 X 个版本，释放 Y MB」；失败展示错误、不修改任何文件

### 3.5 忽略标记
- 标记/取消忽略立即持久化到 `ignored_packages` 表；取消后若仍超阈值自动回预警

### 3.6 操作日志
- 每次清理自动记录：包名、删除版本列表、删除数量、释放空间、操作时间（UTC）
- 按时间倒序展示最近 50 条，支持查看详情

### 3.7 非功能要求
- 性能：500 包加载 <2s、检索 <200ms、单包清理 <5s
- 可靠：清理原子性、元数据损坏标记「异常」不影响其他包、崩溃无脏数据
- 安全：非 root（UID 10000）、storage 只读挂载、仅改目标包文件

---

## 4. 数据模型与 API（编码依据）

### 4.1 SQLite
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);          -- version_threshold 默认 '15'
CREATE TABLE ignored_packages (pkg_name TEXT PRIMARY KEY, ignored_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, pkg_name TEXT,
  deleted_versions TEXT, deleted_count INTEGER, freed_space TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
```

### 4.2 REST API
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/threshold` | 获取/设置阈值 |
| GET | `/api/ignored` | 获取已忽略包名 |
| POST | `/api/ignore` | 标记忽略 |
| DELETE | `/api/ignore/:pkgName` | 取消忽略 |
| GET | `/api/packages?keyword=` | 扫描包列表（模糊检索） |
| POST | `/api/clean` | 执行清理 |
| GET | `/api/logs` | 最近 50 条日志 |

---

## 5. 页面清单（画板 → 页面）

| # | 页面/视图 | 关键内容 | 路由 |
| --- | --- | --- | --- |
| 1 | 缓存概览 | 4 核心统计卡 + 5 辅助指标、Top 20 排行（可收起）、需关注包卡片列表 | `/` |
| 2 | 全局检索 | 大号搜索框、状态/来源/排序筛选、无边框结果表格 | `/search` |
| 3 | 阈值配置 | 全局阈值卡×2（版本数/大小，−/+ 步进器、恢复默认、保存）、单包例外表格、行内添加例外表单 | 顶栏设置抽屉（ThresholdsDrawer） |
| 4 | 包详情抽屉 | 600px 右侧滑出，包信息 + 版本列表（单版本删除、清理全部、忽略） | 覆盖层 |
| 5 | 已忽略包 | 检索页「已忽略」筛选 + 取消忽略（二次确认） | `/search` 筛选 |
| 6 | 最近动态 | 时间倒序操作日志表格，删除数量/释放空间 chip | `/logs` |
| 7 | Top1000 周榜 | 榜单摘要 + 筛选 tabs + 虚拟滚动表格 + 抓榜/拉取进度 | `/toplist` |
| 8 | 用户管理 | htpasswd 用户表格 + 新增/改密/删除 | `/users` |
| 9 | 消息通知 | 通知列表（类型图标 + 未读高亮）+ 全部已读 | `/notifications` |
| 10 | 关于 | 功能/技术栈/版权说明 | `/about` |
| 11 | 登录页 | 居中卡片 420px、图标输入框、实心登录按钮、记住我/忘记密码、右上角主题切换 | `/login` |
| 12 | 移动端竖版 | 底部 Tab 导航、2×2 统计、单列包卡、设置抽屉 | 响应式实现 |

---

## 6. 组件清单（来自设计稿）

| 组件 | 要点 |
| --- | --- | --- |
| 顶栏 Topbar | 56px；Logo + 品牌名；中部图标导航（active 石墨实心）；右侧扫描时间 + 通知铃铛 + 头像菜单（刷新/主题/设置/关于/退出） |
| 统计卡 Stat1 | 4 个：图标（tone 底）+ 等宽数字 + 标签；四色 tone（green/warn/dgr/inf） |
| 辅助指标 Stat2 | 5 个轻量小卡（今日更新/版本总数/最大包/最老包/版本数分布），顶部 3px 语义色条 |
| Top20 排行 | 表格：排行徽章、包名、下载量、热度进度条 |
| 包卡片 | 图标、包名、版本数/占用/最近更新、状态标签、清理/忽略按钮 |
| 搜索框 | 大号输入框 6px 圆角、搜索/清空图标；focus 石墨描边 |
| 筛选控件 | 状态过滤 + 排序切换，选中态红点缀软底 |
| 结果表格 | 无边框、hover 行高亮、状态标签、行内操作按钮 |
| 阈值抽屉 | 全局阈值 + −/+ 步进器 + 恢复默认 + 保存按钮 + 单包例外表格 |
| 详情抽屉 | 600px 右滑 + 遮罩；包信息/版本列表、单版本删除、清理/忽略 |
| 日志表 | 时间倒序；操作类型徽标 + 版本数/释放空间 chip |
| 登录页 | 居中卡片、图标输入框、实心登录按钮、记住我/忘记密码 |
| 移动端系列 | M-Topbar（☰）、M-Stats 2×2、M-Card 单列、M-Tabbar 底部导航、M-Drawer 设置抽屉 |

---

## 7. 响应式断点（三端，以需求文档为准）

| 断点 | 尺寸 | 导航 | 统计卡 | 包列表 | 搜索框 | 包详情抽屉 |
| --- | --- | --- | --- | --- | --- | --- |
| 桌面端 | ≥1024px | 顶部图标导航 | 4 列 | 3 列卡片网格 | 居中 600px | 右侧 600px |
| 平板端 | 768~1023px | 紧凑导航 | 2×2 | 2 列 | 100%（max 500px） | 右侧 50% |
| 手机端 | <768px | 底部 Tab + 汉堡抽屉 | 2×2 | 单列 | 全宽 | 底部弹窗 85vh |

> 差异标注：需求文档手机端导航为「汉堡菜单 + 左侧 280px 侧边抽屉」；设计稿 FRAME 07 为「右上角 ☰ + 右侧设置抽屉（主题/阈值/版本/退出）+ 底部 Tab 核心导航」。**编码以设计稿为准**（设置类进抽屉、页面切换走底部 Tab）。

---

## 8. 动效规范（克制原则）

| 场景 | 动效 |
| --- | --- |
| 页面/卡片入场 | `fadeUp` 200ms（淡入 + 轻微上滑），全局唯一入场动画 |
| 加载/执行中 | spin 家族 1s linear 无限旋转（`toolSpin` 按钮图标 / `spin360` / `sync-spin`），仅图标旋转、容器静止 |
| 扫描进度条 | `scan-slide` 1.1s 滑移（不确定进度指示），仅用于首次扫描遮罩内 |
| 抽屉/弹窗 | Element Plus 默认过渡（右侧滑入 + 遮罩淡入），不自定义 |
| toast | Element Plus 默认 |

**禁止项**：呼吸光晕（breathe/blink/pulse）、卡片 hover 上浮 translateY、按钮点击缩放、装饰性循环动画。`check-ui.mjs` 校验 `@keyframes` 白名单（fadeUp/toolSpin/spin360/sync-spin/scan-slide）。

---

## 9. 文案风格

克制、直白、工具感；面向开源社区用户，不用营销式感叹。既有映射保留：

| 后台风 | 文案 |
| --- | --- |
| 缓存管理 | 缓存管理 |
| 操作日志 | 最近动态 |
| 忽略列表 | 已忽略的包 |
| 阈值配置 | 预警设置 |
| 执行清理 | 一键清理 |
| 共 156 条记录 | 156 条动态 |

---

## 10. 技术选型与编码建议

- 后端：Node.js 18-slim + Express + better-sqlite3（单文件嵌入），Docker 单容器，storage 只读挂载、`manager-data` 读写挂载，非 root（UID 10000），端口 3000
- 前端：Vue 3 + Vite + **Element Plus**（unplugin 自动按需引入组件与指令）；`element-plus/theme-chalk/dark/css-vars.css` 提供暗色；自绘控件经 tokens.css（§1）与 EP 观感对齐，**不再整体重写 EP 组件样式**
- 目录：`src/components/`（§6 组件）、`src/views/`（§5 页面）、`src/styles/tokens.css`（双主题 token）、`src/styles/base.css`（全局工具类）
- 图标：**@element-plus/icons-vue**（与 EP 组件同源），每个 SFC 显式 `import { Xxx } from '@element-plus/icons-vue'`（unplugin 不覆盖图标）
- 数据：mock 先行跑通 UI，接口按 §4.2 对接
- 规范守护：`cd frontend && npm test`（`scripts/check-ui.mjs`）——禁 emoji 图标字符、禁 `!important`、禁旧主题变量、禁 `data-theme` 选择器、动画白名单
- 验收对照：需求文档 AC-1~8（包列表/检索/阈值/预警/清理/忽略/日志/原子性）

---

## 11. 已确认决策（编码按此执行）

1. **阈值默认值：15**（功能需求 1~100 为准，UI 可调）
2. **登录页：补效果图**（以实际界面截图为准，见 §5 #11）
3. **UI 库：Element Plus 按需引入**，自绘控件按 §1/§2 token 对齐
4. **风格定稿（2026-10）**：常规化开源风格——石墨灰主色 + 红点缀；候选蓝 `#2563EB`（太普遍）、深青均被否；全量替换 emoji 为 icons-vue，弃用多巴胺色/渐变/呼吸动效

---

## 12. 原版 Verdaccio 缓存目录配置与部署（编码依据）

### 12.1 目录配置机制
- 原版 Verdaccio 侧：缓存目录由 `config.yaml` 的 `storage` 字段指定（Docker 镜像内默认 `/verdaccio/storage`）
- Verdaccio Mate 侧：**环境变量 `VERDACCIO_STORAGE` 优先** → 其次 UI「设置」中配置并持久化到 SQLite `settings` 表（key = `storage_dir`）→ 均无时进入**首次启动引导页**要求配置
- 校验：保存/启动时校验目录存在、可读、含 `package.json` / `.tgz`；无效时提示重新配置，Verdaccio Mate 不启动扫描
- 扫描逻辑：递归 `**/package.json` 解析 `versions`/`time`，匹配 `.tgz` 计算占用；支持 scoped 包（`@scope/name` 嵌套目录）

### 12.2 部署方式一：Docker（与原版 Verdaccio 同主机）
```yaml
services:
  verdaccio:
    image: verdaccio/verdaccio
    volumes: ["./storage:/verdaccio/storage"]        # 原版 Verdaccio 读写
  verdaccio-manager:
    build: ./                                        # node:18-slim 约 180MB
    environment: [VERDACCIO_STORAGE=/verdaccio/storage, PORT=3000]
    volumes:
      - "./storage:/verdaccio/storage:ro"            # 只读挂载 原版 Verdaccio 存储
      - "./manager-data:/app/data"                   # 读写：SQLite 数据
    ports: ["3000:3000"]
```

### 12.3 部署方式二：虚拟机 / 裸机
- 环境：Node.js 18 + pnpm，构建前端后 `node server.js`，pm2/systemd 守护
- 配置（环境变量或 `.env`）：
  ```
  VERDACCIO_STORAGE=/var/lib/verdaccio/storage
  PORT=3000
  DATA_DIR=/var/lib/verdaccio-manager/data
  ```
- 原版 Verdaccio 侧 `config.yaml`：`storage: /var/lib/verdaccio/storage`（与 Verdaccio Mate 指向同一目录）

### 12.4 UI 配置入口
- 首次启动：无 `storage_dir` 时展示引导页，提供缓存目录输入 + 「自动探测」（读环境变量/常见路径）按钮
- 后续修改：顶栏头像下拉「设置」/ 移动端设置抽屉中修改，保存后重新扫描并刷新概览

---

## 13. 操作栏按钮设计规范（表格行内操作）

> 基线效果：检索页「清理 / 忽略」按钮（石墨实心主按钮 + 白底次按钮），全站表格操作栏统一走**全局 `.btn` 体系**（`frontend/src/styles/base.css`）。

### 13.1 通用形态
| 属性 | 值 | 说明 |
| --- | --- | --- |
| 圆角 | `border-radius: var(--r-md)`（4px） | 小圆角，禁用胶囊/直角混用 |
| 尺寸 | `padding: 7px 15px; font-size: 12.5px` | 常规档；操作列 `.op-btn-cell` 为 `5px 12px / 12px` |
| 间距 | 相邻按钮 `margin-left: 7px` | 每行最多 2 个，超过 2 个收进「更多」菜单 |
| 背景 | 语义变体背景（§13.2） | 禁止无规则彩色混用 |
| 落地 | 样式**全局声明**（base.css） | 禁止组件 scoped 内自定义：el-table 单元格按钮不携带 data-v，scoped 规则会失效（见提交 84070c0） |

### 13.2 语义色阶（主 / 次 / 中性 / 危险 / 幽灵）
| 变体 | 背景 | 文字 | 用途 | 示例 |
| --- | --- | --- | --- | --- |
| `.btn.clean` | `var(--pri)` 石墨实心（dark 白底深字） | `#fff`（dark `#141414`） | 主操作 | 清理、确认提交 |
| `.btn.ignore` | `var(--card)` | `var(--ink-dim)` | 次要正向操作（hover 描边/文字转 `--acc`） | 忽略、修改密码 |
| `.btn.unignore` | `var(--num-bg)` | `var(--ink-dim)` | 中性（取消 / 查看） | 取消忽略、详情 |
| `.btn.remove` | `var(--dgr-soft)` | `var(--dgr)` | 危险操作（hover 红底白字） | 删除用户、删除版本 |
| `.btn.ghost` | `var(--card)` + 1px 描边 | `var(--ink-dim)` | 幽灵/描边，仅对话框辅助按钮 | 对话框「取消」 |

### 13.3 交互态
- **hover**：clean → `--pri-h` 实心；ignore/ghost → 描边与文字转 `--acc`；unignore → 文字转 `--ink`；remove → `--dgr` 实心白字；**无上浮/缩放**
- **disabled**：`var(--num-bg)` 灰底 + `var(--ink-faint)` 灰字 + `cursor: not-allowed`（全局 `.btn:disabled`）
- **反馈**：操作完成后统一 `ElMessage` toast（成功 / 警告 / 错误）

### 13.4 组合规则
- 主次成对：主操作在左（clean / remove），次操作在右（ignore / unignore）——与检索页「清理 + 忽略」一致
- 危险操作必须有明确边界：hover 提供 title 说明；disabled 场景必须清晰解释（如 Verdaccio Mate 内置账号不可删）
- 每行按钮数量 ≤ 2；语义相近按钮不得堆叠
- **操作列对齐：所有表格「操作」列统一左对齐**（默认对齐，不设 align）
- **操作栏按钮必须同时挂 `.btn.<变体>` 与 `.op-btn-cell`**——后者保证紧凑规格不被 `.btn.<变体>` 默认 padding 覆盖（特异性和源码顺序已在 base.css 固定）

### 13.5 已应用页面（基线）
| 页面 | 按钮组合 |
| --- | --- |
| 检索页 | 清理 `.clean` + 忽略 `.ignore`；取消忽略 `.unignore` |
| 用户管理 | 修改密码 `.ignore` + 删除 `.remove`（Verdaccio Mate 内置账号禁用） |
| 操作日志 | 详情 `.unignore` |
| 对话框 | 取消 `.ghost` + 主按钮 `.clean` |

---

## 14. 表格标签设计规范（表格内状态/来源/类型标签）

> 统一走**全局 `.tag` 体系**（`frontend/src/styles/base.css`）。

### 14.1 通用形态
| 属性 | 值 | 说明 |
| --- | --- | --- |
| 圆角 | `border-radius: 3px` | 小圆角，禁用胶囊/直角标签 |
| 尺寸 | `height: 20px; padding: 0 7px; font-size: 11px; line-height: 1` | 表格内紧凑档；**固定高度 20px，小于操作按钮**；禁止 padding 撑高 |
| 字重 | `font-weight: 500` | 全局 `.tag` 基准 |
| 间距 | 图标与文字 `gap: 4px` | 可选图标前缀 |
| 背景 | **必须软底（soft）+ 同系描边** | 禁止描边版与填充版混用；禁止透明底标签出现在表格 |
| 落地 | 样式**全局声明**，组件内只套语义变体类 | 同按钮规范：防 scoped 在 el-table 失效 |

### 14.2 语义色阶
| 变体 | 背景 | 文字 | 用途 | 示例 |
| --- | --- | --- | --- | --- |
| `.tag.warn` | `var(--warn-soft)` | `var(--warn)` | 预警 / 待处理 / 需更新 | 预警、待拉取、需更新 |
| `.tag.ok` | `var(--suc-soft)` | `var(--suc-deep)` | 正常 / 成功 / 就绪 | 正常、已就绪、成功 |
| `.tag.ign` | `var(--inf-soft)` | `var(--inf)` | 忽略 / 信息 / 缓存 | 已忽略、缓存 |
| `.tag.broken` | `var(--warn-soft)` | `var(--warn)` | 异常 / 自建（与 warn 同系） | 异常、Verdaccio Mate |
| `.tag.gray` | `var(--num-bg)` | `var(--ink-dim)` | 中性来源 / 默认 | verdaccio、跳过 |

### 14.3 来源标签（用户管理）
| 来源 | 变体 | 呈现 |
| --- | --- | --- |
| Verdaccio Mate（自建） | `.tag.broken`（warn 系软底） | 黄底黄字 |
| verdaccio（htpasswd） | `.tag.gray`（num-bg） | 灰底灰字 |

### 14.4 拉取类型 / 结果徽标（操作日志）
- 拉取类型（拉取存量包 / 拉取榜单）→ `.tag.ign`（inf 系），文案用徽标小号
- 结果（成功/失败/跳过）→ `.tag.ok` / `.tag.warn` / `.tag.gray`
- 任务类型（自动/手工）→ 仅文字描述 + 图标，不用第三色阶

### 14.5 表格标签统一约束
- 同列标签必须同尺寸、同圆角、同内边距（**同列同档**）
- 状态列高度 ≤ 22px（11px 档），不再出现 32px+ 大标签
- 表格内禁止使用描边（outline）式标签；描边仅供页面级筛选控件保留
- 新增标签一律全局 `.tag` 变体，禁止组件内自写样式

### 14.6 图标界定（带 / 不带）
| 类型 | 判定 | 示例 |
| --- | --- | --- |
| **状态类 → 带图标** | 表示「当前所处状态」，靠颜色+符号双重识别，便于扫表 | 预警、正常、已忽略、异常、扫描中 |
| **属性/分类类 → 不带图标** | 表示「客观事实/分类」，文字本身即含义，加图标是噪音 | 来源（Verdaccio Mate / verdaccio）、拉取类型、结果（成功/失败/跳过） |
| 数值类 → 不带图标 | 版本数、占用、时间 | — |

配套约束：
- **同列统一**：同一列要么整列带图标、要么整列不带
- 图标仅 @element-plus/icons-vue、1 个、位于文字左侧、`gap: 4px`、`size ≤ 12`
- 移动端空间不足可去图标保文字，但整列同步
- 禁止图标与色底重复编码（如「成功」绿底 + 对勾图标，只保留一种）

---

## 15. 表格顶部工具栏按钮设计规范（图标型 · 无背景色）

> 统一走**全局 `.tool-btn` 体系**（`frontend/src/styles/base.css`）：**一律图标 + tooltip + 无彩色背景**，统一为「卡片底 + 细边框」单一样式，图标使用 @element-plus/icons-vue。

### 15.1 通用形态
| 属性 | 值 | 说明 |
| --- | --- | --- |
| 尺寸 | `width: 30px; height: 30px` | 方形按钮，与左侧筛选 tabs 同高，工具栏左右两侧齐平 |
| 圆角 | `border-radius: var(--r-md)`（4px） | 小圆角，与全站控件一致 |
| 图标 | icons-vue，`font-size: 15px` 居中 | 纯图标、无文字；一个按钮一个图标；图标由内部 `<span class="ico">` 承载，便于 running 时仅图标旋转 |
| 底色 | **`var(--card)` + `1px solid var(--line)` 细边框** | **无彩色背景**；卡片底+细边框是唯一形态 |
| 间距 | 相邻按钮 `gap: 10px` | 工具栏右对齐排列 |
| 落地 | 样式**全局声明**（base.css） | 同按钮/标签规范，禁止组件 scoped 自写 |

### 15.2 语义表达（无背景色 · 图标即语义）
| 方式 | 说明 | 示例 |
| --- | --- | --- |
| 统一样式 | 所有工具栏按钮**同构**：卡片底 + 细边框，不设任何彩色背景变体 | Refresh / Download / Plus |
| 语义传达 | 功能语义由图标承担 | Refresh=抓榜 · Download=拉取 · Plus=新增 |
| 主次区分 | 仅靠图标含义与排列次序（主操作左、次操作右），**不再用背景色**区分 | — |
| 禁止 | `.clean` 实心 / 彩色背景变体一律不用于工具栏 | ✕ 参考旧版 |

### 15.3 交互态
- **tooltip**：按钮必须带 `title` 属性，**悬停显示完整用途**（含关键信息，如「立即抓榜（每周一 00:00 自动抓取 npm 周榜）」），替代文字按钮时代的功能说明
- **hover**：`border-color: var(--acc)` + `color: var(--acc)`（仅描边与图标变色，无上浮）
- **running**：正在执行时该按钮内部 `<span class="ico">` 加 `.spin`（**仅图标** 1s 线性旋转，按钮本体与边框保持静止）+ `:disabled`（`opacity: .5; cursor: not-allowed`），另一按钮保持可用
- **反馈**：完成统一 `ElMessage` toast（成功 / 失败）

### 15.4 组合规则
- 同一工具栏内全部按钮**同尺寸、同圆角、同间距、同背景**；不得与文字按钮混排
- 工具栏左右两侧高度对齐：左筛选 tabs 与右图标按钮垂直居中（`align-items: center`）
- 功能入口**只放图标**，完整用途走 tooltip；如图标本身不足以表达用途，优先换更贴切的图标，而非加文字
- **适用场景**：Top 榜单「立即抓榜 / 一键拉取」、用户管理「新增用户」；后续所有表格顶部工具栏按钮一律 `.tool-btn`，**禁止文字长按钮、禁止彩色背景变体**

### 15.5 已应用页面（基线）
| 页面 | 按钮 |
| --- | --- |
| Top 榜单 | Refresh 立即抓榜（运行中 spin + disabled）+ Download 一键拉取 |
| 用户管理 | Plus 新增用户 |
