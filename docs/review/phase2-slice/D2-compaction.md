# D2-compaction：compaction 切片

## 元信息

- 模块：compaction（domain/compaction-conditions + service/compaction-conditions）
- 文件范围：domain 7 文件 / 195 行 + service 4 文件 / 217 行 = 11 文件 / 412 行；无独立持久化（KKV 模块 `nm-compaction-conditions` 复用 service/kkv）
- 相关 Iterations：`compaction-agent-update`、`global-compaction-policy`、`event-bus-compaction-conditions`（最新架构定型）、间接相关 `event-config-dag`、`agent-config-and-compaction`、`workspace-chat-vfs-upgrade`
- lens 命中：L2✓（算法健康/架构 churn）、L3✓（documented exception 失效）、L4✓（错误处理正面案例）、L5-（事件执行面耦合）、L6✓（tokenizer 三端不一致）、L7✓（测试稀疏 + 死代码）、L11✓（doc-drift）
- 轮次：第 2 轮（phase2-slice）

## 模块画像（叙述式）

这个模块只管「要不要压缩」，不管「压缩怎么做」——做压缩的 action 在 event-bus 化之后被搬去了 `service/events/impl/actions/`（hide-message、refresh-macros），所以 compaction-conditions 现在是个纯触发判定模块。它的判定结果是一个布尔值：true 的时候，调用方（AgentRunner）会往事件总线里 `emit('session.compaction.requested', ...)`，后续的 hide-message 等动作完全走 events-config 那条 DAG，跟本模块再无关系。这种「判定/执行」切开是 event-bus 迭代（M3）做的，spec 在 `event-bus-compaction-conditions/spec.md` L168-189 和 L356-365 把这件事说得很清楚：旧的 `CompactionPipeline` + `default-compaction-action` 全删，conditions 只剩下 trigger 字段。

数据流是这样的：`createCompactionConditionEvaluator` 是个 factory，它先从 `CompactionConditionsStore`（KKV `nm-compaction-conditions/policy`）把持久化的 conditions 拉出来，如果 `enabled` 是 false 或者 store 没记录就直接返回 false；否则按 conditions 里的字段拼一个 `CompositeConditionTrigger`（OR 语义），里面塞 `TokenRatioConditionTrigger`（conditions.tokenRatio 存在时）和 `VisibleFloorTrigger`（conditions.visibleFloor 存在时）。每次 AgentRunner 在一个 step 开始前调一次 `shouldRequestCompaction`，任意一个 trigger 命中就触发。`CompositeConditionTrigger` 用的是顺序短路 OR（`composite-trigger.ts` L21-26），不是并行——这个细节后面会再提到。

被谁依赖呢：三端 runtime（CLI / desktop / mobile）都通过 `public/compaction.ts` 这个 facade 拿工厂和类型，mobile 还特别做了 lazy init（`apps/mobile/src/runtime/create-mobile-runtime.ts` L79-97），因为 mobile 上 tokenizer bundle 比较重，不想在启动时就拉起来。公共面一共导出 7 样东西：`CompactionConditions` 类型、`compactionConditionsSchema`、三个错误工具、`CompactionConditionsStore` 类型 + `createCompactionConditionsStore` 工厂、`createCompactionConditionEvaluator` + `CompactionConditionEvaluator` 类型、还有一个 `estimateTokens`——这个是这次切片发现的核心债务之一，下面专门讲。

## 功能正确性核对

把代码逐条对了一遍 `event-bus-compaction-conditions/spec.md`（最新架构）和 `global-compaction-policy/spec.md`（v1 时代），核对结论如下：

**trigger 组装层级——和最新 spec 一致**。spec M3（L406-412）要求 conditions 替代 policy store，trigger 用 OR 复合，包含 token-ratio（扩展自原 TokenThresholdTrigger，接 `tokenRatio * contextWindow`）和 visible-floor（原 FloorThresholdTrigger 改名）。代码里 `create-compaction-condition-evaluator.ts` L39-69 的 `triggersFromConditions` 正是这个形状，`token-ratio.trigger.ts` L42 用 `Math.floor(contextWindow * tokenRatio)` 算阈值，`visible-floor.trigger.ts` L22 用 `visible.length > visibleFloor` 严格大于——跟 spec L97 写的 `visible.length > visibleFloor` 字面一致。

