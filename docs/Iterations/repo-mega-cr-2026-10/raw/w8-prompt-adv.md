---
zone: w8-prompt-adv
agent: advocate（辩护人）
files_scanned:
  - packages/core/src/domain/prompt/model/agent-prompt-layout.ts
  - packages/core/src/domain/prompt/model/prompt-block.ts
  - packages/core/src/domain/prompt/model/prompt-render-context.ts
  - packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts
  - packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts
  - packages/core/src/domain/prompt/logic/message-body.ts
  - packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts
  - packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts
  - packages/core/src/domain/prompt/logic/should-include-dynamic-block.ts
  - packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts
  - packages/core/src/domain/prompt/logic/validate-dynamic-macros.ts
  - packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts
  - packages/core/src/service/prompt/render-prompt.ts
  - packages/core/src/service/prompt/apply-thinking-context-for-llm.ts
  - packages/core/src/service/prompt/normalize-orphan-tool-results-for-llm.ts
  - packages/core/src/service/prompt/resolve-preview-thinking-context.ts
  - packages/core/src/domain/format/format-char-count.ts
  - packages/core/src/domain/format/format-stream-metrics-line.ts
  - packages/core/src/domain/format/sliding-token-rate.ts
  - packages/core/src/domain/format/stream-final-rate.ts
  - packages/core/src/domain/format/stream-token-anchor.ts
---

# W8 对抗机位 · 辩护人报告（domain/prompt + domain/format + service/prompt）

## 摘要

这三块是「提示词装配」的唯一真源：把 agent 配置里的三区布局（system + skills 索引 + workplace 双段 + persist + 会话区 + dynamic）渲染成 LLM 入参 messages/system，并把这条链路上四个 view-time 变换（区内合并、thinking 剥离、孤儿工具块归一、macro 展开）与全部展示口径（预览分段、CLI 文本、token 估算、流式速率/文案）收成纯函数。共 21 个文件、约 2415 行生产代码，是全仓 token 成本与 provider 前缀缓存命中率的直接决定面。

## 职责与边界

- **布局域模型与 wire 契约**：`model/agent-prompt-layout.ts` 定义 `AgentPromptLayout`（system/persist/dynamic/workplace/customAttach/skillsEnabled/skillsPrefix）；`logic/agent-prompt-layout-wire.ts` 是唯一的 block→wire 序列化点。
- **读入校验与形态归一**：`validate-agent-prompt-layout.ts`（wire map→域对象，全量报错文案）、`validate-dynamic-macros.ts`（宏白名单）、`normalize-agent-prompt-layout.ts`（旧 worktree 块 strip、域形态归一）。
- **装配**：`service/prompt/render-prompt.ts` 是唯一装配器——同一份三区遍历同时产出 LLM 入参、预览分段卡片、CLI 文本（后两者复用前者，无第二实现）。
- **出站变换**：`normalize-for-llm-export.ts`（区内合并 + openai 后处理）、`apply-thinking-context-for-llm.ts`（thinking 门控）、`normalize-orphan-tool-results-for-llm.ts`（孤儿 tool_result/tool_use 归一）。
- **展示口径**：`domain/format/*` 五个纯函数（token 速率滑窗、末值快照编解码、基线+增量锚点、指标条文案、紧凑整数）。

**明确的边界外**（相邻域负责、本区只消费其接口）：VFS/KKV 读取、workplace 前缀组装、provider 协议适配、chat 消息落库。

## 对外接口

全部经 `packages/core/src/public/prompt.ts` 与 `public/format.ts` 两个 barrel 出面。

