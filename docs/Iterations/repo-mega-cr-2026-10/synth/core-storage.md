---
cluster: core-storage
sources:
  - w2-core-vfs
  - w4-vfsstore-pro
  - w4-vfsstore-adv
  - w2-core-infra-sql
  - w2-core-bootstrap
  - w3-xc-txn
counts:
  raw_findings: 116
  merged: 76
  P0: 0
  P1: 11
  P2: 17
  P3: 48
  multi_source: 17
  adversarial_rulings: 32
  disputes: 8
  handed_off_cross_cluster: 16
---

# W5 归并 · core-storage 簇（VFS 内容存储 / SQL 模板与 TDBC 底座 / bootstrap DDL / 事务边界）

> 输入 6 份（2 份测绘 + 1 组对抗对 + 2 份地基机位 + 1 份横切），原始条目 **116 条** → 合并去重后 **76 条**（P1 11 / P2 17 / P3 48）。
> 合并规则：同一病灶多源合为一条并标「多源印证」+ 来源清单；对抗对 32 条逐条裁定（升/降/驳回均写理由）；
> 事务边界同族（w3-xc-txn F-2/F-3 + w4-pro F-13）按指令归并为一条；renamePrefix REPLACE 双源印证合并。
> 严重度按合并后信息双向校准。无法裁决的进「争议上交」，跨簇条目进「移交」。

---

## 架构小结（core-storage）

**数据流：一次文件写 = 5 层，事务边界在第 4/5 层之间**

```
① domain/vfs/logic（纯函数）  computeReplaceResult / vfs-tree-copy / vfs-move / seed-live-head
      ↓ 2. domain/vfs/repositories/impl（SQL 拼装，全部经 sql-template）
   sqlite-vfs-entry（逻辑路径树，entry_id AUTOINCREMENT + UNIQUE(scope_key,path)）
   sqlite-vfs-revision（append-only 版本链，(entry_id,version) 复合 PK + WITHOUT ROWID）
   sqlite-vfs-content-store（明文 SHA-256 → zlib → BLOB，WITHOUT ROWID）
      ↓ 3. bootstrap/vfs（canonical DDL + 3 个 blob ref_count 触发器）
      ↓ 4. service/vfs/impl（事务边界：runInTransactionOrConn → conn.transaction）
      ↓ 5. service/chat|template|skills（业务编排，事务在此开与关）
```

**三处结构性事实（决定本簇大半发现的根因）**

1. **`vfs_entry` 与 `vfs_revision` 的可达性判定不对称。** `vfs_revision.ref_count`（应用层）
   判「这条历史还有没有人回滚」；`vfs_content_blob.ref_count`（SQLite 触发器）判「这份明文
   还有没有人用」，而后者**只数 revision 行，完全看不见 `vfs_entry.content_hash`**。
   任何「entry 引用 blob 但无 revision 引用它」的行（CS-07/CS-12）都会让 blob 的
   `ref_count` 常年为 0，随后任意一条同 hash revision 被删就把 blob 归零删掉 →
   **文件永久不可读**。这条是本簇最危险的耦合。
2. **path-scoped revision GC 必须 JOIN `vfs_entry` 才能圈定范围**（entry_id 化的结构性代价：
   entry 一删，scope 归属信息随之消失）。因此「先删 entry 再 scoped GC」的顺序必然恒删 0 行
   （CS-04），而唯一的兜底 `deleteGlobalOrphans` 三个调用方都不调。与 `RULE.md:108`
   实测的「VFS 多版本 delta 占 82.6%」高度吻合。
3. **事务期 = AsyncMutex 全程独占**（`transaction()` 整体跑在 `AsyncMutex.run` 内，单链 FIFO
   不可重入）。三条铁律：事务内用外层 `conn` 任何方法 → 链上自等待**死锁**（不是报错）；
   事务内用外层 `conn.transaction` → 同样死锁，`NESTED_TRANSACTION` 检查根本走不到；
   只有在 `tx` 上再开事务才立即 reject。本簇 CS-11/CS-13/CS-14 全部由这条派生。

**热点（VFS 性能问题几乎都来自「全量解压」）**

`scanContents(scopeKey, prefix?)` 一次把 scope 下**全部文件正文**解 zlib 进内存返回，
消费方 grep / ZIP 导出 / tree-copy 慢路径 / 批量导出全是「先全读再过滤」（CS-16）。
`nextUpdateVersion(known=null)` 走 `findByPath` → `resolveEntryPlainContent`，
为拿 entryId+version 而解全文（CS-13）。`expandAnchorHunk` 每轮对全文 `indexOf`（CS-17）。
`longest-common-substring` 分配 `(old+1)×(file+1)` 稠密矩阵（CS-03）。

**索引现状**：`vfs_entry` 只有 `idx_vfs_entry_scope_path(scope_key, path)`；
`vfs_revision` 只有 `idx_vfs_revision_entry(entry_id)`。**`content_hash` 两表皆无索引**，
而 `SqliteVfsContentStore.gc()` 是本区唯一按 content_hash 做集合运算的语句（CS-19）。

**SQL 底座（`infra/sql-template` + `infra/tdbc`）**：自研 MyBatis 风格动态 SQL
（parser 428 行 + evaluator 137 + expression 161 + tags）。**动态标签
（`<if>/<where>/<trim>/<choose>/<foreach>`）在生产代码零使用**，生产动态性全靠 TS 侧
字符串拼接 + `${}` 内联 —— 约 900 行已实现、已测试、已导出到主入口的子系统当前未被使用。
`TemplateParser.astCache` 以整条模板串为 key 且**无上界无淘汰**，而生产仓储普遍用变长
arity 拼 `#{id0}..#{idN}`，每种 arity 一条永久缓存条目（CS-13'，本簇内存问题第一名）。

**bootstrap DDL 层**：`SCHEMA_BOOT_VERSION = 17`、16 个 DDL 模块、21 条
`SCHEMA_COLUMN_ALIGNMENTS`、6 条 `SCHEMA_MIGRATIONS` —— 本轮逐条对账**无缺**，20 张被
repository 层 `FROM` 到的表全部有 canonical 建表语句。问题在**守卫缺失**（加列忘 bump
无任何测试能拦，CS-28）与**导出面治理缺口**（25 个子路径只有 12 个有 allowlist 快照，
CS-27），不在 schema 本身。

**刻意保留、不计缺陷的（登记备查）**

| 项 | 出处 |
|---|---|
| VFS write/edit 无锁 last-write-wins、pathTail 两处盲区 | RULE「VFS write/edit/skill 工具的并发语义」（用户 2026-09-06 拍板，`60af90b` 拆乐观锁） |
| `vfs_revision.ref_count`（应用层）与 `vfs_content_blob.ref_count`（触发器）双计数器并存 | `service/integrity-repair.ts:17-27`（T-SC5 裁决「并存不矛盾，绝不强行合一」） |
| `content_hash → 遗留明文 → 抛错` 三段式读路径 | `resolve-stored-content.ts:47-61`（对齐「明文行永远合法」口径） |
| `vfs_entry.content` 遗留明文列保留不删 | `bootstrap/vfs/vfs-schema.ts:6-7`（§A）+ w4-pro F-31 主动标注 intentional |
| `scanContents` 缺 blob 必抛，但 decoded-content 池热态可静默成功 | `decoded-content-cache.ts:26-29` 明确写的生产取舍 |
| `computeEntrySignature` 不过滤 `entry_kind` | `vfs-entry.port.ts:213-215` doc |
| `deleteRecursiveIfAny` 的「探测→删除」非原子 | `sqlite-vfs-entry.repository.ts:530-532` 注释 |
| ZIP 构建用 STORE（level 0）不压缩 | `vfs-zip-build.ts:25`（移动端 deflate 阻塞 JS 的实测结论） |
| `${...}` 原样内联无转义 | `sql-template/index.ts:49-52` + `index.ts:7` 明写「调用方自行校验」；**w2-core-infra-sql 已逐条核实 24 个生产消费文件全部为编译期常量，负结论** |
| `randomUUID` 第三级降级到 `Math.random` | `random-uuid.ts:13-14,35` 自陈「not cryptographically strong」；消费方全是 id 生成，无安全 token |
| `parseText` yaml `__proto__` 为自有键非原型污染 | w2-core-infra-sql 实测（`JSON.stringify` 可打印即证明未污染） |
| VACUUM/checkpoint 维护链直调 `conn.execute` 不包事务 | RULE:72（SQLite 拒绝事务内 VACUUM） |
| `isStorageRootParent` 恒 false 但**当前行为正确** | 见 CS-36：逻辑路径下不存在虚拟 storage root，恒 false 恰是 entry_id 化想要的结果 |

---

## 台账

### P1（11 条）

