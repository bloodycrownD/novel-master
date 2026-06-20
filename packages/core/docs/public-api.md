# @novel-master/core 公开 API 说明

本文描述 `@novel-master/core` 的 **export 边界**：主入口、`public/*` 子入口与辅助子路径的职责划分。契约由 `test/package-exports/` 下的 allowlist 快照与架构守卫测试固化；任意有意变更公开符号须同步更新快照并在 PR 中说明。

> **快照范围**：仅覆盖 runtime `import *` 可见的 named export；`export type` 等纯类型符号不在快照内（见 SPEC）。

---

## 1. 双层模型

| 层级 | 入口 | 用途 |
|------|------|------|
| 主入口 | `@novel-master/core` | 应用/bootstrap、TDBC、Tool、PersistentState、serde 等横切能力 |
| Public 收口 | `@novel-master/core/{agent,chat,...}` | 按领域划分的 **10** 个子模块（见 `src/public/*`） |
| 辅助子路径 | `./kkv`、`./config-forms/*`、`./tdbc`、`./sksp`、`./nmtp`、`./front-matter` | 偏好存储、UI 表单、驱动直连等 |

主入口 **不** re-export 各 public 子入口的工厂函数（见 `test/package-exports-t0.test.ts` denylist）。

---

## 2. 主入口职责（摘要）

- **数据库 / bootstrap**：`bootstrapNovelMaster`、`NOVEL_MASTER_SCHEMA_STATEMENTS`
- **TDBC**：`open`、`registerDriver`、`TdbcError` 等（驱动实现请用 `./tdbc` 或主入口均可）
- **Tool 运行时**：`ToolRegistry`、`ToolRunner`、`registerBuiltinTools`、`createVfsTools` 等
- **持久化**：`createPersistentState`、`createPersistentPreferences`
- **云同步 / 备份**：`CloudSyncCoordinator`、`dumpProviderTableSnapshot` 等
- **KKV 错误类型**：`KkvError`（**工厂** `createKkvService` 在 `./kkv`，不在主入口）
- **Sql 模板**：`SqlTemplateParser`、`executeTemplate` 等

主入口 **不得** 导出：`createKkvService`、各 `create*Service` 工厂、以及 `SimpleEventBus`、`readTokenCounterModeFromPreferences`（内部实现细节）。

---

## 3. Public 子入口（10 个）

| 子路径 | 领域边界 |
|--------|----------|
| `./agent` | Agent 定义、注册表、Runner 相关工厂与类型 |
| `./chat` | 消息、会话、LLM 对话侧服务 |
| `./compaction` | Compaction 条件与 depth slice 工具 |
| `./events` | Events 配置存储 |
| `./prompt` | Prompt 组装（含 **已知** 来自 config-forms 的 re-export，见 canonical 表） |
| `./provider` | Provider CRUD / 模型配置服务 |
| `./regex` | Regex 配置服务 |
| `./session-fs` | Session 文件系统与 checkpoint 相关（当前） |
| `./vfs` | scoped VFS 服务与工具 |
| `./worktree` | Worktree 与 front matter 解析（`parseMarkdownFrontMatter`） |

架构守卫：`public/*` 源文件 **禁止新增** 对 `config-forms` 的 import；当前唯一登记豁免为 `prompt.ts`（`KNOWN_LEAKS`）。

---

## 4. 辅助路径

| 路径 | 说明 |
|------|------|
| `./kkv` | App 级键值偏好（`createKkvService`） |
| `./config-forms` 及子路径 | UI 配置表单专用 re-export |
| `./tdbc` / `./sksp` / `./nmtp` | SQLite / SKSP / NMTP 驱动注册与底层 API |
| `./front-matter` | 独立 front matter 模块（与 worktree 能力重叠，见 canonical） |

---

## 5. Canonical 路径表（P2 起维护）

| 能力 | 推荐（Canonical） | 过渡 re-export |
|------|-------------------|----------------|
| depth slice 工具 | `@novel-master/core/compaction` | `config-forms/events`、`config-forms/shared` |
| tokenizer 驱动注册 | `@novel-master/core/nmtp` | `@novel-master/core/provider` |
| agent 编辑器块操作 | `@novel-master/core/config-forms/agent` | `@novel-master/core/prompt`（计划 deprecated） |
| front matter 解析 | `@novel-master/core/worktree` | `./front-matter`（零消费时可移除 export） |
| message checkpoint | `@novel-master/core/session-fs`（当前） | 未来 `./message-checkpoint` / `./chat`（P3） |

重复 export **必须** 指向同一实现（见 `duplicate-export-consistency.test.ts`）。

---

## 6. 变更流程

1. 修改 `src/index.ts` 或 `src/public/*` 的 export 面
2. 运行 `npm run test:fast -- test/package-exports/**/*.test.ts`，按提示更新 `test/package-exports/snapshots/*.json`
3. 更新 changelog / PR 描述，并 grep monorepo 消费方

内部 `domain/**` 文件移动 **若未改变** public re-export 链，快照不应变化。
