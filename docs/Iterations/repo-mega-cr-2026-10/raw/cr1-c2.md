# CR 报告 · cr1-c2（scope 模式 · 只读评审）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-c2`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `c667be0f`（Wave C 全量） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c2.md`（C2-1/2/4/5/6/8/9） |
| CR fix-spec | `docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（状态 draft，本轮待回填） |
| 本 scope 域 | vfs `write-with-revision`（C2-4/CS-06）、`vfs-revision-schema` 触发器 v2 + BOOT_VERSION 18（C2-5/CS-07）、`vfs-zip` 三闸（C2-8/CS-09）、`vfs-import-chunk`、message-checkpoint 的 backfill 与 JOIN（C2-2/C2-6）、CS-10 分块 |
| 域外（不判） | CS-05 分片落地（`vfs-zip-io.service` / `character-card-import.service` / `vfs-batch-io.service` 的分片循环本身）、`message.service` 的 truncate/copy、smart-sort |
| 检查维度 | A（一致性/单一真源）+ B（正确性/边界）+ C（回归与测试牙齿）+ C-orch（事务/编排边界）+ G（守卫/性能护栏） |
| 重点核对 | 触发器 v2 守卫与 DROP 旧名的幂等（17→18 两路径）、分片补偿失败语义、TOCTOU 连续前缀、ZIP 闸的 try 外抛点、CS-10 分块边界 |
| 写入 | 禁改代码 / 禁改 spec / 禁 git 写。本报告为唯一落盘物；临时探针已删除 |

---

## ② Must-fix（P0 → P1 → P2）

### P1-1 ★top：ZIP 解析期 `remainingBudget` 把本条 entry 重复计入 ⇒ 合法归档被误杀（实测坐实）

**位置**：`packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts:256-275` + `:105-111`

```ts
declaredBytes += uncompressedSize;                       // :257  本条已计入
if (declaredBytes > limits.maxUncompressedBytes) throw;  // :258  总量闸（正确）
const data = readLocalEntryData(..., limits.maxUncompressedBytes - declaredBytes);  // :274
  → decompressEntryData(..., remainingBudget)
  if (uncompressedSize > remainingBudget) throw PAYLOAD_TOO_LARGE;  // :106
```

`remainingBudget` 是「**已含本条**的累计值」减上限，而 `:106` 又拿本条声明值去比它 ⇒ 本条被算两遍。
等价的误杀条件是 `前缀累计 S + 2 × 本条 s > 32 MiB`。

**实测（tsx 直跑 `parseVfsZip`，探针已删）**：

| 输入（均远低于 32 MiB 上限） | 结果 |
|---|---|
| 单条 20 MiB，DEFLATE | ✗ `PAYLOAD_TOO_LARGE: entry big.md exceeds remaining size budget (20971520 > 12582912)` |
| 10 条 × 3 MiB = 30 MiB，DEFLATE | ✗ `PAYLOAD_TOO_LARGE: entry c9.md ... (3145728 > 2097152)` |
| 同上 10 条 × 3 MiB，**STORE** | ✓ OK（STORE 分支在 `:96-104` 提前 return，走不到该检查） |
| 10 条 × 1 MiB = 10 MiB，DEFLATE | ✓ OK |

⇒ 同一份内容，压缩与否结论不同；30 MiB 的合法包被判成「超限」，用户看到的是 `PAYLOAD_TOO_LARGE` 导入失败。

**性质**：这是 C2-8 引入的**净负向**——旧形态只在 `validateVfsZipEntries` 按总量判（32 MiB 内一律放行），现在多了一条更严且算错的闸。违反 spec 自己的 R3「闸门用声明值累加（合法 zip 的声明值等于实际值）」，也与 spec 第 2 步的措辞「`maxEntryBytes` 形参（= **剩余**预算）」不符——「剩余」应是本条**之前**的余额。

**修法（二选一，都一行）**：
- 传 `limits.maxUncompressedBytes - (declaredBytes - uncompressedSize)`；或
- 直接删掉 `:105-111` 这段——`:258` 的总量闸已经在 `readLocalEntryData` **之前**判过声明值，该检查在正确实现下是恒不触发的冗余分支（留着只会重复犯错）。

**补测试（当前 `test/vfs/vfs-zip-parse-limits.test.ts` 6 条全过、无一条覆盖合法大体积 ⇒ 牙齿判据①不过）**：
- 单条 20 MiB DEFLATE 必须解析成功；
- 10×3 MiB DEFLATE 必须解析成功（总额 30 MiB < 32 MiB）；
- 两者各配一条 STORE 对照，钉住「压缩方式不影响总量判定」。

---

### P1-2：blob 归零触发器 v2 的 `vfs_entry` 守卫**无索引** ⇒ 每删一条 revision 全表扫 `vfs_entry`

**位置**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:66`（DELETE 触发器）、`:86`（UPDATE 触发器，同款第二处）

