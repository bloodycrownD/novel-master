# D2a-L2：L2 算法 & 复杂度跨模块模式识别

## 元信息

- 角度：L2 算法 & 复杂度（含构建性能）
- 输入：D1-02-algorithm + D2-vfs / D2-chat-message / D2-compaction / D2-prompt / D2-agent-tool / D2-provider-llm + D0-1 god module 引用表 / D0-2 摇摆度打分
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly 跨模块聚拢，不读实现代码、不改任何文件、不宣布 ready

## 结论（叙述式）

诶～把 D1-02 的 20 条发现叠在 6 份切片上看完之后，原本以为是「散在 6 个模块里的小问题」，其实是 **3 条系统性反模式 + 1 条标签纠偏** 在反复出现。最值得 Phase 3 先看的是 **「热路径无缓存/重复计算」**——这条不是 sql-template 一个点的局部问题，而是在 sql-template（AST）、regex（编译产物 + 整体重跑）、tokenizer/prompt 序列化、vfs-path-mapper（单调用链内 3 次 normalize）这 **4 个不同的 parser/compiler 路径**上独立出现了同一种「不记上次结果，每次从零开始」的结构。这说明仓库里**缺一个统一的「跨调用结果记忆」约定**——每个 infra 模块都在各自重新发明缓存轮子（session-api-prompt-token-cache 用模块级 Map，sql-template 索性不缓存，regex 编译产物是否缓存 D1-02 当初没核实清楚），而不是有一个「热路径上的纯函数应该按输入指纹 memoize」的统一约定。

其次是 **「构建增量失效」** 这条。D1-02 当时把 `--force` 标 A 看起来是 core 单包的问题，但跨模块叠加 mobile/desktop 的 prebuild 链之后，真正的画面是：**`--force` 是 core 单点，但它通过「每个 driver / app 的 prebuild 都串行 `npm run build -w @novel-master/core`」这条链，把全量重编的成本辐射到了 mobile、desktop、CLI 三端的所有 driver 包**。也就是说，这条不是「core 内部性能问题」，是「monorepo 构建编排的全局税」。D2-vfs / D2-chat-message / D2-agent-tool 切片都在自己的迭代体验里付这个税（vfs 改一行 → mobile 重 build core → 5 个 driver 全跑一遍），只是没有切片把它单独标出来——它是 L2 角度才能看见的横切模式。

至于 D2-prompt 提到的「递归解析」标签错误，我核实了一下，**不影响跨模块判断**：D1-02 正文 L95 自己写的「线性推进 cursor，整段只扫一遍」是正确的代码事实，错的只是 L91 的章节标题措辞。F18 / F19 的复杂度评级（C 级、V8 优化下 <10³ 拼接无感）本来就是基于「单遍线性」打的，不依赖「递归」假设。所以这条标签只影响阅读 D1-02 的人的第一印象，不会让任何跨模块模式漏看或错看，把它当成 L11 文档措辞修正处理就够了。

另外要单独说一句：**「朴素 O(n²) diff」这个模式并不是 D1-02 之外还有其他模块命中**。我跨切片核了一遍——user-vfs-save-mapping 是唯一真正的 O(n²)+ diff（D2-vfs 把它列为单角度已认定项，本报告不重复）；message-checkpoint 的 rollback anchor 看起来像「diff」，但实际是「同一 messages 数组 3 次线性 find、没有 Map 索引」，是 O(N) × 3，不是 diff；vfs revision 的 reconcile 是批量 Set 比较，是健康的。所以 D1-02 把 diff 风险集中在 user-vfs-save-mapping 这条判定**经得起跨模块验证**，不需要扩散。

最后是 **god module 的跨模块影响**：`vfs-path-mapper` 42 次引用这个数 D1-02 标过 B（单次调用链 normalize 3 次），D2-vfs A1 又补了一层（ScopedVfsService + RevisionAwareVfs 双层叠加，zip import 路径 5000 entry × 3 = 15000 次 normalize）。叠加之后这条从 B 升到 A 是合理的，但根因不在 path-mapper 自己，而在「`assertLogicalPathAllowed` 不接受已 normalized 的入参、非要内部再 resolve 一次」这个**接口形态**问题——属于 L2 角度能识别、但整改建议要和 L3 一起裁决的类型（因为同时是架构分层议题）。

