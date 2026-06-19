---
date: 2026-06-19
related:
  - ./research.md
  - ./prd.md
  - ../mobile-stream-display-pacing/spec.md
  - ../mobile-webview-chat-transcript/spec.md
---

# Mobile 聊天列表显示重写 — 技术规格（SPEC）

## 设计目标

1. **消除 freeze 根因**：单 RN runtime 流式更新 message parts；禁止 WebView 流式 bridge。
2. **库优先**：`@assistant-ui/react-native`（spike 首选）承担 chat 列表；自研仅 adapter + custom renderer。
3. **最小侵入 core**：继续 `LlmStreamEvent` + `EVENT_AGENT_STREAM_*`；adapter 订阅 Bus，不改 agent runner。
4. **复用现网业务**：`useChatTabMessages`、`buildMessageActionItems`、`handleMessageMenuAction`、Batch、Composer 壳保留。
5. **消息菜单简化**：⋮ 按钮替代长按/Web DOM menu；去掉 `menu-overlay-guards`、Web `contextmenu` 链。

---

## 现状与代码约束（探索结论）

### 当前数据流（待移除的流式路径）

```text
ChatComposer
  → runtime.bus.subscribe(EVENT_AGENT_STREAM_TEXT_DELTA | THINKING_DELTA)
  → onStreamText / onStreamThinking (ChatTabScreen props)
  → useChatTabStream (745 行)
      → StreamDisplayPacer FIFO + textPhaseActive + deferred thinking
      → ChatTranscriptWebView.pushStreamDeltaBatch → WebView main.ts
```

相关文件：

| 模块 | 路径 | 职责 |
|------|------|------|
| 流式编排 | `apps/mobile/src/screens/tabs/chat-tab/useChatTabStream.ts` | pacer、Web bridge、telemetry |
| Web transcript | `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | WebView 容器 + bridge handler |
| Web DOM | `apps/mobile/src/web/chat-transcript/main.ts` | 行渲染、流式 tail、**长按菜单 DOM** |
| 消息映射 | `apps/mobile/src/components/chat/message-blocks.ts` | `buildChatListItems` / `user_vfs_turn` |
| Composer 流订阅 | `apps/mobile/src/components/chat/ChatComposer.tsx` | Bus → `onStreamText/Thinking` |
| 菜单业务 | `apps/mobile/src/components/chat/message-edit.ts` | `buildMessageActionItems` |
| 菜单动作 | `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | `handleMessageMenuAction` |
| 菜单 UI | `apps/mobile/src/components/chat/MessageActionMenu.tsx` | 锚定弹出层（可复用） |
| 屏幕编排 | `apps/mobile/src/screens/tabs/ChatTabScreen.tsx` | 双引擎 flag、`messageMenuTarget` |
| core 事件 | `packages/core/.../agent-runner.ts` | `LlmStreamEvent` → Bus publish |

### 长按菜单现状（本迭代废弃）

- **WebView**：`main.ts` 内 touch long-press + `buildMenuItems` + `menu-overlay-guards.ts`（防 scroll/选区冲突）— 复杂且与滚动耦合。
- **Legacy RN**：`MessageList` → `MessageLongPressRow` → `measureInWindow` 锚定 `MessageActionMenu`。
- **双轨**：`useWebviewMessageMenu={!useWebviewTranscript}`（`ChatConversationPanel.tsx` L458）。

**结论**：库 + 原生 RN 列表下，**⋮ 按钮 + 现有 `MessageActionMenu`** 可删除整段 Web 菜单与 long-press 手势链；业务逻辑不变。

### core 流事件（adapter 输入）

```typescript
// packages/core/src/infra/llm-protocol/ports/adapter.port.ts
type LlmStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'thinking-delta'; delta: string }
  | { type: 'tool-use'; ... }
  | { type: 'done' };
```

Bus topics：`EVENT_AGENT_STREAM_TEXT_DELTA`、`THINKING_DELTA`、`TOOL_USE`（`ChatComposer` 已订阅 text/thinking）。

