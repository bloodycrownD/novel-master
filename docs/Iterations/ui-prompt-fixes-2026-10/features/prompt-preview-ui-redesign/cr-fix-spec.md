# CR Fix Spec: 提示词预览 UI 重设计（prompt-preview-ui-redesign）

## 元信息
- repo：D:\Dev\nm-worktree\upfx（分支 feat/ui-prompt-fixes-2026-10）
- base_sha / head_sha：b616732fe / cf40d4d32
- prd_path / spec_path：docs/Iterations/ui-prompt-fixes-2026-10/features/prompt-preview-ui-redesign/{prd,spec}.md
- review_round / dag_version：3 / 4
- 状态：fix-spec-ready（review-full round 2 判定「6 处小改后即 ready、无需第三轮」，主代理已全部落实）

## Must-fix（P0=0，P1×1，P2×20，合计 21）

### main/A-2 [P1] mobile 整轮全屏喂 turn.body 退回 PRD 明令消灭的平铺形态且组卡配对结构丢失
- 维度：A/C-orch
- 文件：`apps/mobile/src/components/prompt/PromptTurnCard.tsx:103`
- 问题：mobile ⤢ 整轮全屏用 `turn.body`（`[段名]` 前缀拼接串，tool 段是旧粒度「一条消息多个 result 合并」），正是 PRD 背景痛点「assistant 详情是一坨平铺文本」与痛点 5（配对结构丢失）；PRD 验收 6 写死双端同构，desktop 已是 cards 逐块流。不崩不丢数据故不给 P0。
- 改法（照抄不翻车；注意 `PromptToolGroupCardData` **没有 `body` 字段**，core:38-48）：
  ```ts
  // 整轮全屏正文 = cards 逐卡正文，组卡拆两格（对齐 desktop cardBodies/toolGroupLeaves 口径）
  const fullscreenBodies = (cards: ReadonlyArray<PromptTurnCardData>): string =>
    cards
      .flatMap((c) => (c.type === "toolGroup"
        ? [c.inputJson, c.result?.body ?? LOST_RESULT_TEXT]
        : [c.body]))
      .filter((t) => t !== "")
      .join("\n\n");
  ```
  放在 `PromptTurnCard.tsx` 内；`LOST_RESULT_TEXT` **常量定义留在 `PromptTurnCard.tsx`（叶子模块）并 export，`PromptToolGroupCard.tsx` 反向 import**（该依赖方向本已存在 PromptToolGroupCard→PromptTurnCard，不得反向新增边造成环）；`handleFullscreen` 改用 `fullscreenBodies(turn.cards)`，**其 `useCallback` 依赖数组（现 :105 `[openDetail, turn.id, turn.summaryText, turn.body]`）把 `turn.body` 换成 `turn.cards`**；`turn.body` 依赖彻底退役。
- 验收/测试：`prompt-turn-card.test.tsx:179-181`（现断言 `body: TURN.body`）改为断言拼接结果；**新增组卡用例**：夹具含一张组卡时断言 use（inputJson）与 result 两段都在正文；变异验证——拼接退回 `turn.body` 必红。
- 来源：主代理汇总认定 → review-full round 1 升 P1 重写 → round 2 补常量归属与 deps

### main/A-3 [P2] PromptTurnDetailScreen 四处注释与实现不符（本轮 diff 引入）
- 维度：F/C
- 文件：`apps/mobile/src/screens/stack/PromptTurnDetailScreen.tsx:1-3,7-10,13-15,46`
- 问题：①文件头仍写「assistant 轮的正文（段前带角色前缀行）」——页面现服务三类轮+叶子卡，且前缀行正是 main/A-2 要退役的；②「不用伪 .md 路径…linkify 坏链」与现状自相矛盾（代码确实在用伪路径）；③`path` 注释「切换叶子/轮时重挂载」是假理由（`useRef` 初值只读一次，无页内切换）。
- 改法：随 main/A-2 一并改——文件头改「把某一轮或某张叶子卡的正文整段铺开阅读」；删 `[段名]` 论证改述「不用 `.md` 扩展名 + `renderKind='rich'` 跳过 front-matter 拆分」；path 注释（13-15 与 46）改「防御性：若将来详情页支持页内切换内容，key 让 WebView 重挂载；当前页是终态、挂载后不再换内容」。
- 验收/测试：与 spec 文本修正 4 口径**逐字一致**；mobile tsc 零错。
- 来源：review-full round 1 新增

