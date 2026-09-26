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
每 delta：读值 = max(0, 基线 + 增量估算)；无 usage 时基线为 0（增量估算 = 注入 tokenizer 时的尾窗真 BPE 计数，未注入时为 ceil(totalLen/3.35) 启发式）
  ──▶ usage 事件到达：重锚基线（base = 真值 − 当时的增量估算）、source=usage；此后 delta 的增量继续叠加（多步 run 不冻结）
  openai：流中零 usage 事件段由估算撑，step done 补发到达时重锚到真值
速率：core 纯函数 slidingWindowRate(samples)，输入 (t, cumulativeTokens) 序列；校正点重 seed（source 翻转 + 窗口折叠）
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
  - **usage 基线 + 增量偏移（stream-metrics-native ① 起生效，2026-09-26 用户拍板）**：读值 = `max(0, 基线 + 增量估算)`。未收到 usage 时基线为 0——退化成纯估算，未注入 tokenizer 时即 `ceil(totalChars / 3.35)`：**未收到 usage 前与旧口径严格一致；usage 到达后按本小节的「基线 + 增量」口径**（既有用例仍全绿，断言已按本小节口径改写，见 T-M5）；usage 事件到达时**重锚基线**（`base = 真值 − 当时的增量估算`），此后每个 delta 的增量继续叠在真值上。`tokenSource` 只记录「基线是否来自真值」这一 provenance，**不再有「usage 后 heuristic 不再回写」的门**——该门是实锤缺陷的根源：多步 run 里工具 step 无文本 delta，第二步文本流的增量被永久拦死、数字冻结在上一 step 的 usage 值上，样本断流后滑窗折叠成单样本，终态速率段随之消失（详见下方「风险与回滚方案」的已修复条目与 `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec.md` Q7/D11 的推翻注记）。desktop `useAgentStreamMetrics` 同构同改（`baseTokens` 字段）。
- **desktop**（hook 链）：`useAgentStream` 处理新 IPC 事件（节流 ~250ms 与现有 metrics 旁路对齐）→ `useAgentStreamMetrics` acc 增 token 字段，同款 heuristic（按累计字符取 ceil）/usage 逻辑（与 mobile unit 语义一致，含 openai done 补发校正）。
- 顺带收口：mobile `useAgentStreamMetrics` 旧 hook 的无调用方死代码（`noteTextDelta` 系列）移除；保留清单——`toAgentStreamMetricsView`、被复用的类型，以及 `buildChatStreamMetricsLine`（`ChatStreamMetricsBar.tsx:6-9` 在用，**须保留**）。

### 4. 速率与文案（core 共用）

- **实时速率**：core 新纯函数 `slidingTokenRate(samples: Array<{tMs, tokens}>, nowMs, windowMs = 2500)`——取窗口内首尾样本差分 ÷ 时长；样本不足两端时用可用段；窗口外样本淘汰。落点 `domain/format/`（双端可用，纯函数可直测）。选用时间窗口制而非事件 EWMA：慢速流（5 t/s，delta 稀疏）按事件更新会长时间冻结显示（探索结论）。
- **采样器共用封装（语义补注）**：采样序列与 seed/校正重置封在 core 的**单例工厂** `createTokenRateSampler()`（`domain/format/sliding-token-rate.ts`，与 `slidingTokenRate` 同文件导出、经 `@novel-master/core/format` 对双端开放）——双端各自 `createTokenRateSampler()` 各持一份实例（mobile 在 session stream unit 字段、desktop 在 `useAgentStreamMetrics` 的 ref），语义与实现单一来源；消费方只调 `begin()` / `note(tMs, tokens)` / `rateAt(nowMs)` / `freeze()`，不自行拼样本数组，避免两端口径漂移。
- **校正点重 seed 采样窗（2026-09-26 扩为两类）**：两种校正点都先取「当前窗口末值」存为回落值、再清空序列重 seed——① **source 翻转**（heuristic→usage，累计值尺度跳变，防一次巨大差分污染速率）；② **窗口折叠后的首个新样本**（新样本与上个样本相隔 ≥ 窗口时长 2.5s，旧样本再也进不了未来任何窗口，多步 run 的 step 间静默就是这种形态）——②使 `freeze()` 在跨 step 静默后回落到「最后一段稳定输出的速率」，而不是 null 或第一步的陈速率。**不做「每次 usage 都清窗」**的更激进口径：gemini 每个候选块都 emit 一条 usage（累计值变化才发），逐条清窗会把实时速率反复清成 null（速率段闪没），是回归。
- **文案**：`format-stream-metrics-line.ts` 改「{prefix} · {elapsed} · 输出 {N} t · {rate} t/s」；正文/思考合并不再分列（思考期在 anthropic/gemini 下 usage 已含、heuristic 下随正文一并累计字符按 ceil 口径折算，天然并入输出）。t/s 数字格式对齐 `formatTokensPerSecond` 惯例（≥100 整数、否则 1 位小数；**整数值不带尾随 `.0`**——即 `45` 而非 `45.0`，与 T-M8 例文「45 t/s」一致；实现取 `parseFloat(rate.toFixed(1))` 消尾零）；token 数用 toLocaleString 千分位。`thinkingChars > 0` 的条件分列逻辑删除。
  - 口径澄清（消 T-M8 矛盾）：原稿「否则 1 位小数」是「保留一位」的意思，**不是「不省略尾随 .0」**——44.96 → `45`、96.7 → `96.7`、99.94 → `99.9`、100.4 → `100`。T-M8 例文「输出 1,234 t · 45 t/s」与「输出 12,000 t · 96.7 t/s」均按此口径，二者不互斥。
