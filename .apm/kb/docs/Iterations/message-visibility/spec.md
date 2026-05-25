# Message 可见性控制 技术规格（SPEC）

## 设计目标

为 Message 添加 `hidden` 字段，支持通过 CLI 和编程 API 控制消息对 LLM 的可见性，为未来的上下文压缩和手动对话裁剪提供基础能力。

## 总体方案

### 架构分层

```
CLI 层 (apps/cli)
  └─ nm message hide/show  # 单个和批量操作

Service 层 (packages/core)
  └─ MessageService
      ├─ hide(messageId)
      ├─ show(messageId)
      ├─ hideRange(sessionId, fromSeq, toSeq)
      └─ showRange(sessionId, fromSeq, toSeq)

Repository 层
  └─ MessageRepository
      ├─ updateHidden(messageId, hidden)
      └─ updateHiddenRange(sessionId, fromSeq, toSeq, hidden)

数据层
  └─ chat_message 表
      └─ hidden INTEGER NOT NULL DEFAULT 0
```

### 数据模型设计

**ChatMessage 接口**：
```typescript
export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: string;
  readonly content: MessageContent;
  readonly provider: string | null;
  readonly raw: Record<string, unknown> | null;
  readonly createdAtMs: number;
  readonly hidden: boolean;  // 新增字段
}
```

**数据库表**：
```sql
ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
```

### Prompt 渲染过滤策略

在 `renderPromptToText` 或其调用方（CLI `nm prompt render`）中过滤 `hidden=true` 的消息：

```typescript
// 方案 A: 在 renderPromptToText 内部过滤
const visibleMessages = ctx.messages.filter(m => !m.hidden);

// 方案 B: 在调用方过滤（推荐，保持 renderPromptToText 纯函数）
const messages = await messageService.listBySession(sessionId);
const visibleMessages = messages.filter(m => !m.hidden);
const output = renderPromptToText(blocks, { ...ctx, messages: visibleMessages });
```

**推荐方案 B**：保持 `renderPromptToText` 为纯函数，由调用方负责过滤。


## 最终项目结构

```
packages/core/src/
  ├─ domain/chat/model/message.ts          # 修改：添加 hidden 字段
  ├─ domain/chat/repositories/message.port.ts  # 修改：添加 updateHidden* 方法
  ├─ domain/chat/repositories/impl/sqlite-message.repository.ts  # 修改：实现 updateHidden*
  ├─ service/chat/message.port.ts          # 修改：添加 hide/show/hideRange/showRange
  ├─ service/chat/impl/message.service.ts  # 修改：实现 hide/show/hideRange/showRange
  ├─ service/chat/impl/session.service.ts  # 修改：copy 时保留 hidden
  └─ bootstrap/chat/chat-schema.ts         # 修改：添加 hidden 列 DDL

apps/cli/src/
  ├─ message/commands.ts                   # 修改：添加 hide/show 命令，list 显示 hidden
  └─ prompt/commands.ts                    # 修改：过滤 hidden 消息

packages/core/test/
  └─ chat/message-visibility.test.ts       # 新增：单元测试
```

## 变更点清单

### 1. Core 层数据模型

#### `packages/core/src/domain/chat/model/message.ts`
```typescript
export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: string;
  readonly content: MessageContent;
  readonly provider: string | null;
  readonly raw: Record<string, unknown> | null;
  readonly createdAtMs: number;
  readonly hidden: boolean;  // 新增
}
```

#### `packages/core/src/bootstrap/chat/chat-schema.ts`
在 `CHAT_SCHEMA_STATEMENTS` 数组末尾添加：
```typescript
`ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS hidden INTEGER NOT NULL DEFAULT 0`,
```

**注意**：SQLite 的 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 语法在 SQLite 3.35.0+ 支持。如果需要兼容旧版本，需要检查列是否存在后再添加。


### 2. Repository 层

#### `packages/core/src/domain/chat/repositories/message.port.ts`
```typescript
export interface MessageRepository {
  listBySession(sessionId: string): Promise<ChatMessage[]>;
  findById(id: string): Promise<ChatMessage | null>;
  nextSeq(sessionId: string): Promise<number>;
  insert(message: ChatMessage): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteBySession(sessionId: string): Promise<void>;
  
  // 新增方法
  updateHidden(messageId: string, hidden: boolean): Promise<boolean>;
  updateHiddenRange(sessionId: string, fromSeq: number, toSeq: number, hidden: boolean): Promise<number>;
}
```

#### `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts`
实现新增方法：

