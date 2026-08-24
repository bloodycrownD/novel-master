---
date: 2026-08-24
title: token-usage-stats CR 修复循环功能闸检阅（cr-func-fix）
keywords: token-usage-stats, CR 修复, cr-fix-spec, must-fix, 竞态守卫, cached_tokens 0 值, DST, mobile/C-1 格式还原, 空态区分
abstract: cr-func-fix 只读检阅 7dbba5f..HEAD（core/desktop/mobile/docs 四 commit）对 cr-fix-spec must-fix 的闭合情况：17 条中 16 条闭合，唯一未修 mobile/C-1（RootNavigator/ProfileTabScreen prettier 整文件重排未还原，排期遗漏）；cross/B-2 mobile 侧 DST 专项测试缺（实现已修）；verify 抽查 4 个测试文件全绿。func-ready 判定 yes（附条件）。
---

user:
readonly 功能小检。节点：cr-func-fix。按 cr-fix-spec 的 18 条 must-fix 逐条对照 7dbba5f..HEAD 核实闭合；检查 verify 证据可信度（抽查重跑）；核实 spec deviations 3 条终态（重点 mobile/C-1 格式还原是否被排期遗漏）；评估 mobile 空态信号用 listModels（服务商配置同源）vs desktop 近一年探底的收窄是否可接受。禁止修改任何文件。

assistant:
只读核实结论（未改任何仓库文件）：

- 条目计数纠正：cr-fix-spec 实际 must-fix 为 17 条（P0 1 + P1 4 + P2 12，spec L16 自述「P2 12 条」），任务描述的 18 条（13 P2）多计一条。
- 闭合矩阵 16/17：唯一未闭合 mobile/C-1（#14）——git diff f45a4b4..HEAD 实测 RootNavigator.tsx 仍 ±270 行整文件重排、ProfileTabScreen.tsx 仍 65 行，8d4c66e 的 stat 里两文件零改动，坐实被排期遗漏；spec 待修清单仍在列。
- 小缺口：cross/B-2 mobile 侧实现已改日历加法（TokenUsageStatsScreen L230-234），但 mobile 测试文件无 DST 专项用例（desktop L749 有），spec 验收要求「双端各自测试文件」只满足一半。
- 其余全部闭合：core B-1（nonNegativeNum 三协议 + 回填同口径 + 分母用例）、双端竞态守卫（reloadSeqRef + 竞态测试）、mobile 单通道（useFocusEffect）、desktop 头注释、prd/L86（f29efab）、G-1/G-2 测试（DST 走纯函数 + 春秋两用例）、formatTokenCount 迁 shared/logic 互指、desktop/G-1 错误路径、J-1 hourly role=img、A-1 双端空态区分、C-orch-2 loadError、J-1 色值常量 TEXT_ON_PRIMARY、J-2 accessibility。
- deviations 终态：T-S4 路径回写✓（f29efab）、formatTokenCount 措辞回写✓（f29efab spec 变更点 8）、注册行重排→未闭合（即 #14）。
- 空态信号收窄评估：core listModels 查 llm_saved_model（服务商配置同源），mobile libraryEmpty = models.length===0 && summary!=null，语义实为「无任何已保存模型」；「已配置模型但从未对话」时 mobile 误显「该区间无数据」而非冷启动文案。desktop 用 365 天 custom summary 探底，是真·用量库空信号且带失败降级。判定：可接受（主干「区分两空态 + 保留今日卡」两端都满足，mobile 零额外查询），建议合并后 QA 或后续统一。
- verify 抽查重跑全绿：core usage-parser+backfill 26/26、usage-stats.service 19/19（tsx node test runner）；mobile token-usage-stats-screen 20/20（jest）；desktop token-usage-stats-view 10/10（run-tests.mjs，注意要传完整文件路径，传短名会报 Could not find）。
- 结论 func-ready: yes（附条件：#14 合并前排期补修——blame 污染随时间加重，spec 自述「越晚做越难甄别」；mobile DST 用例可随手补）。
