# D1-07：测试 & 可测性（L7 角度横扫）

## 元信息
- 角度/模块：L7（测试覆盖与可测性） × 全仓库
- 范围：`packages/core/test/**`、`packages/core/src/**`、`apps/mobile/__tests__`、`apps/mobile/e2e`、`apps/desktop/test`、`apps/cli`
- 参考文档：
  - `docs/review/guides/lens-L7-testing.md`
  - `docs/review/phase0/D0-1-code-map.md`（盲区清单）
  - `docs/review/phase1-lens/D1-02-algorithm.md`（L2 sql-template 无 AST 缓存）
  - `docs/review/phase1-lens/D1-04-error-txn.md`（L4 无事务路径）
  - `Iterations/core-test-fixture-sharing`、`Iterations/mobile-android-e2e-appium`
- 轮次：第 1 轮（首次横扫）
- 产出日期：2026-08-05
- 模式：readonly，未改任何代码

## 结论（叙述式）

诶～一上来先纠正 Phase 0 给出的"测试密度"印象——单看 `测试文件数 / src 行数` 这个比值，会以为 `bootstrap`、`cloud-sync`、`regex` 这几块都病得不轻，但真进去读测试内容，密度和厚度不是一回事。`bootstrap` 那 7 个测试文件其实是几十个 `it` 块的大集成，`schema-migrations.test.ts` 单文件就覆盖了空库首次 bootstrap、二次 bootstrap 幂等、legacy 数据迁移、孤儿状态 fail-fast 加事务回滚（T-SM12）、`SCHEMA_MIGRATIONS` 唯一性等关键路径——`bootstrap` 的真实覆盖度远超 1/380 这个数字暗示的水准，应该评 B（偏薄但有底）而不是 S。反过来，`regex` 的 3 个测试虽然命中了 apply 链的核心行为，却完全没碰 `compileRegexRule` / `resolveActiveCompiledRules` 的失败路径，`cloud-sync` 的 2 个测试只走 happy + 单点 lock 状态判定，这两个的"密度薄"是"质量薄"的真正信号。

把 L2 和 L4 已经埋下的的问题对回测试侧，是这次扫描最有价值的部分。L2 说 `SqlTemplateParser` 无 AST 缓存、热路径上反复 parse，我看了 `test/infra/sql-template/`：parser.test.ts、sql-template.test.ts 都只对同一模板调用一次 `parse` / `parseTemplateToAst`，**没有任何一个测试重复 parse 同一模板**——也就是说"加缓存"或"误删缓存"都不会被现有测试发现，这是 L7 + L2 必须交叉的典型缺口。L4 列出了 5 条无事务路径（`setMessageFloorAtMessage`、`provider.delete/create/edit`、`agent-runner` 循环里的 append+capture+append、`run-agent-turn` 入口的 append user + capture），我对每条都去 grep 了对应测试，结果很统一：**这些路径全部没有"中间步骤失败 → 验证可观察的半套状态或错误"的测试**。`setMessageFloorAtMessage` 在 `test/chat/**` 里搜不到任何引用；provider delete 测试只断言"删完 secret 没了"，没有模拟"DB 删成功但 secret 删失败"或反过来的孤儿场景；agent-runner 里有 `captures checkpoint once after parallel mutating tools` 这种 happy path，但没有 `capture 失败后 user 消息是否落库` 的反向断言。L4 把这些标成 A 级错误路径缺陷，L7 的补刀就是"这些缺陷也没有测试捕捉"——互补关系，phase3 应当合并计分。

可测性侧的好消息是 mock 文化健康：`packages/core/test` 里 28 个文件用到 `mock.fn`，但绝大多数集中在 `infra/llm-protocol/**`（合理：mock fetch / SSE）和 `agent-runner` 的 model mock，**几乎看不到 mock 内部 repo / service 来伪造集成行为**的反模式。fixture 共享也做得不错，92 个测试文件调用 `novelMasterTestFixture()` 拿到同一个 in-memory `NovelMasterTestContext`，DB 路径都走真实 SQLite，这是行为测试而不是实现耦合测试。但可测性硬伤还是有的：核心 service 直接 `Date.now()` 拿时间戳（`message.service.ts:128` 的 `createdAtMs`、`message-checkpoint.service.ts:55` 的 capture 时间），这些字段在测试里无法注入固定时钟，跨时区 / 跨秒边界的测试只能靠运气；`testIsolationSuffix` 用 `${Date.now()}-${Math.random().toString(36).slice(2,8)}` 制造名字隔离，理论上有冲突可能（虽然实践极小）。还有一处典型脆弱测试：`checkpoint-capture-transactional.test.ts` 把"1000 文件 capture P95 ≤ 800ms"作为硬断言，注释里写了"CI 宽松倍率"，但断言是 `maxDuration < BASELINE_MS`——**任何慢机器 / GC 抖动 / CI 共享 runner 都会让它红**，这类时间基线应该改成统计型或干脆去掉。

