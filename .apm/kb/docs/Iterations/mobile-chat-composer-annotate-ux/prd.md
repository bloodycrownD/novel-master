---
date: 2026-07-22
dependency:
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/message-attachment-unified/features/composer-at-token-prompt-dedup/prd.md
  - Iterations/message-attachment-unified/bugs/composer-two-pipelines-hard-contract/prd.md
  - Iterations/chat-user-rollback-redo/prd.md
  - Iterations/message-set-floor/prd.md
  - Iterations/agent-chat-ux-bugfix/prd.md
---

# Mobile 聊天 Composer · 批注 · 消息操作 UX 修复 PRD

> **平台**：仅 Mobile（Android 验收；Desktop 本期不修、不验收）  
> **性质**：回归修复 + 体验修正 + 局部新合同（Undo 恢复批注；消息正文批注；消息菜单入口改挂）  
> **局部 supersede**：
> - `chat-user-rollback-redo` / `composer-at-token-prompt-dedup` 中「Undo / 编辑回填仅正文 + 状态投影、不谈批注草稿」——本期对 **含 annotate 附件的 plain user Undo Send** 增加「按附件恢复工作区批注草稿 + chip」；
> - `mobile-message-edit-visibility` 以长按为消息操作主入口——本期改为 **气泡右上角菜单为主入口**（对齐 Desktop 产品形态；菜单项集合仍遵循 `message-set-floor` + `agent-chat-ux-bugfix`）。

## 背景

Mobile 聊天在批注、`@path` 引用与消息操作上叠了几处体验债，且彼此相对独立：

1. **多文件工作区批注**：同会话对多个文件划词批注后，Composer 可出现多只 `批注:<path>` chip，但切换预览时 **往往只有第一个被批注的文件能看到下划线**，其余文件只有 chip、预览无下划线——与「阅读态下划线可见」合同冲突。
2. **Composer `@path` tag 失效**：通过选择器 / typeahead 插入的文件引用，输入框内不再呈现可用的 tag（无着色、无原子删除），观感像普通转义/链接残留，而非既有合同要求的正文 `@路径` tag。
3. **Undo Send 与批注**：现网 Undo 只回填正文（含 `@路径`）与状态投影；批注草稿在 append 成功后已清空且不写回 Composer 草稿。用户希望对刚发出的、带批注附件的消息回滚后，能 **按该条附件恢复批注能力（下划线 + chip）** 以便改完重发。
4. **输入框选中色**：Composer 选中高亮过重（深蓝），干扰阅读与划词。
5. **消息操作入口**：现网以长按打开菜单，与气泡划词/复制片段争用手势；用户希望改为 Desktop 式 **气泡右上角菜单**，便于复制消息上的部分内容，并在此基础上支持 **对消息正文划词批注**。
6. **消息正文批注（新）**：仅 **用户消息**可划词批注（助手消息不可）；与工作区文件批注区分——**不**产生状态 chip、**不**在气泡上画下划线；在 Composer 中以类似文件引用的 **tag** 表达；删除 tag 即删除对应批注；发送后 **须进入模型上下文**。

Desktop 同类问题（含模型远程拉取等同 vendor 差异）**本期不做**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 多文件批注下划线可靠 | 同会话对 ≥2 个文件各至少一条批注后，分别打开各文件预览，**每个**已批注文件均可见对应下划线（chip 仍按 path 聚合） |
| `@path` tag 可用 | 选择器 / typeahead 插入后：有可见着色 tag、退格可原子删除整段引用；对外正文仍为 `@路径` 字面，不露出内部协议串 |
| Undo 可恢复工作区批注 | 对刚发送且含工作区批注附件的 plain user 执行 Undo Send 后：Composer 恢复正文；该条上的批注回到未发送态（下划线 + `批注:` chip 可再编辑/发送） |
| 选中色可接受 | Composer 文本选中高亮不再使用刺眼深蓝主色块；与 tag 着色可区分 |
| 消息菜单一手可达 | 每条消息有右上角入口；菜单项与现网一致；主路径不再依赖长按；划词选区菜单含「批注」+「复制」 |
| 消息正文批注可用 | 可对**用户**消息正文划词添加批注（须解析到 messageId；助手静默取消）→ Composer 出现 tag（无 chip、气泡无下划线）→ 删 tag 即删批注 → 发送后模型能看到该批注含义；`userContent` 已剥离消息批注 span，原文含 `@path` 时亦不误扫 attach |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 多文件改稿作者 | 在 A、B 两章分别划词批注后来回切换预览，两处都应能看见下划线并点开改删 |
| 引用文件作者 | 点 `@` 选文件后，输入框内立刻是可辨认、可整段删的 `@路径` tag |
| 发完想改批注的人 | Undo 刚发出的用户消息后，批注不必重划，可改说明再发 |
| 需要摘抄消息片段的人 | 用右上角菜单操作消息，同时能在气泡上划词复制；需要时对**用户消息**正文做批注并以 tag 发给模型（助手消息不可批注） |

