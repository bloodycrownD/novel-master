---
date: 2026-10-05
---

# 转录域会话隔离（transcript-session-isolation）技术规格（SPEC）

## 设计目标

修复 chat-webview-unify SPA 化后的并发会话消息串台（用户报障「并发会话会出现 msg 混乱」，2026-10-05 brainstorm 三路诊断 + 两路修复向探索定案）。四条已证实串台路径全部闭合：

- **P1**：切会话不清 `pendingSnapshotRef`/`streamActiveRef`/`inFlightSnapshotGenerationRef` → 旧闭包快照以新代次整份覆盖新会话文档。
- **P2**：`deferredSnapshotActionsRef` 跨会话存活被原序重放 → 旧会话行追加到新会话转录尾部。
- **P3**：切到 `messages.length === 0` 的会话时开屏快照早退（`ChatConversationWebView.tsx:2189-2192`）→ web 文档残留旧会话行 + 流式尾块，新会话 delta 续写在旧尾块上（「A 的半截话 + B 的话接在一起」）。
- **P4**：`useInterruptedPartialCommit` 无会话身份、`readyEpoch` 去重键切会话不失效 → 中断合成行错打/丢失。

**需求来源**：用户口述（本 spec 直接承接 2026-10-05 brainstorm 诊断，诊断全文见 `docs/apm/memory/20261005-chat-concurrent-msg-mixup-brain-storm.md`）；无独立 PRD。

**非目标**（明确不做）：

- 不动 `SessionStreamUnitManager` / `SessionStreamUnit` / view-cache —— 诊断实锤该层按 `payload.sessionId` 路由 + `runId` 守卫，与 desktop 守卫语义等价，是干净的；动了反而破坏 T-U13 跨会话并行隔离。
- 不动 `ChatTranscriptBridge.ts` 的 `HostToTranscriptMessage` 联合 —— 旧 chat-transcript 包已退役出包，死类型面。
- 不改桥 v 号、不加新下行 type —— 全部是既有 type 的可选 payload 字段。
- 不做 web 侧「基线未建立时用首条消息建基线」的状态机 —— 用「基线空则放行」的保守口径（见总体方案③）。
- desktop 不在本迭代范围（desktop 无 SPA 化，理论上免疫）。

## 总体方案

三层防御，从治本到兜底：

### ① 宿主侧：补全 `[sessionKey]` 切会话清场（堵死 P1/P2 的发生源）

`ChatConversationWebView.tsx:1884-1887` 的清场 effect 现在只调 `resetComposerBaselines()` + `clearLocalStreamBuffers()`。补入以下清理（照抄同文件 `:2065-2078`「切视图中止」effect 的既有写法与顺序纪律——先掐定时器再丢档，最后顶代次）：
| ref（声明行） | 清理动作 | 堵的路径 |
|---|---|---|
| `snapshotDeferTimerRef`（:600） | `clearTimeout` + 置 null | P1 定时器分支 |
| `pendingSnapshotRef`（:603） | 置 null | P1 挂起档分支 |
| `deferredSnapshotActionsRef`（:619） | 置空数组 | P2 重放 |
| `inFlightSnapshotGenerationRef`（:618） | 置 null（**不**置 `needsResumeSnapshotRef`——切会话走 ④ 的 `needsOpenSnapshotRef` 开屏语义，置 resume 会双发） | P1 在途分片继续过桥（分片循环自检 `:1129` 判 `!==` 即中止，null 同样触发） |
| `streamActiveRef`（:616） | 置 false | P1 必要条件残留 + 切会话后非 force 快照被永久推迟 |
| `lastStreamCommitIdsRef`（:617） | 置空数组 | 新会话首轮消息增长被误判「streamCommit 已同步」而跳过快照（`shouldSkipSnapshotAfterStreamCommit` :458-468） |

`prevMessagesRef`（:591）**不入**清场清单：③ 落地后空面早退已被「发空快照 + 保留 `:2207-2209` 基线写入」取代，④ 开屏分支在 webReady 就绪的每一拍都会补写新基线，旧值不存在漏写路径（r3 审查复核确认）。

