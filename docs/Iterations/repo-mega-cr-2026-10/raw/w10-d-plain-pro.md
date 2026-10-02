---
zone: d-plain-pro
agent: 检察官（对抗机位 W10）
files_scanned:
  - packages/core/src/domain/chat/content/parse-message-content.ts
  - packages/core/src/domain/chat/logic/message-content-codec.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/content/message-content-match.ts
  - packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts
  - packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts
  - packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts
  - packages/core/src/infra/content-cache/logic/decoded-content-cache.ts
  - packages/core/src/bootstrap/novel-master-bootstrap.ts
  - packages/core/src/bootstrap/chat/chat-schema.ts
  - packages/core/src/bootstrap/schema-align/schema-column-alignments.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/service/chat/impl/usage-stats.service.ts
  - apps/cli/src/runtime.ts
  - apps/desktop/src/main/services/message-content-decompression.service.ts
  - apps/desktop/src/main/services/db-maintenance.service.ts
  - apps/desktop/src/main/services/db-maintenance-busy.ts
  - apps/mobile/src/services/message-content-decompression.service.ts
  - apps/mobile/src/services/db-maintenance.service.ts
  - apps/desktop/renderer/features/settings/migration-row-value.ts
  - apps/mobile/src/screens/stack/storage-config-migration-values.ts
  - apps/desktop/shared/ipc-types.ts
---

## 摘要

v1.5.29 把 `chat_message` 正文从「zlib 压缩双列」改回「`content_json` 明文正形态」。
本区含四段：新写侧（repository 写路径一律直写明文、压缩两列恒 NULL）；迁移期双形态读
（`readRowContent` blob 优先）；反向搬运任务（545 行，把存量压缩行逐行解回明文，谓词
`content_blob IS NOT NULL`）；以及搬运任务依赖的启动期维护欠账公共逻辑、部分索引、
状态采样与双端/CLI 接线。搬运任务本体是本区风险最集中的文件。

## 职责与边界

- **正形态与兼容期**：`content_json` 明文为唯一正形态；`content_encoding` /
  `content_blob` 两列保留在 DDL 与 INSERT 列清单里，仅为迁移期存量压缩行服务，
  V1' 随 `decodeMessageContent` 一并退役
  （`chat-schema.ts:48-55`、`message-content-codec.ts:4-8`）。
- **写侧铁律**：任何写 `content_json` 的路径必须同时把两列置 NULL，否则读路径
  「blob 非空优先」分支会解压出旧正文——不报错、静默返回错内容
  （`sqlite-message.repository.ts:424-441`，T-MP1 锁死）。
- **读侧铁律**：压缩行的源字节是**库内不可信数据**。inflate 成功 ≠ 内容合法
  （fflate 不校验 adler32），所以搬运任务在 UPDATE 前必须过 `parseMessageContent`
  合法性闸门，否则会把该行唯一的压缩副本销毁成永久不可读行
  （`message-content-decompression.ts:434-440`）。
- **搬运收敛性**：谓词三处同条件（COUNT / 批查询 / UPDATE WHERE），幂等可续跑；
  坏行隔离不阻断完成标记；收尾谓词校验是承重不变量
  （`message-content-decompression.ts:192-198`、`506-524`）。
- **不在本区边界**：prompt 组装、渲染、IPC 契约细节、blob 归一任务本体（只作为
  互扰方出现）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `parseMessageContent(json)` / `assertMessageContent(v)` | `parse-message-content.ts:471` / `:446` | 严格 parse/校验；`assertMessageContent` **原地改写** `value.blocks` |
