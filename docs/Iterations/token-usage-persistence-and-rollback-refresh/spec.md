---
date: 2026-08-10
---

# Token Usage 持久化与回滚刷新 技术规格（SPEC）

## 设计目标

基于 `prd.md`，实现两层修复：

1. **Usage 持久化**：每条 assistant message 存储 LLM 响应的结构化 usage（`promptTokens`/`completionTokens`/`totalTokens`）；cache 失效后从历史 message 回填，而非跌到本地估算。
2. **回滚后 UI 刷新**：Mobile 顶栏和 Desktop 抽屉在回滚后立即重新拉取 token 计数。

需求来源：`docs/Iterations/token-usage-persistence-and-rollback-refresh/prd.md`

## 总体方案

### Usage 持久化链路

```
LLM Response → usage-parser → LlmTokenUsage
                                ↓
agent-runner: session.append("assistant", ..., { usage: result.usage })
                                ↓
MessageService.append → ChatMessage.usage → sqlite INSERT (prompt_tokens/completion_tokens/total_tokens)
```

每条 assistant message（含 tool-call 中间 round）各自带 usage 落库。

### Cache 回填链路

```
resolveCurrentPromptTokens(sessionId, params)
  → sessionApiPromptTokenCache.get(sessionId)  ── 命中 ──→ 返回 API 值
  │ miss
  → 从 messages 末尾往前找最后一条带 usage 的 assistant message
    │ 找到 ──→ 回填 cache + 返回 promptTokens (source=api)
    │ 没找到
    → countPromptLlmInput (本地计数器兜底)
```

### UI 刷新修复

- Mobile `runRollback` 成功后补 `refreshChatTokenLabel()`
- Desktop `SessionDetailDrawer` 通过回滚路径调用 reload

## 最终项目结构

新增文件：
- `packages/core/src/domain/chat/model/message-usage.ts` — `MessageUsage` 类型

改动文件（按层级）：

| 层 | 文件 | 改动 |
|----|------|------|
| Schema DDL | `packages/core/src/bootstrap/chat/chat-schema.ts` | `chat_message` 加 `prompt_tokens`/`completion_tokens`/`total_tokens INTEGER` 三列 |
| Schema ALIGN | `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts` | 加三条 ALIGN 条目（ALTER TABLE ADD COLUMN） |
| Schema 版本 | `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `SCHEMA_BOOT_VERSION` 4 → 5 |
| Domain model | `packages/core/src/domain/chat/model/message.ts` | `ChatMessage` 加 `usage?: MessageUsage` |
| Repo impl | `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts` | `MESSAGE_SELECT_COLUMNS` 加三列；`rowToMessage` 映射 usage；`insert` 加列绑定 |
| Service port | `packages/core/src/service/chat/message.port.ts` | `append` options 加 `usage?: MessageUsage` |
| Service impl | `packages/core/src/service/chat/impl/message.service.ts` | `append` 把 usage 写入 message 对象 |
| Agent session (port) | `packages/core/src/domain/agent/session/agent-session.port.ts` | `AgentSession.append` options 加 `usage?: MessageUsage`（接口契约层先改，所有实现再对齐） |
| Agent session (chat) | `packages/core/src/service/agent/impl/chat-agent-session.ts` | `append` options 加 usage，透传给 `MessageService.append` |
| Agent session (ephemeral) | `packages/core/src/service/agent/impl/ephemeral-overlay-agent-session.ts` | `append` options 加 usage（签名对齐，不落库但接口一致） |
| Agent session (in-memory) | `packages/core/src/domain/agent/session/impl/in-memory-agent-session.ts` | `append` options 加 usage（测试用 in-memory 实现也要对齐接口；内存消息体上挂 usage 字段供断言） |
| Agent runner | `packages/core/src/service/agent/impl/agent-runner.ts` | `session.append` 传入 `result.usage` |
| 回填逻辑 | `packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts` | cache miss 时从 messages 回填 |
| 回填依赖 (Desktop) | `apps/desktop/src/main/services/session-prompt-input.service.ts` + `chat-prompt-tokens.service.ts` | `SessionPromptInputBundle` 加 `rawMessages`；token service 从 bundle 取 rawMessages 传给 backfill |
| 回填依赖 (Mobile) | `apps/mobile/src/services/session-prompt-input.service.ts` + `chat-prompt-tokens.service.ts` | 同上 |
| Mobile UI | `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | `runRollback` 补 `refreshChatTokenLabel()` |
| Mobile UI | `apps/mobile/src/services/chat-prompt-tokens.service.ts` | `formatChatTokenLabel` 套 `formatCounterKindLabel` |
| Desktop UI | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | 补回滚后刷新 + `counterKind` 套 `formatCounterKindLabel` |
| Desktop UI | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `formatChatTokenStatsLabel` 套 `formatCounterKindLabel` |
| Core (新增) | `packages/core/src/infra/tokenizer/logic/format-counter-kind-label.ts` | `formatCounterKindLabel` 映射函数 |
| Core | `packages/core/src/domain/provider/model/token-counter-mode-options.ts` | 移除 `heuristic` 条目 |
| Core | `packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts` | `parseTokenCounterModePref` 中旧值 `"heuristic"` 归一化为 `"auto"`；`VALID_FAMILIES` 保留 heuristic（宽容旧数据） |