| ID | 症状 | 位置 | 多源 | 对抗裁定 | 一句话修法 |
|---|---|---|---|---|---|
| **CS-01** | **目录前缀 rename 用 SQL `REPLACE()` 全串替换 → 子路径里再次出现同名段时被二次改写，路径静默损坏**（`/a/sub/a/deep.md` → `/b/sub/b/deep.md`，无报错、UNIQUE 不冲突、checkpoint 无感，用户直到 read 失败才发现） | `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:936` | ✅ 2 源印证（w2 F-1 实测复现 + pro F-1 推理） | **upheld（P1，双源）**。pro 争议 1「未跑复现」被 w2 的 better-sqlite3 实测消解；`WHERE ... LIKE` 只约束行集合不约束替换位置，机理成立 | `SET path = #{newWithSlash} \|\| substr(path, length(#{oldWithSlash}) + 1)`；补「子树含同名目录」回归用例（现 `test/vfs/vfs-rename-primitive.test.ts` 只覆盖 `%_` 转义） |
| **CS-02** | **`replaceAll` 且 `oldString === ""` 时死循环 + OOM**：`"abc".indexOf("", 0) === 0` → `searchFrom = idx + 0 = 0` 永不推进，`positions` 无限增长。上游 `vfs-tools.ts:297` 的 `oldString: z.string()` **无 `.min(1)`**（对比同文件 `path: z.string().min(1)`），LLM 一次 `edit(oldString:"", options:{replaceAll:true})` 即可挂死会话线程。非 replaceAll 分支亦把 `newString` 静默拼到全文头部 | `domain/vfs/logic/compute-replace-result.ts:55-60`；`domain/tool/builtin/vfs-tools.ts:297` | 单源（对抗双方均漏） | **upheld（P1）**。已核 `git grep computeReplaceResult` 确认 `vfs.service.ts:143` / `revision-aware-vfs.service.ts:107` / `skills.service.ts:392` 三条直调路径无任何拦截 | 入口加 `if (oldString.length === 0) throw vfsReplaceNotFound(...)`；`oldString` 补 `.min(1)` 对齐 `path` |
| **CS-03** | **`buildReplaceNotFoundError` 无条件分配 `(oldLen+1)×(fileLen+1)` 稠密 `number[][]` + `Math.min(...endsInB)` 栈溢出**：oldString 300/正文 300k → 堆涨 591MB；`oldString="---"` × 15 万 `-` → `RangeError: Maximum call stack size exceeded`（非 `VfsError`，穿透 `formatVfsErrorForLlm` 直冒工具层） | `domain/vfs/logic/longest-common-substring.ts:52-54, 76`；`logic/compute-replace-not-found-error.ts:55` | ✅ 2 源印证 | **upheld（P1，双源）**。w2 争议 1 提出的「是否有尺寸闸」已核：`vfs-tools.ts` 只对**输出**限流（`TOOL_OUTPUT_MAX_BYTES=50KB`），对输入正文无闸 → 路径确实可达 | DP 换滚动两行（O(min) 空间）+ `Math.min(...endsInB)` 换循环 + 超阈值降级为「不做 LCS 只回基础诊断」（照 `character-card-limits.ts` 闸门范式） |
| **CS-04** | **`sweepRevisionsUnderScope` 三步顺序错，scoped revision GC 恒删 0 行**：`deleteUnreferencedUnderScope` 靠 `JOIN vfs_entry` 圈定 scope，而上一步刚把 `vfs_entry` 行删光 → JOIN 恒空。留下的 ref=0 孤儿 revision 又被 `gc()` 的 `NOT IN` 视为「仍被引用」，blob 一并钉住。三个调用方（`initialize-session-workspace.ts:37` / `push-session-workspace.ts:32` / `skills.service.ts:440`）**都不调 `deleteGlobalOrphans`** → 每 pull 一次模板 / push 一次 / 删一个技能就永久留一整代 | `domain/vfs/logic/vfs-tree-copy.ts:397-410`；`repositories/impl/sqlite-vfs-revision.repository.ts:604-614` | 单源（pro F-2），**已核代码确认** | **upheld（P1）**。同仓 `revision-aware-vfs.service.ts:236-237` 的 hardDelete 注释「删 entry 前先 sweep（此时 entry 仍在可 JOIN）」= 代码库自己知道这个顺序约束 | 把 `deleteUnreferencedUnderScope` 挪到 `deleteVfsPrefix` **之前**（与 hardDelete 对齐），或末尾补 `deleteGlobalOrphans()`。前者更省（限定 scope） |
| **CS-05** | **ZIP 导入 5000 文件 / 角色卡 5000 文件 / 批量 ingest N 文件 = 单事务 + 逐条写 + 事务内叠 `backfillBaselineCheckpoints` 全量扫消息**。每文件约 5 条语句（`findByPath`→`insert`(含 zlib)→`findByPath`→`findContentHash`→`append`），最坏 2.5 万条语句 + 32MB 全量压缩在一个事务里。`RULE.md:26` 记的移动端 disk I/O 根因正是「大事务」 | `service/vfs/impl/vfs-zip-io.service.ts:199-244`（+`:233-243` backfill）；`service/vfs/impl/character-card-import.service.ts:140-182`；`service/vfs/impl/vfs-batch-io.service.ts:291-305` | ✅ 3 站点归并（xc-txn F-2 + F-3 + pro F-13，按指令同族归并） | **upheld（P1）**。xc-txn 争议 2 保留：闸门值未经事务时长验证是**风险**而非已观测故障；pro F-13 独立算出 3N 次往返佐证 | 分片提交（每 200 文件一个短事务，对齐 `batchInsert` 口径）；delete-prefix 单独先行；`backfillBaselineCheckpoints` 挪到导入事务**之后**（与导入内容无原子耦合）；ingest 侧复用 `batchInsertFileEntriesWithHash` / `findContentHashesByPaths` |
| **CS-06** | **`vfs-batch-io.writeOrUpdateFile` 绕过 `RevisionAwareVfsService`，不 append revision、不动 ref_count** → `vfs_entry.head_version` 指向 `vfs_revision` 里不存在的版本。`findMissingRevisionPointers` 只在 checkpoint 指针路径上跑，**不会**发现 head 悬空（无安全网）。后续任一 checkpoint 钉住该 head → `incrementRefsForCheckpointFiles` 抛 `VfsError NOT_FOUND: Revision not found`；再正常 write 一次则 `transferLiveRef(-1)` 打在不存在的行上静默 no-op，真 head 的 ref 停在 1 → **该 revision 与其 blob 永久不可回收**。注释「无 revision 层」只对 `DefaultVfsService` 成立，对 project/global 域是错的 | `service/vfs/impl/vfs-batch-io.service.ts:100-101, 94`；`apps/desktop/src/main/services/vfs-batch.service.ts:210-226`（**已核**：非 session scope 全部走 `applyBatchIngest`） | 单源（pro F-4），已核代码 | **upheld（P1）** | `writeOrUpdateFile` 改走 `RevisionAwareVfsService`（或 `insertFileSeedingRevision`），保证 head 与 revision 同步 |
| **CS-07** | **blob ref_count 触发器不感知 `vfs_entry` 引用 → 归零误删共享 blob，文件永久不可读**。`vfs_content_blob.ref_count` **只由 revision 触发器维护**，`vfs_entry.content_hash` 这一路引用完全不可见。CS-06 / CS-12 造出的「entry 有 hash 但无 revision」行使 blob 的 `ref_count` 常年为 0，此时**任何**一条引用同 hash 的 revision 被删，触发器归零判定就把 blob 行删掉。内容寻址使同 hash 共享极可能（`RULE.md:108` 实测去重省 61.3%）→ 共享方之一被删 revision → 另一条 entry 的 read 抛「vfs_content_blob 缺失」，**只能重新导入**。`decoded-content-cache` 的 LRU 会在同进程内掩盖（模块头写明「热态静默成功」）→ **重启后才暴露** | `bootstrap/vfs/vfs-revision-schema.ts:45-54`（DELETE 触发器）；`content-store/impl/sqlite-vfs-content-store.ts:98, 213-217` | 单源（pro F-8） | **upheld（P1，但触发前提依赖 CS-06/CS-12）**。pro 争议 2 自陈「修 F-3/F-4 能消掉大部分触发条件」——**采纳为修复顺序约束**：先修 CS-06/CS-12，本条降为纵深防御 | DELETE 触发器加 `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)`；或在 entry 侧建引用触发器 |
| **CS-08** | **`vfs-batch-io.planBatchExport` 单文件分支用 `basenameOf` 而不走 `exportRelativePath`** → 桌面端多选导出 `/卷一/第一章.md` 与 `/卷二/第一章.md` 时，第二条被 `seenFileRels` 静默丢弃。**导出 ZIP 里少一个文件，报告里无 `skipped`、无 `failed`、UI 无任何提示**。中文工程同名卷章极常见 | `service/vfs/impl/vfs-batch-io.service.ts:399-406`（对比同文件 `:164-178` `exportRelativePath`、`:412/:426` 目录分支） | 单源（pro F-7），已核代码 | **upheld（P1）**。静默丢用户数据 + 零提示 = 数据损失类最高优先级 | 文件分支改用 `exportRelativePath(childLogical, logical, selectionCount)`，与目录分支统一 |
| **CS-09** | **ZIP 解析期无体积/条数闸（闸门在解压之后，来不及保护）**：`parseZipCentralDirectory` 逐条 `inflateSync` 并把全部结果收在 `entries[]` 返回，全程无闸。`VFS_ZIP_MAX_ENTRY_COUNT=5000` / `MAX_UNCOMPRESSED_BYTES=32MB` 在 `vfs-zip-validate.ts:17-18,196-207`，而 `validateVfsZipEntries` 的入参**已经是解压完的 Map**（`vfs-zip-io.service.ts:189` parse → `:191` validate）。`uncompressedSize` 由攻击者填（只要不是 `0xffffffff` 就不触发 ZIP64 断言）→ 几百 KB 的 zip 可让 `inflateSync` 分配 GB 级；`totalEntries` uint16 最多 65535 条全留在数组 → 移动端 OOM。fflate 回退分支（`vfs-zip-parse.ts:23-36`）同样无闸 | `domain/vfs/logic/vfs-zip-central-dir.ts:88-108`；`service/vfs/impl/vfs-zip-io.service.ts:189-192` | 单源（pro F-6），已核调用顺序 | **upheld（P1）**。第二入口 `domain/skills/logic/preview-skill-zip.ts:35`（status.md core-skills 独立记载同款「技能 ZIP 预检无解压闸门」） | 解析器内累加 `uncompressedSize` / `totalEntries`，越 `VFS_ZIP_MAX_*` 立即抛 `PAYLOAD_TOO_LARGE`；或改为流式：先只读中央目录做闸门，通过后再解压 |
| **CS-10** | **`sql-template` AST 缓存无上界无淘汰，内存单调增长到 OOM**：`TemplateParser.astCache` 以整条模板串为 key。生产仓储普遍用变长 arity 拼模板（`sqlite-message-checkpoint.repository.ts:401` `messageIds.map((_,i)=>'#{id'+i+'}')`、`:120/:382`、vfs entry chunk 200、session-kkv chunk 400）→ 每种 arity 一条**永久**缓存条目，条目本身大小随 arity 线性增长。实测：2000 arity → 337MB；3000 → 739MB；8000 → **进程 OOM（exit 134）**。分片只保证单次调用 arity 有界，不保证不同调用的 arity 集合有界（最后不满片长度可是 1..199 任意值） | `infra/sql-template/parser.ts:45-53` | 单源（infra-sql F-1），代理本机实测 | **upheld（P1）**。注释 `:43`「模板字符串通常数量有限（来自配置）」在生产**前提不成立**——这不是取舍是描述错误 | 最彻底：变长 arity 模板改固定 `?` 位置参数（`buildInBindings` 已在按 arity 生成名字，改成纯 `?` 拼接即可让模板串恒定）；最小：模块级共享 + LRU(256)。**注意与 CS-11 同族**（都在压事务/连接占用）但根因不同 |
| **CS-11** | **`session.service.copy` 事务内全量消息解压**：`conn.transaction` 回调内 `listBySession` 选含 `content_blob` 的列并逐行解压，随后 `batchInsert` 又对每条重跑 `encodeMessageContent` 同步 zlib → 一次 copy = 解压 N 次 + 压缩 N 次，全程独占 mutex。同段 `fork` **已治过**（`message.service.ts:293` 把 list 提到事务外），copy 是漏网的那个。仓库已有 `listMessageHeadersBySession` 现成解 | `service/chat/impl/session.service.ts:338, 374` | 单源（xc-txn F-1），已核 `listBySession` 在事务内 | ** upheld（P1，但 owner = core-data，见移交表）**。xc-txn 争议 1 自陈「若台账按数据风险定级应降 P2」——**裁决维持 P1**：定级看用户可感知劣化频率（复制会话是主动高频操作，且 fork 已治 copy 未治是明确的不对称缺陷），不产生脏数据不构成降级理由 | `listBySession` 换 `listMessageHeadersBySession` + 事务外取 body 段；或让 `batchInsert` 走 `INSERT...SELECT` 直接复制 blob 列 |

