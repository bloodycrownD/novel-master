---
zone: xc-txn
agent: cross-cutting / 事务边界普查
files_scanned: 24（生产代码 17 + 驱动层 3 + 判定/口径文件 4）
---

# W3 横切报告：事务边界普查（xc-txn）

## 摘要

全仓 `conn.transaction` / `tx.transaction` 使用面共 17 个生产文件、21 个调用点，全部集中在 `packages/core`。本机位把这些点连同驱动层的锁语义画成一张「事务使用地图」，然后按两条线找缺陷：① 复合写无事务（多语句写序列裸奔）；② 事务内重活（事务内做全量读 / zlib 压缩 / 大 IO）。已知的两处（`importRules`/`resetDefaults`、session copy 事务内全量读）都已复核确认，并各找到一个尚未修的同族。

## 职责与边界

- **不负责**：SQL 语句本身的正确性（索引、谓词、N+1）、迁移策略、GC 谓词正确性。只管「哪些写该在一个事务里」「事务里有没有塞不该有的重活」「事务边界读没读对」。
- **横切对象**：`packages/core/src/{service,domain,infra,bootstrap}` + `packages/tdbc-driver-*` 锁语义。`apps/` 下无任何直接 `conn.transaction` 调用（实测 0 处），全部经 core service，故 apps 侧只作为调用方出现在证据里。
- **判定基线**：`docs/apm/RULE.md` L26（事务内语句同步执行、16ms 时间量子让步）、L72（维护类 SQL 直调 conn.execute 不包事务）、L109（后台搬运任务单行短事务）、L17（置位/压缩裸 await vs 导入吞错）。

## 对外接口

事务能力的唯一契约面是 `packages/core/src/infra/tdbc/ports/connection.port.ts:39`：

```ts
transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T>;
```

配套的 `TransactionalConnection` 在三驱动里行为一致：**在 tx 上再调 `transaction()` 直接 reject `NESTED_TRANSACTION`**（`packages/tdbc-driver-better-sqlite3/src/connection.ts:204`、`packages/tdbc-driver-op-sqlite/src/connection.ts:316`、`packages/tdbc-driver-rn/src/connection.ts:302`）。

**关键锁语义（本轮实测确认，是所有下游判定的地基）**：`transaction()` 整体跑在 `AsyncMutex.run()` 内（better-sqlite3 `connection.ts:47`、op-sqlite `connection.ts:59`），而 `AsyncMutex` 是**单链 FIFO、不可重入**的实现：

```ts
// packages/tdbc-driver-better-sqlite3/src/mutex.ts:16-22
run<T>(fn: () => T | Promise<T>): Promise<T> {
  const result = this.tail.then(() => fn());
  this.tail = result.then(() => undefined, () => undefined);
  return result;
}
```

由此推出三条铁律，后面所有 finding 都按它判：

| 事实 | 后果 |
|---|---|
| 事务期间 mutex 全程被占 | 事务内做的任何"重活"都在**独占**整条连接，别的 DB 使用者全部排队 |
| 事务回调里用**外层** `conn` 调 `execute/query/batch` | 链上自等待 → **promise 永不 settle（挂死，不是报错）** |
| 事务回调里用**外层** `conn` 再调 `transaction()` | 同上，在 `mutex.run` 就挂死，`NESTED_TRANSACTION` 检查根本走不到 |
| 只有在 `tx`（`TransactionalConnection`）上再开事务 | 立即 reject `NESTED_TRANSACTION`（可捕获） |

## 数据访问（事务使用地图）

按业务域列出全部 21 个生产调用点，标注事务内是否夹带重活：

