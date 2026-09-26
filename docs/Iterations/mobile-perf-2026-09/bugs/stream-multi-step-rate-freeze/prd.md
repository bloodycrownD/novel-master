---
date: 2026-09-26
dependency: docs/Iterations/mobile-perf-2026-09/prd.md
---

# stream-multi-step-rate-freeze Bug PRD（多步 run 指标条冻结/无速率）

## 背景

聊天页底部指标条（`features/stream-metrics-tokens`，④）显示流式生成期间的实时 token 数与速率（t/s）。在集成分支 `integration/stream-metrics-native` 的 CR 与模拟器验收期间，用户对照真机行为指出：**多步 run（工具调用 step + 后续文本 step）的终态没有速率段，且第二步文本流的 token 数冻结不动**，判定为缺陷——用户的预期口径是「只要不是工具调用、普通返回 content，都应该有速率」。

## 现象描述

1. 第一步（工具调用）结束后，第二步文本流已经重新开始输出，但指标条的 token 数**停在上一步 usage 真值上不动**；
2. run 收尾后指标条**没有 `t/s` 速率段**；若第一步有文本，还会**回落到第一步的旧速率**。

## 复现步骤

1. 起 `node scripts/mock-openai-server.mjs`（末条消息含「派活」即下发一条 `task` 工具调用），或在真模型上发一条会触发工具调用的消息；
2. 等工具结果回流、模型继续输出后续文本；
3. 观察指标条：第二步文本流中 token 数不变；生成结束后无速率段。

## 预期行为

- 工具 step 结束后，第二步文本流的 token 数**继续增长**（以 usage 真值为基线继续叠加增量）；
- 收尾给出**最后一段稳定输出**的速率，而不是省略速率段或回落到旧值。

## 实际行为

- 首个 usage 到达时 `tokenSource` 由 `heuristic` 翻为 `usage`，`session-stream-unit.ts` 的门 `if (tokenSource === 'heuristic')` 让后续 heuristic 回写被**永久拦死**（翻转粘住到单元销毁）——第二步文本流没有累计值增长；
- 无 token 变化即无新样本：第二步 usage 补的那条样本与前一条相隔整个 step（超过 2.5s 滑窗），窗口折叠成单样本 → `freeze()` 返回 null → 终态无速率段；若第一步有文本，则回落第一步陈速率。

## 影响范围

- 移动端 `apps/mobile/src/services/session-stream-unit.ts`（主会话单元与子会话消费型单元走同一套代码）；
- 桌面端 `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts`（同构缺陷）；
- 共用采样器 `packages/core/src/domain/format/sliding-token-rate.ts`；
- 终态速率持久化分支（session KKV `stream_metrics` / `finalRate`）：多步 run 从「无速率 → 删键」变为「有速率 → 写键」，属期望变化。

## 验收标准

- 多步 run：工具 step 结束后，第二步文本流的 `completionTokens` 单调增长，收尾 `rateTokensPerSecond` 非 null；
- 单步 run（openai 收尾校正）、零输出 run（仍应删 KKV 键）、中断水合、子会话指标条、停止键等既有行为**不回归**（对齐模拟器六项验收口径）。

## 回归测试要点

- mobile `__tests__/session-stream-unit-pipeline.test.ts` 新增多步 run 用例（工具 step 静默 + 文本 step → 终态速率非 null）；改写原 T-M5「真值后 heuristic 不回写」断言；
- core `test/domain/format/sliding-token-rate.test.ts` 新增「窗口折叠后的首个新样本重 seed、`freeze()` 回落折叠前末值」用例；
- desktop `test/use-agent-stream-metrics-hook.test.tsx` 新增/改写多步与 usage 后增量用例；
- 回归 `session-stream-unit-final-rate`（零输出删键/水合/写值）、`chat-stream-metrics-bar-live`（无尖刺）、`subagent-session-screen-metrics`。
