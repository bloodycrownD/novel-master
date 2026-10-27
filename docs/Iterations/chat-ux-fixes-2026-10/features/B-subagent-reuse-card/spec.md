---
date: 2026-10-27
iteration: chat-ux-fixes-2026-10
feature: B
scope: mobile-only
depends_on: []
---

# B · 子代理复用后卡片可点与内容新鲜 技术规格（SPEC）

> 本 feature 即总纲中的原 F2。**范围限 mobile**：desktop 的 pending 注入缺口是既有挂账，不在本迭代修。
> 本迭代无独立 PRD——需求为用户口述，原话见「需求来源」。

## 需求来源

用户口述（2026-10-27，本会话）原话：

> 「对于一个子代理，第一次是可以正常点击访问的，但是假如复用 sessionid 的话，这个子代理无法点击进入访问。」

用户追加确认（2026-10-27）：三条 bug 全部只发生在 mobile 端。

路线拍板（2026-10-27，AskUserQuestion）：**H1 + H2 全修**，不做 desktop 对称修。

## 设计目标

1. `task` 带 `sessionId` 复用既有子会话时，**执行中的 pending 卡片可点进入**，不再依赖「跑完才有 result.meta」。
2. 复用产生的第二次 run，其流式内容**实时到达子会话屏**，不被 30s 宽限期的旧 settled 单元吞掉。
3. 子会话屏内的**孙任务** pending 卡片同样可点（同一 prop 顺手补齐）。

## 非目标

- 不修 desktop 的 pending 注入缺口（desktop `renderer/features/chat/message-blocks.ts:150-176` 无 pending 注入链，pending 卡本就不可点——既有挂账，见 `docs/Iterations/ui-card-unify-2026-10/prd.md:128`）。
- 不改 core 的 `task` 输出契约 `{text, subagentSessionId, stopped?, failureReason?}`、不改 `tool_result.meta` 白名单、不改事件 allowlist（选了「UI 侧读 `tool_use.input.sessionId`」而非「core 复用分支补发 linked 事件」）。
- 不改导航链路（`useChatTabScope.ts:743-755` 的 `navigate('SubagentSessionView', {...})`）——「同参数 navigate 复用路由导致第二次跳不动」的假设证据不足（正常 back 会 pop，且从父屏点击时子屏不是当前 route），不作为修复项。
- 不改 `runChildAgent` 的并发互斥（`abortRegistry.tryRegister`，`run-agent-turn.ts:1191-1206`）。
- 不删 `pendingSubagentSessions` 的 title 映射（新建路径的 pending 可点仍依赖它）。

## 现状实现摘要

### 端到端链路（现状）

1. 父 agent 调 `task`。新建走 `createChildSession` → publish `EVENT_SUBAGENT_CHILD_SESSION_CREATED`（`run-agent-turn.ts:943-956`）；**复用路径不 publish 任何事件**——解析在 `packages/core/src/domain/tool/builtin/subagent-tool.ts:155-178`（`resolveResumeSessionId` 的四态校验），分支在 `:263-266`（`input.sessionId?.trim()` 命中则复用）；`run-agent-turn.ts:1191-1206` 只做 `tryRegister` 硬互斥。
2. 子 agent 跑完 `task` 返回 `{text, subagentSessionId}`，`buildToolResultBlock` 写入 `tool_result.meta.subagentSessionId`（`build-tool-result-block.ts:220-221, 246-272`）。
3. mobile 把消息转 transcript 行：有 `tool_result` 时 `subagentSessionId = result.meta.subagentSessionId`；**无 result（pending）时只按 `description || prompt.slice(0,40)` 去 `pendingSubagentSessions` 匹配 title，完全不读 `use.input.sessionId`**（`apps/mobile/src/components/chat/message-blocks.ts:236-260`，已抽查源码核实）。
4. `pendingSubagentSessions` = `unitView.pendingChildrenByTitle`，由 manager 订阅 `child-created` 事件填充，父 run settle 时清空（`ChatTabProvider.tsx:473-474`、`session-stream-unit-manager.service.ts:1437-1454`、`session-stream-unit.ts:781-850`）。
5. WebView 渲染：`hasSubagent = tool.subagentSessionId != null` 才挂 `data-action="open-subagent-session"` 与 `data-session-id`（`web/chat-transcript/webview/ui/render/ToolGroup.tsx:52-62, 76-94`）；点击经 `rows-click.ts:64-68` 上抛桥消息，宿主 `ChatConversationWebView.tsx:1340-1341` 调 `openSubagentSession`。
6. `SubagentSessionScreen` 用 `sessionId` 从 `manager.snapshot` / `loadSessionTailMessages(sessionId)`（**非 force**）或 `runtime.messages.listBySession` 取消息，**无 session 存在性 / parentSessionId / agentId 前置守卫**；`displayMessages = unitView?.messages ?? messages`（`SubagentSessionScreen.tsx:313`）。

