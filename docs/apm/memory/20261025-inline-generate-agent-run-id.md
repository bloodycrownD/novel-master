---
date: 2026-10-25 01:41
title: 删掉 generate-agent-run-id 的单行包装（已落地）
keywords: generate-agent-run-id, 过度封装, randomUUID, agent-runner, 单行函数
abstract: 用户质疑 generate-agent-run-id.ts 只有一行、没必要封装。核实后确认它只是 return randomUUID()，而 randomUUID 已是 infra 里处理 Node/Hermes/浏览器差异的封装，全仓仅 agent-runner 一个调用点且无任何附加策略。已删除该文件，runner 直接调 randomUUID()，相关注释同步。typecheck/lint/test/agent 203 全绿。
---

user:
D:\Dev\Js\novel-master\packages\core\src\domain\agent\logic\generate-agent-run-id.ts
这个是何意味？就一行有必要封装吗？

assistant:
没必要，是叠在已有间接层上的第二层壳。`generateAgentRunId()` 里只有 `return randomUUID()`，而 `randomUUID()` 本身就是 `infra/random-uuid.ts` 里做 Node / RN Hermes / 浏览器兼容与 v4 位修正的那层封装；这层再包一次没有加前缀、没有校验、没有策略，全仓也只有一个调用点（`agent-runner.ts` 的 runId 生成），所以属于纯转手。

已删除 `generate-agent-run-id.ts`，`agent-runner.ts` 改为直接 `import { randomUUID } from "@/infra/random-uuid.js"` 并 `const runId = randomUUID()`；两处引用旧函数名的注释同步改成「runId 生成」。dist 里残留的旧产物也删了。

验证：core typecheck 过、lint 0 问题（仅既有 `_branch` warning）、test/agent 203/203、dist 重建。判据记一下：包装只有在「加了策略/前缀/校验」或「隔离了不稳定依赖以便测试替换」时才值得存在；只是改个名字的单行转手，直接删。