```sql
AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
```

**索引现状**：
- `vfs_content_blob` 是 `WITHOUT ROWID` + `content_hash TEXT NOT NULL PRIMARY KEY`（`vfs-content-blob-schema.ts:14`）⇒ 既有触发器里的 `WHERE content_hash = …` 走的是**主键定位**；
- `vfs_entry` 只有 `idx_vfs_entry_scope_path (scope_key, path)`（`vfs-schema.ts:28`），**`content_hash` 上无任何索引**（该列 `:18` 定义为可空 TEXT）。

⇒ 每一条 `DELETE FROM vfs_revision` 都会附带一次 `vfs_entry` 全表扫。落点正是热路径：`sweepRevisionsUnderScope`（会话删除 / 回滚 / releaseAndDeleteVfsPrefix 补偿）一次删 N 条 ⇒ N 次全表扫，`O(删条数 × vfs_entry 行数)`。这是一个**以性能为主题的 commit 在热路径上新引入的性能护栏缺口**（维度 G）。

**修法**：补 `CREATE INDEX IF NOT EXISTS idx_vfs_entry_content_hash ON vfs_entry(content_hash) WHERE content_hash IS NOT NULL`（部分索引，稳态只索引真正有 hash 的行）。
⚠️ **交付路径要一并想清楚**：`novel-master-bootstrap.ts:357` 的快路径对 `bootVersion >= 18` 直接 return，把索引放进 `NOVEL_MASTER_SCHEMA_STATEMENTS` 只对**下一次 bump 之后**的库生效——本文件自己的注记（`:120-124`）刚刚踩过这个坑的孪生版。两条干净出路：① 再 bump 一次到 19（同 commit 内一并交付最省事）；② 放进 `bootstrapNovelMaster` 事务外的无条件段（与 `idx_chat_message_pending_blob` 同款手法，`:400-407`），不 bump 版本。

---

### P2-1：17→18 的**第三条**升级路径没闭上——被撤回的 v18 已经把部分库推到 `user_version = 18`

**位置**：`packages/core/src/bootstrap/novel-master-bootstrap.ts:114-118`（自述）与 `:357`（快路径 return）

```
v18（已撤回，未发布）：曾为用量详情弹窗加 chat_message.tool_use_count 列……
该列只在 feature 分支的测试机库上残留（user_version 已升 18、列与回填标记为无害孤儿）
```

`SCHEMA_BOOT_VERSION` 本次从 17 改成 18（`:126`）⇒ 那些**曾经跑过被撤回 v18**、把 `user_version` 写成 18 的库，在新代码下 `18 >= 18` 走**快路径直接 return**，legacy 无守卫触发器永远不会被 `DROP`、v2 永远建不出来。文件里那段注记把这批库判为「无害孤儿」，但那是对**列**的判断，对**触发器**不成立——触发器一旦缺守卫就是 P0 现场（删一条共享 hash 的 revision 就把别的 entry 的 blob 删掉，文件永久不可读）。

已覆盖的两条路径是对的：① 全新库（`T-GC-GUARD-BOOTSTRAP`）；② `user_version = 17` 存量库（`T-GC-UPGRADE-17-18`，`test/vfs/vfs-gc-trigger.test.ts:471`，且它还自证了「前置旧名必须无守卫」，形状很扎实）。缺的是第三条。

