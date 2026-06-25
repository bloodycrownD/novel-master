---
createdAt: '2026-06-23 21:39:57'
updatedAt: '2026-06-25 12:00:00'
---
# project-agent-config — spec 已确认，可进入实现

## 状态
**spec 已确认，可进入实现**

## 文档
| 文档 | 路径 |
|------|------|
| PRD | Iterations/project-agent-config/prd.md |
| SPEC | Iterations/project-agent-config/spec.md |

## 已确认决策
- 存储：`chat_project.agent_config_json` **列**（非独立表）
- custom 无 agentId；run 仅消费 AgentDefinition
- 首次切自定义：克隆全局 Agent
- copy：复制 JSON 列
- 切回跟随：保留草稿
- 入口：ChatRail / ProjectDrawer

## 建议分支
`feature/project-agent-config`

## 下一步
/subagent-inline-loop（子代理实现）
