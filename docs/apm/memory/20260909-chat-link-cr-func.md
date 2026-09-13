---
date: 2026-09-09 23:36
title: 聊天链接文件跳转 cr-func 只读评审（export-link-skill-mgmt 波次）
keywords: [cr-func, chat-link-file-nav, resolveChatLinkTarget, linkClick, webview 拦截, export-link-skill-mgmt]
abstract: 对 chat-link-file-nav 特性做 readonly 功能评审：矩阵对照 Step 1~7 与 blocking 测试 T-L1~L6 全部落地；两处疑点（core-shim 未补、T-L3 fake 元素替代 jsdom）均判已接受偏离且等效；结论 func-ready yes。
---

# 聊天链接文件跳转 cr-func 只读评审

## 2026-09-09 23:36 · cr-func-chat-link（readonly 功能小检）

user:

> readonly 功能小检。节点：cr-func-chat-link，仓库 .worktree/export-link-skill-mgmt，Spec docs/Iterations/export-link-skill-mgmt-2026-09/features/chat-link-file-nav/spec.md。检查 A（Step 1~7 + blocking 测试 T-L1~L6 逐条对照）、G（verify 证据链可信）、spec_deviations（core-shim 未补、T-L3 fake 元素是否等效）。禁止修改任何文件。

assistant:

> 逐条核完：Step 1~7 与 T-L1~L6 全部真实落地——core resolveChatLinkTarget 五步识别（decode try/catch→scheme 正则 i 标志→协议相对 //→剥锚点→resolveLogicalPath）+ barrel 导出 + 快照补齐（e0cc452a）+ T-L1 十五用例含真机六形态；webview rows-click data-action 未命中后 closest('a') 分支（纯锚点 # 放行、其余 preventDefault + getAttribute 原始 href 上抛 linkClick）+ bridge 信封 + handleMessage 分支；mobile chat-link-nav.ts 纯依赖注入路由（session 先 project 后、list(parent) 仅 kind=file 命中、父目录抛错按未命中）+ openChatLink 意图执行 + SubagentSessionScreen parentSessionId 双钉；desktop MermaidMarkdown 条件 a 覆盖（data-chat-link 标记、未传 prop 渲染不变）+ MessageList 正文/流式尾巴双透传 + chat-link-route.ts（chat 域=core session 域命名陷阱注释+断言双钉）+ main.ts will-navigate/setWindowOpenHandler 双拦截（openExternal 前有 https? 正则白名单）。desktop 用 ipcVfsRead 一切非 ok（含 IS_DIRECTORY）按未命中，等效 mobile 的仅文件命中。两处偏离均判可接受：①core-shim 未补——chat-link-nav 经 @novel-master/core/chat 子路径导入，jest moduleNameMapper 直连 dist 真文件不经 shim（与 #31 记忆一致），spec 变更点 7 本身是「若经 barrel」条件句，条件未触发，实现轮 memory 已留关键发现记录；②T-L3 用 fake 元素——RN jest 无 jsdom 包，被测函数仅消费 closest/getAttribute/preventDefault 三接口，fake 语义等价且上抛走真实 post 模块断言 JSON 信封，比 jsdom 更贴 bridge 行为，实现轮 memory 有等效性论证。verify 证据链可信：desktop 22=chat-link-route 8+mermaid 14 精确吻合，core dist 已重建（dist/domain/chat/logic/resolve-chat-link-target.js 存在）、webview-dist/chat-transcript/app.js grep 含 linkClick、快照修复提交存在。无 must-fix，func-ready: yes。