### P2（17 条）

| ID | 症状 | 位置 | 多源 | 裁定 | 修法 |
|---|---|---|---|---|---|
| **CS-12** | **`copyVfsTree` overlay 分支只抬 `head_version` + 换 `content_hash`，既不 append revision 也不做 live ref 转移** → 旧 head revision 持 `ref_count=1` 永不释放（`deleteUnreferencedUnderScope` 要 ref≤0、`deleteGlobalOrphans` 要 ref≤0，都够不着），并经 DELETE 触发器把 blob 钉住；新 head_version 在 `vfs_revision` 里根本没有行，`decrementLiveRefsUnderScope` 的 −1 静默 no-op | `domain/vfs/logic/vfs-tree-copy.ts:243-260` | 单源（pro F-3） | **降 P1→P2（潜伏）**。理由：四个生产调用方（`session.service.ts:366` / `message.service.ts:334` / `project.service.ts:263,271`）目标都是全新空 scope，`replaceVfsSubtree` 先 sweep 删空目标也走不到 → 当前不可达。但这是本区唯一「改 head_version 却不建 revision」的公共 API，一旦被复用做 overlay 即引爆，且会直接喂养 CS-07 | 该分支补 `revisionRepo.append` + `transferLiveRef(old,new)`；或 `nextUpdateVersion` 命中「目标已存在」时直接抛错拒绝 overlay |
| **CS-13** | **tree-copy 全量解码双点**：(a) `nextUpdateVersion(known=null)` → `findByPath` → `resolveEntryPlainContent` **解出全文正文**，仅为拿 entryId+version；(b) 慢路径 `resolvePlainContentMap` → `scanContents` 把 scope+prefix 下所有文件解成明文进 Map，而四个调用方**全在事务内** | `domain/vfs/logic/vfs-tree-copy.ts:247-253, 73`；`:263, 303` | ✅ 2 源（w2 F-4 + xc-txn F-4） | **upheld（P2，双源）**。w2 争议 2 确认 (a) 只在模板 push / project 模板覆盖时触发（fork/copy 走空 scope 快路径）→ P2 而非 P1；(b) 叠加事务独占 → 修法必须同时解两个 | (a) 快路径改用 `scanFileEntriesWithMeta` 一次拿齐 entryId→headVersion 当 `known`；(b) `scanContents` 挪到事务外（源侧只读，事务内重读无一致性收益） |
| **CS-14** | **port JSDoc 与实现相反：文档承诺「嵌套 `transaction` 抛 `NESTED_TRANSACTION`」，实测在事务回调里调**外层** `conn.transaction` 是死锁不是报错**（`AsyncMutex` 单链 FIFO 不可重入，`NESTED_TRANSACTION` 检查根本走不到）。这是协议层唯一契约声明处，驱动实现者会照它写出错误代码 | `infra/tdbc/ports/connection.port.ts:37`；`packages/tdbc-driver-better-sqlite3/src/connection.ts:47, 204-212` | ✅ 2 源（infra-sql F-2 + xc-txn 铁律表独立确立同一锁语义） | **降 P1→P2**。理由：死锁行为本身已被 `RULE.md` 记为已知陷阱（intentional），缺陷仅在文档表述；作者自陈「接受降为 P2」，我采纳 | 改 port JSDoc 写清三种情形；或 `BetterSqlite3Connection.transaction` 进 `mutex.run` 前加 `if (this.inTransaction) throw NESTED_TRANSACTION`（锁外做，小竞态窗口但优于死锁） |
| **CS-15** | **`readOpenTagHeader` 用首个 `>` 结束标签头、不感知引号** → `<if test="count > 0">` / `n >= 2` / `test="a > b"` 全部抛 `SqlTemplateError: Malformed attributes on <if>`，报错文案完全指错方向 | `infra/sql-template/parser.ts:223` | 单源（infra-sql F-3） | **降 P1→P2（潜伏）**。已核生产零使用：24 个消费文件 + 全 `packages/core/src` 的动态标签扫描全空，生产动态性全靠 TS 侧拼接。但该能力**已导出到主入口**（`index.ts:9-16`），任何人第一次写 `<if test="a > b">` 都会踩 | `readOpenTagHeader` 改引号感知扫描（`"`/`'` 内跳过 `>`），约 15 行 + 回归用例 |
| **CS-16** | **grep 的 `pathGlob` 留在应用层过滤，而 `scanContents` 已把整个 scope 正文全量 inflate 进内存**：一次 `grep "**/*.md"` 把会话工作区几百 KB~几 MB 正文全解一遍再丢掉 90%；`resolveScanRows` 任一 blob 缺失直接抛 → 一个坏文件让整个 scope 的 grep 失败。`matchGlob` 同一谓词在 `scoped-vfs.service.ts:121` / `DefaultVfsService.grep:185` **重复三遍**；`vfs-grep.ts:171-177` 在 `contextLines>0` 时对同一行每个命中列重算 `buildExcerpt` | `service/vfs/impl/vfs.service.ts:179-190`；`repositories/impl/sqlite-vfs-entry.repository.ts:685-726, 852-898` | ✅ 2 源（w2 F-5 + pro F-15） | **upheld（P2，双源）** | `pathGlob` 在有 `pathPrefix` 时下推成更窄 LIKE 前缀；`matchGlob` 收敛成一处；`buildExcerpt` 提到列循环外 |
| **CS-17** | **`expandAnchorHunk` 每轮对全文做一次 `countOccurrences`，片段长度随 radius 线性增长 → 单 hunk O(radius×filesize)，最坏 O(n²)**。实测 2k 行 16KB→23ms；5k 行 40KB→119ms；**1 万行 80KB→462ms**。这是**用户点保存**的同步路径（mobile UI 线程），`mapUserSaveToToolUses` 对每个 diff region 各调一次 | `domain/vfs/logic/user-vfs-save-mapping.ts:143-157, 213` | ✅ 2 源（w2 F-6 + pro F-14） | **upheld（P2，双源）**。pro 补充了 fallback 分支已存在（`:220-227`），修法成本低 | 对 baseline 做一次预索引（逐行 hash→计数）；或指数扩张 radius（1,2,4,8…）+ 封顶后落 `anchor-not-unique` → write 兜底 |
| **CS-18** | **`copyVfsPath` 复制空目录恒失败**：`vfs.read(from)` 对目录抛 `IS_DIRECTORY` 被 `:42` 吞掉 → `list` 返回 `[]` → `hasDirRow` 恒 false（`sqlite-vfs-entry.repository.ts:79` 的 SQL 是 `path LIKE '<dir>/%'`，永不含目录自身）→ 抛 `vfsNotFound`。`fs cp -r /空目录 /新目录` 必失败。对照 `moveVfsPath:191-197` 专门用 `sawDirectoryRow` 处理了同一场景并有注释 —— **cp 与 mv 对空目录行为不一致，cp 侧是漏修** | `domain/vfs/logic/vfs-copy.ts:34-53`；`domain/tool/logic/fs-command.ts:208` | 单源（pro F-10） | **upheld（P2）**。已核 `vfs-copy.ts:34-45` 确实把 `IS_DIRECTORY` 与 `NOT_FOUND` 一同吞掉 | `vfs.read` 捕到 `IS_DIRECTORY` 时即视为「目录存在」，删掉 `hasDirRow` 死代码 |
| **CS-19** | **blob GC 每次对 `vfs_entry` ∪ `vfs_revision` 全量物化再取补集，且两表 `content_hash` 皆无索引**：`NOT IN (subquery)` 为子查询建临时 B-tree；`vfs_revision` 是全仓最大表；`runDeferredBlobGc` 挂在 6 条热路径上（删消息/删项目/删会话/模板拉取）每次全表扫一次。`vfs-schema.ts:28` 只建 `idx_vfs_entry_scope_path` | `content-store/impl/sqlite-vfs-content-store.ts:207-221`；`bootstrap/vfs/vfs-schema.ts:28`、`vfs-revision-schema.ts:30` | ✅ 2 源（pro F-11 + adv F-3） | **upheld（P2，双源）**。adv 争点 4 主张「未写理由的遗漏是遗漏不是取舍」——**采纳**：三份 DDL 常量确无 content_hash 索引，而 `gc()` 是本区唯一按 content_hash 做集合运算的语句，对比 `vfs-schema.ts:31-36` 对「为什么不再建具名索引」有完整说明。adv 提供的反驳（deferred 只压频率不压单次代价）成立 | `DELETE ... WHERE ref_count <= 0 AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = vfs_content_blob.content_hash)`（blob 是 WITHOUT ROWID + content_hash PK，驱动走主键 seek）；entry 侧加 `(content_hash)` 索引。**不能省掉 entry 侧判定，否则踩 CS-07** |
| **CS-20** | **并发写同文件：revision append 撞 `PRIMARY KEY(entry_id, version)` 抛裸 `TdbcError`（不是 `VfsError`，不经过 `formatVfsErrorForLlm` 分类，用户/模型看到 SQLite 原文）；且 `applyContentHashUpdate` 的回查在真并发下返回**别人**写的版本号，再被拿去 `transferLiveRef` → 引用计数打在错误行上** | `service/vfs/impl/revision-aware-vfs.service.ts:398-412, 405-412` | 单源（pro F-12） | **upheld（P2，边界已划清）**。pro 争议 4 立场正确：并发语义本身是 RULE:83 拍板接受的 intentional，本条报的是**次生效应**——失败不是「后写覆盖先写」这个被接受的语义，而是硬失败 + 裸 SQL 文案 + 新引入的「覆盖写回 + 二次读」第三种行为，措辞未覆盖 | revision append 的 UNIQUE 冲突翻译成 `VfsError CONFLICT`；`applyContentHashUpdate` 改 `UPDATE ... RETURNING head_version` 或直接用调用方传入的 `nextVersion`，不二次读 |
| **CS-21** | **补偿回滚遇 entry 已被 hardDelete 时抛 `MutatingPathRestoreCompositeError`，文件永久丢失而非恢复**：`restoreDirectorySnapshot` 对快照内每个文件调 `resetHeadToVersion`，而 `resetHeadToVersion:170-177` 在 entry 行缺失时直接抛 NOT_FOUND，**补偿路径没有「entry 没了就 revive」分支**。快照类型本身有 `kind:"present"` 承载 content（设计时就考虑了内容在手），但 restore 侧只用了 version 没用 content | `domain/vfs/logic/restore-mutating-path-heads.ts:178-180, 219-221` | 单源（pro F-18，suspected） | **upheld（P2，置信 suspected）** | `present` 快照已存 content，回滚时 entry 缺失就按 content 走 `reviveEntryAtVersion` + `setHeadContentHash`，与 `domain/message-checkpoint/logic/revive-deleted-entry.ts` 既有做法对齐 |
| **CS-22** | **`renamePathInScope` / `renamePrefixInScope` 的 UPDATE 谓词没有目标占用条件**：`assertMoveTargetAvailable` 是咨询式检查，代码自己在 `vfs-move.ts:173` 写下 WHY「fail before write so a rename conflict cannot overwrite the target」——意图是真的，机制是尽力而为。真实损害是**错误类型退化**：并发撞车时因 `UNIQUE(scope_key,path)` abort，调用方拿到裸 `SQLITE_CONSTRAINT` 而不是已正确构造好的 `vfsAlreadyExists(to)`，上层无法走「目标被占」友好提示分支 | `domain/vfs/logic/vfs-move.ts:96-139, 173`；`repositories/impl/sqlite-vfs-entry.repository.ts:912-914` | 单源（adv F-4，辩护人主动让步项） | **upheld（P2）**。adv 明确「不掩盖」：DDL 约束保证了不会静默覆盖，剩下的是错误类型与提示链路 | `renamePathInScope` / `renamePrefixInScope` 增加目标存在性前置判定抛 `VfsError("ALREADY_EXISTS")`；或在 `moveVfsPath` 的 catch 里把约束错误翻译回 ALREADY_EXISTS。**检查前置于写（现有顺序）应保留** |
| **CS-23** | **`seedForkCopyParity` 只判 `meta == null` 就无条件落 `status:"active"`**，`contentHash` 为 null 时撞 `vfs_revision` 的 `CHECK (NOT (status='active' AND content_hash IS NULL))` → 整个 fork/copy 事务回滚。**语义完全平行的 `seed-live-head-revisions.ts:78` 做了降级保护**（`contentHash != null ? "active" : "deleted"`）——两份并行实现，一份防了一份没防，是实现漂移 | `domain/chat/logic/seed-fork-copy-parity.ts:99-100`；`domain/vfs/logic/seed-live-head-revisions.ts:78` | 单源（adv F-1，辩护人主动让步项） | **upheld（P2）**。失败模式是硬约束 abort 而非静默 | 两处共用一个 `deriveRevisionStatus(contentHash)` 纯函数；`seedForkCopyParity` 补同一行三元判定 |
| **CS-24** | **`vfs-grep` `matchMode:"auto"`（默认）把模型给的 pattern 直接 `new RegExp`**，编译成功但灾难性回溯的 pattern（`(a+)+b`）在长行上长时间阻塞；`matchColumns` 对单行无限收集命中列无上限；`escape`/长度/命中数三重闸门都没有。pattern 由 LLM 决定、在 UI 线程同进程（Hermes）里执行 | `domain/vfs/logic/vfs-grep.ts:39-42, 59-64, 72-83` | 单源（pro F-16，suspected） | **upheld（P2，置信 suspected）** | `auto` 模式加「简单性」判定（只允许字面量/简单字符类）；`regex` 模式加长度与命中数上限；`matchColumns` 加 `maxColumns` |
| **CS-25** | **`hasSessionEntries` 对每个会话发一次前缀查询**，`listSessionsUnderProject:313-320` 用 `Promise.all` 并发跑，`sessionsTreeRows:508-530` 在 BFS 循环里**串行**逐个跑；`listTree("/")` 还会为每个项目跑一遍。N 个会话（含子 agent 会话）的项目打开 `/projects/{pid}/sessions` 就是 N 次全前缀扫描 | `service/vfs/impl/physical-vfs.service.ts:284-293, 313-320, 440-448, 508-530` | 单源（pro F-17） | **upheld（P2）** | 一条 `SELECT scope_key, COUNT(*) FROM vfs_entry WHERE scope_key IN (...) GROUP BY scope_key` 批量判定；或用 `computeEntrySignature` 那样的单行聚合 |
| **CS-26** | **`bootstrap/skills/seed-builtin-skills.ts ⇄ service/skills/impl/skills.service.ts` 三文件 import 环**：`BUILTIN_SKILL_NAMES` 这一个常量让 service 层反向依赖 bootstrap 层，`skills.service:33 → seed-builtin-skills:24 → create-skills-service:9 → skills.service` 成环。同一常量经 `public/skills.ts:37` 再导出 → 任何 import `@novel-master/core/skills` 的消费方（含 mobile）都会把 seed 模块（90 行 `AGENT_CONFIG_SKILL_MD` + 整个 service 装配图）拉进模块图。今天不炸的唯一原因是环上两侧绑定都只在函数体内使用 | `service/skills/impl/skills.service.ts:33`；`bootstrap/skills/seed-builtin-skills.ts:24`；`service/skills/create-skills-service.ts:9` | 单源（bootstrap F-1） | **upheld（P2，三条 import 已核）**。status.md 裁决记录：本条实锤后**已撤回 L0「madge core 零循环」结论**（别名未解析致假阴性） | `BUILTIN_SKILL_NAMES` 下沉到 `domain/skills/model/builtin-skill-names.ts`，`seed-builtin-skills` 与 `skills.service` 都从 domain 引入，`public/skills.ts` 同理。一次改动同时消环 + 断 public→bootstrap 层依赖 |
| **CS-27** | **导出面 allowlist 快照只覆盖 12 个子路径 + 主入口，`package.json#exports` 里另外 13 个无任何快照**（`./common` `./format` `./kkv` `./session-kkv` `./session-run-state` `./skills` `./config-forms*` `./tdbc` `./sksp` `./nmtp`）。实测为死的 3 个 `@deprecated` config-forms 导出、2 个 `CURRENT_*_SCHEMA_VERSION` 全都在**无快照覆盖的子路径**里——治理缺口与死代码分布高度重合 | `packages/core/test/package-exports/public-subpath-allowlist.test.ts:5-18` | 单源（bootstrap F-3） | **upheld（P2）**。已核受控的 13 条全部 pass，快照本身不坏，缺的是覆盖面 | `SUBPATHS` 改成从 `package.json#exports` 动态派生（`Object.keys` 过滤 `.`）；`tdbc`/`sksp`/`nmtp` 若有意排除，在测试里显式列 DENY 名单并注明原因 |
| **CS-28** | **`SCHEMA_COLUMN_ALIGNMENTS` 加列必须 bump `SCHEMA_BOOT_VERSION`（三件套）这条 RULE 硬规则无任何机械化守卫**：现有锚点断言按迭代手写，能挡「回退 BOOT_VERSION」，但**挡不住「加了第 22 条 ALIGN 却忘了 bump」**——那时 BOOT 仍是 17 ≥ 17 全绿，而存量库永久缺新列，正是 RULE 记的那次 `no such column` 事故形态。历史已因此出过两次真机事故（v9 `first_token_ms`、v10 `provider_id`） | `bootstrap/schema-align/schema-column-alignments.ts:19`（21 条） | 单源（bootstrap F-4） | **upheld（P2）**。本轮逐条对账：21 条 ALIGN 与 `novel-master-bootstrap.ts:54-115` 的 v8→v17 版本注释链**一一对得上，当前合规** —— 报的是「未来会漏」而非「现在已漏」 | 给 `SchemaColumnAlignment` 加 `sinceBootVersion: number`，写一条数据驱动测试断言 `SCHEMA_BOOT_VERSION >= max(entries.map(e=>e.sinceBootVersion))`。ALIGN 的测试无 DB 依赖、BOOT_VERSION 已从主入口导出，接线零成本 |

