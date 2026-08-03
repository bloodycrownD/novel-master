---
date: 2026-06-28
dependency:
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/import-export-navigation-fix/prd.md
  - Iterations/mobile-chat-conversation-back/prd.md
---

# Mobile 用户操作可观测性与项目工作区返回 PRD

## 背景

本迭代合并处理两类 Mobile 侧反馈，与现有能力关系如下：

1. **用户 VFS 操作（user ops）在 edit 保存后未出现在 transcript**  
   会话内通过 `FileEditor` 对**已有文件**编辑并保存后，用户期望在发送消息时看到「用户操作」卡片（含 `edit` diff 或 `write` fallback）。实际反馈为卡片**未出现**或行为不稳定。  
   现有设计（`vfs-user-ops-unified-tool-turn`）为两阶段：保存时落 pending，**发送消息或空续跑**时 flush 合成 UA 卡片；flush 依据 checkpoint 与当前工作区的**净 diff**，而非仅 pending 队列。  
   根因尚未在真机复现链路中确认（可能涉及 noop、净 diff 为空、baseline 与磁盘不一致等）。**本期不对该缺陷做行为修复**，先补充**可诊断日志**，便于下一轮基于日志定位并修复。

2. **「项目工作区」侧滑/系统返回与「聊天工作区」不一致**  
   `import-export-navigation-fix` 已为会话内 **「聊天工作区」**（`conversationPanel === 'workspace'`）实现：子目录内系统返回/侧滑先 **逐级返回上级目录**，仅在域根目录时切回「聊天」Tab。  
   会话列表 **「项目工作区」**（`sessionListPanel === 'template'`）当前侧滑/系统返回**直接切回「会话」Tab**，无法在工作区目录树内逐级返回，与「聊天工作区」体验不一致。  
   **本期对 Bug2 做正常修复**，范围限定为「项目工作区」侧滑/返回行为对齐「聊天工作区」。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **可诊断 user ops（edit）** | 在约定复现路径下，一次完整「编辑 → 保存 → 发送」可在日志中还原：**保存映射结果**、**pending 是否写入**、**flush 是否触发**、**净 diff 是否为空**、**是否产出 UA 卡片**（5 项均可从日志判定） |
| **暂不修复 user ops 行为** | 本期 **不改变** user ops 落库、flush、transcript 展示的业务逻辑；仅增加观测能力 |
| **项目工作区返回对齐** | Android「项目工作区」子目录内系统返回/侧滑 **100%** 先回到上级目录；仅在项目工作区域根目录时切回「会话」Tab |
| **不破坏已有返回链** | 「聊天工作区」返回、`mobile-chat-conversation-back` 会话列表/对话页返回语义 **保持不变** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 在会话内打开已有文件，小改内容并保存，发送消息后期望在 transcript 看到 edit 类 user ops |
| 工程/支持人员 | 用户反馈「保存了但没卡片」时，通过日志判断是未发送、noop、净 diff 为空还是 execute 失败 |
| Mobile 工作区浏览用户 | 在会话列表「项目工作区」进入多级子目录，用系统返回或边缘侧滑逐级退出目录 |

## 范围

### 包含范围

**Bug1 — user ops 可观测性（仅日志，不修复）**

1. 覆盖 **Mobile 会话 scope** 下 **FileEditor 保存已有文件（edit）** 的完整链路观测点，至少包括：
   - 保存时：内容是否与 baseline 相同（noop）、映射为 edit / write fallback / 跳过 execute；
   - execute 后：pending 队列是否追加；
   - 发送/空续跑时：flush 是否执行、净 diff 是否为空、是否写入 UA 两条消息。
2. 日志为**开发/诊断用途**（如 logcat / 调试控制台），**不要求**面向终端用户的新 UI 或设置项。
3. 提供简短**日志采集说明**（写入本迭代文档或 README 片段），供复现 Bug1 时按步骤导出日志。

**Bug2 — 「项目工作区」返回行为修复**

1. 仅 **Android Mobile**，仅 **会话列表 → 「项目工作区」** Tab（`sessionListPanel === 'template'`）。
2. 项目工作区 `VfsFileManager` 处于**非根目录**：系统返回键 / 边缘侧滑 → **上级目录**（与界面「上级目录」按钮一致）。
3. 项目工作区处于**域根目录**：系统返回 / 侧滑 → **切回「会话」Tab**（`sessionListPanel === 'sessions'`）。
4. 行为与 `import-export-navigation-fix` 中「聊天工作区」目录返回语义**对齐**（先目录、后 Tab）。

