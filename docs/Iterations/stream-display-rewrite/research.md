---
date: 2026-06-19
updated: 2026-06-19
status: draft
supersedes_observation:
  - Iterations/mobile-stream-display-pacing/spec.md
  - Iterations/mobile-stream-display-pacing/bugs/stream-freeze-text-after-thinking/spec.md
---

# 流式显示重写 — 调研记录（Research）

> **代码基线**：`main`。pacing 实验见 §2.2（`feature/mobile-stream-display-pacing`，未合 main）。

## 1. 结论摘要

| 维度 | 结论 |
|------|------|
| **实现起点** | **`main`**（WebView + streamBuffer）；**不**从 pacing feature 分支开发 |
| **是否 patch 现架构** | 否。main 双 runtime bridge 与 pacing 分支 pacer 路线均不再 patch |
| **显示层策略** | **库优先** + adapter + custom renderer（`user_vfs_turn`、Tool、⋯ 菜单） |
| **core UI 库** | 不进 core |
| **VFS 预览 WebView** | **保留**（`RichDocumentWebView`）；本迭代只换 **chat transcript** |
| **M3 删除** | chat WebView + legacy 列表 **整链删除**（spec §M3 删除清单） |
| **Runtime** | **`useExternalStoreRuntime`**；core 仍 `runAgentTurn`；库不跑 `ChatModelAdapter.run()` |
| **Bus（library）** | runtime 独占 STREAM+STEP+RUN；Composer **零 Bus** |

---

## 2. 现架构问题

### 2.0 Agent 与库边界

Novel Master：**Composer → runAgentTurn(core) → Bus → reloadMessages(DB)**。库仅消费 External Store 中的 `chatMessages` + 流式 tail，**不**替代 agent。详见 spec §Runtime、§Bus 方案 A。

### 2.1 main 基线（本迭代替换对象）

```
SSE → core LlmStreamEvent
  → EVENT_AGENT_STREAM_TEXT_DELTA / THINKING_DELTA（双 Bus topic）
  → ChatComposer → useChatTabStream（~260 行）
      → 32ms Bus 合并 + 64ms streamBuffer
      → ChatTranscriptWebView.pushStreamDelta(kind, delta)
      → RN prepareStreamTailHtml → postMessage streamDelta { html? }
      → WebView main.ts appendStreamDelta → 双 stream.text / stream.thinking DOM
```

| 特征 | main |
|------|------|
| 默认引擎 | `webview`（`chat-transcript-engine.ts`） |
| pacer | **无** |
| bridge API | `pushStreamDelta`（非 batch） |
| Web markdown | `stream-markdown.boot.ts` 轻量路径 |
| RN metrics | `ChatStreamMetricsBarLive` 在 transcript 上方 |
| 菜单 | WebView 长按 + legacy RN long-press |

**问题本质**：仍是 **Hermes + WebView 双 runtime**、thinking/text **双 channel** 显示状态，经 bridge 增量同步——与是否 pacer 无关，架构上易出 freeze / 难观测。

### 2.2 feature 分支 postmortem（留存，未合 main）

分支 **`feature/mobile-stream-display-pacing`** @ `b3dddb46`：在 main 之上叠加 StreamDisplayPacer、Web reconciler、deferred thinking、`pushStreamDeltaBatch`、`stream-pipeline-telemetry` 等。

真机 replay（2026-06-19，**该分支**）：

- Thinking ~2200 字完整，message ~613 字停更
- Web heartbeat 续，Metro RN 业务断档
- deferred thinking 仅把 freeze 从 ~52 字推到 ~613 字

**教训**：pacing patch **未根治**；但 **不能** 因此认为 main 无 freeze 风险——应 **mock SSE 在 library 路径验收**，而非回退 patch main/pacing。

### 2.3 错误调查方向（已放弃）

- 继续在 main WebView 流式或 pacing 分支上 patch
- 把 VFS / composer 纳入 chat 库重写范围
- 自研 `packages/stream-rn` 全量 UI

---

## 3. 目标架构

```text
packages/core/
apps/mobile/chat-adapter + @assistant-ui/react-native
apps/mobile ChatTabScreen（Composer/Modal 保留）
apps/mobile RichDocumentWebView（VFS 预览，不动）
```

---

## 4. LLM 协议与 UI 模型

| 层 | 说明 |
|----|------|
| core `LlmStreamEvent` | text / thinking / tool-use / done |
| main 现网 UI | 双 Bus + 双 Web DOM channel |
| 目标 UI | 库 parts 单 turn、wire 顺序 |

---

## 5. 第三方库调研

### 5.0 库能力 vs 需求

| 需求 | assistant-ui RN | rn-ai-elements |
|------|-----------------|----------------|
| thinking | ✅ Reasoning | ✅ Reasoning |
| message + markdown | ✅ | ✅ 流式 markdown |
| tool | ✅ tool-call + 覆写 | ✅ Tool |
| user_vfs_turn | custom renderer | custom renderer |
| ⋯ 菜单 | RN MessageMoreButton | 同上 |

### 5.1 推荐

| 库 | 角色 |
|----|------|
| **assistant-ui RN** | chat 列表主体（spike 首选） |
| **rn-ai-elements** | 备选 |
| **react-native-streamdown** | 库 markdown 不足时补充 |
| **react-native-render-html** | main 已有；legacy 列表用，library 路径非首选 |

### 5.6 自定义 renderer

`user_vfs_turn`、Tool 覆写、⋯ 菜单与库 **正交**；不走 WebView bridge。

---

## 6. 对照表

| 维度 | main 现网 | pacing feature | 目标 |
|------|-----------|----------------|------|
| JS 运行时 | 2（Hermes+WebView） | 2 | 1（Hermes） |
| 流式节流 | streamBuffer 64ms | pacer 50ms×3 字 | Ingress 32ms + Apply **re-render ~20Hz**（Spike 定稿） |
| bridge | pushStreamDelta | pushStreamDeltaBatch | **无** |
| TOOL_USE（mobile） | **未订阅** | 未订阅 | adapter **新增** |
| 渲染 | Web DOM | Web DOM + reconciler | 库 RN + Display 节流 |

---

## 7. 验收（草案）

1. **burst** SSE replay 10min 无 freeze；停止/Tab **100ms** 内响应（library 路径）
2. STEP/RUN/**RUN_FAILED** **单次** reload（无 Composer catch `flushRunUi` 叠加）
3. ⋯ 菜单、vfs turn、tool 流式 + commit 后 DB 卡
4. 无 chat WebView 流式 postMessage
5. adapter + streaming-turn 单测
6. Spike 记录：External Store 无 `setMessages` 行为；Apply 层 re-render  vs 字符配额 **二选一**

---

## 8. 参考

- assistant-ui RN：https://www.assistant-ui.com/docs/react-native
- main WebView spec：[`mobile-webview-chat-transcript/spec.md`](../mobile-webview-chat-transcript/spec.md)
- pacing 留存：`feature/mobile-stream-display-pacing`

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/research.md`
