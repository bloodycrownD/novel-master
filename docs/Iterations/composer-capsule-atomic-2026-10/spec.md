---
date: 2026-10-19
---

# 输入框胶囊原子化根治（composer-capsule-atomic-2026-10）技术规格（SPEC）

> 版本：r2（2026-10-19 R1 审查 No-Go 后 doc-fix：闭合 P0×2 / P1×9 / P2×7，逐条见文末「R1 修订记录」）

## 需求来源

非标准 PRD 输入：用户口述（2026-10-19）。核心诉求：mobile 输入框 skill 胶囊目前只能原子删除；在胶囊后继续尾追输入的文字会被并入胶囊，判定不合理——拍板「根治」：**胶囊生成后不可变动，尾追内容落在胶囊外**（用户原话「根治吧，本身我们为了输入框也进行不少更改了」）。

两轮 readonly 调查结论（2026-10-19，本会话；代码证据基于 node_modules 补丁版 1.1.1 + `patches/react-native-enriched-markdown+1.1.1.patch`，与 `.reference/enriched-markdown` 上游在关键函数上语义一致）：

1. **胶囊表示**：明文 `$技能名`（`@路径` 同理）+ 外部区间，无 marker 无闭合符。JS 确认区间（`tokenRanges` prop → `confirmedRangesRef`）+ native `FormattingStore` 的 `StyleType.TOKEN` range 渲染 span。边界真源正则 `/@([^\s@$]+)|\$([^\s$@]+)/g`（`apps/mobile/src/components/chat/composer-highlight.ts:10`）唯一终止符是空白——尾追无空格文字必然被并入。
2. **已防护面**：同会话逐键贴边插入不并入（`native-composer/token-ranges.ts:93-94` 右边界原样保留，位于 remap 主循环 `:92-99` + `__tests__/native-composer.test.tsx:353-362` 回归锁）。
3. **仍会吞的路径**（本迭代闭合对象）：
   - controller 初始化 / `syncFromDraft` 正则全扫（`useChatComposerController.ts:207-209`、`:301-314`）——切会话/重启后尾追被重新吞入，且半截手输 token 被升格为确认胶囊；
   - native 替换/选区类扩边：`inheritsReplacementAtStart` 只排除 LINK（`FormattingStore.kt:176`）、`seedPendingStylesFromSelection` 只跳过 LINK（`EnrichedMarkdownTextInputView.kt:543-554`）、CLIPPED_END 无条件扩尾（`RangeEditAdjustment.kt:83-88`）、相邻同类型融合（`FormattingStore.kt:187-203` 且 `addRange` 合并条件 `:105-126` 对相邻也成立）、内部插入增长（`RangeEditAdjustment.kt:103-118`）；
   - 原子删除缺口：选区删除与前向删除（KEYCODE_FORWARD_DEL）未接（`EnrichedMarkdownTextInputView.kt:1027-1048` 只处理折叠光标）；空 `commitText` 表示退格（`InputConnectionWrapper.kt:19-21`）但不走原子删（`:86-95`）；`deleteSurroundingText` 只拦 `(1,0)`（`:97-106`）；
   - 中文 IME 组合提交（`setComposingText` `:52-77` 整段替换语义，类注释 `:8-28`）走替换分支扩边——疑似用户真机实撞路径（`NativeChatComposer.tsx:287-295` 留有 TODO(IME)）。
4. **哨兵字符路线否决**：U+200B 被 native `stripZwsp` 进出双向剥掉（`InputEventEmitter.kt:36-42`、`InputParser.kt:24-31`）直接打爆所有 offset；U+FFFC 污染 5+ 处 token 正则与 skill 名校验（`scan-skill-attachments.ts:22`、`skill-name.ts:17-22`、`composer-at-path.ts:52-74`、转录渲染 `RefTokenText.tsx:11-19`、desktop `ComposerAtPathInput.tsx:14`），且防不了胶囊内部编辑——只配当辅助不配当主路线。
5. **手输语义现状**：线上恒传 `tokenRanges`（`ChatConversationPanel.tsx:243`），手打 `$xxx` 不在确认集合 → 同会话内不成胶囊（`__tests__/native-composer.test.tsx:344-351` 锁定）；发送时 core 扫描照常生效。「手输边打边成胶囊、可增长」为非目标。

## 设计目标

