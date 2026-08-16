# 项目持久规则

## 术语定义

面向新加入项目的开发者/agent，解释 novel-master 专属名词。定义以 main 当前代码为准。每条附代码索引（主实现文件/目录），路径相对仓库根。

### 消息与提示词层

- **attach（会话附加内容）**：用户发消息时随消息落库的结构化附件（`chat_message.attachments_json`），提示词拼装时 hydrate 成 `<action name="userAttach">` 注入。可附文本文件（带行号全文）、目录（ASCII 树）、图片/二进制（只给文件名不喂正文）。逐消息、消息级。→ `packages/core/src/domain/chat/model/message-attachment.schema.ts`、`packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts`
- **extra info（附加信息 / customAttach）**：agent 配置里的一段自定义文本（`AgentDefinition.prompts.customAttach`），发提示词时经宏展开后以 `<extra-info>` 块注入**最新一条**非 hidden user 消息（历史不注入）。agent 级、同轮共享、只在拼装时不落库。宏展开值取回合快照（见下条）。→ `packages/core/src/domain/chat/logic/wrap-user-message-for-llm.ts`
- **批注（annotate）**：用户在文件预览上划词选中原文并写意见，发送时转成 `source: "user_ops"` + `action: "annotate"` 附件（含 `path`、划词原文、用户意见、定位坐标）。批注草稿存进程内 draft store，不进 composer 草稿。→ `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts`、mobile draft store：`apps/mobile/src/storage/chat-annotate-draft.ts`
- **user ops / 操作日志（已拆除）**：曾经的「用户文件操作记录」功能——发送消息时自动把 write/edit/mkdir 等操作以 `source: "user_ops"` 附件附上、UI 渲染成操作 chip。chat-fixes-2026-08 已整体拆除（store/flush 链路、偏好键、设置开关、清推全删）；批注是唯一保留的 user_ops 附件用途。遗留历史消息中的操作日志附件在展示层直接丢弃（过滤非 annotate 的 user_ops，原始数据不删）。新代码不要再读写操作日志链路。→ 拆除：`packages/core/src/service/chat/impl/user-vfs-turn.service.ts`（现状注释）、丢弃口径：`apps/mobile/src/components/chat/message-blocks.ts`
- **hidden 消息**：对 LLM 提示词渲染隐藏的标记——落库保留但不进提示词。只由两种操作产生：压缩和置位。隐藏消息同样支持回滚（回滚不改变可见性）。→ `packages/core/src/domain/chat/model/message.ts`（`hidden` 字段）、过滤逻辑：`packages/core/src/domain/agent/session/`
- **回滚（rollback）**：用户从某条消息发起回滚——截断该消息之后的尾部并恢复正文/批注草稿。对隐藏消息同样可用（无 `!hidden` 前置）；回滚**不改变**任何消息的可见性（`hidden` 标记原样保留，原来是什么样子回滚后还是什么样子）。→ 锚点：`packages/core/src/domain/message-checkpoint/logic/resolve-rollback-anchor.ts`、UI：`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`
- **置位（set floor）**：用户显式选一条 user 消息当「地板」，隐藏它之前的全部前缀（锚点必须是 user 消息）。副作用：清空 `rule_snapshot` + `file_cache`，可见历史首次引用状态重置。→ `packages/core/src/service/chat/impl/message-transcript-effects.service.ts`（`setMessageFloorAtMessage`）、`packages/core/src/domain/chat/logic/message-set-floor-range.ts`
- **压缩**：系统按 token 条件自动隐藏最旧一段可见消息。锚定口径（chat-fixes-2026-08 定稿）：`hideStartDepth`（默认 6，尾 depth 0=最新）只是启发式起点——从 slice 最新边界向更旧方向找第一条真用户输入（user 且不含 tool_result），只隐藏**严格更旧**干它的消息，锚点起的整轮（含 tool 往返）保留；压缩后可见历史必以 user 开头，保留条数 ≥ startDepth+1（可以超出启发式值，绝不拦腰切断轮次）。slice 内锚不出真用户输入（病态残留）时放弃本次压缩。副作用：清 `rule_snapshot` + `file_cache`。→ 执行：`packages/core/src/service/compaction-conditions/run-compaction.ts`、锚定：`packages/core/src/domain/depth/logic/resolve-hide-message-range.ts`
- **短提示（alreadyReferenced）**：去重机制——同一路径在可见历史第二次进提示词时不再拼全文，只落 `{ path, alreadyReferenced: true }` 短标记。判定按可见序共享 seen 集合（初值是常驻前缀 S0），置位/压缩后重置。→ `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts`
- **回合快照（macro turn snapshot）**：dynamic 区宏（`$time`/`$week_cn`/`$filetree`）与 customAttach 的展开时机语义——agent run 开始时取一次（时间戳 + 按需预取的 `$filetree`），回合内所有 step 复用同一份文本。目的：回合内每步请求是前一步的纯追加，提升 provider 前缀缓存命中。不丢信息：回合内变更只来自 agent 自己的工具调用，模型已从工具轮次得知；用户侧改动走 `user_vfs_pending` 下回合才生效。不改文本时零预取（沿用 `includes("$filetree")` 预检）。→ `packages/core/src/service/agent/impl/agent-runner.ts`（`resolveTurnFiletreeSnapshot`）、`packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts`

