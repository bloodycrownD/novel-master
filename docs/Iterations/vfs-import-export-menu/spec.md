---
date: 2026-10-03
---

# VFS 工作区导入导出菜单收敛 技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/vfs-import-export-menu/prd.md`（R1 菜单收敛双端 / R2 导入三选弹窗 / R3 导出类型直达 / R4 单文件导入导出能力 / R5 单文件导入统一清 session 提示词缓存）。

探索依据：brain-storm 轮三报告 `tmp/explore-import-export-{1,2,3}-*.md` + spec 轮三报告 `tmp/explore-spec-{core,desktop,mobile}.md`（下文证据均可回溯）。

## 总体方案

三层改造：core 层给 batch-io 挂缓存清理（R5，双端自动继承）；desktop 层菜单收敛 + 形式选择弹窗 + 两条新 IPC 通道（pick-only 复用既有批量导入协议 + 单文件另存导出）；mobile 层菜单收敛 + 第三张 BottomSheetMenu + 新单文件服务（直调 core batch-io）。

### 关键决策（D1–D9）

- **D1 R5 落点＝core batch-io 服务内**：工厂 `create-vfs-batch-io-service.ts` 注入 `sessionKkv: createSessionKkvService(conn)`（照 zip/card 工厂三行，对外签名 `(conn, options?)` 不变）；`DefaultVfsBatchIoServiceOptions` 增 `sessionKkv?`；清理调用放方法**成功 return 前**，门闸 `this.sessionKkv && scope.kind === "session"`，best-effort（helper 自带 try/catch）。**零写入**早退（typeConflicts / 冲突未确认）不清理；分片失败只要有已提交分片就清（清理在 failedPath 早退之前按 `writtenLogical.length > 0` 判定）。
- **D2 via-writer 路径签名加 scope**：`applyBatchIngestWithWriter(targetDir, plan, options, writer)` **没有 scope 参数**，无法判 session。改首参为 `applyBatchIngestWithWriter(scope: VfsScope, targetDir, plan, options, writer)`（改 desktop `vfs-batch.service.ts` 一处调用 + core 测试 T-B8 一处）。**不选**「BatchApplyOptions 加 sessionId」（口径松散）与「不清」（user-vfs-turn 链实证不清 rule_snapshot、vfs write 工具反而 upsert 单条 file_cache，非「上层已保证」）。writer 路径同样 written 非空即清。
- **D3 desktop 单文件导入＝pick-only 新通道 + 复用既有批量导入协议**：新增 `VFS_FILE_PICK`（noArg，`showOpenDialog` → `string | null`，照 `handleVfsZipPick` 形态）；renderer 侧菜单链路的**编排函数新写于 `workspace-actions.ts`**（`startSingleFileImport`：pick → `ipcVfsBatchIngestFromPaths(overwriteConfirmed:false)` → needs_confirm 时返回确认请求；`confirmSingleFileImport`：同参数二次调用 `overwriteConfirmed:true`）——**复用的是通道与两段式协议语义**（needs_confirm DTO、apply report、skippedBinary toast、`pushWorkspaceMutated`），不是复用 `handleFilesDropIngest`（其入参绑死 `DataTransfer`，菜单链路够不着；DnD 编排一行不动）。toast 文案与 `BatchIngestConfirmRequest` 形态照 `workspace-batch-dnd.ts` 现值提取共享。
- **D4 desktop 单文件导出＝新通道 `VFS_FILE_EXPORT`**：main 新函数 `exportVfsFileWithDialog`（放 `vfs-batch.service.ts`）：`planBatchExport(scope, [logicalPath])` → **校验 files.length === 1**（误传目录会递归整树不报错）→ `showSaveDialog`（defaultPath = basename，复用 `zipBaseNameFromPath` 语义）→ `writeFile utf8` → `'saved' | 'cancelled'`。DTO Result 与 `VfsZipExportResult` 同构，App.tsx toast 分支复用。不走 staging/startDrag 链（那是拖拽专属）。
- **D5 形式选择弹窗形态**：desktop 新组件 `ImportFormModal`（radio + label + **hint**，照 `FileInclusionModal` 骨架，样式直接复用 `file-inclusion-modal__option*` 类；选项带 `data-import-form="zip|card|file"` 锚供 E2E）。mobile 第三张 `BottomSheetMenu`（title「导入」+ 三项 label「单文件 / ZIP 包 / 角色卡」，action `file` / `zip` / `character-card`）；**不扩 SheetMenuItem 公共组件**（BottomSheetMenu 渲染消费方十余处，改公共类型面收益低；说明文案由后续确认 Alert 承载）。R2 的「三种覆盖确认文案独立」落在确认环节（D9），不在选择弹窗。
- **desktop 编排落点＝`workspace-actions.ts` 纯函数（测试断言面）**：App.tsx 的 overlay/分派组件未导出且 desktop 测试不 import App——导入/导出的菜单侧编排全部下沉 `workspace-actions.ts`，App.tsx 分派只做薄接线。三个函数与返回类型：`startSingleFileImport(scopeRequest, targetDir)` → `Promise<{status:'cancelled'} | {status:'needs-confirm'; hostPaths: string[]; conflictCount: number} | {status:'applied'; report: …}>`（内部 pick → ingest(overwriteConfirmed:false) → 按 needs_confirm 分流）；`confirmSingleFileImport(scopeRequest, targetDir, hostPaths)` → 二次调用 `overwriteConfirmed:true` 返回 apply 结果；`exportWorkspaceTarget(scopeRequest, target)` → `Promise<'saved' | 'cancelled'>`（内部按 `target.row.kind` 分流——file 取 `target.row.path` 作 logicalPath 走 `VFS_FILE_EXPORT`，dir/blank 取目录路径走既有 `VFS_ZIP_EXPORT`；**不依赖 Step 3 才建的 `exportFilePathForTarget` helper**）。断言落在 `workspace-actions.test.ts`（`installInvokeStub` 先例 :40-53——**需小幅扩展以记录 payload**，现 helper 只记 channel 丢弃 payload；扩展不破坏既有用例）；T-DI3/T-DI4/T-DI5 按 channel+payload 断言。
- **D6 二进制口径＝导入后明示跳过（双端统一）**：core `planBatchIngest` 的 `tryDecodeUtf8` 把关（非 UTF-8 → `skippedBinary`），UI toast「跳过 N 个非 UTF-8 文件」（desktop 现成文案 `workspace-batch-dnd.ts` 复用提取；mobile 新写同义）。desktop `showOpenDialog` 不传 filters；mobile picker mimeTypes 用**宽松白名单 + octet-stream 兜底**（照 `yaml-document-pick.ts` 形态——Downloads 常打 octet-stream，白名单挡不住，最终把关靠 core）。**禁止** mobile 走 `pickAndReadText`（`readFile utf8` 会把任意二进制静默解码成乱码写进 VFS）。
- **D7 mobile 单文件导入直调 core batch-io**：`createVfsBatchIoService(runtime.conn)`（public/vfs.ts 已导出，零新增 public 面）→ `planBatchIngest` → conflicts 非空先 Alert 确认 → `applyBatchIngest({overwriteConfirmed})`。**沿用 zip 导入直写 DB 口径**（mobile 的 create/save 走 userVfsTurn 是编辑链路的约定，zip 导入即不走它，单文件导入对齐 zip）。注意 `applyBatchIngest` 未确认覆盖时**返回 report.skipped 不抛错**——UI 读 report 判定。mobile 单文件导出：`planBatchExport(scope, [path])` → `files[0]` → `exportBytesViaDocumentPicker`（write 回调 utf8 形态，照 `yaml-shared.ts`；mimeType = `knownTypesForExtension(ext)` **兜底 `text/plain`**——该函数未知扩展名返回 []、测试环境恒 []）。导出 in-flight 守卫复用 `exportingZip`（重命名 `exporting`，zip 与单文件互斥防重入）。
- **D8 `document-io` 新增 `pickAndReadFileWithMeta`（不动既有函数语义）**：单文件导入需要 `{bytes, fileName}`，而现 `pickAndReadBytes` 返回裸 `Uint8Array` 且**两个现存调用方整体接住返回值当 bytes 用**（`vfs-zip.service.ts:129-145`、`vfs-character-card.service.ts:26-58`），改返回形态必断。签名 `pickAndReadFileWithMeta({mimeTypes, localFileName, maxBytes?, buildTooLargeError?}): Promise<{bytes: Uint8Array; fileName: string} | null>`——**maxBytes 预检与 `pickAndReadBytes` 同款约定**（`document-io.ts:142-146` 要求 `buildTooLargeError` 同时存在才生效，两者必须成对传或都不传）。fileName 空值兜底：`file.name` 可为空（现取名链 `:97-100` 证明），新函数沿用该链兜底（非空保证，最终兜底 `import.bin`）——因 `relativePath = fileName` 直接决定 VFS 落点。实现取材：给内部 `PickedLocalFile` 类型加可选 `fileName` 字段并由 `pickToLocalPath` 透传（类型扩展向后兼容，比新函数自己重复拷盘链干净）；`document-io.test.ts` 补新函数用例。
- **D9 覆盖确认文案拆分与共享常量**：desktop `zipImportConfirmMessage`（现被 zip 与角色卡共用）拆为 zip / 角色卡两条；单文件覆盖文案提取共享常量 `batchIngestOverwriteMessage(n)`（现 ExplorerPane.tsx:186-213 与 WorkspaceTree.tsx:333-357 已重复两份，菜单链路是第三处消费——三处共享，拖拽链路行为不动只换文案来源）。mobile `zipImportConfirmCopy` 同样拆三份（zip / 角色卡 / 单文件），`runImport` 的 title/confirm/toast 从 kind 三元改三分支。

