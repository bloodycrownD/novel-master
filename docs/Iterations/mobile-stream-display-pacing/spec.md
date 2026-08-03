---
date: 2026-06-13
---

# Mobile 流式显示节拍（Stream Display Pacing）技术规格（SPEC）

## 前置条件

- [`mobile-stream-text-path-fix`](../mobile-stream-text-path-fix/spec.md) **已合入**（正文 DOM 对齐 thinking；**保留** RN 流式 rich）。  
- 真机高吞吐仍卡，或需将 md 计算迁出 RN JS（见 PRD 启动条件）。

**基线分支**：`feature/vfs-user-ops-unified-tool-turn`（含迭代一改动）。

---

## 设计目标

1. **Wire / Display 分层**：全速 `enqueue`，50ms×3 字 `release`（有界 Pull；thinking + text FIFO）。  
2. **RN 主线程 O(1)/tick**：不过桥大 html、不 tail Markdown；Bus 回调仅入队。  
3. **WebView**：reconciler（**thinking + 正文**）+ metrics + 增量 DOM；Markdown 在 WebView 线程，与 RN JS 并行。  
4. **双路径**：WebView transcript 与 legacy List 共用 `StreamDisplayPacer`。  
5. **单一 display 节拍源**：pacer 取代 bus 32ms 与 WebView RAF 的 display 合并职责。  
6. **计算迁移（相对迭代一）**：迭代一保留的 RN `prepareStreamTailHtml` → 本迭代起由 Web `StreamMarkdownReconciler` 接管（thinking + 正文；复用 `prepareTranscriptRichHtml` 规则）。
7. **可观测流畅性目标**：除 RN 可交互外，需以 `stream-perf` + Web `Performance` 对照验证 `paintMs` 改善。

---

## 概念模型：Bounded Pull Queue

RN JS 为单线程事件循环。**有队列 ≠ 不卡死**——无界同步 `release(全部 backlog)` 仍会饿死 UI 事件。

| 角色 | 职责 | 约束 |
|------|------|------|
| **Producer（wire）** | EventBus → `pacer.enqueue(kind, delta)` | O(1) 返回；不丢字 |
| **Consumer（display）** | 每 `DISPLAY_TICK_MS` → `release(≤CHARS_PER_TICK)` | 有界；禁止单 tick 排空全部 backlog |
| **Drain** | `run finished` 后 `release(≤DRAIN_CHARS_PER_TICK)` | 直至 backlog 空 |

**实现等价**：`setInterval` 驱动 `release()` ≡ `async while (backlog) { release(); await nextFrame(); }`——语义相同，任选其一。

网络 / SSE 层保持 **Push**；仅 **display 层** 采用 Pull 配额。thinking / 正文 **共用一条 FIFO**，与 wire 串行一致。

---

## 参考：RikkaHub 映射（节选）

| RikkaHub | 本迭代 |
|----------|--------|
| `mapLatest` + Default 线程 Markdown | Web `StreamMarkdownReconciler`（WebView 线程；thinking + 正文） |
| 无 display pacer | **自研** 50ms×3 字（RN bridge 需此层） |
| SSE node diff | `streamDelta` 仅 delta；`streamStats` 可观测积压 |

---

## 架构

```
Core SSE (Push, 32ms) → parser → EventBus (sync publish)
     ↓ queueMicrotask
useChatTabStream: pacer.enqueue（全收，FIFO：thinking → text 串行）   ← Bus 回调仅如此
     ↓ 每 DISPLAY_TICK_MS（唯一 display 节拍）
pacer.release(≤3 chars) → postMessage streamDelta（无 RAF 二次 batch）
     ↓
Web: appendStreamDelta（delta 增量）
     + StreamMarkdownReconciler(200ms) → .thinking-body / .bubble-body innerHTML（rich）
     #stream-metrics
legacy List: setStreamingText/Thinking
```

**常量**：`DISPLAY_TICK_MS=50`，`CHARS_PER_TICK=3`，`DRAIN_CHARS_PER_TICK=9`，`RECONCILE_MS=200`，`STREAM_STATS_INTERVAL_MS=250`（可选）。

### 与现有节流层关系

