# fix-spec · wave-c2（Wave C 性能分片二：事务边界 + 解析闸 + 分片）

> 基线：`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`，分支 `feat/repo-mega-cr`）。
> 撰写机位：s-wave-c2。台账依据：`ledger-v2.md` §2.4（core-storage P1）、§10 Wave C 节。
> 参照（按需）：`synth/core-storage.md`、`synth/core-data.md`、`synth/verify-core-storage.md`、
> `raw/w3-xc-txn.md`、`raw/w9-checkpoint-adv.md`、`raw/w9-infrasql-pro-1.md`。
> **行号纪律**：本文件所有 `file:line` 均由撰写机位在 `fe79b781` 上逐条重新打开核对，
> 与台账原文冲突时以本文件为准（差异处在各条目「证据」小节显式标出）。

## 0 · 条目总览

| # | 条目 | 严重度/簇 | 量 | 一句话修法 | 依赖 |
|---|---|---|---|---|---|
| C2-1 | **CS-05** ZIP / 角色卡 / 批量 ingest 导入事务分片提交 | P1 · core-storage | L | delete-prefix 独立短事务 → 每 ≤200 文件一短事务 → 规则行独立事务 | C2-2 |
| C2-2 | **backfill 移出事务**（导入侧 + 每轮发送侧） | P1 · core-storage + core-data | M | 判定/扫描段出事务，只留「补写 checkpoint 行 + 写游标」在短事务内 | C2-6（放大收益） |
| C2-3 | **CS-11** `session.copy` 事务内全量读 | P1 · core-data | M | `listBySession` 提到 `conn.transaction` 之外（对齐已治过的 `fork`） | — |
| C2-4 | **CS-06** `writeOrUpdateFile` 绕过 revision 层 | P1 · core-storage | M | 共享 `writeWithRevision` 落到 domain 层，batch ingest 复用 | — |
| C2-5 | **CS-07** blob 归零触发器不感知 `vfs_entry` | P1 · core-storage | S | **已注记化 → `wave-b-core2.md` §7 为权威片**（DELETE/UPDATE 触发器加 `AND NOT EXISTS (… vfs_entry …)` + 存量库重建 + 触发器改名纪律） | **必须在 C2-4 之后**（顺序表述见 N-1） |
| C2-6 | backfill 倒扫改单查询 JOIN | P1 · core-data | S | N 次 `hasCheckpoint` 倒扫 → 1 条 `JOIN … ORDER BY seq DESC LIMIT 1` | — |
| C2-7 | `listBySessionOffset` 头投影 | P1 · core-data | S | 21 列全量 → 6 列头投影，返回 `ChatMessageHeader[]` | — |
| C2-8 | **CS-09** ZIP 解析期体积/条数闸 | P1 · core-storage | M | 解析器内累加，越限抛 `PAYLOAD_TOO_LARGE`；**并堵住 fflate 回退绕过** | 建议与 Wave B 并行 |
| C2-9 | **CS-10** checkpoint 仓储三方法补 900 分片 | P1 · core-storage | M | 三处 `IN (#{idN}…)` 统一按 900 变量上限切块 | — |
| C2-10 | **CD-01** 回滚 plan 与事务内状态不同源（四步重排） | P1 · core-data | L | ① rewind 空树护栏 → ② 文件维度指纹乐观锁 → ③ 删集合事务内重算 → ④ tailIds 断言 | 与 C2-1/C2-2 同 PR（共享事务纪律） |
| C2-11 | **CS-03** LCS DP 滚动两行 + `Math.min(...arr)` spread 上限 | P1 · core-storage | M | DP 换两行 `Int32Array` + `Math.min(...arr)` 换循环 + 超 200 万格降级 | — |

Wave C 的编排口径（台账 §10）：本波是「有回归风险的性能结构」波，**验收全部按热路径标准**
（见 §末「全局回归线与纪律」）。

> **编号正名（judge-r1 A.2，2026-10-01 裁定）**：`ledger-v2.md:463`（§10 Wave C「全量读收窄系列」格）
> 里的「**CD-01** fork 缺上界读口」指的是 **CD-13**（`synth/core-data.md:96` 的原始编号），
> 与本文件的 **C2-10（CD-01 回滚 plan 不同源）** 无关——CD-13 归 `wave-c1.md` **C1-1**，
> 本文件不认领、不重复立项。台账那一行的改写由负责 SPEC 分配表的机位执行。

---

## C2-1 · CS-05 导入事务分片提交

**严重度/簇**：P1 · core-storage（VFS 导入落库层）｜量 L

### 病症

三个导入入口（ZIP 导入、角色卡导入、批量 ingest）都把「删旧子树 + 建全部父链 + 逐文件
建 entry/revision + 补目录规则行 + 全量扫消息补 checkpoint」塞进**一条**事务。条目数上限是
5000（`VFS_ZIP_MAX_ENTRY_COUNT` / `CHARACTER_CARD_MAX_FILE_COUNT`），最坏 5000 文件 ×
约 6 条语句 = 3 万条语句，外加 backfill 的「消息数 × 文件数」行插进同一条写事务。
移动端历史上就因为大事务触发过 SQLite 写磁盘临时表的 `disk I/O error`（RULE「TDBC 驱动层」条），
当前靠换 op-sqlite + `SQLITE_TEMP_STORE=2` 治了症状，**没治这条边界**。

台账把三条路径归并为一条（`synth/core-storage.md:119`），修法原文是「分片提交（每 200 文件
一个短事务）+ delete-prefix 单独先行 + backfill 移出事务」。

### 证据（`fe79b781` 实读）

`packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:199-243`：

```ts
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        ...
        for (const [logical, content] of files) {
          ...
          await ensureParentDirectories(repoTx, sk, logical);
          await insertFileSeedingRevision(repoTx, revisionTx, sk, logical, content);
        }
```

同文件 `:233-243`，backfill 在**同一条事务内**：

```ts
        if (this.backfillBaseline && scope.kind === "session") {
          const messageRepo = new SqliteMessageRepository(tx);
          await backfillBaselineCheckpoints(repoTx, messageRepo, checkpointRepo, scope.projectId, scope.sessionId);
```

`packages/core/src/service/vfs/impl/character-card-import.service.ts:140-182` 结构逐行同款
（`:171-181` 是同一段 backfill）。

`packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:290-306`（**与台账记的
`:351-367` 不一致，见下方校核**）：

```ts
    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        for (const dirLogical of plan.mkdirPaths) { await ensureEmptyDirectoryRow(repoTx, scope, dirLogical); }
        for (const write of plan.writes) { ... await writeOrUpdateFile(repoTx, scope, logical, write.content); }
      });
```

**行号校核**：台账 §2.4 CS-05 记的第三站点是 `vfs-batch-io.service.ts:351-367`（revalidate-a
注「batch 路径行号 `:291-305`→`:351-367`」）。在 `fe79b781` 上，`:291-305` 精确命中
`applyBatchIngest` 的那条单事务；`:351-367` 落在 `applyBatchIngestWithWriter` 的
mkdir 循环里（**偏移说明**：该循环实际是 `:360-367`，逐文件 writer 在 `:369-378`），
而**那个通道本来就没有事务**（逐文件走 writer、部分失败保留已成功项）。
⇒ 本条目以 `:290-306`（`applyBatchIngest`）为准；`:351-367` 记为台账行号漂移
（漂到了**无事务**的函数上，且比 mkdir 循环的真实起点宽 9 行），
judge 轮按本文件为准。

### 修法（文件 · 函数级）

**新增常量**（放 `packages/core/src/domain/vfs/logic/vfs-import-chunk.ts`，或直接加在
`vfs-batch-io.port.ts` 旁）：`ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK = 200`，注释理由写
「**事务持有时间上界**，与 `batchInsert` 口径取同一量级」。
⚠️ 不要再挂 `SQLITE_MAX_VARIABLE_NUMBER`：导入分片路径不使用变量列表，
「≤999 变量上限」这条约束对分片不成立（`SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK = 200`
那个常量是**变量数分块**用的，与本处无因果关系）。

**`vfs-zip-io.service.ts` · `DefaultVfsZipIoService.import`** 拆成四段：

1. **段 B0（独立短事务）**：`releaseAndDeleteVfsPrefix` + 目标目录行 `ensureEmptyDirectoryRow`
   + 全部显式 `directories` 的目录行。失败 ⇒ 直接抛（此时库里什么都没写）。
2. **段 B1..Bk（每片 ≤200 个文件的独立短事务）**：`ensureParentDirectories` +
   `insertFileSeedingRevision`。片与片之间 `await` 一次让步（RULE「事件循环让步按 16ms 时间
   量子而非逐语句」——**让步只能落在片与片之间，绝不能落在事务回调内部**）。
   任一片失败 ⇒ 走补偿（见下）后抛 `IMPORT_FAILED`。
3. **段 R（独立短事务）**：`ensureImportDirRules`。**目录全集不是 plan 阶段算出来的**，
   而是 `ensureImportDirRules` 内部在**调用时从库里现扫**
   （`ensure-import-dir-rules.ts:100-103` 的 `vfsRepo.listDirectoryPathsUnderPrefix(...)`）
   ⇒ 段 R **必须晚于全部片提交**，才能扫到完整集合。顺带比现状（在导入事务内扫未提交行）
   **更完整**：独立事务看不到任何未提交行，而全部片提交后连各片 `ensureParentDirectories`
   造出的隐式父链都在库里。helper 自吞错、不阻断导入的既有语义（`:222-231` 注释）保持不变。
4. **段 C + 段 D**：backfill 与缓存对齐，见 C2-2 与现状（`clearSessionPromptCaches` 保持在
   最后，`:257-260` 不动）。

**`character-card-import.service.ts` · `DefaultCharacterCardImportService.import`** 同样拆四段，
段内顺序与 ZIP 侧逐行对齐；`testHook.throwOnInsertLogical` / `onBeforeDeletePrefix` /
`createWorkplaceRepo` 三个钩子的调用点必须跟着搬家（`:143` / `:147` / `:162-166`），
`createWorkplaceRepo` 在段 R 里要传**段 R 那条事务的 `tx`**，不能传外层 `this.conn`。

**`vfs-batch-io.service.ts` · `DefaultVfsBatchIoService.applyBatchIngest`** 同样拆：
段 B0 = `mkdirPaths` 的目录行；段 B1..Bk = 每片 ≤200 个 `write` 调用（`writeOrUpdateFile`
本体按 C2-4 一并改造）。

**失败语义（契约变更，必须显式承认）**：

- 现状 = 「整批一条事务，任一项失败 ⇒ 域不变」。分片后 = 「已提交分片保留、失败片回滚」。
- **补偿函数写死为 `releaseAndDeleteVfsPrefix`，不得用 `deleteVfsPrefix`**：前者
  （`vfs-tree-copy.ts:418-425` → 内部转调 `sweepRevisionsUnderScope :390-411` =
  减 live ref → 删 entry → GC 无引用 revision）；后者（`:434-446`）**只**做
  `repo.deleteRecursiveIfAny`，既不减 live ref 也不 GC ⇒ 补偿后会留下一批 `ref_count = 1`
  的孤儿 `vfs_revision` 与 `vfs_content_blob` 永不回收。段 B0 用的也是同一函数（上面第 1 步），
  两处口径统一。补偿调用形态（跑在**独立事务**里，整体 try/catch 吞错、只记 `console.warn`）：
  `await releaseAndDeleteVfsPrefix(new SqliteVfsEntryRepository(tx), new SqliteVfsRevisionRepository(tx), sk, directoryPath)`。
  把半棵新树清掉，让域回到「目标前缀为空」的可重试态。
- **补偿的挂点层级（写死）**：补偿必须挂在**片失败的内层**——段 B1..Bk 的每一次
  `conn.transaction` 各自 try/catch，catch 内先跑补偿再上抛；**不能只挂外层 catch**。
  理由：`vfs-zip-io.service.ts:245-248` 有一条测试钩子直抛分支
  `if (error.message === "test import failure") throw error;` 位于 `IMPORT_FAILED` 包装
  **之前**（角色卡 `:147` 的 `throwOnInsertLogical` 抛的就是这个 message）⇒ 只挂外层
  catch 会被这条分支整个绕过，补偿永不执行。
- **补偿不恢复旧内容**（旧内容已在段 B0 删除）——这是本条唯一的真实行为损失，写进 PR 描述。
- 抛出的错误码保持 `IMPORT_FAILED`（`vfs-zip-io.service.ts:252-254` /
  `character-card-import.service.ts:190-192`），消息里带上「已提交 N 片 / 失败在第 K 片」。
  经测试钩子直抛分支抛出的仍是原始 `Error("test import failure")`（见验收 A4）。
- **口径纪律**：本波内 `deleteVfsPrefix` **不再是任何「删整个前缀」路径的入口**
  （段 B0 与补偿两处都已换成 `releaseAndDeleteVfsPrefix`）；C2-4 同族的
  `vfs-tree-copy` overlay 分支（N-P1-01 / CS-12 同族）若日后另立条目修，
  必须对齐这一口径，不得回退到裸 `deleteVfsPrefix`。
- **`applyBatchIngest` 的 report 契约变更（必须显式承认）**：现状 catch 是
  `return emptyReport(skippedBase, [{ path: failedPath, message }])`（`:307-318`）
  ⇒ `written` 恒为 `[]`，而 `:317` 那句注释「非 session：整批回滚 → written 必须为空」
  在分片后**已失效**——已提交分片的 `logical` 早已 push 进 `writtenLogical`（`:288/:304`），
  却在失败时被整个丢弃 ⇒ **report 对用户说谎**（声称一个都没写，实际写了 N 个）。
  分片后必须改为返回
  `{ written: 已提交分片的 logical 列表, skipped: skippedBase, failed: [{ path: 失败片首个 logical, message }] }`，
  并**删掉 `:317` 那条失效注释**（否则后来者会照着它把 `written` 又清空）。

**备选案（若不接受契约变更）**：保留单事务，只做 C2-2（backfill 出事务）+ 语句收敛
（`ensureParentDirectories` 的父链查询结果在片内复用、文件写走
`seedLiveHeadRevisionsUnderPrefix` 的批量路径）。此时分片降级为「语句分批，事务不切」，
台账原文的「分片提交」记为**未采纳 + 理由**，由用户在 execute-ready 时二选一。
**默认建议案 = 采纳分片**（与 ledger §2.4 一致）。

**附注（不在本条验收内）**：批量 ingest 通道没有条目数/体积闸门（`planBatchIngest` 对
`plan.writes` 无上限），ZIP/角色卡两条有。分片后单事务规模天然有界，风险显著下降，故
本波**不**补闸门；补闸门登记为 Wave E 债务。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| A1 分片数正确 | 新增用例：造 450 个文件的 ZIP，spy `conn.transaction` 的调用次数 | 段 B0×1 + 段 B1/B2/B3×3 + 段 R×1 = **5 次**（backfill 段另计） |
| A2 单片上界 | 同上，spy 每条事务内 `insertFileSeedingRevision` 的调用次数 | 任一片 ≤ **200** |
| A3 成功路径逐字节等价 | 450 文件 ZIP 导入后 `scanContents` + `listEntriesUnderPrefix` | 与段数无关；与旧实现同集合同内容 |
| A4 失败语义（新） | 第 3 片注入**既有**钩子：ZIP 与角色卡两侧都是 `testHook.throwOnInsertLogical`、批量是 `testHook.throwOnWriteLogical`（**不新增钩子**） | 抛出的仍是原始 `Error("test import failure")`（测试钩子直抛分支绕过了 `IMPORT_FAILED` 包装，**不要写成 `IMPORT_FAILED`**，那个断言在钩子路径上不可达）；前 2 片的文件**已被补偿删除**（补偿挂在片失败内层，见「失败语义」）；`/before.md`（旧内容）**不再存在**。另加一条**非测试钩子**的真实失败（让同一片里的 `ensureParentDirectories` 失败）⇒ 抛 `IMPORT_FAILED` + 消息含「已提交 N 片 / 失败在第 K 片」 |
| A5 零写库前置不变 | Phase A 失败用例（`vfs-zip-io.test.ts:269/:297/:536`） | 仍**不**进 `deleteVfsPrefix`（段 B0 之前就抛） |
| A6 性能（**计数式**，不卡墙钟） | 造 5000 文件 ZIP，spy `conn.transaction` 的调用次数 + 每条事务内的语句条数 | 事务调用次数 == `ceil(5000/200) + 2` = **27**（段 B0×1 + 片×25 + 段 R×1；backfill 段另计，见 C2-2 B1）；任一片事务内语句数 ≤ **200×K**（K = 单文件语句条数上界）；**backfill 段事务内 `vfs_entry` 写 = 0**。墙钟只作记录、不作门槛（旧形态的单事务基线在测试环境里跑不出来，「数量级下降」无从判定） |
| A7 命令 | `npm run test:fast -w packages/core -- test/vfs/vfs-zip-io.test.ts test/character-card/character-card-import.test.ts test/vfs/vfs-batch-io.test.ts` | 全绿 |

