---
zone: core-service-chat
agent: domain-survey
files_scanned: 22
head_sha: 9ca5f5adbe3ed29caa3b030496698bd233a141a2
---

# W2 按域测绘 —— core-service-chat

扫描范围：`packages/core/src/service/chat/`（15 文件）+ `packages/core/src/service/message-checkpoint/`（7 文件），全部逐行读完（无跳读）。
为核实「数据访问 / 依赖 / 消费方」，另定点读了相邻的 domain 层与 app 层若干文件（`domain/chat/repositories/impl/sqlite-message.repository.ts`、`domain/message-checkpoint/logic/*`、`service/vfs/logic/clear-session-prompt-caches.ts`、`service/compaction-conditions/*`、`domain/tool/builtin/vfs-tools.ts`、`domain/session-kkv/*`、`infra/tokenizer/logic/session-api-prompt-token-store.ts`、`apps/desktop/src/main/ipc/handlers/messages.ts` 等）。

---

## 摘要

`service/chat` + `service/message-checkpoint` 是 core 的**对话面应用服务层**：projects / sessions / messages / usageStats 四个 CRUD+装配服务，加上 transcript 副作用（置位 / 区间 hide-show / tail 截断）、user VFS turn（用户文件操作即时写盘 + 失败补偿回滚）、以及 checkpoint capture/backfill 与消息级工作区回滚。所有落库都经 domain 层 repository，本层只做编排、事务边界与**跨资源缓存失效**（API prompt 占用、usage_stats.toolUseCount、rule_snapshot / file_cache、backfill 游标）。

## 职责与边界

- **拥有**：事务边界（`conn.transaction` 何时开、何时提交后才调 GC）、缓存失效口径、message/session/project 的 fork-copy-parity、usage 聚合 SQL 口径、回滚的乐观锁与 VFS reconcile 编排。
- **不拥有**：消息正文编解码与 SQL（`domain/chat/repositories/impl/sqlite-message.repository.ts`）、回滚目标树解析（`domain/message-checkpoint/logic/*`）、tail 截断的共享事务逻辑（`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts`）、KKV 域定义、API prompt token 存取。
- **跨层写入**：本层直接 new 多个 infra/domain repository（`SqliteSessionKkvRepository` / `SqliteVfsRevisionRepository` / `SqliteVfsContentStore` / `SqliteMessageCheckpointRepository`），并直接调 `invalidateSessionApiPromptTokenEntry` 与 `scheduleDeferredRevisionOrphanGc`——失效挂点因此散在 service 层而非单一 repository 层。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `createChatServices` / `createProjectService` / `createSessionService` / `createMessageService` / `createUsageStatsService` | `create-chat-services.ts:64/109/114/122/127` | 主装配入口，全部经 `public/chat.ts:304-311` 导出 |
| `ChatServicesOptions.yieldFn` | `create-chat-services.ts:52` | 只透传给 `SqliteMessageRepository`（mobile 传 `createQuantumYield(16)`） |
| `MessageService`（18 方法） | `message.port.ts:18` | 含 `listBySessionFromSeq` / `listBySessionTail` / `listBySessionPage` / `listMessageHeadersBySession` 四个收窄读口 |
| `SessionService` / `ProjectService` / `UsageStatsService` / `MessageTranscriptEffectsService` / `UserVfsTurnService` / `MessageCheckpointService` / `MessageRollbackService` | 各 `*.port.ts` | 端口定义 |
| `createMessageTranscriptEffectsService` | `create-message-transcript-effects.ts:18` | desktop/mobile runtime 各自建一份 |
| `createMessageCheckpointService` / `createMessageRollbackService` | `create-message-checkpoint-services.ts:23/47` | rollback 支持 `probe` / `yieldFn` 注入 |
| `createTruncateTailDepsFromTx` | `truncate-tail-wiring.ts:23` | 纯装配，供 transcript-effects 与 rollback 共用 |
| `RollbackProbe` / `RollbackOptions` | `message-rollback.port.ts:8/22` | mobile `__DEV__` 注入探针 |

## 数据访问

