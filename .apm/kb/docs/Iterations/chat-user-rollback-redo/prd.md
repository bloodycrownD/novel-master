---
date: 2026-07-12
dependency:
  - Iterations/message-rollback-remove-session-log/prd.md
  - Iterations/message-checkpoint-v2/prd.md
  - Iterations/rollback-failure-degraded-fallback/prd.md
---

# 聊天 User 回滚重做（Undo Send）PRD

> **平台**：Mobile（Android + iOS）+ Desktop + CLI（`apps/mobile`、`apps/desktop`、`apps/cli`）  
> **性质**：回滚 UX 语义分化——**plain text user** 消息对齐 Agent IDE「撤销发送」；**Assistant** 与 **不可恢复输入的 user** 保持现网「回退到此消息」语义。  
> **Supersede**：本 PRD 对 [`message-rollback-remove-session-log`](../message-rollback-remove-session-log/prd.md) 及后续回滚 PRD 中 **「User 锚点一律保留」** 条款 **部分 supersede**——仅适用于 **可提取纯文本的 plain user** 消息；其余 user 形态与 Assistant 仍沿用「保留锚点、删后续」。

## 背景

现网 `rollbackToMessage` 对 **User / Assistant 不区分**：均 **保留锚点消息**，删除 `seq > anchor.seq` 的后续对话，并将工作区恢复到锚点（或最近前序）checkpoint。双端回滚成功后 **不联动 Composer**。

这与常见 Agent IDE 体验存在缺口：

| 回滚对象 | 用户预期（Agent IDE） | 现网 |
|---------|----------------------|------|
| **Assistant** | 保留该条回复，删其后对话；输入框不动 | ✅ 已符合 |
| **Plain text User** | **撤销该条发送**：删该条及之后；输入框 **恢复原文** 便于修改重发 | ❌ 锚点仍保留；输入框不恢复；且末条 plain user 会 **禁用输入** |

探索确认：`editableTextFromMessage` 可识别 plain text user；`user_vfs_turn` 卡片、仅 `tool_result` 的 user 行等 **无法** 恢复为 Composer 聊天输入。用户已拍板：后者 **按 Assistant 回滚规则** 处理（保留锚点、删后续、输入框不动）。

**VFS 产品语义（plain user 含锚点删除）**：工作区对齐 **该条 user 发送之前的最近 checkpoint**（等价于以 `anchor.seq - 1` 为边界），与现网「保留锚点时对齐锚点自身 checkpoint」不同，但沿用既有 prior-checkpoint 回退规则，非新 VFS 模型。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Plain user 回滚 = Undo Send | 对可提取纯文本的 user 消息回滚后：该条 **从列表消失**；其后对话 **全部消失**；Composer **显示该条原文且可编辑** |
| Assistant 回滚不变 | 保留锚点 assistant（含 tool turn 边界解析）；删后续；Composer **文本与回滚前一致** |
| 非 plain user 回滚不变 | `user_vfs_turn`、不可恢复输入的 user 消息：行为与 **Assistant 回滚** 一致 |
| 双端 + CLI 一致 | Mobile、Desktop、`nm session rollback --message` 对同一 messageId **同一产品语义** |
| 降级路径保留 | VFS 快照丢失 / 恢复失败时，现有两级确认降级（backfill、仅删对话）**仍可用**；plain user 含锚点删除场景下降级文案须与新语义一致 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 会话作者 | 发出一条 prompt 后发现措辞不当，长按该 **user 消息** 回滚，希望在输入框 **直接改字再发**，而非重新打字 |
| 会话作者 | 对 **assistant 回复** 回滚，希望保留该回复、仅撤销之后轮次；输入框草稿不受影响 |
| VFS 操作用户 | 对 **user_vfs_turn** 卡片回滚，意图是「回到该次 VFS 操作之后的状态继续」，而非撤销为聊天输入——行为与 assistant 回滚一致 |
| 开发者 / 脚本 | CLI 回滚 plain user 与 App 同语义（含锚点删除 + 无 Composer 副作用） |

## 范围

### 包含范围

**1. Plain text user 回滚（Undo Send）**

- **消息**：删除 **该条 user 及之后** 全部消息（含配对 assistant、tool 轮次等 tail）。
- **Composer**：回滚成功后，输入框填入该条 user 的 **可编辑纯文本**（与「编辑」弹窗所用文本提取规则一致）；输入框 **可编辑**；覆盖该会话既有 Composer 草稿。
- **确认文案**：与 Assistant 区分，正文须表达 **「将删除此消息及之后的对话」**（或等价表述），避免仅写「之后」。
- **VFS**：工作区恢复到该条 user **发送前** 的最近 checkpoint；无 prior 时对齐会话基线（空树语义与现网一致）。
- **降级**：`skipVfsReconcile` 时仍执行 plain user **含锚点** 的消息截断；成功 Toast 区分「仅删对话」与完整回滚。

**2. Assistant 回滚（保持现网）**

- 保留锚点（assistant 含 `tool_use` 时仍按现网解析到配对 `tool_result` 边界）。
- 删除锚点之后消息；VFS 对齐锚点（或 prior）checkpoint。
- Composer **不主动修改**；确认文案可保持「删除此消息**之后**的对话」。

**3. 不可恢复输入的 user 消息（按 Assistant 规则）**

- 适用：`editableTextFromMessage` 为 `null` 的消息（含 `user_vfs_turn` 合成卡片、仅 `tool_result` 的底层 user 行等）。
- **消息**：保留锚点，仅删后续。
- **Composer**：不填入、不 Toast。
- **VFS**：与现网 assistant/user 锚点保留语义一致。
- 菜单仍展示「回滚」（除非 `hidden` 等现网排除条件）。