**定级说明**：正式库从未有过该形态（v18 未发布），影响面是 feature 分支测试机 + 装过开发版的人 ⇒ P2 而非 P1。
**修法（择一）**：注册一条 `runPendingSchemaMigrations` 迁移（该机制在**快路径里也跑**，见 `:360`），或把版本推到 19 并在注记里写明「19 = 救回被撤回 v18 留下的旧名触发器」。

---

### P2-2：`DROP TRIGGER IF EXISTS x;` 是全仓 canonical DDL 里**唯一**带尾分号的语句

**位置**：`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:129`、`:132`

全量扫 `packages/core/src/bootstrap/**/*.ts`：其余 40+ 条 DDL（`provider-schema.ts:30/32`、`sksp-schema.ts:21` 等）一律不带尾分号，只有这两条 `.map()` 出来的 DROP 带 `;`。它们会被 `novel-master-bootstrap.ts:366-368` 逐条 `tx.execute`。desktop 侧已被 `vfs-gc-trigger.test.ts` 的 bootstrap 用例跑通，**mobile 侧 op-sqlite 的 `execute` 对尾分号的容忍度没有任何用例覆盖**。去掉分号即可，零风险。

---

### P2-3：段 1（事务外）读到的 head 指针，可能在段 2 之前被并发删掉 ⇒ backfill 抛 `NOT_FOUND: Revision not found`

**位置**：`message-checkpoint.service.ts:126-141`（段 1/段 2 边界）、`backfill-baseline-checkpoints.ts:249-300`（`writeBackfillGap`）

C2-2 选案②（连续前缀复核）闭合的是「**并发插点**导致起点后移、消息永久补不上」这一类缺口，闭合得干净（见 ③ 的肯定项）。但它**没有覆盖另一类间隙**：段 1 在事务外读到 `filePointers`（`listSessionFileHeads` 的 head 版本），段 2 才开始写。若这中间有一次并发**回滚 / release / 会话删除**把那些 revision 行 GC 掉，`insertCheckpoint → incrementRefsForCheckpointFiles` 会对不存在的行抛 `VfsError NOT_FOUND: Revision not found`（这正是 C2-4 病症段引用的同一条），整条段 2 事务回滚、异常上抛到 `run-agent-turn` 的 `backfill-baseline-checkpoints` 阶段。旧形态下这段逻辑整体在一条事务内，与回滚被同一把驱动锁串行化，**结构上不可能发生**。

spec 对 stale-by-one 的论证只说了「版本旧一版合法」，没有论证「指向的 revision 行还在」。窗口很窄（单连接 + 事务外只读段），但它是 C2-2 把读段提出事务后**新暴露**的失败模式。

**需拍板**（不建议主代理自行选）：
- (i) 保持现状，接受这条窄失败面上抛（回滚本身是低频交互，撞上的概率极低，且失败是「响亮失败」不是静默损坏）；
- (ii) 段 2 整段 best-effort（try/catch + `console.warn`，与导入侧段 C 口径一致）——代价是把响亮失败变成静默；
- (iii) 段 2 写入前对每个 pointer 做一次存在性预检（O(指针数) 次读，回到热路径成本）。

倾向 (i) + 在 `writeBackfillGap` 的 JSDoc 里把这条已知失败面写出来（现在只写了 stale-by-one 是「合法」的，容易让后来者以为段 1 读到的指针一定可用）。

---

### P2-4（nit）：`is-storage-failure.ts` 无文件尾换行，且是 `common/` 里唯一向 `infra/` 取依赖的文件

- 末字节是 `}`（125），无 LF。`eslint.config.base.mjs` 未开 `eol-last`，故 lint 绿；但全仓 1951 个 `.ts` 里有 29 个缺尾换行，其中 8 个正是本波新增（`vfs-zip-parse-limits.test.ts`、`backfill-gap-index-join.test.ts`、`backfill-transaction-scope.test.ts`、`vfs-import-shard.test.ts`、`vfs-batch-ingest-revision-alignment.test.ts`、`storage-failure-bypass.test.ts` 等）⇒ 是**波级习惯**而非孤例，建议登记为一条统一清理项，不要只改这一个文件。
- `packages/core/src/common/is-storage-failure.ts:20` 是 `common/` 目录里唯一 `import … from "../infra/…"`，方向是 `common → infra`。功能上没问题（desktop/mobile 都从 `@novel-master/core/common` 取，`instanceof TdbcError` 的类身份同源，见 `apps/desktop/src/main/services/smart-sort-rule-yaml.service.ts:11,43` 与 mobile 同款），但与 `common` 的定位有张力，建议在文件头注记里说明「这是有意破例，因为 TdbcError 未从 public 面导出」。

