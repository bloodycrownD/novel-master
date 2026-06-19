---
date: 2026-06-19
dependency:
  - Iterations/mobile-stream-display-pacing/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
supersedes:
  - Iterations/mobile-stream-display-pacing/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
---

# Mobile 聊天列表显示重写 — 产品需求（PRD）

## 背景

Mobile assistant 流式显示在 [`mobile-stream-display-pacing`](../mobile-stream-display-pacing/prd.md) 多轮修复后（留存分支 `feature/mobile-stream-display-pacing`），真机仍出现 **thinking 完整、message 中途停更、RN JS 硬冻结**（见 [research.md](./research.md)）。

根因判定为 **架构**：RN↔WebView 双 runtime、thinking/text 双 Bus、`useChatTabStream` pacer — **不是** prompt 或单次性能调参。

[`mobile-webview-chat-transcript`](../mobile-webview-chat-transcript/prd.md) 解决了滚动/layout，但 **流式 bridge 成为新的 freeze 温床**。用户决策：

1. **重写 chat 列表显示与流式**（普通 AI 聊天 UI）。
2. **以现成 RN AI chat 库为主体**，自研仅 **core → 库的薄 adapter** 与少量 **自定义 renderer**。
3. **不再** 在 WebView 流式栈或 `useChatTabStream` 上 patch。
4. **core agent / VFS / Composer / DB** 不在本迭代重写范围内。
5. **消息操作菜单** 由长按改为 **气泡右上角「⋯」更多按钮**（降低实现与滚动冲突成本）。

---

## 目标（含成功指标）

| 维度 | 目标 | 成功指标 |
|------|------|----------|
| **正确性** | 长 thinking + 长 text + tool 流式不 freeze | mock SSE 真机 10min 无 RN 硬冻结 |
| **实现策略** | 库优先 chat 列表 | spike 通过 assistant-ui 或 rn-ai-elements 之一 |
| **集成** | 薄 adapter 接 core `LlmStreamEvent` | 无 WebView 流式 `postMessage` |
| **特殊行** | `user_vfs_turn`、Tool 样式覆写 | 列表可见且不影响流式 tail |
| **消息菜单** | ⋯ 按钮弹出编辑/复制/Fork/回滚 | 无长按；agent 运行中禁用；不引发布局跳变 |
| **可测** | mock SSE fixture | 不依赖 GLM prompt |

---

## 用户与场景

| 场景 | 期望 |
|------|------|
| 日常对话 | 流式 thinking + 正文 + tool 卡正常更新、贴底跟随 |
| 编辑/回滚 | 点消息 ⋯ → 选操作；逻辑与现网一致 |
| VFS 操作 turn | 仍以专用卡片展示，非流式热点 |
| Batch 隐藏/恢复 | Header Batch 模式；消息行点选，**不**与 ⋯ 菜单并存 |
| Agent 运行中 | ⋯ 隐藏或禁用（与现网长按禁用一致） |

---

## 范围

### 包含

- 选型 spike（见 [spec.md](./spec.md)）：assistant-ui RN **或** rn-ai-elements。
- `apps/mobile` chat tab **transcript 区**替换为库组件 + adapter。
- 删除 WebView **流式** bridge（`useChatTabStream` pacer、`pushStreamDeltaBatch` 等）。
- 自定义 renderer：`user_vfs_turn`、`Tool` 样式覆写。
- **消息 ⋯ 菜单**：复用 `buildMessageActionItems` / `handleMessageMenuAction`；UI 改为 RN 原生按钮 + `MessageActionMenu`（或 BottomSheet）。
- 历史 prepend、滚动缓存与列表接线（复用 `useChatTabMessages` 等）。

### 不包含

- core agent、VFS 协议、Composer 壳、工作区、DB schema。
- 自研 `packages/stream-rn` UI 包。
- Stream Chat Cloud / 腾讯云 IM / CopilotKit。
- Desktop chat 全量迁移（Phase 2）。
- WebView 流式 hybrid；WebView transcript 在接入完成后整体移除。
- **长按菜单**（本迭代明确废弃，不追求与 WebView T7 像素级一致）。

---

## 核心需求

1. **库承担** Conversation / Message / Reasoning / Tool / 流式 markdown。
2. **adapter** 将 `LlmStreamEvent`（及 `EVENT_AGENT_STREAM_*` Bus）转为库 message parts，单 turn、wire 顺序。
3. **移除** RN↔WebView 流式 bridge 与 `StreamDisplayPacer` 显示路径。
4. **`user_vfs_turn`** 用 RN 自定义行或 data part 展示，不走流式。
5. **消息操作** 通过 ⋯ 按钮触发，复用现有 edit/copy/fork/rollback 业务逻辑。
6. **Feature flag** 迁移期可切 `webview` / `library`，默认在 spike 通过后切 `library`。
7. spike **未通过** 不得合主路径或宣称 freeze 已修。

---

## 验收标准

### 流式（G-freeze）

- **Given** 固定 mock SSE（长 thinking → 长 text → 交错 thinking → tool）
- **When** 真机连续 replay ≥ 10 分钟
- **Then** message 持续更新；Metro 无 RN JS 业务断档；无 display freeze

### 功能

- **Given** 含 thinking、text、tool、markdown 的历史会话
- **When** 打开会话
- **Then** 库 UI 正确渲染；`user_vfs_turn` 行可见；step commit 后历史与 DB 一致

### 消息 ⋯ 菜单

- **Given** agent 未运行、非 Batch 模式
- **When** 用户点击 assistant/user 消息右上角 ⋯
- **Then** 弹出菜单含：编辑（仅有 text 时）、复制、Fork、回滚；选后行为与现网 `handleMessageMenuAction` 一致
- **When** agent 运行中
- **Then** ⋯ 不可见或不可点
- **When** 打开菜单
- **Then** 列表 **不** 发生 scroll jump / contentHeight 跳变（相对 WebView 长按 T7 放宽为「无肉眼可见跳动」）

### 迁移

- **Given** spike 通过
- **When** `chatTranscriptEngine = 'library'`
- **Then** 无 WebView 流式 `postMessage`；`useChatTabStream` 不再驱动 transcript

---

## 参考

- 调研与库能力：[research.md](./research.md)
- 技术方案：[spec.md](./spec.md)
- pacing 留存分支：`feature/mobile-stream-display-pacing`

**生成路径**：`.apm/kb/docs/Iterations/stream-display-rewrite/prd.md`