---

## 总体方案

```text
packages/core/                         # 不变
       │
       ▼ EventBus (STREAM_*)
apps/mobile/src/components/chat/
  adapter/
    llm-stream-to-parts.ts             # 纯函数 reducer + 单测
    use-chat-library-runtime.ts        # 订阅 Bus → 更新库 runtime / messages
    map-session-messages.ts            # ChatMessage[] → 库 thread（含 vfs turn）
  renderers/
    UserVfsTurnRow.tsx                 # user_vfs_turn 静态卡
    MessageMoreButton.tsx              # ⋯ → MessageActionMenu
    NovelToolFallback.tsx              # tools.by_name / Fallback
  ChatLibraryTranscript.tsx            # spike 后主列表（包库 Conversation）
       │
       ▼
ChatTabScreen / ChatConversationPanel  # transcript 区换 ChatLibraryTranscript
  Composer / Batch / Modal 不动
```

**Composer 接线变更（目标态）**

- 移除 `onStreamText` / `onStreamThinking` / `onStreamReset` 经 `useChatTabStream` 到 WebView 的链路。
- adapter 在 `ChatLibraryTranscript`（或同级 Provider）内 **直接订阅 Bus**；`ChatComposer` 可保留 callback 仅用于 `agentRunning` / flush UI，或逐步改为只依赖 Bus + `EVENT_AGENT_RUN_FINISHED`。

---

## 最终项目结构（新增/改动）

```text
apps/mobile/src/components/chat/
  adapter/                              # 新建
    llm-stream-to-parts.ts
    llm-stream-to-parts.test.ts
    map-session-messages.ts
    map-session-messages.test.ts
    use-chat-library-runtime.ts
  renderers/                            # 新建
    UserVfsTurnRow.tsx
    MessageMoreButton.tsx
    NovelToolFallback.tsx
  ChatLibraryTranscript.tsx             # 新建（spike 后落地）

apps/mobile/src/storage/
  chat-transcript-engine.ts             # 改：加 'library'；默认 spike 通过后 library

apps/mobile/src/screens/tabs/chat-tab/
  useChatTabStream.ts                   # 删除或仅 legacy-rn 保留至 M4
  ChatConversationPanel.tsx             # transcript 三分支 → library | webview(暂) | legacy

# 迁移完成后删除
apps/mobile/src/web/chat-transcript/    # 整目录（含 main.ts 长按菜单）
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
apps/mobile/src/services/stream-display-pacer.service.ts
apps/mobile/src/web/chat-transcript/menu-overlay-guards.ts
```

---

## 变更点清单

| 项 | 操作 | 说明 |
|----|------|------|
| `@assistant-ui/react-native` | 新增依赖 | spike 首选；不通过再试 rn-ai-elements |
| `llm-stream-to-parts.ts` | 新建 | `LlmStreamEvent[]` → parts reducer |
| `use-chat-library-runtime.ts` | 新建 | Bus 订阅 + 库 LocalRuntime |
| `ChatLibraryTranscript.tsx` | 新建 | 库列表 + custom renderers |
| `MessageMoreButton.tsx` | 新建 | ⋯ → `MessageActionMenu` |
| `message-edit.ts` | 保留 | `buildMessageActionItems` 不变 |
| `useChatTabMessages.ts` | 保留 | `handleMessageMenuAction` 不变 |
| `useChatTabStream.ts` | 删除/降级 | library 路径不引用 |
| WebView 流式 / pacer | 删除 | 见 [research.md](./research.md) §2.4 |
| e2e `longPressMessage` | 改 | `tapMessageMore` + `tapMenuAction` |

---

## 库选型（spike 门禁）

| 候选 | 接入方式 |
|------|----------|
| **`@assistant-ui/react-native`**（首选） | `useLocalRuntime` + Custom Backend；`MessagePrimitive.Parts` 覆写 |
| **`@crafter/rn-ai-elements`**（备选） | 喂 `messages`；禁止 `useChat` 双 agent |

