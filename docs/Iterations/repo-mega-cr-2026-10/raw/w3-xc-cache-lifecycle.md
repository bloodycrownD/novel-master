---
zone: xc-cache-lifecycle
agent: cross-cutting
files_scanned: 34
---

## 摘要

core 侧全部缓存 / 派生层的**失效生命周期对账**。盘点出 9 个产出：解压产物双池（内容正文池
按 sha256 明文、消息正文池按 messageId）、tokenizer 三层（api prompt token 存取 + L1 整串 +
L2 块）、session KKV 七域（rule_snapshot / file_cache / usage_stats.toolUseCount /
prompt_tokens / token_chunks / backfill_cursor / stream_metrics）、workplace 视图 conn 级缓存、
chat token 估读记忆、SQL 模板 AST + `test` 表达式编译缓存。对每层列键 / 写点 / 失效点，
再按七个生命周期事件（置位 / 压缩 / 回滚 / 导入 / 删会话 / rebootstrap / 切模型 / 编辑消息）
出矩阵，找**漏失效**（陈旧读）与**漏清理**（泄漏）。结论：1 条 P1（模板拉取漏清
rule_snapshot+file_cache）、4 条 P2、8 条 P3；另有 3 条负向确认（smart-sort / vfs-grep
根本没有正则编译缓存，不构成泄漏面）。

## 职责与边界

**本 zone 负责**：逐个缓存产出列「键形态 / 写点 / 失效点 / 生命周期事件覆盖」，并判定
「漏失效（正确性）」与「漏清理（资源）」两类问题。

**不在边界内（判为 intentional，不报问题）**：
- 压缩不清 `rule_snapshot` + `file_cache`——2026-09-29 用户拍板，理由写在
  `run-compaction.ts:8-18`（压缩与文件内容正交、中途清缓存破坏「前缀回合内冻结」不变量）。
- `contentBodyPool` 无失效机制——键是明文 sha256，同键必同值，模块头显式论证。
- `file_cache` 清空 / compress 不清 `user_vfs_pending`——`session-kkv-domains.ts:109-112`
  与 `run-compaction` 头注释已定稿。
- `usage_stats.toolUseCount` 在 hide/show 不失效——计数含 hidden 行，可见性变化不改计数。
- `token_chunks` / `promptWholeCache` 跨会话共享内容寻址条目——落哪个会话行只影响加速续命位置。

## 对外接口

| 产出 | 出处 | 键形态 | 作用域 |
|---|---|---|---|
| `contentBodyPool` / `messageContentPool` | `infra/content-cache/logic/decoded-content-cache.ts:189-199` | `sha256(明文)` / `messageId` | 进程（LRU 双上界 8M/1024、4M/4096） |
| `sessionApiPromptTokenCache` | `infra/tokenizer/logic/session-api-prompt-token-cache.ts:24` | `sessionId` | 进程内 Map，**无上界** |
| `prompt_tokens` KKV 域 | `domain/session-kkv/model/session-kkv-domains.ts:51` | `lastPromptUsage` | 落库 |
| `promptWholeCache` L1 | `infra/tokenizer/logic/prompt-whole-cache.ts:68` | `l1:${sessionId}:${scope}:${contentHash}` | 进程内 + KKV `promptWholeCache` |
| `tokenChunkCache` L2 | `infra/tokenizer/logic/token-chunk-cache.ts:133-135` | `l2:${hash16}:${scope}`，三代环形 | 进程内 + KKV `chunkCache` |
| `chatTokenEstimateMemo` | `infra/tokenizer/logic/chat-token-estimate-memo.ts:52` | `模型\|workplace指纹\|消息尾戳\|tools长度\|layout摘要` | 进程内，64 会话上界 |
| `workplaceEstimateByFp` | 同上 `:71` | workplace 指纹 | 进程内，64 上界 |
| `rule_snapshot` / `file_cache` | `session-kkv-domains.ts:8-11` | `canon` / `{status}:{path}` | session KKV |
| `usage_stats.toolUseCount` | `session-kkv-domains.ts:87-90` | 十进制串（失效写哨兵 `""`） | session KKV |
| `workplaceViewCache` | `service/workplace/impl/workplace-view-cache.ts:55-58` | `WeakMap<conn, Map<scopeKey, entry>>` | conn 级，读时签名校验 |
| `TemplateParser.astCache` | `infra/sql-template/parser.ts:46` | 模板原文 | **parser 实例级** |
| `compiledTestFunctionCache` | `infra/sql-template/expression.ts:34` | 规范化表达式体 | 进程内 |
| `chatAnnotateDraftStore` | `domain/chat/logic/chat-annotate-draft-store.ts:14` | `sessionId` | 进程内 |
| `pendingBackfills` | `domain/workplace/logic/load-or-fill-file-cache.ts:86` | Set\<Promise\> | 进程内 |

