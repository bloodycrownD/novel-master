---
date: 2026-08-21 00:30
title: v1.5.1 已发版：chat-improvements 全量合入 main，tag 已推 CI 构建中
keywords: 发版, v1.5.1, publish, semver, 前导零, chat-improvements-integration
abstract: feat/chat-improvements-integration 全部内容（四迭代+CR 修复 16 条+changelog）合入 main 并打 v1.5.1 tag 推送，CI 构建中。另查明 1.5.01 失败原因：semver 禁止 patch 前导零，CI 的 npm version 会挂；1.4.0x 是史前版本从未走过这条链路。
---

user:
mermaid 渲染成功，但希望文件预览里点击图表能全屏查看并支持放大（手机看不方便）；聊天记录查询页太丑，想改成可折叠卡片式表单（参考智能体配置），表单可折叠收起，下方展示消息，长消息折叠、点击展开。另外希望清理 10 个 tag 以前的 migration 代码，也探索下。

assistant:
三个并行探索子代理的结论：

**mermaid 全屏**：WebView→RN 的 postMessage 桥健全（shared/post.ts + RichDocumentWebView.tsx 已收 ready/recogitoCreate/annotateOpen 三种消息，加 mermaidTap 类型即通）；全屏 Modal 样板有（UpdateCheckResultModal/AppModal），chat-transcript 有 WebView 内覆盖层样板（#menu-portal + MenuOverlay）；但全 app 无任何 pinch/gesture-handler 先例，双指缩放是从零到一。推荐 WebView 内覆盖层 + touch 事件 pinch（不回传 RN，SVG 本来就只能在 WebView 生成）。desktop 无 lightbox 先例。待澄清：范围（预览 only 还是聊天气泡也要）、交互细节（双击/拖拽/关闭方式）。

**查询页重设计**：mobile 长消息折叠已实现（MessageResultCard 200 字/4 行截断+点击展开）——用户可能不知道；真正缺的是可折叠表单（当前固定 header 常驻）。「智能体配置」FormSectionCard 是静态卡片不可折叠，可折叠先例是 PromptPreviewSegmentCard（▶/▼ 无动画）。desktop 复用 MessageList 被 session-detail-drawer.test.ts 源码正则锁死、无折叠。测试红线：T-MO3 依赖表单 testID 直查（表单默认收起且不渲染输入框会挂）、FlatList/onEndReached 结构、result-card onPress。待澄清：范围双端还是 mobile、默认态与查询后自动收起、动画。

**migration 清理**：已经做过了——docs/Iterations/event-config-merge-and-migration-cleanup 在 v1.4.22（ee030b2）清掉 6 条史前（≤v1.4.08）migration（出注册表、文件留作冷备份、加 assertMinimumBaseline fail-fast）。仓库总共只有 10 个 tag，现存 5 条 migration 全部在 10 tag 窗口内；再清就要把最低基线从 v1.4.08 抬到 v1.4.21+，且 session-agent-config-v2 这类数据迁移无法固化进 DDL。待澄清：是新清一轮抬基线还是确认现状；老库直升路径要不要保底。

状态：待用户拍板三个方向后走 PRD。

user:
拍板：①mermaid 全屏预览和聊天气泡都做；②查询页双端都做、不要动画；③migration 现状即可，10 个版本后再清。

assistant:
两篇 PRD 落盘主仓库 feat/chat-improvements-integration 分支：`docs/Iterations/mermaid-fullscreen-viewer/prd.md`（mobile 预览+聊天两入口，WebView 内覆盖层 + pinch/双击缩放 + 拖拽 + 三种关闭方式，失败态不可点，desktop 不做）与 `docs/Iterations/chat-search-collapsible-form/prd.md`（双端可折叠卡片表单，默认展开、查询成功后自动收起、收起态摘要，desktop 补长消息折叠，无动画，mobile 折叠行为保持）。migration 不动代码，约定 10 个版本后再清。待用户确认 PRD 后走 spec。

user:
spec。

assistant:
两个探索子代理补齐实现级细节后，两份 spec 落盘：
- **mermaid-fullscreen-viewer/spec.md**：共享模块 `web/shared/mermaid-fullscreen/`（runtime+Preact 组件+样式），document 级事件委托 `closest('.mermaid-block__chart')`（失败态天然不匹配），克隆 SVG 不动原图；手势纯函数放 webview-host（照 menu-overlay-guards 样板 Jest 直测），手势中写 transform 不 setState；返回键照 menuOpened/Closed 对称消息模式（chat 接 useAndroidChatBackHandler、rich 在组件内自注册判 isFocused）。红线：不动 snapshot.ts 5 处调用、stream.ts 不得出现 mermaid 字样、mermaid-core 既有语句不删。Step 1-7，T-MF1-6。
- **chat-search-collapsible-form/spec.md**：mobile 收起采「卸载输入框」方案，**T-MO3 翻页用例需同步适配**（改输入前先点卡片头展开）——这是探索发现的最大冲突点；自动收起条件必须带 `batch.length > 0`（现状空结果也算成功）；RN mock 需补 Keyboard。desktop MessageList 加默认关闭的 collapsibleMessageBody prop（ConversationPanel 零感知），line-clamp 无先例可新写；三个源码正则锁定字符串保留即过。Step 1-5，T-CF1-6。
状态：两份 spec 待用户确认后走实现。

