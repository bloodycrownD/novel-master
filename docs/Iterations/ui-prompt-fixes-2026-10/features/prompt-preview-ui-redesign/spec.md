---
date: 2026-10-02
---

# 提示词预览 UI 重设计 技术规格（SPEC）

## 设计目标

按已拍板的 PRD（`docs/Iterations/ui-prompt-fixes-2026-10/features/prompt-preview-ui-redesign/prd.md`）与 HTML demo（主仓 `tmp/prompt-preview-demo.html`，http://127.0.0.1:8791）实现三层结构：收起的轮摘要卡 →（就地展开）→ 嵌套卡片流（工具调用一对一组卡）→（点任意卡）→ 全屏富文本只读。双端同构。摘要不得超长（限行截断+省略号）。

## 总体方案

三条主线，依赖顺序 core → DTO（desktop）→ 双端 UI：

1. **core（配对与卡片流）**：`items` 数组**一字不动**（保住 T-R5 parity deepEqual 与 CLI 序列化契约），在 `PromptPreviewTurn` 上**新增** `cards`（有序卡片流）与 `summaryText`/`metaText` 两字段。`cards` 由 `buildPromptPreviewTurnsFromLayout` 内**从 `ctx.messages` 的 content blocks 重建**（不碰 `formatChatMessageForCliPreview`——它是 CLI parity/token 序列化路径，段集合/顺序/role 全冻结）。卡片类型：`text`（用户输入/assistant 文本/模板段）、`thinking`、`toolGroup`（一对一组卡：use 元数据 + result 结构化数据或丢失占位）。配对按 `toolUseId` 建 Map（一次扫描，参照 mobile/desktop `message-blocks.ts` 的 `buildToolResultByUseId` 先例），失败判定复用已导出的 `resolveToolResultOk`（显式 `ok` 优先、legacy 回落 `Error:` 前缀）。
2. **DTO/IPC（desktop）**：payload 策略**有意反转**——统一全轮下发 `{id, kind, summaryText, metaText, cards}`，`body` 与 `items` 从 DTO 退役（cards 是唯一正文载体，消除「body 与 items 重复导致 payload 翻倍」的旧顾虑；体积=结构化单份）。`ipc-types.ts:909-921` 体积注释重写，`real-prompt-panel-rounds.test.tsx:494-514` 三条源码正则同步重写。mobile 无 DTO 层（core 类型直通），零映射改动。
3. **双端 UI**：mobile 组件族新写（轮卡三态/组卡/叶子卡，`components/prompt/` 下；不动公共 `CollapsibleCard`——零公共组件回归）；就地展开态**受控提升到屏级**（规避 FlatList `removeClippedSubviews` 卸载丢态）；全屏走 `FileMarkdownPreview` 新增 `renderKind='rich'` 档（跳过 front-matter 拆分、直接进 WebView 富文本管线，200k 降级沿用），**不用伪 `.md` 路径**（`splitMarkdownFrontMatter` 会把 `---` 开头的正文误当 YAML、linkify 会把 `[段名]` 渲染成坏链）。desktop 面板 `:115-222` 重写为轮卡列表，Modal 复用 `.text-prompt-overlay`/`.prompt-editor-modal` 壳、正文换 `MermaidMarkdown`（`onLinkClick` 不传）。

### 关键数据结构（core 新增）

```ts
// packages/core/src/service/prompt/prompt-preview-turns.ts
type PromptToolGroupStatus = "ok" | "error" | "lost";

interface PromptToolGroupCardData {
  readonly type: "toolGroup";
  readonly id: string;                    // `group-${toolUseId}`
  readonly toolName: string;
  readonly inputJson: string;             // JSON.stringify(input, null, 2)；input 为 {} 空对象时输出 `[tool_use name=<n> id=<id>]` 单行（与 CLI 形态一致）
  readonly result: {
    readonly toolUseId: string;
    readonly ok: boolean;                 // resolveToolResultOk 产出
    readonly body: string;                // formatToolResultContentForDisplay(content)
  } | null;                               // null = 悬挂 use（丢失占位）
  readonly status: PromptToolGroupStatus; // result==null→"lost"；!ok→"error"
  readonly parallel: boolean;             // 同一消息内多个 tool_use（并行徽标）
}

interface PromptTextCardData {
  readonly type: "text" | "thinking";
  readonly id: string;                    // 独立命名空间 `card-${message.id}-${blockIndex}`（多 text 块缓冲成一张卡时取首块 index）；template 轮卡用段 id。与段 id（chat-<mid>-<全局K>）无对应关系，仅要求轮内唯一；React key 一律用 card id
  readonly role: string;                  // user/assistant/template 段名（展示标签用）
  readonly body: string;                  // 卡片正文（就地预览 + 全屏源）
}

type PromptTurnCardData = PromptTextCardData | PromptToolGroupCardData;

interface PromptPreviewTurn {
  // 既有字段全部不动：id / kind / items / summary / body
  readonly cards: ReadonlyArray<PromptTurnCardData>;   // 有序卡片流（就地展开与全屏的渲染源）
  readonly summaryText: string;           // 真摘要：单行语义（>70 字截断，三类轮统一，见构造口径）
  readonly metaText: string;              // 计数行（见构造口径）
}
```

