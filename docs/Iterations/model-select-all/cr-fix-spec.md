# CR Fix Spec: model-select-all（服务商管理删模型/拉取模型全选）

## 元信息
- repo: novel-master（worktree .woktree/model-select-all，分支 feat/model-select-all）
- base_sha: 1f84dcd（origin/main）
- head_sha: 3f48852
- prd_path / spec_path: 未提供（口头需求：服务商管理删模型/加模型加全选）
- review_round: 1 / dag_version: 1
- 状态：fix-spec-ready（round 1 产出于 r1；修复已全部执行闭合，见各条「修复记录」）

## Must-fix（按 P0 → P1 → P2）

### MSA/B-1 [P2] mobile「已选 N 项」隐藏条件与 desktop 不一致，过滤后无可选行时计数凭空消失
- 维度：B（正确性）/ H（双端一致性）
- 文件：`apps/mobile/src/components/provider/FetchModelsSheet.tsx`（selectableRows 计算与 selectBar 渲染处）
- 问题：mobile 的 `selectableRows` 基于 `filteredRows`，过滤后无可选行时整个 selectBar（全选按钮 + 计数）一起隐藏；desktop 计数基于未过滤 `selectableRows`，同场景计数仍显示。场景：过滤勾选 2 行 → 改过滤词只命中已添加行 → 计数条消失，但底部仍「添加 (2)」，用户看不到选了几项、也无法点全不选清掉隐藏勾选。
- 改法：「已选 N 项」渲染条件改为基于**未过滤**可选行（照 desktop `FetchModelsModal.tsx:101,245` 对齐）；全选按钮可维持「无可选行就隐藏/禁用」现状。
- 验收/测试：mobile jest 补用例——过滤勾选后切过滤词至无可选行，计数仍显示、添加按钮计数不变；全不选可清空。
- 修复记录：已修（同轮）——计数条渲染条件改基于未过滤可选行 `allSelectableCount`，全选按钮维持无可选行隐藏；补 T-FM5c 用例，mobile 9/9 绿。
- 来源：review round 1（diff 模式）

### MSA/G-1 [P2] desktop 删模型全选零测试覆盖；mobile 缺「全选重置清旧勾选」断言
- 维度：G（测试）
- 文件：`apps/desktop/renderer/features/settings/SettingsViews.tsx`（ProviderDetailView 全选逻辑）；`apps/mobile/__tests__/fetch-models-sheet.test.tsx`
- 问题：desktop `allModelsSelected` + `selectRange` 无任何测试，ManageHeader 新 props 也无组件测试（mobile 有 manage-header-select-all.test.tsx，desktop 无对应物）；mobile T-FM5 只验证「过滤后全选只勾中命中行」，未断言「被过滤隐藏的旧勾选会被重置清掉」（desktop T-FM11 有）。
- 改法：desktop 照 mobile `provider-detail-tabs.test.ts` 源码断言风格补全选接线断言（或直测）；mobile 补一条用例：先勾 claude 行 → 过滤 gpt 全选 → 断言 claude 勾选被清。
- 验收/测试：双端新增用例全绿；既有 fetch-models / provider-detail 系测试零回归。
- 修复记录：已修（同轮）——desktop 补 T-SA1 源码断言（provider-detail-tabs.test.ts）；mobile 补 T-FM5b 重置语义用例。desktop 12/12、mobile 21/21 绿。
- 来源：review round 1

### MSA/C-1 [P2] 记忆文件内容与实际有出入
- 维度：K（文档同步）
- 文件：`docs/apm/memory/20260823-model-select-all.md`（L13、L17）
- 问题：① L13 称 desktop ManageHeader 调用方为「AgentsSettingsView/ProvidersView/ChatRail」，遗漏 `SkillsManageView.tsx`（均零影响，但列举不全）；② L17 在 desktop 段落把 mobile 的 `provider-detail-tabs` 测试与 desktop 的 `settings-agents-delete-confirm` 并列，归属混乱。
- 改法：补全调用方清单；把 L17 测试结果按端归属拆开描述。
- 验收/测试：人工核对两处描述与代码/测试文件一致。
- 修复记录：已修（同轮）——补全 SkillsManageView 调用方；测试结果按端归属拆开描述。
- 来源：review round 1

## Spec deviations
- none（口头需求双端落地；mobile 拉取模型勾选化为已获认可的交互升级；全选「重置」语义双端一致）

## Open questions / 待拍板
1. ~~desktop 弹窗批量保存部分失败语义是否向 mobile 看齐~~ ——用户授权「按想法来」，已顺带对齐：失败即停、已成功行标「已添加」（addedIds 并入 savedSet）、重试跳过已保存行不重复 save（与 mobile 同语义）。
2. mobile 保存中所有已勾选未保存行同时转圈（含未轮到的），desktop 无此指示——保留（轻量反馈，无正确性影响）。
3. `provider-detail-tabs.test.ts` 源码正则断言风格——保留（符合该文件既有风格）。

## 已豁免（用户确认不修）
- （无）

## 合并后 QA（manual_user）
- 真机验证：服务商详情批量删模型全选/全不选；拉取模型 sheet 勾选手感、过滤后全选、部分失败重试。

## K 节建议（下游执行时闭合）
- 无 lint/format/调试残留（review 已确认干净）。

## Fix-Spec Closure

| 项 | 状态 |
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/model-select-all/cr-fix-spec.md |
| dag_version / review_round | 1 / 1 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 3 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（双端 parity 已查，仅 B-1 一处不一致已入列） |
| C 类合并后 QA | 真机走查（见上） |
