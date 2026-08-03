---
date: 2026-08-03
dependency:
  - Iterations/chat-session-detail-page/prd.md
  - Iterations/message-visibility/prd.md
---

# 聊天记录查询 PRD

## 背景

聊天会话详情页在 `chat-session-detail-page` 迭代里已经落地了，两端都有统一入口：desktop 是 `SessionDetailDrawer` 模态抽屉，mobile 是 `SessionDetailScreen` 独立 Stack 路由。目前这个详情页承载的是聊天名 inline 编辑、agent / model 卡片切换、查看提示词、压缩上下文这些「会话元信息 + 高频操作」。

消息的可见性控制在 `message-visibility` 迭代里也早就有了——`chat_message` 表带 `hidden` 列，置位 / 压缩只是把前缀消息标记成 `hidden=1`，行本身一直留在表里，并不删除。也就是说，隐藏的消息始终躺在数据库里，只是拼 LLM prompt 时不参与渲染而已。

但产品里始终缺一个能力：用户没法在单个会话里**翻查历史消息**。会话一旦变长，想找回之前聊过的某个设定、某段对话，只能靠肉眼往上滚。所以这一期想补一个「聊天记录查询」功能，让用户在当前会话内按关键词、按时间范围把消息翻出来——而且查出来的记录得**包含被隐藏的消息**，因为隐藏只是「不发给 LLM」，对用户来说这些消息仍然是聊天历史的一部分，得能看、能查。

这里要特别区分一个概念：「聊天记录」指的是 `chat_message` 表里真实存下来的消息行（不管 hidden 与否），而「聊天提示词」（RealPrompt）是另一套东西，它是组装好准备发给 LLM 的最终 prompt 预览。两者前后环节不同、入口也完全独立，查询功能只动聊天记录，不碰提示词。

## 目标（含成功指标）

**目标**

1. 在单个聊天会话内提供消息查询能力，支持 VSCode 风格的关键词搜索（精准 / 正则 / 大小写敏感）和时间范围筛选；查询结果始终包含隐藏的消息，结果列表靠现有视觉标记区分隐藏与否。
2. 查询走后端接口，desktop 和 mobile 两端共用同一套 core 查询逻辑，避免双端各自实现导致行为漂移。
3. 入口挂在已有的聊天详情页上，desktop 在详情抽屉内呈现，mobile 从详情页卡片进入新的查询页面，跟现有入口架构对齐。

**成功指标**

- 在详情页能进入聊天记录查询，输入关键词（支持精准 / 正则 / 大小写切换）或选定时间范围后，结果列表只含当前会话的消息，且默认带上 `hidden=1` 的消息并靠现有视觉标记区分。
- 同一个会话、同样的查询条件，desktop 和 mobile 两端查出来的结果一致（共用后端接口）。
- 置位 / 压缩过的会话，被隐藏的前缀消息仍然能被查出来（验证 `hidden` 不影响查询召回）。

## 用户与场景

- **目标用户**：单个会话聊得很长、需要回溯历史内容的创作者。
- **典型场景 1**：会话聊了几百轮，用户记得之前提过某个角色设定，想用关键词把那条消息翻出来看一眼，而不是一直往上滚。
- **典型场景 2**：用户想用正则表达式精确描述要找的内容模式（比如「第.{1,3}章」匹配章节标题），精准搜索搞不定时切到正则模式。
- **典型场景 3**：用户想回顾「上周三左右」聊的某段内容，按时间范围把那几天的消息筛出来。
- **典型场景 4**：会话做过置位 / 压缩，前缀消息被隐藏了（不发给 LLM），但用户想查阅这些被隐藏的历史内容——查询功能得能把它们查出来，结果列表里靠现有视觉标记（角标 / dimmed）让用户一眼分辨哪些是被隐藏的。

## 范围

### 包含范围

