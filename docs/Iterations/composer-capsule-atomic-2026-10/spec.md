---
date: 2026-10-19
---

# 输入框胶囊原子化根治（composer-capsule-atomic-2026-10）技术规格（SPEC）

> 版本：r6（2026-10-21 fix-p3 收口：P3-1 全屏删除锚 / P3-2 水化对称 / P3-4 T-CA9③ 单链路直出口径 + D 空措辞以实现为准 + 锚点漂移括注，见「R6 修订记录」；r5：spec-check 第 1 轮 No-Go fold（D9 运输链/掩码、D11 对齐、D10 守卫）；r4：cr-func fold D8-D11；r3/r2：R2/R3/R1 审查闭合）

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
6. **e2e 真机佐证（2026-10-19，荣耀 EBG-AN00 debug 包）**：①水化吸收复现——贴胶囊右缘打 `z` 活态不吸收（胶囊右缘像素不动），force-stop 冷启水化后被正则引导吞入（右缘 +23px ≈ z 字宽）——确证第 3 条第 1 项与 D1 的必要性；②插入落文后首次退格观测为「整颗胶囊一键全删」——**已取证（2026-10-20 NMTrace 插桩）**：根因是空草稿插入无尾随空格、光标贴胶囊右缘（`setTokenRanges [(0,13)] textLen=13 sel=13`），整删即原子删除的正确表现（详见 S10）；③点胶囊中部光标被吸附到胶囊尾（现由 LINK 语义承担）——D4 的 LINK→TOKEN 映射落地后，D2 的 selectionAdjustedForAtomicLinks 纳入 TOKEN 成为防回归必要条件（D4 依赖 D2 同批）。**附发现（取证副产品）**：焦点收起再唤起键盘 + 光标置于 0 处输入单字符后，JS 侧下发 `ranges=[]`——既有胶囊区间丢失不恢复（D1 持久化优先 + D4 三跳水化的修复面实证）。

## 设计目标

1. **边界冻结**：胶囊生成后 `[start,end)` 不可因任何编辑增长/被部分改写；尾追/贴边输入落在胶囊外。
2. **原子删除覆盖完整**：折叠光标退格（既有）、选区删除、前向删除全部整颗删除。
3. **确认态持久化**：草稿 JSON 记录 `tokenRanges`，水化直接使用；正则全扫从水化链路退役（仅无字段的旧草稿与明确允许的带外写入兜底）。
4. **发送管线最小改动**：core 扫描正则（`scanAtPathAttachments` / `scanSkillAttachments` / `composer-send-intent`，发送链挂点 `run-agent-turn.ts:663-667`、append `:724-731`）**不动**；chip 模型（D8）后明文出现贴邻 token（`$A$B`）全量扫描不认——发送挂点前加**区间感知扫描**（D9）以 `tokenRanges` 为权威补挂，全量扫描保留给手输 token，两路去重合并。
5. **手输语义显式化**：手输 `$xxx`/`@xxx` 保持纯文本不成胶囊，行为与现状一致。

## 非目标

- 不引入 live/growable token（手输自动成胶囊、边打边长）——如需另立迭代。
- 不做哨兵字符（调查结论第 4 条否决）。
- iOS 不在范围（本仓只出 Android，补丁仅 Android 侧；iOS input 无 TOKEN 概念）。
- 宏链 `ComposerInputWebView` / composer-input 包不动（独立链路）。
- 全屏 CodeMirror 编辑器（`PromptEditorScreen`）与旧 webview composer 的胶囊**高亮体系**不改（独立正则高亮，共享 `COMPOSER_TOKEN_RE`；「尾追并入高亮」作为已知限制披露，见兼容性节）；但全屏的**插入落文形态**与 dock 共用 `buildTokenInsertion`，随 D8 chip 口径一并零空格化（D10 统一口径，断言同步）。
- IME 组合态的选区规范化（InputConnectionWrapper pre-super 的**非删除语义**拦截）为 P2 阶段（D5）；D3 的空 `commitText` **删除**拦截属 P1（`isComposing` 门控，仅非组合态）；P1 的 native 区间策略只调区间不改文本，不与组合态抢编辑权。

## 总体方案

### 核心决策

**D1 确认态 = 持久化 `tokenRanges`（草稿 schema 扩展 + undefined 兜底迁移）**

- **schema（`packages/core/src/domain/chat/model/composer-draft.schema.ts`）**：
  - 新导出结构类型 `ComposerDraftTokenRange = { start: number; end: number }`（供 storage 层与 `token-ranges.ts` 复用，避免 storage → UI 组件目录的反向依赖）；`token-ranges.ts` 的 `TokenRange`（`:29-33`）改为复用该类型。
  - `composerDraftSchema` 加 `tokenRanges: z.array(...).optional()`（元素 `start/end` 非负整数 + **`start < end`** refine——零长度区间 JS remap 保留、native `RangeEditAdjustment.kt:125` 剔除，两侧行为不一，一律拒之门外）；**不设 default**——`undefined`（旧数据，允许兜底扫描）与 `[]`（确认无胶囊，禁止扫描）语义不同。
  - 不做 `text.length` 长度/有序/重叠校验——越界由消费侧防御（JS `token-ranges.ts:140-147`、native `EnrichedMarkdownTextInputView.kt:1067` 丢越界）。
  - `serializeComposerDraftJson`（`:98-118`）：有值**过滤非法区间后透传**（丢弃 `start >= end` 等非法条目、其余照写，全空写 `[]`，**不抛错**——落库链永不被 ranges 炸；与 parse 同口径）；既有「text 空 + attachments 空 → null」语义不变（见下「清空口径」）。
  - `parseComposerDraftJson`（`:57-87`）：`tokenRanges` **单独 safeParse**（不与 text/attachments 共用一次调用）——非法 ranges（`start > end`、负数、非整数、字符串、null）→ 当作 `undefined`，**text/attachments 照常保留**（对齐既有「非法附件逐条丢、正文永不因附件而丢」的 `:52-55` 口径）；**字段缺失或存在但非法，结果对象一律不写入 `tokenRanges` 自有键**（避免 zod optional 输出自带 undefined 键打破既有 `node:assert/strict` deepEqual 断言 `composer-draft.schema.test.ts:79-86`、`:174-189`）。
- **mobile 存储链（`apps/mobile/src/storage/chat-composer-draft.ts`）**：
  - `ChatComposerDraft` 类型（`:13-16`）、`persistAttachTextDraft`（`:61-72`）、`writeChatComposerDraft`/`writeChatComposerDraftState`（`:78-134`）、内存缓存、`hydrateChatComposerDraftFromDb`（`:156-180`）全链透传；
  - **`applyComposerStatusAttachmentsReplace`（`:186-204`）**：重建缓存条目时**保留 `prev.tokenRanges`**（现为 `{text: prev.text, attachments: merged}` 丢字段——controller 水化链 hydrate → project → apply（`useChatComposerController.ts:344-364`）会先丢 ranges 再进 `syncFromDraft` 兜底扫描，`tokenRanges: []` 的「确认无胶囊」退化为 undefined，手输 `$foo` 每次水化被升格，打死目标 3/5）；`refreshComposerAnnotateChips` 走同一函数自动修复。
  - `writeChatComposerDraft` 追加**第 4 参** `(sessionId, text, sessions?, tokenRanges?)`（带外写入口，见下；现有三参调用与 `chat-composer-draft.test.ts:173` 零改动）。
- **controller 四咽喉点 + 水化（`apps/mobile/src/components/chat/useChatComposerController.ts`）**：
  - 初值（`:207-209`）与 `syncFromDraft`（`:301-314`）：`draft.tokenRanges ?? scanTokensToRanges(draft.text)`——undefined 才扫描兜底，兜底结果**在 syncFromDraft 的 undefined 分支内直接调一次 `persistDraft` 写回固化（仅此一次；text 与 ranges 均空则跳过，避免空会话每次水化写一次 null 的无害写放大）**；
  - `syncFromDraft` 的 ranges 更新**按内容比较**（长度 + 逐元素 start/end）而非卡在 `textChanged`（`:303` 现条件）——否则同文本不同会话切换时 ranges 串台（A 会话确认胶囊 vs B 会话手输同串）；
  - `persistDraft`（`:281-290`）/ `onChangeText`（`:400-411`）/ `commitComposerText`（`:325-337`）落库带 `tokenRangesRef.current`；
  - **清空口径**：发送清空走 `clearChatComposerDraft`（`:438`）写 DB `null`（serialize 对空 text+空 attachments 恒 null，`composer-draft.schema.ts:110-112`，`[]` 落不了库）——下次水化 `undefined` + 空文本，扫描结果必空，无升格风险；React state 侧置 `[]`（`:441-442`）不变。
- **带外写入路径两条**：
  - 全屏编辑退出回填（`apps/mobile/src/screens/tabs/ChatTabScreen.tsx:172-174` 现调 `writeChatComposerDraft(targetSessionId, text, sessions)` 覆盖掉 DB ranges）：改为读旧草稿后用 `remapTokenRanges(旧文本, 新文本, 旧 ranges)`（`token-ranges.ts:67-101`，需以可导出纯函数形态复用）映射写入；**旧草稿 `tokenRanges` 为 undefined → 回填写 `undefined`（不传字段，允许下一次水化兜底扫描一次），不做扫描预处理**——全屏 CodeMirror 的正则高亮虽不动（非目标），但区间数值可用 remap 保真（remap 调用点钉在 `ChatTabScreen` 退出回填处：读旧草稿 → remap → 带第 4 参写入）；
  - undo_send 恢复（`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:226-233`）：恢复文本无 ranges → 写 `undefined`（不传字段），允许下一次水化兜底扫描一次，记入已知限制（恢复的文本通常是完整历史明文，扫描升格面与旧行为相同）。
