---
zone: core-infra-misc
agent: domain-survey
files_scanned: 53
---

# W2 按域测绘：core-infra-misc

> 范围：`packages/core/src/infra/` 下 `tokenizer/`、`content-cache/`、`sksp/`、`kkv/`、`events/`、`cloud-sync/`、`db-backup/`、`db-maintenance/`，共 53 个 `.ts`、约 7500 行，全部逐文件读完（无抽样）。
> 只读纪律：未做任何 git 写，未创建/修改 `docs/apm/` 下任何文件。临时探针脚本落在仓内 `tmp/`（已 gitignore）。

## 摘要

八个互不相干的基础设施「零件盒」，共用一条铁律：**core 自身零平台依赖，一切重活靠端口注入或宿主注册**。tokenizer 是最大的一块（3742 行，占本区一半），做提示词 token 计数的三层缓存与降级链；content-cache 是全仓统一的解压产物内存层；sksp 是密钥存储协议（env 只读覆盖 + DB 密文 + 平台加密策略）；cloud-sync 是跨端整库快照同步（进程内互斥 + 云端 lease）；db-backup/db-maintenance 是备份还原与「谓词驱动后台搬运任务」的落点。整体代码质量高、注释密度大、RULE 呼应紧。

## 职责与边界

| 子域 | 职责 | 边界（不做什么） |
|---|---|---|
| `tokenizer/` | 提示词/正文 token 计数：家族路由、L1/L2/记忆三层缓存、增量实时计数器、CJK 感知估算、编码表生命周期 | 不 import 任何分词器包（构造器由宿主注入）；不做压缩评估决策（只供数） |
| `content-cache/` | 「解压产物统一缓存」（RULE 条目，2026-09-30 用户拍板）：两池 LRU 字符串池 | 只存字符串不存 parse 结果；只做加速不做正确性 |
| `sksp/` | Secret Key Storage Protocol：端口 + 驱动注册表 + SQLite 编排基类 + env 只读覆盖 | 零 native 依赖；平台加密全在 strategy |
| `kkv/` | 单函数 `parseKkvJsonDocument` | 全域仅 21 行、**零消费方**（见 F-7） |
| `events/` | 进程内同步类型化事件总线（71 行） | 单进程、不跨进程、不异步 |
| `cloud-sync/` | 跨端整库快照 Push/Pull 编排 + 进程内 push/agent 互斥 + 云端 lease + status.json Zod schema | 不解决多设备争用（那是 lease 的事）；不感知具体 app 层守卫 |
| `db-backup/` | 服务商三表（`llm_provider`/`llm_saved_model`/`sksp_secrets`）dump/scrub/restore + restore 前 service 级校验 | 不做整库备份编排（整库在 app 层） |
| `db-maintenance/` | 「维护链路收敛」（RULE 条目）：缓存 GC → checkpoint → VACUUM 单源；两个谓词驱动后台搬运任务 | VACUUM 必须事务外直调；不注册 schema migration |

## 对外接口

**tokenizer**（`infra/tokenizer/index.ts`，132 行，经 `public/provider.ts` 转发）
- 计数入口：`resolveCurrentPromptTokens(sessionId, params, options?)` / `resolvePromptTokensWithBackfill` / `countPromptLlmInput` / `countTokens` / `countOpenAiStyleMessages` / `countTextWithIncrementalTokenizer`
- 缓存面：`promptWholeCache`（L1）、`tokenChunkCache`（L2）、`buildCounterScope`、`chunkHash16`、`parseTokenChunkCachePayload`、`chunkCache_advanceGeneration`
- 持久化面：`serializeSessionApiPromptTokenEntry` / `parse…` / `read…` / `write…` / `invalidateSessionApiPromptTokenEntry`
- 实时：`createIncrementalTokenCounter`（经 `public/format.ts` 转发）、`IncrementalTokenCounter.unencodableChars`
- 路由：`resolveTokenizerFamily`、`mapVendorModelIdToTiktokenModel`、`isGpt0301TiktokenModel`、`tokenizerAssetPaths`
- 窗口：`CONTEXT_WINDOW_RULES`、`DEFAULT_CONTEXT_WINDOW_TOKENS`、`resolveContextWindowTokens`、`seedContextWindowTokens`
- 标签：`formatTokenSourceBadge`、`formatContextUsageLabel`（真身在 `common/format-token-count.ts`）
- 切分：`splitTextIntoChunks`、`MAX_CHUNK_CHARS`
- 驱动注册面（从 `../nmtp/index.js` 再导出）：`registerTokenizerDriver` / `getTokenizerDriver` / `resolveTokenizerDriver` / `clearTokenizerDrivers`

