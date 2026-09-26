---
date: 2026-09-27
dependency: docs/Iterations/mobile-perf-2026-09/prd.md
---

# context-usage-real-tokenizer-fallback Feature PRD（上下文占用兜底估算升级为真分词器）

## 背景与变更动机

用户对上下文占用（prompt tokens）的本地估算提出质疑：**「js-tiktoken 比 3.5 估算好多了吧？任意一个分词器来估计都比直接 3.5 直接估强」**。

实测证实用户判断成立——`ceil(字符数 / 3.35)`（SillyTavern 口径）是**英文**系数，用来数中文是量级错误：

| 语料 | 折算读数 | 真值（cl100k） | 误差 |
|---|---|---|---|
| 中文叙事 30K 字符 | 8,967 | 49,151 | **−81.76%** |
| 中文无空白长串 8K | 2,398 | 15,209 | **−84.23%** |
| 英文叙事 30K | 8,972 | 5,417 | +65.63%（反向高估） |
| 结构化 prompt（XML+JSON 混排）30K | 9,144 | 11,752 | −22.19% |

误差根因：cl100k 对中文约 **1.64 token/字符**（≈ **0.61 字符/token**），对英文约 3.5~3.6 字符/token——一个常数不可能同时拟合两种语言。

**为什么这件事严重**：这个数字有三条消费方——① UI 的「上下文占用」chip；② **压缩判定**（`token-ratio.trigger` 拿它跟上下文窗口比）③ 调试面（CLI）。中文会话下低估八成意味着「快满了还在继续写」，是**最危险的方向**。

## 范围说明（相对原需求）

- **覆盖**：所有「字符折算兜底」的生产落点——RN 驱动 4 处（tiktoken 抛错 / family=heuristic / 原生不可用 / 未知家族）、Node 驱动 4 处 async 兜底 + web·sentencepiece 两个 impl 的加载失败兜底、mobile/desktop/CLI 各自的「无模型早退」与「异常兜底」。
- **不覆盖（有意）**：
  - core 的**同步** `TokenCounter` port（`HeuristicTokenCounter.countText/countMessages`）——port 是同步契约，改成 async 会波及全部消费方；它只作为「真分词器也建不起来」的最后一级。
  - Kotlin 原生分词器路径（Android 上 Claude/GLM/Qwen 等本来就走真分词器，无需改）。
  - desktop renderer 流式指标条的「未注入估算器」兜底——属 (B) 实时输出估算那条链，与本条（上下文占用）无关。
  - mobile 流式单元的「未注入估算器」兜底——`apps/mobile/src/services/session-stream-unit.ts:635-638`（`estimateIncrementTokens`（定义 `:629`）里两个估算器任一为 `null` 时仍走 `ceil(chars/3.35)`；⚠️ 行号以 `git grep` 实查为准，本文件落盘后可能漂移），与上一条同属另一条链。
- **行为变更（需知悉）**：RN 原生分词器不可用时，`counterKind` 由「家族名」**纠正为 `heuristic`** → 这些场景首次吃上压缩判定的 0.85 安全系数（压缩比过去更早触发）。这是修「拿近似值卡精确阈值」的诚实性问题，方向是更安全。

## 影响模块与接口

| 层 | 变更 |
|---|---|
| core | 新增导出 `countTextWithIncrementalTokenizer(encode, text)`（经 `infra/tokenizer` 与 `public/provider` 具名转出，已同步 `public-provider-allowlist` 快照）；`packages/core` 补 `js-tiktoken` devDependency（测试用真基准，lock 仅 +1 行） |
| `tokenizer-driver-rn` | 新增 `./encoding` 子路径与 `impl/encoding-cache.ts`（编码表单例）；4 处兜底收口到真计数 |
| `tokenizer-driver-node` | 新增 `impl/encoding-cache.ts`（`encoding_for_model` 单例、**缓存后不 free**）；4 处 async 兜底 + 两个 impl 的加载失败兜底收口 |
| apps/mobile | 编码表缓存下沉到驱动（消除同进程两份 ~200ms 表）；`chat-prompt-tokens.service` 两处兜底改真计数 |
| apps/desktop / apps/cli | `ChatPromptTokensService` 的「无模型早退」「异常兜底」与 CLI `prompt render --tokens` 的无模型分支同口径对齐 |

## 验收标准

1. **准确性**：中文文本的兜底读数相对真 cl100k 全量 encode 误差 **≤1%**（实测 +0.02%）。
2. **改造生效**：原生/家族分词器不可用时，中文读数**显著大于**折算值（用例钉 ≥1.5×，实测 5.2×）。
3. **安全**：单次 `encode` 入参恒 ≤64 字符（core 用例断言），病态输入（无空白长中文串）不退化。
4. **标签语义不变**：`counterKind: "heuristic"` / `estimated: true` / UI「预估」文案与 `~` 前缀保持；精确档（desktop tiktoken 成功路径）仍报 `tiktoken`。
5. **不越界**：同步 port 行为不变（有用例守住）；Kotlin 与 RN 原生桥未改。
6. **门禁**：core / mobile / desktop 全量测试**带已知基线红通过**、本轮零真回归；三端 typecheck 零输出；desktop renderer tsc 改动文件新增报错 0；三个 package 构建通过。

## 测试用例

| 组 | 文件 | 条数 | 覆盖 |
|---|---|---|---|
| core | `test/infra/tokenizer/count-text-with-tokenizer.test.ts` | 7 | 准确度 ≤1%、单次 encode ≤64 不变量、线性增长、两条失败路径（1:1 兜底 / 不倒退）、一次计数≈分块 |
| mobile | `__tests__/mobile-prompt-token-counter.test.ts` | 10（改 2 增 3） | 原生不可用改真计数 + counterKind=heuristic、**对照：中文读数 ≫ 折算**、family=heuristic/未知家族同口径、编码表建不起来才降级且不重试 |
| desktop | `test/chat-prompt-tokens.test.ts` | 4（增 T-T9c、T-T9d） | 无模型早退走真 cl100k（**反向验证过**：改回折算即红）；兜底 registry 用显式转发、`forSavedModel` / `forVendorModel` 可调用（形态护栏，CR fix-spec v3 `agile-2` 补） |
| Node 驱动 | `test/fallback-count.test.ts` + `test/count-prompt-llm-input.test.ts` | 4 + 1 新 1 改 | 两个 impl 加载失败走真计数、同步 port 仍折算、两级降级顺序、unknown-model 读数对齐真值（**该条已由扩断言的「改」覆盖**）、**新增：中文兜底读数远大于字符折算（`count-prompt-llm-input.test.ts`「中文兜底读数远大于字符折算（钉住真分词器真的接上了）」）** |

## 真机复验（并入 1310 包，见 CR fix-spec「合并后 QA」）

- Hermes 上**首次**「上下文占用」计数的耗时（编码表冷构造实测 Node 185–248ms，真机倍率未知 → 若 3~5× 需确保已预热）；
- 多 step run 里**每 step** 压缩评估的计数耗时（Node 单步 0.8ms 中位 / 7.4ms 峰值@病态串，真机待测）；
- 中文会话的「预估」读数是否明显变大（不再低估八成）。
