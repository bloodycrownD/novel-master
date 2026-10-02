# 进度与裁决日志

## W1 校准波（已完成 2026-10-01，4/4 PASS）

| zone | 报告 | 发现 | 主代理验收 |
|---|---|---|---|
| core-tool | raw/w1-core-tool.md | P2×4 P3×16 | 抽查 2 项全实锤；A-14 空转改判 intentional（分阶段占位，见裁决 1） |
| mobile-chat-ui | raw/w1-mobile-chat-ui.md | P2×6 P3×19 | 抽查 1 项实锤且放大（裁决 2） |
| desktop-main | raw/w1-desktop-main.md | P1×2 P2×9 P3×16 | P1-1 四点核验全实锤（裁决 3） |
| core-chat | raw/w1-core-chat.md | P2×9 P3×11 | 抽查 1 项实锤且放大（裁决 4） |

**协议验收**：信封一行 4/4 零违规；报告 schema 合格；证据均带 file:line。W2 放量条件满足。

### 裁决记录（主代理实测复核，子代理结论修正/放大）

1. **A-14 闸门空转**（F-core-tool-3）：事实成立（三装配点 undefined + runner 无条件调 policy），但
   `run-agent-turn.ts:924` 与 `tool-runner.ts:98` 注释明写"分阶段占位、后续收紧"——分类应为
   intentional+遗留观察项（resourceQuota 零读取方、search filter 死路径仍可清理）。
2. **mobile 三死文件**（F-mobile-chat-ui-2/3/4 一族）：mobile 侧论断成立；主代理跨端扫描放大——
   `transcript-selectable-role` 与 `tool-turn-actions` 的 **desktop 副本同死**（双端成对删除）；
   `flush-run-ui` 的 desktop 副本是活的（conversation-abort-retain.ts 在用），只死 mobile 半边。
3. **云同步单例 rebootstrap 陈旧句柄**（F-desktop-main-1，P1）：四点核验属实。与 RULE 2026-09-30
   「派生缓存与库同寿命」同族（当时只收口了解压缓存池）——修复方案可照该条思路派生。
   P1-2（vfs-batch staging 递归删除无前缀校验）证据完整，防御缺失确认。
4. **subagent-tool 全表读**（core-chat top）：`subagent-tool.ts:219` 实锤；主代理扫描发现同族至少还有
   `run-agent-turn.ts:852/:1201`、`message.service.ts:293/:444`、`session.service.ts:374`（fork）——
   9 月底性能修复轮只治了部分调用点，**"全量 listBySession 残留"立为 W3 横切主题**（带名单直接派单）。

## W2 按域测绘（2026-10-01 放量，22 机位）

core 15 + mobile 4 + desktop 2 + cli/periph 1，见 PLAN.md 波次表。进行中。

### W5 归并裁决（主代理）

- **D-1（core-misc 上交）**：裁定支持 W1 既有裁决——`transcript-selectable-role` / `tool-turn-actions` 双端副本同死，处置=**成对删除**（并入 dead-backlog），不下沉 core；M-13 中这两对改写为删除项。其余 7 对按漂移度逐对定下沉/删除。
- **D-6（M-24 双簇命中）**：归属 synth-core-data（消息域病灶），core-misc 侧留指针不重复计条。W7 台账以 core-data 为准。

### W3/W4 增量裁决（收割中）

