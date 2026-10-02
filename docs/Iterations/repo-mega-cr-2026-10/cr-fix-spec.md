# CR Fix Spec: mega-CR dev-loop 修复(Wave A到E) · Round 3(执行 spec 形态)

## 0 · 元信息

- repo: D:\Dev\nm-worktree\mcr (feat/repo-mega-cr)
- base_sha: fe79b781 / head_sha: 046f4d9c (19 commits: Wave A 7 / B 4 / C 3 / D 2 / E 3)
- 业务 spec: docs/Iterations/repo-mega-cr-2026-10/fix-spec/ (SPEC.md + 11 分片); 问题台账: ledger-v2.md
- 本 spec 谱系: R1 汇总形态(code-review-loop fix-spec-ready) -> **用户裁定非执行 spec** -> spec-check-loop R1 No-Go(P0x5) -> doc-fix R1(v2 七要素化) -> R2 No-Go(P0x2 照抄级) -> doc-fix R2 -> R3 No-Go(轻量 9 条) -> doc-fix R3 -> **R4 终判 Go**
- review_round: 4 / dag_version: 4
- 状态: **execute-ready(待用户确认)**
- 细节真源: raw/cr1-*.md x12。**冲突规则: 修法细节以 raw 报告段为准, 本 spec 条目为施工契约(验收/测试策略/回归线以本 spec 为准)。**

## 1 · 评审覆盖矩阵

| # | 机位 | 被审对象 | 报告 | P0/P1/P2 |
|---|---|---|---|---|
| 1 | cr-wavea | Wave A 7 commits | raw/cr1-wavea.md | 0/1/6 |
| 2 | cr-cloudsync | dc621d9a | raw/cr1-cloudsync.md | 0/2/5 |
| 3 | cr-core1 | 6ffeb5fb | raw/cr1-core1.md | 0/3/2 |
| 4 | cr-core2 | 4829b8d1 | raw/cr1-core2.md | 0/2/5 |
| 5 | cr-apps | 37df8900 | raw/cr1-apps.md | 0/1/8 |
| 6 | cr-c2 | c667be0f(C2 域) | raw/cr1-c2.md | 0/2/4 |
| 7 | cr-c1 | c667be0f(C1 域) | raw/cr1-c1.md | 0/0/8 |
| 8 | cr-c-tests | 759372c8 | raw/cr1-ctests.md | 0/2/4 |
| 9 | cr-kotlin | d68a848b | raw/cr1-kotlin.md | 0/2/3 |
| 10 | cr-dead | 496b6fd8+6594b67c | raw/cr1-dead.md | 0/0/6 |
| 11 | cr-guards | 3b4c8d9e+5fb269fe+046f4d9c | raw/cr1-guards.md | 0/5/4 |
| — | 合计(报告侧) | — | — | **0 / 20 / 55** |
| — | 合计(去重后 CR-F 位) | — | — | **0 / 19 / 54**(P1 差 1 = c2 P1-1 与 ctests P1-1 同源合并为 CR-F05; P2 差 1 = c2 P2-1 升级为 CR-F20) |

## 2 · P1 执行条目(21 条 F01-F21, 七要素; F20 并入 F06 同 commit, F21 为 OQ15 占位)

> 验收命令统一口径: core = `cd packages/core && npm test`; desktop = `cd apps/desktop && npm test`(裸跑即正确——HEAD 的 run-tests.mjs 已是双引号 glob + 内联零收集守卫, **勿再传 --test-concurrency 等参数**, extraArgs 会被拼进测试目标导致收集失败; baseline.md §6 第 3 条「Windows 收集器坏/用带参调用」是 Wave A 修复前的旧况, HEAD 已双引号化, 勿引); mobile = `cd apps/mobile && npm test -- --maxWorkers=2`(jest 包脚本可正常传参); cli = `cd apps/cli && npm test`。
> **已知红真源(判增量基准; CR-W4 收口后 2026-10-02 实测刷新)**: core 3328 tests / 4 fail(usage-stats 时区 T-C2/T-C6 + T-TC4 真分词性能 + checkpoint seed 性能——后两条满负载漂位, 隔离绿); desktop 667/667(blob flake 本轮未触发); mobile 1764 tests / 1 fail(mermaid 确定性存量; chat-transcript-webview flake 本轮未触发); cli 105/24 存量。**判增量 = 已知红总数不超且无新增位置(性能类红允许漂位)**。CR 各波新增用例已计入总数; baseline.md §4 是 base SHA(fe79b781) 快照勿引。**

### CR-F01 · 桌面换代失败路径删除唯一旧库副本 [P1|S|cloudsync P1-1]

- **位置**: apps/desktop/src/main/services/db-backup.service.ts:254-263
- **病症**: replaceLiveDatabase 有三种终态, 终态③(覆盖成功+三表恢复失败抛 DatabaseReplacedError)时 rollbackFailed 从未置 true, finally 照常 unlink(bakPath)——删掉的正是用户导入前的完整旧库(含未同步本地改动); mobile 侧 finally 从不删 bak(两端不一致)。
- **修法**: 增第三终态标记 keepBackupForManualRecovery(抛 DatabaseReplacedError 之前置位); finally 条件改 if (bakCreated && !rollbackFailed && !keepBackupForManualRecovery); 错误 message 写 bak 路径(复用 x1 §1 风险 R2 口径)。
- **验收**: `cd apps/desktop && npx tsx --test test/db-backup-rollback-safety.test.ts` 全绿, 其中 :157 那条唯一终态③用例含新断言; 手动复现见 §7-2。
- **测试策略**: 在 db-backup-rollback-safety.test.ts:157 现有用例(不得另建)补 assert.equal(existsSync(bakPath), true)——删与不删在此用例分红。
- **回归线**: db-backup-rollback-safety.test.ts 全文件; cloud-sync-pull-accounting.test.ts(终态③可达性); cloud-sync.service-lifecycle.test.ts(单例换代)。
- **依赖**: 无。**风险与回滚**: 纯增量守卫, 低风险; revert 单 commit 即可。

### CR-F02 · retryAndWait 被取代的旧 effect reject 新一代 waiter [P1|M|cloudsync P1-2]

- **位置**: apps/mobile/src/runtime/novel-master-context.tsx:259-285
- **病症**: rebootWaiterRef 是单个全局槽无归属判定; 已 cancelled 的旧 effect 收尾或 .catch 时 rejectRebootWaiter(err) 读全局 ref, 把新一代 effect 的 waiter 错误 reject——重建明明成功却报「拉取失败」, mapSdkError 兜底成误导性网络文案, lastSyncedRev 不推进。StrictMode 双调用即精确复现。
- **修法**: waiter 槽加 generation 代号(bootToken), resolve/reject 校验代际一致才兑现; retryAndWait 入口已有 waiter 时不覆盖。
- **验收**: 新增归属规则单测绿(见测试策略); mobile 全量 --maxWorkers=2 无新增红。
- **测试策略**: 把「代际一致才兑现」抽成可单测纯函数(报告建议), 用例: 旧代 reject 不影响新代 / 新代 resolve 正常 / 入口复用不覆盖; 若做 provider 层测试需 fake timers(可后置, 至少纯函数层必须有牙)。
- **回归线**: novel-master-context 既有用例; cloud-sync.service 4 条 pullCloudSync 用例。
- **依赖**: 无。**风险**: React 生命周期竞态, 修错方向会制造新的丢事件; 回滚 revert 单 commit。

### CR-F03 · T-P3 不稳定测试(setImmediate 等 setTimeout 回填) [P1|S|core1 A-1]

