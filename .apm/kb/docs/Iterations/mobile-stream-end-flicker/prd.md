---
date: 2026-06-29
dependency:
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/mobile-chat-stability-fixes/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
  - Iterations/mobile-stream-tail-waiting-ui/prd.md
  - Iterations/chat-rich-render/prd.md
---

# Mobile 流式结束频闪修复 PRD

## 背景

Mobile 聊天默认使用 **WebView transcript 引擎**（`chatTranscriptEngine = webview`）。流式进行中已通过 imperative `streamDelta` / 增量 DOM 避免整页重绘；但 **流式结束** 时，用户仍可能感知到 **内容短暂消失、列表闪一下、贴底时跳动**。

代码与历史迭代走读表明，结束瞬间存在三类结构性问题：

1. **时序间隙**：`flushRunUi` / `flushAgentStepUi` 设计为「先 reload 落库消息、再清 stream overlay」，但在 Agent 仍 busy 时 `handleMessagesChanged` 可能 **200ms 防抖且不 await**，`handleStreamReset` 却 **同步执行** → stream tail 先消失、持久化行后到达。
2. **双次全量重绘**：WebView 侧 `streamReset` 与随后的 `sessionSnapshot` / `appendTailRows` 分两次 postMessage，各自触发 `renderRows()`（`#rows` 整表 `innerHTML` 替换）→ 可见频闪。
3. **结束路径未统一增量**：流式进行中纯文本 assistant 已支持 `appendTailRows`；结束链路却常走 `streamReset` 清 tail 后再 snapshot，未做到 **单次平滑过渡**。

历史迭代 **`mobile-chat-stability-fixes`** 曾将「流式结束持久化 → 无明显位置跳变或高度闪动」列为验收目标；**`stream-display-rewrite`** 草案中的 `flushing` 态（reload 完成前暂保留 tail）与本问题同族，但 **本期基于 main 上 WebView 路径做小步修复**，不引入 library 重写。

**与 rich 开关关系**：`chat-rich-render` 约定流式期预览与落库富文本可能版式不同；本期 **不消除** 该有意差异，仅消除 **空白帧 / 双次重绘 / 内容消失** 类频闪。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 结束无内容空窗 | 纯文本 assistant 单轮结束：transcript 底部 **不出现** stream tail 消失后、落库消息出现前的 **可见空白间隙** |
| 结束无双闪 | 同上场景：用户 **主观感知** 为一次平滑过渡，而非「闪两下再稳定」 |
| 贴底不跳 | 用户贴底跟随流式输出时，结束瞬间 **滚动位置不突跳**（允许 rich 版式微调，不允许整表闪白） |
| 多步 Agent 不退化 | 含 `tool_use` / `tool_result` 的回合：工具卡 pending/success 状态正确，**无** ghost stream tail、**无**双气泡 |
| 回归流式期性能 | 流式进行中仍走增量 DOM；**不**恢复 RN `streamingText` 整页重绘路径 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 单轮纯文本 Assistant 回复流式结束，贴底阅读 |
| 日常写作用户 | 多轮 Agent（含 tool call）逐步结束，每步 assistant 落库后 stream tail 清除 |
| 调试用户 | 上翻阅读历史时 Agent 在底部结束，**不要求**本期消除非贴底锚点微动（P2 follow-up） |

## 范围

### 包含范围

1. **Mobile WebView transcript（P0）**：修 reload/reset 时序；合并结束时的 DOM 更新为 **单次可见过渡**；纯文本 assistant（无 `tool_use`）结束优先 **单行增量**（tail → 落库行），避免双次 `renderRows`。
2. **Mobile RN 编排层（P0）**：`flush-run-ui`、`useChatTabMessages`、`useChatStreamRuntime`、`ChatTranscriptWebView` 中与结束收尾相关的时序与 bridge 消息协调。
3. **多步 Agent（P0）**：`STEP_COMMITTED(assistant)` 与 `RUN_FINISHED` 路径均满足「reload 完成后再 reset / 或原子 commit」；`tool_results` 阶段仍 **只 reload、不 reset stream**（现网契约不变）。
4. **自动化测试（P0）**：覆盖时序、bridge 消息顺序、纯文本 appendTail / 原子 commit、tool 回合 full snapshot 回归。
5. **legacy RN MessageList（P1）**：**不回退恶化**；若改动触及共享 flush 逻辑，legacy 路径 **不新增** 可见空窗（不要求与 WebView 同等优化）。

### 不包含范围

- **Desktop** 端 transcript 对称改造。
- **`stream-display-rewrite`** library 路径、RN External Store 大改。
- **plain → rich 版式跳变** 消除（`chat-rich-render` 有意行为；属 follow-up）。
- **流式中途** pacing / reconciler / 高吞吐 freeze（`mobile-stream-display-pacing` 范畴）。
- **`chatStreamBatchEnabled`** 默认行为变更（仅保证 batch/delta 两种模式结束行为一致）。
- prop 重命名、metrics 条、300ms idle 等待 UI 分相（已由 `mobile-stream-tail-waiting-ui` 覆盖）。

