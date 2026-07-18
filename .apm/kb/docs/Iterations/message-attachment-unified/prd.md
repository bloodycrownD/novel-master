---
date: 2026-07-14
dependency:
  - Iterations/worktree-engine-convergence/prd.md
  - Iterations/message-set-floor/prd.md
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/agent-worktree-block-ui/prd.md
---

# 常驻工作区与消息附件 PRD

> **平台**：Mobile（Android + iOS）+ Desktop（`apps/mobile`、`apps/desktop`）  
> **性质**：重构 **常驻工作区**（原 worktree / 提示词文件块）为 **session kkv 双域持久化**；新增 **消息附件（attachment）** 与 **Composer 输入区改版**；移除全部 capture / 刷新能力；统一 UI 命名。  
> **Supersede**：[`worktree-engine-convergence`](../worktree-engine-convergence/prd.md) 中 **五类 capture 白名单、手动「工作树快照」、run/预览前 lazy capture、进程内 BlockStore**；[`vfs-user-ops-unified-tool-turn`](../vfs-user-ops-unified-tool-turn/prd.md) 中 **transcript `user_vfs_turn` 工具卡片** 与 **发送时 UA 独立消息对** 的用户可见形态；[`agent-worktree-block-ui`](../agent-worktree-block-ui/prd.md) 中 **「工作树」相关 UI 文案**（改为「常驻工作区」）。  
> **局部 supersede（Feature）**：Composer **双条**、pending→kkv、draft→`chat_session`、ops/workplace **不可叉** —— 见 [`features/composer-ops-chip-lifecycle/`](features/composer-ops-chip-lifecycle/prd.md)。再局部 supersede（`@token`、提示词 path 去重、去 UA 折卡、回填口径）—— 见 [`features/composer-at-token-prompt-dedup/`](features/composer-at-token-prompt-dedup/prd.md)。  
> **废止（以 Feature `composer-at-token-prompt-dedup` 为准）**：**历史 UA 只读折卡**（含 SPEC **T-UO2**）；以及「**每次文件 attach 均全文进提示词**」——改为可见序首次全文、其后短提示。  
> **不包含**：技术方案、接口设计、库表结构、任务拆分（见后续 SPEC）。

## 背景

现网 **worktree（工作树）** 的核心职责是：按规则将一批文件 **常驻** 在 Agent 提示词上下文中。这与「用户单次附带的增量信息」是两类不同问题，但现网用 **进程内 capture 快照** 混在一起，导致：

| 现网问题 | 说明 |
|----------|------|
| **常驻前缀不稳定** | 提示词文件块在进程内存；重启丢失；VFS/规则变更后靠五类 capture 白名单续命，易 stale |
| **规则变更与 prompt 强耦合** | 改规则即自动 capture 全文块，用户无法区分「常驻前缀」与「本轮新增文件」 |
| **刷新心智混乱** | 「工作树快照」菜单、run 前 lazy capture 与实时 Explorer 列表并存 |
| **user ops 展示割裂** | 磁盘即时写盘，但告知 LLM 靠独立 UA 消息对 + 工具卡片，与 user 聊天分离 |
| **Composer 能力不足** | Mobile 为「左输入框 + 右发送」窄条；双端均无附件草稿区、无 `@` 文件选择器；会话级操作分散在顶栏/抽屉 |

本 PRD 将能力拆开：

1. **常驻工作区（workplace）** — 文件常驻在 prompt 前缀；由 **session kkv**（规则快照域 + 文件缓存域）保证前缀稳定；**不是** 附件。
2. **消息附件（attachment）** — 表达 **增量**：规则变更后尚未加载的新 path、`@path` 文件/目录引用、user_ops 具体变更行为。
3. **Composer 改版** — 双端统一「大输入框 + 框内工具栏」；承载附件草稿、`@` 选择、会话快捷操作。

**术语（本 PRD）**

