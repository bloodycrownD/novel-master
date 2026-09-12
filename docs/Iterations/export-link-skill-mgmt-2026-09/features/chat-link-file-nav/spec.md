---
date: 2026-09-06
---

# 聊天 markdown 文件链接跳转工作区文件 技术规格（SPEC）

## 设计目标

按 PRD（同目录 `prd.md`）落地 Typora 式链接路由：markdown 语法链接（相对/绝对/锚点三形态）点击后在应用内打开工作区文件预览；http(s) 维持外跳；desktop 修复整窗导航缺陷。wiki 风格与裸路径维持纯文本（零改动）。

依据：探索报告 B（webview 点击链、bridge 协议、双端预览管道、主进程缺口，log 20260906-231624-520）。真机样本六形态已验证（2026-09-06 实测：中文 href 被 URL 编码）。

## 总体方案

**拦截策略：webview 对所有 `<a>` 一律 preventDefault + 上抛原始 href，识别与路由全部在宿主侧（RN / desktop renderer）完成。**理由：webview bundle 不依赖 core（识别函数无法进 webview）；iOS `shouldStartLoadWithRequest` 与 DOM 事件的时序差异使「webview 侧选择性拦截」不可靠；宿主统一仲裁口径单一。现有 `shouldStartLoadWithRequest` 导航守卫（sec/D-1）**保留不动**，退化为兜底（防伪造桥消息的攻击面不扩大）。

**识别函数 core 单源**：`packages/core` 新增纯函数 `resolveChatLinkTarget(href: string): string | null`——try `decodeURIComponent`（非法百分号序列 throw → null）→ scheme 检测（`/^[a-z][a-z0-9+.-]*:/i` 命中 → null，含 `HTTP://` 大写形态；`//` 开头协议相对地址 → null）→ 剥 `#` fragment（纯锚点 `#foo` 在 webview 侧即放行，不进此函数）→ `resolveLogicalPath` 归一化（try/catch `INVALID_PATH` → null）→ 返回逻辑路径。mobile RN 与 desktop renderer 直接 import core。

**探测原语**：mobile 用 `runtime.sessionVfs/projectVfs` 的 `list(parentDir)` 比对 basename（`VfsService` 无 stat；`read` 拉全文 IO 代价大、`glob` 有 pattern 转义问题；父目录 NOT_FOUND → 不存在）。desktop 用 `ipcVfsRead` + `error.code === 'NOT_FOUND'` 判定（通道现成）。**探测顺序：先 session 工作区后 project 工作区**；desktop 注意命名陷阱——workspaceScope `"chat"`=core session 域、`"session"`=core project 域（`PreviewPane.toCoreVfsScope`）。

**子会话口径**：mobile `SubagentSessionScreen` 探测与打开 session scope 均用 `parentSessionId`（子会话共享父工作区，272-281 行先例）。

## 最终项目结构（变更文件）

| 文件 | 变更 |
|------|------|
| `packages/core/src/domain/chat/logic/resolve-chat-link-target.ts` | 新增识别纯函数 + 单测 |
| `packages/core/src/public/*.ts`（barrel） | 导出 |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts` | `<a>` 拦截分支 |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `linkClick {href}` 信封 |
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | handleMessage 分支 + `onLinkClick` prop |
| `apps/mobile/src/screens/tabs/chat-tab/chat-link-nav.ts` + `useChatTabScope.ts` | 独立路由核心函数（可导入直测）+ `openChatLink` 接线 |
| `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | 两路 transcript 接 `onLinkClick` |
| `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx` | 同款接线（parentSessionId） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `onLinkClick?` prop + components `a` 覆盖 |
| `apps/desktop/renderer/features/chat/MessageList.tsx`、`ConversationPanel.tsx` | 透传回调 + 路由函数 |
| `apps/desktop/renderer/features/chat/chat-link-route.ts` + `providers/ShellNavProvider.tsx` | 独立路由核心函数（node:test 可直测）+ 接线 |
| `apps/desktop/src/main/main.ts` | `will-navigate` + `setWindowOpenHandler` 拦截 |

