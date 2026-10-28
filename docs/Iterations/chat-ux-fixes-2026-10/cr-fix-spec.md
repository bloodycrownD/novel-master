# CR Fix Spec: chat-ux A/B + 胶囊终止符不显示

## 元信息

- repo：`D:\Dev\Js\novel-master`
- base_sha：`07f268e26eb0cf705e7443a3cc02621bcd03165e`（tag `v1.5.45`）
- head_sha：`02608cf37f3b6e83614bc8933534a94f04dc3e4d`（分支 `feat/capsule-mark-hide`）
- prd_path：未提供
- spec_path：
  - `docs/Iterations/chat-ux-fixes-2026-10/features/A-composer-token-terminator/spec.md`
  - `docs/Iterations/chat-ux-fixes-2026-10/features/B-subagent-reuse-card/spec.md`
  - C（markdown 横滚）已在 v1.5.45 发布，本轮不在范围
  - 胶囊终止符不显示：增量 UI 需求，无 spec（用户在真机验收后口头确认）
- review_round：4
- dag_version：4
- 状态：**fix-spec-ready**（第 4 轮 review-full 判定 closed，7 项回归全部闭合、无新阻塞项）
- 评审节点：`review-scope-a`（composer token）、`review-scope-b`（子代理复用）、`review-scope-c`（胶囊终止符不显示）、`review-full`（第 2/3/4 轮：fix-spec 覆盖度与可执行性回归）
- 模式：scope（三 scope 并行）+ full（末轮）

## 总览

| 级别 | 条数 |
|---|---|
| P0 | 0 |
| P1 | 3 |
| P2 | 13 |

三条 P1 的共同点：**实现本身正确，缺的是「反向牙齿」与一处内容裁剪的边界收窄**——删掉对应分支，现有测试仍全绿。没有发现会静默坏数据的 P0。

第 2 轮（review-full）修订了 4 处「按原配方执行拿不到红测」的验收，补了 1 条旧格式合成守卫的 P2 缺口，并补齐了两份触达清单（注释、格式、spec deviations）。

---

## Must-fix（按 P0 → P1 → P2）

### scope-c/B-1 [P1] 成对终止符的裁切误伤普通 markdown 链接 label

- 维度：B（正确性）+ H（兼容）
- 文件：`patches/react-native-enriched-markdown+1.1.1.patch`（安装态 `node_modules/.../spans/RoundedBackgroundSpan.kt:48-57`）、`node_modules/.../input/styles/TokenStyleHandler.kt`、`.../input/styles/LinkStyleHandler.kt:37-46`
- 问题：裁切判据写在 **基类默认实现**里，而基类同时服务 LINK。本 app 把 `markdownStyle.link` 设成胶囊样式（`NativeChatComposer.tsx:583-603`，backgroundColor/borderRadius/padding 均非零），因此 composer 里**所有** markdown 链接都走 `RoundedBackgroundSpan`；`InputParser` 的 LINK 区间只覆盖 label，`pasteMarkdown` 与 `setValue` 水化都会产出 LINK。只要 label 首尾是 `$`/`@`（如 `[@alice@](https://x)`、`[$HOME$](...)`），链接胶囊会把首尾字符吞掉，显示成 `alice` / `HOME` —— 把 token 规则误用到普通链接内容上。
- 改法：裁切改为 **Token 侧显式开启**，基类默认恒等。
  - 最小改动：`RoundedBackgroundSpan` 增加构造参数 `trimPairedDelimiters: Boolean = false`，`displayStart/displayEnd` 仅在为 true 时裁；`TokenStyleHandler.createSpans` 构造 `TokenBackgroundSpan` 时传 true（`TokenBackgroundSpan` 加同名参数并透传）。
  - 不要在 span 实例上后改开关：`InputFormatter` 按类名反查 handler 重建 span（`TokenStyleHandler.kt:19-24`），开关必须走 handler 创建参数。
  - 同步更新 patch 内该文件的 KDoc（说明「只服务 TOKEN 的裁切，LINK 恒等」）。
- 验收/测试：无 Kotlin 单测基建，走真机三条：① composer 粘贴 `[@alice@](https://x.dev)`，label 完整显示 `@alice@`；② `$写文档$` token 仍只显示 `写文档`；③ `@/docs/a.md@` token 只显示 `/docs/a.md`。
- 来源：`review-scope-c`（首轮）

### scope-a/G-1 [P1] 全屏入口自愈（F-A10）无任何用例覆盖

