# D2a-L4：错误处理 & 事务跨模块模式识别

## 元信息

- 角度：L4 错误处理 & 事务
- 输入：D1-04（横扫） + 全部 6 份 D2 切片（vfs / chat-message / provider-llm / agent-tool / compaction / prompt）+ D0-1（代码地图）/ D0-2（文档索引）
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly，未改动任何代码
- 产出日期：2026-08-05

## 结论（叙述式）

诶～这一角度叠起来看，画面其实挺一致的，但比单模块切片里显得更让人头疼哦。

把 D1-04 的事务表和 6 份切片的 L4 命中叠在一起后，「无事务裸多步写」这条不是散落在四个模块的孤立小问题，而是**同一个架构缺陷的四个面相**——仓库里已经有 `runInTransactionOrConn` 这套抽象、且被 vfs / message-checkpoint / template / workplace 这些模块认真用着，证明事务纪律在「同一 SQLite 连接同一数据库内」是建立起来了的；可一旦写跨过这条边界——跨 secret store（provider）、跨 kkv 域（chat floor）、跨多步副作用但拆提交（agent-runner）——就立刻退回到「靠调用方记得原子」的状态。换句话说，**事务这个能力仓库里有，跨资源协调这个能力仓库里没有**。每个模块于是各自长出局部兜底：provider migration 里写过 `renameSkspSecrets` 的全表扫描、chat-message 里写过 `backfillBaselineCheckpoints` 的导入路径补 baseline、bootstrap 里写过 `repairRefCounts` 的启动修复——三套兜底长得几乎一样（都是「扫一遍、按模式归零」），但互相不认识，service 层也没复用。这是典型的「机制存在、抽象缺失」。

`rollback-*` 系列 5 个迭代（加上 `message-rollback-*` 两个、`chat-rollback-*` 两个，共 9 个）更像是在「优雅地处理上游 invariant 被破坏的后果」，而不是「修复被破坏的 invariant 本身」。`message-rollback-execution-redesign` 把 reconcile + truncate 全塞进单事务是治本方向的；但 `rollback-import-baseline-checkpoint`、`rollback-failure-degraded-fallback`、`rollback-mkdir-idempotent`、`rollback-revision-head-backfill` 这一串都是在下游给「上游 append + capture 没有事务保证」擦屁股——而且 D2-chat-message S1 已经证实，导入路径修过的 baseline 兜底**普通 chat 路径还没修**。这是逐步收敛吗？是。是治本吗？不是。每修一个孤儿入口，就要再来一个补丁覆盖下一个入口，因为产生孤儿的源头（agent-runner / run-agent-turn 的多步裸写）始终没动。

下面把识别到的模式列出来，最值得 phase3 优先裁决的是模式 1（跨资源多步写）和模式 3（rollback 系列的下游吞债），这两条都打到 S 级。

## 跨模块模式清单

### 模式 1：跨 store / 跨 context 的多步写完全没有事务保护

- 类型：同一反模式多处出现 + 模块间不一致（应该一致但不一致）
- 出现模块：provider / chat-message（floor 路径）/ agent-runner / bootstrap-vfs（repair 路径，但语义不同）
- 共同特征：四个模块都在「同一逻辑操作里改两处以上独立资源」，且**任意一处失败时前面的写都不会回滚**。形态各异：
  - provider：`secretStore.set/delete` + 三张 DB 表的写——跨 sksp 外部存储与 SQLite，删顺序还是「先小后大」（D2-provider-llm A1）
  - chat floor：`hideRange → showRange → clearDomain(RULE_SNAPSHOT) → clearDomain(FILE_CACHE)` 四步独立提交（D2-chat-message S2）
  - agent-runner / run-agent-turn：`append(assistant) → checkpoint.capture → append(toolResults)`、`append(user) → checkpoint.capture`——都是同一逻辑回合被拆成独立提交（D2-chat-message S1、D2-agent-tool B1）
  - bootstrap `repairRefCounts`：跨 await 的读改写 + 完全静默 catch（D2-vfs S1 升级吸收）
