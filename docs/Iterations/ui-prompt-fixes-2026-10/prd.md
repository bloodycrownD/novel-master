---
date: 2026-10-02
dependency: []
---

# 四项体验优化（代码块语言标统一 / 附件体积预算 / 常驻开关移除 / 提示词查看轮聚合）PRD

## 背景

本轮四项均为对话与提示词链路的体验优化，来自用户实测反馈（2026-10-02 brain-storm 摸底，四路子代理探索定案）：

1. **代码块语言标不统一**：markdown 渲染中，写了语言且命中高亮表的代码块左上角有语言标；没写语言、或语言在高亮别名表之外的块左上角空白，观感割裂。4 空格缩进代码块则连复制按钮都没有。
2. **附件无体积闸**：用户的文件引用与 skill 引用在提示词拼装时文本恒为全文（`status:"full"`），大文件全量进提示词；子会话虽有「20 条 + 100,000 明文当量字符」预算，但超限形态是「完全不挂附件 + prompt 尾注路径清单」，与主会话拟采用的降级形态不一致。
3. **动态区「常驻」开关冗余**：agent 配置的动态区文本块有 lifecycle 属性（UI 上是「常驻」开关，开 = 每步注入，关 = 仅每轮首个请求注入）。该开关与「回合快照、回合内纯追加」的缓存策略方向相悖，用户拍板移除，只留 once。
4. **提示词查看不便读**：双端提示词查看器把拼装后的 segment 全量平铺，一条消息被拆成多个 tool / tool_call / thinking 片段，Assistant 侧卡片数量远超 user 侧，比例失衡、难以按「一轮对话」阅读。

## 目标（含成功指标）

- 所有非 mermaid 代码块左上角统一显示语言标（无语言/表外语言/缩进块显示 `plain`），双端一致。
- 提示词侧附件总量受 100,000 明文当量字符预算约束，超限自动降级为「文件名引用 + 引导文案」，主会话与子会话、文件引用与 skill 引用行为统一；无条数上限。
- agent 配置双端不再暴露动态区「常驻」开关，动态块语义统一为「每轮 run 的首个请求注入」。
- 提示词查看按 react 轮聚合展示，Assistant 内容（含工具调用）合并为单卡片 + 只读详情，长内容可舒适阅读。

成功指标：双端渲染快照与提示词预览人工核验一致；附件超限场景提示词预览可见降级形态；既有测试套件全绿（契约类断言随本次拍板同步修订）。

## 用户与场景

- 在双端阅读 AI 回复中的代码块：希望语言标样式统一。
- 大文件/多文件引用 + skill 引用：希望提示词体积可控，超限部分自动降级且模型仍知道如何取读。
- 配置 agent 动态区：不再需要理解「常驻」概念。
- 排查/审阅提示词（调试、核对模型实际输入）：希望按对话轮次浏览，user 消息一眼可见，Assistant 的长工具往返折叠进卡片、点开细读。

## 范围

### 包含范围

- 双端 markdown 代码块语言标（含 4 空格缩进块补 plain 标与复制按钮）；mermaid 块维持现状（图表渲染、无语言标）。
- 主会话文本附件与 skill 引用的提示词侧体积预算与降级；子会话 fileAttachment 预算统一（去条数上限、超限改挂降级附件、尾注退役）。
- 动态区 lifecycle 只留 once：双端 UI 开关移除、缺省语义反转、存量数据兼容加载。
- 提示词查看器按 react 轮聚合（双端）；Assistant 轮卡片 + 只读详情（desktop 用 CodeMirror 只读；mobile 用预览式只读，不强求 CodeMirror）。

### 不包含范围

- mermaid 渲染管线与目录规则（dir rule）行为的任何改动；workplace 常驻前缀里由目录规则配置的 filename 档维持现状（仍显示文件名列表）。
- 提示词三区布局（系统/持久/动态）结构、短提示（alreadyReferenced）机制、附件落库 schema 的改动。
- CLI `nm prompt render` 的输出形态（纯文本渲染，不做轮聚合）。
- 子会话 UI 渲染链改动（降级附件的 chip 展示复用现有链路）。

## 核心需求

### R1 代码块语言标统一（双端）

1. 无语言标注的 fenced 代码块、语言在别名表之外的代码块、4 空格缩进代码块：左上角统一显示 `plain` 语言标，样式与现有语言标一致。
2. 缩进代码块补齐复制按钮（与 fenced 块同款）。
3. mermaid 块排除在外（维持图表渲染、无语言标）；「表外语言故意无标签」的旧契约（MF-1）随本次修订为「统一 plain」。

### R2 附件体积预算与降级统一（主会话 / 子会话 / skill）

