# D2-chat-message：chat / message-checkpoint 切片

## 元信息

- 模块：`domain/chat` + `domain/message-checkpoint` + `service/chat` + `service/message-checkpoint`（外加 `public/chat.ts`、`public/message-checkpoint.ts`、`public/session-fs.ts` 三条 barrel 出口）
- 文件范围：domain/chat 65 文件 / 6 797 行；domain/message-checkpoint 13 文件 / 1 207 行；service/chat 14 文件 / 1 672 行；service/message-checkpoint 6 文件 / 550 行——合计约 **10 226 行 / ~100 文件**，是双巨头切片
- 相关 Iterations：`message-rollback-execution-redesign`、`message-set-floor`、`message-rollback-remove-session-log`（已被 v2 + execution-redesign 架空，spec 描述的 `session_execute_*` 表全不存在）、`message-checkpoint-v2`、`message-attachment-unified`、`rollback-failure-degraded-fallback`、`rollback-import-baseline-checkpoint`、`rollback-mkdir-idempotent`、`rollback-revision-head-backfill`、`chat-rollback-vfs-tool-fixes`、`message-visibility`、`token-counting`、`model-aware-token-counting`、`agent-resilience-mobile-yaml`、`message-delete-worktree-narrow-refresh`、`message-worktree-refresh-tighten`、`chat-user-rollback-redo`、`user-ops-operation-log`、`stream-display-rewrite` 等
- lens 命中：L1✓ L2✓ L3✓ L4✓ L5✓ L6✓（含一条**已被代码证伪**的命中，见交叉发现 1）L7✓（含一条**已被代码证伪**的命中，见交叉发现 2）L8✓ L9- L10- L11-
- 轮次：第 1 轮

## 模块画像（叙述式）

诶～这个切片是整个仓库的「数据流心脏」啦。`domain/chat` 是消息正文与可见性的真源——`chat_message` 表存所有角色（user / assistant / user_vfs_turn / system）的 content_json，再叠一层 `hidden INTEGER` 软可见性列；`chat_session` / `chat_project` 是会话与项目的归属容器；`agent_config_json` 这种 blob 列特意不挂到 TypeScript model 上，走 `getSessionAgentConfig` / `setSessionAgentConfig` 单独方法存取，是 chat 一以贯之的「JSON blob 单走方法」模式。

`domain/message-checkpoint` 紧贴 chat 但完全独立成 context：`message_checkpoint`（一个 (session_id, message_id) 行）+ `message_checkpoint_file`（entry_id 化后的复合主键 `(session_id, message_id, entry_id)`，指向 `vfs_entry.entry_id` 的某一 `revision_version`）。这个 entry_id 化的设计很聪明——文件 rename 后历史 checkpoint 仍然命中同一个 entry，`loadFileTree` 经 JOIN 拿当前 path，所以 tree 自动跟随当前路径走，跟 revision 指针语义自洽。两个 context 加 `vfs_revision.ref_count` 一起构成回滚的三角关系：每多一条 checkpoint_file 行就给对应 revision +1，truncate / delete checkpoint 时再 −1，`ref_count <= 0` 的 revision 在前缀打扫时清掉。这套计数器没有挂 FK，靠应用层 + `repairRefCountFloor` 兜底维护，是 spec 明确写过的设计选择。

`service/chat` 把消息 CRUD、`MessageTranscriptEffects`（hide/show/truncate/set-floor）、user-vfs-turn、composer/at-path/annotate 等大量 logic 全包了，并通过 `src/public/chat.ts`（377 行）做扁平 re-export——这块出口宽度由 L3/L8 单独标过。`service/message-checkpoint` 很薄，只有 `capture`（事务内 listSessionFileHeads + insertCheckpoint）和 `rollbackToMessage`（事务外 `resolveRollbackPlan` + 事务内 reconcile + truncateTail）。回滚的对外门面走 `service/session-fs/impl/session-fs.service.ts` 这个壳，被三端各自包一层后投给 UI。