## 最终项目结构

```text
packages/core/src/service/vfs/
  create-vfs-batch-io-service.ts        # 改：注入 sessionKkv
  impl/vfs-batch-io.service.ts          # 改：options+sessionKkv；apply/writer 清理；writer 签名加 scope
packages/core/src/domain/vfs/ports/
  vfs-batch-io.port.ts                  # 改：applyBatchIngestWithWriter 签名（无新增导出名）
apps/desktop/renderer/features/workspace/
  workspace-context.ts                  # 改：菜单收敛 + exportFilePathForTarget + 文案拆分/共享常量
  workspace-actions.ts                  # 改：新增 startSingleFileImport / confirmSingleFileImport / exportWorkspaceTarget 编排（断言面）
  ImportFormModal.tsx                   # 新：导入形式选择弹窗（radio+hint）
  workspace-batch-dnd.ts                # 改：toast/文案常量提取共享（行为不动）
apps/desktop/renderer/App.tsx           # 改：importFormTarget state + ingest-file 确认变体 + import/export 分派 + 挂载
apps/desktop/renderer/layout/ExplorerPane.tsx        # 改：覆盖确认文案改用共享常量
apps/desktop/renderer/features/workspace/WorkspaceTree.tsx  # 改：同上
apps/desktop/shared/ipc-types.ts        # 改：VFS_FILE_PICK / VFS_FILE_EXPORT 常量 + DTO
apps/desktop/renderer/ipc/client.ts     # 改：两个具名再导出
apps/desktop/renderer/ipc/invoke-registry.ts         # 改：两条 withReq/noArg
apps/desktop/src/main/ipc/handler-registry.ts        # 改：bindNoArg(VFS_FILE_PICK) + bindReq(VFS_FILE_EXPORT)
apps/desktop/src/main/ipc/handlers/vfs.ts            # 改：handleVfsFilePick / handleVfsFileExport
apps/desktop/src/main/services/vfs-batch.service.ts  # 改：pickHostFileWithDialog + exportVfsFileWithDialog + writer 调用签名
apps/desktop/renderer/styles/shell.css  # 改（最小）：import-form 样式（若复用 file-inclusion 类名则零新增）
apps/mobile/src/services/
  vfs-single-file.service.ts            # 新：importVfsSingleFile / exportVfsSingleFile
  vfs-single-file-document-pick.ts      # 新：mime 白名单 + octet-stream 兜底（照 yaml-document-pick）
  document-io.ts                        # 改：新增 pickAndReadFileWithMeta（既有函数签名不动）
apps/mobile/src/components/vfs/VfsFileManager.tsx     # 改：菜单收敛 + 第三张 sheet + 分派 + 文案拆分
（测试文件见测试策略节）
```

