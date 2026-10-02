---
zone: mega-cr-fixspec-review
agent: sr1-c2-b（wave-c2 分片 · 组 B 条目组 reviewer）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c2.md（§0 / C2-3 / C2-4 / C2-5 / N-1 / N-2）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.4 CS-06/07/11、§9 附录 A、§10 Wave B/C）
  - docs/apm/RULE.md（pathTail、ref_count 三类持有者、验收牙齿、性能数量级、Windows 假信号）
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/service/vfs/impl/vfs-batch-io.service.ts
  - packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts
  - packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/domain/vfs/logic/validate-entry-name.ts
  - packages/core/src/domain/vfs/logic/vfs-batch-path.ts
  - packages/core/src/domain/vfs/logic/deferred-blob-gc.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts
  - packages/core/src/bootstrap/vfs/vfs-schema.ts
  - packages/core/src/bootstrap/vfs/vfs-revision-schema.ts
  - packages/core/src/bootstrap/vfs/vfs-content-blob-schema.ts
  - packages/core/src/bootstrap/novel-master-bootstrap.ts
  - packages/core/src/bootstrap/schema-migrations/index.ts
  - packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts
  - packages/core/src/domain/message-checkpoint/logic/detect-missing-revisions.ts
  - packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts
  - apps/desktop/src/main/services/vfs-batch.service.ts
  - packages/core/test/vfs/vfs-gc-trigger.test.ts / test/chat/fork-copy-batch-insert.test.ts（定点核对）
---

# sr1-c2-b · wave-c2 组 B（C2-3 / C2-4 / C2-5 + N-1 / N-2）审查报告

基线 `fe79b781`，worktree `D:\Dev\nm-worktree\mcr`。全程只读：未做任何 git 写，未创建/修改 `docs/apm/`，未动生产/测试代码与 fix-spec；临时 PowerShell 脚本已删除（`git status --porcelain` 复核后仅剩本报告所在目录的既有未跟踪状态）。

---

## 1 · 逐条 verdict 表

| # | 条目 | 七要素齐备 | 行号/引文核对 | 修法可行完备 | 验收可测（牙齿） | 依赖闭合 | verdict |
|---|---|---|---|---|---|---|---|
| C2-3 | CS-11 `session.copy` 事务内全量读 | 是 | **全对**（session.service.ts:352/:388/:396、message.service.ts:320/:328、fork-copy-batch-insert.test.ts:75/:125 逐条核对命中） | 主修法可行；次修法判定（可选）合理 | **C3 不可满足**（blob 列恒等断言与实现矛盾）；C1/C2/C4/C5/C6 可测且 C1 有牙 | 无前置，闭合 | **有条件通过**（1×P1 must-fix + 2 处 P2） |
| C2-4 | CS-06 `writeOrUpdateFile` 绕过 revision 层 | 是 | 基本全对（`vfs-batch-io.service.ts:84-102` 定义、`:303` 调用、desktop `:210-226`、`seed-live-head-revisions.ts:118`、`sqlite-vfs-entry.repository.ts:294-311`、`vfs-schema.ts:23` 全部命中；仅 `:98-102` 引文实际落在 `:100-101`） | 下沉可行、纯度主张成立；**但新增校验与「导入链路不走名校验」的既有拍板冲突** | D1–D8 均可测，D1 直查表观测面正确（合 RULE:139）；D4 归属划分清楚 | 无前置；C2-5 依赖本条，闭合 | **有条件通过**（1×P1 must-fix + 2 处 P2） |
| C2-5 | CS-07 blob 归零触发器不感知 `vfs_entry` | 是 | **全对**（`vfs-revision-schema.ts:44-54`、`:57-68`、`:78-83` 逐字命中，确认无 `AND NOT EXISTS`） | **修法在存量库上不成立**：bootstrap 快路径早退使「改名」对所有现有库零效果；且改名后旧触发器仍在库里继续触发 | E1/E2/E4/形态断言有牙；**E3 与修法自相矛盾**；E5 命令含两个不存在的文件路径 | 依赖 C2-4，闭合 | **不通过**（2×P0 + 2×P1 must-fix） |
| N-1 | CS-06 → CS-07 顺序约束 | 注记 | 台账 L124 原文「须在 CS-06 之后」核对在位 | **技术依据不成立**（零耦合，guard 先落反而更早关掉数据丢失窗口） | — | — | **P2 · 论证须改述**（不阻塞） |
| N-2 | CS-07 与 wave-b-core2 归一 | 注记 | 重复在位（SPEC.md:21 分片分配表 + SPEC.md:29 归一注 + ledger-v2.md:457 P1-S 批次） | 归一结论自洽，但**归一动作清单漏了 SPEC.md §2 表本身** | — | — | **P2 · 一致性缺口 + 待 judge 轮核对**（`wave-b-core2.md` 尚未交货） |

