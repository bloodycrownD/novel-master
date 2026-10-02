# CR Fix Spec: chat-webview-unify

## 元信息
- repo: D:\Dev\nm-worktree\cwu（分支 feat/chat-webview-unify）
- base_sha: 9ca5f5ad
- head_sha: d64c27c3（r6 full 终审定格，13 笔提交；另含工作区未提交 e2e 三文件：`apps/mobile/e2e/wdio.shared.conf.ts`、`apps/mobile/e2e/pageobjects/app.page.ts`、`apps/mobile/e2e/pageobjects/vfs.page.ts`）
- prd_path: 非标准输入（用户口述，见 docs/apm/memory/20261001-chat-webview-unify-spec.md）
- spec_path: D:\Dev\Js\novel-master\docs\Iterations\chat-webview-unify\spec.md（主仓只读）
- check review_round: 9（…前七轮同前；sc-r2 No-Go 5 P1 → doc-fix；**sc-r3 Go**——7 条全闭合 + DAG 无同文件并行无环 + 31 条齐账；3 条一行注按预授权顺手修正）
- cr_dag_version: 9
- 状态：**fix-spec-ready（sc-r3 Go，待用户确认投递 fix-cr-*）**
- **边界声明**：本文件只描述「要怎么改」，不含任何实现代码改动；执行由下游 dev-loop 的 `fix-cr-*` 节点承接（见「CR→dev-loop 衔接契约」）。本文件不宣称 merge-ready。

## 流程闸门（用户 2026-10-01 拍板：cr-fix-spec 不是执行 spec，须先 check）

1. 本 fix-spec **每次实质更新后**（新增/改写/删除任一 must-fix 条目、deviation 状态翻转、豁免增减），必须先派 readonly check（spec-check-loop 式文档审查，judge 对照主 spec 与两个 skill 的语义）过一遍，**check 结论为 Go 才允许下游执行**。
2. check 的审查面：本文件结构合规（code-review-loop 的 fix-spec 结构模板）+ 每条 must-fix 三件套（改法/触达文件/验收测试）齐备 + 与主 spec 契约不冲突 + 无 open spec_deviations。
3. check 未过或未跑：状态不得离开 `draft`、不得通知 dev-loop 取用本轮条目。
4. **No-Go 回路（r2-P2-9）**：check 轮判 No-Go → CR 主代理直接 doc-fix 本文件 → 重跑 check，直至 Go；check 轮内同一 must-fix 震荡 ≥3 轮 → blocked 请用户拍板。

## CR 编排

**主模式（2026-10-01 用户拍板后修订）**：dev-loop 连续跑至 dev-ready → 对本文件已暂存的 15 条 + 剩余全部 diff 做一次 **full 全维终审** → 修复 → 终验。**r6 full 已执行**（2026-10-01，三路同步子代理：cr-r6-perf-sec / cr-r6-logic-tests / cr-r6-coupling），本版为 r6 汇总落盘。

**触发点与互斥**：恢复派单 = 本轮 `fix-cr-*` 节点全部闭合 + dev-loop cr-func 复判 func-ready；允许投递开工 = must-fix 过流程闸门（check Go）**+ 用户确认**。

**维度分工（节点 → 维度）**：

| node_id（按轮次编号 cr-rN-*） | 维度 |
|---|---|
| cr-rN-perf-sec | E 性能 + D 安全 + I 可观测性 |
| cr-rN-logic-tests | B 正确性 + A 契约符合 + G 测试 + J 的可自动化部分 |
| cr-rN-coupling | C-orch 编排收敛 + C 整洁 + F 中文注释 + H 兼容性 |

**r6 三路结论概要**（来源详情见各条目「来源」栏）：
- **cr1 十五条现状**：14 条仍未落地（0 闭合）、cr1-P1-5 部分落地（dock-style-reference.ts 已建但仅 1/9 导出被消费）；cr1-P1-3 与 P1-5 的前提随 ChatComposer 删除已失效，改法已按当前 head 修订。
- **新增 2 条 P1**（r6-D-1 粘贴绕过门控、r6-A1 typeahead 刷新触发面 spec 缺口）+ 13 条独立 P2 + 3 条并入既有条目（r6-C1→P1-5、r6-C5→P2-1、r6-C6→P2-5）。
- **spec_deviations**：r6-A1 承接 1 条 open（typeahead 候选源刷新触发面），其余维度 none。
- es2018 纪律零违反；spec 固化架构裁决（上行 v:1 / v2 仅 ready+dockAction / 键盘态 RN 派生 / 直发不 defer / 工厂落点 / 旧链零触碰）三路实证全部落地无偏离。
- e2e 三文件未提交修改三路评审结论：方向正确可用；r6-C8（wdio 缩进）、r6-G2（热区注释债）、r6-G3（toast 时序）为收尾加固项。

**编排纪律**：① review 子代理必须 readonly、主代理不得自审；② check 轮次上限 5，同一 must-fix 震荡 ≥3 次 → blocked 请用户拍板（doc-fix 后的同批复核轮不计入震荡上限——check r6 补注）；③ not-ready 后主代理直接 spec-fix 本文件并 `cr_dag_version++`。

**head_sha 与 diff 口径**：diff 范围 = `9ca5f5ad..d64c27c3`（13 笔提交）+ 工作区未提交 e2e 三文件（单独标注，不混入已提交范围结论）。

**CR 侧 DAG 状态**（独立于 dev-loop 的 `cache/context-bundle.md`）：

```yaml
cr_dag_version: 9
cr_round: 2            # r6 full 三路 → spec-fix → check r5 No-Go → doc-fix → check r6 Go → sc-r1 No-Go 轻量 → doc-fix → sc-r2 No-Go（5 P1：K1 并行冲突/C2 dock.ts 溢出/P2-8×A1 in-node spec 残留/factory.ts 漏登记/model.ts P2-1 漏登记）→ 已 doc-fix → 待 sc-r3 复核
mode: full（r6 已执行）
wave_plan: [[cr-r6-perf-sec, cr-r6-logic-tests, cr-r6-coupling]]
node_status: { cr-r6-perf-sec: done, cr-r6-logic-tests: done, cr-r6-coupling: done }
spec_fix_plan: []      # sc-r3 Go 收敛；3 条一行注已顺手修
status: fix-spec-ready（sc-r3 Go——待用户确认投递 fix-cr-*）
head_sha: d64c27c3     # + 未提交 e2e 三文件
files:                 # 9ca5f5ad..d64c27c3（13 笔）全量 + 未提交 3 文件；关键新增面：
  - apps/mobile/src/web/chat-conversation/**（index.html/styles:{chat-conversation.css,dock-style-reference.ts}/webview:{main,model,dispatcher,dock,typeahead}）
  - apps/mobile/src/web/{chat-transcript,composer-input}/webview/**（工厂化 + editor.ts）
  - apps/mobile/src/web/shared/host-theme.ts
  - apps/mobile/src/webview-host/**、src/web/tsconfig.json、scripts/build-webview.mjs、ios pbxproj
  - apps/mobile/src/components/chat/{ChatConversationWebView.tsx,ChatConversationBridge.tsx,useChatComposerController.ts,ChatTranscriptWebViewHandle.ts,skill-typeahead-filter.ts,composer-dock-padding.ts,chat-list-scroll-cache.ts(触碰面)}
  - 已删：MessageList/ChatComposer/ComposerAtPathInput/MessageActionMenu
  - apps/mobile/e2e/**（未提交：wdio.shared.conf.ts/app.page.ts/vfs.page.ts + 已提交页对象更新）
prior_conclusion: dev-ready（1839 绿）+ e2e 实跑（T-CU12 正文 3/3 绿但第三 it 断言偏弱见 r6-G1；全量 6 条中 2 条绿，余量=存量 spec 健壮性）
evidence_packs:        # cr1 三份包未记 head_sha 只作线索；r6 事实全部新鲜读
  - docs/Iterations/chat-webview-unify/cache/spec-check-r1-{perf,arch,logic}.md
must_fix: []           # 见 Must-fix 节（8 P1 + 23 P2 = 31 条）
fix_spec_path: docs/Iterations/chat-webview-unify/cr-fix-spec.md
```

