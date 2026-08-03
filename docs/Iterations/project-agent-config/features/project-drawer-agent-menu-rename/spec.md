---
date: 2026-07-23
agile_trace: true
---

# project-drawer-agent-menu-rename 实现规格（SPEC）

## 根因 / 方案摘要

菜单文案为源码硬编码字符串；无 i18n、无跨端共享常量。将 `ProjectDrawer` BottomSheet 菜单项 `label` 由「智能体配置」改为「智能体」，`action: 'agent-config'` 不变，行为完全由 action 驱动。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/components/chrome/ProjectDrawer.tsx` | `label: '智能体配置'` → `label: '智能体'` |
| `apps/mobile/__tests__/project-drawer-agent-config.test.tsx` | 同步 `it` 用例标题文案（不断言 UI 字符串） |

## 详细改动说明

```ts
// ProjectDrawer BottomSheetMenu items
{label: '智能体', action: 'agent-config'},
```

选中后仍走既有分支：`action === 'agent-config'` → `onOpenAgentConfig?.(project.id)`。

## 测试策略

### 测试用例

- 运行：`npx jest --testPathPattern=project-drawer-agent-config --no-coverage`（`apps/mobile`）
- 断言：`capturedMenuOnSelect('agent-config')` 后 `onOpenAgentConfig` 以项目 id 调用

## 风险与回滚方案

- **风险**：与 Desktop 项目菜单「智能体配置」文案暂不一致；属有意范围裁剪。
- **回滚**：还原上述两处字符串即可。