**content-cache**：`DecodedContentPool`（类，导出具是为可直测）、`lookupDecodedContentBody` / `rememberDecodedContentBody` / `lookupDecodedMessageContent` / `rememberDecodedMessageContent` / `forgetDecodedMessageContent` / `clearDecodedContentCaches` / `decodedContentCacheStats`。**注意：`infra/content-cache` 未从 `packages/core/src/index.ts` 导出**（F-8）。

**sksp**（`infra/sksp/index.ts` 41 行）：`SecretStore`、`SkspError`/`assertValidRef`/`SkspErrorCode`、`registerSkspDriver`/`getSkspDriver`/`resolveSkspDriver`/`clearSkspDrivers`、`createCompositeSecretStore`、`EnvSecretStore`/`createEnvSecretStore`、`BaseSqliteSecretStore`、`SkspCryptoStrategy`、`refToEnvVar`、`resolveSkspEnvOverride`、`resolveSkspNameFromPlatform`。

**cloud-sync**（`infra/cloud-sync/index.ts`）：`CloudSyncCoordinator` + deps/pull/push 类型、`CloudSyncError`/`isCloudSyncError`、`ObjectStoragePort`/`DbSyncPort`、`parseCloudSyncStatus`/`EMPTY_CLOUD_SYNC_STATUS`、锁四函数 + `DEFAULT_LEASE_SECONDS`、`normalizePrefix`/`statusKey`/`snapshotKey`。**注意：`PushAgentMutex` 类与 `getDefaultPushAgentMutex` 未从 index 导出**（F-3）。

**db-backup / db-maintenance**：`dumpProviderTableSnapshot`/`scrubProviderTables`/`scrubProviderTablesInDatabase`/`restoreProviderTableSnapshot`/`validateProviderTableSnapshot`/`ProviderTableSnapshotError`；`createDbMaintenanceService`/`runStartupMaintenanceOnce`/`getStorageStats`；`runMessageContentCompaction`/`getMessageCompactionStatus`；`runBlobBinaryNormalization`/`getBlobBinaryStatus`。

**events**：`SimpleEventBus`（别名 `EventBus`）、`EventHandler`、`EventSubscription`。**kkv**：`parseKkvJsonDocument`。

## 数据访问

| 资源 | 落点 | 证据 |
|---|---|---|
| `chat_message`（blob 列归一 + 正文压缩搬运） | `UPDATE … WHERE <谓词>`，逐行短事务 | `impl/blob-binary-normalization.ts:191-197`、`impl/message-content-compaction.ts:426-433` |
| `vfs_content_blob` / `session_file_cache_blob` | 同上，`WITHOUT ROWID` 按 `content_hash` 游标 | `blob-binary-normalization.ts:159-182` |
| `sksp_secrets` | `SELECT ciphertext, iv, algo, version`；`INSERT … ON CONFLICT(ref) DO UPDATE` | `sksp/impl/base-sqlite-secret-store.ts:41,77-84` |
| `llm_provider` / `llm_saved_model` / `sksp_secrets` | `SELECT *` 全量 dump、`DELETE` scrub、动态列 `INSERT` | `db-backup/provider-table-snapshot.ts:42,104,122` |
| `kvv_entry` | 完成标记 + `startupMaintenancePending` 兜底标记；手写 DELETE 字面量 | `message-content-compaction.ts:491`、`blob-binary-normalization.ts:682`、`db-maintenance.service.ts:89-92` |
| session KKV 域 `prompt_tokens` / `token_chunks` | API 占用值、L1 整串表、L2 块表（fire-and-forget 写） | `session-api-prompt-token-store.ts:172-176`、`prompt-whole-cache.ts:353`、`token-chunk-cache.ts:329` |
| S3 对象 | `status.json`、`snapshots/rev-{6位}.nmbackup`，条件 PUT（If-Match） | `cloud-sync/logic/paths.ts:26-29`、`cloud-sync-coordinator.ts:351-368` |
| 本地临时文件 | `exportTempPath` / `importTempPath`（app 层注入路径） | `cloud-sync-coordinator.ts:246-260` |