---

## ③ Spec deviations（实现 vs `wave-c2.md`）

| # | 条目 | spec 原文 | 实现 | 判定 |
|---|---|---|---|---|
| D1 | C2-8 第 2 步 | `decompressEntryData` 增 `maxEntryBytes` 形参「= **剩余**预算」 | `vfs-zip-central-dir.ts:274` 传的是**已含本条**的余额 | ❌ **偏离**，见 P1-1 |
| D2 | C2-8 风险 R3 | 「闸门用声明值累加，合法 zip 不会被误杀」 | 多出一条更严且算错的 per-entry 闸，30 MiB 合法包被误杀 | ❌ **偏离**（R3 的缓解未成立） |
| D3 | C2-8 验收 H5/H6 | 「正常 zip 不受影响」「闸门值不变」 | 常量值确未变（`vfs-zip-limits.ts:11-17` = 32 MiB / 5000 / 512，`vfs-zip-validate.ts:22-28` 纯 re-export，import 面未破坏）✔；但 H5「正常 zip 不受影响」被 D1 破坏 | ⚠️ 部分偏离 |
| D4 | C2-5（转 core2 §7）+ C2-4 顺序约束 | CS-06 → CS-07 顺序 | 同一 commit 内 `writeWithRevision` 下沉与触发器 v2 同落，顺序成立；批量 ingest 的调用点已改走 `writeWithRevision`（`vfs-batch-io.service.ts:108-110`） | ✔ 合规 |
| D5 | C2-4 风险 R2 拍板项 (ii) | 给 `writeWithRevision` 加「跳过名校验」入参，**默认 false**，批量 ingest 传 `true` | `write-with-revision.ts:37-49` 默认 `false` ✔；`vfs-batch-io.service.ts:108-110` 传 `true` ✔；JSDoc 把「导入链路不走本校验」的拍板原文引了出来 ✔ | ✔ 合规 |
| D6 | C2-4 步骤 1 | 两个辅助下沉后，删除路径必须**反向 import** `nextVersionFor` | `revision-aware-vfs.service.ts:29-35` 反向 import，`:428` 调用 | ✔ 合规 |
| D7 | C2-4 步骤 3 | `ensureParentDirectories` 保留在批量 ingest 外层保底 | `vfs-batch-io.service.ts:101-103` 保留，注释写明原因 | ✔ 合规 |
| D8 | C2-9 修法 1 | 块大小 = `900 − fixedVars`，`fixedVars = 1` ⇒ 含 sessionId 共 ≤900 变量 | `chunkIdList(ids, 1)` → `chunkSize = 899`，899 + 1 = **900** | ✔ 合规（边界精确，无 off-by-one） |
| D9 | C2-9 修法 4 | `deleteCheckpointsForMessages` 顺序不许变：先逐块读完 → 一次性 decrement → 再逐块 DELETE | `sqlite-message-checkpoint.repository.ts:445-490`：`chunks` 先物化复用，读→减→删三段顺序完整保持 | ✔ 合规 |
| D10 | C2-9 风险 R1 | 求和口径依赖 id 无重复，唯一调用方 segment 来自 `chat_message` 主键 | 已复核全部非测试调用方：`backfill-baseline-checkpoints.ts:135`（segment 来自 `listBySessionOffset`，chat_message PK）、`message.service.ts:521`（`listReadRefTargetsBySession` 逐行 id）、`message-rollback.service.ts:515`（tail 消息 id）——**均无重复** | ✔ 前置成立 |
| D11 | C2-6 修法 2 | 不要用 `findCheckpointMessageIdAtOrBefore(…, MAX_SAFE_INTEGER)` 顶替 | `sqlite-message-checkpoint.repository.ts:364-380` 是独立方法，JOIN 形态照抄、无 `maxSeq` 条件 | ✔ 合规 |
| D12 | C2-2 TOCTOU 选案② | gap 起点不由「最后一个 checkpointed id」单点收敛，段 2 逐条复核、**只在连续命中**时跳过 | `backfill-baseline-checkpoints.ts:262-273`：`while` 逐条 `hasCheckpoint`，`!has` 即 `break`，之后全照写 | ✔ 合规且实现正确 |
| D13 | C2-2 修法 B 段 2 | 复核后为空则直接提交退出；`confirmedNoGap` 为真才写游标 | `writeBackfillGap:271-273` gap 为空时直接返回 `scan.confirmedNoGap`；service `:141-160` 仅在 true 时写游标 | ✔ 合规 |
| D14 | C2-1 失败语义（域外，仅核对边界） | 补偿挂在**片失败的内层**、写死 `releaseAndDeleteVfsPrefix` | `vfs-zip-io.service.ts:237-249`（补偿函数）+ `:298-299`（片事务内层 catch 调用），段 B0 `:258` 同款 | ✔ 合规（本节点只核对，判定权在 CS-05 域） |
| D15 | C2-1 新增常量落点 | `ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK = 200`，注释写「事务持有时间上界」，**不挂** `SQLITE_MAX_VARIABLE_NUMBER` | `vfs-import-chunk.ts:19` 值 200 ✔，`:11-18` 注释把「不挂变量上限」的理由写全 ✔；`yieldToEventLoop` 用 `setTimeout(0)`（≈16ms 时间量子口径）✔ | ✔ 合规 |
| D16 | C2-5 触发器改名纪律 | 必须显式 `DROP` 旧名，否则新旧同时注册、一次 DELETE 归零两次 | `VFS_BLOB_GC_TRIGGER_DROP_STATEMENTS:124-135` 先 DROP 旧名×2 + 新名×2，再 `CREATE TRIGGER`（去掉 `IF NOT EXISTS`）⇒ 慢路径重放**完全幂等**、无中间态 | ✔ 合规（幂等性重点核对通过） |
| D17 | BOOT_VERSION bump | 「加 DDL 必须 bump，否则快路径永远补不上」 | `SCHEMA_BOOT_VERSION` 17 → 18，注记写明理由 | ✔ 合规（但见 P2-1 的第三条路径） |

