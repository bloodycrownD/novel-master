# CR Fix Spec: vfs-import-export-menu（导入导出菜单收敛）

## 元信息
- repo: D:\Dev\nm-worktree\imex（分支 feat/vfs-import-export-menu）
- base_sha / head_sha: 5cec285f7 / 代码基线 c22d31494（fix-spec 入库后 HEAD ecde01a26 仅多本文档一笔；5cec285f7 是分支点）
- prd_path / spec_path: docs/Iterations/vfs-import-export-menu/{prd,spec}.md
- review_round / dag_version: 4 / 4（CR 三轮）+ fixspec-check 两轮（r1 十二订正 + r2 Go）
- 状态：fixspec-check-ready（round2 审查结论 Go；3 条文字尾巴已闭合）

## Must-fix（按 P0 → P1 → P2）

### core/B-1 [P1] 跨片失败早退时 written 非空却不清理缓存
- 维度：B
- 文件：packages/core/src/service/vfs/impl/vfs-batch-io.service.ts（:395-417 附近）；连带 docs/Iterations/vfs-import-export-menu/spec.md（D1 措辞）
- 问题：applyBatchIngest 的 failedPath 早退在清理调用之前——跨片失败时已提交分片（T-B6b 实证 200 条）真实落库，但 rule_snapshot/file_cache 未清，下一轮提示词按旧文件重评，违背 R5 本意。spec D1「有成功写入才清」与「三早退不清理」在分片失败分支自相矛盾（spec_deviations #core-1）。
- 改法：把清理调用上移到 failedPath 早退**之前**（或失败分支同走清理），门闸 `writtenLogical.length > 0 && this.sessionKkv && scope.kind === "session"`；注释改为「**零写入**早退（typeConflicts / 冲突未确认）不清；分片失败只要有已提交分片就清」；**spec D1 措辞同步（替换句照抄，注意保留原文的 `**`/反引号等 markdown 标记，整句按字节匹配替换防静默不中）**：把 spec.md D1 的「三条早退（typeConflicts / 冲突未确认 / 分片失败）**不清理**——口径「有成功写入才清」：`applyBatchIngest` 走到成功 return（report.written 非空）即清」整句替换为「**零写入**早退（typeConflicts / 冲突未确认）不清理；分片失败只要有已提交分片就清（清理在 failedPath 早退之前按 `writtenLogical.length > 0` 判定）」。
- 验收/测试：新增用例——**追加进 `describe("VfsBatchIoService 导入后清 session 提示词缓存")`**（`seedDirtyCaches` helper 只在该 describe 内，:346-373；401 文件/testHook 构造照 T-B6b :220-262 复制）；session scope + throwOnWriteLogical 造跨片失败，断言 written=200、failed=1 且两域清空（用例开头先 seedDirtyCaches）；同片失败（written 空）两域不动。构造可行性：`createVfsBatchIoService(conn, {testHook})` 工厂内部已自建 sessionKkv（T-C5 已证清得掉 ctx.sessionKkv 可见的 key），**无需**手拼 DefaultVfsBatchIoService。
- 来源：cr-scope-core / round 1；fixspec-check r1 补落点

### desktop/C-1+C-2 [P1，合并决策点] ImportFormModal 双触发 + 键盘不可达
- 维度：C
- 文件：apps/desktop/renderer/features/workspace/ImportFormModal.tsx；连带 scripts/e2e/case-zip-backup.mjs
- 问题：`<label onClick>` 内嵌 radio——label 激活行为把 click 转发给 input 再冒泡回来，`onSelect` 跑**两次**：zip/card 分支幂等无症状，「单文件」分支无 in-flight 闸会连弹两次系统选择框、两次批量导入。且 radio readOnly + 无确认按钮 = 键盘用户完全够不着（比被复制的 FileInclusionModal 退化）。
- 改法（定案=方案 A，与 FileInclusionModal 同形）：改为 **onChange 选型 + 底部「导入」主按钮**——label 点击→input onChange（只发一次）更新 selected state（照 FileInclusionModal.tsx:112-118 的受控 radio `checked`+`onChange` 形态，该写法本仓已编译通过）；底部主按钮（**带 `data-import-form-submit` 锚**，E2E 选择器用；Button 组件 `{...rest}` 透传任意 data-* 属性，Button.tsx:20-25）触发 `onSelect(selected)` 后 onClose；取消按钮保留；**selected 复位**：照 FileInclusionModal 的 `[open, target]` effect（:59-64）在弹窗打开时重置为 'zip'（防二次打开带上次选中）。双触发（onChange 单路径）与键盘可达（radio 组原生 Tab/方向键 + 按钮确认）一并解决。**同步改 E2E**：case-zip-backup.mjs 点 `[data-import-form="zip"]` 后增加一步点 `[data-import-form-submit]`，**并把 :50 现有注释「点选项即生效（ImportFormModal 点 label 直接 onSelect）」改为两步口径**（防注释成谎言）。纵深防御：App 侧 handleImportFormSelect 加 in-flight useRef 闸（照 handleIngestFileConfirm 的 ingestFileBusyRef 先例，App.tsx:138 形态一致）。
- 验收/测试：desktop/G-2 结构断言锁「label 上无 onClick、input 带 onChange、有 data-import-form-submit 主按钮」；**方案 A 语义：点 label 只改选中态、绝不触发 onSelect——onSelect 唯一触发源是提交按钮**（测试按此口径写）；E2E 脚本两步流程更新。
- 来源：cr-scope-desktop / round 1

