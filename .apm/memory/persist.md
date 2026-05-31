---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-31 19:30:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）；`apps/mobile` → `@novel-master/mobile`
- Node 22+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit
- Core 分层见 `packages/core/ARCHITECTURE.md`（domain / service / infra / errors；自然依赖：domain 可依赖 infra，禁止 domain→service）

## 现状

### 已合并：mobile-app（main，分支 `feature/mobile-app-c0`）

- **C0 Core**：`infra/random-uuid`、`PersistentState.currentAgentId`、Agent `vfs.*` 经 `SessionFsService.execute`、导出 `KkvService`
- **M1–M6 `apps/mobile`**：3 Tab（对话/Agent/我的）、项目/会话抽屉、VFS 文件管理器、Chat+AgentRunner、Profile 配置栈、SessionLog、§14 扩展（provider CRUD、template pull、会话复制）
- **App 层**：`createMobileNovelMasterRuntime`、`AppUiPreferences`（KKV `nm-mobile-ui`）、Metro monorepo + tiktoken/zod 兼容 shim
- **Android 构建**：`react-native-svg@15.15.5`（RN 0.85 Fabric）；Gradle 仅 autolink `sksp-android`（避免 BuildConfig 重复）
- **项目 CRUD UI**：新建/重命名需输入名称（`ProjectService.rename`）
- 文档：`.apm/kb/docs/Iterations/mobile-app/{prd,spec}.md`；UI 权威 `examples/mobile/docs/feature-inventory.md`

### 已合并：core-package-structure（main @ bf3fba1）

- domain 模块模板：`model/`、`logic/`、`ports/`、`repositories/`；errors 统一到 `errors/`
- infra adapter 型：`llm-protocol` / `sksp` / `tdbc` → `ports/` + `impl/` + `logic/`
- `VfsService` 契约在 `domain/vfs/ports/`；`zodToJsonSchema` 在 `infra/serialization/`
- Breaking API：`createSqliteCompactionAgentResolver`（原 `createDbCompactionAgentResolver`）
- 文档：`packages/core/ARCHITECTURE.md`；`.apm/kb/docs/Iterations/core-package-structure/{prd,spec}.md`

### main 其他能力（token-counting、sksp、agent-system、regex、compaction-policy 等）

见各迭代 PRD/SPEC 于 `.apm/kb/docs/Iterations/`。

### 参考

- 布局：`kb/docs/monorepo.md`
- 变更：`CHANGELOG.md`