`prompt.ts`：`PromptError` / `PromptErrorCode`、`AgentPromptLayout` 及 4 个 block 类型、`DEFAULT_WORKPLACE_ASSISTANT_TEXT` / `WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT` / `layoutHasWorkplace`、`shouldIncludeDynamicBlock`、`messageBodyText`、`validateAgentPromptLayoutFromMaps` / `validateAgentPromptLayout` / `resolveWorkplaceFromWire`、`normalizeForLlmExport` + `LlmExportZones`/`LlmExportZone`、`applyThinkingContextForLlm` + `ThinkingContextOptions`、`resolvePreviewThinkingContext` + 两个入参/出参类型、`ALLOWED_DYNAMIC_ROOT_MACROS` / `validateDynamicMacros`、`expandDynamicMacros`、`buildPromptAssemblyFromLayout` / `buildPromptLlmInputFromLayout` / `computeLlmExportZonesFromLayout` / `formatPromptLlmInputForCliFromLayout` / `buildPromptPreviewSegmentsFromLayout`、以及 `PromptAssemblySegment` / `PromptAssemblyOptions` / `PromptPreviewSegment` / `PromptRenderContext` / `PromptSkillIndexEntry` / `PromptLlmInput`。

`format.ts`：`formatCharCount`、`buildStreamMetricsLine` / `formatStreamElapsed` / `StreamMetricsLineInput`、`SLIDING_TOKEN_RATE_WINDOW_MS` / `createTokenRateSampler` / `slidingTokenRate` / `TokenRateSample` / `TokenRateSampler`、`serializeStreamFinalRateSnapshot` / `parseStreamFinalRateSnapshot` / `StreamFinalRateSnapshot`、`composeStreamTokens` / `reanchorStreamTokenBase`（外加就近转出的 `createIncrementalTokenCounter` 与 `StreamTokenSource` 类型）。

## 数据访问

本区**不直接触碰任何表、KKV 域或文件路径**，是纯逻辑层。间接依赖（经 ctx / 端口注入，不在本区发起）：

- `WorkplaceService.renderFileTree()` —— 经 `WorkplaceService` 端口注入，`expand-dynamic-macros.ts:35` 调一次；回合级快照在 `agent-runner.ts:394` 的 `resolveTurnFiletreeSnapshot` 预取（`agent-runner.ts:1137-1142`）。
- session KKV `final_rate` 类快照 —— `domain/format/stream-final-rate.ts` 只做**值的编解码**，不含表名；域常量侧写明出处 `domain/session-kkv/model/session-kkv-domains.ts:26`。
- `SavedModelRepository.findById` / `ProviderRepository.findById` / `PersistentPreferences.getThinkingContextEnabled` —— 经端口窄切片注入（`resolve-preview-thinking-context.ts:28-39`）。
- `domain/format/*` 另经 `chat-token-estimate-memo.ts:209` 消费 `layout.skillsEnabled` 作为估算记忆键的一部分。

## 依赖关系

**import 谁**

- 域内互引：`model/agent-prompt-layout.ts` → `model/prompt-block.ts`（仅取 `PromptBlockLifecycle`）；`logic/*` → `model/*`；`service/prompt/render-prompt.ts` → `logic/expand-dynamic-macros` + `logic/should-include-dynamic-block` + `logic/normalize-for-llm-export`(类型) + `model/*`。
- 跨域出向：`domain/chat/content/message-body-text.ts`、`text-blocks.ts`、`model/message.ts`、`model/message-metadata.ts`、`domain/workplace/...`（测试）、`domain/agent/logic/resolve-saved-model-id.ts`、`domain/provider/logic/infer-llm-protocol-from-model-id.ts`、`infra/prompt-template/{macro-render,macro-scan,week-cn}.js`、`infra/date-format.js`、`infra/llm-protocol/ports/adapter.port.js`（类型）、`infra/tokenizer/logic/incremental-token-counter.js`。
- **无反向 import**：本区不 import `service/`（除自身 `service/prompt/`）与 `infra/db*`，符合分层。

**被谁消费**

