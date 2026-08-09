# D2a-L5：并发 & 异步跨模块模式识别

## 元信息

- 角度：L5 并发 & 异步
- 输入：`docs/review/phase1-lens/D1-05-concurrency.md` + 全部 6 份 `docs/review/phase2-slice/D2-*.md`
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly，未改动任何代码

## 结论（叙述式）

诶～跨模块这一步最有意思，因为 L5 的横扫本来已经把底座的「AsyncMutex 兜底」这一点定海神针讲清楚了，单看每条发现都像「时间维度上有一点小漏」，但把它们按主题叠起来才会发现：这个仓库在 **DB 边界之外的时间纪律几乎是空的**，而且不是某一个模块没顾上，是**所有跨 await 编排的模块都各自绕了一遍同一类问题**。

第一类系统性反模式是「**取消 / abort 语义在三套独立异步链里各自为政**」。agent-runner 在循环里散落 7+ 个 abort 检查点，命中不同 await 间隙会产生「写 partial / 不写 / 走 catch cancelled」三种结果（D1-05 A1）；cloud-sync 的 push / pull **完全不支持 abort 信号**，`tryClearLock` 只在 `finally` 里清远端锁，本地侧用户点了取消只能等几十秒事务跑完（D1-05 B）；SSE 那条 `postSse` 又是另一套——fetch 走原生 signal 干净，XHR 走 `signal.addEventListener('abort', () => emitter.dispose())` 直接丢缓冲不通知订阅者（D1-05 异步操作清单）。三套机制对「aborted 之后到底写不写、要不要 flush 残留、要不要回滚已副作用」各有各的解释，core 没有任何「可取消异步操作」的统一抽象。

第二类系统性反模式更要紧——「**异步副作用脱离调用方生命周期**」。`EventOrchestrator.attachToBus` 用 `void this.emit(...).then().catch()` 把同步总线升级成 fire-and-forget 异步链（D1-05 A2），链一旦放出去就再不受调用方控制：sub-agent 用 `publishRunLifecycle:false` 完全不进 `agentActiveRefCount`（D1-05 A2），`wrapStreamForBus` 的 `queueMicrotask` 让残留 delta 排在 `RUN_FINISHED` 之后到达（D1-05 A3）。切片补充的 D2-agent-tool A1 更进一步——message.received **故意脱离 publishRunLifecycle 门控**，未来 `agent-submember` 的子 session 用 `persistMessages:true, publishRunLifecycle:false` 时会绕过装配期 `includeCompactionOrchestrator` 开关到达进程级 orchestrator。这套「事件放出去就脱离 scope」的模式横跨 events / agent-runner / cloud-sync / 未来的 sub-agent 四个模块，**是架构层面的系统性缺陷，不是某一处的疏忽**。

第三类是「**跨 await 读-改-写编排无 session 级护栏**」。rollback 的 `resolveRollbackPlan`（多次 await 读）→ `conn.transaction`（写）之间没有禁止并发写的护栏（D1-05 B，D2-chat-message B1 补充：spec 明示这是设计选择，但 spec 自己也没写「rollback 期间 agent 必须停」）；cloud-sync push 仅入口采样 `isAgentActive` 一次，几十秒的 export+upload 链期间 agent 可以随便启动（D1-05 B）；bootstrap 的 `repairRefCounts` 跨 await 的 list → repair-floor 序列（D1-05 C）。这里**特别要点名一件事**：L5 横扫当时把 bootstrap 的 repair 降级到 C，依据是「floor 单调语义兜底 + 后续会再跑」，但 D2-vfs 切片 S1 查 bootstrap 调度后发现——**migration 是幂等的，生产路径里 repair 只跑一次，第二次启动直接跳过**，所以「后续会再跑」这条前提根本不成立。floor 兜底语义在「单次执行」语境下退化失效，repair 漏修一行或并发 capture 把 ref_count bump 上去造成的 ref_count 偏高会**永久停留**。L5 的 C 级判定被切片推翻，这条应该跟着 D2-vfs S1 升到 S 级，本报告在模式 3 里点名。

