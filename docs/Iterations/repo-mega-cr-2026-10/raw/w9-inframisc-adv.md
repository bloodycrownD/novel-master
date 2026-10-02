---
zone: w9-inframisc-adv
agent: 辩护人（对抗机位 / advocate）
files_scanned: 63
files:
  - packages/core/src/infra/tokenizer/** (30)
  - packages/core/src/infra/content-cache/** (1)
  - packages/core/src/infra/sksp/** (10)
  - packages/core/src/infra/kkv/** (1)
  - packages/core/src/infra/events/** (1)
  - packages/core/src/infra/cloud-sync/** (10)
  - packages/core/src/infra/db-backup/** (5)
  - packages/core/src/infra/db-maintenance/** (5)
loc: D:\Dev\nm-worktree\mcr (worktree, feat/repo-mega-cr @ 9ca5f5ad)
independence: 未读 raw/ 任何其他报告、未读 synth/
---

## 摘要

本区是 core 的**基础设施层**：分词与 token 计数（双驱动缓存平面 L1/L2/KKV 续命）、
解压产物进程内缓存、密钥存储（SKSP 三层）、同步事件总线、跨端云同步编排（租约锁 +
进程内互斥）、服务商三表备份快照、以及两个谓词驱动的后台搬运任务（消息正文压缩 /
blob 形态归一）与 VACUUM 维护链路。整体是「性能层 + 迁移层」，正确性口径几乎全部
写进了模块头注释，注释密度在本仓属最高一档。

## 职责与边界

| 子域 | 职责 | 边界（不做什么） |
|---|---|---|
| `tokenizer/` | token 计数的**读口编排 + 缓存平面 + 纯函数计数**；真分词器在 `packages/tokenizer-driver-{node,rn}/` | 不 import 任何分词器包；驱动通过 `infra/nmtp` 注册表注入 |
| `content-cache/` | 「解压后产物」的进程内 LRU（两池） | 不做解析、不做失效编排（失效由写口显式调） |
| `sksp/` | 密钥存储协议：端口 / 三端驱动注册 / env 覆盖 + DB 复合 / 加密策略抽象 | 不含任何 native 依赖 |
| `kkv/` | KKV JSON 文档解析单源 | 当前仅 1 个 21 行函数 |
| `events/` | 进程内**同步**类型化 publish/subscribe | 无异步、无背压、无通配 |
| `cloud-sync/` | status.json 租约锁 + rev 对齐 + push/pull 编排（纯注入，无 IO 实现） | 哈希/文件读由调用方注入；进程内互斥不解决多设备争用 |
| `db-backup/` | 服务商三表 dump / scrub / restore + 还原前 service 级校验 | 只管这三张表 |
| `db-maintenance/` | 存储统计 + 「缓存 GC → checkpoint → VACUUM」维护链路 + 两个谓词搬运任务 | **不注册 schema migration**（RULE 红线） |

## 对外接口

- `tokenizer/index.ts` → `public/provider.ts`：L1/L2 单例、读口、纯函数计数、encoding 注册中心、`nmtp` 驱动注册。
- `db-maintenance/index.ts`：`runBlobBinaryNormalization` / `runMessageContentCompaction` / `getXxxStatus` / `runStartupMaintenanceOnce` / `createDbMaintenanceService`。
- `db-backup/index.ts` + `core/src/index.ts`：`dumpProviderTableSnapshot` / `scrubProviderTables` / `scrubProviderTablesInDatabase` / `restoreProviderTableSnapshot` / `validateProviderTableSnapshot`。
- `sksp/index.ts`：`SecretStore` / `BaseSqliteSecretStore` / `createCompositeSecretStore` / driver registry。
- `cloud-sync/index.ts`：`CloudSyncCoordinator` + 锁函数 + `CloudSyncStatus`。
- 消费方实测：desktop/mobile `db-backup.service.ts`、`cloud-sync.service.ts`、`message-content-compaction.service.ts`、`blob-binary-normalization.service.ts`、`chat-prompt-tokens.service.ts`；`apps/cli/src/runtime.ts`；两个 tokenizer driver 包。

## 数据访问

| 表 | 位置 | 触碰点 |
|---|---|---|
| `sksp_secrets` | db-backup 三表之一；SKSP 全档 | `base-sqlite-secret-store.ts:41,63,77,100`；`provider-table-snapshot.ts:24-28` |
| `llm_provider` / `llm_saved_model` | db-backup 三表之二三 | `provider-table-snapshot.ts:18-21,36-44` |
| `chat_message`（`content_json` / `content_blob` / `content_encoding`） | 消息压缩搬运 + blob 归一第三张表 | `message-content-compaction.ts:161,391,428`；`blob-binary-normalization.ts:113,191,195` |
| `vfs_content_blob` / `session_file_cache_blob` | blob 归一前两张表 | `blob-binary-normalization.ts:105,159,175` |
| `kvv_entry` | 完成标记 / pending 标记 / token 缓存行 | `blob-binary-normalization.ts:309,411,434,682`；`message-content-compaction.ts:208,491,533`；`db-maintenance.service.ts:89-92`（**字面量直删**） |
| PRAGMA `page_count/page_size/freelist_count` | 存储统计 | `db-maintenance.service.ts:24-31` |
| `VACUUM` / `wal_checkpoint(FULL)` | 维护链路（**必须事务外**） | `db-maintenance.service.ts:73,77` |

KKV 域（跨包）：`nm-message-content`/`compactionDone`、`nm-blob-binary`/`{vfsContentDone,fileCacheDone,messageContentDone,startupMaintenancePending}`、`token_chunks`/`{promptWholeCache,chunkCache}`、`prompt_tokens`/`lastUsage`。

## 依赖关系

- 依赖 `infra/tdbc`、`infra/sql-template`、`infra/nmtp`、`domain/kkv`、`domain/session-kkv`、`domain/vfs/content-store`。
- **反向依赖被刻意掐断**：`db-maintenance.service.ts:84-87` 明写「key 用字面量而不 import blob-binary-normalization 的常量——反向引用会形成循环依赖」。
- 被谁消费：见上「对外接口」；`SimpleEventBus` 被 agent-runner / run-agent-turn / 双端 runtime / desktop `forward-event-bus` 消费。

---

# 一、辩护理由清单（我主张这些设计是对的，不该按缺陷记账）

## D-1 两池缓存（content-body / message-content）——**这是本区最正确的一个设计**

- **内容正文池不需要失效机制**，因为键就是明文的 sha256（`decoded-content-cache.ts:19-29`）：value 是 key 的函数，同键必同值，不存在陈旧窗口。这是内容寻址存储的原生红利，不是「偷懒没做失效」。
- **两池分立是必要的**：chat_message 没有内容哈希列，只能以主键为身份（`:30-36`）。把两种身份硬塞进一个池，要么给消息也去哈希（付 sha256 全量扫，正是本层要消灭的成本），要么让消息条目永不失效（错读）。分池是这两难的标准解。
- **只存字符串、不存 parse 结果**（`:45-49`）判断正确：返回值会被多个消费方共享，存对象等于把可变引用发到各处。JSON.parse 远便宜于 inflate。
- **双上界（条数 + 字符数）**（`:51-57`）：正文条目体量差 3 个数量级（一条消息几百字节 vs 一个文件几 MB），只按条数兜不住；单条超预算不收录（收录即抖动）也对。
- **「命中不查库 → 扫描时缺 blob 必抛的语义在热态静默成功」**（`:26-29`）这一取舍**是被明确写下来的生产接受项**，不是疏漏：正文正确性由 hash 保证，与行在不在无关；重启即回冷态、语义复原。我反对把这条记成缺陷。
- **进程内单例 + 每进程单库单连接的前提**写得很清楚（`:38-43`），并且 `bootstrapNovelMaster` 确实调了 `clearDecodedContentCaches`（`novel-master-bootstrap.ts:345`）——前提有兜底动作，不是口头约定。

## D-2 谓词驱动后台任务骨架（消息压缩 / blob 归一）——**结构上是对 RULE 的正确落地**

- 「不注册 schema migration，走 `infra/db-maintenance/impl/` 下的任务」正是 RULE 的硬规定；两个任务的模块头都逐字复述了骨架（谓词 → 批 ≤100 → 单行短事务 → 批间 `setTimeout(0)` → 同步预算 → KKV 完成标记 → 挂维护链路）。**这是全仓少见的「规则写在实现里」的样本**。
- **keyset 游标只用于本轮加速、完成判定不落在游标上**（`message-content-compaction.ts:14-18`、`blob-binary-normalization.ts:536-543`）：这是我见过对这个骨架最正确的处理——游标带来的是 O(本页) 而非 O(全表) 的读放大，完成判定仍以谓词 COUNT 为准，两者职责不混淆。
- **收尾谓词校验 + 不变量注释**（`blob-binary-normalization.ts:655-668`）质量很高：它显式写出了「收尾校验之前不得再引入任何 `break`」这条禁止，并用「leftover ⊆ failedKeys」的不变量论证为什么 `leftover > failedKeys.size` 一定是异常残留。这不是事后补的注释，是**防止未来重构踩坑的设计约束**。
- **坏行不阻断收敛**（`:39-43`）：base64 非法就跳过该行、仍置完成标记，理由是「读路径对同类坏行按 miss 自愈，两侧口径必须一致」。让一个永久坏行把整个任务永久卡在 60s 预算烧穿，是更坏的设计。
- **零进展护栏 + `stalled` 语义**：`stalled = true` 明确表达「继续立即重跑也不会有任何进展」，让 app 层停止重试而不是把它放大成热循环（`:281`）。这是把「空转」当成一等公民处理。
- **「不要求满批」的护栏条件**（`:79-86`）尤其对：卡住行数 < 100 恰恰是最该兜底的那类库，旧口径的满批条件永远不触发。

## D-3 维护链路的成本门控 —— **cr-01/cr-25 的方向是对的**

- `processedAny`（本轮确有成功改写）+ `allDone` 双条件才触发 VACUUM（`:743`），并且显式**删掉了** `result.done && result.failedCount > 0` 那一支并写下「勿补回」（`:734-739`）：freelist 页只来自成功改写，「本轮零行被改写」跑 VACUUM 是纯成本 desktop 还要冻一次事件循环。**这是有理由的删除，不是漏写。**
- `startupMaintenancePending` 持久化兜底 + 「仅在维护真跑过（返回非 null）时才清标记」（`:763-767`）：无条件清会让「标记被清、维护没跑」静默失效。这个条件抓得很细。
- `beforeMaintenance` / `afterMaintenance` 走 **finally 语义**（`:780-790`）：VACUUM 抛错也必须复位 app 的 busy 标志，否则一次维护失败让 busy 永久挂死——挂死比维护失败本身更糟。

## D-4 SKSP 复合存储 —— **分层与「写入不对称」都是对的**

- `composite-secret-store.ts:26-50`：读 env → 读 DB；**写只落 DB**。这个不对称是刻意的且必要的——env 层是只读覆盖，写进 DB 才能在 env 撤掉后仍可用；反过来若写也写 env 就会污染进程环境。
- **env 判定收敛成一个纯函数**（`env-override.ts:20-30`）并在 JSDoc 里点名动机「避免 desktop/mobile/cli 各自重写判定导致空串/空白/undefined 处理漂移」——这正是 RULE 反复强调的「单源」纪律在本区的落地。
- **`BaseSqliteSecretStore` 模板方法 + `SkspCryptoStrategy` 委托**（`base-sqlite-secret-store.ts:1-12,24-27`）：三端 `has`/`delete` 逐字相同、`get` 前半段相同、密文解码下放。**「iv 可以是 null 所以 base 不统一检查」这个理由是站得住的**（Windows DPAPI 根本没有 iv 概念），强行在 base 里补检查只会造出一个对某端永远为真的假校验。
- `resolveSkspNameFromPlatform` 抽成 caller 注入的纯函数，注释点名「RN 下 `process.platform` 没被 shim」（`platform.ts:4-7`）：这是被 RN 实测坑过之后才有的抽象，不是过度设计。
- **`NM_SKSP_DISABLE_ENV` 在 core 里只写在文档、真正判定在两端 runtime**（`apps/cli/src/runtime.ts:202`、`apps/desktop/.../create-desktop-runtime.ts:111`）：core 不读 `process.env`、边界干净，我实测确认过两端都真判定了，不是死文档。

## D-5 云同步的「双锁 + 复检」—— **三层防护各自解决不同失效模式**

1. 进程内 `PushAgentMutex`（push ↔ agent 启动入口排队，超时降级拒绝而非死等）；
2. 云端租约锁（多设备争用，`lock.ts:15-33`）；
3. push 入口与上传后**两次** `isAgentActive()` 复检（`cloud-sync-coordinator.ts:219,267`）。

第 3 处在上传后复检并 throw 走 finally 清锁，注释写明是给「apps 旧路径未抢锁」的兼容期留的。我主张保留它：兼容分支在此处是**唯一的正确性防线**，删掉会把兼容期的窗口直接暴露成脏快照上传。

- `canUseFilePathPush/Pull` 的能力探测（`:125-140`）用 `typeof x === "function"` 对**可选端口成员**做降级，比要求端口强制实现更合适——文件路径在 desktop 有价值、mobile/CLI 无意义。
- `conditionalPutStatus` 把驱动抛的 `LOCK_CONTENTION` **收敛成返回 null**（`:362-367`）而不是让每个调用点写 try/catch：把「条件写失败」建模成返回值是正确的领域建模。
- `renewLease` 触发条件 `uploadElapsed > leaseSeconds * 500`（ms，= 半个租约）虽然写法怪，但换算正确（900s 租约 → 450s 续租）。

## D-6 provider 三表快照 —— **「校验在事务外、INSERT 在事务内」的分层是对的**

- `restoreProviderTableSnapshot` 先跑 service 级校验、**任意行非法直接抛且主库保持原状**（`provider-table-snapshot.ts:75-93`）。这个事务边界选得很对：校验是纯 CPU 的全量扫描，扔进事务里只会长时间持写锁。
- 校验内容不是照抄 schema，而是**把 service upsert 路径里的运行时不变式提出来**（`provider-table-snapshot-validate.ts:1-10`）：`display_name` 非空、protocol 枚举、`saved_model.provider_id` 必须在快照内命中。schema 的 CHECK 只拦 enum、FK 要等 INSERT 才报——显式校验换来的是**更早、更精确的错误位置**，注释明说「避免被事务回滚掩盖」。这是把散落在 service 里的不变式收成单源，值得表扬。
- **restore 顺序 `llm_provider → llm_saved_model → sksp_secrets` 与 scrub 顺序相反**（`:17-28`）：子表先删、父表先插，FK 前后都合法。

## D-7 tokenizer 的「统计优先 / 基线 + 增量」口径

- `resolve-current-prompt-tokens.ts:9-23` 的口径与 RULE「实时 token 指标语义」条**逐字一致**（读值 = 基线 + 增量估算、usage 到达即重锚基线而非停止回写）。这条是用户 2026-09-26 拍板、RULE 明文禁止回退的实现，任何把它报成「又引入了一次性门」的发现都是误报。
- `estimateAnchoredDelta` 取 `max(heuristic, CJK 感知下限)`（`:192-195`）：英文小幅高估无害、阈值判定方向安全。这个不对称选择是对的。
- **弃权检查点放在「重活之前」而不是之后**（`:330-333`、`:439-442`），并且把检查点**为什么必须在序列化之前**写进注释（序列化 + 内部二次 hash 各自把整串过一遍）：这是被 12.5s 真机事故校准出来的位置，不是随手插的。
- `token-chunk-cache` 的**「seed 登记在 KKV get 之前」**（`:368-369`）与 **「读失败/坏行撤销登记、行不存在不撤销」**（`:377-396`）：这一对看似绕口令的规则，实测口径是对的——前者保证并发只发一次读，后者区分「瞬时故障」与「本来就没东西」，把「加速」让位给「正确性」的选择被显式写下来了。
- **L1/L2 两层各持一份 `seededSessions`**（`prompt-whole-cache.ts:80-94`）看着像冗余，注释解释了共用一份会让先跑的那层吃掉另一层的登记——**这个坑是真实存在的**，分开是对的。
- `buildCounterScope` 用**字面文本 `"\\u0000"`（六字符）而非真 NUL**（`token-chunk-cache.ts:72-86`）：注释明写「勿改成真 NUL——会整体更换 scope 键、全部 L1/L2/KKV 缓存一次性 miss」。这是把「改了会怎样」的代价写在原地，属于我非常赞成的一类注释。
- `incremental-token-counter` 的**两条失败路径分开告警**（`warnedCommitFailure` / `warnedReadFailure`，`:216-224`）与 `unencodableChars` 只统计固化路径（`:76-86`）：语义收窄的理由写得很清楚（读值路径没丢字，计进去会让这一个字段同时表达两件事）。`reset()` 刻意不清该计数量的理由也写了。
- `count-text-with-tokenizer.ts:62-86` 的 `tailChars: 0 / commitStepChars: 1` 是**被 6024 字符读出 0 这个实测故障逼出来的**，注释给了真值对照（9,421，低估 36%），并且保留了 belt-and-braces 兜底。这类「反直觉参数 + 实测归因 + 兜底」的组合是本区最好的部分。

## D-8 若干被反复问到的点，我的立场是 `intentional`

- `tokenChunkCache` / `promptWholeCache` 的缓存**内容寻址、跨会话共享、落哪一行都无所谓**：注释已写明「只丢加速不丢正确性（下次计数重算即可）」，且会话删除的级联清理丢条目无正确性风险。这是**用正确性换掉一整套失效编排**，在缓存层是划算的交易。
- `encoding-registry` **永不 `free()`**：注释写明「句柄是共享的，任何一方 free 会让其它持有者拿到已释放句柄」，并给出替代口径（表以编码名为界、是小集合、WASM 内存随进程退出回收）。这是正确的取舍。
- `encoding-registry` 失败缓存带 **5 分钟 TTL 而非「失败永不重试」**：注释点名旧口径会把一次瞬时故障（资产暂缺）放大成整个进程寿命的降级。这是有证据的偏离，RULE 同款思路。

---

# 二、让步清单（我承认这些是真问题，请记账）

## Y-1【P2 confirmed】手动「数据清理」只清 blob 的 pending 标记，漏了消息压缩的

- `db-maintenance.service.ts:88-92`：
  ```ts
  await conn.execute("DELETE FROM kkv_entry WHERE module = ? AND key = ?",
    ["nm-blob-binary", "startupMaintenancePending"]);
  ```
- 但消息压缩任务有**自己独立**的 pending 键 `nm-message-content` / `startupMaintenancePending`（`message-content-compaction.ts:67-68`），且其注释明写「与 blob 归一侧**各自独立 pending key**、不共享单 key，避免两任务的补跑语义互相牵连」。
- 后果：用户手动点过「数据清理」之后，消息压缩那份 pending 标记仍在 → 下次冷启动 `runPendingStartupMaintenance` 无视 `processedAny` **强制再跑一次全库 VACUUM**（`message-content-compaction.ts:263-305`）。纯浪费、无正确性损失。
- 我不狡辩：blob 侧的 JSDoc 写着「手动『数据清理』成功后由 db-maintenance 侧顺带清掉」（`blob-binary-normalization.ts:68-70`），**读者合理预期两侧都被清**，实现只做了一半。要么补第二条 DELETE，要么把注释改成只覆盖 blob。

## Y-2【P2 confirmed】`tongyi` 一类模型 id 被误判成 `yi` 家族

- `resolve-tokenizer-family.ts:95-97` 的 `id.includes("yi")` 出现在 `deepseek`（:98）/ `glm`（:103）/ `gemma`（:111）/ `qwen`（:117）/ `nemo`（:126）**之前**。
- `tongyi`（通义）含子串 `yi` → 在第 95 行就 `return "yi"`，永远走不到 `qwen2`。这是 substring 表的经典顺序事故，我实测 `resolveTokenizerFamily("tongyi-large")` 的走向就是 `yi`。
- 影响面：只影响**本地 token 估算的词表选择**（估算值偏差），不影响真实请求与 API 口径。修法一行：把 `yi` 收紧为 `/(^|[-_./])yi([-_.]|$)/` 之类的边界匹配，或把它挪到 `qwen` 之后并显式排除 `tongyi`。

## Y-3【P2 suspected】`countWebTokenizerMessages` 绕开了本模块自己定的分块包装

- 模块头（`count-openai-style-message.ts:7-9`）写：「encode 的分块包装**唯一落点在本模块**……rn 调用侧不另包，避免双重包装」，`countOpenAiStyleMessages`（:58-60）也确实包了 `countTextWithIncrementalTokenizer`。
- 但同文件的 `countWebTokenizerMessages`（:103-109）**直接** `encode(converted).length`，无任何包装。若 Claude web 路径拿到「无空白长中文串」，就正好落进本区花大力气治的 O(len²) 病态（模块头实测：12K 字符 88s）。
- 我没能确认这条路径的实际入参形态（`packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:112` 的调用上下文我没读完），所以标 **suspected**，请 reduce 阶段核实；若 web 计数器只在短文本上用，应在注释里写明这个前提。

## Y-4【P3 confirmed】事件总线：旧 `unsubscribe` 会误删同类型的新订阅者

- `simple-event-bus.ts:40-47` 的闭包捕获了当初的 `set`，并在 `set.size === 0` 时执行 `this.handlers.delete(eventType)`：
  ```ts
  unsubscribe: () => {
    set!.delete(handler as EventHandler);
    if (set!.size === 0) { this.handlers.delete(eventType); }
  },
  ```
- 若期间发生过 `clear()`（测试用）后同名事件被重新订阅（新 `Set`），旧句柄的 `unsubscribe()` 会把**新 Set 从 map 里摘掉**，新订阅者从此收不到事件。
- 另外 `publish`（:51-63）直接遍历活 Set，handler 内退订自己会导致后续 handler 被跳过；语义未文档化。
- 生产侧 `clear()` 只有测试调用，所以严重度低；但 `forward-event-bus`（desktop）持有的是长生命周期订阅句柄，值得在收口时顺手改成 `if (this.handlers.get(eventType) === set) this.handlers.delete(eventType)`。

## Y-5【P3 confirmed】SKSP 三个源文件的注释已被编码损坏（字面 U+FFFD 入库）

- 实测（含字节级证据）：`composite-secret-store.ts:17` 的字节序列是 `EF BF BD 3F`（U+FFFD + `?`），位置 466；另有 `logic/ref-to-env.ts:8`、`ports/secret-store.port.ts:2` 同样形态。原本应是 `→`。
- 影响：纯注释、可读性；**但它违反 RULE「改任何含中文的文件一律用专用 Edit 工具（字节级安全）」的后果形态**，说明有一次 GBK/UTF-8 往返事故。建议按 RULE 第 111 条用 Edit 工具逐处修回，并在 CI 加一条「源文件不得含 U+FFFD」的静态检查（同款事故在 `build.gradle` 已经发生过一次）。

## Y-6【P3 confirmed】`infra/kkv/` 整个目录是死代码

- `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` 是该目录唯一文件（无 `index.ts`）；全仓（排除 dist）只有它自己的两处自引用，**零生产消费者、零测试消费者**。L0 的 `dead-exports.md:1128` 也把它标为「否」。
- `parseKkvJsonDocument` 本体也只是 `JSON.parse(raw)` + `decodeFn(parsed)` 的两行转发，不构成任何领域口径。
- 建议删除整个目录（属「退役件物理删除」那套既定节奏），而不是留着当「单源入口」——没有第二个调用方就不存在单源。

## Y-7【P3 confirmed】三个「按会话」的清理 API 没有任何生产调用方

- `promptWholeCache.clearSession` / `promptWholeCache.clearForTests`（生产侧 grep 零命中）、`clearChatTokenEstimateMemo`（只有测试）。
- 这**在正确性上完全可接受**（L1 内容寻址 + 32 条 LRU 上界；memo 每会话一条 + 64 会话上界），我反对把它们记成缺陷。但作为让步项要说清：`clearSession` 这个名字承诺的语义（「清掉一个会话的全部 L1 条目」）与它实际能做的事不匹配——**见 Y-8**。

## Y-8【P3 confirmed】`promptWholeCache` 的 sessionId 段恒为空串，`clearSession` 结构性无效

- 生产写口（`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:211`、`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:377`）与所有读口（`resolve-current-prompt-tokens.ts:240,246`、`tokenizer-driver-node/...:197`）传的都是 `""`。
- 因此 `PROMPT_WHOLE_CACHE_LRU_PER_SESSION = 32`（`prompt-whole-cache.ts:50`）**实际是进程级全局 32 条**，不是「每会话 32 条」；`clearSession(realSessionId)` 永远删不到生产条目（只能删测试造出来的）。
- 同时 `persistedItems` 却按真 `sessionId` 分桶（:78、:326、:363），「L1 内存层全局共享 / 持久化层按会话分行」这个不对称没有在任何注释里点破。
- 影响：内存有界（32 条）、无脏读，**不是缺陷**；但常量名与 JSDoc 会持续误导后来人。建议要么把参数名改成 `bucketKey` 并注明生产恒 `""`，要么把常量改名为 `PROMPT_WHOLE_CACHE_LRU_ENTRIES`。

## Y-9【P3 confirmed】`@deprecated` 的 tokenizer 映射函数仍是三个生产点的活依赖

- `resolve-tokenizer-family.ts:136` 标注 `@deprecated mapVendorModelIdToTiktokenModel`，但它被 `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts`、`.../impl/tiktoken-token-counter.ts`、`apps/mobile/src/services/stream-token-estimator.ts` 三处生产代码实调（我 grep 过 src，非 dist）。
- 与之配套的 `isGpt0301TiktokenModel`（未标 deprecated）被 `packages/tokenizer-driver-node/src/logic/openai-message-token-count.ts` 使用。
- 建议：要么删、要么把 `@deprecated` 去掉并注明「driver 层的 tiktoken 编码名解析仍需要它」。留着 deprecated 标签会让后续清理轮误删活代码。

## Y-10【P3 suspected】云同步 pull 的 `snapshotKey!` 非空断言有一个未闭合的前置条件

- `cloud-sync-coordinator.ts:152-156`：
  ```ts
  if (remote.rev > 0 && remote.snapshotKey == null) { throw new CloudSyncError("SNAPSHOT_MISSING", ...); }
  const snapKey = remote.snapshotKey!;
  ```
- 前一个门 `:148` 只保证 `remote.rev > lastSyncedRev`。若 `lastSyncedRev` 为负数且远端 `rev === 0`（空桶），两道检查都会放行，随后 `snapshotKey` 是 `undefined`，被送进 `storage.getToPath/get`。
- 当前两端调用方传的 `lastSyncedRev` 都是 ≥0 的持久化 rev，所以**我没能构造出真实触发路径**，标 suspected。修法一行：把门改成 `if (remote.snapshotKey == null) throw ...`（`rev === 0` 本来就不该 pull）。

## Y-11【登记为已知盲区，不重复立项】`startupMaintenanceRan` 是与连接无关的进程级标记

- `db-maintenance.service.ts:121,137-141`。它被测试的同进程第一条用例消费后，后续用例永远走短路返回 null——这正是 **RULE 第 82 条「验收断言的牙齿」里已经登记的原案例**（「进程级模块标记（如 `startupMaintenanceOnce` 的去重 `startupMaintenanceRan`）会被同文件第一条用例消费」）。
- 我确认代码与 RULE 记载一致，因此按协议标 **intentional / 已知盲区**、不重复报。但补一条观察：生产侧同一进程若换库（mobile 恢复备份后重开连接），该标记也会让新库的启动维护被跳过。窗口很窄（只在进程内换库时），但值得在优化轮加一行注释说明「标记按进程而非按连接，换库场景下维护会被跳过一次」。

---

## 争议与存疑（不抹平）

1. **Y-3 的严重度取决于我没读完的调用上下文**：`web-tokenizer-counter.ts:112` 传给 `countWebTokenizerMessages` 的文本是否可能是「无空白长中文串」。若 web 计数器只用于 Claude 网页版的短 system 段，这条可以降为 P4 / 直接删掉。
2. **Y-10 我没能证成**：需要 `lastSyncedRev < 0` 的调用方。两端目前都没有，但接口允许（`PullOptions.lastSyncedRev: number`），所以我保留而不升级。
3. **`serializeToolsForTokenCount` 与 UI 读口的 tools 口径差**：`serialize-tools-for-token-count.ts:17-22` 明写「UI 读口路径拿不到 tools 定义，本轮不补」。也就是说 **UI chip 的本地估算不含 tools，而压缩评估路径含**——两条路径对「同一份 prompt」给出不同读数。这在注释里是被登记的取舍（不是缺陷），但如果将来有人拿 UI 读数去解释压缩阈值行为，会踩坑。**建议在优化 backlog 里给 UI 读口补 tools**，但这属于功能请求不属于 CR 缺陷，我不主张现在动。
4. **`db-maintenance` 与 `session-kkv` 之间有一条真实的循环依赖规避妥协**：`db-maintenance.service.ts:84-87` 用字面量 `"nm-blob-binary"` 代替常量引用（并解释了原因）。方向正确，但**同一目录里的 `message-content-compaction.ts:56` 就直接 import 常量**——两条 pending key 现在一个走常量、一个走字面量，正好是 Y-1 漏清那半边的成因。这条我建议和 Y-1 一起改（提取一个共享常量模块，两个任务都 import，db-maintenance 不反向 import）。

## 与对抗对的关系

本报告为独立机位产出，未读 `raw/` 下任何其他代理的报告、未读 `synth/`。上面每条让步均可由报告内给出的 `file:line` 与引文直接复核；每条「辩护理由」也给了可证伪的依据（注释出处、实测数字、RULE 条目），检察官若不同意某条辩护，可直接针对我给的证据反驳而不必重扫全仓。