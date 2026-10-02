---
zone: w8-ds-chatservices-b
agent: domain-survey / 独立双扫机位 B
files_scanned: 15
files:
  - packages/core/src/service/chat/create-chat-services.ts
  - packages/core/src/service/chat/create-message-transcript-effects.ts
  - packages/core/src/service/chat/create-user-vfs-turn-service.ts
  - packages/core/src/service/chat/message-transcript-effects.port.ts
  - packages/core/src/service/chat/message.port.ts
  - packages/core/src/service/chat/project.port.ts
  - packages/core/src/service/chat/session.port.ts
  - packages/core/src/service/chat/usage-stats.port.ts
  - packages/core/src/service/chat/user-vfs-turn.port.ts
  - packages/core/src/service/chat/impl/message-transcript-effects.service.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/usage-stats.service.ts
  - packages/core/src/service/chat/impl/user-vfs-turn.service.ts
supporting_reads:
  - packages/core/src/domain/chat/logic/seed-fork-copy-parity.ts
  - packages/core/src/domain/chat/logic/message-set-floor-range.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts
  - packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts
  - packages/core/src/domain/message-checkpoint/logic/revision-gc.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/domain/vfs/logic/vfs-tree-copy.ts
  - packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts
  - packages/core/src/domain/session-kkv/model/session-kkv-domains.ts
  - packages/core/src/domain/workplace/logic/workplace-scope.ts
  - packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts
  - packages/core/src/infra/tokenizer/logic/session-api-prompt-token-cache.ts
  - packages/core/src/service/message-checkpoint/truncate-tail-wiring.ts
  - packages/core/src/service/session-fs/create-session-fs-service.ts
  - packages/core/src/service/skills/impl/skills.service.ts
  - packages/core/src/bootstrap/chat/chat-schema.ts
  - packages/core/src/public/chat.ts
  - apps/desktop/src/main/ipc/handlers/messages.ts
  - apps/desktop/src/main/ipc/handlers/usage-stats.ts
  - apps/desktop/shared/ipc-types.ts
---

## 摘要

`packages/core/src/service/chat/` 是聊天域的应用服务层（DDD 的「应用服务 / service 层」）：项目 / 会话 / 消息 / 消息转录副作用 / 用户 VFS turn / token 用量统计六类用例的 port 定义与 TDBC 默认实现，外加三座工厂（`create-chat-services` / `create-message-transcript-effects` / `create-user-vfs-turn-service`）。对外只经 `public/chat.ts` 暴露工厂与 port 类型；双端 runtime（desktop main / mobile runtime）装配后供 IPC 与 UI 调用。内部直接吃仓储（Sqlite*Repository），写路径自带事务，副作用是 VFS 树复制/删除、revision 引用计数、session KKV 域清理、API prompt 占用失效、deferred blob/file-cache GC。

## 职责与边界

- **做什么**：项目 CRUD + 项目模板 VFS 整树复制/删除 + 技能 meta 域与负清单随迁；会话 CRUD + 模板拉取/推送 + 整会话复制 + 子会话（subagent）创建 + 会话级 agent/model 覆盖；消息追加/编辑/删除/fork/隐藏显示区间/tail 截断/搜索；置位（set floor）与其 KKV 清空编排；token 用量多维聚合（summary / 日桶 / 时桶 / provider×model / 请求流水 / 会话详情）。
- **不做什么**：不碰 agent runner / 提示词拼装 / 压缩触发判定（这些在 `service/agent/`、`service/compaction-conditions/`，只反向调用本层的 `MessageService` 与失效函数）；不碰 UI 展示；不做 schema migration（清 backfill 游标是数据维护不是 DDL）。
- **边界口径**：所有写入经 `TdbcConnection`；事务回调内**只用回调传入的 tx**（符合 RULE「事务回调里误用外层 conn 会撞 AsyncMutex」）；缓存失效一律在事务外 await。

## 对外接口

| 导出符号 | 定义位置 | 说明 |
|---|---|---|
| `ProjectService`（list/get/create/rename/delete/copy/getAgentConfig/updateAgentConfig） | `project.port.ts:15` | 项目智能体两项已 `@deprecated` |
| `SessionService`（create/createSubSession/rename/delete/copy/pullTemplate/pushTemplate/draft 读写/get+updateSessionAgentConfig） | `session.port.ts:14` | |
| `MessageService`（append/delete/updateContent/fork/hide/show/hideRange/showRange/truncateAfter/searchMessages + 5 个列表读口） | `message.port.ts:18` | |
| `MessageTranscriptEffectsService`（hide/showMessagesInRange、truncateMessagesAfter、setMessageFloorAtMessage） | `message-transcript-effects.port.ts:14` | |
| `UserVfsTurnService.executeOp` | `user-vfs-turn.port.ts:32` | |
| `UsageStatsService`（getSummary/getDailyBuckets/getHourlyBuckets/getModelBreakdown/listRequestUsage/listModels/getSessionUsageDetail） | `usage-stats.port.ts:182` | |
| `createChatServices` / `createProjectService` / `createSessionService` / `createMessageService` / `createUsageStatsService` | `create-chat-services.ts:64,109,114,122,127` | |
| `createMessageTranscriptEffectsService` | `create-message-transcript-effects.ts:18` | |
| `createUserVfsTurnServiceBundle` / `createUserVfsTurnService` | `create-user-vfs-turn-service.ts:33,102` | |
| 全部类型 | `public/chat.ts:333-353` 再导出 | 双端唯一入口 |