## 变更点清单

1. core：batch-io 工厂注入 sessionKkv；服务两条 apply 路径成功后清 session 提示词缓存；writer 签名加 scope。
2. desktop 菜单：`workspaceMenuItems` blank/dir 分支三项 → 「导入」「导出」（action `import` / `export`）；file 分支新增「导出」；新 helper `exportFilePathForTarget`。
3. desktop 弹窗与分派：`importFormTarget` state（照 dirRuleTarget 范式）；`ImportFormModal`（zip/card 分流进既有 ConfirmState 链路一行不改，file 走 pick+ingest 编排）；`WorkspaceConfirmState` 增 `{kind:'ingest-file'; target; targetDir; hostPaths; conflictCount}` 变体（ConfirmModal 实例传 `busy` 防重入）；`handleWorkspaceAction` 增 `import`/`export` 薄分支（只调 `workspace-actions.ts` 编排函数与 setState，export 按 row.kind 分流：file → `exportWorkspaceTarget` 单文件直达无确认；dir/blank → 既有 zip 导出）；文案拆分与共享常量。
4. desktop IPC 与编排：`VFS_FILE_PICK`（noArg → `string|null`）+ `VFS_FILE_EXPORT`（`{logicalPath}` → `'saved'|'cancelled'`）四件套 + main 两个函数；`workspace-actions.ts` 新增三个编排函数（D5 后半，T-DI 断言面）。
5. mobile 菜单：`entityMenuItems`/`moreMenuItems` 收敛（dir 分支与 more 菜单 → 「导入」「导出」；file 分支增「导出」，包在 `workplace != null` 门控内防技能页泄漏）；新 state `importSheetTarget`（记目标路径）+ 第三张 BottomSheetMenu；`dismissAllOverlays` 纳新 state；`runImport` 拆三分支；`runExport` 增 file 分支。
6. mobile 服务：`vfs-single-file.service.ts` + document-pick 白名单 + `document-io.ts` 新增 `pickAndReadFileWithMeta`（既有签名不动）。
7. 测试与 E2E：desktop 两菜单测试改写 + `workspace-actions.test.ts` 新增编排用例 + E2E `case-zip-backup.mjs` 流程更新（含 dialog patch 返回形态修正）；mobile 源码契约测试重写 + integration/readonly 测试补 `vfs-single-file.service` mock + `document-io.test.ts` 新函数用例 + 新服务测试；core batch-io 测试增缓存用例。

