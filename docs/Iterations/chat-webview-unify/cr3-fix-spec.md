# CR Fix Spec: ChatConversationWebView onMessage 重构 + ghost resync

## 元信息

- repo：`D:\Dev\Js\novel-master`
- base_sha：`27534b0f2d2a1e2c8f3747cf3b5ed1a3858e36d6`
- head_sha：working tree（未提交）
- prd_path：未提供（本次是行为不变重构 + 已接受的 ghost resync，不是新 PRD）
- spec_path：`tmp/nm-webview-refactor-spec.md`（重构方案）；`docs/Iterations/chat-webview-unify/spec.md`（迭代背景）；`docs/Iterations/logger-normalization/spec.md`（导出日志文案的既有 spec）
- review_round：3（round 3 已完成；本轮为最终 spec-fix）
- dag_version：3
- 状态：fix-spec 收敛完成，待用户签字 D-1/D-2/D-3

**范围说明**：CR 内 tracked 改动 5 个（原 3 个：`ChatConversationWebView.tsx`、`chat-conversation-webview.test.tsx`、`StorageConfigScreen.tsx`；P0 修复新增 2 个：`code-copy.test.ts`、`mermaid-fullscreen.test.ts`）+ 新文件 2 个（`chat-conversation-update-plan.ts`、`chat-conversation-update-plan.test.ts`）+ P1-3 的 2 个 docs（`logger-normalization/spec.md`、`iterations.yaml`）。另有 3 个 `chat-ghost` 插桩 tracked 文件 + 1 个探针新文件，按用户要求保留用于复现，**不在本 CR 提交**（见 P2-11）。

## Must-fix（按 P0 → P1 → P2）

### P0-1 [P0] `code-copy` 契约测试仍断言旧 `if` 链，CI 红

- 维度：G（测试）/ A（spec 契约）
- 文件：`apps/mobile/__tests__/code-copy.test.ts:63-88`（循环在 `:69`）；chat 源码 `apps/mobile/src/components/chat/ChatConversationWebView.tsx:1394-1396`；rich 源码 `apps/mobile/src/components/vfs/RichDocumentWebView.tsx:184`
- 问题：T-CB22 是 `for (const host of [chat, rich])` 的共享断言，断言组件源码包含 `"message.type === 'copyCode'"`。重构只改了 chat 宿主（现在是 `case 'copyCode':` + `handleCopyCode`），**rich 宿主没重构，仍是 `if (message.type === 'copyCode')`**。所以「两个 host 都断言 `case`」会立刻在 rich 那次循环失败；整体删掉源码扫描又会丢掉 `RichDocumentWebView` 唯一的 copyCode 覆盖。
- 改法：按 host 分支断言，不动运行时：
  - chat：断言 `case 'copyCode':` 且用正则 `/case 'copyCode':\s*handleCopyCode\(payload\);/` 钉住接线（只出现两个独立字符串不能证明 case 真调了 handler）；
  - rich：保留原 `message.type === 'copyCode'` 断言；
  - 共享的 `String(...code ?? '')` / `if (code) {` / `Clipboard.setString(code)` / bridge 断言保持不变。
- 验收/测试：`node node_modules/jest/bin/jest.js --config apps/mobile/jest.config.js --silent code-copy` → 5/5 绿；随后 mobile 全量 jest 绿。
- 来源：review round 1（webview-source-review）/ round 2 MF-01

### P0-2 [P0] `mermaid-fullscreen` 契约测试仍断言旧 `if` 链，CI 红

- 维度：G（测试）/ A（spec 契约）
- 文件：`apps/mobile/__tests__/mermaid-fullscreen.test.ts:160-161`；被断言源码 `ChatConversationWebView.tsx:1430-1434`
- 问题：断言 `"message.type === 'mermaidViewerOpened'"` / `"'mermaidViewerClosed'"`；重构后是 `case 'mermaidViewerOpened': handleMermaidVisibility(true)` 与 `case 'mermaidViewerClosed':`。实跑该 suite → **1 failed / 21 passed**。
- 改法：只改测试断言，用正则钉住 case→handler 接线：`/case 'mermaidViewerOpened':\s*handleMermaidVisibility\(true\);/`、`/case 'mermaidViewerClosed':\s*handleMermaidVisibility\(false\);/`；保留 `onWebMermaidViewerOpenChange` 断言；不动组件。
- 验收/测试：该 suite 绿；随后 mobile 全量 jest 绿。
- 来源：webview-source-review / round 2 MF-01（同类）

