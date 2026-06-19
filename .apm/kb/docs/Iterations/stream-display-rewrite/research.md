---
date: 2026-06-19
status: draft
supersedes_observation:
  - Iterations/mobile-stream-display-pacing/spec.md
  - Iterations/mobile-stream-display-pacing/bugs/stream-freeze-text-after-thinking/spec.md
---

# 流式显示重写 — 调研记录（Research）

## 1. 结论摘要

| 维度 | 结论 |
|------|------|
| **是否继续 patch 现架构** | 否。WebView + 双 Bus + pacer + textPhase defer 属于高复杂度、难验证路径；真机 freeze 未根治。 |
| **core 是否引入 UI 库** | 否。core 保持 agent / LLM 协议 / 持久化 / tool，不绑 RN/Electron/React。 |
| **显示层策略** | **库优先**：`@assistant-ui/react-native` 或 `@crafter/rn-ai-elements` 承担 chat 列表；自研仅 **adapter + 少量 custom renderer**（`user_vfs_turn`、Tool 样式）。 |
| **是否自研 stream UI 包** | 否（默认路径）。不新建 `packages/stream-rn` 自研 FlatList/markdown 引擎；adapter 放 `apps/mobile`。 |
| **RN 第三方库** | **assistant-ui RN**、**rn-ai-elements** 为主选；streamdown / streaming-message-list 仅 spike 补充。不引入 Stream Chat Cloud、Tencent UIKit、CopilotKit/Ajora。 |
| **Vercel AI SDK** | **整包 `ai` 不宜进 core**（见 [spec.md](./spec.md#7-vercel-ai-sdk-与-core-边界)）；core 仍出 `LlmStreamEvent`，adapter 转库 parts。 |

---

## 2. 现架构问题（postmortem）

### 2.1 现象（真机 replay，2026-06-19）

- Thinking 常完整（~2200 字），message 在 ~613 字停更。
- adb `StreamWeb` heartbeat 仍跳，`streamTextLen` 冻结 → **WebView JS 未死**。
- Metro `[StreamPipeline] heartbeat` 在 01:47:09 后断档 → **RN Hermes JS 不再调度业务/观测**。
- 冻结前：`wire≈display`、`backlog≈0`、`reconcileMs=0` → **不是** classic「渲染追不上 / markdown reconcile 过重」。
- 冻结前仍有 `interleaved_thinking_after_text`、RN `backlog=4`、`sinceWireMs=17` → wire 仍在来，RN 随后整体静默。

### 2.2 架构根因（非 prompt、非模型）

```
SSE → core LlmStreamEvent
  → wrapStreamForBus：thinking-delta / text-delta 两个 EventBus topic
  → useChatTabStream：双 handler + StreamDisplayPacer FIFO
  → textPhaseActive：text 阶段 thinking defer（500ms）/ text tick batch 分离
  → ChatTranscriptWebView.postMessage → WebView main.ts 双 state + 双 DOM
```

与 SillyTavern 对比：ST 为 **单 SSE 循环** → 同 tick 更新 `state.reasoning` + `text` → 单 DOM 管线；无 RN↔WebView bridge。

### 2.3 错误调查方向（已放弃）

- 「渲染重活 / bridge 过载」：deferred thinking 仅把 freeze 从 ~52 字推到 ~613 字，未消除 RN 硬冻结。
- 「prompt 相关」：UI/state 类 bug 应 mock SSE 复现，与 prompt 无关。
- 观测日志：能证明 **RN 何时停**，不能证明 **停在哪一行**（无 profiler 栈）。

### 2.4 pacing 迭代留存

[`mobile-stream-display-pacing`](../mobile-stream-display-pacing/spec.md) 全部修复尝试已合并至 git 分支 **`feature/mobile-stream-display-pacing`**（含 metrics、heavy-reconcile、handoff、text-after-thinking 等 bugfix）。真机 freeze **未根治**；本迭代 **supersede** 该路线，不再继续 patch。

---

## 3. 目标架构

```text
packages/core/                 # 不变：agent、LlmStreamEvent、SSE 解析、VFS、落库
apps/mobile/chat-adapter/      # 新建：LlmStreamEvent → 库 message parts；历史 ChatMessage 映射
@assistant-ui/react-native     # 或 @crafter/rn-ai-elements — Conversation / Reasoning / Tool / markdown
apps/mobile ChatTabScreen      # 删除 WebView 流式；Composer/Modal 等 RN 壳保留
apps/desktop/                  # Phase 2：assistant-ui web + 同一 adapter 语义
```

**adapter 原则**

- 输入：`LlmStreamEvent`（来自 core EventBus / runner）。
- 输出：库 runtime 的 message parts（reasoning / text / tool-call），**单 turn、wire 顺序**。
- **流式期**仅内存；commit 后 reset，历史从 DB 静态映射。
- **`user_vfs_turn`**：列表 custom renderer 或 data part，**不**走 WebView bridge。

**core 事件建议（可选优化）**

- 长期：单一 stream topic 或 runner `onStream(LlmStreamEvent)`，减少 adapter 双订阅；非 spike 阻塞项。

---

## 4. LLM 协议与 UI 模型（背景）

| 层 | thinking / text / tool 关系 |
|----|----------------------------|
| **SSE（Anthropic 等）** | 单连接、按序 content block；block 内串行 delta；块间可 thinking → text → tool_use。 |
| **core `LlmStreamEvent`** | `text-delta` \| `thinking-delta` \| `tool-use` \| `done`。 |
| **现 mobile UI** | 两 Bus topic + 两 DOM + textPhase defer → **非**统一增量渲染。 |
| **目标 UI** | 库 runtime 的 message parts（reasoning / text / tool-call），单 turn、wire 顺序（与 SillyTavern / AI SDK UIMessage parts 同思路）。 |

---

## 5. 第三方库调研

### 5.0 库能力 vs 本项目需求（普通 AI chat）

| 需求 | assistant-ui RN | rn-ai-elements | 备注 |
|------|-----------------|----------------|------|
| thinking / reasoning | ✅ `Reasoning` part | ✅ `Reasoning` 组件 | 流式 `status: running` |
| assistant message | ✅ `Text` / MarkdownText | ✅ `Message` + 流式 markdown | 库承担，非自研 |
| tool 调用展示 | ✅ `tool-call` + `ToolFallback` | ✅ `Tool` | `tools.by_name` / `Fallback` 可覆写样式 |
| 样式覆写 | ✅ `MessagePrimitive.Parts` components | ✅ 独立 styled 组件 | 见 §5.6 |
| **`user_vfs_turn`** | 库外 custom renderer 或 data part | 同上 | 静态插入，**非**流式热点 |
| VFS / Composer / DB | — | — | **不在** chat 库范围 |

结论：**标准 agent chat 列表在库能力范围内**；自研工作量应限于 **adapter** 与 **少量 custom renderer**，不是重写 transcript 引擎。

### 5.1 推荐参考或部分采用

| 库 | 链接 | 适用层 | 说明 |
|----|------|--------|------|
| **assistant-ui RN** | [docs](https://www.assistant-ui.com/docs/react-native) | **chat 列表主体** | Reasoning、tool（`by_name`/`Fallback`）、Custom Backend；`MessagePrimitive.Parts` 覆写。 |
| **@crafter/rn-ai-elements** | [GitHub](https://github.com/crafter-station/rn-ai-elements) | **chat 列表备选** | Conversation、Reasoning、Tool、流式 markdown。 |
| **expo-ai-elements** | [npm](https://www.npmjs.com/package/expo-ai-elements) | 同上 | Vercel AI Elements RN 移植；默认绑 `useChat`，需 adapter 避双 agent。 |
| **react-native-streamdown** | [GitHub](https://github.com/software-mansion-labs/react-native-streamdown) | spike 补充 | 仅当库自带 markdown 不足时考虑。 |
| **react-native-streaming-message-list** | [GitHub](https://github.com/bacarybruno/react-native-streaming-message-list) | spike 补充 | 最后一条变长滚动；库滚动不足时加。 |
| **Vercel AI SDK Core (`ai`)** | [Navigating the Library](https://ai-sdk.dev/docs/getting-started/navigating-the-library) | **不进 core**；可选 spike | Core 宣称任意 JS 环境；见 [spec §7](./spec.md#7-vercel-ai-sdk-与-core-边界)。 |
| **Vercel AI SDK UI (`@ai-sdk/react`)** | [Expo 指南](https://ai-sdk.dev/docs/getting-started/expo) | **不进 core**；勿作唯一 agent | `useChat` 与 core agent 双轨；adapter 仍应以 `LlmStreamEvent` 为真相源。 |

### 5.2 只借鉴模式、不引入 SDK

| 库 | 链接 | 借鉴点 | 不引入原因 |
|----|------|--------|------------|
| **Stream Chat RN + AI** | [@stream-io/chat-react-native-ai](https://www.npmjs.com/package/@stream-io/chat-react-native-ai) | 单 message partial update；`ai_indicator` 表 thinking/generating；`StreamingMessageView` | 绑定 Stream Cloud + channel 模型，与本地 session/agent 不符。 |
| **SillyTavern** | 本地 `StreamingProcessor` | 单 loop 更新 reasoning + text | 非 npm 库；桌面浏览器单线程，作行为参考。 |

### 5.3 不推荐

| 库 | 链接 | 原因 |
|----|------|------|
| **react-native-ajora** | [GitHub](https://github.com/habasefa/react-native-ajora) | CopilotKit RN 移植；~58 weekly downloads；强绑 CopilotKit runtime。 |
| **@tencentcloud/chat-uikit-react-native** | [npm](https://www.npmjs.com/package/@tencentcloud/chat-uikit-react-native) | 腾讯云 IM UIKit；非 LLM agent。 |
| **react-native-ds-chat** | [npm](https://www.npmjs.com/package/react-native-ds-chat) | 通用 IM UI；无 thinking/tool/流式 agent。 |
| **react-native-ai-kit** | [GitHub](https://github.com/AlexRixten/react-native-ai-kit) | SSE + 简单 useChat；与 core SSE 重复；parts 模型弱。 |
| **WebView transcript 流式** | 现 `useChatTabStream` | 双 runtime + bridge；freeze 温床。 |

### 5.4 名称澄清

| 用户写法 | 实际 |
|----------|------|
| `@stream-io/chat-reactive-native-ui` | **`stream-chat-react-native`** + **`@stream-io/chat-react-native-ai`** |
| `explo-ai-element` | **`expo-ai-elements`** |
| `react-native-nai` | 无此包；常指 **dabit3/react-native-ai**（`npx rn-ai` 全栈模板）或 **callstackincubator/ai**（端侧 LLM） |

### 5.5 其他相关项目

| 项目 | 链接 | 说明 |
|------|------|------|
| **dabit3/react-native-ai** | [GitHub](https://github.com/dabit3/react-native-ai) | Expo + Express 全栈模板；可参考 server 流式路由，非嵌入 monorepo。 |
| **callstackincubator/ai** | [GitHub](https://github.com/callstackincubator/ai) | 端侧 LLM + AI SDK provider；与云端 agent/VFS 主路径无关。 |
| **react-native-gifted-chat** | [npm](https://www.npmjs.com/package/react-native-gifted-chat) | 流式 = 更新最后一条 message 文本；无 agent 语义。 |
| **LangGraph JS on RN** | [issue #1302](https://github.com/langchain-ai/langgraphjs/issues/1302) | ReadableStream 与 Hermes 冲突；agent 应留 server/core，client 只消费 HTTP/SSE。 |

### 5.6 自定义 renderer（与库不冲突）

| 内容 | 性质 | 做法 |
|------|------|------|
| **`user_vfs_turn`** | 用户插入的 VFS 操作摘要；一次性渲染 | 列表 wrapper 插 `UserVfsTurnCard`，或 adapter 映射为 user message 的 custom/data part |
| **Tool 卡** | agent 流式/历史 tool-call | 默认用库 `Tool` / `ToolFallback`；`tools.by_name` 覆写 `read_file` 等紧凑样式 |
| **长按 / Batch** | 交互壳 | RN `ChatTabScreen` 保留 Batch；**消息操作改为 ⋯ 按钮**（废弃长按/Web DOM menu） |

这些 **不走** WebView 流式 bridge，与库 **正交**，不构成「库做不了所以自研」的理由。

---

## 6. SillyTavern vs novel-master mobile（对照）

| 维度 | SillyTavern | 现 mobile | 目标 |
|------|-------------|-----------|------|
| JS 运行时 | 1（浏览器） | 2（Hermes + WebView） | 1（Hermes） |
| 增量入口 | 1 个 generator 循环 | 2 个 Bus 订阅 | adapter + 库 runtime（单 parts 管线） |
| thinking / text | 同 tick | textPhase + defer | 同 turn parts |
| 渲染 | DOM innerHTML | postMessage → Web DOM | 库原生 RN（Conversation + parts） |
| 节流 | 可选 streaming_fps | 固定 pacer 3 字/tick | 库 runtime（无 RN↔Web bridge） |

---

## 7. 重写验收（草案）

1. mock SSE fixture：长 thinking → 长 text → 交错 thinking → tool；**无 RN 硬冻结**。
2. **库 UI** 展示 reasoning / text / tool-call；wire 顺序与 UI 分区一致。
3. **`user_vfs_turn`** 自定义行正常；不参与流式 bridge。
4. step commit 前仅内存 turn；commit 后 core 落库 + adapter reset；**无 WebView 流式 postMessage**。
5. adapter 单测覆盖全 `LlmStreamEvent` 序列；spike 真机 10min 通过后方可合入主路径。

---

## 8. 参考链接

- assistant-ui RN：https://www.assistant-ui.com/docs/react-native  
- assistant-ui RN Primitives：https://www.assistant-ui.com/docs/react-native/primitives  
- assistant-ui ToolFallback：https://www.assistant-ui.com/docs/ui/tool-fallback  
- assistant-ui Reasoning：https://www.assistant-ui.com/docs/ui/reasoning  
- pacing 留存分支：`feature/mobile-stream-display-pacing`  
- AI SDK Navigating：https://ai-sdk.dev/docs/getting-started/navigating-the-library  
- AI SDK Expo：https://ai-sdk.dev/docs/getting-started/expo  
- Stream AI RN：https://getstream.io/chat/docs/sdk/react-native/guides/ai-integrations/  
- react-native-streamdown：https://github.com/software-mansion-labs/react-native-streamdown  

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/research.md`
