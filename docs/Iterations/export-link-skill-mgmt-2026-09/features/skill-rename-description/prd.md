---
date: 2026-09-06
dependency: Iterations/export-link-skill-mgmt-2026-09/prd.md
---

# 技能重命名与描述编辑 PRD

## 背景

双端技能管理页均不支持重命名与描述编辑（探索证据：`apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx`、`apps/desktop/renderer/features/settings/SkillsManageView.tsx`）：mobile 行菜单仅「导出 ZIP/删除」，新建弹窗明示「技能名（即目录名，创建后不可改）」；desktop 行菜单仅「编辑/删除」，详情页只能裸改 SKILL.md 全文——改坏 front matter 技能即 invalid。

数据模型：技能名 = VFS meta 域目录名（`/meta/skills/{name}`），清单 name 从目录路径解析；description 唯一存于 SKILL.md front matter。agent 管理作为对照已支持改名（registry 按 agentId 键控、name 为普通字段），技能因「目录名即主键」一直没做。

底层能力已核实齐备：VFS 有 `renamePath`/`renamePrefix` 原语（单事务迁移、revision 历史自动跟随）；双端有 `withFrontMatterValues` front matter 重写函数；启停负清单（`skill_disabled_rule`）按技能名键控需联动迁移。

## 目标（含成功指标）

技能管理体验对齐 agent 管理：改名与改描述均为管理页内一步操作。成功指标：改名后启停状态、引用、导出全部即时生效新名，无残留旧名。

## 用户与场景

双端用户整理技能库：改名纠正早期命名、改描述让清单更好检索；不期望为此重建技能或手改文件。

## 范围

### 包含范围

1. 双端技能管理页支持**重命名技能**：改名后启用/禁用状态保留、清单与 `$` 引用立即生效新名。
2. 双端支持**编辑技能描述**（不触碰正文）：管理页/详情页提供入口，保存后清单描述即时更新。
3. 内置技能（`agent-config`）不允许重命名（复用保留名门）；描述编辑不做特殊限制。
4. 历史消息中的 `$旧名` 引用沿用既有自愈机制降级为提示行，不迁移历史消息。

### 不包含范围

- 跨域（global↔project）迁移式改名。
- 技能目录内附属文件的重命名（已有能力）。
- ZIP 导入导出流程变更（导出按目录自然带新名）。
- skill 工具（agent 侧）任何改动。

## 核心需求（3-7 条）

1. 重命名走目录迁移语义（底层 `renamePrefix`）：revision 历史保留、entry 身份不变。
2. 重命名校验同新建口径：名称合法、域内不重名、保留名门拦截（含新建侧同源判定）。
3. 改名联动：SKILL.md front matter 的 name 同步重写；启停负清单行随名迁移。
4. 描述编辑走 front matter 重写（`withFrontMatterValues`），不动正文与附属文件。
5. 入口位置对齐双端现有行菜单/详情页模式。

## 验收标准

- Given 任一双端重命名技能 When 保存 Then 清单显示新名、启停状态不变、`$新名` 引用可附全文、`$旧名` 降级为提示行。
- Given 重命名前后 When 对比文件 revision 历史 Then 历史可追溯（不因改名丢失）。
- Given 内置技能 When 尝试重命名 Then 被拒绝并提示保留名。
- Given 修改描述 When 保存 Then 清单描述更新且技能仍 valid。
- Given 改名后的技能 When 导出 ZIP Then 包内目录为新名。

## 风险与待确认项

- desktop `NewSkillModal` 残留的 `version` 参数与乐观锁注释（版本校验已整体移除的历史遗留）建议同迭代顺手清理。
