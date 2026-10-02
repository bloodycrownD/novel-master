---
zone: fix-spec/wave-b-core1
agent: sr1-core1-a（readonly reviewer，条目组 A）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-core1.md（B1-1 / B1-2 / B1-3 + 分片级注记）
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一章七条 + 第四章 S 阶段协议）
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.4 CS-01 / CS-04 / N-P1-01、§10 Wave B）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md（分片索引行）
  - docs/apm/RULE.md（术语定义·工作区与存储层 / 实现禁令与坑）
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts
  - packages/core/src/domain/vfs/logic/vfs-tree-copy.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts
  - packages/core/src/domain/message-checkpoint/logic/revision-gc.ts
  - packages/core/src/domain/message-checkpoint/logic/deferred-revision-orphan-gc.ts
  - packages/core/src/bootstrap/vfs/vfs-revision-schema.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/session-fs/create-session-fs-service.ts
  - packages/core/src/service/skills/impl/skills.service.ts
  - packages/core/src/service/template/logic/initialize-session-workspace.ts
  - packages/core/src/service/template/logic/push-session-workspace.ts
  - packages/core/src/service/vfs/impl/character-card-import.service.ts
  - packages/core/src/service/vfs/impl/vfs-zip-io.service.ts
  - packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts
  - packages/core/src/service/vfs/impl/scoped-vfs.service.ts
  - packages/core/src/domain/vfs/logic/vfs-move.ts
  - packages/core/src/domain/vfs/logic/vfs-rename-primitive.ts
  - packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts
  - packages/core/src/infra/sql-template/placeholder.ts
  - packages/core/test/vfs/{vfs-rename-primitive,vfs-tree-copy-batch,vfs-gc-trigger,read-ref-count,entry-name-validation,orphan-revision-gc,vfs-repair-ref-count-batch}.test.ts
  - packages/core/test/skills/{skill-relocate,project-copy-skills,skills.service}.test.ts
  - packages/core/test/chat/{skill-result-ref,chat.services,project.service.agent-config}.test.ts
  - packages/core/test/message-checkpoint/{rollback-reach-hash-batch,rollback-version-short-circuit,revision-gc,deferred-revision-orphan-gc,rollback-ref-count}.test.ts
基线: fe79b781（worktree D:\Dev\nm-worktree\mcr，全程只读）
---

# sr1-core1-a 审查报告：wave-b-core1 组 A（B1-1 / B1-2 / B1-3）

## 摘要

组 A 三条同属 core-storage 的 VFS 路径/引用层病灶：**CS-01**（`renamePrefixInScope` 用 `REPLACE` 改写子树前缀，子树内同名目录被二次替换）、**N-P1-01**（项目删除对 `project:{id}` / `project:{id}:meta` 两个 scope 只删 entry、不减 live head 引用，revision + blob 永久泄漏）、**CS-04**（`sweepRevisionsUnderScope` 三步顺序把 scoped GC 排在删 entry 之后，而该 GC 靠 `JOIN vfs_entry` 圈范围 ⇒ 恒命中 0 行的死语句）。本轮我逐行重推了三条的病症机理、核对了全部 file:line、验证了修法可行性（含仓内同款 SQL 先例、事务边界、blob 触发器副作用）、实测了回归线断言与既有测试的相容性。**三条的病灶全部在位、修法方向全部成立**；但 spec 有 **2 处恒真断言（牙齿判据①违反）**、**1 处病症口径失真**、**1 处回归线归因错误**、**1 处验收命令漏文件**，均可由 doc-fix 直接照抄闭合，不构成实现返工。

---

## 1）逐条 verdict

### B1-1 · CS-01 `renamePrefixInScope` 子树同名目录被二次替换

| 项 | 结论 |
|---|---|
| 病症（代码重推） | **valid** |
| 证据（file:line + 引文） | **valid**，行号全部在位 |
| 修法可行完备 | **valid**，且仓内有同款先例 |
| 验收可测 | **基本可测**，断言文案有一处笔误 |
| 测试策略 / 回归线 | **valid**，引用文件全部存在、行号在位 |
| 依赖闭合 | **valid**（无前置） |
| **总 verdict** | **valid**（附 3 条 must-fix 级小项，均为文档级） |

**病症重推（我从代码独立验证）**：
`sqlite-vfs-entry.repository.ts:935-938` 的 `SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})` 替换整串所有匹配；`:947-953` 的根行 UPDATE 是 `SET path = #{newBase}` 定点赋值。`vfs_entry` 有 `UNIQUE(scope_key, path)`（`bootstrap/vfs/vfs-schema.ts:23`），因此症状分两种：深层同名段被替换后撞上已存在路径 ⇒ UNIQUE 冲突抛错；不撞 ⇒ 静默落到一个谁也没创建过的路径。spec 选的用例（`/a/sub/a/notes.md` → `/a_新/sub/a_新/notes.md`）落在第二种，是「静默错位」这一更难察的形态，**用例选得对**。

