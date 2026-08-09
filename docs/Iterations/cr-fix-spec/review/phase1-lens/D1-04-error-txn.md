# D1-04：错误处理 & 事务（L4 角度横扫）

## 元信息

- 角度：L4 错误处理 & 事务
- 范围：`packages/core/src` 全部带持久化或多步副作用的模块（ vfs / chat / message-checkpoint / provider / agent / workplace / template / cloud-sync / bootstrap）
- 参考文档：
  - `docs/review/guides/lens-L4-error-txn.md`
  - `docs/review/phase0/D0-1-code-map.md`、`docs/review/phase0/D0-2-docs-index.md`
  - 高优先 Iterations：`message-rollback-execution-redesign`、`rollback-failure-degraded-fallback`、`rollback-import-baseline-checkpoint`、`rollback-mkdir-idempotent`、`rollback-revision-head-backfill`、`message-rollback-remove-session-log`、`message-checkpoint-v2`
- 轮次：第 1 轮（首次横扫）
- 产出日期：2026-08-05
- 模式：readonly，未改动任何代码

## 结论（叙述式）

诶～开头先讲结论再上发现清单哦，按指导文档的口味来。

整体看下来，这个仓库的事务纪律**远高于**普通业务系统，但只覆盖了「同一连接同一 SQLite 库内的多表写」。凡是跨过这条边界——外部 secret store（sksp）、外部对象存储（cloud-sync）、甚至只是「同一连接上却拆成多个独立写」的编排路径——就几乎全裸跑，没有原子保证。换句话说，事务画得**对，但画在小圈子里**：圈内严丝合缝，圈外靠运气。

rollback 是这套系统花了最多心思的地方，五个 `rollback-*` 迭代全是修补痕迹。当前实现把 reconcile + truncate 全部塞进单事务，配合 `revision-ref-count` 和 baseline backfill，**rollback 自身的回滚是可信的**——事务里崩了就整段回掉，不会留半套状态。但 rollback 的**错误分类**仍有缺口：`reconcileVfsPaths` catch 之后用 `formatDegradableMessage` 把 cause 拍平成字符串再包成 `ROLLBACK_VFS_RESTORE_FAILED`，原始 VfsError 的 code、stack、cause 链全丢，UI 只能拿到一句"工作区无法恢复：xxx"。这恰好是 `rollback-failure-degraded-fallback` 想要的"可降级"路径，但降级不应该意味着把诊断信息也降掉。

错误处理文化偏向「**快速失败 + 局部吞掉**」：热路径几乎都 rethrow（很好），但在 KV / 配置 / 启动修复这类"不致命"路径上大量出现 `catch { return null }` 和 `.catch(() => {})`。这本身不违法，可问题是其中**真正静默**的几处（`bootstrap` 里 `repairRefCounts().catch(() => {})` 一行连 log 都没有）就让复盘变得很困难——线上数据脏了之后，没人知道修复环节是不是真跑过。

下面进发现清单，按严重度排序。

## 角度 × 模块矩阵（事务 / 回滚路径表）

每段先给判定，再补一句为什么。详细的"涉及步骤"清单见下一节的完整路径表。

### provider —— 裸多步写（A）
`provider.service.ts` 里的 `create / edit / delete` 全部把 secretStore（sksp）写完再写 `llm_provider` 表，反过来 `delete` 时倒序清四张表，**全程没有事务**。最致命的是 secretStore 在 sksp 这套独立存储里，根本进不了同一个 SQLite 事务——这意味着即使想加事务也只能护住 DB 侧，secret 侧的孤儿 key 仍然无解。

### chat / message —— 编排路径里有裸多步（A）
单条 message 的 `append / delete / fork / copy` 全部走事务，写得很干净。但 `MessageTranscriptEffects.setMessageFloorAtMessage`（"置位 floor"）里串了 `hideRange → showRange → clearDomain(RULE_SNAPSHOT) → clearDomain(FILE_CACHE)` 四个独立写，**没有事务包裹**——中间崩了就会留下"消息已隐藏但 chip 缓存没清"的不一致状态，而这套缓存正是后续拼装 user_ops 附件时要读的。