| `decodeMessageContent(encoding, blob, messageId)` | `message-content-codec.ts:56` | 纯函数、无缓存；失败抛类型化 `ChatError` |
| `SqliteMessageRepository.readRowContent` | `sqlite-message.repository.ts:125` | 双形态读（blob 优先） |
| `SqliteMessageRepository.updateContent` | `sqlite-message.repository.ts:424` | 三列齐置 |
| `SqliteMessageRepository.searchMessages` | `sqlite-message.repository.ts:549` | LIKE 粗筛 + keyset 续扫 |
| `runMessageContentDecompress(conn, opts)` | `message-content-decompression.ts:339` | 反向搬运任务本体 |
| `getMessageDecompressStatus(conn)` | `message-content-decompression.ts:308` | 状态采样（3s 节流） |
| `runPendingStartupMaintenance(conn, args)` | `db-maintenance.service.ts:210` | 两代任务共用的 pending 补跑 |
| `runStartupMaintenanceOnce(conn)` | `db-maintenance.service.ts:146` | 进程级去重维护链路 |
| `MessageDecompressStatus` | `message-content-decompression.ts:119` | **只有 done / pendingCount 两字段** |
| `MESSAGE_DECOMPRESS_KKV_MODULE/KEY` | `message-content-decompression.ts:81-82` | `nm-message-decompress` / `decompressDone` |

## 数据访问

| 表 / 域 | 位置 | 形态 |
|---|---|---|
| `chat_message.content_json` | `sqlite-message.repository.ts:137`（读）、`:436`（写）、`message-content-decompression.ts:461`（搬运写回） | TEXT NOT NULL，明文 blocks JSON |
| `chat_message.content_blob` | `sqlite-message.repository.ts:126`（读）、`:170`（schema）、`message-content-decompression.ts:195/412/460` | BLOB NULL，迁移期非空即待搬运 |
| `chat_message.content_encoding` | `sqlite-message.repository.ts:128`、`chat-schema.ts:54` | TEXT NULL CHECK IN ('zlib','zlib-b64') |
| `chat_message`（rowid） | `message-content-decompression.ts:412` | keyset 游标 `rowid > ?`（常规表，无 INTEGER PK） |
| `idx_chat_message_pending_blob` | `novel-master-bootstrap.ts:399` | 部分索引 `(id) WHERE content_blob IS NOT NULL`，事务外无条件段 |
| KKV `nm-message-decompress/decompressDone` | `message-content-decompression.ts:81-82, 530` | 完成标记（含 failedCount / failedIds） |
| KKV `nm-message-content/startupMaintenancePending` | `message-content-decompression.ts:92-94` | 正向任务遗留 pending，字面量 |
| KKV `nm-blob-binary/startupMaintenancePending` | `db-maintenance.service.ts:103` | 手动清理只清这一条 |
| 全表扫读三列 | `revision-ref-count.ts:175`、`usage-stats.service.ts:515` | read-ref repair / 工具调用现算 |

## 依赖关系

- **import 谁**：`message-content-decompression` → `zlib-codec`（inflate 闸门）、
  `parse-message-content`（合法性闸门）、`db-maintenance.service`（pending 补跑）、
  `SqliteKkvRepository`（标记）。`db-maintenance.service` **不反向 import** 归一任务
  （用字面量 `nm-blob-binary` 规避循环，`db-maintenance.service.ts:96-104`）。
- **被谁消费**：`runMessageContentDecompress` ← CLI（`runtime.ts:197`，await 进命令
  关键路径）、desktop（fire-and-forget 循环）、mobile（延迟 3s 循环）。
  `getMessageDecompressStatus` ← 两端 `db-maintenance.service` → IPC/渲染层状态行。
- **横向依赖**：`decoded-content-cache` 只剩 contentBodyPool 一池
  （`decoded-content-cache.ts:27-35`），chat_message 正文已退出该层。

## 发现清单

### F-d-plain-pro-1 | P2 | `sqlite-message.repository.ts:602`（守卫定义 `:117`）

