---
zone: w9-inframisc-pro
agent: prosecutor（对抗机位·猎杀冗余/死路径/缓存失效漏网/维护链竞态）
files_scanned: 68
scan_base: main@9ca5f5ad
---

## 摘要

`packages/core/src/infra/` 下 8 个非 LLM 协议的基础设施域：tokenizer（token 计数 + 三层缓存）、
content-cache（解压产物内存池）、sksp（密钥存储协议）、kkv（1 个纯函数）、events（进程内事件总线）、
cloud-sync（跨端同步协调器 + 租约锁 + push/agent 互斥）、db-backup（服务商三表 dump/scrub/restore）、
db-maintenance（谓词驱动的两个后台搬运任务 + VACUUM 维护链路）。约 5400 行。

## 职责与边界

- **tokenizer**：`infra/nmtp`（driver 注册制）的记忆层 + 计数算法 + L1/L2/估算记忆三层缓存。
  真分词器在 `packages/tokenizer-driver-{node,rn}/`，core 自身零分词器依赖。
- **content-cache**：进程内 LRU 解压产物池，内容寻址（明文 sha256）。
- **sksp**：`SecretStore` 端口 + 驱动注册表 + 三端 SQLite secret store 模板方法基类。
- **cloud-sync**：`CloudSyncCoordinator`（pull/push 编排）+ 云端租约锁 + 进程内 push/agent 互斥锁。
- **db-backup**：服务商三表（`sksp_secrets` / `llm_provider` / `llm_saved_model`）的快照与还原。
- **db-maintenance**：`message-content-compaction` 与 `blob-binary-normalization` 两个谓词驱动后台任务 +
  `runStartupMaintenanceOnce` 进程级去重的维护链路（GC → checkpoint → VACUUM）。

## 对外接口

`core/src/index.ts` 与 `public/{provider,format,events}.ts` 是出口面。关键导出：
`resolveCurrentPromptTokens` / `resolvePromptTokensWithBackfill` / `promptWholeCache` / `tokenChunkCache` /
`CloudSyncCoordinator` / `runStartupMaintenanceOnce` / `runMessageContentCompaction` /
`runBlobBinaryNormalization` / `createCompositeSecretStore` / `restoreProviderTableSnapshot`。

## 数据访问

| 对象 | 位置 | 证据 |
|---|---|---|
| `chat_message.content_json/content_blob/content_encoding` | 压缩搬运 UPDATE | `impl/message-content-compaction.ts:428` |
| `chat_message.content_blob`（形态归一） | blob 归一 UPDATE | `impl/blob-binary-normalization.ts:195` |
| `vfs_content_blob` / `session_file_cache_blob` | 归一 UPDATE | `impl/blob-binary-normalization.ts:163,179` |
| KKV `nm-message-content/compactionDone`、`nm-blob-binary/{vfsContentDone,fileCacheDone,messageContentDone}` | 完成标记 | `message-content-compaction.ts:56`、`blob-binary-normalization.ts:60` |
| KKV `nm-*/startupMaintenancePending` | 维护失败兜底 | `blob-binary-normalization.ts:72`、`message-content-compaction.ts:67` |
| KKV `token_chunks/{chunkCache,promptWholeCache}`、`prompt_tokens/lastUsage` | 缓存持久化 | `prompt-whole-cache.ts:280`、`session-api-prompt-token-store.ts:222` |
| KKV `kkv_entry`（裸 SQL，绕过 repository） | 手动清理删兜底标记 | `db-maintenance.service.ts:90` |
| `sksp_secrets` | 密钥 CRUD | `base-sqlite-secret-store.ts:41,63,77,100` |
| `llm_provider` / `llm_saved_model` / `sksp_secrets` | dump/scrub/restore | `provider-table-snapshot.ts:42,104,122` |
| 云端 `status.json` / `snapshots/rev-N.nmbackup` | pull/push | `cloud-sync-coordinator.ts:160,250,256` |

## 依赖关系

- **import 谁**：`tdbc`（连接/模板）、`sql-template`、`domain/session-kkv`（KKV 域常量 + service 端口）、
  `domain/vfs/content-store`（hashContent / zlib codec）、`domain/chat/logic/message-content-codec`、
  `service/prompt/render-prompt`、`domain/prompt/model/agent-prompt-layout`、`../nmtp`（driver registry）。
- **被谁消费**：`tokenizer-driver-node` / `tokenizer-driver-rn`（计数 + L1/L2）、
  `apps/{desktop,mobile,cli}`（云同步、备份、维护调度）、`domain/compaction-conditions`（heuristic 兜底）。