最后说测试运行器三分。`packages/core` 用 `node:test`（轻量、原生），`apps/mobile` 用 jest + react-native preset（145 个测试），`apps/desktop` 用自定义 `scripts/run-tests.mjs`（66 个测试），`apps/cli` 只有 18 个测试但跑的也是 node:test 风格。**这个分裂本身是可测性问题**：同一段 core 逻辑在三端的测试无法共享 helper、无法共享 fixture、jest 和 node:test 的 mock API 还不兼容（`jest.fn()` vs `node:test` 的 `mock.fn()`），跨端 parity 风险因此被放大——一个 bug 在 core 的 node:test 里被修了，但 mobile 的 jest 那侧可能还在用旧 mock 写老断言。`Iterations/core-test-fixture-sharing` 在 core 内部已经建立了共享 fixture，但跨端共享层完全缺失。

## 角度 × 模块矩阵

每行写明：覆盖度（足 / 薄 / 无） + 测试质量（行为 / 实现耦合 / 仅 happy） + 关键缺口。

| 模块 | 覆盖度 | 测试质量 | 关键缺口 |
|------|--------|----------|----------|
| **events / event-bus / orchestrator** | 足 | 行为 | DAG 拓扑变更 + 异常 handler 同时挂的边界没单独覆盖 |
| **agent / agent-runner** | 足（密度 1/42） | 偏行为，model mock 合理 | **A**：capture 失败的孤儿路径无测试；maxSteps 边界只测 1 和 3，未测"恰好达上限且流式中断"；token cache 失效竞争未覆盖 |
| **provider** | 足（密度 1/64） | 行为 | **A**：delete/create/edit 跨 DB+secretStore 的部分失败场景无测试（L4 主发现）；protocol 适配器 mock 覆盖深，但 provider 服务的事务边界 mock 为零 |
| **message-checkpoint / rollback** | 足（密度 1/71） | 行为 + 真实 SQLite | **A**：`rollback-failure-degraded-fallback` 那条降级路径有 `rollback-degraded.test.ts`，但 cause 链丢失（L4-B）无断言；capture 性能基线是脆弱测试（B） |
| **prompt** | 足（1/77） | 行为 | 模板展开 + 宏嵌套边界 OK；layout 装配在真实 agent 定义上跑，未见明显缺口 |
| **chat**（49 文件 / 6797 行） | 薄-中 | 大量 schema 校验 + 真实 repo 集成，质量好 | **A**：`MessageTranscriptEffects.setMessageFloorAtMessage` 完全无测试（L4）；`message-transcript-effects` 的 hide/show range 组合边界只通过 truncate 间接覆盖 |
| **vfs**（31 / 5512） | 薄-中 | 行为，真 SQLite | **A**：`expectedVersion` 乐观锁冲突路径无测试（每次都给"正确"的 expectedVersion）；并发写同一路径无测试；`runInTransactionOrConn` 的 NESTED_TRANSACTION fallback 分支（L4-B）无测试 |
| **bootstrap**（7 / 2661） | 薄但有底 | 行为，覆盖幂等 + fail-fast + 事务回滚 | 迁移脚本本身的 schema 校验脚本 (`schema-align-columns`、`bootstrap-no-migrate`) 是健康设计；缺 vfs-entry-id-redesign 9 个 CREATE 之间的依赖顺序回归测试 |
| **regex**（3 / 1014） | 薄 | apply 行为测得好；编译路径只测编译成功 | **A**：`compileRegexRule` 的 INVALID_PATTERN 分支无单元测试（只通过 service.createRule 间接覆盖一次）；`resolveActiveCompiledRules` 的 stale pointer（`activeGroupId` 指向已删 group）边界无测试；超长 pattern、灾难性回溯 pattern 无测试 |
| **cloud-sync**（2 / 532） | 薄 | lock 是纯函数行为测；coordinator 用内存 storage mock | **A**：租约续期 / 租约过期发生在 push 中段无测试；网络中断（put 抛 general Error）只测了 snapshot upload failed 一条；并发设备 push 竞争无测试；`renewLease` 在真实时钟下穿越 expiresAt 的边界无测试 |
| **session-kkv / kkv**（1 / 298 + 1 / 184） | 薄-仅 happy | 行为 | **A**：无并发 set 同 key 测试；无超大 value 测试；无 clearSession 与 capture 在同事务里的并发测试（L4 担心的"中间崩留半套"无测） |
| **sksp**（1 / 221） | 薄 | 行为 | secret store 跨 backend 切换、删除不存在的 ref、并发 set 同 ref 无测试 |
| **compaction-conditions**（3 / 412） | 薄 | 行为 | 触发条件的组合（tokenRatio × manual × custom）只覆盖了 tokenRatio 单维度 |
| **sql-template**（8 / ~940） | 足（数量上） | 行为 + AST 形状 | **A**：**没有任何测试重复 parse 同一模板**（L2-F1 缓存缺失的直接观察）；foreach + new Function 的 evaluator 成本无性能基线 |
| **infra/llm-protocol**（26 测试） | 足 | 行为 + 协议 fixture | SSE 解析错误路径覆盖好；model mock 用得合理 |
| **infra/tokenizer** | 足 | 行为 | heuristic counter 的极端长度、代理对边界无显式测试 |
| **apps/mobile**（jest，145 测试） | 中 | 行为 + RN renderer | 与 core 行为的对齐无共享断言；jest vs node:test API 差异导致 helper 无法复用 |
| **apps/mobile/e2e**（Appium / wdio） | 薄（page object 完备但用例少） | 行为 | 关键流（chat send → vfs flush → rollback）端到端覆盖度待核实 |
| **apps/desktop**（自定义 runner，66 测试） | 中 | 行为 | runner 自定义 = 三端最难统一的一侧 |
| **apps/cli**（18 测试） | 薄 | 行为 | 与 desktop/mobile 的 IPC / 参数对齐无共享测试 |