1. **边界冻结**：胶囊生成后 `[start,end)` 不可因任何编辑增长/被部分改写；尾追/贴边输入落在胶囊外。
2. **原子删除覆盖完整**：折叠光标退格（既有）、选区删除、前向删除全部整颗删除。
3. **确认态持久化**：草稿 JSON 记录 `tokenRanges`，水化直接使用；正则全扫从水化链路退役（仅无字段的旧草稿与明确允许的带外写入兜底）。
4. **发送管线零改动**：胶囊明文形态不变，core 扫描（`scanAtPathAttachments` / `scanSkillAttachments` / `composer-send-intent`，发送链挂点 `run-agent-turn.ts:663-667`、append `:724-731`）不动。
5. **手输语义显式化**：手输 `$xxx`/`@xxx` 保持纯文本不成胶囊，行为与现状一致。

## 非目标

- 不引入 live/growable token（手输自动成胶囊、边打边长）——如需另立迭代。
- 不做哨兵字符（调查结论第 4 条否决）。
- iOS 不在范围（本仓只出 Android，补丁仅 Android 侧；iOS input 无 TOKEN 概念）。
- 宏链 `ComposerInputWebView` / composer-input 包不动（独立链路）。
- 全屏 CodeMirror 编辑器（`PromptEditorScreen`）与旧 webview composer 的胶囊高亮行为不改（独立正则高亮体系，共享 `COMPOSER_TOKEN_RE`；其「尾追并入高亮」行为作为已知限制披露，见兼容性节）。
- IME 组合态的选区规范化拦截（InputConnectionWrapper pre-super）为 P2 阶段（D5）；P1 的 native 区间策略只调区间不改文本，不与组合态抢编辑权。

## 总体方案

### 核心决策

**D1 确认态 = 持久化 `tokenRanges`（草稿 schema 扩展 + undefined 兜底迁移）**

- **schema（`packages/core/src/domain/chat/model/composer-draft.schema.ts`）**：
  - 新导出结构类型 `ComposerDraftTokenRange = { start: number; end: number }`（供 storage 层与 `token-ranges.ts` 复用，避免 storage → UI 组件目录的反向依赖）；`token-ranges.ts` 的 `TokenRange`（`:29-33`）改为复用该类型。
  - `composerDraftSchema` 加 `tokenRanges: z.array(...).optional()`（元素 `start/end` 非负整数 + `start <= end` refine）；**不设 default**——`undefined`（旧数据，允许兜底扫描）与 `[]`（确认无胶囊，禁止扫描）语义不同。
  - `serializeComposerDraftJson`（`:98-118`）：有值透传；既有「text 空 + attachments 空 → null」语义不变（见下「清空口径」）。
  - `parseComposerDraftJson`（`:57-87`）：`tokenRanges` **单独 safeParse**（不与 text/attachments 共用一次调用）——非法 ranges（`start > end`、负数、非整数、字符串、null）→ 当作 `undefined`，**text/attachments 照常保留**（对齐既有「非法附件逐条丢、正文永不因附件而丢」的 `:52-55` 口径）；**字段缺失时结果对象不写入 `tokenRanges` 自有键**（避免 zod optional 输出自带 undefined 键打破既有 `node:assert/strict` deepEqual 断言 `composer-draft.schema.test.ts:79-86`、`:174-189`）。
- **mobile 存储链（`apps/mobile/src/storage/chat-composer-draft.ts`）**：
  - `ChatComposerDraft` 类型（`:13-16`）、`persistAttachTextDraft`（`:61-72`）、`writeChatComposerDraft`/`writeChatComposerDraftState`（`:78-134`）、内存缓存、`hydrateChatComposerDraftFromDb`（`:156-180`）全链透传；
  - **`applyComposerStatusAttachmentsReplace`（`:186-204`）**：重建缓存条目时**保留 `prev.tokenRanges`**（现为 `{text: prev.text, attachments: merged}` 丢字段——controller 水化链 hydrate → project → apply（`useChatComposerController.ts:344-364`）会先丢 ranges 再进 `syncFromDraft` 兜底扫描，`tokenRanges: []` 的「确认无胶囊」退化为 undefined，手输 `$foo` 每次水化被升格，打死目标 3/5）；`refreshComposerAnnotateChips` 走同一函数自动修复。
  - `writeChatComposerDraft` 增加可选 `tokenRanges` 参数（带外写入口，见下）。