### message-checkpoint / rollback —— 事务保护完整，错误链路有损（B/A）
`rollbackToMessage` 和 `capture` 都把全部步骤塞进单事务，配合 `runInTransactionOrConn` 在被外层事务包裹时复用 tx，事务边界画得很对。问题只在 catch 后的 rethrow：`formatDegradableMessage(cause)` 把 VfsError / SessionFsError 拍成字符串，原始 cause 没用 `Error.cause` 串起来，`SessionFsError` 构造函数本身也不收 `cause` 选项。诊断信息在这条热错误路径上断掉。

### vfs —— 单文件操作有事务，跨文件编排无（A 之外，B）
`RevisionAwareVfsService` 的 write/delete/resetHead/hardDelete/rename 都走 `runInTransactionOrConn`，每条都是原子。但 `runInTransactionOrConn` 的实现是"try transaction → catch NESTED_TRANSACTION → 复用外层 conn"——它依赖 TDBC 抛出特定错误码来判定嵌套，假设略强：万一未来某种 driver 在 transaction setup 阶段抛了别的错，这段会**在已经失败的环境上重跑一次 fn**。

### agent —— 多步编排完全无事务（A）
`agent-runner.ts` 的 run 循环里：`session.append('assistant') → checkpoint.capture → session.append('user', toolResults)` 三步各自独立提交。`run-agent-turn.ts` 里更明显：`messages.append('user') → messageCheckpoint.capture(...)` 两步无事务。一旦 capture 失败，user 消息已经落库但没有 baseline checkpoint——**这正是 `rollback-import-baseline-checkpoint` 和 `rollback-failure-degraded-fallback` 反复在打补丁的孤儿场景**。系统靠后续的 `backfillBaselineCheckpoints` 兜底，但 backfill 只在 ZIP/角色卡导入路径触发，普通聊天路径下产生的"无 checkpoint 的 user 消息"长期存在。

### workplace —— 完整事务（无发现）
`workplace.repository.ts` 的 rename 把 dir_rule + file_rule 两条 UPDATE 放进同一事务，注释明说"避免半套状态"，写得很到位。

### template —— 完整事务（无发现）
`template-pull.service.ts` 的 projectTemplatePull / sessionTemplatePull 都把 vfs 替换 + worktree 复制包进单事务，事后跑 `runDeferredBlobGc`。GC 失败只影响磁盘空间，不影响业务正确性。

### cloud-sync —— 不能用 DB 事务，乐观锁是对的（无发现，留意）
跨远端对象存储，没有 DB 事务可用。`conditionalPutStatus` 用 `If-Match` 实现乐观并发，`LOCK_CONTENTION` 被识别成"重试信号"而非真错误。这套设计是对的，不算 L4 缺陷，但 L5（并发）角度来扫时要重点看 lock release 的时序。

### bootstrap —— fire-and-forget 完全静默（B）
`novel-master-bootstrap.ts:112` 的 `repairRefCounts(...).catch(() => {})` 是注释明示的"不阻塞启动"，但 catch 体是**真空**，连 console.warn 都没有。如果 ref_count 修复失败，系统照常启动，revision GC 后续可能在脏 ref 上做错误删除。

### 错误类型体系 —— 业务/技术分得清，cause 链普遍缺失（B）
17 个 errors 模块把业务码（`SessionFsError`/`VfsError`/`ProviderError` 等）分得很细，type guard 也齐全，业务/技术错误的边界是清楚的。问题在 rethrow 时几乎没人传 `{ cause: error }`——`run-agent-turn.ts:154` 的 `new AgentTurnError(error.message)`、`message-rollback.service.ts:141` 的 `sessionFsRollbackVfsRestoreFailed(formatDegradableMessage(cause))`、`vfs-zip-io.service.ts:223` 的 `vfsZipError("IMPORT_FAILED", msg)`、`character-card-import.service.ts:160` 同款——一律把上层错误拍成字符串再重新包。结果是错误**类型信息**在每层都被剥一次，到 UI 只剩一句话。

