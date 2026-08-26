---
date: 2026-08-25
dependency:
  - Iterations/thinking-context-toggle/prd.md
  - Iterations/thinking-level/prd.md
---

# thinking 进入上下文开关技术规格（SPEC）

## 设计目标

1. **用户可控**：新增全局偏好「思考内容进入上下文」（thinking context），默认开，持久化于 KKV 域 `nm-preferences`，双端聊天设置可切换、状态一致。
2. **语义明确**：
   - 档位前置 = 本次请求未启用 thinking（档位 off，`requestThinkingEnabled: false`）时，无论开关开 / 关，thinking / redacted_thinking 一律全剥，不做任何最低保留（见口径澄清节）。
   - 开 = **仅当本次请求启用 thinking 档位时**，仅「最新一轮」（最后一条**真实用户输入**之后的所有 assistant 轮次，含工具循环内的全部 assistant 消息）的 thinking / redacted_thinking 进入提示词，且原样回传（含签名、不重排、不删改）；更早轮次一律剥离；档位 off 时按档位前置全剥。
   - 关 = 全部剥离；但 anthropic / gemini 协议在**活跃工具循环**内强制要求的最低保留集合（出站列表中最后一条 assistant 消息且该消息含 tool_use 块时，其 thinking 块按协议保留）不向用户暴露（预览不展示）；该保留同样受档位前置约束，仅在本次请求启用 thinking 时生效（见口径澄清节）。
3. **单点覆盖三协议**：剥离在 core 出站链路统一完成（mapper 之前），openai 协议行为不因开关改变（其 mapper 本就全量过滤 thinking）。
4. **预览同步**：「查看提示词」面板与实际发送口径一致——开时可见最新轮 thinking，关时不可见。
5. **不碰落库与展示**：transcript 存储格式、聊天界面思考折叠卡片维持现状；剥离只作用于 LLM 出站视图（view-time transform，不回写数据库）。

### 口径澄清（实现层必须统一的边界定义与保留条件）

- **「最后一条 user 消息」不能按字面 role 判定**。工具循环内 tool_result 以 `user` 角色落库（`agent-runner.ts` L649 `session.append("user", { blocks: toolResults })`），若按字面取最后一条 user，工具循环中待续跑的 assistant thinking 会被误剥离、触发服务商 400。因此边界定义为：**最后一条「含非 tool_result 块」的 user 消息**（即真实用户输入；tool_result 载体消息不算）。找不到时整个历史视为历史轮（全剥）。
- **边界只在 chat 区消息内定位，合成模板消息不参与边界判定**。`buildPromptLlmInputFromLayout` 会在 chat 消息之后追加 dynamic 区合成消息（`render-prompt.ts` `syntheticTemplateMessage`），且 `DynamicPromptBlock.role` 允许 `"user"`（`agent-prompt-layout.ts`）；persist / dynamic / workplace / skills 区的合成消息 id 均以 `"prompt:"` 为前缀（如 `prompt:<name>`、`prompt:workplace`、`prompt:skills`）。若不排除，边界落在 dynamic 区 role 为 `"user"` 的合成消息上，「仅最新一轮」会退化为「全部保留」。因此判定规则为：**先排除 `id` 以 `"prompt:"` 为前缀的合成消息，再在剩余 chat 消息内取最后一条「含非 tool_result 块」的 user 消息**。该判定在纯函数内单点实现、不依赖 `LlmExportZones`——wire 侧（`normalizeForLlmExport` 之后，含合成消息）与预览侧（`buildSessionPromptInput` 的 `ctx.messages`，不含合成消息，排除规则为 no-op）共用同一纯函数，保证两侧剥离集合一致（见 Step 6 与 T-PV2）。
- **落库合成消息的边界语义**：`user_vfs_action` 是 user 角色、含 text 块的合成消息（`raw.metadata.kind === "user_vfs_action"`，不在 `"prompt:"` 前缀之列），视为真实用户输入、**重置边界**；`tool_turn_bridge` 为 assistant 合成，不参与边界判定（自身亦无 thinking 块）。
- **档位前置（全局门，先于开关判定）**：本次请求档位为 off（`requestThinkingEnabled: false`）时，无论开关开 / 关，thinking / redacted_thinking 一律全剥、不做任何最低保留。依据：anthropic mapper 无条件映射 thinking / redacted_thinking 块（`anthropic-content-mapper.ts` L54-65），而 `body.thinking` 仅在档位非 off 时写入（`apply-thinking-to-body.ts` L24-26、`model-request.service.ts` L153-158）；「开关开 + 档位从高改回关」与「开关关 + 档位从高改回关」的组合下若仍保留任何 thinking 块（开态的最新轮或关态的最低保留），都会把 thinking 块发给未启用 thinking 的请求、触发 400。因此剥离函数先判 `requestThinkingEnabled`，为 false 时直接全剥返回；为 true 才进入开关分支。
- **「关」的协议最低保留集合**：出站列表中**最后一条 assistant 消息**若含 tool_use 块（其 tool_result 作为 trailing user 消息待回传，即活跃工具循环），anthropic 与 gemini 协议保留该消息的全部 thinking + redacted_thinking 原样不剥。anthropic 依据官方硬约束（最终 assistant turn 的 thinking 不得重排/编辑/部分丢弃，违者 400）；gemini 依据 thought 签名在函数调用循环中的回传校验。openai 无此保留（全剥，mapper 本就过滤）。**前置条件：最低保留仅在本次请求启用 thinking 时生效**——档位 off 时已在上述档位前置（全局门）处全剥，最低保留分支不可达。