### 测试策略

- **改**（回归线迁移，见下）：`test/vfs/vfs-zip-io.test.ts:125` `Z5: transaction failure
  rolls back domain`；`test/character-card/character-card-import.test.ts:111`
  `G-1/Z5: Phase B insert 失败整事务回滚`；`test/vfs/vfs-batch-io.test.ts:117`
  `T-B6: mid-apply failure rolls back entire non-session batch`。三条的用例名与断言都要改写成
  A4 口径（用例名里「整事务回滚 / rolls back entire」必须换掉，否则后来者会按名字误判语义）。
  **`T-B6` 额外按 A-8 重写**：`written` 断言从「恒为空」改为「**等于已提交分片的 logical 列表**」，
  `failed[0].path` 断言为「失败片首个 logical」，并保留「未到失败片的文件不在 `written` 里」这条反向断言。
- **改（用例名去陈旧措辞，A-15）**：`test/vfs/vfs-zip-io.test.ts:1051` `T-Z10` 与
  `test/character-card/character-card-import.test.ts:298` `T-I5`，用例名里的
  「**补规则行语句真失败时不毒化导入事务**」要改成「补规则行语句真失败时**不影响导入整体成功**」——
  段 R 独立成事务后已无「共享导入事务」可毒化，留着旧名会误导后来者。
  注释同步改写，并**保留**「`createWorkplaceRepo(tx)` 拿到的仍是**段 R 那条事务**的 `tx`」
  这一事实断言（这是段 R 唯一还带着事务语义的地方）。行为不变，测试仍绿，属文档债清理。
- **新增** `test/vfs/vfs-import-shard.test.ts`：A1/A2/A3/A4 四条；外加三条计数式断言：
  ①「补偿失败也不掩盖主错误」（补偿里再抛 ⇒ 主错误仍是 A4 口径的那条）；
  ②**补偿后该前缀下 `vfs_revision` 零残留行**（直查表计数）——这条是「补偿必须用
  `releaseAndDeleteVfsPrefix` 而非 `deleteVfsPrefix`」的牙齿：裸 `deleteVfsPrefix`
  会留下一批 `ref_count = 1` 的孤儿 revision + 永不回收的 `vfs_content_blob`；
  ③ A6 的事务调用次数 / 单事务语句数上界 / backfill 段 0 次 `vfs_entry` 写。
- **新增** 用例：批量 ingest 401 文件 ⇒ 3 片；`plan.writes` 为空 ⇒ 只跑段 B0；
  分片失败时 `BatchApplyReport.written` 等于已提交片列表（A-8 契约）。

### 回归线（必须保持绿）

`test/vfs/vfs-zip-io.test.ts` 除 Z5 外全部（含 `Z4` 非法 UTF-8、`T-Z5` 恶意 `../`、
`T-Z9`/`T-Z10` 补规则行故障注入、`T-IC2`/`T-IC3` 缓存对齐、`Z9` GBK 全量覆盖无残留）；
`test/character-card/character-card-import.test.ts` 除 `G-1/Z5` 外全部（含 `T-I5`（补规则行语句
真失败**不影响导入整体成功**，用例名按 A-15 改）、`T-I8` 补规则行中途失败、`T-IC4` best-effort 吞错）；
`test/vfs/vfs-batch-io.test.ts` 除 `T-B6` 外全部；`test/vfs/vfs-tree-copy-batch.test.ts`。

### 依赖

- 依赖 C2-2（段 C 的 backfill 必须已经能独立成段，否则分片后 backfill 仍在某个片事务里）。
- C2-4 同在 `vfs-batch-io.service.ts`，建议与本条同 PR 落地（`writeOrUpdateFile` 的分片调用点
  与本条的分片循环是同一段代码）。

### 风险与回滚

- **风险 R1（最高）**：契约变更打到两条既有用例。缓解：必须同 PR 改测试 + PR 描述写明
  「ZIP/角色卡导入失败后旧内容不保留」。若 judge/用户不接受，退到备选案。
- **风险 R2**：段与段之间不再原子 ⇒ 并发 `capture` 可能拍到「半棵新树」。缓解：`applyBatchIngest`
  的失败路径已尽力补偿；且导入目标通常是用户刚打开的弹窗窗口，并发 capture 概率低。
- **风险 R3**：段 R 的目录全集靠**调用时现扫**（`listDirectoryPathsUnderPrefix`）拿到，
  若把 `ensureImportDirRules` 误放进某一片，就会漏补后续片造出的目录。
  缓解：段 R 单点实现 + 用例 `T-I2`/`T-I7`/`T-Z8` 覆盖「前缀下全部目录（含嵌套）都被补」。
- **回滚**：`git revert` 单个 commit 即可恢复单事务形态；无 schema 变更、无数据迁移，
  补偿删除对已失败的导入是幂等的。

---

## C2-2 · backfill 移出事务（导入侧 + 每轮发送侧）

**严重度/簇**：P1 · core-storage（导入装配）+ core-data（checkpoint 服务）｜量 M

### 病症

`backfillBaselineCheckpoints` 在两处被塞进**写事务**：

1. 导入侧（ZIP `:233-243`、角色卡 `:171-181`）——与 3 万条导入语句同一条事务；
2. 每轮发送侧（`DefaultMessageCheckpointService.backfillMissingBaselines`
   `message-checkpoint.service.ts:86-136`）——整段判定 + 全量扫描 + 补写全在一个事务里，
   而这条路径**每轮发送都跑**（`run-agent-turn.ts:667-674`）。

第 2 条必须按热路径验收：RULE 有一条明确记着「checkpoint backfill 的『无空窗』短路第二段
事实上恒失败 → 每轮发送前都回退全量扫描，所以任何对全量扫描的性能优化都是**热路径**优化」。

### 证据（`fe79b781` 实读）

`packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts:86-136`：

```ts
    await this.deps.conn.transaction(async (tx) => {
      const txMessages = new SqliteMessageRepository(tx);
      const decision = await decideBackfillShortCircuit({ sessionKkv: txSessionKkv, messageRepo: txMessages, checkpointRepo: txCheckpoints, sessionId });
      ...
      const result = await backfillBaselineCheckpoints(txEntries, txMessages, txCheckpoints, projectId, sessionId, signal);
```

同文件 `:70-73` 的注释自述这个锁语义：

```ts
   * @remarks backfillBaselineCheckpoints 移入事务内执行：复用 capture 同款锁语义，
   * 避免并发 backfill 读到未提交的 head；与导入路径同一份纯逻辑。
```

`packages/core/src/service/agent/logic/run-agent-turn.ts:667-674` 确认它在**每轮发送前奏**里：

```ts
    stage = "backfill-baseline-checkpoints";
    await runtime.messageCheckpoint.backfillMissingBaselines(scope.sessionId, scope.projectId, internalController.signal);
```

而全量扫描的成本在 `backfill-baseline-checkpoints.ts:164-177`（逐条 `hasCheckpoint` 倒扫，
与 `run-agent-turn.ts:668` 的注释「这段扫描是大会话上秒级的第一站」互证）。

### 修法（文件 · 函数级）

**A. 导入侧**（`vfs-zip-io.service.ts` / `character-card-import.service.ts`）：
C2-1 的段 C —— 全部导入事务提交之后跑，且自己开一条**只装补写语句**的短事务：

```ts
// 全部导入事务提交之后（段 B0..Bk + 段 R 之后、clearSessionPromptCaches 之前）
if (this.backfillBaseline && scope.kind === "session") {
  try {
    await this.conn.transaction(async (tx) => {
      await backfillBaselineCheckpoints(
        new SqliteVfsEntryRepository(tx),
        new SqliteMessageRepository(tx),
        new SqliteMessageCheckpointRepository(tx),
        scope.projectId,
        scope.sessionId
      );
    });
  } catch (error) {
    console.warn("[vfs-zip-io] baseline checkpoint backfill failed", error);
  }
}
```

- **best-effort 口径**与紧邻的 `clearSessionPromptCaches` 一致（RULE「导入缓存对齐」条：
  「导入走 helper 整体 try/catch 吞错 + `console.warn`」），且不得再被包进 `IMPORT_FAILED`。
- 语义等价性论证（必须写进 PR 描述）：backfill 读的是「导入提交后的 live head」，
  原实现在同一事务内读到的是「自己刚插入、尚未提交的 head」——两者内容相同，
  因为 `insertFileSeedingRevision` 已经把 head 与 revision 同步落库。
- **RULE 硬约束**：事务回调里**所有 repo 都必须用回调传入的 `tx` 构造**。绝不能在里面用
  `this.conn` 调任何服务——驱动层 AsyncMutex 不可重入，那是死锁不是报错。

**B. 每轮发送侧**（`message-checkpoint.service.ts::backfillMissingBaselines`）拆三段：

- **段 0（事务外，只读）**：`decideBackfillShortCircuit`，用 `this.deps.conn` 构造的
  `SqliteMessageRepository` / `SqliteMessageCheckpointRepository` / `SqliteSessionKkvRepository`。
- **段 1（事务外，只读）**：`listSessionFileHeads` + `listMessageHeadersBySession` +
  「定位首个空窗」（改走 C2-6 的单查询）。产出 `gapMessageIds` 与 `filePointers`。
  两处 `signal?.aborted` 弃权点（`backfill-baseline-checkpoints.ts:169` 与 `:194`）
  **必须原样保留**：中止态返回 `confirmedNoGap: false`，游标不前移。
- **段 2（短事务，只写）**：进入 `conn.transaction`，**第一步不是重查「最后一个 checkpointed
  message id」，而是对段 1 已算出的 `gapMessageIds` 做「连续前缀复核」**——正确形态见下面
  「TOCTOU 闭合方案（已拍板）」。复核后为空则直接提交退出；
  否则逐条 `insertCheckpoint` + 写游标（`newCursor !== previousCursor` 才写，与现状 `:107-114`
  一致），`confirmedNoGap` 为真才写游标。

**TOCTOU 闭合方案（已拍板，选案 ②「gap 段逐条复核」）**：

- **为什么不能只靠「段 2 重查一次」**：段 1 与段 2 之间有 `await` 边界。若并发 `capture`
  （`message-checkpoint.service.ts:41-67`；每次 user append / 改了工作区的 assistant 都会调）
  **落在 gap 中段**（例如为消息 7 建点，而段 1 算出的 gap 是 6..10），段 2 重查
  `findLastCheckpointedMessageId` 得到 7 ⇒ `firstGapIndex = idx(7) + 1` ⇒ **消息 6 被永久跳过**：
  下一轮重查仍返回 7，6 再也进不了 gap 段。这与 RULE:126 关心的「剩余空窗永远补不上」
  是同一类永久性缺口，只是成因从「游标误前移」换成「gap 中段被并发插点」。
- **选案 ②（采用）**：gap 的起点**不由「最后一个 checkpointed id」单点收敛**，段 2 只对
  段 1 已算出的 `gapMessageIds` 做**逐条 `hasCheckpoint` 复核**——从 gap 头开始，
  **只在连续命中**（`messages[gapStart + t]` 本来就有点）时跳过该条，一旦遇到未命中就停下，
  之后全部照写。并发在 gap 中段插点时被跳过的只是「本来就是点」的连续前缀，
  未被覆盖的那一条及其之后全部照写 ⇒ **天然免疫**。
  gap 通常 1–3 条 ⇒ 复杂度仍是 **O(1) 查询 + O(gap) 次 `hasCheckpoint`**，与段 1 的零倒扫不冲突。
- **落选案 ①**（把重查基线取 `max(lastCheckpointedId, gap 起点之前的最后一条)`，或直接重跑
  `decideBackfillShortCircuit` + 重取 headers 后重算 gap）：两个变体最终都还是用
  「最后一个 checkpointed id」单点决定 gap 起点，在 gap 中段并发插点下**同样**把起点后移
  ⇒ 不闭合，落选。
- **联动 C2-6 的 F1**：`hasCheckpoint` 不再是「恒 0」；F1 的期望改为「调用次数 ≤
  `gapMessageIds.length` 且**与消息总数 M 无关**」（旧实现下是 O(M) ⇒ 仍有牙）。
  与 B6 的计数式断言（M=200 与 M=2000 两次调用数相等）互为印证。
- 理由必须写进 PR 描述。

**单连接单写者不变量**（写进代码注释）：本仓所有写都经同一个 `TdbcConnection`，驱动层
AsyncMutex 把它串行化 ⇒ **段 2 事务一旦开始，到提交之前不存在并发写**。
⚠️ 但段 1 与段 2 之间**仍然可以有别的写插进来**（段 1 没有锁，这正是 TOCTOU 的来源，
由上面选案②的连续前缀复核闭合）。这是本条能把只读段提出事务的前提，
**且仅对本仓单 `TdbcConnection` 形态成立，不要在别的连接形态下照抄**。

**段 1 的 stale-by-one 是有意的**：`listSessionFileHeads` 在事务外读，得到的 `filePointers`
可能比并发 `capture` 拍下的 head 旧一版。checkpoint 的语义本就是「某时刻的指针快照」，
旧一版合法；把 head 扫描留进事务只对「想拍最新 head」的 `capture` 有意义，而 backfill 是
**基线**回滚锚点，不是最新态。原 `:70-73` 的注释据此改写（保留 capture 那份不动）。
**消息 header 列表同样允许 stale**（段 1 的 `listMessageHeadersBySession` 也在事务外）：
段 1/段 2 之间若有新消息 append，本轮 `gapMessageIds` 会漏掉它们，但下一轮就补上，
**不会永久漏**（缺口只在本轮存在）。这与「`confirmedNoGap` 为真才写游标」是配套的：
那种情形下游标**不**前移 ⇒ 下轮必然回退全量扫描（`message-checkpoint.service.ts:128-135`），
新消息立刻被纳入 gap。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| B1 导入侧事务数 | 450 文件 ZIP + session scope，spy `conn.transaction` | backfill 段**独立成一条**事务（实测全流程 `transactionCount = 6`，backfill 是最后一条），且其内**零 `vfs_entry` 写**（旧形态下这里是 450 个文件的导入写）。🔁 **勘误（2026-10-01 实测，impl 落地回写）**：原文写「其内**只有** checkpoint 相关语句」**不成立**——该短事务内**含读**：判空 + 探针（`SELECT` 列了 `vfs_entry` + 投影）与 `JOIN` 定位都在事务内。正确的口径是「**零 `vfs_entry` 写**」，读可以有；断言请按「无 `vfs_entry` 写」写，别按「只有写」写 |
| B2 导入侧 best-effort | 注入 `createWorkplaceRepo` 抛错（复刻 `T-I5` 手法）+ 让 backfill 也抛 | 导入整体成功；日志含 warn；**新内容完整可读**（逐字节等于源 ZIP）+ `workplace_dir_rule` 无残留脏行。⚠️ **不能写「旧内容可读」**：导入是**全量覆盖**语义（`vfs-zip-io.test.ts:409` `Z9: GBK ZIP 全量覆盖后无旧文件残留` 已钉死），旧内容早在段 B0 就被删了，「旧内容可读」永远为假 |
| B3 段 0/段 1 无事务 | spy `conn.transaction`，跑「无空窗短路」与「有空窗补写」两条路径 | 🔁 **勘误（2026-10-01 实测，impl 落地回写）**：**短路路径的事务调用数是 `0`，不是原文写的 `1`**——段 0（判空）与段 1（取指针快照）都在事务外；第一轮那次「建游标」的写事务属于游标初始化、不计入本次 backfill 的 `transactionCount`（旧形态下判空在事务内、且每轮都写游标，才有 1）。补写路径 = **恰好 1 条短事务**（不是按 gap 条数开事务），事务内语句数与 `gapMessageIds.length`（gap 段长度）成正比且**与消息总数 M 无关** |
| B4 中止语义不回归 | 复用 `test/message-checkpoint/backfill-abort-signal.test.ts` 第一个 describe 的 **5** 条 + service 级 **1** 条（**5+1**；旧稿写的「4 条」是错的） | **重写后**全绿（改写清单见下面「测试策略」，与 C2-6 写的是**同一份**，勿各写各的）；中止后游标**不**前移 |
| B5 幂等 | 连跑两轮 `backfillMissingBaselines` | 第二轮不新增 checkpoint 行（`message_checkpoint` 行数不变） |
| B6 热路径收益（**计数式**，不卡墙钟） | 造 M=200 与 M=2000 两条会话（各留末 3 条无 checkpoint），spy `conn.execute` / `queryTemplate` 的调用次数 | 两次的调用次数**相等**（== 常数 + O(gap 段长度)，**与 M 无关**）⇒ 这就是「零倒扫」的最强牙齿；旧实现下 M=2000 那个是 O(M) 次单行读 ⇒ 有牙。墙钟只作记录、不作门槛（造 2000 条消息 + 墙钟在并行 worker 下噪声大，且旧形态基线在测试环境里跑不出来，「数量级下降」无从判定） |
| B7 命令 | `npm run test:fast -w packages/core -- test/message-checkpoint/backfill-cursor.test.ts test/message-checkpoint/backfill-abort-signal.test.ts test/message-checkpoint/rollback-backfill-baseline.test.ts test/message-checkpoint/rollback-backfill-baseline-op.test.ts` | 全绿 |

