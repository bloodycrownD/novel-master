# CR Fix Spec: ui-card-unify-2026-10（工具卡统一化六项改动）

## 元信息

- repo：D:\Dev\nm\ucu（worktree，分支 feat/ui-card-unify-2026-10）
- base_sha：1774d0eb27fc1e13e299863d3a219825c48d2b28 / head_sha：bc7855477（78 文件，+3692/−4900）
- prd_path：docs/Iterations/ui-card-unify-2026-10/prd.md（worktree）
- spec_path：docs/Iterations/ui-card-unify-2026-10/spec.md（worktree，含执行留痕与 S10 e2e 留痕）
- review_round：4 / dag_version：5（spec-check-loop：r1 No-Go P1×6+P2×7 → v2；r2 No-Go P2-4 矛盾×3+行号×5 → v3；r3 No-Go 文案口径×1+卫生×4 → v4；r4 **Go** + 措辞×4 顺手闭合 → v5 终版）
- 状态：execute-ready（r4 judge Go；待用户确认开工）
- 评审方式备注：CR 轮 core=子代理证据包+三模块手工审查；fix-spec 第 1 轮 spec-check 由 readonly judge 子代理对照代码库逐条核验（P1×6+P2×7，本版全部吸收）。

## Must-fix（按 P0 → P1 → P2）

### webview/P0-1 [P0] 单卡展开键双重前缀不自洽——A4「点卡=展开」在 mobile webview 上不工作
- 维度：B（正确性）+ C-orch（渲染/委托两端键约定脱节）+ G（测试与真实 DOM 脱节）
- 文件：apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx:167-168（属性挂载处）；runtime/render/rows-click.ts:50-63（不改）；__tests__/webview-tool-card-expand.test.ts:175-187（断言侧）
- 问题：渲染侧把**完整 cardKey**（`cardKeyFor` = `groupKey + ':' + (toolUseId || index)`）挂进 `data-tool-use-id`；点击侧 rows-click 把该属性值当**纯 toolUseId** 再拼 groupKey → 写入 `gk:gk:id`，渲染读取 `gk:id` → 永不命中 → 点卡只有按压涟漪、永不展开，diff/入参预览/结果正文（全在展开体内）全部不可见。ToolGroup.tsx:34-36 注释自称「与 rows-click 拼法逐字同款」与代码矛盾。
  证据链（三方）：①静态代码；②dist 产物（android assets/ios WebViewDist/webview-dist 三处）同款；③模拟器实测点卡无展开体灰底（像素扫描）、S10 e2e diff 截图复扫 0 红 0 绿像素（S10「展开/diff PASS」两条系视觉判定幻觉，见 K-1）。
  测试为何全绿：委托用例在手工 fake DOM 上挂**纯 id**（与真实渲染脱节）验对了拼接逻辑，:186 容器断言又锁的是完整键——同一文件两种约定，真链路断裂无人红。
