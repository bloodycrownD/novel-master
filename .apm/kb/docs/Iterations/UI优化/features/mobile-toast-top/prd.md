---
date: 2026-07-03
dependency: Iterations/UI优化/prd.md
---

# mobile-toast-top Feature PRD

## 背景与变更动机

Mobile 操作反馈 Toast 自引入起固定在屏幕底部（`insets.bottom + 16`），与 Desktop 2026-06-07 已迁移的顶部 Toast 不一致，且易与底部 TabBar / ChatComposer 视觉竞争。用户希望 Mobile Toast 改到 **顶部**，与 Desktop 对齐。

## 范围说明（相对原需求）

- 仅改 `ToastHost` 垂直定位；`useToast()` API 与各 screen 调用 **不变**
- 不涉及 Desktop、不涉及 Alert.alert

## 影响模块与接口

- `apps/mobile/src/components/chrome/ToastHost.tsx`
- `apps/mobile/src/components/chrome/AppHeader.tsx`（导出 `APP_HEADER_CONTENT_HEIGHT` 常量供 offset 计算）

## 验收标准

- [ ] Toast 显示在 AppHeader **下方**（非遮挡标题），距顶栏内容区底边约 10px
- [ ] Chat Tab、Stack 屏、VFS 回滚/重名等场景 Toast 文案可见
- [ ] E2E `~toast-message` 仍可通过（不断言坐标）

## 测试用例

- 手动：保存设置 / VFS 回滚 → Toast 在顶栏下方出现
- E2E（可选）：`chat.rollback*.e2e.ts`、`vfs.rename-conflict.e2e.ts`