```typescript
async updateHidden(messageId: string, hidden: boolean): Promise<boolean> {
  const result = await executeTemplate(
    this.conn,
    `UPDATE chat_message SET hidden = #{hidden} WHERE id = #{id}`,
    { id: messageId, hidden: hidden ? 1 : 0 }
  );
  return result.changes > 0;
}

async updateHiddenRange(
  sessionId: string,
  fromSeq: number,
  toSeq: number,
  hidden: boolean
): Promise<number> {
  const result = await executeTemplate(
    this.conn,
    `UPDATE chat_message 
     SET hidden = #{hidden} 
     WHERE session_id = #{sessionId} 
       AND seq >= #{fromSeq} 
       AND seq <= #{toSeq}`,
    { sessionId, fromSeq, toSeq, hidden: hidden ? 1 : 0 }
  );
  return result.changes;
}
```

**注意**：`listBySession` 和 `findById` 需要在 SELECT 中添加 `hidden` 列，并在 `rowToMessage` 中解析：

```typescript
function rowToMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    content: JSON.parse(String(row.content_json)) as MessageContent,
    provider: row.provider == null ? null : String(row.provider),
    raw: row.raw_json == null ? null : (JSON.parse(String(row.raw_json)) as Record<string, unknown>),
    createdAtMs: Number(row.created_at_ms),
    hidden: Number(row.hidden) === 1,  // 新增
  };
}
```


### 3. Service 层

#### `packages/core/src/service/chat/message.port.ts`
```typescript
export interface MessageService {
  listBySession(sessionId: string): Promise<ChatMessage[]>;
  get(id: string): Promise<ChatMessage>;
  append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: { provider?: string | null; raw?: Record<string, unknown> | null },
  ): Promise<ChatMessage>;
  delete(id: string): Promise<void>;
  fork(sessionId: string, upToMessageId: string): Promise<ChatSession>;
  
  // 新增方法
  hide(messageId: string): Promise<void>;
  show(messageId: string): Promise<void>;
  hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>;
  showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number>;
}
```

#### `packages/core/src/service/chat/impl/message.service.ts`
实现新增方法：

```typescript
async hide(messageId: string): Promise<void> {
  const updated = await this.deps.messages.updateHidden(messageId, true);
  if (!updated) {
    throw chatNotFound("message", messageId);
  }
}

async show(messageId: string): Promise<void> {
  const updated = await this.deps.messages.updateHidden(messageId, false);
  if (!updated) {
    throw chatNotFound("message", messageId);
  }
}

async hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number> {
  // 验证 session 存在
  const session = await this.deps.sessions.findById(sessionId);
  if (session == null) {
    throw chatNotFound("session", sessionId);
  }
  return this.deps.messages.updateHiddenRange(sessionId, fromSeq, toSeq, true);
}

async showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<number> {
  // 验证 session 存在
  const session = await this.deps.sessions.findById(sessionId);
  if (session == null) {
    throw chatNotFound("session", sessionId);
  }
  return this.deps.messages.updateHiddenRange(sessionId, fromSeq, toSeq, false);
}
```

**注意**：`fork` 方法中复制消息时，需要保留 `hidden` 字段：

```typescript
// 在 fork 方法的消息复制循环中
for (const msg of toCopy) {
  await r.messages.insert({
    ...msg,  // 包含 hidden 字段
    id: randomUUID(),
    sessionId: forked.id,
    seq,
  });
  seq++;
}
```


#### `packages/core/src/service/chat/impl/session.service.ts`
在 `copy` 方法中，消息复制时保留 `hidden` 字段（当前代码已使用 `...msg`，无需修改）：

```typescript
// 现有代码已正确保留 hidden
for (const msg of messages) {
  await r.messages.insert({
    ...msg,  // 包含 hidden 字段
    id: randomUUID(),
    sessionId: copy.id,
  });
}
```

### 4. CLI 层

#### `apps/cli/src/message/commands.ts`
添加 `hide` 和 `show` 命令，修改 `list` 输出格式：

```typescript
export async function runMessage(
  rt: Pick<NovelMasterRuntime, "messages" | "scope">,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const sessionId = await rt.scope.resolveSessionId(flags);
      const list = await rt.messages.listBySession(sessionId);
      for (const m of list) {
        const text = m.content.content ?? JSON.stringify(m.content);
        const hiddenMark = m.hidden ? "[H]" : "";
        console.log(`${m.id}\t${m.seq}\t${m.role}\t${hiddenMark}\t${text}`);
      }
      return;
    }
    
    case "hide": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        await rt.messages.hide(messageId);
        return;
      }
      
      const sessionId = await rt.scope.resolveSessionId(flags);
      const fromSeqRaw = flags.get("from-seq");
      const toSeqRaw = flags.get("to-seq");
      if (typeof fromSeqRaw !== "string" || typeof toSeqRaw !== "string") {
        throw new Error(
          "Usage: nm message hide --message <id> | --session <id> --from-seq <n> --to-seq <n>"
        );
      }
      const count = await rt.messages.hideRange(
        sessionId,
        Number.parseInt(fromSeqRaw, 10),
        Number.parseInt(toSeqRaw, 10)
      );
      console.log(`Hidden ${count} message(s)`);
      return;
    }
    
    case "show": {
      const messageId = flags.get("message");
      if (typeof messageId === "string") {
        await rt.messages.show(messageId);
        return;
      }
      
      const sessionId = await rt.scope.resolveSessionId(flags);
      const fromSeqRaw = flags.get("from-seq");
      const toSeqRaw = flags.get("to-seq");
      if (typeof fromSeqRaw !== "string" || typeof toSeqRaw !== "string") {
        throw new Error(
          "Usage: nm message show --message <id> | --session <id> --from-seq <n> --to-seq <n>"
        );
      }
      const count = await rt.messages.showRange(
        sessionId,
        Number.parseInt(fromSeqRaw, 10),
        Number.parseInt(toSeqRaw, 10)
      );
      console.log(`Shown ${count} message(s)`);
      return;
    }
    
    // ... 其他 case 保持不变
    
    default:
      throw new Error("Usage: nm message <list|append|delete|fork|hide|show> ...");
  }
}
```


#### `apps/cli/src/prompt/commands.ts`
在 `nm prompt render` 中过滤隐藏消息：

```typescript
export async function runPrompt(
  rt: Pick<NovelMasterRuntime, "messages" | "scope" | "worktree">,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "render") {
    throw new Error("Usage: nm prompt render --path <file> [--session <id>]");
  }
  
  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error("Usage: nm prompt render --path <file> [--session <id>]");
  }
  
  const source = await readFile(path, "utf8");
  const blocks = parsePromptYaml(source);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  
  const allMessages = await rt.messages.listBySession(sessionId);
  const messages = allMessages.filter(m => !m.hidden);  // 过滤隐藏消息
  
  const worktreeDisplay = await rt
    .worktree({ kind: "session", projectId, sessionId })
    .renderDisplay();
  
  const output = renderPromptToText(blocks, { worktreeDisplay, messages });
  console.log(output);
}
```

## 详细实现步骤

### Phase 1: Core 层数据模型（packages/core）

1. **修改 ChatMessage 接口**
   - 文件：`src/domain/chat/model/message.ts`
   - 添加 `readonly hidden: boolean` 字段

2. **添加数据库迁移**
   - 文件：`src/bootstrap/chat/chat-schema.ts`
   - 在 `CHAT_SCHEMA_STATEMENTS` 末尾添加 `ALTER TABLE` 语句
   - 使用 `IF NOT EXISTS` 确保幂等性

3. **修改 MessageRepository 接口**
   - 文件：`src/domain/chat/repositories/message.port.ts`
   - 添加 `updateHidden` 和 `updateHiddenRange` 方法

4. **实现 Repository 方法**
   - 文件：`src/domain/chat/repositories/impl/sqlite-message.repository.ts`
   - 实现 `updateHidden` 和 `updateHiddenRange`
   - 修改 `rowToMessage` 解析 `hidden` 列
   - 修改 `insert` 方法，在 INSERT 语句中包含 `hidden` 列

5. **编译验证**
   - `npm run build` 在 `packages/core`


### Phase 2: Service 层实现（packages/core）

6. **修改 MessageService 接口**
   - 文件：`src/service/chat/message.port.ts`
   - 添加 `hide/show/hideRange/showRange` 方法

7. **实现 MessageService 方法**
   - 文件：`src/service/chat/impl/message.service.ts`
   - 实现 `hide/show/hideRange/showRange`
   - 验证 `fork` 方法保留 `hidden` 字段（当前代码已使用 `...msg`）

8. **验证 SessionService.copy**
   - 文件：`src/service/chat/impl/session.service.ts`
   - 确认消息复制时使用 `...msg`（已满足）

9. **导出到 index.ts**
   - 文件：`src/index.ts`
   - 确认 `MessageService` 类型已导出（已存在）

10. **编译验证**
    - `npm run build` 在 `packages/core`

### Phase 3: CLI 层实现（apps/cli）

11. **修改 message 命令**
    - 文件：`src/message/commands.ts`
    - 添加 `hide` 和 `show` case
    - 修改 `list` 输出格式，显示 `[H]` 标记

12. **修改 prompt 命令**
    - 文件：`src/prompt/commands.ts`
    - 在 `render` 中过滤 `hidden=true` 的消息

13. **编译验证**
    - `npm run build` 在 `apps/cli`

### Phase 4: 测试（packages/core）

14. **单元测试**
    - 文件：`test/chat/message-visibility.test.ts`（新增）
    - 测试用例见下文"测试策略"

15. **运行测试**
    - `npm test` 在 `packages/core`


## 测试策略

### 单元测试（packages/core）

**文件**：`packages/core/test/chat/message-visibility.test.ts`

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("Message visibility", () => {
  it("hides and shows a single message", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "msg1" });
    
    await ctx.messages.hide(m1.id);
    const hidden = await ctx.messages.get(m1.id);
    assert.equal(hidden.hidden, true);
    
    await ctx.messages.show(m1.id);
    const shown = await ctx.messages.get(m1.id);
    assert.equal(shown.hidden, false);
    
    await ctx.conn.close();
  });

  it("hides a range of messages by seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });
    await ctx.messages.append(session.id, "user", { content: "3" });
    await ctx.messages.append(session.id, "assistant", { content: "4" });
    
    const count = await ctx.messages.hideRange(session.id, 2, 3);
    assert.equal(count, 2);
    
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false);  // seq 1
    assert.equal(list[1]!.hidden, true);   // seq 2
    assert.equal(list[2]!.hidden, true);   // seq 3
    assert.equal(list[3]!.hidden, false);  // seq 4
    
    await ctx.conn.close();
  });

  it("shows a range of messages by seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "assistant", { content: "2" });
    
    await ctx.messages.hide(m1.id);
    await ctx.messages.hide(m2.id);
    
    const count = await ctx.messages.showRange(session.id, 1, 2);
    assert.equal(count, 2);
    
    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false);
    assert.equal(list[1]!.hidden, false);
    
    await ctx.conn.close();
  });

  it("fork preserves hidden state", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "assistant", { content: "2" });
    
    await ctx.messages.hide(m1.id);
    
    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    
    assert.equal(forkedMsgs.length, 2);
    assert.equal(forkedMsgs[0]!.hidden, true);   // m1 was hidden
    assert.equal(forkedMsgs[1]!.hidden, false);  // m2 was visible
    
    await ctx.conn.close();
  });

  it("session copy preserves hidden state", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });
    
    await ctx.messages.hide(m1.id);
    
    const copy = await ctx.sessions.copy(session.id);
    const copyMsgs = await ctx.messages.listBySession(copy.id);
    
    assert.equal(copyMsgs.length, 2);
    assert.equal(copyMsgs[0]!.hidden, true);   // m1 was hidden
    assert.equal(copyMsgs[1]!.hidden, false);  // m2 was visible
    
    await ctx.conn.close();
  });

  it("hideRange returns 0 when fromSeq > toSeq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });
    
    const count = await ctx.messages.hideRange(session.id, 5, 3);
    assert.equal(count, 0);
    
    await ctx.conn.close();
  });

  it("hideRange only affects existing messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });
    
    const count = await ctx.messages.hideRange(session.id, 1, 10);
    assert.equal(count, 2);  // Only 2 messages exist
    
    await ctx.conn.close();
  });
});
```


