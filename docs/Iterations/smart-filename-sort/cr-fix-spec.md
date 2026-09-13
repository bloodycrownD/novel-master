# CR Fix Spec: 文件名智能排序（smart-filename-sort）评审修复说明书

## 元信息

- repo：novel-master（worktree `.worktree/smart-filename-sort`）
- base_sha：76c03550（origin/main v1.5.16）
- head_sha：fa485f10
- prd_path：docs/Iterations/smart-filename-sort/prd.md
- spec_path：docs/Iterations/smart-filename-sort/spec.md
- review_round：4（第 4 轮新增量批次：capture_kind 三档 / 编辑屏重构终态 / IPC match 通道 / VFS 文件名校验 / ownerRouteKey 归属过滤；三 scope 并行评审）
- dag_version：4
- 状态：**已执行完成**（2026-09-13 round 4 增量 16 条全闭合：wave1 impl-core 5 commits（8b69603b/20318efd/41d11000/7d3b12b0/e2ed49dc）+ wave2 impl-mobile 4 commits（310c5f1a/b49674a9/56d1c57e/ff8c83fd）+ impl-desktop 3 commits（3ce5d315/38a38a81/d3e3b5b1）+ impl-cli 1 commit（53c7d8d4）= 13 commits；终验 core 2078/2078、mobile 1156/1156、CLI sort-rule e2e 7/7、desktop typecheck 过 + 480/484（4 个失败套件均为 Secret Service keyring 环境性签名、测试文件属 v1.4.21 既有、与本批改动无关，节点执行期同命令两轮全绿）；K 节 glob 修复/spec 勘误/VFS 补章同批闭合）（round 4 新增 15 条 = 2 P1 + 13 P2 + 终审 #16；round 1-3 旧 11 条保持执行完成态不动）
- 历史轮次：round 1-3 覆盖 b442d397 → 4f84da40（含 merge-dev 适配 core/B-3 [P0]），旧 11 条已全部执行并经 cr-func-fix-review 复核 func-ready。

---

## Round 1-3 must-fix（已执行完成态，共 11 条，保持不动）

以下为 round 1-3 的执行完成态记录，仅作下游引用与回归基线，本条目区不再改动（mc/C-2 例外，追加一条状态注记）。

### core/B-1 [P1] 懒加载条件与排序消费端口径不一致，disabled+smart 目录出现第三种行为形态
- 维度：B + C-orch
- 文件：packages/core/src/service/workplace/impl/workplace.service.ts:267-270
- 问题：懒加载规则时的过滤条件是 `r.ruleEnabled && r.sortField === "smart"`，而排序消费端（sortFilesForDir / sortDirPaths）的基线口径只看 `sortField === "smart"`、不看 ruleEnabled。两边口径不一致导致：目录配置了 smart 排序、规则存在但被禁用时，拿到的是空规则集，退化成自然排序——既不是「按智能规则排」也不是「明确回落 name 字典序」的第三种行为形态。
- 改法：懒加载条件去掉 `ruleEnabled`，改为 `rules.some(r => r.sortField === "smart")` 即触发规则加载；相关注释同步更新，说明与排序消费端共用同一基线口径（是否启用由规则编译结果决定，不由加载侧预过滤）。
- 验收/测试：补用例断言同一规则集下 ruleEnabled 为 true / false 两种状态排序输出一致；且 disabled+smart 目录的排序结果 ≠ 按 name 字典序（证明未退化成自然排序）。
- 来源：review_round 1 · core scope 评审

### core/B-2 [P1] resetDefaults 对用户规则交错重排，违反 PRD「恢复默认不影响用户规则」
- 维度：B
- 文件：packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:247-271（resetDefaults）
- 问题：resetDefaults 删除 builtin 规则后重灌写死 sortOrder 1..4，随后 renumber(listOrdered()) 按 rule_id 决胜重排全表。当用户规则已被 move 到置顶位置时，sort_order 撞号使 listOrdered 按 rule_id 隐式决胜，用户规则与重灌的 builtin 规则交错排列、置顶语义被打破——违反 PRD「恢复默认不影响用户规则」的承诺。
- 改法：删除 builtin 前先记录 userRules（非 builtin 规则，按 listOrdered 取其相对顺序）；重灌 builtin 后显式按 [builtin 种子序, ...userRules 相对序] renumerate 全表，不再用 listOrdered 兜底重排。保证 builtin 恒在前 4 位、用户规则保持原有相对顺序。
- 验收/测试：T-SR2 扩展——补 moveRule(user, "top") 后执行 resetDefaults，断言最终顺序为 [builtin×4, user] 且 sort_order 连续 1..N。
- 来源：review_round 1 · core scope 评审

