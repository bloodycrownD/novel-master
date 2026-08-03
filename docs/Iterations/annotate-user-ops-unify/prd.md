---
date: 2026-07-19
dependency:
  - Iterations/message-attachment-unified/prd.md
---

# 批注与 user-ops 协议统一 PRD

> **平台**：Mobile + Desktop（Composer / 提示词协议双端一致；批注阅读态以**聊天会话工作区**「预览/阅读」为准——Desktop `workspaceScope==="chat"` / Mobile `scopeKind==="session"`；其它 scope 无批注入口）  
> **性质**：新增「阅读态批注」产品能力；统一状态 chip 展示口径；统一消息增量提示词拼装口径。  
> **局部 supersede**：[`bugs/composer-ops-label-picker-typeahead`](../message-attachment-unified/bugs/composer-ops-label-picker-typeahead/prd.md) 中「ops chip = 英文 `action:path` 原样」——改为中文二字 `action:path`。  
> **不包含**：技术方案、接口设计、库表结构、任务拆分（见后续 SPEC）。

## 背景

现网 Composer **状态 chip** 仅投影两类增量：`workplace`（UI 文案「规则 · path」）与 `user_ops`（英文 `write:/path` 等）；文件引用走正文 `@path`，不进无叉状态条。提示词侧：常驻工作区前缀与消息附件增量分离；消息增量外层为 `<attachment>`，内层仍分 `<workplace>` / `<attach>` / `<user-ops>`——其中 **仅 user_ops 已是** `<action name="…">` + JSON，workplace/attach 仍为 `<file>` / `<dir>` 旧块。

聊天工作区已能打开文件并在「预览/阅读」与「编辑」间切换，但 **没有**「选中文字 → 批注 → 下划线 → 点击查看/编辑/删除」能力，也没有「批注:path」状态 chip。

本迭代要同时解决两件事：

1. **批注**：在聊天工作区阅读态完成选区批注，并以每文件一只状态 chip 摘要；发送后交给模型，并清空本轮批注。
2. **协议收束**：状态 chip 统一为中文二字 `action:path`；消息增量提示词统一收进 `<user-ops>` 风格的英文 `action` + JSON；落库只存结构化字段（action 枚举 + path 等），**不**存展示用 tag 字符串。

与现状关系：

- 父能力与双管道合同来自 `message-attachment-unified`（及 `composer-at-token-prompt-dedup` / `composer-two-pipelines-hard-contract`）：状态 chip ≠ `@` 引用，本期 **不** 把 attach 拉回 chip；workplace/user_ops 仍由既有状态投影整表替换；**批注 chip 不进入该投影半边**（由会话侧合并进状态条，避免被 replace 冲掉——契约见 SPEC）。
- 常驻工作区前缀（`assembleWorkplaceDisplay` 一类拼装）与消息增量仍属不同问题；**本期明确不改常驻前缀**。
- 提示词 XML 为发送/查看时内存拼装、不写回消息正文；改拼装形态 **不要求** 为旧提示词 XML 做库表迁移。旧 chip 展示文案 **不做兼容**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **阅读态可批注** | 在聊天工作区文件阅读/预览态，用户可选中正文片段并添加批注；选区以可见下划线（或等价明确标记）标出 |
| **批注可回看改删** | 点击已有批注标记，可查看、编辑、删除该条批注 |
| **批注进状态条** | 某文件存在 ≥1 条未发送批注时，Composer 状态条出现且仅出现一只 `批注:<path>`；删光该文件批注后该 chip 立即消失 |
| **批注一次性** | 用户消息 **append 成功**后，本轮全部批注（含标记与 chip）清空；append/发送失败不丢批注（Desktop：不得以「run 已 started」当作 append 成功） |
| **仅批注可发** | 无正文、无其它状态增量时，仅有未发送批注亦可发送用户消息 |
| **chip 文案统一** | 状态 chip（含规则、手改、批注）统一为中文二字 + `:` + path；双端 Composer 一致；不做旧英文/`规则 ·` 回退展示 |
| **落库结构化** | 附件/状态条目落库为 action 枚举 + path（及批注正文等业务字段），**不**把 `创建:/x` 这类展示 tag 写入消息附件字段 |
| **提示词增量统一** | 本轮消息增量（规则变更加载、用户 `@` 引用内容、手改、批注）在拼装层以 `<user-ops>` + `<action name="…">` + JSON 表达；不再为这些增量使用内层 `<workplace>` / `<attach>` / 旧 `<file>` 包裹形态 |
| **常驻前缀不动** | 开启常驻工作区时，前缀拼装行为与现网一致（本期无回归失败） |

