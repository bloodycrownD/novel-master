---
date: 2026-08-19 21:00
title: 四项交互问题：PRD/SPEC 已落盘 worktree，待确认 spec 后实现
keywords: seq区间筛选, 会话改名不刷新, mermaid, 文本复制, PRD, SPEC, worktree, chat-improvements-2026-08
abstract: 四个问题（seq 区间筛选、mobile 改名不刷新、mermaid 渲染、文本模式复制）完成头脑风暴与 PRD/SPEC，全部落盘在 worktree .woktree/chat-improvements-2026-08；mermaid 范围已扩展到聊天气泡；spec 待用户确认后进实现。
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
