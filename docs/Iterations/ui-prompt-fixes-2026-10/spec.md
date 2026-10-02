---
date: 2026-10-02
---

# 四项体验优化（代码块语言标统一 / 附件体积预算 / 常驻开关移除 / 提示词查看轮聚合）技术规格（SPEC）

需求来源：`docs/Iterations/ui-prompt-fixes-2026-10/prd.md`（本仓标准 PRD，dependency 为空）。
探索依据：2026-10-02 brain-storm 四子代理报告 + prd/spec 两轮聚焦探索（R1/R2 渲染与附件链、R4 提示词查看数据链），本文所有行号以 main 当前代码为准。

## 设计目标

按 PRD 四项需求（R1 语言标 plain 统一 / R2 附件体积预算与降级统一 / R3 常驻开关移除 / R4 提示词查看轮聚合）给出可执行实现方案。总原则：

- **core 单源**：R2 的预算降级与 R4 的轮聚合都收敛在 `packages/core`，双端 UI 与 CLI/token 链自动一致。
- **只加不改**：R4 不动 `buildPromptAssemblyFromLayout` 的产出文本、`buildPromptPreviewSegmentsFromLayout`、`formatPromptLlmInputForCliFromLayout`（保住 CLI/token parity 契约，`render-prompt.test.ts:165-189`）。
- **零 CSS 改动**：R1 语言标机制是属性选择器 `pre[data-lang]::before`，加 `data-lang="plain"` 自动命中，样式与 webview 资产零重建。

## 总体方案

### R1 语言标 plain 统一

双端各一处产出点改造 + mobile 补缩进块覆盖：

- **mobile**（`apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts:69-91`）：fence 覆盖按 `normalizeFenceLang(rawLang)` 的返回值分流——命中 → 现标签不变；**未命中（`null`）→ 输出 `data-lang="plain"`，无论该语言是否被 hljs 高亮**（mjs/cjs/rust 等内置别名高亮命中但归一化为 null 的，也走 plain，`:83` 的 `label` 回落与 `:88-90` 的 else 出口两处都要改）；`rawLang` 为 `mermaid` → 维持裸 `<pre>`（无 lang、无复制按钮，图表管线不受影响）。新增 `markdown.renderer.rules.code_block` 覆盖：`<pre data-lang="plain"><span class="code-copy"></span><code>${escapeHtml(token.content)}</code></pre>`（缩进块无 `info`，不走 `normalizeFenceLang`；转义与 fence 未高亮分支同源）。
- **desktop**（`apps/desktop/renderer/components/code-block.tsx:138-186`）：三个裸 `<pre>` 出口（`:147-153` child 非元素防御分支、`:167-179` 表外语言剥 hljs 壳分支、`:180-185` 兜底分支）统一加 `data-lang="plain"`；命中别名表的分支（`:159-166`）不动。mermaid 走 `MermaidMarkdown.tsx:469-474` 的 `MermaidBlock` 不进 `renderCodeBlock`，天然豁免。
- desktop 缩进块走 `components.pre` → `renderCodeBlock` 兜底分支（`extractChildCode` 返回 undefined className），**已有复制按钮**（`copyBtn` 在 `:146` 无条件构造），只需补标；mobile 缩进块由新增 `code_block` 覆盖同时补标与复制按钮。
- sanitize（`sanitize-rich-html.ts:140-142`）已放行 `pre` 的 `data-lang` 与 `span` 的 `class`，零改动；复制点击链（`code-copy.ts:31-41` 的 `closest` 委托）与 data-lang 无关，零改动。
- **MF-1 契约修订**：表外语言（rust/mjs/cjs/xhtml 等）从「故意无标签」改为「统一 plain 标」；高亮行为不变（表外本来就不高亮）。

### R2 附件体积预算与降级

**核心架构决策：预算与降级全部收敛在 prepare 链（core 单源），子会话派发侧的预算逻辑整体退役。**

- 新建共享常量模块 `packages/core/src/domain/chat/logic/attach-budget.ts`：
  - `ATTACH_PROMPT_CHAR_BUDGET = 100_000`（明文当量字符）
  - `OVERSIZED_ATTACH_NOTE = "文件过长，可用 read 配合 offset/limit 分段读取"`
  - `BINARY_ATTACH_NOTE = "二进制文件，不提供正文"`
