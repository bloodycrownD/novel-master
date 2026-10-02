---
zone: w4-msgstore-adv
agent: advocate（辩护人 / 对抗机位）
files_scanned: 32
independence: 未读取 raw/ 下任何文件（本机位为对抗对成员，独立性纪律）
---

# W4 · w4-msgstore-adv — 消息存储链辩护报告

## 摘要

消息正文从「`content_json` 单列明文」演进到「`content_json=''` 哨兵 + `content_encoding`/`content_blob` 压缩两列」之后，存储侧的全部复杂度被压进三个点：`sqlite-message.repository.ts` 的**双形态读 + 编解码收口**、`infra/db-maintenance/` 的**两个谓词驱动后台搬运任务**、以及 `usage-stats.service.ts` 的**逐消息 token 列聚合**。本机位立场：论证这三处的形态是必要且正确的，其中「双形态读」与「谓词驱动搬运」是**有退役计划的临时设施**（spec 生命周期 V0→V1→V1'），不是历史腐化；同时诚实列出 8 条确无辩可辩的让步。

## 职责与边界

| 落点 | 职责 | 不负责 |
|---|---|---|
| `domain/chat/repositories/impl/sqlite-message.repository.ts` | `chat_message` 全部读写；**正文编码的唯一写口**、**解压的唯一读口** | seq 号发号策略语义（属 service）、压缩调度策略（属 db-maintenance） |
| `domain/chat/logic/message-content-codec.ts` | chat 侧 blob 编解码薄封装，压缩/字节收整**复用** vfs `zlib-codec`，不另起实现 | 进程内缓存策略（属 `infra/content-cache`） |
| `infra/db-maintenance/impl/message-content-compaction.ts` | 明文行 → 压缩两列的**谓词驱动**搬运（V0 迁移层） | 收尾维护链路本体（属 `db-maintenance.service`） |
| `infra/db-maintenance/impl/blob-binary-normalization.ts` | 存量 blob 形态归一（`zlib-b64` 文本 → 二进制 BLOB），三表适配器化 | 同上 |
| `infra/db-maintenance/impl/db-maintenance.service.ts` | 缓存 GC → wal_checkpoint → VACUUM 链路 + 进程级去重入口 | 手动「数据清理」的 UI 入口 |
| `service/chat/impl/usage-stats.service.ts` | 双端 token 统计聚合 + 单会话用量弹窗读数 | 命中率口径的产品定义（属 PRD，`RULE.md` 已固化） |

**边界纪律**：本区**没有**任何 schema migration 登记数据搬运（`RULE.md` 空占位禁令）；两个搬运任务都不改 schema，只改数据行形态。

## 对外接口

```
packages/core/src/index.ts（主入口）与 infra/db-maintenance/index.ts：
  createDbMaintenanceService(conn)                -> DbMaintenanceService
  runStartupMaintenanceOnce(conn)                 -> DatabaseMaintenanceResult | null
  runMessageContentCompaction(conn, options?)     -> MessageCompactionRunResult
  getMessageCompactionStatus(conn)                -> MessageCompactionStatus
  runBlobBinaryNormalization(conn, options?)      -> BlobBinaryRunResult
  getBlobBinaryStatus(conn)                       -> BlobBinaryStatus
  MESSAGE_COMPACTION_KKV_MODULE / _KKV_KEY / _MAINTENANCE_PENDING_KKV_KEY

SqliteMessageRepository implements MessageRepository（21 方法）
message-content-codec：encodeMessageContent / decodeMessageContent / EncodedMessageContent
DefaultUsageStatsService implements UsageStatsService（getSummary / getDailyBuckets /
  getHourlyBuckets / getModelBreakdown / listRequestUsage / listModels / getSessionUsageDetail）
```

## 数据访问

| 表 / 域 | 触碰点 | 证据 |
|---|---|---|
| `chat_message`（**21 列全投影**） | `MESSAGE_SELECT_COLUMNS` 单一常量，7 条读路径共用 | `sqlite-message.repository.ts:31` |
| `chat_message` INSERT | `MESSAGE_INSERT_SQL` + `toMessageParams` 单一参数序（`?` 位置绑定，非模板） | 同上 `:38-41`、`:53-79`、`:394` |
| `chat_message.content_json` | **恒置 `''`**（新写路径唯一取值）；读路径仅 legacy 分支触碰 | `:60`、`:93` |
| `chat_message.content_encoding/content_blob` | 唯一写口 `toMessageParams` / `updateContent`；读口 `readRowContent` | `:61-62`、`:379`、`:83-91` |
| `chat_message` seq 区间 | `deleteAfterSeq` / `listIdsAfterSeq` / `updateHiddenRange` / `searchMessages` 的 `fromSeq`/`toSeq`（闭区间、含 hidden） | `:448-500`、`:516-590`；口径见 `RULE.md` seq 条 |
| `kkv_entry`（module `nm-message-content`） | key `compactionDone` / `startupMaintenancePending` | `message-content-compaction.ts:56-68` |
| `kkv_entry`（module `nm-blob-binary`） | key `vfsContentDone` / `fileCacheDone` / `messageContentDone` / `startupMaintenancePending` | `blob-binary-normalization.ts:60-72`、`:150-199` |
| `session_kkv_entry`（域 `usage_stats`） | key `toolUseCount`，**哨兵空串失效**而非 delete | `usage-stats.service.ts:472-476`、`:553-560`；写侧 `message.service.ts:111-118` |
| `llm_saved_model` | 模型筛选子查询（非 `chat_message` distinct） | `usage-stats.service.ts:83`、`:429-436` |
| `vfs_content_blob` / `session_file_cache_blob` | 仅被归一任务当数据源触碰 | `blob-binary-normalization.ts:150-182` |