### core/A-1 [P2] assistant 轮摘要取行未过滤 role
- 维度：A/B
- 文件：`packages/core/src/service/prompt/prompt-preview-turns.ts:311-317`（buildAssistantSummaryText）
- 问题：spec 钉「首条 assistant 文本首行（复用旧 buildAssistantTurnSummary 取行）」，旧实现按 `role==="assistant"` 过滤；新实现只判 `card.type==="text"`。assistant 轮存在 role=user 的 text 卡（tool_result 回传消息带 text 块），此时 summaryText 与旧 summary 自相矛盾。
- 改法（注意补类型谓词，裸 find 的 `.body` 编译不过）：
  ```ts
  const first = cards.find(
    (card): card is PromptTextCardData => card.type === "text" && card.role === "assistant",
  );
  ```
- 验收/测试：新增用例：assistant(tool_use) → user(tool_result+text「继续」) → assistant(text「收尾」)，断言 summaryText 为「收尾」。
- 来源：review-scope-core round 1；review-full round 1 补类型谓词

### core/A-2 [P2] 配对表含 hidden 消息与段产出双轨口径不一致
- 维度：A/B
- 文件：`packages/core/src/service/prompt/prompt-preview-turns.ts:185-197`（buildToolResultByUseId）
- 问题：注释称 hidden 参与配对，段产出侧对 hidden 是 continue；当前靠双端 service `includeHidden:false` 兜底，上游改全量拉取即出现「items 无、cards 有」。
- 改法：`if (message.hidden) continue;`（`ChatMessage.hidden` 是必填 boolean，message.ts:37，直接可编译）；注释同步删 hidden 表述。
- 验收/测试：新增 hidden 用例——hidden user 消息里的 tool_result 不参与配对 → 对应组卡落 lost。
- 来源：review-scope-core round 1

### core/C-1 [P2] 三处重复 reduce 与双次 ok 判定
- 维度：C/DRY
- 文件：`packages/core/src/service/prompt/prompt-preview-turns.ts:335,512-515,525-528,181,242`
- 问题：`cards.reduce(cardCharCount)` 三遍；`resolveToolResultOk` 两次。
- 改法：抽 `cardCharsOf(cards)` 三处复用；抽 `buildToolResultCell(resultBlock)` 一次判定产出 `result`+`status`。
- 验收/测试：既有 40 条全绿（零行为变化）。
- 来源：review-scope-core round 1

### core/G-1 [P2] 测试字数 helper 双份且自派生
- 维度：G
- 文件：`packages/core/test/prompt/render-prompt-turns.test.ts:321,408`
- 问题：两份同源公式；组卡 metaText 断言自派生（实测变异 +1 红 4 条，牙在但同漂不发现）。
- 改法：两 helper 合一；T-PT7 第二例补硬编码期望字数 **74**（审查者手算复核 20×3+3+9+2=74）。
- 验收/测试：合并后 40/40 绿；硬编码与实测一致。
- 来源：review-scope-core round 1

### desktop/H-1 [P2] cards 裸读无旧 main 兼容防御（仅 dev 可达）
- 维度：H/B
- 文件：`apps/desktop/renderer/features/chat/RealPromptPanel.tsx:220,115`
- 问题：Electron dev 下 renderer HMR 而 main 不重启，旧 main payload 无 `cards` → 展开轮卡/⤢ 抛 undefined；renderer 全仓无 ErrorBoundary → 整页卸载。**边界事实**：仅 dev 可达（无 autoUpdater、双端同包发布），旧实现读 `items ?? []` 显空不崩。
- 改法：`load()` 归一化 `setTurns(result.data.map(t => ({...t, cards: t.cards ?? []})))`（单点，渲染侧不动）。
- 验收/测试：`real-prompt-panel-rounds.test.tsx` 补「payload 无 cards」夹具断言（渲染不崩、展开区为空）。
- 来源：review-scope-desktop round 1；review-full 补边界事实

