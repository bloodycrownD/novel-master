# D1-05：并发 & 异步（L5 角度横扫）

## 元信息

- 角度：L5 并发 & 异步
- 范围：`packages/core/src` 全部带异步/并发场景的模块（`infra/llm-protocol`、`infra/cloud-sync`、`infra/events`、`service/agent`、`service/events`、`service/message-checkpoint`、`service/vfs`、`bootstrap`），以及三端 app 中管理 agent 活动状态 / 云同步守卫的薄壳（`apps/desktop/src/main/runtime/agent-activity.ts`、`apps/mobile/src/runtime/agent-activity.ts`、对应 `ipc/handlers/agent.ts`）
- 参考文档：
  - `docs/review/guides/lens-L5-concurrency.md`
  - `docs/review/phase0/D0-1-code-map.md`、`docs/review/phase0/D0-2-docs-index.md`
  - 高优先 Iterations：`mobile-llm-streaming`、`mobile-sse-stream-resilience`、`llm-protocol-anthropic-gemini-parity`、`event-bus-compaction-conditions`、`event-config-dag`、`chat-tool-turn-phase-ui`、`cross-device-cloud-sync`
- 轮次：第 1 轮（首次横扫）
- 产出日期：2026-08-05
- 模式：readonly，未改动任何代码

## 结论（叙述式）

诶～这一篇要先把结论讲清楚再上发现清单，因为整个仓库的并发模型有一处「定海神针」级别的事实，不先点出来后面每条都会显得比实际严重——**所有 SQLite 访问都从同一个 `TdbcConnection` 走，而这条连接被 `AsyncMutex`（FIFO 链式 promise）整体串行化**（`packages/tdbc-driver-better-sqlite3/src/connection.ts:21,46-76`、`packages/tdbc-driver-rn/src/connection.ts` 同款）。意思是任意时刻只能有一个 SQL 在飞，连 `transaction(fn)` 也是先把 mutex 锁住再 BEGIN/COMMIT，所以「两个 async 操作同时各跑半条 SQL 把数据写花」这种经典数据库竞态在这里**结构性不可能**发生。这条事实把一大票潜在 A 级问题压成了 B 或 C。

但 mutex 只护住「单条 SQL/单个事务内的若干 SQL」，它**不护住「跨多个 await 的读-改-写编排」**，也不护住「不经过 DB 的共享状态」（事件总线、agent 活动计数、AbortController、SSE 缓冲）。所以这一篇真正关心的并发面是这三类：

第一类是**应用层的读-改-写窗口**——多步操作中间隔了 `await`，mutex 在每个 await 点都会放别人进来。`message-rollback.service.ts` 的 `rollbackToMessage` 是最典型的一例：`resolveRollbackPlan`（多次 await 读 message / checkpoint / vfs）结束后才进 `conn.transaction` 写入，两段之间没护栏，agent runner 完全可以在这段时间内 append 新消息、capture 新 checkpoint、写新 vfs revision。plan 拿到的是「几秒前的快照」，事务里 truncate 和 reconcile 就按这个旧快照执行。事务本身是原子的（L4 已经确认），但**事务之外的「读快照」和「执行」之间没有原子性约束**，rollback 的正确性强依赖「用户点 rewind 时 agent 一定没在跑」这条隐性约定。

第二类是**事件总线的异步派发与 abort 语义**。`SimpleEventBus` 自己是同步的（`simple-event-bus.ts:51-63`，按订阅顺序同步调，handler 抛错被 catch 兜底），但 `EventOrchestrator.attachToBus` 用 `void this.emit(...).then().catch()` 把同步发布升级成 fire-and-forget 异步链（`event-orchestrator.service.ts:71-88`）。这条异步链一旦放出去就再不受调用方控制：agent runner 在循环末尾 `bus.publish(EVENT_SESSION_MESSAGE_RECEIVED)` 之后立刻 publish `RUN_FINISHED`，但 MESSAGE_RECEIVED 触发的 emit 链可能还在跑（甚至跑出一个 sub-agent），UI 看到的顺序就是「FINISHED 早于 message-received 的副作用」。同样地，agent-runner 里 `wrapStreamForBus` 用 `queueMicrotask` 把 text-delta/thinking-delta/tool-use 推到总线上（`agent-runner.ts:587-614`），这些 microtask 在 `await modelRequests.request(...)` 返回之后、乃至 abort 触发之后仍可能排在任务队列里待发，RUN_FINISHED 之后到达的迟到的流式 delta 是 UI 端真实存在的竞态。