**KKV 域常量**：`SESSION_KKV_DOMAIN_PROMPT_TOKENS`、`SESSION_KKV_DOMAIN_TOKEN_CHUNKS`（键 `promptWholeCache` / `chunkCache`）、`nm-message-content`（`compactionDone`/`startupMaintenancePending`）、`nm-blob-binary`（三表 doneKey + `startupMaintenancePending`）。

## 依赖关系

**import 了谁**（tokenizer 域内统计）：`@/service/session-kkv/session-kkv.port` ×4、`@/domain/prompt/model/agent-prompt-layout` ×4、`@/domain/chat/model/message` ×4、`@/domain/session-kkv/model/session-kkv-domains` ×3、`@/infra/llm-protocol/ports/adapter.port` ×2、`@/domain/vfs/content-store/logic/hash-content` ×2、`@/domain/provider/repositories/saved-model.port` ×2、`@/domain/prompt/model/prompt-render-context` ×2、`@/service/prompt/render-prompt` ×1、`@/domain/prompt/logic/message-body` ×1、`@/domain/chat/content/message-body-text` ×1、`@/domain/agent/model/agent-run-result` ×1、`../nmtp/index`。

全 `infra/` 子域实测 **零 `node:` 内置模块导入**（`grep -rn 'from "node:'` 无命中）——符合 RULE「宿主注册制禁 node: import」，标 intentional 合规。

**被谁消费**（引用文件数，`grep -rln 'infra/<子域>/'` 排除自身）：tokenizer 50、sksp 25、content-cache 13、db-maintenance 9、events 6、cloud-sync 4、db-backup 1、kkv 0。db-backup 引用数只有 1（两个 app 各一处经 `index.ts` 聚合），说明它被 `packages/core/src/index.ts:72-75` 单点转发，无旁路直引。

**跨域引用关键点**：
- content-cache 的 5 个接线点：`bootstrap/novel-master-bootstrap.ts`（清池）、`domain/vfs/content-store/impl/sqlite-vfs-content-store.ts`、`domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts`、`domain/chat/repositories/impl/sqlite-message.repository.ts`、`domain/chat/logic/message-content-codec.ts`——三读口齐备，与模块头声明一致。
- 维护链路收敛实测：`VACUUM` / `PRAGMA wal_checkpoint` 的**唯一**执行点在 `infra/db-maintenance/impl/db-maintenance.service.ts:73,77`；两个搬运任务（`message-content-compaction.ts:509`、`blob-binary-normalization.ts:762`）都经 `runStartupMaintenanceOnce` 走同一入口。**收敛成立**。
- 两个后台搬运任务**互不符号引用**（各自 `new SqliteKkvRepository(conn)`），blob 侧模块头明说「该任务在未合并分支上，此处只做结构对齐、不做符号引用」——intentional。

## 发现清单

