---
date: 2026-07-21
dependency: Iterations/workspace-chat-vfs-upgrade/prd.md
---

# fork-snapshot-and-rules Feature PRD

## 背景

父级迭代要求修复分叉后的两类体验问题。现状：

- **分叉 / 会话复制**只带走截至锚点（fork）或全部（copy）的消息，以及**当前活树**文件内容。  
- **不**复制会话级 workplace 规则（文件 inclusion、目录排序等）；新建会话反而会从 project template `copyScope`，导致「分叉比新建更丢规则」。  
- **不**为新会话消息写入可回滚 checkpoint；用户在新会话回滚时，若 prior 为空（尤其首条 plain user undo_send），工作区可被清空。首条清空产品已接受；**非首条**因「完全无快照」被清空则不可接受。  
- 会话标题仍使用 `_ckpt_n` 后缀，易让人以为已有检查点能力。

既有合同：`message-attachment-unified` 写明 fork/copy **不**复制 `session_kkv`；本 feature **不强制**复制 kkv，但**必须**复制 workplace 规则表，并允许新会话侧首次拼装重建常驻前缀。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 规则连续 | 源会话改过的 inclusion / 目录排序，在 fork 与 copy 后的新会话 Explorer 中**一致生效** |
| 可安全回滚（非首条） | 新会话对**非第一条** plain user 做 undo_send，或对任意已挂快照消息 rewind：**不会**因空 prior 删光工作区文件 |
| 快照语义清晰 | 所有被复制消息的可回滚锚点对齐**操作完成时的当前活树**（同一份快照），不追求源会话逐步历史差 |
| 合同一致 | `session.copy` 与 `fork` 在「规则 + 活树快照」上行为一致 |
| 首条例外可文档化 | 新会话对**第一条** plain user undo_send 清空工作区 → **可接受**，验收用例注明即可 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 试写分支 | 在第 N 条消息分叉；新会话继续改文件再回滚到中间某条 → 文件回到分叉时那棵树，规则灯色仍对 |
| 整会话复制 | 复制会话做备份实验 → 规则与回滚底线与 fork 同级 |
| 误点首条撤销 | 新会话只有一条用户消息时 undo_send → 允许工作区变空（与现网普通会话首条语义一致） |

## 范围

### 包含范围

1. **fork**：在复制消息与活树之后，为**每条**新消息挂**同一份**「当前活树」可回滚快照；复制源 session → 新 session 的 workplace 规则（inclusion、目录排序等）。  
2. **session.copy**：与 fork **同一合同**（规则 + 对所复制消息挂当前活树快照）。  
3. Desktop / Mobile / CLI 凡暴露 fork 或 copy 的入口，行为一致（CLI 无 Composer 回填等 UI 细节除外）。  
4. 验收须覆盖：规则 parity；fork 后非首条 undo_send / rewind 不清空。

### 不包含范围

- 复制源会话完整 **revision 历史差异**（逐步回到「历史上某一轮」的真实差）  
- 插入不可见 seq0 基线以保住首条 undo_send 文件  
- 强制复制 `session_kkv`（`rule_snapshot` / `file_cache` / pending）；允许新会话首次拼装重建  
- 改普通（非 fork/copy 产生的）会话上「首条 undo_send 清空」的既有产品语义  
- 仅因本 feature 改 `_ckpt_` 标题文案（可选；若改须不阻塞主验收）

## 核心需求

1. **挂当前活树快照**  
   分叉/复制完成时，新会话内被复制的每条消息都具备指向**同一当前文件树**的可回滚快照，使后续非首条回滚有非空 prior / 锚点树，避免「无任何 checkpoint → 空基线删光」。  
   **快照完整性（验收相关）**：可回滚锚点 = **带 content 的 `vfs_revision` 行** + 消息上的 checkpoint 指针；**禁止**只挂 checkpoint、指望回滚路径 backfill 补 revision。

2. **保留会话 workplace 规则**  
   将源会话 scope 的规则完整带到新会话 scope（含 inclusion 与目录排序相关项），用户无需重新配置即可看到与源一致的工作区规则效果。

3. **fork 与 copy 同合同**  
   两条入口在规则与快照上不得一个做、一个不做。

4. **首条 undo_send**  
   明确接受「新会话第一条 plain user 撤销发送可能导致工作区清空」；不得为此阻塞本 feature。

5. **与 kkv 旧合同的关系**  
   本 feature **supersede**「fork/copy 后规则可丢失」的体验；**不** supersede「可不复制 kkv、允许首次拼装」——常驻前缀短暂重算可接受。

## 验收标准

**Given** 源会话已设置若干文件 inclusion 与目录排序，且工作区有文件  
**When** 用户 fork 到某条消息（或 copy 整会话）并打开新会话  
**Then**

- [ ] Explorer 中 inclusion / 排序与源会话一致（或文档约定的等价展示）  
- [ ] 对新会话**非第一条**用户消息执行 undo_send，或对中间 assistant 消息 rewind → 工作区文件**不被清空**；对齐分叉/复制时的活树（或该锚点所挂的同一快照）；该锚点对应 revision **已写入 content**（非仅靠 restore backfill）  
- [ ] 对**第一条** plain user undo_send → 允许工作区为空（用例标注「已知可接受」）  
- [ ] Desktop、Mobile（及 CLI 若有对应命令）行为一致  

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 活树 ≠ 锚点历史 | 若用户在锚点之后又改了文件再 fork，带走的是**操作时活树**，不是锚点完成瞬间的历史树——已在目标中写明，发布说明需提示 |
| 空工作区 | 无文件时可无 checkpoint / revision 行；「不清空」平凡成立 |
| 只挂指针不种 content | 仅 checkpoint、无带 content 的 revision → 回滚不可靠；SPEC 强制 list heads 后取 content 再 append |
| 标题 `_ckpt_` | 是否改文案留给实现阶段可选 |
