# D2-prompt：prompt 切片

## 元信息

- 模块：prompt（`domain/prompt` + `service/prompt` + `infra/prompt-template`）
- 文件范围：domain 12 文件 / 1006 行 + service 3 文件 / 396 行 + infra 3 文件 / 226 行 = 18 文件 / 1628 行；无独立持久化（agent_definition 表的 `prompts_json` 归 agent context 管）
- 相关 Iterations：`prompt-engine`（首期）、`prompt-llm-input-parity`、`prompt-block-lifecycle`、`agent-prompt-abstract-block`、`agent-worktree-block-ui`、`agent-config-shape`、`agent-config-and-compaction`；间接 `core-package-structure`（公共面定型）、`core-explore-remediation/features/quality-backlog/explore-prompt.md`（已落盘的同类审查）
- lens 命中：L1-（无持久化 schema）、L2✓（宏展开复杂度，**但标题措辞与正文自相矛盾**，见 A1）、L3✓（prompt→chat 灰色地带 + documented exception §2 失效）、L4✓（compaction action exception，已失效）、L5-、L6-（间接命中——tokenizer 三端不一致会污染 prompt 序列化结果，归 D2-compaction/D2-provider-llm）、L7✓（13/1006 测试稀疏）、L8✓（公共面 52 行，正常）、L9✓（间接，MacroActionKind unused export）、L10-、L11✓（agent-worktree-block-ui 等迭代 spec 与现状漂移）
- 轮次：第 2 轮（phase2-slice）

## 模块画像（叙述式）

prompt 这个 context 自己不存数据，只负责「把 layout 描述的三区结构 + chat 历史 + dynamic 区宏展开，拼成 LLM 能吃的 messages 数组」。它的输入是 `AgentPromptLayout`（system + persist + dynamic 三区，加 `workplace` / `customAttach` 两个常驻开关）和 `PromptRenderContext`（已 wrap 过的可见消息 + 时间 + workplace 服务），输出是 `PromptLlmInput`（system 字段 + messages 数组），下游再接 `normalizeForLlmExport`（区内 merge）+ `normalizeOrphanToolResultsForLlm`（孤儿 tool_result 文本化）才送到 `ModelRequestService.request`。

数据流的完整路径是这样的：`AgentRunner.run` 每个 step 先 `session.list()` 拿全部消息，过 `applyLlmRegexChannelToVisible` 做 regex 频道变换；然后 `assembleWorkplaceDisplay` 算出常驻工作区的前缀文件树（同时收 prefixPaths 给后面的 `seenPaths` 用）；接着 `prepareUserMessagesForPrompt`（在 chat context 里，但调 prompt 的 `expandDynamicMacros`）做用户消息的 wrap + customAttach 注入 + dynamic 宏展开；之后才进 prompt 模块本身的 `buildPromptLlmInputFromLayout`——这一步把 persist 文本块（不走宏，校验时已 `rejectPersistMacros`）、可见 chat 消息、dynamic 块（每块过 `expandDynamicMacros`，内部调 `infra/prompt-template/macro-render`）顺序拼成 messages，外加把 layout.system 映射成顶层 system 字段。`computeLlmExportZonesFromLayout` 同步算出 persistCount / dynamicCount 边界（chat 中间段长度由 push 时过滤 hidden 决定），交给 `normalizeForLlmExport` 做区内 merge 和 OpenAI 专用的 tool_turn_bridge 剔除；最后 `normalizeOrphanToolResultsForLlm` 把找不到配对 tool_use 的 tool_result 压成 `[tool_result id=…]` 文本。

prompt 自己被三端 runtime + agent runner + tokenizer 序列化（`serializePromptLlmInput` 直接复用 `formatPromptLlmInputForCliFromLayout`，这是 `prompt-llm-input-parity` 迭代立的 parity 契约）共同消费。公共面是 `src/public/prompt.ts`（52 行），主 `src/index.ts` 不导出 prompt API——这是 `core-package-structure` 定型后的两层 facade 约定。被依赖的方向上，prompt 自己单向依赖 chat（content 解析、message model、metadata 读取）和 service/workplace（仅 type）、domain/vfs（仅 type，且字段实际未消费，见 B2）；没有任何 context 反向依赖 prompt——prompt 是个叶子组装器。