### core/C-1 [P2] 两条 apply 路径门闸字面重复
- 维度：C（DRY）
- 文件：vfs-batch-io.service.ts（:415-417、:483-485）
- 问题：三段式门闸+helper 调用两处各写一遍，B-1 落地后口径再变必改两处。
- 改法：抽私有方法 `private async alignPromptCachesAfterWrite(scope, writtenCount)`，两处调用各留 WHY 注释（零写入不清 / user-vfs-turn 链自身不清）。
- 验收：T-C1..T-C6 全绿（行为不变），B-1 新用例覆盖两侧。
- 来源：cr-scope-core

### core/G-1 [P2] T-C6 缺「writer 部分失败仍清理」断言
- 维度：G
- 文件：packages/core/test/vfs/vfs-batch-io.test.ts（T-C6）
- 改法：追加第三段——T-B8 的 writer（b.md 抛错 a.md 成功）+ session + overwriteConfirmed:true。**执行要点（fixspec-check r1）**：第三段开头必须重新 `await seedDirtyCaches(session.id, "tc6-writer-partial")`（第二段结尾两域已被清空，不重新埋脏则「两域清空」断言从空集断空集=恒绿）；并**重新 planBatchIngest 一份含 a.md+b.md 的 plan**（第二段的 plan 只有 a.md，writer 碰不到 b.md，「b.md 抛错」无从发生）。断言 written=["/导入/a.md"]、failed=1 且两域清空。
- 验收：把门闸改成「failed 非空就不清」该用例必红（依赖重新埋脏）。
- 来源：cr-scope-core；fixspec-check r1 补恒绿修正

### core/G-2 [P2] typeConflicts 早退无 session 缓存断言
- 维度：G
- 文件：同上（T-C4 追加）
- 改法：构造 typeConflicts 非空 plan（file foo + directory foo，同 T-B7）+ session scope + seedDirtyCaches，断言两域保持脏 key 原样。
- 验收：断言值=脏 key 原样，门闸放宽必红。
- 来源：cr-scope-core

### core/G-3 [P2] T-C5 恒真断言噪声
- 维度：G
- 文件：同上（T-C5 :554）
- 改法：删 `assert.equal(typeof batch.applyBatchIngest, "function")` 行。
- 验收：T-C5 仍绿。
- 来源：cr-scope-core

### desktop/C-3 [P2] 导出 toast 文案退化不可分辨
- 维度：B/C
- 文件：apps/desktop/renderer/App.tsx（:241-243）
- 问题：「已导出 ZIP」退化为共用的「已导出」，用户无法分辨落盘的是 zip 还是单文件（PRD 验收 5 要求行为与现状一致）。
- 改法：按分流来源选文案——file →「已导出文件」；dir/blank → 保持「已导出 ZIP」。
- 验收（fixspec-check r1 订正——T-DI3 断言 IPC channel/payload 够不到 App.tsx:242 的 toast 文案，desktop 测试不 import App）：在 apps/desktop/test/ 的**源码契约测试**（照 skills-manage-export-menu.test.ts:12-20 的 readFileSync 形态）读 App.tsx 源码，断言 file 分支文案锚（「已导出文件」）与 zip 分支文案锚（「已导出 ZIP」）同时存在；T-DI3 只需保持绿、不承担文案断言。
- 来源：cr-scope-desktop；fixspec-check r1 订正验收面

