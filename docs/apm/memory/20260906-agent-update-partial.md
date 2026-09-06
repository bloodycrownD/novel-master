---
date: 2026-09-06 11:24
title: agent update 工具改部分更新语义（patch 替代全量覆盖）
keywords: agent 工具, update, 部分更新, patch, 浅合并, definition
abstract: 用户反馈 agent update 必须回写完整 definition 不方便，应改为「改什么字段填什么字段」的部分更新语义；调查现状（全量覆盖、get→改→回写 round-trip 设计）并出浅合并方案。
---

user:
agent 的 update 感觉不方便，应该是改什么字段填什么字段，不应该是完整覆盖吧。

assistant:
现状核实：agent-tool 的 update 分支要求 definition 完整体（requireDefinition），解析定位（name 优先/agentId）后直接 upsert 整体替换，无任何合并存量逻辑；头注释明写「get 的定义体不截断——它是 update 回写的数据源」，即设计上就是 get→改→全量回写 round-trip。痛点：改一个字段要 get 全量 + 回写全量，两轮 IO、token 双倍、LLM 抄大 JSON 易错漏。方案（待确认后实施）：update 的 definition 放宽为 patch——顶层浅合并（未提供的字段保留存量）、null 视为显式清除字段回缺省、prompts 子键级浅合并（只填要改的布局）；合并纯函数放 domain/agent/logic 可单测，合并后仍走 upsert 全量校验门禁（validateAgentDefinition + wire 往返不放松）；UI/CLI 路径不受影响（本就全量表单/import）。

user:
等等我想起一个问题，目前智能体没有对智能体名称做唯一校验，因为有 agentid 唯一，但现在有智能体编辑工具，还是通过 name，那我建议给智能体名称也加个 name 唯一键吧。

assistant:
（调查中）动机成立：update/list/task 按 name 定位，findAgentIdByName 遍历取首个匹配，重名 = 改错对象/派发歧义。调查 agent 存储结构（name 是否独立列，能否 DB 层 UNIQUE）、各写入路径（LLM 工具、desktop/mobile 表单、CLI import）是否都过 registry.upsert、虚拟 seed（general）重名面，再定服务层校验 vs DB 约束与存量重名处理。

user:
我觉得可以，这是合理的设计。

assistant:
实现落地（dev 分支提交见 git log）：(1) merge-agent-definition-patch.ts 纯函数——顶层浅合并（未填保留）、null 显式清除回缺省、prompts 子键合并（只填 persist 只换 persist）、改名同普通字段、非法形状透传交校验层拒；(2) agent-tool update 分支改为 registry.get 读现状→合并→upsert 全量校验门禁不放松，空 patch 拦 INVALID_ARGUMENT；(3) name 唯一确认早已存在（v1.4.21 assertUniqueDisplayName，排除自身/trim 归一/含内置 general 名，测试锁定）——用户不必担心；(4) 工具 schema 描述与 requireDefinition 文案按 patch 语义重写，模块头注释同步；(5) agent-config 技能 seed 文档改 patch 指引（注意 seed 幂等不覆盖存量库，旧库技能文档仍教整体覆盖——全量提交在新语义下仍兼容，只是次优）；顺带删了 seed 文档里过时的「下一会话生效」句。(6) 测试：merge 单测 8 条 + 工具层 4 条（含空 patch 拒绝）+ 真实 registry e2e 2 条（patch 保留字段可读回、改名撞名 DUPLICATE_NAME 转译 INVALID_ARGUMENT）——persist 块 fixture 需带 role，wire 往返会给块补 type:"text" 归一。core 1826 全绿、tsc 0 错、dist 已重建。CHANGELOG 补「AI 修改智能体改为按需提交」变更条。
