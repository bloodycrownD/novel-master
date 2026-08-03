---
date: 2026-06-14
dependency:
  - Iterations/agent-editor-ui-bugfix/prd.md
  - Iterations/prompt-engine-three-regions/prd.md
  - Iterations/novel-context-system-guide/prd.md
  - Iterations/chat-rollback-vfs-tool-fixes/prd.md
  - Iterations/tool-system-v2/prd.md
---

# 用户 VFS 操作统一 Tool Turn PRD

## 背景

用户通过 Desktop/Mobile 对会话 VFS 的删改与 Agent 工具写盘**双轨并行**：模型看不到用户手改，worktree 快照因写文件频繁 `markDirty`，checkpoint 与回滚锚点不一致。

同时，三区 Prompt（持久 / 会话 / 动态）与 tool 轮次组合后，易出现 **相邻同 role**（如 `tool_result` 后接 user 聊天、动态区 `always` user 块等）。原方案依赖 **自动 turn boundary**，复杂且用户不可见。

本迭代为**架构级变更**：统一 VFS 合成 turn、会话 transcript 不变式、区内合并规则，以及**唯一**需用户确认的桥接 assistant。须在 `agent-editor-ui-bugfix` 合并后再开发。

## 目标

| 目标 | 说明 |
|------|------|
| **U-A-U-A 合成 turn** | 用户 VFS 突变落库 **4 条**：action（完整入参）→ **压缩** synthetic `tool_use` → 精简 `tool_result` → 桥接 `【done】` |
| **锚点 diff 编辑** | 保存时 **锚点 diff → `edit`**，失败 **fallback `write`**；**edit 须在 action 与 UI 展开 diff 描述** |
| **Transcript 不变式** | 持久/动态区 **Switch**（默认关）+ 校验；区内同 role **合并**；跨区 **不合并** |
| **Agent 编辑器 UX** | 提示词模版：持久区/动态区 **Switch**（默认关）；关时折叠、组装跳过；开时块编辑 + 保存校验 |
| **桥接 assistant（唯一弹窗）** | 仅当末条为 `tool_result` 且用户**带文字**发送时，确认插入真实 assistant `【done】` 后再发 user |
| **会话 UX** | 移除删除；**hide/unhide 专用多选**（仅 assistant / 仅 user 可选）；回滚 toast |
| **Worktree 窄刷新** | 写 VFS 不 dirty；规则变更 + 压缩 + 【工作树刷新】才 dirty |
| **Checkpoint / 版本校验** | **仅 mutating tool 完成后** capture（含 U-A-U-A flush）；plain 消息不 capture；**保留** `session-fs.versionCheck` |
| **LLM 同源** | visible messages = prompt 真源；export 仅区内 merge + provider 微调 |

## 范围

**包含**

- Core：`appendUserVfsTurn`（U-A-U-A）、**burst 合并**、锚点 diff、区内 merge export、持久/动态校验
- 会话：隐藏/恢复规则、末条发送规则、桥接弹窗、**edit diff 展开**（Desktop + Mobile）
- **Agent 编辑器（提示词模版）**：持久区/动态区 **Switch**（默认关）、启用后块编辑与保存校验（Desktop + Mobile）
- VFS 入口改造、worktree markDirty 收窄、【工作树刷新】

**不包含**

- 四区 **视觉层级/间距/卡片样式** 打磨 → `prompt-template-ui-polish`（与本迭代 Switch 可同屏落地，样式细节可后续 polish）
- 旧 Agent **自动迁移**（不兼容则提示用户修改或删除重建）

## U-A-U-A Burst 合并（纳入）

多次 VFS 突变（删 / 建 / 改名 / 保存…）在 **发送 user 消息前** 可合并为 **一条** U-A-U-A 落库：

| 阶段 | 行为 |
|------|------|
| **每次 VFS 操作** | 磁盘 **立即** 经 ToolRunner 生效；结果 append 到 **`chat_session.user_vfs_pending_json`**（actionXml + 精简 tools 结果） |
| **用户点击发送且成功** | 若 pending 非空 → **先** flush 合并为 1×U-A-U-A 落库 → **再** append user / 续跑 Agent |

合并规则：pending 内各次操作的 `tool_use` / `tool_result` **按操作顺序** flatten 到同一条 assistant / user；第 4 条 assistant 仅一条 `【done】`。与 Agent 单轮多 tool 同形，**不再二次执行** tool（避免重复写盘）。

## VFS 操作 → Tool 映射

| 操作 | Tool |
|------|------|
| 删除 | `fs` `rm` |
| 新建目录 | `fs` `mkdir` |
| 重命名/移动 | `fs` `mv` |
| 新建文件 | `write` |
| 保存编辑 | **锚点 `edit`** 或 **`write` fallback** | action / UI **展开 diff 描述**（见下） |

