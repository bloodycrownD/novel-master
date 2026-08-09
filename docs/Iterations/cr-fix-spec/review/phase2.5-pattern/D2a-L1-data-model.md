# D2a-L1：数据模型 & 持久化跨模块模式识别

## 元信息

- 角度：L1 数据模型 & 持久化
- 输入：`D1-01-data-model.md` + 全部 6 份 `D2-*.md`（vfs / chat-message / provider-llm / agent-tool / compaction / prompt）+ `D0-1-code-map.md` §3 §5 + `D0-2-docs-index.md` §1 §2
- 轮次：Phase 2.5 第 1 轮（readonly，不改代码、不宣布 ready）

## 结论（叙述式）

诶～本来 D1 写完觉得「整体底盘是稳的，坑集中在 vfs」，把 6 份切片叠起来一看才发现这个判断只对了一半——vfs 确实是债务最重的单点，但**很多看起来「vfs 独有」的 schema 病，在 chat-message / provider / agent 那边都各长了一份近似副本**。聚拢之后能稳定浮上来 7 个跨模块模式，其中 3 个是 S 级（同一反模式 3+ 核心模块 + 架构层根因），整体严重程度比 D1 单角度结论要高一档。

最值得 phase3 优先关注的是**「数据层约束 + 应用层补丁」双轨制**（模式 1）和它的派生品——**跨 context 关联无 FK 兜底、事务自保护缺失、孤儿清理散在 app 层**（模式 2/4/7）。这四条本质上是同一件事的不同切面：仓库在持久化层刻意只做轻约束（很少 FK、不外键级联、靠应用层 + 触发器维护一致性），但应用层没有补上一套与之配套的「统一事务编排 / 统一完整性修复」抽象。结果是每条跨 context 写路径都得手动同步，每条新接入的端（mobile provider delete）都会漏接，每次大改迭代都得在多处打补丁——vfs-entry-id-redesign 的双保险补列、provider delete 的手动逐表删、setMessageFloorAtMessage 的四步裸写，都是同一类「应用层补丁散落」的症状。摇摆度交叉进一步证实了这一点：vfs（17 迭代）/ chat-message（23）/ provider（10）/ agent-tool（19）这四个高摇摆模块，正是 L1 这套发现集中爆发的地方，说明每次迭代都在改同一个根因但没改对。

剩下的模式里，「N+1 逐行 INSERT / 逐行解正文」（模式 3）和「schema 宽松 + service 兜底校验」（模式 5）是 A 级，「软删 vs 硬删并存」（模式 6）实际是有意为之的设计、不算反模式，但模式化记录方便 phase3 别误判。god module 的 L1 影响（模式 8）作为类型 3 单列。

## 跨模块模式清单

### 模式 1：「数据层约束 + 应用层补丁」双轨制计数 / 维护

- 类型：同一反模式多处出现
- 出现模块：vfs、chat-message（跨 context 改 vfs ref_count）、provider
- 共同特征：重要的完整性约束（引用计数、身份匹配、级联）既不全部下放到数据层（FK / 触发器 / CHECK），也不全部收归应用层单一权威，而是「数据层声明一份 + 应用层补一份」双轨并存，每条新写入路径都得手动同步两套。
- 各模块变体：
  - **vfs**：`vfs_content_blob.ref_count`（3 个 SQL 触发器维护，归零删 blob）与 `vfs_revision.ref_count`（应用层 `incrementRefsForCheckpointFiles` / `decrementRefsForCheckpointFiles` / `repairRefCountFloor` 维护）并存，语义不同但都需要后续 migration 持续对齐（D1-01 A）。
  - **chat-message**：`message_checkpoint_file.entry_id → vfs_entry.entry_id` 无 FK，靠应用层维护 vfs 侧 revision ref_count；`insertCheckpoint` 走「decrement 旧 ref → 删旧行 → 插新行 → increment 新 ref」序列，**repo 层不自带事务**，依赖上层 `messageCheckpoint.capture` 的 `conn.transaction`（D2-chat-message A3 / B2）。这与 vfs 双 ref_count 是同构问题——两个语义不同的计数器需要跨表协同维护。
  - **provider**：`llm_provider` 双身份键 `id` PK + `builtin_key` UNIQUE，insert 写 `builtin_key`、update 故意不写（D1-01 B）。同时 `llm_saved_model.provider_id` 带 `ON DELETE CASCADE`（数据层已就绪），但 service 不依赖 cascade 反而手动 `savedModels.deleteByProvider` 逐表删（D2-provider-llm A1）——典型的「应用层不信任 / 不知道数据层已经有约束，自己再补一份」。