### 测试策略

- **新增** `test/message-checkpoint/backfill-transaction-scope.test.ts`：B1/B2/B3/B5。
  B3 的观测面用「事务回调内执行的语句条数」与「事务调用次数」，**不要**用 `spyListBySession`
  （RULE 明写：实现换读口后这类断言会集体静默失效）。
- **改（复核）** `test/message-checkpoint/backfill-cursor.test.ts`：它对 `decideBackfillShortCircuit`
  做了大量 mock，其中 `listBySessionOffset` 的 mock（`:76-85`）返回值结构会随 C2-7 一起变；
  两处改动同 PR 时人工核对 mock 只需 `id`/`seq`。
- **改** `test/message-checkpoint/backfill-abort-signal.test.ts`——**改写清单（与 C2-6 的测试
  策略是同一份，两处必须逐字一致，勿各写各的）**：
  1. **条数 = 5 + 1**：第一个 `describe` 里 5 条 `it`——`入场即 aborted`（`:112`）、
     `倒扫中 abort`（`:147`）、`倒扫跑完才 abort`（`:166`）、`插入中 abort`（`:183`）、
     `不传 signal`（`:201`）；第二个 `describe`（`:231` 起）里 service 级
     `T-BACKFILL-ABORT-SVC`（`:251`）1 条。旧稿写的「全部 4 条」是错的（RULE:115：
     条数结论一律实测复核）。
  2. **`:147` / `:166` / `:201` 三条必须重写**：它们断言的是 `h.hasCalls() === 3` /
     `h.hasCalls() === 4` / `hasCheckpoint.callCount() === 6`，而倒扫循环一旦消失，
     `hasCheckpoint` 一次都不再被调 ⇒ 这三个期望值结构上不可能满足，**必然红**。
     改成与 `:183` 同形态：「abort 在 `insertCheckpoint` 第 N 次后翻真 ⇒ 只写 N 条 +
     `confirmedNoGap === false` + 游标不前移」，观测面换成 `insertCheckpoint` 的调用次数。
  3. **`:112` 恒真，必须换观测面**：它断言 `hasCheckpoint.callCount() === 0`，改后仍绿，
     但把整段扫描删掉也绿（牙齿判据①不过）。改成断言「`findLastCheckpointedMessageId`
     在 aborted 入场时**未被调用**」，并把弃权点明确前移到该调用**之前**
     （即 `listSessionFileHeads` / `listMessageHeadersBySession` 之后），保住这条既有的
     「入场即 aborted 零 `hasCheckpoint`」性质不被稀释。
  4. harness（`:88/:123/:211`）mock 了 `listMessageHeadersBySession`，需补
     `findLastCheckpointedMessageId` 的 mock。
- **复用** `checkpoint-capture-transactional.test.ts`（capture 的事务语义必须**不受影响**，
  本条只动 backfill）。

### 回归线

`test/message-checkpoint/` 全目录（含 `capture.test.ts`、`rollback-*.test.ts` 全部 20+ 条）；
`test/service/agent/run-agent-turn*.test.ts`（T-DS4/T-DS5/T-B4 三条 backfill 契约锁）；
`test/character-card/character-card-import.test.ts` 的 `T-IC1`/`T-IC4`（导入 + 缓存对齐顺序）；
`test/vfs/vfs-zip-io.test.ts` 的 `T-IC2`/`T-IC3`。

### 依赖

- **C2-6 是本条的前置**：倒扫改单查询之前，把倒扫提出事务只是把 O(M) 次单行读换了个地方；
  两步一起做才把「每轮发送」这条热路径压到 O(1) 查询 + O(gap) 写。
- C2-1 依赖本条（段 C 的定义在本条）。

### 风险与回滚

- **风险 R1**：`insertCheckpoint` 是「先 DELETE 旧行再 INSERT」的**替换**语义
  （`sqlite-message-checkpoint.repository.ts:137-204`），若段 2 误把已有 checkpoint 的消息
  算进 gap，会替换掉别人刚拍的点并做一次 ref −1/+1 抵消。缓解：段 2 开头的
  **「连续前缀复核」**保证只跳过「本来就是点」的连续前缀；用例 B5 专盯这一条
  （B7 的 TOCTOU 拍板案②同时让这条风险从「靠重查」变成「结构性免疫」）。
- **风险 R2**：`AbortSignal` 弃权点被"顺手"删掉 ⇒ 中止态把「只补了一半」误认成「已确认无空窗」，
  剩余空窗永远补不上（RULE r3-run-4 的原话）。缓解：B4 是专门为此设的回归锁。
- **回滚**：无 schema 变更；`git revert` 即回到单事务形态。

---

## C2-3 · CS-11 `session.copy` 事务内全量读

**严重度/簇**：P1 · core-data（chat 会话服务）｜量 M

### 病症

`session.service.ts::copy` 在一条写事务里对源会话做**全量消息读**（21 列、含 hidden、
含正文），随后 `batchInsert` 再对每条重跑 `JSON.stringify`。大会话上一次复制 =
N 次 `JSON.parse` + N 次 `JSON.stringify` 全程**独占连接写锁**。
同域的 `fork` 已经治过（`message.service.ts:320` 的 list 在 `:328` 的事务之外），
copy 是漏网的那个——这是一个明确的**不对称缺陷**，不是取舍。

### 证据（`fe79b781` 实读）

`packages/core/src/service/chat/impl/session.service.ts:352 / 388 / 396`：

```ts
    return this.deps.conn.transaction(async (tx) {
      const r = reposFor(tx);
      ...
      const messages = await r.messages.listBySession(source.id);   // :388 事务内全量读
      ...
      await r.messages.batchInsert(copyMessages);                  // :396 事务内逐条 stringify
```

对照组 `packages/core/src/service/chat/impl/message.service.ts:320 / 328`：

```ts
    const all = await this.deps.messages.listBySession(sessionId);   // :320 事务外
    ...
    return this.deps.conn.transaction(async (tx) => {                // :328 事务才开始
```

台账 §9 附录 A 已把本条的「解压半边」标 stale（写侧明文化后不再压缩），
**留下的半边就是「事务内全量读」**，台账 §2.4 CS-11 的改写后修法原文是
「copy 走 `listMessageHeadersBySession` + 事务外取 body 段，或让 copy 走
`INSERT ... SELECT` 直复 `content_json`（明文列）」。

### 修法（文件 · 函数级）

**主修法（必做、零契约变更、diff 最小）**：把 `:388` 的 `listBySession` 提到
`this.deps.conn.transaction(...)` **之前**，与 `fork` 逐行同款。`r` 由 `reposFor(tx)`
构造的部分保持不变，只有 `messages` 改用 `reposFor(this.deps.conn)` 在事务外取。

- **本条主修法偏离台账建议，须显式声明**（sr1-c2-b §3.6）：台账 §2.4 CS-11 的改写后修法给的是
  「copy 走 `listMessageHeadersBySession` + 事务外取 body 段，**或**让 copy 走
  `INSERT ... SELECT` 直复 `content_json`」；本条主修法取的是**第三条路**——把 `listBySession`
  整体提到事务外（diff 更小、不新增读口与仓储方法）。理由见下「为什么不能只用头投影」。
  写进 PR 描述，免得 judge 把它当成漏看台账而当成缺陷。
- `newMessages`（`:389-395`）的构造也随之移出事务——它只是 `randomUUID()` + 对象展开。
- 事务体从 `:353` 开始，依次是 `insert(copy)` / agent config / `copyVfsTree` /
  `batchInsert(copyMessages)` / `adjustReadRefCount` / `seedForkCopyParity`，顺序不变。

**为什么不能只用头投影**（必须写进 PR 描述，否则 reviewer 会提）：copy 后面要用
`aggregateReadRefs(messages.map((m) => m.content))`（`:399-403`）统计 contentRef 并对源
revision +1，这一步**必须拿到 blocks**。头投影只能省掉 `batchInsert` 那一侧的
`JSON.stringify`，省不掉读侧的 `parse`。所以主修法的收益全部来自
「不再在写事务里做 N 次 parse」。

**次修法（可选、与主修法同 PR 或紧随）**：`INSERT ... SELECT` 直复明文列。
`SqliteMessageRepository` 新增 `batchInsertSelectingSource(sourceSessionId, targetSessionId,
newIds)`：用一条固定 arity 的 SQL（`conn.execute` + 位置占位 `?`，**不走 `SqlTemplateParser`**
——见 C2-9 的注记，模板缓存对变长 arity 是无界的）把
`content_json / content_encoding / content_blob / provider / provider_id / raw_json /
hidden / attachments_json / 七个 token 列 / model_name` 整列 SELECT 过来，
只覆盖 `id / session_id`（新 UUID）与 `seq`（按序对齐）。
- 收益：省掉 N 次 `JSON.parse`（insert 侧）+ N 次 `JSON.stringify`（write 侧）。
- 成本与风险：语句长度与正确性验证面明显变大；`read-ref` 聚合仍需 parse。
  **判定：收益中等、风险偏高 ⇒ 列为可选，不进本条默认验收**。
  若实施，必须补「新旧两条实现对拍」用例（同夹具、同 seq 分布，逐列比对）。
- 三列齐置的 P0 约束（`sqlite-message.repository.ts:426-431`）**只约束 `updateContent`**；
  `INSERT ... SELECT` 是原样复制三列，不违反它，但要在注释里写明「三列同源复制，
  不存在只写 content_json 的情形」。
  ⚠️ 这条**只约束本节的可选路径**（次修法不进默认验收，见上），不是主修法的约束。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| C1 事务内零全量读 | spy `SqliteMessageRepository.listBySession`，跑 `copy` | `listBySession` 的调用**发生在** `conn.transaction` 回调之外；回调内消息相关语句只有 `batchInsert` 的分片 INSERT |
| C2 与 fork 对称 | 新增用例断言 copy 与 fork 的「读/写顺序」形状一致 | 两者都是「事务外 list → 事务内写」 |
| C3 复制结果等价 | 造 3 条消息（含 hidden 行、带 attachments、带 usage、含 legacy `content_blob` 非空行），`copy` 后逐字段比对 | **除 `content_encoding` / `content_blob` 两列按明文化正形态断言为 NULL 外**，其余字段逐字段一致（含 `hidden` / `attachments` / token 列）。⚠️ **blob 两列不做逐字段比对**（sr1-c2-b §3.1 must-fix）：写侧 `toMessageParams`（`sqlite-message.repository.ts:59-60`）对这两列**无条件写 `null`**，所以 copy 一条 legacy 压缩行的必然结果是「源行 `content_encoding='zlib' / content_blob=<bytes>`，副本行 `content_encoding=NULL / content_blob=NULL / content_json=明文`」⇒ 逐字段比对这两列**必然红**。**legacy 压缩源行经 copy 归一为明文行，这是明文化拍板（`novel-master-bootstrap.ts:102-109`）的正形态，不是回归** |
| C4 事务时长 | 大夹具（500 条）测 copy 墙钟 | 数量级回归线；主修法后写事务持有时间应显著下降 |
| C5 既有对拍 | `npm run test:fast -w packages/core -- test/chat/fork-copy-batch-insert.test.ts test/chat/fork-copy-parity.test.ts` | 全绿（这两条已钉「INSERT 只发 N 条 batch」） |
| C6 命令 | `npm run test:fast -w packages/core -- test/service/chat/` | 全绿 |

### 测试策略

- **改** `test/chat/fork-copy-batch-insert.test.ts`：它用 SQL 探针统计 `INSERT INTO chat_message`
  的条数（`:75` / `:125` 两条）。主修法不动 SQL 形态，应保持绿；**若同时实施次修法**，
  这两条断言必须改成「结果等价 + INSERT 条数不增」。
- **新增** 用例进 `test/service/chat/`：C1/C2/C3。
- **新增** 回归锁：`listBySession` 的调用点必须不在事务内 —— 用一个 Proxy `conn` 在
  `transaction` 回调执行期间打标记，若 `listBySession` 在标记为 true 的窗口里被调用则红。
  这条断言在旧实现下**必然红**（有牙）。

### 回归线

`test/chat/fork-copy-*.test.ts`（**2 个**：`fork-copy-batch-insert.test.ts` /
`fork-copy-parity.test.ts`；第三个 `session-run-state.fork-copy-guard.test.ts` 在
`test/session-run-state/` 下，不命中该 glob——sr1-c2-b §3.7 修正）、
`test/chat/message-repository-yield.test.ts`
（`mapRows` 的让步语义）、`test/vfs/read-ref-count.test.ts`（源 revision +1）、
`test/message-checkpoint/` 全目录（`seedForkCopyParity` 建 checkpoint）、
`test/session-fs/` 全目录。

### 依赖

- 无前置。与 C2-2 独立（不同文件、不同连接使用）。
- 注记：`ledger §0.4` 提到 `CD-02`（`truncateAfter`）的 TOCTOU 未修同款问题。本条引入的
  「事务外读」同理带一条 TOCTOU 窗口（源会话在读与写之间可能被改），对 copy 的后果是
  「复制到一个稍旧快照」——**可接受**（copy 语义是快照），但必须在 PR 描述里点名，
  不要让 reviewer 当成新发现的 bug 再报一次。

### 风险与回滚

- **风险 R1**：源会话在事务外读之后被并发修改（agent 正在跑）⇒ 复制出不一致快照。
  缓解：文案层已接受；不引入新锁（引入新锁会退化成今天的全事务形态）。
- **风险 R2**：把 `r` 误留在事务外用（`reposFor(this.deps.conn)` 的 repo 在事务回调里被调用）
  ⇒ AsyncMutex 不可重入死锁。缓解：code review 硬盯「事务回调里出现的每一个 repo 都来自 `tx`」。
- **回滚**：无 schema 变更，单函数 diff，`git revert` 即回。

---

## C2-4 · CS-06 `writeOrUpdateFile` 绕过 revision 层

**严重度/簇**：P1 · core-storage（VFS 批量 ingest）｜量 M

### 病症

批量 ingest 的非 session 通道用 `writeOrUpdateFile` 直接写 `vfs_entry`，
**不 append `vfs_revision`、不动 `ref_count`**。结果是 `vfs_entry.head_version` 指向
`vfs_revision` 里根本不存在的版本（悬空 head）。`findMissingRevisionPointers`
（`detect-missing-revisions.ts:23`）只在 checkpoint 指针路径上跑，发现不了悬空 head。
后续任一 checkpoint 钉住该 head ⇒ `incrementRefsForCheckpointFiles` 抛
`VfsError NOT_FOUND: Revision not found`；再正常写一次则 `transferLiveRef(-1)` 打在不存在的
行上静默 no-op ⇒ 真 head 的 ref 停在 1 ⇒ **该 revision 与其 blob 永久不可回收**。

代码里那句注释对 `DefaultVfsService` 成立，对 project/global 域是错的。

### 证据（`fe79b781` 实读）

`packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:100-101`（`writeOrUpdateFile` 本体
定义在 `:84-102`；原写 `:98-102`，实测落在 `:100-101`——sr1-c2-b 更正）：

```ts
  // 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义
  await repo.update(sk, logical, content, existing.version + 1);
```

调用点：同文件 `:303`（`applyBatchIngest` 事务内，**台账 §2.4 记的 `:167-185` 已漂移，
实读在 `:84-102` 定义 + `:303` 调用**）。

路由面 `apps/desktop/src/main/services/vfs-batch.service.ts:210-226` 确认：
非 session scope（且 user-vfs-turn 未开）**全部**走 `applyBatchIngest`：

```ts
  if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) { … }
  else { report = await batch.applyBatchIngest(scope, targetDir, plan, applyOptions); }
```

（该文件 desktop 侧行号 `:210-226` 与台账一致。）

