---
date: 2026-08-03
---

# 聊天记录查询 技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/chat-history-search/prd.md`（已确认）。目标是在单个聊天会话内提供 VSCode 风格关键词搜索（精准 / 正则 / 大小写敏感）+ 时间范围筛选，结果始终包含隐藏消息，desktop / mobile 双端共用同一份 core 查询逻辑。

本 SPEC 基于 4 份代码探索报告撰写（core 仓库/service、desktop IPC+renderer、mobile 导航+runtime+UI、编辑器组件与搜索能力），所有落点均有代码证据。

### 实现层面的技术决策（非产品功能）

以下均为实现细节，不涉及 PRD 之外的产品能力：

1. **精准模式 SQL 用 LIKE 粗筛 + 内存精筛；正则模式跳过 LIKE 全量内存匹配**。精准模式 `content_json LIKE` 召回候选行（LIKE 扫整个 JSON 是超集，内存层只匹配 user/assistant 的 TextBlock 做最终判定）；正则模式无法用 LIKE 表达，直接把整个会话的消息（受时间范围约束）拉进内存跑正则。单会话规模内两种模式性能都可接受。
2. **SQL 层加 `role IN ('user', 'assistant')` 粗筛**（keyword 非空时）。减少 LIKE 召回的候选行数，把 system 角色消息和纯 tool 消息在 SQL 层就排除掉；内存层再做 TextBlock 精确判定。keyword 为空时不加 role 过滤（纯时间范围浏览应返回所有类型消息）。
3. **LIKE 通配符转义**：精准模式 keyword 进 SQL 前用 `escapeLikePattern` 转义 `\ % _`，SQL 用 `LIKE ... ESCAPE '\'`，避免用户输入 `%` 匹配全表。
4. **非法正则容错**：正则模式下 `new RegExp(keyword, flags)` 包 try/catch，非法正则返回空结果（不抛异常崩溃），UI 层可展示「正则表达式无效」提示。
5. **搜索结果列表渲染分两套**：desktop 仍复用 desktop 端的 `MessageList`（`apps/desktop/renderer/features/chat/MessageList.tsx`，接受其「纯 tool_result 行会被 buildChatListItems 跳过」的既有行为，不为此改 `MessageList`，已知局限写入「风险」）；mobile 改为自渲染轻量 `FlatList`，不复用 mobile `MessageList`（原因：mobile `MessageList` 为实时聊天流设计——内部 FlatList 的 `onEndReached` 给 scroll snapshot 用、不外抛，streamingText / streamingThinking / nearBottom 跟随 / keyboardLiftNonce 等语境与静态搜索结果错配，翻页回调也接不上）。
6. **desktop 查询面板拆出独立子组件 `ChatHistorySearchPanel.tsx`**（`SessionDetailDrawer` 已 482 行，内联会膨胀），仍挂在 `features/chat/` 下。
7. **mobile 查询页空态自渲染**，不用 `MessageList` 写死的「暂无消息」空态（语境不符），自己在 `results.length === 0` 时渲染「未找到匹配的聊天记录」。这与第 5 条的 mobile 自渲染决策一致——既然 mobile 不复用 `MessageList`，空态自然也由查询页自己负责。
8. **翻页 UI 两端都做基础版**：desktop 面板底部「加载更早」按钮（`beforeSeq = 当前结果最小 seq`）；mobile `FlatList` 的 `onEndReached` 触发同样逻辑。
9. **搜索三态控件**：desktop 用原生 `<button>` + 图标实现 VSCode 风格（精准/正则切换按钮 + 大小写敏感按钮 Aa）；mobile 用 `SegmentedControl`（精准/正则分段）+ 大小写开关。本期 mobile 先用 SegmentedControl 试，不行再改。

## 总体方案

分四层自底向上实现，core 先行（双端共用基座），再 desktop / mobile 各自接入：