### cards 构造口径（按 kind 分派，实现须逐字遵循）

- **归属判定**：cards 构建独立遍历 `ctx.messages`，turn 归属复用与既有切轮循环**同一套**判定（`isUserInputMessage` 开 user 轮、模板段自成一轮并复位 current、其余归 assistant 轮）；一轮的消息集合按顺序产出卡片，块内顺序=content.blocks 顺序。
- **template 轮**：模板段（system/skills 索引/workplace/persist-*/dynamic-*）**不在 ctx.messages 里**（assembly 链合成段），cards 从该轮 `items` 的单段直转一张 text 卡（id=段 id、role=段标题、body=段 body）。
- **user 轮**：该轮消息经 `wrapUserMessageForLlm` 后通常为**单个** text block（有附件时形如 `<attachment>…</attachment>\n<user-input>…</user-input>`），直转一张 text 卡（body=完整 wrap 后文本，即「发给模型的形态」）；无附件未 wrap 时同样直转。
- **assistant 轮**：该轮全部消息按序、消息内按块序：text 块缓冲成 text 卡（连续 text 合并，`\n\n` 连接，与段产出同规则）；`thinking` 块仅当 `includeThinkingBlocks === true` 产出 thinking 卡（ctx.messages 已过 `applyThinkingContextForLlm` 剥块，此处 flag 与段产出同源；`redacted_thinking` 跟随 CLI 口径产出 body 为 `[redacted thinking]` 的 thinking 卡）；`tool_use` 块产出 toolGroup 卡，result 从全轮消息的 `tool_result` 块按 `toolUseId` 建 Map 取（一次扫描，参照 `buildToolResultByUseId` 先例），取不到则 `result:null`（丢失占位）。
- **摘要与计数产出**：`summaryText`——user 轮经 `<user-input>` 解析函数取**用户输入内层首行**（text 含 `<user-input>` 标签时取其内层文本首行，否则直接取 text block 首行；首行 >70 字复用 `summarizeFirstLine` 截断；内层为空串时兜底 `（无文本）`）；template 轮=段标题；assistant 轮=首条 assistant 文本首行（复用旧 `buildAssistantTurnSummary` 的取行逻辑）。`metaText`——**分别计算 counts 拼装**（复用旧计数表达式：工具调用次数、字数；不得按 `· ` 切旧 summary 拼串）：**M = 该轮全部卡片 body 长度之和**（user/template 单卡时即段 body 长度；assistant 与旧 items 求和口径对齐）；**K = `message.attachments?.length ?? 0`**（含 workplace 源附件，标签就叫「附件」）。assistant 轮 `#N · 工具调用 X 次 · M 字`，有失败/丢失时追加 ` · P 失败 · Q 丢失`；user 轮 `#N · M 字`，有附件时 ` · 附件 K`；template 轮 `M 字`。
- 旧 `summary` 字段保留（拼接形态不动，既有 T-R1/T-R4 部分断言与兼容用），UI 一律改读 `summaryText`/`metaText`。
- `cards` 顺序=消息块序重建的因果序，**与 items 的段序无关**（items 里合并 tool 段恒在消息首位的乱序是 parity 冻结产物，不动）。

## 最终项目结构

新增文件：
- `apps/mobile/src/components/prompt/PromptToolGroupCard.tsx`
- `apps/mobile/src/components/prompt/PromptTurnLeafCard.tsx`
- `apps/desktop/renderer/features/chat/PromptToolGroupCard.tsx`
- `apps/desktop/renderer/features/chat/PromptLeafCard.tsx`
- `apps/desktop/test/prompt-turn-mermaid-hook.mjs`（+ 配套 `prompt-turn-mermaid-stub.mjs`：props 记 `globalThis.__promptTurnMermaidProps`、渲染 `data-mermaid-stub` 占位，见 Step 6 测试基建）

