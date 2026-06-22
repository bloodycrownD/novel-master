---
date: 2026-06-22
---

# session-actions-menu-no-open Bug 修复规格（SPEC）

> **Bug PRD**：[prd.md](./prd.md)  
> **修复提交**：`573ef0f3` @ `feature/desktop-ux-bug-fixes`

## 根因分析

两处 **document 级 click 监听** 在同一事件上冲突：

| 监听位置 | 行为 | 注册顺序 |
|----------|------|----------|
| `ConversationPanel` | 命中 `[data-action='open-session-actions']` → `onOpenSessionActions(btn)` | 子组件 effect **先** 注册 |
| `App.tsx` DesktopOverlays | 任意 document click → `closeMenus()` → `setSessionMenu(null)` | 父组件 effect **后** 注册 |

同一 click 冒泡到 document 时：**先 open、后 close**。React 批处理下 `setSessionMenu(null)` 覆盖 `setSessionMenu({...})`，菜单永不显示。

## 修复方案

1. **ChatComposer**：按钮直接 `onClick`，`stopPropagation` + 调用 `onOpenSessionActions(currentTarget)`
2. **ConversationPanel**：删除 document 委托；向 `ChatComposer` 传入 `onOpenSessionActions`
3. **App.tsx**：document click 关闭菜单时，若 target 在 `[data-action='open-session-actions']` 或 `#session-actions-menu` 内则 **跳过** `closeMenus`

## 变更点清单

| 文件 | 变更 |
|------|------|
| `ChatComposer.tsx` | 新增 prop + 按钮 onClick |
| `ConversationPanel.tsx` | 移除 useEffect 委托；传 prop |
| `App.tsx` | closeMenus 守卫条件 |

## 测试策略

### 自动化

- `npm run build:renderer` — 须通过

### 测试用例

| ID | 操作 | 预期 |
|----|------|------|
| T1 | 点击 ⋯ | 菜单弹出 |
| T2 | 点击菜单外 | 菜单关闭 |
| T3 | 点击菜单项 | 执行对应操作并关闭 |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 低 | 局部事件处理 |
| 回滚 | revert `573ef0f3` |