- **循环依赖**：`db-maintenance.service.ts:86` 明确记录了与 `blob-binary-normalization` 的反向引用会成环，
  故 `:91` 用字面量而非常量——这是**已知的、有意的**规避，不是缺陷。

## 发现清单

### F-w9-01 | P1 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:90-92`

```ts
await conn.execute(
  "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
  ["nm-blob-binary", "startupMaintenancePending"]
);
```

**描述**：手动「数据清理」成功后只清 blob 归一侧的 `startupMaintenancePending` 兜底标记，
漏了压缩搬运任务**同名 key、不同 module** 的那一份（`MESSAGE_COMPACTION_KKV_MODULE = "nm-message-content"`，
key 同为 `"startupMaintenancePending"`，见 `message-content-compaction.ts:56,67`）。

**后果**：压缩任务收尾维护失败置过标记后，用户手动点一次「数据清理」（页空间其实已经回收了），
标记仍在 → 下次冷启动 `runPendingStartupMaintenance`（`message-content-compaction.ts:263`）
无视「完成标记已置」的稳态短路，**强制补跑一次全库 VACUUM**。正是该段注释（`:81-87`）自己说要避免的
「纯浪费」。

**建议**：`db-maintenance.service.ts:89-92` 改成一条 `module IN (?, ?)`，两个 module 都清。
（顺带：`kkv_entry` 裸 SQL 绕过 `SqliteKkvRepository`，与本仓 KKV 读写惯例不一致，可一并收口。）

**置信**：confirmed

---

### F-w9-02 | P1 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182`

**描述**：`pull()` 全程**不查 `dbSync.isAgentActive()`**。而 `push()` 查了两次
（`:219` 入口、`:267` 续租点），`DbSyncPort` 也把 `isAgentActive` 定为端口成员
（`ports/db-sync.port.ts:11`）。两端 app 的 pull 路径同样只有 `syncBusy` / `configured` 守卫：
`apps/desktop/src/main/ipc/handlers/cloud-sync.ts:87-92`、`apps/mobile/src/services/cloud-sync.service.ts:307-340`。

pull 的动作是 `importSnapshot` / `importSnapshotFromPath`——**整库替换本地 db 文件**
（`apps/desktop/src/main/services/db-backup.service.ts:113-123`：close 连接 → `copyFile` 覆盖 → 重开）。
agent 跑着的时候点「拉取」，正在进行的 run 的全部未落库状态与写连接一起被抹掉。

**建议**：`pull()` 在 `assertConfigured()` 之后加一道 `isAgentActive()` 拒绝（抛 `AGENT_ACTIVE`，
该错误码已在 `errors/cloud-sync-errors.ts:13` 定义、当前只被 push 用）；或按 `pull-agent-mutex`
对称化，让 agent 启动入口也参与互斥。

**置信**：confirmed（代码路径已逐层核对；app 侧无二次守卫）

---

### F-w9-03 | P1 | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:57-65`

```ts
let defaultPushMutex: PushAgentMutex | null = null;
export function getDefaultPushAgentMutex(): PushAgentMutex { … }
```

**描述**：`PushAgentMutex` 的设计意图是「push 持锁期间 agent 启动入口排队」（`logic/push-agent-mutex.ts:4-11`），
`getDefaultPushAgentMutex` 被 export 就是为了让 apps runtime 的 agent 启动入口拿同一实例
（`cloud-sync-coordinator.ts:49` 的注释原话）。但**全仓 grep 无任何生产调用方**——
`git grep getDefaultPushAgentMutex` 只命中定义处与本文件 `:119`。

**后果**：这把锁目前只互斥 push↔push。agent 侧完全不知道它的存在。
push 导出快照 → 上传期间 agent 启动，`isAgentActive()` 在 push 入口（`:219`）采样时还是 false，
agent 顺利开跑并写库；push 直到 `:267` 续租点才复检到、抛 `AGENT_ACTIVE` 走 finally 清锁——
但**云端已经收到不含 agent 那批写入的 rev N+1 快照，且 status 被清成未提交**。
即：数据在云端是一致的旧版本，本地 agent 的写入既没进快照、push 又被拒（用户看到失败），
但 agent 的写入其实**已经落到本地库了**——真正丢的是「这次推送」而不是数据。真正的隐患是
「上传耗时 > lease/2 时先续租再复检」的顺序（`:271-284` 在 `:267` 之后）：续租 PUT 已发生，
才复检 agent。