- 维度：G（测试缺口）+ A（spec 验收项）
- 文件：`apps/mobile/src/screens/tabs/ChatTabScreen.tsx:203-210`、`apps/mobile/__tests__/composer-fullscreen.test.tsx`
- 问题：spec F-A10 要求为「全屏入口自愈（落点③）」补用例，本轮没有覆盖这段新增分支：`composer-fullscreen.test.tsx` 的 T-FS2 走 `tokenRanges: []` 的空数组恒等路径，**删掉 `.filter` 也不会红**。
- 改法：**先把 controller 文本改成与 store 一致，再覆盖 ranges**，否则 remap 会因「编辑区相交」直接摘成 `[]`，断言就不是 `.filter` 的牙齿。
  1. `typeComposerText(tree.root, '$技能尾追')`（使 controller 当前文本 = 待测文本）；
  2. `writeChatComposerDraftState('s1', {text:'$技能尾追', attachments: [], tokenRanges:[{start:0,end:5}]})`（该函数不 notify 订阅者，controller 不会抢先自愈）；
  3. `pressFullscreen()` 后断言 `mockNavigate` 的 PromptEditor payload `tokenRanges` 为 `[]`。
  测试文件需新增 `writeChatComposerDraftState` 的 import。
  再补一条 store 文本 ≠ payload 文本的用例（store `x$技能$` + `[{1,5}]`、payload `$技能$`），断言 remap 后区间保留。
- 验收/测试：
  - 删掉 `ChatTabScreen.tsx:209` 的 `.filter` → 第一条红；
  - 把过滤基准改成 `entryDraft.text`（而 payload 用的是 remap 后的文本）→ 第二条红。
- 来源：`review-scope-a`（首轮）；第 2 轮修正了时序（`review-full/fix-spec#1`）

### scope-b/B-1 [P1] F-B3 只驱动到「二轮 delta 可推」，spec 要求的三个副作用无断言

- 维度：G（测试缺口）+ A（spec 验收项 F-B3）
- 文件：`apps/mobile/__tests__/session-stream-unit-messages.test.ts:853-903`
- 问题：现有断言止于 `expect(h.manager.snapshot('kid')?.partialText).toBe('第二轮')`，之后没有任何 STEP / FINISHED：
  1. 替换后新单元能否被 `finishRun` 按 **r2** 收口（runId 没接上就会流式后永不 settle、屏上停止按钮不消失）无覆盖；
  2.「不发完成通知」无断言，且 harness 未按 spec 补 `setPrefBridge({isNotificationEnabled: async () => true})` 与 `jest.mock('.../agent-finished-notification')`（保留 `resetKeepAliveStateForTests`）；
  3.「注入标记不残留」无出口（没有在新单元 running 后二次 attach 断言 partial 恰好注入一次）。
- 改法：在该用例（或 `createHarness` 增参）注入 prefBridge 并 mock 通知模块，然后**按此顺序**驱动与断言（顺序颠倒或漏 `advanceStreamTimers()` 会让正确实现也红）：
  1. `publishTextDelta(h.eventBus,'kid','r2','第二轮')` 后 **`advanceStreamTimers()`**（partial 要经 ingress 32ms + apply 64ms 两段缓冲才物化，`session-stream-unit.ts:1128-1183`；只有 `metrics.textChars` 是 `ingestDelta` 同步累加，`:1114`）→ 断言 `partialText==='第二轮'` 且 `metrics.textChars>0`；
  2. 在此之后 attach 第二个 handle → 断言恰好收到一次 `stream-delta(text='第二轮')`（证明新单元 `injectedValue===false`、旧注入标记没带过来）；
  3. `publishStepCommitted('kid','r2')` → 断言 `partialText===''` 而 metrics 保留；再 attach 第三个 handle → 断言 step 后不再注入（空注入不发）；
  4. `publishFinished('kid','r2')` 后 **先 `await flushAsync()`**（`finishRun` 是 `void this.notifySettled(...)`，而 `notifySettled` 先 `await prefBridge.isNotificationEnabled()`，同步断言恒真，`manager:1590-1611`）→ 断言 `status==='finished'`、`runState.upsert/settle` 均未被调用、`notifyAgentRunFinished` 未被调用。
  依据：注入守卫要求 `status==='running'` 且 partial 非空（`session-stream-unit.ts:1226-1237`）；STEP 会清 partial 并复位注入标记（`:756-778`）。
