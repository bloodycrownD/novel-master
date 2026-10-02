---
zone: w9-ds2-servicevfs-b
agent: domain-survey（独立双扫 B）
files_scanned: 74
base_sha: 9ca5f5ad
---

# w9-ds2-servicevfs-b —— packages/core/src/service/ 存储与装配层测绘

## 摘要

`packages/core/src/service/` 下与「文件 / 规则 / 缓存 / 键值 / 服务商」相关的应用服务层。
VFS 五域（global / project / session / global-meta / project-meta）的读写与版本链、常驻工作区
（workplace）的规则评估与每轮前缀拼装、技能两域管理、KKV / session-KKV 两级键值、
持久偏好与工作区指针、智能排序规则、模板拉取/推送、压缩执行、提示词渲染、
LLM 服务商与模型请求。本层几乎全是「编排 + 事务边界 + 缓存口径」，纯计算极少。

## 职责与边界

- **进**：TDBC connection、domain 层 repo / logic / schema、infra（tokenizer / sksp / llm-protocol）。
- **出**：`public/{vfs,workplace,prompt,compaction,session-kkv}.ts` 五个子路径 + 六个工厂
  （`createVfsService` / `createScopedVfsService` / `createPhysicalVfsService` /
  `createVfsZipIoService` / `createCharacterCardImportService` / `createVfsBatchIoService`）。
- **不负责**：schema 定义（bootstrap）、SQL（domain repositories）、协议适配（infra/llm-protocol）、
  agent 编排（service/agent）、消息落库（service/chat）。
- **依赖方向守恒**：service → domain → infra，无反向 import（`grep` 未见 domain 引 service，
  唯一例外是 `domain/vfs/logic/revision-ref-count.ts:13` 为类型引 `service/integrity-repair.js`，
  属既有设计）。

## 对外接口

| 工厂 / 入口 | 出处 | 说明 |
|---|---|---|
| `createVfsService(conn)` | `service/vfs/create-vfs-service.ts:19` | 返回 `InternalVfsService`（scopeKey + 逻辑路径） |
| `createScopedVfsService(conn, scope)` | `service/vfs/create-scoped-vfs-service.ts:19` | apps 层入口，scope 藏在 `ScopedVfsService` 后 |
| `createPhysicalVfsService(conn)` | `service/vfs/create-physical-vfs-service.ts:16` | 只读物理树（类型层面无写方法） |
| `createVfsZipIoService(conn, options?)` | `service/vfs/create-vfs-zip-io-service.ts:23` | 工厂内部自建 `sessionKkv` 注入 |
| `createCharacterCardImportService(conn, options?)` | `service/vfs/create-character-card-import-service.ts:23` | 同上 |
| `createVfsBatchIoService(conn, options?)` | `service/vfs/create-vfs-batch-io-service.ts:23` | plan + apply |
| `createWorkplaceService(conn, scope)` | `service/workplace/create-workplace-service.ts:22` | 装配 smart 规则 provider |
| `assembleWorkplaceDisplay(scope, deps, options?)` | `service/workplace/assemble-workplace-display.ts:130` | 常驻前缀唯一包裹出口 |
| `refreshRuleSnapshot(sessionId, deps)` | `service/workplace/refresh-rule-snapshot.ts:29` | 规则保存后写快照 + 清 file_cache |
| `createTemplatePullService(conn)` | `service/template/create-template-pull-service.ts:14` | project↔session 整树覆盖 |
| `runCompaction(deps, params)` | `service/compaction-conditions/run-compaction.ts:58` | hide-message + prompt token 失效 |
| `createCompactionConditionEvaluator(deps)` | `service/compaction-conditions/create-compaction-condition-evaluator.ts:73` | OR 触发器 |
| `buildPromptLlmInputFromLayout` / `computeLlmExportZonesFromLayout` | `service/prompt/render-prompt.ts:350` / `:67` | 三区 layout 单次遍历 |
| `applyThinkingContextForLlm(messages, options)` | `service/prompt/apply-thinking-context-for-llm.ts:82` | view-time 剥离 thinking |
| `normalizeOrphanToolResultsForLlm(messages)` | `service/prompt/normalize-orphan-tool-results-for-llm.ts:52` | 孤立 tool_use/tool_result 归一 |
| `createProviderServices(conn, secretStore)` | `service/provider/create-provider-services.ts:39` | providers / providerModels / modelRequests |
| `buildUserVfs*Op(...)` 五个 | `service/vfs/build-user-vfs-turn-op.ts:35-128` | UI 操作 → tool turn op |

## 数据访问