| # | 调用点 | 事务内做什么 | 夹带重活？ |
|---|---|---|---|
| 1 | `bootstrap/novel-master-bootstrap.ts:346` | 建表 DDL + migration + provider/smartSort seed | DDL 数十条（启动一次性，可接受） |
| 2 | `service/chat/impl/session.service.ts:120` | insert session + `initializeSessionWorkspace` + setAgentConfig | ⚠ 整棵模板 VFS 拷贝 + revision 播种（F-6） |
| 3 | `service/chat/impl/session.service.ts:192` | `deleteSessionTree` 递归（messages/fs/kkv/run_state/vfs） | 否（提交后 defer GC，正确） |
| 4 | `service/chat/impl/session.service.ts:338` | **copy**：VFS 树拷 + `listBySession` + batchInsert + checkpoint 播种 | ⚠⚠ 全量消息解压（F-1） |
| 5 | `service/chat/impl/message.service.ts:236` | delete 单条 + 清 backfill 游标 + 删 checkpoint + revision sweep | 否 |
| 6 | `service/chat/impl/message.service.ts:301` | **fork**：同上结构 | 否（`all` 已挪到事务外 :293） |
| 7 | `service/chat/impl/message.service.ts:446` | truncate(null)：清游标 + 删 checkpoint + deleteBySession | ⚠ 事务外全量读只为取 id（F-10） |
| 8 | `service/chat/impl/message.service.ts:479` | truncate(anchor)：清游标 + 删 checkpoint + deleteAfterSeq | ⚠ 读在事务外（F-9） |
| 9 | `service/chat/impl/project.service.ts:150` | BFS 展开删全部会话 + project VFS | 否（大删除，提交后 GC） |
| 10 | `service/chat/impl/project.service.ts:245` | project copy：两棵 VFS + 技能负清单 + revision 播种 | ⚠ 慢路径明文全读（F-4） |
| 11 | `service/chat/impl/message-transcript-effects.service.ts:69` | `truncateTailInTransaction` | 否（读也在事务内，正确） |
| 12 | `service/message-checkpoint/impl/message-checkpoint.service.ts:46` | `capture`：扫 heads + 插 checkpoint | 否 |
| 13 | `service/message-checkpoint/impl/message-checkpoint.service.ts:86` | `backfillMissingBaselines` | ⚠⚠ 回退路径逐消息查（F-11） |
| 14 | `service/message-checkpoint/impl/message-rollback.service.ts:195` | 乐观锁计数 + `reconcileVfsPaths` + truncate | ⚠⚠ 逐路径 revision 恢复（F-16） |
| 15 | `service/skills/impl/skills.service.ts:437` | `sweepRevisionsUnderScope` + 负清单删 | 否 |
| 16 | `service/skills/impl/skills.service.ts:523` | 查重 + `renamePrefix` + front matter + 负清单迁移 | 否 |
| 17 | `service/template/impl/template-pull.service.ts:30 / :45` | pull / push 整树覆盖 | ⚠ 同 #2（F-6） |
| 18 | `service/vfs/impl/character-card-import.service.ts:140` | 删前缀 + 逐文件插 + 目录规则 + **backfill 全量扫消息** | ⚠⚠（F-3） |
| 19 | `service/vfs/impl/vfs-zip-io.service.ts:199` | 同上，ZIP 口径 | ⚠⚠⚠ 5000 文件（F-2） |
| 20 | `service/vfs/impl/vfs-batch-io.service.ts:291` | mkdir + 逐文件 `writeOrUpdateFile` | ⚠ 逐条 zlib（F-2 同族） |
| 21 | `domain/workplace/repositories/impl/sqlite-workplace.repository.ts:318` | 两条 UPDATE 原子 | 正确，但有嵌套隐患（F-14） |
| 22 | `infra/db-maintenance/impl/message-content-compaction.ts:426` | **单行**短事务，压缩在事务外 | ✅ 教科书 |
| 23 | `infra/db-maintenance/impl/blob-binary-normalization.ts:599` | **单行**短事务，压缩在事务外 | ✅ 教科书 |
| 24 | `infra/db-backup/provider-table-snapshot.ts:87` | 校验在事务外 + 事务内 scrub+insert | ✅ 教科书 |

**对照 RULE L72**：维护链路的 VACUUM/checkpoint 直调 `conn.execute` 不包事务（`docs/apm/RULE.md:72`）—— 符合 `SQLite 拒绝事务内 VACUUM` 的硬约束，标 **intentional**，不当缺陷。

## 依赖关系

- 被本区依赖：`AsyncMutex`（3 驱动各一份同名实现）、`message-content-codec` / `vfs zlib-codec`（事务内压缩的来源）。
- 依赖本区：`service/{chat,message-checkpoint,skills,template,vfs}` 全部复合写路径；`service/coordinated-write.ts`（补偿式写的替代品）。
- **未发现循环依赖**。

---

## 发现清单

### F-xc-txn-1 | P1 | `packages/core/src/service/chat/impl/session.service.ts:374` | 事务内全量消息解压（copy 与 fork 的不对称）

```
    return this.deps.conn.transaction(async (tx) => {   // :338
      ...
      const messages = await r.messages.listBySession(source.id);   // :374
```

`listBySession` 选 `MESSAGE_SELECT_COLUMNS`（含 `content_blob`），`mapRows` 逐行走 `rowToMessage` 解压（`sqlite-message.repository.ts:214-231`、`:81-87`）。随后 `batchInsert` 又对每条重跑 `encodeMessageContent`（同步 zlib，`sqlite-message.repository.ts:54`、`:172-173` 注释自认"toMessageParams 内含 encodeMessageContent 同步压缩"）。**一次 copy = 解压 N 次 + 压缩 N 次，全程独占 mutex。**

**同族对照（关键）**：`fork` 的同一段已经治过了——`message.service.ts:293` 把 `listBySession` 提到事务外，只把 `seq <= upTo.seq` 的**头投影**带进事务。`copy` 没跟。仓库里已有现成解法 `listMessageHeadersBySession`（`sqlite-message.repository.ts:249`，只选 id/seq/role/hidden/created_at_ms，不解压），且 `backfill-baseline-checkpoints.ts:152-156` 就是用它治好的、并留了「2026-09-30 实锤：大会话秒级」的注。`run-agent-turn.ts:634`、`hide-message.action.ts:9`、`message-transcript-effects.service.ts:84` 三处也都做过同一轮治理。copy 是**漏网的那一个**。