### 测试覆盖矩阵（行=核心模块，列=路径类型）

这是 phase2 会反复引用的硬表。✓=有专门测试，✗=完全无，△=有但只覆盖单一场景或 happy。

| 模块 | happy path | 错误路径（throw / fail-fast） | rollback / abort | 边界条件 | 并发场景 | 集成路径（跨层） |
|------|------------|-------------------------------|------------------|----------|----------|------------------|
| events / event-bus | ✓ | ✓ | n/a | △ | ✗ | ✓ |
| agent-runner | ✓ | △（abort 有，capture 失败无） | ✓（abort） | △ | ✗ | ✓（带真实 vfs + checkpoint） |
| provider | ✓ | △（INVALID_ARGUMENT 有，跨 store 孤儿无） | ✗ | △ | ✗ | △（mock secret store） |
| message-checkpoint capture | ✓ | ✗ | ✓（事务回滚） | ✓ | △（Promise.all 顺序，非真并行） | ✓ |
| message.rollbackToMessage | ✓ | △（degraded 有，cause 链无） | ✓ | △ | ✗ | ✓ |
| message-transcript-effects | △（truncate ✓，setFloor ✗） | ✗ | ✗ | ✗ | ✗ | △ |
| vfs（write/delete/resetHead） | ✓ | △（删除后 read ✓，version 冲突无） | ✓（事务回滚） | △ | ✗ | ✓ |
| vfs-batch-io | ✓ | △（applyBatchIngestWithWriter 部分失败无） | △ | △ | ✗ | ✓ |
| regex apply / compile | ✓ | △（service 拒绝无效输入 ✓，compile INVALID_PATTERN 无） | n/a | ✗（无灾难回溯 / 超长 pattern） | ✗ | △ |
| cloud-sync coordinator | ✓ | △（NEED_PULL_FIRST / LOCK_HELD ✓，网络中段仅 1 例） | △（finally 清锁 ✓） | ✗（租约过期在 push 中段无） | ✗ | △（mock storage + mock dbSync） |
| cloud-sync lock | ✓ | ✓ | n/a | △（用 `>=` 容忍时钟漂移） | ✗ | n/a（纯函数） |
| session-kkv / kkv | ✓ | ✗ | ✗ | ✗ | ✗ | △（sessions.delete 级联 ✓） |
| bootstrap schema-migrations | ✓ | ✓（fail-fast + 事务回滚） | ✓ | ✓（legacy fixture 多版本） | ✗ | ✓ |
| sql-template parser/evaluator | ✓ | ✓（UNKNOWN_TAG / UNCLOSED_TAG） | n/a | △（无重复 parse / 无大模板） | n/a | △（repo 集成无显式测试） |
| compaction-conditions | ✓ | ✗ | n/a | △ | ✗ | △ |