### desktop/B-1 [P1] 规则列表加载失败被静默吞，空态文案误导
- 维度：B
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:1937-1944（SmartSortRulesView.reload）
- 问题：reload 里只处理了 `res.ok` 分支，请求失败时静默吞掉，列表保持空并显示「暂无规则」——把「加载失败」伪装成「没有规则」误导用户；与同文件 RegexRulesView 失败时 toastSettingsError 的既有惯例不一致。
- 改法：`!res.ok` 时调用 toastSettingsError 提示，并引入加载失败态（loadFailed state，或空态文案区分「加载失败，请重试」），与 RegexRulesView 的错误处理惯例对齐。
- 验收/测试：构造 list 返回 ok:false 的场景，断言出错误 toast 且空态文案不是「暂无规则」。
- 来源：review_round 1 · desktop scope 评审

### core/C-1 [P2] flags 校验双实现，drift 风险
- 维度：C（DRY）
- 文件：packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts:16-27；packages/core/src/domain/smart-sort-rule/logic/compile-smart-sort-rule.ts:52-61
- 问题：flags 合法性校验存在两份实现——schema 层 zod 的 assertFlagsValid 与 logic 层 validate 联手写的重复校验，同一输入跑两遍，且两处规则漂移（drift）时行为分叉无一致性保障。
- 改法：validateSmartSortRuleDraft 复用 schema 层的 assertFlagsValid（或将其提到两处共享的位置），删除联手写实现；错误信息保持 INVALID_ARGUMENT 口径不变。
- 验收/测试：T-SR4 全绿且行为零变化（非法 flags 用例照旧被拒）。
- 来源：review_round 1 · core scope 评审

### core/C-2 [P2] 工厂内联「listOrdered→filter→compile」与 service.listCompiledRules 等价双实现
- 维度：C-orch（DRY）
- 文件：packages/core/src/service/workplace/create-workplace-service.ts:31-39
- 问题：工厂内联了「listOrdered → filter enabled → compile」的装配逻辑，与 smartSortRuleService.listCompiledRules 的语义完全等价，属平行装配入口——一处改口径另一处不知（core/B-1 正是这类分叉的实例）。
- 改法：工厂内先建 `smartSortRuleService = createSmartSortRuleService(conn)`，provider 改为 `() => service.listCompiledRules()`（二者无循环依赖，可直接注入）。
- 验收/测试：T-WE3 系全部全绿。
- 来源：review_round 1 · core scope 评审

### desktop/B-2 [P2] 编辑器 list effect 对缺失 ruleId 静默空草稿，save 必然失败
- 维度：B
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2474-2492（编辑器 list effect）
- 问题：editingSmartSortRuleId 在 list 中 find 不到时（规则已被删除），静默落到空草稿：界面标题显示「新规则」，但 save 仍按 update 语义提交必然失败，预览草稿也永不参与——界面文案与实际行为矛盾。
- 改法（推荐前者）：find 失败时 toast「规则不存在或已被删除」并清空 editingSmartSortRuleId 回退到新建语义；或 nav.pop() 退出编辑器。
- 验收/测试：构造 ruleId 缺失场景，断言出提示且 save 不再必然失败（走 create 语义）。
- 来源：review_round 1 · desktop scope 评审

### desktop/C-1 [P2] 拖拽 setData 后全链不 getData，与仓库既有惯例分叉
- 维度：C（惯例）
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2106-2125、2238
- 问题：HTML5 拖拽在 dragstart 里 `setData("text/plain")` 之后，整条链路从不 `getData`，源行 id 依赖 state 闭包传递——setData 成了半死代码；与 WorkspaceTree.tsx:174（drop 时优先 dataTransfer.getData、state 兜底）的既有惯例分叉。
- 改法：handleDrop 增加 event 参数，源 id 优先 `e.dataTransfer.getData("text/plain")` 读取、state 闭包兜底，向 WorkspaceTree 惯例看齐。
- 验收/测试：拖拽调序行为不变（手动验证，见「合并后 QA」）。
- 来源：review_round 1 · desktop scope 评审

### mc/A-1 [P2] CLI list TSV 列序与 spec Step 9 钉死顺序不符
- 维度：A
- 文件：apps/cli/src/sort-rule/commands.ts:53-57
- 问题：实现列序为 order⇥id⇥enabled⇥name⇥pattern⇥flags，spec Step 9 明确钉死为 order⇥id⇥enabled⇥flags⇥name⇥pattern——flags 与 name/pattern 位置对调，属 spec 偏离。
- 改法：列序调整回 spec 钉死顺序 order⇥id⇥enabled⇥flags⇥name⇥pattern。
- 验收/测试：e2e 第一个用例补列序断言——cols[4] 为 flags、cols[5] 为 pattern，用内置规则值验证。
- 来源：review_round 1 · mc scope 评审

