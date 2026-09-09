---
date: 2026-09-06
---

# 聊天工作区「推送到项目工作区」技术规格（SPEC）

需求来源：`docs/Iterations/feature-optimizations-2026-09/features/workspace-push/prd.md`

## 设计目标

在双端聊天工作区提供与「从上级同步」完全对称的「推送到项目工作区」操作：core 侧复用方向无关的既有底层件做镜像实现，双端按现有 pull 入口模式接线；推送后项目工作区（该项目所有会话的模板母本）被当前聊天工作区整树覆盖，workplace 目录规则一并推送。

## 总体方案

推送 = 拉取链的镜像，core 几乎零新逻辑：

- **core**：`TemplatePullService` 端口扩展 `sessionTemplatePush(sessionId)`；新增逻辑文件镜像 `initialize-session-workspace.ts`——事务内 `replaceVfsSubtree(session → project)` + `worktree.copyScope(session → project, mapSessionWorkplacePathToProject)`；无 `clearCheckpoints`（project 域没有 checkpoint/版本链外挂，`head_version` 仅记账）。`SessionService` 增 `pushTemplate` 出口——三端 runtime（desktop/mobile/CLI）都持有同一 SessionService 实例，接口即通。
- **desktop**：`SESSIONS_PUSH_TEMPLATE` IPC 全链（ipc-types → handler → handler-registry → invoke-registry/client）；`WorkspaceHeaderActions` 的 chat 分支加「推送到项目工作区」菜单项（danger 确认弹窗）；handler 成功后 `notifyWorkspaceMutatedToRenderer({workspaceScope:'session', projectId})` 触发项目工作区面板刷新。
- **mobile**：`VfsFileManager` 增 `pushToParent` prop；新增 `TemplatePushButton`（镜像 `TemplatePullButton`）；`ChatConversationPanel` 挂载，`onPushed` 复用 `bumpWorktreeUiToken`（该 key 同时驱动聊天工作区与项目工作区两个面板重挂载，天然双刷）。

### 关键现状与依据（探索证据）

1. `replaceVfsSubtree`（`vfs-tree-copy.ts:338`）方向无关：sweep 释放目标前缀 live 引用 → `deleteVfsPrefix` 批量删 → `copyVfsTree`（blob 共享快路径）→ `seedLiveHeadRevisionsUnderPrefix` 补种。from/to 对调即推送。
2. `worktree.copyScope`（`sqlite-workplace.repository.ts:238`）自带覆盖语义（先 `deleteScope(to)` 再批量 upsert）；`mapSessionWorkplacePathToProject` 现成（当前恒等 normalize）。
3. **scope 命名陷阱**：desktop IPC/renderer 的面板 scope `'session'` 经 `resolve-vfs-scope.ts` 映射到 core `{kind:'project'}`（「会话工作区」面板实为项目工作区），`'chat'` 才是 session 域。所有 payload、notify、文案一律用 IPC 面板语义，实现时勿混。
4. **历史缺陷已核实为环境问题**：2026-08-19 记忆的「replaceVfsSubtree 删除侧不彻底」在当前 src 无缺陷——core 层 `template-pull.test.ts` 有删除侧断言且绿；本地 CLI e2e T3 红是主检出 `packages/core/dist` 陈旧（mtime 8/19，CLI 经 tsx 消费 dist）。验证 CLI e2e 前必须 `npm run build -w @novel-master/core`，红灯勿误判回归。
5. 子会话：mobile `SubagentSessionScreen` 无工作区面板，入口天然不出现；desktop 子会话视图（`subagent-conversation`）会渲染 chat 面板，现状「初始化」可见且作用于父工作区——**推送与「初始化」本次一并 gate 在子会话视图隐藏**（用户拍板：子会话页面不提供覆盖类操作，面板纯观感）。
6. 事务边界镜像 pull：`conn.transaction` 包裹 replace + copyScope；`runDeferredBlobGc` 放事务外（全库 GC）。

## 最终项目结构

```
packages/core/src/service/template/
  logic/push-session-workspace.ts        新增（镜像 initialize-session-workspace.ts）
  template-pull.port.ts                  改：TemplatePullService 增 sessionTemplatePush
  impl/template-pull.service.ts          改：实现 sessionTemplatePush
packages/core/src/service/chat/
  session.port.ts                        改：SessionService 增 pushTemplate
  impl/session.service.ts                改：实现（委托推送服务）
packages/core/test/service/template/push-session-workspace.test.ts   新增
apps/desktop/shared/ipc-types.ts         改：通道 + SessionPushTemplateRequest
apps/desktop/src/main/ipc/handlers/sessions.ts   改：handleSessionsPushTemplate
apps/desktop/src/main/ipc/handler-registry.ts    改：bindReq
apps/desktop/renderer/ipc/invoke-registry.ts + client.ts   改
apps/desktop/renderer/features/workspace/WorkspaceHeaderActions.tsx  改：菜单 + 确认 + gate
apps/mobile/src/components/prompt/TemplatePushButton.tsx   新增
apps/mobile/src/components/vfs/VfsFileManager.tsx          改：pushToParent prop
apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx  改：挂载
apps/mobile/src/components/icons/TabIcons.tsx              改：推送图标（镜像 SyncPullIcon 上箭头）
```

## 变更点清单

