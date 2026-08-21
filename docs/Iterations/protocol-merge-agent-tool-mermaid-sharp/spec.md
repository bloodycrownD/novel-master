---
date: 2026-08-21
---

# 三合一：协议层 user 合并与 done 桥移除、agent 管理工具、mermaid 全屏清晰度 技术规格（SPEC）

## 设计目标

三个独立子需求合并一篇迭代，来源 `docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/prd.md`：

- **A**：移除 maxSteps 截断后的 `【done】`桥接消息与双端确认弹窗，改为在 anthropic/gemini 协议适配层做发送时合并，保证出站序列合法
- **B**：新增内置工具 `agent`（list/get/create/update），让主 agent 能管理 agent 定义
- **C**：mermaid 全屏查看器「手势中 transform、落定时烘焙进 SVG」的清晰度修复

## 设计决策

- **D1（A 合并放 mapper 层，不放 normalizeForLlmExport）**：连续 user 合并是 wire format 关注点，各协议容忍度不同（OpenAI 无此形态），照 opencode「适配器在发送前最后一刻降级」的结构。`normalize-for-llm-export.ts` 的通用 merge（纯文本、同 zone）保持不动；per-provider 后处理也不动（其 OpenAI 剔除空 bridge 逻辑继续服务存量消息）。
- **D2（A 合并规则照 claude-code 先例）**：相邻同 role user 消息 content 块按序拼接；`tool_result` 块（anthropic）/`functionResponse` part（gemini）置于合并消息前部。合并只发生在出站组装，**不落库、不回写**内部消息列表（合并是有损单向操作）。
- **D3（A 不迁移存量桥消息）**：已落库的 `tool_turn_bridge` 是合法 assistant 消息，出站无需特殊处理；`append-tool-turn-bridge.ts` 与其 IPC/UI 链路整体删除，读侧无兼容代码。
- **D4（A 不补占位消息）**：截断后续发的用户文字本身即上下文（claude-code submit-interrupt 先例：跳过中断声明，让新输入自己说话）。轮次切断的 UI 标记不在本迭代。
- **D5（B 形态照 skill-tool 样板）**：单工具多 action + 扁平字段；create/update 的定义体用单个 `definition` 对象字段（agent 定义是深层结构，扁平化不现实），schema 层宽松（passthrough），语义校验全部交给 `AgentRegistryService.upsert` → `validateAgentDefinition`（probe 注册表提供 registeredToolNames）——照 skill「schema 只做形状、服务层做语义」的分工。
- **D6（B 门闩与 task 同款）**：`resolveAgentToolRegistry` 在摘 `task` 的同一分支摘 `agent`（`mode === "subagent" || depth >= 2`）；闭包注入照 skills D4 模式——注册表含该工具名才注入，摘除时闭包为 undefined，run 抛 `ToolError(FAILED)`。
- **D7（B 无 delete）**：照 agent-skills PRD L90 先例，删除仅用户 UI；工具描述明示这一限制。
- **D8（C 烘焙坐标系）**：落定烘焙三件套，缺一即失效——①SVG `width/height` 设为 `基准渲染尺寸 × scale`（px）：基准渲染尺寸是 fit 态（width/height 100% + preserveAspectRatio meet）下的实际渲染尺寸（= fitRatio × viewBox 尺寸），**不是 viewBox 原始值**，否则与 CSS 百分比布局基准脱节、烘焙后跳变；②烘焙的同时置 `svg.style.maxWidth/maxHeight = 'none'`（内联覆盖 `mermaid-fullscreen-styles.ts` 的 `.mermaid-fullscreen-viewport svg { max-width:100%; max-height:100% }`），否则烘焙 px 会被该规则钳回 viewport 盒，等于没烘；③`gesture.current` 归一为 `{scale: 1, pan: 换算残差}`，transform 复位为纯 translate。烘焙后平移仍由 transform 承担、`stage` 的 `overflow: hidden` 裁剪溢出；pan clamp 公式显式化为 `max(0, (contentRendered - stage) / 2)` 形态（contentRendered 取烘焙后实际渲染尺寸）——旧公式 `viewportWidth*(scale-1)/2` 在烘焙归一 scale=1 后退化为 0（无法平移），不可沿用。`will-change` 保留（scale=1 时层位图即矢量布局尺寸，无拉伸）。无 viewBox 的回退分支（克隆时仅 width:100%）跳过烘焙，维持纯 transform 行为。
- **D9（C 双击 transition 后烘焙）**：双击路径 `transition: transform 180ms` 结束后再烘焙（transitionend 或等长 timeout），避免动画中被重排打断。

## 最终项目结构

