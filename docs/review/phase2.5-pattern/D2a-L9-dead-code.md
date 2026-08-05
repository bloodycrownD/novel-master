# D2a-L9：死代码 & 迭代残留跨模块模式识别

## 元信息

- 角度：L9（死代码 & 迭代残留，lens-sweep）
- 输入：`D1-09-dead-code.md` + 全部 6 份 `D2-*.md` 切片 + `D2a-L8-api-security.md`（用于增量边界核对，不引其结论以外的内容）
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly，未读任何实现代码，未跑 build/test/lint/knip，未宣布 ready

## 结论（叙述式）

诶～先说清楚一件事：L8 在 `D2a-L8` 模式 1 已经把「死代码 / `@deprecated` alias 仍挂在公共面对外导出」立成 S 级跨 6 模块（compaction / agent-tool / chat-message / provider-llm / vfs / prompt）的反模式，整改方向是建一条「公共面退出契约」（lint 禁止 `index.ts` 与 `public/*.ts` re-export 带 `@deprecated` 的符号）。**L9 这一份不重复那条 S 级立项，只补 L8 视角盖不到的增量。** 区别在哪呢——L8 关心的是「公共面这一层有没有把死符号挡住」，整改机制是工程化护栏（lint、build 期检查）；L9 关心的是「**重构本身有没有走完最后一公里**」，整改机制是迭代 closeout（旧实现物理移除 + spec/PRD/注释同步 + 公共面撤回），这是个流程闭环问题，跟公共面 lint 不是同一副药。

从这个 L9 独有的角度看，**最有价值的新发现是「迭代完成度闭环缺失」**——也就是说，仓库里至少有三处「新实现已经上线、旧实现只标了 `@deprecated` 没物理移除、spec/PRD/内部注释还在按旧实现描述」的半截子重构，分散在 compaction、agent-tool、prompt 三个完全不相邻的模块。这三处的共同点不是「公共面污染」（那是 L8 的事），而是**「完成度不一致」**：代码层换了一半、文档层没换、公共面层也没换，三方各说各话。和 L8 模式 1 比起来，L8 抓的是"出口"，L9 抓的是"过程"——同一个症状的两个切面，整改时既要建出口护栏（L8），也要补过程 checklist（L9），缺一不可。

第二个 L9 独有的跨模块模式是**「过渡期 shim / alias 作为重构脚手架，迁移完成后未拆，反而被新代码绕开形成双路径」**。这个 L8 的「公共面 alias」也沾边，但 L8 看到的是 alias 还挂在 export；L9 看到的是更糟的一步——shim 文件本身没起到收编作用，新代码不去走 shim 反而直连底层，留下一个"半死不活的脚手架"。最典型的是 prompt 模块的 `message-body.ts` shim，本来是想给 prompt 内部收编所有对 chat 的引用，结果 `normalize-for-llm-export.ts` 直接绕过 shim 直连 `chat/content/message-body-text.js`，shim 反而造成"prompt 内部已隔一层"的错觉。`infra/tokenizer/index.ts` 的 barrel re-export 残留（`registerTokenizerDriver` 等 4 个）和 4 对 `@deprecated` alias 也是同类——脚手架在迁移完成后没有专门的"拆除"步骤，靠后续 reviewer 肉眼兜底，而肉眼兜底已经失效（每个切片都发现了 1–4 个尾巴）。

## 跨模块模式清单

### 模式 1：迭代完成度闭环缺失（新实现已上线，旧实现 + spec + 注释 + 公共面四方未同步）

