---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-24 22:00:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

main 已含：TDBC、SqlTemplateParser、VFS、chat-project-vfs（project/session/message/kkv、scoped vfs、session-fs）、virtual-worktree（worktree 规则、template pull、`<file>` display）、**prompt-engine**（YAML blocks、`text`/`chat`、轻量宏、`nm prompt render`）。CLI 入口 `nm`；默认库 `.novel-master/novel.db` + `config.json`。布局与命令见 `kb/docs/monorepo.md`；迭代文档在 `kb/docs/Iterations/*/`。