**不触碰**：本区无一条 SQL 写 `vfs_*` 业务表（blob 两表只出现在归一任务的数据搬运里）。

## 依赖关系

**import 了谁**

```
sqlite-message.repository → tdbc/connection.port, sql-template/index, tdbc/logic/template-helper
                          → chat/content/parse-message-content, chat/content/message-content-match
                          → chat/model/message-attachment.schema, chat/model/message
                          → chat/logic/message-content-codec → vfs/content-store/logic/zlib-codec（复用）
                                                       → infra/content-cache/logic/decoded-content-cache
                                                       → errors/chat-errors
message-content-compaction → tdbc/connection.port, kkv/repositories/sqlite-kkv.repository,
                             chat/logic/message-content-codec, ./db-maintenance.service
blob-binary-normalization  → tdbc/connection.port, kkv/repositories/sqlite-kkv.repository,
                             vfs/content-store/logic/{blob-bytes-codec, zlib-codec}, ./db-maintenance.service
usage-stats.service        → chat/content/parse-message-content, chat/logic/message-content-codec,
                             chat/logic/tool-use-count, session-kkv/create-session-kkv-service
```

**被谁消费**

- `MessageRepository`：`service/chat/impl/message.service.ts`（append / rollback / fork / copy 全链）
- `runMessageContentCompaction`：`apps/cli/src/runtime.ts:187`、`apps/desktop/src/main/services/message-content-compaction.service.ts:80`、`apps/mobile/src/services/message-content-compaction.service.ts:54`
- `searchMessages`：`apps/desktop/src/main/ipc/handlers/messages.ts`、`apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx`
- `getSessionUsageDetail`：`apps/desktop/src/main/ipc/handlers/usage-stats.ts`、`apps/mobile/src/components/sheet/MetricDetailSheet.tsx`

**环路**：core 内 `db-maintenance.service.ts` → `blob-binary-normalization` → `db-maintenance.service` 构成**单向** import（前者不 import 后者）；`db-maintenance.service.ts:81-92` 显式说明它为何用**字面量**而非常量引用清 pending 标记 —— 反向引用会成环。这个「宁可写字面量也不引常量」的取舍有注释留痕，是**有意识的破环**，不是疏漏。

---

## 发现清单

> 辩护项标 `intentional` 并引出处；让步项标 `confirmed` / `suspected`，**不粉饰**。

### 一、辩护理由清单（我方主张「合理且必要」的部分）

---

**F-w4-msgstore-adv-1 | P3 | `sqlite-message.repository.ts:81-94`**

```ts
/** 双形态读：content_blob 非空走解压，否则 parse content_json 明文。 */
function readRowContent(row: Row): MessageContent {
  if (row.content_blob != null) { ... return parseMessageContent(decodeMessageContent(...)); }
  // legacy 明文行（e2e fixture 直插 / 压缩任务未搬运 / 整体回滚写路径）。
  return parseMessageContent(String(row.content_json));
```

**描述**：读路径双形态。
**辩护**：① 它是**迁移期必需**而非历史腐化——`content_json TEXT NOT NULL`（`chat-schema.ts:33`）没有可空形态，明文行在三种合法来源下必然共存：e2e fixture 直插、搬运任务未跑完、写路径回滚。若改成单形态（只走解压），迁移窗口内用户的**整段聊天历史直接读不出来**——为了一个几周后会删的分支去冒这个险，是本末倒置。② 判据用 `content_blob != null` 而非 `content_encoding != NULL`，是因为哨兵写在 `content_json` 上（`:60`），判据必须跟着**承载语义的列**走。③ 它有**确定退役日期**：`docs/Iterations/message-content-compression/spec.md:59` 阶段 V1 明确「删除……明文读路径（`rowToMessage` 只走解压）、双形态分支与相关测试」，且 `RULE.md` 的迁移清理条目把这条列进了「约 10 个 tag 后与 migration 清理同轮」的统一节奏。**⇒ 有出口的临时设施，不该按遗留分支记账。**
**置信**：intentional（spec.md:50-64 生命周期节 + `RULE.md` 消息正文压缩列条目）

---

**F-w4-msgstore-adv-2 | P3 | `sqlite-message.repository.ts:53-79, 371-388`**

```ts
function toMessageParams(message: ChatMessage): unknown[] {
  const encoded = encodeMessageContent(JSON.stringify(message.content));
  return [ message.id, ..., "", encoded.encoding, encoded.blob, ... ];
```

**描述**：编码收口在 repository。
**辩护**：① `JSON.stringify` 与压缩编码**同一函数、同一位置**发生，物理上不可能出现「某条写口忘了压缩」的分叉——这正是 `RULE.md`「消除 service 层序列化的不一致编码点」要的效果。② 我**实测扫过全仓生产代码里所有触碰 `content_json`/`content_blob`/`content_encoding` 的 SQL**：生产侧写点只有 `toMessageParams`、`updateContent` 与两个后台任务；**两个后台任务也都走 `encodeMessageContent`**（`message-content-compaction.ts:408`）或 `base64ToBytes`（`blob-binary-normalization.ts:583`），没有第三处自造编码。③ `updateContent` 入参是 `MessageContent` 对象而非字符串（`message.port.ts:79-85`），把「调用方自己 stringify」的入口从类型层面关掉了。
**置信**：intentional（`message.port.ts:79-85` 的契约注释 + 实测 grep 全仓）

---

**F-w4-msgstore-adv-3 | P3 | `message-content-compaction.ts:1-47, 349-355`**

```
* - 完成判定两态：进行中（剩余 N 条，谓词 COUNT）/ 已完成（谓词空 →
*   置 KKV 完成标记 → 经 runStartupMaintenanceOnce … 触发一次维护链路
```

