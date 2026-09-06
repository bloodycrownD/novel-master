# CR Fix Spec: mobile-charts-redo

## 元信息
- repo: novel-master；base_sha: ecadd487；head_sha: c310ccc2（feat/mobile-charts-redo）
- prd/spec: docs/Iterations/feature-optimizations-2026-09/features/mobile-charts-redo/{prd,spec}.md
- review_round: 1 / dag_version: 1（diff 模式单轮）
- 状态：fix-spec-ready

## Must-fix

### MC/C-1 [P2] 测试文案 typo「不塔」→「不崩」
- 维度：C
- 文件：`apps/mobile/__tests__/stacked-bars.test.tsx:13`、`:286`；`apps/mobile/__tests__/token-usage-stats-screen.test.tsx:1342`
- 问题：三处「不塔」应为「不崩」（除零安全语境，spec T-MC3 原文即「不崩」）；会原样出现在测试报告标题里
- 改法：三处直接替换
- 验收/测试：`grep 不塔` 零命中；触碰的两测试文件跑绿
- 来源：review-diff-mobile-charts-redo / round 1

### MC/G-1 [P2] onLayout 挂载点结构性断言补强
- 维度：G
- 文件：`apps/mobile/__tests__/stacked-bars.test.tsx`（T-MB1 内）
- 问题：「测量点在 ScrollView（宽不含刻度列）」无断言——实现若退回挂根 View，全部用例仍绿、柱宽会默默多吃 40px
- 改法：T-MB1 补一条「带 onLayout 的节点 `horizontal === true`」断言
- 验收/测试：断言存在且绿
- 来源：review-diff-mobile-charts-redo / round 1（G 缺口）

## Spec deviations
- none

## Open questions / 待拍板
- 百分比逐行 `Math.round` 合计可能 99%/101%（三等分切片 33+33+33）：公式与详情行同轨无技术问题，是否加「合计可能非 100%」脚注属产品决策
- 三档刻度值可加 `accessibilityLabel`（如「最大 1.5K」）增强读屏语境（可选）

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- Step 5 真机视觉验收：三档刻度与图例百分比、max 标签上浮 13px 观感、30 天滚动时刻度恒可见、长 label 截断不顶掉百分比、0 档与 x 轴标签错列

## K 节建议（下游执行时闭合）
- MC/G-2（可选）：奇数 `maxTotal` 的 mid 取整值断言补强（`round(1501/2)=751→"751"`）
