# Mobile 聊天 Thinking 展示与 VFS 目录排序 技术规格（SPEC）

## 设计目标

1. **Thinking**：流式结束后持久化的 assistant 消息与流式阶段一致，`thinking` 块在 `MessageList` 中走 `ThinkingBlockCard`，不落入普通正文气泡。
2. **VFS 排序**：`VfsFileManager` 当前目录子项顺序与 `@novel-master/core` worktree DFS 同级顺序一致；保存目录规则后 `reload()` 即可看到顺序变化。
3. **最小改动面**：优先修根因（Core OpenAI 落库逻辑 + Mobile 列表排序），不新增 DB schema，不改动 PRD 范围外的目录规则字段行为。

## 总体方案

### 问题 A：Thinking 流式结束后变普通消息

**现状（已确认）**

| 层级 | 行为 |
|------|------|
| 流式 UI | `ChatTabScreen` → `streamingThinking` → `MessageList` → `ThinkingBlockCard`（正常） |
| 落库解析 | `MessageList` / `buildChatListItems` 已按 `block.type === 'thinking'` 分流（`message-blocks.ts`） |
| OpenAI 流式收尾 | `openAiStreamAccumulatorsToBlocks` → `blocksFromReplyStrings`（`openai-content-mapper.ts`） |

**根因**：`blocksFromReplyStrings` 在 `content` 为空且存在 `reasoning_content` 时执行 **GLM 提升**：把 thinking 拷入 `text` 并清空 thinking，最终只持久化 `{ type: "text" }`。与测试 `O5c: stream maps reasoning-only deltas to assistant text (GLM)` 一致，但与 Mobile PRD（ThinkingBlockCard）冲突。

Anthropic / Gemini 正常结束路径（`finishAnthropicSse` / `finishGeminiSse`）**分别**写入 `text` 与 `thinking` 块，无此提升；问题主要出现在 **OpenAI 兼容流（含 GLM reasoning_content）**。

**方案**：调整 `blocksFromReplyStrings` 正常结束语义，与中止路径 `buildStreamPartialBlocks` 对齐：

- `thinking.trim() !== ""` → 写入 `{ type: "thinking", text }`
- 若仅有 thinking、无正文 → 额外写入 `{ type: "text", text: "" }`（保证块数组非空、与既有 partial 测试一致）
- **不再**将 thinking 复制进 text

`assistantText`（`messageBodyTextFromContent`）仍跳过 thinking；reasoning-only 时可能为空字符串——仅影响 adapter 返回值/测试断言，不影响 Mobile UI（UI 读 blocks）。

### 问题 B：VFS 目录规则排序无效果

**现状（已确认）**

`VfsFileManager.reload`（约 L142–143）对 `childPaths` 使用固定：

```ts
.sort((a, b) => a.localeCompare(b))
```

完全忽略 `worktree.getDirRule(currentPath)` 及 core 的 `sortDirPaths` / `sortFilesForDir`。`DirectoryRuleSheet` 保存后已 `setDirRule` + `reload()`，数据已持久化，但列表顺序不变；用户感知为「排序 UI 没用」。