**描述**：数据搬运走**谓词驱动后台任务**而非 schema migration。
**辩护**：① `schema_migrations` 只有 `(id, applied_at_ms)` 两列、bootstrap 是**单事务同步**（`RULE.md` 迁移纪律条目），「按行改写存量数据」在这个框架里**物理上无法表达进度、无法跨 boot 重入**。② `RULE.md` 的硬规则原文：「凡『按行改写存量数据』的需求都不可注册 migration（空占位禁令 + 不可跨 boot 重入），落点固定为 `infra/db-maintenance/impl/` 下的任务（骨架：谓词 SQL → 批 ≤100 → 单行短事务（谓词进 WHERE 保并发幂等）→ 批间让步 + 单轮同步预算 → KKV 完成标记 → 挂一次维护链路）」——本任务**逐条对得上**，包括 `UPDATE … WHERE id = ? AND content_json != ''` 这个「谓词进 WHERE 保并发幂等」的细节（`:428-431`）。③ 幂等可重入是**数据层保证**的：每行独立短事务，进程被杀后重启按谓词重扫即可，已搬行天然排除。④ 不注册 migration 这件事在 spec 里有明确「两次历史评审拒绝突破」的记录（`spec.md:38`）。
**置信**：intentional（`RULE.md` 迁移纪律条目 + spec.md:38,50-64）

---

**F-w4-msgstore-adv-4 | P3 | `message-content-compaction.ts:376-396, 442-445, 472-485`**

```ts
  const leftover = await countPendingRows(conn);
  if (leftover > failedKeys.size) { … return { done:false, …, stalled:true }; }
```

**描述**：keyset 游标 + 收尾谓词校验的「不变量」写法。
**辩护**：① 游标**只用于本轮加速、不承担完成判定**（注释 `:376-378` 逐字写明），完成判定永远回到谓词 COUNT——这消除了「游标推进漏行 → 误报完成 → 数据永远不搬」这一整类故障。② 「leftover ⊆ failedKeys」被写成**带禁止条款的不变量**：收尾校验前**不得引入任何提前 break**（`:472-478`；归一侧同款更长的版本 `blob-binary-normalization.ts:655-668` 还点名了旧版 `allKnownFailed → break` 的具体病灶）。这不是「刚好写对了」，是把「改循环结构必须同步核对本段」写进了注释——属于**用注释锁住不变量的正确姿势**。③ 零进展护栏**不要求满批**（`ZERO_PROGRESS_BATCH_LIMIT` 的 `@remarks` 逐字解释了为什么旧口径的 `rows.length === BATCH_SIZE` 会让「卡住行数 < 100」永远不触发），阈值取 3 而非 1 也给了取舍理由。
**置信**：intentional（两文件同款不变量注释 + blob 侧 `:655-668`）

---

**F-w4-msgstore-adv-5 | P3 | `sqlite-message.repository.ts:60` + `message-content-compaction.ts:391-396, 442-445`**

```ts
      "SELECT rowid, id, content_json FROM chat_message
       WHERE content_json != '' AND rowid > ? ORDER BY rowid LIMIT 100",
```

**描述**：对「rowid 会被 SQLite 复用 → 游标漏行」这一常见质疑的正面回应。
**辩护**：这个质疑在别的表上成立，**在 `chat_message` 上不成立**——搬运谓词是 `content_json != ''`，而**所有新写入路径都把 `content_json` 恒置 `''`**（`sqlite-message.repository.ts:60`，`updateContent` 同款 `:379`）。也就是说谓词只会命中「V0 上线前就存在的明文行」，而这些行的 rowid 是**冻结的历史值**，新行的增删（回滚物理删尾会释放 rowid，但删掉的也是已压缩行）无法制造出「rowid 小于当前游标、且仍在谓词里」的新行。故游标推进不存在漏扫。并发端搬走的行由「谓词进 WHERE → changes=0 → 计入零进展但不置标记」+「下次启动谓词重扫」双重兜底。
**置信**：intentional（`:60` 恒置 `''` 与 `:391-396` 谓词联合推得）

---

**F-w4-msgstore-adv-6 | P3 | `decoded-content-cache.ts:30-36, 241-249` + `sqlite-message.repository.ts:371-395`**

```ts
  const encoded = encodeMessageContent(JSON.stringify(content));
  … UPDATE chat_message SET content_json='', … 
  // 本处是「同 id 换正文」的唯一写口，写入后必须失效
  forgetDecodedMessageContent(id);
```

**描述**：进程内解压缓存按 message id 做键的**安全性论证**。
**辩护**：① 键是主键 `id`，全仓 `randomUUID()` 生成、**从不复用**（append/fork/copy 均新 id），所以「同键不同值」只可能由一处产生——`updateContent`，而它**强制调用** `forgetDecodedMessageContent`。`insert`/`batchInsert` 还各做了一次**防御性**失效（`:393`、`:415`，注释「id 理论不复用」），把「测试夹具/未来导入拿固定 id 重插」这条路也堵死。② 后台两个搬运任务**只换字节形态、正文不变**，因此**无需失效**——`decoded-content-cache.ts:34-36` 明写这条。若让它们失效，就等于把 60s 预算的任务变成一次全池抖动。③ 池按**进程**共享的致命前提（换库/换连接会串池）在**代码层是真被覆盖的**：`bootstrapNovelMaster` 入口调 `clearDecodedContentCaches()`（`novel-master-bootstrap.ts:345`），而三个端的**每一个**开连接路径都经过它——desktop `runtime/connection.ts:41`、mobile `db/connection.ts:80`、cli `runtime.ts:183`。desktop 的 rebootstrap（备份导入 / 云同步 pull）走的正是 `rebootstrapDesktopRuntime → resetDesktopRuntimeForTest → closeDesktopConnection` 再重新 `getDesktopRuntime`（`desktop-runtime-singleton.ts:35-53`），因此**换库后池必然被清**。
**置信**：intentional（三处 open 路径实测 + `decoded-content-cache.ts:34-43` 契约）