| 表 / 域 | 触点（file:line） | 形态 |
|---|---|---|
| `chat_project` | `project.service.ts:127/145/190/254/257` | insert / update / delete |
| `chat_session` | `session.service.ts:131/168/179/228/350`；`project.service.ts:179` | insert / updateTitle / agent_config_json / delete / deleteByProject |
| `chat_message` | `message.service.ts:193/210/242/274/354/399/421/457/488`；`session.service.ts:382`；`project.service.ts:169` | append / delete / deleteBySession / deleteAfterSeq / batchInsert / updateHidden(Range) / listBySession / listIdsAfterSeq / countBySession |
| `message_checkpoint` | `message.service.ts:253/455/487`；`message-checkpoint.service.ts:56/147`；`create-session-fs-service.ts`（`deleteCheckpointsForSession`） | insertCheckpoint / deleteCheckpointsForMessages / hasCheckpoint |
| `session_kkv` 域 `usage_stats.toolUseCount` | `message.service.ts:113-118`、`message-rollback.service.ts:277-282`；读口 `usage-stats.service.ts:472-476` | 写哨兵空串失效 / 读缓存 + miss 现算回填 |
| `session_kkv` 域 `rule_snapshot` + `file_cache` | `message-transcript-effects.service.ts:159-182` | 置位裸 await 清空（CoordinatedWrite 内，失败不回滚） |
| `session_kkv` 域 `backfill_cursor` | `message.service.ts:249/451/483`；`message-checkpoint.service.ts:108/130` | 删除即清；backfill 确认无空窗才前移 |
| `session_kkv` 域 `prompt_tokens` | 经 `invalidateSessionApiPromptTokenEntry`：`message.service.ts:92`、`message-transcript-effects.service.ts:186`、`message-rollback.service.ts:269`、`session.service.ts:321` | 进程内 Map + KKV 行双删 |
| `session_file_cache_blob` | 无写入；孤儿回收只由 `session.service.ts:197` / `project.service.ts:196` 调度 | 见 F-w2-17 |
| `workplace_dir_rule` / `workplace_file_rule` | **只经 `seedForkCopyParity`（fork/copy）间接写**；`session.service.ts:207-232`、`project.service.ts:149-197` 删除链**完全不碰** | 见 F-w2-06 / F-w2-05 |
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | `message.service.ts:334/240-261`；`session.service.ts:223/366`；`project.service.ts:263-292`；`message-rollback.service.ts:490-565` | copyVfsTree / deleteVfsPrefix / resetHeadToVersion / sweep |
| `llm_saved_model` | `usage-stats.service.ts:83/432` | 模型筛选「其他桶」判定 + 已保存模型清单 |
| `workplace_dir_rule`（project scope） | `project.service.ts:242-299` 复制项目时**未复制** | 见 F-w2-05 |

## 依赖关系

**import（主要）**：`domain/chat/repositories/impl/sqlite-*.repository`、`domain/message-checkpoint/{logic,repositories}`、`domain/vfs/{logic,repositories,content-store}`、`domain/session-kkv/**`、`domain/session-kkv/model/session-kkv-domains`、`domain/chat/logic/{tool-use-count,message-set-floor-range,seed-fork-copy-parity,fork-session-title,editable-text-from-message}`、`infra/{tokenizer/logic/session-api-prompt-token-store,tdbc/logic/template-helper,sql-template}`、`service/{coordinated-write,session-fs,session-kkv,workplace,vfs,template,agent/logic/resolve-agent-for-project}`、`domain/tool/{logic/tool-runner,logic/tool-registry,builtin/register-builtin-tools}`。
注意：import 方向存在 **service → domain-tool → service** 的环（`create-user-vfs-turn-service.ts:13-20` 引入 tool 层，tool 层的 port 又引 service 层），靠 type-only import 断开实例环。

**被谁消费**：
- `createChatServices` / `createMessageService` / `createSessionService` / `createUsageStatsService` → `public/chat.ts:304-311` → desktop `create-desktop-runtime.ts`、mobile `create-mobile-runtime.ts`、cli `runtime.ts`。
- `createMessageTranscriptEffectsService` → desktop `runtime`（`handleMessagesSetFloor` / `handleMessagesTruncateAfter` / `handleMessagesHideRange|ShowRange`）、mobile `runtime`（`useChatTabMessageActions.ts:429`）、core 压缩链 `run-compaction.ts:68` / `hide-message.action.ts:77`。
- `createMessageCheckpointService` → `run-agent-turn.ts:612`（backfill）、agent-runner step 边界 capture。
- `createMessageRollbackService` → `service/session-fs/impl/session-fs.service.ts:28` → desktop `nm:messages/rollback`、mobile 回滚入口。
- `createUserVfsTurnService` → desktop/mobile `user-vfs-turn-execute.service.ts`、mobile `vfs-operations.service.ts`。

---

## 发现清单