- 类型：同一反模式（迭代过程性，L9 独有视角）
- 出现模块：**compaction、agent-tool、prompt**（3 个核心模块，互不相邻）
- 共同特征：一次有明确 PRD/spec 的重构落地后，**新实现已经在生产路径上跑**，但旧实现没有被物理移除，只是挂了个 `@deprecated` 注释；同时 spec/PRD 还按旧实现描述，内部注释也还指向旧实现，公共面也还在导出旧符号。结果是同一份功能在仓库里存在两套描述，而这两套描述互相对不上。L8 模式 1 抓的是这其中的「公共面」一面；L9 抓的是「四方同步」这个完整闭环——只改公共面（L8 的整改）不够，spec、注释、物理移除三面都要跟着动。
- 各模块变体：
  - **compaction（`estimateTokens`，S 级，D2-compaction S1）**：v3 迭代把判定路径换到 `resolveCurrentPromptTokens`（按 savedModelId 解析精确 tokenizer），原 v1/v2 时代给 `TokenThresholdTrigger` 用的 `estimateTokens`（走 `HeuristicTokenCounter`，字符数 ÷ 3.35）已经没有生产消费者，src 里只有 `heuristic-token-counter.test.ts` 引了一下。但 `public/compaction.ts:24` 仍然把它作为公共面导出，外部从公共面看进来会以为「这是 compaction 估 token 的官方函数」，实际生产根本不走它。**这是「新实现已上线、旧实现仍合法挂在公共面」的最干净样本——没有 spec 漂移，只有代码与公共面的漂移。**
  - **agent-tool（`chat_grep`，S 级，D2-agent-tool S1）**：比 compaction 更糟一层——不仅代码与公共面漂移，spec 还反向漂移。`tool-system-v2/prd.md` 把 `chat_grep` 列为「内置工具从 10 个减至 7 个」目标里的第 7 个（L24 + §5 整节 + 验收 3 条），代码已 `@deprecated` 且从 `registerBuiltinTools` 移除（`register-builtin-tools.ts:18` 注释自承），但**没有任何一个列举的迭代记录提到要废掉 chat_grep**——既无 supersede 说明，也无反悔记录。`builtin-tool-context.ts:16-17` 注释还在说「供 chat_grep」，与现行代码对不上。这是「四方全部没同步」的完整样本：代码换了、PRD 没换、注释没换、公共面（`chat-grep-tool.ts` 文件本体）还留着。
  - **prompt（`validatePromptBlocks` 整条 flat-block 路径，A 级，D2-prompt 表格第 3 行）**：D2-prompt M1 + L9 explore-prompt 已经记录，整套 flat `PromptBlock` 路径（`validatePromptBlocks` / `validatePromptBlocksFromMap` / `PromptBlock` / `shouldIncludePromptTextBlock`）被新的 `AgentPromptLayout` 路径取代，已无生产引用，只剩自己的测试在引。D2-prompt §35 还补了一刀：`prompt-llm-input-parity` spec 要求的「prompt 模板至多一个 chat 块」约束，事实上只在已退役的 flat-block 路径里实现，新 layout 路径里隐式成立、无需校验——也就是 spec 写的约束在现行路径里是「死规则」。
- 系统性根因：仓库**没有「迭代 closeout checklist」**。一次重构被 PRD 立项、被代码实现、被测试覆盖，但「收尾」这一步没有任何工程化抓手——没有 PR 模板要求"如果你新增了 X，是否物理删除了被取代的 Y"、没有 spec/PRD 的反向更新钩子、没有"deprecated 标注必须在 N 次迭代内转为删除"的硬性时钟。结果是每次重构都按"先标 deprecated、稍后再删"启动，但"稍后"永远不来，因为没有任何机制触发它。compaction 的 `estimateTokens` 是最纯粹的例子——v3 落地那一刻就该删，拖到现在变成公共面污染。
- 严重度：**A** —— 单看每一处都已经在各自切片定级（S/S/A），跨模块叠加后看到的是同一个根因（无 closeout 机制），但因为 L8 已经把「公共面」这一面立成 S 级，L9 这条 A 级聚焦在 L8 盖不到的「spec/PRD/注释/物理移除」三面。如果 phase3 决定 L8 模式 1 与本模式合并立项，则整体升 S；如果分开立项，本模式单独 A。
- 建议方向：phase3 把这条与 L8 模式 1 **配对但分别立项**——L8 的整改机制是"出口护栏"（lint），L9 的整改机制是"过程 checklist"。具体方向：(1) 在 PR 模板里加一节「Iteration closeout」，强制作者列出本次重构是否新增了取代旧实现的符号，旧实现是否已物理移除、`@deprecated` 是否已转为删除、相关 spec/PRD/注释段落是否已在同 PR 更新；(2) 对 compaction `estimateTokens`、agent-tool `chat_grep`、prompt flat-block 这三处立刻排一个「closeout 批次」——前两处相对干净（一个删函数、一个需先和产品确认 chat_grep 去留），prompt flat-block 牵涉测试重写需单独评估；(3) 与 L11（doc-drift）协调 spec/PRD 反向更新的归属——L9 触发"该改"，L11 负责"改成什么"。

