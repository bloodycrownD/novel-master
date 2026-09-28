# scripts/

仓库级开发 / 调试 / 发版工具（手动执行，不进 CI）。除 `e2e/`（自带 package.json）外均为零依赖脚本，直接用 node / powershell 跑。

## device/ — 真机取证与操控（adb）

| 文件 | 用途 |
| --- | --- |
| `dump-ui.mjs` | 解析 `uiautomator dump` 的 XML，打成「文字 \| 坐标 \| 类名 \| 可点」清单（FLAG_SECURE 窗口截不了图时的替代取证） |
| `uidump.mjs` | uiautomator dump 的一键封装 |
| `cap.bat` | adb 截图快捷方式 |
| `p0-watch.mjs` | 库文件轮询取证（mtime/size 变化，判「冷启动是否白跑全库重写」；注意 ls 输出行尾 \r 要 trim） |
| `verify-device-db.mjs` | 拉回的真机库查形态 / byte_len / KKV 标记 / 与迁移前副本逐哈希比对 |
| `dbinspect.mjs` / `dbinspect2.mjs` | 库直查工具（后者为演进版） |

## build-release-apk.ps1 — 真 release 出包配方

本地出「CI 等价」的 release 验证包（assembleRelease + debug keystore 注入）。与内嵌 debug 壳配方（已证伪：见 RULE 出包条目）的关键差别：**不改 MainApplication、全 release 原生配置**，是验证生产 bundle 启动问题的唯一可信形态。keystore 路径必须传**绝对路径**（相对路径会被 gradle 解析到 daemon 目录）。签名注入：`-Pandroid.injected.signing.store.file=<绝对路径> -Pandroid.injected.signing.store.password=android -Pandroid.injected.signing.key.alias=androiddebugkey -Pandroid.injected.signing.key.password=android`，产物按 ABI 分包在 `outputs/apk/release/`。

## bundle-debug/ — 生产 bundle 崩溃排查

`search-bundle.mjs`：在打出的 bundle（hermes 字节码）里搜字符串常量并带上下文打印；`extract-mods.mjs`：按 metro 模块号提取 `__d(function…},<id>,[deps])` 函数体片段。2026-09-28 定位「Got unexpected undefined」崩溃时的工具（用法与结论见 `docs/apm/memory/20260927-worktree-123-verify-guide.md`）。

## measurements/ — VFS pack（Part B）测量组

binary-blob-and-vfs-pack spec Part B（VFS 版本链打包，已拍板留待办、方案待优化）的实测脚本与参照输出：`vfs-pack-measure*`（收益口径按 content_hash 去重——RULE「体积/收益类结论必须按内容哈希去重统计」的出处）、`dict-*`（字典链 vs pack 对比）。将来优化 Part B 方案时先复测这组基线。

## mcp-search.ps1 — 智谱 MCP 手调客户端

走 Streamable HTTP 会话制（initialize → notifications/initialized → 带 Mcp-Session-Id 头调 tools/call）；key 运行时从本机 ZCode config 读，脚本零密钥。

## mock-openai-server.mjs

（既有）E2E 用的 mock OpenAI 服务。

## CDP 调试三件套（2026-09-28 收编自 `D:\Dev\nm-worktree`）

背景：chrome://inspect 走 metro inspector proxy，它强制 Origin 白名单（localhost/127.0.0.1/0.0.0.0/[::]），而 Node 内置 WebSocket 设不了 Origin header，所以手搓了最小 RFC6455 客户端。探针结果只能靠注入侧 global 状态 + 两段独立连接读取（后台期间 CDP 可能断连，重连不影响 app 侧数据）。

| 文件 | 角色 |
| --- | --- |
| `cdp-ws-client.mjs` | 库：最小 WebSocket 客户端（自定义 Origin），被下面两个复用 |
| `cdp-bg-timer-probe.mjs` | 后台 timer 停摆探针（background-run-continuity spec §4 门禁） |
| `cdp-probe-clear.mjs` | 清理探针注入的打点 |

用法（wsUrl 从 metro inspector 列表 `http://localhost:8081/json` 取目标页的 `webSocketDebuggerUrl`；真机需先 `adb reverse tcp:8081 tcp:8081`）：

```
node scripts/cdp-bg-timer-probe.mjs setup <wsUrl>   # 注入 2s 周期打点，8s 后打印前台基线
node scripts/cdp-bg-timer-probe.mjs read   <wsUrl>   # 读累计 tick + 间隔分析（切后台再回前台后执行）
node scripts/cdp-probe-clear.mjs <wsUrl>              # 用完清理打点
```

判读：最大相邻间隔 ≈ 后台时长（45s+）→ 后台 timer 停摆实证成立；≈ 2s（周期本身）→ 未停摆。

## bump-version.mjs — 发版版本号 bump

```
node scripts/bump-version.mjs <新版本>    例：node scripts/bump-version.mjs 1.5.25
```

from 版本自动读 `apps/desktop/package.json`（发版双端同 bump；mobile / build.gradle 不同步会 SKIP 报警并退出码 1）。两个 package.json 走 utf8 文本替换（只动版本行）+ JSON 解析验证；**build.gradle 走 Buffer 字节级替换**——该文件含历史非法 UTF-8 字节，经 utf8 字符串读写会把乱码行洗成 U+FFFD。versionCode 不归它管（出包时 `gradle -PversionCode=` 传入）。

## worktree-force-clean.ps1 — 强删残留 worktree 目录

Windows 下 `git worktree remove` 常因 node_modules 深路径 / 句柄残留报「Directory not empty」。兜底法 = robocopy 空目录 `/MIR` 镜像清空目标 → 删残根 → `git worktree prune` 清元数据。

```
powershell -File scripts\worktree-force-clean.ps1 -Targets <dir1>,<dir2> [-Repo <repo-path>]
```

注意：`git worktree remove` 失败时元数据可能已注销、目录成孤儿——prune 只清元数据不清孤儿目录，孤儿要用本脚本删。

## rn-dev-prefs.xml — 模拟器 dev host 配置模板

模拟器默认 dev host `10.0.2.2:8081` 的 chunked 流会被破坏（bundle 下载 ProtocolException 白屏），要写入 `debug_http_host=localhost:8081` 走 adb reverse 通道：

```
adb -s emulator-5554 push scripts/rn-dev-prefs.xml /data/local/tmp/rn-dev-prefs.xml
adb -s emulator-5554 shell "run-as com.novelmaster sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/rn-dev-prefs.xml shared_prefs/com.novelmaster_preferences.xml'"
```

⚠️ 这是整文件覆盖——设备上若已有含其它键的 preferences 文件会被清掉（当时是干净模拟器直接整写；真机有真实 prefs 时要改成按键合并）。
