---
cluster: core-data
sources:
  - w1-core-chat
  - w2-core-checkpoint
  - w2-core-small
  - w2-core-service-chat
  - w4-msgstore-pro
  - w4-msgstore-adv
  - w4-rollback-pro
  - w4-rollback-adv
counts:
  raw_findings: 137
  merged: 62
  P0: 0
  P1: 1
  P2: 21        # 🔁 R2-17（judge-r1 F4）：CD-20 降 P3，22 → 21
  P3: 40        # 🔁 R2-17：CD-20 降 P3 计入（38 → 40，含本轮从 P2 移入的 1 条）；CD-34 已核销仍在表内留痕
  multi_source: 27
  adversarial_rulings: 17
  disputes: 7
---

# W5 归并 · core-data 簇（消息数据面 / 检查点锚点 / 消息面应用服务 / 存储迁移）

> 输入 8 份（4 份测绘 + 2 组对抗对），原始条目 137 条 → 合并去重后 **62 条**。
> 合并规则：同一病灶多源报告合为一条并标「多源印证」+ 来源清单；对抗对逐条对照裁定；
> 严重度按合并后信息双向校准（升或降均写理由）；无法裁决的进「争议上交」。

---

## 架构小结（core-data）

**模块地图（4 层）**

| 层 | 模块 | 拥有 | 不拥有 |
|---|---|---|---|
| L1 模型/契约 | `domain/chat/model`、`domain/chat/content` | 消息/附件/会话/项目类型、zod wire、blocks 严格解析、纯文本抽取、关键词匹配 | 任何 IO |
| L2 存储 port | `domain/chat/repositories`、`domain/message-checkpoint/{model,repositories}` | 18+13 方法 port、SQLite 实现、正文编解码收口、`chat_message`/`message_checkpoint{,_file}` 持久化 | 业务语义、区间计算 |
| L3 纯函数 | `domain/chat/logic`、`domain/message-checkpoint/logic`、`domain/depth`、`domain/compaction-conditions`、`domain/session-kkv`、`domain/smart-sort-rule` | 提示词拼装、附件扫描、批注定位、区间/批处理、回滚锚点解析、reconcile 路径集、restore/revive/backfill、revision GC、压缩条件触发器 | 事务边界、连接获取 |
| L4 应用服务 | `service/chat/*`、`service/message-checkpoint/*` | 事务边界、缓存失效口径、fork/copy parity、usage 聚合、回滚编排与乐观锁、checkpoint capture/backfill/release | 正文编解码、回滚目标树解析 |

**边界纪律（实测成立）**
- 正文编解码唯一收口在 `sqlite-message.repository.ts`（`toMessageParams`/`readRowContent`），唯一例外是 usage-stats 的第二份双形态读（CD-09）。
- `chat_message` 写口仅 `sqlite-message.repository.ts` + 两个后台搬运任务（只换字节形态，正文不变，无缓存失效需求）。
- `message_checkpoint` 域**只读** `vfs_entry`，唯一跨域写入是 `backfill-missing-revision.ts` 往 `vfs_revision` 插占位行。
- 层向倒挂两处：`backfill-baseline-checkpoints.ts` 引 `service/integrity-repair` 类型、`compaction-conditions` 引 `service/session-kkv` port（均 type-only）。
- 唯一运行期真耦合环：service → domain/tool → service，靠 type-only import 断开。

**关键不变量（被本次 findings 反复触碰）**
1. 驱动事务持锁期间**只有 tx 面能查**，走外层 `conn` 会重入 AsyncMutex 死锁 → 事务内必须 `new Sqlite*Repository(tx)`。
2. 事务内不得 VACUUM；维护链路（GC → wal_checkpoint → VACUUM）收敛在 `infra/db-maintenance/`，且**事务外**直调。
3. 解压缓存池是**进程级**单例，唯一清空点是 `bootstrapNovelMaster` 入口（无代码强制，CD-37）。
4. 任何删消息的事务侧必清 `backfill_cursor`（seq 复用防线），当前靠 4 处人工纪律维持。
5. `listBySessionOffset` 的 offset 是**行偏移不是 seq 值**；`listBySession` 恒含 hidden，`includeHidden:false` 必须显式传。

**核心数据流**
- **写入**：`append` → `nextSeq`(MAX+1) → `encodeMessageContent` → `content_json=''` + encoding/blob 两列 → `assertMessageContent` 归一 blocks。
- **读取**：`readRowContent` → blob 非空则 `decodeMessageContent`（写进程 LRU）/ 否则 parse 明文 → `mapRows` 分片（mobile 注入 `yieldFn`）→ 21 列 `ChatMessage`。
- **检查点**：agent 工具落地后 `capture`（工作区整树指针快照）→ 回滚时 `resolveRollbackAnchorMessage` 前向配对 tool_result → `resolveRollbackTargetTree`（undo_send 走 prior-only / rewind 走 anchor 自身）→ `resolveReconcilePathSets` 算 `pathsNeedWrite/Delete` → 事务内 `reconcileVfsPaths` 重新扫 live heads + `resetHeadToVersion` + 删尾 + checkpoint ref_count 递减 → 提交后失效 `prompt_tokens`/`toolUseCount`，deferred 全局孤儿 GC。
- **压缩触发**：`agent-runner` 每回合 → `shouldRequestCompaction`（OR：token-ratio / visible-floor）→ `runCompaction` → `hide-message.action` 按 depth 区间 `updateHiddenRange` → 失效 prompt token（**不再清** file_cache）。
- **置位/删除**：`message-transcript-effects` CoordinatedWrite → 区间 hide/show + 清 `rule_snapshot`/`file_cache` + 清 backfill 游标。
- **存储迁移**（退役倒计时）：`runStartupMaintenanceOnce` → `runMessageContentCompaction`（谓词 `content_json!=''`）→ `runBlobBinaryNormalization`（三表 BLOB 化）→ 各自置 KKV 完成标记 → 挂一次 `runDatabaseMaintenance` 维护链路。

**本簇最重病灶（供全局架构图标注）**
- **CD-01（P1）**：回滚 plan 在事务外解析、乐观锁只比消息计数，**文件状态变更完全不被检测** → 静默丢文件 / 无主残留。三个独立机制（乐观锁盲区、pathsNeedDelete 计划外、plan/事务两份 live 状态来源）共用同一根因。
- **CD-02（P2）**：tail 截断与删除存在**两条平行实现**，失效/清扫/游标集合分叉，且 id 列表在事务外取（TOCTOU）。
- **CD-04（P2）**：backfill 每轮发送持写事务做 O(N) 单行读，且「回滚清游标」正反馈制造下轮最坏输入。
- **CD-07（P2）**：`file_cache` 置位/导入清引用行不回收 blob，长期用户 blob 表单调增长。

---

## 台账

### P1

| ID | 级别 | 病症 | 位置 | 多源? | 对抗裁决? | 一句话修法 |
|---|---|---|---|---|---|---|
| CD-01 | P1 | **回滚 plan 快照与事务内状态不同源**：乐观锁只比 `COUNT(*)`，覆盖不了「agent 改了文件但消息数未变」；`pathsNeedDelete` 在事务外算完却拿事务内重扫的 tailIds 删 checkpoint；plan 与 `restore-path` 拿两份不同来源的 live 状态做「是否写盘」判定。后果：静默丢用户文件 / 无主残留文件 | `service/message-checkpoint/impl/message-rollback.service.ts:144-264,203-216,399,562-565`；`logic/resolve-reconcile-paths.ts:42,90-93`；`logic/restore-path.ts:145-149` | ✅ 多源印证（4 源）rp-01/02/04 + adv-3 | **upheld**（pro）；adv-3 亲口认输 count 弱代理 P2；adv-5 成功辩护 `hasDirectTargetTree` 的**可读性**一面 → 该支降为 P3 并入 CD-01 说明，**不另立**。保 P1：三条独立机制同根因、后果为静默数据丢失、adv 未对「文件状态维度」作任何辩护 | `resolveReconcilePathSets` 整体移进事务；乐观锁快照升为 `count + MAX(seq) + MAX(created_at_ms)` 三元组；事务内断言 tailIds == plan.tailMessageIds，不等即走 ROLLBACK_CONFLICT |

### P2（21 条）

<!-- 🔁 R2-17（judge-r1 F4）：CD-20 已由本段移入 P3 段并降级，故本段由 22 条变 21 条。 -->