- **主会话**（`prepare-user-messages-for-prompt.ts`）：`prepareUserMessagesForPrompt`（`:572-675`）函数体内创建字符累加器（与 `seen` 同级作用域，整个拼装共享一次 100k 预算），逐层下传 `prepareOneUserMessage`（新增形参）→ `hydrateAttachWithSeen` → `hydrateFileFull` / `hydrateSkillAttachWithSeen`：
  - 计量点：`hydrateFileFull` 两条出口拿到明文后（存量 content 分支 `:195-218` 的 `fileBody`、读盘分支 `:226-243` 的 `cached.body`），按**原始明文 length** 计（忽略行号前缀开销）；skill 侧 `:370-384` 的 `file.content.length`。image/binary/dir 不计字符（复用 `isBinaryOrImageAttach` 判定）。
  - 超限降级：绕过 `renderFileBlockBody`，直接 `buildFileRefActionXml({ action, path, content: OVERSIZED_ATTACH_NOTE, display: "filename" })`。
  - 二进制/图片文案：`resolveAttachFileStatus` 返回 `"filename"` 的 attach 侧路径，content 由 `1|basename` 改为 `BINARY_ATTACH_NOTE`。实现上给 `fileRefAction`（`:151-168`）加可选 `noteText` 参数：传入则 content 直用文案（不再走行号正文），不传维持原逻辑；**legacy `<file>` 外壳分支（`:200-206`）直调 `buildFileRefActionXml` 绕过 `fileRefAction`，该出口同样要接 `noteText` 同款文案**。
  - **workplace 侧豁免（红线，显式判据）**：`hydrateFileFull` 被 attach 与 workplace 两条链共用，预算计量与文案替换**一律以 `attachment.source === "workplace"` 为豁免判据**——workplace 路径不接累加器、filename 档维持 `renderFileBlockBody`（`1|basename`）现状（目录规则语义不受影响），否则预算会被 workplace 的 full 档附件悄悄吃掉。
  - seen 语义（钉死）：降级附件同样写 `seen`（读成功即写，现状时序不变）——同会话后续同路径引用走 alreadyReferenced 短提示，不反复尝试全文。
  - 既有豁免保留：`content.includes("<action ")` 原样带过分支（`:181-188`）不计量不降级（存量已拼 XML 的附件照常）；alreadyReferenced 分支天然 0 字符。
  - skill 降级形态：`hydrateSkillAttachWithSeen` 超限时 `buildAttachmentActionXml("skillAttach", { name, content: OVERSIZED_ATTACH_NOTE, display: "filename" })`（与 userAttach 降级形态对齐；schema 无需改，display 只是 XML JSON param）。
- **子会话统一**（`subagent-tool.ts`）：删除 `splitAttachmentsByBudget`（`:309-334`）、`buildOverflowPromptNote`（`:337-343`）、`TASK_FILE_ATTACHMENT_MAX_COUNT`（`:53`）与 `estimateAttachmentChars` / `probeContentSize`；`TASK_FILE_ATTACHMENT_CHAR_BUDGET` 删除、由共享常量替代。派发时**全部附件照挂**（`attachmentsFromPaths` 物化后不再筛），降级由子会话自身的 prepare 链自动完成（子会话 agent-runner 每 step 跑同一 `prepareUserMessagesForPrompt`，预算天然生效）。**`getContentSize` 端口整体退役**（拍板）：预算链删除后该端口在 src 侧零消费方——`BuiltinToolSubagentContext.getContentSize` 声明（`builtin-tool-context.ts:76`）、`run-agent-turn.ts:905/1296` 两处装配注入、`subagent-tool-session-file.test.ts` 里纯为它存在的桩与用例（T-TA3f/T-TA3h 族）一并删除（prepare 侧计量用的是已到手明文 `content.length`，不经该端口）。
- **三链一致**：真实发送（`agent-runner.ts:461-484`）、token 估算与提示词预览（双端 `session-prompt-input.service.ts`）共用 prepare 单源，自动一致；每 step 重新拼装、预算每次重算、无跨 step 状态。

### R3 常驻开关移除（lifecycle 只留 once）