## 用户与场景

**用户：** 使用 Mobile / Desktop，在会话中阅读聊天工作区文稿、改稿，并与 Agent 对话的作者。

| 场景 | 期望体验 |
|------|----------|
| **阅读时划词批注** | 在**聊天会话工作区**打开某文件的阅读/预览态 → 选中一段文字 → 添加批注说明 → 该段出现下划线；Composer 出现 `批注:/某路径`（项目级/全局等其它工作区无此入口） |
| **同文件多条批注** | 同一文件多处批注仍只显示一只 chip；发送时模型能看到**各条**批注内容（不因同 path 丢条） |
| **改删批注** | 点击下划线打开批注 → 修改说明或删除；删到该文件最后一条时 chip 消失 |
| **发送交给模型** | 用户消息 append 成功后，本轮批注进入该条消息的模型可见上下文，界面上批注与 chip 清空；失败则批注保留 |
| **看清本轮改了什么** | 手改/规则/批注在状态条上一眼是中文二字 + 路径，不再混用英文动词与「规则 ·」 |
| **`@` 引用不变道** | 继续用正文 `@path` 引用文件；不因本迭代重新出现可叉 attach chip |

## 范围

### 包含范围

1. **聊天会话工作区阅读/预览态批注**：仅聊天会话工作区（Desktop `chat` / Mobile `session`）提供选中 → 添加 → 下划线标记 → 点击查看/编辑/删除；其它工作区 scope 无入口。
2. **批注状态 chip**：按 path 聚合，文案 `批注:<path>`；与现有状态 chip 同列展示（会话侧合并）；用户消息 **append 成功**后清空；删光撤 chip；append 失败不丢。
3. **状态 chip 展示统一**：中文二字 `action:path`（含既有手改类与规则类，以及新增批注类）。
4. **消息增量提示词统一**：将原 workplace / attach / user_ops / 批注增量，统一为英文 `action name` + JSON，置于 `<user-ops>` 叙事下（可保留外层消息包装若产品仍需与用户原文分界）。
5. **落库口径纠正**：消息附件存 action 枚举 + path 等结构化字段；chip 文案由 UI 映射生成。
6. **双端 Composer / 气泡展示对齐**到新 chip 口径（无旧文案兼容）。
7. **明确不改**：常驻工作区前缀拼装；`@path` 双管道硬合同（引用仍不进状态 chip）。

### 不包含范围

1. 常驻工作区前缀改为 user-ops / 废弃前缀 `<file>`（留给后续迭代）。
2. 把 `@path` 引用改回可叉 attach chip，或用 chip 替代 `@`。
3. 旧英文 `write:` /「规则 ·」/ emoji 气泡文案的兼容层。
4. 为「提示词 XML 形态变更」做历史库表迁移或批量改写已发消息正文。
5. **非聊天会话工作区的批注**：Desktop `global` / `session`、Mobile `project` / `global` 等 **无批注入口、不验收**（即使共用同一预览组件）。
6. 技术方案、接口、库表、任务拆分（SPEC）。

## 核心需求（3-7 条）