- 系统性根因（这是模式的核心）：**仓库缺少一个「跨资源写编排」的统一抽象**。证据有三条互相印证：
  1. `runInTransactionOrConn` 在 vfs / message-checkpoint / template / workplace 都被认真使用（事务纪律在单 conn 内是建立的），但**没有任何跨 conn / 跨 store 的等价抽象**；
  2. 三个模块**各自**长出了形态相近的兜底（provider 的 `renameSkspSecrets` 全表扫、chat 的 `backfillBaselineCheckpoints`、vfs 的 `repairRefCounts`），但 service 层都不复用、都不触发、都不互知——D2-provider-llm A1 已经指出 `renameSkspSecrets` 是仓库里唯一一份「全表扫 sksp ref」的参考实现，service delete 完全没往这个方向走；
  3. 模块间不一致本身是直接证据：同样是「多步写」，`session.delete` / `project.delete` / `template.projectTemplatePull` 都包了事务，`provider.delete` / `setMessageFloor` / `agent-runner.run` 就没包——这不是统一的设计决策，是各模块各自漏。
- 严重度：**S**（同一反模式在 4 个核心模块出现，根因是架构层缺失「跨资源协调器 + 统一启动对账」抽象）
- 建议方向（不改代码，只描述方向）：
  - 短期止血：每个模块分别把「能进同一 SQLite 事务的部分」先包进去（provider DB 三表、chat floor 的 hideRange/showRange + kkv clearDomain、agent-runner 单轮 append+capture+append）；secretStore 这种外部存储明确文档化为「DB 事务提交后 best-effort + 失败入孤儿队列」。
  - 中期统一：把 `renameSkspSecrets` / `backfillBaselineCheckpoints` / `repairRefCounts` 这三套近似兜底抽象成一个共用的 `StartupReconciliation` 框架（统一注册、统一调度、统一告警通道），让三个模块的兜底互相认识。
  - 长期方向：考虑 outbox/saga 模式管理跨 secretStore 的写——但仓库现在没这套基建，phase3 决定要不要引入。

### 模式 2：错误链路在写入端被斩断，读取端却备好了 digger

- 类型：模块间不一致（同一套错误体系内部矛盾）
- 出现模块：errors（17 个文件）/ message-rollback / vfs-zip-io / vfs-batch-io / character-card-import / run-agent-turn
- 共同特征：仓库的 errors 模块**自己写了** `unwrapCause` 去 dig cause 链（`isSessionFsError` / `isRollbackVfsDegradableError` 都用），说明设计者明确知道 cause 链有用；但**写入端**的所有 Error 构造函数都不收 `cause` 选项——`SessionFsError`、`VfsZipError`、`VfsError`、`CharacterCardError`、`AgentTurnError` 一律 `super(message)` 不传 `{ cause }`。所有 rethrow 处把上层错误拍成字符串再包：`new AgentTurnError(error.message)`、`sessionFsRollbackVfsRestoreFailed(formatDegradableMessage(cause))`、`vfsZipError("IMPORT_FAILED", msg)`……（D1-04 B、D2-vfs A2、D2-chat-message A3）。
- 系统性根因：`rollback-failure-degraded-fallback` 设计「可降级」路径时只考虑了 code 判定（`isRollbackVfsDegradableError` 看 code，确实工作），忽略了**诊断信息**也要随链路传下去。降级判断 ≠ 完整诊断，当时把这俩需求合并成了「只传 message」。后续所有新错误类型抄了这套写法，于是通病。
- 严重度：A（错误类型体系是公共面，三端 apps 拿到的对象不带原始 cause，事后排查只能猜；不是 S 因为不影响业务正确性，只影响可观测性）
- 建议方向：所有领域 Error 构造函数统一加 `options?: { cause?: unknown }` 透传给 `super(message, { cause })`（ES2022 标准、向后兼容）；所有 rethrow 处统一传 cause。这是一次集中整改，phase3 可以把它当独立 PR 推。type guard 行为完全不动。

