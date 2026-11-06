---
name: logger-normalization
status: draft
created: 2026-11-07
branch: main
worktree: D:/Dev/Js/novel-master-tokfix
---

# 日志规范化 SPEC（core LogSink 端口 + 三端落盘 + 崩溃钩子 + 导出）

> **实施位置**：本迭代全部改动在 worktree `D:/Dev/Js/novel-master-tokfix`（分支 `main`）内进行；主仓库 `D:\Dev\Js\novel-master` 不含本 spec。下文所有路径都相对该 worktree 根。

## 1. 背景

core 至今**没有任何日志设施**。`packages/core/src` 下 29 个文件里散着 **59 处裸 `console.*` 调用**（`console.warn` 37 / `console.error` 9 / `console.log` 8 / `console.debug` 5），三端各写各的（mobile `src` 52 处、CLI 64 处、desktop `src` 20 处）。这套现状有四个具体后果：

1. **排查时拿不到日志**。上一次排查切模型卡顿，华为设备 logcat 里没有 `ReactNativeJS`、Metro client-logs 也是空的，只能临时往应用私有目录 append 一个文件、再 `run-as cat` 读出来——**用户自己没有任何途径把崩溃现场交给我们**。
2. **日志去哪由平台决定，不由代码决定**。同一行 `console.warn` 在 CLI 打到终端、在 Electron main 打到终端（打包后用户根本看不见）、在 RN 打到 logcat（release 下同样看不见）。
3. **没有分级、没有 scope、没有结构化 detail**。`console.warn("...", error)` 把整个 Error 对象抛给 console，既不可过滤也不可聚合；`debug-fetch.ts` 自己造了一套 `redactUrl` / `redactHeaders` / `summarizeBody`，其它 20 多个文件裸奔。
4. **反面教材已经出现**：`apps/desktop/src/main/log/desktop-log.ts:21-52` 是三个只有一行 `console.*` 的薄壳（`desktopLog` / `desktopLogWarn` / `desktopLogError`），不落盘、不分级、`isDesktopLlmDebug` 与日志级别无关地混在同一个文件里，4 个消费方把它当唯一日志入口用。

**这不是「加一个 logger 库」，是边界问题。** 与本仓已拍板过三次的同一类问题同构：`errors/either.ts` 只出 Result 类型 + 序列化契约、`common/i18n.ts` 只出 `createTranslator` 运行时（catalog 由调用方从 JSON 加载，core 零业务文案）、`tokenizer-driver-*` 只出 port + 双 driver（资产与平台能力都在 driver 侧）。**日志的 port 与脱敏契约归 core，落盘/导出/崩溃钩子归各自平台。**

### 1.1 计数口径（本文所有「处数」都按这个口径）

```
git grep -n -E "console\.(log|info|warn|error|debug|trace)\s*\(" -- <path>
```

即**只统计调用点**，注释/文档里出现的 `console.warn` 字样不计入。裸匹配（不带 `\s*\(`）得到的 66 / 54 / 21 三个数字分别含 7 / 2 / 1 处注释，**以本节口径的 59 / 52 / 20 为准**。守卫测试（C1 / E6 / F4）必须用同一口径，否则会把注释算成命中。

## 2. 目标与非目标

### 目标

- **G1** core 新增 `LogSink` 端口 + `createLogger(scope)`，分级（debug/info/warn/error）、scope、结构化 detail、`child(scope)`；内置 console sink 保证默认输出不断流，并允许端上**替换或关闭**它（CLI 靠这条把 core 日志挪出 stdout，见 4.7）
- **G2** 59 处 core 裸 console 调用全部收口，并由**守卫测试**保证「core 的 `src/**` 里不再出现裸 console 调用」（console sink 自身除外）
- **G3** 端上启动时注入文件 sink：mobile 落 `<filesDir>/logs`（按天切、单文件 2MB、留 5 份）、desktop 落 `app.getPath('logs')`、CLI 落 stderr + 可选 `--log-file`
- **G4** 崩溃可留痕：mobile JS 侧 `ErrorUtils.setGlobalHandler` + Kotlin 侧 `Thread.setDefaultUncaughtExceptionHandler`，两侧写同一个日志目录
- **G5** 用户能自己导出日志：mobile 设置页「导出诊断日志」（复用已有 `react-native-blob-util` + `@react-native-documents/picker`）、desktop 菜单「打开日志目录」与「导出诊断包」
- **G6** **脱敏是硬要求**：key 黑名单 + 正文键只记 `{chars, hash}` + 深度/长度/条数三重截断，**在 core emit 时统一执行**，任何 sink（含未来新增的 IPC sink）都拿不到原文
- **G7** 不引新依赖；不改变现有对外行为与错误语义

### 非目标

- **不动 CLI 的 64 处裸 console（53 `console.log` + 11 `console.error`）**：CLI 的 stdout 是**数据通道**（`agent/registry-commands.ts:74` 注释原文「与 `nm session create` 同口径：stdout 只出 id」），把结果打印改成 logger 会让脚本解析全部失效。CLI 只做「core 日志 + CLI 自身诊断落到 stderr/文件」，见 4.7
- **不动 desktop renderer 的 7 处 console**（4 文件）：renderer 是 sandbox，拿到文件 sink 需要新增 IPC 转发通道，与本次「先让端上有日志」的正交
- **不动 mobile WebView 内的 2 处**（`src/web/chat-transcript/webview/main.ts`、`.../ui/render/ToolGroup.tsx` 各 1 处）：它们跑在 WebView 的 JS 上下文里，够不到 RN 的 sink。**这两处要从 T5 的 50 处里排除**
- **不做日志 UI 查看器**（应用内浏览日志文件）——本次只做「落盘 + 导出」
- **不做远程上报**（云同步不接管日志）
- **不改 `SimpleEventBus` 的 `onHandlerError` 对外签名**（只把默认实现的 console 换成 logger）

## 3. 现状证据（探索结论摘要）

### 3.1 core 侧

| 事实 | 证据 |
|---|---|
| core 无任何日志模块 | `packages/core/src/infra/` 下 16 个条目，无 `log`（`cloud-sync` / `content-cache` / `date-format.ts` / `db-backup` / `db-maintenance` / `events` / `kkv-value-codec.ts` / `llm-protocol` / `nmtp` / `prompt-template` / `random-uuid.ts` / `serialization` / `sksp` / `sql-template` / `tdbc` / `tokenizer`） |
| 59 处调用点 / 29 文件（口径见 1.1） | `warn` 37 / `error` 9 / `log` 8 / `debug` 5；按文件逐条见 §8 的 scope 表 |
| 已有脱敏只覆盖 LLM HTTP 一处 | `debug-fetch.ts:29-39`（`redactUrl`）、`:41-71`（`redactHeaders`）、`:73-115`（`summarizeBody`）；公共出口只转出 `createLoggingFetch` / `isLlmFetchDebugEnabled`（`public/provider.ts:125-126`） |
| ⚠️ `summarizeBody` 的非 JSON 兜底会吐原文 | `debug-fetch.ts:110-112`：`catch { return truncateText(body, 400); }` —— 请求体不是 JSON 时把前 400 字**原始 body** 当摘要返回，本次必须一并改掉（见 4.3 ④） |
| 已有「本进程只提示一次」的降级日志范式 | `zlib-accelerator.ts:87,107` |
| 已有轻量哈希（双 FNV-1a → 16 hex） | `token-chunk-cache.ts:100-116`（`FNV_*` 常量 + `fastHash16`）与 `:125-127`（`chunkHash16`，注释声明 16 hex 是 public 键形态契约） |
| 「infra 子路径直出 dist」已有三个先例 | `packages/core/package.json` 的 `"./nmtp"` / `"./sksp"` / `"./tdbc"` 均直接指向 `dist/infra/*/index.js`，**不过 `public/`、不进 allowlist 快照** |
| ⚠️ core 的 exports 只有 `types` + `import` 两个条件 | `packages/core/package.json:8-80`。Node（ESM）与 Metro（`isESMImport=true`）能解析，**Jest 不能**——见 3.5 |

### 3.2 mobile 侧