## CR→dev-loop 衔接契约（对两个 skill 默认语义的本迭代显式扩展）

dev-loop 原生 `fix` 节点的输入源是 verify/cr-func 的 must-fix；本节把 CR 产出的修复项接入 dev-loop，三段：

1. **投递**：CR 判 `fix-spec-ready`（过流程闸门 + 用户确认）后，由 dev-loop 主代理读本文件 `## Must-fix`，按「不同文件一组」拆成 `fix-cr-*` 节点（标注 `source: cr-fix-spec@r6`）。
2. **执行**：`fix-cr-*` 节点 prompt 必须带上条目 id/文件/改法/验收；遵守 dev-loop 既有纪律（同文件禁止并行 fix；fix 后重跑 verify + cr-func）。
3. **回收**：执行结果由 CR 主代理从主仓绝对路径回写每条闭合状态（commit sha + 闭合说明）——dev-loop 子代理不写本文档；全部闭合且 cr-func 复判 func-ready 后收敛。

**执行顺序与分组约束（r6 修订版 + check r5 修订——旧版两条已随 ChatComposer 删除/bridge.test 落地而失效）**：

- ~~② cr1-P1-5 必须早于 ChatComposer.tsx 退役落地~~ **作废**（组件已于 dc4c903b 删除；P1-5 改法已按现状修订为缩范围）。
- cr1-P1-6 的 metrics 断言 ① 已由 `chat-conversation-bridge.test.ts:46` 满足（跨端口径），**只留 --selection 断言**，勿重复执行。
- ① **cr1-P1-1 必须先于 cr1-P1-4 落地**（ready 闸门改变「恰一条 ready」断言语义）；两者共用新建的 `chat-conversation-entry.test.ts`——**P1-1 的 entry.test.ts 半边先行，P1-4 后写**（sc-r1 补标）。建议 cr1-P1-1 + r6-D-1（**dock.ts 半边，RN 半边归 ChatConversationWebView 节点——sc-r3 补注**）+ r6-E-1 + cr1-P1-3 的 dock.ts 半边（:281-284 toggle 删除）+ cr1-P2-7 的 dock.ts 半边（bindEvents 加监听，排在 r6-E-1 之后）+ r6-C2 的 dock.ts:41 注释清理 + cr1-P1-6 + `dock.test.ts` 合并为同一 `dock.ts` 节点，一次改完再拆测试。**若按此合为单节点，则下方 dock 串行链退化为单节点内顺序（N1 澄清）**。
- 同文件条目不得并行：`chat-conversation-boot-script.test.ts` 仍由 P1-1(dist)/P1-3(测试半边)/P1-5/P2-6/P2-9 **五条共享**（建议合一节点；**P1-3 的 dock.ts 半边已划入 dock 节点，本节点只取 CSS+断言半边——sc-r1 补标**）；`dispatcher.ts`+**`model.ts`（P2-1 清单删行触 model.ts:187——sc-r2 补登记）**由 P2-1(含 r6-C5)+P2-2 共享（合一，含 `chat-conversation-dispatcher.test.ts`——T-CDV-09 清单同步）；`model.ts` 另由 P2-3(扩三份)/P2-5(含 r6-C6) 共享（**P2-1/P2-3/P2-5 三条同触 model.ts，必须串行或合一——sc-r2 收紧**）；`ChatConversationBridge.ts` 由 P2-3(手抄③)+P2-5(手写 union) 共享（**合一或串行——check r5 补标**）；`ChatConversationWebView.tsx` 由 r6-D-1/r6-I-1/r6-I-2/r6-C4/r6-C7 共享（**合一或串行，r6-I-2 与 r6-D-1 同函数 1636-1651——check r5 补标；r6-C7 为 sc-r1 补标**）；`editor.ts`（旧包）+**`composer-input/webview/runtime/factory.ts`（P1-1 改 resolveComposerHost 触 :47 ↔ r6-E-2 触 :28,65——sc-r2 补登记）**由 r6-E-2+cr1-P2-7 的 editor.ts 半边+cr1-P1-1 的 factory.ts 半边共享（合一或串行——sc-r1/sc-r2 补标）；`dock.ts`+`dock.test.ts` 链 P1-1→P1-3(dock 半)→r6-E-1→P2-7(dock 半)→**r6-C2 的 dock.ts:41 注释清理（sc-r2 从并行组拆入）**→P1-6(余量) 串行。
- **spec.md 同文件总则（sc-r1 补标，sc-r2 推广到条目体）**：凡带 K 节 spec 回填动作的条目（P1-1/P1-2/P2-1/P2-6/P2-7/r6-E-2/r6-C4/r6-D-1/P2-8/r6-A1 等），其 **spec.md 编辑一律不在各自节点内做**，统一收进末位的 `fix-cr-spec-backfill` 节点（所有改码节点之后跑）——按文件分组拆节点时 spec.md 视为独占文件；**各条目正文若提及 spec 改动，均以下句为准：「本条只改码与测试，spec 侧动作由 fix-cr-spec-backfill 节点承担」**。
- 独立可并行组（**末位 backfill 节点与 r6-K1 不在其中——sc-r2 修正**）：P1-2（build.gradle，**merge 前必堵**）、P2-4、r6-C2（死模块本体，dock.ts:41 注释清理已拆入 dock 链——sc-r2 修正）/r6-C3、r6-G1/G2/G3/C8/ENV1（e2e 面，可一组）。
- **末位串行节点：`fix-cr-spec-backfill`（= r6-K1）**——所有改码节点之后跑，收编全部 K 节 spec.md/README/context-bundle 回填动作（sc-r2 从并行组移出，与总则及 r6-K1 自述一致）。

## Must-fix（按 P0 → P1 → P2；r6 full 后 8 P1 + 23 P2 = 31 条，无 P0；sc-r1 增 r6-K1）

