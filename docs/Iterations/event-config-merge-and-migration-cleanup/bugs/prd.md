---
date: 2026-08-09
dependency: []
---

# 三项 Bug 修复 PRD

## 背景

本次迭代修复三个独立 bug，各自源自不同模块：

1. **回滚 Assistant 消息时批注草稿未清空**：`rewind`（回滚 Assistant）走的是保留锚点、删 tail 的路径，tail 里没有 user 消息，自然没有附件可供反投影。但进程内的批注草稿（annotate store）此时不清空，导致 Composer 输入区的批注 chip 残留。这与 `undo_send`（回滚纯文本 user 消息）的"从被删 user 附件反投影批注"形成不对称——`undo_send` 有反投影，`rewind` 既不清也不恢复，是个遗漏。

2. **智能体配置"专属模型"开关交互笨重**：Agent 配置表单里"专属模型"用开关 + 服务商下拉 + 模型下拉三件套呈现。关闭开关时跟随聊天模型，打开后要先选服务商再选模型，两级联动。但模型选项的 label 本身已经含服务商前缀（`服务商 / 模型名`），二级联动是多余的。用户要把它改成扁平的单一下拉选择器，默认选项"默认(跟随)"表示跟随聊天模型。数据路径不变（`def.model` 缺省 = 跟随），纯 UI 变动。

3. **子会话首次进入流式输出丢失**：子会话（subagent session）从主会话 task 卡片进入时，如果 agent 正在运行（流式中），有两个独立现象：(a) 流式 partial 丢失——因为 eventBus 无 replay，mount 前的 delta 永久丢失；(b) **退出再进入时 user 气泡消失**——`ChatTranscriptWebView` 的 `sendSessionSnapshot` 在 `uiRunning=true && streamActive=true` 时会把 snapshot 延迟到流式结束，导致首次建立 rows 基线的 `needsOpenSnapshot` 也被延迟，WebView 的 `state.rows` 一直为空，只有流式 tail 可见、user 行不可见。等流式结束后后续 effect 触发 fullSnapshot，user 才回来。主会话不受影响是因为流式期间 messages 会持续变化触发新 snapshot，总有机会补上；子会话是只读浏览页，messages 在 step commit 前不变。

## 目标（含成功指标）

1. **Bug1**：`rewind` 回滚成功后清空进程内批注草稿，与 `undo_send` 的反投影形成对称。
2. **Bug2**：专属模型选择从开关+二级联动改为扁平下拉，core 零改动。
3. **Bug3**：子会话首次进入时能看到完整的流式 partial（从 run 开始）和 user 气泡。
4. **成功指标**：三个 bug 均可复现 → 修复后不再复现；已有功能无回归。

## 用户与场景

- **Bug1**：使用回滚功能的用户，回滚 Assistant 消息后期望输入区的批注 chip 清空。
- **Bug2**：配置 Agent 的用户，选专属模型时希望一步到位而非开关+两级。
- **Bug3**：查看子会话的用户，在 agent 运行中途首次点进子会话，期望看到完整流式内容和 user 消息。

## 范围

### 包含范围

- Bug1：Mobile `useChatTabMessages.ts` + Desktop main `messages.ts` + renderer `rollback-annotate-restore.ts`
- Bug2：Mobile `AgentEditorForm.tsx` + Desktop `AgentDefinitionEditorForm.tsx` + `AgentEditorView.tsx`
- Bug3：Mobile core `AgentStreamRegistry` + `SubagentSessionScreen.tsx` + `ChatTranscriptWebView.tsx`

### 不包含范围

- Bug3 的"结束空窗"（stream tail reset 与 reload 时序间隙）属于 `mobile-stream-end-flicker` 迭代范畴，不在本次范围。
- Desktop 子会话面板的对称问题不在本次范围。

## 核心需求

### 1. rewind 清空批注草稿

