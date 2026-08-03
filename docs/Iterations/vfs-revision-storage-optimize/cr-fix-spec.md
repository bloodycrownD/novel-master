# CR Fix Spec: vfs-revision-storage-optimize（多迭代叠层 CR · wave-1）

## 元信息

- repo: `d:\Dev\Js\novel-master`
- branch: `feature/vfs-revision-storage-optimize`
- base_sha: `d8d9dec45cc2c3a4f2a3d0fc05ec3619817659a2`
- head_sha: `7188b4dcd3d766ff091610b0a4f8492f5df5d0e8`
- prd_path:
  - `.apm/kb/docs/Iterations/vfs-revision-storage-optimize/prd.md`
  - `.apm/kb/docs/Iterations/message-rollback-execution-redesign/prd.md`
  - `.apm/kb/docs/Iterations/user-ops-operation-log/prd.md`
  - `.apm/kb/docs/Iterations/import-export-navigation-fix/features/mobile-vfs-longpress-multiselect-move/prd.md`
- spec_path:
  - `.apm/kb/docs/Iterations/vfs-revision-storage-optimize/spec.md`
  - `.apm/kb/docs/Iterations/message-rollback-execution-redesign/spec.md`
  - `.apm/kb/docs/Iterations/user-ops-operation-log/spec.md`
  - `.apm/kb/docs/Iterations/import-export-navigation-fix/features/mobile-vfs-longpress-multiselect-move/spec.md`
- review_round: 2（round 1 + user decision 2026-07-26：Undo 彻底清空 ops store）
- dag_version: 2
- 状态：**实现已闭合（文档 wave）**（K 节文档同步已完成；**非** merge-ready — must-fix 代码项仍待 review-full / 合入；fix-spec-ready 仍为 no）

## Must-fix（按 P0 → P1 → P2）

### vfs-storage/B-1 [P1] recursive hardDelete 子树 file live head 未 adjustRef(-1)

- 维度：B
- 文件：
  - `packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts`（`hardDelete`）
  - `packages/core/test/vfs/fail-restore-compensation.test.ts`
- 问题：`hardDelete(path, { recursive: true })` 在目标为 **directory** 或需递归清子树时，只对顶层 entry 做 ref 维护：顶层是 directory 则 **完全跳过** `adjustRef`；子树内各 file 的 live head revision **未 `-1`**。空目录补偿（`restore-mutating-path-heads.ts` → T-FR-D2）会在 `hardDelete('/empty', { recursive: true })` 后物理删掉 `/empty/x.md`，但 `x.md@v1` 的 `ref_count` 仍为 1 → `sweepSessionRevisions`（ref_count 模式）删不掉 → `runDeferredBlobGc` 也回收不了对应 blob。违背 PRD「失败补偿后不可达 revision 应被清理」与 SPEC Step6 / T-UO-SWEEP1 同类合同。
- 改法：在 `hardDelete` 物理删除前：若 `recursive === true`，用 `entryRepo.listFileHeadsUnderPrefix(normalized)`（或等价）枚举子树所有 **file** 的 `(path, headVersion)`，对每个 pair 调用 `adjustRef(revisionRepo, path, headVersion, -1)`；单文件 `hardDelete` 保持现有逻辑。
- 验收/测试：扩展 T-FR-D2 或新增用例——补偿后 assert 批次新建文件的 revision 行被 sweep 删除、orphan blob 被 `runDeferredBlobGc` 清掉。
- 来源：review-scope-vfs-storage / round 1

### rollback/B-1 [P1] deleteSessionFsData 裸调 deleteUnreferencedUnderPrefix