整体严重度：**S 级 0 条、A 级 3 条（无缓存重复计算、构建增量失效、path-mapper 接口）、B 级 1 条（标签纠偏）**。Phase 3 优先裁决的是「无缓存重复计算」和「构建增量失效」这两条，因为它们都是「修一次受益全仓」的类型，整改 ROI 高。

## 跨模块模式清单

### 模式 1：热路径无缓存 / 重复计算

- 类型：同一反模式多处出现（类型 1）
- 出现模块：sql-template（infra）、regex（domain）、tokenizer/prompt 序列化（infra + domain）、vfs-path-mapper（domain）
- 共同特征：在 AgentRunner 每一轮 loop 都会触达的热路径上，纯函数式「按输入重新计算、不记上次结果」。具体形状有四种变体：

  | 变体 | 位置 | 重复的内容 | 单次成本 | 频率 |
  |------|------|-----------|---------|------|
  | **AST 重 parse** | `infra/sql-template/index.ts` 的 `SqlTemplateParser.parse` | 模板字符串 → AST（同模板每次都重 parse） | <0.5ms | 每个 repo 方法 1 次，agent 一轮几十次 |
  | **JS 表达式重编译** | `infra/sql-template/expression.ts` 的 `evaluateTest` | `new Function("__ctx__", "return (...)")` 每次 if/when 都重新生成函数对象 | 小，但 foreach × if 组合放大 | foreach 内每个 item × 1 |
  | **regex 规则可能重编译** | `domain/regex/logic/resolve-active-regex-rules.ts` 调 `listCompiledRulesForGroup` | 每个 `new RegExp` 是否在 service 层缓存，**D1-02 F17 仍标「待核实」** | 单规则编译有成本 | 每轮 agent loop 都走一遍 |
  | **regex 全量重 apply** | `domain/regex/logic/apply-regex-rules.ts` 经 `applyLlmRegexChannelToVisible` | 没有增量 diff——上一轮已经变换过的 messages，下一轮还会从头跑一次完整 regex 替换 | O(M × R × L) | **每轮 agent loop 都跑**（D2-agent-tool 模块画像确认 agent-runner 是唯一调用方） |
  | **prompt 序列化重跑** | `infra/tokenizer/.../count-prompt-llm-input.ts` + `serializePromptLlmInput` | 同一个 prompt 序列化成字符串、再过 heuristic counter——一次 agent step 内会和 `renderPromptLlmInput` / `applyLlmRegexChannelToVisible` 重复跑（D1-02 compaction-conditions 段已标） | O(总字符数) | token 计数每次 miss 都重跑 |
  | **token cache 无上限** | `infra/tokenizer/.../session-api-prompt-token-cache.ts` | 这一条不是「无缓存」，反而**是仓库里唯一显式做了模块级 memoize 的热路径**，但缺 LRU / 跨会话清理（D1-02 F7） | O(1) 命中 | 长跑进程累积 sessionId |
  | **path normalize 单链 3 次** | `domain/vfs/logic/vfs-path-mapper.ts` + `ScopedVfsService` + `RevisionAwareVfsService` | `resolveLogicalPath` → `assertLogicalPathAllowed`（内部又 resolve）→ `RevisionAwareVfs.writeWithRevision`（再 normalize） | O(段数 <10) | 被 42 处引用 × 每次调用 3 次（D2-vfs A1） |

- 各模块差异：
  - **sql-template 是「输入恒定（模板字符串是源码常量），最适合加 `Map<template, AstNode[]>` 缓存」**——D1-02 F1 给的修复方向，零设计风险。
  - **regex 编译缓存是否缺失至今没人核实**——这是 L2 跨模块比对里最尴尬的一个洞：D1-02 F10 / F17 都标「待核实 `RegexConfigService.listCompiledRulesForGroup` 是否真缓存」，6 份切片没有一份往 regex service 内部深入（regex 是横扫-only 模块，没进切片）。这条建议 Phase 3 先派一次回派把这一层落实，再决定 regex 这一组要不要算进模式 1。
  - **regex 全量重 apply 是「算法正确、缺增量」**——和 sql-template 的「缺缓存」不是同一种病，但都属于「每轮 loop 多干一份本可省的活」，所以归在同一模式下。
  - **prompt 序列化重跑**是 D1-02 在 compaction-conditions 段提的：`tokenRatio` 命中时，token 计数会和 `renderPromptLlmInput` 在同一步内重复序列化整个 prompt。这条 D2-compaction 切片没单独标（它只关心 `estimateTokens` 旧路径污染公共面），所以从跨模块视角补一笔。
  - **token cache 是反向例子**——它是仓库里唯一做对的事，但反过来证明「memoize 在仓库里是个偶发习惯，不是约定」。

