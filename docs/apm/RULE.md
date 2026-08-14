# 项目持久规则

## 术语定义

面向新加入项目的开发者/agent，解释 novel-master 专属名词。定义以 main 当前代码为准。

### 消息与提示词层

- **attach（会话附加内容）**：用户发消息时随消息落库的结构化附件（`chat_message.attachments_json`），提示词拼装时 hydrate 成 `<action name="userAttach">` 注入。可附文本文件（带行号全文）、目录（ASCII 树）、图片/二进制（只给文件名不喂正文）。逐消息、消息级。
- **extra info（附加信息 / customAttach）**：agent 配置里的一段自定义文本（`AgentDefinition.prompts.customAttach`），发提示词时经宏展开后以 `<extra-info>` 块注入**最新一条**非 hidden user 消息（历史不注入）。agent 级、同轮共享、只在拼装时不落库。宏展开值取回合快照（见下条）。
- **批注（annotate）**：用户在文件预览上划词选中原文并写意见，发送时转成 `source: "user_ops"` + `action: "annotate"` 附件（含 `path`、划词原文、用户意见、定位坐标）。批注草稿存进程内 draft store，不进 composer 草稿。
- **hidden 消息**：对 LLM 提示词渲染隐藏的标记——落库保留但不进提示词。只由两种操作产生：压缩和置位。
- **置位（set floor）**：用户显式选一条 user 消息当「地板」，隐藏它之前的全部前缀（锚点必须是 user 消息）。副作用：清空 `rule_snapshot` + `file_cache`，可见历史首次引用状态重置。
- **压缩（compaction）**：系统按 token 条件自动从尾部隐藏最旧一段消息。副作用同置位。
- **短提示（alreadyReferenced）**：去重机制——同一路径在可见历史第二次进提示词时不再拼全文，只落 `{ path, alreadyReferenced: true }` 短标记。判定按可见序共享 seen 集合（初值是常驻前缀 S0），置位/压缩后重置。
- **回合快照（macro turn snapshot）**：dynamic 区宏（`$time`/`$week_cn`/`$filetree`）与 customAttach 的展开时机语义——agent run 开始时取一次（时间戳 + 按需预取的 `$filetree`），回合内所有 step 复用同一份文本。目的：回合内每步请求是前一步的纯追加，提升 provider 前缀缓存命中。不丢信息：回合内变更只来自 agent 自己的工具调用，模型已从工具轮次得知；用户侧改动走 `user_vfs_pending` 下回合才生效。不改文本时零预取（沿用 `includes("$filetree")` 预检）。

### 工作区与存储层

- **常驻工作区（workplace）**：按会话级「规则快照 + 文件缓存」拼装、每轮提示词固定注入在消息前缀的文件树正文（`<workplace>` 块）。归属由 `workplaceScopeSessionId` 定义：主会话指向自身；子会话指向**父会话**（共享父工作区，规则评估按父）。KKV 归属由 `kkvScopeSessionId` 决定（恒等自身——子会话的快照/缓存存自己 KKV，内容从共享 VFS 读）。S0 指常驻前缀的 path 集合，作为短提示判定的初始 seen 集。前缀回合内天然冻结：`loadOrFillFileCache` 命中无条件返回（无 mtime 校验），agent 回合中写盘不会改变前缀；改写缓存的只有用户改规则（`refreshRuleSnapshot`）、压缩/置位、会话删除。另注：`workplace` 工厂每次调用 new 新服务实例，循环内反复获取会使 `liveViewInFlight` 并发去重跨 step 失效——agent-runner 已提升到循环外，新调用方勿再踩。
- **VFS**：项目的虚拟文件系统（逻辑路径树），agent 的 read/write/edit/fs/glob/grep 工具全在它上操作，写入走版本链配合 checkpoint 回滚。scope 分 global/project/session 三层。
- **KKV（session KKV）**：按 sessionId 路由的键值存储，只有三个域：`rule_snapshot`（工作区规则快照）、`file_cache`（展示正文缓存，性能优化）、`user_vfs_pending`（用户操作 FIFO 队列）。`file_cache` 不能当「前文是否引用过」的判断依据。

### 智能体与会话层