| ID | 级别 | 病症 | 位置 | 多源? | 对抗裁决? | 一句话修法 |
|---|---|---|---|---|---|---|
| CD-02 | P2 | **tail 截断/删除的清理与失效集合分叉 + 事务边界 TOCTOU**：`truncateMessagesAfter` 走 `truncateTailInTransaction`，`MessageService.truncateAfter` 走自实现（只清游标、不清 composer 域、truncateAfter 完全不 sweep revisions）；两处 id 列表都在事务外取，间隙内新 append 的消息被删但其 checkpoint 不在 ids → 孤儿 checkpoint 且 sweep 救不回 | `service/chat/impl/message-transcript-effects.service.ts:63-77`；`message.service.ts:433-489` | ✅ 多源印证（3 源）w2-01 / w2-09 / w2-19 | upheld（无正反，机位间交叉） | **校准 P1→P2**：两机位独立 grep 均确认 desktop renderer 无 `truncateAfter` 调用点（已注册未接线），当前无线上触发；一旦 UI 接线即升 P0/P1 | `truncateAfter` 直接转调 `truncateTailInTransaction`；id 列表改到事务内 tx 仓储取；统一补 revision sweep |
| CD-03 | P2 | 删除链（删一条消息/删会话/删项目 BFS）**内联全表 `deleteGlobalOrphans()`**，删一条消息就走一次全表 DELETE；回滚链已拆两段，删除链没跟上 | `service/chat/impl/message.service.ts:254-261`；`domain/message-checkpoint/logic/revision-gc.ts:75-82` | ❌ 单源 w2-07 | upheld（adv D14 只辩护了**回滚链**已遵守 `deferGlobalOrphanGc` 契约，删除链不在其辩护范围） | 删除链同样拆两段：事务内只做 scoped，提交后 `scheduleDeferredRevisionOrphanGc(conn)` |
| CD-04 | P2 | **backfill 倒扫 `hasCheckpoint` N+1**：找「最后一个有 checkpoint 的消息」逐条单行读；且全程包在写事务里持驱动 mutex；游标被回滚/删除清掉后必然走全量 → 「回滚制造下轮最坏输入」的正反馈 | `logic/backfill-baseline-checkpoints.ts:165-177,253-266` | ✅ 多源印证（3 源）ckpt-1 / rp-08 / adv-6 | upheld（三源同向；adv-6 认输并补强「全程持写锁」论据） | 改 `findCheckpointMessageIdAtOrBefore(sessionId, 末尾 seq)` 单查或全量 message_id 集合内存比对 |
| CD-05 | P2 | **checkpoint 仓储三处 `IN (…)` 无上限无分块**（`countCheckpointsForMessages`/`listFilePointersForMessages`/`deleteCheckpointsForMessages`），入参是 tail 全量；同文件 `:40` 自己定义了 900 变量上限常量且 `seedCheckpoints` 已分块 | `sqlite-message-checkpoint.repository.ts:126-130,382-384,401-431` | ✅ 多源印证（2 源）ckpt-3 / adv-1 | upheld（代码事实 confirmed；**触发前提存在冲突 → 见争议 D-1**） | 三处统一按 500/900 分块，抽 `chunkMessageIdBindings()` |
| CD-06 | P2 | **三处循环体内单条 `findByPath`**（resolve-reconcile-paths / detect-missing-revisions / rollback:516）；`detect-missing-revisions` 无短路每条都查；**命中率与开销反相关**（被删文件多 → liveHeads 少 → 命中低 → 循环全 miss 全串行） | `resolve-reconcile-paths.ts:57-63`；`detect-missing-revisions.ts:43`；`message-rollback.service.ts:516` | ✅ 多源印证（2 源）ckpt-7 / adv-7 | upheld（adv-7 亲口认输 P2 并给出三处清单） | **校准 P3→P2**（adv 论据更全：三处而非一处 + 命中率反相关 + 不在 rollback-large-jank 任何 Step 覆盖范围内） | 仿 `findContentHashesByPaths` 补批量 `findEntryIdsByPaths`，三处统一消费 |
| CD-07 | P2 | **`file_cache` 孤儿 blob 无回收调度**：`clearDomain(file_cache)` 的 4 个高频调用方（置位/压缩/导入对齐/改规则）全都不调度 `runDeferredFileCacheGc`；回收只有删会话/删项目/手动维护 3 个挂点 → 不删会话的长期用户 blob 表单调增长 | `domain/session-kkv/logic/deferred-file-cache-gc.ts:29-36`；`sqlite-session-kkv.repository.ts:326-342` | ✅ 多源印证（2 源）small-6 / w2-17 | upheld | **校准 P3→P2**（small-6 论证更全：4 个高频 clearDomain 调用方 + 单调增长 + 与 feature A 去重化收益对冲） | 置位/导入成功提交后 `await runDeferredFileCacheGc(conn)`，并加「距上次 ≥N 秒 / 删除行数 ≥M」节流 |
| CD-08 | P2 | **`nextSeq`(MAX+1) 与 `insert` 两条独立 await、中间无事务无串行化**，撞 `UNIQUE(session_id, seq)` 抛未类型化驱动错误 | `service/chat/impl/message.service.ts:193,210`；`sqlite-message.repository.ts:360-369`；`chat-schema.ts:56` | ✅ 多源印证（3 源）chat-3 / msgstore-pro-2 / msgstore-adv-13 | **upheld**（adv 亲口认输 P2：逐条证伪「驱动 AsyncMutex 串行化」（实测 mutex.ts:16-23 为**单语句**排队）/「上层会话锁」（唯一调用点无锁）/「app 层守卫」（isAgentActive 是只读查询）） | `append` 把 `nextSeq + insert` 包进同一 `conn.transaction`；或 insert 撞 UNIQUE 时重取 seq 重试一次 |
| CD-09 | P2 | **usage-stats 复制了一份双形态解码分支**（`content_blob != null` 判据在两个文件各写一遍），RULE 的「读路径双形态」硬纪律因此有两个可独立漂移的实现点；且失败语义反向（repo fail-fast vs 这里 catch 吞成 +0） | `service/chat/impl/usage-stats.service.ts:512-539` vs `sqlite-message.repository.ts:82-94` | ✅ 多源印证（2 源）pro-4 / adv-14 | **upheld**（adv-14 认输：「性能取舍可辩、分支复制不可辩」；性能取舍部分采纳为背景） | 抽 `decodeRowContent({encoding,blob}, id, plainText)` 到 codec 层，两处共用；失败语义差异用调用方 try/catch 表达 |
| CD-10 | P2 | **`searchMessages` 全量精筛污染进程级 LRU**：整段行 `decodeMessageContent` → 全部写进 4M 字符 LRU，「一条都搜不到」时等于把整会话 assistant 正文逐条 inflate；一次只读操作冲掉别的读口的全部热态，症状与病因隔得很远。RULE 只拍板「不用 LIKE 粗筛」这个**决策**，未背书此实现形态 | `sqlite-message.repository.ts:537-590`；`message-content-codec.ts:92`；`decoded-content-cache.ts:186-199` | ✅ 多源印证（2 源）pro-3 / adv-7 | **upheld**（adv-7 只辩护了「去掉 LIKE 是必然 / 召回严格更好 / 分段封顶」三点，**未触及 LRU 污染与总量无上界**；原「全量精筛」决策本身仍按 intentional 处理，不入本条） | 精筛段改窄投影（去 `raw_json`）+ 给搜索一条不经 LRU 的解码路径 + 加「已扫描行数」硬上限并标记截断 |
| CD-11 | P2 | `project.copy` 搬了 VFS 模板域/meta 域/技能负清单，**唯独没搬 `workplace_dir_rule`/`workplace_file_rule`**；而 `initializeSessionWorkspace` 会把 project scope 规则播种进新会话 → 复制出的项目新建会话后目录规则全部退回 rule_off | `service/chat/impl/project.service.ts:242-299` | ❌ 单源 w2-05 | — | `SqliteWorkplaceRepository.copyScope(project:原 → project:新)`，与 `copyScopeRules` 并列 |
| CD-12 | P2 | 删会话/删项目链覆盖 messages/fs/kkv/run_state/vfs/skills，**唯独没删 session scope 的 workplace 规则行**（仓储有现成 `deleteScope` 但唯一调用点在 `copyScope` 内部） | `session.service.ts:207-232`；`project.service.ts:149-197` | ❌ 单源 w2-06 | — | `deleteSessionTree` 内补 `deleteScope(session:{pid}:{sid})`；project 删补 `project:{id}` 与 `:meta` |
| CD-13 | P2 | `fork` 全量 `listBySession`（含整条尾巴）连正文解压回来再 `filter(seq<=upTo)`；仓储**缺「seq ≤ N」上界读口**（能力缺口非调用写错） | `service/chat/impl/message.service.ts:293-303` | ❌ 单源 w2-03 | — | 补 `listBySessionUpToSeq(sessionId, maxSeq)`，fork 改用它 |
| CD-14 | P2 | `session.copy` 的全量 `listBySession` **发生在写事务内**（持写锁 + 解压全部正文 + batchInsert 全串行）；同族 `message.fork` 的读在事务外，写法不对称 | `service/chat/impl/session.service.ts:374`（事务起于 `:338`） | ❌ 单源 w2-04 | — | 把 `listBySession` 提到事务外（同 fork 写法），事务内只留 insert + `seedForkCopyParity` |
| CD-15 | P2 | 清空整会话（`afterMessageId==null`）为拿一串 id 走全量 `listBySession`（选 21 列全投影 + 逐行解压）；仓储已有只投影 id 的 `listIdsAfterSeq` | `service/chat/impl/message.service.ts:444-445` | ❌ 单源 w2-02 | — | `listIdsAfterSeq(sessionId, 0)`（seq 从 1 起，0 即全量） |
| CD-16 | P2 | user VFS turn 失败时补偿把文件拨回起始 head，**不回滚 `file_cache`**；而 `write` 工具写盘成功后无条件 `upsertFileCacheAfterWrite` 且 `loadOrFillFileCache` 命中即返回无 mtime 校验 → 此后常驻前缀一直用**已被回滚掉的正文** | `user-vfs-turn.service.ts:117`；`domain/tool/builtin/vfs-tools.ts:262,548`；`load-or-fill-file-cache.ts:50-56` | ❌ 单源 w2-08 | — | 补偿成功后对本轮 `mutatingPaths` 调 `clearDomain(sessionId, FILE_CACHE)`（best-effort，同 try/catch） |
| CD-17 | P2 | `subagent-tool` 为取子会话末条 assistant 文本调全量 `listBySession`（全表读 + 逐行 inflate），而消费函数是从末尾向前扫；`task` 工具在父回合可多次调用，每次重付 | `packages/core/src/domain/tool/builtin/subagent-tool.ts:219` | ✅ 多源印证（2 源）chat-1 / w2-service-chat 争议 7（交叉提示） | — | 改 `listBySessionTail(childSessionId, 20)` 或加 `findLastAssistantText` |
| CD-18 | P2 | mobile token chip 的 prompt 组装**没传 `includeHidden:false`**，改为解压完再 JS 侧 `filter`；仓储注释点名这正是秒级卡顿场景；core/desktop 两处读口都传对了 | `apps/mobile/src/services/chat-prompt-tokens.service.ts:458` | ❌ 单源 chat-2 | — | 传 `{ includeHidden: false }`，删掉后面的 `all.filter(...)` |
| CD-19 | P2 | 批注文本归一与匹配有**三份手写副本**且规则不一致（`normalizeAnnotateNeedle` 删 `\t`+trim / `normalizeAnnotateQuoteText` 不删不 trim / `annotate-source-anchor` 内联副本无任何注释说明为何不复用）；`findAllNeedleStarts` 与 `findAllOccurrences` 逐字重复 | `annotate-highlight.ts:18,166`；`annotate-source-range.ts:282,289`；`annotate-source-anchor.ts:102-106` | ✅ 多源印证（2 源，同报告内独立条目）chat-6 / chat-7 | — | 内联副本换成 `normalizeAnnotateNeedle`；`findAllNeedleStarts` 改为 re-export；给 `normalizeAnnotateQuoteText` 补「不删 \t 是差异点」注释防后人「顺手统一」 |
| CD-21 | P2 | `logicalParentDir` 与 `@/domain/vfs/logic/parent-dir.ts` 的 `parentDir` 是两件事（后者内部先 `normalizePath`）；两份实现意味着 `/a//b`、`/a/./b` 在 chip 分类与 VFS 语义下可能给出不同父目录 | `domain/chat/logic/status-chip-label.ts:45` | ❌ 单源 chat-8 | — | `logicalParentDir` 改为 `parentDir(path.trim())`，删本地实现 |
| CD-22 | P2 | attach 二分档的死/冗余逻辑：`isBinaryAttachPath` 分支返回的对象与兜底**逐字相同**（纯死分支，读者误以为二进制走了特殊处理）；`isImageAttachPath` 的 11 个扩展名**全部**是 `BINARY_EXTENSIONS` 49 个的子集（脚本实测差集为空）→ 两处 `\|\| isImageAttachPath(path)` 恒为 false | `scan-at-path-attachments.ts:129-144`；`prepare-user-messages-for-prompt.ts:110,121`；`attach-binary-heuristic.ts` | ✅ 多源印证（2 源）chat-4 / chat-5 | — | 删死分支与两处恒冗余项；保留 `isImageAttachPath` 的话注释写明「当前是 isBinaryAttachPath 的子集」 |
| CD-23 | P2 | `visible-floor` 触发器只要一个**条数**，却把整会话可见消息（含正文解压）全量物化；**每个 agent 回合都跑**（OR 语义下 tokenRatio 未命中就问它）。同款问题在 hide-message 路径已被实锤为「秒级卡顿主源」并治本（改头投影 + SQL 层 includeHidden） | `domain/compaction-conditions/triggers/visible-floor.trigger.ts:21` | ❌ 单源 small-12 | — | 改用 `listMessageHeadersBySession` 计数，或新增 `countVisible(sessionId)` 端口方法 |