### 根因 H1（证据强度：高）——复用后 pending 卡片没有 subagentSessionId

复用路径不调 `createChildSession`，因此不发 `child-created` → `pendingChildrenByTitle` 不新增/不刷新；而 pending 分支只按 title 匹配，复用调用的 description 通常与首次不同，且新一轮父 run 开始时旧映射已被 `clearPendingChildren` 清空。结果：执行期间卡片 `canOpen=false`、WebView 不渲染 `data-action`，**点击无任何反应**；完成后 `result.meta` 到达才恢复可点。这正是「第一次能点、复用后点不动」。

附带隐患：同一父 run 内若复用的 description 与另一个新建 task 相同，title 映射会指向新建 child，复用卡可能跳到错误子会话（`session-stream-unit.ts:789-828`）。

### 根因 H2（证据强度：中高）——30s 宽限内 settled 子单元吞掉第二次 run

首次子 run 结束后其 consumptive unit 进入 settled 并保留 30s（`session-stream-unit.ts:70` 的宽限常量、定时器 `:1270-1275`）。复用 run 的 `RUN_STARTED` 到达时 manager 找到旧 unit，`markRunning` 因状态不是 `starting` 返回 false，`onRunStarted` 直接 return（`session-stream-unit-manager.service.ts:1374-1376`；`session-stream-unit.ts:456-463` 的 `markRunning` 只接受 `starting`）。后续 child delta 被 `ingestDelta` 的 runId/status 守卫拒绝（`session-stream-unit.ts:1107-1112`），STEP 被 `handleStepCommitted` 守卫拒绝（`:756-763`），FINISHED 因 runId 不匹配提前 return（manager `:1493-1499`）；子会话屏 `displayMessages` 命中旧缓存 → 用户看到首次 run 的旧消息、无实时流，30s 后单元销毁才自愈。

主 run 已有「settled 旧单元替换吸收」的正确先例（manager `:1180-1203`：`takeWebviewHandles()` + `removeUnit` + 新 unit `begin()`），consumptive 子会话路径缺同款逻辑。

## 实现方案

### D2-1 pending 卡片读 `input.sessionId`（H1，主修复）

`apps/mobile/src/components/chat/message-blocks.ts` `toolCallViewFromUse` 的 pending 分支（`:236-260`）：

```ts
if (use.name === 'task') {
  // ① 先读 input.sessionId：不受 pendingSubagentSessions 是否传入影响
  const fromInput =
    typeof use.input?.sessionId === 'string' ? use.input.sessionId.trim() : '';
  if (fromInput.length > 0) {
    return {...view, subagentSessionId: fromInput};   // 复用场景唯一可靠来源
  }
  // ② title 回退仍保留原 guard：没传 map 时不做匹配（现状语义不变）
  if (options?.pendingSubagentSessions) {
    // ……既有 title 匹配逻辑原样保留（新建路径的 pending 可点仍依赖它）
  }
}
```

伪代码必须保留 `options?.pendingSubagentSessions` 这一层：直接照抄成无守卫的 `options.pendingSubagentSessions` 会在「有 options 但没传 map」或 `options` 为空时抛错。

- **守卫顺序**：pending 分支现有外层条件是 `use.name === 'task' && options?.pendingSubagentSessions`（`message-blocks.ts:245`）。`input.sessionId` 的读取与 `subagentSessionId` 注入必须**提到这个 map 判定之外**——否则没传 `pendingSubagentSessions` 的调用方（如当前未补 prop 的子会话屏）即使带着 `input.sessionId` 也读不到。
- 复用调用的 `tool_use.input` 原样持久化（`parse-message-content.ts:92-113`），`input.sessionId` 一直在。
- `tool_result` 到达后仍以 `result.meta.subagentSessionId` 为准（`:262-275` 不动）。
- 单点修复同时覆盖主屏与子会话屏内**复用的**孙任务卡（新建的孙任务仍依赖 title 映射，要等 D2-3.2 补 prop 才可点），并消除 H1 的撞名隐患。

