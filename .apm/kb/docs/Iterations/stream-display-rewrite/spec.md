---
date: 2026-06-19
updated: 2026-06-19
related:
  - ./research.md
  - ./prd.md
  - ../mobile-webview-chat-transcript/spec.md
---

# Mobile 聊天列表显示重写 — 技术规格（SPEC）

> **代码基线**：`main`（**非** `feature/mobile-stream-display-pacing`）。  
> **实现分支**：从 `main` 拉出 `feature/stream-display-rewrite`。

## 设计目标

1. 单 RN runtime 流式 parts；禁止 chat WebView 流式 bridge。
2. 库优先（`@assistant-ui/react-native` spike 首选）；自研 adapter + custom renderer。
3. **外部 state 驱动库**（见 §Runtime 集成）——**不用** `ChatModelAdapter.run()` 替代 core agent。
4. 复用 `useChatTabMessages`、Composer `runAgentTurn`、`flush-run-ui` 语义。
5. ⋯ 菜单替代长按。

---

## 现状与代码约束（main）

### main vs pacing feature（摘要）

| 项 | **main** | pacing feature（留存，不实现） |
|----|----------|--------------------------------|
| `useChatTabStream` | ~260 行，streamBuffer 64ms | ~745 行，pacer |
| Web API | `pushStreamDelta` | `pushStreamDeltaBatch` |
| TOOL_USE 订阅 | **mobile 无**（desktop 有 `useAgentStream`） | 同左 |

### main 现网 Agent 链路（须对齐）

```text
ChatComposer.executeRun → runAgentTurn(core)
  → Bus: STREAM_TEXT | STREAM_THINKING（Composer 订阅 → onStreamText/Thinking）
  → Bus: STEP_COMMITTED → flushAgentStepUi(reload, reset)  // assistant 相 reset
  → Bus: RUN_FINISHED → flushRunUi(reload, reset)
useChatTabMessages.reloadMessages → DB ChatMessage[]
useChatTabStream → WebView pushStreamDelta（待移除）
```

参考：`flush-run-ui.ts`、`ChatComposer.tsx` L86–141；desktop 对标 `useAgentStream.ts`（含 TOOL_USE）。

### 相关文件

见上一版表格；另 **`useStreamToolInvoking`**：启发式「工具调用中」条（非 Bus TOOL_USE），library 路径 **M1 废弃**（改 tool-call part，§Tool）。

---

## Runtime 集成模型（已定，高优先级）

### 不用什么

| 模式 | 为何不用 |
|------|----------|
| `useLocalRuntime` + `ChatModelAdapter.run()` | Novel Master agent 在 **core**（`runAgentTurn`），不是库内发 HTTP/SSE |
| `useChat` / `@ai-sdk/react` 作 agent | 双 agent；与 core 冲突 |
| adapter「订阅 Bus → 直接喂 LocalRuntime 内部 thread」未文档化 API | 易与库内部 send 流程打架 |

### 采用什么