## 功能正确性核对

按 `prompt-engine/spec.md`（首期）、`prompt-llm-input-parity/spec.md`、`agent-worktree-block-ui/spec.md`、`agent-prompt-abstract-block/spec.md`、`prompt-block-lifecycle` 逐条对了一遍代码，结论如下。

**首期宏语法——和 spec L92-110 完全一致**。`infra/prompt-template/macro-scan.ts` 的扫描器精确实现了 spec 表格里的四种形式：`{{/*...*/}}` 注释、`{{.path}}` dot 查找、`{{$.key}}` root 查找、空白容忍；`UNSUPPORTED_PATTERN` 正则（macro-scan L19-20）拒掉的 `if|range|with|template|define|:=|` 列表和 spec L106 的「不支持」清单一字不差。`macro-render.ts` 的 `lookupDot` / `lookupRoot` 对 unknown 字段都抛 `UNKNOWN_FIELD`，缺字段不静默——也和 spec L100/103 一致。

**关键纠偏**：Context Bundle 和 D1-02 标题都说「prompt-engine 模板宏展开是递归解析」，但**代码和 spec 都不是递归**。`macro-scan` 用 `indexOf("{{", i)` + `indexOf("}}", open+2)` 线性推进 cursor，整段只扫一遍；`macro-render` 把 actions 列表 for 一遍用 `slice + out +=` 串接，没有任何 self-invocation。D1-02 正文 L95 自己也写了「线性推进 cursor，整段只扫一遍，O(template 长度)」——标题和正文自相矛盾。「递归解析」这个标签会误导后续 reviewer 高估复杂度风险，详见 A1。

**文本拼接——和 spec L113-118 一致**。`render-prompt.ts` L85-95 的 `formatSegment` 就是 spec L113-118 那段代码字面量复制（trimmed 空 → `role: `；单行 → `role: line0`；多行 → `role: line0\n...`）。

**prompt-engine spec L201 的「`index.ts` 导出 prompt API」——已偏离但不违约**。当前主 `src/index.ts` 全文 191 行，零 prompt 导出；公共面走 `src/public/prompt.ts` 子路径。这是 `core-package-structure` 迭代（晚于 prompt-engine）重新定型两层 facade 的结果，`core-package-structure/spec.md` 的「公开 API 策略」表把 prompt 列入了 `public/*` 子路径，符合演进后规范。但 prompt-engine spec 这一条至今没同步更新，属 L11 漂移。

**`agent-worktree-block-ui` 的双消息注入——和代码对得上**。spec L76-77 要求 workplace 开启时注入 user 文件树 + assistant 确认语双段；`render-prompt.ts` L150-164 的 `appendWorkplacePairIfPresent` + L166-188 的 segments 版本成对出现；`computeLlmExportZonesFromLayout` L67-69 把这两段计入 `persistCount`（`injectWorkplace ? 2 : 0`），下游 `normalizeForLlmExport` 把它们划进 persist 区不与 chat 文本 merge。一致。

**`agent-prompt-abstract-block` spec L92-96 的 reject-when 文案——代码做了但文案不同**。spec 要求 `when is no longer supported; use type abstract for conditional summary blocks`，而 `validate-prompt-blocks.ts` L29 的实际文案是 `when is no longer supported; remove the when field`。`validate-agent-prompt-layout.ts` L66 是中文「不再支持 when 字段，请删除」。spec 自己 L95 也写了「不要求在 Zod 层复刻 rejectWhen 文案」，所以不算硬违约，但同一份 `PromptError(INVALID_BLOCK)` 在三个校验器里三种语言三种文案，是 m1 已记录的中英混用问题的延伸。

