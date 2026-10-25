# 2026-10-17 mobile 两项体验优化头脑风暴（composer typeahead 移除 × 文件预览白闪）

## 类型与定位
- 类型：**brainstorm**（答疑/方向探讨，未立项、未改代码）
- 两个子代理并行 readonly 探索，报告已汇总给用户；本文件记结论与待拍板项

## 用户问题
- user: 「mobile输入框的skill搜索能力移除，现在已经不支持手动输入skill与文件引用了，那skill搜索文件搜索存在意义也没有了，存在反而影响交互体验」
- user: 「进入文件预览时，由于webview初始化，导致在黑夜模式下会出现'闪光灯'那种突变情况」

## 结论一：composer typeahead（@ 文件 / $ 技能联想）移除评估
- 触发字符是 `@` 与 `$`（非 `/`）；浮层在 `NativeChatComposer.tsx`（testID `composer-typeahead`），纯函数在 `native-composer/typeahead-view.ts`，候选源 effect 在 `useChatComposerController.ts`。
- **用户前提与代码事实有出入（关键）**：「不支持手动输入 skill 与文件引用」只成立于**视觉层**——2026-10-07 QA 拍板「胶囊确认制」（commit 5dc15801e）后手输 `@x`/`$x` 不再即时成胶囊；但**数据面仍完整支持**：发送时 core `run-agent-turn.ts:663-667` 仍扫描手输 token 落附件，发送门闩也计入。且 typeahead 本身功能完好（选中→插入引用 token+胶囊+发送挂附件，有测试锁定），不是残废件。
- 原始设计意图是「手输+按钮双入口」刻意双轨（`agent-skills/prd.md`、`message-attachment-unified/prd.md`）。
- 波及面：桌面端独立实现零影响；core 纯函数（`findActiveAtQuery` 等）桌面+全屏共用**不可删**；全屏编辑屏 `PromptEditorScreen` 是第二消费面（`AtPathTypeahead/SkillTypeahead/TypeaheadList` + `skill-typeahead-filter.ts` 仍被它用）；无配置开关；测试引用面清单在探索报告（T-NC8、typeahead-view.test.ts 整文件、controller 候选源 describe 等）。
- 保留红线：`insertSkillToken`/`insertTokensIntoComposer`/`buildTokenInsertion`（Picker 按钮入口共用）、两个 Picker 模态。
- 待用户拍板：①接受「移除后手输 @/$ 无反馈但发送仍静默挂附件」吗（若要连数据面也禁，须动 core 扫描且桌面同损，另一量级变更）；②范围是否含全屏编辑屏。

## 2026-10-17 深夜补充轮：用户两次纠正 + 「插入后浮层」机制实锤
- user 纠正一（§21）：他说的不是输入框打字触发的联想，而是**点击引用按钮 → picker 选 skill → 胶囊已插入输入框 → 此时弹出的联想浮层**；并质疑「打 @/$ 无反馈」之说（用户视角 UI 本就不支持手输）。
- **机制链实锤（readonly 探索，agent_c8ddcd9a）**：`insertSkillToken` 生成 `token+尾空格`、光标落尾空格后（`composer-token-insert.ts:29-53`）→ `commitExternalText` 下发 → **库原生 md4c 把段尾空格剥掉**（`InputParser.kt:24-55`，wasm 实测 `'[$X](nmskill://X) '` AST 无尾空格）→ 原生 `setValueFromJS` 内 `setSelection(text.length)` 把光标钳到 token 尾、JS 后发 setSelection 再被 Manager 钳位 → 选区事件晚一拍回传覆盖镜像 → `findActiveAtQuery('$X ', 2)` 纯字面判定=「活跃查询」→ 浮层弹出，**列的正是刚插入的那条技能**。判定完全不看 confirmed/tokenRanges。次路径：插入点后是空白时光标直接落 token 尾，首帧即弹。
- 定性：**2026-07 bug 在 native 链路复发**——当年 web dock 已修「选择器确认后 typeahead 关闭」（`message-attachment-unified/bugs/composer-ops-label-picker-typeahead/`，修法=补尾空格+整段替换），RN 重写逐字搬纯函数语义但原生剥空格+钳光标把修复吃掉。无测试锁定「插入后浮层」行为（jest mock 无原生钳位，复现不了）。
- 浮层交互缺陷：无关闭按钮、不接 BackHandler（`useAndroidChatBackHandler.ts:84-127` 无此态）、点外不关——只能打空格/删触发符/挪光标才收。
- 手输现状精确口径：打 `$`/`@`（行首/空白后）**浮层会弹**，选中=手输唯一落确认胶囊的方式；不打空格关闭则不成胶囊但发送仍挂附件。
- 两条路线：**A1** 最小修复=confirmed 区间纳入判据（`computeTypeaheadView` 加 `confirmedRanges` 参数，触发符落在确认区间内则不弹；勿用 `scanTokensToRanges` 正则扫，会废掉手输 typeahead）；**B** 整体移除主输入框 typeahead（清单：NativeChatComposer 浮层 JSX 760-812/镜像 state、typeahead-view.ts 整文件、controller typeahead memo+候选源 effect+state.typeahead、ChatConversationBridge 类型、dock-style composerTypeaheadStyles、panel props、测试 typeahead-view.test.ts 整删+T-NC8/T-NC10/集成/控制器用例改）。红线不变（core 纯函数/insert 链/两个 Picker/全屏编辑屏独立链）；B 需问全屏编辑屏是否一并移除（parity 纪律 #19）。
- 遗留：真机复现未做（建议一次）；同根次级症状两个待 QA（插入后尾空格在原生 buffer 不存活→继续打字空格消失；typeahead 行点选后浮层不关=2026-07 原始症状）；仓库根 8 个 0 字节未跟踪杂物（2 个为本轮探索 cmd 引号事故：`$null`、`JSON.stringify(JSON.parse(p(s`；6 个更早）待清理。