- `service/agent/impl/agent-runner.ts`：`buildPromptLlmInputFromLayout`(498) → `computeLlmExportZonesFromLayout`(553) → `normalizeForLlmExport`(566) → `applyThinkingContextForLlm`(574) → `normalizeOrphanToolResultsForLlm`(580)，即整个出站链的唯一编排点。
- `service/agent/logic/run-agent-turn.ts` / `default-subagent-definition.ts`：布局模型与 toolCtx.skills 装配。
- `config-forms/agent/agent-editor-state.ts` + `stored-config-validity/assess-agent-definition-wire.ts`（经 `normalizeAgentPromptLayoutDomain`，:86）：双端配置表单与存量有效性判定。
- `domain/agent/model/agent-definition.schema.ts:82`（经 `stripLegacyWorktreeBlocksFromPersistMap`）。
- `infra/tokenizer/logic/{serialize-prompt-input,count-prompt-llm-input,resolve-current-prompt-tokens,chat-token-estimate-memo}.ts`：token 估算链，`serializePromptLlmInput` 直接吃 `formatPromptLlmInputForCliFromLayout`。
- `infra/tokenizer/impl/heuristic-token-counter.ts:8`：经 `message-body` shim 取 `messageBodyText`。
- `apps/mobile/src/services/prompt-preview.service.ts:12,81,100`、`apps/mobile/src/services/session-stream-unit.ts:47,324,652,668`、`apps/mobile/src/services/session-stream-unit-manager.service.ts:103,1785`、`apps/mobile/src/hooks/useAgentStreamMetrics.ts:11,50`。
- `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:22,24,127,184`。
- 测试：`packages/core/test/prompt/` 17 个文件 + `test/domain/format/` 4 个 + `test/service/prompt/` 3 个。

## 发现清单

> 本机位立场为辩护：前 7 条是**主动举证的合理性论证**（含「我知道检察官会攻这里，这是我的抗辩」），后 9 条是**确无辩可辩、必须让出的让步**，按严重度排序。

### 辩护理由清单

**F-w8-prompt-adv-D1 | 布局构建：单一装配器 + 三区边界显式建模，是必要而非过度设计 | 强**

检察官大概率会攻「`buildPromptAssemblyFromLayout` 与 `buildPromptLlmInputFromLayout` 两份遍历是重复」。抗辩：它们不是同一件事的两份实现，而是**同一份布局投影到两种 wire 形态**——前者产出 `PromptAssemblySegment`（带 `id/title/source`，供双端预览卡片折叠渲染），后者产出 `ChatMessage[]`（带 `id/sessionId/seq/raw`，供 adapter 出站）。两者下游的数据契约不同（预览要 title、adapter 要 seq/raw），无法共用。真正重复的只有三区顺序，而它被 `prompt-assembly-parity.test.ts:31` 的 `serializePromptLlmInput === formatPromptLlmInputForCliFromLayout` 等式断言钉住——顺序漂移会立刻红。

**F-w8-prompt-adv-D2 | 宏展开时机（回合快照）是缓存命中率的直接买单方，非过早优化 | 强**

`expand-dynamic-macros.ts:16-20` 的 `filetree` 快照优先级、`agent-runner.ts:394` 的 `resolveTurnFiletreeSnapshot` 一次性预取，构成 RULE.md 第 19 行「回合快照（macro turn snapshot）」的完整落地：dynamic 宏与 customAttach 的展开值在 run 开始取一次，回合内所有 step 复用同一份文本。若退回每 step 实时，`$time` 每步变化会让会话区尾部（`<extra-info>` 注入位）从序列中部失效，整个回合积累的工具轮次在 provider 侧全部 cache miss——这是全仓最贵的一处无谓损失。且预检走 `collectMacroExpandableText(...).includes("$filetree")`（`agent-runner.ts:1141`），不含宏时零预取，不含 IO 成本。

**F-w8-prompt-adv-D3 | thinking 门控的「档位前置全局门」是协议硬约束，不是保守取值 | 强**

`apply-thinking-context-for-llm.ts:4-16` 的模块注释已给出完整论证：anthropic mapper 无条件映射 thinking 块，`body.thinking` 缺失时保留任何 thinking 块都会 400。所以 `requestThinkingEnabled === false` 时**在判开关之前**一律全剥（:91-93），把「协议最低保留」分支彻底置于不可达——这是把一条会 400 的路径在纯函数层就掐死，而不是等 adapter 抛错。`requestThinkingEnabled` 的来源（`agent-runner.ts:331-333`）与 `model-request.service` 的 thinking 解析同口径（`thinkingLevel !== "off"`），`savedModelForAppend == null` 取 true 是保守方向（该请求本身会被 `MODEL_NOT_SAVED` 拦下，取值仅占位）——保守方向的选择在注释里写明，不是随手兜底。