### D2-2 settled 子单元替换吸收（H2）

`apps/mobile/src/services/session-stream-unit-manager.service.ts` 的 `onRunStarted`（`:1364-1385`）。现状是 `markRunning` 失败就直接 `return`（`:1374-1376`），改成「**消费型 + settled** 才替换吸收」：

```ts
if (!unit.markRunning(payload.runId)) {
  if (!this.consumptiveSessions.has(payload.sessionId)) return;   // 主 run 的 settled 单元不复活
  if (!isSessionStreamUnitSettled(unit.getStatus())) return;       // 哨兵：running（另一 run 在飞，core 已硬互斥）/starting 保持原样
  const inheritedHandles = unit.takeWebviewHandles();
  this.removeUnit(payload.sessionId, unit);                       // 注意：会 delete consumptiveSessions（:1724）
  unit = this.adoptConsumptiveUnit(payload.sessionId, payload.projectId);  // 重新 add 标记 + begin()（:1397-1414）
  for (const handle of inheritedHandles) unit.attachWebview(handle);
  void this.loadSessionTailMessages(payload.sessionId, {force: true});  // 必须调用：adopt 不会自动加载
  unit.markRunning(payload.runId);
}
```

> 状态判定必须用 `isSessionStreamUnitSettled(unit.getStatus())`（谓词 `session-stream-unit.ts:96-102`，manager `:136` 已 import）。状态机里**没有 `'settled'` 这个字面量**，取值只有 `idle | starting | running | interrupted | finished | failed`（`session-stream-unit.ts:82-93`）；写 `=== 'settled'` 会 TS 报「无重叠比较」，绕成字符串比较则条件恒真、替换分支永不执行，H2 静默不修。

四件「漏一件就静默坏」的事，逐项写清：

1. **必须走 `adoptConsumptiveUnit` 而非照抄主 run 的 `new SessionStreamUnit`**。`removeUnit` 在 `:1724` 执行 `consumptiveSessions.delete(sessionId)`；若直接新建，第二个子 run 会被当成发起型 run——`onRunStarted` 会 `ensureWritethrough` + `upsertRunStateQuietly` 写 running 行（`:1377-1383`），FINISHED 时还会发 `notifyAgentRunFinished`（`:1508-1521` 的消费型分支被绕过）。`adoptConsumptiveUnit` 会重新 `consumptiveSessions.add`（`:1411`）。
2. **句柄迁移**：`attachWebview` 要逐个重挂继承来的句柄（主 run 先例 `:1200-1202`）。漏掉则子会话屏的 webview 句柄在替换瞬间丢失，H2 的「实时到达子会话屏」不成立。
3. **消息预热只有异步一条路**：`SessionStreamUnit` 没有公开的 messages 注入入口（`applyMessages` 是 private，`:1081-1093`），唯一可用的是 `manager.loadSessionTailMessages(sessionId, {force: true})`（manager `:912-923` → `unit.loadTailMessages`）。所以替换后存在一段 DB 往返空窗，屏侧 `displayMessages` 会先落空数组；可接受，但**验收断言必须 `await` 一次**再断言消息。若想彻底消掉空窗，需新增公开 `adoptMessages()` 并把 `session-stream-unit.ts` 列入影响面——本 SPEC 默认走异步路线。
4. **消费型守卫**：`onRunStarted` 本身不查 `consumptiveSessions`（`:1366-1375` 取到 unit 就 `markRunning`），所以替换分支必须自带该判定——否则主 run 的 settled 单元收到迟到/重复的 `RUN_STARTED` 会被复活，后续 delta 落进一个永远等不到 FINISHED 的单元。

- 后续 delta / STEP / FINISHED 因新 unit 的 runId 匹配而全部生效。delta 的真实守卫在 `session-stream-unit.ts:1107-1112`（`ingestDelta`），STEP 在 `:756-763`（`handleStepCommitted`），FINISHED 的 runId 不匹配早退在 manager `:1493-1499`——三处**均无需改动**。
- 30s 宽限销毁不动：定时器在 `session-stream-unit.ts:1270-1275`，销毁回调 `handleGraceExpired` 在 manager `:1674-1680`；替换吸收后旧 unit 已被移除，宽限计时自然终止。

