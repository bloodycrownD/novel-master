---
date: 2026-06-13
dependency:
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/chat-workspace-agent-sync/prd.md
---

# Mobile 流式 tail 路径统一修复 PRD

## 背景

Android Mobile 在 **WebView transcript**、**富文本 Markdown 开启**、Agent 流式生成时，出现 **thinking 阶段平稳、正文阶段 RN 主线程卡死**（Tab/停止/metrics 冻结，WebView 内仍可滚动）。

thinking 与正文 **串行**、同泡、同管线。**thinking 已走通流式 rich**（`.thinking-body` 增量 + RN `prepareStreamTailHtml` + `streamDelta.html`），**不应改动**。卡顿来自 **正文独有 DOM 退化**：

1. 仅有 thinking 时 **无 `.bubble-body` 占位**，首字 text 增量失败 → **`updateStreamBubble` 整泡重建**（thinking 区块一并重绘）。  
2. 正文 tail 更长，整泡重建叠加 RN 全文 md 后成本放大。

本迭代 **最小 diff**：**正文 DOM 对齐 thinking**（预置 `.bubble-body`、走同一套增量 + `html` 路径），**保留流式 rich**（RN `prepareStreamTailHtml` + bridge `html` **均保留**；thinking **零行为变更**）。  
不引入 pacer、不把 Markdown 迁 Web。若高吞吐仍不足，见 [`mobile-stream-display-pacing`](../mobile-stream-display-pacing/prd.md)。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 消除「正文一开就卡」 | thinking 结束后正文流式 30s+，Tab/停止 **10s 内** 可响应 |
| 正文对齐 thinking | 正文走 **`.bubble-body` 增量**（含 `html` / `innerHTML`），与 thinking 同模式；禁止 text 整泡重建 |
| **保留流式 rich** | rich 开：thinking / 正文流式预览 **与现网 thinking 一致**（非 plain） |
| thinking 零回归 | thinking 阶段：**与现网完全一致**（RN / Web 均不改行为） |
| 落库 rich 不退化 | snapshot 后该行 rich 与现网一致 |
| 数据一致 | 流式结束屏上正文+思考与落库 **逐字一致** |

## 用户与场景

- **用户**：Mobile Agent 对话用户  
- **场景**：WebView transcript + rich 开 + 长 thinking + 长正文（GLM-4.7 等）  
- **非目标**：legacy RN `MessageList` 大改、U-A-U-A snapshot 节流、迭代二 pacer / Web reconciler

## 范围

### 包含

- Web `main.ts`：预置空 **`.bubble-body`**；**正文** `appendStreamDeltaIncremental` 对齐 thinking（支持 `html`）  
- RN `ChatTranscriptWebView.tsx`：**不改** `prepareStreamTailHtml` / `streamDelta.html` 逻辑（thinking 不动；正文 path 修好后自然走同路径）  
- 相关单测与真机验收  

### 不包含

- 删除 / 禁用 RN 流式 `prepareStreamTailHtml`  
- 流式改 plain  
- `StreamDisplayPacer`、Web `StreamMarkdownReconciler`、metrics 迁 WebView  
- Core SSE 改造  

## 核心需求

1. 建 stream tail 时预置空 **`.bubble-body`**，与 `.thinking-body` 对称。  
2. **正文**与 thinking 一致：有 `html` 时更新 **`.bubble-body` `innerHTML`**；否则 `insertAdjacentHTML` 追加 delta；禁止 text 回退 `updateStreamBubble`（仅 `#stream-tail` 不存在时 `renderRows` 一次）。  
3. RN **保留** `prepareStreamTailHtml` + `streamDelta.html`（thinking + 正文，与现网一致）。  
4. `hasText` 0→1 只更新 bubble class / 展示 `.bubble-body`，不重建 thinking innerHTML。  
5. 保留 bus 32ms + RAF；**不引入** pacer。  

## 验收标准

- **G1** rich 开、仅 thinking 阶段：**与现网一样平稳**（含流式 rich）。  
- **G2** thinking 结束后正文流式 30s+（高吞吐模型）：Tab/停止/metrics **可响应**，无长期假死；正文流式 **rich 预览** 可用。  
- **G3** 流式结束、snapshot 刷新后：该行 rich 与现网一致。  
- **G4** 流式结束：屏上正文+思考与落库逐字一致。  
- **G5** 回归：tool / 贴底 / prepend / appendTailRows 与现网一致。  
- **G6** 相关单测绿；无 debug ingest 残留。  

## 后续迭代

若 G2 在 **100+ 字/秒** 仍不满足 → [`mobile-stream-display-pacing`](../mobile-stream-display-pacing/prd.md)（pacer + 将 md 计算迁至 Web reconciler，减轻 RN JS）。