- 维度：B
- 文件：`packages/core/src/service/session-fs/create-session-fs-service.ts`
- 问题：`deleteSessionFsData` 第 4 步直接调用 `deleteUnreferencedUnderPrefix`，未像 `revision-gc.ts` 那样读 `isSchemaMigrationApplied(VFS_REVISION_REF_COUNT_V1_ID)` 并在回填完成前 fallback 到 `deleteExceptReachable`。migration 未完成时 `ref_count` 默认为 0，前缀 DELETE 可能误删仍被 checkpoint / live 引用的 revision 行（违反 SPEC Step 4/9 钉死的 migration 分支）。
- 改法：第 4 步改为调用 `sweepSessionRevisions(revisions, entries, checkpoints, projectId, sessionId, conn)`，或内联与 `revision-gc.ts` 相同的 `ref_count` / `reachable_set` 分支；**禁止**裸调 `deleteUnreferencedUnderPrefix`。
- 验收/测试：migration 未完成场景（或 mock `isSchemaMigrationApplied === false`）下 session delete / template pull 路径仍走 reachable_set fallback；现有 T-RB-SESSION-DEL / session delete 相关测不回归。
- 来源：review-scope-rollback / round 1

### user-ops/B-1 [P1] executeOp 日志派生失败被空 catch 吞掉

- 维度：B (+A)
- 文件：
  - `packages/core/src/service/chat/impl/user-vfs-turn.service.ts`
  - `packages/core/src/service/chat/user-vfs-turn.port.ts`
- 问题：写盘成功后 `userOpsLogEntryFromTurnOp` 抛错被空 `catch` 吞掉，仍返回 `{ ok: true }`。磁盘已变但 store 无条目、chip 不出现，调用方（Mobile / Desktop execute 路径）无法 toast 或降级，违背 D1 降级意图。
- 改法：扩展 `UserVfsTurnExecuteResult` 成功分支，例如 `{ ok: true; logAppended?: boolean; logAppendError?: unknown }`；派生 / append 失败时 `ok: true` 且 `logAppended: false`（可选附带 error）。文档钉死：**不回滚盘**，由上层决定 toast。
- 验收/测试：在 `user-vfs-turn.service.test.ts` mock / 构造无法派生的 op，断言 `ok: true` 且 `logAppended === false`，`listUserOpsLog` 长度为 0。
- 来源：review-scope-user-ops / round 1

### clients/C-orch-1 [P1] Mobile rewind 未 clearUserOpsLog，Desktop 会清

- 维度：C-orch + B
- 文件：
  - `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`
  - 对照 `apps/desktop/src/main/ipc/handlers/messages.ts`
- 问题：**Desktop / Mobile rewind 语义分叉。** Desktop rewind 走 `clearUserOpsLog` → `notifyComposerStatusAfterSessionKkvCleared` 推空；Mobile rewind 走 `projectComposerStatusForSession` 保留并投影当前 store（注释写「可能仍有未发送日志」）。VFS reconcile 回滚后，store 里未发送手改描述的是已被回滚的磁盘变更，继续投影会出**过期 chip**（与 D8「rewind 不映回消息手改」及双端合同冲突）。
- 改法：Mobile rewind 分支对齐 Desktop：`clearUserOpsLog(sessionId)` → `refreshComposerStatusAfterSessionKkvCleared`（或等价推空）；**禁止**在 VFS reconcile 成功后仍 project 旧 store。`skipVfsReconcile` 默认跟 Desktop 一律清 store（见 Open questions `clients/Q-skip-vfs` 已拍板）。
- 与 `clients/C-orch-2` 分工：**C-orch-1 覆盖 rewind** 双端清 store；**C-orch-2 覆盖 undo_send** 双端「清而非映回」。
- 验收/测试：与 `clients/G-1` 联调；Mobile rewind 后 chip 无 user_ops；Desktop 行为保持为对照基准。
- 来源：review-scope-clients / round 1

### clients/C-orch-2 [P1] undo_send 双端 clearUserOpsLog 而非映回 ops

- 维度：C-orch + B
- 文件：
  - `apps/desktop/src/main/ipc/handlers/messages.ts`（`handleMessagesRollback` undo_send 分支）
  - `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`（undo_send 分支）
