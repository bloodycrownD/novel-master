---
date: 2026-07-04
dependency:
  - Iterations/chat-rollback-vfs-tool-fixes/prd.md
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/mobile-user-ops-logging-project-workspace-back/prd.md
---

# VFS 工具错误诊断与保存失败修复 PRD

> **类型**：Bugfix  
> **平台**：Core + Mobile + Desktop（Agent 工具错误与保存链路双端验收）  
> **关联迭代**：`chat-rollback-vfs-tool-fixes`、`vfs-user-ops-unified-tool-turn`、`mobile-user-ops-logging-project-workspace-back`

## 背景

Mobile 真机验证中发现三类与 VFS 工具（`write` / `edit`）相关的问题，影响 Agent 自我纠错与用户手动保存体验：

1. **内部 ID 泄露给 AI**：Agent 调用 `write` / `edit` 失败时，写入会话历史的 tool result 文案中常含物理存储路径前缀 `/projects/{projectId}/sessions/{sessionId}/…`，模型可见内部 projectId、sessionId，且与工具 schema 中的逻辑路径（如 `/foo.md`）不一致，增加噪声并干扰纠错。
2. **覆盖/保存时出现「找不到旧字符串」**：会话内编辑已有文件并保存时，偶发 `Replace string not found in …`（`REPLACE_NOT_FOUND`）类失败。Mobile 保存映射使用的 baseline 为编辑器内存快照（`savedContent`），Desktop 则在保存瞬间重新读取磁盘内容；当文件在编辑期间被 Agent 或其他入口修改时，Mobile 生成的 `edit` 的 `oldString` 与磁盘当前内容不一致，导致保存失败。
3. **失败信息对 AI 不够具体**：`write` 失败时 LLM 仅见笼统英文消息，难以区分路径问题、版本冲突等类别；`edit` 在 `oldString` 未命中时仅返回「Replace string not found」，不含文件内可定位的相似片段（最长公共子串），模型难以据此修正下一次调用。

`chat-rollback-vfs-tool-fixes` 已将工具失败从泛化「Tool failed: write」改进为展开底层 `VfsError.message`，但未解决路径脱敏与 edit 内容级诊断。`mobile-user-ops-logging-project-workspace-back` 为 edit 保存失败补充了诊断日志，**刻意未修行为**；本迭代承接其观测结论，交付行为修复与 Agent 侧诊断增强。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **不向 AI 暴露内部 ID** | Agent `write` / `edit` 失败写入 LLM 历史的 tool result 中，**不出现** `/projects/{uuid}/sessions/{uuid}/` 形态路径；路径与工具入参一致为**逻辑路径** |
| **保存不再误报 REPLACE_NOT_FOUND** | Mobile / Desktop 会话内 FileEditor 保存已有文件（经 user VFS turn 的 edit 路径）在「编辑期间无外部并发写入」场景下，**REPLACE_NOT_FOUND 复现率为 0** |
| **保存 baseline 与 Desktop 对齐** | Mobile 与 Desktop 保存映射使用**同一 baseline 语义**（以保存瞬间磁盘内容为准，而非仅内存快照） |
| **write 失败可分类** | LLM 可见的 write 失败 tool result **标明失败类别**（如路径不存在、目标是目录、版本冲突、参数无效等），非单一含糊英文句 |
| **edit 失败可定位** | edit 因 `oldString` 未命中失败时，tool result **包含**当前文件内容与 `oldString` 之间的**最长公共子串**（须在文件内容中可搜索到的连续片段），并注明在文件中的出现次数或位置提示 |
| **双端验收通过** | 上述 Agent 工具错误改进在 Mobile、Desktop 会话 Agent 对话中均可验证；保存修复在 Mobile、Desktop FileEditor 均可验证 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 写作用户 | 在会话工作区打开已有文件，局部修改后点保存，期望成功且无「Replace string not found」类 Toast |
| 与 Agent 协作的用户 | 编辑文件期间 Agent 也可能改同一文件；保存时应基于最新磁盘内容决策 edit / write，或给出可理解冲突提示 |
| Agent 用户（Mobile / Desktop） | 模型调用 `write` / `edit` 失败后，根据 tool result 中的**逻辑路径、失败类别、edit 相似片段**调整下一次调用 |
| 工程/支持人员 | 用户反馈保存失败时，错误信息足以区分 baseline 漂移、版本冲突与参数问题，无需从物理路径反查 session |

## 范围

### 包含范围