```
packages/core/src/
  infra/llm-protocol/logic/
    anthropic-content-mapper.ts        # 改：chatMessagesToAnthropic 输出前合并相邻 user（D2 规则）
    gemini-content-mapper.ts           # 改：chatMessagesToGeminiContents 输出前合并相邻 user content
  service/chat/
    impl/append-tool-turn-bridge.ts    # 删（TOOL_TURN_BRIDGE_TEXT 一并消失）
    create-user-vfs-turn-service.ts    # 改：bundle 去掉 appendToolTurnBridge 字段
    user-vfs-turn.port.ts              # 改：删 AppendToolTurnBridgeFn 类型
  public/chat.ts                       # 改：删 TOOL_TURN_BRIDGE_TEXT（约 L323）与 AppendToolTurnBridgeFn（约 L334）re-export
  domain/tool/logic/
    build-tool-result-block.ts         # 改：summarizeToolSuccess（约 L54）加 agent 摘要分支（Step B3；core 归属，非 desktop）
  domain/tool/builtin/
    agent-tool.ts                      # 新增：agent 管理工具（AGENT_TOOL_NAME="agent"）
    register-builtin-tools.ts          # 改：注册 agentTool
    builtin-tool-context.ts            # 改：BuiltinToolContext 加 agents? 闭包（BuiltinToolAgentsContext，含装配期 agents 名单快照）
  domain/agent/logic/
    resolve-agent-tool-registry.ts     # 改：agent 加入 task 同款硬性摘除
  service/agent/logic/
    run-agent-turn.ts                  # 改：主 agent 与 runChildAgent 两个装配点注入 agents 闭包（含才注；agents 快照复用 allDefs / childAllDefs）
  config-forms/agent/
    agent-tool-catalog.ts              # 改：BUILTIN_TOOL_CATALOG 加 agent 条目（8→9）
packages/core/test/infra/llm-protocol/   # 测试目录写死，不新建旁路文件
    anthropic-content-mapper.test.ts   # 新建：T-PM1 合并用例（该目录现有布局无此文件）
    gemini-content-mapper.test.ts      # 改：T-PM2 用例追加进既有文件
    openai-content-mapper.test.ts      # 改：T-PM3 锁定用例追加进既有文件
apps/desktop/
  shared/logic/chat.ts                 # 改：删 TOOL_TURN_BRIDGE_TEXT re-export（约 L109）
  shared/ipc-types.ts                  # 改：删 MESSAGES_APPEND_TOOL_TURN_BRIDGE 通道（约 L96）与 MessagesAppendToolTurnBridgeRequest（约 L755）
  renderer/ipc/client.ts               # 改：删 ipcMessagesAppendToolTurnBridge（约 L87）
  renderer/ipc/invoke-registry.ts      # 改：删类型 import 与 withReq 绑定（约 L317-320）
  src/main/ipc/handler-registry.ts     # 改：删 handler import（约 L104）与 bindReq（约 L291-292）
  src/main/ipc/handlers/messages.ts    # 改：删 handleMessagesAppendToolTurnBridge 与 Request 类型 import
  src/main/runtime/types.ts            # 改：删 appendToolTurnBridge 字段与 AppendToolTurnBridgeFn import
  src/main/runtime/create-desktop-runtime.ts  # 改：bundle 解构去 appendToolTurnBridge（约 L98/127）
  renderer/features/chat/
    ChatComposer.tsx                   # 改：删 bridge 弹窗/确认链路
    composer-send-state.ts             # 改：删 lastMessageHasToolResult 分支
  renderer/features/settings/
    ToolPolicyPicker.tsx               # 不改：计数走 BUILTIN_TOOL_CATALOG.length 自动适应
apps/mobile/
  src/components/chat/ChatComposer.tsx # 改：删 sendWithBridgeIfNeeded
  src/runtime/types.ts                 # 改：删 appendToolTurnBridge 字段（实归 src/runtime/，非 src/services/）
  src/runtime/create-mobile-runtime.ts # 改：bundle 解构去 appendToolTurnBridge（约 L85/139）
  src/components/agent/
    AgentEditorForm.tsx                # 改：L882 计数文案硬编码「8 个」→ 9 个
    ToolPolicyPicker.tsx               # 不改：计数走 BUILTIN_TOOL_CATALOG.length 自动适应
  src/web/shared/mermaid-fullscreen/
    MermaidViewerOverlay.tsx           # 改：落定烘焙（D8/D9）
  src/web/webview-host/chat-transcript/
    mermaid-viewer-gestures.ts         # 改：加 bake 换算纯函数
  __tests__/mermaid-fullscreen.test.ts # 改：T-MF2 适配 + bake 用例
  __tests__/chat-composer.integration.test.ts  # 改：删 appendToolTurnBridge mock，改写为「不弹窗直发」断言（T-PM5）
```

