# chat-streaming-projection 交付报告（Step 10 / C34）

> 本文件由 fix-10 修复轮补写，记录 **2026-11-09 本机实跑** 的 nm style 分项结果、
> 未处理项、测试与 e2e 记录。命令均在仓库根 `D:\Dev\Js\novel-master` 执行，
> 除特别标注 cwd 的命令外。

## 1. nm style 报告表

### 1.1 分项门禁结果（fixed 后）

| 命令                                                                                                                                         | 结果                                                                                | 说明                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:encoding`                                                                                                                     | **exit 0**，4046 个跟踪文件 0 命中                                                  | 已去掉 `apps/mobile/__tests__/chat-transcript-row-window.test.ts` 的 UTF-8 BOM（HEAD 无 BOM）                                                                                             |
| `node .agents/skills/nm-code-style/scripts/check-inline.mjs --changed`                                                                       | **exit 0**，仅 2 条 `KEEP_LOCAL`                                                    | 见 §1.3                                                                                                                                                                                   |
| `node .../check-signatures.mjs apps/mobile/src/web/chat-transcript/webview/ui/stream/StreamingMessageRow.tsx`                                | **exit 0**，0 处                                                                    | 新模块整文件 0                                                                                                                                                                            |
| `node .../check-inline.mjs .../ui/stream/StreamingMessageRow.tsx`                                                                            | **exit 0**，0 处                                                                    | 新模块整文件 0                                                                                                                                                                            |
| `node .../find-fake-exports.mjs apps/mobile/src/components/chat/ChatTranscriptBridge.ts --strict`                                            | **exit 0**，`KEEP=21`                                                               | 4 个零消费编解码器（encodeHostToTranscript / encodeTranscriptToHost / decodeHostToTranscript / parseScrollSnapshotFromHost）与 `decodeTranscriptToHost` 已删；协议类型按 keep-public 登记 |
| `node .../find-fake-exports.mjs apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts --strict`                                 | **exit 0**，`KEEP=14`                                                               | `ContextMenuState` / `TranscriptState` 撤 export                                                                                                                                          |
| `node .../find-fake-exports.mjs apps/mobile/src/web/chat-transcript/webview/ui/labels.ts --strict`                                           | **exit 0**，`KEEP=3`                                                                | `resolveLabels` 写 keep-public（web 缺省回退唯一入口）                                                                                                                                    |
| `node .../check-methods.mjs apps/mobile/src/services/session-stream-unit.ts apps/mobile/src/services/session-stream-unit-manager.service.ts` | **0 处阻断 / 37 行发现（97 个类方法 / 2 文件）**，exit 0（2026-11-10 CR1 复核实跑） | 旧数字 55 处/120 类方法已失真；`AMBIGUOUS_METHOD` 改为信息项，见 §8.2                                                                                                                     |
| `node .../check-signatures.mjs apps/mobile/src/components/chat/chat-conversation-update-plan.ts`                                             | **exit 0**，0 处（fix-10-2 复跑）                                                   | `UpdateInput` 短别名 + 删 `prevFirstIndex` 死三元；满足 spec §7.1.2 该文件整文件 0                                                                                                        |
| `node .../check-style.mjs --all`                                                                                                             | exit 1（仅记录）                                                                    | `summary: FAKE_PUBLIC=41 DEAD=243 TEST_ONLY=83 INLINE_CANDIDATE=60 AMBIGUOUS=12 KEEP=1263`；与 `gates.md` §4.4 基线同量级（DEAD 244→243）                                                 |

### 1.2 `check-signatures --changed` 未清零明细（fix-10-2 复核）

`node .../check-signatures.mjs --changed` → **exit 1，132 处（扫描 38 个文件）**。

> **CR1 复核修正（2026-11-10）**：132 处/38 文件是 style commit 之前工作树的数字，**从 HEAD 不可复现**——`--changed` 只扫未提交改动，干净树是 0 处/0 文件。按 base 判定本迭代新增行改用 `--since <base>` 或 `--range main...HEAD`（两者都读 range 右端 blob，不读工作树）：HEAD `b291aa19e` 下实跑 `--range main...HEAD` → **0 处（39 个文件，exit 0）**、`--since 27534b0f2` → **0 处（39 个文件，exit 0）**，连跑两次一致（见 §8.1/§8.3）。`--changed` 的数是未提交工作树快照（含并行修复组在途改动），随编辑移动，不作为本迭代新增红口径。
> 其中本 Step 涉及文件 93 处（`ChatConversationWebView.tsx` 84、`session-stream-unit.ts` 3、
> `session-stream-unit-manager.service.ts` 3、`ChatTabProvider.tsx` 3），全部 132 处按
> HEAD 基线拆开如下（fix-10-2 新增列）：

| 文件                                                | `--changed` 处数 | HEAD 整文件处数 | 命中 HEAD 同 kind+detail（既存基线候选） | 未命中 HEAD（候选新增） |
| --------------------------------------------------- | ---------------- | --------------- | ---------------------------------------- | ----------------------- |
| `components/chat/ChatConversationWebView.tsx`       | 84               | 114             | 48                                       | 36                      |
| `web/.../runtime/render/snapshot.ts`                | 17               | 11              | 0                                        | 17                      |
| `web/.../runtime/stream/stream.ts`                  | 11               | 26              | 2                                        | 9                       |
| `web/.../runtime/stream/stream-checkpoint.ts`（新） | 2                | 0               | 0                                        | 2                       |
| `web/.../runtime/render/row-windowing.ts`           | 3                | 13              | 1                                        | 2                       |
| `test-utils/transcript-ready.ts`（新）              | 3                | 0               | 0                                        | 3                       |
| `components/chat/snapshot-chunk-bounds.ts`          | 2                | 1               | 0                                        | 2                       |
| `screens/tabs/chat-tab/ChatTabProvider.tsx`         | 3                | 24              | 3                                        | 0                       |
| `services/session-stream-unit.ts`                   | 3                | 26              | 0                                        | 3                       |
| `services/session-stream-unit-manager.service.ts`   | 3                | 69              | 1                                        | 2                       |
| `screens/stack/SubagentSessionScreen.tsx`           | 1                | 20              | 1                                        | 0                       |
| **合计**                                            | **132**          | **304**         | **56**                                   | **76**                  |

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

| 符号                                                                                                                                                                                                                              | verdict                | prod/test                      | 不处理理由                                                                                                                                            | 证据                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `mergeSnapshotRows`（`snapshot.ts:241`）                                                                                                                                                                                          | KEEP_LOCAL             | 1 call / 0 ref                 | 快照合并阶段共享 `rows` / `streamCheckpoint` 的同一份本地状态，内联会把「保留本地更长文本」与 checkpoint rewind 判定拆散                              | `check-inline --changed`                                             |
| `scheduleSnapshotAnomalyResync`（`snapshot.ts:464`）                                                                                                                                                                              | KEEP_LOCAL             | 1 call / 0 ref                 | 共享 `state.snapshotResyncAnomalyCount` / `snapshotResyncBackoffUntil` 的退避状态机；timer 闭包捕获 deadline 作废语义                                 | `check-inline --changed`                                             |
| `SessionStreamUnit.adoptPendingStreams`                                                                                                                                                                                           | KEEP_LOCAL             | 1 call / 1 ref                 | 共享 `pendingAdoptions` 队列与 `streamRowIds` copy-on-write 映射的 DB 接管状态机                                                                      | `check-methods`                                                      |
| `SessionStreamUnit.applyStreamSegments`                                                                                                                                                                                           | KEEP_LOCAL             | 1 call / 1 ref                 | 共享 `partialText/ThinkingSegments` 与 `currentStream` 的 apply 累积阶段                                                                              | `check-methods`                                                      |
| `SessionStreamUnit.buildStreamRowsProjection`                                                                                                                                                                                     | KEEP_LOCAL             | 1 call / 1 ref                 | 共享 `finishedStreams/currentStream/interruptedStream` 的投影阶段，行序规则集中一处                                                                   | `check-methods`                                                      |
| `SessionStreamUnit.ingestToolUse`                                                                                                                                                                                                 | KEEP_PUBLIC            | 1 call / 1 ref                 | manager 的 tool-use 事件唯一入口，写入 unit 私有 currentStream 并同步推 tools-only batch                                                              | `check-methods`                                                      |
| `SessionStreamUnit.clearStreamProjection`                                                                                                                                                                                         | KEEP_PUBLIC            | 1 call / 1 ref                 | manager rollback/fork 唯一入口，清理 unit 私有流式状态机                                                                                              | `check-methods`                                                      |
| `SessionStreamUnitManager.hydrate`                                                                                                                                                                                                | KEEP_PUBLIC            | 1 call / 1 ref                 | runtime 启动唯一水合入口，承载 dispose/幂等/量子让步状态机                                                                                            | `check-methods`                                                      |
| `SessionStreamUnitManager.hydrateSessionMessages`                                                                                                                                                                                 | KEEP_PUBLIC            | 1 call / 1 ref                 | 会话切换防闪唯一水合入口，读写 manager 私有 idle 视图与 view cache                                                                                    | `check-methods`                                                      |
| `SessionStreamUnitManager.adoptInterruptedUnit`                                                                                                                                                                                   | KEEP_PUBLIC            | 1 call / 1 ref                 | 水合流程唯一建单元入口，承载 units 注册表/替换销毁/LRU 淘汰                                                                                           | `check-methods`                                                      |
| `SessionStreamUnit` 内部类型：`SessionStreamMessageStatus`、`SessionStreamToolView`、`SessionStreamUnitStatus`、`SessionStreamUnitTokenSource`                                                                                    | DEAD                   | 0c/0r                          | 仅本文件内类型引用；find-fake-exports 不计同文件类型引用（启发式）。spec §7.1.3 的 DEAD 基线为 6，本轮 4                                              | `find-fake-exports <unit> --strict` → `DEAD=4 TEST_ONLY=3 KEEP=10`   |
| `SESSION_STREAM_APPLY_INTERVAL_MS` / `SESSION_STREAM_INGRESS_COALESCE_MS` / `SESSION_STREAM_SETTLED_GRACE_PERIOD_MS`                                                                                                              | TEST_ONLY              | 0c / 9r、9r、1r                | 测试观测/调参基线（spec §7.1.3 明列）                                                                                                                 | 同上                                                                 |
| manager 内部类型：`SessionStreamManagerRuntime`、`SessionStreamScopeBridge`、`SessionStreamSettledProjection`、`SessionStreamStartOptions`、`SessionStreamStartResult`、`SessionStreamUiBridge`、`SessionStreamUnitManagerParams` | DEAD                   | 0c/0r                          | 仅本文件内类型引用；spec §7.1.3 的 DEAD 基线为 7，本轮仍 7                                                                                            | `find-fake-exports <manager> --strict` → `DEAD=7 TEST_ONLY=3 KEEP=2` |
| `SESSION_STREAM_MAX_MESSAGE_VIEWS` / `SESSION_STREAM_MAX_SETTLED_UNITS` / `SessionStreamRunStateStore`                                                                                                                            | TEST_ONLY              | 0c / 2r、5r、7r                | 测试观测/调参基线（spec §7.1.3 明列）                                                                                                                 | 同上                                                                 |
| `SessionStreamUnitControlMessage`                                                                                                                                                                                                 | （已登记 keep-public） | 0c/0r                          | 单元 ↔ webview handle 控制消息线上契约；适配器改为逐字段收窄后不再 import 该类型，按跨层契约保留                                                      | `find-fake-exports <unit> --strict`                                  |
| `ChatTranscriptBridge` 的 `BridgeEnvelope` / `HostToTranscriptMessage` / `TranscriptToHostMessage` / `HostToTranscriptType` / `TranscriptToHostType` / `TranscriptTheme` / `CHAT_TRANSCRIPT_BRIDGE_VERSION`                       | （已登记 keep-public） | 0c/0r（bridge 版本常量 0c/1r） | 跨端 envelope 协议形状真源；`chat-transcript-stream-block.test.ts:244-254` 的源面契约测试锁 `'streamStatus'` / `streamResync…expectedSeq`，保留类型面 | `find-fake-exports <bridge> --strict` → `KEEP=21`                    |

## 2. 测试结果（本机实跑）

| 命令                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 结果                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck -w @novel-master/mobile`                                                                                                                                                                                                                                                                                                                                                                                                                                     | exit 0（含 `tsconfig.build.json`、`src/web/tsconfig.json`、`e2e:tsc`；fix-10-2 复跑）                                            |
| `npm run test -w @novel-master/mobile -- --silent chat-conversation-webview chat-transcript-bridge chat-transcript-row-window transcript-labels chat-transcript-stream-block chat-transcript-stream-projection session-stream-webview-adapter chat-transcript-boot-script chat-transcript-entry session-stream-unit chat-conversation-bridge chat-conversation-update-plan chat-conversation-panel.integration chat-tab-screen.integration no-raw-console raw-console-baseline` | **24 suites / 435 tests 全绿**（7.8 s；fix-10-2 复跑，较 fix-10 多 3 条 `resolveLabels` 直测；含 worker teardown 警告，无失败）  |
| `cd packages/core && node scripts/run-tests.mjs test/i18n/catalog.test.ts test/i18n/parse-core-catalog.test.ts`                                                                                                                                                                                                                                                                                                                                                                 | **18 tests pass / 0 fail**（fix-10 轮记录；fix-10-2 未复跑，本轮未改 core）                                                      |
| `--silent chat-conversation-webview`（T-SP22）                                                                                                                                                                                                                                                                                                                                                                                                                                  | 63/63 pass；`init.labels` 断言 `toEqual(buildTranscriptLabels(coreT))`（`__tests__/chat-conversation-webview.test.tsx:375-376`） |

