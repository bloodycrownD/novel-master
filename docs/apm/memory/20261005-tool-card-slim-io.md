---
date: 2026-10-05
tags: [mobile, desktop, chat, tool-card, preview, subagent-session, agile-dev]
source: 用户要求工具卡片优化：curl/search 等卡片参数不应直接在卡片展示、应像 fs/skill 一样简化，点击进入的预览页展示完整输入与输出；另报子会话貌似不支持点击卡片进预览
---

# 工具卡片瘦身 + 预览页完整 I/O + 子会话点击修复（tool-card-slim-io）

## 2026-10-05 第 1 轮

**user**: 工具卡片优化：curl/search 等工具卡片参数不应直接在卡片上展示，应像 fs/skill 一样简化；点击进入的预览页应展示完整输入与输出。另外发现子会话貌似不支持点击卡片进入预览。

**assistant**: agile-dev 立项 feature「tool-card-slim-io」（迭代挂 tool-card-click-2026-10 下，含一个 bug 子项）。worktree `D:\Dev\nm-worktree\tcs`，分支 `feat/tool-card-slim-2026-10`（base=main ab436341d / v1.5.37），依赖已装。两路 readonly 探索结论：

1. **参数上卡根因**：main 上 `summarizeToolInput`（packages/core/src/domain/chat/logic/tool-summary.ts）只有 skill/task/fs/agent 四分支；curl 入参是 {url,method,...}、search 是 {query,...}，都不含 path/dir/from，落公共尾巴 `JSON.stringify(input)` 截 120 字——卡片一行直接显示 JSON。修法=补 curl（`METHOD url`）/search（`query`）分支，core 单源三端生效。
2. **预览页缺输入**：阅读页载荷只有 {title, content}（rows-click.ts:92-95 → ChatTranscriptBridge.ts:244 → useChatTabScope.ts:786-795 复用 PromptTurnDetail 阅读屏 renderKind=txt；desktop ToolResultViewer.tsx 单 pre）。入参在 `ToolCallRow.input` 现成可得（rows-click 的 findToolRowByUseId 反查整行）。修法=桥载荷扩 `inputJson`（原文 pretty JSON，不用截断预览形态），mobile 拼「【输入】/【输出】」两段文本，desktop Modal 两区块。
3. **子会话 bug 根因**：SubagentSessionScreen 的 ChatConversationWebView 只传 3 个 handler，漏 `onOpenToolResult`（同族还漏 `onOpenSkillDetail`），桥消息被 `onOpenToolResult?.()` 可选调用静默吞——不是导航失败，是没有 handler。子会话屏与 PromptTurnDetail 同在 RootStack，具备 push 条件；desktop 不受影响（window 全局事件单实例监听）。附带隐患：ChatConversationWebView onMessage effect deps 漏 onOpenToolResult；memo 比较器不比 handler prop（必须 useCallback）。

**重要分支事实（待用户拍板）**：`feat/ui-card-unify-2026-10`（ucu R4-R6）**未合 main**（merge-base=1774d0eb2/v1.5.34 前后，HEAD=bc7855477），其 R6 是「点卡原地展开 + 删阅读页」路线，与已上线的 tool-card-click（v1.5.36 阅读页路线）并行冲突（tool-summary.ts 等三处必撞）。本轮用户诉求延续 main 阅读页路线，基于 main 实现；ucu 分支 R4-R6 去向（废弃/重做/部分 salvage）需用户决定。

状态：**已发版 v1.5.38（2026-10-05）**。第二轮：用户拍板合并 → main fast-forward 三笔 + changelog Unreleased 三条（d0efeb7fd）；main 重建 core dist 与 webview 产物后复验 core 28/28、mobile 44/44、desktop 18/18。真机：tcs worktree 出 debug 包覆盖安装（versionCode=1，-r -d 保数据），Metro 起 8084（8081=tsi 家、8082=主仓+QQ、8083 被占），reverse tcp:8081→8084。第三轮发版：bump 四件（numstat 全 1/1、lock 2/2）、CHANGELOG 定稿四条（变更二/修复一/维护一含第五轮 migration）、门禁 mobile 全量 2068/2068（--maxWorkers=2）+ desktop 730/730 + core bootstrap 66/66、提交 44d266dbc、tag v1.5.38 + main 已推、Release #124 CI 构建中。另见同日第五轮 migration 清理（memory/20260906-migration-cleanup-10tag.md）。