不改动（红线）：`snapshot.ts` 的 5 处 `scheduleMermaidScan()` 调用；`stream.ts` 不得出现 mermaid 字样；`mermaid-core.ts` 既有语句；`normalize-orphan-tool-results-for-llm.ts`；`normalize-for-llm-export.ts` 的通用 merge 与 per-provider 后处理。

## 详细实现步骤

### A：协议合并与 done 桥移除

- **Step A1** — phase-pm-anthropic — blocking: yes — qa: auto：`anthropic-content-mapper.ts` 出站合并——`chatMessagesToAnthropic` 产出 wire 数组后做一遍相邻压缩：相邻 `role:"user"` 的 content 按序拼接（`tool_result` 块前置，其余块保持原序；纯函数、可直测）。含既有 tool_result 拆分逻辑不动，合并作为输出前最后一步。
- **Step A2** — phase-pm-gemini — blocking: yes — qa: auto：`gemini-content-mapper.ts` 同款——相邻 `user` content 合并 parts（`functionResponse` part 前置）；既有 `buildSyntheticModelTurn`/`modelTurnCoversToolResults` 逻辑与合并的先后顺序：先合成 model turn 修补，再合并相邻 user。
- **Step A3** — phase-pm-openai-lock — blocking: yes — qa: auto：OpenAI 零改动锁定——补回归用例：含 tool_result 的 user + 纯文本 user 出站为 `tool → user` 两消息（不合并、不报错）。
- **Step A4** — phase-pm-bridge-removal — blocking: yes — qa: auto：删桥链路，删完须编译/测试全绿，逐文件清单——core：`impl/append-tool-turn-bridge.ts` 删；`create-user-vfs-turn-service.ts` bundle 字段删；`user-vfs-turn.port.ts` 的 `AppendToolTurnBridgeFn` 删；`packages/core/src/public/chat.ts` 删 `TOOL_TURN_BRIDGE_TEXT`（约 L323）与 `AppendToolTurnBridgeFn`（约 L334）re-export。desktop：`shared/logic/chat.ts` 删 re-export（约 L109）；`shared/ipc-types.ts` 删 `MESSAGES_APPEND_TOOL_TURN_BRIDGE` 通道（约 L96）与 `MessagesAppendToolTurnBridgeRequest`（约 L755）；`renderer/ipc/client.ts` 删 `ipcMessagesAppendToolTurnBridge`（约 L87）；`renderer/ipc/invoke-registry.ts` 删类型 import 与 withReq 绑定（约 L317-320）；`src/main/ipc/handler-registry.ts` 删 import（约 L104）与 bindReq（约 L291-292）；`src/main/ipc/handlers/messages.ts` 删 handler 与类型 import；`src/main/runtime/types.ts` 删字段；`create-desktop-runtime.ts` 改 bundle 解构（约 L98/127）；`ChatComposer.tsx` 确认弹窗与 `confirmBridge`；`composer-send-state.ts` 的 `lastMessageHasToolResult`。mobile：`src/components/chat/ChatComposer.tsx` 的 `sendWithBridgeIfNeeded`；`src/runtime/types.ts` 删字段；`create-mobile-runtime.ts` 改 bundle 解构（约 L85/139）。删后用户输入直发 `runAgent`。
- **Step A5** — phase-pm-docs-tests — blocking: yes — qa: auto：测试与文档收尾，逐文件——`packages/core/test/chat/user-vfs-turn.service.test.ts`：`appendToolTurnBridge` 用例删除、bundle 解构改写。存量桥字面量替代（`TOOL_TURN_BRIDGE_TEXT` import 改内联 `"【done】"`，用例本体保留——它们断言的是 workplace done 双消息/出站序列，不是桥机制）：`test/prompt/workplace-prompt-ux.test.ts`（T-WP5/T-WP5b）、`test/prompt/render-prompt.test.ts`（T-WT4/4b/7）、`test/prompt/workplace-layout-c0.test.ts`（T-W5b）、`test/agent/agent-runner-template-blocks.test.ts`（T-WT16/R3）、`test/prompt/normalize-for-llm-export.test.ts`（T-WT9；其直连 `src/service/chat/impl/append-tool-turn-bridge.js` 的 import 也一并改字面量）。`apps/mobile/__tests__/chat-composer.integration.test.ts`：删 `appendToolTurnBridge` mock（约 L82），改写为「末条 user 含 tool_result 时输入直发、不弹窗、不调桥」断言（T-PM5，承接 PRD 验收 1）。`vfs-flush-insert-after-assistant/spec.md` L27-33 机制表加注记（bridge 已移除，指向本迭代）；更新 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json`（移除 `TOOL_TURN_BRIDGE_TEXT`，否则导出快照失配卡测试）；CHANGELOG 条目。

### B：agent 管理工具

- **Step B1** — phase-at-tool — blocking: yes — qa: auto：`agent-tool.ts`——`AGENT_TOOL_NAME="agent"`；action `list/get/create/update`；list 返回 name/description/mode（含虚拟 general）；get 按 name 优先（list 匹配 seed）再按 agentId；create/update 持 `definition` 对象字段（D5），create 时 agentId 由工具侧按 `agent-${Date.now()}` 生成并去重（照桌面建空白 agent 先例）；无 delete（D7，描述中明示）。输出限流复用 `tool-output-limits.ts`。
- **Step B2** — phase-at-wiring — blocking: yes — qa: auto：`builtin-tool-context.ts` 加 `BuiltinToolAgentsContext { registry: AgentRegistryService; registeredToolNames: string[]; assertSavedModel?; agents: readonly { name; description; mode }[] }`——`agents` 是装配期预算快照：`toolsFromRegistry` 的 description 是同步求值（`(ctx) => string`），而 `agentRegistry.list()` 返回 Promise，lambda 内不能现查（照 skill `effective` / task `callableAgents` 同款装配期预算模式）；`register-builtin-tools.ts` 注册；`resolve-agent-tool-registry.ts` 摘除分支（D6）；`run-agent-turn.ts` 两装配点按「注册表含 agent 才注入」注入（照 `assembleSkillsToolContext` 样板），`agents` 快照主装配点复用 `allDefs`、`runChildAgent` 复用 `childAllDefs`，数据已可得不新增 IO。
- **Step B3** — phase-at-sync-ui — blocking: yes — qa: auto：同步清单（按实际归属）——core：`config-forms/agent/agent-tool-catalog.ts` 的 `BUILTIN_TOOL_CATALOG` 加条目（8→9）；`domain/tool/logic/build-tool-result-block.ts` 的 `summarizeToolSuccess`（约 L54，core 归属、不在 apps/desktop）加 agent 摘要分支。mobile：`src/components/agent/AgentEditorForm.tsx`（约 L882）硬编码计数文案「8 个」→ 9 个（唯一硬编码点）。双端 `ToolPolicyPicker` 计数走 `BUILTIN_TOOL_CATALOG.length` 自动适应，无需改；双端 tool 卡片渲染分支按 grep 补齐。
- **Step B4** — phase-at-tests — blocking: yes — qa: auto：`agent-tool.test.ts`（action 分派、字段校验、general by-name、坏定义被 validate 拒绝且错误含字段名）；`resolve-agent-tool-registry` 摘除用例；装配注入（含/不含）用例。

### C：mermaid 全屏清晰度

- **Step C1** — phase-ms-bake-fn — blocking: yes — qa: auto：`mermaid-viewer-gestures.ts` 加纯函数 `computeBakedSvgSize(baseRendered, scale)`（baseRendered 为 fit 基准渲染尺寸，即 fitRatio × viewBox 尺寸；返回 px 宽高 = baseRendered × scale）与 `rebasePanAfterBake(pan, scale)`（烘焙后残差换算）；pan clamp 公式参数化为 `max(0, (contentRendered - stage) / 2)` 形态（contentRendered = 当前**视觉**内容尺寸，即布局尺寸 × gesture.scale——手势进行中 scale>1 时布局仍是 fit 尺寸，必须乘 scale 才能与烘焙后（布局即烘焙 px、scale=1）统一到一个公式，否则手势中平移会被钳死；stage 取舞台尺寸，双参显式传入）——烘焙归一 scale=1 后平移仍由 transform 承担、stage `overflow: hidden` 裁剪溢出，旧公式 `viewport*(scale-1)/2` 在 scale=1 时退化为 0 不可沿用。
- **Step C2** — phase-ms-overlay — blocking: yes — qa: auto：`MermaidViewerOverlay.tsx`——pinch `onTouchEnd` 落定烘焙（D8）；双击路径在 180ms transition 结束后烘焙（D9）；烘焙时先置 `svg.style.maxWidth/maxHeight = 'none'`（内联覆盖 `mermaid-fullscreen-styles.ts` 的 viewport svg 钳制规则）再写 px `width/height`，随后 transform 复位为纯 translate、`gesture.current` 归一；无 viewBox 回退分支（克隆时仅 width:100%）跳过烘焙。手势中逻辑零改动。
- **Step C3** — phase-ms-tests — blocking: yes — qa: auto：`mermaid-fullscreen.test.ts`——T-MF2 适配（clamp 坐标系）、新增 bake 纯函数用例、T-MF1/MF3/MF5 契约不破；`npm run build:webview` 后 dist 断言仍绿。
- **Step C4** — phase-ms-qa — blocking: no — qa: manual_user：真机双平台验收——复杂图放大 6x 落定后清晰（截图对比）；pinch 跟手不掉帧；双击档位切换正常；三关闭路径与返回键不回归。

## 测试策略

### 测试用例

- T-PM1 — blocking: yes — anthropic 合并：`tool_result` user + 文本 user → 单条 user，tool_result 块前置；三连 user 同样压为一条（新建 `packages/core/test/infra/llm-protocol/anthropic-content-mapper.test.ts`；映射 Step A1）
- T-PM2 — blocking: yes — gemini 合并：functionResponse part 与 text part 同 content；合成 model turn 逻辑不回归（追加进既有 `packages/core/test/infra/llm-protocol/gemini-content-mapper.test.ts`；映射 Step A2）
- T-PM3 — blocking: yes — OpenAI 锁定：出站 `tool → user`，无合并不报错（锁定用例追加进既有 `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts`；映射 Step A3）
- T-PM4 — blocking: yes — 存量兼容：历史含 `tool_turn_bridge` 消息的会话，三协议出站合法（映射 Step A4/A5）
- T-PM5 — blocking: yes — composer 直发：末条 user 含 tool_result 时输入直接发送、不弹窗、不调桥（`apps/mobile/__tests__/chat-composer.integration.test.ts` 改造承接；映射 Step A4/A5，对应 PRD 验收 1）
- T-AG1 — blocking: yes — action 分派与字段校验：缺必填报 `INVALID_ARGUMENT` 且含字段名（映射 Step B1）
- T-AG2 — blocking: yes — list 含虚拟 general；get by-name 命中 general、by-agentId 走 `get(id)`（映射 Step B1）
- T-AG3 — blocking: yes — create/update 经 upsert 校验：未注册工具名被拒、错误信息含原因（映射 Step B1/B4）
- T-AG4 — blocking: yes — 摘除与 deny：`mode==="subagent"` 或 `depth>=2` 的注册表不含 `agent` 且闭包不注入；`tools.deny` 含 `agent` 的注册表同样不含（allow/deny 策略路径，对应 PRD 验收 7）（映射 Step B2）
- T-AG5 — blocking: yes — 双端计数与渲染同步断言（含 catalog 9 条；AgentEditorForm 计数文案 9 个）（映射 Step B3）
- T-MS1 — blocking: yes — bake 纯函数：fit 基准渲染尺寸 × scale 换算（非 viewBox 原始值）、pan 残差换算、clamp 新坐标系边界（`max(0,(contentRendered-stage)/2)`，手势中（布局×scale）与烘焙后（烘焙 px、scale=1）两态各写一条用例锁定）（映射 Step C1）
- T-MS2 — blocking: yes — Overlay 契约：源码含烘焙调用与 transition 后烘焙时序、烘焙前置 maxWidth/maxHeight='none'、手势中仍直写 transform（映射 Step C2）
- T-MS3 — blocking: yes — 回归：T-MF1-5 与 `mermaid-webview.test.ts`（T-MV/T-MT 系）全绿（映射 Step C3）
- T-MS4 — blocking: no — 真机清晰度与流畅度（映射 Step C4）

## 风险与回滚方案

- **A 缓存边界变化**：合并改变 user 消息切分，切换后首几轮 prompt cache 命中率下降——一次性成本，接受。
- **A 删桥是用户可见行为变更**：弹窗消失属预期；若模型对截断后续接表现不佳，回滚方案为恢复 Step A4 删除的调用链（git revert 单 step 可回）。
- **B AI 写定义的破坏面**：upsert 校验拦截非法定义；误写合法但语义差的定义（如工具全 deny）由用户在 UI 修正——工具返回中提示「定义已保存，将在下一次会话生效」降低误解。
- **B 同步遗漏**：Step B3 checklist 逐项 grep 硬编码数字；漏一处不阻塞功能但文案计数错，验收时三端各截一张工具策略图。
- **C 超大图烘焙重排耗时**：仅落定时发生；真机若 6x 巨型图重排 >300ms 再评估限流（如烘焙前 loading 态），不回退 transform 方案。
- **C 回滚**：烘焙调用收敛在 Overlay 落定两处（onTouchEnd/transition 后），注释掉即回退为纯 transform 行为。
