# 聊天回滚、VFS 与工具体验修复 PRD

> **类型**：Bugfix 合集  
> **平台**：Mobile + Core（条目 1–3、5）；Mobile + Desktop + Core（条目 4、6）  
> **关联迭代**：`message-rollback-remove-session-log`、`mobile-chat-stability-fixes`、`mobile-chat-thinking-and-vfs-sort`、`agent-vfs-tool-suite`

## 背景

用户在 Mobile 日常使用中发现六类问题，涉及消息回滚后的列表跳动、VFS 重命名冲突处理、回滚时 worktree 与锚点时刻不一致、Agent 工具失败时 LLM 看不到具体原因、`write` 覆盖语义不明确，以及聊天消息内 thinking / 正文 / 工具调用块的展示顺序与 loading 反馈不符合阅读顺序。

其中回滚相关能力在 `message-rollback-remove-session-log` 已落地 batch 模型，但当前 checkpoint 主要绑定 Assistant 轮 mutating 操作；用户手动改文件后的状态无法作为可靠锚点。工具失败文案与消息块排版则影响 Agent 自我纠错与对话可读性。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 回滚后列表稳定 | Mobile 点击「回滚」并完成后，**不发生「跳到当前页上方」** 的可见跳动；用户仍停留在锚点消息附近的合理视口 |
| 重命名冲突可感知 | 同目录重命名为已存在名称时，**原文件/文件夹不被删除或覆盖**；用户看到明确报错气泡 |
| 回滚后 worktree 一致 | 回滚到消息 M 后，项目 worktree 与 **M 时刻 checkpoint 快照完全一致**（多删、少补） |
| 工具失败可诊断（LLM） | 工具执行失败时，返回给 LLM 的 tool message **包含具体失败原因**，而非仅「执行失败」 |
| write 覆盖语义明确 | `write` 在目标路径已存在时 **直接覆盖内容**（产品行为确定且一致） |
| 消息块顺序与 loading | thinking → 正文 → 工具调用；工具调用在对应正文下方；从流式出现 tool_call 到 result 到达前显示 loading |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 对话用户 | 长按消息执行回滚，期望列表不跳、文件回到该消息时刻的状态 |
| Mobile VFS 用户 | 在文件管理器重命名文件/文件夹，误用已存在名称时应被拦截 |
| 手动改文件的用户 | 在 user 消息发送前改了 VFS，回滚到该 user 消息应恢复当时完整项目状态 |
| Agent 用户 | 模型调用 `write` 等工具失败时，能根据 tool result 中的原因调整下一次调用 |
| 流式阅读用户（Mobile / Desktop） | 阅读 assistant 回复时按 **先思考、再正文、再工具** 的顺序浏览；工具执行中有 loading 反馈 |

## 范围

### 包含范围

1. **Mobile — 回滚后滚动稳定**（条目 1）
2. **Mobile + Core — 同目录重命名冲突拦截与报错**（条目 2）
3. **Mobile + Core — 全消息 checkpoint 与回滚快照对齐**（条目 3）
   - user 输入完成后、assistant 返回完成后各创建 checkpoint（chat 中一般不出现的 system 消息不在此列）
   - 回滚到锚点消息时，worktree 与锚点 checkpoint **完全一致**
4. **Mobile + Desktop + Core — 工具失败原因写入 tool message**（条目 4）
5. **Mobile + Core — `write` 支持覆盖已存在路径**（条目 5）
6. **Mobile + Desktop — 消息内块顺序与工具 loading**（条目 6）

### 不包含范围

- 本 PRD 不定义技术方案、接口、表结构或任务拆分（见后续 SPEC）
- Desktop 回滚滚动行为（条目 1 仅 Mobile 验收）
- Desktop VFS 重命名 UI（条目 2 以 Mobile 文件管理器 + Core 校验为主）
- 工具失败原因的 **最终用户 Toast/UI** 改版（条目 4 仅约束给 LLM 的 tool message）
- 流式 thinking 交互大改（条目 6 仅顺序与 loading，不改 thinking 内容格式）
- iOS 专项验收（与现有 Mobile 迭代一致，Android 为准）

## 核心需求

1. **回滚不跳屏**：Mobile 执行消息回滚（含确认）后，消息列表滚动位置保持稳定，不出现点击后视口跳到「当前页上方」的现象。
2. **重命名冲突保护**：同一父目录下，将文件或文件夹重命名为已存在的同级名称时，操作失败；**不得删除或覆盖** 原有项；Mobile 展示报错气泡，文案表明名称不能重复。
3. **User / Assistant 双端 checkpoint**：每条 **user 消息**（输入完成落库后）与每条 **assistant 消息**（返回完成落库后）均关联可回滚的 worktree checkpoint，以捕获用户手动 VFS 操作后的完整项目状态。
4. **回滚快照对齐**：回滚到消息 M 时，除删除 `seq > M` 的消息并撤销相关 batch 外，worktree 须与 M 的 checkpoint **完全一致**——相对锚点快照多出的路径删除，缺失的路径从快照补全。
5. **工具失败原因回传 LLM**：任意 VFS / Agent 工具执行失败时，写入会话的 tool result（供 LLM 阅读的 tool message）须包含 **可操作的失败原因**（如路径已存在、权限不足、参数无效等），禁止仅返回无信息的「执行失败」类笼统文案。
6. **`write` 覆盖写**：Agent / Core `write` 在目标路径已存在时，**覆盖** 该路径内容；行为在 Mobile 与 Core 层一致、可预期。
7. **消息块纵向顺序**：单条 assistant 消息内，展示顺序为 **thinking 块 → 正文块 → 工具调用块**；工具调用仍嵌入消息内容，但位于对应正文 **下方**。
8. **工具调用 loading**：从流式消息中出现 tool_call 块起显示 loading/执行中态，直至该工具的 result 到达后切换为完成态（成功或失败）。