### 不包含范围

- **user ops 行为修复**（baseline 读盘、noop 提示、flush 策略等）— 留待日志定位后的后续迭代。
- **顶栏 ← 与侧滑统一**、**会话内「聊天工作区」**侧滑改动（已交付或不在本期 Bug2 范围）。
- **iOS** 侧滑/返回（仍无 `BackHandler` 等价方案）。
- Desktop / CLI user ops 日志（可后续按需扩展；本期以 Mobile 复现路径为主）。
- 新建文件、ZIP 导入、项目 scope 直写等 user ops 路径的专项改造。
- 本 PRD **不展开**日志字段设计、模块拆分、接口或任务排期（见后续 SPEC）。

## 核心需求

1. **edit 保存链路可观测**：Mobile 会话内 FileEditor 保存时，日志能区分 noop / edit / write fallback，以及 execute 与 pending 结果。
2. **flush 链路可观测**：用户发送消息或空续跑触发 flush 时，日志能记录是否 flush、净 diff 是否为空、是否写入 transcript UA 对。
3. **日志不改动业务语义**：观测逻辑不得改变 save、pending、flush、transcript 的现有行为。
4. **项目工作区目录级返回**：「项目工作区」侧滑/系统返回在子目录时必须先 `goUp`，根目录才切「会话」Tab。
5. **回归保护**：「聊天工作区」与 `useAndroidChatBackHandler` 已有 overlay / 对话页返回优先级 **不得回退**。

## 验收标准

### Bug1 — user ops 日志（edit 路径）

- **Given** Android Mobile，会话 scope，已开启 user VFS unified tool turn，打开**已有文件**并修改内容  
- **When** 用户点击保存  
- **Then** 日志中包含：保存映射类型（noop / edit / write）及 execute / pending 结果（成功或失败原因类别）

- **Given** 上一步保存已成功写入 pending（日志可证）  
- **When** 用户在聊天 Composer **发送一条消息**（或符合条件的空续跑）  
- **Then** 日志中包含：flush 是否执行、净 diff 是否为空、是否追加 UA 消息；且与 transcript 实际是否出现 user ops 卡片**一致**

- **Given** 用户保存后**未发送**消息  
- **When** 查看 transcript  
- **Then** 仍无 user ops 卡片（现有设计不变）；日志可说明「pending 未 flush」

- **Given** 用户保存时内容相对 baseline **无变化**  
- **When** 保存  
- **Then** 日志标明 noop；不要求产生 pending（行为与现网一致）

### Bug2 — 「项目工作区」返回

- **Given** 用户在聊天 Tab 会话列表，已切到 **「项目工作区」**，且当前路径为 `/a/b`（非根）  
- **When** 用户按系统返回键或边缘侧滑一次  
- **Then** 当前路径变为 `/a`；**不**切到「会话」Tab

- **Given** 用户在「项目工作区」且当前路径为域根 `/`  
- **When** 用户系统返回或侧滑一次  
- **Then** Segmented 切回 **「会话」** Tab；应用不退出

- **Given** 用户在会话内 **「聊天工作区」** 子目录  
- **When** 系统返回或侧滑  
- **Then** 行为与 `import-export-navigation-fix` 验收一致（先上级目录，根目录回「聊天」Tab）；**不因本期改动而退化**

### 负向

- **Given** 本期仅增加日志  
- **When** 对比现网 user ops 与项目工作区（修复前）行为  
- **Then** 除 Bug2 规定的路径外，无其它用户可见行为变化

## 约束与依赖

- 依赖 `vfs-user-ops-unified-tool-turn` 的 U-A flush 与 edit 映射语义不变。
- 依赖 `import-export-navigation-fix` 中「聊天工作区」返回设计作为 Bug2 对齐基准。
- Bug1 日志结论将驱动**后续独立迭代**的行为修复 PRD/SPEC，不在本期交付。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 日志噪声 | 需控制级别与采样，避免生产包默认刷屏（实现见 SPEC） |
| Bug1 根因未明 | 本期仅观测；若日志仍不足以定位，需补充 Desktop 或 Core 侧观测 |
| Android only | Bug2 与 Bug1 日志验收均以 Android 为准 |