### P1-1 [P1] ghost resync 在 run 进行中会清空流式正文尾巴

- 维度：B（正确性）/ G（测试）
- 文件：`ChatConversationWebView.tsx:296-297`（`streamGenerating = uiRunning || toolInvoking`）、`:1362-1368`、`:1670-1695`；`apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:220-248`；`apps/mobile/__tests__/chat-conversation-webview.test.tsx:719-771`
- 问题：`else if (coveredWhileForeground && pushesWhileHidden > 0)` 不判 run 是否已收尾，直接 `sendSessionSnapshotNow('restore')`。`applySnapshot` 对非 `preserve` 会重置 `state.stream`；该分支没有重置 `prevStreamTextRef`/`prevStreamThinkingRef`，后续 delta effect 只发 `streamingText.slice(prevText.length)` 的新增部分；plain 模式（`chatRichTextEnabled` 默认 false）快照不带完整尾文。结果：run 进行中打开 FileEditor/工作区再返回，正文尾巴被清成「生成中」，直到 run 收尾的全量快照才恢复。
- 改法：
  - **默认方案 C（推荐）**：`sendSessionSnapshotNow(uiRunning ? 'preserve' : 'restore')`。收尾（`uiRunning=false`）仍走 `restore`，ghost 修复不变；run 进行中走 `preserve`，`applySnapshot` 不重置 `state.stream`，尾巴和滚动位置保留。把 `uiRunning` 加入 `handleVisibility` 的依赖数组（当前 `[sendSessionSnapshotNow]`；`sendSessionSnapshotNow` 虽已含 `uiRunning`，显式补上是 lint 正确性）。
  - **方案 A（C 实测不够时的回退）**：`!uiRunning` 才发 `restore`；run 进行中完全不发快照。代价：run 进行中不校正 DOM，可能停在旧帧直到下一次全量快照。
  - **方案 B（仅产品要求 run 进行中也必须校正 DOM 时）**：resync 时清本地累加器（`clearLocalStreamBuffers`）后重发完整尾文，或直接 `postToWeb({type:'streamDelta', delta: streamingText, html: 现有累加器})`；**不能**直接用 `queueStreamDelta`（会把 `streamTextAccumRef` 再加一遍，html 双份）；富文本块模式还要处理已提交块（`streamCommittedTextPartsRef`），否则块区内容仍丢。
  - 选 `uiRunning` 而不是 `streamGenerating` 的理由：`streamGenerating = uiRunning || toolInvoking`，它不可能在 `uiRunning` 为 true 时为 false；选 `uiRunning` 是为了和快照 `generating`、流式尾巴生命周期同一口径。`streamGenerating` 更宽（含 `toolInvoking`），会延迟收尾 ghost 修复。
- 验收/测试：
  - (i) 组件层：新增 `uiRunning=true` + hidden + pushes + visible 用例，断言补发快照 `{scrollIntent:'preserve'}`（uiRunning 时还带 `generating:true`）、无 `streamReset` 下行、无 `init` 增加；方案 A 断言不发 restore；方案 B 断言尾文完整重发。组件测试只观察 `WebView.postMessage` 下行载荷，**不能**断言 web 内部 `state.stream`。
  - (ii) web 层：用现成 harness（`apps/mobile/__tests__/chat-transcript-snapshot-chunk.test.ts` 的 mock + isolateModules）断言 `applySnapshot({scrollIntent:'preserve'})` 不改 `state.stream`、按距底偏移恢复（`snapshot.ts:226-231,267-277`）；`restore` 重置 stream。对 preserve→restore 做临时变异，确认测试变红。
  - (iii) 保留并确认现有 `uiRunning=false` 收尾用例仍断言 restore 快照、且不重挂。
  - (iv) 滚动：方案 C 的 preserve 已按 `prevOffsetFromBottom` 恢复（不跳底），把这条写进用例/QA；方案 A 的 restore 仍可能跳底，需显式接受或改 C。
  - (v) mobile 全量 jest 绿；真机 QA 见「合并后 QA」。C 只保留 web 已消费的流式状态，不重发 hidden 期间丢掉的 delta；真机若出现「尾巴残缺」而不是「被清空」，升级到方案 B。
