---
date: 2026-10-04
---

# 工具卡片统一化与 UI 修正（ui-card-unify-2026-10）技术规格（SPEC）

需求来源：`docs/Iterations/ui-card-unify-2026-10/prd.md`（六项合一：R1 附件预算 / R2 移除聊天记录查询 / R3 正文色 / R4 明度翻转+workplace 美化 / R5 组卡非卡片化 / R6 工具卡片统一化）。探索证据来自本迭代 brain-storm 四路报告 + spec 轮两路聚焦报告 + spec-check r1 三路证据包（`cache/evidence-{r1r2r3,r4r5,r6}.md`）与 judge 裁决。

## 设计目标

1. R1–R5 为参数/样式/删除类小改，R6 建立「core 唯一规格层 + 双端薄壳」的工具卡片架构，消灭三份平行实现与两份 webview 镜像。
2. 所有变更可验证：每步有测试锚或显式 manual_user 验收点；门禁面（allowlist 快照 / webview 门 B/C / renderer baseline）全部点名。

## 总体方案

### 关键架构决策（A1–A10）

**A1 · 规格层：受控 import 白名单、独立文件、跳转三元组由调用方传入**
core 新增 `packages/core/src/domain/chat/logic/tool-card-view.ts`：**唯一允许的运行时 import 是 `domain/chat/logic/tool-summary.js`（summarizeToolInput 的家——零 import 纯叶子，已在 chat-conversation 白名单）与 `domain/chat/logic/tool-use-preview.js`（本轮新增，formatToolUsePreviewJson 的家）**（允许 `import type`——tsc 编译期擦除、不落 dist；**禁止** import `resolveToolResultOk`/`build-tool-result-block`——那会把 `infra/tdbc` 等一串闭包拖进 webview bundle）。白名单净增仍为 2 条。ok/summary 等判定原料由调用方传入。

**跳转三元组的解析归属（r1 裁决）**：`ToolCardView` 输入含 `filePath?` / `skillRef?` / `subagentSessionId?`，**均由调用方解析后传入**——desktop 走 `@shared/logic/chat` 的 `resolveVfsToolFilePath`/`resolveSkillToolRefFromInput`（core 真源），mobile RN 侧在 `transcriptRowFromItem` 里用 core 真源算好随行数据过桥，webview **只消费字段、不做任何路径解析**（`vfs.` 前缀剥除随 `resolveVfsToolFilePath` 在调用方链路，规格层不碰路径）。这样 webview 两份镜像删除后无需 core 新增路径解析白名单。**连带行为变更（有意）**：core `skill-tool-ref.ts` 的 REF_ACTIONS 是 `{load,read,write,edit}` 而镜像只有 `{read,write,edit}`——镜像退役后 `skill load` 卡片**首次**出现技能详情跳转，属修复性变更，验收覆盖。

`ToolCardView` 形状（字段名实现时可微调；**输入为扁平参数**，与 webview `ToolCallRow` 的扁平字段直接对齐，调用方从 `result.meta` 抽取 `failureReason`/`skillRef`/`subagentSessionId` 后传入）：
```ts
buildToolCardView({
  toolName, input,
  ok?, summary?, resultContent?, failureReason?,    // 调用方从 result/meta 抽取；ok 由现有 status 派生（success→true/error→false/pending→省略，见 A6，不新增字段）
  filePath?, skillRef?, subagentSessionId?,         // 调用方解析的跳转三元组
  unpaired?,                                        // 无 result 时调用方按现状 resolveUnpairedToolStatus 传入 'pending'|'error'
})
  → {
  status: 'success' | 'error' | 'pending' | 'interrupted',
  summaryText: string,   // 三级链：summary(成功也读) → summarizeToolInput → resultContent 前120字（沿用 slice(0,117)+'…' 写法，禁 .at()）
  primaryAction: { kind: 'file' | 'subagent' | 'skill' | 'none', path?, sessionId?, skillRef? },
  inputPreview: string,  // formatToolUsePreviewJson 产物
  diff?: { rows: Array<{ kind: 'del' | 'add', text: string }>, truncated: boolean },  // 仅 edit 且 status !== 'pending'
}
```
（`toolUseId` 不进规格层——desktop 已直接从 row 读（`data-tool-use-id`），webview 由 A6 的 ToolCallRow 类型补齐后同样行级可读。）
**primaryAction 优先级（r1 定）**：`file > subagent > skill`，取第一个非空；三元组全缺省 → `kind:'none'`；同一张卡只渲染一个入口行。理由：与 read/write/edit 主用途一致（PRD 风险项 2 的预期方向）。

**A2 · formatToolUsePreviewJson 下沉叶子模块 + webview 白名单净增 2 条**
把 `packages/core/src/service/prompt/prompt-preview-turns.ts:606-674` 的 `formatToolUsePreviewJson` + `shrinkPreviewValue` + **4 个** PREVIEW_* 常量（PREVIEW_STRING/ARRAY/OBJECT_KEY/DEPTH_LIMIT，整段零 import 纯函数）下沉到新叶子模块 `packages/core/src/domain/chat/logic/tool-use-preview.ts`；`public/prompt.ts` 改从叶子模块 re-export（导出面不变、prompt 快照零改动）；`public/chat.ts` **新增** re-export（webview 统一经 `@novel-master/core/chat` barrel 消费）。webview 白名单 `WEBVIEW_CORE_ALLOWLIST['chat-conversation']` 净增 **2 条**：`domain/chat/logic/tool-card-view.js` + `domain/chat/logic/tool-use-preview.js`（**只维护 chat-conversation 键**；`chat-transcript` 键是死配置，本轮不动、注记）。无 npm 依赖、门 C 零新增（新代码禁用 `Object.hasOwn`/`Array.prototype.at`/`replaceAll`/`Object.fromEntries`/`structuredClone`/`??=`）。**T-TC6 口径：门 B 过且新增条目 ⊆ {tool-card-view.js, tool-use-preview.js}**。