- **controller 四咽喉点 + 水化（`apps/mobile/src/components/chat/useChatComposerController.ts`）**：
  - 初值（`:207-209`）与 `syncFromDraft`（`:301-314`）：`draft.tokenRanges ?? scanTokensToRanges(draft.text)`——undefined 才扫描兜底，兜底结果随 `persistDraft` 写回固化；
  - `syncFromDraft` 的 ranges 更新**按内容比较**（长度 + 逐元素 start/end）而非卡在 `textChanged`（`:303` 现条件）——否则同文本不同会话切换时 ranges 串台（A 会话确认胶囊 vs B 会话手输同串）；
  - `persistDraft`（`:281-290`）/ `onChangeText`（`:400-411`）/ `commitComposerText`（`:325-337`）落库带 `tokenRangesRef.current`；
  - **清空口径**：发送清空走 `clearChatComposerDraft`（`:438`）写 DB `null`（serialize 对空 text+空 attachments 恒 null，`composer-draft.schema.ts:110-112`，`[]` 落不了库）——下次水化 `undefined` + 空文本，扫描结果必空，无升格风险；React state 侧置 `[]`（`:441-442`）不变。
- **带外写入路径两条**：
  - 全屏编辑退出回填（`apps/mobile/src/screens/tabs/ChatTabScreen.tsx:172-174` 现调 `writeChatComposerDraft(targetSessionId, text, sessions)` 覆盖掉 DB ranges）：改为读旧草稿后用 `remapTokenRanges(旧文本, 新文本, 旧 ranges)`（`token-ranges.ts:67-101`，需以可导出纯函数形态复用）映射写入——全屏 CodeMirror 的正则高亮虽不动（非目标），但区间数值可用 remap 保真；
  - undo_send 恢复（`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:226-233`）：恢复文本无 ranges → 写 `undefined`（不传字段），允许下一次水化兜底扫描一次，记入已知限制（恢复的文本通常是完整历史明文，扫描升格面与旧行为相同）。
- 无 DDL 迁移（`composer_draft_json` TEXT 列，`chat-schema.ts:16-25`；读写 `sqlite-session.repository.ts:133-158`）。

**D2 native TOKEN 受保护语义（补丁内 Kotlin，五处特判 + protected 区间策略表）**

- `FormattingStore.adjustForEdit`（`:166-179`）：`inheritsReplacementAtStart` 改为 `{ it.type != StyleType.LINK && it.type != StyleType.TOKEN }`。
- `selectionAdjustedForAtomicLinks`（`:41-54`）：纳入 TOKEN（光标落 TOKEN 内部 → 推到 `token.end`；选区与 TOKEN 部分相交 → 扩整颗）——与 LINK 既有语义同款，`onSelectionChanged` 消费点 `EnrichedMarkdownTextInputView.kt:481-499` 自动生效。
- `seedPendingStylesFromSelection`（`EnrichedMarkdownTextInputView.kt:543-554`）：`if (style == StyleType.LINK || style == StyleType.TOKEN) continue`——选区改写不再给 TOKEN 种 pending style。
- **`addRange` 合并抑制**（`FormattingStore.kt:105-126`）：合并条件 `existing.start <= mergedEnd && existing.end >= mergedStart` 对「相邻」（`existing.end == new.start`）也成立——为 TOKEN 提供无合并添加路径（`addRange(..., allowMerge: Boolean = true)` 或 TOKEN 专用方法），`setTokenRanges` 逐条添加（`:1061-1073`）改走无合并路径；`coalesceAdjacentSameTypeRanges`（`:187-203`）跳过 TOKEN。两处一起改才能保证「删掉两颗胶囊之间的字符后」逐键下发不把两条 TOKEN 合成一条。
- **`RangeEditAdjustment` protected 分支表（仅 TOKEN；与 JS `remapTokenRanges` 逐条对齐）**：

  | 编辑形态 | 区间结果 | 与 JS 对齐点 |
  |---|---|---|
  | 纯插入，插入点 `<= range.start` | 整体右移 `insertedLength`（新字符落左侧外） | `token-ranges.ts:95-96` 左边界右移 |
  | 纯插入，插入点 `>= range.end` | 原样不动（新字符落右侧外） | `:93-94` 右边界保留 |
  | 纯插入，插入点严格在 `(start, end)` 内 | **整条移除**（胶囊死亡） | `:98` 内部插入摘除分支 |
  | 删除/替换与区间任意部分相交（含整条覆盖、部分覆盖） | **整条移除** | 替换类 JS 侧无对应（确认区间不经历替换），native 兜底 |
  | 删除完全在区间左侧 / 右侧 | 平移 / 不动 | remap 平移分支 |

  - 禁用对 TOKEN 的内部插入增长（`:103-118` 现三支中「内部增长」分支）、CLIPPED_END 扩尾（`:83-88`）、CLIPPED_START 继承（`:90-101`）；`growsAtStartOnInsert` 对 TOKEN 固定 `false`。
  - 安全网定位：正常路径下光标吸附 + 前三条特判已阻止「编辑落进区间内部」；protected 分支兜底 FormattingStore 层不产生半截/扩张/融合 range。该层只调区间不改文本，与 IME 组合态兼容（`EditSession.kt:23-30` phase 抑制 + `lastProcessedText` 早退先例）。
  - **Kotlin 单测锁表**（blocking，见测试策略）：分支表逐行矩阵。

