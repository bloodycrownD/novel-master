# Message Checkpoint v2 & 工具调用重构 PRD

> **前置迭代**：`message-rollback-remove-session-log`（消息回滚 UI）、`storage-schema-alignment`（Preferences v2）  
> **替代方向**：以 **message 级整树 checkpoint + VFS revision** 取代 batch/action/snapshot 回滚模型；工具层与 checkpoint 解耦并支持并发。

## 背景

当前 SessionFs 回滚基于 **batch + action 反向 undo + 变更前 content snapshot**（`session_execute_*` + `session_vfs_snapshot`）。该模型：

- 与产品语义（**只回滚到某条消息**）不对齐，batch 是内部实现细节；
- 工具调用经 `sessionFs.execute` 与回滚强耦合；
- Agent 一轮内 tool **串行**执行，无法并发；
- checkpoint 记录**过程**（多次 write/delete 同文件），复杂度高。

产品形态已稳定：Mobile/Desktop 仅提供 **消息长按「回滚」**，无会话日志、无 batch 时间线。用户期望：

- **Checkpoint** = 某条 Agent message 内 **全部 tool 执行完成后** 的 session 工作区**最终文件树状态**（path → version 指针，不含空目录）；
- **不存 snapshot 正文**在 checkpoint 表；正文由 **append-only VFS revision** 保留；
- **FileEditor 手动保存不产生 checkpoint**；
- **工具系统与 checkpoint 解耦**；tool 可并发执行。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 简化回滚模型 | 移除 batch/action/旧 snapshot 对外语义；`rollbackToMessage` 基于 message checkpoint **正向恢复整树** |
| Message 级 checkpoint | 仅 **Agent message 且 mutating tools 全部完成后** 写入；纯文本轮次无 checkpoint |
| 工具与 checkpoint 解耦 | mutating tool 只写 scoped VFS；checkpoint 由独立服务在 step 边界 capture |
| 支持 tool 并发 | 同一 assistant message 内多个 tool **可并行**；checkpoint 在全部 settled 后一次 capture |
| 性能可支撑规模 | 单会话 ≤ 20 000 消息、工作区 ≤ 1 000 文件、总大小 ~100 MB 时，capture/rollback 用户可感知延迟可接受（见 SPEC 非功能指标） |
| 跨端一致 | Mobile / Desktop / CLI `rollback --message` 与 Core 同一语义 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile / Desktop 用户 | 长按某条消息 →「回滚」→ 确认 → 后续消息删除，工作区文件恢复至 **该 message 执行完成时** 的树状态 |
| 写作者（FileEditor） | 在会话工作区手动改文件；**不**产生 checkpoint；回滚到较早 Agent message 时，手动改动可能被覆盖（产品需知悉） |
| 开发者 / CLI | `nm session rollback --message <id>`；调试命令可收敛（batch 列表等待定） |

## 范围

### 包含范围

1. **VFS revision 层**
   - 文件 write 产生 **append-only revision**（path + version + content）；`vfs_entry` 存 live head 指针
   - 支持按 revision 恢复 path 到历史 version

2. **Message checkpoint**
   - 表：`message_checkpoint(session_id, message_id)` + 树索引 `{ logical_path → version }`（仅 **file**，不含空目录）
   - **采集时机**：Agent 一轮 assistant message 的 **全部 tool 调用完成后**（fork-join）
   - **不采集**：纯文本 assistant 轮次、user/system 消息、**FileEditor / Preview 手动保存**

3. **回滚 `rollbackToMessage`**
   - 将 session 工作区恢复为 anchor message 的 checkpoint 树；删除 `seq > anchor` 的消息
   - 恢复 file 时：**先 ensure 目录链，再 restore 内容**；target 中不存在的 path 从 live 树删除
   - **Revision 清理**：回滚后删除不再被任何 checkpoint 或 live head 引用的 revision；删消息时同步清理对应 checkpoint 与可达 revision

4. **工具调用重构**
   - mutating tool（`vfs.write` / `vfs.replace`）直接写 scoped VFS（revision），**不再**经 `sessionFs.execute` batch
   - `ToolRunner` 支持 **并行**执行同一轮多个 tool（可配置并发上限）
   - 同 path 并发写：**last-write-wins**（只认 message 结束时的最终树）

5. **客户端**
   - Mobile / Desktop：保持现有消息回滚 UI；适配新 Core API（无 batchId）
   - FileEditor：保持直接写 VFS，不产生 checkpoint

6. **清理（无数据迁移）**
   - **不做**旧 batch/snapshot 回滚点向新 `message_checkpoint` 的数据迁移；升级前历史回滚能力 **直接废弃**
   - Bootstrap 直接 **DROP** `session_execute_*`、`session_vfs_snapshot` 等 legacy 表
   - 移除 `executeRound` / `SessionFsExecuteRound` / CLI batch 回滚

### 不包含范围

- 会话日志 / batch 时间线 UI（已移除，不再恢复）
- checkpointRetention / FIFO 快照淘汰策略（暂不设上限；仅回滚/删消息 GC）
- FileEditor 手动保存产生 checkpoint
- 单文件按 rev 回滚 UI（CLI `snapshot rollback` 是否保留由 SPEC 定案）
- LLM 协议 / Agent 循环本身的大改（除 tool 调度并发与 checkpoint 挂接点）

## 核心需求

1. **Checkpoint 只描述结果，不描述过程**  
   一条 Agent message 的全部 tool 完成后，扫描 session 工作区所有 **file**，记录 `{ path → head_version }`；同文件多次写只体现最终 version。

2. **Checkpoint 与 tool 解耦**  
   Tool 层只负责执行与写 VFS；Checkpoint 服务订阅「message tools completed」事件并 capture，两者无直接调用依赖。

