---
date: 2026-08-20
title: chat-improvements 集成分支 CR：撰写 cr-fix-spec（节点 spec-fix-cr）
keywords: CR, fix-spec, chat-improvements, feat/chat-improvements-integration, must-fix, P1/P2, CollapsibleMessageBody, runQuery 竞态, ensureDirRulesForNewPath, mermaid-fullscreen, svgCache LRU
abstract: 节点 spec-fix-cr：为 feat/chat-improvements-integration（515da9d..dc16a99，review_round 1）新建 docs/Iterations/chat-improvements-cr/cr-fix-spec.md（draft），汇总四切片 must-fix 全清单（P1 3 条：core/B-1 write 无条件补规则、desktop/A-1 富文本进 clamp、desktop/C-orch-1 runQuery 竞态；P2 13 条覆盖 core/mobile-web/mobile-rn/desktop）+ Spec deviations（无 open）+ Open questions 5 项 + 合并后 QA（cf Step5 / mf Step7 / A-1 视觉把关）+ K 节建议 4 条。只写文档不改实现代码。
---

user:
节点 spec-fix-cr：为 novel-master 的 feat/chat-improvements-integration（base 515da9d / head dc16a99，review_round 1，状态 draft）新建 fix-spec，路径 docs/Iterations/chat-improvements-cr/cr-fix-spec.md，结构按 code-review-loop 的「fix-spec 文档结构」（元信息/Must-fix P0→P1→P2/Spec deviations/Open questions/已豁免/合并后 QA/K 节建议），只改文档不改实现代码。must-fix 15 条由用户给定（P1 3 + P2 列了 13 个编号），逐条含 id/严重度/维度/文件/问题/改法/验收测试/来源。

assistant:
撰写过程：沿用前期四切片 scope review 已核实的代码事实（文件路径 + 行号锚点直接引用，未重查）；补核了三个此前不确定的路径——vfs-tools 测试实际在 packages/core/test/tool/vfs-tools.test.ts（不在 src 同目录）、annotate.ts 在 apps/mobile/src/web/rich-document/webview/runtime/annotate.ts、ChatHistorySearchScreen 在 apps/mobile/src/screens/stack/。工具坑：find_path 对这些 glob 全部空手而归，换 shell find 才命中；create_directory 曾报错，用 terminal mkdir -p 绕过。

文档要点：
- P1 3 条：core/B-1（write run L254-258 无条件 ensureDirRulesForNewPath，改法为 write 前探测已存在则跳过、探测失败保守视作已存在）、desktop/A-1（richText||alwaysRichText 回退不折叠直渲 MessageBody）、desktop/C-orch-1（两按钮互斥 disabled={loading||loadingMore} + useRef 请求序号守卫 append）。
- P2 13 条照用户编号全录：core 3（workplace 注入对齐 / 补规则失败不阻断测试 / listDirRules 批量 + debug trace）、mobile-web 5（injectCss 函数形式 replace / setDocument token 守卫 / mermaid attach 幂等 + _renderView 校验 / webview 进 typecheck 门禁 / 删不可达选择器）、mobile-rn 3（ready 复位 mermaidViewerOpenRef / ready 上浮 false / 错误文本移出折叠卡片）、desktop 2（富文本不进 clamp 用例随 A-1 定案 / svgCache LRU 100~200 + 失败占位重试或 TTL）。
- 总数口径：用户原话「15 条」但 P1 3 + P2 13 = 16 个条目，文档按逐条照录不硬凑总数，元信息只写波次结构不写总数，desktop/G-1 标注「随 A-1 定案不单独排期」。
- Open questions 5 项（filterSummary 文案建议 #≥10/#≤50、UI mkdir/cp/mv 不补规则是否接受、rm 后 dir_rule 残留是否范围外、boot-script 正则对 dist 变量名确认、三轮 UI 反馈回填 spec）；Spec deviations 无 open（memo 升级 svgCache 记正向偏差）；合并后 QA 三条（cf Step5 双端 / mf Step7 真机 / A-1 视觉把关）；K 节建议 4 条（CI typecheck continue-on-error 移除、双端测试前重 build core dist、双链路 ctx 构造收敛单一工厂、webview 全局态模式标配 attach 幂等 + ready 复位）。