**verdict 计数**：通过 0 / 有条件通过 2 / 不通过 1 / 注记需改述 2。
**findings**：P0×2、P1×4、P2×6、P3×2。

---

## 2 · 三重点问的核查结论

### 重点问 ① — C2-4 的「下沉为纯函数」主张成立吗？「不能直接用 `insertFileSeedingRevision`」的反坑论断亲自验证了吗？

**反坑论断：成立，且我把它整条链路跑通了（P0 级肯定）。**

- `seed-live-head-revisions.ts:97-137` 的 `insertFileSeedingRevision`：`:104` 取 entry、`:107` 判 `entryId != null`、`:108` `findMaxVersionForEntry`、`:109` 分支——当 entry 存在但 `maxRevision == null` 时落到 `:118` 的 `entryRepo.insert(...)`。spec 引的 `:104-120` 覆盖这段，判断正确。
- `sqlite-vfs-entry.repository.ts:268-274`：`insert` → `insertAtVersion(scopeKey, path, content, 1)`；`:294-311` 的 `insertAtVersion` 是裸 `INSERT INTO vfs_entry (...) VALUES (...)`，**没有 `OR REPLACE`、没有 `ON CONFLICT`**。
- `vfs-schema.ts:23`：`UNIQUE(scope_key, path)`。
- ⇒ 覆盖写场景（entry 已存在、无 revision）必然撞唯一键。**反坑论断正确，PR 描述里必须保留这一段。**

**纯度主张：分层意义上成立，但「纯函数」这个措辞不严谨（P2）。**

我把 `writeWithRevision`（`revision-aware-vfs.service.ts:317-396`）连同 `nextVersionFor`（`:405-412`）、`resolveMaxRevision`（`:421-432`）的外部依赖逐个查了：

| 依赖 | 出处 | 层级 |
|---|---|---|
| `normalizePath` | `domain/vfs/repositories/impl/normalize-path.js` | domain |
| `assertValidVfsEntryName` | `domain/vfs/logic/validate-entry-name.js` | domain |
| `ensureParentDirectories` | `domain/vfs/logic/ensure-parent-dirs.js` | domain |
| `adjustRef` / `transferLiveRef` | `domain/vfs/logic/revision-ref-count.js` | domain |
| `vfsIsDirectory` | `@/errors/vfs-errors.js` | errors |

**零 service 层依赖**——「下沉到 `domain/vfs/logic/` 不违反分层」这个操作性主张为真，可以放行。但它不是纯函数：有 IO（走两个 repo）、读 `Date.now()`。spec 应改述为「无 service 依赖的领域函数」，别让实施者按纯函数去写单测 expectation。

**另外补一条 spec 没提的下沉副作用（P2）**：`nextVersionFor` 在**同文件内还有第二个调用者**——`:539` 的 `appendDeletedRevision`（以及 `:477` 的 `appendDeletedRevisionsForSubtree` 内联了同款 `Math.max`）。把两个辅助下沉后，`revision-aware-vfs.service.ts` 的删除路径必须**反向 import 回来**，否则编译不过/行为退化。spec 的「风险 R1」只说了「别漏带」，没说「删路径也要 import 回来」，实施步骤应补这一句。

