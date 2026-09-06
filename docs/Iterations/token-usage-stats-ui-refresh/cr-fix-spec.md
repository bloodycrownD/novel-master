# CR Fix Spec: token-usage-stats-ui-refresh（round 1 修复说明书）

## 元信息

- repo: novel-master
- base_sha: c95bf97
- head_sha: 1a2355e
- prd_path: docs/Iterations/token-usage-stats-ui-refresh/prd.md（只读参考，勿改）
- spec_path: docs/Iterations/token-usage-stats-ui-refresh/spec.md（只读参考，勿改）
- fix_spec_path: docs/Iterations/token-usage-stats-ui-refresh/cr-fix-spec.md
- review_round: 2
- dag_version: 3
- 状态：**fix-spec-ready**（review-full-r3 建议 yes，主代理已采纳）

> 本轮 wave 范围：三个 scope（core / mobile / desktop）评审产出的全部 **17 条 P2 must-fix**，已全部认定并有改法。P0=P1=0。行号以 base_sha…head_sha 区间内当前工作区实测为准，均标「约」。

---

## Must-fix（按 P0 → P1 → P2）

### P0

无（本轮未产出 P0）。

### P1

无（本轮未产出 P1）。

### P2（共 17 条：core 3 / mobile 7 / desktop 7）

#### 【core】

---

#### review-scope-core/G-1 [P2] T-C7 补 listRequestUsage × providerId 维度断言（含 null 三态）

- 维度：G（测试覆盖缺口）
- 文件：`packages/core/test/chat/usage-stats.service.test.ts`（T-C7 用例，约 1121 行起；seedMsg 已支持 `seed.providerId` 字段）
- 问题：T-C7 只断言 model 维（无 range 全量分页 + model 筛选仍生效），`listRequestUsage` 的 `providerId` 筛选路径——含 `{providerId: null}`（未记录服务商历史行）三态——零覆盖。
- 改法：在 T-C7 用例内把 seed 行分属两个 providerId（其一 `'P'`，其余保持 null）：例如给 5 条 usage 行中的 2 条加 `providerId: 'P'`（保留既有 modelName 覆盖），无 usage 行与 2020 老消息保持 null。然后在既有断言之后追加两轮：
  1. `listRequestUsage({providerId: 'P'}, …)`：`total` 只计入 P 行，返回 `rows` 全部为 P 行；
  2. `listRequestUsage({providerId: null}, …)`：`total` 只含未记录历史行（provider_id IS NULL），rows 中无 P 行。
- 验收/测试：新增断言随 core 全量测试跑绿；人为错配 seed（如 P 行漏标）时断言能红。
- 来源：review-scope-core / round 1

---

#### review-scope-core/A-1 [P2] T-C5 补类型层负向钉子（@ts-expect-error 防旧形状回归）

- 维度：A（需求符合性——已删除形状不得回归，编译期钉子）
- 文件：`packages/core/test/chat/usage-stats.service.test.ts`（T-C5 用例，约 415 行起）
- 问题：T-C5 只用运行时断言 `!("today" in summary)` 钉住已删形状；类型层无负向钉子——若有人把 `today` 加回 summary 类型、或把 `kind` 之类的旧形态字段加回 `UsageStatsRange`，运行时断言未必红，类型回归无编译期防护。
- 改法：T-C5 内追加两处编译期钉子（示意）：
  ```ts
  // @ts-expect-error 已删除字段：summary 不再有 today
  void (summary as { today?: number }).today;
  // @ts-expect-error UsageStatsRange 为 {fromDay, toDay}，无 kind 形态
  void (range as { kind?: string }).kind;
  ```
  （具体表达式形式可按用例内既有变量名调整，钉子语义不变。）
- 验收/测试：类型检查通过（@ts-expect-error 生效）；删除任一 `@ts-expect-error` 注释后同表达式立即报编译错；反之若旧形状被加回类型定义，`@ts-expect-error` 变 unused 同样炸编译——双向钉死。
- 来源：review-scope-core / round 1

