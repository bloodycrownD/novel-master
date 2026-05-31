# Mobile Fix 技术规格（SPEC）

> 需求：[prd.md](./prd.md)  
> 上游 UI 权威（全量 App）：[mobile-app/spec.md](../mobile-app/spec.md)

## 设计目标

- 修复 `apps/mobile` 会话 **默认命名**、**重命名**、**新建后不自动进对话** 三处缺陷。
- 在 Core 补齐 `SessionService.rename`，与 `ProjectService.rename` 对齐，供 RN App 与未来 CLI 复用。
- 改动面小：以 `ChatTabScreen`、会话抽屉、Core chat 层为主；不改动 Agent/VFS/消息链路。

---

## 现状与约束（代码探索）

| 模块 | 修复前 | 本迭代 |
|------|--------|--------|
| `ChatTabScreen.handleCreateSession` | `create(..., '新会话')` → `setCurrentSession` → `openConversation` | `nextDefaultSessionTitle` → `create` → 仅 `reloadLists` |
| `SessionService` | 无 `rename`；Repository 无 `updateTitle` | 新增 port + SQLite `UPDATE` |
| `SessionActionsDrawer` | 仅模型/提示词/日志 | 增加「重命名」→ 父组件弹 `TextPromptModal` |
| 会话列表 ⋮ `BottomSheetMenu` | 仅「复制会话」 | 增加「重命名」 |
| 项目重命名范式 | `ProjectDrawer` + `TextPromptModal` + `projects.rename` | 会话侧镜像实现 |

**兼容性**

- DB 无 schema 变更（沿用 `chat_session.title`）。
- 历史标题「新会话」保留；编号算法不 retroactive 改名。
- `mobile-scope` 行为不变：未调用 `setCurrentSession` 则当前会话指针保持原值。

**技术边界**

- 默认名逻辑放在 **App**（`apps/mobile/src/utils/session-default-title.ts`），不强制 Core 内置，避免 CLI 与 App 产品文案耦合。
- 编号正则固定为 `^新会话(\d+)$`；用户自定义标题不参与占用计算。

---

## 总体方案

### 默认标题算法

```text
输入：项目下已有 sessions[].title
输出：新会话1 | 新会话2 | …

used = { N | 某 title 匹配 /^新会话(N)$/ }
n = 1; while n in used: n++
return "新会话" + n
```

实现：`nextDefaultSessionTitle(existingTitles)`。

### 重命名数据流

```mermaid
sequenceDiagram
  participant UI as ChatTabScreen
  participant Svc as SessionService
  participant Repo as SqliteSessionRepository
  UI->>UI: TextPromptModal 确认
  UI->>Svc: rename(sessionId, title)
  Svc->>Svc: trim; empty → chatInvalidArgument
  Svc->>Repo: updateTitle(id, title, updatedAtMs)
  UI->>UI: reloadLists()
```

### 新建会话（无导航副作用）

```text
新建会话按钮
  → listByProject → nextDefaultSessionTitle
  → sessions.create(projectId, title)
  → reloadLists()
（不调用 setCurrentSession / openConversation）
```

---

## 文件级改动

### Core（`packages/core`）

| 文件 | 改动 |
|------|------|
| `domain/chat/repositories/session.port.ts` | `updateTitle(id, title, updatedAtMs)` |
| `domain/chat/repositories/impl/sqlite-session.repository.ts` | `UPDATE chat_session SET title, updated_at_ms` |
| `service/chat/session.port.ts` | `rename(id, title): Promise<ChatSession>` |
| `service/chat/impl/session.service.ts` | `rename` 实现（对齐 `project.service.ts`） |

### Mobile（`apps/mobile`）

| 文件 | 改动 |
|------|------|
| `src/utils/session-default-title.ts` | **新建** `nextDefaultSessionTitle`、`DEFAULT_SESSION_TITLE_PREFIX` |
| `src/screens/tabs/ChatTabScreen.tsx` | 创建/重命名逻辑；`sessionRenameModal`；菜单项 |
| `src/components/chrome/SessionActionsDrawer.tsx` | `onRename` 菜单项 |
| `__tests__/session-default-title.test.ts` | 编号用例 |

### 测试（`packages/core`）

| 文件 | 改动 |
|------|------|
| `test/chat/chat.services.test.ts` | `it("session rename updates title")` |

---

## 实现计划（已交付顺序）

1. Core：`updateTitle` + `SessionService.rename` + 单测。
2. App：`session-default-title.ts` + 单测。
3. App：`handleCreateSession` 去自动进入对话。
4. App：列表 ⋮ / 会话抽屉重命名 + `TextPromptModal`（对话页与列表页共用 `sessionRenameModal` 节点）。

---

## 测试策略

| 类型 | 内容 |
|------|------|
| 单元 | `nextDefaultSessionTitle`：空列表 → `新会话1`；`新会话` 不占号；跳过 `1,3` → `2` |
| 单元 | `ctx.sessions.rename` 持久化 `title` |
| 手工 | 连续新建 3 次见 `新会话1/2/3`；新建后仍在列表；⋮ 与抽屉重命名；对话顶栏标题更新 |
| 回归 | `npm run build -w @novel-master/core`；相关 test 文件全绿 |

**手工检查清单**

- [ ] 新建会话不进入对话页
- [ ] 新建会话不改变「当前」徽章所在行（若此前有当前会话）
- [ ] 重命名空字符串有 Alert
- [ ] 复制会话仍可用（菜单第二项）

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 大量历史「新会话」+ 新 `新会话1` 并存 | 产品可接受；用户可手动重命名；不在本期批量迁移 |
| 用户期望新建后自动进入新会话 | PRD 明确「新建不打断」；若需可配置再开迭代 |
| 仅 App 默认名，CLI `create` 仍可为 null | CLI 行为不变；可选后续 `nm session create` 默认名 |

**回滚**：还原 Core `rename` 与 App 三处 UI/工具文件即可；无 migration。

---

## 后续（非本期）

- CLI：`nm session rename --session <id> --title <title>`
- 可选：Core 共享 `allocateDefaultSessionTitle(projectId)` 供 CLI/App 一致
- 回填 `examples/mobile/docs/feature-inventory.md` 若原型需演示重命名
