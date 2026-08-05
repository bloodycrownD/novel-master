# D3-1：交叉冲突矩阵

## 元信息
- 审阅文档：D1-01 ~ D1-11（11 份角度横扫）+ D2-vfs/chat-message/provider-llm/agent-tool/compaction/prompt（6 份切片）+ D2a-L1 ~ D2a-L11（11 份跨模块模式识别）
- dag_version: 5
- 回派轮次: 0（首次交叉）

## 冲突清单

### 冲突 #1 [真冲突] SKSP env 空串语义：spec 说放开，代码说收紧
- 角度对：L6（跨端） × L11（文档漂移）
- 模块：provider-llm
- L6 结论：SKSP env 覆盖是 intentional 的跨端差异
- L11 结论：`sksp/spec.md` L248 的空串语义比当前实现宽松——spec 写的是「空 env 不覆盖 DB」，实现做的是「空 env 覆盖 DB 但被代码收紧」
- L8 补充：当前安全行为全靠代码偏离 spec 在撑
- 矛盾点：**如果有人按 spec 改回代码（让空 env 遵循 spec 的放开语义），会直接变成不安全版本**。这是「文档说 A，代码做 B，B 比 A 更安全」的反向漂移。
- 处置：进 D3-2 债务登记表，严重度 S（反向危险——整改方向错了会更糟）。Phase 5 fix-spec 必须把 spec 和代码同步改成收紧语义，不能只改一边。

### 冲突 #2 [真冲突] vfs zip 校验三端深度不同：L6 说是端侧问题，D2-vfs 说是 core 兜底缺失
- 角度对：L6（跨端） × D2-vfs 切片
- L6 结论：vfs-zip 校验深度三端不同（CLI 不校验 / Desktop 查魔数 / Mobile 扫 EOCD），是端侧各自实现的差异
- D2-vfs 结论：S2——core 的 `vfs-zip-validate.ts` 是 import 路径上的校验，三端不一致的 `assertZipArchive` 是 export 前的预检，core 不救 export 那一段。同一个坏文件在三端的错误码、错误时机、错误消息全不一样
- 矛盾点：L6 把它定性为「端侧实现差异」（建议统一端侧），D2-vfs 把它定性为「core 兜底缺失」（建议 core 补统一校验）。两个方向的整改成本和效果完全不同。
- 处置：进 D3-2 债务登记表，严重度 A。D2-vfs 的「core 补兜底」方案更稳——因为端侧校验不可能完美同步，core 应该有最终防线。

### 冲突 #3 [伪冲突] sessionFs.rollbackToMessage 是否仅 mobile
- 角度对：L6（跨端） × D2-chat-message 切片
- L6 结论（D1-06 B-4）：`sessionFs.rollbackToMessage` 仅 mobile 暴露
- D2-chat-message 结论：实际三端都有入口（CLI `session/commands.ts:138`、desktop IPC `messages.ts:350` + renderer、mobile 薄壳）
- 矛盾点：L6 漏看了 CLI 和 desktop 的入口。
- 处置：判定伪冲突，依据：D2-chat-message 逐端 grep 了入口文件确认三端都有。D1-06 B-4 应更正为「三端均有」。**这是一条 lens 漏看，不是设计问题**。

### 冲突 #4 [伪冲突] setMessageFloorAtMessage 是否完全无测试
- 角度对：L7（测试） × D2-chat-message 切片
- L7 结论（D1-07）：`setMessageFloorAtMessage` 完全无测试
- D2-chat-message 结论：`test/chat/message-transcript-effects.test.ts` 有 5+ 个 it 块覆盖
- 矛盾点：L7 漏看了这个测试文件。
- 处置：判定伪冲突。但 L7 的核心判断仍然成立——这 5+ 个测试都是 happy path，**缺的是「中间步骤失败→验证半套状态」的回归测试**。应收敛为「缺 failure path 回归测试」而非「完全无测试」。

### 冲突 #5 [真冲突] bootstrap repairRefCounts 严重度：L5 说 C，D2-vfs 说 S
- 角度对：L5（并发） × D2-vfs 切片 × D2a-L5 跨模块
- L5 结论（D1-05）：bootstrap repairRefCounts 降级 C，依据是「floor 单调语义 + 后续会再跑」
- D2-vfs 结论：S1——repair 只在 `_entryIdMigrationJustApplied === true` 时触发，migration 是幂等的，第二次启动跳过。生产路径里 repair 实际只跑一次就再也不跑。
- D2a-L5 确认：被 D2-vfs S1 推翻，L5 的 C 级判定应升到 S
- 矛盾点：L5 降级的前提（「后续会再跑」）不成立——repair 是一次性的，ref_count 偏高会永久停留。
- 处置：进 D3-2 债务登记表，严重度升为 S。L5 的降级前提被推翻。

### 冲突 #6 [真冲突] prompt→chat 跨 context：L3 说灰色地带，D2-prompt 说是双路径
- 角度对：L3（架构） × D2-prompt 切片
- L3 结论（D1-03）：prompt→chat 是唯一实质跨 context 引用（normalize-for-llm-export.ts），需确认是否补 documented exception
- D2-prompt 结论：prompt→chat 有**双路径并存**——除了 normalize-for-llm-export.ts 的 shim 路径，还有直连路径。L3 只标了一条。
- 矛盾点：L3 漏看了第二条跨 context 路径。同时 D2-prompt 发现 L3 的「domain→service 0 violations」漏报了 `PromptRenderContext` 的 type-only 引用。
- 处置：进 D3-2 债务登记表，严重度 A。D2a-L3 已补充确认：type-only 跨 context 引用是 L3 方法论的盲区（只扫运行时 import，不扫 `import type`）。