### mc/C-1 [P2] move --to <N> 的 0 基/1 基口径与 list 输出打架
- 维度：B + C
- 文件：apps/cli/src/sort-rule/commands.ts:34-40、118-131
- 问题：`move --to <N>` 把 N 直通 core 的 0 基 index，而 list 输出的 order 列是 1 基 sortOrder——用户看 list 后执行 `--to 1` 实际落在第二位，两个口径互相打架。
- 改法（已拍板方案①，含第 2 轮增补）：CLI 层做 1 基解释，转换为 `{index: N-1}` 再调 core；`parseMoveTarget` 数字分支改 `/^[1-9]d*$/`（或显式校验 N≥1），`--to 0` 报 invalid 而非静默被 core clamp 吞掉；usage/help 与 invalid 错误文案标注「N 为 1 基位次」。
- 验收/测试：e2e 补 `move --to 1` 用例，断言规则最终位次为第一位（与 list 输出 1 基口径一致）；补 `--to 0` 报错断言（非零退出）。
- 来源：review_round 1 · mc scope 评审

### mc/C-2 [P2] 拖拽兜底行中心与兜底边界算法双源
- 维度：C（DRY）
- 文件：apps/mobile/src/screens/stack/SmartSortRulesScreen.tsx:195；apps/mobile/src/screens/stack/smart-sort-drag.ts:113-120
- 问题：拖拽动画的兜底行中心在屏幕侧硬编码 96，而兜底边界在 smart-sort-drag.ts 用「平均步长」推算——两个兜底源用了不同算法，行高或布局变化时两处漂移不同步。
- 改法：smart-sort-drag.ts 导出单一 `fallbackRowCenter(from, dy)`（与 computeBoundaries 共用步长来源与 96 常量），SmartSortRulesScreen 改调该函数，删除本地硬编码。
- 验收/测试：smart-sort-drag.test.ts 补同源断言（fallbackRowCenter 与 computeBoundaries 的兜底值同源一致）。
- 来源：review_round 1 · mc scope 评审
- 状态注记（round 4 追加）：随 D8 拖拽移除自然失效，目标文件已不存在（smart-sort-drag.ts 已删除，无需任何后续动作）。

### core/B-3 [P0] L1 评估链缓存签名不含 smart_sort_rule 表——改智能规则后排序不刷新
- 维度：B（正确性）+ C-orch
- 文件：packages/core/src/service/workplace/impl/workplace-view-cache.ts、packages/core/src/service/workplace/impl/workplace.service.ts（签名采样处）
- 问题：dev 新增的 L1 缓存（27be71c4）读时校验签名是二元组 `{vfs, rules}`（vfs 聚合签名 + workplace_dir_rule 表指纹），smart_sort_rule 表不在签名内。目录规则选 smart 后评估结果（含 smart 排序）被缓存，用户在管理页增删改/启停/调序智能规则后签名不变，缓存命中返回旧排序——功能上线即「改规则不生效」。
- 改法：`WorkplaceViewSigs` 扩为三元组 `{vfs, rules, smartRules}`；service 侧签名采样处无条件追加 smart_sort_rule 表指纹（全量按 sort_order 排序后确定性 JSON 序列化，照 rules 指纹同款做法；表小成本可忽略，管理页改规则低频，过度失效可接受）；`getCachedWorkplaceView` 比对三元组。
- 验收/测试：新用例——选 smart 排序评估一次（缓存发布）→ 改智能规则（如禁用某条）→ 再次评估结果与旧缓存不一致（签名 miss 重算）；非 smart 库行为不变。
- 来源：merge-dev 适配评估（2026-09-08，用户确认开工）

---

## Round 4 must-fix（增量批次，合并后 15 条 = 2 P1 + 13 P2）

本轮为真机验收增量批次（base 76c03550 → head fa485f10），三个 scope 并行评审（core / mobile / dtcli=desktop+cli）。合并说明：mobile/B-2 并入 dtcli/B-1（双端「结果只属于上次点击」parity，同一条治）；dtcli/C-1 并入 core/C-3（哨兵元组显示文案单源化，core 侧治本 + CLI 侧消费收敛同一条）。编号 1-15 为合并后顺序。

### P1（2 条）