## 数据访问

**触碰的表**（证据均带 file:line）

| 表 | 写点 | 读点 |
|---|---|---|
| `chat_project` | `impl/project.service.ts:127`(insert) `:138`(rename) `:189-192`(delete) `:254,257`(copy) `:231`(agentConfig) | `impl/project.service.ts:104,108,152,203,244` |
| `chat_session` | `impl/session.service.ts:131,135,168,179-182,228,303,350,358` | `impl/session.service.ts:89,94,150,176,191,263,354` |
| `chat_message` | `impl/message.service.ts:210,242,274,354,370,382,399,422,457,488` | `impl/message.service.ts:132,137,145,152,160,167,226,293,366,378,444,469,498` |
| `message_checkpoint` | `impl/message.service.ts:253,455,487`；经 `deleteSessionFsData` | 同 |
| `vfs_entry` | `impl/project.service.ts:173,185,188,263-278`；`impl/session.service.ts:223,366`；`impl/message.service.ts:334` | 同 |
| `vfs_revision` / `vfs_content_blob` | `impl/project.service.ts:262,283-296`（seed live head，ref_count=1）；`impl/message.service.ts:254`；`impl/user-vfs-turn.service.ts:127` | 同 |
| `workplace_dir_rule` | 经 `seedForkCopyParity`（`impl/session.service.ts:383`、`impl/message.service.ts:355`）| 同 |
| `session_kkv_entry` / `session_file_cache_entry` / `session_file_cache_blob` | `impl/session.service.ts:171,219,321`；`impl/project.service.ts:171`；`impl/message.service.ts:113-118,249,451,483`；`impl/message-transcript-effects.service.ts:162,175` | `impl/usage-stats.service.ts:472,548` |
| `skill_disabled_rule` | `impl/project.service.ts:182,279` | — |
| `session_run_state` | `impl/project.service.ts:178`；`impl/session.service.ts:222` | — |
| `llm_saved_model` | — | `impl/usage-stats.service.ts:83,432` |

**KKV 域**：`rule_snapshot` / `file_cache` / `user_vfs_pending` / `backfill_cursor` / `usage_stats` / `prompt_tokens`。
**文件路径**：不直接碰文件系统；VFS 逻辑路径 `session:{pid}:{sid}`、`project:{pid}`、`project:{pid}:meta`（`impl/project.service.ts:173,185,188,265,272`；`impl/session.service.ts:225,368,370`）。

**SQL 字面量**：`impl/usage-stats.service.ts:40-113` 拼 6 段 SQL 片段（`BILLED_INPUT_SUM_SQL` / `RATE_FILTER_SQL` / `AGG_SELECT_SQL` / `USAGE_NOT_NULL_SQL` / `modelFilterSql` / `providerFilterSql` / `timeRangeSql`），全部参数走 `#{...}` 具名绑定，无字符串插值用户输入 —— **无注入面**（已核）。

## 依赖关系

**import 谁**（跨域主干）

- `domain/chat/*`（model + schema + repositories + logic：`seed-fork-copy-parity`、`message-set-floor-range`、`tool-use-count`、`message-content-codec`、`content/parse-message-content`）
- `domain/vfs/*`（`copyVfsTree` / `deleteVfsPrefix` / `seedLiveHeadRevisionsUnderPrefix` / `deferred-blob-gc`）
- `domain/message-checkpoint/*`（`sweepSessionRevisions` / `SqliteMessageCheckpointRepository` / `truncate-tail-in-transaction`）
- `domain/session-kkv/*`（域常量、`SqliteSessionKkvRepository`）
- `domain/skills/*`、`domain/workplace/logic/workplace-scope`、`domain/agent/logic/validate-agent-definition`
- `infra/tdbc`、`infra/sql-template`、`infra/serialization/decode`、`infra/random-uuid`、`infra/tokenizer/logic/session-api-prompt-token-store`
- `service/session-fs`、`service/session-kkv`、`service/session-run-state`、`service/template`、`service/vfs`、`service/workplace`、`service/message-checkpoint`、`service/coordinated-write`、`service/agent/logic/agent-run-shared`