### P3（48 条）

按主题成组，组内逐条给位置与修法要点。

| 组 | 条目 | 位置 | 来源 / 裁定 |
|---|---|---|---|
| **G1 动态 SQL 标签子系统的潜伏缺陷**（生产零使用，已导出到主入口） | ① `isTagStart` 把正文里 `<标识符>` 误判为未知标签（`LIKE '%<b>%'` 直接抛错）；② `FORBIDDEN_PATTERN` 可被 `a['con'+'structor']` 绕过（黑名单跑在 `bindExpressionToContext` 之后，而后者只改写点号路径、下标访问不经过改写）——**是一道可绕过的沙箱，不是安全边界**；③ `<where>` 分支先 push 参数再判断 SQL 是否被丢，`ParseOptions.placeholder=""` 时产出参数/占位符 arity 失配 | `infra/sql-template/parser.ts:84`；`expression.ts:9, 39, 103-116, 142`；`evaluator.ts:78-81` | infra-sql F-4/F-6/F-8。**裁定**：② 需在注释里把「禁用词防护」改写为「非安全边界，仅防手滑」并写明「test 表达式必须来自源码常量模板」；③ 把 push 参数移到 `wrapped` 非空判断之后。三条均**依赖争议 #1**（这 900 行是死代码还是待启用） |
| **G2 迁移退役到期项 / 零消费导出** | ① `inferScopeFromPhysicalPath`（entry_id 化前「物理路径反解 scope_key」的迁移专用函数）全仓零生产调用方零测试，真正的反解已由 `toLogicalPath` 承担；② `deleteExceptReachable` + 逐条版 `repairRefCountFloor` 生产零消费方（`rollback-execution-redesign.test.ts:77-109` 反而**断言它不被调用**），是「测试为满足 interface 而实现的空壳」；③ `zodToJsonSchema` 手写 41 行转换器在 zod 4.4.3 下**永进不去**（`schema.toJSONSchema?.()` 恒存在），且行为与原生不一致（enum 会被悄悄放宽成 `{type:"object",additionalProperties:true}`）；④ `common/memoize.ts` 123 行零消费方，连 barrel 都没导出；⑤ `config-forms/agent` 三个 `@deprecated` 导出零消费（连被指向的 YAML 导入路径都不存在）；⑥ 三个「索引 DDL 常量」零消费者，其中 `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` 的注释写「保留供老库 DROP 清理引用」而**代码里根本不存在这条 DROP 路径** | `logic/infer-scope-from-path.ts:43`；`repositories/impl/sqlite-vfs-revision.repository.ts:322-359, 445`；`infra/serialization/zod-to-json-schema.ts:16-62`；`common/memoize.ts`；`config-forms/agent/agent-editor-state.ts:92,100,108,200`；`bootstrap/{message-checkpoint,vfs}/*-schema.ts` | w2 F-12/F-23、pro F-20、infra-sql F-7、bootstrap F-6/F-7/F-8。**裁定**：③ 直接删 41 行留 `z.toJSONSchema(schema)`（原生对 `z.date/z.transform/z.bigint` 是**抛错而非降级**，但已核 core 内唯一 `z.custom` 在 `agent-tool.ts:304` 的 outputSchema 不经此路、5 个工具 inputSchema 无危险类型）；其余按 L0/dead-exports 清单走 W6 逐批删 |
| **G3 死条件 / 已过期语义（当前行为正确，清理即可）** | ① `vfs-move.assertMoveTargetAvailable` 的 `hasDirRow` 恒 false → 降为 **P3**（**驳回 w2 F-8 的 P2**）：`vfs-move.ts:114-116` 的 `read(to)` → `IS_DIRECTORY` 分支已覆盖显式空目录，`entries.length>0` 覆盖隐式目录 → 无实害，纯死条件 + 与 `vfs.service.ts:53-57` 注释矛盾；② `isStorageRootParent` 硬编码三个**物理**前缀但收到的是**逻辑**路径 → 三分支恒 false（**采纳 w2 争议 5 的 intentional 判定，驳回 pro F-22 的 P2**）：恒 false 意味着每个父目录都被尝试补行，**这恰是 entry_id 化后想要的行为**（逻辑路径下不存在虚拟 storage root），pro 担心的「跳过父存在性校验」不会发生；③ `stripKnownPhysicalPrefixes` 的 `/meta` `/template` `/projects/...` 正则已过期（entry_id 化后 `path` 已是逻辑路径，而 global-meta 域逻辑路径本身就以 `/meta` 开头 → 技能路径 `/meta/skills/foo` 会被显示成 `/skills/foo`），但只在 `formatVfsErrorForLlm` default 分支与 `extractInvalidPathReason` 兜底里用，影响面小 | `logic/vfs-move.ts:122-129`；`logic/parent-dir.ts:27-39` + `vfs.service.ts:52,75` + `ensure-parent-dirs.ts:24`；`logic/strip-known-physical-prefixes.ts:8-12` | w2 F-8 + pro F-32（①）；w2 争议 5 vs pro F-22（②）；w2 F-21 + pro F-21（③）。② 已登记为 intentional，只留清理项 |
| **G4 GC 返回值口径不一（三处同族）** | ① `deleteUnreferencedUnderScope` 返回 DELETE **之前**的 `SELECT COUNT(*)`；② `deleteExceptReachable` 累加 `chunk.length`（尝试数非 changes）；③ `deleteGlobalOrphans:629` 用 `result.changes` —— **三个同类 API 三种口径**。加重情节：同仓 `deleteRecursiveIfAny:530-533` 明确写过「用真实 changes 避免探测与删除之间并发写入的偏差」并刻意改过，`deleteUnreferencedUnderScope` 没跟随 | `repositories/impl/sqlite-vfs-revision.repository.ts:356, 583-616, 629` | ✅ **4 源印证**（w2 F-10 + w2 F-11 + pro F-19 + adv F-5）。adv 争点 2 明确让步「不升级 severity」但要求记录口径不一致。**裁定 P3**：当前消费方（`revision-gc.ts:82`）只把它当统计数，无正确性依赖 | 统一读 `ExecuteResult.changes`；`deleteUnreferencedUnderScope` 的 COUNT 降级为纯短路优化 |
| **G5 ZIP 边界** | ① `vfs-zip-validate.ts:55-60` 用**子串**判 `..` 而非路径段判 → 合法文件名 `第1..2章.md`、`a..b.txt`、`..hidden.md` 全部被拒，报错文案「parent segment」与真实原因完全对不上；② `parseVfsZip` 中央目录严格解析失败时**静默降级**到 fflate `unzipSync`，跳过严格解析器的全部拒绝逻辑（ZIP64 marker / 加密位 / 压缩方法白名单 / STORE 长度校验），对「结构异常」的 ZIP 反而放得更松；③ `decodeZipEntryName` 在 EFS 位为真时用 `TextDecoder(fatal:true)`，非法 UTF-8 抛裸 `TypeError`，被 `parseVfsZip` 的 catch 当 `centralDirError` 吞掉 → 静默切到解码策略不同的回退路径，用户看不到任何「格式异常」信号 | `logic/vfs-zip-validate.ts:55-60`；`logic/vfs-zip-parse.ts:41-56`；`logic/vfs-zip-filename-decode.ts:21-25` | ✅ 2/2/1 源（w2 F-14/F-16 + pro F-23/F-30）。**裁定 P3**：① 方向对但过宽，改段级判定 `split("/").some(s=>s==="..")`；② 降级路径至少保留方法白名单与体积闸，或把降级限制在明确的「fflate 已知边缘格式」白名单内；③ 解码异常转 `vfsZipError("INVALID_ZIP")`，让回退只对「结构不识别」生效 |
| **G6 跨层直查 / 驱动契约 / 编码** | ① `SqliteVfsEntryRepository.findContentSizeByPath:241-255` 直接查 `vfs_content_blob` 表，**绕过注入的 `VfsContentStore`**（构造函数允许注入自定义 store），换实现时大小探测与实际存储脱节；② `vfs-zip-filename-decode.ts:23,25` 用 Node 全局 `Buffer`，靠 `apps/mobile/src/polyfills.ts:21` 兜住，core 自身不保证 —— 而同域 `blob-bytes-codec.ts:20` 用的是纯 JS `atob`，两处口径不一致；③ `parseUrl` 无条件剥 `file:` 前缀且不解析 query → `tdbc:sqlite:file:foo.db?mode=ro` 里的 `?mode=ro` 被当**文件名**拼进路径，静默到很后面才炸；④ `registerDriver` 是 last-wins 且**无重注册告警**，`clearDrivers` 虽标 `@internal` 但已从 `tdbc/index.ts:17` 导出到主入口 —— mobile 的 `registerMobileOpSqliteDriver` 专门收敛了入口防被覆盖，但注册表本身零检测 | `repositories/impl/sqlite-vfs-entry.repository.ts:241-255`；`logic/vfs-zip-filename-decode.ts:23,25`；`infra/tdbc/logic/open.ts:41`；`infra/tdbc/logic/registry.ts:11-17, 36` | w2 F-9/F-15、infra-sql F-15/F-9。**裁定 P3**，但 ④ 有具体受害路径（mobile 后台探测被静默降级 → 回前台事务挂死且无日志线索）建议 `registerDriver` 对同名重注册打 warn |
| **G7 类型归一 / 字符串拼接 / 计数下限** | ① `scanFileEntriesWithMeta` 两个分支直接透传 `r.entry_id` / `head_version` / `mtimeMs`，而同文件其它方法一律 `Number(...)` 归一 —— 契约不一致，任一驱动改字符串返回就静默把字符串塞进 `revisionPairKey`；② `normalize-for-match` 逐码点 `+=` 拼接，每次 replace 都对全文跑一遍（v1 映射 1:1 长度守恒，doc 已论证正确，但 Hermes 上是 O(n) 次 rope 拼接）；③ `batchAdjustRefCount` 的 `delta < 0` 不校验 `ref_count` 是否已为 0，重复 −1 撞 `CHECK (ref_count >= 0)` → 裸 `TdbcError`；④ 同一方法把 `delta` 字面量拼进 SQL 字符串（全仓少见的插值 SQL，非整数/NaN 直接语法错） | `repositories/impl/sqlite-vfs-entry.repository.ts:754-760, 780-786`；`logic/normalize-for-match.ts:50-56`；`repositories/impl/sqlite-vfs-revision.repository.ts:369-375, 430` | w2 F-22/F-17/F-18/F-19。**裁定 P3**：① 统一 `Number()`；② 改单遍 `replace(/[...'"]/g, fn)`；③ −1 时加 `AND ref_count > 0` 或捕获约束错误转 `VfsError`；④ 改 `ref_count = ref_count + ?` |
| **G8 SQL 签名 / 常量散落 / 漂移** | ① `computeEntrySignature` 对整个 scope 做 `group_concat` 无长度上限（`workplace.service.ts:316` 每次装配都调），且 SQLite 不保证聚合函数尊重子查询 `ORDER BY`（顺序不稳只造成缓存假失效，可接受）；② chunk 常量 `500` 散落四处（`sqlite-vfs-content-store.ts:32` 模块级 `:172` 局部、`sqlite-vfs-revision.repository.ts:230/:429/:40`），调一个不动另三个；③ `CopyVfsTreeOptions.contentStore` 声明为**非可选**而 `options` 本身可选 → `options != null` 守卫在类型层不可达，却是 `allBlobsExist` 保持 true 的唯一原因（死代码掩盖契约违反）；④ `revisionPairKey()` 单源已存在，3 处仍各写各的 `\`${entryId}:${version}\``；⑤ 游标/错误文案细节：`zodMessage` 返回整个 issues 数组的 JSON（多字段失败时抛缩进 JSON 给用户看）、`stringifyText(undefined)` 静默产出 `"undefined\n"`（非法 JSON，错误现场跑到下游 `parseText`）、`kkv-value-codec.parseBoolean` 抛裸 `Error`（本仓同类里唯一的裸 Error，消费方已 catch 兜住）、`date-format` 的 `pad` 与 `usage-stats-format` 重复 | `repositories/impl/sqlite-vfs-entry.repository.ts:632-647`；`content-store/impl/sqlite-vfs-content-store.ts:32, 172`；`logic/vfs-tree-copy.ts:103, 219-224`；`logic/seed-live-head-revisions.ts:45` + `logic/revision-ref-count.ts:109,134`；`infra/serialization/decode.ts:10-20`、`stringify-text.ts:16`、`kkv-value-codec.ts:15`、`date-format.ts:13` | ✅ 2 源（w2 F-20/F-24 + pro F-26）+ adv F-6/F-7 + infra-sql F-11~F-14。**裁定 P3**（① 换定长摘要或对 group_concat 结果做 hash；③ 把 `options` 改必填并删守卫） |
| **G9 幂等 / 事务兜底** | ① `SqliteVfsContentStore.put()` 是 SELECT-then-INSERT，无 `ON CONFLICT DO NOTHING` 也无重试；`ensureBlob` 内部同样是 SELECT-then-put，把同一竞态形状复制了一份。端口契约写的是「同 hash 已存在则复用行」，实现只在单写者下成立（desktop/mobile/cli 均单连接单写者，窗口很窄）。**同族**：`copyVfsTree` 的 `findExistingBlobHashes` + `ensureBlob` 也是 check-then-act。**注意**：`vfs_content_blob` 是共享表，INSERT 冲突不是「后写覆盖」而是**失败**，不在 RULE:83「last-write-wins」语义覆盖范围内；② `runInTransactionOrConn` 的 `catch(NESTED_TRANSACTION) → fn(conn)` 兜底无法区分「`conn.transaction` 在 BEGIN 处就抛」（正常嵌套）与「`fn` 执行到一半深层抛 NESTED 冒泡」（外层已回滚，重跑会在**无事务**下把整个 `fn` 再执行一遍 → `writeWithRevision` 的四步变非原子）。`skills.service.ts:470-472` 注释确认深层嵌套在本仓是真实拓扑 | `content-store/impl/sqlite-vfs-content-store.ts:47-77, 191-204`；`service/vfs/impl/revision-aware-vfs.service.ts:302-315` | ✅ 2 源（pro F-28 + adv F-2 → ①；pro F-29 + xc-txn F-16 → ②）。**裁定 ① P3**（pro 与 adv 对级别有分歧：adv 给 P2 主张契约面更硬，pro 给 P3 主张单写者窗口窄 —— 采纳 pro 的 P3，理由是三端均单连接单写者，但**修法一行且语义严格变强**，建议提到 backlog 前列）；**② P3**（两条独立报告都标 suspected，触发路径未闭合） |
| **G10 错误模型 / 读路径不一致** | ① `sqlite-vfs-entry.repository.ts:882,887` 抛裸 `Error`（「vfs_content_blob 缺失」/「vfs 正文损坏」）而非 `VfsError` → `formatVfsErrorForLlm` 只认 `VfsError`，裸 Error 走 `error instanceof Error → error.message` 兜底，把内部损坏文案直接抛给用户/LLM；② `findContentSizeByPath` 对「有 hash 但 blob 缺失」返回 `null` 而 `read` 对同一形态抛错 —— `VfsContentSize` 的 null 在 workplace live view 被渲染成「大小未知」占位块，把数据损坏伪装成正常空态，两个症状对不上号 | `repositories/impl/sqlite-vfs-entry.repository.ts:882, 887, 248-250`；`model/vfs-content-size.ts` | ✅ 2 源（w2 F-13 + pro F-27 + adv F-8）。**裁定 P3，但 adv 争点 3 明确说「没有逐行核 character-card-limits.ts 的实际放行分支」** → 移入争议 #4 交 W6 核实后再定 |
| **G11 死路径 / 接口漂移** | ① `seed-live-head-revisions.ts:104-116`：`entryId != null` 意味着该路径上已有 entry 行，而发的是裸 `INSERT INTO vfs_entry` → 撞 `UNIQUE(scope_key,path)` **必然失败**。函数 doc 写的意图（「若路径上仍有历史 revision，版本取 max+1」）在这里是实现反了：entry 还在时该做 update 而非 insert。当前两个调用方（`character-card-import.service.ts:151` / `vfs-zip-io.service.ts:214`）都先 `releaseAndDeleteVfsPrefix` 删干净了 entry → `findByPath` 恒返回 null → **今天是死路径**（已核）；② `user-vfs-save-mapping.ts` 两个签名有哑参数：`mapUserSaveToToolUses(baseline, _saved, path, fileContentAtSave, ...)` 同时收两个内容参数只用后者、`buildUserVfsSaveWriteActionXml(path, _reason, content = "")` 的 `_reason` 未用且 `content` 默认空串（漏传第三参会生成 `content:""` 的 write action XML → **回放时清空文件**且无提示）；③ 两个同名 `countOccurrences` 语义相反（`longest-common-substring.ts:19-34` 统计**重叠**、`user-vfs-save-mapping.ts:55-70` 统计**非重叠**），同一种「出现次数」两种口径，后续谁复用谁踩坑 | `logic/seed-live-head-revisions.ts:104-116`；`logic/user-vfs-save-mapping.ts:188-201, 270-276`；`logic/longest-common-substring.ts:19-34` + `user-vfs-save-mapping.ts:55-70` | w2 F-7、pro F-24/F-25。**裁定 ① P2→P3**（不可达死路径，但承载「版本接续」语义，任何「entry 未删但需接续」的调用姿势下直接炸 —— 建议改成 `updateWithContentHash` + `append` 或删分支并在 doc 写明前置条件）；② content 去掉默认值改必填；③ 抽单一工具并改名区分 |
| **G12 bootstrap 文档债与导出面残留** | ① `AGENT_CONFIG_SKILL_MD` 无条件覆盖（版本落后即重种，用户在管理页对内置技能正文的编辑会在下次 bump 时静默丢弃）—— **代码有意为之、漂的是 RULE 文本**（RULE 写「用户改过正文则跳过不覆盖」）。status.md 已记：主仓 RULE 该条**已修复但未提交**，worktree 读到旧文 → **本条实际已处置**，留档防再犯；② `config-forms/events` 子路径已整体删除，但三处残留仍指向它（`tsconfig.test.json:32` paths、mobile `jest.config.js:194-197` moduleNameMapper 映射到永不存在的 dist、desktop `fix-settings-utf8.mjs:87` 内嵌生成模板）—— paths 有、exports 无的反向残留；③ `docs/public-api.md` §3 列了已下线的 `./regex`、漏了真实存在的 `./smart-sort-rule`、另 4 个 barrel 两表都没收，「12 个」总数与真实 17 个 barrel 错位；④ `AgentErrorCode.UNSUPPORTED_PROVIDER` 经 `public/agent.ts:22` 公开但全仓无构造、无消费（对照 `DOOM_LOOP` 有真实调用方）；⑤ `config-forms/stored-config-validity` 留 events 时代骨架：`outdated_version` code 与 `storedSchemaVersion` 字段的唯一生产者**从不产出/从不填**（恒 undefined），desktop IPC DTO 逐层搬运；两个 `CURRENT_*_SCHEMA_VERSION` 常量零消费；⑥ `isSessionFsError` 无条件把 error 剥到 cause 链最深处再匹配（同仓 `isVfsError` 是「先自身、匹配不上再退一层 cause」的正确做法）→ 被外层包裹时 TS 断言 `error is SessionFsError` 指向不带 `missingLogicalPaths` 的外层对象，`readRollbackRevisionBackfillMissingPaths` 会退化成「· （未知文件）」空列表；⑦ `baseline-check.test.ts` 五条断言消息仍写 `v1.4.27`，实际最低支持版本已 v1.5.5；⑧ `compareAppVersions` docstring 承诺「三段纯数字」但实现只 `split(".")+parseInt` → `1.5.28-beta` 与 `1.5.28` 比出**相等**；⑨ `SESSION_FS_SCHEMA_STATEMENTS` 永久空数组被 spread 进 bootstrap；⑩ `writeSkillFile` 是 6 位位置参数签名，seed 传两个 `undefined` 占位才够到第 6 位，加中间参数会静默错位 | `bootstrap/skills/seed-builtin-skills.ts:192-201`；`tsconfig.test.json:32` + `apps/mobile/jest.config.js:194-197` + `apps/desktop/scripts/fix-settings-utf8.mjs:87`；`docs/public-api.md:35-51`；`errors/agent-runtime-errors.ts:12,37-44`；`config-forms/stored-config-validity/types.ts:9,21,25,28`；`errors/session-fs-errors.ts:487-512`；`test/bootstrap/baseline-check.test.ts:44-100`；`common/compare-app-versions.ts:6-20`；`bootstrap/session-fs/session-fs-schema.ts:8`；`bootstrap/skills/seed-builtin-skills.ts:194-201` | bootstrap F-2/F-5/F-9~F-16。**裁定 ① 已处置**（RULE 主仓已修待提交）；⑥ 状态 suspeted（守卫语义缺陷可确证，实际被包裹的构造点未找到）→ 争议 #6；其余 P3 文档债 | ② 删三处残留，mobile moduleNameMapper 改成从 `package.json#exports` 生成；③ 重写 §3 表格并加「增删 exports 子路径必须同步本表 + tsconfig paths + allowlist 快照」三处；⑥ 改 `isVfsError` 那种两段式 |