第三类是**abort 的 partial 污染 + agent 活动计数的多源真相**。agent runner 在 abort 之后会判断 `hasMeaningfulAssistantBlocks`，若为真仍然 `session.append('assistant', ...)`（`agent-runner.ts:331-348`）——L4 已经从「半截 assistant 污染下一轮 LLM 上下文」的角度标记过。L5 视角的补充是：abort 的语义在循环里有**三处不一致的检查点**（line 318-325 检查 throw、line 331-348 写 partial、line 474-477 不写），意味着「取消之后到底写不写」取决于取消命中哪一个 await 间隙——这是个会随网络抖动改变结果的非确定性窗口。与此同时，「agent 是否在运行」这个全局状态有两套真相：core 侧没有计数（agent runner 自己不发任何「我活着」的全局信号），只有 app 层的 `agentActiveRefCount`（desktop/mobile 各一份进程级模块变量）。这套计数**只覆盖 publishRunLifecycle=true 的入口**（IPC 触发的 runAgentTurn），事件编排器触发的 `run-agent` action（`run-agent.handler.ts:99-110`，明确 `publishRunLifecycle: false`、`persistMessages: false`）完全不进入计数。后果是：用户在 UI 上点了「同步」/「导出备份」，`isAgentActive()` 返回 false，云同步 push 或 db-backup 就会与一个正在写 vfs 的 sub-agent 并发进行——mutex 还能保证 SQL 不冲突，但导出的快照会包含 sub-agent 写到一半的中间状态，对用户来说就是「我同步出去的库是个半成品」。

整体判断：**底座是稳的（mutex 兜底 + 事务覆盖度高），但「时间维度」的纪律只覆盖到 DB 边界**。一离开 DB 进入「事件 / 活动 / abort / 远端对象存储」这一层，几乎全靠「这条路径实际不会并发」的隐性假设撑着，没有任何显式的互斥或版本号机制。这种风格在单用户桌面/移动应用里通常不会立即翻车，但每次新增触发源（事件配置 DAG、sub-agent、云同步、未来可能加的定时任务）都会把对应的隐性假设撑破一处。

下面进发现清单，按严重度排序。

## 角度 × 模块矩阵

每段先给判定，再补一句为什么。完整的「异步操作清单」表格见下一节。

### cloud-sync —— 乐观锁正确，但本地侧无互斥（B + A 间隙）

`conditionalPutStatus` 用 `If-Match` 实现远端 status.json 的乐观并发，`LOCK_CONTENTION` 被识别成重试信号，`push` 末尾 `tryClearLock` 在 `finally` 里尽力清锁——远端这一侧设计是对的。问题在**本地侧**：`push` 只在入口采样一次 `dbSync.isAgentActive()`（`cloud-sync-coordinator.ts:146-148`），后面 `exportSnapshotToPath → hashSnapshotFile → putFile → conditionalPutStatus` 整条链可能跑几十秒到几分钟，期间没有任何机制阻止 agent 启动；反过来 agent 启动时也不检查「云同步是否在进行」。lock 是远端的，本地两个进程（其实是同一个 Node，但两条 async 链）之间完全没互斥。

### vfs —— 单次写有事务 + 乐观版本号，跨操作编排无串行（B）

`RevisionAwareVfsService.write/delete/resetHead/hardDelete/rename` 全部走 `runInTransactionOrConn`，单条原子。`replace` 是 read-then-write，read 在事务外（`revision-aware-vfs.service.ts:101`），但 write 用 `expectedVersion: current.version` 做乐观锁（line 124-127），并发改写会落到 vfsConflict 而不是 silently lost update——这个设计是对的，只是失败的那一方会拿到一个错误而非自动重试。真正的并发风险来自**两个 runParallel 之间不共享 path 串行表**（详见 agent-runner 段）。

