---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-31 12:00:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit
- Core 分层见 `packages/core/ARCHITECTURE.md`（domain / service / infra / errors；自然依赖：domain 可依赖 infra，禁止 domain→service）

## 现状

### 已合并：core-package-structure（main @ bf3fba1）

- domain 模块模板：`model/`、`logic/`、`ports/`、`repositories/`；errors 统一到 `errors/`
- infra adapter 型：`llm-protocol` / `sksp` / `tdbc` → `ports/` + `impl/` + `logic/`
- `VfsService` 契约在 `domain/vfs/ports/`；`zodToJsonSchema` 在 `infra/serialization/`
- Breaking API：`createSqliteCompactionAgentResolver`（原 `createDbCompactionAgentResolver`）
- 文档：`packages/core/ARCHITECTURE.md`；`.apm/kb/docs/Iterations/core-package-structure/{prd,spec}.md`

### main 其他能力（截至 b809bf2 基线之上）

### 参考

- 布局：`kb/docs/monorepo.md`
- 变更：`CHANGELOG.md`
