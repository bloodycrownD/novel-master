---
date: 2026-07-26
---

# message-rollback-execution-redesign 技术规格（SPEC）

## 需求来源

- PRD：`Iterations/message-rollback-execution-redesign/prd.md`（验收范围 **B**：热路径 SQL 闭环 + 引用计数；推迟 blob GC）
- 前置：`message-checkpoint-v2`、`vfs-revision-storage-optimize`
- 基线行为：`bugs/rollback-version-short-circuit`、`bugs/rollback-reach-hash-batch`（可内化，不重复当主交付）

## 设计目标

1. 回滚热路径由「多轮 JS 编排」收敛为「同连接同事务内极少次 SQL + 仅处理必须写盘路径」。
2. 用 `vfs_revision.ref_count`（按检查点指针行数 + live head 引用）替代每次回滚现算可达集。
3. 回滚同步路径不再做全库 `collectAllReferencedHashes` + `gc`；blob 回收改延期入口。
4. 产品语义不变：正文对齐目标树、T-RB1（live version 可 ≥ 锚点）、undo_send/rewind/降级/回补、全库 blob 安全。

## 总体方案

### 架构分层

```text
App (Desktop/Mobile/CLI)
  → sessionFs.rollbackToMessage
    → MessageRollbackService
         [事务外] 解析锚点/mode；可选：一次查出「需写盘」路径列表
         [事务内] ① 对需写盘路径走 restore（保留短路）
                  ② truncate：SQL 子查询删 checkpoint + 消息（顺带 −ref）
                  ③ DELETE vfs_revision WHERE session_prefix AND ref_count<=0
         [事务后/空闲] runDeferredBlobGc（collect+gc 算法唯一入口；T-GC2 合同不变）
```

**不依赖**未验证的单次 multi-statement 脚本；以 TDBC `conn.transaction` + 多次 `execute`/`batch` 实现「闭环」。若某绑定支持 script，可作为后续加速，非门禁。

### 引用计数语义

- 列：`vfs_revision.ref_count INTEGER NOT NULL DEFAULT 0`
- **+1 / −1 按行**：每条 `message_checkpoint_file` 对对应 physical `(path, version)` +1；删除该行 −1。
- **live**：`vfs_entry` 文件行 `head_version` 对应该 revision 额外计 1；head 转移时旧 −1、新 +1。
- **同文短路 / restore skip**：不改 head → 不改 live ref。
- **保守**：空闲校验只允许把偏低修到正确值，或以「只上调」纠偏；禁止因偏低误删。
- **删除**：`DELETE FROM vfs_revision WHERE (path = prefix OR path LIKE prefix/%) AND ref_count <= 0`（前缀条件对齐现 `listKeysUnderPrefix`）。

### revision-ref-count API sketch

`packages/core/src/domain/vfs/logic/revision-ref-count.ts` 对外形状（实现名可微调，语义钉死）：

```typescript
/** 单条 (path, version) ±1；UPSERT 行后 UPDATE ref_count = ref_count ± 1 */
adjustRef(revisionRepo, path, version, delta: +1 | -1): Promise<void>

/** 批量：checkpoint_file 行列表 → 每条对应 physical (path, version) −1 */
decrementRefsForCheckpointFiles(revisionRepo, scope, files: CheckpointFilePointer[]): Promise<void>

/** 批量：checkpoint_file 行列表 → 每条 +1（capture / insertCheckpoint 用） */
incrementRefsForCheckpointFiles(revisionRepo, scope, files): Promise<void>

/** 前缀打扫：DELETE … WHERE path 匹配 session prefix AND ref_count <= 0；返回 deletedCount */
deleteUnreferencedUnderPrefix(revisionRepo, prefix): Promise<number>

/** 空闲校验：重算 checkpoint 行数 + live head，只上调 ref_count（禁止因偏低误删） */
repairRefCounts(revisionRepo, entryRepo, checkpoints, scope): Promise<RepairReport>
```