1. **Core — tool result 路径脱敏**：Agent 工具失败时，写入 LLM 历史的 `tool_result.content` 使用逻辑路径，不含 `projectId` / `sessionId` 物理前缀。
2. **Core — write 失败分类诊断**：`write` 工具执行失败时，LLM 可见文案包含可区分的失败类别与关键上下文（如版本冲突时的 expected / actual）。
3. **Core — edit 失败最长公共子串提示**：`edit` 因 `REPLACE_NOT_FOUND` 失败时，LLM 可见文案包含最长公共子串、其在文件中的可搜索性说明（出现次数；若多次则提示）。
4. **Mobile + Desktop — 保存 baseline 对齐**：会话 scope FileEditor 保存已有文件时，保存映射 baseline 与 Desktop 现行语义一致（保存瞬间读取磁盘当前内容）。
5. **Mobile + Desktop — 保存失败用户反馈**：user VFS turn 执行失败（含 REPLACE_NOT_FOUND）时，终端用户看到**可理解的中文失败提示**（可保留简短技术摘要，但不得仅英文 VfsError 原文）。
6. **Mobile + Desktop — Agent 工具卡与 LLM 一致**：Agent 工具失败终态卡片展示的失败摘要与 LLM 收到的诊断信息**语义一致**（路径均为逻辑路径）。

### 不包含范围

- 本 PRD 不定义技术方案、接口、算法实现或任务拆分（见后续 SPEC）
- `write` 的 content 转义/编码校验（当前不存在此类错误，不在本期新建）
- 最长公共**子序列**（LCS subsequence）诊断（本期仅要求**最长公共子串**，须在文件内连续可搜）
- user ops flush 后 UA 卡片「恒显示成功」的产品改版（除非保存 execute 失败，不涉及 flush 合成逻辑重写）
- per-tool 流式 loading UI（见 `chat-tool-turn-phase-ui`，不在本期）
- CLI 专项 UI 验收（Core 行为一致即可）
- iOS 专项验收（与现有 Mobile 迭代一致，Android 为准）

## 核心需求

1. **逻辑路径回传 LLM**：任意 session 作用域下 Agent `write` / `edit`（及同类 VFS 变异工具）失败时，tool result 中的路径展示为与用户、工具 schema 一致的逻辑路径（如 `/chapter.md`），**不得**嵌入 `/projects/…/sessions/…/`。
2. **write 失败可读分类**：write 失败时，LLM 可见 tool result 须让模型能区分至少：路径不存在、路径非法或越界、目标是目录、版本冲突（含版本号）、入参校验失败；禁止仅返回无分类的「Tool failed: write」。
3. **edit 失败相似片段提示**：edit 因找不到 `oldString` 失败时，LLM 可见 tool result 须包含：失败类别（替换串未找到）、逻辑路径、**最长公共子串**（oldString 与当前文件内容的连续公共片段）；若子串长度低于阈值（由 SPEC 定义，如 &lt; 4 字符）则明确提示「几乎无匹配，建议 read 后重试」。
4. **Mobile 保存 baseline 修正**：Mobile 会话 FileEditor 保存时，用于 `mapUserSaveToToolUses` 的 baseline **不得**仅依赖过期的 `savedContent`；应与 Desktop 一样以保存操作触发时的磁盘内容为准。
5. **保存失败可感知**：Mobile / Desktop 会话内保存 execute 失败时，用户获得明确失败反馈（中文为主），说明是「内容已与服务器/磁盘不一致，请刷新后重试」或等价可理解语义，而非仅英文 `Replace string not found in …`。
6. **与既有 LLM 诊断改进兼容**：在 `chat-rollback-vfs-tool-fixes` 已要求的「展开 VfsError 原因」基础上**增量**增强，不 regress 为泛化失败文案。
7. **双端 Agent 一致**：Mobile、Desktop 会话 Agent 对同一失败场景产生的 LLM tool result 语义一致（均逻辑路径 + 分类 + edit 子串提示）。

## 验收标准

### 1. Agent 工具错误不含内部 ID（Mobile + Desktop）

- **Given** 会话 scope 下 Agent 调用 `edit` 或 `write` 且故意失败（如路径不存在、oldString 未命中）  
  **When** 助手消息落库并进入下一轮 LLM 请求历史  
  **Then** 对应 `tool_result.content` 中 **不包含** 子串 `/projects/` 或 `/sessions/` 及 UUID 形态 session/project 标识  
  **And** 路径形态与工具调用入参中的逻辑路径一致（如 `/test.md`）

### 2. write 失败含可分类原因（Mobile + Desktop Agent）