- 系统性根因：仓库在 `D1-01` 结论里已说明「跨 context 不挂 FK 是有意识的设计选择」，但没有配套地建立一个**统一的引用 / 计数 / 级联编排层**。约束被切了一半留在数据层（少量 FK + 触发器）、一半散在应用层（手动 ref_count 维护、手动逐表删），两半之间没有契约约束。每次 schema migration 改表结构，应用层那半不一定同步更新（vfs-entry-id-redesign 已经为了对齐写了 365 行双路径守卫，是这种税的典型样本）。
- 严重度：**S**（3 个核心模块出现 + 架构层缺失统一编排抽象）
- 建议方向：phase3 应优先裁决「引用计数 / 级联到底是数据层权威还是应用层权威」——任一方向都能消除双轨心智模型。要么把所有 ref_count 下沉到触发器（消除应用层隐式同步），要么把所有完整性维护收进一个 `IntegrityCoordinator` / port 型抽象，repo 层强制走它。**继续维持「数据层一半 + 应用层一半」是最坏选项。**

### 模式 2：多步写无事务保护（事务自保护缺失）

- 类型：同一反模式多处出现 + 模块间不一致（核心路径）
- 出现模块：chat-message、agent-tool、provider（vfs 自身的 insertCheckpoint 反向触发也涉及）
- 共同特征：repo 层普遍不带事务（port/impl 分层下的常态），但 service 层没有可靠的「跨表 / 跨 context 多步写必须包事务」约定——有的 service 包了，有的没包，事务边界判定完全靠每个 service 作者自觉。
- 各模块变体：
  - **包了事务的**：`messageCheckpoint.capture`（`message-checkpoint.service.ts:34-57`）确实把 `insertCheckpoint` 的多步写包进了 `conn.transaction`（D2-chat-message B2）。
  - **没包事务的**：`agent-runner` 的 `append(assistant) + capture + append(toolResults)` 各自独立提交（D2-chat-message S1 / D2-agent-tool B1）；`run-agent-turn` 入口 `append(user) + capture` 两次独立提交（D2-chat-message S1）；`setMessageFloorAtMessage` 四步写（hideRange → showRange → clearDomain×2 → tokenCache.invalidate）全裸（D2-chat-message S2）；`DefaultProviderService.delete` 跨 `suggestions / savedModels / providers / secretStore` 四步裸写（D2-provider-llm S1 / A1）。
  - **repo 层无自保护**：`insertCheckpoint` 即便被外层误用也不会报错（D2-chat-message A3）——没有任何「未在事务中则拒绝」的断言。
- 系统性根因：仓库已有 `runInTransactionOrConn` / `NESTED_TRANSACTION` 错误码（L4 已发现），但只用于"嵌套检测"，没有「跨 context 多步写必须强制事务」的硬约束。事务边界靠 reviewer / 作者自觉维护。
- 严重度：**S**（核心路径不一致 + 数据正确性影响）
- 建议方向：phase3 应统一约定——(a) 跨 context 多步写的 repo 方法在没绑定 tx 时直接抛 `NO_ACTIVE_TRANSACTION`；(b) service 层的「append + capture + append」「delete × N steps」「hide + show + clearDomain × 2」这种组合，必须有对应的「事务版」编排入口，禁止裸调。L4 已经标过这些点，L1 这边只是从「schema / 数据正确性」侧背书它的优先级。

### 模式 3：N+1 逐行 INSERT / 逐行解正文