| 事实 | 证据 |
|---|---|
| 52 处调用点 / 21 文件（含 WebView 2 处） | top：`chat-prompt-tokens.service.ts` 10、`session-stream-unit-manager.service.ts` 10、`debug/run-timing.ts` 5、`session-prompt-input.service.ts` 5、`session-stream-unit.ts` 5 |
| 其中 2 处跑在 WebView 上下文 | `src/web/chat-transcript/webview/main.ts`、`src/web/chat-transcript/webview/ui/render/ToolGroup.tsx`（各 1 处）。**排除后待收口 = 50 处 / 19 文件** |
| 依赖已在位，无需新增 | `apps/mobile/package.json`：`react-native-blob-util@^0.22.2`、`@react-native-documents/picker@^12.0.1` |
| blob-util 的 fs API 覆盖落盘需求 | `node_modules/react-native-blob-util/index.d.ts`：`appendFile` / `exists` / `stat` / `ls` / `mkdir` / `unlink` / `cp` |
| Android 的 `DocumentDir` 就是 files 目录 | `apps/mobile/src/db/db-file-path.ts:15-22` 注释「也就是 files 目录（react-native-blob-util 的 DocumentDir）」，并用 `base.endsWith('/files')` 判据 |
| 已有统一的导出编排（临时文件 → saveDocuments → 清理） | `apps/mobile/src/services/document-io.ts:51-77`（`exportBytesViaDocumentPicker`） |
| 已有 blob-util 单点封装 | `apps/mobile/src/services/rn-file-io.ts:40-50`（`blobFs()`） |
| 已有 UTF-8 字节长度工具（core/common） | `packages/core/src/common/index.ts` 转出 `utf8ByteLength` |
| Jest 的 blob-util stub 里 `MOCK_DIRS.DocumentDir = '/documents'` | `apps/mobile/test-utils/react-native-blob-util-mock.ts:11-17`；`fs.appendFile` / `ls` / `stat` 都是 `jest.fn()`（默认返回 `undefined`），测试必须自己给返回值 |
| 入口是 `index.js`，`AppRegistry` 之前只有 4 条 import | `apps/mobile/index.js:5-13` |
| ⚠️ 已有 console spy 测试会被收口打破 | `__tests__/cloud-sync-progress-log.test.ts:44-47`（断言 `warnSpy.mock.calls[i][1] === 'storage_put_start'`、`[2]` 是 detail，源 `cloud-sync-progress-log.ts:66`）；`__tests__/chat-transcript-telemetry.test.ts:37-41`（断言 `console.info('[ChatTranscriptTelemetry]', 'scroll_restore', object)`，源 `chat-transcript-telemetry.ts:51`） |

### 3.3 desktop 侧

| 事实 | 证据 |
|---|---|
| 20 处调用点 / 9 文件，其中 6 处在被点名的反面教材里 | `src/main/log/desktop-log.ts`（6，三个薄壳）→ 余下 `main.ts` 5、`ipc/handlers/vfs.ts` 2、`services/chat-prompt-tokens.service.ts` 2、`ipc/handlers/cloud-sync.ts` 1、`ipc/handlers/physical.ts` 1、`services/db-backup.service.ts` 1、`services/vfs-batch.service.ts` 1、`shell-menu.ts` 1 —— **退役 desktop-log 后待收口 = 14 处 / 8 文件** |
| `desktop-log.ts` 有 4 个消费方（5 个 import 点） | `ipc/forward-event-bus.ts:18`、`ipc/handlers/agent.ts:44`、`runtime/setup-llm-fetch.ts:8`、`services/agent-run.service.ts:10-14` |
| Electron 有现成的 logs 目录 | `electron.d.ts` app.getPath 文档：「If `app.getPath('logs')` is called without called `app.setAppLogsPath()` … a default log directory will be created」 |
| 菜单在 `shell-menu.ts`，已有 `dialog` / `shell` 可用 | `shell-menu.ts:4` import `{ app, BrowserWindow, Menu, dialog }`；`main.ts:4` 已 import `shell` |
| ⚠️ `buildApplicationMenu()` 返回 `Menu`，template 是函数内局部 `const` | `shell-menu.ts:28-29`（`const template`）、`:89-90`（`Menu.buildFromTemplate` → `return appMenu`）。**F3 不能直接断言 template**，得先把 template 构建抽成可导出纯函数（见 4.6） |
| 测试 stub **没有** `Menu` / `shell`，且 `getPath` 只认真 userData | `apps/desktop/test/electron-stub.mjs`：`dialog` / `BrowserWindow` / `app.getPath(name)`（`userData` 才有专属值，其余一律 `/tmp`）/ `nativeImage` |
| 已有「seams 注入 + `__setXxxSeamsForTests`」的 handler 测试范式 | `apps/desktop/src/main/ipc/handlers/app-info.ts:14-70` |

### 3.4 CLI 侧

| 事实 | 证据 |
|---|---|
| 64 处调用点 / 22 文件（53 `console.log` + 11 `console.error`），**`console.log` 全是给用户/脚本的结果输出** | `agent/registry-commands.ts:74` 注释「stdout 只出 id」；`vfs/commands/glob.ts`、`grep.ts`、`list.ts:18`、`session/commands.ts:59` 全是结果行 |
| `console.error` 是诊断/错误通道（已落 stderr） | `main.ts:86,102,112,134,182`、`prompt/commands.ts:183,190,209` |
| **没有 `--verbose`** | `git grep -- "--verbose" -- apps/cli/src` 零命中；`vfs list` 自身不产生任何 core 日志（`vfs/commands/list.ts:4-19` 只 `console.log` 结果） |
| 已有全局参数剥离的后例可参照 | `apps/cli/src/vfs/parse-args.ts:50-68`（`extractDbPath` 从 argv 摘参数并返回 `rest`） |
| CLI 测试运行器一次跑全 `test/`，不支持点名单文件 | `apps/cli/scripts/run-tests.mjs`（递归收集 `test/**/*.test.ts`，收集 0 条直接 exit 1） |

### 3.5 构建与门控（含 Jest 解析陷阱）

| 事实 | 证据 |
|---|---|
| `@novel-master/core/log` 这类子路径消费方走 `exports` 解析 | desktop/cli 用 `moduleResolution: NodeNext`（`tsconfig.base.json`），mobile 用 `bundler`；三端都读 `packages/core/package.json` 的 `exports` |
| **Metro 能解析**（`import` 条件在位） | `node_modules/metro-resolver/src/utils/matchSubpathFromExportsLike.js:16-23` 的条件集恒含 `default` + `isESMImport ? "import" : "require"` + `unstable_conditionNames`；RN app 源码是 ESM `import` → 命中 `import` |
| **Jest 解析不了未显式映射的 core 子路径** | RN preset `node_modules/@react-native/jest-preset/jest/react-native-env.js:16`：`customExportConditions = ['require', 'react-native']`；`node_modules/jest-resolve/build/defaultResolver.js:225-231` 在传了 conditions 时用 `unsafe: true`。实测：`resolve.exports.resolve(pkg, './common', { conditions: ['require','react-native'], unsafe: true })` → **抛 `No known conditions for "./common" specifier`**（`./log` 在补 exports 之前是 `Missing "./log" specifier`）。这正是 `apps/mobile/jest.config.js` 要把 23 个 core 子路径逐个映射到 dist 真实文件的原因 |
| `apps/mobile/jest.config.js` 现有 23 条 core 子路径映射，**无 `log`** | 映射键实测：`chat, common, regex, smart-sort-rule, agent, format, events, compaction, workplace, feature-flags, vfs, nmtp, sksp, kkv, skills, message-checkpoint, session-kkv, session-run-state, tdbc, stored-config-validity, session-fs, prompt, provider` |
| `packages/core/tsconfig.test.json` 的 paths 逐个列 core 子路径，**无 `/log`** | 已列 `@novel-master/core` / `common` / `agent` / … / `nmtp` / `sksp` / `tdbc` / `stored-config-validity` |
| Metro 已有「dist 陈旧就红」的 smoke 清单 | `apps/mobile/metro.config.js:12-35`（`coreDistSmokeFiles`，缺文件直接 throw 并提示 `npm run build -w @novel-master/core`） |
| core 测试递归收集 `test/**/*.test.ts` | `packages/core/scripts/run-tests.mjs` |
| 编码门禁扫描面包含 `.ts/.kt/.gradle`，**排除 `docs/Iterations/`** | `scripts/check-encoding.mjs` 文件头 ①② |
| ⚠️ 既有 console spy 测试会被 T2 打破 | `packages/core/test/agent/agent-runner.test.ts:1686-1690`（接管 `console.error`）、`:1746-1751`（断言 `tag === "[agent-runner] thinking_context_pref_read_failed"` 并读第二参 payload） |

### 3.6 既有 console 断言清单（收口必然打破）

`git grep -l "console\." -- packages/core/test apps/mobile/__tests__` 命中 **28** 个文件；另有 13 个文件是通过 `jest.spyOn(console, 'x')` / `mock.method(console, "log")` 取值的（`console,` 带逗号，上面的正则扫不到）。**判据不是「有没有摸 console」，而是「断言里有没有读参数」**：

- **不受影响**：只断言「被调用 / 调用次数 / 未被调用」的——内置 console sink 仍然会调 `console.*`，次数形态不变。
- **必须迁移**：断言**参数内容或位置参数**（`args[0]`、`tag`、`payload`、`.join(' ')`、`mock.calls[i][1]`、`toHaveBeenCalledWith(...)`）的——收口后参数形态变成 `(message, detail)` 且已脱敏。

**必改：core 14 个**