### 模式 2：过渡期 shim / alias 脚手架未拆反而被新代码绕开（双路径并存）

- 类型：同一反模式（重构脚手架生命周期管理，L9 独有视角）
- 出现模块：**prompt、core/infra（tokenizer barrel）、core/domain（vfs-tools / provider alias）**
- 共同特征：重构期间为了"平滑迁移"，会临时挂一层 shim——要么是一个 re-export 文件，要么是一个 `@deprecated` 别名。设计意图是「让新代码走 shim，老代码慢慢迁，shim 最终拆除」。但实际发生的是：**shim 挂上以后，新代码反而绕过 shim 直连底层**，shim 既没起到收编作用，也没被拆除，最后变成「同一模块内同一引用走两条路径并存」的半死不活状态。L8 模式 1 看到的是 shim 还挂在公共面；L9 看到的是 shim 在源码内部已经被绕开——这是比 L8 视角更深一层的腐烂。
- 各模块变体：
  - **prompt（`domain/prompt/logic/message-body.ts` shim，A 级，D2-prompt 表格第 4 行）**：最典型样本。这个 shim 把 `messageBodyText` / `messageBodyTextFromBlocks` / `messageBodyTextFromContent` / `formatChatMessageForCliPreview` 从 `chat/content` 重新导出，文件头还自标 `@module domain/prompt/message-body`（m6 已记录这个 `@module` 路径与实际 `logic/` 位置不符）。设计意图显然是"prompt 内部所有对 chat message body 的引用都走这层 shim"。但 `normalize-for-llm-export.ts:7-10` 直接 `from "../../chat/content/message-body-text.js"` / `"../../chat/model/message.js"` 绕过 shim，而 `infra/tokenizer/impl/heuristic-token-counter.ts` 又通过 shim 引。**结果同一个 prompt 模块内，调用 `messageBodyTextFromBlocks` 时一部分文件走 shim 一部分文件走直连**，shim 没有收编任何东西，反而给后人"prompt 内部已隔一层"的错觉。
  - **core/infra（`infra/tokenizer/index.ts` barrel re-export，A 级，D1-09 主题二）**：`registerTokenizerDriver` / `CONTEXT_WINDOW_RULES` / `DEFAULT_CONTEXT_WINDOW_TOKENS` / `ForVendorModelOptions` 这 4 个符号的 barrel re-export，apps 早已按 `core-architecture-style` 迁到 canonical 路径 `@novel-master/core/nmtp`，core 内部也全走相对 import。barrel 这一层 re-export 已经零消费方，是迁移完成后的"脚手架残留"——和 message-body shim 不同的是这里没有"双路径并存"，是纯粹的"脚手架未拆"。
  - **core/domain（4 对 `@deprecated` alias + 1 bonus，A 级，D1-09 主题三+Duplicate exports）**：`BUILTIN_PROVIDER_IDS = BUILTIN_PROVIDER_KEYS`、`MUTATING_VFS_TOOL_NAMES = MUTATING_FILE_TOOL_NAMES`、`isMutatingVfsToolName = isMutatingFileToolName`、`savedModelSettingsDocumentSchema = savedModelSettingsSchema`、（bonus）`builtinProtocolByProviderId`——全是 V1→V2 或字段重命名期间的过渡 alias，apps + core test 零引用。这一组是"脚手架生命周期"最干净的样本：迁移已完成、消费者已切换、脚手架完全没人走，但脚手架本身没有被任何一个迭代清掉。
  - **vfs（`releaseAndDeleteVfsPrefix`，B 级，D2-vfs B2）**：与上面三组反向变体——alias 标了 `@deprecated` 被 `sweepRevisionsUnderScope` 包装，**但旧名仍被同模块内部 4 处消费**（`vfs-zip-io.service.ts:182` 等）。这是「脚手架挂上去但内部根本没迁完」的状态，比"脚手架挂上没人走"更糟糕——它说明 `@deprecated` 标注当时就是个空头承诺。
