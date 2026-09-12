---
date: 2026-09-06
---

# 技能重命名与描述编辑 技术规格（SPEC）

## 设计目标

按 PRD（同目录 `prd.md`）落地：双端技能「编辑信息」入口（重命名 + 描述编辑合一弹窗）、core `updateSkillInfo` 服务方法（单事务：校验门 → 目录迁移 → front matter 同步 → 负清单迁移）、desktop NewSkillModal version 残留清理。

依据：探索报告 C（skills 服务全貌、VFS rename 原语、负清单结构、IPC 面、双端 UI、测试模式，log 20260906-231624-528）。

## 总体方案

**服务方法合一**：core 加 `updateSkillInfo(location, {newName?, description?})`——重命名与改描述是同一弹窗的一次提交，单事务保证无半迁移中间态。仅改描述（无 newName）时不做目录迁移，只重写 front matter。

**事务方案（A）**：`conn.transaction` 内嵌套完成全部步骤——`RevisionAwareVfsService` 的 write/renamePrefix 经 `runInTransactionOrConn`（外层事务时 catch `NESTED_TRANSACTION` 复用 conn；嵌套先例是 session-fs boundary（revision-aware-vfs.service.ts:297 注释）+ tdbc port 的 NESTED_TRANSACTION 契约，deleteSkill 是同层 conn.transaction 直挂 repo 的先例而非 vfs 嵌套先例）。校验链：

1. `assertValidSkillName(newName)`（缺省时跳过）；
2. **内置源门（仅提交 newName 时执行）**：global 域且现名 ∈ `BUILTIN_SKILL_NAMES` → 拒，抛新错误码 `SKILL_BUILTIN_RENAME`（文案「内置技能不支持重命名：{name}」；不复用 `skillBuiltin`——其文案是删除向的「内置技能不支持删除」，复用会错位）；仅改描述（无 newName）的 builtin 提交放行；
3. **目标保留名门**：`assertSkillNameNotReservedForCreate(newName)` 同源判定（目标名撞内置名直接拒，语义比「目录已存在放行」更直）；
4. **域内查重（事务内重查，收口 TOCTOU）**：目标目录 `/meta/skills/{newName}` 已存在 → 新错误码 `SKILL_ALREADY_EXISTS`；
5. `vfs.renamePrefix('/meta/skills/{old}', '/meta/skills/{new}')`（entry_id 不变、revision 历史自动跟随；原语不查目标存在，查重由上一步保证）；
6. front matter 同步：`parseSkillFrontMatter` 成功 → `withSkillFrontMatterValues` 重写 `name`（及 `description` 若提交）经 `vfs.write` 落盘（同 tx，bump version + 写 revision——「改 front matter 有 revision 记录」天然满足）；解析失败（invalid 技能）→ 跳过重写仅迁目录与负清单（保留 invalid 原样，避免改名顺手「治好」无效技能的行为歧义）；
7. 负清单迁移（仅 newName 时）：project 域迁 `(project:{pid}, old)` 单行；global 域迁所有 scope 同名行——镜像 `deleteSkill` 的连带口径；repository 新增 `renameByName` 方法。

**front matter 单源**：core `domain/skills/logic/` 新增 `withSkillFrontMatterValues(source, {name?, description?})`（正则替换 `^key:` 行 / 缺 front matter 前置补块，语义对齐 desktop `skill-ui.ts` 现有实现）；desktop `skill-ui.ts` 与 mobile `NewSkillModal.tsx` 的两份私有/导出实现**回收为消费 core 单源**（消除三处复制漂移）。

**改描述门**：invalid 技能（front matter 解析失败）禁用「编辑信息」入口（UI 提示先修复 SKILL.md）——覆盖「改名跳过重写」分支的 UI 面，避免 invalid 技能经描述编辑意外补块变 valid 的歧义。

**UI 形态（双端一致）**：行菜单「编辑信息」→ 弹窗两个字段（名称 + 描述）；内置技能名称框只读（提示内置不可改名）；desktop 管理页保存后更新 `viewingSkillRef`（详情栈顶同技能防踢回）与列表刷新。（2026-09-12 用户拍板：详情页头部入口已移除，收敛为管理页行菜单单点；下文 Step 4/5 中的详情页入口与 mobile `setParams` 描述为历史计划，未随拍板实施——mobile 详情页还原基线形态。）NewSkillModal 文案「创建后不可改」更新为「可在管理页重命名」。