| 表 / 域 | 触点 | 证据 |
|---|---|---|
| `vfs_entry` | 全部 VFS 服务经 `VfsEntryRepository` / `SqliteVfsEntryRepository` | `service/vfs/impl/vfs.service.ts:17,43`；`service/vfs/impl/physical-vfs.service.ts:24,118` |
| `vfs_revision` | write/delete/hardDelete/resetHead 追加版本与 ref_count | `service/vfs/impl/revision-aware-vfs.service.ts:16,88` |
| `vfs_content_blob` | `contentStore.put` / `findExistingBlobHashes` | `revision-aware-vfs.service.ts:29,197`；`template/logic/initialize-session-workspace.ts:6,45` |
| `workplace_dir_rule` / `workplace_file_rule` | `setDirRule` / `listDirRules` / `copyScope` / 补默认行 | `service/workplace/impl/workplace.service.ts:124,154,167`；`service/vfs/logic/ensure-import-dir-rules.ts:114` |
| `smart_sort_rule` | `listCompiledRules` / `listOrdered` | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:67,334`；`service/workplace/create-workplace-service.ts:40` |
| `skill_disabled_rule` | `setDisabled` / `listDisabledNames` / `removeAllScopesByName` / `renameByName` | `service/skills/impl/skills.service.ts:306,411,459,583` |
| `kkv_entry` module `nm-preferences` / `nm-workspace-state` / `nm-model-retry` / `nm-compaction-conditions` | 偏好、工作区指针、重试策略、压缩条件 | `service/persistent-preferences/impl/preference-keys.ts:9`；`service/persistent-state/impl/workspace-state-keys.ts:8`；`service/provider/impl/model-retry-policy.service.ts:17`；`service/compaction-conditions/impl/compaction-conditions-store.service.ts:19` |
| `session_kkv_entry` 域 `rule_snapshot` / `file_cache` / `prompt_tokens` / `usage_stats` | assemble / refresh / 清缓存 / token 失效 | `service/workplace/assemble-workplace-display.ts:154,232`；`service/vfs/logic/clear-session-prompt-caches.ts:34-47` |
| `chat_project` / `chat_session` | 物理树虚拟目录合成 | `service/vfs/impl/physical-vfs.service.ts:25-26,306-311` |
| `chat_message` / `message_checkpoint` | 压缩隐藏区间、导入 baseline 回填 | `service/compaction-conditions/hide-message.action.ts:53-60`；`service/vfs/impl/vfs-zip-io.service.ts:234-242` |
| `llm_provider` / `llm_saved_model` / SKSP secret | provider CRUD / 模型设置 / API key | `service/provider/impl/provider.service.ts:110,201`；`service/provider/impl/provider-model.service.ts:119` |

## 依赖关系

**import 谁**（域外主要）：
`@/domain/vfs/**`、`@/domain/workplace/**`、`@/domain/session-kkv/**`、`@/domain/skills/**`、
`@/domain/provider/**`、`@/domain/chat/**`、`@/domain/depth/**`、`@/domain/message-checkpoint/**`、
`@/infra/tdbc`、`@/infra/sksp`、`@/infra/tokenizer`、`@/infra/llm-protocol`、`@/errors/**`。

**被谁消费**：

| 消费方 | 位置 |
|---|---|
| `agent-runner`（assemble / prompt / compaction / thinking / orphan） | `service/agent/impl/agent-runner.ts:423,540,553,574,580,948,995` |
| `session.service`（pullTemplate / pushTemplate / createSession） | `service/chat/impl/session.service.ts:132,236,243` |
| desktop IPC（skills / workplace / sessions / vfs-batch） | `apps/desktop/src/main/ipc/handlers/{skills,workplace,sessions}.ts:120,74,98`；`apps/desktop/src/main/services/vfs-batch.service.ts:213,220` |
| mobile（workplace 规则刷新 / vfs 文件管理器） | `apps/mobile/src/services/workplace-rule-delta-draft.service.ts:17`；`apps/mobile/src/components/vfs/VfsFileManager.tsx:405` |
| `create-compaction-condition-evaluator` | `service/agent/logic/assemble-agent-runner-deps.ts:79` |

## 发现清单

### F-w9-ds2-servicevfs-b-1 | P1 | `service/template/impl/template-pull.service.ts:24-35`

```ts
async sessionTemplatePull(sessionId: string): Promise<void> {
  await this.conn.transaction(async (tx) => {
    await initializeSessionWorkspace(tx, session.projectId, sessionId, {
      clearCheckpoints: true,
    });
  });
```

**描述**：模板拉取把 session VFS 子树整树替换（`replaceVfsSubtree`）+ workplace 规则整域覆盖
（`copyScope`，见 `logic/initialize-session-workspace.ts:41-52`），但**不清该 session 的
`rule_snapshot` 与 `file_cache` 两域**。`assembleWorkplaceDisplay` 的读链对这两域是
「命中无条件返回、无 mtime 校验」（RULE.md 工作区条目明写），因此拉取后：
快照仍指向旧 path/status 集合，`file_cache` 仍持有**拉取前的文件正文**。
下一次 assemble 会把陈旧正文原样拼进提示词前缀，且不会自愈——直到用户改规则
（`refreshRuleSnapshot`）、压缩、置位或走一次 session-scope 导入才清。

对照：同类的 session-scope 子树替换在导入链上是显式对齐的
（`service/vfs/impl/vfs-zip-io.service.ts:258-260` → `clearSessionPromptCaches`），
RULE.md「导入缓存对齐」条目也把这条列为固定口径。模板拉取是同一类操作却漏了。
已确认 `session.service.ts:234-239` 的 `pullTemplate` 与 desktop handler
（`apps/desktop/src/main/ipc/handlers/sessions.ts:93-103`）都不补这一步。

**建议**：`sessionTemplatePull` 事务提交后按 `scope.kind === "session"` 调
`clearSessionPromptCaches(sessionId, createSessionKkvService(conn))`（错误口径沿用该 helper 的
best-effort 吞错，文件已落库）。或把该清空下沉进 `initializeSessionWorkspace` 的调用方契约。
`sessionTemplatePush` 不需要（写的是 project 域，不影响任何 session 的 KKV）。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-2 | P2 | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249`

```ts
await this.deps.rules.deleteAll();
for (const entity of entities) {
  await this.deps.rules.insert(entity);
}
```

**描述**：`importRules` 是「替换式导入」（port 注释 `smart-sort-rule.port.ts:79-80`），
先 `deleteAll` 再逐条 `insert`，**全程无事务**。任一条 `insert` 失败（bundle 里某条
`pattern` 编译期未覆盖的边界、并发写、连接抖动）都会留下空表或半张表，
且 `validateSmartSortRuleDraft` 只在删除前跑过，删完之后的失败无法回滚。
同文件的 `deleteSkill` 先例（`service/skills/impl/skills.service.ts:437-461`）明确用
`conn.transaction` 包住同形态的「删 + 写」。

**建议**：整个 `deleteAll + insert` 包进一个事务；或先全量 insert 到临时校验再事务内
`deleteAll + 批量 insert`。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-3 | P2 | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:261-287`

```ts
for (const rule of rules) {
  if (isBuiltinSmartSortRuleId(rule.ruleId)) {
    await this.deps.rules.delete(rule.ruleId);
  }
}
const now = Date.now();
for (const row of this.deps.builtinSeed) { await this.deps.rules.insert({...}); }
```

**描述**：`resetDefaults` 同样是「删 builtin → 重灌 builtin seed → renumber」三段非原子。
中途失败的结果是**内置排序规则全灭而用户规则残留**——工作区排序能力静默降级到自然排序
（`createWorkplaceService` 注释里 D4 的退化形态），用户无任何错误提示。
`renumber`（`:372-382`）自身也是逐条 UPDATE，同样不在事务内。

**建议**：同 F-2，包事务。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-4 | P2 | `service/workplace/refresh-rule-snapshot.ts:33-41`

```ts
const view = await deps.workplace.evaluateRuleView();
const entries = ruleViewToSnapshotEntries(view);
await deps.sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, serializeRuleSnapshot(entries));
await deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
```

**描述**：改目录/文件规则会改变常驻工作区前缀，进而改变**整个提示词的可见内容**，
但本函数只清 `rule_snapshot` + `file_cache`，**不失效 API prompt token 占用**。
`session-api-prompt-token-store.ts:16-18` 把「凡改变当前可见 prompt 的路径，成功后必须调
`invalidateSessionApiPromptTokenEntry`」写成硬约束；`setMessageFloorAtMessage`
（`service/chat/impl/message-transcript-effects.service.ts:186`）、`runCompaction`
（`run-compaction.ts:78`）、`message-rollback`（`message-rollback.service.ts:269`）都照做了，
唯独规则变更这条路径漏了。后果：改规则后 KKV 里的旧 `promptTokens` 仍以 api 口径
（`estimated:false`，跳掉 heuristic 0.85 安全垫）参与压缩阈值判定，读数也显示陈旧值。

已确认两个调用方都不补：
`apps/desktop/src/main/ipc/handlers/workplace.ts:74`、
`apps/mobile/src/services/workplace-rule-delta-draft.service.ts:17`。

**建议**：`refreshRuleSnapshot` 增一参 `sessionKkv` 已在手，直接在末尾
`await invalidateSessionApiPromptTokenEntry(deps.sessionKkv, sessionId)`。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-5 | P2 | `service/vfs/impl/revision-aware-vfs.service.ts:333-350`

```ts
if (existing == null) {
  assertValidVfsEntryName(normalized);
  await ensureParentDirectories(entryRepo, scopeKey, normalized);
  const maxRevision = await resolveMaxRevision(entryRepo, revisionRepo, scopeKey, normalized);
  if (maxRevision != null) { version = maxRevision + 1; await entryRepo.insertAtVersion(...); }
  else { const inserted = await entryRepo.insert(...); version = inserted.version; }
```

**描述**：`resolveMaxRevision`（`:421-432`）的实现是「先 `findByPath`，entry 不存在返回 null」。
而它**只在这一处、且只在 `existing == null` 的分支里被调用**——同一事务、同一 repo、
中间只插了父目录行，`findByPath` 必然仍返回 null。于是 `maxRevision != null` 恒假，
`insertAtVersion` 分支与 `resolveMaxRevision` 的注释（「这覆盖了「entry 已删但 revision 仍在」
的边界场景」）描述的边界**不可达**，实际永远走 `insert` 发 version 1。

对比 `vfs-tree-copy.ts:347` 的 `reviveEntryAtVersion` 才是真正保留 entry_id 复活的通道。
本函数这段是残留的旧实现。

**建议**：删除死分支与 `resolveMaxRevision`，或改为按 scope 前缀查 revision 的真实实现。
（若确有「批量回滚恢复后 entry 缺失但 revision 仍在」的可达路径，则实现与注释都要重写。）

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-6 | P2 | `service/vfs/impl/vfs-batch-io.service.ts:307-319`

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : "batch ingest transaction failed";
  const failedPath = this.testHook?.throwOnWriteLogical ??
    (plan.writes[0] ? joinTargetLogicalPath(target, plan.writes[0].relativePath) : target);
  return emptyReport(skippedBase, [{ path: failedPath, message }]);
}
```

**描述**：整批回滚后上报的 `failed[].path` **恒取 `plan.writes[0]`**，与真正抛错的那条写入
无关。用户在 UI 上看到的失败路径是随机的（取决于 plan 里第一条是谁），错误归因完全失真。
同时 `message` 是原始 `error.message`，不含路径，交叉验证更难。

**建议**：循环内捕获每条写入的失败路径再统一抛出（或在 catch 前记录 `currentLogical`），
让 `failedPath` 指向真实失败项。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-7 | P2 | `service/vfs/impl/vfs-batch-io.service.ts:251-254` + `:84-102`

```ts
const existing = await this.repo.findByPath(scopeKey(scope), logical);
if (existing != null && existing.entryKind === "file") {
  conflicts.push({ logicalPath: logical, reason: "exists" });
}
```
```ts
if (existing.entryKind === "directory") {
  throw new Error(`cannot overwrite directory with file: ${logical}`);
}
```

**描述**：plan 阶段只把「已存在**文件**」记为 conflict；「已存在**目录**、本次要写文件」
这一冲突在 plan 里查不出来（`detectIngestTypeConflict` 只在 plan 内部条目间查，
不查 VFS 现状）。它一路溜到 apply 的事务里，在 `writeOrUpdateFile` 抛
`cannot overwrite directory with file`，**整批回滚**，用户拿到的是
「一条无关路径的 failed」（叠加 F-6）+ 一句目录冲突文案，而不是一个可勾选覆盖的 conflict 提示。

**建议**：plan 阶段补 `existing.entryKind === "directory"` 的类型冲突检查，
归入 `BatchConflict`（需要一个新 reason 或复用 `exists` + 文案区分），
让用户走 overwrite 确认或先删目录。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-8 | P2 | `service/persistent-state/impl/persistent-state.service.ts:88-90, 100-102`

```ts
resetCurrentModelId(): Promise<void> {
  return this.reset(KEY_CURRENT_MODEL_ID);
}
resetCurrentAgentId(): Promise<void> {
  return this.reset(KEY_CURRENT_AGENT_ID);
}
```

**描述**：切模型 / 切 Agent（`setCurrentModelId:71` / `setCurrentAgentId:105`）走
`setAndInvalidatePromptTokenCache`，会双删 API prompt token 占用；
但对应的 **reset（复位成默认）路径不失效**。用户「把模型改回去 / 取消 agent 覆盖」后，
KKV 里那份按**旧模型口径**记的 `promptTokens` 继续参与压缩阈值判定，且因为是 api 值
（`estimated:false`）会跳掉 heuristic 的 0.85 安全垫——正是
`session-api-prompt-token-store.ts:16-18` 与 `session.service.ts:311-325` 反复强调要防的形态。

**建议**：`resetCurrentModelId` / `resetCurrentAgentId` 改走
`setAndInvalidatePromptTokenCache` 的孪生方法（reset 后指针为 undefined，同样要失效）。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-9 | P2 | `service/provider/impl/provider-model.service.ts:80-92`

```ts
for (const m of result.models) {
  const vendorModelId = normalizeVendorModelId(providerId, m.vendorModelId);
  seen.add(vendorModelId);
  await this.deps.suggestions.upsert({ providerId, vendorModelId, displayName: m.displayName ?? null, stale: false, lastSeenAtMs: Date.now() });
}
await this.deps.suggestions.markStaleExcept(providerId, seen);
```

**描述**：拉模型列表是 N 次串行 `upsert`（大 provider 可达数百条），无事务、无批量。
中途失败会留下「部分新、部分旧 stale 标记」的半更新状态，且 `markStaleExcept` 不会执行——
上一次拉取时存在、本次因网络截断没返回的模型**永远不会被标 stale**，用户模型列表里
长期挂着已下线的模型。另外 `Date.now()` 在循环内逐条取值，同一批行的 `lastSeenAtMs` 互不相同
（跨秒时会分裂成几批），对后续按时间排序/判鲜的逻辑不友好。

**建议**：批量 upsert（repo 若无批量接口则包事务）；`lastSeenAtMs` 在循环外取一次；
`markStaleExcept` 用 try/finally 保证执行。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-10 | P2 | `service/workplace/assemble-workplace-display.ts:222-238`

```ts
const parsed = parseRuleSnapshotJson(raw);
// 空数组视为未就绪：避免首次空快照粘住后工作区永久消失
if (parsed != null && parsed.length > 0) { return parsed; }
const view = await deps.workplace.evaluateRuleView();
const entries = ruleViewToSnapshotEntries(view);
await deps.sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, serializeRuleSnapshot(entries));
```

**描述**：快照解析成**合法空数组**时走「未就绪」分支，于是每次 assemble 都：
① 跑一遍完整规则评估（`evaluateRuleView` → `loadContextMetadata` 三四条 VFS 全表查询 +
规则表全读 + smart 规则编译）；② 往 KKV **写**一条 `[]`。
工作区确实为空（新建会话、未配任何目录规则，且 RULE.md 目录规则条目明确「无规则行 = rule_off」
意味着默认全关）是常态而非异常，于是**每轮对话都白跑一次全量评估 + 一次 KKV 写**，
写出来的内容还永远不会被下次读取采信。写放大 + 无谓 CPU。

**建议**：区分「未写过快照」与「快照确为空」——用 `raw == null` 判未就绪，
`raw != null` 即视为已就绪（含空数组）。若必须保留当前语义，则至少跳过重复写。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-11 | P2 | `service/vfs/impl/revision-aware-vfs.service.ts:302-315`

```ts
try {
  return await conn.transaction(fn);
} catch (error) {
  if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") {
    return fn(conn);
  }
  throw error;
}
```

**描述**：catch 判据只看**错误码**，不看错误来自何处。`conn.transaction(fn)` 内部若执行到
较深处某个内层组件对**另一条连接**发起了事务并抛 NESTED_TRANSACTION，这个错误会穿过
`fn` 冒泡到这里，被误判为「本层已在事务中」，于是 `fn(conn)` **整体重跑一遍**——
第一次执行中已提交的副作用（`insertDirectory` 补的父目录行、`ensureBlob` 写的 blob、
`decrementLiveRefsUnderScope` 的 ref_count 调整）会被重复施加。生产里 `tx` 已被
`TdbcConnection.transaction()` 包成 `TransactionalConnection`，NESTED 由它在**进入前**抛出，
所以目前大概率不可达；但这是个纯靠调用约定维系的隐式不变量，没有断言也没有注释标注
「只认 conn 层抛出的 NESTED」。

**建议**：改为在调用前判定（如 `conn instanceof TransactionalConnection` 或让 connection
port 暴露 `inTransaction()`），或至少在 catch 里加注释锁定该前提。

**置信**：suspected

---

### F-w9-ds2-servicevfs-b-12 | P3 | `service/workplace/impl/workplace.service.ts:86-102, 354, 367-370`

```ts
const files = [...input.fileSet];
for (const raw of input.configuredPaths) {
  ...
  const asDirKeep = input.dirRulePaths.has(n) &&
    (input.dirPathSet.has(n) || files.some((f) => f.startsWith(prefix)));
```

**描述**：两处小问题。
① `filterGhostConfiguredPaths` 对每条配置路径都 `files.some(...)` 全量扫文件集，
复杂度 O(配置数 × 文件数)；大工作区（数千文件 + 数百规则行）下每次
`loadContextMetadata` 都要跑一遍。改成先建 `Map<dir, true>` 或按前缀排序后二分可降到近线性。
② `fileSet` 用 `normalizePath(row.path)` 建（`:354`），`mtimeByPath` 却用**原始** `row.path` 建
（`:368-370`）。两把 key 空间不一致——若 repo 某天返回未规范化路径，
`renderFileBlock` 的 mtime 查表会 miss，渲染出 0/错时间戳。

**建议**：① 用前缀集合预计算；② `mtimeByPath.set(normalizePath(row.path), ...)`。

**置信**：confirmed（①）/ suspected（②，取决于 repo 是否恒返回规范路径）

---

### F-w9-ds2-servicevfs-b-13 | P3 | `service/vfs/impl/physical-vfs.service.ts:306-320, 284-293`

```ts
const queue = [...(await this.sessions.listByProject(projectId))];
while (queue.length > 0) {
  const s = queue.shift()!;
  sessions.push(s);
  queue.push(...(await this.sessions.listByParentSession(s.id)));
}
const withVisibility = await Promise.all(sessions.map(async (s) => ({
  s, visible: s.parentSessionId == null || (await this.hasSessionEntries(projectId, s.id)),
})));
```

**描述**：① 每列一次会话目录就发 `1 + N(子会话)` 条 SQL（`listByParentSession` 串行 +
每个子 agent 会话一次 `listEntriesUnderPrefix` 全前缀扫描）。会话多的项目在文件树
展开时是 O(N) 查询。② BFS 无 visited 集合，若 `chat_session.parent_session_id`
因任何原因成环（无外键约束、无 CHECK），这里会**死循环**把进程挂住。

**建议**：① 子会话可见性判定可先按 project 批量取一次有 entry 的 sessionId 集合；
② BFS 加 `visited` Set。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-14 | P3 | `service/prompt/normalize-orphan-tool-results-for-llm.ts:19-31, 56-80`

```ts
function isToolResultPairedInVisible(toolUseId, visibleMessages) {
  for (const msg of visibleMessages) { for (const block of msg.content.blocks) {
    if (block.type === "tool_use" && block.id === toolUseId) return true;
  }}
  return false;
}
```

**描述**：对**每一个** `tool_result` 块都全量扫一遍所有消息的所有块找配对的 `tool_use`，
复杂度 O(块数²)。长会话（数千消息、数千 tool_result）下这是每 step 都要付的平方级扫描。
注意第二遍已经用 `collectToolResultIds` 建了 Set（`:34-46`），第一遍完全可以用同一个
「所有 tool_use id 集合」一次建表替代。

**建议**：把 `collectToolResultIds` 扩成 `collectToolUseIds`，第一遍改成 Set 查表。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-15 | P3 | `service/persistent-preferences/impl/persistent-preferences.service.ts:96-105`

```ts
for (const key of keys) {
  try { const value = await this.kkv.get(PREFERENCES_MODULE, key); entries.push({ key, value }); }
  catch { /* Skip keys removed between list and get */ }
}
```

**描述**：注释说的是「键在 list 与 get 之间被删」，但 `catch` 是**裸 catch**，
把连接异常、SQLITE 错误、编码错误一并吞掉且不记日志。`nm preferences list` 在库出问题时
会安静地返回一份缺条目的列表，运维无从察觉。另外这是 N+1 查询（list 后逐条 get）。

**建议**：只吞 `isKkvError(error, "NOT_FOUND")`，其余 `console.warn` 后继续；
或给 `KkvService` 加 `getMany`。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-16 | P3 | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:194`

