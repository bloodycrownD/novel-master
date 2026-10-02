---
zone: w9-servicevfs-pro
agent: 检察官（prosecutor）— 猎杀冗余 / 死路径 / 事务缺口 / 缓存对齐漏挂
files_scanned: 62
---

# W9 · packages/core/src/service/ 存储与装配层（vfs / workplace / skills / kkv / session-kkv / persistent-* / smart-sort-rule / template / compaction-conditions / prompt / provider）

## 摘要

这一片是 core 的「存储与装配层」：VFS 逻辑文件树与其事务化导入导出（ZIP / 角色卡 / 批量）、workplace 目录规则引擎的 service 门面与常驻前缀装配、session KKV 与模块级 KKV 之上的偏好/工作区指针/压缩条件/重试策略四组薄服务、技能域读写、模板拉取/推送编排、提示词装配与 provider 服务族。整体是「薄 service + 厚 domain」的分层，注释密度极高、口径多有拍板背书。本机位重点猎杀事务缺口、缓存对齐漏挂与死路径。

## 职责与边界

- **不负责**：业务规则判定（在 `domain/workplace/logic/workplace-rule-engine.ts`）、SQL（在 `domain/*/repositories/impl/`）、agent 编排（在 `service/agent/`）。
- **负责**：事务边界（谁开事务、事务后调度什么 GC）、跨域写链的协调与补偿、缓存失效的挂载点、对外工厂函数（`createXxxService`）的装配形状。
- 关键约定：VFS 写入经 `RevisionAwareVfsService` 才会产生 `vfs_revision` 行与 ref_count；不经它的直写路径（`repo.insert/update`）**不产生版本历史**。

## 对外接口

| 模块 | 关键导出 |
| --- | --- |
| vfs | `createVfsService` / `createScopedVfsService` / `createPhysicalVfsService` / `createVfsBatchIoService` / `createVfsZipIoService` / `createCharacterCardImportService`、`buildUserVfs*Op`、`matchGlob` |
| workplace | `createWorkplaceService`、`assembleWorkplaceDisplay`、`refreshRuleSnapshot` |
| skills | `createSkillsService` |
| kkv / session-kkv | `createKkvService`、`createSessionKkvService` |
| persistent-* | `createPersistentPreferences`、`createPersistentState` |
| smart-sort-rule | `createSmartSortRuleService` |
| template | `createTemplatePullService` |
| compaction-conditions | `createCompactionConditionsStore`、`createCompactionConditionEvaluator`、`runCompaction`、`runHideMessageAction` |
| prompt | `render-prompt.ts` 五个装配/预览函数 |
| provider | `createProviderServices`、`createModelRetryPolicyService` |

## 数据访问

- 表：`vfs_entry` / `vfs_revision` / `vfs_content_blob`（经 `SqliteVfsContentStore`）、`workplace_dir_rule` / `workplace_file_rule`、`smart_sort_rule`、`kkv_entry`、`session_kkv_entry` + `session_file_cache_entry` + `session_file_cache_blob`、`message_checkpoint`、`chat_message`、`llm_provider` / `llm_saved_model`、SKSP secret 表。
- KKV 模块名（均为字面量，散落各服务）：`nm-preferences`（`persistent-preferences/impl/preference-keys.ts:8`）、`nm-workspace-state`（`persistent-state/impl/workspace-state-keys.ts:8`）、`nm-model-retry`（`provider/impl/model-retry-policy.service.ts:17`）、`nm-compaction-conditions`（`compaction-conditions/impl/compaction-conditions-store.service.ts:19`）。
- KKV 域常量（`domain/session-kkv/model/session-kkv-domains.ts`）：`rule_snapshot` / `file_cache` / `prompt_tokens` / `usage_stats`。
- 文件路径：本区无直接 fs 访问，物理 VFS 视图（`service/vfs/impl/physical-vfs.service.ts`）是纯只读投影。

## 依赖关系

- 被谁消费：`service/chat/impl/session.service.ts`（模板链）、`service/agent/impl/agent-runner.ts`（workplace / prompt / model-request）、`service/chat/impl/message-transcript-effects.service.ts`（置位清缓存）、`domain/tool/builtin/vfs-tools.ts`（目录规则补行内核）、`apps/{cli,desktop,mobile}` 的 IPC 与 service 层。
- 依赖：`domain/*` 全部、`infra/tdbc`、`infra/tokenizer`、`infra/sksp`、`service/session-fs`、`service/message-checkpoint`、`service/coordinated-write`。