## 总体方案

三层改动：

1. **偏好层**：`PersistentPreferences` 新增 typed 三件套 `getThinkingContextEnabled` / `setThinkingContextEnabled` / `resetThinkingContextEnabled`，key `chat.thinkingContext`，默认 `true`——完全沿用 `llmStreamEnabled`（`chat.llmStream`）的既有模式。
2. **出站剥离层（core，单点）**：新增纯函数 `applyThinkingContextForLlm(messages, options)`，放在 `packages/core/src/service/prompt/`（与同为 view-time LLM history transform 的 `normalize-orphan-tool-results-for-llm.ts` 同目录、同惯例）。`ThinkingContextOptions` 含 `enabled`（开关）、`protocol`、`retainProtocolMinimum` 与 **`requestThinkingEnabled`（本次请求 thinking 是否启用）**四个输入；边界判定按口径澄清节的规则单点实现（排除 `"prompt:"` 前缀合成消息 + 最后一条含非 tool_result 块的 user 消息），**不依赖 `LlmExportZones`**，wire 与预览两侧共用同一判定。`agent-runner` 在 `normalizeForLlmExport` 之后、`normalizeOrphanToolResultsForLlm` **之前**插入调用（精确化见「风险」节的顺序论证）。
3. **偏好进 runner 的注入路径**：不走 `llmStreamEnabled` 的 per-call options 路径（app 层读偏好 → `RunAgentTurnOptions.stream` 传入），因为该路径覆盖不了 `runChildAgent`（子代理）与事件轨。改为 `AgentTurnRuntimePort` 声明可选窄切片 `preferences?: Pick<PersistentPreferences, "getThinkingContextEnabled">`，经 `assembleAgentRunnerDeps` 透传进 `CreateAgentRunnerDeps`。三端 runtime（desktop / mobile / CLI）的 runtime 对象均已携带完整 `preferences: PersistentPreferences` 字段，结构化兼容，**无需 app 端 runtime 改动**；runner 每 run 读取一次快照（对齐 `savedModelForAppend` 的读法），run 中途切换开关不影响进行中的 run。

预览同步：`formatChatMessageForCliPreview` 增加 opt-in 参数 `includeThinking`（默认 false，保持 CLI 文本与 token 计数 parity 现状），desktop / mobile 的 `prompt-preview.service.ts` 读同一偏好、用同一个纯函数预过滤消息后按开关渲染。

## 最终项目结构

