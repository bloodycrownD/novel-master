---
date: 2026-08-15 03:05
title: 清理废弃的 token 回填链路 + 误提交到他人分支的教训
keywords: tokenizer, backfill, 废弃清理, 既有测试失败, 分支检查, sql-cr-fixes-integration
abstract: 挂了三天的 backfill-cache-from-messages 测试失败其实是 v1.4.25 掏空实现后没清现场（测试/回填分支/public 导出全留着），彻底清理后 core 1939/1939 零失败。清理时误提交到并行会话的 sql 集成分支，cherry-pick 摘回 main。教训：提交前必须确认当前分支。
---

user:
tokenizer/backfill-cache-from-messages.test.ts 测试失败了，什么情况？

assistant:
不是 bug，是 v1.4.25「置位/压缩后 token 刷新修复」改行为没清现场：backfillCacheFromMessages 被有意掏空（置位/压缩后上下文范围变了，从消息回填的旧 token 数不准），但断言旧行为的测试（core 3 条 + desktop T-T10）、resolvePromptTokensWithBackfill 里永不触发的回填分支、public API 的空壳导出全留着。这 3 个失败从 v1.4.25 起一直被当作「既有缺陷」背了三天。

user:
全修复吧。

assistant:
彻底清理：删空壳函数及其 public 导出/allowlist 快照条目；resolvePromptTokensWithBackfill 去回填分支（rawMessages 参数为兼容双端调用方暂留，注释标下迭代可连同调用方移除）；删过时测试；双端调用点误导性注释改诚实；顺手修 mobile 既有断言问题（expect.any(Array) 对 undefined 不匹配，jest 的 anything 不含 null/undefined）。验证：core 1939/1939 零失败、双端 typecheck 0 error、双端 chat-prompt-tokens 测试全过。

user:
（发现提交落在错误分支）

assistant:
提交时主仓被另一个并行会话切到了 feat/sql-cr-fixes-integration（reflog 显示 4e20a23 后有 checkout 记录 + 一个 sql 线的 merge commit，非本会话所为），我没检查当前分支就提交了。发现后 cherry-pick 到 main（6bc88ba）、sql 分支 reset 回原样（e325267），两边干净。教训与之前 merge 覆盖事故同源：并行会话共享主仓时，git 操作前必须先 git branch --show-current 确认位置。