fix-10-2 另跑：`node .../check-signatures.mjs apps/mobile/src/components/chat/chat-conversation-update-plan.ts`
→ exit 0（0 处）；`transcript-labels.test.ts` 11/11 pass（含 3 条 `resolveLabels` 回退直测）。

## 3. e2e 记录

**deferred（文件未交付）**。CR1 复核确认（2026-11-10）：

- `git diff --name-status main...HEAD -- apps/mobile/e2e` → 空；
- `apps/mobile/e2e/specs` 只有既有 6 个 spec（`chat.conversation-webview` / `chat.rollback-vfs` / `chat.rollback` / `chat.tool-phase-and-order` / `smoke.launch` / `vfs.rename-conflict`），无 `chat.streaming-projection.e2e.ts`；
- page object 的 5 个流式观测方法与 mock provider 的 3 个慢流/tool_use 开关均不存在。

原因沿用 spec §9.3.5：e2e 需真机安装/用户确认（`noReset:true`、禁止卸载），且本轮只做 Step 10 的 style/log/i18n 收口，不涉及流式时序变更。**替代 QA**：spec §12「真机 QA」清单人工覆盖（流式行存在且是最后一行、finished 后 `data-id` 不变且无重复行、tool step 状态 pending→completed、mid-run 切后台返回）；T-SP-E1/E2/E3 均按 spec §9.3 标为 deferred，合并后 `manual_user` 验收。