---

## 对抗裁定台账（w4-vfsstore 逐条）

> pro = 检察官（F-w4-vfsstore-pro-1..32），adv = 辩护人（F-w4-vfsstore-adv-1..8 让步项 + D-1..D-20 设计辩护）。
> adv 的 20 条「设计辩护」全部审阅，**未发现需要驳回的**——它们引用的事实例外正确（内容寻址必要性、
> `WITHOUT ROWID` + 复合 PK 是 schema 正确性前提、双 ref_count 分层语义不同层、`AFTER UPDATE **OF content_hash**`
> 限定符是承重的、blob 计数交触发器因 DELETE 有 5+ 个站点、GC 走 deferred 的三条独立理由、`repairRefCounts`
> 只上调是「可回收 vs 不可逆」的非对称正解、`deleteGlobalOrphans` 独立于 path-scoped 扫是 entry_id 化的结构性代价、
> entry-sequence-repair 推号器而非删孤儿、normalizePath 对 `..` fail-closed、global-meta 空前缀「非对称」实为对称、
> `/template` 拒绝而非双读、toLogicalPath 五 case 都做校验、树拷贝快慢双路径都有理由、`max(head, MAX)+1`
> 是双约束下唯一可行分配器、zlib 三形态读兼容已排定退役、resolve-stored-content 解码顺序钉死、两条 CHECK
> 纵深防御、补偿回滚禁 write 注水、`deferred-blob-gc` 薄包装是策略执行点）。这些**已并入架构小结与 intentional 表**。