#### 1. core/mobile-G-1 [P1] ownerRouteKey 归属过滤零测试覆盖
- 维度：G（测试覆盖）
- 文件：apps/mobile/src/navigation/HeaderContext.tsx:69-78（useStackOverrideSetter 自动附加 route.key 为 ownerRouteKey）；AppHeader 消费侧三态判定；测试落 apps/mobile/__tests__/app-header.test.tsx
- 问题：fa485f10 引入的 ownerRouteKey 归属过滤（转场动画期间「?」帮助按钮与标题不再同时渲染到相邻屏 header）没有任何行为断言——AppHeader 的三态判定（owner 匹配当前 route.key → 应用 override；不匹配 → 回退 base 标题；无 owner → 保持旧全局兼容语义）与 useStackOverrideSetter 自动附加 route.key 的行为均无测试锁住，后续重构或回归无从拦截。
- 改法：app-header.test.tsx 补三态用例（owner 匹配应用 / 不匹配回退 base / 无 owner 全局兼容）+ useStackOverrideSetter 附加 route.key 断言。
- 验收/测试：用例②（不匹配回退 base）在无过滤的旧代码下跑红——证明测试对原始 bug 有真实捕获力，不是恒绿摆设。
- 来源：review_round 4 · mobile scope 评审

#### 2. dtcli/B-1 [P1]（合并 mobile/B-2）测试结果不随输入失效——双端高亮错位与结果残留
- 维度：B + G（双端 parity）
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2262-2264（测试文本 onChange 只 setTestText）、2163-2166（highlightSegments 按旧 matchResult 偏移切分）；apps/mobile/src/screens/stack/SmartSortRuleEditorScreen.tsx:240-242（applyPatternInput）、580（captureKind patchDraft）
- 问题：测试结果区的语义是「结果只属于上次点击『测试』时的输入快照」，但四个输入变化入口里只有部分清结果：desktop 测试文本 onChange 不清 matchResult/testError，编辑文本后旧 matches 的 index 偏移对已编辑文本切分高亮错位；mobile 正则输入 applyPatternInput 与捕获数字切换 captureKind patchDraft 两处不清 testOutcome，改正则或换档位后旧结果残留误导（mobile 的 changeTestText 已有清空范式，这两处漏对齐）。
- 改法：双端对齐「结果只属于上次点击」——desktop **三个入口**（终审修订：不只测试文本）均追加清结果：测试文本 onChange（:2263）、正则输入 onChange（:2201）、捕获数字 select onChange（:2227）各追加 setMatchResult(null) + setTestError(null)；mobile applyPatternInput 与 captureKind patchDraft 两处 setTestOutcome(IDLE_OUTCOME)（照 changeTestText 既有清空范式）。验收：任一输入变化后结果区回占位提示（双端断言挂 dtcli/G-1 与 mobile/G-2）。
- 验收/测试：双端改输入后结果区回 idle 状态（desktop 回占位提示、mobile 回 idle 文案）；行为断言分别落入 dtcli/G-1 与 mobile/G-2 的测试。
- 来源：review_round 4 · desktop + mobile scope 评审（mobile/B-2 并入本条，双端同治）

### P2（13 条）

#### 3. core/B-4 [P2] parseChineseNum 超长 ASCII 数字串溢出 ±Infinity，击穿 D13 哨兵前提
- 维度：B（正确性）
- 文件：packages/core/src/domain/workplace/logic/smart-sort.ts:147-163（parseChineseNum）
- 问题：约 309 位以上的纯 ASCII 数字串经 `Number()` 转成 ±Infinity（ASCII_INT 分支 154-156 直接 `return Number(s)`），与 fixed_min/fixed_max 哨兵在数值上平权——formatSortTupleForDisplay 的文档前提「数字管道永不产出 ±Infinity（parseChineseNum 有限值）」被击穿，展示层会把普通捕获数字误报成「固定最小/最大」档，排序比较侧 Infinity 与哨兵混序。
- 改法：ASCII 整数分支与最终返回加 `Number.isFinite` 守卫，非有限返回 null（沿用「转换失败继续下一条」语义）；中文逐位分支的 `Number(digits)` 同型溢出，一并对齐同一守卫。
- 验收/测试：`parseChineseNum("9".repeat(400)) === null` 断言 + smart-sort.test 补对应用例。
- 来源：review_round 4 · core scope 评审

