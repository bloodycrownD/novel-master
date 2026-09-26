---
date: 2026-09-23
---

# 会话指标条 token 化改造 技术规格（SPEC）

需求来源：`docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/prd.md`（用户拍板方向 + 探索报告 2026-09-23）。

## 设计目标

指标条改「输出 N t · M t/s」：token 源 usage 优先 / heuristic 兜底 / 终值校正；速率为时间窗口实时值；双端落地；中断现场可恢复。

## 总体方案

### 数据流总览

```
parser（协议层）──usage 事件（携带 LlmTokenUsage，completionTokens 累计，step 口径）──▶ agent-runner 透传
  ──EVENT_AGENT_STREAM_USAGE──▶ mobile: manager→unit.ingestUsage（合批）
                              ▶ desktop: forward-event-bus→IPC→hook.ingestUsage（节流）
step done（无论协议）：runner 把该步 LlmChatResult.usage 并入 run 级累计器，
  补发一条 run 级累计 usage 事件（同 EVENT_AGENT_STREAM_USAGE、source=usage）
每 delta：heuristic 按累计字符长度取 ceil（ceil(totalLen/3.35)）→ usage 事件到达覆盖校正（source=usage 优先）
  openai：流中零 usage 事件段由 heuristic 撑，step done 补发到达时终值校正跳正
速率：core 纯函数 slidingWindowRate(samples)，输入 (t, cumulativeTokens) 序列
```

### 1. 协议层 usage 事件（core）

- `LlmStreamEvent` 增变体 `{ type: "usage"; usage: LlmTokenUsage }`（`adapter.port.ts`）。`LlmTokenUsage = MessageUsage`（`adapter.port.ts` 类型别名），输出侧字段实名 `completionTokens`（`domain/chat/model/message-usage.ts`）——`usage-parser.ts` 三协议解析产物已统一归一为该命名，不存在 `outputTokens` 字段；变体直接携带整个 usage 对象，消费侧取 `completionTokens` 累计值。
- anthropic：`anthropic-sse-parser` 在 `message_delta` 到达处（现有 `messageDeltaRaw` 覆盖存储点）同步 `parseAnthropicUsage` 输出侧并 emit——数据已在手，仅加 emit。
- gemini：`gemini-sse-parser` 每块（`streamRaw` 覆盖存储点）parse `usageMetadata` 输出侧并 emit。
- openai：**协议层不新增流中事件**（协议限制仅最后一块）；`done` 的 `LlmChatResult.usage` 是终值——**由 runner 在 step done 后补发事件**（落点见第 2 节「done 补发」），协议层零改动。
- parser 层不节流（协议层纯粹）；事件风暴由上层合批/节流吸收（mobile unit 既有 32ms ingress 合并、desktop hook 新增同量级节流）。emit 条件：累计值发生变化才发（gemini 每块必变则每块发，由上层合批兜住）。

### 2. 事件面（core + desktop 四处登记）

- `event-types.ts` 新增 `EVENT_AGENT_STREAM_USAGE`，payload：`{ sessionId, runId, completionTokens（run 级累计）, source: "usage" }`（字段名对齐 `LlmTokenUsage` 输出侧实名，全文统一用 `completionTokens`，不引入 `outputTokens` 命名）。
- `agent-runner.ts` 三件事：
  - **流中透传**：`wrapStreamForBus`/`scheduleStreamPublish` 透传新事件，step 口径累计值交给 run 级累计器换算。
  - **run 级累计器外提**：`wrapStreamForBus` 现状在 step 循环内每 step 重建（`agent-runner.ts` 的 `for (let step ...)` 循环体内），跨 step 累计器必须外提到 step 循环之上、随 run 生命周期存取（经 deps 扩展传入），把每 step 的累计值换算为 run 口径（多 step 累加）；payload 直接带 run 级累计 `completionTokens`，消费端零算术。
  - **done 补发（openai 终值校正的落点）**：每个 step 的请求 done 后（**无论协议**），runner 把该步 `LlmChatResult.usage` 的输出侧并入 run 级累计器，经事件总线补发一条 run 级累计 usage 事件（复用 `EVENT_AGENT_STREAM_USAGE`、source=usage），双端走既有 `ingestUsage` 管线。openai 流中无事件段由 heuristic 撑、done 补发到达时终值校正；anthropic/gemini 的 done 终值与流中累计一致，覆盖无害。**不走 FINISHED 链**——`AgentRunFinishedPayload` 现状不带 usage，且 usage 属流式旁路、与生命周期事件解耦，不扩该 payload。
