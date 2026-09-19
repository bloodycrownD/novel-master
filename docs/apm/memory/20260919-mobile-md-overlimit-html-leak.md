---
date: 2026-09-19 23:10
title: mobile 工作区 markdown 预览超长不渲染 + fm-card HTML 透出——排查定性
keywords: [mobile, markdown 预览, overLimit, RICH_CONTENT_MAX_CHARS, fm-card, TrustedHtml, DocumentApp, yaml]
abstract: 用户报 mobile 工作区文件超长不渲染且透出 <div class="fm-card"> 原文、yaml 文件渲染也乱。定性：阈值 RICH_CONTENT_MAX_CHARS=12000（本为 RN RenderHTML/FlatList 护栏，WebView 引擎沿用）；HTML 透出根因是 rich-document WebView 的 DocumentApp.tsx plain 分支把 concatDocBodyHtml(fm, plain) 当 Preact 文本子节点输出（未过 TrustedHtml，违反其文件头自述注释），v1.4.21 引入。
---

# mobile markdown 预览超长 + HTML 透出排查

## 2026-09-19 23:10 · 定性分析（未修复）

user:

> 想起一个bug，mobile的工作区文件markdown渲染，当前如果文件超长，它就不渲染，且会出现 <div class="fm-card">这样的html透出的情况，类似还有yaml格式出问题，也有html透出的现象存在。首先超长时怎么定义的？我理解两三万字完全不大吧？怎么就超长了？而且超长透出html也完全不合理吧？

assistant:

> 排查结论：①「超长」= `rich-content-limits.ts` 的 `RICH_CONTENT_MAX_CHARS = 12_000`（UTF-16 码元，按 front matter 剥离后的 mdBody 计）。命中后 FileMarkdownPreview 置 mdBodyHtml=undefined，RichDocumentWebView 发 mode:'plain'+overLimit，WebView 显示原文 +「内容过长，已显示原文」。该阈值的注释自述是「Skip RenderHTML … FlatList performance guard」——本为旧 RN 引擎（RichContentBody/RenderHTML）的性能护栏，WebView 引擎直接沿用同一常量，未单独放宽。② HTML 透出根因：`web/rich-document/webview/ui/DocumentApp.tsx` 的 plain 分支写的是 `<div className="doc-body">{concatDocBodyHtml(fm, payload.plain)}</div>`——FM 卡片 HTML 串成了 Preact 文本子节点（没走 TrustedHtml），整段按字面显示；而 html 分支同数据是过 TrustedHtml 的，文件头注释还自述「frontMatterHtml 一律走 TrustedHtml」，plain 分支违反自述，属实现疏漏。git 历史仅两笔（v1.4.21 引入 + prettier），非新回归。③ yaml 场景：非 md 文件在 Markdown Tab 把全文喂 `prepareTranscriptRichHtml`（MarkdownIt html:true, linkify:true）——`#` 注释变标题、缩进折叠、内嵌 html 直接执行成真节点，故「yaml 格式出问题」；.yaml 超限 plain 回退本身不带 FM 卡片（frontMatterHtml 仅 md 路径构造），yaml 的「透出」实为 markdown 化副作用。④ 修法建议：leak＝plain 分支 FM 走 TrustedHtml、正文保持文本节点；阈值＝webview 路径单独放宽（如 20 万字级或移除，12k 仅保留给 RN legacy 引擎）；yaml/非 md 的 Markdown Tab 是否改 plain 渲染待拍板。两三万字对 markdown-it（毫秒级解析）+ WebView 完全不大，用户的判断成立。

## 2026-09-19 23:40 · 修复落地（fix/mobile-md-overlimit-leak）

user:

> 按你的建议修复吧

assistant:

> 两条建议落地（yaml 非 md 文件的 Markdown Tab 渲染方式涉产品意图，未动待拍板）。①透出修复沿既有合约测试的纯函数模式：document-model.ts 新增 buildDocumentBody descriptor（html 分支=concat 后整体 TrustedHtml；plain 分支=fmHtml 与 text 分离，FM 单独 TrustedHtml、正文保持文本节点），DocumentApp 改为消费 descriptor，头注释同步——原 plain 分支 concat(fm, plain) 当文本子节点输出的写法即透出根因。②阈值分轨：rich-content-limits.ts 新增 RICH_DOCUMENT_WEBVIEW_MAX_CHARS=200_000 与 isWebViewDocumentOverLimit；FileMarkdownPreview 按 previewEngine 选判定（webview→20 万字，rn 兜底→12k 保留 FlatList 护栏）。测试：合约测试 rich-document-doc-body-concat 翻新（plain 分支 fmHtml/text 分离的回归守卫 + dist 接线断言改 buildDocumentBody）、rich-content-limits 边界测试补 20 万字临界与「三万字对 webview 不超限」锚点、FileMarkdownPreview T7 改用 20 万字阈值并新增「12k+18k 正文正常渲染」锚点用例。mobile 全量 201 套件 1366 用例全绿（chat-transcript-webview 曾在全量首跑挂一次、单跑 30/30 过，判并行干扰），root typecheck 0 错。CHANGELOG Unreleased 补两条。

## 2026-09-19 23:55 · 非 md 文件 Markdown 标签页改 plain（用户拍板）

user:

> 非 md 文件在 Markdown 标签页按照plain渲染，就和文本标签页一样

assistant:

> 拍板落地：FileMarkdownPreview 把「文本 Tab」与「非 md 文件的 Markdown Tab」合并为同一条 plain 渲染路径（RN Text selectable + PreviewScrollWrap），非 md 不再走 prepareTranscriptRichHtml markdown 化全文——# 变标题/缩进折叠/内嵌 html 执行的错乱消失。连带删除死代码：nonMdBody/nonMdOverLimit/nonMdBodyHtml/nonMdUseWebViewPreview 四个 memo。批注口径：plain 永不 annotate（既有设计），非 md 会话文件原先在 Markdown Tab 可锚的批注随 plain 化不再可用（与文本 Tab 一致，用户口径「就和文本标签页一样」已覆盖此取舍）；FileEditorScreen 的 segmented 双 Tab 对非 md 保留（两 Tab 输出相同）。测试：T2 双引擎用例翻新为「不挂 WebView/RichContentBody + 原文字面显示」，新增 yaml 原文锚点用例（# 注释与缩进列表按原文）；mobile 全量 201 套件 1366 用例绿，root typecheck 0 错。CHANGELOG Unreleased 补「非 md 文件不再被强制 markdown 渲染」。