### 模式 3：rollback-* 系列反复打补丁——「下游吞下上游的债」

- 类型：摇摆度交叉（D0-2 §1 message+rollback 13 迭代）+ 同一反模式
- 出现模块：message-checkpoint / message-rollback / agent-runner（产生孤儿的源头，没修过）
- 共同特征：把 5 个 `rollback-*` 迭代按「治本 vs 治标」分类：
  - 治本方向（1 个）：`message-rollback-execution-redesign`——把 reconcile + truncate 全塞进单事务，rollback 自身的回滚可信。这是事务边界本身的改进。
  - 治标兜底（4 个+）：
    - `rollback-import-baseline-checkpoint`：补 baseline checkpoint 兜底，**但只在导入路径触发**（D2-chat-message S1、D2-chat-message A3 都证实普通 chat 路径未修）；
    - `rollback-failure-degraded-fallback`：restore 失败时降级到仅截断，**但不解决 capture 阶段失败**（D1-04 A5 明示）；
    - `rollback-mkdir-idempotent` / `rollback-revision-head-backfill`：边界场景的幂等性修补；
    - `message-rollback-remove-session-log`：清旧路径（但 D2-chat-message A2 说 spec 已被代码整体架空，说明这次清的「清得不彻底」）。
- 系统性根因（关键判断）：**rollback 系列一直在为「上游 agent-runner 多步裸写产生的孤儿」打兜底，而不是把不变式上提到源头**。D1-04 A4+A5 已经定位了源头：`run-agent-turn` 入口的 `append(user) + capture` 无事务、`agent-runner` 循环里的 `append(assistant) + capture + append(toolResults)` 无事务。只要这个源头不动，下游就会持续产生「没有 checkpoint 的孤儿消息」，rollback 就要持续打补丁覆盖下一个入口。
- 是治标不治本，还是逐步收敛？**两者都是**。从「rollback 自身事务边界」看，是收敛的（执行重设计之后没再大改）；从「孤儿场景兜底」看，是治标不治本——`rollback-import-baseline-checkpoint` 修了导入路径，普通 chat 路径还没修；下一个迭代很可能还要再补一个 `rollback-chat-baseline-checkpoint`，然后 sub-agent 子 session 路径（D2-agent-tool A1）又是一个新入口。
- 严重度：**S**（高摇摆度 9 个迭代 + 根因明确指向源头不变式缺失 + 数据丢失危害：D2-chat-message S1 证实 undo_send 在普通 chat 路径会把整棵会话工作区删光）
- 建议方向（不改代码，只描述）：把「**每条 user/assistant 消息落库时一定有对应 baseline checkpoint**」提升为硬不变式，在 agent-runner / run-agent-turn 用事务保证（`messageCheckpoint.capture` 已支持 tx 内调用），然后**逐步退役**下游兜底（导入路径的 backfill 可以保留作为容错，但不再是「唯一保证」）。phase3 应当把这条作为事务整改的最高优先级——比模式 1 的其他子项更优先，因为危害是数据丢失而非孤儿配置。

### 模式 4：「成功的写 + 失败的告警」被默默吞掉

