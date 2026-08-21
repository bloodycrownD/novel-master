---
date: 2026-08-21
dependency: [Iterations/agent-skills/prd.md, Iterations/protocol-merge-agent-tool-mermaid-sharp/prd.md]
---

# 内置 agent-config 技能与 agent 工具描述瘦身 PRD

## 背景

`agent` 工具已上线（`protocol-merge-agent-tool-mermaid-sharp`），但其配置面（`AgentDefinition.prompts` 的 system/persist/dynamic/workplace/customAttach/skills 等区段、runtime、tools 策略）细节很多，当前工具 description（约 600 字）只一行带过 `definition` 的字段——塞不下完整指南。硬塞则每轮请求全量携带、稀释模型注意力，且与 skill 系统"索引常驻、正文按需读取"的自身设计哲学矛盾。

调研结论（对话拍板）：

1. **内置一个 `agent-config` 技能**承载完整配置指南（三区布局详解、definition 字段类型与陷阱、典型配置示例），`agent` 工具 description 瘦身为一句话 + 指路「配置字段详情与示例请先 `skill load agent-config`」。
2. **种到用户目录（global 域），但不允许删除**——参考内置服务商（`builtin-providers` + `seed-builtin-providers` + `provider.service` delete 拦截）的先例。
3. **不做 agent 工具与技能索引的联动**（deny agent 工具时索引不隐藏）——保持简单，避免复杂化。

## 目标（含成功指标）

- 模型配置 agent 时能按需读到完整指南：`skill load agent-config` 返回完整正文
- `agent` 工具 description 缩减至 200 字以内（含名单），细节由技能承载
- `agent-config` 技能不可删除（服务层拦截 + UI 无删除入口），但可编辑（seed 不覆盖用户改动）
- 成功指标：全新环境首次启动后 global 域存在该技能且索引可见；用户编辑正文后重启不被覆盖；删除路径全部被拒

## 用户与场景

- 主 agent 在会话中需要创建/更新 agent 定义，按需加载配置指南
- 用户在技能管理界面看到内置的 `agent-config` 技能，可查看、可编辑正文，但无删除入口

## 范围

### 包含范围

- 内置技能 seed：`agent-config`（正文为完整 agent 配置指南，随包发布、幂等种入 global 域）
- `SkillService.deleteSkill` 对固定内置名的删除拦截（照内置服务商真实先例：UI 入口保留、服务层拦截、错误提示冒泡，双端零改动）
- `SkillService.writeSkillFile` 对内置名的**新建拦截**：禁止用户创建同名技能（global/project 两域），内置本体与历史已存在的同名副本仍可编辑；新错误信息一律中文
- `agent` 工具 description 瘦身 + 指路文案

### 不包含范围

- agent 工具与技能索引的联动（用户已拍板不做）
- 技能系统的其他内置化改造（本需求只内置这一个）
- project 域的内置技能（只种 global）

> 注：无需针对 agent 的 fs 工具做文件级防护——已核实 agent 的 `ctx.vfs` 是 session 域 scoped 实例（`run-agent-turn.ts` L457），fs 删除最终走 `ctx.vfs.delete()`（`fs-command.ts` L192），而 session 域物理前缀为 `/projects/{pid}/sessions/{sid}`（`vfs-path-mapper.ts` L101-107），与技能所在的 global-meta 域（物理 = 逻辑原样）永不相交——agent 工具链根本访问不到技能文件。

## 核心需求

1. **seed 内容单源**：内置技能正文定义为 core 常量（照 `BUILTIN_PROVIDER_ROWS` 模式），内容涵盖：AgentDefinition 完整字段说明（含 `workplace` 是字符串非布尔、persist 只收 text 块、worktree 块写出需 omit、skillsEnabled 联动摘 skill 工具等陷阱）、三区布局详解、create/update 典型示例（含完整 definition JSON）
2. **首次种入**：bootstrap 阶段检测 global 域 `/meta/skills/agent-config/SKILL.md` 不存在则写入（幂等：已存在则跳过、不覆盖用户改动——覆盖判定即“不覆盖”，见核心需求 5）
3. **删除拦截**：`SkillService.deleteSkill` 对内置技能名抛业务错误（照 `provider.service` 的 `BUILTIN_PROVIDER` 先例，错误码如 `BUILTIN_SKILL`）；UI 删除入口照真实先例保留，报错冒泡
4. **新建拦截**：`SkillService.writeSkillFile` 对内置名的新建抛业务错误（名字在内置名单且该域下技能目录不存在 = 新建；目录已存在 = 编辑内置本体或历史副本，放行）；错误信息中文
5. **description 瘦身**：`agent` 工具 description 保留一句话定位 + 动态名单 + action 一览（压缩），`definition` 字段描述改为指路技能；正文细节全部迁入技能
6. **front matter 合规**：seed 的 SKILL.md 带 `name: agent-config` 与描述（通过 skill schema 校验，索引正常显示）

## 验收标准

- Given 全新环境 When 首次启动 Then global 域存在 `agent-config` 技能，索引含其名称与描述
- Given 已存在（含用户编辑过）When 启动 Then seed 跳过不覆盖
- Given 模型调 `skill load agent-config` When 读取 Then 返回完整配置指南正文
- Given `agent` 工具 description When 组装 Then 长度显著缩减（≤200 字不含名单）且含指路文案
- Given 用户编辑该技能正文 When 重启 Then 编辑保留（seed 不覆盖）
- Given 调 `SkillService.deleteSkill("agent-config")`（global 域） When 执行 Then 抛业务错误，技能仍在
- Given 双端技能管理界面 When 删除内置技能 Then 入口保留，操作被服务层拒绝并 toast 中文提示（照内置服务商先例；批量删除混入内置技能时逐个报错停止，此前已删的保留）
- Given 新建技能 When 名字填 `agent-config`（任意域）Then 服务层拒绝并提示中文错误（名称为内置保留）
- Given 内置技能本体（global 域）When 编辑正文保存 Then 正常写入（拦截只限新建）
- Given 历史已存在的 project 域同名副本（升级前建的）When 编辑 Then 正常写入；When 新建已不可能（被拦）

## 风险

- **seed 正文质量**：指南写不好模型照样配错——正文需含足量示例；上线后按实际使用反馈迭代（编辑不覆盖机制保证用户/官方都可持续改进，官方迭代走 seed 内容更新 + 版本说明）
- **删除路径盘点（已核实闭合）**：①官方删除入口走 `SkillService.deleteSkill`——本需求拦截；②技能详情页文件管理器——SKILL.md 入口文件已有现有 UI 拦截（`SkillDetailScreen.tsx` L113），辅助文件开放属正常编辑能力；③agent 工具链——session 域隔离够不到 meta 域。无其他路径，不做额外兜底
- **`$` 引用与禁用**：内置技能可被用户禁用（走既有负清单）——禁用后 `skill load` 不可用，属预期行为；agent 工具本身不依赖该技能（仅描述指路），功能不受损

## 依赖与关联迭代

- `Iterations/agent-skills`：技能系统基础设施（两域模型、SkillService、负清单）
- `Iterations/protocol-merge-agent-tool-mermaid-sharp`：`agent` 工具本体（B 线）
- 内置服务商先例：`packages/core/src/domain/provider/logic/builtin-providers.ts`、`packages/core/src/bootstrap/provider/seed-builtin-providers.ts`、`packages/core/src/service/provider/impl/provider.service.ts` L212-220