- live head 转移（write bump / resetHead / delete 删 entry）在 VFS 层调用 `adjustRef` 两次（旧 −1、新 +1）或封装 `transferLiveRef(from, to)`。
- truncate / message.delete / session 删：先 `decrementRefsForCheckpointFiles`，再 `deleteUnreferencedUnderPrefix`；blob 另经 `runDeferredBlobGc`。

### blob GC 推迟

- **算法唯一入口（钉死）**：全库 blob 回收**只**经 `collectAllReferencedHashes` + `ContentStore.gc` 这一套算法；封装为 `runDeferredBlobGc(conn)`，禁止旁路再写第三套 collect/gc 逻辑。
- **触发可 deferred**：`sweepSessionRevisions`（或拆分后的 revision-only sweep）**只做 revision 行打扫**（前缀下 `ref_count<=0` DELETE），**末尾不再**同步调用 collect/gc；各业务路径在 revision 打扫后**可选**调度 `runDeferredBlobGc`（空闲 / 周期 / 显式测试钩子）。
- T-GC2 合同不变：deferred 仍用全库 entry∪revision 引用集，不得缩成 session 局部 keepSet。
- 与 `vfs-revision-storage-optimize` 旧表述「sweep 末尾 sync gc / 禁止旁路」的关系：算法仍唯一，触发从「sweep 末尾必跑」改为「经 `runDeferredBlobGc` 统一调度」；调用方不得手写第二套 gc。

### 热路径 SQL 要点

| 步骤 | 现网 | 目标 |
|------|------|------|
| truncate 取 tail | `listBySession` 全量进 JS | `DELETE … WHERE message_id IN (SELECT id FROM chat_message WHERE seq > ?)` |
| 删 checkpoint | IN (js ids) | 同上子查询；删 file 行时批量 −ref |
| 建 reachable | DISTINCT 指针进 JS Set | 不建；靠 ref_count |
| 删不可达 revision | listKeys + filter + OR DELETE | `ref_count<=0` 前缀 DELETE |
| blob | 同步全库扫 | 出热路径 |

### reconcile「需写盘」筛选

在事务内（或紧挨事务前一次查询）用 JOIN 得到：

```text
pathsNeedWrite = target 中（live 缺失 OR live.hash ≠ target revision.hash OR target status=deleted 且 live 仍在）
  且 live.head_version ≠ target.version   // 同 version 短路：正文/hash 已一致则不进写盘集合
pathsNeedDelete = live 在 target 外且 hasDirectTargetTree（保持现网）
```

循环只处理上述集合；其余计为 skipped（与现 `skipped_same_version` / `skipped_same_content_hash` 对齐）。

## 最终项目结构