#### 4. core/C-3 + dtcli/C-1 合并 [P2] 哨兵元组显示文案多源，±∞ 显示单源化
- 维度：C（DRY）
- 文件：packages/core/src/domain/smart-sort-rule/logic/match-smart-sort-pattern.ts:112-124（tupleForCaptureKind 内联「(固定最小,)」「(固定最大,)」文案）；apps/cli/src/sort-rule/commands.ts:194-207（test 命令手写 -Infinity/Infinity 检测，输出不带括号）；packages/core/src/domain/workplace/logic/smart-sort.ts:250-262（formatSortTupleForDisplay，经 packages/core/src/public/smart-sort-rule.ts 公开导出但零生产消费）
- 问题：哨兵元组的显示文案有三份平行来源——match 通道的 tupleForCaptureKind 内联字符串、CLI test 命令手写 ±∞ 检测、D13 唯一权威实现 formatSortTupleForDisplay（公开导出却没有任何生产消费方）。三处已现格式分叉（CLI 不带括号），文案漂移无一致性保障。
- 改法（拍板方案 a）：三处消费全部收敛调 formatSortTupleForDisplay（smart 档数字元组与 fixed 档哨兵文案同源格式化）；CLI test 输出同步为带括号格式；与 core/B-4 一起治本（哨兵前提修复）治面（显示单源化）。
- 验收/测试：CLI e2e 断言同步带括号格式（dtcli/G-2 补）；core 单测锁 formatSortTupleForDisplay 为唯一文案来源。
- 来源：review_round 4 · core + dtcli scope 评审（dtcli/C-1 并入本条）

#### 5. core/C-4 [P2] flags 合法性第三份平行实现
- 维度：C（DRY）
- 文件：packages/core/src/domain/smart-sort-rule/logic/parse-pattern-input.ts:24-30（本地 isValidFlags 字面复制）；对照 packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts（assertFlagsValid）
- 问题：round 1 的 core/C-1 已收敛过 schema/compile 双实现，但 parse-pattern-input.ts 内还留着第三份 flags 合法性字面复制——同一规则三处维护，drift 风险复燃。
- 改法：schema 层导出非 throw 的纯谓词 `isFlagsValid`，`assertFlagsValid` 内部复用该谓词后 throw；parse-pattern-input 引入 schema 版并删除本地复制。
- 验收/测试：parse-pattern-input.test 全绿零行为变化。
- 来源：review_round 4 · core scope 评审

#### 6. core/F-1 [P2] SmartRulesProvider port 文档注释仍写「启用且」，与 core/B-1 修复后口径矛盾
- 维度：F（注释/文档一致性）
- 文件：packages/core/src/service/workplace/workplace.port.ts:17-21
- 问题：port 注释写「仅当存在启用且 sortField='smart' 的目录规则时才被调用」，而 core/B-1 修复后懒加载触发只看 `sortField === 'smart'`、不看 ruleEnabled（启用过滤由 service 编译侧承担）——注释与实现口径矛盾，误导后续维护与评审。
- 改法：删「启用且」，写明与排序消费端共用基线口径（是否启用由规则编译结果决定，不由加载侧预过滤）。
- 验收/测试：注释-only，无行为面。
- 来源：review_round 4 · core scope 评审

#### 7. core/F-2 [P2] 注释错字与措辞失实两处
- 维度：F
- 文件：packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:257、282（「兑底」×2）；packages/core/src/service/workplace/create-workplace-service.ts:38（「复用同一 repo」）
- 问题：①resetDefaults 注释两处「兑底」为错字，应为「兜底」；②「复用同一 repo」措辞失实——smartRuleRows 每次调用 `new SqliteSmartSortRuleRepository(conn)` 新建实例，并非复用同一实例。
- 改法：错字改「兜底」；措辞改「同一 repo 类」（每次新建实例、共享同一 conn）。
- 验收/测试：注释-only，无行为面。
- 来源：review_round 4 · core scope 评审

#### 8. mobile/B-1 [P2] 编辑屏加载失败后 dirty 恒真，误弹未保存确认
- 维度：B
- 文件：apps/mobile/src/screens/stack/SmartSortRuleEditorScreen.tsx:229（baseline 初始 ''）、232（dirty = snapshot !== baseline）、263-265（listRules 异常 catch 只 toast）
- 问题：编辑已有规则时 listRules 抛异常，catch 分支只 toast「加载失败」，baseline 停在初始 ''，而 draft 是 DEFAULT_DRAFT（非空快照）——dirty 恒真，用户返回时误弹「未保存的更改」确认框。
- 改法：catch 分支与加载中路径把 baseline 对齐当前 draft（或 baseline 引入 null 态 + dirty 判空），保证加载失败不产生伪 dirty。
- 验收/测试：listRules reject 时无「未保存的更改」弹窗。
- 来源：review_round 4 · mobile scope 评审