## 验收标准

### 1. 回滚后消息列表不跳跃（Mobile）

- **Given** 用户在会话中向下滚动，当前视口不在列表顶部  
  **When** 长按某条消息选择「回滚」并确认成功  
  **Then** 列表 **不** 出现视口突然跳到「当前页上方」的现象；锚点消息或其邻近区域仍在合理可见范围内。

- **Given** 回滚将删除多条后续消息  
  **When** 回滚完成  
  **Then** 列表更新过程中无明显的顺序闪动或先显示错误列表再纠正的跳动。

### 2. 重命名冲突（Mobile + Core）

- **Given** 目录 `/foo` 下已存在文件 `a.md`  
  **When** 用户将另一文件 `b.md` 重命名为 `a.md`  
  **Then** 操作失败；`a.md` 与 `b.md` 均保持重命名前状态；Mobile 出现报错气泡，提示名称不能重复（或等价明确文案）。

- **Given** 目录 `/foo` 下已存在文件夹 `dirA`  
  **When** 用户将文件或文件夹重命名为 `dirA`  
  **Then** 同上：失败、原项不丢失、有报错气泡。

- **Given** 新名称在同目录下不存在  
  **When** 用户执行重命名  
  **Then** 重命名成功，列表刷新为正确名称。

### 3. Checkpoint 与回滚快照对齐（Mobile + Core）

- **Given** 用户在某条 user 消息发送前手动创建或修改了 VFS 文件  
  **When** 该 user 消息落库  
  **Then** 存在对应该消息的 checkpoint，能代表 **该消息完成时** 的 worktree 状态。

- **Given** assistant 一轮回复含工具写文件且消息已落库  
  **When** 该 assistant 消息完成  
  **Then** 存在对应该消息的 checkpoint，状态包含工具执行后的 worktree。

- **Given** 锚点消息 M 的 checkpoint 中仅有路径集合 `{P1, P2}`，当前 worktree 在 M 之后新增了 `P3`、修改了 `P2`、删除了 `P1`  
  **When** 回滚到 M  
  **Then** 回滚后 worktree 恰好包含 `P1`、`P2` 且内容与 M 时刻快照一致；`P3` 不存在。

- **Given** 回滚目标为较早的 user 消息（该消息之后仅有文本、无工具）  
  **When** 回滚成功  
  **Then** worktree 与用户在该 user 消息时刻手动操作后的状态一致，而非仅撤销 assistant batch。

### 4. 工具失败原因（LLM tool message，Mobile + Desktop + Core）

- **Given** Agent 调用 `write` 因业务规则失败（如非法路径、配额、校验错误等）  
  **When** 工具返回失败  
  **Then** 会话中供 LLM 阅读的 tool message **包含具体失败原因**（非空、非仅「执行失败」）；LLM 在下一轮能据文案判断失败类型。

- **Given** 任意已注册 VFS / Agent 工具执行失败  
  **When** 查看对应 tool result 持久化内容  
  **Then** 失败条目中 `error` / `message` / 等价字段含有可区分的错误描述。

### 5. write 覆盖写（Mobile + Core）

- **Given** 路径 `/proj/note.md` 已存在且内容为 `旧内容`  
  **When** Agent 或 Core 对该路径执行 `write` 且内容为 `新内容`  
  **Then** 操作成功；读取该路径得到 `新内容`；无「文件已存在」类误报失败。

- **Given** 路径不存在  
  **When** 执行 `write`  
  **Then** 创建文件并写入内容（行为与覆盖场景一并符合产品预期）。

### 6. 消息块顺序与工具 loading（Mobile + Desktop）

- **Given** 一条 assistant 消息同时含 thinking、正文 text、tool_call / tool_result  
  **When** 在会话列表中查看该消息（含流式结束后的落库态）  
  **Then** 自上而下顺序为：**Thinking 区域 → 正文气泡 → 工具调用区域**；工具调用不在 thinking 或正文上方。

- **Given** 流式输出中已出现某 tool_call 块、尚未收到对应 result  
  **When** 用户查看该消息  
  **Then** 该工具调用处显示 loading / 执行中态。

- **Given** 该 tool_call 的 result 已到达（成功或失败）  
  **When** 流式继续或结束  
  **Then** loading 消失，展示最终 tool result 状态。

- **Given** 消息仅有 thinking + 工具、无正文  
  **When** 流式结束  
  **Then** thinking 在上、工具调用在其下；不出现工具挤到顶部的布局。