**中途失败后果**：不会脏数据（整段 rollback），但 commit 前整条连接被独占；对 op-sqlite 而言事务内语句走同步 `executeSync`（`packages/tdbc-driver-op-sqlite/src/connection.ts:257`），虽然有 16ms 量子让步（`:266-277`，注释里点名"会话复制 2 万条"），但 JS 线程与 mutex 仍被长时间占住，UI 侧所有 DB 读排队。

**建议**：把 `listBySession` 换成 `listMessageHeadersBySession` + 单独在事务外取 body 段（或直接让 `batchInsert` 走 `INSERT ... SELECT` 复制 blob 列，跳过解压→重压缩整轮）。会话创建/复制是用户高频动作，收益直接。

**置信**：confirmed

---

### F-xc-txn-2 | P1 | `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:199-244` | 5000 文件单事务 + 逐条压缩

```
    await this.conn.transaction(async (tx) => {
      ...
      for (const [logical, content] of files) {
        await insertFileSeedingRevision(repoTx, revisionTx, sk, logical, content);
      }
```

上限实测：`VFS_ZIP_MAX_ENTRY_COUNT = 5_000`、`VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32MB`（`packages/core/src/domain/vfs/logic/vfs-zip-validate.ts:17-18`）。每个文件走 `insertFileSeedingRevision`（`packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts:97-127`）：`findByPath` → `insert`（内含 `encodeContent` zlib）→ 再 `findByPath` → `findContentHash` → `revisionRepo.append`，**约 5 条语句/文件 ⇒ 最坏 2.5 万条语句 + 32MB 全量压缩在一个事务里**。事务末尾还叠了一次 `backfillBaselineCheckpoints` 全量扫消息（`:233-243`）。

**风险定性**：RULE L26 记录的移动端换库根因正是「**大事务**触发 SQLite 写磁盘临时表报 disk I/O error」。这条路径把事务规模上限直接顶到闸门值，而闸门本身是按"防巨型 ZIP 撑爆内存"设计的，不是按"单事务时长"设计的——两个约束没有对齐。

**中途失败后果**：脏数据不会留下（整体 rollback），但一次失败的 5000 文件导入要在移动端白跑十几秒同步语句；并发写者全程被挡。

**建议**：分片提交——每 N 个文件（如 200，对齐 `batchInsert` 的分片口径）一个短事务，delete-prefix 单独一个事务先行；或复用已存在的 `batchInsertFileEntriesWithHash` + `revisions.batchAppendWithRefCount`（`seed-fork-copy-parity.ts:106` 已有现成批写）。至少把 `backfillBaselineCheckpoints` 挪到导入事务**之后**（它与导入内容无原子耦合，只要求"导入后基线对齐"）。

**置信**：confirmed

---

### F-xc-txn-3 | P2 | `packages/core/src/service/vfs/impl/character-card-import.service.ts:140-182` | 与 F-2 同构，角色卡口径

同款循环 + 同款事务内 `backfillBaselineCheckpoints`（`:171-181`）。上限 `CHARACTER_CARD_MAX_FILE_COUNT = 5000` / `TOTAL_CONTENT_BYTES = 32MB` / `SINGLE_FILE_BYTES = 8MB`（`packages/core/src/domain/character-card/logic/character-card-limits.ts:19-25`）。代码注释已显示作者意识到事务时长问题（`:135` "体积/条目闸门 — 事务之前"），但只把闸门前置，没拆事务。

**中途失败后果 / 建议**：同 F-2。**置信**：confirmed

---

### F-xc-txn-4 | P2 | `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:263, :303` | `copyVfsTree` 慢路径在事务内全量取明文

```
  } else {
    // 慢路径：部分 blob 缺失，回退逐条处理
    const plainMap = await resolvePlainContentMap(repo, fromScope.scopeKey, fromPathPrefix);
```
```
  if (plainFiles.length > 0) {
    const plainMap = await resolvePlainContentMap(repo, fromScope.scopeKey, fromPathPrefix);
```

`resolvePlainContentMap` → `repo.scanContents`，把 scope+prefix 下**所有文件解成明文**塞进 `Map`（`vfs-tree-copy.ts:86-97`）。调用方 `session.service.copy:334` / `fork:334` / `project.service.copy:263,271` **全部在事务内**。快路径（`:226-260`，纯元数据 + `batchInsertFileEntriesWithHash`）是好的；慢路径只在「有 entry 无 hash」时触发——而这恰恰是 e2e fixture 直插、迁移未完成、写路径回滚这几类**已知会真实存在**的状态（见 RULE L32 关于"明文行永远合法"的说明）。

**中途失败后果**：不脏数据，但一次明文全量解压 + 逐条 insert 在事务内跑完。

**建议**：`scanContents` 挪到事务外（源侧是只读的，事务内重读没有一致性收益——源不会被本事务改），把 `Map` 带进事务。

**置信**：confirmed

---

### F-xc-txn-5 | P2 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249` | `importRules` 复合写无事务

