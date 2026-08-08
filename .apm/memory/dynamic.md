---
createdAt: '2026-07-29 21:38:22'
updatedAt: '2026-08-08 01:50:02'
---
﻿## 背景

「agent-mode-refactor」迭代（docs/Iterations/agent-mode-refactor/）：把子代理系统从全局名单（KKV subagentNames）重构为 AgentDefinition.mode 字段。用户已确认 spec，进入 code-dev-loop 实现。SPEC 路径 docs/Iterations/agent-mode-refactor/spec.md，PRD docs/Iterations/agent-mode-refactor/prd.md。分支 feat/merge-subagent，base_sha 37dcd56c。编排状态见 docs/Iterations/agent-mode-refactor/.iteration-state.yaml。

## 目的

按 spec 完成 7 phase / 32 step 的实现，达 dev-ready（spec 范围内实现与功能小检完成）。

## 现状

核心链串行推进中，已完成两步：
- wave-0 impl-model（Step 1-7）done @ f5eeb9f9：AgentDefinition.mode 字段 + schema 双向透传 + 删 subagentCallable strip + general 固定 mode:subagent + upsert 禁止 general 重名 + examples 补 mode。core build 通过。
- wave-1 impl-core-tool（Step 8-12）done @ 340dad60：Tool.description 改函数类型 (ctx)=>string；删 createSubagentTool/registerSubagentTool，task 改静态 subagentTool 在 registerBuiltinTools 注册（工具数 6→7）；toolsFromRegistry 加必填 ctx；BuiltinToolSubagentContext 加 callableAgents；run-agent-turn 装配段改读 agentRegistry.list() 预算 callable 塞 callableAgents；删 getSubagentNames；validateAgentToolPolicy 中心过滤 task（AC-9）。core src build 通过。

下一步：wave-2 impl-test-fix（Step 13-16，修 17 个 core 既有测试文件的编译断裂/断言失效）。子代理已派发但因用户要关机被取消，未执行任何改动，下次从这里继续。当前 HEAD = 340dad60，工作区干净。

测试失败基线（区分本迭代引入 vs pre-existing）：base 37dcd56c 上有 12 个 pre-existing core 测试失败（vfs/fs-command 系列、agent-registry-delete-invalid），非本迭代范围；model 阶段引入 2 个预期失败（subagentCallable-strip 用例→Step28、agent-registry-list-seed→Step30）。cli build 在 base 上就因 session/commands.ts 的 SessionDeps 缺 sessionKkv 而红（pre-existing）。

剩余 wave：test-fix → verify-core → cr-func-core → persist+form 并行 → cr-func → desktop+mobile 并行 → cr-func → test-doc → cr-func-final → dev-ready。
