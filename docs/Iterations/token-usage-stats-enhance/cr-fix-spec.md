# CR Fix Spec: token-usage-stats-enhance

## 元信息
- repo: novel-master（worktree .woktree/token-usage-stats-enhance）
- base_sha: b3429b0 / head_sha: db9e5a0
- prd_path: docs/Iterations/token-usage-stats-enhance/prd.md
- spec_path: docs/Iterations/token-usage-stats-enhance/spec.md
- review_round: 1 / dag_version: 2
- 状态: fix-spec-ready（trivial 直接执行：单条 P2，主代理代写）

## Must-fix（按 P0 → P1 → P2）

### MF-1 [P2] mobile 统计页四个格式化函数两两重复
- 维度：C（DRY）
- 文件：apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx
- 问题：`formatTokensPerSecond`/`formatFirstTokenMs` 与 `formatDayTokensPerSecond`/`formatDayFirstTokenMs` 逻辑完全相同，仅空态文案不同（汇总页「暂无数据，自本版本起开始积累」vs 选中天「暂无数据」），同文件 4 个函数冗余。
- 改法：合并为带 `emptyText` 参数的一对函数 `formatTokensPerSecond(v, emptyText)` / `formatFirstTokenMs(ms, emptyText)`，调用处传各自空态文案。
- 验收：`apps/mobile/__tests__/token-usage-stats-screen.test.tsx` 既有断言（T-MB4 三形态：有值/空态完整文案/当日简短空态）零改动通过。
- 来源：review round 1（CR 统计增强子代理）

## Spec deviations
- none

## Open questions / 待拍板
- 时钟回拨可产生负耗时（spec 风险段已声明接受 Date.now 精度；如要更稳可在采集侧对 durationMs<=0 置 NULL，未认定）
- modelRequests.request 若内部重试，durationMs 覆盖整个重试序列（spec 口径未提，建议后续 spec 补一句，scope 外）
- desktop 空数据 max 标注显示 1、mobile 显示 0，可统一（无害）

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- 统计 Step 11 手工验收（旧库升级、速率/TTFT 量级、长按手势、prefers-reduced-motion）

## K 节建议（下游执行时闭合）
- MF-1 修复合并进本分支即可，无需单独迭代