**调用链闭合（逐跳核对，全部在位）**：
- `vfs-move.ts:156` `await vfs.renamePrefix(from, to);` ✓
- `skills.service.ts:561` `await vfs.renamePrefix(oldPrefix, newPrefix);` ✓
- `scoped-vfs.service.ts:164` `async renamePrefix(oldDir, newDir)` → `:169` 转发 ✓
- `revision-aware-vfs.service.ts:278` `async renamePrefix(...)` → `:286` `runInTransactionOrConn` → `:288` `renameVfsDirectory` ✓
- `vfs-rename-primitive.ts:45` `await entryRepo.renamePrefixInScope(tx, scopeKey, oldDir, newDir);` ✓
- `vfs.service.ts:254` 的无 revision 变体只抛 unsupported，不受影响 ✓

**修法可行性（新发现的加强证据，spec 未引）**：
仓内已有**同一 parser、同一驱动**的同款定点拼接先例——`domain/workplace/repositories/impl/sqlite-workplace.repository.ts:303` 与 `:311`：
```sql
ELSE #{newBase} || substr(logical_path, length(#{oldBase}) + 1)
```
这直接证伪了 spec 里「三驱动 4 参数 REPLACE 可用性未验证、`substr` 是三驱动都有的核心函数」的保守论证——**这条写法在本仓已被 better-sqlite3 跑过**（workplace 仓储在 desktop/CLI 主链上）。另外 `infra/sql-template/placeholder.ts:16-28` 显示每次 `#{x}` 出现都会 push 一个参数，因此 `#{oldWithSlash}` 在同一条 SQL 里引用两次**无需新增绑定、也不会重复绑定**，spec 判断正确。边界推演：`oldBase="/a"` ⇒ `substr(path, 4)` 取 `sub/a/notes.md`，拼 `/a_新/` ⇒ `/a_新/sub/a/notes.md`，符合预期；`/a` → `/a/b`、`/a/b` → `/a` 两个方向换序前后等价。

**回归线逐条核对（行号全部在位）**：
- `test/vfs/vfs-rename-primitive.test.ts:159` = `T-V5: 目录名含 %/_ 时 renamePrefix 根行与子项均迁移、旧路径无残留` ✓（同文件 `:129` = T-V4 空目录 rename ✓；该文件现有 5 条 T-V1..T-V5，故 `# pass` 应为 6）
- `test/vfs/entry-name-validation.test.ts:90` = `it("renamePrefix 目录新名纯空白被拒", …)` ✓
- `test/chat/skill-result-ref.test.ts:736` = `it("updateSkill（renamePrefix）：旧 ref 仍按 (entryId, version) hydrate 到 wire 文本", …)` ✓
- `test/skills/skills.service.test.ts:573` = `// T-S3：同 entry 的 version 连续，renamePrefix 不重置；front matter…` ✓
- `test/message-checkpoint/rollback-reach-hash-batch.test.ts:119` 与 `rollback-version-short-circuit.test.ts:132,213` 三处均为 `renamePrefixInScope: async () => undefined,` ✓——是**手搓 fake repo 对象字面量**打桩，不是 module mock，改 SQL 表达式不影响其编译/行为，签名不变即绿 ✓

**本条问题（均为文档级）**：
1. **验收断言文案自相矛盾（doc-fix 照抄级）**：`:70` 写「`findByPath(scope, '/a/...')` 三个路径全为 `null`」——`'/a/...'` 是占位符不是路径，且「三个路径」指代不清（实际应为旧根 `/a`、旧深层 `/a/sub/a/notes.md`、错误深层 `/a_新/sub/a_新/notes.md`）。
2. **未引仓内 substr 先例**：建议把 `sqlite-workplace.repository.ts:303/311` 补进「证据」栏，把修法可行性从「保守论证」升级为「仓内已验证同款写法」，并删掉「4 参数 REPLACE 三驱动可用性未验证」的推测段（该推测已无必要，留着会让实现者犹豫）。
3. **测试策略的 `${suffix}` 要求与用例正文自相矛盾**：`:79` 要求「路径必须带 `${suffix}` 隔离」，但 `:70` 的用例正文是字面量 `/a/sub/a/notes.md`。二者取一即可——建议保留固定字面路径（scope_key 已按 project/session 唯一隔离，`T-V5` 同样是固定路径先例），把那句要求改成「路径可固定，隔离靠 scope_key」。

---

### B1-2 · N-P1-01 项目删除泄漏 `vfs_revision` 行及其 blob

| 项 | 结论 |
|---|---|
| 病症（代码重推） | **valid** |
| 证据（file:line + 引文） | **valid**，且行号修正栏正确 |
| 修法可行完备 | **valid**（含 `:187` 不得换的论证，已独立验证） |
| 验收可测 | **不可测 ×1 + 口径错 ×1** |
| 测试策略 / 回归线 | **valid**（文件与探针均核实存在） |
| 依赖闭合 | **valid**（与 B1-3 同 PR，双向对称） |
| **总 verdict** | **spec-defect**（病症与修法站得住，验收层有硬伤） |

