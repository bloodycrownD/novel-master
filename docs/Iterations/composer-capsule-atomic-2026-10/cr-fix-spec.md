# CR Fix Spec: composer-capsule-atomic r2 → r3（R2 复核 + review-full 两轮收敛）

## 元信息

- repo_path: `D:\worktree\cca`（feat/composer-capsule-atomic）
- base_sha: c691c8815（main HEAD，代码锚点基线）
- head_sha: 5243f717f（spec r2 入分支；无实现代码 diff——本轮评审对象是 **spec 文档本身的可实施性**）
- prd_path: 未提供（用户口述 2026-10-19，已内化于 spec「需求来源」节）
- spec_path: `docs/Iterations/composer-capsule-atomic-2026-10/spec.md`（r2）
- review_round: 2（cr 循环内；round 1 = R2 九条入册，round 2 = review-full-1 复查新增 N1-N11 已并入）
- dag_version: 3
- 状态: **已执行** —— 14 条已全部并入 spec r3（2026-10-19 doc-fix，见 spec 文末「R2 修订记录」）；本文件留作审计轨迹，后续以 spec-check-loop 收敛 r3 至 execute-ready

**下游执行形态**：本 fix-spec 的每条改法 = **对 spec.md 的文档修订**（r2 → r3），不是改代码；r3 定稿后才进入 code-dev-loop 实施。

**e2e 佐证（2026-10-19 真机，荣耀 EBG-AN00，装机 debug 包，与本 spec 代码锚点同源）**：

- E2E-A【水化吸收复现，D1 前提实证】：贴胶囊右缘打 `z`（活态不吸收，胶囊右缘像素 393 不动）→ force-stop 冷启水化 → 胶囊右缘 393→416，`z` 被正则引导吞入。确证 spec「仍会吞的路径」第 1 条与 D1 的必要性。
- E2E-B【单退格整删含尾随空格——观测为实、根因待取证】：插入落文后**首次**退格 = 整颗胶囊+尾空格一键全删（两次独立观测）。**注意**：review-full-1 按现行代码推不出该行为（`composer-token-insert.ts:42-47` 登记区间不含尾空格、cursor 在空格后，`deleteLinkBeforeCursor` 检查 cursor-1=空格不应命中）——根因存疑，已降级为 Q1 待取证，r3 的 S10 期望行为按取证结论定（见 cca/P2-4 与 Open questions）。
- E2E-C【光标吸附现状由 LINK 承担，D4→D2 联动】：点胶囊中部光标被吸附到胶囊尾（`selectionAdjustedForAtomicLinks` 的 LINK 语义，`FormattingStore.kt:41-54`）。现状胶囊经 markdown 合成走 LINK 渲染；**D4 把 `nmskill://`/`nmtoken://` 映射为 TOKEN 后，D2 的「selectionAdjustedForAtomicLinks 纳入 TOKEN」从优化项变为防回归必要条件**——结论已落 K 节（r3 的 D4/Step 3 须写明依赖 D2/Step 2）。

## Must-fix（按 P0 → P1 → P2）

### cca/P0-1 [P0] 风险表与 D3 正面矛盾：一处说 P1 不动 InputConnectionWrapper，D3 却要求 P1 改它三处
- 维度：A（需求符合性/自洽）
- 文件：`docs/Iterations/composer-capsule-atomic-2026-10/spec.md`（:206-207 风险表；:87-94 D3；:148 变更点 #9；:154 Step 2）
- 问题：spec:206 写「InputConnectionWrapper 不动于 P1」、:207 写「P1 不动 InputConnectionWrapper（D5 属 P2）」；但 D3（P1，Step 2/变更点 #9）新增空 `commitText`、`deleteSurroundingText` 一般参数、`KEYCODE_FORWARD_DEL` 三个入口，全部落在 `InputConnectionWrapper.kt`。照风险表实施会直接漏掉 D3 三入口。
- 改法（r3 文档修订）：
  1. :206-207 两处改为「P1 不做 D5 的『**非删除语义的选区规范化**』（`commitText`/`setComposingText` 提交前的光标/选区调整与组合期修复）；**D3 的空 `commitText` 删除拦截不在此列**，P1 照常改 InputConnectionWrapper」（措辞须与 D3/D5 对读无歧义——空 commitText 同样是 commitText 的 pre-super 拦截，但属删除语义）；
  2. :206 的「InputParser 经 setValueFromJS」改为「InputParser 不改，LINK→TOKEN 映射收敛在 setValueFromJS（D4）」；
  3. :206 文件清单按 P1 实际触达改为 4 个：FormattingStore / RangeEditAdjustment / EnrichedMarkdownTextInputView / InputConnectionWrapper（InputParser 移出清单，改在括注说明；review-full-1 已核对 `pasteMarkdown:881`、`InputMeasurementStore.kt:108` 只吃 plainText）。