```
    await this.deps.rules.deleteAll();
    for (const entity of entities) {
      await this.deps.rules.insert(entity);
    }
```

`deleteAll` 之后逐条 insert，无事务。bundle 条数无上限闸门。

**中途失败后果（P1 级数据后果，定 P2 是因为可自愈）**：用户在 UI 上看到的规则集变成**部分导入**——旧规则已全删，新规则只落了一半，且没有任何错误提示能让人知道是"半份"。此时 `listOrdered()` 按 `sort_order` 排序会给出错乱列表，`compiled rules` 也只认落库的那一半，智能排序行为静默降级。要恢复到导入前状态需要用户自己重新导出备份。

**建议**：包 `conn.transaction`；顺手把逐条 insert 换成 `batchInsert`（同 `session.service.copy:382` 的口径）。校验（`:234-245`）已经在事务外了，照 `provider-table-snapshot.ts:86` 的"校验外、写内"范式改即可。

**置信**：confirmed

---

### F-xc-txn-6 | P2 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:261-287` | `resetDefaults` 复合写无事务

```
    for (const rule of rules) {
      if (isBuiltinSmartSortRuleId(rule.ruleId)) { await this.deps.rules.delete(rule.ruleId); }
    }
    ...
    for (const row of this.deps.builtinSeed) { await this.deps.rules.insert({...}); }
    ...
    await this.renumber(finalOrder);
```

三段写（删 N 个 builtin → 插 4 个 seed → 逐条 renumber）全裸奔。builtin 现在是 4 条，量小，但 `renumber` 的量取决于用户规则总数（见 F-7）。

**中途失败后果**：builtin 规则被删掉却没插回来 ⇒ 内置智能排序规则**永久缺失**，且没有任何自愈路径（`resetDefaults` 是用户手动触发的，bootstrap 的 `seedBuiltinSmartSortRules` 只在启动事务内跑、只对空库生效）。用户规则相对顺序也会因 `renumber` 中断而错乱。

**建议**：同 F-5，一个事务包住三段。

**置信**：confirmed

---

### F-xc-txn-7 | P2 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:375-381` | `renumber` 逐条 update 无事务，被三处复用

```
    for (let i = 0; i < orderedIds.length; i++) {
      const rule = byId.get(orderedIds[i]!);
      if (rule == null || rule.sortOrder === i + 1) { continue; }
      await this.deps.rules.update({ ...rule, sortOrder: i + 1 });
    }
```

被 `moveRule:199` / `reorderRules:223` / `resetDefaults:287` 复用。N 条规则 ⇒ 最多 N 次独立 UPDATE 语句，每次都单独提交。

**中途失败后果**：`sort_order` 出现**重复号与空洞**并存。`listOrdered` 的排序口径依赖 `sort_order`，撞号时按 `rule_id` 隐式决胜（`:255-257` 注释亲述了这个坑）⇒ 用户的自定义排序静默变成字典序。这是三个调用方共用的单点，故定 P2。

**建议**：改 `conn.batch`（TDBC `batch` 本身就是单事务语义，`connection.port.ts:28-34`）或整个 `renumber` 包一层事务；仓储层加 `updateSortOrders` 批接口。

**置信**：confirmed

---

### F-xc-txn-8 | P2 | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:132-147` | `deleteBatch` 注释与实现相悖

```
    // 先全量校验（存在 + 非 builtin）再删除，避免半删状态
    for (const ruleId of ruleIds) { await this.getRuleOrThrow(ruleId); ... }
    for (const ruleId of ruleIds) { await this.deps.rules.delete(ruleId); }
```

注释承诺的"避免半删状态"**只由前半段校验实现**；后半段的 N 次 DELETE 本身不在事务内。前置校验确实挡掉了"校验中途失败"这一类，但挡不住"删除第 3 条时 DB 报错"——此时前 2 条已提交删除。同族还有 `setEnabledBatch:163-170`（逐条 `setEnabled`，部分生效）。

**中途失败后果**：用户勾选 5 条批量删，第 3 条失败 ⇒ 删了 2 条、留着 3 条，UI 刷新后才发现。

**建议**：删除循环包事务（校验已在外，正好符合"校验外、写内"）。

**置信**：confirmed

---

### F-xc-txn-9 | P2 | `packages/core/src/service/chat/impl/message.service.ts:464-489` | `truncateAfter` 读在事务外（TOCTOU）+ 未复用共享 helper

```
    const anchor = await this.deps.messages.findById(afterMessageId);      // 事务外
    ...
    const tailIds = await this.deps.messages.listIdsAfterSeq(sessionId, anchor.seq);   // 事务外
    ...
    await this.deps.conn.transaction(async (tx) => {
      ...
      await checkpoints.deleteCheckpointsForMessages(sessionId, tailIds);  // 用的是快照里的 tailIds
      await messages.deleteAfterSeq(sessionId, anchor.seq);                // 用的是活的 afterSeq
    });
```

**两个独立问题**：