### desktop/C-4 [P2] ingest-file 的 busy 形同虚设
- 维度：C
- 文件：App.tsx（:421-446, 590-601）
- 问题：handleIngestFileConfirm 先 setWorkspaceConfirm(null)，ConfirmModal 立即卸载，busy「处理中」永不渲染；防重入实际只靠 ref。
- 改法：方案 (a)——await 完成后再关弹窗（busy 真可见、与 ref 双保险）。
- 验收（fixspec-check r1 订正——组件断言不可得，desktop 测试不 import App）：**仅人工**——确认期间弹窗不消失、确认按钮进入 busy 态；本条挂入文末「合并后 QA」清单。
- 来源：cr-scope-desktop；fixspec-check r1 订正验收面

### desktop/C-5 [P2] exportFilePathForTarget 生产零消费
- 维度：B/C
- 文件：workspace-context.ts:46-53 + workspace-actions.ts
- 问题：helper 只有测试消费；exportWorkspaceTarget 里同分支判断又写一遍（Step 并行的历史理由已失效）。
- 改法：exportWorkspaceTarget 改用 exportFilePathForTarget(target) 取 logicalPath（null 即 zip 分支），消重复。
- 验收：T-DI3 双分支断言仍绿（行为不变）。
- 来源：cr-scope-desktop

### desktop/C-6 [P2] files.length!==1 闸的注释与实际防护不符
- 维度：C
- 文件：apps/desktop/src/main/services/vfs-batch.service.ts（:281-300）
- 问题：恰好单文件的目录仍会过闸并被静默降级导出（core 侧 planBatchExport 不区分锚点类型）。
- 改法：注释改实话（「仅拦多文件目录；单文件目录会降级，由调用方保证只传文件行」）。
- 验收：注释与行为一致即可（不引入 entryKind 判定，避免 core 面扩大）。
- 来源：cr-scope-desktop

### desktop/G-1 [P2] 测试/新文件缺末行换行（8 个文件）
- 维度：K/G
- 文件：workspace-zip-menu.test.ts、workspace-character-card-menu.test.ts、ImportFormModal.tsx、apps/mobile 的 vfs-character-card-menu.test.ts、vfs-file-manager.session.integration.test.tsx、vfs-single-file-document-pick.ts、vfs-single-file.service.ts、vfs-single-file.service.test.ts（round3 订正：vfs-file-io.test.ts 实测已有换行移出；session.integration.test.tsx 实测缺、移入）
- 改法：统一补行尾换行。
- 验收（fixspec-check r1 订正）：8 文件末字节均为 `\n`（**字节级检查**，不看 diff 形态——其中 5 文件同时被其他条目改写，「仅末行 +换行」的 diff 形态对它们必然不成立）。
- 来源：cr-scope-desktop + cr-full（N-2 两轮订正）

### desktop/G-2 [P2] ImportFormModal 无任何测试面
- 维度：G
- 文件：新增 apps/desktop/test/import-form-modal.test.ts
- 改法（cr-full N-1 订正——原「渲染+点 label 断言」在 react-test-renderer 下无 DOM、label 激活转发不发生，恒绿零保护力；且 skills-manage-export-menu.test.ts 是纯 readFileSync 字符串断言、无点选能力，不可作行为先例）：
  - **结构断言（主，纯源码字符串，实现口径按 fixspec-check r1 钉死）**：锁 ImportFormModal.tsx 源码——①**按每个 `<label …>…</label>` 切片**断言切片内无 `onClick`（禁用全局 `/onClick/` 正则或跨块匹配——同文件 overlay `onClick={onClose}`(:70)/modal stopPropagation(:76)/取消按钮(:127) 是合法 onClick，全局匹配必假红；先例=FileInclusionModal.tsx:108-123 的干净 label）；②input 带 `onChange`；③存在 `data-import-form-submit` 主按钮；④三项集合断言写 `value: "(zip|card|file)"` 三处匹配（`data-import-form={opt.value}` 是动态属性，源码无 `data-import-form="zip"` 字面量）。
  - **行为断言（可选 .test.tsx）**：可加渲染断言（三项渲染/选中态切换/按钮触发 onSelect(selected) 恰一次），**并注明不承担防双触发验证**（无 DOM 环境测不了 label 转发；双触发的回归保护由结构断言①②承担）。
