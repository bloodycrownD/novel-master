# scripts/

仓库级开发 / 调试 / 排障工具（**手动执行，不进 CI**，唯一例外见下）。全部零依赖或只用仓库已有 devDependency，直接 `node` / `powershell` 跑。

## 命名与代码约定（新增脚本必须遵守）

**命名**

- 文件名 = 动词-名词 kebab-case：`check-encoding`、`extract-mods`、`dump-ui`
- **禁止数字后缀**（`-2` / `-3`）。同一工具的演进版本用 `-v1` / `-v2` 并在文件头写清差异；当前基线要么不带后缀，要么在 README 指明哪个是现行版
- 一次性脚本（跑完即弃）进 `measurements/`，或在 README 对应段落标注「一次性」，不要散在根目录
- 不用 `.bat` 包 adb：里面必然硬编码设备序列号 / adb 绝对路径，换机即失效。要么写成参数化的 node 脚本（参考 `pull-nm-logs.mjs`），要么只在 README 里给一行命令
- 不要再用「P0 / 临时 / test」这类无语义代号当文件名（`p0-watch` 已改名 `watch-db-file`、`dict-window-test` 已改名 `dict-window-measure`）

**代码**

- ESM + `node:` 前缀：`import {readFileSync} from "node:fs"`；禁止 `require`
- 双引号、2 空格缩进（与 prettier 默认一致）。改完跑 `npx prettier --write --print-width 200 <files>`
- 可执行脚本首行 `#!/usr/bin/env node`
- **文件头注释必须包含：用途 / 用法 / 退出码**（范式见 `scan-spread-await-risk.mjs`）
- CLI：位置参数取实参，可选参数用 `--flag value`；缺参时打印用法并 `exit 2`
- 退出码：成功 `0`、业务判定失败 `1`、用法错误 `2`。门禁脚本必须能返回非 0
- 输出：人读信息走 `console.log`，错误走 `console.error`；不要静默吞异常
- 临时产物只写 `tmp/`（已 gitignore），用完删掉；不要在仓库根留 `*.log` / `*.png`

## 门禁类（被 `package.json` / git hook / CI 引用，改接口要同步调用方）

| 脚本 | 挂载点 | 作用 |
| --- | --- | --- |
| `check-encoding.mjs` | 根 `check:encoding` + `.githooks/pre-commit` + `ci.yml` | 三类编码问题（控制台/源码/暂存区 blob）分开报 |
| `check-ci-gates.mjs` | 根 `check:ci-gates` | 解析 `ci.yml`，校验门禁步登记表没漏项/没多登记（只解析 ci.yml，不覆盖 nightly） |
| `collect-check.mjs` | `packages/tdbc-driver-*`、`tokenizer-driver-node` 的 scripts | 校验测试「收集数非零」；现状断言在 `lib/zero-collect-guard.mjs` |
| `link-hooks.mjs` | 根 `prepare` | 装 `.githooks` 到 `.git/hooks` |

## 诊断 / 排障

| 脚本 | 用途 |
| --- | --- |
| `pull-nm-logs.mjs [日期\|--all] [--grep 词]` | 拉设备 `files/logs/nm-*.log`：debug 包走 `run-as`，release 包提示改用「设置 → 导出日志」；多设备时自动加 `-s`，可用 `ANDROID_SERIAL` 覆盖 |
| `scan-spread-await-risk.mjs [--selftest]` | 扫「对象字面量 ≥2 spread 且其中一个含 `await`」（Hermes#2068 静默丢字段）。退出码可当门用 |
| `symbols-inventory.mjs` | AST 函数清单（346 行），查「某符号还有没有调用方」用 |

## `device/` — 真机取证（adb）

| 文件 | 用途 |
| --- | --- |
| `dump-ui.mjs` | 解析 `uiautomator dump` 的 XML，打成「文字 \| 坐标 \| 类名 \| 可点」清单（FLAG_SECURE 窗口截不了图时的替代取证） |
| `uidump.mjs` | uiautomator dump 的一键封装 |
| `dbinspect.mjs` | 只读直查真机库：表清单、会话规模 TOP10、`role` 列存在性、长消息 TOP10 |
| `verify-device-db.mjs` | 拉回的真机库查形态 / byte_len / KKV 标记 / 与迁移前副本逐哈希比对 |
| `watch-db-file.mjs` | 库文件轮询取证（mtime/size 变化，判「冷启动是否白跑全库重写」；注意 `ls` 输出行尾 `\r` 要 trim） |

截图直接 `adb exec-out screencap -p > tmp/shot.png`（原 `cap.bat` 因硬编码设备序列号已删）。

## `bundle-debug/` — 生产 bundle 崩溃排查