---

#### review-scope-core/C-1 [P2] getModelBreakdown 删除被 JS 重排架空的 SQL ORDER BY

- 维度：C（死代码）
- 文件：`packages/core/src/service/chat/impl/usage-stats.service.ts`（getModelBreakdown SQL 模板，约 268-275 行，子句 `ORDER BY total_tokens DESC, model_name ASC`）
- 问题：SQL 排序之后，JS 侧 provider×model 归并（未配置模型归并、null provider 合并成单行）会无条件按用量降序重排（约 305-320 行，注释明言「归并后重排保持按用量降序」）。归并必然改变行集，SQL 序对最终输出零影响——死排序，徒增排序开销并误导读者以为输出序由 SQL 决定。
- 改法：删除 SQL 模板中的 `ORDER BY total_tokens DESC, model_name ASC` 子句；在 SQL 模板紧邻处（或模板内注释）点明「输出顺序由 JS 归并后的 sort 保证，SQL 不排序」。
- 验收/测试：core 全量测试绿（输出顺序已由既有 modelBreakdown 降序断言覆盖）。
- 来源：review-scope-core / round 1

#### 【mobile】

---

#### review-scope-mobile/C-1 [P2] SummaryTile 删除 layout 'wide' 死分支与 tileWide 死样式

- 维度：C（死代码）
- 文件：`apps/mobile/src/screens/stack/token-usage/SummaryTab.tsx`（约 33 行 `layout?: 'half' | 'wide' | 'third'`、约 41 行 `layout === 'wide' && styles.tileWide`）；`apps/mobile/src/screens/stack/token-usage/styles.ts`（约 58 行 `tileWide`）
- 问题：`'wide'` 取值无任何调用方传入（全仓仅类型定义与 41 行条件消费两处出现），`styles.tileWide` 仅被该死条件引用——死分支 + 死样式。
- 改法：layout 类型收窄为 `'half' | 'third'`；删除 41 行的 `'wide'` 条件表达式；删除 styles.ts 中 `tileWide` 样式块；同步更新 SummaryTile 的 doc 注释（如提及 layout 取值处）。
- 验收/测试：tsc 类型检查绿；`NODE_ENV=test npx jest`（token-usage 相关套件）绿；token-usage 范围 grep `tileWide` 与 `'wide'` 无残留。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/C-2 [P2] 删除 reqPagerLabel 死样式

- 维度：C（死代码）
- 文件：`apps/mobile/src/screens/stack/token-usage/styles.ts`（约 103 行 `reqPagerLabel`）
- 问题：全仓唯一出现处即定义本身（已核实 apps/ + packages/ 范围 grep 无任何引用），死样式。
- 改法：删除该样式块。
- 验收/测试：tsc / jest 绿；grep `reqPagerLabel` 全仓无结果。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/C-3 [P2] hourly 加载注释纠正筛选口径漂移

- 维度：C（注释漂移）
- 文件：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（约 270 行 useEffect 上方注释，现为「选中天后加载 24 小时桶（只应用模型筛选，时间由天本身界定）」）
- 问题：实现已把完整 `filter` 传给 `getHourlyBuckets(selectedDay, filter)`——服务商×模型组合筛选已生效，注释仍写「只应用模型筛选」，口径漂移误导后续维护。
- 改法：注释改为「应用模型+服务商组合筛选，时间由天本身界定，range 不参与」。
- 验收/测试：注释与 `getHourlyBuckets(selectedDay, filter)` 调用签名一致（人工核对）。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/C-4 [P2] libraryEmpty 注释同步实现 + 删测试 mockListModels 死桩