- 流中速率显示条件：样本 ≥2 且窗口有时长；否则只显示「输出 N t」（避免除零/首秒抖动）。
- **冻结末值速率（「上次生成」也带速率段）**：速率是纯渲染期派生值——冻结态要显示它，必须在收尾时**把末值冻下来**，而不是等显示时重算（重算只会得到「停顿后衰减到 0」的假值）。做法：
  - 采样器加两个读口：`rateAt(nowMs)`（只读、不记样本；实时渲染节拍用，暂停期随 nowMs 衰减）与 `freeze()`（**窗口以最后一个样本时刻收尾**——收尾前的停顿不拉低它；样本不足以成窗口时回落到校正翻转前的末值，覆盖 openai「真值只在收尾到达、翻转后再无第二个样本」的形态）。
  - 采样序列上移到**持有实时计数的一方**：mobile = session stream unit（token 每次变化处记样本、`begin()` 重置），desktop = `useAgentStreamMetrics` hook；UI 组件只读不采样（原「组件持有采样器」的写法退役——实时值与冻结值同源）。
  - 收尾落库：运行结束把末值写 **session KKV**（域 `stream_metrics`、键 `finalRate`；值 JSON `{rate, tokens, atMs}`，编解码在 `domain/format/stream-final-rate.ts`）。选 KKV 而非 `run_state` 加列——这是展示派生值，缺失即省略速率段，不需要 DDL/align/BOOT_VERSION 三件套，也不受置位/压缩的 `clearDomain` 影响（session 删除走 `clearSession` 一并清）。
  - 读取：会话内直接随 settled 投影冻结；**跨重启**由 mobile 水合 settled 行时读回 KKV 拼进投影；desktop 的「上次生成」本就仅会话内内存（未做 run_state 持久化），冻结值同域。
  - 缺值（旧数据、KV 行缺失、解析失败、样本不足）= 省略速率段，不兜底造数。
- **覆盖范围（主会话 / 子会话同源）**：`task` 派生的子会话 run 由 manager 的**消费型单元**承接同一批事件（RUN_STARTED 到达时 lazy 建立），因此指标、速率采样与收尾冻结走的是同一套代码；mobile 子会话屏（`SubagentSessionScreen`）直接复用主会话的指标条组件，活跃期显示实时值、终态显示冻结值。差异只在持久化面：消费型 run **不写 `run_state`、不落 session KKV**（子会话没有持久层行，跨重启也没有读回路径，落库只会留无人读的行），故其冻结指标仅会话内（内存级 settled 投影）可见——重启后子会话不显示「上次生成」，主会话不受影响。desktop 端子会话面板复用同一 `ConversationPanel`，指标条天然覆盖——**覆盖范围收窄登记（D10）：仅活跃 run 期**。子 run 运行中与主会话同构给实时指标；run 结束后是否显示「上次生成 · 冻结速率」取决于该面板的内存态是否仍在（desktop 不写 `stream_metrics` KKV、子会话无 run_state 行），故**不承诺终态持久覆盖**——重启或会话态丢失后 desktop 子会话不再有 settled 行，这是双端持久化不对称（Q10）的一部分，本轮接受。

### 5. 实时估算升级：js-tiktoken 尾窗增量（stream-metrics-native ②，2026-09-26 用户拍板）