`rewind` 成功后，进程内 annotate store 按 sessionId 清空（`clearChatAnnotateDrafts`）。`undo_send` 的反投影逻辑不变——它从被删 user 消息的附件里把批注解析回来。两者共用清理钩子时按 mode 分支：`undo_send` → 反投影（现有）；`rewind` → 清空（新增）。

### 2. 专属模型扁平下拉

Mobile 和 Desktop 各自把"开关 + 服务商下拉 + 模型下拉"替换为单一模型下拉选择器。选项列表首位恒为"默认(跟随)"，后面是所有服务商下的全部 savedModels（跨 provider 聚合），label 格式为"服务商 / 模型名"。选中默认项 → `modelEnabled=false`；选中具体模型 → `modelEnabled=true` + `savedModelId`。`buildAgentDefinitionFromForm`（core）和保存逻辑零改动。

### 3. 子会话流式 partial 不丢失 + needsOpenSnapshot 立即送达

流式 partial 缓存上提到 core 层 `AgentStreamRegistry`（按 sessionId 存 in-flight 累积文本），`run-agent-turn` 负责 register/append/unregister。`SubagentSessionScreen` 从 `runtime.streamRegistry.get(sessionId)` 查询 partial 并注入 WebView，不依赖 eventBus 订阅时机。

同时修复 `ChatTranscriptWebView` 的 `needsOpenSnapshot` 路径：首次建立 rows 基线的 snapshot 必须立即送达（调 `sendSessionSnapshotNow`），不走 `sendSessionSnapshot` 的 deferred 路径（`uiRunning+streamActive` 时会 pending 到流式结束）。

## 验收标准

### AC-1：rewind 清空批注 chip

- **Given** Composer 输入区有批注 chip（`批注:/xxx`）
- **When** 回滚一条 Assistant 消息（走 `rewind` 分支）
- **Then** 回滚成功后，批注 chip 全部消失
- **And** `undo_send`（回滚纯文本 user）的反投影行为不受影响

### AC-2：扁平下拉选默认(跟随)

- **Given** Agent 配置表单（Desktop / Mobile）
- **When** 打开"专属模型"下拉
- **Then** 首位选项为"默认(跟随)"
- **And** 选中它后，保存的 `def.model` 缺省（跟随聊天模型）
- **And** 后续加载该 Agent，下拉仍停在"默认(跟随)"

### AC-3：扁平下拉选具体模型

- **Given** Agent 配置表单
- **When** 在下拉中选择某个具体模型（label 含服务商前缀）
- **Then** 保存的 `def.model` 为该模型的 savedModel UUID
- **And** 不需要单独选服务商

### AC-4：子会话首次进入流式完整

- **Given** 主会话触发子 agent，流式已进行一段时间
- **When** 用户首次点进子会话
- **Then** 看到从 run 开始的完整流式 partial（不是从中间开始）
- **And** user 气泡正常显示

### AC-5：子会话退出再进入仍正常

- **Given** 用户已进入子会话，流式中途退出再进入
- **When** 重新进入
- **Then** 已缓存的 partial 恢复，后续 delta 继续追加

## 风险与待确认项

- **Bug3 的 needsOpenSnapshot 绕过 deferred**：`needsOpenSnapshot` 路径改调 `sendSessionSnapshotNow` 后，在 `uiRunning+streamActive` 时会立即发全量 snapshot。WebView 前端 `applySnapshot` 在 `sessionChanged=true || intent!=='preserve'` 时会清空 stream tail——首次进入时 `sessionChanged=true`，所以 stream tail 会被清。但 `SubagentSessionScreen` 的 inject effect 会在 snapshot 之后立即注入从 `streamRegistry` 读到的累积 partial，所以流式内容不会真的丢。这个时序依赖 child effect（snapshot）先于 parent effect（inject）执行，React 保证这一点。
- **Bug1 的产品口径**：rewind 清批注是产品口径变更（原 spec 的 D9/D10 "rewind 不清批注"需同步更新）。改动本身很小，但破坏了现有的"与置位/压缩对称"合同——置位/压缩仍不清批注，rewind 改为清。需确认这个不对称是可接受的。
