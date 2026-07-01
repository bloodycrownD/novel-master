---
date: 2026-06-29
---

# Mobile Stream Tail 等待样式分相 技术规格（SPEC）

## 设计目标

1. 在 **Mobile** transcript 内区分 **首包前等待** 与 **内容后 idle 等待** 两种 UI，消除「空 assistant 气泡 + 横条」的丑态。
2. 修复 WebView **`setStreamToolInvokingDom` 无 tail 时不建 DOM** 的缺口，使纯 idle 与 legacy 行为对齐。
3. **不改动** Core `computeStreamTailGenerating` 阈值与 lifecycle 语义；**不改动** Desktop。

## 总体方案

### 分相判定（Mobile 展示层）

```typescript
/** stream tail 是否已有可见流式正文或思考 */
hasStreamContent = (text.trim().length > 0) || (thinking.trim().length > 0)

/** idle「生成中」已由 hook 算出 */
streamTailGenerating = computeStreamTailGenerating(...)

phase =
  !streamTailGenerating → 'active'           // 正在收 delta，不显示 idle bar
  streamTailGenerating && !hasStreamContent → 'waiting-first'  // 首包前
  streamTailGenerating && hasStreamContent  → 'idle-after-content' // 内容后停顿
```

判定位置：

| 引擎 | 数据来源 |
|------|----------|
| WebView | `state.stream.text` / `state.stream.thinking`（trim 后） |
| legacy RN | `streamingText` / `streamingThinking` props |

**不**将 `toolInvoking` prop 本身当作 `hasStreamContent` 条件（避免 idle 自举出大气泡）。

### UI 行为矩阵

| phase | WebView DOM | legacy RN |
|-------|-------------|-----------|
| `active` | 正常 stream tail；无 idle bar | 同左 |
| `waiting-first` | **轻量行**：`.row.stream.stream--waiting-first`，内含 compact `.stream-waiting-indicator`（脉冲点 +「生成中」），**无** `.bubble.assistant` 大壳、**无** 空 `.bubble-body` | stream 行使用 **compact** 布局：`ToolTurnPhaseBar` 或等价，**不** `bubbleFillWidth`、不渲染空气泡容器 |
| `idle-after-content` | 现有 `#stream-tail` + `.bubble.assistant` + 内容 + `.tool-invoking-bar` | 现有 `renderAssistantBubble` + `showToolInvoking` |

### WebView 结构示意

**waiting-first（新）**

```html
<div class="row stream stream--waiting-first" id="stream-tail">
  <div class="stream-waiting-indicator">
    <span class="tool-invoking-dot"></span>
    <span class="tool-invoking-label">生成中</span>
  </div>
</div>
```

**idle-after-content（保持，微调可选）**

```html
<div class="row stream" id="stream-tail">
  <div class="bubble assistant ...">
    <!-- thinking / bubble-body 有内容 -->
    <div class="tool-invoking-bar">...</div>
  </div>
</div>
```

CSS（`transcript-html.ts`）：

- `.stream--waiting-first`：左对齐、无 assistant 气泡背景/圆角大壳；indicator 单行紧凑（复用 dot/label 样式或略缩小 padding）。
- 现有 `.tool-invoking-bar` 保留用于 `idle-after-content`。

### 关键修复：`setStreamToolInvokingDom`

**现状**（`main.ts` L1146–1150）：无 `#stream-tail` 时只写 `state.stream.toolInvoking`，不 `renderRows()`。

**改法**：

```javascript
function setStreamToolInvokingDom(active) {
  state.stream.toolInvoking = !!active;
  if (!document.getElementById('stream-tail')) {
    if (active || state.stream.text || state.stream.thinking) {
      renderRows();
    }
    return;
  }
  // 已有 tail：按 phase 更新 bar（或整行重绘若 phase 切换）
  ...
}
```

当 `active` 从 true→false 且 tail 仅为 `waiting-first` 空壳、无 content，可 `removeStreamTailDom()` 或 `renderRows()` 清掉。

**phase 切换**：首 delta 到达时 `appendStreamDelta` 已有 `renderRows()` 路径；需保证从 `waiting-first` 结构 **升级** 为带 `.bubble` 的结构，不丢失已 append 的 text/thinking。

### legacy RN：`MessageList.tsx`

1. stream 行条件不变：`(streamingText || streamingThinking || toolInvoking)`。
2. `renderStreamItem` 分支：
   - `toolInvoking && !hasStreamContent` → 仅 `<ToolTurnPhaseBar />`（或 wrapped compact row），**不**调用 `renderAssistantBubble` 空气泡。
   - 否则 → 现有 `renderAssistantBubble(..., { showToolInvoking: toolInvoking && hasStreamContent })`  
     （idle bar **仅**在已有内容时显示；有内容无 idle 时不显示 bar）。
3. scroll effect（L312–317）：依赖数组增加 `toolInvoking`，纯 idle 出现时可贴底。

### RN 接线（不变更语义）

`ChatConversationPanel` 仍传 `toolInvoking={streamTailGenerating}`；本期 **可选** 在注释中标注别名，全局 rename 非阻塞。

`ChatTranscriptWebView`：`toolInvoking` effect → `streamToolInvoking` 不变。

### Core / Hook

**不修改** `compute-stream-tail-generating.ts`、`useStreamTailGenerating.ts` 行为。