- 验收/测试：通读 r3 全文 `InputConnectionWrapper` 出现处（风险表、D3、D5、变更点 #9、Step 2）口径一致，无「P1 不动」残留表述；D3 入口清单与 Step 2 归属一致。
- 来源：R2 review（round 1）P0-1；review-full-1 N10 措辞收紧

### cca/P0-2 [P0] D4 的 ranges 通道在变更点清单断最后一跳：ChatConversationPanel 两参回调会静默丢掉第三参
- 维度：B（正确性）/ C-orch（链路完整性）
- 文件：spec:96-99（D4）、:142-143（变更点 #3/#4）；代码锚点 `apps/mobile/src/components/chat/useChatComposerController.ts:131`（options.setComposerText 两参）、`apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:152-157`（两参箭头回调 → `setText(text, cursor)`）、`apps/mobile/src/components/chat/NativeChatComposer.tsx:196`（setText 接口两参）、`:437-446`（useImperativeHandle）
- 问题：D4 要求水化链 `setText(text, undefined, ranges)`，但 ranges 从 controller 到组件要经过 `setComposerText` 选项 → `ChatConversationPanel` 的**两参**回调 → `composerRef.current?.setText(text, cursor)`。变更点 #3 只覆盖 controller、#4 只覆盖 NativeChatComposer.tsx，**没有 ChatConversationPanel.tsx**；TypeScript 允许少参函数赋多参类型，编译不报错、运行时第三参被丢弃——D4 在真实链路上等于没生效，组件级 T-CA6 仍绿。review-full-1 已核：全链仅此一条路径（ChatTabProvider 只有注释），无其他中间层。
- 改法（r3 文档修订）：
  1. 变更点 #4 追加 `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`：回调签名扩为三参并透传给 `composerRef.current?.setText(text, cursor, ranges)`；
  2. 变更点 #3 明写「options.`setComposerText` 类型同步扩为 `(text, cursor?, ranges?) => void`」；
  3. T-CA6 的断言点**明写用面板集成测试**（`apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx`，该文件已 mock NativeChatComposer 并暴露 `mockComposerSetText`）：带 ranges 的草稿水化 → `mockComposerSetText` 收到三参且第三参为持久化值；**同步**把该文件 `:981` 的 `toHaveBeenCalledWith('草稿正文', undefined)` 改为三参断言（无 ranges 草稿 → 第三参 `[]`）——D4 生效后此断言必红，不改则 Step 3 卡门。**不得**用 controller 测试的 spy 替代（controller spy 注入的是自己的 spy，绕过面板箭头，抓不到本缺陷）。
- 验收/测试：变更点清单覆盖 `useChatComposerController.ts:131` → `ChatConversationPanel.tsx:152-157` → `NativeChatComposer.setText`（`useImperativeHandle :437-446` 实现体由 #4 覆盖）全链三跳；T-CA6 含面板集成测试断言；面板测试 `:938`（清空）与 controller `:426/:445`（picker）两参断言保持绿（这些路径本就不带 ranges）。
- 来源：R2 review（round 1）P0-2；review-full-1 N1 验收重写（删 controller-spy 替代项、补 :981 三参化）