### 事务/回滚完整路径表

| 操作 | 涉及步骤 | 有无事务 | rollback 覆盖度 |
|------|----------|---------|---------------|
| `message.rollbackToMessage` | reconcileVfsPaths（多个 vfs restore / delete）+ truncateTail（msg 删 + ck 删 + revision sweep + kkv clear） | 有（`conn.transaction`） | 完整，全 or 无 |
| `checkpoint.capture` | listSessionFileHeads（持锁）+ insertCheckpoint | 有 | 完整 |
| `message.delete` | delete msg + delete ck + sweepSessionRevisions | 有 | 完整；`runDeferredBlobGc` 在事务外，失败只漏 blob 空间 |
| `message.fork` / `session.copy` | sessions insert + copyVfsTree + 多条 msg insert + seedForkCopyParity | 有 | 完整 |
| `session.create` | session insert + initializeWorkspace + setSessionAgentConfig | 有 | 完整 |
| `session.delete` | msg deleteBySession + sessionFsData + kkv clear + deleteVfsPrefix + session delete | 有 | 完整；同上 blob GC 在外 |
| `project.delete` | session 循环清 + vfs prefix + project delete | 有 | 完整 |
| `project.copy` | project insert + agentConfig + copyVfsTree + seedLiveHeadRevisions | 有 | 完整 |
| `message-transcript-effects.truncateMessagesAfter` | truncateTail | 有 | 完整 |
| `message-transcript-effects.setMessageFloorAtMessage` | hideRange + showRange + clearDomain ×2 | **无** | **无**——中间崩留半套 |
| `vfs.write / delete / resetHead / hardDelete / rename` | entry + revision 写 + ref count 调整 | 有（`runInTransactionOrConn`） | 完整 |
| `vfs-batch-io.applyBatchIngest` | ensureDir + 批量 writeFile | 有 | 完整，整批回滚 |
| `vfs-batch-io.applyBatchIngestWithWriter` | writer.mkdir + writer.writeFile（session 注入） | **无**（per-call try/catch） | 部分失败保留已写——session writer 设计使然 |
| `vfs-zip-io.import` / `character-card-import.import` | deletePrefix + ensureDir + 批量 insert + backfillBaseline | 有 | 完整；catch 后包成 IMPORT_FAILED |
| `template.projectTemplatePull` | replaceVfsSubtree + worktree.copyScope | 有 | 完整 |
| `provider.create` | secretStore.set + providers.insert | **无** | **无**——insert 失败留孤儿 secret |
| `provider.edit` | secretStore.set/delete + providers.update | **无** | **无**——更新失败留新旧两套 secret |
| `provider.delete` | suggestions.deleteByProvider + savedModels.deleteByProvider + providers.delete + secretStore.delete | **无** | **无**——任意一步失败留孤儿 |
| `agent-runner.run` 循环 | append assistant + checkpoint.capture + append user(toolResults) | **无** | **无**——见 A4 |
| `run-agent-turn` 入口 | messages.append('user') + checkpoint.capture | **无** | **无**——见 A5 |
| `user-vfs-turn.executeOp` | toolRunner.runParallel + sweep + logAppend | **无**（intentional） | 部分失败保留盘写、丢日志（注释 D1 明示） |
| `workplace.renamePrefix` | dir_rule UPDATE + file_rule UPDATE | 有 | 完整 |
| `restoreProviderTableSnapshot` | scrub + 按 FK 顺序 insert | 有 | 完整 |
| `bootstrap entryId migration` | migration 自带事务 | 有 | 完整 |
| `bootstrap repairRefCounts`（异步安全网） | 异步触发，`.catch(() => {})` | **无** | **无**——失败完全静默 |
| `cloud-sync put / lock` | 远端对象存储 put + 条件 status put | N/A（无 DB 事务可用） | 用 `If-Match` 乐观锁替代，合理 |

