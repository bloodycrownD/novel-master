---
date: 2026-09-06
---

# 移动端统计图表重做技术规格（SPEC）

需求来源：`docs/Iterations/feature-optimizations-2026-09/features/mobile-charts-redo/prd.md`

## 设计目标

`StackedBars`（按天/24 小时条形图）补齐带刻度值的纵坐标（≥3 档含 0 与最大值），`PieChart`（汇总页）占比百分比常驻可见；交互契约（点选详情行、长按检视、钻取）与视觉风格不变；desktop 与数据层不动。

## 总体方案

**方案 A：自绘增强（已选，不引库）**。现状两组件合计约 340 行、契约测试完备、`react-native-svg ^15.15.5` 已具备所需能力；引库（victory-native/gifted-charts）与「视觉一致 + 交互保留」两条硬约束冲突且带来原生依赖风险，全面劣于自绘。

### 拍板（决策点与理由）

1. **条形图刻度档位 = 3 档对齐 desktop 语义**：max（顶）、max/2（中）、0（基线），每档「网格线 + 刻度值」。现状 ⅓/⅔ 两线语义与 desktop（max/½max/0）本就不一致，重做顺势统一；PRD 下限即 3 档，不引入 nice-ticks 凑整逻辑。
2. **刻度值标签列移出横向 ScrollView**（探索风险 2 的结构性修复）：现状 gridLayer 嵌在 ScrollView 内容层内，30 天超宽时 max 标签会滚出初始视口。新布局：外层行布局 = 左侧 ScrollView（柱 + 网格线，线铺满内容宽）+ 右侧固定刻度列（宽约 36px，三个 Text 按同比例 % 定位、右对齐、`tokens.textTertiary`）。网格线随内容滚动、刻度值恒在视口。
3. **testID 重定义**：`grid-line-max/grid-line-mid/grid-line-zero`（内容层）+ `grid-label-max/grid-label-mid/grid-label-zero`（外层刻度列）；`grid-max-label` 移除（被三档取代）。
4. **饼图百分比形态 = 图例行追加**（探索风险 5 的截断规避）：图例行改为 dot + label（`flexShrink:1` 保持单行截断）+ 百分比固定宽右对齐列（`{p}%`），不用切片直标（小切片放不下、满圆特判、成本高）。
5. **百分比分母显式选定 = 传入的 `totalTokens`（窗口汇总）**，与点选详情行同轨——解决现状「扇区角度按 data 内部 sum、详情行按窗口 totalTokens」的双轨隐式假设，两处读数一致；分母为 0 时显示 `0%`。
6. **svg mock 不动**：图例百分比是 RN `Text`，不新增 svg 元素（若实现偏离本方案用到 svg Text/G，须同步补 `jest.mock('react-native-svg')` 导出面——探索风险 7）。
7. 刻度值复用 `formatTokenCount`（`@novel-master/core/common`，与 grid-max-label 现状同源）；不改 core 的 format-token-count（desktop 镜像无需同步）。

## 最终项目结构

```
apps/mobile/src/components/charts/StackedBars.tsx   改：三档刻度 + 外置刻度列布局
apps/mobile/src/components/charts/PieChart.tsx      改：图例行百分比列
apps/mobile/src/screens/stack/token-usage/styles.ts 改：新增 pieLegendPercent 等样式
apps/mobile/__tests__/stacked-bars.test.tsx         改：网格/刻度断言
apps/mobile/__tests__/token-usage-stats-screen.test.tsx  改：三档与图例百分比断言
```

不改：SummaryTab/DetailTab（数据与 props 形状不变，分母沿用现有 `totalTokens` 传参）、core 数据层、desktop、RequestsTab、主屏编排。

## 变更点清单

| 文件 | 改动 |
|---|---|
| StackedBars.tsx | gridLayer 由 `[1,2].map`（⅓/⅔ 两线 + 右上 max 标签）改为三档线数组驱动；外层包行布局，右侧固定刻度列渲染三个刻度值（`formatTokenCount(maxTotal)` / `formatTokenCount(round(maxTotal/2))` / `0`）；`maxTotal===0` 时三档全显 `0`（除零安全，沿用现有 `maxTotal > 0` 守卫风格） |
| PieChart.tsx | 图例行布局改 dot + label(flexShrink:1) + 百分比列；`p = Math.round(d.totalTokens / totalTokens * 100)`，分母 0 → `0%`；`pie-legend-{key}` testID 不变（行内文本含百分比） |
| styles.ts | 新增 `pieLegendPercent`（固定最小宽、右对齐、textTertiary）等样式；`pieLegendLabel` 保持 `numberOfLines:1` |
| 两个测试文件 | 网格断言改三档（testID + 三标签文本）；饼图图例断言含百分比；交互断言（钻取/长按/详情行/aria label）原样保留 |

## 详细实现步骤

- Step 1 — phase-charts-bars — blocking: yes — qa: auto：StackedBars 三档刻度 + 外置刻度列重构（保持 `CHART_HEIGHT=140` 归一化、柱宽公式、ScrollView 行为、`bar-*` testID 与无障碍 label 不变）；`stacked-bars.test.tsx` 网格用例改写（T-MC1/T-MC2/T-MC3）；既有布局用例 T-MB1（居中/minWidth）与 T-MB2（30 柱超宽滚动）保留并适配测量点上移——断言语义不变，minWidth 断言值随「宽度不含刻度列」适配。
- Step 2 — phase-charts-pie — blocking: yes — qa: auto：PieChart 图例百分比列 + styles.ts 样式；`token-usage-stats-screen.test.tsx` 图例断言更新（T-MC4），确认 `jest.mock('react-native-svg')` 导出面无需扩。
- Step 3 — phase-charts-verify — blocking: yes — qa: auto：`NODE_ENV=test npx jest` 全量 + `npm run typecheck`；既有交互断言零回归（T-MC5/T-MC6）。
- Step 4 — phase-charts-docs — blocking: no — qa: auto：CHANGELOG Unreleased 图表改进条目。
- Step 5 — phase-charts-verify — blocking: no — qa: manual_user：真机看三档刻度与图例百分比视觉（含 30 天超宽滚动时刻度值恒可见、长 label 截断不顶掉百分比）。

## 测试策略

- T-MC1 — blocking: yes — 三档刻度存在：`grid-line-max/mid/zero` 三线 + `grid-label-max/mid/zero` 三值（max=1500 → `1.5K`/`750`/`0`）。
- T-MC2 — blocking: yes — 刻度列在 ScrollView 外（层级/结构断言表达「值不随内容滚动」）。
- T-MC3 — blocking: yes — 全零数据：`maxTotal=0` 三档全显 `0` 不崩。
- T-MC4 — blocking: yes — 饼图图例行文本含百分比（正常分母与 0 分母两例）；`pie-detail` 详情行口径不变。
- T-MC5 — blocking: yes — 交互回归：daily 钻取 hourly、长按 `bar-inspect`、点选扇区/图例详情行、aria label 全保持。
- T-MC6 — blocking: yes — 全量 jest + typecheck 绿。

## 风险与回滚方案

- 风险：外置刻度列挤占绘图宽 → 柱宽公式基于 ScrollView 内容器宽计算（现状 `onLayout` 测量点随布局上移到 ScrollView 自身），实现时确认测量值不含刻度列。
- 风险：0 档标签与 x 轴 `bar-label`（fontSize 11）视觉相挤 → 刻度列右置（与 desktop 同侧），基线标签与柱标签错列；真机 Step 5 验收把关。
- 回滚：组件级改动，revert 两组件 + 两测试即回退；无数据/接口变更。
