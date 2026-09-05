---
date: 2026-09-06 11:00
title: 克隆 pi-web-access 参考仓库
keywords: pi-web-access, reference, pi extension, web search, 借鉴学习
abstract: 应用户要求把 https://github.com/nicobailon/pi-web-access 克隆到 .reference/ 目录供之后借鉴学习；它是给 pi 提供网页搜索/内容抽取/视频理解的扩展（v0.28.0）。
---

user:
帮我把 https://github.com/nicobailon/pi-web-access clone 到 reference 目录，方便之后借鉴学习。

assistant:
已克隆到 `.reference/pi-web-access`（v0.28.0，最新提交 2026-09-04，8.7M）。它是 nicobailon 写的 pi 扩展，给 pi 提供 web search（Exa/Brave/Tavily/Kagi/SearXNG/DuckDuckGo 等二十多家搜索源、带 fallback 链）、URL 抓取与内容抽取（Firecrawl/Jina/RSC 解析/PDF 抽取）、GitHub 仓库直接 clone 而非爬 HTML、YouTube/本地视频理解（转写+帧抽取）。代码是单包平铺结构（index.ts + 各 provider 一个 ts 文件），MIT 协议。代理 127.0.0.1:7890 当天仍不可用，克隆用 `git -c http.proxy= -c https.proxy=` 绕过。
