---
date: 2026-08-19 23:59
title: 四项交互问题：开发 DAG 完成，dev-ready 待用户真机验收
keywords: seq区间筛选, 会话改名不刷新, mermaid, 文本复制, code-dev-loop, dev-ready, worktree, chat-improvements-2026-08
abstract: 四项需求经 spec-check-loop 后进入 code-dev-loop，三波次（3 impl 并行 → 3 verify 并行 → 3 cr-func 并行）全部完成：12 笔功能提交落在 worktree 分支 feat/chat-improvements-2026-08（HEAD 2ceb123），blocking 测试全绿、cr-func 均 func-ready；剩余 manual_user 真机验收留给用户。
---

user:
提了四个问题：①聊天详情页聊天记录查询加楼层筛选；②会话详情页改名无效；③文件预览 markdown 不支持 mermaid 渲染；④文本预览文本模式长按无法复制。

assistant:
brainstorm 结论（子代理探索）：①查询链路 core `MessageSearchQuery { keyword?, limit, beforeSeq? }`（message-content-match.ts）→ `SqliteMessageRepository.searchMessages` → desktop（ChatHistorySearchPanel + IPC）/mobile（ChatHistorySearchScreen 直调）；库里只有 seq 无楼层字段。②mobile 根因：`SessionDetailScreen.commitTitle`（约 L100-116）改名成功只更新本地 state，未通知 ChatTab；`useChatTabScope` 的 sessions 仅挂载时 reloadLists。desktop 链路闭环正常。③desktop 是 react-markdown+remarkGfm 无自定义 renderer；mobile 是 markdown-it→sanitize-html（白名单无 svg）→rich-document WebView；依赖无 mermaid。④mobile txt 分支 `<Text>` 未设 selectable（手工探索，因子代理 API 超长失败）。

user:
问题2 是 mobile；问题1 用 seq 编号，追问回滚会不会导致 seq 不连续。

assistant:
子代理探索结论：回滚是物理删尾（`deleteAfterSeq`：DELETE WHERE seq > ?），删后剩余 seq 连续无空洞；seq 生成是 `MAX(seq)+1`，回滚后新消息会复用旧 seq（跨时间不唯一）。中间空洞只来自单条 delete；hide/set-floor/compaction 全是 UPDATE 不删行。搜索 SQL/service 均不滤 hidden。

user:
先建 worktree，然后生成 PRD。

assistant:
建 worktree `.woktree/chat-improvements-2026-08`（分支 `feat/chat-improvements-2026-08`，基于 6226a97）。文档探索后按用户拍板拆三篇 PRD 落盘 worktree 的 docs/Iterations/：`chat-history-search-seq-range`（依赖 chat-history-search、message-set-floor、message-visibility）、`markdown-preview-mermaid`（依赖 mobile-vfs-markdown-webview、chat-rich-render、后加 mobile-webview-chat-transcript）、`mobile-chat-preview-ux-bugfix`（依赖 chat-session-detail-page、mobile-vfs-markdown-webview）。用户确认 seq 筛选**沿用现状含 hidden 消息**（业务需求）。

user:
生成 spec。

assistant:
三个探索子代理拿到实现级细节，三份 spec 已落盘（与 PRD 同目录）。关键约束：**seq 筛选**——过滤全在 core SQL 层，用 `AND (#{fromSeq} IS NULL OR seq >= #{fromSeq})` 同款 toSeq 模式（闭区间，对齐 updateHiddenRange 语义）；desktop handler `handleMessagesSearch` 是逐字段显式透传要补两行；UI 空串/NaN 归一 undefined，倒挂（from>to）UI 前置提示；service 层零改动。**体验修复**——`commitTitle` 成功后 `DeviceEventEmitter.emit('session-renamed', {sessionId, title})`，`useChatTabScope` 新增订阅→无条件 `reloadLists()`（范式对齐 useChatTabMessages.ts L260-274 的 session-transcript-changed）；txt 分支 `<Text selectable>`（先例 PromptPreviewSegmentCard）；**别动 L449 注释「plain/文本 Tab：禁用批注」**（有测试正则盯着）。

user:
Mermaid 不麻烦的话，让 message 也支持下吧。

assistant:
补探索 chat-transcript 管线后更新了 PRD（改题「Markdown Mermaid 图表渲染（预览与聊天消息）」）与 spec。要点：desktop 抽共享 `MermaidMarkdown` 组件，PreviewPane + MessageList（L46 MessageBody、L169 流式尾）三处复用，**按源码 memo**（流式每帧全量重渲会卡）；`preview-recogito-md.test.ts` L68 精确锁 `<Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>` 写法必须同步改（L62 禁 rehype-raw、L67/95 要保留 react-markdown 引用与 mdRootRef/preview-markdown 也不能破）。mobile 两条 WebView 管线：预览走 rich-document（新 `webview/runtime/mermaid.ts`，main.ts render 后挂接）；聊天走 chat-transcript（独立 runtime，懒加载+按源码去重+防抖）——**流式期每 rAF 整段替换 bubble-body innerHTML，必须只占位不渲染，streamCommit 定稿或历史路径（sessionSnapshot/prependPage/appendTailRows）才触发**。sanitize 白名单已保留 pre/code+class 零改动、不含 SVG（SVG 只能 WebView 内生成）；runtime 禁 JSX；样式单源 `web/shared/rich-content-styles.ts`（CHAT_TRANSCRIPT_RICH_CSS/RICH_DOCUMENT_RICH_CSS，build-webview.mjs 三 entry 注入）；改完要 `npm run build:webview`。已知瑕疵：流式轻量路径 mermaid 源码以纯文本露出约 350ms，占位样式兜底（PRD 已允许）。批注偏移是最大风险：成功态把源码 display:none 保留，Step 6 全量回归批注测试；真机仍闪烁则回退「聊天只显源码、预览保留图表」。

