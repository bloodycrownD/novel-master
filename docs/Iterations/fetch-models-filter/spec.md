---
date: 2026-08-21
---

# 模型远程拉取列表输入过滤 技术规格（SPEC）

## 设计目标

desktop `FetchModelsModal` 与 mobile `FetchModelsSheet` 的模型勾选列表顶部加过滤输入框，纯前端即时过滤。需求来源：`docs/Iterations/fetch-models-filter/prd.md`。

## 设计决策

- **D1（纯前端过滤，双字段 includes）**：`useMemo` 对 rows 做小写 `includes`，匹配 `displayName?.trim()` 与 `vendorModelId` 双字段（照 `ToolPolicyPicker.tsx` L68-78 样板）。过滤词不进 IPC、不进 core。
- **D2（过滤只作用展示层）**：`selectedIds`/`addedIds`/`savingId` 状态原样保留——被过滤隐藏的勾选行仍计入「已选 N 项」；确认提交按全部勾选，不受当前过滤影响。is-saved 行同样参与过滤。
- **D3（重置时机）**：弹窗 `open`/`visible` 翻 true 时重置过滤词（与既有"打开即清 addedIds"的 effect 同处）；重试重拉成功不重置。
- **D4（desktop 形态）**：`FetchModelsModal.tsx` 列表区上方加 `<input>`（受控 + placeholder「过滤模型…」），样式加进 `shell.css` 既有 `.fetch-models-modal__*` 体系；空结果行复用列表区渲染分支，文案「无匹配模型」。
- **D5（mobile 形态）**：`FetchModelsSheet.tsx` FlatList 上方加 `FormTextInput`（照 `ToolPolicyPicker` L115-122 的 searchWrap 样式）；键盘遮挡用 `useAndroidModalKeyboardAvoid` 先例；过滤词变化时 FlatList 滚动复位（`listRef` 或 key 技巧，从简）。

## 最终项目结构

```
apps/desktop/renderer/features/settings/FetchModelsModal.tsx  # 改：query state + 过滤 + 空结果分支
apps/desktop/renderer/styles/shell.css                        # 改：.fetch-models-modal__filter 样式
apps/mobile/src/components/provider/FetchModelsSheet.tsx      # 改：query state + FormTextInput + 过滤 + 滚动复位
apps/mobile/__tests__/fetch-models-sheet.test.tsx             # 新增：T-FM1-4
apps/desktop/test/fetch-models-modal.test.tsx                 # 新增：T-FM5-7
```

不改动：拉取/保存链路（IPC、`provider-model.service`、adapter）、`ProviderForm`、`ModelPickerModal`、`provider-detail-tabs.test.ts`（锁的是 `SettingsViews.tsx`，本次不触碰该文件）。

## 详细实现步骤

- Step 1 — phase-fmf-desktop — blocking: yes — qa: auto：`FetchModelsModal.tsx`——`query` state（open effect 重置）+ `filteredRows` useMemo（D1）+ 列表渲染改用 `filteredRows` + 空结果分支「无匹配模型」；`shell.css` 加 `.fetch-models-modal__filter`（含 placeholder 与 focus 样式，对齐既有 modal 输入风格）。
- Step 2 — phase-fmf-mobile — blocking: yes — qa: auto：`FetchModelsSheet.tsx`——同款 query/过滤（D1/D3）+ `FormTextInput`（D5 searchWrap 样式）+ 键盘适配 + FlatList 滚动复位 + 空结果提示（区分「未拉取到模型」既有文案）。
- Step 3 — phase-fmf-tests — blocking: yes — qa: auto：两测试文件——mobile（T-FM1-4，照 `tool-policy-picker.test.tsx` 的 TestRenderer 直测样式，mock runtime.providerModels）与 desktop（T-FM5-7，renderToStaticMarkup/交互断言）；跑双端既有 provider 系测试确认零回归。

## 测试策略

### 测试用例

- T-FM1 — blocking: yes — 输入即过滤：输入关键字（大小写混合）列表收窄至 displayName/id 含关键字的行（映射 Step 2）
- T-FM2 — blocking: yes — 空结果：过滤无命中显示「无匹配模型」，清空恢复全量（映射 Step 2）
- T-FM3 — blocking: yes — 勾选保留：过滤隐藏已勾选行后清空，勾选态与计数不丢（映射 Step 2）
- T-FM4 — blocking: yes — 重置：关闭再打开 Sheet 过滤词为空（映射 Step 2）
- T-FM5 — blocking: yes — desktop 过滤与空结果分支（同 T-FM1/2）（映射 Step 1）
- T-FM6 — blocking: yes — desktop 勾选保留与计数不随过滤收缩（映射 Step 1）
- T-FM7 — blocking: yes — desktop 打开重置过滤词（映射 Step 1）

## 风险与回滚方案

- 纯展示层单文件改动，回滚 revert 两笔即还原；无数据与协议变更。
- Android 键盘遮挡属 RN 常见坑，`useAndroidModalKeyboardAvoid` 有先例，真机验收（Step 3 qa 含手动冒烟即可，不设 manual_user 专步）。

## 实现注（cr-func 闭合项）

- T-FM8 补齐：desktop is-saved 行参与过滤的用例（PRD 验收第 4 条原缺 desktop 侧映射）——savedVendorIds 含 gpt-4o 时过滤 "gpt" 显示 2 行、过滤 "claude" 隐藏 saved 行。
- 形态小差异（合理）：mobile 在 rows 为空时仍渲染过滤框（ListEmptyComponent 统一两套文案），desktop 不渲染；spec 未规定，不视为偏离。
- 覆盖缺口（非阻塞，实现已核实正确）：savingId spinner 与过滤共存、重试保留过滤词两条无自动化锁定。
- mobile 键盘适配：FetchModelsSheet 照 AddModelModal 先例接 `useAndroidModalKeyboardAvoid(1)` + `Animated.View`（iOS KeyboardAvoidingView padding 分支），spec 原文的"保持简单不加"兜底未启用。