## 变更点清单

### 1. Schema：`chat_message` 加 usage 三列

DDL（`chat-schema.ts`）的 `chat_message` CREATE TABLE 加：
```sql
prompt_tokens INTEGER,
completion_tokens INTEGER,
total_tokens INTEGER
```

ALIGN（`schema-column-alignments.ts`）加三条：
```ts
{ table: "chat_message", column: "prompt_tokens", addColumnSql: "ALTER TABLE chat_message ADD COLUMN prompt_tokens INTEGER" },
{ table: "chat_message", column: "completion_tokens", addColumnSql: "ALTER TABLE chat_message ADD COLUMN completion_tokens INTEGER" },
{ table: "chat_message", column: "total_tokens", addColumnSql: "ALTER TABLE chat_message ADD COLUMN total_tokens INTEGER" },
```

`SCHEMA_BOOT_VERSION` 4 → 5（DDL + ALIGN 变更必须 bump）。

不需要新建 schema migration——老消息 usage 为 NULL 是预期行为，靠 ALIGN 补列即可。

### 2. Domain model：`ChatMessage` 加 `usage?: MessageUsage`

新增 `packages/core/src/domain/chat/model/message-usage.ts`：
```ts
export interface MessageUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}
```

`ChatMessage` 加 `readonly usage?: MessageUsage`。

### 3. Repository：sqlite 读写适配

- `MESSAGE_SELECT_COLUMNS` 加 `prompt_tokens, completion_tokens, total_tokens`
- `rowToMessage`：三个列非 NULL 时组装 `usage` 对象（参照 `attachments` 的条件展开范式）
- `insert` SQL 加三列 + 绑定参数 `message.usage?.promptTokens ?? null` 等

### 4. Service：`MessageService.append` 加 usage

`append` 的 options 类型加 `usage?: MessageUsage`。构造 `ChatMessage` 时写入 `usage`（条件展开，参照 attachments）。

### 5. Agent session：`AgentSession` 接口 + 三个实现同步加 usage

agent-runner 调的是 `AgentSession` 接口（`packages/core/src/domain/agent/session/agent-session.port.ts` L29-33），不是具体实现，所以得从接口层开始往下改，不然 `session.append(..., { usage })` 在接口类型上就不合法。

改动顺序：