**`prompt-llm-input-parity` 的单 chat 块约束——已实现但位置不一**。spec L60 / L371 要求「prompt 模板至多一个 chat 块」，代码 `validate-prompt-blocks.ts` L165-171 在尾部校验了 `chatBlocks.length > 1` 抛错。但这是在**遗留的 flat PromptBlock 路径**里实现的，而当前生产用的 `AgentPromptLayout` 路径里 chat 是运行时槽位（layout 模型根本不含 chat 块），这个约束在新路径里隐式成立、无需校验。叠加 L9 角度：`validatePromptBlocks` 整条路径只剩自己测试在引用（M1 已记录），那个「单 chat 块」约束事实上已经是死规则。

**最重要的发现**——**`normalizeAgentPromptLayoutDomain` 静默吞掉 `customAttach` 字段**，详见 S1。

## 交叉发现（核心产出）

### S1 `normalizeAgentPromptLayoutDomain` 漏抄 `customAttach`，从 domain-shape 存储加载时字段被静默清空

- 涉及角度：L1（数据模型字段完整性）+ 必查一（功能正确性核对）
- 位置：`domain/prompt/logic/normalize-agent-prompt-layout.ts` L51-67；调用方 `config-forms/stored-config-validity/assess-agent-definition-wire.ts` L78-85
- 矛盾点：L1 单看 `AgentPromptLayout` 接口（model L76-95）字段齐全——`system / persistEnabled / dynamicEnabled / workplace / customAttach / persist / dynamic`，wire schema（`agent-definition.schema.ts` L103-109）也有 `customAttach`，`documentToDefinition` L175-185 把 customAttach 传进 `validateAgentPromptLayoutFromMaps`，`definitionToDocument` L197-220 也按 trim 非空写回 wire，整套流程闭环。但叠上「domain-shape 存储加载路径」就裂开了：`resolveAgentDefinitionFromStorage`（assess-agent-definition-wire.ts L75-87）发现存储里是 domain 形态（不是 wire 文档）时，会过一遍 `normalizeAgentPromptLayoutDomain(stored.prompts)`——而这个函数 L58-67 的 return 对象里**只展开 system / persistEnabled / dynamicEnabled / workplace / persist / dynamic 六个字段**，完全没 customAttach。结果：从 `agent_config_json.definition`（domain shape，project 级 agent config 走这条路径）加载的 agent，运行时拿到的 `options.definition.prompts.customAttach` 永远是 `undefined`，agent-runner L218 `extraInfo: options.definition.prompts.customAttach` 自然也注入不进 `<extra-info>` 块。
- 依据：`normalize-agent-prompt-layout.ts` L58-67 return 字段清单 vs `model/agent-prompt-layout.ts` L89-92 `customAttach` 接口字段；CHANGELOG `[1.4.17] - 2026-08-05` L19-21 那条「开启附加信息后纯文本消息不注入」的修复只动了 prepare-user-messages-for-prompt 的提前跳过逻辑，没碰 normalize 这一侧；`agent-definition.schema.ts` L103-109 / L175-185 / L197-220 三处都周到，唯独 normalize 漏抄。
- 建议：在 `normalizeAgentPromptLayoutDomain` 的 return 里加 `...(typeof layout.customAttach === "string" && layout.customAttach.trim().length > 0 ? { customAttach: layout.customAttach } : {})`，与 `validateAgentPromptLayoutFromMaps` L259-262 的归一规则对齐。补一条单测：domain-shape round-trip（save → load → customAttach 仍在）。切片不改代码。

### A1 「宏展开递归解析」标签与代码事实不符，D1-02 标题与正文自相矛盾