数据流主线是这样的：用户/agent 产生一条消息 → `messages.append` 落 `chat_message` → 如果带 mutating tool / user_ops，`messageCheckpoint.capture` 在事务里 listSessionFileHeads + insertCheckpoint（同时给 vfs_revision.ref_count +1）→ 后续 LLM 轮次读到的是 `hidden=0` 的子集 → 用户点 rewind/undo_send → `sessionFs.rollbackToMessage` → `resolveRollbackPlan`（事务外多次 await 读）→ `conn.transaction` 内 reconcileVfsPaths（restore/delete vfs 文件到 target tree）+ truncateTail（删 tail 消息 + 删 checkpoint_file 行 + ref_count −1 + 前缀打扫 revision）。`setMessageFloorAtMessage` 是另一条独立路径：不删消息、不动 vfs、不动 checkpoint，只改 `hidden` 列 + 清两个 session_kkv 域。

## 功能正确性核对

诶～这一段是切片的硬规矩，把代码和最关键的几个 Iteration spec 逐条对了一遍。

### A1 `setMessageFloorAtMessage` 实现超出 `message-set-floor` spec 的 Core API 契约

- spec 来源：`Iterations/message-set-floor/spec.md` §总体方案 / §Core API（L22-110）
- spec 写的 Core API：`setMessageFloorAtMessage` 只做 hide 前缀 + show 后缀；明确注释「**不**在 Core 内 markDirty/capture（T-WEC3/T-WEC4 由应用层负责）」；签名注释直接是「hide 前缀 + show 后缀；不 truncate」。
- 实际代码：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:78-130` 除了 hideRange/showRange 之外，**额外**做了 `sessionKkv.clearDomain(RULE_SNAPSHOT)` + `sessionKkv.clearDomain(FILE_CACHE)` + `sessionApiPromptTokenCache.invalidate(sessionId)` 三件事。
- 性质：范围蔓延。当前 mobile/desktop 的注释「clear rule_snapshot + file_cache 由 Core setMessageFloorAtMessage 完成」（`apps/desktop/src/main/ipc/handlers/messages.ts:307`、`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts:574`）证明这是协调过的设计演进，但 spec 没同步更新。这不是功能 bug，是契约漂移；叠加 L4 标记的「四步写无事务」，影响放大——见交叉发现 3。

### A2 `message-rollback-remove-session-log` spec 已被代码整体架空

- spec 来源：`Iterations/message-rollback-remove-session-log/spec.md` 全文
- spec 描述的是 `session_execute_batch` + `session_execute_checkpoint` + `session_vfs_snapshot` 这套旧表结构上的 rollback 流程（spec §现状与约束、§总体方案）。
- 实际代码：`bootstrap/session-fs/session-fs-schema.ts` 是空数组（注释「legacy tables removed in message-checkpoint v2」，L1 已确认）；现网回滚走 `service/message-checkpoint/impl/message-rollback.service.ts` 的 `rollbackToMessage`，与该 spec 的 `rollbackBatchInTx` 完全不是一条路径。
- 性质：spec 已历史化。L11 也把这条 spec 标为「低风险、引用时不必降权」，但本切片要补一句——**这条 spec 不能作为回滚行为的功能基准**，任何拿它对照代码的 review 都会得出全盘错误的结论。功能基准应以 `message-rollback-execution-redesign` + `rollback-import-baseline-checkpoint` + `rollback-failure-degraded-fallback` + `rollback-revision-head-backfill` 四条 spec 为准。

### A3 `rollback-import-baseline-checkpoint` 的兜底已落地，但只覆盖导入路径

- spec 来源：`Iterations/rollback-import-baseline-checkpoint/spec.md` §undo_send 空基线兜底
- spec 要求：undo_send 在 prior 空时回退到 anchor 自身的 checkpoint，避免「删光工作区」。
- 实际代码：`message-rollback.service.ts:189-209` 完整实现了这条兜底——`targetTree.size === 0` 时回退到 `loadFileTree(sessionId, anchor.id)`，与 spec 完全一致。
- 但 spec §导入事务接线要求 backfill 在 character-card / vfs-zip-io 导入事务末尾调用，代码也确实只在两处调（grep `backfillBaselineCheckpoints` 在 `character-card-import.service.ts:142` 和 `vfs-zip-io.service.ts:205`）。**普通 agent 聊天路径完全不调 backfill**——这意味着「agent 写一条 user 消息 + capture 失败」产生的无 baseline 消息，在后续 undo_send 时只能靠「anchor 自身 checkpoint」兜底；如果 anchor 自身就是那条没 capture 上的消息，targetTree 仍为空 → 见交叉发现 4（S 级）。这条 spec 没承诺过普通聊天路径的 backfill，所以不算 spec 偏离，但是 spec 与 L4 的接缝处暴露了一个真正的安全洞。

### A4 `message-rollback-execution-redesign` 的 reconcile 筛选与代码一致

- spec §reconcile「需写盘」筛选（L87-97）：`pathsNeedWrite = target 中（live 缺失 OR live.hash ≠ target revision.hash OR target status=deleted 且 live 仍在）且 live.head_version ≠ target.version`；`pathsNeedDelete = live 在 target 外且 hasDirectTargetTree`。
- 代码：`message-rollback.service.ts:226-259`（resolveReconcilePathSets + tail pointer 补 pathsNeedDelete）+ `restore-path.ts` 的 `restorePathToRevision` 走 skipped_same_version / skipped_same_content_hash 短路；与 spec 对齐，无偏离。

### C1 `setMessageFloorAtMessage` 错误文案与实际语义不符

- 位置：`message-transcript-effects.service.ts:90`
- 现象：throw 的文案是 `set-floor anchor role must be user, got: ${anchor.role}`，但 `isSetFloorAnchorRole` 实际允许 `user | assistant`（spec §菜单契约也写明资格是 `role ∈ {user, assistant}`）。如果用户拿一条 assistant 走 set-floor，没问题；但如果出现别的 role，错误提示会说「必须是 user」，与真实条件不一致。轻微，记录。

## 交叉发现（核心产出）

### S1 undo_send 空 targetTree + 普通 chat 路径无 backfill = 删光会话文件

- 涉及角度：L4（错误处理 & 事务）+ L1（数据模型）+ L5（并发）
- 位置：
  - `packages/core/src/service/agent/logic/run-agent-turn.ts:283-307`（user append 与 capture 之间无事务）
  - `packages/core/src/service/agent/impl/agent-runner.ts:450-478`（capture 与 toolResults append 无事务；capture 失败直接 rethrow）
  - `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:189-209`（undo_send 空兜底）
  - `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts`（仅被 character-card / vfs-zip-io 调用）
- 矛盾点：L1 单看 message-checkpoint 数据模型是「设计干净、ref_count 维护正确」（健康度 B+）；L4 单看 rollback 自身的事务边界是「reconcile + truncate 全在单事务，rollback 自身的回滚可信」（健康度 A）；L5 单看 rollback 事务内写有 mutex 兜底。叠起来才发现——rollback 的兜底依赖「anchor 自身有 checkpoint」这条不变式，但**普通 chat 路径没有任何机制保证这条不变式**：
  1. `run-agent-turn` 入口 `messages.append('user')` 与 `messageCheckpoint.capture` 是两次独立提交（L4 A5 已标），capture 失败时 user 消息已落库且没有 baseline checkpoint；
  2. `agent-runner` 循环里 capture（line 457）和 toolResults append（line 478）也都独立提交，capture 失败 rethrow 后 assistant 消息已是孤儿（L4 A4 已标）；
  3. `rollbackToMessage` 走 undo_send 分支时，如果 `anchor` 就是那条没 baseline 的消息（典型场景：用户发了带 user_ops 的消息→capture 失败→用户立刻 undo_send 这条消息），`resolvePriorRollbackTargetTree` 拿不到 prior，`loadFileTree(anchor.id)` 也是 null → `targetTree` 保持 size=0 + `hasDirectTargetTree=true` → reconcileSets 把所有 live session 文件归入 `pathsNeedDelete` → **整棵会话工作区被删光**。
  4. `backfillBaselineCheckpoints`（`rollback-import-baseline-checkpoint` 的修复）只在导入路径触发，普通 chat 路径不调，所以这个洞一直没补上。
- 依据：`message-rollback.service.ts:208` 注释自承「undo_send 始终按 prior 基线 diff 当前工作区（空树 = 删光会话文件）」——这条注释把行为写明白了，但前提是「prior 或 anchor 自身必须有 checkpoint」，而这个前提在普通 chat 路径下不成立。L4 A5 也明确指出「这正是 `Iterations/rollback-import-baseline-checkpoint` 在导入路径上修过的同一个 bug，只是普通聊天路径还没修」。
- 建议：不改代码。整改方向二选一——(a) 把 `run-agent-turn` 入口的 `append(user) + capture` 与 `agent-runner` 循环里的 `append(assistant) + capture + append(toolResults)` 各自包进单事务（`messageCheckpoint.capture` 已支持 tx 内调用），让「有 user/assistant 消息就一定有 checkpoint」成为硬性不变式；(b) 退一步，在 `MessageRollbackService.rollbackToMessage` 的 undo_send 分支增加安全阀：当 `anchor` 自身无 checkpoint 且 prior 也为空时，**拒绝回滚**并抛 `ROLLBACK_NO_CHECKPOINT`（已存在的错误码），而不是 silently 把 targetTree 当空树删光。当前实现的危害是「失败的 capture」被「成功的 rollback」放大成数据丢失。

### S2 `setMessageFloorAtMessage` 四步写无事务 × spec 契约只定义了两步 × L7 测试断言只覆盖 happy path

- 涉及角度：L4（事务）+ L11（spec 漂移，A1）+ L7（测试）+ L5（并发触发）
- 位置：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:78-130`；测试 `packages/core/test/chat/message-transcript-effects.test.ts`
- 矛盾点：
  - L4 标记「四步写无事务（hideRange → showRange → clearDomain(RULE_SNAPSHOT) → clearDomain(FILE_CACHE) + tokenCache.invalidate）」——这个判定在代码层面**正确**。
  - 但 L7 报告（D1-07 §发现清单 §A）写「`setMessageFloorAtMessage` **完全无测试**」——这个判定**事实错误**：`test/chat/message-transcript-effects.test.ts:92-280` 有至少 5 个 it 块覆盖（T-CR5/T-SF1、T-SF4、T-WEC3、role 校验、错误路径），L7 漏读了。
  - 把这两条叠起来才发现真正的问题：测试**是有的**，但全部是 happy path（断言 hidden/shown 计数 + kkv 清空 + token cache 失效），**没有任何一条验证「第三步 clearDomain 抛错时前两步是否已经落库」**。L4 标的事务缺口在测试侧完全没有回归保护，所以即便后续把它改成事务版，也没有现成测试能证伪。
  - 与 A1 叠加：spec 只承诺了 hide/show 两步，clearDomain 和 tokenCache.invalidate 是后来加的「维持短提示规则正确性」的语义补丁——`AGENTS.md` 反复强调的「file_cache 与可见历史同步关系」正是靠这两步维护的。两步无事务崩在中间，下一次拼装 user_ops 附件会读到 stale rule_snapshot / stale file_cache，置位 floor 的语义就破了，比 spec 承诺的两步崩坏更严重。
  - L5 视角的补刀：事件 DAG 同层若挂两条 `hide-message` + `set-floor`（events-config 是用户可配置的，validateEventActionDag 只验拓扑不验资源冲突），两次 setMessageFloorAtMessage 的 hideRange/showRange 之间窗口会被另一边插入，事务缺失叠加并发触发才是完整问题。