## 范围

### 包含范围

1. **多文件工作区批注下划线（回归）**  
   同会话多 path 批注草稿均保留；打开任一已批注文件的阅读/预览态时，该 path 的下划线须可见（在原文仍可匹配的前提下）。不改变「按 path 一只 chip」「append 成功清空」等既有批注生命周期（Undo 恢复见下条）。

2. **Composer `@path` tag（回归）**  
   恢复选择器 / typeahead 程序化插入后的 tag：可见着色、原子删除；不恢复已废止的文件引用 attach chip；不改变「手输纯文本 `@/path` 不成 tag」的既有口径（若本期不扩合同）。

3. **Undo Send 按附件恢复工作区批注（新合同）**  
   对 **plain text user** 且该条消息 attachments 含工作区批注（`annotate` / 真 VFS path）时：Undo Send 在恢复正文之外，将该条上的批注重建为未发送草稿（chip + 打开对应文件可见下划线）。消息正文批注伪 path（`__message__:`）本期不恢复。失败/非 Undo 场景不扩大范围。

4. **Composer 选中色（体验）**  
   将输入框选中高亮改为更柔和、非刺眼深蓝主色块；与 `@path` / 消息批注 tag 的着色区分开。

5. **消息操作菜单改挂右上角（UX）**  
   以 Desktop 同形的气泡右上角「⋯」为主入口（点击传按钮锚点 rect 开菜单）；菜单项保持：编辑（有资格时）、复制（整条可编辑正文）、置位（仅 user）、分叉、回滚（非 hidden）。长按不再作为主入口（可移除或降为不抢划词的次要行为，验收以「划词复制可用 + 右上角可开菜单」为准）。

6. **消息正文批注 → Composer tag（新能力）**  
   - 入口：仅在 **用户消息**气泡正文上划词添加批注（transcript 选区菜单对齐文件预览：含「批注」+「复制」；由选区上溯 `.row.message.user` 的 `messageId` + 选区文本 → 宿主录入；「复制」走系统剪贴板）。解析不到 `messageId`、或选区落在助手消息 → 取消录入。  
   - 助手消息：点「批注」无效果（不弹 composer modal、不写 store）；RN `menuItems` 静态，不按角色隐藏「批注」。  
   - UI：Composer 出现类似文件引用的 **tag**（独立非 `@` trigger；**仅程序化插入，无手输联想**）；**不**产生 `批注:` 状态 chip；**不**在消息气泡上画下划线。  
   - 删除 tag = 删除该条消息批注草稿。  
   - 发送成功后：批注 **进入模型上下文**（用户已确认「进模型」）；Composer 上对应 tag 清空。落库附件遵守现网 schema：`path` 与 `name` 同为伪路径 `__message__:<messageId>:<draftId>`（不得省略 path；识别用 `path.includes('__message__:')`，含 `/__message__:`）。  
   - 与 `@path` 扫描隔离：传给 `runAgentTurn` 的 `userContent` **须已是**剥离全部消息批注 tag/span 后的 plain（App 在 `ChatComposer` 发送前完成；该串同时用于 Core 内 `mergeAttachmentsWithScannedAtPaths` 与落库正文；**禁止** App 另调 scan 造成双轨；批注只走附件管线）。即便划词原文含 `@/foo.md`，仅发消息批注也不得因此新增文件引用 attach。  
   - 与工作区文件批注并存时：二者语义分离（文件批注走 chip+下划线；消息批注走 tag、无 chip/无气泡下划线）。Undo Send 本期只恢复工作区（真 VFS path）批注，伪 path 跳过。

