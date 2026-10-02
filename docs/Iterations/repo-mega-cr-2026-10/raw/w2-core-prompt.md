---
zone: core-prompt
agent: domain-survey
files_scanned: 17
head_sha: 9ca5f5ad
paths:
  - packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts
  - packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts
  - packages/core/src/domain/prompt/logic/message-body.ts
  - packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts
  - packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts
  - packages/core/src/domain/prompt/logic/should-include-dynamic-block.ts
  - packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts
  - packages/core/src/domain/prompt/logic/validate-dynamic-macros.ts
  - packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts
  - packages/core/src/domain/prompt/model/agent-prompt-layout.ts
  - packages/core/src/domain/prompt/model/prompt-block.ts
  - packages/core/src/domain/prompt/model/prompt-render-context.ts
  - packages/core/src/domain/format/format-char-count.ts
  - packages/core/src/domain/format/format-stream-metrics-line.ts
  - packages/core/src/domain/format/sliding-token-rate.ts
  - packages/core/src/domain/format/stream-final-rate.ts
  - packages/core/src/domain/format/stream-token-anchor.ts
---

## 摘要

两块纯逻辑域。`domain/prompt/` 是 agent 提示词「三区布局」（system + persist 持久区 + dynamic 动态区）
的数据模型、wire 校验/归一化、动态宏展开（`$time`/`$week_cn`/`$filetree`）、dynamic 块 lifecycle
过滤，以及出站前的区内相邻纯文本合并。`domain/format/` 是流式指标展示的纯函数层：滑窗 token 速率采样器、
metrics 条文案、冻结速率快照编解码、token 基线重锚公式。无 IO、无 DB、无全局态（唯一可变态被
`createTokenRateSampler` 封在闭包里）。

## 职责与边界

**在本区内的**

- 布局域模型（`AgentPromptLayout`：system / persistEnabled / dynamicEnabled / workplace /
  customAttach / skillsEnabled / skillsPrefix / persist[] / dynamic[]）。
- wire map → 域模型校验（`validateAgentPromptLayoutFromMaps`）+ 已组装 layout 的复校
  （`validateAgentPromptLayout`）。
- 旧 `type:worktree` 块的读入 strip（`stripLegacyWorktreeBlocksFromPersistMap`）与
  域形态归一化（`normalizeAgentPromptLayoutDomain`）。
- 动态区宏白名单校验（`validateDynamicMacros` / `rejectPersistMacros`）与实时展开
  （`expandDynamicMacros`）。
- dynamic 块 lifecycle 过滤（`shouldIncludeDynamicBlock`，`once` 只在 step 0）。
- 出站区内合并（`normalizeForLlmExport` + `LlmExportZones`）。
- 展示派生值纯函数（`slidingTokenRate` / `createTokenRateSampler` / `buildStreamMetricsLine` /
  `formatCharCount` / `stream-final-rate` 编解码 / `stream-token-anchor` 两公式）。

**不在本区（越界即依赖倒置风险）**

- 实际的消息数组拼装与三区边界计算在 `service/prompt/render-prompt.ts`（本区只出 zone 数字契约）。
- 宏引擎本体在 `infra/prompt-template/`（`macro-scan` / `macro-render` / `week-cn`）。
- 附件/短提示装配在 `domain/chat/logic/prepare-user-messages-for-prompt.ts`。
- 回合快照（`$filetree` 预取）在 `service/agent/impl/agent-runner.ts`。
- 实际读盘（`renderFileTree`）在 `service/workplace/`。
- 双端 UI（agent 编辑器、指标条）在 `apps/{mobile,desktop}`。

**依赖方向健康度**：`domain/prompt/logic/expand-dynamic-macros.ts:7` 从 `domain/` 引入了
`@/service/workplace/workplace.port.js`（`WorkplaceService`）——domain 层反向依赖 service 层 port，
是本区唯一一处层次倒置。`domain/format/sliding-token-rate.ts:24` 引 `domain/session-run-state` 属同层
内跨域，可接受。

## 对外接口

`packages/core/src/public/prompt.ts`（子路径 `@novel-master/core/prompt`）：

| 符号 | 源 |
|---|---|
| `PromptError` / `PromptErrorCode` | `errors/prompt-errors.ts` |
| `AgentPromptLayout`、`PersistTextPromptBlock`、`DynamicPromptBlock`、`PersistPromptBlock`(deprecated)、`PersistWorktreePromptBlock`(deprecated) | `model/agent-prompt-layout.ts` |
| `DEFAULT_WORKPLACE_ASSISTANT_TEXT`、`WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT`、`layoutHasWorkplace` | 同上 |
| `shouldIncludeDynamicBlock` | `logic/should-include-dynamic-block.ts` |
| `messageBodyText` | `logic/message-body.ts`（纯再导出 shim） |
| `validateAgentPromptLayoutFromMaps`、`validateAgentPromptLayout`、`resolveWorkplaceFromWire` | `logic/validate-agent-prompt-layout.ts` |
| `normalizeForLlmExport`、`LlmExportZones`、`LlmExportZone` | `logic/normalize-for-llm-export.ts` |
| `ALLOWED_DYNAMIC_ROOT_MACROS`、`validateDynamicMacros` | `logic/validate-dynamic-macros.ts` |
| `expandDynamicMacros` | `logic/expand-dynamic-macros.ts` |
| `buildPromptAssemblyFromLayout` / `buildPromptLlmInputFromLayout` / `computeLlmExportZonesFromLayout` / `formatPromptLlmInputForCliFromLayout` / `buildPromptPreviewSegmentsFromLayout` | `service/prompt/render-prompt.ts`（转发） |
| `applyThinkingContextForLlm` / `resolvePreviewThinkingContext` | `service/prompt/*`（转发） |
| `PromptRenderContext`、`PromptSkillIndexEntry`、`PromptLlmInput` | `model/prompt-render-context.ts` |