**建议**：要么在 `handleAgentRun` / mobile 对应入口接入 `getDefaultPushAgentMutex()`（让注释成真），
要么把 `PushAgentMutex` 降级为「push 排队锁」并同步改掉 `push-agent-mutex.ts:4-11` 与
`cloud-sync-coordinator.ts:44-51` 的注释——现状是**注释承诺了未接线的保护**。

**置信**：confirmed（调用方已穷举 grep）

---

### F-w9-04 | P2 | `packages/core/src/infra/tokenizer/logic/chunk-splitter.ts:52-61`

```ts
if (SENTENCE_END_CHARS.has(ch)) {
  let end = i + 1;
  while (end < n && SENTENCE_END_CHARS.has(text[end])) end++;
  chunks.push(text.slice(start, end));
```

**描述**：句末贪吃分支**没有 64 字符上限检查**。模块头 `:14` 声称「块内无任何软边界时按上限硬切…
保证后续逐块 encode 恒 ≤64 字符」，`:38-42` 把「每块长度恒 ≤ 64」列为不变量，
测试 `chunk-splitter.test.ts:16-29` 的 `assertInvariants` 也断言 `chunk.length <= MAX_CHUNK_CHARS`。
但只要一段**连续句末符号超过 64 个**，贪吃就会一口气吞完、产出超限块。

实测（`tmp/w9-chunk-probe*.mjs`，复刻同款切分逻辑）：
- `"正文……" + "…".repeat(120)` → 1 块，**124 字符**；
- `"```js\n" + "\n".repeat(80) + "const a = 1;\n```"` → 出现 **86 字符**块
  （`\n` 在 `SENTENCE_END_CHARS` 里，`:26`，代码块里的连续空行是真实可达形态）；
- `"…".repeat(200)` → 单块 200 字符。

现有测试之所以绿，是因为三个不变量用例的输入里**没有任何一段连续句末超过 64**——
断言有形状没牙齿（RULE「验收断言的牙齿」第 ① 条的典型反例）。

**后果**：不会 O(len²) 崩（`countTextWithIncrementalTokenizer` 内部还会再切 ≤64），
但 L2 块缓存的**粒度失控**：一个 124 字符的块只产 1 个 `chunkHash16` 键，
块内任意一处编辑即整块 miss，编辑局部性（模块头 `:4` 声称的核心收益）在这类文本上完全丧失。

**建议**：贪吃循环加 `end - start < MAX_CHUNK_CHARS` 上限；并给 `assertInvariants` 补一条
「连续句末 ≥100」的输入，让不变量真有牙齿。

**置信**：confirmed（实测复现）

---

### F-w9-05 | P2 | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts:15`

**描述**：`parseKkvJsonDocument` 是零调用方的死文件。`git grep parseKkvJsonDocument -- packages apps`
只命中定义行本身。函数体也只是 `JSON.parse` + 回调，仓内 KKV 解码都各自 inline
（如 `session-api-prompt-token-store.ts:114`、`token-chunk-cache.ts:216`）。

**建议**：删除文件；若确有「KKV JSON 文档解析单源入口」的规划意图，至少在模块头注明「尚未接入」。

**置信**：confirmed

---

### F-w9-06 | P2 | `packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:363-366`

**描述**：`clearSession(sessionId)` 是生产零调用方的死路径（`git grep` 只命中测试）。
根因是设计本身：**生产侧所有 L1 读写都用空串 sessionId**——
`resolve-current-prompt-tokens.ts:240,246` 查 `lookup("", …)`，
`tokenizer-driver-node/src/count-prompt-llm-input.ts:197,211` 同样 `lookup/record("", …)`
（rn 驱动 `:357,377` 同款）。所以 `buckets` 在生产里**永远只有一个 `" "` 键**，
`evictToLimit`（`:116-124`）的「单会话 32 条」实际是「全进程 32 条」；
`stats().sessions`（`:379-385`）恒为 1。模块头 `:5-13` 描述的「会话级 LRU 32」与实现不符。

**建议**：要么删掉 `sessionId` 参数与 `clearSession`（承认进程级单桶），要么真按会话分桶。
当前形态下次改键会静默丢加速，且注释会持续误导后来人。

**置信**：confirmed

---

### F-w9-07 | P3 | `packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts:386`

```ts
rememberChatTokenEstimateMemo(sessionId, memoKey!, { … });
```