- 系统性根因：**脚手架生命周期没有 owner**。挂 shim / alias 是迁移启动那一刻作者顺手做的（成本低、收益立竿见影），但"拆除 shim / alias"是一个没有触发点的工作——它不会在任何后续迭代的 PRD 里出现（因为已经"完成"了），也不会被 lint 自动捕获（因为 alias 是合法 export），只能靠 reviewer 记得"哦当时挂了个 shim 该拆了"。vfs 那个反向变体更暴露一个问题：**`@deprecated` 标注本身没有任何约束力**，作者可以在标了 deprecated 之后继续往旧名上加内部调用，deprecation 形同虚设。
- 严重度：**B** —— 比 L8 模式 1 低一档，因为 shim/alias 在多数情况下零引用（compaction estimateTokens 同类），危害是"维护成本 + 误导后续 reviewer"而非"运行时风险"。但 prompt message-body shim 的双路径并存是 A 级隐患（同模块内引用风格不一致，后续维护时极易选错路径），vfs 的"deprecated 仍被内部消费"是 B+ 级（语义自相矛盾）。
- 建议方向：(1) 与 L8 模式 1 的 lint 规则合并设计——L8 那条"禁止 `index.ts` / `public/*.ts` re-export `@deprecated` 符号"自然覆盖 alias 在公共面的部分；L9 补一条"禁止 `@deprecated` 符号被同包内非 `@deprecated` 代码引用"（直接命中 vfs `releaseAndDeleteVfsPrefix` 那条）；(2) prompt message-body shim 单独处理——要么强制 prompt 内所有对 chat message body 的引用都走 shim（D2-prompt 建议方向），要么直接删 shim 让所有引用直连，**不能停在"一半走 shim 一半直连"**；(3) 建一个"脚手架登记表"——每次新增 shim / alias 在一个统一位置（比如 `docs/Iterations/scaffolding.md`）登记 owner + 拆除时间点，否则脚手架会无限累积。

## 与 D2a-L8 模式 1 的边界划分（避免重复立项）

把 L8 模式 1 和本报告两条模式放一起，**三者覆盖同一批底层事实**（`estimateTokens` / chat_grep / V1→V2 alias / flat-block / shim 全是同一批符号），但视角和整改机制不重叠：

| 视角 | 关心的问题 | 整改机制 | 覆盖的"面" |
|------|-----------|---------|-----------|
| L8 模式 1（S 级） | 公共面对外导出污染 | 出口护栏（lint 禁 re-export `@deprecated`） | 公共面（`index.ts` / `public/*.ts` / `.d.ts`） |
| L9 模式 1（A 级） | 重构最后一公里未走完 | 迭代 closeout checklist | spec / PRD / 内部注释 / 物理移除 |
| L9 模式 2（B 级） | 脚手架生命周期无 owner | 脚手架登记表 + 内部引用 lint | 源码内部 shim / alias 路径 |

phase3 既可以选择把三者合并为一条 S 级整改（"公共面 + 完成度 + 脚手架"统一立项），也可以分开立项——L8 那条整改机制最干净（lint 一加就生效），L9 两条整改机制偏流程（PR checklist + 登记表），落地难度更高。**我的立场是分开立项，但整改批次合并执行**——同一批 closeout PR 里同时撤掉公共面（L8）、改 spec/注释（L9 模式 1）、拆脚手架（L9 模式 2），效率最高。

## 覆盖声明

**读了**：`docs/review/phase1-lens/D1-09-dead-code.md` 全文（核实清单 5 个主题 + Duplicate exports + knip 误判汇总 + 与 L3/L8 交叉点 + 核心交付）；全部 6 份 `docs/review/phase2-slice/D2-*.md`（agent-tool / chat-message / compaction / prompt / provider-llm / vfs）的 lens 命中行、S/A/B 级发现正文、债务清单、耦合点、覆盖声明段；`docs/review/phase2.5-pattern/D2a-L8-api-security.md` 全文（用于增量边界核对，确认 L8 模式 1 已覆盖公共面那一层）；`docs/review/guides/phase2.5-cross-module.md` 全文（执行规则）。