- 类型：同一反模式多处出现 + 摇摆度交叉
- 出现模块：bootstrap（`repairRefCounts().catch(() => {})`）+ user-vfs-turn（`logAppendError` 字段无消费方）+ model-retry-policy（`parsePolicyJson` 失败 `return null`）+ inferLlmProtocol（三处静默回落 `"anthropic"`）
- 共同特征：仓库「快速失败 + 局部吞掉」的文化本身不违法，问题在「吞掉之后没有任何可观测通道」。四处的形态：
  - bootstrap 那一行 catch 体**真空**，连 console.warn 都没有（D1-04 B、D2-vfs S1 升级吸收）；
  - `user-vfs-turn.executeOp` 的 `logAppendError` 写进返回值字段，但 agent-runner grep 不到任何消费这个字段的代码（D1-04 B）——盘写成功、日志失败、用户改了文件但 agent 看不到；
  - `parsePolicyJson` catch 直接 return null（D1-04 C）；
  - `inferLlmProtocolFromSavedModelId` 三处 fallback 默认 `"anthropic"`（D2-provider-llm A2），把「配置缺失」「DB 查询失败」「schema 不一致」全盖住。
- 系统性根因：仓库**没有统一的「告警通道」抽象**（没有 eventBus 上报告警的标准方式、没有结构化 warn 的约定）。每个开发者各自决定「要不要 log、log 多详细」，导致同一类「吞错」行为从「完全静默」到「字段塞返回值」到「静默回落」光谱很宽。`logAppendError` 那个尤其典型——设计者**知道**要传出去（塞了字段），但调用方不知道要消费，于是等同于没传。
- 严重度：A（不是 S，因为单点危害可控；但叠加模式 1 后会放大——比如 repair 静默失败 + provider 多步无事务 = 没人知道孤儿 key 累积了多少）
- 建议方向：phase3 决定要不要立一个统一的告警通道约定（`logger.warn`、eventBus `system.degraded` 事件、或者一个 `ReportDegraded` helper）。短期至少把「真空 catch」全改成 `console.warn`，把「字段塞返回值」改成显式 eventBus publish。

### 模式 5：cross-cutting invariant 没有架构占位（god module 视角的补刀）

- 类型：god module 的跨模块影响（间接）
- 出现模块：跨 chat-message / agent-tool / provider-llm
- 共同特征：模式 1 和模式 3 都指向同一个更深的架构缺口——仓库**没有「不变式守护者」这一层**。每条应当跨模块成立的硬不变式（「消息落库必有 checkpoint」「删 provider 必清 current*」「跨 secret store 写必有 best-effort 兜底」），都没有一个统一的 service 层占位去强制。结果每条不变式都靠「调用方记得做」或「下游打补丁兜底」维持。从 D0-1 god module 表看，`connection.port`（80 次）和 `vfs-path-mapper`（42 次）是真实热点，但**没有任何 god module 在管跨资源一致性**——一致性是「散养」的。
- 系统性根因：`service/` 层目前按 bounded context 切分（provider service / chat service / agent service），**没有 cross-context 的 lifecycle / consistency orchestrator**。`template-pull.service.ts` 是少数有 cross-context 协调能力的（vfs 替换 + worktree 复制 + 事务），但它没被抽象成模板。`restoreProviderTableSnapshot` 也是个 cross-cutting 操作的孤例。
- 严重度：B（god module 视角的可量化证据，但危害要通过模式 1/3 才爆发；这条主要是给 phase3 提供架构整改的入口思路）
- 建议方向：phase3 决定要不要立一个 `LifecycleService` / `ConsistencyCoordinator` 层，把 cross-cutting 的不变式（baseline checkpoint、current* 清理、orphan sweep）从各 app 层和各 service 收回来。短期不动，先在 ARCHITECTURE.md 把这几条硬不变式文档化，让维护者知道「这条不能靠调用方记得」。

## 覆盖声明

