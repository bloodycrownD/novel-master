# CR Fix Spec — agent-config-extra-info-and-workplace-cleanup

## 元信息

| 字段 | 值 |
| --- | --- |
| 节点 | spec-fix-round2 |
| 仓库 | D:\Dev\Js\novel-master |
| BASE_SHA | c0e200b1973a43da37a7d50cfd4ac4fd21777586 |
| HEAD_SHA | b1f2df3f5822a76a0eb4d82ea0e10d209f89a148 |
| 分支 | feat/agent-config-extra-info-and-workplace-cleanup |
| review_round | 2 |
| dag_version | 2 |
| 状态 | draft |
| 范围说明 | 本轮只产出 fix-spec 文档，不修改任何实现代码。后续主代理宣布 ready 后再由各子代理落地。 |

参考文档（只读）：

- 业务 PRD：`docs/Iterations/agent-config-extra-info-and-workplace-cleanup/prd.md`
- 业务 SPEC：`docs/Iterations/agent-config-extra-info-and-workplace-cleanup/spec.md`

---

## Must-fix

### P0

#### CR-P0-1 [P0] desktop 全局 agent 入口 AgentEditorView.tsx 漏 customAttach 接线

- **维度**：A（需求符合性）
- **文件**：`apps/desktop/renderer/features/settings/AgentEditorView.tsx`
- **问题**：
  desktop 这边其实有两套互相独立的 agent 编辑表单哦——一套是 `AgentDefinitionEditorForm`（项目级，挂在 `ProjectAgentConfigView` 上），另一套是 `AgentEditorView`（全局，挂在 `SettingsOverlay` 的 `agentEditor` 路由里）。这次 customAttach 只接到了项目级那一套，全局入口完全没拿到 `customAttach` 的 Switch / state / 读写逻辑，在 `AgentEditorView.tsx` 里 grep `customAttach` 是零命中（确认过它已经有 workplace 开关，但就是没 customAttach）。
  PRD 的验收标准写得很明白——「该开关与内容在全局 agent 与项目级 agent 两条入口下行为一致」，现在全局 agent 用户根本看不到这个开关，直接挂了。mobile 端不存在这个问题，因为它们共用同一个 `AgentEditorForm` 组件（`AgentEditorScreen` 走全局、`ProjectAgentConfigScreen` 走项目级都复用它）。
- **改法**：
  在 `AgentEditorView.tsx` 里照着已有的 workplace 区（也就是 `workplaceEnabled` / `workplaceAssistantText` 那套 state + Switch + textarea 的完整范式）补一组对应的 customAttach 实现：
  1. 新增 `customAttachEnabled` / `customAttachText` 两个 state，配合 Switch 和 textarea（用 `PromptMacroTextarea` 还是普通 textarea 跟该文件 workplace 区的风格对齐就行）。
  2. 接入 `applyDefinitionToFormState`（读入 prompts.customAttach）和 `buildDefinition` / `buildAgentDefinitionFromForm`（写出，统一走 `layoutFromFormInput`）。
  3. 把这两个字段加进 `formSnapshotJson` 的 dirty 比对里，别让保存判断漏掉。
  4. 宏 chip 这块要特别注意：`AgentEditorView.tsx` 的 workplace 区用的是独立组件 `AgentWorkplaceBlockCard`（无 chip、纯 Switch + textarea 的范式），全局 agent 的 customAttach 必须对齐 `AgentWorkplaceBlockCard` 的写法，**不引入 chip**。chip 是项目级 `AgentDefinitionEditorForm` 独有的特性，跨入口复用会破坏一致性。也就是说，全局入口这边纯 textarea 即可，宏校验逻辑（validateDynamicMacros）走 onSave 校验路径，不在 UI 上挂 chip。
- **验收/测试**：
  开启 customAttach 的全局 agent → 发消息 → 提示词里出现 extra-info 块；关闭 → 不出现。保存后重开配置两个字段都不丢。
- **来源**：review-scope-desktop OQ-1（主代理核实后升级为 P0）

### P1

#### CR-P1-1 [P1] schema 往返测试缺 customAttach（T-CA1）

