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

### main（截至 b809bf2）

- TDBC、VFS、chat-project-vfs、virtual-worktree、prompt-engine
- sksp-provider-model、agent-system（`AgentRunner`、tools/stream、`nm agent`）
- agent-config-and-compaction、agent-prompt-abstract-block（`PromptBlock` 含 `type: abstract`；**已移除** `PromptBlock.when`）
- global-compaction-policy（**CompactionPolicy** KKV `nm-compaction/policy`；**AgentDefinition 无 compact**；`abstract.type: agent` 用 **agentId**；CLI **`nm compaction`**；agents registry）
- examples/mobile：会话操作抽屉、会话日志、「我的 → 压缩策略」mock
- CLI `nm`；默认库 `.novel-master/novel.db`；**PersistentState** / **PersistentPreferences**（`nm preferences`）

### 进行中：feature/core-package-structure（未 merge）

- domain 模块模板：`model/`、`logic/`、`ports/`、`repositories/`；errors 统一到 `errors/`
- infra adapter 型：`llm-protocol` / `sksp` / `tdbc` 使用 `ports/` + `impl/` + `logic/`
- `VfsService` 契约在 `domain/vfs/ports/`；`zodToJsonSchema` 在 `infra/serialization/`
- Breaking API：`createSqliteCompactionAgentResolver`（原 `createDbCompactionAgentResolver`）
- 文档：`.apm/kb/docs/Iterations/core-package-structure/{prd,spec}.md`

### 参考

- 布局：`kb/docs/monorepo.md`
- 变更：`CHANGELOG.md`