- 问题：**Undo Send 与 rewind 产品收窄一致。** 回滚成功后须 `clearUserOpsLog`（或等价）并推空 Composer；**禁止** `parseUserOpsLogFromAttachments` → `appendUserOpsLog` 映回手改 ops chip。现网 Desktop main undo_send 走 parse/append；Mobile undo_send 亦 append——与 user-ops D8「undo_send 映回 ops」冲突，记为**产品收窄 / 合同翻转**（user decision 2026-07-26）。
- 改法：Desktop `handleMessagesRollback` undo_send 分支改为 `clearUserOpsLog` + `notifyComposerStatusAfterSessionKkvCleared`（或等价推空）；Mobile undo_send 去掉 `parseUserOpsLogFromAttachments` → append，改为 `clearUserOpsLog` + 推空（可与现有 rewind 对齐）。**批注 annotate / 正文回填**未在本拍板取消——默认仍恢复；仅 user_ops 日志清空。
- 与 `clients/C-orch-1` 分工：**C-orch-1 覆盖 rewind**；**C-orch-2 覆盖 undo_send** 双端「清而非映回」。
- 验收/测试：与 `clients/G-2` 联调；undo_send 后 `listUserOpsLog` 为空、chip 无 user_ops；正文/annotate 恢复断言保留。
- 来源：user decision 2026-07-26 / spec-fix-undo-clear

### clients/G-1 [P1] 缺 rewind + 预置未发送 ops 的 parity 测

- 维度：G
- 文件：
  - `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`
  - 可增 Desktop 对称：`apps/desktop/test/messages-rollback-user-ops-log.test.ts`
- 问题：缺 **rewind + 回滚前已有未发送 ops** 的 parity 测试。现有 T-UD5 / T-UOL7 rewind 用例未预置 store，无法拦住 `clients/C-orch-1` 类回归。
- 改法：增测：rewind 前 `appendUserOpsLog` → rollback 后 `listUserOpsLog` 为空、Composer chip 无 user_ops（VFS reconcile 路径）；与 Desktop rewind 用例对称。
- 验收/测试：新用例绿；与 `clients/C-orch-1` 实现同步合入后通过。
- 来源：review-scope-clients / round 1

### clients/G-2 [P1] 翻转 T-UOL7 等 undo_send 测例

- 维度：G
- 文件：
  - `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`（T-UOL7 等）
  - 可增 Desktop 对称：`apps/desktop/test/messages-rollback-user-ops-log.test.ts`
- 问题：现测 T-UOL7 等断言 undo_send 后 ops 从消息附件映回 store；产品拍板改为 undo_send 与 rewind 一样**清空 store**，测例须翻转。
- 改法：T-UOL7 / 相关测——undo_send 后 `listUserOpsLog` 为空、Composer chip 无 user_ops；**保留**正文/annotate 恢复断言（若现测有）。
- 验收/测试：新/改用例绿；与 `clients/C-orch-2` 实现同步合入后通过。
- 来源：user decision 2026-07-26 / spec-fix-undo-clear

### rollback/B-2 [P2] adjustRefCount 对缺失行 +1 静默 no-op

- 维度：B
- 文件：`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts`
- 问题：`adjustRefCount` 仅 `UPDATE … SET ref_count = ref_count + delta`；目标 `(path, version)` 不存在时 changes=0，无报错。SPEC sketch 要求「UPSERT 后 ±1」，且合同要求**保守偏高、禁止偏低误删**。
- 改法：`delta > 0` 且 UPDATE changes=0 时抛错或断言；或与 `append` 协同改为 INSERT…ON CONFLICT 再 UPDATE；至少补单测覆盖「capture 时 revision 行尚未存在」的 drift 场景。
- 验收/测试：新增单测覆盖 missing row +1 路径；现有 T-RB-REF-* 不回归。
- 来源：review-scope-rollback / round 1

### rollback/C-orch-1 [P2] sessionTemplatePull 缺 runDeferredBlobGc

- 维度：C-orch
- 文件：`packages/core/src/service/template/impl/template-pull.service.ts`（`sessionTemplatePull`）
- 问题：SPEC Step 9 调用矩阵将 `initialize-session-workspace` 与 session / project 删除同列；`session.service` / `project.service` 事务后均 `runDeferredBlobGc`，但 `sessionTemplatePull` 在 `deleteSessionFsData` + `replaceVfsSubtree` 后**未**调度 deferred gc。
- 改法：`sessionTemplatePull` 事务提交后 `await runDeferredBlobGc(this.conn)`，与 session.delete 对齐（项目级 pull 若也清 revision 则同理）。
- 验收/测试：template pull 后 orphan blob 可被 gc 回收；与 session delete 路径行为一致。
- 来源：review-scope-rollback / round 1

