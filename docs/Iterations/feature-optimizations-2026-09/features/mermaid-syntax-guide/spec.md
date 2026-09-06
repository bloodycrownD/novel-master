---
date: 2026-09-06
---

# mermaid 语法红线并入 agent 配置指南技术规格（SPEC）

需求来源：`docs/Iterations/feature-optimizations-2026-09/prd.md`（迭代总纲「文档与技能增强」项；无独立 feature PRD）

## 设计目标

把实测修正后的 mermaid sequence 语法红线清单写进内置技能 `agent-config` 的正文，作为用户配置写作 agent 提示词时的权威参考；不新增机制，仅内容更新 + 种子版本推进。

## 总体方案

改 `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` 的 `AGENT_CONFIG_SKILL_MD` 模板字符串（新增一章）+ `AGENT_CONFIG_SEED_VERSION` 3→4。种子机制现状（探索证据）：

- 正文是 seed 文件内联 TS 模板字符串（不是外部文件）；技能落库存 VFS `global:meta` 域 `/meta/skills/agent-config/SKILL.md`。
- **版本台账语义（无内容比对）**：`seedBuiltinSkills` 读 kkv 台账（module `nm-seeds`, key `agent-config`），台账 ≥ 当前版早退（用户本地编辑保留）；版本落后则**无条件重种覆盖**（含用户改过的正文——`c7e53a24` 有用户拍板背书：内置保留名技能是官方资产，想定制的复制成新技能）。因此 3→4 后所有 v1.5.12+ 装机（台账=3）与更老装机（无台账行）都会拿到新正文。
- 种子挂在 bootstrap 事务之后的公共出口，**不受 SCHEMA_BOOT_VERSION gate 影响，无需 bump schema**（`c765e8c1` commit 有论证先例）。
- 运行时触达：技能索引每回合只注入「名称 + description」，正文靠 agent 主动 `skill load`——本需求的使用叙事是**文档参考**（用户把清单贴进写作 agent 的 prompts 配置），不是「并入即自动生效」；spec 与验收都按此口径。

## 定稿文案（八条，嵌入正文的新章节）

章节标题：`## mermaid sequence 图语法红线（内置 mermaid 11 实测）`

正文条目（照抄，实现时逐字嵌入）：

1. 首行必须是图类型声明（sequenceDiagram / flowchart TD 等），绝不能漏——漏首行是渲染失败的头号元凶。
2. 消息分隔符只能用半角冒号「: 」——绝对不要用全角冒号「：」，全角冒号会直接解析失败。
3. 消息正文里禁止半角分号「;」（会被当成语句分隔符截断整条消息）；正文里的半角冒号无害（如时间 12:30）。
4. rect / opt / loop / par / alt / critical 每个块必须以 end 收尾，一层层配对——缺 end 是「看起来不支持 loop/opt/par」的真正原因。
5. 行内换行写 <br/>，不要写 \n（会原样显示两个字符）；participant 显示名与 Note 里也可用 <br/>。
6. autonumber 位置随意（participant 前后、图中段都行）；事件编号方便用户说「第 N 条怎么改」。
7. 英文引号、中文引号都能用；Note over 没出场过的角色也合法（会自动补为演员）。
8. rect 里嵌套 loop/opt 在本应用没问题（内置 mermaid 11 支持）；仅当图还要贴去 Typora、mermaid-cli 8.x 等旧渲染器时才需要避免嵌套。

明确排除（不得出现在正文中，已证伪）：「语类前缀一律用全角冒号」「Note over 只能写已声明的 participant 别名」「autonumber 必须紧随首行」。

## 变更点清单

| 文件 | 改动 |
|---|---|
| `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` | `AGENT_CONFIG_SKILL_MD` 增章节（定稿文案照抄）；`AGENT_CONFIG_SEED_VERSION` 3→4 |
| `packages/core/test/bootstrap/seed-builtin-skills.test.ts` | 增内容存在性断言（T-SG1）；保留「agent 配置指南」锚串（既有两处 oldString 测试依赖） |
| `CHANGELOG.md` | Unreleased 技能/文档增强条目（升级后用户可见，按 #28 记） |

不改：front matter `description`（避免每回合技能索引 token 增加）、`BUILTIN_SKILL_NAMES`、SkillsService、任何 UI/CLI。

## 详细实现步骤

- Step 1 — phase-mermaid-seed — blocking: yes — qa: auto：seed 正文新增章节（模板字符串约束：全文避开反引号与 `${`，无代码围栏；第 5 条文案中的 \n 是「字面两字符」，TS 模板字符串里须写成 \\n，逐字照抄单反斜杠会变成真实换行）+ `AGENT_CONFIG_SEED_VERSION` 3→4 + 测试断言；`npm test -w @novel-master/core` 全绿。
- Step 2 — phase-mermaid-docs — blocking: no — qa: auto：`npm run build -w @novel-master/core` 重建 dist（mobile 经 metro 消费）；CHANGELOG 条目。
- Step 3 — phase-mermaid-verify — blocking: no — qa: manual_user：真机从 v1.5.12 库升级后启动，`agent-config` 技能正文含新章节（3→4 是版本化种子首次在真实存量装机走重种分支，值得真机验证一次）。

## 测试策略

- T-SG1 — blocking: yes — 正文断言：`AGENT_CONFIG_SKILL_MD` 含「语法红线」「半角冒号」「必须以 end 收尾」「<br/>」「原样显示两个字符」关键串；不含「一律用全角冒号」「只能写已声明的 participant」。
- T-SG2 — blocking: yes — 既有 seed 四用例（首种/稳态早退/版本落后重种/台账当前版早退）保持绿（锚串「agent 配置指南」保留）。
- T-SG3 — manual_user — 真机升级后技能正文更新验证（Step 3）。

## 风险与回滚方案

- 风险：3→4 重种会覆盖用户对内置 `agent-config` 的本地修改——机制设计如此且有拍板背书；CHANGELOG 条目附一句「如需定制请复制为新技能」提示。
- 风险：模板字符串误用反引号/`${` 导致编译错 → T-SG1 前置在 core 测试即拦截。
- 回滚：单文件内容变更，revert seed 文件 + 版本号回 3 即回退（台账已写 4 的装机回退后会在下次启动重种回旧正文）。