| 术语 | 含义 |
|------|------|
| **常驻工作区** | 原 worktree / 工作树块 / 提示词文件块；UI 统一称「常驻工作区」；Agent 配置中对应开关（原「工作树」开关） |
| **起始位置** | 对 LLM 可见的 transcript 起点；置位、压缩可改变 |
| **session kkv** | 会话生命周期内的持久化键值存储（SQLite 表，逻辑上可视为嵌套 JSON：`子域 → 键 → 值`） |
| **规则快照域** | kkv 子域：规则引擎产出的「加载哪些文件、以何种展示状态加载」的快照 |
| **文件缓存域** | kkv 子域：按展示形态缓存的文件内容（文件头 / 全内容 / 文件名） |
| **规则引擎** | 实时执行；根据 worktree 配置产出规则列表（本期 **小改**） |
| **执行引擎** | 按规则快照 + 文件缓存域组装 prompt 正文（本期 **大改**，替代 capture 物化） |
| **附件** | 挂在 user 消息上的条目；来源含 `workplace`、`attach`（`@path`）、`user_ops`；`skill` 预留本期不做 |
| **附件草稿** | 发送前挂在 Composer 上的待发送附件（含规则变更预填 path、user_ops、`@` 引用）；与输入文字并列 |
| **文件引用选择器** | 由 `@` 按钮打开的 VFS 浏览页，交互类似聊天工作区，用于多选文件或选择目录 |

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| **命名统一** | 双端 UI 中「工作树」「工作树块」等用户可见文案 **全部改为「常驻工作区」** |
| **去掉 capture 体系** | 无「工作树快照」菜单；无 lazy capture；无进程内 BlockStore 作为 prompt 来源 |
| **常驻前缀可持久** | 开启常驻工作区开关后，查看真实提示词 / 算 token / 发送时，前缀由 session kkv **稳定拼装**；App 重启后同会话 **可恢复** |
| **起始位置与 kkv 对齐** | 置位、手动压缩、新建会话 → **清空 session kkv**（或初始即为空） |
| **规则变更走附件增量** | 规则变更后，仅将 **尚未进入文件缓存域的新 path** 预填到 Composer 附件草稿；发送后挂到 message |
| **@ 引用可发现** | 双端 Composer 提供 `@` 入口与文件引用选择器；支持多文件、目录引用 |
| **目录引用呈树形** | `@` 目录时，拼入 prompt 的为 **该目录下递归文件树结构**，**非** 将目录内所有文件展平为同级列表 |
| **Composer 改版落地** | Mobile 由「左输入右发送」改为与 Desktop 同构的 **大输入框 + 框内工具栏**；双端工具栏按钮顺序与语义一致 |
| **user ops 合一** | 保存仍即时写 VFS；transcript **无** 工具卡片；发送时 user_ops 作为附件与 user 输入 **同条消息** |
| **双端一致** | Mobile 与 Desktop 在命名、kkv 失效、附件草稿、发送合并、Composer 工具栏 **语义对齐**（布局密度可不同） |

## 用户与场景

**用户：** 使用 Mobile / Desktop 写作、管理工作区规则、改稿并与 Agent 长会话的作者。

| 场景 | 期望体验 |
|------|----------|
| **开启常驻工作区** | Agent 配置打开开关后，每次拼 prompt 自动带上按规则常驻的文件前缀；内容来自 kkv 缓存 |
| **置位 / 压缩** | 改变起始位置；session kkv 清空；下次拼 prompt 重新走规则引擎与缓存填充 |
| **新建会话** | session kkv 为空；首次拼 prompt 时写入规则快照并按需填充文件缓存 |
| **改规则（有新文件需展示）** | 保存规则后，Composer 附件草稿出现 **新 path**（无正文，可删）；发送后记入 message |
| **改规则（无新文件）** | 已加载 path 均已命中文件缓存域 → **无** 附件草稿动作 |
| **@ 引用单个文件** | 点 `@` → 文件引用选择器中选文件 → 确认 → 输入区或附件区出现 `@path`；发送后进 message 附件 |
| **@ 引用目录** | 选择器中选目录 → 确认 → 附件记目录 path；拼 prompt 时展示 **该目录下递归文件树**，不把目录内每个文件都变成顶层并列项 |
| **@ 多选** | 选择器可多选文件；确认后为每个 path 生成引用（展示形式见 UI 节） |
| **改稿后继续聊** | 文件管理器保存 → 磁盘即时更新 → Composer 显示 user_ops 附件草稿 → 发送后一条 user 消息 |
| **压缩 / 换模型 / 换 Agent** | 在 Composer「更多」菜单中完成（Mobile 从顶栏/抽屉收敛至此） |
| **查看真实提示词** | 与 Agent 发送走 **同一套** kkv → 规则快照 → 文件缓存 → 拼接逻辑 |