### desktop/C-1 [P2] `.prompt-segment` 基类族死 CSS（主代理拍板：选项 B，删）
- 维度：C
- 文件：`apps/desktop/renderer/styles/shell.css:3787-3793,3795-3798,3800-3835,3844-3846,3855-3868,3876-3878`（约 60 行）；`apps/desktop/test/real-prompt-panel-rounds.test.tsx:947-949`
- 问题：面板重写后基类族（除 `__preview`/`__chevron`）全仓零消费；T-DP5 的 `assert.match(css, /\.prompt-segment:hover \{/)` 钉住死规则自证。
- 改法（选项 B，随 spec 修正 6 一步到位）：删上述死 CSS 行；测试 947-949 删 `.prompt-segment:hover` 断言；spec 约束收窄为「保留 `.prompt-turn-card` / `.prompt-turn` / `.prompt-turn-card .prompt-segment__preview` 三个真消费类名」（`__preview`/`__chevron` 保留）。
- 验收/测试：desktop 全量绿；`git grep "prompt-segment" apps/desktop/renderer` 仅余 `__preview`/`__chevron`。
- 来源：review-scope-desktop round 1 选项 A → review-full 建议选项 B → 主代理拍板 B

### desktop/C-2 [P2] 组卡两格派生双写
- 维度：C/DRY
- 文件：`apps/desktop/renderer/features/chat/RealPromptPanel.tsx:70-79`
- 问题：父组件 `groupCardBody`/`cardBodies` 与 `PromptToolGroupCard.toolGroupLeaves` 各算一遍。
- 改法：删父组件两个本地 helper，`cardBodies` 改 `toolGroupLeaves(card).map(leaf => leaf.body)`（已导出）。
- 验收/测试：desktop 全量绿；整轮全屏与组卡格内容一致（既有断言覆盖）。
- 来源：review-scope-desktop round 1

### desktop/G-1 [P2] 两个 mermaid 基建文件缺尾换行
- 维度：G/K
- 文件：`apps/desktop/test/prompt-turn-mermaid-hook.mjs`、`prompt-turn-mermaid-stub.mjs`
- 问题：全 test 目录 25 个 mjs 仅这 2 个 lastByte=125。
- 改法：各补一个 LF。
- 验收/测试：末字节=10。
- 来源：review-scope-desktop round 1

### desktop/B-1 [P2] 轮卡头 hover 直角矩形与键盘焦点不可见
- 维度：J/UI
- 文件：`apps/desktop/renderer/styles/shell.css:3904-3912`（`__head` 3904-3908、`:hover` 3910-3912）
- 问题：hover 背景挂在无 padding 无圆角 div 上，在 12px 圆角卡内画直角矩形；无可聚焦反馈。
- 改法：`__head` 加 `border-radius: 10px` 与 padding（或负 margin 内衬）；补 `:focus-within { outline: 1px solid var(--primary); }`。
- 验收/测试：T-DP5 类名契约不回归；观感并入合并后 QA。
- 来源：review-scope-desktop round 1；review-full 校正行号

### desktop/B-2 [P2] 切会话不重置 expanded/fullscreen（open_q5/K-1 合并升格）
- 维度：B/H
- 文件：`apps/desktop/renderer/features/chat/RealPromptPanel.tsx`
- 问题：`expanded` map 与 `fullscreen` 不随会话切换清空，core 轮 id 是会话内相对的 `turn-${seq}`，切会话后上一会话展开态「带过来」。非本轮引入但改行为，mobile 侧已有对照实现（RealPromptScreen.tsx:94-99 load 清空）。
- 改法：`useEffect(() => { setExpanded({}); setFullscreen(null); }, [projectId, sessionId])`（或并入 load 的清理路径，与 mobile 口径对齐）。
- 验收/测试：`real-prompt-panel-rounds.test.tsx` 补一条：切 scope 后 expanded 清空。
- 来源：review-full round 1（原 open_q5/K-1 重复项合并升格）