## 数据访问

| 表 / 域 | 写点 | 失效点（全部） |
|---|---|---|
| `vfs_content_blob` | `SqliteVfsContentStore.put` | `runDeferredBlobGc`（session/project delete、message delete、template push/pull、user-vfs turn） |
| `session_file_cache_blob` / `_entry` | `SqliteSessionKkvRepository.set(file_cache)` `:270-289` | `clearDomain(file_cache)`（置位 / 规则保存 / 导入 / tail 截断）、`clearSession`；blob 侧仅 `runDeferredFileCacheGc` |
| `session_kkv_entry`（rule_snapshot） | `loadOrCreateRuleSnapshot` / `refreshRuleSnapshot` `:35-40` | 置位、导入（`clear-session-prompt-caches.ts:34`）；压缩**不清** |
| `session_kkv_entry`（prompt_tokens） | `writeSessionApiPromptTokenEntry` `:219-231` | 9 处 `invalidateSessionApiPromptTokenEntry`：append-delete/updateContent/hide/show/hideRange/showRange、置位、压缩、rollback、导入、切 agent/model、persistent-state 切模型、run 收尾 FAILED |
| `session_kkv_entry`（usage_stats） | `usage-stats.service.ts:554-559`（回填前复核原值） | append(assistant 带 tool_use) / delete / updateContent / truncateAfter / rollback / 导入 |
| `session_kkv_entry`（token_chunks） | `tokenChunkCache.advanceGeneration:329` / `promptWholeCache.persistPendingWrites:353` | 仅 `clearSession`（删会话） |
| `session_kkv_entry`（backfill_cursor） | backfill 判定 | 任何删消息事务 |
| `chat_message.content_blob` | `updateContent`（唯一换正文的写口） | `forgetDecodedMessageContent` `sqlite-message.repository.ts:386` |

## 依赖关系

- **消费方**：agent-runner（run 收尾写/失效 api token `:948/:995`）、workplace 组装
  （`assemble-workplace-display.ts:154-202` 批量预取 file_cache）、usage-stats 弹窗、
  message transcript UI、compaction-conditions。
- **被消费**：`resolveCurrentPromptTokens` 是 token 读口唯一收口（`resolve-current-prompt-tokens.ts:262`），
  UI chip 与压缩阈值判定共用。
- **双端与 core 的边界**：`clearSessionPromptCaches` 经 `public/*` 未导出，desktop/mobile 的
  模板拉取（`apps/desktop/.../WorkspaceHeaderActions.tsx:37`、`apps/mobile/.../TemplatePullButton.tsx:45`）
  走 `sessions.pullTemplate`，**不经**任何缓存对齐 helper。

## 生命周期事件矩阵

`Y` = 已失效 / `—` = 有意不做 / `✗` = 漏