### F-w2-01 | P1 | `service/chat/impl/message-transcript-effects.service.ts:63-77`
```ts
  async truncateMessagesAfter(
    projectId: string, sessionId: string, afterSeq: number,
    options?: { sweepRevisions?: boolean }
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), { ... });
    });
  }
```
**描述**：这是第二条 tail 截断路径（第一条是 `message.service.ts:433` 的 `truncateAfter`）。它物理删除 `seq > afterSeq` 的消息，但**既不失效 API prompt 占用（`prompt_tokens` 域 + 进程内 Map），也不失效 `usage_stats.toolUseCount`**。`truncateTailInTransaction`（`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:87-97`）只清 `backfill_cursor` 与 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`。对照 `message.service.ts:490-491`，同语义的 `truncateAfter` 两个失效都做了。
后果：① 截断后重启，落库的旧 `promptTokens` 会被读口按 api 口径（跳掉 0.85 安全垫）继续参与压缩阈值判定；② 被删尾里的 assistant `tool_use` 块不再计入，但弹窗工具调用数继续读陈旧缓存（计数含 hidden，截断后必然变小）。
可达性：desktop `nm:messages/truncateAfter` → `apps/desktop/src/main/ipc/handler-registry.ts:305` 已 `bindReq`，preload 通过 `invoke-registry.ts:376` 暴露给 renderer。**当前 renderer 侧未检索到调用点**（desktop 全量 grep 只命中 client/invoke-registry/handler 三处），即路径暂为「已注册未接线」；一旦 UI 接线即刻变成真缺陷。
**建议**：把两条截断路径的失效收敛到一处——在 `truncateTailInTransaction` 提交后由调用方统一 `await invalidateSessionApiPromptTokenEntry(...)` + 写 toolUseCount 哨兵；或直接让 `truncateMessagesAfter` 内部转调 `MessageService.truncateAfter`。
**置信**：confirmed（代码路径与失效缺口均已逐行核对；UI 可达性为 suspected）。

### F-w2-02 | P2 | `service/chat/impl/message.service.ts:444-445`
```ts
      const all = await this.deps.messages.listBySession(sessionId);
      const ids = all.map((m) => m.id);
```
**描述**：清空整会话（`afterMessageId == null`）时，为了拿一串 id 走**全量 `listBySession`**——SQL 选 `MESSAGE_SELECT_COLUMNS` 全列并对每行 `readRowContent` 解压正文（`sqlite-message.repository.ts:214-232`），大会话上是纯浪费。仓储层已有只投影 id 的 `listIdsAfterSeq(sessionId, afterSeq)`（`message.port.ts:95` / `sqlite-message.repository.ts:457`），传 `afterSeq = 0` 即等价于「全部 id」（seq 从 1 起）。
**建议**：`const ids = await this.deps.messages.listIdsAfterSeq(sessionId, 0);`
**置信**：confirmed。

### F-w2-03 | P2 | `service/chat/impl/message.service.ts:293-303`
```ts
    const all = await this.deps.messages.listBySession(sessionId);
    ...
      const toCopy = all.filter((m) => m.seq <= upTo.seq);
```
**描述**：`fork` 把全会话（含 anchor 之后的整条尾巴）连正文一起解压回来，再丢掉 `seq > upTo.seq` 的部分。仓储层只有 `listBySessionFromSeq`（下界）与 `listBySessionPage`（`seq < beforeSeq` 倒序取页），**没有「seq ≤ N」的上界读口**，所以这是能力缺口而非单纯调用写错。大会话在第 2 条消息处 fork，会把后面几千条正文全部 zlib 解压一遍。
**建议**：补 `listBySessionUpToSeq(sessionId, maxSeq)`（`WHERE seq <= ?` + `mapRows`），fork 改用它。
**置信**：confirmed。

### F-w2-04 | P2 | `service/chat/impl/session.service.ts:374`
```ts
      const messages = await r.messages.listBySession(source.id);
```
**描述**：`copy` 的全量读**发生在写事务内**（`this.deps.conn.transaction(async (tx) => …)`，`session.service.ts:338`），且 `r` 是绑 `tx` 的仓储。也就是「持写锁 + 解压全部消息正文 + batchInsert 全部消息」整段串行。对比同一功能的 `message.service.fork`：它的 `listBySession` 在**事务外**（`message.service.ts:293`），只把 `batchInsert` 放进事务——两个 fork 家族的写法不对称，copy 是明显更差的一支。
**建议**：把 `listBySession` 提到事务外（同 fork 写法），事务内只保留 insert + `seedForkCopyParity`。
**置信**：confirmed。

### F-w2-05 | P2 | `service/chat/impl/project.service.ts:242-299`
```ts
      await copyVfsTree(r.vfs, { scopeKey: `project:${id}` }, "/", { scopeKey: `project:${copy.id}` }, "/", { contentStore });
      await copyVfsTree(r.vfs, { scopeKey: `project:${id}:meta` }, "/", { scopeKey: `project:${copy.id}:meta` }, "/", { contentStore });
      await new SqliteSkillDisabledRuleRepository(tx).copyScopeRules(`project:${id}`, `project:${copy.id}`);