1. **端口层**：`agent-session.port.ts` 的 `append` options 类型从 `{ provider?, raw? }` 扩成 `{ provider?, raw?, usage?: MessageUsage }`。
2. **`ChatAgentSession`**（`service/agent/impl/chat-agent-session.ts`）：`append` options 同步加 usage，透传给 `MessageService.append`。
3. **`EphemeralOverlayAgentSession`**（`service/agent/impl/ephemeral-overlay-agent-session.ts`）：签名加 usage（不落库，但接口要一致，不然 TS 类型就报错了）。
4. **`InMemoryAgentSession`**（`domain/agent/session/impl/in-memory-agent-session.ts`）：测试用的内存实现也实现了 `AgentSession`，签名跟着改；构造的 `ChatMessage` 上挂 `usage` 字段，方便测试断言。

四个文件签名同时扩，避免出现「接口加了但某个实现没加」的编译错误。

### 6. Agent runner：传 usage 到 append

`agent-runner.ts:392-395` 改为：
```ts
assistantMessage = await session.append("assistant", { blocks: result.blocks }, {
  raw: result.raw as Record<string, unknown>,
  ...(result.usage != null ? { usage: result.usage } : {}),
});
```

`result.usage` 是 `LlmTokenUsage`（`{ promptTokens?, completionTokens?, totalTokens? }`），与 `MessageUsage` 形状一致，直接传入。

### 7. 回填逻辑：`resolveCurrentPromptTokens` cache miss 时读 DB

**回填接口设计**：`resolveCurrentPromptTokens` 当前签名是 `(sessionId, params)`，cache miss 后需要读 messages 列表。有两种方案：

**方案 A（推荐）**：新增独立回填函数 `backfillCacheFromMessages(sessionId, messages)`，在调用 `resolveCurrentPromptTokens` 之前先尝试回填。调用方（Desktop/Mobile 的 chat-prompt-tokens service）已经有 messages 或能快速拿到最后一条 assistant message 的 usage。

**方案 B**：`resolveCurrentPromptTokens` 加一个可选参数 `messages?: readonly ChatMessage[]`，miss 时从传入的 messages 回填。

推荐方案 A，因为 resolveCurrentPromptTokens 的调用方（compaction trigger）不一定有 messages，且回填逻辑独立后更清晰。

回填函数逻辑（注意 `!m.hidden` 过滤——被压缩隐藏掉的 assistant message 不算「当前可见 prompt」的一部分，它的 usage 对不上当前上下文，不能拿来回填）：
```ts
export function backfillCacheFromMessages(
  sessionId: string,
  messages: readonly ChatMessage[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      !msg.hidden &&
      msg.role === "assistant" &&
      msg.usage?.promptTokens != null
    ) {
      sessionApiPromptTokenCache.set(sessionId, {
        promptTokens: msg.usage.promptTokens,
        // 刻意用 msg.createdAtMs（该 usage 的产生时刻），与 run-time 路径写入的
        // Date.now()（写入时刻）语义不同——回填的是「历史值什么时候发生」、
        // run-time 是「这个值什么时候被进程记下」，不要混。
        updatedAt: msg.createdAtMs,
      });
      return true;
    }
  }
  return false;
}
```

**调用方伪代码**（Desktop `chat-prompt-tokens.service.ts` / Mobile 同名文件）：在 `resolveCurrentPromptTokens` miss 后先回填、再 resolve 一次。

注意 `resolveCurrentPromptTokens` 是 `async` 函数，伪代码里必须 `await`。

messages 来源：扩展 `SessionPromptInputBundle` 类型加 `readonly rawMessages: readonly ChatMessage[]`，让 `buildSessionPromptInput` 内部已有的 `allMessages` 局部变量直接挂到返回值上。`chat-prompt-tokens.service.ts` 主路径从 bundle 取 `rawMessages` 传给 `backfillCacheFromMessages`，复用同一次 `listBySession`，不另开查询。

```ts
const result = await resolveCurrentPromptTokens(sessionId, params);
if (result.source === "local") {
  // miss：用 buildSessionPromptInput 返回的 rawMessages 试回填
  const messages = bundle.rawMessages;
  if (backfillCacheFromMessages(sessionId, messages)) {
    // 回填命中后再 resolve 一次，这次会走 source=api
    return await resolveCurrentPromptTokens(sessionId, params);
  }
}
return result;
```

涉及的额外改动：

