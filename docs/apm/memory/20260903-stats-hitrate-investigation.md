---
date: 2026-09-03 23:05
title: 数据统计命中率疑似 bug：流水看着 90%+、汇总卡片只有 ~80%——口径排查与待验证假说
keywords: token usage stats, 缓存命中率, 命中率, billed_input, cache_creation, usage-stats.service, hitRate, sqlite 验证
abstract: 用户反馈统计页汇总命中率 ~80% 但流水记录看着 90%+。代码排查确认两端 UI 均为加权总比 cacheRead/billedInput（无 avg-of-avg bug），SQL 口径与协议解析语义自洽；列出四个数据侧假说（cache_creation 稀释、低命中 provider/model 混入、中转站口径异常、区间含早期低命中日），待用户提供 sqlite 文件按既定 SQL 清单验证。
---

user:
检索记忆文件，我们之前开发过数据统计功能。现在感觉汇总有 bug：流水记录的缓存命中率看着挺高的，应该能 90% 以上，但实际显示只有 80% 的平均命中率。你先探索回忆，我等会给你 sqlite 文件，你可以验证下。

assistant:
翻出 RULE.md 第 44 条（数据统计口径）与 token-usage-stats 系列记忆，通读聚合服务、两端 UI 与协议解析层，确认代码口径自洽：命中率出口只有汇总卡片与选中天汇总行，公式均为加权总比 hitRate = cacheReadTokens / billedInputTokens（desktop `TokenUsageStatsView.tsx` 与 mobile 共享 format.ts 同口径），流水列表不含每行命中率列，不存在「平均数再平均」。SQL 侧 billed_input 对 anthropic 行 = prompt + cache_read + cache_creation（input_tokens 不含 cache，须加回），其余协议 = prompt（openai/gemini 的 prompt 已含 cached）；分母 FILTER 只收 cache 两列非 NULL 的行，显式 0 计入（usage-parser 与 backfill 迁移口径一致）。

待 sqlite 验证的假说（按嫌疑排序）：① cache_creation 稀释——anthropic 长工具循环里 cache_creation 不小（分段重写），用户看流水只对比 cache_read 与输入、脑内没把 creation 算进分母；② 混入低命中率 provider/model（没开缓存或缓存差的渠道）把加权拉低，而用户眼睛看的是主力模型流水；③ 中转站口径异常——anthropic 协议但 input_tokens 已含 cache（分母近似翻倍）或 openai 协议但 prompt 不含 cached；④ 区间错位——汇总默认 last30 含早期未做回合快照优化的低命中日，流水看的是最近的。验证 SQL 清单：整体重算对账卡片、分 provider×model 各自命中率、去 cache_creation 口径对照、每行命中率分布（均值/p50/p90）、按天命中率曲线、异常行扫描（openai 行 prompt < cache_read、anthropic 行 prompt > cache_read 的比例）。

user:
sqlite 文件在手机的 360 目录下叫 统计数据.nmbackup（注意不是 novel-master-backup-*.nmbackup），用 0903 当天的智谱 glm-5.3 数据算，量小更准。

assistant:
adb 拉取 /sdcard/360/统计数据.nmbackup（83MB，user_version 10）验证完毕，结论：**汇总无 bug，加权口径正确，低命中率是真实数据**。① 全表重算 71.4%（589 行 cache 非 NULL，无 anthropic 行、cache_creation 全空——creation 稀释假说出局）；② 分模型：glm-5.3 全程 84.3%/近7天 84.9%、glm-5.2 79.7%，三个 gemini 中转模型 104 行仅 0~6%（raw_json 抽样显示上游明确上报 prompt_tokens_details.cached_tokens:0，是上游无缓存不是解析丢字段）；③ 0903 glm-5.3 逐行 33 通：24 通 ≥90%（用户 90%+ 观感来源），但 4 通 0% 命中全是 12万~15万 token 的大请求（合计 53.7万 prompt），加权被拉到 82.5%；反事实把这 4 行按 ~99% 算则是 ~94%——用户直觉对应的是"缓存不过期"世界线。④ 4 行 0% 的规律：都是空闲 18 分钟以上的第一通（00:47 当天首通、30min、18min、7.5h），3.5 分钟间隔的行仍有 96% 命中 → 智谱上下文缓存 TTL 介于 3.5~18 分钟，过期后整段 12 万+ 上下文按未命中重新计费；另有 01:23:20 隔 10 秒的 40% 部分命中（部分段过期）。可选产品改进（非 bug）：流水页加每行命中率列让 0% 行可见；或汇总卡片提供"剔除缓存过期行"的对照口径。

user:
去除初始化的 4 条，平均命中率是多少？

assistant:
0903 glm-5.3 去除 4 条 0% 过期重初始化行后（剩 29 通）：加权 93.1%（prompt 4,187,333 / 命中 3,898,816），逐行简单平均 90.8%——用户"90%+"直觉在剔除缓存过期行后完全成立；4 行仅占 12% 调用数却贡献 11.4% 的 prompt 量。