- **维度**：G（测试）
- **文件**：`packages/core/test/agent/agent-definition-io.test.ts`（round 1 写的 `packages/core/test/agent/model/agent-definition.schema.test.ts` 在仓里不存在，本轮核实后改到这个已存在且已含 round-trip 用例的文件）
- **问题**：
  `agent-definition.schema.ts` 给 `promptsDocumentSchema` 加了 `customAttach` 字段并且开了 `.strict()`，SPEC 里的 T-CA1（blocking:yes, auto）钉死了要覆盖往返 + `.strict()` 拒绝未知字段，可现在一条测试都没有。三条用例内容维持原改法不变：
- **改法**：
  补三条用例：
  1. `{ prompts: { customAttach: "xxx" } }` 走 `definitionToDocument` → `documentToDefinition` 往返不丢字段。
  2. 空串或缺省读回 `undefined`，并且 `definitionToDocument` 不会写出这个 key。
  3. `promptsDocumentSchema.safeParse` 对未声明的字段返回失败（验证 `.strict()`）。
- **验收/测试**：3 条用例 pass。
- **来源**：review-scope-core G-1

#### CR-P1-2 [P1] 表单状态层测试缺 customAttach（T-CA2）

- **维度**：G（测试）
- **文件**：`packages/core/test/config-forms/agent-editor-state.test.ts`（没有就就近放到 form 相关 test 里）
- **问题**：
  `agent-editor-state.ts` 新增了 `customAttachEnabled` / `customAttachText`，并且动过 `definitionToForm` / `layoutFromFormInput` / `formSnapshotJson`，SPEC T-CA2（blocking:yes, auto）要求覆盖，目前零测试。
- **改法**：
  补四条用例：
  1. `definitionToForm` 从 `prompts.customAttach` 非空反推出 `enabled=true`。
  2. `layoutFromFormInput` 在 trim 后为空时不 emit `customAttach`。
  3. `formSnapshotJson` 把这两个字段纳入 dirty 比对。
  4. 只开 `customAttachEnabled` 不影响 `hasAnyPromptRegionEnabled` 门闩（不能因为开了 customAttach 就被误判成有内容区启用）。
- **验收/测试**：4 条用例 pass。
- **来源**：review-scope-core G-2

#### CR-P1-3 [P1] ScreenFormLayout 缺 T-KB1 自动测试

- **维度**：G（测试）
- **文件**：`apps/mobile/__tests__/screen-form-layout.test.tsx`（需要新建）
- **问题**：
  SPEC 的 T-KB1（blocking:yes, auto）要求断言 Android 分支渲染 `Animated.View` 裁切窗口（`keyboardClip overflow:hidden` + footer 排在 `ScrollView` 之后）、iOS 分支渲染 `KeyboardAvoidingView`。mock 基建都已经就位了——`react-native-reanimated-mock` 导出 `useAnimatedStyle`，`react-native-keyboard-controller-mock` 导出 `useReanimatedKeyboardAnimation` / `KeyboardAvoidingView`，目前零测试。
- **改法**：
  新建测试文件，mock `Platform.OS='android'` 和 `'ios'` 分别渲染 `ScreenFormLayout`（传入 footer），然后：
  - Android 树里断言有 `overflow:hidden` 的 `Animated.View`，footer 排在 `ScrollView` 之后。
  - iOS 树里断言有 `KeyboardAvoidingView`。
- **验收/测试**：Android + iOS 两个分支的断言都 pass。
- **来源**：review-scope-mobile G-1

#### CR-P1-4 [P1] runner 注入 extraInfo 零覆盖（T-CA4）

- **维度**：G（测试）
- **文件**：`packages/core/test/agent/agent-runner.test.ts`（已有文件，就近追加）
- **问题**：
  `agent-runner.ts` L213-221 已经把 extraInfo 注进 prepare 出的 messages 了，可 runner 这层测试对 `prompts.customAttach` / `extraInfo` 完全零覆盖。PRD 钉了「常驻生效（每条 user 消息都出现同一个 extra-info）」，现在这条行为完全没有自动保障，回归时很容易被无声改掉。SPEC 的 T-CA4 标的是 blocking:yes，必须补。
- **改法**：
  补 2 条用例：
  1. definition 里 `prompts.customAttach` 非空，连续发两条 user 消息 → runner 跑完后两条消息的 body 都含 extra-info 块，且文本完全一致（验证「常驻」+「同一份」）。
  2. definition 无 `customAttach` → runner 产出与现状一致，body 里不出现 extra-info 段。
- **验收/测试**：2 条用例 pass；映射 T-CA4。
- **来源**：review-full round 2

