---
date: 2026-06-29
dependency: Iterations/UI优化/prd.md
---

# 会话列表顶栏显示项目名称 Feature PRD

## 背景与变更动机

会话列表页同时存在顶栏「会话」与「当前项目 xxx」banner，项目名重复展示、占用垂直空间。用户希望顶栏直接显示项目名，去掉 banner。

## 范围说明（相对原需求）

相对 `mobile-app` PRD 的「当前项目 Banner」与列表顶栏「会话」：**有意调整 IA**——项目名提升至 AppHeader；banner 移除。项目切换仍通过顶栏 ☰ 打开项目抽屉。

## 影响模块与接口

- Mobile：`AppHeader`、`ChatTabScreen`、`ChatSessionListPanel`、`ChatHeaderContext`
- 不影响：对话页顶栏、项目工作区分段、我的 Tab

## 验收标准

1. **Given** 已选项目且处于会话列表「会话」分段，**When** 查看顶栏，**Then** 标题为 **项目名称**（非「会话」）。
2. **Given** 无当前项目，**When** 会话列表态，**Then** 顶栏回退 **「会话」**。
3. **Given** 会话列表页，**Then** **不显示**「当前项目 xxx」banner 行。
4. **Given** 「项目工作区」分段，**Then** 顶栏仍为 **「项目工作区」**。
5. **Given** 对话中，**Then** 顶栏仍为 **会话标题**。
6. **Given** 顶栏 ☰，**Then** 仍可打开项目抽屉切换项目；切换/重命名后顶栏项目名同步更新。

## 测试用例

- 单测：`app-header.test.tsx` 覆盖列表/无项目/工作区/对话四态标题
- 手工：切换项目、重命名项目、无项目空态
