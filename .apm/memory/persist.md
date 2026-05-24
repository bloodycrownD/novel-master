---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-25 00:46:30'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

main 已含：TDBC、SqlTemplateParser、VFS、chat-project-vfs、virtual-worktree、prompt-engine、**sksp-provider-model**（SKSP `@novel-master/core/sksp` + Windows/Android 驱动；`nm provider`/`nm model`；内置 OpenAI/Anthropic/Google/OpenRouter seed）。CLI 入口 `nm`；默认库 `.novel-master/novel.db` + `config.json`（含 `currentProviderId`/`currentModelId`）。布局与命令见 `kb/docs/monorepo.md`；迭代文档在 `kb/docs/Iterations/*/`。