- 无 DDL 迁移（`composer_draft_json` TEXT 列，`chat-schema.ts:16-25`；读写 `sqlite-session.repository.ts:133-158`）。

**D2 native TOKEN 受保护语义（补丁内 Kotlin，五处特判 + protected 区间策略表）**

- `FormattingStore.adjustForEdit`（`:166-179`）：`inheritsReplacementAtStart` 改为 `{ it.type != StyleType.LINK && it.type != StyleType.TOKEN }`。
- `selectionAdjustedForAtomicLinks`（`:41-54`）：纳入 TOKEN（光标落 TOKEN 内部 → 推到 `token.end`；选区与 TOKEN 部分相交 → 扩整颗）——与 LINK 既有语义同款，`onSelectionChanged` 消费点 `EnrichedMarkdownTextInputView.kt:481-499` 自动生效。
- `seedPendingStylesFromSelection`（`EnrichedMarkdownTextInputView.kt:543-554`）：`if (style == StyleType.LINK || style == StyleType.TOKEN) continue`——选区改写不再给 TOKEN 种 pending style。
- **`addRange` 合并抑制**（`FormattingStore.kt:105-126`）：合并条件 `existing.start <= mergedEnd && existing.end >= mergedStart` 对「相邻」（`existing.end == new.start`）也成立——为 TOKEN 提供无合并添加路径——**钉 `addRange(..., allowMerge: Boolean = true)` 参数形态**（不用 TOKEN 专用方法），`setTokenRanges` 逐条添加（`:1061-1073`）改走 `allowMerge = false`；`coalesceAdjacentSameTypeRanges`（`:187-203`）跳过 TOKEN。两处一起改才能保证「删掉两颗胶囊之间的字符后」逐键下发不把两条 TOKEN 合成一条。protected 判定入口：`RangeEditAdjustment.adjustForEdit` 为泛型（`<T : MutableRangeBounds>`，`RangeEditAdjustment.kt:45`）拿不到 type——加参数 `isProtected: (T) -> Boolean = { false }`，`FormattingStore.adjustForEdit`（`FormattingStore.kt:166`）传 `{ it.type == StyleType.TOKEN }`，protected 为 true 时走下表分支。
- **`RangeEditAdjustment` protected 分支表（仅 TOKEN；与 JS `remapTokenRanges` 逐条对齐）**：

  | 编辑形态 | 区间结果 | 与 JS 对齐点 |
  |---|---|---|
  | 纯插入，插入点 `<= range.start` | 整体右移 `insertedLength`（新字符落左侧外） | `token-ranges.ts:95-96` 左边界右移 |
  | 纯插入，插入点 `>= range.end` | 原样不动（新字符落右侧外） | `:93-94` 右边界保留 |
  | 纯插入，插入点严格在 `(start, end)` 内 | **整条移除**（胶囊死亡） | `:98` 内部插入摘除分支 |
  | 删除/替换与区间任意部分相交（含整条覆盖、部分覆盖） | **整条移除** | 替换与删除共用同一相交判据；JS 侧同样摘除（remap 单编辑区折叠，`token-ranges.ts:88-99`），native 兜底的是不经过 JS 的编辑路径 |
  | 删除完全在区间左侧 / 右侧 | 平移 / 不动 | remap 平移分支 |

  - 禁用对 TOKEN 的内部插入增长（`:103-118` 现三支中「内部增长」分支）、CLIPPED_END 扩尾（`:83-88`）、CLIPPED_START 继承（`:90-101`）；`growsAtStartOnInsert` 对 TOKEN 固定 `false`。
  - 安全网定位：正常路径下光标吸附 + 前三条特判已阻止「编辑落进区间内部」；protected 分支兜底 FormattingStore 层不产生半截/扩张/融合 range。该层只调区间不改文本，与 IME 组合态兼容（`EditSession.kt:23-30` phase 抑制 + `lastProcessedText` 早退先例）。
  - **Kotlin 单测锁表**（blocking，见测试策略）：分支表逐行矩阵。

**D3 原子删除覆盖面扩展（补丁内 Kotlin，七入口统一 helper）**

- 既有三入口保留：`onKeyDown` KEYCODE_DEL（`EnrichedMarkdownTextInputView.kt:225-243`）、`InputConnectionWrapper.deleteSurroundingText(1,0)`（`:97-106`）、`InputConnectionWrapper.sendKeyEvent` KEYCODE_DEL（`:108-121`）。
- 新增四入口，统一走「选区/删除区与原子区间（LINK/TOKEN）相交 → 扩为整颗区间 → 删除」helper（复用 `deleteLinkBeforeCursor` `:1027-1048` 的区间删除内核）：
  - **空 `commitText`**（`InputConnectionWrapper.kt:19-21` 注释明确空文本表示退格；`:86-95` 现只发按键事件不走原子删）——删除窗：有选区用选区，无选区用 `[max(0, sel-1), sel)`；命中原子区间 → 调 helper 删整颗、**保留原 Backspace 按键事件**、返回 true、**不调 super**；未命中走原路径。**仅 `!isComposing` 时启用**（组合态信号见下，P1 就引入）；
  - **`deleteSurroundingText(n, m)` 一般参数**：计算出受影响文本区间与原子区间相交 → 扩整颗（词删 `n>1`、前向 `m>0` 均覆盖）。**并集口径（全部删除类入口统一）**：删除区 = 原删除窗 ∪ 所有相交原子区间（多颗胶囊各自扩整颗）；删除后光标落删除区起点，前向删除光标不动；
  - **前向删除**：`onKeyDown` 与 `sendKeyEvent` 补 `KEYCODE_FORWARD_DEL`（光标后一字符在区间内 → 整颗删，光标不动）。
  - **`deleteSurroundingTextInCodePoints`**：override 转发——code-points 偏移换算为字符偏移后走同一 helper（部分 IME 用该变体，不覆盖则绕过原子删）。
- `deleteLinkBeforeCursor` 扩展选区删除：`cursorStart != cursorEnd` 且选区与 **TOKEN** 相交时，删除范围扩整颗（光标落区间起点）。**LINK 保持上游折叠光标语义不动**（改动面最小；现网 LINK 选区删除未观测到问题，e2e 佐证吸附由 LINK 正常承担——若未来要求 LINK 同款扩整，另立变更并过兼容性披露）。
- **组合态信号（P1 引入，D5 复用）**：wrapper 加最小 `isComposing` 标志——`setComposingText` 非空置 true，`finishComposingText` / `commitText` / **`setComposingText` 空串**清 false（部分 IME 用空 setComposingText 结束组合，不清理则标志卡 true、原子拦截失效）；空 `commitText` 删除拦截仅 `!isComposing` 时启用（**读旧值判定、再清标志**——`commitText` 若先清后判，组合态的空 commitText 会被误当非组合态拦截，恰是本门要防的误删）。P1 若无此信号，「仅非组合态触发」无从判定（要么中文 IME 组合期误删、要么私自发明），阶段边界倒置。备选：`BaseInputConnection.getComposingSpanStart(editText.text) == -1`（无状态，但依赖平台 span 行为）。
- **同一按键并发收敛**：华为隐藏 IME 可能一次按键同时触发两条删除路径（空 `commitText` + `deleteSurroundingText`，S10 e2e 观测疑点）。机制钉死（**batch 域内抑制**，不吞独立退格）：原子删除仅在 `isBatchEdit == true` 时置一次性标志 `suppressNextDelete`，`endBatchEdit` **无条件清**——同 batch 的后续删除入口读到标志 → 本次不删、不调 super、**也不再 dispatch Backspace**（首个入口已发过，避免 JS 收双 keyPress），标志放 view 层共享（`onKeyDown`/`sendKeyEvent` 在 view，wrapper 经 view 访问）。判据（**仅限同一物理按键多入口并发**）：最多删一颗胶囊；单个删除窗正常覆盖多颗时（词删 `n>1`、选区跨胶囊）仍按并集各自扩整颗；「无多删字符」= 不删删除窗 ∪ 相交原子区间之外的字。取证回退：若 S10 取证显示双路径不共享 batch（拆 batch），改用 clear-on-consume 变体（标志消费即清 + 抑制条件收紧为删除窗与刚删区间快照相交）。若取证证明单键只发一种信号，可简化为仅保留该信号路径。（**取证 2026-10-20 已定**：HwIME 单键不双发独立信号——「双路径」实为 sendKeyEvent 的 super 级联 onKeyDown，原子命中即 return true 短路，实测无双删；suppressNextDelete 保留为对其他 IME 的 deleteSurroundingText/空 commitText 组合的防御性兜底。）

**D4 水化链路统一与 native 区间一致性（补丁内 Kotlin + JS）**

