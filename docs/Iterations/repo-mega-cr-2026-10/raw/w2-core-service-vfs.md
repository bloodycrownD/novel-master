---
zone: core-service-vfs
agent: domain-survey
files_scanned: 74
---

## 摘要

`packages/core/src/service/` 下 12 个子域的应用服务层（VFS 读写与导入导出、workplace 规则与常驻前缀拼装、skills、kkv/session-kkv、persistent-preferences/state、smart-sort-rule、template 拉推、compaction-conditions、prompt 渲染、provider 服务），共 74 个 .ts / 约 7.0k 行。整体注释密度高、WHY 充分、跨资源写普遍走 CoordinatedWrite 或事务。**无 P0**。主要问题：template pull/push 不清 `rule_snapshot`/`file_cache`（与导入缓存对齐口径矛盾）、smart-sort 规则导入/重置非事务（中途失败=内置规则全灭）、LLM 重试会重放已发出的流事件、vfs-batch-io 绕过 revision 层直接写 entry。

## 职责与边界

- **`vfs/`**：core 内部 `InternalVfsService`（scopeKey + 纯逻辑路径）→ `DefaultVfsService`（纯 repo 委托）→ `RevisionAwareVfsService`（写路径补 `vfs_revision` + ref_count + 墓碑）三层；`ScopedVfsService` 把 scope 藏在内部；`DefaultPhysicalVfsService` 只读物理树（global/project/session + 两个 meta 域拼装，类型层面无写方法）；ZIP / 角色卡导入导出（事务内子树替换）、批量 ingest/export（plan + apply）、`build-user-vfs-turn-op`（UI 操作 → tool turn op）、`clear-session-prompt-caches`（导入后缓存对齐）、`ensure-import-dir-rules`（导入事务内补目录规则默认行）。
- **`workplace/`**：目录/文件规则 CRUD、评估视图与三种物化产物（live listRows / persist block / filetree 宏树）、conn 级 L1 memo 缓存（读时校验 + inFlight 去重）、`assemble-workplace-display`（常驻前缀唯一包裹出口，含 shouldStop 中止点与 fingerprint）、`refresh-rule-snapshot`。
- **`kkv/` `session-kkv/`**：全局 KKV（module 级，get 抛 NOT_FOUND）与会话 KKV（sessionId×domain×key，get 返回 null）两套薄委托；`persistent-preferences`（`nm-preferences` 行为偏好）与 `persistent-state`（`nm-workspace-state` CLI/工作区指针）建在其上。
- **`skills/`**：两域（global-meta / project-meta）技能清单、读写、启停、改名、删除、保留名门。
- **`smart-sort-rule/`**：智能排序规则 CRUD/启停/调序/导入导出/重置默认/预览/预编译。
- **`template/`**：project→session 初始化（拉）与 session→project 覆盖（推），VFS 子树替换 + workplace 规则 copyScope + 延迟 blob GC。
- **`compaction-conditions/`**：压缩条件 KKV 存储（v2→v3→v4 迁移）、OR 触发器评估器、`run-compaction` + `hide-message.action`（头投影 + 窗口内补拉全量行）。
- **`prompt/`**：三区 layout 单次遍历（预览分段 / LLM 输入 / CLI 文本）、thinking 上下文剥离、orphan tool_result/tool_use 归一、LLM zone 边界计算。
- **`provider/`**：provider CRUD（CoordinatedWrite 跨 secretStore+DB）、suggestion/saved-model 服务、模型请求服务（含重试策略）、重试策略 KKV 存储。

**边界**：本区是「服务编排层」——不写 SQL（除个别 `new Sqlite*Repository(tx)` 组合），不持有跨服务状态；唯一自持状态是 workplace 的 conn 级 WeakMap 缓存与 `build-user-vfs-turn-op` 的模块级 `toolIdSeq`。

## 对外接口

- `public/vfs.ts` / `public/workplace.ts` 等 re-export：`createVfsService` / `createScopedVfsService` / `createPhysicalVfsService` / `createVfsBatchIoService` / `createVfsZipIoService` / `createCharacterCardImportService` / `createWorkplaceService` / `assembleWorkplaceDisplay` / `refreshRuleSnapshot` / `createSkillsService` / `createSessionKkvService` / `createKkvService`（`service/kkv` 子路径）/ `createPersistentPreferences` / `createPersistentState` / `createSmartSortRuleService` / `createTemplatePullService` / `createCompactionConditionsStore` / `createProviderServices` / `createModelRetryPolicyService`。
- 端口：`WorkplaceService`（含 `materialize()`/`renderDisplay()` 两个 `@deprecated`）、`VfsService`（domain 契约 re-export）、`InternalVfsService`（core 内部，不进 public）、`PhysicalVfsService`（只读）、`SkillService`、`KkvService`、`SessionKkvService`、`SmartSortRuleService`、`TemplatePullService`、`CompactionConditionsStore`、`ProviderService` / `ProviderModelService` / `ModelRequestService` / `ModelRetryPolicyService`。
- 纯函数：`buildPromptLlmInputFromLayout` / `buildPromptAssemblyFromLayout` / `buildPromptPreviewSegmentsFromLayout` / `formatPromptLlmInputForCliFromLayout` / `computeLlmExportZonesFromLayout` / `applyThinkingContextForLlm` / `normalizeOrphanToolResultsForLlm` / `resolvePreviewThinkingContext` / `runCompaction` / `matchGlob` / `clearSessionPromptCaches` / `ensureImportDirRules` / `backfillMissingDirRules` / `buildDefaultDirRule`。

