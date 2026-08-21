# 调研：agent 应用在 tool call / tool result 中断后与 user 消息的衔接

日期：2026-08-20

## 背景

用户在 `.reference/` 下克隆了 opencode 与 claude-code 两个参考项目（浅克隆，已被 `.gitignore` 忽略），想弄清它们在 tool call / tool result 被中断（用户打断/abort/出错/会话恢复）后，如何处理消息序列与下一条 user 消息的衔接，以满足 Claude API 的消息约束。

## 结论摘要

- 两个项目的核心策略一致：**不丢弃含 tool_use 的 assistant 消息，为每个悬空 tool_use 合成一条 `is_error: true` 的 tool_result（user 消息）**。
- 合成失败只针对**没有结果**的 tool call；已成功落盘的 tool_result 原样保留（opencode 完成时从 `ctx.toolcalls` 删除；claude-code 的 `getRemainingResults` 双轨吐出真实结果+合成错误）。
- claude-code：中断路径区分原因——Esc 打断补 `[Request interrupted by user]`；submit-interrupt（用户新输入）跳过占位文本，让新输入自己提供上下文；工具被拒绝用 `REJECT_MESSAGE`；组装期兜底用 `[Tool result missing due to internal error]`。
- claude-code 发送前跑 `normalizeMessagesForAPI`（合并连续 user）+ `ensureToolResultPairing`（补漏配对/剥孤儿/去重），幂等修复，防 resume 坏历史。
- opencode V1：abort 时持久化 `status: "error"` + `metadata.interrupted: true`，组装时对残留 pending/running 兜底合成 `"[Tool execution was interrupted]"`（`message-v2.ts` L348-357）；V2：每次 run 入口 `failInterruptedTools` 统一结算，组装层不兜底。
- Claude API 约束真相：**user/assistant 交替是软约定**（1P API 接受连续 user 并自动合并为一个 turn）；**tool_use↔tool_result 配对才是硬约束**（违反报 400）。客户端合并连续 user 主要为 Bedrock 兼容（Bedrock 不支持连续 user）。

## 关键证据位置

- `.reference/claude-code/src/query.ts` L149-179（yieldMissingToolResultBlocks）、L1331-1333（submit-interrupt 跳过占位）
- `.reference/claude-code/src/utils/messages.ts` L2402-2404（合并连续 user 的注释）、L5594-5885（ensureToolResultPairing）
- `.reference/claude-code/src/services/tools/StreamingToolExecutor.ts` L480（getRemainingResults 双轨）
- `.reference/opencode/packages/opencode/src/session/message-v2.ts` L348-357（组装兜底 + Anthropic 约束注释）
- `.reference/opencode/packages/opencode/src/session/processor.ts` L123-127（settleToolCall 删除已完成）、L577-596（cleanup 只改残留）
- `.reference/opencode/packages/core/src/session/runner/llm.ts` L119-139（V2 run 入口结算）

## 未闭合

- Anthropic 官方文档域名区域被锁，未能一手核实"连续 user 自动合并"的文档原文；依据是 claude-code 注释 + opencode 无合并逻辑直接发的事实。
- opencode V2 是否存在绕过 run() 直接组装的路径（导出/分享）未验证。