### clients/C-2 [P2] Mobile 残留 console.log 无 __DEV__

- 维度：C
- 文件：
  - `apps/mobile/src/services/user-vfs-turn-execute.service.ts`
  - `apps/mobile/src/services/vfs-operations.service.ts`
  - `apps/mobile/src/components/vfs/VfsFileManager.tsx`
- 问题：批量移动 / 回滚路径残留 `[vfs-move]` / `[nm-rollback]` 等 `console.log`，非 `__DEV__` 守卫。
- 改法：删除或包在 `__DEV__` / 统一 debug 开关。
- 验收/测试：生产构建路径无裸 `console.log`；`__DEV__` 下调试日志可选保留。
- 来源：review-scope-clients / round 1

### clients/C-3 [P2] VfsFileManager handleEntityAction 死分支 open

- 维度：C
- 文件：`apps/mobile/src/components/vfs/VfsFileManager.tsx`
- 问题：`handleEntityAction` 仍保留 `action === 'open'` 分支，菜单已移除「打开」。
- 改法：删除死分支或补注释说明遗留兼容（若保留须写清触发入口）。
- 验收/测试：无 unreachable dead branch 或注释与菜单 IA 一致。
- 来源：review-scope-clients / round 1

## Spec deviations

| ID | 描述 | 状态 |
|----|------|------|
| SD-deferred-gc-trigger | `vfs-revision-storage-optimize` SPEC 曾写 sync 模型下 `sweepSessionRevisions` **末尾**跑全库 blob gc；现网已拆出 **`runDeferredBlobGc`** 统一调度（与 `message-rollback-execution-redesign` 一致，算法仍为 `collectAllReferencedHashes` + `ContentStore.gc`） | **fixed / 已收窄**（2026-07-26 impl-docs：vfs spec/prd 以 deferred 合同为准） |
| SD-migration-batch | SPEC / PRD 曾写「阻塞在 bootstrap 事务内」；实现把 schema（事务内）与 `runVfsContentBlobDataMigration`（事务外、每批 1 行 + yield）拆分，注释理由为 RN 长事务 BLOB 闪退 | **fixed / 已收窄**（2026-07-26 impl-docs：vfs spec/prd 写清 RN 分批迁移） |
| SD-encoding-zlib-b64 | SPEC 曾钉死 `encoding='zlib'`；Hermes 上 `put` 落 **`zlib-b64`**（`blob-bytes-codec.ts`），读路径已兼容；Node 测 T-CS2 仍断言 `zlib` | **fixed / 已收窄**（2026-07-26 impl-docs：vfs spec 写清 Node zlib / RN zlib-b64） |
| SD-schema-mark-early | `vfs-content-blob-zlib-v1` 的 `up()` mark applied 后，明文搬迁才在 bootstrap 外跑；中间态靠 `resolve-stored-content` 读遗留明文 | **fixed / 已收窄**（2026-07-26 impl-docs：vfs spec 写清 mark 早于 data migrate） |
| SD-session-del-order | SPEC Step 9 顺序为「−ref → 删行 → revision 打扫」；现网 `deleteSessionFsData` 在 `deleteVfsPrefix`（entry 删）**之前**做 revision 前缀 DELETE，事务内 entry 短暂指向已删 revision | **fixed / 已收窄**（2026-07-26 impl-docs：rollback redesign spec Step 9 钉死现网偏差） |
| SD-user-ops-d1-degrade | D1 日志失败降级：不回滚盘 ✅；Core 返回 `logAppended=false`（**user-ops/B-1** 已闭合）；上层 toast 可选后续接线 | **fixed**（2026-07-26 code-dev-loop：Core 信号已具备） |
| SD-user-ops-d8-append | **产品翻转**：undo_send 不再映回 ops → 与 rewind 一致 `clearUserOpsLog` + 推空；下游须同步改 user-ops PRD/SPEC D8 + T-UOL7 等测例 | **fixed**（2026-07-26 impl-docs：user-ops prd/spec D8 + T-UOL7 已同步；clients 注释已对齐） |
| SD-repair-idle | PRD 验收含「空闲校验可纠偏」；`repairRefCounts` 未接线生产调度 | **fixed / 已收窄**（2026-07-26 impl-docs：rollback prd 注明 API 已实现、生产调度留后续 Step） |