1. **TOCTOU**：`tailIds` 是事务外快照，`deleteAfterSeq(sessionId, anchor.seq)` 是事务内活条件。两者之间若有并发 append，新消息的 checkpoint 行**不会被删**（不在 tailIds 里），但消息**会被删**（符合 afterSeq 谓词）⇒ 留下指向已删消息的孤儿 `message_checkpoint` / `message_checkpoint_file` 行。`message.service.ts` 内另两处（`:242`、`:455`）都是**读在事务内**的，唯独这里不一致。
2. **重复实现漂移**：仓库已有共享 helper `truncateTailInTransaction`（`packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:58`），它在事务内读 `listIdsAfterSeq`（`:64`）并额外清 Composer kkv 域（`:94-96`）。`message.service.truncateAfter` 自己重写了一遍，**少了 Composer 域清理**。`message-transcript-effects.service.ts:69` 走的是共享 helper——两条同语义路径副作用集已经不一致。

**中途失败后果**：孤儿 checkpoint 行会永久残留（无 checkpoint 孤儿 GC，`deleteCheckpointsForMessages` 是唯一清理口），后续 backfill/rollback 的基线判定可能撞上不存在的消息 id。

**建议**：`truncateAfter` 改为委托 `truncateTailInTransaction`（`createTruncateTailDepsFromTx` 已有现成工厂，见 `message-transcript-effects.service.ts:70`），一次解决 TOCTOU + 语义漂移。

**置信**：confirmed

---

### F-xc-txn-10 | P2 | `packages/core/src/service/chat/impl/message.service.ts:444` | 全量解压只为拿 id

```
    const all = await this.deps.messages.listBySession(sessionId);
    const ids = all.map((m) => m.id);
```

清空重聊路径把**全会话正文（含 hidden）逐条解压**，只为了取 `id` 数组。仓储层同文件 `:94` 的注释就写着「列出 seq > afterSeq 的消息 id（截断 tail 用，避免全量 listBySession）」——同一个 port 里已有专门干这事的 `listIdsAfterSeq`，这里没用。

**中途失败后果**：不脏数据。会话越长越慢，且这段全量读**就发生在开事务之前**（`:446` 才开事务），所以是纯粹的净增延迟。

**建议**：换 `listIdsAfterSeq(sessionId, 0)`，或新增 `listIdsBySession`。**置信**：confirmed

---

### F-xc-txn-11 | P2 | `packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts:86-136` | backfill 回退路径整体在事务内

```
    await this.deps.conn.transaction(async (tx) => {
      ...
      const result = await backfillBaselineCheckpoints(txEntries, txMessages, txCheckpoints, ...);
```

`backfillBaselineCheckpoints` 的回退路径对**每条消息**做一次 `hasCheckpoint` 单行读（`packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts:172`），倒序扫到第一个有 checkpoint 的消息为止。无 checkpoint 的会话 ⇒ N 次单行查询 + M 条 checkpoint 插入，全在事务内。

**为什么仍算问题**：方法注释（`:39`、`:70-73`）明确说"移入事务内执行"是**有意为之**——为了"持锁扫描避免并发 capture 捕获陈旧 head"（V8 修复）。这个动机成立，但代价是"每轮发送前"这条热路径上，一个 N=5000 的会话要做 5000 次同步单行读并独占 mutex。op-sqlite 侧连事件循环让步都只有 16ms 一次（`packages/tdbc-driver-op-sqlite/src/connection.ts:266-277`）。

**中途失败后果**：不脏数据（signal 中途退出会提交已写部分，`:75-79` 已论证其幂等安全性）。

**建议**：不动事务边界（有意设计），改**读形态**——把倒序 N 次 `hasCheckpoint` 换成一次 `SELECT message_id FROM message_checkpoint WHERE session_id=?` 集合查询后在内存里比对（回退路径本来就只在"游标判定不确定"时触发，集合查询的代价可接受）。`decideBackfillShortCircuit` 已经在做类似的批量判定。

**置信**：confirmed（问题成立）／对"事务边界本身"标 intentional（不改，只改读形态）

---

### F-xc-txn-12 | P2 | `packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:325-368` | `clearDomain` / `clearSession` 双 DELETE 无内部事务

```
  async clearSession(sessionId: string): Promise<void> {
    await executeTemplate(this.conn, this.parser,
      `DELETE FROM session_kkv_entry WHERE session_id = #{sessionId}`, {...});
    await executeTemplate(this.conn, this.parser,
      `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`, {...});
  }
```

`clearDomain(FILE_CACHE)` 同样是两条（`:329-341`）。两条独立提交。

**中途失败后果**：清一半 ⇒ 新表有旧行、旧表已空（或反之）。降级路径下两表并存时会读到不一致的键集合（`listKeys:371-379` 特意做了 UNION 兜底，说明作者知道两表可能同时有行）。调用方中 `session.service.delete:219` 走的是 tx 覆盖版本，**但** `clearSessionPromptCaches`（`packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts:34-35`）拿的是 root-conn 的 service、不在事务内。

**建议**：两条合成一条 `conn.batch`（TDBC batch 本身即单事务），或在 port 上写明"必须由调用方包事务"。

**置信**：confirmed

---

### F-xc-txn-13 | P2 | `packages/core/src/service/workplace/refresh-rule-snapshot.ts:35-41` | rule_snapshot 与 file_cache 两条 KKV 写无事务

```
  await deps.sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, serializeRuleSnapshot(entries));
  await deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