**D3 原子删除覆盖面扩展（补丁内 Kotlin，五入口统一 helper）**

- 既有两入口保留：`onKeyDown` KEYCODE_DEL（`EnrichedMarkdownTextInputView.kt:225-243`）、`InputConnectionWrapper.deleteSurroundingText(1,0)`（`:97-106`）。
- 新增三入口，统一走「选区/删除区与原子区间（LINK/TOKEN）相交 → 扩为整颗区间 → 删除」helper（复用 `deleteLinkBeforeCursor` `:1027-1048` 的区间删除内核）：
  - **空 `commitText`**（`InputConnectionWrapper.kt:19-21` 注释明确空文本表示退格；`:86-95` 现只发按键事件不走原子删）——先判原子区间再决定走 helper 还是原路径；
  - **`deleteSurroundingText(n, m)` 一般参数**：计算出受影响文本区间与原子区间相交 → 扩整颗（词删 `n>1`、前向 `m>0` 均覆盖）；
  - **前向删除**：`onKeyDown` 与 `sendKeyEvent` 补 `KEYCODE_FORWARD_DEL`（光标后一字符在区间内 → 整颗删，光标不动）。
- `deleteLinkBeforeCursor` 扩展选区删除：`cursorStart != cursorEnd` 且选区与 LINK/TOKEN 相交时，删除范围扩整颗（光标落区间起点）。

**D4 水化链路统一与 native 区间一致性（补丁内 Kotlin + JS）**

- **M7 命令式通道扩展**：`EnrichedMarkdownTextInputInstance.setText` 扩签名 `setText(text, cursor?, ranges?)`（`NativeChatComposer.tsx:196` 接口 + `commitExternalText` `:317-347` 实现接受 ranges 参数，用其合成 markdown 与首帧 TOKEN 下发）。理由：`syncFromDraft` 调 `setComposerTextRef.current?.(draft.text)`（`useChatComposerController.ts:312`）是同步命令调用，React prop 不会即时更新——不带 ranges 会用上一帧 `confirmedRangesRef`（冷启动 `[]` / 切会话旧区间）合成 markdown，正确值要等 prop 收敛 effect（`:416-435`）二次补发，存在旧区间合成窗口。水化链改为 `setText(draft.text, undefined, draft.tokenRanges ?? 兜底扫描值)`。
- **LINK→TOKEN 映射收敛在 `setValueFromJS`**：`setValueFromJS`（`EnrichedMarkdownTextInputView.kt:1104-1122`）在 parse 结果上做映射——`StyleType.LINK` 且 url 以 `nmskill://`/`nmtoken://` 开头 → `StyleType.TOKEN`（url 置 null）。**不改 `InputParser.parseToPlainTextAndRanges` 本体**：其另两个调用点 `pasteMarkdown`（`:881`）与 `InputMeasurementStore`（`:108`，只用 plainText）不受影响——粘贴路径的 `nmskill://` 链接保持 LINK（用户手输 markdown 链接语义），测量链无感。
- `setTokenRanges`（`:1061-1073`）保持「先清 TOKEN 再加」幂等覆盖，配合 D2 无合并添加。
- `MarkdownSerializer`（`:153`、`:173`）TOKEN 空分隔符输出明文——无需改；composer 已禁用 Copy-as-Markdown（`NativeChatComposer.tsx:506-513`），无泄漏面。

**D5 IME 组合态防线（P2 阶段，P1 过真机门后实施）**
- `InputConnectionWrapper`：`commitText` / `setComposingText`（`:52-77`）在 super 前做选区规范化——光标落 TOKEN 内部 → `setSelection(token.end)` 后照常提交；替换区与 TOKEN 相交 → 扩整颗后照常。**禁止 `return false` 拒绝**（IME 重试）；**禁止事后文本回滚**（每次 `setComposingText` 回滚 → IME 重提交 → 死循环抖光标）。
- 新增 `finishComposingText` 组合生命周期记录（override 记标志）：组合期间（`isTextChanging` 已跳过选区修正的 `:488` 语义沿用）只做 D2 区间保守策略，组合提交后做一次修复。
- 注意：wrapper 用「光标是否后退」推断退格（`:52-77`）；super 前移动光标会污染推断——规范化仅在「目标区间确为 TOKEN」时执行，且移动方向单调向后（token.end），不触发退格误判路径。
- 真机中文 IME 验证门：候选窗不抖、光标不飘、组合期间胶囊不闪、提交后尾追文字在胶囊外。