- 来源：tests-hygiene-review / round 2 MF-03、MF-10

### P1-2 [P1] 新增组件测试 “F: uiRunning 下的 preserve 仍走 0ms defer 合流” 是 flaky

- 维度：G（测试）
- 文件：`apps/mobile/__tests__/chat-conversation-webview.test.tsx:1745-1772`（失败点在 `:1768`）
- 问题：`await flushMicrotasks()` 不能隔离 0ms 定时器；有时更新排下的 defer 快照会在这一拍就发出，`toHaveLength(baseline)` 随机变成 3 条。实测 16 次单跑复现 2 次（`tmp/run2.log:6-8`）。
- 改法（顺序写死）：真实计时器下 `mountReady()` + `await flushSnapshotChunks()` 把 ready 那一拍的 defer 快照排净 → 取 baseline 前 `jest.useFakeTimers()` → `tree.update(...)` → 同步断言 `toHaveLength(baseline)` → `jest.advanceTimersByTime(0)` → 断言 `baseline + 1`。**启用 fake timers 后不得再调用 `flushTimers`/`flushSnapshotChunks`**（它们用真实 `setTimeout`，会死等：`chat-conversation-webview.test.tsx:204-210,221-230`）。顺手确认 H append / H force-snapshot 的同类“先取 baseline 再断言”写法没有排新的 defer（目前不排，但注释要写清前提）。
- 验收/测试：`jest chat-conversation-webview` 连跑 20 次 0 失败；mobile 全量 jest 绿。
- 来源：review round 2 MF-02

### P1-3 [P1] `StorageConfigScreen` 的「导出日志」文案改动未在 fix-spec 覆盖，且与既有 spec 冲突

- 维度：A（范围）/ K（文档同步）
- 文件：`apps/mobile/src/screens/stack/StorageConfigScreen.tsx:179,190`；对照 `docs/Iterations/logger-normalization/spec.md:40,390,501,572`、`docs/Iterations/iterations.yaml:249`
- 问题：工作树把「导出诊断日志」改成「导出日志」、toast「诊断日志已导出」改成「日志已导出」。这是**用户明确要求**的改动（不是重构 spec §5.3 的要求），但 `logger-normalization` 的 G5/E5/T3 和 `iterations.yaml` 仍写旧文案；fix-spec 之前完全没提这个文件的文案 diff。
- 改法：不回退（用户要求保留改名）；把文案改动拆成**独立提交**，并在同一提交更新 `docs/Iterations/logger-normalization/spec.md`（G5/E5/T3）与 `docs/Iterations/iterations.yaml:249`；重构提交只保留 `maintenanceControlValue` 内联。登记为 Spec deviations D-2。
- 验收/测试：重构提交的 `StorageConfigScreen` diff 只剩内联；文案提交包含新文案 + 文档同步；mobile typecheck/测试绿。
- 来源：review round 2 MF-04

### P2-1 [P2] `openSkillDetail` 测试载荷与生产契约不一致

- 维度：G（测试）
- 文件：`apps/mobile/__tests__/chat-conversation-webview.test.tsx:1416,1427`；契约 `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:240`；生产载荷 `apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts:69-79`；宿主 `useChatTabScope.openSkillDetail:778-779`
- 问题：web 只会发 `{domain:'project', projectId?}` 或 `{domain:'global'}`。测试用 `domain:'skill'`，把第一处改成 `global + projectId:'p'` 也仍是不存在的组合（宿主对非 project 会丢 projectId）。
- 改法：带 projectId 的用 `{domain:'project', projectId:'p'}`；不带 projectId 的用 `{domain:'global'}`；可再加一条 `project` 缺 projectId 的兜底。断言与 `rows-click.ts` 的生产载荷一一对应。
- 验收/测试：该用例绿；三种载荷组合都有覆盖。
- 来源：tests-hygiene-review / round 2 MF-06