| 文件 | 改动 |
|------|------|
| `SessionPromptInputBundle` 类型定义（两端各自的 `session-prompt-input.service.ts`） | 加 `readonly rawMessages: readonly ChatMessage[]` |
| `buildSessionPromptInput` 实现（两端） | 内部 `allMessages` 局部变量挂到返回值 |
| `chat-prompt-tokens.service.ts`（两端） | 从 bundle 取 `rawMessages` 传给 `backfillCacheFromMessages`。注意：Desktop 主路径需把 bundle 整体透到 `CountArgs`（或在 `computeChatPromptTokenStats` 内保留 bundle 引用），因为当前骨架在解构 bundle 后的 `countFn` 闭包拿不到 bundle；Mobile 主路径需把解构改为保留 bundle 引用 |

compaction trigger 走 `resolveCurrentPromptTokens` 时没有 bundle，仍跳过回填直接走本地计数器（行为不变）。

### 8. Mobile 回滚后刷新

`useChatTabMessages.ts` 的 `runRollback` 成功分支，在 `reloadMessages(true)` 后补：
```ts
void refreshChatTokenLabel();
```

### 9. Desktop 抽屉回滚后刷新

**选定方案：复用现有 renderer 内 DOM CustomEvent 机制新增 `messages-rollback` 事件**（与 `session-compacted` 同一范式，不走主进程序事件总线）。`ConversationPanel.executeRollback` 成功后 dispatch 这个事件，`SessionDetailDrawer` 订阅后触发自己的 `reload()`。

事件名：`messages-rollback`
事件载体（DOM `CustomEvent.detail`）：`{ sessionId: string }`——与 `session-compacted` 保持同一形状，订阅方按 sessionId 过滤，避免别的会话抽屉误刷新。

发送方（`ConversationPanel.executeRollback` 成功分支）：
```ts
await reloadMessages();
if (!options?.skipVfsReconcile) {
  notifyWorkspaceMutated();
}
window.dispatchEvent(
  new CustomEvent("messages-rollback", { detail: { sessionId } }),
);
```

接收方（在 `SessionDetailDrawer.tsx` 新加一个 effect 订阅 `messages-rollback`，与 `ConversationPanel` 里的 `session-compacted` 范式对齐，但订阅位置不同）：
```ts
useEffect(() => {
  if (!open || sessionId == null) return;
  const handler = (e: Event) => {
    if ((e as CustomEvent<{ sessionId: string }>).detail?.sessionId === sessionId) {
      void reload();
    }
  };
  window.addEventListener("messages-rollback", handler);
  return () => window.removeEventListener("messages-rollback", handler);
}, [open, sessionId, reload]);
```

选这个方案是因为 `session-compacted` 已经在 `ConversationPanel` 里证明了这个 DOM 事件范式可行，改动范围最小、不涉及主进程 IPC；SessionDetailDrawer 原本就有 `reload()` 函数，接入零成本。

### 10. Token 标签 UI 映射优化

在 core 层新增统一映射函数（两端共用，避免逻辑重复）：

```ts
// packages/core/src/infra/tokenizer/logic/format-counter-kind-label.ts
export function formatCounterKindLabel(counterKind: string): string {
  if (counterKind === "api" || counterKind === "heuristic") return "自动";
  return counterKind; // tiktoken / claude / llama3 / mistral / ...
}
```

「自动」吸收了两种语义：API cache 命中（精确值）和 heuristic 估算兑底（字符比）。具体 tokenizer 名原样显示。

三处 UI 展示点套用映射：

| 端 | 文件 | 行 | 改动 |
|---|---|---|---|
| Desktop | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | 437-442 | `{tokenStats.counterKind}` → `{formatCounterKindLabel(tokenStats.counterKind)}` |
| Desktop | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | 41-53 | `formatChatTokenStatsLabel` 末尾套映射（deprecated 路径 + 测试同步） |
| Mobile | `apps/mobile/src/services/chat-prompt-tokens.service.ts` | 24-32 | `formatChatTokenLabel` 里 `${result.counterKind}` → `${formatCounterKindLabel(result.counterKind)}` |