user:
开发吧（code-dev-loop）。

assistant:
DAG 收敛完成（dag_version 2，wave-0 双 impl 并行 → not-ready 插 fix 补 chat 返回键接线 → wave-2 双 verify → wave-3 双 cr-func，均 func-ready、无 must-fix）：
- **mermaid 全屏**（8 笔）：手势纯函数（pinch 1x~6x clamp、双击 300ms 防抖、pan 以视口为基准）→ 共享三件套 web/shared/mermaid-fullscreen（事件委托+克隆 SVG+transform 不 setState）→ 两管线 portal 接线 → Android 返回键（chat 接 dismissAllOverlays 并入、rich 自注册判 isFocused；fix 节点补上 Provider→Panel→Screen 接线，7fcd0d8）→ 样式独立占位 __MERMAID_FULLSCREEN_CSS__ 注入两包。验证：mermaid-fullscreen 12/12、mermaid-webview 9/9 红线全绿、menu 系 25/25、typecheck 干净；三条红线（snapshot 5 处/stream 无 mermaid/mermaid-core 零改）独立复核零触碰。范围外必要改动（均已判合理）：build-webview.mjs 泛化 loadWebModule、tsconfig exclude 照 shared/ui 先例、jest transform 白名单加 @react-navigation、三个既有测试补 mock。非阻塞观察：RichDocumentWebView 的 mermaidViewerOpenRef 若 WebView 被杀重建会残留 true（边缘场景，webReady 重置时顺带清 ref 可修）。
- **折叠表单**（3 笔）：mobile 折叠卡片（deriveFilterSummary 从 state 派生、收起条件 !append && batch.length > 0）；desktop filter-card（button+aria-expanded、T-CF5 显式 doesNotMatch(<details)）+ MessageList collapsibleMessageBody 默认 false 零感知。验证：mobile 13/13（T-CF1-4 + T-MO2/MO3/KB4 不破）、desktop 21/21、双端 typecheck 零错。
HEAD 7fcd0d8，剩余：mf Step7 真机 + cf Step5 双端手动验收；存量孤儿测试 use-chat-tab-message-actions-unhide 3 例仍失败（与本次无关）。

user:
查询表单被吐槽：placeholder 太长丑、seq 不是数字输入框视觉、应该像 agent 配置那样用嵌套卡片分区。

assistant:
UI 打磨落地（8004904）：双端表单展开态分「关键词」「编号区间」两小节（小节标题+hint，对齐配置页分区层次）；placeholder 全部缩短（输入关键词留空列出全部→关键词，起始/截止编号留空不限→从#/到#，「留空不限」语义移到节标题旁 hint）；desktop seq 输入换专用 __seq 类（窄宽、居中、tabular-nums 数字字体）并加 – 分隔符；mobile 本就有 keyboardType=numeric，两框间同样加 –。验证：mobile 13/13、desktop 17/17、双端 typecheck 干净。教训：edit_file 的 old_text 带下一条规则开头时 new_text 必须同样带回，否则会吃掉选择器（本次 shell.css toggles 被吃已及时修复）。

user:
RN 没有专用数字输入框吗？

assistant:
没有。RN TextInput 无 type 属性，keyboardType/inputMode 只管键盘样式不拦截输入，需 onChange 里自己止 /[^0-9]/g 过滤。

user:
另外发现 bug：聊天工作区目录规则配置表单怎么又有开关了？谁加的？

assistant:
git -S 全历史追踪：双端开关（mobile FormSwitchRow「规则启用」dir-rule-enabled-switch / desktop Switch）都来自 dc28290（v1.4.21 初始导入，2026-08-10），从未被移除过；blame 指到的 d3a8b17 只是键盘避让重构重排行。误会可能来自史前版本（仓库入库前）。

user:
移除开关；数字过滤也做；另外 write 工具创建文件/文件夹时目录规则默认启用。

assistant:
三件全部落地：①开关移除（9171e37）：双端表单删开关 UI 与 import，ruleEnabled state 保留、从加载/initial 原样流入保存链路（启停由文件管理菜单快捷开关负责，表单仅编辑规则内容）；测试无引用、双端 typecheck 过。②seq 数字过滤（fe3f94b）：双端四输入框 onChange 加 /[^0-9]/g。③write 工具默认规则（子代理，d8685b7~d207a4b）：BuiltinToolContext 加可选 workplace（Pick setDirRule/getDirRule）；vfs-tools 新 ensureDirRulesForNewPath（逐层祖先查无行才补、不覆盖已有 rule_off、try/catch 吞错）；write 取文件父目录链、fs mkdir 含目录自身；run-agent-turn 主/子 agent（子按 parentSessionId）注入；core 587/587 全绿。另：探索结论存 docs/apm/memory/20260820-write-default-dir-rule.md（子代理已提交）。注意：core 源码改动后双端测试前需重 build core dist。