| 事件 | rule_snapshot | file_cache | prompt_tokens | usage.toolUse | token_chunks | 解压双池 | 会话级进程缓存 |
|---|---|---|---|---|---|---|---|
| 置位 set floor | Y | Y | Y | — (hide 不改计数) | — | — (id/hash 不变) | — |
| 压缩 | — (拍板) | — (拍板) | Y | — | — | — | — |
| 回滚 rollback | — (明示不清) | Y (COMPOSER 域) | Y | Y | — | — | — |
| **tail 截断 truncateMessagesAfter** | — | Y | **✗** | **✗** | — | — | — |
| tail 截断 message.service.truncateAfter | — | — | Y | Y | — | — | — |
| 角色卡 / ZIP 导入 | Y | Y | Y | Y | — | — | — |
| **模板拉取 sessionTemplatePull** | **✗** | **✗** | — | — | — | — | — |
| 模板推送 sessionTemplatePush | — (project 域) | — | — | — | — | — | — |
| 删会话 | Y (clearSession) | Y | Y | Y | Y | — (LRU/内容寻址) | **✗** (F-5/F-6) |
| 删项目 | Y | Y | Y | Y | Y | — | ✗ |
| **rebootstrap（备份导入 / 云同步 pull）** | 库换即冷 | 库换即冷 | 库换即冷 | 库换即冷 | — | Y (`clearDecodedContentCaches`) | **✗** (F-4) |
| 切 agent / 模型 | — | — | Y (`session.service.ts:317-325`) | — | — (键含 scope) | — | — |
| 编辑消息 updateContent | — | — | Y | Y | — | Y (repository forget) | — |
| 删消息 delete | — | — | Y | Y | — | Y | — |

## 发现清单

### F-xc-cache-lifecycle-1 | P1 | confirmed

**file:line**：`packages/core/src/service/template/impl/template-pull.service.ts:24-36`、
`packages/core/src/service/template/logic/initialize-session-workspace.ts:37-53`

**引文**：
```
await this.conn.transaction(async (tx) => {
  await initializeSessionWorkspace(tx, session.projectId, sessionId, {
    clearCheckpoints: true,
  });
});
await runDeferredBlobGc(this.conn);
```

**描述**：模板拉取（双端 UI 可达：desktop `WorkspaceHeaderActions.tsx:142`、
mobile `TemplatePullButton.tsx:45`）用 `replaceVfsSubtree` 整树覆盖 session 域 VFS、
用 `worktree.copyScope` 覆盖该会话的目录规则行——但**不清 `rule_snapshot` 也不清
`file_cache`**，也没调 `clearSessionPromptCaches`。而 `loadOrFillFileCache`
（`load-or-fill-file-cache.ts:42-58`）命中即无条件返回、**无 mtime 校验**，所以：

1. 下一次 assemble 的 `<file>` 块仍是拉取前的旧正文（并作为 workplace 指纹的
   bodyLength 段一并陈旧，`assemble-workplace-display.ts:199-201`）；
2. `rule_snapshot` 保留拉取前的目录规则求值结果，规则已随 `copyScope` 覆盖但快照不重算。

这与 RULE「置位 / 导入清两域」的口径完全同型（导入走 helper，拉取漏了）。用户表现是
「拉了模板但模型还在按旧文件内容思考」。

**建议**：在事务提交后、`runDeferredBlobGc` 旁调 `clearSessionPromptCaches(sessionId, kkv)`
（best-effort 语义与导入一致）。注意 `DefaultTemplatePullService` 目前只持有 conn，
需按 `createSessionKkvService` 就地建服务。

---

### F-xc-cache-lifecycle-2 | P2 | confirmed