**被谁消费**（core 内）

- `public/chat.ts`（唯一对外出口）
- `service/agent/impl/{chat-agent-session,agent-runner}.ts`、`service/agent/logic/{run-agent-turn,resolve-agent-for-project}.ts`
- `service/compaction-conditions/{run-compaction,hide-message.action}.ts`
- `service/vfs/build-user-vfs-turn-op.ts`、`service/vfs/logic/clear-session-prompt-caches.ts`
- apps：`apps/desktop/src/main/runtime/create-desktop-runtime.ts:142`、`apps/mobile/src/runtime/create-mobile-runtime.ts:114`

**循环依赖**：未见（本层不 import 任何 runtime / public barrel）。

## 发现清单

### F-w8-ds-chatservices-b-1 | P1 | `packages/core/src/service/chat/impl/project.service.ts:185,188` | confirmed

```
await deleteVfsPrefix(r.vfs, `project:${id}`, "/");
...
await deleteVfsPrefix(r.vfs, `project:${id}:meta`, "/");
```

**描述**：项目删除用裸 `deleteVfsPrefix` 删 project scope 的 VFS entry，但**从不调 `decrementLiveRefsUnderScope`**。而 project scope 的 live-head revision 确实带着 ref_count=1 被种下 —— `impl/project.service.ts:283,290` 的 `seedLiveHeadRevisionsUnderPrefix`（复制时）与 `service/template/logic/push-session-workspace.ts` 的 `replaceVfsSubtree({revisions})`（推送模板时）都会种。后果链已逐段核实：

1. entry 删除后，`deleteUnreferencedUnderScope` 的 SQL 是 `JOIN vfs_entry e ON e.entry_id = r.entry_id WHERE e.scope_key = #{scopeKey} AND r.ref_count <= 0`（`domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts`），entry 没了就再也选不中这些行；
2. 全局兜底 `ORPHAN_REVISION_GC_SQL` 是 `DELETE FROM vfs_revision WHERE ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`，`ref_count` 仍是 1，同样选不中；
3. `infra/db-maintenance/` 下 4 个任务里**没有**任何 ref_count 重算任务（grep `ref_count` 于该目录零命中）；
4. `vfs_content_blob` 的 live ref 同样不减，`runDeferredBlobGc`（`project.service.ts:194`）也回收不掉。

即：**每复制一次项目、再删除该项目，就永久泄漏一批 `vfs_revision` 行 + 其 blob**；推送过模板的项目被删除时同样泄漏。仓库里已有现成的正确 helper `sweepRevisionsUnderScope`（`domain/vfs/logic/vfs-tree-copy.ts`，顺序是 decrement → deleteVfsPrefix → deleteUnreferenced），session 侧删除走的正是 `deleteSessionFsData` 那套（`impl/session.service.ts:218`）。

**建议**：`project.service.ts` 的两处 `deleteVfsPrefix(project:*)` 换成 `sweepRevisionsUnderScope(r.vfs, r.revisions, scopeKey, "/")`（`reposFor` 里已有 `revisions`），与 session 侧口径对齐。
**置信度**：confirmed（ref_count 种下、两条 GC 路径的 SQL、维护任务缺失均已实查）。

---

### F-w8-ds-chatservices-b-2 | P2 | `packages/core/src/service/chat/impl/project.service.ts:168-174` | suspected

```
for (const session of allSessions) {
  await r.messages.deleteBySession(session.id);
  await deleteSessionFsData(tx, session.id, id);
```

**描述**：删一个项目时，对 BFS 展开出的**每一个**会话（含全部子会话）都调一次 `deleteSessionFsData`，而它内部的 `sweepSessionRevisions`（`packages/core/src/service/session-fs/create-session-fs-service.ts`）默认 `includeGlobalOrphans !== false`，会额外跑一次 `revisionRepo.deleteGlobalOrphans()` —— 那是全表 `ref_count<=0 AND entry_id NOT IN (vfs_entry)` 反连接。N 个会话 = N 次全库扫描，全在一个事务内。同样的放大存在于 `session.service.ts:207-232` 的递归删除（父 + 每个子会话各一次）。项目越大、子会话越多越明显，移动端单连接同步事务下尤其容易顶到长事务。

**建议**：`sweepRevisions` 的全局孤儿那一半从循环里提出，循环内用 `includeGlobalOrphans:false`，循环结束后跑一次 `deleteGlobalOrphans()`（`truncate-tail-in-transaction.ts:76-84` 已有 `deferGlobalOrphanGc` 同款先例可抄）。
**置信度**：suspected（放大系数与扫描代价按代码结构推断，未实测大会话耗时）。

---

### F-w8-ds-chatservices-b-3 | P2 | `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77` | confirmed

