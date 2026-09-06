---
date: 2026-09-06 19:31
title: 移动端统计图表重做实现（三档刻度 + 饼图常驻百分比）
keywords: mobile-charts-redo, StackedBars, PieChart, 统计图表, 三档刻度, 图例百分比
abstract: feat/mobile-charts-redo 分支实现 spec Step 1-4：柱状图纵坐标改三档刻度（max/max÷2/0）并把刻度值列外置出横向 ScrollView；饼图图例行追加常驻百分比列（分母同窗口 totalTokens）；测试改写 T-MC1-MC4 后全量 jest 186 套件与 typecheck 全绿，三块提交（bars/pie/docs）。
---

user:
迭代 feature-optimizations-2026-09 的 mobile-charts-redo 节点实现：按 spec 实现 Step 1-4（柱状图三档刻度 + 外置刻度列、饼图图例百分比、测试更新、CHANGELOG），真机验收不做；全量 jest + typecheck 全绿后按逻辑块提交。

assistant:
在 feat/mobile-charts-redo 分支（基于 ecadd487）完成四步：

1. StackedBars.tsx：网格层由 ⅓/⅔ 两线 + grid-max-label 改为三档刻度（grid-line-max/mid/zero，top 0%/50%/100% 相对 CHART_HEIGHT）；外层改行布局——左侧 ScrollView（柱 + 网格线，onLayout 测量点上移到 ScrollView 自身，宽不含刻度列，柱宽公式输入不变）+ 右侧固定刻度列（36px，grid-label-max/mid/zero，右对齐 textTertiary）；maxTotal=0 三档全显 0；top 样式须标注模板字面量类型 `${number}%`（RN DimensionValue 不收宽 string，裸写会 typecheck 报错）。
2. PieChart.tsx：图例行 dot + label(flexShrink:1) + 常驻百分比列（RN Text 非新增 svg 元素，react-native-svg mock 导出面无需扩）；p=Math.round(d.totalTokens/totalTokens*100)，分母与点选详情行同轨（窗口 totalTokens），0 分母显 0%；styles.ts 新增 pieLegendPercent（minWidth 40 右对齐）。
3. 测试：stacked-bars 改三档断言（T-MC1 三线三值 1.5K/750/0、T-MC2 祖先链断言刻度列在 ScrollView 外/线在内、T-MC3 全零 0），T-MB1/2 保留适配测量点；token-usage-stats-screen 补图例百分比（屏幕级 38%/24%、组件级 28%/10%/2%）与 0 分母用例（T-MC4）。
4. CHANGELOG 新建 Unreleased 段记「统计图表更易读」条目（移动端）。

验证踩坑：worktree 里 core/cloud-sync-driver-s3/sksp-*/tdbc-driver-*/tokenizer-* 的 dist 与 webview-dist 全缺失——cloud-sync 类型不匹配错误（@aws-sdk 双 node_modules 版本漂移 3.1067 vs 3.1127）根因是 cloud-sync-driver-s3 无 dist 时 tsc 沿 node_modules 冒泡解析到主仓同名包；补齐各包 build + build:webview 后 10 个失败套件全消。终态：NODE_ENV=test npx jest 186 套件 1096 用例全绿、npm run typecheck（官方脚本三段）全绿。提交 57f34db9（bars）/ ad52f650（pie）/ 03cd9338（docs）。