- 域模型：`prompt-block.ts:8` 删 `PromptBlockLifecycle` 类型；`agent-prompt-layout.ts:37-43` 删 `DynamicPromptBlock.lifecycle` 字段。
- 判定：`should-include-dynamic-block.ts` 删除；`render-prompt.ts` 三处调用点（`:84-91` zones / `:324-342` assembly / `:381-390` llm input）改为 `agentStepIndex === 0` 直接判断（`agentStepIndex` 参数保留——preview/token 链缺省 0 恒包含，run 内 step≥1 跳过，即 once 语义）。public API：`public/prompt.ts:21` 删导出，`test/package-exports/snapshots/public-prompt-allowlist.json:19` 同步删条目。
- schema 兼容（关键）：`agent-definition.schema.ts` 的 **`dynamicTextBlockValueSchema`（`:30-37`）与 `persistTextBlockValueSchema`（`:20-26`）都**包一层 `z.preprocess` 剥掉 `lifecycle` 键后再入 strict parse——persist 区同样 strip（与 PRD R3.3「存量定义照常加载」同向，避免 zod 路径拒载而 raw-map 路径放行的双入口分歧）。存量 `lifecycle: "once"` / 缺省 / 手写 `"always"` / **非法值（如 `"foo"`）**全部静默剥键、照常 decode，一律按 once 生效，不拒载、不迁移（`prompts_json` 整块 JSON 无字段级版本，读侧兼容即终态）。
- wire：`agent-prompt-layout-wire.ts` 删 `DynamicPromptBlockWire.lifecycle`（`:22-28`）与写出分支（`:44-53`）——新写出的定义不再带 lifecycle 键。
- 校验：`validate-agent-prompt-layout.ts` 删 `LIFECYCLES`（`:25`）与 dynamic lifecycle 解析分支（`:165-177`）；persist 区「不得包含 lifecycle」校验（`:115-120`）一并删除——zod schema 与 raw-map 两层都是 strip 语义，域模型无该字段、无从校验。两层既有用例同步改写：`agent-definition.test.ts:178`（L10-Z1，zod 层）与 `validate-agent-prompt-layout.test.ts:21`（raw-map 层）都从「抛错」改为「strip 后正常解析」。
- 表单层：`agent-editor-state.ts` 删 `isDynamicBlockPersistent` / `withDynamicBlockPersistence`（`:251-266`）与 `dynamicLifecycleOnceHint`（`:171`）；消费方共**三处**须同步——desktop 面板（`AgentEditorView.tsx`）、**desktop 共享再导出桶（`apps/desktop/shared/logic/config-forms-agent.ts:23/:31` 具名 re-export 这两个 helper，漏删该文件 typecheck 必红）**、mobile 卡片（`DynamicBlocksCard.tsx`）。
- UI：desktop `AgentEditorView.tsx:1343-1369` 删「常驻」开关行与条件 hint（`:38-39` import 清理，顺带核对 `config-block-card__switch-*` CSS 类是否仍被其它卡片使用，无消费则删）；mobile `DynamicBlocksCard.tsx:145-166` 删 `FormSwitchRow` 与 hint（`:12-13`、`:19` import 清理，文件头注释同步）。
- 文档与示例：`seed-builtin-skills.ts:78,118`（agent-authoring 内置技能）删 always 枚举描述、示例去 `lifecycle` 键；`examples/agents.yaml:21` 去 `lifecycle: once`。

### R4 提示词查看轮聚合

**core 只加不改**：

- `render-prompt.ts:34-40` `PromptAssemblySegment` 加可选字段 `messageId?: string`、`seq?: number`（`source` 已有）；chat 循环（`:299-322`）填充（一条 ChatMessage 的多个 segment 共享 `messageId`/`seq`）。`buildPromptPreviewSegmentsFromLayout`（`:404-416`）与 `formatPromptLlmInputForCliFromLayout`（`:419-428`）**保持原样**。
- 新增导出 `buildPromptPreviewTurnsFromLayout(layout, ctx, opts)` 与类型：
  - `PromptPreviewTurn = { id: string; kind: "template" | "user" | "assistant"; items: PromptPreviewSegment[]; summary: string; body: string }`
  - 切轮规则：内部按 assembly 顺序遍历；`source !== "message"` 的段各自成 `kind:"template"` 单段轮（system/skills/persist-*/workplace*/dynamic-*，天然排除 role 为 user 的 workplace 合成段）；`source === "message"` 的段按 `messageId` 分组，切轮判定回到 **ChatMessage 层**用 `isUserInputMessage`（`message-content-helpers.ts:22`，user 且不含 tool_result——PRD 逐字口径）——真用户输入消息的组为 `kind:"user"` 轮，其余（assistant 文本 / tool_use / tool_result / thinking）归入当前 assistant 轮；**会话开头无 user 前缀的 assistant 段自成首个 assistant 轮**；user 轮至少一段（纯附件 user 消息 wrap 后有 text segment，无空轮）。
  - assistant 轮 `body`：items 正文按序拼接，段间加角色前缀行（如 `[#12 · tool_call]`），供双端详情直接消费一份字符串；`summary` 口径（core 侧钉死，双端不二次加工）：首条 assistant 文本首行 trim 后**超 70 字截断为 `slice(0,69) + "…"`**（core 无 `previewLine` 可复用，自带此口径；双端现有局部截断函数不再参与轮摘要）+ 工具调用计数 + 总字符数；**本轮无文本段（纯 thinking/tool）时文本位留空，仅显示「N 段 · 工具调用 M 次 · X 字」**，卡片标题不空白。摘要按**实际产出的段**计（thinking 关态不含）。
  - hidden 消息已在链上双重过滤（SQL `includeHidden:false` + assembly `:305-307`），聚合层不处理。
