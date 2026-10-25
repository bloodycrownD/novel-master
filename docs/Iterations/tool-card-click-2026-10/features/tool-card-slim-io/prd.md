---
date: 2026-10-05
dependency: []
---

# tool-card-slim-io Feature PRD（含子会话点击 bug）

## 背景与变更动机

v1.5.36（tool-card-click 迭代）落地了「工具卡片点击进结果阅读页」后，真机使用中用户提出两点：

1. curl/search 等工具卡片的**收起行直接显示入参 JSON 截断**（`{"url":"https://…","method":"GET",…}…`），信息密度差、观感噪声大。根因：core `summarizeToolInput` 只有 skill/task/fs/agent 四个分支，curl（入参 url/method/headers/body/timeout）与 search（入参 query/maxResults/engine）都不含 path/dir/from，落进公共尾巴的 `JSON.stringify(input)` 截 120 字兜底。
2. 点击卡片进入的**阅读页只展示输出正文**，看不到这次工具调用发了什么（入参）——curl 的 body/headers 这类信息只存在于原始入参里，光看输出无法判断「为什么发了这个请求」。

附带 bug（用户同轮报障）：**子会话里点击工具卡片进不了预览**。

## 范围说明（相对原需求）

- 卡片简化**不动卡片交互结构**（点卡=跳转/进阅读页的门控链原样保留），只改收起行摘要的内容来源——core `summarizeToolInput` 补 curl/search 分支，单源三端（desktop React / mobile WebView / mobile RN）自动生效。
- 阅读页升级为「输入 + 输出」两段：mobile 阅读屏（PromptTurnDetail 复用）拼「【输入】/【输出】」两段文本；desktop ToolResultViewerModal 渲染「入参」「结果」两个带标签区块。无入参的卡片保持旧形态（只显示输出）。
- 子会话 bug 一并修复（含同族受害者：技能卡片在子会话同样点了没反应）。
- 不包含：pending 期卡片可点（门控仍以可读结果为准）、阅读页标题区分同名工具多次调用（前置迭代 CR 已挂账的开放问题）、grep/glob 的 pattern 摘要分支（现状 path/dir 存在时不落 JSON 兜底，未再扩）。

## 现象描述与根因（bug 部分）

- 现象：子会话（SubagentSessionScreen）里点击 curl/search 等卡片无任何反馈；主会话正常。
- 根因：子会话屏的 `<ChatConversationWebView>` 只注入了 onOpenToolFile / onLinkClick / onOpenSubagentSession 三个 handler，漏 `onOpenToolResult`——webview 照常 post 桥消息，宿主侧 `onOpenToolResult?.()` 可选调用把消息**静默吞掉**（无报错无 toast）。同批漏掉的还有 `onOpenSkillDetail`（技能卡片同病）。desktop 不受影响（ToolResultViewerModal 是 window 级全局事件单实例监听，与视图树无关）。

## 影响模块与接口

| 层 | 模块 | 改动 |
|---|---|---|
| core | `packages/core/src/domain/chat/logic/tool-summary.ts` | curl/search 摘要分支；120 字截断抽 `clampSummary` 单源 |
| mobile WebView | `rows-click.ts` / `ChatTranscriptBridge.ts` | openToolResult 载荷扩 `inputJson?`（原文 pretty JSON） |
| mobile RN 宿主 | `useChatTabScope.ts` / `SubagentSessionScreen.tsx` / `ChatConversationWebView.tsx` | 阅读页两段拼装；子会话补两个 handler；effect deps 补漏 |
| desktop | `ToolResultViewer.tsx` / `shell.css` | 载荷扩 `inputJson?`；Modal 两段式 + 标签样式 |

## 验收标准

- Given curl 成功调用的卡片收起行，Then 显示 `GET https://…` 形态（method 缺省补 GET、超长截断），不再是 JSON 截断。
- Given search 卡片，Then 显示查询词（显式指定 engine 时 `查询词 · engine`）。
- Given 主会话/子会话点击 curl/search 卡片，Then 均进入阅读页，页面先「【输入】」（desktop 为「入参」标签区块）后「【输出】」（「结果」区块），入参为完整 pretty JSON、不截断。
- Given 无入参的卡片进阅读页，Then 保持旧形态（只有输出）。
- Given 子会话点击技能卡片，Then 正常跳技能详情（同族修复）。
- Given 全部既有门禁（core/desktop/mobile 定向 + typecheck + build:webview 契约），Then 不新增红。

## 测试用例

见 `spec.md` 测试策略节（T-TS-20..28 / T-TRW9-10 / 子会话 props 6 条 / T-TR9..10b，均含变异拔牙自证）。
