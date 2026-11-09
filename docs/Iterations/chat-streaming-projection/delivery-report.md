# chat-streaming-projection 交付报告（Step 10 / C34）

> 本文件由 fix-10 修复轮补写，记录 **2026-11-09 本机实跑** 的 nm style 分项结果、
> 未处理项、测试与 e2e 记录。命令均在仓库根 `D:\Dev\Js\novel-master` 执行，
> 除特别标注 cwd 的命令外。

## 1. nm style 报告表

### 1.1 分项门禁结果（fixed 后）

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run check:encoding` | **exit 0**，4046 个跟踪文件 0 命中 | 已去掉 `apps/mobile/__tests__/chat-transcript-row-window.test.ts` 的 UTF-8 BOM（HEAD 无 BOM） |
| `node .agents/skills/nm-code-style/scripts/check-inline.mjs --changed` | **exit 0**，仅 2 条 `KEEP_LOCAL` | 见 §1.3 |
| `node .../check-signatures.mjs apps/mobile/src/web/chat-transcript/webview/ui/stream/StreamingMessageRow.tsx` | **exit 0**，0 处 | 新模块整文件 0 |
| `node .../check-inline.mjs .../ui/stream/StreamingMessageRow.tsx` | **exit 0**，0 处 | 新模块整文件 0 |
| `node .../find-fake-exports.mjs apps/mobile/src/components/chat/ChatTranscriptBridge.ts --strict` | **exit 0**，`KEEP=21` | 4 个零消费编解码器（encodeHostToTranscript / encodeTranscriptToHost / decodeHostToTranscript / parseScrollSnapshotFromHost）与 `decodeTranscriptToHost` 已删；协议类型按 keep-public 登记 |
| `node .../find-fake-exports.mjs apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts --strict` | **exit 0**，`KEEP=14` | `ContextMenuState` / `TranscriptState` 撤 export |
| `node .../find-fake-exports.mjs apps/mobile/src/web/chat-transcript/webview/ui/labels.ts --strict` | **exit 0**，`KEEP=3` | `resolveLabels` 写 keep-public（web 缺省回退唯一入口） |
| `node .../check-methods.mjs apps/mobile/src/services/session-stream-unit.ts apps/mobile/src/services/session-stream-unit-manager.service.ts` | **55 处（120 个类方法）**，低于 spec §7.1.3 基线 63 | 本轮新增方法级发现已内联/补 keep 注记，见 §1.3 |
| `node .../check-signatures.mjs apps/mobile/src/components/chat/chat-conversation-update-plan.ts` | **exit 0**，0 处（fix-10-2 复跑） | `UpdateInput` 短别名 + 删 `prevFirstIndex` 死三元；满足 spec §7.1.2 该文件整文件 0 |
| `node .../check-style.mjs --all` | exit 1（仅记录） | `summary: FAKE_PUBLIC=41 DEAD=243 TEST_ONLY=83 INLINE_CANDIDATE=60 AMBIGUOUS=12 KEEP=1263`；与 `gates.md` §4.4 基线同量级（DEAD 244→243） |

### 1.2 `check-signatures --changed` 未清零明细（fix-10-2 复核）

`node .../check-signatures.mjs --changed` → **exit 1，132 处（扫描 38 个文件）**。
其中本 Step 涉及文件 93 处（`ChatConversationWebView.tsx` 84、`session-stream-unit.ts` 3、
`session-stream-unit-manager.service.ts` 3、`ChatTabProvider.tsx` 3），全部 132 处按
HEAD 基线拆开如下（fix-10-2 新增列）：

| 文件 | `--changed` 处数 | HEAD 整文件处数 | 命中 HEAD 同 kind+detail（既存基线候选） | 未命中 HEAD（候选新增） |
|---|---|---|---|---|
| `components/chat/ChatConversationWebView.tsx` | 84 | 114 | 48 | 36 |
| `web/.../runtime/render/snapshot.ts` | 17 | 11 | 0 | 17 |
| `web/.../runtime/stream/stream.ts` | 11 | 26 | 2 | 9 |
| `web/.../runtime/stream/stream-checkpoint.ts`（新） | 2 | 0 | 0 | 2 |
| `web/.../runtime/render/row-windowing.ts` | 3 | 13 | 1 | 2 |
| `test-utils/transcript-ready.ts`（新） | 3 | 0 | 0 | 3 |
| `components/chat/snapshot-chunk-bounds.ts` | 2 | 1 | 0 | 2 |
| `screens/tabs/chat-tab/ChatTabProvider.tsx` | 3 | 24 | 3 | 0 |
| `services/session-stream-unit.ts` | 3 | 26 | 0 | 3 |
| `services/session-stream-unit-manager.service.ts` | 3 | 69 | 1 | 2 |
| `screens/stack/SubagentSessionScreen.tsx` | 1 | 20 | 1 | 0 |
| **合计** | **132** | **304** | **56** | **76** |

**基线判定方法（可复现）**：对 tracked 文件执行
`git show HEAD:<file> > <tmp>`，再跑 `node .../check-signatures.mjs <tmp> --json`；
把 `--changed --json` 的每条按 `kind|detail` 多重集与 HEAD 全文件结果匹配，命中数
记为「既存基线候选」，未命中记为「候选新增」。`<tmp>` 必须放在仓库外，否则会被
`git ls-files --others --exclude-standard` 收进 `--changed` 扫描面（本轮实测：仓库内
临时目录会把扫描数从 38 抬到 47）。重命名/抽取会让旧构造匹配不上，所以「候选新增」
是上界，不是逐条定性。

**口径修正（spec §7.1.4）**：spec 只豁免 **CR3 未提交的 22 条**；上表「候选新增」
不属于该豁免，本报告不再用它宣称「本迭代新增行 0」。精确归属必须等 CR3 提交后的
base sha（那时 `--changed` 才有稳定起点），在那之前该口径限制按非阻断偏差登记。
其中 `stream-checkpoint.ts` 的 `decideStreamDelta(3)` / `mergeCheckpoint(2)` 与
`snapshot.ts` 的 `writeBodyFull(4)` / `applyStreamBodyDelta(5)` 属于「单行签名超过
80 列、prettier 强制换行」的同一类冲突；`chat-conversation-update-plan.ts` 已在
fix-10-2 通过短类型别名与删死防御做到整文件 0。

**未清零原因**：

1. 两参 React hook（`useCallback(fn, deps)` / `useMemo(fn, deps)` / `useImperativeHandle(ref, fn, deps)`）
   的调用参数天然跨行；check-signatures 仅在同一物理行时不报。强行单行会超过
   prettier printWidth（默认 80）→ prettier 重新包装 → 又与签名门禁冲突；
   本文件 30 条以上属于这一类，无法同时满足两个 gate。
2. 可机械收敛且不影响行为的项已处理：`StreamingMessageRow.tsx` 11→0、
   adapter 2→0、bridge 旧编解码随函数删除、unit/manager 由 13 降到 6、
   fix-10-2 的 planner 2→0。

本表即为 spec §7.1.3 / §7.5 要求的「未处理签名基线」记录；可用
`node .../check-signatures.mjs --changed --json` 复现逐条位置。

### 1.3 KEEP / 未处理项报告

| 符号 | verdict | prod/test | 不处理理由 | 证据 |
|---|---|---|---|---|
| `mergeSnapshotRows`（`snapshot.ts:241`） | KEEP_LOCAL | 1 call / 0 ref | 快照合并阶段共享 `rows` / `streamCheckpoint` 的同一份本地状态，内联会把「保留本地更长文本」与 checkpoint rewind 判定拆散 | `check-inline --changed` |
| `scheduleSnapshotAnomalyResync`（`snapshot.ts:464`） | KEEP_LOCAL | 1 call / 0 ref | 共享 `state.snapshotResyncAnomalyCount` / `snapshotResyncBackoffUntil` 的退避状态机；timer 闭包捕获 deadline 作废语义 | `check-inline --changed` |
| `SessionStreamUnit.adoptPendingStreams` | KEEP_LOCAL | 1 call / 1 ref | 共享 `pendingAdoptions` 队列与 `streamRowIds` copy-on-write 映射的 DB 接管状态机 | `check-methods` |
| `SessionStreamUnit.applyStreamSegments` | KEEP_LOCAL | 1 call / 1 ref | 共享 `partialText/ThinkingSegments` 与 `currentStream` 的 apply 累积阶段 | `check-methods` |
| `SessionStreamUnit.buildStreamRowsProjection` | KEEP_LOCAL | 1 call / 1 ref | 共享 `finishedStreams/currentStream/interruptedStream` 的投影阶段，行序规则集中一处 | `check-methods` |
| `SessionStreamUnit.ingestToolUse` | KEEP_PUBLIC | 1 call / 1 ref | manager 的 tool-use 事件唯一入口，写入 unit 私有 currentStream 并同步推 tools-only batch | `check-methods` |
| `SessionStreamUnit.clearStreamProjection` | KEEP_PUBLIC | 1 call / 1 ref | manager rollback/fork 唯一入口，清理 unit 私有流式状态机 | `check-methods` |
| `SessionStreamUnitManager.hydrate` | KEEP_PUBLIC | 1 call / 1 ref | runtime 启动唯一水合入口，承载 dispose/幂等/量子让步状态机 | `check-methods` |
| `SessionStreamUnitManager.hydrateSessionMessages` | KEEP_PUBLIC | 1 call / 1 ref | 会话切换防闪唯一水合入口，读写 manager 私有 idle 视图与 view cache | `check-methods` |
| `SessionStreamUnitManager.adoptInterruptedUnit` | KEEP_PUBLIC | 1 call / 1 ref | 水合流程唯一建单元入口，承载 units 注册表/替换销毁/LRU 淘汰 | `check-methods` |
| `SessionStreamUnit` 内部类型：`SessionStreamMessageStatus`、`SessionStreamToolView`、`SessionStreamUnitStatus`、`SessionStreamUnitTokenSource` | DEAD | 0c/0r | 仅本文件内类型引用；find-fake-exports 不计同文件类型引用（启发式）。spec §7.1.3 的 DEAD 基线为 6，本轮 4 | `find-fake-exports <unit> --strict` → `DEAD=4 TEST_ONLY=3 KEEP=10` |
| `SESSION_STREAM_APPLY_INTERVAL_MS` / `SESSION_STREAM_INGRESS_COALESCE_MS` / `SESSION_STREAM_SETTLED_GRACE_PERIOD_MS` | TEST_ONLY | 0c / 9r、9r、1r | 测试观测/调参基线（spec §7.1.3 明列） | 同上 |
| manager 内部类型：`SessionStreamManagerRuntime`、`SessionStreamScopeBridge`、`SessionStreamSettledProjection`、`SessionStreamStartOptions`、`SessionStreamStartResult`、`SessionStreamUiBridge`、`SessionStreamUnitManagerParams` | DEAD | 0c/0r | 仅本文件内类型引用；spec §7.1.3 的 DEAD 基线为 7，本轮仍 7 | `find-fake-exports <manager> --strict` → `DEAD=7 TEST_ONLY=3 KEEP=2` |
| `SESSION_STREAM_MAX_MESSAGE_VIEWS` / `SESSION_STREAM_MAX_SETTLED_UNITS` / `SessionStreamRunStateStore` | TEST_ONLY | 0c / 2r、5r、7r | 测试观测/调参基线（spec §7.1.3 明列） | 同上 |
| `SessionStreamUnitControlMessage` | （已登记 keep-public） | 0c/0r | 单元 ↔ webview handle 控制消息线上契约；适配器改为逐字段收窄后不再 import 该类型，按跨层契约保留 | `find-fake-exports <unit> --strict` |
| `ChatTranscriptBridge` 的 `BridgeEnvelope` / `HostToTranscriptMessage` / `TranscriptToHostMessage` / `HostToTranscriptType` / `TranscriptToHostType` / `TranscriptTheme` / `CHAT_TRANSCRIPT_BRIDGE_VERSION` | （已登记 keep-public） | 0c/0r（bridge 版本常量 0c/1r） | 跨端 envelope 协议形状真源；`chat-transcript-stream-block.test.ts:244-254` 的源面契约测试锁 `'streamStatus'` / `streamResync…expectedSeq`，保留类型面 | `find-fake-exports <bridge> --strict` → `KEEP=21` |

## 2. 测试结果（本机实跑）

| 命令 | 结果 |
|---|---|
| `npm run typecheck -w @novel-master/mobile` | exit 0（含 `tsconfig.build.json`、`src/web/tsconfig.json`、`e2e:tsc`；fix-10-2 复跑） |
| `npm run test -w @novel-master/mobile -- --silent chat-conversation-webview chat-transcript-bridge chat-transcript-row-window transcript-labels chat-transcript-stream-block chat-transcript-stream-projection session-stream-webview-adapter chat-transcript-boot-script chat-transcript-entry session-stream-unit chat-conversation-bridge chat-conversation-update-plan chat-conversation-panel.integration chat-tab-screen.integration no-raw-console raw-console-baseline` | **24 suites / 435 tests 全绿**（7.8 s；fix-10-2 复跑，较 fix-10 多 3 条 `resolveLabels` 直测；含 worker teardown 警告，无失败） |
| `cd packages/core && node scripts/run-tests.mjs test/i18n/catalog.test.ts test/i18n/parse-core-catalog.test.ts` | **18 tests pass / 0 fail**（fix-10 轮记录；fix-10-2 未复跑，本轮未改 core） |
| `--silent chat-conversation-webview`（T-SP22） | 63/63 pass；`init.labels` 断言 `toEqual(buildTranscriptLabels(coreT))`（`__tests__/chat-conversation-webview.test.tsx:375-376`） |

fix-10-2 另跑：`node .../check-signatures.mjs apps/mobile/src/components/chat/chat-conversation-update-plan.ts`
→ exit 0（0 处）；`transcript-labels.test.ts` 11/11 pass（含 3 条 `resolveLabels` 回退直测）。

## 3. e2e 记录

**未运行**。原因沿用 spec §9.3.5：e2e 需真机安装/用户确认（`noReset:true`、禁止卸载），
且本修复轮只做 Step 10 的 style/log/i18n 收口，不涉及流式时序变更；T-SP-E1/E2/E3
仍按 spec 留在合并后 `manual_user` 验收。

## 4. prettier 记录

本地 `node node_modules/prettier/bin-prettier.js --end-of-line auto --config apps/mobile/.prettierrc.js --check <本次触碰文件>`：

- **红：** `ChatConversationWebView.tsx`、`session-stream-unit.ts`、`ChatTabProvider.tsx`、`snapshot.ts`。
  这 4 个文件在 `git show HEAD:` 的副本上用同一命令检查同样为红（HEAD 既有基线），本轮未新增红。
- **绿：** `ChatTranscriptBridge.ts`、`session-stream-unit-manager.service.ts`、
  `session-stream-webview-adapter.ts`、`MessageRow.tsx`、`StreamingMessageRow.tsx`、
  `stream.ts`、`stream-markdown.ts`、`row-windowing.ts`、`state.ts`、两份测试文件。
- **fix-10-2 复跑（仅本轮触碰的 4 个文件）：全绿**——`StreamingMessageRow.tsx`、
  `ToolInvokingBar.tsx`、`transcript-labels.test.ts`、`chat-conversation-update-plan.ts`。
- mobile 全量 `npm run format:check` 在本机恒有 CRLF 假红（`gates.md` §5.1，712 文件），
  不作为本 Step 的通过条件。

## 5. 本轮改动摘要（fix-10）

- 去 BOM：`apps/mobile/__tests__/chat-transcript-row-window.test.ts`。
- C1 死面：删 `ChatTranscriptBridge.ts` 的 5 个编解码函数；旧 envelope 类型按 keep-public 保留（源面契约测试仍锁形状）；`chat-transcript-bridge.test.ts` 改为锁 scroll schema re-export parity。
- 10 个 `INLINE_LOCAL` 全部内联（ChatConversationWebView / manager / unit / adapter / row-windowing / snapshot / StreamingMessageRow），仅保留 2 个 `KEEP_LOCAL`。
- `StreamingMessageRow.tsx` 整文件 signatures/inline 均 0；`assistantBubbleExtraClasses` 改为接收行对象，消除 4 处多参数调用。
- `state.ts` 两个死类型撤 export。
- unit/manager 新增方法级发现：5 个 keep-public、3 个 keep-local、`addStreamRowId` 内联；check-methods 64→55。
- T-SP22：`chat-conversation-webview.test.tsx` 的 init 用例新增 `payload.labels` 与 core catalog parity 断言。
- 新增本报告。

## 6. fix-10-2 复核轮（2026-11-09）

针对 cr-func 的 must-fix（T-SP22 文件级扫描）与 verify 卡点：

| 卡点 | 处理 | 证据 |
|---|---|---|
| [must-fix] T-SP22 源文件不出现四个字面量未按 spec 字面实现 | 三个渲染组件注释里 3 处「生成中」改为中性说明；`transcript-labels.test.ts` 的 `readCode`（先剥注释）改为 `readSource`（原文整文件扫描）；测试头注释同步改成文件级口径 | `Select-String` 原文扫描 3 个文件：0 命中；`transcript-labels` 11/11 pass，3 条渲染文件用例按原文断言 |
| [verify] `resolveLabels` 校验/非法值回退分支无直测 | 新增 3 条：`undefined/null/非对象` 全量默认；缺键/空串/非字符串逐键回退且合法键保留；合法四键透传 + 未知字段忽略 | `apps/mobile/__tests__/transcript-labels.test.ts` 的 `resolveLabels` describe；11/11 pass |
| [verify] `check-signatures --changed` 的「新增行 0」不可独立复现、§1.2 未标既有基线 | §1.2 增加 HEAD 整文件基线列与可复现判定方法；更正 spec §7.1.4 只豁免 CR3 22 条的口径；候选新增按非阻断偏差登记 | 本轮 `--changed` 132 处 / 扫描 38 文件；56 条命中 HEAD 构造、76 条候选新增（上界） |
| [verify] 已登记的门禁红（check-signatures / check-methods / find-fake-exports --strict / check-style --all）与 4 个 prettier 红 | 未新增处理；沿用 §1.1 / §1.3 / §4 的逐条登记（spec §7.1.3 允许）。本轮触碰文件 prettier 全绿 | §1.1 / §1.3 / §4 |

本轮代码改动：

- `StreamingMessageRow.tsx:14,236`、`ToolInvokingBar.tsx:2`：注释去除用户可见文案字面量
  （渲染逻辑仍读 `state.labels.generating` / `label` prop）。
- `transcript-labels.test.ts`：原文扫描 + `resolveLabels` 直测。
- `chat-conversation-update-plan.ts`：`MessagesUpdateInput` → `UpdateInput` 短别名，
  `planMessagesUpdate` 签名回到一行；删除 `prevFirstIndex` 的不可达三元（`grew && firstChanged`
  下 `prevFirstId` 已非空），改为单行 `findIndex`；`check-signatures` 整文件 0。

未做：e2e（同 §3，需真机/用户确认）；未提交 git（按要求）。
