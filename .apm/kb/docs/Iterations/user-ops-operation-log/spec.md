---
date: 2026-07-25
---

# user-ops-operation-log 技术规格（SPEC）

> **execute-ready。** 需求来源：`Iterations/user-ops-operation-log/prd.md`  
> 平台：Core + Mobile + Desktop（合同双端一致；实现可分批，但合同不可分叉）

## 设计目标

1. 废除手改路径上的 **checkpoint 净 diff**（`previewUserOpsActions` / `flushPendingUserVfsTurns` 内 `resolveWorkspaceFlushDiff`）。
2. 以 **按次追加的操作日志** 为 Composer 真源：写盘仍即时；日志旁路；投影 / 发送 / Undo 均围绕日志。
3. UI 状态条按 **path 聚成一颗 chip**；真源可多条；跨次保存不合并。
4. **supersede** recontract D6：2026-07-26 产品收窄 — `undo_send` 与 `rewind` 一致 **`clearUserOpsLog` + 推空 chip**；**不**从消息 `user_ops` 附件映回 store；正文 / 批注仍恢复。
5. message checkpoint **仍服务 VFS 回滚**；不再作 flush baseline。

## 总体方案

### 钉死决策

| ID | 决策 |
|----|------|
| D1 | 写盘即时（`executeOp` / ToolRunner）；日志失败不回滚已成功写盘（toast / 记错即可） |
| D2 | 每次成功落盘追加 **一条** 日志；跨次不合并；单次保存内多处修改 → 一条 `edit`，`hunks: [{oldString,newString},…]`（复用 `mapUserSaveToToolUses`；产品口径 `content` 数组即 hunks） |
| D3 | noop 保存（`buildUserVfsSaveOp` 返回 null）**不**写日志、不 execute |
| D4 | 未发送日志存 **进程内 store**（仿 `chat-annotate-draft-store`），**不进** `composer_draft_json`；**同 PR 内停写** `user_vfs_pending` kkv（仅 append log store；truncate 仍清旧 pending 域无害）；可选 kkv 镜像仅作冷启动兜底（默认本迭代 **仅进程内**，与 annotate 对齐；杀进程丢未发送手改——与现 annotate 同限，写入已知限制）。**Desktop**：`UserOpsLogStore` 以 **main 进程**为真源（与 `userVfsTurn` / `hasPendingTurns` / flush 同进程）；**Mobile**：单进程直接使用。Annotate store 可仅 renderer（经 `annotateDrafts` IPC 传 main）；**ops log 不可照搬 annotate 分进程模式** |
| D5 | 发送：未发送日志 → 逐条 `MessageAttachment`（`source:user_ops`，`content` = 该条日志 action XML）；清空 store；**禁止**净 diff 合成 / `flush_skip_empty_diff` |
| D6 | Composer chip：**Core** `projectComposerStatusAttachments` / `chipsFromUserOpsLogStore` **按 path 去重一颗**（label 取该 path 最后一条日志的 action 文案）；App 层 **仅** `unionComposerStatusWithAnnotate`（**不**再 App ∪ ops-log，与 annotate 对称，避免双 chip） |
| D7 | 门闩 / `hasPendingTurns` / flush 真源：**一律读 log store**（`hasUnsentUserOpsLog(sessionId)`；可暂保留 `hasPendingTurns` 名但改实现）∨ `hasAnnotateDrafts` ∨ 正文 |
| D8 | Undo：**顺序钉死** — truncate 清旧 `user_vfs_pending`（若残留）→ 按 `isPlainUserUndoSendEligible(anchor)` 分 **`undo_send` / `rewind`**（与 `chat-user-rollback-redo` 同门控）。**二者 VFS 成功后一致**：**`clearUserOpsLog(sessionId)`** → 推空 Composer chip（Desktop main `notifyComposerStatusAfterSessionKkvCleared`；Mobile 等价）；**禁止** `parseUserOpsLogFromAttachments` → `appendUserOpsLog` 映回手改 store（2026-07-26 产品收窄）。**正文回填** + **`parseAnnotateDraftsFromAttachments` + App ∪ annotate** 仍执行。**Desktop**：main 清 store 并推空；renderer **仅**正文 + annotate ∪。**Mobile 单进程**：清 store → 推空 → 正文 → parseAnnotate → ∪ annotate。**不**自动重放写盘 |
| D9 | 置位/压缩：保留未发送 ops-log store（对齐 annotate）；钩子终态 **Core project(ops) 推送 + renderer/App ∪ annotate**；禁止强制 `[]` 当终态 |
| D10 | 手动重置常驻：仍 `clearSession` 类清 kkv **且** `clearUserOpsLogStore(sessionId)`（与置位不对称）；**不必**清 annotate store（除非产品另定） |
| D11 | wire：产品 `create`（文件/目录统一展示「创建」）；落库 `action` 可用 `write`（新文件）/ `mkdir`（目录）或统一新枚举 `create`——**实现选 A：落库 `action` 保持现网枚举兼容，chip 文案统一「创建」；XML/JSON 内可带 `kind:file|dir`**。历史旧合成 XML **只读兼容** |
| D12 | 范围：仅 session `userVfsTurn` 手改；项目直写、Agent tool 写盘不进本日志 |
| D13 | 删除净 diff 热路径模块的 runtime 引用；`diff-workspace-for-user-vfs-flush` / `synthesize-user-vfs-flush-actions` / `resolveFlushBaselineTree` / `resolveCurrentWorkspaceSnapshot` 从手改链路移除（文件可删或标 `@deprecated` 仅测试过渡） |

