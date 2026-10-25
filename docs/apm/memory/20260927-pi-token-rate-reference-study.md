---
date: 2026-09-27 15:36
title: 参考实现与业界调研：实时 token 速率与计数——pi 无实时速率、无真分词器（唯一可借鉴项是「usage 基线 + trailing 偏移」）；全网 agent 主流只做「结束后累计平均」，实时速率基本只有社区插件在做
keywords: pi, earendil-works, Pi Agent Harness, 参考实现, 业界调研, 实时 token 速率, token 计量, chars/4, usage 基线 + trailing, TTFT, 滑窗, EMA, 社区插件, OpenChamber, Cherry Studio, Ollama eval_duration, llama.cpp timings_per_token, .reference
abstract: 应用户要求研究 `.reference/pi`（Pi Agent Harness，2026-09-27 克隆，HEAD 2b0a123de）怎么实现实时 token 速率与计算，并进一步做了全网调研。pi 实测结论：全仓**没有实时速率**（唯一痕迹是仓库自带 `.pi/extensions/tps.ts` 47 行本地扩展，agent_start→agent_end 全程平均 + 通知式显示，正是用户拍板否定的那一档）、**没有真 tokenizer**（packages 依赖零命中 tiktoken/gpt-tokenizer/sentencepiece，全用 chars/4 折算 + 图片 4800 字符）、**没有增量计数**；上下文占用走「provider usage 基线 + 之后 trailing 消息折算」并做三重有效性过滤（aborted/error/零值不作基线、更晚时间戳前缀消息使其失效、压缩后无新 usage 显示 `?`）——这是唯一有实质价值的可借鉴候选（我方现为「append 即失效 → 整轮全量本地重算」，改它需把消息锚点字段请回来，属产品口径变更，待拍板）。业界调研（四路只读子代理 + 主代理抽查三处官方证据）结论：**主流只做「结束后累计平均」**（Jan/Goose/Cherry Studio/DeepChat；Open WebUI/LibreChat/Lobe Chat/Chatbox 以及 Claude Code/Codex CLI/Gemini CLI/Aider/Cline/Roo/OpenCode/Crush 连速率都没有，多家 issue 被 closed as not planned），**真·实时速率几乎只有社区插件在做**（opencode-tps 5s 窗、pi-token-speed 1s 窗 + 下限 100ms + 跨 idle gap 回溯、DeepSeek-Reasonix 4s 窗且只由到达事件驱动、窗口过期一步归零）；口径分野三条（引擎自报 vs 客户端自算；分母是否含 TTFT/prefill/工具时间——llama.cpp 连免费首 token 都扣；分子 chunk≠token）；真实踩坑案例（OpenChamber #3500 残留窗口显示 ~392250 tok/s → 加 5000 上限；UniPi 重启后编造时长把 100 tok/s 显示成 7 tok/s）。我方 v1.5.23 的「滑窗实时 + usage 重锚 + 冻结末值跨重启」组合在调研中未见第二例，领先明确；可补项按性价比排序：TTFT（所有认真做速率的实现都配了它）、合理性上限钳制、双口径（纯解码 vs 含工具端到端）。
---

user:
恢复记忆，我记得最近优化了实时 token 速率统计和计算，[.reference/pi](./.reference/pi/) 你看看 pi 是怎么实现的，我们是否有可借鉴优化的地方。

assistant:
（会话初始化：读 RULE.md + 最近记忆摘要；确认「最近优化」= 2026-09-26/27 那一串——④ stream-metrics-tokens、三条修复（usage 重锚基线 + js-tiktoken 尾窗增量 + 上下文口径治本）、`context-usage-real-tokenizer-fallback` 敏捷项、两轮 CR 全执行，全部已随 **v1.5.23**（`cb4d1645`）发布；`.reference/pi` = 2026-09-27 13:10 克隆的 Pi Agent Harness 本体，HEAD `2b0a123de`，只读参考。）

三路只读 Explore 并行（两路查 pi：token 计数 / 实时速率与 telemetry；一路梳理我方实现作对照），主代理逐项抽查关键结论。

**核心结论：pi 这块没有可抄的。** ① **没有实时速率**——`packages/**` 关键词全扫（tokensPerSecond / tok/s / tokens/s / tokenRate / perSecond）只命中三类非功能件：`ai/src/providers/faux.ts` 的假 provider 节流参数、OpenRouter 路由配置 `preferred_min_throughput`、测试文件；唯一真实实现是仓库自带的 `.pi/extensions/tps.ts`（47 行、upstream 已跟踪、`git ls-files` 实证）——`agent_start` 记 `Date.now()`、`agent_end` 把 `event.messages` 的 assistant `usage.output` 求和相除、`ctx.ui.notify` 弹一条，**全程平均**且分母跨整个 agent loop（含工具执行，系统性低估），正是用户拍板否定的那一档；pi 的 footer 只有累计 ↑input ↓output R/W cache、cache 命中率、成本、上下文百分比（`footer.ts:84-166`），流式期间不刷新、无任何数字指标，连 elapsed 计时都没有。② **没有真分词器**——12 个包的 package.json 依赖全扫，`tiktoken|gpt-tokenizer|sentencepiece|tokenizer` **零命中**；计数一律 `Math.ceil(text.length / 4)`（`ai/src/utils/estimate.ts:15-16,38-44`），图片固定 4800 字符。③ **没有增量计数**（没有 encode 过程，也就不需要尾窗），全同步纯函数、无缓存无预热。