**file:line**：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77`

**引文**：
```
async truncateMessagesAfter(projectId, sessionId, afterSeq, options?) {
  await this.deps.conn.transaction(async (tx) => {
    await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {...});
  });
}
```

**描述**：该方法只跑 `truncateTailInTransaction`，后者
（`truncate-tail-in-transaction.ts:87-97`）仅清 `backfill_cursor` +
`SESSION_KKV_COMPOSER_STATUS_DOMAINS`（`file_cache` + `user_vfs_pending`），
**不碰 `prompt_tokens` 与 `usage_stats.toolUseCount`**。而语义完全等价的另两条路径都补齐了：
`message.service.ts:459-460 / 490-491`（`truncateAfter`）、`message-rollback.service.ts:269-282`（回滚）。
后果：截断后 `prompt_tokens` 行仍带旧 `anchorSeq`；`estimateAnchoredDelta`
（`resolve-current-prompt-tokens.ts:167-196`）按 `seq > anchorSeq` 过滤，截断后 seq 被复用、
锚点指向不存在的高 seq → delta=0 → **基线原样沿用旧值且仍标 `api` 口径（标签不带 `~`）**，
既污染 chip 读数也参与压缩阈值判定（跳过 heuristic 安全垫）。回滚路径的同款问题代码里有
双保险注释（`:163-165`「回滚路径本身会失效该条目」），但本路径没有那层失效，双保险失效。

**缓解事实**：当前唯一调用方是 desktop IPC handler
（`apps/desktop/src/main/ipc/handlers/messages.ts:252`），renderer 侧只找到
`invoke-registry.ts:376` 的绑定、`ipc/client.ts:94` 的再导出，**无实际调用点**
（`git grep ipcMessagesTruncateAfter -- apps` 仅两处）。故属潜在泄漏而非现网故障。

**建议**：`truncateMessagesAfter` 提交后补 `invalidateSessionApiPromptTokenEntry` +
`usage_stats` 哨兵（可直接复用 `message.service.ts:91-126` 的两个私有方法，抽到共用处）。

---

### F-xc-cache-lifecycle-3 | P2 | confirmed

**file:line**：`packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:325-343`
（清域只删引用行）、`packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts:29-42`

**引文**（repository 注释自认）：
```
// 只删该会话 entry 引用行，blob 与其他会话 entry 不动（GC 按全库引用集判定）
```
GC 实际调度点仅 3 处（`git grep runDeferredFileCacheGc`）：`session.service.ts:197`、
`project.service.ts:196`、`db-maintenance.service.ts:66`（手动 + `runStartupMaintenanceOnce`）。

**描述**：清 `file_cache` 域的四条高频路径——**置位、规则保存
（`refresh-rule-snapshot.ts:41`）、导入（`clear-session-prompt-caches.ts:35`）、tail 截断**——
删掉 `session_file_cache_entry` 引用行后**一律不调度 GC**，孤儿
`session_file_cache_blob` 就此成为跨重启残留。`runStartupMaintenanceOnce` 有进程级去重
且只在两个一次性后台迁移跑完时触发（`db-maintenance.service.ts:134-142`），实际兜底只有
「删会话 / 删项目 / 用户手动点数据清理」。长会话里反复调规则 + 反复置位会让该表单调增长，
而它存的是 zlib 压缩后的文件正文（每条几百 KB ~ 几 MB 量级）。
`deferred-file-cache-gc.ts:18-20` 的「必须在删除引用行的事务提交后调度」纪律在这四处都没落地。

**建议**：抽 `clearSessionFileCacheDomain(conn, sessionId)` helper，内部 `clearDomain` 后
`void runDeferredFileCacheGc(conn)`（fire-and-forget，对齐 `deferred-revision-orphan-gc.ts`
的既有先例）；四处改调它。

---

### F-xc-cache-lifecycle-4 | P2 | confirmed

**file:line**：`packages/core/src/bootstrap/novel-master-bootstrap.ts:331-345`

**引文**：
```
// **入口清进程内派生缓存（2026-09-30）**：…也是**整库被替换后**的唯一收口
clearDecodedContentCaches();
```

**描述**：bootstrap 只清了解压产物双池。其余**进程内、sessionId 键**的派生缓存一律留存，
而 desktop 的 `rebootstrapDesktopRuntime`（`desktop-runtime-singleton.ts:35-38`）是
**同进程 close 连接 → 重建服务图**，备份导入（`handlers/backup.ts:49`）与云同步 pull
（`handlers/cloud-sync.ts:91`）都走它。后果按层分述：

- `sessionApiPromptTokenCache`（`session-api-prompt-token-cache.ts:24`，**无上界 Map**）：
  云同步 pull 回来的库往往仍是同一条会话谱系，**sessionId 逐字相同、内容不同** →
  进程内热层继续按旧库的 `promptTokens` 作答，既污染 chip 又参与压缩阈值判定。**这是本条
  最硬的陈旧读。**
- `promptWholeCache.buckets` / `persistedItems` / `seededSessions`（`prompt-whole-cache.ts:68,78,94`）：
  键含 `contentHash`，库换后内容变 → 自然 miss，仅丢加速，无脏读。
- `tokenChunkCache.seededSessions`（`token-chunk-cache.ts:149`）：同理，只丢加速。
- `chatTokenEstimateMemo`：键含内容指纹 → 自然 miss。
- `chatAnnotateDraftStore.bySession`：库换后同 sessionId 的旧批注草稿会以 chip 形式复现。

**建议**：在 `clearDecodedContentCaches()` 旁补一个 `clearSessionScopedInProcessCaches()`
（`sessionApiPromptTokenCache.clearAll()` + `promptWholeCache.clearForTests` 的生产等价 +
两个 `seededSessions` 清空 + `resetChatAnnotateDraftStoreForTests`），或把这些缓存统一挂到
一个「进程级缓存注册表」，bootstrap 统一清。

---

### F-xc-cache-lifecycle-5 | P3 | confirmed

**file:line**：`packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:363-366`

**引文**：
```
clearSession(sessionId) { buckets.delete(sessionId); persistedItems.delete(sessionId); }
```

**描述**：`promptWholeCache.clearSession` 与 `tokenChunkCache` 的对应清理
**生产代码零调用**（`git grep "\.clearSession(" -- packages/core/src` 只命中
`project.service.ts:171` / `session.service.ts:219` 的 KKV 层，以及 `session-kkv.service.ts:51`
的转发）。`buckets` 每会话一桶（桶内 LRU 32 条但**桶本身无上界**）、`persistedItems` 与
两个 `seededSessions` Set 同样按会话无界增长——进程活多久、会话进多少，就涨多少；
删会话后这些键也全部残留（`seededSessions` 残留还会让 KKV 行已被 `clearSession` 删掉的
会话永不再 seed，纯丢加速）。无脏读（键含 sessionId + 内容指纹，id 不复用）。

**建议**：在 `session.service.ts:197` 的 `runDeferredFileCacheGc` 旁补
`promptWholeCache.clearSession(session.id)`（递归删除树里对每个 session 都调）。

---

### F-xc-cache-lifecycle-6 | P3 | confirmed

**file:line**：`packages/core/src/domain/chat/logic/chat-annotate-draft-store.ts:14`

**描述**：`bySession = new Map<string, AnnotateDraft[]>()` 无删除会话挂点，也无 rebootstrap 挂点。
删会话后草稿残留（内存，无正确性影响）；rebootstrap 后同 sessionId 的旧草稿会被
`chipsFromAnnotateStore` 投影成 composer chip。量级小、恢复路径是用户重开会话。

---

### F-xc-cache-lifecycle-7 | P2 | confirmed（机制成立，触发窗口窄）

**file:line**：`packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:114-127,160-162`、
`packages/core/src/service/workplace/assemble-workplace-display.ts:175-187`

**引文**：
```
function scheduleBackfill(write) {
  const settled = new Promise((resolve) => {
    setTimeout(() => { void write().then(...) }, 0);
  });
```
且组装路径固定传 `{ deferBackfillWrite: true }`。

**描述**：2026-09-30 引入的后台回填把「压缩 + 落库」推到 `setTimeout(0)` 宏任务之后。
若在这一个宏任务的窗口里发生**置位 / 规则保存 / 导入**（三者都 `clearDomain(file_cache)`），
在途回填会在**清域之后**把**清域前读到的旧正文**写回 `{status}:{path}` 键 → 旧正文复活。
窗口宽度是一个宏任务（单线程 JS 上 `setTimeout(0)` 通常 <5ms），但 assemble 是逐文件循环、
每个 miss 文件各登记一个宏任务，长前缀下窗口被拉长；期间用户点「置位」是可达交互。

**建议**：`scheduleBackfill` 加一个会话级 generation 计数器（`clearDomain` 时 +1），
回调写回前比对 generation，不匹配则丢弃（等价于 usage-stats 的哨兵协议，
`usage-stats.service.ts:540-560` 已有同款先例可循）。

---

### F-xc-cache-lifecycle-8 | P3 | confirmed

**file:line**：`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:160`、
`packages/core/src/infra/sql-template/parser.ts:45-55`

**描述**：`private readonly parser = new SqlTemplateParser()` 是**实例字段**，而 repository
普遍 per-call 新建（`reposFor(conn)`、`createSessionKkvService(conn)`、
`new SqliteMessageRepository(tx)` 等，全仓 23 处 `new SqlTemplateParser`）。于是
`TemplateParser.astCache` 在绝大多数调用里都是**冷启动即抛**——这一层缓存近乎零命中，
纯粹是每实例的一次性 Map 开销。真正跨实例生效的是模块级的
`compiledTestFunctionCache`（`expression.ts:34`），其键来自静态模板串（唯一的动态模板
`buildInBindings` 只生成 `IN (?)` 绑定、不含 `<if test>`），条目数受模板总数约束，
**无泄漏无脏读**。

**建议**：把 parser 提成模块级单例（或按 conn WeakMap 缓存），否则这层缓存是纯负债。

---

### F-xc-cache-lifecycle-9 | P3 | confirmed

**file:line**：`docs/apm/RULE.md:16`

**引文**（RULE 原文）：`**压缩**：…副作用：清 `rule_snapshot` + `file_cache`。`

**描述**：与代码不符。`run-compaction.ts:8-18` 明确「**不再清** `rule_snapshot` +
`file_cache`」（2026-09-29 用户拍板，理由：压缩只改可见性、且中途清缓存破坏
「前缀回合内冻结」不变量）。RULE.md 是本仓的**术语权威**，后续 agent 读到会按「压缩会清」
去推理或补失效，属于跨会话误导源。（置位条目 `:15` 仍准确，无需动。）

**建议**：把 RULE.md 压缩条目的副作用改为「清 prompt token 占用；**不清**
rule_snapshot / file_cache（2026-09-29 拍板，见 run-compaction 头注释）」。

---

### F-xc-cache-lifecycle-10 | P3 | intentional（负向确认）

**file:line**：`packages/core/src/domain/smart-sort-rule/logic/compile-smart-sort-rule.ts:29,60,92`、
`match-smart-sort-pattern.ts:93,100`、`packages/core/src/domain/vfs/logic/vfs-grep.ts:41`

**描述**：派单点名的「smart-sort 正则编译缓存」**不存在**——四处 `new RegExp` 全是
按需现编（草稿校验、规则编译、编辑器试匹配、grep 行匹配器），仓库内既无 `Map<pattern, RegExp>`
也无模块级 `lastIndex` 复用。同理 vfs-grep 的 `compileRegex` 也无缓存。
**既无失效面也无泄漏面**，如实记录以免后续重复排查。`skill-name.ts:20` 的
`SKILL_NAME_PATTERN` 与 `vfs-grep` 的 `IDENTIFIER_RE` 类模块级常量属启动期固定正则，
非缓存。

---

### F-xc-cache-lifecycle-11 | P3 | confirmed

**file:line**：`packages/core/src/service/workplace/impl/workplace-view-cache.ts:55-66`

**描述**：conn 级 `WeakMap<conn, Map<scopeKey, entry>>` 的内层 Map **每 scope 一条、永不淘汰**，
会话数多时长进程累积条目（每条含 ctx/view/filetreeDisplay，view 带 displayByPath 映射，
不算小）。rebootstrap 换 conn 后 WeakMap 自动冷（该设计正确）。失效靠读时签名校验
（`sampleSignatures`，`workplace.service.ts:313-336`：vfs 聚合签名 + 规则表 + 智能规则表
确定性序列化），**不会返回陈旧读**。

---

### F-xc-cache-lifecycle-12 | P3 | intentional（已自认的语义差）

**file:line**：`packages/core/src/infra/content-cache/logic/decoded-content-cache.ts:24-29`

**引文**：
```
// 注意「命中不查库」的后果：某条 blob 行被 GC 回收后，同进程内照样读得到该正文…
// 因此 scanContents 那条「缺 blob 必抛」的失败语义只在冷态成立，热态静默成功
```

**描述**：模块头已把「内存层延长明文寿命到进程结束、`scanContents` 的失败语义在热态退化」
写清并接受。复核结论：两条失效面都成立——`contentBodyPool` 键是明文 sha256，
`hashContent` 单一实现（`hash-content.ts:15-18`，noble sha256，三端一致），
`file_cache` 侧 `hashFileCachePayload` 与 vfs 侧同函数，两套存储同键天然同值；
`messageContentPool` 唯一「同 id 换正文」写口 `updateContent`
（`sqlite-message.repository.ts:386`）已 `forgetDecodedMessageContent`，`insert`/`batchInsert`
另有防御性 forget。`TextDecoder` 默认非致命这一条值得记一笔：若某 blob 的 encoding 与字节
形态错配（存量归一未跑），解出的替换字符会被**按正确哈希缓存整个进程**（F-3 类存量风险下
会从「一次性读坏」升级为「进程内持续读坏」），但这在缓存引入前行为已相同，非新增缺陷。

---

### F-xc-cache-lifecycle-13 | P3 | intentional（已自认的键盲区）

**file:line**：`packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts:152-171`

**引文**：
```
/** 消息尾戳：数量 + 末条 seq + blocks 折算长度和。…「同长度异内容」的编辑是病理边界 */
```

**描述**：`memo` 键含「消息尾戳（数量:末seq:长度和）」，同长度异内容的编辑（改一个字、
不改块数与长度和）键不变 → 返回编辑前的估读/精确读数。模块头与 `stampToolsForEstimateMemo`
注释均已显式接受（label 会短暂陈旧、下一轮消息事件自愈）。`estimated` 升级单向
（`rememberChatTokenEstimateMemo:124-132`）防回落的设计亦复核无误。

---

## 争议与存疑

1. **F-2 的现实严重度**：`truncateMessagesAfter` 的唯一生产调用方（desktop IPC）当前**无
   renderer 调用点**。我按「派单线索核实」的要求如实记为 confirmed 的**代码缺口**，
   但把它降为 P2 而非 P1——它今天不会在用户路径上触发。若后续 W4/W5 发现 renderer 侧有
   动态构造的调用（本次 `git grep` 覆盖 apps 全量，仅 2 处），应上调 P1。

2. **F-3 的量级未实测**：我没有在真机上量 `session_file_cache_blob` 的实际增长曲线
   （需要构造长会话 + 反复置位/改规则 + 查 `count(*)` 与 `page_count`）。定级依据是
   「高频路径无回收点 + 存的是压缩文件正文」的机制推断，不是实测数字。按本仓纪律
   （`docs/apm/RULE.md`「条数/体积类结论必须实测」），**这条的最终定级需要一次实测复核**。

3. **F-4 是否应算 bug**：`sessionApiPromptTokenCache` 跨库存活只在「拉回的是同一条会话谱系」
   时才产生错误读数（sessionId 相同、内容不同）。云同步场景恰是同谱系，所以风险实在；
   但备份导入「从别处导一份完全不同的库」时 sessionId 多不相同，只是无界 Map 涨。
   我倾向按「确认的漏失效」而非 intentional 处理，因为 bootstrap 注释已经自称
   「派生缓存与库同寿命」这条纪律，而实现只兑现了一半。

4. **F-7 与 F-1 的优先级关系**：F-1 是确定性陈旧读（拉取后必现），F-7 是窄窗口竞态。
   若迭代资源有限，先修 F-1。

5. **未覆盖**：`apps/mobile` / `apps/desktop` 侧的进程内缓存（WebView 侧 `mermaid` svgCache /
   failedErrorCache 已由 w2 覆盖）不在本 zone；`kkv`（全局 KKV 模块，非 session KKV）未纳入。