### 重点问 ② — C2-4 的版本语义变化（`max(head, MAX(revision)) + 1`）与 RULE 记的 ref_count / 回拨语义兼容吗？

**兼容，且比旧语义更正确。三条链都验证过：**

1. **ref_count 转移链**：`writeWithRevision` 覆盖分支 `:375-395` 是 `entryRepo.update(...)` → `revisionRepo.append(...)` → `transferLiveRef(existing.version, version)`。`transferLiveRef`（`revision-ref-count.ts:213-224`）= 旧 head −1、新版本 +1；新版本行刚被 `append` 出来，`+1` 必然命中。旧版批量 ingest 写出的悬空 head 没有 revision 行——**第一次覆盖写时 `transferLiveRef` 的 −1 打在不存在行上**：`sqlite-vfs-revision.repository.ts:392-414` 的 `adjustRefCount` 只在 `delta > 0 && changes === 0` 时抛，−1 命不中是静默 no-op。这与 spec 病症栏的描述**逐字吻合**（`transferLiveRef(-1)` 静默 no-op）。批量 `batchAdjustRefCountWithDelta:426-449` 同样只在 `delta > 0` 时校验存在性。
2. **head 回拨语义**：RULE 与 `:398-404` 的注释一致——`resetHeadToVersion` 后 `head_version < MAX(version)` 是合法态（高版本被 checkpoint 钉住），新号必须越过 `MAX`。旧批量代码的 `existing.version + 1` **正是在这个场景下撞 `vfs_revision` 复合主键**。换成 `nextVersionFor` 之后方向一致，不引入新语义。
3. **三类持有者口径**：`repairRefCounts`（`revision-ref-count.ts:275+`）的期望值 = checkpoint 指针 + live head + read 引用。批量 ingest 改走 `writeWithRevision` 后，live head 这一路的 ref 第一次被正确记账 ⇒ 无主 +1 的面收窄，而不是扩大。

**唯一要提醒的口径落差（P2）**：D2 断言「覆盖写后旧版本 ref=0」对**存量悬空 head 的 entry 不成立**（旧版本根本没有行，谈不上 ref=0）。D1/D2 的夹具是从零建的所以绿，但 PR 描述里最好写一句「存量悬空 head 的首次覆盖写走的是 no-op 分支」，免得 reviewer 拿生产库跑 D2 判红。

### 重点问 ③ — C2-5 的触发器迁移路径写清没有？（ALTER TRIGGER？重建？存量库怎么升？）

**没写清，而且写错了。这是本组唯一的 P0 集中区。**

spec 修法第 4 步原文：「改名不新增语句 ⇒ bootstrap 幂等，**不需要 bump `SCHEMA_BOOT_VERSION`**，不改表结构」。这句话与 `novel-master-bootstrap.ts` 的实际控制流**直接冲突**：

```ts
// novel-master-bootstrap.ts:349-358
const bootVersion = await readSchemaBootVersion(tx);
if (bootVersion >= SCHEMA_BOOT_VERSION) {
  // 快路径：表结构已与当前 DDL/列对齐合同一致，跳过数十次 CREATE/PRAGMA。
  ...
  return;                      // ← 整个 DDL 循环被跳过
}
for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) { await tx.execute(sql); }  // :360-362
```

现存用户库的 `PRAGMA user_version` 已经是 17（`SCHEMA_BOOT_VERSION = 17`，`:120`），**全部走快路径提前 return**。改名后的 `trg_revision_delete_dec_blob_ref_v2` 在任何存量库上**永远不会被创建**。

而且这不只是我提一句就完——该文件 `:48-52` 的 JSDoc 把这条写成了硬纪律：