明确不动：技能域（SkillsManageView/SkillsSettingsScreen/NewSkillModal）；desktop 拖拽链路全链（workspace-batch-dnd 编排 + tree/pane 两个 ConfirmModal + VFS_START_DRAG*）；`zipBaseNameFromPath`（有测试锁）；`BatchExportPlan.skipped` 可选字段；public allowlist 快照（零新增导出）；CLI。

## 详细实现步骤

- Step 1 — phase-core-cache — blocking: yes — qa: auto：core batch-io 缓存清理。工厂注入 sessionKkv；`DefaultVfsBatchIoServiceOptions` 增字段；`applyBatchIngest` 成功 return 前与 `applyBatchIngestWithWriter`（签名加 scope）written 非空时调 `clearSessionPromptCaches(scope.sessionId, this.sessionKkv)`（门闸 + best-effort）；desktop `vfs-batch.service.ts` writer 调用处与 core 测试 T-B8 适配新签名；不补 backfillBaseline（单文件写走 writeWithRevision 自带 head 对齐，写决策注释）。测试 T-C1..T-C6。
- Step 2 — phase-desktop-fileio — blocking: yes — qa: auto：IPC 通道与编排函数（先于菜单，供接线）。ipc-types 常量与 DTO（Result 与 zip 同构；pick 是 noArg）；client/invoke-registry/handler-registry/handlers 四件套；main `pickHostFileWithDialog`（照 character-card dialogOpts 模板，不传 filters）与 `exportVfsFileWithDialog`（plan→校验单文件→showSaveDialog→writeFile→saved/cancelled；导出无库变更不推 pushWorkspaceMutated）；`workspace-actions.ts` 三个编排函数（D5 后半）。测试 T-DI1..T-DI5。
- Step 3 — phase-desktop-menu — blocking: yes — qa: auto：菜单收敛与形式选择弹窗（接线 Step 2 产物，无占位）。`workspaceMenuItems` 三分支改造 + `exportFilePathForTarget`；文案拆分（zip/角色卡独立）+ `batchIngestOverwriteMessage` 共享常量（ExplorerPane/WorkspaceTree 换用，行为不动）；`ImportFormModal`（radio+hint+data-import-form，复用 file-inclusion 样式）；App.tsx：`importFormTarget` state、`handleWorkspaceAction` 的 `import`/`export` 薄分支（import → 开弹窗；export → `exportWorkspaceTarget`，zip 分支迁入既有逻辑）、`ingest-file` 确认变体与 ConfirmModal 实例（busy 防重入，confirm 调 `confirmSingleFileImport`）、挂载新弹窗、deps 补齐；尾部未知 action 兜底（可选加固）。测试 T-DM1..T-DM4。
- Step 4 — phase-mobile-fileio — blocking: yes — qa: auto：mobile 单文件服务（先于组件，供 mock）。`vfs-single-file-document-pick.ts`（白名单+octet-stream）；`document-io.ts` 新增 `pickAndReadFileWithMeta`（既有签名不动，`document-io.test.ts` 补用例）；`vfs-single-file.service.ts`：导入（pick {bytes, fileName} → planBatchIngest 单 entry（relativePath=fileName）→ conflicts 确认 → applyBatchIngest → skippedBinary 信息回传 / applied 返回）；导出（planBatchExport 单元素 → files[0] → exportBytesViaDocumentPicker utf8 + MIME 兜底）。测试 T-MF1..T-MF5。**前置：改 core 后先 `npm run build -w @novel-master/core`（mobile jest 走 dist）**。
- Step 5 — phase-mobile-menu — blocking: yes — qa: auto：菜单收敛与第三张 sheet（接线 Step 4 服务，无占位——组件可直接 import 真模块，测试 mock 已存在的模块）。抽同源常量（导入/导出 items + 三选项表）；`entityMenuItems`/`moreMenuItems` 改造（file「导出」在 workplace 门控内）；`importSheetTarget` state + 第三张 BottomSheetMenu；分派接线（`import`→开 sheet；`export` 按 menuRow.kind / 来源分流，file → `exportVfsSingleFile`）；`runImport` 拆三分支（文案三份）；`runExport` file 分支；`dismissAllOverlays` 补 state；`exportingZip` 改名 `exporting`。测试 T-MM1..T-MM5（含源码契约重写、integration 第三 sheet mock + 新服务 jest.mock、readonly 服务 mock 补、file 行导出 workplace 门控断言）。
- Step 6 — phase-e2e-update — blocking: no — qa: auto：E2E `case-zip-backup.mjs` 更新——:36 选择器 `export-zip`→`export`（右键目标保持根目录行→zip 语义）；:46 `import-zip`→`import` + 新增「形式弹窗点 [data-import-form="zip"]」步骤 + `.confirm-modal` 照旧；**修正 :10-18 dialog patch 返回形态**（旧式数组 → `{canceled:false, filePaths:[...]}` / `{canceled:false, filePath:...}` 对象式，与 `vfs-zip.service.ts` 当前读取一致——既有隐患顺手修）。T-Z1。
- Step 7 — phase-verify — blocking: yes — qa: auto：全量门禁——core 全量（`cd packages/core && npm test`，注意红基线对账 stash 对照）、desktop 全量（递归收集器 + `--test-concurrency=2`）、mobile 全量（`--maxWorkers=2`）、双端 typecheck：mobile 走 `tsc`；**desktop renderer 走棘轮门禁 `check-renderer-typecheck.mjs`（基线 `typecheck-renderer-baseline.json`，判 delta=0；跨 worktree/基线身份漂移时用同工作区 A/B 对照判定，禁 `--update`）**，desktop main 走裸 tsc；core 改动后重建 dist 再跑 mobile/desktop。
- Step 8 — phase-manual-accept — blocking: no — qa: manual_user：真机/桌面人工验收——双端菜单形态（三项退役、文件行导出）、单文件导入导出实操、chat 面板导入后 workplace 前缀重评（R5 体感验证）。