**D6 desktop 草稿写回透传（带编辑检测）**
- `apps/desktop/renderer/features/chat/ConversationPanel.tsx`：desktop 写回 effect 依赖 `composerText` 每键触发（`:347-360`），且存在回滚恢复直接改文本路径（`:755-771`）——**只透传未编辑的 ranges**：
  - 水化时把 `{text, ranges}` 存 ref（读侧 `:328-332` 现忽略胶囊语义不变）；
  - 写回 payload 仅当 `composerText === 水化文本` 时携带 `tokenRanges`（原样透传）；文本已编辑 → 省略字段（undefined → mobile 侧兜底扫描一次，行为同现状）；
  - desktop 自身不产生/不编辑 ranges（无胶囊 UI）；若未来要求编辑保真，将 `remapTokenRanges` 上提 core 两端共用（本迭代不做）。

**D7 阶段划分与验收门**
- **P1（本迭代主体）**：D1 + D2 + D3 + D4 + D6 + JS 测试 + Kotlin 单测 + 真机场景验收（S1-S6、S8、S9）。
- **P2（第二阶段）**：D5 IME 深水区 + 真机 S7 专项。**若 P1 真机验收（S1）复现 IME 尾追并入且 P1 未能闭合该路径，P2 升级为 blocking**（调查结论第 3 条：中文 IME 疑似用户实撞路径）。

### 范围内胶囊语义总表