- **Given** Agent 对**已存在**文件调用 `write` 且触发版本冲突  
  **When** 工具失败并写入 tool result  
  **Then** LLM 可见 content 标明**版本冲突**语义，并含 expected / actual 版本信息  
  **And** 不等于仅 `Error: Tool failed: write`

- **Given** Agent 对不存在路径调用 `write`（且无自动建目录语义）  
  **When** 工具失败  
  **Then** LLM 可见 content 标明**路径不存在**或等价分类，而非无法与版本冲突区分的含糊句

### 3. edit 失败含最长公共子串（Mobile + Desktop Agent）

- **Given** 文件内容为 `function hello() { return 1; }`，Agent 提交的 `oldString` 为 `function hello() {    return 1; }`（空格差异）  
  **When** edit 失败（REPLACE_NOT_FOUND）  
  **Then** tool result content 包含**最长公共子串**（如 `function hello()` 或更长连续片段）  
  **And** 该子串可在当前文件内容中作为连续子串找到  
  **And** 提示模型该片段可用于定位修正区域

- **Given** `oldString` 与文件内容几乎无关（公共子串极短）  
  **When** edit 失败  
  **Then** tool result 明确提示匹配度极低，建议先 `read` 再 edit

### 4. Mobile 保存不再因 baseline 漂移失败（Mobile + Desktop）

- **Given** 用户在会话 FileEditor 打开 `/note.md`（磁盘内容为 A）  
  **And** 编辑期间 Agent 将同一文件改为 B（用户编辑器仍显示基于 A 的修改，欲保存为 C）  
  **When** 用户点击保存  
  **Then** 系统 **不得** 因基于 A 计算的 `oldString` 在磁盘 B 上找不到而直接 REPLACE_NOT_FOUND 失败  
  **And** 行为符合 SPEC 定义的产品策略（如基于磁盘 B 重新 diff、write fallback 或冲突提示——至少一种可预期结果，且用户可理解）

- **Given** 用户打开文件后**无外部写入**，仅本地编辑并保存  
  **When** 保存经 user VFS turn 的 edit 路径  
  **Then** **不出现** REPLACE_NOT_FOUND

### 5. Mobile 与 Desktop 保存 baseline 一致（Mobile + Desktop）

- **Given** 同一项目、同一会话、同一文件、相同编辑内容  
  **When** 分别在 Mobile 与 Desktop FileEditor 执行保存  
  **Then** 两者映射出的工具选择（edit hunks / write fallback / noop）**一致**  
  **And** 不得因 Mobile 使用过期 `savedContent`  alone 而与 Desktop 分叉

### 6. 保存失败用户可见中文反馈（Mobile + Desktop）

- **Given** user VFS turn execute 因 REPLACE_NOT_FOUND 失败  
  **When** 用户在 FileEditor 点保存  
  **Then** 出现中文失败提示，用户能理解需刷新或重新打开文件后再编辑  
  **And** 不得仅展示未本地化的英文 `Replace string not found in …` 作为唯一说明

### 7. 回归 — 既有工具失败展开不回退

- **Given** 任意 VFS 工具失败  
  **When** 写入 tool result  
  **Then** content **不得**回退为无信息的 `Error: Tool failed: {name}` 而不含底层原因

## 约束与依赖

- **前置 PRD**：`vfs-user-ops-unified-tool-turn`（user ops 两阶段语义）、`chat-rollback-vfs-tool-fixes`（LLM 工具失败须含原因）、`mobile-user-ops-logging-project-workspace-back`（edit 保存观测与复现路径）
- **术语**：「最长公共子串」指 oldString 与当前文件内容的**最长连续公共片段**（Longest Common Substring），不是最长公共子序列（LCS subsequence）
- **平台**：Core 行为统一；Mobile Android + Desktop 双端验收 Agent 与 FileEditor 路径

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 编辑期间 Agent 并发改文件 | 保存策略（强制基于最新磁盘 diff vs 阻塞并提示冲突）需在 SPEC 中择一或组合；PRD 要求「不得 silent REPLACE_NOT_FOUND」，具体策略由 SPEC 细化 |
| 最长公共子串过短 | 对几乎无关的 oldString，诊断价值有限；需 SPEC 定义最短展示阈值与 fallback 文案 |
| 多 hunk edit 串行 | 相邻 hunk 首刀改坏后续锚点仍可能导致 REPLACE_NOT_FOUND；若 Mobile baseline 修复后仍复现，是否在本迭代一并处理由 SPEC 评估 |
| user ops 卡片与 execute 失败 | 本迭代聚焦 execute 失败反馈；flush 后 UA 卡片恒成功态不在本期改版范围 |
