---
date: 2026-09-05 21:55
title: agent 工具 create 裸 TypeError（Cannot read property 'trim' of undefined）根因与修复
keywords: agent 工具, create, validateAgentDefinition, name 必填, 毒行, 写入门禁
abstract: LLM 调 agent 工具 create 时 definition 缺顶层 name，registry.upsert 的 def.name.trim() 裸崩；validateAgentDefinition 只查 tools/model 两项，D5「宽松收包交服务层校验」的设计缺口。修复在 validateAgentDefinition 补 name/prompts 守卫 + wire 往返校验，杜绝裸 TypeError 与「写得进读不出」的毒行。
---

user:
agent 创建的时候一直报错 `Cannot read property 'trim' of undefined`，不知道问题在哪。附了一次完整的工具调用 JSON：action=create，definition 里有 description/mode/prompts（system + persist:[] + dynamic 数组 + workplace + customAttach + dynamicEnabled）/runtime.maxSteps，唯独没有顶层 name。

assistant:
根因定位：调用链是 agent 工具 create → upsertWithTranslatedError → AgentRegistryService.upsert。upsert 先跑 validateAgentDefinition——但它只校验 tools 策略和 model pin，name 和 prompts 一概不查；接着第 62 行 `def.name.trim()` 在 name 为 undefined 时直接抛 TypeError。工具层把它包成 FAILED「agent 定义保存未通过校验：Cannot read property 'trim' of undefined」，LLM 看不懂哪里错，就一直原样重试。

更深的结构性问题有两层：① D5 设计（工具 schema 宽松收包、字段校验全交 validateAgentDefinition）落空——校验器根本没承接这个职责；② 同类裸崩点不止 name 一处：definition 缺 prompts 会在 repository.upsert 的 definitionToDocument 里 `def.prompts.persist` 崩（T-AG3 测试只发 {name, mode} 能过是因为 fake registry 不走 encode）；prompts.dynamic 传成 wire 格式的 map 会 for..of 崩。还有毒行风险：写侧不校验、读侧 decode 严格（agentDefinitionDocumentSchema strict + schemaVersion literal + model uuid），写进形状错误的行会让以后每次 list()/get() 都炸，整个 agent 注册表不可读。

修复方案：validateAgentDefinition 补三道守卫（name 必填非空字符串 / prompts 必填对象 + validateAgentPromptLayout 校验 / description 类型守卫），再加 wire 往返（toWire → document schema decode）作为终极防线——写入门禁与读侧 schema 完全一致，任何形状错误在写入前以中文 zod 消息拒绝。工具 schema 的 definition 描述补「顶层必含 name」。

user:
修完了，验收结果如何？

assistant:
全部绿灯。validate-agent-definition 补了三道守卫 + wire 往返（toWire → 同一 schema decode，写入门禁与读门禁完全一致）；agent 工具 schema 描述同步注明「顶层必含 name」「persist/dynamic 为块数组」。过程中发现两个有价值的细节：① toWire（definitionToDocument）只投影已知字段，LLM 自创未知键会被静默洗掉不毒化，真正的毒化向量是 mode 非法枚举、model 非 UUID 这类原样透传字段（往返拦截）；② 既有工具测试全用 fake registry，upsert 不跑真校验也不跑真 encode，所以 D5 的校验缺口从未被测试覆盖过——本次在 agent-registry.service.test 补了真链路集成用例（拒收 + 不落盘 + list 仍可读），validate 单测覆盖 name/prompts/wire 格式/mode 枚举/model UUID/用户场景 payload 七种形态。core 全量 1803 测试通过；CLI agent-config e2e 有两个基线上就存在的环境性失败（Missing --session，stash 验证过与本次改动无关）。分支 fix/agent-tool-create-validation，AGENTS.md 过时的「代码检索用终端」规则也按用户要求移除（单独 docs 提交）。