编排依赖：Step 1（core）先行；Step 2、Step 4 名义依赖 Step 1——Step 1 与 Step 2 同改 `vfs-batch.service.ts` 须串行（writer 适配归 Step 1 一次完成），Step 4 的 mobile 测试消费 core dist 须重建后跑（core 改动 → `npm run build -w @novel-master/core` → 再跑 mobile）；Step 3 依赖 Step 2（App 接线消费通道与编排函数）；Step 5 依赖 Step 4（组件与测试 mock 消费已存在的服务模块）；desktop 链（2→3）与 mobile 链（4→5）可并行；6/7/8 收尾。

## 测试策略

红基线对账纪律：涉改文件与基线逐字节对照（`git diff --name-only <base>..HEAD` 归因），新增红必须为零。

### 测试用例

core（`packages/core/test/vfs/vfs-batch-io.test.ts` 增 describe；`createMemorySessionKkv` 来自 test/helpers/prompt-layout-test-helpers.ts:8；断言形态照 `character-card-import.test.ts` 的 T-IC 族：清空断言 :636、**project scope 不动 :700（T-C2 范式）**、吞错直接 new 实现类注入 throwingKkv :744（T-C3 范式）；工厂单参默认注入范式在 `vfs-zip-io.test.ts:835`）：

- T-C1 — blocking: yes — session scope `applyBatchIngest` 成功后 rule_snapshot + file_cache 被清空（照 T-IC1 清空断言形态）。
- T-C2 — blocking: yes — 非 session scope（project）导入成功后两域**不动**（照 character-card T-IC :700 范式）。
- T-C3 — blocking: yes — 清理 best-effort：sessionKkv 抛错时导入仍成功返回（console.warn 不抛）（照 :744 throwingKkv 范式）。
- T-C4 — blocking: yes — 冲突未确认（needs confirm 早退）**不清理**；确认覆盖成功后清理。
- T-C5 — blocking: yes — 工厂单参 `createVfsBatchIoService(conn)` 默认注入（session 导入即清，断言形态照 `vfs-zip-io.test.ts:835` 的工厂单参范式）。
- T-C6 — blocking: yes — `applyBatchIngestWithWriter`（新 scope 签名）session+written 非空清理；T-B8 既有用例适配签名后语义不变。

