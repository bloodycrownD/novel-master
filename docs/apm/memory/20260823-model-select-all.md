---
date: 2026-08-23
title: 桌面端服务商管理删模型/拉取模型弹窗加全选
keywords: ManageHeader, ProviderDetailView, FetchModelsModal, useBatchSelection, selectRange, 全选, 批量删除
abstract: desktop 删模型（ManageHeader 加可选 onSelectAll/allSelected props）与拉取模型弹窗（过滤框旁全选按钮，重置式全选只作用过滤后未保存行）双入口全选能力，含 T-FM9-11 测试要点。
---

user:
desktop 端「服务商管理」的删模型与加模型（拉取模型弹窗）增加全选能力。在 worktree feat/model-select-all 上只改 desktop 文件（mobile 另有子代理同分支并行改）。

assistant:
双入口实现（分支 feat/model-select-all）：
- ManageHeader（components/batch/ManageHeader.tsx）：加可选 props `onSelectAll?/allSelected?`，批量行「已选 N 项」后渲染「全选/全不选」link 按钮，不传 props 时 UI 与原来完全一致（调用方 AgentsSettingsView/ProvidersView/ChatRail 均未动）。
- ProviderDetailView 删模型（SettingsViews.tsx）：`allModelsSelected = models.length > 0 && models.every(m => batch.selectedIds.has(m.id))`，onSelectAll 走 `batch.selectRange(allModelsSelected ? [] : models.map(m => m.id))`（selectRange 本身是重置语义）。
- FetchModelsModal：过滤输入框与全选按钮包进 `fetch-models-modal__filter-bar`（flex 同行，输入框 margin 由容器接管）；`selectableFilteredRows = filteredRows.filter(未保存)`，全选= selectRange 重置为过滤后可选行全选（被过滤掉的旧勾选会被清掉，用户拍板的重置语义），全不选= selectRange([])；saving 或无可选行时禁用；allFilteredSelected 要求 length>0 且全选中。样式在 shell.css 的 fetch-models-modal 段。
- 测试：fetch-models-modal.test.tsx 追加 T-FM9-11（全选/全不选切换、saved 行不参与且过滤后可选行已全选时文案切全不选、重置语义不混入隐藏旧勾选）。坑：全量全选后再过滤到只剩已选行，此时按钮走「全不选」分支会清空而非继续加选，编排用例时要注意；计数段落只要存在可选行就渲染「已选 0 项」，不会消失。
- 验证：typecheck 过；fetch-models-modal 7/7、provider-detail-tabs + settings-agents-delete-confirm 5/5 全绿。worktree apps/desktop 无 node_modules 但根 workspace 有，脚本直接跑通无需 install。