### P3（40 条）

| ID | 级别 | 病症 | 位置 | 多源? | 对抗裁决? | 一句话修法 |
|---|---|---|---|---|---|---|
| CD-20 | P3 | 🔁 **judge-r1 F4：级别 P2 → P3**，并按实测刷新病灶。手动「数据清理」成功后只清 `nm-blob-binary` 的 `startupMaintenancePending`，**漏了 `nm-message-content` 的同名标记** → 下个冷启动强制补跑一次全库 GC+VACUUM，desktop 上冻一次事件循环。**判级依据（原病灶面已收缩）**：原文引的 `message-content-compaction.ts` **已不存在**（`git ls-files "*message-content*"` 只剩 `decompression`），残留面确实只剩标记清理这一个点；且唯一消费方 `message-content-decompression.ts:35/94` 只是读该标记决定要不要再跑一遍，**不产生数据损坏** | `infra/db-maintenance/impl/db-maintenance.service.ts:100-104`（`DELETE FROM kkv_entry WHERE module = ? AND key = ?`，实参为 `["nm-blob-binary","startupMaintenancePending"]`）；`message-content-decompression.ts:35,94` | ❌ 单源 pro-1 | **upheld**（adv 十一条辩护与 1-11 号未覆盖此点；adv-11 辩护的是 `startupMaintenanceRan` 另一件事）；🔁 **judge-r1 F4 复核后维持 upheld、但降 P3** | DELETE 改成 `module IN ('nm-blob-binary','nm-message-content')`，或两任务收敛到同一 module 域 |
| CD-24 | P3 | **revision-gc 簇**：`sweepSessionRevisions` 6 参里 3 个 `_` 弃用但 4 个调用方全在传（`TruncateTailDeps` 契约因此强制所有调用方持有 entries/checkpoints）；`revisionReachableKey` 零生产消费方，其唯一测试断言是恒真的无牙断言 | `logic/revision-gc.ts:22-26,55-63`；`truncate-tail-in-transaction.ts:42-46,78-81` | ✅ 多源印证（4 源）ckpt-4/5、rp-11/12、adv-10 | — | 签名收窄为 `(revisionRepo, projectId, sessionId, options?)`；删 `revisionReachableKey` 与该恒真断言 |
| CD-25 | P3 | **checkpoint 域死接口/死类型簇**：`loadFileTree`、`listDistinctCheckpointPointersForSession` 生产零调用（后者唯一非测试引用是一条断言它**不被调用**的 spy）；`MessageCheckpoint` 接口零引用；退役索引常量注释声称的 DROP 路径不存在；`MessageCheckpointServiceDeps.entries` 零引用；`ensureDirectoryChain` 转发导出零消费；`CheckpointFilePointer` **同名不同形**散在四处 | `message-checkpoint.port.ts:20-25,34-38,81-88,97,136`；`model/message-checkpoint.ts:8-12`；`message-checkpoint-schema.ts:39-48`；`message-checkpoint.service.ts:25-28`；`restore-path.ts:32-36`；`vfs/logic/revision-ref-count.ts:17-20` | ✅ 多源印证（4 源）ckpt-8/9/13/15、rp-13/14/15/16、adv-11 | — | 删死成员/接口/常量；`revision-ref-count.ts` 的同名类型改名 `RevisionRef`；`listDistinct…` 注释改为「仅供测试断言 GC 不走可达集」 |
| CD-26 | P3 | **孤儿 GC in-flight 守卫是模块级全局**（`conn` 是 per-connection/per-project 的）→ A 连接清扫在飞时 B 连接的调度被静默丢弃，且**没有周期性任务会补**（下一轮调度者只有另一次 rollback 或同步 sweep）。与同文件同族的连接级实现不一致 | `logic/deferred-revision-orphan-gc.ts:28,55-79` | ✅ 多源印证（3 源）ckpt-10 / rp-10 / adv-4 | **upheld**（adv-4 亲口认输，并逐条驳倒三条辩护：「收敛式语义」不成立、「integrity-repair 兜底」不存在孤儿清扫项、「mobile 单连接」但 desktop 多项目多连接是真实的） | **校准 P2→P3**：三源中两源判 suspected，adv 指出的触发条件（desktop 多连接实况）本轮未经实测；仅影响存储不影响正确性 | 守卫改 `WeakMap<TdbcConnection, boolean>` 按连接去重 |
| CD-27 | P3 | 守卫在 `setImmediate` 回调**执行前**就置位，进程若在这段窗口结束则永久卡 `true`，同进程后续调度全被吞 | `logic/deferred-revision-orphan-gc.ts:55-79` | ✅ 多源印证（2 源）rp-10 / adv-14 | — | 回调内第一行或统一 `.finally()` 复位 |
| CD-28 | P3 | `createBaselineCheckpointBackfillOperation.detect` 把 backfill 倒扫+判空窗**逐字复制**一份且**少了 `signal` 弃权点**（r3-run-4 引入的中断语义在 detect 路径不存在）——已实际漂移 | `logic/backfill-baseline-checkpoints.ts:253-266` | ✅ 多源印证（2 源）ckpt-2 / w4-rollback-adv 争议 3 | upheld（缺 signal 那半）；「repair 不写游标导致下一轮仍全量」那半按 adv 争议 3 定 intentional，不计缺陷 | 抽 `findFirstGapIndex(messages, repo, sessionId, signal?)` 两处共用 |
| CD-29 | P3 | `entryId === -1` 的哨兵路径在 `:94-97` 直接 `pathsNeedWrite.add` 后 continue，**永远用不到 liveHash**，但仍被塞进 `findContentHashesByPaths` 的入参（内部还按 200 分块，多一次分块多 2 次往返） | `logic/resolve-reconcile-paths.ts:85-97` | ❌ 单源 ckpt-12 | — | 查询入参过滤掉 `entryId < 0` 的路径 |
| CD-30 | P3 | `pairs` 在 `:71-83` 已整轮遍历过，这里为挑 `entryId < 0` 哨兵项**再整轮走一次全数组** | `logic/detect-missing-revisions.ts:84-88` | ❌ 单源 ckpt-11 | — | 把 `-1` 判定并入 `:78-83` 的循环 |
| CD-31 | P3 | entry 已 hardDelete 时给**不存在的 entry** 插墓碑行并 `adjustRef(+1)`；`deleteGlobalOrphans` 口径是「ref_count≤0 且 entry 不在 vfs_entry」，这条 ref=1 **孤儿清扫永远收不掉**，只能等引用它的 checkpoint 被删 | `logic/backfill-missing-revision.ts:72-79` | ❌ 单源 ckpt-14 | — | 该分支改 `adjustRef(+0)` / 不写；或在 `deleteGlobalOrphans` 判定里排除「有 checkpoint 引用」的行 |
| CD-32 | P3 | 目标 revision 行缺失时回补的是「**live 当前的 content_hash** 挂在历史 version 上」，造出 `(entry, 历史version) ↔ 当前正文` 的假历史；随后 restore 比出 hash 相同 → 静默不写盘。「降级无操作」与「数据不可恢复」在 UI 上不可区分，注释与测试都没钉 | `logic/backfill-missing-revision.ts:52-69`；`restore-path.ts:172-182` | ❌ 单源 ckpt-6 | — | `RestorePathOutcome` 增 `skipped_missing_history` 结局并向上暴露（可接 toast/日志） |
| CD-33 | P3 | **迁移任务簇**（RULE 已列「约 10 个 tag 后随 migration 清理同轮」退役）：① compaction 单条 UPDATE 包显式事务（每批 100 行 = 100 次 begin/commit 往返）；② blob 归一 `allKnownFailed → continue` 跳过预算检查与批间让步（护栏自带绕出口）；③ compaction 缺 `failedKeys` 跳过分支（两骨架不对齐）；④ `content_json=''` 且 `content_blob IS NULL` 的行命中谓词但 UPDATE 被拒时**不进 failedKeys** → 收尾 `leftover > failedKeys.size` 恒成立 → 每轮返回 stalled、永不置完成标记，**每次冷启动重跑全表扫描**；⑤ 两任务经「各自置各自标记」形成单向时序耦合，压缩任务持续产出新行而归一标记一旦置位永久短路，兜底要用户手工清 KKV | `message-content-compaction.ts:38-44,161,391,405-433,442-445`；`blob-binary-normalization.ts:624-652,655-668` | ✅ 多源印证（2 源）pro-6/10/11 + adv-17/18（pro 争议 5 亦点名） | upheld（⑤ 由 adv 让步，pro 佐证；①②③④ 为 adv 未覆盖或已认输项）**建议随迁移退役一并处理，不单独立项排期** | ①②④ 各自补预算/让步/结构性残留单独计数；③ 补 `failedKeys` 跳过；⑤ 压缩置标记前清 `nm-blob-binary/messageContentDone` |
| CD-34 | ~~P3~~ **已核销** | 🔁 **judge-r1 F5 裁定：核销（stale，前提消失），移出台账池。**原病症：明文行分支直接 parse **不进 LRU**，blob 行进——迁移期（正是最需要缓存的时候）明文读口零缓存收益；且 `parseBlocksArray` 逐块重建的开销大于 inflate，跳过缓存损失比表面大。**核销依据**：消解池缓存（decoded-content LRU）已整体撤销，**两分支差异不复存在**，原病症赖以成立的前提消失。⚠️ 台账层其实早已核销（`ledger-v2.md:48` 的「移出台账池」行已列 CD-34），本次待办只是把 `synth/core-data.md` 这行同步改掉，否则两份文档打架 | `sqlite-message.repository.ts:92-93`（原病灶位置，现已不适用） | ❌ 单源 pro-5 | **mitigated**（adv-1 成功辩护「双形态读本身是迁移期必需、有 spec V1 退役日期、不该按遗留分支记账」——该部分**不入账**；残留的「两形态缓存不对称」曾保持 P3） → 🔁 **judge-r1 F5：进一步核销** | **无（已核销，不再排期）**。若日后解压缓存池重新引入，须重新评估这条 |
| CD-35 | P3 | `assertMessageContent` 是**断言函数却带副作用**（把传入对象的 `blocks` 换成重解析的新数组）→ 每条消息每次读都深拷贝整棵块树，摊掉「解压产物已缓存」的收益；且 `append` 里改的是调用方持有的对象 | `domain/chat/content/parse-message-content.ts:266,107-120`；`message.service.ts:191` | ❌ 单源 pro-9 | — | 拆纯函数 `normalizeBlocks(blocks)` + 无副作用的 assert；检索/计数路径走「只扫描不规范化」通道 |
| CD-36 | P3 | `toMessageParams` 注释称「insert 走 executeTemplate 时由 SqlTemplateParser 按 `#{xxx}` 顺序收集参数」，但 insert 实际是 `conn.execute(sql, params)` **位置参数直绑**——不变量真实，**理由陈述过时且误导** | `sqlite-message.repository.ts:43-47` vs `:394` | ❌ 单源 adv-19 | — | 注释改为「insert/batchInsert 均位置参数直绑，参数序须与 21 列逐位对齐」 |
| CD-37 | P3 | 解压缓存池作用域是**进程**不是连接/库，「每条开连接路径都清池」是**无断言无 lint 无 fail-fast 的约定**；一旦有人绕过 bootstrap 直接 open，后果是静默返回旧库正文（最难查的一类） | `infra/content-cache/logic/decoded-content-cache.ts:38-43`；`novel-master-bootstrap.ts:345` | ✅ 多源印证（2 源）adv-20（让步）/ pro「实证过安全」节独立确认当前安全 | **dismissed-as-bug / 记前瞻风险**（pro 独立枚举三端 open 路径确认当前安全，adv 判 P3） | `clearDecodedContentCaches()` 下沉到 `infra/tdbc` 的 `open()` 包装层，让契约由结构保证 |
| CD-38 | P3 | `getHourlyBuckets` **24 次串行聚合**，而同文件日桶刚被改成单条 `GROUP BY`（`:205-207` 注释明写「替代旧实现的逐日 N+1」）；无时间索引可用时每次全表扫。`getDailyBuckets` 内也没有任何桶数上限（`:200-203` 注释称护栏在这条查询上，实际落在 UI） | `service/chat/impl/usage-stats.service.ts:250-273,200-207` | ✅ 多源印证（3 源）w2-10 / pro-8 / adv-16 | **mitigated**（adv-16 给出三条可辩论据：`idx_chat_message_created_at` 存在使每次是有界范围扫描 / 24 是硬上界单次交互 / DST 空钟点复用零值行是有意处理；不可辩的只有「改造未完成」） | **校准 P2→P3**（三源中两源判 P3，adv 的索引论据成立且触发为低频用户交互） | 照日桶改单条 `GROUP BY strftime('%H',…, 'localtime')` + JS 侧稠密补 24 桶 |
| CD-39 | P3 | `resolveDayRangeMs` 只校验「from 不晚于 to」，**不限制跨度**；`fromDay=0001-01-01`/`toDay=9999-12-31` 会让循环产出约 365 万个桶对象，且同一条 GROUP BY 要扫同跨度数据；桌面端经 renderer IPC 可达 | `service/chat/impl/usage-stats.service.ts:199-248,577-594` | ✅ 多源印证（2 源）adv-15（独立条目）/ pro-8（顺带） | upheld | 加最大跨度常量（如 3660 天）并抛 `chatInvalidArgument`，或按跨度自动降采样 |
| CD-40 | P3 | 手动「数据清理」成功后**不置** `startupMaintenanceRan` → 同进程可能出现两次全库 VACUUM（用户点清理 → 随后启动期搬运任务收尾再跑一次），desktop 上表现为「点完又卡一下」 | `infra/db-maintenance/impl/db-maintenance.service.ts:121-142` | ✅ 多源印证（2 源）pro-7 / adv-11 | **mitigated**（adv-11 成功辩护「两入口分离」是**有意的**：`:116-120` 逐字写明「用户显式点击必须永远真执行」，且走 `runDatabaseMaintenance` 而非 `runStartupMaintenanceOnce`；pro 指出的双 VACUUM 是独立于标志设置的真实成本，但窗口被三层 busy 守卫压得很窄） | 手动链路成功后也置 `startupMaintenanceRan`（不违反「手动不被去重吞掉」这条纪律） |
| CD-41 | P3 | **chat 域死代码/重复/哑参数簇**（11 条）：`diff-workspace-for-user-vfs-flush.ts` 221 行 + 专属测试只服务零生产消费的算法（含一个连测试都没有的死函数）；`computeShowRangeFromSelection` 已 `@deprecated` 但两个薄 re-export 与 `public/chat.ts` 仍在转发；`RenderDirAttachTreeDeps.sessionKkv/sessionId` 死依赖；`projectAgentModeSchema` 零消费（但整个 project-agent 子系统是「repo 活/service 活/barrel 活/UI 死」的四分之一活状态）；`stripLegacyDirWrap`/`stripLegacyFileWrap` 拼了个 `open` 字符串然后 `void open;` 丢弃（`logicalPath` 形参因此是幻觉依赖）；`computeTailBatchAffectedIds` 的 `_sessionMaxSeq` 哑参数（与两个姊妹函数签名同形语义不同）；`listVisibleSorted` 名字承诺 Sorted 实现只 filter（depth 编号对入参顺序敏感，会静默算错）；`SKILL_TOOL_NAME` const 夹在 import 中间且同名字面量 4 处各写一遍；`isUserInputMessage` 的 role 判定在两个调用点恒真；`listBySessionTail` 是 `listBySessionPage(beforeSeq 缺省)` 的特例却各自维护 20 列展开；附件数组级 safeParse 全有或全无 + 静默降级无日志 | `domain/chat/logic/{diff-workspace-for-user-vfs-flush,visibility-batch-range,render-dir-attach-tree,prepare-user-messages-for-prompt,tail-batch-range,message-visible-floor,message-content-helpers}.ts`；`model/project-agent-config.schema.ts:44`；`model/message-attachment.schema.ts:109-126`；`repositories/impl/sqlite-message.repository.ts:300-344` | ✅ 多源印证（2 源，chat-6..20 全部来自 w1-core-chat 一源内独立条目，按同质归并） | — | 逐条按各自建议清理；`project-agent-config` 那条需先确认 service 写入路径是否真可达（见争议 D-4） |
| CD-42 | P3 | **core-small 域死代码/公开面簇**（8 条）：`depthSliceFromWire` 零消费且未进 barrel；`resolveHideMessageRange` 的 `_slice` 形参从未被读；depth 域公开面 4 符号里 3 个零消费；events 域注释仍称「User-configurable」而事件编排器已整体移除；`SessionKkvDomain` 联合类型漏列同文件已定义且被 3 服务使用的 `SESSION_KKV_DOMAIN_USAGE_STATS`（被 `(string & {})` 开放分支掩盖成静默失真）；`SESSION_KKV_COMPOSER_STATUS_DOMAINS` 仍含 `user_vfs_pending` 且注释称「user_ops chip」（功能已随 user ops 拆除，**清理语句本身正确应保留**）；`public/session-kkv.ts` 对外暴露零写入方的 `USER_VFS_PENDING_QUEUE_KEY`；`estimateTokens` 全文件（含模块级单例）零消费 | `domain/depth/logic/{depth-slice,resolve-hide-message-range,depth-from-tail}.ts`；`domain/events/model/event-types.ts:7`；`domain/session-kkv/model/session-kkv-domains.ts:104,123`；`public/session-kkv.ts:17,22`；`domain/compaction-conditions/logic/token-estimate.ts` | ✅ 多源印证（同源归并） | — | 收敛 depth barrel；补 `USAGE_STATS` 或改注释为「开放前缀枚举」；`user_vfs_pending` 改注释为「仅作旧域残留清理」；从 public barrel 摘掉死 key；删 `token-estimate.ts` |
| CD-43 | P3 | `BuiltinToolContext.listSessionMessages` 是**必填**字段，三处装配各包了一个全量 `listBySession` 闭包，但注释指向的 `chat_grep` 工具**已不存在** → 每个 toolCtx 被强制要求提供一个没人会调的「全会话正文（含 hidden）」读口 | `domain/tool/builtin/builtin-tool-context.ts:174`；`run-agent-turn.ts:851,1200`；`create-user-vfs-turn-service.ts:67` | ✅ 多源印证（2 源）w2-11 / w2 争议 7 | — | 摘掉该字段与三处装配；或改可选（`?`） |
| CD-44 | P3 | `UserVfsTurnServiceDeps.messages` **既无说明也无任何引用**，工厂为此专门 new 了一个 `DefaultMessageService`（连带 5 个 repository）注入；同结构另三项（sessionKkv/chatMessages/messageCheckpoint）docstring 明确标 `@deprecated` 保留，属有意 | `service/chat/impl/user-vfs-turn.service.ts:44-62`；`create-user-vfs-turn-service.ts:42-49` | ❌ 单源 w2-13 | — | 删 `messages` 依赖与工厂里的 `DefaultMessageService` 构造 |
| CD-45 | P3 | 置位 hide 前缀的补偿是「把同一区间**整段 show 回来**」，但区间里本来就有一部分是 hidden 的（压缩/上次置位残留）→ 后续步骤抛错触发回滚时会把原本不可见的消息错误 unhide。RULE 只保证「回滚不改变可见性」，set-floor 补偿路径没做同样区分 | `message-transcript-effects.service.ts:121-157` | ❌ 单源 w2-15 | — | 补偿前先读区间内 hidden 分布，或改增量补偿（只 show 本次实际 flip 的行） |
| CD-46 | P3 | 删会话/删项目清了 KKV 全部行（含 `prompt_tokens`），**没清进程内热层** `sessionApiPromptTokenCache`（只由 `invalidateSessionApiPromptTokenEntry` delete）→ 被删 sessionId 在 Map 留常驻条目 | `session.service.ts:190-198`；`project.service.ts:149-197` | ❌ 单源 w2-16 | — | `deleteSessionTree` 内对每个 sessionId 补 `sessionApiPromptTokenCache.invalidate(id)` |
| CD-47 | P3 | 失败补偿只回滚**成功** tool 的突变路径，语义前提是「tool 失败 = 没写盘」；但工具不原子（`write` 先 `vfs.write` 再 `upsertFileCacheAfterWrite`，后者抛错则整个 tool 判失败而文件已落盘 → 这条路径不会被 restore）。另 `find` 只取首个失败者作对外 error，多失败时其余原因被丢弃 | `user-vfs-turn.service.ts:100-125` | ❌ 单源 w2-12 | — | 补偿集合改为「全部 mutatingPaths ∩ 已捕获快照」；或在 tool 边界保证写盘后置动作不抛 |
| CD-48 | P3 | 一次 `rollbackToMessage` 最多对同一 session scope 做 **3 次**全量文件 head 扫描，2 次在事务外、1 次在事务内持锁；`listSessionFileHeads` 结果在同一次 plan 内完全可复用 | `message-rollback.service.ts:164,435,493` | ❌ 单源 w2-20 | — | plan 阶段扫一次存进 `RollbackPlan` 复用；`:164` 的 S-13 护栏只在「空 targetTree + live 非空」判定后才需要扫 |
| CD-49 | P3 | rewind 分支**把同一个 anchor 的同一棵树查了两遍**（`:401-402` 直查 + `resolveRollbackTargetTree` 内部首步再查）；`loadFilePointerTree` 自身是 2 次往返 → 为一个布尔白付 4 次往返 | `message-rollback.service.ts:401-411`；`logic/resolve-target-tree.ts:52-58` | ❌ 单源 adv-8 | upheld（adv 让步，驳倒「为拿 hasDirectTargetTree 才必须单独查」） | `resolveRollbackTargetTree` 增 `hadDirectTargetTree` 返回字段，删掉重复调用 |
| CD-50 | P3 | `revisionHeadBackfill` 路径把 `revisionMetaByKey` 预取**整体丢弃**（推理正确：backfill 会 append 新 revision 使 meta 变化），改逐条 `findMetaByEntryAndVersion` —— 而这恰恰是用户已二次确认、已因快照缺失等了一轮 IO 的最慢路径，形成性能悬崖 | `logic/restore-path.ts:275-279`；`message-rollback.service.ts:542-548` | ❌ 单源 adv-9 | — | `backfillMissingRevisionIfNeeded` 返回新写/确认存在的 `(entryId,version)` 集合并入 prefetch；或 backfill 后重跑一次 `findMetasByEntryVersions` |
| CD-51 | P3 | 锚点配对：外层遍历所有消息收集 result ids、内层再 `messages.find` 找回来，锚点本身也 `find`；为在这一个 tail 上配对，`mapRows` 要把整个 tail 的 `content_json` 全部解压 | `logic/resolve-rollback-anchor.ts:29-43,54,61-64` | ✅ 多源印证（2 源）rp-17 / adv-12 | **mitigated**（adv-12 澄清：函数只被调用一次、不是嵌套循环，**实际是 O(N)+O(N) 不是 O(n²)**，pro 的表述夸大；同时指出真成本是全 tail 解压而非比较次数） | **校准 P3 保留**（两源本已 P3，但需按 adv 口径改写症状描述，避免全局架构图误标 O(n²)） | 单次扫 + 滚动累积 Set；根治需在 message 表建 tool_use→message 反向索引（超本区范围） |
| CD-52 | P3 | **诊断口径与错误类型簇**：`deleted++` 无条件自增而 `deletePathIfExists` 对 NOT_FOUND 静默吞 → probe 的 `deleted` 是「尝试数」不是「实际数」（同段 write 循环用的是真实 outcome 计数）；`assertRollbackOptionsCompatible` 抛**裸 Error** 而非 `SessionFsError` → IPC `formatIpcError` 拿不到结构化 code，UI 走不了 `isRollbackVfsDegradableError` 降级分支；同方法内连续两次 `createSessionKkvService(conn)`，作者在注释里在意顺序而两次 await 之间可被驱动 mutex 让别的语句插队 | `message-rollback.service.ts:111-115,269-289,562-565,628-639` | ✅ 多源印证（3 源）rp-05 / rp-19 / adv-13 | — | `deletePathIfExists` 返回 bool；裸 Error 改 `SessionFsError("ROLLBACK_OPTIONS_CONFLICT")` 或加 mutually-exclusive 类型约束；抽局部 `kkv` 变量复用 |
| CD-53 | P3 | `truncateTailInTransaction` 把 `sweepSessionRevisions` 的删除行数丢掉、返回 `Promise<void>`；两个调用方都无从观测，probe `rollback.tx.truncate-done` 也不含实际 GC 行数 | `logic/truncate-tail-in-transaction.ts:58-98`；`message-rollback.service.ts:239,248-251` | ❌ 单源 rp-20 | — | 返回 `{ sweptRevisions, tailCount }`，probe 带上 |
| CD-54 | P3 | restore-path 两处不可达/死分支：`rev.status === "deleted"` 块在 `meta.status` 判定（L152-171）已 return，必为死代码却制造「restore 有两条 deleted 处理路径」的错觉；`entryRepo == null` 防御不可达（`entryId` 只在 `entryRepo != null` 时才可能解析出来） | `logic/restore-path.ts:120-136,206-215` | ✅ 多源印证（2 源）rp-06 / rp-07 | — | 删 `:206-215`；删 `entryRepo == null` 防御或把参数收紧为必填 |
| CD-55 | P3 | `MessageCheckpointService.release` 注释称「`deleteCheckpointsForMessages` 本身就是一条确定 SQL、没有中间态」——**事实陈述错误**，它是至少 4 条有序语句（SELECT → batchAdjustRefCount 分块 UPDATE → DELETE file → DELETE checkpoint），且走**事务外连接**无事务包裹。第 2 步与 3/4 步之间失败 → ref_count 已减但 checkpoint 行还在 → 计数偏低（PRD 明令禁止的方向）→ GC 可能误删仍被引用的 revision。而它恰好在「已经有东西失败了」的时刻被调用（CoordinatedWrite 补偿） | `service/message-checkpoint/impl/message-checkpoint.service.ts:140-148`；`sqlite-message-checkpoint.repository.ts:390-432` | ❌ 单源 adv-2 | upheld（adv 让步，驳倒「port 上是可选 + best-effort」的辩护：「best-effort」不等于允许计数偏低） | **校准 P2→P3**（单源、失败窗口窄、且 best-effort 语义已声明；但建议按 adv 原判 P2 排期，事实与建议已完整记录） | 包进 `conn.transaction`（单行改动）；或改注释如实说明「非事务、多语句、失败时 ref_count 可能偏低」 |
| CD-56 | P3 | backfill 游标 `OFFSET` 分段的等价性依赖「消息集只增不减 + 前 cursor 行不变」，靠**每个删除点都记得清游标**的人工纪律维持（非结构约束）；新增一个删消息的调用点而忘清 → count 与 cursor 相等 → 短路「已确认无空窗」→ 那一轮空窗永远补不上且**无自愈**（不像 count<cursor 会回退全量） | `logic/backfill-baseline-checkpoints.ts:113-124` | ❌ 单源 rp-09 | — | 清游标从约定改结构：统一 `deleteMessagesAndInvalidateCursor` helper；或 `countBySession` 比较时额外校验 `MAX(seq)` |
| CD-57 | P3 | **RULE 漂移**：RULE「压缩」条目仍写「副作用：清 `rule_snapshot` + `file_cache`」，与代码相反（2026-09-29 用户拍板「压缩与文件缓存无关」，压缩只改消息可见性）。代码是对的、RULE 是旧的。本轮 CR 明令所有机位「读 RULE 做决策感知」→ 后续所有机位会对压缩副作用产生系统性误判（例如给压缩路径补 file_cache 清理、误判 CD-07 的 GC 挂点范围） | `docs/apm/RULE.md`（压缩条目）↔ `service/compaction-conditions/run-compaction.ts:12` | ❌ 单源 small-13 | — | RULE 该句改为「压缩**不**清 `rule_snapshot` + `file_cache`（2026-09-29 用户拍板，回合内前缀冻结不变量）；置位与导入缓存对齐才清」，并补上 prompt-token 失效 |
| CD-58 | P3 | `matchSmartSortPattern` 对用户输入的**任意长度文本**跑用户输入的**任意正则**，两者都无长度/复杂度上限 → catastrophic backtracking 形态的 pattern 直接卡死 UI 线程（用户可粘贴整本小说做测试文本）；另 flags 允许 `y`（sticky），`gy` 组合下 `matchAll` 只在 `lastIndex` 精确位置匹配，编辑器里看起来像「正则不生效」 | `domain/smart-sort-rule/logic/match-smart-sort-pattern.ts:99`；`parse-pattern-input.ts:79`（`j>=1` 下界依赖 40 行外前置条件，现状恰好正确但不可读） | ❌ 单源 small-10 | — | 加测试文本长度上限（如 100KB）与 pattern 长度上限，超出返回 `{ok:false}`；对含 `y` 的 flags 给出明确提示或在预览路径剔除 |
| CD-59 | P3 | `run-compaction` 的 catch-all 吞掉 hide-message 的**全部**异常且不打日志 → 压缩静默失效（DB 错/schema 错/锚定 bug 回归）在用户侧表现为「会话越聊越长但就是压不下去」，零可观测线索；本区负责的锚定逻辑一旦回归，这条 catch 会把病灶完全掩盖 | `service/compaction-conditions/run-compaction.ts:70` | ❌ 单源 small-16 | — | `catch (e) { console.warn('[compaction] hide-message failed', e); return {ok:false}; }` |
| CD-60 | P3 | feature-flag 的 `NM_USER_VFS_UNIFIED_TOOL_TURN=0` 逃生阀在**唯一真实消费端上永不生效**（三处消费方全在 mobile，而 RN 的 `process` shim 只内联 `NODE_ENV`，其余 `process.env.X` 恒 undefined；desktop 不用这个开关）→ 文档承诺的「运维紧急关闭」实际不存在 | `domain/feature-flags/user-vfs-unified-tool-turn.ts:5,32` | ❌ 单源 small-5 | — | 注释改明说「env 逃生阀仅 desktop/CLI 有效」；或补 mobile 侧真实关闭通道（PersistentPreferences 已有，需确认设置界面有入口） |
| CD-61 | P3 | `heuristicSafetyFactor` 文档定义为「< 1 的保守系数」但代码零校验 → `>= 1` 的值会让**非精确计数的阈值高于精确计数的阈值**，方向与安全意图相反（当前唯一构造点不传、走默认 0.85，属 latent） | `domain/compaction-conditions/triggers/token-ratio.trigger.ts:37` | ❌ 单源 small-17 | — | `constructor` 里 clamp 到 `(0,1]` 或在 options 装配处断言 |
| CD-62 | P3 | `create-user-vfs-turn-service.ts` 的 4 处中文 docstring 是 **GBK→UTF-8 双重编码乱码**（文件里真的写着 `鐢ㄦ埛` 码位，非终端显示问题；core 全域仅此 1 文件命中） | `service/chat/create-user-vfs-turn-service.ts:2,25,31,101` | ❌ 单源 w2-18 | — | 用专用编辑工具按正确文案重写这 4 处（勿用 PowerShell 管道改写，会二次破坏编码） |