desktop 菜单（改写 `workspace-zip-menu.test.ts` / `workspace-character-card-menu.test.ts`，fixture 保守不合并）：

- T-DM1 — blocking: yes — blank 与 dir 行菜单含 `import`/`export`，不含 `import-zip`/`import-character-card`/`export-zip`；补 label 与「含且仅含」数量断言（现状无兜底）。
- T-DM2 — blocking: yes — file 行菜单含 `export`、不含 `import`（原负向断言 :76 语义翻转）；`exportFilePathForTarget(file)===row.path`、blank/dir 返回 null。
- T-DM3 — blocking: yes — `zipDirectoryPathForTarget` 断言维持（blank=/、dir=path、file=null 不变）。
- T-DM4 — blocking: yes — 文案函数：zip 与角色卡确认文案独立（非同一函数/不同输出）；`batchIngestOverwriteMessage(n)` 输出含 n。

desktop IPC / 编排（断言面＝`workspace-actions.test.ts` 的 `installInvokeStub`（:40-53 先例，按 channel+payload 断言）+ main 侧照 `vfs-zip-export-name.test.ts` 直调 handler 模板；**App.tsx 接线不设单测断言面**（组件未导出、desktop 测试不 import App——由 T-DM 与 E2E 覆盖）：

- T-DI1 — blocking: yes — `pickHostFileWithDialog` main 直调测试（照 `vfs-zip-export-name.test.ts` 直调 handler 模板）：showOpenDialog 取消 → null；选择 → 返回路径字符串（通道注册由 invoke/handler registry 的类型与绑定编译期锁定，不单测）。
- T-DI2 — blocking: yes — `VFS_FILE_EXPORT`：planBatchExport 收单元素数组、showSaveDialog defaultPath=basename、写盘 utf8、返回 saved；取消返回 cancelled；logicalPath 误传目录（files.length≠1）报错不写盘。
- T-DI3 — blocking: yes — `exportWorkspaceTarget` 编排：kind=file → invoke `VFS_FILE_EXPORT` 且 logicalPath=target.row.path；kind=dir/blank → invoke 既有 `VFS_ZIP_EXPORT` 且带 directoryPath（installInvokeStub 断言 channel+payload，无任何中间弹窗语义）。
- T-DI4 — blocking: yes — `startSingleFileImport` 两段式：pick 返回路径 → invoke `VFS_BATCH_INGEST_FROM_PATHS(overwriteConfirmed:false)` → needs_confirm → 返回确认请求（hostPaths/conflictCount）；`confirmSingleFileImport` → 二次调用 `overwriteConfirmed:true`（stub 断言两次调用参数）。
- T-DI5 — blocking: yes — `startSingleFileImport`：pick 取消（null）→ 静默返回零写入调用。
- T-Z1 — blocking: no — E2E case-zip-backup 更新后全流程通过（export 经 `export`、import 经 `import`+形式弹窗 zip）。

