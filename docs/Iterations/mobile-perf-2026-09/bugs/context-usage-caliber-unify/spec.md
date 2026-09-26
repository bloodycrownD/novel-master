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
| 6 | A | 14 个失效挂点（message.service ×9、message-transcript-effects、run-compaction、message-rollback、persistent-state、clear-session-prompt-caches、agent-runner ×2） | 一律改双删 helper |
| 7 | A | `service/persistent-state/{create-persistent-state.ts,impl/persistent-state.service.ts}` | 注入 sessionKkv（工厂缺省自建，三端装配文件零改动） |
| 8 | B | `apps/desktop/shared/ipc-types.ts`、`src/main/services/chat-prompt-tokens.service.ts`、`renderer/features/chat/SessionDetailDrawer.tsx`、`apps/mobile/src/services/chat-prompt-tokens.service.ts` | 数据面加 `source: 'api' \| 'local'`；标签两态（`api` → 「上次请求」，否则「预估」）；`~` 仍由 `estimated` 驱动 |
| 9 | C | `.../logic/count-prompt-llm-input.ts` + 新 `serialize-tools-for-token-count.ts`、`tokenizer-driver-node`、`tokenizer-driver-rn`、`compaction-condition-trigger.port.ts`、`agent-runner.ts` | `CountPromptLlmInputParams.tools?`；统一 helper 拼接；压缩评估由 runner 传现成 tools |
| 10 | D | `scripts/mock-openai-server.mjs` | `prompt_tokens` = (messages + 顶层 system + tools 序列化文本) 字符数 ÷ 3.35；`completion_tokens` 同口径折算；日志/帮助文案注明「近似 token，非真实 tokenizer」 |

## 详细改动说明

### A 落库与失效

- 值 JSON：`{promptTokens, atMs, runId?, savedModelId?, lastMessageSeq?}`；可选字段缺失/类型不对即省略该键，**旧格式值照常解析**（向后兼容）；
- 读路径：**进程内 Map 热层 → KKV 冷层（回填热层）**——压缩评估每 step 都读 token 数，不能每步查库；KKV 读失败/行损坏按 miss 处理并记 warn（展示派生值，不打断 run）；
- 写路径：同步写热层 + KKV fire-and-forget 吞错（口径同 `persistFinalRateQuietly`）；
- 失效：**双删**（热层 + KKV 行），14 个挂点全量落地；`message.service` / `message-rollback` 只有 `conn` 的就地 `createSessionKkvService(conn)`（调用点都在事务外）；`persistent-state` 原本拿不到 sessionKkv，改为工厂注入（`createPersistentState(conn, options?)` 缺省自建，保持单参兼容、三端装配零改动）；会话/项目删除走既有 `clearSession` 整表清；
- **不做 runId 比对**：读口调用方（新 run 的每 step 压缩评估）与写入方的 runId 必然不同，按 runId 判 miss 会把「run 进行中读上一轮 completed 值」的核心语义废掉；runId 作为加固字段落库，`savedModelId` 指纹参与判定。

### C tools 补计数

- `serializeToolsForTokenCount(tools)`（core 纯函数，`name/description/inputSchema` 稳定序列化；空/undefined 返回空串，非空带前导换行）——调用方一律「串 + helper(...)」，无判空分支，杜绝多处漂移；
- 拼接点：node driver、RN driver、core heuristic-only 路径**三处统一**（Kotlin 侧不需要改：tools 文本在 JS 侧序列化后交给驱动）；
- **范围收窄（登记）**：UI 读口拿不到 tools（`session-prompt-input` 不产 tools），双端 UI 的**预估**仍不含 tools 段；压缩评估路径（agent-runner 有现成 tools）必传。

### B 标签两态

- 数据面双端各加 `source`（desktop IPC `PromptChatTokenStatsResponse.source` 必填；mobile 直接消费读口返回值）；
- 文案落在调用侧（项目无 i18n 词条，硬编码中文）：desktop renderer chip（Tooltip 从「分词器」改「占用来源」）、desktop main 的 label 拼接、mobile `formatChatTokenLabel`；
- **`formatCounterKindLabel` 保持不动**：它是「用哪个分词器」的维度标签（api/heuristic 都显示「自动」），与「值从哪来」是两义，不合并。

## 测试策略

### 测试用例

- core 新增：`session-api-prompt-token-store`（编解码容错、热/冷层、指纹）、`prompt-token-invalidation`（失效挂点）、`serialize-tools-for-token-count`；
- core 改写：`resolve-current-prompt-tokens`（注入 fake sessionKkv + 「清进程热层后从 KKV 恢复 api」跨重启语义）、`agent-runner-token-cache`（KKV 写入/删除断言）、`token-ratio-trigger`（+3 条：KKV 命中、陈旧降级、0.85 安全垫）、`run-compaction`（KKV 行断言）；
- 双端：`chat-prompt-tokens` 测试断言两态标签与 `source` 传递；`mobile-prompt-token-counter` 加 tools 非空/空数组用例；
- 验证记录：core 定向 52/52 + 全量 2171 例（2 红为既有本地时区归桶失败，非本次引入）；`tokenizer-driver-node` 8/8；mobile 定向 15 例；desktop 全量 519/519。

## 风险与回滚方案

- **陈旧值**：KKV 命中意味着重启后仍可能读到旧值——靠 14 个失效挂点 + `savedModelId` 指纹 + 会话删除整表清兜底；runId 落库为后续更严格校验留口；
- **压缩判定口径**：api 命中时 `counterKind='api'`、不吃 0.85 安全垫（现状语义不变）；落库后重启也会命中 api，行为与「重启前」一致（这正是治本目标）；
- **读放大**：热层保证常态零 IO；热层空且 KKV 无行的会话首次压缩评估多一次主键 SELECT（量级可忽略，未加负缓存以免引入陈旧窗口）；
- **回滚**：A/B/C/D 四组可分别 revert；只回滚 A 即回到「进程内缓存」的旧行为（读口签名向后兼容、标签两态仍可用）；mock 改动只影响取证展示。