**schemaVersion=3——代码比 spec 文档新**。spec L86 写的是 `schemaVersion: 2`，且保留了 `tokenThreshold: -1`（解析为当前 model max context tokens）。但当前代码 `compaction-conditions.schema.ts` L12 已经是 `z.literal(3)`，并且**完全删除了 tokenThreshold 字段**——v3 只接受 `tokenRatio` + `visibleFloor`。这不是偏离，是 spec 写完之后又演进了一轮：v2 的 `-1` 阈值方案被 tokenRatio × contextWindow 取代了，因为后者不需要特殊值魔法。store 层（`impl/compaction-conditions-store.service.ts` L21-43）保留了 v2→v3 迁移：检测到 `schemaVersion === 2 || tokenThreshold != null` 就 `migrateV2ToV3`，迁移时直接丢掉 tokenThreshold，tokenRatio 缺省给 0.8，并把 `visible-floor`（kebab）和 `visibleFloor`（camel）两种写法都吃下去。这块和 spec L447-457「兼容性与迁移」、L90「wire 可用 camelCase visibleFloor」是对齐的。

**enabled 校验——一致**。schema superRefine（L19-33）只在 `enabled: true` 时强制至少一项 trigger，disabled 时允许两者皆空，跟 spec L93-94 一致。

**对外不再做 hide/abstract——一致**。evaluator 的 JSDoc（`create-compaction-condition-evaluator.ts` L21-24）明确写「Does not hide messages or refresh macros」，true 时由 caller 去 emit 事件。代码里也确实没有任何对 messages/events 的写动作，纯净。

一个**待 phase3 核对**的语义点：`visible-floor.trigger.ts` L21 调的是 `session.list()`，spec L97 写的是「`visible.length`」。这两者对齐的前提是 `AgentSession.list()` 只返回 visible 消息而不含 hidden——如果 `list()` 的契约是返回全集（含已 hide 的），那 floor 判定就会把已经压掉的消息也算进去，导致「压完还继续触发」的死循环。本切片没读 `agent-session.port.ts` 的 `list()` 契约，留作跨模块核对项。

## 交叉发现（核心产出）

### S1 public 面双 token 计数路径并存，旧路径已无生产消费者

- 涉及角度：L2（架构演进 churn）+ L6（tokenizer 三端不一致）+ L7（死代码 / 测试稀疏）
- 位置：`domain/compaction-conditions/logic/token-estimate.ts` 全文；`public/compaction.ts` L24；`triggers/token-ratio.trigger.ts` L8（用的不是 estimateTokens 而是 `resolveCurrentPromptTokens`）
- 矛盾点：L2 已经纠正过——这模块算法本身健康，5 次迭代改的是 trigger 的组装层级。但叠上 L7（代码搜索）会发现，v3 把判定路径换到 `resolveCurrentPromptTokens`（按 savedModelId 解析精确 tokenizer）之后，原来 v1/v2 时代给 `TokenThresholdTrigger` 用的 `estimateTokens`（走 `HeuristicTokenCounter`，纯字符数 ÷ 3.35）就没人调了——src 里除了它自己，只有 `test/infra/tokenizer/heuristic-token-counter.test.ts` 引了一下（还只是为了断言它和 `countMessages` 相等）。可它依然挂在 `public/compaction.ts` 对外导出，外部调用方从公共面看进来，会以为「这是 compaction 用来估 token 的官方函数」，实际上生产路径根本不走它。
- 再叠 L6：L6 发现 tokenizer 三端计数本身就不一致（Node vs RN 公式不同，RN heuristic 回退时 counterKind 还会撒谎）。现在模块里同时存在「旧启发式 estimateTokens」和「新精确 resolveCurrentPromptTokens」两条路径，public 面都暴露——外部如果误用 estimateTokens，拿到的是和 Chat / CLI token 计数完全对不上的数，喂回 compaction 判定就是脏的。
- 依据：`token-estimate.ts` L8 import `HeuristicTokenCounter`（domain → infra，这条依赖本身也值得商榷，下面 A1 会提）；`token-ratio.trigger.ts` L46-55 走 `resolveCurrentPromptTokens`；grep `estimateTokens` 在 src 下零生产引用。
- 建议：从 `public/compaction.ts` 撤掉 `estimateTokens` 导出，让它退回成纯内部 / 测试用工具；如果确认 v3 之后启发式路径彻底不用了，更彻底的做法是连 `token-estimate.ts` 一起删，把那个唯一的测试断言改成直接调 `HeuristicTokenCounter.countMessages`。这条不能拖，因为它是公共面契约的污染。

### A1 ARCHITECTURE.md 的 documented exception §2 已经失效