```
async truncateMessagesAfter(projectId, sessionId, afterSeq, options?) {
  await this.deps.conn.transaction(async (tx) => {
    await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {...});
  });
}
```

**描述**：该方法删掉了可见消息（改变「当前可见 prompt」），但**既不调 `invalidateSessionApiPromptTokenEntry`，也不失效 `usage_stats.toolUseCount`**。对照 `message.service.ts:490-491` 的 `truncateAfter` —— 同样语义，两处都调了。`invalidateSessionApiPromptTokenEntry` 的契约注释（`infra/tokenizer/logic/session-api-prompt-token-store.ts:236-238`）明写「凡改变『当前可见 prompt』或模型绑定、应丢弃陈旧 API 占用的路径，成功后必须调本函数」；读口 `resolve-current-prompt-tokens.ts:279` 是 `entry.promptTokens + estimateAnchoredDelta(entry.anchorSeq, …)`，尾删后基线与锚点都指向已不存在的消息，上下文占用 chip 与压缩阈值判定会长期偏高。

**当前可达性**：desktop 侧 `apps/desktop/src/main/ipc/handlers/messages.ts:252` 有暴露，但 renderer 端 `ipcMessagesTruncateAfter`（`apps/desktop/renderer/ipc/invoke-registry.ts:376`）**当前无任何调用方**（grep `ipcMessagesTruncateAfter` / `truncateTail` / `deleteTail` 于 `apps/desktop/renderer` + `apps/mobile/src` 零命中）—— 所以是「接口已开、后端有洞、前端没接」的潜伏缺陷，一旦接 UI 即踩。
**建议**：在事务 await 之后补两行失效（照抄 `message.service.ts:91-96` 的 `invalidatePromptTokens` + `invalidateToolUseCount`）。
**置信度**：confirmed（差异已逐行比对；可达性为 grep 实测）。

---

### F-w8-ds-chatservices-b-4 | P2 | `packages/core/src/service/chat/impl/message.service.ts:446-491` | confirmed

```
await new SqliteSessionKkvRepository(tx).clearDomain(sessionId, SESSION_KKV_DOMAIN_BACKFILL_CURSOR);
...
await checkpoints.deleteCheckpointsForMessages(sessionId, ids);
await messages.deleteBySession(sessionId);
```