### cr1-P1-1 [P1] 装配失败静默降级——绕过宿主 8s 白屏兜底（r6 实证仍缺且 `mounted` 已成真死导出）
- 维度：I + C
- 文件：`src/web/chat-conversation/webview/main.ts:63,70`、`webview/dock.ts:180,491`、`src/web/composer-input/webview/runtime/factory.ts:47`；测试落点：`__tests__/chat-conversation-entry.test.ts`（与 cr1-P1-4 共文件，本条先行）+ boot-script.test.ts（dist 断言）
- 问题：`dock.mount()` 签名 void、pickElements 未命中静默 return；main.ts 丢弃 `createComposerRuntime` 返回值（handle 的 `mounted` 字段零消费方）→ 壳 id 漂移时输入区整块消失但入口照样发 ready，8s 兜底不触发。`resolveComposerHost` 零外部消费死导出。r6 新事实：全仓无 `shouldEmitConversationReady` 符号，cr1 改法原样适用。
- 改法：① `dock.mount(): boolean`；② main.ts 接住两返回值；③ 新增 `shouldEmitConversationReady({composerMounted, dockMounted})` 纯判定，`emitConversationReady` 开头设闸（不满足则 `console.error` 中文诊断并 return，不发 ready——不用摘能力位方案）；④ `resolveComposerHost` 收回模块内；⑤ 注释写明因果。随本条一并落 cr2-4（dispatcher 未知 type 静默丢弃）：失败分支打点已在③，`routeHostMessage` 返回 null 处按 OQ-D 拍板结果处置（未拍板前维持静默）。
- 验收/测试：四组合真值表单测；dist 断言 app.js 含 `shouldEmitConversationReady`；变异——把 dock.mount() 挪到 createComposerRuntime 之前必红。一次性人工验证（Step 10）：临时删 `#composer-dock` 构建 → ~8s 落宿主错误态。
- 来源：cr-r1-perf-sec/coupling/logic + cr-r6 三路复核一致（仍缺）

### cr1-P1-2 [P1] Android checkWebViewAssets 守卫清单漏第五包（merge 前必堵，r6 三路实证一致）
- 维度：C-orch + H
- 文件：`apps/mobile/android/app/build.gradle:178`；测试落点：`__tests__/webview-asset-guard.test.ts`
- 问题：`packages` 仍四包 `["chat-transcript","rich-document","code-editor","composer-input"]`、注释仍「四包」——干净 clone 出包缺 `chat-conversation` 资产的白屏 APK 且守卫不响。对照：pbxproj 五包 ✅、copyDistToNativeSinks 自动 ✅。
- 改法：数组补 `chat-conversation`、注释改五包。
- 验收/测试：`gradlew :app:checkWebViewAssets` 通过；静态断言（GBK 混合编码，走字节/行定位）。
- 来源：cr-r1-coupling；cr-r6-perf-sec 实证（android diff 为空）

### cr1-P1-3 [P1] 输入区置灰规则与 toggle 双双仍在——r6 修订版（ChatComposer 已删，无裁量分支）
- 维度：A + J
- 文件：`src/web/chat-conversation/styles/chat-conversation.css:702-704`、`webview/dock.ts:281-284`、`__tests__/chat-conversation-boot-script.test.ts`
- 问题：`.composer-input--disabled{opacity:.55}` 是宏链规则逐字搬入，现网 chat 链 RN TextInput 从无淡出变体；`inputDisabled`（运行中/未选模型常态）置位即整输入区淡 55%——UI 一致性硬验收红灯。r6 新事实：toggle 现有**两个写入方**（dock 的 renderInput 与 composer runtime 经 init 的 applyDisabled）——双写。
- 改法：① 删 CSS:702-704 整条（旧包 composer-input.css:48 与 editor.ts:424 是宏链活链**不得动**）；② 删 dock.ts:281-284 的 classList.toggle 整块（renderInput 只留 readOnly+placeholder 两行）；③ T-CC-CSS-14 补 `rules.has('.composer-input--disabled')).toBe(false)`——**断言查 dist 合成包 CSS，不能查旧包**（旧包在的规则会打红）。
- 验收/测试：断言绿 + 变异（规则加回必红）；Step 10 截图「运行中/未选模型」输入区不淡。
- 来源：cr-r1-logic；cr-r6-logic-tests 实证修订（cr2-1 文本）

### cr1-P1-4 [P1] T-CU1/T-CU3 无行为测试——r6 补执行障碍备注
- 维度：G + B
- 文件：新增 `__tests__/chat-conversation-entry.test.ts`
- 问题：入口行为（单 ready/单注册/装配序）只有 dist 字符串比对恒真。
- 改法：底座照 **`chat-conversation-dock.test.ts` 的自建 DOM 桩**（300+ 行 FakeElement/FakeStyle + `flushRaf` 先例——sc-r1 修订：原引 dispatcher.test.ts 无桩、jsdoc 方案的 jest-environment-jsdom 依赖本仓不存在实测不可执行，两处均已纠正）；断言：ready 恰 1 条（v===2/'u1'/含 composer-dock）、document+window 监听各恰 1、同步分支同构。
- 验收/测试：变异必做——bind 挪到两工厂后 / ready 注册提前，各自必红。
- 来源：cr-r1-logic；cr-r6 复核仍缺

### cr1-P1-5 [P1] T-CU10 RN 参照——r6 修订版（范围缩水：五项无真源，首批只剩 toolbar+chips）
- 维度：G + J
- 文件：`src/web/chat-conversation/styles/dock-style-reference.ts:28-101`、`__tests__/chat-conversation-boot-script.test.ts`、（参照源）`src/components/chat/composer-toolbar-style.ts`、`src/components/chat/AttachmentDraftChips.tsx`
- 问题：原条目前提（RN 真源在仓）随 ChatComposer 删除**部分失效**——box/dock/hintRow/error/sendBtn 的 RN 真源不复存在，dock-style-reference.ts 现状是 9 导出仅 `composerToolBtnStyle` 1 个被消费、8 处出处行号悬空、文件头:10 注释指向不存在的消费测试。
- 改法（r6 修订）：**首批缩范围**——① 保留 composerToolBtnStyle 断言（既有）；② chips 数值改从仍存活的 `AttachmentDraftChips.tsx` 的 StyleSheet import 作真源（chip padding/radius/maxWidth/label maxWidth 四项）；③ dock/box/hintRow/error/sendBtn 五项**不进首批**（无对照真源，断言会退化成 CSS vs 硬编码——正是本条要消灭的形态），由 Step 10 截图对比承担；④ dock-style-reference.ts 的 8 个零消费导出删除，出处注释改为可追溯形式（`git show dc4c903b^:…/ChatComposer.tsx`）；⑤ 修文件头错注释。
- 验收/测试：变异——composer-toolbar-style.ts width 36→32 必红、AttachmentDraftChips chip padding 改值必红；「本文件每个导出都被至少一处 import」静态断言（r6-C1 并入）。
- 来源：cr-r1-logic；cr-r6-coupling 修订（coupling-r6-1 并入）