### D2-3 子会话屏兜底

`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`：

1. 挂载加载改 `manager.loadSessionTailMessages(sessionId, {force: true})`——规避宽限窗口期读到旧缓存（manager 修复后非必需，属纵深防御）。
2. 向屏内 WebView 补传 `pendingSubagentSessions`（来自 `unitView.pendingChildrenByTitle`）——现状没传，孙任务 pending 卡在该屏永远不可点。

### D2-4 影响面清单

| 文件 | 类型 |
|---|---|
| `apps/mobile/src/components/chat/message-blocks.ts` | 改：pending 分支 `input.sessionId` 优先 |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | 改：`onRunStarted` 对 settled unit 替换吸收 |
| `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx` | 改：force 加载 + `pendingSubagentSessions` prop |
| `apps/mobile/__tests__/message-blocks.test.ts` | 补 F-B1/F-B2（pending 分支的测试放这里：该文件 `:1038` 有 `toolCallViewFromUse` 的调用点，但**全仓目前没有任何 `pendingSubagentSessions` / `subagentSessionId` 断言**，F-B1/B2 属全新增用例） |
| `apps/mobile/__tests__/build-transcript-rows.test.ts` | 可选：若要在端到端层锁，补一条 `buildTranscriptRows(messages, options)` 用例 |
| `apps/mobile/__tests__/session-stream-unit-pipeline.test.ts`（及 `-messages`） | 补 F-B3：同一 childSessionId 二次 `RUN_STARTED` 全部生效 + 消费型不写持久层/不发通知 + 替换后历史消息仍在 |
| `apps/mobile/__tests__/subagent-session-screen-metrics.test.tsx` | 补 F-B4：force 加载调用与 prop 传递 |

**不动**：`packages/core/**`、`apps/desktop/**`、`rows-click.ts`、`ToolGroup.tsx`、`useChatTabScope.ts`、`ToolCallCard.tsx` / `ToolCallGroupCard.tsx`（RN 组件当前无生产 import，实际渲染走 WebView `ToolGroup`）。

## 验收清单

牙齿判据：具体可执行、实现错则红、实现对则绿。

- **F-B1**：pending task `input.sessionId='kid-1'`、调用方**完全不传 `pendingSubagentSessions`**（不是传空 Map——空 Map 仍让外层 `options?.pendingSubagentSessions` 为真，会把「读取写在外层条件里」的错误实现放过）→ row 携带 `subagentSessionId='kid-1'`。牙齿：删掉 `input.sessionId` 读取分支即红；把读取塞回 `pendingSubagentSessions` 判定之内亦红。
- **F-B2**：pending task 无 `input.sessionId`、title 映射命中 → 仍可点（回归保护既有新建路径）。牙齿：删掉 title 回退即红。
- **F-B3**：同一 childSessionId 首次 run FINISHED 后 30s 内收到第二次 `RUN_STARTED` → unit 重建、新 runId 生效、后续 delta/STEP/FINISHED 全部入新 unit、**旧 partial / 指标 / 注入标记不残留**。三件副作用断言，**但必须先补齐 harness，否则断言空转**：pipeline 测试现有 manager 既没注入 `runStateService` 也没 `setPrefBridge`，runtime 里也没有 `messages`（`__tests__/session-stream-unit-pipeline.test.ts:87-95`）。缺依赖时：`upsertRunStateQuietly` 无 store 直接 return（manager `:1781-1785`）、`notifySettled` 无 prefBridge 直接 return（`:1573-1580`）、`loadTailMessages(force)` 无 store 直接返回空数组（`session-stream-unit.ts:1057-1060`）。要求补齐三项：注入 `runStateService` mock、`setPrefBridge({isNotificationEnabled: async () => true})`（接口返回 Promise<boolean>，写 `() => true` 会漏 typecheck）、`runtime.messages.listBySessionTail` mock。然后断言 **不写 `session_run_state` 行**、**不发完成通知**、**`await` 一次后 `snapshot().messages` 仍含首次 run 历史**。「不发通知」要给可执行方案：`notifyAgentRunFinished` 是模块级 import（manager `:127`），不是 spy，且 `agent-finished-notification.ts:323-329` 在 iOS/前台会直接 return——做法是 `jest.mock('…/agent-finished-notification')` 后断言未被调用（注意该模块还导出 `resetKeepAliveStateForTests`，mock 时一并保留），或改断 `notifee.displayNotification` 并在 Android/后台态下跑。「旧 partial / 指标 / 注入标记不残留」也要写出口：断言 `snapshot().partialText` / `partialThinking` 为空、`snapshot().metrics` 回到新 run 初值、以及 handle 的注入次数（沿用 pipeline 测试既有的 handle 辅助，不要只写在文字里）。牙齿：还原「`markRunning` 失败即 return」即红；用 `new SessionStreamUnit` 替代 `adoptConsumptiveUnit` 时持久层/通知断言即红；漏句柄迁移时子屏注入断言即红。
- **F-B4**：`SubagentSessionScreen` 挂载调用 `loadSessionTailMessages(sessionId, {force: true})`，且向 WebView 传 `pendingSubagentSessions`。
- **F-B5**（真机）：同一子会话连续两轮 `task`；第二轮执行中点卡片能进入并看到流式输出；完成后再次进入内容完整。
- **F-B6**：既有 core 测试不回归——`packages/core/test/tool/subagent-tool-session-file.test.ts`（T-TS1：复用返回同一 id）、`subagent-meta-passthrough.test.ts`、`extract-subagent-session-id.test.ts` 全绿（本 feature 不改 core，属守护）。

