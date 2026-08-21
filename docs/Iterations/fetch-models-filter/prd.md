---
date: 2026-08-21
dependency: []
---

# 模型远程拉取列表输入过滤 PRD

## 背景

服务商详情页的「拉取模型」功能（desktop `FetchModelsModal` / mobile `FetchModelsSheet`）打开后展示远程拉取的模型勾选列表，长列表（如 OpenRouter 上百条）里找目标模型只能肉眼扫。用户希望加输入框过滤能力。

探索确认：该 UI 是弹窗/BottomSheet 勾选列表（非下拉框）；拉取链路与数据结构不动，过滤为纯前端内存操作；两端各有现成过滤先例（desktop `ChatHistorySearchPanel` 的边输边滤、mobile `ToolPolicyPicker` 的 sheet 内 `FormTextInput` + 双字段 `includes`）。

## 目标（含成功指标）

- 拉取列表顶部出现过滤输入框，输入即时过滤列表（不区分大小写）
- 过滤同时匹配 `displayName` 与 `vendorModelId`（显示名回退 id 的既有语义下，搜 id 也必须命中）
- 成功指标：上百条模型的列表中输入几个字符即定位目标；过滤空结果有明确提示；勾选/已添加/保存中状态不因过滤丢失

## 范围

### 包含范围

- desktop `FetchModelsModal.tsx`：列表上方加过滤输入框（样式入 `shell.css` 的 `.fetch-models-modal__*` 体系）
- mobile `FetchModelsSheet.tsx`：FlatList 上方加 `FormTextInput`（照 `ToolPolicyPicker` L53/L68-78 样板）

### 不包含范围

- 拉取链路、IPC、core、adapter（零改动——过滤纯内存）
- `ModelPickerModal`（已保存模型选择器，另一个人群，不在本次）
- 服务商表单本体

## 核心需求

1. **即时过滤**：输入即时生效（`useMemo` 小写 `includes`，照 `ToolPolicyPicker` 先例），无需提交
2. **双字段匹配**：同时匹配 `displayName`（trim）与 `vendorModelId`；displayName 为空的行只按 id 匹配
3. **状态共存**：过滤只作用于展示——已勾选（含被过滤隐藏的）、已添加禁用态（is-saved）、保存中 spinner 均不受影响；「已选 N 项」计数按全部勾选计，不随过滤收缩
4. **空结果提示**：过滤后为空时显示「无匹配模型」（区别于未拉取到模型的既有提示）
5. **重置语义**：弹窗/Sheet 每次打开时过滤词重置为空（照 `ToolPolicyPicker` 打开重置先例）；重新拉取（重试）成功后保留当前过滤词
6. **mobile 键盘适配**：Sheet 内输入框注意键盘遮挡（复用 `useAndroidModalKeyboardAvoid` 先例）；过滤后列表变短时 FlatList 滚动位置复位

## 验收标准

- Given 已拉取的模型列表 When 在过滤框输入关键字 Then 列表即时收窄至 displayName 或 id 含关键字（不区分大小写）的行
- Given 过滤后列表为空 Then 显示「无匹配模型」提示，清空过滤词即恢复
- Given 过滤前已勾选若干行 When 过滤将其隐藏再清空 Then 勾选态保留，计数不丢
- Given 已添加（is-saved）行 When 过滤 Then 同样参与过滤（匹配则显示，不匹配则隐藏）
- Given 关闭弹窗再打开 When 查看 Then 过滤词为空、列表全量

## 风险

- 极小。纯前端展示层改动，回滚即还原单文件；不触碰拉取/保存链路