**F-w8-prompt-adv-D4 | thinking 门控的「开态全量保留 / 关态协议最低保留」是行业标准做法，且与预览侧口径同源 | 强**

`apply-thinking-context-for-llm.ts:8-10` 明确对齐 opencode / deepseek-harness 实践：开态**全量保留**（含签名、不重排、不删改），避免历史 thinking 被裁剪后触发签名校验失败。`resolve-preview-thinking-context.ts` 把「偏好 + 档位 + 协议」快照抽成单一实现供双端 prompt-preview 共用，边界判定仍留在同一个纯函数里——这正是为了消灭双端口径漂移（历史消息数组与入参一致，预览与 wire 输出一致，模块注释 :15-16 给了这个不变式的理由）。`retainProtocolMinimum` 由调用方置 false（预览不向用户暴露协议细节）是有意的信息分层，不是遗漏。

**F-w8-prompt-adv-D5 | 区内合并的「跨区永不 merge + VFS 段不 merge」是语义约束，不是过度保守 | 强**

`normalize-for-llm-export.ts:69-84` 的 `canMergeAdjacent` 有五道闸：跨区、role 不同、含非 text 块、VFS 语义段（`user_vfs_action`/`user_vfs_ack`/`tool_turn_bridge`）、带非空 attachments。每一道都对应一类会改变模型可见语义的情况：VFS 段合并会把「用户操作 + 系统确认」两条语义消息压成一条，模型就分不清哪句是确认；attachments 合并会让 hydrate 位置错位。跨区不 merge 的理由同样具体——persist 区的 assistant 块与 dynamic 区的 user 块合并会破坏 `validate-agent-prompt-layout.ts:272-283`（persist 末块须 assistant）与 `:285-299`（dynamic 首块须 assistant、末块须 user）这两条**首尾配对不变量**，合并等于把校验时保证的序列形态在出站时拆掉。

**F-w8-prompt-adv-D6 | 「保持 sync、不在此 hydrate」是分层纪律，不是能力缺失 | 中强**

`normalize-for-llm-export.ts:156` 的 `**保持 sync**` 是本区最容易被误读的一行。抗辩：async hydrate 属于 chat 域（`prepareUserMessagesForPrompt`），本区拿到的已经是 wrap 过的内存消息。在纯归一函数里开 async，等于让每次出站多一个 Promise 挂起点，且把 IO 语义泄进一个本可以确定性地单测的纯函数。职责边界写在这里，比写散在调用方更不容易破。

**F-w8-prompt-adv-D7 | 校验层的报错文案与 legacy 兼容面是产品资产，不是冗长 | 中强**

`validate-agent-prompt-layout.ts` 367 行里大量是**面向用户的中文报错**：`:84-86` 旧 worktree 块引导去 `prompts.workplace`、`:37-42` 旧 dot 宏引导去 `{{$filetree}}`、`:64-68` `when` 字段已移除。这些是存量 YAML 用户唯一能看懂迁移路径的入口，删掉等于把迁移成本转嫁给用户。`resolveWorkplaceFromWire`（:35-57）保留 `workplace: true → WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT`（`agent-prompt-layout.ts:49`，字面 `【done】`）是有意的 wire 兼容：存量配置里写 `workplace: true` 的会话不能因为升级而丢失常驻工作区。

**F-w8-prompt-adv-D8 | 不可变返回 + 原引用复用是刻意的性能契约 | 中强**

`normalize-for-llm-export.ts:118-127`、`apply-thinking-context-for-llm.ts:69-71,99`、`normalize-orphan-tool-results-for-llm.ts:77,98` 全部遵循「无变更返回原引用」。在每 step 都要跑一遍的出站链上，一次浅拷贝省不掉但**能让下游 memo 命中**（例如 `chat-token-estimate-memo` 按前缀指纹判增量）。这是与 `normalizeOrphanToolResultsForLlm` 同款的模式，模块注释 :18-19 点明。

