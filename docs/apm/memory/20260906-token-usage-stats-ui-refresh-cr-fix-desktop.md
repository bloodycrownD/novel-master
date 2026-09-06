---
date: 2026-09-06 10:02
title: token-usage-stats-ui-refresh CR 修复 desktop 节点（fix-cr-desktop）
keywords: token-usage-stats-ui-refresh, cr-fix-spec, fix-cr-desktop, parseLocalDate 日历溢出, 跨午夜补选, 0 值扇区可达性, pieSlicePath 整圆双弧, providers 延迟 resolve
abstract: fix-cr-desktop 节点闭合 cr-fix-spec round 1 desktop scope 七条 P2（G-1/G-2/G-3/B-1/B-2/C-1/S-1），commits 327b7c9 + a14d835：parseLocalDate 补 getFullYear/getMonth/getDate 回读校验（02-30 走行内 range-error）；「今天」补选改取 f.range?.toDay 根治跨午夜错位；饼图 0 值行跳过扇区 button 仅留图例入口；FilterDto 注释拆分两层校验职责；补四个测试缺口。desktop 全量 109/109 绿 + typecheck 绿。
---

user:
【语言要求】全程中文；代码注释与 commit message 中文；标识符保持英文。节点：fix-cr-desktop，类型：fix，仓库 novel-master，分支 feat/token-usage-stats-ui-refresh。按 cr-fix-spec 执行 desktop 七条：G-1 单行整圆双弧用例；B-1 parseLocalDate 日历溢出回读校验；B-2 补选取 f.range.toDay；C-1 FilterDto 注释拆分；G-2 providers 延迟 resolve 用例；G-3 custom 非法期间旧流水保留断言；S-1 0 值行跳过扇区 button。只动 apps/desktop/，全量测试 + typecheck 全绿后中文 commit（可拆 1-2 笔）。

assistant:
七条全部闭合，commits 327b7c9（fix：视图三处 + 注释）+ a14d835（test：四个缺口用例），desktop 全量 109/109 绿、typecheck 绿。要点：

- B-1：parseLocalDate 构造后回读 getFullYear/getMonth/getDate 三比对，不一致返回 null，自然并入 customRangeError 既有「请选择起止日期」文案（spec 明示走既有行内路径，未加新文案）；02-30 注入用例并入 T-D1 custom 测试，断言行内报错且全局 loadError 为零。
- B-2：reload 成功分支改 setSelectedDay(autoSelectToday ? (f.range?.toDay ?? null) : null)，today 路径 range 恒存在，?? null 仅类型兜底；既有 T-D4「hourly 自动拉取」用例不受影响（窗口 toDay 与 Date.now() 当日同值）。
- S-1：PieChart arcs 先 .filter(a => a.value > 0) 再 map，按钮内 path 条件渲染随之简化为无条件（过滤后恒真）；图例本就全量渲染，0 值行仅剩图例入口，键盘/鼠标一致。
- C-1：注释核对过 core 实际行为（usage-stats.service.ts L191-192 getDailyBuckets 缺 range 抛 chatInvalidArgument「日桶序列需要界」）才落笔，两层职责逐句对得上。
- G-1 用例：单行 + summary.totalTokens 对齐该行用量（占比 100%），断言 data-slice 内 path d 的 /A /g 恰 2 段；G-2 用例：nm:providers/list 返回手动 resolve 的挂起 Promise，act 内 resolve 后断言 label 翻转 + 扇区/图例 is-selected 不丢；G-3：T-D1 先切流水页签加载旧流水，02-30 与 from>to 两段都断言旧流水行仍在。
- 环境坑复用：desktop 测试须 NODE_ENV=development（NODE_ENV=production 会让 react-test-renderer 的 act 变 undefined 全崩）；全量首轮 ~300s（冷启动编译），复跑 ~10s，别被首次超时吓到。