#### 9. mobile/C-1 [P2] 七文件 useHeaderContext 死 import + 屏级注释缩进错位
- 维度：C（死代码/格式）
- 文件：apps/mobile/src/screens/stack/ 下 CloudSyncProgressScreen.tsx / PromptEditorScreen.tsx / ProviderDetailScreen.tsx / SearchEngineDetailScreen.tsx / SearchEnginesScreen.tsx / SmartSortRuleEditorScreen.tsx，及 apps/mobile/src/hooks/useVfsBackNavigation.ts（共七处）
- 问题：ownerRouteKey 改造把七处 override 调用方统一切到 useStackOverrideSetter 后，旧的 useHeaderContext import 残留成死 import；部分屏级注释缩进错位（未按 2 格缩进）。
- 改法：删死 import（只留 useStackOverrideSetter），注释缩进归位 2 格。
- 验收/测试：typecheck/lint 干净，无行为面。
- 来源：review_round 4 · mobile scope 评审

#### 10. mobile/C-3 [P2] 列表屏头注释仍提拖拽，与 D8 移除终态矛盾
- 维度：F（注释一致性）
- 文件：apps/mobile/src/screens/stack/SmartSortRulesScreen.tsx:2
- 问题：文件头注释仍描述长按拖拽调序，而拖拽已按设计定案 D8 移除（改按钮调序），注释与实现终态矛盾。
- 改法：改写为按钮调序（注明拖拽已按 D8 移除）。
- 验收/测试：注释-only，无行为面。
- 来源：review_round 4 · mobile scope 评审

#### 11. mobile/G-2 [P2] splitHighlightSegments 纯函数零测试
- 维度：G（测试覆盖）
- 文件：apps/mobile/src/screens/stack/SmartSortRuleEditorScreen.tsx:173（splitHighlightSegments）
- 问题：高亮切分纯函数零测试——普通交替切分、零宽匹配跳过、末尾匹配无尾段等边界均无断言，dtcli/B-1 的清结果修复也无 mobile 侧行为断言可挂。
- 改法：新增测试三用例：①普通交替切分（普通段/匹配段交错）；②零宽匹配不产生空段且后续段偏移不漂移；③末尾匹配无尾段。
- 验收/测试：三用例全绿；可顺带挂 dtcli/B-1 的 mobile 侧断言（改正则/换档位后结果回 idle 文案）。
- 来源：review_round 4 · mobile scope 评审

#### 12. dtcli/B-2 [P2] desktop 编辑器保存 name 未 trim，无空名拦截
- 维度：B（双端 parity）
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2127-2141（save，name 直取 draft.name）
- 问题：save 不 trim name、空名/纯空格名照发 IPC，靠 core 层报错兜底；mobile 侧 collectFields 有本地 trim + 「请填写规则名称」toast 前置拦截，双端行为不对齐。
- 改法：save 里 name trim + 空名本地 toast「请填写规则名称」（对齐 mobile collectFields 惯例）。
- 验收/测试：空白名保存被本地拦截（不达 IPC）。
- 来源：review_round 4 · desktop scope 评审

#### 13. dtcli/B-3 [P2] 编辑器加载 effect 对 IPC 失败静默
- 维度：B
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2062-2066（list effect 的 !res.ok 裸 return）
- 问题：编辑器加载 effect 对 `!res.ok` 静默 return——round 1 desktop/B-1 修过的「失败伪装成空态」同型问题在编辑器复现。
- 改法：`!res.ok` 时 toastSettingsError(res.error.message)。
- 验收/测试：list ok:false 出错误 toast。
- 来源：review_round 4 · desktop scope 评审

#### 14. dtcli/G-1 [P2] 桌面端新批次零行为测试
- 维度：G（测试覆盖）
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2027（splitSmartSortHighlightSegments）；nm:sort-rule/match IPC 通道（DTO：index/tuple 透传）
- 问题：round 4 增量（高亮切分函数 + match 通道）在桌面端零行为断言，dtcli/B-1 的清结果修复也无测试可挂。
- 改法：①高亮切分函数行为断言：多匹配偏移 / 零宽跳过不产生空段 / 尾部段 / 重复文本下偏移不错位；②match DTO 的 index/tuple 透传断言与非法正则返回 ok:false 结果（非 IPC 错误）断言；③挂 dtcli/B-1 desktop 侧断言（改测试文本后结果区回 idle）。
- 验收/测试：上述断言全绿。
- 来源：review_round 4 · desktop scope 评审

#### 15. dtcli/G-2 [P2] CLI import/export/enable/disable 四子命令零 e2e
- 维度：G（测试覆盖）
- 文件：apps/cli/test/sort-rule-e2e.test.ts
- 问题：CLI 九个 sort-rule 子命令现覆盖 5/9，import / export / enable / disable 四个子命令零 e2e。
- 改法：补 round-trip 用例：export → disable → import 回灌 → list 断言恢复（含 enabled 翻转）。
- 验收/测试：round-trip 用例全绿；core/C-3 的带括号哨兵格式断言可顺带在此锁定（test 命令输出走 formatSortTupleForDisplay 后）。
- 来源：review_round 4 · cli scope 评审