### desktop/J-1 [P2] desktop 无障碍标签全是无内容动作名（mobile/J-1 的对偶）
- 维度：J
- 文件：`apps/desktop/renderer/features/chat/PromptLeafCard.tsx:36`、`PromptToolGroupCard.tsx:133`、`RealPromptPanel.tsx:184,204`
- 问题：三卡并排读屏念出三个一样的「查看卡片全文」；`收起/展开${roleLabel}` 恒为「展开assistant」不带摘要。
- 改法：叶子卡 `` `${label}，${card.body.slice(0,20)}` ``；组卡格 `` `查看${leaf.label}，${card.toolName}` ``；轮卡 toggle `` `${open?'收起':'展开'}${roleLabel}轮，${turn.summaryText.slice(0,20)}` ``；⤢ `` `整轮全屏，${roleLabel} ${turn.summaryText.slice(0,20)}` ``。
- 验收/测试：`real-prompt-panel-rounds.test.tsx` 补 4 条 aria-label 断言。
- 来源：review-full round 1 新增

### mobile/B-1 [P2] 丢失占位格可点进「（空文件）」详情
- 维度：B
- 文件：`apps/mobile/src/components/prompt/PromptToolGroupCard.tsx:57-64,128-148`
- 问题：result 为 null 时 `openResult` 传 `body: ''`，点「未返回结果」进全屏显示「（空文件）」——假入口。
- 改法：result 为 null 时该格不挂 onPress。
- 验收/测试：**新增**用例（现无 LOST_CARD 点按用例）：press LOST_CARD 的 result 格 → `expect(mockNavigate).not.toHaveBeenCalled()`。
- 来源：review-scope-mobile round 1；review-full 校正验收措辞

### mobile/J-1 [P2] 无障碍标签全是无内容动作名
- 维度：J
- 文件：`PromptToolGroupCard.tsx:75-76,112-113,130-131`、`PromptTurnLeafCard.tsx:42-43`、`PromptTurnCard.tsx:121-122,146-147`
- 问题：多卡无法区分；组头无 expanded 状态。范式：ChatMetaBar.tsx:42。
- 改法：叶子卡 `` `${kindLabel}，${card.body.slice(0,20)}` ``；组卡格 `查看工具入参，${toolName}`；组头 `accessibilityState={{expanded}}`。
- 验收/测试：两个组件测试各补 accessibilityLabel 断言一条。
- 来源：review-scope-mobile round 1

### cross/C-orch-2 [P2] 状态文案被染成低对比度语义色（双端同病，mobile/J-2 方案 B 立论修正）
- 维度：J/C-orch
- 文件：`apps/mobile/src/components/prompt/PromptToolGroupCard.tsx:95-100`（statusLabel `{color: STATUS_COLOR[card.status]}`）、`apps/desktop/renderer/features/chat/PromptToolGroupCard.tsx:114-120`（`__status` inline `style={{color}}`）
- 问题：浅色主题是**双端默认**（mobile ThemeProvider.tsx:31 默认 'light'；desktop shell.css 大量 `html:not([data-theme="dark"])`），#34c759/#f87171/#9ca3af 浅底 1.86~2.54:1（门槛 3:1）。原方案 B「语义由文字承载」不成立——承载语义的词（成功/失败/丢失）本身被染色。
- 改法：双端状态**文案**改主题正文色（mobile `tokens.text`；desktop 去 inline style，`.prompt-tool-group__status` 用 `var(--text)`）；**状态点保留语义色**；注释留痕「语义色浅底对比 1.86~2.54:1 低于 3:1 门槛，仅用于装饰性状态点；tokens 化另开迭代」。role 徽标（纯装饰+文字同色）保留。
- 验收/测试：双端定向绿；浅色主题可读性并入合并后 QA 第 2 条。
- 来源：review-full round 1 新增（吸收并修正原 mobile/J-2）

