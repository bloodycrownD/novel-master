---
date: 2026-08-28
---

# vfs_revision 唯一键冲突修复 技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/vfs-revision-unique-conflict-fix/prd.md`（本轮与 PRD 同批生成，根因调研见 `docs/apm/memory/20260827-vfs-revision-unique-conflict.md`）。

修复两条撞号路径：

1. **机理 A（head 回拨占号）**：version 分配从 `head_version + 1` 全面改为 `MAX(head_version, MAX(version)) + 1`，使新号永远避开历史版本（含被 checkpoint 钉住的占号版本）。
2. **机理 B 残余（repair 静默失效）**：`entry-sequence-repair` 的检测不再吞错伪装健康，bootstrap 消费修复报告的 error 字段并打日志。

对齐既有拍板语义：`message-rollback-execution-redesign/spec.md` 的 **T-RB1（live version 可 ≥ 锚点，即 `head_version < MAX(version)` 是合法状态）**——本改造是把现状实现补齐到这条已拍板的语义，不改变任何既有设计决策。

## 总体方案

**核心原则：head_version 回归「指针」语义，不再兼任「版本号计数器」。**

- head_version 的全部既有读方（checkpoint capture、restore、sweep、reconcile 短路等）经探索逐个核过，都只依赖「head 指向一条已存在的 revision 行」，对分叉（head < MAX）自洽，**一律不动**。
- 三个按 `head + 1` 分配新号的写点（探索报告已穷举，无遗漏）改为统一分配器：
  1. `applyContentHashUpdate`（write 更新路径，SQL 内自增，versionCheck 真/假两个分支）；
  2. `appendDeletedRevision`（单文件 rm 墓碑）；
  3. `appendDeletedRevisionsForSubtree`（递归 rm 批量墓碑）。
- 分配器语义：`nextVersion(entryId, headVersion) = max(headVersion, findMaxVersionForEntry(entryId) ?? 0) + 1`。防御性的 `max(headVersion, …)` 不影响正确性（不变量保证 head ≤ MAX），仅为廉价保险。
- **实现取向（关键决策）**：在 **service 层计算 nextVersion**，entry repo 的 update 族改为「按显式 version 落 head」。不走 SQL 子查询方案——子查询把 entry repo 耦合到 revision 表、且时序正确性依赖「子查询读到 append 前状态」这种隐晦前提。显式传参可读、可测，与墓碑路径的分配方式天然一致。
- **乐观锁保留**：`applyContentHashUpdate` 的 `WHERE ... AND head_version = #{expectedVersion}`（versionCheck 分支）原样保留，`changes === 0` 的 CONFLICT/NOT_FOUND 判定不变——锁语义与号段分配解耦。
- **事务安全前提**：MAX 查询与 UPDATE/INSERT 必须同事务。现有 `runInTransactionOrConn` + TDBC 单写者保证「SELECT MAX → INSERT」无并发窗口，改造不引入新的事务边界。
- **ref 配对不变**：`transferLiveRef` / `adjustRef` / `batchAdjustRefCount` 的 ±1 配对（旧 head −1、新号 +1）一行不动，仅「新号是多少」变了。
- **存量错位库自愈**：无需迁移——错位库首次写入时 MAX+1 自然跳过占号段；entry-sequence-repair 修好后发号器错位也在启动期自愈。

## 最终项目结构

无新增文件目录；改动集中在 `packages/core` 的 VFS 域与 bootstrap。测试补进既有文件。