```

这两域是**强耦合的一对**——RULE L27 明确 `file_cache` 的有效性完全挂在 `rule_snapshot` 上（"改写缓存的只有用户改规则（`refreshRuleSnapshot`）"）。同属 `session_kkv_entry` 一张表，完全可以同事务。

**中途失败后果**：第二条失败 ⇒ **新规则快照 + 旧文件缓存**并存。`<workplace>` 前缀会用新规则去解释按旧规则算出来的文件缓存 ⇒ 短提示判定与前缀正文错配，且这个错配会**跨重启持续**（都落库了）。这与 RULE L17 说的"置位/压缩清空失败=状态错乱须报错"是同一类后果，只是这里连报错之后的补救路径都没有。

**建议**：两条并入一个短事务；`SessionKkvService` 若持有 conn 就地包，否则让 `refreshRuleSnapshot` 接受一个 tx。

**置信**：confirmed

---

### F-xc-txn-14 | P2 | `packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:315-331` | 仓储层自开事务，5 处生产代码用 tx 构造该 repo

```
    // 注意：TDBC 事务不可嵌套——目前唯一调用方（createWorkplaceService 的默认连接）
    // 在此处是非事务连接，安全；若未来有调用方把本方法放进外层事务，需改成"复用外层 tx"。
    await this.conn.transaction(async (tx) => { ... });
```

这条注释的**前提已经过期**。实测生产代码里有 5 处用 `tx` 构造 `SqliteWorkplaceRepository`：`character-card-import.service.ts:165`、`vfs-zip-io.service.ts:228`、`template/logic/push-session-workspace.ts:31`、`template/logic/initialize-session-workspace.ts:36`、`domain/chat/logic/seed-fork-copy-parity.ts:46`。目前这 5 处都只调 `copyScope` / `upsertDirRule` / `listDirRules`，没调 `renameRulesUnderLogicalPrefix`，所以**现在还没炸**。

**但真正的爆点在调用方**：`renameRulesUnderLogicalPrefix` 的两个生产调用方（`apps/desktop/src/main/ipc/handlers/vfs.ts:269,285`、`apps/mobile/src/services/workplace-operations.service.ts:157`）拿的是 `getWorkplaceForScope(rt, scope)` / `workplace` —— **root conn 构造的仓储**。而 desktop 的 `handleVfsRename` 在统一工具开关打开时先走 `executeSessionUserVfsOp`（`vfs.ts:261-265`），那条链内部是有事务的。只要将来有人把 `:269` 那行挪进 `executeSessionUserVfsOp` 的事务回调里，**不是报错，是挂死**——因为 root conn 的 `transaction()` 会先撞 `mutex.run`，`NESTED_TRANSACTION` 检查永远到不了。

**建议**：`renameRulesUnderLogicalPrefix` 改成"不自己开事务，改为要求调用方传入 tx"（与 `copyScope` 保持一致的契约），或在仓储构造时记录 `isTx` 并在开事务前短路。同时更新那条已经过期的注释。

**置信**：confirmed（现状）／suspected（触发路径尚未闭合）

---

### F-xc-txn-15 | P2 | `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:220` | 事务内逐路径 revision 恢复

```
              const reconcileStats = await this.reconcileVfsPaths(
                tx, plan, options?.revisionHeadBackfill === true
              );
```

`reconcileVfsPaths`（`:470-...`）在事务内做：扫全量 live heads（`:493`）→ 批量取 revision meta / content hash（`:524-532`）→ 然后**逐路径** `deletePathIfExists`（`:562-565`）与 `restorePathToRevision(WithBackfill)`（`:567-...`）。恢复路径会 `contentStore.put(rev.content)`（`revision-aware-vfs.service.ts:197` 一线同款）——即**解压历史正文 + zlib 重压缩 + blob 写**，全在事务内。

回滚链已经做过一轮优化（把"全局孤儿全表 DELETE"挪出事务，`:244-246` + `deferGlobalOrphanGc`），说明作者认同"事务内不能放重活"这条纪律。**逐路径恢复是同一原则下漏掉的一半**。

**中途失败后果**：外层 try/catch 会把它包成 `sessionFsRollbackVfsRestoreFailed` 并整体 rollback（`:232-237`），数据安全；但用户在大会话 + 多文件回滚时会看到一次长卡顿，且期间 resolve / UI 链全被挡住（注释 `:29-30` 自己承认这点）。

**建议**：与 `deferGlobalOrphanGc` 同款处理——把"删现路径"与"写回旧路径"两段之间插一个语句边界，或整体挪到提交后 + 失败补偿。乐观锁计数（`:203-216`）保留在事务内即可。

**置信**：confirmed

---

### F-xc-txn-16 | P3 | `packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:302-315` | `runInTransactionOrConn` 的 catch 兜底可能把真错误降级为「无事务执行」

```
  try {
    return await conn.transaction(fn);
  } catch (error) {
    if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") {
      return fn(conn);
    }
    throw error;
  }