整体判断：**三个模式全部是 S 或 A 级**，根因都指向「core 缺一个统一的『可观测、可取消、可 flush 的异步操作 lifecycle』抽象」。最值得 phase3 优先关注的是模式 2（事件脱离生命周期）——它已经实打实埋下了「sub-agent 与父进程互踩」的雷（D2-agent-tool A1 + D2-chat-message S2 同样指向这条），且 `agent-subagent` 一旦进入实现就会立即触发，不是远期债务。

## 跨模块模式清单

### 模式 1：取消 / abort 语义在三套异步链各自为政

- 类型：模块间不一致（应该一致但不一致）+ 同一反模式多处出现
- 出现模块：agent-runner（abort 命中分支不一致）、cloud-sync（完全无 abort 支持）、SSE `postSse`（fetch vs XHR 两套）、message-rollback（无 abort 信号）
- 共同特征：四套独立异步链对「取消」这个语义各自解释，没有一个统一的「取消令牌 + flush + 资源释放」协议。`AbortController` 是浏览器/Node 原生能力，但每个调用方各自决定「aborted 之后写不写 partial、清不清缓冲、回不回滚已副作用」。
- 各模块差异：
  - **agent-runner**：abort 是「采样点决定结果」——命中 line 318-326 抛 AbortError 后不写任何 assistant；命中 line 331-348（请求返回但 signal.aborted）仍然写 partial assistant 再发 STEP_COMMITTED；命中 line 474-477 不写 toolResults 直接 break；命中 line 494-510 走 RUN_FINISHED。同一个用户点击「停止」，最终落库内容取决于 LLM 响应在哪一拍返回、abort 信号在哪个 microtask 传播——**时间维度的非确定性**。
  - **cloud-sync push / pull**：完全不支持 abort 信号，用户点了取消只能等几十秒事务跑完；`tryClearLock` 在 `finally` 里尽力清远端锁，但本地这条 async 链既不能中断也不能回滚已上传的 chunk。
  - **SSE `postSse`**：fetch 走原生 signal 干净取消；XHR 走 `signal.addEventListener('abort', () => xhr.abort())`，abort 后 `onabort` 调 `emitter.dispose()` **直接丢缓冲不通知订阅者**——订阅者会看到一段被截断的流，但拿不到「这是被取消的、不是网络断开」的信号。两种实现行为不一致。
  - **message-rollback**：D1-05 异步操作清单 + D2-chat-message B1 都点过——`rollbackToMessage` 无 abort 信号支持，用户取消只能等事务跑完。
- 系统性根因：core 没有定义「可取消异步操作」的对外契约。AbortController 作为传输机制存在，但「aborted 之后应该如何收尾」是每个调用方各自的隐性约定，没有文档化、没有测试覆盖。叠加 L6 横扫提到三端 microtask 调度 / XHR onprogress 节奏 / fetch 流式取消传播存在差异，同一份 abort 代码在三端实际命中的分支可能不同。
- 严重度：**A**
- 建议方向：phase3 优先裁决「abort 后落库语义」是否需要统一成硬约束。两个候选方向——(a) 在 `agent.port.ts` 里把 abort 语义写成显式契约（例如「abort 一旦在某轮被发现，本轮 accumulate 的 partial 仅作为 hidden 消息写入、不进入 LLM 上下文」），并补三端一致的回归测试；(b) 把 `cloud-sync push` 和 `rollbackToMessage` 也接入 AbortSignal，让上层能取消长链路操作，至少保证「用户取消后即使没法立即停也能尽快跳过剩余 await 点」。最低成本是先在文档里把现状钉死，避免后续维护者按「abort 一律不写」的错觉改代码。

### 模式 2：异步副作用脱离调用方生命周期