> 计数说明：P3 段实际列出 **40 行**（CD-20、CD-24…CD-62；其中 **CD-34 已核销**、仅留痕不排期）。
> 合计 merged = 1（P1）+ 21（P2）+ 40（P3）= **62**，与 front matter 一致。
> 🔁 R2-17（judge-r1 F4/F5）改动：CD-20 由 P2 降 P3 并移入本段（故 P3 由 CD-24 起编号变为含 CD-20）；
> CD-34 核销、不移出本表只标注，台账层已同步（`ledger-v2.md:48`）。

---

## 争议上交（无法在本层裁决，保留双方原文要点）

### D-1 · `IN (…)` 变量上限的环境前提冲突（关联 CD-05）
- **检察官/测绘方（core-checkpoint-3）**：`SQLITE_MAX_VARIABLE_NUMBER` 在 SQLite < 3.32 默认 **999**，之后 32766。minSdk 26 对应的 Android 8/9/10/11 自带 SQLite **均 < 3.32**。若 op-sqlite 走系统 SQLite 而非自带 amalgamation，千条消息的会话在低版本 Android 上回滚/清空会直接 `SQLITE_RANGE` 报错。置信 suspected，未能实测 op-sqlite 实际值。
- **辩护方（adv-1）**：现网驱动是 `@op-engineering/op-sqlite@18.0.0` 与 `react-native-quick-sqlite@^8.2.7`，SQLite ≥ 3.32，默认上限 **32766**；tail 要超过 3 万条才触发。属「数据极端形态下会炸」而非「常规路径会炸」。置信：代码事实 confirmed / 影响面 suspected。
- **两方一致处**：代码事实（无分块）成立，且**同文件 `:40` 自己定义了 900 变量上限常量且 `seedCheckpoints` 已分块**——属仓库内部不一致，不是「环境不需要」。
- **上交理由**：修复方向（分块）无争议，但**定级与排期取决于环境前提**。需验证机位实测 op-sqlite 的实际 `SQLITE_MAX_VARIABLE_NUMBER`，或在 op-sqlite 侧钉一条断言。