- 涉及角度：L3（分层 / 规范漂移）+ L11（doc-drift）
- 位置：`packages/core/ARCHITECTURE.md` L59（Documented exceptions 第 2 条）；同文件 L54 Naming 表 Example 列
- 矛盾点：L3 报告已经标过这条——规范说 `domain/compaction/action/default-compaction-action.ts` 可以 import `infra/prompt-template` + `infra/date-format`，但这个文件在 `event-bus-compaction-conditions` 迭代里被明确删掉了（spec L378 变更点清单第 10 项「default-compaction-action.ts 删除」）。代码搜索也确认 `domain/compaction/action/` 这个目录都不存在了。规范文档却还把它当成有效例外在列，更糟的是 Naming 表（L54）还拿 `default-compaction-action.ts` 当「Default impl」命名范式的示例——新人照着规范学命名，会学到一个已经死掉的路径。
- 依据：`event-bus-compaction-conditions/spec.md` L356-365 的「与现有 domain/compaction 的关系」表把 action/* 标为「删除」；grep `default-compaction-action` 在 src 下零命中。
- 建议：从 ARCHITECTURE.md 删掉 Documented exceptions 第 2 条；Naming 表的 Example 换一个仍然存在的 default-* 文件。这个 L3 已经单独提过，切片这边确认它确实属于 compaction 模块的演进残留，归到本模块的债务清单里。

### A2 `CompactionConditionsTrigger` 接口是 schema 草稿残留，无任何引用

- 涉及角度：L7（死代码）
- 位置：`domain/compaction-conditions/model/compaction-conditions.ts` L8-11
- 矛盾点：文件里定义了 `CompactionConditionsTrigger`（tokenRatio + visibleFloor 两个可选字段），但 `CompactionConditions` 主接口（L13-17）自己又把这两个字段重复声明了一遍，根本没复用 Trigger 子接口。grep 全工程（含 dist / node_modules）零引用——只有它自己的 .d.ts 在导出。看形状像是设计 schema 时先抽了个 Trigger 子类型，后来发现 conditions 本身字段就那么点，没必要拆，但子类型忘了删。
- 依据：`compaction-conditions.ts` L7-11 定义 vs L13-17 重复声明；grep `CompactionConditionsTrigger` 在 src/test/apps 下零非自身引用。
- 建议：直接删 L8-11 这个子接口。顺便把 `CompactionConditions` 的字段补全文档说明（哪个是 OR、disabled 时是否允许空），让 schema 草稿期和定稿期的差异在代码里看不出痕迹。

### B1 mobile heuristic 回退时 compaction 的 token-ratio 判定会吃到不准的计数

- 涉及角度：L6（tokenizer 三端不一致）+ L5（执行面 / 跨端一致性）——这条不展开 L6 单角度结论，只讲它和 compaction 判定面叠加后的影响
- 位置：`triggers/token-ratio.trigger.ts` L44-55（调 `resolveCurrentPromptTokens`）；L6 报告 A-4（mobile heuristic 回退时 counterKind 标家族名但不真用精确公式）
- 矛盾点：算法（`tokenCount > floor(contextWindow * ratio)`）本身没问题，L2 已确认。但喂进来的 `tokenCount` 在 mobile 上某些模型回退到启发式时是不准的——而 compaction 判定是个「超阈值就触发」的硬开关，计数偏低就会漏触发（该压不压），偏高就会误触发（频繁压缩）。三端里 mobile 的 lazy init 还把 evaluator 延迟到首次调用才构造（`apps/mobile/src/runtime/create-mobile-runtime.ts` L79-97），意味着首次判定的时机和计数路径都最不可靠。
- 依据：L6 报告 A-4；`token-ratio.trigger.ts` 完全信任 `resolveCurrentPromptTokens` 的返回值，没有任何「计数来源不可靠时降级或告警」的兜底。
- 建议：这条根因在 tokenizer 模块（L6 已立项），compaction 这边能做的是——在 evaluator 里把「本次判定用的 counterKind / 是否 heuristic 回退」带到 emit 的事件 payload 里，方便上层（AgentRunner / events DAG）在 heuristic 回退时对 compaction 决策加一道保守化（比如延迟一步再压）。切片只提方向，不在这轮改。

## 债务清单

| 严重度 | 项 | 涉及角度 | 位置 |
|--------|----|----------|------|
| **S** | `estimateTokens` 旧启发式路径仍挂 public 面，与新精确路径并存，外部易误用且与 L6 三端不一致叠加放大 | L2 + L6 + L7 | `logic/token-estimate.ts`、`public/compaction.ts:24` |
| **A** | ARCHITECTURE.md documented exception §2 失效（`default-compaction-action.ts` 已删） | L3 + L11 | `ARCHITECTURE.md:59`、`:54` |
| **A** | `CompactionConditionsTrigger` 子接口无引用，schema 草稿残留 | L7 | `model/compaction-conditions.ts:8-11` |
| **A** | `VisibleFloorTrigger` 用 `session.list()` 取「可见条数」，与 spec「visible.length」的对齐依赖 AgentSession.list() 契约，未核对 | 功能正确性 | `triggers/visible-floor.trigger.ts:21` |
| **B** | mobile heuristic 回退时 token-ratio 判定吃到不准计数，evaluator 无降级 | L5 + L6 | `triggers/token-ratio.trigger.ts:44-55` |
| **C** | `token-estimate.ts` 是 domain → infra（HeuristicTokenCounter）依赖，且 v3 后该依赖只为已死的导出服务 | L3 分层 | `logic/token-estimate.ts:8` |
| **C** | 测试密度稀疏（D0-1 统计 1/137），trigger / evaluator / store 三层都缺直接单测，唯一相关测试是 `heuristic-token-counter.test.ts` 顺带验 estimateTokens | L7 | `packages/core/test/` 下无 compaction-conditions 专用测试目录 |

## 与其他模块的耦合点

给 phase3 交叉用，以下点很可能被别的切片也命中：

- **AgentSession.list() 契约**（A4 待核对）：visible-floor trigger 完全依赖这个语义。如果 agent-session 切片发现 list() 返回全集，本模块的 floor 判定就要改。
- **events-config / EventOrchestrator**：compaction 只 emit `session.compaction.requested`，真正执行 hide-message / refresh-macros 在 `service/events/impl/actions/`。L5 报告里的「event-config DAG 同层 parallel action 可能操作同一 session 状态」「compaction 长事务阻塞 AsyncMutex」——那些是 events 模块的执行面问题，本切片不重复，但提醒：compaction 的判定是触发源，执行面的问题会反向影响「触发后是否真生效」。
- **tokenizer / provider-model**：token-ratio trigger 依赖 `ProviderModelService.getContextWindow` + `getTokenCounterMode`，以及 `TokenCounterRegistry`。L6 的三端不一致根因在 tokenizer 模块，compaction 是受害者。
- **公共面 facade**：`public/compaction.ts` 同时混导了 depth 模块（`resolveHideMessageRange`、`DepthSlice` 等）和 compaction-conditions 的东西——这两个本是一次迭代（event-bus）拆开的，但 facade 还把它们捆在一个入口文件里。phase3 看 facade 切片时可以留意这个捆绑是否合理。
- **三端 runtime**：CLI / desktop / mobile 都构造 evaluator，mobile 用 lazy init 且 mobile 测试里把 evaluator stub 成 `undefined`（`apps/mobile/__tests__/agent-run.service.integration.test.ts` L46）——意味着 mobile 集成测根本没覆盖 compaction 判定路径。

## 覆盖声明

**查了**：domain 全部 7 文件（logic / model / ports / triggers × 3）逐行读；service 全部 4 文件（store port / 两个 factory / KKV impl）逐行读；`public/compaction.ts` facade 全文；`event-bus-compaction-conditions/spec.md` 关键章节（L81-170 压缩条件 + 事件配置 + 深度切片、L356-422 domain/compaction 关系 + 变更点 + M3/M4）；`global-compaction-policy/spec.md` 领域模型 + 持久化章节（L69-135）；`compaction-agent-update/spec.md` 看了目录大纲确认是更早的 agent 注册表 SQL 化迭代；ARCHITECTURE.md 的 Naming + Documented exceptions 段；三端 runtime 对 evaluator 的接线（grep 确认）；`estimateTokens` / `CompactionConditionsTrigger` 的全工程引用搜索。

**没查**（及原因）：`AgentSession.list()` 的实际契约——属于 agent-session 模块，留给那个切片或 phase3 跨模块核对；`resolveCurrentPromptTokens` 的内部实现——属于 infra/tokenizer，L6 已深入；EventOrchestrator / hide-message action 的执行细节——属于 events 模块切片；`compaction-agent-update` / `global-compaction-policy` 的完整 spec 正文——这两份是历史迭代，最新架构以 `event-bus-compaction-conditions` 为准，只需对照演进脉络不用逐字重读；dist / node_modules 下的产物副本——只用作引用确认，不作分析对象。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 评审发现。