- 导出面：`public/prompt.ts` 新增类型 + 函数（运行时导出 → `public-prompt-allowlist.json` 加条目；纯 type 被 erase 不影响 allowlist 测试）。`isUserInputMessage` 仅 core 内部使用，不补 public 导出。

**desktop**：

- 数据源：`apps/desktop/src/main/services/prompt-preview.service.ts` 的 `buildRealPromptPreviewSegments`（`:56`，调用点 `:99`）改为返回轮数组（turns），`handlePromptRealPreview` 的数据来自这里——**不改它 handler 拿不到 turns**。
- DTO：`ipc-types.ts:902-907` 新增 `PromptPreviewTurnDto { id; kind; summary; body; items?: PromptPreviewSegmentDto[] }`，预览通道返回类型改 `PromptPreviewTurnDto[]`。**payload 策略（拍板）**：handler 的 map 对 `kind !== "assistant"` 的 template/user 轮下发 `items`（segment 卡片渲染需要）；**assistant 轮只下发 `summary` + `body`、不下发 `items`**——assistant 轮正文已在 `body` 一份字符串里，items 重复携带会让长会话 IPC payload 近似翻倍（body 可达数百 KB）。
- 同步面共四处（`client.ts:103` 只是 re-export 名单、DTO 未改名，**零改动**）：`shared/ipc-types.ts`（新 DTO 与返回类型）；`main/ipc/handlers/prompt.ts` 的 `:14` import / `:24` 返回类型 / `:30-35` map **三处同改**；`renderer/ipc/invoke-registry.ts` 的 `:46` import / `:404-406` 泛型；`renderer/features/chat/RealPromptPanel.tsx`（import 与 state 类型）。
- `RealPromptPanel.tsx`：state 改轮数组；template/user 轮渲染原 segment 卡片（user 轮可多段顺序展示）；assistant 轮渲染新卡片（role 标「assistant 轮」+ summary + chevron），点击打开**详情 Modal**（详情数据即 `turn.body`）。`ROLE_LABELS`（`:12-18`）**仅补 `thinking`**（`tool_call` 已有）。
- `CodeEditor.tsx:11-18` 加可选 `readOnly?: boolean`：透传 `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`（`@uiw/react-codemirror` 原生支持），`onChange` 改可选、只读时 `basicSetup.history:false`、`closeBrackets:false`，保留 selection 供复制。
- 详情 Modal 外壳逐字套 `PromptCollapsibleField.tsx:76-102` 范式（`.text-prompt-overlay` + `.prompt-editor-modal` + footer 关闭按钮 + Esc 关闭），内放 `<CodeEditor readOnly value={turn.body} languagePath="prompt.txt">`；样式复用 `shell.css:5374-5383/5428-5440/5442-5448`，新增 assistant 轮卡片样式进 `shell.css:3796-3887` 区段。

**mobile**：

- `prompt-preview.service.ts` 返回类型改 turns（`:57` 函数签名 / `:60` `Promise<readonly PromptPreviewTurn[]>`），`:100` 调用点换 `buildPromptPreviewTurnsFromLayout`。
- `RealPromptScreen.tsx:81-99`：FlatList `data` 换轮数组；renderItem 分流——template/user 轮用现有 `PromptPreviewSegmentCard`（user 轮多段顺序渲染）；assistant 轮用新组件 `PromptTurnCard`（摘要 + 点击导航详情）。**导航依赖不进屏顶层**：`useNavigation()` 在 `PromptTurnCard` 内部自取，`RealPromptScreen` 顶层维持只 import `useRoute`（现 `:13`）——既有 `real-prompt-screen-scope.test.tsx` 对 `@react-navigation/native` 的整模块 mock 只有 `useRoute`（`:24-26`），屏顶层新增 `useNavigation` 会让 T-AM3 三条渲染期即炸。scope 逻辑（`:29-36`）不动。
- 新屏 `PromptTurnDetailScreen.tsx`：`EditorScreenShell` 纯预览态（`preview` slot）内放 `FileMarkdownPreview path="prompt.txt" renderKind="txt" previewFill`（纯内存 content、不碰 VFS，`PromptEditorScreen` 已有同款先例；其 plain 分支即 `<Text selectable monospace>`，满足「可复制」验收；WebView 引擎 200k 阈值内走 plain layout 同观感，超限自动回退）。详情正文即 `turn.body` 单串（含角色前缀行），不做二级折叠（v1 简化，后需可加 `CollapsibleCard`）。
- 详情传参走**模块级 callback**：新建 `components/prompt/prompt-turn-callback.ts`（`setPromptTurnDetail({title, body})` / `takePromptTurnDetail()`，读后即清，照 `prompt-editor-callback.ts:8-22` 形状）——轮 body 可达数百 KB，不走路由 params。
- `navigation/types.ts` + `header-config.ts` + `RootNavigator.tsx`（**两处**：`withStackLayout` 常量区（PromptEditor 在 `:191-193` 同款）与 `<Stack.Screen>` 注册区（PromptEditor 在 `:295-298` 同款））注册 `PromptTurnDetail`。
- `PromptPreviewSegmentCard.tsx:9-14` 常量名是 **`ROLE_LABEL`（单数）**，补 `thinking` + `tool_call` 两个映射。

