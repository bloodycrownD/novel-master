---
date: 2026-09-29 02:10
title: 统计页三处调整落地（e7746df5）：汇总指标卡三行重排 + 平均速率单位 tok/s（均仅 mobile，desktop 宽窗不动——用户澄清）；「服务商 · 模型」全面改「服务商/模型」斜杠（双端 7 处拼接点，对齐聊天侧 formatSavedModelDisplayName 的半角 / 无空格）
keywords: 数据统计, TokenUsageStats, SummaryTab, 指标卡重排, 平均速率, tok/s, t/s, 服务商·模型, 斜杠格式, formatSavedModelDisplayName, StatsFilterBar, PieChart label, 双端差异
abstract: 用户提三项统计页调整：①汇总指标卡重排为三行（总token/调用次数 → 平均速率/平均首字延迟 → 输入/输出/命中率）+ 速率单位 t/s→tok/s；②模型筛选下拉「服务商 · 模型」统一为「服务商/模型」；③分服务商×模型汇总 label 同改斜杠。两路只读探索定位全部落点后实现，中途用户澄清重排只针对 mobile（desktop 窗口宽、5 列布局不动，已撤销误做的 desktop 重排）。关键事实：速率单位双端原本不一致（mobile t/s / desktop tok/s），本次统一为 tok/s（聊天指标条仍 t/s，core 单源不动，与 desktop 既有并存先例一致）；斜杠格式基准是 core `formatSavedModelDisplayName`（半角 / 无空格），实现为 7 处拼接点直接换分隔符（mobile：StatsFilterBar 选项×2、Screen 筛选入口×2、SummaryTab 饼图 label×2；desktop：TokenUsageStatsView 饼图 label×1，图例/详情/aria 自动跟随）；desktop 模型下拉本就无服务商前缀（纯模型名），无需改。测试同步 mobile 7 处 + desktop 13 处断言；定向测试 mobile 56/56、desktop 25/25 全绿。CHANGELOG 进 Unreleased 两条（本轮期间并行会话发布了 1.5.26，饼图门槛条目被并入 1.5.26 定稿）。commit e7746df5（9 文件，未 push）。另清理 apps/mobile 下 0 字节 shell 重定向事故文件 `x[0])`。
---

user:
对了。数据统计页面还有几个需要调整的：1. 平均速率和平均首字延迟提升到上面，输出/输出下移，也就是总览结构为：总token/调用次数、平均速率/平均首字延迟（速率单位优化为 tok/s）、输入/输出/命中率 三行；2. 模型下拉选择统一，服务商 · 模型，统一成 服务商/模型，和模型选择下拉框统一；3. 分服务商×模型汇总也建议 服务商/模型 结构。

user:
（实现中途补充）忘记说了，总览结构我调整的是 mobile，desktop 不用动，我理解 desktop 的长宽比手机大？

assistant:
（两路只读 Explore 并行：指标卡结构/单位现状 + 「服务商 · 模型」拼接点与聊天侧基准格式；实现为主代理直改。）

**落地内容（commit `e7746df5`，main，未 push）：**

1. **指标卡三行重排（仅 mobile）**：`apps/mobile/src/screens/stack/token-usage/SummaryTab.tsx`——网格一（half 两列）：总token、调用次数、平均速率、平均首字延迟（4 张 half 卡 flexWrap 自然 2×2）；网格二（third 三列）：输入、输出、命中率（tone=success 保留）。用户澄清后撤销了误做的 desktop 重排（desktop 宽窗 5 列一行 + 换行两行本就合理，`shell.css` 已还原到 `repeat(5,...)`）。
2. **速率单位**：`token-usage/format.ts` 的 `formatTokensPerSecond` `t/s`→`tok/s`（原双端不一致：mobile t/s / desktop tok/s，本次对齐 desktop）。DetailTab 选中天汇总行复用同函数自动跟随。聊天指标条（core `format-stream-metrics-line`）仍 t/s 不动——desktop 早已两单位并存，属既有先例。
3. **斜杠格式统一（双端 7 处拼接点）**：基准 = core `formatSavedModelDisplayName`（`packages/core/src/domain/provider/logic/format-saved-model-display-name.ts`，半角 `/` 无空格）。mobile：`StatsFilterBar.tsx` 配置组合/服务商其他模型选项×2、`TokenUsageStatsScreen.tsx` 筛选入口文案×2、`SummaryTab.tsx` 饼图 label×2；desktop：`TokenUsageStatsView.tsx` 饼图 label×1（图例/点选详情/扇区 aria-label 消费 label 自动跟随；label 后的「 · 用量/N 次/占比」指标分隔中点有意保留，与页内其它指标分隔一致）。desktop 模型筛选下拉本就无服务商前缀（`kind:"models"` IPC 回纯模型名数组），无可统一项、未动。
4. **测试同步**：mobile `token-usage-stats-screen.test.tsx` 5 处中点断言 + 2 处单位断言（`45.5 t/s`→`tok/s` 等）+ 相关注释；`token-usage-format.test.ts` 2 处单位；desktop `token-usage-stats-view.test.tsx` 13 处（`OpenAI 官方/gpt-4o`、`未知服务商/glm-4.6`、`智谱中转/其他模型` 等 replace_all）。PieChart 组件级 fixture（'A · m1' 等）label 由测试自带、不测拼接源，保留不改。
5. **验证**：mobile 定向 jest 2 文件 56/56 绿；desktop `npm test -- test/token-usage-stats-view.test.tsx` 25/25 绿（run-tests.mjs 支持传具体文件绕过 glob 假绿坑）。
6. **CHANGELOG**：Unreleased 段补两条（指标卡重排+单位；服务商/模型格式统一）。本轮期间并行会话发布 1.5.26（tag 已推），上一轮饼图门槛条目被其并入 1.5.26 定稿段。

**杂项**：清理 `apps/mobile/x[0])`（0 字节 shell 重定向事故文件，非本轮产物）。
