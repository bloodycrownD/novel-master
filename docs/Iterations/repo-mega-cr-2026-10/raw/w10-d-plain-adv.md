---
zone: d-plain-adv
agent: 辩护人（对抗对 · 明文化链）
files_scanned: 48
---

# W10 对抗机位 · 辩护人报告 —— v1.5.29 明文化链

> 基线：`feat/repo-mega-cr` @ `fe79b781`（对比 `9ca5f5ad`）。
> 立场：为实现辩护。凡 spec / cr-fix-spec 已拍板的设计一律按「intentional」处理，
> 不重复提问题；但**拍板文档没覆盖到的残余**据实列出让步清单。
> 独立纪律：本报告未读 `raw/` 下任何他人报告（除自身 schema 对照），
> 证据全部来自本 worktree 代码与实测命令。

---

## 摘要

本区域是 v1.5.29「消息正文全库明文化」迭代的完整实现链，共 7 段：写侧直写明文
（repo 三列齐置）、存量压缩行的后台反向搬运任务（core）、decode 侧的纯函数化与
解压炸弹闸门、入口自愈探针的部分索引（bootstrap）、消息正文缓存池的整体删除、
搜索口的 parse 前 LIKE 粗筛、以及三端调度接线与状态行换向。净增 4069 行 / 删 1188 行，
正向压缩任务与 `encodeMessageContent` 已彻底退役。

## 职责与边界

- **写侧**：`sqlite-message.repository.ts` 的 `toMessageParams` / `updateContent` /
  `batchInsert` —— 新行恒为明文，两列恒 NULL。
- **读侧双形态**：`readRowContent`（`:125-138`）—— blob 非空走 decode，否则 parse 明文。
  迁移期「压缩行永远合法」的契约反向沿用。
- **迁移层**：`message-content-decompression.ts` —— 谓词驱动的反向搬运，带坏行隔离、
  入口自愈、收尾不变量、零进展护栏、同步预算。
- **不在边界内**（spec 明确不做，本报告不为其辩护也不为其开脱）：vfs/file_cache 的压缩
  （仍走无界 `decompressZlib`，见 `zlib-codec.ts:36` 的三个残余调用方）、LIKE 召回本身、
  `content_encoding` 两列的物理删除（推 V1'）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `runMessageContentDecompress` | `packages/core/src/infra/db-maintenance/impl/message-content-decompression.ts:339` | 反向搬运任务入口，三端唯一调用点 |
| `MessageDecompressRunResult` | 同上 `:152` | `{done, decompressedCount, failedCount, stalled}` |
| `getMessageDecompressStatus` | 同上 `:308` | 双端存储页状态行数据源 |
| `MESSAGE_DECOMPRESS_KKV_MODULE/KEY` | 同上 `:81-82` | `nm-message-decompress` / `decompressDone` |
| `LEGACY_MESSAGE_CONTENT_KKV_MODULE` / `LEGACY_MAINTENANCE_PENDING_KKV_KEY` | 同上 `:92-94` | 正向任务遗留 pending 的字面量 |
| `decodeMessageContent` | `domain/chat/logic/message-content-codec.ts:56` | 纯函数解码器，消费方**四处** |
| `MessageDecompressStatusDto` / `DbStatsResult.messageDecompress` | `apps/desktop/shared/ipc-types.ts:1663/1681` | 双端同构改名 |
| `scheduleDesktopMessageContentDecompress` / `scheduleMobileMessageContentDecompress` | 两端 service | 启动挂点 |

`packages/core/src/index.ts` 的导出已换向（旧三符号 `DEFAULT_COMPACTION_SYNC_BUDGET_MS` /
`getMessageCompactionStatus` / `runMessageContentCompaction` 零残留，实测 grep 0 命中，
仅注释里作为历史名词出现 3 处，属有意保留的沿革说明）。

## 数据访问

| 触点 | 谓词 / 语句 | 位置 |
|---|---|---|
| chat_message 写 | `INSERT ... content_json=?, content_encoding=NULL, content_blob=NULL` | `sqlite-message.repository.ts:35-38` + `:52-77` |
| chat_message 改 | `SET content_json=?, content_encoding=NULL, content_blob=NULL WHERE id=?` | 同上 `:432-441` |
| 搬运谓词（三处同条件） | `content_blob IS NOT NULL` | `message-content-decompression.ts:195` / `:283`/`:290` / `:413` / `:462` |
| 自愈探针 | `... AND id NOT IN (?,...) LIMIT 1`（raw-SQL 拼接） | 同上 `:275-293` |
| 部分索引 | `CREATE INDEX IF NOT EXISTS idx_chat_message_pending_blob ON chat_message(id) WHERE content_blob IS NOT NULL`（**事务外无条件段**） | `bootstrap/novel-master-bootstrap.ts:394-401` |
| 搜索粗筛 | `AND (content_blob IS NOT NULL OR content_json LIKE '%' \|\| ? \|\| '%')` | `sqlite-message.repository.ts:602-604` |
| KKV | `nm-message-decompress` / `decompressDone` | `message-content-decompression.ts:81-82, 530-538` |
| KKV（遗留欠账） | `nm-message-content` / `startupMaintenancePending` | 同上 `:92-94`；消费逻辑在 `db-maintenance.service.ts:210-246` |