## 4. prettier 记录

本地 `node node_modules/prettier/bin-prettier.js --end-of-line auto --config apps/mobile/.prettierrc.js --check <文件>`：

- **CR1 复核修正（2026-11-10，逐文件对 main/HEAD 副本实跑）**：
  - `ChatConversationWebView.tsx`、`session-stream-unit.ts`、`web/.../snapshot.ts`：**main 红 → HEAD 绿**（style commit 已格式化），当前不再是红。
  - `ChatTabProvider.tsx`：**main 红 → HEAD 红**（既有基线，未修）。
  - `StorageConfigScreen.tsx`：**main 绿 → HEAD 红**（唯一新增红，P2-21）；已在 CR1 修复轮格式化，现为 **绿**。
- 因此原「4 个文件红 + 本轮未新增红」的说法不成立；修正后的口径是：HEAD 红 = `ChatTabProvider.tsx`（既有）+ `StorageConfigScreen.tsx`（新增，已修）。
- **绿（本轮触碰的其它文件）**：`ChatTranscriptBridge.ts`、`session-stream-unit-manager.service.ts`、
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

| 卡点                                                                                                                            | 处理                                                                                                                                                                  | 证据                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [must-fix] T-SP22 源文件不出现四个字面量未按 spec 字面实现                                                                      | 三个渲染组件注释里 3 处「生成中」改为中性说明；`transcript-labels.test.ts` 的 `readCode`（先剥注释）改为 `readSource`（原文整文件扫描）；测试头注释同步改成文件级口径 | `Select-String` 原文扫描 3 个文件：0 命中；`transcript-labels` 11/11 pass，3 条渲染文件用例按原文断言 |
| [verify] `resolveLabels` 校验/非法值回退分支无直测                                                                              | 新增 3 条：`undefined/null/非对象` 全量默认；缺键/空串/非字符串逐键回退且合法键保留；合法四键透传 + 未知字段忽略                                                      | `apps/mobile/__tests__/transcript-labels.test.ts` 的 `resolveLabels` describe；11/11 pass             |
| [verify] `check-signatures --changed` 的「新增行 0」不可独立复现、§1.2 未标既有基线                                             | §1.2 增加 HEAD 整文件基线列与可复现判定方法；更正 spec §7.1.4 只豁免 CR3 22 条的口径；候选新增按非阻断偏差登记                                                        | 本轮 `--changed` 132 处 / 扫描 38 文件；56 条命中 HEAD 构造、76 条候选新增（上界）                    |
| [verify] 已登记的门禁红（check-signatures / check-methods / find-fake-exports --strict / check-style --all）与 4 个 prettier 红 | 未新增处理；沿用 §1.1 / §1.3 / §4 的逐条登记（spec §7.1.3 允许）。本轮触碰文件 prettier 全绿                                                                          | §1.1 / §1.3 / §4                                                                                      |

本轮代码改动：

- `StreamingMessageRow.tsx:14,236`、`ToolInvokingBar.tsx:2`：注释去除用户可见文案字面量
  （渲染逻辑仍读 `state.labels.generating` / `label` prop）。
- `transcript-labels.test.ts`：原文扫描 + `resolveLabels` 直测。
- `chat-conversation-update-plan.ts`：`MessagesUpdateInput` → `UpdateInput` 短别名，
  `planMessagesUpdate` 签名回到一行；删除 `prevFirstIndex` 的不可达三元（`grew && firstChanged`
  下 `prevFirstId` 已非空），改为单行 `findIndex`；`check-signatures` 整文件 0。

未做：e2e（同 §3，需真机/用户确认）；未提交 git（按要求）。

## 7. Step 10 清理轮（2026-11-09 晚，分支基线）

本轮在开发分支 `feat/chat-streaming-projection`（HEAD `fa9e3952b`）上把 Step 10 的 3 条红测试、2 条新签名与报告缺口收掉；清理改动尚未提交。

### 7.1 实跑门禁

| 命令                                                                  | 结果                                                                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量 mobile jest（`--maxWorkers=2`，日志 `tmp/full-jest.stderr.log`） | **265 suites / 2291 tests 全绿**（41.1 s）                                                                                                                  |
| `npm run typecheck -w @novel-master/mobile`                           | exit 0（`tsconfig.build.json` + `src/web/tsconfig.json` + `e2e:tsc`）                                                                                       |
| `npm run build:webview -w @novel-master/mobile`                       | exit 0，rich-document / code-editor / composer-input / chat-transcript 四包 gate C GREEN                                                                    |
| `npm run check:encoding`                                              | exit 0，**4064** 个跟踪文件 0 命中                                                                                                                          |
| `node .agents/skills/nm-code-style/scripts/test-check-signatures.mjs` | **1/1 pass**（新增回调/长 import 用例）                                                                                                                     |
| `check-signatures --changed`（清理后）                                | 0 处（本轮工作区改动）                                                                                                                                      |
| 全量文件清单的 nm style                                               | 新增 mustFix **0**；main 既有基线：check-signatures **363**、check-inline **11**、check-methods **58**、prettier **19 文件**（不阻断，逐条见 §1.2/§1.3/§4） |

### 7.2 `check-signatures` 误报修复

- `checkArguments`：原规则只豁免「恰好一个参数且是函数」；改为**任一实参**是箭头函数/函数表达式就跳过。`setTimeout(function () { ... }, delayMs)` 不再报 `ARGS`。
- `checkImport`：新增「一行形式超过 prettier printWidth(80) 就跳过」；`SubagentSessionScreen.tsx:52` 的长 import（prettier 必然拆行）不再报 `IMPORT`。
- `test-check-signatures.mjs` 新增两条 fixture 断言：回调实参、长 import 均不误报；实跑 1/1 pass。
- 因此 `snapshot.ts:493` 与 `SubagentSessionScreen.tsx:52` 两条不再需要书面豁免，报告不再登记 waiver。

