---
date: 2026-07-16
dependency: Iterations/message-attachment-unified/prd.md
---

# composer-ops-chip-lifecycle Feature PRD

## 背景

父级迭代 `message-attachment-unified` 已把 workplace 增量、`@` 引用、user_ops 统一进消息附件与 Composer 草稿。现状上三类附件 **混在同一条 chip 行**，且 **均可点叉移除**，但：

- **user_ops / workplace** 表达的是「工作区已发生的真实变动 / 规则可见性差集」，**不是**用户可在 Composer 里任意「取消注入」的引用；
- 点叉只改 UI draft，**清不掉** pending / 规则差真实源，造成「看起来取消了、空发仍可能带上」的心智冲突；
- chip 文案不统一（「工作区」「@ path」、user_ops 工具名摘要），目录还单独配色；
- user_ops 进度主要靠发送时才相对上次发送算净差；写盘后 Composer **不按文件**实时反映抵消；
- 正文与 `@` attach 仅进程内存（Desktop 切会话更弱），杀进程丢失；而 pending 在 `chat_session` 列上，与「置位/压缩清常驻工作区」不同步。

本 Feature 在父级范围内修正 **Composer 双条展示、生命周期分层存储、实时投影**，不重做常驻工作区拼装与 LLM wrap 主链路。

## 目标（含成功指标）

1. 用户一眼区分：**可叉取消的引用** vs **不可在此否认、只随状态消长的变动**。
2. 写盘 / 改规则后，无叉号条 **按文件实时** 出现或消失（含抵消后消失）。
3. 杀进程再进同一 session：正文、`@` attach、以及可投影的 ops/workplace chip **仍可恢复**（按约定真源再投影）。
4. 置位 / 压缩后：ops + workplace chip 与常驻工作区重置 **一并失效**；正文与 `@` attach **保留**。

**成功指标（可判定）**

- 无叉条仅含 `workplace` + `user_ops`；有叉条仅含 `attach`；空则各自不占位。
- 同 path 多次 edit：无叉条至多一只 `✏️` chip；净变更相对上次成功发送抵消后该 chip 消失。
- 置位或压缩成功后：无叉条为空；输入框文字与 `@` chips 仍在（若此前有）。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 作者改稿 | 文件管理器保存 → 上条出现 `✏️/path`；再改回与发送前一致 → chip 消失 |
| 调规则 | 文件从隐藏→展示 → 上条 `📄/path`；改回隐藏 → chip 消失；无 chip 时上条隐藏 |
| 引用文件 | `@` / 选择器 → 下条 `📄/path` 或 `📁/path`，可叉掉；上条不变 |
| 置位 / 压缩 | 成功后工作区重建语义 → 上条清空；正在写的话和下条引用留下 |

## 范围

### 包含范围

1. Composer **双条 chip**：上 = 状态条（无叉）；下 = 附件条（有叉，手选 `@` 交互保持）。
2. 文案统一 emoji：workplace / attach 文件 `📄/path`；attach 目录 `📁/path`；user_ops `✏️/path`；**目录不再单独配色**。
3. **真源 → 投影**：写盘成功、规则保存成功即重算无叉条；打开 session / 杀进程重进再投影。
4. **存储分层**：user_ops pending → session kkv（随 `clearSession`）；正文 + `@` attach → `chat_session` 列（不被 `clearSession` 清）。
5. 置位 / 压缩（及同等 `clearSession`）后：**清** ops+workplace 相关态与无叉条；**不清** 正文与 `@`。
6. Desktop + Mobile 同步口径。

### 不包含范围

- 常驻工作区拼装 XML、`prepareUserMessagesForPrompt` / `<dir>` 外壳等（除非本 Feature 强制联动的展示文案）。
- Skill 附件、`file-ref-picker` 导航逻辑（仅 chip 文案/配色与本 Feature 对齐）。
- 历史 `user_vfs_pending_json` 数据迁移（新写新域，删旧列 / 表重建；不兼容旧 pending 内容）。
- 条件压缩若无 UI 成功钩子时的「额外 push 通道」可在 SPEC 定最小方案，不以新产品事件总线为必达（PRD 只要求：凡发生 clearSession 的用户可见成功路径，上条须清空）。

## 核心需求（相对父级的变更）

1. **双条与可否叉**  
   父级「单草稿区、三类均可单条删除」对本 Feature 覆盖的两类（ops/workplace）**废止**。状态条无叉；撤销只能通过 **改回工作区/规则**（或置位/压缩重置）。

2. **按文件一只 user_ops chip**  
   一枚 chip = 一个 path（或目录 path）上的「相对上次成功发送仍有净变更」，不是一次工具调用。多次同 path 操作合并；净空则消失。mkdir / delete / rename 等同属「用户操作」，统一 `✏️/path`。

3. **workplace chip 同源投影**  
   仍来自规则可见性 vs 已加载缓存的差集；展示改为 `📄/path`；规则改回使 path 不再属于「待告知增量」时 chip 消失。

4. **生命周期**  
   - pending（user_ops 真源）跟随 session kkv：置位/压缩/`clearSession` 清掉。  
   - 正文 + `@` attach 跟随 chat_session 草稿列：杀进程仍在；置位/压缩 **保留**。

5. **发送**  
   发送时仍把当时投影结果 **固定**进消息附件（与父级「发送落库」一致）；发送成功后清空无叉条对应真源，并按现网清空 Composer 待发送态（SPEC 细化是否整清 draft）。

## 验收标准

### 展示与文案

- [ ] **Given** 同时有 workplace、user_ops、`@` attach，**When** 看 Composer，**Then** 上条仅前两类无叉、下条仅 attach 有叉；上条在上。
- [ ] **Given** 无状态类 chip，**When** 渲染，**Then** 上条不占位；下条同理（有 chip 才显示）。
- [ ] **Given** 各类 path，**When** 看文案，**Then** 符合 `📄`/`📁`/`✏️` + `/path`；目录无单独强调色。

### 实时与抵消

- [ ] **Given** 上次发送后磁盘基线，**When** 对 `/a.md` 保存一笔再改回基线，**Then** `✏️/a.md` 先出现后消失。
- [ ] **Given** 规则使 `/b.md` 隐藏→展示，**When** 再改回隐藏，**Then** `📄/b.md` 先出现后消失。

### 生命周期

- [ ] **Given** 有正文与 `@` chip 与上条 chip，**When** 置位或压缩成功，**Then** 上条空、正文与 `@` 仍在。
- [ ] **Given** 有正文与 `@` 与 pending 净变更，**When** 杀进程重进同 session，**Then** 正文/`@` 恢复；上条按真源再投影可见。
- [ ] **Given** 用户去掉某 `@` chip（点叉），**When** 未发送，**Then** 仅下条减少；不清除 pending / workplace 真源。

### 发送

- [ ] **Given** 上条仍有 `✏️`/`📄`，**When** 发送成功，**Then** 消息带对应附件语义（与父级一致）；上条清空待下一轮。

## 约束与依赖

- 依赖父级 `message-attachment-unified` 已落地的 attachments / suggest 通道 / flush 相对 checkpoint 的净差能力。
- 废止本 Feature 范围内对父级 PRD「workplace/user_ops 可单条删除」的验收句；父级全文可后续勘误，以实现本 Feature 为准。

## 风险与待确认项

- Desktop 手动压缩成功路径现网收尾弱，需在实现时补「成功后清上条」钩子（见 SPEC）。
- condition（自动）压缩若无可观察 UI 钩子：至少保证下次打开 Composer / 投影时上条为空（真源已随 kkv 清）。