> 「变更 `NOVEL_MASTER_SCHEMA_STATEMENTS` 或 `SCHEMA_COLUMN_ALIGNMENTS` 时**必须 +1**，否则已升版库会走快路径而漏建表/漏补列。」

改触发器名就是改 `NOVEL_MASTER_SCHEMA_STATEMENTS` 的内容 ⇒ **按仓库自己的纪律，bump 是必须的**，spec 说「不需要 bump」直接违反了同仓的成文规则。

**第二个 P0：改名 ≠ 旧触发器失效。** SQLite 的触发器不是「代码不再引用就不存在」的东西——`CREATE TRIGGER IF NOT EXISTS <新名>` 只保证新名存在，旧名 `trg_revision_delete_dec_blob_ref` 在存量库里**仍然注册着、仍然在每次 `DELETE FROM vfs_revision` 时触发**，照样执行没有守卫的 `DELETE FROM vfs_content_blob ... WHERE ref_count <= 0`。也就是说：**即使 bump 了版本，守卫依然被旧触发器旁路，CS-07 在存量库上照样复发**。spec 自己在 E3 写了「旧名触发器仍在、新名触发器已建；E1 成立」——这三条放一起是**逻辑上不可能的**：旧触发器还在 ⇒ blob 照样被删 ⇒ E1 必红。回滚栏那句「旧触发器仍在库中但不再被使用」也是错的表述，触发器不存在「使用/不使用」这个状态。

**正确迁移路径（两条都可行，推荐 b）：**

- **(a) bump `SCHEMA_BOOT_VERSION` 17 → 18**：存量库走慢路径、重跑全量幂等 DDL。**但仍必须显式 `DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref`**，否则旧触发器继续生效。且改 `SCHEMA_BOOT_VERSION` 会让所有用户库下一次启动重跑整段 DDL + `alignSchemaColumns`，代价可接受但要与 wave-a/b 的版本号 bump 协调（**跨分片耦合，judge 要看**）。
- **(b) 注册一条 pending schema migration（推荐）**：新增 `vfs-revision-blob-guard-v1`，`up` 里 `DROP TRIGGER IF EXISTS <旧名>` + `CREATE TRIGGER <新名> ...`，登记进 `schema-migrations/index.ts` 的 `SCHEMA_MIGRATIONS` 数组。**关键优势已验证**：`runPendingSchemaMigrations` 在**快路径（`:354`）和慢路径（`:364`）都跑**，所以存量库和新建库都能升到；且不 bump `SCHEMA_BOOT_VERSION`、不动表结构、不触发全量 DDL 重跑。这与仓库既有 migration 的形态一致（如 `retire-pref-session-fs-version-check-v1`、`rename-smart-sort-rule-example-v1`）。

采用 (b) 时，spec 第 4 步「数组内容与顺序不变 / 不需要 bump」的结论**依然成立**（migration 不进 `NOVEL_MASTER_SCHEMA_STATEMENTS`），但「改名」必须挪进 migration 的 `up`，而不是留在 DDL 常量里。这是本条 must-fix 的全部内容。

**顺带一个 P1（迁移路径写清了，但测试路径没对上）**：
- spec 修法第 5 步与 E5 命令都写 `test/bootstrap/bootstrap.test.ts` —— **该文件不存在**。`test/bootstrap/` 下实际是 `bootstrap-ddl-smoke.test.ts` / `bootstrap-no-migrate.test.ts` 等 20 个文件；跑 `bootstrapNovelMaster` 两次并断言幂等的是 **`test/vfs/bootstrap.test.ts`**（已核对：`:15-40` 正是 `bootstrapNovelMaster` 幂等 + `SCHEMA_BOOT_VERSION` 断言）。
- E5 命令里的 **`test/vfs/blob-gc.test.ts` 也不存在**——blob-gc 用例在 `test/message-checkpoint/blob-gc.test.ts`（C2-5 自己的回归线里写对了，E5 命令写错了，同一条目内自相矛盾）。
- ⇒ E5 命令按原样跑必然报「no such file」，这条验收等于没写。须改成 `test/vfs/bootstrap.test.ts` + `test/message-checkpoint/blob-gc.test.ts`。

