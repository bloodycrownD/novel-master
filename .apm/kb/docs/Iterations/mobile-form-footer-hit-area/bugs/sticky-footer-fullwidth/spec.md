---
date: 2026-07-26
agile_trace: true
---

# sticky-footer-fullwidth 实现规格（SPEC）

## 根因 / 方案摘要

`StickyFormFooter` 外层 `View` 为全宽 surface 底栏，内层 `PrimaryButton` 未传 `fullWidth`，Pressable 按文案 + 紧凑 padding 收缩，热区远小于视觉底栏。

另：Android 上若 Pressable 使用 `alignItems: 'center'`，即使背景已满宽，命中区仍可能收成文字大小。故在 `PrototypeButtons` 去掉该样式，并对文案设 `pointerEvents="none"`。

方案：

1. `StickyFormFooter` 给 `PrimaryButton` 传 `fullWidth`（`alignSelf: 'stretch'` + `width: '100%'`）。
2. `PrototypeButtons` 修复 Android 命中区根因（见变更点清单例外）。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/components/form/StickyFormFooter.tsx` | `PrimaryButton` 增加 `fullWidth`；**不**内联平行 Pressable CTA |
| `apps/mobile/src/components/ui/PrototypeButtons.tsx` | **例外（Android 根因）**：去掉会收缩热区的 `alignItems: 'center'`；`Text` 加 `pointerEvents="none"`；`fullWidth` 补 `width: '100%'` 与 label 满宽居中 |

提交：`f34aa521` — `fix(mobile): StickyFormFooter 主按钮拉满宽以对齐命中区`  
后续：CR A-1 收敛回 `PrimaryButton fullWidth` + 保留 PrototypeButtons 修复。

## 详细改动说明

- footer 仅一处主 CTA 实现：`PrimaryButton` + `fullWidth`（禁止与 PrimaryButton 双轨维护内联样式）
- `PrototypeButtons` 修改仅服务于 Android 命中区正确性，并惠及其它 `fullWidth` 消费方（如 CloudSync）
- 不恢复 `minHeight: 44`，不加全局 `hitSlop`
- 不改各调用方；一处 footer 修复覆盖全部 StickyFormFooter 消费方
- `disabled` / `loading` 仍挂在同一 `PrimaryButton`，满宽后整条不可点语义保留

## 测试策略

### 测试用例

| 用例 | 方式 | 结果备注 |
|------|------|----------|
| 类型/组件静态正确性 | 代码 diff 复核 `fullWidth` 已传入、无内联 Pressable CTA | 通过 |
| `agent-editor-form-delete-confirm` | `npm test -w @novel-master/mobile -- agent-editor-form-delete-confirm` | 回归 |
| 真机命中区 | Android 点添加服务商主按钮左右空白 | 需人工验收 |

## 风险与回滚方案

- **视觉变化**：footer 主 CTA 由居中小块变为内容区满宽条，与父级 PRD 目标一致
- **回滚**：去掉 `StickyFormFooter` 的 `fullWidth`；必要时再评估 PrototypeButtons 热区修复是否单独回滚
