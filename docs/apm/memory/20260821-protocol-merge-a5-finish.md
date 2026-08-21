# protocol-merge 迭代 A5 收尾（impl-A5-finish）

- 日期：2026-08-21；worktree `.woktree/pms`，分支 `feat/protocol-merge-agent-tool-mermaid-sharp`。
- 背景：A4（939d69b/b8c7bdd/789df3a）已删净 done 桥源码链路，本节点收测试/快照/文档残留。
- 改动：
  - `packages/core/test/chat/user-vfs-turn.service.test.ts`：删 `appendToolTurnBridge` 用例与 `TOOL_TURN_BRIDGE_TEXT`/`readMessageMetadata` import（后者仅桥用例使用）。
  - 存量桥字面量替代（import 改内联 `"【done】"`，用例本体保留）：workplace-prompt-ux（T-WP5/T-WP5b）、render-prompt（T-WT4/4b/7）、workplace-layout-c0（T-W5b）、agent-runner-template-blocks（T-WT16/R3）、normalize-for-llm-export（T-WT9，直连 impl 的 import 一并删）。
  - T-WP5b 本体原是 `assert.equal(TOOL_TURN_BRIDGE_TEXT, "【done】")`，常量删除后改写为 `assert.notEqual(DEFAULT_WORKPLACE_ASSISTANT_TEXT, "【done】")`（解耦语义保留）。
  - mobile composer integration：删 `appendToolTurnBridge` mock 与 `lastMessageHasToolResult` prop，新增 T-PM5（末条 user 含 tool_result 时输入直发 runAgentTurn、Alert 不弹、桥不调）；conversation-panel mock context 删 `lastMessageHasToolResult`。
  - `public-chat-allowlist.json` 移除 `TOOL_TURN_BRIDGE_TEXT`；vfs-flush-insert-after-assistant spec L27-33 机制表加「桥已移除」注记；CHANGELOG Unreleased 段新增一条（变更：中断后继续对话不再弹确认框）。
- 经验：
  - core 测试夹具依赖 `packages/core/dist`，跑测试前须 `npm run build`（缺 dist 会报 ERR_MODULE_NOT_FOUND dist/public/session-kkv.js）。
  - 桥的固定文案字面量即 `"【done】"`（原 append-tool-turn-bridge.ts），历史会话出站兼容靠存量用例锁字面量。
