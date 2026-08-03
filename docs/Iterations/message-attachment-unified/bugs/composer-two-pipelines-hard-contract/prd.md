---
date: 2026-07-18
dependency:
  - Iterations/message-attachment-unified/prd.md
  - Iterations/message-attachment-unified/features/composer-at-token-prompt-dedup/prd.md
  - Iterations/message-attachment-unified/bugs/composer-at-token-tag-ux/prd.md
---

# composer-two-pipelines-hard-contract Bug PRD

## 背景

Feature `composer-at-token-prompt-dedup` 与 bug `composer-at-token-tag-ux` 已把 Composer 主路径做成两套分工：状态用无叉 chip，文件引用用正文 `@path` tag。交付后一度用「正文 `@` 扫描隐藏同 path 的 workplace chip」当补丁（`d9c55a21`），被否决并 revert（`bd1817d0`）。

问题不在「还要不要两套」，而在：**硬合同从未写进敏捷验收**，旧 PRD（双条有叉 attach、选择器进 chips）与死 API / 过期单测仍在，容易再次把两套搅在一起，或把「清残留」当成可欠的技术债。

本 Bug 把产品硬合同写成唯一验收源，并清理会破坏该合同的残留；**不**用 `@` 藏 chip 消叠显，**不**收紧非 Composer 的 `attachments` API 旁路。

## 目标（含成功指标）

1. 产品硬合同不可软化：Chip 只表达规则变更与改稿；`@path` tag 只表达文件引用。
2. 禁止错误修法：不得用正文 `@` 列表控制状态 chip 显隐。
3. 清掉会把「文件引用」重新接回 Composer chip 的死路径与错误测试期望。
4. 旧文档明确废止与硬合同冲突的验收条，避免评审误用。

**成功指标（可判定）**

- Composer 状态行仅 `workplace` + `user_ops`，且无叉号；界面上不存在文件引用 attach chip。
- 选择器 / typeahead 确认只插入正文 `@路径`；发送文件引用只来自正文扫描。
- 代码库中不存在「用 `@path` / `scanAtPathAttachments` 结果隐藏或过滤状态 chip」的实现。
- 不再导出可构造 Composer 文件引用 attach chip 的死 API；相关单测不再要求「replace 保留 attach」。
- Desktop 已发送消息附件列表中，`source:attach` **不得**显示成「规则 · …」。
- `composer-ops-chip-lifecycle`、`file-ref-picker-ux`、父级 `message-attachment-unified` 正文中与硬合同冲突的验收已打 supersede / 废止说明。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 作者改规则 / 改稿 | 只看到无叉状态 chip（`规则 ·` / `改稿 ·`）；不能叉掉否认真实变更 |
| 作者 `@` 引用文件 | 只在输入框看到 `@路径` tag；上方不出现文件引用 chip |
| 作者同时改规则并 `@` 同一文件 | 可同时看到「规则 ·」chip 与 `@tag`（两条事实）；系统不得用 `@` 自动藏掉状态 chip |
| 作者撤销发送 / 编辑回填 | 恢复正文 `@路径` 与状态投影；不出现文件引用 attach chip |
| 评审 / 后续实现者 | 以本 PRD 为 Composer UI 分工 SSOT；不得再按旧「双条有叉 / 确认进 chips」验收 |

## 范围

### 包含范围

1. **硬合同锁定**（Desktop + Mobile Composer）：Chip = 仅规则变更 + 改稿、无叉；`@path` tag = 仅文件引用；两套互不控显隐。
2. **禁止修法**：禁止恢复或新增 `filterStatus*ByAtPaths` 及任何「用正文 `@` 藏/过滤状态 chip」的实现与测试期望。
3. **清残留（范围 A）**：
   - 删除双端 `attachmentsFromPickerSelection`（会构造 `source:attach` 的死导出）
   - 删除 Mobile `mergeComposerAttachAttachments`（及仅为其服务的本地 helpers）
   - 双端 `AttachmentDraftChips` 的 `showRemove` 默认改为不可叉（与唯一合法调用一致）
   - 修正 Mobile「整表替换仍保留 attach」过期单测，对齐 Core「不保留 attach」
   - Desktop `MessageAttachmentGroupCard`：对 `source:attach` 使用独立文案，禁止误标「规则 ·」
