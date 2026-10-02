---
zone: w9-ds2-servicevfs-a
agent: domain-survey（独立双扫 A 面）
files_scanned: 74
scope: packages/core/src/service/{vfs,workplace,skills,kkv,session-kkv,persistent-preferences,persistent-state,smart-sort-rule,template,compaction-conditions,prompt,provider}/**（含 impl/ logic/ 子目录）
independence: 未读取 raw/ 与 synth/ 下任何文件
---

# w9-ds2-servicevfs-a —— service 层 vfs/workplace/技能/KKV/偏好/排序/模板/压缩/prompt/provider 全量测绘

## 摘要

本区是 core 的「应用服务装配层」：把 domain 层的 repo / 逻辑纯函数接到 `TdbcConnection` 上，
产出 apps 三端（cli / desktop / mobile）唯一的服务入口。核心是 VFS（scopeKey + 逻辑路径）、
常驻工作区（workplace 规则快照 + file_cache 前缀组装）、技能域（两域 meta VFS）、
会话/全局 KKV 薄封装，以及模板拉取/推送、压缩执行、提示词装配、provider CRUD 与 LLM 请求重试。
12 个子域共 74 个文件、约 4400 行生产代码。

## 职责与边界

- **vfs/**：`InternalVfsService`（core 内核，scopeKey + 逻辑路径）→ `RevisionAwareVfsService`（写时追加
  `vfs_revision` + `ref_count`）→ `ScopedVfsService`（对外 apps 契约，隐藏 scope）。另有
  `DefaultPhysicalVfsService`（只读物理视图，把 global/project/session × 普通/meta 四域拼成
  `/template` `/meta` `/projects/{pid}/…` 统一树）、ZIP / 角色卡 / 批量 ingest-export 三个 IO 服务。
- **workplace/**：规则引擎的应用侧（`DefaultWorkplaceService` + conn 级 L1 memo）、
  常驻前缀组装引擎（`assembleWorkplaceDisplay`）、规则保存后的快照刷新（`refreshRuleSnapshot`）。
- **skills/**：两域（global-meta / project-meta）技能 CRUD，文件读写全部走 `ScopedVfsService`，
  负清单走 `skill_disabled_rule`。
- **kkv / session-kkv**：薄封装。全局模块级 KKV（`kkv_entry`）与会话路由 KKV（`session_kkv_entry`
  + 去重化后的 `session_file_cache_entry` / `session_file_cache_blob`）。
- **persistent-preferences / persistent-state**：`nm-preferences` / `nm-workspace-state` 两个 KKV 模块的
  类型化门面。
- **smart-sort-rule**：`smart_sort_rule` 表的 CRUD / 调序 / 导入导出 / 编译 / 预览。
- **template/**：project→session 初始化（拉）与 session→project 推送两条整树覆盖链。
- **compaction-conditions**：`nm-compaction-conditions` KKV 的 v2→v3→v4 迁移、OR 触发器评估、
  压缩执行器（hide-message + token cache 失效）。
- **prompt/**：三区 layout 的单次遍历装配（segments / messages / CLI 文本）、thinking 上下文出站变换、
  孤儿 tool_result / tool_use 归一。
- **provider/**：provider CRUD（CoordinatedWrite 补偿式跨资源写）、saved model、LLM 请求重试。

边界：本区**不含**实现语义（规则引擎、rename 原语、blob 存储、深度切片、协议适配器），
这些都在 `domain/` 与 `infra/`；本区只做「接线 + 事务边界 + 缓存失效编排」。

## 对外接口

| 工厂 / 函数 | 文件 | 导出面 |
| --- | --- | --- |
| `createVfsService` → `InternalVfsService` | service/vfs/create-vfs-service.ts:21 | 内部（core 内核接线） |
| `createScopedVfsService` → `VfsService` | service/vfs/create-scoped-vfs-service.ts:21 | public/vfs |
| `createPhysicalVfsService` → `PhysicalVfsService` | service/vfs/create-physical-vfs-service.ts:16 | public/vfs |
| `createVfsZipIoService` / `createVfsBatchIoService` / `createCharacterCardImportService` | 同目录 | public/vfs |
| `buildUserVfsDeleteOp/MkdirOp/RenameOp/CreateFileOp/SaveOp` | service/vfs/build-user-vfs-turn-op.ts | public/vfs |
| `matchGlob` | service/vfs/glob-match.ts:12 | 内部（vfs.service + scoped-vfs.service 共用） |
| `createWorkplaceService` → `WorkplaceService` | service/workplace/create-workplace-service.ts:22 | public/workplace |
| `assembleWorkplaceDisplay` / `WorkplaceAssemblyAbortedError` / `layoutHasWorkplace` | service/workplace/assemble-workplace-display.ts:130 | public/workplace |
| `refreshRuleSnapshot` | service/workplace/refresh-rule-snapshot.ts:29 | public/workplace |
| `createSkillsService` → `SkillService` | service/skills/create-skills-service.ts:21 | public/skills |
| `createKkvService` / `createSessionKkvService` | service/kkv/create-kkv-service.ts:17、service/session-kkv/create-session-kkv-service.ts:17 | 子路径 / public |
| `createPersistentPreferences` / `createPersistentState` | 同名文件 | public |
| `createSmartSortRuleService` | service/smart-sort-rule/create-smart-sort-rule.service.ts:18 | public/smart-sort-rule |
| `createTemplatePullService` | service/template/create-template-pull-service.ts:14 | public/template |
| `createCompactionConditionsStore` / `createCompactionConditionEvaluator` / `runCompaction` | service/compaction-conditions/* | public/compaction |
| `buildPromptLlmInputFromLayout` / `buildPromptAssemblyFromLayout` / `buildPromptPreviewSegmentsFromLayout` / `formatPromptLlmInputForCliFromLayout` / `computeLlmExportZonesFromLayout` | service/prompt/render-prompt.ts | public/prompt |
| `applyThinkingContextForLlm` / `normalizeOrphanToolResultsForLlm` / `resolvePreviewThinkingContext` | service/prompt/* | public/prompt |
| `createProviderServices`（providers / providerModels / modelRequests + 两个 repo） | service/provider/create-provider-services.ts:35 | public/provider |
| `createModelRetryPolicyService` / `resolveTokenCounterModeForModel` | service/provider/* | public/provider |

## 数据访问

**触碰的表**（本区直接或经 repo 间接）：

| 表 | 触点 | 证据 |
| --- | --- | --- |
| `vfs_entry` / `vfs_revision` | 全部 vfs 服务、skills、template、physical-vfs | vfs.service.ts:42-248；revision-aware-vfs.service.ts:81-296；skills.service.ts:437-461 |
| `vfs_content_blob` | RevisionAwareVfsService.resetHead、template 树复制 | revision-aware-vfs.service.ts:167,197；logic/initialize-session-workspace.ts:8,45 |
| `chat_message` | 角色卡 / ZIP 导入补 baseline checkpoint | impl/character-card-import.service.ts:172；impl/vfs-zip-io.service.ts:235 |
| `message_checkpoint` / `message_checkpoint_file` | 同上（`backfillBaselineCheckpoints`） | 同上 |
| `chat_project` / `chat_session` | physical-vfs 虚拟目录枚举 | impl/physical-vfs.service.ts:118-122,190,249,336 |
| `workplace_dir_rule` / `workplace_file_rule` | workplace 服务、导入补行 | impl/workplace.service.ts:124-203；logic/ensure-import-dir-rules.ts:114 |
| `skill_disabled_rule` | skills 启停 / 删除 / 改名 | impl/skills.service.ts:411,449-460,583-590 |
| `smart_sort_rule` | smart-sort-rule 全服务 | impl/smart-sort-rule.service.ts:66-382 |
| `kkv_entry` | kkv / persistent-* / compaction-conditions / retry-policy / model-suggestions | service/kkv/impl/kkv.service.ts:18-37；create-kkv-service.ts:18 |
| `session_kkv_entry` + `session_file_cache_entry` / `session_file_cache_blob` | session-kkv、workplace 前缀、清理四件套 | service/session-kkv/impl/session-kkv.service.ts:16-56；logic/clear-session-prompt-caches.ts:34-47 |
| `llm_provider` / `llm_saved_model` / secretStore（SKSP） | provider CRUD | impl/provider.service.ts:92-273；impl/provider-model.service.ts:119-235 |

**KKV 模块 / 域**：

- 全局模块：`nm-preferences`（preference-keys.ts:8）、`nm-workspace-state`（workspace-state-keys.ts:8）、
  `nm-compaction-conditions`（impl/compaction-conditions-store.service.ts:19）、
  `nm-model-retry`（impl/model-retry-policy.service.ts:17）、`nm-model-suggestions`（create-provider-services.ts:41）。
- 会话域（sessionId 路由）：`rule_snapshot`、`file_cache`、`user_vfs_pending`（历史域，RULE 记载已无写入方）、
  `prompt_tokens`、`usage_stats`（见 logic/clear-session-prompt-caches.ts:11-16）。
- **两套不同键空间严禁混用**：VFS 表用 `scopeKey(...)`（session 域为 `session:{pid}:{sid}`），
  workplace 表用 `workplaceScopeKey(...)`（session 域为 `session:{sid}`）。本区唯一显式点出并守住的
  地方是 ensure-import-dir-rules.ts:87-89。

**文件路径**：本区不直接做文件系统 IO；模板导出物化由 desktop 侧 `vfs-batch.service.ts` 落 userData。

## 依赖关系

**import 了谁**（主要）：

- `domain/vfs/*`（path-mapper、vfs-rename-primitive、vfs-tree-copy、seed-live-head-revisions、zip 解析/构建/校验）
- `domain/workplace/*`（rule-engine、workplace-materialize-engine、file-tree、rule-snapshot-codec）
- `domain/session-kkv/model/session-kkv-domains.js`（域常量单源）
- `domain/skills/*`、`domain/smart-sort-rule/*`、`domain/provider/*`、`domain/character-card/*`
- `infra/tdbc`、`infra/llm-protocol`、`infra/tokenizer/logic/session-api-prompt-token-store`、`infra/sksp`
- `service/coordinated-write.js`、`service/chat/message.port`、`service/chat/user-vfs-turn.port`
- `bootstrap/skills/seed-builtin-skills`（BUILTIN_SKILL_NAMES）、`bootstrap/smart-sort-rule/builtin-smart-sort-rules`

**被谁消费**（生产侧）：

- 三端 runtime 工厂：`apps/cli/src/runtime.ts:194-266`、`apps/desktop/src/main/runtime/create-desktop-runtime.ts:102-192`、
  `apps/mobile/src/runtime/create-mobile-runtime.ts:85-189`（physicalVfs / skills / smartSortRule /
  compactionConditions / kkv 全部经本区工厂装配）。
- `apps/desktop/src/main/services/vfs-batch.service.ts:193,220`（批量 ingest）、
  `apps/desktop/src/main/ipc/handlers/workplace.ts:74,113,132`（refreshRuleSnapshot）。
- `apps/mobile/src/services/workplace-rule-delta-draft.service.ts:17`、`VfsFileManager.tsx:405,687,726`。
- `apps/cli/src/prompt/commands.ts:154`（CLI 预览文本）、
  `packages/core/src/infra/tokenizer/logic/serialize-prompt-input.ts:20`（token 计数序列化）。
- `apps/desktop|mobile/src/services/chat-prompt-tokens.service.ts`（resolveTokenCounterModeForModel）。
- `packages/core/src/service/chat/impl/session.service.ts:236,243`（模板拉取/推送）。
- `packages/core/src/bootstrap/skills/seed-builtin-skills.ts:182`（内置技能种入）。

**依赖方向健康度**：本区是叶子装配层，没有反向依赖；`service/prompt` 只 import type 侧的
`service/persistent-preferences`（resolve-preview-thinking-context.ts:23），未形成环。

## 发现清单

### F-w9-ds2-servicevfs-a-1 | P1 | service/template/impl/template-pull.service.ts:24-49

```
await this.conn.transaction(async (tx) => {
  await initializeSessionWorkspace(tx, session.projectId, sessionId, { clearCheckpoints: true });
});
await runDeferredBlobGc(this.conn);
```

**描述**：模板拉取（project 模板 → session 工作区）与推送（session → project）都是
**session 域整树覆盖**，但两条链**完全没有清 `rule_snapshot` + `file_cache`，也没失效 prompt token 缓存**。
唯一的上层入口 `session.service.ts:234-246`（`pullTemplate` / `pushTemplate`）同样只调
`DefaultTemplatePullService`，desktop `handlers/sessions.ts:98,119`、mobile
`TemplatePullButton.tsx:45` / `TemplatePushButton.tsx:48`、cli `session/template.ts:22` 之后也没有任何补刀
（`git grep pullTemplate/pushTemplate` 全仓核实）。

这与 RULE「导入缓存对齐（session 导入三件套）」条目要求的口径直接冲突：同一类「session 域子树被换掉」
的操作，角色卡导入（impl/character-card-import.service.ts:196-198）与 ZIP 导入
（impl/vfs-zip-io.service.ts:258-260）都在事务提交后调 `clearSessionPromptCaches`，唯独模板链漏了。

**后果链（已核实到底）**：`clear-session-prompt-caches` 清的正是 assemble 的两个输入源；
而 `load-or-fill-file-cache.ts:42-58` 的 `loadOrFillFileCache` **命中即无条件返回、不校验 mtime**
（assemble-workplace-display.ts:170-176 同款），RULE「常驻工作区」条目也明写「前缀回合内天然冻结」。
于是用户改模板 → 拉取 → 下一次发消息，`rule_snapshot/canon` 仍是旧 path/status，
`file_cache` 命中旧正文，前缀把**已不存在的旧内容**原样喂给模型，且要等改规则 / 置位 / 压缩才自愈。
push 方向同理（session 改了文件、推给 project 后，本会话前缀不受影响，影响的是下一个新建会话——
但同样没有失效链）。

**建议**：`sessionTemplatePull` 事务提交后补一行
`await clearSessionPromptCaches(sessionId, createSessionKkvService(this.conn))`
（口径与导入一致：best-effort 吞错 + warn，不让拉取失败）。push 方向若确认无影响可只清 prompt token，
但为对称建议同款。补一条回归测试：拉取后 `file_cache` 域为空 / 正文等于模板新内容。

**置信**：confirmed（代码读得出来，且 `loadOrFillFileCache` 无 mtime 校验已逐行核实）。

---

### F-w9-ds2-servicevfs-a-2 | P2 | service/vfs/impl/vfs-batch-io.service.ts:100-101

```
// 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义
await repo.update(sk, logical, content, existing.version + 1);
```

**描述**：批量 ingest **覆盖既有文件**时直接调 `SqliteVfsEntryRepository.update`，
既不 append `vfs_revision`、也不调 `adjustRef` / `transferLiveRef`——即绕开了
`RevisionAwareVfsService.write` 的版本链通道（对比 revision-aware-vfs.service.ts:382-394）。
注释里的前提「无 revision 层」早已过期（仓库已有 `vfs_revision` + `ref_count` + checkpoint 指针）。

命中面比看上去大：desktop `vfs-batch.service.ts:210-226` 只在
「session scope **且** userVfsUnifiedToolTurn 开启」时走 writer 通道（走 ScopedVfsService，有版本链）；
**其余全部落 `applyBatchIngest`**——含所有 project / global 批量导入，以及关闭统一 tool turn 时的
session 批量导入。

**后果**：head_version 前进到一条**不存在于 `vfs_revision` 的版本**。
`nextVersionFor`（max(head, MAX)+1）能自愈发号，但导入前的正文已不在版本历史里，
后续 `deleteUnreferencedUnderScope` 会把 ref_count=0 的旧 revision GC 掉 → **不可回滚**；
project 域当前无 checkpoint 所以即时影响有限，但 session 域（关 tool turn 的旧口径）会直接
破坏 checkpoint 基线语义。

**建议**：批量 ingest 的写入载体改走 `RevisionAwareVfsService`（事务内 `createScopedVfsService(tx, scope)`，
VFS 内部对 `TransactionalConnection` 会立刻抛 NESTED_TRANSACTION 后复用 tx 直通，见
revision-aware-vfs.service.ts:302-315 与 skills.service.ts:466-471 的既有先例）；或至少同步 append revision + 转移 ref。

**置信**：suspected（代码事实确凿；「是否真的造成可观测回滚损失」需在 session scope + 关 tool turn 下跑一次回滚用例确认）。

---

### F-w9-ds2-servicevfs-a-3 | P2 | service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249（resetDefaults 同款，:261-287）

```
await this.deps.rules.deleteAll();
for (const entity of entities) {
  await this.deps.rules.insert(entity);
}
```

**描述**：`importRules` 是「整表清空 + 按文件顺序逐条插入」，**没有事务**。中途任一条抛错（校验已过，
但 UNIQUE / IO / 驱动异常都可能）就留下**半张表**。`resetDefaults` 同样是「逐条删 builtin → 逐条重灌 →
renumber 逐条 UPDATE」，三段各自独立提交。

本服务全程没有持有 `TdbcConnection`（`SmartSortRuleServiceDeps` 只有 repo + builtinSeed，
create-smart-sort-rule.service.ts:18-25），所以要上事务得先把 conn 透进来。

**建议**：deps 加 `conn`，`importRules` / `resetDefaults` / `renumber` 包一个
`conn.transaction`（注意 repo 要在事务内重建，同 skills.service.ts:439 先例）。

**置信**：confirmed（无事务是代码事实；崩溃窗口的具体后果依赖驱动，但 better-sqlite3/op-sqlite 都是逐语句提交）。

---

### F-w9-ds2-servicevfs-a-4 | P2 | service/compaction-conditions/run-compaction.ts:70-72

```
} catch {
  return { ok: false };
}
```

**描述**：`runCompaction` 把 `runHideMessageAction` 的**所有**异常吞成一个 `ok: false`，
无 `console.warn`、无日志、无错误透传。同一 zone 内的所有 best-effort 路径都带 warn
（clear-session-prompt-caches.ts:48-53、ensure-import-dir-rules.ts:127-133），
这里是唯一的哑巴口子。

而 `ok:false` 在契约上还被复用为「锚不出真用户输入 → 放弃本次压缩」（hide-message.action.ts:73-76 的
`range == null` 直接 return，走的是成功路径）。所以调用方看到 `ok:false` **无法区分**
「正常放弃」与「DB 写失败 / SQL 异常」。

**建议**：至少 `console.warn(\`runCompaction: hide-message 失败…\`, error)`；
若调用方需要区分，建议把 `hide-message.action.ts` 的「锚不出 → 放弃」显式返回
`{skipped:true}` 而不是靠 `ok:false` 表达。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-5 | P2 | service/prompt/normalize-orphan-tool-results-for-llm.ts:56-80

```
if (block.type === "tool_result" &&
    !isToolResultPairedInVisible(block.toolUseId, messages)) {
```

**描述**：第一遍里，每个 `tool_result` 块都触发一次 `isToolResultPairedInVisible`，
而后者是**全量线性扫描所有消息的所有块**（:19-31）。整体复杂度 O(B²)，B = 可见历史块总数。
长会话（几百条消息、每条含 tool_use/tool_result/thinking 若干块）下这是每次 LLM 出站前的固定开销。
同文件第二遍已经用 `Set` 做对了（`collectToolResultIds`，:34-46），第一遍没跟上。

**建议**：进循环前先 `const toolUseIds = collectToolUseIds(messages)`（一次 O(B) 收集），
`isToolResultPairedInVisible` 改成 `toolUseIds.has(toolUseId)`。

**置信**：confirmed（复杂度事实）；实际耗时未实测，按 B≈2000 估约 4×10⁶ 次块访问，值得改但不是 P0/P1。

---

### F-w9-ds2-servicevfs-a-6 | P3 | docs/apm/RULE.md:15-16 vs service/compaction-conditions/run-compaction.ts:12-18

**描述**：RULE 的「置位」「压缩」两条仍写「副作用：清 `rule_snapshot` + `file_cache`」，
但代码在 2026-09-29 已按用户拍板「压缩与文件缓存无关」改成**只失效 prompt token cache**，
理由（压缩发生在 agent 回合中段、清缓存会破坏「回合内前缀冻结」不变量）写得很清楚。
同一 zone 的 `session-kkv.port.ts:13` 已经同步更新为「压缩不再清」，**只有 RULE.md 没跟上**。

**建议**：把 RULE 两条改成「置位清两域；压缩不清（2026-09-29 用户拍板）」，保留原拍板理由。
否则下一个 agent 读 RULE 会去给 run-compaction 补一个不该有的 clearDomain。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-7 | P3 | docs/apm/RULE.md:29 vs service/skills/impl/skills.service.ts:367-370

RULE 技能条目仍写「编辑已存在技能走 VFS 乐观锁——保存须透传 read 时拿到的 version
（`writeSkillFile` 的 `expectedVersion`），否则必撞 CONFLICT」；
代码是 `// 版本比对已从 VFS 底层移除：last-write-wins` 且 `writeSkillFile` 签名里**根本没有**
`expectedVersion`（skills.port.ts:104-111）。RULE 末条「VFS write/edit/skill 工具的并发语义」
（2026-09-06 拍板全拆乐观锁）才是现行口径。

**建议**：把技能条目里乐观锁那句删掉，改为指向末条的 last-write-wins + pathTail 同路径串行化。
另注：`skills.port.ts:98-101` 的 JSDoc 也复制了同一句过期描述（说「须透传 version」），
**同一处错误有两份**，改的时候一起。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-8 | P3 | service/session-kkv/create-session-kkv-service.ts:13

```
* 创建基于 SQLite `session_kkv_entry` 的 {@link SessionKkvService}。
```

`file_cache` 域早已去重化：正文压 `session_file_cache_blob` 全库一份、会话侧
`session_file_cache_entry` 存引用，repository 透明分流（RULE「KKV（session KKV）」条目）。
工厂注释还停在单表形态，容易让后来者以为改 `session_kkv_entry` 就能改到正文。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-9 | P3 | service/vfs/impl/physical-vfs.service.ts:224

```
result = await createScopedVfsService(this.conn, resolved.scope).read(resolved.logicalPath);
```

**描述**：物理树每次 `read` 都新建一整套服务（2 个 repo + 2 个装饰器 + ScopedVfsService）。
全局文件浏览器逐个文件预览时会反复走这里。工厂本身很轻（无 IO、无单例状态），属可接受的
小分配，但和 `createWorkplaceService` 已知的「每次调用 new 新实例」的坑同源，值得记一笔。

**建议**：构造函数里预建一个 `map<scopeKey, VfsService>` 惰性缓存（scope 只有 5 种）。

**置信**：confirmed（事实）／影响 P3。

---

### F-w9-ds2-servicevfs-a-10 | P3 | service/skills/impl/skills.service.ts:259-262 与 :636-645

- `listSkills` 对每个技能 `await this.summarizeSkill(...)`（:261）——**串行 N 次 read**，
  可 `Promise.all` 并发或直接复用 `list` 结果里已有的 content。
- `skillDirExists`（:636）用 `listEntriesUnderPrefix(scopeKey, prefix)` 拉**整个子树**再 `.some()`，
  只为判存在；技能目录大时白拉。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-11 | P3 | service/persistent-preferences/impl/persistent-preferences.service.ts:87-100

`list()` 先 `kkv.listKeys(MODULE)` 再**串行** `kkv.get` 每键一次 —— 经典 N+1。
当前 4 个偏好键，量小无痛；但 `setPreference` 是公开的任意键写入口（见 F-13），键数无上界。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-12 | P3 | service/vfs/impl/vfs-batch-io.service.ts:136-148

`detectIngestTypeConflict` 对每个条目遍历整个 `pathKind` map 查 `startsWith`，O(n²)。
一次拖几百个文件进 VFS 就是几万次字符串比较——量级不大但零成本可改（改成建一个 file 路径集合再查前缀）。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-13 | P3 | service/skills/persistent-preferences 端口自述与实现相悖

`persistent-preferences.port.ts:8` 写「v1 frozen preferences；v2 extends via explicit typed methods
(**no raw UI writes**)」，但同一接口 :39-40 公开了 `getPreference(key)` / `setPreference(key, value)`
裸读写任意键。注释与导出面矛盾，容易被当成「不该用的口子」而实际双端在用。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-14 | P3 | service/provider/impl/provider-model.service.ts:141-147

`editSaved(modelName?: string)` 的实现里有 `if (modelName === null) throw ...` 分支，
而端口签名 `provider-model.port.ts:17` 与实现签名都不含 `null`。这是一段永不可达的死分支
（大概是历史 nullable 契约的残留）。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-15 | P3 | service/provider/impl/provider-model.service.ts:80-92

`fetch` 逐条 `await suggestions.upsert(...)`，全部成功后才 `markStaleExcept`。
中途失败会留下「部分新 + 全部旧 stale 标记未更新」的中间态（无事务、无回滚）。
模型列表拉取是网络操作后接 N 次本地写，失败概率不高但不是零。

**建议**：包一个 `conn.transaction`（`DefaultProviderModelServiceDeps` 已持有 `conn`）。

**置信**：confirmed。

---

### F-w9-ds2-servicevfs-a-16 | P3 | service/vfs/glob-match.ts:50-53

```
if (segment === "**") {
  if (pi === pattern.length - 1) {
    return true;
  }
```

尾部 `**` 直接吞掉剩下所有段（含**零**段），于是 `a/**` 会匹配路径 `a` 本身、
`**` 会匹配任意路径（含空语义下的 `/`）。与主流 glob（`**/` 至少要吃掉一段）不完全一致。
当前调用方（`vfs.glob` 工具 / grep 的 pathGlob）都是「宽松更好」的方向，实际不构成 bug，
但作为对模型暴露的 glob 语义，值得在注释里写明「尾部 `**` 允许匹配零段」。

**置信**：confirmed（语义事实）／影响 P3。

---

## 刻意设计（标 intentional，不当问题报）

| 现象 | 出处 |
| --- | --- |
| `VfsService.replace` 是「事务外读 → 内存替换 → 写回」非原子 | RULE「VFS write/edit/skill 工具的并发语义」：用户 2026-09-06 拍板全拆乐观锁；RULE 末条同时点名两处已知盲区（原始键比对、跨 runner 实例）为拍板接受 |
| 压缩**不**清 `rule_snapshot` / `file_cache` | run-compaction.ts:8-18（2026-09-29 用户拍板，理由=回合内前缀冻结不变量）。仅 RULE.md 过期，见 F-6 |
| 角色卡 / ZIP 导入整体 try/catch 吞错（best-effort），置位 / 压缩裸 await | clear-session-prompt-caches.ts:20-28 与 RULE「导入缓存对齐」条目：口径**有意不同**，文件已落库不该让导入报错 |
| `ensureImportDirRules` 在**事务内**吞错（靠 SQLite 语句级失败不自动 ROLLBACK） | ensure-import-dir-rules.ts:10-13，注释声明由 T-I5 故障注入用例守卫 |
| 事务内用 tx 新建 scoped vfs（不捕获原 conn 的工厂） | skills.service.ts:464-474：否则与外层事务 mutex 互等死锁；VFS 内部 `runInTransactionOrConn` 遇 NESTED_TRANSACTION 即复用 tx（drivers 均为**立即 reject、不执行 fn**，见 tdbc-driver-better-sqlite3/src/connection.ts:204-212，故无「重复执行」风险） |
| `DefaultVfsService` 的 `resetHeadToVersion` / `renamePath` / `renamePrefix` 抛 unsupported、`hardDelete` 退化为 `delete` | vfs.service.ts:206-247 头注释：生产 wiring 走 `RevisionAwareVfsService`，这些分支只在裸构造 Default 时可达；「禁止静默 no-op」是有意的 fail-fast |
| `setDirRule` 任何不带 `--rule off` 的保存都会重新启用规则 | impl/workplace.service.ts:128；与 RULE「目录规则」条目「表单只编辑规则内容、启停由快捷开关负责」的口径一致，属既定产品行为 |
| `workplace` 工厂每次调用 new 新实例 | RULE「常驻工作区」条目；已由 conn 级 `WeakMap` L1 memo 兜住（workplace-view-cache.ts:5-13），agent-runner 也已提到循环外 |
| vfs 工具 pathTail 以原始键比对 / 跨不过 runner 实例 | RULE 末条明写「两处已知盲区（拍板接受）」 |

## 争议与存疑

1. **F-2（批量 ingest 绕过 revision）的实际损失边界我没有定案**。project/global 域当前没有
   checkpoint 指针，所以「不可回滚」在产品上暂时不可观测；真正会痛的是「关掉 userVfsUnifiedToolTurn
   + session scope 批量覆盖」这条旧口径路径。我没有跑复现用例（只读纪律 + 未获授权执行测试），
   建议 W6 验证代理从「回滚到导入前消息能否还原正文」这一条重推。
2. **F-1 的修复位置**：我倾向补在 `DefaultTemplatePullService` 内（与角色卡/ZIP 导入同款，best-effort 吞错）；
   另一种方案是补在 `session.service.ts:234-246`，好处是不让 `createTemplatePullService` 的其他调用方
   （目前只有 session.service 一处）行为分叉。两种都能成立，取舍在「谁拥有这次失效的责任」。
3. **`DefaultCompactionConditionsStore.parseAndDecode` 是「读时写」**（v2/v3 文档读出来顺手
   `kkv.set` 回 v4）。我倾向认为是刻意的自愈迁移，但它确实让 `getConditions()` 带上了写副作用——
   若某天把它挪到只读连接或事务内被调用，值得复核。本次未列为发现（低风险）。
4. **`skill_disabled_rule` 的 scopeKey 与 VFS meta 域 scopeKey 是两套键空间**
   （`project:{pid}` vs `project:{pid}:meta`），skills.service.ts:104-113 已用两段注释钉死。
   这是本区最容易踩的键空间陷阱，建议 L3 台账里单独立一条「键空间三元组」提醒
   （VFS scopeKey / workplace scopeKey / disabled-rule scopeKey）。
5. **未覆盖**：`service/agent|chat|message-checkpoint|session-fs|session-run-state` 五个同层目录
   不在本 zone 内；`service/coordinated-write.ts`（我读了全文以判断 provider 补偿语义正确）
   也不在本 zone，仅在本报告中作为依赖被引用。