- 涉及角度：L2（算法复杂度，**标题措辞错误**）+ L11（doc drift）
- 位置：`infra/prompt-template/macro-scan.ts` 全文 / `macro-render.ts` 全文；Context Bundle 描述「prompt-engine 模板宏展开是递归解析」；`docs/review/phase1-lens/D1-02-algorithm.md` L91（标题「递归解析」）vs L95（正文「线性推进 cursor，整段只扫一遍」）
- 矛盾点：D1-02 的章节标题写「prompt-template（macro-scan + macro-render，递归解析）」，但同章节正文 L95 自己又写「**线性推进** cursor，**整段只扫一遍**，O(template 长度)」。代码事实是后者——`scanMacroActions` 是 while 循环 + indexOf 推进 cursor，`renderMacro` 是 for actions 用 slice 串接，没有任何递归调用，也没有「宏值里再展开宏」的二轮替换。把这个模块标成「递归解析」会让后续 reviewer 误以为存在「宏展开结果含新宏 → 再展开」的递归路径，从而高估边界条件风险（实际根本不存在嵌套展开场景），同时让 Context Bundle 的「1006 行只有 13 测试，复杂度风险高」这句判断的依据失真——真正的风险是测试密度稀疏（L7 已立项），不是「递归解析没覆盖」。
- 依据：macro-scan.ts L91-131 while 循环结构；macro-render.ts L93-114 单层 for；macro-render.ts L97-110 渲染时直接 `out += lookupDot / lookupRoot` 的返回值，**没有对返回值再 scanMacroActions**。
- 建议：把 D1-02 L91 的章节标题改成「prompt-template（macro-scan + macro-render，单遍线性扫描）」，与正文 L95 一致；Context Bundle 的派遣描述里去掉「递归解析」字样。本切片发现的是 review 文档措辞 bug，不是代码 bug。

### A2 L3「domain → service 0 violations」漏报 type-only imports，prompt 经 `PromptRenderContext` 类型耦合 `service/workplace`

- 涉及角度：L3（架构扫描盲区）+ 必查三（公共面）
- 位置：`domain/prompt/model/prompt-render-context.ts` L9（`import type { WorkplaceService } from "@/service/workplace/workplace.port.js"`）、`domain/prompt/logic/expand-dynamic-macros.ts` L7（同款 import type）
- 矛盾点：D0-1 §2「违规一：domain → service」断言「0 命中」，D1-03 结论 L20-21 重申「三类硬违规 Phase 0 已清零」。但 prompt 的 `PromptRenderContext`（domain 层）类型签名上声明了 `workplace?: WorkplaceService` 字段，`expandDynamicMacros` 函数签名也接 `WorkplaceService`——这两处都是 `import type`，TS 编译期擦除，所以基于运行时 import 的扫描扫不到。架构上看，port-only type 引用 + `import type` 是合理的（不像 value-level 反向依赖那样会真把 service 拉进 domain bundle），但严格按 ARCHITECTURE.md「domain 不得 import service」字面读，这是两处 type-level 灰色引用。L3 报告里专门给 normalize-for-llm-export → chat 留了「合法但未记录」的灰色面积，但完全没注意到 prompt → service/workplace 这条同类灰色引用。
- 依据：prompt-render-context.ts L7-9；expand-dynamic-macros.ts L7；D1-03 §「Documented exceptions 有效性」表里没列这条；ARCHITECTURE.md 红线「domain 不得 import service」无 type/value 之分。
- 建议：和 L3 给 normalize-for-llm-export → chat 的处理对齐——要么把这条也补进 ARCHITECTURE.md 的 documented exceptions（标注「type-only port reference」），要么在 prompt-render-context 里改用结构化类型（`{ renderFileTree(): Promise<string> }` 这种窄接口）把对 `WorkplaceService` 的引用彻底解掉。前者成本低，后者更干净。

### A3 prompt → chat 跨 context 同时存在「shim 再导出」和「直接私路径」两条路径