- 系统性根因：仓库缺一个统一约定——**「AgentRunner 主循环里反复触达的纯函数应当按输入指纹 memoize」**。每个 infra 模块各自决定要不要缓存（sql-template 决定不缓存、tokenizer 决定缓存、regex 编译产物的去留没人管），没有公共的 memoize helper、没有 ARCHITECTURE.md 的指引、没有性能测试约束。这跟「repo 缺一个 `@memoize` 装饰器 / WeakMap 工具」是同一类架构层缺失。

- 严重度：**A**。不是 S，因为目前没有生产可观察的卡顿（单次成本都低），但「每轮 loop 都多干一份」是**线性累加**到用户感知延迟上的——agent 多轮对话每多一轮，这几条同时多付一遍成本。

- 建议方向（不改代码，只描述方向）：
  1. 优先把 **sql-template 的 AST 缓存**做掉（D1-02 F1 已经标过、修复成本极低、收益直接）；
  2. **派一次回派核实 regex 编译缓存**（F17）——这是当前 L2 视角最大的不确定项；
  3. 长期方向：在 core 里立一个 memoize helper（比如 `createImmutableCache<TIn, TOut>(getKey, compute)`），ARCHITECTURE.md 写一句「AgentRunner 主循环里反复调的纯函数应优先 memoize」，让「要不要缓存」从「每个 infra 模块各自决定」变成「有约定可循」。

### 模式 2：构建增量失效的跨包辐射

- 类型：同一反模式多处出现（类型 1）+ god module 影响（类型 3，core 是被反复重编的中心节点）
- 出现模块：core（`--force` 源头）→ mobile / desktop / CLI 三端所有 driver 包（受害者）
- 共同特征：D1-02 把构建侧标了 7 条发现（F3–F16）。把它们叠起来看，真正的画面是「**`--force` 在 core 是单点，但它通过 prebuild 链辐射到全仓所有包**」。具体路径：

  ```
  core/package.json: --force              ← D1-02 F3（源头）
        ↓
  TS 项目 references 未建立                ← D1-02 F4（让下游无法靠 .tsbuildinfo 知道 core 没变）
        ↓
  apps/mobile/preandroid: 串行 build 5 个 workspace + webview   ← D1-02 F5
  apps/desktop/prebuild: 串行 build 6 个 workspace              ← D1-02 F14
        ↓
  三端 dev/watch 不覆盖 core 改动          ← D1-02 F16
        ↓
  改一行 core → 三端各自重编 core 一次（tsc / vite / Metro 三套独立缓存） ← D1-02 F15
  ```

- 各模块差异：
  - **`--force` 是单点 A**（D1-02 F3），但单独看它只是「core 每次全量重编 ~30K 行」。
  - **TS 项目 references 未建立是放大器**（D1-02 F4）——base 配了 `composite:true`，但 core / 各 driver 的 tsconfig 都没 `references`，等于「workspace 拓扑」和「TS 增量拓扑」是两套独立系统。这条不解决，去掉 `--force` 也只能让 core 单包增量，跨包复用还是不生效。
  - **mobile prebuild 链的体验税最重**（D1-02 F5）：`preandroid` / `prestart` / `preios` 每个都串行 build 5 个 workspace + webview，连跑 `npm run pretest && npm run android` 会让 core 重编 ≥2 次。RN 开发循环本身就是高频触发，每次都付全部 5 个包的 build 成本。
  - **desktop prebuild 是 6 个串行 build**（D1-02 F14），单独 B，连跑升级 A。
  - **三端缓存完全独立**（D1-02 F15）：同一段 core 代码在 desktop dev 启动时被 vite/esbuild 编一次、mobile start 时被 Metro 编一次、core build 时被 tsc 编一次——这是多端 monorepo 的天然代价，单点优化空间有限。

- 系统性根因：**「monorepo 的 workspace 拓扑和 TS 的增量构建拓扑是两套独立系统」**。`tsconfig.base.json` 配了 `composite:true`（暗示要用项目引用），但没有任何包真正配 `references`；与此同时 `--force` 让 core 自己的 `.tsbuildinfo` 也失效。两层叠加 = 「core 改一行 → 全仓所有包都要全量重编一遍」。

- 严重度：**A**。影响面是全仓三端 + 所有 driver 包（不是 S，因为没有功能性 / 数据正确性后果，纯粹是开发体验和 CI 时长）。

