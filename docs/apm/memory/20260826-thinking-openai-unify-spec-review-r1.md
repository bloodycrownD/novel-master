---
date: 2026-08-26
title: thinking-openai-unify spec 第 1 轮审查修复（Go，1 条 P2）
keywords: thinking-openai-unify, spec, CR, grep 误报, dist 孤儿产物, .woktree, clean script
abstract: thinking-openai-unify 的 spec 第 1 轮审查结论 Go，仅 1 条 P2 must-fix——Step 2 残留 grep 会命中 packages/core/dist 孤儿编译产物（openai-glm-thinking.js 等）、.woktree 副本与 node_modules 造成误报。已修：grep 加排除（**/dist/**、**/node_modules/**、.woktree/**，rg -g 过滤）并写明先 npm run clean -w @novel-master/core 再 typecheck。仅改 spec.md Step 2，未动实现代码。
---

user:
（非 readonly 模式，只改 SPEC 不改实现代码，唯一可写文件 docs/Iterations/thinking-openai-unify/spec.md）第 1 轮审查结论 Go，仅一条 P2 must-fix：Step 2 的残留 grep 会命中 packages/core/dist/ 编译产物（openai-glm-thinking.js 等现存）、.woktree/* 副本与 node_modules，造成误报。修改 Step 2：grep 排除 **/dist/**、**/node_modules/**、.woktree/**，或写明先 npm run clean -w @novel-master/core 再 typecheck（tsc 增量构建不删孤儿产物，package.json 有 clean/rebuild script 先例）。约束：只改 Step 2 相关内容。

assistant:
已闭合 P2-1，且两个建议都采纳（排除 + clean 前置，双保险）：
- 核实主仓 `packages/core/package.json` 确有 `clean`（rmSync dist）与 `rebuild` script，`typecheck` 为 `tsc --noEmit -p tsconfig.json`；`.woktree/` 下有 model-select-all、sql-cr-validation、token-usage-stats、vfs-seq-fix 四个并行工作树副本，grep 全仓必命中。
- Step 2 改法：grep 段写明排除 `**/dist/**`、`**/node_modules/**`、`.woktree/**`，附 rg 命令示例（`rg -n 'isGlmDefaultThinkingOnModel|applyGlmThinking|openai-glm-thinking' -g '!**/dist/**' -g '!**/node_modules/**' -g '!.woktree/**' packages apps`），并注明 dist 孤儿产物与 .woktree 副本命中不算残留；typecheck 段改为先 `npm run clean -w @novel-master/core` 再 `npm run typecheck`，理由是 tsc 增量构建不删孤儿产物。
- 仅改 `docs/Iterations/thinking-openai-unify/spec.md` 的 Step 2 段落，实现代码与其余章节零改动。第 1 轮唯一 must-fix 已闭合，spec 维持 Go。