## 依赖关系

- **import**：解压任务 → `message-content-codec` + `parse-message-content` +
  `db-maintenance.service`（`runPendingStartupMaintenance`）+ `SqliteKkvRepository`；
  codec → `zlib-codec`（`decompressZlibBounded` / `decodeCompressedBytes`）+ `chat-errors`。
- **被谁消费**：desktop `main.ts:177`、mobile `novel-master-context.tsx:233`、
  CLI `runtime.ts:197`；状态行 → `SettingsViews.tsx` / `StorageConfigScreen.tsx`。
- **读侧 decode 四处**（与 spec 声明一致）：`readRowContent`（repo `:129`）、
  `usage-stats.service.ts:526`、`revision-ref-count.ts:183`、反向任务本体 `:429`。
- **无反向依赖**：core domain 层不 import service 层（`runInTransactionOrConn` 按
  cr-fix-spec cr-p2 的要求在 repo 内复制一份，未从 `revision-aware-vfs.service.ts` 抽公共 helper）。

---

## 辩护理由清单

### 1. 写侧三列齐置 —— 数据正确性的地基钉死了（Defense-1）

`updateContent`（`sqlite-message.repository.ts:432-441`）的 SQL 是
`SET content_json = #{json}, content_encoding = NULL, content_blob = NULL`，
不是「顺手加个 NULL」而是**显式三列**。这一点值得单独辩护：明文化迭代里最容易出的
事故不是崩溃，而是「编辑一条存量压缩行、读路径按 blob 优先解出旧正文」——
不崩、不报错，只是静默返回错内容。这类缺陷靠 code review 很难长期守住，靠反例用例
才守得住。`message-plaintext-write.test.ts:167` 的 T-MP1 反例正是这个形状，
且断言的是**读回内容**而非「SQL 里有没有 NULL 字面量」，口径正确。

`toMessageParams`（`:52-77`）同样把两列名留在 INSERT 列清单里显式绑 NULL
（`content_json` 之后紧跟 `null, null`），列不删、CHECK 约束原样、
`SCHEMA_BOOT_VERSION` 不 bump —— 与 spec「不删两列」的边界一致，
也保住了「e2e fixture 直插明文仍可用」（`message-content-compaction-schema.test.ts` 零改动）。

### 2. 反向搬运任务的收尾不变量，是整个迁移层唯一不可省的一行（Defense-2）

`message-content-decompression.ts:513-524`：

```
const leftover = await countPendingRows(conn);
if (leftover > failedKeys.size) { ... stalled = true; 不置标记 }
```

这一行的存在意义在其他任何地方都找不到等价物。它防的是一类**沉默到无法察觉**的失败：
驱动静默写回不生效时，游标照样扫完全表（`rows.length === 0` 是唯一 break 出口），
谓词里却还剩着一大批压缩行，`failedKeys` 为空 —— 没有这道校验，任务会**谎报完成**、
把那些行永久锁死在压缩态，而表面积上一切正常（标记已置、状态行显示「已完成」）。
更狠的是，它同时防住了零进展护栏（`:479-497`）和预算/守卫的提前 return 被误当成
「扫完了」——注释里明确钉了「收尾前不得引入任何提前 break」。

对应的测试（`message-content-decompression.test.ts:609`）不是字段断言而是
**替身驱动**（UPDATE 影响行数为 0），断言 stalled 透传 + 标记未置。这是承重用例的正确形状。

### 3. 坏行隔离 + 内容合法性闸门 = 本迭代唯一的不可逆数据销毁路径已被堵上（Defense-3）

这一段是本次迭代里**最该被夸**的设计。

正向压缩任务的源是应用自己写出的合法 JSON，「inflate 成功」等价于「内容合法」；
反向搬运任务的源是**库内不可信字节**——这个不对称在正向任务里根本不存在，
所以正向任务不需要这层防护，反向任务非有不可（注释 `:439` 明确写了这一点，
是设计自觉而非补丁）。

