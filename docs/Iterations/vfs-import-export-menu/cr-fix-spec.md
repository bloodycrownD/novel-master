# CR Fix Spec: vfs-import-export-menu（导入导出菜单收敛）

## 元信息
- repo: D:\Dev\nm-worktree\imex（分支 feat/vfs-import-export-menu）
- base_sha / head_sha: 5cec285f7 / c22d31494
- prd_path / spec_path: docs/Iterations/vfs-import-export-menu/{prd,spec}.md
- review_round / dag_version: 4 / 4（wave-1 三路 scope → round2 full 六缺口 → round3 增量校验四文字订正）
- 状态：fix-spec-ready（round3 审查者预背书：四文字订正后即可 yes，订正已落）

## Must-fix（按 P0 → P1 → P2）

### core/B-1 [P1] 跨片失败早退时 written 非空却不清理缓存
- 维度：B
- 文件：packages/core/src/service/vfs/impl/vfs-batch-io.service.ts（:395-417 附近）；连带 docs/Iterations/vfs-import-export-menu/spec.md（D1 措辞）
- 问题：applyBatchIngest 的 failedPath 早退在清理调用之前——跨片失败时已提交分片（T-B6b 实证 200 条）真实落库，但 rule_snapshot/file_cache 未清，下一轮提示词按旧文件重评，违背 R5 本意。spec D1「有成功写入才清」与「三早退不清理」在分片失败分支自相矛盾（spec_deviations #core-1）。
- 改法：把清理调用上移到 failedPath 早退**之前**（或失败分支同走清理），门闸 `writtenLogical.length > 0 && this.sessionKkv && scope.kind === "session"`；注释改为「**零写入**早退（typeConflicts / 冲突未确认）不清；分片失败只要有已提交分片就清」；**同步修正 spec D1 措辞**为同口径。
- 验收/测试：新增用例——session scope + throwOnWriteLogical 造跨片失败（复用 T-B6b 401 文件构造），断言 written=200、failed=1 且两域清空；同片失败（written 空）两域不动。
- 来源：cr-scope-core / round 1

### desktop/C-1+C-2 [P1，合并决策点] ImportFormModal 双触发 + 键盘不可达
- 维度：C
- 文件：apps/desktop/renderer/features/workspace/ImportFormModal.tsx；连带 scripts/e2e/case-zip-backup.mjs
- 问题：`<label onClick>` 内嵌 radio——label 激活行为把 click 转发给 input 再冒泡回来，`onSelect` 跑**两次**：zip/card 分支幂等无症状，「单文件」分支无 in-flight 闸会连弹两次系统选择框、两次批量导入。且 radio readOnly + 无确认按钮 = 键盘用户完全够不着（比被复制的 FileInclusionModal 退化）。
- 改法（定案=方案 A，与 FileInclusionModal 同形）：改为 **onChange 选型 + 底部「导入」主按钮**——label 点击→input onChange（只发一次）更新 selected state；底部主按钮（**带 `data-import-form-submit` 锚**，E2E 选择器用）触发 `onSelect(selected)` 后 onClose；取消按钮保留；**selected 复位**：照 FileInclusionModal 的 `[open, target]` effect 模式在弹窗打开时重置为 'zip'（防二次打开带上次选中）。双触发（onChange 单路径）与键盘可达（radio 组原生 Tab/方向键 + 按钮确认）一并解决。**同步改 E2E**：case-zip-backup.mjs 点 `[data-import-form="zip"]` 后增加一步点 `[data-import-form-submit]`。纵深防御：App 侧 handleImportFormSelect 加 in-flight useRef 闸（照 handleIngestFileConfirm 的 ingestFileBusyRef 先例）。
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
- 改法：追加第三段——T-B8 的 writer（b.md 抛错 a.md 成功）+ session + overwriteConfirmed:true，断言 written=["/导入/a.md"]、failed=1 且两域清空。
- 验收：把门闸改成「failed 非空就不清」该用例必红。
- 来源：cr-scope-core

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
- 验收：T-DI3 或新断言锁两分支文案。
- 来源：cr-scope-desktop

### desktop/C-4 [P2] ingest-file 的 busy 形同虚设
- 维度：C
- 文件：App.tsx（:421-446, 590-601）
- 问题：handleIngestFileConfirm 先 setWorkspaceConfirm(null)，ConfirmModal 立即卸载，busy「处理中」永不渲染；防重入实际只靠 ref。
- 改法：方案 (a)——await 完成后再关弹窗（busy 真可见、与 ref 双保险）。
- 验收：确认期间弹窗仍显示且按钮进入 busy 态（人工/组件断言）。
- 来源：cr-scope-desktop

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
- 验收：8 文件末字节均为 `\n`（`git diff` 可见每文件仅末行 +换行，无其他变动）。
- 来源：cr-scope-desktop + cr-full（N-2 两轮订正）

