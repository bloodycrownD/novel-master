---
zone: w4-msgstore-pro
agent: 检察官（prosecution，猎杀问题向）
files_scanned:
  - packages/core/src/domain/chat/repositories/message.port.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/logic/message-content-codec.ts
  - packages/core/src/domain/chat/logic/tool-use-count.ts
  - packages/core/src/domain/chat/content/parse-message-content.ts
  - packages/core/src/domain/chat/content/message-content-match.ts
  - packages/core/src/infra/content-cache/logic/decoded-content-cache.ts
  - packages/core/src/infra/db-maintenance/db-maintenance.port.ts
  - packages/core/src/infra/db-maintenance/index.ts
  - packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts
  - packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts
  - packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts
  - packages/core/src/service/chat/impl/usage-stats.service.ts
  - packages/core/src/service/chat/impl/message.service.ts（读 1-330、490-518）
  - packages/core/src/bootstrap/chat/chat-schema.ts
  - packages/core/src/bootstrap/novel-master-bootstrap.ts（读 325-360）
  - packages/core/src/bootstrap/provider/provider-schema.ts（定位 DDL）
  - packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts
  - apps/desktop/src/main/runtime/connection.ts
  - apps/desktop/src/main/services/db-maintenance.service.ts
  - apps/desktop/src/main/services/message-content-compaction.service.ts
  - apps/mobile/src/services/message-content-compaction.service.ts
  - apps/mobile/src/services/db-backup.service.ts（定位 rebootstrap 契约）
---

## 摘要

消息存储链：core 侧 `chat_message` 的 TDBC repository（列表/分页/头投影/搜索/写删改）、
正文压缩 codec（`content_json` 明文 ↔ `content_encoding`+`content_blob` 两列）、
两个后台搬运任务（消息正文压缩、blob 形态归一）与它们挂的维护链路（GC→checkpoint→VACUUM），
外加 usage-stats 聚合服务（token 统计 + 会话详情工具调用数缓存）。

## 职责与边界

- **写面**：`SqliteMessageRepository.insert/batchInsert/updateContent` 是正文编码的唯一收口
  （`toMessageParams` 置 `content_json=''`，正文走 blob 两列）；`deleteAfterSeq` 是回滚的物理删尾。
- **读面**：所有列表/搜索/单查走 `readRowContent`（blob 非空→解压，否则 parse 明文），
  解压产物按 messageId 进进程内 LRU（`infra/content-cache`）。
- **搬运面**：`message-content-compaction`（谓词 `content_json != ''` → 压缩）与
  `blob-binary-normalization`（谓词 encoding/TYPEOF → 二进制化）都是「谓词驱动、批 ≤100、
  keyset 游标、KKV 完成标记、完成后挂一次维护链路」的同款骨架，**不注册 schema migration**。
- **统计面**：`DefaultUsageStatsService` 从 `chat_message` 的逐消息 token 列聚合，
  命中率为计费口径（anthropic 加回 cache），会话详情工具调用数走 session KKV 缓存 + miss 现算。
- **边界外但耦合**：`bootstrapNovelMaster` 是整库替换（备份导入/云同步 pull）后的唯一收口，
  负责 `clearDecodedContentCaches()`——解压缓存的生命周期正确性完全挂在它身上。

## 对外接口

- `MessageRepository`（`message.port.ts:12-118`）：listBySession / listMessageHeadersBySession /
  countBySession / listBySessionOffset / listBySessionFromSeq / listBySessionTail / listBySessionPage /
  findById / nextSeq / insert / batchInsert / updateContent / delete / deleteBySession /
  deleteAfterSeq / listIdsAfterSeq / updateHidden / updateHiddenRange / searchMessages。
- `encodeMessageContent(json) → {encoding, blob}`、`decodeMessageContent(encoding, blob, messageId) → json`
  （`message-content-codec.ts:43,71`），后者是消息正文**统一读口**并写 LRU。