---

**F-w4-msgstore-adv-7 | P3 | `sqlite-message.repository.ts:506-543, 583-590`**

```ts
    // 正文压缩存储后 content_json 恒为空串，SQL LIKE 粗筛失效——改为
    // 拉取 + 内存精筛 … 新实现按 TextBlock 精确匹配，召回语义严格不小于现状
    const scanLimit = Math.max(clampedLimit * 20, 200);
```

**描述**：`searchMessages` 去掉 SQL LIKE 粗筛是否算「搜索能力退化」。
**辩护**：① **不是选择，是压缩存储的直接后果**——`content_json` 恒为 `''`，`LIKE '%kw%'` 恒不命中；保留 LIKE 只会得到一个静默返回空集的假搜索，比删掉更危险。② 替代方案在**召回上严格更好**：`messageMatchesKeyword` 遍历全部 `text` 块（`message-content-match.ts:40-47`），而旧 LIKE 粗筛叠在 role 粗筛上时，thinking/tool_result 块含关键词的场景会被误杀；注释里点出了这一点。③ 最坏成本被 keyset 续扫**分段封顶**（`scanLimit = max(limit*20, 200)`），且续扫的两个出口都是「凑满 limit」或「本段返回行数 < scanLimit（SQLite LIMIT 语义保证已无剩余）」——`seq` 在会话内 UNIQUE（`chat-schema.ts:56`），游标严格递减、**结构上不可能死循环**。④ 语义红线写在注释里：召回不得小于全量精筛，`:541-542`。
**置信**：intentional（`chat-schema.ts:33,56` + `message-content-match.ts:32-49` + `RULE.md` seq 条）

---

**F-w4-msgstore-adv-8 | P3 | `usage-stats.service.ts:34-44, 40-44`**

```ts
const BILLED_INPUT_SUM_SQL =
  `SUM(CASE WHEN provider = 'anthropic' THEN prompt_tokens + COALESCE(cache_read_tokens,0) + COALESCE(cache_creation_tokens,0)
            ELSE prompt_tokens END)
   FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL)`;
```

**描述**：命中率分母「anthropic 行加回 cache」+「FILTER 只对有 cache 列的行求和」是否属于隐性口径黑箱。
**辩护**：① 这是**计费口径本身**，不是实现取巧——anthropic 的 `input_tokens` 按 API 定义就不含 cache，与其余协议的 `prompt_tokens` 直接相加会让 anthropic 的命中率**系统性地偏低**。② `FILTER` 只纳入有 cache 记录的行，是 PRD 拍板口径（注释 `:38` 直写「PRD 口径，避免拉低命中率」），且 `RULE.md` 用量统计层条目已把它固化为项目术语。③ 表达式提为具名常量并在 summary / 桶查询 / 模型分解三处**逐字复用**（`:64`、`:212`、`:282`），杜绝了「三处各写一遍、改一处忘两处」的口径漂移。
**置信**：intentional（`RULE.md` 用量统计层条目 + `:38` PRD 引用）

---

**F-w4-msgstore-adv-9 | P3 | `usage-stats.service.ts:76-87, 426-437`**

```ts
  if (model === null) return "AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))";
```

**描述**：模型筛选取 `llm_saved_model` 子查询而非 `chat_message` 的 distinct。
**辩护**：① 口径本身**有拍板记录**：`RULE.md` 明确「**不**按存储 distinct（历史 model_name 两个月就换代一批，且可能含 `[3]` 中转站前缀，清洗未拍板）」，并规定「『其他模型』桶 = `model_name IS NULL OR NOT IN (配置集)`」——代码与规则**逐字一致**。② 我**实测复核**了这条 `NOT IN` 的经典 NULL 陷阱：`llm_saved_model.vendor_model_id TEXT NOT NULL`（`provider-schema.ts:24`），子查询**不可能产出 NULL**，因此 `NOT IN` 不会整体退化成三值逻辑的 UNKNOWN、不会把整个「其他模型」桶吞掉。③ `listModels()` 与筛选子查询**同源同查询**，所以「已保存模型集合」在两处不会漂移。
**置信**：intentional（`RULE.md` 明文拍板 + `provider-schema.ts:24` 实测 NOT NULL）

---

**F-w4-msgstore-adv-10 | P3 | `db-maintenance.service.ts:44-53, 70-77`**

```ts
   * - `runDatabaseMaintenance` 顺序执行「缓存 GC → 防御性 checkpoint → VACUUM」。VACUUM **必须事务外直调 conn**
```

**描述**：维护链路的收敛位置与「不得包 transaction」的纪律。
**辩护**：① 这是 SQLite 的硬约束（原生拒绝事务内 VACUUM），写成函数头注释等于把「误用面」显式封死；`RULE.md` 实现禁令条目把它升格为项目纪律：「VACUUM 与维护类 SQL 直调 conn.execute、不包 transaction……且事务回调里误用外层 conn 调服务会撞驱动层 AsyncMutex 不可重入（死锁而非报错）——须把回调传入的 tx 喂给服务。维护链路（GC → checkpoint → VACUUM）收敛在 `infra/db-maintenance/`」。② `runDeferredFileCacheGc` 在**同一链路内**先行，使 `reclaimedBytes` 把 GC 释放的页也计入（`:63-66` 有解释），口径写在 port 上（`db-maintenance.port.ts:28-34`）。
**置信**：intentional（`RULE.md` 实现禁令条目 + `db-maintenance.port.ts:28-34`）

