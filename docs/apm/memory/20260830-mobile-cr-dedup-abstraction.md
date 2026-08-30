# 2026-08-30 mobile CR 去重抽象 · waveB3 死代码清理

## impl-waveB3（cr/mobile-fix-wave1）

用户指派节点 impl-waveB3，按 `docs/Iterations/mobile-cr-dedup-abstraction/cr-fix-spec.md` 五条目（screens/C-9、web/C-1、comp-rest/C-8、tests/G-1、oq15）清理 apps/mobile 死代码：

- 删 `src/navigation/linking.ts`（仅导出 `linking = undefined`）、删 `screens/stack/ProvidersScreen.tsx` 与 `RegexRulesScreen.tsx` 的死导入 `Pressable`。
- 删 `src/web/code-editor/webview/runtime/editor.ts` 的 `setReadOnly` 死链：`readOnlyCompartment`、`buildExtensions` 的 `readOnly` 形参、`mountEditor` 的 `readOnly = false` 形参、尾部 `setReadOnly` 函数。bridge.ts 只导入 `blurEditor/mountEditor/setDocument`，本就没有 `setReadOnly` 调用点，无需改。
- 删 `src/components/form/FormErrorCard.tsx`、删 `__tests__/yaml-encode.service.test.ts`。
- `MessageActionMenu.tsx` 删三条 re-export（`messageActionMenuMaxHeight` 等）。注意：`__tests__/message-action-menu.test.tsx` 曾借道 re-export 使用布局函数（早前 grep 漏查 `__tests__` 才误判零引用），已改为从 `anchored-menu-layout` 直接导入 `computeAnchoredMenuWidth`/`layoutAnchoredMenu`。
- `AttachmentDraftChips.tsx` 删 `showRemove`/`onRemove` props、有叉分支、`removeSlot`/`removeText` 样式、`Pressable` import；`ComposerStatusChips` 同步删 `showRemove={false}`。`disabled` prop 保留（ChatComposer 仍传，且 mobile tsconfig 关了 noUnusedLocals/Parameters）。
- `message-blocks.ts` 抽 `isDisplayableAttachment(a)` 导出函数，`buildChatListItems` 与 `buildTranscriptRows` 两处 user_ops 过滤统一调用。

验收：`tsc --noEmit -p tsconfig.build.json` 零输出；`tsc --noEmit -p src/web/tsconfig.json` 通过；`jest --silent` 159 suites / 890 tests 全绿；删除项 grep（排除 tsbuildinfo）零残留。
教训：grep 残留检查务必覆盖 `__tests__`；include_pattern 需要 `**/` 前缀才能匹配带项目根的完整路径。

# 2026-08-30 mobile CR 去重抽象 · impl-waveC2

## impl-waveC2（cr/mobile-fix-wave1）

用户指派节点 impl-waveC2，按 cr-fix-spec 执行 web/C-orch-4、web/C-2、web/C-3、oq7/webview-host-merge 四条目：

- C-orch-4：菜单布局纯函数真源下沉 `src/webview-host/chat-transcript/anchored-menu-layout.ts`；`components/chat/anchored-menu-layout.ts` 改 `export *` re-export（调用点不动）；web `runtime/menu/menu.ts` 只留 DOM 取值 wrapper（`computeContextMenuWidth`/`layoutContextMenu` 委托 `computeAnchoredMenuWidth`/`layoutAnchoredMenuForHeight`，`ContextMenuLayout = AnchoredMenuLayout`）。新增 `__tests__/anchored-menu-layout-parity.test.ts`：RN re-export 与真源同函数引用断言 + WebView 旧公式黄金值。
- oq7：`src/web/webview-host/`（仅剩 mermaid-viewer-gestures.ts）整体迁入 `src/web/shared/mermaid-fullscreen/`（按归属），更新 MermaidViewerOverlay（仅 import 行）与 `__tests__/mermaid-fullscreen.test.ts`；删空目录；web tsconfig include 删 `webview-host/**`。
- C-2：新增 `webview/ui/render/CollapsibleSection.tsx`（`CollapsibleSection` + `CollapsibleHeader`，header title/chevron class 由 headerClass 前缀派生）；ToolGroup/AttachGroup 换用；StreamTail 与 ThinkingSection 的 thinking header 复用 `CollapsibleHeader`；StreamBodyHost 增量岛未动。
- C-3：snapshot.ts 四处内联 `scrollHeight-clientHeight-offsetY` 改调 `scrollTopForOffsetFromBottom`（自 `src/webview-host/chat-transcript/scroll` 相对导入）；删 `constants.ts` 的 `NEAR_BOTTOM` 别名，web scroll.ts 统一 `NEAR_BOTTOM_THRESHOLD_PX`；boot-script 契约测改断言 `not.toContain('var NEAR_BOTTOM =')`。

踩坑：并行节点同期把 `src/webview-host/chat-transcript/scroll.ts` 的常量导入改成 `@/` 别名（arch/C-4 风格统一），web tsconfig/esbuild 原本解析不了 `@/`。解法：web tsconfig paths 加 `"@/*": ["../*"]`、build-webview.mjs 的 webAlias 加 `'@': src`。另撞见并行节点搬 bridge.ts、改 rich-document main.ts 的中间态导致 jest/tsc 瞬时红，重跑即恢复——共享工作树下验收前要复跑确认终态。

验收（终态）：`tsc --noEmit -p src/web/tsconfig.json` 通过；`npm run build:webview` 成功；`jest` 161 suites / 901 tests 全绿。

# 2026-08-30 mobile CR 去重抽象 · impl-waveD1

## impl-waveD1（cr/mobile-fix-wave1）