**病症重推（全链在位）**：
- `project.service.ts:184` `await deleteSessionFsData(tx, session.id, id);` → `:187` `await deleteVfsPrefix(r.vfs, \`session:${id}:${session.id}\`, "/");` → `:199` `deleteVfsPrefix(r.vfs, \`project:${id}\`, "/")` → `:202` `deleteVfsPrefix(r.vfs, \`project:${id}:meta\`, "/")` —— **spec 的「行号修正」（台账 `:185,188` → 现行 `:187` / `:199` / `:202`）正确** ✓
- `copy()` 的种下侧 `:297-303` 与 `:304-310` 两次 `seedLiveHeadRevisionsUnderPrefix` ✓；`seed-live-head-revisions.ts:86` `refCount: 1` ✓
- 两条 GC 选不中的机理 ✓：`sqlite-vfs-revision.repository.ts:617-622` 的 COUNT 与 `:635-644` 的 DELETE 都是 `JOIN vfs_entry e ON e.entry_id = r.entry_id`（entry 已删 ⇒ 0 行）；全局兜底 `ORPHAN_REVISION_GC_SQL`（`:55-58`）谓词是 `ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`，而泄漏行 `ref_count=1` ⇒ 不选 ✓
- **「无自愈路径」核实成立**：`createRevisionRefCountRepairOperation` 定义在 `revision-ref-count.ts:357`，全仓唯一引用是 `service/integrity-repair.ts:78` 的注释示例，**确未注册** ✓
- **「会话删除路径不受影响」核实成立**：`create-session-fs-service.ts:71-80` 顺序为「删 checkpoint → `:72` decrementLiveRefsUnderScope → `:73` sweepSessionRevisions」，且 `session.service.ts:232` 同样先 `deleteSessionFsData` 再 `:237` `deleteVfsPrefix` —— GC 排在删 entry 之前 ✓。spec 的这条对照结论正确。

**修法完备性（我额外验的两处，spec 未写但结论支持 spec）**：
1. **`:187` 保持裸 `deleteVfsPrefix` 的论证成立且理由要改口径**：spec 说二次 decrement 会「把计数打到负值以下」——**这在物理上不会发生**。`vfs-revision-schema.ts:23` 的 DDL 是 `ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0)`，而 `batchAdjustRefCountWithDelta` 的 `delta < 0` 分支（`sqlite-vfs-revision.repository.ts:463-472`）**不做存在性校验、UPDATE 也不带 `AND ref_count > 0` 守卫**。所以二次 decrement 的真实表现是 **SQLITE_CONSTRAINT_CHECK 抛错 → 整个 `delete` 事务回滚 → 用户看到「删除项目失败」**，不是静默负计数。spec 的「勿换」结论不变，但风险描述与验收断言都要按这个真实机制改写（见 must-fix #3/#4）。
2. **换 sweep 后不会误删 read 引用**：read 引用在项目删除里由 `:176-182` 的 `adjustReadRefCount(-1)` 先行释放，且 BFS 循环（`:172-188`）整体早于 `:199/:202`。即便存在指向 project-scope revision 的 read 引用，减到 ≥1 也不会被 `ref_count <= 0` 谓词选中。spec 的「误删面为空」结论成立。

**回归线逐条核对（全部在位）**：
`read-ref-count.test.ts:217` = `项目删除（BFS 独立挂点）：全部会话的消息 refs 聚合 ?1，revision 全回收`（spec 引文写作「−1」，实际用例名用 `?1` 记法，属引文转写差异，不影响回归判断）；`skill-relocate.test.ts:205`、`project-copy-skills.test.ts:147`、`chat.services.test.ts:377`、`project.service.agent-config.test.ts:97` 四处均精确落在 `await ctx.projects.delete(project.id);` ✓。`refCountOf` 探针**确实存在**于 `read-ref-count.test.ts:98` ✓（spec 说「照抄该文件写法」准确）。`skill-relocate.test.ts:205` 之后的 T-SR3 断言（零 entry 残留 + `runDeferredBlobGc` 后零 orphan blob）在修复前后**都绿**：今天 blob 被泄漏的 revision 行引用着所以不算 orphan，修复后 revision 被删、blob 被触发器连带回收，也不算 orphan ✓。