同步更新 `:1868-1883` 的注释块：把「刻意不动」清单改为「`needsOpenSnapshotRef`（④ 置位）、8s 兜底计时器」两项，并新增「本次清场覆盖的 ref 清单」——该注释是文件头 `:38-41` 自定纪律（「新增任何靠重挂初始化的 ref 状态，都得同步补一条 `[sessionKey]` 清场」）的执行记录，上次漏清正是 P1/P2 的根因。

**声明序约束**：该 effect 保持现位置（:1884，恢复链 ①③④ 之前）不动——它必须先于 ① init/③ setText/④ 快照执行（`:1863-1865` 注释：①③④ 靠 `resetComposerBaselines` 打的基线判断要不要重发）。严禁把它挪到 `:2065-2078` 与 `:2096-2105` 之间（G-3 声明序红线）。

### ② 协议：6 条带内容的转录域下行消息补 `sessionKey` 可选字段 + web 侧入口统一判据（结构防线，兜住一切漏网）

**RN 侧构造点显式携带**（关键取舍，勿改）：

| type | payload 构造点 | 闭包来源 |
|---|---|---|
| `appendTailRows` | `sendAppendTailRows` :1310-1314 | `useCallback` 依赖补 `sessionKey` |
| `prependPage` | `sendPrependPage` :1544-1558 | 同上 |
| `streamDelta` | `flushPendingStreamDeltas` :897-905 | rAF 闭包捕获当拍 `sessionKey` |
| `streamBatch` | `flushPendingStreamBatch` :944-955 | 同上 |
| `streamBlockCommit` | `postStreamBlockSplits` :850-861 | 同上 |
| `streamCommit` | `commitStreamTail` :1342-1346 | `useCallback` 依赖补 `sessionKey` |

`sessionSnapshot`（:1151）已带必达 `sessionKey`，不动。

**为什么不在 `postToWeb`（:745）统一注入**（写进代码注释防后人「顺手优化」）：`sessionKeyRef` 只在 ④ effect（:2180-2181）更新；P1 场景下旧闭包快照分片在途时 `sessionKeyRef.current` 可能已被新会话改写——统一注入会给**旧内容打上新会话标签**，web 侧判据反而放行，P1/P2 从「可见串台」变成「更隐蔽的串台」。构造点闭包捕获才能保证「消息的 key = 构造它那一拍的会话」。deferred 队列存的是已构造好的消息对象，重放时旧 key 原样随行，被 web 判据丢弃。

**不携带 key 的三条及理由**（在 `ChatConversationBridge.ts` 联合成员处注释）：`streamReset`（清空操作，幂等无串内容问题，且现载荷是 `Record<string, never>`，加字段属类型骨架变更，收益不抵）、`streamToolInvoking`（指示器，非内容）、`flagsUpdate`（全局 flags 与会话无关）。

**类型落点**：`ChatConversationBridge.ts` 的 `ConversationHostMessage` 联合（:372-426）上述 6 个成员补 `readonly sessionKey?: string`。web 侧 `model.ts` 无 per-type payload 类型（宽松三字段），无需声明；`CONVERSATION_TRANSCRIPT_TYPES`（:279-292）不动；dispatcher 转录域透传（:217-219）原样带过，零改动。

**web 侧统一判据**（`chat-transcript/webview/runtime/bridge.ts:41-45`，`const p = ...` 之后、`switch` 之前插一行）：

```ts
if (
  msg.type !== 'sessionSnapshot' &&
  p.sessionKey && state.sessionKey &&
  p.sessionKey !== state.sessionKey &&
  p.sessionKey !== state.pendingSessionKey
) {
  return; // 迟到的旧会话内容消息：文档基线既不是它、也没有正在铺的它的快照，丢弃
}
```