## 范围

### 包含范围

**A. 命名与全局 UI 清理**

- 用户可见文案：**工作树 / 工作树块 → 常驻工作区**（含 Agent 编辑器开关、Toast、帮助文案等）。
- 删除「工作树快照」及相关刷新入口（含 Mobile `SessionActionsDrawer` 中对应项）。

**B. 移除 capture 体系**

- 取消五类 capture 白名单、手动快照、run/预览前 lazy capture、进程内 BlockStore 作为 prompt 来源。
- 置位、手动压缩：**不再 capture**；改为 **清空 session kkv**。
- **保留** Explorer 列表、`{{$filetree}}` 等 **实时规则视图**（规则引擎实时执行，不读 kkv）。

**C. session kkv（双域模型）**

逻辑上两个子域（具体存储见 SPEC）：

**规则快照域** — 规则引擎产出物，例如：

```json
[
  { "path": "a.txt", "status": "全内容" },
  { "path": "b.txt", "status": "文件头" }
]
```

> **注记**：上表 `status` 为产品示意中文；**wire** 取值是 `full` | `header` | `filename`（细则见 SPEC）。

`status` 表示展示/加载形态（文件头、全内容、文件名等；非展示的文件不进入列表）。

**文件缓存域** — 按形态分类的内容缓存，例如：

```json
{
  "fileHeader": { "d.txt": "…" },
  "wholeFile": { "a.txt": "…", "b.txt": "…" },
  "fileName": { "c.txt": "c.txt" }
}
```

初始为空；拼 prompt 时 **先读缓存，miss 再从 VFS 加载并回写**。

**清空时机**：新建会话、置位成功、手动压缩成功（condition 自动压缩是否清空由 SPEC 与现网对齐）。

**D. 常驻工作区 prompt 拼装（执行引擎）**

当 Agent 配置中 **常驻工作区开关** 开启时，**查看真实提示词 / 计算提示词大小 / 发送提示词** 统一走：

1. 从 session kkv 读取 **规则快照域**
2. 若为空 → 执行 **规则引擎** → 写入规则快照域
3. 按规则快照逐 path 读取 **文件缓存域**
4. 若对应 `status` 的内容不存在 → 从 VFS 加载 → 写入文件缓存域
5. 拼接常驻工作区前缀

**E. 规则变更与附件（workplace 来源）**

规则保存后：

1. 执行规则引擎，得到 **最新规则对象**
2. 对比规则中的 path 与文件缓存域已加载情况
3. **全部已加载** → 无用户动作
4. **存在未加载 path** → 将 **path 列表**（**不含 content**）写入 **Composer 附件草稿**
5. 用户发送时：附件写入 message；workplace/attach **仍可不含 content**（与「发送时仍不加载 content」一致）；**`content_json` 保持用户输入原文**，**不** 把完整 attachment XML 写进正文（避免气泡脏 XML）
6. **export / 发送拼 prompt** 时：对缺 content 的 workplace/attach **hydrate**（文件缓存域 miss → VFS 加载并回写），再 wrap 为 LLM 可见的 attachment XML（见 H）

**F. `@path` 文件引用（attach 来源）**