### cr1-P1-6 [P1] 生产常量与 selection 映射零断言——r6 缩范围（metrics 已满足）
- 维度：G + A
- 文件：`__tests__/chat-conversation-dock.test.ts`（剩余动作唯一落点——check r5 对齐）
- 问题与改法（r6 修订）：① metrics 断言**已由 `chat-conversation-bridge.test.ts:46` 满足**（CONVERSATION_COMPOSER_METRICS 跨端口径，比原建议落点更贴）——标已满足勿重复执行；② 只剩 `--selection`：dock 测试 DOM 桩走真 `applyHostTheme`，断言 `documentElement.style.getPropertyValue('--selection')` 被写为 THEME.selection。
- 验收/测试：变异——THEME_VARS 删 selection 行必红。
- 来源：cr-r1-logic；cr-r6 三路缩范围共识

### r6-D-1 [P1] 划词「粘贴」绕过 inputDisabled / uiRunning 门控——运行中可向禁用输入框注入文本
- 维度：D（安全）+ B
- 文件：`src/web/chat-conversation/webview/dock.ts:516-533`（composerPaste 路由）、`src/components/chat/ChatConversationWebView.tsx:1636-1651`（handleCustomMenuSelection paste 分支）
- 问题：旧链 textarea 是 RN TextInput，editable=false 时原生粘贴进不来；新链 `handleCustomMenuSelection` 只对 copy 判 `uiRunning`，paste 不判；dock 的 composerPaste 也不查 `state.inputDisabled`——运行中（或未选模型/末条纯文本待续跑）长按粘贴，会向被禁用的输入框注入文本并经 commitComposerText 落库成草稿，下一轮被发出。menuItems 静态三项，运行中照样展示。
- 改法：① paste 分支前置 `if (uiRunning) return`（与 copy 同口径；若产品要运行中可粘贴，在 spec 风险表显式记一笔，不靠漏判实现）；② dock 的 composerPaste 分支加宿主闸门 `if (state == null || state.inputDisabled) return`——「能不能写」的真源收到 composerState（与 OQ-B 收敛方向一致）；③ 两处注释写明因果。
- 验收/测试：dock 测试「inputDisabled:true 喂 composerPaste → textarea.value 不变、无 change 上抛」；RN 侧「uiRunning 下 paste 不触发 Clipboard.getString」；变异——去掉任一闸门必红。
- 来源：cr-r6-perf-sec（r6 新发现）

### r6-A1 [P1] typeahead 候选源刷新触发面缺失——spec 承诺 vfsMutated 下发、实现只按会话/项目拉取
- 维度：A（spec deviation 承接）+ B
- 文件：`src/components/chat/useChatComposerController.ts:295-341`（两个 effect 依赖 [sessionId]/[scope.projectId]）
- 问题：spec.md:99 明写「RN 在进会话 / 工作区变更（vfsMutated 事件）/ 技能变更时拉取下发」；实现只有进会话/切项目触发，**全仓无 vfsMutated 订阅**（仅 model.ts:94 一句注释）。对照旧链 ChatComposer.tsx:178（BASE）依赖 `[activeAt != null, sessionId]`——每次 @ 打开都重拉——新实现比现网**更容易陈旧**（大工作区新增文件后 @ 不到）。
- 改法（两方案，执行前先探事件存在性——**sc-r1 补探路指引**：先确认 VFS 写入口（VfsFileManager / session 文件写链）是否已有可挂的事件面（如 buildListRows 的变更通知），**若无现成事件面则直接走方案 B，勿在方案 A 上空耗**）：方案 A（默认）——接入或低成本补一个 vfsMutated 类事件，controller 加订阅 effect 触发重拉；方案 B——改 spec 措辞为「进会话拉一次」并把候选陈旧度写入风险表（需用户确认收窄）。执行者探明后择一，落点回写本条。
- 验收/测试：方案 A——新增文件后 @ 候选含新文件（单测 mock 事件触发）；方案 B——spec 文档动作**由 backfill 节点承担**（spec 措辞改「进会话拉一次」+ 风险表记陈旧度，**方案 B 执行前须用户确认**——sc-r2 修订）。
- 来源：cr-r6-perf-sec（spec_deviations open 条承接）

### cr1-P2-1 [P2] dock 域路由隐式 fallthrough + stickIfNearBottom 死协议面（r6-C5 并入）
- 维度：D + C
- 文件：`src/web/chat-conversation/webview/dispatcher.ts:170-184`、`webview/model.ts:187`（清单）、`__tests__/chat-conversation-dispatcher.test.ts`（T-CDV-09 清单同步——sc-r1 补）、（可选）旧包 bridge case
- 问题：① 未知 dock type 静默兜底 selectAll（带副作用）；② `stickIfNearBottom` 仍在清单被路由，但宿主零发送方（BASE 起唯一发送方 keyboardLiftNonce 是恒 0 死 prop——现网也从未真发过）——纯负担。
- 改法：① 显式分支 + default 返回 EMPTY_ROUTE；② `stickIfNearBottom` 从 CONVERSATION_TRANSCRIPT_TYPES 清单移除 + model.ts 注释「BASE 起即无生产方（keyboardLiftNonce 恒 0），本轮清掉」；**旧包 bridge 的 case 留着**（旧包仍出产物，动它有 dist 契约测风险）；**RN 侧 Bridge.ts 的全集声明保留不动——本条的 scope 仅 web 侧清单/路由，RN 手写 union 的整体删除由 cr1-P2-5 独立承担，两者不冲突（sc-r2 裁决措辞）**。
- 验收/测试（sc-r1 修订）：`chat-conversation-dispatcher.test.ts` 的 **T-CDV-09 清单同步删去 `stickIfNearBottom` 后全绿**（现状该断言逐项遍历清单——不删必红）；新增负向 `__futureDockType` → dock===null；负向 `stickIfNearBottom` 不再路由 transcript。
- 来源：cr-r1-perf-sec/coupling + cr-r6-coupling（coupling-r6-5）

### cr1-P2-2 [P2] dispatcher 的 v1 字面量与两包 BRIDGE_V 知识重复
- 维度：C（DRY）
- 文件：`src/web/chat-conversation/webview/dispatcher.ts:35-39,77-79`
- 问题/改法：`v1()` 写死 1 → import 两包 BRIDGE_V（别名区分）+ 一致性守卫。r6 实证原样仍缺。
- 验收/测试（sc-r1 修订口径）：断言 dispatcher 与两包的**三个 BRIDGE_V 引用恒等且等于各自包导出常量**（改成 import 后「为 1」不再是独立事实）；tsc 绿。
- 来源：cr-r1-coupling；r6 复核仍缺