**方案**：用 **`buildListRows()` 的 DFS 同级顺序`** 作为当前目录直接子项顺序（与 `DefaultWorktreeService.walkDir` 一致，无需在 Mobile 重复实现 sort 或批量 `vfs.read` 取 mtime）。

新增纯函数 `orderedDirectChildPaths(parentPath, allRows, extraPaths)`：

1. 顺序扫描 `allRows`（即 `buildListRows()` 结果）。
2. 遇到 `parentPath` 的 dir 行后，收集所有 `isDirectChild(parentPath, row.path)` 的行路径，**按首次出现顺序**加入结果（DFS：子目录组 → 文件组，组内已按 core 排序）。
3. 将仅存在于 `vfs.list`、不在 rows 中的路径追加到末尾，按 `sortDirPaths` / `sortFilesForDir` + `getDirRule(parent)` 再排一次（需 `sortDirPaths` 从 core 导出；文件 mtime 对 orphan 文件可暂用 `0`，与 core 缺省一致）。

`reload` 中：构建 `childPaths` Set 后，用上述顺序替代 `localeCompare`，再 `map` 到 `MappedVfsRow`。

**OptionRow「无变化」**：组件实现正常（`DirectoryRuleSheet` L219–252）；根因是列表顺序不变。修复排序后，保存升序/降序应立即可见；chip 选中态在 `initial` / `setDirRuleInitial` 更新后已正确（保存时 `setDirRuleInitial(input)`）。

可选增强（非必须）：目录行 `subtitle` 在规则开启时展示 `名称·升序` 等摘要——PRD 要求「可辨认规则生效」，排序变化本身即可满足；若时间紧可不做。

## 最终项目结构

```
packages/core/src/infra/llm-protocol/logic/openai-content-mapper.ts   # 修改 blocksFromReplyStrings
packages/core/src/index.ts                                          # 导出 sortDirPaths
packages/core/test/provider/protocol-openai.test.ts                 # 更新 O5c 断言
packages/core/test/infra/llm-protocol/*.test.ts                     # 如有 blocksFromReplyStrings 相关则同步

apps/mobile/src/components/vfs/vfs-direct-children-order.ts         # 新增：从 buildListRows 提取顺序
apps/mobile/src/components/vfs/VfsFileManager.tsx                   # reload 使用新排序
apps/mobile/__tests__/vfs-direct-children-order.test.ts           # 新增单测
apps/mobile/__tests__/message-blocks.test.ts                        # 已有则补充 thinking 用例（可选）
```

## 变更点清单

| 文件 | 改动 |
|------|------|
| `openai-content-mapper.ts` | 删除 GLM thinking→text 提升；reasoning-only 产出 thinking + 空 text |
| `packages/core/src/index.ts` | `export { sortDirPaths, ... }` |
| `protocol-openai.test.ts` | `O5c`：期望 `blocks` 含 `thinking`，不再要求仅 `text` |
| `vfs-direct-children-order.ts` | `orderedDirectChildPaths` + orphan 回退排序 |
| `VfsFileManager.tsx` | `reload` 用有序 path 列表；依赖不变 |
| `vfs-direct-children-order.test.ts` | 模拟 rows 顺序：子目录在前、文件在后、改 sortOrder 后顺序反转 |

**不改动**

- `MessageList` / `ThinkingBlockCard` / `message-blocks.ts`（逻辑已正确）
- `DirectoryRuleSheet` OptionRow（除非实测 chip 仍不刷新，再查 `initial` 引用相等性）
- worktree DB schema、`setDirRule` API

## 详细实现步骤

### 步骤 1：Core — 修复 OpenAI 流式落库块

1. 编辑 `blocksFromReplyStrings`：
   - 移除 L31–34 的 `text = thinking; thinking = ""`。
   - 保持：有 thinking → push thinking；有 text 或「仅有 thinking」→ push text（后者 `text` 可为 `""`）。
2. 确认 `openAiStreamAccumulatorsToBlocks` 与 non-stream `blocksFromReplyStrings` 调用点行为一致。
3. 更新 `protocol-openai.test.ts` `O5c`：
   - `blocks[0].type === 'thinking'`，`blocks[0].text === '你好'`
   - `assistantText` 改为 `''`（或若产品要求保留摘要，仅在 adapter 层单独拼接，**不**写回 content blocks——本 SPEC 采用空 `assistantText`）。
4. 跑 `npm test -w @novel-master/core -- --test-path-pattern=openai|stream-partial`。

### 步骤 2：Core — 导出 `sortDirPaths`

1. 在 `packages/core/src/index.ts` 从 `worktree-eval` 增加 `sortDirPaths` 导出（与现有 `sortFilesForDir` 并列）。
2. 无需改 `worktree-eval` 实现。

### 步骤 3：Mobile — 直接子项排序工具

1. 新增 `vfs-direct-children-order.ts`：
   - `export function orderedDirectChildPaths(params: { parentPath: string; rows: readonly WorktreeListRow[]; extraPaths: readonly string[]; dirRule: WorktreeDirRule | null; mtimeByPath?: ReadonlyMap<string, number> }): string[]`
   - 主路径：扫描 `rows` 收集 direct children 顺序。
   - `extraPaths` 中未出现的 path：拆成 dir/file，分别 `sortDirPaths` / `sortFilesForDir`（mtime 从 map 取，缺省 `0`），dirs 在前。
2. 单测：构造 rows `[{dir,/p}, {dir,/p/a}, {file,/p/a/f}, {file,/p/b.md}]`，parent=`/p` → `['/p/a','/p/b.md']`；调换 mock sortOrder 后 orphan 路径顺序变化。

### 步骤 4：Mobile — 接入 `VfsFileManager.reload`

1. `reload` 内 `await worktree.getDirRule(currentPath)`（无规则则 `null`，core 使用 `DEFAULT_WORKTREE_DIR_RULE` 语义）。
2. 用 `orderedDirectChildPaths` 替代 `localeCompare`。
3. 保持现有 `mapWorktreeRow` / `mapVfsListEntry` 映射逻辑。
4. 确认 `onSave` 后 `reload()` 已调用（现有 L519–522，无需改）。

### 步骤 5：验证与回归

1. Mobile 单测：`vfs-direct-children-order` + 现有 `message-blocks`（可加 thinking+text 分离用例）。
2. Core 单测：OpenAI GLM + stream-partial 不回归。
3. Android 手工：thinking 模型一轮对话 → 结束后 Thinking 卡片仍在；VFS 改降序 → 列表顺序变化。

## 测试策略

### 自动化

| ID | 套件 | 用例 |
|----|------|------|
| T1 | `protocol-openai.test.ts` | O5c：reasoning-only 流式 → blocks 含 thinking，不含「仅 text 承载 reasoning」 |
| T2 | `stream-partial-blocks.test.ts` | 保持 partial thinking + empty text（无改动或断言一致） |
| T3 | `vfs-direct-children-order.test.ts` | DFS 顺序提取；dirs 先于 files；orphan 路径按 sortOrder 反转 |
| T4 | `message-blocks.test.ts`（可选） | assistant 消息 `{thinking, text}` → `thinkingParts` / `textParts` 分离 |

### 手工（Android）

| ID | 步骤 | 期望 |
|----|------|------|
| M1 | GLM/带 reasoning 模型发送一轮 | 流式时 Thinking 卡片；结束后仍独立，正文气泡仅含回复 text |
| M2 | 重进会话 / 切 Tab | Thinking 卡片仍在 |
| M3 | 目录含 ≥2 子文件夹与 ≥2 文件，改排序为更新时间降序并保存 | 列表顺序变化，文件夹仍在文件前 |
| M4 | 仅切换升序↔降序 | 顺序反转；Sheet chip 高亮与保存值一致 |
| M5 | 普通无 thinking 消息、无规则目录 | 无多余 Thinking 卡片；列表不空、不崩 |

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| GLM reasoning-only 的 `assistantText` 变空，依赖 `assistantText` 的下游（日志/测试）失败 | 仅改 blocks；测试同步；确认 agent-runner 不依赖 `assistantText` 落库 | 恢复 `blocksFromReplyStrings` 提升逻辑 |
| 历史已落库消息仍为「thinking 被提升为 text」 | 不迁移；仅新消息修复；可选后续一次性 DB 修复（本迭代不做） | — |
| `orderedDirectChildPaths` 与 core DFS 漂移 | 单测对齐 `worktree-list-order` 语义；优先扫描 `buildListRows` | 回退 `VfsFileManager` 的 `localeCompare` |
| orphan 文件 mtime=0 导致「按时间排序」不准 | 与 core 对未扫描文件行为一致；后续可加 `vfs.read` 批量 mtime（非本迭代） | 接受 name 排序回退 |
| 导出 `sortDirPaths` 影响 bundle 体积 | 纯函数，tree-shake 友好 | 移除 export，Mobile 内联复制（不推荐） |

**分支建议**：`fix/mobile-chat-thinking-and-vfs-sort`

**回滚**：revert 上述文件；无需 DB migration。