## 最终项目结构（改动文件清单）

```
packages/core/src/domain/chat/logic/attach-budget.ts                    [新增] R2 共享常量
packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts [修改] R2 预算累加器+降级+二进制文案
packages/core/src/domain/tool/builtin/subagent-tool.ts                  [修改] R2 预算逻辑退役
packages/core/src/domain/tool/builtin/builtin-tool-context.ts           [修改] R2 getContentSize 端口声明删除
packages/core/src/service/agent/logic/run-agent-turn.ts                 [修改] R2 两处 getContentSize 装配注入删除（:905/:1296）
packages/core/src/domain/prompt/model/prompt-block.ts                   [修改] R3 删类型
packages/core/src/domain/prompt/model/agent-prompt-layout.ts            [修改] R3 删字段
packages/core/src/domain/prompt/logic/should-include-dynamic-block.ts   [删除] R3
packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts       [修改] R3 删 wire 字段
packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts   [修改] R3 删校验分支
packages/core/src/domain/agent/model/agent-definition.schema.ts         [修改] R3 preprocess strip（dynamic+persist 两 schema）
packages/core/src/service/prompt/render-prompt.ts                       [修改] R3 判定简化 + R4 段扩字段
                                                                          [新增导出] R4 轮聚合函数+类型
packages/core/src/config-forms/agent/agent-editor-state.ts              [修改] R3 删 helper/hint
packages/core/src/public/prompt.ts                                      [修改] R3 删导出 + R4 新导出
packages/core/docs/public-api.md                                        [修改] R3 删 PromptBlockLifecycle 登记（:76）
packages/core/src/bootstrap/skills/seed-builtin-skills.ts               [修改] R3 文档
apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts [修改] R1 fence 拆分+code_block 覆盖
apps/desktop/renderer/components/code-block.tsx                         [修改] R1 三出口加 plain
apps/desktop/src/main/services/prompt-preview.service.ts               [修改] R4 desktop 轮数据源（buildRealPromptPreviewSegments 返回 turns）
apps/desktop/src/main/ipc/handlers/prompt.ts                            [修改] R4 轮 DTO（import/返回类型/map 三处）
apps/desktop/shared/ipc-types.ts                                        [修改] R4 轮 DTO
apps/desktop/renderer/ipc/invoke-registry.ts                           [修改] R4 返回类型跟随（:46 import / :404-406 泛型；client.ts 零改动）
apps/desktop/renderer/features/chat/RealPromptPanel.tsx                 [修改] R4 轮渲染+Modal
apps/desktop/renderer/components/ui/CodeEditor.tsx                      [修改] R4 readOnly
apps/desktop/renderer/features/settings/AgentEditorView.tsx             [修改] R3 删开关
apps/desktop/shared/logic/config-forms-agent.ts                         [修改] R3 删 helper 再导出条目（:23/:31）
apps/desktop/renderer/styles/shell.css                                  [修改] R4 轮卡片样式
apps/mobile/src/services/prompt-preview.service.ts                      [修改] R4 返回轮
apps/mobile/src/screens/stack/RealPromptScreen.tsx                      [修改] R4 轮渲染
apps/mobile/src/components/prompt/PromptTurnCard.tsx                    [新增] R4 assistant 轮卡片
apps/mobile/src/components/prompt/prompt-turn-callback.ts               [新增] R4 详情传参
apps/mobile/src/screens/stack/PromptTurnDetailScreen.tsx                [新增] R4 详情屏
apps/mobile/src/navigation/{types,header-config}.ts + RootNavigator.tsx [修改] R4 注册
apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx          [修改] R4 标签补齐
apps/mobile/src/components/agent/agent-editor/DynamicBlocksCard.tsx     [修改] R3 删开关
examples/agents.yaml                                                    [修改] R3 示例
CHANGELOG.md                                                            [修改] 收尾（迭代分支）
```