**pi 唯一做得像样的是上下文占用（prompt 侧）**：`estimateContextTokens`（`ai/src/utils/estimate.ts:97-112`）走「**最后一条可用 assistant 的 provider usage 当基线 + 只对基线之后的消息做 chars/4 折算**」，返回 `{tokens, usageTokens, trailingTokens, lastUsageIndex}` 把「真值 / 猜的部分」分开暴露；基线有效性**三重过滤**（`estimate.ts:71-95`）：aborted / error / 总零的 usage 一律不作基线、有更晚时间戳的前缀消息（如 compaction 摘要）插入则该 usage 失效；压缩后没有「压缩之后的 assistant usage」时返回 `tokens: null`、UI 显示 `?/200k`（`footer.ts:113/153-155`），压缩触发侧同样「不确定就不压」（`agent-session.ts:2709-2726`）。另外它 abort 中途也能拿到部分真值：adapter 流式期间持续覆盖写 `partial.usage`（`anthropic-messages.ts:764-795`），并有 per-provider「aborted mid-stream」测试矩阵。

**可借鉴项逐条评估（主代理判定）**：
- **A（唯一实质候选，待拍板）「usage 基线 + trailing 偏移」口径**：我方现在是「任何 append 即失效 → 该 run 整轮压缩判定与 UI chip 全退本地全量计数」（fix-spec v2 的 #11(ii)，当时有意选的口径，理由是陈旧 api 值不含新消息、会系统性低估）。pi 的形态正好补掉这个理由：**保留真值基线，只对新增尾巴做估算**——真值覆盖的部分不承担估算误差，尾部只补一小段。收益：更准（尤其 native 不可用/未知模型的折算兜底档）、更省（不必每 step 全量重编码）。代价：需要把「基线覆盖到哪条消息」的锚点存回来（正是 OQ #4 刚按「只写不读就移除」删掉的 `lastMessageSeq` 类字段——它会因此获得真实读侧消费），且「上次请求 / 预估」两态标签的语义要重新定义第三态（如「上次请求 + 新增估算」）。属产品口径变更，未动手。
- **B 读时有效性校验**：pi 的三条过滤我方其实已等价覆盖——写入侧 `agent-runner` 只在 `stopReason === "completed"` 时写（aborted/error 天然不写）、读侧 `parseSessionApiPromptTokenEntry` 把 `promptTokens` 非有限/为负/为 0 与损坏行一律判 miss、compaction/append/换模型等 18 个调用点挂点清值。差异只是「读时兜底 vs 写时清值」；作为「防漏挂点」的第二道防线可考虑，但要锚点字段、收益边际，**建议暂不做，登记备选**。
- **C abort 中途 usage 保留**：我方解析层已有实测覆盖（anthropic T-M1 message_delta 累计 emit、gemini T-M2 每块累计变化 emit + usage-only 收尾块），mobile 侧另有 interrupted 语义与 settle 断言的测试组；缺口不大，无需抄。
- **D 未来可选：TTFC + chunk_count + output_tokens 最小可观测三件套**：pi 在 `agent/src/harness/telemetry.ts:94-107` 定义了 `pi.ai.stream.time_to_first_chunk_ms` / `chunk_count` 等属性但**全仓零写入点**（schema 有、上报无）；我方目前也只在 `session_run_state` 存 completion_tokens/token_source。若将来要做「线上诊断速率异常」，这三件是划算的最小集。属未来项，未登记为待办。
- **E 不需要抄的**：TUI 的 16ms 全局渲染节流 + `requestRender(force)` 抢占（`packages/tui/src/tui.ts:507,990-1030`）——我方已有 250ms 渲染 tick + 32/64ms 事件整流，终端场景的骨架不适用 RN/Electron。
- **F 反面印证两条**：① pi 的估算逻辑被复制 3 份且**已漂移不一致**（pi-ai 版计 `toolsRemoved`，coding-agent 版不计；三个 `ESTIMATED_IMAGE_CHARS` 各自硬编码）——印证我方 CR 把公式/标签下沉 core 单点的方向；② chars/4 对中文**低估约 2.4 倍**（真值约 chars/1.64），而 pi 注释自称 "conservative (overestimates tokens)"（只对拉丁文成立）——它靠 `reserveTokens: 16384` + 请求侧 `CONTEXT_SAFETY_TOKENS: 4096` 大 buffer 兜底；我方中文本位场景下 js-tiktoken 尾窗增量 + heuristic 档 0.85 系数的决策被外部实证强化。