mobile 菜单（Step 5 执行——服务模块已由 Step 4 建好，`jest.mock` 不会引用不存在的模块；改写 `vfs-character-card-menu.test.ts` 源码契约、改 `vfs-file-manager.session.integration.test.tsx`（mock 分流特征 + 补 `vfs-single-file.service` jest.mock——该文件现状未 mock character-card 服务靠真模块加载，新服务同理可豁免，若组件直接 import 则补）/ `readonly.test.tsx`（服务 mock 清单补新服务））：

- T-MM1 — blocking: yes — dir 长按菜单与 more 菜单含「导入」「导出」，不含旧三项（源码契约重写为新常量断言；保持豁免理由）。
- T-MM2 — blocking: yes — file 行菜单含「导出」且在 `workplace != null` 门控内（无 workplace 的技能详情场景不含——补防泄漏断言）。
- T-MM3 — blocking: yes — readOnly 下三张 sheet items 全空（readonly 计数断言维持 0）。
- T-MM4 — blocking: yes — 点「导入」开第三张 sheet（items 三项：单文件/ZIP 包/角色卡，action file/zip/character-card）；选 zip/character-card 走既有 runImport 链（kind 传对）；dismissAllOverlays 覆盖新 state。
- T-MM5 — blocking: yes — `runImport` 三分支文案独立（Alert message 各异）；`export` 按 menuRow.kind 分流。

mobile 服务（新增 `vfs-single-file.service.test.ts`，照 vfs-zip.service.test.ts 模板：core spy + picker mock + blob-util mock；`document-io.test.ts` 补 `pickAndReadFileWithMeta` 用例——返回 {bytes, fileName}、fileName 空名兜底、取消 null、maxBytes+buildTooLargeError 成对预检）：

- T-MF1 — blocking: yes — 导入：pickAndReadFileWithMeta 返回 {bytes, fileName} → planBatchIngest 单 entry（relativePath=fileName、targetDir 透传）→ conflicts 非空返回确认请求（不 apply）→ 确认后 applyBatchIngest({overwriteConfirmed:true})。
- T-MF2 — blocking: yes — picker 取消（null）→ 静默返回不调 core。
- T-MF3 — blocking: yes — skippedBinary 非空 → 结果携带跳过信息（组件层 toast 明示）。
- T-MF4 — blocking: yes — 导出：planBatchExport 单元素 → exportBytesViaDocumentPicker（fileName=basename、mimeType=knownTypesForExtension 兜底 text/plain、write utf8）→ saved。
- T-MF5 — blocking: yes — session scope 导入成功后缓存清理经 core 生效（服务测试透传 scope 至 core spy 即可断言 scope.kind=session 已传——清理本体由 T-C1 锁）。

## 风险与回滚方案

- **E2E dialog patch 既有隐患**：case-zip-backup.mjs 的原生 dialog patch 返回旧式数组，与当前代码对象式读取不一致（该链路可能实际未完整跑通）——Step 6 顺带修正，若修正后暴露存量问题按实测归因不阻塞本迭代（标记既有）。
- **desktop scope 历史命名**：workspaceScope `"session"` 解析为 project（`resolve-vfs-scope.ts:30-34`），只有 `"chat"` 面板是真 session——R5 的 session 清理在桌面只有 chat 面板触发，与 zip 导入现状**同族一致**（PRD 风险项已声明口径）；T-C2 锁非 session 不动。
- **writer 路径与统一工具轮开关**：桌面 chat 面板导入在 `isUserVfsUnifiedToolTurnEnabled()`（默认开，`NM_USER_VFS_UNIFIED_TOOL_TURN=0` 可关）时实际走 writer 路径——D2 给 writer 签名加 scope 并同款清理正为覆盖它（T-C6 锁定）；关开关时走 apply 路径由 T-C1 覆盖，两条路都清。
- **mobile jest 走 core dist**（jest.config.js:109-112）：Step 4（mobile 服务与测试）前必须先重建 core dist，否则跑到旧码假绿/假红（RULE 既有坑）。
- **闭包时序**：mobile `handleEntityAction` 入口守卫依赖 BottomSheetMenu 先 onClose 再 onSelect 的闭包旧值——新分支沿用同模式（menuRow 在闭包内安全），不重构。
- **`handleWorkspaceAction` 未知 action 静默**（无 default 兜底）：新增 action 拼错无任何反馈——Step 3（App 分派接线时）顺手在尾部加穷尽断言或兜底 toast（可选加固，不扩大范围）。
- 回滚：迭代分支整体 revert 即可（无 DB migration、无 wire 格式变更、无 public 导出面变更）；菜单测试与 E2E 随分支回退。
