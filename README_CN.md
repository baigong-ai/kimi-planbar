# kimi-planbar

[English](README.md)

[Kimi Code](https://www.kimi.com/code/) CLI 的套餐额度显示组件：包含 **TUI 状态栏脚本**和 **web 界面额度徽章**两部分，让 Kimi For Coding 用户随时看到套餐还剩多少。

> 本项目基于 [cc-planbar](https://github.com/baigong-ai/cc-planbar)（Claude Code 的额度状态栏组件）开发：provider 识别、额度接口逻辑、颜色阈值和缓存设计均参考自它；kimi-planbar 把这个思路移植到了 Kimi Code 自己的扩展点上。

显示内容：**权限模式（manual/auto/yolo）+ 模型 + thinking 级别 + 套餐额度**（5 小时窗口 / 周限额，含重置时间）。权限模式按危险程度变色（manual 绿 / auto 黄 / yolo 红）；额度按用量变色：绿 <60%，黄 60–84%，红 ≥85%。

TUI 状态栏效果：

```
auto | K3-256k | high | 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main
```

Web 界面效果：右上角悬浮徽章 —— `5h 15% (rst 03:44) · week 69% (rst 07/31 05:44)`，点击可手动刷新。

## 为什么做这个

Kimi Code 没有内置的常驻额度显示：TUI 里要用 `/usage` 命令才能查一次，web 界面（`/web` 或 `kimi web` 打开）则完全不调用额度接口。kimi-planbar 把这两个缺口都补上。

## 文件

| 文件 | 说明 | 安装到 |
|---|---|---|
| `quota-status.py` | TUI 状态栏命令（零依赖，纯标准库） | `~/.kimi-code/scripts/quota-status.py` |
| `kimi-web-quota.user.js` | web 界面油猴脚本 | 通过 Tampermonkey 浏览器扩展安装 |

## 第一部分：TUI 状态栏

Kimi Code 的 `[status_line].command`（在 `tui.toml` 里配置）会用自定义命令的输出替换底栏第一行。但命令**限 300ms 超时、1 秒节流**，同步发网络请求必然超时。所以 `quota-status.py` 渲染时只读本地缓存；缓存过期时派生一个后台子进程去拉取（网络请求 + 原子替换缓存），底栏永远不会被网络拖慢，失败时保留上一次成功的值。

### 安装

```bash
mkdir -p ~/.kimi-code/scripts
cp quota-status.py ~/.kimi-code/scripts/
chmod +x ~/.kimi-code/scripts/quota-status.py
```

然后编辑 `~/.kimi-code/tui.toml`，加上：

```toml
[status_line]
command = "~/.kimi-code/scripts/quota-status.py"
```

在 TUI 里运行 `/reload-tui`（或重启 Kimi Code）生效。

**Windows 用户注意**：`~` 不会被展开，且 `.py` 文件不能直接执行，command 要写成绝对路径并显式加 `python` 前缀：

```toml
[status_line]
command = "python C:/Users/<你的用户名>/.kimi-code/scripts/quota-status.py"
```

### 凭证从哪里来

无需任何配置。后台刷新进程按顺序读取：

1. `~/.kimi-code/credentials/kimi-code.json` 里的 OAuth access token（运行中的 CLI 会自动续期）
2. `~/.kimi-code/config.toml` 中 Kimi provider 的明文 `api_key`

然后请求 `GET https://api.kimi.com/coding/v1/usages`。

### 细节

- 状态栏各段（从左到右）：权限模式（快照 `permissionMode`，会话内切换实时反映）→ 模型名 → thinking 级别 → 额度 → 当前目录 → git 分支（快照 `gitBranch`）
- thinking 级别不在 stdin 快照里，脚本从 `~/.kimi-code/config.toml` 的 `[thinking]` 读取：`effort` → 当前模型的 `default_effort` 兜底；`enabled = false` 时显示 `off`。注意：它反映的是配置文件值，会话内未写回配置的临时切换不会体现
- 缓存文件：`~/.kimi-code/scripts/quota-cache`，TTL 5 分钟；刷新失败后 30 秒重试
- 排查快照 schema 时：设 `QUOTA_DEBUG=1` 后脚本会把最近一次 stdin 快照写到 `~/.kimi-code/scripts/last-stdin.json`（默认关闭，避免每秒一次磁盘写入）
- 月度额度：Kimi 接口的 `totalQuota` 字段有值时自动显示 `month X%`
- 颜色阈值想改：编辑 `quota-status.py` 里的 `col()` 函数

## 第二部分：Web 界面额度徽章

`kimi web` 启动的服务端其实提供了 `GET /api/v1/oauth/usage`（和 TUI 的 `/usage` 是同一份数据），但前端从不渲染它。`kimi-web-quota.user.js` 是一个 Tampermonkey 油猴脚本，往页面里注入一个悬浮额度徽章。

### 工作原理

- 从 localStorage 的 `kimi-web.server-credential` 读取 web UI 自己存的 bearer token
- 同源调用 `/api/v1/oauth/usage`，每 60 秒刷新
- 在页面右上角渲染一个小徽章，颜色阈值与终端版一致，点击立即刷新
- 页面上没有 credential 时直接退出，不影响其它本地网页

### 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 把 `kimi-web-quota.user.js` 拖进浏览器窗口，Tampermonkey 会弹出安装页；或在 Tampermonkey 面板新建脚本并粘贴文件内容
3. 打开 Kimi Code 的 web 界面（TUI 里 `/web`，或 `kimi web`），右上角即出现额度徽章

### 注意事项

- 脚本依赖 web UI 的两个内部实现：localStorage 键 `kimi-web.server-credential` 和接口 `/api/v1/oauth/usage`。Kimi Code 未来版本如果改动其中任何一个，徽章会显示 `quota ?`，届时更新脚本即可
- 徽章位置：徽章会自动锚定在聊天头部右侧按钮群（git/PR 按钮，或界面补丁加的 Files 按钮）的左边，按钮出现/消失时实时重算；在没有聊天头部的页面上回落到右上角。想强制改位置就编辑脚本里的 `placeBadge()`
- Kimi Code 默认只绑 127.0.0.1；脚本匹配 `http://127.0.0.1/*` 和 `http://localhost/*`，不限端口

## 已知问题（上游）：Kimi Code 会重写 `tui.toml`

这不是 kimi-planbar 能修的问题，但会直接影响状态栏，写在这里提醒大家（来自 [@shawn-0106t](https://github.com/shawn-0106t) 在 issue #1 中的反馈，Kimi Code 0.31.1 实测 100% 复现）：

**症状**：在 TUI 里用 `/theme` 切换主题，或 Kimi Code 版本升级后首次启动，Kimi Code 会把 `tui.toml` 整体重写为默认模板，`[status_line]` 配置被静默丢掉。坑在当前窗口靠内存中的配置照常显示，要等下次 `/reload-tui` 或重启才暴露，很难归因。

**建议**：

1. 改主题不要用 `/theme`——手动编辑 `tui.toml` 里的 `theme = "..."`，再 `/reload-tui`
2. 每次升级 Kimi Code 后，检查 `tui.toml` 里 `[status_line]` 还在不在
3. 丢了就用一条命令补回，然后 `/reload-tui`：

```bash
printf '\n[status_line]\ncommand = "~/.kimi-code/scripts/quota-status.py"\n' >> ~/.kimi-code/tui.toml
```

Windows 用户把 command 换成上面 Windows 版的写法。油猴徽章不受影响——它不读 `tui.toml`。

## 更新日志

### v1.1.5

- **油猴脚本**：徽章不再遮挡聊天头部自身的按钮。之前徽章写死 `top:8px; right:12px` 且 z-index 99999——正好是头部右侧按钮群的渲染位置（官方界面的 git/PR 按钮；kimi-web-files 等补丁界面的 Files 按钮），徽章直接盖在上面导致点不到。现在徽章会测量头部右侧按钮群的左边缘，自动锚定到按钮群左边（MutationObserver + resize 监听，rAF 节流，按钮出现/消失实时重算），并在头部内垂直居中。没有聊天头部的页面保持原来的右上角默认位

### v1.1.4

- **油猴脚本**：适配 Kimi Code v0.32——v0.32 给 web 服务的所有 REST 路由（含 `/api/v1/oauth/usage`）加了强制 bearer 鉴权，只认服务端启动时打印的 `#token=` 服务器令牌；v0.31 时代存下的旧凭证会被 401 拒绝，徽章显示 `quota ?`。修复：凭证读取扩展为 localStorage + sessionStorage 双来源、尊重 `expiresAt`（过期视为不存在）、401/403 时自动换另一来源的凭证重试
- **升级到 v0.32 后如果徽章显示 `quota ?`**：从 TUI 重新 `/web` 打开一次（或在登录页重新登录）——前端会把新的服务器凭证写进浏览器存储，徽章随即恢复

### v1.1.3

- **油猴脚本**：修复 light 模式对比度——旧配色写死深色主题（半透明黑底 + 浅色文字），在浅色页面上徽章底色变成中灰、浅文字糊成一片（对比度仅约 1.9:1）。现在每次刷新时按 body 计算背景亮度判断主题，light/dark 各一套配色（light 模式下主要文字对比度 4.7–14:1），切换主题即时生效

### v1.1.2

四个健壮性加固，同样来自 [@shawn-0106t](https://github.com/shawn-0106t) 在 issue #1 中的建议：

- **TUI 脚本**：5 小时窗口不再写死取 `limits[0]`，改为按 `window.duration=300 + timeUnit=TIME_UNIT_MINUTE` 匹配（找不到才回落到第一个窗口），接口顺序调整或新增窗口时不会拿错数据
- **TUI 脚本**：`last-stdin.json` 调试快照默认不再写盘（状态栏每秒渲染一次，之前等于每秒一次磁盘 I/O）；需要排查时设 `QUOTA_DEBUG=1` 开启
- **油猴脚本**：接口数据改用 DOM 节点 + `textContent` 渲染，不再拼 `innerHTML`，从机制上杜绝注入
- **油猴脚本**：每轮刷新前重新读 `localStorage` 的 token，凭证轮换后不用手动刷新页面

### v1.1.1

Windows 修复，来自 [@shawn-0106t](https://github.com/shawn-0106t) 的实测报告（issue #1）：

- **修复**：渲染路径超时——Windows 上 Python 启动本身就慢，顶层的 `urllib.request` / `subprocess` 导入把渲染推到 300ms 上限之外；两个导入改为延迟到后台刷新路径里，渲染降到 150–210ms
- **修复**：`UnicodeEncodeError`——快照里的 `cwd` 可能带孤立代理字符（CLI 对非 ASCII 路径的编码问题），`print()` 直接崩溃；现在渲染前把 stdout 重配为 UTF-8 + `errors='replace'`（顺带解决 Windows 管道默认本地代码页导致 `·` 乱码的问题）
- **文档**：Windows 安装说明——command 需用绝对路径 + 显式 `python` 前缀（`~` 不展开、`.py` 不可直接执行）
- 报告中的快照 schema 问题（`contextUsage` / `gitBranch`）已在 v1.1.0 修复，本次不重复合入

### v1.1.0

为什么改：v1.0.0 是按假设的 stdin 快照 schema 写的，装上真实环境后发现字段对不上——`model` 是纯字符串、git 分支叫 `gitBranch`、context 用量叫 `contextUsage`（0–1 小数），导致 Ctx 和分支段静默丢失。修 schema 的过程中，根据实际使用把状态栏重新设计为更实用的布局。

改成什么样：

- **修复**：按真实快照 schema 适配字段解析（`gitBranch`、模型字符串）
- **新增**：权限模式段，固定在最前，取自快照 `permissionMode`——`manual` 绿 / `auto` 黄 / `yolo` 红，会话内切换模式实时反映
- **新增**：thinking 级别段。快照里没有这个字段，脚本改为读 `~/.kimi-code/config.toml` 的 `[thinking]`（`effort`，缺省回落到当前模型的 `default_effort`；`enabled = false` 显示 `off`）
- **移除**：Ctx 百分比段（控制栏总长）；额度段去掉 `Kimi` 前缀

新布局示例：`auto | K3-256k | high | 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main`

### v1.0.0

首个版本：TUI 状态栏（缓存 + 后台刷新）+ web UI 油猴徽章。

## 适用范围

- 仅支持 Kimi For Coding 套餐（`api.kimi.com/coding`）。Claude Code + Kimi/智谱 GLM 的场景请用 [cc-planbar](https://github.com/baigong-ai/cc-planbar)
- 状态栏脚本需要 Python 3（纯标准库；推荐 3.11+，ISO 时间解析最宽容）

## 致谢

- [cc-planbar](https://github.com/baigong-ai/cc-planbar) — 本项目的基础：额度接口、provider 逻辑、颜色方案和缓存设计均来自它
- [Kimi Code](https://www.kimi.com/code/) — 提供 `[status_line].command` 扩展点和本地服务的 `/api/v1/oauth/usage` 接口
- [@shawn-0106t](https://github.com/shawn-0106t) — Windows 修复（v1.1.1）与四项健壮性加固（v1.1.2）的实测报告与建议

## License

MIT