- 依据：`message-transcript-effects.service.ts:62-76` 的 `truncateMessagesAfter` 用了 `conn.transaction`，说明这条 service 完全有事务能力，只是 `setMessageFloorAtMessage` 没用；`SessionKkvRepository` 也已经有 tx 构造路径（`truncate-tail-wiring.ts` 在用）。改造成本不高。
- 建议：不改代码。整改方向是分两步——(a) 把 `setMessageFloorAtMessage` 的 hideRange/showRange/clearDomain×2 改成事务版（仓储层加 `updateHiddenRangeInTx`，clearDomain 走绑定 tx 的 SessionKkvRepository），让 spec 注释里「置位成功」二字真的成为原子性约定；(b) 同时把 spec 同步更新成「Core 路径在事务内 hide/show + 清两个 kkv 域 + 失效 token cache」，消除 A1 的契约漂移。

### A1（交叉） D1-06 / L6 关于 rollback 跨端的命中已被代码证伪

- 涉及角度：L6（跨端一致性）+ L8（公共面）
- 位置：D1-06 §发现清单 B-4「`sessionFs.rollbackToMessage` 仅 mobile 有服务包装」
- 矛盾点：D1-06 当时判定「desktop 和 CLI 完全没暴露这个入口，功能仅 mobile 可见」，但 grep `rollbackToMessage` 在当前代码里：
  - `apps/cli/src/session/commands.ts:138` 实现了 `nm session rollback --message <id>` 子命令；
  - `apps/desktop/src/main/ipc/handlers/messages.ts:350` 实现了 `nm:sessions/rollback` IPC handler，还透传 `skipVfsReconcile` / `revisionHeadBackfill` 选项；
  - `apps/desktop/renderer/features/chat/ConversationPanel.tsx:489` 有 UI 层 `rollbackToMessage` 回调；
  - `apps/mobile/src/services/message-rollback.service.ts` 是薄壳，三端共用 core 的 `sessionFs.rollbackToMessage`。
