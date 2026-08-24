---
date: 2026-08-24
dependency: [Iterations/character-card-import/prd.md]
---

# Session 导入后提示词缓存对齐 + Mermaid 失败原因展示 PRD

> **边界**：本文件为产品需求（PRD），不含接口设计、库表结构、任务拆分等 spec 内容。
> **关联**：`character-card-import`（导入功能本体）；`markdown-preview-mermaid` / `mermaid-fullscreen-viewer`（mermaid 渲染现状）；`message-set-floor` / `event-bus-compaction-conditions`（置位与压缩的缓存清空口径，本需求①复用其语义）。

## 背景

两个独立但同属「用户可感知的正确性/可诊断性」的问题：

### 问题①：session scope 导入后提示词与文件不一致

置位与压缩在隐藏可见历史时会同步清空 `rule_snapshot` + `file_cache` 并失效 token cache（见 RULE.md「置位」「压缩」词条），保证下次拼提示词时 workplace 区重新评估、文件正文重新读取。但**导入角色卡/zip 没有做这套对齐**：导入把文件写进 VFS 后，`assemble-workplace-display` 仍命中旧的 `rule_snapshot/canon`（不重评估规则）、`file_cache` 命中即返回旧正文（无 mtime 校验）——文件已经变了，发给 LLM 的 `<workplace>` 前缀还是旧的，造成提示词与文件不一致。

UI 文件树链路无缓存（导入后会刷新），不一致只发生在提示词侧，因此本需求聚焦缓存对齐。

### 问题②：mermaid 渲染失败不显示原因

双端 mermaid 图表渲染失败时只显示「图表渲染失败」占位（desktop badge / mobile CSS `::before` 文案），**失败原因（语法错误的行号与期望 token 等）被最后一层 catch 丢弃**。用户写错 mermaid 语法时无从排查，只能反复盲试。

## 目标（含成功指标）

1. session scope 导入（角色卡/zip）完成后，该会话下次拼提示词时 workplace 区基于新文件重新评估（`rule_snapshot` 重算、`file_cache` 重读、token cache 失效），提示词与导入后的文件一致。
2. mermaid 渲染失败时，用户能在失败占位处直接看到失败原因（含语法错误的行号/期望 token），无需打开控制台或日志。
3. 成功指标：导入→发起对话，`<workplace>` 前缀反映导入后的文件内容；写一段含语法错误的 mermaid，双端失败占位处可见「Parse error on line …」类原因文本。

## 用户与场景

| 场景 | 描述 |
|------|------|
| 导入角色卡后立即对话 | 用户导入新版角色卡，期望下一次对话的提示词已经用新文件，而不是旧缓存内容 |
| 导入 zip 世界书/设定包 | 同上；导入是「子树替换」，旧文件可能已被删除，提示词不能再引用它们 |
| 排查 mermaid 语法错误 | 用户在设定文档里写 mermaid 图（族谱/关系图），预览渲染失败，期望直接看到哪一行错了、期望什么 token，改起来有方向 |

## 范围

### 包含范围

- **问题①（仅 session scope）**：core 的角色卡导入与 zip 导入 service，在 **session scope 导入成功后**清空该 session 的 `rule_snapshot` 与 `file_cache` 两域、并失效该 session 的 prompt token cache（与压缩口径一致的三件套）；project/global scope 导入行为**保持现状不变**（已拍板不处理）
- **问题②**：双端 mermaid 失败占位展示失败原因——desktop 失败 badge/占位处显示错误消息；mobile 失败 `pre` 展示错误消息（样式单源，聊天与预览两管线同时生效）

### 不包含范围

- project/global scope 导入的缓存对齐（影响所有引用会话，需 scope→sessions 反查或惰性失效方案，另立项）
- 导入完成的跨端事件广播（`EVENT_WORKSPACE_IMPORTED` 之类；UI 树本就会刷新）
- mobile webview 错误传回 RN 侧日志（post 通道现成，可选增强，不在本期）
- mermaid 错误的国际化/美化（先原样展示 error message）
- `file_cache` 的 mtime 校验机制（治本但影响所有读取路径，另立项）