### 7.3 3 条红测试（测试断言跟随最终代码形态，非产品逻辑红）

| 测试                                                     | 改动                                                                                                                                                                                                                                | 证据                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `__tests__/code-copy.test.ts:72`                         | 删 `handleCopyCode(payload)` 断言；源码已内联 `case 'copyCode'` + `Clipboard.setString`                                                                                                                                             | `code-copy` 通过                                           |
| `__tests__/mermaid-fullscreen.test.ts:164-165`           | 改断言 `onWebMermaidViewerOpenChange?.(true/false)`；源码已内联                                                                                                                                                                     | `mermaid-fullscreen` 通过                                  |
| `__tests__/chat-transcript-stream-block.test.ts:206-208` | 改对象参数 `postStreamBlockSplits({splits, streamId, seq})`；另把旧的 `streamCommittedTextPartsRef.current.join` 断言改为 `const textParts = committedTextPartsRef.current;` + `accumulated(textParts, streamTextAccumRef.current)` | `chat-transcript-stream-block` 通过；三套件 **41/41 pass** |

### 7.4 `snapshot-chunk-bounds` 两条新签名

- 新增 `type Bounds = Array<readonly [number, number]>`、`type BytesAt = (index: number) => number`。
- `planRowChunkBounds(rows: readonly TranscriptRow[]): Bounds` 与 `planChunkBounds(count: number, bytesAt: BytesAt): Bounds` 收成一行；`const bounds: Bounds = []`。
- 剩余 `planSnapshotChunkBounds(1)`（行 41）为 **main 既有**基线（单行会超 printWidth），不属本轮新增。

### 7.5 未处理项（按 nm-code-style「未处理项报告」）

| 位置                                                                                                 | verdict     | 理由                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `ChatConversationWebView.tsx:581/634/672/731/775/820/877/1228/1283/1324/1575`                        | KEEP_LOCAL  | 流式 ref/状态机原子复位，逐条带 `nm-style: keep-local` 注记           |
| `snapshot.ts:258 mergeRows`、`:468 scheduleSnapshotAnomalyResync`                                    | KEEP_LOCAL  | 快照合并/异常退避共享状态机                                           |
| `session-stream-unit.ts:1364 adoptPendingStreams`、`:1583 buildStreamRowsProjection`                 | KEEP_LOCAL  | pendingAdoptions/streamRowIds、finishedStreams/currentStream 投影状态 |
| `session-stream-unit.ts:909 handleStepCommitted`、`:941 ingestToolUse`、`:982 clearStreamProjection` | KEEP_PUBLIC | manager 路由唯一入口                                                  |
| `StreamingMessageRow.tsx:46 StreamBodyHost.shouldComponentUpdate`                                    | 误报        | Preact class 生命周期方法，框架调用，不是自由函数                     |
| `snapshot-chunk-bounds.ts:41 planSnapshotChunkBounds(1)`                                             | 基线        | main 既有；单行超 printWidth                                          |
| `SubagentSessionScreen.tsx` prettier                                                                 | 基线        | main 既有 19 个 prettier 红之一；本轮未新增红                         |

### 7.6 未覆盖

e2e 未跑（同 §3，需真机/用户确认）；独立 code-review-loop 未跑；本轮清理改动未提交；main 既有 363 条 style 基线未清零；`--include-tests` 另有 403 条测试侧既有签名。

## 8. CR1 复核修复轮（gates-docs，2026-11-10）

> 工作树与其它修复组并行（因此 §1/§2 的部分数字已移动）；本节只记本组实跑结果。

### 8.1 本组门禁实跑

