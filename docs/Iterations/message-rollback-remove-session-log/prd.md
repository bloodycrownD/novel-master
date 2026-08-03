# 移除会话日志 & 消息回滚 PRD

## 背景

Mobile 当前通过 **会话日志** 页（`SessionLog`）展示工具执行与 VFS **检查点** 的合并时间线，并在检查点卡片上提供「回滚到此」。聊天页长按消息已有编辑、隐藏、复制、Fork、删除等操作，但 **回滚能力不在消息上下文中**，用户需离开对话流进入独立日志页。

用户希望 **移除会话日志**，将回滚能力收敛到 **消息长按菜单**。

### 现有 Core 模型（并不复杂）

| 层 | 作用 |
|----|------|
| `session_vfs_snapshot` | 按 path + rev 存 **完整文件内容**（及 status、vfsVersion） |
| `session_execute_checkpoint` | **仅 mapping**：`(batchId, path) → snapshotRev`，不含 content |
| `session_execute_batch` + `session_execute_action` | 一次 `execute` = 一个 batch，可含 **多个** write/replace/delete action |

`sessionFs.execute(actions[])` **已支持** 一轮多个 mutating 动作共用一个 batch；单测已覆盖「write + delete 同 batch → 一次 rollbackBatch 恢复」。

### 当前实现里的多余复杂度

| 问题 | 现状 |
|------|------|
| 每工具一个 batch | `vfs.write` / `vfs.replace` 每次单独调 `execute([单 action])`，一轮多工具 → 多个 batch |
| 无 message 绑定 | `session_execute_batch` 无 `message_id` |
| Mobile 启发式 | 会话日志用 120s 时间戳猜 tool ↔ batch，无持久关联 |

**目标模型（简化后）：**

```text
Assistant 消息 (messageId)
  └── 0 或 1 个 execute batch（仅当该轮有 mutating VFS 操作）
        └── 多个 action + 按 path 的 checkpoint mapping
User 消息 → 无 batch
```

回滚不再做「解析 batch 集合 + 复合 API」，而是：**batch 带 messageId + 一轮一 batch + 按 seq 过滤后循环现有 `rollbackBatch`**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 简化 batch 模型 | Agent 一轮 mutating 工具合并为 **一个 batch**，且 batch 持久化 `message_id` |
| 移除会话日志 | Mobile 无 `SessionLog` 路由、无抽屉入口、无 timeline 启发式代码 |
| 消息回滚 | 任意消息长按「回滚」→ VFS 撤销锚点 **之后** 的 batch + 删除 `seq > anchor` 的消息 |
| 跨端一致 | Core `rollbackToMessage` + CLI 等价命令 |
| 可判定失败 | batch 过期、Agent 运行中等场景明确报错 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile 用户 | 长按某条消息 →「回滚」→ 确认 → 后续对话消失，文件回到「锚点时刻」的状态 |
| 开发者 / 脚本 | `nm session rollback --message <id>` 与 App 同语义 |

## 范围

### 包含范围

1. **Core — batch 与 Agent 对齐**
   - `session_execute_batch` 增加 **`message_id`**（nullable；仅 Assistant 轮 mutating 时有值）
   - Agent 一轮工具：`append` Assistant 消息后，将 `messageId` 注入 `toolCtx`；**同轮所有 mutating VFS 操作共用一个 batch**（首工具开 batch，后续 append action；VFS 仍即时写入以满足工具间依赖）
   - 新增 **`rollbackToMessage(sessionId, projectId, messageId)`**：
     1. 取锚点 `seq = N`
     2. 列出 `message.seq > N` 且有关联 batch 的记录，按 `created_at_ms` **从新到旧** 依次调用现有 `rollbackBatch`
     3. 删除 `seq > N` 的消息
     4. 上述步骤在同一事务或等价原子语义下完成

2. **Mobile**
   - 完全移除会话日志相关 UI / 导航 / 测试
   - 消息长按菜单新增「回滚」（destructive）
   - Agent 运行中禁止（同 Fork）
   - 失败 Toast 展示原因

3. **CLI**
   - `nm session rollback --message <messageId>`

### 不包含范围

- 修改 FIFO 保留策略本身（无会话日志 Banner；过期时回滚失败）
- 回滚时自动 Fork
- 单文件 snapshot 回滚 UI
- Web 客户端

## 核心需求

1. **一轮一 batch（mutating）**  
   同一 Assistant 消息内多次 `vfs.write` / `vfs.replace` / delete 类操作 → **一个** `batchId`，batch.`message_id` = 该 Assistant 消息 id。只读工具（`vfs.read` 等）不进入 batch。