| 文件 | 现在断言什么（可复现的行号） |
|---|---|
| `agent/agent-runner.test.ts` | `:1688-1689` 捕获 `(tag, payload)`，`:1747-1748` 断言 `tag === "[agent-runner] …"` 并读 payload |
| `compaction-conditions/run-compaction.test.ts` | `:367` `String(args[0]).includes("runCompaction")` |
| `vfs/bootstrap.test.ts` | `:82` `typeof a === "string" && a.includes("vfs-entry-sequence-repair")` |
| `vfs/vfs-import-shard.test.ts` | `:245,262` 拼接 args 后 `includes("import compensation failed")` |
| `vfs/vfs-zip-io.test.ts` | `:936` `assert.match(String(warnCalls[0][0]), /directory=…/)` |
| `vfs/zlib-accelerator.test.ts` | `:173-223` `warnings.some(line => line.includes("deflate 加速器抛错"))` 等 6 处 |
| `infra/llm-protocol/sse-parse-errors.test.ts` | `:47` `assert.match(warns[0], /malformed JSON line/)` |
| `infra/llm-protocol/debug-fetch.test.ts` | `:73-76` 捕获并 join 全部 args，随后断言输出内容 |
| `infra/llm-protocol/llm-stream-timeout.test.ts` | `:550,621` `logMock.mock.calls.find(...)` 读内容 |
| `infra/tokenizer/incremental-token-counter.test.ts` | `:207-208` `assert.match(warnings[0], /不可编码 17 字符/)`、`/1:1 兜底计入/` |
| `message-checkpoint/backfill-transaction-scope.test.ts` | `:212,286` `String(w[0]).includes("ensureImportDirRules")` 等 |
| `character-card/character-card-import.test.ts` | `:494` `assert.match(String(warnCalls[0][0]), /directory=…/)` |
| `service/agent/run-agent-turn-subagent-stream.test.ts` | `:331-337` 过滤 `e.tag === "[agent-run] subagentStream pref read failed"` |
| `vfs/clear-session-prompt-caches.test.ts` | `:98-106` 捕获 warn（若只断言次数可不动，落地时确认一次） |

**必改：mobile 7 个**

| 文件 | 现在断言什么 |
|---|---|
| `cloud-sync-progress-log.test.ts` | `:44-47` `warnSpy.mock.calls[i][1] === 'storage_put_start'`、`[2]` 是 detail |
| `chat-transcript-telemetry.test.ts` | `:37-41` `console.info('[ChatTranscriptTelemetry]', 'scroll_restore', object)` |
| `rollback-probe-timing.test.ts` | `:40,101,130` `logSpy.mock.calls.map(call => String(call[0]))` |
| `chat-transcript-snapshot-bytes.test.tsx` | `:404-420` 用 `logSpy` 断言回滚轴打点行（打点源是 `src/debug/run-timing.ts` 的 `resetRollbackTiming` / `rollbackTimingLog`） |
| `llm-native-fetch-shim.test.ts` | `:369` `warnSpy.mock.calls.some(call => call.join(' ').includes('streaming may fail on RN'))`（源是 core `debug-fetch.ts:183`） |
| `chat-composer-draft.test.ts` | `:364` `expect(warnSpy).toHaveBeenCalledWith(...)` |
| `theme-provider-persist.test.tsx` | `:77` `expect(warnSpy).toHaveBeenCalledWith(...)` |

**不用动**（只静音或只断言次数）：`count-text-with-tokenizer`、`prompt-whole-cache`、`resolve-current-prompt-tokens`、`token-chunk-cache`、`vfs-batch-io`（`:496` 只断言 `warnCalls.length >= 1`）、`ensure-import-dir-rules`、`app-ui-pref-io`（`:137` 只 `toHaveBeenCalled()`）、`chat-prompt-tokens`（`:717,773` 只 `not.toHaveBeenCalled()`）、`connection`、`session-stream-unit-persist`（无断言）、`mobile-prompt-token-counter`（断言的是 tokenizer 驱动的 `[nm-tok-js]` 日志，本轮不收编该包）。

**测试侧的捕获范式**（不新增 test-only 导出，靠 A5 的公开 API）：

```ts
const records: LogRecord[] = [];
setDefaultLogSink({write: (r) => records.push(r)});   // 替换内置 console sink
// ...断言 records[i].message / .detail / .level...
restoreDefaultLogSink();                              // afterEach 恢复
```

（sink 是进程级全局状态：`node --test` 每个测试文件独立进程、Jest 每个文件独立模块注册表，所以跨文件不会串；但同文件内必须 `afterEach` 恢复。）

## 4. 设计方案

### 4.1 分层

```
core（跨平台契约 + 纯逻辑）
├── LogSink 端口 / LogRecord / LogLevel
├── createLogger(scope) + child(scope)
├── addLogSink(sink)          追加 sink（文件 sink 走这条）
├── setDefaultLogSink(sink|null)  替换/关闭内置 console sink（CLI 走这条）
├── 脱敏（key 黑名单 / 正文键 → {chars,hash} / 三重截断）
├── describeText(text) → { chars, hash }   公开 API
├── planLogFileWrite(...)      纯轮转策略（按天切 / 2MB / 留 5 份 / 自定义 baseName）
└── 内置 console sink（默认安装）

mobile driver（apps/mobile）
├── services/log-sink.mobile.ts   blob-util 落 <filesDir>/logs
├── services/log-export.ts        合并成单文件 → document picker
├── index.js                      installLogSink() + ErrorUtils 钩子
└── log/NmLogCrashHandler.kt      Thread.setDefaultUncaughtExceptionHandler

desktop driver（apps/desktop/src/main）
├── log/desktop-log-sink.ts       node:fs 落 app.getPath('logs')
├── log/desktop-diagnostics.ts    打开日志目录 / 导出诊断包（seams 注入）
└── shell-menu.ts                 两个菜单项（template 构建抽出为纯函数）

CLI driver（apps/cli）
└── log/cli-log-sink.ts           stderr + 可选 --log-file
```

**核心原则**：core 决定「记什么、怎么脱敏、怎么轮转」；端上只决定「写到哪」。三端注入的文件 sink 共用 core 的 `planLogFileWrite`，不各写一份轮转。

### 4.2 core：LogSink 端口与 createLogger

新目录 `packages/core/src/infra/log/`：

```ts
// log-record.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

/** 已脱敏的结构化 detail：只含 JSON 安全值。 */
export type LogDetail = Readonly<Record<string, unknown>>;

export interface LogRecord {
    readonly ts: number;          // epoch ms
    readonly level: LogLevel;
    readonly scope: string;       // "agent.runner" / "vfs.zip-io"
    readonly message: string;     // 已截断（500 字符）
    readonly detail?: LogDetail;  // 已脱敏（见 4.3）
}

/** 落盘/转发端口的唯一约定：write 不得抛。 */
export interface LogSink {
    write(record: LogRecord): void;
}
```

```ts
// logger.ts
export interface Logger {
    readonly scope: string;
    debug(message: string, detail?: LogDetail): void;
    info(message: string, detail?: LogDetail): void;
    warn(message: string, detail?: LogDetail): void;
    error(message: string, detail?: LogDetail): void;
    child(scope: string): Logger;   // scope 拼接为 `${parent}.${child}`
}

export function createLogger(scope: string): Logger;
/** 追加一个 sink，返回摘除函数（与 EventSubscription 同构）。 */
export function addLogSink(sink: LogSink): () => void;
/** 替换内置 sink；传 null = 关掉内置输出（已追加的 sink 不受影响）。 */
export function setDefaultLogSink(sink: LogSink | null): void;
/** 恢复初始的内置 console sink（测试 afterEach / 端上撤掉自定义 sink 时用）。 */
export function restoreDefaultLogSink(): void;
```

**调用签名固定**：`log.warn(message, detail?)`，**detail 只接一个对象**。不提供 printf 风格、不提供 `log.error(err, msg)` 变体——错误统一进 detail（`{error: err}`），由脱敏层展开。

**两个 sink 入口的分工，以及为什么必须有两个**：

- `addLogSink` 只追加 → mobile / desktop 用它注入文件 sink，**内置 console sink 继续在**，于是 `npx react-native log-android` / Metro client-logs / Electron 终端这些今天还在用的通道不断流。
- `setDefaultLogSink` 换掉内置 sink → **CLI 用它把 core 日志从 stdout 挪走**。CLI 的 stdout 是数据通道（见 2.非目标），若保留内置 console sink，`debug-fetch.ts` 那 5 处 `console.log` 收口后仍会写 stdout，G2 就永远不成立。CLI 装自己的 sink 时调 `setDefaultLogSink(cliSink)`（而不是 `addLogSink`），内置 printf 通道随之中断。

**级别过滤在 sink 侧**：内置 console sink 不过滤（与今天 `console.debug` 无条件打印一致）；文件 sink 各自设 `minLevel`（mobile release `info` / `__DEV__` `debug`；desktop `info`、`NM_DEBUG_DESKTOP=1` 时 `debug`；CLI stderr 只收 `warn`/`error`，文件收全部）。

**sink 故障隔离**：`emit()` 内对每个 sink `try { sink.write(record) } catch { /* 吞掉 */ }`，并且用 `emitting` 标志防重入（sink 内部若又调 logger 不会无限递归）。**日志永远不能让业务抛错。**

### 4.3 脱敏（硬要求）

`packages/core/src/infra/log/sanitize-log.ts` 是**内部实现**（不导出、不能在文件外调用）；对外只暴露 `describeText`（公开 API，见 A1）。

**① key 黑名单 → `"[redacted]"`**

先把 key 切成小写词元：按 camelCase / PascalCase 边界与 `_` / `-` 分隔。例：`tokenCount → [token, count]`、`x-api-key → [x, api, key]`、`accessToken → [access, token]`。然后三条规则任一命中即脱敏：

- **A（整键）** 整个 key 归一化（词元拼回、去分隔符）∈ `{token, secret, password, passwd, authorization, auth, cookie, credential, credentials}`
- **B（相邻词对）** 相邻两词元拼接 ∈ `{apikey, accesskey, secretkey, privatekey, sessionkey, accesstoken, refreshtoken, idtoken, bearertoken, authtoken}`
- **C（单词元）** 任一词元 ∈ `{password, passwd, authorization, secret, credential, credentials, cookie}`