| 命令（仓库根）                                                                                                                                                                | 结果                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node .agents/skills/nm-code-style/scripts/check-methods.mjs apps/mobile/src/services/session-stream-unit.ts apps/mobile/src/services/session-stream-unit-manager.service.ts` | **exit 0**，`0 处阻断 / 37 行发现（扫描 97 个类方法 / 2 个文件）`；6 条 `AMBIGUOUS_METHOD` 为信息项                                                                                                                                     |
| 同上，仅 `session-stream-unit.ts`                                                                                                                                             | exit 0，`0 处阻断 / 16 行发现（51 个类方法 / 1 个文件）`                                                                                                                                                                                |
| 同上，仅 `session-stream-unit-manager.service.ts`                                                                                                                             | exit 0，`0 处阻断 / 15 行发现（46 个类方法 / 1 个文件）`                                                                                                                                                                                |
| `node node_modules/prettier/bin-prettier.js --check --end-of-line auto --config apps/mobile/.prettierrc.js apps/mobile/src/screens/stack/StorageConfigScreen.tsx`             | **exit 0**，`All matched files use Prettier code style!`                                                                                                                                                                                |
| `node node_modules/jest/bin/jest.js --config apps/mobile/jest.config.js --silent raw-console`                                                                                 | **2 suites / 18 tests 全绿**                                                                                                                                                                                                            |
| `node .../check-signatures.mjs --range main...HEAD`                                                                                                                           | **0 处（39 个文件）**，连跑两次一致                                                                                                                                                                                                     |
| `node .../check-signatures.mjs --since 27534b0f2`                                                                                                                             | **0 处（39 个文件）**                                                                                                                                                                                                                   |
| `node .../check-signatures.mjs --changed --json`                                                                                                                              | **9 处（5 个文件）**（本组复核时点的未提交工作树：`SubagentSessionScreen` 3、`ChatTabProvider` 1、manager 2、unit 1、`snapshot.ts` 2）——全部来自并行修复组在途改动；本组 P2-21 曾引入的 `StorageConfigScreen.tsx` 3 条已清零（见 §8.7） |

### 8.2 P2-13 check-methods

- `AMBIGUOUS_METHOD` 改为**信息项**（不参与退出码）；同名方法全局引用 0 时仍判 `DEAD_METHOD`（保住死代码牙口）。
- 摘要改为 `X 处阻断 / Y 行发现（扫描 N 个类方法 / M 个文件）`。CR 记录的「单文件打印 0 个类方法 / 0 个文件」在当前 HEAD 不可复现：单文件实跑为 51 个类方法 / 1 个文件。
- 当前 HEAD 的 AMBIGUOUS 是 **6 条**（不止 CR 的 4 条）：`snapshot`/`attachWebview`/`detachWebview` 在 unit 与 manager 各一处（`detachWebview` 已按 style commit 恢复原名）。
- 变异自检（fixture 在仓库外 `D:/Dev/Js/nm-style-tmp/`）：
  - 仅跨类同名 + 有 1 处引用 → **exit 0**，输出 2 条 AMBIGUOUS 信息项；
  - 跨类同名 + 一个真实死方法 → **exit 1**（`DEAD_METHOD Alpha.reallyDeadMethodXyz`）；
  - 只有死方法 → **exit 1**（`DEAD_METHOD Gamma.deadMethodAbc`）；
  - `node .agents/skills/nm-code-style/scripts/test-check-methods.mjs` → 1/1 pass。

### 8.3 P2-14 check-signatures

- ARGS 豁免收窄：只跳过函数/箭头实参自身；有回调时不再用「首实参 vs 调用起点」判定，只比较普通实参之间是否拆行（否则 `bus.subscribe(EVENT, cb => {...})` 这类 prettier 强制拆行会误报）。
- 反例红/绿（同一 fixture `D:/Dev/Js/nm-style-tmp/callback-args.ts`）：
  - 改前（`HEAD` 版本脚本经 stdin 实跑）→ `check-signatures: 0 处（扫描 1 个文件）`（漏报）；
  - 改后 → `check-signatures: 1 处`，`ARGS ... withCallback`（命中）。
- 新增 `--since <base>`（=`<base>...HEAD`）与 `--range <a...b>`：扫描面与新增行都按 range **右端 blob** 解析（`git show <rev>:<file>`），不读工作树，结果不随并行编辑漂移。实测 `--range main...HEAD` 两次均 `0 处（39 个文件）`，`--since 27534b0f2` 同为 `0 处（39 个文件）`——复现了 spec「本迭代新增行 0」口径。
- `node .agents/skills/nm-code-style/scripts/test-check-signatures.mjs` → 1/1 pass。

### 8.4 P2-15 log 守卫

- `raw-console-baseline.test.ts`：删除 `session-stream-unit.ts: 5`、`session-stream-unit-manager.service.ts: 10` 两个基线条目（=0）；`BUSINESS_BUDGET` 45 → **30**；注释统一为「18 文件/36 处（白名单 2/6 + 业务 16/30）」。
- `snapshot.ts` 的 `console.error` 在 spec §7.3 显式登记（web bundle 无 logger 依赖，E6 排除 `src/web/**`）；`no-raw-console.test.ts` 同步注明其不在 `CHANGED_FILES`。
- 变异自检（改本组测试文件后立即还原）：
  - 把 `chat-prompt-tokens.service.ts` 基线 10→9 → 红：`Expected: <= 9, Received: 10`；
  - 把 `BUSINESS_BUDGET` 30→29 → 红：`Expected: <= 29, Received: 30`。

### 8.5 P2-16 文档漂移

本组已修：`raw-console-baseline.test.ts` 头注释与用例口径统一（原「18 文件/36 处」vs「实际 30 处」不再冲突）；其 `:20` 白名单注释的「业务 **45** 处预算」已在 r2 改为 **30**，与 `BUSINESS_BUDGET = 30`、头注释「业务 16/30」一致；`no-raw-console.test.ts` 补 `snapshot.ts` 排除说明。

仍在其它组文件、本组无权修改（r2 复核时点逐条仍在，需编排方转交；逐条留证）：

| 位置                                                       | 漂移                                                                               | 归属   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `ChatTabProvider.tsx:38,42`                                | 仍写「转录七方法」/`setComposerText`（handle 已是 3 方法，`setComposerText` 已删） | 接线组 |
| `ChatTabProvider.tsx:94`                                   | 「流式 partial = partialText/partialThinking」；显示源已是 `streamRows`            | 接线组 |
| `web/.../main.ts:18`                                       | 注释写 ready 用 `t1`，实际常量 `t2`                                                | web 组 |
| `web/.../runtime/mermaid.ts:5-6`                           | 仍提 `streamCommit`/`streamDelta`/`streamBatch`（两 type 已删）                    | web 组 |
| `__tests__/chat-transcript-entry.test.ts:6`                | 头注释 `version:'t1'`，:80 断言 `t2`                                               | 测试组 |
| `__tests__/chat-tab-screen.integration.test.tsx:598`       | 标题「重进注入的 streamDelta」，正文断言 `not.toContain('streamDelta')`            | 测试组 |
| `__tests__/chat-transcript-stream-projection.test.tsx:561` | 标题含 `fullReplaceOnly`，正文未断言该分支                                         | 测试组 |
| `session-stream-unit-manager.service.ts:41`                | 注释仍把 `requestForceSnapshot` 列为 manager 方法（已删，仅 unit 侧保留）          | 单元组 |

### 8.6 P2-17 public surface delta + 数字修正

- style commit 实测：`git show --shortstat b291aa19e` → **29 files changed, 2646 insertions(+), 3080 deletions(-)**；提交信息写「29 files」，一致。CR 引用的 `87e766b85` 已不在 `git log --all`（被 amend），其「38 files」不复存在。
- 公共面变化（HEAD 实查）：
  - `SessionStreamUnit.detachWebview` / `SessionStreamUnitManager.detachWebview` **已恢复原名**（无 `unattachWebview`）——与提交信息「Public method renames reverted」一致。
  - `SessionStreamUnitManager.requestForceSnapshot` **已删**（仅 manager:41 注释残留 + :486 调用 unit 侧同名方法）；`conversationCapabilitiesInclude`、`encodeHostToConversation` 全仓 0 命中；`ChatConversationWebViewProps` 已撤 `export`（`:190` 为本地 `type`）。
  - 测试观测面变化：`session-stream-unit-messages.test.ts` 的控制消息期望 3→2、3→1，并删除直调 `manager.requestForceSnapshot` 的驱动段（`git show b291aa19e -- <test>`）。
- 数字修正：§1.1 的 `check-methods 55 处/120 类方法` 与 §1.2 的 `check-signatures --changed 132 处/38 文件` 都是历史工作树数字，已按 §8.1 重记；`--changed` 干净树不可复现（0 文件），base 判定改用 `--since/--range`。

### 8.7 P2-21 prettier 新增红

`git show main:<file>` / `git show HEAD:<file>` 副本 + 同一 prettier 命令实测：

| 文件                          | main | HEAD                 | 当前工作树                   |
| ----------------------------- | ---- | -------------------- | ---------------------------- |
| `ChatConversationWebView.tsx` | 红   | 绿                   | 绿                           |
| `session-stream-unit.ts`      | 红   | 绿                   | 绿                           |
| `web/.../snapshot.ts`         | 红   | 绿                   | 绿                           |
| `ChatTabProvider.tsx`         | 红   | 红                   | 红（既有基线，其它组的文件） |
| `StorageConfigScreen.tsx`     | 绿   | **红（唯一新增红）** | **绿（本组已修）**           |

`StorageConfigScreen.tsx` 首版用 prettier `--write` 折了 3 处（两条长 const、`useFocusEffect` 包裹、嵌套三元），全部是换行、无语义变化。其中前两处与 `useFocusEffect` 折行会新增 `check-signatures` 发现，已按下一条复核修正改为 `// prettier-ignore` + 具名回调（嵌套三元折行保留）。

> **验收复核修正（2026-11-10 r2）**：首版折行后 `check-signatures` 对 `StorageConfigScreen.tsx` 新增 3 条发现（`:37/:39 VARDECL`、`:96 ARGS`），而 HEAD 副本同一脚本为 0 处——提交后会进入 spec §7.1「改动路径新增行 0」门禁。现改为：两条长 const 恢复单行并加 `// prettier-ignore`；`useFocusEffect` 的回调抽成具名 `refreshStorageOnFocus`、调用单行。实测：prettier **exit 0**；`check-signatures <file>` **0 处（exit 0）**；对「HEAD + prettier --write」副本同脚本 **3 处（exit 1）**（可复现红）；`git stash create` 的工作树快照 + `--range main...<snapshot>` 中 `StorageConfigScreen` **0 条**。

### 8.8 spec S1-S16 处置

| #   | 处置                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- |
| S1  | spec 不动（`warn` 由 P1-2 代码组补）                                                                                         |
| S2  | §2.2.2 已改「cp 只挂 rows 含该 id 的片；无流时本次不发」                                                                     |
| S3  | §2.2.6 已改「只广播投影可见（未接管）id；空列表只发 force snapshot」                                                         |
| S4  | §3.3 / C26 已明确「外层行类含 assistant + 复用 ThinkingSection + data-text-shell 对齐」                                      |
| S5  | §3.6 行缺失分支已改「带 row/messageId 必须 resync」                                                                          |
| S6  | C12/C14 改「非空优先」；R5 补「新单元从 idle 继承」                                                                          |
| S7  | §4/§9.3/§12 标 deferred + 替代 QA（见 §3）                                                                                   |
| S8  | §7.3 增 `snapshot.ts` 保留行；计数改 18/36（业务 16/30），C31/§12 同步                                                       |
| S9  | §7.1.3/§7.1.4/§7.5 已拆「按文件分别跑」并注明 AMBIGUOUS 信息项                                                               |
| S10 | §9.2 增测试口径注（不降级，P2-18 组补测）                                                                                    |
| S11 | §9.1.1 改为「scroll schema 运行时 parity + T-BR1/T-BR2 声明源 parity + tsc 穷尽双层守护」（r2 修正；不得误删运行时清单用例） |
| S12 | §3.4.1 增 accepted 注（`Promise.resolve().then` 因 Chromium 58 无 `queueMicrotask`）                                         |
| S13 | C12 已改「直接调用 `buildStreamingRows`，引用稳定由内部缓存保证」                                                            |
| S14 | §3.4.1 增 accepted 注（`mergeRows` 私有，经 `handleSnapshotPayload` 覆盖）                                                   |
| S15 | §2.3.3 增「非空 streaming 行直接消失」异常收尾兜底                                                                           |
| S16 | C9#10 的 ready 播种补 `streamToolsRef` + `streamToolsDirtyRef`                                                               |

### 8.9 本节未覆盖

- e2e 仍为 deferred（§3），未在真机运行。
- 全量 jest / typecheck / `build:webview` 未在本组轮次重跑（其它组负责）。
- §8.5 的其它组文件漂移未修；本组只登记。
- spec/交付报告改动是文档，无自动化测试。

## 9. docs-oop 收口（2026-11-11）

> 本组只交付文档：源码零改动。三个 `OOP_CANDIDATE` 按 nm-code-style §9.3/§9.4
> 登记「为何不对象化」；同时登记整文件口径的 keep 清单与 `--all` 签名存量。
> 命令均在仓库根执行，工作树与其它修复组并行，数字以本节实跑时点为准。

### 9.1 OOP_CANDIDATE 3 与不对象化理由

`node .agents/skills/nm-code-style/scripts/check-oop.mjs <三个文件>` → **3 个候选
（扫描 3 个文件）**：

| 文件（check-oop 模块起点）     | funcs | state | 共享状态                                                                    |
| ------------------------------ | ----- | ----- | --------------------------------------------------------------------------- |
| `finished-stream-row-dom.ts:8` | 3     | 1     | `lastStreamRenderSignature×2`                                               |
| `row-windowing.ts:16`          | 11    | 3     | `win×4`、`avgSlotPx×6`、`lastMeasuredWin×3`                                 |
| `snapshot.ts:1`                | 4     | 3     | `pendingChunkAcc×4`、`pendingChunkActions×4`、`appliedSnapshotGeneration×2` |

> 首轮（docs-oop 00:13 时点）为 `12 / 5` 个 funcs；并行的 style-web-runtime 组随后
> 内联了单点函数，第二轮复跑变为 `11 / 4`。候选数与「不对象化」结论不变，下文的
> 行号以第二轮复跑时点为准。

**共同结论：三者都登记为「不对象化」。** nm-code-style §9.3 的对象化门槛是
「共享可变状态 + 至少两个导出函数读写 + 有生命周期/不变量需要封装」，且 §9.4
要求 `OOP_CANDIDATE` 必须处理或给出理由。这三个模块虽然满足前两条，但都是
**WebView runtime 内的单例渲染/协议状态**：没有可构造的第二实例语义，状态本身
也未导出；对象化只会把「模块级单例」换成「对象级单例」，同时把现有的 named
function 调用改成实例穿参。按 §9.3「纯函数命名空间不建类 / 只是为了看起来面向
对象不 OOP」与「不要一边修 bug 一边把模块改成类」，本轮不做对象化。

- **`finished-stream-row-dom.ts`（`lastStreamRenderSignature`，:75）**：
  它是 finished 行 DOM 写入的去重缓存（row id → 四字段签名），由
  `reconcileFinishedStreamingRows`（:105）写入、`pruneFinishedStreamRowSignatures`
  （:84）清理，没有独立业务身份。该文件是从 `snapshot.ts` 拆出来断开
  `stream.ts ↔ snapshot.ts` 循环依赖的（文件头 :1-7；`reseedStreamingRow` 的
  keep-public 注记 :45-47）；改成类需要在 `stream.ts` 与 `snapshot.ts` 之间共享
  同一个实例，正好重新引入拆分前的初始化顺序与所有权耦合。调用方
  `stream.ts:869/914`、`snapshot.ts:375/470/473` 都是无状态入口，没有可放实例的
  装配点。
- **`row-windowing.ts`（`win` :39、`avgSlotPx` :41、`lastMeasuredWin` :43）**：
  它是绑定唯一 DOM 的滚动窗口控制器（`#scroller`/`#rows`/spacer id，:30-31、
  :119、:256-257），一个 WebView 只有一个滚动容器，多实例没有意义。模块里同时
  有可直测的纯函数（`desiredRowWindow` :86、`planRowWindowMove` :110），对象化会
  逼着它们进类或另拆文件，净增壳。测试隔离已经靠 `jest.isolateModules`（:38
  注释）。消费者 `factory.ts:21/66`、`scroll.ts:4/92`、`RowList.tsx:20-24/34`、
  `stream.ts:11/854/916`、`snapshot.ts:16-20/621/631` 全按 named function 调用；
  改实例方法要穿透 ui/runtime 边界，属于跨模块 API 迁移，不是 style-only 收口。
- **`snapshot.ts`（`appliedSnapshotGeneration` :79、`pendingChunkAcc` :80、
  `pendingChunkActions` :91）**：这是分片快照协议的单管线会合状态——当前代次、
  在途收集器、挂起重放动作；不变量是「每个 WebView 一条串行消息管线、代次单调、
  末片原子应用」（:63-91、:116-231）。`invalidateSnapshotPipeline`（:106）必须与
  `handleSnapshotPayload`（:126）操作同一份收集器：`bridge.ts:86` 在 streamReset
  分支先作废在途分片，`bridge.ts:63/66/69` 再分发快照/增量。对象化会把实例所有权
  从 render 模块挪到 bridge，那是协议接线改动；状态未导出，外部也无法分叉实例。

**重新评估条件**（写进报告，避免以后重复讨论）：只有出现「同页多 transcript 实例」
或「分片协议要脱离 DOM/单例做注入式测试」时，才按 §9.4 的迁移顺序对象化；当前
单 WebView + 单 DOM + 单 `state` 的前提不成立。

### 9.2 keep-public / keep-local 清单（整文件口径实跑）

`--changed` 只报新增行，不能代表存量。本轮三种清单口径如下：

- `node .../check-methods.mjs <18 个改动源文件>` → **exit 0**，
  `0 处阻断 / 38 行发现（扫描 100 个类方法 / 18 个文件）`。其中 6 条
  `AMBIGUOUS_METHOD` 是信息项（`snapshot` / `attachWebview` / `detachWebview`
  在 unit 与 manager 各一处）；其余 32 条为类方法保留项（30 keep-public、
  2 keep-local）。
- `node .../check-inline.mjs <18 个改动源文件>` → exit 0，`16 处（扫描 18 个文件）`，
  全部是 `KEEP_LOCAL` 保留项。首轮记录的 5 条 `INLINE_LOCAL`
  （`agent-runner.ts:133/150/1062/1143/1160`）已被并行的 style 组内联；对 `git show
HEAD:` 的 agent-runner 副本实跑仍是这 5 条，证明它们是本迭代前的既有基线。
- `check-methods --changed` 复跑仍是 3 条保留项（`adoptPendingStreams`、
  `finishedStreamCount`、`handleStepCommitted`），与 `tmp/nm-style-changed.log`
  的原始输出一致；3 与 32 的差异来自「新增行 vs 整文件」，不是新红。

**类方法保留项（check-methods，32 条）**

| 文件                                     | verdict     | 符号（行号）                                                                                                                                                                                                                                                                                                                                                                    | 理由摘要（源码 `nm-style` 注记）                                                                                                 |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `session-stream-unit.ts`                 | KEEP_PUBLIC | `settleAsInterrupted`:621、`hydrateFromRunState`:643、`getRateTokensPerSecond`:744、`ingestTextDelta`:857、`ingestThinkingDelta`:866、`ingestUsage`:884、`handleStepCommitted`:920、`ingestToolUse`:952、`clearStreamProjection`:995、`finishedStreamCount`:1018、`registerPendingChild`:1060、`resolveStreamingWebview`:1140、`getWebviewCount`:1183、`loadOlderMessages`:1272 | manager 事件/水合/消息操作的唯一路由入口，以及 spec §7.1.3 点名的测试观测面                                                      |
| `session-stream-unit.ts`                 | KEEP_LOCAL  | `adoptPendingStreams`:1380、`applyStreamSegments`:1502                                                                                                                                                                                                                                                                                                                          | 分别共享 `pendingAdoptions`/`streamRowIds` 的 DB 接管状态机、`partialText/ThinkingSegments` 与 `currentStream` 的 apply 累积阶段 |
| `session-stream-unit-manager.service.ts` | KEEP_PUBLIC | `setUiBridge`:742、`setPrefBridge`:751、`setScopeBridge`:760、`isHydrated`:769、`hydrate`:807、`getSettledProjection`:937、`hasActiveRun`:1007、`requestStreamReset`:1064、`unitCount`:1112、`loadOlderSessionMessages`:1189、`hydrateSessionMessages`:1296、`startRun`:1357、`adoptInterruptedUnit`:1590、`idleMessageViewsSize`:2054、`settledProjectionsSize`:2063           | Provider 跨层注入端口、水合/发起 run 唯一入口、单元注册表与 LRU 状态机、spec §7.1.3 点名观测面                                   |
| `StreamingMessageRow.tsx`                | KEEP_PUBLIC | `StreamBodyHost.shouldComponentUpdate`:50                                                                                                                                                                                                                                                                                                                                       | Preact 类生命周期入口，框架按组件实例动态调用（脚本按自由函数计数为 0，属误报）                                                  |

> 附注：`session-stream-unit.ts:1633 buildStreamRowsProjection` 仍有
> `nm-style: keep-local` 注记，但当前整文件引用是 2 处（:793、:996），已不是
> 单点内联候选，故 `check-methods` 不再输出；注记保留作状态边界说明。

**模块级函数保留项（check-inline，16 条）**

| 文件                          | 符号（行号）                                                                                                                                                                                                                                                                  | refs                                 | 理由摘要                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ChatConversationWebView.tsx` | `propsEqual`:258、`takeSplits`:598、`postBlockSplits`:651、`flushPendingStream`:689、`beginStreamNow`:748、`pushStreamNow`:792、`finishStreamNow`:841、`resetStreamNow`:900、`handleReadyNow`:1282、`handleVisibilityNow`:1341、`onUpstream`:1382、`runStreamStatusFlip`:1635 | 0 call / 1 ref（事件处理器按值引用） | 逐 kind 的流式 ref/累加器/块状态机、seq 分配与终态校正；内联会把共享状态阶段拆散（逐条注记见文件内 `nm-style: keep-local`）                      |
| `snapshot.ts`                 | `mergeRows`:275、`scheduleSnapshotAnomalyResync`:505                                                                                                                                                                                                                          | 1 call / 0 ref                       | `mergeRows` 是 rewind 不变量（I3/I4）的唯一收口；`scheduleSnapshotAnomalyResync` 共享 `state.snapshotResyncAnomalyCount/BackoffUntil` 退避状态机 |
| `stream.ts`                   | `syncStreamBodiesFromState`:241                                                                                                                                                                                                                                               | 1 call / 0 ref                       | 块级渲染不变量（增量岛）的唯一收口，共享 committed/active tail 两组状态                                                                          |
| `stream-markdown.ts`          | `flushStreamRichUpgrade`:137                                                                                                                                                                                                                                                  | 0 call / 1 ref                       | rich 升级定时器共享 `state.flags.richText` 与升级队列；本轮工作树新增的保留项（非本组改动），同属状态阶段保留                                    |

**导出符号 keep-public 标注（find-fake-exports / 源码注记）**

| 文件                         | 符号（行号）                                                                                                                                                                 | 理由摘要                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-stream-unit.ts`     | `SessionStreamUnitStatus`:102、`SessionStreamUnitControlMessage`:187                                                                                                         | spec C4 明确保留的声明面；单元 ↔ webview handle 的线上控制契约                                                                                                            |
| `finished-stream-row-dom.ts` | `reseedStreamingRow`:49、`pruneFinishedStreamRowSignatures`:84                                                                                                               | 快照 seed/gap 恢复的唯一 DOM 写入口；streamReset 的跨模块签名清理入口                                                                                                     |
| `row-windowing.ts`           | `getRowWindowSpacerHeights`:66、`getRowWindowAvgSlotPx`:81、`planRowWindowMove`:110、`retargetRowWindowForPrepend`:181、`measureRowWindow`:261、`notePrependHeightDelta`:355 | 跨层唯一读出口（RowList）/ 测试支持 API（window 测试经 `isolateModules` 断言 EWMA 与窗口策略）/ 跨模块唯一入口（factory、snapshot）；源码注记 :63/:78/:104/:178/:258/:350 |
| `snapshot.ts`                | `invalidateSnapshotPipeline`:106、`handleSnapshotPayload`:126                                                                                                                | bridge 的 streamReset 分支先作废在途分片再 applyStreamReset（C18/P2-8）；wire 分发唯一入口                                                                                |
| `stream.ts`                  | `applyStreamDelta`:656、`applyStreamStatus`:787、`applyStreamReset`:890                                                                                                      | bridge 的 wire 分发入口（每条消息 1 个生产调用点），协议对账面必须保留命名与单测入口                                                                                      |

`find-fake-exports --strict` 对三个 OOP 文件的结果（源文件属 web-runtime 组，
本组只登记、不改）：

| 文件                         | 结果                                                                      | 处置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finished-stream-row-dom.ts` | exit 0，`KEEP=3`                                                          | 无问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `row-windowing.ts`           | 复跑 exit 0，`KEEP=14`（首轮 exit 1，`DEAD=4 INLINE_CANDIDATE=5 KEEP=9`） | 归属 web-runtime 组：首轮 4 条 `DEAD` 里，`ROW_WINDOW_ROWS`/`ROW_WINDOW_BUFFER_ROWS` 是同文件使用的假公开，`RowWindowRange` 是导出签名里的类型引用误报；`getRowWindowAvgSlotPx` 是 **TEST_ONLY 测试支持 API**，不是死导出——生产零引用，测试经 `mods.windowing` 动态访问 9 处（HEAD，`:571/:979/:982/:987/:996/:1008/:1016/:1027/:1045`）/ 11 处（当前工作树），脚本只解析 `import * as ns`、不解析 `const mods = require(...)` 的命名空间变量，故报 0c/0r；源码已按 `nm-style: keep-public` 保留（`row-windowing.ts:78` 注记 / `:81` 函数），`--strict` 因此转 KEEP。5 条 `INLINE_CANDIDATE` 均已按 keep-public 加注记，未内联 |
| `snapshot.ts`                | 复跑 exit 0，`KEEP=4`（首轮 exit 1，`DEAD=3 INLINE_CANDIDATE=3 KEEP=2`）  | 归属 web-runtime 组：首轮 3 条 `DEAD`（`RestoreScroll`/`RowsPayload`/`SnapshotPayload`）都是导出函数签名里的类型引用，属启发式误报；3 条 `INLINE_CANDIDATE`（`handleSnapshotPayload`/`applyPrependPage`/`applyAppendTailRows`）是 `bridge.ts:63/66/69` 的协议入口，已写 keep-public 而非内联                                                                                                                                                                                                                                                                                                                                   |

### 9.3 `--all` 签名存量

`node .agents/skills/nm-code-style/scripts/check-signatures.mjs --all` → **exit 1，
复跑 962 处（扫描 624 个文件）**。首轮（docs-oop 时点）是 **969 处 / 624 个文件**，
与 `cache/fix-gate-after.md:34` 记录的「624 文件 / 969 条签名存量」一致；两轮之间
并行的 style 组清掉了 7 条，962 是同一份全仓既有存量的当前快照，不是本迭代新增。
**不作为本迭代「新增行 0」门禁**；清零需要单独的纯 style commit。本迭代口径仍看
`--changed` → exit 0，0 处（18 个文件）与 `--range main...HEAD` / `--since` 的
0 处（39 个文件，§8.1/§8.3）。`check-inline --all` 同口径：首轮基线 227 处
（`cache/gates.md:213`），复跑 222 处 / 624 文件，同属既有存量。

### 9.4 本组检查记录与未覆盖

| 命令（仓库根）                                                                | 结果                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `node .../check-oop.mjs <finished-stream-row-dom / row-windowing / snapshot>` | 3 个候选（已在上文逐条给不对象化理由）                                      |
| `node .../find-fake-exports.mjs <同一三文件> --strict`                        | 三个文件均 exit 0，`KEEP=3 / 14 / 4`（见 §9.2）                             |
| `node .../check-signatures.mjs <同一三文件>`                                  | exit 0，0 处（3 个文件）                                                    |
| `node .../check-inline.mjs <同一三文件>`                                      | exit 0，2 条 KEEP_LOCAL（`snapshot.ts:275/505`，理由见 §9.2）               |
| `node .../check-methods.mjs <18 个改动源文件>`                                | exit 0，0 处阻断 / 38 行发现（30 KEEP_PUBLIC + 2 KEEP_LOCAL + 6 AMBIGUOUS） |
| `node .../check-methods.mjs --changed`                                        | exit 0，0 处阻断 / 3 行发现（新增行口径）                                   |
| `node .../check-inline.mjs <18 个改动源文件>`                                 | exit 0，16 条 `KEEP_LOCAL`（见 §9.2）                                       |
| `node .../check-signatures.mjs --all`                                         | exit 1，复跑 962 处 / 624 文件（首轮基线 969，见 §9.3）                     |
| `node .../check-signatures.mjs --changed`                                     | exit 0，0 处（18 个文件）                                                   |
| `node .../check-inline.mjs --all`                                             | exit 1，复跑 222 处 / 624 文件（首轮基线 227，存量）                        |
| `prettier --check docs/.../delivery-report.md`                                | 改前红、HEAD 副本同样红（既有基线，表格列宽未对齐）；本组 `--write` 后绿    |
| `jest ... "chat-transcript-row-window"`（旁证，非本组测试）                   | 1 suite / 35 tests 全绿，证明 `getRowWindowAvgSlotPx` 测试通道在用          |

未覆盖：本组无源码与测试改动；三个 OOP 文件的 `find-fake-exports` 复跑已全部
`KEEP`（row-windowing / snapshot 的首轮问题由并行的 web-runtime 组按上表处置完）。
`--all` 的签名与 inline 存量（首轮 969 / 227，复跑 962 / 222）不属于本迭代新增，
清零需单独的纯 style commit。

> 订正记录：首轮报告曾把 `getRowWindowAvgSlotPx` 写成「生产/测试零引用，是真死
> 导出」。复核发现测试 `chat-transcript-row-window.test.ts` 经 `mods.windowing`
> 动态调用 9 处（HEAD）/ 11 处（工作树），实际是 TEST_ONLY 测试支持 API；脚本
> 不解析 `require` 命名空间才漏计。当前源码以 `nm-style: keep-public` 保留
> （`row-windowing.ts:78/81`），未删在用导出。