- **M7 命令式通道扩展（三跳全链）**：`NativeChatComposerInstance.setText`（本仓 `NativeChatComposer.tsx:190-199`；库侧 instance 无 setText，勿改库类型）扩签名 `setText(text, cursor?, ranges?)`（`NativeChatComposer.tsx:196` 接口 + `useImperativeHandle` 实现体 `:437-446` + `commitExternalText` `:317-347`）；**中间跳同步扩参**——controller options.`setComposerText` 类型（`useChatComposerController.ts:118-131`）与 `ChatConversationPanel.tsx:152-157` 的面板回调都改三参透传（TypeScript 允许少参函数赋多参类型，漏改则第三参被静默丢弃、编译不报错——D4 在真实链路上等于没生效）。`commitExternalText` 收到 ranges 时**跳过 `remapTokenRanges`**，直接 `confirmedRangesRef.current = ranges` 后用它合成 markdown 并 dispatch（prop 收敛 effect 因内容相等短路 `:421-431`，不二次下发）；未传 ranges 保持现行 remap 路径；`confirmedRangesRef === null`（未传 tokenRanges prop 的旧模式）收到 ranges → 切确认制（现网恒传 prop，暴露面 0）。理由：`syncFromDraft` 调 `setComposerTextRef.current?.(draft.text, undefined, ranges)` 是同步命令调用，React prop 不会即时更新——不带 ranges 会用上一帧 `confirmedRangesRef`（冷启动 `[]` / 切会话旧区间）合成 markdown，正确值要等 prop 收敛 effect（`:416-435`）二次补发，存在旧区间合成窗口；**state 下发与 setText 第三参必须同一份数组**，防 prop 收敛用旧 state 覆盖。**依赖：D2 的 selectionAdjustedForAtomicLinks 纳入 TOKEN（现网吸附由 LINK 承担，映射成 TOKEN 后无人接管即回归）——D4 与 D2 同批落地。**`syncFromDraft` 的命令式下发条件为 `textChanged || rangesChanged`（带同一份 ranges）；instance 为 null 时第三参自然丢弃，由 prop 收敛 effect 兜底。
- **LINK→TOKEN 映射收敛在 `setValueFromJS`**：`setValueFromJS`（`EnrichedMarkdownTextInputView.kt:1104-1122`）在 parse 结果上做映射——`StyleType.LINK` 且 url 以 `nmskill://`/`nmtoken://` 开头 → `StyleType.TOKEN`（url 置 null）。**不改 `InputParser.parseToPlainTextAndRanges` 本体**：其另两个调用点 `pasteMarkdown`（`:881`）与 `InputMeasurementStore`（`:108`，只用 plainText）不受影响——粘贴路径的 `nmskill://` 链接保持 LINK（用户手输 markdown 链接语义），测量链无感。
- `setTokenRanges`（`:1061-1073`）保持「先清 TOKEN 再加」幂等覆盖，配合 D2 无合并添加。
- `MarkdownSerializer`（`:153`、`:173`）TOKEN 空分隔符输出明文——无需改；composer 已禁用 Copy-as-Markdown（`NativeChatComposer.tsx:506-513`），无泄漏面。

**D5 IME 组合态防线（P2 阶段，P1 过真机门后实施）**
- `InputConnectionWrapper`：`commitText` / `setComposingText`（`:52-77`）在 super 前做选区规范化——光标落 TOKEN 内部 → `setSelection(token.end)` 后照常提交；替换区与 TOKEN 相交 → 扩整颗后照常。**禁止 `return false` 拒绝**（IME 重试）；**禁止事后文本回滚**（每次 `setComposingText` 回滚 → IME 重提交 → 死循环抖光标）。
- 组合生命周期：**复用 P1 已引入的 `isComposing` 信号（D3）**，D5 扩展为完整 `finishComposingText` override 记录 + 修复动作：组合期间（`isTextChanging` 已跳过选区修正的 `:488` 语义沿用）只做 D2 区间保守策略，组合提交后做一次修复。
- 注意：wrapper 用「光标是否后退」推断退格（`:52-77`）；super 前移动光标会污染推断——规范化仅在「目标区间确为 TOKEN」时执行，且移动方向单调向后（token.end），不触发退格误判路径。
- 真机中文 IME 验证门：候选窗不抖、光标不飘、组合期间胶囊不闪、提交后尾追文字在胶囊外。

**D6 desktop 草稿写回透传（带编辑检测）**
- `apps/desktop/renderer/features/chat/ConversationPanel.tsx`：desktop 写回 effect 依赖 `composerText` 每键触发（`:347-360`），且存在回滚恢复直接改文本路径（`:755-771`）——**只透传未编辑的 ranges**：
  - 水化时把 `{text, ranges}` 存 ref（读侧 `:328-332` 现忽略胶囊语义不变）；
  - 写回 payload 仅当 `composerText === 水化文本` 时携带 `tokenRanges`（原样透传）；文本已编辑 → 省略字段（undefined → mobile 侧兜底扫描一次，行为同现状）；
  - desktop 自身不产生/不编辑 ranges（无胶囊 UI）；若未来要求编辑保真，将 `remapTokenRanges` 上提 core 两端共用（本迭代不做）。

**D7 阶段划分与验收门**
- **P1（本迭代主体）**：D1 + D2 + D3 + D4 + JS 测试 + Kotlin 单测 + 真机场景验收（S1-S6、S8-**S10**；S10 主判据「**一次物理退格最多删一颗胶囊且无多删字符**」，期望形态按取证回填）；D6 desktop 透传非阻塞（Step 4 可延后到迭代末，不 gate P1 移动端验收）。
- **P2（第二阶段）**：D5 IME 深水区 + 真机 S7 专项。**若 P1 真机验收（S1）复现 IME 尾追并入且 P1 未能闭合该路径，P2 升级为 blocking**（调查结论第 3 条：中文 IME 疑似用户实撞路径）。
- **R2 一致性批（Step 8，blocking）**：D8 已落事实入档 + D9 + D10 + D11 + T-CA9/10/11 + S11 真机抽样。

**D8 chip 插入口径（已落；2026-10-20 用户真机轮拍板）**
- 口径：胶囊是 chip 对象——**插入不产生任何分隔空格**（`buildTokenInsertion` 的 gapBefore/gapAfter/多 token join 空格全删，`composer-token-insert.ts`）；明文 `$A$B` 贴邻、token 由触发符切分，用户想加空格自行输入。**视觉分隔由胶囊自身承担**：原生 `TokenBackgroundSpan`（继承 open 化的 `RoundedBackgroundSpan`，`gapHorizontal=10f`/侧 → 相邻两颗 20px 缝）+ 矩形严格夹回 getSize 预留框（修旧版左右各溢出 padding 的互相叠压）。
- 实现记录（已落 commit，真机验证过）：`154b98976` remap 纯插入光标锚；`f0c808527` `findActiveAtQuery` 确认胶囊查询守卫（插 A 后光标贴尾不再把 A 整颗误当活动查询替换——「连插互替换」真因）；`4e5240bb4` 盒内 gap 几何；`06b00ba8a` chip 零空格 + TokenBackgroundSpan。
- 根因记录（NMTrace 真机取证）：`InputFormatter` 的 span 重挂按**span 类名**反查 handler，`RoundedBackgroundSpan` 同时注册于 Link/Token 两 handler——`firstOrNull` 撞 `LinkStyleHandler` 用 link 基础样式重造出 gap=0 实例，且描述符按类名相等导致旧 LINK pill 跨型复用——TOKEN 胶囊（含 gap）从未真正挂上，相邻胶囊视觉熔合成一条。子类让类名唯一命中 `TokenStyleHandler`，反查与 diff 复用均不再跨型。
- r3 中与 chip 口径冲突的描述（插入补尾空格/分隔空格等）以本节为准；本决策推翻 r3「发送管线零改动」前提 → D9 闭环。

**D9 发送链区间感知（CR-R2-01 P1 + R5 P0-1/P0-2 重设计，Step 8）**
- 缺陷（实测复现）：core `SKILL_TOKEN_RE = /(?<!\S)\$…/`（`scan-skill-attachments.ts:22`）要求 `$` 前空白/行首——`$A$B` 全量扫描只挂第一颗、`看这里$写作` 一颗不挂；`scan-at-path-attachments.ts:32` 的 `@([^\s@]+)` 未把 `$` 当终止符——`@路径$技能` 路径被污染成不存在路径。恰为本批测试锁定的形态。
- **运输链（R5 钉死，防静默断链三处）**：①mobile `executeRun`（`useChatComposerController.ts:527-539`，发送 content 在 `:628` `text.trim()`【r6 括注：行号随后续提交漂移至 `:684` 附近，以函数名定位为准】）用**未 trim 的 `textRef.current`** 做区间/掩码扫描（区间下标基于未 trim 草稿）；②结果经 `RunAgentTurnOptions` 新增字段（`attachments` + `excludedScanRanges`）下传——**三处必须同步补**：类型定义（`run-agent-turn.ts:251-287`）、`session-stream-unit-manager.service.ts` 的**转发白名单 `:1213-1218`**（只加 interface 不改白名单会被静默丢弃，与 r3 P0-2 同类坑）、`agent-run.service.ts:69-76` 选项类型；③core 全量扫描（`run-agent-turn.ts:543` 以 **trimmed** 为文本【r6 括注：漂移至 `:684-689` `maskComposerScanRanges` 调用点】）用 `excludedScanRanges` 掩码——**trim 偏移换算**：传给 core 的区间 = 原区间下标 − trimStart（trim 掉的前缀长度），越界/翻转丢弃。【r6 口径补：无区间草稿发送时 controller 也以 trim 后正文全量扫描直出 `attachments` 占 existing 位（87aa6ac5a，使 T-CA9③ 可单链路断言），core 侧再扫同键去重幂等，最终附件集合/顺序与旧口径逐项一致】。
- **掩码二段式（R5 P0-2：合并去重救不了 @ 污染——去重 key 不同）**：
  1. **区间扫描**：每个确认区间 slice 出区间文本单独扫（触发符在 index 0 天然过边界）→ `rangeResults`；
  2. **掩码全量扫描**：把每个确认区间替换成**等长空白**（下标不变）后再全量扫——掩码后全量扫描看不到胶囊内触发符，`@路径$技能` 的污染在源头消失，手输 token（区间外）照常识别 → `fullScanResults`；
  3. **合并**：`mergeAttachmentsByPath(rangeResults, fullScanResults)`——该函数**已有优先**（existing 位优先，`scan-at-path-attachments.ts:70-91`），区间结果必须放 existing 位。