0. **Core 查询基座**：新增 `MessageRepository.searchMessages` + `MessageService.searchMessages` 透传 + 关键词匹配纯函数（`messageMatchesKeyword`）+ LIKE 转义工具（`escapeLikePattern`）。仓储层 SQL：精准模式用 LIKE 粗筛（+ role 粗筛），正则模式跳过 LIKE 全量拉；两种模式都加时间范围 + `seq DESC LIMIT beforeSeq`；不在 SQL 层过滤 hidden。service 层在召回后调 `messageMatchesKeyword` 做内存精筛（keyword 为空时跳过精筛）。配套 core 单元测试。
1. **Desktop IPC 透传**：新增 `MESSAGES_SEARCH` channel + `MessagesSearchRequest` 类型 + `handleMessagesSearch`（复用现有 `toDto`）+ `ipcMessagesSearch` renderer 入口。
2. **Desktop 查询 UI**：`SessionDetailDrawer` secondary 区加「查找聊天记录」入口 → 切到 `ChatHistorySearchPanel` 子组件（关键词 `<input type="search">` + 搜索三态图标按钮 + 两个 `<input type="date">` + `MessageList` 结果 + 「加载更早」按钮）。
3. **Mobile 导航 + UI**：导航三件套注册 `ChatHistorySearch` 路由；`SessionDetailScreen` 加「聊天记录查询」卡片入口；新建 `ChatHistorySearchScreen`（`FormTextInput` + `@react-native-community/datetimepicker` + `SegmentedControl` + 自渲染轻量 `FlatList`（仿 `RealPromptScreen.tsx` 的列表结构）+ `onEndReached` 翻页）；`package.json` 引入 datetimepicker 依赖。注意：mobile 端不复用 `apps/mobile/src/components/chat/MessageList.tsx`（该组件为实时聊天流设计，内部 FlatList 的 `onEndReached` 给 scroll snapshot 用、不外抛，且 streamingText / streamingThinking / nearBottom 跟随 / keyboardLiftNonce 等语境与静态搜索结果错配），改为查询页自渲染精简消息卡。

## 最终项目结构

新增文件：

```
packages/core/src/domain/chat/content/message-content-match.ts       # messageMatchesKeyword + escapeLikePattern + MessageSearchQuery
packages/core/test/chat/message-search.test.ts                        # 仓储层 + service 层测试
apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx        # 查询面板子组件
apps/desktop/test/messages-search-handler.test.ts                     # IPC handler 真实 DB 测试
apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx             # 查询页面
apps/mobile/__tests__/chat-history-search-screen.test.tsx             # 组件测试
```

改动文件（按层归类见「变更点清单」）。

## 变更点清单

