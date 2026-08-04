---
date: 2026-08-04
---

# Agent 配置附加信息与遗留清理 技术规格（SPEC）

需求来源：`docs/Iterations/agent-config-extra-info-and-workplace-cleanup/prd.md`（标准 PRD，`dependency` 指向 `Iterations/message-attachment-unified/prd.md`）。

本 SPEC 覆盖 PRD 的三件事：① mobile 公共表单壳键盘避让修复；② agent 配置新增 `customAttach`（产品名「自定义附加信息」）开关 + 输入框，运行时拼装为 `<extra-info>` 块；③ workplace 附件死代码清理。

> 术语约定：本 SPEC 用 `customAttach` 指代 agent 配置字段名（与 `system`/`workplace` 同层），用 `<extra-info>` 指代运行时拼装出的提示词块名，用 `extraInfo` 指代 `wrapUserMessageForLlm`/prepare 链路里的注入参数名。

## 设计目标

- 让 mobile 表单页键盘行为与聊天页一致：键盘弹起时内容区真正收缩到键盘上方（非 `translateY` 平移），底部输入项可见、顶部不被裁、整页可滚动；一处改、所有复用公共表单壳的页面受益。
- 让 agent 配置具备「常驻附加信息」能力：开关 + 输入框，存储对齐 `workplace`（单字段承载：非空=开、`undefined`=关）；运行时把文本拼成 `<extra-info>` 块注入用户消息提示词。
- 清理消息附件链路里已无写入来源的 workplace 残留（注释、过时描述），同时保证历史会话数据零风险可读。

## 总体方案

三件事互相独立，按三条 phase 推进，互不阻塞：

1. **键盘避让**（phase-keyboard-avoid）：只改 `apps/mobile/src/components/form/ScreenFormLayout.tsx` 一个文件。Android 分支新增内部子组件 `AndroidKeyboardFormBody`，照搬聊天页「`useReanimatedKeyboardAnimation` + `useAnimatedStyle` 算 `marginBottom` + `overflow:hidden` 裁切窗口」范式；iOS 分支把根 `View` 换成 `react-native-keyboard-controller` 的 `KeyboardAvoidingView behavior="padding" automaticOffset`。`footer` 放进收缩体内、`ScrollView` 之后，随键盘一起抬。调用点 7 处零改动。
2. **customAttach 全链路**（phase-custom-attach）：按 `workplace` 的「单字段承载」范式在四层加字段：域模型 → wire schema（`.strict()` 必须声明）→ 表单状态层 → 双端 UI。运行时注入路径：`resolveAgentForProject` 拿到 `definition.prompts.customAttach` → `runner.run({ definition })` → 在 `agent-runner.ts` 调 `prepareUserMessagesForPrompt` 时把 `extraInfo` 透传 → prepare 透传给 `wrapUserMessageForLlm` → wrap 在 `</user-ops>` 之后、`</attachment>` 之前插 `<extra-info>`。预览入口（desktop/mobile `session-prompt-input.service.ts`）同步注入。
3. **workplace 清理**（phase-workplace-cleanup）：**采用策略 A**——保留 schema enum / prepare 读取分支 / wrap 分组 / IPC DTO union / chip 渲染 / 历史兼容测试（因为仓库无 row-level migration 基建，且 `z.array` 全有或全无，收窄 enum 会让历史 `attachments_json` 整条 `safeParse` 失败、整条消息附件全丢）。本次只做：写入侧残留确认（已无写入源，代码已干净）、过时注释修正、可选地收窄纯展示层。

> 为什么 workplace 不收窄 schema：`parseAttachmentsJson` 用 `messageAttachmentsSchema.safeParse`，`z.array(messageAttachmentSchema)` 是全有或全无——只要数组里有一条 `source:"workplace"` 在收窄后 enum 里不合法，整条消息的 `attachments_json` 就 parse 失败返回 `undefined`，该消息所有附件（不止 workplace 那条）全丢。仓库唯一的「迁移」设施 `schema-column-alignments.ts` 只做 `ADD COLUMN`，不处理行内 JSON 内容改写。因此收窄 schema 需要先引入 row rewrite 基建，超出本次范围，归入「风险与回滚」的后续项。

## 最终项目结构