```text
packages/core/src/
  service/
    persistent-preferences/
      persistent-preferences.port.ts                  # +thinkingContext 三件套声明
      impl/
        persistent-preferences.service.ts            # +实现（getBooleanPref 模式）
        preference-keys.ts                            # +PREF_KEY_CHAT_THINKING_CONTEXT
    prompt/
      apply-thinking-context-for-llm.ts              # ★ 新增纯函数（剥离/保留规则单点）
      normalize-orphan-tool-results-for-llm.ts        # 不动（顺序见风险节）
    agent/
      logic/
        run-agent-turn.ts                             # AgentTurnRuntimePort +preferences 窄切片
        assemble-agent-runner-deps.ts                  # runtime Pick +preferences 透传
      create-agent-runner.ts                          # CreateAgentRunnerDeps +preferences
      impl/agent-runner.ts                            # 每 run 读偏好；出站插入剥离调用
  domain/
    chat/
      content/message-body-text.ts                    # formatChatMessageForCliPreview +includeThinking
  service/prompt/render-prompt.ts                     # PromptAssemblyOptions +includeThinkingBlocks 透传
  public/prompt.ts                                    # 导出 applyThinkingContextForLlm
packages/core/test/
  service/prompt/apply-thinking-context-for-llm.test.ts   # ★ 新增纯函数单测
  persistent-preferences/persistent-preferences.test.ts   # 扩展新 key 用例
  prompt/render-prompt.test.ts                            # 扩展 includeThinkingBlocks 用例
apps/desktop/
  shared/ipc-types.ts                               # +PREFERENCES_GET/SET_THINKING_CONTEXT 通道
  src/main/ipc/handlers/preferences.ts              # +handlePreferencesGet/SetThinkingContext
  src/main/ipc/handler-registry.ts                  # +bindNoArg / bindBool
  src/main/services/prompt-preview.service.ts       # 预览按偏好预过滤 + includeThinkingBlocks
  renderer/ipc/invoke-registry.ts                   # +ipcPreferencesGet/SetThinkingContext
  renderer/features/settings/WorkspaceSettingsView.tsx  # 聊天偏好区 +开关
apps/mobile/
  src/screens/stack/ChatConfigScreen.tsx            # +ProfileSwitchItem 开关
  src/services/prompt-preview.service.ts            # 预览按偏好预过滤 + includeThinkingBlocks
apps/cli/
  src/preferences-cmd/commands.ts                   # +KNOWN_KEYS 与 get/set/reset 分支（parity，可选）
```

## 变更点清单

