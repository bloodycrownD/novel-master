---
date: 2026-07-12
dependency:
  - Iterations/virtual-worktree/prd.md
  - Iterations/worktree-vfs-ui-refresh-fix/prd.md
  - Iterations/message-worktree-refresh-tighten/prd.md
  - Iterations/message-set-floor/prd.md
  - Iterations/agent-worktree-block-ui/prd.md
---

# Worktree 架构收敛 PRD

## 背景

Worktree（工作区规则与文件纳入）在现网已承担两类用户可见能力，但命名与心智模型仍停留在多次渐进改造阶段：

| 能力 | 用户看到什么 | 目标口径 |
|------|--------------|----------|
| **实时规则视图** | 工作区列表上的「规则·开/关」「跟随·全内容」等；动态宏 `{{$filetree}}` 展开的树 | 按当前 VFS 元数据 + 规则表 **实时计算**，不读提示词快照 |
| **提示词文件块** | 「查看提示词」与 Agent 运行时的持久 worktree 段（`<file>` 正文） | **会话级快照（capture）**；在约定 **应用层业务操作** 后 **主动重拍**，读取时直接用已 capture 的完整内容 |

上述分离在 [`worktree-vfs-ui-refresh-fix`](../worktree-vfs-ui-refresh-fix/prd.md) 已落地，但现网存在两类耦合问题：

1. **被动 markDirty**：只打脏标、读 prompt 时才物化，与「快照是主动行为」不符。
2. **hide 与 capture 绑死**：Core 的 `hideMessagesInRange` / `showMessagesInRange` 自带 worktree 快照副作用；置位、压缩虽为不同业务，却间接依赖 hide 路径触发刷新。而提示词文件块 **不读取** `message.hidden`，这种耦合无数据依据。

本 PRD 要求：

- **用 capture 彻底替代 markDirty**（主动物化 + 写入快照，读时直接取快照）。
- **capture 只留在应用层**：绑在有名字的业务入口（置位、压缩、改规则、删 VFS、手动刷新等）；**Core 的 hide/show 仅为 transcript 原语，不触发 capture**。
- 抽离 **规则引擎** + **物化引擎**，由 **Worktree 门面** 统一对外。

[`message-set-floor`](../message-set-floor/prd.md) 已移除聊天菜单中的批量 hide/unhide；**置位** 成为用户改消息可见性的主要入口。**压缩** 内部仍会调用 hide 藏消息，但 capture 应由 **压缩业务** 显式触发，而非 hide 原语附带。Agent 同轮 run 内工具写盘 **不** capture。

不包含具体接口、类名、任务拆分（见后续 SPEC）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **心智模型清晰** | 文档与 UI 能区分「**工作区规则视图（实时）**」与「**提示词文件块（capture）**」；「刷新工作树」不再误导为刷新列表 |
| **capture 取代 markDirty** | 无 markDirty/dirty/invalidate 对外概念；统一 **capture** / **getCapturedBlock** |
| **capture 在应用层** | 仅列出的业务入口触发 capture；Core hide/show **不** 触发 |
| **用户可见结果不变** | 置位、压缩、改规则、删 VFS、手动刷新后，提示词文件块与现网 markDirty 后读取 **等价**；Agent run 内写盘仍不 capture |
| **规则视图始终实时** | 列表与 `{{$filetree}}` 不读 capture 缓存 |
| **引擎职责分离** | 规则引擎（不算正文）与物化引擎（产出块文本）可单独描述、测试 |
| **维护成本下降** | 列表行结构化 enum；Presentation 层出中文；清历史残余 |

## 用户与场景

**用户：** 使用 Mobile / Desktop 进行长会话写作、调试 Agent 提示词、管理工作区文件纳入规则的作者。

