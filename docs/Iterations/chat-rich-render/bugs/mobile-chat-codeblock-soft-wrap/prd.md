---
date: 2026-07-23
dependency: Iterations/chat-rich-render/prd.md
---

# mobile-chat-codeblock-soft-wrap Bug PRD

## 背景

Mobile 聊天助手消息开启富文本后，围栏代码块（`<pre>`）内超长行不自动折行，只能横向滑动，窄屏阅读体验差。用户期望在保留缩进观感的前提下自动折行。

## 现象描述

富文本气泡中的 Markdown 代码块：长行不换行，只能左右横滑；视觉上像独立一块难以通读。

## 复现步骤

1. Mobile 开启聊天富文本（或查看已渲染的助手 Markdown 气泡）
2. 打开含围栏代码块且块内有明显超宽长行的助手消息
3. 观察代码块内长行行为

## 预期行为

代码块内长行在气泡宽度内自动折行；换行与缩进观感保留（`pre-wrap`）；极端不可断串仍可横滑兜底。

## 实际行为（修复前）

仅 `overflow-x: auto`，UA `white-space: pre` 导致长行不折、只能横滑。

## 影响范围

- Mobile 聊天 transcript / thinking 富文本代码块
- 同源 CSS 下的 VFS Markdown 文档预览代码块（共享 `rich-content-styles`）
- **不含** Desktop 聊天 Markdown（独立 `shell.css`）
- **不含** 引用块软换行折叠问题

## 验收标准

- Given Mobile 富文本气泡含超宽长行的 fenced code  
  When 查看该代码块  
  Then 长行在可视宽度内折行，无需仅靠横滑通读；行首缩进仍可辨认。

- Given 同源文档预览含同类代码块  
  When 预览  
  Then 同样 soft-wrap（单源样式）。

## 回归测试要点

- `rich-content-styles` 单测断言聊天与文档 CSS 均含 `pre-wrap` / `overflow-wrap`
- 真机需 `build:webview` 后目视确认