**再补一个 P2**：E1 要求「建一个**故意没有 revision 行**的 entry」。C2-4 落地后，批量 ingest 这条自然产路已被堵掉，测试**只能用裸 SQL 造这个形态**（`INSERT INTO vfs_entry (...)` 不配 `vfs_revision`）。spec 的测试策略没点明，实施者按 D1 的路子去走 applyBatchIngest 会造不出来。

---

## 3 · 组内一致性问题

### 3.1 C2-3 · C3 验收断言与实现矛盾（P1，must-fix）

C3 要求「造 3 条消息（**含 legacy `content_blob` 非空行**）…… 与源消息逐字段一致（含 hidden / attachments / token 列 / **blob 列**）」。

我把写入侧翻了一遍：`sqlite-message.repository.ts:52-77` 的 `toMessageParams` 对 `content_encoding` / `content_blob` **无条件写 `null`**（第 59、60 行，注释也写明「明文化后新行恒为空」），`MESSAGE_INSERT_SQL`（`:34-38`）的这两列只是占位保留。读侧 `listBySession` → `mapRows` → `readRowContent` 会把 legacy blob 行**解成明文 blocks**再交给业务层。

所以 copy 一条 legacy 压缩行的必然结果是：源行 `content_encoding='zlib' / content_blob=<bytes>`，副本行 `content_encoding=NULL / content_blob=NULL`、`content_json=明文`。**blob 列逐字段比对必然失败**，而这恰恰是明文化拍板（`novel-master-bootstrap.ts:102-109`）要的正形态，不是缺陷。

修法：C3 改成「**除 `content_encoding` / `content_blob` 两列按明文化正形态断言为 NULL 外**，其余字段逐字段一致」，并显式写一句「legacy 压缩源行经 copy 后归一为明文行——这是拍板的正形态，不是回归」。顺带 `C2-3` 次修法栏里那句「`INSERT ... SELECT` 是原样复制三列，不违反 `updateContent` 的 P0 三列约束」在**默认验收不进本条**的前提下是悬空的，保留可以，但要标清它只约束可选路径。

### 3.2 C2-4 · 新增的 `assertValidVfsEntryName` 与既有拍板冲突（P1，must-fix）

spec 的 R2 写「批量 ingest 的 `planBatchIngest` 已经过 `normalizeBatchRelativePath` ⇒ 正常路径不触发」。我逐个查了，**这个前提不成立**：

- `normalizeBatchRelativePath`（`vfs-batch-path.ts:16-44`）只做：整体 trim、反斜杠转正斜杠、去首尾 `/`、按 `/` 切段、丢弃空段与 `.` 段、遇 `..` 返回 null。**它不过滤控制字符，也不管单段的首尾空白**。
- `assertValidVfsEntryName`（`validate-entry-name.ts:66-79` → `validateVfsEntryName:31-48`）**拒绝**：C0/C1 控制字符（含 `\n \r \t`）、纯空白名、**首尾空格**、`.` / `..`。

⇒ 一个 ZIP 条目名叫 `foo.md `（尾空格）或含 `\x01` 的文件，`normalizeBatchRelativePath` 放行、`assertValidVfsEntryName` 拦下。**「正常路径不触发」是错的**——批量 ingest 的输入恰恰是外部文件名。

更要紧的是，这撞上一条**成文拍板**。`validate-entry-name.ts:27-31` 的 JSDoc：

> 「只拦『用户/agent 显式创建与重命名』的入口；**导入链路（zip/角色卡）不走本校验**（外部文件名可先导入再用改名功能纠正）。」