- 验收：变异（恢复 label onClick 形态/删 submit 按钮）结构断言必红；合法 onClick（overlay/取消按钮）不被误杀。
- 来源：cr-scope-desktop + cr-full（N-1）；fixspec-check r1 钉断言口径

### mobile/G-1 [P2] 单文件导入集成用例钉死不可达形态
- 维度：G
- 文件：apps/mobile/__tests__/vfs-file-manager.session.integration.test.tsx（:606-620 附近——cr-full N-3 订正：缺陷实体在此集成文件，**不是** service 单测）
- 问题：用例从**文件行**触发 import 且 targetDir='/note.md'（文件路径）——UI 上 file 行无导入入口，形态不可达且语义错误；真正的 dir/more 链路反而无守护。
- 改法：该集成用例改为从目录行/更多菜单触发（importSheet 目标=目录路径），断言组件传给服务的 targetDir 与文件名正确。**执行前置（fixspec-check r2）**：走目录行路径前须照 T-MM1（:450-453）先 mock 出 `/sub` 目录行再 openRowMenu。
- 验收：改后用例与 UI 可达路径一致。
- 来源：cr-scope-mobile + cr-full（N-3）；fixspec-check r1/r2

### mobile/G-2 [P2] 「超限」用户可见链零断言
- 维度：G
- 文件：**apps/mobile/__tests__/vfs-single-file.service.test.ts**（服务层）+ **apps/mobile/__tests__/vfs-file-manager.session.integration.test.tsx**（组件层——fixspec-check r1 点名；`mockShowToast` 已在 :142 一线、sheet 捕获 capturedImportSheet 已在 :90 一线）
- 改法：服务层断言超限→buildTooLargeError 抛出（mockStat 造 32MB+ 文件）；组件层 `mockFn(importVfsSingleFile).mockRejectedValue(超限错误)` → 断言 showToast 收到含「导入失败」的文案。**取消静默（:643 用例）与二进制跳过（:591 用例）两条链已存在，本次只补超限这一条**。
- 验收：超限/取消/二进制跳过三条用户可见链全有断言。
- 来源：cr-scope-mobile；fixspec-check r1 点名文件

### mobile/G-3 [P2] export 的 dir→ZIP 分流只有源码正则
- 维度：G
- 文件：apps/mobile/__tests__/vfs-file-manager.session.integration.test.tsx
- 改法（fixspec-check r1 收敛——file 行行为断言**已存在**于 :505-521 的 T-MM5，勿重复造）：**只补 dir 行一条**——`openRowMenu('sub') → onSelect('export')` → 断言 `exportVfsZip` 收到 `{directoryPath:'/sub'}` 且 `exportVfsSingleFile` 未被调；file 行引用现有 T-MM5 不动。
- 验收：dir/file 两分支行为化锁定。
- 来源：cr-scope-mobile；fixspec-check r1 去重复

### mobile/C-orch-1 [P2] runExportZip/runExportFile 同一编排两份复制
- 维度：C-orch
- 文件：apps/mobile/src/components/vfs/VfsFileManager.tsx；连带 vfs-character-card-menu.test.ts
- 问题：同一条「守卫→服务→toast」编排写两份。
- 改法（fixspec-check r1 钉签名——原「runExport(kindOrPath)」一个字符串无法区分 zip/file，二义）：收敛为单一 **`runExport(kind: 'zip' | 'file', targetPath: string)`** 内部分流。**连带清单（完整四点，照 vfs-character-card-menu.test.ts:102-117 逐条）**：① :113 的 `if (exporting) return` 计数断言 2→1；② :106-108 分流正则（`if (action === 'export') { … runExportFile(menuPath); } else { … runExportZip(menuPath); }`）改写为收敛后形态或删除（职责移交 mobile/G-3 行为断言）；③ :110 `runExportZip(currentPath);` 与 :114-116 的 toContain 随新函数体调用形态同步（**形参名一并钉死**——:114 隐含 `exportVfsSingleFile(runtime, scope, logicalPath)` 形参名，收敛后按新签名改写）；④ :102 用例名「单文件导出与 ZIP 共用 exporting 守卫」措辞对齐。
- 验收：两分支行为断言（mobile/G-3）落地后绿；源码契约测试无残留旧函数名。
- 来源：cr-scope-mobile；fixspec-check r1 P0 补全连带清单