**描述**：`truncateAfter` 的两条分支（清空整个 session / 截断 tail）只清了 `backfill_cursor` 一个域，**没清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`**（`file_cache` + `user_vfs_pending`，见 `domain/session-kkv/model/session-kkv-domains.ts:109-112`）。而它所"本该对齐"的共享函数 `truncateTailInTransaction`（`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:94-96`）在 `tailIds.length > 0` 时是**逐域清**的。两条 tail 截断路径（`chat-agent-session.ts:58` 的 abort 回滚走本方法；回滚服务与 desktop IPC 走共享函数）行为分叉：agent 中止后 workplace chip 的差集缓存保留旧值。`delete(id)`（`:249-252`）同样只清 `backfill_cursor`，与共享函数口径也不一致。

**建议**：三处统一补 `for (const d of SESSION_KKV_COMPOSER_STATUS_DOMAINS) await …clearDomain(sessionId, d)`；更彻底的做法是把这三段抽成一个共享 helper，消灭分叉源头。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-5 | P2 | `packages/core/src/service/chat/impl/usage-stats.service.ts:256-272` | confirmed

```
for (let hour = 0; hour < 24; hour++) {
  const row = startMs < endMs
    ? await this.queryAggregateRow(startMs, endMs, filter.model, filter.providerId)
    : ZERO_AGG_ROW;
```

**描述**：时桶是 24 次串行全表聚合查询。同文件的日桶已经明确做过这个优化并在 `:206-207` 写下理由（「单条 GROUP BY 查询替代旧实现的逐日 N+1」），时桶却没跟上——`chat_message` 上有 `idx_chat_message_created_at`（`bootstrap/chat/chat-schema.ts:58`），每桶是一次索引范围扫 + 24 次 round-trip；op-sqlite 驱动下每 round-trip 还要过桥。统计页在 mobile（`TokenUsageStatsScreen.tsx:283`）与 desktop（`usage-stats.ts:190`）都会调。
**建议**：照日桶写法改单条 `GROUP BY strftime('%H', created_at_ms/1000, 'unixepoch', 'localtime')` 查询，DST 缺失钟点继续复用 `ZERO_AGG_ROW` 补齐。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-6 | P2 | `packages/core/src/service/chat/impl/usage-stats.service.ts:233-247` | confirmed

```
for (let cursor = new Date(from.year, from.month, from.day); ; cursor = addLocalDays(cursor, 1)) {
  const dayKey = fmtLocalDay(cursor);
  buckets.push(this.toBucket(cursor.getTime(), rowByDay.get(dayKey) ?? ZERO_AGG_ROW));
  if (dayKey === filter.range.toDay) { return buckets; }
}
```

**描述**：唯一的护栏是 `range != null`（`:201-203`，注释自称「护栏挂在这条查询上而非区间类型」），但**跨度本身无上界**。`resolveDayRangeMs`（`:577-594`）只校验格式与 `fromDay ≤ toDay`。desktop IPC 边界 `validateRangeDto`（`apps/desktop/src/main/ipc/handlers/usage-stats.ts:36-60`）也是同款校验，同样不限跨度。因此 `fromDay: "0001-01-01", toDay: "9999-12-31"` 会通过全部校验，产出约 365 万个桶对象，再经 IPC 结构化克隆回 renderer —— 主进程长时间卡死。UI 侧只要自定义区间误选远端年份即可触发（`TokenUsageStatsView.tsx:408` 直接把用户输入的 `customFrom/customTo` 透传）。
**建议**：在 `getDailyBuckets` 入口按跨度设硬上限（如 366×3 天）并抛 `chatInvalidArgument`，与 port 注释「桶数随天数线性膨胀，护栏挂在这条查询上」对齐。
**置信度**：confirmed（校验链已逐层核对；`0001-01-01` 能过 `parseDayLocalDate`：`new Date(1,0,1)` 落在 1901 年会被拒，但 `"1000-01-01"` 起合法，跨度仍近 300 万天 —— 上界缺失这一结论不变）。

---

### F-w8-ds-chatservices-b-7 | P2 | `packages/core/src/service/chat/create-user-vfs-turn-service.ts:2,25,31,101` | confirmed

```
 * 鐢ㄦ埛 VFS U-A-U-A 鏈嶅姟宸ュ巶銆?
/** `createUserVfsTurnServiceBundle` 杩斿洖鍊笺€?*/
```

**描述**：**提交态源码里存在 GBK mojibake**。逐码点核验第 2 行为 `9422 3126 57db`（`鐢ㄦ埛`）—— 正确应为 U+7528 U+6237（`用户`），这是「UTF-8 字节被按 GBK 解码」的典型形态；行尾 `銆?` 的 `?`（0x3F）说明原 `。`（E3 80 82）的第三个字节已被丢弃，**信息不可逆**。全量扫描 `git ls-files packages/core/src/service/chat` 共 15 个文件，**仅此一个文件**中招（4 行注释受损，其中 `:69,70,76,77` 完好，说明是同一文件内的局部覆写）。工作区干净（`git status --porcelain` 无输出），即损坏已进入 HEAD 提交。这正是 `docs/apm/RULE.md:111` 记录的 PowerShell 管道改写 UTF-8 中文文件事故的残留。
**建议**：`git checkout main -- packages/core/src/service/chat/create-user-vfs-turn-service.ts` 若 main 侧未损坏则直接还原；否则按上下文重写这 4 行注释。修复时遵守 RULE 的「改含中文文件一律用专用 Edit 工具 / 字节级替换」。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-8 | P2 | `packages/core/src/service/chat/impl/message.service.ts:193,210` | suspected

```
const seq = await this.deps.messages.nextSeq(sessionId);
...
await this.deps.messages.insert(message);
```

**描述**：`nextSeq`（`SELECT MAX(seq) … + 1`）与 `insert` 是两次独立 await，**不在同一事务**。`chat_message` 上有 `UNIQUE (session_id, seq)`（`bootstrap/chat/chat-schema.ts:56`），所以并发下不会静默写坏 seq 复用，但会以约束冲突**直接抛错**，且失败方的那条消息内容丢失、没有重试。同一会话上的并发写来源是真实存在的：agent run 的工具步 append 与用户侧中止回滚（`truncateAfter` 同为非事务读 seq + 写）交错时、以及 `toolRunner.runParallel` 下多个工具步各写一条 assistant 消息。
**建议**：`nextSeq + insert` 包进 `this.deps.conn.transaction`（读 MAX 在事务内即拿到写锁语义），或在约束冲突时重试一次。注意事务回调内要用 `tx` 构造 repo（RULE 红线）。
**置信度**：suspected（并发窗口存在是确定的；是否真会撞取决于调用方是否已串行化，未做运行时压测）。

---

### F-w8-ds-chatservices-b-9 | P3 | `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:117-158` | suspected

```
rollback: async () => { await this.deps.messages.showRange(sessionId, hidePrefix.fromSeq, hidePrefix.toSeq); }
...
rollback: async () => { await this.deps.messages.hideRange(sessionId, showSuffix.fromSeq, showSuffix.toSeq); }
```

**描述**：`CoordinatedWrite` 的补偿是「反向区间操作」，但区间操作只按 seq 范围生效、不记录「本次真正翻转了哪些行」。`updateHiddenRange` 的 SQL 带 `AND hidden = 0`（`sqlite-message.repository.ts:487`）—— 正向是幂等收敛的，**反向不是**：若压缩已把 seq 1–5 置为 hidden，随后 set-floor 要 hide 1–10（实际只翻转 6–10），中途失败触发补偿 `showRange(1,10)` 会把压缩藏掉的 1–5 一并显示出来。可见性计数与意图都会偏。
**建议**：正向时先把要翻转的行 id 查出来（`listMessageHeadersBySession` 是现成的无正文轻量读），补偿按 id 精确还原；或让 `hideRange/showRange` 返回被翻转的 id 列表。
**置信度**：suspected（触发需要 `CoordinatedWrite` 中途抛错；反向覆盖 pre-existing hidden 行的推论由 SQL 条件直接得出）。

---

### F-w8-ds-chatservices-b-10 | P3 | `packages/core/src/service/chat/impl/session.service.ts:366-373`；`packages/core/src/service/chat/impl/message.service.ts:334-341` | suspected

```
await copyVfsTree(r.vfs, { scopeKey: `session:${source.projectId}:${source.id}` }, "/", ...)
```

**描述**：fork / copy 无条件按 `session:{pid}:{sid}` 拷 VFS，并调 `seedForkCopyParity` 拷 `session:{sid}` 的 workplace 规则。若 `source` 是**子会话**，这两处源 scope 都不存在（子会话从不建 VFS scope，见 `session.port.ts:25-31` 的说明；规则快照也是「首次装配时写入」到子会话自己的 KKV），于是产出的是**一个只有消息、文件区全空、且没有任何目录规则**的新主会话——与它在 UI 上呈现的「共享父工作区」预期不符。`workplaceScopeKey({kind:"session"})` 也不含 projectId，只有 sessionId（`domain/workplace/logic/workplace-scope.ts:18-20`），无别的键可试。
**当前可达性**：两个入口都只传主会话 id（`useChatTabScope.ts:511` 的 `sessions.copy(sourceSessionId)`、`messages.ts:317` / `useChatTabMessageActions.ts:171` 的 `fork(req.sessionId, …)`），所以是潜伏缺陷。
**建议**：`copy` / `fork` 先判 `parentSessionId != null`，子会话源则用 `resolveWorkplaceOwnerSessionId(source)` 把 VFS scope 与 workplace scope 都指向根父会话（或直接对子会话抛 INVALID_ARGUMENT）。
**置信度**：suspected。

---

### F-w8-ds-chatservices-b-11 | P3 | `packages/core/src/service/chat/impl/session.service.ts:168` 对 `:261-271` | confirmed

```
await this.deps.sessions.insert(session);   // createSubSession：不写 agent_config_json
...
if (json == null) {
  throw chatInvalidArgument("session agent config missing, run migration session-agent-config-v2");
}
```

**描述**：`createSubSession` 只 insert 会话行（`SqliteSessionRepository.insert` 的列清单里根本没有 `agent_config_json`），所以**每个子会话的 agent 配置恒为 NULL**；而 `getSessionAgentConfig` 对 NULL 的处理是抛一条**指向历史迁移 `session-agent-config-v2` 的误导性错误**。当前没有受害者（`resolveAgentForProject` 在 run 里只对顶层 scope 调用，`loadChatAgentMeta` 也只被 chat-tab / SessionDetailScreen 用主会话 id），但这是个明摆着的陷阱：任何将来对子会话读 agent 配置的调用方都会拿到一条与真实成因（"子会话本来就不写配置"）无关的报错。
**建议**：`getSessionAgentConfig` 对「`parentSessionId != null` 的子会话」返回父会话配置（语义上也更对 —— 子 agent 用的就是父的 agent 上下文），或至少把错误文案改成区分「子会话无独立配置」与「迁移未跑」两种成因。
**置信度**：confirmed（列清单与错误分支均已实查；无现存调用方属 grep 实测）。

---

### F-w8-ds-chatservices-b-12 | P3 | `packages/core/src/service/chat/impl/session.service.ts:124` 对 `:172-177` | confirmed

```
title: title ?? null,          // create()：不 trim、不校验
...
const trimmed = title.trim();
if (trimmed.length === 0) throw chatInvalidArgument("session title must not be empty");   // rename()：trim + 拒空
```

**描述**：同一个字段两条写入口径不一致 —— `create(projectId, "")` / `create(projectId, "   ")` 会把空串/纯空白直接写进 `chat_session.title`，而 `rename` 拒绝。对比项目侧 `project.service.ts:116-119` 的 `create` 是 trim + 拒空的（项目侧正确，会话侧漏了）。
**建议**：`create` 里补 `title?.trim() ?? null`，或与 rename 一样对纯空白抛错。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-13 | P3 | `packages/core/src/service/chat/impl/message.service.ts:513-515` | suspected

```
return candidates
  .filter((msg) => messageMatchesKeyword(msg, keyword))
  .slice(0, Math.max(1, Math.floor(query.limit)));
```

**描述**：`Math.floor(NaN) = NaN`、`Math.max(1, NaN) = NaN`、`slice(0, NaN)` 归一为 `[]` —— **静默返回空结果**，不报错也不落日志。RULE 记载「双端 UI 输入需过滤非数字并归一空串/NaN」，说明 NaN 确实在链路上出现过；此处是纵深防御缺失的另一端（仓储层 `sqlite-message.repository.ts:513` 的 `clampedLimit` 同样不拒 NaN，会把 NaN 绑进 `LIMIT`，由驱动抛错 —— 表现取决于哪一层先炸，两层都不给清晰报错）。
**建议**：入口显式 `if (!Number.isFinite(query.limit)) throw chatInvalidArgument(...)`，与 `listRequestUsage:355-366` 对 offset/limit 的既有校验同款（那边已经写对了）。
**置信度**：suspected（NaN 是否真能到达此层未从 UI 侧完整追链）。

---

### F-w8-ds-chatservices-b-14 | P3 | `packages/core/src/service/chat/impl/session.service.ts:190-198`、`impl/project.service.ts:149-197` | confirmed

```
await runDeferredBlobGc(this.deps.conn);
await runDeferredFileCacheGc(this.deps.conn);
```

**描述**：删会话 / 删项目时清了 KKV 行（`clearSession`），但**没有清进程内热层** `sessionApiPromptTokenCache`（`infra/tokenizer/logic/session-api-prompt-token-cache.ts` 的模块级 `Map`）。该缓存提供了 `clear(sessionId)` / `invalidate(sessionId)`，但全仓 grep 显示**只有测试文件在用这两个方法**，生产删除路径一个都没接。UUID 不复用所以不会读到别人的数据，代价是：长驻进程里每删一个会话就永久留一条 entry，无上界、无 TTL、无 LRU。
**建议**：`deleteSessionTree` / `project.delete` 的事务提交后补 `sessionApiPromptTokenCache.invalidate(sessionId)`（子会话同理）。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-15 | P3 | `packages/core/src/service/chat/impl/user-vfs-turn.service.ts:37-63,78-79,146-147` | confirmed

```
readonly messages: MessageService;          // 全文未消费
readonly chatMessages: MessageRepository;   // @deprecated，全文未消费
readonly messageCheckpoint: MessageCheckpointService;  // 「历史依赖」，全文未消费
...
if (op.actionXml.trim() === "") throw chatInvalidArgument(...);   // 校验后从不使用
```

**描述**：`DefaultUserVfsTurnService` 的三个依赖（`messages` / `chatMessages` / `messageCheckpoint`）在类体内**一次都没引用**，`UserVfsTurnOp.actionXml` 与 `UserVfsTurnToolSpec.id` 也只是被校验/忽略。注释已说明这是「user ops 拆除后保留以便工厂签名稳定」，属**已知的历史包袱**（RULE 记载 user ops 已整体拆除、待写方归零），按纪律标 intentional 不当缺陷报；但它有一个副作用值得记一笔：`create-user-vfs-turn-service.ts:42-49` 为了塞这三个不用的依赖，仍然**完整构造了一个 `DefaultMessageService`**（连带 3 个 Sqlite 仓储），以及 `:93` 一个 `createMessageCheckpointService(conn)`（内含回滚服务）。每次装配都在白建一整套对象图。
**建议**：等依赖面彻底收敛后删掉三个死依赖 + 同步精简 `UserVfsTurnServiceDeps` 与工厂装配（port 的 `executeOp` 签名可不动）。
**置信度**：confirmed（历史包袱 intentional；但死依赖带出的白建对象图是新的观察点）。

---

### F-w8-ds-chatservices-b-16 | P3 | `packages/core/src/service/chat/impl/user-vfs-turn.service.ts:143` | confirmed

```
return { ok: false, error: failed.error, partialFailure: true };
```

**描述**：`partialFailure: true` 的语义按 port 定义是「写盘失败按 partialFailure 回滚 restore」（`user-vfs-turn.port.ts:33-35`）—— 即「有一部分已经落盘、但被 restore 冲回去了」。当 `op.tools` 里**所有**工具都失败时，恢复循环 `for (index …) if (!outcome.ok) continue` 一次都不执行，没有任何东西被部分写入，返回值却仍然宣称 `partialFailure: true`，调用方会据此弹「部分成功」类文案。
**建议**：`const restored = outcomes.some(o => o.ok)` 后置 `partialFailure: restored || undefined`；或引入计数只在有成功项时置位。
**置信度**：confirmed。

---

### F-w8-ds-chatservices-b-17 | P3 | `apps/desktop/shared/ipc-types.ts:902`（本区消费面 `usage-stats.port.ts:40-47`） | confirmed

```
export type UsageStatsFilterDto = {
  readonly range?: UsageStatsRangeDto;
  readonly model?: string | null;
};
```

**描述**：core 的 `UsageStatsFilter` 有 `providerId` 三态（全部 / 「其他」桶 / 指定服务商），`DefaultUsageStatsService` 也完整实现了 `providerFilterSql` 与按 provider×model 归并（`impl/usage-stats.service.ts:94-102,282,315-347`），但 **desktop 的 IPC DTO 里根本没有 `providerId` 字段**，`toCoreFilter`（`apps/desktop/src/main/ipc/handlers/usage-stats.ts:65-71`）也不透传。结果：desktop 统计页**没有服务商筛选能力**，而 mobile（`TokenUsageStatsScreen.tsx` 直接调 `runtime.usageStats`，不经 IPC）有。这是能力缺口而非崩溃，但两端口径不齐，容易让后续维护者误以为 desktop 也支持。
**建议**：要么补 DTO 字段 + `toCoreFilter` 透传 + UI 加筛选，要么在 `UsageStatsFilterDto` 上写注释显式声明「desktop 不支持服务商筛选」并登记为待办。
**置信度**：confirmed（是否为产品有意取舍未知，故不作缺陷定性）。

---

### F-w8-ds-chatservices-b-18 | P3 | `packages/core/src/service/chat/create-chat-services.ts:109-131` | confirmed

```
export function createProjectService(conn: TdbcConnection): ProjectService {
  return createChatServices(conn, _stubSessionDeps()).projects;
}
```

**描述**：`createProjectService` / `createMessageService` / `createUsageStatsService` 三个单服务工厂都走 `createChatServices`，一次性 new 出 6 个 Sqlite 仓储 + 4 个服务实例，然后**丢掉三个**。`createMessageTranscriptEffectsService`（`create-message-transcript-effects.ts:23`）为了拿一个 `MessageService`，也会连带建出 project/session/usageStats 三个用不上的服务。这些对象本身无状态、单构造开销小，但 `SqliteMessageRepository` 会带 `yieldFn` 闭包、`createWorkplaceService` 链更长，属于纯粹的重复分配。
**建议**：为单服务工厂抽 `_wireCommon(conn)` 返回共享仓储 bundle，各 `createXxxService` 只 new 自己那一个；或至少在注释里写明「刻意走全量装配以免两套 wiring 漂移」——后者是当前隐含的取舍理由，值得写下来。
**置信度**：confirmed。

---

## 争议与存疑

1. **F-1 的定级（我给 P1）**。若主代理认为「项目复制/删除是低频操作、泄漏量有界」而降级到 P2，我不反对 —— 但请注意它同时命中 `vfs_content_blob`，而 RULE:108 明确记载过一次「体积结论必须按内容哈希去重统计」的事故（基线虚高近一倍）。泄漏的 blob 在库里是实打实按字节占位的，不是记账偏差。
2. **F-2 的扫描代价未实测**。我按 `deleteGlobalOrphans` 的 SQL 结构推断是全表反连接，没有在真实库上跑计时。若要坐实，建议拿一个含 200+ 会话、10 万级 message 的库副本做 project delete 计时对照。
3. **F-3 是否要提级**。它今天不可达（renderer 无调用方），所以我留在 P2。但从「IPC 通道已注册、后端实现有洞」的组合看，一旦有人接 UI 就会踩 —— 若 ledger 想强调潜伏风险，可以按「接口已开即算缺陷」提到 P1。
4. **F-13 的 NaN 可达性我没追完**。我确认了服务层与仓储层都没有 NaN 拒收，但没逐个走完双端 UI 的输入归一化链。若 UI 侧确实过滤了 NaN，这条应降为 P3/无需修。
5. **`truncateAfter` / `truncateMessagesAfter` / `truncateTailInTransaction` 三条截断路径**（F-3 + F-4）是同一类分叉的两个面。我倾向的根治方案是让 `message.service.truncateAfter` 也委托 `truncateTailInTransaction`，只保留服务层的失效调用 —— 但这属于重构、超出本轮 CR 范围，仅作为建议记录。
6. **`create-user-vfs-turn-service.ts` 的 mojibake 是否波及 main**。我只在本 worktree（`feat/repo-mega-cr`，基 main@9ca5f5ad）核验。需要主代理在主仓复查同一文件：若 main 也是坏的，说明污染早于分支，修复应走一次独立提交而非本 CR 轮。