- **快照通道豁免（`msg.type !== 'sessionSnapshot'` 前置，勿删）**：切会话时新快照带的是**新** key，而 `state.sessionKey` 此刻仍是旧会话的 key——判据若不豁免快照，新会话的开屏快照（含 ③ 的空快照）会被整份丢弃，三层修复同时失效。迟到的旧会话快照分片不靠本判据兜：由 `handleSnapshotPayload` 既有的 generation 判旧（`snapshot.ts:97`、`:115-131`）丢弃，快照的代次序与会话序一致。**本兜底的前提（写进判据注释）**：RN 侧快照恒带 generation（`ChatConversationWebView.tsx:1161`）；`snapshot.ts:93-94` 对「单片且 generation 缺省」的旧协议载荷不判代次直接 apply——将来若允许发无代次快照，这道兜底静默失效。
- 口径（三态）：**消息带 key、基线已建立、既不匹配当前基线也不匹配待生效基线 → 丢弃**；消息不带 key（undefined）、基线未建立（''）、或匹配任一基线 → 放行。
- **`state.pendingSessionKey`（新增，待生效基线）**：`state.ts` 增字段（初值 ''）；**四处**生命周期，收成一个 `resetPendingChunkAcc()` helper（清 `pendingChunkAcc` + `pendingChunkActions` + `state.pendingSessionKey`）共用：① 新代次**首片**到达时置为该片 `sessionKey`（`:134-148` 重置收集器处）；② 末片 apply 翻转 `state.sessionKey` 后清空（`:174` 附近）；③ 收集器被新代次顶替时由新首片重写；④ **单片快照以更新代次到达、作废在途多片收集器时（`snapshot.ts:104-110`）同步清空**——此点必漏不得：③ 空快照恰恰让「A 多片在途 → 切空会话 B → B 单片空快照作废 A 收集器」成为高频路径，漏掉则 `pendingSessionKey` 长期挂在 A，迟到的 A key 内容消息被三态判据放行。它解决的窗口：B 的开屏快照 `chunkTotal>1` 时**末片才 apply**（`snapshot.ts:162-175`），翻转前有实打实的在途窗口（每片 ~16ms，10 片大会话 ≈160ms）；窗口内到达的带 B key 的 `streamDelta`/`streamBatch` 若只对 `state.sessionKey`（仍=A）判不匹配会被误丢——而「切进 B 瞬间 attach 即注入已累积 partial」（`session-stream-unit.ts:856-857`）恰是并发场景高频路径。首片与后续消息走同一 postMessage 通道 FIFO，首片必先于同批 delta 到达；宿主清场顶掉在途代次后总会发新开屏快照（③ 保证空面也发），`pendingSessionKey` 不会悬挂。残余窗口仅「B 首片尚未 post 之前」极小段，且丢的内容由收尾 `streamCommit` 全量兜回，写进风险表。
- 为什么「基线未建立放行」：`state.sessionKey` 只由 `sessionSnapshot` 写（`snapshot.ts:212`）。新会话开屏快照分片到齐前 `state.sessionKey` 还是旧会话——此时到达的带旧 key 消息会匹配旧基线被放行，但随新快照末片 apply 时 `state.rows` 整体替换，残留内容被覆盖，无害。若判据在基线空时也丢，新会话首个快照前的合法增量会被误杀（首帧丢消息的新 bug）。
- 与 `applySnapshot` 既有 `sessionChanged` 判据（`snapshot.ts:209-212`）同源同口径：快照经上面的显式豁免进入自身通道，由 `sessionChanged` 翻转基线，不走丢弃分支。
- es2018 纪律：判据仅用 `&&` 与字符串比较，零新运行时 API，门 C 棘轮零压力。
- **单一入口已核实**：web 侧 `appendStreamDelta`/`applyAppendTailRows` 等消费函数在 `web/` 下除 `bridge.ts` 外零外部调用方（dispatcher 经 `handleTranscriptHostMessage` 即 `bridge.ts:41` 本身），判据加这一处即全覆盖。

### ③ 空会话开屏发空快照（修 P3）

④ 快照 effect 的 `messages.length === 0 → return` 早退（:2189-2192）改为：**当 `needsOpenSnapshotRef.current === true`（即切会话开屏）且 messages 为空时，消费标记并调用 `sendSessionSnapshotNow('stick')` 发一份空快照**（rows: []、单片）；`needsResumeSnapshotRef`（视图回补）路径的同款守卫（:2165）**保持不动**——回补时 messages 为空意味着本来就无内容可补，维持原判据。

- 实现形态：**沿用 `needsOpenSnapshotRef` 同一分支改造**（把 `return` 换成发空快照），不是新开分支——该分支既有的三条基线写入（`:2207-2209`，空面时写入 `undefined/0/[]`，对后续 messages 到位的增量判据无害）与开屏滚动意图/遥测（`:2194-2206`）原样保留，实施者不得只搬发送调用而漏基线写入（否则后续增量路径的 `grew`/`prevFirstId` 判据行为漂移）。