**引用方式**

- 用户在 Composer 内 **手动输入** `@path`，或
- 点击 **`@` 按钮** → 打开 **文件引用选择器** → 选择后自动生成 `@path` 引用。

**手输与选择器统一（发送时）**：两种方式最终产出同一类 `attach` 附件。手输的 `@path` **保留在用户可见正文**；发送时从正文扫描并生成/合并 attachments（已在草稿 chips 的 path 去重）。细则见 SPEC。

**文件引用选择器（双端）**

- 交互与视觉 **类似当前聊天工作区（VFS 浏览）**：目录层级浏览、文件列表、多选。
- 支持：**单选/多选文件**、**选择单个目录**。
- 用户点 **确认** 后：为所选 path 生成 `@` 引用并加入 Composer 附件草稿（或插入输入区，具体交互见 UI 节；**至少** 须在附件草稿可见）。
- 选择器 **只读**：不在此修改文件内容（编辑仍走工作区文件管理器）。

**目录引用的 prompt 语义（重要）**

当附件为 **目录 path**（`type=dir`）时：

- **不要** 把目录下所有文件展平为与目录同级的多条独立文件附件。
- **应** 在拼 prompt 时，以该目录为根，**递归展示其下文件树结构**（保留层级关系）。
- 叶子节点正文加载档位：默认 **文本 `full`、二进制 `filename`**（见 SPEC）。
- 用户心智：「我 @ 了 `chapters/`」→ 模型看到的是 **`chapters/` 这棵子树**，而非一堆散落在根级的文件 path。

**单文件引用**

- 落库时 attach 同样 **可不含 content**；**export / 发送拼 prompt** 时 hydrate：文件缓存域命中则用缓存，否则 VFS 加载并写入缓存。加载档位同目录叶子约定（默认文本 full、二进制 filename，见 SPEC）。
- **废止「每次文件 attach 均全文」**：同一可见上下文中同 path 再次出现时，文本 attach 进提示词为短提示（非常驻/目录等细则见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/prd.md)）。

**G. user_ops 附件**

- **写盘时机不变**：文件管理器操作 **立即写 VFS**。
- **移除** `user_vfs_turn` 工具卡片及 UA 独立消息对。
- 附件 `content` 存 **具体变更行为**（delete / rename / move / add、write / edit 内容等）。
- Composer 附件草稿区 **展示** 待发送的 user_ops；发送后与 user 输入并入同条 message（结构化在 `attachments_json`；气泡/`content_json` 仍为用户原文，见 H）。

**H. user 消息拼装形态（LLM 可见；落库分离）**

**落库（策略 A）**

- `attachments_json`：结构化附件；workplace/attach 的 `content` **可为 null**（发送时不强制预加载正文）。
- `content_json` / transcript 气泡：**仅用户输入原文**；**禁止** 把完整 `<attachment>…</attachment>` XML 写入正文。

**LLM 拼装时机**：在 **查看真实提示词 / token / 发送拼 prompt** 时经同一 hydrate + wrap 入口完成（非 append 时改写气泡正文；入口名见 SPEC）：

```xml
<attachment>
  <workplace>…</workplace>   <!-- 规则变更增量；hydrate 后含本轮新增 path 对应内容 -->
  <attach>…</attach>         <!-- @ 文件/目录引用 -->
  <user-ops>…</user-ops>     <!-- 文件变更行为 -->
</attachment>
<user-input>用户打字</user-input>
```

各段是否出现取决于本条消息是否携带对应来源附件；无附件时可不加 wrapper（保持纯文字，降低回归）。

**I. Composer UI 改版**

#### 共同原则（Mobile + Desktop）