#### CR-P1-5 [P1] 预览口径 parity 测试（T-CA5）

- **维度**：G（跨 scope C-orch）
- **文件**：
  - desktop：`apps/desktop/test/session-prompt-input.service.test.ts`（仓内不存在，就近新建）
  - mobile：`apps/mobile/__tests__/session-prompt-input.service.test.ts`（仓内不存在，就近新建）
- **问题**：
  desktop / mobile 两端的 `buildSessionPromptInput` 都接入了 extraInfo / now / workplace，但没有一条断言比对「预览提示词」与「runner 真实提示词」在 extra-info 段上是一致的。这意味着 UI 预览和真实发给模型的提示词可能悄无声息地走偏。SPEC 的 T-CA5 标 blocking:yes，要求两端各补一条 parity 用例。
- **改法**：
  两端各加一条用例：构造带 `customAttach` 的 definition + 同一条 user 消息，分别走 `buildSessionPromptInput`（预览路径）和 runner 的 prepare（真实路径），然后断言两边产出的 messages 在 extra-info 段（文本、缩进、包裹结构）完全一致。两端由于 scope 不同需要各自实现一份，不能互相复用。
- **验收/测试**：desktop 1 条 + mobile 1 条 pass；映射 T-CA5。
- **来源**：review-full round 2

### P2

#### CR-P2-1 [P2] validate-agent-prompt-layout 测试缺 customAttach 宏校验

- **维度**：G（测试）
- **文件**：`packages/core/test/prompt/validate-agent-prompt-layout.test.ts`
- **问题**：
  `validate-agent-prompt-layout.ts` 接入了 `validateDynamicMacros(customAttach)`，但没有测试覆盖合法宏通过 / 非法宏被拒的路径。
- **改法**：
  补三条用例：
  1. customAttach 含 `{{$time}}` / `{{$filetree}}` 这种合法宏时通过，且原样进 layout。
  2. 含 `{{$unknown}}` 这种非法宏时抛 `PromptError`。
  3. 空字符串或纯空白 customAttach 不会出现在 layout 里。
  4. （round 2 追加）在 `packages/core/test/chat/prepare-user-messages-for-prompt.test.ts` 现有 T-EI1 用例旁补一条「同时有 user_ops 附件 + extraInfo 非空」的用例，断言输出严格满足如下顺序与缩进：
     ```
     </user_ops>\n  <extra-info>\n    {每行 4 空格缩进的内容}\n  </extra-info>\n</attachment>\n<user-input>
     ```
     也就是 user_ops 先闭合、extra-info 嵌在 attachment 内部并以 4 空格缩进呈现、attachment 闭合后才按 `<user-input>` 接续，整段顺序不能调。
- **验收/测试**：4 条用例 pass。
- **来源**：review-scope-core G-3（round 2 追加第 4 条）

#### CR-P2-2 [P2] vfs-tools upsertFileCacheAfterWrite 冗余 resolveLogicalPath

- **维度**：C（DRY）
- **文件**：`packages/core/src/domain/tool/builtin/vfs-tools.ts`
- **问题**：
  write 工具入口已经 `resolveLogicalPath` 规范化过路径再传给 `upsertFileCacheAfterWrite`，结果 helper 内部又调了一次。这调用是幂等的，不会出错，但纯属冗余。
- **改法**：
  把 `upsertFileCacheAfterWrite` 内部的 `resolveLogicalPath(path)` 删掉，直接用入参 `path`（形参可以顺手改名为 `logicalPath` 让语义更清楚）。
- **验收/测试**：vfs-tools 现有测试 pass。
- **来源**：review-scope-core C-1

#### CR-P2-3 [P2] desktop 宏 chip 插入逻辑 DRY + selectionStart 死分支

- **维度**：C（DRY / 死代码）
- **文件**：`apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx`
- **问题**：
  customAttach 的宏 chip + `insertTextAtSelection` + rAF 选区回写那一坨（大概 30 行）跟 dynamic 区几乎是逐行重复的；另外 `selectionStart ?? length` 是个死分支，因为 `selectionStart` 永远是 number，?? 永远不会走到。
- **改法**：
  抽一个 `PromptMacroChips({ value, onChange, textareaRef, disabled })` 小组件，把 chip 相关逻辑收敛进去；同时把那个 ?? fallback 删掉。