### agent-runner —— abort 三处不一致 + sub-agent 脱离活动计数（A）

`DefaultAgentRunner.run` 是全仓库最复杂的异步状态机：单轮内 7+ 个 `signal?.aborted` 检查点散落在不同 await 之间，abort 的「写不写 partial」语义随命中位置变化（line 331 写、line 474 不写、line 176/183/192/208/222/254/402/474 立即 break）。最关键的是 line 331-348 的 partial 写入与 line 474-477 的不写不对称——同一个 abort 在不同时刻到达，结果不同。再叠加 `EVENT_SESSION_MESSAGE_RECEIVED` 触发的 sub-agent 链异步跑、共用同一份 `messages` 和 `vfs`，agent-runner 没有任何「同一 session 不允许两个 run 并发」的护栏，全靠 app 层 `activeRuns` map 在 IPC 入口拦截。

### event-bus —— 同步发布正确，异步编排链无序（A）

`SimpleEventBus` 自身没问题，订阅集合在 publish 时被快照迭代、handler 抛错被 catch、注册顺序就是调用顺序。问题全在 `EventOrchestrator.attachToBus` 把同步总线升级成 fire-and-forget 异步链——见发现 A2。

### event-config DAG —— 同层并行可能撞同一会话状态（B）

`runDag` 用 `Promise.allSettled(batch.map(...))` 让「同一 dependency 层的多个 action 并行执行」（`event-orchestrator.service.ts:186-198`）。当前默认配置里 COMPACTION_REQUESTED 只挂一个 `hide-message`，并行无影响；但 events-config 是用户可配置的，一旦同一层挂了 `hide-message + run-agent` 两个 action，两者会同时操作同一 session 的 messages / vfs，没有任何串行保证。validateEventActionDag 只验拓扑（无环、依赖存在），不验「同层 action 是否会写同一资源」。

### message-checkpoint / rollback —— 事务内正确，事务外读快照非原子（A）

见上面结论里的第一类描述。`rollbackToMessage` 的 plan 解析阶段（`message-rollback.service.ts:110-130`，多次 await）和事务执行阶段（line 132-153）之间没有「禁止并发写」的护栏，agent-runner 又没有任何机制感知 rollback 在跑。

### provider / session-kkv —— 串行无并发风险（无发现）

provider.service 的 create/edit/delete 跨 secretStore + DB 多步无事务（L4 主），但从 L5 视角看：`async list()` 用 `Promise.all(rows.map(async ...))` 并发查 apiKeyStatus（`provider.service.ts:53-61`），每个 status 查询走 sksp——这条并发路径是无副作用的读，安全。session-kkv 的 clearDomain 等操作各自走 mutex 串行，没有跨操作的共享内存状态。

### bootstrap —— 异步 repair 不在事务里（B，因 floor 语义退化成 C）

`bootstrapNovelMaster` 在事务外 fire-and-forget 触发 `repairRefCounts(...).catch(() => {})`（`novel-master-bootstrap.ts:107-113`），repair 函数自身也没有事务包裹（`revision-ref-count.ts:85-122` 多次 await）。L1 已经从「静默吞错」角度标过。L5 视角的补充：repair 的 `listFilePointersForSession → listFileHeadsUnderPrefix → repairRefCountFloor` 是一段读-算-写，期间 agent 完全可以 capture checkpoint（→ `adjustRef` bump ref_count）。**好在** `repairRefCountFloor` 的语义是「只增不减」的 floor（`vfs-revision.port.ts:130-134` 注释明示「保守纠偏」），并发 bump 不会被 repair 的 stale want 覆盖掉，最坏只是 repair 漏修一行——所以这条按严重度参考表退化到 C，但仍然要在文档里写清楚「repair 不是原子的，只能用作单调兜底」。

### SQLite 连接管理 —— 单连接 + AsyncMutex 是全仓库的并发保险丝（无发现，但是关键背景）