### E2E 测试（手动验证）

**测试场景 1：单个消息 hide/show**
```bash
# 创建 session 和 messages
nm project create --name P1
nm session create --title S1
nm message append --role user --content "msg1"
nm message append --role assistant --content "msg2"

# 列出消息（应无 [H] 标记）
nm message list

# 隐藏第一条消息
nm message hide --message <msg1-id>

# 列出消息（msg1 应有 [H] 标记）
nm message list

# 显示第一条消息
nm message show --message <msg1-id>

# 列出消息（应无 [H] 标记）
nm message list
```

**测试场景 2：批量 hide/show**
```bash
# 创建多条消息
nm message append --role user --content "1"
nm message append --role assistant --content "2"
nm message append --role user --content "3"
nm message append --role assistant --content "4"

# 批量隐藏 seq 2-3
nm message hide --from-seq 2 --to-seq 3

# 列出消息（seq 2-3 应有 [H] 标记）
nm message list

# 批量显示 seq 1-4
nm message show --from-seq 1 --to-seq 4

# 列出消息（应无 [H] 标记）
nm message list
```

**测试场景 3：Prompt 渲染过滤**
```bash
# 创建 prompt.yaml
cat > prompt.yaml << 'EOF'
blocks:
  - type: text
    role: system
    content: "You are a helpful assistant."
  - type: chat
EOF

# 隐藏部分消息
nm message hide --from-seq 1 --to-seq 2

# 渲染 prompt（应只包含 seq 3-4 的消息）
nm prompt render --path prompt.yaml

# 显示所有消息
nm message show --from-seq 1 --to-seq 4

# 渲染 prompt（应包含所有消息）
nm prompt render --path prompt.yaml
```