## 风险点

1. **H2 假设中高置信**：若真机复测发现「复用后点不动」仅由 H1 引起，D2-2 仍是独立缺陷修复（二次 run 旧快照/无实时流），但优先级可降。
2. **UI 侧直接信任 `input.sessionId`**：在 core 校验前，用户可点到不属于当前父的 sessionId（`SubagentSessionScreen` 无归属守卫，进屏后仅只读浏览）。本地应用风险低，记为已知限制；若要严格，须在点击 handler 异步 `sessions.get` 校验 `parentSessionId` 后再导航（本迭代不做）。
3. **替换吸收的边界**：仅在 settled 态替换。若某次 `RUN_STARTED` 恰落在旧 unit 销毁与新建之间的窗口，`units.get` 可能拿不到旧 unit——走既有 `adoptConsumptiveUnit` 创建路径，行为等同全新 run，可接受。
4. **`pendingSubagentSessions` 仍是 title 键的 Map**：同 title 覆盖旧 child 的既有语义不变；`input.sessionId` 优先后，复用卡片不再受影响，但纯新建且 description 撞名时仍可能映射到错误的 pending child（既有缺陷，未扩大）。
5. **子会话屏 force 加载成本**：每次进屏多读一次尾部消息；子会话屏本身低频，接受。

## 待确认问题

1. D2-3 第 2 项「子会话屏补 `pendingSubagentSessions`（孙任务卡可点）」是否纳入——默认纳入（一个 prop 成本）；不要则删该子项与 F-B4 的后半断言。

## 落地

1. 按 RULE 开迭代 worktree 分支后动代码；本 SPEC 已落主仓 `docs/Iterations/`，提交由用户决定。
2. 实现前先 `git grep` 复核本文行号（基于 2026-10-27 main）。
3. 验收命令（**先 build core**——mobile jest 把 `@novel-master/core/*` 映射到 `packages/core/dist`，干净 worktree 不 build 会 module-not-found）：

```
cd /d D:\Dev\Js\novel-master && npm run build -w @novel-master/core
cd apps/mobile && npx jest \
  __tests__/message-blocks.test.ts __tests__/build-transcript-rows.test.ts \
  __tests__/session-stream-unit-pipeline.test.ts __tests__/session-stream-unit-messages.test.ts \
  __tests__/subagent-session-screen-metrics.test.tsx --maxWorkers=2

cd packages/core && node scripts/run-tests.mjs \
  test/tool/subagent-tool-session-file.test.ts \
  test/tool/subagent-meta-passthrough.test.ts \
  test/service/agent/extract-subagent-session-id.test.ts
```

4. 收口后 changelog 走 `novel-master-changelog` skill 的 Unreleased 段（一条）。