### cr1-P2-3 [P2] THEME_KEYS 手抄副本从 2 份变 3 份（r6 扩范围）
- 维度：C（DRY）
- 文件：`src/web/shared/host-theme.ts:36`（THEME_VARS 未导出）、`src/web/chat-conversation/webview/model.ts:50-60`（手抄②）、`src/components/chat/ChatConversationBridge.ts:84`（RN 侧手抄③——r6 新发现）
- 问题：三份手抄零约束；宿主加第 10 键三处全不红。
- 改法：host-theme.ts 导出 `HOST_THEME_KEYS`，web model.ts 与 RN Bridge.ts 都改为 import；bridge.test.ts 键集排序对照（保留长度 9 + 含 selection 两条）。**风险与退路（check r5 补 / sc-r1 修订）**：typecheck 实际入口是 `apps/mobile/tsconfig.build.json:7-14`（exclude 只排 `src/web/**/webview/**` + 两个 shared 子目录，**不含 `src/web/shared/host-theme.ts`**——且实测该文件已在 RN 侧 tsc 程序内），故 RN→web import 可解析、DOM 风险为零（sc-r1 实证替代原「若解析失败」的软退路；tsconfig.json:28-34 的 exclude 全 web 面不构成障碍）；若极端情况仍失败，退路 = 键集常量镜像（RN 侧留副本）+ 集合相等断言锁漂移。
- 验收/测试：变异——THEME_VARS 加假键必红（或退路形态下镜像断言红）。
- 来源：cr-r1-coupling；cr-r6-coupling 扩（新增第三份手抄）

### cr1-P2-4 [P2] typeahead 两处恒等 slice
- 维度：C（死代码）
- 文件：`src/web/chat-conversation/webview/typeahead.ts:110-112,119-124`
- 问题/改法：filter 已封顶，外层 slice 恒等——删两处；TYPEAHEAD_LIMIT 若无消费方一并收。r6 实证原样。
- 验收/测试：候选数 ≤5 断言仍在。
- 来源：cr-r1-coupling；r6 复核仍缺

### cr1-P2-5 [P2] 命名达意 + RN 侧手写 22 项 union 漂移面（r6-C6 并入）
- 维度：C（命名/DRY）
- 文件：`src/web/chat-conversation/webview/model.ts:211-220`、`src/components/chat/ChatConversationBridge.ts:238-260`（r6 新发现）
- 问题：① `ConversationWebToHostType` 名不达意（实只 v:2 两条）；② RN 侧新增**手写 22 项 union** 与 web 侧数组派生版同名，两侧零消费零断言——加下行 type 时 RN 不跟随不报错。
- 改法：① web 侧改名 `ConversationWebToHostV2Type`；② RN 手写 union 删除——RN 侧已有穷举的 `ConversationHostMessage` 联合类型（:262-312）覆盖全量下行 type，手写 union 纯冗余；③ bridge.test.ts 加「RN ConversationHostMessage 的 type 集合与 web 侧 CONVERSATION_*_TYPES 扁平化相等」断言。
- 验收/测试：tsc 绿 + 集合相等断言绿。
- 来源：cr-r1-coupling；cr-r6-coupling 扩（coupling-r6-6）

### cr1-P2-6 [P2] chips max-height:36 前提抄反 + 断言钉死错误
- 维度：A + G
- 文件：`chat-conversation.css:592-603`、`chat-conversation-boot-script.test.ts:424`
- 问题/改法：`.chips__row` 补 `max-height:36px` + 注释修正 + 断言反转 toMatch；spec Step 4 措辞进 K 节。r6 实证原样（CSS 无 max-height、注释仍「不适用」、断言仍 not.toMatch 反向锁死）。
- 验收/测试：变异——删 max-height 必红。
- 来源：cr-r1-logic；r6 复核仍缺

### cr1-P2-7 [P2] setText 下行后 typeahead 浮层不重渲
- 维度：B
- 文件：`src/web/composer-input/webview/runtime/editor.ts:448`、`webview/dock.ts:448-488`
- 问题/改法：applyText 的 value 变化分支派发 `composer:text-changed` CustomEvent，dock.bindEvents 监听后 renderTypeahead（旧包空发无影响）。r6 实证全仓 0 命中该事件名——仍缺。**编排注意**：与 r6-E-2 同碰 editor.ts，串行。
- 验收/测试：dock 测试「浮层展开态喂真 setText → 浮层关闭/重渲」。
- 来源：cr-r1-logic；r6 复核仍缺（确认真 bug）

### cr1-P2-8 [P2] typeahead「absolute 覆盖 vs 现网流内推挤」视觉差异未入风险表（纯文档）
- 维度：A（K 节）
- 文件：（**本条无代码文件——全部动作为 spec.md 文档编辑，按 spec.md 同文件总则统一由末位 `fix-cr-spec-backfill` 节点承担，不单独立改码节点——sc-r2 修订**）
- 问题：现网 TypeaheadList 是流内子 View（展开把 input 往下推）；web 侧 bottom:100% 绝对定位（input 不动、盖住 chips）+ 自创 max-height:240px——行为差异不在风险表与 Step 10 清单。
- 改法：（backfill 节点内执行）风险表补行 + Step 10 截图清单补「typeahead 展开态」对比项，验收以现网流内形态为参照判定接受度。
- 验收/测试：（backfill 节点内自查）spec.md 出现该两处（纯文档动作以 spec diff 自查为准；对应「合并后 QA」截图第二项）。
- 来源：cr-r1-logic

### cr1-P2-9 [P2] dock 段 CSS 数值断言差集 11 项收口
- 维度：J
- 文件：`__tests__/chat-conversation-boot-script.test.ts`
- 问题/改法：T-CC-CSS-05..10 补齐或新增 T-CC-CSS-15 一次收口（对照 P1-5 修订后的参照源——**范围随 P1-5 缩水，五项无真源的不进断言**）。
- 验收/测试：变异——skill gap 8→12、删 ellipsis 各自必红。
- 来源：cr-r1-logic；r6 范围联动修订

### r6-E-1 [P2] typeahead 五事件源无去重 + 结果未变仍整块重写 innerHTML
- 维度：E
- 文件：`src/web/chat-conversation/webview/dock.ts:477-486`（五源）、`:321-352`（renderTypeahead）
- 问题：input/keyup/click/select/selectionchange 五源各调一次 renderTypeahead，无 rAF 合并、无 query 短路；`view != null` 即无条件 innerHTML 重建（内容相同也写）。selectionchange 在 Android 随光标高频触发——大工作区下一次击键 = N 次全量过滤 + N 次 innerHTML 解析。
- 改法：① 五监听收敛到单一 `scheduleRenderTypeahead()`（requestAnimationFrame 合并）；② `lastRenderKey = trigger|start|items token 串`，key 相同直接 return；③ unmount 里 cancelAnimationFrame。
- 验收/测试（sc-r1 修订口径）：dock 测试「同 query 连续两次事件 → innerHTML 只写一次」用 **setter spy / 写次数计数**（dock.test.ts 的 FakeElement 桩无 MutationObserver，勿用该口径）；变异——去 key 短路必红。K 节 E 维交付物①改完后应恒为 1。
- 来源：cr-r6-perf-sec（结构性空转，读码可判，不依赖 Q4 基线）