`:64-65` 的 `assertValidVfsEntryName` 自己也写着「只在『新条目诞生』的时机调用……**存量条目的内容更新不重新审判名字**（zip 导入的历史名可继续编辑）」。批量 ingest 是 zip 导入的**创建**通道，`writeWithRevision` 在 `existing == null` 分支（`:333-336`）必调 `assertValidVfsEntryName` ⇒ **C2-4 按现写法会改变一条已拍板的导入语义**：以前能导入的外部文件名，改后导入失败（报 `VfsError`，被 `applyBatchIngest` 的 catch 接住变成 `failed` 报告项，用户看到的是「导入失败」而不是「导入成功」）。

这不是措辞问题，是行为变更。两条出路，spec 必须二选一并写进「拍板项」：
- **(i) 显式接受**：写进 PR 描述 + 拍板表，声明「批量 ingest 从此受文件名校验约束」，并给 `failed` 报告项补可读文案；
- **(ii) 保持拍板**：给 `writeWithRevision` 开一个「跳过名校验」入参（默认 false），批量 ingest 传 true。代价是多一个参数，但零行为变更——**倾向推荐这条**。

（另：spec 引 `applyBatchIngest` 的 catch 在 `:308-318`，实际是 `:307-319`，catch 体到 `:318` 结束，差一行，可接受。）

### 3.3 C2-5 · 见重点问 ③（2×P0 + 2×P1）

除已列的之外，还有一处条目内自相矛盾：回归线写 `test/message-checkpoint/blob-gc.test.ts`（对），E5 命令写 `test/vfs/blob-gc.test.ts`（错）。同一条目里同一个文件两个路径，doc-fix 时一并抹平。

### 3.4 N-1 · 顺序约束的「技术依据」不成立（P2）

台账 L124 原文「S（*须在 CS-06 之后*）」核对在位，spec 忠实转述了。但 spec 给的理由——「CS-06 是『entry 有 hash、无 revision』的主要制造者；先修 CS-06 能消掉大部分触发条件，CS-07 才退成纵深防御」——是**优先级 / 归因清晰度**理由，不是技术必然：

- 两条改动**零耦合**：不同文件、不同机制（一个改写侧写路径，一个改 DDL 触发器），任一顺序都可编译、可独立验收、可独立回滚。
- 反过来，**guard 先落更安全**：CS-07 的触发器守卫正是用来保护**存量库里已经存在的悬空 head** 的。guard 先上，等于第一时间关掉数据丢失窗口；CS-06 后上，只是停止新增。spec 的顺序把「关窗口」排在「停新增」之后，是可以论证的取舍，但称不上「写死，不可互换」。
- 而且 N-1 自己规定两条进「同一个 PR、两个 commit」——顺序约束在同一 PR 内根本没有 teeth。

建议改述为：「台账 §2.4 拍板的落地口径（归因清晰度：先消主要制造者，让 CS-07 退成纵深防御）；技术上两条零耦合、可互换，若实施中发现 CS-04 落地前存量库已有悬空 head 造成数据损失，可与 judge 申请调换顺序。」这样保留台账口径，又不写一条经不起追问的「技术依据」。

### 3.5 N-2 · 归一逻辑自洽，但动作清单漏一处（P2 + 待 judge 核对）