- 验收/测试：删掉「runId 回填（第二次 `markRunning`）」、或把 `adoptConsumptiveUnit` 换成 `new SessionStreamUnit`、或让 consumptive 分支不 return 继续走持久层 → 新增断言必须红。
- 来源：`review-scope-b`（首轮）；第 2 轮修正了时序（`review-full/fix-spec#2`）

### scope-a/G-2 [P2] 回滚链正例（F-A3）缺失

- 维度：G
- 文件：`apps/mobile/__tests__/use-chat-composer-controller.test.tsx`
- 问题：spec F-A3 指定在该文件覆盖用户报告的核心链路，现有唯一条 undefined-ranges 用例（`:1012-1023`）是旧格式负例（`$技能尾追` → `[]`）；**一个「正则永不命中」的错误实现也能让它绿**，正例唯一防线目前只在纯函数 fixture。
- 改法：新增用例 `seedDbJson('s1', {text:'帮我$写文档$总结', attachments: []})` → `await mount(); await flush();` → `expect(current().tokenRanges).toEqual([{start:2,end:7}])`。
- 验收/测试：把正则退回无尾终止符版本 → 该用例红。
- 来源：`review-scope-a`

### scope-a/G-3 [P2] atomic-range-delete 三处仍是旧格式，断言退化

- 维度：G
- 文件：`apps/mobile/__tests__/atomic-range-delete.test.ts:57,72,119-121`
- 问题：spec 迁移清单要求该文件明文统一补终止符，但 `'x @/a.md y'`、`'帮我看 @/a.md 谢谢'`、`'@a.md 和 $apm-recall'` 仍是旧格式；新正则下 `composerTokenRanges` 返回 `[]`，三条断言（T-AD4 整段覆盖 / 区间外删除 / 多处不连续删）退化成「空区间 → null」，不再检验删除窗与区间的几何关系。
- 改法：补终止符并同步 next 串：`'x @/a.md@ y'` → `'x  y'`；`'帮我看 @/a.md@ 谢谢'`（删末字）；`'@a.md@ 和 $apm-recall$'` → `'a.md@ 和 $apm-recal$'`。
- 验收/测试：三条用例的 `composerTokenRanges(prev)` 非空；把 `tryAtomicRangeDelete` 的「覆盖整段返回 null」判断改错 → T-AD4 红。
- 来源：`review-scope-a`

### scope-a/G-4 [P2] `@a@b@` 伪区间反例无用例

- 维度：G
- 文件：`apps/mobile/__tests__/composer-highlight.test.ts:92-104`
- 问题：spec D1-6 指出 `@a@b@` 是 `isValidTokenRangeText` 必须两步判定的唯一反例，但测试没有该用例；把谓词简化成「长度 ≥3 且首尾同字符」现有测试仍全绿。
- 改法：在 `isValidTokenRangeText` 的 describe 内加 `expect(isValidTokenRangeText('@a@b@', {start:0,end:5})).toBe(false)`；可选补 `$A$B$` 同型与 `start: 0.5`（锁 `Number.isInteger`）。
- 验收/测试：实现改为简单首尾判断 → 该用例红。
- 来源：`review-scope-a`

### scope-a/C-1 [P2] 多处注释仍写旧明文形态

- 维度：C（文档/注释一致性）
- 文件与改法（逐处）：
  - `apps/mobile/src/components/chat/native-composer/token-ranges.ts:12`：`@path → [@path](nmtoken://path)` 改为 `[@path@](nmtoken://path)`；头注释补「LINK 文本保留两端终止符、destination 只留 body」
  - 同文件 `:49-51`：删掉「不动桌面对齐的正则真源」的旧口径，改为 spec 已认的双端形态分叉
  - 同文件 `:73-84`：remap 文档示例改 `$A$` / `$B$`
  - `apps/mobile/src/components/chat/composer-highlight.ts:13`：`@token` / `$token` 改双终止符描述
  - `apps/mobile/src/components/chat/composer-token-insert.ts:27`：`$A$B` 改 `$A$$B$`
  - `apps/mobile/src/components/chat/composer-send-scan.ts:7,66,77,129`：整段注释里的 `$技能名` / `@路径` 改双终止符（发送扫描的明文口径同步）
  - `apps/mobile/src/screens/stack/PromptEditorScreen.tsx:243`：「插入 `$技能名` token」改 `$技能名$`
  - 同文件 `:264`：`@path` token 改 `@path@` token（插入时补尾终止符）
  - `apps/mobile/src/components/chat/useChatComposerController.ts:77`：错别字「保持 maker 稳定」→「保持 marker 稳定」
  - 同文件 `:618`：注释里的旧形态改双终止符
  - `apps/mobile/src/services/session-stream-unit-manager.service.ts:236`：注释里的旧形态改双终止符
  - `apps/mobile/src/components/chat/message-blocks.ts:62`：`pendingSubagentSessions` 的 JSDoc 补一句「命中优先读 `input.sessionId`，title 仅作回退」
  - `useChatComposerController.ts:191-196` 的 `insertTokensIntoComposer` JSDoc：**排在 C-2 定案之后落笔**——若 C-2 选「把补尾 `@` 下沉」，JSDoc 应写「收裸 `@path`，本方法统一补终止符」；若 C-2 选「撤下公开成员」，JSDoc 随之删除。两条不得各写一版。
