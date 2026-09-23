---
date: 2026-09-23
---

# 大文本回滚卡顿修复 技术规格（SPEC）

需求来源：`docs/Iterations/mobile-perf-2026-09/features/rollback-large-jank/prd.md`（用户实测 bug，探索报告 2026-09-23）。

## 设计目标

消除回滚链上的 JS 长任务串：三遍全量 parse 收敛、快照对大消息分片生效、全局孤儿清扫移出回滚事务、收尾链错峰；回滚语义（锚定/删尾/VFS 恢复/草稿恢复/可见性）零变化。

## 总体方案

四个独立成立的改动，互相不依赖，可分别交付：

1. **回滚链分段打点（度量基线）**：`__DEV__` 门控，在 run-timing 打点体系上加回滚链分段——plan 拉取（行数+content 字节数）、事务各子步、tail reload、快照 build/stringify、web 渲染回执。修复前后对比与真机验收共用。
2. **三遍 parse 收敛**：
   - 第三遍（token 标签）：`refreshChatTokenLabel` 从回滚交互链剥离——现状已是 fire-and-forget，但与快照构建/post 在同一时间窗排队；改为显式错峰：回滚后的首次 token 刷新延迟到「快照 post 完成」信号之后。**该信号 controller/hook 侧无现成通道**（快照完成只有 webview 组件内部可知，承载文件原本不在变更清单），二选一拍板为：**新增 `ChatTranscriptWebView` 快照完成回调 prop**（挂点用现成的「snapshot all chunks done」/deferred actions 排空处，见 Step 5），经 `ChatConversationPanel` 透传到回滚链；**不走** `sessionStreamUnitManager` 通道——它是 runtime 层的会话运行单元管理器，不在快照链上，改走它需把组件内部快照状态外提到 runtime，侵入更大。token 第③遍主路径说明同步修正：主路径是 `session-prompt-input.service.ts:52` 的 `buildSessionPromptInput` → `runtime.messages.listBySession`，repository 注入后**自动覆盖**、该文件无需改动；`chat-prompt-tokens.service.ts` 自身的直接 `listBySession` 仅在 fallback 路径（`loadChatPromptTokenLabelFallback`，主路径抛错才走），同样经注入自动覆盖，文件本身亦无新增改动。
   - 第一/二遍（plan 全量 + tail 41 条）：跨层复用不可行（plan 在 core 事务外、tail 在 mobile UI 层），改为**大结果集分片解析让步**。转换点在 repository 方法内部（`rows.map(rowToMessage)` 同步 map），service 层（`message.service.ts` 的 `listBySession` 纯透传）无从插手，故**注入缝定在 repository 构造参数** `yieldFn?: () => Promise<void>`：缺省不传 → 直通同步 map，与现状逐字节等价，desktop/cli/测试零影响；传入 → 走可让步分片循环（每片 ≤50 行，片间 `await yieldFn()`）。装配写死两处：① `createChatServices`（create-chat-services.ts:58 构造 messageRepo，runtime.messages 链）② `createMessageRollbackService` ← `createSessionFsService`（create-session-fs-service.ts:22，回滚 plan 拉取链）——mobile 两处均传 `createQuantumYield(16)`（yield 函数值由 mobile 侧作为工厂参数传入，core 只声明函数类型、不反向 import RN 模块）；plan 阶段拉取范围收窄为「触发消息 seq 起的全部后续消息」（下界已核定写死，见风险）。
