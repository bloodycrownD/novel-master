---
date: 2026-08-27
---

# 输入抖动 / 项目工作区返回 / 提示词长文本编辑 技术规格（SPEC）

需求来源：`docs/Iterations/ux-fixes-2026-08/prd.md`（R1 输入稳定 / R2 项目工作区逐级返回 / R3 超长折叠 + 全屏编辑）。

## 设计目标

- R1：Android 输入框存在 `@路径` / `$技能` 引用 tag 且多行文本时，连续输入/删除不再出现内容上下抖动，保留 tag 着色胶囊视觉。
- R2：「项目工作区」的 Android 返回行为与「聊天工作区」完全一致（先逐级退目录，根目录才回会话列表）。
- R3：双端 agent 配置页 6 类提示词输入点支持「超长折叠（默认 600 字符、3 行省略）+ 全屏编辑（保存回填/取消不动）；未超阈原地编辑；失焦才折叠不抢焦点；内联态宏能力保留」。

## 总体方案

三条独立的修复线，互不依赖，可并行实现：

1. **R1（mobile composer）**：根因定位为 mention 胶囊 `paddingHorizontal: 3` 使 tag 比同长度纯文本宽 6px，多行文本接近换行阈值时，JS 侧带样式测量与原生测量的换行点在两次渲染间来回跳，行数 ±1 导致输入框在 56~160 的高度档位间跳变。修复：去掉两个 trigger `textStyle` 的水平 padding，保留 `backgroundColor + borderRadius` 胶囊（不改水平测量）。真机验收后追加第二层修复（变更点 #17）：库的 children 全量重建机制仍在，但纯打字时原生侧文本已最新、重推是冗余的——在 wrapper 层对「新 children 纯文本 == 原生最近上报文本且 mention 集合未变」的场景复用 children 元素，跳过原生 spannable 重推，消除 tag 每键闪烁。
2. **R2（mobile 项目工作区返回）**：`VfsFileManager` 已通过 `useImperativeHandle` 暴露 `canGoUp()/goUp()` 并支持 `onDirectoryChange` 回调，聊天工作区（`ChatConversationPanel`）已把该状态注册进 `ChatTabNavigationProvider` 的 `WorkspaceBackCtx`；项目工作区（`ChatSessionListPanel`）缺 ref 接线与注册，且 `useAndroidChatBackHandler` 的 `template` 分支无条件 `showSessionsPanel()`。修复：补齐接线（面板不可见时注册 `null`，与聊天工作区互斥），handler 分支改为「先 `workspaceGoUp()`，根目录才 `showSessionsPanel()`」。
3. **R3（双端提示词折叠 + 全屏编辑）**：
   - **mobile**：新建 `ExpandablePromptInput` 包装组件（render-prop 注入 `onBlur`，因为 RN 事件不冒泡）+ 新建轻量 stack 路由 `PromptEditor`（函数作路由参数，仿 `FileEditor` 的 `onSessionVfsSaved` 先例），全屏编辑内核复用仓库内 `CodeEditorWebView`（受控 `value/onChange`，伪路径 `prompt.txt` 走纯文本高亮）。`PromptMacroTextInput` 补可选 `onFocus`/`onBlur` 透传。
   - **desktop**：新建自包含 `PromptCollapsibleField` 组件（children 承载内联编辑器以保留 `PromptMacroTextarea` 宏能力与 Enter 快捷键；React 合成 focus 事件冒泡，外层 div 可捕获 focus/blur 做失焦折叠），全屏编辑用内嵌 Modal（复用 `.text-prompt-overlay`）+ 现成 `CodeEditor`（`languagePath="prompt.txt"` 即纯文本），草稿副本编辑、保存才回填。
   - 阈值常量双端各自定义（mobile `components/agent/prompt-collapse.ts`、desktop `features/settings/prompt-collapse.ts`；后经拍板改为行数/高度判定：`PROMPT_INLINE_MAX_LINES = 5` + 实测高度/DOM 溢出判定 + `PROMPT_PREVIEW_LINES = 3`，见变更点 #18），便于测试与调整。

## 最终项目结构