### 冲突 #7 [真冲突] compaction-conditions 是算法热点还是架构热点
- 角度对：L2（算法） × Phase 0 代码地图
- Phase 0 结论：compaction-conditions（412 行/5 迭代）是算法复杂度重灾区
- L2 结论（D1-02）：纠偏——5 次迭代改的是 trigger 的组装层级（架构），不是算法本身。触发逻辑复杂度健康。
- D2-compaction 确认：L2 纠偏正确。算法层面健康，复杂度在架构组装层面。
- 矛盾点：Phase 0 的定性不准确——把架构 churn 误标为算法复杂度。
- 处置：判定为 Phase 0 定性偏差，已由 L2+D2-compaction 纠正。不进债务登记（这不是代码问题，是 Phase 0 的判断偏差，后续分析已正确采纳）。

### 冲突 #8 [真冲突] sub-agent × events DAG：当前安全 vs 即将不安全
- 角度对：L5（并发） × D2-agent-tool 切片
- L5 结论：sub-agent 用 `publishRunLifecycle:false` 不进 `agentActiveRefCount`，云同步/db-backup 的 `isAgentActive` 守卫对它失效
- D2-agent-tool 结论：A1——`events-reliability` 把「message.received 脱离门控」锁成 intentional 是基于「现有 sub-agent 用 `persistMessages:false`」；但 `agent-subagent` PRD（新立）的 task 工具明确是 `persistMessages:true, publishRunLifecycle:false`，**子 session 会触发父进程 events DAG**
- 矛盾点：L5 标的是「当前设计 intentional」，D2-agent-tool 标的是「即将到来的 PRD 会打破这个 intentional」。不是当前冲突，是**时间炸弹**。
- 处置：进 D3-2 债务登记表，严重度 A（即将爆发）。如果 agent-subagent PRD 进入实现，这条立即升 S。

### 冲突 #9 [真冲突] driver 包独立性：L3 说描述上可插拔，L10+D2a-L3 说从未被验证
- 角度对：L3（架构） × L10（基建） × D2a-L3（跨模块）
- L3 结论：driver 全部把 core 放 dependencies 而非 peer，独立性有问题
- L10 结论：8 个子包完全无 lint 无配置，独立性在基建层面从未被验证
- D2a-L3 补充：mobile 绕过 SKSP registry 直连（driver 装配都没遵守）、mobile 测试把 evaluator stub 成 undefined（driver 装配连测试都不覆盖）。driver 处于「描述上可插拔、实际硬编码、各自演化」的混乱中间态
- 矛盾点：三个角度从不同层面（包依赖图、基建、运行时装配）都指向同一个问题——driver 独立性是纸面上的。
- 处置：进 D3-2 债务登记表，严重度 S。D2a-L3 和 D2a-L10 都标了「必须合并裁决」。

## 回派清单

本轮无回派。所有冲突已基于 D1/D2/D2a 报告的充分信息判定——要么是真冲突（进债务登记），要么是伪冲突（已标注依据），要么是 Phase 0 定性偏差（已纠正）。没有「信息不足无法判定」的待补查项。

## 交叉观察（叙述式）

把 9 条冲突摊在一起看，浮现出三个系统性模式。

**第一个是「文档/规范 vs 实现」的系统性漂移**。这不是某个模块的偶发问题——冲突 #1（SKSP env）、#6（跨 context 双路径）、#7（Phase 0 定性偏差）都是同一模式的不同面。D2a-L11 把它量化了：PRD 定稿被推翻且无 supersede 注记跨 4 个模块 9 处。最危险的是冲突 #1 的反向漂移——当前安全行为靠代码偏离 spec 撑着，按 spec 整改反而会更不安全。这意味着整改文档漂移时，必须**先确认实现方向是正确的，再把 spec 对齐到实现**，绝不能反过来。

**第二个是「单角度的降级前提被切片推翻」**。冲突 #5（repairRefCounts 的 C→S）和 #4（setMessageFloor 的「无测试」→「有 happy path 但缺 failure path」）都是同一个模式：单角度横扫时基于某个前提做了降级判断，切片深入后推翻了那个前提。这说明 Phase 1 的横扫深度确实不够——横扫为了覆盖宽度牺牲了深度，Phase 2 切片补回了深度。三个阶段（横扫→切片→跨模块）的分层设计是对的。

**第三个是「时间炸弹」**。冲突 #8（sub-agent × events DAG）不是当前冲突，而是即将到来的。`agent-subagent` PRD 一旦进入实现就会立即触发。这说明 CR 不能只看当前状态，还要看 pending 的 PRD 是否会打破当前的设计平衡。建议把「pending PRD 影响评估」纳入未来 CR 的标准流程。

另外，冲突 #3 和 #4 是两条「伪冲突」——都是单角度漏看导致的误判（L6 漏看了 rollbackToMessage 三端入口、L7 漏看了 setMessageFloor 测试文件）。虽然最终结论是伪冲突，但它们揭示了横扫阶段的一个方法论局限：grep 的命中范围决定了能发现什么，漏 grep 一个目录就漏一个结论。这不是 reviewer 的疏忽，是单角度横扫的结构性局限——Phase 2 切片的模块级深入正好补了这个缺口。