- 四处登记：core `packages/core/src/public/events.ts`（值 + payload 类型两段导出）、core `test/package-exports/snapshots/public-events-allowlist.json` 快照更新、desktop `src/main/ipc/forward-event-bus.ts` FORWARDED_EVENTS、desktop `scripts/generate-desktop-events.mjs`。

### 3. token 计数与兜底（双端各落地）

- **mobile**（unit 投影链）：`SessionStreamUnitMetrics` 增 `completionTokens: number` 与 `tokenSource: "usage" | "heuristic"`；`ingestDelta` 时 heuristic **按累计字符长度取 ceil**（`ceil(totalChars / 3.35)`，复用 `CHARACTERS_PER_TOKEN_RATIO` 常量导出；与 `HeuristicTokenCounter.countText` 单次全量计数严格一致——逐 delta 浮点累加 `len/3.35` 再取整与全量 ceil 不等价，故统一为对累计长度取 ceil 的口径）；`ingestUsage`（新）到达时覆盖累计值、置 `source=usage`。openai 流中零 usage 事件段由 heuristic 撑显示，step done 后 runner 补发的 run 级终值事件经**同一 `ingestUsage` 管线**到达、覆盖 heuristic（校正链闭环不依赖 FINISHED）。`run_state` 持久化增 token 字段，`hydrateFromRunState` 恢复（中断现场 token 不归零）。
- **desktop**（hook 链）：`useAgentStream` 处理新 IPC 事件（节流 ~250ms 与现有 metrics 旁路对齐）→ `useAgentStreamMetrics` acc 增 token 字段，同款 heuristic（按累计字符取 ceil）/usage 逻辑（与 mobile unit 语义一致，含 openai done 补发校正）。
- 顺带收口：mobile `useAgentStreamMetrics` 旧 hook 的无调用方死代码（`noteTextDelta` 系列）移除；保留清单——`toAgentStreamMetricsView`、被复用的类型，以及 `buildChatStreamMetricsLine`（`ChatStreamMetricsBar.tsx:6-9` 在用，**须保留**）。

### 4. 速率与文案（core 共用）

- **实时速率**：core 新纯函数 `slidingTokenRate(samples: Array<{tMs, tokens}>, nowMs, windowMs = 2500)`——取窗口内首尾样本差分 ÷ 时长；样本不足两端时用可用段；窗口外样本淘汰。落点 `domain/format/`（双端可用，纯函数可直测）。选用时间窗口制而非事件 EWMA：慢速流（5 t/s，delta 稀疏）按事件更新会长时间冻结显示（探索结论）。
- **usage 校正点**：heuristic→usage 覆盖瞬间累计值跳变，速率窗口重置（样本序列清空重 seed），避免一次巨大差分污染速率。
- **文案**：`format-stream-metrics-line.ts` 改「{prefix} · {elapsed} · 输出 {N} t · {rate} t/s」；正文/思考合并不再分列（思考期在 anthropic/gemini 下 usage 已含、heuristic 下随正文一并累计字符按 ceil 口径折算，天然并入输出）。t/s 数字格式对齐 `formatTokensPerSecond` 惯例（≥100 整数、否则 1 位小数）；token 数用 toLocaleString 千分位。`thinkingChars > 0` 的条件分列逻辑删除。
- 流中速率显示条件：样本 ≥2 且窗口有时长；否则只显示「输出 N t」（避免除零/首秒抖动）。
- **冻结末值速率（「上次生成」也带速率段）**：速率是纯渲染期派生值——冻结态要显示它，必须在收尾时**把末值冻下来**，而不是等显示时重算（重算只会得到「停顿后衰减到 0」的假值）。做法：
  - 采样器加两个读口：`rateAt(nowMs)`（只读、不记样本；实时渲染节拍用，暂停期随 nowMs 衰减）与 `freeze()`（**窗口以最后一个样本时刻收尾**——收尾前的停顿不拉低它；样本不足以成窗口时回落到校正翻转前的末值，覆盖 openai「真值只在收尾到达、翻转后再无第二个样本」的形态）。
  - 采样序列上移到**持有实时计数的一方**：mobile = session stream unit（token 每次变化处记样本、`begin()` 重置），desktop = `useAgentStreamMetrics` hook；UI 组件只读不采样（原「组件持有采样器」的写法退役——实时值与冻结值同源）。
  - 收尾落库：运行结束把末值写 **session KKV**（域 `stream_metrics`、键 `finalRate`；值 JSON `{rate, tokens, atMs}`，编解码在 `domain/format/stream-final-rate.ts`）。选 KKV 而非 `run_state` 加列——这是展示派生值，缺失即省略速率段，不需要 DDL/align/BOOT_VERSION 三件套，也不受置位/压缩的 `clearDomain` 影响（session 删除走 `clearSession` 一并清）。
  - 读取：会话内直接随 settled 投影冻结；**跨重启**由 mobile 水合 settled 行时读回 KKV 拼进投影；desktop 的「上次生成」本就仅会话内内存（未做 run_state 持久化），冻结值同域。
  - 缺值（旧数据、KV 行缺失、解析失败、样本不足）= 省略速率段，不兜底造数。