相关测试同步更新：
- `apps/desktop/test/chat-prompt-tokens.test.ts` L83-87：`/· api$/` → `/· 自动$/`
- `apps/mobile/__tests__/chat-prompt-tokens.test.ts` L104-123：同上

### 11. 用户配置移除 heuristic 手动选项

`packages/core/src/domain/provider/model/token-counter-mode-options.ts` 定义了 `tokenCounterMode` 的可选值。当前为 `auto / heuristic / tiktoken / claude / gemma / llama3 / mistral`，对应中文文案「自动（按模型名匹配）/ 启发式估算 / Tiktoken（OpenAI 等）/ ...」。

改动：从可选值列表中移除 `heuristic` 条目及文案。

旧数据兼容——归一化位置选在 **`parseTokenCounterModePref`**（`packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts:40-50`）这一层，而不是 `resolveTokenCounterModeForModel`。原因是 Desktop / Mobile 的 savedModel 编辑 UI 直接读 `internal.tokenCounterMode` 展示在下拉里，这条读取链路不经过 `resolveTokenCounterModeForModel`（后者只在本地计数器实际命中时要 override 才用上），如果归一化放后面，旧 savedModel 加载时下拉还是会停在「启发式估算」这个已经删掉的选项上，UI 就空了。

`parseTokenCounterModePref` 现有逻辑（`raw === "heuristic"` 时返回 `"heuristic"`）改成返回 `"auto"`，这样无论是 UI 直读、还是 resolve 链路拿到的都是归一化后的值，全链路一致。

`VALID_FAMILIES`（`read-token-counter-mode-pref.ts:15-32`）**保留** `"heuristic"` 条目不动——它是 schema/patch 校验用的宽容集，老数据存着 `"heuristic"` 时 `isValidTokenCounterModePref` 不能直接报「非法字段」把存档拒掉，只在解析阶段默默归一化就好。