> **`token` 刻意不进 C**：`tokenCount` / `tokensUsed` / `maxTokens` 的词元里含 `token`，进 C 会误伤；它只在 A（`{token: "..."}` 这种整键）与 B（`accessToken` 这类词对）里生效。

**反向锁死**（必须**不**脱敏，写进测试）：
`tokenCount`、`tokensUsed`、`maxTokens`、`keyBytes`、`contentHash`、`providerId`、`scope`、`modelId`、`path`。

**② 正文键 → `describeText` 摘要**

下列 key 的字符串值一律替换成 `{ chars, hash }`，**不记正文、不看长度**（可预测优先）：
`prompt`、`content`、`body`、`text`、`message`、`input`、`output`、`messages`、`completion`、`chunk`、`delta`、`reasoning`

```ts
/** 公开 API（经 @novel-master/core/log 导出）：把一段正文压成「长度 + 指纹」。 */
export function describeText(text: string): { readonly chars: number; readonly hash: string };
```

`hash` = 16 位小写 hex。实现**复用** `token-chunk-cache.ts` 里的双 FNV-1a：本次把 `fastHash16` 上提为 `packages/core/src/common/hash.ts` 的 `fnv1aHex16(text)`，`chunkHash16` 改为调它（**输出必须逐字节不变**，由既有 token-chunk-cache 测试护栏锁定）。

**③ 形状守卫与截断**

- 字符串：截 400 字符，追加 `…(+N)`（**总长 ≤ 405**，见 B3）
- 数组：截 20 项 + `{ __truncated: n }`
- 对象：深度 4，超出 → `"[depth-limit]"`
- 键数：单对象 50 键，超出 → `__truncatedKeys: n`
- 单条 detail 序列化后上限 8KB，超出 → `{ __truncated: true, bytes: n }`
- `Error` → `{ name, message: 截 500, code?, stack?: 截 2000 }`（`cause` 展开一层）
- `bigint` / `symbol` / `function` / 循环引用 → `"[unserializable: <type>]"`
- `message` 本身截 500 字符（**不做内容扫描**——约定 call site 不得把正文插值进 message；确需标识正文时用 `describeText(...).chars`）

**④ `debug-fetch` 的 body 摘要必须一起改（否则 G6 漏网）**

`summarizeBody` 的 JSON 分支产出的是**不含正文**的摘要（`{model, stream, messages: "array(12)"}`），可以继续用；但 `debug-fetch.ts:110-112` 的 `catch { return truncateText(body, 400); }` 会把**非 JSON 请求体的前 400 字原文**返回。收口时必须把它改成不带正文的形态：

```ts
catch { return `[unparsed ${typeof body}: chars=${describeText(body).chars}]`; }
```

并且 detail 键叫 **`bodySummary`**（不叫 `body`）——`body` 在 ② 的正文键表里，会整段变成 `{chars, hash}`，把已有摘要一起打掉。`headers` / `status` / `contentType` 这类键名不在黑名单与正文表里，可放心用。

### 4.4 落盘与轮转（core 纯策略，三端共用）

```ts
// log-file-policy.ts
export interface LogFileEntry {
    readonly name: string;    // "nm-20261107.log" / "nm-20261107.1.log"（调用方已按 baseName 预过滤）
    readonly mtimeMs: number;
    readonly bytes: number;
}

export interface LogFilePlan {
    /** 本次要 append 的目标文件名（不含目录）。 */
    readonly targetName: string;
    /** 本次应删除的文件名（按 mtime 从旧到新）。 */
    readonly deleteNames: readonly string[];
}

export function planLogFileWrite(input: {
    readonly now: Date;
    readonly existing: readonly LogFileEntry[];
    readonly appendBytes: number;
    /** 第一段文件名（不含 `.log`）；默认 `nm-<本地 YYYYMMDD>`。CLI 传用户给的文件名去扩展名。 */
    readonly baseName?: string;
    readonly maxBytes?: number; // 默认 2 * 1024 * 1024
    readonly keep?: number;     // 默认 5
}): LogFilePlan;
```

规则（全部可用纯函数单测）：

1. `baseName` 默认取**本地时间** `nm-YYYYMMDD`（用户自己翻日志时要能对上手机时间）。崩溃文件由调用方传 `nm-crash-YYYYMMDD`，CLI 传用户 `--log-file` 的 basename（去 `.log`）。
2. 段 0 = `<baseName>.log`；若该文件 `bytes + appendBytes > maxBytes`，依次尝试 `<baseName>.<k>.log`（k←1），直到找到「该段不存在，或存在但未超限」的 k；k > 99 时退到 `<baseName>.<hhmmss>.log`。
3. **保留排序按 `mtimeMs` 降序**（相等时按名字降序），保留最新 `keep` 份，其余进 `deleteNames`（按 mtime 从旧到新排）。
   > **不能用文件名字典序**：`nm-20261107.1.log` 里 `.`（0x2E）小于 `nm-20261107.log` 里的 `l`（0x6C），字典序会把无段号的基础文件排到分段文件**之后**，于是「最新 5 份」里反而漏掉真正更新的分段文件。
4. **调用方必须按 `baseName` 预过滤 `existing`**（传进来的条目只属于同一 `baseName` 家族），不同前缀互不干扰。
5. **调用方必须自己维护 `bytes`**：策略是纯函数，不会回写 `existing`。三个 sink 都要在内存里保存「当前目标文件已写字节」，每次 append 后累加（移动端可用 `fs.appendFile` 的返回值；desktop/CLI 用 `Buffer.byteLength(line)`），并在**安装时用 `stat` 校准一次**。否则 `bytes + appendBytes > maxBytes` 永远不成立，2MB 切段形同虚设。

### 4.5 mobile：文件 sink、崩溃钩子、导出

**文件 sink**（`apps/mobile/src/services/log-sink.mobile.ts`）：

- 目录：`${blobFs().dirs.DocumentDir}/logs`（Android 上即 `/data/user/0/com.novelmaster/files/logs`，依据见 3.2；**Jest 里 DocumentDir 是 `/documents`**）
- 安装 `installMobileLogSink(): Promise<() => void>`：`mkdir`（已存在时吞错）→ `ls` + 逐个 `stat` 建立 `existing`（含每个文件的 `bytes`）→ `addLogSink(...)` 并返回摘除函数
- 写入：**串行队列**（promise 链），行格式 `${ISO时间}\t${level}\t${scope}\t${message}\t${JSON.stringify(detail) ?? ""}\n`；`JSON.stringify(detail)` 对 `undefined` 返回 `undefined`，用 `?? ""` 兜空
- 每次写：`planLogFileWrite({now, existing, appendBytes, baseName: \`nm-${localDateKey}\`})` → 有 `deleteNames` 就 `unlink`（失败吞）→ `appendFile(target, line, "utf8")` → **把本行字节累加进该文件的 `bytes`**
- 级别：`__DEV__ ? "debug" : "info"`
- 任何异常吞掉并 `console.warn` 一次（不递归进 sink）——**本文件在 T5 的 `no-raw-console` 白名单里**（sink 自己不能调 logger，否则失败路径无限递归）

**JS 崩溃钩子**（同一个模块）：

- RN **已经全局声明**了 `ErrorUtils`（`node_modules/react-native/src/types/globals.d.ts:49` 的 `const ErrorUtils: ErrorUtils`，接口在 `Libraries/vendor/core/ErrorUtils.d.ts:12-15`，含 `setGlobalHandler` / `getGlobalHandler`）。**直接用全局类型**，不要再本地声明 `ErrorUtilsLike`；只需在取用时加 `typeof ErrorUtils !== "undefined"` 守卫（Jest 的 `react-native` mock 与部分 Hermes 构建里它可能不存在）。
- 安装时先 `getGlobalHandler()` 存旧处理器；新处理器：先 `log.error("uncaught_js_error", {error, isFatal})`，**再调旧处理器**（必须链式，否则 RN 的 redbox / 崩溃上报 / 后续致命退出流程全被吞）
- 位置：`apps/mobile/index.js` 顶部、`AppRegistry.registerComponent` 之前。⚠️ **安装是异步的**（`mkdir`/`ls`/`stat` 都返回 Promise），**同步 `try/catch` 抓不到 Promise rejection**，必须写成：

  ```js
  installMobileLogSink().catch(err => {
    console.warn('[nm-log] sink install failed', err);
  });
  installJsCrashHandler();   // 同步，不依赖 sink 就绪
  ```

  即「崩溃钩子同步装、文件 sink 异步装且自带 `.catch()`」，两条互不阻塞。

**Kotlin 崩溃钩子**（`apps/mobile/android/app/src/main/java/com/novelmaster/log/NmLogCrashHandler.kt`）：

- `object NmLogCrashHandler { fun install(context: Context, logsDir: File = File(context.filesDir, "logs")) }`
  —— **`logsDir` 必须是可注入参数**，否则 JVM 单测无法按「临时目录 + 假 Throwable」验证（T4 / E3 要求）