### D-2 · backfill 两段式短路「恒失败」的代价是否该单独立项（关联 CD-04/CD-56）
- **双方共识**：RULE 主仓已定性「checkpoint backfill 的『无空窗』短路第二段事实上恒失败、回退全量是常态」→ 按执行协议应标 **intentional**，不计入缺陷（辩护方 D12 与两位测绘方均持此立场）。
- **未被记录的推论（core-checkpoint 争议 2 提出，辩护方未直接回应）**：既然回退全量是常态，`decideBackfillShortCircuit` **每轮发送固定多付 5 次查询**（kkv get → countBySession → hasAnyCheckpointForSession → listBySessionOffset → countCheckpointsForMessages），其中 `listBySessionOffset` 还会 `SELECT` 全列并**解压正文**——而它要的只是 `m.id`。
- **辩护方 D12 的立场**：两段式短路结构清晰、等价性前提被写进 port 契约而非藏在实现里，**是正确设计**；未主张删除。
- **上交理由**：主体 intentional 无异议，但「恒失败的代价从未被量化或优化」这一推论尚未被任何文档记录。请主代理拍板：是给 `listBySessionOffset` 加 header 投影变体，还是评估直接删掉两段式只保留全量扫描（`backfill_cursor` 域随之退休）。

### D-3 · checkpoint 层是否有自愈通道（关联 CD-25）
- **检察官（rp-14 / rp-18）**：`createRevisionRefCountRepairOperation`（`revision-ref-count.ts:152`）与 `createBaselineCheckpointBackfillOperation` **全仓只有测试调用**，从未注册进 `novel-master-bootstrap.ts:391-392` 的 registry（只注册了 entry-sequence 修复）→ ref_count 漂移与 checkpoint 空窗**都没有自愈通道**。检察官倾向不作为发现上报（属 migration 退役后的合理收尾），请主代理裁决是否值得在 RULE 记一句。
- **辩护方（争议 4，明确不主张改）**：`repairRefCounts` 的生产调度缺失是 **PRD 明确接受**的——`message-rollback-execution-redesign/prd.md:88` 验收栏原文「现网：生产路径尚未接线空闲 / 周期调度，留待后续迭代（不阻塞本迭代合并）」。辩护方仅记录它与 CD-55（`release` 非事务导致计数偏低）**叠加会放大后果**。
- **上交手协调点**：检察官认为「repair 算子对『误删』无效，只对『计数偏低』有效」，而 `revision-gc.ts:37-40` 注释自述「删文件后旧版 active revision 的 entry 已删、靠这步兜底」说明作者认为孤儿是常态——两句注释与 PRD 验收栏的口径不一致。请裁决走 PRD（不注册，仅在 RULE 记一句）还是补注册。

