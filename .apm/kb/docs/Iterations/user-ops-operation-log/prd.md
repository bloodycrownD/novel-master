---
date: 2026-07-25
dependency:
  - Iterations/message-attachment-unified/prd.md
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/annotate-user-ops-unify/features/composer-chip-ops-annotate-recontract/prd.md
  - Iterations/desktop-chat-workspace-polish/prd.md
  - Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/prd.md
---

# user-ops-operation-log PRD

> 敏捷名称：`user-ops-operation-log`  
> 平台：Mobile + Desktop（合同双端一致；实现可分批）  
> 性质：手改 user_ops 真源从「checkpoint 净 diff」改为「按次操作日志附件」  
> **局部 supersede**（见「范围」与「核心需求」）：
> - `desktop-chat-workspace-polish` F4：发送时 checkpoint 净 diff 合成 flush
> - `composer-ops-chip-lifecycle`：状态条手改 chip 由净 path 投影；抵消后 chip 消失
> - `annotate-user-ops-unify` 中手改依赖 `synthesize-user-vfs-flush-actions` 的落库路径
> - `composer-chip-ops-annotate-recontract` D6：**Undo 不恢复手改** → 本迭代曾改为从消息附件映回；**2026-07-26 产品收窄**：`undo_send` 与 `rewind` 一致 **清空** 未发送 ops store（不映回手改）；正文 / 批注仍恢复
>
> **保留**：`composer-two-pipelines-hard-contract`（状态 chip vs `@`）；批注 store / ∪ chip；写盘即时发生；message checkpoint 仍服务 VFS 回滚（不再作 flush baseline）。

## 背景

当前会话手改链路是：保存立刻写盘，同时进 pending 队列；Composer 状态条与发送附件都靠「相对上次发送的 message checkpoint」做工作区净 diff 再合成。pending 里已有的 `actionXml` 不参与 flush。

这带来两类问题：

1. **体验 / 性能**：每次手改（含 rename / 移动）成功后要全量投影状态条，会话工作区一大就卡（实测单次 move 里投影可达数秒），而真正写盘往往只需数百毫秒。
2. **语义拧巴**：用户以为状态条是「本轮做过什么」，实际是「相对上次发送还剩什么净差」；改回原内容 chip 会消失；创建后再改同文件，发送时可能只剩一条 write——和保存时已算出的 edit/write 也对不齐。

批注侧已经是另一套更干净的模型：草稿自带内容 → 状态条投影草稿 → 发送原样落附件 → Undo 从消息映回。本迭代把手改收成同一类故事：**操作日志就是 Composer 真源**。

## 目标（含成功指标）

1. 手改不再依赖 checkpoint 净 diff 做 chip 投影或发送合成。
2. 每次成功保存（或等价一次用户 VFS 突变落盘）追加一条操作日志；跨次保存不做合并。
3. Composer 存什么 → 状态条投影什么 → 发送带什么；**Undo Send / Rewind** 回滚成功后均 **清空** 未发送 ops store 并推空 Composer chip（**不**从消息附件映回手改 ops）；正文 / 批注仍恢复。
4. 会话内 rename / 移动后状态条刷新不再触发全树 diff（目标：与「无 chip 时代」同量级，毫秒～百毫秒级 UI 更新，而非秒级）。

**成功指标（可判定）**

- 单次会话文件保存 / rename 后，状态条更新路径上**不再**调用 `previewUserOpsActions` / `resolveWorkspaceFlushDiff`（或等价净 diff API）。
- 同文件连续两次保存（先 create 后 edit）→ 日志两条；发送消息上对应两条手改附件（或等价多 action 序列），**不是**被净 diff 折成一条。
- 改完又改回 baseline：日志与 chip（按 path 聚合后）仍在，直到发送清空或 Undo 规则处理。
- Undo Send / Rewind：正文回填；批注仍恢复；**手改 ops store 清空、Composer chip 无 user_ops**（与 rewind 一致，不 parse/append 映回）。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 作者（会话工作区） | 在文件管理器新建 / 保存 / 删除 / 重命名 / 移动文件后，输入框上方看到手改 chip；发送后模型收到本轮操作说明 |
| 作者 | 同一文件改多处后一次保存，希望模型看到多段 edit hunk，而不是整文件糊成一条难读的 diff |
| 作者 | 误发后 Undo：希望手改说明和批注一样能回到 Composer，而不是手改 chip 永远消失 |
| 作者 | 批量移动多个文件时，不应每移一个就卡数秒 |