## 核心需求

### 1. session 导入后清空提示词缓存（core）

- 角色卡导入（`importFromBytes` 等 session scope 路径）与 zip 导入（session scope）成功后，执行与压缩一致的三件套：`clearDomain(sessionId, rule_snapshot)`、`clearDomain(sessionId, file_cache)`、`sessionApiPromptTokenCache.invalidate(sessionId)`
- 清空动作为**尽力而为**：KKV 清空失败不让导入报错（导入本身的文件写入已在事务内完成）；但正常路径必须成功
- 抽共享 helper 供两个导入 service 复用（置位/压缩如适用也可后续统一，本期不强求）
- project/global scope 的导入路径**不执行**清空（明确不动）

### 2. mermaid 失败原因展示（双端）

- **desktop**：渲染失败时在既有失败 badge/源码展示基础上，显示失败原因文本（错误消息，如 jison 的 Parse error 行号与期望 token）；失败缓存需一并保存错误文本，保证缓存命中的失败块（含 TTL 内重挂载）也能显示原因
- **mobile**：失败态在既有「图表渲染失败，已回退源码」提示基础上展示错误消息；实现走样式单源（`rich-content-styles.ts`），聊天与预览两条 webview 管线同时生效；不引入 `.mermaid-block.mermaid-failed` 组合选择器（既有测试禁止）
- 错误消息提取口径：`err instanceof Error ? err.message : String((err as {str?}).str ?? err)`（mermaid 11.x 的 DetailedError 形态兜底）
- 原样展示，不翻译不截断（长消息允许折行）

## 验收标准

### AC-1：session 角色卡导入后提示词对齐

- **Given** 会话 S 有旧 `rule_snapshot` 与 `file_cache`（此前对话产生）
- **When** 在 S 内导入一张角色卡（session scope）成功
- **Then** S 的 `rule_snapshot` 与 `file_cache` 两域被清空，S 的 prompt token cache 失效
- **And** 在 S 内发起下一次对话时，`<workplace>` 前缀基于导入后的文件内容（首次引用重新附全文）

### AC-2：session zip 导入后提示词对齐

- 同 AC-1，导入对象为 zip（session scope）

### AC-3：project/global 导入不受影响

- **Given** project（或 global）scope 下导入角色卡/zip
- **When** 导入成功
- **Then** 任何 session 的 KKV 缓存不被清空（行为与现状一致）

### AC-4：清空失败不阻塞导入

- **Given** KKV 清空抛错（注入故障）
- **When** session scope 导入
- **Then** 导入本身成功（文件已写入），清空失败被吞掉（不向用户报错）

### AC-5：desktop mermaid 失败显示原因

- **Given** desktop 预览/消息中一段含语法错误的 mermaid 源码
- **When** 渲染失败
- **Then** 失败占位处显示错误消息（含行号信息），源码仍可见
- **And** 同一失败块在缓存命中（重挂载）时原因文本仍显示

### AC-6：mobile mermaid 失败显示原因

- **Given** mobile 聊天/预览中一段含语法错误的 mermaid 源码
- **When** 渲染失败
- **Then** 失败提示处显示错误消息，源码仍可见
- **And** 聊天与预览两条管线行为一致（样式单源）

## 风险与待确认项

| 风险 | 说明 | 处置 |
|------|------|------|
| 首轮提示词变大 | 清空后首次引用重新附全文（与置位/压缩后行为一致），单轮提示词可能变大 | 预期行为，不特殊处理（与既有口径一致） |
| desktop 失败缓存结构 | 失败缓存需从「只存哨兵」扩为「哨兵+错误文本」，涉及 LRU 与测试重置的连带维护 | spec 细化，改动集中在 MermaidMarkdown 单文件 |
| mobile webview CSS `attr()` 展示 | `content: attr(data-mermaid-error)` 需 webview 内核支持（Chromium 系均支持） | 低风险；若消息过长需 `white-space: pre-wrap` 折行 |
| 错误消息含换行 | Parse error 消息可能多行 | 折行展示，样式上允许 |