| raw 条目 | pro 级别 | 归并后 | 裁定 | 理由 |
|---|---|---|---|---|
| pro-1 renamePrefix REPLACE | P1 | CS-01 | **upheld P1** | 与 w2 F-1 独立撞车；w2 有 better-sqlite3 实测复现，pro 争议 1 自陈「未跑复现」已被消解 |
| pro-2 tree-copy sweep 顺序 | P1 | CS-04 | **upheld P1** | 已核代码：`sweepRevisionsUnderScope` 三步顺序 + `deleteUnreferencedUnderScope` 的 JOIN；三调用方不调 `deleteGlobalOrphans`（已 grep 确认） |
| pro-3 copyVfsTree overlay 无 revision | P1 | CS-12 | **降 P2** | 病灶成立且是危险公共 API，但四个生产调用方目标均为全新空 scope → 当前不可达。pro 自陈「潜伏地雷而非在线故障」 |
| pro-4 batch-io 无 revision | P1 | CS-06 | **upheld P1** | 已核 desktop `vfs-batch.service.ts:210-226` 路由 + `vfs-batch-io.service.ts:100-101` 注释 |
| pro-5 LCS 稠密 DP | P1 | CS-03 | **upheld P1** | 与 w2 F-3 独立撞车；两源均实测。w2 争议 1 的「是否有尺寸闸」已核为无闸 |
| pro-6 ZIP 解析期无闸 | P1 | CS-09 | **upheld P1** | 已核 `vfs-zip-io.service.ts:189` parse → `:191` validate 的顺序 |
| pro-7 批量导出丢文件 | P1 | CS-08 | **upheld P1** | 已核 `:400` 用 `basenameOf` vs `:412/:426` 用 `exportRelativePath` |
| pro-8 blob 触发器不看 entry | P1 | CS-07 | **upheld P1，附修复顺序约束** | pro 争议 2 的自陈正确：修 CS-06/CS-12 能消掉大部分触发条件。采纳为「先修 CS-06/CS-12，本条转纵深防御」 |
| pro-9 软删墓碑 live ref 不释放 | P2 | CS-04 附注 | **并入 CS-04 说明**（不单列） | pro 争议 3 自陈与 pro-2 不重复：F-2 留 ref=0 历史版本（理论可被 `deleteGlobalOrphans` 收）、F-9 留 ref=1 墓碑（连兜底都够不着）。**本裁定：F-9 是独立病灶**，但修 CS-04 时需一并处理——`appendDeletedRevision` 的 +1 没有对称的 −1，每次 `rm` 一个文件永久留一行（`vfs_revision` 是本仓最大表） |
| pro-10 vfs-copy 空目录恒失败 | P2 | CS-18 | **upheld P2** | 已核 `vfs-copy.ts:34-45` 吞 `IS_DIRECTORY`；与 pro-32 的 move 侧形成不对称 |
| pro-11 blob GC 全表物化 | P2 | CS-19 | **upheld P2** | 与 adv-3 独立撞车 |
| pro-12 并发 UNIQUE 裸错 | P2 | CS-20 | **upheld P2** | pro 争议 4 的边界划分正确：并发语义 intentional，裸错 + 二次读回查不在措辞覆盖内 |
| pro-13 batch ingest 3N 往返 | P2 | CS-05 | **归并** | 按指令「事务边界同族归并」并入 CS-05 的三站点 |
| pro-14 expandAnchorHunk O(n²) | P2 | CS-17 | **upheld P2** | 与 w2 F-6 独立撞车；w2 有三档耗时实测 |
| pro-15 grep 全量读 + matchGlob ×3 | P2 | CS-16 | **upheld P2** | 与 w2 F-5 独立撞车 |
| pro-16 vfs-grep auto ReDoS | P2 | CS-24 | **upheld P2（suspected）** | pro 自陈 suspected；pattern 由 LLM 决定 + UI 线程同进程，风险面成立 |
| pro-17 physical-vfs N+1 | P2 | CS-25 | **upheld P2** | 消费方序列已核 |
| pro-18 restore 不复活被删 entry | P2 | CS-21 | **upheld P2（suspected）** | 快照类型有 `kind:"present"` 承载 content 却未用，是设计-实现分叉的硬证据 |
| pro-19 GC 返回值三口径 | P3 | G4 | **upheld P3** | 4 源印证 |
| pro-20 两个 port 方法零消费 | P3 | G2② | **upheld P3** | `rollback-execution-redesign.test.ts:77-109` 断言不被调用是硬证据 |
| pro-21 strip 过期正则 | P3 | G3③ | **upheld P3** | 与 w2 F-21 独立撞车 |
| pro-22 isStorageRootParent | P3 | G3② | **驳回 P3→intentional** | **adv 争点未涉及此条，但 w2 争议 5 的判定成立**：三个物理前缀对逻辑路径恒 false，而恒 false 恰是想要的行为；pro 担心的「跳过父存在性校验」在恒 false 下不可能发生。降为清理项 |
| pro-23 zip `..` 子串 | P3 | G5① | **upheld P3** | 与 w2 F-14 独立撞车 |
| pro-24 哑参数 + content 默认空串 | P3 | G11② | **upheld P3** | `content = ""` 默认值导致回放时清空文件，虽不可达但后果重 |
| pro-25 countOccurrences 语义相反 | P3 | G11③ | **upheld P3** | 两份实现都在 `git grep` 命中，易被误复用 |
| pro-26 signature group_concat | P3 | G8① | **upheld P3** | 与 w2 F-20 独立撞车 |
| pro-27 findContentSizeByPath null | P3 | G10② | **upheld P3，但证据待补** | adv 争点 3 明确说未核消费方分支 → 争议 #4 |
| pro-28 put() 竞态 | P3 | G9① | **与 adv-2 分歧，裁 P3** | 事实双方一致；adv 给 P2 主张 port 契约面更硬，pro 给 P3 主张三端单写者窗口窄。采纳 pro（可达性优先），修法一行 `ON CONFLICT DO NOTHING` 建议提到 backlog 前列 |
| pro-29 runInTransactionOrConn 兜底 | P3 | G9② | **upheld P3** | 与 xc-txn F-16 独立撞车（双方均 suspected） |
| pro-30 EFS 解码 TypeError 被吞 | P3 | G5③ | **upheld P3** | 与 w2 F-16 同族（降级路径吞错） |
| pro-31 vfs_entry.content 僵尸列 | P3 intentional | intentional 表 | **维持 intentional** | 主动标注 intentional，DDL §A 与读侧遗留分支都有注释；已转为「删列前必须先确认最低支持库版本已无迁移窗口行」的提醒 |
| pro-32 vfs-move hasDirRow | P3 | G3① | **upheld P3，驳回 w2 F-8 的 P2** | 已核 `vfs-move.ts:114-116` 的 `IS_DIRECTORY` 分支已覆盖显式空目录 → 无实害 |
| adv-1 seedForkCopyParity 漏判空 | P2 | CS-23 | **upheld P2** | 辩护人主动让步，证据面（类型 + CHECK 约束）双向可证 |
| adv-2 put() 竞态 | P2 | G9① | **见 pro-28 行（裁 P3）** | 唯一一处对级别有实质分歧的对抗条 |
| adv-3 blob GC 缺索引 | P2 | CS-19 | **upheld P2** | adv 争点 4「未写理由的遗漏是遗漏不是取舍」采纳 |
| adv-4 rename 无占用谓词 | P2 | CS-22 | **upheld P2** | 辩护人主动让步，且给出了「真实损害是错误类型退化」的精确限定 |
| adv-5 deleteUnreferencedUnderScope 返回值 | P3 | G4① | **upheld P3** | 辩护人让步但要求记录口径不一致 → 已并入 G4 |
| adv-6 chunk 常量 500 ×4 | P3 | G8② | **upheld P3** | — |
| adv-7 copyVfsTree 死守卫 | P3 | G8③ | **upheld P3** | — |
| adv-8 findContentSizeByPath null | P3 | G10② | **与 pro-27 合并；adv 自陈证据不足** | → 争议 #4 |