- 可行性：`planSnapshotChunkBounds`（`snapshot-chunk-bounds.ts:52-73`）对空列表返回单空桶（chunkTotal=1，注释 :50 明写与旧单包空快照逐字节等价），发送链零改动。
- 行为变化（接受并写进 CHANGELOG）：切到空会话立即清空转录 DOM（正是要的效果）；列表态（`sessionKey=NO_SCOPE_ID`、messages 空）同样会发一份空快照清掉上个会话的 DOM——回列表再进会话每往返多两轮单片空快照，体积与开销可忽略。
- 原「3 轮快照抖动」顾虑（:2149-2150 注释）重估：新方案同样是「空快照 1 轮 + 首消息增量 1 轮」，抖动轮数不变，只是把「残留旧会话内容直到首消息」换成「立即清空」——清场正确性优先。

### ④ P4：`useInterruptedPartialCommit` 补会话身份

采用「显式入参」而非「让 `transcriptReadyEpoch` 在切会话时递增」——epoch 语义是「webview 基线世代」（`ChatTabProvider.tsx:271-273` 注释），切会话不递增是 SPA 化后的正确行为，往里塞会话语义会污染它。改五处（`useInterruptedPartialCommit.ts`，全文 77 行）：

1. 选项接口（:22-29）增 `readonly sessionKey: string | null`。
2. **清空判据必须是 effect 第一句（先于 `sessionKey == null` 早退与全部既有早退链）**：`if (committedRef.current != null && committedRef.current.sessionKey !== sessionKey) { committedRef.current = null; }`。次序不可倒——若 null 早退在前，「A 提交 → 回列表（null，早退不清记录）→ 再进 A（记录 sessionKey 恰又是 A，key+epoch 命中）」会跳过提交，而开屏快照已重建文档 → 合成行永久丢失。
3. `committedRef`（:38）结构增列 `sessionKey`（供第 2 条判变化）；幂等判据（:61-67）保持只比 key+epoch。**勿用「增列进命中条件」的等价改法**：`committed.sessionKey === sessionKey` 才算命中在「切回原会话」场景仍命中（记录与当前一致），闭合不了丢失方向。
4. **身份比对守卫（错打方向的真正防线，在本 hook 内）**：既有早退链之后、提交之前加 `if (sessionKey == null || `${unitView.projectId}:${unitView.sessionId}` !== sessionKey) return;`（`SessionStreamUnitView` 自带 `projectId`/`sessionId`，`session-stream-unit.ts:199-200`；主屏 `chatScrollKey` 与子会话屏传参同为 `${projectId}:${sessionId}` 格式）。为什么必须有：`unitView` 是 `useState`+`useEffect` 同步（`ChatTabProvider.tsx:237-252`），切会话那一帧仍是**旧会话**的 interrupted 投影而 `sessionKey` 已是新会话——没有身份比对时四道既有守卫全过，A 的合成行提交进 B；且 React 同一 commit 子组件（Webview ④ 快照）effect 先于父组件（本 hook）跑，B 快照先发、串台行后落，快照覆盖救不回来。比对后：陈旧投影那一拍被挡（等 unitView 更新到 B 再提交），B 自身 interrupted 时 `B:B` 匹配正常提交。
5. effect 依赖（:76）追加 `sessionKey`。

调用方：主屏 `ChatConversationPanel.tsx:150-154` 传 `sessionKey: chatScrollKey`（列表态为 null → 早退，与 `:199` 传给 webview 的 `'no-session'` 哨兵**有意不同**，勿对齐）；子会话屏 `SubagentSessionScreen.tsx:164-168` 传**内联模板字符串** `` `${projectId}:${sessionId}` ``——勿复用同文件 `:244` 的 `sessionKey` memo（声明在本 hook 调用之后，复用会 TDZ `ReferenceError`）；格式与该 memo 一致。`ChatTabProvider.tsx:271-277` 的 `transcriptReadyEpoch` 注释补一句「切会话不递增是刻意的，会话身份由 useInterruptedPartialCommit 的 sessionKey 承担」。

## 最终项目结构

不新增包、不新增目录、不改桥 v 号。改动集中在 9 个源文件（`ChatTabProvider.tsx` 为纯注释改动）+ 4 个测试文件（1 个新增、3 个既有文件并入/追加）：