- core 正则**不改**；手打贴字 `$`（无空格）维持历史不识别口径。
- 验收：连插两颗 `$A$B` 发送 → 两颗技能均挂载；`@docs/a.md$技能` 发送 → 附件只有 `/docs/a.md` + 技能（无污染路径）；无区间草稿发送行为与现状逐项一致；草稿首带空白 + 区间 → 区间不错位（trimStart 换算）。

**D10 全屏统一 chip 口径 + 全屏守卫 + 注释同步（CR-R2-02 P1 + CR-R2-04 P3 + R5 P1-3，Step 8）**
- 决策：`buildTokenInsertion` 为 dock/全屏共用件，**统一 chip 零空格口径**（不加分隔符参数）——单一口径、无参数分叉，全屏与 dock 编辑同一草稿行为一致。
- **全屏守卫（R5 P1-3：零空格后「连插互替换」在全屏回归——全屏没有 dock 的确认区间守卫）**：插入后光标贴 token 右缘，`findActiveAtQuery`（`composer-at-path.ts:52-74`）会把整颗已插入 token 当活跃查询，第二次确认时 `replaceStart = activeSkill.start`（`PromptEditorScreen.tsx:141-150`）把上一颗整颗替换。修法：**复用 dock 守卫**——`queryWithinConfirmedRange`（现于 `useChatComposerController.ts:700-710`）抽为共享纯函数（`composer-token-insert.ts` 或独立 util），全屏确认插入前等价检查：查询区间完全落在确认区间内 → 纯插入不替换；全屏的确认区间来源 = 进入全屏时的草稿 `tokenRanges`（随路由参数带入）+ 本次会话内已插入区间。
- 断言同步：`prompt-editor-screen.test.tsx:594-599 / :660-666 / :694-697` 三断言改零空格期望（含光标值 15/7/3）；**新增连插用例：全屏连续插两颗 → 文本 `$A$B`（不互替换）**。
- 注释同步清单：`apps/mobile/src/screens/stack/PromptEditorScreen.tsx:152`；`composer-token-insert.ts` 头注释（`:3`「补前后空格」、`:16`「以空格连接」残留）；patch 内 `RoundedBackgroundSpan` KDoc（getSize 公式补 gap 项）；`useChatComposerController.ts:694-699` 旧 JSDoc 与 `queryWithinConfirmedRange`(`:708`)/`insertTokensIntoComposer`(`:712`) 错挂归位。

**D11 remap 删除锚（CR-R2-03 P2 + R5 P1-1/P1-2 对齐，Step 8；实现已落 `aaa7fa30b`/`b3125a812`/`6418750e4`，本节为规格对齐记录）**
- 缺陷（实测复现）：相邻胶囊删左颗（`$A$B` 退格原子删 A → `$B`），JS remap 差分对齐把删除点猜进幸存 B 内部 → 保守摘除把 B 的区间一并抹掉（`remapTokenRanges('$A$B','$B',[{0,2},{2,4}]) → []`，应 `[{0,2}]`）。chip 贴邻成默认态后此路径高频。
- **签名（R5 钉死）**：`remapTokenRanges(prev, next, ranges, nextCursor?, prevCursor?)`——第 4 参 `nextCursor` 为既有纯插入锚（delta>0 分支不动）；**第 5 参 `prevCursor` 为编辑前光标**（新增），既有四参调用零影响。
- **删除锚语义（delta < 0 且 prevCursor 可用）**：删除段 D 由编辑前后光标差反推，**候选优先级**：显式编辑后光标 → 退格（编辑前光标=编辑区右缘）→ 前向删除（=左缘）→ 歧义区先退格后前向。**纯删除一致性守卫**：`prev` 去掉候选 D 后必须逐字等于 `next`，不过则回退。分类：区间与 D **有公共字符**（`r.start < D.end && D.start < r.end`，端点相触不算）→ 摘除；`r.end <= D.start`（D 左侧）→ **原位不动**；`r.start >= D.end`（D 右侧）→ 平移 delta；D 空（前向删除光标不动等）或光标缺失/守卫不过 → **现状差分分支**（只增强不回退）。【r6 修正：实现（`resolveDeletionSpan`）对 D 空候选是**跳过后按光标与差分编辑区相对位置反推非空 D**，`('$A$B','$B', undefined, 0)` 类场景优于「回退现状」原措辞；反推不出才落现状分支——以实现为准】。
- 纸面验算：删左颗（prevCursor=2, D=[0,2)）→ A 摘、B→[0,2) ✓；删普通尾字符（`$Ax`→`$A`，D=[2,3)）→ A 不动 ✓；删右颗（D=[2,4)）→ B 摘、A 不动 ✓；前向删 B（D 空）→ 现状分支正确摘 B ✓。
- **接线双侧（R5 P1-2：只接组件不接 controller 会被 prop 收敛覆盖）**：组件侧 `NativeChatComposer` 已加 `selectionRef` 镜像（`onChangeSelection` 推进、命令式 `setSelection` 落位同步），打字路径 `handleChangeText` 以选区右缘作 prevCursor 下沉（已落 `b3125a812`）；**controller 侧**：`advanceTokenRanges`（`useChatComposerController.ts:287`）经 `onChangeText` 调用时补传 prevCursor（编辑前 cursor 快照，注意选区事件与文本变更事件时序——以变更前值为准），否则 controller 保守摘除结果经 tokenRanges prop 收敛回组件并写库，幸存胶囊样式与持久化一起丢。【r6 补：**全屏侧**（`PromptEditorScreen.tsx`）打字/删除路径同接 prevCursor（CodeMirror 选区上报先于变更上发，用「上一拍」选区右缘快照，87aa6ac5a）；`syncFromDraft` 水化时 `prevCursorRef` 落 `draft.text.length` 与组件 `commitExternalText` 对称（87aa6ac5a）——三侧齐】。
- 测试（T-CA10，已落 8 例 + controller 级）：相邻删左颗幸存、显式双光标、删普通尾字符、删右颗、文本中段、前向删除、无 prevCursor 现状锁、守卫回退变体【r6 括注：前向删除用例实测形态 `('$A$B','$A', undefined, 0)`（判别力强于 r5 文字的 `(2,2)` 形态，`(2,2)` 行为已核验同得 `[{0,2}]`）】；**controller 级：`$A$B` 删左颗 → controller tokenRanges 幸存 `[{0,2}]` 且 persistDraft payload 同值**；**水化对称：切会话带区间草稿后不模拟选区直接原子退格 → 幸存保留**（87aa6ac5a）；S11 真机断言 DB `tokenRanges`。

### 范围内胶囊语义总表