用户指派节点 impl-waveD1，按 cr-fix-spec 执行 b2/B-1、b2/B-2、b2/B-3、b2/B-5 四条目（错误处理）：

- B-1：AgentPickerModal、ModelPickerModal、ProvidersScreen、RegexGroupsScreen 四处列表 reload 由 `try/finally` 吞错改为错误态——`error` state + catch 里 `setRows([])` + `setError(formatError(cause))`，失败渲染错误文案与重试按钮（对齐 FetchModelsSheet），空态只在真无数据时出现。
- B-2：两个 Picker 的 select 包 try/catch，失败 `showToast(toastMessage('设置失败', cause))` 并留在弹窗，写入成功才 `onSelected` + `onClose`。
- B-3：ChatConfigScreen 抽 `persistSwitchWithRollback(persist, rollback)`，四开关选「乐观更新 + 失败回滚」实现（已注释说明取舍），持久化 reject 时回滚开关并 toast「保存失败」。
- B-5：useAutoUpdateCheck 的 readUpdatesAutoCheck/readSnoozeUntil 挪进 try（`let snoozed = false` 提前声明，读偏好失败按未静音处理）；`persistFailedUpdateCheck` 显式 `.catch(() => undefined)`；handleSnoozeToday 包 try/catch + toast；showUpdateDetailAlert 的 `Linking.openURL` 补 catch + toast（对齐 AboutScreen openLink，需把 showToast 传进模块级函数）。

新增测试：`agent-picker-modal-error.test.tsx`（4）、`model-picker-modal-error.test.tsx`（4）、`providers-screen-error.test.tsx`（3）、`regex-groups-screen-error.test.tsx`（3）、`chat-config-screen-switch.test.tsx`（5）、`use-auto-update-check.test.tsx` 追加 B-5 用例（5）。

踩坑：① mock `@novel-master/core/provider` 时不能全量替换——`format-error.ts` 也从该入口 import `ProviderError`，工厂要用 `jest.requireActual` 展开再覆写，否则 `instanceof` RHS 变 undefined；② Screen 测试 mock `useFocusEffect` 不能每渲染都执行 cb（reload/refresh setState 会无限循环），要用 `useEffect(cb, [])` 语义挂载时跑一次；③ RN `Pressable` 会把 props 复制到内部 responder 节点，`findAll(testID)` 会命中多个，取第一个即可；④ `treeText` 找可点击节点会被 backdrop（包裹全部内容）抢先命中，要用跳过可点击后代的 `collectText`（fetch-models-sheet.test.tsx 已有样板）。

验收：`tsc --noEmit -p tsconfig.build.json` 零输出（exit 0）；`jest --silent` 170 suites / 941 tests 全绿。

# 2026-08-30 mobile CR 去重抽象 · impl-waveE2

## impl-waveE2（cr/mobile-fix-wave1）

用户指派节点 impl-waveE2，按 cr-fix-spec 执行 services/C-5、C-7、C-8、A-2、C-9、sec/D-2、oq18/sksp-platform 七条目：

- C-5：workplace-operations.service.ts 的 `batchSetDirRulesEnabled/Disabled` 合并为 `batchSetDirRulesEnabled(workplace, paths, dirPaths, enabled)`（src 无调用方，仅两个 vfs-file-manager 测试 mock，删掉 Disabled 行）；vfs-operations.service.ts 四 rename 函数保留单一实现——`renameVfsFile` 实现体不动，`renameVfsDirectory`/`sessionRenameVfsDirectory` 改 `export const xxx = renameVfsFile`（session 版别名为 sessionRenameVfsFile），VfsFileManager 调用点零改动。
- C-7：agent-picker.ts 抽私有 `loadAgentRows(runtime)`（listAgentIds 循环 + subagent 过滤 + 名字兜底），`loadAgentPickerRows`（state.getCurrentAgentId）与 `loadSessionAgentPickerRows`（sessionConfig.agentId）各取 currentId 后组合。
- C-8：useAgentStreamMetrics.ts 新增私有 `useTicker(running)`（250ms setInterval + cleanup），`useAgentStreamMetrics` 改组合 `useStreamMetricsAcc(running)` + `useTicker(running)`；删 `snapshotFromAcc`/`toView`/`emptyAcc` 三个纯转发包装，直调 `snapshotMetricsAcc`/`toAgentStreamMetricsView`/`emptyMetricsAcc`。
- A-2：stream-apply-buffer.ts 两处 `@/services/stream-wire-queue` 改相对导入 `./stream-wire-queue`。
- C-9：`CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION` + `ChatTranscriptScrollSnapshot` 下沉到 chat-transcript-scroll-cache.ts 自身；ChatTranscriptBridge.ts 改从 service 导入并 re-export（ChatTranscriptWebView 等既有 import 路径不动）。坑：service 里旧的 `export type {...}` 行与新定义撞 TS2484，删掉即好。
- D-2：resolve-latest-release.ts 的 `mapReleaseJson` 加域名校验——htmlUrl 必须以 `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/` 开头否则 throw（`发行版链接域名校验失败`），单测喂 `https://evil.example/...` 断言 rejects。
- oq18：create-mobile-runtime.ts 的 `resolveSkspDriver('android')` 硬编码改经新 helper `mobileSkspDriverName()`（独立小文件 `src/runtime/mobile-sksp.ts`，仅依赖 react-native 的 Platform.OS；非 android 抛含平台名的中文错误）；测试 `__tests__/runtime/mobile-sksp.test.ts` 用 `jest.mock('react-native')` 模拟 iOS 平台断言报错文案 + android 直传用例。选独立小文件是为避开 create-mobile-runtime 的重依赖链（db/connection 等）在 jest 下 import 炸的问题。