**本条问题**：
1. **验收不可测（牙齿判据①违反，硬伤）**：`P-D4`（`:173`）断言「`ref_countOf(entryId, version) >= 0` 或等价『计数不为负』」——`CHECK (ref_count >= 0)` 让这条**恒真**，把 `:187` 改成 sweep 它也不会红（它会抛错，整条用例挂在异常上而不是断言上）。**这条用例目前不咬东西**。
2. **验收第 3 条 blob 断言主次颠倒**：主口径写「`SELECT COUNT(*) FROM vfs_content_blob WHERE content_hash = ?` 为 0」，但 copy 夹具下 `copyVfsTree` 复制的是 `content_hash`（`vfs-tree-copy.ts:200/241` `batchInsertFileEntriesWithHash`），blob 按内容寻址与**源项目共享**，删完复制体后该 blob 行必然仍在（源项目还引用着）⇒ 主口径在 copy 夹具下**必然失败**。spec 自己写了这个 caveat，但把失败的主口径留在前面，执行者会先撞红再回头。
3. **风险栏机制描述错**（见上「修法完备性 1」）：「打到负值以下」不成立，应改为「撞 `CHECK (ref_count >= 0)` 抛约束错误 → 事务回滚 → 删除失败」。
4. **触发面描述偏窄**：spec 只列「复制一次项目再删除」。实测第二条触发面是 **`push-session-workspace.ts:32` → `vfs-tree-copy.ts:372` 的 `seedLiveHeadRevisionsUnderPrefix` 会在 `project:{pid}` scope 种下 ref_count=1 的 live-head revision**，此后删除项目同样泄漏（`seedLiveHeadRevisionsUnderPrefix` 的生产调用点只有 `vfs-tree-copy.ts:372` 与 `project.service.ts:297/304` 两处，后者已列、前者未列）。修法天然覆盖，但病症应补，否则读者会低估面。

---

### B1-3 · CS-04 `sweepRevisionsUnderScope` 的 GC 步是死语句

| 项 | 结论 |
|---|---|
| 病症（代码重推） | **机理 valid；「泄漏」口径失真** |
| 证据（file:line + 引文） | **valid**，行号全部在位 |
| 修法可行完备 | **valid**（换序安全，我另验了 blob 触发器与 copyVfsTree 的交互） |
| 验收可测 | **不可测 ×1 + 命令漏文件 ×1** |
| 测试策略 / 回归线 | **基本 valid**（回归线有一处归因错误） |
| 依赖闭合 | **valid** |
| **总 verdict** | **spec-defect**（新主张成立，但严重度叙述与两处验收有硬伤） |

**★ 重点复核：撰写机位自报的新主张「CS-04 的 GC 步恒命中 0 行」——复核结论：成立，且可给出比 spec 更强的证明。**

机理链逐跳核对：
- `vfs-tree-copy.ts:390-411` 三步顺序为 `:397 decrementLiveRefsUnderScope` → `:404 deleteVfsPrefix` → `:405 deleteUnreferencedUnderScope`，spec 引文与行号**逐字一致** ✓
- `deleteVfsPrefix`（`:434-449`）无 excludes 走 `repo.deleteRecursiveIfAny`（`sqlite-vfs-entry.repository.ts:517-534`）→ 探测非空后 `delete(scopeKey, path, {recursive:true})` → `:503-510` 一条 `DELETE FROM vfs_entry WHERE scope_key=? AND (path=? OR path LIKE ?)` **硬删**；`vfs_entry` 上**没有任何 DELETE 触发器**（全仓三条触发器都在 `vfs-revision-schema.ts:35/45/58`，只挂 `vfs_revision`），所以删 entry 不带任何 revision 侧副作用 ✓
- `deleteUnreferencedUnderScope`（`sqlite-vfs-revision.repository.ts:583-647`）的圈范围条件 `e.scope_key = ? AND (e.path = ? OR e.path LIKE ?)` **全部作用在已被第 2 步物理删除的 entry 行上** ⇒ COUNT 恒 0 ⇒ `:626-628` 提前 `return 0`，DELETE 语句永不执行 ✓

**比 spec 更强的封闭证明（穷举所有分支，无反例）**：设调用 `sweep(R, scope, prefix, excl)`。
- 若 `excl` 为空：`deleteRecursiveIfAny` 把 `scope+prefix` 下 entry 全删 ⇒ GC 的 JOIN 无行可 join。
- 若 `excl` 非空：`deleteVfsPrefix` 退回逐条删除，**被豁免的 entry 仍在**，但 GC 的 `NOT (e.path = exclPath OR e.path LIKE exclPattern)`（`:606-613`）恰好把同一批路径排除 ⇒ 仍 0 行。
- 若 `listEntriesUnderPrefix` 返回空（`:524-526` 早退不删）：范围内本就没有 entry ⇒ JOIN 同样 0 行。
⇒ **第 3 步无条件恒 0，该函数从未回收过任何一行 revision。spec 的主张成立。**