## 数据访问

- **表**（全部经 repository，无裸 SQL）：
  - `vfs_entry` / `vfs_revision` / `vfs_content_blob`：`impl/revision-aware-vfs.service.ts:87-96`（write 在事务内 `new SqliteVfsEntryRepository(tx)` + `SqliteVfsRevisionRepository(tx)`）、`:145-155`（delete）、`:164-211`（resetHeadToVersion + `transferLiveRef`/`adjustRef`）、`:224-254`（hardDelete + sweep）、`:448-484`（`appendDeletedRevisionsForSubtree` 批量墓碑）、`:405-412`（`nextVersionFor` = max(head, MAX)+1）。
  - `vfs_entry`（批量导入，**绕过 revision**）：`impl/vfs-batch-io.service.ts:84-102` `writeOrUpdateFile` 直调 `repo.insert/update`，注释 `:100` 写「无 revision 层：不写 vfs_revision 行」→ 见 F-core-service-vfs-04。
  - `vfs_entry` + `vfs_revision` + `chat_message` + `message_checkpoint`（session scope 导入事务内补 baseline）：`impl/vfs-zip-io.service.ts:199-244`、`impl/character-card-import.service.ts:140-182`。
  - `workplace_dir_rule` / `workplace_file_rule`：`impl/workplace.service.ts:154,168,174,184,198`；签名采样 `:317-318`、上下文加载 `:350-351`。
  - `smart_sort_rule`：`impl/smart-sort-rule.service.ts:67,88,116,129,145,159,201,224,246-249,263-279,380`。
  - `llm_provider` / `llm_saved_model` / model suggestion：`impl/provider.service.ts:52,110,201,232,243,254`；`impl/provider-model.service.ts:68,84,92,119,164,181,235`。
  - `chat_project` / `chat_session`（物理树虚拟目录合成）：`impl/physical-vfs.service.ts:137,191,250,307,336,441,508,538`。
- **KKV 模块（非 session）**：`nm-preferences`（`persistent-preferences/impl/preference-keys.ts:8`，键 `chat.llmStream` / `chat.subagentStream` / `chat.thinkingContext` / `vfs.userVfsUnifiedToolTurn`）、`nm-workspace-state`（`persistent-state/impl/workspace-state-keys.ts:8`，键 `currentProjectId` / `currentSessionId` / `currentProviderId` / `currentModelId` / `currentAgentId`）、`nm-compaction-conditions`（键 `policy`，`compaction-conditions-store.service.ts:19-20`）、`nm-model-retry`（键 `policy`，`model-retry-policy.service.ts:17-18`）、`nm-search` 建议清单（`create-provider-services.ts:41`）。
- **session KKV 域**：`rule_snapshot`（`RULE_SNAPSHOT_CANON_KEY`）+ `file_cache`（经 `fileCacheKey(status,path)`）→ `workplace/assemble-workplace-display.ts:153-171`（`getMany` 批量预取）、`workplace/refresh-rule-snapshot.ts:35-41`（写快照 + clearDomain(file_cache)）、`vfs/logic/clear-session-prompt-caches.ts:34-47`（清两域 + 失效 API prompt token + 写 `usage_stats.toolUseCount` 空串哨兵）。
- **SKSP SecretStore**：`provider.service.ts:98,101,133,176,181,185,191,226,263,269`（create secret 先于 insert、edit/delete 捕获原值补偿）、`provider-model.service.ts:72,182`。
- **VFS 文件路径**（非表）：无；`/tmp/` 落盘等在 `domain/tool` 侧。

## 依赖关系