### 工作区与存储层

- **TDBC 驱动层**：core 与 SQLite 之间的连接协议抽象（`packages/core/src/infra/tdbc/`），实现按平台分包：desktop/cli 用 better-sqlite3，mobile 用 op-sqlite（`packages/tdbc-driver-op-sqlite/`，RN 原生入口走 exports `./native` 子路径）；quick-sqlite 旧驱动（`tdbc-driver-rn`）保留作回滚线——mobile 回滚仅需 `apps/mobile/src/db/connection.ts` 两行（`registerRnDriver` + `driver:'rn'`）加重装 APK。移动端换库根因：Android 12 及以下部分设备临时目录不可写，大事务触发 SQLite 写磁盘临时表报 disk I/O error，靠编译期 `SQLITE_TEMP_STORE=2` 把临时表固定在内存根治。事务内语句一律同步执行（防 async 并发使用同一连接的崩溃），事件循环让步按 16ms 时间量子而非逐语句。→ 协议：`packages/core/src/infra/tdbc/`、驱动包：`packages/tdbc-driver-*/`、移动端接入：`apps/mobile/src/db/connection.ts`
- **常驻工作区（workplace）**：按会话级「规则快照 + 文件缓存」拼装、每轮提示词固定注入在消息前缀的文件树正文（`<workplace>` 块）。归属由 `workplaceScopeSessionId` 定义：主会话指向自身；子会话指向**父会话**（共享父工作区，规则评估按父）。KKV 归属由 `kkvScopeSessionId` 决定（恒等自身——子会话的快照/缓存存自己 KKV，内容从共享 VFS 读）。S0 指常驻前缀的 path 集合，作为短提示判定的初始 seen 集。前缀回合内天然冻结：`loadOrFillFileCache` 命中无条件返回（无 mtime 校验），agent 回合中写盘不会改变前缀；改写缓存的只有用户改规则（`refreshRuleSnapshot`）、压缩/置位、会话删除。另注：`workplace` 工厂每次调用 new 新服务实例，循环内反复获取会使 `liveViewInFlight` 并发去重跨 step 失效——agent-runner 已提升到循环外，新调用方勿再踩。→ `packages/core/src/service/workplace/`（装配：`assemble-workplace-display.ts`，服务：`impl/workplace.service.ts`）
- **VFS**：项目的虚拟文件系统（逻辑路径树），agent 的 read/write/edit/fs/glob/grep 工具全在它上操作，写入走版本链配合 checkpoint 回滚。scope 分 global/project/session 三层。→ `packages/core/src/domain/vfs/`、工具：`packages/core/src/domain/tool/builtin/`
- **KKV（session KKV）**：按 sessionId 路由的键值存储。域：`rule_snapshot`（工作区规则快照）、`file_cache`（展示正文缓存，性能优化）、`user_vfs_pending`（历史域——user ops 拆除后已无写入方，仅剩 truncate 清旧域路径与域常量；`chat_session.user_vfs_pending_json` 列已由 migration 删除）。`file_cache` 不能当「前文是否引用过」的判断依据。→ `packages/core/src/domain/session-kkv/`（域定义：`model/session-kkv-domains.ts`）

### 智能体与会话层

