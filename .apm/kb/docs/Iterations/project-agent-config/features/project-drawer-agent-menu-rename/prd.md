---
date: 2026-07-23
dependency: Iterations/project-agent-config/prd.md
---

# project-drawer-agent-menu-rename Feature PRD

## 背景与变更动机

项目智能体配置入口在 Mobile 项目抽屉（`ProjectDrawer`）行菜单中文案为「智能体配置」。产品希望缩短为「智能体」，与父级 PRD「新增 **智能体** 配置区」表述对齐，减少菜单字数。

## 范围说明（相对原需求）

**包含**

- 仅 Mobile `ProjectDrawer` 项目行菜单项展示文案：`智能体配置` → `智能体`
- 菜单 `action` 仍为 `agent-config`，导航与业务行为不变

**不包含**

- 全局「我的 → 配置」中的「智能体配置」（`AgentsSettings`）
- 项目配置页导航/卡片标题「项目智能体配置」
- Agent 选择器空态提示中的「智能体配置」
- Desktop `ChatRail` 等同名入口文案

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `apps/mobile` `ProjectDrawer` | 用户可见菜单 label |
| 无 Core / IPC / 路由变更 | — |

## 验收标准

- Given 打开 Mobile 项目抽屉并打开某项目行菜单  
  When 查看菜单项  
  Then 可见「智能体」，不再显示「智能体配置」  
  And 点击该项仍进入该项目的智能体配置页（行为与改前一致）

## 测试用例

- `project-drawer-agent-config`：选择 `agent-config` 仍触发 `onOpenAgentConfig(projectId)`