### cca/P1-1 [P1] D3 的「P1 只处理非组合态」依赖 D5（P2）才引入的信号——阶段边界倒置
- 维度：A（自洽）/ B（正确性）
- 文件：spec:89-94（D3）、:103-107（D5）；代码锚点 `node_modules/react-native-enriched-markdown/android/.../input/editing/InputConnectionWrapper.kt:52-77`（现无组合态标记，`finishComposingText` 未 override）
- 问题：空 `commitText` 拦截要求「仅非组合态触发」，但组合态信号（`finishComposingText` 生命周期）被安排在 D5/P2 才引入；P1 没有这个信号，实施要么忽略约束（中文 IME 组合期误删——恰是 S1/S7 的雷），要么私自发明——阶段边界被倒置。
- 改法（r3 文档修订，D3 写死判定手段二选一）：
  1. **推荐**：wrapper 在 P1 就加最小 `isComposing` 标志（`setComposingText` 非空置 true；`finishComposingText` / `commitText` 清 false），空 `commitText` 仅 `!isComposing` 时走 helper，否则原路径；D5 改写为「复用 P1 已引入的 `isComposing` 信号，扩展修复动作（选区规范化 + `finishComposingText` 后的一次修复）」；
  2. 备选：用 `BaseInputConnection.getComposingSpanStart(editText.text) == -1` 判定组合态（无状态，但每次查询成本与 span 语义依赖平台行为）。
- 验收/测试：r3 的 D3/D5 口径一致（D5 引用的信号在 P1 已存在）；KT-CA1 或新用例锁「isComposing 时空 commitText 不走 helper」（若选方案 1）；S1/S7 场景不互踩。
- 来源：review-full-1 N4

### cca/P2-1 [P2] `ComposerDraftTokenRange` 的公共导出桶未点名，Step 1 的 import 会直接编译失败
- 维度：A（可实施性）
- 文件：spec:49、:140（变更点 #1）；代码锚点 `packages/core/src/public/chat.ts:46-57`、`packages/core/test/package-exports/helpers/export-snapshot.ts:2-6`
- 问题：mobile/storage 与 token-ranges.ts 通过 `@novel-master/core/chat` 导入；变更点 #1 只说在 `composer-draft.schema.ts` 导出类型，未提 `packages/core/src/public/chat.ts` 的 type 导出桶要补一行。
- 改法：变更点 #1 补「`packages/core/src/public/chat.ts` 的 type 导出桶追加 `ComposerDraftTokenRange`（带类型文档注释，中文）」；附注：导出快照 `collectNamedExports` 用 `Object.keys` 只收 runtime 值导出，类型导出不触发快照更新（review-full-1 已核对）；mobile 侧 `pretest` 自动 build core，T-CA1 不受 dist 新旧影响。
- 验收/测试：r3 变更点 #1 含 public/chat.ts 条目；`npm run typecheck -w @novel-master/mobile` 过（与三参签名一并锁）。
- 来源：R2 review（round 1）P2-1；review-full-1 N11 路径修正（快照 helpers 在 packages/core/test 非 apps/mobile/test）