- **问题**：`ceil((textChars+thinkingChars) / 3.35)` 一个系数两头不准——实测纯中文低估约 70%、纯英文高估约 47.6%，且 usage 未到达的流中段（openai 系）显示的就是这个估值。
- **模块**：core 新增纯逻辑 `infra/tokenizer/logic/incremental-token-counter.ts`（`createIncrementalTokenCounter`，经 `@novel-master/core/format` 对双端开放）——「已固化前缀 + 尾窗」两段式：`tokens = committedTokens + encode(尾窗)`，只保留尾窗片段（不持有全文），单次 encode 的字符数有硬上限（≤64，超长无空白串按固定步长拆段自保）。参数：`tailChars=24`、`lookbackChars=8`、`commitStepChars=64`；固化切点优先落在自然边界（空白/标点，向前回看 ≤8 字符），这是控制「断词误差」的关键——对照实测：英文长文按固定 64 字符硬切误差 +7.5%，边界对齐后 0.000%。
- **实测（Node v22 + js-tiktoken 1.0.21 + cl100k_base，本次实跑）**：
  - 精度（3,660 字符中文长文，按 7 字符 delta 流式推入）：真值 5,160 t，估算 5,176 t → **+0.31%**（≤1% 达标）；英文 3,675 字符：真值 736 t，估算 736 t → **0.000%**（≤3% 达标）；
  - 性能：中文单次 push（含读值）Node 稳态峰值 0.92ms、均摊 0.47ms；jest（babel 转换环境，p99 口径）p99 1.00ms、均摊 0.50ms、偶发峰值 2ms；**以上为 Node v22 桌面口径；Hermes 真机未测，且读值在每 delta 路径（`ingestDelta` 无节流）、非每渲染帧——desktop hook 同样每 delta 读值（250ms 只节流 usage 事件与渲染 tick）**；`commitStepChars` 取值对照表见 core 模块文档（256 → 峰值 5.24ms，超「单次 push ≤2ms」验收线，故默认取 64；**登记为对既定方案默认值的实测收紧**：任务口径给的是 256，实测后收紧到 64，误差仅从 +0.25% 变到 +0.31%）；纯中文无空白 12,000 字符一次涌入约 **400–500ms**（评审实测 468ms，区间按实测放宽；按 ≤64 字符拆段自保；真实 tiktoken 全量 encode 同长度是 88s 量级）；
  - 编码表构造：cl100k 约 180–250ms、o200k 约 420ms，按编码名缓存单例；**构造时机＝会话切换时空闲预热，未就绪时在 `begin()`（run 起手）同步兜底**。
- **绑定与注入**：mobile 绑定 `apps/mobile/src/services/stream-token-estimator.ts`（惰性单例 + 按编码缓存；ranks 命名空间按 `(mod.default ?? mod)` 兼容 ESM/CJS；不在模块顶层 `new Tiktoken`——RN 依赖 `fast-text-encoding` polyfill 先执行）；`SessionStreamUnit` 新增可选 `tokenEstimatorFactory`（正文/思考各一条独立计数器），由 manager 透传、`novel-master-context.tsx` 装配注入。desktop 绑定 `apps/desktop/renderer/hooks/stream-token-estimator.ts`（renderer 是纯 web，js-tiktoken 纯 JS 可直接用），`useAgentStreamMetrics` 增可选估算器工厂参数，`ConversationPanel` 注入；`apps/desktop/package.json` 增 `js-tiktoken@^1.0.21`（mobile 已依赖、hoist 到根，lock 仅 1 行变化）。
- **编码解析（best-effort）**：sessionId → 会话 agent 配置 modelId（缺省回退 agent pin）→ saved model → `vendorModelId` → core `resolveTokenizerFamily` / `mapVendorModelIdToTiktokenModel` + js-tiktoken `getEncodingNameForModel` → `o200k_base`（gpt-4o/o1/o3/o4/gpt-4.1/gpt-4.5/gpt-5）否则 `cl100k_base`；解析不出/非 tiktoken 家族（claude/qwen/glm…）本轮**也用 cl100k 估算**（只是近似估算，`tokenSource` 仍是 `'heuristic'`，联合类型与 DB 列语义不动）。会话切换时 `primeStreamTokenModelHint` 预热（提示缓存上限 32 条），首个 run 没赶上就 cl100k 兜底、usage 到达即重锚。
- **未注入时走旧启发式路径**：不注入估算器（既有测试、极简 runtime）时读值仍是 `ceil(chars/3.35)`——**未收到 usage 前与旧口径严格一致；usage 到达后按本节的「基线 + 增量」口径**；既有用例仍全绿（断言已按本节口径改写，见 T-M5）。工厂返回 null（构造失败）同样回退——投影形状不变。
- **desktop 取舍**：v1 **固定 cl100k_base**（按会话模型解析 o200k 需要异步仓储/IPC 面，renderer 侧暂无），o200k 模型用 cl100k 估算的偏差有界且 usage 真值到达即重锚；后续迭代补。
- **不动**：原生桥 `tokenizer-driver-rn` 仍是异步 prompt 级 API（逐 delta 实时不可行），本轮不改；实时估算只走 js-tiktoken。

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
  infra/tokenizer/logic/incremental-token-counter.ts           # 新（②）：尾窗增量 token 计数器（双端共用纯逻辑）
  domain/session-kkv/model/session-kkv-domains.ts              # 新域 stream_metrics + 键 finalRate
  bootstrap/session-run-state/session-run-state-schema.ts      # run_state 加列（canonical DDL 更新）
  bootstrap/schema-align/schema-column-alignments.ts           # 新列 align 条目
  bootstrap/novel-master-bootstrap.ts                          # SCHEMA_BOOT_VERSION bump（现值+1，不写死号）
