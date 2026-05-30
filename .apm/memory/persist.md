---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-30 20:00:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

main（截至 0d4e7a7）已含：TDBC、VFS、chat-project-vfs、virtual-worktree、prompt-engine、**sksp-provider-model**、**agent-system**（`AgentRunner`、tools/stream、`nm agent`）、**agent-config-and-compaction**（`AgentDefinition`、`CompactionPipeline`、`deserializeAgentDefinition`/`serializeAgentDefinition`；CLI `--agent-config`）、**agent-prompt-abstract-block**（`PromptBlock` 含 `type: abstract`；空 `abstract` 时不拼接；**已移除** `PromptBlock.when`）。示例 `examples/agent-writer.yaml`；UI 壳原型 `examples/mobile/`：**会话操作**左侧抽屉（会话内 ☰）+ **会话日志**统一时间线（已合并工具日志/检查点入口，移除 Chip）；迭代文档 `kb/docs/Iterations/mobile-prototype-session-drawer/`。**已移除**：`parsePromptYaml`、`DefaultCompactionService`、运行时 `agent.compaction.*`、`PromptBlock.when`、`prompt-block-when.ts`。CLI `nm`；默认库 `.novel-master/novel.db`（指针/偏好在库内 KKV，不用 `config.json`）；**persistent-state-and-preferences**（`feature/persistent-state-and-preferences`）：**PersistentState** / **PersistentPreferences**，`nm preferences`，无 `nm config`/`nm kkv`。见 `CHANGELOG.md`。布局 `kb/docs/monorepo.md`；迭代 PRD/SPEC `kb/docs/Iterations/*/`。