| zone | 发现 | 裁决 |
|---|---|---|
| xc-fullread | **P0×2** P1×4 P2×7 P3×3 | **P0-1 gemini 每 step 全量读（:587-588，主代理逐字封印）**：listAllSessionMessages 无 includeHidden 收窄、21 列含 raw_json，消费方只要 tool_use id/name——修法（专查或 memo+失效，同款失效范式已有）。**P0-2 :405 每 step 首行 session.list() 与 :506 visible-floor 双重全量读**——零风险改法：合并为一次（length 复用）。放大器：messageContentPool 4M 字符预算 < 10M 工作集 → 命中率 0.53、暖=冷。与用户历史报障（发完消息久才出字/大会话卡）同源 |
| xc-dup-ends | P1×1 P2×6 P3×4 | L0 真环修正 7→5（type 边+JSDoc 假边）；summarizeToolInput ×3 三行为（同调用三面不同渲染）；buildNewSkillDoc desktop 不加引号 YAML 造非法技能；修复包 3 文件清光静态环 |
| xc-proto | **P1×2** P2×3 P3×2 | 流中断重试正文重复**实跑证实**（W2 双源撞车→confirmed）；data: 无空格整流静默丢弃 |
| xc-txn | **P1×2** P2×13 P3×5 | copy 事务内全量解压；ZIP 导入 5000 文件单事务 |
| xc-cache-apps | **P1×2** P2×5 P3×10 | forgetSession 泄漏二次独立印证 |
| w4-cloudsync-pro | **P1×6** P2×9 P3×8 | busy 令牌泄漏与 mobile-runtime 独立撞车（置信升级） |
| w4-msgstore-pro | P2×4 P3×7 | 手动清理只清单侧 pending 标记 → 冷启动多跑一次全库 VACUUM |
| xc-sweep31 | **P1×1** P2×1 P3×12 | fix-settings-utf8.mjs 未接线地雷：跑一次即回滚 AgentEditorView 1381 行并 ENOENT 崩 |



### 已收割与裁决（W2 增量记录）