### P2-2 [P2] 未知 type 测试绑定了临时探针名 `__nmGhostProbe`

- 维度：G（测试）/ K（调试残留）
- 文件：`apps/mobile/__tests__/chat-conversation-webview.test.tsx:1518`；生产注释 `ChatConversationWebView.tsx:1441`；探针本体 `apps/mobile/src/services/chat-run-ghost-probe.ts:52`
- 问题：探针文件在本 CR 明确排除、将来会整文件删除；测试和注释点名 `__nmGhostProbe`，删除后会悬空。
- 改法：测试改用一个中性的未知 type（例如 `change`），断言 decoder 放行 + 组件静默丢弃；生产注释同步改为泛指未知 type。
- 验收/测试：未知 type 用例仍验证零下行/零遥测；全仓不再有 `__nmGhostProbe` 的测试/注释耦合（探针文件本身除外）。
- 来源：tests-hygiene-review / round 2

### P2-3 [P2] planner 测试覆盖缺口（变异式检查可绕过）

- 维度：G（测试）
- 文件：`apps/mobile/__tests__/chat-conversation-update-plan.test.ts`；planner `apps/mobile/src/components/chat/chat-conversation-update-plan.ts:106-123,146-153`
- 问题（9 类缺口；其中第 5 条 committed 的 every→some 是 skip/consume 两处，第 7 条是覆盖缺口而不是变异）：
  1. `hasInitialScroll: true` 从未断言（O5 只查 `events[0]`，O3/O7 只覆盖 false）——planner 写死 false 仍全过。
  2. `transcript_ready.defaultScrollToBottom: true` 从未断言（O7 是 false）——写死 false 仍过。
  3. `prepend_detected.wasNearBottom: true` 从未断言（M4 用 false，M16 不看事件）——写死 false 仍过。
  4. `append` 只测单行新增——把 `added` 改成 `slice(prevCount, prevCount + 1)` 仍全过。
  5. committed 只测「全命中 / 全不命中」——`every` 误写成 `some` 仍全过（skip-committed 与 consume-committed 各一处）。
  6. 「assistant 纯文本新增」没有用例——把 `messageHasToolUse` 去掉（任何 assistant 都 force-snapshot）仍全过（M7 是 user，M9 是 assistant+tool_use）。
  7. `messages: []` 的 messages-update 分支没测：空↔空（不同数组引用 → `preserve`）与「缩到 0」（→ `stick`）。
  8. 等长 + 首条 id 变化 + hidden 也变：现在走 `snapshot stick`；去掉 `prevFirstId === firstId` 会误走 `hidden-changed`（滚动意图错）。现有 M14 没有 hidden 变化，抓不到。
  9. `force-snapshot` 的 `added.some(...)` 改成 `every(...)`：M8/M9 都是单行 added，抓不到；需要一个「普通文本 + tool_results-only 混合 added」用例。
- 改法：按 9 类逐一补断言/用例；补完后做变异式自检：对 planner 做上述 9 类「故意写错」的临时改动，确认对应测试变红（自检后还原）。**另建议顺手补两条可选变异**：(a) 去掉 `uiRunning && grew` 的 `grew`（run 中 + 等长 + 非 hidden 变化 → append([])，M15 是 uiRunning=false，抓不到）；(b) 从 hidden 判定里去掉 `sameLength`（缩表 + hidden 变化 → hidden-changed(preserve) 而非 stick，M13 没有 hidden 变化）。P2-5 正要简化这些条件，补上这两条能锁住简化前后行为。
- 验收/测试：新增用例绿；9 种变异均能被测试捕获；纯函数测试总数随之增加。
- 来源：planner-review / round 2 MF-08

### P2-4 [P2] planner 测试冗余（M6 与 M18 完全相同）

- 维度：C（质量）
- 文件：`apps/mobile/__tests__/chat-conversation-update-plan.test.ts:211-225`（M6）、`:395-408`（M18）；`:161-173`（M3）、`:309-320`（M12）
- 问题：M6 与 M18 **逐字段相同**（M6 自己就写了 `uiRunning: true`、`committedIds: ['m2']`），不是 fix-spec 之前说的“后者仅多一个 uiRunning”；M3 与 M12 也完全重复。
- 改法：直接删除 M18（或合并标题）；M12 同样合并/删除。不需要补差异化断言。
- 验收/测试：删除后覆盖不变，测试数下降。
- 来源：planner-review / round 2 MF-09