## 2026-10-17 深夜第二轮：用户拍板 + 进入 spec-generate
- user 拍板：①typeahead 联想浮层**整体移除，且全屏编辑屏（PromptEditorScreen）一同移除**（路线 b 扩面）；②文件预览白闪走 **A+B 组合**（WebView style 主题底色 + injectedJavaScriptBeforeContentLoaded 预注入 --bg）。
- 进入 spec-generate 阶段；**需求来源=用户口述**（无标准 prd，brain-storm 三轮调研为依据）；迭代目录定为 `docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/`。
- 目标：产出可确认 spec.md（两组 phase：typeahead 移除含全屏编辑屏 / 白闪 A+B）。
- spec 补派探索两路：全屏编辑屏 typeahead 链完整移除面（含「全屏编辑是否有 picker 按钮替代入口」产品事实）；白闪 A+B 文件级落点（主题 token 取值防 #17 颜色陷阱、注入脚本与 applyHostTheme 关系、验收探针）。

## 2026-10-17 深夜第三轮：spec 已落盘待确认
- spec-generate 流程完成：两轮补充探索（全屏编辑屏移除面 agent_811071e2 / 白闪 A+B 落点 agent_2054eab9）→ prd + spec 落 `docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/`（prd.md 用户口述来源；spec.md 两组 phase：typeahead-remove Step1-4 / preview-flash Step5-8）。
- 探索补齐关键事实：全屏编辑屏有 @/$ 按钮+FileReferencePicker/SkillPicker 替代入口（保留红线，用户现行工作流）；`skill-typeahead-filter.ts` 两链删后可同批整删；A 底色必须 `tokens.background`（暗色 #000000，THEME_VARS 真源，勿用 surface #1C1C1E——RULE #17）；B 注入全仓 0 冲突、只注 --bg、Android onPageStarted 时机弱于 iOS 需 null 防护；CodeEditorWebView 同构列为建议项 Step7；两 prop 均不动 src/web/**、无需 build:webview。
- 待用户确认 spec.md；确认后走实现（worktree 分支）。

## 2026-10-17 深夜第四轮：code-dev-loop dev-ready
- worktree `D:\worktree\taf`（分支 feat/taf-preview-flash，base main@615dda436）三 impl 并行一波完成、verify 全绿、cr-func func-ready——**dev-ready**，HEAD `6a262ad52`（三提交：a705fc467 主链 +67/−920 / d42361231 编辑屏链 +48/−477 / 6a262ad52 白闪 A+B +133/−3）。
- verify：jest 250/250 套件、1957/1957 用例（--maxWorkers=2）+ typecheck 三趟全过；blocking id T-TR1..5/T-PF1..3 全落位；零 must-fix。5 项合理偏离全 closed（锚定死代码随删、canTypeahead→canOpenPicker 改名、mockRuntime 收窄等），详见迭代 cache/dag-state.yaml。
- **待用户真机验收**（manual_user）：Step 4 picker 插入→打字→发送整链（两屏）；Step 8 暗色进预览录屏无白闪（CodeEditorWebView 同构已顺带完成，Step 7）。未 merge、未动主仓工作区代码。
- 经验：并行三 impl 同 worktree 写不同文件面 + 主代理分组提交，零冲突；verify 门禁环境前置再次踩中记忆 #21（pretest 不含 driver dist + build:webview:native）。

## 2026-10-17 深夜第五轮：debug 包装上真机，待用户验收
- debug 变体安装到真机 DSLDU20407006179（用户要求 debug：性能差白窗长更好复现；保证 metro 不被另一会话占用）。BUILD SUCCESSFUL 7m20s，metro（worktree 树）后台长驻，adb reverse + 冷启动后 bundle 2914/2914 加载完成。
- 踩坑已记全局 CONSTRAINTS：metro FallbackWatcher 被 gradle 构建的 .cxx 临时目录变更误杀（ENOENT 崩溃）——先构建后起 metro；后台 Bash 任务须显式 cd。
- 待用户真机验收 Step 4（picker 链，两屏）/ Step 8（暗色白闪录屏）。验收期间勿在 taf worktree 再跑 gradle（会再杀 metro，杀了重启即可）。

## 结论二：文件预览暗色白闪根因与修复方向
- 根因=**两层白窗叠加**：①`RichDocumentWebView` WebView/wrapper 均未设底色 → 冷挂载露 Android WebView 原生白底（chat 屏 2026-10-02 commit 407c9a221 已修同款、rich-document 漏了）；②页面 CSS `document.css` 兜底 `var(--bg, #fff)`，而主题要等 web 侧 `ready`→RN 下发 `init`→`applyHostTheme` 才注入（app.js 解析完才 ready，rich-document 包最大含 mermaid/Recogito）。暗色下即「先白后黑」。
- 为什么预览屏最痛：`FileEditorScreen` push 屏随进随建随退随毁（且 `key={path}`），白窗每次全付；chat WebView 常驻+已有防线。
- 修复方向：A=WebView style 加主题底色（照抄 ChatConversationWebView:1849 先例，堵原生白窗）；B=`injectedJavaScriptBeforeContentLoaded` 预注入 `--bg`（堵 CSS 白窗，RN 单文件）；C=透明底模式（composer 先例，需 web 重建+回归）；D=遮罩（不推荐）。建议 A+B 组合真机验证。
- 注意：80ms 延迟挂载（964c098ae）与 `key={path}` 是既有取舍别碰坏；「退出预览返回闪白」是另一条链（chat-webview-unify cr2-G-1 P2 未验证）；`CodeEditorWebView` 同族无防御风险。