assistant:
当前状态：PRD 三份已确认；spec 三份待用户确认（mermaid 篇已按扩展范围重写），确认后进实现阶段。测试用例编号：seq 篇 T-CS11-16/T-DI7/T-MO3，mermaid 篇 T-MD1-4/T-MV1-4/T-MT1-3，修复篇 T-SD1/SD2/FP1，全部映射到 spec 的 Step（含 phase/blocking/qa 标注）。另：子代理派遣偶发 API「Prompt 超长」（错误码 1261）失败，精简 prompt 重试或按失败处理规则手工 readonly 探索均可。

user:
开发之前 check 一遍 spec 吧（spec-check-loop）。

assistant:
两轮收敛完成（第 1 轮三个并行 readonly 审查子代理 + mermaid doc-fix 子代理，第 2 轮复审）：
- **seq 筛选**：首轮 Go，3 条 P2 按 trivial 豁免直接补入 spec——Step 2 绑定值照 L338 beforeSeq 范式 `?? null` 归一（better-sqlite3 命名参数不接受 undefined）；Step 4 qa 从 auto 改 manual_user（desktop 无 renderer 组件测试基建，UI 并入 Step 6 手动验收）；Step 5 双端 fromSeq/toSeq state 须进 `runQuery` 依赖数组（翻页闭包旧值坑）；T-MO3 补「修改区间后翻页仍携带新区间」断言。
- **mobile 修复**：首轮 Go，P2 补入 spec——T-SD1 需在 session-detail-screen.test.tsx 的 react-native 全量替换式 mock 工厂（L145-192，无 requireActual）补 `DeviceEventEmitter: {emit}` 导出。审查逐行确认顶栏标题消费链单一：reloadLists → setSessions → currentSession（useChatTabScope L164）→ ChatTabNavigationProvider L96-97 sessionTitle，无额外缓存，spec 的「推断」风险实际成立。
- **mermaid**：首轮 No-Go——P0 是 spec 内共享组件与就地 components 两方案并存，且「保留 react-markdown 直引」与 preview-recogito-md.test.ts L67 断言、根 tsconfig.base.json noUnusedLocals（死导入编译报错）硬冲突。doc-fix 子代理统一为 MermaidMarkdown 共享组件方案：L67/L68 断言改匹配 MermaidMarkdown、react-markdown/remarkGfm 契约断言转移到 MermaidMarkdown.tsx、补流式未闭合 fence 策略（占位源码、不触发 render、不挂失败标识）、themeUpdate 图表配色陈旧写为已知限制、每次 render 唯一 id。第 2 轮复审 Go，另两条实现注已补入 Step 2：未闭合 fence 判定须在组件层对原始 content 做围栏配对检测（remark 解析后「是否闭合」信息已丢失，renderer 层拿不到）；动态 import('mermaid') 与 render 只能放 useEffect（message-list-stream.test.tsx 用 renderToStaticMarkup 静态渲染不跑副作用）。
状态：三份 spec 均 execute-ready，待用户确认后按 Step 顺序开工。

user:
开发吧（code-dev-loop）。

assistant:
DAG 三波次全部完成（dag_version 1，无 not-ready 重编排）：
- **wave-0**：impl-seq / impl-mermaid / impl-fix 三个子代理并行（文件零重叠，各自只 add 自己的文件避免提交竞态），共 10 笔功能提交 + 1 笔子代理记忆提交。期间修复了 worktree 无 node_modules 的环境问题（workspace 链接 + core dist 构建）。
- **wave-1**：三个 verify 并行全绿——core 17/17、desktop handler 7/7、mobile search 9/9、desktop 定向 65/65、mobile 5 套件 51/51、build:webview 三 entry、三端 typecheck。
- **wave-2**：三个 cr-func 并行均 func-ready: yes、无 open must-fix/spec_deviations。已声明可接受的偏离：T-MV2/T-MT3 失败态用源码契约+纯逻辑单测替代 jsdom（mobile Jest 是 RN preset 无 jsdom，spec Step 4 留了「可自动部分」口子）；WebView bundle 因 minify:false 实际 +7MB 级（spec 预估 1MB 级，发布说明需兑现）；小数输入（10.5）不被拦截但对整数 seq 语义等价收紧。
- 主代理 trivial 补丁：T-MD4 断言改 matchAll 计数钉死 MessageList 两处用法（2ceb123）。
- HEAD 2ceb123，工作区干净；子代理散落的过程记忆已合并清理。
待办：manual_user 真机验收（seq Step6 PRD#1-8 / mermaid Step7 PRD#1-10 / fix Step4 PRD#1-8）；存量问题代报：mobile use-chat-tab-message-actions-unhide.test.ts 是 77d3b69 拆卸功能时漏拆的孤儿测试（与本次无关）；desktop 4 个构建产物类测试需先 npm run build。
