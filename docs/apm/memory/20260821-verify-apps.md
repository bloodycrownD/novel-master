# verify-apps：双端 app 整体验证（A 删桥 / B 计数文案 / C mermaid）

日期：2026-08-21 · worktree：`.woktree/pms` · 分支：`feat/protocol-merge-agent-tool-mermaid-sharp`

## 验证结论

- desktop typecheck / mobile typecheck（build + web 两套 tsconfig）全绿。本次 mobile typecheck 未出现 TS5101 baseUrl 弃用警告，未建临时 tsconfig。
- mobile `build:webview` 成功，chat-transcript / rich-document / code-editor 三包产物齐。
- desktop 全量测试 55 用例：48 过 7 挂；mobile jest 全量 153 suite / 773 用例：148/766 过，5 suite / 7 用例挂。
- 本迭代五个目标测试文件（chat-composer.integration、chat-conversation-panel.integration、mermaid-fullscreen、mermaid-webview、agent-editor-form-tool-count）全部 PASS。

## 失败归因（要点）

1. 双端 tool-policy-picker 计数断言（desktop 2 + mobile 4）：**本迭代 B3 同步遗漏**。Step B3（commit 28dd901）把 `BUILTIN_TOOL_CATALOG` 8→9（新增 agent 条目），组件计数走 `catalog.length` 自动变 9，但双端测试硬编码「N/8」，测试文件最后改于本迭代之前（c5448d3）。spec B3 只注明"组件无需改"，漏了测试里的硬编码数字——T-AG5 的双端计数断言未覆盖到这两份存量测试。
2. desktop packaging/smoke/skill-zip-import 与 mobile cloud-sync/token-counter/db-backup：**环境性**。均为 workspace 包 dist 缺失或非 electron 运行时；构建依赖包后 packaging+smoke 全绿、mobile 三 suite 22/22 绿；skill-zip-import 剩 `resolve-app-icon.ts` 的 electron 命名导出问题，该引用链本迭代零改动（最后改动 v1.4.21），判存量。
3. mobile use-chat-tab-message-actions-unhide（3 用例）：**存量**。本迭代唯一触碰 chat-tab 的 789df3a 只删 `lastMessageHasToolResult` 一行透传（与 unhide 链路无关）；基线 a17579e 上同环境复跑同样失败。

## 经验

- `npx jest` 绕过 pretest 会导致 moduleNameMapper 指向的 packages/*/dist 缺失，先 `npm run build -w` 相关包再跑，避免误判代码失败。
- 基线复跑取证时注意 `packages/core` 的 dist 不会随 `git checkout <base> -- apps/mobile` 回退，涉及 core 产物的断言（如 catalog 计数）会被新 dist 污染，需以 diff 证据为主。