- 改法：统一约定「**DOM 属性挂纯 id，点击侧拼前缀**」。①ToolGroup.tsx:168 改 `data-tool-use-id={tool.toolUseId || String(index)}`（与 cardKeyFor 的 id 部分逐字同源；展开态读取键 cardKeyFor 不动；序号 fallback 保持现状，漂移风险记 open question 4）；②rows-click.ts **零改动**（spec.md:60「三条跳转分支零改动」口径）；③ToolGroup.tsx:34-36 注释改为「属性挂纯 id，rows-click 拼前缀，cardKeyFor 仅用于展开态 map 读取」。closest 分层不受影响（入口行 data-action 更近，:86/:97/:109；section 祖先挂 data-tool-group-key，CollapsibleSection.tsx:74）。
- 验收/测试：
  1. webview-tool-card-expand.test.ts **:175-187 段**更新：**:175** 标题括注「（e2e 单卡主键）」改为「（组内 id，需与 group-key 组合定位）」（与 deviation 3 口径对齐）；**:184** 标题「key 仍与委托层同形」**可保留不动**（改后委托层拼出的 `gk:0` 与 cardKeyFor 仍同形）；**:181** 断言 `'msg:a1:tu-9'` → `'tu-9'`、**:186** 断言 `'msg:a1:0'` → `'0'`。**注意：:70-80 的 clickToggleToolCard fake 本就挂纯 id，无需改动**（勿动）。
  2. 新增「键约定两端同源」集成用例（本仓无 jsdom、既有测试全是 vnode 直调——照此形态写）：用现有渲染辅助函数取 ToolGroup 卡容器 vnode → 读 `props['data-action']`/`props['data-tool-use-id']` → 把这两个值灌进 `makeEl` fake（祖先链含带 `data-tool-group-key` 的 section）→ 调 `onRowsClick` → 断言 `state.toolCardExpanded` 的键等于渲染侧 `cardKeyFor` 同款（`'msg:a1:tu-9'`）**且**把该 map 作为 `toolCardExpanded` 传入后卡 vnode 内出现 `tool-card-body`。此用例锁住「以后改渲染或委托任一边都会红」。
  3. 模拟器 e2e 复验（顺序硬性）：先 `cd apps/mobile && npm run build:webview -- --copy-native` 重建三处 dist（android assets/ios WebViewDist/webview-dist 均未入库、只改 src 不重建则装机包仍旧键、复验必假红）→ grep 产物确认 `data-tool-use-id` 已为纯 id 形态（三个具体目标：`apps/mobile/webview-dist/chat-conversation/app.js`、`apps/mobile/android/app/src/main/assets/webview/chat-conversation/app.js`、`apps/mobile/ios/NovelMaster/WebViewDist/chat-conversation/app.js`——注意产物包 id 是 `chat-conversation`、不是源码目录名 `chat-transcript`）→ 按 AGENTS.md 硬规则 Metro 真实路径起 + `adb reverse tcp:8081` + `adb install -r -d`（禁止内嵌 bundle、禁止卸载）→ 点收起卡：展开体（入参 pre/结果/diff）可见，edit 卡 diff 红/绿行做**像素级**验证（红调/绿调背景行存在）。
  4. 既有 12 条用例+4 变异证据全绿；build:webview 门 B/C 过；mobile tsc 0 错。
- 来源：CR 主代理手工审查；spec-check r1 judge 核验改法成立（P0 诊断与改法正确），验收②③按 r1 意见改为可落地形态。

### desktop/P2-1 [P2] 入口行文案双端不一致——desktop「查看文件 ·」不带路径
- 维度：C-orch（双端 parity）；涉 spec 措辞偏差（见 Spec deviations 新增第 2 条）
- 文件：apps/desktop/renderer/features/chat/ToolCallCard.tsx:57-68（entryLabel）、:136-145（渲染）；连带 apps/desktop/test/tool-call-card.test.tsx:224/:234/:243/:263（四条**全等**断言必红）
- 问题：mobile webview 入口行渲染「查看文件 · /test.md」「子会话 · id」「技能详情 · name」（ToolGroup.tsx:89/100/114），desktop 只渲染「查看文件 ·」等孤立前缀——同一规格层 primaryAction 双端文案不一致，desktop 用户无法确认将打开哪个文件/会话/技能。
- 改法：入口行渲染 `{label} {标识符}`——file→`view.primaryAction.path`、subagent→`view.primaryAction.sessionId`、skill→`view.primaryAction.skillRef?.name`（三字段均在 `ToolCardPrimaryAction` 类型上）。
- 验收/测试：tool-call-card.test.tsx **四条必红断言连带更新**：:224「查看文件 ·」→ 断言含路径（实际夹具路径为 `/novel/ch1.md`，如 `assert.match(text, /查看文件 · \/novel\/ch1\.md$/)`）；:234 子会话含 sessionId；:243 技能详情含 name；:263 同 :224（同夹具）。双端 parity 以**各自锚定断言**（`/前缀 · 标识符$/` 同构 match）形成口径锁——desktop 单包内无法 import mobile 的 tsx 渲染，跨包字面对照不设硬用例（修复时按此口径落地）。
- 来源：CR 手工审查；spec-check r1（必红断言清单+deviation 补录）。