| 层 | 改动 |
|---|---|
| core | 新增 push 逻辑与端口方法；SessionService 出口；测试 |
| desktop | IPC 全链 5 文件；菜单项（danger）+ 子会话 gate；handler 成功后 notify |
| mobile | 按钮 + prop + 挂载 + 图标；确认文案区分 pull（覆盖母本 vs 丢失本地修改） |
| 文档 | CHANGELOG Unreleased 新增条目 |
| 不动 | CLI（PRD 排除）、global 域、面板改名、选择性推送/撤销 |

## 详细实现步骤

- Step 1 — phase-push-core — blocking: yes — qa: auto：新增 `push-session-workspace.ts`（镜像 initialize-session-workspace：事务内 replaceVfsSubtree(session→project, revisions+contentStore 同款) + copyScope(session→project)）；`TemplatePullService` 端口与实现加 `sessionTemplatePush`（findById 校验存在 → transaction → runDeferredBlobGc）；`SessionService.pullTemplate` 旁加 `pushTemplate` 委托；public 出口按需补类型。
- Step 2 — phase-push-core — blocking: yes — qa: auto：core 测试 `push-session-workspace.test.ts`：整树覆盖含删除 project 侧孤儿、目录规则覆盖、blob/revision 无孤儿（对齐 vfs-gc-trigger 模式）、会话不存在抛 chatNotFound、事务失败回滚不留半态；既有 pull 测试不动全绿。
- Step 3 — phase-push-desktop — blocking: yes — qa: auto：ipc-types 加 `SESSIONS_PUSH_TEMPLATE: 'nm:sessions/pushTemplate'` 与 `SessionPushTemplateRequest = {sessionId}`；handler 调 `rt.sessions.pushTemplate` 成功后 `notifyWorkspaceMutatedToRenderer({workspaceScope:'session', projectId})`（projectId 经 `rt.sessions.get(req.sessionId).projectId` 取得，不改 Request 形状；失败不 notify）；registry/invoke/client 接线；`WorkspaceHeaderActions` chat 分支加菜单「推送到项目工作区」+ ConfirmKind `push-template`（danger），确认文案：「将用当前聊天工作区覆盖项目工作区。项目工作区是该项目所有会话的模板母本，之后新建的会话与其它会话的「从上级同步」都会拿到覆盖后的内容。」；子会话视图不渲染「推送」与「初始化」两项——`WorkspaceHeaderActions` 已在用 `useShellNav()`，直接读 `subagentSessionId != null` 判定，无需新增传递链。
- Step 4 — phase-push-mobile — blocking: yes — qa: auto：`TemplatePushButton`（Alert 确认 → `runtime.sessions.pushTemplate` → toast「推送完成」）；`VfsFileManager` 增 `pushToParent?: {scope; onPushed?}` 工具栏并排渲染；`ChatConversationPanel` 传 `pushToParent={{scope, onPushed: bumpWorktreeUiToken}}`；TabIcons 增推送图标。
- Step 5 — phase-push-docs — blocking: no — qa: auto：CHANGELOG Unreleased 新增推送条目；另记一条 desktop 行为变更：子会话视图隐藏聊天工作区的「初始化」（覆盖类操作收敛到主会话）。
- Step 6 — phase-push-verify — blocking: no — qa: manual_user：真机双端各做一次推送，推送后新建会话验证母本已更新；desktop 切到项目工作区面板看到新内容；实现阶段 build core dist 后顺手补跑一次 CLI template-pull e2e 闭环 PRD 风险条。

## 测试策略

- T-WP1 — blocking: yes — push 整树覆盖：project 有 A/B、session 有 B'/C → push 后 project 为 B'/C（A 被删，删除侧有断言）。
- T-WP2 — blocking: yes — 目录规则覆盖：push 后 project 规则 = session 版本（copyScope 覆盖语义）。
- T-WP3 — blocking: yes — blob/revision 无孤儿（deferred GC 路径断言，镜像 pull 用例）。
- T-WP4 — blocking: yes — 会话不存在抛 chatNotFound；事务回滚不留半态。
- T-WP5 — blocking: yes — pull 回归：既有 pull/template 测试全绿不动。
- T-WP6 — blocking: yes — desktop handler：成功调 pushTemplate 且 notify payload 为 `{workspaceScope:'session', projectId}`；失败不 notify。
- T-WP7 — blocking: yes — desktop 菜单：chat 面板且非子会话视图可见推送项、确认后才执行；子会话视图推送与「初始化」均不可见。
- T-WP8 — blocking: yes — mobile：确认弹窗取消不调用、确认调用 pushTemplate 且出 toast；工具栏 pull/push 并排。
- T-WP9 — manual_user — 真机验收（Step 6）。

环境约束：实现于 `.worktree/<branch>` 独立 worktree（主仓 node_modules 当前有 mermaid 11.17.2 与 lock 的 drift，worktree 独立 npm install 不受影响）；core 改动后 `npm run build -w @novel-master/core`；desktop 测试 `NODE_ENV=development npm test -w @novel-master/desktop`；mobile 测试 `NODE_ENV=test npx jest`、typecheck 用官方脚本。

## 风险与回滚方案

- 风险：scope 双关命名（IPC 'session' = core project 域）写错 payload → 用 T-WP6 锁死 notify payload。
- 风险：desktop 面板互斥挂载下「即时刷新」实际表现为切换面板后重挂载即见新内容（现状机制即如此，spec 不新增机制，验收按此口径）。
- 回滚：功能独立成链，revert 提交即可完整回退；无 schema 变更、无数据迁移。