- 性质：lens 漂移。说明 D1-06 写作时这三端入口还没合进来，或者 reviewer 漏扫了。这不是 chat-message 模块的问题，但**严重度评分要做减法**——「跨端功能不对齐」这条不算 chat-message 的债，三端在 `rollbackToMessage` 上是对齐的。给 phase3 的提示是：D1-06 §功能矩阵的「`sessionFs.rollbackToMessage` ❌ 未暴露 / ❌ 未暴露 / ✅ mobile」这一行需要主代理更正为三端 ✅。
- 注意：D1-06 其他发现（SKSP driver 三端不统一、tokenizer 公式分叉、vfs-zip 校验深度不同、TDBC batch 嵌套语义不一致）与 chat-message 无关，不在本切片范围。

### A2（交叉） D1-07 / L7 关于 `setMessageFloorAtMessage` 无测试的命中已被代码证伪

- 涉及角度：L7（测试）
- 位置：D1-07 §发现清单 §A「`setMessageFloorAtMessage` 完全无测试」
- 矛盾点：见 S2 第二条。`packages/core/test/chat/message-transcript-effects.test.ts` 至少有 5 个 it 块覆盖此方法（T-CR5/T-SF1、T-SF4、T-WEC3、role 校验、system role 抛错）。L7 当时写的「`grep -r "setMessageFloorAtMessage" packages/core/test` 无命中」明显是搜索方式有问题——测试文件名是 `message-transcript-effects.test.ts`，方法名出现在 it 块的描述字符串与 `effects.setMessageFloorAtMessage(...)` 调用里，grep 应能命中。
- 性质：lens 漂移。L7 的真实缺口应当被收窄成「`setMessageFloorAtMessage` 缺中间步骤失败的回归测试」（即 S2 的第二条），而不是「完全无测试」。phase3 应当把这条与 S2 合并计分，严重度从 A 收敛到「A 但有 happy path 保护」。

