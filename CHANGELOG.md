# Changelog

本文件记录各版本面向用户的更新说明。发版前在对应 `## [x.y.z]` 条目下补充内容；推送 `v*` tag 后 CI 会将该段落写入 GitHub Release 的「更新说明」区块。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.5.0] - 2026-08-11

### 新增

- **Linux 支持**（桌面端）：桌面端现在可以在 Linux 上运行，密钥存储通过系统 Secret Service（GNOME Keyring / KWallet）安全管理

### 修复

- **置位 / 压缩后 token 计数不刷新**（桌面端）：修复执行「置位」或手动压缩后，会话详情抽屉里的 token 计数没有及时更新的问题
- **Android 键盘遮挡输入框**（移动端）：修复一批弹窗和整页在 Android 上弹起软键盘时盖住输入框的问题——之前这批页面虽然启用了键盘避让，但 Android 模式被设为空，导致完全不起作用；现在数字输入和文本输入表现一致

### 变更

- **移除事件配置系统**：删除了三端的「事件配置」入口和 CLI 命令——这套系统实际上只服务于压缩的「隐藏消息」一个动作，现在该动作已直接合并进压缩配置，不再需要独立的事件编排
- **压缩配置合并进聊天配置**：压缩配置不再是独立页面，已合并进「聊天配置」（移动端）/「聊天偏好」（桌面端）；同时移除了作用不大的「可见条数阈值」，「隐藏起始深度」改为独立于压缩开关（对自动和手动压缩均生效）；字段统一为左标签右控件的横向布局，输入框改动后自动保存

### 维护

- **压缩执行直调化**：压缩触发后直接执行隐藏消息与 kkv 清理，不再经事件编排器中转
- **旧 migration 注册表清理**：从 schema migration 注册表移除 6 条已固化进建表 SQL 的旧 migration，并新增数据库版本基线前置检查

## [1.4.21] - 2026-08-10

### 新增

- **token usage 持久化**：assistant 消息现在会持久化 LLM 返回的 token usage（promptTokens / completionTokens / totalTokens），重启后不丢失；cache 失效后可从历史消息自动回填，无需重新调用 tokenizer
- **专属模型扁平下拉**：Agent 配置的模型选择从分组列表改为扁平下拉（「默认(跟随) + 全部模型」），更直观

### 修复

- **Desktop 消息列表不滚动**：修复消息增多后列表没有 scroll、输入框被挤没的问题（ChatRail className 笔误）
- **子会话退出再进入消息消失**（Bug3）：修复子会话在流式输出中退出再进入时，因 `needsOpenSnapshot` 被 deferred 跳过导致消息丢失的问题——新增 AgentStreamRegistry 让子会话流可注册 / 查询，并补齐多步重进与并发场景的稳定性
- **rewind 后批注草稿残留**（Bug1）：修复 rewind / undo_send 后批注草稿 chip 残留的问题——现在按锚点消息角色区分：assistant 锚点清空全部批注草稿，user 锚点保留未发送草稿并重新投影

### 变更

- **token 标签 UI 简化**：Token 计数标签不再显示 `· api`，统一显示「自动」（涵盖 API 命中 / heuristic 估算 / 模型缺失三种场景）
- **用户配置移除 heuristic 手动选项**：手动选择模型时不再提供 heuristic 选项（手动选择即明确模型，heuristic 选项无意义）；历史持久化的 heuristic 值在读取时自动归一化为 auto

## [1.4.20] - 2026-08-09

### 新增

- **子会话文件引入导航**（移动端）：子会话里的文件引入卡片现在可以点击跳转到文件编辑器，之前点击无反应
- **空状态引导提示**：无项目时点「新建会话」会提示「请先创建或选择项目」；桌面端 Picker 弹窗在列表为空时显示「暂无可选项，请先在设置中创建」

### 修复