具体威胁：`fflate` 的 `unzlibSync` **不校验 adler32**，一个 bit 翻转的 blob 会
「解码成功」吐垃圾。若无闸门直接写回 `content_json` 并把 `content_blob` 置 NULL，
就是**把该行唯一的压缩副本销毁成一个永久不可读的行**——迁移前读路径 fail-fast
但字节还在、可人工恢复；迁移后不可逆。实现（`:429-440`）在 UPDATE 前过
`parseMessageContent(plaintext)`，非法一律归入同一个坏行隔离分支，字节原样保留。
用例（`:1192`）断言三件事：`content_blob` 原样保留、`content_json` 仍为 `''`、
failedCount 透传——正好是「不销毁」的三个面。

更进一步，`parseMessageContent` 之上还有 `decompressZlibBounded`（`zlib-codec.ts:66`）
这道体积闸，且注释诚实地记录了**为什么不能读 zlib ISIZE 尾字段**（fflate 只写 4 字节
adler32、根本没有 ISIZE；实测照 ISIZE 实现会把每一行存量压缩行都误判成炸弹）。
「五轮 CR 都没抓住、靠执行期实测勘误」这件事被如实写进了注释而不是抹掉，
这种诚实本身是实现质量的证据。

### 4. 入口自愈探针 + 部分索引：把「标记闩锁」这一整类问题一次性消掉（Defense-4）

背景值得复述，因为它是本区域最容易「看起来没问题」的一处：完成标记是整库快照的一部分，
云同步 pull 会把它一起带走。标记说「已解完」，库里却还是压缩形态——
不清标记则**该用户永久拿不到本迭代的核心收益**，而且没有任何报错。

实现是两道：任务入口（低频，每次启动）做 `LIMIT 1` 存在性探测、命中即清标记续搬；
状态采样（高频轮询）刻意**不做**探测（`:303-306`，spec 实现期补充第 3 条已拍板）。
这个分工是对的：自愈的价值在「搬之前」，展示面每秒查一次库不划算。

探针排除 `failedIds`（`:275-293`）是第二道，也是最微妙的一道。坏行按设计永留谓词
（否则每次冷启动都要「清标记 → rowid 0 全表重扫 → 再撞同一坏行 → 重置标记」永不收敛）。
解法不是「探针加 slack 阈值」（cr-fix-spec r2 已否掉），而是把坏行 id 清单持久化进标记、
探针用 `id NOT IN (?,...)` 排除——并**实测确认了不能用 `#{...}` 数组绑定**（`renderBind`
对 hash 节点恒返回单值，数组不展开；better-sqlite3 数组绑定 >1 元素抛 `RangeError`），
改走 raw-SQL 占位拼接。向后兼容也钉死了：`failedIds` 缺失或非数组一律视空数组，
所以已发布的 `{at, failedCount}` 两字段形态读得回。

部分索引的落点是这次 CR 里被反复纠错的地方，现在的结果是对的：
`idx_chat_session_parent` 的先例在事务内慢路径（`bootstrap` 快路径提前 return，
真实用户库永远到不了），所以新索引落在**事务外无条件段**（`:394-401`），
并以 `pragma_table_info` 前置判定「列在不在」——`content_blob` 缺失的老库跳过建索引
（那种库退回全表扫只是慢，不该让 App 起不来），但**建索引本身失败 fail loud**
（静默吞掉会让探测永久退回全表扫且无任何痕迹）。这个「同层两处只 warn、唯独这条 fail loud」
的差异化策略在注释里写了理由，是有意识的取舍不是遗漏。

实测（本机 better-sqlite3）三条 query plan 全部符合设计意图：

```
SELECT 1 ... WHERE content_blob IS NOT NULL LIMIT 1
  → SCAN chat_message USING INDEX idx_chat_message_pending_blob
SELECT COUNT(*) ... WHERE content_blob IS NOT NULL
  → SCAN chat_message USING INDEX idx_chat_message_pending_blob
SELECT rowid,id ... WHERE content_blob IS NOT NULL AND rowid > ? ORDER BY rowid LIMIT 100
  → SEARCH chat_message USING INTEGER PRIMARY KEY (rowid>?)
带 id NOT IN (?,?,?) 的探针
  → SCAN chat_message USING INDEX idx     ← 加了排除项仍走部分索引
```

最后一条尤其值得肯定：加 `NOT IN` 没有把探针打回全表扫。
且这三条都有断言钉住（`test/bootstrap/chat-message-pending-blob-index.test.ts:129`，
含批查询防回归），`message-content-compression-schema.test.ts:248-257` 还把
「快路径零 DDL」不变量按「有且仅有那条幂等部分索引 DDL」收紧了——不变量被收紧而不是被豁免。