## 变更点清单

1. core：`resolveChatLinkTarget` 纯函数 + barrel 导出（dist 重建，mobile 经 metro 消费）。
2. mobile webview：`rows-click.ts` 在 data-action 未命中后加 `target.closest('a')` 分支——`href` 以 `#` 开头（纯锚点）直接 return 放行 webview 默认滚动；否则 `preventDefault` + `post('linkClick', {href})`（需把原生 click 事件传入 handler 以调 preventDefault，`bind-shell-events` 的 addEventListener 已可得）。
3. bridge：`TranscriptToHostMessage` 加 `linkClick`；RN `handleMessage` 分发到新 prop `onLinkClick?.(href)`。
4. mobile RN 路由（独立函数 `screens/tabs/chat-tab/chat-link-nav.ts` + `openChatLink` 接线）：http(s) → `Linking.openURL`（承接原守卫的主路径职责）；mailto 及其它 scheme → 无动作（维持现状）；`resolveChatLinkTarget` 非空 → session `list(parent)` 探测（仅 `kind === 'file'` 命中，目录目标 no-op）→ project 探测 → 命中 `openFileEditor(path, 'session'|'project')`（session 需 projectId+sessionId 齐全，缺参降级 no-op）→ 未命中弹「文件路径不存在：{path}」toast（2026-09-12 用户拍板，替代原 no-op 口径）。
5. desktop：`MermaidMarkdown` 加可选 `onLinkClick`，components 加 `a` 分支（preventDefault + 回调；**未传 prop 时组件渲染行为不变**；PreviewPane 消费点不传——其内链接点击行为随主进程拦截统一收紧为外部打开，属改善方向）；`MessageList.tsx` 两处 `MermaidMarkdown` 消费点（`MessageBody` 正文 + 流式尾巴 `chat-message--streaming` 块，:224-227）均透传 `onLinkClick`；`ConversationPanel` 注入路由函数；路由核心抽为独立可导入文件 `renderer/features/chat/chat-link-route.ts`（`resolveChatLinkTarget` → `ipcVfsRead` 探测 chat 域后 session 域，仅 `kind === 'file'` 命中、一切非 ok 响应按未命中（留日志）→ 命中 `selectPreviewFile(命中域, path)` + `ensurePreviewVisible`；http(s) → 直接消费现成 `ipcAppOpenExternal`（`nm:shell/openExternal`，`ipc/client.ts:168` 已导出，勿另开 helper）；mailto → no-op；双域未命中 → 弹「文件路径不存在：{path}」toast，2026-09-12 用户拍板、与 mobile 同口径），`ShellNavProvider` 只做接线。
6. desktop main：`createMainWindow` 挂 `webContents.on('will-navigate')`（preventDefault；http(s) → `shell.openExternal`）与 `setWindowOpenHandler`（deny + http(s) openExternal）。
7. mobile jest core-shim：RN 侧新消费 `resolveChatLinkTarget`，若经 `@novel-master/core` barrel 引用，须在 `test-utils/core-shim.ts` 补导出（web-search 迭代踩过的坑）。

## 详细实现步骤