**未导出**（只在仓内用）：`normalizeAgentPromptLayoutDomain`、`stripLegacyWorktreeBlocksFromPersistMap`、
`persistBlockToWire`、`dynamicBlockToWire`、`layoutHasCustomAttach`、`validatePromptBlocks*`、
`DEFAULT_SKILLS_INDEX_PREFIX`（走 render-prompt 内部）。

`packages/core/src/public/format.ts`（子路径 `@novel-master/core/format`）：
`formatCharCount`、`buildStreamMetricsLine`、`formatStreamElapsed`、`StreamMetricsLineInput`、
`SLIDING_TOKEN_RATE_WINDOW_MS`、`createTokenRateSampler`、`slidingTokenRate`、`TokenRateSample`、
`TokenRateSampler`、`parseStreamFinalRateSnapshot`、`serializeStreamFinalRateSnapshot`、
`StreamFinalRateSnapshot`、`composeStreamTokens`、`reanchorStreamTokenBase`、
`IncrementalTokenCounter` 系列（转发自 `infra/tokenizer/logic/`）、`StreamTokenSource`（转发）。

## 数据访问

本区**不直接触碰任何表 / KKV 域 / 文件路径**。唯一的 IO 触点是经注入的 port：

- `expand-dynamic-macros.ts:35` — `ctx.workplace.renderFileTree()`（`$filetree` 宏的实时回退路径）。
  实现在 `service/workplace/impl/workplace.service.ts`（`materializeLiveView` → 采样签名缓存）。
- `expand-dynamic-macros.ts:8,10` — `formatLocalDateTime` / `formatWeekCn`（纯函数，`infra/date-format.ts`、
  `infra/prompt-template/week-cn.ts`）。

消费侧涉及的 KKV / 数据面（**本区不写**，列此供对账）：

- `stream_metrics` 域的 `finalRate` 键：`domain/format/stream-final-rate.ts` 只提供编解码；
  写入/读取在 `apps/mobile/src/services/session-stream-unit-manager.service.ts`
  （`STREAM_METRICS_FINAL_RATE_KEY` 来自 `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts`）。
  **desktop 侧无任何 finalRate 持久化**（`rg finalRate apps/desktop` 零命中）。
- `chat_message.content.blocks`：本区只读（`normalize-for-llm-export.ts` 的
  `message.content.blocks`、`message.attachments`、`message.raw.metadata`）。

## 依赖关系

**import 谁**

```
domain/prompt/logic/expand-dynamic-macros
  → @/service/workplace/workplace.port (WorkplaceService)      ← 层次倒置
  → @/infra/date-format, @/infra/prompt-template/{macro-render,week-cn}
domain/prompt/logic/validate-dynamic-macros
  → @/infra/prompt-template/macro-scan, @/errors/prompt-errors
domain/prompt/logic/validate-agent-prompt-layout
  → ./agent-prompt-layout-wire, ./normalize-agent-prompt-layout, ./validate-dynamic-macros
domain/prompt/logic/normalize-for-llm-export
  → ../../chat/content/{message-body-text,text-blocks}, ../../chat/model/{message,message-metadata}
  → ../../../infra/llm-protocol/ports/adapter.port (LlmProtocolKind)  ← 域层引 infra port
domain/prompt/logic/message-body
  → @/domain/chat/content/message-body-text (纯再导出)
domain/format/sliding-token-rate
  → ../session-run-state/model/session-run-state (StreamTokenSource)
domain/format/format-stream-metrics-line
  → ./format-char-count
```

**被谁消费（生产路径）**

- `agent-definition.schema.ts` → `persistBlockToWire` / `dynamicBlockToWire` /
  `validateAgentPromptLayoutFromMaps` / `stripLegacyWorktreeBlocksFromPersistMap`。
- `config-forms/stored-config-validity/assess-agent-definition-wire.ts` → `normalizeAgentPromptLayoutDomain`。
- `domain/agent/model/agent-definition.schema.ts` 与 `config-forms/agent/agent-editor-state.ts` →
  `layoutHasWorkplace` / `EditorPersistPromptBlock`。