## 发现清单

### A `agent-runner` 循环里 capture 失败的孤儿状态无任何测试
- 位置：`packages/core/src/service/agent/impl/agent-runner.ts`、`packages/core/src/service/agent/impl/run-agent-turn.ts`；测试目录 `packages/core/test/agent/**`
- 问题：L4 已经定调"agent-runner 循环里 append(assistant) + capture + append(toolResults) 三步无事务，run-agent-turn 入口 append(user) + capture 也无事务"，capture 失败会留下"有 user 消息但无 baseline checkpoint"的孤儿状态——这正是 `Iterations/rollback-import-baseline-checkpoint` 想修的同一类 bug 在普通聊天路径的残留。我去 grep 了 `test/agent/**` 里的 `messageCheckpoint` / `capture` / `checkpoint`：所有断言都是"checkpoint 被创建了"或"read-only 轮不创建"，**没有一条是"我让 capture 抛错，然后验证 user/assistant 消息到底落库没"**。
- 依据：`agent-runner.test.ts:805` 的 `captures checkpoint once after parallel mutating tools` 用的是真实 `ctx.messageCheckpoint`，capture 一定成功；想验证孤儿状态需要把 `messageCheckpoint` 注入成"在第 N 次调用时抛错"的 mock，但目前没有任何 it 块这么写。`run-agent-turn` 入口路径的测试也缺失。
- 建议：加一组"注入 failing checkpoint"的测试，断言两件事——(1) capture 失败后 assistant / user 消息是否仍落库（描述清楚现状是不变式还是已知缺陷）；(2) 后续 `undo_send` rollback 拿到空 baseline 时的行为是什么。这组测试即便先标 `it.todo` 也比现状好，因为它会把 L4 的判断变成可执行的回归保护。
- 涉及角度：L4 主、L7 互补