**A3 · R4+R5 合一：二级壳透明化，灰只在最内层；左粗条只退役组卡域**
R4「组卡改白」与 R5「壳清零」互斥，合并为一条规律：**非最内层一律透明（透出白轮卡底），最内层一律灰**。
- 组卡壳（mobile `styles.card` / desktop `.prompt-tool-group`）→ 透明、无边框、无圆角（radius 一并删——透明壳留圆角无意义）。**透明写法钉死**：mobile 删 `backgroundColor` key（断言 `toBeUndefined()`）；desktop 写 `background: transparent` + 删 border（断言 `match(/background: transparent/)`）。
- 格子（`cell` / `.prompt-group-cell`）→ 灰（mobile `bgSecondary`、desktop `--surface-muted`），**组卡壳与格子的左 3px 粗条退役**；格子保留 hairline 全边框 + radius 8（边框配方对齐聊天侧 tool-card，底色是灰不是白——勿整卡照抄）。
- **左粗条归属（r1 裁决）：叶子卡与 workplace 预览卡的左 3px 粗条保留**。理由：叶子卡是「最内层独立内容块」、格子是「入参/结果分栏」，语义不同；`shell.css:3901-3902`/`:3807-3810` 的「子卡左条表达嵌套从属」注释依赖它；PRD R5 只授权组卡域退役。T-PC4 同时锁叶子卡灰底与左条存在。desktop 格子左条退役后 `shell.css:4065-4068` 的 `.prompt-group-cell:hover{border-left-color}` 随之清理（死声明）。
- workplace：列表壳透明（mobile `styles.card` 同款清壳；desktop `.prompt-workplace` 去 muted 底与左条、保留 padding 8px 10px），预览卡（最内层）灰、左条保留。
- **组头收窄与内缩（r1 修正，原方案自相矛盾）**：desktop `.prompt-tool-group__head` 改 `padding: 0 10px; min-height: 20px`（**只去纵向 6px，横向 10px 必须保留**，与 `__cells` 的 `padding: 0 10px 10px` 左对齐）；mobile `card` 清壳后 `head` 改整行 `head: {minHeight: 24, paddingHorizontal: 10}`（现状 head 无纵向 padding，需 minHeight 防塌——**此行为 mobile 唯一真源**）、`cells` 承担 `paddingHorizontal: 10 + paddingBottom: 10`（原 card 内缩原样下移一级），`card.gap: 8` 保留（管 head 与 cells 间距），两端视觉内缩一致。
- **组头 hover 保留**（desktop `:hover background: var(--background)` 是可点线索，删其 `border-radius` 即可；`:1126-1128` 三条 hover 存在性断言不动）。
- 明度注释清单 = **核心 8 处**（shell.css:3929/:4048、PromptToolGroupCard.tsx:11/:238、PromptTurnLeafCard.tsx:9、real-prompt-panel-rounds.test.tsx:1166/:1180、prompt-tool-group-card.test.tsx:330）+ **必失效 2 处**（mobile PromptWorkplaceCard.tsx:172、desktop shell.css:4189-4190「第三层白底浮起」）+ 邻近陈旧注释顺手改（shell.css:3966-3967 组头 28px→20px、PromptToolGroupCard.tsx:12-14 组头 40 高与「格子白底」）。
- **mock 值口径**：双端 prompt 系测试 mock `bgSecondary='#f4f4f5'`（真实 token `#E5E5EA`）——断言一律按 **mock 值 #f4f4f5** 写；`prompt-tool-group-card.test.tsx` mock 补 `background`/`surfaceElevated` 两键。
- **深色主题收窄（r2 理由修正）**：mobile 深色 `surface===bgSecondary==='#1C1C1E'`（层次坍缩不可观察）；desktop 深色 `--surface-muted`(#14161a) 比轮卡底 `--surface-elevated`(#22252b) **更暗**——层次方向与浅色一致但对比更弱。故 A3 的明度层次断言**仅浅色**；深色靠 hairline 边框维持层级，验收只查可读性。R4 验收与 Step 11 相应收窄。
- **chevron 统一（r1 裁决）**：mobile 提示词页三处 `⌄/›`（PromptWorkplaceCard:102、PromptToolGroupCard:141、PromptTurnCard:155）一并换 `▼/▶`（折叠语义的三端共同先例：CollapsibleCard/CollapsibleSection/FormSelectField/ToolPolicyPicker 全用实心三角；`›` 在别处是导航语义）；字号差异保留（desktop 10px / mobile 14px）。

**A4 · 聊天卡点击语义统一：点卡=展开，跳转=显式入口行**
- **点击卡片任意处 = 展开/收起**（11 工具一致）；`primaryAction.kind !== 'none'` 时卡内渲染显式入口行（「查看文件 ·」「子会话 ·」「技能详情 ·」）。**规格层不加 pending 门**（r2 裁决）：mobile 现有 `pendingSubagentSessions` 注入链（ChatTabProvider→message-blocks :243-259 按 title 匹配给执行中的 task 卡注入 subagentSessionId，使其可点进子会话浏览）是**有意功能、整链保留零改动**——pending task 有注入值即渲染入口行；desktop 无注入链则 pending 期自然无入口，该双端差异为**既有形态**（非本轮引入），对齐需 desktop 补注入链，挂账不在本轮。
- webview 委托机制天然支持：卡 `data-action="toggle-tool-card"` + 入口行直接复用现有 `open-tool-file`/`open-subagent-session`/`open-skill` 三个 action（`closest('[data-action]')` 取最近祖先分层）——**rows-click 只新增 toggle-tool-card 分支，三条跳转分支零改动**；现状挂在整卡的 data-action 移到入口行。
- desktop `ToolCallCard` 的整卡 `<button>` 重构为「卡容器（div，点击=展开）+ 入口行（button）」两元素，解决 HTML 嵌套；`.tool-call-card--clickable`/`__open-hint` 的 CSS 语义从「可跳转」改「可展开」（cursor/高亮跟展开态走）；**`MessageAttachmentGroupCard.tsx:54-62` 共用 `.tool-call-card` 基础类——零改动，仅回归关注其视觉不被波及**。
- **webview per-tool 卡头自绘**（不复用 `CollapsibleSection`——其 headerClass 硬编码 `tool-group-header` 会嵌套串味）；**组容器 `tool-group-section`/`tool-group-header` 类名与 `.tool-card`/`.tool-group-item` 类名全部保留**（e2e `.tool-group-section` 选择器与 `chat-conversation-boot-script.test.ts:448`、`chat-transcript-set-floor-menu.test.ts:27/:50` 的类名断言依赖）。单卡选择器以 `[data-tool-use-id]` 为主键（Step 8 新增，Step 10 e2e 用）。

**A5 · summary 数据面落差（spec_deviations #1）**
PRD「summarizeToolSuccess 提为导出供 UI 复用」不成立：该函数吃 `output: unknown`（原始输出对象），UI 侧只有已格式化的 `content: string`。裁决：**UI 只读已落库的 `tool_result.summary`**（v1.0.5 起写入，`e39f85171`），summarizeToolSuccess 不动不导出。规格层 `summaryText` 三级链：`summary（成功态也读）→ summarizeToolInput → resultContent 前 120 字`。存量边界：v1.0.5 前消息无 summary 落第二级；v1.5.29 read-ref 存量行 content 空串且无 summary 时摘要为空串（与现状同形，接受）。
**连带必红（有意，是 A5 的变异证据）**：双端 `message-blocks-read-ref.test.ts` 共 4 条断言（mobile :71/:140、desktop :93/:178——会变的成功态族；desktop :151 是「无 path 引用态」用例，新旧口径都输出空串**不变、勿动**）——按新口径改写期望（成功态优先 summary），文件头注释从「勿按 result.summary 断言」翻转为「成功态优先 summary」。

**A6 · interrupted 判据（同源常量+测试锁；r3 补 ok 数据面口径）**
判据：`ok === false && failureReason === SUBAGENT_STOP_REASON_USER`（"用户停止"，`subagent-tool.ts:98`；failureReason 为扁平入参，调用方从 `result.meta.failureReason` 抽取）。**`ok` 的取数口径（r3 裁决，双端 UI 层均无 ok 字段——status 即 ok 的压扁形态）**：调用方由现有 `status` 派生传入——`success → ok:true`、`error → ok:false`、`pending → 省略`；**不新增 ok 字段**（派生与 `resolveToolResultOk` 结果等价，interrupted 场景 status 必为 'error'）。规格层遵守 A1 的受控 import 口径，内部定义同值常量并注释同源关系；core 测试加一条「两常量相等」断言防漂移。连带：desktop `shared/ipc-types.ts:771-778` meta DTO 补 `failureReason?: string`（main 侧 `messages.ts:63` 已整体透传，仅缺类型）；mobile `ChatTranscriptBridge.ts` 的 `TranscriptToolView` 与 webview `state.ts` 的 `ToolCallRow` 补**扁平字段** `failureReason?`（与规格层输入直接对齐，无嵌套适配层）。**toolUseId 表述修正（r1）**：RN `message-blocks.ts:468` 已传 toolUseId（桥类型必填、`build-transcript-rows.test.ts` 已断言）——缺口**仅 webview `state.ts` 的类型声明**，改法是补类型不是改 RN。

**A7 · edit diff：手写零依赖 + 双熔断 + 公共前后缀；pending 不产 diff**
oldString/newString 无任何 schema/parse 上限（实测确认）。**手写而非用 core 已有 `diff@^7` 依赖，理由（r1 补）**：门 B 只看 `packages/core/dist/` 不拦 node_modules，但 diff@7 含 `Object.hasOwn`/`Array.at` 的概率高——门 C 计数上升需抬基线；无行号需求下最小 LCS ~60 行可控；若日后改用 diffArrays，须实测门 C 并同步 T-TC6（预留条款，非默认）。实现：①先剥公共前后缀（行级）；②字符熔断：old+new 合计 > 200_000 字符 → 整块 del+add；③行数熔断：进入 LCS 的行数任侧 > 1_000 行 → 整块 del+add。整块形态下各侧文本截断到前 40 行 + 「共 N 行」提示。LCS 为经典 O(n·m) 行级 DP（`Array(n).fill(0)` 写法，禁 `Object.fromEntries` 建表）。展示层：展开体 diff 行渲染上限 60 行 + 截断提示。**`status === 'pending'` 不产 diff（input 已含 old/new 但结果未知，diff 会误导）——`diff` 字段省略，展开体只显示入参预览 + 「等待结果」占位**。导出独立函数 `buildEditDiffRows(oldString, newString)` 便于单测。

**A8 · webview 展开态 × 行窗口化：force 通道（r1 修正，原「复用现有入口」是 no-op）**
`row-windowing.ts` 的 `measureRowWindow()` 零参数且开头有守卫「`lastMeasuredWin.start/end` 未变 → 直接 return」——toggle 一张卡不改窗口范围，原方案实测无效。改为：`measureRowWindow(options?: { force?: boolean })`，`force` 时先置 `lastMeasuredWin = null` 再测；`rows-click.ts` 的 `toggle-tool-card` 分支在 `renderRows()` **之后**调 `measureRowWindow({ force: true })`。展开体 CSS 注意 `.bubble` 的 `white-space: pre-wrap` 继承——diff/正文 `<pre>` 上显式 `white-space: pre` + `overflow-x: auto`。真机验收项覆盖「展开大结果卡后来回滚动无跳变」。

**A9 · workplace 文件行改两行结构**
现状全路径单行 12px monospace（长路径必截断）。改为：`[📁/📄 emoji 18px] [主行 basename / 副行 目录路径 12px textSecondary] [display pill] [chevron ▼/▶]`，行高 mobile 44 / desktop 32~36，hairline 分隔。**basename 拆分落点（r1 定）**：双端各用本端既有 `entryName`（mobile `vfs-row-mapper.ts:48` / desktop `vfs-tree-utils.ts:87`），**不新增 core 导出**（避免 allowlist/快照面）；目录副行 = path 去掉末段（本端小函数）。**全路径保留**在展开 key 与 a11y 文案上不变（`PromptWorkplaceCard` 现有 `onToggleFile(path)`/label 语义零变化）。display pill 维持手抄 3 键子集（刻意的 hidden 裁剪，不动）。**新 testID**：主行 `prompt-workplace-file-name`、副行 `prompt-workplace-file-dir`（承载 T-PC3）。**必红连带**：`prompt-workplace-card.test.tsx:92-114`（T-WP1-1 断言 file-path children=全路径数组）按两行结构改写。图标沿用 emoji 两态（core 无图标映射先例，不新建资产）。展开态交互（屏级受控 key）零改动。

**A10 · R2 删除顺序与门禁清单**
UI 先（desktop IPC 链 6 文件+CSS 整块 7168-7458+`:7810` 悬空注释改写；mobile 屏+导航 3 文件+入口卡**整块 :362-392**）→ core 后（port/service/仓储+`message-content-match.ts`+`public/chat.ts:121`）。preload **零改动**（通配放行，`preload.ts:44-46` 实证）。易漏点全清单：SessionDetailDrawer **七处**（import :62、state :99、注释 :110、**useEffect 内 :117 `setSearchPanelOpen(false)`**、分支 :367-368、按钮 :602-609、**dot :599-601**）；`keyboard-avoid-android.test.tsx:8-10` 注释摘掉 ChatHistorySearchScreen 半句；`session-detail-screen.test.tsx:576` 陈旧注释（T-AM3-3 内）一并清；孤儿桩 `chat-search-shell-nav-{hook,stub}.mjs`；`typecheck-renderer-baseline.json:125-126` 两条 + `maxErrors` 实测下调（不得抄数字）；core 仓储 `:100-130` LIKE 守卫常量与 rationale 注释随函数体一并清；**`react-alias-hook.mjs:10` 命中 ChatHistorySearchPanel 但被 9+ 测试共用——白名单，不得删**；core 删除模块路径是 `domain/chat/content/message-content-match.ts`（非 logic/content）。T-RS1 扫描范围钉死：`packages/**/src`、`apps/**/{src,shared,renderer,test,__tests__}`，排除 `docs/**` 与 `CHANGELOG.md`。

### R1（附件预算）
单点改 `ATTACH_PROMPT_CHAR_BUDGET = 500_000`（attach-budget.ts:30）+ `:29` TSDoc 补换算说明（50 万明文当量字符 ≈ 1.5MB CJK UTF-8）+ `prepare-user-messages-for-prompt.ts:704-706` 注释。测试文件**共 6 处文本**：`:1325`/`:1332`/`:1367` 标题 + `:1480`/`:1663`/`:1664` 注释（写死 100_000/100k，改后是说谎死注释）。断言零改动（全引用常量，全仓无其它相关 100_000 字面量——已扫）。workplace 8MB/2MB 闸门不动。

### R3（提示词正文色，r1 修正后实为 6 处）
**第 6 处是实缺陷（r1 发现）**：mobile `PromptToolGroupCard.tsx:199-205` 的 tool result 格正文**无 color 覆盖**（靠 RN 默认黑）——现状白底无感，A3 格子翻灰后深色主题下黑字压 `#1C1C1E` 不可读。补 `{color: tokens.text}`（与 :170 use 格对称）。完整 6 处：mobile 叶子卡 `:62`、**mobile 组卡 result 格 `:199-205`**、mobile workplace 预览 `:122`；desktop `shell.css:3961`/`:4094`/`:4207`。**豁免**：pill 徽标（`:4081` cell__tag、`:4180` file-display）与 `.is-lost` 占位（`:4108-4111` tertiary）保留次级色——占位态语义不在 R3 范围，勿连带改。护栏落点：desktop 契约块（real-prompt-panel-rounds.test.tsx:1100-1134 范式，对三个选择器加 `color: var(--text)` 断言）；mobile 叶子卡断言落 `prompt-tool-group-card.test.tsx`（mock text:'#111'）、**workplace 预览断言落 `prompt-workplace-card.test.tsx`**（preview-text testID+flattenStyle 基建在该文件）。**indexOf 切片纪律**：保留原选择器串形态（含空格与 `{`）与规则存在性；整删规则前先把断言改 `doesNotMatch`（indexOf 返回 -1 会切出空串、归因困难）。

## 最终项目结构

```
packages/core/src/domain/chat/logic/
  + tool-card-view.ts        # 规格层：ToolCardView 构建 + summary 三级链 + interrupted 判据 + buildEditDiffRows（仅白名单内两处 import：tool-summary / tool-use-preview）
  + tool-use-preview.ts      # formatToolUsePreviewJson + shrinkPreviewValue + 4×PREVIEW_* 下沉（零 import）
  - ../content/message-content-match.ts   # 删除（R2，注意路径在 domain/chat/content/ 下）
packages/core/src/public/chat.ts       # + buildToolCardView/buildEditDiffRows/formatToolUsePreviewJson、- MessageSearchQuery
packages/core/src/public/prompt.ts     # formatToolUsePreviewJson 改自叶子模块 re-export（导出面不变）
apps/mobile/scripts/build-webview.mjs  # chat-conversation 白名单 +2（tool-card-view / tool-use-preview）
apps/mobile/src/web/chat-transcript/webview/
  + ui/render/ToolGroup.tsx 重写为薄壳（消费规格层+展开体+diff；per-tool 卡头自绘）
  - runtime/util/vfs-tool-path.ts      # 删除（镜像）
  - runtime/util/skill-tool-ref.ts     # 删除（镜像）
apps/mobile/src/components/chat/
  - ToolCallCard.tsx / ToolCallGroupCard.tsx   # 删除（RN 僵尸卡）
desktop/shared/logic/chat.ts           # + buildToolCardView/buildEditDiffRows（export…from 形态）+ export type ToolCardView
# 其余为既有文件定点改动（详见变更点清单）
```

## 变更点清单

**R1（3 文件）**：attach-budget.ts（常量+TSDoc）、prepare-user-messages-for-prompt.ts（:704-706 注释）、prepare-user-messages-for-prompt.test.ts（**6 处文本**：:1325/:1332/:1367 标题 + :1480/:1663/:1664 注释）。

**R2（整删 12 + 定点 22，按枚举执行不按总数）**：
- 整删 12：desktop `ChatHistorySearchPanel.tsx`、mobile `ChatHistorySearchScreen.tsx`、desktop 测试 4+桩 2（messages-search-handler / chat-search-race-guard / chat-search-error-render / chat-search-collapsible-form / chat-search-shell-nav-{hook,stub}.mjs）、mobile `chat-history-search-screen.test.tsx`、core `message-search.test.ts`、`message-search-service-limit.test.ts`、`domain/chat/content/message-content-match.ts`。
- 定点 22：desktop `ipc-types.ts:95/:698-708`、`handler-registry.ts:126/:283`、`handlers/messages.ts:28/:151-167`、`invoke-registry.ts:33/:335-338`、`client.ts:85`、`SessionDetailDrawer.tsx`（**七处**，含 :117）、`shell.css:7168-7458+:7810`、`typecheck-renderer-baseline.json:125-126+maxErrors 实测`、`session-detail-drawer.test.ts:159-185`、`chat-link-route.test.ts:244-254`；mobile `SessionDetailScreen.tsx:362-392`（入口卡整块）、`types.ts:97-98`、`RootNavigator.tsx:46/:200-202/:317-318`、`header-config.ts:44`、`session-detail-screen.test.tsx`（T-MO1 块 + **:576 注释**）、`keyboard-avoid-android.test.tsx:8-10`；core 双 port+仓储（含 :100-130 LIKE 守卫与注释）+service+`public/chat.ts:121`+`message-plaintext-write.test.ts:272-285`。
- 白名单勿删：`react-alias-hook.mjs`（9+ 测试共用）。

**R3（6 处+护栏）**：见上文 R3 节（含第 6 处实缺陷）。

**R4+R5（提示词页）**：mobile `PromptToolGroupCard.tsx`（壳透明/格子灰/组卡域左条退役/head 24+paddingH10/chevron ▼▶）+ `PromptWorkplaceCard.tsx`（壳透明/预览灰/两行文件行/chevron）+ `PromptTurnLeafCard.tsx`（头注释；**左条保留**；:62 正文色归 Step 4）+ `PromptTurnCard.tsx:155`（chevron）；desktop `shell.css` prompt 族（:3969-4045 组卡壳透明+head 20px/0 10px、:4049-4063 格子灰+左条退役、**:4065-4068 hover 左条清理**、:4115-4215 workplace 壳透明+预览灰）+ `PromptWorkplaceCard.tsx`（两行行+chevron）+ `PromptToolGroupCard.tsx:135`（chevron）；注释核心 8+必失效 2+邻近陈旧；断言改写：desktop `real-prompt-panel-rounds.test.tsx:1120-1133/:1164-1188`（:1124→20px、:1172-1174 壳、:1179/:1181 格子；**:1164-1167 叶子卡左条+灰底断言保持绿**）、mobile `prompt-tool-group-card.test.tsx:327-353`（:334-337 壳四条改透明/无边框/无 radius 断言、:342-344 格子灰+左条退役；mock 补 background/surfaceElevated）、`prompt-workplace-card.test.tsx:92-114`（两行结构改写）+`:165-185`（壳/预览翻转）。**层次断言仅浅色**。

**R6**：
- core：`+tool-card-view.ts`、`+tool-use-preview.ts`（下沉）、`prompt-preview-turns.ts`（删下沉段改 re-export）、`public/chat.ts`（+buildToolCardView/+buildEditDiffRows/+formatToolUsePreviewJson；快照 `snapshots/public-chat-allowlist.json` **确切新增名单：buildToolCardView、buildEditDiffRows、formatToolUsePreviewJson 三条**；`export type` 不入快照——export-snapshot 只收运行时导出，实证）；`subagent-tool.ts` 不动。
- desktop：`shared/logic/chat.ts`（+转发，**只能进 export{…}from 块**；ToolCardView 走 export type 块）、`ipc-types.ts`（meta+failureReason）、`message-blocks.ts`（ToolCallView+failureReason+filePath 解析已有；toolCallSummary 收敛为规格层调用）、`ToolCallCard.tsx` 重写（点卡=展开+显式跳转行+diff 渲染；删死 prop showFullParams）、`ToolCallGroupCard.tsx`、`shell.css`（展开体+diff 行样式 .diff-del/.diff-add+--clickable 语义拆分）、`MessageAttachmentGroupCard.tsx`（零改动，回归关注）。
- webview：`build-webview.mjs`（白名单+2）、`ToolGroup.tsx` 重写薄壳（per-tool 卡头自绘、类名保留、data-action 移入口行、`[data-tool-use-id]` 主键）、`tool-logic.ts` 收敛（保留 import+export 两步形态；**规格层取代 toolCallSummary 后旧 export 随之删除**——本地调用消失后它是无用再导出，knip 会报）、`rows-click.ts`（+toggle-tool-card 分支+`measureRowWindow({force:true})`）、`row-windowing.ts`（measureRowWindow 加 force 参数）、`state.ts`（-VFS_FILE_TOOLS、ToolCallRow +toolUseId?/+failureReason?/+filePath?/+skillRef?、**+toolCardExpanded: Record<string,boolean>**，key=`${groupKey}:${toolUseId}`、toolUseId 缺省退化组内序号）、`transcript.css`（展开体+diff+pre 白空间）；RN 侧 `message-blocks.ts`（transcriptRowFromItem 补 filePath/skillRef/failureReason 解析与透传——**用 core 真源**；toolCallSummary 改薄包装委托规格层）、`ChatTranscriptBridge.ts`（TranscriptToolView+failureReason+filePath+skillRef）。
- 删除：webview 两镜像、RN 僵尸卡两文件。
- 测试同步（**r1 大补**）：`message-blocks-read-ref.test.ts` 双端（mobile :71/:140 归 Step 8、desktop :93/:178 归 Step 7——4 条成功态断言按 A5 新口径改写+注释翻转；desktop :151 不变勿动）；`chat-transcript-boot-script.test.ts:85`（'ToolGroup' 保留即绿）与 **:231-236 整块替换为反向断言——三符号 `normalizePathForToolCard`/`resolveLogicalPathForToolCard`/`resolveVfsToolFilePath` 均断言 bundle 零命中（镜像退役后 core 版不进 webview bundle，三符号全消失；实测现状产物里 `resolveVfsToolFilePath` 仅镜像改名版 2 处）+ Step 8 跑 build:webview 后 grep 产物复核三符号 0 命中作为变异证据**；**`chat-conversation-boot-script.test.ts:448`（.tool-card CSS）与 `chat-transcript-set-floor-menu.test.ts:27/:50` 在保留类名前提下零改动**；`build-transcript-rows.test.ts`（+failureReason/filePath/skillRef 透传断言）。

## 详细实现步骤

- Step 1 — phase-attach-budget — blocking: yes — qa: auto：R1 常量 500_000+TSDoc+prepare 注释+测试 6 处文本；定向跑 T-A 族+三链 parity（T-A8 族零改动仍绿）。
- Step 2 — phase-remove-search-ui — blocking: yes — qa: auto：R2 波 A（desktop 6 文件+CSS 整块+dot+悬空注释；mobile 入口卡整块 :362-392+导航 3 文件+keyboard-avoid 注释+ :576 注释）；desktop/mobile tsc 必须过。
- Step 3 — phase-remove-search-core — blocking: yes — qa: auto：R2 波 B（core 双 port+仓储+service+match 模块+public 导出+LIKE 注释+3 个耦合断言+baseline 两条+maxErrors 实测）；core 全量绿；T-RS1 按钉死范围 grep。依赖 Step 2。
- Step 4 — phase-prompt-text-color — blocking: yes — qa: auto：R3 **6 处**（含 mobile result 格实缺陷 :199-205——**本 Step 唯一 owner**）换正文色+双端护栏断言（mobile 叶子卡落 group-card 测试、workplace 预览落 workplace-card 测试、desktop 三选择器契约）+变异验证。
- Step 5 — phase-prompt-cards — blocking: yes — qa: auto：R4+R5+A3/A9 全量（壳透明/最内层灰/组卡域左条退役+叶子卡与预览卡左条保留/head 收窄与内缩修正/chevron 统一/workplace 两行行/注释与断言改写/mock 补键/深色收窄声明）。**与 Step 4 全面串行（不按文件交集裁剪）**——交集含 7 项：mobile PromptToolGroupCard / PromptWorkplaceCard / PromptTurnLeafCard、desktop shell.css、real-prompt-panel-rounds.test.tsx、prompt-tool-group-card.test.tsx、prompt-workplace-card.test.tsx。真机观感归 Step 11。
- Step 6 — phase-toolcard-core — blocking: yes — qa: auto：A1/A2/A5/A6/A7（tool-card-view+tool-use-preview 下沉+public 导出与快照三条+白名单 2 条+core 单测：11 工具矩阵含 primaryAction 优先级用例/summary 三级链/interrupted 判据+常量相等锁/diff 双熔断+前后缀+pending 无 diff/门 B 跑 build:webview 过）。
- Step 7 — phase-toolcard-desktop — blocking: yes — qa: auto：desktop 消费（shared/logic 转发仅 export…from+export type、meta DTO+failureReason、message-blocks 收敛、**desktop read-ref :93/:178 两条改写**、ToolCallCard 重写：点卡展开+显式跳转行+diff+**interrupted「已中断」渲染**、shell.css 展开体/diff/--clickable 语义、附件组卡回归关注、删死 prop、桌面测试补 T-TD*）。依赖 Step 6；与 Step 5 共享 shell.css 与 real-prompt-panel-rounds.test.tsx——串行：Step 5 完成后执行。
- Step 8 — phase-toolcard-webview — blocking: yes — qa: auto：webview+RN 消费（白名单 2 条、ToolGroup 薄壳重写+自绘卡头+类名保留+**interrupted「已中断」渲染**、toggle-tool-card+force 重测量、ToolCallRow 补字段+toolCardExpanded、RN message-blocks 补三元组解析透传+toolCallSummary 委托、**mobile read-ref :71/:140 两条改写+头注释翻转**、**pendingSubagentSessions 注入链零改动（回归确认）**、删两镜像+VFS_FILE_TOOLS+僵尸卡、boot-script :231-236 三符号反向断言+产物 grep 复核、CSS、ES2018 禁用清单自查、build:webview 门 B/C 过、webview 测试补 T-TW*）。依赖 Step 6；与 Step 5/7 文件不相交，可与 Step 7 并行。
- Step 9 — phase-verify — blocking: yes — qa: auto：全量四件套：core build+core 全量（红账 stash 对照归因）、mobile 全量+tsc、desktop 全量+tsc（renderer baseline 只降不升）、build:webview 门 B/C。
- Step 10 — phase-e2e — blocking: no — qa: auto：模拟器 e2e（Metro 真实路径+reverse；单卡选择器 `[data-tool-use-id]` 从零建：展开/收起/diff 渲染/显式跳转/skill load 新跳转+提示词页新层次与 workplace 两行截图判定）；装机三连（build:webview --copy-native+gradle+install）。
- Step 11 — phase-device-verify — blocking: no — qa: manual_user：真机验收（**浅色**层次与正文可读性、**深色**可读性与 hairline 层级、workplace 文件列表观感拍板、展开大结果卡滚动无跳变、edit diff 观感、附件 500k 链路抽查、叶子卡/预览卡左条保留观感确认）。

## 测试策略

- 变异验证纪律：新增断言逐条做「改回旧实现必红」验证（Step 4/5/6/7/8 各至少一条）；A5 的 4 条 read-ref 改写断言本身就是变异证据（改回「成功态不读 summary」必红）。
- 既有红账（read-ref 族/时区族/webview-asset-guard 等）stash 对照归因，不混入本轮。**注意**：`message-blocks-read-ref.test.ts` 的「既有红账 read-ref 族」与本轮改写的 4 条是**同文件不同用例**——改写用例在本轮变绿，其余既有红仍按基线归因。
- e2e：组容器类名 `.tool-group-section` 族保持不变；单卡交互以 `[data-tool-use-id]` 定位。

### 测试用例

- T-B1 — blocking: yes — 480k 不降级 / 501k 降级 / 恰好 500k 不降级（core，改造既有 T-A1 族边界值）。
- T-B2 — blocking: yes — skillAttach 同预算同降级（既有 T-A2 族同步）。
- T-B3 — blocking: yes — 三链一致：desktop/mobile session-prompt-input parity（既有 T-A8 族零改动仍绿）。
- T-RS1 — blocking: yes — 删除后 grep 零命中（范围钉死：`packages/**/src`、`apps/**/{src,shared,renderer,test,__tests__}`，排除 docs/** 与 CHANGELOG.md）。
- T-RS2 — blocking: yes — 双端会话详情无「查找聊天记录」入口（改写后的负断言）。
- T-RS3 — blocking: yes — baseline 无失效条目且 maxErrors 实测下调（脚本复跑）。
- T-PS1 — blocking: yes — 正文色四组（r1 拆分）：①mobile 叶子卡 preview=text；②mobile 组卡 use 格与 result 格（result 格改前无 color 必红）；③desktop 三选择器 `color: var(--text)`；④mobile workplace 预览正文（落 workplace-card 测试）。变异必红。
- T-PC1 — blocking: yes — 组卡壳透明无左条无 radius、格子灰（**mobile 断言按 mock 值 #f4f4f5**；desktop `background: transparent`）；is-lost/占位/pill 保持次级色（负断言）。
- T-PC2 — blocking: yes — 组头收窄（desktop `min-height: 20px` + `padding: 0 10px`；mobile minHeight 24+paddingH 10——**新增锚点**，现无断言）。
- T-PC3 — blocking: yes — workplace 两行结构（新 testID file-name/file-dir 各自 children 断言+emoji 图标+pill；:92-114 旧全路径断言改写）。
- T-PC4 — blocking: yes — 叶子卡维持灰底**且左 3px 粗条保留**；workplace 预览卡灰底+左条保留（防过度翻转回归）。
- T-PC5 — blocking: yes — chevron 双端 `▼/▶`（mobile 三处一起换后统一断言）。
- T-TC1 — blocking: yes — 规格层 11 工具视图模型矩阵（status/summaryText/primaryAction.kind 逐工具）+ **primaryAction 优先级 file>subagent>skill 的多入口用例**（如 skill read 双入口取 file）+ **vfs. 前缀剥除用例**（filePath 解析在调用方，core 侧只测规格层分派——前缀剥除属调用方链路，落 desktop/RN 透传断言）。
- T-TC2 — blocking: yes — summary 三级链（成功态读 summary / 无 summary 落 summarizeToolInput / 再落 content 120 字；双端 read-ref 4 条改写即本用例的双端形态）。
- T-TC3 — blocking: yes — interrupted：failureReason=用户停止+ok=false → interrupted；普通 error 不误判。
- T-TC4 — blocking: yes — SUBAGENT_STOP_REASON_USER 与规格层常量相等锁（防漂移）。
- T-TC5 — blocking: yes — buildEditDiffRows：公共前后缀剥离/多行增删/字符熔断整块/行数熔断整块/空串边界/**pending 无 diff 由规格层保证（status=pending 时 diff 省略）**。
- T-TC6 — blocking: yes — 白名单：build:webview 门 B 过且**新增条目 ⊆ {tool-card-view.js, tool-use-preview.js}**；门 C 计数零上升。
- T-TD1 — blocking: yes — desktop 点卡展开/收起；显式跳转行仅 primaryAction≠none 时渲染且点击不冒泡触发展开；MessageAttachmentGroupCard 回归不破。
- T-TD2 — blocking: yes — desktop edit 卡展开渲染 diff 行（del/add 类名）；pending edit 无 diff 有占位。
- T-TD3 — blocking: yes — desktop 成功态摘要显示（read → summary 文案；read-ref 改写族）。
- T-TD4 — blocking: yes — desktop interrupted 渲染（r3 补）：status='error'+failureReason='用户停止' → 卡片显示「已中断」而非「失败」（ok 由 status 派生）。
- T-TW1 — blocking: yes — webview toggle-tool-card 委托+展开态渲染（inputPreview+resultContent）+force 重测量调用（toggle 后 measureRowWindow({force:true}) 恰一次）。
- T-TW2 — blocking: yes — 删镜像后 build-transcript-rows 断言 filePath/skillRef/failureReason/toolUseId 透传；boot-script :231-236 反向断言（bundle 无镜像符号）。
- T-TW3 — blocking: yes — RN 僵尸卡删除后 mobile 全量绿（无隐式引用）。
- T-TW4 — blocking: yes — webview interrupted 渲染（r3 补）：error+failureReason='用户停止' → 「已中断」状态渲染。
- T-E2E1 — blocking: no — e2e：工具卡全链（展开/diff/跳转/skill load 新跳转）+提示词页观感截图判定（Step 10）。

### 测试用例 ↔ Step 映射表（r2 补，code-dev-loop verify 派发输入）

| 用例 | 归属 Step |
|---|---|
| T-B1 / T-B2 / T-B3 | S1（S9 全量复验） |
| T-RS1 / T-RS2 | S2（T-RS1 终态断言在 S3 后复验） |
| T-RS3 | S3 |
| T-PS1 | S4 |
| T-PC1 / T-PC2 / T-PC3 / T-PC4 / T-PC5 | S5 |
| T-TC1 / T-TC2 / T-TC3 / T-TC4 / T-TC5 | S6（T-TC1 的 vfs 前缀子项随透传断言归 S7/S8） |
| T-TC6 | S6 产 core 后 S8 build:webview 实证（断言归 S8） |
| T-TD1 / T-TD2 / T-TD3 / T-TD4 | S7 |
| T-TW1 / T-TW2 / T-TW3 / T-TW4 | S8 |
| T-E2E1 | S10 |

## 风险与回滚方案

1. **R4/R5 合一裁决若与用户预期不符**（用户描述「组卡内部白」可能指实底白而非透明透白）：透明方案视觉结果一致（白来自轮卡），差异仅在轮卡若换底色时透出——当前轮卡恒白，风险极低；真机验收轮确认（Step 11 含此项观感）。
2. **A5 落差**：PRD 的「summarizeToolSuccess 提导出」落空，以「读落库 summary」等效满足 PRD 验收；记 spec_deviations（PRD 已同步标注）。
3. **A8 守卫已识别（r1）**：原「复用现有入口」在 lastMeasuredWin 守卫下是 no-op——force 通道是确定方案，不存在降级路径；若 force 重测后仍有滚动微跳（EWMA 收敛特性），属可接受的已知限制，真机验证严重度。
4. **存量红账**：mobile/desktop/core 各有既有红族，全部 stash 对照归因后放行；read-ref 族与本轮改写用例同文件不同用例，按用例级归因。
5. **回滚**：迭代分支整体 revert；R2 如需单项回滚，UI 波与 core 波各为独立提交组。
6. **测试资源**：T-B1 族构造 ×5 内存上涨，必要时把大用例改分片 repeat。
7. **深色主题**：A3 层次仅浅色可观察（mobile 深色 surface≡bgSecondary 同值坍缩；desktop 深色 muted 比轮卡底更暗、层次方向一致但对比更弱）——深色验收只查可读性与 hairline 层级，不写明度断言。
