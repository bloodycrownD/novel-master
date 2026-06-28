---
date: 2026-06-28
dependency:
  - Iterations/message-checkpoint-v2/prd.md
  - Iterations/rollback-failure-degraded-fallback/prd.md
---

# 回滚 revision 缺失 head 回补 PRD

## 背景

消息回滚（v2）在 reconcile 阶段逐 path 调用 `restorePathToRevision`：从 checkpoint 读取 `(logicalPath → revisionVersion)`，将工作区恢复到锚点树。

**现状问题（与 `rollback-failure-degraded-fallback` 的衔接）：**

| 现象 | 后果 |
|------|------|
| 任意 path 的 revision 行缺失 | 整次 reconcile 在事务内失败，**所有 path 均不恢复** |
| 用户选降级「仅删对话」 | **全部** path 跳过 VFS reconcile，能精确恢复的文件也无法恢复 |

即：个别坏 pointer 导致 **一刀切**——要么全失败 + 第二次 Alert（「无法恢复工作区 / 仅删对话」），要么全放弃 VFS。

**用户已确认的产品意图：**

- 对 revision **缺失**的 path，用 **live head 回补** placeholder revision，使 reconcile **继续**；
- 回补 **不是为了**把坏快照修准，而是 **不阻塞**其他 revision 完好的 path 正常回滚；
- 对缺失 path 而言，回补后 restore 的效果等价于 **该文件保持 rollback 前现状**。

**与现有降级 Alert 的关系：**

| 场景 | 现网 Alert | 本需求 |
|------|------------|--------|
| revision 缺失 | 「无法恢复工作区」→ 仅删对话 / 取消 | **第二次 Alert**：「快照丢失，将使用最新内容修复」→ 继续 partial reconcile / 取消 |
| 其他 VFS 失败 | 同上（仅删对话） | **不变**（仍走 degraded 流） |
| revision 均完好 | 无第二次 Alert | **不变** |

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 部分 reconcile | 多文件场景中，仅部分 revision 缺失时，用户确认后 **完好 path 恢复到锚点**，缺失 path 保持现状 |
| 可感知修复 | revision 缺失时展示 **专用第二次 Alert**，文案说明将用最新内容修复缺失快照 |
| 用户可控 | 第二次 Alert 选 **取消** → 消息与工作区均不变；选 **继续** → partial reconcile + 截断消息 |
| 消息截断 | 继续路径下 tail 消息与 checkpoint 清理与 v2 一致 |
| 回归完整回滚 | revision 均存在时，**无**第二次 Alert，行为与现网 v2 一致 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile / Desktop 写作者 | 长按消息 → 回滚 → 第一次确认 → 检测到快照丢失 → 第二次 Alert「快照丢失，将使用最新内容修复」→ 继续 → 其他文件正常回滚，损坏文件保持当前稿 |
| 多文件 Agent 会话 | tail 改了 A、B、C；仅 B 锚点 revision 丢失 → 确认修复后 A、C 回锚点，B 不动 |

## 范围

### 包含范围

1. **Core：缺失检测 + head 回补**
2. **第二次 Alert（Mobile + Desktop，revision 缺失专用）**
3. **与 degraded 分流**
4. **成功反馈**：Toast「回滚成功」
5. **测试**：RB1–RB5、DF1/DF1b 等

### 不包含范围

- hybrid inline capture、integrity CLI、CLI 交互确认
- 对缺失 path 精确恢复至锚点历史内容
- 删除 `skipVfsReconcile` API

## 核心需求

1. **两次确认（revision 缺失时）**
2. **继续 = partial reconcile**
3. **取消 = 全或无**
4. **revision 完好时不打扰**
5. **其他 VFS 错误仍 degraded**

## 验收标准

### A. revision 缺失 → 第二次 Alert → 继续（核心）

- **Given** 锚点含 `/a.md`、`/b.md`；`/b.md` 锚点 revision 缺失，`/a.md` 完好；tail 期间两文件均修改
- **When** 第一次确认 → 第二次 Alert「快照丢失，将使用最新内容修复」→ 选继续
- **Then** `/a.md` 恢复锚点内容；`/b.md` 保持 rollback 前内容；tail 消息删除；Toast「回滚成功」

### B. revision 缺失 → 第二次 Alert → 取消

- **Then** 消息与工作区与回滚前 **完全一致**

### C–G. 回归与文案

- revision 均完好：无第二次 Alert
- 非 revision 缺失 VFS 失败：degraded Alert
- 文案含「快照丢失，将使用最新内容修复」；继续选项非「仅删对话」

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 缺失 path 非精确恢复 | 用户已在第二次 Alert 被告知 |
| 双 Alert 类型并存 | UI 须严格区分 backfill vs degraded |
| 锚点应为 deleted 但 revision 丢失 | 边界 case；RB4/RB4b 覆盖 entry 不存在 |