| 场景 | 行为 |
|------|------|
| Picker/引用落文插入 | 确认胶囊，登记持久化区间；**零分隔空格直插**（chip，D8） |
| 胶囊后直接尾追（中/英/粘贴） | 新内容落胶囊外，区间不变 |
| 胶囊内部点击/方向键 | 光标吸附到胶囊 end |
| 选区跨胶囊删除 | 整颗删除（D3，P1） |
| 选区跨胶囊输入/组合态替换 | 整颗删除 + 输入纯文本落文（**依赖 D5，P2**；P1 阶段手动整选输入经选区吸附正常，组合态未闭合前为已知限制） |
| 退格贴胶囊 / 前向删除 / 空 commitText 退格 / 词删相交 | 整颗删除（D3，P1） |
| 相邻两颗胶囊间字符被删 | 不融合（各自独立，D2 双处合并抑制）；删掉其中一颗 → 幸存胶囊区间平移保留（D11 删除锚） |
| 切会话/重启水化 | 持久化区间直接恢复，不重扫 |
| 旧版本草稿（无 tokenRanges 字段）/ undo_send 恢复 | 扫描兜底一次，写回固化（已知限制） |
| 全屏编辑退出回填 | remap 保真写入（D1 带外路径） |
| 手输 `$xxx` | 纯文本不成胶囊（现状） |
| 发送 | 明文贴邻（chip，D8），core 正则不动；发送挂点区间感知补挂（D9） |

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `packages/core/src/domain/chat/model/composer-draft.schema.ts` + `packages/core/src/public/chat.ts` | 导出 `ComposerDraftTokenRange`（schema 内定义，**public/chat.ts 的 type 导出桶补一行**——mobile/storage 与 token-ranges.ts 经 `@novel-master/core/chat` 导入，漏则 Step 1 编译失败；类型导出不触发 export-snapshot 更新）；schema 加 `tokenRanges` optional + 校验（`start < end`）；serialize 过滤非法区间不抛错；parse 单独 safeParse（非法→undefined 正文保留、缺失**或非法**不写自有键） |
| 2 | `apps/mobile/src/storage/chat-composer-draft.ts` | 类型/写/读/缓存全链透传；**`applyComposerStatusAttachmentsReplace` 保留 `prev.tokenRanges`**；`writeChatComposerDraft` 加可选 ranges 参数 |
| 3 | `apps/mobile/src/components/chat/useChatComposerController.ts` | 四咽喉点落库；初值/syncFromDraft 持久化优先 + undefined 兜底（兜底在 undefined 分支内一次 `persistDraft` 写回）；syncFromDraft ranges 按内容比较；清空口径 DB NULL；**options.`setComposerText` 类型扩为 `(text, cursor?, ranges?) => void`（`:118-131` 注释同步三参口径）** |
| 4 | `apps/mobile/src/components/chat/NativeChatComposer.tsx` + `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | `setText(text, cursor?, ranges?)` M7 扩展（接口 `:196` + `useImperativeHandle` `:437-446` + `commitExternalText` `:317-347` 跳 remap 直写基线）；**ChatConversationPanel `:152-157` 回调扩三参透传（`:147-151` 注释同步）**——漏改则 TS 静默丢第三参；`NativeChatComposer.tsx:28` ref 注释同步三参；水化链携带 ranges；TODO(IME) 注释更新为指向 D5 |
| 5 | `apps/mobile/src/components/chat/native-composer/token-ranges.ts` | `TokenRange` 复用 core 类型；`remapTokenRanges` 导出供全屏回填复用；`scanTokensToRanges` 定位注释更新（undefined 兜底 + 发送/测试辅助） |
| 6 | `apps/mobile/src/screens/tabs/ChatTabScreen.tsx` | 全屏退出回填改带 remap 后的 ranges（D1 带外路径） |
| 7 | `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts` | undo_send 恢复写 undefined（不传字段，允许兜底一次） |
| 8 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx` | 水化 {text, ranges} ref；写回仅未编辑时透传（D6） |
| 9 | `patches/react-native-enriched-markdown+1.1.1.patch`（包内 Kotlin） | D2 五处特判 + protected 分支表（isProtected 入参）+ addRange 无合并 + D3 七入口 + 组合态 `isComposing` + 同键并发收敛 + D4 setValueFromJS 映射（补丁重生成 `npx patch-package react-native-enriched-markdown`，**重生成后 grep 补丁文本必含 RangeEditAdjustmentTest / FormattingStoreTest 等测试类名**，否则 clean install 后测试静默消失） |
| 10 | `apps/mobile/__tests__/` + core schema 测试 + 包内 Kotlin 测试 | 见测试策略 |
| 11 | 发送链：`useChatComposerController.ts` executeRun（区间/掩码扫描，未 trim 文本）+ `RunAgentTurnOptions`（`run-agent-turn.ts:251-287` 加 attachments/excludedScanRanges）+ `session-stream-unit-manager.service.ts` **转发白名单 `:1213-1218`** + `agent-run.service.ts:69-76` | D9 掩码二段式：区间 slice 扫描（rangeResults）+ 确认区间等长空白掩码后全量扫描（fullScanResults）+ `mergeAttachmentsByPath(rangeResults, fullScanResults)`（existing=区间）；core 侧按 excludedScanRanges（trimStart 换算）掩码自身全量扫描 |
| 12 | `apps/mobile/__tests__/prompt-editor-screen.test.tsx` + `apps/mobile/src/screens/stack/PromptEditorScreen.tsx` | D10：三断言零空格口径（含光标值）+ **全屏守卫**（`queryWithinConfirmedRange` 抽共享纯函数复用，路由带入 tokenRanges）+ 连插两颗用例 + 注释同步清单（composer-token-insert 头注释 / patch KDoc / controller JSDoc 归位） |
| 13 | `apps/mobile/src/components/chat/native-composer/token-ranges.ts` + `NativeChatComposer.tsx` + `useChatComposerController.ts` | D11 删除锚：remap 第 5 参 prevCursor（候选优先级反推 D + 纯删除一致性守卫 + 相交摘除/左不动/右平移/缺光标回退现状）；组件 selectionRef 镜像 + controller `advanceTokenRanges` 补 prevCursor（编辑前 cursor 快照）——**双侧下沉防 prop 收敛覆盖** |

## 详细实现步骤

- Step 1 — phase-schema-ranges — blocking: yes — qa: auto：D1 全链（core schema + mobile 存储含 applyComposerStatusAttachmentsReplace + controller 四咽喉点 + 两条带外路径 + undefined 兜底）+ T-CA1~T-CA5、**T-CA8**。
- Step 2 — phase-native-protect — blocking: yes — qa: auto：D2 + D3 补丁扩展（node_modules 内改源 → 重生成补丁 + grep 测试类名核对）+ **Kotlin 单测（blocking）：RangeEditAdjustmentTest 分支表矩阵（含多胶囊并集/零长度用例）+ FormattingStoreTest 相邻不融合/无半截/替换继承排除/选区吸附（TOKEN 扩整、内部推 end、在外返 null）**。
- Step 3 — phase-hydrate-link2token — blocking: yes — qa: auto（**依赖 Step 2**：D4 的 LINK→TOKEN 映射依赖 D2 选区吸附纳入 TOKEN，同批才不回归）：D4 setText 三跳扩参 + setValueFromJS 映射（KT-CA3）+ setTokenRanges 幂等 + 水化通道 + T-CA6（面板集成测试断言）。
- Step 4 — phase-desktop-passthrough — blocking: no — qa: auto：D6 + T-CA7。
- Step 5 — phase-device-qa-p1 — blocking: yes — qa: manual_user：真机 P1 验收 S1-S6、S8-S10（场景清单见测试策略；S10 判据见 D7；荣耀真机过 PC 安装门流程照 RULE）。
- Step 6 — phase-ime-p2 — blocking: 按 D7 触发条件 — qa: manual_user：D5 + 真机 S7 中文 IME 专项。
- Step 7 — phase-docs — blocking: no — qa: auto：CHANGELOG + iteration-state 收口。
- Step 8 — phase-r2-consistency — blocking: yes — qa: auto + S11 真机抽样：D9 发送链区间感知（T-CA9）+ D10 全屏统一 chip 断言与注释同步 + D11 删除锚（T-CA10）+ 接线测试（T-CA11）。依赖：D8 已落（真机轮四 commit），无需重做。

## 测试策略

JS 侧（jest，mock 原生输入 + 断言 wrapper 行为，既有 `enriched-markdown-mock` 体系沿用；mock 只记录调用 `test-utils/enriched-markdown-mock.tsx:157-159`，native 幂等等行为由 Kotlin 单测/真机承担。**运行命令：`npm test -w @novel-master/mobile`（pretest 自动 build core+webview；直接 `npx jest` 会读旧 dist——jest.config 把 `@novel-master/core/chat` 直连 `packages/core/dist`）**；core 用 `npm test -w @novel-master/core`、desktop 用 `npm test -w @novel-master/desktop`）：