- 验收/测试：纯注释，typecheck + lint 通过。
- 来源：`review-scope-a`（首轮）；第 2 轮补了 6 处漏项并解掉与 C-2 的冲突（`review-full/fix-spec#5`）

### scope-a/C-2 [P2] `insertTokensIntoComposer` 明文契约变化但仍是公开成员

- 维度：C（职责/fake-public，按 `nm-code-style` §4.1）
- 文件：`apps/mobile/src/components/chat/useChatComposerController.ts:186-197,798-823,859-865`
- 问题：终止符补写放在 `onAtPickerConfirm`（`:862`），而 `insertTokensIntoComposer` 仍是 controller 公开成员、语义已变成「调用方必须给带终止符的完整明文」，JSDoc 却仍写「`@` 侧整 token（含触发符）」。任何按旧契约传裸 `@path` 的调用方会得到「区间已登记、下次水化被判非法丢弃」的静默失效胶囊。生产引用只有 `onAtPickerConfirm` 一处。
- 改法（二选一，推荐前者）：把 `` `${token}@` `` 下沉进 `insertTokensIntoComposer`，`onAtPickerConfirm` 退化为纯转手；或把 `insertTokensIntoComposer` / `insertSkillToken` 从 `ChatComposerController` 接口与返回对象撤下（无外部消费者）。
- 验收/测试：两屏 picker 用例（`use-chat-composer-controller.test.tsx:628-743`、`prompt-editor-screen.test.tsx:595-832`）保持绿；`check-style --changed` 无新增 `INLINE_CANDIDATE` / `FAKE_PUBLIC`。
- 来源：`review-scope-a`

### scope-b/B-2 [P2] 替换分支的两个「不该替换」守卫零覆盖

- 维度：G
- 文件：`apps/mobile/__tests__/session-stream-unit-messages.test.ts`（对照 `session-stream-unit-pipeline.test.ts:319-340`）
- 问题：① 发起型（非消费型）settled 单元收到迟到/重复 `RUN_STARTED` 必须不复活（`session-stream-unit-manager.service.ts:1379` 第一个守卫）；② 消费型但 `status=running`（另一 run 在飞）收到不同 runId 的 `RUN_STARTED` 必须保持原 runId、不重建。现有唯一相关用例是 pipeline 的「running 态同 runId 重复 STARTED」，两个守卫删掉都不红。
- 改法：补两条用例——① `startRun` + STARTED r1 + FINISHED r1 后 `publishStarted('a','r2')` → 仍 finished、partial/metrics 不变；② `publishStarted('kid','r1')` 后 `publishStarted('kid','r2')` → 仍 running 且 `runId==='r1'`。
- 验收/测试：删掉 `!this.consumptiveSessions.has(...)` → ① 红；删掉 `!isSessionStreamUnitSettled(...)` → ② 红。
- 来源：`review-scope-b`

### scope-b/B-3 [P2] 替换条件未判「runId 是否不同」

