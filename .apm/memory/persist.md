---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-08-08 01:12:01'
---
﻿## 工具坑

- grep / find_path 的 glob 在本仓库有 bug：搜 `packages/core/test/**/*.ts` 等深层 glob 会零命中（文件实际存在）。验证文件存在性必须用 list_directory + read_file，不要信任 glob 结果。

## 子代理重构关键设计（agent-mode-refactor）

- Tool.description 改纯函数 `(ctx: Ctx) => string`（不用 union）；toolsFromRegistry 内部调 tool.description(ctx) 后输出 LlmToolDefinition.description 仍为 string。
- task 作为静态内置工具在 registerBuiltinTools 里统一注册；task 不进用户 allow/deny，靠 validateAgentToolPolicy 内部中心过滤实现。
- AgentDefinition.mode: primary/subagent/all（缺省 all）；内置 general 固定 mode=subagent，禁止用户 upsert name=general。
- subagent 功能未发布（不在任何 tag），删除 subagentCallable silent-strip，无迁移。

## 子代理 spec 审查教训

- 改类型签名这类「爆炸半径大」的改动，探索阶段必须扫全量消费方（含 test/ 目录），不能只搜 src/。
- doc-fix 后主代理应自己做完整性扫描（list_directory），不要直接派下一轮审查——否则漏一轮多一轮。