### cca/P2-2 [P2] `commitExternalText` 收到 ranges 时的「跳过 remap + 直写基线」语义未写明
- 维度：A（可实施性）
- 文件：spec:98（D4）；代码锚点 `apps/mobile/src/components/chat/NativeChatComposer.tsx:317-347`（commitExternalText）、`:416-435`（prop 收敛 effect，内容相等短路在 `:421-431`）
- 问题：D4 只说「用其合成 markdown 与首帧 TOKEN 下发」。若实现成「先 remap 再用传入 ranges」或漏更新 `confirmedRangesRef`，会出现旧区间参与合成 / prop 收敛 effect 二次下发（幂等但多余），切会话/长文本时区间错位。
- 改法：D4 补三句——①「`commitExternalText` **收到 ranges 时跳过 `remapTokenRanges`**，直接 `confirmedRangesRef.current = ranges` 后用它合成 markdown 并 `dispatchTokenRanges`（prop 收敛 effect 因内容相等短路，不再二次下发）；未传入 ranges 时保持现行 remap 路径」；②「`syncFromDraft` 同时下发的 state 与 `setText` 第三参必须是同一份数组，防 prop 收敛用旧 state 覆盖」；③（Q5 拍板后）「`confirmedRangesRef === null`（未传 tokenRanges prop 的旧模式）收到 ranges 时切确认制」——现 composer 恒传 prop，暴露面为 0，写死即可。
- 验收/测试：T-CA6 显式断言「跳过 remap」：测试里先种子一个与传入 ranges **不同**的 `confirmedRangesRef` 基线，调带 ranges 的 `setText`，断言合成 markdown 用的是传入值而非 remap 值；「同内容不二次下发」在带 ranges 路径同样成立（复用 `native-composer.test.tsx:413` 手法）。
- 来源：R2 review（round 1）P2-2；review-full-1 验收加强（种子差异化基线）

### cca/P2-3 [P2] 全屏回填的 undefined 口径与 `writeChatComposerDraft` 新参数位置未定
- 维度：A（可实施性）/ H（兼容性）
- 文件：spec:56、:63；代码锚点 `apps/mobile/src/storage/chat-composer-draft.ts:78-104`（现签名 `(sessionId, text, sessions?)`）、`apps/mobile/src/screens/tabs/ChatTabScreen.tsx:173`（三参调用）、`apps/mobile/__tests__/chat-composer-draft.test.ts:173`
- 问题：`prev.tokenRanges === undefined` 时 remap 无输入，spec 未说传 undefined 还是先扫描；新参数若插在前位会破坏现有三参调用与测试。
- 改法：D1 带外路径补明——①「`prev.tokenRanges` 为 undefined → 回填写 `undefined`（允许下一次水化兜底扫描一次），不做扫描预处理」；②「`writeChatComposerDraft` 追加为**第 4 参** `(sessionId, text, sessions?, tokenRanges?)`，现有三参调用与测试零改动」。
- 验收/测试：T-CA8（见 cca/P2-5）**明写覆盖 undefined 分支**：`prev.tokenRanges === undefined` → 落库 payload 无 tokenRanges 字段（非 `[]`）；`chat-composer-draft.test.ts` 既有用例不改动仍绿。
- 来源：R2 review（round 1）P2-3；review-full-1 验收补 undefined 支