- 类型：同一反模式多处出现（但分布偏冷路径）
- 出现模块：message-checkpoint（热路径）、vfs（冷路径 + 隐患）、vfs migrations（一次性）
- 共同特征：repo 层已经有 batching 能力（`conn.batch(sql, paramsList)`、IN clause、OR 分块），但**只在「批量读」方法上用，「批量写」和「row → domain 转换」路径上系统性漏掉**。
- 各模块变体：
  - **message-checkpoint insertCheckpoint**：`for (const file of input.files)` 逐条 INSERT，热路径 N+1（D1-01 A / D2-chat-message B2）。这是唯一一条用户可感知的 N+1。
  - **vfs rowToRevision**：每次 row 转 domain 都去 `vfs_content_blob` 单独取一次正文，是隐性 N+1，当前未踩雷（D1-01 B）。
  - **vfs 三条 migration**（`backfillVfsEntry` / `migratePlaintextToBlobs` / `vfs-revision-ref-count-v1`）：循环内逐行 INSERT/UPDATE，一次性运行，部分是 OOM 权衡（D1-01 B）。
- 系统性根因：repo 层缺乏「写批量」的统一约定——读批量方法（`findMetasByEntryVersions`、`listFilePointersForMessages`）都规范地做了 IN clause，写批量却各自为政。message-checkpoint 是唯一中招的热路径，但 vfs rowToRevision 是定时炸弹，未来一旦被批量方法误用立刻爆。
- 严重度：**A**（普遍但唯一热路径只有 message-checkpoint）
- 建议方向：phase3 不必单独处理，跟着 D1-01 A 的 batching 改造走；改造 `insertCheckpoint` 时同时给 `rowToRevision` 这类 private 方法加 JSDoc 标注「禁止批量调用，否则 N+1」，避免未来踩雷。

### 模式 4：跨 context 关联靠应用层维护，无 FK 兜底（模式 1/2 的根因）

- 类型：god module 影响 + 架构层根因
- 出现模块：message-checkpoint ↔ vfs、provider ↔ sksp、session-kkv ↔ chat 可见历史
- 共同特征：跨 context 关联完全靠应用层维护，没有数据层兜底。这是模式 1（双轨计数）和模式 2（事务缺失）的**共同根因**——因为没有 FK 兜底，一致性完全靠应用层，应用层一旦漏一处就泄漏。
- 各模块变体：
  - **message-checkpoint ↔ vfs**：`message_checkpoint_file.entry_id → vfs_entry.entry_id` 无 FK，靠应用层 + revision ref_count 维护（D1-01 vfs 段）。
  - **provider ↔ sksp**：`sksp_secrets.ref` 与 `llm_provider` / `llm_saved_model` 跨 store 关联，无 FK；删 provider 时 secret 清理完全靠 service 自觉（D2-provider-llm S1 / A1）。
  - **session-kkv ↔ chat 可见历史**：`RULE_SNAPSHOT` / `FILE_CACHE` 与 `chat_message.hidden` 同步关系完全靠 `setMessageFloorAtMessage` 手动 `clearDomain` 维护（D2-chat-message S2，`AGENTS.md` 反复强调的同步关系）。
- 系统性根因：跨 context 不能挂 FK（D1-01 已论证），这是有意识的设计。但配套的「应用层一致性编排」抽象没有建起来，所以每条跨 context 写路径都得自己手动维护一致性、自己包事务、自己处理孤儿。模式 1/2/7 都是这条根因的不同症状。
- 严重度：**S**（架构层根因 + 多模块）
- 建议方向：这是 phase3 最该拉一次架构裁决的事——**要么承认跨 context 一致性是 core service 的硬职责并建立统一编排抽象**（IntegrityCoordinator / LifecycleService），**要么逐步把强关联 context 合并**（例如 chat + message-checkpoint，或 session-fs 已空壳化是否整体并入 message-checkpoint，D2-chat-message 耦合点已提到）。当前「无 FK + 无统一编排」的状态是最差解。

### 模式 5：schema（zod / DDL）宽松 + service 层兜底校验不对齐

