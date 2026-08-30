# CR Fix Spec: apps/mobile 去重与组件抽象（重复代码/组件抽象/ts-tsx 混用）

## 元信息

- repo：novel-master
- base_sha：0b42543 / head_sha：0b42543（现状全量评审，非 diff）
- prd_path / spec_path：未提供（现状质量评审）
- review_round：4（round 1 = 七个 scope 并行评审；round 2 = review-full 全局校验；round 3 = 五个 readonly 专项评审；round 4 = review-full 复核第 3 轮追加）
- dag_version：7（v1 初始六节点；v2 comp-chat 拆分重派 + services 新会话重派；v3 两批 spec-fix + review-full + trivial 文档修补；v4-v5 第 3 轮五个专项评审 + spec-fix-r3 追加；v6 review-full 复核 + trivial 行数勘误；v7 用户拍板 OQ 决议 + spec-fix-decisions 回写）
- 状态：fix-spec-ready（open questions 已全部拍板回写，待用户确认开工）
- 范围：本轮只改文档，不改任何实现代码。下列 Must-fix 的代码与测试修复由后续 fix wave 按条目执行。
- 评审来源：六个 readonly review-scope 节点（comp-chat / comp-rest / comp-misc / screens / services / web）+ infra（storage 基建），合并 fmt 条目（原 comp-rest/C-10、screens/C-10、infra/C-3、comp-chat/C-8 并入 fmt-1，comp-chat/C-3 与 comp-misc/C-2 合并为 collapsible-rn）；第 3 轮：五个 readonly 专项节点（b2-errors / gates / sec / tests / arch）。

## Must-fix（按 P0 → P1 → P2）

### P0

（无。）

### P1（共 30 条）

#### infra/B-1 [P1] bootstrap 失败路径泄漏 SQLite 连接

- **维度**：B（行为正确性 / 资源泄漏）
- **文件**：`apps/mobile/src/db/connection.ts`
- **问题**：`open()` 成功后 `bootstrapNovelMaster` 抛错时，局部变量 `c` 持有的已打开连接随 throw 丢弃——此时模块级 `conn` 尚未赋值，`closeMobileConnection()` 的 `conn?.close()` 是空操作，连接继续持有文件句柄与 WAL 锁；真机重试会再开新连接，Android 多连接同库可能互锁（bootstrap 失败是真机发生过的场景）。
- **改法**：bootstrap 的 catch 在 throw 前补 `await c.close().catch(() => {})`。
- **验收与测试要点**：`connection.test.ts` 补用例——mock `open` 成功 + bootstrap reject，断言 `close` 被调用；重试后能重新 open。
- **来源**：review-scope-storage-infra

#### comp-misc/C-1 [P1] RN 富文本渲染链 5 文件整体死代码

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/components/rich-content/` 下 `prepare-rich-html.ts`、`build-rich-content-styles.ts`、`lift-inline-color.ts`、`materialize-inline-colors.ts`、`extract-style-classes.ts`
- **问题**：`prepareRichHtml` / `buildRichContentStyles` 在 `apps/mobile/src` 与 desktop 零引用（WebView 方案已替代，`RichContentBody` 头注释佐证），其余三个只被死链引用；相关注释已失实。
- **改法**：删 5 文件 + 同步删 5 个守护测试（`__tests__/prepare-rich-html.test.ts`、`lift-inline-color.test.ts`、`materialize-inline-colors.test.ts`、`extract-style-classes.test.ts`、`rich-content-styles.test.ts`）；另删 `__fixtures__/rich-content/` 下 `sample-assistant.md` 与 `sample-assistant.html-snippet.md`（孤儿 fixture，吸收原 tests/G-4）；确认 `src` 内 `react-native-render-html` import 归零后从 `package.json` 移除该依赖。RichContentBody 纯文本形态确认保留（richText 关闭/超限/rn 引擎三回退场景的兜底），清理边界以删除 5 个死文件 + 孤儿 fixture 为限。
- **验收与测试要点**：tsc 通过；grep 零命中；jest 全绿；打包无 `Cannot resolve module`。
- **来源**：review-scope-comp-misc

#### comp-misc/B-1 [P1] RegexGroupPickerModal 选择操作无错误处理、失败伪装空态

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/components/regex/RegexGroupPickerModal.tsx`
- **问题**：`selectNone` / `selectGroup` 为 async 直接绑 `onPress`，`setCurrentRegexGroupId` reject 即 unhandled rejection（点了没反应）；`reload().catch(() => setRows([]))` 把加载失败吞成「暂无正则组」空态，误导排障。
- **改法**：两函数 try/catch + 失败 toast/错误文案；`reload` 增加 error state，失败显示「加载失败，点击重试」；可选加防双击。
- **验收与测试要点**：mock 抛错，断言错误提示与错误态。
- **来源**：review-scope-comp-misc

#### comp-misc/B-2 [P1] sanitize-rich-html 注释与 allowedTags 矛盾 + 内联 style 未过滤（原 P2，2026-08-30 拍板升级）

- **维度**：B/D（行为正确性 / 安全）
- **文件**：`apps/mobile/src/components/rich-content/sanitize-rich-html.ts`
- **问题**：注释称允许 `style` 标签但 `allowedTags` 不含 `style`，注释与配置至少一方是错的；且 sanitize 管道允许 `style` 属性值透传不过滤，恶意内联样式（`position:fixed` 等）可全屏覆盖伪造界面（原第 3 轮 sec 评审 16 号议题一并拍板，升 P1）。
- **改法**：先写行为测试固定现状（输入 `<style>` 断言实际输出），然后 sanitize 管道上 CSS 属性白名单（过滤 style 属性值，至少拦截 `position:fixed/absolute`、`z-index`、`transform` 中可全屏覆盖的组合），删失实注释。
- **验收与测试要点**：新增 `<style>` 用例；注释与行为一致；恶意 `style="position:fixed;inset:0"` 的输入经 sanitize 后不再能全屏覆盖。
- **来源**：review-scope-comp-misc + 第 3 轮专项评审 sec（OQ16 合并），2026-08-30 拍板升 P1

