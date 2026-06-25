---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-24 00:00:00'
---
## desktop-chat-workspace-polish

| 文档 | 路径 |
|------|------|
| PRD | Iterations/desktop-chat-workspace-polish/prd.md |
| SPEC | Iterations/desktop-chat-workspace-polish/spec.md |

**分支建议**：`feature/desktop-chat-workspace-polish`

**F4 实现**：checkpoint 终态 diff → synthesize user-vfs-action；不改 checkpoint schema；空目录用 listDirectoryPaths；rename 合成层启发式

**实现顺序**：F3 → F2 → F4（Core）

## model-generation-params（已合并 main）

| 文档 | 路径 |
|------|------|
| PRD | Iterations/model-generation-params/prd.md |
| SPEC | Iterations/model-generation-params/spec.md |

**合并**：main @ e6e03eea

## project-agent-config（下一迭代）

| 文档 | 路径 |
|------|-----|
| PRD | Iterations/project-agent-config/prd.md |
| SPEC | Iterations/project-agent-config/spec.md |

**分支建议**：`feature/project-agent-config`

**核心方案**：`chat_project.agent_config_json` **列**（非独立表）；`resolveAgentForProject` discriminated union（custom 无 agentId）；run 仅消费 definition；copy 复制列

**已确认**：克隆全局 / copy 复制 / 跟随保留草稿 / ChatRail 入口

**主要风险**：调用方假设必有 agentId；prompt/meta 漏改 projectId