### 数据流（目标态）

```text
保存/建删移成功
  → ToolRunner 写盘
  → append UserOpsLogStore[sessionId]（停写 user_vfs_pending）
  → Core projectComposerStatusAttachments（chipsFromUserOpsLogStore，path 聚合）
  → App unionComposerStatusWithAnnotate（仅 annotate）→ 状态条

发送
  → prepare：listUserOpsLog → buildUserOpsAttachmentFromLogEntry（逐条，复用 build-user-ops-attachment）
  → append user（user_ops ∪ @扫描 ∪ annotate）
  → clearUserOpsLog + clearAnnotate（append 成功后）
  → 若有 user_ops → messageCheckpoint.capture（仍触发；不作下一轮 flush baseline）

Undo
  → mode = isPlainUserUndoSendEligible(anchor) ? undo_send : rewind
  → VFS + truncate（清旧 pending 域）
  → clearUserOpsLog(sessionId) + 推空 Composer chip（undo_send / rewind 一致）
  → renderer / Mobile：正文回填 → parseAnnotate → App ∪ annotate
```

### Action 载荷（落日志时）

| action（产品） | 落盘当下如何得到 | 持久字段（日志条目） |
|----------------|------------------|----------------------|
| create（文件） | `buildUserVfsCreateFileOp` / save 新文件 | `{ action:'write'或'create', path, reason?:'new-file' }` + 派生 XML |
| create（目录） | `buildUserVfsMkdirOp` | `{ action:'mkdir', path }` + XML；chip 文案「创建」 |
| edit | `mapUserSaveToToolUses` → edit + hunks | `{ action:'edit', path, hunks:[{oldString,newString},…] }` |
| write | 映射 fallback 全文 write | `{ action:'write', path, content }` |
| delete | `buildUserVfsDeleteOp` | `{ action:'delete', path }` |
| rename | `buildUserVfsRenameOp` | `{ action:'rename', oldPath, newPath }`；chip 聚合 key = **newPath** |

**附件 ↔ 日志（Undo parse）**：每个非 annotate 的 `user_ops` 附件 → **一条** log；附件 `content` = 该条 action XML（可含多段 edit）；同一 XML 内多 edit action **合并**进该 log 的 `hunks`。

发送时每条日志 → 一条附件：`content` = `<action name="…">{…}</action>`（复用 `build-user-ops-attachment` / `buildAttachmentActionXml` / 现网 XML 形态，便于 `wrapUserMessageForLlm`）。

### `ProjectComposerStatusAttachmentsDeps`（Step 4 新形状）

```typescript
/** 改前：previewUserOpsActions → 净 diff 摘要 */
/** 改后：读 log store，Core 内 path 聚合出 ops chip */
export type ProjectComposerStatusAttachmentsDeps = {
  readonly listUserOpsLogEntries: (
    sessionId: string,
  ) => readonly UserOpsLogEntry[];
  /** 或由 store 模块直接注入 chipsFromUserOpsLogStore */
};
```

App 层 **不再**在此 deps 或 `unionComposerStatusWithAnnotate` 中合并 ops-log；与 annotate 对称 — Core replace(ops) → App ∪ annotate only。

## 最终项目结构（增量）