user:
对本分支跑 CR（code-review-loop）。

assistant:
两轮收敛（wave-0 四个并行 scope 评审 → spec-fix 落盘 → review-full 终审）：P0=0、P1=3、P2=13。P1：core/B-1（write 编辑已有文件也回补祖先规则，超出「创建时」口径，需 write 前探测存在性）；desktop/A-1（富文本消息进 line-clamp 截断不可预期，spec 回退条款未落地，改回退不折叠）；desktop/C-orch-1（查询与加载更早竞态，旧 append 晚到拼接错乱，改按钮互斥+请求序号守卫）。P2 要点：返回键残留复位×2（ready 分支复位）、查询页收起态错误不可见、svgCache LRU、user_ops 链路补注入、listDirRules 批量化、injectCss 的 $ 展开坑、web tsconfig 门禁等。fix-spec：docs/Iterations/chat-improvements-cr/cr-fix-spec.md（b969f71），终审 fix-spec-ready yes；三处微调（B-2 补 service 透传步骤、A-2 成对校验、A-1 补实现注）已按 trivial 豁免直接落地。待用户确认后按 fix-spec 开修。

user:
修吧。

assistant:
16 条全部修复完成（四模块并行 fix 子代理，16 笔提交 8727ca6~6352ad9）：三 P1 全落地——B-1 write 前 vfs.read 探测已存在/探测失败均保守跳过补规则；A-1 富文本回退不折叠+实现注；C-orch-1 按钮互斥+requestSeqRef 序号守卫（旧响应全状态不落地）。P2 要点：listDirRules 批量求差（service 无参透传，正向偏离）、user_ops 链路补注入、返回键 ready 复位×2、错误恒显、svgCache LRU 150+失败 TTL 30s、injectCss 函数形式、annotate 泛型修复+web tsconfig 挂进门禁、不可达选择器删除、setDocument 序号防中间态建 Recogito、attach 幂等+开门成对校验。verify 跨包回归（core dist 重建后）：core 87/87、desktop 36/36、mobile 55/55、红线三项全过；cr-func 终检 16/16 落地、func-ready yes、两处合理偏离（竞态用例独立成 chat-search-race-guard.test.tsx 因双 react 副本需分进程隔离；listDirRules 无参化）。坑：desktop 真渲测试用根 node_modules 的 react-test-renderer（未声明传递依赖，转正需加 devDependencies）；desktop 全量测试本机 OOM 需分批；desktop 单测要传路径形式参数。剩余：合并后 QA 真机项（WebView 重建返回键、富文本视觉、流式定稿图表）。

user:
readonly scope 评审（节点 review-scope-mobile-rn，BASE 515da9d / HEAD dc16a99，维度 A+B+C+C-orch+G）：mobile 非 web src + __tests__，重点 session-renamed 事件链、mermaid 返回键 4 文件接线、开关移除、查询页折叠卡片。

assistant:
scope 评审结论 scope-ready yes（3 条 P2 must-fix，无 P0/P1）：①RichDocumentWebView 的 mermaidViewerOpenRef 在 WebView 被杀重建后永久残留 true——web 端 closeMermaidViewer 在 !_open 时直接 return 不回 mermaidViewerClosed，ref 无法自愈，该屏返回键永久被吞（cr-func 观察项升级 must-fix）；②chat 侧同根因对称问题：ChatTabProvider.mermaidViewerOpen state 同样残留，影响主界面返回键（本轮新发现）；两处修法对称：handleMessage 收到 ready 消息时复位 open 态（各一行）。③查询页翻页失败的错误提示渲染在收起态表单体内不可见。验证：session-detail/chat-history-search/FileMarkdownPreview 三测试文件 43/43 全绿，stream.ts mermaid 计数 0（红线守住），L449 批注注释保留，ruleEnabled 原样保存链路完好（加载 L104/保存 L117），session-renamed 链与 4 文件接线逐环一致，新增 listener 均带 sub.remove() 清理。cr-fix-spec 尚未创建，本轮结论可作其输入。

user:
之前发 1.5.01 失败说不允许这样的 tag，那 1.4.0x 怎么发出来的？行，发行吧。

assistant:
查证：仓库 tag 全量为 v1.4.21~v1.4.29 + v1.5.0，1.4.0x 是入库前史前版本、从未走过这条 git tag+CI 链路；1.5.01 挂在 semver 前导零校验（patch 段 01 非法），CI 的 npm version 步骤会报 Invalid version，规范写法是 1.5.1。按 publish checklist 发版 v1.5.1：CHANGELOG Unreleased→[1.5.1] 定稿；双端 package.json bump + build.gradle 默认 versionName 1.4.29→1.5.1；集成分支提交 21ffae7 后合入 main。过程中发现本地 main 落后 origin 一笔（1ac9f4c，v1.5.0 的 CI 修复：shared 转出口补 DEFAULT_SKILLS_INDEX_PREFIX），先合入再打 tag。tag v1.5.1 打在 be31c18，已推 tag+main，CI 构建中（Android APK + Win NSIS + macOS DMG 并行）。
