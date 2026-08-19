---
date: 2026-08-20 00:40
title: 迭代后续反馈：mermaid 全屏缩放、查询页卡片化重设计、migration 清理探索
keywords: mermaid全屏, pinch缩放, 查询页重设计, 可折叠表单, migration清理, 基线, chat-improvements
abstract: 用户真机验证 mermaid 渲染成功后提两条新需求（图表全屏+放大、查询页改可折叠卡片式表单），另要求探索「10 个 tag 以前的 migration 清理」。探索结论：全屏通路现成缺 pinch 先例；mobile 长消息折叠其实已有、真正缺的是可折叠表单；migration 在 v1.4.22 已清过一轮（6 条出注册表），现存 5 条全在 10 tag 窗口内，再清需抬最低基线。
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