### Edit 保存：展开 diff 描述

`kind=save` 且合成 tool 为 **`edit`**（含多 hunk）时，除 path 外须携带 **可读的 diff 摘要**，供模型与用户回看：

| 层 | 要求 |
|----|------|
| **`<user-vfs-action>`（第 1 条 user）** | **完整真源**：path、edit-hunk old/new、mv 路径等 |
| **assistant `tool_use`（第 2 条）** | **压缩占位**：保留 tool `name` / `id` 与 input **键名**；字符串值统一 `"…"`（不重复大段正文） |
| **user `tool_result`（第 3 条）** | 成功统一 **`ok`**；失败 `Error: …`（不存 version / replacements） |
| **会话 Transcript UI** | user 气泡可折叠/展开 hunk；assistant tool 卡片可标注「入参见上条」 |

示例：

```xml
<user-vfs-action kind="save" path="chapters/01.md" method="edit" hunks="2">
  <edit-hunk index="1">
    <old>…锚点旧文…</old>
    <new>…锚点新文…</new>
  </edit-hunk>
  <edit-hunk index="2">…</edit-hunk>
</user-vfs-action>
```

burst 合并时：各次 save 的 action 与 hunk **按操作顺序**拼接，不跨 save 混排 hunk index。

## Transcript 与 Prompt（讨论收敛）

### Agent 编辑器 UX（提示词模版）

与 `prompt-engine-three-regions` 的 **system 顶置 Switch** 同模式；本迭代补齐 **持久区 / 动态区** 启用开关（wire：`persistEnabled` / `dynamicEnabled`，**默认 `false`**）。

**布局顺序（WYSIWYG，双端一致）**

```text
[ System Switch + 文本区 ]     ← 已有（prompt-engine-three-regions）
[ 持久区 Switch + 块列表 ]     ← 本迭代
[ 会话历史占位（只读） ]
[ 动态区 Switch + 块列表 ]     ← 本迭代
```

| Switch | 默认 | 关 | 开 |
|--------|------|----|----|
| **持久区** | 关 | 折叠 persist 块列表（或灰显占位）；**组装跳过** persist；wire 可保留 | 展开块列表；保存时校验（见下） |
| **动态区** | 关 | 同上，组装跳过 dynamic | 展开块列表；保存时校验（见下） |

- Switch **关 → 开**：若 wire 已有块，直接展示编辑，**不**清空。
- Switch **开 → 关**：仅 UI 折叠 + 运行时跳过；**不**强制删 wire 块（与 SPEC 一致）。
- 开关旁简短说明：持久区「人设/前文常驻」；动态区「每轮注入时间/目录等」；关时对应区不参与 prompt。
- 样式细节（section 间距、卡片圆角）可后续 `prompt-template-ui-polish`；**Switch 行为与校验属本迭代**。

### 持久区 / 动态区开关 — 启用后校验

| 区 | 默认 | 启用后要求 |
|----|------|------------|
| **持久区** | 关 | ≥1 块；**最后一块必须是 assistant 文本** |
| **动态区** | 关 | ≥2 块；**第一块 assistant、最后一块 user** |

- worktree 块**不特殊**，仅内容固定；参与区内 merge，**不可**作为持久区末块。
- **不做**旧配置自动迁移。

### 合并（Export / 组 prompt）

- **区内**同 role、纯文本 → 合并（含 worktree 当 user 文本；worktree 块 wire `role` 须参与合成，见 SPEC §现状差距）。
- **跨区**（持久 \| 会话 \| 动态）→ **永不合并**。
- 持久末 assistant + 会话首 user → 天然交替；**动态 启用**时会话末 user + 动态首 assistant → 天然交替（**不是** user/user 合并）。
- **禁止**将 vfs 语义段与普通 chat user **merge 为一条**（Session 层已用 U-A-U-A / 桥接消息解决）。

### 桥接 assistant（非自动 boundary）

| 场景 | 行为 |
|------|------|
| **VFS U-A-U-A 第 4 条** | 自动落库 assistant `【done】`（`metadata.kind=tool_turn_bridge`） |
| **Agent maxSteps 截断在 `tool_result`**，用户**带文字**发送 | **弹窗**说明将插入 assistant `【done】`；确认 → 落库桥接 → 发送 user；取消 → 不发送，输入保留 |
| **末条 user 空请求** | 不追加消息，直接复用当前 prompt（**已实现**） |
| **动态区关闭** | 普通会话；仅上表弹窗场景需桥接 |

桥接文案默认 **`【done】`**（通用任务结束信号；实现可固定，或与 `【good】`/`【over】` 等价）。