`BetterSqlite3Connection` / `RnConnection` 都在构造时持有一个 `AsyncMutex`，所有 execute/query/batch/transaction 都从 `mutex.run` 走，transaction 内部 BEGIN/COMMIT/ROLLBACK 全在 mutex 持有期间完成（`connection.ts:46-76`）。这套设计是**整个仓库最重要的并发事实**——它把所有「应用层 forgot to lock」的隐患在 DB 边界吸收掉了。代价是：长事务会阻塞所有其他操作（包括无关 session 的纯读），L2 算法角度可能会注意到 compaction/rollback 这种长链路事务对响应延迟的影响。

## 异步操作清单

| 操作 | 共享状态 | 并发控制 | abort 行为 |
|------|----------|----------|------------|
| `agent-runner.run` 循环 | `messages`、`vfs`（revision/entry）、`session_kkv`、`message_checkpoint`、`eventBus` | 单 session 靠 app 层 `activeRuns` map 拦截；core 层无护栏；同一 run 内 tool 调用由 `ToolRunner.runParallel` 的 path-tail 串行 | abort 采样点 7+ 处；line 331 写 partial assistant、line 474 不写、line 495 catch 后只清缓存不回滚已写消息 |
| `run-agent` 事件 action（sub-agent） | 同上（同一 `messages` / `vfs`） | **无**——`publishRunLifecycle:false` 不进 `activeRuns`、不增 `agentActiveRefCount`；与父 agent 共享 conn 但无串行保证 | sub-agent 自身不暴露 signal 给事件配置；父 agent 的 abort 不传递给已派发的 emit 链 |
| `cloud-sync push` | 远端 status.json + 本地 SQLite 全库快照 | 远端：`If-Match` 乐观锁；本地：**仅入口采样 `isAgentActive()` 一次**，无任何持续互斥 | 无 abort 信号支持；`tryClearLock` 在 finally 尽力清远端锁 |
| `cloud-sync pull` | 远端 snapshot + 本地 SQLite | 无本地互斥；不检查 `isAgentActive`（pull 只 import 不 export，破坏性较弱） | 无 abort 信号支持 |
| `message-rollback.rollbackToMessage` | `messages`、`vfs_entry/revision`、`message_checkpoint`、`session_kkv` | 事务内完整；事务前 `resolveRollbackPlan` 的多次读之间无护栏，agent 可在间隙写入 | 无 abort 信号支持；用户取消只能等事务跑完 |
| `message-checkpoint.capture` | `message_checkpoint`、`vfs_revision.ref_count` | `runInTransactionOrConn` 单事务原子；持锁期间 mutex 阻塞其他写 | 无 abort 信号支持 |
| `EventOrchestrator.emit`（DAG） | 经由配置触发的任意 action 副作用 | 同层 action 用 `Promise.allSettled` 并行；层间 await；DAG 校验只验拓扑不验资源冲突 | 无；emit 链一旦从 `attachToBus` 派发就不可取消 |
| `bootstrap.repairRefCounts` | `vfs_revision.ref_count` | **无事务**；fire-and-forget；依赖 floor 语义兜底 | 启动时一次性触发，无取消概念 |
| `ToolRunner.runParallel` | per-invocation 的 `pathTail` Map | 同 path 串行、跨 path 并行；**两次 runParallel 之间不共享 pathTail** | tool 自身按 ctx.vfs 的 abort 行为（vfs 操作不支持 abort） |
| `user-vfs-turn.executeOp` | `vfs`、`user_ops_log` | 同 `ToolRunner.runParallel`；失败时 reverse-restore 基于 entry 时刻的 head snapshot | 无 abort 信号支持 |
| `postSse`（XHR / fetch） | SSE chunk emitter 的 buffer、`setInterval` timer | 单流单 emitter；多流间无共享状态 | fetch 走原生 `signal`；XHR 在 `signal.addEventListener('abort', () => xhr.abort())`；abort 后 `onabort` 调 `emitter.dispose()` 丢缓冲 |
| `wrapStreamForBus` 流式 → bus | `eventBus`、UI 订阅者 | `queueMicrotask` 延迟发布，每 delta 一个 microtask | abort 后已 queue 的 microtask 仍会触发 publish，可能与 `RUN_FINISHED` 错序 |

