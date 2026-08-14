# 项目持久规则

## 协作红线

merge 到 main、push、发版等改变共享状态的操作，必须等用户明确指令才可执行，不得基于「合理的下一步」自行推进。记忆的 `user:` 字段只记用户实际表达过的原话或其摘要，禁止添加用户未表达的内容（尤其不得把 agent 自己的推断写成用户指令倒填进记忆）。

## 迭代结构约定

大迭代放 `docs/Iterations/<迭代名>/`，下面分 `features/<feature名>/` 子目录，每个 feature 有自己的 `prd.md` + `spec.md`。迭代总纲 PRD 在迭代根目录。

## 子会话工作区隔离（Feature A 决策）

子会话用自己 sessionId 从空产生常驻工作区（不拷贝项目模板、不拷贝父快照）。`createSubSession` 包事务调 `initializeEmptySessionWorkspace`（只清 VFS entry，不碰 KKV——子 session 新建时 KKV 天然无行即空）。`workplaceScopeSessionId` 对子 session 指向自身。desktop UI 用 `workspaceSessionId` 派生字段（ShellNavProvider 内 useState，不进持久化 nav state）。

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