| zone | 发现 | 裁决 |
|---|---|---|
| mobile-nav | P2×11 P3×17 | RealPrompt 无路由参数取全局 scope——用户在会话 A 详情页看的是会话 B 的提示词，**标记 P1 候选**（用户可见错数据）；onSessionVfsSaved 路由参数塞函数违反仓库自定契约且零赋值（死参数） |
| core-service-vfs | **P1×2** P2×6 P3×9 | **P1-1 模板拉取漏清缓存：主代理实锤**（clearSessionPromptCaches 全仓仅两导入调用方；template-pull.service.ts 全文核过无清理；file_cache 无条件命中→workplace 前缀陈旧）——修法照导入三件套口径。P1-2 importRules/resetDefaults 无事务替换（deleteAll+逐条 insert，中途失败=表被清空且不可自愈）confirmed。F-03 流中断重试致正文重复 → 与 infra-proto F-1 撞车，转 W6 验证队列（P1 候选）。F-04 vfs-batch-io 不写 revision 行（过时注释+回滚 NOT_FOUND 面）confirmed |
| core-agent | **P1×1** P2×10 P3×12 | **P1 persist 重名块静默塌缩：主代理三步实锤**（toWire 后写胜折叠 schema.ts:222-229；唯一重名守卫 validateAgentPromptLayout 全仓仅 UI 表单路径 agent-editor-state.ts:590 调用；assertWritableAgentDefinitionShape 未调用它，decode 在折叠后结构上不可能发现）——LLM agent-tool 写路径丢块。P2：AgentSession.hideRange 三实现零生产调用方（死契约）；agent 域若干零消费导出 |
| core-infra-proto | **P1×1** P2×7 P3×15 | F-1 流中断重试致重复（suspected，与 service-vfs F-03 同源撞车→W6 验证，机制补强：streamRegistry.reset 仅成功 append 后）。F-2 abort 路径 tool_use 双 emit 违反 port 契约（confirmed，当前无可见影响）。F-3 abort 监听器泄漏逐 step 累积（confirmed）。**F-4 SSE 解析器硬编码 "data: " 带空格**——规范允许无空格形态，部分网关发 `data:{…}` 全部静默跳过、零解析不报错（confirmed，P2 但用户可感，值得提前修） |
| core-small | P2×3 P3×14 | F-6 file_cache clearDomain 四调用方（置位/导入/改规则）均不调度 blob GC——孤儿 blob 随改写单调增长（confirmed，好发现）。F-13 **RULE 压缩口径漂移：主代理裁决根因更深**——主仓 RULE 已含 2026-09-29 修正但**未提交**（git status 的 M docs/apm/RULE.md），worktree checkout 的是旧提交版所以读到旧文；代码正确、修正存在、**待用户提交 RULE**（勿在 worktree 里改）。另：visibleFloor 触发器每回合全量物化可见消息只为取条数（同款问题 hide-message.action 已治本过）——**并入"全量读"横切主题（第三处独立 sighting）** |
| mobile-runtime | **P1×3** P2×4 P3×11 | F-1 **提交进 HEAD 的编码损坏**：session-prompt-input.service.ts 含 178 个 U+FFFD（仅注释、行为无损），全仓扫描共 10 文件含 U+FFFD（sksp 三处疑为哨兵字符需甄别）——RULE「PS 管道毁编码」又一次实锤且已污染 main，修法=从父提交还原注释。F-2 forgetSession 零调用方：**主代理 grep 实锤**——删除会话链路漏挂，idleMessageViews/settledProjections/pendingChildParent 无界驻留 + 已删会话残留"已中断"徽标。F-3 云同步 pull 互斥泄漏：**主代理读码实锤**（acquire:317 → createCoordinator await:332 → try:338，中间抛错 release 永不执行 → busy 永久 +1 → 后台维护循环永久让路） |
| desktop-features | **P1×3** P2×7 P3×20 | F-1 **AgentDefinitionEditorForm 1048 行整文件死代码：主代理 grep 实锤**（全仓仅自身定义文件出现，零 import 含测试）——AgentEditorView 内联同款表单构成双源。F-2/F-3（skill-ui / AgentEditorView 相关）待 W6 验证 |
| mobile-web | P2×5 P3×10 | es2018 纪律被 @types/node 架空（类型层放行新 API，低端 WebView 运行时才炸）→ W3 横切"webview 兼容面"主题；webview-host 三个"真源"模块零消费 → 并入死导出普查 |
| core-skills | P2×5 P3×11 | top：技能 ZIP 预检无解压闸门（zip bomb 可打挂 renderer，W6 验证）。**RULE:29 文档债已由主代理修复**（expectedVersion 乐观锁旧文 → last-write-wins 现状，主仓未提交区）。测试缺口 backlog：skill-paths 等 7 个纯函数文件 core 侧无测试。W3 转交：desktop SkillDetailView 本地 SKILL_ENTRY_FILE + skill-ui 手拼 front matter → "双端重复实现"机位。信封超协议（多段补充说明）→ W3 派单收紧"只准一行" |
| desktop-core | **P1×3** P2×9 P3×6 | F-1 **X1 门禁失效（confirmed，代理实跑 eslint）**：renderer 直连 core 9 处违规（main 上 6 error）+ CI Lint continue-on-error 放行 + 专为绕行建的 shared/logic/events.ts 自身 2 符号零消费——修法零新增再导出即可全改走 @shared/logic/*。F-2 invoke 封装层 10 条端到端零消费（与 desktop-main 的"1 条缺封装"口径不同不矛盾，W3 出权威清单）。F-3 App.tsx 相关待 W6。ShellNavProvider 1014 行/46 context 成员单点状态源记为架构热点 |
| core-prompt | **P1×1**（**主代理降级 P2**）P2×4 P3×7 | normalizeAgentPromptLayoutDomain 白名单漏 skillsEnabled/skillsPrefix（字段丢失直读确认），但唯一消费链 resolveAgentDefinitionFromStorage 当前无生产调用方——**潜伏于公开 API 面，暂不可达**。系统性问题：白名单 normalize 第二次漏新增字段（上次 customAttach）→ 建议完整性守卫（exhaustiveness 断言）而非逐字段补 |
| core-bootstrap | P2×4 P3×12 | **F-1 三文件 import 环实锤（三条 import 引文核过）→ 撤回 madge 零循环 L0 结论**（别名未解析致假阴性）；修法=BUILTIN_SKILL_NAMES 下沉 domain，顺带断开 public→bootstrap 层依赖；现不炸仅因环上绑定都是函数体内使用 |
| core-infra-misc | **P1×1** P2×5 P3×10 | top：增量计数器「单次 encode ≤64 字符」不变量可被连续句末符打破（打在 RULE 性能护栏核心假设上）→ W6 验证队列（需构造反例实跑）。纪律注记：misc 正确未动他人探针 |
| cli-periph | **P1×2** P2×17 P3×14 | **双 tokenizer 驱动对称漂移**：RN 缺 node 的 cr-tok-1 修正、node 缺 RN 的 p50k 出界防护——修复建议两处下沉 core 统一（W6 验证）。F-13 rn 驱动"两行回滚"说明已过期（声明+预构建但全仓不装配）。F-26 cli 测试 glob 疑假绿（静态判断）。盲区：4 个 Kotlin 原生文件未审（W3 需另派机位）。33 条分 A-F 六组，6 条争议待 reduce |
| core-provider | **P1×1** P2×6 P3×16 | 删除守卫漏扫会话级 modelId 且 project 扫描已死（悬空引用风险）→ W6 验证 |
| core-infra-sql | **P1×3** P2×4 P3×9 | **top：sql-template AST 缓存无界，实测 2000 arity 吃 337MB**（代理构造实测，W6 复核口径）——`IN (...)` 动态绑定名每变体一份缓存永不逐出；另两条 P1 见报告。纪律注记：探针自清，worktree 卫生核过 |
| core-service-agent | P2×3 P3×10 | **反发现（对冲 W1 core-chat top）**：listSessionMessages 零消费者死契约；run-agent-turn 852/1201 两处全量读**非热路径**（一次性流程）——W3"全量读"横切须按热/冷分类，勿一刀切 |
| core-checkpoint | P2×3 P3×12 | **backfill 每轮发送 N+1 倒扫，同仓已有单查询 JOIN 替代**——接 RULE「回退全量是常态」条目，W3 热路径优化首选题材 |
| core-service-chat | **P1×1（潜伏）** P2×9 P3×10 | 第二条截断路径 `truncateMessagesAfter` 漏失效 prompt-token 与 toolUseCount 双缓存（兄弟路径都失效）——**IPC 已注册但 renderer 疑无调用方，严重度待 W3 IPC 双侧普查定级**。三处全量读确认且升级为能力缺口：fork 缺 `listBySessionUpToSeq` 上界读口、truncateAfter 空锚可用 `listIdsAfterSeq` 免解压、copy 的问题实为"写事务内全量读"不对称。workplace_dir_rule 缺口与 vfs/small 机位有重叠（reduce 时去重） |
| core-workplace | **P1×2** P2×5 P3×13 | top：filename 档与 (missing) 降级渲染把 1970 假时间戳写进提示词 → W6 验证 |


## L0b 确定性普查（2026-10-01 done，agent_677f4cfe）

- **死导出**：1317 确认 + 26 suspect + 580 仅测试消费（L0/dead-exports.md）——**W3 xc-dead-core 抽核大修正（2026-10-01）**：名称 grep 口径污染显著——core"仅测试"桶 127/356（35.7%）实为 barrel 转发的生产消费；core"确认死"617 中 173 条落在 allowlist 快照锁定的公开面。**core 真可删 ≈ 363 条**；apps 侧口径待 xc-dead-apps。删除前仍需逐批过 W6。
- **循环依赖（别名感知重扫）**：13 环（core 9 + mobile 4）——**W3 xc-dup-ends 复核修正：剔除 type 边与 JSDoc 假边后真环 5 个（core 3 + mobile 2），全部 runtime-safe**；修复包已给出（BUILTIN_SKILL_NAMES 下沉 + web/shared/post 抽共享，3 文件清光 core+mobile 静态环）。
- **IPC 断链 12 条**（L0/ipc-census.md，五层机器比对）——W3 权威清单落定。
- **覆盖矩阵**：未覆盖 88 文件 = core-vfs 57（在途机位）+ 31 其它（UNASSIGNED 散件 + android 2）——vfs 返回后复核，散件并入 W3 补扫。

## L0 备注

- ~~madge：core 静态 import 零循环~~ **撤回（2026-10-01）**：W2 bootstrap 机位实锤三文件环（skills.service:33 → seed-builtin-skills:24 → create-skills-service:9），madge 因 `@/` 别名未解析静默跳过这些边——"零循环"是工具假阴性。教训：确定性工具产物也要抽查 skipped/解析覆盖。W3 需别名感知解析器重跑循环普查。
- 待补：jest/node coverage 死码热图、knip 配置化死导出扫描（W3 前完成）。