- `domain/agent/logic/resolve-agent-tool-registry.ts` 读 `definition.prompts.skillsEnabled`。
- `service/prompt/render-prompt.ts` → `shouldIncludeDynamicBlock` / `expandDynamicMacros` /
  `DEFAULT_SKILLS_INDEX_PREFIX` / `layoutHasWorkplace`。
- `service/agent/impl/agent-runner.ts` → `computeLlmExportZonesFromLayout` / `normalizeForLlmExport`。
- `domain/chat/logic/prepare-user-messages-for-prompt.ts` → `expandDynamicMacros`（customAttach 展开）。
- `infra/tokenizer/logic/chat-token-estimate-memo.ts` → layout 九字段进 memo 键摘要。
- 双端：mobile `components/agent/agent-editor/*`、`services/session-prompt-input.service.ts`；
  desktop `renderer/features/settings/AgentEditorView.tsx`、`AgentDefinitionEditorForm.tsx`、
  `renderer/hooks/useAgentStreamMetrics.ts`、`shared/logic/{prompt,format}.ts`。

**测试覆盖**（实测条数，`rg -c "it\("`）：
`test/prompt/` 共 16 文件 130 条；`test/domain/format/` 4 文件 30 条。
`validate-prompt-blocks.test.ts` 13 条、`validate-agent-prompt-layout.test.ts` 20 条、
`sliding-token-rate.test.ts` 17 条。

## 发现清单

### F-core-prompt-1 | P1 | packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts:62-73

```ts
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout)
      ? { customAttach: layout.customAttach }
      : {}),
    persist,
    dynamic: [...layout.dynamic],
```

`normalizeAgentPromptLayoutDomain` 的返回对象逐字段白名单展开，**漏了 `skillsEnabled` 与
`skillsPrefix` 两个字段**。而该函数是 domain-shape 存储加载路径
（`assess-agent-definition-wire.ts:86` → `resolveAgentDefinitionFromStorage`）唯一的归一化入口：
`isAgentDefinitionDomainShape` 命中时（`prompts.persist` 是数组、无 `schemaVersion`）就只跑这一个
函数，**不跑 `agentDefinitionSchema` decode**。

后果链：`prompts.skillsEnabled: false` 的 agent 从 domain-shape 存储读出后变成 `undefined` →
`resolve-agent-tool-registry.ts` 的 `if (definition.prompts.skillsEnabled === false)` 不成立 →
**skill 工具不被摘除、skill 索引照常注入**。即用户显式关掉的技能总开关在存储捷径上静默失效。
`skillsPrefix` 同理丢 customizing 前缀语。

这是 `docs/Iterations/cr-fix-spec/review/phase2-slice/D2-prompt.md` 记录过的**同一类 bug 的复发**：
那次修的是 `customAttach` 丢失（已补），本次是后来新增的 `skillsEnabled`/`skillsPrefix` 没跟上。

现有测试 `test/prompt/normalize-agent-prompt-layout.test.ts` 6 条只覆盖 `customAttach`/`system`/
`persist`/`dynamic`，对 skills 两字段**零断言**——按 RULE「验收断言的牙齿」第 ① 条，这是废断言覆盖
漏洞：把 `skillsEnabled: false` 塞进 `BASE_LAYOUT` 跑 normalize，测试照样全绿。

置信：**confirmed**（字段遗漏由代码直读确认；生产可达性见「争议与存疑」第 1 条——`resolveAgentDefinitionFromStorage`
当前无生产调用方，但它是 `config-forms/stored-config-validity` 公开子路径的导出符号，外部/未来调用方会踩）。

建议：在 `normalize-agent-prompt-layout.ts:62-73` 的返回对象补两段
`...(layout.skillsEnabled === false ? { skillsEnabled: false } : {})` 与
`...(typeof layout.skillsPrefix === "string" && layout.skillsPrefix.trim().length > 0 ? { skillsPrefix: layout.skillsPrefix } : {})`；
同时补一条 skills 两字段的 normalize 断言（**断言要能红**：把 spread 删掉即红）。

---

### F-core-prompt-2 | P2 | packages/core/src/service/prompt/render-prompt.ts:104-113（契约方）↔ domain/prompt/logic/normalize-for-llm-export.ts:29-44（消费方）

```ts
  const persistCount =
    (options?.skillsIndex?.length ? 1 : 0) +
    (injectWorkplace ? 2 : 0) +
    (layout.persistEnabled === true ? textBlockCount : 0);
```

`computeLlmExportZonesFromLayout` 计算 persist 区消息数时，技能索引那条**只看
`options.skillsIndex.length`，不看 `layout.skillsEnabled`**；而真正拼装消息的
`buildPromptLlmInputFromLayout` 是双保险的：

```ts
  if (layout.skillsEnabled !== false &&
      ctx.skillsIndex != null && ctx.skillsIndex.length > 0) {
    messages.push(syntheticSkillsIndexMessage(...));
  }
```