### 不包含范围

- Desktop 任何修复或对齐（含模型 Fetch 同 vendor、Desktop 批注/`@path`/消息菜单）
- 恢复文件引用 attach chip，或用 `@` 隐藏状态 chip（硬合同禁止）
- 恢复消息批量「隐藏 / 恢复 / 删除」UI；恢复长按「删除/隐藏」为主路径
- assistant 消息「置位」（仍仅 user）
- 非聊天会话工作区（project/global）开工作区批注
- 云同步冲突、跨端同步批注草稿
- iOS 强制验收（以 Android 为准）
- 选中色精确色值品牌规范（验收为「明显柔和于现网深蓝主色块」即可；具体色可实现期定）

## 核心需求（6 条）

1. **多文件下划线**：同会话多 path 工作区批注时，切换打开任一已批注文件，预览须显示该文件对应下划线（原文可匹配时）；chip 仍按 path 各一只。  
2. **`@path` tag**：程序化插入后须为可用 tag（着色 + 原子删）；不得长期停留在无样式纯文本或内部协议字面量形态。  
3. **Undo 恢复工作区批注**：Undo Send 针对含工作区批注附件的 plain user 时，按该条附件恢复批注草稿与 chip（及打开文件时的下划线）。  
4. **选中色**：Composer 选中高亮改为可接受的柔和色，不与 tag 主色混淆为「整块深蓝」。  
5. **右上角消息菜单**：每条消息右上角可打开与现网同集合的操作菜单；划词选区菜单含「批注」+「复制」，复制片段成为可行主路径。  
6. **消息正文批注**：仅用户消息划词（选区上溯 `.row.message.user` 得 `messageId` → 宿主录入；划词菜单含「批注」+「复制」；助手静默取消）→ Composer tag（无 chip、气泡无下划线；发送前剥离消息批注 span 得 `userContent`）→ 删 tag 即删批注 → 发送后进模型并清空对应 tag。

## 验收标准

### 多文件工作区批注下划线

- [ ] **Given** 同一会话对文件 A、B 各至少一条未发送工作区批注，**When** 打开 A 预览，**Then** A 上可见对应下划线且存在 `批注:<A>` chip。  
- [ ] **Given** 同上，**When** 再打开 B 预览，**Then** B 上可见对应下划线且 `批注:<B>` chip 仍在；不得出现「只有 chip、B 完全无下划线」。  

### `@path` tag

- [ ] **Given** 用户经 `@` 选择器或 typeahead 确认插入某路径，**When** 查看输入框，**Then** 该 `@路径` 为可见着色 tag，且退格一次可整段删除该引用。  
- [ ] **Given** 插入成功，**When** 查看输入内容，**Then** 用户可见形态为 `@路径`（或等价可读 tag），**不得**长期显示内部协议/转义残留串作为主展示。  
- [ ] **Given** 硬合同，**When** 仅插入文件引用，**Then** **不**出现文件引用 attach chip。  

### Undo 恢复工作区批注

- [ ] **Given** 用户发送一条含工作区批注附件的 plain user 消息，**When** 对该条 Undo Send，**Then** Composer 恢复该条正文，且批注草稿恢复：对应 `批注:` chip 出现；打开相关文件预览可见下划线（原文仍匹配时）。  
- [ ] **Given** 该条 **不含** 批注附件，**When** Undo Send，**Then** 行为仍为恢复正文（+ 既有状态投影口径），不凭空造批注。  
- [ ] **Given** 该条含消息批注伪 path（`path.includes('__message__:')`，含 `/__message__:`），**When** Undo Send，**Then** **不**恢复为工作区批注草稿/chip。  

### 选中色