**描述**：非空断言 `memoKey!`。`memoKey` 由 `resolveMemoKey()`（`:309-316`）产出，
`buildChatTokenEstimateMemoKey` 在 `workplaceFingerprint == null || layout == null` 时返回 `null`
（`chat-token-estimate-memo.ts:234-237`）。当前不可达——`:364` 已判 `fingerprint != null`、
`CountPromptLlmInputParams.layout` 是必填非可选（`count-prompt-llm-input.ts:23`）。
但断言掩盖了「memoKey 可能为 null」这个真实分支：若将来 `layout` 变可选（或调用方传
`workplaceFingerprint` 与 `layout` 不一致的组合），这里会往 memo 里写一条 `key === null` 的条目，
白占 64 条上限中的一个槽位且永不可查。

**建议**：改成 `if (memoKey != null) { … }` 包一层，与 `:417` 的写法对齐。

**置信**：suspected（当前不可达，是防御性断言）

---

### F-w9-08 | P3 | `packages/core/src/infra/sksp/impl/composite-secret-store.ts:17`、`logic/ref-to-env.ts:8`、`ports/secret-store.port.ts:2`

**描述**：三个文件的注释里各有一个 U+FFFD 替换字符（编码损坏残留）：
- `composite-secret-store.ts:17` → `Read order: env hit �?DB;`
- `ref-to-env.ts:8` → `` `provider/<id>/apiKey` �?`NOVEL_MASTER_PROVIDER_<ID>_API_KEY` ``
- `secret-store.port.ts:2` → `Secret Key Storage Protocol �?async secret store port.`

原字符应是 `→` / `—`。RULE「PowerShell 管道改写 UTF-8 中文文件必毁编码」是同类事故的记录。

**建议**：用 Edit 工具（字节级安全）逐个改回箭头，勿用 PowerShell 管道。

**置信**：confirmed（`node -e` 扫 `\uFFFD` 定位，三处均命中）

---

### F-w9-09 | P3 | `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-cache.ts:38-45`

```ts
clear(sessionId: string): void { store.delete(sessionId); },
/** 与 {@link clear} 等价；失效 call-site 语义别名。 */
invalidate(sessionId: string): void { store.delete(sessionId); },
```

**描述**：`clear` 与 `invalidate` 逐字相同的两个方法并存。生产只调 `invalidate`
（`session-api-prompt-token-store.ts:253`），`clear` 只被测试用。注释自己承认「等价」。

**建议**：删 `clear`，或保留其一。

**置信**：confirmed

---

### F-w9-10 | P3 | `packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts:58-71`

**描述**：`isHeld()` / `waiterCount()` 两个观测方法标注「调试/监控用」，
全仓无生产调用方（`git grep` 仅命中本文件与 `packages/core/test/cloud-sync/coordinator.test.ts`）。
非缺陷，但与 F-w9-03 合看：整个 `PushAgentMutex` 的对外观测面 + 单例 accessor 都是为「agent 侧接入」
准备的，而接入没发生。

**建议**：随 F-w9-03 一并处置。

**置信**：confirmed

---

### F-w9-11 | P3 | `packages/core/src/infra/db-backup/provider-table-snapshot.ts:50-52`

**描述**：`scrubProviderTables(conn)`（无 alias 版）在生产侧无调用方——两端 app 都走
`scrubProviderTablesInDatabase`（`apps/desktop/.../db-backup.service.ts:81`、
`apps/mobile/.../db-backup.service.ts:113`）；`scrubProviderTables` 只出现在
`packages/core/test/db-backup/provider-table-snapshot.test.ts` 与导出面
（`infra/db-backup/index.ts:14`、`core/src/index.ts:73`、main-entry allowlist 快照）。

**建议**：确认是否要保留公开 API；不需要则从导出面摘掉（allowlist 快照同步改）。

**置信**：confirmed

---

### F-w9-12 | P3 | `packages/core/src/infra/db-backup/provider-table-snapshot-validate.ts:23-27`

```ts
const KNOWN_PROTOCOLS: ReadonlySet<LlmProtocolKind> = new Set([
  "openai", "anthropic", "gemini",
]);
```

**描述**：注释自称「与 `LlmProtocolKind` 运行时枚举保持一致的**单源**」，实际是**第二份手抄**——
`LlmProtocolKind` 是纯类型联合（`infra/llm-protocol/ports/adapter.port.ts:12`），编译期不存在，
所以这份 `Set` 与类型定义之间没有任何编译期约束。将来加第四个协议而忘了改这里，
db-backup import / cloud-sync pull 会对**合法的备份**抛 `INVALID_PROVIDER_ROW`，把好备份挡在门外。