**import（出向）**
- → `domain/vfs/**`（path-mapper / ensure-parent-dirs / vfs-tree-copy / vfs-rename-primitive / seed-live-head-revisions / revision-ref-count / vfs-zip-* / normalize-path / vfs-batch-path / validate-entry-name / content-store）
- → `domain/workplace/**`（rule-engine / rule-snapshot-codec / load-or-fill-file-cache / workplace-display / workplace-scope / workplace-tree / default-dir-rule / smart-sort）
- → `domain/chat/**`（message repo + checkpoint repo 供 baseline 补种；`prepare-user-messages-for-prompt` 的 `normalizePromptSeenPath`）、`domain/message-checkpoint/**`、`domain/session-kkv/model/session-kkv-domains.ts`、`domain/smart-sort-rule/**`、`domain/skills/**`、`domain/character-card/**`、`domain/provider/**`、`domain/depth/logic/**`、`domain/compaction-conditions/**`
- → `infra/tdbc/**`（`TdbcConnection` / `TdbcError`）、`infra/tokenizer/logic/session-api-prompt-token-store.js`、`infra/llm-protocol/**`（adapter registry / normalizeBaseUrl / request-abort / LlmStreamTimeoutError）、`infra/sksp/**`、`infra/serialization/decode.js`、`infra/random-uuid.js`、`infra/kkv-value-codec.js`
- → `service/**` 横向：`service/session-kkv/create-session-kkv-service.js`、`service/kkv/create-kkv-service.js`、`service/smart-sort-rule/create-smart-sort-rule.service.js`、`service/vfs/create-scoped-vfs-service.js`、`service/compaction-conditions/hide-message.action.js`、`service/chat/message.port.js`、`service/chat/message-transcript-effects.port.js`、`service/chat/user-vfs-turn.port.js`、`service/session-fs/create-session-fs-service.js`、`service/coordinated-write.js`、`service/provider/*`

**被谁消费（入向，主要）**
- `createWorkplaceService`：三端 runtime（`apps/cli/src/runtime.ts:265`、`apps/desktop/src/main/runtime/create-desktop-runtime.ts:191`、`apps/mobile/src/runtime/create-mobile-runtime.ts:188`）→ agent-runner（`service/agent/impl/agent-runner.ts:393`，**已提升到 step 循环外**，见 intentional 清单）、`run-agent-turn.ts:855,1205`、`service/chat/create-user-vfs-turn-service.ts:71`、双端 UI/CLI 若干。
- `assembleWorkplaceDisplay`：`agent-runner.ts:423`、`apps/desktop/src/main/services/session-prompt-input.service.ts:100`、`apps/mobile/src/services/session-prompt-input.service.ts:117`、`apps/mobile/src/services/workplace-block.service.ts:25`、`apps/cli/src/prompt/commands.ts:140`、`apps/cli/src/workplace/run-workplace.ts:139`。
- `computeLlmExportZonesFromLayout` / `buildPromptLlmInputFromLayout`：`agent-runner.ts:553`（zones → `normalizeForLlmExport`）、`public/prompt.ts:48`。
- `DefaultModelRequestService`：`agent-runner.ts:628`（每个 step）、`apps/cli/src/model/commands.ts:89,106`。
- `clearSessionPromptCaches`：仅 `impl/vfs-zip-io.service.ts:259` 与 `impl/character-card-import.service.ts:197`。
- `DefaultTemplatePullService`：`service/chat/impl/session.service.ts:236,243`（pullTemplate / pushTemplate）。
- `runCompaction`：`agent-runner.ts:540`。
- `SmartSortRuleService.importRules`：`apps/cli/src/sort-rule/commands.ts:184`、`apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts:171`、双端 yaml service。

## 发现清单

### F-core-service-vfs-01 | P1 | `packages/core/src/service/template/impl/template-pull.service.ts:24-36`
```
  async sessionTemplatePull(sessionId: string): Promise<void> {
    ...
    await this.conn.transaction(async (tx) => {
      await initializeSessionWorkspace(tx, session.projectId, sessionId, { clearCheckpoints: true });
```
`initializeSessionWorkspace` 把 project 模板整树覆盖进 session 域（`logic/initialize-session-workspace.ts:37-53`：`replaceVfsSubtree` + workplace 规则 `copyScope`），但整条链**没有**调用 `clearSessionPromptCaches`、也没有清 `rule_snapshot` / `file_cache`。这正是 RULE「导入缓存对齐（session 导入三件套）」所描述的必做副作用（角色卡导入 `character-card-import.service.ts:197` 与 ZIP 导入 `vfs-zip-io.service.ts:259` 都做了）。后果：拉取模板后，该 session 的规则快照仍描述**旧树**的文件集、`file_cache` 仍持旧正文，下一轮提示词组装出的 `<workplace>` 前缀会继续呈现已删除的文件、并可能对已不存在的路径报 NOT_FOUND；且快照空数组的「首次空快照」保护（`assemble-workplace-display.ts:225`）也不适用。push 方向（`:38-49`）改的是 project 域、不影响 session KKV，风险低但同样缺清理。
**建议**：`sessionTemplatePull` 事务提交后 `await clearSessionPromptCaches(sessionId, createSessionKkvService(this.conn))`（best-effort 口径与导入一致）；或明确在 RULE 里写「模板拉取不清缓存」并给出理由。
**置信**：confirmed（调用方全量 grep 确认只有 `session.service.ts:236`；两条导入链都清了、模板链没清）。