Spike 通过：mock SSE 真机无 freeze + markdown 可读 + 贴底可接受。

---

## Adapter 契约

### 输入

- Bus：`EVENT_AGENT_STREAM_TEXT_DELTA`、`THINKING_DELTA`、`TOOL_USE`
- `EVENT_AGENT_STEP_COMMITTED` / `RUN_FINISHED` → reset 流式 tail、刷新 `useChatTabMessages`

### 输出（库 parts 语义）

| 事件 | part |
|------|------|
| `thinking-delta` | `reasoning`（streaming） |
| `text-delta` | `text`（markdown stream） |
| `tool-use` | `tool-call` |
| `done` / step commit | turn 结束，清 tail |

规则：单 assistant turn、wire 顺序 append；禁止双 channel 显示状态。

### 历史映射 `map-session-messages.ts`

- 复用 `buildChatListItems` 逻辑（或薄包装）。
- `user_vfs_turn` → 列表 wrapper 插 `UserVfsTurnRow`，**不**映射为 tool-call。
- `tool_result`-only user 行：继续隐藏。

---

## 自定义 renderer

### `user_vfs_turn`

- 静态 RN 组件；复用 `buildUserVfsTurnView` 数据。
- 实现：**FlatList/库列表外层** `renderItem` 分支，或 assistant-ui custom data part。

### Tool 卡

- 默认库 ToolFallback；`NovelToolFallback.tsx` + `tools.by_name` 覆写。

### 消息 ⋯ 菜单（替代长按）

**组件**：`MessageMoreButton.tsx`

```text
Pressable (⋯) onPress
  → measureInWindow → MessageMenuAnchor
  → MessageActionMenu visible
  → onSelect → handleMessageMenuAction(message, action)
```

| 条件 | 行为 |
|------|------|
| `agentRunning` | 不渲染 ⋯（对齐现网 `onMessageLongPress` 早退） |
| `messageBatch.active` | 不渲染 ⋯；行内 checkbox/点选（现网 Batch） |
| `hidden` 消息 | 不渲染 ⋯ |
| 流式 tail（进行中 assistant） | 不渲染 ⋯ 或仅历史 completed 消息显示 |

**可删除**（library 路径）：`menu-overlay-guards.ts`、Web `buildMenuItems`、long-press touch 链、`webMenuOpen` / `webMenuCloseSignal` 状态（`ChatTabScreen`）。

**保留**：`MessageActionMenu.tsx`、`anchored-menu-layout.ts`（锚点可改为按钮右下角固定偏移，无需气泡 measure）。

---

## 兼容性与迁移

| 阶段 | `chatTranscriptEngine` | 说明 |
|------|------------------------|------|
| M0 spike | — | 独立 screen 或 dev 入口 |
| M1 | `library`（dev 默认） | 与 `webview` 并存 |
| M2 | `library`（prod 默认） | 移除 WebView 流式 |
| M3 | 仅 `library` | 删 WebView transcript、`useChatTabStream` |

滚动缓存：沿用 `chat-list-scroll-cache` / 库列表 offset API；**不**迁移 Web v2 snapshot。

Rich text：流式期库 markdown；commit 后历史由库渲染 completed message（对齐现网「流式 plain/rich → 落库 rich」语义，实现随库）。

---

## 详细实现步骤

### Step 0 — Spike（阻塞后续）

1. `npm i @assistant-ui/react-native`（及 peer）。
2. 新建 `apps/mobile/src/screens/dev/ChatLibrarySpikeScreen.tsx`：mock `LlmStreamEvent` 发生器 → adapter → 库 UI。
3. 真机验收：10min freeze、thinking+text+tool、markdown。
4. 不通过 → 换 rn-ai-elements 重复；仍不通过 → 停止合主路径。

### Step 1 — Adapter 纯函数