## 范围

### 包含范围

1. **操作日志真源**：会话手改以按次追加的操作日志为准（见核心需求载荷）；写盘仍即时发生，日志不替代写盘。
2. **Composer 投影**：状态条手改 chip 由 **Core** 从日志投影；App **仅** ∪ annotate；UI **按 path 聚成一颗**（展示层）；真源日志可多条。
3. **发送**：取消 checkpoint 净 diff flush；发送时将未发送日志原样（或按既定 wire）变为消息 `user_ops` 附件并清空未发送日志。
4. **Undo Send / Rewind**：VFS 回滚成功后 **`clearUserOpsLog` + 推空 Composer chip**（双端一致；**不**从消息 `user_ops` 附件 parse/append 映回 store）；正文回填、批注反投影仍执行；盘仍走既有 prior checkpoint / rewind 规则。
5. **置位 / 压缩**：未发送操作日志与批注一样保留（对齐 recontract「跟输入框走」）。
6. **双端合同**：Desktop + Mobile 行为一致。
7. **历史消息**：已发出的旧合成 XML 附件只读兼容；新消息走新日志形态。

### 不包含范围

- 改批注划词 UX、跨节点高亮、`@path` 双管道合同。
- 项目工作区（非 session）直写是否记同一套日志（默认本迭代仅 session 手改 / `userVfsTurn` 路径）。
- Agent / 模型 tool 写盘是否写入同一操作日志（默认不纳入；仍只记用户手改）。
- 诊断用 logcat 迭代 `mobile-user-ops-logging-project-workspace-back`（可另开观测更新）。
- 废除 message checkpoint 的 VFS 回滚能力。

## 核心需求（3-7 条）

1. **即时写盘 + 旁路记日志**  
   用户保存 / 建删移等成功落盘后，追加一条操作日志（**同 PR 内停写** `user_vfs_pending` kkv，仅 append log store）。日志失败不得回滚已成功写盘（可 toast / 降级，SPEC 定）。跨次保存**不做**合并；「合并」只发生在**单次保存前**——落盘当下根据本次变更算出本条 action（例如一次保存内多处修改 → 一条 `edit`，hunk 数组写入该条 `hunks`）。

2. **Action 载荷（产品口径）**  
   - `create`：`{ "path": "…" }`（文件与文件夹文案统一为「创建」）  
   - `edit`：`{ "path": "…", "content": [ { "oldString", "newString" }, … ] }` — 产品侧 `content` 数组即 **hunk 列表**（与 `mapUserSaveToToolUses` 同源）；SPEC 落库字段统一为 `hunks`  
   - `write`：`{ "path": "…", "content": "…" }`（全文）  
   - `delete` / `rename`：同理（`path` 或 `oldPath`/`newPath`）；SPEC 钉 wire 与现网枚举迁移（若现网 `mkdir`→展示「创建」等）。  
   - **附件 ↔ 日志**：每条 `user_ops` 附件 `content` = 该条日志的 action XML（可含多段 edit action）；Undo parse 时 **每个非 annotate 的 `user_ops` 附件 → 一条日志**；同一附件 XML 内多段 edit 合并进该条的 `hunks`。

3. **Composer = 日志可视化**  
   输入侧存未发送日志；**Core** 由日志投影 ops chip；App 层 **仅** ∪ annotate（与现网 annotate 对称，**不再** App 侧 ∪ ops-log，避免双 chip）；**无** checkpoint 净 diff 投影。UI 按 path 聚成一颗 chip（实现成本低）；点开/发送仍以完整日志序列为准。

4. **发送 = 带走日志，不再 flush-diff**  
   废除「pending 非空再对 checkpoint 算净 diff 合成附件」。发送时未发送日志 → 消息附件；发送成功后清空未发送日志。不再要求「净 diff 为空则跳过落库」——有日志就带上（含「看起来像抵消」的条目，若用户确有多条保存）。