---

#### 16. review-full/C-1 [P2]（终审新增）高亮切分双端逐行同构双实现——收敛 core 单源
- 维度：C（DRY）+ C-orch
- 文件：apps/desktop/renderer/features/settings/SettingsViews.tsx:2027（splitSmartSortHighlightSegments）；apps/mobile/src/screens/stack/SmartSortRuleEditorScreen.tsx:173（splitHighlightSegments）
- 问题：双端高亮切分纯函数算法完全一致（cursor 单调推进、零宽跳过、尾段补齐，逐行同构），双份维护下任一侧修边界 bug 另一侧静默漂移。仓库惯例是共享逻辑 core 单源、desktop 经 shared/logic 薄再导出（49c580ee 先例）。
- 改法：core 在 match-smart-sort-pattern.ts 旁新增切分纯函数（入参 {index, text}[] 最小结构）并经 public/smart-sort-rule.ts 导出（同步 allowlist 快照）；mobile 删本地直调 core；desktop 删本地经 shared/logic/smart-sort.ts 薄再导出。#11/#14 要求的切分测试随之单源化到 core（三边界：交替切分/零宽跳过不漂移/末尾匹配无尾段），双端只留渲染断言。
- 验收/测试：core 单测三边界全绿；双端无本地复制（grep 零残留）。
- 来源：review-full · round 4 终审

## Spec deviations

| 项 | 状态 | 处置 |
|----|------|------|
| Step 6 懒加载条件加码（`ruleEnabled && sortField === "smart"` 超出 spec 口径） | fixed | core/B-1 已执行：条件去掉 ruleEnabled，与 spec 口径对齐（T-WE3c 独享库验证） |
| CLI list 列序与 Step 9 不符 | fixed | mc/A-1 已执行：列序调回 spec 钉死顺序（e2e 锁列） |
| VFS 文件名校验不在迭代 spec（43803e39 引入 packages/core/src/domain/vfs/logic/validate-entry-name.ts） | fixed（用户已知情拍板；spec 补章节随 K 类闭合，见终审流转注） | 用户已知情拍板（本会话新增需求）；K 类建议：spec 补一节收录设计拍板（拒控制字符/纯空白/首尾空格与 . 与 ..、五入口、导入链路豁免），随下游执行时闭合 |

---

## Open questions / 待拍板（不阻塞 fix-spec）

round 1-3 遗留：

- core-oq1：importRules 替换式清空含 builtin 后，不含 builtin 的 YAML 导入会在下次启动 seed 重灌时 sortOrder 撞号（与 core/B-2 同型问题、bootstrap 路径）——候选方案：importRules 收尾显式 renumber（builtin 在前），或接受 seed 重灌语义；**需用户拍板**。
- core-oq2：YAML bundle 的 sortOrder 字段与数组序构成双真相源（当前数组序为唯一真相、字段静默忽略）——两可，维持或收窄均可。
- core-oq3：previewSort 对 draft 的重复 flags 宽容（如 'gg' 不拒）——两可，与 create/update 严格口径是否拉齐待定。
- core-oq4：importRules / resetDefaults 无事务包裹（repo port 无事务能力，regex 域同款既有形态）——架构决策，不本轮处理。
- desktop-oq1：`nm:sort-rule/importRules` / `exportRules` 通道 renderer 侧零调用（死通道，spec 列了）——收窄 spec 删通道，或注明保留理由；**需用户拍板**。
- desktop-oq2：renderer 无 typecheck 脚本覆盖（仓库级现状，本 diff 仅 1 处与既有 9 处同款 TS2540）——建议另立迭代统一处理。
- mc-oq1：CLI parseCliArgs 不支持 `--key=value` 形式，`-` 开头的 pattern 传不进——共享 parser 既有局限，不在本轮扩。
- mc-oq2：编辑器预览只跑草稿规则、不含全列表上下文（符合 spec D11，hint 已声明）——两可。
- mc-oq3：`test` 命令尾行 `# asc` 为 spec 外附加输出——默认保留。

round 4 新增：

- core-oq5：importRules 中 builtin 前缀行获 D3 保护删不掉——builtin 前缀的导入行不可删除是否符合预期，待用户确认语义。
- core-oq6：previewSort 的 nums 含 ±Infinity 时的 JSON 序列化留意（Infinity 非合法 JSON 值，序列化后变 null）——core/B-4 修复后数字管道不再产出 ±Infinity，此问题面自然收窄，但导出/序列化路径留意。
- mc-oq4：SmartSortRuleEditorScreen 内两处 pickerRow 数值不一致（捕获数字与排序方式两处选择器行样式）——是否抽公共组件，两可。
- mc-oq5：VfsFileManager 每次 reload 重新编译智能排序规则——量小，重编译成本可忽略，两可维持。
- dtcli-oq1：desktop 保存前置校验是否整体拉齐 mobile collectFields（dtcli/B-2 只补 name 一项，正则空值等其余字段是否同拦）——待拍板。
- dtcli-oq2：非法正则时结果区错误样式观感（红框/红字层级）——UI 细节，待用户真机过目后定。