**`useExternalStoreRuntime`**（RN 包 API 与 web 对齐，见 [External Store 文档](https://www.assistant-ui.com/docs/runtimes/custom/external-store)）：

```text
useChatTabMessages.chatMessages          ─┐
streamingTurn (内存 parts，见 §状态机)      ├─► map-session-messages
                                           │       └─► ThreadMessageLike[]
useExternalStoreRuntime({                  │
  messages,                               │
  isRunning: agentRunning,                │
  convertMessage,                         │
  onNew: undefined 或 no-op,              │  // 发送仍走 ChatComposer，不经库 onNew
})                                        │
AssistantRuntimeProvider + 库 Thread UI  ◄┘
```

| 字段 | 来源 |
|------|------|
| `messages` | `convertSessionToThreadMessages(chatMessages, streamingTurn, options)` |
| `isRunning` | `agentRunning`（Composer `onRunningChange`） |
| `convertMessage` | `map-session-messages.ts`：DB 行 / vfs turn / 虚拟 tail |
| `onNew` | **不提供**（或 throw）；用户发送仅经 Composer |
| `setMessages` | **不提供**（无库内 branch / 库内编辑） |

**`setMessages` 缺失（Spike 验证）**：Novel Master 为只读 External Store（发送/编辑/回滚走 Composer 与 ⋯）。Spike 须确认：

- 库在缺 `setMessages` 时 **无** console warn 或 UI 能力误禁用（如误显示「不可编辑 thread」）。
- 若库要求 `setMessages` 才启用某 UI，文档记录 **workaround**（no-op `setMessages` 或 fork renderer）。

**Provider 挂载点**：`ChatLibraryTranscript` 或 `ChatLibraryRuntimeProvider` 包裹 transcript 区，**不**包裹 Composer。

**rn-ai-elements 备选**：若无等价 External Store API，则「自管 messages 数组 + 库 Presentational 组件」；spike 必须验证，否则不选。

---

## Bus 订阅所有权（已定：方案 A）

### 问题

main 上 **ChatComposer** 订阅 STREAM / STEP / RUN，并经 props 回调到 `useChatTabStream` 与 `reloadMessages`。若 library 路径 **Composer 与 `useChatLibraryRuntime` 各订一遍** → **双份 stream 更新** 或 **双份 reloadMessages**（同一步 assistant commit 触发两次 `flushAgentStepUi` 语义）。

### 方案 A（采用）— library 引擎 Bus 表

| 订阅者 | 事件 | library 行为 |
|--------|------|--------------|
| **`useChatLibraryRuntime`** | `STREAM_TEXT`、`STREAM_THINKING`、`STREAM_TOOL_USE` | coalesce → 更新 `streamingTurn` parts |
| **`useChatLibraryRuntime`** | `STEP_COMMITTED`、`RUN_FINISHED`、`RUN_FAILED` | **唯一**处理 flush：`reloadMessages` + tail 状态机（§状态机）；然后调用上层 `onStepCommitted` / `onRunFinished` / `onRunFailed`（如 `vfsMutated` → `bumpVfsRefresh`） |
| **ChatComposer**（library） | STREAM / STEP / RUN / RUN_FAILED | **不订阅**（Step 4 去掉全部 Bus effect） |
| **ChatComposer**（library） | `executeRun` 开头 | 调 props **`onStreamReset`** → 接到 runtime **同步清 tail**（不依赖 Bus） |
| **ChatComposer**（library） | `executeRun` / abort / error | 仅 **`onRunningChange(true/false)`**；**不**直接 `reloadMessages` / `flushRunUi` |
| **ChatComposer**（library） | `executeRun` **catch** | **仅** `setError`；**禁止** `flushRunUi`（§错误路径） |
| **ChatComposer**（webview / legacy） | 现网四路订阅 + catch 内 `flushRunUi` | 不变至 M3 |

**`flushAgentStepUi` / `flushRunUi` 归属**：library 路径由 **`useChatLibraryRuntime` 内联同等语义**（reload → 按 phase 清 tail），**不再**经 Composer Bus 或 catch 触发。

### 错误路径：`RUN_FAILED` vs `executeRun` catch（写死）

core 在 run 失败时 **先** `bus.publish(RUN_FAILED)` **再** `throw`（`agent-runner.ts`）。现网 Composer catch 另有 `await flushRunUi(reload, reset)`。

library 路径若只去 Bus、**保留** catch flush → **仅 error 路径双 reload**（成功靠 `RUN_FINISHED`；取消多走 `RUN_FINISHED`）。

| 路径 | 谁 flush |
|------|----------|
| 成功 | runtime `RUN_FINISHED` |
| 取消 / abort（若仍发 `RUN_FINISHED`） | runtime `RUN_FINISHED` |
| **失败（throw）** | runtime **`RUN_FAILED` 唯一**；Composer catch **只** `setError` |

```typescript
// library executeRun catch（示意）
} catch (err) {
  setError(formatError(err));
  // 不 flushRunUi — RUN_FAILED handler 已 reload + clearTail
} finally {
  onRunningChange(false);
}
```

runtime `RUN_FAILED`：同 `flushRunUi` → `reloadMessages` → clear tail → `onRunFailed?.(payload)`。可选 `flushInFlight` 防同 session 连发；单测 `T-error-flush`。

**接线（ChatTabScreen）**：

```text
engine === 'library':
  useChatLibraryRuntime({ reloadMessages, onStepCommitted, onRunFinished, ... })
    → 暴露 agentRunning, streamMetricsAccRef, clearTail(onStreamReset)
  不调用 useChatTabStream（或仅 webview/legacy 分支调用）
  ChatComposer: onStreamReset → runtime.clearTail
                onRunningChange → runtime.setAgentRunning
                不传 onStreamText/Thinking；Composer 无 Bus 订阅
```

### agentRunning 归属（写死，避免旁路悬空）

| 引擎 | `agentRunning` 来源 |
|------|---------------------|
| **library** | **`useChatLibraryRuntime`** 内部 state；Composer 只调 `onRunningChange` 写入 |
| webview / legacy | 现网 `useChatTabStream.agentRunning` |

`ChatTabScreen` 在 library 路径 **不得**再读 `stream.agentRunning`（`useChatTabStream` 未挂载时悬空）。统一：

```typescript
const library = useChatLibraryRuntime(...); // library 引擎
const legacyStream = useChatTabStream(...);  // 仅 webview/legacy
const agentRunning = engine === 'library' ? library.agentRunning : legacyStream.agentRunning;
```

`toolInvoking`：library 路径 **无**（已废弃）；webview/legacy 保持至 M3。

### 方案 B（不采用）

Composer 保留 Bus → props → runtime：STREAM 与 STEP/RUN 均易双份。

---

## Tool 流式策略（已定）

| 问题 | 决策 |
|------|------|
| main mobile 未订阅 `EVENT_AGENT_STREAM_TOOL_USE` | library 路径 **新增订阅**（对齐 desktop `useAgentStream`） |
| 流式 tool UI | `STREAM_TOOL_USE` → streamingTurn 追加 `tool-call` part（status: running）→ `NovelToolFallback` |
| commit 后 | `reloadMessages` → 历史消息内 tool 来自 DB（`buildChatListItems` 已有 tool 卡）→ **tail 清空**，避免双气泡 |
| `useStreamToolInvoking` | library 路径 **M1 移除**；不再显示启发式「工具调用中」条 |
| tool result 仅 user 行 | 继续隐藏；映射逻辑与 `message-blocks` 一致 |

Spike 需含 **tool 流式 fixture**（至少 name + input 出现在 tail）。

---

## 流式 tail 生命周期（状态机）

### 状态

| 状态 | 含义 |
|------|------|
| `idle` | 无 `streamingTurn` |
| `streaming` | `streamingTurn.parts` 随 Bus delta 增长 |
| `flushing` | `reloadMessages` in-flight；tail 暂保留至 reload 完成（避免空白闪） |

### 事件表

| 事件 | 动作 |
|------|------|
| `executeRun` 开始 | Composer 调 `onStreamReset` → runtime 清 tail；`onRunningChange(true)` |
| `STREAM_*` delta | runtime：coalesce → `streamingTurn`；**Apply 层**见下节 |
| `STEP_COMMITTED` phase=`assistant` | runtime：`await reloadMessages()` → **`streamingTurn = null`** → `onStepCommitted(payload)` |
| `STEP_COMMITTED` phase=`tool_results` | runtime：`await reloadMessages()`；**不** clear tail → `onStepCommitted(payload)` |
| `RUN_FINISHED` / `RUN_FAILED` | runtime：`await reloadMessages()` → clear tail → `onRunFinished` / `onRunFailed` |
| `onRunningChange(false)` | Composer finally；tail 应已 clear |

### 展示合并规则

```text
threadMessages =
  mapHistory(chatMessages)           // 不含 hidden 行规则见 map-session-messages
  + (streamingTurn ? [virtualAssistantMessage(streamingTurn)] : [])
```

**禁止**：tail 与 DB 最后一条 assistant **同时**显示相同 text（commit 后必须 clear tail）。

单测：`streaming-lifecycle.test.ts` 覆盖 assistant step / tool_results step / run finished。

---

## RN Display 节流（freeze 缓解，spike 必验）

### 根因补充

pacing 分支说明：freeze 常表现为 **Metro/RN 主线程断档**（Web 仍跳）。library 路径把 markdown **从 WebView 线程迁回 Hermes**，若每 delta 全量 re-render → 可能从「bridge 卡」变为 **FlatList/markdown 卡**。

### 两层语义（Ingress vs Apply，Spike 后写死其一）

| 层 | 含义 | M0 Spike 默认 |
|----|------|---------------|
| **Ingress** | Bus delta **合并窗口**（32ms coalesce，对齐 main Composer） | **固定 32ms** |
| **Apply** | 合并后的 delta **写入 `streamingTurn` 并触发 External Store 派生 re-render** 的上限 | **默认：re-render 频率上限 ~20Hz（50ms tick）** — 限制 React/commit 次数，**不是** pacing 式字符配额 |

**Spike 结论须二选一记录在 spec 附录或 PR 描述**：

1. **Apply = re-render 节流（默认）**：每 tick 把 coalesce 缓冲 **全部** flush 进 `streamingTurn`；仅限制 `messages` 引用更新频率。
2. **Apply = 字符配额（备选）**：仅当 Spike 1 仍 freeze 时启用 — 每 50ms 最多向 `streamingTurn` 写入 N 字（如 3× pacing 思路）；与 re-render 节流 **不可混用**两套独立限幅而不文档化。

M2 若仍卡：在已选 Apply 模型上叠加 streamdown 增量 markdown，或启用字符配额（从 Spike 备选升为正式）。

### Spike 输入（强制）

- **禁止**仅低速 mock（如 10 字/秒）。
- 使用 **core SSE burst 录制 fixture** 或 replay `SseChunkEmitter` 32ms 合并后的 delta 序列。
- 验收：10min + **Tab/停止按钮 100ms 内响应**（继承 pacing PRD G1 精神）。

---

## Batch / prepend / 滚动

### Batch（M1 设计）

```text
MessageBatchHeader（现网 RN 壳，保留）
  +
ChatLibraryTranscript
  └─ 外层 FlatList / 库 Thread
       renderItem: batchMode ? SelectableRow : NormalRow
       user_vfs_turn → UserVfsTurnRow（batch 时同样可点选，对齐 isTranscriptRowSelectable）
```

- **不用** WebView `selectedMessageIds` postMessage。
- Batch 与 ⋯ **互斥**（同 PRD）。
- `affectedMessageIds`：继续用 `selectVisibilityBatchEligibleIdsFromAnchor` 算预览，传给行高亮。

### prepend（M1 接受部分回退）

- 数据：`useChatTabMessages.loadOlderMessages` 不变。
- UI：prepend 后 **全量** `chatMessages` 传入 External Store；**不**移植 `selectTailTranscriptRows` 增量优化（M2 再评估）。
- **已知 M1 风险**：加载更早消息后 scroll 锚定可能不如 WebView；真机抽测，写入 release note。

### 滚动缓存

| 引擎 | M1 | M2+ |
|------|-----|-----|
| webview | 现网 v2 snapshot | M3 删除 |
| library | **不读** Web v2；打开会话默认贴底或简单 offset | 可选 `react-native-streaming-message-list` / 库 stick-to-bottom |

---

## 总体方案（修订）

```text
core runAgentTurn → EventBus
       │
       ▼ useChatLibraryRuntime（方案 A 唯一 Bus flush 订阅者：STREAM + STEP + RUN + RUN_FAILED）
       │   coalesce + DisplayPolicy → streamingTurn
       │   STEP/RUN → reloadMessages + tail 状态机
       ▼
useExternalStoreRuntime({ messages, isRunning, convertMessage })
       ▼
@assistant-ui/react-native Thread / Message / Reasoning / Tool
       +
renderers: UserVfsTurnRow, MessageMoreButton, NovelToolFallback
```

---

## 最终项目结构

```text
apps/mobile/src/components/chat/
  adapter/
    llm-stream-to-parts.ts
    map-session-messages.ts          # hidden、vfs turn、tool 配对
    coalesce-stream-deltas.ts        # 32ms 合并
    streaming-turn-state.ts          # 状态机 + 单测
    use-chat-library-runtime.ts      # Bus + ExternalStore + DisplayPolicy
  renderers/
    UserVfsTurnRow.tsx
    MessageMoreButton.tsx
    NovelToolFallback.tsx
  ChatLibraryTranscript.tsx
  ChatLibraryRuntimeProvider.tsx     # 可选拆分
```

---

## map-session-messages 要点

- 复用 `buildChatListItems` / `buildUserVfsTurnView` 语义。
- **`hidden: true`** 行：不进入 thread（与 transcript 一致）。
- **`user_vfs_turn`**：独立 list item 或 data part → `UserVfsTurnRow`。
- **tool_result-only user**：不渲染。
- **虚拟 tail**：`virtualAssistantMessage(streamingTurn)`，id 固定如 `__streaming_tail__`，避免与 DB id 冲突。

---

## 库选型与 Bare RN 集成（Step 0 检查清单）

| 检查项 | 通过标准 |
|--------|----------|
| Metro 解析 `@assistant-ui/react-native` | `npx react-native start` 无 unresolved |
| Peer deps | 文档列出；与 RN 0.85.3 对齐 |
| Babel | 若库要求 worklets/reanimated，与现网 config 合并 |
| 与 `markdown-it` / `react-native-render-html` | 无 duplicate 全局冲突；library 路径可不同时加载 Web transcript markdown |
| **`useExternalStoreRuntime` 在 RN 包导出** | spike 代码 import 成功 |
| Hermes | 真机 release/debug 均可 |

项目为 **bare RN CLI**（非 Expo 托管）；spike 在 `react-native run-android` 验证，不仅 Jest。

---

## 三引擎并存（M1–M2）

| 引擎 | 用途 | 测试矩阵 |
|------|------|----------|
| `webview` | 回滚 / 对照 | 现网 e2e 子集 |
| `legacy-rn` | 回滚 | 冒烟 |
| `library` | 新路径 | 全量新用例 |

`ChatConversationPanel` 三分支；M3 删除前两支后矩阵收敛。预期 M1 **条件分支增多**，接受短期复杂度。

---

## 观测与其它

| 项 | library 路径 |
|----|----------------|
| `ChatStreamMetricsBarLive` | M1 **保留**，由 `useChatLibraryRuntime` 内 `noteMetricsTextDelta` 驱动（与现网 acc 同源）；M2 可 dev-only |
| E2E | M1：library 用 `tapMessageMore`；**webview e2e 保留**至 M3 |
| WebView 专用 selector | M3 与 WebView 代码同删 |

---

## 兼容性与迁移

| 阶段 | `chatTranscriptEngine` |
|------|------------------------|
| M0 | spike（External Store + burst fixture） |
| M1 | `library` dev 默认可选 |
| M2 | prod 默认 `library` |
| M3 | 仅 `library` |

**回滚**：`webview` = main 现网（非 pacing 分支）。

---

## 详细实现步骤（修订）

### Step 0 — Spike（阻塞）

1. bare RN 装包 + External Store hello world。
2. mock **burst** SSE → coalesce → parts → Thread 渲染。
3. 真机 10min + 交互性（停止按钮）。
4. 失败 → rn-ai-elements 或中止合 main。

### Step 1 — 纯函数 + 状态机单测

`llm-stream-to-parts`、`streaming-turn-state`、`map-session-messages`（含 hidden/vfs）。

### Step 2 — `useChatLibraryRuntime` + Provider

方案 A Bus 接线；DisplayPolicy；**不接** ChatComposer STREAM 回调。

### Step 3 — `ChatLibraryTranscript` 接入 ChatConversationPanel

Batch 外层；⋯ 菜单；Tool/VFS renderer。

### Step 4 — Composer library 分支：去掉全部 Bus 订阅 + catch 内 flush

- `ChatComposer`：library 时不挂载 STREAM / STEP / RUN / RUN_FAILED 的 `bus.subscribe` effect。
- **`executeRun` catch**：library 时 **仅** `setError`；**删除** `await flushRunUi(...)`（错误 flush 由 runtime `RUN_FAILED` 独占）。
- flush 语义 **仅** 在 `useChatLibraryRuntime`。
- `executeRun` 仍调 `onStreamReset`（→ runtime.clearTail）与 `onRunningChange`。
- `ChatTabScreen`：`agentRunning` / metrics 从 runtime 取。

### Step 5 — M3 删除 webview / legacy（见 §M3 删除清单）

`chatTranscriptEngine` 仅保留 `'library'`；执行删除清单 + 测试/e2e 清理；README 更新。

---

## M3 删除清单（chat WebView + legacy 路径）

> **会删**：chat **transcript** 的 WebView 与 legacy RN 列表整条链路。  
> **不删**：`RichDocumentWebView`（VFS 文档预览）、`react-native-webview` 依赖（预览仍需要）。  
> M1–M2 保留旧路径作回滚；**M3 合 main 前必须删净**，避免三引擎僵尸代码。

### 整目录删除

| 路径 | 说明 |
|------|------|
| `apps/mobile/src/web/chat-transcript/` | `main.ts`、`index.html`、`scroll.ts`、`menu-overlay-guards.ts`、`stream-markdown.boot.ts`、`stream-tail-html-state.ts`、`transcript-html.ts` 等 |

### 组件与服务（删除文件）

| 文件 | 说明 |
|------|------|
| `components/chat/ChatTranscriptWebView.tsx` | WebView transcript 容器 |
| `components/chat/ChatTranscriptBridge.ts` | RN↔Web 桥协议类型与编解码 |
| `components/chat/enrich-transcript-rows.ts` | WebView 行 enrich |
| `components/chat/prepare-stream-tail-html.ts` | 流式 tail RN 侧 markdown → bridge html |
| `components/chat/MessageList.tsx` | legacy-rn inverted 列表回滚路径 |
| `services/chat-transcript-scroll-cache.ts` | WebView scroll snapshot v2 |
| `services/chat-transcript-telemetry.ts` | WebView 专用 telemetry（若仅 WebView 引用） |
| `services/stream-buffer.service.ts` | 现仅服务 WebView/legacy 流式 bridge |
| `screens/tabs/chat-tab/useChatTabStream.ts` | **整文件删除**（library 由 `useChatLibraryRuntime` 替代） |
| `screens/tabs/chat-tab/useChatTabScrollSnapshot.ts` | 若仅为 webview/legacy 滚动快照包装则删 |
| `hooks/useStreamToolInvoking.ts` | library 已废弃；legacy 一并移除 |
| `test-utils/react-native-webview-mock.tsx` | 若仅剩 chat transcript 测试使用可删或缩到 vfs 测试 |

### 测试 / E2E（删除或改写）

| 文件 | 处置 |
|------|------|
| `__tests__/chat-transcript-*.test.ts(x)` | 删除（bridge / webview / boot / scroll / telemetry 等） |
| `__tests__/enrich-transcript-rows.test.ts` | 删除 |
| `__tests__/prepare-stream-tail-html.test.ts` | 删除 |
| `__tests__/stream-buffer.service.test.ts` | 删除 |
| `__tests__/menu-overlay-guards.test.ts` | 删除 |
| `__tests__/message-list-scroll.test.ts` | 删除 |
| `__tests__/chat-tab-screen-legacy-scroll.test.tsx` | 删除或改为 library 集成测 |
| `e2e/.../chat-transcript.page.ts` | 删除 WebView selector；改为 library ⋯ 菜单 |
| `e2e/helpers/context.ts` 中 `switchToWebView` | 仅 chat 用的段落删除；VFS 预览若仍用则保留 |
| `e2e/specs/chat.*.e2e.ts` | 去掉 `openWebView` / `longPressMessage` |

### 接线文件（不删文件，大幅精简）

| 文件 | M3 改动 |
|------|---------|
| `ChatConversationPanel.tsx` | 移除 `ChatTranscriptWebView` / `MessageList` 分支；仅 `ChatLibraryTranscript` |
| `ChatTabScreen.tsx` | 移除 `useChatTabStream`、`webMenuOpen`、`chatTranscriptEngine` 三分支；无 `transcriptWebRef` |
| `storage/chat-transcript-engine.ts` | **删除文件** 或改为常量 `library` only（移除 KKV `webview` / `legacy-rn`） |
| `components/chat/ChatComposer.tsx` | 移除 `engine` 分支；library 为唯一路径（无 catch flushRunUi 双轨） |
| `jest.config.js` | 移除 chat-transcript web 资产相关 transform（若有） |

### 保留但重构（不删）

| 文件 | 说明 |
|------|------|
| `components/chat/message-blocks.ts` | **保留** `buildChatListItems` / `user_vfs_turn`；移除 `buildTranscriptRows` / `TranscriptRow`（改由 `map-session-messages` 输出库 model） |
| `components/chat/MessageActionMenu.tsx` | 保留（⋯ 菜单） |
| `components/chat/ChatStreamMetricsBar*.tsx` | 保留或 M3 改为 dev-only（接 runtime metrics） |
| `services/chat-list-scroll-cache.ts` | 若 library 复用 RN scroll 快照则保留；否则替换为库侧缓存 |
| `components/vfs/RichDocumentWebView.tsx` | **保留** |
| `web/rich-document/` | **保留** |

### package.json / 脚本

| 项 | 处置 |
|----|------|
| `react-native-webview` | **保留**（VFS 预览） |
| `generate:stream-rich-engine`（若有） | 删除 script 与生成物（仅 chat transcript Web 用） |

### M3 完成判定

- [ ] `rg ChatTranscriptWebView|chat-transcript/main|legacy-rn|useWebviewTranscript` 在 `apps/mobile/src` 无命中（`RichDocument` / `rich-document` 除外）
- [ ] `chatTranscriptEngine` 无 `webview` / `legacy-rn` 选项
- [ ] mobile 单测 + 相关 e2e 绿
- [ ] KB：`mobile-webview-chat-transcript` 标记 **superseded / archived**

---

## 测试策略

### 单元

| 文件 | 内容 |
|------|------|
| `llm-stream-to-parts.test.ts` | 交错 thinking/text/tool |
| `streaming-turn-state.test.ts` | assistant/tool_results/run 边界 |
| `map-session-messages.test.ts` | hidden、vfs、tail 虚拟 id |
| `coalesce-stream-deltas.test.ts` | 32ms 合并 |

### 真机

| ID | 内容 |
|----|------|
| T-freeze-burst | burst fixture 10min + 停止按钮响应 |
| T-tool-stream | TOOL_USE 流式卡 → commit 后单条 |
| T-step-handoff | assistant commit 无双气泡 |
| T-error-flush | mock RUN_FAILED + throw；**reload 仅一次**（无 catch flushRunUi） |
| T-menu / T-vfs / T-batch | 同 PRD |
| T-prepend | 加载更早（记录 scroll 行为，M1 允许已知回退） |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| External Store 与 agent 生命周期不一致 | §状态机 + 单测 |
| Bus 双订阅 / 双 reload | 方案 A：runtime 独占 STREAM+STEP+RUN+RUN_FAILED；Composer 零 Bus、**catch 无 flushRunUi** |
| External Store 无 setMessages | Spike 验证 warn/UX；必要时 no-op workaround |
| markdown 拉回 RN | Ingress 32ms + Apply re-render 节流（Spike 写死）；备选字符配额 |
| prepend/Batch UX 回退 | M1 文档化；M2 优化 |
| assistant-ui bare RN 集成 | Step 0 检查清单 |
| 三引擎测试膨胀 | M1 集中测 library；webview 回归子集 |

---

## Phase 2

- Desktop：同一 `map-session-messages` 语义 + assistant-ui web External Store。
- `RichDocumentWebView`：不在本迭代。

---

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/spec.md`