### cross/J-2 [P2] 「并行」徽标跨端不同构
- 维度：J/C-orch
- 文件：`apps/mobile/src/components/prompt/PromptToolGroupCard.tsx:166-173`（硬编码 #a78bfa）vs `apps/desktop/renderer/styles/shell.css:4090-4098`（`var(--text-tertiary)` + dashed `var(--border-light)`）
- 问题：role 徽标与状态三色双端同值，唯并行徽标 mobile 硬编码紫、desktop 中性色，破 PRD「双端同构」。
- 改法：mobile 对齐 desktop 中性 token——`styles.parallel` 去硬编码色，`color: tokens.textTertiary`、`borderColor: tokens.borderLight`、`borderStyle: 'dashed'`（照 statusLabel 的 tokens 注入范式）。
- 验收/测试：`prompt-tool-group-card.test.tsx` 补并行徽标取色断言（对齐 desktop 口径）。
- 来源：review-full round 1 新增

### mobile/C-1 [P2] 死导出与不可达兜底
- 维度：C
- 文件：`apps/mobile/src/components/prompt/PromptTurnCard.tsx:51,92-93`、`PromptTurnLeafCard.tsx:14`
- 问题：`promptDetailTitle`/`promptLeafKindLabel` 导出无消费（注释谎称复用）；`??` 兜底不可达。
- 改法：去两处 export、删两个 `??` 兜底。
- 验收/测试：mobile tsc 零错；real-prompt-screen-scope mock 链不破坏。
- 来源：review-scope-mobile round 1

### cross/C-orch-1 [P2] core↔desktop DTO 无结构同构锚
- 维度：C-orch/G
- 文件：`apps/desktop/src/main/ipc/handlers/prompt.ts`
- 问题：mobile 直吃 core 类型（改签名先红）；desktop 手写 DTO+逐字段 map 对「core 加字段」无感——漂移不对称。
- 改法（可照抄形态；**注意 core 根入口不导出 prompt 类型，必须走子路径 `@novel-master/core/prompt`**（public/prompt.ts:64）；**tsconfig.base.json `noUnusedLocals:true`，下划线不豁免局部声明，断言必须 export**）：
  ```ts
  // handler 内组卡/文本卡两处 map 的返回值各加 satisfies PromptTurnCardDto；
  // 文件底部（main 侧，tsconfig.json 覆盖、不碰 renderer ratchet）：
  // core 侧加字段而 DTO 未跟时，下列导出类型编译红（key 差集必须为空）
  export type CoreGroupParityCheck = Record<
    Exclude<keyof import("@novel-master/core/prompt").PromptToolGroupCardData, keyof PromptToolGroupDto>,
    never
  >;
  export type CoreTextParityCheck = Record<
    Exclude<keyof import("@novel-master/core/prompt").PromptTextCardData, keyof PromptTextCardDto>,
    never
  >;
  ```
  （导出不触发 TS6133；两条类型各自「字段差集→never」的 Record 在差集非空时构造不出而报错。）
- 验收/测试：`npx tsc --noEmit -p tsconfig.json` 零错——**先在无改动状态跑一次确认基线零错**，再上断言，再变异（core 组卡加假字段 → main tsc 红，验完还原）。
- 来源：review-scope-mobile round 1 + review-full round 1 具体化 + round 2 修导入路径与 TS6133

### mobile/G-1 [P2] T-MP3 受控「函数式更新」性质无断言钉死
- 维度：G
- 文件：`apps/mobile/__tests__/prompt-turn-expand-control.test.tsx:150-173`
- 问题：闭包值构造写法在现节奏下照样全绿。
- 改法：加 T-MP3-3——同一 `act()` 内连续 `onPress` 两个不同轮头，断言两条 `prompt-turn-body` 同时在。
- 验收/测试：新断言绿；变异（换闭包写法）该条红。
- 来源：review-scope-mobile round 1

### mobile/G-2 [P2] 卡片流分派顺序与「裁剪复挂载态保留」无锚
- 维度：G
- 文件：`apps/mobile/__tests__/prompt-turn-expand-control.test.tsx:104-123`、`prompt-tool-group-card.test.tsx`
- 问题：①夹具单组卡，type 分支/key/turnId 透传零观测；②「防 removeClippedSubviews 丢态」无测（桩不裁剪）。
- 改法：①夹具改 `[text, group, thinking]` 三卡断言顺序与 turnId 透传（`TURN.body` 是 core 必填字段**不能删**——保留但置 `''` 并加注释『main/A-2 后 UI 不再读 body，字段仅为满足 core 类型』，`prompt-turn-card.test.tsx:79` 夹具同理）；②加可变 data 桩：切 data 引用让某轮消失再回来，断言 `prompt-turn-body` 仍在。
- 验收/测试：新断言绿。
- 来源：review-scope-mobile round 1