### D-4 · `project-agent-config` 保留边界（关联 CD-41）
- **测绘方（chat-20，置信 suspected）**：确认「service 层仍在写」（`project.service.ts` 读写 `getAgentConfig`/`updateAgentConfig`）、repo 层活、`public/chat.ts` 完整转发、desktop IPC handler 直接返回 `"project agent feature is removed; returning follow default."` → 属「四分之一活状态」，且**保留范围比 RULE 描述的（"DB 列置空保留"）宽得多**。
- **测绘方自陈的盲点（争议 5）**：**没有读 `project.service.ts` 全文**去确认那条写入路径是否真会被触发（例如是否被 `resolveAgentForProject` 短路掉）。若实际不可达，severity 应下调到 P3。若「有意保留」是推断，标注 suspected。
- **上交理由**：需另一机位定点读 `project.service.ts` 全文 + `resolve-agent-for-project.ts` 才能定性「下架 service 层」还是「仅删零消费导出」。

### D-5 · `diff-workspace-for-user-vfs-flush.ts` 是否有仓外引用（关联 CD-41）
- **测绘方主张（chat-9，置信 confirmed）**：全仓 grep 实测 `diffWorkspaceForUserVfsFlush` / `isWorkspaceFlushDiffEmpty` / `collectUserOpsChangedPaths` **只有 `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts` 一个消费方**，无任何生产引用，`public/chat.ts` 也没转发。`collectUserOpsChangedPaths` 连测试都没有。判断是删。
- **测绘方自陈的保留意见（争议 3）**：文件头 `@deprecated` 明确写着「仅过渡期单测 / **旧工具**保留」——「旧工具」是否指某个**仓外 / 未纳入本仓扫描范围**的调用方，**没有证据排除**。若确实有仓外引用，删除会破坏它。建议主代理裁决前先确认扫描面是否完整。
- **上交理由**：本簇无法自行确认仓外引用面（依赖 L0 覆盖矩阵的全仓边界判定）。