### 5. 反向任务不挂 VACUUM：不是遗漏，是方向反转的必然（Defense-5）

正向任务挂 VACUUM 是因为压缩**释放**了页（freelist 可归还文件系统，有实打实的空间收益）；
反向任务是**增容**（明文比压缩大 2-3×），库里没有任何可归还的 freelist 页，
VACUUM 只会全库重写、白烧一次同步阻塞。文件头（`:47-51`）与收尾（`:540-543`）
两处都钉了这条，并明确写了「与正向任务的语义差异，别照抄」。

与之配套的**旧 pending 欠账清偿**（`:343-351` → `db-maintenance.service.ts:210-246`）
也是本区域的正确决定之一：历史库的 `startupMaintenancePending` 若悬空，
那一次 VACUUM 永远补不上（页空间永不回收）。而且它用的是**去重版**
`runStartupMaintenanceOnce` 而不是手动的 `runDatabaseMaintenance`——
后者不受进程级去重约束，会与 blob 归一任务叠加出双 VACUUM（76MB 量级库的同步阻塞翻倍，
正是 ic-01 要收口的事故形态）。这个「用错版本就是双 VACUUM」的知识被写进了注释。

### 6. LIKE 粗筛的守卫：召回红线优先于性能，这是正确的优先级（Defense-6）

守卫（`sqlite-message.repository.ts:105-122`）拦两类 keyword：
含 JSON 转义字符（`"` `\` C0 控制）与含任何非 ASCII 字符；不加粗筛、退回全量精筛。
`%` / `_` 不拦（只造成过宽，不违反召回红线）——这是 cr-fix-spec r4 钉死的口径，实现照办。

两条漏召回方向都堵住了，且都有**反例形状**的测试：
- JSON 转义方向（`message-search.test.ts:758`）：keyword `他说"好"`，
  `content_json` 里存的是 `\"` 转义形态，按原字符 LIKE 必然 0 命中。
- 非 ASCII 大小写方向（`:793`）：keyword `Ärger` vs 库存 `ÄRGER`，
  实测 `LIKE '%ärger%'` 命中 0 而内存判据命中。

另外粗筛面本身有效性也被钉住（`:828`）：400 行库 keyword `ancient`，
断言**每段只下发 2 行命中行**、probe 只跑 1 段 —— 证明这不是「加了但没生效」的装饰。

EXPLAIN 实测（`SEARCH ... USING INDEX sqlite_autoindex_chat_message_2 (session_id=?)`）：
加不加粗筛，session 维度都走 `UNIQUE(session_id, seq)` 自动索引，粗筛是纯粹的
谓词收紧、不改扫描路径。这点很重要——粗筛没有把「按 session 定位」变成全表扫。

### 7. batchInsert 的连接句柄运行时判定（Defense-7）

`runInTransactionOrConn`（`sqlite-message.repository.ts:91-103`）+ `:466-473` 的用法，
是 cr-fix-spec r4 抓到的那个 P0 的正解。关键在于它**没有静态假设**：
`this.conn` 可能是根连接（测试直调）也可能是 tx 句柄（生产 fork/copy 在
`conn.transaction(...)` 里用 tx 建 repo，`session.service.ts` 的 copy 与
`message.service.ts` 的 fork 都是），而三驱动契约里 tx 句柄的 `transaction()`
无条件 reject 且**不执行 fn**。照静态写法会当场打断 fork/copy，而事务外直调的测试全绿掩盖故障。

配套用例（`message-plaintext-write.test.ts:288`）复刻的正是生产路径形态
（`conn.transaction(async tx => new SqliteMessageRepository(tx).batchInsert(rows))`），
注释明说「没有这条，嵌套判定若被移除，事务外直调用例依然全绿」——
知道自己要防的是什么的那种测试。

兜底边界也在注释里钉死了：只针对 `conn.transaction()` **入口**抛出的
`NESTED_TRANSACTION`，`fn` 内部若自抛该码会被误判重跑、已执行的 INSERT 重放。
知道边界在哪，而不是假装没有。

参数按片构造、按片下发后峰值内存 O(片大小)（`BATCH_PARAM_BUILD_CHUNK = 200`），
让步语义照旧（mobile 注入 `createQuantumYield(16)` 真让出，desktop/CLI 退化为 microtask，
注释明说退化形态）——没有把「注入了 yieldFn」当成全端都有的假设。

### 8. 缓存池整体删除：兑现「复杂度最大化删除」而非「最小风险改动」（Defense-8）

