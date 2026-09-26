---
date: 2026-09-26
agile_trace: true
---

# context-usage-caliber-unify 实现规格（SPEC）

## 根因 / 方案摘要

两条独立缺陷叠加：

1. **缓存不落库**：API 口径的 `promptTokens` 只在进程内 Map（`sessionApiPromptTokenCache`），重启即 miss → 读口退回本地估算，显示与压缩判定双双跳口径；
2. **两种口径本身不可比**：本地估算 `ceil(len/3.35)` 不数 tools 段，而 API 的 `prompt_tokens` 含 tools（+system + 消息包装开销）。

治本四项（用户拍板）：**A** API 占用落 session KKV（跨重启同口径）；**B** 标签拆「上次请求 / 预估」两态；**C** 本地估算补 tools 段（压缩路径必传）；**D** mock 上报近似 token 而非字符数。

## 变更点清单

| # | 组 | 文件 | 改动 |
|---|----|------|------|
| 1 | A | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts` | 新域 `prompt_tokens` + 键 `lastPromptUsage`（登记进 `SessionKkvDomain`），`public/session-kkv.ts` 导出 |
| 2 | A | `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts`（新增） | 存取层：编解码 + 进程内热层 + KKV 冷层（读回填热层）+ 双写 + 双删；损坏/非法值一律按 miss |
| 3 | A | `.../logic/session-api-prompt-token-cache.ts` | 条目增可选 `runId` / `savedModelId` / `lastMessageSeq` |
| 4 | A | `.../logic/resolve-current-prompt-tokens.ts`、`resolve-prompt-tokens-with-backfill.ts` | 读口增可选 `{sessionKkv}`；命中返回 `source:'api'` + `atMs`；`savedModelId` 指纹不符当 miss |
| 5 | A | `service/agent/impl/agent-runner.ts` | 写侧改 write helper（带 runId / savedModelId / 末尾消息 seq）；FAILED/非 completed 改 invalidate helper |
| 6 | A | 18 个调用点 / 15 个公开入口方法（message.service ×10、message-transcript-effects、run-compaction、message-rollback、persistent-state、clear-session-prompt-caches、session.service.updateSessionAgentConfig、agent-runner ×2） | 一律改双删 helper |
| 7 | A | `service/persistent-state/{create-persistent-state.ts,impl/persistent-state.service.ts}` | 注入 sessionKkv（工厂缺省自建，三端装配文件零改动） |
| 8 | B | `apps/desktop/shared/ipc-types.ts`、`src/main/services/chat-prompt-tokens.service.ts`、`renderer/features/chat/SessionDetailDrawer.tsx`、`apps/mobile/src/services/chat-prompt-tokens.service.ts` | 数据面加 `source: 'api' \| 'local'`；标签两态（`api` → 「上次请求」，否则「预估」）；`~` 仍由 `estimated` 驱动 |
| 9 | C | `.../logic/count-prompt-llm-input.ts` + 新 `serialize-tools-for-token-count.ts`、`tokenizer-driver-node`、`tokenizer-driver-rn`、`compaction-condition-trigger.port.ts`、`agent-runner.ts` | `CountPromptLlmInputParams.tools?`；统一 helper 拼接；压缩评估由 runner 传现成 tools |
| 10 | D | `scripts/mock-openai-server.mjs` | `prompt_tokens` / `completion_tokens` 改为**近似 token**：CJK 一字≈一词元（真 tokenizer 实测中文 0.93~1.38 t/字）+ 其余字符 ÷3.35（`approxTokens`），prompt 侧计入 messages + 顶层 system + tools 序列化文本；日志/帮助文案注明「近似 token，非真实 tokenizer」。**对照口径两次收口**：①早先直接拿字符数当 token → 把差距反向放大 3 倍多；②改成整段 ÷3.35 → 中文语料被低估约 3 倍，真机验收收尾校正会看到「数字凭空掉到三分之一」的假象；最终按 CJK 感知折算 |

## 详细改动说明

### A 落库与失效

- 值 JSON：`{promptTokens, atMs, runId?, savedModelId?, lastMessageSeq?}`；可选字段缺失/类型不对即省略该键；**`atMs` 与 `promptTokens` 同为必填**，缺失或类型不对一律按 miss 处理（`prompt_tokens` 是本轮**新增的域**、线上不存在旧格式行，「旧格式值照常解析」是空转——`atMs` 缺失退化为 `0` 会与它的「时效判定」用途冲突）；`promptTokens = 0` 是合法值，保留；
- 读路径：**进程内 Map 热层 → KKV 冷层（回填热层）**——压缩评估每 step 都读 token 数，不能每步查库；KKV 读失败/行损坏按 miss 处理并记 warn（展示派生值，不打断 run）；
- 写路径：同步写热层 + KKV fire-and-forget 吞错（口径同 `persistFinalRateQuietly`）；
- 失效：**双删**（热层 + KKV 行），变更点表 #6 的 18 个调用点 / 15 个公开入口方法全量落地；`message.service` / `message-rollback` / `session.service.updateSessionAgentConfig` 只有 `conn` 的就地 `createSessionKkvService(conn)`（调用点都在事务外）；`persistent-state` 同样**由 `DefaultPersistentState` 构造器内部自建** KKV 门面（`createPersistentState(conn)` 单参，**删除死参数 `CreatePersistentStateOptions.sessionKkv`**——全仓 9 个调用文件 / 10 条调用语句全单参、注入从未发生，三端装配零改动）；会话/项目删除走既有 `clearSession` 整表清；
- **已登记的产品语义（`message.append` 挂失效的连带影响）**：
  - **(i) run 期间占用标签回落**：append 一清值，**run 期间**占用 chip 会从「上次请求」回落为「预估」，直到本轮 run 结束、runner 写回新的 api 值为止；回落期间数字本身也明显偏低。**原因不是「本地估算不算 tools」**——回落期的预估不含 tools 段，是因为 **UI 读口拿不到 tools**（`session-prompt-input` 不产 tools，双端显式传 `undefined`）；**本地 `countPromptLlmInputHeuristicOnly` 本身是拼 tools 的**，压缩评估路径照常含 tools（`token-ratio.trigger.ts` 明确传 tools）。
  - **(ii) 压缩判定整个 run 内不再吃 api 值**：step-1 的压缩评估发生在 usage 写回之前，而 append 已把旧值清掉，所以**整个 run 期间压缩判定都走 `heuristic + 0.85` 安全垫**。这**比现状更准**（现状拿的是上一轮、不含本轮新增用户消息的 api 值，系统性低估、压缩偏晚），但它是一次**已登记的行为变更**（改前整个 run 用 api 值，改后全程启发式）。
- **不做 runId 比对**：读口调用方（新 run 的每 step 压缩评估）与写入方的 runId 必然不同，按 runId 判 miss 会把「run 进行中读上一轮 completed 值」的核心语义废掉；runId 作为加固字段落库，`savedModelId` 指纹参与判定。
- **设计属性留痕（没有第二道防线）**：读口**只有 `savedModelId` 指纹、没有任何 agent 指纹**——换 Agent 时 `savedModelId` 可能不变而 system 段 / prompt layout 已变，读口本身**察觉不到**。因此**切 Agent 的正确性完全依赖 `session.service.updateSessionAgentConfig` 这一个失效挂点**：改法把挂点挂在「merge 后 `agentId` 或 `modelId` 确实变了」的口径上（patch 传与当前相同的值时**不清**），且该挂点**必须 `await`**，否则 KKV 删除不被等待、进程退出会复活陈旧行。**这条挂点被删/被绕过 = 换 Agent 后旧 `promptTokens` 以 `api` 身份跳过 0.85 安全垫参与压缩判定，并跨重启继续生效**——回归用例已按「seed 一条 `savedModelId` 相同的新行后直接调读口 → 断言 `source === 'local'`」钉住读口侧行为。

### C tools 补计数

- `serializeToolsForTokenCount(tools)`（core 纯函数，`name/description/inputSchema` 稳定序列化；空/undefined 返回空串，非空带前导换行）——调用方一律「串 + helper(...)」，无判空分支，杜绝多处漂移；
- **拼接点**：node driver、RN driver、core heuristic-only 路径**三处统一**（Kotlin 侧不需要改：tools 文本在 JS 侧序列化后交给驱动）；**CLI 也不含 tools**（`apps/cli/src/prompt/commands.ts` 的 heuristic 档 `serializePromptLlmInput` 与 `countPromptLlmInput` 两个调用点均未拼）——CLI 属**取证 / 调试面、不参与压缩判定**，与压缩评估存在口径差，**仅供人工核对**，本轮不要求与压缩评估同口径；
- **范围收窄（登记）**：UI 读口拿不到 tools（`session-prompt-input` 不产 tools），双端 UI 的**预估**仍不含 tools 段；压缩评估路径（agent-runner 有现成 tools）必传。**UI 读口恒不拼 tools**——双端读口原有一行 `+ serializeToolsForTokenCount(undefined)` 对 `undefined` / `[]` 恒返回空串（一字符都不加）、已连同其 import 一并删掉：**不要以为拼了就是全量**。

### B 标签两态

- 数据面双端各加 `source`（desktop IPC `PromptChatTokenStatsResponse.source` 必填；mobile 直接消费读口返回值）；
- 文案落在调用侧（项目无 i18n 词条，硬编码中文）：desktop renderer chip（Tooltip 从「分词器」改「占用来源」）、desktop main 的 label 拼接、mobile `formatChatTokenLabel`。（**现状订正**：desktop main 侧**已无任何 `formatCounterKindLabel` 调用点**，只剩 `chat-prompt-tokens.service.ts` 一处提及该符号的**过期 JSDoc**（已随本 diff 收掉）；本 spec 原述「desktop main 的 label 拼接」落点在本 diff 之后**已不存在**——`loadChatPromptTokenLabelResilient` 走的是 `formatChatTokenStatsLabel` → `formatTokenSourceLabel`，与 `formatCounterKindLabel` 无关。）
- **`formatCounterKindLabel` 的现状（不再「保持不动」）**：它是「用哪个分词器」的维度标签（api/heuristic 都显示「自动」），与「值从哪来」是两义、不合并；但**本 diff 摘掉了它的最后三个生产调用点**（desktop main service、`SessionDetailDrawer`、mobile service），此后**仅剩 core 导出链 + 1 条 mobile 测试断言**。是否本轮删净见 **CR Open questions #16**（`cr-fix-spec-v2.md`）——该导出是 `@novel-master/core` 的公开契约，删它属 breaking change，本轮按现状收窄、**不删**。

## 测试策略

### 测试用例

- core 新增：`session-api-prompt-token-store`（编解码容错、热/冷层、指纹）、`prompt-token-invalidation`（失效挂点）、`serialize-tools-for-token-count`；
- core 改写：`resolve-current-prompt-tokens`（注入 fake sessionKkv + 「清进程热层后从 KKV 恢复 api」跨重启语义）、`agent-runner-token-cache`（KKV 写入/删除断言）、`token-ratio-trigger`（+3 条：KKV 命中、陈旧降级、0.85 安全垫）、`run-compaction`（KKV 行断言）；
- 双端：`chat-prompt-tokens` 测试断言两态标签与 `source` 传递；`mobile-prompt-token-counter` 加 tools 非空/空数组用例；
- 验证记录：core 定向 52/52 + 全量 2171 例（2 红为既有本地时区归桶失败，非本次引入）；`tokenizer-driver-node` 8/8；mobile 定向 15 例；desktop 全量 519/519。

## 风险与回滚方案

- **陈旧值**：KKV 命中意味着重启后仍可能读到旧值——靠变更点表 #6 的失效挂点（18 个调用点 / 15 个公开入口方法）+ `savedModelId` 指纹 + 会话删除整表清兜底；runId 落库为后续更严格校验留口；
- **压缩判定口径**：api 命中时 `counterKind='api'`、不吃 0.85 安全垫（现状语义不变）；落库后重启也会命中 api，行为与「重启前」一致（这正是治本目标）；
- **读放大**：热层保证常态零 IO；热层空且 KKV 无行的会话首次压缩评估多一次主键 SELECT（量级可忽略，未加负缓存以免引入陈旧窗口）；**miss 路径上压缩评估每 step 还要把全量 tools schema（`name` / `description` / `inputSchema`）重新 `JSON.stringify` 一遍并多一次额外编码**——`serializeToolsForTokenCount` 每次调用都重新 `map` + 序列化全量 schema，而 tools schema 在整个 run 内不变，5 step 的 run 就是 5 次全量 stringify。**api 命中时不重算、零成本**，成本只落在 miss 路径（换模型后首次 run、首次 run，以及 `message.append` 清了旧值的那段 run 期间）——`message.append` 挂失效后 miss 路径命中率上升，故这是**本轮新引入的读放大**。**本轮只登记、不预先改实现**：真机跑 ≥5 step 的多工具 run 确认无明显掉帧后，才考虑在 runner 侧按 **run 级**缓存序列化结果（不是全局缓存——tools 会随 Agent 配置变；缓存正确性的唯一依据是「同一 run 内 tools 定义不变，故同输入必得同串」）；
- **回滚**：A/B/C/D 四组可分别 revert；只回滚 A 即回到「进程内缓存」的旧行为（读口签名向后兼容、标签两态仍可用）；mock 改动只影响取证展示。