- 后端查询能力：在 `SqliteMessageRepository` 新增 `searchMessages`，按 `session_id` 锁定单会话 + 关键词匹配 + `created_at_ms` 时间范围过滤，按 `seq DESC` 排序、`LIMIT` + `beforeSeq` 翻页；并在 `MessageRepository` port、`MessageService` port 与 `DefaultMessageService` 各加一层透传。查询始终包含隐藏消息（不在 SQL 层过滤 `hidden`），因为隐藏消息对用户仍是可查阅的历史。
- VSCode 风格关键词搜索三态：支持**精准匹配**（子串包含）、**正则匹配**（用户输入正则表达式）、**大小写敏感开关**，参考 VSCode 搜索框的交互范式。精准匹配在 SQL 层用 `content_json LIKE` 粗筛召回候选、内存层精确判定；正则匹配跳过 LIKE，直接把单会话消息拉进内存跑正则。
- 匹配范围限定：关键词只匹配 user / assistant 角色消息的文本内容（`TextBlock.text`），忽略工具调用（`tool_use` / `tool_result`）和思考过程（`thinking` / `redacted_thinking`）——只搜「对话内容」，不搜工具数据和模型中间推理。匹配逻辑作为纯函数下沉到 core，两端复用。
desktop IPC：新增 `nm:messages/search` handler 与 `ipc/client.ts` 入口，请求体携带 `sessionId / keyword / mode（literal\|regex）/ caseSensitive / fromMs / toMs / limit / beforeSeq`，响应复用现有 `ChatMessageDto[]`（已含 `hidden / seq / createdAtMs / bodyText / contentBlocks`）。
- mobile runtime：在 `runtime.messages` 暴露 `searchMessages`，直接调用 core service，与 desktop 走同一份后端逻辑。
- desktop UI：在 `SessionDetailDrawer` 内新增「聊天记录查询」入口与查询面板（关键词输入框 + 搜索三态控件 + 时间范围选择 + 结果列表），结果列表复用现有 `MessageList.tsx` 渲染（已处理 hidden 视觉——「已隐藏」角标 + dimmed）。
- mobile UI：在 `SessionDetailScreen` 新增一张卡片入口，点击 `navigation.navigate` 到新的 `ChatHistorySearch` Stack 页面；同时改齐导航注册三处（`navigation/types.ts`、`RootNavigator.tsx`、`header-config.ts`），参考 `SessionDetail` 的注册链路。
- mobile 时间选择器：引入 `@react-native-community/datetimepicker` 作为时间范围选择的依赖。

### 不包含范围

- 跨会话 / 全项目 / 全局搜索（本期严格限定单个会话内，不做 `JOIN chat_session(project_id)`）。
- 「仅显示隐藏 / 仅显示可见」的过滤开关（查询始终包含隐藏消息，结果靠现有视觉标记区分即可，用户没要求额外过滤）。
- FTS5 全文索引虚表（本期单会话规模内 `content_json LIKE` 粗筛 + 内存精筛 / 正则全量内存匹配已够用；若后续超长会话性能不足再评估 FTS5，需双端驱动验证）。
- 点击查询结果跳转定位到聊天时间线对应位置（mobile 时间线是分页 WebView，跳转能力本期不涉及；desktop 跳转也留待后续）。
- sender 昵称 / 头像维度的展示（`ChatMessageDto` 当前只有 `role: user/assistant/system`，没有昵称字段，本期不扩 DTO）。
- 按消息「最后编辑时间」筛选（表里只有 `created_at_ms`，没有 `updated_at_ms`，编辑不更新时间戳；本期时间范围只能按首次创建时间）。
- 附件内容（`attachments_json`）参与关键词匹配（本期只搜消息正文的 TextBlock）。
- CodeEditor 文本编辑器内的搜索能力（desktop 编辑器用的是 CodeMirror，底座支持 `@codemirror/search` 搜索扩展，但那是「编辑器内 DOM 搜索」场景，跟「在消息列表里筛消息」是两回事；本期不给 CodeEditor 启用搜索扩展，留待后续独立迭代）。
- CLI 端查询命令（CLI 已有 `nm message list` 带 `[H]` 标记，本期不给 CLI 单独加搜索子命令）。

## 核心需求

1. **后端 `searchMessages`**：仓库层新增方法，接收 `sessionId` 与查询条件 `{ keyword?, mode: 'literal' | 'regex', caseSensitive: boolean, fromMs?, toMs?, limit, beforeSeq? }`。SQL 在 `chat_message` 上按 `session_id` 锁定单会话，精准模式下关键词用 `content_json LIKE` 粗筛召回候选，正则模式下跳过 LIKE 直接拉全量单会话消息进内存；时间用 `created_at_ms` 范围比较；结果按 `seq DESC` 排序、`LIMIT` 分页、`beforeSeq` 支持向上翻页。查询不在 SQL 层过滤 `hidden`（始终包含隐藏消息）。因为查询限定在单个 `session_id` 下，能直接走 `(session_id, seq)` 唯一索引前缀，单会话规模内不必额外建索引。