- **流式停止丢消息**：修复点击停止后已接收的流式内容被撤回的问题——现在会保留模型刚吐出的 partial 内容
- **token 计数不刷新**：修复提示词 token 统计只在每轮结束后刷新的问题——现在每条消息提交后实时更新
- **子会话流式丢失**（移动端）：修复子会话流式输出进行中退出再进入时流式内容清空的问题——新增按 sessionId 缓存流式内容，重进时恢复
- **子会话面板 keep-alive**（桌面端）：修复桌面端子会话面板退出时被卸载导致流式内容丢失的问题——改为 hidden 切换保持挂载
- **edit 工具中文引号**：补全 action XML 解析的 HTML entity（`&ldquo;` `&rdquo;` 等），并在替换失败时输出 codepoint 诊断信息帮助定位字符差异
- **undo_send 空 targetTree**：回滚操作目标文件树为空时拒绝删光会话工作区，防止数据丢失
- **Android SKSP version 列**：Android SKSP 的 SELECT 语句补上 `version` 列，与 macOS / Windows 对齐
- **SKSP 空 env 语义**：收紧三端 SKSP env 覆盖逻辑——空字符串 / 空白 / undefined 一律视为不覆盖 DB
- **customAttach 透传**：修复 normalize-agent-prompt-layout 丢失 customAttach 透传的问题

### 变更

- **CI 基建**：新增 GitHub Actions CI 工作流（lint + typecheck + test）；全包补 ESLint 配置 + typecheck 脚本 + knip 死代码扫描
- **数据安全**：abort 统一走 `handleAbort` 编排；cloud-sync push 加进程内互斥锁；rollback 加乐观锁版本号；所有产生消息的入口写 baseline checkpoint
- **CoordinatedWrite 抽象**：新建跨资源写编排（secretStore / kkv / append+capture+append 链），失败时按注册逆序回滚
- **死代码清扫**：删除 7 个废弃文件 + 5 个死导出（deprecated alias / estimateTokens / chat-grep-tool / 净 diff 模块）；新增 lint 规则永久禁止 public barrel re-export @deprecated 符号
- **SKSP 三端抽象**：SKSP secret store 抽公共 SQLite 编排（模板方法模式），三端只保留各自的加密 / 解密 strategy
- **ESLint 三端统一**：共享 TS 规则导出；desktop 改为 import 共享规则；mobile 迁移到 ESLint 9 flat config
- **TS 增量编译**：core build 去掉 `--force` 启用增量；mobile tsconfig extends base；CLI 加 project references
- **countTokens 公共函数**：三端共用 `countTokens` 纯函数；RN tokenizer 诚实标记为 heuristic；compaction evaluator 在 heuristic 模式下走保守阈值
- **Myers diff**：VFS save mapping 的 diff 算法从朴素 O(n²) 替换为 Myers；expandAnchorHunk 改为对称线性扩展
- **TDBC SAVEPOINT parity**：driver-rn 嵌套事务走 SAVEPOINT；新建跨端 parity 测试套件
- **FileSystemPort 注入**：S3 object storage 去掉 `node:fs` 硬依赖，改为 `FileSystemPort` 接口注入
- **DRY 收敛**：desktop event-types 删手抄副本直接 import core；mobile + desktop yaml service 抽公共编排；纯工具函数移到 core/common；webview post.ts 统一；vfs replace 抽纯函数

### 维护

- **内部包锁 0.0.0**：所有内部包统一锁定 version 0.0.0，仅端产品（desktop / mobile / cli）发版
- **kkv / session-kkv public barrel**：新建 public barrel 收拢导出路径
- **memoize 工具**：新增纯函数 memoize 工具；SqlTemplateParser / expression 加缓存；vfs-path-mapper 重复 normalize 收敛为一次
- **SSE parity**：抽公共 `dispatchSseChunk`，fetch / XHR 两路统一
- **文档归档**：CR loop 产出文档归档到 `docs/Iterations/cr-fix-spec/review`

## [1.4.19] - 2026-08-09

### 新增

- **子代理（task 工具）**：主智能体在对话中可通过 `task` 工具派生子智能体执行子任务，子任务在独立的子会话中运行，主对话窗口不会被中间过程撑爆。消息流里的 task 卡片可点击进入对应子会话，实时查看子智能体的逐字流式输出；运行中可随时点停止按钮中断，中断信息会作为结果回流给主智能体继续推进对话
- **智能体「模式」字段**：每个智能体可设为默认 / 主对话专用 / 仅子代理可用，控制它在哪些场景出现
- **智能体描述字段**：每个智能体可填写一段简介，主智能体挑选子代理派生时会看到这段描述，派生更精准
- **CLI 智能体导入导出补全**：命令行的智能体导入导出现在完整带上工具列表和子代理相关配置，导入即可用

