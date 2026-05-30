---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-30 15:30:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

main（截至 db092dd）已含：TDBC、VFS、chat-project-vfs、virtual-worktree、prompt-engine、**sksp-provider-model**、**agent-system**（`AgentRunner`、tools/stream、`nm agent`）、**agent-config-and-compaction**（`AgentDefinition`、`CompactionPipeline`、`deserializeAgentDefinition`/`serializeAgentDefinition`；CLI `--agent-config`）、**agent-prompt-abstract-block**（`PromptBlock` 含 `type: abstract`；空 `abstract` 时不拼接；**已移除** `PromptBlock.when`）。示例 `examples/agent-writer.yaml`；UI 壳 `examples/ui-shell-prototype/` Agent 配置编辑原型。**已移除**：`parsePromptYaml`、`DefaultCompactionService`、运行时 `agent.compaction.*`、`PromptBlock.when`、`prompt-block-when.ts`。CLI `nm`；默认库 `.novel-master/novel.db`（指针/偏好在库内 KKV，不用 `config.json`）；进行中 `persistent-state-and-preferences`。布局 `kb/docs/monorepo.md`；迭代 PRD/SPEC `kb/docs/Iterations/*/`。