`TokenizerOverride` 类型（`resolve-tokenizer-family.ts:30` 含 `"heuristic"`，L42-44 显式处理）**保留** `"heuristic"` 分支不动，向后兼容（运行时实际不会再从用户选择产生这个值，但既有 savedModel 反序列化路径还可能读到，删了反而会炸类型）。文档里注明：该分支以后不会再从用户手动选择产生，仅为旧数据保留。

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/provider/model/token-counter-mode-options.ts` | 可选值列表移除 `heuristic` 及其文案条目 |
| `packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts` | `parseTokenCounterModePref` 中 `raw === "heuristic"` 分支返回值从 `"heuristic"` 改为 `"auto"`；`VALID_FAMILIES` 保留 `"heuristic"` 不动 |
| `packages/core/src/service/provider/logic/resolve-token-counter-mode-for-model.ts` | 不改动（归一化职责上提到 parse 层，这里拿到的 raw 已经是归一化后的值） |
| `packages/core/src/infra/tokenizer/logic/resolve-tokenizer-family.ts` | 不改动（`TokenizerOverride` 类型的 `"heuristic"` 分支保留，向后兼容；文档注明不会再从用户选择产生） |

Desktop/Mobile 的 savedModel 编辑 UI 如果直接消费 `token-counter-mode-options.ts` 的可选值列表，则无需额外改动（选项自动少一条）。如果 UI 硬编码了列表，则需同步删。

## 详细实现步骤

- **Step 1 — phase-schema-usage-columns — blocking: yes — qa: auto**：`chat-schema.ts` DDL 加三列；`schema-column-alignments.ts` 加三条 ALIGN；`novel-master-bootstrap.ts` `SCHEMA_BOOT_VERSION` 4 → 5。

- **Step 2 — phase-domain-message-usage — blocking: yes — qa: auto**：新建 `message-usage.ts`（`MessageUsage` 类型）；`message.ts` 的 `ChatMessage` 加 `usage?: MessageUsage`。

- **Step 3 — phase-repo-usage-mapping — blocking: yes — qa: auto**：`sqlite-message.repository.ts`：`MESSAGE_SELECT_COLUMNS` 加三列；`rowToMessage` 条件展开 usage；`insert` SQL + 绑定加三列。

- **Step 4 — phase-service-append-usage — blocking: yes — qa: auto**：`message.port.ts` 的 `append` options 加 `usage?: MessageUsage`；`message.service.ts` 的 `append` 实现把 usage 写入 message 对象。

- **Step 5 — phase-agent-session-usage — blocking: yes — qa: auto**：`agent-session.port.ts` 接口 `append` options 加 `usage?: MessageUsage`；三个实现同步对齐——`chat-agent-session.ts`、`ephemeral-overlay-agent-session.ts` 透传 usage，`in-memory-agent-session.ts` 签名 + 内存消息体挂 usage 字段。

- **Step 6 — phase-agent-runner-write-usage — blocking: yes — qa: auto**：`agent-runner.ts:392-395` 调 `session.append` 时传入 `result.usage`。

- **Step 7 — phase-cache-backfill — blocking: yes — qa: auto**：新增 `backfillCacheFromMessages(sessionId, messages)` 函数（过滤 `!msg.hidden`）；两端 `SessionPromptInputBundle` 加 `rawMessages: readonly ChatMessage[]`，`buildSessionPromptInput` 内部 `allMessages` 挂到返回值；Desktop/Mobile 的 `chat-prompt-tokens.service.ts` 在 `await resolveCurrentPromptTokens` miss 后从 `bundle.rawMessages` 回填再 `await resolveCurrentPromptTokens`。

- **Step 8 — phase-mobile-rollback-refresh — blocking: yes — qa: manual_user**：`useChatTabMessages.ts` 的 `runRollback` 成功分支补 `refreshChatTokenLabel()`。

- **Step 9 — phase-desktop-drawer-rollback-refresh — blocking: yes — qa: manual_user**：`ConversationPanel.executeRollback` 成功后 `window.dispatchEvent(new CustomEvent("messages-rollback", { detail: { sessionId } }))`；`SessionDetailDrawer.tsx` 新增 effect 订阅 `messages-rollback`（按 sessionId 过滤），命中后调 `reload()`。事件名与 payload 形状与现有 `session-compacted` 对齐。
- **Step 10 — phase-token-label-ui — blocking: no — qa: auto**：core 新增 `formatCounterKindLabel`；Desktop `SessionDetailDrawer.tsx` + `chat-prompt-tokens.service.ts` 套映射；Mobile `chat-prompt-tokens.service.ts` 套映射；两端测试同步更新。
- **Step 11 — phase-remove-heuristic-option — blocking: no — qa: auto**：`token-counter-mode-options.ts` 移除 `heuristic` 条目；`read-token-counter-mode-pref.ts` 的 `parseTokenCounterModePref` 把 `raw === "heuristic"` 归一化为 `"auto"`（`VALID_FAMILIES` 与 `TokenizerOverride` 保留 heuristic 兼容分支）；相关测试同步更新。

## 测试策略

### 测试用例

- **T-S1 — blocking: yes**（→ Step 1-3）：新建库 + 老库升版，`chat_message` 有三个 usage 列；INSERT assistant message 带 usage 后 SELECT 能读回。
- **T-S2 — blocking: yes**（→ Step 4-6）：`agent-runner` 的 assistant append 带 `result.usage`；多 round tool-call 每条 assistant 各自带 usage；`result.usage` 为 undefined 时不传 usage（兼容）。
- **T-S3 — blocking: yes**（→ Step 7）：`backfillCacheFromMessages` 从 messages 末尾往前找最后一条「非 hidden 且带 usage」的 assistant message 回填 cache；没有任何符合条件的 message 时返回 false；含 hidden 的 assistant message 即使其 usage 存在也会被跳过。
- **T-S4 — blocking: yes**（→ Step 7）：cache miss + 回填成功后，`resolveCurrentPromptTokens` 返回 `source=api`。
- **T-S5 — blocking: yes**（→ Step 8）：Mobile 回滚成功后 `refreshChatTokenLabel` 被调用（对比改动前未被调用）。
- **T-S6 — blocking: no**（→ Step 9）：Desktop `executeRollback` 成功后会 dispatch `window` 上的 `messages-rollback` CustomEvent（`detail.sessionId` 等于当前会话）；打开的 `SessionDetailDrawer` 订阅该事件后 token 计数刷新（断言 reload 被调一次，且别的 sessionId 不会触发）。
- **T-S7 — blocking: no**（→ Step 10）：`formatCounterKindLabel("api")` 返回「自动」；`formatCounterKindLabel("heuristic")` 返回「自动」；`formatCounterKindLabel("tiktoken")` 返回「tiktoken」。Desktop/Mobile 的 token label 在 `source=api` 时显示「· 自动」。
- **T-S8 — blocking: no**（→ Step 11）：`token-counter-mode-options.ts` 不含 `heuristic`；`parseTokenCounterModePref("heuristic")` 返回 `"auto"`；`isValidTokenCounterModePref("heuristic")` 仍返回 true（`VALID_FAMILIES` 保留）；`TokenizerOverride` 类型保留 `"heuristic"` 分支不炸类型。

### 手动验收

- Step 8-9：回滚后顶栏/抽屉 token 计数立即更新为 API 值（录屏验收）。
- 回滚到 tool-call 中间 round，token 计数对应该轮 message 的 usage.promptTokens。
- 重启 app 后打开有 usage 历史的会话，token 计数从 DB 回填。

## 兼容性或迁移说明

- **老消息无 usage**：ALIGN 补列后老消息的三个 usage 列为 NULL，`rowToMessage` 不展开 `usage` 字段。回填时跳过，跌到本地计数器。这是预期行为。
- **`SCHEMA_BOOT_VERSION` 4 → 5**：已升版的老库（user_version=4）会走慢路径重建 DDL + ALIGN，确保新列存在。
- **fork 路径**：`message.service.ts` fork 时 spread `msg`，天然带 usage；repo INSERT 已支持 usage 列。
- **`EphemeralOverlayAgentSession`**：签名加 usage 但不落库（ephemeral 消息不持久化），接口一致性改动。
- **`InMemoryAgentSession`**：测试用内存实现，签名对齐接口；消息体上挂 usage 字段方便测试断言。

## 风险与回滚方案

### 风险

1. **回填的 promptTokens 口径**：历史 message 的 promptTokens 是那条 message 被生成时的 prompt 大小。如果回滚后用户又编辑/删除了消息，当前可见 prompt 已经不同，回填值是"最近似值"而非绝对精确。只有下一次 completed run 才会刷新为真正的当前值。这与 PRD「风险与待确认项」一致。

2. **`resolveCurrentPromptTokens` 调用方的 messages 可得性**：回填需要调用方提供 messages。Desktop/Mobile 的 chat-prompt-tokens service 在加载会话时已有 messages 或可快速查最后一条 assistant message。compaction trigger 走 `resolveCurrentPromptTokens` 时如果 cache miss 且无 messages，仍跌到本地计数器（行为不变）。

3. **Desktop SessionDetailDrawer 刷新方案**：选定走 renderer 内 DOM CustomEvent（`messages-rollback`），跟现有 `session-compacted` 同范式。如果某些环境下 `window.dispatchEvent` 时序不对（例如回滚 IPC 还没真正落库就先发了事件），退路是在 `executeRollback` 内 await 完 `reloadMessages` 之后再 dispatch，保证订阅方拿到的已经是最新消息列表后的状态。

### 回滚方案

- Schema 改动是加列（非破坏性），回滚只需 `SCHEMA_BOOT_VERSION` 改回 + 删 ALIGN 条目（老列保留无害）。
- Usage 字段是可选的，回滚 domain model 改动不影响已有数据。
- UI 刷新修复是独立的两处补丁，git revert 即可。