1. **批注创作**：用户在**聊天会话工作区**文件的阅读/预览态选中正文，可添加批注；批注关联「文件 path + 选中原文 + 用户说明」；选区以持续可见的下划线（或等价标记）呈现，直到发送清空或用户删除。Desktop 仅 `workspaceScope==="chat"`、Mobile 仅 `scopeKind==="session"` 提供入口；其它 scope 无入口。
2. **批注管理**：用户可点击已有标记查看、编辑说明、删除单条；当某 path 上未发送批注条数为 0 时，对应 `批注:<path>` chip 必须移除。
3. **批注与发送**：用户消息 **append 成功**后，本轮全部批注进入该条消息的模型可见增量，并清空界面批注与批注 chip；append/发送失败不丢批注；仅有批注、无正文时亦可发送；批注为一次性，不跨发送轮次残留。Desktop 不得以「Agent run 已 started」等同于 append 成功来清空批注。
4. **状态 chip 统一展示**：Composer 状态条（及消息上对应状态附件展示）统一为中文二字 + `:` + path。约定默认映射：`删除` / `创建` / `编辑` / `建目` / `重命` / `规则` / `批注`（分别对应删除、写入创建、编辑、建目录、重命名→`重命:<to>`、规则差集加载、批注）；chip 不可叉行为与现网状态 chip 一致（批注通过删光批注内容撤 chip，而非点叉 chip）。
5. **提示词增量协议**：拼装给模型的本轮增量统一为英文 action，至少覆盖：
   - `annotate`：JSON 含 `path`、`originalText`、`userAnnotation`
   - `workplaceChange`：JSON 含 `path`、`content`（规则变更后首次加载类增量）
   - `userAttach`：JSON 含 `path`、`content`（含短提示/目录树等既有语义的等价表达）
   - 既有手改类 action（如 write/edit/mkdir/delete/rename）保持英文 name + JSON  
   不再为上述增量使用内层 `<workplace>` / `<attach>` / 旧 `<file>` 包裹。
6. **落库与展示分离**：附件字段存 action 枚举与 path（及批注等业务字段）；UI 用映射表生成中文 chip；提示词用英文 action name 拼装；禁止把展示 tag 字符串当作落库真源。
7. **边界保持**：常驻工作区前缀本期不变；文件引用继续仅正文 `@path`；状态 chip 仍只承载状态类增量（规则 / 手改 / 批注），不与 `@` 混为一条管道。

## 验收标准

### 批注

- Given 用户在**聊天会话工作区**打开某文件的阅读/预览态  
  When 选中一段文字并添加批注  
  Then 该段出现下划线（或等价标记），且 Composer 出现恰好一只 `批注:<该文件 path>`。

- Given 用户在 Desktop `global`/`session` 或 Mobile `project`/`global` 工作区打开文件预览  
  When 尝试划词添加批注  
  Then **无**批注入口（无浮动条/添加批注操作）；不产生批注 chip。

- Given 同一文件已有两条批注（尚未发送）  
  When 查看状态条  
  Then 仍只有一只该 path 的批注 chip（不出现两只）。

- Given 同一文件已有两条批注  
  When 用户消息 **append 成功**  
  Then 该条用户消息的模型可见上下文中含两条 `annotate`（不因同 path 丢一条）；本轮批注标记与批注 chip **全部清空**（与「批注一次性」及 SPEC T-AN3 / T-AN6 一致）。

- Given 某文件仅剩一条批注  
  When 用户删除该条  
  Then 该文件的批注 chip 立即消失，且该段下划线消失。

- Given 用户已添加批注但尚未发送  
  When 用户消息 **append 成功**  
  Then 本轮批注标记与批注 chip **全部清空**；该条用户消息的模型可见上下文中包含批注内容（`annotate` 语义；与上条「同 path 多条」互补，覆盖一般条数）。

- Given 用户已添加批注但尚未发送（尤其 Desktop）  
  When Agent run 仅报告已 started、或发送失败、或用户消息未成功 append  
  Then 批注标记与批注 chip 仍保留（不得因「started」提前清空）。

- Given Composer 无正文、无规则/手改等其它可发增量，仅有未发送批注  
  When 用户点击发送  
  Then 允许发送，且本轮批注进入该条用户消息的模型可见上下文。