**desktop version 残留清理**：`NewSkillModal.tsx` ZIP 导入重写分支删除 `ipcSkillsRead`（readRes）调用、`version` 传参与过时乐观锁注释——`SkillsWriteRequest` 无 version 字段，spread 逃过 excess check 的死参数，content 实际来自 zip 预检原文。

## 最终项目结构（变更文件）

| 文件 | 变更 |
|------|------|
| `packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts` | 新增单源重写函数 |
| `packages/core/src/errors/skill-errors.ts` | 加 `SKILL_ALREADY_EXISTS`（域内撞名）与 `SKILL_BUILTIN_RENAME`（内置改名拒，勿复用删除向文案的 `skillBuiltin`） |
| `packages/core/src/domain/skills/repositories/skill-disabled-rule.port.ts` + `impl/sqlite-skill-disabled-rule.repository.ts` | 加 `renameByName` |
| `packages/core/src/service/skills/skills.port.ts` + `impl/skills.service.ts` | 加 `updateSkillInfo` |
| `packages/core/src/public/*.ts` | barrel 导出（错误码 + 重写函数） |
| `apps/desktop/shared/ipc-types.ts` | `IPC_CHANNELS` 加 `SKILLS_UPDATE_INFO: 'nm:skills/update-info'`（大写蛇形 key 惯例）+ `SkillsUpdateInfoRequest` |
| `apps/desktop/src/main/ipc/handlers/skills.ts` + `handler-registry.ts` + `renderer/ipc/invoke-registry.ts` + `renderer/ipc/client.ts` | handler + 绑定 + `ipcSkillsUpdateInfo` + client.ts 手工解构导出列表加同名导出（消费方从 `@/ipc/client` import，漏列即编译失败） |
| `apps/desktop/renderer/features/skills/skill-ui.ts` | 回收 `withFrontMatterValues` → core 单源 |
| `apps/desktop/renderer/features/settings/SkillsManageView.tsx`、`SkillDetailView.tsx` | 「编辑信息」菜单/按钮 + 弹窗（新组件 `SkillInfoEditModal`）+ viewingSkillRef 更新 |
| `apps/desktop/renderer/features/skills/NewSkillModal.tsx` | version 残留清理 + 文案 |
| `apps/mobile/src/components/skills/skill-ui.ts`（既有文件扩展） | 导出消费 core 单源的重写函数 |
| `apps/mobile/src/components/skills/NewSkillModal.tsx` | 删私有 `withFrontMatterValues` 改消费单源 + 文案 |
| `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx`、`SkillDetailScreen.tsx` | 「编辑信息」入口 + 弹窗 + setParams |

## 变更点清单

（即上表 + 总体方案步骤 1-7，不再重复）

## 详细实现步骤

- Step 1 — phase-skill-core-util — blocking: yes — qa: auto：core 新增 `withSkillFrontMatterValues`（含单测：name/description 重写、缺 front matter 补块、冒号描述转义——对齐 desktop 既有 `skill-zip-import.test.tsx` 中的单测语义）+ barrel 导出。
- Step 2 — phase-skill-core-service — blocking: yes — qa: auto：负清单 repository 加 `renameByName(scopeKey | null, from, to)`（null=全 scope）；errors 加 `SKILL_ALREADY_EXISTS`；`skills.port.ts` 加 `updateSkillInfo(location, {newName?, description?})`；`skills.service.ts` 实现总体方案校验链 1-7（`conn.transaction` 单事务；查重在事务内执行）。
- Step 3 — phase-skill-ipc — blocking: yes — qa: auto：desktop 五处 IPC（channel `nm:skills/update-info` + `SkillsUpdateInfoRequest`（`SkillRefDto & {newName?, description?}`）、`handleSkillsUpdateInfo`（照 delete 模式）、registry 绑定、`ipcSkillsUpdateInfo`、`renderer/ipc/client.ts` 解构导出列表加 `ipcSkillsUpdateInfo`）。
- Step 4 — phase-skill-ui-mobile — blocking: yes — qa: auto：mobile `skill-ui.ts` 消费 core 单源（删 NewSkillModal 私有实现）；`SkillsSettingsScreen` 行菜单加「编辑信息」→ `SkillInfoEditModal`（名称+描述；内置只读；提交走 `runtime.skills()` 的 `updateSkillInfo`；invalid 技能入口禁用）；`SkillDetailScreen` 头部同入口 + 成功后 `setParams`；NewSkillModal 文案更新。
- Step 5 — phase-skill-ui-desktop — blocking: yes — qa: auto：desktop `skill-ui.ts` 回收单源；`SkillsManageView` 行菜单 + `SkillDetailView` 头部「编辑信息」→ `SkillInfoEditModal`（走 `ipcSkillsUpdateInfo`；成功后更新 `viewingSkillRef` + 列表刷新；invalid 禁用）。
- Step 6 — phase-skill-cleanup — blocking: no — qa: auto：desktop `NewSkillModal` 删 readRes/version/乐观锁注释（省一次 IPC 往返）；确认全仓无 version 残留引用。
- Step 7 — phase-skill-changelog — blocking: no — qa: auto：CHANGELOG Unreleased 记新能力（技能重命名/描述编辑）。
- Step 8 — phase-skill-manual — blocking: no — qa: manual_user：真机双端改名/改描述验收（含 `$新名` 引用生效、`$旧名` 降级提示行、启停状态保留观察）。