**4. 跨端与门禁**

- Mobile WebView transcript、Mobile legacy 列表、Desktop 消息菜单 **行为对齐**。
- Agent **运行中** 禁止回滚（沿用现网门禁；Desktop/Mobile 拦截方式可保持现状，但结果一致）。
- CLI `nm session rollback --message <id>` 跟随上述分化语义。

### 不包含范围

- 「编辑消息」原地改 content、不截断 tail 的既有能力
- 批量「删除消息」（无 VFS reconcile）与回滚的产品合并
- 新增独立「重发」菜单项
- 回滚后滚动策略变更（沿用 `mobile-rollback-scroll-stick` 贴底口径）
- Checkpoint 采集策略扩展（如 plain user 发送后自动 capture）
- 工作树刷新范围收窄/扩大（沿用 `message-delete-worktree-narrow-refresh` 后口径）

## 核心需求

1. **回滚语义三分支**：按消息角色与可编辑文本资格分流——(a) plain text user → Undo Send；(b) assistant → 现网 Rewind；(c) 不可恢复输入的 user → 同 (b)。
2. **Plain user 含锚点删除**：该条 user 从 transcript 移除；tail 全部移除；VFS 对齐 **上一 checkpoint**（发送前时刻）。
3. **Composer 恢复**：plain user 回滚成功后，双端输入框展示锚点原文、可编辑发送；须覆盖会话草稿（Mobile `chat-composer-draft` 与 Desktop 输入状态策略对齐）。
4. **Assistant / 非 plain user 不动输入**：回滚前后 Composer 文本一致（允许用户未发送草稿自然保留，但不得因回滚写入锚点文本）。
5. **确认与反馈**：plain user 与 assistant / 非 plain user 使用 **可区分** 的确认正文；成功/降级 Toast 沿用现网分级，plain user 降级时不得错误声称「锚点仍保留」。
6. **跨端与 CLI 一致**：同一 `messageId`、同一分化规则，三端消息截断与 VFS 边界一致（CLI 无 Composer 副作用）。
7. **与相邻能力边界清晰**：回滚 ≠ 编辑（不原地改 DB）；plain user 回滚 ≠ assistant 回滚（消息是否含锚点删除不同）。

## 验收标准

### Plain text user（Undo Send）

- **Given** 会话含 user₁（plain text）→ assistant₁ → user₂，**When** 对 user₁ 执行回滚并确认，**Then** 列表 **仅不含** user₁ 及之后消息；user₁ 原文 **出现在 Composer** 且可编辑；工作区与 user₁ **发送前** checkpoint 一致。
- **Given** 回滚前 Composer 有未发送草稿「无关文字」，**When** plain user 回滚成功，**Then** Composer 显示 **锚点 user 原文**（覆盖草稿）。
- **Given** plain user 回滚确认框，**When** 用户阅读正文，**Then** 明确包含 **「此消息及之后」** 将被删除的语义（非仅「之后」）。
- **Given** VFS 恢复失败且用户选择「仅删除后续对话」，**When** plain user 回滚降级成功，**Then** 该 user **及 tail 消息仍被删除**（含锚点截断）；Toast 说明工作区未恢复。

### Assistant（保持现网）

- **Given** 会话含 user → assistant₁ → user₂，**When** 对 assistant₁ 回滚并确认，**Then** assistant₁ **仍保留**；仅 user₂ 及之后删除；Composer 文本与回滚前 **一致**。
- **Given** assistant 含 `tool_use` 且后续有配对 `tool_result`，**When** 点对 assistant 回滚，**Then** 有效锚点边界与现网 tool turn 规则一致；整轮保留。

### 不可恢复输入的 user（同 Assistant）

- **Given** 会话含 `user_vfs_turn` 合成卡片及后续消息，**When** 对该卡片锚点回滚，**Then** 锚点 **保留**；仅删后续；Composer **不填入**内容、**不**额外 Toast；VFS 与现网「保留锚点回滚」一致。
- **Given** 仅 `tool_result` 的底层 user 行（若 UI 可触发回滚），**When** 回滚，**Then** 行为同 Assistant 回滚（保留锚点、删后续）。

### 跨端与门禁

- **Given** Agent 运行中，**When** 用户尝试回滚，**Then** 操作被拦截并提示（与现网一致，双端结果一致）。
- **Given** 同一 session、同一 plain user messageId，**When** 分别在 Mobile、Desktop、CLI 执行回滚，**Then** 截断后消息集合与 VFS 状态 **一致**（CLI 无 Composer 断言）。

### 非回归

- **Given** 现有 assistant 回滚、VFS 降级、revision backfill 场景，**When** 执行原有关键用例，**Then** assistant / 非 plain user 路径 **无行为回归**（plain user 用例按新语义更新）。

## 风险与待确认项

| 风险 | 说明 |
|------|------|
| 历史测试/E2E 语义翻转 | Core `rollback.test.ts` R2/R3、Mobile `chat.rollback.e2e.ts` 等断言「user 锚点保留」，plain user 路径须 **更新为新语义** |
| Desktop Composer 受控化 | 现网 Desktop 输入为组件内 state，恢复原文需产品可达的输入写入能力（实现留 SPEC） |
| 确认文案双语端差异 | Desktop 确认标题现为「确认操作」，本迭代至少正文须区分；标题统一为可选优化 |
| Agent 运行中菜单 | Mobile 运行中禁菜单、Desktop 可开菜单但拦截——本 PRD 不要求对齐，但回滚结果须一致 |