**受害面「传递闭合」核实（5 条业务链，逐条在位且无遗漏）**：
`vfs-tree-copy.ts:348`（`replaceVfsSubtree` 的 `options.revisions != null` 分支）← `initialize-session-workspace.ts:37`（模板拉取，`:44` 传 `revisions`）与 `push-session-workspace.ts:32`（模板推送，`:39` 传 `revisions`）；`skills.service.ts:450`（`deleteSkill`，`:447` 事务内）；`vfs-tree-copy.ts:418-425` 的 `releaseAndDeleteVfsPrefix` 转发 ← `character-card-import.service.ts:144` 与 `vfs-zip-io.service.ts:203`（两者均在 `this.conn.transaction` 内，`:140`/`:199` 附近构造 `repoTx`/`revisionTx`）。全仓 `sweepRevisionsUnderScope` 的生产调用点只有这 4 处直接 + 2 处上游 = **5 条业务链，闭合无遗漏** ✓（另两处 `skill-result-ref.test.ts:402/668` 是测试直调，不计）。

**「泄漏面比台账更广」这一措辞需要 doc-fix 收敛**：台账 `ledger-v2.md:121` 的 CS-04 行**已经**写着「受害调用方 3→**5**」，条目数与 spec 一致。所以本条的新增价值不在调用点数，而在**机理层（GC 步可证明恒 0）**与**触发面横跨模板拉取/推送、技能整目录删除、角色卡导入、ZIP 导入**（远超 N-P1-01 的项目删除面）。spec 应把「比台账更广」改写为可核对的这句话，否则 judge 复核时会发现台账已记 5 条，误判 spec 在虚报。

**修法完备性（我额外验的两处，结论支持 spec）**：
1. **换序不会让 `copyVfsTree` 读到已被触发器回收的 blob**——这是换序唯一的真实危险面：`deleteUnreferencedUnderScope` 删 revision 会连带 `trg_revision_delete_dec_blob_ref`（`vfs-revision-schema.ts:45-54`）把 `vfs_content_blob.ref_count` 减到 0 并**删掉 blob 行**，而按新序此时 entry 行还在。核验：`replaceVfsSubtree` 换序后紧接的 `copyVfsTree`（`vfs-tree-copy.ts:139`）只从**源 scope** 取数据（`:149` 目录元数据、`:185` `scanFileEntriesWithMeta` 文件元数据、`:218` `findExistingBlobHashes`、`:229` `findExistingPaths`），**从不读目标 scope 的 entry 正文**；目标 entry 在同一事务内随即被 `deleteVfsPrefix` 删掉。5 条调用链里也没有 from == to 的同 scope 替换（project→session / session→project / global→project）。⇒ 换序安全。
2. **事务边界核实（派单点名要查的项）**：4 条直连调用链全部把 `SqliteVfsRevisionRepository` 用 **tx** 构造（`skills.service.ts:449`、`character-card-import.service.ts:142`、`vfs-zip-io.service.ts` 同形、`replaceVfsSubtree` 的 options 由上游传 tx 构造），而 `deleteUnreferencedUnderScope` 用的是构造期 `this.conn`（`sqlite-vfs-revision.repository.ts:614/629`）⇒ **三步在同一事务内原子**，换序不产生半可见窗口。`revision-gc.ts:42-48` 的「回滚事务内不得跑全表 DELETE」约定也不被触碰（scoped GC 带 scope/path 谓词，非全表）✓。

**既有回归断言与新顺序的相容性（我逐条读了断言正文，这是本条最该验的地方）**：
- `vfs-tree-copy-batch.test.ts` T-BATCH-1/2/3：三条的 sweep 目标 scope（session）都是**空 scope**，decrement/GC 均无对象 ⇒ 计数断言（`:93-95` blob ref_count=2、`:206-219` 每 entry 恰 1 条 revision）**不受影响** ✓；T-BATCH-2 第二次调用未传 `revisions`（`:150`）走 `deleteVfsPrefix` 分支，压根不进 sweep ✓
- 同文件 T-EXCL-1（`:262-323`）：断言 `:310-314` 明确写「排除前缀下 revision 行与 ref_count 应完全不变（**含 ref_count=0 的历史旧版不被 GC**）」——换序后 GC 提前跑，但 `NOT (e.path = excl OR e.path LIKE excl/%)` 把 `meta/skills` 整批排除，`/meta/skills/foo/SKILL.md` 的 v1（ref_count=0）**仍然不会被删** ⇒ **该断言保持绿** ✓（这是本条最容易翻车的一条，spec 只笼统说「既有断言保持绿」，我实测成立）
- `vfs-gc-trigger.test.ts:157` T-G2（`replaceVfsSubtree` 后无 orphan blob、前缀外文件 blob ref_count 不变）：换序只会**多删**本就要被删的 entry 的 revision，前缀外不受影响 ⇒ 绿 ✓