- 维度：B（防御性缺口）
- 文件：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1374-1391`
- 问题：替换条件只判「consumptive + settled」。同一 runId 的重复 `RUN_STARTED`（本库对「真机回填双发」有防御先例：`session-stream-unit.ts:452-454`、`session-stream-unit-pipeline.test.ts:335`）落在已 settle 的消费型单元上时，会 `removeUnit` 后重建 running 单元，而该 runId 的 FINISHED 已被消费 → 子会话屏永久 running、`activeSessionIds()` 误报、单元不进宽限销毁。core 当前只 publish 一次，概率低，属防御性缺口。
- 改法：替换条件追加 `unit.getRunId() !== payload.runId`（interrupted 单元 runId 为 null 时仍替换，语义不变），并在分支注释里写明理由。
- 验收/测试：consumptive 单元 finished 后 `publishStarted` 同 runId → 保持 finished；不同 runId → 重建 running。
- 来源：`review-scope-b`

### scope-b/B-4 [P2] 新增 catch 的日志 tag 与同文件不一致

- 维度：C
- 文件：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1394`
- 问题：写成 `[novel-master/session-stream-unit]`（那是 unit 模块的 tag），同文件其它日志一律 `[novel-master/session-stream-unit-manager]`，线上按 tag 过滤会漏这条。
- 改法：改为 `[novel-master/session-stream-unit-manager]`。
- 验收/测试：`git grep "reuse tail reload failed"` 前缀与同文件一致。
- 来源：`review-scope-b`

### scope-b/B-5 [P2] 新增行超 prettier 80 列（prettier 是 CI blocking）

- 维度：C（格式/CI 门禁）
- 文件（本轮新增行，共 8 处）：
  - 生产代码：`apps/mobile/src/components/chat/message-blocks.ts:247`、`apps/mobile/src/services/session-stream-unit-manager.service.ts:1379,1393-1394`、`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:97`、`apps/mobile/src/components/chat/composer-highlight.ts:20`、`apps/mobile/src/components/chat/useChatComposerController.ts:79`
  - 测试代码：`apps/mobile/__tests__/message-blocks.test.ts:1280`、`apps/mobile/__tests__/chat-transcript-ref-token.test.ts:182`
  - 夹具：`apps/mobile/__tests__/fixtures/composer-token-cases.json:6-7`（新文件全文入检；被 `composer-highlight.test.ts:1` 直接 import，不在 `.prettierignore`）
- 问题：上述新增行超过 `apps/mobile/.prettierrc.js` 的 printWidth 80；`npm run format:check` 是 `ci.yml:60-61` 的 blocking step。base 已有既存违规，本项要求「新增行不追加欠账」。
- 改法：按 prettier 形态折行这些新增行（manager 的 if 条件与 `void ... .catch`、screen 的 `return (await ...) ?? []`、message-blocks 的三元、composer-highlight 的谓词签名、controller 的行内断言、两处测试断言、夹具的两条 `ranges` 数组）。
- 验收/测试：**逐行比对法**——对本 diff 触达的所有 ts/tsx/json 跑 `npx prettier <file>` 取格式化结果，与 `git diff -U0 <base> -- <file>` 的新增行逐条比对：每个新增行都能在格式化输出中原样找到才算过（只看 `--check` 的通过/失败无法区分既存违规与新增欠账）。
- 来源：`review-scope-b`（首轮）；第 2/3 轮补齐了触达与验收命令（`review-full/fix-spec#3`）

### scope-c/C-1 [P2] 同一「成对终止符」判据在 split 与 render 各写一遍

- 维度：C（DRY）
- 文件：`apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx:118-125,163-167`
- 问题：split 用 `text[end] === trigger && !matchStarts.has(end)` 决定是否消费终止符，render 再用 `length>2 && head===last && ($/@)` 重算一遍；在现有 split 语义下两者完全等价，render 侧重算冗余，且要与 Kotlin `isPairedMark` 手工保持三处同步，阈值/字符集漂移就会出现「split 吃了、render 没裁」或反之。
- 改法：`RefSpan` 增加可选 `displayText`，只在消费终止符时填 `text.slice(match.index + 1, end - 1)`；render 改 `span.displayText ?? span.text`，删掉 `marked` 重算。TS 侧只留 split 一处判据。
- 验收/测试：**需要补 `displayText` 的存量断言只有 `:174-178`（`$写文档$`）、`:183-187`（`@notes/a.md@`）、`:212-214`（`$A$`）**——这三处消费了终止符；`:64-70` / `:85-91` / `:110-116` 的 span 后面跟空格或普通字、**不消费终止符**，不加字段（硬加会把既有用例改红）。渲染断言不变；把阈值从 `>2` 改成 `>=2` 只需改 split 一处。
- 来源：`review-scope-c`（首轮）；第 2 轮修正了「断言不变」的不成立表述（`review-full/fix-spec#4`）

### scope-c/G-1 [P2] 渲染断言只查胶囊标签，不查「整行没有裸终止符」

