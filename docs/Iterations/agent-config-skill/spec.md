---
date: 2026-08-21
---

# 内置 agent-config 技能与 agent 工具描述瘦身 技术规格（SPEC）

## 设计目标

内置一个 `agent-config` 技能承载完整 agent 配置指南（种入 global 域、不可删除、可编辑），`agent` 工具 description 瘦身并指路该技能。需求来源：`docs/Iterations/agent-config-skill/prd.md`（含两轮对话修正：fs 域隔离核实、删除路径闭合、UI 方案对齐内置服务商真实先例）。

## 设计决策

- **D1（seed 落点与通道）**：挂在 `bootstrapNovelMaster`（`packages/core/src/bootstrap/novel-master-bootstrap.ts`）**事务之后**的公共路径（快/慢两分支都覆盖；放事务内会与 `createSkillsService` 内部用外层 conn 构造的 VfsService 嵌套冲突）。通道用 `createSkillsService(conn).writeSkillFile("global", "agent-config", undefined, CONTENT)`——比直写 `globalMetaVfs()` 多走技能名/路径校验与领域语义。幂等语义 = 先 `readSkillFile("global", "agent-config")` 捕 `NOT_FOUND` 再写（`writeSkillFile` 本身是覆盖写，无 NOT_EXISTS 语义）；存在（含用户改过）即跳过。三端（cli/desktop/mobile）共用此 bootstrap 入口，零额外接线。
- **D2（拦截条件与新建拦截）**：两道门都在服务层，共用 `BUILTIN_SKILL_NAMES` 名单（单一来源）。①删除：`deleteSkill` 入口在 `assertValidSkillName` 后，`location.domain === "global" && BUILTIN_SKILL_NAMES.has(location.name)` 抛 `SkillError("BUILTIN_SKILL")`——限定 global 是因为 project 域历史同名副本（升级前建的）仍可删。②新建：`writeSkillFile` 在名字校验后，`BUILTIN_SKILL_NAMES.has(name) && 该域下技能目录不存在`（复用 `assertSkillDirExists` 同源的存在性判定，目录不存在 = 新建）抛 `SkillError("BUILTIN_SKILL_NAME_RESERVED")`；目录已存在 = 编辑内置本体或历史副本，放行。**两道门的错误 message 一律中文**（mobile 无转译层，英文 message 会裸透）。与 provider 先例的本质差异：provider 按数据行 `is_builtin` 判，技能无行记录，按"域 + 固定名单"判。
- **D3（UI 照真实先例，双端零改动）**：探索证实内置服务商的删除入口**从不隐藏/置灰**（desktop `SettingsViews.tsx` L934-972、mobile `ProvidersScreen.tsx` L213-225），真实先例是"入口保留 + 服务层拦截 + 错误 toast 冒泡"。错误冒泡链已闭合：desktop `format-ipc-error.ts` L79-81 的 `SkillError` 分支自动透出新 code；mobile `format-error.ts` 落 message 兜底——**新错误的 message 直接写中文**（mobile 无转译层）。批量删除混入内置技能：desktop 逐个删、遇错 break（已删的保留），mobile 整批 catch 停止——均属预期行为。
- **D4（description 瘦身范围）**：只改 `agent-tool.ts` 的 description lambda 一处（求值链单点已核实：`tool-definitions.ts` L25 是唯一运行时求值点）。保留锚点（既有测试依赖）：`当前可管理 agent 名单` 标题、`（暂无）` 空名单降级、`formatAgentEntries` 名单段、action 一览（`list / get / create / update`）。删除"参数说明"段（零测试锁定），换成一句指路：配置字段详情与完整示例请先 `skill load agent-config`。**`inputSchema` 里 `definition` 字段的 `z.describe` 同步精简**（它经 zodToJsonSchema 随 schema 每轮携带，不精简则瘦身失效一半）——字段清单移除，保留"完整定义体对象，语义校验由服务层完成，字段详情先 skill load agent-config"。
- **D5（seed 正文存放）**：TS template string 常量（core src 无任何文件资源读取先例，`grep readFileSync|import.meta.url` 零命中；`MESSAGE_CHECKPOINT_TABLE_DDL` 等多行常量是既有模式）。整篇 markdown 是首例，注意转义：正文中的 code fence 用缩进式代码块或 `String.raw` 规避 `` ` `` 与 `${` 转义坑。
- **D6（生效链，零额外代码）**：`effectiveSkills` 每 run 实时查库无常驻缓存，seed 提交后**下一个会话/回合立即可见，无需重启**；负清单可禁用（`project:{pid}` 行→该项目内不进索引，预期行为）；project 域同名副本覆盖 global 版（既有规则）；`skill load` 的域缺省回落（project NOT_FOUND → global，`skills.service.ts` L250-273）保证指路可达。
- **D7（seed 正文内容清单）**：front matter（`name: agent-config` + 描述，过 `parseSkillFrontMatter` strict 校验）+ 正文章节：AgentDefinition 全字段说明（含陷阱：`workplace` 是非空字符串非布尔、persist 只收 text 块、worktree 块写出需 omit、`skillsEnabled: false` 联动摘 skill 工具、`tools.allow/deny` 互斥、`model` 是 savedModelId UUID）+ 三区布局（system/persist/dynamic/workplace/customAttach）详解 + create/update 完整 definition JSON 示例（含最小可用示例与带 workplace 的进阶示例）+ "definition 是整体覆盖非增量合并、保存后下一次会话生效"的操作提示。

## 最终项目结构

```
packages/core/src/
  bootstrap/skills/
    seed-builtin-skills.ts            # 新增：BUILTIN_SKILL_NAMES + AGENT_CONFIG_SKILL_MD 常量 + seedBuiltinSkills(conn)
  bootstrap/novel-master-bootstrap.ts # 改：事务后公共路径调 seedBuiltinSkills（错误容忍：种入失败不阻断启动，记日志）
  errors/skill-errors.ts              # 改：SkillErrorCode 加 "BUILTIN_SKILL" 与 "BUILTIN_SKILL_NAME_RESERVED" + 中文 message 工厂
  service/skills/impl/skills.service.ts # 改：deleteSkill 加 D2①拦截；writeSkillFile 加 D2②新建拦截
  domain/tool/builtin/agent-tool.ts   # 改：description lambda 瘦身 + definition z.describe 精简（D4）
packages/core/test/
  bootstrap/seed-builtin-skills.test.ts  # 新增：T-AS1
  skills/skills.service.test.ts          # 改：T-AS2 拦截用例
  tool/agent-tool.test.ts                # 改：description 锚点保留 + 新增指路/长度断言（T-AS3）
```

不改动：双端 UI 与 IPC（D3 零改动）、`skill-tool.ts`、`run-agent-turn.ts`、`tool-definitions.ts`、`format-ipc-error.ts` / `format-error.ts`（冒泡链自动兼容）。

## 详细实现步骤

- Step 1 — phase-ac-seed — blocking: yes — qa: auto：`seed-builtin-skills.ts`——`BUILTIN_SKILL_NAMES`（Set，含 `agent-config`）+ `AGENT_CONFIG_SKILL_MD` 常量（D5/D7 内容清单）+ `seedBuiltinSkills(conn)`：`createSkillsService(conn)` → `readSkillFile("global", "agent-config")` 捕 `NOT_FOUND` 则 `writeSkillFile("global", "agent-config", undefined, AGENT_CONFIG_SKILL_MD)`，存在即跳过；`novel-master-bootstrap.ts` 事务后公共路径挂接（失败 catch 记日志不阻断启动——bootstrap 主链不应被可选内容种入拖挂）。
- Step 2 — phase-ac-delete-guard — blocking: yes — qa: auto：`skill-errors.ts` 加两个 code（`BUILTIN_SKILL`、`BUILTIN_SKILL_NAME_RESERVED`）与中文 message 工厂（如「内置技能不支持删除：{name}」「「{name}」为内置技能保留名，不能用于新建；内置技能本身可在管理页编辑」）；`skills.service.ts` `deleteSkill` 在 `assertValidSkillName` 后加 D2①拦截，`writeSkillFile` 在名字校验后加 D2②新建拦截（存在性判定复用 `assertSkillDirExists` 同源逻辑）；名单从 `seed-builtin-skills.ts` 引，单一来源。
- Step 3 — phase-ac-description — blocking: yes — qa: auto：`agent-tool.ts` description lambda 瘦身（保留 D4 四锚点，参数说明段→指路句）+ `definition` 的 `z.describe` 精简；同步 `agent-tool.test.ts` 既有断言（锚点保留则零改动）+ 新增指路断言（`/skill load agent-config/`）与非名单正文长度上限断言。
- Step 4 — phase-ac-tests — blocking: yes — qa: auto：新增 `test/bootstrap/seed-builtin-skills.test.ts`（T-AS1 两态：全新库种入+listSkills 可见；预置用户版内容后 seed 跳过不覆盖）+ `skills.service.test.ts` 加 T-AS2 两例（global 内置名删除抛 `BUILTIN_SKILL` 且目录仍在；project 域同名自建可正常删）；回归 `agent-tool.test.ts`、`effective-skills.test.ts`、`parse-skill-front-matter.test.ts`。
- Step 5 — phase-ac-qa — blocking: no — qa: manual_user：真机/桌面验收——首启后技能管理页可见 `agent-config`；删除操作被拒且 toast 中文提示；会话中 `agent list` 正常、description 含指路；`skill load agent-config` 返回指南全文。

## 测试策略

### 测试用例

- T-AS1 — blocking: yes — seed 幂等：全新库（bootstrap 后）global 域存在 `/meta/skills/agent-config/SKILL.md` 且 `listSkills("global")` 含有效条目；预置用户改动后再跑 `seedBuiltinSkills` 内容不变（映射 Step 1/4）
- T-AS2 — blocking: yes — 删除拦截：`deleteSkill({domain:"global", name:"agent-config"})` 抛 `SkillError("BUILTIN_SKILL")` 且技能目录仍在；project 域历史同名副本可正常删（映射 Step 2/4）
- T-AS6 — blocking: yes — 新建拦截：`writeSkillFile("project", "agent-config", undefined, ...)` 抛 `BUILTIN_SKILL_NAME_RESERVED` 且 message 为中文；global 域新建（模拟 seed 缺失场景，目录不存在时）同样拒绝；目录已存在时（内置本体/历史副本）拦截门放行（映射 Step 2/4）
- T-AS3 — blocking: yes — description 契约：含 `skill load agent-config` 指路、名单标题与 `（暂无）` 降级、action 一览锚点；非名单正文长度上限断言（≤380 字符口径）＋被删段落不残留断言（参数说明段标题与 definition 字段清单关键词）（映射 Step 3）
- T-AS4 — blocking: yes — 回归：`agent-tool.test.ts`、`effective-skills.test.ts`、`parse-skill-front-matter.test.ts`、`skills.service.test.ts` 既有用例全绿（映射 Step 4；含 seed 后 global 编辑内置本体的用例——`writeSkillFile` 不透传 expectedVersion，对已存在 SKILL.md 的整文件覆盖会撞 VFS 乐观锁，编辑本体走 editSkillFile、writeSkillFile 以写辅助文件覆盖放行路径）
- T-AS5 — blocking: no — 真机验收（映射 Step 5）

## 风险与回滚方案

- **markdown 常量转义**：正文含 JSON 示例与代码块，template string 转义易错——用缩进式代码块/`String.raw`，code review 盯一眼；front matter 坏了不阻断写入但 `valid=false` 不生效，T-AS1 的 listSkills 断言可捕获。
- **seed 失败容忍的边界**：种入失败仅记日志——若 DDL 已建而 VFS 写失败属异常环境，下次启动重试（幂等语义天然支持）。
- **指路死链**：agent 的 tools 策略 deny `skill`、或用户禁用 agent-config 时指路不可达——预期行为（PRD 风险节已载），agent 工具功能不受损。
- **用户在 seed 前手动建了 global 同名技能**（升级前存量）：seed 跳过、用户版保留且受删除拦截保护，编辑也放行（目录已存在）——属预期边界
- **回滚**：seed 挂接点一行移除即停种（已种内容成为普通技能，仍受拦截保护可手动删——如需彻底回滚可临时改名单后走 UI 删除）；拦截与瘦身各自独立提交可单独 revert。