踩坑：① `create_directory`/`write_file` 对 `apps/mobile/__tests__/runtime` 报 outside project / 目录不存在（工具视图未刷新），用终端 mkdir + heredoc 绕过；② update-check 不在 services/ 下而在 `src/update-check/`，ChatTranscriptBridge 是 `.ts` 不是 `.tsx`，find_path glob 大小写敏感要先确认文件名。

验收：`tsc --noEmit -p tsconfig.build.json` 零输出；`jest --silent` 173 suites / 969 tests 全绿；grep 确认 `src/services/**` 无 `../components` / `@/components` 反向导入。

# 2026-08-30 mobile CR 去重抽象 · impl-waveE1

## impl-waveE1（cr/mobile-fix-wave1）

用户指派节点 impl-waveE1，按 cr-fix-spec 执行 services/C-2、services/C-3、services/C-4、services/A-1、oq17/backup-notice 五条目（范围 apps/mobile/src/services）：

- C-3+A-1：新建 `services/rn-file-io.ts` 收编 `localUriToFsPath`/`toFileUri`/`base64ToBytes`/`bytesToBase64`（分块）+ 同族 `bytesToAsciiString`；`blobFs()` 从 yaml-shared 挪入统一用。查证结论：git -S blobFs 仅命中初始 graft 提交 v1.4.21（无独立动机提交），函数注释自述动机为「测试环境/不同 bundler 下 CJS/ESM 双形态」；测试套件里确实两种 mock 形态并存（agent-yaml 用裸 `{fs}`、db-backup/vfs-zip 用 `__esModule+default.fs`），适配真实需要，故选「挪入统一用」而非删除。四个 service 的 fs 访问全部改走 `blobFs()`。
- C-2：新建 `services/document-io.ts`：`exportBytesViaDocumentPicker({fileName,mimeType,write,copy?})`（CacheDir 临时路径 + saveDocuments + isUserCancelledPick + finally unlink）；导入侧 `pickToLocalPath`（pick → assertFileName → keepLocalCopy → localUriToFsPath）、`pickAndReadBytes`（+exists/base64 读）、`pickAndReadText`（utf8，yaml 用）。各域错误类型经 `buildCopyError`/`buildMissingError` 回调注入；db/zip 用固定落盘名（localFileName）、card/yaml 用所选项名+兜底（fallbackLocalFileName），保持原行为。
- C-4：`knownTypesForExtension` 两份合一进 document-io，两个 *-document-pick.ts 改导入。
- oq17：StorageConfigScreen 导出无确认弹窗，按拍板在成功 toast 加提示：「数据库已导出；备份文件包含聊天记录明文，请妥善保管」。
- 行为微调（有意）：yaml-shared 导出原来不查 saveDocuments 结果条目的 error 字段，统一后与 db/zip 一致会抛错（原是掩盖失败的遗漏）；db-backup 导出 copy 仍传 `Platform.OS === 'ios'`，zip/yaml 默认 true，与原状一致。

新增测试：`__tests__/rn-file-io.test.ts`（中文 decodeURIComponent、base64 roundtrip、blobFs 双形态+缺失抛错）、`__tests__/document-io.test.ts`（导出成功/取消/结果 error 三分支均 unlink、copy 透传、取消不触发 keepLocalCopy、落盘名固定/兜底、错误映射、中文 localUri 解码、utf8 读）。

范围外发现（未动，供后续）：`src/db/db-file-path.ts` 有一份私有 blobFs 副本；`cloud-sync.service.ts` 仍裸用 ReactNativeBlobUtil.fs。

验收：`npx tsc --noEmit -p tsconfig.build.json` 零输出；`npx jest --silent` 173 suites / 969 tests 全绿。

## waveF2（impl-waveF2，分支 cr/mobile-fix-wave1）：screens/C-2 + screens/C-8

- C-2：新建 `components/chrome/AndroidKeyboardClipBody.tsx` 统一持有四处逐字复制的 Android 键盘裁切样式与「hook 返回负值取反」注释（children slot）。四处替换：ChatConversationPanel（原 AndroidKeyboardChatBody 多 slot 收敛为 children：header 留裁切窗外，transcriptHost+composer 进 children）、FileEditorScreen、PromptEditorScreen（删各自局部 Body 组件）、ChatHistorySearchScreen（原 root 直挂 clipStyle 改为组件包裹，顺带获得统一 overflow:hidden 裁切）。
- C-8：新建 `components/chrome/EditorScreenShell.tsx`（泛型 T）：props 为 save（testID/label/disabled/onPress）、title+titleDanger、titlePress（FileEditor 聚焦态点按收键盘变体）、toggle（isReadOnly 不传即不渲染）、toolbarExtra（stats 行）、segmented、previewMode、preview/editor slot、toolbarBorderColor（两屏 tokens.border/borderLight 差异保留）。FileEditorScreen 与 PromptEditorScreen 换用；键盘三分支（预览直铺/Android 裁切/iOS KAV padding）收进 shell 并复用 C-2 组件。
- 有意的微小视觉统一：FileEditor toolbar 按钮字重统一为 14/600、标题 13 号（原为默认字号）；testID、禁用逻辑、未保存 danger、保存禁用与未保存拦截行为不变。
- 踩坑：T-F6 断言 CodeEditorWebView props.style 深等于 {flex:1,minHeight:0}，去重时不能顺手删 FileEditor 的 styles.editor。
- 验收：tsc 零输出；jest 172/173 suites 绿（regex-groups-screen-error 3 例失败属并行节点在改的 RegexGroupsScreen.tsx，非本节点域）；file-editor/prompt-editor/chat-history-search 三条回归底线 32 例全绿。