- **大输入框**：多行文本区域占据 Composer 主体（Mobile 从现网「左窄输入 + 右独立发送钮」改为与 Desktop 同构）。
- **工具栏在输入框内部**（通常贴底或贴右下），不挤占输入区以外的整行高度。
- **附件草稿区**：输入框 **上方或内部顶部** 展示待发送 chip——**上条** workplace/user_ops（状态投影、**不可叉**）、**下条** `@path` attach（**可叉**）；细则与存储分层 supersede 见 [`features/composer-ops-chip-lifecycle/`](features/composer-ops-chip-lifecycle/prd.md)；发送后清空。
- 工具栏按钮 **自左向右** 顺序固定：

| 顺序 | 按钮 | 行为 |
|------|------|------|
| 1 | **更多** | 弹出菜单（见下表） |
| 2 | **@ 文件引用** | 打开文件引用选择器 |
| 3 | **发送** | 发送；Agent 运行中时为 **终止**（与现网一致） |

**「更多」菜单项（本期）**

| 菜单项 | 说明 |
|--------|------|
| **压缩上下文** | 与现网手动压缩等价；成功后清空 session kkv |
| **切换模型** | 打开当前工作区模型选择（Mobile 从「我的」/顶栏收敛至此的会话级入口） |
| **切换 Agent** | 打开当前会话 Agent 选择 |

> 其他会话操作（重命名、查看提示词等）**本期不要求** 迁入 Composer「更多」；可仍保留顶栏/会话菜单入口，但 **不得** 再含「工作树快照」。SPEC 可列完整入口迁移表。

#### Mobile 专项

- 布局目标：**对齐 Desktop `chat-composer__box` 心智**——圆角大输入框，发送钮在框内右侧，`@` 与更多在发送钮左侧。
- 现网 `ChatComposer` 的 `row`（`TextInput` + 外侧 `Pressable` 发送）**废弃**。
- 附件草稿在窄屏下可横向滚动 chip 列表，避免撑高过多。

#### Desktop 专项

- 在现网已有 `chat-composer__box` + 更多 + 发送 基础上，**新增 `@` 按钮**（位于更多与发送之间）。
- 文件引用选择器以 **Modal / 侧栏面板** 呈现，内容与 Mobile 选择器 **同一业务能力**（浏览、多选、选目录、确认）。

**J. 与置位 / 压缩 / 回滚**

- 置位语义遵循 [`message-set-floor`](../message-set-floor/prd.md)；**不** 附带 capture。
- hidden 消息的附件不参与当前轮 LLM 上下文；细则见 SPEC。

### 不包含范围

- **skill 附件**（`source=skill` 仅预留）。
- worktree **规则表** 结构大改（规则引擎小改）。
- CLI 全量对齐。
- ~~旧会话 UA 消息对 / capture 块迁移细节（SPEC 定义）~~：**历史 UA 只读折卡已废止**（按普通消息展示、不做数据升级）；见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/prd.md)。capture 块迁移仍不在本期。
- 文件引用选择器内的 **规则编辑**（纳入/目录 head-tail）；仍走工作区管理页。

## 核心需求

1. **常驻工作区与附件职责分离**  
   常驻前缀由 session kkv + 执行引擎维护；附件只表达增量，**不能** 替代常驻工作区。

2. **session kkv 双域持久化**  
   规则快照域与文件缓存域跨进程重启保留；置位 / 压缩 / 新建会话须清空。

3. **取消全部 capture**  
   不得再依赖进程 capture 或 lazy capture 作为 prompt 文件正文来源。

4. **执行引擎统一三条读路径**  
   查看真实提示词、token 计数、Agent 发送共用同一常驻前缀拼装；user 附件 hydrate + wrap 亦须共用同一流水线（见 SPEC `prepareUserMessagesForPrompt`）。

5. **规则变更 → path 级附件草稿**  
   仅未进入文件缓存域的 path 进入 Composer 附件草稿；发送时仍无 content；落库 `attachments` 可不含 content，`content_json` 保持用户原文；hydrate + XML wrap 在 **export / 发送拼 prompt** 时完成。

6. **@ 目录 → 递归文件树**  
   目录引用在 prompt 中 **以树形结构** 呈现子路径，**禁止** 简单展平为同级文件列表；叶子加载档位默认文本 full、二进制 filename（见 SPEC）。