```ts
} else { target = Math.min(Math.max(0, to.index), ids.length - 1); }
```

**描述**：`to.index` 无 `Number.isInteger` 校验。传 `NaN` 时 `Math.min/max` 结果是 `NaN`，
`splice(NaN, 0, ruleId)` 按 0 处理——静默把规则挪到队首而非报错。
`index` 来自 IPC/CLI 的外部输入。

**建议**：入口处 `if (!Number.isInteger(to.index)) throw new SmartSortRuleError("INVALID_ARGUMENT", ...)`。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-17 | P3 | `service/template/logic/initialize-session-workspace.ts:41-49` / `logic/push-session-workspace.ts:34-40`

```ts
await replaceVfsSubtree(vfs, { scopeKey: `project:${projectId}` }, "/",
  { scopeKey: `session:${projectId}:${sessionId}` }, "/", {...});
```

**描述**：scope key 用模板字符串手拼，绕开了单源 `scopeKey(scope)`
（`domain/vfs/logic/vfs-path-mapper.ts:190-203`）。RULE 与 service/skills 那边都强调
scope key 是「两套键空间、严禁混用」，这里手拼等于把该不变量降级成复制粘贴。
（对照 `service/skills/impl/skills.service.ts:94-102` 同样手拼，但那处有注释标注原因。）