- Step 1 — phase-link-core — blocking: yes — qa: auto：core 新增 `resolve-chat-link-target.ts` + barrel 导出 + 单测（用例覆盖真机六形态：相对/绝对/锚点/不存在文件路径/中文 URL 编码/`//` 协议相对 + `http(s)`/`mailto`/裸 `%` 非法序列/空 href）。
- Step 2 — phase-link-webview — blocking: yes — qa: auto：`rows-click.ts` 加 `<a>` 分支（纯锚点放行、其余 preventDefault + post `linkClick`）；`ChatTranscriptBridge.ts` 加信封；`ChatTranscriptWebView.tsx` handleMessage 加分支 + `onLinkClick` prop。
- Step 3 — phase-link-mobile-host — blocking: yes — qa: auto：路由核心抽为独立可导入函数（`apps/mobile/src/screens/tabs/chat-tab/chat-link-nav.ts`：识别→探测（`list(parent)` 仅 `kind === 'file'` 命中）→返回打开意图）；`useChatTabScope.ts` 的 `openChatLink` 只做意图执行（openFileEditor / Linking / no-op）；`ChatConversationPanel.tsx` 的 webview 路 transcript 接 `onLinkClick={scope.openChatLink}`（legacy 路 `RichContentBody` 纯文本渲染无 `<a>`，不接线、保持现状）；`SubagentSessionScreen.tsx` 接同款（session 探测/打开均用 `parentSessionId`）。
- Step 4 — phase-link-desktop-render — blocking: yes — qa: auto：`MermaidMarkdown` 加 prop + `a` 覆盖；`MessageList.tsx` 两处消费点（正文 + 流式尾巴）透传；`ConversationPanel.tsx` 注入；`ShellNavProvider.tsx` 加路由函数（探测顺序 chat→session 域；命中 `selectPreviewFile`）。
- Step 5 — phase-link-desktop-main — blocking: yes — qa: auto：`main.ts` 补 `will-navigate` + `setWindowOpenHandler` + `shell.openExternal`。
- Step 6 — phase-link-tests — blocking: yes — qa: auto：见测试策略全部用例。
- Step 7 — phase-link-changelog — blocking: no — qa: auto：CHANGELOG Unreleased 记行为变更（链接应用内跳转 + desktop 外链不再整窗导航）。
- Step 8 — phase-link-manual — blocking: no — qa: manual_user：真机点击真机样本六形态链接 + desktop 外链点击，目检路由结果（合并后用户验收）。

## 测试策略

### 测试用例

- T-L1 — blocking: yes — Step 1：core `resolveChatLinkTarget` 单测（六形态真机样本 + 编码/非法序列/协议相对/scheme/`HTTP://` 大写/`C:/x` 盘符形态用例，node:test）。
- T-L2 — blocking: yes — Step 2：mobile bridge round-trip 测试加 `linkClick`（照 `openToolFile` 先例，`chat-transcript-bridge.test.ts`）。
- T-L3 — blocking: yes — Step 2：`rows-click` jsdom 行为测试——`<a href="x.md">` 点击触发 preventDefault + post `linkClick`；`<a href="#foo">` 不拦；`data-action` 元素点击不受影响。
- T-L4 — blocking: yes — Step 2：`sanitize-rich-html.test.ts` 扩用例：中文相对/绝对路径 href 经 sanitize 后保留（保障拦截链路有料可拦）。
- T-L5 — blocking: yes — Step 3：RN 路由函数测试（mock vfs list/Linking）：session 命中→FileEditor(session)；仅 project 命中→FileEditor(project)；双未命中→弹「文件路径不存在」toast（2026-09-12 拍板）；http(s)→Linking；子会话用 parentSessionId（照 `file-editor-screen` / chat-tab 集成测试模式 + core-shim 补导出）。
- T-L6 — blocking: yes — Step 4/5：desktop `mermaid-markdown.test.tsx` 静态渲染断言 `a` 带回调接线、未传 prop 时无拦截；`main.ts` 源码断言含 will-navigate/setWindowOpenHandler（照静态/源码双轨模式）；流式尾巴消费点接线断言（同双轨）；路由函数 node:test 直测（mock `ipcVfsRead` 的 ok/NOT_FOUND 两态 + 探测顺序断言）。
- T-L7 — blocking: no — qa: manual_user：Step 8 真机验收矩阵。

## 风险与回滚方案

- preventDefault 全拦后 http(s) 不再走原生守卫主路径：宿主 `Linking.openURL` 显式承接；守卫保留为兜底（T-L3/T-L5 双保险）。外跳失败静默兜底语义与现状一致。
- core-shim 白名单漏补 → mobile 测试 undefined 崩（Step 3 内已列，照 web-search 迭代坑）。
- desktop `"chat"`/`"session"` 命名反直觉：T-L6 用注释 + 断言双钉。
- 大目录 `list` 探测的 IO：`list(parentDir)` 非递归单层，成本可控。
- 回滚：feature 分支 revert；core 新函数为纯增量导出，无消费者残留风险。