7. **Composer 双端改版**  
   Mobile 大输入框 + 框内工具栏；双端均具备 **更多 / @ / 发送** 三钮及附件草稿区。

8. **文件引用选择器**  
   类聊天工作区浏览；支持多文件与目录；确认后生成 `@path` 引用。

9. **user_ops 即时写盘 + 附件草稿告知**  
   磁盘突变时机不变；LLM 告知改为 user 消息附件。

10. **UI 重命名**  
    「工作树」「工作树块」→「常驻工作区」。

## 验收标准

### 命名与 capture 移除

- [ ] **Given** 双端 Agent 配置与会话相关 UI，**When** 涉及原「工作树」能力，**Then** 文案均为「常驻工作区」，**无**「工作树快照」类入口。
- [ ] **Given** 用户修改规则并保存，**When** 不发送消息，**Then** **不** 发生 capture 或进程内块更新。

### session kkv 与常驻前缀

- [ ] **Given** 新建会话且常驻工作区开关开启，**When** 首次查看真实提示词，**Then** 规则快照域写入、文件缓存域按需填充、prompt 含常驻文件内容。
- [ ] **Given** kkv 已填充且未置位/未压缩，**When** 再次查看真实提示词，**Then** 文件正文优先来自文件缓存域。
- [ ] **Given** kkv 已填充，**When** 置位或手动压缩成功，**Then** session kkv **清空**。
- [ ] **Given** 未置位/未压缩，**When** 重启 App 后打开同一会话，**Then** kkv 仍可支撑常驻前缀。

### 规则变更与 workplace 附件草稿

- [ ] **Given** 规则变更产生未缓存的新 path，**When** 保存规则后回到 Composer，**Then** 附件草稿区出现对应 **path**（无正文），可删除。
- [ ] **Given** 所有 path 均已缓存（同 path 以文件缓存域 **任一** 展示形态命中即算已加载），**When** 保存规则，**Then** **不** 自动新增 workplace 附件草稿。
- [ ] **Given** 用户发送带 workplace/attach 附件的消息，**When** 消息落库，**Then** workplace/attach **可不含 content**；`content_json` 为用户原文（无完整 attachment XML）。

### 附件消息 transcript 与编辑

- [ ] **Given** 用户发送带附件的消息（有用户原文），**When** 查看 transcript 气泡，**Then** 显示用户输入原文，**不含** 完整 attachment XML。
- [ ] **Given** 同上消息已被编辑过，**When** 撤销编辑（恢复发送时正文），**Then** 气泡/`content_json` 恢复为发送时的用户原文。

### `@` 引用与目录树

- [ ] **Given** 用户通过 `@` 按钮在文件引用选择器中 **多选两个文件** 并确认，**When** 回到 Composer，**Then** 附件草稿区出现 **两条** `@path` 引用。
- [ ] **Given** 用户在 Composer 正文手输 `@notes/a.md`（chips 无该 path），**When** 发送，**Then** 消息 attachments 含对应 attach 条目，且气泡/正文 **仍可见** `@notes/a.md`。
- [ ] **Given** 用户在选择器中选择 **目录** `notes/` 并确认，**When** 发送后查看真实提示词，**Then** prompt 中该引用以 **`notes/` 为根的递归文件树** 呈现，**而非** 将 `notes/` 下所有文件 path 展平为顶层同级列表。
- [ ] **Given** 用户 `@` 单文件，**When** export / 发送拼 prompt，**Then** hydrate 后按文件缓存域 / VFS 加载单文件内容并参与拼接（档位见 SPEC：默认文本 full、二进制 filename）。**注**：同 path 非首次 → 短提示而非全文，见 [`composer-at-token-prompt-dedup`](features/composer-at-token-prompt-dedup/prd.md)（废止「每次均全文」）。
- [ ] **Given** 同一会话查看真实提示词 / 计算 token / Agent 发送，**When** 对比 user 段附件 wrap，**Then** 三者走同一套 hydrate + wrap 拼装结果（实现入口见 SPEC）。

