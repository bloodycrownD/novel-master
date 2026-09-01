# CR Fix Spec: stats-composer-fixes-2026-09

> 状态：draft ｜ review_round 1 ｜ dag_version 1
> 本 spec 只约束评审 must-fix 修复项，不改动业务行为定义。本轮无正式 PRD，需求背景（长文本输入变删除、统计 provider×model 复合维度、工具卡进 markdown 预览首进空白、速率单位改短）以 [docs/apm/memory/20260901-four-new-bugs-brain-storm.md](../../apm/memory/20260901-four-new-bugs-brain-storm.md) 为依据。

## 元信息

| 项 | 值 |
| --- | --- |
| repo | /home/bloodycrown/Dev/novel-master（分支 `fix/2026-09-stats-composer-markdown`） |
| base_sha | `631ac73`（main） |
| head_sha | `b8840b0`（fix/2026-09-stats-composer-markdown） |
| prd_path | 无正式 PRD；需求依据 `docs/apm/memory/20260901-four-new-bugs-brain-storm.md` |
| review_round | 1 |
| dag_version | 1 |
| 状态 | draft |

must-fix 共 4 条：无 P0，2 条 P1（CR-1、CR-2），2 条 P2（CR-3、CR-4）。全部纳入本轮修复，无豁免项。维度图例：B=行为正确性（回归 / 跨端 parity）、C-orch=跨域编排（跨端适配 / 链路一致性）、C=注释与实现一致性、G=测试基建（回归护栏）。

## Must-fix（按 P0 → P1 → P2）

本轮无 P0；以下为 2 条 P1、2 条 P2。

### review-full/CR-1 [P1] [B + C-orch] desktop 分模型汇总同名重复行、React key 冲突

- **文件**：
  - `apps/desktop/src/main/ipc/handlers/usage-stats.ts`（`toModelRowDto`，L72 起；L127 `getModelBreakdown` 调用点）
  - `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:669-674`（模型列表 key/标签）；另 L37、L566 两处「其他模型」语义注释
- **问题**：core `getModelBreakdown` 已改为 `(provider_id, model_name)` 复合分组（`usage-stats.service.ts:254 GROUP BY provider_id, model_name`）后，同名模型多服务商、以及「未记录服务商 × 已配置模型」的存量行会各自返回多行。desktop 侧 `toModelRowDto` 转换时丢弃 `providerId`，渲染端（TokenUsageStatsView.tsx:669-674）用 `modelName` 做 React key 与行标签——列表会出现多行同标签（含多个「其他」）、React key 重复，且跨端无适配、无测试锁住该行为。
- **改法（最小方案）**：DTO 转换处按 `modelName` 聚合一层——`calls` / `promptTokens` / `completionTokens` / `totalTokens` / `cacheReadTokens` / `billedInputTokens` 逐列相加，桌面粒度复原旧行为（每模型名单行）；`TokenUsageStatsView.tsx:37` 与 `:566` 的语义注释同步说明「core 已是 provider×model 复合维度，DTO 侧聚合回模型粒度」。desktop 上复合维度是否跟进另开迭代（见 Open questions ①），本条不做。
- **验收/测试**：`apps/desktop/test/usage-stats-ipc.test.ts` 增用例——mock `getModelBreakdown` 返回 `(p1, m)` 与 `(p2, m)` 两行，断言 DTO 输出仅一行、且各用量列为两行之和。
- **来源**：review-full round 1

### review-full/CR-2 [P1] [B + C-orch] mobile 筛选项与汇总行 parity 破坏——两类存量行不可筛选

- **文件**：
  - `packages/core/src/service/chat/impl/usage-stats.service.ts`
  - `apps/mobile/src/screens/stack/token-usage/format.ts`
  - `apps/mobile/src/screens/stack/token-usage/StatsFilterBar.tsx`
  - `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`