### A3 `SessionFsError` 写入端从不传 cause，读取端却写了 `unwrapCause`——自相矛盾的错误体系

- 涉及角度：L4（错误处理）+ L7（可测性）
- 位置：
  - `packages/core/src/errors/session-fs-errors.ts:19-47`（`SessionFsError` 构造函数 `options` 不收 `cause`，`super(message)` 没传 `{ cause }`）
  - 同文件 `:49-58` `unwrapCause` + `:60-74` `isSessionFsError` 用 `unwrapCause` 去 dig cause 链
  - `service/message-checkpoint/impl/message-rollback.service.ts:76-86, 140-145`（`formatDegradableMessage` 把 cause 拍成字符串再 `sessionFsRollbackVfsRestoreFailed(message, ...)`，原始 VfsError 的 code、stack、cause 链全丢）
- 矛盾点：L4 单看是「rethrow 把 cause 拍成字符串」（已标 B），但叠加代码自身的设计才看出严重性——`isSessionFsError` 和 `isRollbackVfsDegradableError` 都用 `unwrapCause` 递归 dig cause 链（说明设计者**明确知道** cause 链有用），但写入端的 `SessionFsError` 构造函数连 `cause` 选项都没开孔，所有 `sessionFsRollbackVfsRestoreFailed(...)` 调用方都没法把原始 VfsError 串进去。结果是「读取端备好了 cause 链的 digger，写入端从源头就把链斩断」——这是典型的事后补救没补齐的痕迹，`rollback-failure-degraded-fallback` 设计「可降级」路径时只考虑了 `isRollbackVfsDegradableError` 的 code 判定（这个是工作的），忽略了诊断信息的链路完整。
- 依据：`isRollbackVfsDegradableError` 在 mobile / desktop UI 层用来决定是否弹「VFS restore 失败 → 提供仅截断的降级」，这个判定只看 code，确实够用；但用户上报 bug 时拿到的错误对象没有原始 VfsError 的 stack 和具体 code（NOT_FOUND？CONFLICT？AUTH_FAIL？），事后排查只能猜。
- 建议：不改代码。整改方向：(a) `SessionFsError` 构造函数加 `cause?: unknown` 并透传 `super(message, { cause })`；(b) `sessionFsRollbackVfsRestoreFailed` 增加 cause 参数；(c) rollback service 把 `formatDegradableMessage(cause)` 改成 `formatDegradableMessage(cause)` 当 message + 把原始 cause 透传进去。type guard 行为不变（`isSessionFsError` 仍走 unwrapCause），向后兼容。同一类问题 L4 §「多处 rethrow 用 `new XxxError(error.message)` 丢 cause 链」也标过，整改时一起做。