```
apps/mobile/src/components/chat/ChatConversationWebView.tsx   # ①清场补全 ③空快照 ②六构造点带key
apps/mobile/src/components/chat/ChatConversationBridge.ts     # ②联合6成员加 sessionKey?: string
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts    # ②入口三态判据
apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts      # ②pendingSessionKey 字段
apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts # ②pendingSessionKey 生命周期
apps/mobile/src/screens/tabs/chat-tab/useInterruptedPartialCommit.ts   # ④
apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx        # ④传参
apps/mobile/src/screens/stack/SubagentSessionScreen.tsx                # ④传参
apps/mobile/__tests__/chat-conversation-webview.test.tsx               # 新describe+计数复核
apps/mobile/__tests__/chat-transcript-bridge-session-guard.test.ts     # 新增：web判据单测
apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx     # ④两条用例
apps/mobile/__tests__/chat-conversation-bridge.test.ts                 # ②透传往返一条（可选）
```

## 变更点清单

| # | 文件 | 变更 | 对应路径 |
|---|---|---|---|
| C1 | `ChatConversationWebView.tsx:1884-1887` | 清场 effect 补 6 个 ref 的清理（`prevMessagesRef` 不入，见①说明）+ 注释清单更新 | P1/P2 |
| C2 | `ChatConversationWebView.tsx:2189-2192` | 空会话开屏发空快照 | P3 |
| C3 | `ChatConversationWebView.tsx` 6 处构造点 | payload 补 `sessionKey`（闭包捕获）+ `postToWeb` 防统一注入注释 | P1/P2 兜底 |
| C4 | `ChatConversationBridge.ts:372-426` | 6 联合成员补 `readonly sessionKey?: string` | 协议 |
| C5 | `web/chat-transcript/webview/runtime/bridge.ts:44` + `state/state.ts` + `render/snapshot.ts` | 入口三态判据 + `state.pendingSessionKey`（首片置 / 末片 apply 后清 / 新代次顶替重写） | P1/P2 兜底 + 判据自身回归防护 |
| C6 | `useInterruptedPartialCommit.ts` + 两个调用方 | `sessionKey` 入参 + 清空判据（effect 第一句）+ 投影身份比对守卫 | P4 错打/丢失两向 |
| C7 | `ChatTabProvider.tsx:271-273` | epoch 注释补充（纯注释） | — |

明确**不改**：`ChatTranscriptBridge.ts`（死类型面）、`dispatcher.ts`（透传无碍）、`model.ts` 的 `CONVERSATION_TRANSCRIPT_TYPES`、`webview-asset-guard.test.ts`、`session-stream-unit*`（干净层）、memo 比较器（无新 prop；若实施中新增宿主 prop 必须入列 :321-367，踩坑史见 :313-320）。

## 详细实现步骤

- Step 1 — phase-host-clear — blocking: yes — qa: auto：C1 清场 effect 补全（含注释更新；声明序不变）。变异验证：临时去掉任一清理项，对应新用例须红。
- Step 2 — phase-empty-snapshot — blocking: yes — qa: auto：C2 空快照（仅 `needsOpenSnapshotRef` 分支；`needsResumeSnapshotRef` 守卫不动；保留该分支既有基线写入与遥测）。既有断言已核实**不撞**（r1 审查逐条核对：`baseProps` 恒带 1 条消息、唯一 `messages: []` 用例是同会话回补非开屏、`:2008/:2018/:2031` 的换会话用例 messages 非空）——新计数面（切会话且 messages 为空多发一轮）由 T-SI3 首次锁死。
- Step 3 — phase-protocol-key — blocking: yes — qa: auto：C3+C4 六构造点带 key + 联合类型补字段。注意两点：① `useCallback` 依赖数组补 `sessionKey` 后，依赖这些函数的 effect 在切会话时会重跑——逐个确认重跑语义安全（本就应随会话切换重发的链路）；② `commitStreamTail`/`postStreamBlockSplits` 的改动沿 `useImperativeHandle`（:1517-1539）改 handle 对象身份——已核实安全（attach effect 依赖含 `sessionId`，切会话必重挂吸收），实施者勿当风险去改代码。
- Step 4 — phase-web-guard — blocking: yes — qa: auto：C5 web 入口三态判据 + `state.pendingSessionKey` 生命周期（es2018 口径，仅 `&&` 与字符串比较）；改 web 源码后必须 `npm run build:webview` 重建 dist（门 B 白名单/门 C 棘轮照跑），boot-script dist 契约测随产物更新。
- Step 5 — phase-interrupted-guard — blocking: yes — qa: auto：C6+C7 P4 三处 + 两调用方传参 + epoch 注释。
- Step 6 — phase-verify — blocking: yes — qa: auto：门禁三件——定向新用例全绿 → mobile 全量 `npx jest --maxWorkers=2`（满负载假红纪律，RULE:112）→ typecheck 三段（`tsconfig.build.json` / `src/web/tsconfig.json` / `e2e`）零错；`npm run build:webview` 门 B/C 过。
- Step 7 — phase-device-verify — blocking: no — qa: manual_user：真机并发验收（用户执行）：会话 A 流式生成中切会话 B（含空会话）来回切换、两会话并发各自生成，断言无串台/无残留/中断合成行归属正确；复现路径与观察点见测试策略末尾。
- Step 8 — phase-docs — blocking: no — qa: auto：CHANGELOG Unreleased 修复条目；本 spec 回填执行终态；bug 留痕 `docs/Iterations/chat-webview-unify/bugs/` 下新增同族条目（转录域版 workspace-stale，指向本 spec）。