- `runMessageContentCompaction(conn, opts)` / `getMessageCompactionStatus(conn)`；
  `runBlobBinaryNormalization` / `getBlobBinaryStatus`；
  `createDbMaintenanceService(conn).runDatabaseMaintenance()/getStorageStats()`；
  `runStartupMaintenanceOnce(conn)`（进程级去重入口，返回 `null` 表示本进程已跑过）。
- `DefaultUsageStatsService`：getSummary / getDailyBuckets / getHourlyBuckets / getModelBreakdown /
  listRequestUsage / listModels / getSessionUsageDetail。

## 数据访问

| 表 / 域 | 触点 | 证据 |
|---|---|---|
| `chat_message`（含 content_json/content_encoding/content_blob + 21 列） | 全量 SELECT 列表、INSERT/UPDATE/DELETE、5 类后台谓词 | `sqlite-message.repository.ts:31,38-41,226,290,308,331,350,378,394,422,429,443,452,464,475,491,519,552`；`message-content-compaction.ts:161,391,428`；`blob-binary-normalization.ts:113,191,195`；`usage-stats.service.ts:211,282,392,455,467,515` |
| `chat_message` DDL | `UNIQUE(session_id, seq)`、content_json NOT NULL、encoding CHECK、role CHECK | `bootstrap/chat/chat-schema.ts:28-59` |
| `kkv_entry` | 搬运完成标记（`nm-message-content`/`compactionDone`、`nm-blob-binary`/*Done）、两个 `startupMaintenancePending` | `message-content-compaction.ts:56-68,207,491,533`；`blob-binary-normalization.ts:60-72,309,411,435`；`db-maintenance.service.ts:89-92` |
| session KKV `usage_stats` | `toolUseCount` 读（miss 现算）/ 失效（哨兵空串） | `usage-stats.service.ts:472-476,548-559`；`message.service.ts:111-126,219-221,265,280,460,491`；`message-rollback.service.ts:276-282` |
| `llm_saved_model.vendor_model_id` | 「其他模型」桶的 NOT IN 子查询 + 归并用配置集 | `usage-stats.service.ts:82-84,314,432` |
| `session_file_cache_blob` | 维护链路第 1 步 GC | `db-maintenance.service.ts:66` |

## 依赖关系

- **import 谁**：`sqlite-message.repository` → `tdbc` 连接/模板、`sql-template`、`parse-message-content`、
  `message-content-match`、`message-content-codec`、`infra/content-cache`。
  两个搬运任务 → `SqliteKkvRepository` + `encodeMessageContent` / `base64ToBytes` + `runStartupMaintenanceOnce`。
  `usage-stats.service` → `parseMessageContent` + `decodeMessageContent` + `countToolUseBlocks` + session-kkv service。
- **被谁消费**：`message.service`（append/delete/updateContent/fork/copy/隐藏/截断/搜索）、
  回滚服务、压缩/置位锚定、UI 读口（token chip、转录、搜索页）、desktop/mobile 存储页状态行、
  desktop/mobile/cli 三个启动调度。
- **跨模块耦合热点**：解压缓存是**进程级**单例，其清空只挂在 `bootstrapNovelMaster`
  （`novel-master-bootstrap.ts:345`）；`db-maintenance.service` 与 `blob-binary-normalization`
  之间刻意用字面量而非 import 避环（`db-maintenance.service.ts:84-87`）——见 F-1/F-7。

## 发现清单

### F-w4-msgstore-pro-1 | P2 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:88-92`

```ts
await conn.execute(
  "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
  ["nm-blob-binary", "startupMaintenancePending"]
);
```

**描述**：手动「数据清理」成功后只清 `nm-blob-binary` 的 `startupMaintenancePending` 兜底标记。
但 `message-content-compaction` 用**另一个 module**（`nm-message-content`，同一 key 名）写同一个语义的标记
（`message-content-compaction.ts:56,67,533-537`），且全仓扫描确认：除了 compaction 任务自身，
**没有任何代码清过 `nm-message-content/startupMaintenancePending`**（db-maintenance.service.ts:89、
blob-binary-normalization.ts:434 的 DELETE 都只带 `BLOB_BINARY_KKV_MODULE`）。
**后果链**：compaction 收尾 VACUUM 失败一次 → 置 `nm-message-content` 标记 → 用户点「数据清理」成功
（页空间已回收，标记语义上已失效）→ 标记留库 → 下个冷启动
`runPendingStartupMaintenance`（`message-content-compaction.ts:263-305`）无视「本轮无进展」强制补跑一次
**全库 GC + checkpoint + VACUUM**，desktop 上还要冻一次 main 事件循环。
纯浪费、无正确性损失，但与代码里写明的意图（advisory③：手动清理顺手清标记，否则「下次冷启动多跑一次
全库 VACUUM 纯浪费」）自相矛盾——意图只兑现了一半。
**建议**：`runDatabaseMaintenance` 末尾改成一条多 module 的 DELETE（`module IN ('nm-blob-binary','nm-message-content')`），
或让两个任务把 module 收敛成同一个 `nm-db-maintenance` 域（key 各自独立，与现有「各 pending key 独立」的设计一致）。
**置信**：confirmed（写入点、清理点、清理缺口均已逐处核对）。

### F-w4-msgstore-pro-2 | P2 | `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:360-369`

```ts
async nextSeq(sessionId: string): Promise<number> {
  const rows = await queryTemplate<{ max_seq: number | null }>(... `SELECT MAX(seq) AS max_seq ...`);
  const maxSeq = rows[0]?.max_seq;
  return maxSeq == null ? 1 : Number(maxSeq) + 1;
}
```

**描述**：`nextSeq`（读 MAX）与 `insert`（写）是两次独立 await，`message.service.append`
（`message.service.ts:193,210`）在两者之间没有任何事务或串行化。
DDL 上有 `UNIQUE (session_id, seq)`（`bootstrap/chat/chat-schema.ts:56`），所以撞号不会静默写坏数据，
但会以**未类型化的 SQLite 约束错误**冒到调用方。
**后果链**：同一会话两条 append 交错（run 流式写消息 vs 用户/其他入口发消息；或回滚删尾后并发追加）
→ 两条拿到同一 seq → 后写者 INSERT 抛 `UNIQUE constraint failed` → 该消息丢失、run 步骤炸出，
没有重试也没有 `chatInvalidArgument` 化的错误文案。RULE 协作红线里那条「UNIQUE/约束类报错未必是代码 bug
……发号器回退类病灶」的注记，说明这类发号器问题在真机上出现过。
**建议**：`append` 把 `nextSeq + insert` 放进同一个 `conn.transaction`（单连接驱动层已串行化，天然互斥），
或在 `insert` 撞 `UNIQUE(session_id, seq)` 时重取 `nextSeq` 重试一次。
**置信**：confirmed（结构与约束）；并发可达性 suspected（单进程单连接 + UI 大概率禁并发发送，实际触发概率未实测）。

### F-w4-msgstore-pro-3 | P2 | `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:537-590`

```ts
const scanLimit = Math.max(clampedLimit * 20, 200);
...
const messages = await this.mapRows(rows);   // 整段行全部解压 + 全部塞进全局 LRU
for (const msg of messages) { if (messageMatchesKeyword(msg, keyword)) matched.push(msg); }
```

**描述**：「全量精筛」这个**决策**本身是 RULE 拍板的 intentional（`docs/apm/RULE.md:32`
「`searchMessages` 无 LIKE 粗筛……keyword 非空走全量拉取 + `messageMatchesKeyword` 内存精筛」），
不当问题报。但**实现形态**有三处未受该决策背书的代价：
① 解压量无上界：段数 × scanLimit = 整个会话，「一条都搜不到」时等于把整会话 assistant 消息
逐条 inflate（Hermes 纯 JS inflate 是数倍放大，模块头 `decoded-content-cache.ts:3-6` 自述占读链 90%+ 成本）；
② 选列是全量列表 `MESSAGE_SELECT_COLUMNS`（`:31`），含 `raw_json`（provider 原始响应，可能几十 KB）
与 `content_blob`，精筛只需要 `id/seq/role/content_*`；
③ 每条被扫到的消息都经 `decodeMessageContent` → `rememberDecodedMessageContent`
（`message-content-codec.ts:92`）**写入进程级 4M 字符 LRU**（`decoded-content-cache.ts:186-199`）。
**后果链**：在大会话里搜一次词 → 数千条消息的解压产物把消息池冲刷干净 → 紧接着的
workplace 前缀组装 / token chip 刷新 / 转录展示全部退回冷态 inflate（模块头承诺的
「顺序扫一遍即全部常驻」命中形态被搜索单次摧毁）。这是「一次只读操作污染全局热缓存」，
比单纯慢更麻烦：它让**别的**读口变慢，症状与病因隔得很远。
**建议**：精筛段改用窄投影（`id, seq, role, content_encoding, content_blob, content_json`），
并给搜索用一条不经 LRU 的解码路径（或直接调 `decodeCompressedBytes`+`decompressZlib` 局部解压），
另加一个「已扫描行数」硬上限（超限时返回已命中部分并在结果里标记截断，避免无界 inflate）。
**置信**：confirmed（列清单、LRU 写入点、无段数/总量上限均为代码事实）；性能量级 suspected（未在真机实测秒数）。

### F-w4-msgstore-pro-4 | P2 | `packages/core/src/service/chat/impl/usage-stats.service.ts:522-531`

```ts
const raw = row.content_blob != null
  ? decodeMessageContent(row.content_encoding, row.content_blob, String(row.id))
  : String(row.content_json);
toolUseCount += countToolUseBlocks(parseMessageContent(raw));
```

**描述**：`getSessionUsageDetail` 在缓存 miss 时**另写了一份双形态读的实现**，与
`sqlite-message.repository.ts:82-94` 的 `readRowContent` 逻辑逐字重复。
RULE 把「读路径双形态、明文行永远合法、新代码严禁假设单一形态」定成硬纪律，而这条纪律现在有两个
可独立漂移的实现点——改一处忘另一处，坏行/新形态的兼容口径就会分叉。
附带代价：该循环逐条走 `decodeMessageContent`（**带 LRU 写入**）把整会话 assistant 行灌进消息池，
与会话正常读路径抢同一个 4M 预算（与 F-3 同一类污染）。
**后果链**：统计弹窗打开一次 → 消息热缓存被整会话 assistant 正文冲掉 → 之后的转录/prompt 组装变慢。
**建议**：把双形态判定抽成一个共享的 `decodeRowContent(row)`（放 `message-content-codec` 或 content 层），
repository 与 usage-stats 都调它；并给「纯统计遍历」一条不写 LRU 的旁路。
**置信**：confirmed（两处代码并存、语义同构）；分叉风险 suspected（当前两边确实一致）。

### F-w4-msgstore-pro-5 | P3 | `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:92-93`

```ts
// legacy 明文行（e2e fixture 直插 / 压缩任务未搬运 / 整体回滚写路径）。
return parseMessageContent(String(row.content_json));
```

**描述**：blob 形态走 `decodeMessageContent`（写 LRU），明文形态直接 parse，**不进缓存**。
两条形态在「同一会话里混存」期间（压缩搬运未完成、e2e fixture、降级期）读放不一致：
blob 行读第二次命中内存，明文行每次都重新 `JSON.parse` + 逐块校验重建对象树。
**后果链**：迁移期（正是性能最需要帮忙的时候）明文行读口不享受任何缓存收益；且
`parseMessageContent` 的开销主要在 `parseBlocksArray` 的逐块重建（见 F-9），不是 inflate，
所以「明文行跳过缓存」的损失比表面看起来大。
**建议**：明文分支也走 `rememberDecodedMessageContent(id, json)`（读时缓存本就是纯派生层，
与 bootstrap 清池的纪律一致）。
**置信**：confirmed（代码事实）；性能影响 suspected。

### F-w4-msgstore-pro-6 | P3 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:426-433`

```ts
const result = await conn.transaction(async (tx) => {
  return await tx.execute(`UPDATE chat_message SET content_blob = ?, ...`, [...]);
});
```

**描述**：单条 UPDATE 包一层显式事务，每批 100 行 → 每轮 100 次 `conn.transaction`
（begin/commit 往返）。op-sqlite / better-sqlite3 的单条 UPDATE 本身即原子（隐式事务），
显式包事务只多了两次往返与一次 mutex 获取。模块头还特意点明「事务内语句一律同步执行……
事件循环让步按 16ms 时间量子」（RULE TDBC 条），说明这个驱动的事务代价比 Node 侧贵。
**后果链**：5350 行库 = 5350 次事务往返，60s 同步预算被往返开销吃掉一部分，
真机「2 分钟才收敛」的成本里这是一块（压缩本身 + 往返 + 批间 setTimeout）。
**建议**：单条 UPDATE 直接 `conn.execute`，只在确有多语句原子性需求时才包 `transaction`
（RULE 里那条「事务回调里误用外层 conn 撞 AsyncMutex 不可重入」的反面也正是「不需要就别包」）。
**置信**：confirmed（代码事实）；收益量级 suspected（未实测往返占比）。

### F-w4-msgstore-pro-7 | P3 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:121-142`

```ts
let startupMaintenanceRan = false;
export async function runStartupMaintenanceOnce(conn) {
  if (startupMaintenanceRan) return null;
  startupMaintenanceRan = true;
  return await createDbMaintenanceService(conn).runDatabaseMaintenance();
}
```

**描述**：手动链路（`runDatabaseMaintenance`，`:62`）**不写** `startupMaintenanceRan`，
「同进程只跑一次」的去重域只覆盖启动期任务。因此同一进程内可以出现两次全库 VACUUM：
用户点「数据清理」（VACUUM #1）→ 随后某个启动期搬运任务收尾（blob 归一 / 消息压缩）完成并调
`runStartupMaintenanceOnce`（VACUUM #2）。
**后果链**：desktop 上每次 VACUUM 同步冻结 main 事件循环（`apps/desktop/src/main/services/db-maintenance.service.ts:97-100`
自述）→ 表现为「点完数据清理之后界面又卡一下」，且用户无从归因。守卫（agent/cloud-sync/db-maintenance busy）
把窗口压得很窄，所以只是 suspected 而非 confirmed。
**建议**：手动链路成功后也置 `startupMaintenanceRan`（用户显式点击「永远真执行」这条纪律不受影响——
它约束的是「手动不被去重吞掉」，不是「手动不能帮去重」）。
**置信**：suspected。

### F-w4-msgstore-pro-8 | P3 | `packages/core/src/service/chat/impl/usage-stats.service.ts:250-273`

```ts
for (let hour = 0; hour < 24; hour++) {
  const startMs = new Date(year, month, day, hour).getTime();
  const row = startMs < endMs ? await this.queryAggregateRow(startMs, endMs, ...) : ZERO_AGG_ROW;
```

**描述**：小时桶是 24 次串行聚合查询，而日桶刚被改成「单条 GROUP BY 替代旧实现的逐日 N+1」
（`:205-207` 注释明说）。同一文件里两种口径并存，且 `getHourlyBuckets` 不做任何 range 过滤复用，
每次调用固定 24 次全表聚合（`RATE_FILTER_SQL` 那个带两个 FILTER 的 SELECT 子句每次都重算）。
**后果链**：点一次小时视图 = 24 次全表扫描（无时间索引可用时更贵：`idx_chat_message_created_at` 存在，
但 `USAGE_NOT_NULL_SQL` + FILTER 仍要逐行过滤），在大库上是秒级卡顿。
**建议**：照日桶的写法改成 `GROUP BY strftime('%H', ...)` 单查询 + JS 侧补齐 24 桶
（`strftime` 的 localtime 与 `new Date(y,m,d,h)` 同用进程本地时区，DST 口径与现有注释一致）。
**顺带**：`:200-203` 注释称「护栏挂在这条查询上（桶数随天数线性膨胀）」，但 `getDailyBuckets` 内
**没有任何桶数上限**，只有「必须提供 range」一条——护栏实际落在调用方（UI）。
**置信**：confirmed（N+1 与缺护栏均为代码事实）；性能量级 suspected。

### F-w4-msgstore-pro-9 | P3 | `packages/core/src/domain/chat/content/parse-message-content.ts:266`

```ts
(value as { blocks: ContentBlock[] }).blocks = parseBlocksArray(value.blocks);
```

**描述**：`assertMessageContent` 是**断言函数却带副作用**——它把调用方传入对象的 `blocks`
替换成重新解析的新数组（丢弃空 text 块，见 `:107-120`）。两个后果：
① `parseMessageContent`（每条消息每次读的必经之路）因此**每次都深拷贝整棵块树**（逐块 `parseBlock`
新建对象），「解压产物已缓存」的收益在 JSON.parse + 重建之后又被摊掉一部分；
② `message.service.append` 里 `assertMessageContent(content)`（`:191`）改的是**调用方持有的对象**
（同一引用随后被存进 `message.content`），调用方若在 append 之后继续用这份 content
（run 事件 payload、tool 步缓存等），拿到的是被就地改过的形状。
**建议**：拆成纯函数 `normalizeBlocks(blocks): ContentBlock[]` + 无副作用的 `assertMessageContent`；
读路径若只需要计数/检索（如 F-3 的精筛、F-4 的 tool_use 计数），可走一条不复建对象的
「只扫描不规范化」通道。
**置信**：confirmed（副作用与深拷贝为代码事实）；调用方是否真的在 append 后复用该对象 suspected。

### F-w4-msgstore-pro-10 | P3 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:624-634`

```ts
if (batchChanges === 0 && newFailures === 0) {
  if (allKnownFailed) {
    // 【正常路径不可达、保留作防御】
    continue;
  }
```

**描述**：这个 `continue` 直接跳过循环尾部的**预算检查**（`:649-651`）与 **批间让步**
（`:652`）。若真出现「整批全是已知坏行」连续多批（本注释自己说不可达），循环会在不检查
`Date.now() >= deadline`、不让出事件循环的情况下继续扫。
**后果链**：60s 同步预算被绕过 → 桌面 main 事件循环长时间不响应；mobile JS 线程同理。
概率极低（正常路径不可达），但这正是「护栏自己有个绕过口」的形状。
**建议**：把 `allKnownFailed` 的处理改成「置位一个标记、落到统一的预算/让步收尾」，
或者至少在 `continue` 前先跑预算检查与让步。
**置信**：confirmed（代码事实）；可达性 suspected（作者判为不可达，我未找到构造路径，倾向确认其判断）。

### F-w4-msgstore-pro-11 | P3 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:405-422` vs `blob-binary-normalization.ts:570-574`

**描述**：blob 归一有 `if (failedKeys.has(primaryKey)) continue;` 跳过本轮已知坏行，
compaction 侧**没有**对应分支——每批都会对本轮已知坏行重新 `encodeMessageContent` 一次。
单轮内 keyset 游标保证不重复命中，所以影响有限；但两个「结构对齐」的骨架在这点上不对齐，
一旦将来 compaction 改成游标重置/回绕（例如加「重扫本轮坏行」的重试策略），
就会退化成每批重编码坏行 + 每次重打一条 `console.warn`（warn 在真机上刷屏）。
**建议**：给 compaction 补同款 `failedKeys` 跳过分支（注意它当前的护栏输入 `newFailures`
语义要跟着调整——已实现，见 `:447` 的 `batchChanges === 0 && newFailures === 0`）。
**置信**：confirmed（分支缺失为事实）；影响 suspected（当前不可触发）。

## 争议与存疑

1. **`nextSeq` 发号竞态（F-2）到底算不算 bug**：本仓 `AGENTS.md`/RULE 的协作红线里那条
   「UNIQUE/约束类报错未必是代码 bug——发号器回退类病灶」把同类现象归为「先查数据现场」，
   说明历史上确实发生过。我给出的证据只能证明**结构上没有原子性**（两次独立 await + 事务外），
   证不出**当前 UI 路径上真的能并发 append**（run 期间发送多半被 UI 禁用；子会话各自独立）。
   留给 W5/W6 从调用方（`agent-runner` 的消息写入 vs 发送入口）实证。
2. **`getSessionUsageDetail` 的 `Promise.all` 三查询并发**（`:452-477`）打在同一条 TDBC 连接上：
   驱动层有 AsyncMutex，三条查询实际是串行的，`Promise.all` 只是形式上的并发。不算问题，但注释
   写「与会话 KKV 缓存读并行」容易被后人当成真并行来推理依赖顺序——实际无。
3. **`modelFilterSql(null)` 的 `NOT IN (SELECT vendor_model_id ...)`**：若子查询含 NULL 会让整个
   谓词恒不为 TRUE、「其他模型」桶静默清零。我查了 DDL——`vendor_model_id TEXT NOT NULL`
   （`bootstrap/provider/provider-schema.ts:24`），**当前安全**。记在这里是因为这是个零护栏的
   静默失效形状，将来若给该列放开 NULL，会直接表现为「其他模型桶莫名其妙是 0」且无任何报错。
4. **`timeRangeSql`（`usage-stats.service.ts:108-113`）在 fromMs/toMs 只有一端非空时整段丢弃时间谓词**：
   目前所有调用方都经 `resolveOptionalRange` 产出「两端都有或都没有」，所以这条分支实际不可达。
   留着无害，但它是「一个 null 静默变成全历史」的形状——将来若有人直传单端范围，
   统计会悄悄变成全历史而不报错。P3 未单列 finding。
5. **两个后台搬运任务是否算死代码**：它们在 `packages/core/src/index.ts:96-101` 导出且被
   desktop/mobile/cli 三端真实调度（`apps/*/src/**/message-content-compaction.service.ts`、
   `blob-binary-normalization.service.ts`），稳态下首轮即零成本返回——**不是死路径**。
   但 RULE「同轮退役的还有后台迁移类任务（2026-09-28 拍板）」已把它们列入「约 10 个 tag 后删除
   迁移任务与旧形态读兼容分支」的清单，且 `blob-binary-normalization` 的 `allKnownFailed` 分支
   连注释都自称「正常路径不可达、保留作防御」——**按 RULE 标 intentional，本轮不立项**，
   只在本报告留档提醒 W5 reduce 时把这两块纳入「迁移退役」条目统一处理。

## 实证过的「看着像问题但其实安全」（供 W5 免重复下钻）

- **整库替换后解压缓存陈旧**（同 id 不同正文）：`bootstrapNovelMaster` 首行无条件
  `clearDecodedContentCaches()`（`novel-master-bootstrap.ts:345`），而备份导入 / 云同步 pull 的
  流程是「close → 覆盖库文件 → 重新 open + bootstrap」（desktop `runtime/connection.ts:41,50`、
  mobile `db-backup.service.ts:124-126,173` 均写明「调用方须在成功后执行 rebootstrap」）。安全。
- **`content_blob` 非空但 `content_encoding` 为 NULL** 的行：所有写口（insert / updateContent /
  compaction / blob 归一）都同时写两列，DDL 的 CHECK 放行 NULL 只是为了 legacy 明文行。安全。
- **「其他模型」桶被 NULL 毒化**：`llm_saved_model.vendor_model_id` 是 NOT NULL。安全。
- **ROLLBACK 后 seq 复用导致读错行**：RULE 明确拍板「回滚物理删尾、删后新消息复用旧 seq」
  （`docs/apm/RULE.md:20`）。intentional。