---

**F-w4-msgstore-adv-11 | P3 | `db-maintenance.service.ts:113-142`**

```ts
let startupMaintenanceRan = false;
export async function runStartupMaintenanceOnce(conn) {
  if (startupMaintenanceRan) return null;
  startupMaintenanceRan = true;
  return await createDbMaintenanceService(conn).runDatabaseMaintenance();
}
```

**描述**：进程级单例标志会不会让 VACUUM 被吞掉。
**辩护**：① 手动「数据清理」**刻意不受该标志约束**——`:116-120` 逐字写明「用户显式点击必须永远真执行」，且走的是 `runDatabaseMaintenance` 而非 `runStartupMaintenanceOnce`；这是**有意的两入口分离**，不是漏挂。② 标志在执行**前置**（`:140`），避免并发调用叠加出多次 VACUUM；VACUUM 失败**不回滚**标志（`:129-130` 有理由：数据已落好，页由手动清理或下次启动归还）。③ 失败兜底另有持久化标记 `startupMaintenancePending`（两个任务各持独立 key，`message-content-compaction.ts:63-66` 解释「不共享单 key，避免互相牵连」），手动清理成功后由 `db-maintenance.service.ts:88-92` 顺带清除。**四层兜底，闭环。**
**置信**：intentional（`:113-142` + 两任务 `startupMaintenancePending` 注释）

---

**F-w4-msgstore-adv-12 | P3 | `sqlite-message.repository.ts:164-190, 397-423` + `create-chat-services.ts:48-71`**

```ts
   * core 只声明函数类型，由装配方注入具体实现（mobile 传 createQuantumYield(16)），不反向依赖 RN 模块。
```

**描述**：分片让步（`ROW_PARSE_CHUNK=50` / `BATCH_BUILD_CHUNK=200`）是否属于「在 domain 层塞宿主知识」。
**辩护**：core **只声明 `() => Promise<void>` 类型**，让步粒度（16ms 量子）与宿主实现**全在 app 装配层**（`apps/mobile/src/runtime/create-mobile-runtime.ts:110-112` 造一次、`:172` 注入）；desktop/cli/测试**缺省不传**，行为与压缩前逐字节等价（`:183-186`）。这是依赖倒置的正确用法，不是 domain 反向依赖 RN。③ `mapRows` 里那条「须以类名引用 static 成员，否则 `start += undefined` 变 NaN 而静默返回空数组」的注释（`:197-201`）说明这个分片路径**真被测试打中过**，不是纸面代码。
**置信**：intentional（装配层实测 + `:197-201` 事故注记）

---

### 二、让步清单（确无辩可弹的部分）

> 以下每条我都**没有找到能推翻它的证据**，按「宁可多辩不可漏辩」的标准全部列出。

---

**F-w4-msgstore-adv-13 | P2 | `message.service.ts:193, 210` + `sqlite-message.repository.ts:360-369` + `chat-schema.ts:56`**

```ts
    const seq = await this.deps.messages.nextSeq(sessionId);   // message.service.ts:193
    …
    await this.deps.messages.insert(message);                   // message.service.ts:210
```
```sql
  SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}   // repo:364
```
```sql
    UNIQUE (session_id, seq)                                    // chat-schema.ts:56
```

**描述**：`nextSeq`（`MAX(seq)+1`）与 `insert` 是**两条独立语句、中间无事务、无会话级串行化**。同一会话并发追加两条消息时会读到同一个 `MAX(seq)`，第二次 `insert` 撞 `UNIQUE (session_id, seq)` 抛约束错误。
**我尽力辩过但失败的三条**：
1. 「驱动层 AsyncMutex 会串行化」——**实测证伪**：`packages/tdbc-driver-better-sqlite3/src/mutex.ts:16-23` 的 `AsyncMutex.run` 是**单语句**排队，`connection.ts:29,36,43` 分别给 `execute/query/batch` 各包一次 `mutex.run`。两次 `await` = 两次独立入队，**成对语句之间仍可交错**。
2. 「上层有会话锁」——**实测证伪**：`nextSeq` 全仓唯一调用点就是 `message.service.ts:193`，其上下文（`:187-210`）只有 `findById` / `assertMessageContent` / `normalizeAppendAttachments`，无任何锁。
3. 「app 层守卫能防」——不可辩：`isAgentActive` 是**只读状态查询**（desktop/mobile compaction service 的 `shouldPause` 用法即证明），不是互斥原语。
**我能给出的最强辩护（不构成免责）**：UNIQUE 约束把故障形态从「静默覆盖/串号」变成**响亮失败**，`id` 是 UUID 故不存在错行覆写；即最坏是用户可见的一次发送失败，不污染既有数据。
**建议**：`append` 把 `nextSeq` + `insert` 包进同一个 `conn.transaction`（该 service 已在 `delete` 里用 `this.deps.conn.transaction` 建 repository 的同款手法，`:236-238`），或在 `insert` 撞 UNIQUE 时重试一次。
**置信**：confirmed（读口、发号口、驱动锁实现、DDL 约束四处均已实读）

---

**F-w4-msgstore-adv-14 | P2 | `usage-stats.service.ts:512-539`**

```ts
    const assistantRows = await queryTemplate<Row>(…
      `SELECT id, content_json, content_encoding, content_blob
       FROM chat_message WHERE session_id = #{sessionId} AND role = 'assistant'`, { sessionId });
    …
        const raw = row.content_blob != null ? decodeMessageContent(...) : String(row.content_json);
        toolUseCount += countToolUseBlocks(parseMessageContent(raw));
      } catch (error) { console.warn(`[usage-stats] 工具调用现算遇坏行（按 0 计）：…`); }
