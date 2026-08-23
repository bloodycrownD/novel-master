---
date: 2026-08-23
title: 桌面端服务商管理删模型/拉取模型弹窗加全选
keywords: ManageHeader, ProviderDetailView, FetchModelsModal, FetchModelsSheet, useBatchSelection, selectRange, 全选, 批量删除
abstract: desktop/mobile 双端服务商管理全选：删模型（ManageHeader 可选 onSelectAll/allSelected props）与拉取模型（desktop 弹窗、mobile Sheet 勾选+批量添加），含各自测试要点。
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

user（同日第二轮）：
mobile 端同主题：删模型接入全选 + FetchModelsSheet 从「点行即存」改勾选批量添加，仍在 feat/model-select-all 分支，只改 worktree 文件。

assistant（mobile 端，提交 8230a98 / 0d0d432）：
- mobile ManageHeader（components/batch/ManageHeader.tsx）同样加可选 onSelectAll/allSelected，批量行中段包 batchCenter（全选按钮 + 已选 N 项）保持 space-between 三段布局；ProviderDetailScreen 删模型：`allSelected = rows.length > 0 && selectedCount === rows.length`，onSelectAll 走 selectRange(全选 ? [] : rows.map(savedModelId))。
- FetchModelsSheet 改造：引入 useBatchSelection，点行 toggle，行左 BatchCheckbox（已添加行等宽 View 占位 + 右侧「已添加」，saved/saving 时禁用）；过滤框下方 selectBar（全选/全不选 + 已选 N 项，无可选行时隐藏，与 desktop 计数段一致）；底部 actionRow（完成 + 主色「添加 (N)」，saving 时「添加中…」）。saveSelected 逐个 save，任一失败 break。
- 关键决策：保存失败拆独立 saveError（底部一条红字，不替换列表），不复用 load 的 error（那会整页换成错误+重试，已添加标记和保留勾选都看不见）；部分失败时勾选清到只剩未保存行（selectRange(selected - savedNow)）方便重试，全部成功即全清。
- 测试：fetch-models-sheet 改 T-FM3（点行不再即存）+ 新增 T-FM5-7；新建 manage-header-select-all.test.tsx；provider-detail-tabs 加源码断言。坑：模糊找按钮时外层 backdrop Pressable 的副标题「勾选后批量添加」也含「添加」会误中，需精确匹配 helper（collectText === 目标）；mock useRuntime 必须返回固定引用 runtime 否则 effect 无限重跑（既有注释已有）。
- worktree 环境：根 node_modules 软链主仓（symlink 不命中 .gitignore 的 node_modules/ 目录模式，提交要显式 pathspec）；packages/core 需先 npm run build 出 dist，否则 core-shim 解析失败；全量 jest 有 23 个 suite 环境性失败（stash 基线验证过与改动无关）。