2. **VSCode 风格关键词搜索**：搜索支持三态切换——精准匹配（子串包含）、正则匹配（用户输入正则表达式）、大小写敏感开关，参考 VSCode 搜索框的交互范式。匹配范围限定在 user / assistant 角色消息的文本内容（`TextBlock.text`），忽略工具调用（`tool_use` / `tool_result`）和思考过程（`thinking`）——只搜「对话内容」，不搜工具数据和模型中间推理。精准模式走 `includes`（大小写敏感控制是否 `toLowerCase`），正则模式走 `new RegExp(keyword, caseSensitive ? '' : 'i')`；非法正则不崩溃（返回空结果或给出提示）。匹配逻辑作为纯函数下沉到 core，两端复用。

3. **desktop IPC 透传**：新增 `nm:messages/search` IPC handler（参考现有 `handleMessagesList` 的写法，channel 名沿用 messages 区段的 `nm:` 前缀约定），请求体带完整查询条件，响应复用 `ChatMessageDto[]` 与现有的 `toDto` 映射（`bodyText`、`hidden`、`createdAtMs`、`seq` 都已就绪）。renderer 侧在 `ipc/client.ts` 加对应入口。

4. **mobile runtime 暴露**：在 `runtime.messages` 上挂 `searchMessages`，直接透传到 core 的 `MessageService.searchMessages`，跟 desktop 共用同一份后端实现。

5. **desktop 查询 UI**：在 `SessionDetailDrawer` 底部「次要操作」那块（现有「查看提示词 / 压缩上下文」旁边）加「查找聊天记录」入口，打开后在抽屉内呈现查询面板——关键词输入框、搜索三态控件（精准 / 正则切换 + 大小写敏感开关，参考 VSCode 搜索框的图标按钮样式）、时间范围选择（用原生 `<input type="date">`）、结果列表。结果列表直接复用 `MessageList.tsx`，它已经会渲染 hidden 消息并带「已隐藏」角标，不用新写消息卡组件。

6. **mobile 查询页面**：在 `SessionDetailScreen` 加一张卡片（跟现有「当前智能体 / 当前大模型」卡片同款样式），点击 `navigation.navigate('ChatHistorySearch', { projectId, sessionId })` 进新页面。新页面注册要改齐三处：`navigation/types.ts` 的 `RootStackParamList`、`RootNavigator.tsx` 的 `<Stack.Screen>`、`header-config.ts` 的标题与返回配置，照着 `SessionDetail` 那条链路抄。页面内容同 desktop：关键词框 + 搜索三态控件（精准 / 正则 + 大小写，用 `SegmentedControl` 实现）+ 时间范围（用新引入的 `@react-native-community/datetimepicker`）+ 结果列表。

7. **始终包含隐藏消息，靠视觉标记区分**：查询始终包含隐藏消息（不在 SQL 层过滤 `hidden`），因为隐藏的消息对用户来说仍是可查阅的聊天历史，只是不发给 LLM 而已。结果列表里隐藏消息沿用现有视觉样式——desktop 带「已隐藏」角标 + dimmed，mobile dimmed——用户一眼能分辨，不需要额外的 filter 开关。

8. **与「聊天提示词」严格区分**：UI 文案统一用「聊天记录 / 历史消息」，不沾「提示词」这个词。入口只挂在详情页，跟 `RealPromptPanel`（desktop）/ `RealPromptScreen`（mobile）完全独立，避免用户混淆。

## 验收标准

### 后端查询能力

- **Given** 一个会话有 seq 1-50 的消息，其中 seq 1-10 被置位隐藏（`hidden=1`）
- **When** 调用 `searchMessages(sessionId, { keyword: undefined, mode: 'literal', caseSensitive: false, limit: 50 })`
- **Then** 返回全部 50 条消息（含 seq 1-10 的隐藏消息），按 `seq DESC` 排序，验证查询不在 SQL 层过滤 hidden

- **Given** 会话内某条 user 消息的 `TextBlock.text` 含关键词「魔法设定」
- **When** 调用 `searchMessages(sessionId, { keyword: '魔法设定', mode: 'literal', caseSensitive: false, limit: 50 })`
- **Then** 该消息出现在结果里；且 `tool_result` / `thinking` 块里恰好含同样字符串但该消息没有匹配 TextBlock 的消息，不会被误召回（验证匹配范围只限 user/assistant 的 TextBlock）