---

## 已豁免（用户确认不修）

- 无。

---

## 合并后 QA（manual_user，不阻塞；round 1-3 批次）

- 桌面端设置页智能排序规则视图手动 smoke：列表加载失败出错误提示（desktop/B-1）；编辑已删除规则出「规则不存在」提示且 save 走新建语义（desktop/B-2）；规则拖拽调序行为与改前一致（desktop/C-1）。
- 移动端智能排序规则列表手动 smoke：长按拖拽调序动画与兜底行为正常（mc/C-2 改动后）。
- 真机回归：禁用全部智能规则后目录排序不再出现「第三种形态」（core/B-1 行为面）；恢复默认后用户规则位置保持（core/B-2 行为面）。

---

## K 节建议（下游执行时闭合）

round 1-3 遗留：

- 触达文件统一 lint/format：SettingsViews.tsx、smart-sort-rule.service.ts、workplace.service.ts、create-workplace-service.ts、sort-rule/commands.ts、SmartSortRulesScreen.tsx、smart-sort-drag.ts 及对应测试文件。
- core/B-1 改动涉及的注释与 core/C-2 的 provider 注入说明需同步更新，避免下一轮评审再报口径漂移。
- mc/A-1、mc/C-1 的 e2e 断言补齐后，确认 CI 的 CLI 用例为绿（本地 CLI 测试环境受限时以 CI 为准）。
- 桌面端 TS2540 同款问题不逐个修（见 desktop-oq2），本轮新增代码避免再引入新的实例。

round 4 新增：

- desktop 测试入口 apps/desktop/scripts/run-tests.mjs 的默认 glob `test/**/*.test.ts` 在 bash 无 globstar 下只展开一层子目录（`test/*/*.test.ts`）——顶层 85 个测试文件不进测试入口，CI 同盲区（实测：顶层 85 个仅子目录 7 个被跑到）。建议本迭代一并修（一行 glob 修正，如显式 `test/*.test.ts test/**/*.test.ts` 或改 node --test 目录发现），或另立迭代处理；dtcli/G-1 的新测试需确认真的被入口跑到。
- spec 勘误：Step 1 与变更点清单写 SCHEMA_BOOT_VERSION 10→11，实际落地 =13（merge v1.5.16 后顺延，行为正确、快路径不短路 pending migration 已终审核实）；随 K 类一并勘正。
- spec 补 VFS 文件名校验章节：收录设计拍板（拒控制字符/纯空白/首尾空格/`.` 与 `..`、五个入口、导入链路豁免），与 Spec deviations 的 open 行对应，随下游执行时闭合。

## Fix-Spec Closure（Round 4）

| 项 | 状态 |
| fix-spec-ready | yes（终审三项文档级缺口已 trivial 直接执行闭合：#2 改法扩三入口 / 新增 #16 切分单源 / VFS deviation 转 fixed） |
| fix_spec_path | docs/Iterations/smart-filename-sort/cr-fix-spec.md |
| dag_version / review_round | 4 / 4（scope×3 并行 → spec-fix → review-full → trivial 闭合） |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 14（#16 新增后） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（VFS 校验已转 fixed，用户拍板在案） |
| C-orch | ✅（#2 双端 parity、#4/#16 单源收敛、#9 死 import 清理） |
| C 类合并后 QA | 真机验收继续（T-DT 系列）；K 类 5 项随下游执行闭合 |
| **执行记录（2026-09-13）** | 16/16 全闭合（含跑红验证：G-1 用例②与 B-1 mobile 两用例、B-1 desktop 中间态）。K 节：run-tests.mjs glob 修复（入口 20→92 文件，desktop 测试 125→484 用例）✅；spec 勘误（BOOT_VERSION 10→11 实为 13，三处）✅；spec 附录 B VFS 校验补章 ✅；触达文件 eslint 0 error ✅；CLI 断言本地全绿（CI 确认留发版期）◻。遗留观察：desktop 4 套件 keyring 环境性失败（Secret Service 会话态，与 test/desk-e2e-regression 分支「keyring 解锁后补跑」同坑）；CLI 全量 26 失败为环境性存量（基线对照集合一致） |