- 类型：同一反模式多处出现（系统性问题）
- 出现模块：events（`attachToBus` 的 fire-and-forget emit 链）、agent-runner（sub-agent 脱离 `agentActiveRefCount` + `wrapStreamForBus` 的 microtask 错序）、未来的 sub-agent（`agent-subagent` SPEC 定义的 `persistMessages:true, publishRunLifecycle:false` 子 session）、cloud-sync（`isAgentActive` 守卫对事件触发的 agent 失效）
- 共同特征：异步副作用一旦发出就脱离原 scope——生命周期计数、活动守卫、相对顺序、装配期 flag 都拦不住。事件总线把「已 publish」当成「已生效」，但 emit 链可能跨多个 microtask / await 持续产生副作用，调用方完全感知不到。
- 各模块差异：
  - **EventOrchestrator.attachToBus**：`void this.emit(...).then().catch()` 把同步总线升级成 fire-and-forget 异步链，**没有任何 in-flight 集合**让上层 `await orchestrator.flush()`。父 agent 在 `run` 末尾按顺序 publish `MESSAGE_RECEIVED` → `RUN_FINISHED`，但 MESSAGE_RECEIVED 触发的 emit 链可能在 RUN_FINISHED **之后**才完成（甚至跑出一个 sub-agent 写 vfs）。
  - **sub-agent 脱离活动计数**：`runRunAgentAction` 显式 `publishRunLifecycle:false`，完全不进 `activeRuns` map、不 increment `agentActiveRefCount`。`cloud-sync.push` 入口的 `isAgentActive()` 检查对它失效——用户在 sub-agent 跑的时候点同步，push 照常进行，`exportSnapshotToPath` 拿到 sub-agent 改到一半的中间状态。
  - **`wrapStreamForBus` 的 microtask 错序**：每个 text-delta / thinking-delta / tool-use 用 `queueMicrotask(() => bus.publish(...))` 推迟一个 microtask 派发。`await modelRequests.request(...)` 返回时可能仍有若干 delta 微任务排在队列里未发，紧接着的 `bus.publish(RUN_FINISHED)` 是同步发的，UI 看到的时序是 `FINISHED → 残留 delta`。
  - **未来 sub-agent 撞父进程 DAG**：D2-agent-tool A1 补充——message.received 故意脱离 publishRunLifecycle 门控（events-reliability SPEC L199-213 锁定为 intentional），未来 `agent-subagent` 子 session 用 `persistMessages:true, publishRunLifecycle:false` 时会绕过 `includeCompactionOrchestrator` 装配期开关到达进程级 orchestrator，触发父进程 events-config 里的 hide-message / refresh-macros，**作用到子 session 上**，与 sub-agent「跑完回流给主 agent」的语义冲突。装配期的 compaction 守卫挡不住 message.received 触发的 DAG。
  - **D2-chat-message S2 同源**：事件 DAG 同层若挂两条 `hide-message` + `set-floor`（events-config 用户可配，`validateEventActionDag` 只验拓扑不验资源冲突），两次 `setMessageFloorAtMessage` 的 hideRange / showRange 之间窗口会被另一边插入——同一条「事件链脱离原 scope」的反模式。
- 系统性根因：core 没有「异步操作的 in-flight 追踪 + 可 flush」抽象，也没有「事件 payload 标注所属 scope / session 层级」的契约。事件总线是进程级的，但 agent runner / sub-agent / DAG action 的 scope 边界靠各自约定。叠加 D2-agent-tool A1 提到的「装配期 flag vs run 期 flag」边界混乱，所有「在装配期关掉某机制」的开关都拦不住运行期事件链——因为事件链从总线这一层就脱离了 scope 信息。
- 严重度：**S**
- 建议方向：phase3 必须优先裁决这一条。建议方向三选一或组合——(a) 给 `EventOrchestrator` 加 in-flight 集合，提供 `await orchestrator.flush()` 让上层能等异步链收尾；(b) 给事件 payload 加 `originSessionId` / `parentSessionId` 维度，让 DAG action 能识别「这是子 session 的事件，按配置选择性忽略」；(c) 给 `runRunAgentAction` 增加独立的「事件 agent 活动」计数（与主 run 共用同一个 `agentActiveRefCount`），让 `isAgentActive` 守卫对 sub-agent 也生效。最低限度要在 `agent-subagent` 进入实现前把 (b)(c) 定下来，否则上线即翻车。