5. **Undo / 置位对称批注**  
   - **Undo Send**（`isPlainUserUndoSendEligible(anchor)` → `undo_send`）与 **Rewind**（assistant / `user_vfs_turn` 等锚点）：VFS 回滚成功后 **`clearUserOpsLog` + 推空 Composer chip**（双端一致；含 `skipVfsReconcile` 路径）；正文回填；批注反投影；**不**从消息 `user_ops` 附件映回手改 store（2026-07-26 产品收窄，supersede 原 recontract D6「Undo 映回手改」）。  
   - **Desktop 双进程分工**：ops log store 以 **main** 为真源；`undo_send` / `rewind` 均由 main `clearUserOpsLog` → `notifyComposerStatusAfterSessionKkvCleared`（或等价推空）；renderer **仅**正文回填 + 批注反投影 ∪ annotate。  
   - 置位 / 压缩：保留未发送手改日志与 chip（不清成空条终态）。

6. **门闩**  
   「有未发送手改」改判 **log store 非空**（可与批注门闩并列；`hasPendingTurns` 同名改读 store）；无正文且无手改日志且无批注则不可发送。

## 验收标准

1. **Given** 会话中新建文件并保存，再编辑同文件并保存，**When** 查看未发送状态与发送后的用户消息附件，**Then** 存在两条手改记录（create + edit），而非被折成单条 write。  
2. **Given** 编辑文件后再改回与保存前相同内容并**再次保存（第二次须非 noop）**，**When** 看状态条，**Then** 该 path 仍有手改 chip（按 path 聚合可见），不因「相对 checkpoint 净空」而消失。  
3. **Given** 会话内 rename / 移动文件，**When** 操作完成，**Then** 状态条更新不依赖工作区全量 checkpoint diff；主观卡顿相对现网明显下降（可用 Metro/日志确认无 `resolveWorkspaceFlushDiff` / `previewUserOpsActions`）。  
4. **Given** 一次保存中同一文件多处修改，**When** 落日志，**Then** 为一条 `edit`，且 `hunks`（产品口径即 `content` 数组）为多段 `oldString`/`newString`。  
5. **Given** 已发送含手改附件的 plain user 消息，**When** Undo Send（`undo_send`），**Then** 正文回填；批注可恢复；**`listUserOpsLog` 为空、Composer chip 无 user_ops**（不映回）；盘为 prior。**Given** assistant / `user_vfs_turn` 锚点，**When** Rewind，**Then** 同样 **清空** 未发送 ops store、推空 chip。  
6. **Given** 未发送手改日志存在，**When** 置位或压缩成功，**Then** 手改 chip / 日志仍在（与批注保留口径一致）。  
7. **Given** 仅有历史旧格式 user_ops 附件的消息，**When** 打开会话或 Undo 到该消息，**Then** 不崩溃；新旧格式只读兼容策略在 SPEC 中可测。

## 风险与待确认项

1. **Undo 后再次发送**：Undo 已清空未发送 ops store；若用户需再次说明手改，须重新保存 / 操作产生新日志。盘已是 prior，**不**自动重放写盘。  
2. **Undo Send vs Rewind**：二者 VFS 成功后均 **`clearUserOpsLog` + 推空 chip**；正文 / 批注恢复规则不变。  
3. **noop 保存**（内容未变）：是否不写日志——建议不写。  
4. **手动重置常驻**：是否仍清空未发送手改日志（现网倾向 clearSession）——建议保持「手动重置会丢未发送手改」，与置位不对称；实现上 `clearUserOpsLogStore(sessionId)` + kkv clearSession，**不必**清 annotate store（写入 SPEC）。  
5. **wire 命名**：产品 `create` vs 现网附件 `write`/`mkdir` 的迁移与 LLM `<action>` 名——SPEC 钉死兼容层。  
6. **迭代挂靠**：本文件为独立迭代；若希望降为 `annotate-user-ops-unify` 下 Feature，确认后可搬路径。