| 场景 | 行为 |
|------|------|
| Picker/引用落文插入 | 确认胶囊，登记持久化区间 |
| 胶囊后直接尾追（中/英/粘贴） | 新内容落胶囊外，区间不变 |
| 胶囊内部点击/方向键 | 光标吸附到胶囊 end |
| 选区跨胶囊删除 | 整颗删除（D3，P1） |
| 选区跨胶囊输入/组合态替换 | 整颗删除 + 输入纯文本落文（**依赖 D5，P2**；P1 阶段手动整选输入经选区吸附正常，组合态未闭合前为已知限制） |
| 退格贴胶囊 / 前向删除 / 空 commitText 退格 / 词删相交 | 整颗删除（D3，P1） |
| 相邻两颗胶囊间字符被删 | 不融合（各自独立，D2 双处合并抑制） |
| 切会话/重启水化 | 持久化区间直接恢复，不重扫 |
| 旧版本草稿（无 tokenRanges 字段）/ undo_send 恢复 | 扫描兜底一次，写回固化（已知限制） |
| 全屏编辑退出回填 | remap 保真写入（D1 带外路径） |
| 手输 `$xxx` | 纯文本不成胶囊（现状） |
| 发送 | 明文照旧，core 扫描不动 |

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `packages/core/src/domain/chat/model/composer-draft.schema.ts` | 导出 `ComposerDraftTokenRange`；schema 加 `tokenRanges` optional + 校验；serialize 透传；parse 单独 safeParse（非法→undefined 正文保留、缺失不写自有键） |
| 2 | `apps/mobile/src/storage/chat-composer-draft.ts` | 类型/写/读/缓存全链透传；**`applyComposerStatusAttachmentsReplace` 保留 `prev.tokenRanges`**；`writeChatComposerDraft` 加可选 ranges 参数 |
| 3 | `apps/mobile/src/components/chat/useChatComposerController.ts` | 四咽喉点落库；初值/syncFromDraft 持久化优先 + undefined 兜底；syncFromDraft ranges 按内容比较；清空口径 DB NULL |
| 4 | `apps/mobile/src/components/chat/NativeChatComposer.tsx` | `setText(text, cursor?, ranges?)` M7 扩展（接口 + commitExternalText）；水化链携带 ranges；TODO(IME) 注释更新为指向 D5 |
| 5 | `apps/mobile/src/components/chat/native-composer/token-ranges.ts` | `TokenRange` 复用 core 类型；`remapTokenRanges` 导出供全屏回填复用；`scanTokensToRanges` 定位注释更新（undefined 兜底 + 发送/测试辅助） |
| 6 | `apps/mobile/src/screens/tabs/ChatTabScreen.tsx` | 全屏退出回填改带 remap 后的 ranges（D1 带外路径） |
| 7 | `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts` | undo_send 恢复写 undefined（不传字段，允许兜底一次） |
| 8 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx` | 水化 {text, ranges} ref；写回仅未编辑时透传（D6） |
| 9 | `patches/react-native-enriched-markdown+1.1.1.patch`（包内 Kotlin） | D2 五处特判 + protected 分支表 + addRange 无合并 + D3 五入口 + D4 setValueFromJS 映射（补丁重生成，`npx patch-package react-native-enriched-markdown`） |
| 10 | `apps/mobile/__tests__/` + core schema 测试 + 包内 Kotlin 测试 | 见测试策略 |

## 详细实现步骤

- Step 1 — phase-schema-ranges — blocking: yes — qa: auto：D1 全链（core schema + mobile 存储含 applyComposerStatusAttachmentsReplace + controller 四咽喉点 + 两条带外路径 + undefined 兜底）+ T-CA1~T-CA5。
- Step 2 — phase-native-protect — blocking: yes — qa: auto：D2 + D3 补丁扩展（node_modules 内改源 → 重生成补丁）+ **Kotlin 单测（blocking）：RangeEditAdjustmentTest 分支表矩阵 + FormattingStoreTest 相邻不融合/无半截/替换继承排除**。
- Step 3 — phase-hydrate-link2token — blocking: yes — qa: auto：D4 setText ranges 扩展 + setValueFromJS 映射 + setTokenRanges 幂等 + 水化通道 + T-CA6。
- Step 4 — phase-desktop-passthrough — blocking: no — qa: auto：D6 + T-CA7。
- Step 5 — phase-device-qa-p1 — blocking: yes — qa: manual_user：真机 P1 验收 S1-S6、S8、S9（场景清单见测试策略；荣耀真机过 PC 安装门流程照 RULE）。
- Step 6 — phase-ime-p2 — blocking: 按 D7 触发条件 — qa: manual_user：D5 + 真机 S7 中文 IME 专项。
- Step 7 — phase-docs — blocking: no — qa: auto：CHANGELOG + iteration-state 收口。

## 测试策略

JS 侧（jest，mock 原生输入 + 断言 wrapper 行为，既有 `enriched-markdown-mock` 体系沿用；mock 只记录调用 `test-utils/enriched-markdown-mock.tsx:157-159`，native 幂等等行为由 Kotlin 单测/真机承担）：

- T-CA1 — blocking: yes — 草稿 schema roundtrip：带 tokenRanges 读写逐字段相等；`start > end` / 负数 / 非整数拒；**坏 ranges + 正文 → text/attachments 保留、tokenRanges === undefined**；旧 JSON（无字段）parse 后结果对象**无 tokenRanges 自有键**；**旧代码读新 JSON（parse 自构造对象路径）→ text 保留、ranges 静默丢弃（回滚兼容）** → Step 1
- T-CA2 — blocking: yes — controller 初值：草稿带 ranges → 直接使用（探针断言 `scanTokensToRanges` 不被调用）；undefined → 兜底扫描一次且首次 persistDraft 写回带值；**水化 `{text:'手输$foo', tokenRanges:[]}` → 经 project/applyComposerStatusAttachmentsReplace 状态条后 tokenRanges 仍为 `[]`，不触发扫描** → Step 1
- T-CA3 — blocking: yes — 切会话 `syncFromDraft` 同 T-CA2 两分支；半截场景：草稿文本 `$技能尾追` + ranges `[{0,3}]` → 水化后 tokenRanges 仍 `[{0,3}]`（尾追不升格）；**同文本不同 ranges 切会话**（A `[{0,3}]` vs B `[]`，文本相同）→ ranges 各归各位不串台 → Step 1
- T-CA4 — blocking: yes — 落库咽喉点：插入/打字/删除后 persistDraft 的 payload 含正确 ranges；**发送清空 → DB 置 NULL**（下次水化 undefined + 空文本，扫描必空）→ Step 1
- T-CA5 — blocking: yes — 既有贴边不并入用例（`native-composer.test.tsx:353-362`）保持绿；新增粘贴贴边变体 → Step 1
- T-CA6 — blocking: yes — 水化两条真实链：首帧 `defaultValue` 按持久化 ranges 合成 markdown（`$技能尾追` + `[{0,3}]` → 链接只包 `$技能`）；**运行期水化 `setText(text, undefined, ranges)` 合成与首帧一致**（不等 prop 收敛）；同内容不二次下发（复用 `native-composer.test.tsx:413` 既有断言手法）→ Step 3
- T-CA7 — blocking: yes — desktop 写回：未编辑（composerText === 水化文本）→ payload 含原样 tokenRanges；**已编辑 → payload 无 tokenRanges 字段** → Step 4

Kotlin 单测（**blocking**；`android/build.gradle:291-292` 已有 junit 4.13.2 + robolectric 4.14.1，`FormattingStore`/`RangeEditAdjustment` 纯 Kotlin 不依赖 View，与既有 `HarnessSmokeTest.kt` 同目录）：

- KT-CA1 — blocking: yes — `RangeEditAdjustmentTest`：D2 protected 分支表逐行矩阵（左插右移/右插不动/内插整删/相交删整删/左右侧平移；`growsAtStartOnInsert=false` 锁定）→ Step 2
- KT-CA2 — blocking: yes — `FormattingStoreTest`：相邻 TOKEN 不融合（`addRange` 无合并路径 + `coalesce` 跳过）；`adjustForEdit` 替换不继承 TOKEN；调整后不产生半截 range → Step 2

真机场景清单（S = device scenario，manual_user）：

- S1 Picker 插入胶囊后直接尾追中文/英文 → 不并入（P1 门；**若中文尾追仍被并入 → P2 升 blocking**）
- S2 胶囊后空格→删空格→尾追 → 不并入
- S3 胶囊中间点击/长按选区 → 光标吸附/选区扩整；选区跨胶囊删除 → 整颗删
- S4 前向删除：`adb shell input keyevent 112`（KEYCODE_FORWARD_DEL）注入，不依赖外接键盘
- S5 切会话/杀进程回来 → 胶囊边界与离开时一致；native setTokenRanges 幂等（S5 复核）
- S6 旧版本草稿升级（构造无 tokenRanges 字段的草稿 JSON）→ 胶囊照常渲染（兜底扫描）
- S7 中文 IME 组合态贴胶囊提交（拼音组合中光标位置/提交后归属）→ P2 门
- S8 胶囊相邻粘贴多行文本 → 粘贴内容落胶囊外、不误转 markdown（既有粘贴链回归）
- S9 **相邻两颗胶囊间字符删除** → 两颗各自独立不融合（D2 双处合并抑制的真机验证）

## 兼容性或迁移说明

- **草稿迁移**：JSON optional 字段，无 DDL；旧草稿 undefined → 兜底扫描一次，写回固化，升级无感（旧行为残留面仅限「从未再次打开过的旧草稿」与 undo_send 恢复）。
- **回滚（新版本草稿被旧代码读）**：`parseComposerDraftJson` 自构造 `{text, attachments: kept}` 喂 schema（`:82`），未知字段到不了 `.strict()`——**静默丢弃 tokenRanges、正文保留**（zod 4 `.strict()` 对未知键是 reject，但该路径根本不把未知键喂进去）；后果仅是「旧版本下一次写回永久丢 ranges」，无文本丢失风险。
- **desktop**：读侧忽略新字段；写回仅未编辑时透传（D6），编辑后省略字段。
- **发送管线零改动**：明文形态、core 扫描、发送门闩全不动。
- **转录渲染不动**：`RefTokenText` 是显示链路，与输入框 stores 无关。
- **手输行为不变**：纯文本；发送扫描照常把 `$技能名` 变 skillAttach。
- **linkVariants 说明**：D4 后 `^nmskill:`/`^nmtoken:` 两个变体对胶囊不再生效（TOKEN 样式由 `TokenStyleHandler` 取 `style.linkColor`/`linkBackgroundColor`/`linkBorderRadius` 等基础键，`TokenStyleHandler.kt:24-45`）——**胶囊视觉不变**；变体键退化为冗余配置，`markdownStyle.link` 基础键**禁止删除**（删则胶囊掉样式）；既有测试 `native-composer.test.tsx:308-331` 锁着变体键，清理时同步改。
- **已知限制披露**：①全屏 CodeMirror（`PromptEditorScreen`）与旧 webview composer 的高亮仍按 `COMPOSER_TOKEN_RE` 全扫，「尾追并入高亮」不在本迭代闭合范围；②undo_send 恢复允许兜底扫描一次；③P1 阶段组合态替换（S7 路径）未闭合前，选区跨胶囊输入依赖 D5。
- **上游对照**：`.reference/enriched-markdown` 仅供 rebase 参考；本迭代全部 native 改动落在补丁内，升级库版本须重生成补丁（既有 D10 流程，composer-native spec）。

## 风险与回滚方案

| 风险 | 应对 |
|------|------|
| 补丁面扩大 → 上游 1.1.x rebase 成本上升 | native 改动收敛在 5 个 Kotlin 文件（FormattingStore / RangeEditAdjustment / EnrichedMarkdownTextInputView / InputConnectionWrapper 不动于 P1 / InputParser 经 setValueFromJS）；升级前重生成补丁 |
| protected 区间策略与 IME 组合态冲突（抢 composing 区间） | P1 不动 InputConnectionWrapper（D5 属 P2）；RangeEditAdjustment 层只调区间不改文本，组合态安全（phase 抑制 + lastProcessedText 早退先例）；S1 真机门兜底 |
| 光标吸附影响点击手感（点胶囊中间光标跳尾） | 与 LINK 既有上游语义一致；S3 真机验收，不可接受再调吸附策略（如点击落 start） |
| desktop 写回透传遗漏/错位 → 跨端丢或错 ranges | D6 编辑检测 + T-CA7 两分支锁死 |
| undefined 与 `[]` 语义混用导致兜底扫描复活 | T-CA1/T-CA2 锁死「undefined ≠ 空数组」；schema 不设 default；parse 缺失不写自有键 |
| 缓存投影链再丢字段（未来新增 transform） | T-CA2 的 apply 断言守卫；新增字段时同步核对 `applyComposerStatusAttachmentsReplace` |
| 水化 LINK→TOKEN 后序列化形态变化 | composer 已禁 Copy-as-Markdown；MarkdownSerializer TOKEN 输出明文与 LINK displayText 一致 |
| 旧草稿兜底扫描升格半截 token（旧行为残留） | 仅 undefined 草稿一次；S6 验收；接受为已知限制 |
| 回滚 | JS 层与补丁层独立可回退；草稿新字段向后兼容（旧代码静默丢弃，正文保留） |

## R1 修订记录（doc-fix 闭合清单）

- P0-1：D2 protected 策略改写为与 JS remap 对齐的分支表（左插右移/右插不动/内插整删/相交删整删/侧删平移）+ `growsAtStartOnInsert` TOKEN 固定 false + KT-CA1 单测锁表。
- P0-2：D1 存储链补 `applyComposerStatusAttachmentsReplace` 保留 `prev.tokenRanges`；T-CA2 加投影链断言。
- P1-1：带外写入两条路径（全屏回填 remap / undo_send undefined）入 D1 + 变更点 #6/#7。
- P1-2：`tokenRanges` 单独 safeParse（非法 → undefined 正文保留）；T-CA1 坏 ranges 用例。
- P1-3：清空口径改 DB NULL；T-CA4 断言改写。
- P1-4：D6 加编辑检测（仅未编辑透传）；T-CA7 两分支。
- P1-5：`addRange` 无合并路径 + `coalesce` 跳过（双处）；S9 真机场景。
- P1-6：M7 扩展 `setText(text, cursor?, ranges?)`；T-CA6 运行期水化链断言。
- P1-7：`syncFromDraft` ranges 按内容比较；T-CA3 同文本变体。
- P1-8：D3 五入口统一 helper（空 commitText + deleteSurroundingText 一般参数 + FORWARD_DEL）。
- P1-9：Kotlin 单测升 blocking（KT-CA1/KT-CA2，junit+robolectric 已在）；S4 改 adb keyevent 112。
- P2-1：实现注改写（parse 自构造对象 → 静默丢字段正文保留；回滚后果=下次写回丢 ranges）；T-CA1 回滚用例。
- P2-2：兼容性节 linkVariants/TokenStyleHandler 说明。
- P2-3：T-CA6 改 JS 可测面（native 幂等归 KT 单测/S5）。
- P2-4：parse 缺失不写自有键；T-CA1 断言。
- P2-5：LINK→TOKEN 映射收敛在 setValueFromJS（不动 InputParser 本体，pasteMarkdown/测量链无感）。
- P2-6：`ComposerDraftTokenRange` 类型由 core 导出，storage/token-ranges 复用。
- P2-7：语义总表选区跨胶囊「输入」标 (D5/P2)。
- 证据锚点修正：`run-agent-turn.ts:543` → 扫描 `:663-667` / append `:724-731`；`token-ranges.ts` 类型 `:29-33`（`:12-15` 为模块注释）；右边界 `:93-94`（循环 `:92-99`）；`InputConnectionWrapper.kt` 类注释 `:8-28`、`setComposingText` `:52-77`。