```
apps/mobile/src/
  components/agent/
    ExpandablePromptInput.tsx        # 新增：超长折叠包装（render-prop）
    prompt-collapse.ts               # 新增：阈值常量 + isPromptCollapsed
    PromptMacroTextInput.tsx         # 修改：补 onFocus/onBlur 透传
    AgentEditorForm.tsx              # 修改：6 输入点接折叠层
  components/chat/
    ComposerAtPathInput.tsx          # 修改：mention textStyle 去水平 padding
  components/vfs/
    CodeEditorWebView.tsx            # 修改（条件性）：value 未变时跳过 setDocument 下发
  navigation/
    types.ts                         # 修改：RootStackParamList 增 PromptEditor
    RootNavigator.tsx                # 修改：注册 PromptEditor
    header-config.ts                 # 修改：PromptEditor 标题条目
  screens/stack/
    PromptEditorScreen.tsx           # 新增：全屏提示词编辑页
  screens/tabs/chat-tab/
    ChatSessionListPanel.tsx         # 修改：注册 WorkspaceBackCtx
  hooks/
    useAndroidChatBackHandler.ts     # 修改：template 分支逐级退目录
apps/mobile/__tests__/
  composer-at-path.test.tsx          # 修改：T-C1 样式断言
  use-android-chat-back-handler.test.ts  # 修改：T-B5b
  expandable-prompt-input.test.tsx   # 新增
  prompt-editor-screen.test.tsx      # 新增
  agent-editor-form-delete-confirm.test.tsx  # 修改：navigation mock 补 push
apps/desktop/renderer/
  features/settings/
    PromptCollapsibleField.tsx       # 新增：折叠 + 内嵌全屏 Modal
    prompt-collapse.ts               # 新增：阈值常量 + isPromptCollapsed
    AgentEditorView.tsx              # 修改：5 输入点接折叠层
    AgentWorkplaceBlockCard.tsx      # 修改：内部 textarea 换折叠组件（props 不变）
  styles/shell.css                   # 修改：新增 clamp 与全屏 Modal 样式类
```

## 变更点清单