测试文件（改/增）见「测试策略」。

## 变更点清单

1. mobile fence 未命中分支拆分（无语言/表外 → `data-lang="plain"`；mermaid 保持裸 pre）。
2. mobile 新增 `code_block` 规则覆盖（plain 标 + 复制按钮）。
3. desktop `renderCodeBlock` 三个裸 pre 出口加 `data-lang="plain"`。
4. 新增 `attach-budget.ts` 共享常量（100k 预算 + 两条文案）。
5. 主会话 prepare 链接入预算累加器（整会话共享、逐条计量、超限降级 filename 档）。
6. attach 侧二进制/图片 filename 档 content 换 `BINARY_ATTACH_NOTE`（workplace 侧不变）。
7. skillAttach 接入预算，超限降级（`display:"filename"` + 引导文案）。
8. `subagent-tool.ts` 预算分配/尾注/条数常量退役（附件全挂，降级由 prepare 链统一）；`getContentSize` 端口与其在 `run-agent-turn.ts` 的两处装配注入整体退役。
9. R3 全链：域模型/wire/schema(strip)/校验/判定/public API/表单 helper 清理。
10. 双端 UI 删「常驻」开关；内置技能文档与示例同步。
11. `PromptAssemblySegment` 扩 `messageId?/seq?`；新增 `buildPromptPreviewTurnsFromLayout` + 类型并导出。
12. desktop 轮数据源（main 进程 `prompt-preview.service.ts`）+ 轮 DTO/IPC 四处同步/`RealPromptPanel` 轮渲染/`CodeEditor` readOnly/详情 Modal（assistant 轮 IPC 只传 summary+body 不传 items）。
13. mobile 轮渲染/新卡片/详情屏/callback 传参/路由注册/标签补齐。

## 详细实现步骤

- Step 1 — phase-lang-label — blocking: yes — qa: auto：mobile `prepare-transcript-rich-html.ts` fence 覆盖拆分 + 新增 `code_block` 覆盖（复用 `code-copy` span，escapeHtml 同源）。
- Step 2 — phase-lang-label — blocking: yes — qa: auto：desktop `code-block.tsx` 三个裸 pre 出口加 `data-lang="plain"`。
- Step 3 — phase-lang-label — blocking: yes — qa: auto：双端测试更新与新增（见 T-L 组）；mermaid 与命中表语言断言保持不动。
- Step 4 — phase-attach-budget — blocking: yes — qa: auto：新建 `attach-budget.ts`；主会话 prepare 接预算累加器与降级（含 `fileRefAction` 的 `noteText` 参数、二进制文案、skill 纳入、workplace 侧豁免）。
- Step 5 — phase-attach-budget — blocking: yes — qa: auto：`subagent-tool.ts` 预算逻辑退役（删 split/note/常量，附件全挂）+ `getContentSize` 端口与 `run-agent-turn.ts` 两处注入删除。
- Step 6 — phase-attach-budget — blocking: yes — qa: auto：core 附件链测试更新与新增（见 T-A 组）。
- Step 7 — phase-lifecycle-once — blocking: yes — qa: auto：core 全链简化（模型/wire/schema strip 含 dynamic+persist 两 schema/校验分支删除/`render-prompt.ts` 三处调用点改 `agentStepIndex === 0`/public API 删导出 + allowlist 快照删条目 + `public-api.md:76` 登记行删除）。
- Step 8 — phase-lifecycle-once — blocking: yes — qa: auto：双端 UI 删开关 + 表单 helper 清理（含 desktop `shared/logic/config-forms-agent.ts` 再导出条目）+ 内置技能文档/示例同步 + 测试更新（见 T-LC 组）。
- Step 9 — phase-prompt-rounds — blocking: yes — qa: auto：core `PromptAssemblySegment` 扩字段 + `buildPromptPreviewTurnsFromLayout` 轮聚合 + public 导出与 allowlist 快照 + 单测（见 T-R 组）。
- Step 10 — phase-prompt-rounds — blocking: yes — qa: auto：desktop 轮数据源（main `prompt-preview.service.ts`）+ 轮 DTO/IPC 四处同步（assistant 轮只传 summary+body）+ `RealPromptPanel` 轮渲染/`CodeEditor` readOnly/详情 Modal + 样式。
- Step 11 — phase-prompt-rounds — blocking: yes — qa: auto：mobile service 返回轮 + `RealPromptScreen` 轮渲染 + `PromptTurnCard` + `prompt-turn-callback` + `PromptTurnDetailScreen` + 路由注册 + 标签补齐。
- Step 12 — phase-prompt-rounds — blocking: no — qa: manual_user：双端真机/桌面人工验收（轮聚合观感、详情阅读、附件降级提示词预览、代码块语言标统一）。
- Step 13 — phase-wrap-up — blocking: yes — qa: auto：全量门禁（core `npm test`、mobile jest、desktop test + typecheck、mobile typecheck）+ CHANGELOG Unreleased（迭代分支）。