---

## ④ Open questions / 待拍板

1. **【P2-3 待拍板】** 段 1/段 2 之间的 revision 被并发删掉导致 backfill 抛 `NOT_FOUND`：(i) 保持响亮失败（倾向）/ (ii) 段 2 best-effort 吞错 / (iii) 段 2 写入前做存在性预检。需要用户或主代理拍板，理由见 ② P2-3。
2. **【P1-2 附带】** `vfs_entry.content_hash` 索引的**交付路径**：(a) 随本次 bump 一起再加一条索引并把版本推到 19；(b) 索引放 bootstrap 事务外的无条件段（与 `idx_chat_message_pending_blob` 同款），不 bump。两者都能闭合，但 (a) 会让「v18 = 触发器 v2」这条注记的含义变模糊，需要一并订正注记。
3. **【P2-1 附带】** 被撤回 v18 留下的 `user_version = 18` 库：走 `runPendingSchemaMigrations` 迁移补，还是直接推到 19？前者语义更准（迁移有名字、能被 `assertMinimumBaseline` 之外的路径复用），后者更省事。
4. **【口径确认】** C2-9 自己在 spec 里把 CS-10 从「P1 紧迫性」降级为「P1-一致性 / 防御性封顶」（实测现役驱动上限 32766）。本次实现与该降级口径一致 ✔。但请确认 ledger-v2.md 里 CS-10 的定级行是否已同步改写——cr-fix-spec.md 的台账重写职责在主代理，spec 节点已提示「编号正名」的同类先例。
5. **【域边界确认】** 本 scope 声明「CS-05 分片不在我域」，但「分片补偿的失败语义」在重点清单里。已按边界处理：只核对了 `vfs-import-chunk.ts`（本域）与补偿调用点形状（域外文件，只看不判）。若补偿的**失败语义本身**（补偿失败是否掩盖主错误、补偿是否幂等、report 契约变更）也要出结论，需要把 `vfs-zip-io.service.ts` / `character-card-import.service.ts` 划进本节点或另开节点。

