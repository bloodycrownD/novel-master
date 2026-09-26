---
date: 2026-09-26
dependency: docs/Iterations/mobile-perf-2026-09/prd.md
---

# context-usage-caliber-unify Bug PRD（上下文用量重启前后口径不一致）

## 背景

聊天页顶部的「上下文占用」显示（如 `88% • 327/128K · 自动`）与压缩触发判定**共用同一个读口** `resolveCurrentPromptTokens`。④/⑥ 真机验收期间用户观察到：**同一个会话的占用值在重启前后跳口径**（`~0% · 214/128K` → `~3% · 3.6K/128K`），要求本次一并检查治本。

## 现象描述

- 重启前：`~0% · 214/128K`（无 `~` 时是 API 口径，带 `~` 是本地估算口径——两次观测口径不同）；
- 重启后：`~3% · 3.6K/128K`；
- 同会话、无新消息、模型未切换，仅发生一次进程重启。

## 复现步骤

1. 在一个会话里跑完一轮 run（provider 返回 usage）；
2. 观察顶部占用显示（API 口径，无 `~`）；
3. 完全退出并重启 App，打开同一会话；
4. 同一位置的数字与 `~` 前缀发生变化（跌回本地估算口径）。

## 预期行为

- 同一会话的占用值在重启前后**来自同一口径**；
- 用户能一眼看出这个数字是「上次请求的真实占用」还是「本地预估」。

## 实际行为

- API 返回的 `promptTokens` 只存在**进程内 Map**（`session-api-prompt-token-cache.ts`），进程一退就丢；重启后读口 miss，跌回本地估算（`ceil(len/3.35)`，且**不数 tools 段**），`~` 前缀随之出现；
- 口径差异被 mock 的字符口径放大：`mock-openai-server.mjs` 把字符数直接当 `prompt_tokens`，于是屏幕出现 `214`（重启前，mock 的字符数）与 `3.6K`（重启后，本地按 3.35 折算）这类看起来相差 3 倍多的「同会话真配对」——**本地估算反而更接近真实 token 数**，但两种口径来回跳是实打实的问题。

## 影响范围

- 读口 `resolve-current-prompt-tokens.ts` 与其调用方：双端 UI（desktop 抽屉 / mobile 顶栏）、CLI、**压缩触发** `token-ratio.trigger.ts`（`counterKind === 'heuristic'` 才乘 0.85 安全系数——口径跳变会直接影响阈值判定）；
- 归属：本问题**不是** `stream-metrics-native` 分支引入（相关文件 `git blame` 早于分支基线），但由本次迭代治本。

## 验收标准

- 重启后仍读到同一份 API 占用（跨重启同口径）；
- 标签能区分「上次请求」与「预估」两态，`~` 只出现在预估态；
- 本地估算含 tools 段（压缩评估路径），使本地值与 API 值可比；
- 凡改变「当前可见 prompt」或模型绑定的路径（消息增删改、置位、回滚、压缩、导入、切模型/Agent、run 失败）执行后，陈旧占用**不得**在重启后复活。

## 回归测试要点

- core：读口跨重启语义（清空进程内热层后仍从 KKV 读到 api）、KKV 编解码容错（损坏/缺字段/指纹不符 → miss）、14 个失效挂点（至少覆盖 message.delete / rollback / 置位 / compaction / persistent-state）、tools 补计数（非空变大、空数组不变）；
- 压缩触发：KKV 命中（api，不吃 0.85 安全垫）与陈旧指纹降级两条路径 + 原 5 条阈值用例；
- 双端显示：desktop / mobile 标签两态断言更新。