`skillsEnabled === false` 且 `skillsIndex` 非空时，`persistCount` 比实际前缀**多算 1**。
`resolveZone`（`normalize-for-llm-export.ts:37-43`）据此把本该属 chat 区的第一条消息判成 persist 区，
后果是**跨区 merge 禁令被打开**：persist 区最后一条（assistant 纯文本）与 chat 区第一条（user）
本应永不合并，现在会因「同区 + 同 role 纯文本」而并成一条。

当前**实际不可达**：`agent-runner.ts` 的 `budgetSkillsIndexEntries` 读的 `toolCtx.skills` 只在
`resolveAgentToolRegistry` 保留 skill 工具时才注入，而该 registry 在 `skillsEnabled === false`
时已摘除 skill——两处联动使得「skillsIndex 非空」蕴含「skillsEnabled !== false」。但这是**跨文件
隐式不变量**，无断言守护：`resolve-agent-tool-registry` 与 `render-prompt` 任一侧改动装配顺序，
立刻变成跨区 merge 缺陷。契约函数自己也声明了「传入时与注入逻辑一致」（render-prompt.ts:66-68
的 `@remarks`），此处并未一致。

置信：**suspected**（不一致由代码直读确认；生产可达性依赖外部联动，属 latent）。

建议：`computeLlmExportZonesFromLayout` 的 persistCount 加同款门
`layout.skillsEnabled !== false && (options?.skillsIndex?.length ? 1 : 0)`；或抽一个
`shouldInjectSkillsIndexMessage(layout, skillsIndex)` 纯函数由两处共用（更抗漂移）。

---

### F-core-prompt-3 | P2 | packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts:144-178

`validatePromptBlocksFromMap` / `validatePromptBlocks`（及其 `@alias`）在**生产代码里零调用方**：
`rg -n "validatePromptBlocksFromMap|validatePromptBlocks\b" packages apps` 只命中本文件自身定义与
`test/prompt/validate-prompt-blocks.test.ts`（13 条）。它服务的 `prompts.blocks` 形态已被
`agent-definition.schema.ts:41-46` 显式判死：

```ts
  if ("blocks" in record) {
    throw new AgentConfigError("INVALID_SCHEMA",
      "prompts.blocks is removed; use prompts.system / persist / dynamic");
  }
```

`assess-agent-definition-wire.ts:14-20` 的 `REMOVED_FEATURE_KEYWORDS` 也把 `"prompts.blocks"`
列为已拆除特性。同理 `model/prompt-block.ts` 的 `PromptBlock` 类型（`type: "chat"` / `abstract` 分支）
在生产侧无消费者——`validate-prompt-blocks.ts` 是它唯一的生产引用点。

这是一整套 ~180 行 + 13 条测试的**死路径**，且它描述的是一个已废弃的数据形态，新人读代码会误以为
`blocks` 仍受支持。RULE 里的「schema migration 清理有约定节奏」是针对 DB migration 的，不覆盖这类
纯逻辑死码。

置信：**confirmed**（`rg` 全仓核过，生产零引用）。

建议：删除 `logic/validate-prompt-blocks.ts` + `model/prompt-block.ts` 中的 `PromptBlock` 联合类型
（`PromptBlockLifecycle` 仍被 `agent-prompt-layout.ts` 引用，须保留该类型）+ 对应测试文件。
若因故要留，在文件头加 `@deprecated` 并注明「`prompts.blocks` 已于 xx 拆除，仅存量解析用」。

---

### F-core-prompt-4 | P2 | packages/core/src/domain/prompt/logic/message-body.ts:7-12

```ts
export {
  messageBodyText,
  messageBodyTextFromBlocks,
  messageBodyTextFromContent,
  formatChatMessageForCliPreview,
} from "@/domain/chat/content/message-body-text.js";
```

`logic/message-body.ts` 是零逻辑的纯再导出 shim，而它指向的
`domain/chat/content/message-body-text.ts` 就在隔壁两个目录。仓内另有 4 处**直接**引
`../../chat/content/message-body-text.js` 或 `@/domain/chat/content/message-body-text.js`
（`normalize-for-llm-export.ts:7`、`render-prompt.ts` 的 `formatChatMessageForCliPreview`、
`test/chat/message-body-text.test.ts`）。`public/prompt.ts:22` 只转出 shim 里的 `messageBodyText`
一个符号。

即：同一个实现有两条 import 路径，域内自相矛盾（`logic/message-body.ts` 走 shim，
`logic/normalize-for-llm-export.ts` 走直连）。shim 的存在还会让「谁拥有 message-body-text」
看起来含糊——文件名 `message-body.ts` 位于 `prompt/logic/` 下，实际住在 `chat/content/`。

置信：**confirmed**。

建议：删掉 `logic/message-body.ts`，`public/prompt.ts:22` 改为直接从
`../domain/chat/content/message-body-text.js` 转出 `messageBodyText`。

---

### F-core-prompt-5 | P2 | packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts:32-36

```ts
  if (content.includes("$filetree")) {
    filetree =
      ctx.filetree ??
      (ctx.workplace != null ? await ctx.workplace.renderFileTree() : "");
  }
```