### B1 rollback 的「事务外读 plan」是 spec 明示的设计，但缺护栏

- 涉及角度：L5（并发）+ L11（spec 信任度）
- 位置：`message-rollback.service.ts:110-153`（`resolveRollbackPlan` 多次 await 读 → `conn.transaction` 写）；`Iterations/message-rollback-execution-redesign/spec.md:24-33`
- 矛盾点：L5 标记「`rollbackToMessage` 的 plan 解析阶段和事务执行阶段之间没有禁止并发写的护栏，agent-runner 可以在间隙写入」（A）。但读 `message-rollback-execution-redesign` spec §架构分层发现 spec 自己写明「**[事务外]** 解析锚点/mode；可选：一次查出『需写盘』路径列表；**[事务内]** ① 对需写盘路径走 restore ... ② truncate ... 」——也就是说，事务外读 plan 是**spec 明示的设计选择**，不是实现疏忽。
- 叠加 effect：spec 之所以这么设计，是怕长事务阻塞所有其他操作（L5 也确认 SQLite 单连接 + AsyncMutex 是全仓库串行保险丝）。但 spec 没有写「执行 rollback 期间 agent 必须停」这条护栏，agent runner 也没有任何机制感知 rollback 在跑。后果是：用户点 rewind 时如果 agent 还在跑，plan 拿到的是几秒前的快照，事务里 truncate 和 reconcile 按旧快照执行，agent 在间隙 append 的新消息 / capture 的新 checkpoint 会被 truncateTail 一并干掉（因为 `seq > anchor.seq`），用户视角是「我新发的那条没了」。
- 建议：不改代码。整改方向有两条路：(a) 在 `rollbackToMessage` 入口加一个 session 级「rollback 进行中」标志，agent-runner 在 append 前检查，发现冲突就抛 `ROLLBACK_IN_PROGRESS`；(b) 接受现状，但在 spec 里显式写明「rollback 与 agent run 互斥由调用方保证（UI 层 agentRunning 门禁）」——mobile/desktop 的 `agentRunning` 检查（`useChatTabMessages.ts`、`ConversationPanel.tsx`）已经是这条契约的应用层实现，把它下沉成文档化的硬性约束。

### B2 `insertCheckpoint` 的 N+1 在事务保护内，性能问题但不是数据正确性问题