| ID | 级别 | 位置 | 描述 | 建议 | 置信 |
|---|---|---|---|---|---|
| F-core-infra-misc-1 | **P1** | `tokenizer/logic/chunk-splitter.ts:52-61` | **切分器「每块 ≤64 字符」不变量可被连续句末符打破**，且它正是 L2 块缓存防 O(len²) 病态的唯一护栏。①句末分支 `chunks.push(text.slice(start, end))` 完全不检查块长，`end` 由「贪吃连续句末符」无界延伸；②实测（`tmp/w2-chunk-probe.mjs`，逐字复刻实现）：`"。"×100` → 单块 100 字符；`"\n"×200` → 单块 200；`">"×300` → 单块 300。测试文件 `chunk-splitter.test.ts:17-29` 的 `assertInvariants` 对任意输入断言 `chunk.length <= MAX_CHUNK_CHARS`，但 golden 用例里最长只到 `"。。。！！！"`（6 字符），**没有覆盖「连续句末符 ≥65」这条边界**，所以断言从未红过——正是 RULE「验收断言要有牙齿」条目描述的「夹具覆盖不到 ⇒ 恒真」形态。 | 在句末分支加长度封顶：贪吃时 `while (end < n && SENTENCE_END_CHARS.has(text[end]) && end - start < MAX_CHUNK_CHARS) end++`，让超长串回落到下方软边界/硬切路径；并在 `chunk-splitter.test.ts` 补一条 `assertInvariants("。".repeat(200))` 与 `assertInvariants("\n".repeat(200))` 的边界用例（当前实现下会红）。 | confirmed（实测复现，探针在 `tmp/w2-chunk-probe.mjs`，输出 `tmp/w2-chunk.out`） |
| F-core-infra-misc-2 | **P2** | `tokenizer/logic/prompt-whole-cache.ts:71-78,318-360` | **L1 的 pendingWrites 队列跨会话共享，落库归属靠「谁最后调 persist 就归谁」，条目会被整批丢弃或错投**。`pendingWrites` 是模块级数组、不带 sessionId；`persistPendingWrites(sessionKkv, sessionId)` 先 `splice` 取走整批，**再**判 `sessionKkv == null`（第 322-325 行）——sessionKkv 为 null 时批次已被取走且直接 return，这批条目永久丢失（无脏读，只是丢加速，可接受）；但更实际的是：A 会话 `record` 的条目若在 B 会话 persist 前入队，会被写进 **B 的 KKV 行**。模块头把这个口径写成了刻意设计（「落哪个会话行只影响加速续命位置、无脏读」，第 20-25 行），但同时又说「会话删除的级联清理会连带丢他会话条目」——两条合起来意味着 **A 的加速数据被 B 的删除清掉**，且 `persistedItems`（第 78 行）同样是按「最后 persist 的会话」归一的，A 的历史条目在内存表里被 B 覆盖。 | 若接受现口径，**至少把注释里「只丢加速不丢正确性」的表述补上「跨会话互相清对方加速」这一后果**（现注释只写会话删除会丢他会话条目，未写运行期就互相覆盖）；更稳的做法是 `pendingWrites` 带上产生它的 sessionId，persist 时按会话分桶各自落库。 | suspected（口径本身是刻意设计，但「运行期互相覆盖」这一后果未在注释中登记，属文档与实现的落差） |
| F-core-infra-misc-3 | **P2** | `cloud-sync/logic/push-agent-mutex.ts`（整文件）+ `cloud-sync/impl/cloud-sync-coordinator.ts:49,60,119` | **「push/agent 互斥锁」全仓没有任何 agent 侧调用方，实际只互斥了 push-vs-push**。`getDefaultPushAgentMutex` 的全仓引用只有 3 处，全在 coordinator 自身（第 49 行注释、60 行定义、119 行自用）；`apps/desktop/src/main/ipc/handlers/agent.ts:410` 与 mobile 对应入口**只做 `isDesktopAgentActive()` 布尔检查，从不 acquire 这把锁**。更关键的是 **`PushAgentMutex` 与 `getDefaultPushAgentMutex` 都没从 `infra/cloud-sync/index.ts` 导出**（`grep 'push-agent-mutex' index.ts` 无命中），所以 apps 层即便想接也拿不到——这是「接线未完成」的硬证据，不是设计取舍。模块头第 6-8 行把「push 和 agent 启动入口排队」写成已实现的能力。现状下 coordinator 靠两处 `isAgentActive()` 复检（第 219、267 行）兜底，那两处是**采样式**的：agent 在上传完成后、final status PUT 之前抢跑写入，快照与库不一致且第 267 行已复检过——即注释里说的「agent 拍跑到这里就拒绝」只覆盖「上传期间」，不覆盖「上传完成到 final PUT 之间」。 | 二选一并把注释对齐现实：①（推荐）把 `PushAgentMutex` + `getDefaultPushAgentMutex` 加进 `infra/cloud-sync/index.ts` 与 `packages/core/src/index.ts` 导出面，在 desktop `handleAgentRun` 与 mobile agent 入口 acquire/release；同时把模块头改成「agent 侧接线待办」。②若短期不接，把模块头与 coordinator 第 49 行注释改成「当前仅互斥并发 push，agent 侧靠 isAgentActive 采样守卫（已知盲区：上传完成到 final PUT 之间）」。 | confirmed（grep 全仓引用集合 + index 导出面缺失，均为确定性核对） |
| F-core-infra-misc-4 | **P2** | `db-maintenance/impl/db-maintenance.service.ts:88-99` vs `impl/blob-binary-normalization.ts:72` vs `impl/message-content-compaction.ts:67-68` | **同一把「手动清理顺带清 startupMaintenancePending」的键被写了两份字面量，且只覆盖 blob 侧**。db-maintenance 手写 `DELETE FROM kkv_entry WHERE module = ? AND key = ?`，参数是字面量 `["nm-blob-binary", "startupMaintenancePending"]`；blob 侧私有常量 `STARTUP_MAINTENANCE_PENDING_KEY` 值相同但**模块私有、互不引用**（注释说是为避免循环依赖而不用常量，合理）；但 message 侧的 `MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY`（同值 `startupMaintenancePending`，module 不同）是 **exported 的**，db-maintenance 却**没有**顺手清它——即手动「数据清理」成功后，message 侧若留有 pending 标记，下次冷启动仍会多补跑一次全库 VACUUM，与该代码块注释声明的意图（「否则标记会陈旧、让下次冷启动多跑一次全库 VACUUM」）在 message 侧落空。 | 把 db-maintenance 那条 DELETE 扩成两条（或 `WHERE module IN (?, ?)`），把 message 侧的 pending 键一起清掉；或让 db-maintenance import `MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY`（无循环依赖风险：message-content-compaction 已 import db-maintenance，反向引用才会成环，但这里只需常量——仍会成环，故保留字面量更稳，只需把两条都写上并注明原因）。 | confirmed（三处字面量/常量值与覆盖面均为确定性核对） |
| F-core-infra-misc-5 | **P2** | `db-backup/provider-table-snapshot.ts:111-127` | **`insertTableRows` 用首行的列名决定整批 INSERT 的列集合，后续行多出的列会被静默丢弃**。`const columns = Object.keys(rows[0]!)` 之后所有行都按这套列取值（`row[column] ?? null`）。当 `SELECT *` 结果各行列集合不一致时（blob/JSON 类型差异、驱动返回变体行、或经非 `SELECT *` 路径构造的快照），多出来的键被 `?? null` 吞成 NULL——对 NOT NULL 列会抛错（可发现），但若该列在目标表允许 NULL（如 `llm_provider.base_url` 之类若未来放宽）就是静默数据丢失。`provider-tables.ts:9` 的注释说列名「顺序与 DDL 无关」，但没说行内列集合一致性由谁保证——实际保证者只有 `dumpProviderTableSnapshot` 的 `SELECT *`。 | 在 `insertTableRows` 里取所有行的列并集（`new Set(rows.flatMap(r => Object.keys(r)))`），或在函数头注释里明确写死「快照由 `SELECT *` 构造 ⇒ 行内列集合恒一致，本实现依赖此不变量；破坏 `SELECT *` 时须同步改本函数」。 | suspected（当前唯一构造路径是 `SELECT *`，实测不会触发；属「隐式依赖未登记」） |
| F-core-infra-misc-6 | **P2** | `tokenizer/logic/estimate-tokens-cjk-aware.ts:33-36` | **CJK 计数用 `text.match(全局正则)` 分配完整匹配数组，大串上是 O(n) 个单字符字符串对象**。`countCjkChars` 返回 `text.match(CJK_CHAR_PATTERN)?.length`，只为拿长度却先构造了整个数组。该函数是 `resolveCurrentPromptTokens` 估算分支的**唯一单趟**计数（第 416 行，2026-09-30 刚为此把两趟并成一趟），输入是完整序列化串（模块自述真机大上下文为 MB 级 / glm 139KB）。139KB 全中文 → 约 14 万个单字符字符串入数组；这是该「单趟优化」路径上残留的最大一笔分配。 | 换成不分配数组的计数：手写 `for` 循环 `charCodeAt` 做区间判定（区间已在注释里列全：`\u2E80-\u9FFF`、`\uF900-\uFAFF`、`\u3040-\u30FF`、`\uAC00-\uD7AF`），或用 `matchAll` 迭代器 + 计数器（仍分配 match 对象但不含数组）。前者更省，且顺带可去掉 `countCjkChars` 这个中间函数。 | suspected（性能推断，未在真机实测耗时；分配量由代码路径直接可推） |
| F-core-infra-misc-7 | **P3** | `kkv/logic/parse-kkv-json-document.ts:15-21`（整文件） | **全域零消费方的死代码**：`grep -rn 'parseKkvJsonDocument' packages apps` 只命中定义自身；且 `infra/kkv` 整个目录未被 `packages/core/src/index.ts` 导出（`grep 'infra/kkv' index.ts` 无命中），也无任何文件 import 它。21 行、零调用、零导出。 | 删除该文件与 `infra/kkv/` 目录；或若确有规划中的调用方，补上导出与注释说明「预留」。 | confirmed |
| F-core-infra-misc-8 | **P3** | `content-cache/logic/decoded-content-cache.ts` 整文件 | **`infra/content-cache` 未从 `packages/core/src/index.ts` 导出**，所有消费方走深路径 import（5 个接线点实测均为 `@/infra/content-cache/logic/decoded-content-cache.js` 形式）。与 `db-backup`/`cloud-sync`/`sksp` 经 index 单点转发的做法不一致，导致 RULE「解压产物统一缓存」的接线面在包外不可见——外部包若想清池或读 stats 只能深路径引。 | 若确有外部包需要（如宿主换库时清池），从 `packages/core/src/index.ts` 转发 `clearDecodedContentCaches` / `decodedContentCacheStats`；若确定只 core 内部用，在 `decoded-content-cache.ts` 模块头注明「仅 core 内部接线，不对外导出」以免后来者误加导出。 | confirmed（导出面核对）+ suspected（是否为刻意选择） |
| F-core-infra-misc-9 | **P3** | `sksp/impl/composite-secret-store.ts:17`、`sksp/logic/ref-to-env.ts:8`、`sksp/ports/secret-store.port.ts:2` | **三处注释含 U+FFFD 替换字符（编码损坏遗留）**。实测字节：第 17 行为 `" * Read order: env hit \uFFFD?DB; writes go to DB only.\r\n"`（hex 确认 `ef bf bd 3f`），另两处同形态（`鈥?` / `provider/<id>/apiKey` 与 `Secret Key Storage Protocol` 后的箭头）。原文应是 `→`。与 RULE「PowerShell 管道改写 UTF-8 中文文件必毁编码」「`.ps1` ASCII-only」同族——GBK/UTF-8 误写留下的残迹。 | 三处均只改注释，用专用 Edit 工具把 `\uFFFD?` 改回 `→`（勿用 PowerShell 管道写回）。 | confirmed（逐字节核对，见 `tmp/w2-s2.mjs` 输出） |
| F-core-infra-misc-10 | **P3** | `db-maintenance/impl/db-maintenance.service.ts:121,134-142` | **`startupMaintenanceRan` 是模块级布尔、不按连接隔离，多连接场景会误短路**。desktop 的备份导入路径会「关 live 连接 → 覆盖库文件 → 开 restore 连接」（`apps/desktop/src/main/services/db-backup.service.ts:115-120`），若维护链路恰好在这中间被调用过一次，后续对**新连接**的维护会被短路返回 null。当前因 app 层有 dbMaintenanceBusy 令牌互斥（RULE 与 desktop 注释均有登记）而不易触发，属已知取舍。 | 若不动，注释补一句「进程级去重，跨连接不区分；备份导入窗口由 app 层 dbMaintenanceBusy 令牌兜底」。 | intentional（进程级去重是刻意设计，见第 114-121 行注释；此处仅补登记） |
| F-core-infra-misc-11 | **P3** | `events/simple-event-bus.ts:56-62` | **`publish` 同步遍历 `Set`，handler 内对同类型 subscribe 会让新 handler 在本轮 publish 内被调用**。`for (const handler of set)` 直接迭代活 Set；JS Set 迭代器会访问迭代期间新增的元素。若某 handler 在回调里 `subscribe` 了同事件类型，新 handler 会立刻收到当前 payload（重入语义未定义）。`unsubscribe` 在遍历中删除当前元素则是安全的（Set 允许）。 | 要么在 `publish` 开头 `const snapshot = [...set]` 后遍历快照（同时天然避免 handler 内改动影响本轮），要么在模块头写明「handler 内 subscribe 同类型会在本轮被调用」。 | suspected（语义未声明；实际消费方 agent-runner 的 handler 未在回调内订阅同类型，故当前无实害） |
| F-core-infra-misc-12 | **P3** | `tokenizer/logic/resolve-current-prompt-tokens.ts:386` | **`memoKey!` 非空断言的成立依赖两处条件，而非显式检查**：该分支进入条件是 `fingerprint != null && params.ctx != null && layoutHasWorkplace(...)`，而 `buildChatTokenEstimateMemoKey` 返回 null 的条件是 `fp == null \|\| layout == null`（`chat-token-estimate-memo.ts:234-236`）。`fingerprint != null` 与 `ctx != null` 已覆盖前者，但 **`params.layout` 若为 `undefined`，`layoutHasWorkplace(params.layout)` 会先抛 TypeError**（该函数无 undefined 守卫）——即 layout 为空时是崩在守卫里而不是走 null 路径，`memoKey!` 反而安全。当前调用方 layout 均非空，属脆弱而非缺陷。 | 把 `layoutHasWorkplace` 调用改写为 `params.layout != null && layoutHasWorkplace(params.layout)`，让 null 路径与断言自洽。 | suspected |
| F-core-infra-misc-13 | **P3** | `tokenizer/logic/resolve-tokenizer-family.ts:136` | **`@deprecated` 标记与实际使用状态矛盾**：`mapVendorModelIdToTiktokenModel` 标 `@deprecated Use resolveTokenizerFamily`，但全仓有 5 处生产消费方（`packages/tokenizer-driver-node`×2、`tokenizer-driver-rn`、`apps/mobile/src/services/stream-token-estimator.ts:126`、`public/provider.ts:161`）。移动端还在用它做 o200k 改写。 | 二选一：撤销 `@deprecated`（它现在是编码表选择的事实单源，与「family 选择」不是同一件事）；或改成 `@deprecated` + 一句「仅 tiktoken 编码表名映射链路使用，family 判定请用 resolveTokenizerFamily」并修掉 `resolveTokenizerFamily` 的误导。 | confirmed |
| F-core-infra-misc-14 | **P3** | `cloud-sync/impl/cloud-sync-coordinator.ts:271` | **`uploadElapsed > this.leaseSeconds * 500` 的单位换算不可读**：lease 是**秒**、`uploadElapsed` 是**毫秒**，`leaseSeconds * 500` 恰好等于「半个租约的毫秒数」（900s → 450000ms），但写法上看不出这层意思，且 `500` 是魔数。 | 改成具名常量，如 `const HALF_LEASE_MS = this.leaseSeconds * 1000 / 2;`，判断写成 `uploadElapsed > HALF_LEASE_MS`。 | confirmed |
| F-core-infra-misc-15 | **P3** | `db-backup/provider-table-snapshot.ts:66,70` | **`scrubProviderTablesInDatabase` 把 `alias` 字面量拼进 SQL**，函数注释已声明「字面量写入 SQL，由调用方控制」；实测两个调用方都传模块常量 `EXPORT_ATTACH_ALIAS`（desktop `:81-85`、mobile `:113-117`），无注入面。 | 保持现状即可；建议注释补一句「调用方必须传常量而非用户输入」。 | intentional（注释已声明，实测调用方合规） |
| F-core-infra-misc-16 | **P3** | `tokenizer/index.ts:125-132` | **tokenizer 的导出面里混入了 nmtp 域的驱动注册 API**（`registerTokenizerDriver` / `getTokenizerDriver` / `resolveTokenizerDriver` / `clearTokenizerDrivers` / `TokenizerDriver` / `TokenizerErrorCode` 均从 `../nmtp/index.js` 再导出）。nmtp 是独立子域，这层再导出让「tokenizer 的对外接口」清单包含不属于本域的符号，W3 的导出面横切扫描需知道这层是穿透而非本域所有。 | 记入横切清单即可，不建议改（desktop/mobile 测试与 nmtp 装配都依赖这条路径）。 | intentional（设计上就是驱动注册的统一出口） |