| 文件 | 用法 |
| --- | --- |
| `search-bundle.mjs <needle> [bundlePath]` | 在打出的 bundle 里搜字符串常量并打印命中点上下文；未命中退出码 1 |
| `extract-mods.mjs <id> [<id> …] [--bundle <path>]` | 按 metro 模块号提取 `__d(function…},<id>,[deps])` 片段（崩溃栈 `anonymous@594:5900` 的「行号」就是模块号） |

默认 bundle 路径 `apps/mobile/android/app/src/main/assets/index.android.bundle`。首次用于 2026-09-28 定位「Got unexpected undefined」，结论见 `docs/apm/memory/20260927-worktree-123-verify-guide.md`。

## `measurements/` — VFS pack（Part B）测量组

binary-blob-and-vfs-pack spec Part B（已拍板留待办、方案待优化）的实测脚本与参照输出：

- `vfs-pack-measure-v1/v2/v3.mjs` + 同名 `.out.txt`：演进三代（v2 按 `content_hash` 去重——RULE「体积/收益类结论必须按内容哈希去重统计」的出处；v3 改用 `LENGTH(bytes)` 并统计 `byte_len` 写法约定）
- `dict-*`：字典链 vs pack 对比（`dict-window-measure.mjs` 验证「字典只用靠后窗口」的假设）

**将来优化 Part B 方案时先复测这组基线**，不要删。

## `lib/`

- `workflow-gate.mjs`：动态工作流里的门禁执行封装（exit code + 增量判据）
- `zero-collect-guard.mjs`：`collect-check.mjs` 的断言实现

## `build-release-apk.ps1` — 真 release 出包配方

本地出「CI 等价」的 release 验证包（`assembleRelease` + debug keystore 注入）。与内嵌 debug 壳配方（已证伪：见 RULE 出包条目）的关键差别：**不改 MainApplication、全 release 原生配置**，是验证生产 bundle 启动问题的唯一可信形态。

- keystore 路径必须传**绝对路径**（相对路径会被 gradle 解析到 daemon 目录）
- 签名注入：`-Pandroid.injected.signing.store.file=<绝对路径> -Pandroid.injected.signing.store.password=android -Pandroid.injected.signing.key.alias=androiddebugkey -Pandroid.injected.signing.key.password=android`
- 产物按 ABI 分包在 `outputs/apk/release/`

## `mcp-search.ps1` — 智谱 MCP 手调客户端

走 Streamable HTTP 会话制（`initialize` → `notifications/initialized` → 带 `Mcp-Session-Id` 头调 `tools/call`）；key 运行时从本机 ZCode config 读，脚本零密钥。

## CDP 调试三件套（2026-09-28 收编自 `D:\Dev\nm-worktree`）

背景：`chrome://inspect` 走 metro inspector proxy，它强制 Origin 白名单（localhost/127.0.0.1/0.0.0.0/[::]），而 Node 内置 WebSocket 设不了 Origin header，所以手搓了最小 RFC6455 客户端。探针结果只能靠注入侧 global 状态 + 两段独立连接读取（后台期间 CDP 可能断连，重连不影响 app 侧数据）。

| 文件 | 角色 |
| --- | --- |
| `cdp-ws-client.mjs` | 库：最小 WebSocket 客户端（自定义 Origin），被下面两个复用 |
| `cdp-bg-timer-probe.mjs` | 后台 timer 停摆探针（background-run-continuity spec §4 门禁） |
| `cdp-probe-clear.mjs` | 清理探针注入的打点 |

用法（`wsUrl` 从 `http://localhost:8081/json` 取目标页的 `webSocketDebuggerUrl`；真机需先 `adb reverse tcp:8081 tcp:8081`）：

```
node scripts/cdp-bg-timer-probe.mjs setup <wsUrl>   # 注入 2s 周期打点，8s 后打印前台基线
node scripts/cdp-bg-timer-probe.mjs read   <wsUrl>   # 读累计 tick + 间隔分析（切后台再回前台后执行）
node scripts/cdp-probe-clear.mjs <wsUrl>              # 用完清理打点
```

判读：最大相邻间隔 ≈ 后台时长（45s+）→ 后台 timer 停摆实证成立；≈ 2s（周期本身）→ 未停摆。

## `worktree-force-clean.ps1` — 强删残留 worktree 目录

Windows 下 `git worktree remove` 常因 node_modules 深路径 / 句柄残留报「Directory not empty」。兜底法 = robocopy 空目录 `/MIR` 镜像清空目标 → 删残根 → `git worktree prune` 清元数据。

```
powershell -File scripts\worktree-force-clean.ps1 -Targets <dir1>,<dir2> [-Repo <repo-path>]
```

注意：`git worktree remove` 失败时元数据可能已注销、目录成孤儿——prune 只清元数据不清孤儿目录，孤儿要用本脚本删。从 bash 调时 `-Targets a,b` 会被 PowerShell 当成单个路径，必须用数组语法 `-Targets @('D:\a','D:\b')`。
