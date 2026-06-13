---
createdAt: "2026-05-23 17:38:51"
updatedAt: "2026-06-14 00:30:00"
---

## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`（含 `config-forms` 子路径）；`apps/cli` → `@novel-master/cli`；`apps/mobile` → `@novel-master/mobile`
- Node 22+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit
- Core 分层见 `packages/core/ARCHITECTURE.md`
- 应用图标源图：`assets/icon.webp`（icon 生成脚本与 UI 均引用此路径）

## 现状

### feature/chat-workspace-agent-sync（@ fix/glm-tool-stream-stalled-metrics 已 merge）

- **两事件工具 UX**：thinking 结束无正文 → stream「工具调用中」；assistant 落库 → pending 工具卡
- **metrics 条**：计时 + 正文/思考字数（**无** tool 参数计数）；已移除 TOOL_USE_DELTA / tool_stream
- **VFS**：`vfsMutated` 条件刷新工作区
- 文档：`.apm/kb/docs/Iterations/chat-workspace-agent-sync/{prd,spec}.md`；bugs 子目录含 5 个 fix 记录
- 真机验收通过（2026-06-14）

### 已合并：prompt-block-lifecycle（main @ 99f6f77）

- Prompt 块 `lifecycle: always | once`（默认 always）；`once` 仅 `runner.run()` step 0 拼入
- `shouldIncludePromptTextBlock` + `render-prompt` `agentStepIndex`；AgentRunner 传入 step
- Desktop/Mobile Agent 编辑器「常驻」开关；system text 无 lifecycle UI
- Desktop 添加块小菜单（文本块/会话块）；ContextMenu portal + 延迟 document 监听
- 文档：`.apm/kb/docs/Iterations/prompt-block-lifecycle/{prd,spec}.md`

### 已合并：config-forms-merge-into-core（main @ ea36a3c）

- `@novel-master/config-forms` 迁入 `packages/core/src/config-forms/`；独立包已删

### main 其他能力

见各迭代 PRD/SPEC 于 `.apm/kb/docs/Iterations/`。

### 待确认：prompt-engine-three-regions

- **PRD**：`.apm/kb/docs/Iterations/prompt-engine-three-regions/prd.md`
- Prompt 三区：persist（text+worktree，禁宏）/ chat / dynamic（text+宏实时刷）
- 移除 `refresh-macros` 事件 action；事件总线与压缩条件保留
- `{{.worktree}}` 废弃；filetree 宏与 worktree 解耦
- 旧扁平 `blocks`：**严格校验**，不自动迁移，用户手动改配

### 参考

- 布局：`kb/docs/monorepo.md`
- 变更：`CHANGELOG.md`