- **会话智能体（session agent）**：每个会话独立持有必填 `agentId`（引用 agent registry，不内联 definition），可选 `modelId` 覆盖 agent pin 的模型。`resolveAgentForProject` 现在永远走 session 分支。→ `packages/core/src/domain/chat/model/session-agent-config.ts`、`packages/core/src/service/agent/logic/resolve-agent-for-project.ts`
- **项目智能体（已下线）**：曾经的项目级内联智能体定义（`chat_project.agent_config_json`），v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留。历史概念，新代码不要再依赖。→ 遗留类型：`packages/core/src/domain/chat/model/project-agent-config.ts`（`@deprecated`）
- **子会话（subagent session）**：主 agent 通过 `task` 工具派生子代理时创建的会话，消息历史独立落库，跑完以 tool_result 回流父会话。`parentSessionId` 非空；在共享父工作区干活（仅规则快照隔离）；递归上限 depth >= 2 禁用 task 工具。内置虚拟 `general` 子代理（`DEFAULT_SUBAGENT_DEFINITION`，registry list 注入、禁止同名 upsert）已开启 `prompts.workplace`（确记语 `i have seen workplace`），每轮注入 `<workplace>` 前缀。mobile 子会话路由参数携带 `parentSessionId`（嵌套时透传根父），文件卡片用它打开 FileEditor。→ 定义：`packages/core/src/service/agent/default-subagent-definition.ts`、创建：`packages/core/src/service/chat/impl/session.service.ts`（`createSubSession`）、装配：`packages/core/src/service/agent/logic/run-agent-turn.ts`（`runChildAgent`）、UI：`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`
- **vfsScope（ToolResultBlock）**：工具结果块上标记「该工具操作落在哪个 VFS scope」的字段。子 agent 的写入落父 session scope，故取 `session.workplaceScopeSessionId`（而非消息归属的子 session）——UI 按它打开文件才能对准共享工作区。与 run 事件的 `sessionId`（会话树语义，永远是子 session）是两个概念，勿混。→ `packages/core/src/service/agent/impl/agent-runner.ts`（构造 toolResults 处）
- **子会话写入刷新（desktop）**：子 agent 写入落父 scope 但 step/run 事件挂子 session 的 run，`useAgentStream` 守卫拒收——ShellNavProvider 旁路订阅 agent stream，见 `vfsMutated` 且 projectId 匹配即刷文件树（跳过本会话 run 避免双触发）。mobile 无此问题：工作区面板是切换式视图，每次切入全量 reload。→ `apps/desktop/renderer/providers/ShellNavProvider.tsx`、守卫：`apps/desktop/renderer/hooks/useAgentStream.ts`

## 协作红线

merge 到 main、push、发版等改变共享状态的操作，必须等用户明确指令才可执行，不得基于「合理的下一步」自行推进。记忆的 `user:` 字段只记用户实际表达过的原话或其摘要，禁止添加用户未表达的内容（尤其不得把 agent 自己的推断写成用户指令倒填进记忆）。git 提交前必须确认当前分支（`git branch --show-current`）——主仓可能有并行会话切走分支，看都不看就提交会把改动落到别人的分支上。

## 迭代结构约定

大迭代放 `docs/Iterations/<迭代名>/`，下面分 `features/<feature名>/` 子目录，每个 feature 有自己的 `prd.md` + `spec.md`。迭代总纲 PRD 在迭代根目录。

## 实现禁令与坑

- **edit 工具 replaceAll 路径严禁用 split/join**：会悄悄改写未被替换段的引号。必须用引号归一化定位 + 原文切片拼接（`packages/core/src/domain/vfs/logic/normalize-for-match.ts`）。
- **worktree 并行开发**：`.woktree/` 目录用于 git worktree 并行 feature 开发，已在 `.gitignore` 忽略。注意 worktree 的 node_modules 是**独立目录非主仓软链**，新 worktree 或大版本切换后须重跑 `npm install`；workspace 包解析报 `subpath not defined` 是 exports 设计使然非故障。
- **发版 bump 版本号后必须验证 package.json 可解析**：曾有版本行尾逗号丢失导致 JSON 语法错误，`npm ci` 报误导性「lock 不存在」，CI 三平台全挂。提交前跑 `node -e "require('./package.json')"` 逐个验证。
- **改 dist 消费的包必须重建 dist**：Metro/vite 解析的是 exports 指向的 `dist/` 产物（gitignore），src 改完不 `npm run build -w <pkg>`，本地 dev/reload 跑的还是旧代码——v1.4.28 会话复制性能验证曾因 op-sqlite 驱动 dist 停在旧版白测一轮。
- **release.yml Android job 构建清单须覆盖 mobile 全部 workspace 依赖**：dist 不进仓库，CI 逐包 `npm run build -w`；给 mobile 新增 workspace 依赖包时必须同步补清单，否则本地绿、发版 CI 炸（v1.4.28 曾漏 tdbc-driver-op-sqlite）。
