# Message 可见性控制 PRD

## 背景

当前 Message 模型（`message.ts`）和数据库表（`chat_message`）缺少可见性控制字段，无法支持以下场景：
- 上下文压缩（compaction）：自动或手动隐藏不重要的历史消息，减少 LLM token 消耗
- 对话裁剪：用户手动隐藏部分消息，优化 prompt 质量
- 调试与测试：临时隐藏某些消息观察 LLM 行为变化

隐藏的 message 需要保留在数据库中（不删除），但在 prompt 渲染时不传递给 LLM。这与 UI 可见性是不同的概念。

## 目标（含成功指标）

**目标**：为 Message 添加 `hidden` 字段，支持通过 CLI 和编程 API 控制消息对 LLM 的可见性。

**成功指标**：
- Message 模型和数据库表包含 `hidden` 字段（布尔类型，默认 `false`）
- CLI 支持单个和批量 hide/show 操作（按 seq 范围）
- MessageService 提供 `hide` 和 `show` 方法
- Prompt 渲染时自动过滤隐藏消息
- `nm message list` 显示隐藏状态
- Fork 和 copy 操作保留隐藏状态

## 用户与场景

**用户**：Novel Master CLI 用户（开发者、AI 应用构建者）

**场景**：
1. **上下文压缩**：对话历史过长时，隐藏早期的寒暄、重复内容，减少 token 消耗
2. **手动裁剪**：调试 prompt 时，临时隐藏某些消息观察 LLM 响应变化
3. **批量管理**：一次性隐藏某个 seq 范围内的所有消息（如 seq 1-10）
4. **状态查看**：通过 `nm message list` 查看哪些消息被隐藏
5. **恢复可见**：需要时将隐藏的消息恢复为可见状态

## 范围

### 包含范围
- 在 `ChatMessage` 模型添加 `hidden: boolean` 字段（默认 `false`）
- 在 `chat_message` 表添加 `hidden INTEGER NOT NULL DEFAULT 0` 列
- MessageService 新增方法：
  - `hide(messageId: string): Promise<void>` - 隐藏单个消息
  - `show(messageId: string): Promise<void>` - 显示单个消息
  - `hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>` - 批量隐藏（返回影响行数）
  - `showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>` - 批量显示（返回影响行数）
- CLI 命令：
  - `nm message hide --message <id>` - 隐藏单个消息
  - `nm message hide --session <id> --from-seq <n> --to-seq <n>` - 批量隐藏
  - `nm message show --message <id>` - 显示单个消息
  - `nm message show --session <id> --from-seq <n> --to-seq <n>` - 批量显示
- `nm message list` 输出中显示隐藏状态（如增加 `hidden` 列）
- Prompt 渲染时过滤 `hidden=true` 的消息（`renderPromptToText` 或调用方）
- Fork 和 copy 操作保留 `hidden` 状态

### 不包含范围
- UI 可见性控制（与 LLM 可见性是不同概念，本期不涉及）
- 自动上下文压缩算法（本期仅提供手动控制能力）
- 隐藏消息的审计日志（谁在何时隐藏了哪些消息）
- 隐藏消息的撤销/重做功能
- 按角色、时间范围、内容关键词等高级过滤方式

## 核心需求

1. **数据模型扩展**：
   - `ChatMessage` 接口添加 `readonly hidden: boolean` 字段
   - `chat_message` 表添加 `hidden INTEGER NOT NULL DEFAULT 0` 列
   - 数据库迁移通过 `bootstrapNovelMaster` 自动执行

2. **MessageService API**：
   - `hide(messageId: string)`: 将指定消息标记为隐藏
   - `show(messageId: string)`: 将指定消息标记为可见
   - `hideRange(sessionId, fromSeq, toSeq)`: 批量隐藏 seq 范围内的消息（包含边界）
   - `showRange(sessionId, fromSeq, toSeq)`: 批量显示 seq 范围内的消息（包含边界）
   - 批量操作返回影响的消息数量

3. **CLI 命令**：
   - 单个操作：`nm message hide/show --message <id>`
   - 批量操作：`nm message hide/show --session <id> --from-seq <n> --to-seq <n>`
   - `nm message list` 输出格式调整，增加 `hidden` 状态列（如 `id seq role hidden content`）

4. **Prompt 渲染过滤**：
   - `renderPromptToText` 或其调用方（如 `nm prompt render`）在获取 messages 后过滤 `hidden=true` 的消息
   - 确保隐藏消息不出现在最终 prompt 中

5. **Fork 和 Copy 行为**：
   - `MessageService.fork` 复制消息时保留 `hidden` 字段值
   - `SessionService.copy` 复制 session 时保留所有消息的 `hidden` 状态

## 验收标准

### 数据模型验证
- [ ] `ChatMessage` 接口包含 `hidden: boolean` 字段
- [ ] `chat_message` 表包含 `hidden` 列（INTEGER, NOT NULL, DEFAULT 0）
- [ ] 执行 `bootstrapNovelMaster` 后，现有消息的 `hidden` 默认为 `0`（false）

### API 功能验证
- [ ] Given: 创建一个 message，When: 调用 `messageService.hide(messageId)`，Then: 该消息的 `hidden` 字段变为 `true`
- [ ] Given: 隐藏的 message，When: 调用 `messageService.show(messageId)`，Then: 该消息的 `hidden` 字段变为 `false`
- [ ] Given: session 有 seq 1-10 的消息，When: 调用 `hideRange(sessionId, 3, 7)`，Then: seq 3-7 的消息被隐藏，返回值为 5
- [ ] Given: session 有 seq 1-10 的消息（3-7 已隐藏），When: 调用 `showRange(sessionId, 5, 10)`，Then: seq 5-10 的消息可见，返回值为 6

### CLI 命令验证
- [ ] 执行 `nm message hide --message <id>`，再执行 `nm message list --session <sid>`，输出中该消息标记为 hidden
- [ ] 执行 `nm message hide --session <id> --from-seq 2 --to-seq 4`，再执行 `nm message list`，seq 2-4 的消息标记为 hidden
- [ ] 执行 `nm message show --message <id>`，再执行 `nm message list`，该消息不再标记为 hidden
- [ ] 执行 `nm message show --session <id> --from-seq 1 --to-seq 10`，所有消息恢复可见

### Prompt 渲染验证
- [ ] Given: session 有 3 条消息（seq 1, 2, 3），seq 2 被隐藏，When: 执行 `nm prompt render`，Then: 输出中只包含 seq 1 和 seq 3 的内容
- [ ] Given: session 所有消息都被隐藏，When: 执行 `nm prompt render`，Then: 输出为空或仅包含 prompt 模板的静态部分

### Fork 和 Copy 验证
- [ ] Given: session A 有消息 m1(hidden=true) 和 m2(hidden=false)，When: 执行 `nm message fork --session A --up-to m2`，Then: 新 session 中 m1 仍为 hidden，m2 仍为 visible
- [ ] Given: session A 有消息 m1(hidden=true) 和 m2(hidden=false)，When: 执行 `nm session copy --session A`，Then: 新 session 中所有消息的 hidden 状态与原 session 一致

### 边界情况验证
- [ ] 对不存在的 messageId 调用 `hide/show`，抛出明确错误
- [ ] `hideRange` 的 `fromSeq > toSeq` 时，返回 0（不报错）
- [ ] `hideRange` 的 seq 范围超出实际消息范围时，仅影响存在的消息