依赖关系：Step 1/2/5 相互独立可并行；Step 3 → Step 4 依赖（判据要有字段可判）；Step 6 收口全部；Step 7/8 在 6 之后。

## 测试策略

宿主侧新 describe（并入 `chat-conversation-webview.test.tsx`，复用 `closeChunkGate`/`releaseChunkGate` 在途窗口锁 + `sentOfType`/`switchSession` 骨架；注意 fake timers 与 `flushTimers`/`flushSnapshotChunks` 互斥，在途窗口选 Promise 闸门）：

- **T-SI1 — blocking: yes** — A 开屏快照在途（closeChunkGate 锁住分片）+ A 的 `appendTailRows` 压入 deferred → 切 B（换 `sessionKey`+messages）→ release → 断言：A 的余分片不过桥；deferred 队列已清空（B 快照末片后无 A 的 `appendTailRows` 过桥）；B 收到的开屏快照 `payload.sessionKey` 为 B。
- **T-SI2 — blocking: yes** — A 流式活跃 + 非 force 快照挂起（`pendingSnapshotRef` 有档、`streamActiveRef=true`）→ 切 B → 断言：挂起档与 streamActive 已清（B 侧任何触发不 flush A 闭包快照；切会话后发出的快照 generation 均属 B 轮次，参照 `:2030-2035` 的相对大小断言法——generation 是模块级计数器，禁断绝对值）。
- **T-SI3 — blocking: yes** — 切到 `messages.length===0` 的会话 → 断言发出一份 `rows: []` 单片快照且 `sessionKey` 为新会话、`needsOpenSnapshotRef` 已消费（后续 messages 到位走增量）。
- **T-SI4 — blocking: yes** — 对照组：同会话内非会话切换的快照在途场景不受清场影响（防过度形态，参照 workspace-stale 回归锁的对照组写法）。

web 侧新文件 `chat-transcript-bridge-session-guard.test.ts`（复用 `chat-transcript-snapshot-chunk.test.ts` 的 `loadFreshModules` 取全新 `state` 单例（:38-52）与 fake document 桩思路，**但 mock 面不同，勿照搬**：该先例把 `runtime/bridge` 整个 mock 掉了，而本组用例必须驱动 `handleHostMessage` 本体——正确依赖面：mock `row-logic`/`stream`/`menu`/`mermaid`/`@web/shared/host-theme`/`@web/shared/post`，**不 mock bridge**；其中 `row-logic` 须**同时导出 `flagsEqual` 与 `renderRows`**（`bridge.ts:21` 同一 import，只导 `renderRows` 会让 `flagsEqual` 为 undefined、`flagsUpdate` 分支一调即炸）；**`@web/shared/host-message-channel` 与 `scroll/scroll` 必须真实加载**（前者一 mock 则 `matchHostMessage` 恒失败、`handleHostMessage` 第一行就 return，全部用例假绿；后者是 `snapshot.ts` 既有依赖，`snapshot-chunk` 先例已在真实 scroll 下跑通）；`stream/stream-markdown`（`bridge.ts:15`）无 DOM 副作用，可 mock 可不 mock；`@web/shared/mermaid-fullscreen` import 期无 DOM 副作用（模块级变量），可真实加载不必 mock。fake document 须补 `addEventListener`（`bridge.ts:35-39` import 期注册）；预置基线 `state.sessionKey='B'` 的手段 = 先投递一份无 `generation` 的 B 快照单片（走 `snapshot.ts:93-113` 直发路径 apply），`document.getElementById('scroller')` 桩照先例。**单例陷阱**：`bridge.ts` 必须与 `snapshot`/`state` 在**同一个** `jest.isolateModules` 回调里 require——现成 `loadFreshModules` 只 require 了 `snapshot` 与 `state`，不扩展它的话 bridge 拿到的 `state` 不是同一单例，T-SI5/6/7 会集体假绿）：

