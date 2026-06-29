---
date: 2026-06-29
dependency:
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/message-visibility/prd.md
  - Iterations/mobile-app/prd.md
---

# hide 期间 user ops 卡片退化与真实提示词字数展示 PRD

## 背景

本迭代修复两个已定位、改动面小的体验缺陷，均来自 Mobile 侧反馈与代码走读结论。

**缺陷 A — hide 期间 user ops 卡片退化**

用户 VFS 操作（user ops）在 transcript 中以「用户操作 (N)」工具组卡片展示，由运行时将 `user_vfs_action` + `user_vfs_ack` 两条消息合成 `user_vfs_turn`（`vfs-user-ops-unified-tool-turn`）。消息可见性（`message-visibility`）引入 `hidden` 后，设计意图为：**hidden 仅影响 LLM 是否可见**，transcript 仍展示该消息并灰显。

实际行为：执行【隐藏消息】后，合成条件因 `hidden` 失败，同一操作退化为两条普通气泡（user 迷你 vfs 卡 + assistant「收到通知」），与用户心智（hide/unhide 只是状态）不一致。该问题在 Mobile WebView transcript 上复现；Desktop 共用同一 Core 合成逻辑，需一并修复。

**缺陷 B — 真实提示词折叠时字数展示不全**

「查看提示词」（`RealPromptScreen`）中，每张 `PromptPreviewSegmentCard` 折叠时展示首行预览与 `· N 字`（`N = segment.body.length`）。当 persist worktree 等段首行较长时，预览与字数写在同一 `numberOfLines={2}` 的文本块内，导致 **字数后缀被省略号裁掉**，出现「几万字的内容却只看到不完整字数」。该问题在 Android 上复现；与展开后正文渲染无关，亦不需要 WebView。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| hide 不改变 user ops 卡片形态 | 隐藏区间内含 user ops 的会话：transcript **仍显示**「用户操作 (N)」工具组卡片，并正确灰显（opacity / hidden 样式） |
| hidden 语义不变 | hide/unhide 后 LLM 输入与真实提示词预览仍 **不包含** hidden 消息；`hideRange` / `showRange` 行为不变 |
| 折叠字数完整可读 | worktree 等超长段折叠时，**完整显示** `N 字`（如 `50000 字`），不被预览摘要挤占或省略 |
| 改动可控 | 单迭代内完成，不引入 WebView、不改 worktree 生成或 flush 逻辑 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 日常写作用户 | 使用【隐藏消息】裁剪上下文后，仍希望在 transcript 中辨认历史 user ops 操作（灰显即可） |
| 调试 / 配置用户 | 在「查看提示词」中查看含大 worktree 的 persist 段，折叠时核对字数是否与纳入规则一致 |
| 双端用户 | Desktop 隐藏消息后 user ops 卡片形态与 Mobile 一致 |

## 范围

### 包含范围

1. **Transcript 展示层**：hidden 状态下仍合成 `user_vfs_turn` 卡片（Mobile WebView + Desktop React）。
2. **Tail 批量行映射**：restore/delete 等依赖 `chatMessagesToTailBatchRows` 的路径在 hidden 下仍按「一张卡片」计行（若当前已因拆分而异常，一并修正）。
3. **真实提示词卡片 UI**：折叠区将「预览摘要」与「字数」分开展示，确保字数始终完整可见。
4. **Core 单测**：覆盖 hidden UA 对的 display 匹配；字数 UI 以组件/手工验收为主。

### 不包含范围

- user ops flush、pending、净 diff 为空等落库问题（见 `mobile-user-ops-logging-project-workspace-back`）。
- 展开后超长正文的 ScrollView / WebView 优化。
- 真实提示词中 UA 段合并为摘要卡片（`formatUserVfsTurnPreviewBody`）。
- iOS 专项验证（Bug B 以 Android 复现为准，RN 组件改动预期双端受益）。
- hide/unhide 多选规则、seq 范围算法变更。

## 核心需求

1. **display 合成与 LLM 过滤分离**：transcript / tail-batch 在 UA 两段均为 `hidden` 时仍识别为 `user_vfs_turn`；LLM 与 `buildPromptAssemblyFromLayout` 继续跳过 hidden 消息。
2. **灰显传递**：合成卡片的 `hidden` 状态正确反映（任一段 hidden 即视为 hidden 卡片），现有 `.row.hidden` / 透明度样式继续生效。
3. **折叠字数独立展示**：`PromptPreviewSegmentCard` 折叠时，字数不与 `numberOfLines={2}` 的预览共用同一 Text 节点。
4. **零业务语义回归**：不修改 `hideRange`、`showRange`、消息 DB 字段及 prompt 过滤策略。
5. **双端 transcript 一致**：Mobile `message-blocks` / WebView 与 Desktop `message-blocks` / `MessageList` 使用同一 Core display 匹配能力。

## 验收标准

### 缺陷 A — hide 期间 user ops 卡片

1. **Given** 会话中存在已 flush 的 user ops（UA 两段），**When** 用户对某 assistant 执行【隐藏消息】且该操作使 UA 两段 `hidden=true`，**Then** transcript 仍显示 **一条**「用户操作 (N)」工具组卡片（非两条普通消息），且卡片呈 hidden 灰显样式。
2. **Given** 上一步 hidden 的 user ops，**When** 用户执行【恢复消息】使 UA 两段 `hidden=false`，**Then** 卡片仍为「用户操作 (N)」工具组，灰显消失。
3. **Given** hidden 区间含 user ops，**When** 打开「查看提示词」，**Then** 预览中 **不包含** 该 hidden 段（与现有一致）。
4. **Given** 同上会话，**When** 发送消息触发 LLM，**Then** hidden 消息 **不进入** 模型输入（与现有一致）。
5. **回归**：未 hidden 的 user ops 卡片展示、展开工具详情、hide 多选 assistant 规则与 batch 高亮语义不变。

### 缺陷 B — 折叠字数展示

1. **Given** 真实提示词中存在 persist worktree 段且 `body.length ≥ 10000`，**When** 卡片处于折叠状态，**Then** 可见完整字数文案（如 `12345 字`），无 `…` 截断数字。
2. **Given** 同上，**When** 首行预览很长，**Then** 预览仍可最多 2 行省略，但 **字数行独立完整显示**。
3. **Given** `body` 为空，**When** 折叠，**Then** 仍显示「空内容」，不出现重复或空白字数行。
4. **回归**：展开/折叠切换、角色与标题展示、列表滚动性能无明显回退。