## 待交叉的线索

- **与 L4 的边界**：agent-runner 的 partial-assistant-on-abort（A）和 `setMessageFloorAtMessage` 无事务（A）都被 L4 标过。L5 不重复事务层面的判定，但坚持两点 L4 没覆盖的——(a) abort 写 partial 与 abort 不写 partial 的两处分支语义不一致，是「时间维度上的非确定性」，不是「缺事务」；(b) `setMessageFloorAtMessage` 若被并发触发（事件 DAG 同层挂两条 hide-message + set-floor，或 sub-agent 与父 agent 同时置位），hideRange/showRange 的两次写之间窗口会被另一边插入，事务缺失叠加并发触发才是完整问题。
- **与 L1 的边界**：bootstrap 异步 repairRefCounts 的「不在事务里」L1 已从「吞错」标记；L5 视角补充「跨 await 的读-改-写、与正常 capture 并发」，但因为 floor 单调语义退化到 C。冲突点：L1 倾向于「修也无所谓，是安全网」，L5 倾向于「至少要在文档里写明 repair 非原子，避免后续被改成强语义」。
- **与 L2 的边界**：单连接 + AsyncMutex 是「全仓库串行」的代价——compaction 和 rollback 这种长事务会阻塞所有其他操作。L2 如果建议「拆成多步并行加速」，L5 必须坚持「跨步共享状态的并行需要显式锁或版本号」，否则会破坏当前的 mutex 兜底。
- **与 L6 的边界**：abort 三处不一致（A1）和 stream-bus microtask 错序（A3）在三端表现可能不同（RN 的 microtask 调度、XHR 的 onprogress 节奏、fetch 流式的取消传播），L6 来扫时要确认三端是否同样地命中那个不一致分支。

## 发现清单

### A agent-runner 的 abort 写入语义在循环内三处不一致

- 位置：`packages/core/src/service/agent/impl/agent-runner.ts:318-348`、`474-477`、`494-510`
- 问题：abort 被检测到的位置决定了用户能看到什么。
  - 命中 line 318-326（`await modelRequests.request` 抛 AbortError）→ `stopReason='cancelled'` 后 break，**不写**任何 assistant。
  - 命中 line 331-348（请求正常返回但 `signal.aborted`）→ 若 `hasMeaningfulAssistantBlocks` 为真，**仍然写** partial assistant，再 publish `STEP_COMMITTED`。
  - 命中 line 474-477（tool 结果已就绪、即将 append toolResults 时发现 aborted）→ **不写** toolResults，直接 break。
  - 命中 line 494-510（外层 catch 抓到非 Abort 错误但 signal 已 aborted）→ `stopReason='cancelled'`，**不抛**，正常进 FINISHED 路径。
  对同一个用户点击「停止」，命中哪一条取决于 LLM 响应在哪一拍返回、abort 信号在哪一个 microtask 上传播——结果是非确定的。line 331 写下来的那行 partial assistant 会进 `chat_message` 表、进下一轮 LLM 的 prompt 拼装、进 `MESSAGE_RECEIVED` 触发的 sub-agent 视野；line 474 没写的 tool_results 又会让上一条 assistant 的 tool_use 永远等不到 result（被 `normalizeOrphanToolResultsForLlm` 兜底，但语义已经偏了）。
- 依据：L4 在 D1-04 的 B 级条目里标过「abort 后仍把部分 assistant 内容写库」，这里坚持 A 级——L4 的关切是「partial 污染下一轮上下文」（数据正确性），L5 的关切是「同一个用户操作因为网络抖动命中不同分支产生不同结果」（时间维度的非确定性），是两个不同的问题。两处应该一并改。
- 建议：统一成「abort 一旦在某轮被发现，本轮已 accumulate 的 partial 仅作为 hidden 消息写入（供用户回放），不进入 LLM 上下文拼装」；或者更保守地「abort 后本轮一律不写」。两处 line（331、474）的分支语义对齐后再补单测覆盖三种命中时序。
- 涉及角度：L5 主；L4（partial 污染）；L6（三端 abort 时序一致性）