**建议**：从真实 adapter registry（`infra/llm-protocol/logic/registry.ts`）派生协议集合，
或至少把注释里的「单源」改成「副本，加协议时必须同步」，并在 `LlmProtocolKind` 上加编译期断言。

**置信**：confirmed

---

### F-w9-13 | P3 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:354`

**描述**：`runMessageContentCompaction` 的**每次调用**（含稳态、完成标记已置的短路路径）
都在最前面跑一次 `runPendingStartupMaintenance`（`:263-305`），后者无条件发一次 KKV `get`
（`:268-271`）。稳态下这个 get 必然返回 null，纯粹是一次多余查库。
`getMessageCompactionStatus` 对同一份标记已有「标记已置则免 COUNT 快路径在缓存检查之前返回」
的零成本设计（`:321-323`），收尾补跑这条路径没做同款短路。

**建议**：`runPendingStartupMaintenance` 内在读 KKV 前无法短路（它就是读标记的那一方），
但可在 `runMessageContentCompaction` 里把「完成标记已置」判断提到 pending 补跑之前——
pending 补跑的原意是「完成标记已置也要补跑」（`:255-257`），所以这条优化**与语义冲突**，
应改为在进程内缓存一次「本进程已确认无 pending」的结论，或接受现状并在注释里说明成本。

**置信**：suspected（成本极小，仅记录取舍）

---

### F-w9-14 | P3 | `packages/core/src/infra/tokenizer/logic/resolve-tokenizer-family.ts:136`

**描述**：`mapVendorModelIdToTiktokenModel` 标了 `@deprecated`「Use `resolveTokenizerFamily`」，
但**四个生产调用方全在用**：`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:249`、
`packages/tokenizer-driver-node/src/impl/tiktoken-token-counter.ts:38`、
`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:211`、
`apps/mobile/src/services/stream-token-estimator.ts:126`。
deprecated 标记是失效的，会让后来人以为可以安全替换（实际上两个函数的返回域不同：
一个返回 `TokenizerFamily`，一个返回 tiktoken 模型名，不可互换）。

**建议**：摘掉 `@deprecated`，或改注释说明「两者语义不同、各自保留」。

**置信**：confirmed

---

### F-w9-15 | P3 | `packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts:15-32`

**描述**：`VALID_FAMILIES`（15 项）与 `TokenizerFamily`（`ports/token-counter.port.ts:10-26`，16 项）
不一致：**缺 `glm`**。因此一个 `tokenCounterMode = "glm"` 的已保存模型会被
`isValidTokenCounterModePref`（`:35-37`）判为非法、被 `parseTokenCounterModePref`（`:40-54`）
静默归一成 `"auto"`。而 `resolveTokenizerFamily` 明确支持 glm 家族（`resolve-tokenizer-family.ts:103`）。

**建议**：以 `TokenizerFamily` 为源生成该 Set，或补 `glm` 并加一条类型级断言防漂移。

**置信**：confirmed（逐项比对两份集合）

---

### F-w9-16 | P3 | `packages/core/src/infra/events/simple-event-bus.ts:56-62`

**描述**：`publish` 直接遍历 `set`（`for (const handler of set)`）。JS `Set` 迭代器会访问
**迭代期间新增**的元素——若某个 handler 在回调里 `subscribe` 同一 `eventType`，
新 handler 会在同一次 publish 中被立即调用，可构成无限递归。
`unsubscribe` 在迭代期间删除则是安全的（已访问的不重复、未访问的跳过）。

**建议**：`publish` 前 `const snapshot = [...set]` 快照后遍历，成本可忽略，语义确定。

**置信**：suspected（当前调用方未构造出该模式，属潜在隐患）

---

### F-w9-17 | intentional | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:121`

```ts
let startupMaintenanceRan = false;
```

进程级（非连接级）去重标记。**RULE 已记**：「验收断言的『牙齿』第 ② 条」明确点名这个模块级标记
会让同进程后续用例永远不可观测（实例：`startupMaintenanceRan`）。生产是单进程单库单连接，
语义正确。**不作为缺陷上报**，此处仅标注供 reduce 阶段对齐口径。

**置信**：intentional（RULE「验收断言的牙齿」条 + `message-content-compaction.test.ts:11` 用例顺序纪律注释）

