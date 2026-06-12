---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-13 00:15:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`（含 `config-forms` 子路径）；`apps/cli` → `@novel-master/cli`；`apps/mobile` → `@novel-master/mobile`
- Node 22+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit
- Core 分层见 `packages/core/ARCHITECTURE.md`
- 应用图标源图：`assets/icon.webp`（构建/CI 复制为根目录 `icon.webp` 供 icon 脚本，**不入库**）

## 现状

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

### 参考

- 布局：`kb/docs/monorepo.md`
- 变更：`CHANGELOG.md`