- **Given** 会话内某条 assistant 消息的 TextBlock 含「魔法基础设定」
- **When** 调用 `searchMessages(sessionId, { keyword: '魔法.*设定', mode: 'regex', caseSensitive: false, limit: 50 })`
- **Then** 该消息被正则匹配命中并出现在结果里（验证正则模式生效）

- **Given** 会话内某条消息的 TextBlock 含「Hello」
- **When** 调用 `searchMessages(sessionId, { keyword: 'hello', mode: 'literal', caseSensitive: true, limit: 50 })`
- **Then** 该消息不被召回（大小写敏感开启时 'hello' 不匹配 'Hello'）；改成 `caseSensitive: false` 后该消息被召回

- **Given** 用户输入了一个非法正则表达式（如 `[unclosed`）
- **When** 调用 `searchMessages(sessionId, { keyword: '[unclosed', mode: 'regex', caseSensitive: false, limit: 50 })`
- **Then** 不崩溃，返回空结果或给出「正则表达式无效」的提示

- **Given** 会话内消息的 `created_at_ms` 跨越多个日期
- **When** 调用 `searchMessages(sessionId, { fromMs, toMs, mode: 'literal', caseSensitive: false, limit: 50 })` 指定某天的时间范围
- **Then** 只返回 `created_at_ms` 落在 `[fromMs, toMs]` 区间内的消息

- **Given** 会话有 100 条消息
- **When** 调用 `searchMessages(sessionId, { mode: 'literal', caseSensitive: false, limit: 20, beforeSeq: 50 })`
- **Then** 返回 seq 小于 50 的最近 20 条（即 seq 49 down to 30），验证翻页正确

### desktop UI

- **Given** 用户在 desktop 某会话内打开了详情抽屉（`SessionDetailDrawer`）
- **When** 点击「查找聊天记录」入口
- **Then** 抽屉内呈现查询面板，含关键词输入框、搜索三态控件（精准/正则切换 + 大小写开关）、时间范围选择、结果列表

- **Given** 查询面板已打开，会话内有隐藏消息
- **When** 输入关键词并查询
- **Then** 结果列表里隐藏消息带「已隐藏」角标 + dimmed 样式，可见消息正常显示（靠现有视觉标记区分，不需要额外 filter 开关）

- **Given** 查询面板已打开，默认是精准匹配模式
- **When** 切换到正则模式后输入正则并查询
- **Then** 按正则匹配返回结果

### mobile UI

- **Given** 用户在 mobile 某会话内，通过三线按钮进入了 `SessionDetailScreen`
- **When** 点击「聊天记录查询」卡片
- **Then** 转场进入 `ChatHistorySearch` 页面，页面带标题栏与返回按钮

- **Given** 用户在 `ChatHistorySearch` 页面
- **When** 按下 Android 物理返回键 / 点击导航返回
- **Then** 返回到 `SessionDetailScreen`，详情页状态不丢失

- **Given** `ChatHistorySearch` 页面已打开
- **When** 用 `SegmentedControl` 切换精准/正则模式、用 `@react-native-community/datetimepicker` 选定时间范围、输入关键词后查询
- **Then** 结果列表正确呈现，隐藏消息以 dimmed 样式区分

### 双端一致性

- **Given** 同一个会话、同样的查询条件（关键词 / 模式 / 大小写 / 时间范围）
- **When** 分别在 desktop 和 mobile 执行查询
- **Then** 两端返回的消息集合完全一致（因为共用后端 `searchMessages`，不存在双端逻辑漂移）

### 与隐藏机制的关系

- **Given** 一个做过置位 / 压缩的会话（前缀消息 `hidden=1`）
- **When** 在查询功能里用关键词命中某条隐藏消息
- **Then** 该消息能被查出来并展示（带现有视觉标记），验证 `hidden` 标记不影响查询召回，置位 / 压缩不会让历史消息「查不到」

### 与聊天提示词的区分

- **Given** 查询功能入口存在
- **When** 用户查看入口文案与跳转去向
- **Then** 文案是「聊天记录 / 历史消息」，入口只挂在详情页；与 `RealPromptPanel` / `RealPromptScreen` 完全独立，不产生混淆