### 修复

- **工具结果消息丢失结构**：修复 `tool_result` 类消息在拼接用户消息时被错误包裹、丢失原有 block 类型的问题，工具调用链路恢复正常
- **压缩 / 置位后消息样式不刷新**：上下文压缩或置位操作完成后，消息列表会立即刷新样式（移动端与桌面端均已修复），被隐藏的内容能正确呈现隐藏态

## [1.4.18] - 2026-08-07

### 新增

- **批注附件 chip 显示用户批注内容**：批注附件在消息卡片上不再显示文件路径，而是显示「批注:用户批注内容」（过长自动截断），更直观
- **批注附件补行号提示**：发送给 AI 的批注附件现在带有行号信息，模型能更精准定位原文位置
- **聊天页智能体/模型快速切换**：聊天页顶部的智能体和模型标签现在支持点击，可直接切换，无需进设置
- **会话详情页查看提示词**：会话详情页新增「预览提示词」入口，可查看实际发送给 AI 的完整提示词
- **会话详情页压缩上下文**：会话详情页新增「减少上下文占用」入口，与聊天页行为一致
- **文件管理器导入导出补全**：文件夹菜单新增「导入 ZIP」（覆盖该文件夹）和「导入角色卡」；上方菜单新增「导出 ZIP」（导出当前目录所有内容），导入导出入口全面对齐

### 修复

- **编辑弹窗键盘白条**：消息编辑弹窗键盘弹起时底部不再出现白色条纹，遮罩层完整覆盖
- **编辑弹窗键盘避让卡顿**：键盘弹起/收起时面板不再抖动，改用 GPU 合成层动画
- **全站输入框键盘避让**：新增模型、编辑模型名、文本提示、目录规则等弹窗统一修复键盘遮挡问题
- **导出可并发触发**：ZIP 导出过程中重复点击不再触发多次导出

### 变更

- **导入生成目录规则默认开启**：导入 ZIP 或角色卡后生成的新目录，目录规则默认为开启状态（与手动创建目录一致）
- **提示词预览页关闭转场动画**：从会话详情页进入提示词预览时不再有转场动画，提升切换流畅度
- **隐藏聊天输入框更多按钮**：聊天输入框左下角的更多按钮暂时隐藏（代码保留），为后续功能预留位置
- **锁定判据统一**：智能体/模型锁定逻辑收敛到公共 helper，三处调用方共用，减少重复代码

## [1.4.17] - 2026-08-05

### 新增

- **自定义附加信息**：agent 配置新增「会话消息」开关，开启后可填写一段常驻附加信息（支持 `{{$time}}`、`{{$week_cn}}`、`{{$filetree}}` 宏），每条用户消息发送时自动拼入提示词。全局 agent 与项目级 agent 两条入口均支持，桌面端与移动端一致
- **移动端表单键盘避让**：所有走公共表单壳的页面（agent 编辑、项目级 agent 配置、Provider、CloudSync、Events、ModelSampling、CompactionConditions）现在与聊天页一致——键盘弹起时输入框不被遮挡、顶部内容不被裁切、整页可正常滚动

### 修复

- **write 工具相对路径报错但文件已写入**：write 工具入口统一路径规范化，不再出现「文件写入成功却报 INVALID_PATH」的不一致中间态
- **开启附加信息后纯文本消息不注入**：修复无附件的纯文本用户消息被提前跳过、导致 customAttach 的 `<extra-info>` 块无法注入的问题

### 变更

- **workplace 附件死代码注释清理**：消息附件链路中已无写入来源的 workplace 残留注释全部修正为「历史只读兼容」，代码与现状对齐

## [1.4.16] - 2026-08-04

### 新增