### 修法（文件 · 函数级）

**不能直接用 `insertFileSeedingRevision`**（必须写进 PR 描述，否则实施者会踩）：
`seed-live-head-revisions.ts:104-120`，当 entry 已存在但**没有任何 revision** 时会走
`entryRepo.insert(...)`，而 `insert` → `insertAtVersion` 是裸 `INSERT`
（`sqlite-vfs-entry.repository.ts:294-311`），撞 `vfs_entry` 的
`UNIQUE(scope_key, path)`（`bootstrap/vfs/vfs-schema.ts:23`）⇒ 覆盖写入场景必炸。

**实施**：

1. 把 `revision-aware-vfs.service.ts:317` 的模块私有 `writeWithRevision`
   （连同它的两个私有辅助 `resolveMaxRevision` / `nextVersionFor`）**下沉**为
   `packages/core/src/domain/vfs/logic/write-with-revision.ts` 的导出函数
   （**无 service 依赖的领域函数**，只吃两个 repo ⇒ 不违反分层）。
   ⚠️ **它不是纯函数**：有 IO（走两个 repo）、且读 `Date.now()`。已核外部依赖
   `normalizePath` / `assertValidVfsEntryName` / `ensureParentDirectories` /
   `adjustRef` / `transferLiveRef` 全在 domain 层、`vfsIsDirectory` 在 errors 层，
   **零 service 层依赖**（所以「下沉不违反分层」成立），但**别让实施者按纯函数去写
   单测 expectation**（sr1-c2-b §2 重点问①）。
   ⚠️ **删除路径要反向 import 回来**：辅助 `nextVersionFor` 在同文件还有第二个调用者——
   `:539` 的 `appendDeletedRevision`（`:477` 的 `appendDeletedRevisionsForSubtree` 内联了
   同款 `Math.max`）⇒ 两个辅助下沉后，`revision-aware-vfs.service.ts` 的删除路径必须
   **反向 import** 回来，否则编译不过 / 行为退化。风险 R1 只说了「别漏带」，
   实施步骤在此补齐这一句（sr1-c2-b §2 重点问①）。
2. `revision-aware-vfs.service.ts:89` 改为 import 该函数，行为**逐字节不变**。
3. `vfs-batch-io.service.ts` 的 `writeOrUpdateFile`（`:84-102`）整个删掉，改为在
   `applyBatchIngest` 的每个分片事务里：
   `await writeWithRevision(new SqliteVfsEntryRepository(tx), new SqliteVfsRevisionRepository(tx), sk, logical, content)`。
   `ensureParentDirectories` 保留（`writeWithRevision` 内部只在**新建**时调它，
   批量 ingest 允许覆盖已有路径，所以父链仍要外面保底）。
4. 版本语义变化（必须记进 PR 描述）：旧的 `existing.version + 1` → 新的
   `nextVersionFor` = `max(head_version, MAX(vfs_revision.version)) + 1`，
   避开「head 回拨后历史占号段」。

**已知错误语义差异**：旧代码对「目标是 directory」抛
`new Error("cannot overwrite directory with file")`；`writeWithRevision` 抛
`vfsIsDirectory(...)`（`VfsError`）。消费侧 `applyBatchIngest` 的 catch 只取
`error.message`（`:308-318`）⇒ 安全，无需额外适配。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| D1 无悬空 head | 造 project scope、批量 ingest 3 个文件（含 1 个覆盖写），查 `vfs_revision` | 每个 entry 的 `head_version` 都**有**对应的 `(entry_id, version)` 行 |
| D2 ref_count 正确 | 查 `vfs_revision.ref_count` | 新建文件 ref=1（live head）；覆盖写后旧版本 ref=0、新版本 ref=1 |
| D3 不抛 NOT_FOUND | 建 checkpoint 钉住批量导入的文件，再读 | `incrementRefsForCheckpointFiles` 不抛 `NOT_FOUND` |
| D4 负向（防 CS-07 复发） | 复用 D1 的库，删掉**另一条**引用同 `content_hash` 的 revision | 🔁 **勘误（2026-10-01 实测，impl 落地回写）：本行的「blob 行仍在」是 CS-07 落地前的过渡态残留，已作废**——`wave-b-core2.md` §7 的归零触发器已落（`vfs-revision-schema.ts`：revision DELETE/UPDATE 时 `vfs_content_blob.ref_count` 递减、归零即 `DELETE`），所以删掉另一条引用后 blob 行**会被回收、不再残留**。本条真正要锁的负向只剩后半句「**entry 有 hash 无 revision** 的悬空 head 不再产生」。（同一过渡态残留另见本文件 `:141` 与 `:209` 的「blob 永不回收」表述，读到时按本行口径为准） |
| D5 覆盖写版本单调 | 先用普通 `vfs.write` 建文件（v1/v2），再批量 ingest 覆盖 | head_version = 3，连续无洞 |
| D6 回滚用例不变 | `test/vfs/vfs-batch-io.test.ts::T-B6` | 保持绿（分片后按 C2-1 改写，本条不动） |
| D7 desktop 路由 | `apps/desktop` 侧跑既有 vfs-batch 相关用例 | 全绿 |
| D8 命令 | `npm run test:fast -w packages/core -- test/vfs/vfs-batch-io.test.ts test/vfs/revision-aware-vfs.service.test.ts test/vfs/revision-ref-count.test.ts test/vfs/read-ref-count.test.ts test/vfs/orphan-revision-gc.test.ts` | 全绿 |

### 测试策略

- **新增** `test/vfs/vfs-batch-ingest-revision-alignment.test.ts`：D1/D2/D3/D5。
  D1 的观测面用**直查表**（`SELECT version FROM vfs_revision WHERE entry_id = ?`），
  不用「read 必抛/必不抛」——RULE 明写内容寻址缓存命中会让后者失真。
- **新增** 用例进 `test/vfs/revision-aware-vfs.service.test.ts`：`writeWithRevision`
  下沉后行为逐字节不变（含「同文短路不 bump」「head 回拨后不撞号」两条既有语义）。
- **复用** `entry-sequence-repair.test.ts`（head/revision 序列一致性）。

### 回归线

`test/vfs/` 全目录（30+ 条）；`test/domain/`、`test/message-checkpoint/revision-gc.test.ts`、
`test/message-checkpoint/deferred-revision-orphan-gc.test.ts`；
`apps/desktop` 的 vfs-batch 用例。

### 依赖

- **无前置**。C2-5（CS-07）**依赖本条**。
- 与 C2-1 同文件同函数段，建议同 PR。

### 风险与回滚

- **风险 R1**：`writeWithRevision` 下沉时漏带 `resolveMaxRevision` / `nextVersionFor` ⇒
  「vfs_entry 被删但 revision 历史还在」的边界行为退化。缓解：用例必须覆盖
  `revision-aware-vfs.service.test.ts` 的既有边界用例。
- **风险 R2**：新建路径现在会多跑 `assertValidVfsEntryName`（`writeWithRevision` 只在
  `existing == null` 分支（`:333-336`）调）。
  ⚠️ **「正常路径不触发」的前提不成立**（sr1-c2-b §3.2 must-fix）：
  `normalizeBatchRelativePath`（`vfs-batch-path.ts:16-44`）只做整体 trim、反斜杠转正斜杠、
  去首尾 `/`、按 `/` 切段、丢弃空段与 `.` 段、遇 `..` 返回 null——**不过滤控制字符，
  也不管单段的首尾空白**；而 `assertValidVfsEntryName`（`validate-entry-name.ts:31-48`）
  **拒绝** C0/C1 控制字符（含 `\n \r \t`）、纯空白名、**首尾空格**、`.` / `..`。
  ⇒ 一个叫 `foo.md `（尾空格）或含 `\x01` 的 ZIP 条目，`normalizeBatchRelativePath` 放行、
  `assertValidVfsEntryName` 拦下；批量 ingest 的输入恰恰是**外部文件名**。
  ⚠️ **更要紧的是这撞上一条成文拍板**：`validate-entry-name.ts:27-31` 的 JSDoc 写明
  「只拦『用户/agent 显式创建与重命名』的入口；**导入链路（zip/角色卡）不走本校验**
  （外部文件名可先导入再用改名功能纠正）」，`:64-65` 的 `assertValidVfsEntryName` 自己也写着
  「只在『新条目诞生』的时机调用……存量条目的内容更新不重新审判名字」。批量 ingest 是 zip 导入的
  **创建**通道 ⇒ 按现写法会**改变一条已拍板的导入语义**：以前能导入的外部文件名，改后导入失败
  （抛 `VfsError`，被 `applyBatchIngest` 的 catch 接住变成 `failed` 报告项，用户看到的是
  「导入失败」而不是「导入成功」）。**这不是措辞问题，是行为变更。**
  ⇒ **拍板项（必须二选一并写进 PR 描述与拍板表）**：
  - **(i) 显式接受**：声明「批量 ingest 从此受文件名校验约束」，并给 `failed` 报告项补可读文案；
  - **(ii) 保持拍板（倾向推荐）**：给 `writeWithRevision` 加一个「跳过名校验」入参
    （**默认 false**），批量 ingest 传 `true`。代价是多一个参数，行为零变更。
- **回滚**：无 schema 变更。回滚本条会让已由批量 ingest 写出的文件**重新变成悬空 head**
  ⇒ 回滚脚本需附带「对受影响的 entry 跑一次 `seedLiveHeadRevisionsUnderPrefix`」。

---

## C2-5 · CS-07 blob 归零触发器不感知 `vfs_entry`

**严重度/簇**：P1 · core-storage（VFS DDL）｜量 S ｜**已注记化（2026-10-01，见下）**

> **CS-07 已归一至 wave-b-core2 §7（权威片，sr1-core2-c §1.3 裁定：同一条 ledger 条目、两片曾互抢权威）。本节保留两点：① 顺序约束 CS-06 → CS-07 仍以本文件 N-1 为唯一权威表述；② UPDATE 触发器的同款缺陷、触发器改名纪律、vfs-gc-trigger.test.ts 测试落点均已上收 core2 §7，勿在此重复实施。**

原七要素（病症 / 证据 / 修法 / 验收 / 测试策略 / 回归线 / 依赖 / 风险）整节删除，
实施与验收一律以 `wave-b-core2.md` §7 为准；本分片的 C2-4 负向断言 D4 仍是本波唯一
落在 core 侧的牙齿（只验「entry 有 hash 无 revision」不再产生，「blob 不被误删」归 core2 §7）。

**独立证据留档（core2 §7 未收录，供回查时省一次重开文件）**：
`synth/core-storage.md:138`（CS-19）已指出 entry 侧的 GC 判定**不能省**
⇒ 原「风险 R2」里那处「entry 活引用 vs 守卫」的**口径矛盾在归一后消解**，
core2 §7 的「风险 1（宁可留垃圾不可丢数据）」与这条原文同向。

---

## C2-6 · backfill 倒扫改单查询 JOIN

**严重度/簇**：P1 · core-data（checkpoint 定位）｜量 S

### 病症

「最后一个有 checkpoint 的消息在哪」这个定位，两处都用**逐条单行读倒扫**实现：
从消息列表尾部往前逐条问 `hasCheckpoint`，命中即停。消息数 M ⇒ 最坏 M 次 SQL 往返。
这段代码自己写着「每轮都跑整段消息数（大会话数百上千次 hasCheckpoint 单行读）」。

### 证据（`fe79b781` 实读）

`packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts:164-177`：

```ts
  let firstGapIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (signal?.aborted === true) { return { confirmedNoGap: false }; }
    const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
    if (has) { firstGapIndex = i + 1; break; }
  }
```

同一段逻辑在同文件 `:253-263`（`createBaselineCheckpointBackfillOperation.detect`）**重复了
一份** —— 两处都要改。

现成的单查询原语已在仓库里：`sqlite-message-checkpoint.repository.ts:313-330`
`findCheckpointMessageIdAtOrBefore`（`JOIN chat_message … ORDER BY cm.seq DESC LIMIT 1`），
已被 `resolve-target-tree.ts:60/:82` 使用。

### 修法（文件 · 函数级）

1. `message-checkpoint.port.ts` 新增
   `findLastCheckpointedMessageId(sessionId: string): Promise<string | null>`。
   （已核：全仓 `implements MessageCheckpointRepository` **只有 1 处**
   （`sqlite-message-checkpoint.repository.ts:82`），测试侧一律 `as unknown as X` 强转
   （`backfill-abort-signal.test.ts:90-93`、`backfill-cursor.test.ts:94-97`）
   ⇒ port 加方法**零破坏面**，RULE:109 担心的「手写假实现」在本仓不成立。）
2. `sqlite-message-checkpoint.repository.ts` 实现它：照抄 `:320-328` 的 JOIN 形态，
   去掉 `cm.seq <= #{maxSeq}` 条件（`mc.session_id = ? ORDER BY cm.seq DESC LIMIT 1`）。
   **不要**用 `findCheckpointMessageIdAtOrBefore(sessionId, Number.MAX_SAFE_INTEGER)` 顶替
   ——那条会把 `maxSeq` 绑成一个巨大数字进模板，且语义耦合。
3. 把 `:164-177` 与 `:253-263` 两段倒扫换成：

```ts
  const lastCheckpointedId = await checkpointRepo.findLastCheckpointedMessageId(sessionId);
  let firstGapIndex = 0;
  if (lastCheckpointedId != null) {
    const idx = messages.findIndex((m) => m.id === lastCheckpointedId);
    firstGapIndex = idx + 1;   // idx === -1 → 0，与「整表都是空窗」同义
  }
```

4. **弃权点的位置要重新安置**：原循环里每轮都查 `signal.aborted`，现在循环消失了。
   在 `findLastCheckpointedMessageId` 之前与补写循环内（`:194` 那个）各保留一次即可；
   补写循环内的那个**必须保留**（它守的是长补写）。
   **这不是「入场即 aborted ⇒ 零 IO」性质的退化，别让 reviewer 误判**：现状弃权点在循环内
   （`:169`），首次 IO 之前本来就有 `listSessionFileHeads`（`:147`）与
   `listMessageHeadersBySession`（`:156`）两次读 ⇒ 现状**也不是**零 IO，只是零 `hasCheckpoint`。
   改后与现状等价。PR 描述里点明「r3-run-4 的『停止窗口』现在只剩 **3 次读 + O(gap) 次写**」。
5. 把两处重复的「定位首个空窗」抽成一个模块私有函数
   （`resolveFirstGapIndex(checkpointRepo, sessionId, messages)`），消除双份实现。
6. C2-2 的段 2 **不再**用这个新方法来收敛 gap 起点（用「最后一个 checkpointed id」单点收敛，
   在 gap 中段被并发插点时会永久跳过消息——见 C2-2 的「TOCTOU 闭合方案（已拍板）」）。
   段 2 只用段 1 传下来的 `gapMessageIds` 做「连续前缀复核」。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| F1 零倒扫（牙齿） | spy `hasCheckpoint`，跑「有 gap」「无 gap」「全 gap」三条路径 | `hasCheckpoint.callCount()` ≤ `gapMessageIds.length`（gap 段逐条复核那几次，见 C2-2 的 TOCTOU 拍板案②），且**与消息总数 M 无关**；旧实现下三条都是 O(M) ⇒ 有牙。⚠️ 这里**不是**「恒 0」——若照旧稿写成恒 0，会与 C2-2 选定的案②直接打架 |
| F2 结果与旧实现一致 | 同一夹具分别跑新实现与一个 `hasCheckpoint` 倒扫的参考实现 | `message_checkpoint` 新增行集合逐条相等 |
| F3 空会话 / 无 gap | 无 checkpoint 的会话；最后一条就是 checkpoint 的会话 | 分别得到 `firstGapIndex = 0` / `messages.length`（不新增行） |
| F4 中止语义 | 中途 abort | 返回 `confirmedNoGap: false`，游标不前移 |
| F5 detect 分支 | `rollback-backfill-baseline-op.test.ts` 的 detect | `needsRepair` / `details` 文案逐字不变 |
| F6 命令 | `npm run test:fast -w packages/core -- test/message-checkpoint/rollback-backfill-baseline.test.ts test/message-checkpoint/rollback-backfill-baseline-op.test.ts test/message-checkpoint/backfill-cursor.test.ts test/message-checkpoint/backfill-abort-signal.test.ts` | 全绿 |

### 测试策略

- **新增** `test/message-checkpoint/backfill-gap-index-join.test.ts`：F1/F2/F3。
  F2 的参考实现放在测试文件内（一个 10 行的 `hasCheckpoint` 倒扫函数），构成对拍。