- 涉及角度：L3（跨 context 引用）+ L9（死代码 / shim 残留）
- 位置：`domain/prompt/logic/message-body.ts`（re-export shim，全文 12 行）vs `domain/prompt/logic/normalize-for-llm-export.ts` L7-10（直连 chat/content + chat/model）
- 矛盾点：L3 报告只标了 `normalize-for-llm-export.ts → chat` 这一条跨 context 引用，但 prompt 内部其实存在**两条并行的 chat 引用路径**：一条是 `message-body.ts` 这个 re-export shim（把 `messageBodyText` / `messageBodyTextFromBlocks` / `messageBodyTextFromContent` / `formatChatMessageForCliPreview` 从 chat/content 重新导出，文件头 `@module domain/prompt/message-body`——顺便说一句 m6 已记录这个 `@module` 路径与实际 `logic/` 位置不符），另一条是 `normalize-for-llm-export.ts` 直接 `from "../../chat/content/message-body-text.js"` / `"../../chat/model/message.js"`，绕过 shim。结果同一个 prompt 模块内，调用 `messageBodyTextFromBlocks` 时一部分文件走 shim 一部分文件走直连——比如 `service/prompt/normalize-orphan-tool-results-for-llm.ts` L10 走直连，`infra/tokenizer/impl/heuristic-token-counter.ts` 又通过 `domain/prompt/logic/message-body` shim 引。叠 L9 视角，shim 的存在本身也半死不活——它没有把所有 chat 引用收编，反而给后人一种「prompt 内部已经隔了一层」的错觉。
- 依据：message-body.ts 全文；normalize-for-llm-export.ts L7-10；服务层 normalize-orphan-tool-results-for-llm.ts 直连 chat；heuristic-token-counter.ts 走 shim。
- 建议：要么把 shim 撤掉、所有 chat 引用统一走直连（最干净，符合 L3「灰色面积应显式记录」的判断），要么把所有 prompt 内对 chat content 的引用都收编到 shim（更隔离，但会扩大 shim 表面积）。当前「shim 存在但不强制使用」是最差的一种状态。L3 报告下次回派时应同时标这两条路径。

### B1 `computeLlmExportZonesFromLayout` 与 `buildPromptLlmInputFromLayout` 对 `workplaceDisplay` 缺省值的契约不一致

- 涉及角度：L2（区边界算法）+ L4（缺省输入未校验）+ L7（无直接测试覆盖这个分歧）
- 位置：`service/prompt/render-prompt.ts` L57-79（compute）vs L151-164 + L166-188（append pair，segments 版 / messages 版）
- 矛盾点：`computeLlmExportZonesFromLayout` 接受 `workplaceDisplay?: string`，L62-65 的判定是 `injectWorkplace = layoutHasWorkplace(layout) && (options?.workplaceDisplay === undefined || options.workplaceDisplay.trim() !== "")`——也就是 **undefined 视为「注入」**。但实际写入 messages 的 `appendWorkplacePairIfPresent` L159 是 `if (ctx.workplaceDisplay.trim() === "") return;`——**undefined 会直接 throw TypeError**（`.trim()` on undefined）。`buildPromptAssemblyFromLayout` 走的 `appendWorkplacePairSegmentsIfPresent` L171 同样假设 `ctx.workplaceDisplay` 是 string。后果：如果某个调用方按 compute 的签名「合法地」省略 workplaceDisplay（layout.workplace 开着但没传 workplaceDisplay），compute 会返回 `persistCount += 2`（认为 workplace 双段在前面），但 build 那边要么 crash 要么不 push 这两段——zones 与实际 messages 数组长度偏差 2，下游 `normalizeForLlmExport` 按 zones 切区会把 chat 区错划进 persist / dynamic 区，跨区 merge 的 invariant 失效。生产路径（agent-runner L227-232）确实总是传 workplaceDisplay（由 assembleWorkplaceDisplay 算出），所以目前没踩到；但 public API 上两个函数对同一个字段给出矛盾契约，外部新消费者（如未来 CLI 工具、测试 fixture）很容易踩。
- 依据：render-prompt.ts L62-65 vs L159 / L171；L7/explore-prompt.md L259 / L308 已记录「`computeLlmExportZonesFromLayout` 缺直接单元测试」——这条契约分歧正是缺测试导致的盲区。
- 建议：要么把 compute 改成与 build 一致——`workplaceDisplay === undefined` 时不计入 inject（最稳），要么把 build 改成 `ctx.workplaceDisplay?.trim()` 容忍 undefined（语义上和 compute 对齐）。无论哪种，补一条单测：layout.workplace 开 + workplaceDisplay undefined，断言 compute 与 build 的输出 zones 一致。切片不改代码。