### desktop/G-2 [P2] ImportFormModal 无任何测试面
- 维度：G
- 文件：新增 apps/desktop/test/import-form-modal.test.ts
- 改法（cr-full N-1 订正——原「渲染+点 label 断言」在 react-test-renderer 下无 DOM、label 激活转发不发生，恒绿零保护力；且 skills-manage-export-menu.test.ts 是纯 readFileSync 字符串断言、无点选能力，不可作行为先例）：
  - **结构断言（主，纯源码字符串）**：锁 ImportFormModal.tsx 源码——①无 `label onClick` 直接 onSelect 形态（label 上不挂 onClick）；②input 带 `onChange`；③存在 `data-import-form-submit` 主按钮；④三项 `data-import-form` 值集合 {zip, card, file}。
  - **行为断言（可选 .test.tsx）**：可加渲染断言（三项渲染/选中态切换/按钮触发 onSelect(selected) 恰一次），**并注明不承担防双触发验证**（无 DOM 环境测不了 label 转发；双触发的回归保护由结构断言①②承担）。
- 验收：变异（恢复 label onClick 形态/删 submit 按钮）结构断言必红。
- 来源：cr-scope-desktop + cr-full（N-1）

### mobile/G-1 [P2] 单文件导入集成用例钉死不可达形态
- 维度：G
- 文件：apps/mobile/__tests__/vfs-file-manager.session.integration.test.tsx（:606-620 附近——cr-full N-3 订正：缺陷实体在此集成文件，**不是** service 单测）
- 问题：用例从**文件行**触发 import 且 targetDir='/note.md'（文件路径）——UI 上 file 行无导入入口，形态不可达且语义错误；真正的 dir/more 链路反而无守护。
- 改法：该集成用例改为从目录行/更多菜单触发（importSheet 目标=目录路径），断言组件传给服务的 targetDir 与文件名正确。
- 验收：改后用例与 UI 可达路径一致。
- 来源：cr-scope-mobile + cr-full（N-3）

### mobile/G-2 [P2] 「超限」用户可见链零断言
- 维度：G
- 文件：vfs-single-file.service.test.ts + VfsFileManager 相关测试
- 改法：补一条 maxBytes 超限→buildTooLargeError 抛出→UI 侧 toast 提示的断言（服务层断言错误类型即可，组件层断言 Alert/toast 调用）。
- 验收：超限与取消、二进制跳过三条用户可见链都有断言。
- 来源：cr-scope-mobile

### mobile/G-3 [P2] export 的 dir→ZIP 分流只有源码正则
- 维度：G
- 文件：apps/mobile/__tests__/vfs-character-card-menu.test.ts（源码契约）或 integration
- 改法：补行为断言——dir 行 export 调 exportVfsZip（mock 断言收到 directoryPath=menuPath）、file 行调 exportVfsSingleFile（收到 logicalPath）。
- 验收：分流行为化锁定，不只锁源码文本。
- 来源：cr-scope-mobile

### mobile/C-orch-1 [P2] runExportZip/runExportFile 同一编排两份复制
- 维度：C-orch
- 文件：apps/mobile/src/components/vfs/VfsFileManager.tsx；连带 vfs-character-card-menu.test.ts
- 问题：同一条「守卫→服务→toast」编排写两份。
- 改法：收敛为单一 runExport(kindOrPath) 内部分流；**连带**：源码契约测试里 `if (exporting) return` 计数断言 2→1 必须同步改（否则假红）。
- 验收：两分支行为断言（mobile/G-3）落地后绿。
- 来源：cr-scope-mobile

### mobile/C-orch-2 [P2] 单文件服务抛裸 Error，与 typed error 惯例分叉
- 维度：C-orch/C
- 文件：apps/mobile/src/services/vfs-single-file.service.ts（+ src/errors/format-error.ts 若需特判）
- 改法（cr-full N-6 定案）：错误类落点=**mobile 本地轻量错误类**（apps/mobile/src/errors/ 下新建或复用），**禁止动 core public 导出面**（保持「public allowlist 零新增」的迭代约束）；format-error 若需特判同步。
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
- Step 8 真机/桌面人工验收（含单文件导入导出桌面实操、chat 面板导入后 workplace 前缀重评体感）。

## K 节建议（下游执行时闭合）
- core G-3 / desktop G-1（8 文件换行）随批处理。
- VfsFileManager 旧注释「角色卡/ZIP」措辞更新、C-orch-2 的英文 WHY 注释若保留需补中文。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes（round3 审查者预背书「订正 4 处文字后即可 yes」，4 处已全部订正；改法方向 17 条全程未变） |
| fix_spec_path | docs/Iterations/vfs-import-export-menu/cr-fix-spec.md |
| dag_version / review_round | 4 / 4 |
| P0 / P1 / P2（已写入） | 0 / 2 / 15（desktop C-2 并入 C-1 决策点；cr-full N-4 订正计数） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open: 0（core-1 随 B-1 闭合、desktop-1 收编认可、余随 must-fix 闭合） |
| C-orch | ✅（mobile C-orch-1/2 已入；跨端 parity 语义一致达成路径已核） |
| C 类合并后 QA | 见上 |

> cr-full 六条缺口处置记录：N-1→desktop/G-2 改法重写（结构断言为主）；N-2→G-1 换行清单 8 文件；N-2b→C-1 补 selected 复位；N-3→mobile/G-1 文件指向订正；N-5→C-1 补 data-import-form-submit 锚；N-6→C-orch-2 定本地类禁动 core 面；N-4→Closure 计数订正。下轮校验只需覆盖上述修订点。
