# L0 别名感知循环依赖普查（circular dependencies, alias-aware）

> 机位：确定性普查（Tarjan SCC，自建解析器）。
> 脚本：`tmp/l0census/circular-alias.mjs`（可复跑：`node tmp/l0census/circular-alias.mjs`）。
> 起因：`madge` 之前报「零循环」是**假阴性**——`@/`、`@shared/`、`@web/` 等 tsconfig paths 别名未参与解析，别名边全被丢掉。本脚本按各子项目 tsconfig（合并 `extends` 链）的 `paths` 展开别名，目标路径相对 `baseUrl` 解析。

## 摘要

| 项目 | 节点文件数 | 环（含 type 边） | 其中剔 type 边后仍在 | runtime-risk 环 | runtime-safe 环 |
|---|---|---|---|---|---|
| packages/core（@/* → src/*） | 1082 | 9 | 5 | 0 | 9 |
| apps/mobile（@/* → src/*、@web/* → src/web/*） | 655 | 4 | 2 | 0 | 4 |
| apps/desktop main + shared（无 paths，相对路径） | 100 | 0 | 0 | 0 | 0 |
| apps/desktop renderer（@/* → renderer/*、@shared/* → shared/*） | 162 | 0 | 0 | 0 | 0 |
| apps/cli（无 paths） | 72 | 0 | 0 | 0 | 0 |
| 其余 packages/*（驱动包） | 124 | 0 | 0 | 0 | 0 |

**合计：13 个强连通分量（环）；剔掉 `import type` 边后仍有 7 个环在运行时真实存在；其中 runtime-risk 0 个。**

## 判定口径

- **runtime-risk**：环上存在至少一条「顶层求值用到对方模块」的边。即 A 用**值导入**（非 `import type`）从环内 B 取了绑定 x，并在**模块顶层**（花括号深度 0：顶层 const 初始化、顶层副作用调用、顶层 class 字段）用到了 x。这类环在模块初始化期就可能抛 TDZ / 拿到 undefined。
- **runtime-safe**：环上所有跨环绑定要么是 `import type`（编译后整条边被擦除，运行时根本不成环），要么只在函数体/类体内惰性求值。
- 粗判实现：删除注释 / import 语句 / re-export 列表后逐行累积花括号深度，深度 0 记 top-level，深度 > 0 记 fn-only。**启发式**：模板串与正则字面量里的花括号会偏移深度；`export const x = y` 这类顶层别名也算 top-level。交 W3 逐条下钻确认。

## 逐环明细

### packages/core（@/* → src/*） —— 9 环 / 0 自环

#### CYC-001 · **runtime-safe** · 3 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/domain/provider/model/model-sampling-params.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`LlmProtocolKind` |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`LlmProtocolKind` |
| `packages/core/src/infra/llm-protocol/ports/adapter.port.ts` | 2 个 | 类型位（import type 或纯类型声明，编译后擦除）2 个：`ModelSamplingParams` `ModelThinkingParams` |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/domain/provider/model/model-thinking-params.ts
  -> packages/core/src/infra/llm-protocol/ports/adapter.port.ts   // import type（编译后擦除）
packages/core/src/domain/provider/model/model-sampling-params.ts
  -> packages/core/src/infra/llm-protocol/ports/adapter.port.ts   // import type（编译后擦除）
packages/core/src/infra/llm-protocol/ports/adapter.port.ts
  -> packages/core/src/domain/provider/model/model-sampling-params.ts   // import type（编译后擦除）
packages/core/src/infra/llm-protocol/ports/adapter.port.ts
  -> packages/core/src/domain/provider/model/model-thinking-params.ts   // import type（编译后擦除）
```

#### CYC-002 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/domain/vfs/logic/vfs-grep.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`VfsGrepMatch` |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`VfsGrepOptions` |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/domain/vfs/logic/vfs-grep.ts
  -> packages/core/src/domain/vfs/ports/vfs-service.port.ts   // import type（编译后擦除）
packages/core/src/domain/vfs/ports/vfs-service.port.ts
  -> packages/core/src/domain/vfs/logic/vfs-grep.ts   // import type（编译后擦除）
```

#### CYC-003 · **runtime-safe** · 3 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` | 1 个 | 仅函数体/惰性：`createSkillsService`←create-skills-service.ts |
| `packages/core/src/service/skills/create-skills-service.ts` | 1 个 | 仅函数体/惰性：`SkillsService`←skills.service.ts |
| `packages/core/src/service/skills/impl/skills.service.ts` | 1 个 | 仅函数体/惰性：`BUILTIN_SKILL_NAMES`←seed-builtin-skills.ts |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/service/skills/impl/skills.service.ts
  -> packages/core/src/bootstrap/skills/seed-builtin-skills.ts
packages/core/src/service/skills/create-skills-service.ts
  -> packages/core/src/service/skills/impl/skills.service.ts
packages/core/src/bootstrap/skills/seed-builtin-skills.ts
  -> packages/core/src/service/skills/create-skills-service.ts
```

#### CYC-004 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | 2 个 | 仅函数体/惰性：`buildToolsPolicyFromSelection`←agent-tool-catalog.ts `toolsSelectionFromDefinition`←agent-tool-catalog.ts |
| `packages/core/src/config-forms/agent/agent-tool-catalog.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`ToolsMode` |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/config-forms/agent/agent-tool-catalog.ts
  -> packages/core/src/config-forms/agent/agent-editor-state.ts   // import type（编译后擦除）
packages/core/src/config-forms/agent/agent-editor-state.ts
  -> packages/core/src/config-forms/agent/agent-tool-catalog.ts
```

#### CYC-005 · **runtime-safe** · 9 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/domain/agent/logic/validate-agent-definition.ts` | 1 个 | 仅函数体/惰性：`validateAgentToolPolicy`←validate-agent-tool-policy.ts |
| `packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts` | 2 个 | 仅函数体/惰性：`FILE_TOOL_NAMES`←vfs-tools.ts `normalizeAgentToolPolicyName`←vfs-tools.ts |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`AgentRegistryService` |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`BuiltinToolContext` |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | 4 个 | 仅函数体/惰性：`executeFsCommand`←fs-command.ts `parseFsCommand`←fs-command.ts<br>类型位（import type 或纯类型声明，编译后擦除）2 个：`BuiltinToolContext` `FsCommandResult` |
| `packages/core/src/domain/tool/logic/fs-command-classify.ts` | 3 个 | 仅函数体/惰性：`SKILL_TOOL_NAME`←skill-tool.ts `parseFsCommand`←fs-command.ts<br>类型位（import type 或纯类型声明，编译后擦除）1 个：`FsToolInput` |
| `packages/core/src/domain/tool/logic/fs-command.ts` | 1 个 | 仅函数体/惰性：`classifyFsCommand`←fs-command-classify.ts |
| `packages/core/src/service/agent/agent-registry.port.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`ValidateAgentDefinitionOptions` |
| `packages/core/src/service/persistent-state/persistent-state.port.ts` | 0 个 | 环上无实际使用的绑定 |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/domain/tool/builtin/skill-tool.ts
  -> packages/core/src/domain/tool/builtin/builtin-tool-context.ts   // import type（编译后擦除）
packages/core/src/domain/tool/logic/fs-command-classify.ts
  -> packages/core/src/domain/tool/builtin/skill-tool.ts
packages/core/src/domain/tool/logic/fs-command-classify.ts
  -> packages/core/src/domain/tool/logic/fs-command.ts
packages/core/src/domain/tool/logic/fs-command.ts
  -> packages/core/src/domain/tool/logic/fs-command-classify.ts
packages/core/src/service/persistent-state/persistent-state.port.ts
  -> packages/core/src/service/agent/agent-registry.port.ts
packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts
  -> packages/core/src/domain/tool/builtin/vfs-tools.ts
packages/core/src/domain/agent/logic/validate-agent-definition.ts
  -> packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts
packages/core/src/service/agent/agent-registry.port.ts
  -> packages/core/src/domain/agent/logic/validate-agent-definition.ts   // import type（编译后擦除）
packages/core/src/service/agent/agent-registry.port.ts
  -> packages/core/src/service/persistent-state/persistent-state.port.ts
packages/core/src/domain/tool/builtin/builtin-tool-context.ts
  -> packages/core/src/service/agent/agent-registry.port.ts   // import type（编译后擦除）
packages/core/src/domain/tool/builtin/vfs-tools.ts
  -> packages/core/src/domain/tool/builtin/builtin-tool-context.ts   // import type（编译后擦除）
packages/core/src/domain/tool/builtin/vfs-tools.ts
  -> packages/core/src/domain/tool/logic/fs-command.ts
```

#### CYC-006 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/domain/chat/logic/rollback-confirm-copy.ts` | 1 个 | 仅函数体/惰性：`formatRollbackRevisionBackfillAlertMessage`←session-fs-errors.ts |
| `packages/core/src/errors/session-fs-errors.ts` | 0 个 | 环上无实际使用的绑定 |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/errors/session-fs-errors.ts
  -> packages/core/src/domain/chat/logic/rollback-confirm-copy.ts
packages/core/src/domain/chat/logic/rollback-confirm-copy.ts
  -> packages/core/src/errors/session-fs-errors.ts
```

#### CYC-007 · **runtime-safe** · 3 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/infra/nmtp/logic/registry.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`TokenizerDriver` |
| `packages/core/src/infra/nmtp/ports/tokenizer-driver.port.ts` | 2 个 | 类型位（import type 或纯类型声明，编译后擦除）2 个：`CountPromptLlmInputParams` `PromptTokenCountResult` |
| `packages/core/src/infra/tokenizer/logic/count-prompt-llm-input.ts` | 1 个 | 仅函数体/惰性：`resolveTokenizerDriver`←registry.ts |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/infra/nmtp/ports/tokenizer-driver.port.ts
  -> packages/core/src/infra/tokenizer/logic/count-prompt-llm-input.ts   // import type（编译后擦除）
packages/core/src/infra/nmtp/logic/registry.ts
  -> packages/core/src/infra/nmtp/ports/tokenizer-driver.port.ts   // import type（编译后擦除）
packages/core/src/infra/tokenizer/logic/count-prompt-llm-input.ts
  -> packages/core/src/infra/nmtp/logic/registry.ts
```

#### CYC-008 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/domain/provider/logic/resolve-thinking-wire.ts` | 1 个 | 仅函数体/惰性：`thinkingLevelToModelThinkingParams`←thinking-level-presets.ts |
| `packages/core/src/domain/provider/logic/thinking-level-presets.ts` | 1 个 | 仅函数体/惰性：`resolveEffectiveMaxTokens`←resolve-thinking-wire.ts |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/domain/provider/logic/thinking-level-presets.ts
  -> packages/core/src/domain/provider/logic/resolve-thinking-wire.ts
packages/core/src/domain/provider/logic/resolve-thinking-wire.ts
  -> packages/core/src/domain/provider/logic/thinking-level-presets.ts
```

#### CYC-009 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`AgentTurnRuntimePort` |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | 1 个 | 仅函数体/惰性：`assembleAgentRunnerDeps`←assemble-agent-runner-deps.ts |

环边（源 → 目标，按环上邻接）：

```
packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts
  -> packages/core/src/service/agent/logic/run-agent-turn.ts   // import type（编译后擦除）
packages/core/src/service/agent/logic/run-agent-turn.ts
  -> packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts
```

### apps/mobile（@/* → src/*、@web/* → src/web/*） —— 4 环 / 0 自环

#### CYC-010 · **runtime-safe** · 3 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `apps/mobile/src/runtime/types.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`SessionStreamUnitManager` |
| `apps/mobile/src/services/agent-run.service.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`MobileNovelMasterRuntime` |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | 2 个 | 仅函数体/惰性：`defaultRunAgentTurn`←agent-run.service.ts<br>类型位（import type 或纯类型声明，编译后擦除）1 个：`MobileNovelMasterRuntime` |

环边（源 → 目标，按环上邻接）：

```
apps/mobile/src/services/agent-run.service.ts
  -> apps/mobile/src/runtime/types.ts   // import type（编译后擦除）
apps/mobile/src/services/session-stream-unit-manager.service.ts
  -> apps/mobile/src/services/agent-run.service.ts
apps/mobile/src/services/session-stream-unit-manager.service.ts
  -> apps/mobile/src/runtime/types.ts   // import type（编译后擦除）
apps/mobile/src/runtime/types.ts
  -> apps/mobile/src/services/session-stream-unit-manager.service.ts   // import type（编译后擦除）
```

#### CYC-011 · **runtime-safe** · 6 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts` | 12 个 | 仅函数体/惰性：`handleSnapshotPayload`←snapshot.ts `applyPrependPage`←snapshot.ts `applyAppendTailRows`←snapshot.ts `applyStreamCommit`←snapshot.ts `appendStreamDelta`←stream.ts `applyStreamBatch`←stream.ts `applyStreamBlockCommit`←stream.ts `resetStreamBlockRenderState`←stream.ts `setStreamToolInvokingDom`←stream.ts `clearStreamRichUpgrade`←stream-markdown.ts `closeContextMenu`←menu.ts `scheduleStickIfNearBottom`←scroll.ts |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | 1 个 | 仅函数体/惰性：`post`←bridge.ts |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | 6 个 | 仅函数体/惰性：`offsetFromBottom`←scroll.ts `isNearBottom`←scroll.ts `stickToBottom`←scroll.ts `emitScrollSnapshot`←scroll.ts `closeContextMenu`←menu.ts `setStreamToolInvokingDom`←stream.ts |
| `apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts` | 1 个 | 仅函数体/惰性：`post`←bridge.ts |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | 9 个 | 仅函数体/惰性：`scheduleStickIfNearBottom`←scroll.ts `assistantBubbleExtraClasses`←stream.ts `ensureStreamTextBody`←stream.ts `getStreamActiveTailText`←stream.ts `getStreamThinkingBody`←stream.ts `setStreamBodyRichClass`←stream.ts `setStreamTailPlainClass`←stream.ts `streamRenderTarget`←stream.ts<br>类型位（import type 或纯类型声明，编译后擦除）1 个：`StreamKind` |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | 3 个 | 仅函数体/惰性：`scheduleStickIfNearBottom`←scroll.ts `scheduleStreamRichUpgrade`←stream-markdown.ts `streamRichUpgrade`←stream-markdown.ts |

环边（源 → 目标，按环上邻接）：

```
apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts
apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts
apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts
apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts
apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts
apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts
  -> apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
```

#### CYC-012 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `apps/mobile/src/services/cloud-sync-progress-log.ts` | 2 个 | 仅函数体/惰性：`mapCloudSyncProgressEvent`←cloud-sync-progress-ui.ts<br>类型位（import type 或纯类型声明，编译后擦除）1 个：`CloudSyncProgressListener` |
| `apps/mobile/src/services/cloud-sync-progress-ui.ts` | 1 个 | 类型位（import type 或纯类型声明，编译后擦除）1 个：`CloudSyncProgressOp` |

环边（源 → 目标，按环上邻接）：

```
apps/mobile/src/services/cloud-sync-progress-ui.ts
  -> apps/mobile/src/services/cloud-sync-progress-log.ts   // import type（编译后擦除）
apps/mobile/src/services/cloud-sync-progress-log.ts
  -> apps/mobile/src/services/cloud-sync-progress-ui.ts
```

#### CYC-013 · **runtime-safe** · 2 文件

| 文件 | 环上跨文件绑定 | 绑定种类与引用位置 |
|---|---|---|
| `apps/mobile/src/web/composer-input/webview/runtime/bridge.ts` | 6 个 | 仅函数体/惰性：`applyDisabled`←editor.ts `applyInit`←editor.ts `applySelection`←editor.ts `applyText`←editor.ts `applyTheme`←editor.ts `blurComposerInput`←editor.ts |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | 1 个 | 仅函数体/惰性：`post`←bridge.ts |

环边（源 → 目标，按环上邻接）：

```
apps/mobile/src/web/composer-input/webview/runtime/bridge.ts
  -> apps/mobile/src/web/composer-input/webview/runtime/editor.ts
apps/mobile/src/web/composer-input/webview/runtime/editor.ts
  -> apps/mobile/src/web/composer-input/webview/runtime/bridge.ts
```

### apps/desktop main + shared（无 paths，相对路径） —— 0 环 / 0 自环

_无强连通分量（>1 文件）。_

### apps/desktop renderer（@/* → renderer/*、@shared/* → shared/*） —— 0 环 / 0 自环

_无强连通分量（>1 文件）。_

### apps/cli（无 paths） —— 0 环 / 0 自环

_无强连通分量（>1 文件）。_

### 其余 packages/*（驱动包） —— 0 环 / 0 自环

_无强连通分量（>1 文件）。_

## 已知局限

- 解析器是正则 + 启发式，未使用 TypeScript AST；`require()`、动态 `import()` 只建边不解析符号。
- 跨项目边（如 desktop renderer → packages/core）在本报告中按组裁掉，跨组环不会被检出；若需要跨组 SCC 可复用 `circular-alias.json` 的全局图。
- `@novel-master/*` 按各包 `package.json` 的 `exports` 字段把 `dist/x.js` 反推为 `src/x.ts`；若某包 exports 与源码布局不符，该包的边会漏。
- 未解析的说明符（第三方包、动态拼接）不建边；它们不影响仓内环判定，但会让「某文件只被动态 require」的判断失真。