## 测试策略

约束：core 改动后 `npm run build -w @novel-master/core` 重建 dist（mobile 经 metro 消费）；worktree 需重建 tdbc/core/tokenizer dist（#23/#31）；mobile jest `NODE_ENV=test`、desktop `NODE_ENV=development`。

### 测试用例

- T-S1 — blocking: yes — Step 1：`withSkillFrontMatterValues` 单测（core node:test）。
- T-S2 — blocking: yes — Step 2：`updateSkillInfo` 服务测试（照 `skills.service.test.ts` fixture 模式）：①正常改名——目录迁移（list 新路径、旧路径 NOT_FOUND）、SKILL.md front matter name 同步、`$新名` 可解析；②启停状态保留——改名前 setDisabled(true)，改后负清单行为 new 名（直查 `ctx.conn.query` 断言，deleteSkill 用例先例）；③域内查重撞名 → `SKILL_ALREADY_EXISTS`；④global 域内置 `agent-config` 改名拒；⑤目标名撞内置名拒；⑥global 域负清单全 scope 迁移；⑦invalid 技能改名——目录与负清单迁移、front matter 不动（仍 invalid）；⑧仅改描述——无目录迁移、description 更新、revision 递增；⑨global 域 builtin（agent-config）仅改描述——放行且只重写 front matter（防步骤②误拦回归）。
- T-S3 — blocking: yes — Step 2：revision 跟随断言——改名前后同 entry 的 version 连续（read 新路径 version ≥ 改名前，无重置）。
- T-S4 — blocking: yes — Step 3：desktop `skills-handlers.test.ts` 加 `handleSkillsUpdateInfo` 直调测试（成功/错误码透传）。
- T-S5 — blocking: yes — Step 4/5：mobile `SkillInfoEditModal` 契约/渲染测试（内置只读、invalid 禁用、提交参数；照 `new-skill-modal-contract.test.ts` 模式 + core-shim 补新导出）；desktop 静态渲染断言菜单/弹窗存在。
- T-S6 — blocking: yes — Step 6：desktop NewSkillModal 源码断言无 `version:` 传参与 readRes 调用。
- T-S7 — blocking: no — qa: manual_user：Step 8 真机验收。

## 风险与回滚方案

- **事务原子性**：全步骤单 `conn.transaction`（方案 A，deleteSkill 先例）；中断即整体回滚，无半迁移。renamePrefix 的 REPLACE SQL 无目标存在检查——由事务内查重前置保证。
- **负清单边界（已知，文档化不处理）**：global X 与 project P 的 X 并存且 `(P,X)` 禁用时改 global X 名——全 scope 迁移会把 `(P,X)` 一并改名，但 P 实际生效的是本地副本 X，行成孤儿。低频组合（同名并存+禁用+改 global 名），按简单口径接受，测试注释记录。
- **改名后导航状态**：双端均更新（setParams / viewingSkillRef），漏更触发既有「技能消失踢回」自愈兜底。
- **$旧名 引用**：既有自愈机制（missing 提示行、不写 seen）零改动兼容——T-S2①顺带覆盖。
- **回滚**：feature 分支 revert；无 schema 变更（负清单复用既有表，仅新增 repo 方法）；core 新导出为纯增量。
