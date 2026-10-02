---
cluster: core-storage
role: W6-verification
input: synth/core-storage.md
scope: P1 台账逐条从代码重新推导（CS-01 依指令免验）
verified_count: 10
confirmed: 9
refuted: 0
adjusted: 1
date: 2026-09-30
---

# W6 验证 · core-storage 簇 P1 台账

> 方法：不读台账结论，直接从 `D:\Dev\nm-worktree\mcr\packages\core\src` 生产代码重新推导每条 P1 的机理、
> 可达路径、缓解面；机理类结论另起探针脚本（`tmp/w6-verify/*.mjs|.ts`，`npx tsx` / `node` 实跑）。
> 全程只读，未改任何生产代码，未动 git。

---

## 免验清单（依指令 / 依证据强度跳过）

| ID | 免验理由 |
|---|---|
| **CS-01**（renamePrefix `REPLACE()` 全串替换） | 指令明定「双源印证可抽查行号免验」。**但本代理仍顺带核了 SQL 全文**：`sqlite-vfs-entry.repository.ts:935-945` 确为 `SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash}) WHERE scope_key=... AND path LIKE #{pattern} ESCAPE '\'`，前缀根另走 `:947-953` 的精确 UPDATE。机理（WHERE 只圈行集、不约束替换位置）与台账一致，不另出结论。 |
| **CS-10 的「OOM(exit 134)」具体数字** | 该数字是原报告代理本机实测值，本代理不复现 OOM（危险且无必要），改为实测**堆增长曲线**并重新外推，见下方 adjusted 行。 |

其余 CS-02 ~ CS-11 共 10 条**逐条从代码重新推导**，无一条免验。

---

## Verdict 表