### desktop/P2-2 [P2] div role="button" 缺键盘处理（Enter/Space 不可达）
- 维度：H（可访问性/UI）
- 文件：apps/desktop/renderer/features/chat/ToolCallCard.tsx:118-126
- 问题：卡容器声明 `role="button" tabIndex={0} aria-expanded` 但无 onKeyDown——键盘焦点进入后 Enter/Space 不触发展开，ARIA 语义与实际行为不符。
- 改法：加 `onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}`。**target 守卫必须有**：入口行是卡内的真 `<button>`，其 keydown 会冒泡到卡容器——无守卫时入口行聚焦按 Enter 会「既跳转又展开」双触发、Space 会被 preventDefault 拦掉跳转。
- 验收/测试：tool-call-card.test.tsx 补两条（该文件用 react-test-renderer、不派发真事件——新增 `keyDown(node, {key, target, currentTarget, preventDefault})` 手工构造辅助）：①卡容器 keyDown Enter（target=currentTarget=卡节点）→ 展开；②入口行聚焦时 keyDown Enter（**target=入口行节点、currentTarget=卡容器节点**，显式模拟冒泡）→ 展开态**不变**（只有跳转回调）。
- 来源：CR 手工审查；spec-check r1（target 守卫+第二条验收）。

### webview/P2-3 [P2] EntryRow skill 分支非空断言 `action.skillRef!`
- 维度：B（类型契约）
- 文件：apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx:105
- 问题：`const ref = action.skillRef!` 掩盖契约破坏时的退化（渲染 undefined 属性）；同函数 file/subagent 分支均直读无断言。
- 改法：分支内先判空：`const ref = action.skillRef; if (ref == null) return null;`。
- 验收/测试：webview-tool-card-expand 既有入口行用例全绿（行为无变化，不新增）。
- 来源：CR 手工审查。

### both/P2-4 [P2] diff 截断的双端展示 parity：双端都截丢 core「共 N 行」尾行；desktop truncated 提示与 core 尾行冗余
- 维度：B + C-orch（双端 parity）
- 文件：apps/mobile/.../ToolGroup.tsx:122-143（DiffBody）；apps/desktop/.../ToolCallCard.tsx:170-199（renderDiff）；core tool-card-view.ts:278-296（buildWholeBlockRows，不改）
- 问题（按真实分支）：core 整块降级产出 rows=40 del+「…共 N 行」+40 add+「…共 N 行」（共 82 行）。**双端同样 slice(0,60)**：82 行场景下 add 侧「共 N 行」（index 81）被截掉——只见删侧计数不见增侧计数；mobile/desktop 截断提示文案各自为政。另一冗余源：desktop :191-196 的 `truncated` 分支提示「…diff 过大，已按整块显示」仅在 `truncated && !clipped`（rows≤60，如单侧 1001 行触发降级后 42 行）时出现，与 core 已给的「共 N 行」尾行同义重复（该场景 del 侧计数在 index 40 恒可见，删分支不丢信息）。
- 改法（双端**对称**的确定式）：
  1. **mobile**：`shown = rows.length > DIFF_ROW_LIMIT ? [...rows.slice(0, DIFF_ROW_LIMIT - 1), rows[rows.length - 1]] : rows`（超限时携带末行——降级时末行恒为「共 N 行」提示行，非降级时是普通行，两种分支文案统一用「与末行」表述、不区分）；截断提示「…diff 仅显示首 59 行与末行，另有 N 行」；**hidden 在提示行渲染之前按 `rows.length - shown.length` 计算**（渲染 60 行 → hidden=rows.length-60；82 行场景=22）。非降级超限 diff 末行是普通行，计数口径同形无害。
  2. **desktop**：与 mobile 同款对称切片（`visible` 超限时 `slice(0,59)+末行`）+ `truncated` 分支**整体删除**（信任 core 尾行），提示行仅 `clipped` 时渲染，文案与 mobile 统一口径：「…diff 共 M 行，已显示首 59 行与末行」。