- 取 `Thread.getDefaultUncaughtExceptionHandler()` 存下来，`setDefaultUncaughtExceptionHandler` 设新处理器；新处理器先写文件，**再调旧处理器**（不链式会让 RN 的异常处理与系统崩溃弹窗失效）
- 落 `<logsDir>/nm-crash-<yyyyMMdd>.log`，`FileOutputStream(append = true)`，一条崩溃 = 时间 + 线程名 + `Throwable.printStackTrace` 全文
- **切段与保留**（与 TS 侧同口径，Kotlin 调不到 `planLogFileWrite`，属有意重复实现，两侧常量写在注释里互相指认）：
  - 单文件超过 **2MB** → 改写到 `nm-crash-<yyyyMMdd>.<k>.log`（k 从 1 递增，取第一个不存在或未超限的段）
  - 任一时刻只保留最新 **5** 份（按 `File.lastModified()` 降序）
  - 崩溃路径的写盘是**同步**的（`uncaughtException` 之后进程随时可能死）
- 挂载点：`MainApplication.onCreate()` 中 **`loadReactNative(this)` 之前**（`MainApplication.kt:27-30`），这样 JS 引擎起不来时的崩溃也能留痕
- **不需要新的 ReactPackage**：纯 Kotlin，不跨桥

**导出**（`apps/mobile/src/services/log-export.ts`）：

- `exportMobileLogs(): Promise<"saved" | "cancelled">`
- 读 `logs/` 下全部 `*.log`（`ls` + `readFile(path, "utf8")`），逐个加 `===== <文件名> (<字节>) =====` 分隔头，拼成单文件；总字节上限 8MB，超出时从**最旧**的文件开始丢弃并在头部写 `[truncated: dropped N file(s)]`
- 走 `exportBytesViaDocumentPicker({fileName: "nm-logs-<yyyyMMdd-HHmmss>.txt", mimeType: "text/plain", write})`
- UI 入口：`apps/mobile/src/screens/stack/StorageConfigScreen.tsx` 在「导出数据库」下方加一项 `ProfileMenuItem`（icon `📝`、label「导出诊断日志」、value「分享日志文件」），沿用该文件既有的 `dbBusy` 互斥与 `showToast` 风格

### 4.6 desktop：文件 sink、菜单、诊断包

**文件 sink**（`apps/desktop/src/main/log/desktop-log-sink.ts`）：

- `installDesktopLogSink(options: { logsDir: string }): () => void`，默认 `logsDir = app.getPath("logs")`。**`logsDir` 作为参数注入**，测试不 import electron 也能跑（`electron-stub.mjs` 的 `getPath` 对非 `userData` 一律返回 `/tmp`，不能用来断言真实日志目录）
- 用 `node:fs` 的 `appendFileSync`（main 进程、写入量小；同步写保证退出前不丢、也不会交错）
- 行格式与 mobile 一致（同 core 的 `planLogFileWrite`）；内存里维护当前文件字节数（`Buffer.byteLength(line)` 累加）
- 级别：`isDesktopLlmDebug() ? "debug" : "info"`
- 安装点：`apps/desktop/src/main/main.ts` 模块顶层（`app.whenReady()` 之前）

**`desktop-log.ts` 退役**：

- 删掉 `desktopLog` / `desktopLogWarn` / `desktopLogError` 三个薄壳（`desktop-log.ts:21-52`）
- `isDesktopLlmDebug()` 迁到 `apps/desktop/src/main/log/llm-debug-flag.ts`（2 个消费方：`runtime/setup-llm-fetch.ts`、`services/agent-run.service.ts`）
- 4 个消费方改用 `createLogger("<scope>")`：`forward-event-bus` → `"desktop.ipc.event-bus"`、`ipc/handlers/agent` → `"desktop.ipc.agent"`、`agent-run.service` → `"desktop.agent-run"`、`setup-llm-fetch` → `"desktop.llm-fetch"`

**菜单**（`apps/desktop/src/main/shell-menu.ts`，「帮助」子菜单内、`关于` 之前）：

先把 template 构建抽成**可导出的纯函数**，再由 `buildApplicationMenu()` 调它——否则 F3 无处断言（现在 template 是 `shell-menu.ts:29` 的局部 const）：

```ts
export interface ShellMenuDeps {
    readonly isDev: boolean;
    readonly onAbout: () => void;
    readonly onOpenLogsDir: () => void;
    readonly onExportDiagnostics: () => void;
}
export function buildMenuTemplate(deps: ShellMenuDeps): MenuItemConstructorOptions[];
```

- 「打开日志目录」→ `onOpenLogsDir()` → `shell.openPath(app.getPath("logs"))`
- 「导出诊断包」→ `onExportDiagnostics()` → `dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })` 选目标父目录 → 建 `nm-diagnostics-<yyyyMMdd-HHmmss>/` → 复制 `logs/*.log` + 写 `meta.json`（`{appVersion, platform, arch, packaged, generatedAt, files: [{name, bytes}]}`）→ `shell.openPath(新目录)`
- 两个动作抽成 `apps/desktop/src/main/log/desktop-diagnostics.ts` 的纯函数，**seams 全量注入**：
  `{ logsDir, readdir, stat, showOpenDialog, mkdir, copyFile, writeFile, openPath, now, appVersion, platform, arch, packaged }`
  —— `readdir` / `stat` 用来枚举日志（F2 的 `meta.json.files`），`appVersion` / `platform` / `arch` / `packaged` 用来填 `meta.json`（不能从 `logsDir` 推导）
- `test/electron-stub.mjs` 需补 `shell`（`openPath: async () => ""`）与 `Menu`（`buildFromTemplate: (t) => ({ getMenuItemById: () => null, popup: () => {} })`），否则 `shell-menu.ts` 一 import 就炸

### 4.7 CLI：stderr + `--log-file`，**stdout 保持纯净**

CLI 的 64 处 console **分两类，处置不同**：

| 类别 | 处置 |
|---|---|
| `console.log`（结果输出，53 处） | **原样保留**。stdout 是脚本与 e2e 的契约（`registry-commands.ts:74` 明写「stdout 只出 id」） |
| `console.error`（诊断/错误提示，11 处） | **保留原样**（已在 stderr，是给用户看的）；是否同时进文件由 sink 决定，不改造 call site |
| core 的 59 处（经 sink 流到 CLI） | 由 CLI sink 统一落 stderr；`--log-file` 时额外落文件 |

**行为变化（有意，必须写进 CHANGELOG）**：core 里 8 处 `console.log`（`debug-fetch.ts` 5、`deferred-revision-orphan-gc.ts` 1、`llm-sse-transport.ts` 2）今天会污染 CLI 的 stdout；收口后它们走 CLI sink、落 stderr，**CLI 的 stdout 变成纯数据通道**。这是修 bug，不是回归。

**为什么必须用 `setDefaultLogSink` 而不是 `addLogSink`**：只想追加文件 sink 的话，内置 console sink 仍在，core 的 8 处 `console.log` 照样写 stdout，G2 永远不成立（4.2 已写明两个入口的分工）。

CLI sink（`apps/cli/src/log/cli-log-sink.ts`）：

- `installCliLogSink(options: { logFile?: string }): void`
- **stderr**：只收 `warn` / `error`，行格式 `${ISO}\t${level}\t${scope}\t${message}\t${detail}`。`info` / `debug` **不进 stderr**（否则每次跑命令都刷屏）
- **文件**（给了 `--log-file` 时）：收**全部**级别；目录取 `path.dirname(logFile)`，`baseName` 取 `path.basename(logFile)` 去掉 `.log`（用户点名的文件名就是第一段），同目录内超过 2MB 就切 `${baseName}.1.log`…；保留 5 份
- **安装时立刻写一行** `info` / `scope="cli"` / `message="log sink installed"`：既让用户在文件里马上看到东西，也让 G1 有确定性断言（`vfs list` 这类命令本身不产生任何 core 日志）
- `--log-file <path>`：在 `main.ts` 的 `main(argv)` 入口用 `extractLogFilePath(argv)` 摘出来（形态照 `parse-args.ts:50-68` 的 `extractDbPath`，返回 `{ logFile, rest }`），`rest` 再走既有分发。**不引入 `--verbose`**（今天没有，本次也不加）

### 4.8 与既有先例的同构性

| 先例 | 本次对应 |
|---|---|
| `errors/either.ts` 出类型 + 序列化契约，不碰传输 | `LogSink` / `LogRecord` 出类型 + 脱敏契约，不碰落盘 |
| `common/i18n.ts` 出运行时，catalog 由调用方加载 | `createLogger` 出运行时，**往哪写**由调用方注入 |
| `tokenizer-driver-*` port + 双 driver | `LogSink` port + 三 driver（mobile / desktop / cli） |

**为什么不做成 driver 包（`packages/log-driver-*`）**：三个实现加起来不到 300 行，且没有一个需要「平台资产 / 原生构建产物」这种必须独立发包的东西；mobile 的实现依赖 RN 原生模块，放在 `apps/mobile` 里天然正确（RN 只从 app 打包）。等将来出现第四个消费方或需要独立发版，再抽包不迟。

## 5. 验收标准

### A. core 端口

