---
date: 2026-07-03
dependency: Iterations/mobile-message-edit-multiline/prd.md
---

# message-edit-flex-center Feature PRD

## 背景与变更动机

Mobile 消息编辑弹窗此前采用 `justifyContent: 'flex-end'` 贴底布局，是为解决键盘遮挡保存/取消按钮的 Tier 1 方案。贴底在真机上键盘安全，但视觉不符合「居中对话框」的常见习惯。

用户在 brainstorm 中确认：希望弹窗默认 **相对居中**，同时仍配合 Android `adjustResize` 在键盘弹出时将 panel 留在键盘上方。

## 范围说明（相对原需求）

| 项 | 原 SPEC（Tier 1 贴底） | 本变更 |
|----|------------------------|--------|
| 垂直布局 | `flex-end` 贴底 | `flexDirection: 'column'` + 可收缩 top spacer |
| 键盘策略 | adjustResize + iOS KAV | **不变** |
| TextInput 多行/回车 | min/maxHeight、submitBehavior | **不变** |
| TextPromptModal | 不改 | **不改** |

## 影响模块与接口

- `apps/mobile/src/components/chat/MessageEditModal.tsx`（布局）
- `apps/mobile/__tests__/message-edit-modal.test.tsx`（T6 布局断言）
- `ChatConversationPanel` props 链：**无变更**

## 验收标准

- [ ] 键盘未弹出时，编辑弹窗视觉上 **高于屏幕底边**（top spacer 吸收多余空间），接近居中对话框
- [ ] 键盘弹出后，「取消」「保存」 **可见且可点**（PRD B3 回归）
- [ ] 回车换行、多行高度、保存语义与改前一致（B1–B4、A1–A3）
- [ ] Android 真机 + 可选 iOS 验证

## 测试用例

- 单测 T1–T6 通过（含 top spacer testID 与 column 布局）
- 真机：打开含 8 行消息编辑 → 聚焦 → 键盘弹出 → 点保存/取消