预检用朴素子串 `content.includes("$filetree")`，而宏语法是 `{{$filetree}}`（`macro-scan.ts:64`
解析 `$` 前缀）。两个方向的偏差都存在：

1. **假阳**：正文里出现字面量 `$filetree`（比如教用户写宏的说明文本、或
   `{{/* $filetree */}}` 注释）会触发一次 `renderFileTree()`。生产侧有采样签名缓存
   （`workplace.service.ts` 的 `evaluateCachedView`），不是灾难，但白跑一次 IO + 一次树渲染。
2. **假阴**：`{{ $filetree }}`（带空格）——`indexOf("$filetree")` 仍能命中，所以这方向安全；
   但 `{{$.filetree}}`（`macro-scan.ts:66` 显式支持 `$` 后跟 `.` 的写法，`key = rest.slice(1)`）
   **不会**命中子串预检 → 宏解析时 `root.filetree` 是空串 → `lookupRoot` 拿到 `""` 而非抛错
   （`macro-render.ts` 的 `lookupRoot` 只在 `value == null` 时抛 UNKNOWN_FIELD）→ **静默展开成空串**，
   提示词里少一棵文件树，模型无从察觉。

第 2 条是真缺陷但触发面窄（用户得在 dynamic 块里手写 `{{$.filetree}}`）。同一函数对
`$time`/`$week_cn` 不做预检（无 IO 成本），只有 `$filetree` 有 IO 成本才加预检——预检逻辑与解析逻辑
不同源是这个坑的根因。

对照：`agent-runner.ts` 的 `resolveTurnFiletreeSnapshot` 用**同一个朴素子串**
`collectMacroExpandableText(layout).includes("$filetree")` 做回合级预取，两处同款偏差、
同一个根因（宏语法知识在 `infra/prompt-template/macro-scan.ts`，预检却手写字符串匹配）。

置信：**confirmed**（假阴路径由 `macro-scan.ts:64-77` + `macro-render.ts` 的 `lookupRoot`
`value == null` 判定推得；`renderMacro` 传的是 `{ dot: {}, root }`，`root.filetree = ""` 合法）。

建议：预检改用 `scanMacroActions(content).some(a => a.kind === "root" && a.path[0] === "filetree")`，
与解析器同源；`agent-runner.ts` 的 `collectMacroExpandableText(...).includes("$filetree")` 同步改。
或在 `expandDynamicMacros` 里对「文本含 `$filetree` 但扫描器没找到 filetree 根宏」的情形
补一条 dev 期 warn。

---

### F-core-prompt-6 | P3 | packages/core/src/domain/format/format-char-count.ts:2-3

```ts
export function formatCharCount(n: number): string {
  return n.toLocaleString("zh-CN");
}
```

`toLocaleString` 不做取整/夹取，实测边界行为对非整数与非有限值不确定：
`formatCharCount(1234.5)` → `"1,234.5"`（小数位不裁），
`formatCharCount(NaN)` → `"NaN"`，`formatCharCount(-5)` → `"-5"`。

本仓两个消费方传的都不是「纯非负整数」：`apps/mobile/src/screens/stack/FileEditorScreen.tsx`
传 `content.length`（安全），`format-stream-metrics-line.ts:57` 传 `metrics.completionTokens`——
而该值来自 `composeStreamTokens(base, increment) = Math.max(0, base + increment)`，
`base = reanchorStreamTokenBase(truth, increment) = truth - increment` **可以是负数**，
`increment` 来自尾窗增量估算。`Math.max(0, …)` 保证了最终读值非负，但若 `increment` 本身是
`NaN`（宿主注入的 encode 绑定抛错被吞成 NaN），`Math.max(0, NaN)` = **`NaN`**
（`Math.max` 对 NaN 返回 NaN，不做夹取）→ 指标条显示「输出 NaN tok」。

现有测试 `test/domain/format/format-utils.test.ts` 的 `formatCharCount` 断言是
`assert.match(formatCharCount(1234), /1/)`——按 RULE「验收断言的牙齿」第 ① 条，这是**近乎恒真的
废断言**（任何含数字 1 的输出都过），非有限值/负数/小数三个边界全无覆盖。

置信：**suspected**（`Math.max(0, NaN) === NaN` 是 JS 语义确定行为；NaN 是否真能到达取决于上游
`incremental-token-counter` 的 encode 绑定是否吞错——那在本区外，未追）。

建议：`formatCharCount` 内加 `Number.isFinite(n) ? n : 0` 兜底（或在 `composeStreamTokens` 里
`Number.isFinite` 后再 `Math.max`，更贴近语义）；把 `formatCharCount` 的测试断言从
`assert.match(..., /1/)` 换成 `assert.equal(formatCharCount(1234), "1,234")` 精确值，
并补 `0` / 负数 / 非整数的边界用例。

---

### F-core-prompt-7 | P3 | packages/core/src/domain/format/sliding-token-rate.ts:154-173

