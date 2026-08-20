---
date: 2026-08-19
---

# 聊天记录查询·编号区间筛选 技术规格（SPEC）

## 设计目标

为两端聊天记录查询增加按消息 seq 编号区间（fromSeq / toSeq，闭区间，可只填一端）的过滤能力，与关键词、`beforeSeq` 翻页自由组合；结果仍包含 hidden 消息（沿用既有口径）。需求来源：`docs/Iterations/chat-history-search-seq-range/prd.md`。

## 总体方案

过滤在 **core 仓储层（SQL）** 一次完成，service 层零改动（`searchMessages` 纯透传 query 对象）；desktop 在 IPC 请求类型与 handler 补两字段透传；两端 UI 各加两个数字输入。参数采用与 `beforeSeq` 相同的空值兼容模式，天然支持单端区间与翻页组合。

- SQL 条件：`AND (#{fromSeq} IS NULL OR seq >= #{fromSeq}) AND (#{toSeq} IS NULL OR seq <= #{toSeq})`
- 语义与同文件 `updateHiddenRange` 的 fromSeq/toSeq **闭区间**语义对齐（`>=` / `<=`）
- 倒挂区间（from > to）SQL 天然返回空，但 UI 层前置校验给提示（PRD 验收 #6）
- 输入为文本框，空串 / NaN 统一归一为 `undefined`

## 最终项目结构

不新增文件；改动既有 6 个源文件 + 3 个测试文件。

## 变更点清单

| 文件 | 改动 |
|---|---|
| `packages/core/src/domain/chat/content/message-content-match.ts` | `MessageSearchQuery`（L18-25）加 `fromSeq?: number; toSeq?: number`（readonly） |
| `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts` | `searchMessages`（L305-343）WHERE 拼入两段区间条件；绑定参数对象加 `fromSeq`/`toSeq`（命名参数，与顺序无关） |
| `apps/desktop/shared/ipc-types.ts` | `MessagesSearchRequest`（L612-617）加 `fromSeq?/toSeq?` |
| `apps/desktop/src/main/ipc/handlers/messages.ts` | `handleMessagesSearch`（L104-118）**显式逐字段透传**（现有代码非展开 `...req`），补两行 |
| `apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx` | 表单（L127-146 `.chat-history-search__input-row`）加两个数字输入 + state + `runQuery`（L48-95）传参；倒挂时提示不查询 |
| `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx` | `FormTextInput`（L198-206）旁加两个数字输入（testID `chat-history-search-from-seq` / `chat-history-search-to-seq`）+ state + `runQuery`（L112-148）传参；倒挂提示 |
| 测试 ×3 | 见测试策略 |

不改动：`message.service.ts`（透传）、renderer `invoke-registry`/`client`（请求对象整体序列化）。

## 详细实现步骤

- Step 1 — phase-core-seq-range — blocking: yes — qa: auto：`MessageSearchQuery` 加 `fromSeq?/toSeq?` 字段（readonly，注释说明闭区间、含 hidden 口径）。
- Step 2 — phase-core-seq-range — blocking: yes — qa: auto：`searchMessages` SQL 拼两段 `(#{x} IS NULL OR seq >=/<= #{x})` 条件，参数对象补 `fromSeq/toSeq`，绑定值照 L338 `beforeSeq` 范式归一 `query.fromSeq ?? null` / `query.toSeq ?? null`（better-sqlite3 命名参数不接受 `undefined`）；补 core 测试（T-CS11~T-CS16）。
- Step 3 — phase-desktop-seq-range — blocking: yes — qa: auto：`MessagesSearchRequest` 加字段；handler 补两行显式透传；补 handler 测试（T-DI7）。
- Step 4 — phase-desktop-seq-range — blocking: yes — qa: manual_user：`ChatHistorySearchPanel` 加「起始/截止编号」输入（复用 `.chat-history-search__input-row` 样式，`inputMode="numeric"`）；提交时空串/NaN 归一 `undefined`；from > to 时行内提示且不发请求；查询与 `runQuery`/翻页游标贯通。desktop 无 renderer 组件测试基建，UI 行为并入 Step 6 双端手动验收。
- Step 5 — phase-mobile-seq-range — blocking: yes — qa: auto：`ChatHistorySearchScreen` 加两个 `FormTextInput`（keyboardType numeric、上述 testID）；同样的归一与倒挂校验；`onSubmitSearch`/`runQuery` 传参；双端 `fromSeq/toSeq` state 均须进入 `runQuery` 依赖数组，否则「加载更早」翻页闭包会拿到旧区间值；补 mobile 测试（T-MO3）。
- Step 6 — phase-mobile-seq-range — blocking: no — qa: manual_user：双端手动验收 PRD 用例 #1-#8（含隐藏消息降透明度、回滚后编号复用场景）。

## 测试策略

### 测试用例

- T-CS11 — blocking: yes — core：区间 40-60 只返回该闭区间消息，倒序（映射 Step 2）
- T-CS12 — blocking: yes — core：仅 fromSeq=80 返回 seq ≥ 80（映射 Step 2）
- T-CS13 — blocking: yes — core：仅 toSeq=20 返回 seq ≤ 20（映射 Step 2）
- T-CS14 — blocking: yes — core：fromSeq > toSeq 返回空数组不报错（映射 Step 2）
- T-CS15 — blocking: yes — core：keyword + 区间组合取交集（映射 Step 2）
- T-CS16 — blocking: yes — core：区间内含单条删除空洞（seq 30 缺失）时正确返回现存消息（映射 Step 2）
- T-DI7 — blocking: yes — desktop handler：请求带 fromSeq/toSeq 时正确透传到 service 并影响结果（映射 Step 3）
- T-MO3 — blocking: yes — mobile：填入区间后 `searchMessages` 入参含 fromSeq/toSeq；倒挂时提示且不调用；修改区间后「加载更早」翻页仍携带新区间（映射 Step 5）

测试写法沿用各文件既有惯例：core `node:test` + describe「T-CSxx：…」；desktop `node:test` + 真实 sqlite；mobile jest + `expect.objectContaining`。

## 风险与回滚方案

- 风险：输入归一遗漏（NaN 传入 SQL 命名参数）→ Step 4/5 显式归一 + 测试钉死。
- 风险：IPC 无 schema 校验，新字段依赖两端类型对齐 → T-DI7 覆盖。
- 回滚：纯增量字段，旧调用方不传即行为不变；单文件粒度 revert 即可，无数据迁移。