| # | 文件 | 符号 / 位置 | 变更 |
|---|------|------------|------|
| 1 | `packages/core/src/service/persistent-preferences/impl/preference-keys.ts` | `PREF_KEY_CHAT_THINKING_CONTEXT` | 新增常量 `"chat.thinkingContext"` |
| 2 | `packages/core/src/service/persistent-preferences/persistent-preferences.port.ts` | `PersistentPreferences` | 新增 `getThinkingContextEnabled()` / `setThinkingContextEnabled(boolean)` / `resetThinkingContextEnabled()` |
| 3 | `packages/core/src/service/persistent-preferences/impl/persistent-preferences.service.ts` | `DefaultPersistentPreferences` | 按 `getLlmStreamEnabled` 模式实现三件套（`getBooleanPref(key, true)` 默认开） |
| 4 | `packages/core/src/service/prompt/apply-thinking-context-for-llm.ts` | `applyThinkingContextForLlm` / `ThinkingContextOptions` | ★ 新增纯函数：按开关与协议剥离历史 thinking；`ThinkingContextOptions` 含 `enabled` / `protocol` / `retainProtocolMinimum` / `requestThinkingEnabled`；边界判定排除 `"prompt:"` 前缀合成消息（不依赖 zones），`requestThinkingEnabled: false` 为全局前置门：无论 `enabled` 开 / 关一律全剥、不做最低保留；不可变返回（未变更消息保持原引用，同 `normalizeOrphanToolResultsForLlm` 模式） |
| 5 | `packages/core/src/service/agent/create-agent-runner.ts` | `CreateAgentRunnerDeps` | +`preferences?: Pick<PersistentPreferences, "getThinkingContextEnabled">` |
| 6 | `packages/core/src/service/agent/logic/run-agent-turn.ts` | `AgentTurnRuntimePort` | +同上窄切片（可选；三端 runtime 结构化兼容） |
| 7 | `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts` | `AssembleAgentRunnerDepsInput.runtime` Pick / `base` | Pick 列表 +`"preferences"`；`base` 透传 `preferences: input.runtime.preferences` |
| 8 | `packages/core/src/service/agent/impl/agent-runner.ts` | `DefaultAgentRunnerDeps` / `run()` | deps +`preferences?`；step 循环前读一次 `thinkingContextEnabled`（缺省 true）；L431-436 之间插入 `applyThinkingContextForLlm(exportMessages, …)`，结果再交 `normalizeOrphanToolResultsForLlm`；`requestThinkingEnabled` 由 `savedModelForAppend.settings.generation.thinkingLevel !== "off"` 得出（对齐 `model-request.service.ts` L153-158 的档位解析口径） |
| 9 | `packages/core/src/domain/chat/content/message-body-text.ts` | `formatChatMessageForCliPreview` | +可选参 `options?: { includeThinking?: boolean }`；true 时 thinking 块产出一个 `role: "thinking"` 段（redacted 用占位文本），默认 false 行为不变 |
| 10 | `packages/core/src/service/prompt/render-prompt.ts` | `PromptAssemblyOptions` / `buildPromptAssemblyFromLayout` / `buildPromptPreviewSegmentsFromLayout` | +`includeThinkingBlocks?: boolean`（默认 false），透传给 `formatChatMessageForCliPreview` |
| 11 | `packages/core/src/public/prompt.ts` | 公共导出 | 导出 `applyThinkingContextForLlm` 与 `ThinkingContextOptions` |
| 12 | `apps/desktop/shared/ipc-types.ts` | `IPC_CHANNELS` | +`PREFERENCES_GET_THINKING_CONTEXT: 'nm:preferences/getThinkingContext'` / `PREFERENCES_SET_THINKING_CONTEXT: 'nm:preferences/setThinkingContext'` |
| 13 | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 新 handler | `handlePreferencesGetThinkingContext` / `handlePreferencesSetThinkingContext`（照 LlmStream 对写） |
| 14 | `apps/desktop/src/main/ipc/handler-registry.ts` | `registerHandlersFromRegistry` | `bindNoArg` / `bindBool` 注册新通道 |
| 15 | `apps/desktop/src/main/services/prompt-preview.service.ts` | `buildRealPromptPreviewSegments` | 读 `runtime.preferences.getThinkingContextEnabled()`；`ctx.messages` 先过 `applyThinkingContextForLlm(…, { enabled, retainProtocolMinimum: false, requestThinkingEnabled })`（`requestThinkingEnabled` 取值与 wire 侧 `resolveSavedModelId` 同优先级：agent pin 模型 → 会话 `modelId` 覆盖，再读档位，见 Step 6）；`includeThinkingBlocks: enabled` 传入 core |
| 16 | `apps/desktop/renderer/ipc/invoke-registry.ts` | `createInvokeClient` | +`ipcPreferencesGetThinkingContext` / `ipcPreferencesSetThinkingContext`（noArg / withBool） |
| 17 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx` | 聊天偏好区（L220-249） | +`SettingsSwitchRow`「思考进入上下文」：state 初值 true、refresh 读、onChange 写 |
| 18 | `apps/mobile/src/services/prompt-preview.service.ts` | `buildRealPromptPreviewSegments` | 同变更点 15（mobile 侧） |
| 19 | `apps/mobile/src/screens/stack/ChatConfigScreen.tsx` | `ChatConfigScreen` | +`ProfileSwitchItem` 开关（照「流式输出」L134-150 模式：state + refresh 读 + `runtime.preferences.set` 写） |
| 20 | `apps/cli/src/preferences-cmd/commands.ts` | `KNOWN_KEYS` / get/set/reset | +`chat.thinkingContext` 分支（CLI parity，非阻塞） |

## 详细实现步骤

Step 1 — phase-pref-keys — blocking: yes — qa: auto：在 `preference-keys.ts` 加 `PREF_KEY_CHAT_THINKING_CONTEXT = "chat.thinkingContext"`；`PersistentPreferences` 端口与 `DefaultPersistentPreferences` 按 `llmStreamEnabled` 模式实现 `get/set/resetThinkingContextEnabled` 三件套，默认 `true`。命名对齐既有 `chat.llmStream` / `getLlmStreamEnabled` 先例（key 用 camelCase 值域、方法用 Enabled 后缀）。

Step 2 — phase-strip-logic — blocking: yes — qa: auto：新建 `packages/core/src/service/prompt/apply-thinking-context-for-llm.ts` 实现 `applyThinkingContextForLlm(messages, options)`。边界定位（口径澄清节的规则，单点实现、不依赖 zones）：先排除 `id` 以 `"prompt:"` 为前缀的合成消息（persist / dynamic / workplace / skills 区模板消息），再在剩余 chat 消息中取最后一条「含非 tool_result 块」的 user 消息下标（缺省 -1）；`user_vfs_action`（user 角色、含 text 块、`raw.metadata.kind === "user_vfs_action"`）视为真实用户输入、重置边界；`tool_turn_bridge`（assistant 合成）不参与判定。**规则判定顺序（档位前置为全局门）**：先判 `requestThinkingEnabled`——为 false 时无论 `enabled` 开 / 关一律全剥（含最新轮 thinking 与协议最低保留，见口径澄清节），直接返回；为 true 时再按 `enabled` 分支：`enabled: true` 剥边界前的 assistant thinking / redacted_thinking、边界后原样保留；`enabled: false` 时全剥，仅当 `retainProtocolMinimum && protocol ∈ {anthropic, gemini}` 时按口径澄清节的定义保留——**出站列表中最后一条 assistant 消息**若含 tool_use 块（其 tool_result 作为 trailing user 消息待回传，即活跃工具循环），该消息的全部 thinking / redacted_thinking 跳过剥离；判定不回溯更早的 assistant 消息，历史已完结工具循环（tool_use 已被 tool_result 回应、其后另有 assistant 或 user 消息）不在保留集合（最低保留分支仅在 `requestThinkingEnabled` 已为 true 时可达）。不可变：无变更的消息返回原引用。同步在 `public/prompt.ts` 导出。

Step 3 — phase-strip-tests — blocking: yes — qa: auto：新建 `packages/core/test/service/prompt/apply-thinking-context-for-llm.test.ts`，覆盖 T-TC1 ~ T-TC7（见测试策略）。

Step 4 — phase-runner-inject — blocking: yes — qa: auto：`AgentTurnRuntimePort` / `AssembleAgentRunnerDepsInput.runtime` Pick / `CreateAgentRunnerDeps` 三处加可选 `preferences` 窄切片并透传；`agent-runner.ts` 在 step 循环前（对齐 `savedModelForAppend` L259 附近）读一次 `thinkingContextEnabled = (await this.deps.preferences?.getThinkingContextEnabled()) ?? true`；同一处由 `savedModelForAppend.settings.generation.thinkingLevel !== "off"` 得出 `requestThinkingEnabled`（与 `model-request.service.ts` L153-158 的档位解析同口径，作为 per-run 快照；`savedModelForAppend == null` 时取 `true`——保守保留方向，`findById` 可返回 null（L259）、与 L501 判空惯例一致，该请求本身随 MODEL_NOT_SAVED 校验失败，取值仅保守占位）；在 L431-435 `normalizeForLlmExport` 之后、L436 `normalizeOrphanToolResultsForLlm` 之前插入 `const stripped = applyThinkingContextForLlm(exportMessages, { enabled: thinkingContextEnabled, protocol, retainProtocolMinimum: true, requestThinkingEnabled })`，`llmMessages = normalizeOrphanToolResultsForLlm(stripped)`。

Step 5 — phase-preview-render — blocking: yes — qa: auto：`formatChatMessageForCliPreview` 加 `options?: { includeThinking?: boolean }`（thinking → `role: "thinking"` 段、redacted → `[redacted thinking]` 占位，块序保持在消息内位置）；`PromptAssemblyOptions` 加 `includeThinkingBlocks?: boolean` 并在 `buildPromptAssemblyFromLayout` 透传。默认 false：CLI 文本格式与 `serializePromptLlmInput` token 计数 parity 行为不变。

Step 6 — phase-preview-services — blocking: yes — qa: manual_user：desktop 与 mobile 的 `prompt-preview.service.ts`：读偏好 → `ctx.messages` 过 `applyThinkingContextForLlm(…, { enabled, retainProtocolMinimum: false, requestThinkingEnabled })`（`requestThinkingEnabled` 取值路径与 wire 侧 `resolveSavedModelId`（`domain/agent/logic/resolve-saved-model-id.ts`）优先级对齐：agent pin 模型 → 会话 `modelId` 覆盖，再 `savedModels.findById` 读其 `settings.generation.thinkingLevel !== "off"`，口径同 Step 4——全局前置门后该值在预览侧是活值（开关开 + 档位 off 时预览同样全剥），不能只读 session 配置漏掉 agent pin；取不到模型——无 pin、无会话配置或 `findById` 返回 null——时按 `true` 兜底，档位按开态参与判定；预览不展示协议最低保留，不向用户暴露）→ `buildPromptPreviewSegmentsFromLayout(layout, previewCtx, { includeThinkingBlocks: enabled })`。**预览与 wire 同构**：两侧共用 Step 2 的同一纯函数与同一边界判定（`"prompt:"` 前缀排除）；预览输入 `ctx.messages` 不含合成消息，排除规则为 no-op，但判定代码同一段，不因 wire 侧有 `zones` 而分叉（见 T-PV2）。

Step 7 — phase-desktop-ipc — blocking: yes — qa: auto：按变更点 12-14、16 接通 desktop IPC 通道（通道常量 → main handler → registry 注册 → renderer client），逐项照 `PREFERENCES_GET/SET_LLM_STREAM` 先例。

Step 8 — phase-desktop-ui — blocking: yes — qa: manual_user：`WorkspaceSettingsView.tsx` 聊天偏好区在「流式输出」之后加 `SettingsSwitchRow`：label「思考进入上下文」，state 初值 true，`refresh` 并入 `ipcPreferencesGetThinkingContext()`，onChange 先 setState 再 `ipcPreferencesSetThinkingContext(next)`。

Step 9 — phase-mobile-ui — blocking: yes — qa: manual_user：`ChatConfigScreen.tsx` 加 `ProfileSwitchItem`（icon / label「思考进入上下文」/ subtitle 开关态说明），state 初值 true，refresh 回调读 `runtime.preferences.getThinkingContextEnabled()`，onValueChange 写 `setThinkingContextEnabled`。

Step 10 — phase-cli-parity — blocking: no — qa: auto：`apps/cli/src/preferences-cmd/commands.ts` 的 `KNOWN_KEYS` 与 get/set/reset switch 加 `chat.thinkingContext` 分支，`nm preferences` 可读写。

Step 11 — phase-qa-regression — blocking: yes — qa: auto：跑 `packages/core` 全量测试（重点 `test/agent/agent-runner*.test.ts`、`test/service/agent/run-agent-turn.test.ts`、`test/prompt/prompt-assembly-parity.test.ts`、`test/infra/llm-protocol/anthropic-thinking-signature.test.ts`），确认无回归；存量用例若断言「历史 thinking 全量透传」需按新默认语义（仅最新一轮）更新断言。

## 测试策略

新增纯函数单测为主体（剥离规则不依赖 IO，单测可完全覆盖三组语义）；runner 接线靠既有 agent-runner 测试套回归；UI 与预览人工验收。

| id | 用例 | 映射 Step | blocking |
|----|------|-----------|----------|
| T-TC1 | 开·历史剥离：多轮会话（user₁/assistant₁(thinking+sig)/user₂/assistant₂(thinking)），输出中 assistant₁ 无 thinking / redacted_thinking，其余块原样 | Step 2, 3, 4 | yes |
| T-TC2 | 开·最新轮与工具循环保留：user → assistant(thinking+sig+tool_use) → user(tool_result) → assistant(thinking+redacted+tool_use) → user(tool_result)，边界后全部 assistant 的 thinking / redacted_thinking 原样回传（签名、顺序、逐字节不变） | Step 2, 3, 4 | yes |
| T-TC3 | 关·anthropic 最低保留：同 T-TC2 消息序列 + `enabled:false, protocol:"anthropic", requestThinkingEnabled:true`，序列最后一条 assistant 消息含 tool_use（活跃工具循环），仅该消息保留 thinking+redacted，其余全剥；历史工具循环已完结：user₁ → a₁(thinking+tool_use) → user(tool_result) → a₂(text) → user₂ → 请求，最后一条 assistant 消息为 a₂ 且不含 tool_use，不触发最低保留，关态 a₁ 的 thinking 全剥；同序列 + `requestThinkingEnabled:false`（档位 off）时全部剥离、无任何最低保留 | Step 2, 3 | yes |
| T-TC4 | 关·gemini 同规则保留；关·openai 全剥（无最低保留）；开·openai 行为与 anthropic 相同口径（剥离不改变 openai 过滤语义） | Step 2, 3 | yes |
| T-TC5 | 边界判定：tool_result 载体的 user 消息不算真实用户输入（不重置边界）；无任何真实 user 消息时全历史剥离；`user_vfs_action` 合成消息（user 角色、含 text 块、`raw.metadata.kind === "user_vfs_action"`）重置边界（其后的 assistant thinking 保留）；`tool_turn_bridge`（assistant 合成）不参与边界判定 | Step 2, 3 | yes |
| T-TC6 | 不可变性：无 thinking 的消息返回原对象引用（`toBe`）；入参数组与消息对象不被修改 | Step 2, 3 | yes |
| T-TC7 | 合成消息不重置边界：输入含 persist / dynamic 区 role 为 `"user"` 的合成消息（`id: "prompt:<name>"`，位于真实用户输入之后），边界仍定位在最后一条真实用户输入，边界前 assistant 的 thinking 被剥离（即「仅最新一轮」不因合成消息退化为「全部保留」）；`prompt:workplace` / `prompt:skills` 同规则 | Step 2, 3 | yes |
| T-TC8 | 档位前置全局门：开态 + 档位 off——同 T-TC2 消息序列 + `enabled:true, requestThinkingEnabled:false`（anthropic 与 gemini），全部 assistant 的 thinking / redacted_thinking 均被剥离（最新轮也不保留，断言全剥）；同输入 `enabled:false`（关态 + 档位 off）输出与之一致 | Step 2, 3 | yes |
| T-PF1 | 偏好三件套：unset 时 `getThinkingContextEnabled()` 返回 true；set false 后 get 为 false；reset 后回到 true；坏值抛 `preferencesInvalidValue`（扩展 `test/persistent-preferences/persistent-preferences.test.ts`） | Step 1 | yes |
| T-PV1 | 预览渲染：`formatChatMessageForCliPreview(msg, { includeThinking: true })` 产出 `role:"thinking"` 段且 redacted 有占位；默认 false 时无 thinking 段（扩展 `test/prompt/render-prompt.test.ts`）；`prompt-assembly-parity.test.ts` 保持通过（默认路径不变） | Step 5 | yes |
| T-PV2 | 预览口径一致性（纯函数级）：`retainProtocolMinimum:false` 时关态输出不含任何 thinking（协议最低保留不进预览）；开态与 wire 侧 `retainProtocolMinimum:true` 的可见集合一致；**含合成消息场景下两侧剥离集合一致**——同一会话分别以 wire 形态（含 `"prompt:"` 合成消息）与预览形态（`ctx.messages`，无合成消息）作为输入，两侧输出中 assistant 消息的 thinking 保留/剥离集合相同（边界判定不依赖 zones，同一纯函数保证） | Step 2, 3, 6 | yes |
| T-RG1 | runner 回归：既有 `agent-runner*.test.ts` / `run-agent-turn.test.ts` / `anthropic-thinking-signature.test.ts` 全部通过；如 mock deps 未注入 `preferences`，行为等同默认开 | Step 4, 11 | yes |
| T-UI1 | desktop 人工验收：设置→聊天偏好出现开关、默认开、切换持久化（重启仍在）、双端一致；开态「查看提示词」可见最新轮 thinking 段、关态不可见 | Step 7, 8 | manual_user |
| T-UI2 | mobile 人工验收：聊天配置页开关同语义；中途切换模型（GLM→Claude）的存量会话发起请求不 400 | Step 9 | manual_user |
| T-UI3 | CLI parity（非阻塞）：`nm preferences get/set/reset chat.thinkingContext` 行为正确 | Step 10 | no |

## 风险与回滚方案

### 风险

1. **工具循环内「关」语义的最低保留集合验证（高危）**：anthropic 官方硬约束是最终 assistant turn 内 thinking 块（含 redacted_thinking）不得重排 / 编辑 / 部分丢弃，违者 400。本 spec 的保留集合取口径澄清节的定义——出站列表中**最后一条 assistant 消息**且该消息含 tool_use 块（活跃工具循环）——是对官方最低要求的一个保守超集，且不回溯历史已完结循环（历史已完结工具循环的 thinking 不保留），开态保留整轮是官方推荐的完整形态。实现时必须用真实 anthropic / gemini 账号做关态工具循环往返冒烟（qa: manual_user 补充验证），不能只靠单测；冒烟必须覆盖**「档位从高改回关」×「开关开 / 开关关」×「活跃工具循环」组合**——`requestThinkingEnabled: false` 时按档位前置门一律全剥（开关开也不保留最新轮），确认不向未启用 thinking 的请求发送 thinking 块（anthropic mapper 无条件映射 thinking 块，`body.thinking` 缺失时保留集合会直接 400，见口径澄清节）。附带细节：gemini 出站把 thinking 签名挂在 tool_use 的 functionCall part 上（`gemini-content-mapper.ts` L199-203），剥离 thinking 块不影响签名回传；gemini mapper 本就丢弃 redacted_thinking（L218-219），保留集合里的 redacted 对 gemini wire 无效但无害。
2. **存量长会话行为变化**：默认开但语义从「全历史透传」变为「仅最新一轮」——历史 thinking 不再占用上下文（上下文占用下降、正文留存更久），无智能损失预期（Anthropic 官方口径：历史 thinking 对表现无负面影响也无必要）；代价是首次请求后服务商前缀缓存可能失效一次（提示词前缀变化），带来一次性的成本/延迟抖动。发版说明需提示（CHANGELOG `Changed` 条目）。跨模型切换场景（历史无签名 thinking 触发 400）随本变更顺带修复。
3. **插入顺序敏感性**：剥离必须位于 `normalizeForLlmExport` 之后、`normalizeOrphanToolResultsForLlm` 之前——orphan 归一化会把孤立 tool_result 拍平成 text 块，拍平后的 user 消息会误判为「真实用户输入」、把边界错误前移。同理，崩溃恢复场景（assistant 落库但 tool_result 未追加）下，孤立 tool_use 由 orphan 归一化移除，剥离先于它执行时该消息因仍含 tool_use 而进入最低保留集合、其 thinking 被保守保留——这是安全方向的偏差（anthropic 接受最终 assistant 消息携带 thinking）。
4. **预览与 wire 输入不同构**：wire 侧输入是 `normalizeForLlmExport` 之后的列表（含 `"prompt:"` 合成消息、区内归一化），预览侧是 `buildSessionPromptInput` 的 `ctx.messages`（无合成消息、无归一化）。闭合方式：边界判定不依赖 `LlmExportZones`，而是内置「排除 `"prompt:"` 前缀合成消息」规则（合成消息特征在纯函数层可直接判定，不因预览侧无 zones 而分叉），两侧共用同一纯函数；T-TC7 与 T-PV2 分别从合成消息不重置边界、两侧剥离集合一致两个方向锁定。区内归一化只影响文本块合并不影响 thinking 块的去留，预览侧未过 `normalizeForLlmExport` 不改变剥离集合。
5. **预览与 token 计数口径**：token 计数（`serializePromptLlmInput` → compaction 触发）沿用不含 thinking 的现状，开关开时仍少计最新轮 thinking——现状本就全量少计，本变更加剧有限；如需完全对齐可作为 follow-up 把 `includeThinkingBlocks` 接入计数路径。预览在关态不含协议最低保留（PRD 口径：不向用户暴露），与 wire 存在 PRD 明示的、有意为之的差异；档位 off 时按 Step 2 的全局前置门，wire 与预览均全剥（`requestThinkingEnabled` 同源，无论开关开 / 关），两侧一致。
6. **偏好读取时机**：每 run 一次快照（对齐 `savedModelForAppend`），run 进行中切换开关不影响当次 run；下一步骤（工具循环下一 step）仍用同一快照，避免同一 run 内口径漂移。`requestThinkingEnabled` 同为 per-run 快照，与 `model-request.service.ts` 的档位解析同源，避免同一 run 内「保留判定」与「body.thinking 写入」不一致。
7. **既有测试断言**：若存量用例断言「历史 thinking 全量透传进 wire」，默认开的新语义（仅最新一轮）会打破它们——按新语义更新断言，不得为保测试回退行为。

### 回滚方案

- 偏好默认 true、语义变化集中在 `applyThinkingContextForLlm` 单点：紧急回滚时将 runner 内调用改为回滚时可直接短接该函数返回原数组（即恢复全量透传）（或直接短接该函数返回原数组），即可恢复「全量透传」现状，不动落库与 UI。
- 完整回滚：revert 本迭代全部 commit——偏好 key `chat.thinkingContext` 遗留在 KKV 无消费者、无副作用，无需数据迁移清理。
- 灰度：若关态工具循环在真实服务商出现 400，第一优先修复路径是把「关」的最低保留集合从「最后一条 assistant 消息（其含 tool_use）」扩大为「边界后全部 assistant」（即开态集合），仍满足用户「历史不进上下文」的主诉求。
