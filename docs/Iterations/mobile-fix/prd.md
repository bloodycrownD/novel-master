# Mobile Fix PRD

> **上游**：`mobile-app` 已合并 main（`apps/mobile` Android 产品 App）。  
> **本期**：`apps/mobile` 会话列表与 Core 会话 API 的体验缺陷修复（小步交付，不扩 P0 功能面）。

## 背景

`mobile-app` 交付后，对话 Tab 的会话管理存在三类明显问题：

1. **默认标题重复**：新建会话一律写入固定标题「新会话」，同项目下多条会话在列表中无法区分。
2. **无法重命名**：项目支持 `ProjectService.rename`，但 `SessionService` 无对等能力，移动端也无重命名入口。
3. **新建会话副作用过大**：创建成功后自动 `setCurrentSession` 并 `openConversation`，用户仅想批量建壳时被强制进入聊天子视图。

上述问题影响日常多会话写作与列表可读性，应在独立小迭代中修复，并为后续 `mobile-app` 维护提供文档基线。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 可区分默认名 | 同项目连续新建会话，默认标题依次为 `新会话1`、`新会话2`…（跳过已占用的 `新会话N`） |
| 可改会话名 | 用户可从 UI 修改 `chat_session.title` 并持久化；空标题被拒绝 |
| 新建不打断 | 点「新建会话」后仍停留在**会话列表**子视图；**不**切换当前会话、**不**自动进入对话 |
| Core 能力对齐 | `SessionService.rename` 与项目 `rename` 语义一致；CLI 可后续接子命令（本期不强制） |
| 回归 | Core `chat.services` 与 mobile 单测通过；手工：列表 ⋮ / 会话抽屉均可重命名 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 在同一项目下维护多个草稿会话，靠编号默认名快速辨认 |
| 日常写作用户 | 将会话改名为章节名/任务名，列表与顶栏标题一致 |
| 日常写作用户 | 连续新建多个空会话备稿，无需每次被拉进聊天页 |

## 范围

### 包含范围

1. **默认会话标题策略（App 层）**
   - 创建前读取当前项目下全部 `title`；
   - 匹配 `^新会话(\d+)$` 收集已用编号，取最小未占用正整数 `N`，写入 `新会话{N}`；
   - 历史仅「新会话」（无数字）的条目**不**占用编号（新建仍可从 `新会话1` 起）。

2. **会话重命名（Core + App）**
   - Core：`SessionRepository.updateTitle`、`SessionService.rename(id, title)`（trim 后非空）。
   - Mobile：会话列表项 ⋮ →「重命名」；对话内「会话操作」抽屉 →「重命名」；复用 `TextPromptModal`（与项目抽屉一致）。

3. **新建会话交互（App 层）**
   - 仅 `sessions.create(projectId, title)` + 刷新列表；
   - 移除 `setCurrentSession(created.id)` 与 `openConversation(created.id)`。

### 不包含范围

- CLI `nm session rename`（可后续单独加；本期以 App + Core API 为准）。
- 批量重命名、会话标题唯一性校验、自动根据首条消息生成标题。
- iOS 构建验收、`examples/mobile` 原型同步。
- 其它 Tab（Agent / 我的）或 VFS/Chat 行为变更。

## 核心需求

1. 新建会话默认名为项目内下一个可用的 `新会话N`（N ≥ 1）。
2. 提供会话重命名 UI，持久化至 `chat_session.title`。
3. 新建会话不改变 `PersistentState` 当前会话指针，不切换 `chatSubview`。
4. 重命名后列表与对话顶栏展示的 `sessionTitle` 随 `reloadLists` 更新。

## 验收标准

- **Given** 项目 P 下无 `新会话1`，**When** 用户新建会话，**Then** 新行标题为 `新会话1`，且仍显示会话列表（非对话页）。
- **Given** P 下已有 `新会话1`、`新会话3`，**When** 再新建，**Then** 新会话标题为 `新会话2`。
- **Given** P 下仅有标题为「新会话」的旧数据，**When** 新建，**Then** 新会话标题为 `新会话1`（旧条目不视为占用 1）。
- **Given** 用户在会话列表对某会话 ⋮ → 重命名为「第三章」，**When** 保存，**Then** 列表与（若正在该会话内）顶栏显示「第三章」。
- **Given** 用户当前在会话 A 的对话页，**When** 新建会话，**Then** 仍停留在 A 的对话上下文（当前会话仍为 A）；返回列表可见新会话行。
- **Given** 重命名输入全空格，**When** 保存，**Then** 提示失败（Core `session title must not be empty`）。
- **Given** 自动化，**When** 跑 `packages/core/test/chat/chat.services.test.ts` 中 `session rename` 与 `apps/mobile` 的 `session-default-title` 测试，**Then** 通过。
