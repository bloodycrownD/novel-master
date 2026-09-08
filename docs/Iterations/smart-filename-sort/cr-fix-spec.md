# CR Fix Spec: 文件名智能排序（smart-filename-sort）评审修复说明书

## 元信息

- repo：novel-master（worktree `.worktree/smart-filename-sort`）
- base_sha：b442d397
- head_sha：ca1bba60
- prd_path：docs/Iterations/smart-filename-sort/prd.md
- spec_path：docs/Iterations/smart-filename-sort/spec.md
- review_round：2
- dag_version：3
- 状态：fix-spec-ready

---

## Must-fix（按 P1 → P2，本轮无 P0）

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

---

### core/B-3 [P0] L1 评估链缓存签名不含 smart_sort_rule 表——改智能规则后排序不刷新
- 维度：B（正确性）+ C-orch
- 文件：packages/core/src/service/workplace/impl/workplace-view-cache.ts、packages/core/src/service/workplace/impl/workplace.service.ts（签名采样处）
- 问题：dev 新增的 L1 缓存（27be71c4）读时校验签名是二元组 `{vfs, rules}`（vfs 聚合签名 + workplace_dir_rule 表指纹），smart_sort_rule 表不在签名内。目录规则选 smart 后评估结果（含 smart 排序）被缓存，用户在管理页增删改/启停/调序智能规则后签名不变，缓存命中返回旧排序——功能上线即「改规则不生效」。
- 改法：`WorkplaceViewSigs` 扩为三元组 `{vfs, rules, smartRules}`；service 侧签名采样处无条件追加 smart_sort_rule 表指纹（全量按 sort_order 排序后确定性 JSON 序列化，照 rules 指纹同款做法；表小成本可忽略，管理页改规则低频，过度失效可接受）；`getCachedWorkplaceView` 比对三元组。
- 验收/测试：新用例——选 smart 排序评估一次（缓存发布）→ 改智能规则（如禁用某条）→ 再次评估结果与旧缓存不一致（签名 miss 重算）；非 smart 库行为不变。
- 来源：merge-dev 适配评估（2026-09-08，用户确认开工）

## Spec deviations

| 项 | 状态 | 处置 |
|----|------|------|
| Step 6 懒加载条件加码（`ruleEnabled && sortField === "smart"` 超出 spec 口径） | open → 将 fixed | 随 core/B-1 闭合：条件去掉 ruleEnabled 后与 spec 口径对齐 |
| CLI list 列序与 Step 9 不符 | open → 将 fixed | 随 mc/A-1 闭合：列序调回 spec 钉死顺序后对齐 |

---

## Open questions / 待拍板（不阻塞 fix-spec）

- core-oq1：importRules 替换式清空含 builtin 后，不含 builtin 的 YAML 导入会在下次启动 seed 重灌时 sortOrder 撞号（与 core/B-2 同型问题、bootstrap 路径）——候选方案：importRules 收尾显式 renumber（builtin 在前），或接受 seed 重灌语义；**需用户拍板**。
- core-oq2：YAML bundle 的 sortOrder 字段与数组序构成双真相源（当前数组序为唯一真相、字段静默忽略）——两可，维持或收窄均可。
- core-oq3：previewSort 对 draft 的重复 flags 宽容（如 'gg' 不拒）——两可，与 create/update 严格口径是否拉齐待定。
- core-oq4：importRules / resetDefaults 无事务包裹（repo port 无事务能力，regex 域同款既有形态）——架构决策，不本轮处理。
- desktop-oq1：`nm:sort-rule/importRules` / `exportRules` 通道 renderer 侧零调用（死通道，spec 列了）——收窄 spec 删通道，或注明保留理由；**需用户拍板**。
- desktop-oq2：renderer 无 typecheck 脚本覆盖（仓库级现状，本 diff 仅 1 处与既有 9 处同款 TS2540）——建议另立迭代统一处理。
- mc-oq1：CLI parseCliArgs 不支持 `--key=value` 形式，`-` 开头的 pattern 传不进——共享 parser 既有局限，不在本轮扩。
- mc-oq2：编辑器预览只跑草稿规则、不含全列表上下文（符合 spec D11，hint 已声明）——两可。
- mc-oq3：`test` 命令尾行 `# asc` 为 spec 外附加输出——默认保留。

---

## 已豁免（用户确认不修）

- 无。

---

## 合并后 QA（manual_user，不阻塞）

- 桌面端设置页智能排序规则视图手动 smoke：列表加载失败出错误提示（desktop/B-1）；编辑已删除规则出「规则不存在」提示且 save 走新建语义（desktop/B-2）；规则拖拽调序行为与改前一致（desktop/C-1）。
- 移动端智能排序规则列表手动 smoke：长按拖拽调序动画与兜底行为正常（mc/C-2 改动后）。
- 真机回归：禁用全部智能规则后目录排序不再出现「第三种形态」（core/B-1 行为面）；恢复默认后用户规则位置保持（core/B-2 行为面）。

---

## K 节建议（下游执行时闭合）

- 触达文件统一 lint/format：SettingsViews.tsx、smart-sort-rule.service.ts、workplace.service.ts、create-workplace-service.ts、sort-rule/commands.ts、SmartSortRulesScreen.tsx、smart-sort-drag.ts 及对应测试文件。
- core/B-1 改动涉及的注释与 core/C-2 的 provider 注入说明需同步更新，避免下一轮评审再报口径漂移。
- mc/A-1、mc/C-1 的 e2e 断言补齐后，确认 CI 的 CLI 用例为绿（本地 CLI 测试环境受限时以 CI 为准）。
- 桌面端 TS2540 同款问题不逐个修（见 desktop-oq2），本轮新增代码避免再引入新的实例。