**建议**：改用 `scopeKey({ kind: "project", projectId })` / `scopeKey({ kind: "session", projectId, sessionId })`。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-18 | P3 | `service/vfs/impl/vfs-batch-io.service.ts:328-354` vs `:280-285`

**描述**：同一份 `BatchIngestPlan`，两条 apply 路径对「有 conflict 且未确认覆盖」的语义**不一致**：
`applyBatchIngest` 返回 `skipped = [...二进制, ...全部 conflict]`、`written: []`（**什么都不写**）；
`applyBatchIngestWithWriter` 只把 conflict 塞进 `skipped`，**其余非冲突文件照写**。
desktop 侧 `apps/desktop/src/main/services/vfs-batch.service.ts:210-226` 按
「session scope 且统一 tool turn 开启」二选一，同一个用户在设置项切换前后会看到
「导入要么全不动、要么部分生效」两种行为。

**建议**：统一为一种语义（建议对齐 `applyBatchIngestWithWriter`：写非冲突项、冲突项进 skipped），
或至少在 port 注释里显式写明二者口径不同及原因。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-19 | P3 | `service/provider/impl/provider-model.service.ts:123-125` + `provider-model.port.ts:57-58`

**描述**：`create(providerId, vendorModelId)` 是 `save(providerId, vendorModelId)` 的
一字不差别名（`save` 的第三参 `modelName` 在 `create` 里根本没暴露）。
接口面上两个方法、两个 IPC handler、零语义差异，属重复导出面。