### Core — 关键词匹配纯函数（新文件）

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/chat/content/message-content-match.ts` | **新文件**，导出三样：`escapeLikePattern(s: string): string`（转义 `\ % _`）；`MessageSearchQuery` 类型；`messageMatchesKeyword(message: ChatMessage, keyword: string, opts: { mode: 'literal' \| 'regex'; caseSensitive: boolean }): boolean`。匹配逻辑：只对 `message.role === 'user' \|\| message.role === 'assistant'` 的消息做匹配（其余角色直接返回 false）；遍历 `message.content.blocks`，只看 `type === 'text'` 的块取 `block.text`（忽略 tool_use / tool_result / thinking / redacted_thinking）；精准模式走 `includes`（caseSensitive=false 时两端 `toLowerCase`），正则模式走 `try { new RegExp(keyword, caseSensitive ? '' : 'i').test(text) } catch { return false }`（非法正则返回 false）。keyword 为空串时 `messageMatchesKeyword` 不应被调用（由 service 层判断 keyword 是否为空决定是否精筛）。补充：keyword 是纯 pattern（不含 `/` 分隔符），大小写只由 caseSensitive 开关控制（false 时加 `i` flag），不支持正则行内 flag（如 `(?i)`） |

`MessageSearchQuery` 入参类型：

```ts
export interface MessageSearchQuery {
  readonly keyword?: string;                        // 为空/undefined 时不做关键词过滤
  readonly mode: 'literal' | 'regex';               // 精准 / 正则
  readonly caseSensitive: boolean;                  // 大小写敏感开关
  readonly fromMs?: number;                          // created_at_ms 下界（含），undefined 时不限
  readonly toMs?: number;                            // created_at_ms 上界（含），undefined 时不限
  readonly limit: number;
  readonly beforeSeq?: number;                       // 翻页：返回 seq < beforeSeq 的消息
}
```

### Core — 仓储层

| 文件 | 改动 |
|------|------|
| `packages/core/src/domain/chat/repositories/message.port.ts` | `MessageRepository` 接口加 `searchMessages(sessionId: string, query: MessageSearchQuery): Promise<ChatMessage[]>` |
| `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts` | 实现上述方法。复用 `MESSAGE_SELECT_COLUMNS`（L22）、`rowToMessage`（L29）、`queryTemplate`。SQL 拼接逻辑：`WHERE session_id = #{sessionId}` 始终在；keyword 非空时加 `AND role IN ('user', 'assistant')`（仿 `updateHiddenRange` L218 的 JS 拼固定片段范式，禁止拼用户输入）；keyword 非空且 `mode === 'literal'` 时加 `AND content_json LIKE #{likePattern} ESCAPE '\'`（`likePattern` 在 JS 侧算成 `'%' + escapeLikePattern(keyword) + '%'`；实施提示：JS 模板字符串里要写 `ESCAPE '\\'`（双反斜杠），避免 JS 字面量转义问题）；keyword 为空或 `mode === 'regex'` 时**不加 LIKE**（正则模式全量拉回内存跑）；时间用 `AND (#{fromMs} IS NULL OR created_at_ms >= #{fromMs})` + `AND (#{toMs} IS NULL OR created_at_ms <= #{toMs})`（仿 `listBySessionPage` L87 的 `IS NULL OR` 范式）；`ORDER BY seq DESC LIMIT #{limit}` + 可选 `AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})`。**不在 SQL 层过滤 hidden**（始终包含隐藏消息） |

### Core — Service 层

| 文件 | 改动 |
|------|------|
| `packages/core/src/service/chat/message.port.ts` | `MessageService` 接口加 `searchMessages(sessionId: string, query: MessageSearchQuery): Promise<ChatMessage[]>` |
| `packages/core/src/service/chat/impl/message.service.ts` | `DefaultMessageService` 加方法：调 `this.deps.messages.searchMessages(sessionId, query)` 拿候选行；keyword 非空时对每条候选调 `messageMatchesKeyword(msg, keyword, { mode, caseSensitive })` 精筛（keyword 为空时跳过精筛直接返回候选） |

### Core — 公开导出

| 文件 | 改动 |
|------|------|
| `packages/core/src/public/chat.ts` | re-export `MessageSearchQuery`、`messageMatchesKeyword`、`escapeLikePattern`（供 desktop/mobile 引用）；`searchMessages` 方法随 `MessageService` 类型自动导出 |

### Desktop — IPC

| 文件 | 改动 |
|------|------|
| `apps/desktop/shared/ipc-types.ts` | `IPC_CHANNELS`（L80-92 messages 区段尾部）加 `MESSAGES_SEARCH: 'nm:messages/search'`（沿用 messages 区段的 `nm:` 前缀约定，与 `MESSAGES_LIST: 'nm:messages/list'` 等保持一致）；`MessagesListRequest`（L591）附近加 `MessagesSearchRequest` 类型（`{ sessionId, keyword?, mode: 'literal'\|'regex', caseSensitive: boolean, fromMs?, toMs?, limit, beforeSeq? }`） |
| `apps/desktop/src/main/ipc/handlers/messages.ts` | 新增 `handleMessagesSearch(req: MessagesSearchRequest): Promise<IpcResult<ChatMessageDto[]>>`，照 `handleMessagesList`（L86-96）骨架：`getDesktopRuntime()` → `rt.messages.searchMessages(req.sessionId, { keyword, mode, caseSensitive, fromMs, toMs, limit, beforeSeq })` → `.map(toDto)`；复用本文件私有 `toDto`（L65），不搬家；**不走** `loadSessionMessagesForDisplay`（不套 regex-apply） |
| `apps/desktop/src/main/ipc/handler-registry.ts` | messages import 块（L101-115）加 `handleMessagesSearch`；`registerHandlersFromRegistry`（L267-282 之间）加 `bindReq(IPC_CHANNELS.MESSAGES_SEARCH, handleMessagesSearch)` |
| `apps/desktop/renderer/ipc/invoke-registry.ts` | messages 区块（L283-334）加 `ipcMessagesSearch: withReq<MessagesSearchRequest, IpcResult<ChatMessageDto[]>>(invoke, IPC_CHANNELS.MESSAGES_SEARCH)` |
| `apps/desktop/renderer/ipc/client.ts` | 解构列表（L82 附近）加 `ipcMessagesSearch` |