## 测试策略

### 测试用例

**R1（T-L 组，落 `apps/mobile/__tests__/code-block-render.test.tsx` 与 `apps/desktop/test/code-block-render.test.tsx`）**

- T-L1 — blocking: yes：无语言 fence → `<pre data-lang="plain">`（mobile 原「无 data-lang」断言反转；desktop T-CB3 的 doesNotMatch 与裸 pre 正则同步改）。
- T-L2 — blocking: yes：表外语言（rust / mjs / cjs）→ `data-lang="plain"`（双端 T-CB13 断言反转；desktop 剥 hljs 壳行为保持）。
- T-L3 — blocking: yes：mobile 4 空格缩进块 → `data-lang="plain"` + `<span class="code-copy">` 存在（新增；desktop 缩进块走兜底分支同断言）。
- T-L4 — blocking: yes：mermaid 块 → 无 `data-lang`、图表管线断言原样保持（`mermaid-webview.test.ts:158`、T-CB2 回归）。
- T-L5 — blocking: yes：命中表语言（ts/java）→ 标签值与现状一致（回归，不改）。
- T-L6 — blocking: yes：sanitize 透传 `data-lang="plain"`（现有白名单断言覆盖，补一条 plain 值形态）。

**R2（T-A 组，落 `packages/core/test/chat/prepare-user-messages-for-prompt.test.ts`、`prepare-skill-attach.test.ts`、`test/tool/subagent-tool-session-file.test.ts`）**

- T-A1 — blocking: yes：单次拼装内文本附件合计超 100k → 超限项 `display:"filename"` + content 为 `OVERSIZED_ATTACH_NOTE`；预算内项仍 full（边界：恰好等于预算不降级）。
- T-A2 — blocking: yes：skill 引用使合计超限 → `skillAttach` action 含 `display:"filename"` + 引导文案；不超限 → 全文照旧（既有 `:151-152` 断言保持绿）。
- T-A3 — blocking: yes：image/binary attach → content 为 `BINARY_ATTACH_NOTE`（修订原 `T-PD7` 的 `/1\|pic\.png/` 断言，`:924`）。
- T-A4 — blocking: yes：workplace 侧目录规则 filename 档 → 仍 `1|basename`（回归新增，锁「workplace 不受影响」）。
- T-A5 — blocking: yes：降级附件仍写 seen → 同会话后续同路径 alreadyReferenced（不重复尝试全文）。
- T-A6 — blocking: yes：子会话 fileAttachment 全量挂载（无条数上限、无尾注文本）；子会话 prepare 超限降级与主会话同形态；**超限附件在子会话首条消息的附件组（chip）可见——降级只影响提示词产物，不影响附件落库事实**。**随预算链退役一并删除/改写的既有用例显式清单（`subagent-tool-session-file.test.ts`，共 9 条 + 4 桩）**：T-TA3a（`:554` 超限不挂+尾注）/ T-TA3a2（`:586` 恰 20 条边界）/ T-TA3b（`:612` 字符预算）/ T-TA3c（`:636` blob ×4 折算）/ T-TA3c2（`:669` blob 等号档）/ T-TA3d（`:710` image/dir 条数名额）/ T-TA3d2（`:739` binary 名额）/ T-TA3f（`:821`）/ T-TA3h（`:690`）+ `getContentSize` 四个桩（`:63/:70/:174/:182`）；**T-TA1/T-TA1b/T-TA1c/T-TA2/T-TA3e/T-TA3e2/T-TA3g（物化、去重、路径校验、续用等与预算无关）保持绿作为回归面**。
- T-A7 — blocking: yes：`content` 已含 action XML 的存量附件原样带过（不计量不降级，回归保持）。
- T-A8 — blocking: yes：双端 `session-prompt-input.service` 测试同步——提示词预览与实发一致（预算降级同口径）。

**R3（T-LC 组，落 `packages/core/test/prompt/*`、`test/agent/*`、`test/config-forms/agent-editor-state.test.ts`）**

