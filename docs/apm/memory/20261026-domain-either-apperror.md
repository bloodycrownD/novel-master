---
date: 2026-10-26
title: domain Either/AppError 迁移后的第二轮收口：feature flag 类化、真实缺口修复与边界保留
keywords: domain, Either, AppError, ErrorCodes, feature-flags, UserVfsUnifiedToolTurnFlag, ToolError, VFS
abstract: 动态工作流完成 domain 15 个分区的 Result/AppError 迁移后，本轮修复最终复核的高/中风险缺口并把用户指出的 user-vfs-unified-tool-turn 进程快照收成类单例；工具 runner 的 ToolError 与 legacy VfsError/ProviderError 仍保留在边界，style 仅 signatures 清零。
---

user:
继续修吧，另外（user-vfs-unified-tool-turn 的快照 + 三个自由函数）这种应该包装成类吧，现在这种零散暴露不合适吧

assistant:
确认用户的判断：`preferenceSnapshot` 是进程级可变状态，`refresh` / `resetForTests` / `isEnabled` 三个自由函数只是围绕它的读写入口，属于「共享状态 + 生命周期」的类候选，不是三个独立工具函数。

已改为 `UserVfsUnifiedToolTurnFlag` private class + `userVfsUnifiedToolTurnFlag` 单例：
- `private snapshot: boolean | undefined`
- `refresh(enabled)` / `resetForTests()` / `isEnabled(configured?)`
- 公共 barrel 只导出默认常量与单例；allowlist 快照同步
- CLI desktop mobile core 的 runtime、UI、测试与 mobile core-shim 全部迁到 `userVfsUnifiedToolTurnFlag.*`
- `resetForTests` 标 `nm-style: keep-public`，测试通过公开方法重置快照

同时修最终复核列出的真实缺口：
1. `validateAgentToolPolicy` 对 `allow/deny` 先做 `Array.isArray` 与元素 `typeof string` 校验，坏形状返回 `AGENT_INVALID_TOOL_POLICY` 而非 TypeError。
2. `ensureDirectoryChain` 改为返回 `Result<void, AppError<"VFS_NOT_A_DIRECTORY">>`，restore/revive 两个调用方透传 Err；`RestorePathError` 扩展该 key。
3. `expandDynamicMacros` 改为返回 `Result<string, AppError<"PROMPT_INVALID_MACRO">>`，在函数内 catch infra 的旧 `PromptError`；service/prompt assembler 在边界解包。
4. `sqlite-message.repository.rowToMessage` 把 `content_json` 与 `raw_json` 的损坏行统一抛 `CHAT_MESSAGE_CORRUPT`，不再误报 `CHAT_INVALID_ARGUMENT` 或裸 `SyntaxError`。
5. `formatToolErrorCause` 接受 `AppError`，VFS 域 key 继续走 `formatVfsErrorForLlm`，避免 mv/cp 的分类文案退化。
6. 三个 generic invariant `Error` 改为 `PROMPT_INVARIANT_VIOLATION` / `PROVIDER_INVARIANT_VIOLATION` / `VFS_INVARIANT_VIOLATION`；`MutatingPathRestoreCompositeError` 改为 `AppError<"VFS_RESTORE_FAILED">` 子类，保留多 cause。

边界保留：`ToolError`（26 处，工具 runner 协议与 apps/mobile 格式化强绑定）、legacy `VfsError`（2 处，revision 端口契约）、`ProviderError`（1 处，provider repository 读校验）未在本轮强改；直接替换会改公共错误契约与大量 app/test 分支，留待端口 phase 2。

验证：core typecheck/build；desktop/mobile/cli typecheck；core 全量 3299 例通过（排除两条既有 usage-stats DST / session-copy 基线）；package exports 21/21；mobile file-editor 12/12；desktop format-ipc-error 6/6。domain style `check-signatures=0`，`check-inline=80`、`check-methods=102`（54 条 AMBIGUOUS 端口 CRUD 基线，剩余为 tool formatter 既有 inline 项）。改动未提交。

---

user:
低风险的先清理吧，其他的慢慢处理

assistant:
按上一轮给出的低风险清单，把 7 个旧错误类从 errors/ 里清掉：AgentConfigError、ChatError、CompactionConditionsError、PreferencesError、KkvError、SkillError、SmartSortRuleError。

- agent-config-errors.ts / smart-sort-rule-errors.ts 直接删除。
- 其余 5 个文件改成纯工厂，只返回 AppError，不再导出 class / 旧 XxxErrorCode。
- 新增错误码：AGENT 101005-101009、CHAT 106003-106004、SKILL 107001-107009、COMPACTION 108001-108002、SMART_SORT 108502-108504、PREFERENCES 109500、KKV 115001-115002。
- core 服务、domain 工具、CLI/desktop/mobile 的 instanceof 与 error.code 分支全部改成 isAppError(error, "KEY")；public barrels、main-entry snapshot、public subpath snapshots、mobile core-shim 同步。
- errors/ 从 17 个文件降到 15 个，旧错误类从 14 个降到 7 个（剩 ConfigDecode / Prompt / Provider / SessionFs / Tool / Vfs / VfsZip，按计划留到后续批次）。

验证：core typecheck/build 通过；core 全量 3299 例通过（排除既有 usage-stats DST 与 session-copy 基线；checkpoint 性能例在并发类型检查时偶发超时，单跑通过）；desktop/mobile/cli typecheck 通过；desktop 受影响 42 例、mobile 受影响 56 例全绿；package-exports 21/21（含 kkv dist 解析守卫）。改动未提交。
