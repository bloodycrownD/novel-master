---
date: 2026-07-17
dependency:
  - Iterations/message-attachment-unified/prd.md
  - Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/prd.md
  - Iterations/message-attachment-unified/features/file-ref-picker-ux/prd.md
---

# 聊天发送与双渲染收束重构 PRD

## 背景

`feat/message-attachment-unified` 上已落地「消息附件 + 常驻工作区 kkv + Composer 双条 chip」等产品能力，但实现过程中叠加了多条中间路径（状态条预览误当发送 payload、UI 与真实提示词渲染规则不一致、空 `rule_snapshot` 粘住、chip 与 pending/checkpoint 分叉、空 assistant 落库造成 `#seq` 断层等），使**发送链路与两套只读渲染**看起来过重。

本迭代所在 **features 分支相对 main 无生产历史包袱**：不以「兼容分支上中间实现」为约束，按正确心智模型**完全收束重构**。

产品心智（不变量）：

1. **同一条 DB message**：`content_json` = 用户原文；`attachments_json` = 附件元数据（可含 `source: workplace` / `user_ops` / `attach`）。
2. **两套只读渲染**：聊天 UI 直读 DB；真实提示词 / Agent 在内存中 `prepare`（hydrate + wrap）后再拼 layout。
3. **发送保持简单**：flush pending → materialize 落库附件 → append 原文+附件 → runner 内 prepare → 常驻工作区前缀拼装 → 出模型。

与现状关系：承接 `message-attachment-unified` 的产品目标；**局部 supersede** 该分支上为修回归而叠的绕弯补丁与临时分叉，不重开附件模型与 prepare 主语义。细则见下文 **supersede 表**。

## 目标（含成功指标）

### 目标

- 发送路径可读、可测，无「为修 UI/提示词」反向污染落库或发送门闩。
- UI 与真实提示词对同一 DB message 的差异**仅**来自「是否 wrap」，无第三套解析。
- 常驻工作区与 Composer 状态条语义清晰：**前缀拼装** vs **状态投影（预览 chip）** vs **发送时 materialize 落库** 三分离。

### 成功指标

| 指标 | 判定 |
|------|------|
| 空正文 + 仅 `user_ops`/`attach` 发送 | 真实提示词可见 wrap；聊天 UI 可见气泡/附件卡；Agent 可正常续跑 |
| 空正文 + 仅状态条 `📄`（workplace 差集） | App 可发；落库含 `source:workplace`；**不**误入纯 resume（末条已是 user 时亦然） |
| 状态条预览 chip | **永不**原样作为 `runAgentTurn.attachments`；发送须 **materialize**（见核心需求） |
| 规则变更 workplace 差集 | 发送后消息 `attachments_json` 含 `source: workplace`；prepare hydrate → wrap `<workplace>` |
| 有规则可见文件时 | 真实提示词含常驻工作区前缀（非空）；空 `[]` 快照不粘死 |
| 发送后 chip | pending 已 flush → 上条 `✏️` 空；workplace 差集收敛（hydrate 写 cache）→ 上条 `📄` 空 |
| OpenAI 兼容网关 | 不因「无 content 的 user」导致系统性 400 |
| 代码可读性 | Core = 编排 2 步 + runner 内 2 步；App 不二次 wrap/unwrap |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 作者（Desktop/Mobile） | 打字 / 仅 pending 空发 / `@` 附件发送；看气泡与真实提示词一致「有内容」 |
| 作者 | 改规则后看状态条 `📄`；发送后看模型吃到 workplace 增量，且上条 `📄` 清空 |
| 作者 | 无字、仅上条 `📄` 时点发送：可发出；落库带 `source:workplace`；不误当空续跑 resume |
| 开发者 | 改发送或渲染时只碰约定入口，不踩中间补丁 |

## 范围

### 包含范围