**建议**：删 `create`，调用方统一走 `save`；或让 `create` 真正成为「快速添加（带默认名）」
的独立语义并在注释里写明差异。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-20 | P3 | `service/skills/impl/skills.service.ts:259-265, 268-277, 302-309`

**描述**：`listSkills` 先 `vfs.list(SKILLS_ROOT, { recursive: true })` 拉全树，
再对每个技能 `summarizeSkill` 单独 `vfs.read(SKILL.md)` 解析 front matter——N+1 读。
`effectiveSkills` 又并发跑 `listSkills("global") + listSkills({projectId}) + listDisabledNames`，
即每轮 run 装配（agent-runner `budgetSkillsIndexEntries` 的数据源）都要付两次全树列 + 2N 次读。
技能文件多时是可观的固定开销。

**建议**：合并成一次递归列 + 一次批量 content 读（`list` 侧若能带 content 或走
`getMany` 形态的 scanContents），或对 `summarizeSkill` 的 front matter 做按
`(mtimeMs, version)` 的短 TTL 记忆缓存。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-21 | P3 | `service/vfs/impl/vfs.service.ts:50-58`

```ts
const entries = await this.repo.list(scopeKey, normalized, options);
if (normalized !== "/" && !isStorageRootParent(normalized)) {
  const entry = await this.repo.findByPath(scopeKey, normalized);
  if (entry == null && entries.length === 0) { throw vfsNotFound(normalized); }
}
```