### 模式 3：跨 await 读-改-写编排无 session 级护栏

- 类型：同一反模式多处出现
- 出现模块：message-rollback（plan 阶段 → 事务执行阶段的间隙）、cloud-sync push（入口采样 + 长链路执行）、bootstrap `repairRefCounts`（跨 await list → repair）、chat-message `setMessageFloorAtMessage`（四步写无事务 + DAG 同层并发触发）
- 共同特征：跨 await 的多步操作只靠 SQLite 单连接 AsyncMutex 兜底 DB 边界，但「读快照 → 算 → 写」的窗口期允许其他 async 链插入。每条路径都用「读一次快照 → 假定快照在执行时仍有效」这个隐性假设撑着，没有 session 级写锁、没有版本号校验、没有 in-flight 标志。
- 各模块差异：
  - **message-rollback**：`resolveRollbackPlan` 包含 `messages.findById` → `listBySession` → `checkpoints.loadFileTree` → `findMissingRevisionPointers` 多次 await，每个 await 都让出执行权。这段窗口内 agent runner 可以 append 新 assistant / capture 新 checkpoint / 写新 vfs revision，然后 line 132 的事务才基于旧 plan 执行 reconcile + truncate。D2-chat-message B1 补充：spec `message-rollback-execution-redesign` §架构分层明示「事务外读 plan」是设计选择（怕长事务阻塞所有其他操作），但 spec **没有写**「执行 rollback 期间 agent 必须停」这条护栏——mobile / desktop 的 `agentRunning` 检查是这条契约的应用层实现，但没有下沉成文档化的硬性约束。
  - **cloud-sync push**：仅入口采样一次 `dbSync.isAgentActive()`（`cloud-sync-coordinator.ts:146-148`），之后 export+hash+upload 整条链可能跑几十秒到几分钟。期间 agent 入口 `handleAgentRun` 只看 `isDesktopAgentActive()`（此时 refcount 是 0），agent 照常启动。export 拿到的 SQLite 文件可能包含 agent 中途的独立事务提交。
  - **bootstrap `repairRefCounts`**：`listFilePointersForSession → listFileHeadsUnderPrefix → repairRefCountFloor` 是跨 await 的读-算-写。**L5 横扫当时把这条按 floor 单调语义降级到 C，依据是「floor 兜底 + 后续会再跑」——这条依据被 D2-vfs 切片 S1 推翻**：D2-vfs S1 查 bootstrap 调度发现生产路径里 repair **只跑一次**（migration 幂等，第二次启动直接跳过；`vfs-version-redesign` PRD 承诺的「session 切换时跑 repairRefCounts」也完全未实现，见 D2-vfs F1）。floor 兜底语义依赖「后续会再跑」这条前提，前提失效，floor 就退化成「一次性尽力而为」——并发 capture 把 ref_count bump 上去造成的偏高，或者一次 repair 漏修一行，都会**永久停留**，没有任何后续机制纠偏。L5 的 C 级判定应跟着 D2-vfs S1 升到 S。
  - **chat-message `setMessageFloorAtMessage`**：D2-chat-message S2 补充——四步写（hideRange → showRange → clearDomain(RULE_SNAPSHOT) → clearDomain(FILE_CACHE) + tokenCache.invalidate）无事务，事件 DAG 同层并发触发（hide-message + set-floor 同挂一层）会让 hideRange / showRange 窗口被插入，事务缺失叠加并发触发才是完整问题。