- 验收/测试：
  1. 既有回归锁 **:399-402（80+80 行→160 行、truncated=false）**：数量断言（160/60 相关）不变；`:402` 的 `/前 60 行/` 文案断言随改法②**同步更新**为匹配新文案（如 `/首 59 行/`）——该用例同时是「删 truncated 分支无回归」的显式证据。
  2. 双端各补降级态用例（夹具口径写死其一）：①每侧 **1001 行**（触发行数熔断→82 行 truncated=true）；或 ②每侧 50 行、每行 ~2500 字符（两侧中段字符合计 >200_000 触发字符熔断→82 行）——**注意「两侧 >40 行」本身不触发降级**（40 行截块只是降级后的产物形态），夹具必须经 `buildToolCardView`/`buildEditDiffRows` 真路径拿到 `truncated=true`。断言**按端拆口径**：desktop 断「共 M 行 == rows.length（82）且首 59 行+末行可见、无重复提示行」；mobile 断「两条『共 N 行』计数行均可见（末行被携带）且『另有 N 行』== rows.length−60（22）」。
  3. mobile 补：非降级超 60 行 diff 的截断提示行数口径断言（60 渲染/hidden 差一保护）。
- 来源：CR 手工审查；spec-check r1 修正事实陈述、r2 修正 desktop 缺对称切片+hidden 差一+降级夹具口径。

### desktop/P2-5 [P2] diff-del/diff-add 背景取色手法统一
- 维度：C（风格一致性）
- 文件：apps/desktop/renderer/styles/shell.css:6527-6535
- 问题：`.diff-del` 用 `var(--danger-bg, rgba(...))`、`.diff-add` 用 `color-mix(...)`——但 `--danger-bg`/`--danger-bg-hover` **全仓从未在 :root 定义**（仅 :3474/:3480/:6528 三处当 var()+fallback 用，实际恒走 fallback）；`--success-bg` 同样不存在。现状是「del 走假变量真 fallback、add 现场算」的不对称。
- 改法（二选一已定）：**两侧统一 color-mix、删掉假变量**——`.diff-del` 改 `background: color-mix(in srgb, var(--danger) 10%, transparent)`（与 add 的 14% 透明度按深浅主题目测微调对齐），不新增主题变量、不动 :3474/:3480 两处既有 fallback 点（它们另有语义，超出本条范围）。
- 验收/测试：无既有 CSS 断言链；双主题目测（真机验收顺带）。
- 来源：CR 手工审查；spec-check r1 修正前提（--danger-bg 全仓未定义，原「补 --success-bg」方案会造成反向不对称）。

## G 维测试缺口（随上述条目执行时补齐；口径已按 spec-check r1 修正）

- buildEditDiffRows **字符边界**：恰好 200_000（不熔断）/200_001（熔断）——按实现口径「剥离公共前后缀后的中段两侧行字符合计、不含换行」计量（呼应 Spec deviations 第 1 条）；现测试只测 480k 大超限。
- **行数边界只补 1_001**（熔断）——恰 1_000 不熔断**已由 T-TC5-6 锁定**（tool-card-view.test.ts:440-450，`truncated===false`、`rows.length===2000`），勿重复补。
- edit 卡 `input: null`（经 buildToolCardView 路径：不抛错；`view.diff` 为 `{rows: [], truncated: false}` 而非 undefined——实现 :443-448 对非 pending 的 edit 恒赋值 diff，空串两侧走「中段皆空」分支。修复时按实现断言，T-TC5-13 注释已标明）。
- oldString/newString **单边缺失**（缺侧按空串、对侧整块；经 buildToolCardView 路径）。
- stripCommonAffixes 公共前后缀相接（一侧是另一侧前缀）时中段正确。
- `buildInputPreview` 的 `JSON.stringify` 抛错分支（core :190-193，不可序列化 input 的防御路径）。
- **已评估不补**：「仅 failureReason、无 resultContent/ok」的卡被 resolveStatus 判成 success——精确可达条件是 `ok === undefined && failureReason != null`（即 pending+带 failureReason）；而 failureReason 来自 `result.meta`（隐含已有 result → status 不会停留在 pending），双端调用方也恒由 status 派生 ok（desktop okFromStatus / webview buildView），故实际不可达；规格层行为与其注释自洽。若未来新增第三端调用方或 failureReason 出现非 meta 来源，需重评。

