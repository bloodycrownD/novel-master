# bug：切会话弹「文件不存在或已删除」toast + 工作区文件点开空白（2026-10-02）

## 症状（用户真机实报，v1.5.30）

- 切换会话时总是弹「文件不存在或已被删除。」toast（前缀为「加载失败：」）；
- 随后打开「聊天工作区」点文件，FileEditor 打开是空白页，再弹一次同文案 toast（前缀为「读取失败：」）；
- 稍等片刻（退目录 / 点到两边都存在的目录等触发新一轮加载后）恢复正常。

## 根因

SPA 化（会话列表进同一 WebView 文档）去掉外层 `key={chatScrollKey}`（含 projectId+sessionId）强制重挂后，工作区面板 `VfsFileManager` 的挂载 key 只含 `vfsRefreshKey` 不含 sessionId——组件从「随会话重挂」变成「跨会话复用同一实例」，但内部状态没有随会话重置：

1. 浏览位置 `currentPath` 残留旧会话的子目录 → 切会话瞬间（sessionId 变化使 `sessionWorktree` 换新引用，面板即便隐藏也会跑 `useEffect([reload])`）reload 以新会话 VFS `list(旧目录)` → `DefaultVfsService.list` 对「目录行不存在且无子项」抛 NOT_FOUND（`vfs.service.ts` list 分支）→ 弹「加载失败：文件不存在或已被删除。」——**切会话动作本身就弹，无需打开工作区面板**；
2. reload 失败后 `setRows` 未执行 → 列表停留在旧会话文件（loading=false 可点）→ 点文件 → `openFileEditor(旧path, 'session')` 以**新 sessionId** navigate → FileEditor `vfs.read` NOT_FOUND → 弹「读取失败：文件不存在或已被删除。」且 content 为空 = 空白页。

SPA 化之前外层 key 重挂让 currentPath/rows 每次切会话归零，所以旧版无此症状——本 bug 是 SPA 化的回归。

## 修复

`ChatConversationPanel.tsx` 工作区挂载点 key 补 sessionId：

```tsx
key={`session-vfs-${sessionId}-${vfsRefreshKey}`}
```

切会话 = 整实例重挂，currentPath/rows/面包屑缓存/批选态全部归零，与 SPA 化前行为等价；`vfsRefreshKey` 维持「保存成功后强制重挂」的既有语义。全仓 `VfsFileManager` 仅此一处随会话切换的 session 域挂载（列表页为 project 域、模板/技能页为独立 stack 页），修复面单点。

已知残留（不修，低频）：reload 失败保留旧 rows 是一般性形态（会话内目录被 agent 删除时列表同样陈旧到下次成功加载为止）。

## 回归锁

`apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx` 新增 describe「ChatConversationPanel 工作区面板跨会话重挂」：

- sessionId 变化时 VfsFileManager 重挂（生命周期流水 = mount→unmount→mount）——拔牙验证过：key 去掉 sessionId 即红；
- 同一会话内重渲染（chat ↔ workspace 切换）不重挂——对照组，防止修成「每次渲染都重挂」丢会话内合法状态。

## 验证记录

- `npx jest __tests__/chat-conversation-panel.integration.test.tsx`：17/17 绿（含新增 2 条）；
- 拔牙：key 临时还原为不含 sessionId → 重挂用例红（仅一次 mount）、对照组不受影响 → 恢复后复跑全绿；
- `tsc --noEmit -p tsconfig.build.json`：exit 0。

真机复验路径：会话 A 工作区进任意子目录 → 回列表切会话 B → 应无 toast；切「聊天工作区」→ 应显示 B 的根目录文件，点开正常出正文。