- **聊天记录查询**：会话详情页新增「查找聊天记录」入口，支持关键词搜索当前会话的全部消息（含隐藏消息）。Mobile 与 Desktop 共用同一份后端，结果卡片点击可展开查看完整文本

### 修复

- **fs 工具路径含空格删除失败**：agent fs 工具从命令行字符串解析改为 JSON 结构化参数（`{ action, path?, from?, to?, recursive? }`），路径含空格或特殊字符时不再被截断
- **聊天记录查询结果无法查看全文**：搜索结果卡片现在可点击展开/收起完整内容
- **聊天记录查询空结果无提示**：修复 FlatList 空态组件高度为 0 导致「未找到匹配的聊天记录」不可见的问题

## [1.4.15] - 2026-08-03

### 新增

- **聊天会话详情页（QQ 式）**：Mobile 顶部右侧三线按钮现在打开会话详情页，承载聊天名点击 inline 编辑、当前智能体 / 当前大模型卡片切换；⋯ 按钮仍弹出原 `SessionActionsDrawer`，继续承载查看提示词 / 压缩上下文 / 切换大模型 / 切换智能体（重命名入口收敛到详情页 inline 编辑）。Desktop 将原会话操作菜单与底部 `WorkspaceFooter` 统一收拢为模态抽屉 `SessionDetailDrawer`，入口更集中
- **单聊级智能体配置**：每个会话现在独立绑定一个 agent（引用 registry agent id，不私存配置内容），解析链为「项目 custom 截断 > session.agentId」；agent 在 registry 改了，所有引用该 agent 的会话自动跟随。项目 custom 命中时截断，agent 切换入口禁用并给出引导
- **单聊级模型配置**：每个会话可独立指定 modelId，解析链为「agent pin（definition.model）> session.modelId」；agent 带 pin 时截断（model 切换入口禁用），否则用 session.modelId
- **两级解析链**：移除 workspace 运行时回退层；agent 链为 `project custom 截断 > session.agentId`，model 链为 `agent pin > session.modelId`。workspace 仅作为「新建会话时复制的默认值来源」，会话创建后即独立持有配置，不再 follow / 回退

### 变更

- **会话配置存为 partial overlay**：`SessionAgentConfigPatch` 改为 partial overlay——切换 agent 时保留 modelId，切换 model 时保留 agentId；`modelId: null` 表示清除会话 model 覆盖（回退到 agent pin 指定的模型）
- **`SET_AGENT_BINDING` null 语义**：允许传 null，语义为「同步到 workspace 当前 agent 作为该会话新默认值」（会话始终持有 agentId，这不是解绑/回退，而是同步到当前默认）
- **核心层清理**：移除 CLI-only 入口（`cliModelId` / `definitionOverride` / `allowAssistantContinue` / `maxStepsOverride`）与 workspace 运行时回退层；core 与 mobile/desktop 更干净，CLI 降级为本地测试用途

### 修复

- **`source='none'` 时卡片锁定**：当 session.agentId 指向已删 agent 时，详情页 agent / model 卡片现在会锁定不可点击，Mobile 与 Desktop 口径一致
- **ModelPicker session 模式误高亮**：session 模式下 modelId 为空时不再回退 workspace 当前模型去高亮，避免误以为会话已绑模型
- **chat-prompt-tokens DRY**：主路径与 fallback 各自重复读取 sessionConfig 的问题已抽 helper 消除

## [1.4.14] - 2026-08-02

### 修复

- **导入角色卡 / ZIP 后回滚清空工作区**：导入属于绕过 checkpoint 的写入，聊几轮再撤销发送到首条消息时，会因为没有基线快照而把整个工作区当空基线清空。已在导入事务末尾为空窗消息补一条指向当前文件的基线快照，并在撤销发送的空基线分支回退到锚点自身快照兜底；中途有 checkpoint 的消息不受影响

## [1.4.13] - 2026-08-02

### 修复

- **导入角色卡 / ZIP 到根目录导致 session 删不掉**：在根目录（`/`）附近触发导入时，会向 `vfs_entry` 写入一条多余的根目录行；该行在删除时会被子项检查把自己匹配上，误报「目录非空」并回滚整个删除事务，表现为对应 session / 项目无法删除，且工作区出现一个删不掉的 `/` 文件夹。已修复根行自指匹配，并阻止向隐式根写入显式目录行