```
const LIKE_PREFILTER_UNSAFE_RE = /["\\\x00-\x1f]|[^\x00-\x7f]/;
...
? ` AND (content_blob IS NOT NULL OR content_json LIKE '%' || #{keyword} || '%')`
```

**描述**：守卫只检查 **keyword** 的字符是否可安全进 LIKE，却完全没管 **content_json
里存的正文**。而两端的匹配语义不同：内存判据 `messageMatchesKeyword` 走 JS
`toLowerCase()`（Unicode 感知），SQLite 内建 LIKE 只折叠 ASCII。存在一类字符：它的
JS 小写结果里**含 ASCII 字符**，于是内存判据命中、LIKE 不命中——该行被粗筛直接丢掉，
永远进不了内存精筛。

实测（better-sqlite3 3.49.2，行内容形如
`{"blocks":[{"type":"text","text":"deg 300K C"}]}`，K 为 U+212A KELVIN SIGN）：

```
kw="300k"  LIKE=[]      MEM=["B"]   RECALL_LOST=["B"]
kw="i"     LIKE=["A"]   MEM=["A"]        （U+0130 İ → "i̇"）
```

同类字符还有 U+0130（İ → i + U+0307）。也就是说**纯 ASCII 关键词**（"300k"、
"i"、"k"）就会触发，与守卫注释里写的「keyword 含非 ASCII 才退回全量」正好相反。

**建议**：要么把粗筛条件从「仅 keyword 安全」收紧为「keyword 安全 **且** 库内不存在
会 fold 到 ASCII 的非 ASCII 字符」（不可行，代价太高），要么把粗筛改成对
`lower(content_json)` 做——SQLite 的 `lower()` 同样只折叠 ASCII，无解；实际可行的
最小修法是**只对 keyword 做双向守卫仍不够**，应改为：粗筛命中集与内存判据取并集不可行，
那就退回「仅当 keyword 命中的行数 < scanLimit 时才继续下一段」这类**过近似**——已实现
（`sqlite-message.repository.ts:644`），所以更稳的修法是**接受过粗、拒绝漏召回**：把
`LIKE` 换成对 `hex(content_json)` 之类不可能的方案不现实，建议直接**在 U+0130 /
U+212A 这类字符上做检测不可行 → 改为只对「keyword 长度 ≥ 2 且不含通配」的常见路径开
粗筛，其余一律全量精筛**，或干脆退回全量精筛（v1.5.29 之前的形态，零风险）。最低成本
的止血是：**把粗筛结果与全量判定的差集风险显式登记为已知取舍**（现在注释宣称召回红线
成立，与实测不符）。

**置信**：confirmed（实测复现，better-sqlite3 3.49.2）。

---

### F-d-plain-pro-2 | P2 | `message-content-decompression.ts:279-288`（`:189` 声明无上限）、`apps/cli/src/runtime.ts:197`

```
const placeholders = failedIds.map(() => "?").join(",");
`SELECT 1 AS present FROM chat_message
 WHERE content_blob IS NOT NULL AND id NOT IN (${placeholders})
 LIMIT 1`
```

**描述**：`failedIds` 被明确设计成「坏行本就少量，**不设上限**」（`:189`），并整份持久化
进 KKV 标记（`:536`）。它同时随整库快照 travels（云同步 / 备份回灌），是**外部可写**的
输入。入口自愈探针把它整体展开成 `?` 占位符，一旦超过驱动的
`SQLITE_MAX_VARIABLE_NUMBER`，`conn.query` 直接抛错：

```
实测 better-sqlite3：32766 OK / 32767 ERR: too many SQL variables
实测 compile option：MAX_VARIABLE_NUMBER=32766
（RN op-sqlite 自带 SQLite，老构建常见上限 999）
```

关键在于**这个抛出点没有兜底**：`hasPendingRows` 的调用（`:361`）不在任何 try/catch 内，
异常一路穿出 `runMessageContentDecompress`。三条消费链的后果各不相同：

- desktop（`message-content-decompression.service.ts:110-127`）：非「连接已关」→ warn 后
  `return`，本进程彻底放弃；
- mobile（`message-content-decompression.service.ts:72-77`）：`console.error` 后 `return`；
- **CLI（`apps/cli/src/runtime.ts:197`）：`await runMessageContentDecompress(...)` 裸奔、
  无 try/catch** → `createNovelMasterRuntime` 直接 reject → **每一条 CLI 命令都失败**。

而且抛出发生在**清标记之前**，所以下一次冷启动重蹈覆辙，形成永久闩锁——恰好是本文件
文件头（`:23-33`）声称要「永久消除」的那一类问题。

**建议**：`failedIds` 加硬上限（如 512，超出则截断并在 warn 里说明剩余坏行未排除，探针
退化为不排除——最坏后果是多扫一遍全表，可接受）；`hasPendingRows` 整体包 try/catch，
失败按「视为有 pending」处理（宁可多搬不可不搬）；CLI 侧对
`runMessageContentDecompress` 加一层「吞 warn 不阻断命令」的包装（对齐
`runBlobBinaryNormalization` 已经在做的处理，`blob-binary-normalization.ts:753`）。

**置信**：confirmed（上限实测 + 三条调用链的 try/catch 形态已逐条读过）；RN op-sqlite 的
实际上限未实测，标 suspected。

---

### F-d-plain-pro-3 | P2 | `message-content-decompression.ts:311-313`、`apps/desktop/shared/ipc-types.ts:1663`、`apps/desktop/renderer/features/settings/migration-row-value.ts:43`、`apps/mobile/src/screens/stack/storage-config-migration-values.ts:29`、`sqlite-message.repository.ts:125-138`

```
// message-content-decompression.ts:308-313
export async function getMessageDecompressStatus(conn) {
  if (await readDoneMarker(conn)) {
    return { done: true, pendingCount: 0 };   // marker.failedCount 在这里被丢弃
  }
```

**描述**：`failedCount` / `failedIds` 这条链在 core 里被**精心设计、完整持久化**
（`:186-189` 注释写明「运维可据此直接定位坏行」），`runMessageContentDecompress` 的返回
值也带着它（`:365`）——然后在状态 API 处**断头**：`MessageDecompressStatus` 接口只有
`done` / `pendingCount`（`:119-124`），DTO 同形（`ipc-types.ts:1663-1668`），两端渲染层
也都只判两态（`migration-row-value.ts:43-45`、`storage-config-migration-values.ts:29-34`）。

对照姊妹任务 blob 归一：它的 `BlobBinaryTableStatus` 带 `failedCount`，UI 有完整的第三态
「已完成（N 条需人工处理）」（`migration-row-value.ts:53-58`）。**同一张「存量数据迁移」
卡片的两行，用户对其中一行能看见坏行、对另一行完全看不见。**

后果不止是少一个数字。坏行按设计**永久保留压缩形态**（`:441-454` 坏行隔离，行不写库），
而读路径 `readRowContent` 对坏行是 **fail-fast**（`decodeMessageContent` 抛 →
`rowToMessage` 抛 → `mapRows` 抛 → 整个 `listBySession` reject，
`sqlite-message.repository.ts:125-138`）。也就是说：**一条永久坏行 = 整个会话的历史列表
在 UI 里读不出来**，而存储页那行还写着绿色的「已完成」。用户既看不到信号、也无法定位。

**建议**：①`MessageDecompressStatus` 加 `failedCount`（数据现成，只差透传），两端 UI 补
第三态文案「已完成（N 条需人工处理）」，与 blob 行对齐；②读路径对坏行做**单行降级**
（保留行、content 置空块并在 UI 标「此消息无法读取」），把「整会话不可读」降为「一条不可读」。

**置信**：confirmed（数据断头与 UI 两态已逐行读过；fail-fast 传播链已读过）。

---

### F-d-plain-pro-4 | P3 | `db-maintenance.service.ts:100-111`

```
await conn.execute(
  "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
  ["nm-blob-binary", "startupMaintenancePending"]
);
```

**描述**：手动「数据清理」成功后按 advisory③ 顺手清掉维护欠账标记，避免下次冷启动白跑
一次全库 VACUUM——注释里这个理由写得很清楚。但它**只清了 `nm-blob-binary` 一条**，
漏了反向搬运任务消费的那条：`LEGACY_MESSAGE_CONTENT_KKV_MODULE = "nm-message-content"` +
同一个 key（`message-content-decompression.ts:92-94`、`:345-351`）。

后果：从 v1.5.25~1.5.28 升上来、且当初收尾维护失败过的库，用户手动点了「数据清理」
（已经把 GC + checkpoint + VACUUM 全跑完、页空间已归还），标记却还在；下一个冷启动
解压任务入口读到它、又跑一遍 `runStartupMaintenanceOnce` → **第二次全库 VACUUM**
（76MB 量级库在 desktop 上冻结 main 数秒）。这不是正确性问题，是纯浪费，且与本文件
自己写下的 advisory③ 意图直接矛盾。

**建议**：把这段改成按 module 列表批量删（`WHERE module IN ('nm-blob-binary',
'nm-message-content') AND key = ?`），或复用 `runPendingStartupMaintenance` 的参数化
形态逐条清。

**置信**：confirmed。

---

### F-d-plain-pro-5 | P3 | `message-content-decompression.ts:398/477`（游标）× `blob-binary-normalization.ts:763`（并发 VACUUM）

**描述**：解压任务的 keyset 游标建在 `rowid` 上，因为 `chat_message` 是常规表
（`id TEXT PRIMARY KEY`，**没有 INTEGER PRIMARY KEY**）。SQLite 官方文档明确写着：没有
显式整数主键的表，**VACUUM 可能重编 ROWID**。

而两端的解压循环与 blob 归一循环是**各自独立 fire-and-forget 的后台循环，跑同一条连接**
（desktop `main.ts:177` 与归一调度各自挂载；mobile `novel-master-context.tsx:233` 与
归一调度同理）。归一任务在收尾会调 `runStartupMaintenanceOnce` → **VACUUM**
（`blob-binary-normalization.ts:763`），完全可能落在解压任务两个批之间。

一旦重编发生：解压任务后半程的 `rowid > cursor` 会**跳过**一批行。收尾谓词校验能兜住
（`leftover > failedKeys.size` → stalled、不置标记），所以**不会静默锁死**，但代价是：
本进程白搬一场、下个冷启动重扫，且 app 层见 `stalled` 就整轮停手
（desktop `:99-107`、mobile `:61-69`），用户体感是「明文化卡住了」。

**实测**：SQLite 3.49.2 上四种形态（偶数位删除 / 删头 / 删尾+插入 / 任意删）VACUUM 后
rowid **均未重编**，批查询计划稳定走 `USING INTEGER PRIMARY KEY (rowid>?)`。所以这条在
当前驱动上大概率不可触发。

**建议**：要么把游标从 `rowid` 换成与 blob 归一任务同款的主键 `id`（那边已经是
`id > ?` + `ORDER BY id`，`blob-binary-normalization.ts:192-198`，天然免疫），要么在
两循环之间加一条「维护段期间解压任务挂起」的显式互斥（desktop 已有
`setDesktopDbMaintenanceBusy` 计数信号可复用，只需让归一任务的收尾段也置它）。

**置信**：suspected（文档说 may，实测当前 SQLite 不重编；风险来自未来驱动版本与 RN 侧
未实测）。

---

### F-d-plain-pro-6 | P3 | `message-content-decompression.ts:440` × `parse-message-content.ts:302-315`

```
// 搬运侧：只校验，不回写归一化结果
parseMessageContent(plaintext);
// ...
const result = await conn.transaction(async (tx) => tx.execute(
  `UPDATE chat_message SET content_json = ?, ...`, [plaintext, row.id]));
```

**描述**：`parseMessageContent` 内部会**归一化并丢弃**内容：`parseBlocksArray` 把空的
`text` 块直接 `continue` 掉（`parse-message-content.ts:306-311`），`assertMessageContent`
还把这份结果**原地赋回** `value.blocks`（`:467`）。但搬运任务只拿它的返回值做闸门，
写回的是**原始解压字符串** `plaintext`。

于是存量压缩行里那些「能被 parse 吃掉但仍留在 JSON 里」的形态（空 text 块、未知 meta
字段）会被**原样搬进明文列**，落库后 wire 不是本仓的规范形态。读路径再次 parse 时才丢掉，
所以**功能上无害**；但它让「明文是正形态」这条新不变量在数据层面不成立——将来任何
直接读 `content_json` 列的新代码（统计、导出、备份校验、e2e 断言）都会看到非规范 JSON。

**建议**：写回 `JSON.stringify(parseMessageContent(plaintext))`，让搬运成为真正的
「解压 + 归一化」一步到位；代价是行内容可能被重排（键序），需在 T-MP 用例里补一条
round-trip 断言。这属于「要不要现在做」的取舍，故记 P3。

**置信**：confirmed（代码路径确定）；是否值得改属设计取舍。

---

### F-d-plain-pro-7 | P3 | `message-content-decompression.ts:500-502`（预算）+ `:37`（codec 的 64MB 上限）

```
// 批尾才判预算
if (Date.now() >= deadline) {
  return { done: false, decompressedCount, failedCount, stalled: false };
}
```

**描述**：「升级首启有界同步收尾预算（默认 60s）」是本任务对外承诺的硬边界（文件头
`:53-55`），但检查点只在**批尾**，一批是 100 行，每行要做
`decodeMessageContent`（上限 64MB，`:37`）+ `parseMessageContent`（整份 JSON.parse +
对象图构建）。注释辩解「行粒度事务已足够短」（`:499`）——事务确实短，但**解压 + 解析
不短**：一条 8MB 消息在 Hermes 上就是数十毫秒到数百毫秒，100 行一批足以把 60s 预算
超出一个数量级。

desktop 上这意味着 main 事件循环被冻结超出承诺窗口；CLI 更直接，5s 预算（`runtime.ts:197`）
下首条命令可能被单批拖到分钟级（这与 blob 归一侧 `:753-755` 那段「必须吞异常，否则每条
CLI 命令都失败」的注释是同一个痛点）。

**建议**：把 `Date.now() >= deadline` 下沉到**行循环内**（至少每 N 行判一次），或把
BATCH_SIZE 与预算挂钩。成本几乎为零，收益是让「有界」这个承诺真的成立。

**置信**：confirmed（检查点位置确定）；超窗幅度未实测，标 suspected。

---

### F-d-plain-pro-8 | P3 | `message-content-codec.ts:46-50`、`decoded-content-cache.ts:27-35`

**描述**：v1.5.29 删掉了进程内的「消息正文池」（键 = message id），`decodeMessageContent`
退化为纯函数、零缓存——注释给的代价评估是「存量压缩行的重复读每次都重新 inflate，
**短窗口**可接受」。

问题在于这个「短窗口」的长度不由设计决定，而由**搬运收敛速度**决定：desktop/mobile 每轮
60s 预算、遇 Agent 活跃/云同步/数据清理即暂停（5s 退避）、CLI 只有 5s。一个 5000 条
存量压缩消息的库，在最坏情况下要**跨若干次冷启动**才能搬完；而这期间该库的每一次
`listBySession` / `searchMessages` / 步骤生成读取，都要为每条压缩行付一次纯 JS inflate。
v1.5.28 的 CHANGELOG 恰好宣称这个缓存把「连续几秒内的占位计算与提示词统计」从数十秒级
降到亚秒级——v1.5.29 在迁移窗口内把这笔收益又还回去了。

**建议**：在 V1' 之前给压缩行保留一个**只读、不需要失效**的最小缓存（例如键 =
`content_hash(blob 字节)`，值 = 解压明文）——它与 blob 内容寻址同构，天然无陈旧窗口，
且复用已被 vfs/file_cache 验证过的 `contentBodyPool`。若判断不值得，至少把「短窗口」的
长度依赖写进注释（当前注释让人以为窗口是分钟级，实际可能是天级）。

**置信**：confirmed（代码与注释确定）；是否值得加缓存属取舍。

---

### F-d-plain-pro-9 | P3 | `message-content-decompression.ts:232-236`

```
} else {
  console.warn(
    `[${args.logTag}] ${args.pendingKey} 补跑被进程级去重短路（本进程已跑过维护链路），保留标记待下次冷启动补跑——正常场景`
  );
}
```

**描述**：`runPendingStartupMaintenance` 在 `runMessageContentDecompress` 的**最开头**
无条件调用（`:345`），而两端循环会**反复**调用它（`sleep(0)` 续跑）。只要 legacy pending
标记因「进程级去重短路」被保留，**每一次循环迭代都会打一条同样的 warn**——一条 60s 预算
的续跑循环里这是每分钟一条的固定噪音，日志被冲掉时反而会盖住真正要看的告警
（比如坏行 warn `:448`、stalled warn `:485`）。

**建议**：把「去重短路」这条 warn 降为 debug 级，或用模块级 `let warnedOnce = false`
只打首次。

**置信**：confirmed。

---

### F-d-plain-pro-10 | P3 | `novel-master-bootstrap.ts:394-401`

```
const pendingBlobColumn = await conn.query(...);
if (pendingBlobColumn.length > 0) {
  await conn.execute(
    "CREATE INDEX IF NOT EXISTS idx_chat_message_pending_blob ON chat_message(id) WHERE content_blob IS NOT NULL"
  );
}
```

**描述**：这条注释写得很坦诚——「本条 fail loud、不包 try/catch，静默吞掉建索引失败会让
入口探测永久退回全表扫且无任何痕迹」，并明确说这是**有意**与同层 `seedBuiltinSkills` /
发号器安全网（都只 warn）的失败语义不同。所以按协议标 `intentional`。

但要指出它的**代价被低估了**：这是一条纯性能索引，失败却会让 `bootstrapNovelMaster`
整体 reject。三端的 bootstrap 都没有兜底——desktop `getDesktopConnection` 的
`initPromise` reject（`connection.ts:41`）、mobile 显式 catch 后 close 并重抛
（`connection.ts:79-90`）、CLI `createNovelMasterRuntime` reject（`runtime.ts:190`）。
而本仓**没有配置任何 `busy_timeout`**（全仓 grep 无命中），better-sqlite3 默认遇到并发
写者立刻 `SQLITE_BUSY`；再加上磁盘满 / 只读挂载，`CREATE INDEX` 都会抛。

也就是说：为了省掉「每次启动一次全表扫」这点性能收益，把「app 完全起不来」变成了一个
可能的失败模式。第一版升级、存量压缩行最多的那一刻（索引最大的那一刻）恰好也是风险
最高的那一刻。

**建议**：保留 fail loud 的意图，但把**建索引失败**与「索引不存在」区分开——失败时
`console.warn` 明写「探测将退回全表扫」并继续启动（本仓已有 `seedBuiltinSkills`
的同款先例可援引）。若坚持 fail loud，则至少给 `conn.execute` 加一个短 `busy_timeout`
兜住并发写者这一类。

**置信**：intentional（设计已拍板），此处只登记代价与建议。

---

### F-d-plain-pro-11 | P3 | `blob-binary-normalization.ts:720-724`（对照 `message-content-decompression.ts:359-385`）

**描述**：两个搬运任务对「完成标记与数据形态脱节」的处理**不对称**：解压任务在入口加了
存在性探针自愈（清标记续搬，文件头称之为「永久消除整类问题」），blob 归一任务没有——
它 `if (await readDoneMarker(conn, adapter)) continue;` 直接短路。

云同步 pull / 备份导入把一份**旧的**整库快照回灌（其中 `chat_message` 行仍是
`zlib-b64`），归一任务的 `nm-blob-binary/messageContentDone` 随快照一起回来 → 归一永久
跳过。好在解压任务的自愈探针会兜住：它会看到 `content_blob IS NOT NULL`、清自己的标记
续搬，而 `decodeCompressedBytes` 三形态兼容（`zlib-codec.ts:180-199`）能正确读
`zlib-b64`。所以**当前无实际损失**，只是归一那一层少了道保险。

**建议**：把解压任务那段探针抽成公共 helper（`hasPendingRows` 的形状），两个任务共用；
否则下一个新增的搬运任务仍要各写一遍，漏写就是永久闩锁。

**置信**：suspected（当前无实际损失；快照回灌后是否真出现 `zlib-b64` 行取决于
快照内容，未构造端到端复现）。

---

### F-d-plain-pro-12 | P3 | `sqlite-message.repository.ts:553-558`（与 `:602` 自相矛盾）

```
// 553-558：「全量精筛（不做 LIKE 粗筛）……与本迭代解耦，全量精筛路径零改动」
// 602：   const keywordPrefilter = canPrefilterWithLike(keyword) ? ` AND (...LIKE...)` : "";
```

**描述**：同一个函数里相隔 45 行的两段注释对同一件事给出相反的陈述。前半段说「不做
LIKE 粗筛」「路径零改动」，后半段详细描述 LIKE 粗筛的谓词、压缩行放行规则和召回红线。
git 溯源确认：粗筛是 `85abb7eb` 后加的，前半段注释没跟着改。

这类自相矛盾的注释在 CR 场景里危害不小——「召回红线」那段声称「LIKE 只是粗筛，命中与否
最终仍由内存精筛决定」，读起来像是「LIKE 漏命中也无所谓」，而实际上 LIKE 漏命中就是
**永久漏召回**（被过滤掉的行根本进不了精筛）。这正是 F-1 的认知土壤。

**建议**：删掉 553-558 那段陈旧注释，或改成「本路径含 LIKE 粗筛，召回红线见
`LIKE_PREFILTER_UNSAFE_RE`」。

**置信**：confirmed。

## 争议与存疑

1. **F-1 该不该修**：粗筛的收益是实打实的（大会话搜索省掉 JSON.parse）。但它换来的
   召回损失在 `U+0130` / `U+212A` 这类字符上是确定的。我认为**当前形态不该上生产**
   （注释里那条红线是假的），但最优解不是简单回退——需要一个「LIKE 超集」语义
   （例如把非 ASCII 关键词也交给 LIKE，只在含转义字符时回退），这值得单独一轮设计。
   若裁决层认为「极端 Unicode 字符下的漏召回可接受」，那至少要把红线注释改成实话。

2. **F-3 的读路径降级是否属于本区**：让坏行不拖垮整个会话，改动面在渲染层与消息模型
   （要表示「此消息无法读取」），已经溢出本区边界。我把它记在这里，是因为**触发它的新码
   正是本区的坏行隔离策略**——v1.5.29 让「永久坏行」从偶发变成必然（标记里持久化
   failedIds、每次冷启动都不再重试）。不处理的话，迁移任务等于给「整会话不可读」上了
   一道永久保险。

3. **F-5 的实际概率**：SQLite 3.49.2 实测不重编 rowid，desktop（better-sqlite3）大概率
   安全；**mobile（RN op-sqlite）未实测**，而 mobile 恰恰是「单连接 + 后台循环 + VACUUM
   也可能同时跑」的那一端。若裁决层要在移动端加互斥，成本很低（复用现成的
   `acquireMobileDbMaintenanceBusy`）。

4. **未纳入清单但已确认无问题**（避免下一轮重复排查）：
   - `updateContent` 三列齐置（`:435-437`）与 `toMessageParams` 的 21 列/21 参数对齐
     （`:37` vs `:53-76`）——逐位核对无误；
   - `INSERT` 列清单里的 `content_encoding`/`content_blob` 恒绑 NULL（`:59-60`）；
   - `CHAT_SCHEMA_STATEMENTS` 与 `SCHEMA_COLUMN_ALIGNMENTS` 的两列定义一致（CHECK 值域
     相同，`chat-schema.ts:54` vs `schema-column-alignments.ts:165`）；
   - 部分索引的落点（事务外无条件段）确实覆盖了存量库快路径，EXPLAIN 实测探测/COUNT
     走索引、批查询仍走 rowid 主键，且在压缩比 0.02% / 50% / 100% / 90%+5 万行四种分布下
     计划都稳定；
   - 收尾不变量 `leftover > failedKeys.size` 的前提（游标扫完后 leftover ⊆ failedKeys）
     在「收尾前无任何提前 break」的前提下成立——已核对 `:400-524` 全段，四个提前 return
     分支（shouldPause / 预算 / 零进展护栏）全在收尾校验之前，没有 break；
   - `readDoneMarker` 的旧格式兜底（`:239-254`）覆盖了已发布的 `{at, failedCount}`
     两字段形态。