### Desktop — UI

| 文件 | 改动 |
|------|------|
| `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | secondary 区（L406-430）现有「查看提示词 / 压缩上下文」`__link` 旁加第三个 `__link`「查找聊天记录」（`data-session-detail-action="search-history"`）；新增 `searchPanelOpen` state，点击切到 `<ChatHistorySearchPanel>`；import `ChatHistorySearchPanel` |
| `apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx` | **新文件**：props `{ projectId, sessionId, onClose }`；本地 state（keyword / mode / caseSensitive / fromMs / toMs / results / loading / beforeSeq）；查询按钮调 `ipcMessagesSearch`；结果用 `<MessageList messages={results} chatRichText />` 渲染；搜索三态用原生 `<button>` + 图标实现 VSCode 风格（精准/正则切换按钮 + 大小写敏感 Aa 按钮，参考 VSCode 搜索框交互）；时间用两个原生 `<input type="date">`（先例见 SessionDetailDrawer L253 行内编辑原生 input）；空态 `results.length === 0` 渲染「未找到匹配的聊天记录」；底部「加载更早」按钮用当前结果最小 seq 作 `beforeSeq` 再查；包含「返回」按钮调 `onClose` 回详情抽屉 |
| `apps/desktop/test/session-detail-drawer.test.ts` | 追加源码断言（renderer 测试范式：`readFileSync` + `assert.match`）：断言 `查找聊天记录` 文案、`data-session-detail-action="search-history"`、`ChatHistorySearchPanel` import、`ipcMessagesSearch` 引用 |
| `apps/desktop/test/messages-search-handler.test.ts` | **新文件**：照 `messages-set-floor-handler.test.ts` 范式（`setupDesktopDbTestEnv` 真实 sqlite + 直接调 handler）；覆盖 keyword 命中/不命中、正则命中、大小写敏感、role 过滤（tool/thinking 不召回）、fromMs/toMs、seq DESC、LIMIT、beforeSeq 翻页 |

### Mobile — 导航注册三件套

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/navigation/types.ts` | `RootStackParamList`（L11-46）加 `ChatHistorySearch: { projectId: string; sessionId: string }`（参数与 `SessionDetail` 完全一致） |
| `apps/mobile/src/navigation/RootNavigator.tsx` | 顶部 import `ChatHistorySearchScreen`；模块级 `const ChatHistorySearchStackScreen = withStackLayout('ChatHistorySearch', ChatHistorySearchScreen);`（仿 L155-158，**不可**写成 inline 避免重渲染卸载）；`<Stack.Navigator>`（L212-215 附近）加 `<Stack.Screen name="ChatHistorySearch" component={ChatHistorySearchStackScreen} />` |
| `apps/mobile/src/navigation/header-config.ts` | `PAGE_HEADER_CONFIG` 加 `ChatHistorySearch: { title: '聊天记录', showBack: true, showNav: false }`（`Record<HeaderPageKey, ...>` 强制全覆盖，漏了 TS 报错） |