**交付**：结论为「pi 在实时速率与 token 计量上整体落后于我方差一个量级，无可直接照抄项」，唯一值得拍板的是 A（上下文占用改「基线 + trailing 偏移」）。本轮**未改任何代码、未动 worktree、未推送**；A 落地与否待用户决定。

user:
是我记错了？那你搜索网络看看，网上的agent都是怎么统计token速率的？

assistant:
（四路只读网络调研子代理并行 + 主代理抽查三处官方证据）**先答「记错没」：没全记错**——pi 仓库里确实有 tps 的东西（就是 `.pi/extensions/tps.ts`），而且 pi 生态还有第三方扩展 `pi-token-speed`（1s 滑窗、下限 100ms、同时间戳跨 idle gap 回溯），所以「pi 有 token 速率」这个印象很可能是从这两处来的；但 pi 本体产品没有实时速率，这一点已实锤。

**业界全貌（分三档）**：① **完全没有**——聊天 UI 侧 Open WebUI / LibreChat / Lobe Chat / Chatbox（代码级零命中），编码 agent 侧 Claude Code / Codex CLI / Gemini CLI / Aider / Cline / Roo Code / OpenCode / Crush（代码或官方文档级确证；Claude Code #81897「Live TPS display」与 opencode #6096 均 closed as not planned，opencode 生态因此冒出 4 个同款 TPS 插件 fork）；② **结束后一次性累计平均**（这一档是主流）——Jan、Goose、Cherry Studio、DeepChat；LettuceAI 是实时但用 1s 心跳推累计平均；③ **真·实时**——几乎只有社区插件与个别工程化实现：opencode-tps 系（5s 滚动窗）、pi-token-speed（1s 窗 + 100ms 下限 + 回溯）、DeepSeek-Reasonix（4s 窗、**只由到达事件驱动、窗口过期一步归零**，注释明确反对定时器平滑衰减——那会暗示模型还在写）、commandcode（1.5s 窗 + EMA τ=600ms，8fps 重绘）。
**数据来源与口径三条分野**：a) 引擎自报 vs 客户端自算——Ollama 官方公式 `eval_count / eval_duration * 1e9`（纳秒；仅 done:true 最后一块出现；不含 load/prompt eval，且**不扣首 token**）、llama.cpp `predicted_per_second`（默认仅最终响应；`timings_per_token: true` 是唯一官方支持中途给 timings 的引擎；**分子扣掉免费首 token**（n_gen-1））、LM Studio SDK 有 `tokensPerSecond` + `timeToFirstTokenSec`、vLLM/SGLang/TGI 的 OpenAI 兼容接口只有 usage（vLLM 的 `avg_generation_throughput_toks_per_s` 已废弃，改 Counter + Prometheus rate）；Jan 的写法最干净——引擎值优先、客户端 `outputTokens/duration` 兜底。b) 分母口径——认真做的那批都从「第一个内容 token」起算（排除 TTFT/prefill），oobabooga 与 TGI 反而含 prefill → 跨工具数字天然不可比。c) 分子——chunk ≠ token（SillyTavern 的 TPS 实为 chunks/s）。
**别人踩过的坑（有真实案例）**：OpenChamber #3500 残留窗口除出 ~392250 tok/s → 引入 `MAX_PLAUSIBLE_TOKENS_PER_SECOND = 5000`、超限返回 null（主代理已 fetch 其 telemetry.ts 原文复核：`tokenRate(tokens, durationMs)` 双守卫 + 双口径 `responseTokensPerSecond`（合并流式区间、拒绝含工具 part 的记录）vs `tokensPerSecond`（`totalDurationMs - toolDurationMs`）+ `avgTtftMs`）；UniPi 重启后用「扫描器首次看到消息的时刻」当完成时刻，把 100 tok/s 显示成 ~7 tok/s，结论是「不可测量的 step 必须剔除，不得用编造时长平均」；多步聚合要用 Σtokens/Σduration（Cherry Studio 的 token 加权）而不是 mean(每步 tps)；前 1 秒分母过小会闪离谱值（LettuceAI 加 `elapsed >= 1s` 守卫）。评测机构口径：Artificial Analysis 的 output speed 是「首 token 之后」的平均、对不暴露 reasoning 的模型取最后 80% chunk、72h 中位数。
**对我方的启示**：我们的「2.5s 滑窗实时 + usage 重锚基线 + 冻结末值落 KKV 跨重启」组合在调研里**未见第二例**（社区插件都是纯客户端估算、无真值重锚、无冻结持久化），领先明确；可补项按性价比：① **TTFT**——所有认真做速率的实现都把它当配套设施（Goose tooltip / Cherry Studio 四泳道 / OpenChamber avgTtftMs / vLLM 与 AA 单列），我们目前无此字段，这是最高性价比的一条；② 合理性上限钳制（我们已有同刻去重/时钟回拨/窗口折叠重 seed，加一条便宜兜底不亏）；③ 双口径（纯解码 vs 含工具端到端，Cherry Studio/OpenChamber 均如此，用于解释「这轮为什么慢」）。本轮**未改任何代码**；TTFT 等补强项待用户拍板。