## 变更点清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/core/src/domain/vfs/repositories/vfs-revision.port.ts` | 新增接口方法 `findMaxVersionsForEntries(entryIds: number[]): Promise<Map<number, number>>`（批量 MAX，供递归删除防 N+1 查询） |
| 2 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts` | 实现批量 MAX：`SELECT entry_id, MAX(version) AS max_version FROM vfs_revision WHERE entry_id IN (...) GROUP BY entry_id`（IN 分块，对齐既有 batch 风格） |
| 3 | `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | `update` / `updateWithContentHash` 签名增加 `nextVersion: number` 参数（注释注明由 service 层按 MAX 语义分配） |
| 4 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` | `applyContentHashUpdate` 两个分支的 `head_version = head_version + 1` 改为 `head_version = #{nextVersion}`；乐观锁 WHERE 条件与 changes===0 判定**不动** |
| 5 | `packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts` | 新增私有 helper `nextVersionFor(revisionRepo, entryId, headVersion)`；接入三处：write 更新路径（`existing` 分支计算后传入 update）、`appendDeletedRevision`、`appendDeletedRevisionsForSubtree`（用批量方法一次取全部 MAX 再逐 entry 计算） |
| 6 | `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` | `replaceVfsSubtree` 走 `updateWithContentHash` 的调用点同步计算并传入 nextVersion（目标多为干净 scope，行为等价，统一语义防边角） |
| 7 | `packages/core/src/domain/vfs/logic/entry-sequence-repair.ts` | 删除 `readSequenceBoundaries` 的 `catch { return { seq: 0, needed: 0 }; }`，查询异常直接上抛——registry 层（`integrity-repair.ts` L169-177）本就约定 detect 抛错按「需要修复」保守处理 |
| 8 | `packages/core/src/bootstrap/novel-master-bootstrap.ts` | (a) entry-sequence repair 的 `runAll()` 返回报告中 `error` 非空的条目 `console.warn`（对齐同文件 `seedBuiltinSkills` 的 warn 模式）；(b) L267 处 `.catch(() => {})` 补 warn 日志 |
| 9 | `packages/core/test/vfs/revision-aware-vfs.service.test.ts` | 新增回拨场景用例（见测试策略 T-V1/T-V2/T-V3/T-V7） |
| 10 | `packages/core/test/vfs/entry-sequence-repair.test.ts` | 新增「detect 查询异常不判健康」用例（T-V4，mock 连接注入异常） |
| 11 | `CHANGELOG.md` | `## [Unreleased]` 修复段补条目（延续 1.5.3 同类修复的叙述） |

**明确不改**：`resetHeadToVersion`、checkpoint 创建/恢复全链路、`resolve-reconcile-paths`、`restore-path`、`revision-ref-count` sweep、seed 系列、`vfs-move.ts` / `vfs-copy.ts`、触发器与表结构——探索报告已验证这些读方对分叉状态自洽。

## 详细实现步骤

- Step 1 — phase-alloc-max — blocking: yes — qa: auto：repo 层改造——`vfs-revision.port.ts` 声明并实现 `findMaxVersionsForEntries`（分块 IN + GROUP BY）；`vfs-entry.port.ts` 与 `sqlite-vfs-entry.repository.ts` 的 update 族增加 `nextVersion` 显式参数，`applyContentHashUpdate` 的 SQL 自增改为显式赋值，乐观锁判定保持原样。
- Step 2 — phase-alloc-max — blocking: yes — qa: auto：service 层接入——`revision-aware-vfs.service.ts` 新增 `nextVersionFor` helper；write 更新路径、`appendDeletedRevision`、`appendDeletedRevisionsForSubtree` 三处换用统一分配器；`vfs-tree-copy.ts` 的 `updateWithContentHash` 调用点同步传参。
- Step 3 — phase-alloc-max — blocking: yes — qa: auto：新增回归测试 T-V1、T-V2、T-V3、T-V7（直接 SQL 构造 `head_version < MAX(version)` 现场，覆盖单文件回拨后 write/rm、多文件部分回拨递归删除、发号器回退模拟库）。
- Step 4 — phase-repair-hardening — blocking: yes — qa: auto：`entry-sequence-repair.ts` 去除 `readSequenceBoundaries` 静默 catch，异常上抛；补测试 T-V4（注入查询异常，断言 detect 抛错 / registry 判 needsRepair，绝不返回健康）。
- Step 5 — phase-repair-hardening — blocking: no — qa: auto：`novel-master-bootstrap.ts` 消费 repair 报告 error 字段并 `console.warn`，L267 空 catch 补日志；补测试 T-V5。
- Step 6 — phase-regression — blocking: yes — qa: auto：跑 `packages/core` 全量 VFS + message-checkpoint 套件（`npm run test:vfs` 及 checkpoint 相关），确认既有断言（含 `delete appends deleted revision at head+1` 这类健康库用例——健康库上 MAX+1 ≡ head+1，语义等价；用例名如需可改措辞，断言值不动）与 ref 配对闭合全绿。
- Step 7 — phase-changelog — blocking: no — qa: manual_user：`CHANGELOG.md` 的 `## [Unreleased]` 修复段补条目（描述「回滚后写入/删除报 vfs_revision 唯一键冲突」与「启动自修复静默失效」两点），随版本发布验收。