**F-w8-prompt-adv-D9 | 滑窗速率（时间窗制而非事件 EWMA）是慢速流下的正确选择 | 中强**

`sliding-token-rate.ts:5-6` 给出选型理由：慢速流（5 t/s、delta 稀疏）按事件更新会长时间冻结显示。窗口内样本淘汰、未来样本（时钟回拨残留）不参与、`nowMs - first.tMs <= 0` 返回 null 三条边界（:53-76）都是为了「不显示除零/首秒抖动」。采样器的**校正点重 seed** 两类（`source` 翻转、窗口折叠）都在 :92-104 写明理由，且明确拒绝「每次 usage 都清窗」——因为 gemini 每个候选块都 emit usage，逐条清窗会把速率段反复清成 null（这是实跑过的回归）。这条口径已固化进 RULE.md 第 96 行（用户 2026-09-26 拍板）。

**F-w8-prompt-adv-D10 | 「格式化收口到 core 单点」是为消灭双端口径漂移 | 中强**

`format-stream-metrics-line.ts:26-28`、`stream-token-anchor.ts:4-7` 的模块注释都点明：双端曾各写一份且命名不一致（mobile 叫 `baseTokens`/`reanchorBase`、desktop 直接内联算式），收口后「公式要改只改这一处」。`format-char-count.ts`（4 行）看似过度，但它是 `buildStreamMetricsLine` 的唯一依赖、且经 `public/format.ts` 出面给编辑器字数统计共用——单点声明的成本是 4 行，收益是双端不会各写一个 `toLocaleString`。

### 让步清单（确无辩可辩）

**F-w8-prompt-adv-1 | P2 | render-prompt.ts:81 vs :358-362 | skillsEnabled 门在装配侧有、在 zones 侧没有，双写漂移的现成缺口 | 建议 | suspected**

`computeLlmExportZonesFromLayout` 的 `persistCount` 记 `options?.skillsIndex?.length ? 1 : 0`，**没有** `layout.skillsEnabled !== false` 这一闸；而实际注入（`buildPromptLlmInputFromLayout:358-362`）有。若出现 `skillsEnabled === false` 且 `ctx.skillsIndex` 非空的组合，`persistCount` 多算 1，`persistCount` 之后的第一条 chat 消息会被 `resolveZone`（`normalize-for-llm-export.ts:37-39`）误判为 persist 区。当前不可达——`agent-runner.ts:277` 的 skillsIndex 来自 `toolCtx.skills`，而 `skillsEnabled === false` 会让 registry 摘除 skill 工具（`resolve-agent-tool-registry.ts:71-73`）使该闭包为空。但「注入逻辑与边界计算逻辑手写两份、其中一份漏了门」本身就是缺陷形态，未来任何一侧新增注入段都会重演。建议：把 `layout.skillsEnabled !== false` 补进 zones 计算，或让装配器直接回吐实际段数。

**F-w8-prompt-adv-2 | P2 | expand-dynamic-macros.ts:32 | `{{$.filetree}}` 形态能通过校验却静默展开为空 | 建议 | suspected**

预检用 `content.includes("$filetree")`。但 `macro-scan.ts:64-71` 允许 `$` 后跟 `.key`（`$.filetree` → key `filetree`），`validate-dynamic-macros.ts:50-56` 也判定它在白名单内。于是 `{{$.filetree}}` 通过全部校验、进入 `renderMacro`，而 `filetree` 变量仍为 `""`（预检未命中，未调 `renderFileTree`），`lookupRoot` 返回空串而非抛错 → **静默展开为空**。同一预检在 `agent-runner.ts:1141` 也有一份，回合快照同样漏。危害面窄（用户手写 YAML 才会碰到 `{{$.filetree}}` 这种 Go 模板惯性写法），但失败模式是静默错误输出而非报错。建议：预检改为走 `scanMacroActions` 判 `kind === "root" && path[0] === "filetree"`，或在 `validateDynamicMacros` 里把 `$.` 形态一并拒绝。

