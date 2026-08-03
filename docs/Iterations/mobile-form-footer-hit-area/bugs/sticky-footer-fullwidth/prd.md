---
date: 2026-07-26
dependency: Iterations/mobile-form-footer-hit-area/prd.md
---

# sticky-footer-fullwidth Bug PRD

## 背景

Mobile 表单底部 `StickyFormFooter` 主 CTA 视觉上像整条可点底栏，实际可点热区只覆盖文字（如「创建」）附近的紧凑区域，导致「添加服务商」等页面出现「点了没反应」的体验问题。父级迭代见 `Iterations/mobile-form-footer-hit-area/prd.md`。

## 现象描述

底部主色操作条很长，但只有点到按钮文案附近才触发 `onPress`；点主色块左右空白无响应。

## 复现步骤

1. 打开「我的 → 添加服务商」
2. 填入合法 ID、Base URL、API Key（按钮可点）
3. 点击底部主色按钮的左侧或右侧空白（避开「创建」文字中心）

## 预期行为

主色可视区域内任意位置均可触发创建/保存（未 disabled 时）。

## 实际行为（修复前）

仅文字附近响应；左右空白无反应。

## 影响范围

所有使用 `StickyFormFooter` 的表单主按钮：服务商创建/编辑、Agent 编辑、云同步、事件、压缩条件、模型采样、正则规则编辑。

## 验收标准

- 可保存状态下，点主色按钮左右空白与点文字中心效果一致
- disabled / loading 时整颗仍不可点
- 不恢复全局大按钮 `minHeight: 44` 视觉

## 回归测试要点

- 添加服务商：左右空白可创建
- 任一其它 StickyFormFooter 页（如 Agent「保存」）抽测
- 必填未齐时 disabled 行为不变