- 维度：C（注释漂移 + 死代码）
- 文件：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（约 338-345 行空态注释）；`apps/mobile/__tests__/token-usage-stats-screen.test.tsx`（约 35 行 `mockListModels` 定义、约 46 行 `mockRuntime.usageStats.listModels` 挂载、约 389 行 `mockListModels.mockReset()`）
- 问题：① 注释仍写「库全空（listModels 为空且已落地一轮查询）」，而实现已是 `libraryEmpty = combos.length === 0 && summary != null`（配置侧 provider×model 组合探底，Screen 已不调用 `usageStats.listModels`，全文件仅注释一处提及）；② 测试的 mockListModels 桩因此无调用方，mockReset 维持「仍有调用」假象。
- 改法：① 注释改为「配置侧无任何服务商×模型组合且已落地一轮查询」（其余空态描述句保留）；② 删 mockListModels 定义（35 行）、`listModels: mockListModels` 挂载（46 行）、`mockListModels.mockReset().mockResolvedValue(['gpt-4o']);`（389 行）三处。
- 验收/测试：tsc / `NODE_ENV=test npx jest`（token-usage-stats-screen 套件）绿；grep `mockListModels` 无结果。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/C-5 [P2] PAGE_SIZE 收敛至 format.ts 单一来源

- 维度：C（DRY）
- 文件：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（约 176 行 `const PAGE_SIZE = 10;`）；`apps/mobile/src/screens/stack/token-usage/RequestsTab.tsx`（约 11 行 `const PAGE_SIZE = 10;`）；`apps/mobile/src/screens/stack/token-usage/format.ts`
- 问题：同一分页常量双份定义，改页大小需两处同步，漂移即两端分页窗口不一致。
- 改法：format.ts 导出 `export const REQUESTS_PAGE_SIZE = 10;`（附一句注释「流水页请求级分页页大小」）；Screen 与 RequestsTab 删除本地常量、统一引用新导出。
- 验收/测试：tsc / jest 绿；token-usage 范围 grep `const PAGE_SIZE` 无残留；既有流水分页用例行为不变。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/G-1 [P2] T-M4 补饼图「其他模型」「未知服务商」label 兜底覆盖

- 维度：G（测试缺口）
- 文件：`apps/mobile/__tests__/token-usage-stats-screen.test.tsx`（T-M4 用例，约 735 行起；全局 `SAMPLE_MODEL_ROWS` 约 240 行）
- 问题：饼图 label 只覆盖两态——`{providerId: null, modelName: null}`（未记录服务商）与 `{providerId: 'p1', modelName: 'gpt-4o'}`（已知服务商已知模型）；`{providerId: 'p1', modelName: null}` 的「其他模型」归并行 label 与未知 providerId（不在 providers mock 中）的「未知服务商」兜底 label 均无断言。
- 改法：在 T-M4 用例内**局部** `mockGetModelBreakdown.mockResolvedValue([...SAMPLE_MODEL_ROWS, {providerId: 'p1', modelName: null, …}, {providerId: 'ghost', modelName: 'x', …}])`（ghost 不在 providers mock 内；用量字段给非零小值即可），随后断言新增两行的 legend/扇区渲染出含「其他模型」与「未知服务商」字样的 label。注意用局部覆盖而非改全局 SAMPLE_MODEL_ROWS，避免影响其他依赖「两行恰两扇区」的用例；同用例既有占比断言分母仍为窗口 `summary.totalTokens`（2500），加行不影响。
- 验收/测试：新增断言绿；人为去掉 UI 兜底 label 分支时断言红。
- 来源：review-scope-mobile / round 1

---

#### review-scope-mobile/C-orch-1 [P2] 按天图点选 toggle 行为与桌面端对齐