- **位置**: packages/core/test/workplace/template-pull.test.ts(flushDeferredBackfill)
- **病症**: flushDeferredBackfill 用 5 次 setImmediate 等 scheduleBackfill 的 setTimeout(0) 宏任务, 0ms timer 未到期时 5 次 check 同轮跑完, T-P3 前置断言(缓存域有行)间歇性红——实测 6 文件并行冷跑首轮即红。
- **修法**: 删 flushDeferredBackfill, T-P1/T-P3 两处调用点改 await settlePendingFileCacheBackfills()(load-or-fill-file-cache.ts:104 现成确定性闸门)。
- **验收**: `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/workplace/template-pull.test.ts test/workplace/load-or-fill-file-cache.test.ts test/workplace/assemble-workplace-display.test.ts test/vfs/vfs-gc-trigger.test.ts test/vfs/vfs-tree-copy-batch.test.ts test/vfs/sweep-revisions-order.test.ts` 连跑 10 次 # fail 0; 单文件 template-pull.test.ts # pass = 4 既有 + 新增(若有)。
- **测试策略**: 不新增用例(本条是修既有用例的等待方式); 可加一条注释说明为何用 settle 而非 setImmediate。
- **回归线**: template-pull.test.ts; load-or-fill-file-cache.test.ts; assemble-workplace-display.test.ts。
- **依赖**: 无。**风险**: 零(settle 函数已存在且有 JSDoc 声明测试用途)。

### CR-F04 · M-04 currentModelId 悬空链 [P1|M|core2 A-1; 拍板 OQ15]

- **位置**: apps/desktop/src/main/ipc/handlers/providers.ts:94-106 / apps/mobile/src/screens/stack/ProvidersScreen.tsx:75-88 / packages/core/src/service/provider/impl/provider.service.ts:243-252
- **病症**: 前置拒绝把 currentModelId 当软指针过滤, 注释声称三个调用方都在 delete 后 reset——实际 desktop/mobile 在 delete 之后才 getSavedById, 而 deleteByProvider 已删行, 恒 null, reset 永不执行 ⇒ currentModelId 悬空固化进新会话 agent_config_json, 发消息抛 INVALID_SAVED_MODEL_ID 且 UI 零解释。CLI 是唯一写对的调用方。
- **修法**: desktop/mobile 两处把「取 currentModelId+判归属」整块移到 providers.delete 之前(照抄 apps/cli/src/provider/commands.ts:98-102); provider.service.ts:243-252 注释改为真实契约(delete 前判定/delete 后 reset)并显式记「本过滤依赖三调用方的 delete 前置判定顺序, 改动任一须同步复核」。
- **验收**: desktop: `cd apps/desktop && npm test` 含新增用例绿; mobile: `npm test -- --maxWorkers=2` 含新增用例绿; core: provider-service B2 过滤正向用例绿。
- **测试策略**: ① desktop+mobile 各一条: 置 currentModelId=M(M 属 provider P) -> providers.delete(P) -> 断言 getCurrentModelId() 为 undefined; ② packages/core/test/provider/provider-service.test.ts 补「仅 currentModelId 引用时 delete 成功」正向用例(当前零覆盖)。
- **回归线**: provider-service.test.ts; apps/desktop/test providers handlers 既有用例; apps/mobile/__tests__ providers 相关。
- **依赖**: **OQ15**(mobile 删除死路的解除入口)未答时, 本条只修判定顺序——「会话引用阻断删除」行为保留, mobile 删不掉被引用模型的无自救出口问题登记 OQ15 处置, 不在本条偷跑。
- **风险与回滚**: 修法照抄 CLI 现成写法, 低风险; 回滚 revert。

### CR-F05 · ZIP remainingBudget 双计误杀合法包 [P1|S+M|c2 P1-1 + ctests P1-1 同源; 默认案已定]

- **位置**: packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts:105-111 + :256-275
- **病症**: remainingBudget 用「已含本条的累计值」减上限, :106 又拿本条声明值比它 ⇒ 本条算两遍; 实测 20MiB 单条 DEFLATE 与 10x3MiB(总 30MiB<32MiB 上限)全被误判 PAYLOAD_TOO_LARGE, 同内容 STORE 却通过——合法压缩包导入失败且错误码谎报超限。C2-8 引入的净负向。
- **修法(默认案: 删 :105-111 整段)**: :258 总量闸已在 readLocalEntryData 之前判过声明值, 该检查在正确实现下恒不触发, 留着只会重复犯错。(备选案「传 max - (declaredBytes - uncompressedSize)」不采用, 保留冗余分支无收益。**连带**: 删段后 decompressEntryData 的 remainingBudget 形参与 :274 实参成死参, 同 commit 一并删, 避免新增 lint warning。)
- **验收**: `cd packages/core && npx tsx --tsconfig tsconfig.test.json --test test/vfs/vfs-zip-parse-limits.test.ts`: 既有 7 条全绿 + 新增 4 条绿(见测试策略); 错误码断言按消息收窄(越限 = "exceeds limit", 误拒类 = "exceeds remaining size budget" 应不再出现)。
- **测试策略**: 补 4 条正向: ①单条 20MiB DEFLATE 解析成功且 size===1 内容逐字节相等; ②10x3MiB DEFLATE 解析成功 size===10; ③④ 两者各配 STORE 对照钉「压缩方式不影响总量判定」。
- **回归线**: vfs-zip-parse-limits.test.ts 全文件; vfs-zip-io.test.ts; character-card-import.test.ts。
- **依赖**: 无(默认案自足, 用户可改判备选)。**风险**: 删的是恒不触发分支, 行为零变化(仅误杀消失)。

### CR-F06 · 触发器 v2 守卫无索引全表扫 + CR-F20 第三升级路径 [P1|S|c2 P1-2 + P2-1 升级; 拍板 OQ11 默认案 bump 19]

- **位置**: packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:66/:86 + novel-master-bootstrap.ts:357/:114-124
- **病症**: ① blob 归零触发器的 NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash=...) 无索引——vfs_entry 只有 (scope_key,path) 索引, 每删一条 revision 全表扫, sweepRevisionsUnderScope 热路径 O(删条数 x 表行数); ② 被撤回 v18 曾把部分测试机库 user_version 推到 18, 新代码 18>=18 走快路径直接 return, 旧名无守卫触发器永不替换(缺 T-GC-UPGRADE-17-18 的 18 起点同形用例)。
- **修法(OQ11 默认案: bump 19)**: ① 补部分索引 idx_vfs_entry_content_hash ON vfs_entry(content_hash) WHERE content_hash IS NOT NULL, 随 SCHEMA_BOOT_VERSION 18->19 一并交付; ② novel-master-bootstrap.ts:114-124 注记补「19 = 救回被撤回 v18 留下的旧名触发器」。(备选案「事务外无条件段」不采用——一次动土同时闭合两病, 且免注册 runPendingSchemaMigrations。)
- **验收**: `cd packages/core && npx tsx --tsconfig tsconfig.test.json --test test/vfs/vfs-gc-trigger.test.ts`: 既有用例含 17->18 升级全绿 + 新增两条绿(EXPLAIN QUERY PLAN 断言走 idx_vfs_entry_content_hash 而非 SCAN vfs_entry; T-GC-UPGRADE-18-RECLAIM: PRAGMA user_version=18 + 只造旧名无守卫触发器 -> bootstrap -> 断言 v2 生效+旧名消失, 照 :471 同形)。
- **测试策略**: 上述两条新用例即本条主牙齿(c2 报告 K2/K3)。
- **回归线**: vfs-gc-trigger.test.ts 全文件; vfs-tree-copy-batch.test.ts; template-pull.test.ts; 全量 npm test 判增量不变。
- **依赖**: OQ11(默认案 bump 19; 用户改判则走事务外段+migration, 交付物不同)。**风险**: bump 19 影响所有库的下一次启动路径, 依赖既有升级测试网; 回滚 = revert(库已升 19 的测试机需手工降, 见风险注记)。

### CR-F07 · backfill B2 故障注入未触发(恒真三断言) [P1|S|ctests P1-2]