**描述**：每次 `list` 额外发一条 `findByPath` 只为区分「目录不存在」与「空目录」。
`list` 是 UI 文件树展开与工具 list 的高频调用，该查询随调用次数线性叠加。
另外此处对**文件路径**调 `list` 不会报错（entry 非 null → 直接返回 `[]`），
调用方拿空数组与「空目录」无法区分。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-22 | P3 | `service/provider/impl/provider.service.ts:51-59`

```ts
const rows = await this.deps.providers.list();
return Promise.all(rows.map(async (p) => ({ ...p, apiKeyStatus: await this.apiKeyStatus(p) })));
```

**描述**：`list()` 对每个 provider 发一次 `secretStore.has()`（SKSP 可能落库），
服务商多时是 N 次串行 IO，只为把 `'set' | 'not set'` 填进列表 DTO。

**建议**：secretStore 若支持前缀批量则批查；否则该字段改由调用方按需取
（`get(id)` 已经会算），或加进程内短 TTL 记忆。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-23 | P3 | `docs/apm/RULE.md` 工作区与存储层 · 技能域条目

**描述**：RULE.md 技能域条目仍写「编辑已存在技能走 VFS 乐观锁——保存须透传 read 时拿到的
version（`writeSkillFile` 的 `expectedVersion`），否则必撞 CONFLICT」。但代码里
`SkillService.writeSkillFile`（`service/skills/skills.port.ts:104-111`）**没有** `expectedVersion` 参数，
实现注释明写「版本比对已从 VFS 底层移除：last-write-wins」
（`service/skills/impl/skills.service.ts:368`）。RULE.md 另一条「VFS write/edit/skill 工具的
并发语义」已记录 2026-09-06 拍板全拆乐观锁（`60af90b`）。即 RULE.md 内部两条自相矛盾，
技能域那条是未同步的旧描述。

