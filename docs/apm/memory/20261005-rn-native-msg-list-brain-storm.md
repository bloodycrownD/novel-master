---
date: 2026-10-12
title: RN 原生组件重写消息列表可行性调研（mermaid 原生渲染器 + rikkahub 参考 + 聊天页原生化逐项判定）
keywords: RN, Fabric, 原生组件, WebView 性能, 消息列表, RecyclerView, mermaid, 原生渲染器, chat-conversation, FlatList, rikkahub, Compose, JetBrains markdown, LazyColumn, 输入框 tag, 批注, 工具卡片, 架构
abstract: 七轮讨论 + 立项轮：①RN 自定义原生组件机制正统（Fabric，RN 0.85.3）；②mermaid 原生渲染器 2026 下半年有一批但均 0-9 星一个月新无生产级；③只出 Android 故只看 Kotlin/JVM 三候选；④气泡与页面是同一个 WebView（chat-conversation 单实例）；⑤rikkahub 参考：全原生 Compose 自绘 markdown、mermaid 留 WebView 岛；⑥只聊天页原生化逐项判定：划词不在聊天页、工具卡片/附件 chip/菜单原生都容易、输入框是硬骨头；⑦用户拍板输入框必须原生化且倾向改造现成方案——核实发现 Software Mansion **enriched-markdown** 全家桶（1132★、v1.1.1、仓库一岁、MIT、dev-pin RN 0.85、极活跃）：EnrichedMarkdownTextInput 原生富文本输入带内联 mention（indicator 触发/插入 API/原子删除/光标定位回调，对应本项目 @/$ tag+typeahead 全套）+ EnrichedMarkdownText 原生渲染（md4c/GFM/LaTeX/tree-sitter 高亮）+ react-native-streamdown 流式方案（remend 修残缺 markdown+worklets 离 JS 线程）——「自写渲染器+自写 Fabric EditText」降级为「集成+适配+补缺口」。输入框迭代 composer-native-2026-10 已完成并随 v1.5.41 发版。**立项轮（2026-10-12）**：msg 列表原生化立项（transcript-native-2026-10）——mermaid 按代码块处理不留 WebView 岛（聊天页纯原生、PoC 去掉最高风险项，vfs 预览侧 mermaid 照旧兜底）；子会话屏一起 RN 化（数据面本就共享 SessionStreamUnitManager 投影仅换渲染层，chat-transcript 包彻底退役）；范围外确认：宏链=智能体编辑器 DynamicBlocksCard/PromptLayoutSection、全屏编辑、vfs 编辑预览；**列表自研为设计核心**（当初选 webview 就因 FlatList 难用）；worktree 父目录改 D:\worktree；reference 仓库（enriched-markdown/rikkahub）已迁入主仓 .reference/。
---

user:
我有个问题哈，rn的能力是有限的，webview性能不好，那rn没提供自定义组件的方法吗？比如msg列表我分别用swifit和kotilin重写，然后让rn用不行吗？这样性能问题都能解决吧？

assistant:
RN 提供这条路且是正统玩法：内置组件本身就是原生视图，自定义走 Fabric native component（TS spec + codegen + Kotlin ViewManager，iOS 侧是 ObjC++/Swift）。项目里 llm-sse、tokenizer 原生模块已是同一工具链的模块半边。数据喂法要避开「整个列表当 props 全量序列化」，成熟做法是原生模块持数据（JSI）+ 命令通道推增量——形状与现有 transcript bridge 协议几乎一致，等于换对端。

能解决的是「JS/WebView 参与渲染」整类瓶颈（滚动/回收/布局全原生主线程，RecyclerView 是列表天花板，Telegram/iMessage 先例），但原生是天花板不是免死金牌，全量 notify 照样卡。代价三笔：①换掉渲染能力——markdown/代码高亮/mermaid/划词批注/工具卡片全要原生重写，mermaid 无靠谱原生渲染器仍需 WebView 岛，等于把 chat-webview-unify 的决策倒回去；②长期维护税——每个消息形态与交互 JS+Kotlin（将来 +Swift）多处同步演进；③现状只出 Android（ios 目录是脚手架残留），Swift 是将来上 iOS 才付的账。现实中间态：原生 RecyclerView 容器 + 简单消息原生渲染（Markwon 类）+ mermaid/复杂内容 WebView 岛。

建议动手前先做瓶颈归因：jank 若在列表渲染/滚动层则收益大，若在数据面/桥流量/WebView 合成层则药不对症。本轮只是答疑，未立项。

user:
mermaid 没有靠谱的原生渲染器？真的吗？你搜索看看？

assistant:
搜了并逐个 WebFetch 实地核实（教训：搜索摘要会幻觉——zread 对新仓库报 not found 也不可靠，WebFetch 直访 GitHub 才是准的）。修正前一轮的说法：纯原生渲染器**存在**，但全部是 2026 下半年的新苗子，无一生产级。核实清单：lukilabs/beautiful-mermaid-swift（Swift，363★但仅 7 commits，覆盖 6 大类图，ELK 布局，iOS15+）；hggz/Mermaid-Android（纯 Kotlin，3★4commits 无 release，7 种图）；swithun-liu/cmp-mermaid（KMP/Compose，号称 mermaid 12 全部 33 图族+8448 例视觉一致性矩阵，0.1.8、4★、约一个月新）；zusrsoft/diagram（KMP，mermaid+PlantUML+DOT，21 种图，卖点 streaming incremental rendering 明确面向 LLM 流式场景，0★ v1.0.x 一个月新）；2389-research/MermaidKit（Swift 内核经 JNI 桥 Android，9★119commits 无 release，架构不实际）。RN 生态确认无成熟非 WebView 方案；传统替代是 PlantUML（JVM 原生但语法不同）/kroki 服务端预渲染（本地优先离线场景不合适）。