```

设计意图正确（`conn` 已是 tx 时 `TransactionalConnection.transaction` 立即 reject，走 `fn(conn)` 复用）。隐患是 catch 面太宽：`fn` 内部若因为**别的原因**抛出 `NESTED_TRANSACTION`（例如某个用 root conn 构造的仓储在 `fn` 执行期间尝试开事务——虽然更可能先挂死，但 op-sqlite/rn 驱动的 `TransactionalConnection` 是 reject 而非挂死，路径存在），外层会把它当成"本来就在事务里"而**在事务外重跑整个 `fn`**。`fn` 有写副作用（`writeWithRevision` / `hardDelete` / `renamePath` / `renamePrefix`），重跑不是幂等的。

**中途失败后果**：若走到这条路，第一次执行已提交的部分写会被重复执行（`hardDelete` 幂等、`renamePath` 幂等、`writeWithRevision` 会多发一版 revision），最坏是多出一条 revision 历史。

**建议**：加一个显式的 `isTransactionalConnection(conn)` 判定（让 `TdbcConnection` 带一个可选标记，或在 core 侧维护 tx 集合）来替代 catch-and-retry；或在 catch 里先检查 `fn` 是否已经开始执行（用一次性 flag）。

**置信**：suspected（触发路径未闭合，现状无实害）

---

### F-xc-txn-17 | P3 | `packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:238-259` | `copyScope` = delete + 2 batch，无事务且 port 未声明前置条件

```
    await this.deleteScope(toScopeKey);
    ...
    await this.batchUpsertDirRules(mappedDirs);
    await this.batchUpsertFileRules(mappedFiles);
```

三个生产调用方（`push-session-workspace.ts:43`、`initialize-session-workspace.ts:49`、`seed-fork-copy-parity.ts:109`）都在外层事务里，**现状安全**。但 `copyScope` 在 port（`repositories/workplace.port.ts:54`）上没有任何"必须在事务内调用"的声明，而同文件隔壁的 `renameRulesUnderLogicalPrefix` 恰恰是**自己开事务**的那个（F-14）——同一份契约里两种相反约定并存，下一个调用方很容易踩。

**中途失败后果**：若被事务外调用 ⇒ 目标 scope 被清空后 batch 失败，规则全丢。

**建议**：三处批量写合成一次 `conn.batch`；port 补前置条件注释。

**置信**：confirmed（契约缺陷）／现状无实害

---

### F-xc-txn-18 | P3 | `packages/core/src/domain/provider/logic/provider-identity-repair.ts:148-149` | secret 搬运的 set→delete 顺序写

```
      await secretStore.set(newRef, value);
      await secretStore.delete(oldRef);
```

**中途失败后果**：delete 失败 ⇒ 两个 ref 同时存在。`detect` 下轮会因 `hasNew === true` 判定"跳过 rename"（`:124-130`）⇒ 旧 ref 永久成为孤儿凭据，明文密钥留在一处无人回收。属于安全面的小瑕疵，不影响功能。

**建议**：delete 失败时告警；或把两处写收进一个补偿对。

**置信**：confirmed

---

### F-xc-txn-19 | P3 | `packages/core/src/service/provider/impl/provider.service.ts:228-273`、`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:117-180` | 同库多表写用补偿式回滚代替真事务

`CoordinatedWrite`（`packages/core/src/service/coordinated-write.ts:92`）在头注释里给出的理由是"这些路径底下并没有真正的数据库事务可用（secretStore / kkv / messages 各自独立）"（`:10-13`）。**这个理由对 provider 的 secretStore 部分成立，对其余部分不成立**：

- `provider.service.delete` 的四步里，`suggestions` / `savedModels` / `providers` 三张表**都在同一个 SQLite 主库里**（`restoreProviderTableSnapshot` 的 `SCRUB_TABLE_ORDER` 就同时操作这三张，`packages/core/src/infra/db-backup/provider-table-snapshot.ts:98-105`），完全可以进一个事务。
- `message-transcript-effects.setMessageFloorAtMessage` 的 `hideRange` / `showRange` / `clearDomain×2` 同样全在主库。

**中途失败后果**：补偿本身也可能失败（`CoordinatedWriteRollbackError`，`:42-63`），此时留下半套状态且错误信息被包了两层。`message-transcript-effects` 的两个 cache 域补偿是**空实现**（`:167-170` 注释自认"清空后无法精确重建"）。

**建议**：把同库的那几步收进事务，只对真正跨存储的步骤（secretStore）保留 `CoordinatedWrite`。至少 `message-transcript-effects` 的 4 步值得整体事务化——它的补偿已经是"反向 range 操作"，语义上不如一条 DELETE/一条 UPDATE 干净。

**置信**：suspected（属 S-1 拍板范围，标 intentional 邻近；提出的是"补偿覆盖范围过大"而非"补偿本身错"）

---

### F-xc-txn-20 | P3 | `apps/mobile/src/storage/app-version-guard.ts:30-31`、`apps/mobile/src/storage/update-prefs.ts:89-90` | 移动端 prefs 双写无事务

```
    await appUi.set(APP_UI_KEY_LAST_RUN_VERSION, currentVersion);
    await appUi.set(APP_UI_KEY_RICH_RENDER_EPOCH, String(epoch));