`decoded-content-cache.ts` 现在只剩 `contentBodyPool` 一个池，
消息正文池与其三 API 全部消失，`clearDecodedContentCaches` 收窄为单池。
连带删掉的还有 repo 里 4 处 `forgetDecodedMessageContent` 调用——
那 4 处是「同 id 换正文必须失效」这条不变式的**全部**义务所在，
而这条不变式只对压缩形态有意义。明文化之后消息正文是明文，edit 直接覆盖 content_json，
按 id 记缓存反而成了负担。

代价是诚实的：存量压缩行的重复读退化为每次重新 inflate（文件头 `:47-51` 与
`decoded-content-cache.ts:27-35` 两处都写了），并由 T-MP6（`message-plaintext-write.test.ts:315`）
锁住「重复读结果一致」。这是 spec 实现期补充第 3 条拍板的取舍（短窗口可接受，
用户拍板清理优先），实现与拍板一致。

`codec` 侧同理：`encodeMessageContent` 零残留（实测 grep 全仓 0 命中），
`decodeMessageContent` 退化为无缓存纯函数，文件头把「四个消费方 + V1' 退役」列全。
这是 spec 明确要求的「明文为正形态，本文件仅为迁移期压缩行服务」。

### 9. 三端接线与状态行换向：换入口不换骨架（Defense-9）

| 端 | 结论 |
|---|---|
| desktop | `runDesktopMessageContentDecompressLoop` 保留 5s 守卫退避、每轮重取 runtime（rebootstrap 换连接后自然重挂）、`isConnectionClosedError` 分流（warn + 1s 退避 continue）、`stalled` 收手。注释里的三种 stalled 成因（原地打转 / 并发端抢写 / 驱动写回被拒）也列全了。 |
| mobile | 启动 3s 延迟让路首屏、runtime 身份去重（`scheduledRuntime === runtime` 不叠加循环、`.finally` 里条件复位避免抹掉新 runtime 的登记键）、stalled 收手。 |
| CLI | `syncBudgetMs: 5_000`（cr-p1 拍板：交互式进程不该被一次搬运独占一分钟），注释同步改为「解压 5s + 归一 60s、最坏合计约 65s」——**连注释一起改了**，没有留下当场变假的旧文案。 |

状态行两端同构：`MIGRATION_ROWS` 的 kind 从 `messageCompaction` → `messageDecompress`、
label「消息正文压缩」→「消息正文明文化」，DTO 与字段名同步改名
（`DbStatsResult.messageDecompress` / mobile `DbStatsSnapshot.messageDecompress`），
**不留新旧混名**。两端采样函数随改、失败降级 null 展示占位 '—'。

CHANGELOG 三处披露缺口（cr-f1）已闭合：`CHANGELOG.md:11` 一条里包含了
①状态行回退属预期 ②云同步快照/备份变大、导出与上传耗时变长 ③正文现为可直接阅读的明文。
②③ 都在，① 也在（「会变为…并短暂显示进行中，这是…正常过程，无需处理」）。

`docs/apm/RULE.md:33` 的口径与实现一致：「召回仍以内存精筛为准（LIKE 召回是独立优化项）；
纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse，keyword 含转义/非 ASCII 字符退回全量」。
spec.md:32 的边界条款也已按 cr-f14⑨ 翻转（不再是「不做 LIKE…全量精筛路径零改动」）。

### 10. 注释口径整体扫尾（Defense-10）

cr-f3 点名的五处全部改完：`chat-schema.ts:48-53`（「明文为正形态：写侧直写 content_json，
两列恒 NULL」）、`schema-column-alignments.ts:155-159`（「后台解压任务 runMessageContentDecompress」）、
`decoded-content-cache.ts`（「单会话的可见文件集」）、`db-maintenance-busy.ts:4`（「解压搬运」）。
`readRowContent` / `listBySession` / `listMessageHeadersBySession` 的注释也全部改成陈述性口径，
不再以「压缩为正形态」描述现状。

`done` 字段注释（`ipc-types.ts:1664` 与 `message-content-decompression.ts:120`）也按
cr-f2 改成「KKV 标记已置位，或谓词计数为 0；本采样不做入口自愈探测（自愈只在搬运入口）」——
两处口径一致，且**诚实说明了采样快路径不做什么**，而不是宣称做了入口那套。

`.gitignore` 补了三行（`.nm-regr-tmp/`、`tmp-*.log`、`docs/Iterations/*/cache/`），
diff 里也无 `\ No newline at end of file`（cr-f4/cr-f5 闭合）。

---

