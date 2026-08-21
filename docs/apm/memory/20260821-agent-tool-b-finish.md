# protocol-merge 迭代 B3/B4 收尾（impl-B-finish）

- 日期：2026-08-21；worktree `.woktree/pms`，分支 `feat/protocol-merge-agent-tool-mermaid-sharp`。
- 背景：B1/B2（d12a058/6d7b32c）已落 agent 工具主体与接线，本节点做三端同步 + 测试（T-AG1~T-AG5）。
- 改动：
  - Step B3（28dd901）：`BUILTIN_TOOL_CATALOG` 加 agent 条目（8→9）；`summarizeToolSuccess` 加 agent 分支（list 条数 +truncated / get 定义名 / create+update「已保存 名」），置于 generic matches/paths 分支之前（list 的 entries+total 会撞上，与 skill 同理）；mobile `AgentEditorForm` 与 desktop `AgentEditorView` / `AgentDefinitionEditorForm` 三处硬编码「全部内置工具（8 个）」改 9 并补 agent——desktop 的 ToolPolicyPicker 走 `BUILTIN_TOOL_CATALOG.length` 自动适应无需改，但两处 hint 文案是硬编码，spec 说「mobile 唯一硬编码点」不准确，靠 grep 补齐。
  - 存量计数断言同步 8→9：skill-tool / vfs-tools / tool-schema-descriptions 三处 `registry.list().length`。
  - T-AG5：`test/config-forms/agent-tool-catalog.test.ts`（9 条 + agent 条目口径）+ mobile `__tests__/agent-editor-form-tool-count.test.ts`（源码正则锁 9 个与名单，照 provider-detail-tabs 样式）。
  - Step B4（9396729）：`test/tool/agent-tool.test.ts` 18 例（T-AG1 字段校验含字段名 / T-AG2 general by-name 走 list、by-agentId 走 getRawWire+get / T-AG3 mock upsert 抛 AgentConfigError → INVALID_ARGUMENT 含原因 / assembleAgentsToolContext 含/不含两态）；`agent-tool-policy.test.ts` 补 T-AG4（subagent / depth>=2 摘除、deny 摘除、allow 显式保留）；`build-tool-result-block.test.ts` 补 agent 摘要用例。
- 验证：`test/tool + test/agent + test/config-forms` 398 例全绿；core typecheck 过；mobile jest 新增 2 例绿。
- 经验：
  - worktree 里 `node_modules/@novel-master/tdbc-driver-better-sqlite3` 只有 src 没有 dist 时，依赖它的测试（vfs-tools 等，经 test/helpers/novel-master.ts 引入）报 ERR_MODULE_NOT_FOUND——去包目录 `npm run build` 即好。
  - node:test 测试标题里写 `mode==="subagent"` 这类带双引号的代码片段要转义，esbuild transform 直接报错不指明是标题。
  - 双端工具卡片摘要都消费 core 的 `block.summary`（`toolCallSummary`），core 加分支即双端生效，无需各自补渲染逻辑。