## 测试策略

框架与跑法：node:test（经 tsx），fixture 用 `test/helpers/novel-master-fixture.js` 的 `novelMasterTestFixture()`；断言必须按测试自己的 scope/前缀过滤（避免被内置技能 seed 的 `global:meta` 行污染——1.5.3 发版红灯教训）。

### 测试用例

- T-V1 — blocking: yes —（映射 Step 3）Given 文件写到 v5、v4/v5 被 checkpoint 钉住（ref_count>0），When 直接 SQL 把 head_version 拨回 v3 后执行 write（新内容），Then 成功且新 revision version=6、ref 配对（v3 −1、v6 +1）正确。
- T-V2 — blocking: yes —（映射 Step 3）同上现场执行 rm，Then 墓碑写入成功、version=6（MAX+1）、旧 head 引用 −1、entry 删除。
- T-V3 — blocking: yes —（映射 Step 3）Given 目录含 ≥3 文件且其中 1 个 head 已回拨，When 递归 rm 该目录，Then 批量墓碑全部成功、无 UNIQUE 冲突（覆盖批量 MAX 路径）。
- T-V4 — blocking: yes —（映射 Step 4）Given mock 连接使 `readSequenceBoundaries` 的查询抛错，When detect 运行，Then 异常上抛（或 registry 判 needsRepair=true），绝不返回健康；健康库上 detect 幂等返回 false 的既有用例保持通过。
- T-V5 — blocking: no —（映射 Step 5）Given repair 报告含 error 条目，When bootstrap 运行，Then 有 console.warn 输出（可 spy 断言）。
- T-V6 — blocking: yes —（映射 Step 6）既有套件全绿：`revision-aware-vfs.service.test.ts`、`entry-sequence-repair.test.ts`、`orphan-revision-gc.test.ts`、`integrity-repair-dual-refcount.test.ts`、`restore-path-reset-head.test.ts`、`rollback-version-short-circuit.test.ts`、`rollback-ref-count.test.ts`。
- T-V7 — blocking: yes —（映射 Step 3）模拟 1.5.3 取证的错位库（人为压低 `sqlite_sequence`、留孤儿 revision 占号），When 修复后 write 新文件再 rm，Then 均成功（验证与 repair 推号叠加后端到端自愈）。

## 兼容性或迁移说明

- **无 schema 变更、无数据迁移**：表结构、触发器、双 ref_count 体系全不动。存量错位库升级后首次写入即自愈（MAX+1 跳开占号段）。
- **blob 前置不变量**（vfs-version-redesign/spec.md L130-140）不受影响：write 路径 repo `append` 内部仍是先 put blob 再 INSERT，改的只是 version 数值。
- **回滚兼容**：本改动不写任何一次性迁移，git revert 即可完整回退行为。

## 风险与回滚方案

- **风险 1（递归删除性能）**：逐 entry 查 MAX 会退化为 N 次查询——已用批量 `findMaxVersionsForEntries`（一次 GROUP BY）化解；失败则递归删除场景保留原实现 + 逐条查询兜底（数据量小），Step 3 的 T-V3 会暴露回退。
- **风险 2（`resolveMaxRevision` 疑似死代码）**：`writeWithRevision` 仅在 `existing == null` 时调它，其内部再 `findByPath` 恒为 null，MAX+1 分支疑似不可达。**本轮不动它**（保留现状防御），实现时如确认死代码可在 CR 阶段顺带清理，不作为交付门槛。
- **风险 3（op-sqlite 读 sqlite_sequence 失败模式未实锤）**：R4 修法（不吞错）不依赖该前提，但真机是否复现静默失效属推断；T-V4 用 mock 注入异常覆盖逻辑分支，真机行为留待发版后观察日志。
- **风险 4（既有用例措辞）**：`delete appends deleted revision at head+1` 在健康库上语义等价无需改断言；若实现中对用例名做了澄清，须保证断言值不变（T-V6 兜底）。
- **回滚**：全部改动为纯代码逻辑，revert 提交即回滚；repair 的 catch 移除若在真机引发误报噪音，可单独 revert Step 4/5 而不影响 Step 1-3 的核心修复。