## 让步清单（拍板未覆盖或口径需收窄的残余）

> 以下不是「实现错了」，是「我知道它有边界，请上游知悉」。凡已在 spec / cr-fix-spec
> 明确登记为取舍的，标 `已登记`；未登记的标 `新残余`，建议进 backlog 或写进 RULE。

### F-d-plain-adv-1 | P2 | LIKE 粗筛的守卫只查 keyword 侧，不查 content 侧的 Unicode 折叠 | suspected

- **位置**：`sqlite-message.repository.ts:105-122`（`LIKE_PREFILTER_UNSAFE_RE`）
- **问题**：守卫拦的是「keyword 含非 ASCII」。但**非 ASCII 的 keyword 被拦住了，非 ASCII 的
  content 没有**——而内存判据 `messageMatchesKeyword`（`message-content-match.ts:44`）对
  **两端**都做 Unicode 感知的 `toLowerCase()`。SQLite 内建 LIKE 只折叠 ASCII，
  于是一类字符会漏召回：content 里含 `U+212A KELVIN SIGN`（JS `toLowerCase()` → `'k'`）
  或 `U+0130`（→ `'i̇'`）时，纯 ASCII keyword 走 LIKE 恒不命中，而内存判据命中。
- **实测**（better-sqlite3，keyword 纯 ASCII，故守卫放行粗筛）：

  ```
  kw="k"      LIKE 命中 ["c"]   JS 命中 ["a","c"]   → 漏 "a"（内容含 U+212A）
  kw="kelvin" LIKE 命中 []       JS 命中 ["a"]      → 漏 "a"
  kw="i"      LIKE 命中 ["a"]   JS 命中 ["a","b"]   → 漏 "b"（内容含 U+0130）
  ```
- **定性**：违反 spec 自订的「召回不得小于全量精筛」红线，但**方向是「少召回」而非「错召回」**，
  且触发字符罕见（Kelvin sign / 土耳其带点 I，中文小说正文几乎不会出现）。
  我不主张改实现（守卫已经覆盖了现实中 99.99% 的漏召回面，且内容侧无法在不读行的前提下判定），
  只主张**口径收窄**：spec.md:32 与 RULE.md:33 的「召回不得小于全量精筛」应补一句
  「除 content 侧含 JS toLowerCase 折叠进 ASCII 的 Unicode 字符（如 U+212A / U+0130）外」。
- **置信**：suspected（机制 confirmed，概率未评估）

### F-d-plain-adv-2 | P3 | `failedIds` 无上限，与 SQLite 绑定参数上限 32766 冲突 | suspected

- **位置**：`message-content-decompression.ts:30-33`（注释「坏行本就少量，不设上限」）、
  `:536`（`Array.from(failedKeys)` 落标记）、`:280`（探针按 id 数拼 `?`）
- **实测**：better-sqlite3 绑定参数上限为 **32766**（32766 ok / 32767 抛
  `too many SQL variables`）。
- **触发条件**：单库坏行数 > 32766。极罕见（需要大面积数据损坏），
  且触发的后果**不是数据损坏**——`hasPendingRows` 抛错被 desktop/mobile 循环的
  catch 接住（warn 后收手、下次冷启动再试），marker 未清、坏行字节原样保留。
  但那条 warn 不会明说是参数溢出，运维定位会迷路。
- **建议**：不设硬上限是对的（坏行本应少量），但在 `hasPendingRows` 外层加一句
  `catch` 把 `too many SQL variables` 翻译成「坏行清单超绑定参数上限，本次跳过自愈探测」
  的 warn，成本一行。**非阻塞，backlog 级。**
- **置信**：suspected

### F-d-plain-adv-3 | P3 | 状态采样快路径不自愈：UI 可短暂显示「已完成」而库中仍有压缩行 | intentional（已登记）

- **位置**：`message-content-decompression.ts:303-306`
- spec 实现期补充第 3 条已拍板（高频轮询面不宜每次带库查询）。实现与拍板一致，
  注释也如实写了「最多在下一个轮询窗口前显示一次『已完成』的假态」。
  **此处仅复述该取舍的可见度**，不重复提问题。窗口 ≤ 3s（`STATUS_SAMPLING_THROTTLE_MS`）。

### F-d-plain-adv-4 | P3 | mobile 调度器缺 `isConnectionClosedError` 分流 | intentional（已登记）

cr-fix-spec Open questions ④ 已登记「既有缺口非本次回归」。实测确认：
`apps/mobile/src/services/message-content-decompression.service.ts:72-77` 的 catch
是 `console.error` 后 return，本进程永久收手。一次瞬时 `SQLITE_BUSY` 就会让本进程
不再重试，靠下次冷启动自愈。desktop 侧有分流（`:110-121`），三端不对等。
**维持登记口径，不在本轮改。**