### r6-E-2 [P2] heightReport:false 下测高脚手架仍逐键空转（注释与代码相反）
- 维度：E
- 文件：`src/web/composer-input/webview/runtime/editor.ts:289-294,316-327,565-569`、`runtime/factory.ts:28,65`（heightReport 的 options 与 handle 落点）
- 问题：`measureByClamp` 第一行早退导致 clamp/lastHeight 去重没跑，但 `scheduleMeasure` 仍被 input/keyup/applyText/ResizeObserver 逐次调用 → 每键一次 rAF 空转；注释却写「测高链路照跑只是没有上行」。
- 改法：① `scheduleMeasure` 开头早退 `if (!state.heightReport) return`；② `mountComposerEditor` 里 heightReport===false 不注册 ResizeObserver；③ 三处注释改一致表述。
- **旧链护栏（check r5 补）**：闸门以 `heightReport` 为条件——宏链经 `ComposerInputWebView` **不传该参数 → 取默认 true**，本改动对旧包行为零变化（全仓唯一 `heightReport:false` 调用点是合成包 `main.ts:63-64`）；本条与 cr1-P2-7 同属对旧包 editor.ts 函数体的超口径触碰（spec:249 原限定「仅两处装配函数加可选参数」），K 节回填口径放宽。
- 验收/测试：factory 测试断言 heightReport:false 时连续输入 N 次不产生 rAF 回调 / RO 未 observe；**回归闸门——旧包 dist 契约测（composer-input-bridge/composer-input-dom 族）全绿 + 宏链（PromptMacroTextInput）真机输入高度上报正常（Step 10 抽查）**。
- 来源：cr-r6-perf-sec

### r6-I-1 [P2] composer-dock 能力缺失的降级提示零打点
- 维度：I
- 文件：`src/components/chat/ChatConversationWebView.tsx:1465-1471,2094-2102`、`chat-transcript-telemetry.ts`（事件类型）
- 问题：`setComposerDockCapable(false)` 渲染「输入组件版本过低」但无任何 telemetry/timingLog——线上出现输入框不见时无法归因（旧 dist？能力位没带？ready 没来？）。
- 改法：ready 分支里 `conversationCapabilitiesInclude(..., CONVERSATION_CAP_COMPOSER_DOCK)` 为 false 时打 `emitChatTranscriptTelemetry({name:'composer_dock_degraded'})`（或最低限度 bootTimingLog + capabilities 长度）；事件联合类型加一支。
- 验收/测试：bridge/host 测试「ready 不带能力位 → 上报一次」；变异——去打点必红。
- 来源：cr-r6-perf-sec

### r6-I-2 [P2] 粘贴链路三处静默：读失败吞异常、空串零反馈、无长度上限
- 维度：I
- 文件：`src/components/chat/ChatConversationWebView.tsx:1636-1651`
- 问题：`Clipboard.getString().catch(() => undefined)` 吞失败；text==='' 静默 return；剪贴板全文无上限 JSON.stringify 跨桥（5MB 剪贴板 = 5MB postMessage）。
- 改法：catch 打 `console.warn('[chat] composerPaste clipboard read failed')`（无敏感内容）；空串同样打；长度上限（如 256KB）超限截断+打点——或明确记 spec 风险表「不做上限」附理由（**该 spec 侧动作由 backfill 节点承担——sc-r3 补注**）。**与 r6-D-1 同函数，编排合一或串行。**
- 验收/测试：mock Clipboard 抛错 → warn 被调用且不 postToWeb。
- 来源：cr-r6-perf-sec

### r6-C2 [P2] 死模块：composer-dock-padding.ts 生产侧零消费
- 维度：C
- 文件：`src/components/chat/composer-dock-padding.ts:6`（+ 其 test）
- 问题：唯一生产消费方是被删的 ChatComposer；web 侧 dock.ts:52-58 已用 resolveDockBottomPadding 独立实现同公式，两者无约束关系。
- 改法：删除模块+测试；或保留时注释写明「RN 侧历史口径，web 已独立实现，需人工保持一致」。
- 验收/测试：全仓 grep 仅剩零/测试一处（**dock.ts:41 注释里对 `composerDockBottomPadding(...)` 的引用由 dock 节点清理（sc-r2/r6-C2 条目侧补注）——本条节点只动死模块本体与测试**）；单测绿。
- 来源：cr-r6-coupling（coupling-r6-2）

### r6-C3 [P2] 死代码：chat-list-scroll-cache v1 读写面随 MessageList 删除全悬空
- 维度：C
- 文件：`src/services/chat-list-scroll-cache.ts:2,17,23,30`（+ `scope-cache-lru-bound.test.ts` 两条 + `use-chat-tab-scope-batch-delete.test.ts` 8 处引用——sc-r1 补进文件栏）
- 问题：getScrollSnapshot/setScrollSnapshot/clearScrollSnapshot 零生产消费方（文件头自述「survives MessageList remount」——那个 remount 已不存在）。
- 改法：删三个导出及对应测试两条；`use-chat-tab-scope-batch-delete.test.ts` 的引用**切到 v2 缓存 `chat-transcript-scroll-cache.ts` 的 `get/setTranscriptScrollSnapshot`**（同 scrollCacheKey 体系——sc-r1 明确切法，勿在同名 v1 API 里打转）；文件头注释更新。
- 验收/测试：全量单测绿；两个测试文件改后无 v1 引用。
- 来源：cr-r6-coupling（coupling-r6-3）；spec-check r1 修订

### r6-C4 [P2] C-orch：统一宿主反向 import 旧转录宿主组件模块
- 维度：C-orch
- 文件：`src/components/chat/ChatConversationWebView.tsx:93`
- 问题：`import {planSnapshotChunkBounds} from './ChatTranscriptWebView'`——新链挂在旧链宿主组件上，旧组件任何重构/删除都会打断新链。
- 改法：把 planSnapshotChunkBounds 迁到无宿主纯模块（如 `src/components/chat/snapshot-chunk-bounds.ts`），两宿主各自 import，旧组件 re-export 保兼容；snapshot-bytes 测试改 import。
- 验收/测试：`grep "from './ChatTranscriptWebView'" ChatConversationWebView.tsx` 为空；测试绿。
- 来源：cr-r6-coupling（coupling-r6-4）

### r6-C7 [P2] 死别名：ChatConversationWebViewPropsChips
- 维度：C
- 文件：`src/components/chat/ChatConversationWebView.tsx:234-237`
- 问题：`type X = ConversationComposerState['chips'] | undefined` 纯重命名，注释称「为 memo 可读性」但 memo 段根本不用此名。
- 改法：删别名，props 直接写原类型。
- 验收/测试：tsc 绿。
- 来源：cr-r6-coupling（coupling-r6-7）

### r6-C8 [P2] wdio.shared.conf.ts 缩进破坏（未提交改动内）
- 维度：C（风格）
- 文件：`apps/mobile/e2e/wdio.shared.conf.ts:33-43`
- 问题：noReset/forceAppLaunch 两段 11 行被改成 4 空格，同函数其余 2 空格；文件尾无换行。prettier/lint 会红。
- 改法：改回 2 空格 + 补尾换行；顺带在注释补一句「forceAppLaunch 是 terminate+activate，不碰应用数据，与 noReset 红线不冲突」。
- 验收/测试：`npx prettier --check` 绿。
- 来源：cr-r6-coupling/coupling + cr-r6-logic-tests 双报