- **位置**: packages/core/test/message-checkpoint/backfill-transaction-scope.test.ts:133-179
- **病症**: 夹具 20 个文件全在根目录, ensureImportDirRules 对 / 直接跳过, upsertDirRule 零调用——注入的「抛错」一次都没执行, 用例退化成「导入成功+规则表空」, 把整个 ensureImportDirRules 调用删掉也绿。
- **修法**: ① 夹具加 sub/x.md 子目录; ② upsertDirRule mock 内加计数并断言 called>0; ③ 接管 console.warn 断言含 ensureImportDirRules; ④ mock 改「第一条成功写、第二条抛」, 断言规则表只有那一条、无半截行。
- **验收**: `cd packages/core && npx tsx --tsconfig tsconfig.test.json --test test/message-checkpoint/backfill-transaction-scope.test.ts` B2 两条用例绿且新断言在位。
- **测试策略**: 即修法本身(测试修测试); 注释记「WHERE scope_key = session:<sid> 是 workplace 键空间, 勿统一成 vfs 键空间」。
- **回归线**: backfill-transaction-scope.test.ts 全文件; backfill-cursor.test.ts。
- **依赖**: 无。**风险**: 零(只改测试夹具)。

### CR-F08 · AgentEditorView unresolved 态改选说谎 [P1|S|apps P1-1; 拍板 OQ5 默认案=清掉]

- **位置**: apps/desktop/renderer/features/settings/AgentEditorView.tsx:702-720(handleModelSelect) / :854-869(select value)
- **病症**: unresolvedModelId 非空时用户改选有效模型, 正常分支不清它, value 三段式第一段优先把下拉拉回哨兵项, 提示继续宣称「保存将保留原绑定」而实际落库新模型——用户主动改绑在 UI 上不可见。
- **修法(OQ5 默认案)**: handleModelSelect 正常分支补 setUnresolvedModelId(null)(与 id==="" 分支同款, 一行); 提示随之消失(产品口径: 下拉=当前生效绑定; 「原来绑的是什么」在 unresolved 初现时已见过, 不拆 originalModelId 双 state)。
- **验收**: `cd apps/desktop && npx tsx --test test/agent-editor-dirty-guard.test.tsx` 六条既有+新增一条全绿; 手动复现见 §7-4。
- **测试策略**: agent-editor-dirty-guard.test.tsx 补第七条: unresolved 态下改选有效模型 -> 下拉显示新模型、提示消失、保存载荷为新模型(apps 报告 §6-4 的原文建议)。
- **回归线**: agent-editor-dirty-guard.test.tsx 全文件。
- **依赖**: OQ5(默认案已给; 用户若要保留提示需改判拆双 state, 修法变)。**风险**: 低。

### CR-F09 · SkspModule 线程名日志位置(验收牙齿反向假信号) [P1|S|kotlin P1-1]

- **位置**: packages/sksp-android/android/src/main/java/com/novelmaster/sksp/SkspModule.kt:105/:126
- **病症**: debugLog 在 executor.execute 之前求值, 打的永远是 RN 队列线程名(mqt_native_modules), logcat 永远拿不到 nm-sksp——C1-12 验收 I4 ①必然误判「修复没生效」。
- **修法**: 两处 debugLog 挪进 executor.execute 块首行(可留 callerThread= 对照行)。
- **验收**: 代码对照: grep -n debugLog SkspModule.kt 确认日志行位于 executor.execute 块内; 真机步骤见 §7-1(Kotlin 无 JVM 测试基建, 按代码对照验收+真机, 不假装有 e2e 牙齿)。
- **测试策略**: 无自动化(既有限制, spec :1521-1526 已登记); 真机 logcat 判据: 出现 thread=nm-sksp op=encrypt|decrypt。
- **回归线**: sksp TS 侧桥接用例(android-secret-store 相关)。
- **依赖**: 无。**风险**: 零(日志挪位)。

### CR-F10 · finishStream 标记消费被闸门早退挡住(userAborted 永久残留) [P1|S|kotlin P1-2]

- **位置**: packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:465-478
- **病症**: 流读完但 call.execute().use 未退出时用户点停止 -> sseAbort 写标记+streams.remove; 读循环随后进 finishStream 命中 !containsKey 早退, :475 的 userAborted.remove 永不执行, 无异常故 handleStreamFailure 也不来——标记永久残留; 注释宣称覆盖的竞态恰被自己的代码位置挡住。
- **修法**: userAborted.remove(requestId) 挪到 containsKey 判定之前(与 handleStreamFailure「先消费后判闸」口径对齐); 原 :474-475 两行删除。
- **验收**: 代码对照(remove 在 containsKey 之前); 真机竞态验证见 §7-1(停止 20 次, userAbortedPending 归 0)。
- **测试策略**: 无自动化(Kotlin 限制同上); 真机判据见报告。
- **回归线**: llm-sse TS 侧 transport 用例。
- **依赖**: 无。**风险**: 低; 功能上本条不致错(残留不误吞, requestId 不复用), 修的是泄漏+注释诚实+验收稳定性。

### CR-F11 · run-tests.mjs ENOBUFS 诊断不可达(spawnSync error 在 status!=0 早退之后) [P1|S|wavea WA-P1-01]