### cca/P2-4 [P2] D3 空 `commitText` 的删除窗/super 语义、入口计数与并集语义（含 e2e B2 证据）
- 维度：A（可实施性/自洽）
- 文件：spec:87-94（D3，含 :89「既有两入口」表述）；代码锚点 `node_modules/.../input/editing/InputConnectionWrapper.kt:86-95`（commitText）、`:97-106`（deleteSurroundingText）、`:108-121`（sendKeyEvent KEYCODE_DEL 既有第三入口）、`EnrichedMarkdownTextInputView.kt:1027-1048`（deleteLinkBeforeCursor）
- 问题：①spec:91 只说「先判原子区间再决定走 helper 还是原路径」，未定义判哪个区间、命中后是否调 super（组合态收尾）；②「五入口/既有两入口」计数错——`sendKeyEvent` 的 KEYCODE_DEL（`:112/:116`）是既有第三入口；③删除窗与多颗胶囊部分相交时删「窗口 ∪ 胶囊」还是「只删胶囊」、窗口同时交两颗、扩整后光标落哪——均未定义，不同实现产出不同文本；④**e2e B2 实测（2026-10-19）**：插入落文后首次退格 = 整颗胶囊 + 尾随空格一键全删，与现行代码静态推演不符（根因待取证 Q1），D3 删除窗若不显式定义此 case，实施会各写各的。
- 改法（r3 文档修订）：
  1. D3 空 `commitText` 段补：「有选区用选区；无选区用 `[max(0, sel-1), sel)` 作为删除窗；命中原子区间 → 调 helper 删整颗并**保留原 Backspace 按键事件**、返回 true、不调 super；未命中走原路径；**仅 `!isComposing` 时启用**（信号见 D3 组合态判定，cca/P1-1）」；
  2. 入口计数改为「既有三入口（onKeyDown KEYCODE_DEL / `deleteSurroundingText(1,0)` / sendKeyEvent KEYCODE_DEL）+ 新增三入口（空 commitText / deleteSurroundingText 一般参数 / KEYCODE_FORWARD_DEL）」，:89 与 D3 标题同步；
  3. 补并集语义：「删除区 = 原删除窗 ∪ 所有相交原子区间（多颗各自扩整颗）；删除后光标落删除区起点，前向删除光标不动」；KT-CA1 加多胶囊矩阵用例；
  4. **新增真机场景 S10**：「Picker 插入落文后立即单次退格」——期望行为按 Q1 取证结论拍板（候选 A：首次退格普通删尾空格、贴缘再整删；候选 B：维持整删，则口径写死「范围含尾随空格」并同步 D2 表与 KT-CA1 矩阵）。取证手段（实现期执行）：插入后 log `tokenRanges` 与 cursor 落位；确认退格走 `commitText("")` 还是 `deleteSurroundingText(1,0)`（`adb logcat` + 临时 instrumentation；注意华为隐藏 IME 可能一次按键同时触发两条删除路径——观测到的「一键全删」或由此而来）。
- 验收/测试：D3 段落包含删除窗定义、super 语义、组合态边界、六入口清单、并集定义；S10 入场景清单并标明拍板结果；KT-CA1 含多胶囊用例。
- 来源：R2 review（round 1）P2-4；review-full-1 N5 并集语义；本会话 e2e B2（根因降级 Q1）

### cca/P2-5 [P2] 带外两路径与 T-CA7 缺专门断言/测试形态未定
- 维度：G（测试）
- 文件：spec:165-171（T-CA1~T-CA7）；代码锚点 `apps/mobile/__tests__/use-chat-composer-controller.test.tsx:341-355`、`apps/mobile/__tests__/composer-fullscreen.test.tsx:450`（全屏链既有测试）、`apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`（undo 链既有测试）、`apps/desktop`（现有为纯逻辑 node:test 与少量 TestRenderer）
- 问题：T-CA1~T-CA7 无全屏 remap 与 undo undefined 用例；T-CA7 要求 desktop 写回两分支，但 desktop 测 ConversationPanel 大组件挂载成本高，spec 未给测试形态。
- 改法：①新增 **T-CA8**（带外两路径：全屏回填 remap 保真 / `prev.tokenRanges===undefined` → 写 undefined / undo_send 写 undefined），优先挂在既有测试文件上扩用例（`composer-fullscreen.test.tsx` / `use-chat-tab-message-actions-rollback.test.ts`），不新开大文件；②D6 明确「写回 payload 组装抽成纯函数（照 `rollback-composer.ts` 先例）再测」，避免挂整个面板。
- 验收/测试：r3 测试策略含 T-CA8（含 undefined 支）与纯函数化口径。
- 来源：R2 review（round 1）P2-5；review-full-1 N11 路径修正（controller 测试在 `apps/mobile/__tests__/` 非 `src/components/chat/__tests__/`）+ 复用既有链点名

### cca/P2-6 [P2] D2 分支表「替换类 JS 侧无对应」表述不准确
- 维度：A（准确性）
- 文件：spec:80（D2 表第 4 行）；代码锚点 `apps/mobile/src/components/chat/native-composer/token-ranges.ts:88-99`
- 问题：JS `remapTokenRanges` 对替换同样按 diff 区处理——相交即摘除、完全在侧则平移，并非「无对应」；现表述会误导实现者以为 native 需要更宽松处理。
- 改法：表格第 4 行「与 JS 对齐点」列改为「替换与删除共用同一相交判据；JS 侧同样摘除（remap 单编辑区折叠），native 兜底的是不经过 JS 的编辑路径」。
- 验收/测试：KT-CA1 矩阵中「替换相交 → 整删」与 JS 行为逐条等价（R2 已核对，r3 仅改表述不改行为）。
- 来源：R2 review（round 1）P2-6