- T-CA1 — blocking: yes — 草稿 schema roundtrip：带 tokenRanges 读写逐字段相等；`start > end` / **`start == end`（零长度，两侧行为不一故拒收）** / 负数 / 非整数拒；**坏 ranges + 正文 → text/attachments 保留、tokenRanges === undefined**；**字段存在但非法 → 结果对象同样无 tokenRanges 自有键**；**serialize 过滤非法条目（丢该条其余照写、全空写 `[]`、不抛错）**；旧 JSON（无字段）parse 后结果对象**无 tokenRanges 自有键**；**旧代码读新 JSON（parse 自构造对象路径）→ text 保留、ranges 静默丢弃（回滚兼容）** → Step 1
- T-CA2 — blocking: yes — controller 初值：草稿带 ranges → 直接使用（探针断言 `scanTokensToRanges` 不被调用）；undefined → 兜底扫描一次且首次 persistDraft 写回带值；**水化 `{text:'手输$foo', tokenRanges:[]}` → 经 project/applyComposerStatusAttachmentsReplace 状态条后 tokenRanges 仍为 `[]`，不触发扫描** → Step 1
- T-CA3 — blocking: yes — 切会话 `syncFromDraft` 同 T-CA2 两分支；半截场景：草稿文本 `$技能尾追` + ranges `[{0,3}]` → 水化后 tokenRanges 仍 `[{0,3}]`（尾追不升格）；**同文本不同 ranges 切会话**（A `[{0,3}]` vs B `[]`，文本相同）→ ranges 各归各位不串台 → Step 1
- T-CA4 — blocking: yes — 落库咽喉点：插入/打字/删除后 persistDraft 的 payload 含正确 ranges；**发送清空 → DB 置 NULL**（下次水化 undefined + 空文本，扫描必空）→ Step 1
- T-CA5 — blocking: yes — 既有贴边不并入用例（`native-composer.test.tsx:353-362`）保持绿；新增粘贴贴边变体 → Step 1
- T-CA6 — blocking: yes — 水化两条真实链：首帧 `defaultValue` 按持久化 ranges 合成 markdown（`$技能尾追` + `[{0,3}]` → 链接只包 `$技能`）；**运行期水化 setText 三参合成与首帧一致**（不等 prop 收敛；**跳 remap 直写**：测试先种子一个与传入 ranges 不同的 `confirmedRangesRef` 基线，断言合成用的是传入值而非 remap 值）；同内容不二次下发（复用 `native-composer.test.tsx:413` 既有断言手法）；**面板集成测试断言（`apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx`，`mockComposerSetText`）：带 ranges 草稿水化 → 三参且第三参为持久化值；同步把 `:981` 改三参断言（无 ranges 草稿 → 第三参 `[]`）——controller spy 注入自己的 spy 绕过面板箭头，抓不到丢参缺陷，不得替代** → Step 3
- T-CA7 — blocking: yes — desktop 写回：未编辑（composerText === 水化文本）→ payload 含原样 tokenRanges；**已编辑 → payload 无 tokenRanges 字段**；**payload 组装抽纯函数再测（照 `rollback-composer.ts` 先例），不挂整个 ConversationPanel** → Step 4
- T-CA8 — blocking: yes — 带外两路径：全屏回填 remap 保真（`apps/mobile/__tests__/composer-fullscreen.test.tsx` 既有链扩用例）；**旧草稿 tokenRanges undefined → 回填 payload 无 tokenRanges 字段（非 `[]`）**；undo_send 恢复写 undefined（`apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts` 既有链扩用例）→ Step 1
- T-CA9 — blocking: yes — 发送链区间感知（D9 掩码二段式；**落点：mobile 发送链测试**——executeRun/controller 级或面板集成，覆盖真实运输链而非纯函数）：①草稿 `$agent-config$节拍成章` + ranges `[{0,13},{13,18}]` 发送 → **两颗技能均挂载**；②`@docs/a.md$写作` + 对应区间 → 附件只有 `/docs/a.md` + 技能 `写作`（无污染路径）；③无区间（undefined/`[]`）草稿发送 → 结果与现状全量扫描逐项一致（回归锁：手输带空格 token 照常识别、贴字 `$` 维持不识别）；④草稿首带空白 + 区间 → trimStart 换算不错位 → Step 8
- T-CA10 — blocking: yes — remap 删除锚（D11；**落点：`native-composer.test.tsx` 既有 describe `:537`**）：删左颗幸存 `('$A$B','$B',[{0,2},{2,4}], prevCursor=2) → [{0,2}]`；删普通尾字符不摘 `('$Ax','$A',[{0,2}], prevCursor=3) → [{0,2}]`；删右颗 `('$A$B','$A', prevCursor=4) → [{0,2}]`；前向删除（D 空）走现状分支 `('$A$B','$A', 2, 2) → [{0,2}]`；无 prevCursor 现状锁；守卫回退变体；**controller 级：`$A$B` 删左颗 → tokenRanges 幸存 + persistDraft payload 同值** → Step 8
- T-CA11 — blocking: yes — 组件接线（CR-R2-05；**落点：`native-composer.test.tsx`**，`lastRanges()` 助手 `:88`）：打字路径 selection 下沉 prevCursor、无选区回退现状、`ref.setText(next, cursor)` 后 `lastRanges()` 反映锚定/直写结果，防光标透传回退 → Step 8

Kotlin 单测（**blocking**；`android/build.gradle:291-292` 已有 junit 4.13.2 + robolectric 4.14.1，`FormattingStore`/`RangeEditAdjustment` 纯 Kotlin 不依赖 View，与既有 `HarnessSmokeTest.kt` 同目录。**运行：`cd apps/mobile/android && gradlew.bat :react-native-enriched-markdown:testDebugUnitTest`（项目名按 autolinking.json）；测试文件只存在于补丁内，重生成补丁后必须 grep 类名核对（见变更点 #9）**）：

- KT-CA1 — blocking: yes — `RangeEditAdjustmentTest`：D2 protected 分支表逐行矩阵（左插右移/右插不动/内插整删/相交删整删/左右侧平移；`growsAtStartOnInsert=false` 锁定）→ Step 2
- KT-CA2 — blocking: yes — `FormattingStoreTest`：相邻 TOKEN 不融合（`addRange` 无合并路径 + `coalesce` 跳过）；`adjustForEdit` 替换不继承 TOKEN；调整后不产生半截 range；**selectionAdjustedForAtomicLinks 扩 TOKEN（选区部分相交→扩整颗 / 光标内部→推 end / 完全在外→返回 null）** → Step 2
- KT-CA3 — blocking: yes — `setValueFromJS` 的 LINK→TOKEN 映射抽 internal 纯函数：`nmskill://`/`nmtoken://` 链接 → TOKEN 且 url 置 null；普通链接保持 LINK；多 link 顺序不变 → Step 3
- 说明：InputConnectionWrapper 的组合态门控（`isComposing`）与删除入口拦截不做 wrapper 级单测（强依赖 EditText 运行态，Robolectric 保真度不足），由真机 S1/S7/S10 覆盖；区间语义已由 KT-CA1/CA2 锁定。**残留风险**：S7 属 P2——若 P2 不触发，`isComposing` 门控的「组合期不误删」在 P1 无专项真机场景（S10 为非组合态退格），由 S1 中文尾追路径间接覆盖；P2 触发时 S7 补齐。

真机场景清单（S = device scenario，manual_user）：

- S1 Picker 插入胶囊后直接尾追中文/英文 → 不并入（P1 门；**若中文尾追仍被并入 → P2 升 blocking**）
- S2 胶囊后空格→删空格→尾追 → 不并入
- S3 胶囊中间点击/长按选区 → 光标吸附/选区扩整；选区跨胶囊删除 → 整颗删
- S4 前向删除：`adb shell input keyevent 112`（KEYCODE_FORWARD_DEL）注入，不依赖外接键盘
- S5 切会话/杀进程回来 → 胶囊边界与离开时一致；native setTokenRanges 幂等（S5 复核）
- S6 旧版本草稿升级（构造无 tokenRanges 字段的草稿 JSON）→ 胶囊照常渲染（兜底扫描）
- S7 中文 IME 组合态贴胶囊提交（拼音组合中光标位置/提交后归属）→ P2 门
- S8 胶囊相邻粘贴多行文本 → 粘贴内容落胶囊外、不误转 markdown（既有粘贴链回归）
- S9 **相邻两颗胶囊：手动在两颗之间键入空格后删除该空格（chip 零空格后两颗默认贴邻无字符，本场景仅在用户手动键入分隔符时成立）** → 两颗各自独立不融合（D2 双处合并抑制的真机验证）
- S10 **插入落文后立即单次退格** → 期望形态（**真机取证已定 2026-10-20，NMTrace 插桩**；chip 模型 D8 后统一为）：**插入恒无空格缓冲、光标贴胶囊右缘 → 首次退格即整颗原子删除**；主判据不变「一次物理退格最多删一颗胶囊且无多删字符」。取证记录（荣耀 EBG-AN00，插桩 debug 包）：① HwIME 软键盘退格走 `sendKeyEvent(DEL)` 入口，miss 时 super 级联触发 `onKeyDown`（同键双检查、单次删除）；**原子命中时 return true 短路级联，无双删**；② `adb shell input keyevent` 注入路径只走 `onKeyDown`；③ 全程未观测到 `deleteSurroundingText` / 空 `commitText` 删除路径（D3 新增入口保留为其他 IME 的覆盖）；④ 插入落文 `setTokenRanges [(0,13)] textLen=13 sel=13`——「无空格+贴边」即 B2 观测的唯一根因（r3 时代「有既有文本时插入带尾空格缓冲」的两种形态表述已被 D8 推翻，以本条统一形态为准）
- S11 **chip 贴邻发送与相邻删除**（Step 8 真机抽样）：连插两颗（贴邻）→ 发送 → 两颗技能均生效（消息回放/日志确认）；相邻态退格删左颗 → 幸存右颗胶囊样式与持久化区间保留（D11）

## 兼容性或迁移说明