- 涉及角度：L1（数据模型）+ L4（事务边界）
- 位置：`packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:116-130`
- 矛盾点：L1 标 A 的「逐文件 INSERT 是热路径 N+1」在切片里确认——但叠加 L4 视角发现，`insertCheckpoint` 本身**不**开事务（看代码 `await executeTemplate(...)` 连续多次），而是依赖上层 `messageCheckpoint.capture` 的 `conn.transaction` 包裹（`message-checkpoint.service.ts:34-57`）。也就是说，ref_count 的 `decrementRefsForCheckpointFiles → DELETE → INSERT → incrementRefsForCheckpointFiles` 序列在调用栈层面是原子的（被外层事务保护），但**只有在 `capture` 入口被调时才原子**。如果有任何路径绕过 `capture` 直接调 `insertCheckpoint`（比如未来的批量 backfill、cloud-sync 落库），就会出现 ref_count 半套状态。
- 依据：grep `insertCheckpoint` 在仓库内的调用点——`message-checkpoint.service.ts:48`（capture，事务内）、`backfill-baseline-checkpoints.ts:48`（导入事务内）、测试。当前所有调用方都在事务里，所以没有现成 bug，但 repo 层缺自保护是隐患。
- 建议：不改代码。L1 已给过 batching 改造建议（走 `conn.batch(sql, paramsList)`），切片补充——batching 改造同时要在 repo 层加一层「未在事务中则拒绝」的断言（类似 `runInTransactionOrConn` 的 NESTED_TRANSACTION 探测），避免后续被新调用方误用。

## 债务清单

| ID | 严重度 | 涉及角度 | 标题 | 位置 |
|----|--------|----------|------|------|
| D2-CM-S1 | S | L4+L1+L5 | undo_send 空 targetTree × 普通 chat 路径无 backfill = 删光会话文件 | `run-agent-turn.ts:283-307`、`agent-runner.ts:450-478`、`message-rollback.service.ts:189-209` |
| D2-CM-S2 | S | L4+L11+L7+L5 | setMessageFloorAtMessage 四步写无事务 × spec 只定义两步 × 测试只覆盖 happy path | `message-transcript-effects.service.ts:78-130`、`test/chat/message-transcript-effects.test.ts` |
| D2-CM-A1 | A | L4+L7 | SessionFsError 写入端从不传 cause，读取端却写了 unwrapCause | `errors/session-fs-errors.ts:19-58`、`message-rollback.service.ts:76-86,140-145` |
| D2-CM-A2 | A | L4+L11 | setMessageFloorAtMessage 实现超出 message-set-floor spec Core API 契约（A1，spec 漂移） | `message-transcript-effects.service.ts:118-127` |
| D2-CM-A3 | A | L1+L4 | insertCheckpoint 依赖外层事务保护 ref_count 一致性，repo 层无自保护 | `sqlite-message-checkpoint.repository.ts:73-141` |
| D2-CM-B1 | B | L5+L11 | rollback 事务外读 plan 是 spec 设计但缺护栏，agent 可在间隙写入 | `message-rollback.service.ts:110-153` |
| D2-CM-B2 | B | L1 | insertCheckpoint 逐文件 INSERT 是热路径 N+1（已在事务内，仅性能问题） | `sqlite-message-checkpoint.repository.ts:116-130` |
| D2-CM-C1 | C | L4 | setMessageFloorAtMessage 错误文案「must be user」与实际允许 user\|assistant 不符 | `message-transcript-effects.service.ts:90` |
| D2-CM-C2 | C | L11 | `message-rollback-remove-session-log` spec 已被代码整体架空，应标记为历史文档 | `Iterations/message-rollback-remove-session-log/spec.md` |
| D2-CM-X1 | lens 修正 | L6 | D1-06 B-4「rollbackToMessage 仅 mobile」已被代码证伪，三端均已实现 | D1-06 §发现清单 B-4 |
| D2-CM-X2 | lens 修正 | L7 | D1-07「setMessageFloorAtMessage 完全无测试」已被代码证伪，存在 5+ happy path 测试（但缺失败路径回归） | D1-07 §发现清单 §A |

## 与其他模块的耦合点