- **改** `test/message-checkpoint/backfill-abort-signal.test.ts`——**改写清单（与 C2-2 的测试
  策略是同一份，两处必须逐字一致，勿各写各的）**：
  1. **条数 = 5 + 1**：第一个 `describe` 里 5 条 `it`——`入场即 aborted`（`:112`）、
     `倒扫中 abort`（`:147`）、`倒扫跑完才 abort`（`:166`）、`插入中 abort`（`:183`）、
     `不传 signal`（`:201`）；第二个 `describe`（`:231` 起）里 service 级
     `T-BACKFILL-ABORT-SVC`（`:251`）1 条。旧稿写的「两条弃权用例的断言口径不变」与
     C2-2 的「全部 4 条 → 全绿」**都是错的**（RULE:115：条数结论一律实测复核）。
  2. **`:147` / `:166` / `:201` 三条必须重写**：它们断言的是 `h.hasCalls() === 3` /
     `h.hasCalls() === 4` / `hasCheckpoint.callCount() === 6`，而倒扫循环一旦消失，
     `hasCheckpoint` 一次都不再被调 ⇒ 这三个期望值结构上不可能满足，**必然红**，
     绝不是「口径不变」。改成与 `:183` 同形态：「abort 在 `insertCheckpoint` 第 N 次后翻真
     ⇒ 只写 N 条 + `confirmedNoGap === false` + 游标不前移」，观测面换成 `insertCheckpoint`
     的调用次数。
  3. **`:112` 恒真，必须换观测面**：它断言 `hasCheckpoint.callCount() === 0`，改后仍绿，
     但把整段扫描删掉也绿（牙齿判据①不过）。改成断言「`findLastCheckpointedMessageId`
     在 aborted 入场时**未被调用**」，并把弃权点明确前移到该调用**之前**
     （即 `listSessionFileHeads` / `listMessageHeadersBySession` 之后）。
  4. harness（`:88/:123/:211`）mock 了 `listMessageHeadersBySession`，需补
     `findLastCheckpointedMessageId` 的 mock。
- **复用** `test/message-checkpoint/resolve-rollback-anchor.test.ts`（同一 JOIN 形态的既有覆盖）。

### 回归线

`test/message-checkpoint/` 全目录；`test/service/agent/run-agent-turn.test.ts`（T-DS4/T-DS5/T-B4）。

### 依赖

- C2-2 依赖本条；本条无前置，可独立先落。

### 风险与回滚

- **风险 R1**：`idx === -1`（checkpoint 指向的消息已不在 header 列表里）。
  JOIN 保证 `cm.id = mc.message_id` ⇒ 该消息存在 ⇒ 理论上不可达；但仍按 `-1 → 0` 兜底
  （整表当空窗），宁可多补不可漏补。
- **风险 R2**：`seq` 排序口径不一致（headers 用 `ORDER BY seq ASC`，JOIN 用
  `ORDER BY cm.seq DESC`）——方向相反、同一 `seq` 列 ⇒ 定位出的 index 与倒扫一致。
- **回滚**：纯读路径 + 新增一个 port 方法，回滚无副作用（新增方法删掉即可）。

---

## C2-7 · `listBySessionOffset` 头投影

**严重度/簇**：P1 · core-data（消息仓储读口）｜量 S

### 病症

`listBySessionOffset` 是「跳过前 offset 行、取新增段」的唯一读口，却按 21 列全量取
（含 `content_json` / `content_blob` / `raw_json` / `attachments_json`）。它唯一的调用方
（backfill 短路判定的第二段）**只要 `id`**。增量段在正常对话里是 2 条，问题不大；
但**会话导入 / 复制 / 首次回填**时 offset 可能是 0 或很旧 ⇒ 一次调用把全会话正文拉回来并
逐条 `JSON.parse`。

### 证据（`fe79b781` 实读）

`packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:335-351`：

```ts
  async listBySessionOffset(sessionId: string, offset: number): Promise<ChatMessage[]> {
    const rows = await queryTemplate(this.conn, this.parser,
      `SELECT ${MESSAGE_SELECT_COLUMNS}
       FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC LIMIT -1 OFFSET #{offset}`, …);
    return this.mapRows(rows);
  }
```

`MESSAGE_SELECT_COLUMNS`（`:28`）是 21 列。唯一调用方
`backfill-baseline-checkpoints.ts:114-120` 只取 `.map((m) => m.id)`。

对照：同文件 `:301-322` 的 `listMessageHeadersBySession` 就是正确的头投影写法
（6 列、不调 `mapRows`、直接 `rows.map`）——本条照它改。

### 修法（文件 · 函数级）

1. `sqlite-message.repository.ts::listBySessionOffset`：SELECT 列表换成
   `id, session_id, seq, role, hidden, created_at_ms`（与 `:310` 同列同序），
   返回 `ChatMessageHeader[]`，**去掉 `this.mapRows`**（`mapRows` 会做 `JSON.parse` 与分片
   让步，头投影不需要），改用与 `:314-321` 同款的 `rows.map(...)`。
   `offset` 的 clamp 逻辑（`:339`）原样保留。
2. `domain/chat/repositories/message.port.ts:38-45`：
   返回类型改 `Promise<ChatMessageHeader[]>`，注释补「**只取 id/seq 顺序，不取正文**
   ——调用方（backfill 增量段判定）只消费 `id`」。import 补 `ChatMessageHeader`
   （`:7` 已有该 type 的 import，直接复用）。
3. 调用方 `backfill-baseline-checkpoints.ts:114-120`：**零改动**（`.map((m) => m.id)` 照旧可用）。
4. 全仓确认只有这一个调用方（已实测 `git grep listBySessionOffset`：`message.port.ts`、
   `sqlite-message.repository.ts`、`backfill-baseline-checkpoints.ts:114`、
   测试 `backfill-cursor.test.ts`）。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| G1 列集（有牙） | 造 3 条消息调 `listBySessionOffset(sid, 1)`，断言 `Object.keys(rows[0])` 的集合 | 恰为 `{id, sessionId, seq, role, hidden, createdAtMs}`；旧实现是 21 键 ⇒ 有牙 |
| G2 offset 语义不变 | offset=0/1/99/负数 | 分别返回 3/2/0/3 条，顺序按 seq 升序 |
| G3 正文零解析 | spy `mapRows` 或统计 `parseMessageContent` 调用 | 新增段有 N 条 ⇒ 正文解析次数 **0** |
| G4 端到端不回归 | `npm run test:fast -w packages/core -- test/message-checkpoint/backfill-cursor.test.ts` | 全绿 |
| G5 命令 | `npm run test:fast -w packages/core -- test/chat/message-visibility.test.ts test/chat/message-repository-yield.test.ts` | 全绿 |

### 测试策略

- **新增** 用例进 `test/chat/message-visibility.test.ts`（该文件已有
  `listMessageHeadersBySession` 的同款用例 `:75`）：G1/G2/G3。
- **改** `test/message-checkpoint/backfill-cursor.test.ts:76-85`：它的
  `listBySessionOffset` mock 造的是整条 ChatMessage 对象。改类型后若 TS 不报错
  （`mock.fn` 无强约束），**必须人工核对该 mock 只被消费 `.id`**（已核：只 `.map(m=>m.id)`），
  并把 mock 瘦成 `{id, seq}` 最小形态，避免测试继续假装需要正文。

### 回归线

`test/chat/` 全目录、`test/message-checkpoint/` 全目录、`test/service/chat/`。

### 依赖

- 无前置。C2-2 与 C2-6 会顺带消费它。

### 风险与回滚

- **风险 R1**：将来有人给这个读口加第二个「要正文」的调用方。
  缓解：G1 的列集断言会把「悄悄加列」变红；新增调用方必须另起读口。
- **风险 R2**：port 签名变更是**破坏性**的（返回类型窄化）。
  已核全仓只有一个调用方 + 一个 mock ⇒ 可控。若 judge 认为 desktop/mobile 侧有仓外消费者，
  按 §0 拍板项 #8 的口径复核后再定。
- **回滚**：单方法 + 单签名，`git revert` 即回。

---

## C2-8 · CS-09 ZIP 解析期体积/条数闸

**严重度/簇**：P1 · core-storage（安全面：ZIP 炸弹 / OOM）｜量 M
（台账建议**与 Wave B 并行**落地，用户可感）

### 病症

体积/条数闸门写在**解压之后**：`validateVfsZipEntries` 的入参已经是解压完的 `Map`
（`vfs-zip-io.service.ts:189` parse → `:191` validate）。而
`parseZipCentralDirectory` 在解析期逐条 `inflateSync` 并把全部结果收进数组返回，
**全程无闸**。攻击者可控的 `uncompressedSize`（只要不是 `0xffffffff` 就不触发 ZIP64 断言）
让几百 KB 的 zip 能让 `inflateSync` 分配 GB 级；`totalEntries` 是 uint16，最多 65535 条全部
留在数组里 ⇒ 移动端 OOM。技能预检 `previewSkillZip` 走同一个 `parseVfsZip`，同样无闸。

### 证据（`fe79b781` 实读）

`packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts:173 / 199 / 224-230`：

```ts
  const totalEntries = readUInt16LE(zipBytes, eocdOffset + 10);
  …
    const uncompressedSize = readUInt32LE(zipBytes, offset + 24);
    …
    const data = readLocalEntryData(zipBytes, { localHeaderOffset, compressedSize, uncompressedSize, method, entryName });
    entries.push({ …, data });
```

无任何累加与越限判断；`decompressEntryData`（`:85-115`）也是先 inflate 后比对长度。

闸门在 `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts:17-18 / 195-207`：

```ts
export const VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const VFS_ZIP_MAX_ENTRY_COUNT = 5_000;
…
  if (entryCount > VFS_ZIP_MAX_ENTRY_COUNT) { throw vfsZipError("PAYLOAD_TOO_LARGE", …); }
  if (totalBytes > VFS_ZIP_MAX_UNCOMPRESSED_BYTES) { throw vfsZipError("PAYLOAD_TOO_LARGE", …); }
```

调用顺序 `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:189-192`：

```ts
    const rawEntries = parseVfsZip(zipBytes);
    const { files, directories } = validateVfsZipEntries(scope, rawEntries, directoryPath);