### B2 `PromptRenderContext.vfs` 字段是声明上的死代码，agent-runner 仍往里塞值

- 涉及角度：L9（死代码）+ 必查三（公共面类型与运行时行为不符）
- 位置：`domain/prompt/model/prompt-render-context.ts` L19（`readonly vfs?: VfsService;`）；调用方 `service/agent/impl/agent-runner.ts` L230（`vfs: this.deps.toolCtx.vfs`）
- 矛盾点：`PromptRenderContext.vfs` 字段注释自己写「Session VFS（其他调用方仍可传；`{{$filetree}}` 不再读取）」——明确承认字段已经退役。grep 验证：prompt 模块内部对 `ctx.vfs` / `.vfs` 的引用是 0，`expandDynamicMacros` L26-28 只用 `ctx.workplace?.renderFileTree()`。但 agent-runner L227-232 构造 promptRenderCtx 时仍然 `vfs: this.deps.toolCtx.vfs` 把这个字段填上。结果是公共面类型上声明了一个「可传」的字段，运行时也确实在传，但 prompt 模块根本不读——外部新消费者会以为「传 vfs 进去会影响 `{{$filetree}}` 渲染」，事实上完全不影响。
- 依据：prompt-render-context.ts L19 字段注释自承「不再读取」；agent-runner.ts L230 仍在传；expand-dynamic-macros.ts L26-28 只读 `ctx.workplace`。
- 建议：等下次 prompt 模块迭代时把 `vfs` 字段从 `PromptRenderContext` 拿掉，同步删 agent-runner 那行。在此之前至少把字段注释升级成 `@deprecated`，并在 `expand-dynamic-macros` 的 doc 里明确「`{{$filetree}}` 数据源已迁到 `workplace.renderFileTree()`」。

## 债务清单