## [1.4.12] - 2026-08-01

### 新增

- **User ops 总开关**：聊天配置新增手改操作日志总开关；关闭后不再产生手改 chip 与对应附件，已存在的待发手改也会一并清空
- **Frontmatter 批注**：Mobile 预览与 Desktop 编辑器放开 Frontmatter 批注，与正文一样可标注

### 变更

- **VFS 版本管理重设计**：文件版本存储从路径主键改为 entry_id 自增主键 + scope 寻址，revision 改为引用计数；内容去重的 blob 共享更稳健，回滚与 GC 更准确
- **Session 创建与重命名加速**：新建会话、分叉、复制、目录重命名改为批量操作，70 文件目录的重命名从约 1s 降到几 ms

### 修复

- **关闭手改开关不清存量**：关闭总开关时清空所有会话的待发手改日志，不再残留可空发的 chip
- **Front Matter 在超长消息时丢失**：DocumentApp over-limit 分支也并入 Front Matter，不再因消息过长截断 FM
- **Checkpoint 孤儿行静默丢弃**：迁移时找不到 session 的 checkpoint 行不再静默消失，改为丢弃并告警
- **Worktree 孤儿路径渲染**：文件管理器过滤掉 VFS 无对应 entry 的 worktree 残留路径，不再显示点不进去的幽灵目录

## [1.4.11] - 2026-07-29

### 修复

- **Mobile Android 键盘抬升裁顶**：改用 `marginBottom` 收缩聊天与编辑区域，避免键盘弹起时顶部内容被裁出可视区；与 1.4.10 的同步动画配合后，弹起 / 收起更稳
- **Frontmatter 不闭合误判**：遇到未闭合的 FM 不再按有 FM 解析，直接当无 FM 正文处理，避免错误截断首行；相关格式无效的旧分支一并清理
- **Mobile 未闭合 FM 提示 UI 双重渲染**：清理了提示组件的重复挂载，提示条不再叠加显示

## [1.4.10] - 2026-07-29

### 修复

- **Mobile Android 聊天键盘与消息区不同步**：消息列表与输入框共用同一套键盘高度抬升动画，弹起 / 收起时不再一先一后；不再靠底部留白压缩消息区
- **Mobile 文件编辑软键盘盖住正文**：编辑页与聊天同款抬升避让，末行不再被键盘上方白带挡住；光标在键盘变化后滚入可见区

## [1.4.09] - 2026-07-28

### 修复

- **Mobile Android 聊天输入框被键盘遮挡**：聊天页用 `KeyboardStickyView` 跟随软键盘抬升，并为消息区预留底部空间，避免盖住最后几条；适配 Android 16 上 `adjustResize` 不稳定的情况
- **取消编辑消息后输入框残留正文**：打开「编辑消息」不再写入 Composer 草稿；取消后输入框保持为空（撤回发送回填不受影响）
- **导入角色卡 / ZIP 后 Revision not found**：导入与树复制会为 live head 补齐 revision，后续删除无关文件再 checkpoint / 回滚不再因缺 revision 失败

### 变更

- **启动略快**：库结构已对齐时跳过重复 DDL / 列对齐；Mobile 部分初始化改为按需加载，减少首屏卡顿

## [1.4.08] - 2026-07-27

### 变更

- **服务商身份 UUID 化（破坏性）**：服务商技术主键改为 UUID；创建时填写「服务商名称」（必填），列表 / 详情 / Agent 下拉等主路径按名称展示（正式撤销 `mobile-bugfix` 中「移除展示名、改以服务商 ID 展示」的决策）。CLI 创建改用 `--name`，旧 `--providerId <slug>` 创建不再兼容。密钥环境变量改为 `NOVEL_MASTER_PROVIDER_<UUID>_API_KEY`，旧如 `NOVEL_MASTER_PROVIDER_OPENAI_API_KEY` 不再命中。升级旧库时自动迁移；无法映射的模型建议 / 当前服务商指针会被清空，以免启动失败