| 场景 | 期望体验 |
|------|----------|
| **改规则后看列表** | 工作区列表实时反映新规则，无需理解快照 |
| **改规则后看提示词** | 规则保存成功后 **应用层 capture**；打开「查看提示词」已是新快照 |
| **置位** | 置位完成后 **置位入口 capture**（内部虽调 hide/show，但 capture 不挂在 hide 上） |
| **压缩** | 压缩完成后 **压缩入口 capture**（内部虽调 hide，但 capture 不挂在 hide 上） |
| **Agent 写盘** | Explorer 可见新文件；提示词文件块直到上述业务 capture 或手动 capture 才更新 |
| **跨端** | 规则语义一致；列表布局可不同 |
| **维护者** | 新业务要刷新提示词块时，在 **应用层入口** 显式 capture，不修改 Core hide |

## 范围

### 包含范围

**迭代 A — capture 替代 markDirty，且上移到应用层**

- **机制**：删除 markDirty；**capture** = 按当前规则物化完整文件块并写入会话快照；**getCapturedBlock** = 读快照
- **Core 消息原语解耦**：
  - `hideMessagesInRange` / `showMessagesInRange`（及底层 `hideRange` / `showRange`）**仅** 改 transcript 可见性
  - **移除** 上述路径对 worktree 快照 / capture 的任何副作用
  - `MessageTranscriptEffectsService` **不再** 依赖 worktree 快照 store（名称由 SPEC 定）
- **应用层 capture 白名单**（仅此列表；各入口 **自行** 在业务完成后 capture，**不** 借 hide 继承）：

  | 业务入口 | 说明 |
  |----------|------|
  | **置位** | 双端置位 handler / IPC 完成后 capture |
  | **压缩上下文** | compaction 编排完成后 capture（内部 hide 不自带 capture） |
  | **worktree 规则变更** | 目录/文件 inclusion 等保存成功后 capture |
  | **VFS 删除** | 含规则清理后 capture |
  | **手动刷新提示词文件块** | Desktop main `handleWorktreeCaptureSessionBlock`（IPC `WORKTREE_CAPTURE_SESSION_BLOCK`，旧 channel deprecated alias 一版）；Mobile `handleCapturePromptFileBlock`；均经共享 `captureSessionWorktreeBlock` / `captureSessionWorktreeBlockOnManualRefresh` |

- **双端命名**（详见 SPEC §双端命名对照）：领域层与共享 helper **同名**（`capture` / `getCapturedBlock` / `captureSessionWorktreeBlock`）；五类白名单 **统一 capture 动词**；平台壳（IPC handler / hook）与 UI 刷新原语（`notifyWorkspaceMutated` ↔ `bumpWorktreeUiToken`）**允许不同**，以 SPEC 对照表为准
- **不 capture**：truncate / rollback / Agent·用户 VFS 写盘（write/mkdir/rename）/ pullTemplate / **裸 hide 或 show**（无对应业务入口时）；**condition 压缩**（agent-runner）不 capture
- **Desktop renderer**（`apps/desktop/renderer/App.tsx`）：会话「更多」按钮「刷新工作树」→「**刷新提示词文件块**」；成功 Toast 为「**已更新提示词文件块快照**」（替换现「工作树已刷新」）
- **Mobile**：会话抽屉入口文案同步为「刷新提示词文件块」；成功 Toast 与 Desktop 对齐为「已更新提示词文件块快照」
- 清理 markDirty / invalidate / getOrRefresh 等历史命名；对外禁止 `handleRefreshWorktree`、`handleWorktreeInvalidateSessionSnapshot`、`invalidateSessionWorktreeSnapshot`

**迭代 B — 规则引擎与物化引擎 + Worktree 门面**

- **规则引擎（实时）**：VFS 元数据 + 规则 → 结构化规则视图（enum）；供 UI、`{{$filetree}}`；不读正文、不 capture
- **物化引擎**：规则视图 + 按需读正文 → 完整文件块文本；供 **capture** 写入
- **Worktree 门面**：列表、改规则、capture / getCapturedBlock；消费方不绕过门面
- **Presentation 层**：enum → 中文标签；双端不反向解析 Core 中文字符串
- 统一双端目录规则表单与列表语义；合并重复遍历