```text
packages/core/src/domain/chat/
  model/user-ops-log.schema.ts          # 新增：日志条目 zod（edit 用 hunks）
  logic/chat-user-ops-log-store.ts      # 新增：仿 annotate store
  logic/parse-user-ops-log-from-attachments.ts  # 新增：Undo parse（每附件一条 log）
  logic/aggregate-user-ops-log-chips.ts # 新增：path 聚合 → MessageAttachment[]
  logic/project-composer-status-attachments.ts  # 改：deps 读 log store；Core 出 ops chip
  logic/build-user-ops-attachment.ts    # 改：log entry → 附件；弱化 summaries/preview
service/chat/impl/user-vfs-turn.service.ts      # 改：execute append log（停写 pending）；flush 读 log
service/chat/user-vfs-turn.port.ts              # 改：flushed 语义；preview* 废弃或改签名
service/vfs/build-user-vfs-turn-op.ts           # 可选：出结构化 log 字段
service/agent/logic/prepare-user-vfs-turn-for-agent-run.ts  # 改：flush=日志转附件
public/chat.ts + allowlist 快照

apps/mobile:
  user-vfs-turn-execute.service.ts      # 轻量 refresh（无 preview diff）
  project-composer-status.service.ts    # 调 Core project；App 仅 ∪ annotate
  storage/chat-composer-draft.ts        # applyComposerStatusReplace + unionComposerStatusWithAnnotate
  screens/tabs/chat-tab/useChatTabMessages.ts  # Undo 链路
  services/workplace-block.service.ts   # 手动重置 clearUserOpsLogStore
  screens/tabs/chat-tab/useChatTabController.ts  # 手动重置入口
  ChatComposer                          # 门闩 + append 清 log
  VfsFileManager skipComposerStatusRefresh 可删或仅「批次末 notify」

apps/desktop:
  src/main/services/project-composer-status.service.ts  # Core project(ops) 推送；读 main log store
  src/main/services/notify-composer-status-after-kkv-clear.ts  # 置位/压缩 project；Undo undo_send/rewind 推空；renderer ∪ annotate
  src/main/ipc/handlers/messages.ts       # handleMessagesRollback：truncate 后 clearUserOpsLog + 推空；handleMessagesSetFloor 置位钩子
  src/main/ipc/handlers/compaction.ts     # handleCompactionManual → notifyComposerStatusAfterFloorOrCompaction
  src/main/ipc/handlers/vfs.ts            # handleUserVfsHasPending 改读 main log store
  src/main/ipc/handlers/workplace.ts      # 手动重置 clearUserOpsLogStore
  renderer/features/chat/ChatComposer.tsx       # unionComposerStatusWithAnnotate（仅 annotate）
  renderer/features/chat/ConversationPanel.tsx  # Undo 正文回填 + annotate；门闩 ipcUserVfsHasPending
  renderer/features/chat/rollback-annotate-restore.ts  # 仅 annotate ∪；Undo 时 main 已推空 ops，renderer 不映回 user_ops
  packages/core/.../message-transcript-effects.service.ts  # Core set-floor 路径（Desktop 经 handleMessagesSetFloor 接线）
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core store | 新增 `UserOpsLogStore`：append / list / clear / subscribe；`chipsFromUserOpsLogStore`（**不**导出 App 侧 union ops） |
| executeOp | 成功后 append 结构化日志（从 `UserVfsTurnOp` / `mapUserSaveToToolUses` 派生）；**同 PR 停写** `user_vfs_pending` kkv |
| pending kkv | **同 PR 内停写**（不再 append / 双写）；`hasPendingTurns` / 门闩 / flush **一律读 log store**；D8 truncate 仍清旧域无害 |
| flush | `flushPendingUserVfsTurns` 实现改为 list→attachments→clear store；无净 diff；`flushed:true` ⇔ 未发送日志非空且已转为附件（**废除** net diff 非空条件） |
| preview | 删除 runtime 对 `resolveWorkspaceFlushDiff` 的调用；Core `projectComposerStatusAttachments` 改读 log store |
| chip | path 聚合；同 path 多条日志一颗 chip；**Core 出 ops，App 仅 ∪ annotate** |
| Undo | **`undo_send` / `rewind` 一致**：`clearUserOpsLog` + 推空 chip；**不** parse/append 映回手改 store；正文 + annotate 仍恢复；Desktop main 清 store；renderer 正文 + annotate ∪；Mobile 单进程同门控 |
| Desktop 真源 | `UserOpsLogStore` / `hasPendingTurns` / flush **同处 main 进程**；renderer 禁止写 ops log store |
| 置位/压缩 | 不清 store；钩子 Core project(ops) + App ∪ annotate |
| 手动重置 | `clearUserOpsLogStore` + `clearSession` kkv；不必清 annotate |
| 测试 | 翻转 T-OP3 / F4 / create+edit 折单 / T-CR6；新增 T-UOL* |
| Public API | 废弃导出 diff/synthesize/resolveFlush*（allowlist 更新） |

## 详细实现步骤

- Step 1 — phase-schema-store — blocking: yes — qa: auto：新增 `user-ops-log.schema.ts`（edit 字段 `hunks`）+ `chat-user-ops-log-store.ts`（append/list/clear/subscribe + `chipsFromUserOpsLogStore` path 聚合）
- Step 2 — phase-execute-append — blocking: yes — qa: auto：`executeOp` 成功后 append 日志；noop 不写；**同 PR 停写** `user_vfs_pending` kkv（不再 append pending 队列）；失败写盘回滚逻辑不变；日志 append 失败不回滚盘
- Step 3 — phase-flush-from-log — blocking: yes — qa: auto：`flushPendingUserVfsTurns` 改为 list log store→`buildUserOpsAttachmentFromLogEntry`（**相对现网 `buildUserOpsAttachmentFromEntry` 新增/改名**；入参改为 `UserOpsLogEntry` 而非 `SynthesizedUserVfsAction`）→clear store；删除 `resolveWorkspaceFlushDiff` 调用；`hasPendingTurns` 改读 log store；更新 `user-vfs-turn.port.ts` JSDoc：`UserVfsFlushResult.flushed` = 未发送日志非空且已转为附件（**废除** pending 非空且 net diff 非空）；更新 `prepare-user-vfs-turn-for-agent-run`
- Step 4 — phase-project-chips — blocking: yes — qa: auto：`projectComposerStatusAttachments` deps 改为读 log store（见上 `ProjectComposerStatusAttachmentsDeps` 新形状）；去掉 `previewUserOpsActions` 热路径；**Core 负责 ops chip**；Mobile `chat-composer-draft` / Desktop `ChatComposer` **仅** `unionComposerStatusWithAnnotate`（禁止 App ∪ ops-log）；Desktop main `projectComposerStatusForSession` 推送 ops，renderer ∪ annotate
- Step 5 — phase-send-gate-clear — blocking: yes — qa: auto：门闩读 log store 非空（`hasPendingTurns` 同名改实现）；append 成功后 clear log（对称 annotate）；Mobile `ChatComposer`；Desktop `ConversationPanel.tsx`（`ipcUserVfsHasPending` / `refreshPendingUserOps`）+ main `vfs.ts` `handleUserVfsHasPending` 改读 **main** log store；Desktop `ChatComposer` 接线
- Step 6 — phase-undo-restore — blocking: yes — qa: auto：**必改文件** — Mobile `useChatTabMessages.ts`（单进程：`mode = isPlainUserUndoSendEligible`；**`undo_send` / `rewind` 一致** `clearUserOpsLog` + 推空 chip；truncate → 正文 → parseAnnotate → ∪ annotate）；Desktop **main** `messages.ts` `handleMessagesRollback`：truncate 后 **`clearUserOpsLog` + `notifyComposerStatusAfterSessionKkvCleared`**；renderer `ConversationPanel.tsx` 正文回填 + `rollback-annotate-restore.ts`（annotate ∪ only）；**禁止** renderer 写 ops log store；**禁止** parse/append 映回手改 store。**顺序钉死**见 D8
- Step 7 — phase-floor-compaction — blocking: yes — qa: auto：置位/压缩钩子 Core project(ops) + App ∪ annotate；Desktop main `messages.ts` `handleMessagesSetFloor` + `compaction.ts` `handleCompactionManual` → `notifyComposerStatusAfterFloorOrCompaction`（现网已有，改数据源读 **main** log store）；Core `message-transcript-effects.service.ts` set-floor 路径；**手动重置**：Mobile `workplace-block.service.ts` / `useChatTabController.ts` + Desktop `workplace.ts` IPC → `clearUserOpsLogStore(sessionId)`（**不必**清 annotate，除非产品另定）
- Step 8 — phase-cleanup-diff — blocking: no — qa: auto：删除或 deprecate 净 diff 模块与无用导出；更新 public allowlist；弱化/删除 `skipComposerStatusRefresh` 批次 defer（可选保留 notify 合并）
- Step 9 — phase-compat-wire — blocking: yes — qa: auto：历史旧 user_ops XML 只读 parse；chip 文案 create/mkdir→「创建」
- Step 10 — phase-manual-perf — blocking: no — qa: manual_user：会话内 rename/批量移动后确认无秒级卡顿、Metro 无 `resolveWorkspaceFlushDiff` / `previewUserOpsActions`

## 测试策略

### 测试用例

- T-UOL1 — blocking: yes — Step 2/3：同文件 create 后 edit → store 两条；flush 两条附件（**翻转**「仅一条 write」）
- T-UOL2 — blocking: yes — Step 2/4：两次保存改回原内容（**第二次须非 noop**）→ store 非空；chip 按 path 仍可见（**翻转 T-OP3**）
- T-UOL3 — blocking: yes — Step 2：单次 save 多 hunk → 一条 `edit`，hunks.length ≥ 2
- T-UOL4 — blocking: yes — Step 3：删目录再 mkdir 同 path → 有日志则 flush **有附件**（**翻转 F4 skip-empty**）
- T-UOL5 — blocking: yes — Step 3/5：发送后 store 空、chip 空；checkpoint capture 仍可在有附件时触发（T-SD1 改写）
- T-UOL6 — blocking: yes — Step 4：投影 path 聚合 — 同 path 两条日志 → **一颗** chip；发送仍两条附件
- T-UOL7 — blocking: yes — Step 6：**`undo_send`** 含 user_ops 附件 → **`listUserOpsLog` 为空、Composer chip 无 user_ops**（**不**映回 store）；正文回填；批注可恢复；盘 prior；**`rewind`** 锚点同样清空 store、推空 chip；**不**要求重放写盘（**翻转**原 T-CR6「Undo 映回手改」/ D6）
- T-UOL8 — blocking: yes — Step 7：置位/压缩后未发送日志与 chip 仍在（`message-transcript-effects.service.ts` / compaction-handler 改数据源；T-CR5 改数据源）
- T-UOL9 — blocking: yes — Step 5：仅未发送日志、无正文无批注 → 可发送；全空不可发
- T-UOL10 — blocking: yes — Step 9：旧合成 XML 附件 parse 不抛；Undo 尽力映回或跳过损坏条
- T-UOL11 — blocking: yes — Step 2：noop save 不 append
- T-UOL12 — blocking: no — Step 8：单元断言手改投影路径不调用 `diffWorkspaceForUserVfsFlush`（可用 spy）
- T-UO1 / T-UO3 — blocking: yes — Step 3：仍不产生 `user_vfs_action` 行；附件 content 为 action XML（意图保留）
- T-CR4 — blocking: yes — Step 5：门闩改读日志非空（改写 `composer-sendable-input` 测）
- T-MAN1 — blocking: no — Step 10：真机 rename/批量移动流畅（合并后用户验收）

### 须废止或翻转的旧合同（文档指针）

| 旧 ID | 处置 |
|-------|------|
| T-OP2 preview≡flush（净 diff） | 废止；由 T-UOL6 替代「投影聚合 vs 发送全量」 |
| T-OP3 改回 baseline chip 空 | 翻转 → T-UOL2 |
| F4 flush_skip_empty_diff | 翻转 → T-UOL4 |
| recontract D6 / T-CR6「Undo 无手改」 | 2026-07-26 再次翻转 → T-UOL7 断言 undo_send **清空** store（与 rewind 一致） |
| composer-ops-chip-lifecycle「净 path 投影」 | 局部 supersede |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 杀进程丢未发送手改日志（进程内 store） | 与 annotate 同限；若不可接受，后续 Feature 加 kkv 持久化 |
| Undo 后再发送：盘 prior、store 已空 | 产品默认不重放写盘；用户须重新操作产生新日志；SPEC/PRD 已写 |
| 有「抵消感」的操作仍发给模型 | 有意为之；比静默吞掉更诚实 |
| Public API 破坏 | allowlist + 主版本/变更说明 |
| Desktop renderer 与 main ops 分工 | Undo 时 main 推空 ops；renderer `applyUndoAnnotateRestore` 仅 ∪ annotate |
| Desktop/Mobile 分批中间态双真源 | Core store+flush 先合，再切 App 投影；**禁止** App 侧 ∪ ops-log（仅 Core project + App ∪ annotate）；**禁止** Desktop renderer 写 ops log store（须 main 与 userVfsTurn 同进程）；**禁止** renderer wipe main 已推 ops；禁止只改一端 |
| 回滚本迭代 | revert commits；恢复 `resolveWorkspaceFlushDiff` 调用与旧测试；KKV/store 无强制迁移 |

## 已知限制

- 本迭代默认操作日志 **不持久化到 DB**（对齐 annotate）；杀进程 / 重装后未发送手改 chip 丢失。
- 项目工作区、Agent tool 写盘不记日志。
- Undo 后再次发送 **不**自动把磁盘改回「日志描述的终态」；Undo 已清空 store。