删除文件：
- `apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx`（轮卡接管后零消费点，死代码删除；连同其测试内引用）

其余全部为既有文件改造（见变更点清单）。

## 变更点清单

| 文件 | 改动 |
|---|---|
| `packages/core/src/service/prompt/prompt-preview-turns.ts` | 新增 cards/summaryText/metaText 构建；配对 Map；user/template 真摘要；类型导出 |
| `packages/core/test/prompt/render-prompt-turns.test.ts` | T-R2/T-R3/T-R4 摘要断言更新；新增 T-PT 系列用例 |
| `packages/core/src/public/prompt.ts` | 仅加 type 导出（type 不入 allowlist 快照，零快照改动；不加值导出） |
| `apps/desktop/shared/ipc-types.ts` | `PromptPreviewTurnDto` 重设计（cards 下发、body/items 退役、新 `PromptToolGroupDto` 等）+ 体积注释重写；`PromptPreviewSegmentDto`（:902-907）随 items 退役**删除**（全仓仅 5 处引用、全在重写范围内） |
| `apps/desktop/src/main/ipc/handlers/prompt.ts` | payload map 重写 |
| `apps/desktop/test/real-prompt-panel-rounds.test.tsx` | `:473-514` 契约重写、`:344-375` Modal 断言改富文本、`:538-550` 源码契约更新；`:516-536` CodeEditor 判别联合契约**保留不动**（它测的是组件本身，与面板解耦，组件别处仍消费） |
| `apps/desktop/test/prompt-turn-code-editor-hook.mjs` + `prompt-turn-code-editor-stub.mjs` | 删除（Modal 换 MermaidMarkdown 后无消费方；新增 `prompt-turn-mermaid-hook.mjs` + mermaid stub 替代其角色） |
| `apps/desktop/renderer/features/chat/RealPromptPanel.tsx` | `:115-222` 重写：轮卡列表+组卡/叶子卡+Modal MermaidMarkdown；`editorProps()`/`__promptTurnCodeEditorProps` 相关 glue 删除 |
| `apps/desktop/renderer/styles/shell.css` | 新增轮卡/组卡/单元格样式；**保留** `.prompt-turn-card`/`.prompt-turn`/`.prompt-turn-card .prompt-segment__preview`/`.prompt-segment:hover` 契约类名 |
| `apps/mobile/src/components/prompt/PromptTurnCard.tsx` | 重写：三态轮卡（role 标签/限行摘要/meta 行/⤢ 整卡全屏/就地展开），受控 expanded |
| `apps/mobile/src/screens/stack/RealPromptScreen.tsx` | `PromptTurnRow` 统一轮卡；屏级 `openTurnIds`/`openGroupIds` state；顶层不新增 useNavigation |
| `apps/mobile/src/components/prompt/prompt-turn-callback.ts` | 载荷扩为 `{title, kind, body, leafId?}`（支持叶子级全屏） |
| `apps/mobile/src/screens/stack/PromptTurnDetailScreen.tsx` | `renderKind="rich"`；每个叶子/轮稳定唯一伪 key（`turn-N` / `turn-N-group-X`） |
| `apps/mobile/src/components/vfs/FileMarkdownPreview.tsx` | `PreviewRenderKind` 加 `'rich'`：跳过 front-matter、走 `prepareTranscriptRichHtml + RichDocumentWebView`、200k 降级；txt/md 档零改动 |
| `apps/mobile/__tests__/FileMarkdownPreview.test.tsx` | 新增 rich 档用例（T-MP7：正常/200k 降级/rn 回退/不被 !isMdPath 吃掉四条锚） |
| `apps/mobile/__tests__/prompt-turn-card.test.tsx` 等 | 三件套测试重写/更新（见测试策略） |

## 详细实现步骤