### cca/P2-7 [P2] 零长度区间（start == end）三侧行为不一；serialize 侧与 parse 自有键口径未定
- 维度：B（正确性）
- 文件：spec:50（refine `start <= end`）；代码锚点 `node_modules/.../formatting/RangeEditAdjustment.kt:125`（`removeAll { end - start == 0 }`）、`token-ranges.ts:92-99`（当普通区间保留/平移）、`packages/core/src/domain/chat/model/composer-draft.schema.ts:57-87 / :98-118`
- 问题：①refine 允许 `start == end`；JS remap 保留零长度区间，native 调整后直接删除——两侧行为长期不一致；②选定 `start < end` 后 **serialize 传入非法区间怎么办**没写（抛错炸落库链 / 静默丢弃使内存与 DB 分叉）；③D1 只写了「字段缺失不写自有键」，**字段存在但非法**按现表述可能留下 `tokenRanges: undefined` 自有键，`deepEqual` 形状断言会挂。
- 改法：①schema refine 收紧为 `start < end`（推荐）；②serialize **过滤**非法区间（丢弃该条、其余照写，全空写 `[]`），不抛错——落库链永不被 ranges 炸；③parse 对「缺失**或**非法」一律**不写自有键**（同口径），返回对象的 `tokenRanges` 键只在合法时存在；T-CA1 加三用例：`start == end` 拒收（parse）、serialize 过滤非法条目、「字段存在但非法」parse 后结果对象无自有键。
- 验收/测试：T-CA1 三条新用例；KT-CA1 加零长度区间用例锁定 native 侧剔除行为；r3 明确选定口径（`start < end` + 过滤不抛错）。
- 来源：R2 review（round 1）P2-7；review-full-1 N8（serialize/own-key 口径）

### cca/P2-8 [P2] Kotlin 单测缺 D4 映射与 D2 选区吸附——两个核心行为零单测
- 维度：G（测试）
- 文件：spec:173-176（KT-CA1/KT-CA2）；代码锚点 `EnrichedMarkdownTextInputView.kt:1104-1122`（setValueFromJS）、`FormattingStore.kt:41-54`（selectionAdjustedForAtomicLinks）
- 问题：D4 的全部核心就是 `nmskill://`/`nmtoken://` → TOKEN 映射，却无一条单测；E2E-C 已把选区吸附定性为 D4 落地后的防回归必要条件，KT-CA2 现只覆盖 adjustForEdit / addRange / coalesce，不含选区吸附。
- 改法：①新增 **KT-CA3**：把 `setValueFromJS` 里的映射抽成 internal 纯函数，断言「`nmskill://`/`nmtoken://` 链接 → TOKEN 且 url 置 null；普通链接保持 LINK；多 link 顺序不变」→ Step 3；②扩 **KT-CA2**：选区与 TOKEN 部分相交 → 扩整颗；光标落 TOKEN 内部 → 推 end；完全在外 → 返回 null → Step 2。二者皆纯类/纯函数，Robolectric 不必用。
- 验收/测试：KT-CA3 进 Step 3 blocking；KT-CA2 扩项进 Step 2 blocking。
- 来源：review-full-1 N2

