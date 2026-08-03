# Mobile UI 轻量刷新（局部 patch 替代整页 reload）

> **类型**：性能 / UX 优化（部分已落地，其余待办）  
> **平台**：Android Mobile（`apps/mobile`）  
> **关联迭代**：`mobile-fix-v2`、`mobile-vfs-markdown-webview`、`codebase-audit-remediation`  
> **背景**：2026-06 调试 `Maximum update depth exceeded`（主页会话列表）与 VFS「状态变更」整表 loading 时沉淀

## 问题

多处 mutation 后走 **整组件树重渲染 + 全量数据重拉 + loading 闪烁**，而用户感知上往往只需 **单行 badge / subtitle 更新** 或 **当前视口子集刷新**。

典型代价：

- `FlatList` / `VirtualizedList` 全量 `setRows` → 布局重算、`_updateCellsToRender` 压力；
- `setLoading(true)` → 整页闪烁；
- 父 Tab 级 hook（`useDismissOverlaysOnBlur`、`setChat`）因 **不稳定 callback 引用** 触发 focus cleanup → 误 `setState` 循环（已修一例，模式易复发）。

## 已落地（可参考模式）

| 场景 | 做法 | 关键文件 |
|------|------|----------|
| 目录规则「状态变更」（父目录视角） | `patchDirRuleRow` 只改该行 badge；`invalidateSessionSnapshot` 不 `reload` | `vfs-row-mapper.ts`、`VfsFileManager.tsx` |
| 目录规则「状态变更」（目录内部） | patch 后按需 `reload()`（子文件 subtitle 可能变） | 同上 |
| 文件「状态变更」 | `fetchWorktreeRows` + `remapDirectChildRows` 刷新当前目录可见行，无 VFS `list`、无 loading | 同上 |
| 主页隐藏 Conversation | `chatSubview === 'conversation'` 时才挂载 `ChatConversationPanel` | `ChatTabScreen.tsx` |
| Tab 失焦 dismiss | `useDismissOverlaysOnBlur` 用 ref 持有最新 `dismiss`，effect 依赖 `[]` | `useDismissOverlaysOnBlur.ts` |
| VFS 并发 reload | `reloadInFlightRef` 跳过重叠 reload | `VfsFileManager.tsx` |

## 待优化（建议优先级）

### P1 — VFS 其余 mutation

仍调用 `reloadAfterMutation()` → 全量 `vfs.list` + loading 的路径：

- 重命名 / 删除 / 新建文件或目录
- 目录规则表单保存（`DirectoryRuleSheet`）
- 批量启用/禁用目录规则
- ZIP 导入导出后（可保留全量 reload）

**方向**：按 mutation 类型拆分——结构变更（增删移）才重拉 VFS 列表；纯 worktree 元数据变更走 `refreshVisibleRowsFromWorktree` 或单行 patch。

### P1 — Chat 会话列表

- `ChatSessionListPanel` 已 `React.memo`，但 `ChatTabScreen` 传入大量 **内联 callback** → memo 失效。
- **方向**：`useCallback` 稳定化 props；会话增删改后只 patch `sessions` 数组中对应项，避免 `reloadLists` 触发整 Tab 抖动（若 API 返回全量列表则至少避免无关子树重挂载）。

### P2 — Header / 导航上下文

- `setChat` 每次 spread 新对象 + 新 `onOpenDrawer` → 所有 `useHeaderContext` 消费者重渲染。
- **方向**：`useMemo` / `useCallback` 稳定 `onOpenDrawer`；`setChatState` 前浅比较，值未变则 skip。

### P2 — 流式 / 消息列表（与 [mobile-webview-agent-stream-freeze](mobile-webview-agent-stream-freeze.md) 衔接）

- 非流式场景下 `reloadMessages` + 全量 WebView snapshot 仍重；轮间可继续 **appendTailRows / messagePatch** 扩面。
- Legacy `MessageList`：`onContentSizeChange` ↔ `scrollToEnd` 需保持互锁意识，避免增量优化引入 layout 循环。

### P3 — 横切约定

1. **Mutation 分级**：`local-patch` | `visible-subtree` | `full-reload` — 在 service 层或 handler 注释中显式标注。
2. **Focus / blur hooks**：凡 `useFocusEffect` cleanup 调 `setState` 的，dismiss/action 必须 ref 稳定化。
3. **Memo 子组件**：父组件传 props 前检查引用稳定性（尤其 `scope` 整对象入 deps）。
4. **性能预算**： idle 页 `ChatTabScreen` render 应个位数/秒；VFS 单行 toggle 不应 `setLoading(true)`。

## 轻量刷新实现清单（模板）

```
1. 调用 Core API 完成持久化
2. 判断影响范围：
   - 仅单行元数据 → patchRows(path, mapper)
   - 当前目录子项 → refreshVisibleRowsFromWorktree()
   - 路径树结构变 → reload()（可 silent：不设 loading）
3. session worktree → invalidateSessionSnapshot()（下次进入或按需 rebuild）
4. 避免 mutation 路径触发父 Tab focus cleanup 链
```

可复用工具（已存在）：

- `patchDirRuleRow` / `dirRuleStateLabel`
- `remapDirectChildRows`
- `VfsFileManager.fetchWorktreeRows` + `applyWorktreeRowsToVisibleList`

## 验收建议

1. 项目工作区：目录/文件「状态变更」无整表 loading，badge 即时更新。
2. 主页会话列表静置 15s：无红屏、无持续重渲染（React DevTools 或短期探针）。
3. 重命名/删除后：列表正确且无不必要二次 flash（优化后回归）。
4. 单测：`vfs-row-mapper`（patch/remap）、`use-dismiss-overlays-on-blur`（dismiss 引用变化不触发 cleanup）。

## 关键文件

```
apps/mobile/src/components/vfs/VfsFileManager.tsx
apps/mobile/src/components/vfs/vfs-row-mapper.ts
apps/mobile/src/screens/tabs/ChatTabScreen.tsx
apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx
apps/mobile/src/hooks/useDismissOverlaysOnBlur.ts
apps/mobile/src/navigation/HeaderContext.tsx
```