### F-core-service-vfs-02 | P1 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249`
```
    await this.deps.rules.deleteAll();
    for (const entity of entities) {
      await this.deps.rules.insert(entity);
    }
```
`importRules`（替换式导入，含**内置规则**）是「先全表删、再逐条插」，**全程无事务**（`git grep -n transaction -- packages/core/src/{service,domain}/smart-sort-rule` 零命中）。第 3 条 insert 抛错（CHECK 约束、磁盘满、并发写）即留下「表被清空 + 只灌回前两条」的状态：内置智能排序规则全灭，文件树排序静默退化为自然排序，且用户从 UI 看不出发生了部分导入。`resetDefaults`（`:253-288`，删 builtin → 插 4 条 seed → renumber）与 `deleteBatch`（`:132-147`）/ `setEnabledBatch`（`:163-170`）同样是逐条无事务的复合写。
**建议**：把 `importRules` / `resetDefaults` 的 delete+insert 收进 `conn.transaction`，并把 `deleteBatch` / `setEnabledBatch` 的多行 UPDATE 批量化（`SqliteSmartSortRuleRepository` 增 `upsertMany` / `deleteMany`）。
**置信**：confirmed（代码事实）；对「实际发生概率」保持 suspected——校验已在 deleteAll 前跑完，insert 失败概率低但非零，且失败后果不可自愈（无启动期一致性检查）。

### F-core-service-vfs-03 | P2 | `packages/core/src/service/provider/impl/model-request.service.ts:81-84`
```
  if (!(error instanceof ProviderError)) {
    // Unknown transport/runtime failures are treated as transient once.
    return true;
  }
```
重试循环（`:211-243`）在同一个 `onStream` 回调上重放 `adapter.chat`。`llm-sse-transport.ts:679-681` 把流中失败**原样 reject**（如 fetch reader 的 `TypeError: network error`），这类错误落进上面的「非 ProviderError → 可重试」分支 → 自动重试。此时第一次尝试已经通过 `onStream` 发出的 `text-delta` / `tool_use` 事件已被 `agent-runner.ts:613-623` 转发进 run 事件总线，重试会**再发一遍完整内容**：UI 出现重复段落；若第一次已发出完整 `tool_use` 而流在 tool_result 前断掉，重试后同 id 的工具调用可能被执行两次。对比：`LlmStreamTimeoutError` 分支（`:78-80`）明确按 `phase === "first-chunk"` 区分「已有部分输出不重试」，说明这个风险已被意识到，但只覆盖了超时一条路径。
**建议**：在 service 层加「本次 attempt 是否已派发过流事件」的闸门（`onStream` 包一层计数），已派发即不再重试；或把流中失败统一收敛成一个不可重试的错误类型（带 `phase` 语义）。
**置信**：suspected —— 「重复输出」这一后果取决于 `agent-runner` 对第二次 `text-delta` 的累加/去重行为，我未逐行验证 runner 的文本累加路径；建议 W6 验证代理确认后升级为 P1。

### F-core-service-vfs-04 | P2 | `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:100`
```
  // 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义
  await repo.update(sk, logical, content, existing.version + 1);
```
该注释的前提已经过时：`vfs_revision` 层**存在**且是回滚/checkpoint 的真源（`revision-aware-vfs.service.ts` 全文、`RULE`「VFS 写入走版本链配合 checkpoint 回滚」）。所有其他批量写入路径都显式补种 revision——`insertFileSeedingRevision`（ZIP 导入 `vfs-zip-io.service.ts:214`、角色卡 `character-card-import.service.ts:151`）与 `replaceVfsSubtree`（模板拉推）——唯独 batch-io 的 create 与 update 两条路径都只写 `vfs_entry`。后果：经「从主机路径批量导入」写进 session 域的文件没有 revision 行，`resetHeadToVersion`（`revision-aware-vfs.service.ts:180-187` 查不到 revision 即抛 NOT_FOUND）与 ref_count 统计（`deleteUnreferencedUnderScope` 的 sweep 口径）对该批文件不成立。生产可达：`apps/desktop/src/main/services/vfs-batch.service.ts:220` 在非「unified tool turn」分支直接调 `applyBatchIngest`。
**建议**：`writeOrUpdateFile` 改走 `insertFileSeedingRevision`（create）或复用 `RevisionAwareVfsService` 的 `writeWithRevision` 语义（update），并删除过时注释。
**置信**：confirmed（`grep vfs_revision` 在 `sqlite-vfs-entry.repository.ts` 零命中，证明 repo.insert/update 不写 revision）。

