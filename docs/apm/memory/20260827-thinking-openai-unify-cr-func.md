# thinking-openai-unify 功能检查（cr-func）

- 日期：2026-08-27
- 节点：cr-func-thinking-openai-unify
- worktree：`.woktree/thinking-openai-unify`，分支 `feat/thinking-openai-unify`，base b3429b0，head 5574069
- 范围：spec Step 1~5 全部（readonly，未改任何文件）

## 结论

- **func-ready: yes**，无 must-fix。
- 源码三处（apply-thinking-to-body.ts 拆特判+两参签名、openai.adapter.ts 两处去参、删 openai-glm-thinking.ts）与 spec 变更点清单逐条一致。
- T-TO1~T-TO8 真实存在、断言口径一致；T-TO5 路径核实：带 thinking 时 `useTextOnlyShortcut` 返回 false → `chatNonStream` → `buildBody`，用例覆盖正确。
- 三基线测试（anthropic / gemini / glm-tool-stream）与 anthropic / gemini 源码零改动（diff 文件清单确认）；grep 复核 `isGlmDefaultThinkingOnModel|applyGlmThinking|openai-glm-thinking` 在 packages/apps 主树零残留。

## spec_deviations

1. head 提交 5574069 混入记忆文档 `docs/apm/memory/20260826-thinking-openai-unify-impl.md`（21 行），超出 spec 文件清单；项目记忆规矩要求记录，属流程性偏差，无代码语义。
2. Step 5 的 lint：verify 摘要未提；impl 记忆称 lint 基线存在两个遗留 error（sanitize-entry-filename no-control-regex、annotate-source-range prefer-const），非本期引入。