### P2-5 [P2] planner 的死防御条件

- 维度：C（质量）
- 文件：`chat-conversation-update-plan.ts:106-111`
- 问题：`!grew` 与 `sameLength` 同时出现（等长必然 `!grew`）；`previousMessages.length === messages.length` 在唯一调用方恒为 true（`prevCount`/`prevMessagesRef` 永远成对更新，见 `ChatConversationWebView.tsx:1067-1069,1608-1610,1633+1653-1654`），是从旧代码搬来的死防御。
- 改法：简化为实际可达的条件（保留 shrink/等长/增长的真实分支）；若保留防御，写明为什么需要，并在测试中构造该输入。
- 验收/测试：现有 planner 用例全绿；补一条能区分简化前后行为的用例（若确实无可达差异，则记录为「死防御已移除」）。
- 来源：planner-review / round 1

### P2-6 [P2] `intent` 类型过宽 + `scroll_restore.mode` 隐式不变量

- 维度：B/C（类型契约）
- 文件：`chat-conversation-update-plan.ts:45,50`；`ChatConversationWebView.tsx` 的 `sendSessionSnapshotNow` 调用点
- 问题：planner 的 `intent` 类型是全量 `TranscriptScrollIntent`（含永不产生的 `'preserve'`）；`scroll_restore` 的 `mode` 写死 `'offset'`，`'near_bottom'` 在全仓已无生产者。今天等价，但「restore 只在非贴底时发生」这条不变量是隐式的。
- 改法：把 planner 的 `intent` 窄化为 `'stick' | 'restore'`；在 `scroll_restore` 的 `mode` 处加注释说明「restore 只可能 offset」的不变量。`'near_bottom'` 从 telemetry 类型移除是**可选**，若确认全仓无消费者再做。
- 验收/测试：tsc 绿；planner 测试绿；类型/注释与不变量一致。
- 来源：planner-review / round 2

### P2-7 [P2] effect 的 `switch (plan.kind)` 无 `default` / `never` 兜底

- 维度：C（质量）/ B（类型安全）
- 文件：`ChatConversationWebView.tsx:1634-1652`
- 问题：planner 新增 kind 时，effect 会静默不做事，类型检查不会拦住。
- 改法：在 `switch` 末尾加 `default`，用 `const exhaustive: never = plan.kind;`（或等价 assertNever）保证穷尽；保留现有分支行为。
- 验收/测试：tsc 绿；给 planner 的 kind 联合新增一个临时成员时，effect 的编译会报错（自检后还原）。
- 来源：planner-review / round 1

### P2-9 [P2] prettier 结论不完整，且与 check-signatures / 既有基线冲突

- 维度：K（格式）
- 文件：`chat-conversation-update-plan.ts:39,42-43,64,92`；`StorageConfigScreen.tsx:125`；`ChatConversationWebView.tsx`
- 问题（三条）：
  1. 漏了 `StorageConfigScreen.tsx:125`：HEAD 版本（LF）过 `prettier --check`，工作树版本不过——这是**本次新增**的格式红，不是既有基线。内联后的 `value={dbBusy ? ... : '清理数据库空间'}` 需要换行。
  2. 对新模块跑 `prettier --write` 会引入 2 条 check-signatures 发现（`planMessagesUpdate` 的 PARAMS 拆行、第 39 行解构的 VARDECL），与 refactor spec §4.6/§7.1「新模块 signature 必须 0 处」直接冲突。
  3. 「对本次改动文件跑 prettier --write」会把 HEAD 已红的 `ChatConversationWebView.tsx` 整文件重排（实测约 16/15 行），扩大无关 diff。
- 改法：
  - `StorageConfigScreen.tsx:125` 手工折行；
  - planner 用同时满足两套规则的写法（例如把 `MessagesUpdateInput` 缩成短别名 `UpdateInput` 让签名回到 76 列、把长解构拆成两条短 `const`），不要整文件 `--write`；
  - `ChatConversationWebView.tsx` / 组件测试的既有格式红记为基线，不在本 CR 扩大 diff。
