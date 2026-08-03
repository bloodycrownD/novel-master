---
date: 2026-07-03
agile_trace: true
---

# message-edit-flex-center 实现规格（SPEC）

## 根因 / 方案摘要

**问题**：贴底布局键盘安全但观感偏「bottom sheet」，不符合居中对话框习惯；纯 `justifyContent: 'center'` 在 adjustResize 下易挡按钮（首轮真机失败）。

**方案**：backdrop 改为 column 布局，用 **可收缩 top spacer**（`flex:1, flexShrink:1, minHeight:0`）吸收剩余高度实现「相对居中」；键盘压缩窗口时 spacer 先坍缩，panel 锚在 bottom padding 之上，配合 adjustResize 保留键盘安全。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `MessageEditModal.tsx` | backdrop `flexDirection:'column'`；新增 `topSpacer` View；移除 `justifyContent:'flex-end'` |
| `message-edit-modal.test.tsx` | 新增 T6：断言 `message-edit-top-spacer` 与 column 布局 |

## 详细改动说明

### 布局结构

```
Pressable backdrop (flex:1, column, paddingBottom: 24+insets.bottom)
├─ View topSpacer (flex:1, flexShrink:1, testID message-edit-top-spacer)
└─ Pressable panel (maxHeight 85%, 不变)
```

### 保留不变

- iOS：`KeyboardAvoidingView behavior="padding"`，`keyboardVerticalOffset={24}`
- Android：不包 KAV（避免与 adjustResize 双重收缩）
- `TextInput`：`minHeight:120`，`maxHeight`，`submitBehavior="newline"`，无 ScrollView

## 测试策略

### 测试用例

| ID | 内容 |
|----|------|
| T1–T5 | 既有 multiline/保存/无 ScrollView 断言 |
| T6 | 存在 `message-edit-top-spacer`；backdrop `flexDirection === 'column'` |

```bash
npm test -w @novel-master/mobile -- --testPathPattern="message-edit-modal"
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 部分机型 Modal 不参与 adjustResize，spacer 不坍缩 | 真机矩阵；不达标时评估 Tier 2（statusBarTranslucent）或 Tier 3 |
| iOS KAV + spacer 叠加行为 | iOS 真机验证 B3 |

**回滚**：`git revert e28f98d4`