### D-6 · `hasDirectTargetTree` 在 rewind 分支的空树路径（关联 CD-01）
- **辩护方提出并主动标 suspected（争议 2，请检察官/验证机位独立核实）**：`loadFilePointerTree` 在「checkpoint 行存在但所有指针都指向已删且无快照的 entry」时会返回**空 Map 而非 null**（`sqlite-message-checkpoint.repository.ts:298-310`：循环体全部 continue，最后无条件 `return tree`）。此时 `hasDirectTargetTree === true` 但 `targetTree.size === 0` —— 对 rewind 而言**不触发** S-13 护栏（护栏只判 `mode === "undo_send"`），于是 `pathsNeedDelete` 会把 live 树全删。
- **辩护人自己给出的可达性收窄**：迁移 `add-mcp-file-path-snapshot-v1` 只对**迁移时**已删的 entry 留 NULL，之后新建的 checkpoint 一律带 path（`message-checkpoint.service.ts:60-64`）→ 只有「迁移前建的点 + 迁移前删的文件」这一窄历史窗口。
- **检察官的对应辩护（adv-5）**：undo_send 分支因 D2（每条 user 消息无条件 capture）使 `findCheckpointMessageIdAtOrBefore` 总能在很近处命中；即便 targetTree 非空但不完整，**删掉其余全部在语义上是正确的**（回滚到那个时点就该没有它们）→ 辩护成功，把 rp-03 从 P1 降为「可读性问题 P3」（已并入 CD-01 说明，不另立条目）。
- **上交手协调点**：adv-5 的辩护**只覆盖 undo_send 分支**；rewind 分支的空 Map 路径 adv 明确标 suspected 未排除，且 S-13 护栏对 rewind 不生效。请验证机位构造该库形态实跑一次再定性。

