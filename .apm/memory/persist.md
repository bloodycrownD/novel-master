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

## thinking-level（待确认 spec）

| 文档 | 路径 |
|------|------|
| PRD | Iterations/thinking-level/prd.md |
| SPEC | Iterations/thinking-level/spec.md |

**依赖**：model-generation-params（main 未发版部分）

**核心方案**：`generation.thinkingLevel` 四档；`ModelThinkingParams` 仅运行时；preset 表 `thinking-level-presets.ts`

**基线**：`v1.2.7` 读入 → `off`；替换未发布 `thinking.enabled` Switch

## project-agent-config（下一迭代）

| 文档 | 路径 |
|------|-----|
| PRD | Iterations/project-agent-config/prd.md |
| SPEC | Iterations/project-agent-config/spec.md |

**分支建议**：`feature/project-agent-config`

**核心方案**：`chat_project.agent_config_json` **列**（非独立表）；`resolveAgentForProject` discriminated union（custom 无 agentId）；run 仅消费 definition；copy 复制列

**已确认**：克隆全局 / copy 复制 / 跟随保留草稿 / ChatRail 入口

**主要风险**：调用方假设必有 agentId；prompt/meta 漏改 projectId

## empty-storage-root-list-not-found（已合并 main）

| 文档 | 路径 |
|------|------|
| Bug PRD | Iterations/vfs-unified-root/bugs/empty-storage-root-list-not-found/prd.md |
| Bug SPEC | Iterations/vfs-unified-root/bugs/empty-storage-root-list-not-found/spec.md |

**根因**：`DefaultVfsService.list()` 未对 `isStorageRootParent` 豁免（`06e91720` 回归）

**修复**：main @ `4d821e60` + docs `3f7512f5`

## hide-vfs-turn-prompt-char-count（待确认 spec）

| 文档 | 路径 |
|------|------|
| PRD | Iterations/hide-vfs-turn-prompt-char-count/prd.md |
| SPEC | Iterations/hide-vfs-turn-prompt-char-count/spec.md |

**依赖**：vfs-user-ops-unified-tool-turn、message-visibility、mobile-app

**缺陷 A**：hidden 时 transcript 仍合成 `user_vfs_turn`（`matchUserVfsTurnAtForDisplay`）；LLM 仍跳过 hidden

**缺陷 B**：`PromptPreviewSegmentCard` 折叠字数与预览分开展示

**分支建议**：`fix/hide-vfs-turn-prompt-char-count`

## mobile-stream-end-flicker（已合并 main）

| 文档 | 路径 |
|------|------|
| PRD | Iterations/mobile-stream-end-flicker/prd.md |
| SPEC | Iterations/mobile-stream-end-flicker/spec.md |

**方案**：immediate reload → streamCommit bridge；promoteStreamTailToRow；防 step+RUN_FINISHED 双提交