1. **发送编排收束**：`runAgentTurn` 编排 flush→append；runner 内 prepare/wrap + assemble；空续跑 **保留** delete/re-append，并补 UI 回调测（Step 9 可选评估「原地更新」）。**materialize 时序定案 A**：workplace 差集并入 `prepareUserVfsTurnForAgentRun` 的 re-append merge（与 flush / attach 同级）；外层新 append 路径同样在 append 前 merge materialize∪attach。
2. **双渲染契约**：UI（message-blocks / WebView transcript）与真实提示词（session-prompt-input）对 attachments / 空正文对齐；禁止 App / append 路径 wrap。
3. **常驻工作区**：`assembleWorkplaceDisplay` + `rule_snapshot`/`file_cache` 单一拼装语义；空快照自愈；与状态条 live−cache 差集分层。
4. **Composer 边界与发送门闩**：双条 chip 保留；Composer **传入** `runAgentTurn.attachments` 仅 `source===attach`（+ 正文 `@` 扫描）；`workplace` 由发送路径 **materialize** 写入消息；`user_ops` 仅信 flush 产物；状态条以 pending / 差集等真源门闩，发送后可清空。**可发条件**须含「状态条存在 `source:workplace`（或等价 `hasWorkplaceDelta`）」；有 workplace 差集时 **禁止** `allowResumeWithoutInput`（见核心需求 8）。
5. **协议防守**：OpenAI 映射不发出「无 content 且无 tool_calls」的消息；不落库无意义空 assistant。
6. **测试**：Core 全链集成测为真源；删除/合并仅服务中间补丁的用例；双端 UI 契约测保留（WebView 为 Mobile blocking 真源）。

### 不包含范围

- 重做 `attachments_json` / 三类附件产品模型（沿用 MAU）。
- 重做 FileReferencePicker / `$filetree` 目录树规则（沿用 file-ref-picker-ux）。
- 恢复 capture / BlockStore / flush→UA 两段产品路径。
- Runner 三轨、IPC 样板大重构（属 `implementation-simplification`，本迭代只碰 attachment/发送/渲染交界）。
- 旧会话 UA 卡的产品重做（只读兼容即可；features 分支无历史包袱时，可不做迁移脚本）。
- **本迭代不强制删除** `user-vfs-unified-tool-turn` flag（保留运维开关、默认 true；可选删除见 SPEC Step 8）。

## 核心需求（3-7 条）

1. **发送归属（编排 2 + runner 2）**  
   - **编排**（`run-agent-turn`）：① flush pending → `user_ops` 附件真源；② materialize `workplace` 差集 + 合并 `attach`/`@` 扫描 → append(原文, attachments)。  
   - **runner 内**（`agent-runner` 每 step）：③ `prepareUserMessagesForPrompt`（hydrate+wrap）；④ `assembleWorkplaceDisplay` + layout。  
   - **唯一** wrap / assemble 调用点在 agent-runner（及同源只读预览入口复用同一函数）；**禁止** App / append 路径 wrap。

2. **预览 chip ≠ 发送 payload；发送须 materialize（方案 A）**  
   - 状态条上的 `workplace` / `user_ops` **预览 chip 本身**不是发送 payload；**禁止**把 composer status 原样当 `attachments` 传入 `runAgentTurn`。  
   - 发送时须 **materialize**：把当前 `workplace` 差集（规则变更增量）写成消息的 `attachments_json`（`source: workplace`，content 可 null），供后续 prepare hydrate → wrap `<workplace>`。  
   - materialize **配方**（与状态条 workplace 半边同源，非 status 返回值原样）：复用 `workplaceAttachmentsFromRuleDelta`；live 来自 `evaluateRuleView` → `ruleViewToSnapshotEntries`（或与 `projectComposerStatusAttachments` 的 workplace 半边同源的 `loadLiveWorkplacePaths`）；cache 来自 `sessionKkv.listKeys(file_cache)`。误传入的 workplace/`user_ops` 预览一律丢弃，再按真源重算。  
   - `user_ops` 仍只信 flush 产物进正文/附件，不信状态条预览。  
   - Composer 显式传入仍以 `attach` 为主；`workplace` / `user_ops` 由 Core 发送路径写入，**不是**「永不进 `attachments_json`」。

3. **DB 与渲染分离**：落库永不写 wrap XML；UI 渲染原文 + 附件卡；真实提示词/Agent 仅内存 wrap。

4. **空正文合法**：允许「无字但有 attach / workplace materialize / 将产生 user_ops」发送；UI 与提示词均须呈现。