- **重复在位已核实**：`SPEC.md:21` 的 `wave-b-core2` 行确实列了「P1-S 批次：M-03、M-04、CS-02、**CS-07**、CS-08、B、S-D-02」，`SPEC.md:29` 有归一注，`ledger-v2.md:457` 的 Wave B「（同波顺带）」清单同样列了 CS-07。**三处都真**。
- **归一结论自洽**：只立一条（七要素在 C2-5）、判定口径（CS-07 要改 DDL + 改名 + 加守卫测试 = 结构变更级别，本就不属「量 S、零结构变更」的 P1-S 批次）站得住；「若 wave-b-core2 已落了 CS-07，C2-4 落地后复查是否仍必要」的兜底也写到位。
- **缺口**：N-2 的动作只写「`wave-b-core2.md` 的 P1-S 批次清单移除 CS-07」。但 **`SPEC.md:21` 的分片分配表本身也还挂着 CS-07**，`SPEC.md:29` 的归一注也还在。归一要落干净，得同时改这三处（wave-c2.md 的 N-2 / SPEC.md:21 / SPEC.md:29），否则 judge 读总纲时看到的仍是双挂。
- **`wave-b-core2.md` 尚未交货**（`fix-spec/` 当前只有 `SPEC.md` / `state.md` / `wave-b-cloudsync.md` / `wave-c2.md` / `wave-e.md`；`state.md` 里 `s-core-b2` 仍标 `pending`）。N-2 描述的「wave-b-core2 那一格」**待 judge 轮核对**。不过按 `state.md` 的口径，s-core-b2 写稿时应当会读到 `SPEC.md:29` 的归一注，理论上不会重复立条——**风险在于两边都以为对方会改**。建议 N-2 把「谁改」写死：由 doc-fix 在 judge 轮统一改 `SPEC.md:21` 与 `wave-b-core2.md`，撰写机位不自行跨分片编辑。

### 3.6 C2-3 · 台账修法与 spec 主修法的偏离未点明（P2）

台账 §2.4 CS-11（L128）的改写后修法原文是「copy 走 `listMessageHeadersBySession` + 事务外取 body 段，**或**让 copy 走 `INSERT ... SELECT` 直复 `content_json`」。spec 的**主修法是第三条路**（把 `listBySession` 整体提到事务外），比台账更简单、diff 更小，理由（头投影省不掉读侧 parse）也站得住。但 spec 只在证据栏转述了台账原文，没写「本条主修法偏离台账建议，理由如下」。按 spec-check-loop 的「与代码硬冲突」不成立，但「与台账口径偏离」应当显式声明，否则 judge 会当成漏看。补一句即可。

### 3.7 其余核对通过项（记录在案）

- C2-3 与 fork 的不对称：`message.service.ts:320` 的 `listBySession` 确实在 `:328` 的 `transaction` **之外**，copy 确实在 `:388` 事务内。**不对称缺陷成立，不是取舍**——spec 这个定性准确。
- C2-3 回归线写「`test/chat/fork-copy-*.test.ts`（**3 个**）」，该 glob 实际只命中 2 个（`fork-copy-batch-insert.test.ts` / `fork-copy-parity.test.ts`）；第三个 `session-run-state.fork-copy-guard.test.ts` 在 `test/session-run-state/` 下。数字改成 2，或把 glob 放宽。（P3）
- C2-3 提到的 P0 三列约束位置：`sqlite-message.repository.ts:424-441` 的 `updateContent`，spec 引 `:426-431` 落在注释段内，成立。
- C2-4 病症链完整可推：`findMissingRevisionPointers` 只在 `message-rollback.service.ts:178` 一处被调（checkpoint 指针路径），确实发现不了悬空 head；`incrementRefsForCheckpointFiles`（`revision-ref-count.ts:227-236`）→ `batchAdjustRefCount` → `delta > 0` 预校验缺失并抛 `VfsError NOT_FOUND: Revision not found: entry X@Y`（`sqlite-vfs-revision.repository.ts:444-451`），与 spec 病症栏描述一致。**「后续任一 checkpoint 钉住该 head ⇒ 抛 NOT_FOUND」属实。**
- C2-4 D6 的 `test/vfs/vfs-batch-io.test.ts::T-B6` 在位（`:117`）。D8 命令的 5 个测试文件全部存在。C2-4 回归线「`test/vfs/` 全目录（30+ 条）」——实到 37 个文件，成立。
- C2-5 风险 R2 引 `synth/core-storage.md:138` 的 CS-19 修法原文确有「**不能省掉 entry 侧判定，否则踩 CS-07**」——**引用准确**，且 CS-19 的修法 `DELETE ... WHERE ref_count <= 0 AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = ...)` 与 C2-5 的守卫方向一致，「两边口径终于一致」的判断成立。
- C2-5 E1/E2/E4 + 形态断言（读 `VFS_REVISION_SCHEMA_STATEMENTS` 断言含 `NOT EXISTS` 且含 `vfs_entry`）**有牙**：旧代码下 `NOT EXISTS` 缺失，形态断言必红；E2（无 entry 引用时仍回收）防守卫过度保守，也有牙。
- 回归命令形态合规：`npm run test:fast -w packages/core -- <file>` 与 `packages/core/package.json` 的 `test:fast` script 定义一致；N-5 引的 RULE 条款（性能取数量级回归线 / Windows 下 `apps/desktop` 单引号 glob 假绿 / 性能套件被 `!(performance)` 排除）在 `RULE.md:102 / :111 / N-5` 处均在位。