2. **回滚语义（VFS + 截断）**  
   锚点消息 `M`（seq = `N`）确认回滚后：
   - **保留** `M` 及 `seq ≤ N` 的所有消息
   - **删除** `seq > N` 的消息
   - **VFS**：仅对 **`message.seq > N`** 的 batch 执行 `rollbackBatch`（从新到旧）；**不回滚锚点自身 batch**

   | 锚点 | 消息 | VFS |
   |------|------|-----|
   | Assistant（该轮有写入） | 删后续 | 保留该轮写入；撤销更晚轮次的 batch |
   | Assistant（纯文本 / 只读工具） | 删后续 | 撤销更晚轮次的 batch（若有） |
   | User | 删后续（含紧随 Assistant 回复） | 撤销被删 Assistant 消息上的 batch |

3. **检查点过期**  
   待回滚 batch 中任一无法恢复 → **整次失败**，消息与 VFS 均不变。

4. **Agent 运行中**  
   禁止回滚（Mobile 门禁；Core 可选二次校验）。

5. **移除会话日志**  
   删除 `SessionLogScreen`、`SessionTimeline`、`CheckpointFifoBanner`、`timeline-builder`、`session-log.service` 及抽屉/导航入口。

6. **CLI**  
   调用 Core `rollbackToMessage`，退出码与 stderr 可脚本判定。

## 验收标准

### A. Mobile — 移除会话日志

- **Given** 含本迭代的 Mobile 包  
- **When** 打开会话操作抽屉  
- **Then** 无「会话日志」入口

### B. Mobile — Assistant 锚点（保留该轮写入）

- **Given** User 提问 → Assistant `vfs.write` 写入 poem → 后续还有多轮对话  
- **When** 长按 **写入 poem 的 Assistant 消息** → 回滚 → 确认  
- **Then** 该 Assistant **之后** 的消息消失；**poem 内容仍在**（该轮 batch 未回滚）；Toast 成功

### C. Mobile — User 锚点

- **Given** User「写一首诗」→ Assistant `vfs.write` → User「很好」→ Assistant 纯文本  
- **When** 长按 **第一条 User** → 回滚 → 确认  
- **Then** User 之后消息全删；poem 文件变更撤销；第一条 User 仍在

### D. 一轮多工具单 batch

- **Given** 一条 Assistant 消息含两次 `vfs.write`（不同 path）  
- **When** 查询 `session_execute_batch`  
- **Then** 仅 **一条** batch，`message_id` 为该 Assistant id；`session_execute_action` 两条

### E. 无 mutating 仅截断

- **Given** 仅文本往返  
- **When** 对中间消息回滚  
- **Then** 后续消息删除；VFS 无变化

### F. Agent 运行中 / batch 过期

- **Given** Agent 流式中，或待回滚 batch 已 FIFO 淘汰  
- **When** 发起回滚  
- **Then** 失败且不部分提交；Mobile Toast / CLI stderr 可读

### G. CLI

- **Given** 与场景 C 相同 DB  
- **When** `nm session rollback --message <userMessageId>`  
- **Then** 与 Mobile 场景 C 一致，退出码 0

### H. Core 单测

- 一轮多 action 单 batch + message_id  
- `rollbackToMessage`：Assistant 锚点 / User 锚点 / 仅截断 / 过期失败

## 约束与依赖

- 复用现有 `rollbackBatch`（单 batch 撤销 + checkpoint→snapshot 恢复），不新增「复合回滚」底层
- Agent runner 在 `append` Assistant 后向 `toolCtx` 传递 `messageId`
- `MessageService` 需支持按 seq 批量删除（若无则本迭代补齐）

## 非功能需求（业务/体验）

- 确认框明确：删除后续消息 + 可能撤销文件修改
- 回滚中防重复提交
- 成功后刷新聊天列表

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| 同轮 append batch 的实现 | 扩展 `execute` 支持 `batchId` 续写，或 tool 层「开 batch / 追加 action」小 API；PRD 不绑定具体方案 |
| 历史数据无 message_id | 旧 batch `message_id` 为空；回滚若命中无法映射的 batch 则失败并提示；或迁移期仅支持新数据（实现 spec 定夺） |
| FIFO 淘汰 | Core 实现淘汰后，过期 batch 导致整次回滚失败 |

## 里程碑（可选）

1. Core：`message_id` 列 + 一轮一 batch + `rollbackToMessage` + 单测  
2. CLI：`nm session rollback`  
3. Mobile：消息菜单 + 删会话日志  
4. 手工验收 B/C/F
