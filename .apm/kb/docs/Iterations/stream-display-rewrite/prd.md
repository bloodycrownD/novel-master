---
date: 2026-06-19
updated: 2026-06-19
dependency:
  - Iterations/mobile-webview-chat-transcript/prd.md
supersedes_observation:
  - Iterations/mobile-stream-display-pacing/prd.md
---

# Mobile 聊天列表显示重写 — 产品需求（PRD）

> **代码基线**：`main`。  
> **实现分支**：`feature/stream-display-rewrite`（从 main 拉出）。

## 背景

main 现网：WebView transcript + `runAgentTurn(core)` + Composer 订阅 Bus 流式事件 + step commit 后 `reloadMessages(DB)`。

pacing 实验（`feature/mobile-stream-display-pacing`，**未合 main**）证明继续 patch WebView/pacer **不能**根治 RN 主线程 freeze；详见 [research.md](./research.md)。

本迭代：**库渲染 + External Store adapter** 接现有 core agent，**不**引入第二套 chat agent（不用 `ChatModelAdapter.run()` 发请求）。

---

## 目标（含成功指标）

| 维度 | 目标 | 成功指标 |
|------|------|----------|
| **架构** | core agent 不变；库只渲染 | `useExternalStoreRuntime` + 外部 `chatMessages` / tail |
| **正确性** | 长流式不 freeze | **burst** fixture 真机 10min；停止按钮 100ms 内响应 |
| **Tool** | 流式 tool-call + commit 后 DB 卡 | 无双气泡；对齐 desktop 订阅 TOOL_USE |
| **UX** | ⋯ 菜单；Batch/prepend 可用 | M1 允许 prepend  scroll 弱于 WebView（文档化） |

---

## 用户与场景

（同前：日常对话、⋯ 编辑/回滚、VFS turn、Batch、agent 运行中无 ⋯）

---

## 范围

### 包含

- `useExternalStoreRuntime` 集成（见 spec §Runtime）。
- Bus **方案 A**：library 路径 **`useChatLibraryRuntime` 独占 STREAM + STEP + RUN + RUN_FAILED**（唯一 flush）；Composer 零 Bus。
- TOOL_USE 流式 + commit 后 DB 展示。
- RN Display 节流（coalesce + ~20Hz apply）。
- 从 main spike → **M3 移除 chat WebView transcript + legacy MessageList 全部代码**（清单见 spec §M3 删除清单）。

### 不包含

- 合并 pacing feature；patch main webview 流式。
- `RichDocumentWebView`（VFS 预览）。
- core agent / Composer 发送逻辑重写。

---

## 核心需求

1. **库 + External Store**：messages 来自 `useChatTabMessages` + 内存 `streamingTurn`；发送仍走 `ChatComposer` → `runAgentTurn`。
2. **Bus 方案 A**：runtime **独占** STREAM + STEP + RUN + RUN_FAILED；library 下 Composer **零 Bus**；**catch 不调用 flushRunUi**（错误 flush 仅 RUN_FAILED）。
3. **Tool**：订阅 `EVENT_AGENT_STREAM_TOOL_USE` 流式展示；library 路径移除 `useStreamToolInvoking`。
4. **Tail 状态机**：runtime 内联 `flushAgentStepUi` / `flushRunUi` 语义；flush 后调 `onStepCommitted` / `onRunFinished`（vfs bump）。
5. **`agentRunning`**：library 路径由 **`useChatLibraryRuntime` 暴露**；ChatTabScreen 不读旁路 `useChatTabStream`。
6. **Display 节流**：Ingress 32ms；Apply 默认 **re-render ~20Hz**（Spike 写死；字符配额仅作备选）。
7. **Batch / prepend**：外层 RN；M1 接受 prepend scroll 弱于 WebView。
8. ⋯ 菜单；`library` 引擎；spike 用 **burst** fixture。

---

## 验收标准

### 流式（burst）

- **Given** core SSE burst replay fixture（非低速 mock）
- **When** 真机连续 ≥10min
- **Then** thinking/text/tool 持续更新；无 RN 业务断档；**停止/Tab 100ms 内响应**

### step handoff

- **Given** assistant step 落库
- **When** `STEP_COMMITTED` phase=assistant
- **Then** tail 清空；列表仅显示 DB 消息；**无重复气泡**

### Tool

- **Given** 流式 TOOL_USE
- **When** tail 展示 tool-call
- **Then** commit 后 tail 消失，历史 tool 卡来自 DB

### 功能 / 菜单 / 迁移

（同前 PRD；library 引擎无 WebView 流式 postMessage）

### 错误 flush（RUN_FAILED）

- **Given** `runAgentTurn` 失败（core 先发 RUN_FAILED 再 throw）
- **When** library 引擎
- **Then** `reloadMessages` + clear tail **仅一次**；Composer catch 只展示 error，不 second flush

### M1 已知可接受回退

- prepend 后 scroll 锚定可能弱于 WebView（须记录在 release note / 真机清单）

---

## 参考

- [spec.md](./spec.md) — Runtime、Bus、状态机、Batch、spike 清单
- [research.md](./research.md)
- pacing 留存：`feature/mobile-stream-display-pacing`

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/prd.md`