本次不新增模块、不新增目录。改动集中在既有文件：

- `apps/mobile/src/components/form/ScreenFormLayout.tsx`（键盘避让）
- `packages/core/src/domain/prompt/model/agent-prompt-layout.ts`（域字段）
- `packages/core/src/domain/agent/model/agent-definition.schema.ts`（wire schema）
- `packages/core/src/config-forms/agent/agent-editor-state.ts`（表单状态层）
- `packages/core/src/domain/chat/logic/wrap-user-message-for-llm.ts`（wrap 签名 + 拼装）
- `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts`（runtime + 透传）
- `packages/core/src/service/agent/impl/agent-runner.ts`（runner 注入 extraInfo）
- `apps/desktop/src/main/services/session-prompt-input.service.ts`（预览入口）
- `apps/mobile/src/services/session-prompt-input.service.ts`（预览入口）
- `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx`（desktop UI）
- `apps/mobile/src/components/agent/AgentEditorForm.tsx`（mobile UI）
- workplace 清理：注释类改动散落在 `ChatComposer.tsx`、`ipc-types.ts`、`message-attachment.schema.ts`、`prepare-user-messages-for-prompt.ts`、`wrap-user-message-for-llm.ts`、`composer-chip-attachment.ts`、`run-agent-turn.ts`。

## 变更点清单