| ID | 重新推导的结论（代码事实） | Verdict |
|---|---|---|
| **CS-02** | `compute-replace-result.ts:53-60`：`searchFrom = idx + normalizedOld.length`，`oldString === ""` 时该式恒为 `searchFrom = 0`，`"abc".indexOf("", 0) === 0` → 探针 `LOOPED FOREVER`（守卫跑到 500 万次仍未退出）。非 replaceAll 分支 `:76` 同理 `indexOf("") === 0` → 探针输出 `"NEWhello world"`，确认 newString 被拼到全文头部。上游无拦截：`vfs-tools.ts:297-301` 是裸 `z.string()`（同文件 `:296` 的 `path` 才有 `.min(1)`）。**补一条台账漏掉的入口**：`skill-tool.ts:278` 的 `oldString: z.string().optional()` 同样无 `.min(1)`，经 `skills.service.ts:394 → vfs.replace → computeReplaceResult`，这是第 2 条 zod 入口，不止台账列的 1 条。三条直调路径（`vfs.service.ts:143` / `revision-aware-vfs.service.ts:107` / `skills.service.ts:394`）已核，均无长度闸。 | **confirmed**（入口数由 1 修正为 2） |
| **CS-03** | `longest-common-substring.ts:52-54` 无条件 `Array.from({length: oldLen+1}, () => Array(fileLen+1).fill(0))`；`:76` `Math.min(...endsInB)` 展开。探针实测（Node 22 / `--expose-gc`）：①`oldString="---"` × 15 万 `-` → `RangeError: Maximum call stack size exceeded`，18ms 内抛出（`endsInB` 累积约 15 万项）；②`oldString` 300 / 正文 30 万且无匹配（DP 全填最坏形态）→ **堆涨 689.3MB**，耗时 559ms；③纯 `Math.min(...arr)` 展开上限实测落在 2×10⁵ 附近。上游确无尺寸闸：`compute-replace-not-found-error.ts:55` 无条件调用；`vfs-tools.ts` 只对**输出**限流（`TOOL_OUTPUT_MAX_BYTES`），对输入正文无闸。三项均复现。 | **confirmed** |
| **CS-04** | `vfs-tree-copy.ts:397-410` 三步顺序确为 `decrementLiveRefsUnderScope` → `deleteVfsPrefix` → `deleteUnreferencedUnderScope`；而 `sqlite-vfs-revision.repository.ts:583-593` 的前置 COUNT 与 `:604-612` 的 DELETE 都靠 `JOIN vfs_entry e ON e.entry_id = r.entry_id` 圈定 scope，第二步刚把 entry 删光 → JOIN 恒空 → `:595-597` `count === 0` 早退，**恒删 0 行**。兜底 `deleteGlobalOrphans`（`:618-630`）全仓调用方只有 `revision-gc.ts:81` 与 `deferred-revision-orphan-gc.ts:40`，均不在本路径上。**修正台账的「三个调用方」为五个**：`initialize-session-workspace.ts:37` / `push-session-workspace.ts:32` / `skills.service.ts:440` 走 `sweepRevisionsUnderScope` 正面；另加 `character-card-import.service.ts:144` 与 `vfs-zip-io.service.ts:203` 走 `releaseAndDeleteVfsPrefix`（`:418-425`，内部同一函数）。即**角色卡导入与 ZIP 导入也各留一整代**，覆盖面比台账写的大一档。台账引的 `revision-aware-vfs.service.ts` hardDelete 注释（先 sweep 后删 entry）也已核实存在，佐证代码库自己知道顺序约束。 | **confirmed**（受害调用方 3 → 5） |
| **CS-05** | `vfs-zip-io.service.ts:199-244`：单个 `conn.transaction` 包住 `releaseAndDeleteVfsPrefix` + 逐文件 `ensureParentDirectories` + `insertFileSeedingRevision` + `ensureImportDirRules` +（session 域）`backfillBaselineCheckpoints`。`insertFileSeedingRevision`（`seed-live-head-revisions.ts:97-137`）单文件即 6 条语句（`findByPath` → `insert` → `findByPath` → `findContentHash` → `append` → `adjustRef`），**比台账估的 5 条更多**。`character-card-import.service.ts:140-182` 同形。`vfs-batch-io.service.ts:291-306` 单事务逐条 `writeOrUpdateFile`，且该路径**完全没有条目/体积闸**（不像前两者有 5000 条 / 32MB 上限），N 由宿主目录拖入量决定。backfill 侧已优化过（`backfill-baseline-checkpoints.ts:156` 用 `listMessageHeadersBySession` 头投影，不解压正文），但 `:165-177` 的倒扫仍是「每条消息一次 `hasCheckpoint` 单行读」，全在事务内。机理与量级均成立。 | **confirmed**（单文件语句数 5 → 6；补 batch-ingest 无闸门这一条） |
| **CS-06** | `vfs-batch-io.service.ts:94` / `:101` 走 `repo.insert` / `repo.update`，全程不碰 `SqliteVfsRevisionRepository`，`head_version` 被抬到 `vfs_revision` 里不存在的版本号；`:100` 注释「无 revision 层」确实只对 `DefaultVfsService` 成立。桌面路由已核 `apps/desktop/src/main/services/vfs-batch.service.ts:210`：条件是 `isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()`，即 **project / global 域无条件落 `applyBatchIngest`**（`:220`），注释确为错的。安全网确无：`findMissingRevisionPointers` 全仓唯一调用点是 `message-rollback.service.ts:178`，只扫 checkpoint 的 `targetTree`，不看 live head；`repairRefCounts`（`revision-ref-count.ts:118-136`）只对 `listKeysUnderScope` 已存在的 revision 行做下限上调，**不会凭空补出缺失的 revision 行**。`transferLiveRef`（`:39-50`）的 `adjustRef(-1)` 走 `adjustRefCount`（`sqlite-vfs-revision.repository.ts:369-382`），`delta < 0` 显式「命不中即跳过」→ 静默 no-op，台账描述准确。**附带确认这条直接生产 CS-07 的前置态**：`repo.update` 内部 `contentStore.put` 会建 blob 行，而无 revision 行 → `vfs_content_blob.ref_count` 永久为 0。 | **confirmed** |
| **CS-07** | 触发器全文已核（`vfs-revision-schema.ts:34-68`）：INSERT/DELETE/UPDATE 三个触发器**只按 `vfs_revision.content_hash` 维护** `vfs_content_blob.ref_count`，`vfs_entry.content_hash` 这一路引用在 DDL 层完全不可见；`:52-53` 的归零 DELETE 也不带 `NOT EXISTS (SELECT 1 FROM vfs_entry ...)` 判定。**机理需修正台账的措辞**：若 blob 的 `ref_count` 真为 0 而此时删一条同 hash 的 revision，`:49-51` 的 UPDATE 会先把它减到 **-1**，撞 `vfs-content-blob-schema.ts:18` 的 `CHECK (ref_count >= 0)` → 整条 revision DELETE 报错，而不是静默删 blob；且「ref_count=0 却仍有 revision 引用」这个状态被触发器不变量排除，压根到不了。可达的真实序列是：**ref_count = 1（唯一引用者是一条 revision），该 revision 被删 → 归零 → blob 行被删，而此时另有只经 `vfs_entry.content_hash` 引用同一 blob 的 entry（CS-06/CS-12 造出的）悬空 → read 抛「vfs_content_blob 缺失」**。结论方向不变，触发前提从「ref_count 常年为 0」修正为「entry-only 引用者先于 revision 引用者存在」。另一处可作对照的正面事实：`SqliteVfsContentStore.gc()`（`:213-217`）的 `NOT IN` 子查询**确实同时覆盖 `vfs_entry` 与 `vfs_revision`**，所以 6 条 `runDeferredBlobGc` 热路径是安全的 —— 全库唯一的不安全删除者就是这条触发器。 | **confirmed**（机理描述修正） |
| **CS-08** | `vfs-batch-io.service.ts:399-406` 单文件分支确为 `const fileRel = basenameOf(logical);`（`:153-159`），而 `:412` 目录分支与 `:426` 显式目录分支都用 `exportRelativePath(childLogical, logical, selectionCount)`（`:164-178`）。`seenFileRels` 命中即 `continue`（`:401-405`），返回结构 `BatchExportPlan` 只有 `files` / `mkdirPaths` 两个字段，**无 `skipped` / `failed` 通道** → 第二条被丢弃时无任何提示。与台账描述逐字吻合。 | **confirmed** |
| **CS-09** | 调用顺序已核 `vfs-zip-io.service.ts:189` `parseVfsZip(zipBytes)` → `:191` `validateVfsZipEntries(...)`，而 `validateVfsZipEntries` 的签名（`vfs-zip-validate.ts:140-144`）入参是 `ReadonlyMap<string, Uint8Array>`，**已经是解压完的产物**；三道闸（`:196-207` 的 `VFS_ZIP_MAX_ENTRY_COUNT` / `MAX_UNCOMPRESSED_BYTES`、`:46-51` 的 path 长度）全在这个 Map 上跑。解析侧 `vfs-zip-central-dir.ts:224-230` 在循环内逐条 `readLocalEntryData` → `:101` `inflateSync`，`:109-114` 的 `inflated.length !== uncompressedSize` 是**解压之后**才比对，`entries[]`（`:185` / `:232`）全程累积无闸；`uncompressedSize` 只在 `:206` 被查是否等于 `0xffffffff`，攻击者填任意其它值即可。STORE 分支（`:91-98`）因先比长度反而安全，**炸弹路径是 DEFLATE 分支**（这一句台账没写明）。第二入口已核 `domain/skills/logic/preview-skill-zip.ts:35` 裸调 `parseVfsZip`、`:38-41` 只数条目不做任何上限判定。fflate 回退 `vfs-zip-parse.ts:23-36` 同样无闸。 | **confirmed**（补「炸弹只在 DEFLATE 分支」这一限定） |
| **CS-10** | `parser.ts:45-55` 确认为 **实例级** `private readonly astCache = new Map<string, AstNode[]>`，无上界、无淘汰，`:43` 注释「模板字符串通常数量有限（来自配置）」在生产前提不成立。**但台账的机理与数字都要改**：①缓存宿主是**每个 repository 实例各持一个 parser**（`sqlite-message-checkpoint.repository.ts:84`、`sqlite-vfs-entry.repository.ts:55` 等），而仓储在事务内被大量临时构造（`vfs-batch-io.service.ts:292`、`vfs-zip-io.service.ts:200/235`、`reposFor(tx)` 等），**实例被 GC 缓存即随之释放** → 泄漏只发生在被服务对象长期持有的 parser 上（`createVfsService.ts:22`、`create-message-checkpoint-services.ts:28/56`）。②台账称「分片 200/400 保证单次调用 arity 有界」——**对 VFS 与 session-kkv 成立**（`sqlite-vfs-entry.repository.ts:171/798` chunk=200、`sqlite-session-kkv.repository.ts:35` chunk=400，两者的 arity 集合天然封顶在 200/400），**但对 message-checkpoint 不成立**：`sqlite-message-checkpoint.repository.ts:112/366/390` 三个方法的 `messageIds.map((_, i) => \`#{id${i}}\`)`（`:130` / `:383` / `:401`）**完全不分片**，其中 `deleteCheckpointsForMessages` 的入参来自 `listIdsAfterSeq`（`sqlite-message.repository.ts`，无 LIMIT）→ arity 无界，且该仓储实例被 `createMessageRollbackService`（`:56`）长期持有。③实测（本代理，模板取生产同形）：单 parser 累积 arity 1..N 的堆增量 —— N=200 → 3.9MB，400 → 13.7MB，800 → 49.0MB，1600 → **207MB**，3200 → **812MB**，呈超线性。与原报告的「2000→337MB / 3000→739MB」同量级、方向一致。 | **adjusted**（P1 维持；机理改为「仅 checkpoint 仓储 arity 无界 + parser 生命周期随实例」，数字按本机实测替换） |
| **CS-11** | `session.service.ts:338` `conn.transaction(async (tx) => ...)` 内，`:374` `await r.messages.listBySession(source.id)` —— `listBySession`（`sqlite-message.repository.ts:214-231`）选 `MESSAGE_SELECT_COLUMNS`（`:31`，含 `content_blob`）并经 `mapRows` → `rowToMessage` 逐条 `decodeMessageContent` 解压；`:382` `batchInsert` 又走 `toMessageParams`（`:53-79`）逐条 `encodeMessageContent` 同步 zlib。一次 copy = 解压 N 次 + 压缩 N 次，全程占 `AsyncMutex`。**对照 fork 确已治**：`message.service.ts:293` 的 `listBySession` 在 `:301` 的 `conn.transaction` **之前**，明确实例。`listMessageHeadersBySession`（`sqlite-message.repository.ts:249-269`）头投影现成可用。`batchInsert`（`:397-423`）只在**参数构造**阶段按 `BATCH_BUILD_CHUNK` 分片，`:422` 的 `conn.batch` 仍在事务内。 | **confirmed** |