---

## 发现清单

### F-w9-servicevfs-pro-1 | P1 | `packages/core/src/service/template/impl/template-pull.service.ts:30-35`

```ts
await this.conn.transaction(async (tx) => {
  await initializeSessionWorkspace(tx, session.projectId, sessionId, {
    clearCheckpoints: true,
  });
});
await runDeferredBlobGc(this.conn);
```

**描述（缓存对齐漏挂，confirmed）**：模板拉取把整个 session VFS 子树 + workplace 规则整树覆盖（`logic/initialize-session-workspace.ts:37-53`：`replaceVfsSubtree` + `worktree.copyScope`），但**既不调 `clearSessionPromptCaches`，也不调 `refreshRuleSnapshot`**。全仓 `clearSessionPromptCaches` 的调用点只有两处——`service/vfs/impl/character-card-import.service.ts:197` 与 `service/vfs/impl/vfs-zip-io.service.ts:259`；`session.service.ts:234-239` 的 `pullTemplate`、desktop handler `apps/desktop/src/main/ipc/handlers/sessions.ts:93-103`、mobile `apps/mobile/src/components/prompt/TemplatePullButton.tsx:45`、CLI `apps/cli/src/session/template.ts:22` 四条链路都没有补这一步。

后果是可证的：`file_cache` 读口**不做任何 mtime 校验**（`domain/workplace/logic/load-or-fill-file-cache.ts:51-56`、`service/workplace/assemble-workplace-display.ts:171-172` 命中即用），而 `replaceVfsSubtree` 的复制**保留源 mtime**（`domain/vfs/logic/vfs-tree-copy.ts:208/238` 直接透传 `entry.mtimeMs`）。因此拉取后同一逻辑路径若内容变了、mtime 又相同，缓存正文原样续命；`rule_snapshot/canon` 同理（`assemble-workplace-display.ts:213-239`：非空即返回，不重评估）。用户点「从上级同步」后，下一轮提示词前缀仍可能显示拉取前的文件树与正文。

**建议**：`sessionTemplatePull` 事务提交后补一次 `clearSessionPromptCaches(sessionId, sessionKkv)`（与导入同款 best-effort 口径）。`sessionTemplatePush` 不需要（改的是 project 域，不进任何会话前缀）。

**置信**：confirmed（缓存读口无校验 + mtime 保留 + 无调用点，三处代码互证）。注：`docs/apm/RULE.md:17` 只把「角色卡/ZIP 导入」写进缓存对齐清单、`:27` 把缓存改写方枚举为「refreshRuleSnapshot / 压缩置位 / 会话删除」，pull 两处都没提——但这是**清单没写**而非**明确拍板不管**，且清单遗漏与实际行为陈旧是同一类问题，故仍按问题报。

---

### F-w9-servicevfs-pro-2 | P1 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249`

```ts
await this.deps.rules.deleteAll();
for (const entity of entities) {
  await this.deps.rules.insert(entity);
}
```

**描述（事务缺口，confirmed）**：`importRules` 是「先清空整表、再逐条插入」的替换式语义（`docs/Iterations/smart-filename-sort/spec.md` D10 明确拍板替换式），但**全程无事务**：service 的 `deps` 只有 `{ rules, builtinSeed }`（`impl/smart-sort-rule.service.ts:56-60`），连 `conn` 都没有，结构上开不了事务；repository 层 `SqliteSmartSortRuleRepository` 的每个方法都是单条 `executeTemplate`（`domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts:75-145`），无事务包裹；调用方 desktop `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts:171`、mobile `apps/mobile/src/services/smart-sort-rule-yaml.service.ts:32`、CLI `apps/cli/src/sort-rule/commands.ts:184` 也都没包。

后果：bundle 中任一条 insert 失败（正则/flags 的 CHECK 约束、进程被杀、磁盘满），用户已有的全部智能排序规则已被 `deleteAll` 抹掉且不会回滚——排序静默退化为自然序，无任何报错线索可追（desktop 侧还会被 `normalizeYamlError` 包成「YAML 无效」，把 DB 故障误报成格式错误）。