### 修复

- **Mobile 表单底部主按钮热区**：`StickyFormFooter` 主色条左右空白亦可点击（不再只点文字才生效）；Android 上 `PrimaryButton fullWidth` 命中区与视觉条对齐
- **Mobile 工作区正文读写（RN）**：ContentStore 在 Hermes / RN 落库改为 `zlib-b64`，并兼容读取既有 `zlib` 行；升级后打开旧库、新建再读不再因 BLOB 读成 string 报错

## [1.4.07] - 2026-07-26

### 新增

- **导入角色卡**：Desktop / Mobile / CLI 支持导入酒馆 PNG 或 JSON 角色卡，覆盖写入当前文件夹，生成角色描述、开场与世界书 Markdown
- **Mobile 工作区多选移动**：长按进入批量栏，可多选后移动到目标目录
- **工作区内容去重存储**：会话文件正文按内容共享并压缩，复制 / 分叉不再整份拷贝；升级后首次启动会迁移历史数据，可能较慢，之后即恢复正常

### 变更

- **手改操作日志**：手改以按次操作为准；支持同目录改名与跨目录移动；回滚 / Undo Send 后清空未发送手改 chip（正文与批注仍按既有规则恢复）
- **消息回滚更快**：同内容减少无用写盘，回滚路径更轻

### 修复

- **会话清理更干净**：删会话、模板拉取与失败补偿后，更及时回收不可达的历史正文，减少残留

## [1.4.06] - 2026-07-25

### 新增

- **Markdown 预览批注（Recogito）**：Desktop / Mobile 工作区 MD 预览用 `@recogito/text-annotator` 划词高亮与重投影；草稿保存渲染坐标，再次打开可回显
- **常驻工作区助手确认语**：智能体表单可为开启的工作区块配置确认文案，写入提示时按配置展示

### 变更

- **文本预览禁用批注**：plain / 文本 Tab 不再提供添加批注入口，也不投影既有高亮（仅 Markdown）
- **Desktop 显式添加批注**：划词后出现浮动条，点「添加批注」才打开表单；普通复制不再弹批注窗
- **Mobile 原生选区菜单**：MD 预览划词提供「复制 / 批注」；选「批注」后再写入草稿
- **Mobile 消息菜单入气泡**：⋯ 与「用户 / 助手」角色标签同在气泡顶行（对齐 Desktop）
- **项目抽屉菜单文案**：「智能体配置」更名为「智能体」

### 修复

- **批注不再破坏 Markdown 标题**：预览不再往源串插锚，避免标题变成裸 `#` 等渲染失败
- **代码块 soft-wrap**：聊天与文档预览代码块折行后不再用内层横向滚动抢竖滑
- **Mobile `npm run android`**：默认重新自动启动 Metro；端口占用时用 `android:no-packager`

## [1.4.05] - 2026-07-23

### 新增

- **批注跨节点下划线（Desktop / Mobile）**：工作区文件预览中，跨加粗 / 链接等行内节点的选区也能尽力匹配并显示下划线（块边界、换行、表单元格仍切断）
- **Mobile 消息菜单外置**：用户 / 助手消息的 ⋯ 移到气泡上方工具行，不再依赖长按主路径

### 变更

- **Composer 状态 chip 收口**：状态条只保留手改与批注；规则保存后立刻刷新常驻快照，不再出现「规则:路径」chip，也不能仅凭规则变更空发
- **新建目录 chip 文案**：`mkdir` 与建文件统一显示为「创建」（不再用「建目」）
- **Undo Send**：盘回滚到发送前；本轮手改 chip 作废；工作区文件批注仍可从该消息附件恢复
- **置位 / 压缩后状态条**：仅清规则快照与文件缓存，手改 / 批注 chip 保留（与「规则已即时进常驻」一致）
- **去掉消息正文划词批注**：对话气泡内划词仅复制；工作区文件预览批注不变

### 修复

- **Mobile 多文件批注下划线**：预览 path / 会话切换时批注标记与草稿同步，避免只标首文件或滞后空标
- **Mobile `@路径` 引用**：短暂受控选区与更清晰的选中样式，减少 tag 被拆成普通文本
- **Desktop Undo**：与 Mobile 对齐，可从附件反投影工作区批注草稿与 chip