### Mobile — 详情页入口

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/screens/stack/SessionDetailScreen.tsx` | import `useNavigation` + `StackNav`；在 model 卡（L228-266）之后、`</ScrollView>` 之前插一张「聊天记录查询」卡片（复用 `styles.card` / `styles.iconBox` / `styles.cardBody` / `styles.chevron`，L307-315）；`onPress={() => navigation.navigate('ChatHistorySearch', { projectId, sessionId })}` |

### Mobile — 查询页面

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx` | **新文件**：命名导出（不默认导出，与 stack 目录风格一致）；骨架抄 `RealPromptScreen.tsx`（`useRuntime` + `useEffect` + loading/error/list 三态）；取参 `useRoute<RouteProp<RootStackParamList, 'ChatHistorySearch'>>`；查询条件 state（keyword / mode / caseSensitive / fromMs / toMs）；`load` 用 `useCallback` 调 `runtime.messages.searchMessages(sessionId, {...})`；**结果用自渲染 `<FlatList>`**（仿 `RealPromptScreen` 的列表结构，不复用 mobile `MessageList`），每条消息渲染精简卡片（角色标签 + bodyText 摘要 + hidden 时 dimmed）；`FlatList` 的 `onEndReached` 触发 `beforeSeq` 翻页；hidden 消息的 dimmed 视觉由查询页自己实现（`opacity: message.hidden ? 0.55 : 1`，参考 mobile `MessageList` L386/L444 的现有写法），不依赖 MessageList；搜索三态用 `<SegmentedControl<'literal' \| 'regex'>>`（精准/正则分段）+ 大小写开关（`Switch` 或第二个 SegmentedControl）；关键词框用 `<FormTextInput>`；时间用 `<DateTimePicker mode="date" display="default" />`（from `@react-native-community/datetimepicker`），选中 Date 转成 `[当天 00:00:00.000, 当天 23:59:59.999]` 的 ms；空态自渲染「未找到匹配的聊天记录」 |
| `apps/mobile/__tests__/chat-history-search-screen.test.tsx` | **新文件**：照 `session-detail-screen.test.tsx` mock 范式（`jest.mock` `useRuntime` + 注入 mockRuntime.messages.searchMessages）；`TestRenderer.create` + `act` 驱动；断言入口渲染、查询触发、结果展示、空态文案 |

### Mobile — 依赖

| 文件 | 改动 |
|------|------|
| `apps/mobile/package.json` | dependencies 加 `@react-native-community/datetimepicker: ^8.x`（适配 RN 0.85 新架构）；装完**必须重新 build Android**（`npm run android`），autolinking 由 RN 0.85 自动处理（无 `ios/` 目录，不需要 pod install） |

### 不需要动的文件

- `packages/core/src/bootstrap/chat/chat-schema.ts`：`chat_message` 表 schema 无需改，`(session_id, seq)` 唯一索引前缀够用（PRD 已排除 FTS5）。
- `packages/core/src/domain/chat/content/message-body-text.ts`：语义不符（跳过 thinking、改写 tool_result），不复用。
- `packages/core/src/domain/tool/builtin/chat-grep-tool.ts`：已废弃，仅参考 `searchLine`（indexOf / RegExp.exec 二选一）的实现思路。
- `apps/desktop/renderer/components/ui/CodeEditor.tsx`：用的是 CodeMirror，底座支持 `@codemirror/search`，但「编辑器内搜索」是独立场景（在编辑器 DOM 内查找高亮），与「在消息列表里筛消息」不是一回事，本期不启用（PRD 已在不包含范围登记）。
- `RealPromptPanel`（desktop）/ `RealPromptScreen`（mobile）：与查询功能正交，不碰。
- `SessionActionsDrawer`（mobile）：入口语义是「会话级动作」，不塞查询入口。
- `apps/mobile/src/components/chat/MessageList.tsx`：mobile 查询页不复用该组件（实时聊天流语境错配 + 无 `onEndReached` 透传），本期不动它。desktop 端的 `MessageList` 是另一套实现，desktop 查询面板仍复用，不受影响。

## 详细实现步骤