## 发现清单

### A `provider.delete` 跨四步写完全无事务，且 secretStore 不可回滚

- 位置：`packages/core/src/service/provider/impl/provider.service.ts:138-154`
- 问题：依次执行 `suggestions.deleteByProvider(id)` → `savedModels.deleteByProvider(id)` → `providers.delete(id)` → `secretStore.delete(ref)`。任意一步失败，前面的写都不会回滚。最严重的场景是 step 3 失败：suggestions 和 saved_models 已清，但 provider 行还在，secret 还在 sksp——重新打开页面会看到一个"已经残废"的 provider（没有任何 model 可选），而且没有 UI 路径能再次触发清理。
- 依据：对比同仓库 `project.delete` / `session.delete` 的写法，它们都把多表删放进 `conn.transaction`。provider 服务没有任何 transaction 调用，全文件 grep 不到。`Iterations/provider-identity` 和 `saved-model-identity` 都在重塑 provider 身份认证，但没碰这块删除路径。
- 建议：把 DB 侧的三步（suggestions / savedModels / providers）包进一个事务；secretStore 这一步因为是 sksp 外部存储无法纳入同一事务，改成"DB 事务提交后再删 secret，删除失败时 console.warn 并把孤儿 key id 记到一个待清理队列，启动时扫一次"。彻底的解法需要 secret store 提供 best-effort 的"按 providerId 前缀清"接口。
- 涉及角度：L4 主；L8（API 稳定性 & 安全，secret 残留是安全问题）

### A `provider.create` / `provider.edit` 同样无事务，secret 与 provider 行可能错位

- 位置：`packages/core/src/service/provider/impl/provider.service.ts:73-136`
- 问题：`create` 是 `secretStore.set(secretRef, apiKey)` → `providers.insert(provider)`。insert 失败留下孤儿 secret；反过来如果先 insert 再 set，secret 失败留下"有 provider 但没 key"的残疾配置。`edit` 在轮换 apiKey 时更危险：旧 key 删了、新 key 还没写进去的中间窗口如果失败，provider 直接不可用。
- 依据：同上，没有 transaction 包裹。`secretRef` 由 `providerApiKeyRef(id)` 派生，孤儿 secret 在 sksp 里只能靠全表扫描发现。
- 建议：和上一条一起整改——DB 事务内写 provider，事务提交后再做 secret 写入/删除；secret 失败要可重试且不阻塞 provider 数据已落库的事实。文档层面要在 `Iterations/sksp*` 里明确 secret store 与 DB 不在同一原子单元。
- 涉及角度：L4 主；L8（密钥存储边界）

### A `MessageTranscriptEffects.setMessageFloorAtMessage` 四步写无事务