- **会话智能体（session agent）**：每个会话独立持有必填 `agentId`（引用 agent registry，不内联 definition），可选 `modelId` 覆盖 agent pin 的模型。`resolveAgentForProject` 现在永远走 session 分支。
- **项目智能体（已下线）**：曾经的项目级内联智能体定义（`chat_project.agent_config_json`），v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留。历史概念，新代码不要再依赖。
- **子会话（subagent session）**：主 agent 通过 `task` 工具派生子代理时创建的会话，消息历史独立落库，跑完以 tool_result 回流父会话。`parentSessionId` 非空；从空工作区开始（不拷贝模板/父快照）；递归上限 depth >= 2 禁用 task 工具。

## 协作红线

merge 到 main、push、发版等改变共享状态的操作，必须等用户明确指令才可执行，不得基于「合理的下一步」自行推进。记忆的 `user:` 字段只记用户实际表达过的原话或其摘要，禁止添加用户未表达的内容（尤其不得把 agent 自己的推断写成用户指令倒填进记忆）。

## 迭代结构约定

大迭代放 `docs/Iterations/<迭代名>/`，下面分 `features/<feature名>/` 子目录，每个 feature 有自己的 `prd.md` + `spec.md`。迭代总纲 PRD 在迭代根目录。

## 子会话工作区共享 + 规则快照隔离（Feature A 最终语义，2026-08-14 用户拍板推翻初版）

子会话**没有独立工作区**：子 agent 的全部 VFS 工具（read/write/edit/glob/grep）在**父 session 的 VFS scope** 上操作，写入直接出现在父工作区；嵌套时孙 agent 也指向根父会话。隔离的只有**规则快照**：`workplaceScopeSessionId` 对子 session 指向父（规则评估 + workplace 服务按父工作区），`kkvScopeSessionId` 恒等自身（rule_snapshot/file_cache 存子 session 自己的 KKV，`assembleWorkplaceDisplay` 的 `kkvSessionId` 参数路由）。UI：mobile 子会话文件卡片用路由传入的 `parentSessionId` 打开 FileEditor；desktop `workspaceSessionId` 恒等 `sessionId`。初版「从空产生独立工作区」语义已废弃，`initializeEmptySessionWorkspace` 已删（在 feature-d-bug-fixes 分支重做，待合并）。

## extra info 注入规则（Feature B 决策）

`customAttach`（extra info）只对最新一条非 hidden 的 user 输入消息注入 `<extra-info>` 块，历史消息不再注入。判定口径：`role === 'user' && isUserInputMessage(message) && !message.hidden` 的最后一条。hidden user 原样进 prepare 输出但不计入判定。

## 项目智能体已下线（Feature B 决策）

项目级内联智能体定义（follow/custom 模式）已移除。`resolveAgentForProject` 永远走 session 分支。`ProjectAgentConfig` 类型保留 `@deprecated`（与 DB 列保留策略一致，列置空但不 DROP，下一迭代可彻底清理）。双端锁定 UI 保留 `source !== 'session'` 判定覆盖 none 场景，toast 文案改成 none 口径（不引导去已删除的"项目智能体配置"入口）。

## edit 工具引号归一化（Feature D 决策）

`compute-replace-result.ts` 匹配层加引号归一化（`normalize-for-match.ts`），v1 只做 1:1 映射（弯引号→直引号、「」『』→直引号、全角空格→半角），省略号推迟 v2。**replaceAll 路径严禁用 split/join**（会悄悄改写未替换段引号），必须用归一化定位 + 原文切片拼接。

## 批注消息判定（Feature D 决策）

"只有批注、没文字"的 user 消息也算有效 user 消息。`hasAnnotateAttachment`（检查 `attachment.action === "annotate"`）作为 `isPlainUserText` 和 `isPlainUserUndoSendEligible` 的回退判定。mobile `applyComposerRestore` 的提前 return 条件拿掉 `restoreText == null`，写正文加 `restoreText != null` 守卫。

## worktree 并行开发

`.woktree/` 目录用于 git worktree 并行 feature 开发，已在 `.gitignore` 忽略。注意 worktree 的 node_modules 共享主仓，apps 级 typecheck/测试前需确认 core 解析落点或建本地 symlink。