| 层级 | 迭代二处理 |
|------|------------|
| Core `SseChunkEmitter` 32ms | **保留**（XHR burst 进 JS，网络侧） |
| `useChatTabStream` bus `setTimeout(32ms)` | **移除或 bypass**（pacer 已承担 display 合并） |
| `ChatTranscriptWebView` RAF batch | **移除**（`onRelease` 直接 `postMessage`；每次 ≤3 字已够轻） |
| `StreamDisplayPacer` 50ms | **唯一 display 节拍源** |

KKV `chatStreamDisplayPacing=false` 时回退迭代一（恢复 bus 32ms + RAF，无 pacer、无 reconciler）。

---

## 核心模块

### `stream-display-pacer.service.ts`（新建）

- `enqueue(kind, text)` — 追加至 FIFO backlog；`wireChars += len`；不丢字  
- `start()` / `stop()` — 启动/停止 tick；`stop` 进入 drain 模式  
- `release(maxChars)` — 从 FIFO 取出 ≤maxChars，回调 `onRelease(kind, slice)`  
- `stats()` — `{ wireChars, displayedChars, backlogChars }`  
- tick 驱动：`setInterval(DISPLAY_TICK_MS)` 或 `async` + `await nextFrame()`（二选一）

### `useChatTabStream.ts`

**Bus handler 契约（强制）**：

```ts
handleStreamText(delta) {
  pacer.enqueue('text', delta);
  noteMetricsRef(delta);
  if (!pacer.running) pacer.start();
}
// handleStreamThinking 同理 → enqueue('thinking', delta)
```

- **禁止**在 Bus 回调内：`prepareStreamTailHtml`、`setStreamingText`、`postMessage`、字符串拼接以外的重活  
- `onRelease` → WebView `pushStreamDelta` / legacy `setStreamingText`  
- WebView 模式：metrics **不** `setState` 父组件  

### `ChatTranscriptWebView.tsx`

- 删除 `flushPendingStreamDeltas` / RAF stream batch（pacer 已限幅）  
- `pushStreamDelta`：`postMessage` 纯 `{ kind, delta }`（≤3 字/次；thinking / text 同形）  
- 可选：每 `STREAM_STATS_INTERVAL_MS` 发 `streamStats`（低频）  

### Web `stream-markdown.ts` + `main.ts`

- `StreamMarkdownReconciler`：对 `state.stream.thinking` 与 `state.stream.text` **分别** mapLatest + `RECONCILE_MS` 节流（或共享调度器、两路 content）  
- 输出：更新 `.thinking-body` / `.bubble-body` 的 `innerHTML`（delta 增量 + reconcile 周期性 tail parse；**替代**迭代一 RN 每 RAF 全文 md）  
- 算法：复用 `prepareTranscriptRichHtml` 等价逻辑（`markdown-it` + sanitize），打包进 Web bundle  
- parse 在 **WebView JS 线程**；**禁止**结果经 RN `prepareStreamTailHtml` 回传 `html`  
- `#stream-metrics`：生成中 / wire 字数 / 已显示 / 积压 / **display 瞬时字/秒**  

### `ChatConversationPanel.tsx`

- webview 模式隐藏 RN `ChatStreamMetricsBar`  

### Bridge

```ts
streamDelta: { kind: 'text' | 'thinking'; delta: string }

streamStats?: {
  wireChars: number;
  displayedChars: number;
  backlogChars: number;
  displayCharsPerSec: number;
  elapsedMs?: number;
}
```

**Bridge 预算**：单条 `streamDelta.delta.length ≤ DRAIN_CHARS_PER_TICK`（drain 时 ≤9）；禁止 `html` 字段。

### 观测契约

- 持续输出并保留以下观测事件：`web_delta_trace`、`paint_after_rich`、`stream_perf_window`。  
- 在 `stream_perf_window` 或等价统计中增加/要求 `reconcileMs`（reconciler 单次耗时）指标。  
- 流畅性判断采用 `paintMs` 与 `reconcileMs` 的分位值（至少 p95）+ 阻塞事件计数，不得仅凭 `incrementalMs` 下结论。  
- 对比实验统一使用同模型、同 prompt、同设备，分别记录 pre-fix / post-fix 数据。