### A EventOrchestrator 的 fire-and-forget 异步链与 sub-agent 脱离活动计数

- 位置：`packages/core/src/service/events/impl/event-orchestrator.service.ts:66-98`（attachToBus 的 `void this.emit(...).then().catch()`）；`packages/core/src/service/events/impl/actions/run-agent.handler.ts:99-110`（`publishRunLifecycle: false`、`persistMessages: false`）
- 问题：分两层。
  - 第一层：attachToBus 把同步总线包装成异步链后，agent-runner 在 `run` 末尾按顺序 `publish(MESSAGE_RECEIVED)` → `publish(RUN_FINISHED)`（`agent-runner.ts:518,522`），两条 emit 都被异步派发。但 MESSAGE_RECEIVED 触发的 DAG 里如果挂了 `run-agent`，这个 sub-agent 的 `runner.run` 会写 vfs、读 messages、调 messageCheckpoint.capture——这些操作发生在父 agent 的 RUN_FINISHED **之后**，从 app 层看就是「agent 已经结束了怎么还在写库」。
  - 第二层：sub-agent 用 `publishRunLifecycle: false`，完全不进 `activeRuns` map、不 increment `agentActiveRefCount`。`cloud-sync.push` 的入口 `isAgentActive()` 检查（`cloud-sync-coordinator.ts:146`）对它失效——用户在 sub-agent 跑的时候点同步，push 会照常进行；`exportSnapshotToPath` 拿到的是 sub-agent 改到一半的中间状态。db-backup 的 import/export 同理（`apps/desktop/src/main/services/db-backup.service.ts:150,177`）。
- 依据：`runRunAgentAction` 显式声明 `publishRunLifecycle: false`（`run-agent.handler.ts:108`），注释只说「event action 不发生命周期事件」，没有提到「因此脱离 isAgentActive 守卫」这一副作用。`isDesktopAgentActive` / `isMobileAgentActive` 只在 `onCoreRunStarted/Finished/Failed` 三处递减递增（`ipc/handlers/agent.ts:192-228`），这三个回调只监听 core 的 RUN_STARTED/FINISHED/FAILED 事件——sub-agent 不发这些事件，所以不入计数。这条「事件 action 不算 agent 活动」的设计意图需要 phase3 与产品确认，否则按当前实现就是漏。
- 建议：要么给 `runRunAgentAction` 增加一个独立的「事件 agent 活动」计数（与主 run 共用同一个 `agentActiveRefCount`），要么在文档里明确「事件触发的 agent 不受 sync/backup 守卫保护，调用方自行避免」并加 console.warn。同时建议 `attachToBus` 的 fire-and-forget 至少保留一个 in-flight 集合，让上层能 `await orchestrator.flush()`。
- 涉及角度：L5 主；L4（错误处理，sub-agent 内部异常被 `reportActionFailure` 默认 console.error 吞掉）；L8（安全/边界，事件配置允许任意 sub-agent 跑而无活动门禁）

### A wrapStreamForBus 的 `queueMicrotask` 导致流式 delta 与 RUN_FINISHED 错序

- 位置：`packages/core/src/service/agent/impl/agent-runner.ts:581-625`
- 问题：每个 text-delta / thinking-delta / tool-use event 都通过 `queueMicrotask(() => bus.publish(...))` 派发。这意味着：(a) `await modelRequests.request(...)` 返回时，可能仍有若干 delta 微任务排在队列里未发；(b) 紧接着的 `bus.publish(EVENT_AGENT_RUN_FINISHED)` 是**同步**发的，会先于上述微任务到达订阅者。UI 拿到的时序就是 `FINISHED → 残留 text-delta → 残留 tool-use`。abort 场景更糟：abort 检测（line 331）后会 publish STEP_COMMITTED，再循环外 publish FINISHED，但前面队列里的流式 delta 仍在 FINISHED 之后才到——UI 看到一段「已经结束的对话又在跳字」。
- 依据：`SimpleEventBus.publish` 是同步遍历 handlers，但 `wrapStreamForBus` 主动把每次 publish 推迟一个 microtask——这是为了不阻塞 LLM 流式回调，但代价是放弃了发布顺序保证。注释「@internal Exposed for stream-bus deferral unit tests」表明作者知道这里是延迟发布，但没提到与 FINISHED 的错序风险。
- 建议：在 publish RUN_FINISHED 之前 `await Promise.resolve()` 一次（或显式 await 一个空 microtask 队列）让残留 delta 先发；或者把 FINISHED 也走 microtask 队列保持相对顺序；或者用 `queueMicrotask` 链 + flush token，在 run 末尾等所有 token resolve。三选一，最低成本是第一种。
- 涉及角度：L5 主；L6（三端 microtask 调度差异）

