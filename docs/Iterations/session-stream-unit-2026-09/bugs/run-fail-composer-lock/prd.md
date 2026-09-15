---
date: 2026-09-15
dependency: Iterations/session-stream-unit-2026-09/prd.md
---

# run-fail-composer-lock Bug PRD

## 背景

2026-09-14 通知延迟排查（EMUI 前台服务通知压制定案轮）的真机取证中实锤：荣耀真机「新会话1」发送消息后 run 3 秒 settled（`session_run_state.status=settled`），但 `chat_message` 表无任何 assistant 消息落库（seq=538 user 之后为空），会话尾部停在 user 纯文本消息；错误原因在 UI 上不可见（无错误消息、无持久提示）。后续以 uiautomator 的 `enabled="false"` 属性实锤：输入框被永久禁用，会话无恢复出口，只能杀 app。

## 现象描述

- run 失败（典型：provider 请求快速失败——网络/鉴权/模型悬空）后会话的输入框永久禁用，无法输入新内容；
- 失败原因仅以一条 2.5 秒自动消失的 toast 呈现，错过即不可见；DB 侧 `session_run_state` 无 error 字段，失败原因无从回查；
- desktop 端同款判定条件，同病。

## 复现步骤

1. 制造一个会快速失败的 run（如会话 agent 指向不存在的模型/断网发送）；
2. 发送消息，等待 run 失败结束（toast 一闪而过）；
3. 观察输入框：无法聚焦/唤起键盘（enabled=false 持续）；杀 app 重进依旧。

## 预期行为

run 失败后会话应保持可用：输入框可输入新指令再次发送；失败原因应有持久可见的载体（会话内错误消息），重启后仍可回看。

## 实际行为

输入框永久禁用；错误仅易失 toast；DB 尾部停在 user 消息。

## 影响范围

- packages/core agent-runner 失败收尾链（三端共用）；
- mobile/desktop 双端 composer 的「连续 user 守卫」判定连锁（`lastMessageIsPlainUserText`）。

## 根因摘要

core `agent-runner.ts` 主 catch 失败路径仅发 `EVENT_AGENT_RUN_FAILED` 后 throw，不落任何 assistant 消息；user 消息已在事务中先行落库不回滚 → 尾部停在 user → 双端共享的 `deriveComposerSendState` 判定 `lastMessageIsPlainUserText` 恒真 → `inputDisabled` 恒真。该守卫（D-bug-fixes「连续 user 守卫」）的设计假设「末条 user = 有 run 在跑或待 resume」，未覆盖「run 已终态 failed 且失败原因可能持续存在」。

## 验收标准

- Given run 失败（非用户主动停止），When 失败收尾完成，Then 会话内存在一条 assistant 错误消息（含「[生成失败]」与错误信息），双端输入框恢复可用；
- 错误消息在 `EVENT_AGENT_RUN_FAILED` 事件发出前落库（下游 tail reload 可见）；
- 用户主动停止（abort）行为不变：不落错误消息、partial 语义保持；
- 多步 run 中途失败（已有 assistant 产出）不追加第二条错误消息；
- 不落库的 run（persistMessages=false）不落错误消息。

## 回归测试要点

- 成功路径尾部形态不变（assistant 正常消息，无错误消息混入）；
- abort/partial 路径不变；
- token 用量统计不受错误消息影响（错误消息不带 usage）；
- mobile/desktop 既有全量测试基线不破。

## 已知限制（后续项，不在本次范围）

- `session_run_state` 无 error 字段，失败原因的 DB 回查仍缺（需 schema 变更，另行立项）；
- 用户主动停止在首条回复前（cancelled 无 partial）的尾部锁死场景依旧存在（低频）；
- mobile composer 的 setError 增强（onSettled status 呈现）未做——错误消息已持久可见，易失呈现非必需。