- **位置**: apps/desktop/scripts/run-tests.mjs:42-56 + 046f4d9c 通用守卫同款两处
- **病症**: spawnSync 超 maxBuffer 返回 {status:null, error:ENOBUFS, stdout 被截断}, null!==0 为真先 process.exit(1), result.error?.code 永远不打印——真实原因与被截输出双失, 开发者只见无解释 exit 1。同一模式被复制进 zero-collect-guard 通用模块。
- **修法**: result.error != null 分支提到 status 判定之前: 先打「子进程异常: code; stdout 已截断(上限 maxBuffer); shell/目标」再 exit(1); status!==0 分支随后; 通用版 assertNonZeroCollected 调用点同款解耦。
- **验收**: 代码对照(两处 error 分支均在 status 分支前); 可选实证: 临时把 maxBuffer 调到 1KB 跑单文件, 确认诊断打出(验完还原)。
- **测试策略**: 不新增用例(node 脚本无测试基建); 代码对照+可选实证。
- **回归线**: desktop 全量经修后脚本跑通且非零收集(`cd apps/desktop && npm test` -> # tests=660); cli collect-check 20 文件; zero-collect-guard 对 cli 的扫描行为不变。
- **依赖**: 无。**风险**: 低(只动失败分支顺序)。

### CR-F12 · H6 零收集门禁 --if-present 只盖 cli [P1|M/L|guards P1-1; 含派生脚本连带]

- **位置**: .github/workflows/ci.yml:128-129 + 各包 package.json; **连带** packages/core/package.json:123-125
- **病症**: test:collect-guard 全仓只有 apps/cli 暴露, desktop(病灶本体, 唯一 shell:true)与 core(spec H6.2 Step 3 承诺的改造对象)被 --if-present 静默跳过——Windows runner 上 desktop 收集逻辑零执行。**连带坑**: core 的 test:msg/test:vfs/test:perf 三条派生脚本把 bash extglob(!(performance))当参数透传给 test:fast, 若新收集器不经 shell, 三条当场收集 0 条 exit 1。
- **修法**: ① desktop 加 test:collect-guard 并建 scripts/collect-check.mjs(照抄 cli 版 collectTestFiles, 扫描面对齐 run-tests.mjs:33 的三 glob; 注意纯 readdirSync 只证「文件在」, 引号语义要真验则复刻 spawn 形态起一次最小 tsx --test 单文件断言 # tests>0); ② core 建 scripts/run-tests.mjs(fs 递归 + 排除 performance.test.ts + 断言非零 + spawnSync 不经 shell), test/test:fast 改指它; **三条派生脚本同 commit 改指新形态**(如 node scripts/run-tests.mjs test/message-checkpoint --exclude performance.test.ts), 上线前逐条 diff 旧 glob 与新收集器文件清单并写进 PR; ③ 12 个驱动包至少加 test:collect-guard(不改 test 本体)。
- **验收**: 本地(cmd 近似 Windows): core 三条派生脚本各跑一次收集数>0; npm run test:collect-guard --workspaces --if-present 输出含 desktop+core 扫描行; **反向判据**: 故意把 desktop glob 改回单引号(或 core 收集目录指向不存在路径) -> 该格必须红(spec H6 Step 5 原文); CI 上 windows-latest 就位后同口径复验。
- **测试策略**: collect-check 脚本自身可加 --self-test(最小自检), 可选。
- **回归线**: cli run-tests(20 文件); desktop 全量 660(659/1 漂位口径); core 全量判增量(3296/3 口径); ci.yml 其余步骤不动。
- **依赖**: 无。**风险**: 改 core test 入口动到所有人的日常命令——diff 清单是硬门禁, 漏了会静默漏跑文件; 回滚 revert package.json+删新脚本。

### CR-F13 · X2 棘轮身份含行列号(无关行位移 78 幻影红) [P1|S|guards P1-2; 含基线重写步骤]

- **位置**: apps/desktop/scripts/check-renderer-typecheck.mjs:35/:66; 基线 apps/desktop/typecheck-renderer-baseline.json
- **病症**: 身份 = file(line,col)+code+message, 行号一变即换身份; 实测在 79 条错误的文件顶部插一行注释 -> 78 条幻影红(now 371 / baseline 371, 总数未变); --update 无条件写基线, 一次「插注释->幻影红->顺手 --update」会把真实新增错误一并洗白。
- **修法**: 身份去掉坐标只留 file+code+message(坐标仅打印定位); $comment 写明「now 是去重后身份数, 同文件同 code 同 message 的重复条目按 Set 计一条; 打印行号取该身份最后一次出现的位置(Map 覆盖)」; **基线必须同 commit 重写**: 身份形态一变, known 里 371 条带坐标身份与去坐标后的新身份全不相等, 首次运行 added=N(去重后新身份数)/resolved=371——这是口径变更不是新增错误, 须同 commit 跑 node scripts/check-renderer-typecheck.mjs --update 重写基线, 并在 commit message 写明「371->N 是去坐标口径变化, N 为去重身份数」; maxErrors 由 --update 自动写入新值, 禁手改。
- **验收**: ①自检用例绿: 固定两行样例输出喂 parseIdentities, 插前置行后身份集合大小不变; ②重写基线后 `node apps/desktop/scripts/check-renderer-typecheck.mjs` GREEN; ③注入实验: 任意 renderer 文件加一行注释 -> 棘轮仍 GREEN(幻影消失), 新增一条真错误 -> RED。
- **测试策略**: 自检用例落在 check 脚本内嵌或 apps/desktop/test/(选轻者)。
- **回归线**: renderer tsc 实跑值与棘轮一致; apps/desktop/test/shared-logic-x1.test.ts(X1 快照, 勿误删)。
- **依赖**: 无。**风险**: 基线重写是「一次性大开闸」, 必须与身份修改同 commit, 拆开必产生中间红; 回滚 = revert 脚本+基线。

### CR-F14 · pre-commit 钩子读工作区不读暂存区(可绕过) [P1|S|guards P1-3]

- **位置**: scripts/check-encoding.mjs:105-112(listStagedFiles) + :66(readFileSync)
- **病症**: --staged 模式用 git diff --cached --name-only 取文件名(对), 但随后 readFileSync 读工作区内容(错)——「暂存脏版 -> 工作区改净 -> 提交」普通工作流即可绕过, 钩子绿着过而 commit 躺 U+FFFD(实测 BYPASS CONFIRMED)。CI Encoding 步是提交后兜底, 但脏内容已进历史。
- **修法**: --staged 模式改读暂存区 blob: listStagedFiles 返回 {rel, content}, content 来自 git show :<rel>(execFileSync 不带 encoding 返回 Buffer, 天然正确; maxBuffer 64MiB 已够)。
- **验收(2026-10-02 W2 裁订)**: 隔离探针仓注入: ①暂存脏+工作区净 -> exit 1 且点名文件; ②暂存净+工作区脏 -> **exit 0**(订正——门禁本意是拦脏 blob 进历史, 工作区脏不进 commit, 判红属误伤; 原「修后必须保持」句废除); ③两向同场(暂存脏+工作区脏) -> exit 1 兜底; 全仓 --staged 跑一遍绿。
- **测试策略**: 隔离仓注入两条即牙齿(guards 报告实测手法的固化)。
- **回归线**: scripts/check-encoding.mjs 全仓扫描 0/0/0 不变; pre-commit 钩子安装路径不变。
- **依赖**: 无。**风险**: git show 对大文件的量级(64MiB 上限, 仓内最大文本远低于此); 回滚 revert。

### CR-F15 · 编码门禁 android 整段排除(Kotlin 漏扫) [P1|S|guards P1-4]

- **位置**: scripts/check-encoding.mjs:41-43(SKIP_DIRECTORIES 含 android)
- **病症**: .kt/.java/.gradle 三个后缀在 SCAN_EXTENSIONS 里是摆设——全仓 .kt 只在 android/ 下, android 目录整段跳过 ⇒ 真机运行的 MainActivity.kt/MainApplication.kt 永久脱离编码门禁, 未来 Kotlin 编码损坏畅通无阻(spec H1.3 本意只排那一个 GBK 混编的 build.gradle)。
- **修法**: android 从 SKIP_DIRECTORIES 移除, 改文件级排除 SKIP_PATH_PREFIXES 加 apps/mobile/android/app/build.gradle(实测 android 树下命中全在该文件); 排除理由合并进文件头注记。
- **验收**: 实跑 node scripts/check-encoding.mjs: 扫描面 in-scan 数增加(android 树 5 个候选文件进面), 命中仍只 build.gradle(被文件级排除), 全仓绿; 注入实验: 往 MainActivity.kt 塞一个 U+FFFD -> 红。
- **测试策略**: 注入一条(临时副本或探针)即牙齿。
- **回归线**: 全仓扫描 0/0/0。
- **依赖**: 无。**风险**: 若 android 树下未来新增混编文件会当场红(这正是想要的); 回滚 revert。

### CR-F16 · 门 C 正则只认紧贴调用(esbuild 降级换形漏数) [P1|S|guards P1-5; 含基线重测归属]

- **位置**: apps/mobile/scripts/build-webview.mjs:145-153(WEBVIEW_COMPAT_CONSTRUCTS)
- **病症**: 5 条正则不容忍分隔符, 实测 Object.fromEntries /*c*/ (a)、换行、可选链等换形全部漏检——而 WebView 产物是第三方库 es2018 降级输出, 恰是换形高发区; 门 C 现只对「我方源码原样进产物」有效, 定位未声明。
- **修法**: 5 条正则改容忍分隔符形态(Object\s*.\s*fromEntries\s*\( 等, Array.at 保持); $comment 补定位声明「门 C 只对我方源码原样进产物有效; 第三方降级/压缩形态数不到; 计算属性形态由门 A 源码面兜」; **基线重测归属**: 改正则后必须 --update-compat 重测基线(chat-transcript 37 处 replaceAll 等对空白敏感, 计数可能变), 重测 diff(旧值->新值逐构造)由本条 impl 机位跑出并写进 commit message, 禁只改正则不重测。
- **验收**: ①注入实验矩阵重跑: 注释/换行形态可检出(紧贴形态仍检出); ②4 包 clean rebuild 后门 C GREEN 且基线 diff 已记录; ③composer-input 5 构造全 0(N-P0-01 修法保持)。
- **测试策略**: 注入矩阵(6+ 形态)固化成脚本自检或手工清单。
- **回归线**: build-webview 4 包构建; webview 计数基线 JSON。
- **依赖**: 无。**风险**: 正则放宽可能让既有基线计数上升(更多形态被数到)——这正是重测的意义, 不是回归; 回滚 revert 正则+基线。

### CR-F17 · RT-01 ephemeral 路径换查找源(wire 行为变化未声明) [P1|S/M|core1 B-1; 拍板 OQ1 默认案=甲]

- **位置**: packages/core/src/service/agent/impl/agent-runner.ts:238/:421/:615-626
- **病症**: 复用分支的等价性论证(「两次读是同一张表同 filter」)在 persistMessages===false 路径不成立: ephemeral overlay 含本 run 追加的 tool_use id, 改后 gemini functionResponse 能解析到名字——方向变好但属 spec 未承认的 wire 变化, 且 ephemeral 路径零测试; :615-620 注释断言的等价性在该路径为假。
- **修法(OQ1 默认案=甲保守)**: 复用分支加门禁 stepCompactionEmitted || !persistMessages ? 走旧读法(listVisibleSessionMessages) : 复用 visibleBeforePrepare——ephemeral 路径保留每 step 全列读; :615-620 注释改写为分路径表述。(乙案=承认变化+补测+CHANGELOG, 不采用; 若用户改判乙, 本条修法与验收整体替换。)
- **验收**: `cd packages/core && npx tsx --tsconfig tsconfig.test.json --test test/service/agent/agent-runner.test.ts`: RT-1A..1D 既有四条全绿(落库路径计数仍为 0); 新增 ephemeral 用例绿: 装配 EphemeralOverlayAgentSession 断言读法注入点计数 >= 1(旧读法在用)。
- **测试策略**: 新增上述 ephemeral 用例一条(spec 风险栏未覆盖面)。
- **回归线**: agent-runner.test.ts RT 系全部; core 全量按通用口径判增量。
- **依赖**: OQ1(默认案甲; 改判乙则重写)。**风险**: 甲案保留 ephemeral 每 step 全列读(性能现状), 属已知取舍。

### CR-F18 · core2 单 commit 打包偏离记账 [P1|文档|core2 C-1; 拍板 OQ2 默认案=乙]

- **位置**: 文档三处: ledger-v2.md M-04/M-01 行 / wave-b-core2.md §0.1+§12.1 / 本 spec §4
- **病症**: spec 写死「六个 commit(C3b/C3c 独立)」硬约束, 实际单 commit 4829b8d1 打包十条——回滚粒度与 bisect 能力与 spec 承诺不符, 下游按 spec 派工会找不存在的 commit。
- **修法(OQ2 默认案=乙, 不重写历史)**: ledger-v2.md M-04/M-01 两行标注「合入形态偏离: 与 C1/C2/C3a 同 commit 4829b8d1」; wave-b-core2.md §0.1/§12.1 的「六个 commit」改「六个逻辑变更单元」+ 补一段偏离注记; (报告 cr1-core2 C-1 原推荐甲 rebase 拆分, 本 spec 改判乙, 理由: 19 commits 已过 cr-func 与基线验收, 重写收益低风险高; 用户可改判甲, 前置 = CR-F04 与 core2 B-1 先修)。
- **验收**: 三处文档一致, 无残留「六个 commit」字样(grep 六个 commit 零命中或仅剩改写后表述)。
- **回归线**: 无(纯文档)。
- **依赖**: OQ2。**风险**: 零。

### CR-F19 · M-03 归属记账 [P1|文档|core1 C-1]

- **位置**: ledger-v2.md / status.md 的 M-03 行
- **病症**: M-03 七要素写在 wave-b-core2, 但实现由 core1 的 6ffeb5fb 交付(core2 提交 37 文件不含)——按 commit 归属记账会把 core2 的 M-03 标「未做」触发重复派工。
- **修法**: ledger-v2.md 与 status.md 的 M-03 归属改指 6ffeb5fb; 顺带记一句 agent-runner.test.ts 9 行编码续作随 core1 落地。
- **验收**: 两文档 M-03 行含 6ffeb5fb; 实现与 core2 spec 逐条对齐的三点核对(报告已验, 记账即可)。
- **回归线**: 无。**依赖**: 无。**风险**: 零。

### CR-F20 · 17->18 第三升级路径 [P1 边界|并入 CR-F06 同 commit|c2 P2-1]

- 实现与验收**全部并入 CR-F06**(OQ11 默认案 bump 19 即两病同 commit 闭合; T-GC-UPGRADE-18-RECLAIM 用例见 F06 测试策略)。本条目仅保编号完整与 ledger 注记: CS-10 行补「v18 被撤回路径已由 19 收口」; ledger 注记动作归 CR-W5。


### CR-F21 · OQ15 甲案: mobile 删除死路解除入口 [P1|S/M|占位, 待 OQ15 拍板后展开]

- **位置**: apps/mobile/src/components/provider/ModelPickerModal.tsx:115-135 / apps/mobile/src/components/ui/PickerListModal.tsx:30-53(现状无 allowNone/noneLabel, 全 mobile grep modelId: null 零命中; desktop 参照 SessionDetailDrawer.tsx:629-647)
- **病症**: M-04 修好后会话引用会阻断删除, 而 mobile 无任何解除入口——选过模型 M 的会话存续期间删不掉 M 及其 provider。
- **修法(OQ15 默认案=甲)**: mobile 会话详情的模型选择器补 allowNone + 「清除会话覆盖」行(照 desktop 现成形态); 细节七要素在用户拍板 OQ15=甲后按 raw/cr1-core2.md §3 OQ-1 展开补齐。
- **验收(占位)**: 置会话模型 M -> 删除 M 所属 provider 被阻 -> 「清除会话覆盖」-> 删除成功且会话回落默认。
- **依赖**: OQ15(甲/乙/丙三案决定本条存废——乙/丙则本条改写或删除)。

## 3 · P2 分层执行(L1 展开 13 条 / L2 索引 42 条 + 流程硬约束; 13+42=55 = 报告侧 55)

### 3.1 L1 · 展开条目(带 OQ 依赖或测试牙齿, 七要素)

**L1-1 · core1/C-2 sweep 链 gc 缺口 [P2|OQ3 默认案=乙]**: 位置 vfs-tree-copy.ts:390-395 JSDoc + vfs-zip-io.service.ts:240/258 / character-card-import.service.ts:178/196 / skills.service.ts:450。病症: JSDoc 描述的「entry 指向已回收 blob」窗口已被 v2 守卫触发器关闭, 真实现状是 ref_count=0 的 blob 行残留待 gc, 而这三条链从不调 runDeferredBlobGc(另 5 处都调)。修法(乙): JSDoc 改为 HEAD 真实机理 + 三链各补一条「删除后 vfs_content_blob 无 ref_count<=0 行」用例, 用例红了再升方案甲(补 gc)。验收: 三用例绿或如实红(红则登记升级甲)。回归线: vfs-gc-trigger.test.ts(T-G2 模板链不产生残留的既有事实)。

**L1-2 · core2/C-4 M-06 可选加强段 [P2|OQ6 默认案=记不做]**: sse-parse-errors.ts 不实现 unrecognizedLineCount; 动作: wave-b-core2.md §2 修法第 3 条标注「本期不做(judge 已裁可删)」。验收: spec 标注在位。零代码。

**L1-3 · c1/P2-1 写事务 parse 口径 [P2|OQ8 默认案=a]**: 位置 sqlite-message.repository.ts:362 + message.service.ts:505-508 + wave-c1.md C1-2 R3/N-7#4。病症: 逐行 JSON.parse 进写事务且不走 mapRows, spec R3「总持有时间下降」漏算 parse 成本不成立, N-7#4「仍走 mapRows」与修法 2 打架。修法(a 零代码): wave-c1.md 两处口径订正 + listReadRefTargetsBySession JSDoc 写明「不进 mapRows 是有意的」+ truncate-after-readref-targets.test.ts T-TRUNC-RT1 注释一句。验收: 文档两处一致。

**L1-4 · c2/P2-3 backfill 段 1/2 间隙 NOT_FOUND [P2|OQ4 默认案=i]**: 位置 message-checkpoint.service.ts:126-141 + backfill-baseline-checkpoints.ts:249-300。修法(i): 现状接受(窄失败面+响亮失败), writeBackfillGap JSDoc 补「段 1 读到的指针在段 2 前可能被并发回滚/删除 GC, 属已知失败面」。验收: JSDoc 在位。

**L1-5 · apps/P2-1 LRU 与 loadIdleOlderMessages await 窗口 [P2|OQ7 默认案=in-flight 挪出]**: 位置见 raw/cr1-apps.md P2-1 段。修法: in-flight 加载标记挪出 LRU 表(改 IdleMessageView 存储形态)。验收: 上翻期间 LRU 淘汰不影响本次加载(用例: 淘汰注入+并发上翻, 页面数据仍达)。回归线: apps/mobile 会话视图既有用例。

**L1-6 · guards/P2-3 门 A 解构形态注释 [P2|OQ10 默认案=a]**: apps/mobile/eslint.config.mjs:33-36 注释改「刻意不覆盖解构形态: 局部遮蔽是合法 polyfill 写法, 一刀切误伤」。验收: 注释与实现一致。

**L1-7 · dead/P2-2 formatVfsError 孤儿 [P2|OQ9 默认案=a 恢复测试]**: apps/mobile/src/errors/format-error.ts:83-86。修法(a): apps/mobile/__tests__/format-error.test.ts(文件现存, 未被删, 现无 formatVfsError 断言)补 5 条断言且 import 改指 @/errors/format-error(5 条断言全部保留有效), JSDoc 改「暂留兼容, VFS 文案已改走 core 的 formatVfsErrorForUser」。验收: 5 条用例绿。

**L1-8 · ctests/P2-1 C2-11 S4 降级诊断契约 [P2]**: 位置 test/vfs/compute-replace-not-found-error.test.ts(零改动现状)。修法: 补一条 1MB 正文+1MB oldString 未命中用例: assert.throws vfsReplaceNotFound(错误码字面量) + details.lcsLength===0 + details.fileHintCodepoints 非空, 走公开入口。验收: 新用例绿。

**L1-9 · ctests/P2-2 H2 堆增量恒真 [P2]**: vfs-zip-parse-limits.test.ts:122-144。修法: 删堆增量断言, 注释写「本条只钉闸门存在且读声明值; 未真解压由 CR-F05 正向用例间接覆盖」(备选 fflate 注入点计数不做, 从省)。验收: H2 用例绿且注释在位。

**L1-10 · ctests/P2-3 两个回归锁文件没建 [P2]**: 修法: 补 checkpoint-in-clause-chunk.test.ts(C2-9 I3: 1200 id -> >=2 块且任一块绑定变量 <=900, 复用 sql-counting-connection) + rollback-fingerprint-lock.test.ts(C2-10 R3/R4/R5 间隙注入, 复用 transaction-probe 形态); C2-3 的 C1/C2/C3(事务内零全量读)一并落 test/service/chat/。验收: 三文件新用例全绿。回归线: backfill/rollback 系既有用例。

**L1-11 · c1/P2-3 + P2-4 真库用例与恒真断言 [P2]**: 修法: message-visibility.test.ts 补 listBySessionTailOfRole 真库用例(role 过滤在子查询内/limit 只数该 role/外层升序, ~25 行); smart-sort-rule-transaction.test.ts T-SRTX7 的 countingConn.transaction 记录 seenTx, 断言改 assert.equal(c, seenTx)。验收: 两处用例绿。

**L1-12 · kotlin/P2-2 classifyError 注释失实 [P2]**: LlmSseModule.kt:508-517 注释订正为「userAbortedHit 是锁外取出的一次性消费结果, 锁内不再读 map, R2 错位窗口未被本锁消除」(保留签名备将来复用)。验收: 注释与代码一致。

**L1-13 · guards/P2-4 门 B 白名单无理由 [P2]**: build-webview.mjs:60-127。修法: 60 条 chat-transcript 白名单换 {id, why} 结构或按来源分组块注释(vfs 工具族/search 族/schema 族/bootstrap 族), 消费侧取 .id。验收: 结构在位, 每条有 why 或所属组注释。

### 3.2 L2 · 索引条目(42 条; 施工时按流程硬约束从 raw 取细节)

**流程硬约束(执行门禁, L1 与 L2 同适用)**: 条目施工前, impl 机位**必须**先读 raw/cr1-<scope>.md 对应条目段, 把该段的修法与验收抄进本次 commit message; **raw 段与本 spec 冲突时以 raw 为准并回报主代理**。L2 索引只保证条目可定位, 不复述细节; L1 已展开但 raw 的完整证据链(实测表/注入矩阵)仍在报告侧。

**L1 波次映射**: L1-1(core1/C-2)->CR-W4; L1-2(core2/C-4)->CR-W3 文档; L1-3(c1/P2-1)->CR-W3 文档; L1-4(c2/P2-3)->CR-W4; L1-5(apps/P2-1)->CR-W4; L1-6(guards/P2-3)->CR-W5; L1-7(dead/P2-2)->CR-W4; L1-8/9/10(ctests)->CR-W4; L1-11(c1)->CR-W4; L1-12(kotlin/P2-2)->CR-W5; L1-13(guards/P2-4)->CR-W5。

**cloudsync(P2-1..5)**: P2-1 pull() 换代路径 catch 做注定失败的写(db-backup.service.ts 相邻段); P2-2 中文错误文案混内部字段名(map-cloud-sync-sdk-error.ts); P2-3 mobile ALREADY_UP_TO_DATE 记账缺 .catch(mobile cloud-sync.service.ts); P2-4 CloudSyncPullResult 未扩字段而测试读 data.databaseReplaced(ipc/类型面); P2-5 simulateOtherDevice void put 不 await(测试脆弱)。

**core1(C-3)**: writeWithRevision entry 已删分支不可达(write-with-revision.ts:62-81/:152-163, 删死分支或改真查询)。

**core2(B-1/B-2/C-2/C-3)**: B-1 model-request-retry.test.ts:420/:459 两处类型错误+根因 tsconfig.test.json rootDir 继承坏(454 错)且 CI 零测试类型检查——修法: 补齐构造+rootDir 覆盖为 "."+CI 加 npx tsc -p packages/core/tsconfig.test.json 一步; B-2 CS-08 skipped 未同步 IPC DTO(ipc-types.ts:530-534/workspace-batch-dnd.ts:32-36); C-2 CS-07 与 CS-06 同 commit 顺序约束不可二分(记账 ledger CS-07 行); C-3 B 条目三处拆两 commit(apps 先于 core 恰好安全, wave-b-core2.md §9 补顺序注记)。

**apps(P2-2..8)**: P2-2 createLruMap.get 用 hit!==undefined 判命中; P2-3 useChatTabScope TODO 措辞(缺口今天就能收); P2-4 docs/apm/RULE.md 登记没落(manager 会话与项目归属缺口, 主代理/用户落盘); P2-5 renderer 绝对锚点 411/410 过期(现 371, spec 引用改 baseline.md 当期值); P2-6 新用例 act 环境卫生; P2-7 A7b 扫描漏 apps 下 1 个文本文件; P2-8 App.tsx onClose 内联。位置均见 raw/cr1-apps.md 对应段。

**c2(P2-2/P2-4)**: P2-2 DROP TRIGGER 两条尾分号(vfs-revision-schema.ts:129/:132, 去掉零风险); P2-4 尾换行波级习惯(全仓 29 缺, 统一清理项——建议并入 H1 钩子加末字节判定或开 eol-last)+is-storage-failure.ts:20 common->infra 依赖注记。

**c1(P2-2/5/6/7/8)**: P2-2 listBySessionOffset 头投影无 spec 条目(补 C1-13 记账到 wave-c1+ledger §10); P2-5 createRules 每次新建丢 parser 缓存(smart-sort-rule.service.ts:83-85, 根连接记忆化单例); P2-6 isStorageFailure 三元两端各一份+测试重演不守接线(抽 core 共享 normalizeSmartSortImportError); P2-7 listBySessionTailOfRole 缩进顶格(message.service.ts:161, +2 空格); P2-8 三处测试名/注释与夹具不符+一处恒真断言(报告有逐处清单)。

**ctests(P2-4/P2-5)**: P2-4 T-B6c 名与断言相反+rollback.test.ts:504 void 死语句+T-I5/T-Z10 半改名; P2-4b 三条口径脆点(raw/cr1-ctests.md §3 末尾无编号 bullet, 行 128-131: backfill 段序隐含最后事务/LCS oracle 1200x1200 内存/GC 守卫自指常量补 vfs_entry 字面量锁; 另 T-AMT3 冗余断言一并清)。

**kotlin(P2-1/P2-3/P2-4)**: P2-1 catch Exception 改 Throwable(SkspModule.kt:118/:138 两处一词, Error 逃逸致 Promise 静默悬死); P2-3 导入顺序+SkspModule 末尾换行(手工, 不在门禁面); P2-3b sseConnect duplicate-requestId 的 Call 未 cancel(raw/cr1-kotlin.md §3 Should-fix 1, LlmSseModule.kt:178-182 一行补 call.cancel())。

**dead(P2-1/3/4/5/6)**: P2-1 411->371 归因错误(Wave D 只占 13, ledger/wave-d 验收措辞改; 可选固化归一差集脚本+立「ratchet 数字写直接父提交实跑值」通则); P2-3 D-101 CHANGELOG 留痕(归 CR-W5 ①); P2-4 public-api.md:76 悬空行; P2-5 prompt-block.ts 末尾换行(并入尾换行清理); P2-6 棘轮 previousMaxErrors:360 查无出处(补出处或 null, 归 guards 域随 CR-F13 同批)。

**guards(P2-1/P2-2)**: P2-1 X1 eslint 只管静态 import(结构快照测试兜住=合格, eslint.config.mjs:71 补注释防删快照); P2-2 docs/Iterations 排除 779 文件占 22%(注记补量级与「记录而非病症」)。

**wavea(WA-P2-01..06)**: WA-P2-01 RT-02 两用例测不出透传条数接错; WA-P2-02 A-14 注释行号自指失效; WA-P2-03 三处缺口清单两文件重复; WA-P2-04 parseAgentId 尾行提取重复+JSDoc 不实; WA-P2-05 nm agent create name 回落 args[0] 会把 flag 当名; WA-P2-06 desktop stdout 内存缓冲零实时输出。位置均见 raw/cr1-wavea.md 对应段。

## 4 · Spec deviations(commit 形态族)

| 偏离 | spec 要求 | 实际 | 处置 |
|---|---|---|---|
| cloudsync D1/D2 | 6-9 个有序提交, S-CS-08/09 独立 PR | 9 条全部压进单 commit dc621d9a | 并入 OQ2 一并拍板(默认记账不重写) |
| core2 C-1 | 六 commit(C3b/C3c 独立) | 单 commit 十条 | 同上 OQ2(CR-F18) |
| core2 C-2 | CS-07 须在 CS-06(wave-c2)之后 | 同 commit c667be0f(运行时成立, 不可二分) | 记账到 ledger CS-07 行(L2) |
| core2 C-3 | B 条目三处同 commit 缺一不可 | 拆 37df8900(apps)+4829b8d1(core), apps 在前恰好安全 | wave-b-core2.md §9 补顺序注记(L2) |
| M-03 归属 | core2 提交交付 | 实际 core1 6ffeb5fb 交付 | CR-F19 记账 |
| wavea D2 | A6 ①b 期望净-14 | 实测 +14/-20=净-6, 规范算式不自洽 | 规范侧改「删除面 16 行/新增注释不限」(规范文本缺陷) |
| c1 D10 | C1-3 port 签名三位置参数 | 实现用 options 对象 | 轻微偏离不改行为, 接受 |
| c1 D25 | C1-7 I7 撞号决胜验收有用例 | 零覆盖(SQL 未动) | 零风险; 补用例建议见 §8 K9 |

## 5 · 待拍板 OQ 分拣(默认案随表; 阻塞=未答则对应条目不可施工)

| 类别 | OQ | 议题 | 默认案 | 阻塞条目 |
|---|---|---|---|---|
| **阻塞** | OQ1 | RT-01: 保守门禁(甲) or 承认+CHANGELOG(乙) | **甲** | CR-F17 |
| **阻塞** | OQ2 | commit 打包偏离: rebase(甲, 报告原推荐) or 记账(乙) | **乙**(改判已注明) | CR-F18 |
| **阻塞** | OQ3 | 三条 sweep 链: 补 gc(甲) or 口径+用例先行(乙) | **乙** | L1-1 |
| **阻塞** | OQ4 | backfill 间隙: i 现状+JSDoc / ii best-effort / iii 预检 | **i** | L1-4 |
| **阻塞** | OQ5 | 模型下拉口径: 清 unresolvedModelId or 拆双 state | **清掉** | CR-F08 |
| **阻塞** | OQ6 | M-06 可选加强段 | **记不做** | L1-2 |
| **阻塞** | OQ7 | LRU 窗口: null 兜底 or in-flight 挪出 | **in-flight 挪出** | L1-5 |
| **阻塞** | OQ8 | 写事务 parse: 改文案(a) or 登记债务(b) | **a** | L1-3 |
| **阻塞** | OQ9 | formatVfsError: 恢复测试(a) or 删函数(b) | **a** | L1-7 |
| **阻塞** | OQ10 | 门 A 解构: 改注释(a) or 真拦(b) | **a** | L1-6 |
| **阻塞** | OQ11 | F06/F20 交付路径: bump 19(a) or 事务外段(b) | **a bump 19** | CR-F06/F20 |
| **阻塞** | OQ15 | M-04 后 mobile 删除死路: 甲补 allowNone / 乙降软引用 / 丙 toast | **甲** | CR-F04(形态) + CR-F21(占位, 拍板后展开) |
| 不阻塞 | OQ12 | Linux typecheck 补跑 or 信任 CI | 信任 CI | 无 |
| 不阻塞 | OQ13 | Lint 步: 补 mobile 清账 or 改注释实况 | 改注释 | 无 |
| 不阻塞 | OQ14 | build.gradle mojibake 纳入 A7b? | 不纳入 | 无 |
| 不阻塞 | OQ19 | ledger CS-10 定级行同步 | 核对改写 | 无(纯文档, 随 CR-W5) |
| 不阻塞 | OQ20 | check-ci-gates.mjs 固化 | 固化 | 无 |
| 绑 CR-W5 | OQ16 | B1-7 定级(待探针) | 待探针——**阻塞 CR-W5 CHANGELOG ②, 不阻塞其它** | CR-W5 |
| 绑 CR-W5 | OQ17 | B1-8 断言 F 实测数(待实跑) | CR-W4 补测时实跑, 禁引既有数字 | CR-W5 |
| 登记 | OQ18 | c2 域边界(分片补偿失败语义) | 本轮不判, 下轮 CR 域分配输入 | 无 |

> 阻塞类 OQ 的默认案已内嵌到对应条目修法; 用户整表确认后即可全量开工, 单条改判则重写对应条目。

## 6 · 已豁免(用户确认不修)

无(12 份报告均未收到豁免指示)。

## 7 · 合并后 QA(manual_user)

1. **Kotlin 真机项**(CR-F09/F10 + C1-11/C1-12 验收): Metro 真实路径 + adb install -r -d + 永不卸载; nm-sksp 线程名日志 / 停止按钮竞态 20 次 / userAbortedPending 归零 / kill -3 栈帧。完整步骤 raw/cr1-kotlin.md 各条尾。
2. **桌面 CR-F01**: 构造覆盖成功+三表 restore 失败(cloud-sync-pull-accounting.test.ts:222 手法), 确认 .nmbackup.bak 在报错后还在。
3. **移动端 CR-F02**: 云同步拉取中触发 retry/重启, 观察是否还有误导性「云存储连接失败」文案。
4. **CR-F08**: 桌面 unresolved 态改选有效模型, 下拉/提示/保存载荷三处一致。
5. mobile 全量须 --maxWorkers=2; desktop 裸 `npm test` 即正确(勿传 flag, 见 §2 头部口径); guards CR-F12 反向判据须 windows 形态(CI 或本地 cmd 近似)。

## 8 · K 节建议(下游执行时闭合)

15. K15(W4 新发现): zip/角色卡导入的 compensate() 补偿路径(独立事务跑 releaseAndDeleteVfsPrefix)同样留 ref_count<=0 blob 残留——失败路径低频且随后抛错, L1-1 甲案只补了段 B0 后 gc; 若要闭合给 compensate 也补一次 runDeferredBlobGc。
16. K16(W4 转交): c1 P2-8 的 session.service.ts JSDoc 补「修法 3(yieldFn 透传)本波未做, deleteSessionTree 仍是同步 parse」一句——A 路受只动 test 约束转 W5。
14. K14(W2 新发现): packages/tdbc-conformance 的 test 脚本是收集 0 文件的存量空跑假绿(无 test/ 目录, tsx --test test/**/*.test.ts 退出码 0)——N-P0-02 同族, 单独立条收口。

1. K1(cloudsync): invalidateDesktopCloudSyncService 零消费属预期, 注释写明 knip 报未用是预期。
2. K2(cloudsync): acquirePushLock @deprecated 零引用, 下轮死码批删。
3. K3(cloudsync): PushAgentMutex 符号名「agent」半空, 并入 X1 收口评估。
4. K4(cloudsync/core2 B-1): apps/desktop 无 tsconfig.test.json, 评估补齐纳入 CI(core 的在 L2 core2/B-1 修)。
5. K5(cloudsync): getToPath「整包进内存」注释两处失实, 注释诚实化收口。
6. K6(apps): 全仓 spec 基线绝对数字统一改引用 baseline.md 当期值或相对表述。
7. K7(apps): 「新引入有界容器是否打断跨 await 读改写」核对项进 RULE。
8. K8(dead): 删除类 commit 声明 ratchet 数字必须写直接父提交实跑值。
9. K9(c1): 补 C1-7 I7 撞号决胜用例(两条同 sortOrder -> listOrdered; 零风险)。
10. K10(c1): message.port.ts 四个窄读口相邻排布+各一句用途注释。
11. K11(c2): parser.ts astCache 跨调用 arity 无界, 登记 Wave D/E 债务。
12. K12(core1): sqlite-vfs-entry.repository.ts:930 注释补 4 空格。
13. K13(guards): 门 A 是 CI 不拦的半门禁, mobile lint 收口时同步转 blocking。

## 9 · 执行编排(CR-W1..W5; 每波含验收判据)

**通用判据(每波都跑)**: 波内涉及包按 §2 头部的统一口径命令跑全量, 对照已知红清单判增量(新增红=0); 波收口时主代理统一提交(子代理禁 git 写, 沿 dev-loop 纪律)。

- **CR-W1(正确性小修)**: CR-F01/02/03/04/05/**06+20**/07/08/09/10/11 —— 无相互依赖, 可 4-6 路并行(F06+F20 强制同一路机位同 commit)。
  验收: 各条目自带验收命令全过 + 按通用口径四包判增量(core 3296/3、desktop 660/659/1(漂位口径)、mobile 1744 已知红<=2 且无新增位置、cli 105/24); F04 若 OQ15 未答, 验收不含 mobile 解除入口(CR-F21 待展开)。
- **CR-W2(门禁工程)**: CR-F12/13/14/15/16 —— 全动 scripts/ 与 ci.yml, **单机位串行**(冲突面大); F13 含基线同 commit 重写; F16 含基线重测 diff 记录。
  验收: F12 三条派生脚本收集>0 + 反向注入红; F13 注释注入 GREEN + 真错误 RED + 基线重写后 GREEN; F14 隔离仓两向注入红; F15 全仓绿 + Kotlin 注入红; F16 注入矩阵检出 + 4 包 GREEN + 基线 diff 在 commit message; CI 文件 yaml 合法(node -e 解析或 actionlint 若有)。
- **CR-W3(拍板后+文档批)**: CR-F17(等 OQ1)/CR-F18+F19(文档, 等 OQ2 或直接按默认案) + L1-2(M-06 记不做标注) + L1-3(c1/P2-1 spec 口径订正)——两文档条目随 W3 一并落。
  验收: F17 新旧用例绿; F18/F19 grep 验证文档一致。
- **CR-W4(测试牙齿补齐+轻量源码)**: L1-8/9/10/11(ctests P2-1/2/3 + c1 P2-3/4) + L1-1(JSDoc+用例) + L1-4(JSDoc) + L1-7(补测试) + L1-5(apps src: IdleMessageView 存储, 按 L1 波次映射) + c1 P2-5/6/7/8 + ctests P2-4/P2-4b + wavea WA-P2-01 等 L2 测试类 —— 三路并行(多数只动 test/, L1-5 单独走 mobile src 路线)。
  验收: 新用例全绿; core 判增量不变(新增 pass 计入); OQ17 的 B1-8 实测数在本波跑出。
- **CR-W5(P2 扫尾+文档+CHANGELOG)**: 其余 L1/L2 按条目; CR-F19 已在 W3 则本波补 ledger 注记; **CHANGELOG 三处留痕**: ① dead P2-3 的 D-101 删除告知(含 git checkout 恢复路径) ② core1 K-2 的 B1-7/B1-8 复活语义 + B1-5 哨兵(**前置 OQ16 探针**) ③ core2 K-2 的 summarizeToolInput/M-01/CS-08 三条; 若 OQ1 改判乙再加 RT-01。
  验收: L2 流程硬约束履行(每条 commit message 含 raw 抄录); CHANGELOG 三段在位; OQ20 的 check-ci-gates.mjs 与 F12 同批落地。
- **依赖注记**: CR-F04 与 core2 B-1(L2)先于任何 rebase(OQ2 若改判甲); F06+F20 同 commit(OQ11); F16 排 webview 改动最后; F13 基线重写禁拆 commit。

## 10 · 状态

- 2026-10-02 R1: 11 路 review-scope 落盘 -> cr-fix-spec v1(code-review-loop fix-spec-ready)。
- 2026-10-02 用户裁定 v1 非执行 spec -> spec-check-loop 启动。**R1 审查 No-Go**(P0x5: F13 基线 371 假红未写重写步骤 / F12 派生脚本断链 / P1 全缺五要素 / P2 是索引 / 波次无验收判据; P1x6; P2x4 含一条误报已核: 矩阵 core2 行磁盘实为 0/2/5)。
- 2026-10-02 doc-fix R1: v2 —— P1 七要素化+P2 分层+OQ 分拣+波次判据。R2 审查 No-Go 但判「形态已达 execute-ready」: P0x2(desktop 验收命令在 HEAD 不成立/已知红真源指错)+P1x5, 全为照抄级。
- 2026-10-02 doc-fix R2: 通用口径重写(裸 npm test+勿传 flag+双真源注+mobile flake 漂位注)/CR-F21 占位/L2 计数 43/L1 纳入硬约束+波次映射/F05 死参连带/F13 added=N 口径。R3 审查 No-Go(轻量, 9 条单行): F17 残留 3291/3、L2 计数三处不一(实列 42)、ctests P2-5 与 kotlin P2-4 编号不存在、L1-1/4/5/7 波次与 W4「只动 test/」打架、CR-F21 路径/L1-7 文件名/§2 条数/头部元信息。
- 2026-10-02 doc-fix R3: 上述 9+2 处全清(L2 定数 42; P2-4b/P2-3b 锚点化; W4 扩容容 src)。**R4 终判: Go**(11 处闭合全核验; 4 条一行润色——头部元信息/desktop 660/659/1 实数/baseline §6.3 旧况指针/W3 补 L1-2/L1-3 与 L1-13 定 W5——已同批清掉)。
- 状态: **execute-ready, 待用户确认开工**。
- 已知解释(登记不修): npm test -- <不存在的路径> exit 1 属可接受行为(cr1-wavea §2-3)。