### cca/P2-9 [P2] Kotlin 测试的运行命令与「补丁捕获」核对未写
- 维度：G（测试）/ K（收尾）
- 文件：spec:173、:154（Step 2）；`patches/react-native-enriched-markdown+1.1.1.patch`
- 问题：KT 测试只能放 `node_modules/.../android/src/test/...`，`yarn install` 重放补丁后只靠补丁携带；spec 没给 gradle 任务，也没要求重生成补丁后核对测试文件真的进了补丁——clean install 后测试会静默消失。
- 改法：①spec 写明运行命令 `cd apps/mobile/android && gradlew.bat :react-native-enriched-markdown:testDebugUnitTest`（项目名按 autolinking.json 的 `react-native-enriched-markdown`，最终以本地 autolinking 输出为准——Q6）；②Step 2 加校验：`npx patch-package react-native-enriched-markdown` 后，补丁文本 grep 必须含 `RangeEditAdjustmentTest` / `FormattingStoreTest`（及后续新增测试类名），否则 clean install 后测试丢失。
- 验收/测试：Step 2 文本含命令与补丁核对步骤。
- 来源：review-full-1 N3

### cca/P2-10 [P2] D3 把选区删除扩整到 LINK——改上游 LINK 语义却未披露
- 维度：H（兼容性）
- 文件：spec:94（D3 末条）、:190-200（兼容性节）；代码锚点 `EnrichedMarkdownTextInputView.kt:1027-1048`
- 问题：现 `deleteLinkBeforeCursor` 只处理折叠光标；D3 扩展选区删除时写「与 LINK/TOKEN 相交扩整颗」，等于改变 LINK 的选区删除行为（上游语义），兼容性节/风险表没有这一行。
- 改法（二选一写死，推荐①）：①**选区删除扩整只对 TOKEN，LINK 保持上游折叠光标语义**（面最小、与「LINK 现状已可用」的 e2e 观测一致）；②LINK 也扩整——则兼容性节加一行披露，S3 写明期望。D3 文本同步改。
- 验收/测试：r3 兼容性节与 D3/S3 口径一致；KT-CA1/S3 按 ①（或拍板后的②）写用例。
- 来源：review-full-1 N6

### cca/P2-11 [P2] D2 protected 分支的 API 入口没定——generic 函数拿不到 type
- 维度：A（可实施性）
- 文件：spec:72-85（D2 分支表）；代码锚点 `RangeEditAdjustment.kt:45-126`（`<T : MutableRangeBounds>` 泛型无 type 信息）
- 问题：spec 只描述 protected 行为不给入口；`adjustForEdit` 是泛型函数无法判断 TOKEN，实施会各写各的（改签名 vs FormattingStore 预分离），产出不同结构。
- 改法（二选一写死，推荐①）：①`adjustForEdit` 加参数 `isProtected: (T) -> Boolean = { false }`（`FormattingStore.adjustForEdit` 传 `{ it.type == StyleType.TOKEN }`），protected 为 true 时按 D2 表分支；②FormattingStore 层先摘出 TOKEN 单独按表处理，余量走通用 adjust。KT-CA1 按选定入口写。
- 验收/测试：D2 含 API 形态句；KT-CA1 用例与入口一致。
- 来源：review-full-1 N7

## Spec deviations

- none（R2 与 review-full-1 均未报 open deviations）

## Open questions / 待拍板

- **Q1（重要，S10 的前置）E2E-B 根因取证**：e2e 两次观测「插入落文后首次退格 = 胶囊+尾空格一键全删」，但按现行代码静态推演不应发生（区间不含尾空格、cursor 在空格后、`rangeOfType(TOKEN, cursor-1)` 检查的是空格）。取证（实现期）：插入后 log `tokenRanges`/cursor；确认退格实际走 `commitText("")` 还是 `deleteSurroundingText(1,0)` 还是双路径并发（华为隐藏 IME 一次按键可能同时触发两条删除路径）。结论决定 S10 期望行为（候选 A 先删空格再整删 / 候选 B 整删并写死「范围含尾空格」口径）。不阻塞其余条目。
- Q2 parse 是否用 `text.length` 约束 `end` 并校验区间有序不重叠：native `setTokenRanges` 丢弃越界、JS state 保留 → 理论漂移；正常流程产不出越界，属防御性校验，是否收进 D1 由用户拍板。
- Q3 `syncFromDraft` 兜底扫描的写回点：建议 r3 补一句「syncFromDraft 内 undefined 分支直接调一次 persistDraft 写回固化（仅此一次）」，避免实施漏在别处。
- Q4 Picker 落文是否也用新第三参消除一帧延迟：现状胶囊等 prop 收敛 effect 才出现（已被接受）；若统一，`commitComposerText` 传 ranges 并同步改 controller `:426/:445` 两参断言。
- Q5 `commitExternalText` 在 `confirmedRangesRef === null` 时收到 ranges 是否切确认制：暴露面 0（composer 恒传 prop），建议 D4 一句话写死（已并入 cca/P2-2 改法③）。
- Q6 Kotlin gradle 任务名/项目名最终确认（autolinking.json 现为 `react-native-enriched-markdown`；已并入 cca/P2-9）。