- 系统性根因：app 层只有 `sessionId → activeRuns` map 的入口守卫（且如模式 2 所述还漏掉 sub-agent），core 层完全没有「session 级写锁」或「执行前快照版本号校验」的概念。cloud-sync 远端用 `If-Match` 做乐观锁是仓库里唯一一处显式版本号护栏——但它只护远端 status.json，不护本地 SQLite。rollback / push / repair / setMessageFloor 四条路径共用同一个反模式，根因是「时间维度的并发约束没有跨 core 模块统一抽象」。
- 严重度：**S**（L5 横扫原本的整体判定是 A，但 D2-vfs S1 对 repair 的纠正把 bootstrap 这条从 C 升到 S，连带把整组反模式的严重度抬上去——既然 repair 的「单次执行 + 非原子」会造成永久残留，rollback / push 的「读改写间隙无护栏」就不能再当成「单用户桌面应用不会翻车」的边缘问题）
- 建议方向：phase3 优先裁决两点——(a) rollback 与 push 是否要引入 session 级软锁（app 层基于 `activeRuns` 拒绝并发，core 层 assertion），或者至少在 plan 阶段记录一个 session 级 token、事务内校验 token 未变（类似 cloud-sync 的 `If-Match`）；(b) `repairRefCounts` 的非原子性必须文档化（「依赖后续重复调用、单次调用不保证一致」），并补一个空闲调度让 floor 兜底真的能「后续再跑」（session 切换 / 用户主动触发 / KKV needs-repair flag）——这条跟着 D2-vfs S1 一起整改，不在本报告重复单模块细节。

### 模式 4：单连接 AsyncMutex 是全仓库并发兜底的单点依赖

- 类型：god module 影响（模式级别的 god pattern，而非单文件引用）
- 出现模块：vfs / message-checkpoint / chat-message / cloud-sync / agent-runner / bootstrap repair —— 所有跨 await 编排的模块
- 共同特征：所有 SQLite 访问从同一个 `TdbcConnection` 走，这条连接被 `AsyncMutex`（FIFO 链式 promise）整体串行化（`packages/tdbc-driver-better-sqlite3/src/connection.ts:21,46-76`）。这套设计是「整个仓库最重要的并发事实」——它把所有「应用层 forgot to lock」的隐患在 DB 边界吸收掉了，是模式 1/2/3 没有直接造成数据损坏的根本原因。但代价是：长事务会阻塞所有其他操作（包括无关 session 的纯读）。compaction 切片明确提到「compaction 长事务阻塞 AsyncMutex」是 events 模块执行面的问题；rollback 的事务、zip import 的 `backfillBaselineCheckpoints`（D2-vfs F3）也是同款长事务。
- 系统性根因：单连接 + AsyncMutex 是单用户桌面 / 移动应用的合理选择，但它把「跨 await 编排无护栏」这条问题压成了隐性——大家都不加锁是因为 mutex 兜底，但「DB 边界之外的正确性」其实没人在意。一旦未来某个迭代（如 L2 建议的「compaction 拆成多步并行加速」）打破了 mutex 兜底，模式 1/2/3 的所有隐性假设会同时暴露。
- 严重度：**B**（当前危害可控，因为是单点依赖而不是单点故障——mutex 兜得住；但它是「模式 1/2/3 没爆炸」的唯一原因，phase3 需要意识到这一点）
- 建议方向：任何想「拆事务、并行化、多步化」的迭代（典型是 compaction 加速、rollback 拆短事务、push 增量化）都必须配套显式锁或版本号，不能依赖 mutex 继续兜底。这条不是要改代码，而是要写进 `ARCHITECTURE.md` 作为「AsyncMutex 兜底契约」的边界声明。

## 覆盖声明

**读了**：

