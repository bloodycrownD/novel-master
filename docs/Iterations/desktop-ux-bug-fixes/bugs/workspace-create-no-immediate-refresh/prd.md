---
date: 2026-06-22
dependency: Iterations/desktop-ux-bug-fixes/prd.md
---

# workspace-create-no-immediate-refresh Bug PRD

## 背景

`desktop-ux-bug-fixes` 迭代已为 Agent write/edit、Preview 保存等路径补齐 Desktop Explorer **实时刷新**。用户通过工作区右键 **新建文件/文件夹** 属于另一条 VFS 写盘路径，验收时发现列表仍不即时更新。

## 现象描述

Desktop 工作区（Explorer）通过右键菜单「新建文件」或「新建文件夹」创建条目成功后，中间栏文件树 **不立即** 显示新路径；需 **切换到其他会话再进入** 当前会话后，新文件才出现在列表中。

## 复现步骤

1. 打开 Desktop，进入某项目下的会话（conversation 视图）
2. 在 Explorer 空白处或某目录上 **右键** →「新建文件」
3. 输入文件名（如 `test.md`）并确认
4. 观察 Explorer 文件树

## 预期行为

创建成功后 **3 秒内** Explorer 自动出现新文件/文件夹，无需切换会话或手动刷新。

## 实际行为

创建成功后 Explorer **无变化**；切换会话后再进入才可见新条目。

## 影响范围

- **平台**：Desktop only
- **操作**：右键新建文件、新建文件夹、重命名（同一代码路径）
- **不影响**：Agent 工具 write、Preview 保存（已在 Bug 3 修复）、删除（原本即有 refresh）

## 验收标准

- **Given** Desktop 会话工作区 Explorer 已打开  
  **When** 右键新建文件 `foo.md` 并确认成功  
  **Then** Explorer **立即** 出现 `foo.md`，无需切换会话

- **Given** 同上  
  **When** 右键新建文件夹 `notes` 并确认成功  
  **Then** Explorer **立即** 出现 `notes` 目录

- **Given** 某文件已存在  
  **When** 右键重命名并确认成功  
  **Then** Explorer 列表 **立即** 反映新名称

## 回归测试要点

- 删除、include 切换、目录规则保存等原有 refresh 路径仍正常
- Agent write/edit 后实时刷新（Bug 3）无回归