### F-core-service-vfs-05 | P2 | `packages/core/src/service/prompt/render-prompt.ts:80-83`
```
  const persistCount =
    (options?.skillsIndex?.length ? 1 : 0) +
    (injectWorkplace ? 2 : 0) +
    (layout.persistEnabled === true ? textBlockCount : 0);
```
`computeLlmExportZonesFromLayout` 只判 `skillsIndex?.length`，**没有** `layout.skillsEnabled` 判据；而实际产出消息的 `buildPromptLlmInputFromLayout:358-359` 与 `buildPromptAssemblyFromLayout:281` 都判了 `layout.skillsEnabled !== false`。两者是同一组谓词的两份平行实现（`injectWorkplace` 也是），任一漂移都会让 `normalizeForLlmExport` 拿错三区边界。`skillsEnabled === false && ctx.skillsIndex 非空` 时 zone 多算 1 条 persist 消息 → 后续消息分区整体偏移。当前不会发生：`run-agent-turn.ts:817` 的 `assembleSkillsToolContext` 以 registry 为闸门，skill 工具被摘时 `skillsIndex` 为空——但 `render-prompt.ts:279-280` 的注释恰恰把这个场景（「ctx 直接携带 skillsIndex 也不注入」）当作需要防御的，说明作者认为它可能成立。
**建议**：把「是否注入 skills 索引 / workplace 双段」抽成一个共享判据函数，三处共用；`computeLlmExportZonesFromLayout` 直接接收已算好的 `injectSkills` 布尔。
**置信**：confirmed（代码差异）；影响为 latent（上游 gate 挡住），标 suspected。

### F-core-service-vfs-06 | P2 | `packages/core/src/service/vfs/impl/vfs.service.ts:111-133`
```
  async write(scopeKey, path, content) {
    ...
    return this.repo.update(scopeKey, normalized, content, existing.version + 1);
```
`DefaultVfsService` 的 `write` / `replace` / `delete` / `resetHeadToVersion` / `hardDelete` / `renamePath` / `renamePrefix` 七个方法在生产装配下**全部不可达**：`create-vfs-service.ts:23-24` 与 `create-scoped-vfs-service.ts:26-30` 都把它包进 `RevisionAwareVfsService`，而装饰器这七个方法全部自己实现、不委托 inner（只有 `list`/`mkdir`/`read`/`findContentSize`/`glob`/`grep` 委托）。留下的是一份**语义已经漂移**的影子实现：这里的版本号是 `head + 1`，生产链路是 `max(head, MAX(vfs_revision.version)) + 1`（`revision-aware-vfs.service.ts:405-412`，head 回拨后必须越过历史占号段）；这里的 `resetHeadToVersion` 抛 unsupported、那里是完整实现。测试 `packages/core/test/vfs/default-vfs.service.test.ts` 直连 `DefaultVfsService` 跑的是**旧语义**。
**建议**：把 `DefaultVfsService` 收窄为只实现委托型 6 个方法（其余从接口移除或在类型上标 `@internal`），版本分配口径只保留 `revision-aware` 一份；或让装饰器把未被覆写的方法显式转发，避免两份 write 语义长期共存。
**置信**：confirmed。

### F-core-service-vfs-07 | P2 | `docs/apm/RULE.md:16` vs `packages/core/src/service/compaction-conditions/run-compaction.ts:12-18`
```
// **不再清 `rule_snapshot` + `file_cache`**（历史行为，自置位照搬）：压缩只
// 改消息可见性，不改文件内容与规则……
```
RULE「压缩」条目仍写「副作用：清 `rule_snapshot` + `file_cache`」，并把「与置位同款」当口径；代码已于 2026-09-29 按用户拍板「压缩与文件缓存无关」推翻（理由：压缩发生在 agent 回合中段，清缓存破坏「前缀回合内冻结」不变量）。RULE 同一节的「置位」条目（:15）与「导入缓存对齐」条目（:17）仍然正确，唯独压缩这条过期。这条 RULE 是后续所有 CR / 改动代理的决策依据，会系统性地把「压缩要不要清缓存」判错。
**建议**：更新 RULE.md:16，删掉「清 `rule_snapshot` + `file_cache`」，改写为 2026-09-29 的口径与理由（回合内冻结不变量）。
**置信**：confirmed（两处原文均在手；已确认全 `docs/apm/**` 无其他条目覆盖）。

### F-core-service-vfs-08 | P2 | `docs/apm/RULE.md:29` vs `packages/core/src/service/skills/impl/skills.service.ts:368`
```
    // write 对不存在的文件会自动补父目录——新建技能即向新目录写 SKILL.md。
    // 版本比对已从 VFS 底层移除：last-write-wins。
```
RULE「技能域与内置技能」条目写「编辑已存在技能走 VFS 乐观锁——保存须透传 read 时拿到的 version（`writeSkillFile` 的 `expectedVersion`），否则必撞 CONFLICT」，但 `writeSkillFile` 签名里**没有** `expectedVersion` 参数（`skills.port.ts` / `impl/skills.service.ts:346-353`），代码与 RULE 另一条「VFS write/edit/skill 工具的并发语义（无锁）」一致（2026-09-06 拍板全拆乐观锁）。同一份 RULE 内部两条条目自相矛盾。
**建议**：修 RULE.md:29，删除乐观锁/`expectedVersion` 描述，改引「VFS 并发语义」条目。
**置信**：confirmed。