- 建议方向：
  1. 先去掉 core build 的 `--force`（D1-02 F3），让 `.tsbuildinfo` 生效——这是零成本、零风险、收益直接的第一步；
  2. 然后在 core / 各 driver 包的 tsconfig 里建立 `references` 拓扑（D1-02 F4），用 `tsc --build`（不带 `--force`）从根驱动整个构建图——这条做完，mobile/desktop 的 prebuild 链会自动跳过未变更的包；
  3. 三端缓存独立（F15）属于天然代价，单点优化空间有限，不建议优先；
  4. 顺手核实 D1-02 自评里那条「去掉 `--force` 后实测 build 时间变化」——这是验证整个模式 2 修复收益的最直接证据。

### 模式 3：path-mapper 单调用链 3 次 normalize（god module 跨模块放大）

- 类型：god module 的跨模块影响（类型 3）
- 出现模块：domain/vfs（自身）→ 被 vfs 几乎所有 service 消费 → 被 chat-message（rollback 路径）、agent-tool（vfs tools 调用）间接消费
- 共同特征：D1-02 F6 标过 B 级「`toPhysicalPath` 单次调用链 normalize 跑 3 次（resolveLogicalPath + assertLogicalPathAllowed 内部再 resolve + 自身 normalizePath）」，D2-vfs A1 在切片层面又补了一层「ScopedVfsService + RevisionAwareVfsService 双层叠加，13 个方法每个都重复这套 normalize」。叠加效应在 zip import 路径上最明显：`vfs-zip-validate.ts` 的 `assertLogicalAllowed(scope, logical)` 在循环里对每条 zip entry 调一次，5000 条 entry = 5000 × 3 = 15000 次 normalize。

- 各模块差异：
  - L1 / L4 / L5 切片各自关心 `vfs-path-mapper` 的不同侧面（数据模型、错误链、串行 await），但**只有 L2 角度看到「单次调用链里重复 3 次同一种纯函数」这种「重复计算」模式**。
  - 这个模式和模式 1 在「重复计算」上是同构的，但区别在于：模式 1 是「跨调用不缓存」，模式 3 是「单次调用链内部冗余调用」——前者要加跨调用 memoize，后者只需要让下游函数接受已 normalized 的入参、不要内部再 resolve。修法不同，所以单列。

- 系统性根因：**`assertLogicalPathAllowed` 的接口形态问题**——它不接受「已经 normalize 过的路径」作为入参，非要内部再 `resolveLogicalPath` 一次。D2-vfs A1 给的方向是「让 `assertLogicalPathAllowed` 接收已 normalized 的路径」——这是接口整改，属于 L2 角度能识别、但整改建议要和 L3 一起裁决的类型（同时是分层议题）。

- 严重度：**A**（D2-vfs A1 把它从 D1-02 的 B 升到 A，本报告认同）。被 42 处引用 + 单次调用链 3 倍功 + zip import 5000 entry 放大路径，叠加效应可量化。

- 建议方向：照 D2-vfs A1 的方向——让 `assertLogicalPathAllowed` 接收已 normalized 的路径，调用方传 normalized 进来；改完后单次调用链 normalize 从 3 次降到 1 次，对 42 个引用点整体省 2/3 的 normalize 调用。这条 L2 视角的整改建议和 D2-vfs A1 一致，不重复展开。

### 模式 4（标签纠偏，非真反模式）：D1-02「递归解析」措辞错误，不影响跨模块判断

- 类型：横扫报告措辞 bug（类型 4 的反面——不是模式，是模式识别的噪音，单列出来澄清）
- 出现位置：D1-02 L91 章节标题「prompt-template（macro-scan + macro-render，**递归解析**）」 vs D1-02 L95 正文「**线性推进** cursor，**整段只扫一遍**，O(template 长度)」；D2-prompt A1 提出纠偏。
- 跨模块判断：**不影响**。
  - D1-02 给 prompt-template 打的复杂度评级（F18 C 级、F19 C 级）本来就基于「单遍线性扫描、V8 优化下 <10³ 拼接无感」这个正文假设，不依赖「递归」。
  - 这个模块也不在任何跨模块热路径上重复出现（prompt-template 只在 prompt 装配里被调一次，没有像 sql-template 那样每 agent loop 重跑）。
  - 它没有扩散成跨模块模式的风险——切片没在任何其他模块看到「prompt 宏展开结果含新宏 → 再展开」这种递归调用。