#### comp-chat/C-1 [P1] ChatComposer 四个 token 插入回调复制粘贴

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chat/ChatComposer.tsx`
- **问题**：`insertTokensIntoComposer` 与 `insertSkillToken` 的「补空格 + 拼接 + 算光标」逐行近似；`applyTypeaheadToken` 与 `applySkillTypeaheadToken` 同形；「mention ref 优先 + 纯文本 fallback + persistDraft(statusOnly) + setCursor」块出现 5 次；`send` 与 `sendDisabled` 重复求值 `resolveComposerSendIntent`。
- **改法**：新建 `chat/composer-token-insert.ts`——`buildTokenInsertion(text, cursor, replaceStart, token)` 纯函数 + `commitComposerText(next, cursor)` 收敛 fallback 与持久化；intent 用 `useMemo` 共用。
- **验收与测试要点**：@ 选择器、$ 选择器、@ typeahead、$ typeahead 四条路径行为不变（空格补齐、mention 提升、draft 只留状态 chip、光标落点），配四路径单测。
- **来源**：review-scope-comp-chat

#### comp-rest/C-1 [P1] 弹窗/底部 sheet 骨架 16 处复制

- **维度**：C（组件抽象 / 重复）
- **文件**（均在 `apps/mobile/src/components/` 下）：`ui/TextPromptModal.tsx`、`ui/MonthRangePickerSheet.tsx`、`provider/AddModelModal.tsx`、`provider/EditModelNameModal.tsx`、`provider/FetchModelsSheet.tsx`、`provider/ModelPickerModal.tsx`、`sheet/BottomSheetMenu.tsx`、`sheet/DirectoryRuleSheet.tsx`、`skills/NewSkillModal.tsx`、`skills/SkillPicker.tsx`、`agent/AgentPickerModal.tsx`、`agent/ToolPolicyPicker.tsx`、`chrome/ProjectDrawer.tsx`、`chrome/SessionActionsDrawer.tsx`、`update/UpdateCheckResultModal.tsx`、`vfs/AnnotatePickModal.tsx`、`vfs/VfsFileManager.tsx`
- **问题**：各文件手写同一套「遮罩 + absoluteFill Pressable 关闭层 + 底部/居中面板 + AppModal」骨架；5 个文件重复 iOS `KeyboardAvoidingView` / Android `useAndroidModalKeyboardAvoid` 平台分支样板（约 25 行 × 5）；遮罩色值已漂移（0.4 / 0.55）。
- **改法**：新建 `components/ui/ModalShell.tsx` 封装 AppModal + transparent + 遮罩按压关闭 + panel 定位（center/bottom）+ 平台键盘避让分支；上述文件逐个替换为传 children；`UpdateCheckResultModal` 因在 NavigationContainer 外不能用 AppModal，保持独立。
- **验收与测试要点**：各弹窗遮罩点击关闭、Android 返回键、键盘避让回归不变；`__tests__/keyboard-avoid-android.test.tsx` 通过；scope 内 grep `rgba(0,0,0` 只剩 ModalShell 一处。
- **来源**：review-scope-comp-rest

#### comp-rest/C-2 [P1] 「单输入+确认」弹窗三个平行实现

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/components/provider/EditModelNameModal.tsx`（145 行）、`provider/AddModelModal.tsx`（157 行）、`ui/TextPromptModal.tsx`（189 行）
- **问题**：`EditModelNameModal` 与 `TextPromptModal` 逻辑几乎逐行同构（visible 重置、trim 校验、saving、异步 confirm + finally、按钮排布、键盘避让），`AddModelModal` 为双输入版。
- **改法**：`TextPromptModal` 增加 `variant: 'center' | 'bottom'` 与 `fields`（1–2 输入）后删除另两者（调用方改 props）；或最低限度复用 C-5 的 ModalShell + 共享按钮样式。
- **验收与测试要点**：重命名模型、添加模型、新建/重命名项目回归；saving 禁用、空值禁用不变。
- **来源**：review-scope-comp-rest

#### comp-rest/C-3 [P1] AgentEditorForm 1447 行单函数组件、31 个 useState

- **维度**：C（组件拆分 / 可维护性）
- **文件**：`apps/mobile/src/components/agent/AgentEditorForm.tsx`
- **问题**：单函数组件 1447 行、31 个 useState，难以维护与测试。
- **改法**：按表单 section 拆子组件（模型/系统提示/技能/工具等区），状态收拢进 `useAgentEditorFormState` hook，底部 styles 拆到 `agent-editor-form.styles.ts`。
- **验收与测试要点**：`__tests__/agent-editor-form-dirty.test.tsx`、`agent-editor-form-tool-count.test.ts` 通过；保存/恢复/dirty 手动回归。
- **来源**：review-scope-comp-rest

#### comp-rest/C-4 [P1] VfsFileManager 1356 行单组件、15 个 useState

- **维度**：C（组件拆分 / 可维护性）
- **文件**：`apps/mobile/src/components/vfs/VfsFileManager.tsx`
- **问题**：单组件 1356 行、15 个 useState，弹窗态与列表逻辑纠缠。
- **改法**：依托已有 `vfs-row-mapper.ts` 与 `VfsBatchHeader`，把弹窗态（重命名/移动/注解选择）拆子组件或独立文件，styles 拆分。
- **验收与测试要点**：`__tests__/vfs-file-manager.readonly.test.tsx` 及 vfs 相关测试通过。
- **来源**：review-scope-comp-rest

#### screens/C-1 [P1] 六个列表屏「加载/批量删除/样式」三重样板

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/screens/stack/` 下 `ProvidersScreen.tsx`、`RegexRulesScreen.tsx`、`RegexGroupsScreen.tsx`、`SkillsSettingsScreen.tsx`、`ProviderDetailScreen.tsx`、`SkillPanelScreen.tsx`
- **问题**：rows/loading/reload + useFocusEffect 组合 6 处；confirmBatchDelete Alert 链路 5 处，仅文案与 API 不同；loader/empty 样式逐字重复（两屏样式表完全相同）。
- **改法**：新建 `src/hooks/useFocusListReload.ts`（rows/loading/reload + useFocusEffect，参数 fetcher）、`src/hooks/useBatchDeleteConfirm.ts`（参数 title/message/deleteOne/onDone）、`src/screens/shared/list-screen-styles.ts`。
- **验收与测试要点**：6 屏下拉刷新、批量删除、单条删除、空态回归；`provider-detail-tabs.test.ts`、`skill-panel-screen.test.tsx` 通过；`useBatchDeleteConfirm` 补确认/取消/中途失败三分支单测。
- **来源**：review-scope-screens

#### screens/C-2 [P1] Android 键盘裁切组件 4 份逐字复制

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`、`screens/stack/FileEditorScreen.tsx`、`stack/PromptEditorScreen.tsx`、`stack/ChatHistorySearchScreen.tsx`（SessionDetailScreen 同款动画）
- **问题**：Android 键盘裁切组件 4 份逐字复制，样式与注释多处重复维护。
- **改法**：提取 `components/chrome/AndroidKeyboardClipBody`（或新建 `components/keyboard/`），统一持有样式与注释；chat 面板以 children 收敛。
- **验收与测试要点**：五屏 Android 键盘弹起不裁切、输入框贴键盘；iOS `KeyboardAvoidingView` 路径不变（手工回归清单）。
- **来源**：review-scope-screens

#### screens/C-3 [P1] useSubagentRunProbe 探针回调逐字重复 + 定时器无清理

- **维度**：C+B（重复 + 行为正确性）
- **文件**：`apps/mobile/src/screens/stack/useSubagentRunProbe.ts`（L42-59 与 L83-99）
- **问题**：probe 回调（含 800ms 复询防抖时序语义）在两个 hook 里完整重复；两处 `setTimeout` 无 unmount 清理，卸载后 800ms 内仍可能触发 `onRunEnded`；JSDoc `@param uiRunning` 挂错 hook。
- **改法**：提取 `createRunEndedProbe({ isRunActive, isRunRegistered, onRunEnded })` 共享工厂；`setTimeout` 句柄存 ref 并 effect cleanup；JSDoc 归位到 `useSubagentRunPolling`。
- **验收与测试要点**：`__tests__/subagent-run-probe.test.ts` 全绿；新增「卸载后复询不触发 onRunEnded」断言。
- **来源**：review-scope-screens

#### screens/C-4 [P1] TokenUsageStatsScreen 1149 行巨屏

- **维度**：C（组件拆分 / 可维护性）
- **文件**：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`
- **问题**：单屏 1149 行，页签、筛选、格式化逻辑全部内联。
- **改法**：按页签拆 `token-usage/` 目录（SummaryTab / DetailTab / RequestsTab / StatsFilterBar），纯函数挪 `token-usage/format.ts`。
- **验收与测试要点**：`token-usage-stats-screen.test.tsx` 通过；筛选跨页签保留语义不变；格式化函数补纯函数单测。
- **来源**：review-scope-screens

#### services/C-2 [P1] 导出/导入文档编排收敛（3 导出 + 4 导入）

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/services/db-backup.service.ts`、`vfs-zip.service.ts`、`vfs-character-card.service.ts`、`yaml-shared.ts`
- **问题**：导出侧三份相同「CacheDir 临时文件 → saveDocuments → isUserCancelledPick → 返回 saved/cancelled → finally unlink」；导入侧四份相同「pick → keepLocalCopy → localUriToFsPath → 读文件」；改一处漏一处会留脏文件或漏判取消。
- **改法**：新建 `services/document-io.ts`（或扩展 `document-pick.ts`）提供 `exportBytesViaDocumentPicker({ fileName, mimeType, write })` 与 `pickAndReadBytes({ mimeTypes })`，临时文件路径生成一并收进。
- **验收与测试要点**：备份 / VFS zip / 角色卡 / agent YAML 导入导出各手测一轮（含取消分支后 CacheDir 无残留）；相关既有测试通过。
- **来源**：review-scope-services

#### web/C-orch-1 [P1] chat-transcript 的 post 与桥类型未接 shared

- **维度**：C-orch（跨域编排 / 重复）
- **文件**：`apps/mobile/src/web/chat-transcript/webview/runtime/bridge/bridge.ts`（L34-39）、`.../state/state.ts`（L5-14）
- **问题**：post 函数体与 `@web/shared/post.ts` 逐行重复；`state.ts` 重复声明 `ReactNativeWebViewBridge` 类型与 `declare global`；另两域已是绑定 sharedPost 的薄封装。
- **改法**：`shared/post.ts` 增加工厂 `createBoundPost(bridgeV)`，三域 post 统一为一行绑定；chat-transcript 删内联 post 与全局类型声明；顺手把 `runtime/bridge/bridge.ts` 目录套单文件统一为 `runtime/bridge.ts`（与另两域形态一致），契约测检索路径同步。
- **验收与测试要点**：`chat-transcript-boot-script.test.ts` 同步断言新 import 路径；消息头 `v:1` 与 ready 格式不变。
- **来源**：review-scope-web

#### web/C-orch-2 [P1] applyTheme 与 HostTheme 三份平行

- **维度**：C-orch/C（跨域编排 + 重复）
- **文件**：chat-transcript `bridge.ts` L41-54、rich-document `bridge.ts` L46-62、code-editor `theme.ts` L75-95；`HostTheme` 类型另定义三遍
- **问题**：`applyTheme` 实现三份平行维护，`HostTheme` 类型三处重复且口径不一。
- **改法**：新建 `web/shared/host-theme.ts`——统一 `HostTheme` 超集（含 `danger`）+ `applyHostTheme(theme, opts?)`，`opts.extraVars` 供 code-editor 注入 `--editor-*` 派生变量；nmMode 统一为 background 存在时写入。缺字段语义已拍板（2026-08-30）为**条件式写入 + CSS 兜底**——统一 applyHostTheme 为「字段存在才写」，同时消费侧改用 `var(--bg, #fff)` 兜底读取；`readMermaidThemeFromDocument` 的 `--bg` 读取链加 fallback。web HostTheme fallback 与 tokens 全面收敛单独立项（见决议记录），不进本 spec。
- **验收与测试要点**：三域 init/themeUpdate 后 CSS 变量集合与现状逐个比对；shared 单测。
- **来源**：review-scope-web

#### web/C-orch-3 [P1] 宿主 message 双通道监听三处复制

- **维度**：C-orch（跨域编排 / 重复）
- **文件**：code-editor `main.ts` L7-13、rich-document `main.ts` L69-75、chat-transcript `boot-transcript.ts` L10-13
- **问题**：document + window 双通道 `message` 监听注册逻辑三处复制，解析口径不一。
- **改法**：`web/shared` 增加 `bindHostMessageChannel(handler)` 统一 document + window 双注册；消息解析口径收敛时采用 chat 的宽容版（接受对象型 raw）。
- **验收与测试要点**：三域 ready 消息仍能发出；收敛后补纯函数单测。
- **来源**：review-scope-web

#### web/C-orch-4 [P1] 菜单布局算法 RN/WebView 双源维护

- **维度**：C-orch（跨域编排 / 重复）
- **文件**：`apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts`（L58-135）与 `apps/mobile/src/components/chat/anchored-menu-layout.ts`（L79-153）
- **问题**：同一路径菜单布局算法在 WebView 域与 RN 域双源维护，改一边漏一边。
- **改法**：参数化纯函数（显式传 screenWidth/screenHeight）下沉到 `src/webview-host/chat-transcript/anchored-menu-layout.ts`（照 `scroll.ts`、`menu-overlay-guards.ts` 先例）；web `menu.ts` 保留 DOM 取值 wrapper；RN 侧改 re-export，调用点不动。
- **验收与测试要点**：新增 Jest 直测（照 `menu-overlay-guards.test.ts`）断言双端口径一致。
- **来源**：review-scope-web

#### web/A-1 [P1] code-editor/webview 不在任何被执行的类型检查内

- **维度**：A（工程基建 / 类型安全）
- **文件**：`apps/mobile/src/web/tsconfig.json`（include 漏 `code-editor/webview/**`）、`package.json` typecheck script、`tsconfig.webview-boot.json`
- **问题**：code-editor/webview 目录未被任何被执行的 typecheck 覆盖，类型错误静默漏检。
- **改法**：`src/web/tsconfig.json` include 补 `code-editor/webview/**/*.ts`；`tsconfig.webview-boot.json` 拍板退役——补齐 include 后 grep scripts 引用确认无消费方即删除（2026-08-30 决议）。
- **验收与测试要点**：`tsc --listFiles` 包含 code-editor 文件；`npm run typecheck` 全绿。
- **来源**：review-scope-web

#### fmt-1 [P1] prettier 基建失效、格式三派混居（合并 comp-rest/C-10、screens/C-10、infra/C-3、comp-chat/C-8）

- **维度**：A（工程基建 / 格式统一）
- **文件**：`apps/mobile/.prettierrc.js`、仓库 CI 配置；已漂样例 `agent/AgentList.tsx`、`chrome/ProjectDrawer.tsx`、`provider/ProviderForm.tsx`、`provider/SamplingForm.tsx`、`errors/format-error.ts`、`storage/fill-policy-mobile.ts`、`runtime/setup-llm-fetch.ts`、`runtime/types.ts`、`components/chat/composer-send-state.ts`、`tool-turn-actions.ts`
- **问题**：配置缺 `bracketSpacing: false`（主流为无空格风格）；`format:check` 从未真正生效（各 scope 24–61 文件不合规）；CI 无 format 步骤；多个文件已漂成双引号。
- **改法**：`.prettierrc.js` 补 `bracketSpacing: false` 对齐主流 → `apps/mobile` 全量 `prettier --write` → CI 挂 `format:check`。全量格式化时同步统一导入风格（规则已拍板为 B：同目录及子目录用相对路径、跨 src/ 顶层目录用 @/，2026-08-30 用户确认，见 arch/C-4）。
- **验收与测试要点**：`npm run format:check` 通过；diff 审查确认纯格式无语义变化。
- **来源**：review-scope-comp-rest / screens / infra 合并；另吸收原 comp-chat/C-8（composer-send-state.ts 与 tool-turn-actions.ts 双引号格式问题，已并入本条全量格式化，不单列）

#### b2/B-1 [P1] 列表 reload 吞错伪装空态（4 处）

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/components/agent/AgentPickerModal.tsx` L63、`apps/mobile/src/components/provider/ModelPickerModal.tsx` L121、`apps/mobile/src/screens/stack/ProvidersScreen.tsx` L74、`apps/mobile/src/screens/stack/RegexGroupsScreen.tsx` L180
- **问题**：`reload` 内部只有 try/finally 无 catch，外层 `.catch(() => setRows([]))` 把失败吞成空列表，`ListEmptyComponent` 显示「暂无」误导排障（与 comp-misc/B-1 同模式的新实例）。
- **改法**：对齐 `FetchModelsSheet` 现成做法——reload 加 error state，catch 里 `setError(formatError(cause))`，失败渲染错误文案 + 重试按钮。
- **验收与测试要点**：mock providers.list / listGroups / rows loader reject，断言错误态与重试恢复。
- **来源**：第 3 轮专项评审 b2-errors

#### b2/B-2 [P1] 两个 Picker 的 select 直接绑 onPress 无错误处理

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/components/agent/AgentPickerModal.tsx` L67-79、`apps/mobile/src/components/provider/ModelPickerModal.tsx` L123-142
- **问题**：async `select` 直接绑 `onPress`，写入 reject 即 unhandled rejection，零反馈。
- **改法**：select 包 try/catch + `showToast(toastMessage('设置失败', err))`，成功才 `onSelected` + `onClose`，可加防双击。
- **验收与测试要点**：mock 写入 reject，断言 toast 出现且无 unhandled rejection。
- **来源**：第 3 轮专项评审 b2-errors

#### b2/B-3 [P1] ChatConfigScreen 四开关乐观更新吞掉持久化失败

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/screens/stack/ChatConfigScreen.tsx` L153-205（流式输出 / 思考提示词 / FS 版本校验 / 富文本四个 ProfileSwitchItem）
- **问题**：`onValueChange` 先 setX 翻 UI 再 `.catch(() => undefined)` 吞写入失败，重启回退用户无感知。
- **改法**：catch 里 toast 保存失败并回滚 `setX(!enabled)`，或写入成功后才翻转。
- **验收与测试要点**：mock preferences reject，断言 toast 出现且开关回弹。
- **来源**：第 3 轮专项评审 b2-errors

#### b2/B-4 [P1] 批量删除会话/项目无错误处理，失败卡死批选模式

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` L302-320（deleteSelectedSessions）、L322-331（handleDeleteProjects）；调用方 `ChatTabScreen.tsx` L136-140 的 `.catch(() => undefined)` 全吞
- **问题**：循环 await `sessions.delete` 中途 reject 时剩余不删、`exitSessionBatch()` 不执行、无提示（同文件 `handleDeleteSession` 有 try，批量版没有）。
- **改法**：两函数包 try/catch + toast 删除失败；catch/finally 保证 `exitSessionBatch()` 执行。
- **验收与测试要点**：mock 第二个 session delete reject，断言 toast 出现、批选退出、已删不复活。
- **来源**：第 3 轮专项评审 b2-errors

#### gates/G-1 [P1] 三大门禁全部 continue-on-error，mobile 实际只有 build 在卡类型

- **维度**：A（工程基建 / CI 门禁）
- **文件**：`.github/workflows/ci.yml` L54-64
- **问题**：Lint / Typecheck / Test 全部 `continue-on-error: true`；唯一 blocking 的类型检查是 build 步骤（`tsc -p tsconfig.build.json`），`src/web`、`e2e`、lint error、测试失败统统不红。
- **改法**：先去掉 Test 的 continue-on-error；lint/typecheck 按 workspace 拆 job 逐步放开（mobile lint 现存 23 error 先清后开）。
- **验收与测试要点**：故意引入测试失败 / lint error，确认 PR check 变红。
- **来源**：第 3 轮专项评审 gates

#### gates/G-2 [P1] lint 无 --max-warnings，298 warning 在任何门禁强度下都卡不住

- **维度**：A（工程基建 / lint 门禁）
- **文件**：`apps/mobile/package.json` lint script、`eslint.config.base.mjs` L13
- **问题**：实跑 eslint 321 problems（23 error / 298 warning），`no-unused-vars` 定 warn 且无 max-warnings，死导入永远漏过（三层叠加：warn 级 × 无上限 × CI continue-on-error）。
- **改法**：lint script 加 `--max-warnings 298` 锁存量上限只降不升，随清理递减到 0；清完后 `no-unused-vars` 升 error 带 `argsIgnorePattern:"^_"`（三端共用基线需同步评估）。
- **验收与测试要点**：新增一个死导入，lint 非零退出。
- **来源**：第 3 轮专项评审 gates

#### tests/G-1 [P1] yaml-encode.service.test.ts 死命名+空转断言

- **维度**：G（测试质量）
- **文件**：`apps/mobile/__tests__/yaml-encode.service.test.ts`
- **问题**：文件名指向的源文件已不存在（逻辑并入 agent-yaml.service）；实际把 core encode / stringifyText 全 mock 成 'yaml-out'，断言零真实逻辑；`agent-yaml.service.test.ts` 已真实覆盖。
- **改法**：删除该文件；若担心 `encodeAgentYamlText` 的 schema 转换无真实断言，先在 `agent-yaml.service.test.ts` 补一条非 mock 用例。
- **验收与测试要点**：删除后 jest 全绿；grep `yaml-encode` 零命中。
- **来源**：第 3 轮专项评审 tests

#### tests/G-2 [P1] cloud-sync-config.store.ts 329 行零测试覆盖

- **维度**：G（测试质量）
- **文件**：`apps/mobile/src/services/cloud-sync-config.store.ts`
- **问题**：云同步配置存储核心，唯一关联测试把它整个 mock 掉。
- **改法**：补单测——默认配置装载、KKV 持久化往返、损坏 JSON / 缺字段容错、与 cloud-sync.service 至少一条非 mock 集成用例。
- **验收与测试要点**：新增测试文件覆盖四类场景。
- **来源**：第 3 轮专项评审 tests

#### sec/D-1 [P1] WebView 无导航拦截，外部链接可整页接管 WebView 并伪造桥消息

- **维度**：D（安全）
- **文件**：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` L1168-1185（无 onShouldStartLoadWithRequest、`originWhitelist={['*']}`）、`apps/mobile/src/components/vfs/CodeEditorWebView.tsx` L142-157、`apps/mobile/src/components/vfs/RichDocumentWebView.tsx` L351-372
- **问题**：消息内 markdown 链接经 sanitize 后 `<a href="https://...">` 进 WebView，三个 WebView 均无导航守卫、web 侧无点击拦截；点链接即整页导航到外部站点（无地址栏钓鱼面），导航后任意页面可 postMessage 伪造桥消息——`messageMenuAction` 可触发 rollback / fork / set-floor（数据破坏）、`copyCode` 可写攻击者文本进剪贴板。
- **改法**：三个 WebView 统一加 `onShouldStartLoadWithRequest`——仅放行包内初始加载（file:// + 包目录前缀），https/http 用 `Linking.openURL` 外跳并 return false 拒绝其余一切导航；originWhitelist 收紧为 `['file://']`，iOS 配 onOpenWindow 兜底。
- **验收与测试要点**：点消息内链接→系统浏览器打开且 WebView 保持原页；测试页伪造 messageMenuAction 宿主不执行 rollback；ready / scrollSnapshot 等正常桥消息不受影响；落地后评估 `allowFileAccessFromFileURLs` 收紧为 false，跑 mermaid/代码高亮资源加载回归。
- **来源**：第 3 轮专项评审 sec

#### arch/C-1 [P1] AppHeader 反向依赖具体屏，components↔navigation↔screens 三层互缠

- **维度**：C（分层 / 命名）
- **文件**：`apps/mobile/src/components/chrome/AppHeader.tsx` L11
- **问题**：chrome 通用组件值导入 `screens/tabs/chat-tab/ChatTabNavigationProvider` 的 `useChatTabNavigationOptional`，依赖链成环（navigation/StackScreenLayout → AppHeader → screens → navigation/HeaderContext），靠模块初始化顺序侥幸不出环。
- **改法**：chat tab 导航能力走注入——返回值收进 HeaderContext（或 navigation 层新 context），ChatTab 侧 Provider 写入，AppHeader 只从 context 读。
- **验收与测试要点**：components 下 grep `from '../../screens` 零匹配；AppHeader 菜单在 chat 内外行为回归。
- **来源**：第 3 轮专项评审 arch

### P2（共 69 条，其中 collapsible-rn 为跨 scope 合并条目）

#### comp-chat/C-2 [P2] MessageActionMenuItem 接口重复声明

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chat/message-edit.ts` L18-22、`apps/mobile/src/components/chat/MessageActionMenu.tsx` L25-29
- **问题**：`MessageActionMenuItem` 接口在两个文件逐字重复声明，双源维护易漂移。
- **改法**：`MessageActionMenu` 改为 `import type` 并 re-export，删除本地重复声明。
- **验收与测试要点**：tsc 通过。
- **来源**：review-scope-comp-chat

#### comp-chat/C-4 [P2] AtPathTypeahead 与 SkillTypeahead 列表结构同构

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/components/chat/AtPathTypeahead.tsx`、`apps/mobile/src/components/chat/SkillTypeahead.tsx`
- **问题**：两组件的 list/item 样式与容器结构一致（注释自认对齐），骨架双份维护。
- **改法**：抽 `TypeaheadList` 容器组件，两组件只保留各自的行渲染。
- **验收与测试要点**：建议列表视觉不变；`skill-typeahead-*` testID 保留。
- **来源**：review-scope-comp-chat

#### comp-chat/C-5 [P2] TranscriptStreamType 重复导出

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chat/ChatTranscriptBridge.ts` L92、`apps/mobile/src/components/chat/message-blocks.ts` L380
- **问题**：`TranscriptStreamState` 已在 `ChatTranscriptBridge` 导出，`message-blocks` 又本地重复声明一份。
- **改法**：`message-blocks` 改 import + re-export。
- **验收与测试要点**：类型检查通过。
- **来源**：review-scope-comp-chat

#### comp-chat/C-6 [P2] enrich-transcript-rows 模块级 richHtmlCache 无界增长

- **维度**：B（行为正确性 / 资源占用）
- **文件**：`apps/mobile/src/components/chat/enrich-transcript-rows.ts`
- **问题**：模块级 `richHtmlCache` 无上限无清理，key 含全文，长生命周期下内存只涨不跌。
- **改法**：加 LRU 上限（如 500），或导出 `clearRichHtmlCache()` 供会话切换时调用。
- **验收与测试要点**：缓存有界；richText 开关切换渲染正确（保留「缓存空串按 miss」语义）。
- **来源**：review-scope-comp-chat

#### comp-chat/C-7 [P2] FileReferencePicker 选目录分支重复

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chat/FileReferencePicker.tsx`
- **问题**：`selectCurrentDir` 与 `handleConfirm` 的 pick-directory 分支完全重复。
- **改法**：抽局部 `confirmPickDirectory()`，两入口共用。
- **验收与测试要点**：两入口行为一致；blocked 目录不可确认。
- **来源**：review-scope-comp-chat

#### comp-chat/C-9 [P2] tool-turn-actions hide/show 分支互为镜像

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chat/tool-turn-actions.ts`
- **问题**：`hideToolTurn` 的 hide/show 分支互为镜像，tool_result 配对逻辑写了两遍。
- **改法**：收敛为单路径（联合类型收窄后统一处理）。
- **验收与测试要点**：隐藏/恢复时成对 tool_result 同步操作。
- **来源**：review-scope-comp-chat

#### collapsible-rn [P2] 折叠卡片 UI 四处同构复制（合并 comp-chat/C-3 与 comp-misc/C-2）

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/components/chat/ThinkingBlockCard.tsx`、`apps/mobile/src/components/chat/ToolCallGroupCard.tsx`（divider 样式三份）、`apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx`、`apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx`（formCard 头 + MessageResultCard，注释自认「结构对齐 PromptPreviewSegmentCard」）
- **问题**：「折叠卡片」UI 至少四处同构复制，样式与展开逻辑双源（多源）维护。
- **改法**：新建 `apps/mobile/src/components/ui/CollapsibleCard.tsx`（受控/非受控两用，props：`expanded`/`onToggle`、`title`、`summary`、样式覆写点；含 `accessibilityState`），四处调用方替换，样式差异用覆写点吸收。
- **验收与测试要点**：四种形态（默认折叠/默认展开/短内容不可折叠/embedded）可表达；无障碍 button+expanded 保留；视觉快照不回退。
- **来源**：review-scope-comp-chat / comp-misc 合并

#### comp-misc/C-3 [P2] RichContentBody 两个 @deprecated props 五处积极传值

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/components/rich-content/RichContentBody.tsx`；调用方 `apps/mobile/src/components/chat/MessageList.tsx`、`apps/mobile/src/components/chat/ThinkingBlockCard.tsx`、`apps/mobile/src/components/vfs/FileMarkdownPreview.tsx`
- **问题**：`variant`/`renderKey` 两个 `@deprecated` props 被三个调用方五处积极传值，「假生效」误导后续维护。
- **改法**：清理五处传参后从 `RichContentBodyProps` 删除两 props（与 comp-misc/C-1 死链清理联动）。
- **验收与测试要点**：tsc 通过；调用点清零；视觉无变化。
- **来源**：review-scope-comp-misc

#### comp-rest/C-5 [P2] 列表选择弹窗三兄弟同构

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/components/agent/AgentPickerModal.tsx`、`apps/mobile/src/components/provider/ModelPickerModal.tsx`、`apps/mobile/src/components/skills/SkillPicker.tsx`
- **问题**：三个弹窗共享「visible 触发 reload→rows/currentId→FlatList→选中回抛」骨架，逐处复制。
- **改法**：抽 `apps/mobile/src/components/ui/PickerListModal.tsx`（props：`load`、`selectedId`、`renderRow`、`onPick`、空态文案），三者退化为数据适配。
- **验收与测试要点**：模型/智能体/技能切换回归。
- **来源**：review-scope-comp-rest

#### comp-rest/C-6 [P2] SessionActionsDrawer 是 BottomSheetMenu 子集

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/components/chrome/SessionActionsDrawer.tsx`、`apps/mobile/src/components/sheet/BottomSheetMenu.tsx`
- **问题**：`SessionActionsDrawer` 是 `BottomSheetMenu` 的子集，仅差 item 级 `disabled`。
- **改法**：`BottomSheetMenu` 的 `SheetMenuItem` 加 `disabled?: boolean`，删除 `SessionActionsDrawer`、调用方替换。
- **验收与测试要点**：会话操作抽屉回归（未传 action 项置灰不可点）。
- **来源**：review-scope-comp-rest

#### comp-rest/C-7 [P2] 卡片基础样式四处复制

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/components/ui/ElevatedCard.tsx`、`apps/mobile/src/components/ui/ProfileMenuItem.tsx`、`apps/mobile/src/components/ui/ProfileSwitchItem.tsx`、`apps/mobile/src/components/form/FormSectionCard.tsx`
- **问题**：卡片基础样式（radius16/padding16/margin5,12/hairline/shadow0.08,3/elevation2）四处复制，`iconWrap`/chevron 亦重复；`ElevatedCard` 仅 2 处使用、`ProfileMenuItem` 手写 Pressable 卡片，基础层未跑通。
- **改法**：抽 `apps/mobile/src/components/ui/card-styles.ts`；`ProfileMenuItem` 改组合 `ElevatedCard`，其余复用共享样式。
- **验收与测试要点**：Profile/配置列表/表单页像素级不变。
- **来源**：review-scope-comp-rest

#### comp-rest/C-8 [P2] FormErrorCard 全仓零引用

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/components/form/FormErrorCard.tsx`
- **问题**：全仓零引用的死组件。
- **改法**：直接删除（2026-08-30 用户拍板，无近期接入规划）。
- **验收与测试要点**：tsc 通过；grep 无残留。
- **来源**：review-scope-comp-rest

#### comp-rest/C-9 [P2] PrototypeButtons 名不副实

- **维度**：C（死代码清理 / 命名）
- **文件**：`apps/mobile/src/components/ui/PrototypeButtons.tsx`
- **问题**：`Primary/SecondaryButton` 被 8 个屏正式依赖，文件名仍叫 Prototype（原型）。
- **改法**：重命名为 `apps/mobile/src/components/ui/Buttons.tsx`，全局替换 import。
- **验收与测试要点**：tsc 通过；无旧路径引用。
- **来源**：review-scope-comp-rest

#### screens/C-5 [P2] useChatTabMessages 736 行双 hook 同文件

- **维度**：C（代码复用 / 结构整理）
- **文件**：`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`
- **问题**：736 行文件里 `useChatTabMessages` 与 `useChatTabMessageActions` 职责不同的两个 hook 挤在一起。
- **改法**：拆出 `useChatTabMessageActions.ts`，纯移动不改逻辑。
- **验收与测试要点**：rollback/set-floor/integration 测试通过。
- **来源**：review-scope-screens

#### screens/C-6 [P2] 「返回上翻」三件套两屏逐字复制

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/screens/GlobalTemplateScreen.tsx`、`apps/mobile/src/screens/SkillDetailScreen.tsx`（路径以实际为准）
- **问题**：「返回上翻」三件套（`goUpOrExit` + `BackHandler` + `setStackOverride` + `gestureEnabled`）在两屏逐字复制（含注释）。
- **改法**：提取 `apps/mobile/src/hooks/useVfsBackNavigation(fileRef, navigation, options?)`。
- **验收与测试要点**：两屏子目录返回上翻/根目录退出、栈顶不被吞、iOS 手势语义不变。
- **来源**：review-scope-screens

#### screens/C-7 [P2] useChatTabScope 空 meta 字面量写 4 遍

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts`
- **问题**：空 meta 字面量写 4 遍；`projectId == null` 与 `sessionId == null` 分支体相同。
- **改法**：提 `EMPTY_AGENT_META` 常量、合并分支。
- **验收与测试要点**：`chat-tab-screen.integration.test.tsx` 通过。
- **来源**：review-scope-screens

#### screens/C-8 [P2] 两个编辑器屏外壳重复

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/screens/FileEditorScreen.tsx`、`apps/mobile/src/screens/PromptEditorScreen.tsx`（路径以实际为准）
- **问题**：两屏编辑器外壳重复（toolbar/SegmentedControl/preview 二态/三分支布局，注释自认照搬）。
- **改法**：提取 `EditorScreenShell`（保存态/标题/预览开关/内容 slot），键盘部分复用 screens/C-2 组件。
- **验收与测试要点**：两编辑器屏测试通过；保存禁用与未保存拦截不变。
- **来源**：review-scope-screens

#### screens/C-9 [P2] 零散死代码（linking.ts 与死导入）

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/navigation/linking.ts`、`apps/mobile/src/screens/ProvidersScreen.tsx` L9、`apps/mobile/src/screens/RegexRulesScreen.tsx` L9
- **问题**：`linking.ts` 导出 `undefined` 全仓零引用；两屏各有一处死导入 `Pressable`。
- **改法**：删 `linking.ts`（如需 deep linking 占位改 README 记录）；移除死导入。
- **验收与测试要点**：typecheck + lint 通过。
- **来源**：review-scope-screens

#### screens/C-11 [P2] 零散修正（初载 effect / 多余依赖 / 重复常量）

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/screens/SubagentSessionScreen.tsx` L85-107、`apps/mobile/src/screens/tabs/ChatTabProvider.tsx` L207-211、`apps/mobile/src/components/chat/ChatConversationPanel.tsx` L41、`apps/mobile/src/screens/SessionDetailScreen.tsx` L56
- **问题**：初载 effect 手写与 reload 相同逻辑；effect 依赖数组多出 `projectId`；`MODEL_LOCK_TOAST` 两处重复定义。
- **改法**：初载改 `reload().finally`；删多余依赖；`MODEL_LOCK_TOAST` 收敛到 `apps/mobile/src/services/chat-agent-meta.ts`；`AGENT_LOCK_TOAST` 两处文案定为有意分化（会话面板=引导语、详情页=陈述），修正失实的『对齐』注释，与 `MODEL_LOCK_TOAST` 一起挪入 `services/chat-agent-meta.ts` 统一管理。
- **验收与测试要点**：子会话初载流转正常；session-detail 锁定文案断言不破。
- **来源**：review-scope-screens

#### screens/C-12 [P2] RegexGroupsScreen 手写批量工具栏双轨

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/screens/RegexGroupsScreen.tsx` L240-296
- **问题**：手写批量工具栏与其余屏的 `ManageHeader` 双轨并存。
- **改法**：直接换用 `ManageHeader`（2026-08-30 拍板，不采用封装+注释备选）；「当前正则组」卡片改放 ListHeaderComponent。
- **验收与测试要点**：批量进出/计数/删除禁用态与其他列表屏一致。
- **来源**：review-scope-screens

#### services/C-1 [P2] stream-buffer.service.ts 94 行死代码

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/services/stream-buffer.service.ts`、`apps/mobile/__tests__/stream-buffer.service.test.ts`
- **问题**：仅测试引用，生产链全走 stream-apply-buffer + stream-wire-queue；文件格式异常疑事故残留。
- **改法**：连同测试一起删除（用户已确认删除，2026-08-30）。
- **验收与测试要点**：tsc + jest 全绿；grep 无生产命中。
- **来源**：review-scope-services

#### services/C-3 [P2] RN 文件/字节工具四处复制

- **维度**：C（代码复用 / 重复）
- **文件**：`localUriToFsPath`（`apps/mobile/src/services/db-backup.ts`、`vfs-zip.ts`、`vfs-character-card.ts`、`yaml-shared.ts` 各一份）、`toFileUri` 两份、`base64ToBytes` 两份逐字相同、`bytesToBase64` 与 `bytesToAsciiString` 同族
- **问题**：同一批 RN 文件/字节转换工具四处复制，改一处漏三处。
- **改法**：新建 `apps/mobile/src/services/rn-file-io.ts` 收编四个函数，调用方改导入。
- **验收与测试要点**：备份/zip/角色卡测试全绿；中文文件名 `decodeURIComponent` 路径有单测。
- **来源**：review-scope-services

#### services/C-4 [P2] knownTypesForExtension 逐字重复

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/services/character-card-document-pick.ts`、`apps/mobile/src/services/yaml-document-pick.ts`
- **问题**：`knownTypesForExtension` 在两文件逐字相同。
- **改法**：并入 document-io 公共层（与 P1 services/C-2 联动）。
- **验收与测试要点**：两类选择器类型过滤不变。
- **来源**：review-scope-services

#### services/C-5 [P2] workplace-operations 布尔镜像与 rename 复制

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/services/workplace-operations.service.ts`
- **问题**：`batchSetDirRulesEnabled/Disabled` 仅布尔参数不同；`renameVfsFile/Directory` 与 session 前缀版两两相同。
- **改法**：合并为 `batchSetDirRulesEnabled(ids, enabled: boolean)`；rename 保留单一实现（别名导出或改调用方）。
- **验收与测试要点**：调用方编译通过；UI 手测一轮。
- **来源**：review-scope-services

#### services/C-6 [P2] 三个模块级 Map 缓存结构一致

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/services/chat-list-scroll-cache.ts`、`chat-transcript-scroll-cache.ts`、`chat-session-view-cache.ts`
- **问题**：三个模块级 Map 缓存（拼 key + get/set/clear/clearAll）结构完全一致。
- **改法**：新建 `createScopeKeyCache<T>()` 工厂，三处一行实例化并保留导出签名。
- **验收与测试要点**：滚动恢复/视图缓存测试通过；clearAll 语义不变。
- **来源**：review-scope-services

#### services/C-7 [P2] agent-picker 两个 loadRows 逐行相同

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/services/agent-picker.ts`
- **问题**：两个 `loadRows` 除 `currentId` 来源外逐行相同（含过滤 subagent、名字兜底、try/catch）。
- **改法**：提取私有 `loadAgentRows(runtime)`，两个导出组合。
- **验收与测试要点**：会话级/workspace 级行为不变。
- **来源**：review-scope-services

#### services/C-8 [P2] 两个流式 metrics hook 逐行重复

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/hooks/useAgentStreamMetrics.ts`、`apps/mobile/src/hooks/useStreamMetricsAcc.ts`（路径以实际为准）
- **问题**：两 hook 的状态机与回调逐行重复（后者多 250ms tick），另有三个纯转发包装。
- **改法**：前者组合后者 + `useTicker(running)`；删转发包装直调纯函数。
- **验收与测试要点**：metrics 条刷新/保留语义单测通过。
- **来源**：review-scope-services

#### services/A-1 [P2] blobFs CJS/ESM 适配仅一处、其余裸导入

- **维度**：A（工程基建 / 一致性）
- **文件**：`apps/mobile/src/services/yaml-shared.ts` 及同类 IO 文件
- **问题**：`blobFs()` CJS/ESM 适配仅 `yaml-shared.ts` 有，同类 IO 其余文件裸导入 `ReactNativeBlobUtil`。
- **改法**：先查 git 历史确认动机，二选一：挪入 `rn-file-io.ts` 统一用，或确认不需要后删。
- **验收与测试要点**：debug/release 构建各走一遍备份与 YAML 导出。
- **来源**：review-scope-services

#### services/A-2 [P2] stream-apply-buffer 别名导入破坏相对路径惯例

- **维度**：A（工程基建 / 一致性）
- **文件**：`apps/mobile/src/services/stream-apply-buffer.ts`
- **问题**：用 `@/services/stream-wire-queue` 别名导入同目录文件，破坏该层相对路径惯例。
- **改法**：改 `./stream-wire-queue`。
- **验收与测试要点**：编译通过。
- **来源**：review-scope-services

#### services/C-9 [P2] chat-transcript-scroll-cache 反向依赖 UI 层

- **维度**：C（分层 / 依赖方向）
- **文件**：`apps/mobile/src/services/chat-transcript-scroll-cache.ts`
- **问题**：从 `../components/chat/ChatTranscriptBridge` 导入类型，service 反向依赖 UI 层。
- **改法**：类型下沉 service 或 core，Bridge 反向引用；或缓存整体上移 components（与 collapsible 相关落点一并考虑，原文 C-26）。
- **验收与测试要点**：grep 验证 service 不 import components；滚动恢复不变。
- **来源**：review-scope-services

#### web/C-orch-5 [P2] mermaid 全屏 portal 挂接块两 main 逐行相同

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/web/chat-transcript/main.ts` L43-58、`apps/mobile/src/web/rich-document/main.ts` L50-64
- **问题**：mermaid 全屏 portal 挂接块逐行相同（仅 portal id 不同）。
- **改法**：`web/shared/mermaid-fullscreen` 增加 `mountMermaidViewerPortal(portalId)`，两 main 各留一行调用。
- **验收与测试要点**：两域 mermaid 全屏/返回键关闭不变；`mermaid-fullscreen.test.ts` 通过。
- **来源**：review-scope-web

#### web/C-orch-6 [P2] mermaid-viewer-gestures 域归属错位

- **维度**：C（分层 / 归属）
- **文件**：`apps/mobile/src/web/webview-host/chat-transcript/mermaid-viewer-gestures.ts`
- **问题**：唯一消费方是 `web/shared/mermaid-fullscreen/MermaidViewerOverlay.tsx`，文件却放在 chat-transcript 域下。
- **改法**：挪到 `web/shared/mermaid-fullscreen/` 下，更新 import 与测试。
- **验收与测试要点**：typecheck 与 `mermaid-fullscreen.test.ts` 通过；无旧路径引用。
- **来源**：review-scope-web

#### web/A-2 [P2] code-editor bridge msg.v 硬编码

- **维度**：A（工程基建 / 常量化）
- **文件**：`apps/mobile/src/web/code-editor/runtime/bridge.ts` L18
- **问题**：`msg.v !== 1` 硬编码，同域 `model.ts` 已有 `BRIDGE_V` 常量；且缺 `!msg.type` 校验（另两域有）。
- **改法**：改用常量，顺带补 `!msg.type` 校验与另两域对齐。
- **验收与测试要点**：单测覆盖 v 不匹配与 type 缺失被丢弃。
- **来源**：review-scope-web

#### web/A-3 [P2] MermaidViewerOverlay 使用 class= 而非 className=

- **维度**：A（工程基建 / 一致性）
- **文件**：`apps/mobile/src/web/shared/mermaid-fullscreen/MermaidViewerOverlay.tsx` L419-437
- **问题**：全仓唯一用 `class=` 的组件（其余均 `className=`）。
- **改法**：统一 `className=`。
- **验收与测试要点**：grep `class=` 无命中；渲染不变。
- **来源**：review-scope-web

#### web/C-1 [P2] code-editor setReadOnly 死代码

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/web/code-editor/runtime/editor.ts`
- **问题**：`setReadOnly` 无调用者，`readOnly` 形参恒 false。
- **改法**：删 `setReadOnly`、`readOnly` 形参与 `readOnlyCompartment`。
- **验收与测试要点**：build:webview 产物无 readOnly 分支；`webview-uri-load.test.tsx` 通过。
- **来源**：review-scope-web

#### web/C-2 [P2] chat-transcript webview 折叠区结构三处重复

- **维度**：C（组件抽象 / 重复）
- **文件**：`apps/mobile/src/web/chat-transcript/render/ToolGroup.tsx` L93-115、`render/AttachGroup.tsx` L23-63（复用 tool-group-* class 拼第二份 DOM）、`stream/StreamTail.tsx` L140-160（thinking header 与 ThinkingSection.tsx 同构）
- **问题**：折叠区结构三处重复。
- **改法**：抽 `CollapsibleSection`（props：`title`、`action`、`dataKey`、`expanded`、`dividedClass`、`children`），StreamTail 至少复用 header 子组件，增量岛不动。
- **验收与测试要点**：DOM 结构与 class 逐属性一致（data-action 委托 key 不变）。
- **来源**：review-scope-web

#### web/C-3 [P2] snapshot 内联滚动式四遍 + NEAR_BOTTOM 双名并存

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/web/chat-transcript/snapshot.ts`、`apps/mobile/src/web/webview-host/chat-transcript/scroll.ts`、`apps/mobile/src/web/chat-transcript/constants.ts`
- **问题**：`scrollHeight-clientHeight-offsetY` 内联四遍，与 `scrollTopForOffsetFromBottom` 同式；`NEAR_BOTTOM` 是 `NEAR_BOTTOM_THRESHOLD_PX` 历史别名，双名并存。
- **改法**：四处改调用共享函数（web tsconfig 已覆盖 webview-host）；删短别名统一全名。
- **验收与测试要点**：`chat-transcript-scroll.test.ts` 通过；四条消息路径滚动位置不变。
- **来源**：review-scope-web

#### infra/C-1 [P2] storage 偏好读写五处同构且口径分叉

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/storage/chat-transcript-engine.ts`、`vfs-markdown-preview-engine.ts`、`chat-stream-batch-pref.ts`、`chat-rich-text-pref.ts`、`update-prefs.ts`（路径以实际为准）
- **问题**：偏好读写五处同构，口径已分叉（flag 带 try/catch、richText 不带）。
- **改法**：新建 `apps/mobile/src/storage/app-ui-pref-io.ts` 提供 `readEnumPref`/`readBoolPref`/`writeBoolPref`（统一含 try/catch），五文件改薄封装。
- **验收与测试要点**：既有三组 engine/pref 测试全绿；helper 单测覆盖非法值/get 抛错/appUi null 三分支。
- **来源**：review-scope-storage-infra

#### infra/C-2 [P2] KKV key 常量位置分裂

- **维度**：C（代码复用 / 结构整理）
- **文件**：`apps/mobile/src/storage/app-ui-keys.ts` 及 `chatStreamBatchEnabled`/`chatTranscriptEngine`/`vfsMarkdownPreviewEngine` 所在各文件
- **问题**：三个 key 散落各自文件，其余集中 `app-ui-keys.ts`；`appUiKeys` typed helper 只收两键且 `chatRichText` 无消费方。
- **改法**：三 key 迁入 `app-ui-keys.ts`；`appUiKeys` typed helper 拍板删除（调用方主流直接用常量，2026-08-30），不采用补全备选。
- **验收与测试要点**：`app-ui-keys.test.ts` 补 key 清单断言。
- **来源**：review-scope-storage-infra

#### infra/C-4 [P2] 四处死代码

- **维度**：C（死代码清理）
- **文件**：`apps/mobile/src/provider/model-display-label.ts`（`resolveModelShortLabel`）、`apps/mobile/src/update-check/resolve-latest-release.ts`（`resolveLatestReleaseFromList`）、`apps/mobile/src/shims/aws-rn-stream-collector.js`（`toSdkPayloadBytes`）、`apps/mobile/src/storage/chat-composer-draft.ts`（`readChatComposerDraft`）
- **问题**：四个死实现（`readChatComposerDraft` 仅两个测试在用）。
- **改法**：前三个直接删；`readChatComposerDraft` 改两测试用 `readChatComposerDraftState().text` 后删。
- **验收与测试要点**：tsc 通过；grep 无残留；改写测试全绿。
- **来源**：review-scope-storage-infra

#### infra/C-5 [P2] db/connection 两段 cause 链日志逐字重复

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/db/connection.ts`
- **问题**：`open` 与 `bootstrap` 两 catch 各一段 cause 链日志（while depth<5）逐字重复。
- **改法**：抽 `logCauseChain(label, err)`。
- **验收与测试要点**：行为不变；可加 spy 单测锁 5 层上限。
- **来源**：review-scope-storage-infra

#### infra/C-6 [P2] create-mobile-runtime 惰性构造写两遍

- **维度**：C（代码复用 / 重复）
- **文件**：`apps/mobile/src/runtime/create-mobile-runtime.ts`
- **问题**：`lazyCompactionConditionEvaluator` 两方法各写一遍相同惰性构造。
- **改法**：提 `getOrCreateEvaluator()` 内部函数。
- **验收与测试要点**：编译通过；集成测试绿。
- **来源**：review-scope-storage-infra

#### infra/B-2 [P2] fire-and-forget 持久化无错误处理四处

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/storage/chat-composer-draft.ts`（三处 `void sessions.setComposerDraftJson` / `persistAttachTextDraft`）、`apps/mobile/src/theme/ThemeProvider.tsx`（`setMode` 无 catch，`toggleMode` 被 void 调用时 unhandled rejection）
- **问题**：fire-and-forget 持久化四处无错误处理，reject 即 unhandled rejection 且无日志。
- **改法**：storage 侧补 `.catch(warn)`；`setMode` 包 try/catch 失败 warn。
- **验收与测试要点**：mock reject 断言无 unhandled rejection 且有日志。
- **来源**：review-scope-storage-infra

#### infra/C-7 [P2] novel-master-context errorMessage 硬编码颜色不适配 dark

- **维度**：B（行为正确性 / 主题）
- **文件**：`apps/mobile/src/runtime/novel-master-context.tsx`
- **问题**：`errorMessage` 硬编码 `color:'#666'`，dark 模式错误屏不适配（`tokens.ts` 名义真源被绕过；web 侧 fallback 第三套值另行立项）。
- **改法**：组件在 ThemeProvider 外，直接调 `tokensForMode(useColorScheme())` 取 `textSecondary`。
- **验收与测试要点**：dark 模式构造启动错误文字可读。
- **来源**：review-scope-storage-infra

#### b2/B-5 [P2] useAutoUpdateCheck 的 try 块外 await 与 void 调用

- **维度**：B（行为正确性 / 错误处理）
- **文件**：`apps/mobile/src/hooks/useAutoUpdateCheck.ts` L72、L75、L103、L60-64、L42
- **问题**：`readUpdatesAutoCheck` / `readSnoozeUntil` 在 try 外 await；`persistFailedUpdateCheck` 自身 reject 裸奔；`handleSnoozeToday` async 直绑；`void Linking.openURL` 无 catch。
- **改法**：read 挪进 try；persist 显式 `.catch(() => undefined)`；handleSnoozeToday 包 try/catch + toast；openURL 补 catch（对齐 AboutScreen L108）。
- **验收与测试要点**：mock reject 下 DEV 无 unhandled rejection 警告。
- **来源**：第 3 轮专项评审 b2-errors

#### b2/B-6 [P2] 会话/项目级缓存无界增长

- **维度**：B（行为正确性 / 资源泄漏）
- **文件**：`apps/mobile/src/services/chat-list-scroll-cache.ts`、`apps/mobile/src/services/chat-transcript-scroll-cache.ts`、`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` L322-331
- **问题**：两个 scroll 缓存模块级 Map 无 delete 无上限；`handleDeleteProjects` 不清 sessionViewCache（`deleteSelectedSessions` 清了，项目路径漏了），项目删除后消息 tail 缓存残留。
- **改法**：`handleDeleteProjects` 按项目前缀清理（加 `clearSessionViewCachesByProject`），scroll 缓存同理提供删除函数，或统一 LRU 上限（与 services/C-6 工厂一并落）。
- **验收与测试要点**：单测删项目后 Map size 不增；clearAll 路径不回归。
- **来源**：第 3 轮专项评审 b2-errors

#### gates/G-3 [P2] check:ct-ui-no-state 是死脚本

- **维度**：A（工程基建 / 脚本）
- **文件**：`apps/mobile/package.json` L17
- **问题**：引用仓库根 `scripts/check-ct-ui-no-state.mjs`，该目录不存在，本地必挂且无引用。
- **改法**：删除 script 或从 git 历史恢复；顺手对齐根 `.gitignore` L36 注释里的 script 名漂移。
- **验收与测试要点**：grep 零残留或脚本跑通。
- **来源**：第 3 轮专项评审 gates

#### gates/G-4 [P2] e2e:build-apk 用 gradlew.bat 跨平台必挂

- **维度**：A（工程基建 / 脚本）
- **文件**：`apps/mobile/package.json` L25
- **问题**：`cd android && gradlew.bat` 无 `./` 前缀，POSIX 下不命中。
- **改法**：按平台分支（win32 用 gradlew.bat 否则 ./gradlew），与 tests/G-7 的 README 口径一并修。
- **验收与测试要点**：linux 下能启动 gradle。
- **来源**：第 3 轮专项评审 gates

#### gates/G-5 [P2] e2e 有独立 tsconfig 但无门禁入口

- **维度**：A（工程基建 / 类型安全）
- **文件**：`package.json` typecheck script、`e2e/tsconfig.json`
- **问题**：`e2e:tsc` 存在但 typecheck 不含、CI 不跑，e2e 类型漂移静默漏检（与 web/A-1 独立）。
- **改法**：typecheck 追加 `&& npm run e2e:tsc`。
- **验收与测试要点**：`--listFiles` 覆盖 `e2e/` 全部 .ts。
- **来源**：第 3 轮专项评审 gates

#### sec/D-2 [P2] 更新检查的 releaseUrl 未校验域名即外跳

- **维度**：D（安全）
- **文件**：`apps/mobile/src/update-check/resolve-latest-release.ts` L27-43；消费点 `useAutoUpdateCheck.ts` L41-43、`AboutScreen.tsx` L49-51
- **问题**：`html_url` 只做类型检查就透传 `Linking.openURL`，被劫持响应可引到任意 scheme/域名（Android 可触发深链）。
- **改法**：`mapReleaseJson` 加白名单——htmlUrl 必须以 `https://github.com/${owner}/${name}/` 前缀开头否则 throw。
- **验收与测试要点**：单测喂 evil 域名假响应断言抛错。
- **来源**：第 3 轮专项评审 sec

#### tests/G-3 [P2] 源码正则断言测试规模化（15 个文件）

- **维度**：G（测试质量）
- **文件**：`directory-rule-sheet.test.ts`（断言 flexShrink:1 字面量）、`provider-detail-tabs.test.ts`、`agent-editor-form-tool-count.test.ts`、`session-detail-screen.test.tsx`、`tool-policy-picker.test.tsx`、`code-copy.test.ts`、`message-menu-entry.test.ts`、`vfs-character-card-menu.test.ts`、`new-skill-modal-contract.test.ts` 等 15 个
- **问题**：readFileSync 读源码正则匹配实现细节，等价重构即碎、行为坏了不报警。
- **改法**：分级治理——RN 组件侧改行为断言（TestRenderer 渲染断布局）；webview 脚本文本类（annotate-*/boot-script）保留但集中 helper 并注明理由。
- **验收与测试要点**：RN 侧源码断言测试归零或有注释豁免；jest 全绿。
- **来源**：第 3 轮专项评审 tests

#### tests/G-5 [P2] vfs-operations.service.ts 209 行被全部 mock 无真实单测

- **维度**：G（测试质量）
- **文件**：`apps/mobile/src/services/vfs-operations.service.ts`
- **问题**：4 个 vfs-file-manager.* 测试全 jest.mock 掉它，操作编排零真实覆盖。
- **改法**：补关键路径单测（mock 底层 sessionVfs 而非 service）：move/rename 冲突、批量删除部分失败、路径边界。
- **验收与测试要点**：至少覆盖冲突与部分失败两类异常路径。
- **来源**：第 3 轮专项评审 tests

#### tests/G-6 [P2] jest 无 coverage 可见性

- **维度**：G（测试质量）
- **文件**：`apps/mobile/jest.config.js`
- **问题**：无 collectCoverage 配置，低覆盖区不可见。
- **改法**：加 `collectCoverageFrom:['src/services/**','src/storage/**','src/hooks/**','src/runtime/**']` 报告输出（不设阈值门槛）。
- **验收与测试要点**：`jest --coverage` 出报告且不阻塞流水线。
- **来源**：第 3 轮专项评审 tests

#### tests/G-7 [P2] e2e 文档与脚本漂移

- **维度**：G（测试质量 / 文档）
- **文件**：`e2e/README.md` L112、`package.json` e2e:build-apk
- **问题**：README 引用不存在的 `.apm/kb/docs/...` 路径（实际在 `docs/Iterations/mobile-android-e2e-appium/spec.md`）；README 内文 ./gradlew 与脚本 gradlew.bat 口径不一。
- **改法**：README 改指正确路径；脚本按平台分支（与 gates/G-4 合并执行）。
- **验收与测试要点**：链接可达；linux 下脚本可进 gradle。
- **来源**：第 3 轮专项评审 tests

#### arch/C-2 [P2] FetchModelsSheet 注释引用不存在的对照物

- **维度**：C（分层 / 命名 / 注释）
- **文件**：`apps/mobile/src/components/provider/FetchModelsSheet.tsx` L2-3
- **问题**：头注释称「对齐 desktop FetchModelsModal」但 desktop 全目录零匹配，声明失实。
- **改法**：删对照表述改直接描述自身行为。
- **验收与测试要点**：注释无无法解析的仓内实体引用。
- **来源**：第 3 轮专项评审 arch

#### arch/C-3 [P2] ChatConfigScreen 手写常量靠注释维持与 core 同步

- **维度**：C（分层 / 命名）
- **文件**：`apps/mobile/src/screens/stack/ChatConfigScreen.tsx` L25-31
- **问题**：`hideStartDepth:6` 手写配「对齐 core DEFAULT_HIDE_START_DEPTH」注释，同步靠注释非代码，core 改值即静默漂移。
- **改法**：`import {DEFAULT_HIDE_START_DEPTH} from '@novel-master/core/compaction'`（按实际导出路径）替换字面量，删注释。
- **验收与测试要点**：无魔法数；tsc 通过。
- **来源**：第 3 轮专项评审 arch

#### arch/C-4 [P2] 导入风格双轨：@/ 别名与相对路径同文件混用

- **维度**：C（分层 / 命名）
- **文件**：典型 `apps/mobile/src/components/chat/ChatComposer.tsx`（./AttachmentDraftChips 与 @/components/skills/SkillPicker 并存）、`ChatTranscriptWebView.tsx`、`useChatTabMessages.ts`
- **问题**：别名只在 components(64)/screens(115) 成片，其余 16 目录仅 3 处；同文件双风格并存，掩盖 services/A-2 类异常。
- **改法**：导入风格规则已拍板为 B：同目录及子目录用相对路径、跨 src/ 顶层目录用 @/（2026-08-30 用户确认），随 fmt-1 一次性统一。
- **验收与测试要点**：无同文件双风格；可加 eslint import/order + no-restricted-imports 守护。
- **来源**：第 3 轮专项评审 arch

#### arch/C-5 [P2] components 子目录语义三处含混

- **维度**：C（分层 / 命名）
- **文件**：`apps/mobile/src/components/prompt/`（仅 1 文件）与 `components/template/`（仅 1 文件）同域三处散布（prompt 相关还在 components/agent/）；`components/ui/` 混入域专属件（ProfileMenuItem / ProfileSwitchItem / ProfileStatusCard、MonthRangePickerSheet）；`src/provider/`（纯逻辑单文件）与 `components/provider/`（UI）同名不同层
- **问题**：单文件目录与同名跨层目录并存，域归属不可辨，ui/ 通用件与域专属件混放。
- **改法**：随相邻 P2 条目一并处理，三方向已拍板（2026-08-30）——prompt/template 合并进 prompt/ 删空目录；Profile* 三件迁 components/profile/、MonthRangePickerSheet 迁统计域或注释归属；src/provider/ 并入 services/ 消除撞名。
- **验收与测试要点**：无单文件目录；ui/ 内文件被两域以上复用或注释明确归属；provider 路径唯一可辨。
- **来源**：第 3 轮专项评审 arch

#### oq5/nav-rename [P2] ChatTabNavigationProvider 的 sessionListPanel 枚举 'template'→'projects' 语义重命名

- **维度**：C（分层 / 命名）
- **文件**：`apps/mobile/src/screens/tabs/chat-tab/ChatTabNavigationProvider.tsx`
- **问题**：内部映射将 'template' 改写为 'projects'，语义重命名疑历史遗留。
- **改法**：git blame 确认来历；确认该枚举仅存活于内存导航 state（无落库/持久化）后将对外值统一为 'projects'，删除重命名映射。
- **验收与测试要点**：chat tab 列表面板切换回归；grep 'template' 面板枚举零残留。
- **来源**：第 1 轮 screens OQ5 拍板（2026-08-30）

#### oq12/update-check-split [P2] useAutoUpdateCheck 拆 service + 薄 hook

- **维度**：C（分层 / 结构拆分）
- **文件**：`apps/mobile/src/hooks/useAutoUpdateCheck.ts`
- **问题**：hook 返回 ReactNode 的混合模式（检查+Alert+toast+持久化+渲染 modal 在一个函数），且 hooks 层依赖 components（渲染 UpdateCheckResultModal），违反拍板的分层规则（hooks 不允许依赖 components）。
- **改法**：拆出 update-check-flow service（纯逻辑：检查、snooze、持久化决策），hook 只留状态绑定与渲染；modal 渲染挪到组件层（如 App 根挂 UpdateCheckHost）。
- **验收与测试要点**：自动检查/手动检查/snooze/外跳行为回归；hooks/ 下不再 import components/。
- **来源**：services OQ12 拍板（2026-08-30）

#### oq13/infra-cleanup-2 [P2] infra 死代码与归位第二批

- **维度**：C（死代码清理 / 归位）
- **文件**：`apps/mobile/src/storage/app-ui-prefs.ts`（appUiKeys helper）、`storage/chat-annotate-draft.ts`（re-export 门面）、`storage/` 下 readRichRenderEpoch 导出、`storage/fill-policy-mobile.ts`
- **问题**：appUiKeys 只收两键且一半无消费方；chat-annotate-draft 纯 re-export 门面与直连 core 双轨并存；readRichRenderEpoch 仅测试使用；fill-policy-mobile 是纯 UI 领域映射却放 storage/。
- **改法**：删 appUiKeys（调用方改直接用常量）；删 chat-annotate-draft 门面（调用方直连 @novel-master/core/chat）；readRichRenderEpoch 删除并同步改其测试；fill-policy-mobile 迁 services/（或 utils/），并在两目录 README/注释写明边界口径「storage/ 只放持久化格式与读写，纯领域映射不进」。
- **验收与测试要点**：tsc+jest 全绿；grep 零残留；fill-policy 引用方路径更新。
- **来源**：infra OQ13 拍板（2026-08-30）

#### oq14/align-tests [P2] 双端双份实现加对齐测试

- **维度**：G（测试守护）
- **文件**：`components/rich-content/decode-literal-html-entities.ts` 与 `src/web/shared/decode-entities.ts`；`components/rich-content/highlight-code.ts` 的 LANG_ALIAS 与 desktop 的 FENCE_LANG_ALIAS
- **问题**：两对实现靠注释声明「须语义对齐」，无测试守护，漂移静默。
- **改法**：decode-entities 加对齐快照测试（同一组实体输入断言双端输出一致）；LANG_ALIAS 若可跨包 import 则把表升 core 让双端同源，不可行则加一致性测试断言两表相等。
- **验收与测试要点**：新增测试入 `__tests__`；人为改任一侧测试变红。
- **来源**：comp-misc OQ14 拍板（2026-08-30）

#### oq15/comp-chat-cleanup-2 [P2] comp-chat 第二批清理

- **维度**：C（死代码清理 / 重复收敛）
- **文件**：`components/chat/MessageActionMenu.tsx`（L39-43 三个 re-export）、`AttachmentDraftChips.tsx`（有叉分支）、`message-blocks.ts`（L344/L419 重复谓词）、`MessageList.tsx`（@deprecated）
- **问题**：re-export 疑死代码；有叉 attach 分支注释自认废止且唯一调用传 false；user_ops 过滤布尔表达式写两遍；MessageList 去留未定。
- **改法**：grep 确认三个 re-export 零引用后删；删 AttachmentDraftChips 的 showRemove/onRemove 分支连同样式；抽 isDisplayableAttachment(a) 供两处调用；MessageList 先查 RN 引擎回退路径（chatRichText 关闭/超限/vfs rn 引擎）是否依赖——依赖则保留并注明，不依赖则删除。
- **验收与测试要点**：tsc+jest 全绿；grep 零残留；chatRichText 开关两态渲染回归。
- **来源**：comp-chat OQ15 拍板（2026-08-30）

#### oq17/backup-notice [P2] 备份导出加明文提示

- **维度**：D（安全 / 用户提示）
- **文件**：`services/db-backup.service.ts` 及导出入口 UI
- **问题**：备份为聊天库明文导出、无任何提示（API key 已 scrub 不入备份，该环节闭环）。
- **改法**：导出确认流程加提示文案「备份文件包含聊天记录明文，请妥善保管」；加密选项不做（等真实用户需求）。
- **验收与测试要点**：导出流程可见提示；导出行为不变。
- **来源**：sec OQ17 拍板（2026-08-30）

#### oq18/sksp-platform [P2] SKSP 驱动硬编码 'android'

- **维度**：B（行为正确性 / 平台兼容）
- **文件**：`runtime/create-mobile-runtime.ts:70`
- **问题**：写死 resolveSkspDriver('android')，iOS 上 Keystore 模块不存在会抛 NOT_REGISTERED，报错不可读。
- **改法**：改 Platform.OS 判断——android 走 sksp-android；其余平台抛含平台名的可读错误（「iOS 暂不支持加密存储驱动」）；iOS driver 是否补齐单独立项。
- **验收与测试要点**：单测 mock Platform.OS='ios' 断言报错信息可读。
- **来源**：sec OQ18 拍板（2026-08-30）

#### oq21/typed-eslint [P2] 对逻辑层开 typed ESLint

- **维度**：A（工程基建 / lint 门禁）
- **文件**：`apps/mobile/eslint.config.mjs`
- **问题**：无类型感知规则，no-floating-promises/no-misused-promises 全不设防（infra/B-2、b2/B-5 正是该缺口实例）；全量开 projectService 成本过高（配置注释已言明）。
- **改法**：只对 src/services/**、src/runtime/**、src/storage/** 三个逻辑目录开 typed block（projectService:true），启用 no-floating-promises、no-misused-promises（先 warn 配 --max-warnings 锁存量，随清理降）；components/screens 暂缓。
- **验收与测试要点**：eslint 可跑通；三个目录下 fire-and-forget 新增会被警告。
- **来源**：gates OQ21 拍板（2026-08-30）

#### oq23/nightly-android [P2] CI 加 nightly Android assembleDebug

- **维度**：A（工程基建 / CI 门禁）
- **文件**：`.github/workflows/`（新增或改 ci.yml）
- **问题**：原生侧编译错误零门禁（RN 项目常见缺口）。
- **改法**：加 schedule 触发（nightly）的 android assembleDebug job（不进 PR 路径，避免拖慢）；失败通知走默认 actions 通知。
- **验收与测试要点**：nightly job 跑通一次绿；故意引入原生编译错误的分支仅 nightly 红。
- **来源**：gates OQ23 拍板（2026-08-30）

#### oq3/manageheader-merge [P2] ManageHeader 吸收 VfsBatchHeader

- **维度**：C（组件抽象 / 重复）
- **文件**：`components/chrome/ManageHeader.tsx`（或其所在）、`components/vfs/VfsBatchHeader.tsx`
- **问题**：批量管理工具栏双实现，功能高度重叠（ManageHeader 已泛化 primaryActionLabel/onSelectAll）。
- **改法**：ManageHeader 的操作区改 actions 数组化（支持主操作+次操作如「移动」），VfsFileManager 换用后删除 VfsBatchHeader；视觉差异（padding 12 vs 5）以样式 prop 吸收，视觉对齐成本已拍板接受。排期注：P2 尾部执行，且须在 screens/C-1 批量样板收敛之后。
- **验收与测试要点**：VFS 批量进出/计数/移动/删除回归；grep VfsBatchHeader 零残留。
- **来源**：comp-rest OQ3 拍板（2026-08-30）

#### oq7/webview-host-merge [P2] web 侧 webview-host 目录并入 shared

- **维度**：C（分层 / 归属）
- **文件**：`src/web/webview-host/**`（scroll.ts、menu-overlay-guards.ts、mermaid-viewer-gestures.ts 等）
- **问题**：与 RN 侧 `src/webview-host/` 同名不同物，检索易混；内容本质是 web 共享纯函数。
- **改法**：目录整体迁入 `src/web/shared/`（如 web/shared/chat-transcript-pure/ 或按归属分入 shared 子目录），更新全部 import 与测试引用；RN 侧 `src/webview-host/` 保持不动。与 web/C-orch-4（anchored-menu-layout 落点）、web/C-orch-6（gestures 迁移）同批执行避免二次改路径。
- **验收与测试要点**：typecheck+jest 全绿；grep 'web/webview-host' 零残留；src/webview-host/ 不受影响。
- **来源**：web OQ7 拍板（2026-08-30）

## Spec deviations

none

## 已拍板决议（2026-08-30 用户确认按建议执行）

原 Open questions 30 条已全部按评审建议拍板并回写本 spec，后续 wave 直接按本记录执行，不再逐条确认。

### 并入 must-fix 的决议（30 条逐条）

1. `FormErrorCard` 删（comp-rest/C-8 已更新）。
2. `FormChipGroup` 保留不内联。
3. `ManageHeader` 吸收 `VfsBatchHeader`、`RegexGroupsScreen` 直接换用（screens/C-12 已更新、新增 oq3/manageheader-merge）。
4. `AGENT_LOCK_TOAST` 有意分化 + 修注释 + 统一挪 chat-agent-meta（screens/C-11 已更新）。
5. 统一 'projects' 命名（新增 oq5/nav-rename）。
6. `applyTheme` 条件式写入 + CSS 兜底（web/C-orch-2 已更新）；tokens 全面收敛单独立项。
7. web/webview-host 并入 shared（新增 oq7/webview-host-merge）。
8. tsconfig.webview-boot.json 退役（web/A-1 已更新）。
9. bridge 统一单文件（web/C-orch-1 已更新）。
10. stream-buffer 删除已确认（services/C-1 已更新）。
11. assertZipArchive 升 core 单独立项，不进本 spec。
12. useAutoUpdateCheck 拆分（新增 oq12/update-check-split）；`.service.ts` 规则 = 有状态/编排类带、纯函数不带（只管增量不回改）。
13. appUiKeys 删（infra/C-2 已更新）、门面删、readRichRenderEpoch 删、fill-policy 迁出（新增 oq13/infra-cleanup-2）。
14. RichContentBody 保留（comp-misc/C-1 已更新）、对齐测试（新增 oq14/align-tests）。
15. re-exports/有叉分支删、isDisplayableAttachment 抽、Bridge 不改名、MessageList 查证后定（新增 oq15/comp-chat-cleanup-2）。
16. CSS 白名单（comp-misc/B-2 升 P1 已更新）。
17. 备份提示（新增 oq17/backup-notice）。
18. SKSP 平台判断（新增 oq18/sksp-platform）。
19. allowFileAccessFromFileURLs 收紧评估（sec/D-1 验收已追加）。
20. debug-fetch 补遮 api-key 随 sec/D-2 顺手修。
21. typed ESLint 三目录（新增 oq21/typed-eslint）。
22. metro smoke 机制单独立项。
23. nightly assembleDebug（新增 oq23/nightly-android）。
24. 导入风格定 B（fmt-1/arch/C-4 已更新）。
25. hooks 不允许依赖 components（随 oq12 落地，可加 no-restricted-imports 守护）。
26. Profile* 迁 components/profile/、MonthRangePickerSheet 归统计域（arch/C-5 已更新）。
27. prompt/template 合并进 prompt/（arch/C-5 已更新）。
28. src/provider/ 并入 services/（arch/C-5 已更新）。
29. 补测按「重构波及到哪补到哪」摊进各 P2 验收，不单独排期。
30. integration 宽 mock 随 screens/C-5 拆分顺带收敛。

### 单独立项记录（不进本 spec）

- web HostTheme fallback 与 tokens 全面收敛（#6 后半）。
- assertZipArchive / vfsZipExportFileName 升 core（#11）。
- metro coreDistSmokeFiles 机制改造（#22）。
- iOS sksp driver 补齐（#18 后半）。

### 勘误记录（原第 31 条，保留原文）

31. 第 1 轮「components/chat 31 文件零测试」口径有误——实测 34 个测试文件引用 components/chat、覆盖约 21/31 源文件，未覆盖的约 10 个文件补测时以此为准。

## 已豁免（用户确认不修）

暂无。

## 合并后 QA（manual_user，不阻塞）

fix wave 合并后的人工回归清单，各条目与对应改动关联：

1. Android 五屏键盘回归（chat 会话 / file 编辑 / prompt 编辑 / 历史搜索 / 会话详情改名）——screens/C-2、screens/C-8 改后必测。
2. 导出/导入全链手测：数据库备份、VFS zip、角色卡、agent YAML（含取消分支后检查 CacheDir 无残留）——services/C-2、C-3 改后必测。
3. 弹窗族回归：遮罩点击关闭、Android 返回键、键盘避让（ModalShell 替换的 16 处）——comp-rest/C-1、C-2 改后必测。
4. dark 模式启动错误屏文字可读——infra/C-7。
5. mermaid 全屏（chat 与 rich-document 两域）进出自如——web/C-orch-5。
6. 三 webview 域主题切换后 CSS 变量正确——web/C-orch-2。
7. composer @/$ 四条插入路径真机验证——comp-chat/C-1。
8. 删除 `react-native-render-html` 后打包体积与运行时验证——comp-misc/C-1。
9. 点消息内链接应唤起系统浏览器且 WebView 不离页；伪造桥消息不触发 rollback——sec/D-1。
10. chatRichText 开关两态 + RN 引擎回退路径渲染回归（oq15）。
11. 备份导出提示可见（oq17）。

## K 节建议（下游执行时闭合）

1. fmt-1 执行时全量 `prettier --write` 后跑一次 `lint --fix` 清理残余 warning。
2. 各死代码条目删除后全仓 grep 验证零残留。
3. 重命名类条目（PrototypeButtons→Buttons、mermaid-viewer-gestures 迁移）同步更新 `__tests__` 与 e2e 引用。
4. 完成后按 novel-master-changelog skill 补 CHANGELOG Unreleased 条目。
5. `tsconfig.webview-boot.json` 若退役，同步更新 `package.json` scripts 与 README。
6. oq21 typed ESLint 先 warn 锁存量，与 gates/G-2 的 `--max-warnings` 节奏对齐。
