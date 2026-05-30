---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-05-30 22:00:00'
---
## 项目

Novel Master（novel-master）小说大师，npm workspaces Monorepo。

## 约定

- `packages/core` → `@novel-master/core`；`apps/cli` → `@novel-master/cli`（`novel-master` 命令）
- Node 20+、TypeScript ESM；根目录 `npm run build` 构建全部
- 改动最小化、匹配现有风格；仅在被要求时 git commit

## 现状

main（截至 90f70fb）已含：TDBC、VFS、chat-project-vfs、virtual-worktree、prompt-engine、**sksp-provider-model**、**agent-system**（`AgentRunner`、tools/stream、`nm agent`）、**agent-config-and-compaction**（`AgentDefinition`、`CompactionPipeline`、`deserializeAgentDefinition`/`serializeAgentDefinition`；CLI `--agent-config`）、**agent-prompt-abstract-block**（`PromptBlock` 含 `type: abstract`；空 `abstract` 时不拼接；**已移除** `PromptBlock.when`）、**global-compaction-policy**（**CompactionPolicy** 全局单例 KKV `nm-compaction/policy`；**AgentDefinition 无 compact**；`abstract.type: agent` 用 **agentId** 引用 registry；CLI **`nm compaction`** show/set/clear；`.novel-master/agents/registry.json`）。示例 `examples/agent-writer.yaml`（无 compact）、`examples/compaction-policy.yaml`；UI 壳 `examples/mobile/`：会话操作抽屉 + 会话日志；**我的 → 压缩策略**（全局 mock）；迭代 `kb/docs/Iterations/global-compaction-policy/`、`mobile-prototype-session-drawer/`。**已移除**：`parsePromptYaml`、`DefaultCompactionService`、运行时 `agent.compaction.*`、`AgentDefinition.compact`、`PromptBlock.when`。CLI `nm`；默认库 `.novel-master/novel.db`；**PersistentState** / **PersistentPreferences**（`nm preferences`）。见 `CHANGELOG.md`；布局 `kb/docs/monorepo.md`。