### B cloud-sync push 仅入口采样 `isAgentActive`，push 期间允许 agent 启动（反之亦然）

- 位置：`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-224`；agent 启动入口 `apps/desktop/src/main/ipc/handlers/agent.ts:264-334`、mobile 同款
- 问题：push 在 line 146-148 检查 `isAgentActive()` 一次，之后整条 export+upload 链可能跑数十秒。这段时间内 agent 入口并没有「云同步在跑」的检查——`handleAgentRun` 只看 `isDesktopAgentActive()`，refcount 此时是 0，agent 照常启动。结果是 export 拿到的 SQLite 文件可能包含 agent 中途的写入（agent runner 的 `session.append` 各自是独立事务提交，会立即可见）。pull 反向同理但破坏性小。
- 依据：远端 `If-Match` 锁是跨设备锁，与本机 agent 活动无关。`tryClearLock` 在 finally 里跑也只清远端，不清任何本地状态。整个 `cloud-sync-coordinator` 模块没有任何「本地 push 进行中」的 flag 暴露给 agent 入口。
- 建议：在 app 层（不是 core 层）加一个 `isCloudSyncActive()` 模块级 flag，push 开始置 true、结束（无论成败）置 false；`handleAgentRun` 入口和 `db-backup` 入口都加一次检查。core 层不必动，因为 core 不应该知道 cloud-sync 的存在（分层约束）。
- 涉及角度：L5 主；L3（架构，flag 应该在 app 层而不是 core）

### B `rollbackToMessage` 的 plan 阶段与执行阶段之间无并发护栏

- 位置：`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:102-155`
- 问题：`resolveRollbackPlan` 里包含 `messages.findById` → `messages.listBySession` → `checkpoints.loadFileTree` → `findMissingRevisionPointers` 等多次 await，全部走 conn 的 mutex 但每个 await 都会让出执行权。这段窗口内 agent runner 可以 append 新 assistant / capture 新 checkpoint / 写新 vfs revision。然后 line 132 的事务才基于旧 plan 执行 reconcile + truncate。事务内不会脏（L4 已确认），但事务依据的 `targetTree` 和 `pathsNeedWrite/pathsNeedDelete` 是过时的——agent 在 plan 之后写入的新文件不会被 reconcile 处理（plan 没把它们算进 pathsNeedDelete），只能靠 `truncateTailInTransaction` 的 `sweepRevisions: true` 清掉 revision 行；而 vfs_entry.head_version 还指向被清掉的 revision，留下悬挂指针。
- 依据：`assertRollbackOptionsCompatible` 只校验 options 组合，不校验「当前是否有 agent 在跑」。rollback 通常由用户在 UI 触发，按当前 UI 设计用户点 rewind 时 agent 应该已停——但这只是 UI 约定，core 层没有任何 assertion。事件 DAG 触发的 hide-message / sub-agent 完全可以与 rollback 并发。
- 建议：rollback 入口加一个「同一 session 持有写锁」的软约束（app 层基于 `activeRuns` 拒绝并发，core 层 assertion）。或者在 plan 阶段记录一个 session 级 token、事务内校验 token 未变（类似 cloud-sync 的 `If-Match`），变则拒绝执行。
- 涉及角度：L5 主；L4（与「agent-runner append+capture 无事务」叠加才完整）