---

## ⑤ 合并后 QA（manual_user）

1. **大体积 ZIP 导入手测**（P1-1 修完必须补）：造一个 30 MiB 左右的压缩包（多个几 MB 的 `.md`，DEFLATE），走「导入到会话」与「导入到项目」两条路，必须成功。当前代码下会报 `PAYLOAD_TOO_LARGE`。
2. **技能包预检手测**：拿一个含单个 20 MiB+ 文本文件的技能 zip，点「新建技能」预检，必须能读出 front matter（当前会抛 `PAYLOAD_TOO_LARGE`）。
3. **触发器升级双形态验证（P2-1 修完）**：① 全新安装 → `sqlite_master` 里只有 `_v2` 两个、SQL 含 `NOT EXISTS (SELECT 1 FROM vfs_entry`；② 旧版本安装包升级 → 同上。两条都要在**真机/模拟器**上各做一次（desktop + mobile），因为 mobile 的 op-sqlite 走的是另一条 `execute` 实现。
4. **回滚性能观察（P1-2 修完）**：在大项目（约 5000 文件）上做一次「回滚到上一 checkpoint」与一次「删除会话」，对比修前/修后的墙钟。RULE 要求按数量级回归线判定，本项只作记录，但建议采集一次基线数据留档。
5. **每轮发送的 backfill 热路径（B6 计数式）**：已有计数式断言，人工侧只需确认「大会话（≥2000 条消息）发消息的前奏不再出现秒级等待」这一可感变化。
6. **【Kotlin 真机项】**：本 scope 无 Kotlin 改动，但 Wave C 整体含 SKSP executor 变更，仍需荣耀真机（DSLDU20407006179）配合锁屏密码确认门完成 `adb install -r -d` 覆盖安装验证。

---

## ⑥ K 节建议（下游执行时闭合）

- **K1（对应 P1-1）**：修 `vfs-zip-central-dir.ts` 的 `remainingBudget` 传参或删除冗余检查；同时给 `test/vfs/vfs-zip-parse-limits.test.ts` 补两条「合法大体积不被误杀」用例（DEFLATE 单条 20 MiB、DEFLATE 10×3 MiB），各带 STORE 对照。**这两条新用例是本条的牙齿**——当前 6 条用例全部只测「该抛的抛」，没有一条测「不该抛的不抛」，所以这个 bug 一路绿灯通过。
- **K2（对应 P1-2）**：补 `vfs_entry(content_hash)` 部分索引，并按 ④-2 拍板交付路径；补一条守卫性能观测（EXPLAIN QUERY PLAN 断言守卫走索引而非 SCAN vfs_entry），否则下次改触发器的人很容易把索引删掉。
- **K3（对应 P2-1）**：为「被撤回 v18 留下的 `user_version = 18` 库」补一条与 `T-GC-UPGRADE-17-18` 同形的用例（`PRAGMA user_version = 18` + 只造旧名触发器 → bootstrap → 断言 v2 生效）。现有那条只把版本压到 17，牙齿覆盖不到快路径。
- **K4（对应 P2-2）**：删掉 `vfs-revision-schema.ts:129/:132` 的尾分号，与全仓其余 DDL 对齐。
- **K5（对应 P2-3）**：无论拍板哪条，都要在 `writeBackfillGap` 的 JSDoc 里把「段 1 指针可能已被并发删除」这条写进去（当前只写了「stale-by-one 合法」）。
- **K6（跨波，勿在本节点做）**：`parser.ts:45-53` 的 `astCache` 跨调用 arity 集合仍无界——C2-9 已把单次调用的 arity 收窄成 ≤899 种，这是净收益方向，但**跨调用**的模板串集合依然无界。彻底解法（parser 级 LRU / 固定 `?` 位置参数）会牵动 31 个 repository 的默认 SQL 出口，按 C2-9 修法第 6 条的约定登记为 Wave D/E 债务，本节点不碰。
- **K7（波级清理）**：本波新增的 8 个缺尾换行文件（含 `is-storage-failure.ts`）登记为一条统一清理项，与 Wave E 的编码扫描钩子一并收口，不要逐文件零敲。

