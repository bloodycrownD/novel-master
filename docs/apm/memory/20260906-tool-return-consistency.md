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

user:
这样 version 对 AI 就是完全不可见吧？我们完全移除了？

assistant:
确认：LLM 通道里 version 已完全不可见——写入类全部渲染 ok（vfs write/edit 的 ok 快速通道本来就有，本轮把 skill write/edit 和 agent create/update 也收进来）；读取类（read/skill read/load）的行号格式化从来不渲染 version 字段；工具描述（inputSchema describe）里也没有任何 version 字样。但 version 数据本身没删：结构化返回对象里还在（存进消息 JSON、UI 代码可消费），文件版本号继续单调递增，revision 历史/会话回滚/检查点恢复仍依赖 head_version 记账——移除的只是 LLM 可见性这一层展示。若未来要让 AI 操作「恢复到版本 N」，需要另开 revision 列表查询工具，与现状不冲突。

user:
version 目前只是版本管理对吧？无法移除？

assistant:
确认。移除乐观锁后 version 的剩余消费者全部是版本管理链条：vfs_revision 表按（entry, version）记历史、revision-aware 写入的统一分配器（max(head, MAX(rev))+1）与同文短路、会话回滚（message-rollback 经 resetHeadToVersion 把 live head 拨回检查点版本，不 append 不 bump）、restore-mutating-path-heads/entry-sequence-repair/integrity-repair/revision-ref-count 等修复与引用计数逻辑、vfs-tree-copy/batch-io 的跨 scope 版本对齐。理论上可换成 rowid/时间戳作 revision 主键，但要动 schema（SCHEMA_BOOT_VERSION bump + 迁移）且零用户收益——不值得，维持现状：version 是纯内部记账，AI 不可见。

user:
版本号用做回滚，算 hack 吗？还是算合理设计？

assistant:
定性：合理设计，且是经典模式——不可变历史 + 可移动 head 指针（event sourcing / MVCC / git 同构）。证据链：检查点快照存 entry_id→version 指针（「给历史状态命名」）；resetHeadToVersion 只拨指针不删历史（可再滚回来）；分配器 max(head, MAX(rev))+1 把版本号当永久身份而非计数器（回拨后新写跳过历史占号，正是 git「新提交不复用旧标识」的等价物）。hack 的特征一个没有：无历史改写、无跨用途滥用（不当时间戳/跨文件排序键用）、边界情况（回滚后再写）由设计而非补丁处理。诚实的弱点：回滚后版本号出现空洞（5→10），版本号不再等于「编辑次数」——但系统里已无任何地方承诺这个语义；跨文件一致性由检查点快照列表保证而非版本号比较。替代方案（rowid/内容哈希/时间戳）各有更差的权衡，显式版本号是最清晰的选择。

user:
是不是最好的优化是 version 改 string 类型，原始数据不动或加文件名前缀保证唯一，以后用 uuid——这样能跨文件比较，还不用迁移数据、不影响回滚？

assistant:
结论：不成立，核心收益是幻觉。uuid 给的是全局唯一性，不是可比性——随机字符串携带零排序信息，跨文件比较依然不可能（用户把「全局唯一」和「全局可比较」混淆了）。且方案四处破功：(1) 文件内严格全序是承重墙（回滚定位检查点版本、历史列表排序、max 分配器的防占号），version 目前就是这份免费的全序，uuid 替换后要另造时间戳/序列才能补回；(2) SQLite 类型亲和下 int/text 混存，ORDER BY 变成「所有旧数字 < 所有新字符串」+ 字符串字典序，语义脑裂，max() 对字符串无意义；(3) 文件名前缀破坏改名存活——模型注释明说 entry_id 做身份就是为了让历史 checkpoint 在改名后仍命中，名字入 version 身份等于自废这个设计；(4) 跨文件一致性本来就在检查点层用快照列表解决，不依赖版本号比较。若真需要全局编辑时间线（推测的真实需求），正确做法是加全局序列列或时间戳列——纯增量不动既有语义。维持现状。

user:
行吧，那进入 cr（code-review-loop skill，对 dev 分支三件套整体评审）

assistant:
CR 两轮收敛完成，fix-spec-ready。编排：R1 并行双 scope（reviewer×2，readonly）——core 侧 4 条（core/A-1 P1：withDefaultPromptLayouts 静默洗白非对象 prompts、core/C-1 P2：vfsConflict 半残留、core/C-2 P2：三处过时注释、core/G-1 P2：测试缺口）、apps 侧 4 条（apps/G-1 P0：mobile 契约测试锁已删的 expectedVersion 必红、apps/G-2 P0：两个 CLI e2e 仍 set 退役偏好必红、apps/C-1 P1：mobile version state 只写不读 parity 分叉、apps/A-1 P2：CHANGELOG 措辞窄）。主代理 grep 抽查两个 P0 属实后派 worker spec-fix 落盘 8 条；R2 review-full 逐条代码现场复核 8/8 实证、无新 P0/P1，建议 ready，附 4 处 spec 小修（两条路径勘误、MF-7 补幽灵实参、MF-1 编号撞名注明）——trivial 豁免主代理直接落。Closure：P0 2 / P1 2 / P2 4 全入 spec，open spec_deviation 1 条（readStdin 空输入防护待拍板）、open questions 4 条待用户。产出 docs/Iterations/dev-tool-fixes-20260906/cr-fix-spec.md。子代理代记：reviewer/worker 均 readonly 或单文件约束未记 apm，由主代理本轮代记。