## Open questions / 待拍板

> 附录：不阻塞 must-fix 写入；实现前或实现中按需拍板。各 scope 首轮 open_questions 汇总如下。

| id | 域 | 问题 | 状态 |
|----|-----|------|------|
| vfs-storage/Q-reset-hash | vfs-storage | **`resetHeadToVersion` 走 `put(rev.content)` 而非 revision 行 `content_hash`**：当前经 `findByPathAndVersion` 解明文再 `put`，功能上幂等，但与 SPEC「按 revision 的 `content_hash` 拨回 / 重建」形状不一致。是否必须改为 `findMetaByPathAndVersion` + `setHeadContentHash`（仅在 hash 缺失时才 `put`）？ | 开放 |
| vfs-storage/Q-mobile-vacuum | vfs-storage | Hermes / Mobile `VACUUM INTO` 换库未完成时：freelist 可能仍大，PRD「样例级大库升级后体积明显下降」在 Mobile 上如何验收 / 发布说明？ | 开放 |
| vfs-storage/Q-migrate-boot | vfs-storage | schema migration 已 mark applied、明文 data migrate 中途崩溃：下次 boot 可重入续迁；是否需要在发布说明里写「升级可能分多次 boot 完成」？ | 开放 |
| rollback/Q-repair-schedule | rollback | **`repairRefCounts` 生产调度**：API 已实现且 T-RB-REF-CONSERV 有测，但仓库内无空闲 / 周期调用点——是否刻意留待后续迭代，还是本 PR 应补最小调度钩子？ | 开放 |
| rollback/Q-truncate-ids | rollback | truncate tail 仍物化 ID 列表：`truncate-tail-in-transaction` 用 `listIdsAfterSeq` 再 `IN (...)`，比旧 `listBySession` 轻，但非纯 SQL 子查询删；长 tail 是否接受为「极少次往返」的折中？ | 开放 |
| rollback/Q-blob-timing | rollback | 回滚后 blob 回收时机：热路径不出 gc 符合合同；orphan blob 仅依赖后续 message.delete / session.delete / user-vfs-turn 等触发——是否需要文档化「回滚后不保证立即缩库」？ | 开放 |
| user-ops/Q-undo-clear | user-ops | **Undo Send 前 store 是否应先清空再映回？** Desktop main `handleMessagesRollback` 注释刻意用 `append` 而非 `replaceUserOpsLog`，保留 undo 前未发送日志；Mobile undo 亦仅 `append`。 | **已拍板** 2026-07-26：**Undo（含 undo_send）彻底清空 ops store**；不再 parse/append 映回；见 `clients/C-orch-2`、`clients/G-2` |
| user-ops/Q-combo-compat | user-ops | **旧合成 combo 附件（单附件内 mkdir+write）** — `parseUserOpsLogFromAttachments` 只取首 action（T-UOL10 已文档化）。Undo 时 write 段丢失是否为可接受「尽力兼容」？需产品确认或 clients 补集成测。 | 开放 |
| user-ops/Q-scope-bleed | user-ops | `listIdsAfterSeq` 出现在 rollback 迭代 diff，与 user-ops 无直接耦合；full 评审时可标注 scope bleed，本节点不记 must-fix。 | 开放 |
| user-ops/Q-e2e-clients | user-ops | **T-UOL7 / T-UOL8 / T-UOL9 端到端** — Core 已有 parse / store / flush / hasPendingTurns 单测；undo_send / rewind 门控 + Desktop main≠renderer、置位 / 压缩保留 store、仅日志可发送门闩主要在 apps；由 **review-scope-clients** / full 深挖。 | 开放（T-UOL7 方向见 `clients/G-2`） |
| user-ops/Q-d8 | user-ops | **D8 Undo append vs replace**（与 SD-user-ops-d8-append 联动）：实现选择 append 保留并发未发送日志；与 SPEC「写 store」字面不冲突，但与「Undo 恢复 Composer 真源」边界需产品 / clients 确认。 | **已拍板** 2026-07-26：**undo_send 不再映回** → `clearUserOpsLog` + 推空；下游 D8 文档待 `clients/C-orch-2` 闭合后同步 |
| clients/Q-skip-vfs | clients | **`skipVfsReconcile` 下 rewind 是否应保留未发送 log store？** Desktop 当前**一律** `clearUserOpsLog`（含测试 `skipVfsReconcile: true`）。 | **已拍板** 2026-07-26：**rewind 一律清 store**（含 `skipVfsReconcile`，默认跟 Desktop）；Mobile 对齐 `clients/C-orch-1` |
| clients/Q-send-clear | clients | Mobile 发送成功回调里额外 `clearUserOpsLog`（`ChatComposer.tsx`），Desktop 依赖 main flush 清 store——单进程 belt-and-suspenders，可接受；是否要完全对称属风格问题，非阻塞。 | 开放 |