### Backlog 与内存

- 与「不丢字」一致：**不设 backlog 硬截断**。  
- `backlogChars` 供真机观测；可选「显示追赶中」提示。

---

## 项目结构

```
apps/mobile/src/services/stream-display-pacer.service.ts
apps/mobile/src/web/chat-transcript/stream-markdown.ts
apps/mobile/src/screens/tabs/chat-tab/useChatTabStream.ts
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
apps/mobile/src/web/chat-transcript/main.ts
apps/mobile/src/web/chat-transcript/transcript-html.ts
apps/mobile/__tests__/stream-display-pacer.service.test.ts
apps/mobile/__tests__/stream-markdown.test.ts
```

---

## 实现步骤

1. **Pacer** + 单测（enqueue / release / drain / stats / FIFO）  
2. 接入 `useChatTabStream`：Bus → enqueue；移除 bus 32ms batch  
3. `ChatTranscriptWebView`：移除 RAF batch；`onRelease` 直发  
4. Web reconciler（thinking + 正文）+ `#stream-metrics` DOM  
5. RN 隐藏 metrics 条；KKV 开关  
6. 真机 GLM-4.7 + 回归（含 G7 rich 预览）  

---

## 测试

| 用例 | 断言 |
|------|------|
| 500 字/秒 enqueue 5s | display ≤325；drain 后 displayed === wire |
| release 永不超配额 | 每 tick `slice.length ≤ CHARS_PER_TICK`（drain ≤9） |
| FIFO 混排 thinking+text | 按入队顺序释放，不交错打乱 |
| reconciler thinking / text | 快速 append 后仅末次 tail parse 生效（mapLatest） |
| 观测事件完整性 | 可采集 `web_delta_trace` / `paint_after_rich` / `stream_perf_window` 且含 `reconcileMs` |
| 流畅性判定约束 | 不能仅以 `incrementalMs` 通过，需结合 `paintMs` 与 `reconcileMs` 分位值 |
| Bus handler 轻量 | mock：单次 publish 不触发 markdown / setState |
| KKV false | 回退迭代一（bus 32ms + RAF，无 pacer、无 reconciler） |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 60 字/秒偏慢或 rich 过频 | 先调 `RECONCILE_MS` 控制 rich 频率，再调 `CHARS_PER_TICK` / `DISPLAY_TICK_MS` |
| U-A-U-A snapshot 叠加 | follow-up defer snapshot |
| reconciler 双 kind 重复 parse | 共享调度器；thinking / text 分 content 槽 |
| 误以为队列即可防卡死 | 文档与单测强调 **有界 release** |

**回滚**：KKV `chatStreamDisplayPacing=false` → 迭代一行为（无 pacer、无 reconciler、RN 流式 rich、bus 32ms + RAF、RN metrics）。

---

## 可选演进（本迭代不做）

### 流式期 defer `sessionSnapshot`

U-A-U-A 全量 snapshot 与 display 叠加时的 follow-up。

### WebView 直连 SSE

绕过 RN Bus；需重复 session/auth 与 core 协议，成本高。

### Kotlin Native 喂 Web

- **不采纳理由（本迭代）**：瓶颈在 RN JS 控制面；WebView reconciler 已挪走 Markdown CPU。  
- **再评估条件**：pacer + reconciler 后 PRD G2 仍失败，且 profiling 证明 **Bridge 为瓶颈**。  

---

## 检查清单

- [ ] Pacer 不丢字；每 tick ≤65 字/秒（常规定额）  
- [ ] bus 32ms / WebView RAF display batch 已移除（或 KKV off 时恢复）  
- [ ] Bus 回调仅 enqueue + ref  
- [ ] reconciler 覆盖 **thinking + 正文**；无 RN 流式 `prepareStreamTailHtml`  
- [ ] Web metrics 可见；RN metrics 隐藏（webview）  
- [ ] 已完成同模型、同 prompt、同设备的 pre-fix vs post-fix 对照（含 `paintMs`/`reconcileMs` 分位值）  
- [ ] 真机 G1–G7  