- **T-SI5 — blocking: yes** — 预置 `state.sessionKey='B'`（先 apply 一份 B 快照）→ 依次投递带 `sessionKey:'A'` 的 `streamDelta`/`streamBatch`/`streamBlockCommit`/`streamCommit`/`appendTailRows`/`prependPage` → 断言 `state.rows` 与 `state.stream` 均不变（六类全丢）。
- **T-SI6 — blocking: yes** — 同上场景投递**不带** key 的同六类消息 → 断言正常应用（兼容放行；变异验证：把判据改成「无 key 也丢」须红）。
- **T-SI7 — blocking: yes** — 基线未建立（`state.sessionKey===''`）时带任意 key 的消息放行。
- **T-SI8 — blocking: yes** — 两条：① 带 A key 的 `sessionSnapshot`（带更高 generation）在 B 基线下仍正常应用并翻转 `state.sessionKey`（锁快照豁免——变异验证：删掉 `msg.type !== 'sessionSnapshot'` 豁免前置本条必红；注意 T-SI3 是宿主侧用例、不执行 web 判据，勿拿它当变异观测面）；② 预置 A 基线 → 投递带 B key 的 `rows: []` 单片快照 → 应 apply 并翻转基线（锁空快照在判据下的可达性）。
- **T-SI8b — blocking: yes** — 分片在途窗口放行：预置 A 基线 → 投递 B 的多片快照首片（`chunkTotal>1`，`pendingSessionKey` 置 B）→ 立即投递带 B key 的 `streamDelta` → 断言**未被丢弃**（`stream` 已被 mock，观测面用 `appendStreamDelta` 的调用与入参，勿断言 `state.stream`——mock 掉 stream 模块后它不会被写）；末片 apply 后 `pendingSessionKey` 清空。**T-SI8c — blocking: yes** — 单片作废在途：预置 A 基线 → 投 B 的多片首片（pending=A→B 途中）→ 投一份更新代次的**单片**快照（作废收集器）→ 再投带 A key 的 `streamDelta` → 断言被丢（`:104-110` 第四处清空——变异验证：删掉该处 `resetPendingChunkAcc` 的 pending 清空，本条必红）。

P4（并入 `chat-conversation-panel.integration.test.tsx`，复用 `InterruptedTestHost`/`interruptedUnitView` 骨架，`makeMockContext` 补 `chatScrollKey` 可变变量）：

- **T-SI9 — blocking: yes** — 五条拆开断言：① A 有 interrupted partial → 切 B 且 B 无 interrupted 投影（unitView 置 null/非 interrupted）→ 断言 B 不收到 `commitSyntheticAssistantRow`（`mockCommitSyntheticAssistantRow` 调用计数即观测面；**标注：本条是行为锁/防过度实现，非变异观测面**——既有 `:41` 的 status 早退不装修复也绿，鉴别力在②④⑤）；② A interrupted → 切 B → **切回 A** → 断言恰好再提交一次（丢失方向——变异验证：把「清空记录」改成「增列进命中条件」本条必红）；③ B 自身 interrupted 时正常提交（归属语义，防实施者把正确行为改掉）；④ 陈旧投影帧：`sessionKey` 已是 B 而 `unitView` 仍是 A 的 interrupted 投影（模拟 `ChatTabProvider` state 同步晚一拍）→ 断言零提交（身份比对守卫——变异验证：删掉 `${projectId}:${sessionId}` 比对本条必红）；⑤ A → 列表（sessionKey=null）→ 再进 A → 恰好再提交一次（清空次序在 null 早退之前——变异验证：把清空挪到 null 早退之后本条必红）。
- **T-SI10 — blocking: yes** — `sessionKey == null` 早退（能产出 null 的只有主屏列表态——子会话屏传内联模板且 route params 皆非空 string；与 T-SI9⑤ 同帧，断言 `commitSyntheticAssistantRow` 与 `committedRef` 均不被写）。