---

### F-w9-18 | intentional | `packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:21-25`、`token-chunk-cache.ts:33-37`

L1/L2 的「pending 列表全局收集、persist 时归入最近一次调用 persist 的会话」
（`prompt-whole-cache.ts:21-25`）与「L2 跨会话共享、整表按调用方 sessionId 落行」
（`token-chunk-cache.ts:186-191`）都是**显式拍板的取舍**，注释写明「落哪个会话行只影响加速续命位置、
无脏读；会话删除的级联清理会连带丢他会话条目，只丢加速不丢正确性」。**不报**。

**置信**：intentional（模块头显式记录）

---

### F-w9-19 | intentional | `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts:17-36`

内容正文池「不需要任何失效机制」+「blob 行被 GC 后热态仍读得到」的生产取舍，模块头 `:24-29`
逐条论证过并显式接受。RULE「工作区与存储层」相关条目同款。**不报**。

**置信**：intentional

---

### F-w9-20 | intentional | `packages/core/src/infra/sksp/logic/registry.ts:37-60`

`resolveSkspDriver()` 在「0 个或 ≥2 个 driver」时抛错，与 TDBC registry（`infra/nmtp/logic/registry.ts:34-64`）
逐字同款语义，是**宿主注册制**的刻意设计。RULE「TDBC 驱动层」已把注册制列为项目口径。
**不报**。

**置信**：intentional（RULE「TDBC 驱动层」条 + 与 nmtp registry 的对称实现）

---

## 争议与存疑

1. **F-w9-03 的严重度我拿不准**。若把「push 期间 agent 能启动」当成**已接受的现状**
   （`cloud-sync-coordinator.ts:217-218` 的注释原话是「入口仍保留 `isAgentActive` 检查：
   兼容 apps runtime 尚未接入互斥锁的旧路径」——这读起来像「已知未接线、暂可接受」），
   那它应降为 P2 的「注释与实现不一致」。我按 P1 上报的理由是：注释在 `:44-51` 明确把
   `getDefaultPushAgentMutex` 的导出**定位为给 agent 入口用**，且 `push-agent-mutex.ts:4-11`
   整段论证「之前 coordinator 只在入口采样一次、agent 抢跑就静默拿到脏数据」——
   这段论证描述的正是当前实际状态。若裁决方认为「apps 侧另行处理」，
   请把 `push-agent-mutex.ts` 头注释一并改掉，否则下一个 agent 读到会以为保护已生效。

2. **F-w9-13 我倾向不修**。语义上「完成标记已置也要补跑」是硬要求，省不掉那次 KKV 读。
   记录在此供 reduce 阶段决定是丢弃还是接受。

3. **F-w9-07 当前不可达**，是否值得改成显式判空取决于调用方是否可能演进出
   `workplaceFingerprint` 与 `layout` 不一致的组合。我没找到这样的调用方，
   但也没找到「二者必然一致」的显式约束（`assemble-workplace-display.ts` 是唯一产出处，
   未见契约声明）。

4. **未覆盖的邻接域**：`infra/tdbc` / `infra/llm-protocol` / `infra/serialization` /
   `infra/sql-template` / `infra/prompt-template` 不在本 zone，`db-maintenance` 任务对它们的
   依赖（`executeTemplate` / `SqlTemplateParser` / 裸 `conn.execute`）我只核对了调用形态，
   没有审计 tdbc 驱动层的可重入性——RULE「VACUUM 与维护类 SQL」条提到的
   「事务回调里误用外层 conn 会撞 AsyncMutex 不可重入」这条，在本 zone 的
   `provider-table-snapshot.ts:87-92`（restore 事务内用的是 `tx`，正确）与
   `message-content-compaction.ts:426-433` / `blob-binary-normalization.ts:599-607`
   （单行短事务内用 `tx`，正确）都**符合**该纪律，未发现问题。

---

## 自查：本 zone 覆盖率

68 个 `.ts` 文件全部读过原文（`tokenizer` 31 / `content-cache` 1 / `sksp` 12 / `kkv` 1 /
`events` 1 / `cloud-sync` 11 / `db-backup` 5 / `db-maintenance` 6）。
本报告未读 `raw/` 与 `synth/` 下任何他人报告（对抗纪律）。
未执行任何 git 写操作；仅新增两个 scratch 探针 `tmp/w9-chunk-probe.mjs` / `tmp/w9-chunk-probe2.mjs`
（`tmp/` 已在根 `.gitignore`）。