- `docs/review/phase1-lens/D1-05-concurrency.md` 全文（结论 + 角度×模块矩阵 + 异步操作清单 + 待交叉线索 + 7 条发现清单）
- `docs/review/phase2-slice/D2-vfs.md` 全文，重点核 S1（双计数器 + 静默 repair + 单次调度，**纠正了 L5 对 repair 的 C 级降级**）、F1（PRD 承诺未兑现）、S2 / A1 / A2 / B1 / B2 中 L5 命中段、与其他模块耦合点
- `docs/review/phase2-slice/D2-agent-tool.md` 全文，重点核 A1（**sub-agent 未来场景 `persistMessages:true, publishRunLifecycle:false` 撞父进程 DAG**）、A2（`runAgentTurn` 不透传 lifecycle）、B1（capture 改 throw 后的副作用链）、与其他模块耦合点
- `docs/review/phase2-slice/D2-chat-message.md` 全文，重点核 S1（undo_send 空兜底 + 普通 chat 路径无 backfill）、S2（`setMessageFloorAtMessage` 四步写无事务 + DAG 同层并发触发）、B1（**rollback 事务外读 plan 是 spec 明示但缺护栏**）、债务清单
- `docs/review/phase2-slice/D2-compaction.md` 通过 grep 提取 L5 命中段：B 级「mobile heuristic 回退时 token-ratio 判定吃到不准计数」（L5 + L6）；compaction 切片自承「event-config DAG 同层 parallel action 可能操作同一 session 状态」「compaction 长事务阻塞 AsyncMutex」属于 events 模块执行面问题，本切片不重复
- `docs/review/phase2-slice/D2-prompt.md` 通过 grep 提取 L5 命中段：无直接 L5 发现
- `docs/review/phase2-slice/D2-provider-llm.md` 通过 grep 提取 L5 命中段：无直接 L5 发现

**没读**（及原因）：

- 实现源码。指导文档明确「不读实现代码，输入是 D1 + D2 报告」，本次严格遵循。如发现 D1 / D2 结论需要核实，按指南要求标 `待回派`，未自行翻代码。
- 其他角度的 D1 横扫报告（L1-L4、L6-L11）。指导文档明确「不和其他角度对比，那是 Phase 3 的事」。

## 给 Phase 3 的线索

- **模式 2（事件脱离生命周期）** 是最优先项，且可能与 L3（架构）、L4（错误处理，sub-agent 内部异常被 `reportActionFailure` 默认 console.error 吞掉）、L8（事件配置允许任意 sub-agent 跑而无活动门禁）三条角度的发现重叠。phase3 拉这些角度一起裁决时，**重点要回答「事件 payload 是否需要带 `originSessionId` / `parentSessionId`」**——这条决策直接影响 `agent-subagent` 的实现路径。
- **模式 3（async 边界无护栏）** 与 L4（事务缺失）高度重叠，但 L5 视角坚持两点 L4 没覆盖——(a) rollback 的 plan 阶段即使事务完整也无法避免「读快照过时」（间隙问题）；(b) `setMessageFloorAtMessage` 若被事件 DAG 同层并发触发，hideRange / showRange 的事务缺失才暴露完整问题。phase3 裁决时要明确「session 级写锁」是 core 层抽象还是 app 层契约，**不要让两条路径各自整改**。
- **D2-vfs S1 对 L5 的纠正**：L5 横扫把 bootstrap repair 降到 C 的依据（floor 兜底 + 后续会再跑）被切片证伪，应跟着 D2-vfs S1 升到 S 级。phase3 计分时这条要从 L5 的 C 调整到 S，本报告已在模式 3 里点名。
- **模式 1（abort 不一致）** 与 L4（partial 污染下一轮上下文）和 L6（三端 abort 时序一致性）都重叠。L4 关心「数据正确性」，L5 关心「同一个用户操作因为网络抖动命中不同分支产生不同结果」，L6 关心「三端 microtask 调度差异让同一份代码命中不同分支」。三者要合并计分，**整改方向不能各做各的**——L4 改事务、L5 改时序契约、L6 改三端对齐，必须协同。
- **模式 4（AsyncMutex 兜底）** 与 L2（算法，长事务对响应延迟的影响）潜在冲突：如果 L2 建议「拆成多步并行加速」，L5 必须坚持「跨步共享状态的并行需要显式锁或版本号」，否则会破坏 mutex 兜底。phase3 要把这条作为「AsyncMutex 兜底契约」写进 `ARCHITECTURE.md`。

## 备注

- 全程 readonly，未改动任何代码。
- 不宣布 ready。三个跨模块模式的终判都需要 phase3 与 L2 / L3 / L4 / L6 / L8 协同裁决，本报告只做聚拢和方向建议。