```

**描述**：**双形态分支与解码逻辑在 repository 之外被复制了一份**。这直接削弱了我方「编解码收口 repository」的主张（F-2）——收口是「基本收口」而非「完全收口」。且失败语义**反向**：repository 路径 fail-fast 抛类型化错误，这里 `catch` 吞成 `toolUseCount += 0`。
**我能辩的部分**：① 「只投影 content 三列、不走 `rowToMessage`」是**实打实的性能取舍**——走 repository 会连带构造完整 `ChatMessage`（含 `JSON.parse(raw_json)`、`attachments` 解析），而这里只需要 blocks；`:509-511` 有说明。② **失败语义差异本身可辩**（且已写进注释 `:510-511`）：repository 路径面对的是**用户数据本体**（错一条 = 聊天记录整条读不出来），这里面对的是**统计读数**（错一条 = 工具计数少 1）。两种数据类别用两种失败策略是合理的。
**不可辩的部分**：**分支复制**。同一判据 `content_blob != null` 在两个文件里各写一遍，将来任何一处改判据都会造成静默分叉——这正是「收口」要消灭的东西。
**建议**：把「blob 非空走 codec、否则 parse 明文」抽成 `message-content-codec` 导出的 `decodeMessageContentJson({encoding, blob}, id, plainText)` 单函数，两处共用；失败语义差异用调用方 try/catch 表达，而不是靠复制分支。
**置信**：confirmed

---

**F-w4-msgstore-adv-15 | P3 | `usage-stats.service.ts:199-248, 577-594`**

```ts
    for (let cursor = new Date(from.year, from.month, from.day); ; cursor = addLocalDays(cursor, 1)) {
      buckets.push(this.toBucket(cursor.getTime(), rowByDay.get(dayKey) ?? ZERO_AGG_ROW));
      if (dayKey === filter.range.toDay) { return buckets; }
    }
```
```ts
    if (fromStart.getTime() > toStart.getTime()) { throw chatInvalidArgument(…); }   // :585-588