- **vfs（ vfs_entry / vfs_revision / ref_count）**：message-checkpoint 的 `message_checkpoint_file.entry_id → vfs_entry.entry_id` 是无 FK 的应用层关联，ref_count 跨 context 维护。任何 vfs 表结构 migration（特别是 `vfs-entry-id-redesign-v1` 已踩过的双计数器对齐）都要同步检查 message-checkpoint 的 insert/delete 序列。本切片的 D2-CM-A3 与 D2-vfs 切片在 ref_count 一致性上有交叉。
- **agent（agent-runner / run-agent-turn）**：S1 的根因一半在 agent 一侧（无事务的 append+capture+append 序列）。本切片只标了 chat-message 侧的兜底缺失（targetTree 空兜底），实际修复需要 D2-agent-tool 切片同时整改 agent-runner 的事务边界。
- **session-kkv（RULE_SNAPSHOT / FILE_CACHE / USER_VFS_PENDING）**：S2 的 clearDomain×2 与 AGENTS.md 反复强调的「file_cache 与可见历史同步关系」直接相关，session-kkv 的任何事务能力增强会直接驱动 S2 的修复方案。
- **prompt（normalize-for-llm-export.ts → chat/content、chat/model）**：L3 已确认这是唯一实质跨 context 引用，方向单向合理，但 ARCHITECTURE.md documented exceptions 没把它列进去。如果 prompt 切片要重写 LLM export 逻辑，这条引用是接缝点。
- **events（hide-message handler → MessageTranscriptEffects）**：setMessageFloorAtMessage / hideMessagesInRange 可被事件 DAG 触发，L5 标记的「同层 action 并行可能撞同一会话状态」与本切片 S2 的「事务缺失叠加并发触发」是同一问题的两面，phase3 应合并。
- **session-fs（service/session-fs/impl/session-fs.service.ts）**：是 message-rollback 的对外门面壳，本身 24 行无逻辑。L6 已确认 session-fs-schema 是空壳，但 session-fs service 还在做门面——context 名义与职责已脱钩，phase3 可考虑是否把 session-fs 并入 message-checkpoint 或保留为门面 context。
- **public/chat.ts（377 行）**：与 D2-prompt 切片共享（prompt 也消费 chat 的 content blocks 与 message 类型）；L8 已单独标过其公共面过宽含 `@deprecated` 注释残留（虽然真正的 `@deprecated` JSDoc 标记在 `public/agent.ts:17` 的 `resolveApplicationModelId` 系列上，chat.ts 自己只有一段说明「净 diff 模块已退出 public」的历史注释——L8 的描述略有偏移，但 B 级判定仍成立）。

## 覆盖声明

查了的：

- 全部 chat-message 相关 lens 命中（L1/L2/L3/L4/L5/L6/L7/L8/L9/L11）的原文，重点段落逐条对照代码核实。
- `service/chat/impl/message-transcript-effects.service.ts`、`service/message-checkpoint/impl/{message-checkpoint,message-rollback}.service.ts`、`domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts`、`errors/session-fs-errors.ts`、`public/{chat,message-checkpoint,session-fs}.ts` 全文。
- `Iterations/{message-set-floor,message-rollback-execution-redesign,message-rollback-remove-session-log,rollback-import-baseline-checkpoint}/` 的 spec.md 全文或关键段落。
- 三端入口（`apps/cli/src/session/commands.ts`、`apps/desktop/src/main/ipc/handlers/messages.ts`、`apps/mobile/src/services/message-rollback.service.ts`）的 rollback / set-floor 接线。
- `agent-runner.ts` / `run-agent-turn.ts` 中 append+capture 序列的具体行号与事务边界。
- `packages/core/test/chat/message-transcript-effects.test.ts` 的实际测试内容（核实 L7 命中是否成立）。

没查的（属其他切片或 lens 范围）：

- agent-runner 的流式 / abort / sub-agent 三处不一致（L5 主发现，归 D2-agent-tool）。
- vfs revision ref_count 的双计数器与 migration 窗口期（归 D2-vfs）。
- public/chat.ts 377 行的逐条 export 必要性审查（L8 主发现，本切片只引用结论）。
- mobile/desktop 的 IPC 协议字段稳定性（L8 主发现）。
- 三端 native driver（sksp / tokenizer / tdbc）的 parity（L6 主发现，与 chat-message 无关）。
- chat 的 composer-draft / annotate-source-range / user-ops-log 等 logic 子模块的内部正确性（这些是 public/chat.ts 暴露的 logic，本切片只看它们的对外契约，不看实现）。