### F-core-service-vfs-09 | P3 | `packages/core/src/service/persistent-state/impl/persistent-state.service.ts:96-98`
```
  resetCurrentModelId(): Promise<void> {
    return this.reset(KEY_CURRENT_MODEL_ID);
  }
```
`setCurrentModelId` / `setCurrentAgentId` 走 `setAndInvalidatePromptTokenCache`（`:133-142`，双删进程内热层 + `prompt_tokens` KKV 行），但 `resetCurrentModelId` / `resetCurrentAgentId` 只 `reset`，**不失效** API prompt 占用。复位意味着「不再有当前模型 / 当前 agent」，此时残留的按 api 口径的旧占用会在重启后被读回并参与阈值判定（正是该函数注释里描述的危害）。同类不对称：`setCurrentModelId` 会 trim + UUID 校验（`:77-92`），`setCurrentAgentId` 不做任何校验也不 trim。
**建议**：两个 reset 复用 `setAndInvalidatePromptTokenCache` 的失效步骤（delete 后再 invalidate）。
**置信**：suspected（reset 的实际调用方可能都在无 prompt 缓存的上下文中，未 grep 全调用链）。

### F-core-service-vfs-10 | P3 | `packages/core/src/service/prompt/normalize-orphan-tool-results-for-llm.ts:19-31`
```
function isToolResultPairedInVisible(toolUseId, visibleMessages): boolean {
  for (const msg of visibleMessages) {
    for (const block of msg.content.blocks) {
      if (block.type === "tool_use" && block.id === toolUseId) return true;
```
对**每个** `tool_result` 块都全量扫一遍所有可见消息的所有块 → O(blocks²)。该函数在 agent-runner 每个 step 调用（`agent-runner.ts:580`），大会话 + 几十次工具往返时是可观的 CPU 浪费（与 `apply-thinking-context-for-llm` 刻意做的「无变更返回原引用」优化取向相反）。
**建议**：先一趟 `collectToolUseIds(messages)` 建 Set，再判配对（第二趟 `collectToolResultIds` 已经是这个写法，两趟口径天然对称）。
**置信**：confirmed（复杂度形态），量级未实测。

### F-core-service-vfs-11 | P3 | `packages/core/src/service/vfs/impl/physical-vfs.service.ts:507-530`
```
  while (queue.length > 0) {
    const s = queue.shift()!;
    queue.push(...(await this.sessions.listByParentSession(s.id)));
    if (s.parentSessionId != null) {
      const hasEntries = await this.hasSessionEntries(projectId, s.id);
```
`sessionsTreeRows`（`listTree` 路径，desktop 全树拉取）对每个子会话**串行**发一次 `listEntriesUnderPrefix`。同文件 `:313-320` 的 `list` 路径用了 `Promise.all` 并发做同一件事——两条路径口径相同、实现一并发一串行，N+1 在会话数多的项目上是全树拉取的可见成本。
**建议**：`listTree` 路径先 BFS 收集全部会话 id，再 `Promise.all` 批量判可见性（与 `list` 对齐）。
**置信**：confirmed。

### F-core-service-vfs-12 | P3 | `packages/core/src/service/vfs/glob-match.ts:78-91`
```
    if (ch === "*") {
      ...
      for (let j = si; j <= segment.length; j++) {
        if (matchSegment(pattern.slice(pi + 1), segment.slice(j))) return true;
```
段内匹配用朴素回溯（每个 `*` 递归重扫剩余），最坏情况（多 `*` 的长 pattern 撞长文件名）指数级；`matchSegments` 的 `**` 分支（`:50-60`）同样是路径内回溯。glob 工具与 `grep` 的 `pathGlob` 都走这里（`vfs.service.ts:172,187`），pattern 来自模型输出，理论上可构造病态输入。
**建议**：段内改成「按 `*` 切段 + 顺序贪心回退」的线性算法（`segment.includes(part)` 定位下一段），或对 pattern 段数/长度设上限并返回可读错误。
**置信**：suspected（未构造实际爆炸用例；正常 pattern 深度下开销可忽略）。

### F-core-service-vfs-13 | P3 | `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:136-148`
```
  if (kind === "file") {
    for (const [p, k] of pathKind) { if (k === "file" && p.startsWith(`${rel}/`)) { return `cannot place file under file: ${rel}`; } }
  } else {
    for (const [p, k] of pathKind) { if (k === "file" && p.startsWith(`${rel}/`)) { return `cannot create directory over nested file: ${p}`; } }
  }
```
`if` / `else` 两个分支的**判据逐字相同**，只有错误文案不同（且 else 分支的文案用了 `p` 而 if 分支用 `rel`，本身也不自洽）。属刻意的重复还是漏改无法从代码判定，标 intentional-redundant 供裁决：若只是文案差异，可合并为一次循环 + 按 kind 选文案。
**置信**：confirmed（重复事实），意图 suspected。