## 已豁免（用户确认不修）

- 无

## 合并后 QA（manual_user）

- r3 定稿进入 code-dev-loop 后：S1-S6、S8-S10 真机验收（S10 为本轮新增，期望行为按 Q1 结论）；S7（IME）按 D7 触发条件。

## K 节建议（下游执行时闭合）

- r3 落盘时同步：版本行 r2→r3、文末追加「R2 修订记录」（14 条逐条对应本 fix-spec id）；全文「五入口」→「六入口」**且 spec:89「既有两入口」→「既有三入口」并列出 sendKeyEvent KEYCODE_DEL**；变更点表行数随 #3/#4 扩充核对编号连续性。
- **E2E-C 落盘**：D4 段注明「前置依赖 D2 的 selectionAdjustedForAtomicLinks 纳入 TOKEN（否则 LINK→TOKEN 映射后光标吸附回归）」；Step 3 注明依赖 Step 2。
- 注释同步（r3 变更点内点名）：`NativeChatComposer.tsx:28`（ref.setText 两参注释）、`ChatConversationPanel.tsx:147-151`、`useChatComposerController.ts:118-131` 的 M7 说明改三参；新增 Kotlin 分支/组合态判定按仓库惯例写中文注释；`ComposerDraftTokenRange` 带中文类型文档注释。
- 测试同步：`chat-conversation-panel.integration.test.tsx:981` 改三参断言（cca/P0-2）；`:938` 与 controller `:426/:445` 保持两参；如 Q4 采纳则一并改。
- 执行前置：mobile 测试用 `npm test -w @novel-master/mobile`（`pretest` 自动 build core + webview；**直接 `npx jest` 会读旧 dist**——`apps/mobile/jest.config.js:71-74` 把 `@novel-master/core/chat` 直连 `packages/core/dist/public/chat.js`）；core 用 `npm test -w @novel-master/core`；desktop 用 `npm test -w @novel-master/desktop`；Kotlin 见 cca/P2-9。
- 补丁与 Kotlin 测：重生成补丁后 grep 测试类名确认入补丁（cca/P2-9）；`yarn install` 重放后跑一次 `:react-native-enriched-markdown:testDebugUnitTest`。
- 收尾：CHANGELOG 记「草稿 schema 新增 tokenRanges（Android-only）+ 三条已知限制」；iteration-state 标注 S7/IME 仍按 D7 触发；清掉 Q1 取证的临时日志/探针。
- 验证门：`npm run typecheck -w @novel-master/mobile`（导出桶 + 三参签名一并锁）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | no（待 review-full-2 验证） |
| fix_spec_path | docs/Iterations/composer-capsule-atomic-2026-10/cr-fix-spec.md |
| dag_version / review_round | 3 / 2（cr 循环内） |
| P0 / P1 / P2（已写入 fix-spec） | 2 / 1 / 11 |
| 未写入的开放 must-fix | 0（review-full-1 的 N1-N11 全部并入：N1→P0-2、N4→P1-1、N9/N10→既有条目/K 节、其余→P2-8~P2-11 或既有条目加强） |
| spec_deviations | none |
| C-orch | ✅（cca/P0-2 即链路完整性条目） |
| C 类合并后 QA | S1-S10 真机（见上） |
