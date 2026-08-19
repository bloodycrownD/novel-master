# 2026-08-19 global-fs-manager 迭代执行（多轮）

## 2026-08-19 第 4 轮：impl-s6-desktop（Step 6）

- 节点：impl-s6-desktop，worktree `.woktree/global-fs`，分支 `feat/global-fs-manager`，基线 2898f49。
- 任务：desktop projects 视图全局面板改只读物理树浏览器——`WorkspacePanelScope` 加 `'physical'`、物理浏览 IPC（list/read 两 handler 走 `rt.physicalVfs()`，无写 handler）、`resolve-vfs-scope` 保持既有解析不动（physical 在 handler 层分流）、renderer invoke 封装、`nav-workspace`/`ExplorerPane`/`WorkspaceTree` 只读换源（隐藏全部写菜单/拖拽）、`PreviewPane` 只读预览路由、T-PB4 测试（IPC 层单测）。
- 约束：不碰 `packages/**` 与 `apps/mobile/**`（并行子代理在改）；既有面板（global/session/chat/meta）行为不变；CRLF 禁 python 文本模式；验证 `npm run typecheck`（apps/desktop）+ `node scripts/run-tests.mjs --test-concurrency=1`。
- 相关记忆：`20260819-global-fs-manager-spec-review.md`（spec 评审轮）。