- Step 1 — phase-core-cards — blocking: yes — qa: auto：`prompt-preview-turns.ts`：按「cards 构造口径」节实现——独立遍历 `ctx.messages`（turn 归属复用 `isUserInputMessage` 同套判定）产出 cards；template 轮从 items 单段直转；user 轮 wrap 后 text 直转（新增 `<user-input>` 内层首行解析函数供摘要用）；assistant 轮 text 缓冲卡（`\n\n` 连接）/thinking 卡（仅 `includeThinkingBlocks === true`，`redacted_thinking` 产 body=`[redacted thinking]`）/toolGroup 卡（`toolUseId`→result Map 一次扫描，悬挂 `result:null`；`resolveToolResultOk` 判失败；`parallel`=同消息 tool_use 计数>1；`inputJson`=`JSON.stringify(input, null, 2)`、`{}` 时退化为 `[tool_use name=… id=…]` 单行）。`summaryText`/`metaText` 按「摘要与计数产出」口径分别计算（counts 不切旧 summary 拼串）。card id 独立命名空间 `card-${message.id}-${blockIndex}`。**不改 items/body/summary 与切轮逻辑**。
- Step 2 — phase-core-cards — blocking: yes — qa: auto：core 测试更新+新增：T-R2 `:173-180`（user summary）、T-R3 `:212-213`（template summary）、T-R4 `:218-259`（assistant summary 格式）、thinking 开/关两态 `:261-284` 按新字段更新断言；T-R5 `:288-319` **必须零改动通过**（items 未动的回归证明）；新增 T-PT1~T-PT10（见测试策略）。测试跑法：`--tsconfig tsconfig.test.json`。
- Step 3 — phase-dto — blocking: yes — qa: auto：`ipc-types.ts` DTO 重设计（`PromptPreviewTurnDto = {id, kind, summaryText, metaText, cards}` + 组卡/叶子卡 DTO；注释写明 cards 单份正文、体积策略反转理由）；`handlers/prompt.ts` map 重写；`real-prompt-panel-rounds.test.tsx` `:494-514` 正则改为钉死新 payload 形态（含「body 不再下发」反向断言）、`:445-471`（无 body payload）与 `:473-491`（items 不展开）重写为新语义。
- Step 4 — phase-mobile-cards — blocking: yes — qa: auto：新组件族：`PromptTurnCard` 重写（受控 `expanded`+`onToggle` props；header=role 徽标（user 青/assistant 紫/template 灰）+ `summaryText` `numberOfLines={1}`（单行省略，与 demo 一致）+`metaText` `numberOfLines={1}`+`⤢`（嵌套 Pressable+stopPropagation）+chevron；children 条件挂载展开区）；`PromptToolGroupCard`（组头=工具名+状态点（ok 绿/error 红/lost 灰）+可选「并行」徽标+受控展开；两格 use（inputJson 等宽预览限 3 行）/result（body 预览限 3 行或 lost 占位文案「未返回结果」），每格 Pressable→叶子全屏）；`PromptTurnLeafCard`（kind 标签+限 2 行预览+整卡→叶子全屏）。`RealPromptScreen`：`openTurnIds: Set<string>`/`openGroupIds: Set<string>` 屏级受控；`PromptTurnRow` 统一 `<PromptTurnCard>`（删段卡平铺分支）；删 `PromptPreviewSegmentCard`（轮卡接管后零消费点，死代码删除）。更新 `real-prompt-screen-scope.test`（删 PromptPreviewSegmentCard mock）。
- Step 5 — phase-mobile-fullscreen — blocking: yes — qa: auto：`FileMarkdownPreview` 加 `'rich'` 档：**分支插在 `:423` 的 plain 兜底判定（`renderKind==='txt' || !isMdPath`）之前短路**——`renderKind==='rich'` 时跳过 front-matter 拆分与扩展名判定，`prepareTranscriptRichHtml(content)` **沿用 md 路径的 try/catch 兜底形态（:300-309 先例：抛错回退纯文本分支）**后 + `RichDocumentWebView`（overLimit 沿用 200k WebView 判定；`previewEngine==='rn'` 回退时走 `RichContentBody` 12k 护栏，跟随既有引擎开关语义）；txt/md 两个既有档分支零改动。`prompt-turn-callback` 载荷扩 `{title, body, leafId?}`（take 读后即清语义不动；全屏页为纯展示终态，无二级全屏入口，不涉及详情页内重 set）。`PromptTurnDetailScreen` 改 `renderKind="rich"`、`path` 用 `turn-${turnId}`/`turn-${turnId}-leaf-${leafId}` 稳定伪 key 参与 `RichDocumentWebView key={path}` 重挂载；`prompt-turn-detail-screen.test` 断言更新（`renderKind:'rich'`）。
- Step 6 — phase-desktop-panel — blocking: yes — qa: auto：`RealPromptPanel` 重写：轮卡列表（三类统一：徽标+`summaryText` 单行截断（`-webkit-line-clamp:1`，white-space nowrap+ellipsis 沿用 `:3826-3835` 先例）+meta 行+`⤢`+就地展开）；展开区渲染 `turn.cards`（`PromptLeafCard`/`PromptToolGroupCard` 新组件，纯展示无跳转回调）；全屏 Modal 复用 `.text-prompt-overlay`/`.prompt-editor-modal` 壳、正文容器**新增 `.prompt-fullscreen__body`（flex:1; overflow-y:auto）**包 `<MermaidMarkdown content={…}>`（`onLinkClick` 不传；组卡叶子=各自 body；整轮=cards 逐卡 `MermaidMarkdown` 流，无 `[段名]` 前缀）；shell.css 增类（`.prompt-tool-group`/`.prompt-group-cell`/`.prompt-leaf-card`/`.prompt-fullscreen__body` 等）；**测试基建**：新增 `test/prompt-turn-mermaid-hook.mjs` + mermaid stub（照 `prompt-turn-code-editor-hook.mjs`/`stub.mjs` 现成范式：stub 把 props 记到 `globalThis.__promptTurnMermaidProps` 并渲染 `data-mermaid-stub` 占位节点，供 T-DP3 断言；规避其 `documentElement`/`MutationObserver` DOM 依赖在 react-test-renderer 下崩溃）；`real-prompt-panel-rounds.test` `:344-375`（Modal）与 `:538-550`（源码契约）更新、`:552-560` 类名契约保留旧类+加新类断言。
- Step 7 — phase-verify — blocking: yes — qa: auto：全量门禁四件套（core `npm test -w @novel-master/core` / mobile / desktop / 双端 typecheck），既有红基线对照 **core 9 / mobile 12 / desktop 0**（依据 `docs/Iterations/ui-prompt-fixes-2026-10/cache/verify-full.md`；该基线取自 d15324be8，执行时须先重跑一次基线快照以当时 HEAD 为准，不得新增引入红）。
- Step 8 — phase-verify — blocking: no — qa: manual_user：真机（Metro 8081 + `adb reverse tcp:8081 tcp:8081`）与桌面人工验收：轮卡展开/组卡三态/全屏富文本/摘要限行观感。