## 已豁免（用户确认不修）

（本轮 wave-1 无新增豁免条目。）

## 合并后 QA（manual_user）

> 不阻塞 must-fix 写入与 fix-spec-ready 声明；真机 / 桌面由用户执行。

- **VFS 补偿 / GC**：空目录 recursive hardDelete 补偿后 revision / blob 可回收（T-FR-D2 / T-UO-SWEEP1 同类场景）
- **Session / template 删除**：migration 未完成升级路径不误删 revision；template pull 后库体积可收敛
- **User-ops D1**：写盘成功但日志派生失败时上层可见 toast / 降级（`logAppended: false`）
- **Undo D8 双端 parity**：rewind / undo_send 后未发送 ops chip 均清空（非映回）；正文/annotate 仍恢复
- **Mobile VFS 多选移动**：长按多选 → 移动到… → 路径校验 → 批次末 composer refresh（本 wave 无 P1 must-fix，回归即可）

## K 节建议（下游执行时闭合）

### 实现顺序

1. **P1 Core 先行**：`vfs-storage/B-1` → `rollback/B-1` → `user-ops/B-1`
2. **P1 Clients 对齐**：`clients/C-orch-1` + `clients/C-orch-2` + `clients/G-1` + `clients/G-2`（同 PR 或紧接合入；C-orch-1/G-1 覆盖 rewind，C-orch-2/G-2 覆盖 undo_send）
3. **P2 收尾**：`rollback/B-2`、`rollback/C-orch-1`、`clients/C-2`、`clients/C-3`

### 文档同步（impl-docs 2026-07-26 已完成）

- **SD-deferred-gc-trigger**：✅ `vfs-revision-storage-optimize/spec.md` + prd 以 `runDeferredBlobGc` deferred 合同为准
- **SD-migration-batch / SD-encoding-zlib-b64 / SD-schema-mark-early**：✅ vfs-revision PRD/SPEC 写清 RN 分批迁移、zlib-b64、mark 早于 data migrate
- **SD-session-del-order**：✅ rollback redesign spec Step 9 钉死现网 delete 顺序偏差
- **SD-user-ops-d1-degrade**：✅ Core `logAppended` 已闭合；apps toast 可选后续
- **SD-user-ops-d8-append**：✅ user-ops PRD/SPEC **D8** + T-UOL7；Desktop clients 注释已对齐
- **SD-repair-idle**：✅ rollback prd 注明 `repairRefCounts` 已实现、生产调度留后续

### 可选收尾

- lint / format（仓库标准命令）
- full CR（`review-full`）前确认 open spec_deviations 已用户确认或标 fixed
- `clients/C-2`、`clients/C-3` 可与 P1 同 PR 或 K 节单独 PR

## Fix-Spec Closure

| 项 | 状态 |
|----|------|
| fix-spec-ready | **yes**（code-dev-loop 已闭合全部 must-fix + SD；**非** merge-ready） |
| fix_spec_path | `.apm/kb/docs/Iterations/vfs-revision-storage-optimize/cr-fix-spec.md` |
| code_dev_loop | **dev-ready**（HEAD 见 iteration-state；2026-07-26） |
| dag_version / review_round | 2 / 2（CR）+ code-dev-loop v1 |
| P0 / P1 / P2（已写入且已实现） | 0 / 7 / 4 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | **none open**（均 fixed / 已收窄） |
| C-orch | ✅ |
| C 类合并后 QA | 见上；真机可选 |
