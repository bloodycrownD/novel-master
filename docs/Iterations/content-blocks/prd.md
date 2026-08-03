# Content Blocks 统一化 PRD

## 背景

当前 `MessageContent` 仅包含 `content?: string` 与 `parts?: ReadonlyArray<unknown>`，类型宽松，难以表达多模态与工具调用消息。`messageBodyText` 在非纯文本场景下对整个 `content` 做 `JSON.stringify`，导致 prompt 渲染与 CLI 展示不可读，也无法与主流 LLM API 的消息块结构对齐。

本期在**不保留旧格式兼容**的前提下，将消息体统一为强类型的 **Content Blocks** 数组，覆盖 `text` / `image` / `tool_use` / `tool_result` / `thinking` 五种块，并贯通 Core、CLI 与 Provider。

## 目标（含成功指标）

**目标**：建立唯一的消息体模型 `blocks: ContentBlock[]`，替代 `content` / `parts`；打通写入、读出、展示、Provider 往返与 prompt 文本提取。

**成功指标（首要）**：

- `messageBodyText` 与 prompt 中的 chat 段**不再**对整包 `content` 使用 `JSON.stringify`。
- 各 block 类型有**可判定的**纯文本/占位规则（见验收标准）。

**次要指标**：

- TypeScript 编译期覆盖五种 block 变体；非法结构在写入前被拒绝。
- 至少一个内置 Provider 路径可完成含 `tool_use` / `tool_result` 的消息往返并落库为 blocks。
- CLI 可对五种 block 进行 append 与 list/get 的人类可读展示。

## 用户与场景

**用户**：Novel Master CLI 用户、基于 `@novel-master/core` 构建的自动化/Agent 集成方。

**场景**：

1. **多模态对话**：用户消息含 text + image block，assistant 回复含 text。
2. **工具调用**：assistant 输出 `tool_use`，系统写入 `tool_result`，再继续对话；prompt 渲染时工具块以约定占位呈现而非 JSON。
3. **推理/思考块**：模型返回 `thinking` block，落库后在 list/prompt 中按规则展示或省略。
4. **调试与验收**：通过 CLI append/list 构造并检查各 block 类型，无需阅读整段 JSON。

## 范围

### 包含范围

- **Core 模型**：`MessageContent` 仅保留 `blocks: ContentBlock[]`（废除 `content`、`parts`）。
- **五种 block 类型**：`text`、`image`、`tool_use`、`tool_result`、`thinking`（第一期全部支持）。
- **校验与解析**：写入/读取 `content_json` 时校验 block 形状；非法结构报错。
- **文本提取**：`messageBodyText` 及 prompt chat 渲染按 block 类型生成可读字符串（非 stringify 整包）。
- **CLI**：`nm message append` 支持按 block 结构写入；`nm message list` / `get` 友好展示各 block。
- **Provider**：与现有内置 Provider 的请求/响应映射，完成至少一条含工具块的端到端路径。

### 不包含范围

- **存量消息迁移**：不兼容旧 `content` / `parts` 格式；不自动转换。旧数据需清库或接受读取失败（用户已确认不留技术债）。
- **移动端 / Web UI** 展示与编辑。
- **用户自定义 block 类型**或插件式扩展机制。
- （待确认）流式增量 block 组装是否纳入本期——未在范围澄清中排除，若实现成本高建议单列后续迭代。

## 核心需求

1. **统一存储形态**：`content_json` 仅表达 `{ "blocks": [ ... ] }`（或等价、仅含 blocks 字段的对象）；禁止再写入顶层 `content` / `parts`。

2. **强类型 ContentBlock 联合体**：五种 block 各有明确业务字段（如 text 的正文、image 的引用或载荷标识、tool 的 id/name/input/result、thinking 的正文）；编译期可区分，运行时可校验。

3. **可读文本提取规则**：`messageBodyText` 按序处理 blocks——`text` 拼接正文；`image` / `tool_use` / `tool_result` / `thinking` 使用稳定、可测试的占位或摘要格式（具体文案在 SPEC 阶段定稿，PRD 要求「可判定、非 JSON 整包」）。

4. **CLI 写入与展示**：append 支持构造五种 block（含纯 text 的简便路径）；list/get 按块类型分行或分段展示，默认不 dump 原始 JSON。

5. **Provider 互通**：内置 Provider 发送/接收消息时，在 Provider 原生格式与 `ContentBlock[]` 之间转换；`raw_json` 可保留原始响应，但 `content_json` 必须以 blocks 为准。

6. **失败策略**：解析到旧格式或未知 block 类型时**明确报错**，不静默降级、不 best-effort 转换。

## 验收标准

### 数据模型与存储

- [ ] `MessageContent` 类型定义中仅有 `blocks`（及 SPEC 允许的元数据字段，若有须在 PRD 变更中追加），无 `content` / `parts`。
- [ ] 通过 `MessageService.append` 写入仅含 blocks 的消息后，DB 中 `content_json` 可解析为 blocks 数组，且 round-trip 后块类型与字段一致。
- [ ] 对仅含 `{ "content": "hello" }` 的旧 shape 调用 `get` / `listBySession` 时抛出可识别的错误（或文档约定的「需清库」行为），**不**自动迁移为 text block。

### messageBodyText / Prompt

- [ ] Given：消息仅含一个 `text` block `"hello"`，When：`messageBodyText`，Then：输出为 `hello`（或 SPEC 约定的换行拼接规则），**非** JSON。
- [ ] Given：消息含 `text` + `tool_use` + `tool_result`，When：`messageBodyText` 或 `nm prompt render` 的 chat 段，Then：输出包含 text 正文及各非 text 块的占位/摘要，**非** `JSON.stringify(content)`。
- [ ] Given：消息含 `image` 或 `thinking` block，When：提取正文，Then：符合 SPEC 定义的占位规则且测试可断言。

### CLI

- [ ] 可经 CLI append 一条仅 `text` block 的消息，list 显示可读正文。
- [ ] 可经 CLI append 含 `tool_use` 或 `tool_result` 的消息（按 SPEC 规定的输入方式），list 显示块类型与关键字段，而非整段 `content_json`。
- [ ] 五种 block 类型各至少有一条手工或自动化验收用例可复现。

### Provider

- [ ] Given：配置有效的内置 Provider，When：发送含 tools 的对话并收到含 `tool_use` 的 assistant 消息，Then：落库的 `content.blocks` 含对应类型，且再次 `get` 结构一致。
- [ ] Provider 原始响应仍可在 `raw_json` 中查阅，但不作为 `messageBodyText` 的数据源。

### 构建与回归

- [ ] `packages/core` 与 `apps/cli` 构建通过；与 message / prompt 相关的测试更新并通过。
- [ ] 与 message-visibility（`hidden`）等现有能力组合使用时不回归（hidden 消息仍按现有规则过滤）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 破坏性变更 | 不兼容旧库；需在发布说明中要求新建 DB 或清表。 |
| image 载荷 | 图片以 URL、base64 还是 VFS 引用存储——SPEC 阶段需与 Provider 能力对齐。 |
| thinking 可见性 | prompt 是否默认排除 thinking block，与 message-visibility 的 `hidden` 关系需在 SPEC 明确。 |
| 流式响应 | 是否在本期支持流式拼接 blocks；若否，列入下一期 PRD。 |