user:
我们又不打包ios，找java的就行吧？

assistant:
成立——只出 Android 包就只看 Kotlin/JVM 线，Swift 批先无视。RN 侧「先只写 Kotlin」也架构可行：codegen spec 是 TS 双端共享接口，原生组件可只在 Android package 注册，JS 侧 platform 分支让 iOS 继续走现有 WebView 路径。Android 侧三个候选排序建议：cmp-mermaid 与 zusrsoft/diagram 覆盖广、有测试矩阵声明，值得 PoC（拿真实会话出现的图型验视觉一致性）；zusrsoft 的流式增量渲染与聊天流式场景对口；hggz 仅参考实现级。注意 cmp-mermaid 是 Compose 实现，进 RN 要经 ComposeView 并把 Compose 运行时拖进 APK（数 MB）。心理预期：这批库一个月龄 0-9 星，进生产等于自家维护 fork。仍属调研，未立项。

user:
我确认下性能问题，气泡的webview和页面的webview是一回事吗？我们之前没用rn的list，主要是它的flut list不好用。

assistant:
对着代码核实（ChatConversationWebView.tsx 头注释 + chat-webview-unify spec.md）：**是一回事，同一个实例**。气泡不是每气泡一个 WebView——整条转录的所有气泡都是 chat-conversation 这一个 WebView 文档里的 DOM 行（#rows），输入框 dock 也在同一文档 flex 布局（unify 主收益：消灭输入框高度跨桥滞后）。会话列表曾 SPA 进同一文档（#app[data-view] 双视图），rollback-spa 轮已整体回迁 RN（ChatSessionListPanel，组件注释「列表域已整体拆除，文档恒停对话视图」）。全 app WebView 清单：chat 主链 ChatConversationWebView；ComposerInputWebView（宏链/全屏编辑遗留）；CodeEditorWebView、RichDocumentWebView（vfs）；子会话屏走旧 chat-transcript 链。「WebView 性能不好」指的就是 chat 主链这一个实例：8.86MB 转录 bundle 解析主导冷启动、进出会话卡顿（exit-jank-fix-playbook）、键盘/滚动联动都是它的战场。FlatList 部分回应：不好用是共识（JS 驱动/空白/回收弱，FlashList v2 已修回收），但转录进 WebView 的主要动机不是列表而是气泡富内容（markdown/高亮/mermaid）在 RN 侧无像样渲染器（unify spec 范围判据原文）；故原生重写的真正难点也在气泡内容而非列表。

user:
你clone https://github.com/rikkahub/rikkahub.git 到 reference 目录，然后看看它是怎么实现 markdown 渲染的。

assistant:
克隆到 D:\Dev\reference\rikkahub（reference 目录新建在 D:\Dev 下与主仓隔开；注意当时 D:\Dev\nm-worktree 已被并行会话重建，未触碰）。派 Explore 子代理研究 + 主代理抽查三处关键代码核实，结论：RikkaHub 聊天 markdown 是**全原生 Compose 自绘**——自家 fork 的 JetBrains markdown 解析器（com.github.rikkahub:markdown，GFMFlavourDescriptor+MarkdownParser）解析成 AST，自写 Compose 组件递归遍历渲染（app/ui/components/richtext/Markdown.kt，约 1300 行；含 HTML 时降级 MarkdownNew：HTML 生成+Jsoup 解析+Compose 渲染的双管线）。流式优化（Markdown.kt:240-252）：snapshotFlow{content}.distinctUntilChanged().mapLatest{parseMarkdown(it)}.flowOn(Dispatchers.Default)——后台线程解析、mapLatest 取消过期解析、remember 缓存 AST；流式期间禁用 SelectionContainer 防 ConcurrentModificationException（ChatMessage.kt:427）。列表：LazyColumn + itemsIndexed(key=item.id)（ChatList.kt:315），流式时仅尾部消息重组。代码块：仓内自建 highlight 模块，纯 Kotlin 移植 highlight.js 11.11.1（mode-stack 引擎、30 种语言、MAX_CODE_LENGTH=4096 超限不高亮），HighlightCodeBlock 带横向滚动/行号/复制/下载/超 10 行折叠。LaTeX：fork 的 jlatexmath 渲 Canvas（行内 MathInline/块级 MathBlock/长公式 splitLatex 拆分）。图片 Coil 3、表格 DataTable。**mermaid 仍走 WebView 岛**（Mermaid.kt 用 ui.components.webview.WebView + WebViewContentCache，语言为 mermaid 的代码块触发）。对本项目启示：验证了「原生列表+原生气泡+WebView 只留给 mermaid」的混合终态可行；JetBrains markdown 解析器/jlatexmath/highlight.js 的 Kotlin 移植都有现成实现可借；工作量级约「一个专注渲染模块」，但本项目气泡还有批注划词/工具卡片等更复杂交互，估计需在其之上扩展。

user:
假如我们不处理vfs工作区，只把聊天页面rn化，因为此处才是最消耗性能的地方，那是否可行？【批注划词、工具卡片、附件 chip】这些能用原生实现吗？输入框能吗？因为输入框的tag也是一个复杂点。

