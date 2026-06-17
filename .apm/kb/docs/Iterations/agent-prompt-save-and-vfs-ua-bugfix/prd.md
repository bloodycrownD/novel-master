---
date: 2026-06-17
dependency:
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
  - Iterations/agent-prompt-abstract-block/prd.md
---

# 智能体保存校验与 VFS UA 简化 Bugfix PRD

## 背景

本需求包含两个彼此独立、均可单独验收的缺陷修复，均已有实现与规格沉淀，属于在既有能力上的纠偏与简化。

**Bug1 — 智能体保存校验与区域开关不一致**

智能体编辑器提供系统提示词、持久区、动态区三区，每区可独立开关。产品文案已说明：关闭后对应内容**不会发送给 AI**，已填写内容**仍保留**。但保存时 `buildAgentDefinitionFromForm` 仍执行与开关无关的「全局下限」：当 system 为空且 persist、dynamic 数组皆空时，一律报错「至少保留一个 Prompt 块」。用户将持久区/动态区关闭并删光块后无法保存，与开关语义矛盾。

**Bug2 — VFS 用户操作 UAUA 落库冗余**

VFS 用户操作当前落库为 **U-A-U-A 四段** synthetic 消息。中间 synthetic 工具往返对工具卡片 UI 无必要。新操作简化为 **UA 两条**；U 用 `<system-message>` 包裹 XML，A 为「收到通知」类确认文案。

**历史消息策略（用户定案）**

旧 UAUA 四段**不做折叠兼容**，按**普通会话消息**逐条展示即可；不为历史数据保留双读、legacy 匹配或迁移逻辑。仅**新产生的 UA 两条**折叠为工具卡片。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 保存校验与三区开关语义一致 | 三区全关且无数组内容时保存成功率 100% |
| VFS 新操作落库简化为 UA | 新操作仅 2 条消息；LLM 无 synthetic tool 往返 |
| 新会话工具卡片不变 | 新 UA turn 仍折叠为单张工具组卡片 |
| 实现尽量精简 | 无 legacy 双读、无四段折叠、无迁移脚本 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 配置智能体的作者 | 三区全关可保存，仅依赖会话上下文 |
| 日常写作者 | 新 VFS 操作仍看到工具卡片 |
| 升级用户 | 旧会话可读（逐条普通消息），不要求与现网折叠一致 |

## 范围

### 包含范围

1. **Bug1**：三区全关空 layout 可保存；开启区校验不变；Desktop 删除守卫对齐。
2. **Bug2**：flush 落库 UA 两条；仅 UA 折叠为工具卡片；LLM export 反映新形态。
3. **历史**：旧四段不迁移、不折叠，普通消息展示。

### 不包含范围

- 旧 UAUA 四段折叠为工具卡片。
- 双读识别（UA vs legacy）、legacy 专用 API。
- 工具卡片视觉改版、批量迁移、三区开关数据清空策略变更。

## 核心需求

1. 三区全关且无内容时可保存。
2. 任一区域开启时，现有 `validateAgentPromptLayout` 规则不变。
3. 新 VFS flush 仅写 U（system-message + XML）+ A（「收到通知」）。
4. 新 UA 在列表层折叠为 `user_vfs_turn` 工具卡片（从 U 块 XML 推导）。
5. 旧 UAUA 四段按普通消息展示，不报错。
6. Desktop/Mobile 删除守卫与 Core 校验一致。

## 验收标准

### Bug1

- 三区全关、无数组内容 → 保存成功。
- 持久区开、末块 user → 保存失败。
- Desktop 三区全关可删光所有块并保存成功。

### Bug2

- 新 flush → 仅 2 条消息；U 含 system-message；A 为「收到通知」。
- 新 UA → 单张工具卡片，参数正确。
- 旧四段历史 → 逐条普通消息，不折叠、不报错。
- LLM export → 新 UA 无 synthetic tool_use / tool_result。

## 约束与依赖

- 依赖 vfs-user-ops、agent-prompt-abstract-block 既有三区与 VFS 语义。
- Assistant 确认文案锁定：**收到通知**。

## 风险与待确认项

- 旧会话 VFS 操作不再是一张工具组卡片（已接受）。
- 去掉 synthetic tool 往返后需回归 LLM 对 VFS 的理解。