- Given 用户点击已有下划线  
  When 打开批注详情  
  Then 可编辑说明并保存生效，或删除该条。

- Given 聊天会话工作区打开 `.md` 或 `.txt` 的阅读/预览态（Mobile 与 Desktop）  
  When 划词添加批注  
  Then 两端均可完成选区→下划线→chip；其它预览类型本期不单独验收。

### Chip 与落库

- Given 存在规则差集 / 手改 / 批注状态  
  When 查看 Composer 状态 chip  
  Then 文案均为中文二字 + `:` + path（例如 `规则:/a.md`、`创建:/b.md`、`批注:/c.md`、`重命:<to>`），且双端一致。

- Given 新发送的带状态附件的用户消息  
  When 检查落库附件字段  
  Then 可见 action 枚举与 path（及必要业务字段），**看不到**以 `创建:/path` 这类展示 tag 作为真源写入的 `name`。

- Given 历史会话中仍存旧展示串的附件（若有）  
  When 打开会话查看 chip/气泡  
  Then **不要求**按旧英文/`规则 ·`/emoji 规则回退渲染（允许按新映射或降级为枚举可见名，但不做旧文案兼容承诺）；若旧串为 `rename:…→…` 形态，chip path **取 `→` 右侧**（`重命:<to>`），否则历史不保证与发送当时逐字一致。

### 提示词增量

- Given 本轮消息带有规则加载增量、`@` 引用增量、手改、批注中的任一类  
  When 查看真实提示词（或等价拼装结果）中该条用户消息的增量部分  
  Then 上述增量以 `<user-ops>` + `<action name="…">` + JSON 表达；**不**再出现用于这些增量的内层 `<workplace>` / `<attach>` / 旧 `<file>` 包裹。

- Given 常驻工作区开关开启且前缀应出现  
  When 查看真实提示词前缀  
  Then 前缀拼装与现网行为一致（本期无「前缀改为 user-ops」类变更）。

- Given 用户仅用正文 `@path` 引用文件  
  When 查看 Composer  
  Then 不出现因该引用而产生的状态 chip（双管道硬合同保持）。

## 风险与待确认项

| 项 | 说明 | 建议默认 |
|----|------|----------|
| **Desktop 批注强验收** | Desktop Preview 与 Mobile 阅读栈不同；双端 chip/协议必过 | **双端批注同语义验收**（至少 `.md`/`.txt`，**仅聊天会话工作区**）；若实现阶段发现一端阻塞，再单开缺口迭代，不在本 PRD 预降为「仅 Mobile」 |
| **Desktop append 清空时机** | 现网 run IPC 立即 `started`，正文可在 started 后清；批注若同路径清会违反「失败不丢」 | **批注必须等用户消息 append 成功再清**（具体 IPC/事件桥见 SPEC）；正文清空时序可与批注分轨 |
| **`建目` / `重命` 用词** | mkdir / rename 的中文二字是否定稿 | 默认 `建目`、`重命`；落盘后若产品要改二字，只改映射表 |
| **外层 `<attachment>`** | 是否保留外层包装再包 `<user-ops>`，还是增量区仅扁平 `<user-ops>` | **可保留外层**（与 `<user-input>` 分界）；内层旧三段废弃即可 |
| **短提示 / 目录树** | `@` 非首次短提示、目录树如何塞进 `userAttach` JSON | **已钉死见 SPEC**：短提示 `alreadyReferenced:true`（无 content）；目录树 `kind:dirTree` + ASCII `content`；全文/filename 的 `content`=行号正文；mtime/createdAt 不进 JSON |
| **编辑态能否批注** | 是否仅预览/阅读态允许 | **仅阅读/预览态**；编辑态用于改文件正文，不做批注入口 |
| **非会话工作区批注** | 项目级/全局工作区是否要入口 | **本期无入口、不验收**（与「仅聊天会话工作区」一致） |