读了的：
- `docs/review/phase1-lens/D1-04-error-txn.md` 全文（横扫报告，事务/回滚完整路径表 + 11 条发现）；
- `docs/review/phase2-slice/D2-vfs.md` 全文（S1/S2/A1/A2 与 L4 相关，F1/F2 的「PRD 兑现度」与 L4 交叉）；
- `docs/review/phase2-slice/D2-chat-message.md` 全文（S1/S2/A3/B1/B2 都是 L4 主战场）；
- `docs/review/phase2-slice/D2-provider-llm.md` 全文（S1/A1/A2 是 L4 命中）；
- `docs/review/phase2-slice/D2-agent-tool.md` 全文（B1 + A1 的 events 链路无事务兜底）；
- `docs/review/phase2-slice/D2-compaction.md` 全文（与 L4 弱相关，主要是 tokenizer 计数路径，没新发现）；
- `docs/review/phase2-slice/D2-prompt.md` 全文（与 L4 几乎无关，只有 normalize 静默清空字段算是「吞错」边缘案例，未单列模式）；
- `docs/review/phase0/D0-1-code-map.md`（god module 表 + 持久化分布）；
- `docs/review/phase0/D0-2-docs-index.md` §1（Iterations 摇摆度）；
- `docs/Iterations/` 下的 `rollback-*` / `message-rollback-*` / `chat-rollback-*` / `message-checkpoint-v2` / `message-set-floor` 共 10 个迭代目录名（只确认存在性，没读 spec 内容——单模块切片已经引过关键段落）。

没读的：
- 没读实现代码（指导文档明确禁止 phase2.5 读源码，所有结论基于 D1+D2 报告二次分析）；
- 没读其他角度的 phase1-lens 报告（那是 phase3 的事）；
- `rollback-*` 各迭代的 spec.md / cr-fix-spec.md 全文没读，只引用 D2 切片已经引用过的关键段落——如果 phase3 要决定「哪条兜底可以退役」，需要回派读全文确认退役影响面。

为什么不读：phase2.5 的职责是「在自己角度内做跨模块叠加」，读源码和其他角度会稀释发现。

## 给 Phase 3 的线索

按优先级排：

1. **模式 3 vs L5（并发）**：agent-runner / run-agent-turn 的「append + capture 无事务」整改，L5 可能会说「abort 是用户取消、不是崩溃，不需要事务」——但 D2-chat-message S1 已经证实危害是「undo_send 把整棵工作区删光」，这不是崩溃 vs 取消的问题，是 capture 失败窗口的孤儿消息被 rollback 放大成数据丢失。L5 和 L4 在这条上的立场需要 phase3 显式仲裁，特别是 abort 后 partial assistant 是否要标 hidden（D1-04 B 的方案）。

2. **模式 1 vs L8（API 稳定性 & 安全）**：provider 跨 secretStore 无事务 → secret 残留是安全问题，L8 需要给 secret 残留定危害分级（D1-04 待交叉线索已经标过）。同时 D2-provider-llm A1 指出 `renameSkspSecrets` 是现成的扫描模式，整改方向明确，但需要 L8 确认「best-effort + 孤儿队列 + 启动扫一次」是否满足安全要求。

3. **模式 2 vs L7（测试）**：扩 Error 构造函数加 cause 可能破坏现有 fixture（type guard 行为不变但 Error 对象 shape 变了），L7 要评估改造面。

4. **模式 4 vs L6（跨端）**：「告警通道」三端都要一致消费，特别是 `logAppendError` 转 eventBus publish 后，mobile/webview 那条消费链路是否能跟上。这条 L6 必须参与。

5. **模式 1 的「中期统一」子项（StartupReconciliation 框架）vs L3（架构）**：把 `renameSkspSecrets` / `backfillBaselineCheckpoints` / `repairRefCounts` 抽象成共用框架是架构层改动，L3 角度来扫时要专门评估这条要不要立。

6. **`rollback-import-baseline-checkpoint` 的退役时机**：phase3 决定「上提不变式」整改完成前不能退役（导入路径仍是唯一保证）；整改完成后可以降级为容错。这条需要回派读 `rollback-import-baseline-checkpoint/spec.md` 全文 + `message-rollback-execution-redesign/cr-fix-spec.md` 全文确认。

**本报告不宣布任何模块 ready。**
