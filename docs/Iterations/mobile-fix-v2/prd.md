# Mobile Fix v2 PRD

> **上游**：`mobile-app`、`mobile-llm-streaming`（Core `postSse` 已合入 `main`）。  
> **本期**：Mobile 对话与配置体验补强——消息管理、思考过程展示、工作区流式开关、Agent 脏状态与若干 UI 修复。  
> **分支**：`feature/mobile-fix-v2`（相对 `main`）。

## 背景

- `mobile-llm-streaming` 已在 Core 用 `postSse` 解决 RN 上流式 SSE；聊天默认可流式，但缺少**非流式**兜底入口。
- 智谱等 OpenAI 兼容模型返回 `reasoning_content`，落库为 `thinking` 块；若与正文混排展示或误发 API，体验与稳定性均受损。
- 对话 Tab 无法编辑/删除消息；会话抽屉无批量删消息能力。
- Agent 配置页保存后再次进入仍提示「有未保存的更改」。
- 批量删消息时气泡布局错乱；会话底部菜单在部分 Android 上易闪退。
- 启动图标仍为 RN 默认图，需使用仓库根目录 `icon.webp`。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 消息管理 | 长按：编辑（纯 text）/ 删除；抽屉「批量删除消息」可多选删除 |
| 思考过程 | 助手 `thinking` 以独立可折叠卡片展示；**不**与回复气泡混排 |
| API 稳定 | 出站 OpenAI 请求**不含** `thinking`；聊天不再因历史 reasoning 报错 |
| 流式开关 | 「我的 → 工作区」可切换流式/非流式；偏好持久化，对话立即生效 |
| Agent 脏状态 | 保存后退出再进，**不**误显「有未保存的更改」 |
| 批量删布局 | 复选框固定屏幕最左列；用户气泡仍右对齐 |
| 启动图标 | `npm run icons -w @novel-master/mobile` 可从 `icon.webp` 生成各密度 PNG |
| 回归 | `npm test -w @novel-master/core` 通过；手工对话流式/非流式各至少一条 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 改错字、删掉错误轮次、批量清理测试消息 |
| 使用 GLM/推理模型用户 | 查看「思考过程」，正文仍清晰 |
| 流式异常环境 | 关闭流式，用整包回复绕过 SSE 问题 |
| 配置 Agent 用户 | 改 maxSteps/Prompt 后保存，再次进入无假脏 |

## 范围

### 包含范围

1. **Core**
   - `MessageService.updateContent` + SQLite `updateContent`
   - `openai-content-mapper`：出站忽略 `thinking`（不抛 `UNSUPPORTED_CONTENT`）
2. **Mobile — 对话**
   - `MessageList` / `message-blocks` / `ThinkingBlockCard`
   - `message-edit.ts`；`ChatTabScreen` 批量删 + 长按菜单
   - `SessionActionsDrawer`：「批量删除消息」；遮罩布局修复
   - `ChatComposer` + `agent-run.service`：读取 `llmStream` 偏好
3. **Mobile — 我的**
   - `ProfileTabScreen` + `ProfileSwitchItem`：流式输出开关
   - `storage/llm-stream-pref.ts`、`app-ui-keys`（`llmStream`）
4. **Mobile — Agent**
   - `AgentEditorForm`：`formSnapshotJson` 脏检测（专属模型关闭时不比 provider 字段）
5. **Mobile — 品牌**
   - `scripts/generate-app-icons.mjs`；Android mipmap + iOS AppIcon

### 不包含范围

- 编辑含 `tool_use` / `tool_result` 的消息
- 消息 seq 重排、fork 点调整
- Anthropic 流式 / 非 Anthropic adapter 改造
- 流式失败自动改非流式重试（与 `mobile-llm-streaming` 一致：**不降级**）
- `icon.webp` 提交策略（源图在仓库根；生成物在 `apps/mobile`，是否入库由发布流程决定）

## 核心需求

1. 删除使用 `messages.delete(id)`；编辑使用 `messages.updateContent`（仅 `text` 块参与编辑 UI）。
2. `thinking` **仅 UI 展示**；`chatMessagesToOpenAi` / `formSnapshotJson` 出站路径跳过 `thinking`。
3. 批量删除：入口在会话操作抽屉；Agent `running` 时禁止进入批量模式。
4. 流式偏好默认 `true`；存 KKV 模块 `nm-mobile-ui`，键 `llmStream`。
5. Agent 脏状态：加载完成前不报 dirty；专属模型关闭时 snapshot 不含 provider/model 字段。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| M1 | 会话有多条消息 | 长按用户消息 → 编辑 → 保存 | 气泡更新且重启后一致 |
| M2 | 同上 | 抽屉「批量删除消息」→ 勾选 2 条 → 删除 | 仅保留未选消息 |
| M3 | Agent 生成中 | 点批量删除 | 提示稍候，不进入批量模式 |
| M4 | 助手含 thinking | 查看历史消息 | 见「思考过程」折叠卡 + 独立回复气泡 |
| M5 | 同上 | 再发用户消息 | 无 `thinking blocks in outbound` 类错误 |
| M6 | 我的页 | 关闭流式 → 发消息 | 完成后一次性出现回复，无流式增量 |
| M7 | Agent 已保存 | 退出再进 | 无「有未保存的更改」 |
| M8 | 批量删模式 | 查看列表 | 复选框左列对齐，用户消息仍靠右 |

## 已确认决策

- 批量删除入口：会话操作抽屉（☰）。
- 单条操作：长按消息气泡。
- 思考卡片：默认折叠，仅显示标题「思考过程」；流式生成时默认展开。
- 流式开关：工作区级，非 per-session。
- 出站 thinking：静默忽略，不降级、不重试非流式。