- **A1** `@novel-master/core/log` 可被三端 import（`packages/core/package.json` 新增 `"./log"` 指向 `dist/infra/log/index.js`），**公开面恰为**：`createLogger` / `addLogSink` / `setDefaultLogSink` / `restoreDefaultLogSink` / `describeText` / `planLogFileWrite` + 类型 `Logger` / `LogSink` / `LogRecord` / `LogDetail` / `LogLevel` / `LogFileEntry` / `LogFilePlan`（**不新增 test-only 导出**，测试用上面这套公开 API 捕获）
- **A2** `createLogger("a").child("b").scope === "a.b"`
- **A3** 内置 console sink 在位：不给注入 sink 时，`warn` 会走到 `console.warn`（spy 断言）
- **A4** `addLogSink` 追加不替换：注入一个 sink 后，console 与注入 sink 都能收到同一条记录
- **A5** `setDefaultLogSink(null)` 后 console 不再收到记录，但已 `addLogSink` 的 sink 仍收到；`restoreDefaultLogSink()` 后 console 恢复接收
- **A6** sink 抛错不外溢：注入一个 `write() { throw }` 的 sink，调用方 `log.error(...)` 不抛

### B. 脱敏

- **B1** key 黑名单：`{apiKey, "x-api-key", authorization, Authorization, password, secretKey, accessToken, token}` 八个键的值全变 `"[redacted]"`；`{tokenCount, tokensUsed, maxTokens, keyBytes, contentHash, providerId}` 六个键**原值保留**
- **B2** 正文键：`{prompt: "…5000 字…"}` → `{prompt: {chars: 5000, hash: "<16hex>"}}`，**输出里不含原文任何片段**
- **B3** 截断：401 字符的普通字符串 → **总长 ≤ 405**、以 `…(+1)` 结尾、去掉后缀后恰 400 字符；21 项数组 → 20 项 + `__truncated: 1`；6 层嵌套 → 第 5 层起 `"[depth-limit]"`
- **B4** `Error` 展开：`{error: new Error("boom")}` → detail 里有 `name`、`message`、`stack`，且 `message` 超 500 时被截断
- **B5** 循环引用 / BigInt / 函数不抛，分别产出 `"[unserializable: …]"`
- **B6** `debug-fetch` 的非 JSON body 兜底：给一个非 JSON 请求体，日志里**不出现该 body 的任何子串**，只出现 `chars=<n>`（`debug-fetch.ts:110-112` 已改）

### C. core 收口

- **C1** 守卫测试 `packages/core/test/infra/log/no-raw-console.test.ts`：遍历 `src/**/*.ts`，用**调用形态**正则 `/\bconsole\.(log|info|warn|error|debug|trace)\s*\(/`（不带 `\s*\(` 会把注释算命中），断言 `src/infra/log/` 之外**零命中**；白名单只含 `src/infra/log/logger.ts` 的内置 console sink
- **C2** 59 处调用点全部改走 `createLogger(<scope>)`；29 个文件的 scope 见 T2 表，**同一文件内所有调用点共用一个模块级 `const log`**
- **C3** `packages/core/src/infra/events/simple-event-bus.ts` 的默认 `onHandlerError` 改走 logger，**对外 options 签名不变**
- **C4** 3.6 表中 **14 个 core 测试**全部改为注入捕获 sink（`setDefaultLogSink` + `restoreDefaultLogSink`），**不再断言 `console.*` 的参数内容**

### D. 轮转

- **D1** `planLogFileWrite` 纯函数用例：跨天换名、超 2MB 切段、超过 5 份按 **mtime** 删最旧、不同 `baseName` 互不干扰
- **D2** 边界：`appendBytes` 恰好等于剩余空间时不切段；超 1 字节时切段；`k=99` 之后退 `<hhmmss>` 段
- **D3** **排序反例锁死**：给定 `nm-20261107.log`（mtime 更旧）与 `nm-20261107.1.log`（mtime 更新），保留 1 份时留下的是 `.1.log`（若实现按文件名字典序会留错）
- **D4** 真机（Android）：`adb shell run-as com.novelmaster ls -l files/logs` 能看到当日 `nm-<日期>.log`，且文件内容行首是 ISO 时间

### E. mobile 落盘 / 崩溃 / 导出

- **E1** `installMobileLogSink()` 后，一条 `logger.info` 触发 `blobFs().appendFile`，路径**以 `MOCK_DIRS.DocumentDir + "/logs/nm-"` 开头**（Jest 里 DocumentDir 是 `/documents`，不是 `/files`）
- **E2** `ErrorUtils` 钩子：`setGlobalHandler` 被调用一次；新处理器执行后**旧处理器也被调用一次**（链式），且 sink 收到 `scope === "crash"` 的 error 记录
- **E3** Kotlin：`NmLogCrashHandler.install(context, tempDir)` 后 `Thread.getDefaultUncaughtExceptionHandler()` 非 null，其 `uncaughtException` 会写 `tempDir/nm-crash-<date>.log` 并调用旧处理器；另有一条用例断言超 2MB 时换到 `.1` 段
- **E4** 导出：读 5 个日志文件 → 拼成 1 个 `.txt` 且含每个文件的分隔头；总量超 8MB 时头部出现 `[truncated: dropped`
- **E5** 真机：设置页点「导出诊断日志」能调起系统保存框并落出一个 `.txt`
- **E6** mobile 的 `__tests__/no-raw-console.test.ts` 绿：`src/**/*.{ts,tsx}` 的命中集合**恰好等于** `{services/log-sink.mobile.ts}`（扫描面排除 `src/web/**`，用同一调用形态正则）
- **E7** 3.6 表中 **7 个 mobile 测试**改为注入捕获 sink，**不再断言 `console.*` 的参数内容**

### F. desktop

- **F1** `desktopLog` / `desktopLogWarn` / `desktopLogError` 在 **`apps/desktop/src/**`** 内零命中（`docs/` 的历史文档不在断言范围——`git grep desktopLog -- docs` 实测 6 条历史记录）
- **F2** 诊断包：给定假 seams（`readdir` 返回 2 个文件名、`stat` 返回字节数）→ 生成目录含 2 份日志 + `meta.json`，`meta.json.files` 长度 = 2，且含 `appVersion` / `platform` / `arch` / `packaged`
- **F3** `buildMenuTemplate({...})` 返回的数组里「帮助」子菜单含「打开日志目录」与「导出诊断包」，点击会调到注入的 `onOpenLogsDir` / `onExportDiagnostics`
- **F4** desktop `src/main/**/*.ts` 下裸 console **调用**命中 = 0（守卫测试 `apps/desktop/test/no-raw-console.test.ts`，**白名单为空**——desktop sink 的失败兜底用 `process.stderr.write`，不经 `console`）

### G. CLI

- **G1** `nm --log-file <tmp> vfs list` 后文件**存在**且首行是 `\tinfo\tcli\tlog sink installed`（安装行保证确定性；`vfs list` 自身不产生 core 日志）
- **G2** **stdout 不含 core 日志行**：同一命令的 stdout 里不出现 `[nm/`、`[llm-sse]` 等 core scope 前缀（依赖 4.2 的 `setDefaultLogSink`）
- **G3** CLI 自己的输出契约不变：`vfs list` 的结果行仍在 stdout，`console.error` 仍在 stderr；不传 `--log-file` 时不创建任何文件

### H. 测试与构建

- **H1** `npm run build -w @novel-master/core` 退出码 0（新增子路径要能被 tsc 编译出 `dist/infra/log/`）
- **H2** `npm run test -w @novel-master/core` 绿（含新增 core 日志测试、`no-raw-console` 守卫、已更新的 `agent-runner` 用例）
- **H3** desktop / cli / mobile 三端 typecheck 全绿
- **H4** `npm run test -w @novel-master/desktop` 与 `npm run test -w @novel-master/cli` 绿；mobile 定向 jest（`log-sink` / `log-export` / `no-raw-console` / `cloud-sync-progress-log` / `chat-transcript-telemetry`）绿
- **H5** `node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` 对改动文件 PASS（新增行零 finding）；`--all` 不出现本轮引入的新死导出

## 6. 测试策略