- 验收/测试：Windows/CRLF 下必须加 `--end-of-line auto`，否则本机恒假红（prettier 2.8.8 默认 `lf`；连 HEAD 干净的 `snapshot-chunk-bounds.ts` 都会 warn）：
  `node node_modules/prettier/bin-prettier.js --end-of-line auto --config apps/mobile/.prettierrc.js --check apps/mobile/src/components/chat/chat-conversation-update-plan.ts apps/mobile/__tests__/chat-conversation-update-plan.test.ts apps/mobile/src/screens/stack/StorageConfigScreen.tsx`
  或者到 Linux/CI checkout 上跑。`check-signatures` 对 planner 仍 0 处；既有红文件不因本 CR 扩大 diff。仓库级 `format:check` 实测已有 713 行 warn，本 CR 只承诺「新增文件不新增红」。
- 来源：round 1 P2-9 + round 2 MF-05

### P2-10 [P2] `pushesWhileHidden === 0` 与 dirty 重挂分支无组件测试

- 维度：G（测试）
- 文件：`apps/mobile/__tests__/chat-conversation-webview.test.tsx`；`ChatConversationWebView.tsx:1353-1362`
- 问题：`handleVisibility` 的零推送分支与 dirty 重挂分支在组件层都没有测试；dirty 是旧缺口，零推送是本次新增行为面。
- 改法：补两条用例：①前台被盖但隐藏期间零推送 → 不发 restore、不重挂；②dirty（后台/未知 app 态 + 有推送）→ 重置 `prevStreamText/ThinkingRef`、`forceSnapshotOnReady`、`webReady=false`、重挂计数递增。
- ① 的构造前提：`statePushSinceResumeRef` 只在 visible 分支清零（`ChatConversationWebView.tsx:1354`），首次 visible 会把 mount/ready 期间的推送也算进去；必须先发一次 visible 把计数清零，再 hidden→visible，否则永远走不到零推送分支。
- 验收/测试：两条用例绿；覆盖 `:1353-1362` 的两个分支。
- 来源：tests-hygiene-review / round 1

### P2-11 [P2] `chat-ghost` 探针的提交完整性

- 维度：K（提交卫生）
- 文件：`ChatConversationPanel.tsx:70`、`ChatTabProvider.tsx:51`、`session-stream-unit-manager.service.ts:160`；探针本体 `services/chat-run-ghost-probe.ts:1-8`（未跟踪，文件头写“定位后整文件删除，不随功能提交”）
- 问题：fix-spec 之前只说“仍保留、单独清理”。如果按“本 CR 不包含探针”提交，这 3 个文件的 import 指向不存在的模块，CI 直接编译红。
- 改法：在提交层面明确二选一：
  - (a) **CR 提交前回退 3 个插桩文件**，探针文件只留在用户的复现工作树/分支，不进 CR；或
  - (b) 本 CR 把探针文件一并纳入独立诊断提交（接受临时诊断代码进库），并在后续清理。
  - 默认 (a)：CR 提交只含重构 + 测试 + Storage 内联；用户的真机复现分支保留插桩。
- 验收/测试：提交集合里 `git grep chat-run-ghost-probe` 要么为空且无残留 import（(a)），要么非空且探针文件存在（(b)）；CR 提交的 tree 可编译。
- 来源：review round 2 MF-07

### P2-12 [P2] 缺 nm-style 强制报告表

- 维度：K（交付门禁）
- 文件：`cr3-fix-spec.md` K 节 + 实现交付报告
- 问题：项目规则 #179 要求每轮实现最后跑 check-style（改动路径 ≥2 轮 + 一次 `--all`），并在交付报告列未处理的 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE；refactor spec §5.1 还要求列出 `chatConversationWebViewPropsEqual` 的 KEEP_LOCAL 与两个 planner 的 keep-public。fix-spec 之前只把 check-style 当“建议记录项”。
- 改法：实现交付报告必须包含一张 nm-style 表：按 refactor spec §7.1 的分项门禁（`check-inline` + `find-fake-exports --strict` + `check-signatures`（新模块整文件 0））循环 ≥2 轮到 PASS，收尾跑一次 `check-style --all` 作为记录项（既有基线按 K-2 说明）。`check-inline` 只产出 INLINE_LOCAL/KEEP_LOCAL，不产出 DEAD/FAKE_PUBLIC/TEST_ONLY；后四类由 `find-fake-exports --strict` 提供。表中必须列 KEEP_LOCAL（`chatConversationWebViewPropsEqual:221`）、两个 planner 的 keep-public（`:38,:92`），以及未处理的 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE。
- 验收/测试：交付报告附该表；PASS/未处理项均有证据。
- 来源：项目规则 #179 + refactor spec §5.1 + round 2 MF-12

