---
date: 2026-10-02
dependency: Iterations/ui-prompt-fixes-2026-10/prd.md
---

# 提示词预览 UI 重设计 PRD

## 背景

R4（提示词查看按 react 轮聚合）在真机验收中被用户否决 UI 形态：「太简陋了」。现状痛点（探索实锤）：

- **轮形态不等价**：assistant 轮是摘要卡+全屏详情，user/template 轮却是段卡平铺（不能整轮收起、不能全屏）；user 轮摘要只是段名（如 `#12 · user`），没有真摘要。
- **正文渲染简陋**：mobile 全屏详情走纯文本分支（等宽 Text），desktop 详情是纯文本 CodeMirror——都没有富文本排版。
- **assistant 轮详情是一坨平铺文本**：带 `[段名]` 前缀的大字符串，没有结构。
- **没有工具调用成对概念**：core 预览段把 tool_use 压成字符串、一条消息里多个 tool_result 合并成一个段（toolUseId 与成败状态全部丢失）；悬挂 tool_use（无 result）与正常调用完全同形，无缺失痕迹。

数据层现状约束（决定改造深度）：配对无损数据源在 ChatMessage content blocks（tool_use{id,name,input} / tool_result{toolUseId,content,ok}）；CLI parity 契约（T-R5：扁平段 join == CLI 文本）冻结不能破坏；mobile 轮卡就地展开区不能塞 WebView（多实例内存爆炸+列表滚动冲突），WebView 富文本只能放全屏页单实例。

用户拍板的决策：双端一起改；user 轮也收起成摘要卡（等价到底）；交互层级=就地展开+子卡全屏；成对形态=一对一组卡。

## 目标（含成功指标）

把提示词预览页（mobile RealPromptScreen/PromptTurnDetailScreen 一族、desktop RealPromptPanel）重做为三层结构：**收起的轮摘要卡 → 就地展开的嵌套卡片流（工具调用成对组卡）→ 任意卡片全屏富文本只读**。双端同构。

成功指标：

- 打开预览页，所有轮（user/assistant/template）一律是收起的摘要卡，列表一眼可扫。
- assistant 轮展开后，每次工具调用呈现为一对一组卡，配对关系一目了然；失败有明确标识、丢失有占位。
- 任意叶子内容（用户输入/assistant 文本/工具参数/工具结果/模板段）都能全屏以富文本只读查看。
- core 单测覆盖配对正确性（含并行工具调用、失败、丢失），双端既有回归全绿。

## 用户与场景

- 主要用户：开发者本人（调试提示词组装）。
- 场景：排查「模型这轮看到了什么」——快速扫轮列表定位某轮，展开看工具调用链（哪个调用失败了/结果丢了），点开全屏细读大文本（workplace、附件全文、长工具输出）。

## 范围

### 包含范围

- mobile 与 desktop 的提示词预览 UI 重构（同迭代内替换 R4 现有形态）。
- core 预览段/轮聚合数据结构扩展（配对字段、丢失占位、非 assistant 轮真摘要）。
- 双端 DTO/IPC 载荷策略调整（结构化明细可达渲染层）。

### 不包含范围

- 提示词编辑（保持只读）。
- 对话 transcript 页的工具卡改造（不动聊天页）。
- desktop 真全屏容器（沿用现有 Modal 近全屏形态即可）。
- mobile 就地展开区的 WebView 渲染（性能约束明确不做，就地展开一律原生轻量渲染）。
- 预览刷新机制（run 进行中快照行为不变）。

## 核心需求（3-7 条）

### 1. 轮卡统一等价

user / assistant / template 三类轮统一为「默认收起的摘要卡」。user 轮补真摘要口径：用户输入正文首行截断 + 字数（不再是纯段名）；template 轮（system/skills 索引/workplace/persist-*/dynamic-*）同样收起为摘要卡+可全屏（恒单段，轮卡即段卡形态）。

### 2. 就地展开嵌套卡片流

轮卡点击就地展开（再次点击收起），展开区为原生轻量渲染（卡片头摘要+正文截断预览，mobile 用 RN 组件、desktop 用现有折叠卡样式），不塞 WebView。轮卡同时提供「整轮全屏」入口。

### 3. assistant 轮嵌套结构：一对一组卡

assistant 轮展开后的卡片流按真实因果顺序呈现：assistant 文本片段卡、thinking 卡（独立卡）、**工具调用组卡**。组卡=一次调用一张：组卡头显示「工具名 · 状态」，内部上下两格——tool use（参数）与 tool result（结果）。