- **验收/测试**：现有 UI 行为不变。
- **来源**：review-scope-desktop C-1+C-2

#### CR-P2-4 [P2] mobile 死样式 readonlyPill / readonlyPillText

- **维度**：C（死代码）
- **文件**：`apps/mobile/src/components/agent/AgentEditorForm.tsx`
- **问题**：
  会话区只读药丸删掉之后，`styles.readonlyPill` / `readonlyPillText` 这两个样式条目没有引用了，还残留在 `StyleSheet` 里。round 2 已核实：`readonlyPill`（L1463）与 `readonlyPillText`（L1469）仍留在 `AgentEditorForm.tsx` 的 `StyleSheet.create` 内，全仓除定义处外零引用，本条成立。
- **改法**：
  把这两个 `StyleSheet` 条目删掉。
- **验收/测试**：tsc + 现有测试 pass。
- **来源**：review-scope-mobile C-1

---

## Spec deviations

下面这些是本次 PR 在 spec 之外的合理增量，建议后续补进 `spec.md`（前两条为 round 1 已记，后三条为 round 2 追加）：

1. **宏支持**：customAttach 接入了 `expandDynamicMacros` + `validateDynamicMacros`，但 `spec.md` 的 phase-custom-attach 完全没提宏展开这件事。建议补进 Step 4 / 6 / 7，以及 T-CA1 / T-CA3 的描述里。
2. **两个 bugfix**：
   - vfs write 相对路径处理
   - prepare 无附件时漏 extraInfo

   都是 spec 之外的合理修复，目前 `spec.md` 没记录，建议补一节说明清楚。
3. **`PrepareUserMessagesForPromptRuntime` 公共接口扩张**：为了给 customAttach 宏展开提供上下文，运行时接口上新增了 `now?: Date` 与 `workplace?: WorkplaceService` 两个可选入参（仅服务于 customAttach 宏展开路径）。这属于 spec 之外的公共导出扩张，spec 里 Step 6 / 接口章节没写，建议补上。
4. **`wrapUserMessageForLlm` 在「无附件 body + extraInfo 非空」时的边界**：这种情况下输出是一个**不含 user-ops、只含 extra-info** 的 attachment，并且代码注释里钉了「上游解析器应按外层 attachment 是否存在来判定」。spec 的 Step 6 只描述了「有附件」这一主路径，没写这条空 body 边界，建议补。
5. **prepare 入口的宏展开节奏**：`prepare` 入口是「每轮 user 消息展开一次 customAttach 宏」，跟 dynamic 区「每步展开一次」的节奏不一样。spec 的 Step 7 没提两种节奏的差异，建议补一句说明。

---

## Open questions / 待拍板

暂无未决问题。本轮所有 OQ 都已经核实并落到 Must-fix 里（CR-P0-1 来自 review-scope-desktop 的 OQ-1，由主代理核实后升级为 P0）。

---

## 已豁免（用户确认不修）

### desktop A-1 / mobile A-1：customAttach 挂在会话区只读卡片里

- **子代理建议**：customAttach 塞进会话区只读卡片、文案语义偏移，建议独立分区。
- **用户原话**：
  > 不要单独一个额外信息区，而是放到会话历史那个UI块上，这样更符合用户消息是附加上去的含义。你把那个【只读】tag的位置换成开关，然后把【自定义附件信息】这个title也去掉，我没让你把两个块合在一起，而是就是一个块【会话消息】。会话历史的标题也去掉，然后两端解释文字也移除，重写为【用户聊天历史，开启后可给每次输入附加额外内容】
- **结论**：这是用户明确要求的设计决策，不修。

---

## 合并后 QA

以下为 `manual_user` 类型，不阻塞合并，但合并后需要在真机 / 模拟器上回归：

- **T-KB2**：真机 / 模拟器回归 7 个表单页的键盘场景（Android + iOS 都要），其中要覆盖 `EventsConfigScreen` 的禁滚动交互。
- **T-CA6**：真机 / 桌面手动验收 customAttach 开关的 UI 行为（开/关/保存/重开）。
- **iOS 表单避让**：multiline 输入框聚焦时的避让 + 滚动表现。

---

## K 节建议

- **调试残留**：无。debug 日志已经在本次 PR 中清理干净，不需要额外处理。
- **lint / format**：建议下游落地各 Must-fix 时各自跑一遍（`tsc` + 项目 lint + 格式化），保持一致。