### D-7 · 迁移任务退役时点与 backlog 归类（关联 CD-33）
- **辩护方主动请求查证（msgstore-adv 争议 4）**：「双形态读」与 compaction 任务引用的 `spec.md:56-62` 阶段 V1/V1' 与 `RULE.md` 的「约 10 个 tag 后」是**同一份文档体系内的一致声明**，但**未查 tag 历史**确认距离今天（2026-09-30，基线 main@9ca5f5ad / v1.5.28）还剩几个。**若实际已进入 V1 窗口，F-1（双形态读）与整个 compaction 任务应该是「本轮就该下线」的 backlog 项，而不是继续辩护的对象**。
- **检察官侧（msgstore-pro 争议 5）**：两任务在 `packages/core/src/index.ts:96-101` 导出且被 desktop/mobile/cli **三端真实调度**，稳态下首轮即零成本返回 → **不是死路径**；但同样主张纳入「迁移退役」条目统一处理。
- **上交手协调点**：两方一致认为应归入「迁移退役」统一节奏，分歧只在**是否已到退役时点**。需主代理查 tag 历史定性，本簇不做裁决。

---

## 附：本簇 intentional 清单（决策感知，不计入台账）

以下为对抗对/测绘方一致判定为「有意为之」的形态，reduce 阶段**不立项**，仅留档避免后续机位重复下钻：

- **msgstore-adv 十二条辩护项（F-1…F-12）**：双形态读（迁移期必需，有 spec V1 退役日期）、编码收口在 repository、谓词驱动后台搬运而非 schema migration、keyset 游标不承担完成判定、`content_json` 恒置 `''` 使 rowid 复用不致漏扫、解压缓存按主键 id 键控的安全性论证、`searchMessages` 去掉 LIKE 粗筛、命中率「anthropic 加回 cache」+ FILTER 口径、模型筛选取 `llm_saved_model` 子查询而非存储 distinct、维护链路顺序与「VACUUM 事务外直调」纪律、手动/启动两入口分离、分片让步（`yieldFn` 由装配层注入）。
- **w4-rollback-adv 十四条辩护项（D1…D14）**：物理删 tail + seq 复用（四处清游标防线）、checkpoint 只建 user 与写工作区的消息（工作区状态变化点的最小超集）、锚点口径必须落在 tool_result（wire format 死约束）、undo_send 走 prior-only / rewind 走 anchor 自身、S-13 空 targetTree 护栏、entry_id 化 + path 快照列的两难取舍、restore 走 `resetHeadToVersion`（不 append）、同路径异 entry 的三处口径一致、reconcile「先删后写」的顺序依赖、A-22 乐观锁用 `COUNT(*)`（**盲区见 CD-01**）、ref_count 写时维护取代现算可达集、backfill 两段式短路（**代价见 D-2**）、backfill 的 AbortSignal「弃权点」设计、全局孤儿 GC 挪出事务的调度契约。
- **两位检察官主动标注的 intentional**：回滚不改 hidden 可见性、tail 中 hidden 消息被物理删除（回滚 doc 明说「deletes messages with seq > anchor.seq」）、`message.append` 不失效 API prompt 占用（2026-09-29 真机复验拍板，统计优先口径）、fork/copy 不复制 `session_kkv` 与 `composer_draft_json`（SPEC 明写）、hide/show 不失效 `usage_stats`（含 hidden 口径下可见性不改计数）、backfill 全量回退为常态、undo_send 的 prior+anchor 两级 baseline 兜底、`deferGlobalOrphanGc` 默认 false 的共享函数设计、S-13 空 targetTree 护栏、整库替换后解压缓存陈旧（`bootstrapNovelMaster` 首行无条件清池，三端 open 路径全覆盖）、`content_blob` 非空但 `content_encoding` 为 NULL 的行安全（所有写口同时写两列，DDL CHECK 放行 NULL 仅为 legacy）、「其他模型」桶不被 NULL 毒化（`vendor_model_id TEXT NOT NULL`）、ROLLBACK 后 seq 复用导致读错行（RULE 拍板）。
- **`getSessionUsageDetail` 的 `Promise.all` 三查询**（msgstore-pro 争议 2）：打在同一条 TDBC 连接上，驱动 AsyncMutex 使其实际串行，`Promise.all` 只是形式并发——不算问题，但注释「与会话 KKV 缓存读并行」会误导后人。
- **`timeRangeSql` 单端范围整段丢弃时间谓词**（msgstore-pro 争议 4）：所有调用方都经 `resolveOptionalRange` 产出「两端都有或都没有」，该分支实际不可达；未单列 finding。