```ts
      } else if (lastTokens !== tokens) {
        if (nowMs > lastSampleMs) {
          if (nowMs - lastSampleMs >= SLIDING_TOKEN_RATE_WINDOW_MS) {
            lastSettledRate = tailRate() ?? lastSettledRate;
            samples = [];
          }
          samples.push({tMs: nowMs, tokens});
```

采样器的「窗口折叠重 seed」分支在 `nowMs > lastSampleMs` **且** token 变化时才触发。
若一次长静默（≥2.5s）之后到达的第一个调用是 `rateAt(nowMs)`（渲染节拍读，不记样本），
旧样本仍在 `samples` 里；直到下一次 token 变化才折叠。`rateAt` 走
`slidingTokenRate(samples, nowMs)` 的窗口裁剪分支，旧样本因 `tMs < windowStartMs` 被自然排除，
**读数正确**（返回 null 或按窗口内残余样本算）。这条路径没问题。

真正值得记的是 `MAX_RATE_SAMPLES = 512`（`:82`）与注释里的估算严重脱节：注释写
「2.5s 窗口 × 250ms 采样 ≈ 10 条在册」，实际给 512 条（≈128s @250ms）。超限裁剪
`samples.slice(-512)` 是纯兜底、语义安全，但 50 倍余量意味着**一个 bug（样本不去重、每帧都 push）
可以在 128 秒内都不会被裁剪发现**。RULE「性能护栏取数量级回归线」的精神是留余量，但这条余量
把内存上限从「~10 条 × 32B」推到了「~16KB/run」，且掩盖退化。

置信：**intentional**（余量本身是刻意的防御，非缺陷）；但**注释与常量脱节**是文档债。

建议：注释改为陈述「512 = 250ms 采样下约 128s 的余量；正常在册约 10 条，触顶即说明去重/折叠
逻辑已失效」，让后来者知道触顶是异常信号而非常态。或按实测把常量下调到 64。

---

### F-core-prompt-8 | P3 | packages/core/src/domain/prompt/model/agent-prompt-layout.ts:49

```ts
export const WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT = "【done】";
```

`workplace: true`（旧 wire 布尔形态）读入后展开成的助手确认语是字符串字面量 `"【done】"`。
这个字面量与已全链路移除的 done 桥（`tool_turn_bridge`）**完全同形**——RULE「出站合并」条目明写
「曾经的 done 桥（tool_turn_bridge，maxSteps 截断后插入的伪造 assistant "【done】" 屏障）
已于 v1.5.2 全链路移除，存量测试靠内联 "【done】" 字面量锁定兼容」。

也就是说：一个写 `workplace: true` 的旧配置，运行时会在工作区文件树之后紧跟一条
内容为 `"【done】"` 的 assistant 消息。对模型而言这是**语义噪声**（"【done】" 是完成屏障的
历史约定，不是「我看到工作区了」的确认语），而同一模块里已经有语义正确的
`DEFAULT_WORKPLACE_ASSISTANT_TEXT = "我看到工作区了"`（`:52`）作为编辑器默认值。

代码注释（`:46-48`）明确说这是刻意保留的兼容（"与现网 tool-turn bridge 字面一致，但常驻路径
语义独立，勿再 import bridge 常量"），所以**不是漏改**，是**故意选了兼容字面量**。但这个选择
本身值得复核：兼容的是「哪个 wire 值映射到哪个字符串」，而不是「必须用这个字符串」——
`true → "我看到工作区了"` 同样是合法映射，且不与 done 桥撞形。RULE 只要求存量测试用字面量锁定
（那是测试侧的事），并未要求生产常量必须保持 `【done】`。

置信：**intentional**（有显式注释声明），但**建议复议**。

建议：与用户确认后把 `workplace: true` 的映射改为 `DEFAULT_WORKPLACE_ASSISTANT_TEXT`，
或至少在常量注释里点明「该字面量会出现在发给 LLM 的提示词里，与 done 桥同形」。

---

### F-core-prompt-9 | P3 | packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts:23-27

```ts
const VFS_SEMANTIC_KINDS = new Set([
  "user_vfs_action",
  "user_vfs_ack",
  "tool_turn_bridge",
]);
```

三个 kind 里 `user_vfs_action` / `user_vfs_ack` 对应的 **user ops / 操作日志功能已在
chat-fixes-2026-08 整体拆除**（RULE「user ops / 操作日志（已拆除）」明写「新代码不要再读写
操作日志链路」）。这两条现在只作为「历史消息不参与 merge」的兼容判据存在
（`domain/chat/logic/user-vfs-turn-view.ts`、`editable-text-from-message.ts` 也在读
`user_vfs_action`），属**刻意的历史兼容**——旧会话里的 synthetic 消息不能因为功能下线就改变
出站形态。

`tool_turn_bridge` 同理：`applyProviderPostProcess`（`:138-152`）对 openai 剔除空的
`tool_turn_bridge` synthetic，也是存量兼容。代码注释与 RULE 口径一致。

置信：**intentional**（RULE 明确拆除的是「写入链路」，保留读侧判据是正确口径）。仅记录，
**不当问题**。建议在这三行上方加一行注释指向 RULE 的「user ops / 操作日志（已拆除）」条目，
避免下一波 CR 再当新发现提。