5. **常驻工作区可靠**：有规则可见文件时前缀非空；`rule_snapshot: []` 视为未就绪并重评；状态条 live 差集与快照前缀允许短暂领先，但须文档化且 kkv 清空后禁止灌满 chip。

6. **Chip 生命周期（对齐 chip-lifecycle，本迭代钉发送后清空）**  
   - 保留「发送后上条清空」：pending flush 空 → `✏️` 消失；workplace materialize + prepare hydrate 写 `file_cache` 后差集收敛 → `📄` 消失。  
   - 发送时 workplace **落库**条款以本迭代为准（见 supersede 表）；双条 / pending 门闩仍以 chip-lifecycle 为准。

7. **双端一致**：Desktop / Mobile（**blocking**：message-blocks + WebView / ChatTranscriptBridge）对「空正文+attachments」展示一致；Mobile legacy FlatList `MessageList` 标 known-limit 或 delete-if-unused（见 SPEC）。

8. **发送门闩 / 反 resume（钉死）**  
   - **App 可发条件**：`hasComposerSendableInput`（`composer-sendable-input.ts`）及双端 `ChatComposer` 须把「状态条存在 `source:workplace`（或等价 `hasWorkplaceDelta`）」算作可发；**仍禁止**把预览 chip 传入 `runAgentTurn.attachments`（attachments 入参仍仅 attach / `@` 扫描由 Core 合并）。  
   - **Core**：`run-agent-turn.ts` 的 `hasInput` / `shouldAppendNewUser` 在 materialize 后非空时为真（真源差集由 Core 计算，**不**依赖 App 传入 workplace attachments）。  
   - **有 workplace 差集时禁止** `allowResumeWithoutInput`：差集 = 新输入，须 append / materialize，**不得**纯 resume。末条已是 user 时亦同（不得因「无字」误入 resume-check）。

9. **materialize 与空续跑 re-append 时序（定案 A）**  
   - 现网 re-append 在 `prepareUserVfsTurnForAgentRun` 内部，且 `reAppended=true` 时外层不再 append。  
   - **定案 A**：materialize 的 workplace 差集**并入** `prepareUserVfsTurnForAgentRun` 的 re-append merge（与 flush / attach 同级）；外层新 append 路径同样在 append 前 merge materialize∪attach（∪ flush 产出的 user_ops）。  
   - 流程图与 SPEC Step 文案须与此一致；空续跑写回消息须含 materialize 的 `source:workplace`（见 T-SR8）。

## 验收标准

- [ ] **Given** 会话有 pending mkdir、Composer 无字 **When** 用户发送 **Then** DB 有 user 消息（可空正文）+ `user_ops` 附件（来自 flush，非状态条原样）；真实提示词含 `<user-ops>`；聊天 UI 显示该条；上条 mkdir chip 在成功后消失。（T-SR2）
- [ ] **Given** 用户仅 `@` 文件、无字 **When** 发送 **Then** 消息含 `source:attach`；Composer **未**把状态条预览 chip 原样写入 `runAgentTurn.attachments`。（T-SR1）
- [ ] **Given** 规则变更产生未缓存 path，上条仅有 `📄`、Composer 无字无 attach **When** 用户发送 **Then** App 可发（`hasComposerSendableInput` / 双端 Composer 认 workplace）；落库含 `source:workplace`；**未**走纯 `allowResumeWithoutInput` resume；末条已是 user 时亦不误入纯 resume。（T-SR1b）
- [ ] **Given** 规则变更产生未缓存 path，上条出现 `📄` **When** 发送成功 **Then** 消息 `attachments_json` 含 `source: workplace`；真实提示词经 hydrate 后含 `<workplace>`；上条 `📄` 清空（差集收敛）。（T-SR1 / T-SR2b）
- [ ] **Given** Agent 含 worktree 块且规则下有可见文件 **When** 打开真实提示词或发送 **Then** 前缀含 `<file`（或等价文件块），非空。（T-SR4）
- [ ] **Given** kkv 中曾写入空 `rule_snapshot` **When** 再次 assemble **Then** 重评规则后前缀可恢复，不永久空白。（T-SR4）
- [ ] **Given** 同一 fixture **When** 分别走 Agent 发送 / 真实提示词预览 /（若有）token 预览 **Then** 用户段 wrap 结果一致（parity）。（T-SR6）
- [ ] **Given** OpenAI 兼容协议 **When** 导出含空正文块 **Then** 不出现「无 content 的 user」导致网关 400；不落库仅空 text 的 assistant。（T-SR5）
- [ ] **Given** 空续跑 delete/re-append 且当时存在 workplace 差集 **When** re-append 完成 **Then** 写回消息 attachments 含 materialize 的 `source:workplace` 且不丢既有/flush/attach。（T-SR8）
- [ ] **Given** 开发者阅读 Core 发送入口 **When** 按文档走读 **Then** 可画出「编排 flush→append + runner prepare→assemble」，无 App 侧 wrap 分支；materialize 时序符合定案 A。（T-SR0 / 走读）