**建议**：更新 RULE.md 技能域条目，删除 `expectedVersion` / CONFLICT 描述，改述为
「乐观锁已于 60af90b 全拆，last-write-wins，同文件并发保护靠 toolRunner pathTail 串行化」。

**置信**：confirmed

---

### F-w9-ds2-servicevfs-b-24 | P3 | `service/compaction-conditions/run-compaction.ts:15-22` vs RULE.md 压缩条目

**描述**：代码头注释记录「2026-09-29 用户拍板『压缩与文件缓存无关』，压缩**不再清**
`rule_snapshot` + `file_cache`」，`session-kkv.port.ts:15-17` 也同步改了
（「压缩不再清——见 run-compaction 头注释」）。但 RULE.md 压缩条目仍写
「副作用：清 `rule_snapshot` + `file_cache`」。代码是新的（有用户拍板背书），
RULE.md 是陈旧的。

**建议**：同步 RULE.md 压缩条目，注明 2026-09-29 改口径及原因
（压缩发生在回合中段，回合快照语义要求前缀回合内冻结）。

**置信**：confirmed

---

## 争议与存疑

1. **F-5（`resolveMaxRevision` 死分支）的处置方向未定**。我判定该分支不可达
   （`existing == null` 时二次 `findByPath` 必仍为 null）。但注释描述的
   「批量回滚恢复后 entry 缺失、revision 仍在」是否真有一条**不经过
   `reviveEntryAtVersion`** 的路径可达，我没有把 `message-checkpoint` 域全查一遍
   （超出本区边界）。若那条路径存在，则问题从「删死代码」升级为
   「版本号回退到 1 会与既有 vfs_revision 撞唯一键」——那才是 P0/P1 级。
   **建议 reduce 阶段把这条送去跨区核实**（域：`domain/vfs` + `service/message-checkpoint`）。