协议往返（`chat-conversation-bridge.test.ts` 补一条，可选但建议；注意是 conversation 侧文件——`chat-transcript-bridge.test.ts` 测的是已退役旧链，勿落错）：

- **T-SI11 — blocking: no** — `encodeHostToConversation` 六类带 key 消息 round-trip 字段保留。已核实：该文件只锁 type 名集合（:53-78）与上行载荷，对下行 payload 无 `toEqual` 整对象断言，C4 加可选字段不撞。

**真机验收观察点**（Step 7，用户执行）：会话 A 发起生成 → 生成中切到新建空会话 B（重点观察：B 应立即是空的、无 A 残留）→ B 也发消息 → 来回切 A/B → 断言各自消息列表正确、无对方消息、流式内容不互相续写；对 A 中断一次生成再切 B，断言中断合成行只出现在 A。

## 风险与回滚方案

| 风险 | 等级 | 缓解 |
|---|---|---|
| 空快照行为变化撞既有计数断言 | 低 | r1 审查已逐条核实**不撞**（`baseProps` 恒带 1 条消息；唯一空 messages 用例是同会话回补非开屏路径）——勿在 Step 6 误改既有测试；新计数面由 T-SI3 锁。空快照是单片极小消息，性能无感 |
| `useCallback` 补 `sessionKey` 依赖引发切会话时依赖链 effect 重跑 | 中 | Step 3 要求逐函数确认重跑语义；本就应随会话重发的链路（草稿/指示器同步）不受影响 |
| 判据「基线未建立放行」窗口内旧会话残留消息仍可入文档 | 低 | 窗口随后续快照整体替换闭合（`state.rows` 全量覆盖），非持久错乱；宿主侧清场已把源头堵死，判据是第二道网 |
| `pendingSessionKey` 残余窗口：B 的快照**首片** post 之前到达的 B key 消息仍会被丢 | 低 | 同通道 FIFO 保证首片先于同批消息；被丢内容由收尾 `streamCommit` 全量行兜回（观感上限是极短窗口的头部缺帧）；宿主清场保证切会话后必发新开屏快照（③ 含空面）、pending 不悬挂 |
| web 侧改动漏重建 dist（jest 直连 src 绿、真机跑旧产物） | 低 | Step 4 硬性要求 `build:webview`；boot-script dist 契约测会咬旧产物 |
| 「基线空放行」与「快照翻转基线」的时序在多文档（子会话屏第二实例）下的表现 | 低 | 子会话屏每 sessionId 独立路由实例、独立 web 文档，`state.sessionKey` 各自独立；Step 7 真机含子会话屏抽查 |
| 既有测试的其他 payload 断言（`toEqual` 整对象）撞新字段 | 低 | r1 审查已核：`chat-conversation-webview.test.tsx` 的 payload 断言多为 composer/dock/list 域（不受影响）或 `toContain` 语义（安全）；dispatcher 测试以 `{marker}` 自构入参不撞；`chat-conversation-bridge.test.ts` 只锁 type 名集合（已核实项，见 T-SI11）。`chat-conversation-entry.test.ts` 未逐条核 payload 断言——Step 6 全量兜底 |

**回滚**：全部改动为纯增量（可选字段 + 一行判据 + 清场扩充 + 空快照分支 + hook 入参），单笔 revert 即完全回滚到现状；四层（清场/空快照/构造点 key/web 判据）彼此独立，可分层回退——例如 web 判据回退后宿主清场仍独立堵 P1/P2。

**实施红线提醒**（继承 RULE 与探索结论）：中文文件一律专用 Edit 工具；`prettier --write` 后逐 hunk 复核；测试计数以实跑 `# pass` 为准（本 spec 预写条数以落地实跑为准）；mobile 全量门用 `--maxWorkers=2`；改 `src/web/**` 后 Metro reload 无效须重建 dist（出包再 `build:webview:native`）。