---

## 附：本节点**核对通过**的重点项（避免下游重复劳动）

以下几点是本次重点清单里明确要求核对的，结论是**通过**，不需要再查：

1. **触发器 v2 守卫与 DROP 旧名的幂等**：`VFS_BLOB_GC_TRIGGER_DROP_STATEMENTS`（旧名×2 + 新名×2，全部 `DROP TRIGGER IF EXISTS`）排在两个 `CREATE TRIGGER`（无 `IF NOT EXISTS`）**之前**，且都是**单语句**（`NOVEL_MASTER_SCHEMA_STATEMENTS` 逐条 `tx.execute`、不合并）⇒ 慢路径重放任意次结果一致，不存在「先建后删」或「两条同时注册」的中间态。UPDATE 触发器的守卫也带上了（`vfs-revision-schema.ts:86`），且注释正确指出了「UPDATE 路径不经过 DELETE 触发器」这个易错推理。
2. **17→18 升级路径（快路径语义本身）**：bump 到 18 是必须的且做到了；`T-GC-UPGRADE-17-18` 用独立连接把库压回 17、造出无守卫旧名、再跑 `bootstrapNovelMaster`，并同时断言「v2 带守卫 + 旧名已消失 + 守卫生效两向都对（不误删也不漏删）」——形状扎实，唯一缺口是被撤回 v18 那条（见 P2-1）。
3. **TOCTOU 连续前缀**：`writeBackfillGap:262-273` 的 `while` 循环只在**连续命中**时 `start += 1`，遇到未命中立刻 `break`，其后全部照写 ⇒ 并发在 gap 中段插点时被跳过的只是「本来就是点」的连续前缀，未覆盖的那条及其之后全部照写，**结构性免疫**成立。两处 `signal.aborted` 弃权点（`:264` 复核循环内、`:278` 补写循环内）都在，且都返回 `confirmedNoGap: false` ⇒ 游标不前移、下轮必然回退全量。gap 为空的三种来源（无 live 文件 / 入场 aborted / 无空窗）分别落到「不开事务直接返回」「不开事务直接返回」「开事务写游标」，语义与旧形态逐条对得上。
4. **ZIP 闸的 try 外抛点**：`assertFallbackWithinLimits`（`vfs-zip-parse.ts:27-52`）确实在 `try` **之外**被调用（`:76`），`unzipSync` 与 Map 构造留在 `try` 内（`:66-74`），`catch` 只把非 `VfsZipError` 改写成 `INVALID_ZIP` ⇒ `PAYLOAD_TOO_LARGE` 不会被吞。`parseVfsZip:94-99` 的「闸门命中绝不回退 fflate」判定也在，且用 `instanceof VfsZipError && code === "PAYLOAD_TOO_LARGE"` 精确卡住，不会误伤其它 `VfsZipError` 的回退路径。条数闸在解压任何一条**之前**（`vfs-zip-central-dir.ts:207-213`）✔。唯一缺陷是 per-entry 那条（见 P1-1）。
5. **CS-10 分块边界**：`chunkSize = 900 − 1 = 899`，含 `sessionId` 恰为 900 变量，无 off-by-one；三处方法都保留「零 id 早退」；`deleteCheckpointsForMessages` 把 chunks 物化后复用，ref 减一先于行删除的顺序在分块后完整保持；求和口径的「id 无重复」前置对全部三个非测试调用方都成立（见 D10）。
6. **writeWithRevision 下沉**：零 service 层依赖（只吃两个 repo，外部依赖 `normalizePath` / `assertValidVfsEntryName` / `ensureParentDirectories` / `adjustRef` / `transferLiveRef` 全在 domain、`vfsIsDirectory` 在 errors），分层不破；`revision-aware-vfs.service.ts` 删除路径的反向 import 到位；「⚠️ 不是纯函数（有 IO + 读 `Date.now()`）」的警告写在文件头，避免后人按纯函数写单测 expectation。