### r6-G1 [P2] T-CU12 第三个 it 断言偏弱（可能被上一 it 残留满足）
- 维度：G
- 文件：`apps/mobile/e2e/specs/chat.conversation-webview.e2e.ts:53-59`
- 问题：三 it 共享 WebView 上下文不重置；`countMessages() >= 1` 可能被初始快照行数满足——「web 内发送真的发出去了」没牙齿。
- 改法：发送前记 `const before = await countMessages()`，断言 `after > before`（不依赖文案渲染形态）。
- 验收/测试：实跑绿 + 反向验证（临时 no-op composer-send 必红）。
- 来源：cr-r6-logic-tests（cr2-5）

### r6-G2 [P2] app.page.ts 热区坐标与 header 高度耦合（注释债）
- 维度：G
- 文件：`apps/mobile/e2e/pageobjects/app.page.ts:147-163`
- 问题：0.81/0.09 魔法数已注释来由，但 0.09 与抽屉 header 高度耦合（APP_HEADER_CONTENT_HEIGHT 一变即落入内容区）；坐标级 workaround 比 click 脆弱。
- 改法：不改坐标策略；把 0.8/0.81/0.09 抽成命名常量 + 注释补「与 header 高度耦合，改 APP_HEADER_CONTENT_HEIGHT 须同步」+ 失败时诊断路径（dump 抽屉 UI 判遮罩 bounds）。
- 验收/测试：三条相关 spec 实跑绿。
- 来源：cr-r6-logic-tests（cr2-6）

### r6-G3 [P2] readToastMessage 时序与空串（E1 失败根因认定：测试问题非产品 bug）
- 维度：G
- 文件：`apps/mobile/e2e/pageobjects/vfs.page.ts:68-73`（sc-r1 行号修订）
- 问题：r6 实证 VFS 重名链路正确（ToolError 解包 → formatVfsErrorForUser → 「名称不能重复」），E1 失败根因=①toast 被上一动作残留覆盖（TOAST_MS=2500 vs pause 600）②`~toast-message` 选择器同 vfs 坑。认定**测试断言错，不是存量产品 bug**。
- 改法：readToastMessage 的 waitForDisplayed 后立即 getText 并断言非空（空则 throw「toast 读空」）；选择器已随 vfs.page resourceId 化修复（toast-message 的 byTestId 已含在本批未提交修改中）。
- 验收/测试：E1 实跑绿。
- 来源：cr-r6-logic-tests（cr2-7 认定结论）

### r6-ENV1 [P2] UiAutomator2 版本浮动 + teardown 断连异常污染结果
- 维度：G（环境）
- 文件：`apps/mobile/e2e/scripts/ensure-appium-driver.mjs`、`wdio.shared.conf.ts`
- 问题：driver 版本未显式钉（package.json appium ^2.18 + ensure 脚本装浮动版）；每 spec teardown 时 disconnect DeadObjectException crash——不影响断言但疑似与「跨 spec UI 集体失效」相关（r6 排障：force-stop 冷启动恢复）。
- 改法：① ensure-appium-driver.mjs 显式钉 uiautomator2 版本（现 3.9.4 可钉死，升级另试）；② onPrepare/onComplete 加 try/catch 吞断连期异常，避免绿 spec 被标红。
- 验收/测试：全量两轮 spec 结束无 FATAL 刷屏。
- 来源：cr-r6-logic-tests（e2e 遗留②认定）

### r6-K1 [P2] K 节回填与文档同步收编（sc-r1 新增——避免 6 项 K 节动作无节点承载）
- 维度：K（收尾）
- 文件：`docs/Iterations/chat-webview-unify/spec.md`、`apps/mobile/README.md`、dev-loop `cache/context-bundle.md`
- 问题：K 节六项动作（Q1/Q2/Q3 回填、README 三包→五包+:143、context-bundle 性能基线标注、体积数字回填、E 维度排期交付物、G 节两条硬约束）不在 30 条 must-fix 内——按「读 Must-fix 拆节点」的投递契约会无人执行。
- 改法：单列 `fix-cr-spec-backfill` 节点（所有改码节点之后跑，与各条目的 spec.md 回填动作合并——见分组总则；**不在独立可并行组——sc-r2 修正**），逐项完成 K 节清单。
- 验收/测试：K 节清单逐项对照 spec.md/README diff 自查闭合；**三项条件性条目（r6-A1 方案 B 回填 / Q4 基线标注 / Q4 时 E 维交付物）条件未触发时标 N/A 并记录触发条件——sc-r2 补**。
- 来源：spec-check r1（P1-G）

## Spec deviations
- ~~open：typeahead 候选源刷新触发面缺失~~ → **已承接**：r6-A1 升 must-fix（P1）承接，方案 A/B 由执行者探明事件存在性后择一；方案 B 涉及 spec 收窄需用户确认。
- 其余维度 none（三路一致：固化架构裁决全部落地无偏离；es2018 零违反；Q4 性能基线仍属 spec 自身前置，归业务遗留）。

## Open questions / 待拍板
- **OQ-A（wave-4 契约）**：~~composerState.typeahead 必达~~ **已落地**（ChatConversationBridge.ts:145 去 ?、:949 生产必达、:149 空源常量）——r6 实证 closed。
- **OQ-B（双写真源）**：dock renderInput 与 composer runtime applyDisabled 仍双写 readOnly/placeholder（r6 补证：init.composer.disabled 路径与真源同值、暂无害；若裁定 init 不带 disabled，需同步评估 editor.ts applyDisabled 在 chat 链的消费方）——待拍板；**r6-D-1 的闸门与收敛方向一致但本轮不闭合双写**，留待 OQ-B 拍板后统一处置。
- **OQ-C（候选源）**：controller 已用 useMemo+引用复用+内容比对（sameAtPathRefs/sameSkills），**每键全量跨桥的性能风险已消除**（打字不进 composerState）——性能侧 closed；剩余「是否拆独立下行 type」降级为可选；**刷新触发面缺口已升 must-fix r6-A1**。
- **OQ-D（丢弃零信号）**：建议就此定案——web 侧零打点为设计内（chat-conversation 全包 console.* 零命中，r6 grep 实证），8s 兜底是唯一缓解；cr1-P1-1 的装配失败 console.error 已覆盖最关键路径。写入「已裁决」除非用户推翻。
- **OQ-E（存量 ES2021+）**：维持待拍板（存量 82 处，新包零新增）。
- **OQ-F（r6 新）**：iOS 划词「全选」用 Selection.selectAll（Blink 非标准）——WKWebView 大概率静默无效；需 iOS 真机确认，退化方案 document.execCommand('selectAll') / Range.selectNodeContents。
- **OQ-G（r6 新）**：宽松 decoder 只兜数组形状不兜元素（files/skills 混 null 时 typeahead.ts:73 会抛）——载荷来自自家 RN 风险低，是否逐元素过滤待拍板。
- **OQ-H（r6 新）**：conversationDockCapable 降级横幅渲染在 WebView 上方（styles.degrade 与 dock 位置无关联）——单 WebView 下该横幅是否多余属产品判断。
- **OQ-I（r6 新，挂账）**：ChatConversationWebView.tsx 拆分——cr-r6-coupling 判断**本迭代不拆**（IME 七防线+四消息恢复链的正确性依赖全序一眼可见；作者已抽 7 个模块级纯函数，剩余 hooks 留组件内是有意的）；留挂账下迭代评估。