## 争议与存疑

1. **F-1 的定级**。我给 P1 的理由是：它破坏的不只是「一条测试断言」，而是 L2 块缓存**唯一的病态输入护栏**——`chunk-splitter.ts:14` 明写「块内无任何软边界时按上限硬切（无空白长中文串的病态输入由此兜住，**保证后续逐块 encode 恒 ≤64 字符，防 O(len²)**」，而 `count-text-with-tokenizer.ts:5-22` 的全部实测数据（8K 中文 32.8s → 亚秒级）都建立在这个保证上。反方立场：触发它需要「连续 ≥65 个句末符」，这在自然文本里罕见（测试夹具里 `"。。。！！！"` 只有 6 个），真实语料的概率低，且超长块只是把 encode 输入放大到几百字符而非回到 O(len²) 的秒级量级。**我没有真机实测这条路径的耗时**，所以「影响多大」未量化；若 W5 复核认为触发条件过于病态，降为 P2 也说得过去。倾向维持 P1（护栏被绕过这件事本身值得修），但请 W5 复核时一并给出触发条件在真实语料中的出现概率。

2. **F-2 的定级与定性**。我倾向 P2，但这条的**设计意图是刻意的**（模块头把跨会话共享写得很明确，且注释解释了为何可接受）。我的疑问只在「A 的条目被 B 的 persist 写进 B 的行、进而被 B 的删除清掉」这个后果**没有写进注释的取舍清单**——注释只登记了「会话删除会连带丢他会话条目」这一条静态后果，没登记运行期的互相覆盖。所以我报的是**文档与实现的落差**，不是设计错误。若 W5 判定原注释已足够，则本条可降为 P3 文档级。