## Spec deviations

- **D-1（open）P1-1 方案 C/A vs refactor spec §9.5**：`tmp/nm-webview-refactor-spec.md:970-976` 明确列了 visibility 四处「必须逐字保留」，第 3 条就是 `else if (coveredWhileForeground && pushesWhileHidden > 0) { void sendSessionSnapshotNow('restore'); }`。方案 C/A 是有意的行为变更，不是“范围外”。代价：方案 C 会重发全量 rows 校正 DOM，只有流式尾部走本地保留——真正的风险不是「停在旧帧」，而是 hidden 期间丢掉的 delta 不会被补发（表现为尾巴残缺，而不是被清空）；方案 A 则完全不发，可能停在旧帧。出现残缺时升级到方案 B。需用户/owner 拍板；QA 覆盖「run 进行中返回」与「收尾后返回」两种时序。
- **D-2（open，用户已要求）StorageConfigScreen 文案 vs `logger-normalization` spec**：`docs/Iterations/logger-normalization/spec.md` G5/E5/T3 与 `iterations.yaml:249` 仍是「导出诊断日志」。文案改名是用户明确要求，回退不是选项；按 P1-3 拆独立提交并同步文档。
- **D-3（open）P2-9 prettier vs refactor spec §9.6「别跑格式化」**：fix-spec 事实上推翻了 §9.6（仓库有 `.prettierrc.js`，CI Format 是 blocking）。以 fix-spec 为准，但只修本次改动文件的新增格式红，不整文件重排；同时遵守 check-signatures 0 的约束。仓库级 `format:check` 本机实测已有 713 行 warn（CRLF + 默认 lf），所以本 CR 只承诺「新增文件不新增红」，本地验收加 `--end-of-line auto`。
- **D-4（已豁免）P2-8 vs refactor spec §4.3**：spec 明确写了「`some` 免分配，语义等价；k 很小、成本可忽略」，P2-8 自己也承认无实际影响；不改回 Set。
- **范围更正**：fix-spec 之前说“refactor spec 的等价性结论只覆盖 planner/effect 抽取”不成立；§9.5 明确覆盖 visibility handler 与依赖数组，P1-1 必须按 D-1 登记。

## Open questions / 待拍板

- OQ-1（已关闭）：resync 的滚动语义。方案 C 的 preserve 已给出不跳底的实现依据（`snapshot.ts:226-231,267-277`：按 `prevOffsetFromBottom` 恢复），P1-1 验收已写入；不需要再接受跳底。方案 A 的 restore 仍会 `fromBottom offset 0`，若选 A 需显式接受。
- OQ-2（需 owner 拍板）：建议默认 C；注意 C 只保留 web 已消费的流式状态，不重发 hidden 期间丢掉的 delta（表现为尾巴残缺而非被清空）。出现残缺时升级到 B。D-1 已记录。
- OQ-3（建议 (a)）：CR 提交前回退 3 个探针插桩文件，探针只留在复现分支；否则 CR tree 编译红（`git grep chat-run-ghost-probe` 命中 3 个 tracked import）。
- OQ-4（建议 blocking）：mobile 全量 jest 实测 257 suites / 2167 tests、约 17s；只有 P0-1/P0-2 两处红，正是它暴露的；建议写成 blocking 本地 gate。
- OQ-5（范围外）：0ms deferred 快照的闭包新鲜度——defer 定时器捕获排程那一拍的 `sendSessionSnapshotNow`，触发前 messages 又变会发旧 rows。HEAD 就是这样，本 CR 没改；它是 P1-2 flaky 的温床，建议单独立项。
- OQ-6（非 must-fix）：`handleUpstream` 经 `handleVisibility → sendSessionSnapshotNow` 传递依赖 `messages`/`uiRunning`，`onMessage` prop 身份会比 HEAD 更频繁地变；评审认为不影响正确性，是否要做 memo/ref 镜像优化由实现方评估。