assistant:
核实后逐项判：**可行，且比预想顺**。关键发现：①聊天转录里根本没有划词交互——transcript.css 全文 user-select:none（气泡禁选区），annotate 在转录里只是附件卡片展示类型（row-logic.ts 联合类型一项），真划词在文件预览（VFS 侧、范围外）——最 feared 的一项自动消失；②工具卡片=结构化卡片（名称/状态/IO 摘要），rows 数据本就结构化下发，点击回调 onOpenToolResult/onOpenSkillDetail 现成，RN 组件直翻比 web 还容易；③附件 chip=展示型，RN View/Text 容易；④消息菜单=气泡右上角 ⋯ 开 overlay（长按已退役），RN modal 容易。输入框是真正硬骨头：纯 RN 方案已被历史证伪（controlled-mentions 内联胶囊多行闪烁，v1.5.28 才搬去 WebView，RULE 有案底）；两条可行路：a.混合——composer 拆回独立小 WebView（21KB 包，宏链还在用 ComposerInputWebView 基建活着），代价是 unify 消掉的输入框高度跨桥滞后（1-2 帧+80ms）回来；b.彻底原生——Kotlin EditText+Spannable chip span 自定义 Fabric 组件（Android 成熟模式，原子删除/光标跳过=InputConnection 拦截，IME 组合态原生反而省心），但等于 Kotlin 重写 composer 全部行为（IME 七防线/粘贴门控/typeahead/全屏变体/宏链），大活建议远期。主工作量其实在 markdown 正文渲染器（markdown-it 已是依赖，token→RN 组件渲染器自写；代码高亮 JS 库→Text span；mermaid 留 WebView 岛，RikkaHub 同款）与流式性能（后台解析+mapLatest+稳定 key 可 JS 同构照搬）；超长代码块组件树深度需 PoC。迁移路径：unify 把转录+composer 合在同一文档，第一步必是拆回 composer 独立 webview（回 v1.5.29 形态），再转录原生化，composer 原生化最后或不做；子会话屏挂旧 chat-transcript 链可渐进跟随；UI 一致性照 unify 逐屏截图硬验收反向再做。建议：先拿真实长会话做转录原生化 PoC（滚动+流式），输入框留 webview。

user:
输入框肯定得做，甚至得一个做，要不然就等于webview移除失败了。我理解原生输入框的话，我们其实可以改造吧？不一定全自己实现？你有搜索工具的。