- 类型：同一反模式多处出现
- 出现模块：agent、provider、（agent_definition.upsert）
- 共同特征：schema 层（zod schema / DDL 约束 / TS 类型）是宽松的，真正的约束在 service 层补，但 service 校验不在所有写入路径上跑——绕过 service 主 upsert 的路径（db-backup import / cloud-sync pull / 直接 `rowToDefinition`）就会写脏。
- 各模块变体：
  - **agent tool policy allow+deny**：`agentToolPolicyDocumentSchema` 用 `.strict()` 但 allow/deny 都 optional，不强制互斥；互斥只在 `DefaultAgentRegistryService.upsert` 路径上校验。db import / cloud-sync pull 能写入 `{allow, deny}` 同时存在的脏配置，运行时优先 allow 让 deny 失效（D2-agent-tool A3）。
  - **provider 双身份键**：insert 写 `builtin_key`、update 不写，靠注释维护「不可变身份」语义，schema 不强制（D1-01 B）。
  - **agent_definition.upsert created_at_ms**：靠「不在 SET 子句里」隐式保留首次创建时间，无注释保护（D1-01 C / D2-agent-tool C）。
  - **BUILTIN_PROVIDER_IDS deprecated 别名**：语义已从「UUID 列表」改成「key 列表」，类型仍是 `readonly string[]`，旧用法编译器不拦（D2-provider-llm B1）。
- 系统性根因：zod schema 没有被当作「所有写入路径的统一闸门」——schema 只在 service 主入口跑，绕过入口的路径（import / sync pull / rowToDefinition）不做二次校验。这与模式 2 是镜像问题：模式 2 是「事务边界靠 service 自觉」，模式 5 是「schema 校验靠 service 自觉」。
- 严重度：**A**
- 建议方向：把约束尽量上移到 zod `.refine`（agent allow/deny 互斥就是一行），让 schema 自身闭合；不能上移的（如 `created_at_ms` 隐式保留），至少在 repo 的 `rowToDefinition` 强制走一次 `validateXxx`。所有「绕过 service 主 upsert 的写入入口」要做清单（db-backup import、cloud-sync pull、未来的批量导入），逐个确认是否经过 schema 校验。

### 模式 6：软删（hidden / tombstone）与硬删并存

- 类型：模块间不一致（边缘路径）
- 出现模块：chat_message、vfs_revision、（session-fs 空壳化）
- 共同特征：同一体系里软删（hidden 列 / status tombstone）和硬删（DELETE）并存。**实际是设计选择而非反模式**——软删控制可见性 / append-only 历史保留，硬删处理真删 / current state 重置，语义是分开的。但模式化记录，方便 phase3 别误判成「软硬删混用 = 混乱」。
- 各模块变体：
  - **chat_message**：`hidden INTEGER` 控制 LLM prompt 可见性，`DELETE` 用于 rollback / 重发（D1-01 C）。
  - **vfs_revision**：`status TEXT`（active/deleted）作 tombstone（append-only 不能真删），`vfs_entry` 用真删（current state）（D1-01 C）。
  - **session-fs**：整个 context 已被清理成空壳，职责被 message-checkpoint 接管（D1-01 结论）——这是一次干净的退役，但 context 名义还在。
- 系统性根因：append-only 历史表必须 tombstone（不能破坏历史链），current-state 表可以硬删——这是分层职责的合理体现，不是债务。D1-01 已经分别给过判定。
- 严重度：**C**（不算反模式，记录仅为防误判）
- 建议方向：phase3 不需要整改，但建议在各自 schema 文件加一行注释点明「visibility flag, not deletion marker」，避免新人按「软硬删混用」误读。session-fs 空壳目录是否一并清理，归 L3（架构）裁决。

### 模式 7：孤儿清理 / 完整性修复机制散在 app 层或 migration，service 不复用

- 类型：同一反模式多处 + god module 影响（缺统一抽象）
- 出现模块：provider（current* 清理）、sksp（孤儿扫描）、vfs（repairRefCounts）
- 共同特征：完整性修复 / 孤儿清理逻辑不收敛在 core service，而是散在三端 app 层（各自一份）或一次性 migration 脚本里。新功能（mobile provider delete）会漏接，新 bug（ref_count 偏高）无信号无重试。
- 各模块变体：
  - **provider current\***：删 provider 时清 `currentProviderId` / `currentModelId` 的契约 core service 不护，CLI 和 Desktop IPC 各写一份近似实现，**mobile 完全没接入 provider delete**（D2-provider-llm S1）。
  - **sksp 孤儿扫描**：`provider-identity-v1` 的 `renameSkspSecrets` 已经实现了「按 `provider/%/apiKey` LIKE 模式全表扫 + 逐行处理」的能力，是仓库里唯一一份「全表扫 sksp ref」的参考实现，但 service 层的 delete 完全没复用，连 `console.warn` 都没有（D2-provider-llm A1）。
  - **vfs repairRefCounts**：只在 bootstrap 单次异步触发（事务外），`.catch(() => {})` 吞错；`vfs-version-redesign` PRD 承诺的「session 切换时跑 repair」完全未实现，所以任何一次 repair 失败或漏修造成的 ref_count 偏高会**永久停留**（D2-vfs S1 / F1 / F2）。