## [1.4.04] - 2026-07-22

### 新增

- **会话分叉 / 复制更稳**：fork 与 session 复制共用合同——挂上分叉时刻的当前工作区快照，并复制会话级工作区规则（inclusion / 目录排序）；非首条回滚不再因空基线误删文件
- **Token 占用单引擎**：聊天展示与压缩共用 `resolveCurrentPromptTokens`；有可用 API `promptTokens` 时优先采用，否则回退本地计数；Desktop 页脚在回合结束 / 消息变化 / Agent·模型设置变更后刷新
- **目录级 ZIP**：导入/导出可针对指定子树（非整域）；CLI 增加 `--path`（默认 `/`）；Desktop 目录/空白右键导出，Mobile「更多」导入 ZIP、目录项导出 ZIP
- **Desktop 工作区拖拽三向**：从本机拖入导入、拖出到本机导出、树内拖动移动；冲突覆盖前确认
- **Mobile 单文件导入/导出**：当前目录「文件导入」、文件项「导出」；目录整包仍走 ZIP（平台多文件另存/多选不稳定，批量 IO 留后续迭代）

### 修复

- **Mobile 文件导出扩展名**：另存以原文件名后缀为准（`xxx.md` / `xxx.yyy`）；用 `application/octet-stream`，避免 `text/plain` 被 SAF 改成 `xxx.md.txt`
- **Mobile / Desktop 大备份导入闪退**：约百兆 `.nmbackup` 不再整包读入 JS 再 base64 写回，改为路径级拷贝，避免 OOM
- **Desktop Windows 拖出导出崩溃**：拖出图标禁止空 `nativeImage`，改用应用图标 / PNG 兜底，避免主进程硬崩
- **Desktop 拖出导出体验**：物化/startDrag 失败改为 toast；prefetch 未完成时提示「导出准备中」；拖出结束后清理 staging，避免临时目录泄漏
- **Desktop 空白区树内移动**：空白处可接收树内 MIME 拖放并移动到根目录
- **Mobile 文件导入**：读文件失败不再假报「导入完成」；失败摘要使用真实错误文案
- **批量写入类型冲突**：同路径 file/dir 冲突在规划阶段检出，避免错误写入
- **Desktop Token 页脚**：在设置中切换模型/Agent 后占用数字同步刷新

### 维护

- Core / Desktop / Mobile 补齐分叉、Token 缓存、ZIP 子树、批量 IO 等相关自动化测试；CR fix-spec 与业务文档对齐 Mobile 单文件收窄

## [1.4.03] - 2026-07-21

### 新增

- **Mobile 文件编辑器**：会话内 FileEditor 改为 WebView + CodeMirror；编辑聚焦双态更稳（语法高亮、大文件编辑体验贴近 Desktop）
- **提示词宏编辑（Desktop / Mobile）**：动态区宏着色、原子删除；Desktop `PromptMacroTextarea` 叠层宏 Tag，编辑观感与 Mobile 对齐

### 变更

- **「工作树」→「工作区」收口**：产品文案、CLI 子命令、IPC 与库表统一为 `workplace`；旧库自动 rename migration；示例与旧宏提示去掉「工作树」措辞
- **Agent 升级提示**：旧版配置中的 `type:worktree` 提示块升级后不再自动开启「常驻工作区」；若仍需该能力，请在 Agent 设置中手动打开「常驻工作区」开关
- **常驻工作区开关**：Agent 编辑器「常驻工作区」与 `input.workplace` 全量接线（双端顶卡共用）

### 修复

- **关闭常驻工作区**：不再 materialize 差集、也不再露出对应状态 chip，避免「开关已关仍像在用常驻区」
- **未配置 Agent 时仍可改工作区规则**：状态条投影在无 Agent 时按「常驻关闭」处理，不再把规则保存打成失败
- **Desktop Composer**：正文在 append 成功后再清空，避免发送失败却已清空输入
- **Desktop 批注**：切会话后仍按 `sessionId` 清空批注草稿，避免串会话残留
- **CLI**：session workplace 展示与 Agent 常驻前缀同源 assemble，避免 CLI 与 App 口径不一致
- 若干 workplace 校验文案、chip 回滚判定、Mobile 构建等小项