- 维度：G
- 文件：`apps/mobile/__tests__/chat-transcript-ref-token.test.ts:226-250`
- 问题：`chipLabels` 用 `filter(child => typeof child === 'object')` 只收胶囊子节点，字符串段被丢弃；它证明的是「胶囊标签首尾没有终止符」，不是「气泡文本里没有裸终止符」。若实现出现「span 文本延长但 `cursor` 没推进」（`RefTokenText.tsx:130-131` 两行不对称）或 split 把多余 `$` 落成 text 段，渲染结果是 `写文档` + 裸 `$`，本用例仍绿。
- 改法：把 `vnode.props.children` 拍平（字符串直接拼、对象取 `props.children` 再拼），断言整串严格等于 `'写文档 看 /docs/a.md'`，并追加 `expect(flat).not.toMatch(/[$@]/)`；保留现有 chip label 断言作第二层。
- 验收/测试：把 `RefTokenText.tsx:131` 的 `cursor = end` 改回 `cursor = match.end` → 拍平整串断言红。
- 来源：`review-scope-c`

### scope-c/G-2 [P2] F-A7 第 5 组「新格式相邻」缺失，且新 describe 与既有用例重复

- 维度：G
- 文件：`apps/mobile/__tests__/chat-transcript-ref-token.test.ts:171-224`
- 问题：F-A7 要求「新格式相邻，每颗消费自己的终止符（`$A$$B$` / `@docs/a.md@$写作$`）」没有用例；`matchStarts` 的「正向消费后下一颗仍被处理」分支没有独立牙齿（现有只覆盖「不消费」的负向 `$A$B`）。新 describe 里另重复了两条既有旧格式用例（`:190-207` 与 `:85-102` 同义）。
- 改法：补 `splitRefTokenSpans('$A$$B$', {skills:new Set(['A','B']), paths:new Set()})` 与 `splitRefTokenSpans('@docs/a.md@$写作$', …)`；期望对象**按 C-1 的 `displayText` 口径填写**（这四颗都消费了自己的终止符）：
  - `[{kind:'skill', text:'$A$', displayText:'A'}, {kind:'skill', text:'$B$', displayText:'B'}]`
  - `[{kind:'path', text:'@docs/a.md@', displayText:'docs/a.md'}, {kind:'skill', text:'$写作$', displayText:'写作'}]`
  可选补 `$😀$`（代理对）与 `$A\n$`（跨行不消费）。删掉新 describe 里与既有用例同义的两条（`:190-207` 与 `:85-102`）或注明同义。
- 验收/测试：把 `if (match.index < cursor) continue` 改成 `match.index <= cursor` → `$A$$B$` 用例红（注意：`$A$$B$` 第二条命中起点是 3，`matchStarts.has(2)` 本来就是 false，所以「去掉 `!matchStarts.has(end)`」或「无条件 `end += 1`」红的是既有 `$A$B` 负向用例，不是这条）。
- 来源：`review-scope-c`（首轮）；第 3 轮同步了 `displayText` 期望并修正了变异点（`review-full/new#1,#2`）

### review-full/G-1 [P2] `synthesizeToken` 的「首尾不同字符原样返回」兼容分支零用例

- 维度：G（测试缺口）+ H（旧格式兼容）
- 文件：`apps/mobile/src/components/chat/native-composer/token-ranges.ts:309-312`（守卫）、`apps/mobile/__tests__/native-composer.test.tsx:249,802-830`
- 问题：迁移后所有 `synthesizeTokenMarkdown` / `synthesizeTokenMarkdownFromRanges` 用例都传新格式（`@a/b@`），**删掉 `token[0] !== token[token.length-1]` 仍全绿**。该守卫是「旧格式/半截 token 不被 `slice(1,-1)` 吞掉一个真实字符」的唯一防线（spec D1-3 明确要求，属 H 兼容项）；没有它 `@a/b` 会产出错误 destination。
- 改法：只补一条有效断言 `expect(synthesizeTokenMarkdownFromRanges('正文 @a/b 尾', [{start:3,end:7}])).toBe('正文 @a/b 尾')`。
  **不要**写 `synthesizeTokenMarkdown('正文 @a/b 结尾')`——`COMPOSER_TOKEN_RE` 要求闭合 `@`（`composer-highlight.ts:11`），该串扫不出区间，删不删守卫都返回原文，是恒真断言。
- 验收/测试：删掉 `token.length < 3 || token[0] !== token[token.length-1]` 判定 → 该断言得到 `[@a/b](nmtoken://a/)`（`body = slice(1,-1) = 'a/'`）而红。
- 来源：`review-full`（第 2 轮）；第 3 轮修正了恒真断言（`review-full/fix-spec#7`）