- **草稿迁移**：JSON optional 字段，无 DDL；旧草稿 undefined → 兜底扫描一次，写回固化，升级无感（旧行为残留面仅限「从未再次打开过的旧草稿」与 undo_send 恢复）。
- **回滚（新版本草稿被旧代码读）**：`parseComposerDraftJson` 自构造 `{text, attachments: kept}` 喂 schema（`:82`），未知字段到不了 `.strict()`——**静默丢弃 tokenRanges、正文保留**（zod 4 `.strict()` 对未知键是 reject，但该路径根本不把未知键喂进去）；后果仅是「旧版本下一次写回永久丢 ranges」，无文本丢失风险。
- **desktop**：读侧忽略新字段；写回仅未编辑时透传（D6），编辑后省略字段。
- **LINK 选区删除保持上游**：D3 的选区删除扩整只对 TOKEN；LINK 维持上游折叠光标语义（改动面最小，现网未观测到问题）。
- **发送管线最小改动**：core 扫描正则与发送门闩不动；chip 贴邻明文（D8）由发送链掩码二段式闭环（D9：区间扫描 + 掩码全量扫描 + existing=区间合并；core 侧 excludedScanRanges 掩码），手输 token 兼容。
- **转录渲染不动**：`RefTokenText` 是显示链路，与输入框 stores 无关；chip 贴邻（`$A$B`）在转录高亮层第二颗可能不高亮（同款边界正则）——显示层已知限制⑥，不影发送与附件（D9 已闭环挂载），后续迭代评估。
- **手输行为不变**：纯文本；发送扫描照常把 `$技能名` 变 skillAttach。
- **linkVariants 说明**：D4 后 `^nmskill:`/`^nmtoken:` 两个变体对胶囊不再生效（TOKEN 样式由 `TokenStyleHandler` 取 `style.linkColor`/`linkBackgroundColor`/`linkBorderRadius` 等基础键，`TokenStyleHandler.kt:24-45`）——**胶囊视觉不变**；变体键退化为冗余配置，`markdownStyle.link` 基础键**禁止删除**（删则胶囊掉样式）；既有测试 `native-composer.test.tsx:308-331` 锁着变体键，清理时同步改。
- **已知限制披露**：①全屏 CodeMirror（`PromptEditorScreen`）与旧 webview composer 的高亮仍按 `COMPOSER_TOKEN_RE` 全扫，「尾追并入高亮」不在本迭代闭合范围；②undo_send 恢复允许兜底扫描一次；③组合态（IME）替换（S7 路径）依赖 D5（P2）；非组合态的选区跨胶囊输入在 P1 经选区吸附（D2）已闭合；④全屏 CodeMirror 内新打的 `$x` 按正则高亮显示为胶囊，但 D1 remap 不升格确认胶囊，回到内联输入框后是纯文本（视觉与确认态不一致，与目标 5「手输不成胶囊」一致）；⑤desktop 编辑后写回省略 tokenRanges → 移动端下次水化兜底扫描一次（行为同现状）；⑥转录渲染对贴邻 token（`$A$B`）第二颗不高亮（显示层正则边界；发送/附件已由 D9 闭环）；⑦旧草稿中的历史空格分隔不强制迁移（用户手删即可，删后不粘连——原生盒内 gap 承担视觉分隔）。
- **上游对照**：`.reference/enriched-markdown` 仅供 rebase 参考；本迭代全部 native 改动落在补丁内，升级库版本须重生成补丁（既有 D10 流程，composer-native spec）。

## 风险与回滚方案

| 风险 | 应对 |
|------|------|
| 补丁面扩大 → 上游 1.1.x rebase 成本上升 | native 改动收敛在 4 个 Kotlin 文件（FormattingStore / RangeEditAdjustment / EnrichedMarkdownTextInputView / InputConnectionWrapper）；InputParser 不改——LINK→TOKEN 映射收敛在 setValueFromJS（D4）；升级前重生成补丁 |
| protected 区间策略与 IME 组合态冲突（抢 composing 区间） | P1 不做 D5 的「非删除语义的选区规范化」（commitText/setComposingText 提交前的光标/选区调整与组合期修复）——**D3 的空 commitText 删除拦截不在此列，P1 照常改 InputConnectionWrapper**（isComposing 门控）；RangeEditAdjustment 层只调区间不改文本，组合态安全（phase 抑制 + lastProcessedText 早退先例）；S1 真机门兜底 |
| 光标吸附影响点击手感（点胶囊中间光标跳尾） | 与 LINK 既有上游语义一致；S3 真机验收，不可接受再调吸附策略（如点击落 start） |
| desktop 写回透传遗漏/错位 → 跨端丢或错 ranges | D6 编辑检测 + T-CA7 两分支锁死 |
| undefined 与 `[]` 语义混用导致兜底扫描复活 | T-CA1/T-CA2 锁死「undefined ≠ 空数组」；schema 不设 default；parse 缺失不写自有键 |
| 缓存投影链再丢字段（未来新增 transform） | T-CA2 的 apply 断言守卫；新增字段时同步核对 `applyComposerStatusAttachmentsReplace` |
| 水化 LINK→TOKEN 后序列化形态变化 | composer 已禁 Copy-as-Markdown；MarkdownSerializer TOKEN 输出明文与 LINK displayText 一致 |
| 旧草稿兜底扫描升格半截 token（旧行为残留） | 仅 undefined 草稿一次；S6 验收；接受为已知限制 |
| 回滚 | JS 层与补丁层独立可回退；草稿新字段向后兼容（旧代码静默丢弃，正文保留） |
| chip 贴邻明文 → core 全量扫描丢技能/污染 @ 路径 | D9 掩码二段式（区间扫描 + 等长空白掩码全量扫描 + existing=区间合并；core excludedScanRanges 掩码）；T-CA9 四断言锁死；S11 真机抽样 |
| 运输链静默断链（options 加字段但转发白名单/中间类型漏改） | 白名单 `session-stream-unit-manager.service.ts:1213-1218` 与 `agent-run.service.ts:69-76` 钉入变更点 #11；T-CA9 走真实链路（controller/面板级）而非纯函数 |

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
- P1-8：D3 五入口统一 helper（空 commitText + deleteSurroundingText 一般参数 + FORWARD_DEL）（R2 修正为六入口，R3 补 code-points 变体与并发收敛为七入口）。
- P1-9：Kotlin 单测升 blocking（KT-CA1/KT-CA2，junit+robolectric 已在）；S4 改 adb keyevent 112。
- P2-1：实现注改写（parse 自构造对象 → 静默丢字段正文保留；回滚后果=下次写回丢 ranges）；T-CA1 回滚用例。
- P2-2：兼容性节 linkVariants/TokenStyleHandler 说明。
- P2-3：T-CA6 改 JS 可测面（native 幂等归 KT 单测/S5）。
- P2-4：parse 缺失不写自有键；T-CA1 断言。
- P2-5：LINK→TOKEN 映射收敛在 setValueFromJS（不动 InputParser 本体，pasteMarkdown/测量链无感）。
- P2-6：`ComposerDraftTokenRange` 类型由 core 导出，storage/token-ranges 复用。
- P2-7：语义总表选区跨胶囊「输入」标 (D5/P2)。
- 证据锚点修正：`run-agent-turn.ts:543` → 扫描 `:663-667` / append `:724-731`；`token-ranges.ts` 类型 `:29-33`（`:12-15` 为模块注释）；右边界 `:93-94`（循环 `:92-99`）；`InputConnectionWrapper.kt` 类注释 `:8-28`、`setComposingText` `:52-77`。

## R2 修订记录（doc-fix 闭合清单，r2 → r3）

- P0-1（cca/P0-1）：风险表两行改写——P1 不动的是 D5「非删除语义的选区规范化」，D3 空 commitText 删除拦截照常改 InputConnectionWrapper；文件清单 5→4（InputParser 移出，映射收敛 setValueFromJS）。
- P0-2（cca/P0-2）：D4 扩为「三跳全链」——`ChatConversationPanel.tsx:152-157` 回调与 options.`setComposerText` 类型同步三参（TS 少参兼容会静默丢第三参）；变更点 #4 纳入面板文件；T-CA6 改面板集成测试断言（controller spy 抓不到面板箭头丢参）+ `:981` 三参化。
- P1-1（cca/P1-1）：D3 新增组合态信号（P1 引入最小 `isComposing`），空 commitText 拦截加 `!isComposing` 门；D5 改为复用该信号——修复「P1 依赖 P2 才引入的信号」阶段倒置。
- P2-1（cca/P2-1）：变更点 #1 补 `packages/core/src/public/chat.ts` type 导出桶（漏则 Step 1 编译失败）。
- P2-2（cca/P2-2）：D4 补 commitExternalText 收 ranges 语义（跳 remap、直写 confirmedRangesRef、prop 收敛短路、state 与第三参同份数组、null 基线切确认制）。
- P2-3（cca/P2-3）：D1 带外路径补 undefined 口径（回填写 undefined 不预处理）；`writeChatComposerDraft` 定为第 4 参（现有三参调用零改动）。
- P2-4（cca/P2-4）：D3 空 commitText 删除窗/super 语义写死；入口计数改「既有三入口（补 sendKeyEvent KEYCODE_DEL）+ 新增三入口 = 六入口」（R3 补 code-points 变体与并发收敛后为七入口）；补并集口径（删除窗 ∪ 相交原子区间、光标落删除区起点）；新增 S10（期望先删尾空格；e2e 观测整删根因待取证，见实现注）。
- P2-5（cca/P2-5）：测试策略新增 T-CA8（带外两路径，挂既有测试文件扩用例）；T-CA7 补纯函数化测试形态。
- P2-6（cca/P2-6）：D2 表替换行改「替换与删除共用相交判据；JS 同样摘除，native 兜底不经 JS 的路径」。
- P2-7（cca/P2-7）：refine 收紧 `start < end`；serialize 过滤非法不抛错；parse 缺失或非法均不写自有键；T-CA1 加三用例。
- P2-8（cca/P2-8）：新增 KT-CA3（setValueFromJS 映射纯函数）；KT-CA2 扩选区吸附三断言（e2e 佐证：D4 后吸附由 TOKEN 接管，D2 纳入 TOKEN 为防回归必要条件）。
- P2-9（cca/P2-9）：补 Kotlin 运行命令（`gradlew.bat :react-native-enriched-markdown:testDebugUnitTest`）与补丁 grep 测试类名核对（防 clean install 后测试静默消失）。
- P2-10（cca/P2-10）：D3 选区删除扩整收窄为仅 TOKEN，LINK 保持上游（兼容性节披露）。
- P2-11（cca/P2-11）：D2 protected 入口定为 `adjustForEdit` 加 `isProtected: (T) -> Boolean` 参数（FormattingStore 传 `type == TOKEN` 判定）。（R3 修正：本行原误写 adjustRangeForEdit，真实函数名见 `RangeEditAdjustment.kt:45`。）
- 佐证与流程：需求来源补 e2e 真机佐证三条（水化吸收复现 / 单退格整删待取证 / 光标吸附 D4→D2 联动）；测试策略补运行命令（`npm test -w`，jest 直连 dist 的坑）；syncFromDraft 兜底写回点定为 undefined 分支内一次 persistDraft；D5 补「依赖 D2 同批」句；Step 3 注明依赖 Step 2。