---

### F-core-prompt-10 | P3 | packages/core/src/domain/format/stream-final-rate.ts:79-90

```ts
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    return null;
  }
```

编解码的防御做得扎实（`rate` 非有限/负数判坏，`tokens`/`atMs` 退化为 0 不判坏，
`runId` 缺字段走兼容）。唯一可议的是**没有对 `atMs` 做合理性下界检查**：
`atMs: 0` 或 `atMs` 早于任何合理纪元的值都会被当成合法快照采用。注释解释了 `atMs` 只服务自检
不影响速率段渲染（`:59`「tokens/atMs 缺字段退化为 0——它们只服务自检，不影响速率段渲染」），
所以这是**有意的宽松**，不是漏洞。

真正的边界是：`rate` 可以是 `0`（合法通过），
而 `formatTokensPerSecondValue(0)`（`format-stream-metrics-line.ts:41-46`）
走 `Number.parseFloat((0).toFixed(1))` = `0` → 输出 `"0 tok/s"`。展示层会把
「速率确实算出来是 0」和「速率不可得（null → 省略段）」渲染成两种形态
（`"… · 输出 500 tok · 0 tok/s"` vs `"… · 输出 500 tok"`），这符合
`sliding-token-rate` 的设计（暂停期分子不变分母增长 → 趋零，是真实读数）。**语义正确，非缺陷**。

置信：**intentional**。仅作口径记录，供 L3 台账引用。

---

### F-core-prompt-11 | P3 | packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts:7

```ts
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
```

`domain/` 层反向 import `service/` 层的 port 类型，是本区唯一的层次倒置（同文件 `:8-10` 引
`infra/` 也算越界，但 `infra/prompt-template` 是无状态纯函数库、惯例上 domain 可以引；
`service/workplace` 则是编排层）。这让「domain 是最内层」的依赖方向失守：
`service/workplace` 若哪天引了 `domain/prompt`（比如为了 workplace 提示词拼装），就形成
`domain/prompt → service/workplace → domain/prompt` 的 require cycle。

目前 `service/workplace` 未引 `domain/prompt`（已 grep 核过），无实际环。

置信：**confirmed**（import 语句确认；无环为 grep 结论）。

建议：把 `WorkplaceService` 的最小面（`renderFileTree(): Promise<string>`）抽成
`domain/prompt/model/prompt-render-context.ts` 旁边的窄 port（或 `domain/workplace/ports/`），
`DynamicMacroContext.workplace` 改引窄 port，`service/workplace` 实现它。低优先，属结构洁癖。

---

### F-core-prompt-12 | P3 | packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts:259-300

```ts
  const persistEnabled = options?.persistEnabled === true;
  const dynamicEnabled = options?.dynamicEnabled === true;
```

启用态采用「`=== true` 严格取真」——wire 传 `persistEnabled: "true"`（字符串）会被静默当作
`false`（关闭），不报错。同文件 `:226-231` 对 `system` 的空串是**抛错**的
（"prompts.system 如填写则须为非空字符串"），`:45-50` 对 `workplace` 空串也抛错，
`:264-266` 对 `customAttach` 空串则**静默当关**。四个可选标量字段三种口径（抛错 / 静默关 /
静默关但类型不符也静默关）。

`skillsEnabled`（`:308`）同样 `=== false` 才写域——wire 传字符串 `"false"` 会被当作开启。

zod 层（`agent-definition.schema.ts:97,116`）用 `z.boolean()` 会拦住非布尔，所以走
`agentDefinitionSchema` 的路径安全。但 `validateAgentPromptLayout`（`:339-367`）的
`options.persistEnabled` 来自**域对象**（`layout.persistEnabled`），域类型已是 `boolean?`，
也不越界。真正裸奔的是 `validateAgentPromptLayoutFromMaps` 的直接调用方——
`documentToDefinition` 传的是 zod 已收敛的 `boolean`。所以当前**无实际触发路径**。

置信：**intentional / 无触发**（口径不统一但被上游 zod 兜住）。记录以备将来有非 zod 调用方。

建议：若要收敛，`resolveWorkplaceFromWire` 已有严格分支范式（`:53-56` 对非 boolean 非 string
抛错），可让 `persistEnabled`/`dynamicEnabled`/`skillsEnabled` 对非 `boolean|undefined`
抛 `INVALID_YAML`，与 `workplace` 对齐。

## 争议与存疑