- 系统性根因：core service 的职责被理解成「主路径 CRUD」，把「跨 store 一致性 / 孤儿清理 / 修复重试」推给 app 层。但 app 层是三端各自一份，逻辑必然分叉 + 漏接；migration 路径写过的扫描能力（renameSkspSecrets）没有作为可复用 port 沉淀下来。这与模式 4 是同一根因的不同表现——「无 FK 兜底」+「无统一编排」就一定需要孤儿清理，但孤儿清理又被散置。
- 严重度：**S**（3 核心模块 + 架构层缺失「完整性服务」抽象）
- 建议方向：把「启动扫一次孤儿」 / 「空闲调度重跑 repair」做成 core 层统一的 `IntegrityService` port（与模式 1/4 的整改一起做），把 `renameSkspSecrets` 的 LIKE 模式抽成可复用 helper。三端 app 层的 current* 清理统一收进 core service。vfs repairRefCounts 必须补一个空闲调度（session 切换 / KKV needs-repair flag），兑现 PRD 承诺。

### 模式 8：god module 对 L1 的跨模块影响（path scope 与 ref_count 都靠单点枢纽）

- 类型：god module 的跨模块影响
- 出现模块：vfs-path-mapper（42 引用）、vfs-entry.port / sqlite-vfs-entry.repository、connection.port（80 引用）
- 共同特征：L1 角度相关的几个 god module，被多个模块跨 context 依赖来执行「scope 校验」「ref_count 维护」「事务抽象」。它们一旦被改，跨模块影响面被放大。
- 各模块变体：
  - **vfs-path-mapper（42 引用）**：path scope 校验完全靠它（`assertLogicalPathAllowed` / `resolveLogicalPath`），agent-tool 的 `BuiltinToolContext` / message-checkpoint 的 entry 关联 / vfs 全套都依赖它判 scope（D2-agent-tool A4 / D2-vfs A1）。它本身被双层 normalize 包了（ScopedVfsService + RevisionAwareVfsService），单次调用链 normalize 跑 3 次。L1 视角看：path scope 是 vfs 数据完整性的隐式不变式，但靠这一处单点维护，没有 schema 层 / 类型层背书。
  - **vfs-entry.port（28）+ sqlite-vfs-entry.repository（24）**：message-checkpoint 跨 context 反向依赖它维护 ref_count（D2-vfs 与其他模块耦合点）。vfs-entry-id-redesign 已经在这上面打了大量补丁。
  - **connection.port（80）+ `runInTransactionOrConn` / `NESTED_TRANSACTION`**：所有 repo 的事务抽象都依赖它，模式 2 的「事务自保护」整改落点最终都汇到这一层（L4 已发现）。
- 系统性根因：path scope 校验、ref_count 维护、事务抽象这三种 L1 关心的不变式，都集中在单一 hub 文件里，没有更细粒度的拆分（D0-1 §3 已确认 vfs 在 Top 30 占 3 席）。
- 严重度：**B**（god module 影响可量化，但危害可控——这些 hub 当前是工作的）
- 建议方向：归 L3 架构角度主裁。L1 这边只标记：任何对 path-mapper / vfs-entry.port / connection.port 的签名改动，都要同步审计 message-checkpoint / agent-tool 的 ref_count 与 scope 假设。

## 摇摆度 × L1 发现 交叉

按 D0-2 §2 的模块摇摆度打分对照：

| 模块 | Iter 摇摆度 | L1 命中模式 | 解读 |
|------|-----------|-----------|------|
| vfs | 17（最高之一） | 模式 1 / 3 / 4 / 7 / 8 | 双计数器 + 修复单次跑 + 双路径 rebuild 全在这 |
| chat + message | 23（最高） | 模式 1 / 2 / 4 / 5 | append+capture 无事务、setMessageFloor 四步裸写、跨 context ref_count |
| provider + llm-protocol | 10 | 模式 1 / 2 / 5 / 7 | 双身份键、跨 store 多步裸写、孤儿清理散 app 层 |
| agent + tool | 19 | 模式 2 / 5 | capture 无事务、allow/deny schema 不闭合 |
| compaction | 5 | （无 L1 持久化命中） | 无持久化 context，L1 不涉及 |
| prompt | 4 | （无 L1 持久化命中） | 无持久化 context，L1 不涉及 |