| 严重度 | 项 | 涉及角度 | 位置 |
|--------|----|----------|------|
| **S** | `normalizeAgentPromptLayoutDomain` return 漏抄 `customAttach`，domain-shape 存储加载路径下 `prompts.customAttach` 被静默清空，agent-runner 注入 `<extra-info>` 失效 | L1 + 功能正确性 | `domain/prompt/logic/normalize-agent-prompt-layout.ts:58-67` |
| **A** | D1-02 / Context Bundle 把 prompt 宏展开标成「递归解析」，与代码事实（单遍线性）和 D1-02 正文自相矛盾，会误导后续 reviewer | L2 + L11 | `docs/review/phase1-lens/D1-02-algorithm.md:91` 标题 vs L95 正文；派遣 Context Bundle 描述 |
| **A** | L3「domain → service 0 violations」漏报 type-only imports，prompt 经 `PromptRenderContext` / `expandDynamicMacros` 类型耦合 `service/workplace` | L3 + 公共面 | `domain/prompt/model/prompt-render-context.ts:9`、`domain/prompt/logic/expand-dynamic-macros.ts:7` |
| **A** | prompt → chat 跨 context 双路径并存（shim + 直连），L3 只标了直连那条 | L3 + L9 | `domain/prompt/logic/message-body.ts`（shim）vs `normalize-for-llm-export.ts:7-10`（直连） |
| **A** | prompt-engine spec L201 「`index.ts` 导出 prompt API」已偏离实际（实际走 `public/prompt.ts` 子路径，core-package-structure 重构结果），spec 未同步 | 功能正确性 + L11 | `docs/Iterations/prompt-engine/spec.md:201` vs `packages/core/src/index.ts`（无 prompt） |
| **A** | `validatePromptBlocks` / `validatePromptBlocksFromMap` / `PromptBlock` / `shouldIncludePromptTextBlock`（如果还在）整套遗留 flat-block 路径已无生产引用（L9/explore-prompt M1 已记录），但仍挂在 `public/prompt.ts` 公共面 | L8 + L9 | `domain/prompt/logic/validate-prompt-blocks.ts`、`domain/prompt/model/prompt-block.ts`、`public/prompt.ts` |
| **A** | wire 序列化器 `persistBlockToWire` / `dynamicBlockToWire` 两处重复定义（M2 已记录），customAttach 这种新字段加入时两边都要改 | L1 + L9 | `domain/prompt/logic/agent-prompt-layout-wire.ts` + `domain/agent/model/agent-definition.schema.ts` |
| **B** | `computeLlmExportZonesFromLayout`（undefined → inject）与 `buildPromptLlmInputFromLayout`（undefined → throw）对 workplaceDisplay 缺省值契约不一致 | L2 + L4 + L7 | `service/prompt/render-prompt.ts:62-65` vs `:159/:171` |
| **B** | `PromptRenderContext.vfs` 字段已退役（注释自承「不再读取」），agent-runner 仍在传，公共面类型与运行时行为不符 | L9 + 公共面 | `domain/prompt/model/prompt-render-context.ts:19` + `service/agent/impl/agent-runner.ts:230` |
| **B** | 三个 prompt 校验器（validate-prompt-blocks / validate-agent-prompt-layout / agent-definition.schema）错误文案中英混用且 when-reject 文案与 agent-prompt-abstract-block spec 不一致 | 功能正确性 + m1 | `validate-prompt-blocks.ts:29`、`validate-agent-prompt-layout.ts:66`、schema |
| **C** | `MacroActionKind` unused export（L9 已记录）；macro-scan `parseAction` 返回 start/end 被调用方 spread 重写，先填再覆盖语义混乱（F19 已记录） | L9 | `infra/prompt-template/macro-scan.ts:9`、`:62/:78` |
| **C** | `rejectPersistMacros` 基于子串 `{{` 匹配（m4 已记录），含字面 `{{` 的非宏文本会误拒 | L2 | `domain/prompt/logic/validate-dynamic-macros.ts:60-66` |
| **C** | 测试密度 13/1628（D0-1 §6 给的是 13/1006 = 1/77；把 service + infra 算进来其实更稀），`computeLlmExportZonesFromLayout` 仍无直接单测（explore-prompt 已记录） | L7 | `packages/core/test/prompt/` |

## 与其他模块的耦合点

给 phase3 交叉用，以下点很可能被别的切片也命中：