### user_ops

- [ ] **Given** 用户在文件管理器保存文件，**When** 保存成功，**Then** 磁盘立即更新；transcript 无新行；Composer 附件草稿区出现 user_ops 摘要。
- [ ] **Given** 用户带 user_ops 发送，**When** 查看 transcript，**Then** **无** `user_vfs_turn` 工具卡片。

### Composer UI（Mobile）

- [ ] **Given** 用户在 Mobile 聊天页，**When** 查看 Composer，**Then** 为 **大输入框** 布局，发送钮 **在输入框内部右侧**，**非** 现网整行最右独立大钮独占一行外侧。
- [ ] **Given** 同上，**When** 查看框内工具栏自左向右，**Then** 顺序为 **更多 → @ → 发送**。
- [ ] **Given** 用户点击 **更多**，**When** 菜单展开，**Then** 含 **压缩上下文、切换模型、切换 Agent** 三项。
- [ ] **Given** 用户点击 **@**，**When** 选择器打开，**Then** 可浏览会话工作区目录结构，并可多选文件或选择目录；确认后附件草稿区出现对应 `@` 引用。

### Composer UI（Desktop）

- [ ] **Given** Desktop 聊天页 Composer，**When** 查看框内工具栏，**Then** 含 **更多、@、发送** 三钮，顺序与 Mobile 一致。
- [ ] **Given** 用户点击 `@`，**When** 选择器确认多选/选目录，**Then** 行为与 Mobile 文件引用选择器 **语义一致**。

### 双端与实时视图

- [ ] **Given** Explorer 或 `{{$filetree}}`，**When** 任意时刻查看，**Then** 仍反映当前规则与 VFS，**不** 依赖 session kkv。
- [ ] **Given** 上述附件与 Composer 场景在双端各执行，**When** 对比，**Then** kkv 失效、附件草稿、发送合并、目录树引用语义 **一致**。

## 非功能需求（业务/体验）

- **可发现性**：附件草稿、user_ops pending、`@` 引用须 **无需发送即可在 Composer 看见**，避免「改了文件却不知道要告诉模型」。
- **误触防护**：压缩、置位（若在其它入口）仍保留二次确认；切换模型/Agent 后 Composer 附件草稿 **不静默丢失**（除非切换会话，SPEC 定义）。
- **可达性**：框内按钮须具备无障碍标签（发送/终止、文件引用、更多选项）。

## 约束与依赖

- **前置 PRD**：见 YAML `dependency`；本迭代 supersede WEC capture 体系与 MSF「置位后 capture」口径。
- **与 checkpoint**：用户 VFS / Agent 工具写盘 checkpoint 策略不因本 PRD 回退。
- **Agent 配置开关**：原「工作树」开关改名为「常驻工作区」；关闭时不注入常驻前缀。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| **文件修订后缓存** | SPEC：**仅整文件 write → 写入 `full`**；**edit / delete / rename / move 均不碰 file_cache**（避免删→回滚→再引用误判首次加载） |
| **目录树深度与 token** | 大目录 `@` 引用时的截断/折叠策略，SPEC 定义 |
| **规则快照刷新时机** | 改规则后规则快照域何时更新 vs 仅附件增量，SPEC 定义 |
| **condition 压缩** | 是否清空 kkv |
| **历史会话** | ~~旧 UA 对只读折卡兼容~~ **已废止**；旧 UA 按普通气泡。capture 会话兼容仍见 SPEC / Feature `composer-at-token-prompt-dedup` |
| **空发续跑** | 仅附件无文字时的发送序列 |
| **更多菜单其余项** | 重命名、查看提示词是否后续迁入 Composer，本期不强制 |
| **图片/二进制 @** | 非文本文件的引用展示与缓存，SPEC 定义 |
