---
date: 2026-07-03
agile_trace: true
---

# mobile-toast-top 实现规格（SPEC）

## 根因 / 方案摘要

Mobile Toast 使用 `bottom: insets.bottom + 16`；Desktop 使用 `top: titlebar-height + 10px`。本变更将 Mobile 改为顶部定位，语义对齐 Desktop。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `AppHeader.tsx` | 导出 `APP_HEADER_CONTENT_HEIGHT = 58`（48 minHeight + 10 paddingBottom） |
| `ToastHost.tsx` | `top: insets.top + APP_HEADER_CONTENT_HEIGHT + 10`；移除 `bottom`；`zIndex: 999` |

## 详细改动说明

### offset 公式

```
top = insets.top + APP_HEADER_CONTENT_HEIGHT + 10
    = safe area + 顶栏内容区 58px + 与 Desktop 一致的 10px 间距
```

### 不变项

- `testID="toast-message"`（E2E 兼容）
- 显示时长：2500ms / 带 action 8000ms
- Context API：`showToast(message, options?)`

## 测试策略

### 测试用例

- 无 ToastHost 组件单测（既有 mock 不变）
- E2E 只验 `waitForDisplayed` + 文案，placement 变更 **不应破坏**

```bash
npm run build
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| Toast 与 AppHeader 重叠 | 使用 HEADER 高度 + 10px offset；zIndex 999 |
| AppHeader 高度变更未同步 | 共享常量 `APP_HEADER_CONTENT_HEIGHT` |

**回滚**：`git revert ea6ec519`