(登记) test/package-exports/snapshots/public-events-allowlist.json   # 快照更新（登记②）
apps/mobile/src/
  services/session-stream-unit.ts / -manager.service.ts        # ingestUsage + token metrics + 速率采样（freeze）+ session KKV 落库/水合读回
  services/stream-token-estimator.ts                            # 新（②）：js-tiktoken 绑定 + 会话级编码名解析/预热
  hooks/useAgentStreamMetrics.ts                               # 死代码收口（保留 buildChatStreamMetricsLine）
  components/chat/ChatStreamMetricsBarLive.tsx                 # 只读速率（活跃=实时 / 冻结=末值）
apps/desktop/
  src/main/ipc/forward-event-bus.ts + scripts/generate-desktop-events.mjs   # 登记③④（两处）
  renderer/hooks/useAgentStream.ts / useAgentStreamMetrics.ts  # 事件处理 + token 化 + 速率采样/冻结
  renderer/hooks/stream-token-estimator.ts                     # 新（②）：renderer 侧 js-tiktoken 绑定（v1 固定 cl100k）
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
- T-M5 — blocking: yes — mobile unit：usage 事件**重锚基线**、source 翻转；其后 delta 的增量继续叠加（数字持续增长、不冻结）；step 边界不清零（run 级）；**openai 场景**——流中零 usage 事件段由估算撑显示、step done 后收到 runner 补发的终值重锚校正；**多步 run 回归（stream-metrics-native ①）**——工具 step 静默（无文本 delta）后第二步文本流 token 继续增长、终态 `rateTokensPerSecond` 非 null（映射 Step 3 + ①）
- T-M6 — blocking: yes — run_state 持久化与水合：中断现场恢复 token 数与 source；legacy 库 align 后新列缺省回退（映射 Step 3）
- T-M7 — blocking: yes — heuristic 口径：按累计字符长度取 ceil（`ceil(totalLen/3.35)`），逐 delta 更新与 `HeuristicTokenCounter.countText` 单次全量计数严格一致（映射 Step 3）
- T-M8 — blocking: yes — 文案快照：「生成中 · 12.3s · 输出 1,234 t · 45 t/s」双端一致（t/s **整数值不带尾随 .0**，即例文为 `45` 而非 `45.0`；48.2→`48.2`、100.4→`100`，见第 4 节文案口径）；**冻结态带末值速率**（「上次生成 · 39.2s · 输出 12,000 t · 96.7 t/s」——收尾末值快照，非衰减值）；无样本（旧数据/KV 行缺失/样本不足）才省略速率段（映射 Step 5 与「冻结末值速率」小节）
- T-M9 — blocking: yes — 滑窗速率：fake timers 推进下 200 t/s 与 5 t/s 场景数值稳定；输出暂停 3s 后速率趋零；恢复回升（映射 Step 5）
- T-M10 — blocking: yes — 校正重置：heuristic→usage 覆盖瞬间滑窗重 seed、速率无尖刺（映射 Step 5）
- T-M11 — blocking: yes — 旧 hook 死代码移除后 mobile 全量绿（映射 Step 5）

## 风险与回滚方案

- **openai 三方网关不给 usage**：heuristic 全程撑住显示，终值也不校正（无真值）——接受（显示层估算）；指标条不标注来源（避免文案抖动），真值差异由统计页（落库 usage）承载。
- **heuristic 中文低估**：中文约 1.5~2 字/token，len/3.35 低估约半——usage 到达即校正；纯 openai 网关场景接受估算误差（用户已拍板 tokenizer 兜底口径）。
- **事件风暴**（gemini 每块 emit）：上层 32ms/250ms 合批节流吸收；事件总线 publish 本就是 microtask 合批（wrapStreamForBus 既有）。
- ~~**usage 到达后 heuristic 不回写 → 多 step 流数字停在上一 step 终值**（已知、接受）~~ → **已推翻并修复（stream-metrics-native ①，2026-09-26 用户拍板「usage 基线 + 增量偏移 + 校正点重 seed 采样窗」）**：改为读值 `max(0, 基线 + 增量估算)`、usage 到达重锚基线；多步 run 里工具 step 的静默不再让第二步文本流冻结，跨静默的首个新样本重 seed 采样窗使终态速率段照常给出。原「已知、接受」条目作废，验收侧由新增的多步 run 用例（T-M5 扩展）守住。
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