---

## 争议上交（8 条）

| # | 争议 | 涉及 | 需要谁裁决 |
|---|---|---|---|
| **1** | **`sql-template` 约 900 行动态标签子系统（parser 428 + evaluator 137 + expression 161 + context 74 + placeholder 28 + tags）在生产代码零使用**——生产动态性全靠 TS 侧字符串拼接 + `${}` 内联。这批代码是「重构做了一半留下的死代码」还是「准备给未来运维/事件配置用的待启用能力」？infra-sql 未找到任何文档说明其当前定位。**这直接决定 CS-15 与 G1 三条的定级**：若确认死代码 → 降 P3 清理项（合计 -4 条 P2/P3）；若确认待启用 → 这批是**上线前的必修项**，CS-15 升 P1 | CS-15、G1①②③ | 需架构级裁决（主代理 + W7） |
| **2** | **`vfs_entry.content` 遗留明文列的两条读路径判定不一致**：`scanContents` 的 `resolveScanRows`（`:886-890`）对 `content_hash IS NULL` 的行直接抛「正文损坏」，而 `rowToEntry` 走「content_hash → 遗留明文 → 抛错」三段式（`resolve-stored-content.ts:47-61`）。真有迁移期遗留行时，`read` 能读出来、`scanContents`（grep / ZIP 导出 / tree-copy 回退）会炸。**需要确认存量库里是否真有 `content IS NOT NULL AND content_hash IS NULL` 的行才能定性** | w2 F-5 附注 / 本簇 CS-16 相邻 | W3「vfs 内容三形态」机位（若已出结果请回填） |
| **3** | **`RULE.md:29` 与 `seed-builtin-skills` 实现漂移**：RULE 写「用户改过正文则跳过不覆盖」，实现是无条件覆盖。代码注释给出了相反论证（「内置保留名技能是官方资产而非用户数据」）。status.md 已记主仓 RULE 该条**已修复但未提交**——请确认是否按「代码正确、RULE 待提交」结案，避免下一轮再被翻出来 | G12① | 主代理（已知待用户提交） |
| **4** | **`findContentSizeByPath` 返回 null 的消费方行为未核**：adv 自陈「只读了 `model/vfs-content-size.ts` 的契约文本与 repository 实现，**没有逐行核实 `character-card-limits.ts` 的实际放行分支**」。若它对 null 有别的处理（如跳过该文件或记 warn），G10② 应降 P3 且描述需改写 | CS / G10②、pro-27、adv-8 | W6 验证代理 |
| **5** | **分层倒置**：`domain/vfs/logic/revision-ref-count.ts:13` 反向 import `service/integrity-repair`。adv 明确「**我辩护现状可用**（不产生运行时问题、抽象本身合理），但**不辩护这个位置**」——`IntegrityRepairOperation` 形状极简（`detect()` / `repair()`），搬到 `domain/` 或 `core/contracts/` 无行为改动。需确认是否已有分层 lint 规则覆盖 | adv 争点 1 | L3 架构层（未决于代码层） |
| **6** | **`isSessionFsError` 无条件递归剥 cause**：守卫语义缺陷可确证，但「实际是否被上层包过一层」本次未找到确定的构造点（status suspected）。若 W3/W4 其它簇找到包裹点 → 升 P2（用户看到「快照丢失」提示但无文件清单） | G12⑥、bootstrap F-12 | 待后续簇回填 |
| **7** | **CS-11（session copy 事务内全量解压）的簇归属**：xc-txn F-1 派单到本簇，但 `session.service` 属 core-data 域，且 status.md 记 core-service-chat 机位已独立发现同一病灶（「copy 的问题实为写事务内全量读不对称」）。请主代理在全局台账**只计一次**，owner 建议 core-data | CS-11 | 主代理（跨簇去重） |
| **8** | **w3-xc-txn 中 15 条非存储类事务发现的簇归属**：`smart-sort-rule` 无事务族（F-5~F-8，status.md 已由 core-service-vfs 记为 P1-2）、`message.service` truncate 族（F-9/F-10）、`backfill` 倒扫（F-11）、`session-kkv` 双 DELETE（F-12）、`refreshRuleSnapshot`（F-13）、`workplace` 仓储自开事务与 copyScope（F-14/F-17）、`provider` secret 搬运（F-18）、`CoordinatedWrite` 覆盖范围（F-19）、`mobile` prefs 双写（F-20）、`session copy`（F-1）。这些的根因都不在存储底座，本簇**只做边界标注不做合并**，请主代理按域分派到 core-data / core-misc / apps-mobile | 移交表 15 条 | 主代理 |