---

## 汇总

- **verified: 10**（CS-02 ~ CS-11）｜**confirmed 9**（CS-02/03/04/05/06/07/08/09/11）｜**refuted 0**｜**adjusted 1**（CS-10）
- **无一条被驳回**。10 条 P1 的机理、可达路径、缓解缺口全部在当前代码中成立，**P1 定级建议整体维持**。
- 相对台账的净增量（4 处，均为**扩大**或**收紧描述**，不涉及定级）：
  1. **CS-04 受害面 3 → 5 个调用方**：`character-card-import.service.ts:144` 与 `vfs-zip-io.service.ts:203` 经 `releaseAndDeleteVfsPrefix` 走同一函数，角色卡/ZIP 导入同样每导入一次留一整代 revision + 钉住 blob。
  2. **CS-02 的 zod 入口 1 → 2 条**：`skill-tool.ts:278` 同样无 `.min(1)`。
  3. **CS-10 的泄漏面比台账窄、但单点更危险**：VFS/session-kkv 的 arity 集合被分片封顶，真正无界的是 `message-checkpoint.repository.ts:112/366/390` 三个未分片方法，且其仓储被 rollback 服务长期持有 → 建议修法优先级从「全局 LRU」上调为「先给 checkpoint 三方法补分片」。
  4. **CS-07 的触发前提描述需改写**（结论不变）：不是「ref_count 常年为 0 时被删」，而是「entry-only 引用者先于 revision 引用者存在，revision 删除把它带到归零」；同时点明 `gc()` 的 `NOT IN` 已覆盖 entry，唯一不安全删除者是 DELETE 触发器。
- 与台账一致、无需修订的强证据：`revive-deleted-entry.ts` 同款 `status: "active"` 保护只在 `seed-live-head-revisions.ts:78` 存在（`seed-fork-copy-parity.ts` 缺）这条属 P2/CS-23，本轮未在 P1 验证范围。

## 复现产物

- `D:\Dev\nm-worktree\mcr\tmp\w6-verify\replace-probe.mjs`（CS-02 死循环 / newString 前置）
- `D:\Dev\nm-worktree\mcr\tmp\w6-verify\lcs-probe.mjs`（CS-03 堆 689MB / 栈溢出 / spread 上限）
- `D:\Dev\nm-worktree\mcr\tmp\w6-verify\astcache-probe.ts` `.probe2.ts` `.probe3.ts` `.probe4.ts`（CS-10 arity 1..N 堆曲线）