3. **快照字节预算分片**：`sendSessionSnapshotNow` 分片条件从「条数 > SNAPSHOT_CHUNK_SIZE(50)」改为「条数 > 50 **或** 累计字节 > SNAPSHOT_CHUNK_BYTES(256KB)」——大消息场景 40 条也能切多片，片间既有量子让步与 generation 代次机制自然生效；web 侧拼装逻辑零改动（多片路径本就存在）。两个细节写死：(a) **度量对象 = 源消息 content 的 JSON 序列化尺寸**（rows 编码前）：按源尺寸贪心预估切分——逐条累计源尺寸、超预算即封桶，一遍量测一遍定桶边界，不做「切完片再量 rows 实际编码尺寸」的两遍量测；(b) **`chunkTotal` 预计算**：先量测全部源尺寸再贪心分桶，`chunkTotal` = 桶数，chunk 0 的 payload 即携带最终值（与现状「先算 chunkTotal 再进分片循环」同构，仅计算式从条数除法换为分桶数）。小包场景单桶 `chunkTotal=1`，与现状逐字节等价（先例断言形态可引：T-S1/T-S2 用例内的 `chunkTotal: 1` 单包等价断言，chat-transcript-snapshot-chunk.test.ts）。
4. **孤儿清扫 deferred 化**：`sweepSessionRevisions` 的 `deleteGlobalOrphans`（全局全表 DELETE，与本会话无关）从回滚事务内移出，改为事务提交后 **fire-and-forget** 调度——`void runDeferredRevisionOrphanGc(conn).catch(...)`，不 `await`、不阻塞 `rollbackToMessage` resolve；「守卫」定义为模块级 in-flight 去重（清扫进行中不重入，后到的调用直接丢弃——孤儿清扫是收敛式语义，漏一轮下一轮补上即可）。**与先例的有意偏离**：`runDeferredFileCacheGc` 的既有用法是删除事务后内联 `await`（session.service.ts:196 / project.service.ts:196）——删除场景挡住 `delete()` resolve 无妨，但回滚场景照抄会把全表 DELETE 挡在 `rollbackToMessage` resolve 与 UI 链（reloadMessages/toast/快照）之间，卡顿从事务内挪到事务后，AC-1 仍挂，故本处写死 fire-and-forget。并发安全由驱动层既有机制保证：连接的 execute/query/batch/transaction 全部经 `AsyncMutex.run` 串行化（tdbc-driver-op-sqlite/src/connection.ts），fire-and-forget 的 DELETE 与后续事务自然排队，不会并发踩踏。scoped 打扫保留在事务内（回滚正确性依赖）。

## 最终项目结构