```
**描述**：项目复制搬了 VFS 模板域、meta 域、技能负清单，**唯独没搬 `workplace_dir_rule` / `workplace_file_rule`**。而 project scope 的目录规则是有下游消费的：`initializeSessionWorkspace`（`service/template/logic/initialize-session-workspace.ts:49-53`）在建会话时用 `worktree.copyScope(project scope → session scope)` 把它们播种进新会话。于是「复制出来的项目」再新建会话，目录规则全部退回「无行 = rule_off」（RULE「目录规则」条目），新文件不再被补默认启用行、workplace 前缀裁剪口径与源项目不一致。
对照：`session.copy` / `message.fork` 走 `seedForkCopyParity`（`domain/chat/logic/seed-fork-copy-parity.ts:109`）是有 `copyScope` 的，唯独 project.copy 这条链漏了。
**建议**：`SqliteWorkplaceRepository.copyScope(workplaceScopeKey({kind:"project",projectId:id}), workplaceScopeKey({kind:"project",projectId:copy.id}), identity)`，与 `copyScopeRules` 并列。
**置信**：confirmed。

### F-w2-06 | P2 | `service/chat/impl/session.service.ts:207-232`、`service/chat/impl/project.service.ts:149-197`
```ts
    await r.messages.deleteBySession(session.id);
    await deleteSessionFsData(tx, session.id, session.projectId);
    await createSessionKkvService(tx).clearSession(session.id);
    await createSessionRunStateService(tx).deleteBySession(session.id);
    await deleteVfsPrefix(r.vfs, `session:${session.projectId}:${session.id}`, "/");