---

## Spec deviations

| 出处 | 条目 | 状态 | 对应 |
|---|---|---|---|
| A spec:204 | F-A3 回滚链正例用例 | open | `scope-a/G-2` |
| A spec:208-213 | F-A7 第 5 组（新格式相邻） | open | `scope-c/G-2` |
| A spec F-A10 | 全屏入口自愈用例 | open | `scope-a/G-1` |
| B spec:143-145 | F-B3 三件副作用断言 + harness 补齐 | open | `scope-b/B-1` |
| B spec:181 | 落地第 4 条 changelog Unreleased 一条 | open | 见 K 节 |
| A spec「已决口径 2 / 风险 2」 + A spec:215（F-A9） | 「胶囊内显示双 `$`」被后续 `a91b3b96c`（Android 绘制层）+ `02608cf37`（转录层）反向实现 | changed | spec 未同步，需在 changelog 与 spec（PRD 口径 2、风险 2、F-A9 三处）补一句「后手已改为不显示`$`/`@`」 |

## Open questions / 待拍板

1. **全屏编辑器是否算「输入框」**：`PromptEditorScreen` 的胶囊由 CodeMirror mark 装饰实现（`composer-tokens.ts:31-43`，覆盖含两端终止符的整段），全屏里仍会看到 `$写文档$` 整段带底色。若需求覆盖全屏，需要另做一次改动。
2. **复制取向不一致**：菜单「复制」走 `editableText`（保留终止符，`useChatTabMessageActions.ts:468-486`），WebView 内长按选中复制拿到 DOM 文本（无终止符）。两路结果不同，是否接受需产品拍板。
3. **不可见终止符与光标**：Kotlin 只改绘制区间，Editable 字符数不变，光标仍可落在 token 内部（原 `end-1` 处）；此时键入会按 remap 语义摘除整颗胶囊，但屏幕上看不出光标在胶囊「里面」。需真机确认吸附行为可接受。
4. **新旧混排歧义**：`$A$B$` 且 A、B 都有附件时，气泡按附件字面量得到 `$A` + `$B$`，composer 正则得到 `$A$` + `B$`。spec 未定义此混排归属，当前为有意分层。
5. **iOS**：patch 只含 Android Kotlin；若未来支持 iOS，需要 ENRM iOS 输入侧等价实现。
6. **F-B5 真机项**：同一子会话连跑两轮、二轮执行中点卡进入看流式——本轮 CR 为只读，未验证。
7. **落点②（`useState` 初始化过滤）无独立断言**：删掉该分支现有测试仍绿（落点①会兜底改正）。spec D1-6 说三个落点缺一不可，是否补一条首帧断言。
8. **空草稿 + 残留旧格式区间**：`syncFromDraft` 写回条件是 `draft.text !== ''`，空文本时坏区间留在 store（每次读都被过滤，无视觉后果，只有反复过滤开销）。是否接受。

## 已豁免（用户确认不修）

（暂无）

## 合并后 QA（manual_user，不阻塞）

- 相邻两颗 skill 胶囊有 ~20px 缝（已真机确认）
- 输入框胶囊只显示名字（已真机确认）
- 气泡胶囊只显示名字 + 老消息原样不误裁（待真机确认）
- `[@alice@](url)` 这类普通链接 label 不被裁剪（随 `scope-c/B-1` 一起验）
- F-A9 真机项：退格整删一颗胶囊（含终止符、不会删一半）、胶囊后继续打字不被吞、相邻两颗 `$A$$B$` 不串味
- F-B5：同子会话连跑两轮，二轮中点卡进入看流式（含孙任务 pending 卡可点）

## K 节建议（下游执行时闭合）

- `changelog` Unreleased 补一条：`mobile: composer / 气泡里的 skill 与 @ 引用胶囊不再显示 $ / @ 终止符（明文不变）`；同时给 A spec 的「已决口径 2 / 风险 2」加一句「后手已改为不显示」。
- C-orch 观察（不升 must-fix）：`startRun`（manager:1184-1203）与 `onRunStarted`（:1383-1391）是同一「旧单元替换吸收」事务的两条平行实现，句柄迁移三行重复；建议至少在两处加交叉引用注释「与另一条替换路径同款，改动需同步」。
- C 观察（不升 must-fix）：manager:1389-1391 的第二次 `markRunning` 在正常路径不可达（`adoptConsumptiveUnit` 里 `begin()` 刚置 starting），要么删掉二次检查、要么在 `adoptConsumptiveUnit` 内显式处理 begin 失败，避免「看似兜底、实际永不触发」。
- 既存问题（不在本 diff，仅登记）：`pendingChildParentByChild` 全仓只写不读。