```text
packages/core/src/
  bootstrap/
    vfs/vfs-revision-schema.ts              # CREATE 含 ref_count
    schema-migrations/
      vfs-revision-ref-count-v1.ts          # 新建：列 + 回填
      index.ts                              # 注册
  domain/
    vfs/logic/revision-ref-count.ts         # 新建：±ref / repair / 前缀删 辅助
    vfs/logic/deferred-blob-gc.ts           # 新建：延期 blob GC 入口
    message-checkpoint/logic/
      revision-gc.ts                        # revision-only sweep；去同步 blob
      truncate-tail-in-transaction.ts       # SQL 截断；传入/子查询 tail
      restore-path.ts                       # 保留短路；接 pathsNeedWrite
    vfs/repositories/impl/
      sqlite-vfs-revision.repository.ts     # ref_count CRUD；按 ref 删
      sqlite-message-checkpoint.repository.ts
    vfs/content-store/...                   # 合同注释更新
  service/message-checkpoint/impl/
    message-rollback.service.ts             # 编排压缩
    message-checkpoint.service.ts           # capture ±ref
  service/vfs/impl/revision-aware-vfs.service.ts  # write/delete/reset ±ref
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Schema / migration | `ref_count` + 回填（checkpoint 行计数 + live head） |
| Ref helper | 所有写路径统一 ±ref |
| Checkpoint insert/delete | replace 语义同事务先减后加 |
| VFS write/delete/resetHead | live ref 转移 |
| revision-gc | 去 DISTINCT/Set；按 ref 删；拆出 deferred blob |
| truncate-tail | 子查询删除；−ref |
| message-rollback | 少往返；需写盘集合；热路径无 blob GC |
| session/项目删除 | 补 −ref + 可选 sweep（现网盲区） |
| 测试 | 见测试策略；T-GC* 改挂 deferred |

## 详细实现步骤

- Step 1 — phase-schema-ref-count — blocking: yes — qa: auto：canonical DDL + `vfs-revision-ref-count-v1` 回填；旧库可启动可读
- Step 2 — phase-ref-helpers — blocking: yes — qa: auto：实现 `revision-ref-count` helper（按行 ±、批量、repair 只纠偏低）
### Step 3 — 写路径闭合表（phase-ref-write-paths）

凡会改变「谁引用哪个 `(path, version)`」的路径**必须**在本 Step 接入 ±ref；遗漏即 ref 漂移风险（见 Step 9 repair）。

| 写路径 | 模块 / 证据 | +ref | −ref | 备注 |
|--------|-------------|------|------|------|
| `capture` → `insertCheckpoint` | `message-checkpoint.service.ts` | 每条新 `message_checkpoint_file` 对 physical `(path, version)` +1 | replace 语义：同事务内先对**旧** file 行批量 −1，再 INSERT 新行 +1 | 与现 `DELETE … message_id` 再 INSERT 同序 |
| `deleteCheckpointsForMessages` | `sqlite-message-checkpoint.repository.ts` | — | DELETE `checkpoint_file` **前**批量 −1（见 Step 6） | 仅删指针，不删 revision 行 |
| `deleteCheckpointsForSession` | 同上 | — | 同上，session 级全量 file 行 | 会话/项目删除 Step 9 首步 |
| `writeWithRevision` | `revision-aware-vfs.service.ts` | 异文 bump：新 revision 行 +1；live head 转移到新版 +1 | 同文短路：**不改 ref** | 旧 live head −1 与新 +1 同事务 |
| `deleteWithRevision` | 同上 | `appendDeletedRevision` 墓碑行 +1 | 删 entry 前 live head −1 | 常规 delete，非 hardDelete |
| `resetHeadToVersion` | 同上 | 目标 revision 成为 live head +1 | 旧 live head −1 | **不** append；补偿与 restore 共用 |
| `hardDelete` | 同上 | — | **仅 live head −1** | 物理删 entry，**不** append 墓碑（`restore-mutating-path-heads` absent / 快照外清文件） |
| `appendDeletedRevision` / 子树 | `deleteWithRevision` 内部 | 新 `status=deleted` revision +1 | — | 由 deleteWithRevision 统一编排 live −1 |
| `seed-fork` → `insertCheckpoint` | `seed-fork-copy-parity.ts` | fork 后每条 checkpoint file +1；copyScope 产生的新 live head +1 | — | 共享 `content_hash` 不重复 put；ref 仍按 pointer/head 计 |
| `backfillMissingRevisionIfNeeded` | `backfill-missing-revision.ts` | 写入回补行时对 `(path, targetVersion)` +1 | — | **`existsByPathAndVersion` 已存在 → 跳过，±0**；不 bump live entry |

**不在 Step 3 改 ref 的路径**：只读 list/find、`restorePathToRevision` 同文短路、directory 纯 list。

- Step 3 — phase-ref-write-paths — blocking: yes — qa: auto：上表全部路径接入 ±ref；同文短路 / backfill 已存在跳过不改 ref
- Step 4 — phase-revision-sweep-ref — blocking: yes — qa: auto：`sweepSessionRevisions` 改为前缀下 `ref_count<=0` DELETE；移除热路径 DISTINCT+Set 主路径；**不再**末尾 sync blob gc

  **migration 标记分支（钉死）**：
  - 读 `schema_migrations`（或等价标记行）判断 `vfs-revision-ref-count-v1` 回填是否完成。
  - **回填完成前**：`sweepSessionRevisions` 仍走现网 `deleteExceptReachable`（现算 reachable Set）；**禁止**依赖 `ref_count<=0` 删除。
  - **回填完成后**：切 ref 路径——`deleteUnreferencedUnderPrefix`（`ref_count<=0`）；不再构建 checkpoint DISTINCT Set。
  - 实现可用 feature flag 或 migration applied 位；回滚时反向切换（见「风险与回滚」）。
- Step 5 — phase-defer-blob-gc — blocking: yes — qa: auto：拆出 `runDeferredBlobGc`（内部 collect+gc）；`sweepSessionRevisions` 仅 revision；rollback/truncate 热路径默认不同步 blob gc；更新 port 注释与 T-GC 挂点

  **调用点矩阵**（revision 打扫 vs blob gc）：

  | 调用方 | revision 打扫 | checkpoint −ref | blob gc |
  |--------|---------------|-----------------|---------|
  | `message.service` delete | `sweepSessionRevisions`（ref 或 fallback） | `deleteCheckpointsForMessages` 内 −ref | `runDeferredBlobGc`（可同事务后/空闲） |
  | `user-vfs-turn` 失败补偿末尾 | 同上 | —（无 checkpoint 删） | deferred |
  | `truncate-tail-in-transaction` | `sweepRevisions: true` 时 sweep | tail checkpoint −ref（Step 6） | deferred；rollback 默认 `sweepRevisions: true` |
  | `message-transcript-effects` `truncateMessagesAfter` | **`sweepRevisions: false` 时仍执行 checkpoint −ref + 消息/truncate SQL**；**不**跑 sweep | 是 | 否（无 revision 行删时不强制 gc） |
  | 回滚热路径 `MessageRollbackService` | 事务内 `ref_count<=0` 前缀 DELETE | truncate 子步骤 −ref | **不出热路径** |
  | 会话/项目删除 | Step 9 顺序 | Step 9 首步 | Step 9 末步 deferred |

  要点：`sweepRevisions: false` **不等于**可跳过 checkpoint −ref；仅表示「本轮不删不可达 revision 行、不 sync blob gc」。
- Step 6 — phase-truncate-sql — blocking: yes — qa: auto：truncate 用子查询删 checkpoint/消息；**DELETE `message_checkpoint_file` 前先** `decrementRefsForCheckpointFiles`（批量 −ref）；去掉多余 `listBySession`
- Step 7 — phase-reconcile-need-write — blocking: yes — qa: auto：SQL/批量筛选需写盘路径；reconcile 只处理该集合；保留 T-RB1 短路语义
- Step 8 — phase-rollback-orchestration — blocking: yes — qa: auto：压缩 `MessageRollbackService` 往返；诊断日志改为反映新阶段（无 sync blob）
- Step 9 — phase-session-delete-blindspot — blocking: yes — qa: auto：会话/项目删除路径补 ref 与 revision 打扫（现网 `deleteSessionFsData` 仅删 checkpoint 行、无 −ref / sweep）

  **删除顺序（钉死，单连接同事务）**：
  1. **−checkpoint ref**：`deleteCheckpointsForSession` 前/内对全部 `message_checkpoint_file` 批量 −ref（`decrementRefsForCheckpointFiles`）。
  2. **−live ref**：对该 session 前缀下全部 live file head 批量 −ref（`listFileHeadsUnderPrefix` → 每条 `adjustRef −1`）。
  3. **删 checkpoint / entry 行**：现网 `deleteCheckpointsForSession` + entry 前缀 DELETE（或既有 `deleteSessionFsData` 扩展）。
  4. **revision 前缀打扫**：`deleteUnreferencedUnderPrefix(sessionPrefix)`（`ref_count<=0`）；migration 未完成时 fallback 旧 sweep 或 `deleteExceptReachable`。
  5. **deferred blob gc**：事务提交后调度 `runDeferredBlobGc`（项目删除多 session 时可合并一次全库 gc）。

  **现网 `deleteSessionFsData` 偏差（已接受）**：步骤 4 的 revision 前缀 DELETE 可能在步骤 3 entry 删行**之前**执行，事务内 entry 行会短暂指向已删 revision 行；同事务内最终收敛，功能等价于上述顺序。

  接线点：`session.service` 删会话、`project.service` 删项目、`initialize-session-workspace` 重置工作区、`sessionTemplatePull`。
- Step 10 — phase-perf-regression — blocking: yes — qa: auto：P1/P2/P2-SC 与单元矩阵全绿
- Step 11 — phase-mobile-latency — blocking: yes — qa: manual_user：真机长会话多数同文回滚体感 &lt; 1s（相对基线明显下降）

## 兼容性与迁移

- 旧库：migration 回填 `ref_count`；回填前禁止依赖 ref 删除（migration 同事务完成回填或 boot 后阻塞至回填完成——实现选「boot 事务内回填」若规模可接受，否则 boot 后分批并在完成前 fallback 旧 sweep）。
- **推荐**：回填完成前 `sweep` 仍可用旧 `deleteExceptReachable` 开关；回填完成后切 ref 路径（feature flag 或 migration 标记行）。
- Desktop/Mobile/CLI 无协议变更；`RollbackOptions` 保持。

## 测试策略

### 测试用例

- T-RB-HOT-NOBLOB — blocking: yes — 完整 rollback 热路径零同步 `collectAllReferencedHashes`/`gc`
- T-RB-GC-DEFER — blocking: yes — deferred 入口删除 orphan blob（原 T-GC1）
- T-RB-GC-CROSS — blocking: yes — 跨 session 共享 hash 不误删（原 T-GC2）
- T-RB-REF-CAP — blocking: yes — capture 后指针对应 ref 正确累加
- T-RB-REF-TRUNC — blocking: yes — 截断 checkpoint 后 ref 递减；归零可删
- T-RB-REF-LIVE — blocking: yes — write bump 时 live ref 转移
- T-RB-REF-MULTI — blocking: yes — 同 path+version 跨多 checkpoint；删一仍存活
- T-RB-REF-CONSERV — blocking: yes — 计数偏高可留行；不得偏低误删
- T-RB-PARTIAL-WRITE — blocking: yes — 仅 diff 路径 write
- T-RB-SQL-ONCE — blocking: yes — 无「全量指针进 JS Set」主路径
- T-RB-STABLE-CP — blocking: yes — 截断后仍可回滚到保留检查点
- P2 / P2-SC / P1 — blocking: yes — 性能门禁。**P2-SC**（多数同文回滚）：in-memory 耗时相对 **P2**（全 diff 写盘）应明显更低；若 CI 环境波动大，**P2-SC 可仅作诊断、不以硬失败门禁**，真机体感以 **MU-RB-LATENCY** 为人工验收。
- 既有 R*/U*/N*/DF*/RB*/T-RB1/RB-SC1 — blocking: yes — 语义回归
- MU-RB-LATENCY — blocking: yes — qa: manual_user — 真机等待

### CI 最小套件

`packages/core`：`rollback*.test.ts`、`revision-gc.test.ts`、`blob-gc.test.ts`（挂 deferred）、`performance.test.ts`、`truncate-tail-in-transaction.test.ts`、`session-fs/rollback-to-message.test.ts`

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| ±ref 遗漏（hardDelete、会话删、直调 append） | Step 3/9 清单 + repair；测试矩阵 |
| 回填前误开 ref 删除 | migration 标记 / fallback 旧 sweep |
| RN SQL 过长 | chunk；反连接用子查询非巨型 IN |
| 推迟 GC 磁盘膨胀 | PRD 已接受；deferred 周期跑 |
| 与 storage-optimize「blob GC 唯一入口」文档冲突 | 更新为「唯一算法入口仍为 collect+gc；触发改为 deferred」 |

**回滚代码**：feature flag 切回旧 `deleteExceptReachable` + 同步 blob；或 revert 本迭代提交。数据：`ref_count` 列可保留无害。

## 探索摘要（Context）

- 现网瓶颈：事务外多次 list；truncate 重复 listBySession；sweep DISTINCT+Set；同步全库 blob。
- TDBC 无 multi-statement 先例 → 同事务多次 execute。
- reconcile 解压写盘无法纯 SQL 完成 → 需写盘列表给 JS。
- sweep 还被 message.delete、user-vfs-turn 调用 → deferred GC 须统一。