```

第二入口 `packages/core/src/domain/skills/logic/preview-skill-zip.ts:35`：
`const entries = parseVfsZip(zipBytes);`（**无任何 validate 调用** ⇒ 全靠本条修）。

### 修法（文件 · 函数级）

**第 0 步（必做，最容易漏，决定本条是否成立）**：
`vfs-zip-parse.ts::parseVfsZip` 的中央目录分支 `catch` 里，
**先判 `PAYLOAD_TOO_LARGE` 不可回退**：

```ts
  } catch (centralDirError) {
    if (centralDirError instanceof VfsZipError && centralDirError.code === "PAYLOAD_TOO_LARGE") {
      throw centralDirError;          // 闸门命中绝不回退到 fflate
    }
    try { return parseVfsZipViaUnzipSync(zipBytes); } …
```

不做这一步，中央目录分支抛的闸门会被当成「中央目录解析失败」而回退 fflate ⇒ 闸门被绕过
且 `unzipSync` 仍会把整包解出来 ⇒ **OOM 照旧**。

**第 1 步 · 常量搬家（避免循环依赖）**：
新建 `packages/core/src/domain/vfs/logic/vfs-zip-limits.ts` 承载
`VFS_ZIP_MAX_UNCOMPRESSED_BYTES` / `VFS_ZIP_MAX_ENTRY_COUNT` / `VFS_ZIP_MAX_ENTRY_PATH_LEN`；
`vfs-zip-validate.ts` 从它 re-export（保持既有 import 面不变，别的地方不用改）。

**第 2 步 · 解析器内累加**（`vfs-zip-central-dir.ts`）：

- `parseZipCentralDirectory(zipBytes, limits?)`：读 EOCD 拿到 `totalEntries` 后，
  **在解压任何条目之前**先判 `totalEntries > limits.maxEntryCount` ⇒ 抛 `PAYLOAD_TOO_LARGE`。
- 循环内维护 `declaredBytes`，每条累加 `uncompressedSize`，
  `declaredBytes > limits.maxUncompressedBytes` ⇒ 立刻抛（在 `readLocalEntryData` **之前**）。
- 同时维护 `actualBytes`，解压后累加 `data.length`，同样越限抛
  （防「声明小、实际大」的谎报头把单条内存打穿）。
- `decompressEntryData` 增一个 `maxEntryBytes` 形参（= 剩余预算），
  `STORE` 分支与 `DEFLATE` 分支都在动手前比一次。

**第 3 步 · 谎报头的兜底 —— 已实测证伪，撤除（sr1-c2-c must-fix-1）**：
~~`inflateSync` 传预分配 `out` 作兜底~~ **fflate 0.8.3 实测：`out` 不够时既不抛错也不溢出，而是
「静默截断」**（`node_modules/fflate/esm/index.mjs:1239-1241` `inflt` 的 `noBuf=false 且 st.i==2 ⇒
resize===false ⇒ :248-257 扩容分支永不执行`；探针：`deflateSync(1000B) → inflateSync(comp,
{out: new Uint8Array(10)})` 返回 10 字节、无异常）。照原稿实施会把 OOM 换成**静默数据损坏**：
谎报头声明 1 字节 ⇒ `out=1` ⇒ 返回 1 字节 ⇒ `:102` 的 `inflated.length !== uncompressedSize`
比的是 `1 !== 1` ⇒ **不抛**，截断正文被当合法 entry 收进 `entries`。**本步撤除，不实施。**
谎报头的硬防护若要做，正解是流式 `Inflate.push` + `ondata` 回调自管累加并中断——偏离
「最小改动」原则，**留 judge 拍板后另立条目，本条不做**。

**第 4 步 · fflate 回退分支**（`vfs-zip-parse.ts::parseVfsZipViaUnzipSync`）：
`unzipSync` 之后立刻累加 `Object.values(raw)` 的字节总数与 key 数，
越限抛 `PAYLOAD_TOO_LARGE`（此路径无法增量闸，只能事后判；至少不让它**进入**上层）。
**抛点必须在 `try` 块之外**（sr1-c2-c must-fix-2）：该函数形状是
`try { unzipSync → for 循环建 Map → return } catch { throw vfsZipError("INVALID_ZIP") }`
（`:23-36`，循环整体在 try 内）——把累加/抛写进 try，`PAYLOAD_TOO_LARGE` 会被 `:33` 的
catch 吞掉改写成 `INVALID_ZIP` ⇒ 闸门在最需要它的回退路径上完全失效，且验收 H4 会红。
实施形态：把 `raw` 的取得放 try 内、累加与判限放 try 外（或拆出独立辅助函数）。

**第 5 步 · 入口不变**：`parseVfsZip` 与 `previewSkillZip` 的公开签名不动（`limits` 可选参数，
默认取 `vfs-zip-limits` 的常量），第 2 步与第 4 步自动覆盖两个入口。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| H1 条数闸在解压前 | 造 5001 条 entry 的 zip（STORE，body 空），调 `parseVfsZip` | 抛 `VfsZipError`，`code === "PAYLOAD_TOO_LARGE"`；且**不**走 fflate 回退（用一条只有中央目录损坏的断言反证：故意损坏中央目录 + 超条数，错误码必须是 `PAYLOAD_TOO_LARGE` 而不是 `INVALID_ZIP`） |
| H2 体积闸在解压前 | 造 1 条声明 33MB 的 entry（不提供真实数据，只改中央目录字段） | 抛 `PAYLOAD_TOO_LARGE`；用「进程 RSS 增量 < 8MB」佐证没有真解压（观测面见下） |
| H3 技能预检同闸 | `previewSkillZip` 喂超限 zip | 同款 `PAYLOAD_TOO_LARGE` |
| H4 fflate 回退也被拦 | 造一个中央目录解析失败、但解压后超 32MB 的 zip | 抛 `PAYLOAD_TOO_LARGE` |
| H5 正常 zip 不受影响 | `test/vfs/vfs-zip-parse.test.ts` 现有 7 条 + `vfs-zip-io.test.ts` 全部 | 全绿 |
| H6 闸门值不变 | `vfs-zip-validate.ts:17-18` 的常量值 | 32MB / 5000 / 512 原样（只搬家不改值） |
| H7 命令 | `npm run test:fast -w packages/core -- test/vfs/vfs-zip-parse.test.ts test/vfs/vfs-zip-io.test.ts test/skills/preview-skill-zip.test.ts` | 全绿 |

H2 的观测面说明：不要断言耗时（RULE「性能护栏取数量级回归线」），
断言 **`process.memoryUsage().heapUsed` 增量 < 8MB** 或「未分配 33MB Uint8Array」——
前者受 GC 噪声影响仍有 5–10× 余量，可用；若不稳定，退化为「`inflateSync` 未被调用」
（给 `fflate` 打一个注入点计数）。

### 测试策略

- **新增** `test/vfs/vfs-zip-parse-limits.test.ts`：H1/H2/H3/H4。
  H2 的中央目录字段改写需要一个「手工构造 zip 头」的 helper（测试文件内实现，
  只改 `uncompressedSize` / `totalEntries` 两个字段，不重新压缩）。
- **改** `test/skills/preview-skill-zip.test.ts`：加 H3 一条（该文件已有 4 条）。
- **新增** 「常量搬家不破坏既有 import 面」的编译期验证：保留一条从
  `vfs-zip-validate.js` import 这三个常量的用例。

### 回归线

`test/vfs/` 全目录、`test/skills/` 全目录、`test/character-card/`（ZIP/卡片共用同一解析器的
邻接面）、`test/infra/sql-template/`（无关但同在 `domain/logic` 目录树，防误改）。

### 依赖

- 无前置（本条可独立先落，台账建议与 Wave B 并行）。
- 与 C2-1 同一波但**无耦合**：C2-1 只改事务边界，C2-8 只改解析期。同一 PR 便于一次回归。

### 风险与回滚

- **风险 R1（最高）**：忘做第 0 步 ⇒ 闸门被 fflate 回退完全绕过，整条白做。
  缓解：H1 的后半段断言专门钉这条（损坏中央目录 + 超限 ⇒ 错误码必须是 `PAYLOAD_TOO_LARGE`）。
- **风险 R2**：谎报头（声明小、实际大）在 DEFLATE 分支仍是**真 OOM 面**（第 3 步已撤除，
  既有 `inflated.length !== uncompressedSize` 硬失败只在解压**成功后**才兜得住）。
  按「已知限制」登记，不做静默截断式的假兜底。
- **风险 R3**：闸门提前到解析期后，某些「声明值虚高但实际很小」的正常 zip 会被误杀。
  缓解：闸门用**声明值**累加（合法 zip 的声明值等于实际值），并保留
  `decompressEntryData` 的既有长度比对做二次确认。
- **回滚**：无 schema 变更；常量搬家用 `git revert` 回退时需同时回退
  `vfs-zip-validate.ts` 的 re-export（同一 commit 内完成，不留中间态）。

---

## C2-9 · CS-10 checkpoint 仓储三方法补 900 分片

**严重度/簇**：P1 · core-storage（SQL 模板底座）｜量 M

### 病症

`sqlite-message-checkpoint.repository.ts` 有三处按**变长 arity** 拼 `IN (#{id0}, #{id1}, …)`
且**不分块**。定级依据（sr1-c2-c 实测修正）：**现役 desktop 驱动 better-sqlite3 11.10.0 /
SQLite 3.49.2 的变量上限实测为 32766**（40000 个命名占位符报 `variable number must be
between ?1 and ?32766`），不是老版常见的 999——单会话 > 32765 条消息才真触发，罕见。
⇒ 本条定性为**「防御性封顶 + 与同文件既有 900 口径统一」**（P1 紧迫性依据作废，
按「一致性/防御」落，定级随 wave 归属从 P1 调整为 P1-一致性，judge 复核）；
mobile 侧 op-sqlite 上限**未实测**，实施时按同一探针复核，不得照抄 32766。
同一文件里已经有正确的分块范例
（`insertMultiValues` 的 `MULTI_VALUES_MAX_VARS = 900`），三处 IN 查询漏了。

根因的另一半在 `infra/sql-template/parser.ts:45-53`：`TemplateParser.astCache` 以**整条模板串**
为 key、无上界无淘汰，注释 `:43` 自称「模板字符串通常数量有限（来自配置），缓存增长可控」——
**这个前提在生产不成立**（模板是运行时按 arity 拼出来的）。分片只保证单次调用的 arity 有界，
不保证跨调用的 arity 集合有界（最后一个不满片的长度可以是 1..N 任意值）。
**反向收益（sr1-c2-c 补）**：分片恰恰把 `astCache` 的 key 集合从「1..N 完全无界」收窄成
「每调用点最多 899 种模板串」（块固定 899 + 末块 1..899）——净收益方向别写反。

台账口径：**本条只做「三方法补 900 分片」，parser 级 LRU 不在本条**（§10 Wave C
「先给 checkpoint 仓储三方法补 900 分片」）。

### 证据（`fe79b781` 实读）

`packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts`：

- `:119-131` `countCheckpointsForMessages`：
  `AND message_id IN (${messageIds.map((_, i) => `#{id${i}}`).join(", ")})`
- `:373-385` `listFilePointersForMessages`：同一形态
- `:398-408` `deleteCheckpointsForMessages`：先拼 `inClause` 再用于 3 条语句

对照，同文件 `:40-41` + `:50-76` 已有正确分块：

```ts
/** 多值 INSERT 每块变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const MULTI_VALUES_MAX_VARS = 900;
```

`infra/sql-template/parser.ts:41-55`：

```ts
 * 所以这里按模板字符串原文缓存一份 AST，命中就直接返回 …模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU。
export class TemplateParser {
  private readonly astCache = new Map<string, AstNode[]>();
```

（台账 §2.4 记的三处行号 `:112-130,366-386,390-400` 与实读差 7 行以内，以本文件为准。）

### 修法（文件 · 函数级）

**1. 抽出共享分块器**（同文件模块私有）：

```ts
/** IN 列表每块的变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const IN_LIST_MAX_VARS = 900;

/** 把 id 列表按 ≤(900 − 已有固定变量数) 切块，逐块产出 { ids, bindings, inClause }。 */
function* chunkIdList(sessionId: string, ids: ReadonlyArray<string>, fixedVars: number) { … }
```

块大小 = `IN_LIST_MAX_VARS - fixedVars`（本三处 `fixedVars = 1`，即 `sessionId`）⇒ 每块
**含 sessionId 共 ≤900 个变量**。每块内绑定名重新从 `id0` 起编号（`#{id0}…#{idN}`）。

**2. `countCheckpointsForMessages`**：逐块查 `COUNT(*)` 后**求和**。
等价性：PK 保证每 `(session_id, message_id)` 至多一行，id 列表内无重复 ⇒ 求和 = 整段计数。

**3. `listFilePointersForMessages`**：逐块查后**顺序 concat**（保持 id 顺序即块顺序）。

**4. `deleteCheckpointsForMessages`**：**顺序不许变**——先逐块读 `message_checkpoint_file` 行并
concat，**一次性** `decrementRefsForCheckpointFiles`（ref −1 必须先于行删除），
再逐块执行那两条 DELETE。每块重新构造 `inClause` 与 bindings。

**5. 零 id 的早退**保持原样（`:118-120` / `:371-373` / `:395-397`）。

**6. 附带注记（写进 PR 描述，不在本条做）**：分片之后单次调用的 arity 上界是 899，
但 `TemplateParser.astCache` 的**跨调用 arity 集合**仍无界 ⇒ 8000 段的回滚仍会喂出
最多 8000 种模板串。彻底解法是 parser 级共享 LRU 或改固定 `?` 位置参数，
登记为 Wave D/E 债务，**不要**在本条顺手做（它会牵动 31 个 repository 的默认 SQL 出口）。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| I1 >900 不报错 | 造 1200 条消息（带 checkpoint），调三方法各一次 | 三方法均**不抛**（旧实现在 1000 左右即抛「too many SQL variables」） |
| I1 差分有牙（sr1-c2-c 修正） | 造 1200 条消息（带 checkpoint），调三方法各一次 | 三方法均**不抛**。~~旧实现 1000 左右即抛~~ **现役驱动实测上限 32766，旧实现 1200 个绑定也不抛 ⇒ I1 的「不抛」期望对旧实现同样绿，无牙**；本条与 I3 合并为一组差分断言（I3 的「任一块 ≤900」在旧实现 1200 绑定下必红）——I1 不再单列 |
| I2 结果等价 | 同夹具，比较「1200 个 id 整段」与「分 3 段（900/300/）」两次调用的结果 | `countCheckpointsForMessages` 相等；`listFilePointersForMessages` 的行集合相等且**顺序稳定**；`deleteCheckpointsForMessages` 后 `message_checkpoint` / `message_checkpoint_file` 剩余行集合与 `vfs_revision.ref_count` 与整段版一致 |
| I3 语句数可数（**主差分断言**） | spy `conn.execute` / `queryTemplate` | 1200 个 id ⇒ 至少 2 块；任一块的绑定变量总数 ≤ 900 |
| I4 边界 | id 数 = 0 / 1 / 899 / 900 / 901 | 0 早退不发 SQL；其余正确切块。**重复 id 用例独立命名**（不与 I2 的无重复夹具共用用例名） |
| I5 ref 语义不回归 | `test/message-checkpoint/rollback-ref-count.test.ts` 全量 | 全绿 |
| I6 命令 | `npm run test:fast -w packages/core -- test/message-checkpoint/` | 全绿 |

### 测试策略

- **新增** `test/message-checkpoint/checkpoint-in-clause-chunk.test.ts`：I2/I3/I4
  （I1 已并入 I3 差分组）。
  I3 的观测面用「包装 `conn` 计数每次 execute 的 `params.length`」，断言任一次 ≤ 900
  ——这条在旧实现下必红（1200 个绑定）。
- **复用** `test/message-checkpoint/checkpoint-seed-batch-perf.test.ts`（`insertMultiValues`
  的既有分块验证面，本条与之对齐口径）。
- **同步改 JSDoc（nit）**：`message-checkpoint.service.ts:142-143` 的「`deleteCheckpointsForMessages`
  本身就是一条硬碰硬 SQL」在分块后失真（变 N 条），随本条一起改。

### 回归线

`test/message-checkpoint/` 全目录（30+ 条）、`test/infra/sql-template/` 全目录、
`test/vfs/revision-ref-count.test.ts`、`test/chat/` 全目录（回滚走 checkpoint 读口）。

### 依赖

- 无前置。可独立先落。

### 风险与回滚

- **风险 R1**：`countCheckpointsForMessages` 求和若 id 列表含重复 ⇒ 结果偏大。
  已核唯一调用方 `backfill-baseline-checkpoints.ts:114-120` 的 segment 来自
  `chat_message` 主键 ⇒ 无重复。缓解：I2 用例里放一段含重复 id 的输入并断言「与整段版一致」
  （即接受求和语义，语义不因分块而变）。
- **风险 R2**：`deleteCheckpointsForMessages` 的 ref 减一被拆到块外一次性做，
  若块内读失败会抛 ⇒ 整批不动（与现状一致，因为现状是单事务）。调用方在事务内的假设不变。
- **回滚**：纯仓储层改动，无 schema 变更。

---

## C2-10 · CD-01 回滚 plan 与事务内状态不同源（四步重排）

**严重度/簇**：P1 · core-data（回滚正确性：静默丢文件 / 无主残留）｜量 L

> **归属依据（judge-r1 A.2 裁决，2026-10-01）**：归 `wave-c2.md`，理由三条 ——
> ① 它是**回滚正确性**（不是性能结构），与本片事务边界族同源；
> ② 本文件 **N-3** 已把「产出写集合的扫描必须留在事务内」写成通用判据，
> CD-01 正是该判据的原型范例，落在同一片才能被该判据覆盖；
> ③ 它与 C2-1 / C2-2 共享 `conn.transaction` 与 AsyncMutex 不可重入的纪律。
> ⚠ **不要与台账 `ledger-v2.md:463` 的「CD-01 fork 缺上界读口」混同**——后者经 judge 正名为
> **CD-13**，归 `wave-c1.md` C1-1，本条不是它。

### 病症

回滚链的 plan 解析整段跑在**事务外**（`resolveRollbackPlan`），而 plan 产出的
`pathsNeedWrite` / `pathsNeedDelete` 两个集合**直接成为事务内的写集合**
（`reconcileVfsPaths` 照着它们逐条 `delete` / `restore`）。中间还隔着一次乐观锁重试循环，
间隙里 agent 可以继续写这个会话的文件 ⇒ 事务内执行的写集合是**事务外定下来的旧快照**。

四个具体缺口（对应台账 `ledger-v2.md:110` 的「W6 重排四步」）：

1. **rewind + 空 `targetTree` 无护栏**：S-13 护栏的判定条件写死 `plan.mode === "undo_send"`，
   rewind 分支（`hasDirectTargetTree === false`）走不到；而 `pathsNeedDelete` 又恰好被
   `hasDirectTargetTree` 门住 —— 两处门口径必须同改，否则 rewind + 空树仍是「删光会话工作区」。
   现有 `rollback-empty-target-guard.test.ts` 的 T-DS2a/b/c **三条全是 undo_send**，
   rewind + 空树**零断言**（台账 `:112` 已记录这条零覆盖证据）。
2. **乐观锁只锁消息数**：事务内只比 `countBySession`（COUNT(\*)）。**文件面完全没锁** ——
   间隙里新增 / 删除 / 改写文件都不改变 `chat_message` 行数 ⇒ 乐观锁照样全绿
   ⇒ 按旧集合删/写 ⇒ **静默丢文件**。
3. **删集合不在事务内重算**：plan 段的 `listSessionFileHeads` 是 live 树扫描，
   `resolve-reconcile-paths.ts` 据此判 `liveHead === pair.version` 短路；而真正 restore 时
   `restore-path.ts` 又用**事务内重新取到的** `liveHeadByPath` 判同一条短路
   —— **两个 live 头来自两个不同时刻的扫描**，短路的依据可能在事务里早已不成立。
4. **tailIds 无断言**：`tailMessageIds` 在事务内只被喂给 `listFilePointersForMessages`
   和探针，`truncateTailInTransaction` 按 `afterSeq` 截断却**不核对**「要删的 tail 还是不是
   这批 id」；间隙里若插进 seq 更大的新消息，会被连带截断，而用户从没回滚过它。

### 证据（`fe79b781` 实读，本轮逐行核对）

台账 `:110` 记的四组行号 **逐字在位**（本轮罕见地对齐，无漂移），以下为实读原文。

**① 护栏只覆盖 undo_send** — `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:159-175`：

```ts
      if (
        !options?.skipVfsReconcile &&
        plan.mode === "undo_send" &&
        plan.targetTree.size === 0
      ) {
        const liveHeads = await listSessionFileHeads(
          this.deps.entries, projectId, sessionId
        );
        if (liveHeads.length > 0) {
          throw sessionFsRollbackUndoSendEmptyTarget(sessionId, anchorMessageId);
        }
      }
```

与 `packages/core/src/domain/message-checkpoint/logic/resolve-reconcile-paths.ts:123-130` 的
`hasDirectTargetTree` 门（`if (hasDirectTargetTree) { … }`）是一对：**rewind 分支
（`message-rollback.service.ts:411` `hasDirectTargetTree = directTargetPointers != null`）
在 `targetTree` 为空时拿不到任何删除**——这一路是漏删而非误删；但若只把护栏条件放宽、
不同步看 `hasDirectTargetTree`，undo_send 侧会反过来多删。**两处必须一起改。**

**② 乐观锁只比消息数** — `message-rollback.service.ts:203-216`：

```ts
          const txMessages = new SqliteMessageRepository(tx);
          const currentCount = await txMessages.countBySession(sessionId);
          …
          if (currentCount !== plan.messageCountSnapshot) {
            throw sessionFsRollbackConflict(sessionId, anchorMessageId,
              plan.messageCountSnapshot, currentCount);
          }
```

`plan.messageCountSnapshot` 的采集在 `:331-337`（`listBySessionFromSeq` 与 `countBySession`
并行），字段注释在 `:92-96`。**全程无任何文件面指纹。**

**③ 写集合来自事务外扫描** — `resolve-reconcile-paths.ts:42`（live 树扫描）与 `:89-93`（短路判定）：

```ts
  const liveHeads = await listSessionFileHeads(entryRepo, projectId, sessionId);
  …
    const liveHead = liveHeadByPath.get(pair.logicalPath);
    if (liveHead === pair.version) {
      continue;
    }
```

被消费的一侧在 `message-rollback.service.ts:562-565`（**台账 `:110` 记的
`562-565` 正是这个删循环，逐字在位**）：

```ts
    for (const logicalPath of pathsNeedDelete) {
      await this.deletePathIfExists(vfs, logicalPath);
      deleted++;
    }
```

而 restore 侧的同款短路在 `packages/core/src/domain/message-checkpoint/logic/restore-path.ts:146-149`
（台账 `:110` 记的 `145-149`，注释行占 `:146`）：

```ts
  // live head 已与 checkpoint 目标 version 对齐时，正文无需再 restore。
  if (liveHeadByPath?.get(logicalPath) === version) {
    return "skipped_same_version";
  }
```

这里用的 `liveHeadByPath` 来自 `reconcileVfsPaths` 内 `:493-500` 的**事务内重扫** ——
与 `:42` 的事务外扫描是两个不同时点。

**④ tailMessageIds 无事务内断言** — `message-rollback.service.ts:364`（plan 里产出）、
`:426-449`（只用来补 `pathsNeedDelete`）、`:248-251`（只进探针）、
`:239-247`（`truncateTailInTransaction` 只吃 `afterSeq`，不吃 id 集合）：

```ts
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId: plan.projectId,
        sessionId: plan.sessionId,
        afterSeq: plan.truncateAfterSeq,
        sweepRevisions: true,
        deferGlobalOrphanGc: true,
      });
```

零个 id 级断言。台账 `:110` 记的第三处 `:399`（`hasDirectTargetTree = true`，
undo_send 分支恒真）也在位 —— 它是缺口①的另一半。

### 修法（文件 · 函数级 · 四步**顺序不可换**）

**第 1 步 · rewind 空树护栏**（`message-rollback.service.ts::rollbackToMessage` `:159-175`）：
把判定条件从 `plan.mode === "undo_send" && plan.targetTree.size === 0` 放宽为
「`plan.targetTree.size === 0` && live 树非空 && `!skipVfsReconcile`」，
并让错误码带上 `mode` 以便上层区分；同时在 `resolve-reconcile-paths.ts:123-130` 的
`hasDirectTargetTree` 门旁补一条对称注释（**逻辑不改**，它本来就该由护栏兜住）。
⚠ `rollback-empty-target-guard.test.ts` 现有的 T-DS2a/b/c 三条**必须保持绿**
（它们断言的是 undo_send 抛 `ROLLBACK_UNDO_SEND_EMPTY_TARGET` 且文件数不减少）。

**第 2 步 · 文件维度指纹乐观锁**（plan 段 + 事务内各一处）：
plan 段对 live 树算一份**排序后逐项可比**的指纹（`logicalPath` 升序 × `headVersion`），
连同行数存进 `RollbackPlan`（新字段 `fileTreeFingerprint`）；事务内在
`countBySession` 之后立刻用 **tx 面** 的 `SqliteVfsEntryRepository` 重算同一指纹，
不等即抛既有的 `ROLLBACK_CONFLICT`（复用 `:210-215` 的抛点与错误工厂，**不新增错误码**），
由 `:256-263` 的既有重试循环接管。
⚠ 指纹必须用 tx 面 repo（`:199-202` 的注释已经把「事务内只能用 tx 面、重入外层 mutex 会死锁」
写死了），复用同一段注释的约束。

**第 3 步 · 删集合事务内重算**（`resolve-reconcile-paths.ts` + `message-rollback.service.ts`）：
把 `resolveReconcilePathSets` **拆成两半**——
- 「算 `pathsNeedWrite`」的段（`:51-121`，依据 targetTree + revision meta + content hash）
  留在 plan 段，其结论虽被事务消费但**只依赖 checkpoint 侧的不可变快照**，
  stale 最多多一次 restore 短路，`:146-149` 会在事务内复核；
- 「算 `pathsNeedDelete`」的段（`:123-130`，依据 live 树 vs targetTree）
  **整体搬进 `reconcileVfsPaths` 内部**，改用该函数 `:493-500` 已经取到的
  事务内 `liveHeadRows` 重算，**不新增第二次 live 扫描**。
⚠ **不得**把整个 `resolveReconcilePathSets` 搬进事务：台账 §10 `:465` 明写
「W6 明确否掉 `resolveReconcilePathSets` 整体移进事务，改为事务内复用已有扫描做集合断言」，
本文件 **N-3 判据第 1 行**已经把这条写死。
⇒ 同步在 `resolve-reconcile-paths.ts` 的 JSDoc（`:23-31`）上补一句
「本函数可能只被调用 plan 半段；删集合半段见 `reconcileVfsPaths`」。

**第 4 步 · tailIds 断言**（`message-rollback.service.ts::rollbackToMessage`）：
在 `:239` 的 `truncateTailInTransaction` **之前**，用 tx 面 `SqliteMessageRepository`
查 `seq > plan.truncateAfterSeq` 的 id 有序列表，与 `plan.tailMessageIds` 逐项比对；
不等即抛 `sessionFsRollbackConflict` 的**新变体**——在
`packages/core/src/errors/session-fs-errors.ts` 增 `ROLLBACK_TAIL_DRIFT`
（带 expected/actual 两个计数，不带 id 列表，避免错误信息泄漏内容）。
⚠ 这一步**必须在第 2 步之后**：文件面指纹挡不住「只多了消息、没动文件」的间隙。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| R1 rewind + 空树被拦（**主差分断言**） | 造「有 live 文件 + 锚点无任何 checkpoint」的会话，对 **rewind 型锚点**（非 plain user）调回滚 | 抛空目标错误码；`filesBefore === filesAfter`；消息未被截断。旧实现**不抛**并删光文件 ⇒ 有牙 |
| R2 既有 undo_send 护栏不回归 | `test/message-checkpoint/rollback-empty-target-guard.test.ts` 全量（T-DS2a/b/c） | 全绿，错误码仍是 `ROLLBACK_UNDO_SEND_EMPTY_TARGET` |
| R3 文件面乐观锁有牙 | 用注入点或「plan 段与事务段之间改一次文件」的手法，让消息数不变而文件变 | 抛 `ROLLBACK_CONFLICT`；重试耗尽后向上抛，不静默 |
| R4 删集合用事务内 live 树 | 同 R3 的间隙，但间隙只**新增**一个文件（不触发指纹冲突的那一半若拆开测） | 新文件不在本次 `pathsNeedDelete` 里被误删；或冲突抛出后重试的 plan 已包含它 |
| R5 tailIds 断言 | 间隙里插一条 seq 更大的新消息（消息数已变 ⇒ 会先撞 R3，需用「只插不改文件」的定向手法绕开指纹） | 抛 `ROLLBACK_TAIL_DRIFT`，且该新消息**未被截断** |
| R6 事务次数不回归 | `test/message-checkpoint/rollback-optimistic-lock-count.test.ts` 全量（该文件已有 SQL 计数连接 helper） | 全绿；`chat_message` 无 seq 限定的全量 `listBySession` 仍为 0 |
| R7 命令 | `npm run test:fast -w packages/core -- test/message-checkpoint/rollback-empty-target-guard.test.ts test/message-checkpoint/rollback-optimistic-lock-count.test.ts test/message-checkpoint/rollback.test.ts` | 全绿 |

R3/R4/R5 三个「间隙注入」用例需要一个可控夹具：推荐在测试里包一层
`deps.entries` 的代理，在第 N 次 `listSessionFileHeads` 之后做一次副作用，
复用 `test/helpers/sql-counting-connection.js` 已有形态，不要新造连接。

### 测试策略

- **改** `test/message-checkpoint/rollback-empty-target-guard.test.ts`：加 R1（rewind + 空树）一条，
  与 T-DS2a/b/c 同 describe（它们共用 `novelMasterTestFixture()` 上下文）。
- **新增** `test/message-checkpoint/rollback-fingerprint-lock.test.ts`：R3/R4/R5 三条共用
  「间隙注入」夹具 + `openSqlCountingNovelMasterTestConnection` 观测 SQL 次数。
- **复用**（不新写）：`rollback-optimistic-lock-count.test.ts`（R6）、`rollback-optimistic-lock.test.ts`
  （重试上限语义）、`rollback-execution-redesign.test.ts`（四步重排的既有形状）。
- **不复用**：`rollback-plan-scope.test.ts` —— 它锁的是 plan 的 scope 装配，与本条无关。

### 回归线

`test/message-checkpoint/` 全目录（30+ 条）、`test/chat/` 全目录（回滚走 checkpoint 读口，
`message.service.ts` / `session.service.ts` 都可能间接触达）、`test/vfs/revision-ref-count.test.ts`。

### 依赖

- **无前置**，可独立先落。
- **建议与 C2-1 / C2-2 同 PR**：三条共享 `conn.transaction` 切分与 AsyncMutex 不可重入的纪律，
  一次回归省两轮；无文件级重叠（C2-1 改 `service/vfs/**`，C2-2 改 checkpoint backfill，
  本条只改 `service/message-checkpoint/**` + `domain/message-checkpoint/logic/resolve-reconcile-paths.ts`）。
- 与 `wave-c1.md` 的 C1-2（`listReadRefTargetsBySession`）**不同文件**；与 C1-1（CD-13 fork 上界读口）
  **零耦合**——两条只是编号曾被台账混为「CD-01」。

### 风险与回滚

- **风险 R1**：第 2 步的指纹若用 hash，会引入碰撞导致的**误报冲突**（把好回滚打成 409）。
  缓解：指纹**不 hash**，用「`logicalPath` 升序 × `headVersion` 的有序对列表」逐项比对，
  内存换正确性。
- **风险 R2**：第 3 步若把 `pathsNeedWrite` 也搬进事务，会与 C2-3（`listBySession` copy 出事务）
  的判据方向打架、并重演本条正要治的病。缓解：验收 R6 直接量 SQL 次数，多一次扫描即红。
- **风险 R3**：第 4 步的 `ROLLBACK_TAIL_DRIFT` 是**新错误码**，上层（desktop / mobile 的回滚调用方）
  还没有对应文案。缓解：错误码带 expected/actual 计数，`formatDegradableMessage` 那条既有降级路径
  （`:99-109`）能直接把它显示成「工作区无法恢复：…」；文案润色登记为 debt，不在本条做。
- **风险 R4**：三步锁叠起来后，高频写入会话上重试上限（`:124` `ROLLBACK_OPTIMISTIC_RETRY_LIMIT = 3`）
  可能更容易耗尽。**保持现状**（耗尽即向上抛冲突），不因为本条上调上限。
- **回滚**：纯 service + domain logic 改动，**无 schema 变更**；四步各自独立可 revert，
  但第 4 步依赖第 2 步 ⇒ 回滚顺序必须 4 → 3 → 2 → 1。

---

## C2-11 · CS-03 LCS DP 滚动两行 + `Math.min(...arr)` spread 上限

**严重度/簇**：P1 · core-storage（edit 失败诊断路径）｜量 M

> ⚠ **行号校核**：台账 `ledger-v2.md:120` 记 `longest-common-substring.ts:140-142,164`
> 并自注「行号整体下移约 +88」。本轮在 `fe79b781` 实读：该文件**共 91 行**，
> 台账那两个位置的**真实坐标是 `:52-54`（DP 全表分配）与 `:76`（`Math.min(...endsInB)`）**
> —— 与台账自注的 +88 偏移吻合。本条以下全部按**实测行号**写。

### 病症

`longestCommonSubstring` 是**全表 DP**：`rows × cols = (a.len+1) × (b.len+1)` 的
`number[][]`，每个格子一个 JS number（8 字节指针 + 可能装箱）。它的调用面是
**edit 工具失败时的诊断**——`a` 是模型给的 `oldString`，`b` 是**整个文件正文**
（`currentContent`，可以是几百 KB 的 md）。

W6 实跑：两边各 5 万字符 ⇒ 250 万格 ⇒ 约 **689MB** 分配 + GC 抖动；
再往上就是 `RangeError` / OOM。**诊断路径把进程打爆**，用户看到的是「edit 工具崩了」，
而不是「`oldString` 没命中」这条本该有用的错误。

两处放大因子：

- `Math.min(...endsInB)`：`endsInB` 是所有**并列最长**子串的结束位置数组，
  循环体每命中一次 `len === maxLen` 就 push。最坏可达 O(min(a,b)) 条
  ⇒ spread 展开的参数个数撞 V8 上限（实测 ≈2×10⁵）⇒ `RangeError: Maximum call stack size exceeded`。
  构造很容易：a 与 b 都是一长串同一字符时，`maxLen` 被反复重置又反复追平。
- `countOccurrences`（`:19-34`）本身是 `indexOf` 循环，needle 通常是 LCS 结果、长度不大，
  **不在本条范围**；但降级后 needle 变短，顺带受益。

### 证据（`fe79b781` 实读）

`packages/core/src/domain/vfs/logic/longest-common-substring.ts:47-70`（DP 本体，
**台账 `:140-142` 的真身**）：

```ts
  const rows = a.length + 1;
  const cols = b.length + 1;
  let maxLen = 0;
  const endsInB: number[] = [];

  const dp: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0)
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        const len = dp[i]![j]!;
        if (len > maxLen) {
          maxLen = len;
          endsInB.length = 0;
          endsInB.push(j);
        } else if (len === maxLen && len > 0) {
          endsInB.push(j);
        }
      }
    }
  }
```

`同文件:76-81`（**台账 `:164` 的真身**）：

```ts
  const endInB = Math.min(...endsInB);
  const startInB = endInB - maxLen;
  return {
    substring: b.slice(startInB, endInB),
    length: maxLen,
  };
```

调用链（两条入口都在未命中分支上，**每次未命中都跑一次全表 DP**）：

`packages/core/src/domain/vfs/logic/compute-replace-result.ts:61-64`（`replaceAll` 分支）与
`:76-79`（单次分支）：

```ts
    if (positions.length === 0) {
      // 一处都没命中就直接报错，避免出现「整段原样返回」的假成功。
      throw buildReplaceNotFoundError(path, currentContent, oldString);
    }
```

`packages/core/src/domain/vfs/logic/compute-replace-not-found-error.ts:55-58`（台账 `:120` 记的
`:55`，逐字在位）：

```ts
  const lcs = longestCommonSubstring(oldString, fileContent);
  const occurrences = lcs.length > 0 ? countOccurrences(fileContent, lcs.substring) : 0;
  const fileHint = pickFileHintRegion(fileContent, lcs.substring);
```

**降级是安全的**——上游三处都已按 `length === 0` 处理，不会因此崩：
`compute-replace-not-found-error.ts:56-57`（不调 `countOccurrences`）、
同文件 `:39-47`（`fileHint` 退回文件开头 100 字符）、
`packages/core/src/domain/vfs/logic/format-vfs-error-for-llm.ts:49`（`lcsLength < MIN_LCS_LENGTH`
走短提示）。**这是本条能做降级的关键前提，已逐行核过。**

### 修法（文件 · 函数级 · 三步）

**第 1 步 · DP 换滚动两行**（`longest-common-substring.ts::longestCommonSubstring`）：
`dp` 从 `number[][]` 换成 `prev: Int32Array` / `cur: Int32Array` 两个 `cols` 长的
typed array，每轮沿 `a`（行方向）推进、`cur` 写完 swap，`prev[j-1]` 读上一行。
内存从「8 字节指针 + 装箱」降到 **4 字节/格**，且分配次数从 `rows+1` 降到 2。
`maxLen` / `endsInB` 的收集逻辑（`:61-67`）**逐字保留**——
只换承载结构，不换判定顺序。⚠ `endsInB` 记的是 **b 的下标**，
所以沿行滚动足够；沿列滚动会漏 `prev[j-1]`，两种写法不等价。

**第 2 步 · `Math.min(...arr)` 换循环**（同文件 `:76`）：

```ts
  let endInB = Number.POSITIVE_INFINITY;
  for (const value of endsInB) {
    if (value < endInB) { endInB = value; }
  }
```

顺带把 `endsInB` 从 `number[]` 换 `Int32Array`（先 push 到普通数组、收尾时一次性
`Int32Array.from`，或直接两遍扫 dp 求最小值——**前者改动更小，选它**）。
`endsInB` 必然非空（`maxLen === 0` 时 `:72-74` 已提前返回），循环后 `endInB` 不会是 `Infinity`。

**第 3 步 · 超阈值降级**（函数入口 + 两个新常量）：
在 `longestCommonSubstring` 开头（早于 `:47` 的 `rows`/`cols` 计算）加：

```ts
/** DP 单元格上界；超过即走降级路径（≈ 2e6 格 × 4B ≈ 8MB）。 */
const LCS_DP_MAX_CELLS = 2_000_000;
/** 降级时两侧各自的长度下限；低于此值直接放弃 LCS。 */
const LCS_DEGRADED_MIN_CHARS = 512;
```

`a.length * b.length > LCS_DP_MAX_CELLS` 时**按比例裁剪**（不是只砍一侧，否则另一侧会独占全部预算）：

```ts
  const totalCells = a.length * b.length;
  if (totalCells > LCS_DP_MAX_CELLS) {
    const scale = Math.sqrt(LCS_DP_MAX_CELLS / totalCells);
    const nextA = Math.floor(a.length * scale);
    const nextB = Math.floor(b.length * scale);
    if (nextA < LCS_DEGRADED_MIN_CHARS || nextB < LCS_DEGRADED_MIN_CHARS) {
      return { substring: "", length: 0 };   // 砍到没意义，直接放弃 LCS 诊断
    }
    a = a.slice(0, nextA);
    b = b.slice(0, nextB);
  }
```

`scale = sqrt(上限 / 实际)` ⇒ 裁剪后 `nextA × nextB ≤ LCS_DP_MAX_CELLS` **恒成立**，
不需要二次判阈值；`nextA`/`nextB` 是对**同一份 `a`/`b` 副本**的形参重绑定
（形参现为 `string` 可直接赋，需在函数签名上确认没有 `readonly` 约束）。
`nextA × nextB` 最小取 512×512 = 262144 格，远低于阈值 ⇒ 降级路径本身永不递归。
裁剪后 `b` 的坐标仍在原坐标系内 ⇒ `substring` 的取值语义不变（只是可能更短）。
降级结果按上文三处 `length === 0` 的既有分支消化，**错误码与调用流程零变化**。
常量写在 `longest-common-substring.ts` 里（与既有 `MIN_LCS_LENGTH:8` / `MAX_LCS_SNIPPET_CHARS:11`
同处），不新建文件。

### 验收

| 断言 | 方式 | 期望 |
|---|---|---|
| S1 大输入不崩（有牙） | 造 a、b 各 5×10⁴ 字符（b 用 `"ab".repeat(2.5e4)` 保证有匹配） | 不抛、不 OOM；`process.memoryUsage().heapUsed` 增量 **< 200MB**。旧实现该输入约 689MB ⇒ 有牙 |
| S2 结果等价（**主差分断言**） | 造 20 组 `a.len × b.len ≤ 2000×2000` 的样本（含中文引号、同字符长串、随机、**并列最长**样本各若干），逐组比较新旧实现 | `substring` 与 `length` **逐字相等** |
| S3 spread 上限已除 | 造 a = b = `"x".repeat(300000)`（⇒ `endsInB` 极长） | 旧实现 `RangeError`；新实现正常返回 |
| S4 降级不破坏诊断契约 | 造 1MB 正文 + 1MB `oldString`，走 `computeReplaceResult` 的未命中分支 | 抛 `vfsReplaceNotFound`（**错误码不变**）；`details.lcsLength === 0`、`details.fileHintCodepoints` **非空** |
| S5 既有用例不回归 | `test/vfs/longest-common-substring.test.ts` 5 条（T-LCS-01…04 + T-LCS-CN）+ `test/vfs/compute-replace-not-found-error.test.ts` | 全绿 |
| S6 命令 | `npm run test:fast -w packages/core -- test/vfs/longest-common-substring.test.ts test/vfs/compute-replace-not-found-error.test.ts test/vfs/compute-replace-result.test.ts` | 全绿 |

S1 的观测面**不断言毫秒**（RULE「性能护栏取数量级回归线」），
只断言堆增量上限；S2 是唯一能证明「滚动两行没改语义」的断言，必须逐字比。

### 测试策略

- **改** `test/vfs/longest-common-substring.test.ts`（现有 5 条，`:11-49`）：加 S1/S2/S3/S4。
  S2 的差分需要一个 **oracle**：把当前全表 DP 原样抄进测试文件内的 `referenceLongestCommonSubstring`
  ——这是本条**唯一允许的重复代码**，PR 描述里写明「oracle 随本条一起删」。
- S4 落在 `test/vfs/compute-replace-not-found-error.test.ts`（走公开入口，不碰内部实现）。
- **不改** `test/tool/format-tool-output.test.ts`（`:335/:362/:378/:394` 四条是 LCS 诊断的
  展示面，降级对上层透明，不该动）。

### 回归线

`test/vfs/` 全目录、`test/tool/format-tool-output.test.ts`（诊断展示面）、
`test/skills/`（edit 失败诊断经工具层出站）。

### 依赖

- **无前置**，可独立先落。
- 与 C2-8（CS-09 ZIP 闸）同簇不同文件，**可并行**；与 C2-9（CS-10）**零耦合**
  （`wave-b-core2.md:858` 的「同文件族但不同文件」顺带提及指的就是这一对）。

### 风险与回滚

- **风险 R1**：滚动两行改错 `maxLen` / `endsInB` 的收集时机 ⇒ 并列最长时取错子串
  （文档承诺「并列最长时取在 b 中首次出现位置最靠前的子串」，见 `:36-38`）。
  缓解：S2 必须包含**专门的并列最长样本**（如 a = `"aab"`, b = `"baa"` 之类），
  且逐字比 `substring` 而不比 `length`。
- **风险 R2**：降级阈值定太小 ⇒ 大文件 edit 未命中时诊断长期为空，用户体验退化。
  缓解：阈值取 200 万格（≈8MB `Int32Array`），远大于常见 md 正文；
  且降级只影响 `details` 展示，**错误码与流程不变**（S4 钉这条）。
- **风险 R3**：降级截断 `a` 的前 2048 字符会让 LCS 结果偏短 ⇒ `fileHint` 锚点变粗。
  **登记为已知限制**，不做更细的截断策略（本条目标是止崩，不是提精度）。
- **回滚**：纯 `domain/logic` 改动，**无 schema / 契约变更**，单 commit 可 revert；
  oracle 测试随 revert 一起消失，不留悬挂引用。

---

## 分片级注记

### N-1 · CS-06 → CS-07 的顺序约束（台账拍板口径 · 技术上零耦合可互换）

台账 §2.4 CS-07 原文标「**须在 CS-06 之后**」。⚠️ **这条是台账拍板的落地口径，不是技术必然**
（sr1-c2-b §3.4 改述）——原先把它写成「写死，不可互换」并挂在「先消主要制造者」这个理由上，
经不起追问。

- **台账口径的理由 = 归因清晰度**：CS-06 是「entry 有 hash、无 revision」这一形态的
  **主要制造者**；先修 CS-06 能消掉大部分触发条件，CS-07 才退成纵深防御。
- **技术上两条零耦合**：CS-06 改写侧写路径（`revision-aware-vfs.service.ts` +
  `vfs-batch-io.service.ts`），CS-07 改 DDL 触发器（`vfs-revision-schema.ts` + migration）——
  不同文件、不同机制，任一顺序都可编译、可独立验收、可独立回滚。
- **反向次序同样说得通**：CS-07 的触发器守卫正是用来保护**存量库里已经存在的悬空 head** 的，
  guard 先落 = 第一时间关掉数据丢失窗口；CS-06 后上只是停止新增。本文件的顺序把「关窗口」排在
  「停新增」之后，是**可论证的取舍**，但称不上「不可互换」。
- **落地口径（不变）**：仍按台账走 C2-4（CS-06）→ CS-07 两个 commit、顺序 CS-06 → CS-07
  （CS-07 原写作 C2-5，该节已注记化，见 N-2）。**若实施中发现 CS-06 落地前存量库已有悬空 head
  造成数据损失，可与 judge 申请调换顺序**。
- **不可撤销**：CS-06 落地**不构成**撤销 CS-07 的理由 —— 另一个制造者 CS-12
  （`vfs-tree-copy.ts:243-260` 的 overlay 分支）虽被降为 P2「潜伏」，但一旦被复用就会重新引爆，
  且它同时会喂 `N-P1-01` 的 ref 泄漏面。
- 本节是这条顺序约束的**唯一权威表述**：本文件 C2-4 依赖栏写「CS-07 依赖本条」，
  CS-07 侧的对侧镜像在 `wave-b-core2.md` §0.3 与 §7 依赖栏，两处同向、不冲突。

### N-2 · CS-07 与 `wave-b-core2` 的归一（judge 专查项·已解除）

**已归一至 `wave-b-core2.md` §7（2026-10-01 主代理采纳 sr1-core2-c §1.3）；judge 专查项解除。**

- 原「CS-07 出现两次」的谱系疑问**不成立为两条**：ledger §2.4 里 `CS-07` 只有一条
  （`ledger-v2.md:124`），双波次列举发生在 §10 波次提案表这一层（`:457` 的 Wave B P1-S 格 /
  `:465` 的 Wave C 格），不是第二条缺陷。
- **权威落点 = `wave-b-core2.md` §7**（其存量库生效机制推导经实测正确、依赖栏与 §0.3/§11.2
  前后自洽、回归线 8 个文件实测全在）；本文件 **C2-5 已注记化**（七要素删除，只留一条交叉引用）。
- 三样东西按裁定**已上收**进 core2 §7：① UPDATE 触发器一并修；②「触发器改名是更廉价的存量库
  机制」这条纪律（与指纹对齐叠加用更稳，但单靠改名不够）；③ 测试落点并入既有
  `packages/core/test/vfs/vfs-gc-trigger.test.ts`。
- **顺序约束不在本节**：CS-06 → CS-07 的落地顺序以本文件 **N-1** 为唯一权威表述（core2 §0.3
  是它的对侧镜像，两处同向、不冲突）。
- **遗留（交台账层，非本分片范围）**：`ledger-v2.md:457` 把 CS-07 塞进「全部量级 S、零结构变更」
  的 P1-S 批次，与 `:465` 的 Wave C 格冲突；建议台账本身删掉该处列举或加顺序约束注记。

### N-3 · CD-01 修法与本波「移出事务」结论的冲突规避

台账 §10 Wave C 明写：「**CD-01 修法与本波性能结论冲突**：W6 明确否掉
「`resolveReconcilePathSets` 整体移进事务」，改为事务内复用已有扫描做集合断言」。
🔁 **归属已裁定（judge-r1 A.2，2026-10-01）**：CD-01（回滚 plan 与事务内状态不同源）
归 **本分片 = `wave-c2.md` C2-10**，不再归 `wave-c1`。
原写的「CD-01 归 `wave-c1`」是撰写期的误判——那个归属源自台账 `ledger-v2.md:463`
把「fork 缺上界读口」误写成 CD-01，而那条经 judge **正名为 CD-13**，归 `wave-c1.md` C1-1。
⚠️ 本波有三条「移出事务」，CD-01 与它们必须把边界划死，否则两个分片的 reviewer 会互相打架。
✅ **交叉引用已闭合（2026-10-01）**：`wave-c1.md` 已落盘，其 **N-3 第 2 条**的
「本分片不认领真正的 CD-01」注记**已改为「已移交 `wave-c2.md` C2-10」**；
两片对 `resolveReconcilePathSets` 的口径现已同向（`wave-c1.md` C1-1 属 CD-13、与本判据无关；
C1-2 的读口是「产出待读引用快照」而非写集合）。

**判据（写死为通用规则，CD-01 与本波三条都按它判定）**：

> 只读扫描若其**结论会被后续写操作直接消费（成为写集合）**，就必须留在事务内，
> 并在事务内复用该扫描结果做集合断言；
> 只有与写集合无关的「统计 / 探测 / 缓存预热 / 指针快照」才允许移出事务。

逐条套用：

| 扫描 | 结论是否成为写集合 | 判定 |
|---|---|---|
| `resolveReconcilePathSets`（**CD-01 = 本文件 C2-10**） | **是** —— `pathsNeedDelete` 就是要删的文件集合，移出即 TOCTOU，集合断言失真 | **删集合那一半必须搬进事务内**（复用 `reconcileVfsPaths` 已取的事务内 `liveHeadRows`，见 C2-10 第 3 步）；**`pathsNeedWrite` 那一半留在 plan 段**（依据 checkpoint 快照 + revision meta，stale 最多多一次 restore 短路，事务内会复核）。⚠ **整体移进事务是 W6 明确否掉的方案，本波三条不得外推** |
| `decideBackfillShortCircuit`（C2-2 段 0） | 否 —— 它只决定「走短路还是全量」，写的目标是 checkpoint 行，与消息表读无耦合 | 允许出事务 |
| `listMessageHeadersBySession` + 倒扫定位（C2-2 段 1 / C2-6） | 否 —— 写的是「无 checkpoint 的消息」，由 `message_checkpoint` 自身决定 | 允许出事务（段 2 用「gap 段连续前缀复核」闭合 TOCTOU，见 C2-2 的拍板） |
| `listSessionFileHeads`（C2-2 段 1） | 否 —— 产出的是 `filePointers` **指针快照**，stale-by-one 合法 | 允许出事务（见下） |
| `listBySession`（C2-3 copy） | 否 —— 产出的是待复制的快照 | 允许出事务；TOCTOU 后果是「复制到稍旧快照」，已在 C2-3 风险栏点名 |
| 导入的 `validateVfsZipEntries` / `validateMdTreeLimits`（C2-1 段 B0 之前） | 已经是事务外 | 现状如此，不动 |

**为什么 `listSessionFileHeads` 允许出事务**（这条是 C2-2 最可能被 reviewer 挑战的点，
理由必须写进 PR 描述）：它服务的 `capture`（`message-checkpoint.service.ts:41-67`）
要的是「最新 head」，所以它的扫描留在事务内；backfill 要的是「基线指针」——
checkpoint 的定义就是某一时刻的指针快照，晚一版合法。且 C2-2 段 2 的短事务里会对段 1
传下来的 gap 做「连续前缀复核」（那才是写集合的决定量），单连接单写者不变量保证事务内无并发写。

### N-4 · 本波触碰的 RULE 硬约束（逐条遵守，实施时对照）

1. **事务内语句一律同步执行**（RULE「TDBC 驱动层」）：所有分片/短事务的**让步只能落在
   事务之间**，事务回调内不得 `await` 任何非语句操作。C2-1 的片间让步、C2-2 段 0/1 之间的
   让步都写明位置。
2. **VACUUM 与维护类 SQL 直调 `conn.execute`、不包 transaction**（RULE 同条）：
   本波三条都**没有**把任何维护类 SQL 放进事务；C2-2 的段 2 只装
   `insertCheckpoint` + 游标 `set`，不夹带 VACUUM / GC。
3. **AsyncMutex 不可重入**（RULE 同条：事务回调里误用外层 `conn` 是**死锁**不是报错）：
   C2-1 段 R 的 `createWorkplaceRepo(tx)` 必须喂段 R 那条事务的 `tx`；
   C2-2 段 2 的四个 repo 全部 `new …(tx)`；C2-4 分片事务内的两个 repo 全部绑 `tx`。
4. **「单语句 = 隐式事务」**：C2-9 的 `deleteCheckpointsForMessages` 逐块 DELETE 仍在
   **调用方的外层事务内**（现状不变），不新开事务。
5. **给读路径换实现必须换观测面**（RULE「给读路径挂进程内缓存后…」条）：
   C2-2 / C2-7 的用例一律用「事务调用次数 / 语句条数 / 返回对象列集 / spy 直接调用计数」
   作为观测面，**禁止**用 `spyListBySession` 判「有没有发生全量扫描」。

### N-5 · 验收纪律（全波统一）

- **性能类断言一律取数量级回归线**（RULE「性能护栏取数量级回归线，不拿实测值卡线」）：
  C4 按 5–10× 余量取线，PR 里记录基线读数与余量，**不**卡实测值。
  ⚠️ **A6 / B6 两条已改为计数式**（RULE:102「精确不变量改用计数式假实现断言」）：
  它们的旧形态基线（单事务 3 万语句 / 2000 条消息倒扫）在测试环境里根本跑不出来，
  「数量级下降」无从判定 ⇒ 改为「事务调用次数 / 单事务语句数上界 / 语句调用次数与 M 无关」，
  墙钟只作记录不作门槛。
- **测试命令必须用带 flag 的形态**（RULE「core 的定向测试若只写 `npx tsx --test <file>` 会漏 flag」）：
  本文件所有定向命令统一写成
  `npm run test:fast -w packages/core -- <file>`（该 script 已含
  `--experimental-test-module-mocks --tsconfig tsconfig.test.json`）。
- **本波整体回归线**：`npm run typecheck -w packages/core` + `npm test -w packages/core`
  + `npm test -w apps/desktop -- --test-concurrency=2`（降并发理由见 RULE「Windows 下跑本仓测试的两个假信号」）。
  ⚠️ Windows 上 `apps/desktop` 的 `npm test` 存在 **N-P0-02 的假绿**（单引号 glob ⇒ 收集 0 条），
  在 N-P0-02 落地前，本波的 desktop 侧验收**不得**用 `npm test -w apps/desktop` 判绿，
  必须用等价双引号 glob 显式收集。
- **已知红基线**：`packages/core/test/message-checkpoint/performance.test.ts` 被
  `test` 脚本的 `!(performance)` 排除 ⇒ 本波不覆盖性能套件；若 B6/C4/A6 需要性能测量，
  走 `npm run test:perf`（该脚本单独收集），并按上面的数量级口径取线。