1. **F-core-prompt-1（skills 字段丢失）的生产可达性存疑。** `rg` 全仓核过
   `resolveAgentDefinitionFromStorage` 的调用方：**只有测试**
   （`test/config-forms/stored-config-validity.test.ts`、`test/prompt/normalize-agent-prompt-layout.test.ts`、
   `test/prompt/workplace-layout-c0.test.ts`），生产侧零调用。
   `apps/desktop/shared/logic/config-forms-stored-config-validity.ts:5-6` 显式写
   「**禁止**再导出 `assess*Wire` / `resolveAgentDefinitionFromStorage`（Steps 11–12 改走 IPC
   assessed DTO）」，mobile 侧同样只 import `assessAgentDefinitionWire` 与 labels。
   另 `docs/Iterations/post-1.3.14-large-debt-remediation/spec.md` 记录了
   「Renderer **不得**再调用 `assessAgentDefinitionWire` / `resolveAgentDefinitionFromStorage`」。
   **所以今天它可能是条准死路径。** 但：① 它仍是 `packages/core/package.json` 公开子路径
   `./config-forms/stored-config-validity` 的导出符号，外部调用方/未来接线会踩；
   ② `w2-core-agent` 报告已指出 `isAgentDefinitionDomainShape` 是 `agentDefinitionSchema` 的复制品
   （同类漂移风险）。**定级 P1 是按「字段静默丢失 + 用户可见配置失效 + 有前科」给的；
   若主代理核实它确已无生产可达路径，可降 P2。** 请 L3 裁决时一并核。

2. **F-core-prompt-2（persistCount 少门 skillsEnabled）的「刻意 vs 疏忽」不明。**
   `computeLlmExportZonesFromLayout` 的 `@remarks` 明写「传入时与注入逻辑一致」，
   说明作者知道要对齐；实际漏了 `skillsEnabled` 一道。无法判断是疏忽还是「依赖 registry 联动
   所以不必重复判断」的刻意简化。已按 latent/suspected 报，未定 P1。

3. **`normalizeAgentPromptLayoutDomain` 与 `validateAgentPromptLayoutDomain`（即
   `validateAgentPromptLayout`）两套归一化并存，谁是「规范实现」不明。**
   前者只做 strip + 省略语义（F-core-prompt-1 的 bug 出处），后者做全量校验（含唯一块名、
   首尾角色、宏白名单）。`resolveAgentDefinitionFromStorage` 的 domain-shape 分支**只跑前者**，
   即存储捷径不做唯一块名校验、不做宏白名单校验、不做首尾角色校验。
   这是有意的性能取舍（域对象本已组装过）还是遗漏，**我没有找到拍板文档**，标为存疑。
   若主代理能找到依据，属 intentional 就不必改。

4. **`formatCharCount` 的 `NaN` 传播链未追到底。** F-core-prompt-6 里
   `Math.max(0, NaN) === NaN` 是确定的，但 `increment` 能否是 `NaN` 取决于
   `infra/tokenizer/logic/incremental-token-counter.ts` 里宿主注入的 encode 绑定
   （RULE 记载「未注入估算器时保持 `ceil(chars/3.35)` 旧行为」）的错误处理——那在本区外，
   我没有追。**建议 W3「token 指标语义」横切机位顺带核一下这条链。**

5. **`domain/format/` 归到本区是按派单目录划的，但它与 `domain/prompt/` 无任何依赖关系**
   （除 `format-stream-metrics-line` → `format-char-count` 的内部引用）。
   `sliding-token-rate.ts:24` 引的是 `domain/session-run-state`。
   建议 L3 考虑把 `domain/format/` 单独成域（它是「流式指标展示派生值」，
   与「提示词装配」是两个正交关注点），否则后续按域派单会反复出现跨域的半个文件。

## 附：本区未被本报告认定为问题的刻意设计（备查，避免重复提单）

- **`expandDynamicMacros` 的 `now = ctx.now ?? new Date()` 兜底**：`prompt-render-context.ts:23`
  注明「Defaults to `new Date()` when omitted (tests inject a fixed time)」，是有意的默认可测性设计。
- **`slidingTokenRate` 的未来样本处理**（`:53-56` 向前扫 + `:65-67` 窗口裁剪带 `<= nowMs` 二次判定）：
  逻辑冗余（序列已保证升序、无未来样本）但对「外部直接调用 `slidingTokenRate` 传脏序列」是防御，
  且 `test/domain/format/sliding-token-rate.test.ts:94-113` 有专门的回拨用例。**刻意冗余，标 intentional。**
- **`stream-token-anchor.ts` 的两个公式只有 2 条测试**：`composeStreamTokens`/`reanchorStreamTokenBase`
  恒等式在 `test/domain/format/stream-token-anchor.test.ts` 锁了
  （`compose(reanchor(t, i), i) === max(0, t)`），覆盖面薄但被
  `test/agent/agent-runner-token-cache.test.ts` 等集成测试间接覆盖。**不是废断言。**
- **`WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT` 的独立声明**（不复用 bridge 常量）：
  `agent-prompt-layout.ts:46-48` 注明「勿再 import bridge 常量」，是刻意解耦。**intentional。**
- **`persist` 区禁一切 `{{` 宏**（`validate-dynamic-macros.ts:63-70` 用朴素
  `content.includes("{{")` 而非扫描器）：比动态区的精确校验更粗暴，但 persist 本就「原样注入不展开」，
  朴素拒绝零漏判零误判成本，**刻意**。同理 `validate-agent-prompt-layout.ts:115-120`
  禁 persist 带 lifecycle。