### A `setMessageFloorAtMessage` 完全无测试，且它是 L4 标记的无事务四步写
- 位置：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:76-` ；测试 `packages/core/test/chat/**`
- 问题：在 `test/chat/**` 全文 grep `setMessageFloorAtMessage` / `transcript-effects` / `FloorAtMessage` 全部 0 命中。这个方法是 L4 标记的"四步写无事务"（hideRange + showRange + clearDomain ×2），既没有被事务保护，也没有任何测试覆盖它单独的行为是否正确，更没有"中间崩留半套"的回归测试。
- 依据：`grep -r "setMessageFloorAtMessage" packages/core/test` 无命中；`truncateMessagesAfter` 在 message-checkpoint 测试里间接覆盖，但 `setMessageFloorAtMessage` 是另一条独立路径。
- 建议：至少加 happy path 测试（置位成功后 rule_snapshot + file_cache 被清的可见行为），再补一组"第三步 clearDomain 失败 → 验证前两步已经落库"的测试，明确把它标成已知缺陷或驱动事务化整改。
- 涉及角度：L4 主、L7 互补、L1（持久化一致性）

### A provider 的 create/edit/delete 跨 DB+secretStore 部分失败无测试
- 位置：`packages/core/src/service/provider/impl/provider.service.ts`；测试 `packages/core/test/provider/provider-service.test.ts`
- 问题：L4 标记 `provider.delete/create/edit` 三组操作都没有事务包裹，DB 写和 secretStore 写不在同一原子单元。现有测试 `delete custom provider removes secret ref`、`delete removes secret at default ref when secretRef is null`、`edit with empty apiKey clears stored secret`、`delete provider clears nm-model-suggestions KKV after fetch` 全部是 happy path——**没有任何一个测试模拟"DB 删成功后 secretStore.delete 抛错"或反过来的孤儿**。
- 依据：`provider-service.test.ts` 全文搜 `assert.rejects` 在 delete 路径上 0 命中；`memorySecretStore` 是个无失败模式的内存实现。
- 建议：注入一个"按 ref 模式失败"的 secretStore，写三组断言：(1) secret 删除失败时 DB 行是否回滚 / 是否记孤儿；(2) DB 删除失败时 secret 是否还在；(3) `nm-model-suggestions` KKV 清理与 DB 删除的相对顺序。这些断言会直接驱动 L4 提的"事务内写 DB、事务外 best-effort 清 secret"整改。
- 涉及角度：L4 主、L7 互补、L8（密钥管理）

### A vfs 乐观锁 expectedVersion 冲突路径无测试
- 位置：`packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts`；测试 `packages/core/test/vfs/revision-aware-vfs.service.test.ts`
- 问题：`revision-aware-vfs.service.test.ts` 全部 4 处 `expectedVersion` 都给的是"正确"的版本号（v1 → 写时传 expectedVersion:1）。**没有任何一个测试故意给错误的 expectedVersion 来触发乐观锁冲突**。考虑到 vfs 是仓库复杂度最集中的区域（5512 行、3 张表、3 个 god module），这条错误路径无保护是显著风险——L2 / L4 都把 vfs 列为重点。
- 依据：grep `expectedVersion` 在该文件 4 次命中，全是 happy 序列；grep `CONFLICT` / `stale` / `optimistic` / `concurrent` / `race` 在 `test/vfs/**` 全部 0 命中。
- 建议：加 (1) 错误 expectedVersion 应抛 VfsError 的 VERSION_MISMATCH / CONFLICT；(2) 两个并发 write 同 logicalPath（用 Promise.all + 真实 SQLite 写锁）至少有一个应当失败；(3) `runInTransactionOrConn` 在嵌套调用时复用外层 tx 的回归测试（L4-B 的鲁棒性疑虑）。
- 涉及角度：L2 复杂度、L4 错误路径、L5 并发

### A sql-template 重复 parse 场景无测试覆盖（L2-F1 的直接回声）
- 位置：`packages/core/src/infra/sql-template/index.ts`、`packages/core/src/infra/sql-template/parser.ts`；测试 `packages/core/test/infra/sql-template/**`
- 问题：L2 已经定调 `SqlTemplateParser.parse` 无 AST 缓存、热路径上每次都重 parse。我去读了 `parser.test.ts` 和 `sql-template.test.ts`——`parseTemplateToAst` 4 个 it 块、`SqlTemplateParser.parse` 4 个 it 块，**每个测试都只对同一模板调用一次 parse**，没有任何用例 "parse → 再 parse 同一模板 → 验证返回一致 / 计数 / 性能"。这意味着：如果未来有人加上 `Map<template, AstNode[]>` 缓存（如 L2 建议），或者反过来误把 parser 改成有状态、跨调用污染，**现有测试都不会变化、也不会失败**。
- 依据：parser.test.ts 4 个 it 全是单次 parse 后断言 AST 形状；sql-template.test.ts 4 个 it 全是单次 parse 后断言 sql + parameters；`evaluator-foreach/if-where/trim-choose` 也是单次评估。
- 建议：加一组测试：(1) 同一模板用不同 params 连续 parse 1000 次，断言每次结果一致（行为保护）；(2) 可选地加一条性能 smoke（同模板 1000 次 parse 总耗时应低于 N 倍单次），把"重复 parse 是常态"这件事写进断言，给后续缓存优化留下回归基线。
- 涉及角度：L2 主、L7 互补

### A cloud-sync 续租 / 中段失败 / 并发设备竞争几乎无测试
- 位置：`packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts`、`packages/core/src/infra/cloud-sync/logic/lock.ts`；测试 `packages/core/test/cloud-sync/**`
- 问题：`cloud-sync` 只有 2 个测试文件、共 ~10 个 it。`lock.test.ts` 测了"有效锁不可抢占 / 过期锁可抢占 / buildLease / renewLease"四个纯函数行为；`coordinator.test.ts` 测了 pull / push 的 happy + `NEED_PULL_FIRST` / `LOCK_HELD_BY_OTHER` / `ALREADY_UP_TO_DATE` / snapshot 上传失败时 finally 清锁 / `forceOverwriteRemote`。**缺的都是数据安全核心场景**：(1) push 中段租约恰好过期（被另一个设备抢锁）的状态变化；(2) put 抛非业务错误（网络中断、超时）的最终状态；(3) 两个 coordinator 实例并发 push 的竞争（用同一 storage mock）；(4) `renewLease` 在真实时钟下穿越 expiresAt 的临界。
- 依据：`test/cloud-sync/**` grep `LOCK_CONTENTION|renew|expired|abort|rollback|并发` 全部 0 命中；`lock.test.ts:54,58` 用 `>=` 而不是 `>` 比对 expiresAt，注释没解释——典型的"对时钟漂移妥协"。
- 建议：至少把 push 中段租约过期的场景写成测试（mock storage 在第二次 put 时抛 `LOCK_CONTENTION`，断言 coordinator 不会留下"看似锁住实际没锁"的状态）；并发 push 竞争用 `Promise.all([pushA, pushB])` 共享 storage mock，至少一个 reject、另一个成功、最终 status 自洽。
- 涉及角度：L4 错误路径、L5 并发（cloud-sync 是 L5 必查项）

### A session-kkv / kkv 只测 happy path，且与 capture 的事务协同无测试
- 位置：`packages/core/src/service/session-kkv/**`、`packages/core/src/infra/kkv/**`；测试 `packages/core/test/session-kkv/session-kkv.service.test.ts`、`packages/core/test/kkv/kkv.service.test.ts`
- 问题：单文件 4 个 it 全是 set/get/listKeys/delete + clearDomain + clearSession + sessions.delete 级联的 happy。**没有并发 set、没有超大 value、没有 clearSession 与 truncate-tail 在同事务里的协同测试**。L4 在 `truncate-tail-wiring.ts` 里发现 `SessionKkvRepository` 已经支持 tx 构造路径，事务内的 KKV clear 与消息截断是一起的——这条事务边界没有任何单元/集成测试覆盖。
- 依据：grep `assert.rejects|transaction|并发|partial` 在 `test/session-kkv/**` 和 `test/kkv/**` 全部 0 命中。
- 建议：补 (1) KKV 单 value 上限 / 不合法 key 的 reject 路径；(2) clearSession 在外层事务回滚时 KKV 数据是否恢复（这是 L4 提的事务不变式的直接验证）；(3) 跨 domain 的 listKeys 性能 smoke（按现状注释，长 session 会累积 file_cache 条目）。
- 涉及角度：L1 持久化、L4 事务、L5 并发

### B 三套测试运行器分裂（node:test / jest / 自定义）是结构性可测性问题
- 位置：`packages/core/test/**` 用 `node:test`；`apps/mobile` 用 jest；`apps/desktop` 用 `scripts/run-tests.mjs`；`apps/cli` 用 node:test 风格
- 问题：同一段 core 逻辑在三端的测试无法共享 helper、无法共享 fixture，mock API 还不兼容（`jest.fn()` vs node:test 的 `mock.fn()`）。`Iterations/core-test-fixture-sharing` 在 core 内部已经建立了 `novelMasterTestFixture()` 这层共享 fixture（92 个测试文件使用），但跨端没有等价物——mobile 的 145 个 jest 测试用的是 RN preset + 自建 fixture，desktop 的 66 个测试用的又是另一套。**跨端 parity 风险因此被放大**：core 修一个 bug，mobile / desktop 的对应测试可能用旧 mock 断言旧行为，反而保护了过时实现。
- 依据：`apps/mobile/package.json` `"test": "jest"`；`apps/desktop/package.json` `"test": "node scripts/run-tests.mjs"`；`packages/core/test/helpers/novel-master-fixture.ts` 在 mobile/desktop 没有对应版本（grep 跨 app 目录无命中）。
- 建议：短期不可消除（RN 必须 jest、desktop 有 electron 特殊性），但应当建立一个"core 行为契约测试"子集——用纯输入/输出快照描述核心服务（message / vfs / checkpoint）的可观察行为，三端都引用同一份断言，确保行为对齐。这是跨端 parity 的最小可行保护。
- 涉及角度：L3 架构、L6 跨平台

### B 核心服务硬编码 `Date.now()`，时间相关的断言无法稳定复现
- 位置：`message.service.ts:128`（`createdAtMs: Date.now()`）、`message-checkpoint.service.ts:55`（capture 时间）、`agent-runner.ts`、`session.service.ts`、`project.service.ts`、`cloud-sync/logic/lock.ts`（`isEffectiveLock`、`buildLease`、`renewLease`）；`packages/core/src` 全目录命中 35 处。
- 问题：核心 service 把时间戳直接 `Date.now()` 写进字段，没有 Clock 注入。结果是：(1) 跨时区 / 跨秒边界的测试无法精确断言 createdAtMs；(2) `cloud-sync` 的租约过期无法在测试里"快进时钟"模拟；(3) `lock.test.ts:54-58` 用 `>=` 比对 expiresAt 是隐性妥协——任何意外时钟回拨都可能让 isEffectiveLock 判定翻转。
- 依据：grep `new Date\(\)|Date\.now\(\)|Math\.random\(\)` 在 `packages/core/src` 35 文件命中；服务构造函数没有 Clock / TimeProvider 选项。
- 建议：引入 `Clock` port（仅 `now(): number`），默认实现走 `Date.now()`，测试可注入虚拟时钟。不必全面铺开，优先改 cloud-sync lock（租约判定强时间相关）和 message.service（createdAtMs 是稳定断言的瓶颈）。Math.random 命中少（`random-uuid.ts` 已封装），影响小。
- 涉及角度：L3 架构（依赖注入）、L7 可测性

### B checkpoint-capture 性能基线断言是典型脆弱测试
- 位置：`packages/core/test/message-checkpoint/checkpoint-capture-transactional.test.ts:138-172`
- 问题：`capture 1000 文件 P95 不超过基线（800ms，CI 宽松倍率）` 这个 it 把 `maxDuration < BASELINE_MS` 作为硬断言，注释里写了"CI 宽松倍率"。但 BASELINE_MS = 800ms 是绝对值，**CI 共享 runner 的 IO/CPU 抖动、Windows defender 扫描、容器化 overhead 都可能让单次 capture 超时**。这种测试一旦红了，开发者会下意识调高 BASELINE 而不是查根因，反而成为噪音。
- 依据：文件 138-172 行直接可见；同仓库无其他性能基线测试作为对照。
- 建议：(1) 改成统计型断言——`至少 2/3 次低于单次基线 × 2`；(2) 或干脆降级为 smoke（"1000 文件 capture 不抛错"），把性能保护移到 L10 build-infra 的 benchmark 套件；(3) 至少在断言失败信息里打出所有 durations 而不只是 max。
- 涉及角度：L10 构建基础设施

### B regex 测试不覆盖 `compileRegexRule` 的 INVALID_PATTERN 与 stale pointer 边界
- 位置：`packages/core/src/domain/regex/logic/compile-regex-rule.ts`、`resolve-active-regex-rules.ts`；测试 `packages/core/test/regex/**`、`packages/core/test/domain/regex/regex-rule-update-depth.test.ts`
- 问题：3 个 regex 测试 + 1 个 domain/regex 测试覆盖了 apply 行为（chain / depth range / role scope / capture group / display vs llm）和 service.createRule 的 INVALID_ARGUMENT 拒绝。但 **`compileRegexRule` 直接抛 `INVALID_PATTERN`（正则语法错误）的分支没有单元测试**——只有 `regex-config.service.test.ts:28` 的 `rejects rule without replace or scope` 间接触发过 INVALID_ARGUMENT。`resolveActiveCompiledRules` 的 stale pointer（`activeGroupId` 指向已删 group）只在 service 那侧有 `R8: deleteGroup resets current pointer` 间接保护，**纯函数本身的 NOT_FOUND → 返回 [] 分支无单元测试**。L2-F17 还指出"无法核实 listCompiledRulesForGroup 是否缓存了 new RegExp"——这条信息也缺。
- 依据：`regex-config.service.test.ts` 全文只 1 处 `assert.rejects`；`apply-regex-rules.test.ts` 不涉及 compile 失败；`test/regex/**` 无 INVALID_PATTERN 命中。
- 建议：(1) 加 INVALID_PATTERN 单元测试（pattern: `"("` 应抛 RegexError INVALID_PATTERN）；(2) 加 stale pointer 单元测试（mock ActiveRegexRulesSource 抛 NOT_FOUND，断言返回 []）；(3) 加一组"重复 compile 同一 rule 1000 次"的 smoke，为 L2 缓存疑虑留下回归点。
- 涉及角度：L2 算法（regex 引擎是 L2 必查）

### B `testIsolationSuffix` 用 Date.now + Math.random 制造名字隔离是隐性脆弱
- 位置：`packages/core/test/helpers/novel-master-fixture.ts:40-42`
- 问题：单文件共享一个 in-memory SQLite，测试之间靠 `testIsolationSuffix()`（`${Date.now()}-${Math.random().toString(36).slice(2,8)}`）给 project/session 名加后缀来避免数据冲突。**这是隐性脆弱**：(1) Math.random 理论上可能碰撞（虽然 slice 6 位 + Date.now 让概率极小）；(2) 模式本身鼓励"测试可以共享 DB"的心态，新人写测试如果忘了加 suffix 就会污染其他 it；(3) node:test 默认并发跑文件，但单文件内 it 是顺序的，suffix 隔离因此能 work——一旦未来切到并发 it，模式会立即崩。
- 依据：fixture.ts:40-42 直接可见；92 个测试文件调用 `novelMasterTestFixture()`。
- 建议：(1) 把 suffix 改成单调自增计数器（模块级 `let counter = 0`），消除 Math.random；(2) 或者在每个 it 里用 `ctx.conn.transaction(...)` 显式回滚来隔离，而不是靠名字——更接近 dbt-test 的 snapshot 隔离模式。
- 涉及角度：L7 自身、L5 并发（未来风险）

## 覆盖声明

查了的：
- `packages/core/test/` 全部 30 个子目录的文件清单 + 重点目录（regex / bootstrap / cloud-sync / session-kkv / helpers / message-checkpoint / sql-template / vfs / agent / provider / chat）的具体测试内容
- 三端测试运行器（mobile jest 145 测试、desktop 自定义 66 测试、cli 18 测试）
- L2 / L4 发现清单中每一条都去 grep 了对应测试是否存在
- 核心服务的 `Date.now` / `Math.random` 硬编码扫描（35 命中）
- mock 使用模式扫描（28 文件，集中在协议适配器，未发现 mock 内部 repo 的反模式）
- fixture 共享模式（`novelMasterTestFixture()` 在 92 个测试文件中使用）

没查的（声明）：
- **没有跑任何测试**——本轮是 readonly 静态扫描，所有"应该会过 / 应该会红"的判断都是基于代码读+断言形状推断，未通过 `npm test` 实证。`checkpoint-capture-transactional.test.ts` 的脆弱性判断是断言形状推断，实际 CI 是否红过需要查 CI 历史。
- mobile 的 145 个 jest 测试内容未逐个核对（仅统计 + 跑了 grep）；desktop 66 个同理。
- `apps/mobile/e2e`（Appium / wdio）的 page object 完备但用例数 / 覆盖流未细读（README + setup 已扫）。
- `Iterations/core-test-fixture-sharing` 的 spec 内容未读全文，仅从 helper 文件反推；若该 Iteration 里有"跨端共享 fixture"的未完成 TODO，本报告 B 级发现应当升级。
- L2 / L4 之外的角度（L1 / L3 / L5 / L6 / L8 / L9）未交叉，相关线索放在下一节。

为什么没宣布 ready：本次是 L7 单角度首次横扫，三端测试运行器的实际运行结果未验证，mobile/desktop 测试的内容核对较粗，fixture-sharing Iteration 的 spec 未读全文，明显还需要 phase2 切片和 phase3 交叉才能给出最终严重度。

## 待交叉的线索

**→ L4（错误处理 & 事务）**：本报告的前 6 条 A 级发现里，有 5 条（agent capture 失败、setMessageFloorAtMessage、provider 跨 store、vfs 乐观锁、session-kkv 事务协同）直接对应 L4 已经标 A 的无事务路径。phase3 应当把它们合并成"L4 发现 + L7 测试缺口"的复合条目，严重度维持 A——因为"已知错且无回归保护"比"已知错"更值得优先修。

**→ L2（算法）**：sql-template 重复 parse 测试缺口（本报告 A）直接接 L2-F1；regex compile 缓存核实（本报告 B）接 L2-F10/F17。phase3 应交叉：如果 L2 后续核实在 `RegexConfigService.listCompiledRulesForGroup` 那侧确实没缓存 `new RegExp`，则本报告 B 级 regex 缺口应升级为 A，并在测试侧补"重复 compile" 的回归点。

**→ L5（并发）**：vfs 并发写、cloud-sync 并发 push、session-kkv 并发 set 三条都标了 ✗。L5 在 phase1 切片时若发现这些模块的真实并发缺陷，本报告的 ✗ 同时意味着"并发 bug 没有测试保护"，复合严重度会更高。

**→ L3（架构）**：硬编码 `Date.now()`（本报告 B）和三套测试运行器分裂（本报告 B）都是架构层选择。L3 可能辩护"运行器分裂是 RN / electron 的天然代价"——这点我同意，但 core 行为契约测试的缺失是可补救的，请 phase3 不要把"运行器分裂"整条dismiss 掉。

**→ L6（跨平台）**：跨端 parity 风险（mobile 145 jest vs core node:test vs desktop 自定义）应在 L6 切片里专门评估。本报告只标 B，但若 L6 发现 mobile 和 core 实际行为有偏差，可升级。

**→ L10（构建基础设施）**：checkpoint-capture 性能基线测试（本报告 B）应与 L10 的 benchmark 套件设计合并整改——性能保护不该塞在单元测试里。

**→ phase2 切片建议**：本报告的高优先切片候选是 (1) `agent-runner capture 失败路径测试组`；(2) `provider 跨 store 部分失败测试组`；(3) `cloud-sync 并发 / 续租测试组`。这三组测试一旦补上，会直接驱动 L4 三条 A 级发现走向修复，性价比最高。