### 不包含范围

- 修改 worktree **规则语义**（head/tail/fill 等）—— 仍以 [`virtual-worktree`](../virtual-worktree/prd.md) 为准
- 修改 Agent layout worktree 双消息 wire —— 仍以 [`agent-worktree-block-ui`](../agent-worktree-block-ui/prd.md) 为准
- 强制 Desktop/Mobile 工作区列表刷新时机完全统一
- 强制双端平台壳（IPC handler / React hook）函数名逐字相同
- 取消 `{{$filetree}}` 或持久 worktree 块之一
- schema / IPC / 类名 / 测试矩阵 / 任务拆分（留给 SPEC）
- CLI `nm message hide/show` 与 GUI 对齐（记风险，非必做）

## 核心需求

1. **双轨语义**  
   **工作区规则视图（实时）** 与 **提示词文件块（capture）**；任何「刷新」须标明影响哪一轨。

2. **capture 替代 markDirty，且只在应用层**  
   - 有名字的业务操作完成后 **主动 capture**  
   - **Core hide/show 不 capture**  
   - 置位、压缩 **各自** 在应用层 capture，不因内部调用 hide 而自动 capture

3. **`{{$filetree}}` 永远走实时规则**  
   禁止从 capture 缓存读宏树。

4. **规则引擎独立**  
   求值不依赖 capture；与 VFS 正文读取解耦。

5. **物化引擎独立**  
   capture 存 **物化后的完整文本**，不是规则表副本。

6. **Worktree 门面统一 capture**  
   App / Agent / CLI 经门面 `capture` / `getCapturedBlock`；禁止 scattered markDirty。

7. **结构化规则状态 + Presentation 分离**  
   列表 API 提供 enum；中文仅展示层。

## 验收标准

### A. capture 与应用层白名单

- **Given** 用户 **置位**，**When** 完成，**Then** **置位应用入口** 已 capture；**And** 提示词文件块为最新快照。
- **Given** 用户 **压缩上下文**，**When** 完成，**Then** **压缩应用入口** 已 capture（**非** hide 原语附带）。
- **Given** 用户 **改规则** 并保存，**When** 成功，**Then** 规则变更入口已 capture。
- **Given** 用户 **删除** VFS 文件/目录，**When** 完成，**Then** 删除入口已 capture；快照不含已删路径。
- **Given** 用户 **手动刷新提示词文件块**，**When** 完成，**Then** Desktop main `handleWorktreeCaptureSessionBlock` 或 Mobile `handleCapturePromptFileBlock` 已立即 capture；**And** 工作区列表 **不** 因此被误刷新。
- **Given** Agent 同 run 内 **写 VFS**，**When** 未发生上述 capture，**Then** 文件块保持 run 开始时的快照。
- **Given** **回滚** 或 **truncate**，**When** 完成，**Then** **不** 仅因该操作 capture。
- **Given** 代码直接调用 Core **hide/show**（无业务入口），**When** 完成，**Then** **不** capture。

### B. 实时规则视图

- **Given** 用户改规则，**When** 列表重载，**Then** 展示与规则一致，**且** 不读 capture。
- **Given** 含 `{{$filetree}}`，**When** 展开宏，**Then** 与同时刻规则引擎一致；**不** 读 capture。

### C. 引擎与门面

- **Given** 架构说明，**Then** 能区分规则引擎、物化引擎、Worktree 门面；Core hide 与 capture 无耦合。
- **Given** 双端 UI 渲染列表行，**Then** 基于结构化 enum；**不** 以解析 Core 中文字符串为唯一逻辑依据。

### D. 文案与残余