- 维度：C-orch（跨端交互一致性）
- 文件：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`（约 442 行 `onSelectDay={setSelectedDay}`）；`apps/mobile/src/screens/stack/token-usage/DetailTab.tsx`（约 96 行 `onSelect={onSelectDay}`，纯透传，无需改动）
- 问题：主屏把 `setSelectedDay` 原样透传给按天图 StackedBars 的 onSelect，重复点选同一天不会取消选中（只能靠切页签/换筛选重置）；桌面端是 toggle（`TokenUsageStatsView.tsx` 约 990 行 `setSelectedDay((prev) => (prev === key ? null : key))`），同一业务交互两端分叉。
- 改法：主屏改传 `onSelectDay={key => setSelectedDay(prev => (prev === key ? null : key))}`，与桌面一致。
- 验收/测试：`NODE_ENV=test npx jest` 绿；重复点选同一天取消选中（可补用例：连续两次 onPress 同一 `bar-col-*` 后 hourly 图消失，或人工验证）。
- 来源：review-scope-mobile / round 1

#### 【desktop】

---

#### review-scope-desktop/G-1 [P2] 单扇区整圆（≥2π 拆双半圆弧）分支零覆盖

- 维度：G（测试缺口）
- 文件：`apps/desktop/test/token-usage-stats-view.test.tsx`（被测逻辑：`TokenUsageStatsView.tsx` 约 266-276 行 `pieSlicePath`）
- 问题：`pieSlicePath` 对跨度 ≥2π 的整圆走特殊分支——拆成两个半圆弧（path d 含两个 `A` 弧段）——该分支零测试覆盖：仅一行 modelRows（该行即 100% 占比）构成整圆的渲染路径未被任何用例走到。
- 改法：补用例：mock summary 与 modelBreakdown 各为单行数据（如 p1/gpt-4o，totalTokens 非零、calls 非零），渲染后断言 `data-slice` 元素存在，且其内 `path` 的 `d` 属性恰含两个 `A` 弧段（如 `d.match(/A /g)` 长度为 2）。
- 验收/测试：新断言绿。
- 来源：review-scope-desktop / round 1

---

#### review-scope-desktop/B-1 [P2] parseLocalDate 补日历溢出回读校验（同 handler 防线）

- 维度：B（正确性/边界）
- 文件：`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（`parseLocalDate`，约 66-71 行）
- 问题：`new Date(y, mo-1, d)` 对 02-30 类日历溢出静默滚动成 03-02，不在行内报错——非法日期绕过 `token-stats-view__range-error` 行内错误路径，最终走全局 loadError，错误定位差。IPC handler 侧 `validateRangeDto`（`apps/desktop/src/main/ipc/handlers/usage-stats.ts` 约 34 行起）已有 getFullYear/getMonth/getDate 回读校验拒绝 02-30，渲染层缺同款防线。
- 改法：parseLocalDate 构造 `new Date(y, mo-1, d)` 后回读校验 `parsed.getFullYear() === y && parsed.getMonth() === mo-1 && parsed.getDate() === d`，不一致返回 null（自然并入既有行内错误路径），与 handler 同款。
- 验收/测试：desktop 测试套件绿；`parseLocalDate('2025-02-30')` 语义上返回 null（若补用例：可达注入路径下出现行内 range-error 而非全局 loadError）。
- 来源：review-scope-desktop / round 1

---

#### review-scope-desktop/B-2 [P2] autoSelectToday 改取本轮查询窗口的 f.range.toDay