- 成对保证：core 按 tool_use_id 配对（跨消息的 use 与 result 归入同一组卡；一条 assistant 消息多个 tool_use + 下一条消息多个 tool_result 时按 id 配对，不按位置猜）。
- 失败态：result 的 ok=false（或 legacy 缺省但正文 Error 前缀）时，组卡头与结果格显示失败标识。
- 丢失态：悬挂 tool_use（无对应 result）的组卡保留 result 槽位，显示占位文案（如「未返回结果」）——不消失、不乱序。

### 4. 全屏查看通用

每张叶子卡（user 输入、assistant 文本、tool use 参数、tool result 结果、模板段）均可点开全屏只读查看。mobile 全屏页复用 rich-content WebView 富文本管线（markdown/代码块高亮，与文件预览一致）；desktop 全屏用聊天正文同款富文本渲染组件（MermaidMarkdown 一族）。超长降级沿用现有口径（mobile >200k 字退化纯文本+提示）。

### 5. core 数据层支撑

预览段扩展结构化字段（至少：块类型 tool_use/tool_result、toolUseId、工具名、成败态），配对与丢失占位在 core 轮聚合层产出，DTO 透传到双端；不破坏 CLI parity 冻结契约（扩字段不改段 body 文本）。

### 6. 正文渲染升级

全屏正文（mobile 全屏页 / desktop 展开与全屏）用富文本渲染；就地展开区允许轻量预览（纯文本截断）。user 轮正文卡片取 prepare 后完整形态（含附件引用段，与实际发给模型的逐字一致）；轮摘要取该文本中**用户输入内层首行**（剥 wrap 标签），两者口径见 SPEC「cards 构造口径」。

## 验收标准

1. **轮卡统一**：双端打开预览页，三类轮均为收起摘要卡；user 轮摘要=**用户输入内层首行**（prepare 后带附件的消息整体被 wrap 标签包裹，摘要须取其中用户输入部分的首行，>70 字截断）+字数与附件计数；template 轮摘要含段名+字数。**摘要 UI 呈现不得超长**：摘要行限行数截断+省略号（单行省略），meta 行（字数/工具计数/失败丢失计数）独立一行同样限长。
2. **就地展开**：点 user/assistant/template 轮卡就地展开/收起；展开区为原生渲染；轮卡有整轮全屏入口。
3. **成对组卡**：assistant 轮展开后每次调用一张组卡（头=工具名+状态，内部 use/result 两格）；Given 一条 assistant 消息含两个 tool_use 且下一条消息含两个 tool_result（并行调用），When 展开该轮，Then 按 id 正确配对成两张组卡。
4. **失败标识**：tool result ok=false 的组卡显示失败标识（红）且结果正文含错误内容。
5. **丢失占位**：悬挂 tool_use（消息流中无对应 result）的组卡保留 result 槽位并显示占位文案。
6. **全屏富文本**：任一叶子卡点开全屏，mobile 为 WebView 富文本（代码块高亮）、desktop 为富文本组件；mobile 超 200k 字降级纯文本+提示。
7. **core 单测**：配对（含并行/跨消息）、失败、丢失占位、user/template 轮摘要口径、既有 T-R1~T-R5 回归全绿。
8. **双端回归**：预览入口与 scope 正确性既有测试（real-prompt-screen-scope、chat-tab-real-prompt-nav、real-prompt-panel-rounds）适配后全绿；R4 旧形态断言按新形态更新。

## 约束与依赖

- CLI parity 冻结契约（T-R5）：段 body 文本与扁平段 join 结果不可变，只允许扩字段。
- mobile：RealPromptScreen 顶层不可新增 useNavigation import（测试 mock 红线）；大载荷不走路由参数（沿用模块级 callback 先例）。
- 性能：就地展开不创建 WebView 实例；desktop 面板保持「默认收起减渲染压力」取向。
- DTO 体积策略调整（assistant 轮结构化明细下发）需重新评估长会话载荷，按需拉取或全量由 spec 定。
- web 资产若改动需 build:webview 并过门禁 B/C。

## 风险与待确认项

- 提示词正文含 mermaid 围栏时会被富文本管线渲染成图表（与 transcript 行为一致）——默认跟随管线原样，不特殊处理；如观感违和再议。
- tool result 的 legacy 行无 ok 字段，失败判定口径（显式 ok + Error 前缀启发式兜底）在 spec 阶段细化。
- thinking 段受用户偏好开关控制（includeThinkingBlocks），展示与现口径保持一致。