1. `llm-stream-to-parts.ts` + Jest 快照（thinking→text→交错→tool→done）。
2. `map-session-messages.ts` + 复用 `build-transcript-rows` 夹具。

### Step 2 — `ChatLibraryTranscript` 最小接入

1. `ChatLibraryTranscript.tsx`：`messages` + `use-chat-library-runtime`。
2. `UserVfsTurnRow`、`NovelToolFallback`、`MessageMoreButton`。
3. `ChatConversationPanel`：`engine === 'library'` 分支替换 `ChatTranscriptWebView`。
4. `ChatTabScreen`：菜单 state 简化为单轨（去掉 `webMenuOpen`）。

### Step 3 — 接真 Bus + Composer

1. adapter 订阅 `EVENT_AGENT_STREAM_*`；移除 WebView `pushStreamDeltaBatch` 调用链。
2. `flush-run-ui` / step commit 后 `reloadMessages` 与现网一致。
3. 删除或 `#if legacy` 包裹 `useChatTabStream` 的 WebView 分支。

### Step 4 — 清理

1. 删 `stream-display-pacer.service.ts`、Web 流式 main.ts 相关、Android `StreamWebLog*`（若仅观测用）。
2. 更新 e2e：`chat.rollback*.e2e.ts` 改 ⋯ 入口。
3. `chat-transcript-engine.ts` 默认 `library`。

---

## 测试策略

### 单元测试

| 文件 | 用例 |
|------|------|
| `llm-stream-to-parts.test.ts` | 全事件序列 parts 快照；交错 thinking；tool-use |
| `map-session-messages.test.ts` | user/assistant/vfs_turn/tool 映射 |
| `message-edit.test.ts` | 已有；`buildMessageActionItems` 回归 |

### 组件测试

- `MessageMoreButton`：press → menu items；`agentRunning` 不渲染。
- `ChatLibraryTranscript` smoke：mock runtime + 固定 messages。

### 集成 / 真机

| ID | Given | When | Then |
|----|-------|------|------|
| T-freeze | mock SSE fixture | 真机 10min replay | 无 freeze |
| T-menu | 静态会话 | 点 ⋯ → 回滚 | 与现网 rollback 一致 |
| T-menu-run | agent 运行 | — | 无 ⋯ |
| T-vfs | 含 vfs turn | 打开会话 | `UserVfsTurnRow` 可见 |
| T-prepend | 长会话 | 加载更早 | 滚动位置稳定（抽测） |
| T-batch | Batch 模式 | 点行 | 选择切换，无 ⋯ |

### E2E 改动

- `e2e/pages/chat-transcript.page.ts`：`tapMessageMore(messageId)` 替代 `longPressMessage`。
- 删除 WebView long-press 选择器依赖。

---

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 库在 RN 0.85 / Hermes 下有 bug | spike 门禁；备选 rn-ai-elements |
| 库 markdown 性能不足 | spike 测长文；必要时加 streamdown 仅作 Text renderer |
| 贴底/prepend 回归 | 抽测 + 可选 `react-native-streaming-message-list` |
| adapter 与 Composer 双订阅 Bus | 单模块订阅（`use-chat-library-runtime`），Composer 逐步去掉 stream callback |

**回滚**：`chatTranscriptEngine = 'webview'` 切回 `feature/mobile-stream-display-pacing` 留存实现；不改 core。

---

## 废弃与 supersede

| 模块 | 处置 |
|------|------|
| WebView 流式 / pacer / `textPhaseActive` | 删除 |
| Web 长按菜单 DOM | 删除 |
| `mobile-stream-display-pacing` bug「已修」 | superseded by 本迭代 |
| RN `MessageLongPressRow`（legacy 列表） | 随 legacy-rn 移除 |

---

## Phase 2（非阻塞）

- Desktop assistant-ui web + 共享 `llm-stream-to-parts`（可抽 `packages/chat-stream-parts`）。
- `MessageActionMenu` → `@gorhom/bottom-sheet` 全屏底部菜单（可选 UX 优化）。

---

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/spec.md`