**结论**：所有 L1 命中模式都集中在 4 个高摇摆度模块（vfs / chat-message / provider-llm / agent-tool），compaction 和 prompt 因为没有持久化 context 自然免疫。这是「每次迭代都在改同一个 ref_count / 事务 / 孤儿清理问题但没改对」的直接证据——局部修补无法解决全局问题，vfs-entry-id-redesign 写了 365 行双路径守卫、provider delete 还在裸写、setMessageFloor 仍在四步裸写，三处分别打补丁但根因没动。phase3 应把这套发现作为「全局债务核心」优先裁决。

## 覆盖声明

读了：
- `D1-01-data-model.md` 全文（10 个持久化 context 的横扫结论 + 10 条发现清单 + 待交叉线索）
- 全部 6 份 `D2-*.md`：vfs、chat-message、provider-llm、agent-tool、compaction、prompt 的「交叉发现 / 债务清单 / 与其他模块的耦合点」三段
- `D0-1-code-map.md` §3 God Module + §5 持久化分布（量化背书）
- `D0-2-docs-index.md` §1 摇摆度分级 + §2 模块摇摆度打分（摇摆度交叉依据）

没读 / 不读（按指导文档边界）：
- **实现代码**：D1 + D2 已经读过，本阶段只做二次分析；若 D2 某条结论需要核实，标 `待回派`，不自己翻代码。本轮没有出现需要回派的情况。
- **其他角度的 D1 报告**（L2-L11）：那是 Phase 3 的事，不在本阶段范围。
- **各 D2 切片的「功能正确性核对」段**：那是功能 / spec 维度，与 L1 数据模型角度关系弱，仅扫了标题不细读。
- **compaction / prompt 两份切片的 L1 交叉点**：这两份切片自身没有 L1 命中（无持久化 context），仅在耦合点提到 tokenizer / chat 类型共享，不构成 L1 跨模块模式。

## 给 Phase 3 的线索

按优先级排序：

1. **模式 1/2/4/7 是同一个架构层根因的四个切面**，建议 phase3 合并裁决（核心问题：「跨 context 一致性到底数据层权威还是应用层权威，统一编排抽象要不要建」）。这四条任何一个单独修都治标不治本。
2. **与 L4（错误处理 & 事务）强耦合**：模式 2（事务自保护）的整改落点和 L4 的 `runInTransactionOrConn` / NESTED_TRANSACTION 整改是同一条；模式 7 的 `repairRefCounts` 吞错也是 L4 的核心靶点。phase3 应把 L1 + L4 拉一次合议，避免两边各出一套整改方案打架。
3. **与 L5（并发）潜在冲突**：模式 1 的 vfs 双计数器在并发写入时的竞态、模式 7 的 bootstrap 异步 repair 与正常写入的双向修改，都是 L5 的判定范畴。如果 L5 判定「异步 repair 与正常写入确有竞态」，模式 1/7 的优先级要再上调。
4. **与 L3（架构）潜在冲突**：模式 4 提到的「session-fs 空壳是否整体并入 message-checkpoint」「跨 context 强关联 context 是否合并」，模式 8 的 god module 拆分，都是 L3 主裁的范畴。L1 只提供数据正确性侧的背书。
5. **与 L8（API 稳定性 & 安全）相关**：模式 5 的 provider 双身份键、模式 7 的 sksp 孤儿扫描涉及 secret store 信任面，需要 L8 从「身份稳定性 / secret 不泄漏」角度背书。
6. **不会与 L2（性能）/ L6（跨端）/ L7（测试）直接冲突**：模式 3 的 N+1 在 L2 视角是性能问题，但 L1 这边只关心 batching 改造对数据正确性无影响，两边方向一致。模式 7 的 mobile provider delete 漏接是 L6 跨端矩阵缺口，但根因在 core service 没护，整改方向一致。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 评审发现。