- Step 1 — phase-core-search — blocking: yes — qa: auto：新增 `packages/core/src/domain/chat/content/message-content-match.ts`，实现 `escapeLikePattern`（转义 `\ % _`）、`MessageSearchQuery` 类型、`messageMatchesKeyword(message, keyword, { mode, caseSensitive })`（只对 user/assistant 角色匹配，只扫 TextBlock.text，精准走 includes、正则走 RegExp try/catch）。
- Step 2 — phase-core-search — blocking: yes — qa: auto：`MessageRepository` port（`message.port.ts`）加 `searchMessages(sessionId, query)` 签名。
- Step 3 — phase-core-search — blocking: yes — qa: auto：`SqliteMessageRepository` 实现 `searchMessages`：SQL 模板（`WHERE session_id` + keyword 非空时 `AND role IN ('user','assistant')` + literal 模式 `AND content_json LIKE` + 可选 fromMs/toMs + ORDER BY seq DESC LIMIT + 可选 beforeSeq），literal 模式 `likePattern` 在 JS 侧算，regex 模式不加 LIKE；复用 `MESSAGE_SELECT_COLUMNS` / `rowToMessage` / `queryTemplate`。
- Step 4 — phase-core-search — blocking: yes — qa: auto：`MessageService` port + `DefaultMessageService` 加 `searchMessages`（仓储召回后 keyword 非空时调 `messageMatchesKeyword` 精筛，keyword 为空跳过精筛）。
- Step 5 — phase-core-search — blocking: yes — qa: auto：`packages/core/src/public/chat.ts` re-export `MessageSearchQuery` / `messageMatchesKeyword` / `escapeLikePattern`。
- Step 6 — phase-core-search — blocking: yes — qa: auto：新增 `packages/core/test/chat/message-search.test.ts`，覆盖 T-CS1 ~ T-CS10（见测试策略）。
- Step 7 — phase-desktop-ipc — blocking: yes — qa: auto：`shared/ipc-types.ts` 加 `MESSAGES_SEARCH` channel + `MessagesSearchRequest` 类型。
- Step 8 — phase-desktop-ipc — blocking: yes — qa: auto：`handlers/messages.ts` 加 `handleMessagesSearch`（复用 `toDto`，不走 regex-apply）。
- Step 9 — phase-desktop-ipc — blocking: yes — qa: auto：`handler-registry.ts` 加 import + `bindReq`；`invoke-registry.ts` 加 `ipcMessagesSearch`；`client.ts` 解构加 `ipcMessagesSearch`。
- Step 10 — phase-desktop-ipc — blocking: yes — qa: auto：新增 `apps/desktop/test/messages-search-handler.test.ts`，覆盖 T-DI1 ~ T-DI6。
- Step 11 — phase-desktop-ui — blocking: no — qa: manual_user：新增 `ChatHistorySearchPanel.tsx`（关键词输入 / VSCode 风格三态图标按钮 / 日期 / MessageList / 加载更早 / 空态）。
- Step 12 — phase-desktop-ui — blocking: yes — qa: auto：`SessionDetailDrawer.tsx` secondary 区加「查找聊天记录」入口 + `searchPanelOpen` 切换；追加 `session-detail-drawer.test.ts` 源码断言。
- Step 13 — phase-mobile-nav — blocking: yes — qa: auto：导航三件套注册 `ChatHistorySearch`（types/RootNavigator/header-config）。
- Step 14 — phase-mobile-ui — blocking: yes — qa: manual_user：`apps/mobile/package.json` 加 `@react-native-community/datetimepicker ^8.x`，跑 `npm install` + `npm run android` 重新 build。
- Step 15 — phase-mobile-ui — blocking: no — qa: manual_user：新增 `ChatHistorySearchScreen.tsx`（FormTextInput + DateTimePicker + SegmentedControl 精准/正则 + 大小写开关 + 自渲染 `FlatList`（精简消息卡 + hidden dimmed）+ onEndReached 翻页 + 空态自渲染）。
- Step 16 — phase-mobile-ui — blocking: yes — qa: auto：`SessionDetailScreen.tsx` 加「聊天记录查询」卡片入口（import useNavigation，onPress navigate）。
- Step 17 — phase-mobile-ui — blocking: yes — qa: auto：新增 `apps/mobile/__tests__/chat-history-search-screen.test.tsx`，覆盖 T-MO1 ~ T-MO3。
- Step 18 — phase-mobile-ui — blocking: no — qa: manual_user：Android 真机/模拟器回归（详情页入口 → 查询页 → 关键词精准/正则/大小切 + 时间范围 → 翻页 → 返回），合并后用户验收。