- 维度：B（正确性/跨午夜错位）
- 文件：`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（reload 回调成功分支，约 458 行 `setSelectedDay(autoSelectToday ? toLocalDayKey(Date.now()) : null)`）
- 问题：补选「今天」用 `Date.now()` 重新取当下日期——查询发起于昨日深夜、回包落在今日零点后时，补选 key 与本轮查询的 filter（基于发起时 range 组装，依赖 memo）错位：选中的天不在本轮 daily 数据里。`autoSelectToday` 仅 `rangeKind === "today"` 时为真（约 467 行调用处），该路径 filter.range 恒存在。
- 改法：改为直接取本轮 filter 的窗口终点：`setSelectedDay(autoSelectToday ? f.range.toDay : null)`（`f` 为 reload 回调参数；若类型上 range 可选，写 `f.range?.toDay ?? null` 兜底，运行时 today 路径不会走到兜底）。
- 同根因双端条目（review-full/X-1）：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx` 约 151 行 `setSelectedDay(rangeKind === 'today' ? toLocalDayKey(Date.now()) : null)` 完全同构——mobile 的 reload 闭包可直接取 `filter`（依赖数组已含 filter），改为 `setSelectedDay(rangeKind === 'today' ? (filter.range?.toDay ?? null) : null)`。验收：mobile 测试绿；today 路径补选 key 恒等于本轮 `filter.range.toDay`。
- 验收/测试：双端测试绿；既有「今天自动补选」相关用例不受影响——补选中天恒与查询窗口对齐。
- 来源：review-scope-desktop / round 1；review-full/X-1 / round 2 并入

---

#### review-scope-desktop/C-1 [P2] UsageStatsFilterDto 注释拆分校验职责口径

- 维度：C（注释歧义）
- 文件：`apps/desktop/shared/ipc-types.ts`（`UsageStatsFilterDto` 注释块，约 861-865 行）
- 问题：现注释「daily 必填（handler 层校验格式与 fromDay ≤ toDay，日桶序列需要界）」读起来像 handler 会拦截「daily 缺 range」；实际职责分两层——handler 的 `validateRangeDto` 只在 **range 存在时**校验格式（含 02-30 溢出）与顺序，「daily 缺 range」由 core 的 `getDailyBuckets` 抛 `chatInvalidArgument` 兜底（service 约 192 行）。
- 改法：注释拆为两句：「range 存在时 handler 先行校验格式与顺序（validateRangeDto）；daily 缺 range 由 core 抛 chatInvalidArgument（日桶序列需要界）」。
- 验收/测试：注释与 handler / core 实际行为逐句对得上（人工核对）。
- 来源：review-scope-desktop / round 1

---

#### review-scope-desktop/G-2 [P2] providers 延迟 resolve 时「未知服务商」→ 配置名翻转无覆盖

- 维度：G（测试缺口）
- 文件：`apps/desktop/test/token-usage-stats-view.test.tsx`（mock 通道 `nm:providers/list`，样例见约 214-230 行 mockWindow）
- 问题：providers/list 慢返回（首帧 provider 名解析不到、label 兜底「未知服务商」，列表到达后翻转）这一时序无覆盖——label 翻转与翻转期间饼图选中态不丢均未被断言。
- 改法：补用例：mock `nm:providers/list` 返回挂起的 Promise，挂载渲染后断言扇区/图例 label 为「未知服务商」；点选该扇区；随后 resolve provider 列表，断言 label 翻转为配置显示名，且选中态（`is-selected` / 详情行）不丢。
- 验收/测试：新断言绿。
- 来源：review-scope-desktop / round 1

---

#### review-scope-desktop/G-3 [P2] custom 非法期间旧流水保留未断言

- 维度：G（测试缺口）
- 文件：`apps/desktop/test/token-usage-stats-view.test.tsx`（T-D1 用例，约 799 行起；from > to 段约 830-838 行）
- 问题：T-D1 断言了「from > to 行内提示且不再发查询」，但未断言「非法期间旧流水保留」——切到流水页签加载出流水行后再进非法区间，既有流水行应仍在（不闪空态）。
- 改法：T-D1 的 from > to 段之前插入步骤：切到流水页签（makeInvoke 需带 requests 行数据）加载出流水行并断言渲染；随后设 from > to 进入非法区间，在既有「行内提示 + 不再查询」断言之外，补断言旧流水行仍在渲染树。
- 验收/测试：新断言绿。
- 来源：review-scope-desktop / round 1

---

#### review-scope-desktop/S-1 [P2] 0 值扇区跳过扇区 button 渲染（键盘/指针可达性等价）