```

**中途失败后果**：epoch 写失败 ⇒ 版本号已更新但 epoch 没涨 ⇒ 富文本渲染缓存 epoch 不变，可能拿到旧渲染。低影响、可自愈（下次版本变更仍会重算，但**本次**的渲染缓存不失效）。

**建议**：两条合成一次写入或包一层短事务；若 `appUi` 是 AsyncStorage（非 SQLite）则维持现状可接受，标 suspected。

**置信**：suspected

---

### 已复核为 intentional / 正确范式（不当缺陷上报）

| 位置 | 判定 |
|---|---|
| `infra/db-maintenance/impl/message-content-compaction.ts:426`、`blob-binary-normalization.ts:599` | ✅ 单行短事务 + 谓词防并发幂等，**压缩刻意放在事务外**。完全符合 RULE L26/L109，是仓库里的标准答案。 |
| `infra/db-backup/provider-table-snapshot.ts:86-92` | ✅ 校验在事务外（`:79-80` 有注释说明），scrub + insert 在事务内。 |
| `bootstrap/novel-master-bootstrap.ts:346-371` | ✅ 单事务建表 + migration + seed；`:373-374` 明确说明内置技能 seed **必须**放事务外（会与 `createSkillsService` 内部基于外层 conn 的装配嵌套冲突）——这是 RULE L72 同款约束的正确应用。 |
| `infra/db-maintenance/` 的 VACUUM / checkpoint 直调 `conn.execute` | intentional，出处 `docs/apm/RULE.md:72`（SQLite 原生拒绝事务内 VACUUM）。 |
| `service/message-checkpoint/impl/message-checkpoint.service.ts:46`（capture 把 heads 扫描放事务内） | intentional，出处方法注释 `:39` / `:47-48`（V8：避免并发 capture 读到未提交 head）。窗口极短（一次扫 + 一次插），不升级为 finding。 |
| `message-rollback.service.ts:244-246`（`deferGlobalOrphanGc`） | intentional 且是**正面先例**——正是"事务内不放全表 DELETE"的正确处理，应作为 F-15 的修复参照。 |
| `service/chat/impl/session.service.ts:192-197`、`project.service.ts:194-195` | ✅ 事务内删、提交后 `runDeferredBlobGc` / `runDeferredFileCacheGc`，分层正确。 |

## 争议与存疑

1. **F-1 的定级分歧**：我把 session copy 的事务内全量读定 P1。反对意见是"它不产生脏数据、且 `batchInsert` 已经分片 + 有 16ms 量子让步"。我的立场是定级看**用户可感知的劣化频率**（复制会话是用户主动高频操作，且 fork 已被治过、copy 漏网属于明确的不对称缺陷）而非数据风险。若台账按数据风险定级，这一条应降 P2。

2. **F-2 的"事务规模上限"是否算缺陷存在分歧**：5000 条目 / 32MB 的闸门是按内存与 DOS 防护设计的，作者未必预期它同时充当事务时长闸门。RULE L26 记录的 disk I/O 事故发生在 quick-sqlite 时代、并已通过换 op-sqlite + `SQLITE_TEMP_STORE=2` 根治，所以我**不能断言**当前 op-sqlite 上 5000 文件事务必然复现该故障。定 P1 是基于"闸门值未经事务时长验证"这一风险，而非已观测到的故障。**建议 W6 派一个验证代理在真机上实测一次 5000 条目 ZIP 导入的墙钟与 ANR 表现**。

3. **F-19 是否该报**：`CoordinatedWrite` 是 S-1 明确拍板的产物，我倾向标 `intentional`（补偿式写本身是设计），只把"补偿范围盖过了同库可事务化的部分"作为 P3 提示留给 W7 裁决，不作为缺陷进台账。

4. **未覆盖**：`apps/` 侧的 DB 写全部经 core service（实测 `apps/` 下 `conn.execute` 仅 2 处、`.transaction` 0 处），故本机位对 apps 的覆盖是间接的。desktop/mobile 是否有自己的 SQLite 通道未在本轮确认。

5. **驱动层覆盖**：`packages/tdbc-driver-rn`（回滚线）与 op-sqlite 在事务实现上逐行一致（已比对 `transaction` 主体），本报告的锁语义结论对三者通用；但 `nested-batch.ts` / `suite.ts`（`packages/tdbc-conformance/`）里的 SAVEPOINT 嵌套语义未逐条核。
