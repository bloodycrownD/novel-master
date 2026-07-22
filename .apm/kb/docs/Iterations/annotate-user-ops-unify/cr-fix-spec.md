# CR Fix Spec: annotate-user-ops-unify（xn + chip-recontract）

## 元信息
- repo: `d:\Dev\Js\novel-master`
- base_sha: `4569d0b5`
- head_sha: `cfd2cf66`
- prd_path:
  - `.apm/kb/docs/Iterations/annotate-user-ops-unify/features/annotate-cross-node-highlight/prd.md`
  - `.apm/kb/docs/Iterations/annotate-user-ops-unify/features/composer-chip-ops-annotate-recontract/prd.md`
- spec_path:
  - `.apm/kb/docs/Iterations/annotate-user-ops-unify/features/annotate-cross-node-highlight/spec.md`
  - `.apm/kb/docs/Iterations/annotate-user-ops-unify/features/composer-chip-ops-annotate-recontract/spec.md`
- review_round: 1
- dag_version: 2
- 状态：fix-spec-ready

## Must-fix（按 P0 → P1 → P2）

### review-scope-xn/B-1 [P0] collectUnmarkedTextDomains 遇 mark 须 flush
- 维度：B / C-orch
- 文件：
  - `apps/mobile/src/web/rich-document/webview/runtime/annotate-marks.ts`（`collectUnmarkedTextDomains`）
  - `apps/desktop/renderer/layout/preview-annotate.ts`（同名 helper）
  - `apps/mobile/__tests__/annotate-marks.test.ts`
  - `apps/desktop/test/preview-annotate.test.ts`
- 问题：`collectUnmarkedTextDomains` 遇已有 annotate-mark 整块 `return` 却不 `flush()`，mark 两侧 Text 被拼进同一 haystack；短针可跨已有 mark 误命中（与扁平匹配域切断合同冲突）。
- 改法：mark 分支改为先 `flush()` 再 `return`；Mobile / Desktop 双端同改，行为对齐。
- 验收/测试：补回归测——先长后短、跨已有 mark 的短针**不得**误命中；既有 T-XN2 / T-XN3 / T-XN6 不回归。
- 来源：review-scope-xn / round 1

### review-scope-chip/C-orch-1 [P1] prepare 路径拆除 workplaceAttachments 旁路
- 维度：C-orch
- 文件：
  - `packages/core/src/service/agent/logic/prepare-user-vfs-turn-for-agent-run.ts`
  - 全仓对该入参的传入点（含 `run-agent-turn` / 测试夹具等）
  - 相关文件头/链式注释
- 问题：`prepareUserVfsTurnForAgentRun` 仍保留 `workplaceAttachments` 入参并参与 re-append merge，与 chip-recontract「发送不再 materialize workplace」合同冲突；旁路未拆净。
- 改法：删除 `workplaceAttachments` 入参与 merge；全仓去掉传入；注释改写为与 D3（无 workplace materialize）一致。
- 验收/测试：全仓无 `workplaceAttachments` 传入 prepare；相关单测绿；与 `review-scope-chip/G-1` 联调。
- 来源：review-scope-chip / round 1

### review-scope-chip/G-1 [P1] T-SR8 断言 merge 不含 workplace
- 维度：G
- 文件：`packages/core/test/service/agent/run-agent-turn.test.ts`（T-SR8）
- 问题：T-SR8 仍断言 re-append merge **含** materialize workplace，与本轮合同相反。
- 改法：改写断言——merge **不含** `source:workplace` / workplace materialize；仍断言 flush/attach/trailing 不丢。
- 验收/测试：T-SR8 绿；与 C-orch-1 实现同步合入后通过。
- 来源：review-scope-chip / round 1

### review-scope-chip/C-1 [P2] Mobile suggest 函数名对齐语义
- 维度：C
- 文件：
  - `apps/mobile/src/services/workplace-rule-delta-draft.service.ts`
  - `apps/mobile/src/components/vfs/VfsFileManager.tsx`（调用方）