## 核心需求

1. **结束 reload 与 reset 同步（#1）**  
   在 `STEP_COMMITTED(assistant)` 与 `RUN_FINISHED` / `RUN_FAILED` 收尾路径上，**保证落库消息已进入 RN `chatMessages`（或等价数据源）之后**，再清除 stream overlay；禁止 agent busy 时 200ms 防抖导致 reset 抢先于 reload。

2. **结束单次 DOM 过渡（#2）**  
   WebView 结束路径 **合并** stream 清除与落库行写入，使用户可见 **至多一次** 列表级重绘（或等价单次 rAF 内 DOM 更新）；避免 `streamReset` 与 `sessionSnapshot` 连续两帧全量 `renderRows`。

3. **纯文本 assistant 单行 patch（#3）**  
   无 `tool_use`、无 `tool_result` 的 assistant 落库：优先 **原位** 将 stream tail 转为落库 message 行（或 `appendTailRows` + 同步清 stream，同一 bridge 回合），**不**先空白再插入。

4. **tool 回合保持 full snapshot**  
   assistant 含 `tool_use` 或新增 `tool_result` user 消息时，仍走 **`sessionSnapshot('preserve')`**，以刷新既有行 `toolPhase`；本期 **不** 强行 appendTail/patch。

5. **滚动与幂等**  
   合并重绘须保留 `preserve` 滚动意图；重复 `resetStream` / 重复 flush **幂等**，不产生 ghost tail 或双气泡。

6. **双引擎边界**  
   WebView 为验收主路径；legacy 仅保证共享 flush 时序修复后 **无新增** 空窗。

## 验收标准

### 纯文本单轮结束（WebView，rich 关，贴底）

1. **Given** 默认 WebView、单轮纯文本 Assistant 流式输出且用户贴底，**When** run 正常结束，**Then** 正文 **不消失**，**Then** 无肉眼可见「闪两下」或整表白闪，**Then** 滚动位置保持贴底。

2. **Given** 同上，**When** 结束完成，**Then** 屏上最后一条 assistant 与 DB 落库内容 **逐字一致**（沿用 `mobile-stream-text-path-fix` G4）。

### 多步 Agent（WebView）

3. **Given** 含 tool call 的多步 run，**When** `STEP_COMMITTED(assistant)` 落库，**Then** stream tail 清除且 **无** 与 DB assistant 并存的 stream 双泡。

4. **Given** 同上，**When** `tool_result` 落库，**Then** 工具卡 pending → success 状态正确，**且** 此阶段 **不** 误清下一轮 stream tail。

5. **Given** 含 `tool_use` 的 assistant 落库，**When** 消息同步至 WebView，**Then** 走 full snapshot，工具卡 `toolPhase` 正确。

### 时序与回归

6. **Given** Agent 仍 busy 时发生 `STEP_COMMITTED(assistant)`，**When** flush 执行，**Then** `streamReset` **不早于** reload 完成（自动化断言或 bridge 顺序单测）。

7. **Given** 流式进行中，**When** 持续 delta，**Then** 仍走增量 DOM，**不** 因本期改动增加 `sessionSnapshot` 频率。

8. **Given** legacy-rn 引擎，**When** 纯文本单轮结束，**Then** **不劣于** 现网（无新增明显空窗）。

### 非目标（本期不验收）

9. **Given** `chatRichText=true`，**When** 流式结束，**Then** 允许 preview → 落库富文本的 **版式差异**；仅要求 **无空白帧** 与 **无双闪**。

10. **Given** 用户上翻非贴底，**When** 底部 run 结束，**Then** 本期 **不强制** 锚点像素级不动（follow-up）。

## 约束与依赖

- 前置架构：**WebView transcript**（`mobile-webview-chat-transcript`）、**lifecycle**（`agent-run-lifecycle-unify`）、**等待 UI 分相**（`mobile-stream-tail-waiting-ui`，已合并 main）。
- 与 **`stream-display-rewrite`** 关系：本期为 WebView 路径补丁；若未来合入 rewrite，本 PRD 验收项由 rewrite 状态机承接。
- 建议分支：`fix/mobile-stream-end-flicker`。

## 风险与待确认项

| 风险 | 说明 |
|------|------|
| `uiRunning` vs `agentActive` 双标志 | snapshot 路由与 reload 合并使用不同信号；实现须统一收尾语义 |
| rich 开路径 | 单行 patch 须携带 `textHtml`/`thinkingHtml`；复杂度高，可二期增强 |
| 真机主观频闪 | 需 Android 手工录屏对比基线 |