| # | 文件 | 变更 | 来源证据 |
|---|---|---|---|
| 1 | `apps/mobile/src/components/chat/ComposerAtPathInput.tsx` | 两处 trigger `textStyle` 去掉 `paddingHorizontal: 3`（L102-107、L116-121），补注释说明宽度中性原因 | 探索报告 A |
| 2 | `apps/mobile/src/hooks/useAndroidChatBackHandler.ts` | `template` 分支加「先 `workspaceGoUp()` 再 `showSessionsPanel()`」；头注释同步（L137-140 附近） | 探索报告（brain-storm 轮） |
| 3 | `apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx` | 新增 `projectVfsRef` + `emitWorkspaceBackState`（`visible && sessionListPanel==='template'` 才注册，否则 `null`），`VfsFileManager` 传 `ref` + `onDirectoryChange` | 同上 |
| 4 | `apps/mobile/src/components/agent/PromptMacroTextInput.tsx` | 增可选 `onFocus?/onBlur?` props，透传给内部 `FormTextInput`（现签名无透传，L22-27） | 探索报告 B1 |
| 5 | `apps/mobile/src/components/agent/prompt-collapse.ts` | 新增 `PROMPT_COLLAPSE_THRESHOLD = 600`、`isPromptCollapsed()` | PRD R3 |
| 6 | `apps/mobile/src/components/agent/ExpandablePromptInput.tsx` | 新增包装组件：`value/onChangeText/renderInline({onFocus,onBlur})/openEditor`；`value` 超阈且非「聚焦保持」时渲染 `Pressable + Text numberOfLines={3}` 折叠态，点击调 `openEditor`；展开按钮 `onPress` 前置 `pendingOpenRef` 防 blur 折叠竞态 | 探索报告 B1 |
| 7 | `apps/mobile/src/navigation/types.ts` | `RootStackParamList` 增 `PromptEditor: { title?: string; initialText: string; onSaved?: (text: string) => void }`（仿 `onSessionVfsSaved` L45） | 探索报告 B1 |
| 8 | `apps/mobile/src/screens/stack/PromptEditorScreen.tsx` | 新增：草稿 state 初值 `route.params.initialText`；`CodeEditorWebView value={draft} path="prompt.txt" onChange={setDraft}`；屏内顶部「保存/取消」，保存调 `onSaved(draft)` 后 `goBack()`，取消直接 `goBack()`（Android 返回键默认即取消） | 探索报告 B1 |
| 9 | `apps/mobile/src/navigation/RootNavigator.tsx` + `header-config.ts` | 模块级 `withStackLayout('PromptEditor', PromptEditorScreen)` + `<Stack.Screen>`（照抄 FileEditor 模式 L149/L216）；header 条目 `{ title: '编辑提示词', showBack: true, showNav: false }`（title 参数可覆盖） | 探索报告 B1 |
| 10 | `apps/mobile/src/components/agent/AgentEditorForm.tsx` | 6 输入点（L906/L935/L976/L1079/L1115/L1222 附近）外包 `ExpandablePromptInput`，`renderInline` 渲染现有 `FormTextInput`/`PromptMacroTextInput`，`openEditor` 为 `navigation.push('PromptEditor', {title, initialText, onSaved: setter})`；persist/dynamic 用现有 `mapPersistTextBlocks` / `setDynamic` map 闭包回填（注意 persist 是 filter 后 text 块 index） | 探索报告 B1 |
| 11 | `apps/mobile/src/components/vfs/CodeEditorWebView.tsx` | **条件性**：核对 web 侧 `setDocument` 是否有文本相等短路；若无，RN 侧 effect 在 `value === lastOnChangeValue` 时跳过下发（防受控回环重置光标）。有短路则本项零改动 | 探索报告 B1 疑点 1 |
| 12 | `apps/desktop/renderer/features/settings/prompt-collapse.ts` | 同 #5 | PRD R3 |
| 13 | `apps/desktop/renderer/features/settings/PromptCollapsibleField.tsx` | 新增自包含组件：`{ value, onChange, children, ariaLabel? }`；短文本（或聚焦保持）渲染 `children`（外层 div 捕获冒泡的 `onFocus/onBlur`）；超阈失焦渲染 3 行 clamp 预览（点击展开 Modal）；Modal 内 `CodeEditor languagePath="prompt.txt"` 编辑草稿副本，保存（按钮或 Mod-s）才 `onChange(draft)` 并关闭，取消不动；展开交互用 `onPointerDown` 置 `pendingOpenRef` 防 blur 竞态 | 探索报告 B2 |
| 14 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx` | 5 输入点（L796/L831/L964/L1013/L1153 附近）textarea/PromptMacroTextarea 外包 `PromptCollapsibleField`（children 承载原编辑器，Enter 快捷键与宏 chips 保留在 inline 态） | 探索报告 B2 |
| 15 | `apps/desktop/renderer/features/settings/AgentWorkplaceBlockCard.tsx` | 组件内部 L55-61 的 textarea 换 `PromptCollapsibleField`（组件完全受控、props 不变，两个调用方零改动） | 探索报告 B2 |
| 16 | `apps/desktop/renderer/styles/shell.css` | 新增 `.prompt-field-clamp`（3 行 line-clamp，仿 `.chat-message__body-clamp` L3949）与 `.prompt-editor-modal`（近全屏内容区，overlay 复用 `.text-prompt-overlay` L5182） | 探索报告 B2 |
| 17 | `apps/mobile/src/components/chat/ComposerAtPathInput.tsx` | 真机验收追加：children 复用治理——新 children 纯文本 == 原生最近上报文本（handleChangeText 维护 lastNativePlainRef）且 mention 集合签名未变时复用上一份 children 元素，跳过原生 spannable 重推；程序化写入/水化/typeahead 点选/原子删自然重推（99f5299，T-C3/T-C4） | 用户真机反馈 |
| 18 | 双端 `prompt-collapse.ts` 及折叠组件 | 阈值拍板变更：从「600 字符」改为「超过 5 行折叠、预览 3 行」——mobile 以 onContentSizeChange 实测内容高度（>110px）判定、未测量前以换行数初判；desktop 以 DOM 实测（textarea scrollHeight > clientHeight）判定，useLayoutEffect 防首帧闪撑（259973e/238400a/b907dba） | 用户验收反馈 |

## 详细实现步骤

- Step 1 — phase-composer-stable — blocking: yes — qa: auto：`ComposerAtPathInput.tsx` 两处 `textStyle` 去掉 `paddingHorizontal: 3`，补宽度中性注释（变更点 #1）。
- Step 2 — phase-composer-stable — blocking: yes — qa: manual_user：Android 真机回归：引用 tag + 多行文本连续输入/删除无上下抖动、胶囊着色正常（T-C2）。
- Step 3 — phase-workspace-back — blocking: yes — qa: auto：`useAndroidChatBackHandler.ts` template 分支改为先 `workspaceGoUp()` 再 `showSessionsPanel()`，更新头注释（#2）。
- Step 4 — phase-workspace-back — blocking: yes — qa: auto：`ChatSessionListPanel.tsx` 补 ref + `emitWorkspaceBackState`（visible 门控）+ `onDirectoryChange` 接线（#3）。
- Step 5 — phase-workspace-back — blocking: yes — qa: auto：补 `use-android-chat-back-handler.test.ts` 的 T-B5b 用例。
- Step 6 — phase-prompt-collapse-mobile — blocking: yes — qa: auto：`PromptMacroTextInput` 增 `onFocus/onBlur` 可选透传（#4）。
- Step 7 — phase-prompt-collapse-mobile — blocking: yes — qa: auto：新增 `prompt-collapse.ts` 与 `ExpandablePromptInput.tsx`（#5、#6）。
- Step 8 — phase-prompt-collapse-mobile — blocking: yes — qa: auto：新增 `PromptEditorScreen` + 路由注册（#7、#8、#9）；同步核对 `CodeEditorWebView` 受控回环（#11），必要时加相等短路。
- Step 9 — phase-prompt-collapse-mobile — blocking: yes — qa: auto：`AgentEditorForm.tsx` 六输入点接折叠层（#10）；`agent-editor-form-delete-confirm.test.tsx` 的 `useNavigation` mock 补 `push`。
- Step 10 — phase-prompt-collapse-mobile — blocking: yes — qa: manual_user：mobile 手动验收折叠/展开/保存/取消/失焦折叠全链路（T-PE 系列的真机部分）。
- Step 11 — phase-prompt-collapse-desktop — blocking: yes — qa: auto：`shell.css` 新增两个样式类（#16）。
- Step 12 — phase-prompt-collapse-desktop — blocking: yes — qa: auto：新增 `prompt-collapse.ts` 与 `PromptCollapsibleField.tsx`（#12、#13）。
- Step 13 — phase-prompt-collapse-desktop — blocking: yes — qa: manual_user：`AgentEditorView` 5 点 + `AgentWorkplaceBlockCard` 内部替换（#14、#15）；desktop 手动验收（T-PD1）。
- Step 14 — phase-verify — blocking: yes — qa: auto：mobile `npm run typecheck` + `npm run test`；desktop `npm run typecheck`（含 `npx tsc --noEmit -p tsconfig.renderer.json` 兜底）+ `npm run lint`。
- Step 15 — phase-composer-stable — blocking: yes — qa: auto：真机验收反馈追加：children 复用治理消除 tag 每键闪烁（变更点 #17，T-C3/T-C4）。
- Step 16 — phase-prompt-collapse-mobile — blocking: yes — qa: auto：阈值改行数：实测内容高度 + 换行数初判（变更点 #18 mobile 部分）。
- Step 17 — phase-prompt-collapse-desktop — blocking: yes — qa: manual_user：阈值改行数：DOM 实测溢出判定（变更点 #18 desktop 部分）。

## 测试策略

- 单测环境：mobile 用 jest + `react-test-renderer`（无 @testing-library，沿用 TestRenderer 断言 props/children 树的既有风格）；desktop 无 renderer 组件测试基建，以 typecheck + 手动验收覆盖。
- 抖动（R1）与真机交互为原生布局时序问题，jest 测不到，验收以真机为准（PRD 已声明）。

### 测试用例

- T-C1 — blocking: yes — qa: auto（Step 1）：渲染 `ComposerAtPathInput`，从 `TextInput` 的 children 树中找带 `backgroundColor` 的 Text，断言其 `style` 不含 `paddingHorizontal`（仿 `composer-at-path.test.tsx` T-SC1 的断言手法）。
- T-C3 — blocking: yes — qa: auto（Step 15）：纯打字（原生 onChangeText 上报）且 mention 集合未变时，`TextInput.children` 元素引用复用不变（不重推原生）。
- T-C4 — blocking: yes — qa: auto（Step 15）：程序化 `replaceCommittedText` 推进新 children（引用变化）。
- T-C2 — blocking: yes — qa: manual_user（Step 2）：Android 真机，引用 tag + 多行文本连续输入/删除，内容无上下抖动、tag 胶囊正常、无 tag 场景无回归。
- T-B5b — blocking: yes — qa: auto（Step 3/5）：`sessionListPanel: 'template'` 且 `workspaceCanGoUp: true` 时 handler 调 `workspaceGoUp`、不调 `showSessionsPanel`；根目录（false）才 `showSessionsPanel`（T-B5 原用例保持）。
- T-PM1 — blocking: yes — qa: auto（Step 6）：`PromptMacroTextInput` 透传的 `onFocus/onBlur` 能被触发。
- T-PE1 — blocking: yes — qa: auto（Step 7/9）：`value` 未超阈渲染 inline 编辑器；超阈渲染折叠态（3 行省略），点击触发 `openEditor`。
- T-PE2 — blocking: yes — qa: auto（Step 7/9）：聚焦中超过阈值不折叠；失焦后折叠；`value` 回落到阈值下自动回 inline。
- T-PE3 — blocking: yes — qa: auto（Step 8）：`PromptEditorScreen` 保存时以草稿调用 `onSaved` 并 `goBack`；取消不调用 `onSaved`。
- T-PD1 — blocking: yes — qa: manual_user（Step 13）：desktop 折叠展示 3 行省略、点击进全屏 Modal、Mod-s/按钮保存回填、取消不动、内联 Enter 快捷键与宏 chips 无回归、workplace 卡片行为正常。
- T-V1 — blocking: yes — qa: auto（Step 14）：双端 typecheck 与 mobile 全量 jest、desktop lint 全绿。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|---|---|---|
| R1 去 padding 后真机仍抖（根因在库 children 全量重建） | Step 2 真机回归判定；PRD 已预告「高亮层与输入分离」为后备，另行立项 | 还原 `textStyle` 两行即可，无数据/接口影响 |
| `ComposerAtPathInput.tsx` 编辑器里存在未保存缓冲（与本 spec Step 1 方向相同的旧编辑残留） | 实现前先在编辑器丢弃该缓冲，以磁盘/HEAD 为基线，避免脏合并 | — |
| `CodeEditorWebView` 受控回环（web 侧无文本相等短路时，编辑中 `setDocument` 重发重置光标） | Step 8 先核对 web bridge；无短路则在 RN 侧 effect 加 `value === lastOnChangeValue` 跳过 | 短路逻辑独立、可单独还原 |
| persist 块按 filter 后 text 块 index 回填错位 | `openEditor` 闭包捕获当次渲染的 index/setter，回填沿用现有 `mapPersistTextBlocks` 语义；全屏期间无并发增删（同屏互斥） | 折叠层不改变列表结构，回滚只还原包装 |
| desktop Modal 层级被设置层遮挡 / `--wide` 宽度不符 | 新建 `.prompt-editor-modal` 近全屏类，实测 `z-index: 1300` 与设置层层叠关系 | 样式类独立可单独移除 |
| desktop dynamic 块在全屏 Modal 中无宏高亮/原子删/chips | PRD R7 已拍板：全屏态宏以纯文本呈现，内容不丢、回填后宏继续生效；inline 态保留全部宏能力 | — |
| 既有测试 mock 面不足（`useNavigation` 只有 `goBack`、`FormTextInput` mock 为 null） | Step 9 同步补 mock；新组件独立测试文件 | — |