## 测试策略

测试框架：core 用 `node:test` + `node:assert/strict`（`packages/core/package.json` test 脚本，**不是 vitest**），fixture 走 `novelMasterTestFixture()` + `@novel-master/tdbc-driver-better-sqlite3` 内存库；desktop main handler 用 `node:test` + `setupDesktopDbTestEnv`；desktop renderer 与 mobile 组件用源码字符串断言 / Jest + react-test-renderer。

### 测试用例

**Core 仓储 + service（T-CS*，映射 Step 1-6）**

- T-CS1 — blocking: yes — 精准匹配命中：会话内多条消息，`searchMessages(sid, {keyword:'魔法', mode:'literal', caseSensitive:false, limit:50})` 只返回 user/assistant 且 TextBlock.text 含「魔法」的消息，按 seq DESC 排序。
- T-CS2 — blocking: yes — 匹配范围限定：构造 tool_result.content 或 thinking.text 含 keyword 但 TextBlock 不含的消息，断言不被召回（验证只匹配 user/assistant 的 TextBlock）。
- T-CS3 — blocking: yes — 正则匹配命中：TextBlock 含「魔法基础设定」，`mode:'regex', keyword:'魔法.*设定'` 命中。
- T-CS4 — blocking: yes — 大小写敏感：TextBlock 含「Hello」，`caseSensitive:true, keyword:'hello'` 不召回；`caseSensitive:false` 召回。
- T-CS5 — blocking: yes — 非法正则容错：`mode:'regex', keyword:'[unclosed'` 不崩溃，返回空结果。
- T-CS6 — blocking: yes — 始终包含隐藏消息：seq 1-10 hidden、11-50 visible，keyword 为空时返回全部 50 条（含 hidden），验证不在 SQL 层过滤 hidden。
- T-CS7 — blocking: yes — fromMs/toMs 范围：手造 `created_at_ms`（仓储层直接 insert 绕过 service 的 Date.now()），断言范围过滤正确（含边界）。
- T-CS8 — blocking: yes — 翻页：100 条消息，`limit:20, beforeSeq:50` 返回 seq 49-30；再 `beforeSeq:30` 返回 29-20。
- T-CS9 — blocking: yes — LIKE 转义：精准模式 keyword 含 `%` `_` `\` 时断言不触发全表/通配匹配（`escapeLikePattern` 生效）。
- T-CS10 — blocking: yes — keyword 为空：不做关键词过滤、不加 role 过滤，返回全部（受时间/limit 约束）的消息（含 system 角色）。

**Desktop IPC handler（T-DI*，映射 Step 7-10）**

- T-DI1 — blocking: yes — `handleMessagesSearch` 返回 `IpcResult<ChatMessageDto[]>`，字段齐全（hidden/seq/createdAtMs/bodyText）。
- T-DI2 — blocking: yes — 精准 / 正则 / 大小写三态在 IPC 层行为正确（透传 core）。
- T-DI3 — blocking: yes — 匹配范围只限 user/assistant 的 TextBlock（IPC 透传 core 行为）。
- T-DI4 — blocking: yes — beforeSeq 翻页透传正确。
- T-DI5 — blocking: yes — 不套 regex-apply：结果 bodyText 是原始文本（断言不被正则改写）。
- T-DI6 — blocking: yes — 错误转 IpcResult.error（`formatIpcError`）。

**Desktop renderer UI（T-DR*，映射 Step 11-12）**

- T-DR1 — blocking: yes — `SessionDetailDrawer` 源码断言含「查找聊天记录」文案、`data-session-detail-action="search-history"`、`ChatHistorySearchPanel` import、`ipcMessagesSearch` 引用。

**Mobile 组件（T-MO*，映射 Step 15-17）**

- T-MO1 — blocking: yes — `SessionDetailScreen` 渲染「聊天记录查询」卡片，点击触发 `navigation.navigate('ChatHistorySearch', {projectId, sessionId})`。
- T-MO2 — blocking: yes — `ChatHistorySearchScreen` 查询触发 `runtime.messages.searchMessages`，结果渲染到自渲染 `FlatList`（精简消息卡），空态显示「未找到匹配的聊天记录」。
- T-MO3 — blocking: yes — `ChatHistorySearchScreen` 返回（`navigation.goBack`）回到详情页。

**Mobile 真机验收（T-MM*，映射 Step 14/15/18，manual_user）**

- T-MM1 — blocking: no — qa: manual_user — Android 真机/模拟器：详情页 → 查询页转场、SegmentedControl 切精准/正则、大小写开关、DateTimePicker 选日期、关键词查询、翻页、物理返回。

## 风险与回滚方案

### 风险点

1. **搜索结果不套 regex-apply，与时间线显示文本可能不一致**：若用户配了正则改写显示文本（如角色名替换），搜索基于原始文本会搜不到改写后的词。缓解：本期明确「搜索 = 找原始记录」，文案上引导用户按原文搜索；后续如需可评估在 service 层注入 regex-apply（会引入 core 对展示层逻辑的依赖，需权衡）。
2. **MessageList 跳过纯 tool_result 行**：desktop `buildChatListItems`（message-blocks.ts L258-260）会把纯 tool_result 消息整条跳过。本期匹配范围已排除 tool_result（只搜 TextBlock），所以不会出现「core 召回了但 UI 不显示」的矛盾；但如果后续扩展匹配范围到 tool_result，需注意此行为。
3. **正则模式全量内存匹配的性能**：正则模式跳过 LIKE，把整个会话的消息（受时间范围约束）拉进内存逐条跑 RegExp。单会话规模（几百到上千条）可接受；极端长会话（数千条以上）可能有延迟。PRD 已排除 FTS5，本期接受；后续可评估 FTS5 虚表。
4. **datetimepicker 原生构建**：新增带原生 Java 代码的依赖，`npm install` 后必须重新 `npm run android`，光 Metro reload 不生效；用户若只 reload 会报原生模块缺失。缓解：Step 14 标注 blocking + manual_user。
5. **`SessionDetailDrawer` 单文件膨胀**：拆出 `ChatHistorySearchPanel.tsx` 子组件缓解；若后续继续膨胀再考虑整体重构。
6. **测试时间戳可控性**：service 层 `append` 用 `Date.now()`，测 `created_at_ms` 范围时不可控。仓储层测试用直接 `insert` 手造 `ChatMessage`（绕过 service），参考 `sqlite-session.repository.test.ts` 范式。
7. **mobile SegmentedControl 三态控件可能不够顺手**：本期先用 SegmentedControl 试精准/正则 + 大小写开关，如果实际体验不佳再换图标按钮。不阻塞交付。

### 回滚方案

- 本期纯新增（仓储/service 方法、IPC channel、UI 组件、导航路由、依赖），不动现有签名、schema、既有 channel。回滚 = revert 新增文件 + 移除新增方法/channel/路由/依赖即可，无数据迁移、无破坏性。
- core 新增方法挂在 interface 上，desktop/mobile 不调用即无影响；可分阶段回滚（先回滚 UI，core 基座保留无害）。

### 验收检查清单

- [ ] T-CS1 ~ T-CS10 全绿（core 单元测试）
- [ ] T-DI1 ~ T-DI6 全绿（desktop IPC handler 测试）
- [ ] T-DR1 绿（desktop renderer 源码断言）
- [ ] T-MO1 ~ T-MO3 全绿（mobile 组件测试）
- [ ] T-MM1 用户验收（Android 真机/模拟器回归）
- [ ] desktop + mobile 双端同一会话同条件查询结果一致（人工抽验）

## 兼容性说明

- **向后兼容**：纯新增，不动现有 `MessageRepository` / `MessageService` 方法签名、不动 `chat_message` schema、不动既有 IPC channel。现有调用方零影响。
- **依赖**：mobile 新增 `@react-native-community/datetimepicker ^8.x`（需 Android 重新 build）；desktop / core 无新依赖。
- **导出**：core `public/chat.ts` 新增 re-export，不影响现有导出。
