---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-23 17:40:17'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

core 导出 `greet`；cli 为占位入口。布局见 `kb/docs/monorepo.md`。