**F-w8-prompt-adv-3 | P2 | render-prompt.ts:260-345 vs :350-401 | 装配双实现同步维护，仅靠测试 parity 兜底 | 建议 | suspected**

三区遍历写了两遍。虽然顺序由 parity 测试钉住，但**分段细节的漂移不会被 parity 抓到**——`buildPromptAssemblyFromLayout` 有 `title`/`source`/`segmentIndex` 三个 LLM 侧不存在的字段，`syntheticWorkplaceUserMessage`（:129）与 `syntheticTemplateMessage`（:111）也是两条独立的合成路径，`formatSkillsIndexBody` 虽共用（:165）但调用点分列两处。一旦给某段加字段（比如 workplace 段加来源标记），忘记同步的概率不低。这是典型的「测试只能证明当前一致、不能证明未来一致」。建议：把三区顺序抽成一个共享的段描述器，两个投影都从它派生。

**F-w8-prompt-adv-4 | P3 | normalize-for-llm-export.ts:23-27,137-152 | tool_turn_bridge 的 openai 特判疑为 v1.5.2 移除 done 桥后的残留 | 建议 | suspected**

`VFS_SEMANTIC_KINDS` 含 `tool_turn_bridge`、`applyProviderPostProcess` 对 openai 剔除空内容 bridge。但 RULE.md 第 22 行明确：done 桥已于 v1.5.2 全链路移除，**历史会话里的桥消息按普通 assistant 文本出站**。全仓 grep 显示 `tool_turn_bridge` 只有 `model/message-metadata.ts:9` 声明类型、`normalize-for-llm-export.ts` 三处消费，**无任何写入方**；且 bridge 文本是 `【done】`（非空），`isEmptyTextMessage` 恒 false → 该 filter 实际不可达。这是一段与现行 RULE 相冲突的死路径，建议删除或补注释说明它服务哪个存量形态。

**F-w8-prompt-adv-5 | P3 | render-prompt.ts:74-78 | zones 的 workplace 判定用 `undefined` 语义，与装配侧的 `.trim()===""` 不同形 | 建议 | confirmed**

`computeLlmExportZonesFromLayout` 判 `options?.workplaceDisplay === undefined || trim() !== ""`，而 `appendWorkplacePairIfPresent:225` 判 `ctx.workplaceDisplay.trim() === ""`。两者只在「调用方两处都传同一个值」时等价；只传 ctx 不传 options（或反之）时会算出多 2 的 `persistCount`。当前唯一生产调用方 `agent-runner.ts:553-559` 两处同传，所以现在无实害，但 API 允许不一致的调用姿势，属于契约缺口。

**F-w8-prompt-adv-6 | P3 | validate-prompt-blocks.ts（178 行）+ prompt-block.ts:14-26 | 扁平 PromptBlock 模型与校验器已无生产消费方 | 建议 | confirmed**

`AgentPromptLayout` 已替代扁平 `PromptBlock[]`（`agent-prompt-layout.ts:80-81` 注释明说）。实测 grep：`validatePromptBlocks` / `validatePromptBlocksFromMap` 的唯一消费方是它自己的测试 `packages/core/test/prompt/validate-prompt-blocks.test.ts`；`PromptBlock` 类型（`prompt-block.ts:14-26`，含 `chat` 变体）只被 `validate-prompt-blocks.ts` 自己引用。**注意 `prompt-block.ts:11` 的 `PromptBlockLifecycle` 仍活着**（被 `agent-prompt-layout.ts:42` 与两个 validate 文件用），不能整文件删——建议只摘掉 `PromptBlock` 类型与 `validate-prompt-blocks.ts` 及其测试，保留 `PromptBlockLifecycle`。

**F-w8-prompt-adv-7 | P3 | message-body.ts:7-12 | shim 的 4 个 re-export 里 3 个无人走这条路径 | 建议 | confirmed**