- 位置：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:78-130`
- 问题：执行顺序是 `messages.hideRange → messages.showRange → sessionKkv.clearDomain(RULE_SNAPSHOT) → sessionKkv.clearDomain(FILE_CACHE)`。如果第三个 clearDomain 抛错，消息已经隐藏/显示了，但 `RULE_SNAPSHOT` 还在；下一次拼装 user_ops 附件时会读到旧的 rule snapshot，置位 floor 的语义就破了。`file_cache` 没清掉同样会让前文短提示规则误判（这个项目里 file_cache 与可见历史的同步关系本身就是 AGENTS.md 里反复强调的容易出错点）。
- 依据：方法注释明示"置位成功：仅清 rule_snapshot + file_cache"，"成功"二字暗示这几步应当原子。同一个 service 里 `truncateMessagesAfter` 用了 `conn.transaction`，说明这里有事务可用，只是没用。`Iterations/agent-resilience-mobile-yaml` 涉及置位 floor 的稳定性，但没修这条。
- 建议：把 hideRange / showRange 改成事务版（仓储层加 `updateHiddenRangeInTx`），clearDomain 用绑定 tx 的 SessionKkvRepository，四步放进单事务。`SessionKkvRepository` 已经存在 tx 构造路径（`truncate-tail-wiring.ts` 里就在用），改造成本不高。
- 涉及角度：L4 主；L1（数据模型，看 kkv 域与消息可见性的原子性约定）；L5（如果有并发 floor 设置）

### A `agent-runner` 循环里 assistant append + checkpoint capture + toolResults append 无事务

- 位置：`packages/core/src/service/agent/impl/agent-runner.ts:329-488`
- 问题：每轮 LLM 回合里，`session.append('assistant', ...)` 单独提交，然后 `messageCheckpoint.capture(...)` 单独提交，再 `session.append('user', toolResults)` 单独提交。三个写各有自己的失败窗口：
  - assistant 写成功后、capture 之前崩溃 → 助手消息落库但无 baseline checkpoint，后续基于 vfs 变更的回滚找不到锚点；
  - capture 成功、toolResults append 失败 → checkpoint 指向的 assistant 没有跟随的 tool_results，下一轮 LLM 拿到的历史不完整。
  - 当前 capture 失败的 catch（line 462-471）是 `console.error` 后**直接 rethrow**，意味着 assistant 消息已经落库，run 终止，UI 看到一条孤儿 assistant。
- 依据：`Iterations/message-rollback-execution-redesign` 和 `Iterations/message-checkpoint-v2` 都在围绕"checkpoint 与消息的原子性"打转；这条没改干净的痕迹明显。`runInTransactionOrConn` 的 NESTED_TRANSACTION 处理方式本可用，但 agent-runner 完全没用事务。
- 建议：把单轮的 append(assistant) + capture + append(toolResults) 包进一个事务。capture 已经支持 tx 内调用（看 `message-checkpoint.service.ts:34`），只需把这一段串起来。如果担心长事务影响流式体验，至少把 capture 紧贴 assistant append 放进同一事务，让"有 assistant 就一定有 checkpoint"成为不变式。
- 涉及角度：L4 主；L1（checkpoint 数据模型）；L5（流式与事务的张力）

### A `run-agent-turn` 入口：append user 与 capture baseline 无事务

- 位置：`packages/core/src/service/agent/logic/run-agent-turn.ts:283-307`
- 问题：当 `userOpsAttachments.length > 0` 时，先 `messages.append('user', ...)`，紧接着 `messageCheckpoint.capture(...)`。两步无事务。capture 失败时，user 消息已经在历史里，但没有 baseline checkpoint——后续如果用户在这条消息上做 `undo_send`，rollback 走 `resolvePriorRollbackTargetTree` 拿不到前序树，会回退到**空树**，等于把工作区文件全删。这是 `Iterations/rollback-import-baseline-checkpoint` 在导入路径上修过的同一个 bug，只是普通聊天路径还没修。
- 依据：`message-rollback.service.ts:189-209` 的 undo_send 分支注释明确说"prior 为空时回退到 anchor 自身的 checkpoint"，但如果 anchor 自身也没有 baseline（就是这里描述的失败场景），fallback 链断掉。`Iterations/rollback-failure-degraded-fallback` 提供的降级是"VFS restore 失败时仅截断消息"，但这解决的是 restore 阶段，不解决 capture 阶段。
- 建议：与上一条一并改——把 append(user) + capture 放进同一事务，至少在 `userOpsAttachments.length > 0` 这条关键路径上。或者退一步：所有 user append 都立即在事务里补 baseline checkpoint（不需要等 user_ops），让"每条 user 消息都有 checkpoint"成为硬性不变式。
- 涉及角度：L4 主；L1（checkpoint 模型）

### B `message-rollback` 的 rethrow 把 cause 拍成字符串，原始错误链丢失

- 位置：`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:76-86, 140-145`
- 问题：`formatDegradableMessage(cause)` 把任意错误压缩成 `工作区无法恢复：${detail}`，然后用 `sessionFsRollbackVfsRestoreFailed(message, ...)` 包成 `ROLLBACK_VFS_RESTORE_FAILED`。`SessionFsError` 的构造函数不收 `cause` 选项（`session-fs-errors.ts:27-46`），就算想传也传不进去。最终拿到的错误对象里既没有原始 VfsError 的 code（NOT_FOUND？CONFLICT？），也没有 stack trace。
- 依据：这是 `Iterations/rollback-failure-degraded-fallback` 设计的"可降级"路径，意图是让 UI 能识别"VFS restore 失败 → 提供仅截断的降级"。降级判断走 `isRollbackVfsDegradableError`，确实只需要 code 就够——但**诊断**和**事后复盘**需要 cause 链。同时 `isSessionFsError` 实现里有 `unwrapCause`（line 49-58）暗示设计者知道 cause 链有用，但写入端没用。
- 建议：`SessionFsError` 构造函数加 `cause?: unknown` 选项（透传给 `super(message, { cause })`），`sessionFsRollbackVfsRestoreFailed` 增加 cause 参数；rollback service 把原始 cause 传进去而不是只传 message。type guard 不动，向后兼容。
- 涉及角度：L4 主；L7（可测性，错误断言更精确）

### B `runInTransactionOrConn` 依赖特定错误码做嵌套判定，鲁棒性偏弱

- 位置：`packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:292-305`
- 问题：实现是 `try { conn.transaction(fn) } catch (error) { if (NESTED_TRANSACTION) return fn(conn); throw error; }`。这里假设 `conn.transaction(fn)` 抛 NESTED_TRANSACTION 一定是因为外层已有事务，并且**原 conn 仍然可用**。如果某种 driver 实现在 transaction setup 中段失败（连接异常、schema 锁超时等）也抛 NESTED_TRANSACTION，这段会在已经不健康的连接上重跑 fn，错误信息会更混乱。即便不混入其它错误码，"已经抛过一次错"的连接拿来直接跑业务 fn 也违反最小惊讶原则。
- 依据：`connection.port.ts:40-42` 把"嵌套抛 NESTED_TRANSACTION"作为契约写死，契约层面是对的；问题在 vfs 这层用 try/catch 探测嵌套，而不是用显式的"是否在事务中"API（`inTransaction()` 之类）。`Iterations/chat-rollback-vfs-tool-fixes` 修过相关边界，但没动这套 try/catch 探测。
- 建议：TDBC 加一个 `isInTransaction(): boolean`（或允许 `transaction(fn, { reuseIfNested: true })`），让 vfs 不必靠捕获错误来探明状态。短期不改也行，但要在注释里写清"假设 NESTED_TRANSACTION 仅在外层有事务时出现"。
- 涉及角度：L4 主；L3（架构，TDBC 契约设计）

### B `bootstrap` 的 `repairRefCounts(...).catch(() => {})` 完全静默

- 位置：`packages/core/src/bootstrap/novel-master-bootstrap.ts:107-113`
- 问题：注释明示"不阻塞启动，丢 rejection 也不崩"——意图合理。但 catch 体**完全空**，连 `console.warn` 都没有。entry-id migration 之后 ref_count 是脏的概率不低（这正是 migration 后需要"安全网"的原因），安全网本身再静默失败，后续的 `sweepSessionRevisions` 可能在脏 ref 上做错误删除，且无任何日志可追。
- 依据：对比同文件 line 86 的 `conn.transaction(async (tx) => { ... })` 是认真跑的 migration，注释和实现一致；line 112 一行的 catch 把前面所有的认真抹平了。
- 建议：catch 里至少 `console.warn("[bootstrap] repairRefCounts failed", error)`。更进一步可以写入一个 kkv flag，下次启动时如果发现这个 flag 还在，再跑一次修复。
- 涉及角度：L4 主；L7（可观测性）

### B 多处 rethrow 用 `new XxxError(error.message)` 丢 cause 链

- 位置：
  - `packages/core/src/service/agent/logic/run-agent-turn.ts:149-158`（`mapResolveError`）
  - `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:214-224`
  - `packages/core/src/service/vfs/impl/character-card-import.service.ts:151-161`
  - `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:303-313`
- 问题：四处 catch 后都把原始 error 的 message 提出来，重新包成新的领域错误，但不传 `cause`。导入失败时用户看到的最终错误是 `vfsZipError("IMPORT_FAILED", "test import failure")`，原始堆栈和类型都没了。
- 依据：现代 JS 的 `Error` 构造函数支持 `{ cause }` 选项，`isSessionFsError` 自身就有 `unwrapCause` 工具，说明这套系统知道怎么用 cause 链——只是写的时候没传。
- 建议：每个领域 Error 类的构造函数加 `options?: { cause?: unknown }` 并透传 `super(message, { cause })`；四处 rethrow 都改成传 cause。`vfs-batch-io` 的失败报告 `failed[].message` 字段保留字符串（给 UI 用），但底层 throw 的对象要带 cause。
- 涉及角度：L4 主

### B `user-vfs-turn.executeOp` 故意不回滚已成功写盘——文档化的 trade-off，但缺告警通道

- 位置：`packages/core/src/service/chat/impl/user-vfs-turn.service.ts:159-172`
- 问题：注释 D1 明示"日志失败不回滚盘（D1）"，意图明确：磁盘写是主结果，user_ops 日志是审计副本，宁可丢日志也要保留盘写。这条决定本身合理。问题在于 `logAppendError` 被吞进返回值的 `logAppendError` 字段，需要上层主动检查；上层（agent-runner）并没有显式处理这个字段（grep 没有引用）。结果就是用户改了文件，但下次拼装附件时不会带上这次操作——**用户视角的"我刚才明明改了"**，但 agent 看不到。
- 依据：注释 D1 自己也承认这是 trade-off，但下游消费方没把它当回事。
- 建议：保留不回滚盘的决定，但 `logAppendError` 要有显式的 UI 提示通道（toast 或 eventBus 发一条 user_op_log_failed 事件）。或者在 agent-runner 调用处把 `logAppendError` 转成一条 `bus.publish` 的事件。
- 涉及角度：L4 主；L6（跨端，三端都要保证一致的告警）

### B agent 中止（abort）后仍把部分 assistant 内容写库

- 位置：`packages/core/src/service/agent/impl/agent-runner.ts:331-348`
- 问题：检测到 `signal.aborted` 后，如果 `result.blocks` 非空且 `hasMeaningfulAssistantBlocks` 为真，仍然 `session.append('assistant', ...)`。意图大概是保留用户已经看到的流式输出。但 abort 的语义在很多场景下是"我不想要这次结果了"——保留半截 assistant 在历史里会污染下一轮 LLM 上下文。
- 依据：同文件 line 474-477 又有一处 abort 检查（tool results 之前），那里直接 break 不写库，两处语义不一致。
- 建议：要么统一成"abort 后不写"（与下面那处对齐），要么显式把 abort 写入的 assistant 标 `hidden: true`，让 LLM 上下文拼装时跳过但用户回放仍能看到。
- 涉及角度：L4 主；L5（并发与取消）

### C `model-retry-policy.service` 解析失败静默返回 null

- 位置：`packages/core/src/service/provider/impl/model-retry-policy.service.ts:67-72`
- 问题：`parsePolicyJson` 失败时 catch 直接 `return null`，注释说"Treat invalid stored values as unset to avoid bricking requests"。意图合理（不让坏配置阻塞请求），但完全没有日志——用户存了一个被手改坏的 policy，系统悄悄退化到默认，用户不会知道。
- 依据：同仓 `compaction-conditions-store.service.ts:84-109` 处理类似情况时是抛 `compactionConditionsInvalidSchema`，更明确。
- 建议：catch 里 `console.warn("[model-retry-policy] invalid stored policy, falling back to default", error)`。或者抛错由调用方决定。
- 涉及角度：L4

### C `model-retry-policy.setPolicy` / `clearPolicy` 中 catch NOT_FOUND 后直接返回——合理但与其他错误码处理风格不一致

- 位置：`packages/core/src/service/provider/impl/model-retry-policy.service.ts:82-90`
- 问题：纯风格问题，不算 bug。`getPolicy` 里也是同样模式。仓库里其它地方处理 NOT_FOUND 时有的抛、有的返 null、有的返 undefined——三选一不统一。
- 依据：`getRaw` 返回 `string | undefined`，`getPolicy` 返回 `ModelRetryPolicy | null`，`clearPolicy` 直接 return void。读者要在三个函数之间切换心智模型。
- 建议：统一成一种风格（推荐 undefined for "absent"），或者在每个函数 JSDoc 里写清"NOT_FOUND 时返回什么"。
- 涉及角度：L4

## 覆盖声明

查了的：`packages/core/src` 下全部带持久化或多步副作用的 service / domain / bootstrap 模块——具体见元信息范围列。完整 grep 了 `catch` / `transaction` / `rollback` 三个关键词，逐一打开看了 86 处 catch 和 18 处 transaction。所有"多 repo 写"的方法（`message.*`、`session.*`、`project.*`、`vfs.*`、`provider.*`、`template.*`、`checkpoint.*`、`rollback.*`）都通读了实现。错误类型体系（`errors/` 17 个文件）抽样读了 `session-fs-errors`、`vfs-errors`、`provider-errors`、`character-card-errors`、`kkv-errors`、`chat-errors`。

没查的：
- mobile / desktop / cli 三端如何**消费** core 抛出的错误（属 L6 / L7 角度）；
- `tool-runner` 内部各 builtin tool 的错误处理（属工具层，跨度太大，留 L8 / tool-system-v2 切片）；
- `infra/llm-protocol` 各 adapter 的 catch（`anthropic.adapter.ts:192` 等）只扫了一眼，没深读，因为 SSE 流式错误边界主要归 L5；
- `infra/cloud-sync` 的并发与 lock 时序留给 L5；
- 测试侧验证了哪些错误路径（属 L7）。

为什么没查：本次任务一句话职责是"core 错误处理 + 事务边界"，跨端消费和工具内错误处理超出 L4 单角度能覆盖的合理边界，硬要扫会变成 L6/L7/L8 的大杂烩，反而稀释发现。

## 待交叉的线索

给 phase3 的提示——以下几条很可能跟别的角度打架或者需要对方补刀：

- **provider 服务无事务** vs **L8（API 稳定性 & 安全）**：L8 可能为 secret store 的接口边界辩护（"secret store 不应纳入 DB 事务"），但 DB 侧的三步删除没有事务是 L4 单方面可以定性的缺陷。需要 L8 确认 secret 残留的安全影响分级。
- **agent-runner 无事务 + abort 写库** vs **L5（并发 & 异步）**：L5 可能说"abort 是用户取消，不是崩溃，不需要事务"。L4 的立场是——不区分取消和崩溃的话，部分失败状态照样产生。这条要交叉讨论。
- **`setMessageFloorAtMessage` 无事务** vs **L1（数据模型）**：L1 可能辩称"kkv 域和消息可见性在 schema 层面是独立的，不需要原子"。L4 的立场是——置位 floor 这一个**操作**把两者耦合在一起改，操作层面就应该原子，schema 解耦不代表业务操作可以拆。这条建议 phase3 拉到一起聊。
- **rollback 错误链丢失** vs **L7（测试）**：L7 可能说"测试只断言 code 不断 cause"。L4 的立场是——可观测性不仅是测试，线上排查更要 cause 链。如果 L7 反对扩 Error 构造函数签名（破坏 fixture），需要权衡。
- **bootstrap 静默 catch** vs **L7**：L7 可能也想看这个失败能否被测试覆盖。当前空 catch 让测试根本无法断言"修复失败时是否有告警"。
- **`runInTransactionOrConn` 的 NESTED_TRANSACTION 探测** vs **L3（架构）**：这条本质是 TDBC 契约设计问题，L3 角度来扫时建议把"是否在事务中"提升为 first-class API。