## 测试策略

### 测试用例

core（`render-prompt-turns.test.ts` 新增/更新）：
- T-PT1 — blocking: yes — 跨消息配对：m2 tool_use + m3 tool_result → 一张组卡 result 收进组，status=ok
- T-PT2 — blocking: yes — 并行：一条 assistant 消息两个 tool_use、下一条消息两个 tool_result → 按 id 配对两张组卡、parallel=true
- T-PT3 — blocking: yes — 失败双路：`ok:false` 显式与 legacy 缺省+`Error:` 前缀正文 → status=error
- T-PT4 — blocking: yes — 丢失占位：悬挂 tool_use（后续无 result）→ result=null、status=lost、槽位保留
- T-PT5 — blocking: yes — user 轮真摘要：`<user-input>` 内层首行（含附件 wrap 场景首行不是 `<attachment>`）+ 无附件直取首行；>70 截断；`metaText` 含字数与附件计数
- T-PT6 — blocking: yes — template 轮摘要：summaryText=段标题、metaText 含字数
- T-PT7 — blocking: yes — assistant summaryText/metaText 拆分口径（含纯工具轮 `N 段` 兜底、失败/丢失计数追加）
- T-PT8 — blocking: yes — cards 因果顺序：同消息内 tool_result 段在 items 里排首位（parity 乱序）但 cards 按块序正确
- T-PT9 — blocking: yes — 回归：T-R1/T-R5 全绿零改动（items/body/切轮未动的证明）
- T-PT10 — blocking: yes — thinking 卡门控：`includeThinkingBlocks` 开/关两态 cards 产出差异；`redacted_thinking` 产出 `[redacted thinking]` 卡