### F-core-service-vfs-14 | P3 | `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:245-255`（`character-card-import.service.ts:183-193` 同款）
```
    } catch (error) {
      if (error instanceof Error && error.message === "test import failure") { throw error; }
      if (error instanceof Error && error.name === "VfsZipError") { throw error; }
      const message = error instanceof Error ? error.message : "import transaction failed";
      throw vfsZipError("IMPORT_FAILED", message);
```
生产代码里对**测试专用错误字面量**做特判以让回滚测试能断言原始错误。更实质的问题是：除 `VfsZipError` 外的一切错误（含 domain 层抛的 `VfsError(NOT_FOUND/IS_DIRECTORY)`、SKSP/DB 错误）都被重包成 `IMPORT_FAILED`，**丢失类型化错误码**——而 `CharacterCardImportService` 侧保留了 `error instanceof CharacterCardError` 的透传，两个姊妹服务口径不一致。另 `applyBatchIngest` 的 `failedPath` 取自 `this.testHook?.throwOnWriteLogical`（`vfs-batch-io.service.ts:312-316`），生产路径下恒为 `undefined` 再退化到「plan.writes[0]」，报错指向的文件名与真实失败文件无关。
**建议**：测试钩子改用 `Symbol`/自定义错误类判定而非 message 字面量；透传 `VfsError`/`CharacterCardError` 原始 code（重包时保留 `cause`）。
**置信**：confirmed。

### F-core-service-vfs-15 | P3 | `packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:302-315`
```
async function runInTransactionOrConn<T>(conn, fn) {
  try { return await conn.transaction(fn); }
  catch (error) {
    if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") { return fn(conn); }
    throw error;
  }
}
```
判据是错误**码**而不是「进入 transaction 之前」的位置：若 `fn` 内部自己再开事务并真的抛 `NESTED_TRANSACTION`，外层会把整个 `fn` **重跑一遍**（第一次的部分副作用不保证已回滚——`conn.transaction` 失败时通常已回滚，但 `fn` 里若有非事务副作用，如 `fillFileCacheFromVfs` 的 fire-and-forget 写，就会重复）。当前调用点的 `fn` 内部不再开事务，所以是纯理论风险；同时 skills 侧正是靠这个 helper 支持嵌套（`skills.service.ts:468-471` 注释）。
**建议**：在调 `conn.transaction` **之前**判定是否已在事务中（若连接暴露该能力），或给 helper 传一个 `alreadyInTx` 标记由调用方声明，消掉「靠错误码反推」这一层。
**置信**：suspected。

### F-core-service-vfs-16 | P3 | `packages/core/src/service/workplace/impl/workplace-view-cache.ts:55-66` + `workplace.service.ts:265-288`
```
let cache = new WeakMap<TdbcConnection, Map<string, WorkplaceViewCacheEntry>>();
```
缓存 entry 的 key 只有 `scopeKey`（不含 `smartRules` / `smartRuleRows` provider 的形态），而 `inFlight` 是**跨实例**共享的 promise（`:274-276`）。两个用同一 conn、同一 scope 但 deps 形态不同的 service 实例（生产三端工厂装配一致，但测试里存在只传 `vfs`/`workplace` 不传 smart provider 的手工构造，见 `workplace.service.ts:60-63` 的可选依赖）会共用彼此的评估结果：前者不采 smart 规则却可能命中后者算好的 view。签名比对虽然包含 `smartRules`（`workplace.service.ts:327-334`，缺省时是 `[]`），但**正在飞行中的 inFlight 命中时不比签名**（`:274-276` 直接 return），所以缺省形态的实例可以拿到含 smart 排序的结果。
**建议**：cacheKey 追加一个「deps 形态」判别位（如 `smartRules != null ? "s" : "-"`），或对 inFlight 命中也做一次签名等值判定后再返回。
**置信**：suspected（生产装配单一，测试/未来接线才会暴露）。

### F-core-service-vfs-17 | P3 | `packages/core/src/service/compaction-conditions/create-compaction-condition-evaluator.ts:83-97`
```
    async shouldRequestCompaction(session, evaluation) {
      const conditions = await deps.conditionsStore.getConditions();
      ...
    async getHideStartDepth() {
      const conditions = await deps.conditionsStore.getConditions();
```
agent-runner 每个 step 先 `getHideStartDepth()`（`:538-539`）再 `shouldRequestCompaction()`（`run-compaction` 判定链），两次 KKV 读同一 module/key 拿同一份 JSON。另外 `getConditions` 本身在读到 v2/v3 文档时会**在读路径上写回 KKV**（`compaction-conditions-store.service.ts:137,148`），首次之后才免重复读。
**建议**：evaluator 内做一次短 TTL 或按 (enabled, trigger 集合, hideStartDepth) 记忆的快照；或让 agent-runner 单次取 `conditions` 后同时喂两处。
**置信**：confirmed（重复读事实），性能影响未实测。

## 争议与存疑