该文件只是 `domain/chat/content/message-body-text.js` 的转发壳。经 grep：`messageBodyText` 经 shim 消费（`heuristic-token-counter.ts:8` + `public/prompt.ts:22`），而 `messageBodyTextFromBlocks` / `messageBodyTextFromContent` / `formatChatMessageForCliPreview` 的所有消费方都**直接从 chat 域 import**，没走 shim。留下的是 knip 噪音与「以为存在统一入口」的误导。建议收窄为只转发 `messageBodyText`，或直接删掉 shim 让调用方改引 chat 域。

**F-w8-prompt-adv-8 | P3 | format-char-count.ts:3 | 硬编码 `zh-CN` locale 且无入参防护 | 建议 | confirmed**

`n.toLocaleString("zh-CN")` 对中文产品是合理的，但作为经 barrel 出面的通用导出，它对非有限数（NaN/Infinity）、负数、以及未来非中文区域都没有定义。同一 zone 内 `stream-final-rate.ts:79` 对速率做了 `Number.isFinite` 校验、`format-stream-metrics-line.ts:41-46` 对速率做了量级分档——本文件的防护等级明显低于同区邻居。若它注定只服务中文指标条，收进 `format-stream-metrics-line.ts` 更诚实。

**F-w8-prompt-adv-9 | P3 | sliding-token-rate.ts / stream-final-rate.ts / stream-token-anchor.ts / format-stream-metrics-line.ts 全文 | 代码风格与仓内其余部分不一致 | 建议 | confirmed**

这四个文件用 `{StreamTokenSource}` / `{tMs: nowMs, tokens}`（无空格）书写对象字面量与 import，而 domain/prompt 与仓内绝大多数文件用 `{ Foo }`（带空格）。同一 zone 内两套风格并存，说明这四个文件是不同批次/不同来源合入的。纯观感问题，但会让「按风格找相似实现」的检索失效，也容易让后续误判归属。

## 争议与存疑

1. **F-1 的可达性判断有分歧**：我判「当前不可达」，依据是 `toolCtx.skills` 在 `skillsEnabled === false` 时被 registry 摘除而置空。但 `agent-runner.ts:277` 的 `budgetSkillsIndexEntries` 读的是 `this.deps.toolCtx.skills`，而 toolCtx 的装配在 `run-agent-turn.ts:861`；若将来出现「policy 只 deny 了 skill 工具名但 skills 闭包仍注入」的路径（例如显式 `$` 引用不受影响的设计外溢），F-1 立刻变实害。我没有追到 `skillsCtx` 的完整构造（超出本区范围），**标记为 suspected 而非 confirmed**，建议 reduce 阶段找 w2 的 agent 域机位交叉确认 `skillsCtx` 是否在 skillsEnabled=false 时确为空。

2. **F-2 的危害面需要另一份证据**：`{{$.filetree}}` 是否真的会被用户写出来，我只有代码路径证据（`macro-scan.ts:66` 明确 strip 前导 `.`），没有存量 YAML 语料证据。若内置技能或示例配置里出现过这种写法，F-2 应升 P1。可从 `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` 与 `examples/` 下的 agent YAML 里 grep `{{\$.` 复核——建议 reduce 阶段做一次。

3. **F-4 与 RULE.md 的冲突需要裁定**：RULE.md 第 22 行说历史 bridge 按普通 assistant 文本出站，而本区代码对 openai 有个「剔除空 bridge」的特判。我判定它不可达（bridge 文本非空 + 无写入方），但「不可达的兼容代码」和「RULE 写错了」是两种解释——后者需要主代理查 v1.5.2 移除 done 桥时的 commit 来定。在此之前我按代码事实陈述，不替 RULE 背书也不推翻它。

4. **关于 `prompt-block.ts` 的存废，我不主张整文件删除**：`PromptBlockLifecycle` 是活类型，且它同时被 `agent-prompt-layout.ts` 与两份 validate 使用。真正的死代码只有 `PromptBlock` 联合类型和 `validate-prompt-blocks.ts`。若 reduce 阶段按「文件级死代码」一刀切，会连带删掉活类型——这条我明确反对。