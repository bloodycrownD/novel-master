---
date: 2026-09-15
agile_trace: true
---

# run-fail-composer-lock 实现规格（SPEC）

## 根因 / 方案摘要

core `agent-runner.ts` 主 catch（发 `EVENT_AGENT_RUN_FAILED` 的同点）失败路径不落任何消息 → 尾部停在 user → 双端共享的连续 user 守卫判定把输入框永久禁用。方案（探索报告一致推荐）：**失败时在 core 层落一条 assistant 错误消息**——尾部变 assistant 后 `lastMessageIsPlainUserText` 自然 false，双端 composer 自动解锁；错误持久可见、三端（desktop/mobile/cli）一次覆盖。错误消息用现有 text 块，零 schema 改动、双端天然可渲染。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/service/agent/impl/agent-runner.ts` | 主 catch 非 abort 分支：发 FAILED 事件**之前**追加 assistant 错误消息（text 块，文案 `[生成失败] {err.message/String(err)}`，不带 usage/raw 防统计计入）；新增 `assistantAppendedInRun` 标志做幂等豁免（本轮已有 assistant 落库——含 abort partial——则不再追加，避免双条；秒败路径 assistant 仅在 request 成功后 append，必然无 assistant）；append 本身失败 console.error 后继续原失败流程不掩盖原始异常 |
| `packages/core/test/agent/agent-runner-failure-message.test.ts`（新） | 4 用例：落库文案与 FAILED 事件仍发、落库先于事件（FAILED handler 同步触发 `session.list()` 断言事件时刻尾部已是错误 assistant）、原错误仍 reject、abort 豁免、persistMessages=false 豁免、多步中途失败幂等豁免 |

**豁免矩阵**：abort/cancelled（保持 partial 语义，不落）；persistMessages=false（EphemeralOverlay，不落）；本轮已有 assistant（幂等，不落）。子 agent run 共用 runner 同样落（子会话浏览页同样解锁，无害；tool_result 回流父会话语义不变）。

**双端零改动**：判定函数在 core 共享（`deriveComposerSendState`/`composer-send-intent`），尾部形态变化自动解锁；mobile 全量与基线一致（201 套件/1333，无消息计数断言受影响）；desktop 涉 RUN_FAILED 的测试为纯 UI 生命周期逻辑（18/18 绿）。

## 详细改动说明

时序关键点：错误消息 append 必须先于 `EVENT_AGENT_RUN_FAILED` 发出——mobile manager 的 finishRun（事件驱动）→ settle → tail reload 才能读到错误消息，本轮同步顺序天然满足，并有测试锁定。

多步中途失败的幂等自洽性：中途失败时会话尾部为 tool_results user 或 assistant，`isPlainUserText` 对两者均 false，composer 本就解锁，豁免不产生锁死缺口。

## 测试策略

### 测试用例

- T-F1：请求抛错 → assistant 错误消息落库（text 块含「生成失败」）+ FAILED 事件仍发 + 落库先于事件；
- T-F2：原错误仍 reject（不掩盖）；
- T-F3：abort 路径不落错误消息（partial 语义保持）；
- T-F4：persistMessages=false 不落；多步中途失败（已有 assistant）不追加。

回归基线：core 全量 2111/2111（含新增 4 用例）、mobile 201 套件 1333/1333、双端 typecheck 通过、desktop 生命周期套件 18/18（全量中 4 个 Secret Service keyring 失败为无头环境既有问题，与本次无关）。

## 风险与回滚方案

- 错误文案作为 assistant 消息参与后续提示词上下文：可接受的产品行为（重试时 LLM 可见上次失败原因），文案中文前缀明确标识；
- 回滚：单 commit revert（`a57daa0a`）即恢复原行为，无 schema/协议迁移。