---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes** |
| fix_spec_path | `docs/Iterations/chat-ux-fixes-2026-10/cr-fix-spec.md` |
| dag_version / review_round | 4 / 4 |
| 评审轮次 | scope-a / scope-b / scope-c 并行（第 1 轮）→ review-full（第 2、3 轮 not-ready）→ review-full（第 4 轮 ready），共 3 次 loop |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 3 / 13（合计 16） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open 5（F-A3、F-A7 第 5 组、F-A10、F-B3、B spec:181 changelog），均已落条目；changed 1（F-A9 / 已决口径 2 / 风险 2）随 K 节补说明 |
| C-orch | ✅ 已查（结论：两条替换路径重复 3 行，登记为 K 节建议，不升 must-fix） |
| C 类合并后 QA | 6 条（含 F-A9、F-B5 真机项），不阻塞 |

---

## 执行记录（2026-10-29）

按本 fix-spec 全部 16 条已落地，逐条变异验证「删掉对应分支测试必须变红」：

| 条目 | 落地 | 变异验证 |
|---|---|---|
| scope-c/B-1 | `RoundedBackgroundSpan` 加 `trimPairedDelimiters`（默认 false），`TokenBackgroundSpan` 默认 true 并透传；补丁按 RULE ④ 重打 | 真机三验（普通链接 label 不裁 / 两种 token 仍只显示名字） |
| scope-a/G-1 | `composer-fullscreen.test.tsx` 新增 T-FS2b / T-FS2c | 删 `ChatTabScreen` 的 `.filter` → T-FS2b 红 ✅ |
| scope-b/B-1 | F-B3 补 delta→注入→STEP→FINISHED（含 `advanceStreamTimers` / `flushAsync`） | 删 runId 回填 → 红 ✅ |
| scope-b/B-2 | 三道守卫各一条用例（发起型 settled / 消费型 running / 同 runId 重复） | 删任一守卫 → 对应用例红 ✅ |
| scope-b/B-3 | `onRunStarted` 替换条件追加 `unit.getRunId() === payload.runId` 早退 | 同上（第三道）✅ |
| scope-b/B-4 | catch 日志 tag 改 `[novel-master/session-stream-unit-manager]` | grep 一致 |
| scope-b/B-5 | 14 个触达文件过 prettier（含夹具 json），`--check` 全绿 | `prettier --check` ✅ |
| scope-a/G-2 | `use-chat-composer-controller.test.tsx` 新增回滚链正例（`帮我$写文档$总结` → `[{2,7}]`） | 正则退回无尾终止符 → 红 ✅（旧负例仍绿，正是它挡不住的那种坏实现） |
| scope-a/G-3 | atomic-range-delete 三条用例补终止符 | 背景区间非空（断言恢复几何检验） |
| scope-a/G-4 | `@a@b@` / `$A$B$` / 浮点下标三条反例 | 谓词简化成「首尾同字符」→ 红 ✅ |
| scope-a/C-1 | 12 处注释/文档统一到双终止符口径（含 `composer-send-scan`、manager、message-blocks JSDoc） | 无行为变更 |
| scope-a/C-2 | 尾 `@` 下沉进 `insertTokensIntoComposer`，`onAtPickerConfirm` 退化为转手；契约与 `insertSkillToken` 对称 | 两屏 picker 用例保持绿 ✅ |
| scope-c/C-1 | `RefSpan` 增可选 `displayText`，render 侧判据删除（单判据） | 阈值/判据只此一处 |
| scope-c/G-1 | 渲染断言改「拍平整串 + 不含 `[$@]`」两层 | `cursor = end` 改回 `match.end` → 红 ✅ |
| scope-c/G-2 | `$A$$B$` / `@docs/a.md@$写作$` 两条相邻正例 | `match.index <= cursor` → 红 ✅ |
| review-full/G-1 | `synthesizeTokenMarkdownFromRanges('正文 @a/b 尾', [{3,7}])` 原样返回 | 删首尾同字符守卫 → 红 ✅ |
| K 节 | CHANGELOG 增 `[Unreleased]` 三条；A spec 的 F-A9 / 风险 2 补「后手已改为不显示」 | — |
