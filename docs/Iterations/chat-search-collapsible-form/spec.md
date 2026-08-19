---
date: 2026-08-20
---

# 聊天记录查询页卡片化重设计 技术规格（SPEC）

## 设计目标

双端查询表单改为可折叠卡片：默认展开、查询成功（有结果）后自动收起、收起态显示筛选摘要、点击卡片头切换、无动画；desktop 结果区补长消息默认折叠（mobile 已有，保持）。需求来源：`docs/Iterations/chat-search-collapsible-form/prd.md`。

## 总体方案

- **mobile**：`ChatHistorySearchScreen.tsx` 内新增 `formExpanded` state（默认 `true`）；表单区（现固定 View L215-277）包进内联折叠卡片——header 结构抄 `PromptPreviewSegmentCard`（Pressable + `accessibilityState={{expanded}}` + `▶/▼` 文字 chevron + 条件渲染 body，无动画），容器样式抄 `FormSectionCard` 的值（圆角 16、hairline 描边、shadow/elevation 2）。键盘外层双分支（KeyboardAvoidingView/Animated.View）不动。
- **自动收起**：mobile `runQuery` 成功分支补 `if (!append && batch.length > 0) { setFormExpanded(false); Keyboard.dismiss(); }`；空结果**不算成功**（现状 `setHasSearched(true)` 无条件，收起条件必须带 `batch.length > 0`）；倒挂校验提前 return 与异常分支天然不收起。desktop 在 `result.ok` 且非 append 且有结果的分支同款。
- **收起态摘要**：header 显示从 `keyword/fromSeqText/toSeqText` state 直接派生的摘要（如 `关键词 "xx" · #10–50`；无筛选时「未设置筛选条件」），不存第二份。输入值是 screen 级 state，收起卸载输入框不丢值，重新展开自然回填。
- **desktop 表单**：`ChatHistorySearchPanel.tsx` 的 `__form` 两行包进 `chat-history-search__filter-card` 折叠卡片（button 切换 + 条件渲染，不用受控 `<details>`），视觉对齐 `.config-block-card`（border 1px var(--border-light)、radius 10、surface-muted、shadow-card-subtle），样式进 `shell.css`。
- **desktop 长消息折叠**：给 `MessageList` 加可选 prop `collapsibleMessageBody?: boolean`（默认关闭——ConversationPanel 与 message-list-stream 测试零感知），`MessageBody` 外包折叠 wrapper：默认 `-webkit-line-clamp: 4` 截断 + 点击切换展开，溢出判断用与 mobile 一致的静态规则（文本 >200 字符或含换行），无动画。
- **测试适配（关键决策）**：mobile 收起采「卸载输入框」方案，因此 **T-MO3 翻页用例需同步更新**——在成功查询后、修改 seq 输入前先点卡片头展开；并补自动收起新用例。

## 最终项目结构

```
apps/mobile/
  src/screens/stack/ChatHistorySearchScreen.tsx   # 改：表单包折叠卡片 + formExpanded + 自动收起 + 摘要
  __tests__/chat-history-search-screen.test.tsx   # 改：T-MO3 翻页用例适配 + 新增 T-CF 系用例 + mock 补 Keyboard
apps/desktop/
  renderer/features/chat/ChatHistorySearchPanel.tsx # 改：表单包 filter-card 折叠 + formExpanded + 自动收起 + 摘要
  renderer/features/chat/MessageList.tsx            # 改：加 collapsibleMessageBody prop + 折叠 wrapper
  renderer/styles/shell.css                          # 改：__filter-card 系列样式 + line-clamp 折叠样式
  test/session-detail-drawer.test.ts                 # 不改（三个锁定字符串保留即过）
```

不改动：mobile `MessageResultCard` 既有折叠逻辑、查询/分页/校验行为、desktop 的 `ipcMessagesSearch`/`MessageList`/`未找到匹配的聊天记录` 三个被源码正则锁定的字符串（改版后保留）。