## waveF1（impl-waveF1，分支 cr/mobile-fix-wave1）：screens/C-1 + C-12 + C-11 [L94-102]

# 2026-08-30 mobile CR 去重抽象 · impl-waveG3

## impl-waveG3（cr/mobile-fix-wave1）：comp-rest/C-4 + oq3/manageheader-merge

- comp-rest/C-4：VfsFileManager（1356 行）拆分——新建 components/vfs/vfs-file-manager/：VfsPromptModal（重命名/新建单输入弹窗，含键盘避让与样式）、VfsMoveDirPicker（FileReferencePicker 定向包装）、styles.ts（列表样式 + vfsBatchHeaderWrapStyle）。主文件仅保留列表/规则/导入导出逻辑，prompt 输入态内聚到弹窗组件。ModalShell 尚未被并行节点创建，弹窗骨架保持 AppModal。
- oq3：ManageHeader 操作区 actions 数组化（ManageHeaderBatchAction：label/onPress/tone/disabled，批量模式统一 selectedCount===0 禁用，可 per-action disabled 覆盖）；title/onEnterBatch 改可选以支持批量专用场景；新增 style prop 吸收 padding 差异（VFS 12/10 vs 默认 5/12）。VfsFileManager 换用 ManageHeader（actions 含「移动」），删除 VfsBatchHeader.tsx；vfs-batch-header.test.tsx 迁移为 manage-header-batch-actions.test.tsx（两用例：count=0 禁用、count>0 触发 onMove）。
- 验证：定向 jest 4 套全绿（readonly/session.integration/select-all/batch-actions）；全量 jest 173/177，失败的 4 套（chat-history-search、keyboard-avoid-android、agent-editor-form ×2）均为并行节点 C-2/C-3 半成品；tsc 全量报错亦全在并行节点文件（useAgentEditorFormState、AgentPickerModal、RegexGroupsScreen 等），排除 agent-editor 后本节点文件零报错（tsconfig.waveG3-probe 验证后已删）。

- C-1：新建 `hooks/useFocusListReload.ts`（rows/loading/error/reload/setRows + useFocusEffect；fetcher 抛错默认进 error 态清空 rows 配重试，传 onError 则走 toast 语义且 rows 不动；fetcher 返回 null/undefined 兜底 fallbackValue；focusSilent 对齐 SkillPanel 静默聚焦；setRows 供行内乐观更新）、`hooks/useBatchDeleteConfirm.ts`（title/message(items)/deleteOne/onDone，Alert 确认→顺序删除，中途失败 toast 删除失败不回调 onDone=部分成功语义）、`screens/shared/list-screen-styles.ts`（root/listContent/loader/empty 四样式）。六屏迁移：Providers、RegexRules、RegexGroups、SkillsSettings、ProviderDetail、SkillPanel。SkillsSettings 三份列表打包成 payload 塞进泛型 hook；RegexRules/ProviderDetail 的 setStackOverride 失焦清理拆成独立 useFocusEffect。
- C-12：RegexGroupsScreen 手写工具栏换 ManageHeader，「当前正则组」卡放 FlatList ListHeaderComponent；行改为逐行卡片（原 listPanel 大卡+分隔线视觉调整为 rowCard 列表），isLast/borderBottom 逻辑删除。
- C-11：SubagentSessionScreen 初载 effect 改 `reload().finally(() => setInitialLoading(false))`（cancelled 守卫随整段删除）；ChatTabProvider meta effect 删多余 projectId 依赖；MODEL_LOCK_TOAST/AGENT_LOCK_TOAST 收敛进 services/chat-agent-meta.ts（AGENT_LOCK_TOAST_GUIDE=会话面板引导语 / AGENT_LOCK_TOAST_STATEMENT=详情页陈述，注释言明有意分化）。ChatConversationPanel 属并行节点域未动，其局部 AGENT_LOCK_TOAST/MODEL_LOCK_TOAST 副本待该节点替换 import。
- 行为微调（有意）：ProviderDetail/SkillPanel 等原 toast 屏经 onError 保持 toast 语义；ProviderDetail 新增 error+重试分支（fetcher 抛错才出现）。
- 新增测试：`__tests__/use-batch-delete-confirm.test.tsx`（确认/取消/中途失败/空集 4 例）；`regex-groups-screen-error.test.tsx` 补 ManageHeader mock（C-12 引入所致）。
- 验收：tsc -p tsconfig.build.json 零输出；jest --silent 174 suites / 973 tests 全绿。

## waveG2（impl-waveG2，分支 cr/mobile-fix-wave1）：comp-rest/C-3

- `AgentEditorForm.tsx` 1447 行 → 360 行满编排层；新建 `components/agent/agent-editor/` 目录 12 文件：`useAgentEditorFormState.ts`（440 行，20 个表单字段 useState 收敛为单 form state 对象，formSnapshotJson(form) 单参；providers/savedModels/savedBaseline/loading/invalidConfig 等元状态 + loadAgent/populate 管线 + persist/dynamic 块级操作都在 hook 内；块级操作保持拆分前的普通函数形态）、`agent-editor-form.styles.ts`（底部 styles 原样搬出）、`agent-editor-types.ts`（AgentEditorTokens）、section 子组件：Basic/Model/Tools 三个 section + InvalidCard（损坏/加载失败恢复卡）+ PromptLayoutSection（四区布局，system/skills/workplace/chat 内联）+ PersistBlocksCard/DynamicBlocksCard + PromptSectionHead/PromptBlockActions。
- setPersist/setDynamic 包装函数式更新，返回同引用时保持 form 引用不变（维持原 setState bail-out 渲染语义）；patch 为不含块字段的 AgentEditorFormPatch。
- 有意微修：原 snapshot useMemo 依赖数组漏了 mode，收敛为单对象后顺带修正（改作用域现在能正确标 dirty）。
- 测试适配：`agent-editor-form-tool-count.test.ts` 是源码正则锁，formPath 改指 `agent-editor/AgentEditorToolsSection.tsx`（工具计数文案随工具策略区迁居，锁文案意图不变）。
- 验收：本节点域 tsc 零错误（全仓残余错误均属并行节点在改的 AgentList/AgentPickerModal/ProjectDrawer/RegexGroupsScreen/ChatTabScreen）；agent-editor-form-dirty/tool-count/delete-confirm 三套件 10 例全绿；jest --silent 174/176 suites、986/986 tests，仅剩 tool-policy-picker 与 keyboard-avoid-android 两套件挂在 `@novel-master/core/skills` 模块解析（引用链 ThemeProvider→create-mobile-runtime，并行节点域，非本次改动）。