- 问题：`suggestWorkplaceAttachmentsToComposerDraft` 实际仅 `refreshRuleSnapshot`，名称仍暗示 workplace 差集 suggest，易误导维护。
- 改法：重命名为 `refreshRuleSnapshotAfterRuleChange`（或等价清晰名）；更新全部调用方；可删过渡旧名或短暂 re-export 后移除。
- 验收/测试：Mobile 规则保存路径仍刷新快照并清 `file_cache`；无旧名残留引用。
- 来源：review-scope-chip / round 1

### review-scope-chip/C-2 [P2] workplaceAttachmentsFromRuleDelta 退役
- 维度：C
- 文件：
  - `packages/core/src/domain/workplace/logic/diff-workplace-paths.ts`
  - `packages/core/src/public/workplace.ts`
  - `packages/core/test/workplace/diff-workplace-paths.test.ts`
- 问题：`workplaceAttachmentsFromRuleDelta` 生产路径已不再需要，仍导出并被测侧当作生产差集 helper，与「去掉 workplace 半边」合同不符。
- 改法：删除未用导出，或标 `@deprecated` 后尽快删除；测侧停用生产差集 helper（改测保留的纯函数语义，或删对应用例）。同删/退役 `workplaceAttachmentsFromNeededPaths`（若仅被 FromRuleDelta 调用）。
- 验收/测试：`diff-workplace-paths` / public 导出无死 workplace 差集 API（或仅 deprecated 且无新调用）；相关测绿。
- 来源：review-scope-chip / round 1

### review-scope-chip/G-2 [P2] compaction-handler 断言清 rule_snapshot
- 维度：G
- 文件：`apps/desktop/test/compaction-handler.test.ts`
- 问题：T-CR5 压缩用例仅断言清 `file_cache`、保留 pending，未断言同步清 `rule_snapshot`，与置位/压缩同口径合同覆盖不足。
- 改法：用例预置 `rule_snapshot`（如 `canon`），压缩成功后断言 `rule_snapshot` 已清且 pending 仍保留；manual / condition 两条路径同口径。
- 验收/测试：`compaction-handler.test.ts` 绿；与置位 `messages-set-floor` / Core 清域行为一致。
- 来源：review-scope-chip / round 1

## Spec deviations

| ID | 描述 | 状态 |
|----|------|------|
| SD-workplace-prepare-bypass | `prepare-user-vfs-turn-for-agent-run` 仍保留 `workplaceAttachments` 入参与 merge（旁路未拆净），偏离 chip-recontract D3 | **fixed**（`review-scope-chip/C-orch-1` + `G-1`） |

## Open questions / 待拍板

| 域 | 问题 |
|----|------|
| chip / D7 | **手动重置常驻**：KKV 清域与状态条钩子仍待产品拍板（本轮不闭合；见 composer-chip-ops-annotate-recontract spec D7） |
| xn | **CUT_BOUNDARY** 抽 Core：可选后续收敛（双端壳现各持一份 tag 集合）；非本轮 must-fix |

## 已豁免（用户确认不修）

（本轮无新增豁免条目）

## 合并后 QA（manual_user）

- **T-XN7**：真机 / 桌面跨节点点选打开批注（标题加粗、表格嵌套、跨链接短语、相邻段落不误标）
- **T-CR9**：双端手工验收清单（规则立刻快照、状态 chip 仅手改+批注、置位/压缩不清手改/批注、Undo 批注恢复等）

## K 节建议（下游执行时闭合）

- 先合 P0（B-1 flush），再合 P1（C-orch-1 + G-1），最后 P2 命名/退役/测补。
- 合并前跑相关单测：annotate 壳层、`run-agent-turn` T-SR8、`diff-workplace-paths`、`compaction-handler`。
- 实现闭合后将 Spec deviations `SD-workplace-prepare-bypass` 标为 **fixed**。

## Fix-Spec Closure

| 项 | 状态 |
|----|------|
| fix-spec-ready | yes |
| fix_spec_path | `.apm/kb/docs/Iterations/annotate-user-ops-unify/cr-fix-spec.md` |
| dag_version / review_round | 2 / 1 |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 2 / 3 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | fixed: `SD-workplace-prepare-bypass` |
| C-orch | ✅ |
| C 类合并后 QA | T-XN7 / T-CR9（见上「合并后 QA」；不阻塞 fix-spec-ready） |