产物：docs/Iterations/chat-improvements-cr/cr-fix-spec.md（新建，状态 draft）。实现代码零改动。

---
date: 2026-08-20（同日第二批）
title: chat-improvements CR 修复 mobile-rn 三条（节点 fix-mobile-rn）
keywords: CR fix, mobile-rn, mermaidViewerOpenRef, ready 复位, onWebMermaidViewerOpenChange, ChatHistorySearchScreen, 错误恒显
abstract: 节点 fix-mobile-rn：在 feat/chat-improvements-integration 主工作区落地 cr-fix-spec 的 mobile-rn 三条 P2——A-1 RichDocumentWebView ready 分支复位 mermaidViewerOpenRef；A-2 ChatTranscriptWebView ready 分支调 onWebMermaidViewerOpenChange?.(false)；A-3 ChatHistorySearchScreen 错误文本移出折叠卡片恒显。验证：三个相关 jest 套件 36 用例全过 + npx tsc --noEmit -p tsconfig.build.json 零错。
---

user:
按 cr-fix-spec 只做 mobile-rn 部分 3 条（A-1/A-2/A-3），改动范围限 apps/mobile/src/components 与 src/screens，按逻辑块提交、只 add 自己文件（有并行同伴），typecheck 用 npx tsc --noEmit -p tsconfig.build.json（npm run typecheck 脚本同伴在改，不动）。

assistant:
三条都是小改动：A-1 在 RichDocumentWebView.tsx handleMessage 的 ready 分支补 mermaidViewerOpenRef.current = false（该 ref 仅供 BackHandler 拦截判定，无渲染依赖，deps [] 不受影响）；A-2 在 ChatTranscriptWebView.tsx 同位置补 onWebMermaidViewerOpenChange?.(false)（该回调已在 handleMessage 的 deps 数组里，无遗漏）；A-3 把 ChatHistorySearchScreen.tsx 的错误 Text 从 formExpanded 条件块内移到折叠卡片外、header 内恒显——背景是首次查询命中会自动收起表单，之后翻页 append 失败的 error 在旧布局下藏在意卡片里不可见。既有测试未断言错误在卡片内部，改动后 36 用例全过（输出里的 act 警告是既有测试写法提示非失败）。

---
date: 2026-08-20（同日第三批）
title: chat-improvements CR 修复 mobile-web 五条（节点 fix-mobile-web）
keywords: CR fix, mobile-web, injectCss, setDocument token, mermaid-fullscreen 幂等, TextAnnotator 泛型, typecheck 门禁, 不可达选择器
abstract: 节点 fix-mobile-web：在 feat/chat-improvements-integration 落地 cr-fix-spec 的 mobile-web 五条 P2——G-1 build-webview injectCss 改函数形式替换；A-1 rich-document main.ts setDocument 自增 setDocumentSeq 防 Recogito 按中间态建层；A-2 mermaid-fullscreen attach 幂等守卫 + open 前 _renderView/_post 成对校验；C-1 修 annotate.ts 泛型错并把 tsc -p src/web/tsconfig.json 挂进 typecheck；C-2 删 .mermaid-block.mermaid-failed .mermaid-block__source 不可达分支。验证：15 个 jest 套件 84 用例全过 + npm run typecheck（含新挂 web tsconfig）零错 + build:webview 重建后 dist 核对（不可达选择器已消失、注入 CSS 完整）。
---

user:
按 cr-fix-spec 只做 mobile-web 部分 5 条（G-1/A-1/A-2/C-1/C-2），改动限 apps/mobile 的 web 层与构建脚本，按逻辑块提交、只 add 自己文件（有并行同伴）；红线：不动 snapshot.ts 5 处调用、stream.ts 不引 mermaid、mermaid-core 被测断言不删、webview JS 禁 lookbehind、改 runtime 后重建 webview。