---

## 跨簇移交（16 条，本簇只标注不合并）

| xc-txn 条目 | 症状摘要 | 建议 owner | 备注 |
|---|---|---|---|
| F-1 | session copy 事务内全量消息解压 | core-data | 已在争议 #7 提出，status.md 记 core-service-chat 独立发现 |
| F-5 | `importRules` deleteAll+逐条 insert 无事务（中途失败=表被清空且不可自愈） | core-misc（smart-sort） | **status.md 已记为 core-service-vfs P1-2**，本簇不重复计分 |
| F-6 | `resetDefaults` 三段写全裸奔（builtin 删了没插回=永久缺失，无自愈路径） | core-misc | 同族 |
| F-7 | `renumber` 逐条 update 无事务，被 moveRule/reorderRules/resetDefaults 三处复用 | core-misc | sort_order 重复号与空洞并存 |
| F-8 | `deleteBatch` 注释承诺「避免半删」只由前置校验实现，后半段 N 次 DELETE 不在事务内 | core-misc | 同族；`setEnabledBatch:163-170` 同 |
| F-9 | `truncateAfter` 读在事务外（TOCTOU）+ 未复用共享 helper `truncateTailInTransaction` | core-data | 与 core-data CD-02 高度重叠 |
| F-10 | `truncate(null)` 全量解压只为拿 id（同 port 已有 `listIdsAfterSeq`） | core-data | — |
| F-11 | `backfill` 回退路径整体在事务内，每条消息一次 `hasCheckpoint` 单行读 | core-data | 事务边界本身 intentional（V8 修复），只该改读形态 |
| F-12 | `session-kkv.clearDomain` / `clearSession` 双 DELETE 无内部事务 | core-data | `clearSessionPromptCaches` 拿 root-conn 不在事务内 |
| F-13 | `refreshRuleSnapshot` 的 `rule_snapshot` + `file_cache` 两条强耦合 KKV 写无事务 | core-misc（workplace） | 错配跨重启持续 |
| F-14 | `sqlite-workplace.repository` 仓储层自开事务，注释前提已过期（5 处生产代码用 tx 构造该 repo） | core-misc | **爆点在调用方**：`renameRulesUnderLogicalPrefix` 的两个调用方拿 root-conn 仓储，将来若被挪进事务回调是**挂死不是报错** |
| F-15 | 回滚事务内逐路径 `deletePathIfExists` + `restorePathToRevision`（含 put→zlib） | core-data（rollback） | 仓库已有正面先例 `deferGlobalOrphanGc` 可照抄 |
| F-17 | `copyScope` = delete + 2 batch 无事务且 port 未声明前置条件 | core-misc | 现状安全（3 个调用方都在外层事务） |
| F-18 | provider secret 搬运 set→delete 顺序写（delete 失败 ⇒ 旧 ref 永久孤儿凭据） | core-misc | 安全面小瑕疵 |
| F-19 | `CoordinatedWrite` 补偿范围盖过了同库可事务化的部分 | core-misc | xc-txn 自陈属 S-1 拍板范围，标 intentional 邻近 |
| F-20 | mobile prefs 双写无事务（版本号更新但 epoch 未涨） | apps-mobile | 若 `appUi` 是 AsyncStorage 则维持现状可接受 |

---

## 给 W6 验证队列的建议优先级

1. **CS-01**（renamePrefix REPLACE）—— 唯一会**静默损坏用户路径**的发现，w2 已有 SQLite 实测但需在真实 VFS 库上跑一遍端到端（建 `/a` + `/a/sub/a/x.md` → renamePrefix → 断言路径）。
2. **CS-02**（`oldString=""` 死循环）—— 机理已实测（`LOOPED FOREVER`），需确认上游 zod schema 补 `.min(1)` 是否有别的拦截面，以及非 replaceAll 分支把 `newString` 拼到头部的实际落盘效果。
3. **CS-07**（blob 触发器误删）—— 需构造「entry 有 hash 无 revision」+ 「同 hash 有 revision 被删」的具体序列，验证 `read` 真的抛「vfs_content_blob 缺失」，并确认 decoded-content 池的掩盖窗口有多长。
4. **CS-05**（5000 文件单事务）—— xc-txn 争议 2 明确请求：**真机实测一次 5000 条目 ZIP 导入的墙钟与 ANR 表现**（RULE:26 的 disk I/O 事故发生在 quick-sqlite 时代、已通过换 op-sqlite + `SQLITE_TEMP_STORE=2` 根治，不能断言当前必然复现）。
5. **CS-10**（AST 缓存）—— w2 的内存曲线是本机实测，需在 desktop 长驻进程上确认 2000+ arity 是否真能在一轮典型使用中累积到（分片 200/400 意味着单次调用 arity 有界，跨调用的 arity 集合才是关键——**请实测一轮真实会话能产生多少种 arity**）。
6. **争议 #1**（sql-template 900 行定位）—— 架构裁决，不是代码验证。

---

## 口径说明

- 合并规则：同一病灶多源合为一条并标「多源印证」+ 来源清单；对抗对逐条裁定；事务边界同族（xc-txn F-2/F-3 + pro F-13）按指令归并为 CS-05；renamePrefix REPLACE 双源印证合并为 CS-01；G4（GC 返回值）4 源合并。
- 严重度校准口径：**升**——多源独立印证（CS-01/CS-03）、可达路径经代码核实（CS-06/CS-09）；**降**——机制成立但当前不可达（CS-12 潜伏、CS-15 生产零使用）、行为本身已被 RULE 记为 intentional 缺陷仅在文档（CS-14）；**驳回**——后果分析有误（pro-22 恒 false 分支、pro-32 已被上游分支覆盖）。
- 本簇 **0 条 P0**。最接近 P0 候选是 CS-01（静默数据损坏）与 CS-07（文件永久不可读），但两者都需要特定前置状态才达最坏后果，且 CS-01 的用户可感知延迟到「某次 read 失败」——是否升 P0 交 W7 裁决。
- 引用纪律：所有 file:line 均经 reduce 代理对生产代码定点复核（renamePrefix SQL 全文、sweep 三步顺序、DELETE 触发器 SQL、batch-io 路由分支、LCS DP 分配、desktop 批量路由、astCache 声明、`isStorageRootParent` 正则与三个调用点、zip parse/validate 顺序、vfs-copy/move 的 catch 链）；未复核的部分已在条目内标注来源置信。