mobile（`__tests__/`）：
- T-MP1 — blocking: yes — 轮卡三态渲染：role 徽标、summaryText 限 1 行（numberOfLines=1 单行省略）、metaText 限 1 行
- T-MP2 — blocking: yes — 组卡：默认收起；展开两格；三状态色/文案；丢失占位「未返回结果」
- T-MP3 — blocking: yes — 屏级受控展开：toggle 回调改 openTurnIds；组卡同理
- T-MP4 — blocking: yes — 叶子/整卡全屏 callback 载荷（title/body/leafId）+ navigate 只带短标题
- T-MP5 — blocking: yes — 详情屏传 `renderKind='rich'`（prop 级断言，组件已 mock）
- T-MP6 — blocking: yes — scope 回归（real-prompt-screen-scope）更新后全绿
- T-MP7 — blocking: yes — `FileMarkdownPreview.test.tsx` rich 档真组件四锚：正常→`RichDocumentWebView` 收 html；>200k→`overLimit=true`+plain 降级；引擎 rn→走 `RichContentBody`；rich 档不被 `!isMdPath` 兜底吃掉（钉住插入点）

desktop（`test/`）：
- T-DP1 — blocking: yes — 轮卡列表三类轮统一渲染+summaryText 单行截断（nowrap+ellipsis）
- T-DP2 — blocking: yes — 组卡/叶子卡渲染与三状态
- T-DP3 — blocking: yes — Modal 富文本（MermaidMarkdown）+Esc/遮罩/footer 关闭
- T-DP4 — blocking: yes — payload 源码契约：cards 下发、body/items 不下发（正则重写后钉死）
- T-DP5 — blocking: yes — shell.css 类名契约：旧契约类名保留 + 新类存在

## 风险与回滚方案

- **CLI parity（最高）**：方案以「items/段集合/段序/body 全不动」为红线，cards 为纯新增旁路；T-PT9/T-R5 是门牙。任何实现中想动 `formatChatMessageForCliPreview` 的冲动都是错的。
- **payload 策略反转**：有意推翻 R4 的体积契约，注释与正则测试同步重写；若长会话体积实测异常，回退路径是 cards 按需拉取通道（本 spec 不做，留档）。
- **mobile 公共组件零改**：不碰 `CollapsibleCard`（3 个源文件消费：ThinkingBlockCard/ToolCallGroupCard/ChatHistorySearchScreen）；组件族全在新文件/既有 prompt 文件内。
- **renderKind='rich' 是加法**：txt/md 两个既有档分支不动，其他消费点零回归；`prompt-turn-detail-screen.test` 断言同步改；rich 档分支置于 plain 兜底判定之前。
- **mermaid 围栏双端不一致**（desktop 渲染图 / mobile 裸 pre）：跟随各自管线原样，PRD 已知风险接受，spec 不做特判。
- **回滚**：迭代分支单一功能面，git revert 该迭代提交即可整体回退；core 改动为加法（新字段），老消费方读旧字段不受影响。

## Context Bundle

```yaml
iteration_name: ui-prompt-fixes-2026-10/prompt-preview-ui-redesign
requirement_path: docs/Iterations/ui-prompt-fixes-2026-10/features/prompt-preview-ui-redesign/prd.md
spec_path: docs/Iterations/ui-prompt-fixes-2026-10/features/prompt-preview-ui-redesign/spec.md
demo: 主仓 tmp/prompt-preview-demo.html（设计基准，已用户拍板）
explore_summary: 两轮探索（业务面3报告+spec面2报告）：CLI parity 冻结边界=T-R5+token序列化+段id/轮id/摘要断言；配对无损源=ctx.messages blocks；payload 契约被源码正则钉死；FlatList removeClippedSubviews 丢态风险→屏级受控；FileMarkdownPreview rich 档加法优于伪 .md 路径（front-matter 误拆+linkify 坏链）
impact_files: [prompt-preview-turns.ts, render-prompt.ts, ipc-types.ts, handlers/prompt.ts, RealPromptPanel.tsx, shell.css, PromptTurnCard.tsx, RealPromptScreen.tsx, prompt-turn-callback.ts, PromptTurnDetailScreen.tsx, FileMarkdownPreview.tsx, 既有测试 6 个（render-prompt-turns / real-prompt-panel-rounds / prompt-turn-card / prompt-turn-detail-screen / real-prompt-screen-scope / FileMarkdownPreview）+ 新增 prompt-turn-mermaid-hook.mjs + 删 prompt-turn-code-editor-hook.mjs 与 stub]
constraints: [CLI parity 冻结, public allowlist 只加type不加值, RealPromptScreen 顶层禁 useNavigation, css 契约类名保留, CollapsibleCard 零改]
blocking_steps: [1,2,3,4,5,6,7]
```