3. **F-3 是否算本 zone 的责任**。agent 侧入口在 `apps/`，严格说不属 `core-infra-misc`。但「锁已实现、未接线、且未导出」三件事的证据全在我这个 zone 内，且 coordinator 注释把未接线的能力写成了已实现——**误导源在本 zone**，故仍报出并只要求 zone 内可做的两件事（导出面 + 注释对齐）。

4. **F-6 未实测**。CJK 匹配的分配量是从代码路径直接推的（正则 `/g` + `.match()` 必然构造完整数组），但「它在真机估算路径上到底占多少毫秒」我没有实测。若 W6 验证时发现 139KB 串上 `match` 只占几毫秒，本条可降为 P3 纯优化建议。

5. **`tokenChunkCache` 与 `promptWholeCache` 的 `seededSessions` 双份登记**（`prompt-whole-cache.ts:80-94`）我核对过是**正确设计**（两层读 `token_chunks` 域下的不同键，共用一份会让先跑的吃掉另一层的登记），注释也写清了。不算发现，仅备案以免 W3 重复报。

6. **`content-cache` 与 RULE「解压产物统一缓存」条目的一致性**：条目要求「三个读口共用本层」，实测三个读口（vfs content-store、session-kkv file_cache、chat_message 正文解码）全部接线，`bootstrap/novel-master-bootstrap.ts` 也调了清池。**符合**。唯一落差是导出面（F-8）。

7. **db-maintenance「维护链路收敛」条目**：实测 `VACUUM` / `wal_checkpoint` 全仓唯一执行点在 `db-maintenance.service.ts`，两个搬运任务都经 `runStartupMaintenanceOnce`。**符合，无发现**。