- 处理建议：按 D2-prompt A1 的方向，把 D1-02 L91 标题改成「prompt-template（macro-scan + macro-render，单遍线性扫描）」，Context Bundle 派遣描述里去掉「递归解析」字样。这条归 L11 文档措辞修正批次，不进 L2 整改清单。
- 严重度：**B**（只影响后续 reviewer 阅读横扫报告的第一印象，不影响任何技术判断）。

## 覆盖声明

**读了**：
- D1-02-algorithm 全文 443 行（含 20 条发现清单 + 7 条构建发现 + 7 条待交叉线索 + 自评）。
- 全部 6 份 Phase 2 切片的完整正文：D2-vfs、D2-chat-message、D2-compaction、D2-prompt、D2-agent-tool、D2-provider-llm。
- D0-1 §3 god module 引用表（确认 `vfs-path-mapper` 42 次、`vfs-entry.port` 28 次的引用密度）。
- D0-2 §1 / §2 摇摆度打分（确认 vfs 17 迭代、chat+message-checkpoint 23 迭代是高摇摆区，与 L2 发现的分布对齐）。

**没读**（按指导文档约束，是 Phase 1 / Phase 2 的职责，不重复）：
- 任何实现代码源文件——指导文档明确「不读实现代码：你的输入是 D1 + D2 报告」。
- regex service 层（`RegexConfigService.listCompiledRulesForGroup` 的内部缓存实现）——这是 D1-02 F17 留的 open question，**建议派一次回派**，不在本报告范围。
- D2-vfs / D2-chat-message / D2-compaction 切片里 L1 / L4 / L5 角度的发现（那些不属于 L2 跨模块聚拢范围）。

**L2 单角度发现 vs 切片新增的边界**：
- 严格只做跨模块聚拢。D1-02 已经标过的 20 条（F1–F20）只在模式清单里按需引用，不重新展开。
- 切片层面对 L2 的增量补充只有三条：D2-vfs A1（path-mapper 双层叠加升 A）、D2-vfs F4（同文短路依赖 content-blob 解码）、D2-prompt A1（标签纠偏）——这三条都被吸收进上面的模式里了。

## 给 Phase 3 的线索

- **优先级最高的裁决**：模式 2（构建增量失效）。因为它是「修一次受益全仓三端」的类型，ROI 最高，且整改顺序清晰（先去 `--force` → 再建 `references`）。Phase 3 应当把它和 L10（基建一致性）合评，因为 tsconfig 拓扑同时是 L10 的范围。
- **次优先裁决**：模式 1（无缓存重复计算）里的 sql-template AST 缓存（D1-02 F1）。修复成本极低、收益直接、零设计风险，建议 Phase 3 直接列入「快速止血批次」。
- **需要回派的开放问题**：D1-02 F10 / F17——regex 编译产物是否在 `RegexConfigService.listCompiledRulesForGroup` 里被缓存？这条不解决，模式 1 的「regex 编译可能重跑」就只能停留在「待核实」状态，无法判定严重度。建议 Phase 3 在裁决模式 1 之前先派一次回派。
- **可能和别的角度冲突**：
  - 模式 3（path-mapper 接口整改）和 L3 架构角度可能冲突——`assertLogicalPathAllowed` 改接口形态涉及分层契约，L3 可能有自己的判断。
  - 模式 1 里 regex 全量重 apply（D1-02 F10）的整改方向（加增量 diff）可能和 L4 / L5 冲突——regex 替换涉及可见性 / 不可见性的 invariant，增量改造容易引入状态一致性 bug，L4 / L5 应当先评估。
  - 模式 2 去掉 `--force` 的前提是「没有依赖 `--force` 的隐藏 bug」——D1-02 F3 自己标过「未找到 --force 原因的佐证」。如果 Phase 3 评审时发现历史确有某个增量 bug 被 `--force` 绕过，需要先记录这个 bug 再去 `--force`，不能盲删。
- **摇摆度交叉**：D0-2 给的模块摇摆度打分里，vfs（33 分）和 chat+message-checkpoint（41 分）是双最高——L2 的发现也集中在这两个模块（path-mapper 在 vfs、串行 round-trip 在 vfs+chat、anchor 多次遍历在 message-checkpoint）。这印证了「每次迭代都在改同一个地方但没改对算法层」的判断：vfs 17 迭代、chat+rollback 23 迭代改的都是数据模型和事务边界，**算法层的债务从 L2 角度看一直没被单独清理过**。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 评审的跨模块聚拢。
