# import-dir-rule-default-on 迭代 review-import 评审（diff 单轮深审）

- 日期：2026-08-30；评审对象 worktree `.woktree/import-dir-rule`（readonly），分支 `feat/import-dir-rule-default-on`，diff `6c8a872..88f088c`（6 commit，9 文件，+658/-54）。
- 模式：diff 独立分支单轮深审，维度 B–K 全维（含 C-orch）+ A 对照 spec 变更点/Step 矩阵/测试矩阵 T-I1~T-I7。skill `code-review-loop` 在环境中不存在，按 prompt 内嵌流程执行。

## 结论与发现

- 结论：需产出 fix-spec（P0=0，P1×1，P2×3，open deviation×1）。
- MF-1（P1，B/H）：`ensureImportDirRules` 对 `prefix === "/"` 整体短路 return，而 CLI `import-zip`/`import-character-card` 的 `--path` 缺省即 `/`、desktop `resolveDirectoryPath` 缺省也是 `/`、mobile 根视图导入传 currentPath=root——导入到根时全部目录不补规则行，PRD 原始 bug 在该场景原样保留。spec 决策 7「/ 不补」的既有约定（ensureDirRulesForNewPath）指的是根自身不产生规则行，内核 `backfillMissingDirRules` 已正确跳过 "/" 候选，外层短路属误读扩大。改法：删外层短路，补「导入到根」用例。
- MF-2（P2，C）：`scope as unknown as WorkplaceScope` 双重断言多余——`workplace-types.ts` 里 `WorkplaceScope = VfsScope` 纯类型别名，直接传参即可，断言与 `WorkplaceScope` import 一并删。
- MF-3（P2，B）：补行循环中途失败即止（整体 try/catch 在 ensureImportDirRules 层），弱于旧 mobile per-directory catch 口径；PRD 需求 4「单个目录写入失败不阻断整体导入流程（沿用现有容错口径）」的"现有口径"来自旧 UI 逐目录 catch。改法：writeDefaultRule 回调内逐目录 try/catch + warn。
- MF-4（P2，G）：ZIP 侧 testHook `createWorkplaceRepo` 已加但零测试使用（T-I5 只测角色卡）。改法：vfs-zip-io.test.ts 补同构故障注入用例。
- open_questions：等价性/键空间集成测试仅覆盖 session scope（global/project 未覆盖）；T-I5 仅覆盖首目录失败，未覆盖中途失败的部分提交场景；helper 绕过 `assertLogicalPathAllowed`（cr-func 既有观察，输入来自 DB 查询结果与已断言的 directoryPath，实际风险低）。
- C-orch 核对：mobile UI 补行删干净（`defaultDirRuleForm` 仅剩新建目录弹窗 line 932 引用，spec 明确保留）；vfs-tools 复用内核形状 OK（纯内核+写入载体注入，BuiltinToolContext 依赖形状不变）；domain→service import 在项目里有 10+ 先例，不视为新违规。
- A 对照：spec 变更点清单 6/6 落实（含可选 Step 5）；T-I1~T-I7 全部有对应用例（T-I7 由 vfs-tools.test.ts 既有用例守卫）。
- 验证：core 全量 `npm test` fail 0（约 18s）。

## Round 2 — fix-spec 校验（review-full-import，readonly）

- 日期：2026-08-30。对象：`docs/Iterations/import-dir-rule-default-on/cr-fix-spec.md`（工作区未提交）。结论：fix-spec-ready: yes（附 1 条建议补充）。
- 覆盖核对：MF-1~MF-4 全部写入，均含文件+改法+验收，可执行。
- 代码抽查：MF-1 成立——内核 `backfillMissingDirRules` 候选循环 `logicalPath === "/"` continue；`listDirectoryPathsUnderPrefix` 前缀 "/" 时 `path='/' OR LIKE '/%'` 且筛 directory，根下目录全集查得到；CLI import-zip 与 desktop `resolveDirectoryPath` 缺省均 "/"（vfs-zip.service.ts:46-51）。MF-3 成立——回调内逐目录 try/catch 不触内核，vfs-tools 侧（vfs-tools.ts:628 走 setDirRule 回调）行为不变。
- spec_deviations：决策 7 误读扩大化对应 MF-1、「open → 待修复后 fixed」表述正确（本 wave 只改文档）。
- 新发现（建议级）：MF-1 漏列 `ensure-import-dir-rules.test.ts:71` 既有用例「T-I6: 根路径 / 跳过——零查询零写入」的同步改写——删短路后该用例必红（stub directories ["/a"] 会被补行），应补进文件清单并改写为「根导入：子目录补行、根自身无行」。