## waveG4（impl-waveG4，分支 cr/mobile-fix-wave1）：comp-chat/C-1 ChatComposer token 插入去重

- 新建 `components/chat/composer-token-insert.ts`：`buildTokenInsertion(text,cursor,replaceStart,token)` 纯函数（token 为 string 或 readonly string[]，多 token 空格连接；前段非空且无尾空白补前导空格、后段空或非空白开头补尾空格、光标落插入段末尾）+ `statusOnlyComposerAttachments`（draft 只留 workplace/user_ops 状态 chip）。
- ChatComposer 收敛：新增 `commitComposerText(next,cursor?,{mention?})` 统一「atPathInputRef.replaceCommittedText 优先 / 纯文本 setText+persistDraft(statusOnly)+setCursor」；四个回调（insertTokensIntoComposer/insertSkillToken/applyTypeaheadToken/applySkillTypeaheadToken）与 onChangeText 全部改调上述函数。typeahead 路径由 `replaceActiveAtWithToken` 换 `buildTokenInsertion`，等价性靠 findActiveAtQuery 保证触发字符前必为空白（前导空格恒空）。
- 踩坑：onChangeText 不能走 mention 分支——replaceCommittedText 会回调 onChangeText，再查 ref 就无限递归（集成测试 T-PM5 炸 Maximum call stack），故加 `mention:false` 开关只做纯文本提交。
- `resolveComposerSendIntent` 用 useMemo 求一次 `sendIntent`，send 与 sendDisabled 共用；顺带删掉 ChatComposer 里已无引用的 replaceActiveAtWithToken 导入。
- 新增测试：`__tests__/composer-token-insert.test.ts`（@ 选择器/$ 选择器/@ typeahead/$ typeahead 四路径 + 换行尾不补前导/后段空白开头不补尾/空文本边界 + statusOnly 过滤，7 例）。
- 验收：composer 相关套件（chat-composer.integration/composer-at-path/chat-composer-draft/project-composer-status-clear/composer-token-insert/composer-dock-padding）全绿共 22 例；全量 jest 172/176 suites 绿，4 个失败套件（vfs-file-manager×3、chat-history-search-screen）属并行节点在改的 VfsFileManager.tsx/ChatHistorySearchScreen.tsx；tsc 剩余报错同样全在并行节点在途文件，本节点文件零报错。

## waveG5（impl-waveG5，分支 cr/mobile-fix-wave1）：collapsible-rn + comp-chat/C-2,C-4,C-5,C-7,C-9 + F1 收尾

- collapsible-rn：新建 `components/ui/CollapsibleCard.tsx`（受控 expanded/onToggle、非受控 defaultExpanded 两用；title/summary（仅收起态）/children（仅展开态）；collapsible=false 表达短内容锁定态；pressArea card/header 两档（结果卡整卡可按）；showChevron/showDividerBelow（hairline divider 三份收敛进来）；style/headerStyle/contentStyle/chevronStyle 覆写点；accessibilityRole button + accessibilityState expanded 保留）。四处替换：ThinkingBlockCard（保留自有 expanded 态供 useRich 判断）、ToolCallGroupCard（divider 由容器移到内容包装层，embedded 视觉等价）、PromptPreviewSegmentCard（role+title 进 title、preview+字数进 summary、headerStyle flex-start + chevron paddingTop 4）、ChatHistorySearchScreen（表单卡受控 + MessageResultCard pressArea=card/collapsible=canExpand/showChevron=false，展开全文/收起文字提示折进 summary/children）。
- 踩坑：react-test-renderer 的 findByProps({testID}) 深度优先会先命中外层 CollapsibleCard 元素自身的 testID prop（而非内部 Pressable），chat-history-search-screen 测试 5 处 onPress/accessibilityState 查询全炸；测试侧加 findCardPressable helper（findAllByProps 取带 accessibilityState 的节点）修复，组件 API 保持 testID 转发不动。
- comp-chat/C-2：MessageActionMenu 删本地 MessageActionMenuItem，改 `import type` 自 message-edit 并 `export type` re-export。
- comp-chat/C-4：新建 `components/chat/TypeaheadList.tsx`（容器 accessibilityLabel+children+样式合一，另导出 typeaheadItemStyle 行基础内边距）；AtPathTypeahead/SkillTypeahead 删各自 list/item 容器样式只留行渲染，skill-typeahead-* testID 保留。
- comp-chat/C-5：message-blocks 删本地 TranscriptStreamState 声明，改自 ChatTranscriptBridge import + re-export（无循环：bridge 不反向依赖 message-blocks）。
- comp-chat/C-7：FileReferencePicker 抽局部 confirmPickDirectory()（mode 守卫 + cwdBlocked 拦截 + onConfirmDir+onClose），selectCurrentDir 与 handleConfirm 共用。
- comp-chat/C-9：hideToolTurn 收敛单路径——setVisibility 闭包（hide/show 二选一）+ resultsId 统一解析，成对 tool_result 同步语义不变。
- F1 收尾：ChatConversationPanel 删本地 AGENT_LOCK_TOAST/MODEL_LOCK_TOAST 副本（含夹在 import 区的常量块），改 import services/chat-agent-meta 的 AGENT_LOCK_TOAST_GUIDE/MODEL_LOCK_TOAST。
- 验收：本节点全部文件 tsc 零报错（全量剩余报错均在并行节点在途文件：AgentList/AgentPickerModal/useAgentEditorFormState/ProjectDrawer/RegexGroupsScreen/ChatTabScreen）；jest 175/176 suites 绿，唯一失败 keyboard-avoid-android 系并行节点删 AddModelModal/EditModelNameModal 后其测试 import 未更新，非本节点域。