### mobile/C-orch-2 [P2] 单文件服务抛裸 Error，与 typed error 惯例分叉
- 维度：C-orch/C
- 文件：**新建 apps/mobile/src/errors/vfs-single-file-error.ts**（fixspec-check r1 钉死——mobile/src/errors/ 下现无任何可复用错误类，只有 format-error.ts+toast-message.ts）；改 vfs-single-file.service.ts 的 4 处裸 `new Error`（:101-107、:165-167）
- 改法（cr-full N-6 定案）：新建 `class VfsSingleFileError extends Error` 导出，服务 4 处裸 Error 替换；**不改 format-error.ts**（formatError 末尾 `error instanceof Error → error.message` 兜底，子类输出逐字不变）；**禁止动 core public 导出面**。原「format-error 若需特判同步」按此落点**不需要**。
- 验收：①错误类型与双端既有导入错误形态一致、相应测试断言更新；②`git diff` 不含 `packages/core/src/public/*` 任何文件（护 allowlist 零新增）；③改造前后 `formatError(样例错误)` 输出**逐字相同**（护跨端 parity/用户可见文案不变）。
- 来源：cr-scope-mobile + cr-full（N-6）

## Spec deviations
- core-1（D1 内部矛盾）→ **随 core/B-1 修复闭合**（实现修回主口径 + spec 措辞同步）。
- desktop-1（SingleFileImportApplied 多带 skippedBinary 字段）→ **有据偏离，收编认可**（D6 要求跳过数明示，编排层独有信息；fix-spec 注记，不改）。
- desktop-2/3/4（C-5/C-3/C-4 对应）→ 随对应 must-fix 闭合。
- 其余：none。

## Open questions / 待拍板
1. 纯 mkdir plan（零文件写入）不清缓存是否可接受——影响极小（目录不改内容），zip 则恒清。默认**接受现状**（不清），用户可拍板改。
2. 「未知操作」兜底 toast 保留还是改编译期穷尽断言——默认保留（长期兜底）。
3. mobile 32MB 上限数字出处注释、picker 取消自带 toast 与「静默」表述、sheet 只记路径不记来源——三项默认按现状，K 节顺手注释澄清。

## 已豁免（用户确认不修）
（无）

## 合并后 QA（manual_user）
- desktop E2E case-zip-backup 实跑（T-Z1；dialog patch 对象式返回能否真拦 electron binding 待实跑确证）。
- **desktop/C-4 的 busy 可见性人工验收**（确认期间弹窗不消失、按钮 busy 态——组件断言不可得，见该条）。
- Step 8 真机/桌面人工验收（含单文件导入导出桌面实操、chat 面板导入后 workplace 前缀重评体感）。

## K 节建议（下游执行时闭合）
- core G-3 / desktop G-1（8 文件换行）随批处理。
- VfsFileManager 旧注释「角色卡/ZIP」措辞更新、C-orch-2 的英文 WHY 注释若保留需补中文。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes（CR 三轮 fix-spec-ready + fixspec-check 两轮 execute-ready：r1 1P0+2P1+9P2 十二订正全闭合、r2 Go、3 文字尾巴已闭合） |
| fix_spec_path | docs/Iterations/vfs-import-export-menu/cr-fix-spec.md |
| dag_version / review_round | 4 / 4（CR）+2（fixspec-check） |
| P0 / P1 / P2（已写入） | 0 / 2 / 15（desktop C-2 并入 C-1 决策点；cr-full N-4 订正计数） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open: 0（core-1 随 B-1 闭合、desktop-1 收编认可、余随 must-fix 闭合） |
| C-orch | ✅（mobile C-orch-1/2 已入；跨端 parity 语义一致达成路径已核） |
| C 类合并后 QA | 见上 |

> cr-full 六条缺口处置记录：N-1→desktop/G-2 改法重写（结构断言为主）；N-2→G-1 换行清单 8 文件；N-2b→C-1 补 selected 复位；N-3→mobile/G-1 文件指向订正；N-5→C-1 补 data-import-form-submit 锚；N-6→C-orch-2 定本地类禁动 core 面；N-4→Closure 计数订正。下轮校验只需覆盖上述修订点。