1. **F-01（template pull 不清缓存）是缺陷还是设计**：RULE 只把「角色卡 / ZIP 导入」写进了「导入缓存对齐」三件套，没提模板拉取。两种可能：(a) 遗漏——模板拉取对工作区的改动比 ZIP 导入更大，反而更该清；(b) 刻意保留——因为「重置工作区」是用户显式动作、且 assemble 在快照非空时不会重评估，不清缓存等于「工作区视图冻结到拉取前」。我按代码事实与 RULE 口径不一致报 P1，但**没有找到任何文档写明这是有意为之**。若主代理能确认有拍板记录，请降级为 intentional。
2. **F-02 的实际爆炸半径**：`importRules` 的 insert 失败概率低（`validateSmartSortRuleDraft` 已在 deleteAll 前跑完，`flags`/`capture_kind` 的 CHECK 都有对应校验）。真正的风险是**失败后不可自愈且无提示**（没有启动期一致性检查、内置 seed 只在 bootstrap 事务后种一次）。是否值得为它引入事务取决于主代理对「移动端 SQLite 写失败概率」的判断。
3. **F-03 的后果链未验证到底**：「重试重放 onStream → 重复文本/重复工具执行」的前半段（重试发生）已确认；后半段（`agent-runner` 对第二次事件流的处理）需要读 `wrapStreamForBus` 与 step 内文本累加路径才能定性，我按疑似报出并建议 W6 专门验证——若确认，这是本区唯一够得上 P1 的条目。
4. **派单里点名的「压缩统计优先口径」在本区查无此条目**：`docs/apm/RULE.md` 与 `docs/apm/memory/**` 全量检索 `压缩统计` / `统计优先` / `口径优先` 均零命中；`compaction-conditions/` 域内也没有任何统计聚合代码。若该口径指的是 `service/chat/impl/usage-stats.service.ts`（RULE「数据统计」条目所指的 token 命中率分母口径），它不在我的 zone 内，请转交 core-chat 机位。
5. **`kkv.get` 抛 NOT_FOUND 与 `sessionKkv.get` 返回 null 的不对称**（`kkv/impl/kkv.service.ts:21-27` vs `session-kkv/impl/session-kkv.service.ts:16-23`）是刻意的（两个端口各自有 `@remarks` 说明、`persistent-preferences`/`persistent-state`/`compaction-store`/`retry-policy` 四处都写了 `isKkvError` 捕获），标 intentional 不报。
6. **`ensure-import-dir-rules` 在事务内吞错**依赖「SQLite 语句级失败不自动 ROLLBACK」，注释（`:9-13`）明确写了并由 T-I5 故障注入用例守卫；同理 `clear-session-prompt-caches` 的事务**后**吞错。两者与「置位/压缩裸 await」的差异在 RULE 里有明确出处，标 intentional 不报。
7. **F-06 的处理方式有争议**：`DefaultVfsService` 的不可达方法也可能是「防御性完整实现 + 直测价值」。我不主张删测试，主张消除**两份 write 版本号语义**——但也可以选择「保留影子实现 + 加显式注释说明仅供直测」，这是产品口味问题。

## intentional 清单（按 RULE 决策感知，不当问题报）

- **workplace 工厂每次 new**（RULE.md:27）：`create-workplace-service.ts:22-42` 每次调用 new 实例，但 `workplace-view-cache.ts:55-58` 已把 memo 升级为 **conn 级 `WeakMap`**（跨实例共享 inFlight 与发布值），且 `agent-runner.ts:391-393` 已把 `wt` 提升到 step 循环外并留了注释。RULE 点名的两个历史坑（实例级 memo 失效、循环内反复 new）均已被后续设计覆盖，标 intentional。
- **导入缓存对齐的错误口径差异**（RULE.md:17）：`clear-session-prompt-caches.ts:48-53` 整体 try/catch + `console.warn`，与置位/压缩的裸 await 刻意不同，注释与 RULE 一致，标 intentional。
- **压缩不再清 `rule_snapshot` / `file_cache`**（`run-compaction.ts:8-18`，2026-09-29 用户拍板「压缩与文件缓存无关」）：行为本身 intentional；**但 RULE.md:16 未同步**，已单列为 F-07。
- **压缩条件 v2→v3→v4 读路径写回 KKV**（`compaction-conditions-store.service.ts:128-150`）：一次性迁移落库，标 intentional。
- **`clearSessionPromptCaches` 写空串哨兵而非 delete**（`:42-47`）：注释标明与读口「按原值复核」协议配套，标 intentional。
- **kkv vs session-kkv 的 `get` 缺失语义不对称**：见争议 5。
- **`importRules` 替换式导入（清空全部含内置）**是产品口径（`smart-sort-rule.port.ts:79`「D10」），非缺陷；本条只报其**非事务**属性（F-02）。
- **`materialize()` / `renderDisplay()` 的 `@deprecated`**：仅 CLI 一处消费（`apps/cli/src/workplace/run-workplace.ts:131`），保留合理，不报。