- [ ] **Given** 在 Composer 中拖选一段文字，**When** 观察选中高亮，**Then** 不再是现网刺眼深蓝主色块；与 `@path`/消息批注 tag 着色可区分。  

### 消息菜单

- [ ] **Given** 任意可见消息气泡，**When** 点击右上角菜单入口，**Then** 可打开菜单，项为：编辑（有资格时）/ 复制 / 置位（仅 user）/ 分叉 / 回滚（非 hidden）。  
- [ ] **Given** 用户或助手消息正文，**When** 划词，**Then** 选区菜单含「批注」与「复制」（menuItems 静态）；点「复制」可将选中片段写入系统剪贴板（自定义 menu 盖掉原生 Copy 后仍可复制；不被长按主菜单抢光）。  
- [ ] **Given** 助手消息正文划词并点「批注」，**When** resolve，**Then** 不弹录入、不写消息批注 store（仅用户消息可批注）。  
- [ ] **Given** 菜单「复制」，**When** 触发，**Then** 仍复制整条可编辑正文（与划词复制并存）。  

### 消息正文批注

- [ ] **Given** 用户在**用户消息**气泡正文划词并添加批注，**When** 查看 Composer，**Then** 出现对应 tag，且 **不**出现 `批注:` 状态 chip，气泡上 **无** 下划线。  
- [ ] **Given** 划词时无法解析所属用户消息 `messageId`（空选区 / 助手行 / 上溯失败），**When** 触发批注入口，**Then** 取消录入，不写草稿、不插 tag。  
- [ ] **Given** 已有消息批注 tag，**When** 删除该 tag，**Then** 对应消息批注草稿被删除。  
- [ ] **Given** 仅有或兼有消息批注 tag 时发送成功，**When** 查看本轮交给模型的上下文，**Then** 模型能获得该批注含义（原文 + 用户说明）；Composer 上对应 tag 已清空；落库 `path`/`name` 含 `__message__:<messageId>:<draftId>`（`path.includes('__message__:')`）。  
- [ ] **Given** 仅有消息批注、且划词原文含 `@/foo.md`（无手输 `@path`），**When** 发送，**Then** 传给 `runAgentTurn` 的 `userContent` 已剥离消息批注 tag/span，**不得**因该批注短标签内嵌 `@` 新增文件引用 attach；批注仅经批注附件进入模型。  
- [ ] **Given** 同时存在工作区文件批注与消息正文批注，**When** 查看 Composer，**Then** 文件批注仍走 chip（+ 文件预览下划线），消息批注仅 tag，二者不混成同一套 chip。  

## 风险与待确认项

| 项 | 说明 | 处理 |
|----|------|------|
| 消息批注 tag 文案形态 | 产品要求「类似文件引用 tag」；SPEC 已钉短标签 `批:「…」`、非 `@` trigger；防误扫主合同为发送前剥离消息批注 span 得 `userContent`（可选可见文案将 `@`→`＠`） | 验收以「可辨认为消息批注 tag、可原子删、不误扫 attach（含原文含 `@path`）」为准；色值级细节实现自定 |
| 划词 messageId | 须从选区上溯**用户**消息 row | SPEC 已钉 `getSelection` → `.row.message.user[data-id]`；助手/失败取消录入 |
| 划词选区菜单 | 自定义 menuItems 盖掉原生 Copy | SPEC 已钉对齐 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`：须含「批注」+「复制」；复制走系统剪贴板 |
| 长按是否彻底移除 | 验收钉「右上角为主 + 划词可用」；是否保留无冲突的次要长按未强制 | 默认移除长按主路径；若保留不得抑制划词 |
| Undo 与未发送草稿合并 | 若 Undo 时 Composer 上已有未发送工作区批注，与附件恢复如何合并 | 默认：恢复附件批注与现有未发送草稿按 path/条目并存，不静默丢任一侧；冲突细项可进 SPEC |
| 选中色具体值 | 未指定 hex | 实现选用柔和 tint；不阻塞 PRD |
| Desktop 不同步 | 本期仅 Mobile，双端短期不一致 | 已排除；另开迭代 |