- **问题**：汇总按 `(providerId, modelKey)` 归并，但筛选项只有三种形态（`undefined`=全部、`null`=其他、对象=具体组合），导致 `(provider_id IS NULL, 模型在配置集)` 与 `(P, 模型不在配置集)` 两类存量行没有任何筛选项可以命中——旧版「每个汇总行都有对应筛选项」的 parity 被打破，这两类行展示得出却筛不出来。另外 `format.ts:83-84` 注释写「provider_id/model_name 均缺失」，与实现的实际口径「provider_id IS NULL（模型在不在配置集均归此）」不一致。
- **改法（方案 A）**：「其他模型」选项改为 provider 维度语义——选中传 `{model: undefined, providerId: null}`，SQL 只留 `provider_id IS NULL`，覆盖全部「未记录服务商 · *」行（标签改为「未记录服务商（历史）」）；每个服务商追加「{服务商} · 其他模型」项，传 `{model: null, providerId: P}`；`ProviderModelFilterValue` 对象形态扩为 `model` 可 `undefined`，`comboModel` / `comboProviderId` 映射支持只筛 provider 不筛 model；`format.ts` 注释按实际口径校正。
- **验收/测试**：
  - core 测试补两条：「未记录服务商 + 已配置模型」行可被 `providerId: null` 筛出；`(P, 未配置模型)` 行可被 `model: null + providerId: P` 筛出；
  - mobile 测试补选项生成与 filter 传参断言（含「未记录服务商（历史）」与「{服务商} · 其他模型」两项的传参形态）；
  - 加 parity 断言：无筛选时返回的每个 `(providerId, modelName)` 组合，至少能被一个筛选项命中。
- **来源**：review-full round 1

### review-full/CR-3 [P2] [C] FileEditorScreen 新旧矛盾注释

- **文件**：`apps/mobile/src/screens/stack/FileEditorScreen.tsx:83-87`
- **问题**：旧注释（L83-84）「只读分支延迟到交互空闲后再挂重预览；其余分支（会话工作区等既有路径）行为不变」与新注释（L85 起）「所有 scope 统一延迟挂重预览」直接矛盾，读者无法判断到底哪些分支延迟挂载。
- **改法**：删除旧表述、合并为一段——physical 大文件冷启动卡转场与 session 首进 markdown 空白同因（转场窗口内同步挂 WebView 会失败），全 scope 统一 80ms 延迟挂载。
- **验收/测试**：注释与实现一致（人工核对），无任何行为变更。
- **来源**：review-full round 1

### review-full/CR-4 [P2] [G] 输入自愈对账主修复无自动化测试

- **文件**：
  - `apps/mobile/src/components/chat/ComposerAtPathInput.tsx:145-166`（`emitMentionValue` 自愈对账段）
  - `apps/mobile/__tests__/chat-composer.integration.test.tsx`（用例补入该文件）
- **问题**：`emitMentionValue` 的原生对账自愈（`nativeTruthRef` 比对、重建值与原生上报不等时以原生文本为准）此前只有真机手工验证，组件集成套件零覆盖（T-AT2b 只测快速路径）——这是返工过两次的高风险区，没有回归护栏。
- **改法**：`chat-composer.integration.test.tsx`（该套件未 mock controlled-mentions，真实库可用）加两条用例：
  1. 驱动 `input.props.onChangeText(原生文本A)` 后，断言最终外层 `onChangeText` 收到 `mentionValueToPlain(A)`、组件内部值为 A——模拟库重建吃字后自愈回原生文本的路径；
  2. 对账后 truth 已清空——继续 `replaceCommittedText` 程序化写入，断言写入不被陈旧 truth 覆盖。
- **验收/测试**：两条用例进套件并通过。
- **来源**：review-full round 1

## Spec deviations

none（评审结论：无 open 项）。

## Open questions / 待拍板

不阻塞本轮修复，待用户拍板：

1. **desktop 是否同步上 provider×model 复合维度**：CR-1 只按最小方案复原桌面旧行为（DTO 侧按 modelName 聚合）；desktop 若要上复合维度（分列显示、筛选项对齐 mobile）另开迭代。
2. **reloadModels 失败静默成空态**：`providers.list` / `listByProvider` 抛错被 catch 吞掉、`combos=[]` 会触发冷启动引导——错误态伪装成「模型库全空」。旧版同款行为，属非回归；是否要区分错误态/空态待拍板。
3. **reloadModels 逐服务商串行 await**：服务商数大时偏慢（当前量级可接受），是否改并发待拍板。

## 已豁免（用户确认不修）

无。本轮评审无用户确认豁免的条目。

## 合并后 QA（manual_user）

不阻塞合并，由用户在合并后真机执行：

1. 长文本中文连续输入不丢字（含 @ 引用 tag 混排场景）；
2. 数据统计：同名模型跨服务商在 mobile 分列显示、下拉含「未记录服务商（历史）」与「{服务商} · 其他模型」项、两类历史行均可被筛出；
3. 从工具卡（如编辑）进 markdown 预览，首进即渲染（不再空白，无需切 tab 重挂）。

## K 节建议（下游执行时闭合）

执行完 4 条 must-fix 后：

1. 跑 mobile / desktop 相关 jest 套件与两端 `tsc`；
2. 对触及文件跑 prettier / eslint；
3. `CHANGELOG.md` Unreleased 段补记本轮修复。