## 最终项目结构

```
apps/mobile/src/web/chat-transcript/main.ts           # phase 分支、setStreamToolInvokingDom 修复、renderRows
apps/mobile/src/web/chat-transcript/transcript-html.ts # .stream--waiting-first CSS
apps/mobile/src/components/chat/MessageList.tsx       # legacy 分相渲染 + scroll
apps/mobile/__tests__/chat-transcript-boot-script.test.ts  # 守护 waiting-first DOM
apps/mobile/__tests__/chat-transcript-webview.test.tsx       # 纯 idle 触发 render
apps/mobile/__tests__/message-list-stream.test.ts     # 新建或扩展现有 legacy 测（若有）
```

## 变更点清单

| 路径 | 变更 |
|------|------|
| `main.ts` | 提取 `getStreamTailPhase()`；`renderStreamTailRow()` 按 phase 分支；`setStreamToolInvokingDom` 无 tail 时 `renderRows()`；`renderAssistantBubbleInner` 仅在 `idle-after-content` 追加 bar |
| `transcript-html.ts` | 新增 `.stream--waiting-first`、`.stream-waiting-indicator` 样式 |
| `MessageList.tsx` | stream 项分相；`showToolInvoking` 与 `hasStreamContent` 与运算；scroll deps |
| `chat-transcript-boot-script.test.ts` | 断言 waiting-first HTML 片段；phase 切换不破坏 `data-text-shell` 增量路径 |
| `chat-transcript-webview.test.tsx` | 可选：mock Web 回调验证 `streamToolInvoking` 后 state（DOM 级测在 boot-script） |

## 详细实现步骤

### Step 1 — WebView phase 辅助函数

在 `main.ts` 增加：

```javascript
function streamHasContent() {
  return (state.stream.text && state.stream.text.trim().length > 0) ||
    (state.stream.thinking && state.stream.thinking.trim().length > 0);
}
function getStreamTailPhase() {
  if (!state.stream.toolInvoking) return 'active';
  return streamHasContent() ? 'idle-after-content' : 'waiting-first';
}
```

### Step 2 — `renderRows` 中 stream tail 分支

替换 L874–881 单一 bubble 逻辑：

- `!streamHasContent() && !state.stream.toolInvoking` → 不渲染 tail
- `getStreamTailPhase() === 'waiting-first'` → 输出 compact `stream--waiting-first` HTML
- 否则 → 现有 `renderStreamBubbleInner()` bubble 路径；`renderAssistantBubbleInner` 内 **仅** `idle-after-content` 时 `renderToolInvokingBar()`

### Step 3 — `setStreamToolInvokingDom` / `appendStreamDelta`

- `setStreamToolInvokingDom(true)`：无 tail → `renderRows()`
- `setStreamToolInvokingDom(false)`：若 phase 变为 active 且无 content，移除 bar 或整行
- `appendStreamDelta`：首 delta 后若结构为 waiting-first，**必须** `renderRows()` 重建为 bubble 结构（已有逻辑 L1194–1197，回归测试）

### Step 4 — CSS

`transcript-html.ts` 增加 waiting-first 样式；与 `.row.assistant` 宽度对齐方式：左对齐、max-width 适中，**避免** 85% 空气泡。

### Step 5 — legacy MessageList

实现 Step 2 等价分相；补 scroll effect。

### Step 6 — 测试与手工

见下节。

## 测试策略

### 单元 / 集成

| ID | 场景 | 断言 |
|----|------|------|
| W1 | boot-script：`toolInvoking=true`，text/thinking 空 | HTML 含 `stream--waiting-first`；**不含** `bubble assistant` + 空 `bubble-body` |
| W2 | boot-script：有 thinking + `toolInvoking` | 含 `.bubble` + `.tool-invoking-bar`；**不含** `stream--waiting-first` |
| W3 | boot-script：waiting-first → append text delta | 结构升级为 bubble + body 有内容 |
| W4 | `use-chat-stream-runtime` 回归 | T11/T12 300ms idle 仍 pass（未改 hook） |
| W5 | legacy MessageList（新建或 snapshot） | `toolInvoking && !streamingText/Thinking` 不渲染 `bubbleFillWidth` 空气泡 |

### 手工（Android WebView）

| ID | 步骤 | 期望 |
|----|------|------|
| M1 | 发送后等待首字 | 轻量「生成中」，非空消息气泡 |
| M2 | 流式中停顿 | 内容保留 + 底部横条 |
| M3 | abort | tail 清除 |

### 回归

- `chat-transcript-boot-script.test.ts` 现有 rich/html 增量用例
- `build-transcript-rows.test.ts`（与 imperative tail 无关， smoke）
- metrics 条「生成中」文案（`use-agent-stream-metrics.test.ts`）

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| phase 切换时 DOM 重建丢失 stream 文本 | 切换前只改 shell，content 在 `state.stream`；`renderRows` 全量重建从 state 读 |
| waiting-first 与 scroll 贴底 | `renderRows` 后保留现有 stick-bottom 逻辑 |
| legacy / webview 视觉不一致 | PRD 允许细节差异，语义一致即可 |

**回滚**：还原 `main.ts`、`transcript-html.ts`、`MessageList.tsx` 三处；无数据迁移。