**没读**（按指导文档「不读实现代码 / 不读其他角度」边界）：任何 `packages/*/src/` 或 `apps/*/src/` 下的源码（D1-09 已逐条核实过，本报告只做二次分析）；任何 `docs/Iterations/*/spec.md` 或 `prd.md` 原文（只引用 D2 切片里已经引述的段落，如 `tool-system-v2/prd.md` L24/§5/L161/L233-243）；其他角度的 D1 报告（L2/L3/L6/L7/L8/L11 只在 D2 切片的「涉及角度」字段里看到引用，未读原文）；`docs/review/phase0/D0-1-code-map.md` 与 `D0-2`（D2a-L8 已经引用过 god module / 摇摆度数据，本报告未直接核对）。

**为什么不读**：phase2.5 边界明确是「输入 = D1 + D2 报告，不读源码、不读其他角度」。本次产出未出现 `待回派` 标记——所有跨模块模式都建立在 D1-09 + D2 切片已有结论之上，未引入新的事实主张。D2a-L8 是同一 phase2.5 轮次的兄弟报告，读它是为了增量边界核对（避免与 L8 模式 1 重复立项），不是引述 L8 视角的结论作为本报告的事实依据。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 跨模块模式识别。L9 在 D1-09 已经明确「apps 端真实死代码分布需等 knip 配置修复后重跑才能确认」，本报告不覆盖 apps 端 knip 误判层。

## 给 Phase 3 的线索

按 phase3 优先级排序：

1. **本报告模式 1 vs L8 模式 1 的立项边界（首要裁决）**：phase3 必须先决定是合并立项还是分开立项。我的建议是「整改批次合并、立项分开」——L8 那条 S 级整改机制是 lint（落地快、强制力强），L9 这条 A 级整改机制是 PR checklist（落地慢、依赖流程遵从），合并立项会让 L8 那条被 L9 的流程属性拖累。但执行时同一批 closeout PR 一起改最省事。

2. **`chat_grep` 去留必须先于 closeout 裁决（S 级阻塞项）**：D2-agent-tool S1 已经标过，L9 视角再确认一次——`chat_grep` 是本报告模式 1 三处里唯一一个 spec 还反向漂移的（PRD 列为必备、代码已废、无 supersede）。closeout 批次不能直接动它，必须 phase3 先和产品确认去留：要么 PRD 加 supersede 注记后删代码，要么恢复注册并补 `FILE_TOOL_NAMES` 第 7 项。**不能停在「PRD 说有、代码说废」的当前状态**——这是 L9 模式 1 与 L8 模式 3（spec 漂移）的交叉点，phase3 需要协调。

3. **prompt message-body shim 双路径（A 级，独立项）**：这条与 L3（跨 context 引用）强耦合。D2-prompt 已经建议"要么全走 shim 要么全直连"，但 phase3 需要先和 L3 裁决"prompt 是否需要一层对 chat 引用的封装"——如果 L3 决定 prompt 与 chat 之间不需要 shim（直接跨 context 引用合法），那 shim 删掉；如果 L3 决定需要 shim，那 shim 必须强制收编所有引用。这条不能拖，因为它是"后续维护时极易选错路径"的活隐患。

4. **脚手架登记表（B 级，机制项）**：本报告模式 2 的整改机制。如果 phase3 决定立这个机制，需要和 L10（工程化）协调——登记表本身是个轻量工程化改动，归属 L9 还是 L10 由 phase3 裁决。

**潜在的角度间冲突预警**：

- 与 **L8**：模式 1 与 L8 模式 1 视角重叠（同一批符号），立项边界需 phase3 裁决。已在上面专门一节说明。
- 与 **L3**：模式 2 的 prompt message-body shim 与 L3「跨 context 引用」强耦合，shim 去留依赖 L3 对 prompt↔chat 边界的裁决。
- 与 **L11**：模式 1 的 spec/PRD 反向更新（`chat_grep` PRD、ARCHITECTURE.md documented exception §2、`builtin-tool-context.ts:16-17` 过时注释）与 L11 doc-drift 必然重叠，但 L9 触发"该改"，L11 负责"改成什么"，分工需 phase3 明确。
- 与 **L7**：L7 在 D2-compaction A2 已经命中 `CompactionConditionsTrigger` 草稿残留（D2a-L8 模式 1 旁证也提过），与本报告模式 1 同批但视角不同——L7 关心"测试覆盖"，L9 关心"完成度闭环"，整改时归同一 closeout 批次。