assistant:
五条均小改动，按逻辑块拆 5 个 commit（46a0fcb/b1fe80b/195b869/a12f1c2/a10373d）。关键决策：C-1 泛型修法是把 annotate.ts 模块级变量显式声明为 createTextAnnotator 工厂的实际返回类型 TextAnnotator<TextAnnotationLike, TextAnnotationLike>（工厂默认 I/E 均为 TextAnnotationLike，与别名默认 TextAnnotation 不兼容）；A-1 用模块级 setDocumentSeq 自增而非 useRef（webview 侧非 React 组件作用域），finally 里 seq !== setDocumentSeq 则跳过 refreshAnnotateAfterDocument；A-2 attach 守卫仍先更新 _post 再早退（重复调用刷新 post 引用无害且保留语义）；测试沿用本仓「RN 环境无 jsdom，读源码+dist 断言」惯例，三处新增契约断言分别落在 annotate-recogito-preview（T-RG3 追加）、mermaid-fullscreen（T-MF1 追加）、rich-content-styles。typecheck 脚本改为 tsconfig.build.json && src/web/tsconfig.json 串联（移动端同伴修复时特意留给我改）。dist 验证：两包 app.css 不再含 .mermaid-block.mermaid-failed，mermaid-block__chart:active 与 recogito CSS 注入完整。

---
date: 2026-08-20（同日第四批）
title: chat-improvements CR 修复 desktop 四条（节点 fix-desktop）
keywords: CR fix, desktop, CollapsibleMessageBody 富文本回退, runQuery 竞态, 请求序号守卫, svgCache LRU, 失败占位 TTL, react-test-renderer 双 react 副本
abstract: 节点 fix-desktop：在 feat/chat-improvements-integration 落地 cr-fix-spec 的 desktop 四条——A-1 CollapsibleMessageBody 富文本（richText||alwaysRichText）直接渲染不进 clamp wrapper；C-orch-1 查询/加载更早两按钮互斥 disabled={loading||loadingMore} + requestSeqRef 序号守卫丢弃晚到旧响应；G-1 补富文本不折叠与竞态行为用例；C-1 svgCache LRU 上限 150 + 失败占位 TTL 30s。验证：指定 6 个测试文件 35 用例全过 + npm run typecheck 零错。
---

user:
按 cr-fix-spec 只做 desktop 部分 4 条（A-1/C-orch-1/G-1/C-1），改动限 apps/desktop，按逻辑块提交、只 add 自己文件（有并行同伴）；锁定字符串 ipcMessagesSearch/MessageList/未找到匹配的聊天记录保留，ConversationPanel 不传 collapsibleMessageBody 零感知。

assistant:
按逻辑块拆 3 个 commit（A-1+富文本用例 / C-orch-1+竞态用例 / C-1+mermaid 用例）。关键决策：
- 竞态行为用例踩了双 react 副本坑：根 node_modules 的 react-test-renderer@19.2.3（传递依赖）绑定根 react@19.2.3，而桌面工作区自带 react@19.2.7，组件用工作区副本时 hooks dispatcher 为 null（Cannot read properties of null reading useState）。解法：新建 test/react-alias-hook.mjs 解析钩子，在测试文件里先 register 再动态导入面板与 act，把整棵依赖树的 react（含 react/jsx-*）重定向到根副本；又因 ESM 模块缓存共享，静态导入过 MessageList 的 chat-search-collapsible-form.test.tsx 不能与该用例同进程，独立成 chat-search-race-guard.test.tsx（node --test 按文件分进程天然隔离）。受控时序 mock 拦在 window.novelMasterDesktop.invoke（ipcMessagesSearch 底层出口），不改产品代码注入点。
- C-1 失败占位选 TTL（30s）而非「不缓存失败」：既有 T-MD2 断言失败后 isMermaidKnownFailed 为 true，不缓存会破坏该语义；TTL 用 node:test mock.timers 控 Date.now，无真实等待。LRU 用 Map 迭代序（命中 delete+set 提升为新最新，写入超限从头部淘汰，连带 failedAtCache）。
- 竞态守卫的 finally 不做 seq 校验：过期分支也要清掉自己占住的 loading/loadingMore 标志，且互斥下同类请求不会同时在途，不会误伤最新请求。
- 全量 npm test（含重型 sqlite 原生用例）15 分钟超时未跑完，按任务指定的 6 文件子集验证（35 用例全过）。
