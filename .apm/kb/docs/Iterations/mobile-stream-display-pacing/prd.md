---
date: 2026-06-13
dependency:
  - Iterations/mobile-stream-text-path-fix/prd.md
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/chat-workspace-agent-sync/prd.md
---

# Mobile 流式显示节拍（Stream Display Pacing）PRD

## 背景

[`mobile-stream-text-path-fix`](../mobile-stream-text-path-fix/prd.md) 通过 **正文 DOM 对齐 thinking**（预置 `.bubble-body`、增量 rich）修复整泡重建；**保留** RN `prepareStreamTailHtml` 流式 rich。若真机验收后，在 **极高 wire 吞吐（100+ 字/秒）** 或 **U-A-U-A 全量 snapshot 叠加** 场景下 RN 主线程仍不可交互，则需要 **第二层：有界 Pull 队列 + 将 Markdown 计算迁至 WebView reconciler**。

### pre-fix 观测基线

- `paint_after_rich` 的 `paintMs` 常见约 **32-34ms**。  
- `incrementalMs` 通常约 **0-1ms**，说明 append 同步逻辑并非主瓶颈。  
- `text` 期可能与 `thinking` 交错，导致同一窗口内多次 rich paint。  
- `queueMs` 常见约 **35-40ms**，偶发更高，表现为主线程阶段性饱和。

**为何现有 32ms 节流仍不够**：Core `SseChunkEmitter` 与 bus 32ms 只限制 **触发次数**，不限制 **单次字数**；burst 时单次仍可灌入数百字。RN JS 为单线程事件循环——若无 **按字配额** 的有界消费，长同步任务会 **饿死** 点击/Tab/停止（卡死），而非 merely「显示慢」。队列缓存的是未显示的 delta，**不能**代替有界消费；必须 **wire 全收 + display 限幅** 才能把「卡死」与「落后」分开。

本迭代引入 **有界 Pull 队列**（50ms × 3 字 ≈ 60 字/秒 display）、**WebView 流式 metrics**、**Web 侧节流 Markdown reconciler（thinking + 正文统一）**，使 RN 主线程每 tick 工作量与 tail 长度、模型 burst 解耦；**将原 RN `prepareStreamTailHtml` 的计算迁至 WebView 线程**。

## 目标（含成功指标）

| 维度 | 目标 | 成功指标 |
|------|------|----------|
| **交互性** | RN 主线程不被饿死 | 流式 30s+、wire 100+ 字/秒时 Tab/停止 **点击后 100ms 内有反馈**；无长期整页假死 |
| **显示性** | 平稳、有界释放 | display **≤ 65 字/秒**（50ms×3 字）；burst 不单帧经 bridge 灌数百字；`backlogChars` 可涨 |
| **完整性** | 不丢字 | wire 全速入 backlog；流结束 drain 后 display === wire |
| **流式 rich** | thinking + 正文 Web 内预览 | reconciler 接管 md（自迭代一 RN `prepareStreamTailHtml` 迁出）+ 节流 |
| **可观测** | 区分 wire / display / 积压 | metrics 展示 wire 总量、已显示、积压、**display 瞬时速率**（非累计平均） |

## 用户与场景

- **前置**：迭代一已合入  
- **场景**：同迭代一（WebView + rich + GLM-4.7）+ 可选 U-A-U-A 多轮 tool  

## 范围

### 包含

- `StreamDisplayPacer`：backlog + 50ms×3 字 + drain 9 字/tick（有界 Pull；thinking + text FIFO）  
- 移除与 pacer 重复的 display 节流（bus 32ms batch、WebView RAF batch）  
- WebView + legacy List **共用** pacer  
- RN 流式 **停** `prepareStreamTailHtml` / `html`（自迭代一保留态迁出）；metrics 条迁入 WebView  
- `StreamMarkdownReconciler`（Web，thinking + 正文；mapLatest + 200ms 节流）  
- 单测、真机、KKV 回滚开关  

### 不包含

- Core SSE 生产端改造（网络层保持 Push；display 层 Pull）  
- WebView 直连 SSE / Kotlin native 喂流（见 SPEC 可选演进）  
- U-A-U-A snapshot 节流（可单列 follow-up）  
- Desktop / CLI  

## 核心需求

1. **不丢字**：wire 全速 `enqueue`，禁止丢弃 thinking / 正文；不设 backlog 硬截断。  
2. **有界 Pull**：每 50ms `release(≤3 字)`（thinking + text 合计 FIFO）；禁止无界同步排空 backlog。  
3. **允许落后**：显示可 lag 于 wire；流结束 drain 加速（9 字/tick）直至 backlog 空。  
4. **RN 薄壳**：Bus 回调仅 `enqueue` + ref 计数；无 tail Markdown、无 `setState` 父树。  
5. **Web 厚渲染**：增量 DOM + reconciler（**`.thinking-body` + `.bubble-body`**，WebView 线程）；`#stream-metrics` 展示生成中/字数/积压/display 速率。  

## 验收标准

- **G1** 注入 500 字/秒 fixture 10s：bridge display ≤ 65 字/秒；drain 后 display === wire。  
- **G2a（RN 交互性）** GLM-4.7 真机 30s+：Tab/停止连续可点（**100ms 内反馈**）；允许屏上落后 wire（`backlogChars` > 0）。  
- **G2b（WebView 流畅性）** 同一会话下对照 `stream-perf` + `Performance`：`paint_after_rich.paintMs` 分位值（至少 p95）相较 pre-fix **显著下降**（建议 **下降 >= 40%** 或低于可接受阈值）。  
- **G3** 流式结束：drain 完成后屏上与落库逐字一致。  
- **G4** legacy RN List 共用 pacer、不崩溃。  
- **G5** 回归 tool/贴底/prepend/appendTailRows 与迭代一一致。  
- **G6** `chatStreamDisplayPacing` KKV 可回滚至迭代一行为。  
- **G7** rich 开：thinking 与正文流式阶段均有 **可接受的 rich 预览**（reconciler 生效，无 RN `prepareStreamTailHtml`）。  
- **G8（管线阻塞）** 30s 流式中 `stream_pipeline_stalled` 为 **0**（或相对 pre-fix 显著下降）。

## 验证与对比方法

- 使用**同模型、同 prompt、同设备**进行 pre-fix / post-fix 对照。  
- 每组对照同时采集 `stream-perf` 与 Web `Performance`，统一关注 `paint_after_rich`、`stream_perf_window`、`web_delta_trace`。  
- 结论以分位值（至少 p95）与阻塞事件计数为主，不仅看均值或主观体感。

## 与迭代一关系

| 迭代一已做 | 本迭代叠加 |
|------------|------------|
| 对称 DOM；RN 流式 rich（`prepareStreamTailHtml`） | pacer 限幅；RN 停流式 html |
| 正文增量对齐 thinking | metrics 迁 Web + `streamStats` |
| snapshot rich | **thinking + 正文** Web reconciler（md 在 WebView 线程） |

## 启动条件（满足其一）

1. 迭代一 **G2 未通过**：GLM-4.7 高吞吐（约 100+ 字/秒 burst）下 Tab/停止长期假死。  
2. 迭代一 G2 在 ~70 字/秒 OK、100+ 失败（吞吐敏感）—— 直接启动本迭代。  
3. profiling 表明 RN `prepareStreamTailHtml` 仍为高吞吐瓶颈（迭代一 path fix 后）。