```

**描述**：日桶序列**没有跨度上界**。`resolveDayRangeMs` 只校验「from 不得晚于 to」，不限制两者相距多远。`fromDay=0001-01-01` / `toDay=9999-12-31` 会让循环产出约 **365 万个桶**（每次一个 `UsageStatsBucket` 对象），且同一条单条 `GROUP BY day_key` 要扫同跨度数据。桌面端该方法经 renderer IPC 可达。
**我尽力辩过但失败**：`getDailyBuckets` 确实为「range 可选」这一形状加了护栏（`:200-203`：range 缺省即抛，因为桶数随天数线性膨胀）——但这条护栏只挡住了「无界」，**没挡住「跨度巨大」**，逻辑上是个半截子。
**建议**：`resolveDayRangeMs` 加一个最大跨度常量（如 3660 天 / 10 年）并抛 `chatInvalidArgument`，或按跨度自动降采样。
**置信**：confirmed

---

**F-w4-msgstore-adv-16 | P3 | `usage-stats.service.ts:250-273` vs `:199-248`**

```ts
    for (let hour = 0; hour < 24; hour++) {
      const row = startMs < endMs ? await this.queryAggregateRow(startMs, endMs, …) : ZERO_AGG_ROW;
```

**描述**：小时桶是 **24 次串行聚合查询**（N+1），而日桶**已经**被改造成单条 `GROUP BY`（`:205-220` 注释明写「单条 GROUP BY 查询替代旧实现的逐日 N+1」）。同一文件内两条路径的优化水位不一致。
**我能辩的部分（所以只记 P3）**：① 有 `idx_chat_message_created_at ON chat_message(created_at_ms)`（`chat-schema.ts:58-59`），每次查询是**有界范围扫描**而非全表扫；② 24 是硬上界、单次交互触发，不是无界 N+1；③ `startMs >= endMs` 的 DST 空钟点直接复用零值行、不发查询，是有意的正确性处理而非遗漏（`:256-269`）。
**不可辩的部分**：日桶那条 N+1 已经证明「单条 GROUP BY + JS 侧补空桶」在本文件里是**已验证可行**的写法（`:227-247` 就是它），小时桶没跟着做，属于**改造未完成**而非**另有理由**。
**建议**：小时桶照抄日桶的单条 `GROUP BY hour_key` + 24 桶稠密补齐形态。
**置信**：confirmed

---

**F-w4-msgstore-adv-17 | P3 | `message-content-compaction.ts:161, 391, 409-421, 479-485`**

```ts
async function countPendingRows(conn) {
  … "SELECT COUNT(*) AS n FROM chat_message WHERE content_json != ''"
```

**描述**：**一行 `content_json = ''` 且 `content_blob IS NULL` 的行会让任务永不收敛**。该行命中谓词 → 取出 → `encodeMessageContent('')` 产出合法压缩字节 → UPDATE 把它改成 `content_blob` 非空（自愈）；因此真正的漏洞窗口极窄。但注意另一条：若该行因其它原因被 UPDATE 拒绝（谓词外的约束/驱动异常），它**不进 `failedKeys`**（`failedKeys` 只由编码抛错填充，`:409-421`），收尾校验 `leftover > failedKeys.size` 恒成立 → 每轮返回 `stalled: true`、**永不置完成标记**，于是**每次冷启动都要完整跑一遍全表游标扫描**（5350 行量级库即 module 头 `:14-16` 说的 GB 级累计读）后才停手。
**我能辩的部分**：当前**不存在**能造出这种行的写路径——`toMessageParams:60` 与 `updateContent:379` 都恒置 `content_blob`；e2e fixture 直插的也是明文真值。所以现状不可达，这是**鲁棒性缺口**而非活 bug，故记 P3 而非 P2。
**不可辩的部分**：「零进展 + 收尾残留 → 本进程停手、下次冷启动重来」这条策略在**残留是永久性的**（该行永远不会被搬走）时会退化成无界重扫。护栏只挡住了「原地打转」，没挡住「永久残留」。
**建议**：在 `runMessageContentCompaction` 入口或收尾处，对 `leftover` 中 `content_blob IS NULL AND content_json = ''` 的行单独计数并置标记（或跳过），让「结构性不可能被搬走的行」不参与重扫循环。
**置信**：confirmed（分支逻辑实读；触发路径经 `repo:60` 证否可达）

---

**F-w4-msgstore-adv-18 | P3 | `message-content-compaction.ts:38-44`**

```
 * 已知限制（风险登记）：压缩任务恒写 `content_encoding='zlib'` + 二进制 BLOB；若某端驱动有缺陷
 * 把二进制绑成 TEXT 存回 … 而 blob 归一的 `messageContentDone` 标记已置（该表已完成短路），
 * 这批新脏行不会被归一任务自动重扫——兜底手段：手动清 `messageContentDone`（KKV module `nm-blob-binary`）触发重扫。
```

**描述**：**两个互相独立的任务，通过「各自置各自标记」形成单向时序耦合**——压缩任务（V0，退役较晚）会向归一任务（同样 V0，退役同轮）**持续产出新行**，而归一任务完成标记一旦置位就永久短路。对「驱动把 Uint8Array 绑成 TEXT」这一失效模式，压缩任务产出的脏行将**永久滞留**，兜底是**人工清 KKV 标记**。
**我能辩的部分**：① 这是**作者自己已经写进模块头的风险登记**，不是被漏掉的盲区——作为「已登记的已知限制」，它不该按「发现」重复计一次账；② 触发前提是驱动级缺陷，而 op-sqlite 的 BLOB 绑参已真机验证（`message-content-codec.ts:6-9` 逐字记录）；③ 读路径对这类脏行仍**可读**（`decodeCompressedBytes` 的三形态兼容，`zlib-codec.ts:94-125`），故最坏是「行没归一」而非「数据读不出来」——这比数据损坏轻得多。
**不可辩的部分**：兜底手段要求**用户手工操作 KKV**。对 C 端产品而言，「修一个库状态需要进 SQLite 改标记」不是可接受的运维面；即使只是低概率，也不该让「低概率」的代价落在用户手上。
**建议**：压缩任务在置完成标记前，若本轮曾成功改写行，顺带把 `nm-blob-binary` 的 `messageContentDone` 清掉（幂等、无行可归一时归一任务只跑一次零成本 COUNT 即重新短路）；或在归一侧把「完成」判据从「标记已置」升级为「标记已置 **且** 谓词连续 N 轮为空」。
**置信**：confirmed（风险为作者自陈；耦合关系由两个标记常量 + 两个 `readDoneMarker` 短路路径推出）

---

**F-w4-msgstore-adv-19 | P3 | `sqlite-message.repository.ts:43-47` vs `:394`**

```ts
/**
 * 把 ChatMessage 摊平成与 {@link MESSAGE_INSERT_SQL} 列顺序对齐的参数数组。
 *
 * insert 走 executeTemplate 时由 SqlTemplateParser 按 `#{xxx}` 出现顺序收集参数，
 * 这里手写数组必须保持同一顺序——两边的列/`?`/参数三者完全对齐。
 */
```

**描述**：**注释描述的调用路径不存在**。`insert` 实际是 `await this.conn.execute(MESSAGE_INSERT_SQL, toMessageParams(message))`（`:394`）——**位置参数 `?` 直绑**，既不走 `executeTemplate` 也不经 `SqlTemplateParser`。注释里那套「按 `#{xxx}` 出现顺序收集」的理由对 `insert` 不成立。
**我能辩的部分**：注释要传达的**真正不变量**（`MESSAGE_INSERT_SQL` 列顺序 ≡ `toMessageParams` 数组顺序 ≡ 21 个 `?`）是真实且重要的，`batchInsert` 共用同一条 SQL 也确实要求这个对齐——所以问题只是**理由陈述过时**，不是约束失效。
**不可辩的部分**：这条注释会把后续维护者引向错误的推理（以为 `insert` 受 `SqlTemplateParser` 保护，从而放松对齐检查）。属于**误导性不变量描述**。
**建议**：把「insert 走 executeTemplate 时…」改为「`insert`/`batchInsert` 均以位置参数直绑 `conn.execute`/`conn.batch`，参数序必须与 `MESSAGE_INSERT_SQL` 的列序逐位对齐（21 列 ↔ 21 个 `?`）」。
**置信**：confirmed

---

**F-w4-msgstore-adv-20 | P3 | `decoded-content-cache.ts:38-43`**

```ts
 * ## 池的作用域是进程，不是连接/库
 * … 同进程若出现第二个连接或换库，两池会继续拿旧库的内容作答（消息池按 id 取，串池最明显），
 * 必须走 bootstrapNovelMaster 清池——它已在入口调用 clearDecodedContentCaches。
```

**描述**：这是一条**靠约定维持、没有代码强制**的不变量。
**我能辩的部分（所以只记 P3）**：我**实测枚举了全仓 `bootstrapNovelMaster` 的调用点**——`apps/cli/src/runtime.ts:183`、`apps/desktop/src/main/runtime/connection.ts:41`、`apps/mobile/src/db/connection.ts:80`（另有两处测试 helper）。而这三个 `open` 点是**全仓仅有的连接创建入口**，因此「每条开连接路径都清池」在**当前代码里事实上成立**，desktop 的 rebootstrap 也因此被覆盖。
**不可辩的部分**：契约的强度取决于「未来是否有人绕过 bootstrap 直接 `open`」。这是一个**没有断言、没有 lint、没有 fail-fast** 的约定——一旦被绕过，后果是**静默返回旧库正文**（无任何错误信号），是最难查的一类。
**建议**：把 `clearDecodedContentCaches()` 下沉到 `infra/tdbc` 的 `open()` 包装层（而不是 bootstrap），让契约由结构而非纪律保证。
**置信**：confirmed（调用点已全量枚举；风险为前瞻性）

---

## 争议与存疑

1. **F-13（seq 发号竞态）到底是不是 P2，我拿不准，需要独立机位实测裁决。** 我的判断依据是「两条独立语句 + 驱动锁是单语句粒度 + 唯一调用点无锁」，三条都实读过；但**我没有构造出真实并发复现**（desktop CLI 是同步 SQLite、单进程内两条 `await` 交错的窗口确实存在，但触发需要用户恰好在同会话并发追加）。若另一机位认为实际不可达或已被上层串行化覆盖，请以实测为准。**我不撤回这条，也不再往上抬级。**

2. **F-14（双形态分支在 usage-stats 复制）到底是「重复实现」还是「有意的第二条读口」——我给出的答案是「性能取舍可辩、分支复制不可辩」。** 如果 reduce 阶段认为仓库里应当存在「轻量读口」这一层抽象（不止 usage-stats 一处需要），那么正确的修法就不是把分支抽回 codec，而是把轻量读口本身收进 repository。我倾向后者，但没有代码证据支持「这是设计意图」的判断，故标 `confirmed` 而非 `intentional`。

3. **F-17 的可达性我判定为「否」，依据是 `toMessageParams:60` 与 `updateContent:379` 恒置 blob。** 但我没有排查过**历史版本代码或第三方导入路径**（备份导入 `.nmbackup` 是整库拷贝、不重写行；VFS 导入不碰 `chat_message`）——如果有我没覆盖的写口，这条会从 P3 升到 P2。**建议交由验证机位实跑一遍「跑前谓词 COUNT → 搬运 → 跑后 COUNT」的端到端口径**（这正是 `RULE.md` 记录的外部确认 SQL：`SELECT COUNT(*) FROM chat_message WHERE content_json != ''` 归零 + KKV 标记已置）。

4. **两个后台任务的退役时点我没有独立核实。** 我引用的 `spec.md:56-62` 阶段 V1/V1' 与 `RULE.md` 的「约 10 个 tag 后」是**同一份文档体系内的一致声明**，但我没有查 tag 历史来确认「10 个 tag」距离今天（2026-09-30，基线 main@9ca5f5ad / v1.5.28）还剩几个。**如果实际已进入 V1 窗口，那么 F-1（双形态读）与整个 compaction 任务应该是「本轮就该下线」的 backlog 项，而不是继续辩护的对象** —— 这条请 reduce 阶段务必查证 tag 后再定性。

5. **我没有覆盖的部分**（明确划出边界，避免被误读为已审）：`sqlite-session.repository.ts` / `sqlite-project.repository.ts`（同目录但属会话域）、`service/chat/impl/message.service.ts` 的 fork/copy 全链、`deferred-file-cache-gc.ts`（属 session-kkv 域）、`tdbc` 驱动内部事务语义。这些不在 `w4-msgstore-adv` 的 zone 声明内，若覆盖矩阵显示它们无人认领，请补扫。

## 覆盖声明

本机位实读文件（32 个，按区域归类）：

- **本区主体**：`sqlite-message.repository.ts`、`message.port.ts`、`message-content-codec.ts`、`parse-message-content.ts`、`message-content-match.ts`、`message-content-compaction.ts`、`blob-binary-normalization.ts`、`db-maintenance.service.ts`、`db-maintenance.port.ts`、`db-maintenance/index.ts`、`usage-stats.service.ts`、`decoded-content-cache.ts`、`zlib-codec.ts`
- **决策/口径**：`docs/apm/RULE.md`、`docs/Iterations/message-content-compression/spec.md:38-70`
- **DDL**：`chat-schema.ts`、`provider-schema.ts`、`schema-column-alignments.ts`（grep）
- **装配与调度**：`create-chat-services.ts`、`apps/desktop/.../message-content-compaction.service.ts`、`apps/mobile/.../message-content-compaction.service.ts`、`apps/mobile/src/runtime/create-mobile-runtime.ts`、`apps/desktop/src/main/runtime/desktop-runtime-singleton.ts`、`apps/desktop/src/main/runtime/connection.ts`、`apps/mobile/src/db/connection.ts`、`apps/cli/src/runtime.ts`
- **缓存失效旁证**：`message.service.ts`、`message-rollback.service.ts`、`clear-session-prompt-caches.ts`
- **并发语义旁证**：`packages/tdbc-driver-better-sqlite3/src/mutex.ts`、`.../connection.ts`
- **测试存量**：`packages/core/test/{infra/message-content-compaction*.test.ts, infra/blob-binary-normalization*.test.ts, infra/db-maintenance.test.ts, infra/content-cache/decoded-content-cache.test.ts, chat/message-search.test.ts, chat/usage-stats.service.test.ts, service/chat/message-search-service-limit.test.ts}`（实测 27+43+34+8+22+121 条量级用例，覆盖面足以支撑 F-1~F-4 的 `intentional` 定性）

**统计**：P0×0，P1×0，P2×2（F-13、F-14），P3×18（F-1~F-12 计 12 条辩护项 + F-15~F-20 共 6 条让步项）。辩护项 12 条全部 `intentional` 并带 spec/RULE/实测三源之一；让步项 8 条（P2×2 + P3×6）无一条被粉饰为「可接受」。