### 会话 UX

- **双端**长按菜单：**移除**删除、隐藏（含 Desktop `message-edit.ts` / `ConversationPanel` 现有项）。
- **移除**通用批量删/藏；改为 **【隐藏消息】/【恢复消息】专用多选**（见下）。
- **【隐藏消息】** 模式：
  - 进入多选；**仅 assistant** 消息显示勾选框，**user / 其它 role 不可选**（无勾选框或 disabled）。
  - 确认后：对所选 assistant 取 **最大 seq** `S` → `hideRange(1, S)`（本条及以前）。
- **【恢复消息】** 模式：
  - 进入多选；**仅 user** 消息显示勾选框，**assistant 不可选**。
  - 确认后：对所选 user 取 **最小 seq** `S` → `showRange(S, maxSeq)`（本条及以后）。
- 可多选；未选任何 eligible 消息时确认按钮 disabled。
- **Composer 末条规则**（须在 UI 区分 `tool_result` 与普通 user 文本）：
  - 末条 **assistant** → 不可空请求；须输入文字后发送。
  - 末条 **user 且含 tool_result** → 允许空请求；**带文字**发送走桥接弹窗（见上表）。
  - 末条 **plain user**（纯文本、无 tool_result）→ 允许空请求；**禁止**再输入文字（仅续跑 Agent）。
- **回滚**：Core **始终**截断 tail 消息；anchor 无 checkpoint 时 VFS 回退到**最近前序 checkpoint**（无则空树 baseline），**不抛错**；UI 可在 VFS 未能精确还原时 **toast 提示**（非阻断）。

## 讨论结论对照

| 话题 | 本 PRD/SPEC |
|------|-------------|
| U-A-U-A 四消息落库 | ✓ |
| 第 4 条桥接 `【done】`，非 vfs 专属英文文案 | ✓ |
| synthetic assistant `metadata.actor=user` | ✓ |
| **取消** repair-on-write 自动 boundary | ✓ |
| 仅 maxSteps+文字发送 → 用户确认桥接 | ✓ |
| 持久/动态 Switch + 校验 | ✓ |
| Agent 编辑器提示词模版 Switch UX | ✓ |
| edit 保存展开 diff + tool_use 压缩 | ✓ |
| burst 合并（flush → 1×U-A-U-A） | ✓ |
| checkpoint 仅 mutating tool 后 | ✓ |
| 区内 merge、跨区不 merge | ✓ |
| hide/unhide 角色过滤多选 | ✓ |
| tool_result 成功统一 ok | ✓ |
| hide-message 6～∞ assistant 锚点 | ✓ |
| worktree 写 VFS 不 markDirty | ✓ |
| 版本校验保留 | ✓ |
| 不兼容旧 Agent → 用户手动改/删 | ✓ |

## 验收

1. 用户连续删/改文件后 **pending 落库**；关应用重进后 pending 仍在；**点击发送成功**时 **一条** U-A-U-A 落库（含 `【done】`）；LLM 历史含等价 tool；worktree **不**因写文件 dirty。
2. 小改 → 锚点 `edit`；失败/大改 → `write`；action XML 含 hunk diff；assistant `tool_use` **压缩**、不重复 old/new 全文。
3. VFS 后末条为 assistant `【done】`，用户带文字聊天：**无需弹窗**；prompt 中 vfs 段与聊天 user **分离**。
4. Agent maxSteps=2 停在 `tool_result` 后带文字发送 → **弹窗** → 确认后桥接 + user。
5. 末条 **user(tool_result)** 空请求直接跑；末条 assistant 不可空请求；末条 plain user 不可输入文字。
6. Agent 编辑器：**持久区 / 动态区 Switch 默认关**；关时折叠且组装跳过；开且不合规 → **保存校验失败**。
7. `persistEnabled` 开且末块非 assistant → 失败；`dynamicEnabled` 开且不满足首 assistant/末 user/≥2 块 → 失败。
8. 【工作树刷新】可用；`versionCheck` 仍生效。
9. **隐藏**：仅 assistant 可勾选多选 → `hideRange(1, maxSeq)`；**恢复**：仅 user 可勾选多选 → `showRange(minSeq, maxSeq)`；**双端**无删除/通用批量。
10. `examples/agents.yaml` 的 `writer` 等样例在启用开关后须手动改到合规。

## 实施顺序

**第三批**：`agent-editor-ui-bugfix` → （可选并行 `prompt-template-ui-polish`）→ **本迭代**。

建议实现顺序：Transcript 不变式与校验 → Agent 编辑器 Switch UX → 区内 merge export → U-A-U-A + diff action + VFS 入口 → 桥接弹窗 → 会话 UX → worktree 收窄。

---