---

## 4 · 结论

**组 Go / No-Go：No-Go。**

一句话理由：**C2-5 的触发器迁移路径按现写法在所有存量库上是死代码——bootstrap 快路径早退使「改名」永不执行、且旧触发器改名后仍在库里继续触发无守卫删除，加上 E5/E3 两条验收指向不存在的测试文件；这一条不闭合，C2-4→C2-5 的顺序依赖链就整体不 execute-ready。**

必须闭合的 must-fix（doc-fix 可直接落）：

1. **【C2-5 · P0】** 修法第 3/4 步重写为「注册 pending schema migration `vfs-revision-blob-guard-v1`」，`up` 内 `DROP TRIGGER IF EXISTS <旧名>` + `CREATE TRIGGER <新名>`，登记进 `SCHEMA_MIGRATIONS`；删除「不需要 bump `SCHEMA_BOOT_VERSION`」的错误结论（若仍选 DDL 路线，则必须 bump 到 18 **且** 显式 DROP 旧触发器，并承担跨分片版本号协调）。
2. **【C2-5 · P0】** 删掉回滚栏「旧触发器仍在库中但不再被使用」的错误表述；E3 改为「旧名触发器**已不存在**、新名触发器已建、E1 成立」。
3. **【C2-5 · P1】** E5 命令与修法第 5 步的测试路径改正：`test/bootstrap/bootstrap.test.ts` → `test/vfs/bootstrap.test.ts`；`test/vfs/blob-gc.test.ts` → `test/message-checkpoint/blob-gc.test.ts`。
4. **【C2-3 · P1】** C3 断言改口径：`content_encoding` / `content_blob` 按明文化正形态断言为 NULL，其余字段逐字段一致；补一句「legacy 压缩源行经 copy 归一为明文是拍板正形态」。
5. **【C2-4 · P1】** `assertValidVfsEntryName` 与「导入链路不走名校验」拍板的冲突二选一（推荐给 `writeWithRevision` 加「跳过名校验」入参，批量 ingest 传 true），并把 R2 里「`normalizeBatchRelativePath` ⇒ 正常路径不触发」的错误前提改掉。

建议同期抹平的 P2：C2-4 下沉步骤补「`appendDeletedRevision` 需反向 import `nextVersionFor`」、`:98-102` 引文改 `:100-101`、「纯函数」改述为「无 service 依赖的领域函数」、C2-3 补「主修法偏离台账建议」的声明、`test/chat/fork-copy-*` 数量改 2；C2-5 E1 注明「悬空 head 形态须裸 SQL 构造」；N-1 改述为「台账拍板口径 + 非技术必然」；N-2 动作清单补 `SPEC.md:21` 与 `SPEC.md:29`，并写明由 doc-fix 在 judge 轮统一改（`wave-b-core2.md` 未交货，**待 judge 轮核对**）。

C2-4、C2-3 的主体（行号、修法方向、观测面选择、TOCTOU 论证、反坑论断、纯度主张）在上述 must-fix 闭合后即可放行。