### F-d-plain-adv-5 | P3 | mobile 不传 `beforeMaintenance` / `afterMaintenance` | intentional（已登记）

cr-fix-spec Open questions ⑤。实测确认：`apps/mobile/src/services/message-content-decompression.service.ts:54-57`
只传 `syncBudgetMs` + `shouldPause`。后果是 mobile 侧消费旧 pending 时那次补跑 VACUUM
**不置 busy 信号**（desktop 置）。窗口极窄、既有形态。**维持登记口径。**

### F-d-plain-adv-6 | P3 | `decompressZlibBounded` 的体积检查在 `chunks.push` 之后，峰值可略超上限 | suspected

- **位置**：`zlib-codec.ts:73-90`
- 回调里先 `chunks.push(chunk)` 再判 `produced > maxOutputBytes`，所以峰值分配是
  「上限 + 当前这一片」而非严格不超过上限。按 4KB 切片 + deflate stored block 最坏比
  13107:1 算，单片理论产出上限约 52MB。实测那颗 73MB 膨胀炸弹 RSS 峰值 ~4MB
  （投影闸在第一片就收手），说明**常见路径没问题**；但这是「投影闸先命中」的功劳，
  不是「绝对闸严密」的功劳。
- **建议**：把 `chunks.push` 移到两道闸之后（先判再存），或在注释里补一句
  「峰值 = 上限 + 单片理论上限」。纯注释级或一行代码级，**backlog 级**。
- **置信**：suspected

### F-d-plain-adv-7 | P3 | CLI 无调度测试（三端 parity 缺口） | intentional（已登记）

cr-fix-spec Open questions ⑥（desktop ✓ / mobile ✓ / cli ✗，既有）。
实测确认 `apps/cli/src/runtime.ts:197` 的 `runMessageContentDecompress(conn, {syncBudgetMs: 5_000})`
两侧都无测试覆盖。`grep` 无 cli 调度用例。**维持登记口径。**

### F-d-plain-adv-8 | P3 | usage-stats 现算路径无粗筛面（固有全量 parse） | intentional（已登记）

`service/chat/impl/usage-stats.service.ts:521` 留了 grep 目标注释
`// 无 keyword 语义，无粗筛面：全量 parse 为固有成本`（cr-p3 改法④要求的验收 grep 目标，
已落地）。明文化后这条路径的 SQL 取字节 2-3×↑、inflate 归零，净收益，
但 parse 成为主导成本这一点无护栏。**属 spec 消费处矩阵 #3/#8 已登记的成本模型变更。**

### F-d-plain-adv-9 | P3 | 库体积回涨与云同步成本上升，只在 CHANGELOG 定性披露、未写死 +36MB | intentional（已登记）

cr-fix-spec Open questions ①（待拍板：写死数字 or 定性收窄）。
现状是定性收窄（`CHANGELOG.md:11`：「存储体积会相应回增」「云同步快照与备份文件同步变大，
备份导出与上传耗时也会相应变长」），未写死 +36MB / ≈1.5×。
**辩护立场：定性收窄是更稳的选择**（数字随用户库差异大，写死反而会被当成 SLA），
但这是**未拍板的开放项**，请上游明确落槌，别让它悬着。

### F-d-plain-adv-10 | P3 | stalled 状态行无「点击重试」显式出口 | intentional（已登记）

cr-fix-spec Open questions ③（产品决策）。当前永久 stalled 只显示「进行中（剩余 N 条）」+
console.warn，用户侧没有可见的重试入口——而 desktop/mobile 两侧的 stalled 语义都是
「本进程停手、下个冷启动再试」。若某库永久 stalled，用户能做的只有重启 app。
**属产品决策，非实现缺陷，辩护方不建议在本迭代内动。**

---

## 争议与存疑（不抹平）

1. **F-d-plain-adv-1 是「守卫设计缺陷」还是「口径表述过强」？** 我倾向前者不该改、后者该改。
   理由：内容侧是否含可折叠进 ASCII 的 Unicode 字符，在 SQL 层无法判定（要么读行、
   要么维护一张码点表），而守卫的价值恰恰在于「零成本」。改法只能是**改文档口径**。
   若上游认为红线必须字面成立，那唯一正解是**去掉 LIKE 粗筛**（回到全量 parse），
   代价是 5350 行库的搜索成本——这与 cr-p3 的立项动机直接冲突。**分歧交上游裁。**

