---
date: 2026-08-19
---

# Mobile 聊天与预览体验修复 技术规格（SPEC）

## 设计目标

修复两个 mobile 缺陷：①详情页改名后聊天页标题/列表不刷新（根因：`commitTitle` 成功后无广播，聊天页 `sessions` state 不重查）；②文件预览文本模式 `<Text>` 未设 `selectable` 导致长按无反应。需求来源：`docs/Iterations/mobile-chat-preview-ux-bugfix/prd.md`。

## 总体方案

- **①改名同步**：沿用项目既有 `DeviceEventEmitter` 事件范式（同 `session-transcript-changed`）。`commitTitle` 成功分支新增 `emit('session-renamed', { sessionId, title })`；`useChatTabScope` 新增订阅，收到事件后 `reloadLists()`（幂等、无条件刷新——跨项目改名时当前项目列表本就无需变化）。事件名沿用内联字符串 + 中文注释风格，不抽常量文件。
- **②文本复制**：txt 分支 `<Text>` 加 `selectable`（项目已有先例 `PromptPreviewSegmentCard.tsx` L98-100），Android/iOS 系统长按选择菜单即满足需求，不自建浮层。

## 最终项目结构

不新增文件；改 3 个源文件 + 2 个测试文件。

## 变更点清单

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/screens/stack/SessionDetailScreen.tsx` | `commitTitle`（L100-116）rename 成功后加 `DeviceEventEmitter.emit('session-renamed', {sessionId, title: next})`（置于 `setSessionTitle` 旁） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` | 新增 `DeviceEventEmitter` import 与 `useEffect` 订阅 `session-renamed` → `reloadLists()`，清理函数 `sub.remove()`（该文件首个订阅，模式对齐 `useChatTabMessages.ts` L260-274） |
| `apps/mobile/src/components/vfs/FileMarkdownPreview.tsx` | txt 分支（L452）`<Text selectable style={...}>`；**不改 L449 注释**「plain/文本 Tab：禁用批注」（有测试正则盯着） |
| `apps/mobile/__tests__/session-detail-screen.test.tsx` | 补 T-SD1；该文件 react-native 全量替换式 mock 工厂（L145-192）当前未导出 `DeviceEventEmitter`，需补 `DeviceEventEmitter: {emit}` 才能断言 |
| `apps/mobile/__tests__/FileMarkdownPreview.test.tsx` | 补 T-FP1 |

## 详细实现步骤

- Step 1 — phase-rename-emit — blocking: yes — qa: auto：`commitTitle` 成功分支加事件广播（payload `{sessionId, title}`，与 toast 同级）；补测试 T-SD1。
- Step 2 — phase-rename-subscribe — blocking: yes — qa: auto：`useChatTabScope` 加订阅 → `reloadLists()`，带 `sub.remove()` 清理；补源码契约测试 T-SD2（新建轻量用例或并入现有文件，正则断言订阅与清理存在）。
- Step 3 — phase-txt-selectable — blocking: yes — qa: auto：txt 分支 `<Text>` 加 `selectable`；补测试 T-FP1；确认既有 `annotate-recogito-preview.test.tsx` L259-264 与 `FileMarkdownPreview.test.tsx` txt 用例不受影响。
- Step 4 — phase-ux-qa — blocking: no — qa: manual_user：真机验收 PRD 用例 #1-#8（改名后顶栏/列表即时刷新、列表改名初始值、长按选择复制、空文件、滚动不误触）。

## 测试策略

### 测试用例

- T-SD1 — blocking: yes — 详情页改名成功后 emit `session-renamed` 且 payload 含 sessionId 与新标题（mock `DeviceEventEmitter.emit` 断言；映射 Step 1）
- T-SD2 — blocking: yes — `useChatTabScope` 源码契约：含 `session-renamed` 订阅、调用 `reloadLists`、含 `sub.remove()` 清理（映射 Step 2）
- T-FP1 — blocking: yes — txt 分支渲染的 `Text` 带 `selectable={true}`（`findAllByType(Text)` 断言 props；映射 Step 3）

既有测试影响评估（探索确认）：txt 用例断言 `props.children` 不涉 `selectable`；批注源码正则只盯批注字符串——均不受影响。

## 风险与回滚方案

- 风险：顶栏标题消费点是否严格取 `currentSession.title` 未逐行核实（探索标注为推断）——Step 2 实现时顺带确认消费点，若另有缓存再补刷新。
- 风险：Android `selectable` 长按与 ScrollView 手势冲突——外层仅 ScrollView 无长按手势（探索确认），风险低；Step 4 真机验证。
- 回滚：三个改动相互独立，可分别单点 revert；事件无持久化、无协议变更。