## Spec deviations

- open（措辞级，第 1 条）：A7 熔断字符口径——spec 写「old+new 合计 > 200_000 字符」，实现为「剥离公共前后缀后的中段两侧行字符合计（不含换行）」（tool-card-view.ts:362-371 注释自洽、作用域与熔断设计一致）。建议 spec A7 措辞补「以剥离后中段计、不含换行」收窄——需用户确认（不阻塞，实现保留）。
- open（措辞级，第 2 条，spec-check r1 新增）：spec.md:59 把入口行文案写死为「查看文件 ·」「子会话 ·」「技能详情 ·」（无标识符），mobile 实现已多渲染标识符、desktop/P2-1 将向「带标识符」靠拢——等于双端共同偏离 spec 原文案。建议 spec A4/A9 相关句同步补「入口行文案为 前缀 · 标识符」收窄——需用户确认。
- open（措辞级，第 3 条，spec-check r2 新增）：spec.md:62（A4 段末条）写「单卡选择器以 `[data-tool-use-id]` 为主键」——P0-1 改纯 id 后该属性为**组内 id**，跨组唯一性由 `data-tool-group-key` + 该属性组合保证（desktop ToolCallCard.tsx:120 本就挂纯 id，方向一致；全仓无其它消费者，e2e/scripts 无引用）。建议 spec 措辞同步补「组内 id + 组合键唯一」——需用户确认。
- 既有六条（业务 spec 执行留痕）已裁定，无新增。

## Open questions / 待拍板

1. diff 无上下文行：buildEditDiffRows 只输出 del/add，无 equal 上下文行——用户原始诉求「像 git inline 对比」（git inline 含 ±3 上下文行），spec A7 未定。**成本面**：不是纯 UI 改动——需扩 core `ToolCardDiffRow` 的 kind 联合（:67-70 现只有 `del|add`）+ 双端薄壳渲染分支 + 可能触门 B/C 基线与既有 diff 断言返工。待用户拍板做否。
2. 「…共 N 行」尾行沿用所在侧 kind（红/绿背景）——中性信息被染色，观感是否接受（真机验收顺带）。
3. buildSummaryText 判空用 `summary.trim()` 但返回不 trim 原串——极微，接受或顺手 trim 待拍板。
4. toolUseId 缺省时序号 fallback 键漂移：pending 期（task 工具 meta 未落库）用 index 作键，id 到位后键变化、该卡展开态丢失。低频；P0-1 修复保持现状。是否稳定化（pending 期禁 toggle 或稳定位次）待拍板。

## 已豁免（用户确认不修）

（无）

## 合并后 QA（manual_user）

- 真机（荣耀 DSLDU20407006179）浅色：工具卡展开体/diff 红绿行观感、入口行文案含路径、深色 diff 可读性。
- S11 原计划项照旧：workplace 文件列表观感拍板、展开大结果卡滚动无跳变、附件 500k 链路抽查、skill load 新跳转（deviation 6 项）。

## K 节建议（下游执行时闭合）

