# 调研：模型远程拉取列表加输入过滤（PRD/spec 落盘）

date: 2026-08-21

用户提"无关优化"：服务商配置的模型远程拉取下拉框加输入框过滤。两个探索子代理结论：UI 实为弹窗/BottomSheet 勾选列表（desktop FetchModelsModal.tsx 211 行、mobile FetchModelsSheet.tsx），打开即自动拉取；过滤纯前端内存操作，每端单文件改动；mobile 最佳模板 ToolPolicyPicker（sheet 内 FormTextInput + query + useMemo 双字段 includes），desktop 参照 ChatHistorySearchPanel。要点：双字段匹配（displayName+vendorModelId）、过滤只作用展示（勾选/已添加/计数保留）、打开重置、空结果提示区分。PRD+spec 已落盘 docs/Iterations/fetch-models-filter/，待确认后实现。

## impl-desktop：FetchModelsModal 过滤输入框（Step 1 + T-FM5-7）

date: 2026-08-21

同分支 feat/pms-integration 上实施 Step 1：`FetchModelsModal.tsx` 加 `query` state（open effect 里随 `setRows([])` 一起重置）+ `filteredRows` useMemo（小写 includes 双字段，displayName trim 后为空只按 vendorModelId）；列表改用 filteredRows，空结果分支文案「无匹配模型」（与「未拉取到可用模型」区分）；`selectedIds`/is-saved 禁用态/saving/「已选 N 项」全部按全量 rows 计，过滤只影响展示。`shell.css` 在 `.fetch-models-modal__list` 后新增 `__filter`（含 placeholder 与 focus 态，对齐 `.settings-toolbar__input` 风格）。

测试新建 `apps/desktop/test/fetch-models-modal.test.tsx`：照 `chat-search-race-guard.test.tsx` 范式（react-alias-hook + 动态导入统一根 react 副本 + react-test-renderer 真渲），mock 拦在 `window.novelMasterDesktop.invoke`，按 channel 路由（`nm:providerModels/fetch|suggestList|save`）。T-FM5/6/7 全绿，typecheck 通过。受控 input 用普通对象 `{target:{value}}` 触发 onChange，行定位用 row-title 文案。