## 已豁免（用户确认不修）

- P2-8（committed Set）：refactor spec §4.3 已明确接受 `some`，不改回 Set（D-4）。
- `scroll_restore.mode` 的 `'near_bottom'` 类型移除：可选，不做（P2-6 只窄化 + 注释）。
- `handleUpstream` 的 memo/ref 优化：OQ-6，非 must-fix。
- 测试文件 3 个既有 `INLINE_LOCAL`（`closeChunkGate:80`、`appStateChangeListener:526`、`bigMessages:1028`）：diff 前就存在，`check-style` 默认排除 `__tests__`；如需测试样式清理另开任务（K-6）。

## 合并后 QA（manual_user）

- 真机：run 进行中打开 FileEditor / 工作区再返回 → 正文尾巴不被清空；滚动位置不被拉到底（若方案 C 的 preserve 不满足，明确记录并改方案）。
- 真机：run 收尾后再返回 → 「生成中」消失（收尾 ghost 修复仍生效）。
- mobile 全量 jest + tsc + 分项 nm style 全绿（不只两套 chat-conversation）。
- 若 P1-1 采用方案 C/A，需重新构建 release APK（当前 v1.5.47 带的是未加守卫的 resync）。

## K 节建议（下游执行时闭合）

- K-1：nm-style 强制报告表（见 P2-12）：按 §7.1 分项门禁（`check-inline` + `find-fake-exports --strict` + `check-signatures`（新模块 0））≥2 轮到 PASS，收尾 `check-style --all` 记录；列 `chatConversationWebViewPropsEqual` KEEP_LOCAL、`planOpenSnapshot`/`planMessagesUpdate` keep-public、未处理 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE。RD 证据：组件 `check-inline` 1 处 KEEP_LOCAL；planner `find-fake-exports` KEEP=2；planner `check-signatures` 0；组件/Storage `find-fake-exports` 无 DEAD/FAKE_PUBLIC/TEST_ONLY。
- K-2：`check-signatures` 126 条存量、`check-style --all` 的 1074/227/356 存量发现是仓库既有基线；本 CR 只要求改动文件的分项检查通过。
- K-3：本 CR 会触碰的 5 个 tracked 文件（component、component test、Panel、Provider、mermaid test）在 HEAD 即 prettier 不合；Storage 与 manager 在 HEAD 是绿的。仓库级 `format:check` 实测已有 713 行 warn；本 CR 只承诺「新增文件不新增红」，不扩大格式清理（本地跑必须加 `--end-of-line auto`，见 P2-9）。
- K-4：`chat-ghost` 插桩按 P2-11 处理；验证完成后单独清理，不随功能提交。
- K-5：修复完成后重跑 **mobile 全量 jest**（不只两套 chat-conversation suite）+ tsc + 分项 nm style；当前工作流的 gate 只覆盖了两套 chat-conversation 测试，这是 P0-1/P0-2 漏网的直接原因。
- K-6：测试文件既有 INLINE 与 `check-style` 的测试排除策略，另开测试样式清理任务。
- K-7：0ms deferred 快照闭包新鲜度（OQ-5）单独立项，不在本 CR 改。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | no（3 轮完成；待用户签字 D-1/D-2/D-3） |
| fix_spec_path | `docs/Iterations/chat-webview-unify/cr3-fix-spec.md` |
| dag_version / review_round | 3 / 3 |
| P0 / P1 / P2（已写入 fix-spec） | 2 / 3 / 11 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open：D-1（方案 C/A vs §9.5）、D-2（文案 vs logger spec）、D-3（prettier vs §9.6）；用户签字后 ready |
| C-orch | N/A（单文件重构 + 测试断言，无跨端编排变化） |
| C 类合并后 QA | 真机 resync 尾巴/滚动 + 收尾 ghost（见上） |