## 变更点清单

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx` | `formExpanded` state；折叠卡片组件（内联，含摘要 header）；`runQuery` 成功分支自动收起 + `Keyboard.dismiss()`；既有 testID 全保留 |
| `apps/mobile/__tests__/chat-history-search-screen.test.tsx` | react-native mock 补 `Keyboard: {dismiss: jest.fn()}`；T-MO3 翻页用例在改输入前先展开卡片；新增 T-CF1~T-CF4 |
| `apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx` | `formExpanded` state + filter-card 折叠（button 切换 + 条件渲染）+ 成功自动收起 + 摘要行；三个锁定字符串原样保留 |
| `apps/desktop/renderer/features/chat/MessageList.tsx` | 可选 prop `collapsibleMessageBody`（默认 false）；true 时 MessageBody 外包 line-clamp 折叠 wrapper；`ChatHistorySearchPanel` 传 true |
| `apps/desktop/renderer/styles/shell.css` | `chat-history-search__filter-card` 系列（对齐 config-block-card 视觉）+ `.chat-message__body-clamp`（-webkit-line-clamp: 4 + 展开态） |

## 详细实现步骤

- Step 1 — phase-cf-mobile — blocking: yes — qa: auto：mobile 折叠卡片 + `formExpanded` + 成功自动收起（`!append && batch.length > 0`）+ `Keyboard.dismiss()` + 收起态摘要；mock 补 Keyboard；更新 T-MO3 翻页用例（改输入前先展开）；补 T-CF1~T-CF4。
- Step 2 — phase-cf-desktop-form — blocking: yes — qa: auto：desktop filter-card 折叠表单 + 自动收起 + 摘要；shell.css 样式；源码契约测试 T-CF5（含三个锁定字符串保留断言）。
- Step 3 — phase-cf-desktop-collapse — blocking: yes — qa: auto：`MessageList` 加 `collapsibleMessageBody` prop + line-clamp 折叠 wrapper（静态溢出规则：>200 字符或含换行）；panel 传 true；测试 T-CF6。
- Step 4 — phase-cf-regression — blocking: yes — qa: auto：回归：mobile `chat-history-search-screen.test.tsx` 全绿（T-MO2/T-MO3/T-KB4 一条不破）、desktop `session-detail-drawer.test.ts` 与 `message-list-stream.test.tsx` 全绿、双端 typecheck。
- Step 5 — phase-cf-qa — blocking: no — qa: manual_user：双端手动验收 PRD 用例（默认展开、成功收起、无结果/倒挂不收起、展开保留值、desktop 长消息折叠、mobile 既有折叠回归）。

## 测试策略

### 测试用例

- T-CF1 — blocking: yes — mobile：进入页面表单卡片默认展开，keyword/from-seq/to-seq/submit testID 可直查（映射 Step 1）
- T-CF2 — blocking: yes — mobile：查询成功（有结果）后表单自动收起，卡片头摘要正确显示；且 `Keyboard.dismiss` 被调用（映射 Step 1）
- T-CF3 — blocking: yes — mobile：空结果与区间倒挂时表单不收起、输入框仍可用（映射 Step 1）
- T-CF4 — blocking: yes — mobile：收起后点击卡片头展开，输入值保留上次内容（映射 Step 1）
- T-CF5 — blocking: yes — desktop 源码契约：panel 含 `__filter-card` 类与摘要逻辑，且 `ipcMessagesSearch`/`MessageList`/`未找到匹配的聊天记录` 三字符串保留（映射 Step 2）
- T-CF6 — blocking: yes — desktop：`MessageList` 传 `collapsibleMessageBody` 时长文本消息渲染带 clamp 类、短消息不带；不传时零变化（renderToStaticMarkup 断言；映射 Step 3）
- T-MO3 翻页用例更新 — blocking: yes — 成功查询自动收起后，先点卡片头展开再改 seq 输入，翻页仍携带新区间（原断言不变；映射 Step 1）

既有测试影响（探索确认）：T-MO2 用 testID 直查（默认展开即过）；T-KB4 只锁最外层容器形态（卡片化不动外层）；`session-detail-drawer.test.ts` 只做三字符串正则（保留即过）；`message-list-stream.test.tsx` 不传新 prop 零感知。

## 风险与回滚方案

- **风险：T-MO3 适配遗漏**——收起卸载输入框后任何「直接找输入框」的既有断言都会挂，Step 1 须全量跑该测试文件；翻页闭包依赖数组已含 state，收起不影响翻页携带条件（探索确认）。
- **风险：Keyboard.dismiss 在测试环境未 mock**——RN mock 工厂当前无 Keyboard，不补会在新代码处炸；Step 1 显式列出。
- **风险：-webkit-line-clamp 截断后 mermaid/富文本块被切**——line-clamp 只作用于折叠态文本溢出；含 mermaid 的富文本块本身是块级容器，折叠态按块整体显示前 4 行、展开完整——实现时若发现块级元素被切视觉异常，回退为「含富文本的消息不折叠」（写实现注，真机验收把关）。
- **回滚**：mobile 卡片化内聚在单文件，revert 即回原形态；desktop MessageList 新 prop 默认关闭，revert panel 一处即回退；无数据与协议变更。