| 层 | 新增/修改 | 覆盖目标 |
|---|---|---|
| core | **新增** `test/infra/log/logger.test.ts`：child scope、`addLogSink` 追加语义、`setDefaultLogSink(null)` 关内置、sink 抛错隔离 | A2–A6 |
| core | **新增** `test/infra/log/sanitize-log.test.ts`：黑名单正反例、正文键、三轮截断、Error 展开、循环引用 | B1–B5 |
| core | **新增** `test/infra/log/log-file-policy.test.ts`：跨天/切段/保留/mtime 排序反例/边界/baseName 隔离 | D1–D3 |
| core | **新增** `test/infra/log/no-raw-console.test.ts`：遍历 `src/**/*.ts`，调用形态正则，`src/infra/log/` 之外零命中 | C1 |
| core | **修改** 3.6 表里的 **14 个 core 测试**：把「接管 `console.*`」统一换成「`setDefaultLogSink(捕获 sink)` + `restoreDefaultLogSink()`」，断言改到 `record.message` / `record.detail` / `record.level`；其中 `test/infra/llm-protocol/debug-fetch.test.ts:62-87` 另补 B6（非 JSON body 不出原文） | C4 / B6 |
| core | **修改** `test/infra/tokenizer/token-chunk-cache.test.ts` + 新增 `common/hash` 用例：`fnv1aHex16` 上提后 `chunkHash16` 输出逐字节不变（该文件已有值断言，直接作为护栏） | 4.3 ② |
| desktop | **新增** `test/log-sink.test.ts`（seams 版：写入目录、轮转、级别过滤）与 `test/desktop-diagnostics.test.ts`（导出目录 + meta.json） | F2 |
| desktop | **新增** `test/shell-menu-template.test.ts`（纯 `buildMenuTemplate`，不碰 `Menu`） | F3 |
| desktop | **新增** `test/no-raw-console.test.ts` | F4 |
| desktop | **修改** `test/electron-stub.mjs` 补 `shell` + `Menu` | F3 |
| cli | **新增** `test/cli-log-sink.test.ts`：`--log-file` 摘参、stderr 级别过滤、安装行、文件轮转 | G1–G3 |
| mobile | **新增** `__tests__/log-sink.mobile.test.ts`（blob-util mock 断言 appendFile 路径与行格式）、`__tests__/log-export.test.ts`（拼接与 8MB 截断）、`__tests__/no-raw-console.test.ts` | E1 / E4 / E6 |
| mobile | **修改** 3.6 表里的 **7 个 mobile 测试**（`cloud-sync-progress-log` / `chat-transcript-telemetry` / `rollback-probe-timing` / `chat-transcript-snapshot-bytes` / `llm-native-fetch-shim` / `chat-composer-draft` / `theme-provider-persist`） | E7 |
| mobile | **新增** Kotlin `app/src/test/java/com/novelmaster/log/NmLogCrashHandlerTest.kt`（临时目录 + 假 handler 链 + 2MB 切段） | E3 |
| 真机 | Android：装 debug 包 → 触发一次 error → `run-as com.novelmaster ls files/logs` → 设置页导出日志 | D4 / E5 |

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **dist 构建顺序** | core 只改 src 不重建 dist，三端 typecheck 会拿旧 dist 报「找不到 `@novel-master/core/log`」 | 严格按 `core src → build-core → 三端 typecheck`；mobile 的 `metro.config.js:12-35` 已有 dist 陈旧守卫，把 `infra/log/index.js` 加进 `coreDistSmokeFiles` |
| **Jest 解析不到新子路径** | RN preset 的 `customExportConditions=['require','react-native']` + `unsafe:true` 让 exports 的 `import` 条件失效，未显式映射的子路径在 `jest-resolve` 阶段就抛 `No known conditions` | T3 必须同步加 `apps/mobile/jest.config.js` 的 `'^@novel-master/core/log$'` 映射；T1 同步加 `packages/core/tsconfig.test.json` 的 `paths` 条目 |
| **console 输出格式变化** | 今天 `console.warn("...", errorObject)` 会在终端展开整个 Error；收口后打印的是脱敏后的扁平对象，`stack` 被截到 2000 字符 | 有意为之（G6）。**写进 CHANGELOG**：日志内容不变，形态改为单行结构化 |
| **崩溃钩子吞掉 RN 默认处理** | Kotlin 或 JS 侧不链式调用旧 handler，会让 redbox / 系统崩溃弹窗 / 后续退出流程失效 | E2 / E3 直接断言「旧处理器被调用一次」；两侧代码里写死「先记日志、再委派」 |
| **JS 崩溃落盘是 best-effort** | 致命错误后进程可能立刻被杀，`appendFile` 的 promise 来不及 flush | 诚实说明：JS 侧只保证「尽量」；**Kotlin 侧同步写**才是兜底（覆盖 native 与引擎未就绪的崩溃） |
| **异步安装被同步 try/catch 漏掉** | `mkdir/ls/stat` 返回 Promise，顶层 `try/catch` 抓不到 rejection，sink 装不上会产生 unhandled rejection | 4.5 明确写 `.catch()` 形态；「崩溃钩子同步装、文件 sink 异步装」两条独立 |
| **日志写入放大** | `session-stream-unit-manager` 这类高频路径在 debug 下可能几十毫秒一条，2MB 会被秒级写满，导致关键日志被轮转掉 | release 的 file sink `minLevel=info`（丢掉 debug）；2MB/5 份是**上界**不是目标；若真机实测日增超 5MB，把 `minLevel` 提到 `warn` 并另立题做采样 |
| **脱敏漏网（正文从摘要里溜出）** | `summarizeBody` 的非 JSON 兜底本来就会吐前 400 字原文 | 4.3 ④ 强制改兜底 + B6 用例；另约定 call site 不得把正文插进 message |
| **既有 console spy 测试破面** | 21 个测试（core 14 + mobile 7）断言 console 的参数内容，收口后全部变红；漏改一个就是 `npm run test -w @novel-master/core` / mobile 全量红 | 3.6 已逐条列出文件与行号；T2 / T5 的验证命令里点名了这些套件；迁移范式统一走 `setDefaultLogSink` 捕获（不新增 test-only 导出） |
| **`bytes` 不累加导致 2MB 永不触发** | 策略是纯函数、不回写 `existing`，只靠安装时的 `stat` 会永远判定「未超限」 | 4.4 规则 5 明确「sink 自己维护字节数并每次累加」；D1 用例里给连续 append 序列断言第 N 次切段 |
| **CLI stdout 变化被当成回归** | core 的 8 处 `console.log` 从 stdout 移到 stderr，若有人在 parse stdout 里等这些行会「丢输出」 | 明确列为**有意修复**（4.7）；G2 是最新契约的守卫 |
| **桌面 electron stub 缺 `shell` / `Menu`，且 template 不可见** | 菜单测试一 import 就炸；F3 无法断言局部 const | 先扩 `test/electron-stub.mjs`；把 template 构建抽成 `buildMenuTemplate(deps)` 纯函数 |
| **mobile Jest 的 blob-util stub 行为不全** | `ls` / `stat` 默认返回 `undefined`，sink 里 `.map` 会抛；`DocumentDir` 是 `/documents` 不是 `/files` | 测试文件内 `jest.mock` 覆盖（现有约定，见 stub 文件头注释）；sink 内部对 `ls`/`stat` 结果做空守卫；E1 断言用 `MOCK_DIRS.DocumentDir` |
| **`./log` 子路径无 allowlist 快照** | 与 `nmtp` / `sksp` / `tdbc` 同款的既有缺口，将来误加导出不会被发现 | 登记进开放问题；本次用 A1 的公开面清单 + 单测守住行为 |
| **iOS 未验** | `<DocumentDir>/logs` 在 iOS 上是 `Library` 或 `Documents`，语义不同；picker 行为也不同 | 本次交付以 Android 为准；iOS 路径与导出在真机验收里单列，若不通则降级为「iOS 不落盘」并在 README 注明 |

## 8. 任务拆解