- 维度：S（可达性——键盘/指针输入模态等价；评审自定义维度）
- 文件：`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx`（扇区 button 渲染，约 322-339 行；`a.value > 0 ? <path/> : null` 在约 336-338 行）；`apps/desktop/renderer/styles/shell.css`（约 7710-7718 行 button `pointer-events: none`、约 7733-7739 行 path `pointer-events: auto`）
- 问题：value=0 的行 path 不渲染但外层 button 仍渲染；而扇区精确命中依赖 path（button 整体不吃指针）——0 值扇区键盘可聚焦、Enter 可触发选中，鼠标却永远点不中，两种输入模态不等价，且 tab 会聚焦到一个不可见扇区。
- 改法：`totalTokens`/`value` 为 0 的行直接跳过扇区 button 渲染，仅保留图例（legend button）入口（图例本就全量渲染）；shell.css 的 pointer-events 布局不动。
- 验收/测试：desktop 测试绿；补断言（建议随 G-1 用例或新用例）：0 值行无对应 `data-slice` 元素、图例行仍渲染。
- 来源：review-scope-desktop / round 1

---

## Spec deviations

- **none**（round 1 三个 scope 评审均未报 open spec_deviations；末轮 review-full 结论为准，如有 open 项届时在此登记流转）

## Open questions / 待拍板（不阻塞 fix-spec-ready）

以下均为未认定项，供用户拍板，不进 must-fix：

1. **core** getDailyBuckets 内 parse 两次冗余（同一日期串重复解析）——是否合并为一次，待拍板。
2. **core** hourly 钻取 24 桶由 24 连查构成——是否单条化（SQL 单次聚合）留给后续迭代，待拍板。
3. **mobile** libraryEmpty 探底机制（combos 组合探空）与桌面端（全量 summary 探底）不一致——是否对齐两端机制，待拍板。
4. **mobile** 饼图固定四色在亮色主题下的取值差（与暗色主题同一组色值）——是否接受，待拍板。
5. **desktop** 空态探底查询假设「近一年（365 天）」窗口——一年后功能上线初期数据自然过期导致探底误判库空；临近一年期时改为全量 summary 探底，待排期。
6. **desktop** 窗口空（区间无数据）时流水查询照发——该口径是否确认保留（现状：照发、由分页结果空体现），待确认。
7. **跨端（round 2 补）** desktop 流水分页 50 条/页 vs mobile 10 条/页——base 既有现状非本迭代引入，PRD/spec 未规定页大小一致，是否对齐留待用户意愿。

## 已豁免（用户确认不修）

- 无（用户尚未豁免任何条目）。

## 合并后 QA（manual_user）

- 无（本轮评审未产出 manual_user 验收项；后续轮次如产出，追加于此——不阻塞 fix-spec-ready）。

## K 节建议（下游执行时闭合）

- 下游执行完上述 17 条后，按仓库惯例跑一遍 lint/format 与三端全量测试（core / mobile `NODE_ENV=test npx jest` / desktop）作为常规收尾；本 spec 未附带独立 K 类收尾项。

---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/token-usage-stats-ui-refresh/cr-fix-spec.md |
| dag_version / review_round | 3 / 3 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 17（review-full/X-1 并入 desktop/B-2 双端条目） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（跨端色板/空态/toggle/分页已查；分页 50/10 为 base 现状进 open questions） |
| C 类合并后 QA | 无 |
| 备忘 | round 3 轻量复核确认无冲突/无重复/无计数漂移 |
| 执行记录 | 2026-09-07 code-dev-loop 三路并行闭合 17/17：core 023c376、mobile ed86c8f+ccdd9b9、desktop 327b7c9+a14d835（错字清理 fd82bc9）；cr-func func-ready: yes；两条实现偏差（G-1 行指纹断言、A-1 直接属性访问钉子）经复核判语义等价/必要修正；三端全量 core 1794 / desktop 109 / mobile 1093 + 整仓 typecheck 0 |