- T-LC1 — blocking: yes：动态块仅 step0 注入（`render-prompt-lifecycle.test` 改写：原 always 每步注入用例反转为 step≥1 不注入；跨轮新 run step0 重新注入——runner 级用例）。
- T-LC2 — blocking: yes：schema 兼容四态——`lifecycle:"once"` / 缺省 / `"always"` / **非法值 `"foo"`** 全部正常 decode（strip 剥键语义），域对象无 lifecycle 字段；`agent-definition.test.ts:203` 的 L10-Z3（非法值拒载）改为「strip 后正常 decode」期望。
- T-LC3 — blocking: yes：wire 往返——写出不含 lifecycle 键；persist 区带 lifecycle 的输入在**两层路径都 strip 不抛错**：zod 层改写 `agent-definition.test.ts:178`（L10-Z1，从抛 `ConfigDecodeError` 改为 strip 后正常 decode）、raw-map 层改写 `validate-agent-prompt-layout.test.ts:21`（从抛「持久区文本块不得包含 lifecycle」改为 strip 语义）。
- T-LC4 — blocking: yes：表单——`agent-editor-state` 删 helper 后双端表单读写正常（原开关映射用例删除，新建/编辑动态块 round-trip）。
- T-LC5a — blocking: yes：Step 7 完成时 prompt allowlist 快照删 `shouldIncludeDynamicBlock` 条目后导出面快照测试绿。
- T-LC5b — blocking: yes：Step 9 完成时 allowlist 快照增 R4 新导出条目后绿（T-LC5 拆两条，避免跨 phase 阻塞错位）。

**R4（T-R 组，落 `packages/core/test/prompt/render-prompt.test.ts` 新增段落 + 双端 UI 测试）**

- T-R1 — blocking: yes：切轮正确性——真用户输入开新轮；含 tool_result 的 user 消息不切轮（归 assistant 轮）；`prompt-workplace`（role user、source template）不误切。
- T-R2 — blocking: yes：会话开头无 user 前缀的 assistant 段自成首个 assistant 轮；user 轮至少一段。
- T-R3 — blocking: yes：模板段各自独立（template 轮）；dynamic 段（chat 之后）独立不进轮。
- T-R4 — blocking: yes：assistant 轮 summary 含首行摘要 + 工具调用计数 + 字符数；thinking 开/关两态摘要随实际段变化。
- T-R5 — blocking: yes：既有 parity 契约保持——`buildPromptPreviewSegmentsFromLayout` 输出与 CLI 文本 join 一致（`:165-189` 用例不动必须绿）。
- T-R6 — blocking: yes：desktop 轮渲染 + Modal 详情挂载（CodeEditor readOnly 生效、onChange 不挂）；无既有 RealPromptPanel 测试债，新建轻量渲染测试。
- T-R7 — blocking: yes：mobile 轮渲染分流 + `PromptTurnDetailScreen` 经 callback 取数渲染；`real-prompt-screen-scope.test.tsx` 保持绿的前提是**导航依赖不进 `RealPromptScreen` 顶层**（`useNavigation` 在 `PromptTurnCard` 内部自取，卡片经 FlatList 桩不被渲染）——若实现确需屏顶层导航，则必须先扩该测试的 `@react-navigation/native` mock（补 `useNavigation`），并把扩 mock 写进提交说明。
- T-R8 — blocking: yes：scope 语义回归——路由参数优先/缺省回落（既有 scope 用例不动）。

## 风险与回滚方案

- **R1 契约面**：MF-1 修订涉及双端测试断言反转，若 mermaid 或命中表语言断言意外变红即回退该 step；改动均为纯产出层（渲染函数），回滚单文件即可。
- **R2 行为面**：主会话预算是**新行为**（现状无闸），极端多附件会话的提示词会变小——这是目标而非回归；监控点是 `render-prompt.test` 的 S0 双读用例（T-S01 若测试数据大会被误降级，用例数据需小于预算）。子会话预算退役后若发现「全部挂载」在超大附件列表下拖慢派发（物化 IO），回滚点为恢复 `splitAttachmentsByBudget` 的字符档（条数档不恢复）。
- **R3 存量面**：手写 `lifecycle: "always"` 的 YAML 导入会静默变 once（拍板接受）；schema strip 是唯一兼容层，若 decode 测试抓到 strict 拒载即回退该 preprocess。
- **R4 parity 面**：core 采取「只加不改」，任何 `buildPromptPreviewSegmentsFromLayout`/CLI 文本的变化都是越界改动，T-R5 是硬门；desktop 预览通道返回类型改轮数组需**四处**同步（ipc-types / handlers-prompt / invoke-registry / RealPromptPanel，DTO 名不变），漏一处 tsc 即红。
- **回滚整体**：四项相互独立、无交叉文件（`render-prompt.ts` 同时承载 R3 判定与 R4 扩字段，注意按 phase 分两次提交），可按 phase 独立回滚。
- 开发一律在独立 worktree 分支（RULE 2026-09-30 纪律），main 只落迭代文档。