1. 预算口径：单次提示词拼装内，文本类附件（含 skill 引用的 SKILL.md 全文）合计明文当量字符 ≤ 100,000（inline 按字符数直计、blob 按压缩字节 ×4 折算；图片/二进制/目录不计字符）；无条数上限。
2. 超限降级形态：附件照挂，`display:"filename"`，`content` 为引导文案「文件过长，可用 read 配合 offset/limit 分段读取」。
3. 图片/二进制附件的 filename 档 `content` 统一为「二进制文件，不提供正文」。
4. workplace 前缀中由目录规则配置的 filename 档不受影响（维持文件名列表形态）。
5. 子会话统一：`task` 的 fileAttachment 去掉 20 条上限，超限路径改挂降级附件（替代「不挂附件 + prompt 尾注」），尾注文案退役。
6. 真实发送、token 估算、提示词预览三条链路口径一致；UI 附件 chip 展示不变（仍为 `@路径`）。

### R3 动态区「常驻」开关移除

1. 双端 agent 编辑器删除动态区块的「常驻」开关与「仅首轮请求带入」提示文案。
2. lifecycle 语义只留 once：所有动态块仅在每个 run（每轮用户消息触发的执行）的首个 LLM 请求注入；字段缺省即 once。
3. 存量兼容：已保存的 agent 定义（含 `lifecycle: "once"` 或缺省字段）照常加载，不拒载、无需迁移。

### R4 提示词查看按 react 轮聚合（双端）

1. 切轮口径：以「真用户输入」（user 消息且不含 tool_result）为轮边界；两个真用户输入之间的全部 Assistant 内容（assistant 文本、tool_use、tool_result、thinking）合并为一个轮卡片。
2. user 轮正常展示（沿用现有卡片）；Assistant 轮卡片展示摘要（如首条文本摘要 + 工具调用计数 + 总字数），点击进入只读详情。
3. 详情为舒适的长文只读阅读：desktop 用 CodeMirror 只读模式；mobile 用预览式只读（对齐文件预览的阅读体验，不强求 CodeMirror）。
4. 模板段（system / skills / persist-* / dynamic-* / workplace）独立展示，不被卷进轮卡片。
5. 双端 scope 语义保持不变（路由参数优先、缺省回落全局）。

## 验收标准

**R1**
- GIVEN 无语言代码块 / 表外语言（如 rust、mjs）代码块 / 4 空格缩进代码块 WHEN 双端渲染 THEN 左上角显示 `plain` 语言标；缩进块复制按钮可用。
- GIVEN mermaid 代码块 WHEN 渲染 THEN 图表正常渲染且无语言标（既有 mermaid 管线测试全绿）。
- GIVEN 有语言且命中别名表的代码块 WHEN 渲染 THEN 语言标与现状一致（回归）。

**R2**
- GIVEN 单次拼装中文本附件合计字符超 100,000 WHEN 发送 THEN 超限部分附件降级为 `display:"filename"` 且 content 为引导文案；UI 附件 chip 仍显示 `@路径`。
- GIVEN skill 引用 WHEN 其全文使合计超限 THEN 同上降级。
- GIVEN 图片/二进制附件 WHEN 拼装 THEN content 为「二进制文件，不提供正文」。
- GIVEN workplace 目录规则配置 filename 档 WHEN 拼装 THEN 前缀仍为文件名列表（不受本次影响，回归断言）。
- GIVEN 子会话 fileAttachment 合计超限 WHEN 派发 THEN 超限路径挂降级附件（可见于子会话首条消息附件组），无条数上限；prompt 中不再出现尾注清单。
- GIVEN 同一会话 WHEN 比对真实发送 / token 估算 / 提示词预览 THEN 附件降级口径一致。

**R3**
- GIVEN 双端 agent 编辑器 WHEN 查看动态区 THEN 无「常驻」开关及关联提示。
- GIVEN 存量 agent 定义（lifecycle: once / 缺省 / 手写 always 的 YAML）WHEN 加载 THEN 均可正常解析，动态块按 once 语义生效。
- GIVEN 多步 run（含工具循环）WHEN 执行 THEN 动态块仅在每轮首个请求注入；跨轮（新一轮用户消息）首个请求重新注入。

**R4**
- GIVEN 含多轮工具往返的会话 WHEN 打开提示词查看 THEN user 轮正常展示，轮间 Assistant 内容合并为单卡片，摘要可见。
- GIVEN Assistant 轮卡片 WHEN 点击 THEN 进入只读详情，内容完整可滚动阅读（desktop CodeMirror 只读 / mobile 预览式只读），可复制。
- GIVEN 模板段（workplace/skills 等）WHEN 查看 THEN 独立展示不进轮卡片。
- GIVEN 会话内切换 scope WHEN 查看 THEN 提示词内容随 scope 正确变化（既有 scope 测试保持绿）。

## 风险与待确认项

- R1 涉及「表外语言故意无标签」契约（MF-1）修订，双端测试断言批量更新，需保证 mermaid 与「命中表语言」两类断言不动。
- R2 预算的计量插入点（prepare 链逐条累加）与「首次全文引用」的作用域细节、skill 附件降级的 action 形态，在 SPEC 阶段定案；降级不改 seen（alreadyReferenced）机制语义。
- R3 行为变化已获用户确认：存量「常驻开」（字段缺省 = always）的动态块改为每轮首请求注入；跨轮宏刷新保留。
- R4 mobile 详情屏的组件选型（预览式只读的具体形态）与数据传递（模块级 callback 先例）在 SPEC 阶段定案。