## supersede 表

相对前置文档的局部覆盖（**保留** vs **以本迭代为准**）：

| 主题 | 前置文档 | 本迭代 |
|------|----------|--------|
| Composer 双条 + ops/workplace 不可叉 | chip-lifecycle | **保留** |
| user_ops chip 以 pending / 净差为门闩 | chip-lifecycle | **保留** |
| 发送后上条清空（`✏️`/`📄`） | chip-lifecycle 发送验收 | **保留**；本迭代补 workplace 差集收敛 GWT（T-SR2b） |
| chip-lifecycle「发送固定投影」 | chip-lifecycle 核心需求「发送」 | **等价于**本迭代 materialize 同源差集落库；**≠** `projectComposerStatus` / `projectComposerStatusAttachments` 返回值原样作为 `runAgentTurn.attachments` 入参 |
| 规则变更走 workplace 附件增量落库 | MAU（E / 规则变更与附件） | **保留并钉死**：发送 **materialize** `source: workplace` 进 `attachments_json` |
| 状态条预览 vs 发送 payload | 中间补丁曾混淆 | **本迭代定案**：禁预览 chip / 禁 status 原样当 payload；**允许** materialize 后的 `source:workplace` 落库 |
| 「attachOnly / workplace 永不进 `attachments_json`」 | 本迭代早期错误表述 / 绕弯补丁 | **废止** |
| wrap / assemble 调用点 | MAU prepare 唯一 hydrate+wrap | **钉死**：唯一 wrap/assemble 在 agent-runner（同源只读复用）；禁 App/append wrap |
| 空正文 + 仅 `📄` 可发 / 反 resume | 现网门闩缺口 | **本迭代钉死**：`hasComposerSendableInput` + Core `hasInput`/`shouldAppendNewUser` 认 materialize；有差集禁 `allowResumeWithoutInput` |
| materialize ∪ 空续跑 re-append | 现网 re-append 仅 flush/attach | **定案 A**：materialize 并入 `prepareUserVfsTurnForAgentRun` re-append merge；外层新 append 同级 merge |
| `user-vfs-unified-tool-turn` | 既有 flag | **保留开关、默认 true**；删除为 Step 8 可选 |
| 空续跑 delete/re-append | 既有路径 | **本迭代保留** + 补 UI 回调测；改「原地更新」仅 Step 9 可选评估 |

交叉引用：chip-lifecycle「发送固定投影进消息、上条清空」与本迭代 **一致（语义上 = materialize 同源差集）**；若实现曾写成「composer status 原样 attachments」，以本迭代 materialize 语义为准。MAU 父文档无需大改，仅认本表。

## 风险与待确认项

- ~~空续跑是否改为原地更新~~：**已定案** — 本迭代保留 delete/re-append + 补 UI 回调测；Step 9 可选评估，禁止边做边选。
- features 分支是否直接删除旧 UA transcript 主路径：默认**可删主路径**；Mobile legacy FlatList 见 SPEC（blocking 不钉 FlatList）。
- ~~`workplace` 是否永远不进 `attachments_json`~~：**已定案（方案 A）** — 预览永不原样进 payload；发送 materialize **必须**可进 `attachments_json`。
- ~~materialize 与 re-append 时序~~：**已定案 A** — 并入 `prepareUserVfsTurnForAgentRun` merge；外层新 append 同级。
- ~~仅 `📄` 空发是否误 resume~~：**已定案** — 门闩认 workplace；有差集禁 `allowResumeWithoutInput`。
- flag 删除时机：本迭代不强制；判据见 SPEC Step 8。