```
packages/core/src/
  service/message-checkpoint/impl/message-rollback.service.ts   # plan 拉取下界收窄；deferred 孤儿清扫挂点（fire-and-forget）
  domain/message-checkpoint/logic/revision-gc.ts                # deleteGlobalOrphans 拆分为可 deferred 调用
  domain/message-checkpoint/logic/deferred-revision-orphan-gc.ts # 新：事务后 fire-and-forget 调度 + 模块级 in-flight 去重守卫
  domain/chat/repositories/impl/sqlite-message.repository.ts    # 构造参数 yieldFn?（缺省直通）；新增 listBySessionFromSeq
  service/chat/create-chat-services.ts                          # 装配缝①：yieldFn 可选参数透传到 messageRepo（runtime.messages 链）
  service/message-checkpoint/create-message-checkpoint-services.ts # 装配缝②：createMessageRollbackService 透传 yieldFn（回滚 plan 拉取链）
  service/session-fs/create-session-fs-service.ts               # createSessionFsService 透传 yieldFn 到装配缝②
  service/chat/impl/message.service.ts                          # 不动（listBySession 纯透传，转换发生在 repository 内部）
apps/mobile/src/
  components/chat/ChatTranscriptWebView.tsx                     # 分片字节预算 + 新增快照完成回调 prop（onSnapshotComplete）
  screens/tabs/chat-tab/ChatConversationPanel.tsx               # 透传快照完成回调（对齐 onReady 等既有回调形态）
  screens/tabs/chat-tab/useChatTabMessageActions.ts / useChatTabController.ts  # token 刷新错峰（消费快照完成信号）
  runtime/create-mobile-runtime.ts                              # 两处装配（createChatServices / createSessionFsService）传 createQuantumYield(16)
  services/session-prompt-input.service.ts                      # 不动（buildSessionPromptInput 经 runtime.messages 自动分片）
  debug/run-timing.ts                                           # 回滚链分段打点（__DEV__）
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `message-rollback.service.ts` | plan 拉取下界收窄（触发消息 seq 含，`listBySessionFromSeq`；计数快照改 `countBySession`）；事务后 fire-and-forget 挂 deferred 孤儿清扫 |
| 2 | `revision-gc.ts` + 新 `deferred-revision-orphan-gc.ts` | 全局孤儿清扫拆出事务；fire-and-forget 调度 + 模块级 in-flight 去重守卫 |
| 3 | `sqlite-message.repository.ts` / `create-chat-services.ts` / `create-message-checkpoint-services.ts` / `create-session-fs-service.ts` / `create-mobile-runtime.ts` | repository 构造参数 `yieldFn?` 分片让步（缺省直通，desktop/cli 行为不变）；mobile 两处装配传 `createQuantumYield(16)`；`message.service.ts` 透传不动 |
| 4 | `ChatTranscriptWebView.tsx` / `ChatConversationPanel.tsx` | `SNAPSHOT_CHUNK_BYTES` 字节预算（源尺寸贪心分桶、`chunkTotal` 预计算）+ 快照完成回调 prop 与透传 |
| 5 | `useChatTabMessageActions.ts` / `useChatTabController.ts` | token 刷新错峰（快照完成信号触发；内部让步经 repo 注入自动生效，`session-prompt-input.service.ts` / `chat-prompt-tokens.service.ts` 均无需改动） |
| 6 | `run-timing.ts` + 回滚链各段 | 分段打点 |
| 7 | 测试 | T-R 系列 + 既有回滚用例回归 |

## 详细实现步骤

- Step 1 — phase-rollback-probe — blocking: yes — qa: auto：回滚链分段打点（__DEV__ 门控，含行数/字节量）；断言打点存在的测试 T-R0。真机基线采集归 Step 6。
- Step 2 — phase-yield-parse — blocking: yes — qa: auto：**plan 拉取收窄**（`listBySessionFromSeq`，下界 = 触发消息 seq 含；计数快照改 `countBySession`）+ repository 列表转换分片让步（`yieldFn` 注入两处装配；desktop/cli 默认直通）；T-R1/T-R2。
- Step 3 — phase-snapshot-bytes — blocking: yes — qa: auto：快照字节预算分片（源尺寸贪心分桶、`chunkTotal` 预计算）；T-R3。
- Step 4 — phase-deferred-orphan-gc — blocking: yes — qa: auto：全局孤儿清扫 deferred 化（事务提交后 fire-and-forget，模块级 in-flight 去重守卫）；T-R4。
- Step 5 — phase-token-peak-shift — blocking: yes — qa: auto：token 标签刷新错峰（快照完成信号触发）+ 内部让步（经 repo 注入自动生效）；T-R5。信号链：`ChatTranscriptWebView` 新增 `onSnapshotComplete` prop——挂点在 `sendSessionSnapshotNow` 的末片 post 且 deferred actions 排空之后（即现有 `snapshot all chunks done` 日志处，ChatTranscriptWebView.tsx:694）；被新代次顶替/重挂的 aborted 路径不发（该次快照未生效，等下一轮代次）→ `ChatConversationPanel`（screens/tabs/chat-tab/ChatConversationPanel.tsx:204 起，对齐 `onReady` 等既有回调透传形态）→ `useChatTabController` → `useChatTabMessageActions.runRollback` 消费：`reloadMessages` 之后订阅一次性信号，收到即触发 `refreshChatTokenLabel`；webview 未就绪或信号迟到给超时兜底（token 刷新最终仍执行，只是回到现状时机，不悬挂）。
- Step 6 — phase-regression — blocking: yes — qa: auto：core 全量 + mobile 全量 + typecheck；回滚语义回归 T-R6。
- Step 7 — phase-manual-verify — blocking: no — qa: manual_user：真机大会话回滚前后打点对比与录屏（AC-1/AC-3）。

## 测试策略

- T-R0 — blocking: yes — 打点存在断言：__DEV__ 门控下回滚链分段打点可被测试探针捕获（映射 Step 1）
- T-R1 — blocking: yes — plan 拉取范围：`listBySessionFromSeq`（触发消息 seq 含）圈定后 plan 结果与全量口径等价（既有 rollback 测试群零断言修改）（映射 Step 2）
- T-R2 — blocking: yes — 分片让步：>50 行列表解析在 fake timers 下出现让步点、结果逐条等价；desktop/cli 直通路径行为不变（映射 Step 2）
- T-R3 — blocking: yes — 字节预算：40 条 × 大消息切多片（按源尺寸贪心分桶）、代次/末片拼装与全量严格全等（对齐既有 T-S 系列断言形态）；小消息仍单包（`chunkTotal=1` 与现状逐字节等价，引 T-S1/T-S2 单包断言先例）（映射 Step 3）
- T-R4 — blocking: yes — deferred 孤儿清扫：回滚事务内不再全表 DELETE；提交后 fire-and-forget 调度——fake timers 下断言 `rollbackToMessage` resolve 先于清扫 SQL 执行；清扫进行中重复触发不重入（in-flight 去重）；孤儿行最终被清；回滚后至清扫前窗口内孤儿行不影响正确性（映射 Step 4）
- T-R5 — blocking: yes — token 错峰：以 `onSnapshotComplete` 信号为据断言次序——快照末片 post（含 deferred actions 排空）先于 token 全量重算发起；重算内部经 repo 注入分片让步；aborted 代次不触发消费端；超时兜底路径最终仍执行刷新（映射 Step 5）
- T-R6 — blocking: yes — 回滚语义回归：`test/message-checkpoint/*` 与 chat 回滚链路既有用例全绿（映射 Step 6）

## 风险与回滚方案

- **plan 拉取范围收窄**是本 spec 唯一触碰语义边界的点，边界已逐点核定**写死**：`resolveRollbackPlan` 对 `allMessages` 的全部消费都落在「锚点自身 + seq 更大方向」——锚点解析 `resolveRollbackAnchorMessage` 只做 tool_result 前向配对（`seq <= assistant.seq` 的消息直接跳过，resolve-rollback-anchor.ts）；tail 过滤只取 `seq >= anchor.seq`（undo_send）/ `seq > anchor.seq`（rewind）；target tree 与 prior 走 checkpoints 表、reconcile 集合不消费消息列表。唯一例外是 `messageCountSnapshot = allMessages.length`（全量计数），收窄后改用现成 `countBySession`（COUNT(*) 单行）取同一口径，事务内对比逻辑零变化。故**拉取下界 = 触发消息（clicked）的 seq（含），锚点之前消息不拉取**（新增 `listBySessionFromSeq`）；T-R1 以等价性兜底，若后续演化出现需要更早消息的新消费点，保守回退全量拉取（该点只吃分片让步收益）。
- deferred 孤儿清扫窗口内，孤儿 revision 行短暂残留（无引用但未删）——只影响存储不响正确性（GC 语义本就是收敛式）。
- 快照多片化路径已存在（generation/拼装/乱序丢弃均有防御），字节预算只是触发条件变化，风险低。
- 回滚方案：四个改动相互独立，任一出问题可单独 revert；打点为 __DEV__ 门控零生产影响。

## Context Bundle

```yaml
iteration_name: mobile-perf-2026-09 / rollback-large-jank
requirement_path: docs/Iterations/mobile-perf-2026-09/features/rollback-large-jank/prd.md
spec_path: docs/Iterations/mobile-perf-2026-09/features/rollback-large-jank/spec.md
explore_summary: >
  回滚执行链全程实证：UI(useChatTabMessageActions) → core rollback(全量 listBySession→parse 第①遍,
  事务含 deleteGlobalOrphans 全表 DELETE) → tail reload(41 条 parse 第②遍) → 快照
  (SNAPSHOT_CHUNK_SIZE=50>页40 恒单包, stringify 大包) → web 全量 applySnapshot 重建 →
  token 刷新(listBySession 全量 parse 第③遍+tokenize, 因回滚刚 invalidate 必重算) →
  composer 恢复同帧叠加。竞态类(代次/webReady/handle)有兜底基本排除。
impact_files: 见变更点清单
constraints:
  - 回滚语义零变化（锚定口径/删尾/可见性/VFS 恢复均为已拍板口径，RULE.md 回滚条目）
  - createQuantumYield 16ms 量子是既有让步原语（fake timers 测试体系须构造注入，禁宏任务裸让步）
  - webview 改动是三层产物链（src→build:webview→native assets），验证须走全链
blocking_steps: [1, 2, 3, 4, 5, 6]
```