**测试场景 4：Fork 保留隐藏状态**
```bash
# 隐藏第一条消息
nm message hide --message <msg1-id>

# Fork session
nm message fork --up-to <msg2-id>

# 切换到新 session 并列出消息（msg1 应有 [H] 标记）
nm session use --session <forked-session-id>
nm message list
```


## 风险与回滚方案

### 风险点

1. **数据库迁移风险**：
   - **风险**：`ALTER TABLE ADD COLUMN IF NOT EXISTS` 在 SQLite < 3.35.0 不支持
   - **缓解**：检查 SQLite 版本，或使用 `PRAGMA table_info` 检查列是否存在
   - **影响**：Novel Master 使用 better-sqlite3，Node 20+ 环境通常包含 SQLite 3.35+

2. **现有数据兼容性**：
   - **风险**：现有 message 记录没有 `hidden` 列
   - **缓解**：使用 `DEFAULT 0` 确保现有记录默认为可见
   - **验证**：执行 `bootstrapNovelMaster` 后查询现有消息，确认 `hidden=0`

3. **Prompt 渲染性能**：
   - **风险**：每次渲染都需要过滤消息，可能影响性能
   - **缓解**：过滤操作为 O(n)，对于典型对话长度（<100 条）影响可忽略
   - **优化**：未来可在 Repository 层添加 `listVisibleBySession` 方法

4. **CLI 参数解析复杂度**：
   - **风险**：`hide/show` 命令支持两种模式（单个 vs 批量），参数解析复杂
   - **缓解**：优先检查 `--message`，不存在时再检查 `--from-seq` 和 `--to-seq`
   - **验证**：E2E 测试覆盖两种模式

### 回滚方案

**场景 1**：Core 层实现有 bug
- 回滚 `packages/core/src/domain/chat/` 和 `packages/core/src/service/chat/` 的改动
- 回滚 `packages/core/src/bootstrap/chat/chat-schema.ts`
- 删除 `packages/core/test/chat/message-visibility.test.ts`
- 注意：已添加的 `hidden` 列会保留在数据库中（不影响功能）

**场景 2**：CLI 层实现导致功能异常
- 回滚 `apps/cli/src/message/commands.ts`
- 回滚 `apps/cli/src/prompt/commands.ts`

**场景 3**：数据库迁移失败
- 如果 `ALTER TABLE` 失败，手动执行：
  ```sql
  PRAGMA table_info(chat_message);
  -- 如果没有 hidden 列，手动添加：
  ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ```

### 验收检查清单

- [ ] `npm run build` 成功（core + cli）
- [ ] `npm test` 全部通过（core）
- [ ] 手动验证：单个 hide/show 命令
- [ ] 手动验证：批量 hide/show 命令
- [ ] 手动验证：`nm message list` 显示 `[H]` 标记
- [ ] 手动验证：`nm prompt render` 过滤隐藏消息
- [ ] 手动验证：fork 保留隐藏状态
- [ ] 手动验证：session copy 保留隐藏状态
- [ ] 代码审查：确认所有 `listBySession` 调用点的 SELECT 包含 `hidden` 列
- [ ] 数据库验证：执行 `bootstrapNovelMaster` 后，`chat_message` 表包含 `hidden` 列

## 兼容性说明

### 向后兼容性

- ✅ **现有数据**：`DEFAULT 0` 确保现有消息默认可见
- ✅ **现有 API**：新增方法不影响现有 `MessageService` 方法
- ✅ **现有 CLI**：新增命令不影响现有 `nm message` 命令

### 向前兼容性

- ⚠️ **数据库 schema**：添加 `hidden` 列后，旧版本代码的 INSERT 语句可能失败（如果显式列出列名且不包含 `hidden`）
- ✅ **缓解**：当前 `SqliteMessageRepository.insert` 使用 `DEFAULT` 值，兼容性良好

### 依赖版本

- **SQLite**: 建议 3.35.0+（支持 `IF NOT EXISTS` in `ALTER TABLE ADD COLUMN`）
- **Node.js**: 20+（Novel Master 已要求）
- **better-sqlite3**: 当前版本（通常包含 SQLite 3.35+）
