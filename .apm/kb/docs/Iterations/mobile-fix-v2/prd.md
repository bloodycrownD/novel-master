# Mobile Fix v2 PRD

> **上游**：`mobile-app`、`mobile-llm-streaming`（已合并 main）。  
> **本期**：聊天消息 **编辑 / 删除 / 批量删除**（`apps/mobile` + Core `MessageService.updateContent`）。

## 背景

对话 Tab 已支持流式聊天，但用户无法修正或清理错误消息；会话操作抽屉仅有会话级能力，缺少消息管理。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 单条删除 | 长按消息 → 删除 → 确认后从列表与 DB 移除 |
| 单条编辑 | 长按纯文本消息 → 编辑 → 保存后内容更新 |
| 批量删除 | 会话菜单「批量删除消息」→ 多选 → 确认删除 |
| Core 对齐 | `MessageService.updateContent` 持久化 `content_json` |
| 回归 | Core chat 单测通过；Agent 运行中禁止批量删除 |

## 范围

### 包含范围

- Core：`updateContent`（repository + service + 单测）
- Mobile：`MessageList` 长按菜单、批量选择、`SessionActionsDrawer` 入口

### 不包含范围

- 编辑含 `tool_use` / `tool_result` 的消息
- 消息 seq 重排、分叉点调整
- Anthropic 等非 OpenAI 专项

## 核心需求

1. 删除调用既有 `messages.delete(id)`。
2. 编辑仅当消息块均为 `text` / `thinking`。
3. 批量删除从会话 ⋮ 菜单进入，交互对齐会话列表批量删除。
4. Agent `running` 时不进入批量删除模式。

## 验收标准

- **Given** 会话有多条消息，**When** 长按一条用户消息 → 编辑 → 保存，**Then** 气泡显示新文案且重启 App 后仍一致。
- **Given** 会话有多条消息，**When** 菜单「批量删除消息」→ 勾选两条 → 删除，**Then** 仅保留未选消息。
- **Given** Agent 正在生成，**When** 打开会话菜单点批量删除，**Then** 提示稍候且不进入批量模式。

## 已确认决策

- 批量删除入口：会话操作抽屉（与截图一致）。
- 单条操作：长按消息气泡。