### 维护

- Composer / 批注 / `@路径` / chip 判定等纯逻辑单点进 core，Desktop renderer 经 `@shared` 再导出并加 eslint 门禁；Mobile CT `ui` 禁新组件直读 `state`；用户无感

## [1.4.02] - 2026-07-20

### 修复

- **Android 聊天页 Error loading page / net::ERR_FILE_NOT_FOUND**：发版 CI 在 `assembleRelease` 前补跑 `build:webview:native`，将 WebView 壳打入 APK；Gradle `preBuild` 缺 `assets/webview/**` 时硬失败，避免再打出坏包

## [1.4.01] - 2026-07-20

### 新增

- **阅读态批注（Desktop / Mobile）**：在聊天会话工作区打开文件预览时，可选中文字添加批注；原文下划线标记；点击可查看 / 编辑 / 删除；Composer 状态条显示 `批注:路径`；发送成功后清空本轮批注；仅有批注也可发送
- **常驻工作区 + 消息附件模型**：常驻上下文改为会话级持久（重启不丢）；本轮增量（规则变更、手改、`@` 引用等）走消息附件，与常驻前缀分离
- **Composer 大输入区**：双端统一大输入框与工具栏；状态 chip（规则 / 手改 / 批注等）中文二字口径；正文内 `@路径` 引用与选择器（含多选、目录树）
- **空正文也可发送**：仅有状态增量或附件时即可发送；列表展示附件摘要卡
- **Mobile 对话沉浸**：进入对话后隐藏底部「对话 / 我的」Tab；回到会话列表后恢复

### 改进

- **提示词协议统一**：消息增量统一为 `user-ops` 风格的结构化 action（模型侧更清晰）；状态 chip 与气泡文案对齐中文 `动作:路径`
- **去掉工作树 capture / 历史 UA 折卡**：不再依赖进程内快照与独立 UA 工具卡片；手改与附件并入正常对话流
- **Mobile WebView 基建**：对话 transcript / 富文档预览改为独立打包与更稳的渲染壳（流式、菜单、富文本）
- **助手伪标签可见**：富文本开启时，未知 / 伪 XML 标签不再静默挖空正文（双端观感更一致）
- **文件引用选择器**：支持层级浏览、多选文件/目录、显示隐藏文件；目录附件以树形摘要呈现

### 修复

- 批注相关：同文多条可点选改删、Desktop 预览保留系统复制菜单、门闩校验会话等
- 发送 / 续跑边界：空续跑、workplace 差集与附件合并等边界行为更可预期
- Mac Dock 图标边距等小项

### 维护

- 大量内部重构与测试加固（WebView Preact、发送链路收束、废弃别名清理等）；用户无感或已含于上文

## [1.3.14] - 2026-07-14

### 修复

- **对话停止后保留已生成内容**：停止 Agent 对话时，已输出的文本/thinking 会保留在会话中，不再整条撤回
- **未完成工具显示「失败」**：停止后尚未完成的工具调用标记为失败；已完成的工具仍显示成功
- **停止后冻结 UI**：停止后迟到的 STEP / tool_results 不再刷新界面，避免工具卡片状态被覆盖

### 改进

- Desktop / Mobile 停止流程的异步收尾更稳健，避免 retain 窗口内 lifecycle 卡死
- **内置文件工具说明更清晰**：`read` / `write` / `edit` / `fs` / `glob` / `grep` 的参数与用法描述更完整，便于 Agent 正确选用
- **`grep` 搜索能力增强**：支持字面量/正则模式、路径 glob 过滤、大小写不敏感、上下文行、每文件单条命中等选项
- **移除 `chat_grep` 内置工具**：Agent 配置与内置工具列表统一为上述 6 个文件工具；旧配置中若仍填写 `chat_grep` 将视为未知工具

## [1.3.13] - 2026-07-12

### 维护

- 版本号对齐与常规维护