```
**描述**：会话删除（及其在项目删除里的 BFS 展开）覆盖了 messages / fs / kkv / run_state / vfs / skills-disabled，唯独**没删 `workplace_dir_rule` / `workplace_file_rule` 中 `scope_key = session:{pid}:{sid}` 的行**。仓储层有现成的 `deleteScope(scopeKey)`（`sqlite-workplace.repository.ts:162`），但全仓唯一调用点是 `copyScope` 内部清目标 scope（`sqlite-workplace.repository.ts:244`）。
后果：每次删会话/删项目，`workplace_dir_rule` 累积孤儿行（`PRIMARY KEY (scope_key, logical_path)`，scope_key 永不复用，所以只是空间与统计噪声，不会串数据）。
**建议**：`deleteSessionTree` 内补 `new SqliteWorkplaceRepository(tx).deleteScope(\`session:${pid}:${sid}\`)`；`project.service.delete` 的循环里对 `project:{id}` 与 `project:{id}:meta` 同样补一条。
**置信**：confirmed。

### F-w2-07 | P2 | `service/chat/impl/message.service.ts:254-261`（触发点）、`service/session-fs/create-session-fs-service.ts`（`deleteSessionFsData` → `sweepSessionRevisions`）
```ts
      await sweepSessionRevisions(
        revisions, entries, checkpoints,
        session.projectId, message.sessionId, tx
      );
```
**描述**：`sweepSessionRevisions` 未传 `options`，默认 `includeGlobalOrphans !== false` → 追加一次 `revisionRepo.deleteGlobalOrphans()`，即**全表 DELETE**（`domain/message-checkpoint/logic/revision-gc.ts:75-82`）。删**一条**消息就走一次全表扫；`project.service.delete` 的 BFS 循环对每个会话各走一次（`project.service.ts:170`），`session.service.delete` 的递归删除对每个子会话各走一次（`session.service.ts:218`）。回滚链已经因为这个原因把全局那半段挪出事务（`deferred-revision-orphan-gc.ts` + `message-rollback.service.ts:246 deferGlobalOrphanGc:true`），删除链没跟上。
**建议**：删除链同样拆两段——事务内只做 scoped，提交后 `scheduleDeferredRevisionOrphanGc(conn)`（已有 in-flight 去重，天然把 N 次折叠成 1 次）。
**置信**：confirmed。

### F-w2-08 | P2 | `service/chat/impl/user-vfs-turn.service.ts:117`（配合 `domain/tool/builtin/vfs-tools.ts:262`）
```ts
          await restoreMutatingPathHeads(toolCtx.vfs, headSnapshots, paths);
```
**描述**：user VFS turn 失败时用 `resetHeadToVersion` / `hardDelete` 把文件拨回起始 head，但**不回滚 `file_cache`**。`write` 工具在写盘成功后无条件 `upsertFileCacheAfterWrite(ctx, logicalPath, input.content)`（`vfs-tools.ts:262` → `:548`），把**新正文**写进 `session_kkv.file_cache.full:{path}`；而 user VFS turn 的 toolCtx 恰好注入了 sessionKkv（`create-user-vfs-turn-service.ts:68`）。`loadOrFillFileCache` 命中即无条件返回、**无 mtime 校验**（`domain/workplace/logic/load-or-fill-file-cache.ts:50-56`，RULE「常驻工作区」条目同款口径），所以这一轮之后该会话的常驻前缀与 hydrate 会一直用**已被回滚掉的正文**。
对比：RULE 里「压缩/置位」与「导入」都显式清了 `file_cache`，唯独这条补偿路径没有。
**建议**：补偿成功后对本轮 `mutatingPaths` 调 `sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE)`（best-effort，与 restore 同 try/catch）。
**置信**：confirmed（机制与代码路径）／suspected（触发需要 write 成功 + 同批另一 tool 失败）。

### F-w2-09 | P2 | `service/chat/impl/message.service.ts:446-458` vs `domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:87-97`
```ts
// message.service.ts（自实现路径）
          await new SqliteSessionKkvRepository(tx).clearDomain(sessionId, SESSION_KKV_DOMAIN_BACKFILL_CURSOR);
          await checkpoints.deleteCheckpointsForMessages(sessionId, ids);
        await messages.deleteBySession(sessionId);
```
**描述**：两条 tail 截断实现对同一件事的清理集合不一致——共享的 `truncateTailInTransaction` 除 `backfill_cursor` 外还清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`（`file_cache` + `user_vfs_pending`，即 composer 状态 chip），`message.service.truncateAfter` **只清游标**、不清 composer 域。同一 UI 动作（删尾巴）走哪条链，chip 行为不同。
另外两处都有的 TOCTOU：id 列表在**事务外**取（`:444` / `:469`），删除在事务内 `deleteBySession` / `deleteAfterSeq`；间隙内新 append 的消息会被删掉、但它的 checkpoint 行不在 ids 里 → 孤儿 checkpoint 行（引用计数不归零，后续 `sweepSessionRevisions` 也救不回来，因为它们仍被 checkpoint 引用）。
**建议**：(a) 让 `truncateAfter` 直接复用 `truncateTailInTransaction`，别再自实现；(b) 若要保留自实现，id 列表改到事务内 `tx` 仓储取。
**置信**：confirmed。

### F-w2-10 | P2 | `service/chat/impl/usage-stats.service.ts:256-272`
```ts
    for (let hour = 0; hour < 24; hour++) {
      const startMs = new Date(year, month, day, hour).getTime();
      const endMs = new Date(year, month, day, hour + 1).getTime();
      const row = startMs < endMs ? await this.queryAggregateRow(startMs, endMs, filter.model, filter.providerId) : ZERO_AGG_ROW;
```
**描述**：`getHourlyBuckets` 串行发 24 条聚合 SQL。同一文件的 `getDailyBuckets` 已经在 `usage-stats.service.ts:205-207` 明确写了「单条 GROUP BY 替代旧实现的逐日 N+1」，日桶收口了、时桶没收口。每次点开某天的小时图 = 24 次全表聚合（`chat_message` 上只有 `idx_chat_message_created_at`，`provider_id/model_name` 无索引）。
**建议**：照日桶写法改成单条 `GROUP BY strftime('%H', created_at_ms/1000, 'unixepoch', 'localtime')`，DST 缺失钟点在 JS 侧补零值桶。
**置信**：confirmed。

### F-w2-11 | P3 | `domain/tool/builtin/builtin-tool-context.ts:174`（声明）、`service/agent/logic/run-agent-turn.ts:851/1200`、`service/chat/create-user-vfs-turn-service.ts:67`（三处装配）
```ts
  /** 列出会话消息（含 hidden，供 chat_grep）。 */
  readonly listSessionMessages: () => Promise<readonly ChatMessage[]>;
```
**描述**：`BuiltinToolContext.listSessionMessages` 是**必填**字段，三处装配各包了一个全量 `listBySession` 闭包，但对 `packages/core/src/domain/tool/**` 全量 grep 后**零消费方**——注释指向的 `chat_grep` 工具已不存在（`format-tool-output.ts:69` 与 `tool-output-limits.ts:2` 只在注释里留了名）。即：每个 toolCtx 都被强制要求提供一个没人会调的「全会话正文（含 hidden）」读口。
**建议**：确认无外部实现依赖后从 `BuiltinToolContext` 摘掉该字段与三处装配；若要保留，至少改成可选（`?`）以免新调用方继续被绑上全量读口。
**置信**：confirmed。

### F-w2-12 | P3 | `service/chat/impl/user-vfs-turn.service.ts:100-125`
```ts
    const failed = outcomes.find((o) => !o.ok);
    if (failed != null) {
      for (let index = outcomes.length - 1; index >= 0; index -= 1) {
        const outcome = outcomes[index]!;
        if (!outcome.ok) { continue; }          // ← 失败 tool 自己的路径不补偿
```
**描述**：补偿只回滚**成功** tool 的突变路径。语义前提是「tool 失败 = 没写盘」，但工具并非原子：例如 `write` 先 `vfs.write` 再 `upsertFileCacheAfterWrite`，若后者抛错，整个 tool 判失败而文件**已经落盘**——这条路径不会被 restore。另 `outcomes.find` 只取第一个失败者作为对外 error，多失败时其余原因被丢弃（`op.tools` 与 `outcomes` 按 index 对齐是对的，`mapWithConcurrency` 保序，见 `tool-runner.ts:35-55`，这点没问题）。
**建议**：补偿集合改为「全部 mutatingPaths ∩ 已捕获快照」而非「成功 tool 的 paths」，或在 tool 边界保证写盘后置动作不抛。
**置信**：suspected（需要构造「写盘成功 + 后置动作失败」才能观测）。

### F-w2-13 | P3 | `service/chat/impl/user-vfs-turn.service.ts:44-62`
```ts
  readonly messages: MessageService;      // ← 无任何说明、也无引用
```
**描述**：`UserVfsTurnServiceDeps` 里 `sessionKkv` / `chatMessages` / `messageCheckpoint` 三项在 docstring 里明确写了「历史 / 保留以便工厂签名稳定」（`@deprecated`），属有意保留；`messages: MessageService` 则**既无说明也无任何引用**（`executeOp` 全程未用）。`create-user-vfs-turn-service.ts:42-49` 为此还专门 new 了一个 `DefaultMessageService`（连带 5 个 repository）注入进来。
**建议**：删掉 `messages` 依赖与工厂里的 `DefaultMessageService` 构造；另三项按「有意保留」处理（若将来无外部签名依赖可一并删）。
**置信**：confirmed（无引用）／intentional（另三项，出处见各自 docstring）。

### F-w2-14 | P3 | `service/chat/impl/message-transcript-effects.service.ts:105-108`
```ts
    const tail = await this.deps.messages.listBySessionTail(sessionId, { limit: 1 });
    const sessionMaxSeq = tail.length > 0 ? tail[0]!.seq : 0;
```
**描述**：模块头已把「原先全量 listBySession 大会话连解压秒级」治本掉了（`:84-86`），但换上的 `listBySessionTail` 底层仍选 `MESSAGE_SELECT_COLUMNS` 全列（`sqlite-message.repository.ts:300-320`），为拿一个 `seq` 照样解压了最后一条消息的完整正文。已有更轻的 `listMessageHeadersBySession`（不选 content 列）。
**建议**：要么给仓储加一个 `maxSeq(sessionId)`，要么改用 `listMessageHeadersBySession` + 取末行。
**置信**：confirmed。

### F-w2-15 | P3 | `service/chat/impl/message-transcript-effects.service.ts:121-157`
```ts
        rollback: async () => {
          await this.deps.messages.showRange(sessionId, hidePrefix.fromSeq, hidePrefix.toSeq);
        },
```
**描述**：置位 hide 前缀时，CoordinatedWrite 的补偿是「把同一区间整段 show 回来」。但区间里**本来就有一部分是 hidden 的**（压缩/上次置位的残留）——一旦后续步骤（`clear-rule-snapshot` / `clear-file-cache`）抛错触发回滚，这批原本就不可见的消息会被错误地 unhide，可见性与操作前不一致。RULE 只保证「回滚不改变可见性」，set-floor 的补偿路径没做同样的区分。
**建议**：补偿前先读一次区间内 hidden 分布（或改用增量补偿：只 show 本次实际 flip 的行）。
**置信**：suspected（需要 `clearDomain` 抛错才能触发；SQL 正常时不会）。

### F-w2-16 | P3 | `service/chat/impl/session.service.ts:190-198`、`service/chat/impl/project.service.ts:149-197`
**描述**：删会话 / 删项目走了 `createSessionKkvService(tx).clearSession(sessionId)`（清空该 session 全部 KKV 行，含 `prompt_tokens`），但**没有清进程内热层** `sessionApiPromptTokenCache`——那个 Map 只在 `invalidateSessionApiPromptTokenEntry` 里 delete（`infra/tokenizer/logic/session-api-prompt-token-cache.ts:43`）。同族的 `token_chunks` / `stream_metrics` 域也只在 `clearSession` 侧清。
后果：删掉的 sessionId 在 Map 里留一条常驻条目（uuid 不复用，无正确性风险，纯内存驻留）。
**建议**：`deleteSessionTree` 内对每个 sessionId 补 `sessionApiPromptTokenCache.invalidate(session.id)`。
**置信**：confirmed。

### F-w2-17 | P3 | `service/chat/impl/message-transcript-effects.service.ts:171-182`
```ts
    write.register({
      name: "clear-file-cache",
      execute: async () => { await this.deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE); },
```
**描述**：`clearDomain(file_cache)` 只删 `session_file_cache_entry` 引用行，`session_file_cache_blob` 里的正文 blob 变成孤儿。回收器 `runDeferredFileCacheGc` 是**全表** DELETE（`domain/session-kkv/logic/deferred-file-cache-gc.ts:36`），全仓只有 `session.service.ts:197` / `project.service.ts:196`（删会话/删项目）内联 await，另有 `infra/db-maintenance` 的启动维护兜底。置位、压缩、导入三条清缓存路径都不调度它——频繁置位会让 blob 表单调增长。
**建议**：置位成功提交后 `await runDeferredFileCacheGc(conn)`（或统一挂到已有的 deferred 调度上）。
**置信**：confirmed。

### F-w2-18 | P3 | `service/chat/create-user-vfs-turn-service.ts:2,25,31,101`
```ts
 * 鐢ㄦ埛 VFS U-A-U-A 鏈嶅姟宸ュ巶銆?
```
**描述**：该文件的中文注释是 **GBK→UTF-8 双重编码的乱码**（文件里真的写着 `鐢ㄦ埛` 这几个码位，不是终端显示问题——已按字节核对：偏移 9 起为 `E9 90 A2 E3 84 A6 E5 9F 8B` = U+9422/U+3126/U+57BB）。全 `packages/core/src` 扫描（脚本逐文件统计高频乱码码位）只此 1 个文件命中，core 其余中文注释均为正常 UTF-8。
**建议**：用专用编辑工具按正确文案重写这 4 处 docstring（`用户 VFS U-A-U-A 服务工厂。` / `createUserVfsTurnServiceBundle 返回值。` / `创建用户 VFS turn 服务与补贴 append 包装（共享连接与 repo）。` / `创建 {@link UserVfsTurnService} 实例。`），勿用 PowerShell 管道改写。
**置信**：confirmed。

### F-w2-19 | P3 | `service/chat/impl/message.service.ts:479-489`
```ts
    await this.deps.conn.transaction(async (tx) => {
      const messages = new SqliteMessageRepository(tx);
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      await new SqliteSessionKkvRepository(tx).clearDomain(sessionId, SESSION_KKV_DOMAIN_BACKFILL_CURSOR);
      await checkpoints.deleteCheckpointsForMessages(sessionId, tailIds);
      await messages.deleteAfterSeq(sessionId, anchor.seq);
    });
```
**描述**：`truncateAfter` 删掉 tail 的 checkpoint 引用后**不做 revision 打扫**（对比同文件 `delete()` 走 `sweepSessionRevisions`、共享的 `truncateTailInTransaction` 有 `sweepRevisions` 开关）。这条路径是 agent abort 回滚的落点（`chat-agent-session.ts:58` → `truncateAfterMessage`），频繁 abort 会持续产生 `ref_count <= 0` 的 revision 行，只能等下一次删除链或启动维护的全表 GC 顺带收。
**建议**：与回滚一致，`sweepRevisions: true` + `deferGlobalOrphanGc` 拆两段。
**置信**：confirmed。

### F-w2-20 | P3 | `service/message-checkpoint/impl/message-rollback.service.ts:164 / 435 / 493`
```ts
      const liveHeads = await listSessionFileHeads(this.deps.entries, projectId, sessionId);   // :164 S-13 护栏
        const liveHeads = await listSessionFileHeads(this.deps.entries, projectId, sessionId); // :435 tail pointer 反解
      const liveHeadRows = await listSessionFileHeads(entries, projectId, sessionId);          // :493 reconcile
```
**描述**：一次 `rollbackToMessage` 最多对同一 session scope 做 3 次全量文件 head 扫描，且 2 次在事务外（`:164`、`:435`），1 次在事务内持锁（`:493`）。`listSessionFileHeads` 的结果在同一次 plan 内完全可复用（文件树在 plan 解析到事务开始之间由 A-22 计数乐观锁兜底）。
**建议**：plan 阶段扫一次存进 `RollbackPlan`，`:435` 与 `:493` 复用；`:164` 的 S-13 护栏只在「空 targetTree + live 非空」时才需要扫，可挪到判定之后。
**置信**：confirmed。

---

## 争议与存疑

1. **F-w2-01 的现实严重度**：`nm:messages/truncateAfter` 这条 IPC 已注册并暴露，但 desktop renderer 侧**搜不到任何调用点**（`transcript-selectable-role.ts` 只 re-export 了 `tailBatchDeleteAfterSeq` 纯函数，没有接到 IPC）。因此「两条截断路径失效口径分叉」目前是**已注册未接线的潜伏缺陷**，而不是正在发错的生产 bug。若 W3 的 IPC 双侧机位查到 renderer 侧有动态/间接调用（我 grep 的是字面量 `truncateAfter`，理论上 `invoke(channel, payload)` 泛型调用形式可能漏检），请把它上调到 P0/P1 并补 mobile 侧（mobile runtime 暴露了 `messageTranscriptEffects`，但同样未见 truncate 调用）。

2. **F-w2-05 / F-w2-06 的范围归属**：`workplace_dir_rule` 的表定义与 repository 在 `domain/workplace/`，但**调用缺口在 service/chat 的两个服务里**。若 W2 的 `core-service-vfs` 或 `core-small` 机位也声称覆盖了这两处，请以本报告的 file:line 为准去重，不要各报一条。

3. **`message.append` 不失效 API prompt 占用**（`message.service.ts:211-218`）：与其它所有改动路径的口径相反，但注释写明是 **2026-09-29 真机复验拍板**（统计优先口径，纯追加由读口「基线 + anchorSeq 增量估算」覆盖，失效反而让 run 起步跌回估算档）。按决策感知纪律标 **intentional**，不计入问题。同理 `usage_stats` 域注释里点名的「hide/show 不失效（含 hidden 口径下可见性不改计数）」也是有意设计。

4. **`fork` / `copy` 不复制 `session_kkv`**（`message.service.ts:318`、`session.service.ts:351`）：SPEC 明写「fork/copy 不复制 kkv」，且 fork 出的新会话 `toolUseCount` 天然 miss 重算，**正确**，标 intentional。同理「不复制 `composer_draft_json`」是「维持现状」的有意留白。

5. **回滚乐观锁用 `COUNT(*)` 而非内容指纹**（`message-rollback.service.ts:204-216` + `:96` 的 `messageCountSnapshot` 注释）：能挡住「追加」不能挡住「编辑」（`updateContent` 不改行数），属 A-22 明确记录的取舍（重试上限 3 次、冲突仍持续则报 `ROLLBACK_CONFLICT`）。我倾向标 intentional 而非缺陷，但这是产品语义判断，请主代理裁决是否要升级为「编辑也纳入乐观锁」。

6. **F-w2-12（失败 tool 自身写盘不回补）** 我只做到静态推断，没有构造出真实触发用例（需要「写盘成功 + 后置动作抛错」的 tool）。W6 逐条验证时若能构造出来，这条应从 P3 升到 P2。

7. **跨区观察（不在本区 file:line 责任范围，仅点名供其它机位核对）**：
   - `packages/core/src/domain/tool/builtin/subagent-tool.ts:219` 为「取子代理末条 assistant 文本」而 `listBySession(childSessionId)` 全量拉回——`listBySessionTail(limit: N)` 即可，属同一族「全量 `listBySession` 残留」，W1 已知三处之外的一个候选。
   - `packages/core/src/service/agent/logic/run-agent-turn.ts:851/1200` 与 `logic/assemble-agent-runner-deps.ts:67` 三处 `listBySession` **未带 `includeHidden:false`**（对比 `chat-agent-session.ts:35` 已收窄）。前两处喂的是 F-w2-11 的死字段；`listAllSessionMessages` 只在 `agent-runner.ts:587` 的 gemini `toolUseLookup` 分支消费。这三条属 core-agent 机位责任区，此处仅作交叉提示。