2. **`failedIds` 清单的正确归属期。** 当前是「置标记那一轮的 failedKeys」。
   我核实过它是**充分**的：每轮游标从 rowid 0 起扫，所有仍留谓词的坏行每轮都会被重新
   撞到并重新入 `failedKeys`，所以「走到收尾」的那一轮的清单必然覆盖全部残留坏行。
   但这个性质依赖「收尾只可能在游标扫完后到达」这条不变量（`:506-512` 的注释钉的）。
   **如果将来有人加了提前 break，这份清单就会静默失准**——收尾不变量与 failedIds 完备性
   是**耦合**的，注释里没写这层耦合。建议在 `:506` 那段注释补一句。

3. **`runStartupMaintenanceOnce` 的进程级标记与「测试用例顺序纪律」耦合。**
   `message-content-decompression.test.ts:21-24` 自己写了「首条进入维护段的用例必须是
   T-MP5」。这是模块级全局状态的固有代价（正向任务同款）。辩护立场：可接受，
   但它意味着**测试文件内的用例顺序是契约的一部分**，将来任何重排都可能假红。
   已在注释登记，无需动作，只是别把它当「顺手可以重排」的东西。

4. **`blob-binary-normalization` 的 `messageContent` adapter 谓词已近乎恒空**
   （解压完成后 chat_message 行的 `content_encoding` 恒 NULL，
   `MESSAGE_PREDICATE` 永不命中）。spec 消费处矩阵 #10 与 V1' 退役清单第 4 条已登记
   「迁移完成后成死代码（V1' 删）」。辩护立场：**在本迭代内保留是对的**
   （迁移未收敛的库上它仍有真实命中），但如果有人看到「谓词恒空」想现在就删，
   会打断未收敛库的双任务收敛顺序无关性保证。**别动。**

5. **`revision-ref-count.ts:183` 的 repair 全表扫是第 4 个 decode 消费方，
   而它自己带单行解析失败跳过（`:163` 注释：期望值偏保守 = floor）。**
   这意味着在有坏行的库上，repair 全表扫算出的 ref_count 会**偏小**——
   坏行的 contentRef 统计不到。方向是「偏保守」（不误删），与 T-SR2 登记的
   「只增不减」偏差同族。辩护立场：**方向正确**（宁可少算不可多算，否则会误删 revision），
   但这是一个**未被显式登记**的偏差，建议补进 RULE 的 read 回显引用化条目。

---

## 辩护结论

**明文化链的实现是合理的，建议 L3 台账对本区域按「已闭合」处理，不开优化条目。**

理由三条：

1. **承重约束都落在了代码里而不是文档里。** 收尾不变量（`:513-524`）、
   内容合法性闸门（`:434-440`）、三列齐置（`:436`）、failedIds 排除（`:280-286`）、
   `NOT IN` 的 raw-SQL 拼接（`:269-273` 注释记了为什么不能用 `#{...}`）——
   五处都在，且每一处都配了**反例形状**的测试（替身驱动 / 内容非法行 /
   存量压缩行被编辑 / 坏行 + 标记两轮冷启动 / 三档 failedIds 长度）。
   这是「质量落在可执行断言上」的形态，不是「质量落在注释上」。

2. **CR 迭代的偏离被如实登记而非抹平。** `zlib-codec.ts:46-54` 记录了
   「照 ISIZE 判会把每一行存量压缩行都误判成炸弹」的五轮 CR 漏检 + 执行期实测勘误；
   `cr-p2` 的 r2/r3 论证前提被 r4 推翻（静态假设 → 运行时判定）；
   `runInTransactionOrConn` 的兜底边界（fn 内自抛同码会重放）写在注释里而不是假装没有。
   **能把自己的错误论证留在代码里的实现，比从不出错的实现更可信。**

3. **残余全部有边界、有方向、无静默面。** 让步清单 10 条里，5 条是 spec/cr-fix-spec
   已登记的取舍（标 intentional），4 条是 backlog 级的边界收窄
   （Unicode 折叠口径、绑定参数上限、峰值略超上限、coupling 注释），
   1 条是待上游拍板的开放项（+36MB 写不写死）。**没有一条会造成数据损坏、
   静默错召回或无痕失败。**

唯一建议上游动手的：**F-d-plain-adv-1 的口径收窄**（一句文档）、
**争议 2 的耦合注释补一句**（一行注释）、**争议 5 的偏差补进 RULE**（一条记忆条目）。
其余维持登记。

---

*本报告为对抗对·辩护人产出，仅代表本机位视角；未读 `raw/` 与 `synth/` 下任何他人报告。*