### A. 键盘避让（phase-keyboard-avoid）

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/components/form/ScreenFormLayout.tsx` | 新增 import（`Platform`、`useReanimatedKeyboardAnimation`、`Animated`/`useAnimatedStyle`、`KeyboardAvoidingView`）；新增内部子组件 `AndroidKeyboardFormBody`；`ScreenFormLayout` 主体按 `Platform.OS` 分支；新增 `keyboardClip`/`keyboardLiftBody` 样式。调用点零改动。 |

### B. customAttach（phase-custom-attach）

| 层 | 文件 | 改动 |
|---|---|---|
| 域模型 | `agent-prompt-layout.ts` | 加 `readonly customAttach?: string`；可选加 `layoutHasCustomAttach(layout)` 辅助（仿 `layoutHasWorkplace`） |
| wire schema | `agent-definition.schema.ts` | `promptsDocumentSchema` 加 `customAttach: z.string().refine(s => s.trim().length > 0).optional()`（**无需 boolean 兼容**，新字段无历史值）；`documentToDefinition` 透传；`definitionToDocument` 条件 spread（trim 非空才写） |
| 表单状态层 | `agent-editor-state.ts` | `AgentEditorFormInput` 加 `customAttachEnabled: boolean` + `customAttachText: string`；`createDefaultAgentEditorPrompts` 默认 false/`""`；`definitionToForm` 用 `layoutHasCustomAttach` 反推 enabled；`layoutFromFormInput` trim + 条件 spread；`formSnapshotJson` 纳入两字段（否则 dirty 判定漏）；**不**计入 `hasAnyPromptRegionEnabled`/`hasEffectivePromptSource`（附加信息不是独立 prompt 源，避免只填 customAttach 就能保存） |
| wrap | `wrap-user-message-for-llm.ts` | 签名加第三参 `extraInfo?: string`（可选，向后兼容）；trim 空 → 不插块；非空 → 在 `</user-ops>` 之后、`</attachment>` 之前插 `<extra-info>\n{每行 4 空格缩进文本}\n  </extra-info>`（缩进对齐 `indentUserOpsBody`） |
| prepare | `prepare-user-messages-for-prompt.ts` | `PrepareUserMessagesForPromptRuntime` 加 `extraInfo?: string`；`prepareOneUserMessage` 调 wrap 时透传 `runtime.extraInfo` |
| runner | `agent-runner.ts` | L213-218 调 prepare 时新增 `extraInfo: options.definition.prompts.customAttach` |
| 预览入口 | `apps/desktop/src/main/services/session-prompt-input.service.ts`、`apps/mobile/src/services/session-prompt-input.service.ts` | 调 prepare 时透传 `extraInfo`（从 `resolveAgentForProject` 拿到的 definition 里取），保证预览/token 计数与真实提示词一致 |
| desktop UI | `AgentDefinitionEditorForm.tsx` | 加 `customAttachEnabled`/`customAttachText` state；在 system/workplace 同区加一组 Switch + textarea（inline 仿 system 区，或抽 `AgentCustomAttachBlockCard` 子组件） |
| mobile UI | `AgentEditorForm.tsx` | 加 state；用 `renderPromptSectionHead` + inline JSX 仿 workplace 区（L978-1035 模板） |

### C. workplace 清理（phase-workplace-cleanup，策略 A）

| 区域 | 动作 |
|---|---|
| schema / prepare 读取分支 / wrap 分组 / IPC DTO union / 历史兼容测试 | **保留不动**（历史 DB 读取兼容，`z.array` 全有或全无，收窄会丢数据） |
| `run-agent-turn.ts` 的 `composerAttachOnly` 过滤 | **保留**（仍要拦 App 误传的 user_ops 预览，不是 workplace 专属）；改过时注释 |
| 写入侧 | 已无写入源（已确认），无需改动 |
| 过时注释 | 全部修正（清单见「详细实现步骤」Step 16） |
| `composer-chip-attachment.ts` 的 `source === "workplace"` 分支 | **可选**移除（已无新数据流入；但历史消息气泡渲染可能命中，删前确认历史渲染不再需要「规则:/path」标签——建议本次**保留**，降低风险） |

## 详细实现步骤

> 标注格式：`Step N — phase-<id> — blocking: yes|no — qa: auto|manual_user`

### phase-keyboard-avoid

- **Step 1 — phase-keyboard-avoid — blocking: yes — qa: auto**：确认 jest 环境已 mock `react-native-reanimated`（`useAnimatedStyle`）。grep `__mocks__/react-native-reanimated` 或读 jest setup；若缺失，补 mock（否则引入 `useAnimatedStyle` 后所有渲染 `ScreenFormLayout` 的测试会抛）。同时读 `apps/mobile/src/components/form/FormOverlayHost.tsx`，确认 overlay/portal 不会被新增的 `overflow:hidden` 裁切层挡住。
- **Step 2 — phase-keyboard-avoid — blocking: yes — qa: auto**：改 `apps/mobile/src/components/form/ScreenFormLayout.tsx`：
  - 新增 import：`Platform` from `react-native`；`useReanimatedKeyboardAnimation`、`KeyboardAvoidingView` from `react-native-keyboard-controller`；`Animated`、`useAnimatedStyle` from `react-native-reanimated`。
  - 新增内部子组件 `AndroidKeyboardFormBody({ tokens, children, footer, scrollEnabled })`：结构为 `Animated.View[styles.keyboardClip, clipStyle]` > `View[styles.keyboardLiftBody]` > `[ScrollView, footer]`；`clipStyle = useAnimatedStyle(() => ({ marginBottom: -keyboardHeightSV.value }), [keyboardHeightSV])`（hook 返回负数，取反得正）；样式 `keyboardClip: { flex:1, minHeight:0, overflow:'hidden' }`、`keyboardLiftBody: { flex:1, minHeight:0 }`，照搬 `ChatConversationPanel.tsx` L399-400。`footer` 放在 `keyboardLiftBody` 内、`ScrollView` 之后。
  - `ScreenFormLayout` 主体按 `Platform.OS === 'android'` 分支：Android 渲染 `<FormOverlayProvider><View style={[root, bg]}><AndroidKeyboardFormBody .../></View></FormOverlayProvider>`；iOS 渲染 `<FormOverlayProvider><KeyboardAvoidingView style={[root, bg]} behavior="padding" automaticOffset><ScrollView .../>{footer}</KeyboardAvoidingView></FormOverlayProvider>`（对齐 `FileEditorScreen.tsx` L374-381）。
  - 保留 `keyboardShouldPersistTaps="handled"` 与现有 `styles.scroll`。
- **Step 3 — phase-keyboard-avoid — blocking: no — qa: manual_user**：真机/模拟器回归所有复用 `ScreenFormLayout` 的页面（agent 编辑、项目级 agent 配置、Provider、CloudSync、Events、ModelSampling、CompactionConditions、RegexRuleEditor）在 Android+iOS 键盘弹起场景：底部多行输入可见、顶部不被裁、可滚动、footer 可点击；重点验 `EventsConfigScreen` 的 `scrollEnabled` 弹层禁滚动交互未被破坏。录屏存档。

### phase-custom-attach

- **Step 4 — phase-custom-attach — blocking: yes — qa: auto**：core 域模型 + wire schema。`agent-prompt-layout.ts` 加 `readonly customAttach?: string`（语义：缺省=关、非空=开），可选加 `layoutHasCustomAttach`。`agent-definition.schema.ts` 在 `promptsDocumentSchema` 加 `customAttach: z.string().refine(s => s.trim().length > 0).optional()`；`documentToDefinition` 透传 `customAttach: doc.prompts.customAttach`；`definitionToDocument` 条件 spread（`typeof === "string" && trim.length>0` 才写）。**注意 `.strict()`：未声明会写盘读不回。**
- **Step 5 — phase-custom-attach — blocking: yes — qa: auto**：core 表单状态层。`agent-editor-state.ts`：`AgentEditorFormInput` 加 `customAttachEnabled` + `customAttachText`；`createDefaultAgentEditorPrompts` 默认 false/`""`；`definitionToForm` 用 `layoutHasCustomAttach` 反推 enabled、文本从 `def.prompts.customAttach ?? ""`；`layoutFromFormInput` trim 后条件 spread；`formSnapshotJson` 纳入两字段。**不**进 `hasAnyPromptRegionEnabled`/`hasEffectivePromptSource`。**不**加开态空文案阻断（PRD：空则静默省略，对齐 wrap 空省略规则）。
- **Step 6 — phase-custom-attach — blocking: yes — qa: auto**：core wrap 签名与拼装。`wrap-user-message-for-llm.ts`：签名加第三参 `extraInfo?: string`（可选，向后兼容现有调用）；实现里 `extraInfo?.trim()` 为空时不插块；非空时在 `</user-ops>` 之后、`</attachment>` 之前插入，格式 `<extra-info>\n{每行 4 空格缩进的文本}\n  </extra-info>`（缩进风格对齐 `indentUserOpsBody`）。
- **Step 7 — phase-custom-attach — blocking: yes — qa: auto**：core prepare + runner 注入。`prepare-user-messages-for-prompt.ts`：`PrepareUserMessagesForPromptRuntime` 加 `extraInfo?: string`；`prepareOneUserMessage` 调 `wrapUserMessageForLlm(plainText, hydrated, runtime.extraInfo)`。`agent-runner.ts` L213-218 调 prepare 的 runtime 字面量加 `extraInfo: options.definition.prompts.customAttach`。
- **Step 8 — phase-custom-attach — blocking: yes — qa: auto**：预览入口同步。`apps/desktop/src/main/services/session-prompt-input.service.ts` 与 `apps/mobile/src/services/session-prompt-input.service.ts`：调 prepare 时透传 `extraInfo`（从 `resolveAgentForProject` 拿到的 definition 里取 `prompts.customAttach`）。确认两端 import 了 `resolveAgentForProject`（探索报告已确认）。
- **Step 9 — phase-custom-attach — blocking: yes — qa: auto**：desktop UI。`AgentDefinitionEditorForm.tsx`：加 `customAttachEnabled`/`customAttachText` state；在 system/workplace 同区加一组 Switch + textarea（inline 仿 system 区 L620-659，或抽 `AgentCustomAttachBlockCard` 子组件仿 `AgentWorkplaceBlockCard`）；接入 `applyDefinitionToFormState`（读入）与 `buildDefinition`（写出，走 `layoutFromFormInput`/`buildAgentDefinitionFromForm`）。
- **Step 10 — phase-custom-attach — blocking: yes — qa: auto**：mobile UI。`AgentEditorForm.tsx`：加 state；用 `renderPromptSectionHead` + inline JSX 仿 workplace 区 L978-1035（`<Switch>` + 开启后 `<FormTextInput multiline>`）；接入 `definitionToForm`/`layoutFromFormInput`。
- **Step 11 — phase-custom-attach — blocking: no — qa: manual_user**：真机/桌面手动验收：开关关 → 不显示输入框、发送消息无 `<extra-info>`；开关开填「当前目录结构为 xxx」→ 每条消息提示词出现 `<extra-info>`、位置在 `<user-ops>` 后 `<user-input>` 前；开但留空 → 不出现；全局 agent 与项目级 agent 两条入口行为一致、关闭重开配置不丢。

### phase-workplace-cleanup

- **Step 12 — phase-workplace-cleanup — blocking: no — qa: auto**：再次确认写入侧已无 workplace 产出（应已干净）：grep 全仓构造 `source: "workplace"` 字面量的代码点，确认只在 schema enum 声明、prepare 读取判定、chip 分流判定、DTO union、测试夹具里出现，无新写入构造点。
- **Step 13 — phase-workplace-cleanup — blocking: no — qa: auto**：修正过时注释（不改正确保留的代码逻辑）：
  - `apps/desktop/renderer/features/chat/ChatComposer.tsx` L308-310「workplace 由 Core materialize」→ 改为「workplace 由常驻前缀 S0 注入，不构造附件」。
  - `apps/desktop/shared/ipc-types.ts` L713 `AgentRunRequest.attachments` 注释、L867-869 `ComposerAttachmentsSuggestPayload` 注释 → 去掉「workplace 差集推送」等死路径描述。
  - `packages/core/src/domain/chat/model/message-attachment.schema.ts` L54/L56 注释 → 标注 workplace 为历史只读兼容。
  - `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` L4-6 模块注释、`wrap-user-message-for-llm.ts` L4/L32/L46 顺序注释、`composer-chip-attachment.ts` L3/L14 注释 → 标注 workplace 为历史兼容。
  - `packages/core/src/service/agent/logic/run-agent-turn.ts` L15-18/L113-119/L125-128 注释 → 去掉「workplace 差集」相关措辞，保留「误传 user_ops 预览一律丢弃」语义（filter 不删）。
- **Step 14 — phase-workplace-cleanup — blocking: no — qa: auto**：跑 `history-compat-t-cr8.test.ts` 及相关 workplace 历史兼容测试，确认策略 A 改动（仅注释）下全部通过；如有因注释变更触动的快照/断言，同步更新。
- **Step 15 — phase-workplace-cleanup — blocking: no — qa: manual_user**：（可选，本期建议不做）若后续引入 row-level migration 基建，再评估是否收窄 schema enum + 清 prepare/wrap/chip 读取分支。本期不执行。

> 说明：Step 15 标 `manual_user` 且本期不做，仅作为后续项记录，避免误把「清理死代码」理解成「强制收窄 schema」。

## 测试策略

### 测试用例

> 用例 id `T-<模块缩写><序号>`，须映射到 Step。

- **T-KB1** — blocking: yes — 映射 Step 2：`ScreenFormLayout` 在 Android 分支渲染出 `Animated.View`（裁切窗口），iOS 分支渲染出 `KeyboardAvoidingView`，props 与样式符合预期。依赖 `react-native-keyboard-controller` mock（已存在）+ reanimated mock（Step 1 确认）。
- **T-KB2** — blocking: no — 映射 Step 3：真机回归录屏（Android+iOS）覆盖 7 个表单页键盘场景，含 `EventsConfigScreen` 禁滚动交互。
- **T-CA1** — blocking: yes — 映射 Step 4/5：域模型 + wire schema 往返——写盘 `{ prompts: { customAttach: "xxx" } }` 能读回；空串/缺省读回为 `undefined`；`.strict()` 下未声明字段会被拒。
- **T-CA2** — blocking: yes — 映射 Step 5：表单状态层——`definitionToForm` 从 `customAttach` 非空反推 `customAttachEnabled=true`；`layoutFromFormInput` 在 trim 空时不 emit 字段；`formSnapshotJson` 把两字段纳入 dirty 比对；`customAttachEnabled` 不影响 `hasAnyPromptRegionEnabled` 门闩。
- **T-CA3** — blocking: yes — 映射 Step 6：wrap——`extraInfo` 空（含 undefined/全空白）时输出与无参一致（不出现 `<extra-info>`）；非空时 `<extra-info>` 出现在 `</user-ops>` 之后、`</attachment>` 之前、`<user-input>` 之前，文本按行 4 空格缩进。
- **T-CA4** — blocking: yes — 映射 Step 7：runner 注入——含 `customAttach` 的 definition 经 runner 调 prepare 后，每条 user 消息提示词都带 `<extra-info>`（常驻）；definition 无 `customAttach` 时与现状一致。
- **T-CA5** — blocking: yes — 映射 Step 8：预览口径——desktop/mobile `session-prompt-input.service` 产出的提示词与 runner 真实提示词在 `<extra-info>` 上一致。
- **T-CA6** — blocking: no — 映射 Step 9/10：UI——desktop/mobile 开关关时不显示输入框；开时显示并受控；保存后重开配置不丢；全局/项目级两入口一致。
- **T-WC1** — blocking: no — 映射 Step 12：grep 确认无新的 `source:"workplace"` 写入构造点。
- **T-WC2** — blocking: no — 映射 Step 14：`history-compat-t-cr8.test.ts` 及全部 workplace 历史兼容测试在策略 A 改动下通过。
- **T-WC3** — blocking: no — 映射 Step 13：注释修正后无残留「workplace 由 Core materialize」「workplace 差集推送」等过时描述。

### 验收矩阵

| 用例 | Step | blocking | qa |
|---|---|---|---|
| T-KB1 | 2 | yes | auto |
| T-KB2 | 3 | no | manual_user |
| T-CA1 | 4 | yes | auto |
| T-CA2 | 5 | yes | auto |
| T-CA3 | 6 | yes | auto |
| T-CA4 | 7 | yes | auto |
| T-CA5 | 8 | yes | auto |
| T-CA6 | 9,10 | no | manual_user |
| T-WC1 | 12 | no | auto |
| T-WC2 | 14 | no | auto |
| T-WC3 | 13 | no | auto |

## 风险与回滚方案

- **workplace 清理深度受限**（最大约束）：仓库无 row-level migration 基建，`z.array` 全有或全无，收窄 schema enum 会让历史 `attachments_json` 整条 `safeParse` 失败、该消息全部附件丢失。故本期采用策略 A（只清注释 + 写入侧确认），schema/prepare/wrap/DTO/test 全部保留读取兼容。若未来要做彻底收窄，须先引入一次性 row rewrite（扫 `chat_message.attachments_json` 过滤 `source:"workplace"` 回写）+ `parseAttachmentsJson` 容错，再分步收窄。回滚：策略 A 改动仅为注释，回滚零成本。
- **reanimated mock 缺失**：`useAnimatedStyle` 来自 `react-native-reanimated`，现有 keyboard-controller mock 未覆盖。Step 1 必须先确认/补 reanimated mock，否则 `ScreenFormLayout` 相关测试会抛。
- **FormOverlay 与裁切层嵌套**：Android 分支新增 `overflow:hidden` 裁切层后，`FormOverlayHost` 的 overlay/portal 若是同层绝对定位可能被裁。Step 1 读 `FormOverlayHost.tsx` 确认；若是 RN `Modal`/独立 portal 树则无影响。
- **iOS 表单避让无完全同形先例**：聊天页 iOS 未用 `KeyboardAvoidingView`（走 composer 自管 sticky），表单页只能类比 `FileEditorScreen`。Step 3 真机验证 iOS multiline 焦点滚动表现，必要时补 `scrollResponderScrollToEnd` 类辅助。
- **预览口径漂移**：若漏改 desktop/mobile 任一预览入口，token 计数/预览提示词会与真实不一致。Step 8 + T-CA5 专门盯这条。
- **customAttach 门闩决策**：本 SPEC 钉死 customAttach **不计入**「至少一个 prompt 块」门闩（附加信息不是独立 prompt 源）。若产品后续希望它算独立源，改 `hasEffectivePromptSource`/`countEffectiveFormPromptSources` 即可，影响面小。
- **wrap 签名变更下游**：`wrapUserMessageForLlm` 是 core 公共导出，第三参可选向后兼容；唯一核心调用点是 prepare，预览经 prepare 间接调，无其它直接调用。
- **回滚**：三条 phase 互相独立，可单独回滚。键盘避让回滚 = 还原 `ScreenFormLayout.tsx`；customAttach 回滚 = 还原 core + 双端 UI（新字段对旧数据无破坏，旧端读到新字段会忽略）；workplace 清理回滚 = 还原注释。