2. **F-1（模板拉取不清缓存）需要产品口径确认**。我按「同类 session-scope 子树替换
   必须清缓存对齐」这一既有 RULE 判定为缺陷。但存在另一种可能：
   拉取本就设计成「用户在 UI 上明确点了『恢复模板』，随后必然触发一次
   `refreshRuleSnapshot` 或重开会话」，因而清缓存被视为冗余。我未找到
   desktop / mobile 拉取成功后主动刷规则快照的证据（handler `sessions.ts:98-102`
   甚至没发 `workspaceMutated` 通知，push 侧 `:121-126` 才发），所以倾向维持 P1，
   但这条的严重度取决于 UI 侧是否有别的补偿。

3. **F-4 / F-8 是否算同源**。两者都是「改了 prompt 却没失效 API prompt token 占用」，
   修法一致但落点不同（一个在 workplace service、一个在 persistent-state）。
   若 reduce 阶段要做横向台账，这两条应归到同一个失效挂点缺口清单下，
   与 `session-kkv-domains.ts:48` 的「路径清单」做对照——那份清单里是否有
   `refreshRuleSnapshot` 与 `resetCurrentModelId`，我没有逐条比对（该文件不在本区）。

4. **`runInTransactionOrConn`（F-11）我倾向 suspected 而非 confirmed**。要证伪/证实需要
   读 `infra/tdbc` 的 `TransactionalConnection` 实现与 mutex 语义，属本区外。
   仅从调用侧看，`session-fs` / `skills.updateSkillInfo` 都提供了「事务内用 tx 建 scoped vfs」
   的先例，说明嵌套是被预期的——但那说明的是**预期路径**，不构成对 F-11 的反证。

5. **本区未覆盖的横切面**（留给其他机位）：`vfs_content_blob.ref_count` 触发器维护、
   `deleteUnreferencedUnderScope` 与 checkpoint 指针的交互、message rollback 的
   reconcile 正确性、`domain/vfs/logic/vfs-tree-copy.ts` 的 copy/replace 语义
   （本区只作为调用方引用，未审其内部）。