# 2026-08-30 mobile CR 去重抽象 · impl-waveG1

## impl-waveG1（cr/mobile-fix-wave1）：comp-rest/C-1、C-2、C-5、C-6、C-7

用户指派节点 impl-waveG1，按 cr-fix-spec 的 comp-rest 五条目重构 apps/mobile/src/components/**：

- C-1：新建 `ui/ModalShell.tsx`——AppModal + 透明遮罩（absoluteFill 按压关闭）+ panel 定位（center/bottom/left 抽屉）+ 键盘避让策略（none/translate=fraction/adaptive=maxHeightRatio+iosTranslateY），standalone 模式供 FormOverlayHost 体系（ToolPolicyPicker）嵌入。逐个替换条目所列 15 个文件（VfsFileManager 跳过、UpdateCheckResultModal 保持独立）。遮罩色单源 rgba(0,0,0,backdropOpacity)，BottomSheetMenu 传 0.55 保像素。
- C-2：TextPromptModal 加 variant 'center'|'bottom' 与 fields（1–2 输入，optional 语义）后删 AddModelModal/EditModelNameModal，ProviderDetailScreen 改传 fields。onConfirm 改为 (values: string[])，连带改 ProjectDrawer/AgentList/ChatTabScreen/RegexGroupsScreen 四处调用方。
- C-5：抽 `ui/PickerListModal.tsx`（load 返回 {rows, selectedId}；错误态+重试保留 b2/B-1 语义），AgentPickerModal/ModelPickerModal/SkillPicker 退化成数据适配，行容器/空态/取消按钮由骨架承担；getRowProps 保 testID/accessibilityLabel/行透明度。
- C-6：BottomSheetMenu 的 SheetMenuItem 加 disabled（置灰 textTertiary 不可点），删 chrome/SessionActionsDrawer，ChatConversationPanel 换用 items+onSelect。
- C-7：抽 `ui/card-styles.ts`（card/cardRow/cardSurface/iconWrap/chevron），ProfileMenuItem 改组合 ElevatedCard，ProfileSwitchItem/FormSectionCard 复用共享样式。

测试同步：keyboard-avoid-android 的 AddModel/EditModel 用例改 TextPromptModal variant=bottom；tool-policy-picker 源码契约改断言 maxHeightRatio:0.75+iosTranslateY；chat-conversation-panel.integration 补 AgentPickerModal/BottomSheetMenu/ThemeProvider mock（该文件并行节点同时在改，注意合并）。

验收：tsc --noEmit -p tsconfig.build.json 零输出；jest --silent 176 suites/997 tests 全绿；条目内文件 rgba(0,0,0 零残留（chat/**、FormSelectField、RegexGroupPickerModal、VfsPromptModal 等条目外/并行域文件保留）。

教训：泛型组件 PickerListModal 的 isSelected 回调若直接传外部函数，T 会从该函数参数反推成 string，需显式 <PickerListModal<Row>>；jest mock 的模块路径与被测组件 import 写法（'@/' vs 相对）要解析到同一绝对路径才生效。

# 2026-08-30 mobile CR 去重抽象 · impl-waveH1

## impl-waveH1（cr/mobile-fix-wave1）：infra/C-1、C-2、C-5、C-6、C-7 + arch/C-3

用户指派节点 impl-waveH1，按 cr-fix-spec 六条目修复（appUiKeys typed helper 已在前波删除，C-2 只剩 key 迁移）：

- infra/C-1：新建 `storage/app-ui-pref-io.ts`，提供 readEnumPref(appUi,key,allowed,fallback)/readBoolPref/writeBoolPref。读侧统一含 try/catch（非法值与 KKV 异常都回退默认）；写侧 warn 后 rethrow——AboutScreen/ChatConfigScreen 靠 reject 做失败 toast/回滚，吞掉会让持久化失败静默。五个偏好文件（chat-transcript-engine、vfs-markdown-preview-engine、chat-stream-batch-pref、chat-rich-text-pref、update-prefs）改薄封装；rich-text 原本无 try/catch，此次统一口径。新增 `__tests__/app-ui-pref-io.test.ts` 覆盖非法值/get 抛错/appUi null 三分支及写失败传播。
- infra/C-2：三个散落 key（chatStreamBatchEnabled、chatTranscriptEngine、vfsMarkdownPreviewEngine）迁入 `storage/app-ui-keys.ts`，原文件改 import；旧常量无外部消费方，直接删导出。app-ui-keys.test.ts 补 key 清单断言。
- infra/C-5：db/connection.ts 的 open/bootstrap 两段 cause 链日志抽 logCauseChain(label,err) 私有函数（bootstrap 分支的 cause 行文案随之带上前缀，行为不变）。
- infra/C-6：create-mobile-runtime.ts 的 lazyCompactionConditionEvaluator 提 getOrCreateEvaluator() 内部函数，两委托方法共用。
- infra/C-7：novel-master-context.tsx 的 errorMessage 硬编码 color:'#666' 改 tokensForMode(useColorScheme()).textSecondary；组件在 ThemeProvider 外，useColorScheme 在组件顶层调用；RN 的 ColorSchemeName 含 'unspecified'，需归一为 'light'|'dark' 再传 tokensForMode。
- arch/C-3：core 的 public/compaction.ts 补 re-export DEFAULT_HIDE_START_DEPTH（mobile 的 tsc/jest 都解析到 packages/core/dist，改 src 后必须重跑 npm run build -w @novel-master/core），ChatConfigScreen 的 hideStartDepth:6 与 useState('6')、fallback '6' 一并改用该常量。

验收：tsc --noEmit -p tsconfig.build.json 零输出；jest --silent 177 suites/1009 tests 全绿。

教训：终端工具的 command 里带 $? 这类 shell 变量会被拒收（tool input was not fully received）；readEnumPref 的 includes(raw) 需先判 raw != null（string|undefined 不能直接传 readonly string[].includes）。

# 2026-08-30 mobile CR 去重抽象 · impl-waveH3

## impl-waveH3（cr/mobile-fix-wave1）

用户指派节点 impl-waveH3，按 cr-fix-spec 执行 tests/G-2、tests/G-5、tests/G-6、oq14/align-tests 四条目（只加测试与 jest 配置，不改实现）：

- G-2：新增 `__tests__/cloud-sync-config.store.test.ts`（内存 Kkv + SKSP fake，17 用例：默认装载、KKV 往返含 normalizePrefix 尾斜杠、损坏布尔/rev 与缺字段容错、校验失败零写入、buildS3StorageConfig overrides）+ `__tests__/cloud-sync-config.service.integration.test.ts`（service×store 均不 mock，3 用例走不触网短路路径）。
- G-5：新增 `__tests__/vfs-operations.service.test.ts`（FakeVfs 内存树 + userVfsTurn.executeOp 记录器，14 用例：move/rename 冲突 ALREADY_EXISTS 且内容不变、批量删除部分失败 fail-fast、VFS 删除失败不清 worktree、尾斜杠归一化、session op 编排、save no-op）。
- G-6：jest.config.js 加 `collectCoverageFrom:['src/services/**','src/storage/**','src/hooks/**','src/runtime/**']`（无阈值），`jest --coverage` 出报告不阻塞。
- oq14：新增 `__tests__/decode-entities-parity.test.ts`——RN decode-literal-html-entities 与 web/shared/decode-entities 同输入一致性 + toMatchSnapshot；LANG_ALIAS 与 desktop FENCE_LANG_ALIAS 无法跨包 import（tsx + 模块私有 const），按夹具双写断言相等，测试头注明三处同步义务。

踩坑：① core-shim 只导出 VfsError/isVfsError 不导出 vfsNotFound 工厂，fake 需自建 VfsError('NOT_FOUND')（isVfsError 按 name+code 匹配跨实例安全）；② 集成用例 configured=true 时 getCloudSyncStatusView 会真调 readRemoteRev，blob-util 全局 stub 的 fetch 返回 undefined 使 S3 请求永久挂起（测试通过但 jest 不退出），解法：文件内 jest.mock('@aws-sdk/client-s3') 使 send 立即 reject，走 service catch 兜底 remoteRev=0，同时把「不触网」意图钉进测试。

验收：`tsc --noEmit -p tsconfig.build.json` 零输出（__tests__ 按约定不进 build 范围）；`jest --silent` 181 suites / 1049 tests 全绿（新增 4 文件 40 用例 + 1 snapshot）。

user:
search 工具有 bug，会返回过多内容。

assistant:
实锤：这是子代理爆上下文的主因（Wave B 三连挂、Wave H 的 H2/H4 挂均与此相关）。对策升级：搜索密集型任务的派发指令明确禁用内置 search/grep 工具，改用终端 grep -rl（只列文件名）+ sed -n 定点读片段，输出 head_lines 截断。后续会话默认遵守。

# 2026-08-30 mobile CR 去重抽象 · impl-waveH2

## impl-waveH2（cr/mobile-fix-wave1）：arch/C-1、C-2、C-5、oq12 + 两弹窗换 ModalShell

用户指派节点 impl-waveH2（禁内置 search/grep、终端 grep -rl 定位），按 cr-fix-spec 四条目 + 顺带项修复：

- arch/C-1：新建 `navigation/ChatTabNavContext.tsx` 承载三个 ChatTabNavigation* 类型 + context + 两个 hook；screens 侧 ChatTabNavigationProvider 只聚合并写入，AppHeader/ChatTabScreen 改从 navigation 层读。components 下 screens import（含 @/ 别名）零匹配。
- arch/C-2：FetchModelsSheet 头注释删「对齐 desktop FetchModelsModal」失实表述。
- arch/C-5：TemplatePullButton 并入 components/prompt/（template 目录删除）；Profile* 三件迁 components/profile/（card-styles/ElevatedCard 留 ui/，import 改 ../ui/）；src/provider/model-display-label.ts 并入 services/ 后删空 provider 目录。
- oq12：拆 `services/update-check-flow.ts`（检查/snooze/持久化纯编排，toast/Alert/弹窗经 UpdateCheckSideEffects 注入，B 轮错误处理语义原样保留）+ 薄 hook `useAutoUpdateCheck(ui)`（ui 走 ref 防 2s 定时窗口被 cleanup）；modal 渲染挪 `components/update/UpdateCheckHost.tsx` 挂 App 根 ToastHost 内；UpdateCheckResultKind 单源在 service，modal 改 re-export。顺手把 useBatchDeleteConfirm 的 useToast 换 showAppToast 桥（hooks 运行时不再依赖 components；useVfsBackNavigation 剩纯 import type）。
- 顺带：VfsPromptModal/RegexGroupPickerModal 换 ModalShell（center+translate 0.5+offset 24 / bottom+none），UpdateCheckResultModal 未动（仅类型 re-export 与头注释宿主表述）。

验收：tsc --noEmit -p tsconfig.build.json 零输出；jest --silent 181 suites / 1049 tests 全绿（app-header/use-auto-update-check/use-batch-delete-confirm 及 vfs/chat-agent-meta 等测试的 mock 路径同步更新）。

# 2026-08-30 mobile CR 去重抽象 · impl-waveH4

## impl-waveH4（cr/mobile-fix-wave1）

用户指派节点 impl-waveH4，按 cr-fix-spec 执行 oq21/typed-eslint 与 tests/G-3：

- oq21：`apps/mobile/eslint.config.mjs` 对 src/services、src/runtime、src/storage 加 typed block（projectService: true + tsconfigRootDir: import.meta.dirname），开 no-floating-promises / no-misused-promises（warn）。RN flat 基线已注册 @typescript-eslint 插件，无需新依赖（根 node_modules 的 typescript-eslint 经 base.mjs 链路可达）；探针文件验证规则生效，三目录现有代码 0 命中 → --max-warnings 306 基线不动。
- tests/G-3 三处改行为断言：directory-rule-sheet.test.ts→.tsx（TestRenderer 渲染断 flexShrink:1 收缩容器，mock 范式抄 keyboard-avoid-android：AppModal 换透传 View）；agent-editor-form-tool-count.test.ts→.tsx（渲染 default 模式断提示文案，mock ThemeProvider 剪断 runtime 链）；tool-policy-picker.test.tsx 的 C-1 describe 改为打开 sheet 后断 ModalShell 的 keyboardAvoid props（standalone + adaptive + iosTranslateY）。豁免注明：provider-detail-tabs、vfs-character-card-menu、new-skill-modal-contract、session-detail-screen（仅 T-SD2 describe）、message-menu-entry（仅 MessageList 段）、code-copy（仅 T-CB22 跨 WebView 接线段）。webview 脚本类（boot-script×2、annotate×4、mermaid×2、web-host-message）保留，文件头均已有注明。

验收（终态）：jest 181 suites / 1049 tests 全绿；tsc -p tsconfig.build.json 零输出；eslint 343 problems（22 err / 321 warn）与本次改动前完全一致（0 新增）。22 个 error 全是 screens/components 的 react-hooks/exhaustive-deps 存量（未改文件也报，HEAD 即有），+15 warn 来自并行波次未提交的源码改动（如 mermaid-core 未用导入）。
教训：jest 不解析 .ts 里的 JSX，含 JSX 的测试必须 .tsx（连带更新源码注释里的测试文件名引用）；AppModal 的 useIsFocused 在无 NavigationContainer 时为 false 会把 Modal 渲染成 null，测 ModalShell 体系必须 mock '@react-navigation/native' 或直接 mock AppModal；TestRenderer.create 触发 effect 的要用 act() 包住，否则环境 teardown 后还在渲染报 "import after teardown"。

assistant:
（全量完成）8 波全部执行完毕，fix-spec 30 P1 + 69 P2 = 99 条闭合，分支 cr/mobile-fix-wave1 共 19 个提交（4ba1c73..f466efa）。终验：tsc 零输出、181 套件/1049 用例全绿（基线 165/906）、format:check 全绿（CI blocking）。终轮 cr-func 抽验 15 条 14 ✅，逮到两个收口项（波次后 252 文件格式回归、G-4 缺 win32 分支）已修。手工 QA 待办：真机链接外跳+伪造桥消息、五屏键盘回归、导出导入取消分支、nightly Android 实跑。单独立项四项记在 iteration-state。经验：①并行波次后必须重跑 format:check（每波都该验，不能攒到最后）；②prettier --write . 会污染 webview-dist 构建产物，.prettierignore 必须先建；③巨屏拆分类任务（1149 行+）单独派节点，混多个大文件必爆上下文。

user:
清理下 migration 代码，可以清理距离现在 10 tag 以前的迁移代码，没有就不清理。

assistant:
有得清：packages/core/src/bootstrap/schema-migrations/ 的 runner 里 3 条早于 v1.4.27 分界（vfs-entry-id-redesign-v1、session-agent-config-v2、project-agent-config-cleanup-v1）退役，加上此前已退役留档的 6 条一并物理删除（git 历史即冷回放档案）。沿用仓库既有惯例：ID 并入 BASELINE_MIGRATION_IDS（9 条字面量）+ 三个新 legacy 探针 + 最低支持版本 v1.4.08→v1.4.27 + fail-fast 文案更新。关键坑：①3 个 blob ref_count 触发器原本靠被删的 entry-id 迁移在新库 ensure，canonical DDL 故意不含——已并入 vfs-revision-schema.ts 否则新库无触发器；②entryIdApplied/_entryIdMigrationJustApplied 安全网整块死代码删除；③H1 给 core/public/compaction 加的 DEFAULT_HIDE_START_DEPTH re-export 漏更新了 package-exports 快照（core node:test 此前从没跑过才漏网），快照补齐；④core 的 npm test 通配 !(performance) 在 sh 下语法错，须 bash -O extglob 跑。终验 core 1781/1781、mobile 1049/1049 全绿。
