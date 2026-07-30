# kimi-planbar

[English](README.md)

[Kimi Code](https://www.kimi.com/code/) CLI 的套餐额度显示组件：包含 **TUI 状态栏脚本**和 **web 界面额度徽章**两部分，让 Kimi For Coding 用户随时看到套餐还剩多少。

> 本项目基于 [cc-planbar](https://github.com/baigong-ai/cc-planbar)（Claude Code 的额度状态栏组件）开发：provider 识别、额度接口逻辑、颜色阈值和缓存设计均参考自它；kimi-planbar 把这个思路移植到了 Kimi Code 自己的扩展点上。

显示内容：**Context 使用百分比 + 套餐额度**（5 小时窗口 / 周限额，含重置时间），按用量变色：绿 <60%，黄 60–84%，红 ≥85%。

TUI 状态栏效果：

```
k3-256k | Ctx 24.0% | Kimi 5h 15% (rst 03:44) · week 69% (rst 07/31 05:44) | ~/code/proj | main
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

### 凭证从哪里来

无需任何配置。后台刷新进程按顺序读取：

1. `~/.kimi-code/credentials/kimi-code.json` 里的 OAuth access token（运行中的 CLI 会自动续期）
2. `~/.kimi-code/config.toml` 中 Kimi provider 的明文 `api_key`

然后请求 `GET https://api.kimi.com/coding/v1/usages`。

### 细节

- 缓存文件：`~/.kimi-code/scripts/quota-cache`，TTL 5 分钟；刷新失败后 30 秒重试
- Kimi Code 传入的最近一次 stdin 快照保存在 `~/.kimi-code/scripts/last-stdin.json`，方便排查
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
- 徽章位置：如果与其它 UI 重叠，改脚本里的 `top:8px; right:12px`
- Kimi Code 默认只绑 127.0.0.1；脚本匹配 `http://127.0.0.1/*` 和 `http://localhost/*`，不限端口

## 适用范围

- 仅支持 Kimi For Coding 套餐（`api.kimi.com/coding`）。Claude Code + Kimi/智谱 GLM 的场景请用 [cc-planbar](https://github.com/baigong-ai/cc-planbar)
- 状态栏脚本需要 Python 3（纯标准库；推荐 3.11+，ISO 时间解析最宽容）

## 致谢

- [cc-planbar](https://github.com/baigong-ai/cc-planbar) — 本项目的基础：额度接口、provider 逻辑、颜色方案和缓存设计均来自它
- [Kimi Code](https://www.kimi.com/code/) — 提供 `[status_line].command` 扩展点和本地服务的 `/api/v1/oauth/usage` 接口

## License

MIT