## 业务 spec 遗留待拍板（不由本 fix-spec 闭合）
- Q1 legacy-rn 退役——**已拍板退役并执行**（dc4c903b）；spec 回填动作在 K 节。
- Q2/Q3——视同接受 spec 推荐默认；spec.md 回填「已确认」在 K 节。
- Q4 性能基线采集窗口待排期；未闭合前性能验收「记录不判定」。

## 已豁免（用户确认不修）
（无）

## 合并后 QA（manual_user，不阻塞 fix-spec-ready）
- 截图对比：「运行中 / 未选模型」两态**输入区不淡出**（cr1-P1-3）。
- 截图对比：「typeahead 展开态」vs 现网流内推挤（cr1-P2-8 + P1-5 修订后五项无真源样式一并截图承担）。
- 一次性验证：临时删 `#composer-dock` 构建 → ~8s 落宿主错误态（cr1-P1-1）。
- 性能读数对比基线（Q4 排期联动）。

## K 节建议（下游执行时闭合）
- spec.md 的 Q1/Q2/Q3 回填（Q1 已执行退役、Q2/Q3 视同默认）。
- **spec「五处注册点」补第六处**（Android checkWebViewAssets——cr1-P1-2 的 spec 侧根因；**spec 侧编辑由 backfill 节点承担，P1-2 改码节点只动 build.gradle——sc-r2 修订**）。
- spec Step 4 chips 措辞修正（maxHeight:36 是基底）+ 风险表/Step 10 补 typeahead 视觉差异。
- **spec §合成 dispatcher 契约第 4 条补**（cr1-P1-1 契约同步：装配未成功不发 ready）；划词菜单补「paste 门控与 inputDisabled 同口径」一句（r6-D-1 契约同步）。
- **spec.md:112 路由表同步**（cr1-P2-1/r6-C5：stickIfNearBottom 从清单移除后路由表同步删行——check r5 补）。
- **spec.md:217 + 风险表:322 口径回填**（r6-C4：旧宿主 ChatTranscriptWebView 新增 re-export 一处触碰，零改动红线表述同步——check r5 补）。
- **spec.md:249 旧 runtime 触碰口径放宽**（cr1-P2-7 + r6-E-2：旧包 editor.ts 新增三处函数体触碰——applyText 事件派发 / scheduleMeasure 闸门 / RO 条件注册；「仅两处装配函数加可选参数」表述同步放宽并注明行为等价护栏——check r5 补）。
- r6-A1 若走方案 B：spec.md:99 措辞改「进会话拉一次」+ 风险表记陈旧度。
- README「三包 WebView」→ 五包（README.md:170）；**README.md:143 的 legacy-rn/MessageList 描述同步删改**（r6 新发现）；**README.md:237-239 架构段**仍写「对话页用 ChatTranscriptWebView + Composer stay in RN」与单 WebView 现状冲突，同步改写（sc-r1 补）。
- **r6-I-1 的 `composer_dock_degraded` 遥测事件为可观测面新增**——在 spec 可观测性清单补一行口径（sc-r1 补）。
- dev-loop context-bundle 性能基线 spec_deviation 标注 `closed-by-cr-fix-spec(Q4 排期联动)`。
- e2e 备注更新：~~wave-6b 前不跑全量~~ 已过时——e2e 已实跑（**T-CU12 绿但第三个 it 断言偏弱，见 r6-G1**；全量 6 条中 2 条绿，4 条余量为存量 spec 健壮性），forceAppLaunch 已加；余量见 r6-G1/G2/G3/ENV1。
- spec 风险表体积数字回填（app.js 8,912,795B：对两包之和 +23,432B/+0.26%、对 transcript 单包 +46,072B/+0.52%，写明双口径；CSS +7,093B）。
- OQ-C 处置改写（从「拆独立 type」改为「引用复用已消除每键跨桥 + 刷新触发面升 r6-A1」）。
- E 维度排期交付物（Q4 时）：①一次击键 renderTypeahead 次数（r6-E-1 改后应恒 1）②大工作区 input→浮层长任务占比 ③退出时 WebView PSS/JS heap ④候选源双份内存。
- 维度清单 G 节两条硬约束（关键组合不变量必须有行为测试/dist 字符串比对不算断言/关键不变量须附变异证据）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes + 执行完毕**（sc-r3 Go → 用户确认 → fix-cr 三波 11 节点执行：wave-1 八节点并行 + wave-2 两节点 + wave-3 backfill；31 条中 **30 条闭合**、r6-A1 待用户拍板） |
| fix_spec_path | docs/Iterations/chat-webview-unify/cr-fix-spec.md |
| cr_dag_version / cr_round | 9 / 2（r6 full 三路 + check r5/r6 + spec-check r1/r2/r3） |
| 执行提交链（worktree feat/chat-webview-unify） | 9eece8a0(dock) / defe2200(dispatcher-model) / ee5d84fc(editor-factory) / dbd5e0c1(webview-host) / 4b6ea664(android-guard，**merge 必堵项①闭合**) / 5ebfa066(typeahead) / 2100c11a(dead-code) / 851068e3(e2e) / 2a870a73(boot-script，**merge 必堵项②置灰闭合**) / 5af4d42e(entry-test) / 08fb5af9(README backfill) |
| 执行后验证 | 全量 mobile jest **1869/1870 绿**（1 失败=chat-transcript-webview T-S2 分片时序用例，单跑 40/40 绿，判定既有时序敏感偶发非本批引入）；tsc 三面绿；e2e T-CU12 实机**正文 3/3 绿**（after 自清挂=设备项目堆积长尾，见下） |
| 未闭合 | **r6-A1**：探路结论=方案 B（用户侧 VFS 写链零事件发布 + core 架构决议不挂写路径钩子 + mobile 零订阅基建）——spec.md:99 收窄措辞**待用户确认后回填**；e2e after 自清（deleteProjectViaDrawer 在项目堆积设备上的长尾）不阻塞代码验证 |
| P0 / P1 / P2 | 0 / 8 / 23（全部已执行；净待执行=0，r6-A1 除外） |
| spec_deviations | r6-A1 承接中（方案 B 待确认）；其余 none |
| C-orch | ✅ |
| C 类合并后 QA | 截图两项（typeahead 展开态含五项无真源样式）+ 一次性 8s 兜底验证 + 性能读数（Q4 联动），不阻塞 |