**本条问题**：
1. **病症口径失真（judge 会重点挑的一处）**：spec 写「revision 全留」「从来没回收过任何一行 revision」，容易被读成**永久泄漏**。实测这批残留是 `ref_count=0` 的孤儿（decrement 已把 head 减到 0），而 `deleteGlobalOrphans` 的谓词是 `ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`（`sqlite-vfs-revision.repository.ts:55-58`）**正好会收掉它们**——触发点是 `revision-gc.ts:81`（`sweepSessionRevisions` 默认 `includeGlobalOrphans !== false`，经 `create-session-fs-service.ts:73` 在**任何**会话/项目删除时都会跑一次）与 `deferred-revision-orphan-gc.ts:55` 的 `scheduleDeferredRevisionOrphanGc`（回滚链 `:295` 提交后调度）。⇒ CS-04 的真实病症是「**回收时机不确定、押注在一次不相关的后续删除/回滚上**；只读型使用下 revision 与 blob 持续堆积」，修法价值在于把回收变成**同事务内确定发生**。这不影响修法正确性，但影响严重度定级与「B1-3 不落地则 B1-2 泄漏照旧」的耦合叙述强度（B1-2 那批 `ref_count=1` 的行才是真永久泄漏，全局兜底确实选不中——这条不受影响）。
2. **S-O3 不可测（牙齿判据①违反）**：`:261` 的「`S-O3: sweep 的返回值/签名不变，调用方零改动`」——签名不是运行时可观测量，`sweepRevisionsUnderScope` 本身返回 `Promise<void>`，在 node:test 零 mock 基座下没有可注入 spy 缝，这条用例没有可写的断言体。
3. **验收命令漏新文件**：`:251` 的命令只跑 `vfs-tree-copy-batch.test.ts` 与 `vfs-gc-trigger.test.ts` 两个既有文件，而新用例落在**新建**的 `sweep-revisions-order.test.ts`（`:257`）与改动的 `workplace/template-pull.test.ts`（`:262`）——命令必须把这三个文件都带上，否则「命令通过」与「新用例红」互不相干。
4. **回归线归因错误**：`:270` 写「`packages/core/test/skills/project-copy-skills.test.ts`（技能整目录删除走 `skills.service.ts:450`）」——该文件测的是**项目复制 + 项目删除**（其 `:147` 是 `ctx.projects.delete`，与 `deleteSkill` 无关）。真正覆盖 `skills.service.ts:450` 这条 sweep 链的是 `packages/core/test/skills/skills.service.test.ts`（`deleteSkill` 出现在 `:296/321/342/353/377/383/398/410/618/759`）与 `packages/core/test/skills/skill-relocate.test.ts:126,142`。文件本身该留（它确实走 `ProjectService.delete`），但归因要改，否则实现者按错误理由评估风险。

---

## 2）组内一致性问题

| # | 问题 | 说明 | 建议 |
|---|---|---|---|
| C-1 | **两处硬伤性质相同（一恒真、一恒空），都踩 RULE「牙齿」判据①** | B1-2 的 `P-D4`（`ref_count >= 0` 被 DDL `CHECK` 保证恒真）与 B1-3 的 `S-O3`（签名不可观测）是本组唯二的「写了但咬不到东西」的断言。B1-1 的反向自检（把 `:936` 改回 `REPLACE`）写法正确，是本组唯一的合格牙齿样本 | 两条都改成**同源可观测面**的断言：`P-D4` 改「delete 不抛错 + 会话 scope 目标 revision 的 `ref_count` 与删除前完全一致（`revisionRefCounts` 深比对）」；`S-O3` 改「同一夹具分别走 `sweepRevisionsUnderScope` 直调与 `releaseAndDeleteVfsPrefix` 转发，断言两侧 `vfs_entry`/`vfs_revision` 计数逐项相等」 |
| C-2 | **「泄漏」一词在两条里指两种东西，组内未区分** | B1-2 = `ref_count=1`，`deleteGlobalOrphans`（`ref_count<=0` 谓词）永远选不中 ⇒ **真永久泄漏**；B1-3 = `ref_count=0`，全局兜底下次就会收 ⇒ **延迟回收**。两条同 PR、同属「删除链少释放/不释放引用」族，但严重度与「无自愈」结论只对 B1-2 成立 | 在两条的病症栏各加一句定性区分（B1-3 见 must-fix #4），并在 B1-2 的依赖栏注明「本条的『无自愈』结论不因 B1-3 修复而改变——两者泄漏的是不同 ref_count 区间的行」 |
| C-3 | **PR 归组与台账 §10 有轻微张力** | `ledger-v2.md:448/452` 把 CS-01 与 N-P1-01 放 Wave B、注明可合并同 PR；`:457` 又把 CS-04 列进「P1-S 批次」。spec 取「B1-2+B1-3 同 PR、B1-1 独立」是自洽的（CS-04 的修法文件 `vfs-tree-copy.ts` 与 N-P1-01 的 `project.service.ts` 分属两条独立改动，硬凑进 P1-S 批次反而增加 review 面） | 不改 spec；在分片注记加一行「本分片与台账 §10 的 P1-S 批次归组差异及理由」，供 judge 裁跨片矛盾时有据可依 |
| C-4 | **B1-3 与 B1-5 同域叠加的验收边界未写死** | B1-3 修好后模板拉取会真的删 revision，B1-5 在同一业务链上清 prompt 缓存。spec 只写「建议同波落地、分开验收」，没写「若两条同 PR，B1-3 的新用例不得依赖 B1-5 的缓存清理副作用」 | 在 B1-3 测试策略的跨切面用例（`template-pull.test.ts`）处补一句：该用例只断言 revision 计数，不掺 prompt 缓存断言，保证单独 revert B1-5 时仍可独立判定 |
| C-5 | **B1-2/B1-3 的耦合是单向依赖写成了双向** | B1-2 依赖栏写「同 PR 依赖 B1-3」，B1-3 依赖栏写「与 B1-2 同 PR（B1-2 依赖本条）」——表述一致但形式不对称，容易被实现者误读成 B1-3 也硬依赖 B1-2（B1-3 单独落地完全安全，只是价值降低） | B1-3 依赖栏改为「与 B1-2 同 PR 便于一起验收；**本条不依赖 B1-2，可独立落地**」 |