- **Given** Desktop 会话「更多」手动刷新，**Then** renderer `App.tsx` 按钮为「刷新提示词文件块」（非「刷新工作树」）；成功 Toast 为「已更新提示词文件块快照」。
- **Given** Mobile 手动刷新，**Then** 入口文案与 Toast 与 Desktop 对齐（「刷新提示词文件块」/「已更新提示词文件块快照」）。
- **Given** 手动刷新，**Then** capture 在 Desktop main `handleWorktreeCaptureSessionBlock`（`handlers/worktree.ts`，IPC `WORKTREE_CAPTURE_SESSION_BLOCK`）或 Mobile `handleCapturePromptFileBlock` 完成；renderer 仅调 IPC / 展示 Toast，**不** 在 renderer capture；**不** 触发消费方 ① 列表刷新。
- **Given** 检索 `markDirty` / `invalidateSessionWorktreeSnapshot` / `getOrRefresh` / `handleRefreshWorktree` / `handleWorktreeInvalidateSessionSnapshot`，**Then** 提示词路径已迁移为 `capture` / `getCapturedBlock` / `captureSessionWorktreeBlock`；Core effects **无** worktree 快照依赖。

### E. 双端规则 UX（最低一致）

- **Given** 同 session 同文件，**When** 规则未变，**Then** 双端纳入 + 展示 + 目录开/关 **语义** 一致。
- **Given** 目录无持久化规则，**When** 打开规则表单，**Then** 双端 ruleEnabled 初值与列表 **一致**。

## 约束与依赖

- 依赖：[`virtual-worktree`](../virtual-worktree/prd.md)、[`worktree-vfs-ui-refresh-fix`](../worktree-vfs-ui-refresh-fix/prd.md)、[`message-worktree-refresh-tighten`](../message-worktree-refresh-tighten/prd.md)、[`message-set-floor`](../message-set-floor/prd.md)、[`agent-worktree-block-ui`](../agent-worktree-block-ui/prd.md)。
- **与 [`message-worktree-refresh-tighten`](../message-worktree-refresh-tighten/prd.md) 对齐**：delete/rollback 不 capture；本 PRD **进一步** 要求 hide/show 原语也不 capture，capture 仅应用层白名单。
- **与 [`message-set-floor`](../message-set-floor/prd.md) 的关系**：置位仍触发 capture，但改为 **置位应用入口显式 capture**，不再经 Core effects 的 hide 副作用链。
- Agent 写盘不 capture 的策略不变。

## 非功能需求（业务/体验）

- 规则视图重算仅元数据 + 规则表，不读全文。
- 用户只见两个概念：实时规则视图、提示词文件块快照。
- 双端 Agent 写盘后列表刷新差异若保留，须在帮助或风险节说明。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| capture 同步 vs 异步 | 应用层 capture 是否阻塞 UI 由 SPEC 定（可短时 loading） |
| 双端 capture 落点 | Desktop IPC 与 Mobile hook 壳名可不同，须经 SPEC 对照表一一映射；T-WEC4/4b parity 测保证行为一致 |
| 压缩 capture | **仅** manual handler/hook 在 emit 成功后 capture；condition 压缩（agent-runner）**不** capture |
| CLI hide/show | 直调 Core hide 不 capture；若需与 GUI 一致，CLI 须走带 capture 的业务入口 |
| 重命名目录 | 现网部分路径未 capture；收敛时审计并闭合 |
| 迭代 B 工作量 | 引擎 + Presentation 触达面大；SPEC 分 milestone |

## 里程碑（建议，偏 plan）

| 里程碑 | 交付物（业务） |
|--------|----------------|
| **M1 — capture 替代 markDirty + 应用层白名单** | Core hide/show 解耦；五类白名单 capture；移除 markDirty；双端命名对照（领域层同名、手动入口 `handleWorktreeCaptureSessionBlock` / `handleCapturePromptFileBlock`） |
| **M2 — 规则引擎 + 结构化视图** | 实时列表与 `{{$filetree}}` 走引擎；Presentation 接入 |
| **M3 — 物化引擎 + 门面** | capture 经物化引擎；门面统一 capture / getCapturedBlock |
| **M4 — 双端 UX 一致性与清债** | 表单初值、标签词汇表、已知分叉闭合或文档化 |