3. **Revision 是可回溯的唯一正文来源**  
   Checkpoint 仅存 version 指针；回滚时通过 revision 恢复 content。禁止依赖原地覆盖后不可读的 `vfs_entry.version`。

4. **FileEditor 不在 checkpoint 体系内**  
   手动保存写入 revision 并更新 live head，但不写 `message_checkpoint`；回滚到 Agent anchor 时按 checkpoint 树覆盖相关 path。

5. **Revision 清理与 checkpoint 联动**
   - 回滚：删除 tail messages/checkpoints 后，GC 不可达 revision
   - 删除单条消息：删除其 checkpoint（若有）并 GC；**不** restore / reconcile VFS
   - 暂不设全局 FIFO 上限

6. **Tool 并发**  
   同一 assistant 轮次内 tool 可并行；必须在全部完成后才 capture checkpoint；Agent 运行中禁止用户回滚（保持现有 guard）。

## 验收标准

### 回滚语义

- **Given** Agent message A 写 `/a.md=v1`，message B 写 `/a.md=v2`，**When** 回滚到 A，**Then** `/a.md` 内容为 v1，且 B 及之后消息被删除。
- **Given** message B 新建 `/new.md`，**When** 回滚到 A（A 时无 `/new.md`），**Then** `/new.md` 不存在。
- **Given** 仅文本 tail、无 VFS 变更，**When** 回滚，**Then** 只截断消息，工作区文件不变。
- **Given** 回滚目标 path 需嵌套目录且 checkpoint 不含空目录，**When** 恢复文件，**Then** 系统自动创建所需 directory 再写入文件。

### Checkpoint 边界

- **Given** FileEditor 保存 `/manual.md`，**When** 无后续 Agent checkpoint，**Then** `message_checkpoint` 无对应 manual 条目。
- **Given** Agent 一轮 3 个 tool 并行写不同文件，**When** 全部成功，**Then** 仅 **1 条** checkpoint，树含 3 个 path 的最终 version。
- **Given** Agent 一轮无 mutating tool，**When** 轮次结束，**Then** 不写入 checkpoint。

### Revision 清理

- **Given** 回滚删除 tail checkpoints，**When** 某 revision 仅被 tail 引用，**Then** 该 revision 被 GC 删除。
- **Given** 回滚后 anchor checkpoint 仍引用 v1，**When** GC 运行，**Then** v1 revision 保留。

### 工具并发

- **Given** 一轮 5 个只读 tool，**When** 并行执行，**Then** 全部成功且不写 checkpoint（若无 mutating）。
- **Given** 一轮 2 个 tool 并行写同一路径，**When** 完成后 capture，**Then** checkpoint 中该 path 为 **最终** version（last-write-wins）。

### 回滚复合语义（消息 + 工作区）

- **Given** 会话从未产生 checkpoint（纯聊天 / 只读 tool），**When** 回滚到任意 anchor message（含 assistant），**Then** **tail 消息全部删除**；工作区无 checkpoint 可恢复时 **保持现状**（仅 reconcile tail 曾改动的 path，若无则不变）。
- **Given** 自 v2 升级前的会话（无历史 `message_checkpoint`），**When** 回滚到升级前 message，**Then** 同上：允许消息截断；文件恢复仅依赖升级后新产生的 checkpoint。

### 跨端与 guard

- **Given** Agent 运行中，**When** 用户点回滚，**Then** Mobile/Desktop 拒绝并提示（与现有一致）。
- **Given** 同一 DB，**When** Mobile 回滚后 Desktop 刷新，**Then** 消息列表与工作区与 Mobile 一致。
- **Given** CLI `nm session rollback --message <id>`，**Then** 与 App 同语义。

### 性能（业务可感知）

- **Given** 工作区 1 000 个文件、checkpoint 含满编树，**When** capture，**Then** 在移动端可接受时间内完成（SPEC 定义 P95 阈值，如 &lt; 200 ms 桌面 / &lt; 500 ms 移动）。
- **Given** 同上，**When** `rollbackToMessage` 至 500 条消息之前，**Then** P95 rollback 在 SPEC 阈值内完成。

## 约束与依赖

- 依赖现有 scoped session VFS（`/projects/{id}/sessions/{id}/…` 物理前缀）。
- 依赖 `chat_message.seq` 做 tail 截断。
- 前置：`message-rollback-remove-session-log` 已落地消息回滚 UI。

## 非功能需求（业务/体验）

- 回滚为 **destructive** 操作，需二次确认（已有）。
- FileEditor 手动改动在回滚到更早 Agent message 时可能丢失：Settings/确认文案需说明或保持现状静默覆盖（**待产品择一**，见 SPEC 风险）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| FileEditor vs 回滚 | 手动保存无 checkpoint；回滚可能覆盖手动编辑 — 是否加「未 checkpoint 改动」警告 |
| 旧回滚点 | **已定案**：不做迁移，batch/snapshot 数据 bootstrap 直接 DROP；升级前 message 不可回滚 |
| CLI batch/snapshot 命令 | `vfs records list/rollback`、`snapshot rollback` 去留 |
| `vfs.mkdir` | 是否纳入 revision/checkpoint 语义（目录节点） |
| CLI Agent `executeRound` | 当前缺失，需在 tool 重构一并修复 |

## 里程碑（可选）

1. **M1 Core**：VFS revision + message checkpoint + 新 rollback + GC  
2. **M2 Tool**：并行 ToolRunner + 去 sessionFs.execute 耦合  
3. **M3 Apps**：Mobile/Desktop/CLI 适配  
4. **M4 清理**：DROP legacy 表、dead IPC、旧测试替换（无回滚点数据迁移）