---

## 3）must-fix 清单（doc-fix 可照抄）

| # | 条目 | 位置 | 严重度 | 照抄级修改建议 |
|---|---|---|---|---|
| **M-1** | B1-2 | 验收 / 用例 `P-D4`（`wave-b-core1.md:173`） | **blocker** | 现文「断言 `ref_countOf(entryId, version) >= 0` 或等价『计数不为负』」恒真（DDL `vfs-revision-schema.ts:23` 有 `CHECK (ref_count >= 0)`），必须改为：**「① `ctx.projects.delete(copyId)` 不抛错（若 `:187` 被误改成 sweep，此处会撞 `CHECK` 抛错而红）；② 删除前后 `revisionRefCounts(ctx, entryId)` 深比对完全相等——会话 scope 的 live-head revision 计数不得被 `:199/:202` 的 sweep 波及」**。同时把用例名改为 `P-D4: 项目删除不做二次 decrement（delete 不抛错 + 会话 scope revision 计数零变化）` |
| **M-2** | B1-3 | 测试策略 / 用例 `S-O3`（`:261`） | **blocker** | 现文「sweep 的返回值/签名不变，调用方零改动」在 node:test 零 mock 基座下无可注入缝、不可观测。改为：**「`S-O3: releaseAndDeleteVfsPrefix 转发路径与 sweepRevisionsUnderScope 直调行为等价`——同一夹具建两套等价数据，分别走两条入口，断言两侧 `SELECT COUNT(*) FROM vfs_entry WHERE scope_key=?` 与 `SELECT COUNT(*) FROM vfs_revision WHERE entry_id IN (…)` 逐项相等」** |
| **M-3** | B1-2 | 验收第 3 条（`:160`） | major | blob 断言主次颠倒（copy 夹具下 blob 按 `content_hash` 与源项目共享，`vfs-tree-copy.ts:241` `batchInsertFileEntriesWithHash` 复制的就是 hash，主口径**必然红**）。改为：**主口径 = 「该 `content_hash` 的 `vfs_content_blob.ref_count` 相对删除前恰好 −1」；删除「COUNT=0」主口径，只在文末保留一句「若同时构造了不共享 blob 的独立项目，才可用 COUNT=0」作为可选变体** |
| **M-4** | B1-3 | 病症（`:200-204`） | major | 「从来没回收过任何一行 revision」成立，但「revision 全留」易被读成永久泄漏。补一段：**「残留行的 `ref_count` 已被第 1 步减到 0，属于 `deleteGlobalOrphans`（`sqlite-vfs-revision.repository.ts:55-58`，谓词 `ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`）的收缴对象——它会在**下一次任意会话/项目删除**（`revision-gc.ts:81`，经 `create-session-fs-service.ts:73`）或**回滚提交后**（`deferred-revision-orphan-gc.ts:55`）被顺带清掉。故本条的病症是『回收时机押注在不相关的后续事件上、只读型使用下持续堆积』，而非不可回收的永久泄漏；修法价值在于把回收变成**同事务内确定发生**。注意这与 B1-2 的 `ref_count=1` 行不同——那批全局兜底永远选不中，是真永久泄漏」** |
| **M-5** | B1-2 | 风险栏（`:190-191`） | major | 「把别人的 revision 计数打到负值以下」机制描述错误。改为：**「`:187` 若被误换成 sweep，`batchAdjustRefCountWithDelta` 的 `delta < 0` 分支（`sqlite-vfs-revision.repository.ts:463-472`）不做存在性校验、UPDATE 也无 `AND ref_count > 0` 守卫，二次 decrement 会撞 `vfs_revision` 的 `CHECK (ref_count >= 0)` 抛 SQLITE_CONSTRAINT_CHECK → 整个 `delete` 事务回滚 → 用户看到『删除项目失败』（不是静默负计数）。结论不变：`:187` 必须保持裸 `deleteVfsPrefix`」** |
| **M-6** | B1-3 | 验收命令（`:251`） | major | 命令只跑两个既有文件，漏掉承载新断言的两个文件。改为：**`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/vfs/sweep-revisions-order.test.ts test/vfs/vfs-tree-copy-batch.test.ts test/vfs/vfs-gc-trigger.test.ts test/workplace/template-pull.test.ts`** |
| **M-7** | B1-3 | 回归线（`:270`） | minor | 「`project-copy-skills.test.ts`（技能整目录删除走 `skills.service.ts:450`）」归因错误（该文件 `:147` 是 `ctx.projects.delete`）。改为：**「`packages/core/test/skills/project-copy-skills.test.ts`（项目复制 + `ProjectService.delete` 走 `:199/:202` 两条 sweep）**＋** `packages/core/test/skills/skills.service.test.ts`（`deleteSkill` 覆盖 `skills.service.ts:450` 这条 sweep 链，`:296/321/342/353/377/383/398/410/618/759`）＋ `packages/core/test/skills/skill-relocate.test.ts:126,142`」** |
| **M-8** | B1-1 | 证据 + 修法（`:60-66`） | minor | 补仓内先例并删推测：**「同款定点拼接在本仓已被验证——`domain/workplace/repositories/impl/sqlite-workplace.repository.ts:303/311` 就是 `ELSE #{newBase} \|\| substr(logical_path, length(#{oldBase}) + 1)`，同一 `SqlTemplateParser`、同一驱动。另 `infra/sql-template/placeholder.ts:16-28` 每次 `#{x}` 出现 push 一个参数，故 `oldWithSlash` 重复引用无需新增绑定」**，并删掉「4 参数 `REPLACE` 三驱动可用性未验证」的推测段 |
| **M-9** | B1-1 | 验收（`:70`）+ 测试策略（`:80`） | minor | 断言文案改为逐条列举：**「`findByPath(scope,'/a_新/sub/a/notes.md')` 非空、`findByPath(scope,'/a_新/sub/a_新/notes.md')` 为 null、`findByPath(scope,'/a/sub/a/notes.md')` 为 null、`findByPath(scope,'/a')` 为 null」**；同时把 `:80` 的「路径必须带 `${suffix}` 隔离」改为**「路径可用固定字面量，隔离靠每用例新建的 project/session 产生的唯一 `scope_key`（`T-V5` 即固定路径先例）」** |
| **M-10** | B1-2 | 病症（`:109`） | minor | 触发面补第二条：**「除 `copy()`（`:297/:304`）外，`push-session-workspace.ts:32` → `vfs-tree-copy.ts:372` 的 `seedLiveHeadRevisionsUnderPrefix` 同样在 `project:{pid}` scope 种下 `ref_count=1` 的 live-head revision，随后删项目同样泄漏。生产调用点只有 `vfs-tree-copy.ts:372` 与 `project.service.ts:297/304` 两处」** |
| **M-11** | B1-2 / B1-3 | 依赖栏（`:183-186` / `:273-277`） | minor | B1-3 依赖栏改为「与 B1-2 同 PR 便于一起验收；**本条不依赖 B1-2，可独立落地**（单独落地时价值是回收时机确定化，而非止漏）」；B1-2 依赖栏补「本条『无自愈路径』结论不因 B1-3 修复而改变——两者泄漏的是不同 `ref_count` 区间的行」 |
| **M-12** | B1-3 | 风险栏（`:281-285`） | minor | 补一条隐含约束：**「换序后 GC 在 entry 仍存在时删 revision，`trg_revision_delete_dec_blob_ref`（`vfs-revision-schema.ts:45-54`）可能把 `vfs_content_blob` 行删到 0，而 entry 要到紧随的 `deleteVfsPrefix` 才删——中间窗口必须留在同一事务内（4 条调用链均以 tx 构造 `SqliteVfsRevisionRepository`，已核实）。若日后有人把 sweep 拆出事务，会出现 entry 指向已删 blob 的窗口，注释里必须写死这条约束」**。另可补正向结论：`copyVfsTree` 只读源 scope 元数据（`vfs-tree-copy.ts:149/185/218/229`），不读目标 entry 正文，故换序不会读到已回收 blob |

---

## 4）结论

**组 Go**（No-Go 的只有 must-fix #1、#2 两条恒真断言，均为文档层一次性改写，不触及实现方案）。

一句话理由：**三条病灶全部在位、CS-04「GC 恒 0 行」的新主张经封闭证明成立、修法方向与事务边界全部站得住，剩余缺陷集中在两处恒真断言、一处病症口径失真和若干引用错漏，doc-fix 照抄 M-1~M-12 即可闭合。**

verdict 计数：valid 1（B1-1）／spec-defect 2（B1-2、B1-3）；其中 **验收不可测 2**（B1-2 `P-D4`、B1-3 `S-O3`）、**口径失真 1**（B1-3 病症）、**回归线归因错 1**（B1-3）；code-drift 0（全部 file:line 与引文逐处核对在位，撰写机位的「行号修正」栏亦正确）；修法打架 0（B1-2↔B1-3 的顺序叙述与依赖声明自洽，仅表述需对称化）。