---
date: 2026-09-26
agile_trace: true
---

# stream-multi-step-rate-freeze 实现规格（SPEC）

## 根因 / 方案摘要

根因有两条，互为因果：

1. **回写门拦死**：`tokenSource` 翻为 `usage` 后 heuristic 不再回写（原为「真值优先，防估算抖动」），而 run 级 usage 是「已 done 各 step 的 usage 之和」，本 step 正在流式输出的增量在 usage 到达前没有回写通道 → 第二步数字冻结；
2. **样本断流 → 窗口折叠**：数字不增长就没有新样本，跨 step 静默后滑窗内只剩一条样本，`freeze()` 折叠为 null → 无速率段。

方案（用户拍板）：**usage 基线 + 增量偏移**，并把采样器的「校正点重 seed」从「仅 source 翻转」扩为「source 翻转 + 窗口折叠后的首个新样本」。

## 变更点清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/core/src/domain/format/sliding-token-rate.ts` | `sample()` 在「与上一采样相隔 ≥ 窗口时长」时先刷回落值再清窗重 seed；内部 `flippedRate` 更名 `lastSettledRate` 并更新语义；公开接口不变 |
| 2 | `apps/mobile/src/services/session-stream-unit.ts` | 删除 `tokenSource === 'heuristic'` 的回写门；新增私有 `heuristicBaseTokens`（不进 `metricsAcc`，投影形状不变）；`ingestDelta` 走 `max(0, 基线 + 增量估算)`；`ingestUsage` 重锚基线；`begin()` 归零基线；`hydrateFromRunState` 防御性重锚 |
| 3 | `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` | 同构：`MetricsAcc.baseTokens`、`noteUsage` 重锚、delta 继续叠加 |
| 4 | `packages/core/src/domain/session-run-state/model/session-run-state.ts` | 注释口径改写（`tokenSource` 只表示基线来源，不再表示「不再回写」） |
| 5 | 文档口径 | ④ `features/stream-metrics-tokens/{prd,spec}.md` 的「已知、接受」条目标记推翻；CR `cr-fix-spec.md` 的 D11 / Q7 / 验收观察项③ 加推翻注记（历史记录保留原意） |

## 详细改动说明

### 采样器：校正点重 seed 扩为两类（core）

```ts
} else if (lastTokens !== tokens) {
  if (nowMs > lastSampleMs) {
    if (nowMs - lastSampleMs >= SLIDING_TOKEN_RATE_WINDOW_MS) {
      lastSettledRate = tailRate() ?? lastSettledRate;   // 折叠前末值 → freeze 回落
      samples = [];                                       // 旧样本已进不了任何未来窗口
    }
    samples.push({tMs: nowMs, tokens});
    ...
```

- **不采用「每次 usage 都清窗」的更激进口径**：`gemini-sse-parser.ts` 每个候选块都 emit 一条 usage（累计值变化才发），而 `rateAt()` 没有回落值——逐条清窗会把实时速率反复清成 null（速率段闪没），是回归。窗口折叠重 seed 达到了同样的终态效果（`freeze()` 给出最后一段稳定速率）且无闪没。
- 公开 API（`sample` / `rateAt` / `freeze` / `reset`）不变，既有 14 条 core 采样器用例全绿。

### unit / hook：基线重锚

- `completionTokens = max(0, 基线 + 增量估算)`；
- usage 到达：`基线 = 真值 − 当时的增量估算`，`tokenSource = 'usage'` 保留为 provenance；
- 未注入 token 估算器（见 `features/stream-live-token-estimator`）时，增量估算仍是 `ceil((textChars+thinkingChars)/3.35)`（对累计字符取 ceil），**与旧口径严格一致** → 既有 200+ 用例零行为变化；
- `metricsAcc` 形状不变（多个用例按精确形状 `toEqual`，内部状态不得混进投影），基线放单元私有字段。

## 测试策略

### 测试用例

- core：窗口折叠后新样本重 seed（`freeze()` 回落折叠前末值）；跨静默（>2.5s）后旧样本不进窗口；时钟回拨分支不变（新增 3 类，合计 12 条采样器用例全绿）。
- mobile：多步 run 用例（工具 step 无文本 + usage → 文本 step delta → token 继续增长、终态速率非 null）；原 T-M5 断言改写为「usage 后 delta 继续叠加」。
- desktop：`noteUsage` 后增量累加、多 step。
- 定向验证：core `test/domain/format/*`、`test/infra/tokenizer/*`（110 例全绿）；mobile 7 套件 120 例；desktop `use-agent-stream-metrics*` 8+10 例。

## 风险与回滚方案

- **终态持久化分支变化**：多步 run 由「无速率删键」变为「写键」；零输出 run（无样本）仍删键，`session-stream-unit-final-rate` 的零输出用例守恒。
- **校正瞬间的轻微高估**：同一基线内，step 收尾 usage 的校正量会落在收尾窗口（`(校正量 + 窗口内增量)/窗口时长`）。升级为真 BPE 估算后校正量降到 1% 量级（原启发式中文低估 70% 时该风险本会更严重）；跨静默的校验由「折叠重 seed」兜住。
- **回滚**：core 采样器改动与 unit/hook 改动分层独立，可分别 revert；只回滚 unit/hook 即恢复旧语义（采样器多出的折叠重 seed 不影响旧行为——旧路径下窗口折叠时回落值刷新只是让 `freeze()` 从 null 变成一个更近的有效值）。