4. **文档 supersede**：在 `composer-ops-chip-lifecycle`、`file-ref-picker-ux`、父级 `message-attachment-unified` 的 PRD/SPEC 顶部（或冲突条款处）标明被本 Bug / `composer-at-token-prompt-dedup` 废止的旧验收；在 `composer-at-token-prompt-dedup` PRD 增加指向本硬合同的指针。

### 不包含范围

- 用隐藏一侧的方式消除「同 path 状态 chip + `@tag`」同屏（另案未定；本 Bug **禁止**用 `@` 藏 chip 当作解法）
- 收紧 `runAgentTurn` / Desktop IPC / Mobile wrapper 的显式 `attachments` 旁路（非 Composer UI 合同；另开）
- 提示词 path 去重规则本身（属 `composer-at-token-prompt-dedup` 提示词合同）
- 重做 Mobile/Desktop `@` 编辑器实现（tag-ux 观感已另案；本 Bug 只锁分工与清残留）
- 历史会话消息气泡结构大改（仅修 Desktop attach 误用「规则 ·」文案）

## 核心需求

1. **Chip 职责**：Composer 状态行只展示规则变更（workplace）与改稿（user_ops）；一律无叉；不得用 chip 表达文件引用。
2. **引用职责**：文件引用只以输入框 `@路径` tag 表达；选择器与搜索确认只插正文；发送时从正文扫描得到 `source:attach` 落库（落库附件 ≠ Composer chip）。
3. **互不控显隐**：删 `@` 不得清真实规则/改稿投影；有 `@` 不得自动隐藏对应 path 的状态 chip。
4. **零妥协**：上述分工不是可欠债的「理想态」；残留死路径与错误测试期望必须在本 Bug 内清除到不可再被误接。
5. **文档唯一口径**：与硬合同冲突的旧 Feature 验收必须标明废止；后续评审以本 PRD + dedup UI 条款为准。

## 验收标准

- [ ] **Given** Composer 存在规则差集与改稿预览，**When** 打开输入区，**Then** 仅见无叉状态 chip（`规则 ·` / `改稿 ·`），且**不存在**文件引用 attach chip。
- [ ] **Given** 用户通过选择器或 typeahead 确认文件，**When** 回到输入区，**Then** 仅正文出现 `@路径`，attachments 草稿不出现 `source:attach` chip。
- [ ] **Given** 同 path 同时有规则差集与正文 `@path`，**When** 渲染 Composer，**Then** 状态 chip 与 `@tag` 可同时存在；代码中**无**按正文 `@` 过滤状态 chip 的逻辑。
- [ ] **Given** 搜索仓库，**When** 查找 `attachmentsFromPickerSelection` / `mergeComposerAttachAttachments`，**Then** 无导出、无调用方。
- [ ] **Given** `AttachmentDraftChips`，**When** 未显式传 `showRemove`，**Then** 默认为不可叉。
- [ ] **Given** Mobile 草稿 replace 单测，**When** 执行，**Then** 断言为**不保留** `source:attach`（与 Core 一致）。
- [ ] **Given** Desktop 已发送消息含 `source:attach` 附件，**When** 看附件卡文案，**Then** **不是**「规则 · …」。
- [ ] **Given** lifecycle / file-ref-picker / 父级 PRD·SPEC，**When** 阅读冲突条款，**Then** 可见 supersede / 废止说明指向本硬合同或 dedup。
- [ ] **Given** `undo_send` 或编辑回填，**When** Composer 恢复，**Then** 仅正文 `@路径` + 状态投影，无文件引用 attach chip。

## 约束与依赖

- 依赖并巩固：`composer-at-token-prompt-dedup`（UI 分工）、`composer-at-token-tag-ux`（文案与 tag 观感）。
- 局部 supersede：`composer-ops-chip-lifecycle` 的「下条有叉 attach」、`file-ref-picker-ux` 的「确认进 chips」、父级正文中「可叉 `@` chip」叙述。
- 提示词 attach→workplace 去重保持另合同，**不得**反写为本 Bug 的 UI 显隐条件。

## 风险与待确认项

| 风险 | 说明 |
|------|------|
| 删死导出影响外部脚本 | 仓库内已无调用；若有仓外依赖需在实现时再搜一次 |
| 同 path 双事实同屏仍可能被误认为「attach chip 回来了」 | 靠文案/tag 区分与本硬合同说明；**禁止**再引入 `@` 藏 chip |
| IPC attachments 旁路仍在 | 本档明确不收；若产品要封死，另开变更 |
