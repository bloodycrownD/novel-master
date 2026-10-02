---
zone: w9-agentmisc-adv
agent: 辩护人（defender，对抗对）
files_scanned: 51 个生产文件 / 3827 行（domain 下 9 域全量）
scanned_paths:
  - packages/core/src/domain/agent/**（15 文件 / 约 1000 行）
  - packages/core/src/domain/session-run-state/**（3 文件）
  - packages/core/src/domain/character-card/**（10 文件）
  - packages/core/src/domain/depth/**（3 文件）
  - packages/core/src/domain/events/**（1 文件）
  - packages/core/src/domain/feature-flags/**（1 文件）
  - packages/core/src/domain/kkv/**（4 文件）
  - packages/core/src/domain/smart-sort-rule/**（10 文件）
  - packages/core/src/domain/compaction-conditions/**（7 文件）
---

# W9 对抗机位报告 —— agentmisc-adv（辩护人）

> 机位立场：为这九个域的设计合理性辩护（doom-loop 检测、run 状态三态折叠、KkvReaderPort 最小接口等），
> 同时诚实列出「让步清单」——即辩护人自己也承认站不住或需要文档/小修的部分。
> 独立性声明：本报告未读 `raw/` 任何其他报告、未读 `synth/` 任何内容，所有结论来自本机实读代码 + RULE/迭代文档。

## 摘要（≤150 字）

这九个域是 core 的「运行时外壳与纯逻辑层」：agent（定义/工具策略/doom-loop 检测/会话端口）、
session-run-state（run 状态持久化）、character-card（角色卡导入解析与体积闸门）、depth（尾深度与压缩锚定）、
events（进程内事件总线类型）、feature-flags（VFS 统一 tool turn 开关）、kkv（键值存储端口）、
smart-sort-rule（智能排序规则编译/匹配/导入导出）、compaction-conditions（压缩触发器）。
整体是「纯函数多、状态少」的形态，重心在可测性与写入门禁。

## 职责与边界

- **agent 域**：`AgentDefinition` 的 wire↔域格式转换与校验（strict zod）、tool allow/deny 策略与递归硬过滤、
  doom-loop 检测（层内重复 + 跨轮交替）、`AgentSession` 端口（list/append/hideRange/truncate）。
  边界：不碰 LLM 协议、不碰 DB schema，落库由 repository 适配。
- **session-run-state 域**：`session_run_state` 单行模型 + 仓储，只回答「该会话是否还有活着的 run」及最近一次
  metrics 投影。终态子类型由 runtime 内存状态机负责。
- **character-card 域**：PNG/JSON 角色卡 → md 树 → VFS 导入前的路径/体积/条目三闸，含 SillyTavern 兼容解析。
- **depth 域**：尾深度索引（0=最新）、depth slice 匹配、压缩隐藏范围锚定。
- **events 域**：进程内事件总线的内建事件名与 payload 类型（纯类型，无实现）。
- **feature-flags 域**：VFS 统一 tool turn 开关（配置 + 环境变量紧急关）。
- **kkv 域**：键值存储的 domain 最小端口（`KkvReaderPort`）与 core 内部仓储（`KkvRepository`）。
- **smart-sort-rule 域**：排序规则的草稿校验、正则编译、编辑器测试匹配、高亮切分、YAML 包导入导出。
- **compaction-conditions 域**：压缩触发器策略（token 比例 / 可见条数 floor，OR 合成），压缩条件文档模型。

## 对外接口（导出的关键符号/类型）

- agent：`agentDefinitionSchema`（含 `toWire`）、`validateAgentDefinition`、`mergeAgentDefinitionPatch`、
  `validateAgentToolPolicy`、`resolveAgentToolRegistry`、`resolveSavedModelId`/`resolveSummarySavedModelId`、
  `generateAgentRunId`、`AgentSession`（端口）、`InMemoryAgentSession`、`SqliteAgentDefinitionRepository`。
- doom-loop：`DOOM_LOOP_THRESHOLD`=3、`CROSS_ROUND_WINDOW`=4、`assertNoDoomLoop`/`assertNoDoomLoopInBlocks`/
  `assertNoCrossRoundDoomLoop`。
- session-run-state：`SessionRunStatus`=`starting|running|settled`、`StreamTokenSource`(`usage|heuristic`)、
  `SessionRunState`、`SessionRunStateRepository`（端口）。
- kkv：`KkvReaderPort`（get/set/delete 三方法）、`KkvRepository`（listKeys/get/set/delete）、`KkvEntry`。
- smart-sort-rule：`isFlagsValid`/`assertFlagsValid`（flags 单源）、`validateSmartSortRuleDraft`、
  `compileSmartSortRule`、`matchSmartSortPattern`、`splitSmartSortHighlightSegments`、
  `parsePatternInput`/`formatPatternInput`、`encode/decodeSmartSortRuleBundle`。
- character-card：`characterCardJsonToMdTree`/`normalizedCardToMdTree`、`parseCharacterCardJsonText/Bytes`、
  `extractPngCharaBase64/JsonText`、`validateMdTreeForImport`、`validateMdTreeLimits`、`sanitizeEntryFilename`、
  `utf8ByteLength` 及四个体积闸门常量。
- depth：`matchDepth`/`validateDepthSlice`/`messageIdsInSlice`、`depthFromTailIndex`/`depthByMessageId`、
  `resolveHideMessageRange`。
- compaction-conditions：`CompactionConditionTrigger`（端口）、`TokenRatioConditionTrigger`、
  `VisibleFloorTrigger`、`CompositeConditionTrigger`、`DEFAULT_HEURISTIC_SAFETY_FACTOR`=0.85、`CompactionConditions`(v4)。
- feature-flags：`isUserVfsUnifiedToolTurnEnabled`、`refreshUserVfsUnifiedToolTurnSnapshot`、
  `resetUserVfsUnifiedToolTurnSnapshotForTests`、`DEFAULT_USER_VFS_UNIFIED_TOOL_TURN`=true。

## 数据访问（触碰的表 / KKV 域 / 文件路径，带 file:line）

- 表 `session_run_state`（单行/会话）：`get`/`upsert`(UPSERT)/`listByStatuses`/`deleteBySession`/`deleteByProject`
  —— `domain/session-run-state/repositories/impl/sqlite-session-run-state.repository.ts:61,78,110,138,148`；
  DDL 及 `status CHECK IN ('starting','running','settled')` —— `bootstrap/session-run-state/session-run-state-schema.ts:16-33`。
- 表 `agent_definition`：CRUD + `getRawWire` —— `domain/agent/repositories/impl/sqlite-agent-definition.repository.ts:33,43,57,70,80,100,109`。
- 表 `kkv_entry`（module/key）：listKeys/get/set/delete —— `domain/kkv/repositories/impl/sqlite-kkv.repository.ts:33,43,57,67`。
- 表 `smart_sort_rule`：listOrdered/find/insert/update/delete/deleteAll/nextSortOrder
  —— `domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts:49,61,75,101,129,138,147`。
- KKV module `nm-model-suggestions`：经 `KkvReaderPort` 读/写 —— `domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:16,96,107,121`。
- 角色卡体积闸门常量：输入 48MB / 单文件 8MB / 总量 32MB / 条目 5000 / 压缩侧 blob 闸门 = 单文件/4
  —— `domain/character-card/logic/character-card-limits.ts:16,19,22,25,36`。
- 本域不直接触碰 `session_kkv`（rule_snapshot/file_cache）与 session VFS 文件内容；它读 `AgentSession` 端口。

## 依赖关系（import 了谁；被谁消费）

- **被谁消费（本域是下游）**：
  - `service/agent/impl/agent-runner.ts`：消费 doom-loop（`:15-16,789-800`）、agent definition schema、
    tool registry 过滤、saved-model 解析。
  - `service/session-run-state/*` + `apps/mobile/src/services/session-stream-unit-manager.service.ts`：消费 run-state 端口
    （`listByStatuses(['starting','running'])` 水合 interrupted；`['settled']` 回填上次生成）。
  - `service/compaction-conditions/*` + runner：消费 compaction trigger 端口与 TokenRatio/VisibleFloor。
  - `domain/provider/repositories/impl/kkv-model-suggestion.repository.ts`：消费 `KkvReaderPort`。
  - 双端 UI（mobile/desktop via IPC）：消费 smart-sort 匹配/切分、character-card 导入、事件总线类型。
- **import 了谁（上游）**：
  - 基础设施：`infra/tdbc`(SqlTemplateParser/模板)、`infra/serialization`(decode/encode/stringify)、
    `infra/tokenizer`(resolveCurrentPromptTokens/TokenizerOverride)、`infra/random-uuid`。
  - 跨域类型：`domain/chat`(ChatMessage/content-block)、`domain/prompt`(AgentPromptLayout)、
    `domain/vfs`(逻辑路径断言/ZIP 限长)、`domain/tool/builtin/vfs-tools`(FILE_TOOL_NAMES/名称归一)、
    `domain/workplace/logic/smart-sort`(排序元组/中文数字)。
  - 错误类型：`errors/agent-runtime-errors`、`errors/agent-config-errors`、`errors/character-card-errors`、
    `errors/smart-sort-rule-errors`、`errors/kkv-errors`。

---

## 发现清单

> 每条标注：【辩护】= 为设计辩护；【让步】= 辩护人承认的问题/缺口。
> 置信：confirmed（代码实锤）/ suspected / intentional（规则或迭代文档写明是故意设计）。

### 一、辩护理由清单

#### F-w9-agentmisc-adv-1 | 【辩护】 | doom-loop 双层检测：层内重复 + 跨轮 A-B-A-B 交替
- 优先级：P3（正面认定）
- 位置：`domain/agent/logic/doom-loop.ts:38-95`；接入 `service/agent/impl/agent-runner.ts:789-800`
- 引文：
  ```
  const tail = toolUses.slice(-threshold);          // doom-loop.ts:46
  if (tail.every((toolUse, idx) => sameToolUse(idx % 2 === 0 ? a1 : b1, toolUse)))  // :91
  ```
- 描述：检测分两层——① `assertNoDoomLoopInBlocks` 检测同一 assistant 消息内连续 N 次相同
  `name+input` 的 tool_use；② `assertNoCrossRoundDoomLoop` 检测最近 `CROSS_ROUND_WINDOW`=4 次里
  A-B-A-B 交替（两个工具来回刷）。runner 维护一个 `window*4` 的滚动缓冲并每次 push 后检查。
- 辩护理由：
  1. **阈值 3 而非 2 是刻意的**——「连续两次相同调用」在真实编辑/读取场景是合法的（读一次改一次），
     阈太低会误杀；3 次完全相同且中间无任何变化几乎必然是死循环。方向是「宁可漏判不误杀」。
  2. **跨轮用 A-B-A-B（window≥4、且必须是偶数）而非单纯「最近 N 次只有两种调用」**——
     只有交替形态才算死循环；A-A-A-A 由层内检测管，窗口错开避免两层重复误报。
  3. 纯函数、无状态、无副作用、单测直给（`test/agent/doom-loop.test.ts` 7 例，含边界：
     2 次相同放行、3 次不同放行、`threshold:2`/`window:6` 配置生效）。
- 建议：维持。检测作为「最后兜底」而非主要防护（token 预算/超时是主防线），定位正确。
- 置信：confirmed

#### F-w9-agentmisc-adv-2 | 【辩护】 | doom-loop 判等用 JSON.stringify 虽对键序敏感，但方向安全（可接受）
- 优先级：P3
- 位置：`doom-loop.ts:27-32`
- 引文：`return JSON.stringify(a) === JSON.stringify(b);`
- 描述：两 tool_use 的 `input` 用 `JSON.stringify` 直接比对，对 key 顺序敏感
  （`{"a":1,"b":2}` vs `{"b":2,"a":1}` 判为不同）。
- 辩护理由：键序不同但语义相同的调用本质上是「模型在重试」，判为不同只会**漏判**（不触发），
  不会**误杀**合法调用——这是安全的方向。真实 doom-loop 是模型重复生成完全相同的 JSON 文本，
  键序天然稳定。**故意不引入深比较/规范化排序**是有意的复杂度取舍。
- 建议：不改（若要更严谨可加键序规范化，但收益低、增复杂度）。
- 置信：intentional（方向安全性为辩护立场）

#### F-w9-agentmisc-adv-3 | 【辩护】 | run 状态三态折叠（starting/running/settled）：信息在正确层被保留
- 优先级：P3（正面认定）
- 位置：`domain/session-run-state/model/session-run-state.ts:7-13`；
  DDL `bootstrap/session-run-state/session-run-state-schema.ts:20`；
  settle `service/session-run-state/impl/session-run-state.service.ts:31-39`；
  runtime 侧 `apps/mobile/src/services/session-stream-unit.ts:478` `settle('finished'|'failed')`
- 引文：
  ```
  // model: interrupted/finished/failed 在持久层统一存为 `settled`
  export type SessionRunStatus = "starting" | "running" | "settled";   // :13
  ```
- 辩护理由：
  1. **持久层真正需要的只有一个判定**：「重启后这个会话还有没有活着的 run」。水合时
     `listByStatuses(['starting','running'])` 批量造 interrupted 单元、`['settled']` 批量回填
     「上次生成」metrics 投影——终态子类型对持久层无消费方。
  2. **终态子类型只在进程内有意义**——UI 转圈/通知/保活依赖它，但它由 runtime 内存状态机
     （mobile `session-stream-unit.ts` 的 `settle('finished'|'failed')`）持有；跨重启没有在飞的 run
     需要区分，持久化它就是死数据。折叠=不丢信息，是分层正确而非信息丢失。
  3. **DDL CHECK 约束强制只有 3 值**——`status TEXT NOT NULL CHECK (status IN (...))`，
     从 schema 层杜绝第 4 个陈旧终态值写入。
  4. **settle 时清 partial、保留 metrics**——`settle()` 置 `partialText/partialThinking/
     pendingChildrenJson = null` 但保留 `textChars/completionTokens/tokenSource`，
     使「上次生成」跨重启可读，无需第二张表。
  5. **写路径单语句 UPSERT 天然原子**——port 注释明确「不进事务、不做 CoordinatedWrite，
     规避 tdbc 嵌套事务铁律」（`session-run-state.port.ts:16-17`），与 RULE 的 tdbc 铁律一致。
- 建议：维持折叠。这是本区域设计最扎实的一处。
- 置信：confirmed（设计文档与消费侧一致）

#### F-w9-agentmisc-adv-4 | 【辩护】 | KkvReaderPort「最小接口」= 接口隔离（ISP），且刻意收窄非空返回
- 优先级：P3（正面认定）
- 位置：`domain/kkv/ports/kkv-reader.port.ts:8-12`；唯一消费方
  `domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:37,107`
- 引文：
  ```
  export interface KkvReaderPort {
    get(module: string, key: string): Promise<string>;   // 非 nullable
    set(...); delete(...);
  }
  ```
- 辩护理由：
  1. **确为最小**——只有 get/set/delete 三方法（对比 core 内部 `KkvRepository` 多一个 `listKeys`）。
     唯一的 domain 消费方 `kkv-model-suggestion.repository` 只用这三者，从不 listKeys。
     最小端口防止 domain 层依赖用不到的能力（ISP），也让测试替身只需实现 3 个方法。
  2. **get 返回 `Promise<string>`（非 `string|null`）是刻意的**——契约是「缺失 key 抛类型化
     `KkvError(NOT_FOUND)`」。唯一消费方 `readCache`（:107-114）确实 `catch (isKkvError NOT_FOUND)
     → emptyCache()`、`deleteByProvider`（:96-102）同样。这样 domain 侧不必层层 `?? null` 传播，
     把「缺失」显式化为一个可被 `isKkvError` 精确捕获的类型化错误。
  3. 与 core 内部 `KkvRepository.get → KkvEntry|null` 的差异是**分层刻意的**（内部仓储面向 SQL 行、
     面向 nullable；domain 端口面向业务语义、面向类型化错误），非随意。
- 建议：维持最小形态；见让步清单 D-5（该非空/抛错契约在端口文件里缺一行文档）。
- 置信：confirmed

#### F-w9-agentmisc-adv-5 | 【辩护】 | feature flag「VFS 统一 tool turn」四级优先级 + 环境变量只认「0」
- 优先级：P3（正面认定）
- 位置：`domain/feature-flags/user-vfs-unified-tool-turn.ts:30-35`
- 引文：
  ```
  if (configured !== undefined) return configured;
  if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;   // :32
  ```
- 辩护理由：
  1. 默认开启（DEFAULT=true），环境变量仅作「运维紧急关闭」且**只认 "0"**——不可能误把已关闭的功能
     打开（env 只能往「关」的方向作用），单向安全阀是刻意设计。
  2. 优先级链（显式 configured → env=0 → preferenceSnapshot → 默认）清晰，
     供宿主 PersistentPreferences + runtime `refreshUserVfsUnifiedToolTurnSnapshot` 驱动。
  3. 提供 `resetUserVfsUnifiedToolTurnSnapshotForTests()` 模拟冷启动——模块级 snapshot 状态有对应的
     测试复位口，不靠测试顺序侥幸。
- 建议：维持。
- 置信：intentional（模块头注释即写明用途）

#### F-w9-agentmisc-adv-6 | 【辩护】 | compaction TokenRatio 触发的「估算档下调阈值」方向安全、且不阻塞 run
- 优先级：P3（正面认定）
- 位置：`domain/compaction-conditions/triggers/token-ratio.trigger.ts:81-92`
- 引文：
  ```
  const safetyFactor = counterKind === "heuristic" || estimated
    ? this.options.heuristicSafetyFactor ?? DEFAULT_HEURISTIC_SAFETY_FACTOR : 1;   // :85-88
  ```
- 辩护理由：
  1. **heuristic 计数容易低估 → 阈值乘 0.85 让压缩提前**，方向安全：宁可早压缩（消息只是被 hidden、
     不删除、可回滚/置位恢复），也不要冲破上下文窗口。safetyFactor 只在计数不精确时生效，
     精确档系数=1 不打折。
  2. **`preferEstimate: true`**（`:71-78` 注释）——压缩判定**绝不**为本地计数阻塞 run
     （glm 大上下文单次 ~5.8s，切模型/回滚后首个 step 会踩），无统计可用时直接 heuristic 折算。
     把「性能」与「判定正确性」解耦，方向同样是保守早触发。
  3. 与 RULE.md「压缩」条目的定稿口径一致（压缩是 UPDATE hidden、不删行），所以「早压缩」可逆。
- 建议：维持。
- 置信：intentional（代码注释 + RULE 一致）

#### F-w9-agentmisc-adv-7 | 【辩护】 | smart-sort flags/captureKind 单源 + 正则捕获组计数用 `pattern+"|"` 探针
- 优先级：P3（正面认定）
- 位置：`domain/smart-sort-rule/model/smart-sort-rule.schema.ts:38-65`（isFlagsValid/assertFlagsValid）；
  `logic/compile-smart-sort-rule.ts:27-38`（countCaptureGroups）
- 引文：
  ```
  const probe = new RegExp(`${pattern}|`, flags);   // :29
  return match.length - 1;                            // :34
  ```
- 辩护理由：
  1. **flags 单源**——`isFlagsValid` 纯谓词（C-4）被 schema 层与 logic 层（parse-pattern-input）共用，
     杜绝平行实现；且与表 CHECK `flags NOT GLOB '*[^gimsuy]*'` 口径对齐（重复约束超出 SQL 能力，
     由应用层 `.refine` 守）。
  2. **countCaptureGroups 的 `pattern+"|"` 探针**很巧：追加一个顶层空可选分支让 `exec("")` 恒成功，
     于是 `match.length - 1` 就是捕获组数，**无论 pattern 本身能否匹配空串**——避免了对空串匹配
     语义的误判，比手工数 `(` 稳健得多（能正确处理嵌套/转义/字符类里的括号）。
  3. `captureKind` 三档值域单源 `SMART_SORT_CAPTURE_KINDS`，schema/IO/repository 三处复用。
- 建议：维持。
- 置信：confirmed

#### F-w9-agentmisc-adv-8 | 【辩护】 | smart-sort 高亮切分用 matchAll 原生 offset，规避重复文本漂移
- 优先级：P3（正面认定）
- 位置：`logic/split-smart-sort-highlight-segments.ts:41-60`；配套 `match-smart-sort-pattern.ts:99-113`
- 引文：`cursor = Math.max(cursor, m.index + m.text.length);   // :54`
- 辩护理由：
  1. 双端（desktop/mobile）曾各带一份同构的本地切分实现，现统一到 core 单源（历史 C-1 修复）。
  2. **用 `matchAll` 的原生 `index` 而非 `indexOf` 重查**——重复匹配文本（如多个「第1章」）不会让
     切分漂移；`Math.max` 保证零宽匹配不倒退游标、不会产生空匹配段。
  3. `matchSmartSortPattern` 对非 global flags 克隆并追加 `g` 再 `matchAll`（:99-100），
     不污染原 regex 的 `lastIndex`；无 `g` 也能列全所有匹配，且克隆保留 UI 重复测试的隐藏状态干净。
- 建议：维持。
- 置信：confirmed

#### F-w9-agentmisc-adv-9 | 【辩护】 | character-card 三层体积闸门 + 读取侧占位降级，防御「重启必崩」循环
- 优先级：P3（正面认定）
- 位置：`logic/character-card-limits.ts:1-37`；`logic/validate-md-tree-limits.ts:26-54`
- 引文：
  ```
  /** 原始输入最大字节，超过即拒绝导入（防解析链 OOM）。*/
  export const CHARACTER_CARD_MAX_INPUT_BYTES = 48 * 1024 * 1024;   // :16
  ```
- 辩护理由：
  1. 阈值分层的理由写在模块头（:4-11）：巨大角色卡在解析链上产生多份全尺寸拷贝 → 原生 OOM
     （非 JS 异常，try/catch 拦不住、直接杀进程）→ 毒数据落库后每次重启的 workplace 前缀组装
     整读全文 → 「重启必崩」崩溃循环。所以：导入侧闸门（防新增）+ 读取侧降级为占位符（救存量）。
  2. `validateMdTreeLimits` 在**写库事务之前**抛 `TOO_LARGE`，保证「零写库」——不落半截毒数据。
  3. 压缩侧闸门 `BLOB_COMPRESSED_GATE = 单文件/4`（:36）按典型文本 4× 压缩比把明文上限折算到
     zlib 侧，方向刻意保守（宁可多跳过也不放行会 OOM 的文件）。
  4. `utf8ByteLength`（:50-84）为 RN/Hermes 无 `TextEncoder` 提供手写 UTF-8 兜底、正确处理代理对
     （落单代理按 U+FFFD=3 字节，与 TextEncoder 一致）——跨端一致，非权宜。
- 建议：维持。这是「用体积闸门救活应用」的正确取舍。
- 置信：intentional（模块头即写明背景）

#### F-w9-agentmisc-adv-10 | 【辩护】 | agent 写入门禁与读门禁同源（toWire→decode 往返），防毒行毒全表
- 优先级：P3（正面认定）
- 位置：`logic/validate-agent-definition.ts:52-100`（assertWritableAgentDefinitionShape）；
  schema `model/agent-definition.schema.ts:136-155`
- 引文：
  ```
  decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema);   // validate-agent-definition.ts:89
  ```
- 辩护理由：
  1. WHY 注释（:46-50）点明要害：`agent` 工具 create/update 把 LLM 原始 JSON 直接收进来（D5 宽松收包），
     读侧 `rowToDefinition` 走 strict zod decode（repository :22）——一行毒数据会让整个注册表
     `list()/get()` 全部失败。写入前用**与读侧同一 schema** 往返校验，保证「写得出必读得出」。
  2. `mergeAgentDefinitionPatch`（logic 层）刻意**不**校验形状，把畸形（如 prompts 传字符串）原样透传给
     validator 拒绝——「合并层只管覆盖语义、校验层统一把关」的职责分离清晰。
  3. tool 策略硬过滤双保险（`resolve-agent-tool-registry.ts:66-73`）：`mode==='subagent'`
     或 `depth>=2` 强制移除 task+agent（防递归、自我改造），`skillsEnabled===false` 移除 skill——
     这层覆盖用户 policy，是刻意的防递归设计；`validate-agent-tool-policy` 的
     `LEGACY_TOOL_MIGRATION` 对已下线的 v1 工具给可操作迁移提示（replace→edit 等）。
- 建议：维持。
- 置信：confirmed

#### F-w9-agentmisc-adv-11 | 【辩护】 | depth 压缩锚定：startDepth 只是启发式起点，绝不拦腰切断轮次
- 优先级：P3（正面认定）
- 位置：`domain/depth/logic/resolve-hide-message-range.ts:29-79`
- 引文：
  ```
  if (m.role === "user" && !hasToolResult(m)) { return m.seq - 1; }   // :39-40
  ```
- 辩护理由：与 RULE.md「压缩」条目（chat-fixes-2026-08 定稿）完全一致——从 slice 最新边界向更旧
  方向找第一条真用户输入，只隐藏严格更旧于它的消息，锚点自身及整轮 tool 往返保留；slice 内锚不出
  真用户输入（病态残留）时 `return null` 放弃本次压缩（宁可不压也不留半截轮次）。保留条数
  ≥ startDepth+1，可超出启发式值 6。这是有产品定稿背书的锚定策略，非启发式拍脑袋。
- 建议：维持。
- 置信：intentional（RULE.md 拍板口径）

---

### 二、让步清单（辩护人承认的问题 / 缺口）

#### F-w9-agentmisc-adv-12 | 【让步】 | doomLoopThreshold/crossRoundWindow 无取值上界，LLM 可把自身配置写「砖」
- 优先级：P2
- 位置：`model/agent-definition.schema.ts:147-149`；`logic/doom-loop.ts:78-84`
- 引文：
  ```
  doomLoopThreshold: z.number().int().positive().optional(),          // schema :148
  doomLoopCrossRoundWindow: z.number().int().positive().optional(),   // schema :149
  ```
- 描述：schema 只卡 `int().positive()`，无上下界、无「偶数」约束。后果两条：
  ① `doomLoopThreshold:1` → `assertNoDoomLoopInBlocks` 见到**任意一个** tool_use 就抛 DOOM_LOOP，
     该 agent 每次工具调用都自我中止（砖化）。② `doomLoopCrossRoundWindow` 为奇数或 <4 时，
     `assertNoCrossRoundDoomLoop` 的守卫（`crossRoundWindow < 4 || % 2 !== 0`）**静默 return**，
     跨轮检测被无声关闭。因为 agent 定义可由 `agent` 工具（LLM）create/update，LLM 误写这些
  运行时字段即可自伤（虽然只影响该 agent，属自伤非跨用户）。
- 辩护立场补充：默认值（3/4）健全，且这是「agent 配置自伤」，非系统级缺陷，故降为 P2 而非 P0。
  但 schema 层确有义务给出取值护栏（至少 clamp 或对明显病态值告警）。
- 建议：`doomLoopThreshold` 加下界（如 ≥2，避免单次即中止）与合理上界；`doomLoopCrossRoundWindow`
  在 validate 层要求偶数且 ≥4（或对不满足者告警而非静默禁用）。
- 置信：confirmed

#### F-w9-agentmisc-adv-13 | 【让步】 | `token-estimate.ts` 的 `estimateTokens` 无任何生产消费方（仅测试用）
- 优先级：P3
- 位置：`domain/compaction-conditions/logic/token-estimate.ts:13-15`
- 描述：`estimateTokens(messages)` 仅被 `test/infra/tokenizer/heuristic-token-counter.test.ts:4,29`
  导入用于断言 `counter.countMessages(messages) === estimateTokens(messages)`。生产路径的压缩判定
  走 `resolveCurrentPromptTokens`（token-ratio.trigger.ts:58），**不经过**本函数——它是一层对
  `HeuristicTokenCounter.countMessages` 的薄包装，在生产代码里没有活着的调用方。
- 辩护立场补充：这是一层死代码（测试把它「用活了」）。与 RULE「消息压缩搬运/退役件清理」的取向一致，
  应随维护轮清掉，或让测试直接调 `counter.countMessages` 断相等。
- 建议：删除 `domain/compaction-conditions/logic/token-estimate.ts`，测试改直调 counter；
  或明确标注为「对外示例/待接入」并给 owner。列入清理 backlog。
- 置信：confirmed（git grep 全仓，生产零引用）

#### F-w9-agentmisc-adv-14 | 【让步】 | `NovelMasterEventPayload` 联合无判别式，TS 无法对成员收窄
- 优先级：P3
- 位置：`domain/events/model/event-types.ts:111-120`
- 描述：`NovelMasterEventPayload` 是 9 个彼此结构重叠的接口的裸联合，没有 `type`/`kind` 判别字段，
  TS 无法按事件类型安全收窄；消费方 `public/events.ts:18` 实际只导出了 `NovelMasterEventType`。
- 辩护立场补充：事件总线的类型定义本身是清晰且完整的（每个事件有专名 payload + 全量汇入两联合），
  只是联合未做可辨识化。危害低（消费方多按 `type` 分派，未依赖联合收窄）。
- 建议：如后续消费侧需要按 payload 收窄，给每个 payload 加 `type` 字面量做判别式；否则可维持。
- 置信：confirmed

#### F-w9-agentmisc-adv-15 | 【让步】 | KkvReaderPort「get 非空、缺失抛 NOT_FOUND」的承重契约未在端口文档化
- 优先级：P3
- 位置：`domain/kkv/ports/kkv-reader.port.ts:8-12`
- 描述：端口签名 `get(...): Promise<string>` 隐含「不存在则抛 KkvError(NOT_FOUND)」这一**承重约定**，
  但端口文件头只写「Minimal KKV read/write port for domain repositories」，未写该约定。
  唯一消费方 `kkv-model-suggestion.repository.ts:107-114` 正确按「抛 NOT_FOUND」编码（catch →
  emptyCache），但下一个新增 domain 消费方若照 `KkvRepository.get → KkvEntry|null` 的直觉，
  可能误以为 null 语义而写出 `get(...).then(v => JSON.parse(v))` 直接崩或误判。
- 辩护立场补充：契约本身正确且已被消费方遵守，缺的只是一行 JSDoc；且 domain 端口与 core 内部仓储
  的缺失语义本就刻意不同（见 F-4），越文档化越能防后来者踩。
- 建议：在 `KkvReaderPort.get` 上补 JSDoc：「key 不存在时抛 `KkvError(code=NOT_FOUND)`，不返回 null」。
- 置信：confirmed

#### F-w9-agentmisc-adv-16 | 【让步】 | `resolveHideMessageRange` 收了 `_slice` 参数但不使用
- 优先级：P3
- 位置：`domain/depth/logic/resolve-hide-message-range.ts:53-57`
- 引文：
  ```
  export function resolveHideMessageRange(
    visible: readonly ChatMessage[], _slice: DepthSlice, messageIds: readonly string[]
  ): HideMessageSeqRange | null {
  ```
- 描述：`_slice` 前缀下划线表明刻意不用——实际逻辑只依赖 `messageIds`（已由 `messageIdsInSlice`
  按 depth 算好）。这是签名与实现的轻微脱节；保留参数大概是为了接口形状与「depth slice 解析」语义对齐，
  或给未来留口。危害为零（`_` 前缀已表明不用），仅是可读性小瑕疵。
- 建议：若无未来用途可去掉该参数；否则补一行注释说明为何保留。
- 置信：confirmed

#### F-w9-agentmisc-adv-17 | 【让步】 | smart-sort IO 的 captureKind 加字段但 schemaVersion 未再 bump（有意，但版本语义变松）
- 优先级：P3
- 位置：`model/smart-sort-rule-io.ts:27`（版本=2）、`:126-143`（bundleRulesToEntities 对 captureKind 缺省 smart）
- 描述：`captureKind`（D13）作为可选字段加入 v2 bundle、**未** bump 到 v3，注释明说
  「pre-D13 v2 导出无需升版仍可导入」。这意味着 `schemaVersion:2` 已不对应唯一形状
  （v2 有无 captureKind 两种）。解码端靠 `captureKind ?? "smart"` 兜底。
- 辩护立场补充：这是**刻意**的向后兼容取舍（模块头 :12-13 写明），旧导出零改动可导入，
  代价是版本号不再唯一标识形状。危害低（可选字段 + 缺省值兜底），但确属版本语义松动的债务。
- 建议：如未来再可选增字段，建议 bump 到 v3 并保留 v1→v2 迁移链，以恢复「版本↔形状」的对应。
- 置信：intentional（注释即写明），债务已登记

---

## 争议与存疑（不抹平分歧，留给主代理裁决）

1. **doomLoopThreshold=1 是否算 P2**——辩护人立场：这是「agent 配置自伤」，默认健全，故 P2。
   若主代理/检察官认为 LLM 经 `agent` 工具误写运行时字段足以造成用户可见的 run 反复中止，
   可上调至 P1。辩护人不主张更高，承认存在争议。
2. **`token-estimate.ts` 算死代码还是「预留接口」**——辩护人按「生产零引用 + 仅测试消费」判为死代码（P3）；
   若某分支/迭代把它当作公开的估算入口保留，则可改判为「有意保留、仅缺 owner 注释」。存疑。
3. **events 联合无判别式**——辩护人按「危害低、当前消费方未依赖收窄」判 P3。若后续有消费方
   直接对 `NovelMasterEventPayload` 做穷举 switch 而非按 type 分派，可能升级。存疑。

> 本报告为辩护机位单向输出，供 reduce/裁决交叉比对；不预设对方（检察官）结论。