### B 事件 DAG 同层 action 用 Promise.allSettled 并行，无资源冲突校验

- 位置：`packages/core/src/service/events/impl/event-orchestrator.service.ts:186-225`；校验入口 `validateEventActionDag`
- 问题：当前默认 events 配置每个事件只挂一个 action，并行无影响。但 events-config 是用户可配的，`event-config-dag` 这个 Iteration 的存在本身就说明后续会被扩展。一旦同一 dependency 层挂了 `hide-message + run-agent`，两者会通过 `Promise.allSettled` 并发执行：hide-message 调 `setMessageFloorAtMessage`（多次写 message + session_kkv），run-agent 调一整套 agent runner（读 messages + 写 vfs + capture checkpoint）。两者操作同一 session 的同一份 messages，读-改-写窗口完全重叠。
- 依据：`validateEventActionDag` 只验拓扑结构（环、依赖存在、未知 action type），不验「同层 action 是否写同一资源」。`prevalidateDag` 同款。
- 建议：要么明确文档化「同层 action 必须互不写同一 session 状态」（让用户自己保证），要么把 DAG 的同层并行改成串行（语义更安全，牺牲一点并行度）。当前默认配置下不会触发，标 B 而不是 A。
- 涉及角度：L5 主；L3（DAG 执行模型的语义定义）

### C handleAgentRun 的 check-then-set 在 IPC 并发下可能覆盖 activeRuns 条目

- 位置：`apps/desktop/src/main/ipc/handlers/agent.ts:264-334`；mobile 同款
- 问题：`handleAgentRun` 入口先 `if (isDesktopAgentActive()) return AGENT_BUSY`，然后 `await getDesktopRuntime()`（让出执行权），之后才 `activeRuns.set(sessionId, ...)` 与 `incrementDesktopAgentActive()`。如果同一 session 的两个 abort/run IPC 调用交错（用户极快连点），第二次的 `activeRuns.set` 会覆盖第一次的 entry，第一次的 controller 引用丢失——abort 第二次时只能 abort 第二次的 controller，第一次的 run 仍在跑但已不可取消。refcount 不影响（两次 increment → 2，第二次的 finally 只 decrement 一次），但 `activeRuns` map 的语义被破坏。
- 依据：Node 的 IPC handler 默认不保证同 channel 串行，handleAgentRun 又是 async。abort 的注释「decrement 交给 RUN_FINISHED/FAILED 或 finally 兜底」假设 entry 与 runId 一一对应，覆盖之后这个假设破。
- 建议：在 check 之后、await 之前就用一个「pending」entry 占位；或者把 isAgentActive 检查与 set 移到同一个同步块内（去掉中间的 await，把 getDesktopRuntime 移到 set 之后）。
- 涉及角度：L5 主；L7（这种竞态需要 IPC 层并发单测覆盖，目前没有）

### C bootstrap 异步 repairRefCounts 跨 await 的读-改-写

- 位置：`packages/core/src/bootstrap/novel-master-bootstrap.ts:107-113`；`packages/core/src/domain/vfs/logic/revision-ref-count.ts:85-122`
- 问题：见结论里 bootstrap 段的描述。floor 单调语义把这条压到 C——并发 bump 不会被覆盖，最坏只是漏修一行。
- 依据：`vfs-revision.port.ts:130-134` 注释明示 floor 语义。
- 建议：在 `repairRefCounts` 函数注释里写清「非原子、只增不减、跨 await 与正常 capture 并发」，避免后续有人把它当成强一致修复来扩语义。
- 涉及角度：L5（与 L1 交叉）

## 备注

- 全程 readonly，未改动任何代码。
- 不宣布 ready。多处发现需要与 L4（abort 写入语义）、L1（repair 语义）、L3（DAG 并行模型）、L6（三端 abort/microtask 一致性）、L8（事件配置安全边界）交叉后才能定终判，留给 phase2/phase3。
- 异步操作清单表格里的「并发控制」一栏是后续 phase2 切片（尤其 chat-message / agent-tool / compaction）会反复回查的索引，建议保持同步更新。