## Spec 文本修正（随修复一并执行，闭合 spec_deviations）
1. 「摘要与计数产出」节：`M = 该轮全部卡片 body 长度之和` → `M = 该轮全部卡片正文长度之和（组卡 = inputJson + result.body；丢失组卡仅 inputJson）`；删除「assistant 与旧 items 求和口径对齐」括号。
2. 同节「从全轮消息的 tool_result 块建 Map」→「从 ctx.messages 全量（跳过 hidden）建 Map」（与 core/A-2 联动）。
3. Step 4/5 补整轮全屏口径（**重写版**）：「整轮全屏正文 = cards 逐卡正文的有序列表（组卡拆 use / result 两项，丢失组卡 result 为占位文案），无 `[段名]` 前缀；desktop 按块逐段渲染（`.prompt-fullscreen__block`），mobile 顺序拼接后整段渲染——同一份内容序列，非同一份字符串」。
4. Step 5 `key={path}` 注释口径：「防御性：若将来详情页支持页内切换内容，key 让 WebView 重挂载；当前页是终态、挂载后不再换内容」（与 main/A-3 逐字一致）。
5. Step 2/测试清单补登记 `prompt-turn-expand-control.test.tsx`。
6. 变更点清单 desktop 行：契约类名清单**收窄**为 `.prompt-turn-card` / `.prompt-turn` / `.prompt-turn-card .prompt-segment__preview` / `.prompt-segment__chevron` 四项（与 desktop/C-1 选项 B 联动，死基类族已删；`__preview` 与 `__chevron` 是唯二真消费子类）。

## Spec deviations
- open×6 文本修正已列步骤（修正 3 为重写版，与 main/A-2 新改法自洽）；无行为级 open 偏离。

## Open questions / 待拍板
1. core：`extractUserInputInner` 用 lastIndexOf(close)——用户原文贴 `</user-input>` 字面时摘要源会串（频率极低，未认定）。
2. core：同 toolUseId 多 result 时 Map 后写覆盖（与 transcript 先例一致，建议仅补注释）。
3. core：`#N` 的 seq undefined 分支不可达（防御 or 删，口味）。
4. desktop：组卡展开 key `::` 拼接远期撞键风险（现状安全）。

已决策（不再待拍板）：desktop kind 色条（border-left 3px）为纯装饰差异，mobile 不加；desktop 整轮全屏超长正文成本已并入合并后 QA 第 1 条。

## 已豁免（用户确认不修）
-（无）

## 合并后 QA（manual_user）
1. desktop 长会话（数百 KB 工具结果）点 ⤢ 整轮全屏：react-markdown+rehype-highlight 同步渲染掉帧是否可接受；不可接受再议阈值。
2. 真机（荣耀）+ 浅色主题：提示词页组卡三态/状态文案可读性、整轮 ⤢ 观感复核（cross/C-orch-2 与 mobile/J-1/desktop/J-1 改完后）。

## K 节建议（下游执行时闭合）
1. `ChatHistorySearchScreen.tsx:502` 注释里旧组件名 PromptPreviewSegmentCard 的文字债顺手清理。
2. 双端 J-1 改完后跑一次浅色主题目视（与 QA 2 合并执行）。
3. cross/J-2 改动触碰 mobile `StyleSheet.create` 静态样式，改完跑一次 mobile 定向（prompt-tool-group-card + prompt-turn-card）确认样式链无回归。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes（review-full round 2 前置判定：6 处小改闭合后即可 ready，round 2 后主代理已全部落实） |
| P0 / P1 / P2（已写入） | 0 / 1 / 20（合计 21） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open×6（文本修正已列，全部自洽） |
| C-orch | cross/C-orch-1、cross/C-orch-2 已列 |
| 合并后 QA | 2 条（不阻塞） |