## R3 修订记录（第 3/4 轮审查增量，doc-fix 闭合清单）

- P1-1：S10 进验收门——D7 P1 清单与 Step 5 改「S1-S6、S8-S10」，主判据「一次物理退格最多删一颗胶囊且无多删字符」（取证无关的稳定判据），期望形态按取证回填。
- P1-2：Step 1 测试清单补 T-CA8（与 T-CA8 自标 Step 1 对齐）。
- P1-3 + P1-a：D3 新增「同一按键并发收敛」——`suppressNextDelete` 仅在 `isBatchEdit == true` 时置位、`endBatchEdit` 无条件清（batch 域内抑制，不吞独立退格）；抑制时跳过重复 dispatch Backspace；标志放 view 层共享；判据限定同键并发场景（词删/选区跨多颗仍按并集）；取证回退路径（拆 batch → clear-on-consume + 快照相交；单信号 → 简化）写明。
- P2 汇总：函数名修正（`adjustForEdit`、`NativeChatComposerInstance.setText`——库侧 instance 无 setText）；七入口三处一致（补 `deleteSurroundingTextInCodePoints` 第四新增入口）；`setComposingText` 空串清 `isComposing`；D4 补 `textChanged || rangesChanged` 命令式下发条件与 instance null 兜底；已知限制③改写 + 补④⑤；S10 同步对象改 D3；wrapper 单测豁免说明 + 组合期残留风险注；Q2 防御性校验声明（不做长度校验，消费侧防御）；`addRange` 钉 `allowMerge` 参数形态；remap 落点钉 ChatTabScreen 退出回填处；空会话兜底写回跳过；R1/R2 历史记录加括注。

## R4 修订记录（dev-loop 真机轮 cr-func 复检 fold，r3 → r4）

背景：D1-D4/D6 实现落地 + 真机 S1-S10 用户自测通过后，真机反馈轮追加四 commit（`154b98976` 光标锚 / `f0c808527` 查询守卫 / `4e5240bb4` 盒内 gap / `06b00ba8a` chip 零空格 + TokenBackgroundSpan——即 D8 已落事实），cr-func 复检 **func-ready: no**（P1×2 / P2×1 / P3×2，复跑 109 jest + 45 Kotlin + tsc 全绿、补丁无插桩残留、四 commit 裁定合规），must-fix fold 如下：

- CR-R2-01（P1）→ **D9 发送链区间感知** + 变更点 #11 + T-CA9 + S11 + 设计目标 4 改「最小改动」+ 兼容性同步 + 风险表增行。
- CR-R2-02（P1）→ **D10 全屏统一 chip**（决策：不加分隔符参数，单一口径）+ 变更点 #12 + prompt-editor 三断言零空格 + 非目标全屏表述修订。
- CR-R2-03（P2）→ **D11 remap 删除锚**（D=编辑前后光标差区间、公共字符判摘除/平移、无光标回退现状）+ 变更点 #13 + T-CA10 + 语义总表「相邻删除」行补幸存保留。
- CR-R2-04（P3）→ D10 注释同步清单（composer-token-insert 头注释 / PromptEditorScreen:152 / patch RoundedBackgroundSpan KDoc 补 gap / controller JSDoc 归位）。
- CR-R2-05（P3）→ T-CA11 组件接线断言（`ref.setText` 光标透传防回退）。
- **D8 落地事实入核心决策**（用户 2026-10-20 拍板口径 + 四 commit + TokenBackgroundSpan 根因记录 + r3 冲突描述以 D8 为准）；S10 期望形态按 chip 统一改写（取证历史保留）；语义总表三行同步；已知限制补⑥⑦；Step 8（phase-r2-consistency，blocking）入实现步骤。
- cr-func 非阻塞观察入档：chip 贴尾后手打孤立 `$`（`$A$$B`）不识别为查询属边界交互，不闭合（手输语义与目标 5 一致）。

## R5 修订记录（spec-check 第 1 轮 No-Go 后 doc-fix，r4 → r5）

第 1 轮 judge（readonly，对照代码库逐锚点核实）判 r4 No-Go；全部 fold（并行 impl-d11 的实际实现已满足 P1-1 大半，本记录同时完成规格对齐）：

- **P0-1（D9 运输链）**：钉死三处同步补——`RunAgentTurnOptions`（`run-agent-turn.ts:251-287`）+ **转发白名单 `session-stream-unit-manager.service.ts:1213-1218`**（只加 interface 会被静默丢弃）+ `agent-run.service.ts:69-76`；**trim 偏移**：mobile 用未 trim `textRef.current` 扫描（`:628` `text.trim()` / core `:543` trimmed 扫描），core 侧 excludedScanRanges 需减 trimStart 换算；T-CA9 补④trim 用例。
- **P0-2（D9 掩码）**：合并去重救不了 @ 污染（去重 key `path:/docs/a.md$写作` vs `path:/docs/a.md` 不同）——改**掩码二段式**：确认区间替换等长空白后全量扫（污染源头消失）+ `mergeAttachmentsByPath(rangeResults, fullScanResults)`（**existing=区间**，函数已有优先）；兼容性/风险表措辞同步。
- **P1-1（D11 规格对齐实现）**：签名钉 `(prev, next, ranges, nextCursor?, prevCursor?)`；D 由候选优先级反推（显式→退格→前删→歧义先退后前）+ **纯删除一致性守卫**；分类改「相交摘除 / **左不动** / 右平移 / 缺光标现状分支」；补前向删除（D 空）用例；已落 `aaa7fa30b`。
- **P1-2（D11 controller 跳）**：`selectionRef` 镜像已在组件新建（原假设的 ref 此前不存在）；**controller `advanceTokenRanges` 补 prevCursor** 入变更点 #13（否则 prop 收敛把幸存胶囊抹掉、S11 持久化验收必炸）；T-CA10 补 controller 级断言；S11 断言 DB tokenRanges。
- **P1-3（D10 全屏守卫）**：零空格使全屏「连插互替换」回归（全屏无 `queryWithinConfirmedRange`，`findActiveAtQuery` 把整颗 token 当活跃查询、`PromptEditorScreen.tsx:141-150` 整颗替换）——守卫抽共享纯函数复用 + 路由带入 tokenRanges + 连插两颗用例。
- **P2**：T-CA9/10/11 测试落点钉死（T-CA9 走 controller/面板真实链路；T-CA10/11 落 `native-composer.test.tsx:537` 既有 describe）；S9 措辞改「手动键入空格后删除」（chip 后默认贴邻无字符）；合并方向钉 existing=区间；兼容性/风险表掩码措辞。
- **P3**：D1 锚点括注（`ChatTabScreen.tsx` 回填实际在 `:181-192`，spec 原 `:172-174` 漂移）；`PromptEditorScreen` 路径补目录 `apps/mobile/src/screens/stack/`；D11 守卫定义钉「prevCursor 整数且 ∈[0, prev.length]、纯删除一致性、D 边界自洽，否则回退」（与 D8 插入锚 plausibility 同款）。

## R6 修订记录（cr-func step-8 P3 收口，r5 → r6）

dev-loop Step 8 终检（cr-func func-ready 条件闭合 + S11 模拟器四连过）后，P3 三项以 fix-p3 节点收口（87aa6ac5a）：

- **P3-1 全屏打字路径删除锚**：`PromptEditorScreen.advanceConfirmedRanges` 增 prevCursor；CodeMirror 选区上报先于变更上发（updateListener 同步 vs change 经 rAF 合帧），采用「上一拍」选区右缘快照；全屏 `$A$B` 删左颗幸存用例（读回复用全屏守卫：删后文末插 `$C` 应得 `$B$C`）。
- **P3-2 controller 水化对称**：`syncFromDraft` 真正下发 setComposerText 的分支把 `prevCursorRef` 落 `draft.text.length`（与组件 `commitExternalText` 对称；状态条空广播不推进）；切会话后不模拟选区直接原子退格幸存用例。
- **P3-4 T-CA9③ 单链路断言 + 直出口径**：无区间草稿 controller 以 trim 后正文全量扫描直出 `attachments`（existing 位），core 再扫同键去重幂等——附件集合/顺序与旧口径逐项一致，断言从分层覆盖升级为单链路。
- **措辞修正**：D11「D 空 → 回退现状」改为「D 空候选跳过、按光标与差分编辑区相对位置反推非空 D，反推不出才回退」（以 `resolveDeletionSpan` 实现为准，`('$A$B','$B', undefined, 0)` 优于原措辞）；T-CA10 前向删除用例实测形态 `(undefined, 0)` 括注；D9 运输链 `:628`/`:543` 行号漂移括注（`:684`/`:684-689`，以函数名定位）。
- **判别力**：fix-p3 探针——临时回退两实现文件 → 3 failed（全屏 `$B$C`→`$C`、③ attachments 空、水化对称 `[]`），恢复全绿（2 suites/64 + 4 suites/75，tsc 0）。