- **覆盖范围（主会话 / 子会话同源）**：`task` 派生的子会话 run 由 manager 的**消费型单元**承接同一批事件（RUN_STARTED 到达时 lazy 建立），因此指标、速率采样与收尾冻结走的是同一套代码；mobile 子会话屏（`SubagentSessionScreen`）直接复用主会话的指标条组件，活跃期显示实时值、终态显示冻结值。差异只在持久化面：消费型 run **不写 `run_state`、不落 session KKV**（子会话没有持久层行，跨重启也没有读回路径，落库只会留无人读的行），故其冻结指标仅会话内（内存级 settled 投影）可见——重启后子会话不显示「上次生成」，主会话不受影响。desktop 端子会话面板复用同一 `ConversationPanel`，指标条天然覆盖。

## 最终项目结构

```
packages/core/src/
  infra/llm-protocol/ports/adapter.port.ts                     # LlmStreamEvent usage 变体
  infra/llm-protocol/logic/{anthropic,gemini}-sse-parser.ts    # 流中 parse+emit
  domain/events/model/event-types.ts                           # EVENT_AGENT_STREAM_USAGE 定义
  public/events.ts                                             # 值 + payload 类型导出（登记①）
  service/agent/impl/agent-runner.ts                           # 透传 + run 级累计器外提 + step done 补发
  domain/format/format-stream-metrics-line.ts                  # 文案改版
  domain/format/sliding-token-rate.ts                          # 新：滑窗速率纯函数（rateAt/freeze 读口）
  domain/format/stream-final-rate.ts                           # 新：末值速率快照编解码（session KKV 值）
  domain/session-kkv/model/session-kkv-domains.ts              # 新域 stream_metrics + 键 finalRate
  bootstrap/session-run-state/session-run-state-schema.ts      # run_state 加列（canonical DDL 更新）
  bootstrap/schema-align/schema-column-alignments.ts           # 新列 align 条目
  bootstrap/novel-master-bootstrap.ts                          # SCHEMA_BOOT_VERSION bump（现值+1，不写死号）
(登记) test/package-exports/snapshots/public-events-allowlist.json   # 快照更新（登记②）
apps/mobile/src/
  services/session-stream-unit.ts / -manager.service.ts        # ingestUsage + token metrics + 速率采样（freeze）+ session KKV 落库/水合读回
  hooks/useAgentStreamMetrics.ts                               # 死代码收口（保留 buildChatStreamMetricsLine）
  components/chat/ChatStreamMetricsBarLive.tsx                 # 只读速率（活跃=实时 / 冻结=末值）
apps/desktop/
  src/main/ipc/forward-event-bus.ts + scripts/generate-desktop-events.mjs   # 登记③④（两处）
  renderer/hooks/useAgentStream.ts / useAgentStreamMetrics.ts  # 事件处理 + token 化 + 速率采样/冻结
  renderer/features/chat/AgentStreamMetricsBar.tsx             # 只读速率渲染
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `adapter.port.ts` + 两 parser | usage 流事件类型与 emit |
| 2 | `event-types.ts` + `public/events.ts` + `agent-runner.ts` | 事件定义与导出、透传、run 级累计器外提、step done 补发 |
| 3 | allowlist 快照 + desktop 两处登记 | 事件面闭环（与 `public/events.ts` 合计四处登记） |
| 4 | `session-stream-unit.ts` + run_state schema 三件套（canonical DDL + align + bump） | token metrics、heuristic 兜底、usage 校正、持久化与水合 |
| 5 | desktop `useAgentStream`/`useAgentStreamMetrics` | 事件处理 + token 化 + 节流 |
| 6 | `format-stream-metrics-line.ts` + `sliding-token-rate.ts` | 文案与速率 |
| 7 | mobile 旧 hook | 死代码收口（保留 `buildChatStreamMetricsLine`） |
| 8 | 测试 | T-M 系列 + 快照/断言适配 |

## 详细实现步骤

- Step 1 — phase-protocol-usage — blocking: yes — qa: auto：adapter.port 类型 + anthropic/gemini parser emit；T-M1/T-M2/T-M3。
- Step 2 — phase-event-bus — blocking: yes — qa: auto：事件类型 + `public/events.ts` 导出 + runner 透传与 run 级累计器外提 + step done 补发（无论协议）+ 四处登记；T-M4。
- Step 3 — phase-mobile-unit — blocking: yes — qa: auto：unit token metrics + heuristic 兜底 + run_state 加列三件套（canonical DDL + align + bump）与持久化/水合；T-M5/T-M6/T-M7。
- Step 4 — phase-desktop-hook — blocking: yes — qa: auto：desktop 事件处理与 token 化；T-M4 关联断言。
- Step 5 — phase-format-rate — blocking: yes — qa: auto：文案改版 + 滑窗速率 + 双端组件采样接入；T-M8/T-M9/T-M10；旧 hook 收口 T-M11。
- Step 6 — phase-regression — blocking: yes — qa: auto：core 全量 + 双端全量 + typecheck（core dist 先重建）。
- Step 7 — phase-manual-verify — blocking: no — qa: manual_user：三协议真流验证（anthropic/gemini 实时 t 与 t/s、openai 流尾校正、无 usage 网关全程 heuristic）；高速/慢速模型速率稳定性观察。

## 测试策略

- T-M1 — blocking: yes — anthropic：message_delta 携带累计 output_tokens（协议原始字段）→ usage 事件（`completionTokens` 随 delta 增长）（映射 Step 1）
- T-M2 — blocking: yes — gemini：每块 usageMetadata → usage 事件；值不变不发（映射 Step 1）
- T-M3 — blocking: yes — openai：协议层流中零 usage 事件；done 结果带终值 usage（既有行为锁定，终值出口为 runner 补发）（映射 Step 1）
- T-M4 — blocking: yes — 事件面：allowlist 快照更新；desktop 转发清单含新事件；runner 多 step 累计换算正确、每 step 请求 done 后补发一条 run 级终值事件（无论协议）（映射 Step 2/4）
- T-M5 — blocking: yes — mobile unit：usage 事件覆盖 heuristic 累计、source 翻转；step 边界不清零（run 级）；**openai 场景**——流中零 usage 事件段 heuristic 撑显示、step done 后收到 runner 补发的终值校正事件、覆盖 heuristic 跳正（映射 Step 3）
- T-M6 — blocking: yes — run_state 持久化与水合：中断现场恢复 token 数与 source；legacy 库 align 后新列缺省回退（映射 Step 3）
- T-M7 — blocking: yes — heuristic 口径：按累计字符长度取 ceil（`ceil(totalLen/3.35)`），逐 delta 更新与 `HeuristicTokenCounter.countText` 单次全量计数严格一致（映射 Step 3）
- T-M8 — blocking: yes — 文案快照：「生成中 · 12.3s · 输出 1,234 t · 45 t/s」双端一致；**冻结态带末值速率**（「上次生成 · 39.2s · 输出 12,000 t · 96.7 t/s」——收尾末值快照，非衰减值）；无样本（旧数据/KV 行缺失/样本不足）才省略速率段（映射 Step 5 与「冻结末值速率」小节）
- T-M9 — blocking: yes — 滑窗速率：fake timers 推进下 200 t/s 与 5 t/s 场景数值稳定；输出暂停 3s 后速率趋零；恢复回升（映射 Step 5）
- T-M10 — blocking: yes — 校正重置：heuristic→usage 覆盖瞬间滑窗重 seed、速率无尖刺（映射 Step 5）
- T-M11 — blocking: yes — 旧 hook 死代码移除后 mobile 全量绿（映射 Step 5）

## 风险与回滚方案

- **openai 三方网关不给 usage**：heuristic 全程撑住显示，终值也不校正（无真值）——接受（显示层估算）；指标条不标注来源（避免文案抖动），真值差异由统计页（落库 usage）承载。
- **heuristic 中文低估**：中文约 1.5~2 字/token，len/3.35 低估约半——usage 到达即校正；纯 openai 网关场景接受估算误差（用户已拍板 tokenizer 兜底口径）。
- **事件风暴**（gemini 每块 emit）：上层 32ms/250ms 合批节流吸收；事件总线 publish 本就是 microtask 合批（wrapStreamForBus 既有）。
- **run_state 加列**：session_run_state 为**具体列存储**（`bootstrap/session-run-state/session-run-state-schema.ts`：`text_chars`/`thinking_chars` INTEGER 等具体列，非 KKV/JSON）。token 字段（`completion_tokens INTEGER`、`token_source TEXT`）为加列，走 `SCHEMA_COLUMN_ALIGNMENTS` + `SCHEMA_BOOT_VERSION` bump 三件套纪律（canonical DDL 更新 + align 条目 + 版本 bump）。旧库 align 后新列取缺省（0 / `'heuristic'`），水合回退按 0 t 起算。**撞号注记**：与 message-content-compression 迭代同期 bump（该 spec 同样不写死号：写作基线 15、以主干现值 +1 顺延）——本 spec 不写死具体号，以主干 `SCHEMA_BOOT_VERSION` 现值 +1 为准；两迭代先后合并入主干时顺延（先合者 +1、后合者对合并后的现值再 +1），bump 落地前以主干实际值为准核对一次。
- **回滚方案**：分层独立可 revert；文案层单独回退即恢复旧显示；事件新增不破坏既有消费方（未订阅者无感）。

## Context Bundle

```yaml
iteration_name: mobile-perf-2026-09 / stream-metrics-tokens
requirement_path: docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/prd.md
spec_path: docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/spec.md
explore_summary: >
  usage 可得性矩阵：anthropic(message_delta 累计 output, parser 已存原文只差 emit)/
  gemini(每块 usageMetadata 累计, 同)/openai(仅最后一块, 网关可能全程无)。tokenizer:
  同步只有 heuristic(len/3.35 英文口径), 真 tokenizer 异步 prompt 级(RN 原生 bridge)。
  指标链双端不对称: mobile unit 投影(32ms ingress 合批+run_state 持久化), desktop
  hook 直连 IPC(forward-event-bus 硬编码七事件)。共用件仅 core buildStreamMetricsLine。
  速率现状=全程平均(双端同构缺陷)。EWMA 先例(row-windowing α=0.25)按事件更新不适合速率。
impact_files: 见变更点清单
constraints:
  - 新事件四处登记（public/events.ts 导出 / allowlist 快照 / FORWARDED_EVENTS / generate-desktop-events）
  - mobile jest 消费 core dist，回归前先 build
  - run_state 为具体列存储，token 加列走 SCHEMA_COLUMN_ALIGNMENTS + SCHEMA_BOOT_VERSION bump 三件套（号以主干现值 +1，不写死，与 message-content-compression 顺延）
  - 事件总线既有 microtask 合批是风暴防线
blocking_steps: [1, 2, 3, 4, 5, 6]
```