| # | 任务 | 依赖 | 验证 | 预估改动面 |
|---|---|---|---|---|
| **T1** | core 新增 `infra/log/`（`log-record.ts` / `logger.ts` / `sanitize-log.ts` / `log-file-policy.ts` / `index.ts`）；`common/hash.ts` 收编 `fnv1aHex16` 并让 `chunkHash16` 改调它；`packages/core/package.json` 加 `"./log"`；`packages/core/tsconfig.test.json` 的 `paths` 加 `"@novel-master/core/log": ["./src/infra/log/index.ts"]`；新增 3 个 core 测试 | — | `npm run build -w @novel-master/core`（EXIT=0）→ `cd packages/core && node scripts/run-tests.mjs --dir test/infra/log`（EXIT=0）→ `npm run test -w @novel-master/core`（EXIT=0） | 12 文件 |
| **T2** | core 59 处调用点收口到 `createLogger(<scope>)`（29 文件，scope 见下表）；`simple-event-bus` 默认 `onHandlerError` 一并改；`debug-fetch` 的非 JSON 兜底改 `describeText` 且 detail 键用 `bodySummary`；新增 `no-raw-console.test.ts`；**同步改 3.6 表里的 14 个 core 测试** | T1 | `npm run build -w @novel-master/core` → `npm run test -w @novel-master/core`；守卫用例断言 `src/` 除 `infra/log/` 外零命中 | 44 文件 |
| **T3** | mobile：新增 `services/log-sink.mobile.ts`（blob-util 落 `DocumentDir/logs` + 轮转 + `ErrorUtils` 链式钩子）、`services/log-export.ts`（合并导出）、`index.js` 安装（同步装钩子 / 异步装 sink 带 `.catch()`）；`StorageConfigScreen.tsx` 加「导出诊断日志」；**`apps/mobile/jest.config.js` 加 `'^@novel-master/core/log$'` 映射**；新增 2 个 jest 套件 | T1 | `npm run typecheck -w @novel-master/mobile`（EXIT=0）；`npm run test -w @novel-master/mobile -- --silent log-sink log-export`（EXIT=0） | 7 文件 |
| **T4** | mobile Kotlin：新增 `app/src/main/java/com/novelmaster/log/NmLogCrashHandler.kt`（`install(context, logsDir)` 接缝 + 2MB 切段 + 留 5 份）+ `MainApplication.onCreate` 挂载 + `app/src/test/java/com/novelmaster/log/NmLogCrashHandlerTest.kt`（junit 已在 `app/build.gradle` 的 `testImplementation`） | T3 | `cd apps/mobile && node scripts/run-gradlew.mjs :app:testDebugUnitTest --tests "com.novelmaster.log.*"`（EXIT=0）；真机 `run-as com.novelmaster ls files/logs` 见 `nm-crash-*.log` | 3 文件 |
| **T5** | mobile **50 处**调用点收口（19 文件；排除 `src/web/chat-transcript/webview/**` 的 2 处）；新增 `__tests__/no-raw-console.test.ts`；**同步改 3.6 表里的 7 个 mobile 测试**（`cloud-sync-progress-log` / `chat-transcript-telemetry` / `rollback-probe-timing` / `chat-transcript-snapshot-bytes` / `llm-native-fetch-shim` / `chat-composer-draft` / `theme-provider-persist`） | T3 | `npm run typecheck -w @novel-master/mobile`；`npm run test -w @novel-master/mobile -- --silent no-raw-console cloud-sync-progress-log chat-transcript-telemetry rollback-probe-timing llm-native-fetch-shim chat-composer-draft theme-provider-persist`（EXIT=0） | 27 文件 |
| **T6** | desktop：新增 `main/log/desktop-log-sink.ts`、`main/log/llm-debug-flag.ts`、`main/log/desktop-diagnostics.ts`；`shell-menu.ts` 抽出 `buildMenuTemplate(deps)` 并加两项菜单；删 `main/log/desktop-log.ts` 并改 4 个消费方；`main.ts` 安装 sink；扩 `test/electron-stub.mjs`（`shell` + `Menu`）；新增 3 个测试 | T1 | `npm run typecheck -w @novel-master/desktop`；`npm run test -w @novel-master/desktop`（EXIT=0）；`git grep desktopLog -- apps/desktop/src` 零命中 | 14 文件 |
| **T7** | desktop 剩余 **14 处**调用点收口（`main.ts` 5、`ipc/handlers/vfs.ts` 2、`services/chat-prompt-tokens.service.ts` 2、`ipc/handlers/cloud-sync.ts` 1、`ipc/handlers/physical.ts` 1、`services/db-backup.service.ts` 1、`services/vfs-batch.service.ts` 1、`shell-menu.ts` 1）；新增 `test/no-raw-console.test.ts` | T6 | `npm run typecheck -w @novel-master/desktop`；`npm run test -w @novel-master/desktop` 中 no-raw-console 绿 | 9 文件 |
| **T8** | CLI：新增 `src/log/cli-log-sink.ts` + `src/log/parse-log-file-arg.ts`；`main.ts` 摘 `--log-file` 并 `setDefaultLogSink(cliSink)`；**不改任何 `console.log` 结果输出、不加 `--verbose`**；新增 `test/cli-log-sink.test.ts` | T1 | `npx tsc --noEmit -p apps/cli/tsconfig.json`（EXIT=0）；`npm run test -w @novel-master/cli`（EXIT=0） | 4 文件 |
| **T9** | 收口门控：重建 dist 链（core → drivers）、三端 typecheck、三端测试、`check-style --changed/--all`、把 `infra/log/index.js` 加进 Metro `coreDistSmokeFiles`、CHANGELOG 补「日志落盘与导出」「CLI stdout 变纯净」两条 | T1–T8 | `npm run build -w @novel-master/core` → `-w @novel-master/tokenizer-driver-node` → `-w @novel-master/tokenizer-driver-rn`；`npm run test -w @novel-master/core` / `-w @novel-master/tokenizer-driver-node` / `-w @novel-master/desktop` / `-w @novel-master/cli` 全 EXIT=0；`npm run typecheck -w @novel-master/desktop` / `-w @novel-master/mobile`；`node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` PASS | 2 文件 |

**T2 的 scope 分配表**（29 文件 / 59 处，口径见 1.1）：

| 文件 | 处数 | scope |
|---|---|---|
| `infra/llm-protocol/logic/debug-fetch.ts` | 6 | `llm.fetch` |
| `infra/db-maintenance/impl/db-maintenance.service.ts` | 4 | `db-maintenance` |
| `service/agent/impl/agent-runner.ts` | 4 | `agent.runner` |
| `bootstrap/novel-master-bootstrap.ts` | 3 | `bootstrap` |
| `infra/tokenizer/logic/session-api-prompt-token-store.ts` | 3 | `tokenizer.session-api-store` |
| `service/vfs/impl/character-card-import.service.ts` | 3 | `vfs.character-card-import` |
| `service/vfs/impl/vfs-zip-io.service.ts` | 3 | `vfs.zip-io` |
| `bootstrap/schema-migrations/index.ts` | 2 | `bootstrap.migrations` |
| `domain/message-checkpoint/logic/deferred-revision-orphan-gc.ts` | 2 | `message-checkpoint.revision-gc` |
| `domain/tool/builtin/vfs-tools.ts` | 2 | `tool.vfs` |
| `domain/vfs/content-store/logic/zlib-accelerator.ts` | 2 | `vfs.zlib-accelerator` |
| `infra/llm-protocol/logic/llm-sse-transport.ts` | 2 | `llm.sse-transport` |
| `infra/tokenizer/logic/incremental-token-counter.ts` | 2 | `tokenizer.incremental` |
| `infra/tokenizer/logic/prompt-whole-cache.ts` | 2 | `tokenizer.prompt-whole-cache` |
| `infra/tokenizer/logic/token-chunk-cache.ts` | 2 | `tokenizer.chunk-cache` |
| `service/agent/logic/run-agent-turn.ts` | 2 | `agent.turn` |
| `service/chat/impl/usage-stats.service.ts` | 2 | `chat.usage-stats` |
| `service/vfs/logic/ensure-import-dir-rules.ts` | 2 | `vfs.import-dir-rules` |
| `domain/tool/builtin/curl-tool.ts` | 1 | `tool.curl` |
| `domain/tool/builtin/overflow-sink.ts` | 1 | `tool.overflow-sink` |
| `domain/tool/builtin/search/search-tool.ts` | 1 | `tool.search` |
| `infra/cloud-sync/impl/cloud-sync-coordinator.ts` | 1 | `cloud-sync.coordinator` |
| `infra/events/simple-event-bus.ts` | 1 | `events.bus` |
| `infra/llm-protocol/logic/sse-parse-errors.ts` | 1 | `llm.sse-parse` |
| `infra/tokenizer/encoding-registry.ts` | 1 | `tokenizer.encoding-registry` |
| `service/chat/impl/message.service.ts` | 1 | `chat.message` |
| `service/compaction-conditions/run-compaction.ts` | 1 | `compaction.run` |
| `service/message-checkpoint/impl/message-rollback.service.ts` | 1 | `message-checkpoint.rollback` |
| `service/vfs/logic/clear-session-prompt-caches.ts` | 1 | `vfs.clear-session-prompt-caches` |

**级别映射**（不许自定义）：`console.debug → debug`、`console.log → info`、`console.info → info`、`console.warn → warn`、`console.error → error`。

**T2 的两个特殊点**：① `debug-fetch.ts` 的 body 摘要必须挂在 `bodySummary` 键下，且非 JSON 兜底改 `describeText`（见 4.3 ④）；它的 5 处 `console.log` 改 `log.debug`（该文件自身已有 `isLlmFetchDebugEnabled()` 门控，级别只是跟着 semantic 对齐）。② `zlib-accelerator.ts`「本进程只提示一次」的既有行为必须保留（用模块级 boolean，不要换成 logger 的一次性能力——core 不提供那个能力）。

**提交切分**：`T1`（端口）→ `T2`（core 收口）→ `T3+T4+T5`（mobile）→ `T6+T7`（desktop）→ `T8`（CLI）→ `T9`（门控与文档）。

## 9. 开放问题

1. **桌面诊断包用目录还是 zip**：本次选目录（`mkdir + copyFile + meta.json`），因为 desktop 未声明 `fflate`、Electron 也没有 zip API；要打 zip 得先给 desktop 加显式依赖，属「引新依赖」范畴。是否下一轮补？
2. **`@novel-master/core/log` 要不要 allowlist 快照**：`nmtp` / `sksp` / `tdbc` 三个 infra 子路径都没有；补就要同时补四个，且 `public-subpath-allowlist.test.ts` 的 `SUBPATHS` 常量与 `snapshots/*.json` 要同步。单独立题还是本轮顺手补？
3. **`packages/core/package.json` 的 exports 只有 `types` + `import`**：Node / Metro 都能解析，但**任何**没在 `apps/mobile/jest.config.js` 显式映射的 core 子路径在 Jest 里都会炸。要不要给 core 的每个子路径补 `"require"` / `"default"` 条件（一次性解决这一类问题，而不是每次加子路径都记得补 mapper）？这是仓级决策，本轮按「加 mapper」推进。
4. **renderer 的 7 处 console**：要收口就得加一条 `nm:log/write` IPC 通道，renderer → main 文件 sink。本轮不做，下一轮？
5. **日志级别要不要给用户开关**：现在按 `__DEV__` / 环境变量固定。若用户反馈「日志太吵」或「日志不够」，需要 UI 开关（mobile 设置页 + desktop 首选项）。
6. **导出是否需要「清空日志」**：导出告诉用户日志里有路径与会话 id，但没给删除入口。若做，要注意删除时不删正在写的那个文件。
7. **iOS 支持边界**：`DocumentDir` 在 iOS 是 `Documents`（会被 iCloud 备份），日志应该落 `Library/Caches` 或 `ApplicationSupportDir`。本次只验 Android，iOS 需另开。
8. **`describeText` 的 hash 是否要加盐**：当前是裸 FNV-1a，短文本（如 4 字标题）可被字典穷举还原。若认为这是可接受风险就保持；若要防，改成 `hash(salt + text)` 且 salt 落进程内随机。