1. **K-1（必做，文档修正）**：S10 e2e 留痕与主仓记忆中「点卡展开 PASS」「edit diff 渲染 PASS」两条结论失真（视觉判定幻觉，像素级证伪）——P0-1 修复+复验通过后同步修正：worktree spec 执行留痕 S10 段、主仓记忆 S10 轮记录。表述要点：「查看文件跳转/入口行存在/R2 入口移除/提示词页观感」四条**保留 PASS**——依据是入口行在 **expanded 三元之外、收起态即渲染**（ToolGroup.tsx EntryRow 调用点，勿写死行号）+ 跳转与观感有 DOM/像素客观佐证；「入口行存在」的表述必须是「收起态即渲染」，不得残留「展开后可见」的措辞（那不构成证据）。
2. **K-2**：主仓记忆补「analyze_image 视觉判定在高暗示 prompt 下会确认偏误式幻觉——e2e 判定必须像素级/DOM 级佐证」流程教训。
3. **K-3**：全部条目执行后跑门禁（与 dev-loop 终态口径一致；注意 runner 差异）：mobile 走 jest（webview-tool-card-expand、boot-script，文件在 `apps/mobile/__tests__/`）；desktop 与 core 走 `node scripts/run-tests.mjs`（node:test runner，非 jest——desktop 的 tool-call-card.test.tsx 在 `apps/desktop/test/`、core 的 tool-card-view.test.ts 在 `packages/core/test/chat/`）；build:webview 门 B/C；mobile/desktop tsc。
4. **K-4**：`git status` 收尾确认无调试残留（本 CR 与文档审查轮均未改实现代码）。

## 修复执行留痕（dev-loop 终态，2026-10-04）

- wave-0 三组并行 impl（子代理）：webview（P0-1+P2-3+P2-4 mobile，含变异红绿证据）/desktop（P2-1+P2-2+P2-4+P2-5）/core（G 六条，29→35 用例）。
- wave-1 verify（主代理直跑）：build:webview --copy-native 门 B/C 全 GREEN+三落点拷贝、产物 grep 确认纯 id 形态；mobile 全量 2130 例 13 红=7 套件并发争抢 flake（metric-detail-sheet 单跑 7/7 绿）+batch-delete 5 红 stash 对照同红（既有账），**本轮新增红 0**；desktop 全量 exit 0；core 全量 10 红与 dev-loop 终态口径逐批一致；mobile typecheck 三道绿、desktop ratchet 73 条 stash 前后同=既有欠账。
- wave-2 cr-func：首轮 no（缺 P2-4 验收③非降级用例+mobile 入口行锚定）→ 主代理补 2 处（定向 15/15 绿）→ 复核 **func-ready: yes**。
- 实现事实回填两处：G 段 input=null 时 `view.diff={rows:[],truncated:false}` 非 undefined（T-TC5-13 注释标明）；P2-1 跨端 parity 以双端锚定断言落地（desktop 无法 import mobile tsx）。
- e2e 复验与 K-1/K-2：见下方「e2e 复验留痕」。

## Fix-Spec Closure

| 项 | 状态 |
| execute-ready | yes（spec-check r4 judge Go） |
| fix_spec_path | docs/Iterations/ui-card-unify-2026-10/cr-fix-spec.md（主仓） |
| spec-check 轮次 / CR dag_version | 4 轮（No-Go×3 → Go）/ 5 |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 0 / 5 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open 3（均为措辞级：A7 熔断计量口径 / 入口行文案带标识符 / data-tool-use-id 组合键唯一——均待用户确认收窄）+ 既有六条已裁定 |
| C-orch | ✅（P0-1 即键约定两端脱节的 C-orch 失败案例；规格层单源消费、删除面零残留已核） |
| C 类合并后 QA | 见「合并后 QA」节，不阻塞 |
| 评审方式 | CR 轮：core=子代理证据包+三模块手工审查；spec-check r1-r4：judge 子代理逐轮对照代码库核验（r4 全量行号/算术复核通过） |
