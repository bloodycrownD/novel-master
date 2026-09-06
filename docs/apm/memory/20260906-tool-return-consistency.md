---
date: 2026-09-06 11:35
title: 写工具返回值一致性审计（skill/agent/vfs 等写操作返回不统一）
keywords: 工具返回值, tool_result, skill 工具, agent 工具, vfs 工具, 写操作, 一致性
abstract: 用户质疑 skill 创建/编辑等写操作为何不返回简单 ok、不与文件编辑对齐，agent 工具同理；要求盘点全部写工具的返回结果并指出不统一之处。
---

user:
为什么 skill 的编辑/创建等操作不是返回简单的 ok？不和文件编辑对齐？同理 agent 编辑/创建工具。我需要你 check 当前所有的写工具操作，它们的返回结果都不统一？

assistant:
（盘点进行中——见后续轮次）

assistant:
审计完成，不统一实锤。渲染链路：工具 execute 返回结构化对象 → build-tool-result-block → formatToolOutputForLlm 决定 LLM/UI 看到的文本。该函数对 vfs write（仅 version 键）、vfs edit（version+replacements）、fs 变更类（ok:true）有「ok」快速通道，对 read/grep/glob/curl/fs-ls 有人类可读格式化，其余一律 JSON.stringify 缩进展开。结果：vfs 写返回 ok，fs 写返回 ok，但 skill write/edit 返回 {action,domain,name,path,version(,replacements)} 全量 JSON、agent create/update 返回 {action,name,agentId,message} 全量 JSON——同一语义（写入成功）三种观感。成因：vfs/fs 的 ok 快速通道是后来在 formatter 里加的形状持判，skill/agent 工具更晚接入且返回带 echo 字段，没人回头补 formatter。版本 echo 在乐观锁移除后已是纯噪声。另发现 bonus：skill load（无 totalLines/returnedLines，撞不上 isReadOutput）也掉进 JSON 展开，长技能全文被转义展开很浪费。修复方向（待用户拍板）：formatter 侧新增识别——action:"write"/"edit" 且带 version 的变更型输出渲染 ok，agent create/update 渲染 message 单行（下次会话生效的提示对模型有用）；不动工具返回结构，UI 卡片/测试不受影响。

user:
「定义已保存，将在下一次会话生效」对模型有什么用？这不是给用户看的吗？还有一点，agent/skill 配置为什么不是时时生效？

assistant:
验证结论：那句 copy 不但在错误的通道，而且是过时文案。真实时序：(1) task 派发时 subagent-tool 现调 agentRegistry.list()（line 182），同回合内刚创建的 agent 立即可派发；(2) runAgentTurn 每回合装配期做一次 allDefs 快照，供 task 的 description 候选名单与 agent 工具的快照提示用——唯一滞后的是「广而告之的名单」下一回合刷新，能力本身即时生效。技能同理：load/read 现读 DB，索引注入每回合预算一次。文案「下一次会话生效」源自 protocol-merge-agent-tool 迭代（spec B 项：降低 AI 写定义误解），当年语义或保守，现在已不实。修订方案：agent create/update 渲染纯 ok（删 AGENT_SAVED_MESSAGE，工具描述里的「保存后下一次会话生效」注记一并修正）；skill write/edit → ok；skill load → read 同款行号正文。

user:
这就对了，我理解写操作有个 ok 就够用了，读操作确实需要详细或者优化格式。按照你的建议来。

assistant:
落地（dev 分支，提交见 git log）：format-tool-output.ts 新增两道守卫——isMutationAckOutput（action:"write"/"edit" 带 version 且无 content，或 action:"create"/"update" 带 name+agentId 且无 content → 渲染 ok）与 isSkillLoadOutput（action:"load" 带 content+version → read 同款行号正文 + 附属文件清单尾注 + 截断时提示续读走 skill read；alreadyReferenced 短提示直接返回文本）。agent-tool.ts 删 AGENT_SAVED_MESSAGE 及 create/update 返回的 message 字段（outputSchema 判别联合同步删 message 分支——漏改会撞 ToolRunner 的 ZodError 包装「Tool failed: agent」，排查时先查 outputSchema）；描述注记改「定义保存后立即可用」（注意 T-AS3 描述瘦身预算 380 字符，长注记会超）。测试 +7（MUT-01/02、LOAD-01/02/03）、T-AG3 断言去 message，core 全量 1806 绿。
