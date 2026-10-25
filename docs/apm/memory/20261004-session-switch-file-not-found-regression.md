---
date: 2026-10-04
tags: [mobile, chat-webview-unify, regression, vfs-file-manager, lost-fix]
source: 用户实报「切换会话，文件不存在或已删除」在 1.5.33 复发
---

# 切会话「文件不存在或已被删除」在 v1.5.33 复发——归因：v1.5.30 引入、10-02 的修复从未合入 main

## 用户诉求

用户报：`[$apm-recall] 切换会话，文件不存在或已删除 这个问题又出来了，你改什么了？1.5.33版本`。要求归因 1.5.33 改了什么导致复发。

## 归因结论（证据链完整）

**不是 v1.5.33 的改动引入的回归**。v1.5.32..v1.5.33 的 mobile 改动只有 `VfsFileManager.tsx` 菜单收敛（纯菜单/sheet/state，不碰加载链路与 key）、`ChatConversationWebView.tsx` webview ready 自愈（只动超时/AppState/renderProcessGone）、document-io/vfs-single-file 服务层——均与本 bug 链路无关。

真相反转：**2026-10-02 那轮修复丢了**——

1. 引入 commit：`6248500ae`（2026-10-01 18:49，chat-webview-unify wave-2「会话列表进 WebView——对话面板常驻+**去 key 强制重挂**」，SPA 化）——正是 bug 文档（`docs/Iterations/chat-webview-unify/bugs/workspace-stale-on-session-switch.md`）里写的根因：外层 key 强制重挂被去掉后，`VfsFileManager` 挂载 key 只含 `vfsRefreshKey` 不含 sessionId，跨会话复用同一实例，`currentPath` 残留旧会话子目录 → 切会话 reload 以新会话 VFS `list(旧目录)` 抛 NOT_FOUND → 弹「加载失败：文件不存在或已被删除。」。`6248500ae` 在 v1.5.30~33 四个 tag 里（v1.5.30 = 2026-10-02 发版）。
2. 修复未合入：**v1.5.30/31/32/33 四个 tag 上 `ChatConversationPanel.tsx` 的 key 全部是 `session-vfs-${vfsRefreshKey}`，从未出现过文档写的 `session-vfs-${sessionId}-${vfsRefreshKey}`**。`git log -S/-G` 全分支（含 archive/stash 分支、feat/composer-overlay）零命中修复 commit；`git stash list` 空；`git worktree list` 只剩主仓——当时做修复的 worktree/分支已被清理，代码无处可捞。
3. 残留物只有一份**未跟踪**的 bug 文档（git status `??`）：根因分析、修复方案、回归锁设计都完整写在里面，唯独代码没回来。当时「真机复验」大概率是在修复所在 worktree 构建的包上验的，验证通过后 worktree 被清、分支被删，合入动作漏掉。
4. 推论：v1.5.30/31/32/33 **四个版本全带此 bug**，用户「又出来了」的体感成立——1.5.30 遇到过、以为修了，1.5.33 仍在。

## 修复落点（待用户发话执行；编码须走 worktree 红线）

- `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:499`（注意：文件在 `screens/tabs/chat-tab/`，不在 `components/chat/`——旧路径已因 87a1d2f1d 拆分迁移，查历史须 `--follow`）：key 改 `key={`session-vfs-${sessionId}-${vfsRefreshKey}`}`，作用域内 `sessionId` 已被 489 行 `sessionId != null` 收窄，可直接用。
- 回归锁：`apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx` 补「工作区面板跨会话重挂」describe（sessionId 变化 → mount→unmount→mount；同会话重渲染不重挂）。文档里写明当时做过拔牙验证（key 去掉 sessionId 即红）。

## 修复落地（同日第二轮，用户拍板「直接主分支修改、赶紧上线 1.5.34」——用户明确指令覆盖 worktree 红线）

- commit `1774d0eb2`（main），tag `v1.5.34` 已推送触发 release.yml。内容：key 补 sessionId + key 上方钉防冲掉注释 + 回归锁 describe 两条（mount→unmount→mount / 同会话不重挂对照）+ CHANGELOG 1.5.34 修复条目 + 三处版本 bump。
- 门禁：定向 17/17（原 15+新 2）、拔牙验证（key 去 sessionId 首条红、对照组不受影响）、mobile tsc 0 错、三处 bump numstat 各 1/1。
- 过程小坑复用：PowerShell 管道在 cmd 外壳里改 package.json 引号全崩（desktop 那条侥幸成功且 diff 干净），mobile package.json 与 build.gradle fallback 改走 tmp 下一次性 node 脚本（字节级替换）——cmd 环境发版一律直接 node 脚本，别再试 PS 管道。

## 教训（与 RULE「发版前盘点未合并功能分支」同族，加重一档）

- **bug 修复做完必须落到可追溯的 git 状态**（合入 main 或至少保留分支/tag），文档先行、代码滞留 worktree 的中间态最危险——worktree 清理（2026-09-30 那轮）会把未合并修复连分支一起带走。
- 「用户报 X 复发」先查**上次修复是否真的在 main**：`git tag` 逐个 `git show <tag>:<file>` 验证关键行，别默认「修过=在」；`--follow` 查被移动过的文件。
- 本 bug 的完整机制、拔牙验证、残留已知问题（reload 失败保留旧 rows 的一般性形态不修）见 bug 文档，修复时照抄方案即可。