- **agent context 的 `agent-definition.schema.ts` 持有 prompt wire schema**：`persistBlockValueSchema` / `dynamicTextBlockValueSchema` / `promptsDocumentSchema` 都在 agent 模块里定义，prompt 模块自己的 `validateAgentPromptLayoutFromMaps` 反而要等 agent 模块先把 wire 解析完。M2（wire 序列化器重复）就是这个耦合的副作用——agent 切片和 prompt 切片都会命中同一组 wire helper。
- **chat context 的 content / model / metadata**：normalize-for-llm-export 直连 + message-body shim 两条路径都吃 chat 的 `messageBodyTextFromBlocks` / `textBlocks` / `readMessageMetadata` / `ChatMessage` 类型。chat 切片如果改 message content 形状（比如 message-attachment-unified 那条线），prompt 这边会受影响——具体是 `isPlainTextOnly` / `hasNonEmptyAttachments` / `isVfsSemanticSegment` 这三个谓词会跟着变。
- **service/workplace**：prompt 类型耦合 `WorkplaceService`（A2）；运行时 `expandDynamicMacros` 调 `workplace.renderFileTree()`（数据源已从 vfs 迁到 workplace）。workplace 切片如果改 renderFileTree 签名，prompt 这边要同步。
- **infra/tokenizer**：`serializePromptLlmInput` 直接 wrap `formatPromptLlmInputForCliFromLayout`，prompt 序列化结果就是 token 计数的输入。L6 tokenizer 三端不一致（D2-compaction B1 / D2-provider-llm 都会命中）的根因会反向影响 prompt parity 测试的可信度——`prompt-assembly-parity.test.ts` 是基于 Node 端序列化的，mobile 端实际 token 计数走的是不同路径。
- **domain/depth**：`applyRegexChannelForLlm` 在 service/prompt 目录下但调 depth 模块的 `depthByMessageId` / `listVisibleForDepth`。这是 service/prompt 里**唯一**逻辑上跟 prompt 组装无关的文件——它只是借 prompt 的「LLM 视图管线」位置安家，应该归 regex 或 depth 模块的耦合点。
- **events-config**：compaction 已事件化，prompt 这边没有直接事件耦合，但 `agent-runner` 在 prompt 装配完成后 emit `session.compaction.requested`——也就是 prompt 装配的结果是 compaction 判定的输入。S1 的 customAttach 丢失会让 compaction token 计数也偏低（少算 extra-info 的字符数），间接影响 compaction 判定。

## 覆盖声明

**查了**：domain/prompt 全部 12 文件逐行读（model × 3、logic × 8，外加逻辑链上的 service/prompt × 3、infra/prompt-template × 3）；`public/prompt.ts` 全文；`src/index.ts` 全文（确认零 prompt 导出）；`domain/agent/model/agent-definition.schema.ts` 关于 prompts 的所有 schema 段；`service/agent/impl/agent-runner.ts` 的 prompt 装配相关行（L160-320）；`config-forms/stored-config-validity/assess-agent-definition-wire.ts` 全文（确认 S1 调用链）；`prompt-engine/spec.md` 关键章节（L9-40 设计目标 + 现状、L92-152 宏语法 + 拼接 + 上下文、L152-212 项目结构 + 变更点）；`agent-prompt-abstract-block/spec.md` 现状差距 + 测试用例段；`agent-worktree-block-ui/spec.md` computeLlmExportZonesFromLayout 段；`prompt-llm-input-parity/spec.md` 总体方案 + 已确认决策段；`core-explore-remediation/features/quality-backlog/explore-prompt.md` 全文（确认 M1-M4 / m1-m7 已记录的单角度发现，本切片只做交叉，不重复展开）；D1-01/D1-02/D1-03/D1-04/D1-05/D1-06/D1-07/D1-08/D1-09/D1-10/D1-11 中 prompt / macro / render / layout 相关命中；`@novel-master/core/prompt` 子路径在 apps 下的引用（grep 确认 18 次）；CHANGELOG `[1.4.17]` 关于 customAttach 的修复记录。

**没查**（及原因）：`prepareUserMessagesForPrompt` 的内部实现——它在 chat context 里，但调 prompt 的 expandDynamicMacros，属 chat 切片的职责，本切片只确认调用链；`infra/tokenizer` 的 `serializePromptLlmInput` / `countPromptLlmInput` 内部——属 tokenizer / D2-provider-llm 切片，本切片只确认它复用 `formatPromptLlmInputForCliFromLayout` 这个事实（parity 契约）；apps/desktop + apps/mobile 的 AgentDefinitionEditorForm / AgentEditorForm 对 customAttach 的 UI 流转——前端表单逻辑，本切片只确认它们读写 `prompts.customAttach` 字段，不影响 S1 的存储路径判断；agent-runner 完整循环（abort / doom-loop / tool turn）——属 agent 切片，本切片只追 prompt 装配相关那一段；`applyRegexChannelForLlm` 的 regex / depth 内部——属 regex / depth 切片，本切片只指出它「在 service/prompt 目录但语义不属 prompt」这个位置问题。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 评审发现。