**建议**：给 `SmartSortRuleServiceDeps` 加 `conn`，`deleteAll + 逐条 insert` 整体包进 `conn.transaction`；或在 repo 层加一个 `replaceAll(entities)` 原子方法。同一处理见 F-3。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-3 | P1 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:253-288`

```ts
async resetDefaults(): Promise<void> {
  const rules = await this.deps.rules.listOrdered();
  ...
  for (const rule of rules) {
    if (isBuiltinSmartSortRuleId(rule.ruleId)) {
      await this.deps.rules.delete(rule.ruleId);
    }
  }
```

**描述（事务缺口，confirmed）**：同族问题。`resetDefaults` 是「删全部内置行 → 逐条重灌 seed → 显式 renumber」三段式，同样零事务。中途失败的结果是**内置规则永久缺失**（用户重启也不会自愈——seed 是 `INSERT OR IGNORE` 幂等，只补缺失行，但 resetDefaults 中途失败时表已被清空，下次 seed 会重新种入，掩盖问题；真正的坏情况是「删了 3 条 builtin、重灌 2 条时失败」，此时种入机制也救不回被误删的用户规则相对序）。此外 `deleteBatch`（`:132-147`，先全量校验再逐条 delete）、`setEnabledBatch`（`:163-170`，逐条 setEnabled）、`moveRule`/`reorderRules` → `renumber`（`:372-382`，逐条 UPDATE sort_order）也都是多语句无事务；其中 `renumber` 中途失败会留下**排序号有洞或撞号**的表，而 `listOrdered` 用 `ORDER BY sort_order, rule_id` 决胜（repo `:55`），撞号时行为不可预测。

**建议**：同上，`resetDefaults` / `deleteBatch` / `setEnabledBatch` / `reorderRules` 各自包单事务；`renumber` 因被 `moveRule`/`reorderRules`/`resetDefaults` 三处复用，宜下沉为 repo 的单条批量 UPDATE。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-4 | P2 | `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:84-102`

```ts
// 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义
await repo.update(sk, logical, content, existing.version + 1);
```

**描述（绕过版本层，confirmed）**：非 session 批量导入（`applyBatchIngest`，桌面「从本机导入目录」）直连 `SqliteVfsEntryRepository.insert/update`，**不经过 `RevisionAwareVfsService`**，因此不写 `vfs_revision` 行、不调 `adjustRef`。同区的角色卡导入（`impl/character-card-import.service.ts:151`）与 ZIP 导入（`impl/vfs-zip-io.service.ts:214`）都走 `insertFileSeedingRevision`，三条写路径口径不一致。

后果：这些文件此后被 agent `write` 编辑时，`RevisionAwareVfsService.writeWithRevision`（`impl/revision-aware-vfs.service.ts:370-395`）会算出 `nextVersion = max(head=1, MAX(version)=0)+1 = 2`，append v2 后调 `transferLiveRef(v1→v2)`，而 **v1 在 `vfs_revision` 里根本不存在**——`adjustRefCount` 对缺失行的行为未被本区任何测试覆盖，回滚/GC 链（`deleteUnreferencedUnderScope`）会据此得出错误的引用计数。

次生问题：同函数**不调 `ensureImportDirRules`**（对比 `character-card-import.service.ts:161` / `vfs-zip-io.service.ts:224` 都调了），批量导入新建的目录在 project/global 域**没有目录规则行**；按 `docs/apm/RULE.md:30`「无规则行 = rule_off」，这些目录下的文件在工作区前缀里**直接不可见**。这是与角色卡/ZIP 导入的第三处口径分叉。

**建议**：`writeOrUpdateFile` 改走 `insertFileSeedingRevision`；`applyBatchIngest` 事务末尾补 `ensureImportDirRules`（scope 非 session 时键空间用 `workplaceScopeKey`，helper 内已处理）。另需确认 `adjustRefCount` 对不存在行的语义并补一条守卫测试。

**置信**：confirmed（代码路径差异可直接比对）。规则行缺失导致不可见的推论基于 RULE.md:30 的口径，标 confirmed 但建议复核时实测一次。

---

### F-w9-servicevfs-pro-5 | P2 | `packages/core/src/service/workplace/refresh-rule-snapshot.ts:35-41`

```ts
await deps.sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, …);
await deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
```

**描述（缓存对齐漏挂，confirmed）**：改目录/文件规则会改变常驻前缀的可见内容，但 `refreshRuleSnapshot` 只重写 `rule_snapshot` + 清 `file_cache`，**不调 `invalidateSessionApiPromptTokenEntry`**。而 `infra/tokenizer/logic/session-api-prompt-token-store.ts:236-238` 的模块注释把义务写死为「凡改变『当前可见 prompt』…的路径，成功后必须调本函数」。实际其它三条同类路径都照做了：置位 `service/chat/impl/message-transcript-effects.service.ts:186`、压缩 `service/compaction-conditions/run-compaction.ts:78`、导入对齐 `service/vfs/logic/clear-session-prompt-caches.ts:38`、切模型/Agent `service/persistent-state/impl/persistent-state.service.ts:140`。

后果：`prompt_tokens` 域的 API 精确占用带着旧基线存活；重启后由 `resolve-current-prompt-tokens.ts:270-285` 读回并按 api 口径参与压缩阈值判定（跳掉 heuristic 安全系数），规则改动后误判方向不确定。

**建议**：`refreshRuleSnapshot` 末尾补 `await invalidateSessionApiPromptTokenEntry(deps.sessionKkv, sessionId)`；`RefreshRuleSnapshotDeps.sessionKkv` 的 `Pick<>` 需放宽到含 `delete`（或直接依赖 store 函数）。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-6 | P2 | `packages/core/src/service/skills/impl/skills.service.ts:437-461`

```ts
await this.deps.conn.transaction(async (tx) => {
  …
  await sweepRevisionsUnderScope(entryRepo, revisionRepo, vfsScopeKey, prefix);
  …
});
```

**描述（GC 未挂，confirmed）**：`deleteSkill` 在事务内 `sweepRevisionsUnderScope`（`domain/vfs/logic/vfs-tree-copy.ts:390-411`：释放 live ref → 删 entry → 删无引用 revision），revision 行被物理删除后其引用的 `vfs_content_blob` 成为孤儿，但**提交后没有调度 `runDeferredBlobGc`**。对照全仓其余删除路径都调度了：会话删除 `service/chat/impl/session.service.ts:195`、项目删除 `service/chat/impl/project.service.ts:194`、模板拉取/推送 `service/template/impl/template-pull.service.ts:35/48`、消息删除 `service/chat/impl/message.service.ts:263`、db 维护链 `infra/db-maintenance/impl/db-maintenance.service.ts:66`（后者只清 file-cache blob，不清 vfs content blob）。desktop `apps/desktop/src/main/ipc/handlers/skills.ts:172` 与 mobile `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx:198` 也都没补。

后果：删技能只在恰好发生过会话/项目删除或模板同步时才顺带回收，长期不删会话的用户库里技能 blob 无限累积（`docs/apm/RULE.md:108` 提醒过体积统计要按内容哈希去重，孤儿 blob 正是这种「按行累加看不出来」的部分）。

**建议**：`deleteSkill` 事务提交后 `await runDeferredBlobGc(this.deps.conn)`。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-7 | P2 | `apps/desktop/src/main/services/vfs-batch.service.ts:219-226`

```ts
} else {
  report = await batch.applyBatchIngest(scope, targetDir, plan, applyOptions);
}
```

**描述（缓存对齐条件性漏挂，suspected）**：`ingestVfsFromHostPaths` 只在 `isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()` 时走 `applyBatchIngestWithWriter`（经 agent 工具链，工具侧自带目录规则补行与 user-vfs flush）。开关关闭时（`NM_USER_VFS_UNIFIED_TOOL_TURN=0`，或用户把 `vfs.userVfsUnifiedToolTurn` 偏好置 false——`domain/feature-flags/user-vfs-unified-tool-turn.ts:30-35`）session 域会落到 `applyBatchIngest`，而该路径既不清 `file_cache`/`rule_snapshot` 也不失效 API prompt token，与角色卡/ZIP 导入的既有口径不一致。

**建议**：与 F-1 同批处理——在 `applyBatchIngest` 提交后按 `scope.kind === "session"` 补 `clearSessionPromptCaches`；或明确把该组合列入已知不支持并在 UI 禁用入口。

**置信**：suspected（默认路径不走这里；需在开关关闭态实测一次确认前缀是否陈旧）。

---

### F-w9-servicevfs-pro-8 | P2 | `packages/core/src/service/provider/impl/provider.service.ts:176-195`

```ts
if (secretOp === "delete") {
  if (await this.deps.secretStore.has(originalSecretRef)) {
    await this.deps.secretStore.delete(originalSecretRef);
  }
…
rollback: async () => {
  if (originalSecretValue != null) {
    await this.deps.secretStore.set(originalSecretRef, originalSecretValue);
  } else if (secretOp === "set") { … }
}
```

**描述（env 覆盖层泄漏进 DB，suspected）**：`secretStore` 在生产装配里是 `createCompositeSecretStore`（`infra/sksp/impl/composite-secret-store.ts:19-51`，env 优先读、**写只落 DB**）。`edit` 在 `:133` 用 `secretStore.get(originalSecretRef)` 捕获「原值」用于回滚——若该 key 由环境变量提供，`get` 返回的是 **env 值**；随后 `providers.update` 失败触发 rollback 时，`secretStore.set` 会把这份 env 明文写进 DB 表。`delete` 同形（`:226` 捕获、`:267-270` 回滚）。

后果：运维用 env 注入密钥的部署，一次 provider 编辑失败就把密钥落进用户数据库文件（可能被备份/同步带走）。频率低但性质是凭据面扩大。

**建议**：`edit`/`delete` 判定原值来源——若 `envStore.has(ref)` 为真则回滚走 `delete` 而非 `set`（`SecretStore` 端口可加一个 `hasInDb`/让 composite 的 `get` 区分来源）；或在 composite 上暴露 `getDbOnly`。

**置信**：suspected（取决于生产是否真的注入 `env` store；装配点未在本区，建议验证代理确认）。

---

### F-w9-servicevfs-pro-9 | P2 | `packages/core/src/service/provider/impl/provider-model.service.ts:36`

```ts
readonly providerRepo: ProviderRepository;
```

**描述（死依赖，confirmed）**：`DefaultProviderModelServiceDeps.providerRepo` 在接口里声明、在 `create-provider-services.ts:55` 被注入，但类体**从未读取**（`this.deps.*` 的全部使用点见 `:66,67,71,72,84,92,100,119,128,129,138,164,171,173,181,197,235,242,251`，无 `providerRepo`）。既有 `deps.providers`（`ProviderService`）承担全部读需求，`providerRepo` 是纯冗余。

**建议**：删字段与工厂注入行；或若原意是绕过 service 层直读 repo，则补上真正使用点。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-10 | P3 | `packages/core/src/service/workplace/impl/workplace.service.ts:205-216`

```ts
/** @deprecated 使用 {@link materializeLiveView} / {@link materializePersistBlock}。 */
async materialize(): Promise<WorkplaceMaterialized> { … }
```

**描述（死路径，confirmed）**：`materialize()` 与其返回类型 `WorkplaceMaterialized`（`workplace.port.ts:44-53`）标了 `@deprecated`，全仓唯一调用点是 `packages/core/test/workplace/workplace-materialize.test.ts`（5 处）。生产侧 desktop/mobile/CLI 走的是 `buildListRows` / `renderDisplay` / `renderFileTree` / `materializePersistBlock`。

**建议**：连同 port 上的 `materialize()` / `WorkplaceMaterialized` 一起删，测试改用两个新入口。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-11 | P3 | `packages/core/src/service/workplace/impl/workplace.service.ts:317-318` + `:350-351`

```ts
const dirRules = await this.deps.workplace.listDirRules(scopeKey);
const fileRules = await this.deps.workplace.listFileRules(scopeKey);
```

**描述（重复查询，confirmed）**：`sampleSignatures`（签名采样）与 `loadContextMetadata`（全量评估）各独立调一次 `listDirRules` + `listFileRules`。缓存 miss 时同一轮评估把规则表读两遍；签名正确性并不需要第二份（它只要确定性序列化）。同理 `smartRuleRows` 在 `create-workplace-service.ts:40` 每次调用都 `new SqliteSmartSortRuleRepository(conn)`。

**建议**：签名采样与 metadata 共享一次读取结果（把 rows 作为参数传入 `computeFullViewValue`）；repo 实例在工厂里建一次复用。

**置信**：confirmed（成本低频、不影响正确性，故 P3）。

---

### F-w9-servicevfs-pro-12 | P3 | `packages/core/src/service/workplace/impl/workplace.service.ts:85-97`

```ts
const files = [...input.fileSet];
for (const raw of input.configuredPaths) {
  …
  const asDirKeep = input.dirRulePaths.has(n) &&
    (input.dirPathSet.has(n) || files.some((f) => f.startsWith(prefix)));
```

**描述（幽灵路径过滤的复杂度，confirmed）**：`filterGhostConfiguredPaths` 对每个配置路径做一次全量 `fileSet` 线性扫描，复杂度 O(配置数 × 文件数)；同时每次调用 `[...input.fileSet]` 复制整个集合。会话工作区文件多、规则行多时（`sampleSignatures` 与 `loadContextMetadata` 各调一次）这笔开销落在 workplace 评估的热路径上。

**建议**：改成先按第一层目录分组（`Map<dir, string[]>`）或对 `fileSet` 排序后用二分前缀判定；复制改为惰性（只在 `dirRulePaths` 非空时构造）。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-13 | P3 | `packages/core/src/service/session-kkv/impl/session-kkv.service.ts:13-57`

**描述（纯转发层，intentional-leaning / confirmed）**：`DefaultSessionKkvService` 七个方法全部 `return this.repo.x(...)`，零逻辑、零错误语义转换。对照同族的 `DefaultKkvService`（`service/kkv/impl/kkv.service.ts:21-38`）会把 `null` / `false` 转成 `kkvNotFound` 抛错——两者定位不一致：kkv 层是「薄但有错误契约」，session-kkv 层是「纯透传壳」。同时 `createKkvService(conn)` 在 `create-persistent-preferences.ts:20`、`create-persistent-state.ts:22`、`create-compaction-conditions-store.ts:15`、`create-model-retry-policy-service.ts:19` 四处各 new 一份 `DefaultKkvService`，同一 conn 上四份等价实例。

**建议**：要么给 session-kkv 层补上明确的不抛错契约注释（现状容易被误读为「找不到返回 null」是设计），要么按 DDD 惯例直接删掉这层壳、service 依赖 port 接口由调用方注 repo。KKV 实例重复属无伤冗余，可在工厂层缓存。

**置信**：confirmed（事实层）；「该不该删」属设计口味，交给 reduce 裁决。

---

### F-w9-servicevfs-pro-14 | P3 | `packages/core/src/service/compaction-conditions/impl/compaction-conditions-store.service.ts:128-150`

```ts
if (isV2Document(parsed)) {
  const v4 = migrateV3ToV4(migrateV2ToV3(parsed));
  …
  await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validatedFromV2));
  return validatedFromV2;
}
```

**描述（读路径带写副作用，confirmed）**：`getConditions()` 在读到 v2/v3 旧文档时会**写回升级后的文档**——一次 getter 发起写 I/O。`getConditions` 被 `create-compaction-condition-evaluator.ts:84`（`shouldRequestCompaction`，每 step 调）与 `:95`（`getHideStartDepth`）各调一次，即每 step 至少两次 KKV 读；首次命中旧文档时还各带一次写。写发生在 getter 内也意味着「只读诊断」（如 CLI `nm compaction-conditions show`、`apps/desktop/src/main/ipc/handlers/compaction-conditions.ts:17`）会改库。

**建议**：迁移写回移到显式的 `migrateIfNeeded()`，在 bootstrap 或 store 构造时跑一次；getter 保持纯读。顺带把 evaluator 里两次 `getConditions()` 合并为一次。

**置信**：confirmed（升级后文档变 v4，写只发生一次，故不升 P 级）。

---

### F-w9-servicevfs-pro-15 | P3 | `packages/core/src/service/vfs/impl/character-card-import.service.ts:49-70` / `impl/vfs-zip-io.service.ts:71-89` / `impl/vfs-batch-io.service.ts:67-82`

**描述（三份近似重复的目录行 helper，confirmed）**：`ensureEmptyDirectoryRow` 在三个服务里各写一遍，语义几乎相同（placeholder 路径不同：`__vfs_card_placeholder` / `__vfs_zip_placeholder` / `__vfs_batch_placeholder`），差异只在「目标是文件时抛什么错」（`characterCardError` / `vfsNotADirectory` / 裸 `Error`）。同形的 `assertDirectoryPathNotFile` 也重复了两份（`character-card-import.service.ts:72-84` 与 `vfs-zip-io.service.ts:91-103`），逐字相同。

**建议**：抽到 `domain/vfs/logic/ensure-empty-directory-row.ts`，错误类型由调用方传入或统一走 `VfsError` 子码。属低风险收敛。

**置信**：confirmed。

---

### F-w9-servicevfs-pro-16 | P3 | `packages/core/src/service/compaction-conditions/run-compaction.ts:12-18`

**描述（有意为之，intentional）**：压缩**不再**清 `rule_snapshot` + `file_cache`，只失效 API prompt token。模块头注明这是 2026-09-29 用户拍板「压缩与文件缓存无关」：压缩只改消息可见性，文件内容与规则不变；且压缩发生在 agent 回合中段，回合快照语义要求前缀回合内冻结（`loadOrFillFileCache` 命中无条件返回），中途清缓存会破坏该不变量。

**注**：`docs/apm/RULE.md:16` 仍写着压缩「副作用：清 `rule_snapshot` + `file_cache`」，与本实现相反；RULE 的权威口径应以代码 + 本注释为准，建议由主代理更新 RULE（本机位无 `docs/apm/` 写权限）。**置信**：intentional（代码与注释互证，且有用户拍板日期）。

---

## 争议与存疑

1. **F-1（模板拉取不清缓存）是否算 intentional？** `docs/apm/RULE.md:17` 把缓存对齐的触发条件写成「session scope 的角色卡/ZIP 导入」，`:27` 把缓存改写方穷举为「refreshRuleSnapshot / 压缩置位 / 会话删除」——两处都没提模板拉取。可以读成「拍板不管」，也可以读成「清单遗漏」。我按后者报 P1，理由是：拉取的破坏面（整树覆盖 + 规则覆盖）严格大于角色卡导入，而 file_cache 读口无 mtime 校验 + 树复制保留源 mtime 这两条使「陈旧正文原样续命」在 mtime 相同的常见场景下必然发生。若 reduce 阶段找到「拉取后由 UI 强制重建前缀」的证据，应降级为 intentional。
2. **F-2/F-3（smart-sort-rule 无事务）是否被迭代文档豁免？** `docs/Iterations/smart-filename-sort/spec.md` D10 只拍板了「替换式」语义，没提事务。D10 的理由是「round-trip 无损严格成立」——而 round-trip 无损恰恰要求 deleteAll + 全量 insert 原子化，否则中途失败就丢数据。我倾向认定这是实现缺口而非有意取舍，请 reduce 复核。
3. **F-4 的严重度**取决于 `SqliteVfsRevisionRepository.adjustRefCount` 对不存在行的语义（可能静默 0 行、可能抛 NOT_FOUND）。我没有读 repo 实现（在本区外），因此「引用计数出错」标 confirmed 而非「数据损坏」。若它是抛错，那批量导入后的首次 agent write 会直接失败——反而更容易发现。
4. **F-8 依赖生产装配**：`createCompositeSecretStore` 是否真的带 `env` store、env store 在三端是否装配，我未追到 runtime 装配点，故标 suspected。若生产从不注入 env，此条降为 P3 死代码清理。
5. **未覆盖**：`service/vfs/impl/physical-vfs.service.ts` 的五前缀解析与 `/projects` 虚拟目录合成（约 550 行）只做了结构通读，未逐分支验证边界（`listScopeFirstLevel` 的 `base.length + 1` 切片在 `queryDir === "/"` 时的正确性看着可疑但我没构造用例）；`glob-match.ts` 的 `**` 回溯正确性未做穷举验证。这两块建议在 W10 或验证波补。
6. **独立性声明**：本报告未读 `raw/` 与 `synth/` 任何文件；`docs/Iterations/repo-mega-cr-2026-10/` 下仅读了 `PLAN.md`；`docs/apm/RULE.md` 按协议第 3 条作为决策感知来源读取。