assistant:
同意前提（输入框留 webview=聊天页仍剩一个实例，迁移只做一半）。「改造现成的」核实成立，且发现远超预期：搜索「RN mention 输入库」时摘要提到的 Software Mansion「React Native Enriched」名称是幻觉（SoftwareMansion/react-native-enriched 404，组织真名 software-mansion 带连字符），但顺着线索找到真身 **software-mansion/enriched-markdown**（gh api+浅克隆到 D:\Dev\reference\ 实测核实：1132★、npm v1.1.1、仓库 2025-10-16 建正好一岁、当天仍有 push、MIT、dev 依赖 pin react-native 0.85.0 与本项目 0.85.3 完美对口、Fabric-only）。核心两件套：①EnrichedMarkdownTextInput——原生富文本输入、markdown 输出、内联 mention（mentionIndicators=['@','#'] 触发、onStartMention/onChangeMention/onEndMention 全生命周期=现成 typeahead 事件、insertMention(displayText,url) 以 [@x](scheme://x) 链接落文、自定义 URL scheme 区分类型、**原子删除（Slack 式退格整删，对应本项目 tryAtomicRangeDelete）**、onCaretRectChange 光标定位给浮层锚点、原生格式化菜单/智能复制粘贴/祈使样式 API）；②EnrichedMarkdownText——原生渲染（md4c C 解析器、CommonMark+GFM、LaTeX、tree-sitter 代码高亮可配语言清单、文本选区+自定义选区菜单项、mention 渲染、RTL/无障碍）；③同门 react-native-streamdown（remend 修流式残缺 markdown + react-native-worklets Bundle Mode 全程离 JS 线程，表格/代码块流式模式可配）——LLM 流式场景专用。旧方案全部淘汰：klinker41/android-chips（626★但 2019 停更）、percolate/mentions（101★/2023 停更）只当机制参考；matteodanelli/react-native-mentionable-textinput（32★/2023 停更）是 overlay 老路。缺口仍需自填：mermaid（留 WebView 岛，同前结论）、工具卡片/附件 chip/消息菜单（RN 自写，本就容易）、胶囊圆角保真（linkVariants 只有 color/backgroundColor/fontFamily，圆角药丸形是否可达需 PoC）、本项目 5 行高度钳制/粘贴门控（inputDisabled 同口径）/宏链与全屏编辑变体的取舍、桌面端双渲染器视觉对齐。安装注意：tree-sitter 语法资产 postinstall 联网下载（CI/离线要配）。结论：方案从「自写 markdown 渲染器+自写 Fabric EditText」降级为「集成 enriched-markdown 全家桶+适配补缺口」，PoC 四要点：胶囊保真、高度钳制、真实长会话流式性能、mermaid 岛嵌法。仍未立项。

user:
记录这个方案，然后我们设计下输入框原生化方案（spec-generate）。

assistant:
**方案拍板记录（2026-10-06）**：聊天页去 WebView 终态架构 = 原生列表（FlashList 级）+ EnrichedMarkdownText/react-native-streamdown 渲正文 + **EnrichedMarkdownTextInput 原生输入框** + 工具卡片/附件 chip/消息菜单 RN 自写 + mermaid 保留 WebView 岛。实施顺序拍板：**输入框先做**（用户原话「输入框肯定得做，甚至得一个做」）——转录暂回独立 chat-transcript webview，输入框原生化先行，转录原生化留后续迭代。宏链（PromptMacroTextInput）与全屏编辑（PromptEditorScreen/CodeMirror）本迭代不动、继续走既有 webview。需求来源：用户口述（无正式 PRD），requirement 记入本 memory；启动 spec-generate 流程，迭代名 composer-native-2026-10，spec 落 docs/Iterations/composer-native-2026-10/spec.md，探索报告摘要落同目录 cache/。

【spec-generate 阶段进展】四路并行探索完成（composer 行为基线 80+ 项清单 / 合并拆分影响面 / enriched-markdown 能力矩阵 / 测试构建 CI 约束），摘要落 `docs/Iterations/composer-native-2026-10/cache/explore-summary.md`。spec 已落盘（2026-10-06）：核心决策——库当「可样式化 TextInput」用、token 语义保持正则扫描真源（纯函数全保留）、patch-package 两枚补丁（RoundedBackgroundSpan 圆角胶囊 + setTokenRanges 外部 range 注入）、草稿零迁移（水化=明文→合成 markdown→setValue）、chat-conversation 包退役 chat-transcript 建独立入口、IME 七防线裁撤为 M1/M6/M7 三语义、粘贴走 selectionMenuConfig 定制菜单；7 个 Step（lib-spike 为 go/no-go 硬门）+ T-NC/TS/RT 14 条用例。**spec 待用户确认**。

【spec-check-loop 收敛（2026-10-06）】两轮审查收敛：r1 No-Go（P0×5：测试影响清单与 import 实情不符、emitReady 表述误导、两枚补丁可行性未论证、patch-package 时序未写；P1×3 剥离/桥/适配范围不明）→ 主代理 doc-fix 全闭合（含核实 r1 审查员自己的搜索疏漏：dispatcher/entry 测试是确实直 import 的，多行 import 尾行与 require 没被其模式匹配到）；r2 复核全部闭合 + Go（execute-ready），残留 P2×2（bindChannel 差异说明、boot-script 措辞）已顺手修复。spec 路径 docs/Iterations/composer-native-2026-10/spec.md，**execute-ready 待用户确认后开工**（确认前不编码）。

user:
[$code-dev-loop]

assistant:
用户以启动 code-dev-loop 确认了 execute-ready。开发 DAG 开工：worktree `D:\Dev\nm-worktree\cn1`（分支 feat/composer-native-2026-10，base 587ff96ea），安装链后台跑；Context Bundle 落 docs/Iterations/composer-native-2026-10/cache/context-bundle.yaml，DAG v1 波次 [impl-spike∥impl-transcript] → verify → cr-func → composer 两步串行 → panel → retire → final。Step1/5/7 的真机项按 qa:manual_user 挂用户验收不作自动门禁；同 worktree 并行子代理禁 git 写、波次后主代理统一提交。

【dev-ready（2026-10-07）】开发 DAG 全程 9 个编排版本收束：8 笔提交落 feat/composer-native-2026-10（worktree cn1，base 587ff96ea → head 5d3640d83）。终态门禁全绿：**全量 jest 259 套件 2009/2009（--maxWorkers=2）**、tsc 零错、build:webview 四包门 C 全绿（chat-conversation 退役、棘轮零抬升）、`:react-native-enriched-markdown:compileDebugKotlin` 通过、cr-func w1/w2 子代理 func-ready + w3 手工审查（子代理配额尽转主代理）func-ready。deviation①（内置粘贴）已闭合（补丁 paste 键菜单+事件双层关闭）；accepted 偏差四项留痕（typeahead 锚定简化/三类型面暂留/IME 条件缓释/postinstall 落根）。

【真机联调轮（2026-10-07）】用户报红屏后连修两击（均为 **jest mock 面测不到的 codegen 盲区**）：①规格里胶囊四字段裸 `number` → `CodegenTypes.Float`（Metro 打包对规格类型强校验）；②命令参数不支持 `ReadonlyArray<object>` → `setTokenRanges` 改 JSON string 序列化（TS 封装层 stringify、Kotlin org.json 解析、生成 Interface/Delegate 同步，七处联动）。**新坑**：patch-package 全量重生成会被 `node_modules/<lib>/android/build/.transforms` 超长路径产物的 git diff 警告刷爆 stderr（assembleDebug 之后才出现）——生成前先删 build 产物目录再 `--include "^(src|lib|android)[/\\]"` 收窄。USB 反向隧道抖老病复发（bundle 传到 93~98% 断连重来），重启 adb 服务端+重建 reverse 后通；真机最终验证：nm-boot hydrate complete 3701ms、会话列表完整渲染（uiautomator dump 124 节点实证）。分支现 head 7aab8cc40（含 main v1.5.40 合并 41237a6d8 + 两笔红屏修复 + lockfile 同步），Metro 后台常驻 cn1 的 8081 供用户测试。**待用户**：真机三项 QA（胶囊视觉+IME go/no-go / 键盘与长高 / 全量回归）、合并与发版拍板。

user:
几个问题 1 tag上没有文章 2 现在消息列表加载不出来了

assistant:
两连修（提交 3d206251e，真机复验通过）：①**胶囊无字**——RoundedBackgroundSpan 是 ReplacementSpan，挂上后系统不再绘制原文字，`draw()` 里只画了圆角底、没调 `canvas.drawText`，补上即字显（已并入 RULE「enriched-markdown 补丁铁律⑥」）；②**转录白屏**——桥信封版本错位：宿主发 v2 信封、standalone 入口拼装的 chat-transcript runtime 内部只认 v1，`matchHostMessage` 对版本不合**静默丢弃无任何报错**；此前 v2→v1 下译由已退役的 chat-conversation dispatcher 干，退役时没搬进 standalone 入口。修法=main.ts 入口 `bindChannel:false` + 自绑 downtranslate dispatcher（v2 下译成 v1 再喂 `handleHostMessage`），同时入口自己发 v2 ready。真机复验：进会话后转录气泡、上下文用量条（11.7k/128k 9%）、胶囊内「$时序图大纲」文字全部可见（截图逐字转写验证）。**教训入 RULE**：信封版本不匹配是静默丢弃不是报错，拆/并桥必须核两侧 v。荣耀真机覆盖装确认门复现：用户到场点确认后 `adb install -r -d` Success。分支 head 3d206251e（13 笔），Metro 常驻供用户继续 QA（键盘顶起/五行钳制/粘贴菜单/typeahead/全屏回归）。

user:
输入框的文字效果不对，出现重叠了。这个输入框你不是改的现成库吗？怎么这么多bug

assistant:
第三击（提交 ffc579f44，真机复验通过）：**多行文字叠印**。取证链：截图视觉模型定位叠印行 → uiautomator dump 拿输入框原始文本 `$时序图大纲\n\nsss\n\nff\n&\n555\n\n\n\n` → 发现叠印恰好只发生在**同段落内连续排布的行**（ff/&/555 单换行），空行隔开的行正常。根因是**库上游（非本仓补丁）lineHeight prop 单位 bug**：RN 侧按惯例传 dp（22），Kotlin Manager `setLineSpacing(value - view.textSize, 1f)` 拿 22 直当像素减 textSize（16sp×2.75 密度≈44px）＝**每行 −22px**，相邻文本行被压叠；空行隔开处压的是空行所以肉眼看不出，连续行才暴露。修复=补丁改 Manager：`value × density` 换算 px + 以 `paint.fontMetricsInt` 的 `descent − ascent` 为自然行高做补偿（对齐 web CSS line-height 22 的口径）。教训入 RULE 铁律⑦：Android 原生「部分行叠印」先查 setLineSpacing/LineHeightSpan 的单位与符号。部署链同前（停 Metro→gradle→荣耀确认门用户到场→装 Success→重启 Metro→reverse→复验截图）。**关于「现成库怎么这么多 bug」**：三击里只有胶囊 span 是本仓自写代码的锅（ReplacementSpan 契约），信封翻译是拆包退役漏搬，lineHeight 单位是库上游 bug——改造路线的成本主要在「适配缝」，真机联调轮就是把这些缝逐个焊掉。分支 head ffc579f44（14 笔）。

user:
输入框内部无法滑动，没有纵向scroll。还有tag圆角不明显。在胶囊边缘如果不输入空格分离，仍然继续输入会被当成同一个胶囊，理论上胶囊只允许引用得到，不允许手动输入

assistant:
三连修（提交 5dc15801e，15 笔，jest 全量 259 套 2011/2011 绿）。**①内部纵向滚动**：scrollEnabled 改封顶态动态切（onLayout 高度 ≥ maxHeight 才 true，未封顶保持自增高防闪烁）；关键发现是 Android EditText **没有原生触摸拖动滚动**（拖=光标/选择，scrollEnabled 只解锁 caret 跟随），在补丁里给 View 自写 onTouchEvent 拖滚（竖直主导过 touch slop 且无选区时接管）。期间真机像素取证（PS 采样胶囊色带 x 范围 vs 对照列）连环揪出两个衍生 bug：**滚动残留砍头**——上一版 scrollTo 在禁用态一刀切拦截，把 TextView 内容缩短后的内部归零回正也挡了，scrollY 残留导致胶囊顶部被裁（用户报「顶部没渲染」，日志版实测 span 坐标正常才定位到 scrollY）——修法=禁用态仍放行 scrollTo(0,0)；**回车后胶囊下垂**——span 矩形按行框 top/bottom 画，行距富余全在 descent 侧、胶囊垂到下一行（用户实报），修法=按字形 ascent/descent 定界。**②胶囊确认制**（行为语义变更，用户拍板「胶囊只允许引用得到」）：buildTokenInsertion 返回值附带插入区间 → controller 四咽喉点维护确认表（typing 差分重映射：编辑区与胶囊重叠即摘除、贴右边界插入不并入；插入登记；水化正则引导扫描；清空清表）→ 组件侧同款纯函数本地重映射消逐键滞后，缺省 prop 回落正则全扫旧行为。**③圆角 4→8**（半高强圆角药丸，dock-style 单源+测试同步）。真机像素复验：胶囊色带完整包裹文字。教训入 RULE 铁律⑧（EditText 无原生拖滚/scrollTo 拦截须放行归零/span 背景按字形定界/行高补偿顺序无关化）。设备 USB 断开待重插重建 reverse。

user:
[$apm-recall] 恢复记忆，启动metro，我测试下那个kotlin实现的原始输入框

assistant:
测试环境恢复（2026-10-11，距上轮 4 天）：8081 端口审计——存活 Metro 正是 cn1 实例（PID 13796，命令行核实路径 D:\Dev\nm-worktree\cn1，后台 Metro 跨会话存活可直接复用免重启）；cn1 worktree 干净、head 5dc15801e 与记忆末轮一致；packager-status:running；重建 reverse 隧道（补 USB 断开遗留）；force-stop + 重启 app，MainActivity 前台焦点确认。真机 APK 为三连修（5dc15801e）复验版，原生侧无新改动无需重装。用户继续真机 QA 原生输入框。

user:
输入框的末尾高度有点问题，最后一行文字只有一半在可见区域内。而不是恰好最后一行全在可见区域内

assistant:
末行裁切修复（提交 55ec67947，16 笔）。真机像素取证对账闭环：荣耀 density 实为 3.0（480dpi，非记忆里的 2.75）；五行渲染需求 5×66px=330px，实测 view 仅 329px = Yoga 拿到的 content 测量值（293px 自然行距 5 行 + padding 36px）——差 37px 恰为第五行被裁量（暗像素带仅 12px/66px 行框）。根因：三连修的行高补偿只落渲染侧（View.setLineSpacing 每行 22dp=66px），库 InputMeasurementStore 测量侧仍 StaticLayout.setLineSpacing(0,1f) 自然行距（58.6px/行），测量矮报 → Yoga 视图高度装不下渲染内容（padding 由 Yoga 层叠加，测量函数只报 content 高——props extends ViewProps 已确认）。修复三处同源化：①View 行距增量抽 lineSpacingAddPx getter（渲染/测量单一公式源），setPendingLineHeightDp 补挂 invalidateLayout；②InputLayoutManager.store 传 View 现算增量；③InputMeasurementStore 测量套同款行距 + 增量进缓存键（lineHeight prop 变化缓存失效），initialMeasure 从 props 读 lineHeight 复刻补偿。修复后五行 Yoga 总高恰达 maxHeight 122dp 封顶并触发 scrollEnabled 切换。jest composer 相关 17 套 167/167；真机用户亲测通过。补丁重生成照旧先删 android/build 再 --include 收窄（^(android[/\\](generated|src)|lib|src)[/\\]）。

user:
我感觉是你设计的有点问题。正常来说输入框的输入部分是单独的box，这样文字输入自然在可见范围内，超出范围hide也应该是上部hide与我们的底部无关，底部应该是自动贴底的。感觉你这个计算高度思路很复杂也容易出问题

assistant:
方向判断对——病灶确实是设计缝（测量/渲染两套参数两条账）。Fabric 自定义组件高度必须由 Yoga 测量函数回答（框架绕不开），但正确做法是测量与渲染同源（复用 View 现算的行距增量），而非手写第二套公式；「上部 hide、底部贴底」模型正是 EditText gravity=top + bringPointIntoView 天然行为，高度量准后自动成立。

user:
我需要像你确认几个点：1. 之前该迭代是否进行过CR；2. 使用原始输入框是否兼容高版本安卓，这个问题在之前的版本很常见，并都优化过。

assistant:
查证两问：①CR——迭代主体（dev-ready 8 笔）过 cr-func 波次（w1/w2 子代理 + w3 主代理手工，均 func-ready）；但后续 QA 修复轮（两连修 3d206251e / 三连修 5dc15801e / 本轮 55ec67947）均未过 CR，迭代收尾前应统一补一轮（重点扫补丁 Kotlin）。②高版本兼容——CHANGELOG 年表实锤 v1.4.x RN TextInput 时代一整族问题：Android 16 adjustResize 不稳定（KeyboardStickyView 修）、键盘消息区抬升不同步、KeyboardAvoidingView behavior 空失效、IME 组合态误删（v1.5.2x）、tag 闪烁搬 webview（v1.5.28）。拆两族：IME 组合态/渲染一致性族（JS 双层渲染的病，原生 Spannable 单管线结构性消失，IME 七防线已裁撤为 3 语义）；键盘避让族（页面布局层问题，与输入框组件是否原生无关，e2e 时代仍在）。真机 Android 12 一直正常是因为无强制 e2e、adjustResize 兜底在——原生不自动免检高版本。

user:
在v1.5.28或者说1.4.x的时代，用的也是原生的rn组件，那个时候同样有输入框高版本问题，这个你应该能搜索到历史。之前验证的方式是用高版本安卓模拟器，这个应该能测试。

assistant:
Android 16 模拟器 QA（AVD Medium_Phone_API_36.1，2026-09-22 存量环境）。部署链坑：模拟器残留旧测试包 versionCode 1316 → INSTALL_FAILED_VERSION_DOWNGRADE，卸载重装（模拟器数据无价值，真机才怕 uninstall 清数据）；bundle 首载慢，轮询 dump>12KB 判 UI 就绪；用户给的备份 nmbackup.db（64.7MB SQLite 全库，E:\迅雷下载）run-as 直塞 databases/novel_master_vfs 灌真实会话（原空库存 .empty.bak；库路径按 db-file-path.ts 候选探测，op-sqlite 布局在 databases/）。QA 结论：①键盘顶起——冷启动 4 轮全部正常。dumpsys 实证 EDGE_TO_EDGE_ENFORCED + frame=[0,0][1080,2400]（键盘弹出 window 不 resize，adjustResize 彻底失效），避让 100% 靠 RNC 事件链：KeyboardAnimationCallback HEIGHT::312 / DiffY 0→820px 动画完整 → AndroidKeyboardClipBody marginBottom 收缩 → dock 顶起（像素带验证）。RNC 检测链：KeyboardProvider → react-native-is-edge-to-edge（两路检测：RNEdgeToEdge 库 / DeviceInfo.isEdgeToEdge 常量）——本项目 RN 0.85.3 中 isEdgeToEdgeFeatureFlagOn 无调用者恒 false + 库未装 → IS_EDGE_TO_EDGE=false → RNC 按传统模式初始化，但 Android 16 系统强制 e2e 使 window 实际状态与 RNC 认知错位（当前靠 callback 事件仍工作）。⚠️孤例遮挡：换库后首次进程弹键盘 dock 全遮 + 无 HEIGHT 日志（callback 未跑），force-stop 重启后消失，3 轮冷启动复现试验均正常——未复现但结构性风险记录：Android 16 无系统兜底、RNC 事件链是单点，QA 阶段让用户真机持续观察，关注 RNC 升级。②五行钳制 122dp 封顶分毫不差（321px/2.625 密度）+ 第五行完整（对比修复前只剩 12px 截断带）——测量修复在 API 36 同样验证通过。③第 6 行：首行顶部滚出 + 新行贴底（与用户描述的标准模型一致）。④胶囊：$ 引用面板弹出正常、胶囊色带渲染正常。⑤拖滚：模拟器 swipe 未触发滚动（疑被选择手势/IME 吃掉；真机已验证、纯 View.onTouchEvent 无版本差异，低风险）。粘贴菜单未测（真机已验证）。工具沉淀：tmp/scan-rows.ps1（逐行亮度带扫描）、qa-find.ps1（dump 节点查找）、parse-dump.ps1；教训：模拟器无 curl、uiautomator XML 属性顺序不定需宽松匹配、Windows 复合命令引号坑持续（复杂逻辑一律落 .ps1 文件执行）、PowerShell $r.Content 对 text/plain 会给 byte[]（-match 静默失败）。


user:
就几分钟的话，那跑一下吧

assistant:
慢启动复现试验：Medium_Phone_API_36.1 是 Play Store 变体镜像，adb root 被拒（adbd cannot run as root in production builds）→ drop_caches 不可用，那 3 轮实为快启动。改用最忠实复刻——run-as 重写库文件（64.7MB nmbackup.db 覆盖 databases/novel_master_vfs）后的首次启动 + tap 输入框：callback 正常（HEIGHT::312 全链）。合计 7 轮有效测试（快启 force-stop ×3 + 伪慢启 ×3 + 换库首启 ×1）孤例均未复现，定性维持「无法解释的一次性事件 + 结构性单点风险记录」（Android 16 无系统兜底、避让 100% 依赖 RNC 事件链）。试验干扰发现：RN dev 警告横幅（Open debugger to view warnings，模拟器上 y 2117-2177）与输入框（2038-2185）重叠，tap y=2111 会被挡成点警告条（键盘不弹、事件 0 全零）——模拟器自动化要点输入框上部（y~2060）避开；另 adb root 前后 reverse 会清空需重建、多设备 adb wait-for-device 须 -s 指定。

user:
（2026-10-12 立项轮）[$apm-recall] 恢复记忆确认方案与下一步——输入框已完成（v1.5.41），确认下一步 msg 列表原生化。随后四轮收敛范围：①mermaid 简化按代码块处理不渲染（省掉 WebView 岛架构特例，聊天页纯原生，PoC 去掉最高风险项；工作量省一两成但风险与架构纯度收益超比例；vfs 预览侧 mermaid 照旧、想看图走文件预览，后路=点击全屏查看屏比列表内嵌岛简单一个量级）；②确认会话主页面将零 webview（上下文用量条迁 RN、token chip 本就在 RN、菜单/工具卡片/chip 原生；切换会话无 webview 初始化/握手/ready/快照分片）；③子会话屏确认一起 RN 化（代码核实 SubagentSessionScreen：数据面本就订阅同一 SessionStreamUnitManager 单元投影，仅渲染层换 ChatConversationWebView transcriptOnly；RN 化后 CSS 藏 dock 的拧巴做法消失，chat-transcript 包彻底退役连 v2→v1 信封下译一起拆）；④宏链 PromptMacroTextInput 代码核实=智能体编辑器 DynamicBlocksCard.tsx/PromptLayoutSection.tsx 两处消费，用户确认范围外不动。用户拍板立项：开发用新 worktree 父目录 D:\worktree（附件指定，弃旧 D:\Dev\nm-worktree）；**列表自研**（当初选 webview 就因 FlatList 难用，这次得好好设计），rikkahub 值得借鉴。reference 仓库迁移：D:\Dev\reference 的 enriched-markdown/rikkahub 挪入主仓 .reference/（与 pi 同放，.gitignore:68 已覆盖，git 零影响）。

assistant:
（spec-generate 启动轮，2026-10-12）迭代名 transcript-native-2026-10，spec 落主仓 docs/Iterations/transcript-native-2026-10/spec.md。四路 readonly 探索子代理并行派遣：E1 转录渲染域形态复刻清单（web 包内部结构/气泡全形态/scroll 行为/快照分片/子会话屏）/ E2 列表自研设计（rikkahub LazyColumn 借鉴 + 本仓 FlatList 历史痛点证据 + 三条路评估）/ E3 enriched-markdown 渲染集成面（EnrichedMarkdownText+streamdown 能力矩阵与缺口）/ E4 数据面布局与退役面（流式链/键盘联动/测试构建清理点）。

user:
（2026-10-13 二次 loop + 开工轮）①追加并发专项审查轮：webview 方案历史多次多会话/子会话并发事故，须好好审查并好好设计方案完善 spec——A 路（spec 并发覆盖审查 C1-C10 场景清单，重点 RN 化后 SubagentSessionScreen 与 ChatTab 同 manager 多订阅并存的 attach 语义）+ B 路（历史事故考古+防护盘点）并行；②[$code-dev-loop] 点名启动开发 + worktree 目录 D:\worktree：execute-ready 确认 + S1/S2/S3 按拟定通过（tau/ppwl 先例）；dev_loop_tn 开工——worktree D:\worktree\transcript-native @feat/transcript-native base 615dda436，环境准备后台，P0 spike/P1 行组件先行（与并发设计正交），P2 行为层 gate=并发设计节 R3 Go。③（同日追加）P0 三硬门验证手段＝模拟器 e2e（不等真机窗口；perf 门用 RN 版 vs web 版同场景相对对比口径；复用仓内 e2e 基建 + noReset/禁清数据纪律）。关键探索增量：①E1——上下文用量条本就不在 webview 内（立项讨论口径更正，已是 RN）；ToolCallCard/ToolCallGroupCard/ThinkingBlockCard/ToolTurnPhaseBar 现零引用=天然翻新资产；②E2——FlatList 失败一手记录 mobile-native-chat-list/prd.md:3（2026-06 废弃：inverted FlatList×RenderHTML 异步测高无法满足贴底/流式/prepend/长按菜单），失败条件已被原生同步测量改变但行为层当年就是自研失败点；rikkahub 模式=itemsIndexed(key=id)+数据层仅尾 node.copy（引用稳定）+MarkdownBlock 后台解析 mapLatest+流式禁 SelectionContainer+「生成中+未滚动+贴底」才跟+requestScrollToItem overshoot+ImeAutoScroller scrollBy(Δ)+无分页全量常驻；FlashList v2 未装；③E3——react-native-streamdown/remend 未装且是独立包（需 Worklets Bundle Mode 三处构建改造，定为非目标）；补丁仅 input 侧 13 文件与 display 零重叠；enableCodeHighlight/enableMath/enableVideo 三关全 false（tree-sitter 资产从未下载）；flavor 二选一=github（表格+代码块header+复制按钮，选区不跨段/numberOfLines失效）vs commonmark（全文档选区，无表格）；mermaid 无 grammar 自动明文与拍板天然一致；库无 AST 缓存每次全量重解析→必须保留 block-split「已提交块静态+活跃尾块单实例」结构；chatRichTextEnabled 默认 false（plain=RN Text pre-wrap 天然保留空行，web 的 stream-blank hack 不需要）；④E4——数据面 D1-D12 不变量清单、六处齐改纪律、22 项退役清单、快照分片/让渡退役但 onSnapshotComplete 被 rollback 链 token 重算错峰依赖需新信号源、tryCommitStreamTail/commitAbortOverlaySnapshot 需原生对偶 API、iOS pbxproj 假绿坑、e2e 判据（composer 轮已漂移+本轮转录）需一次收口到 a11y/testID。

assistant:
（spec-check-loop R2 轮收尾，2026-10-12）R2 审查 **Go（execute-ready）**：R1 九项全闭合、FlashList v2 依赖 API 全部官方实证（onStartReached/onCommitLayoutEffect/onLoad/getItemType/MVCP 含 autoscrollToTop/BottomThreshold 与 startRenderingFromBottom）。剩 P1×1（子会话 idle 路径消息面须改订阅 readMessagesSnapshot——ChatTabProvider 同构，否则 idle loadOlder 界面不更新）+P2×6（计数/措辞/枚举判据）已由主代理顺手修完 11 处（ppwl round4 先例，不派 R3）。终态：2 轮审查闭合 P0×2/P1×5/P2×9，spec_check_tn status=execute-ready 待用户确认——确认时一并拍板 S1/S2/S3 三项拟定决策，然后 code-dev-loop 在 D:\worktree 下开 worktree。三项拟定决策显著标出：S1 FlashList v2 容器+自研行为层（类比 rikkahub 用 LazyColumn 平台件；兼容 spike 真机先行，不过回落纯自研，行为层设计与容器解耦）；S2 开 tree-sitter 代码高亮（观感对齐 web 版，CI 需联网+APK 增量）；S3 github flavor（表格+代码块复制按钮，选区不跨段为已知行为变化）。方案骨架：TranscriptList（FlashList+useTranscriptScrollBehavior 行为层全自研，纯函数复用 webview-host/chat-transcript/scroll.ts）+ TranscriptRowView（工具卡翻新复用零引用资产）+ plain/rich 双路（block-split 保留：已提交块 append-only 静态+活跃尾块单实例 12k 护栏）+ 子会话屏 variant="subagent"（数据源统一 loadSessionTailMessages）+ 22 项退役清单（顺序纪律：先删 dist 契约测再退包再改守卫基线）+ Phase 0-7 计划（P0 三硬门 PoC）+ 风险 R1-R8 + DoD。非目标：streamdown/remend、mermaid 恢复、desktop、core 数据面。

