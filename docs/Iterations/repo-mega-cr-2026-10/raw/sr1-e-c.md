---
zone: wave-e / 组 C（钩子②④⑤⑥ + 注释承诺≠实现 + apps-desktop 债务池抽验）
agent: readonly-reviewer（sr1-e-c）
files_scanned: >
  docs/Iterations/re-mega-cr-2026-10/PLAN.md（第一章 + 第四章）、
  fix-spec/wave-e.md（H2/H4/H5/H6/C1/C2 全部条目节）、
  fix-spec/SPEC.md、fix-spec/state.md、
  ledger-v2.md §2.8/§3/§10、synth/apps-desktop.md（S-D-06/08/11/18/24）、
  docs/apm/RULE.md（主仓 + worktree 两份 + 牙齿三判据条 + 两阶段读数投递通道条）、
  packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts、
  packages/core/src/domain/prompt/model/agent-prompt-layout.ts、
  packages/core/src/domain/provider/logic/find-saved-model-references.ts、
  packages/core/src/service/provider/impl/model-request.service.ts、
  packages/core/src/infra/tokenizer/logic/chunk-splitter.ts、
  packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts、
  packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts、
  packages/core/src/domain/message-checkpoint/logic/resolve-reconcile-paths.ts、
  packages/core/src/bootstrap/chat/chat-schema.ts、
  packages/core/test/infra/tokenizer/chunk-splitter.test.ts、
  packages/core/test/message-checkpoint/rollback-empty-target-guard.test.ts、
  packages/core/test/provider/model-request-retry.test.ts、
  apps/desktop/scripts/run-tests.mjs、.github/workflows/ci.yml、
  apps/desktop/eslint.config.mjs、apps/desktop/package.json、packages/core/package.json、
  apps/cli/package.json、tsconfig.base.json、tsconfig.base/core tsconfig、
  apps/desktop/renderer/**（@novel-master/core 导入全量 grep）、
  apps/desktop/renderer/providers/ShellNavProvider.tsx、layout/ChatRail.tsx、
  shared/logic/hit-rate.ts、features/settings/AgentDefinitionEditorForm.tsx、
  packages/core/src/domain/agent/session/**（RULE 指向的 hidden 过滤目录）
---

# sr1-e-c · wave-e 组 C 只读审查报告

> 审查对象：`fix-spec/wave-e.md` 的 **H2（钩子②）/ H4（钩子④）/ H5（钩子⑤）/ H6（钩子⑥）/ C1（注释承诺≠实现）/ C2（RULE 提交项）**，
> 外加 `ledger-v2.md §3` apps-desktop 簇债务池抽验。
> 基线：`feat/repo-mega-cr` HEAD=`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`），已 `git log -1` 核对。
> 纪律：全程只读（无 git 写、未碰 `docs/apm/`、未改生产/测试代码与 fix-spec）；TS/Node 行为结论均为本机**实跑**产出。

---

## 0 · 本轮实测记录（可复现）

| # | 实跑内容 | 结果 |
|---|---|---|
| E1 | `npx tsx --eval` 调 `splitTextIntoChunks("。".repeat(200))` | `1 块 / 长度 200 / join("") 逐字还原 = true` |
| E2 | 同上，`"。\n".repeat(200)` | `1 块 / 长度 400` |
| E3 | 用 tsc 6.0.3 程序化编译 `satisfies Record<Exclude<keyof L,"persist"\|"dynamic">, null>` 三种形态 | 缺键 → **报错**（`Property 'c' is missing`）；多余键 → **报错**（`Object literal may only specify known properties, and 'zz' does not exist`）；正确形态 → 0 错 |
| E4 | `node -e` 跑 `test.todo('x', () => { throw new Error('boom') })` | **body 被执行**：TAP 输出 `not ok 1 - todo with body # TODO`（`error: 'boom'`），但汇总 `# fail 0 / # todo 1` ⇒ **失败被降级、退出码仍 0** |
| E5 | `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/nonexistent-zzz.test.ts` | 输出 `Could not find 'test/nonexistent-zzz.test.ts'`，**`EXIT=0`** |
| E6 | `Select-String` 扫 `packages/core/src` 找 `ROLLBACK_UNDO_SEND_EMPTY_TARGET` | 只命中 `errors/session-fs-errors.ts`（定义/分类器），护栏实际抛点在 `message-rollback.service.ts:159-175` |
| E7 | 主仓 vs worktree `docs/apm/RULE.md` SHA256 + 行数 + `git status` | **同一哈希 `16A5B011…94C`**，两侧均 **140 行**，`Compare-Object` 差异 **0**；主仓 `git status --short docs/apm/RULE.md` **输出为空**，`git log -1 -- docs/apm/RULE.md` = `fe79b781` |

---

## 1 · 逐条 verdict 表

| 条目 | 病症/证据核对 | 修法可行性 | 验收可测 | 依赖闭合 | 测试策略/回归线 | verdict |
|---|---|---|---|---|---|---|
| **H2 钩子②**（`wave-e.md:655-785`） | ✅ 全部核对通过：`normalize-agent-prompt-layout.ts` 函数体确在 `:54-74`；`agent-prompt-layout.ts` 接口 `:83-114` 确为 7 可选 + 2 数组；`skillsEnabled` 在 `:105`、`skillsPrefix` 在 `:110`（**行号逐字准确**）；`:100-104` 的 `resolveAgentToolRegistry` 注释确在 | ⚠️ **Step 1 机制实证成立**（E3：缺键/多键双向报错，TS 6.0.3 无兼容问题）；**Step 2 不可按字面实现**：「与 `layoutHasWorkplace`/`layoutHasCustomAttach`/… 的**实际 spread 集合**对账」在运行时不可导出——若把同一份键表再抄一遍进断言体，断言恒真，直接违反牙齿判据① | ⚠️ H2.3 ① 可跑但只验 Step 1；② 依赖那条不可实现的断言 | ✅ H2.6 与 wave-b-core2 的顺序耦合写清了（Step 1 一上就编译红） | ❌ 用例 1「构造 **7 个**可选字段」是**硬编码**的：新增第 8 个字段时编译期红 → 补进常量表后 → **再没有任何东西会红**，除非 normalize 真的处理了它。「加字段必红」的链断在第二段 | **must-fix** |
| **H4 钩子④**（`:902-1023`） | ✅ 逐字核对通过：注释 `:11-14`/`:21-22`/`:36`/`:38-42`/`:4-7` 全部在位；贪吃 `while` 确在 `:55`；`assertInvariants` 的 `chunk.length <= MAX_CHUNK_CHARS` 确在 `:22-27`；golden `"。。。！！！"` 确在 `:46`（spec 写 `:41-47` 是整个 `it` 块，成立）。**E1/E2 实测证实 `"。".repeat(200)`=1 块 200 字符、`"。\n".repeat(200)`=1 块 400 字符**，且 `join("")` 仍还原 ⇒ 病症成立 | ✅ Step 2 四处注释改写方向正确（「只订正、不删除」）；Step 3 生产零改动正确 | ✅ H4.3「删贪吃 while ⇒ E1 红 + golden 红」可跑 | ✅ H4.6 与 Wave B/C 无强耦合 | ❌ **回归线漏 4 个真实消费方**：spec 断言「消费方**只有** `apps/mobile/__tests__/mobile-prompt-token-counter.test.ts:504-506`」（该行号核对 ✓），实测 core 侧还有 `chunk-count-accuracy.test.ts`（7 处）、`serialize-tools-for-token-count.test.ts`（3 处）、`token-chunk-cache.test.ts:21`（`countRound` 里逐块 `chunkHash16`）、`chunk-splitter.test.ts` 自身。`token-chunk-cache.ts` 的生产侧**不调用** `splitTextIntoChunks`（imports 只有 `:42/:46/:47/:48/:49`，含 `hashContent`）这点 spec 说对了 | **must-fix** |
| **H5.1.1**（`:1033-1048`） | ✅ 缺口成立：`rollback-empty-target-guard.test.ts` 确 3 条，`T-DS2a` `:18` / `T-DS2b` `:60` / `T-DS2c` `:83` 逐条核对**全走 `undo_send`** | ❌ **修法方向错**：护栏条件是 `!skipVfsReconcile && plan.mode === "undo_send" && plan.targetTree.size === 0`（`message-rollback.service.ts:159-175`），而回滚到 assistant 消息时 `mode = isPlainUserUndoSendEligible(anchor) ? "undo_send" : "rewind"`（`:355-357`）⇒ **rewind 永不进这条护栏**。spec 写的「断言抛 `ROLLBACK_UNDO_SEND_EMPTY_TARGET`」在现状下**必然红** | ❌ H5.3 把 `T-DS2d` 标成「期望**绿**（护栏应当生效，先验后跑）」= 写死一个错误的期望；H5.6 用「中概率红」打补丁但没改断言体 | ✅ | ✅ 「rewind 用例放独立文件」的判据②论证成立（`novel-master-fixture.ts:14 let sharedCtx` 是模块级共享 + `node --test` 按文件分进程，两点都对） | **must-fix（重要）** |
| **H5.1.2**（`:1050-1085`） | ✅ 全部核对通过：`find-saved-model-references.ts` 三处扫描在 `:32-93`，**确无 `chat_session` 分支**；`chat-schema.ts` 的 `chat_session` 确有 `agent_config_json TEXT NULL`；**全仓 `test/**` 对 `findSavedModelReferences` 零命中**（仅 `dist/*.d.ts`、`src` 本体、`provider-model.service.ts:24/:173`） | ✅ 「只补回归、不修实现 + `test.todo` 留证」的分工正确 | ✅ | ✅ 归 wave-b-core2 | ⚠️ 用例 4 若 `test.todo` 的 body 仍会跑（见 E4），DB 副作用照常发生；可接受但需在 spec 写明 | OK（1 处行号口径修正） |
| **H5.1.3**（`:1087-1133`） | ⚠️ 机理核对通过但**数字错**：重试循环里 `onStream: options?.onStream` 每次 attempt 原样下传、**无「已产出」闩锁**（`model-request.service.ts:214-230`）✅；非 ProviderError 判可重试确在 **`:81-84`**（spec 写 `:85-88`，那几行是 abort-ProviderError 的注释，偏 4 行）。**用例数错**：spec 说「共 11 条」并「台账的 6 条…是 11 条」，但它自己列出的 `it(` 行号 `68/94/116/142/168/194/220/248/275/302` **只有 10 条**——实测逐条核对确认 **10 条**，且确实无一条用 `onStream` | ✅ 「留证不修实现」正确；T-RR-1 现状必红（`maxRetries:2` ⇒ calls=3、seen=3 ≠ 1）✅ | ⚠️ H5.2 三条定向命令 flag 不一致（①带全两个 flag、②③不带），spec 自带免责声明「实跑时一律带全」——按 RULE「Windows 两个假信号」这条，自相矛盾的命令示例本身就是复现材料 | ✅ | ❌ **牙齿自检表两行错**（见 §2） | **must-fix** |
| **H6 钩子⑥**（`:1198-1338`） | ✅✅ 证据全部实锤：`run-tests.mjs` 的 `testTargets` 在 `:27-30`（单引号在 `:30`）、`execSync` 在 `:32-35`、`shell: true` 在 `:34`；`packages/core/package.json` 的 `test`（`bash -O extglob -O globstar -c '…'`）与 `test:fast` 逐字一致；`apps/cli/package.json` 的 `tsx --test test/**/*.test.ts` 逐字一致，且 spec「cli 侧安全、勿误伤」的判断正确；**E5 实测零收集退出码为 0** | ❌ **与 Wave A 的 N-P0-02 是同一处，不是「两段」**：`ledger-v2.md:435` 的 N-P0-02 动作列已含「单引号改双引号 **+ 零收集守卫 `process.exit(1)` + `:23-26` 注释中性化**」——与 H6 Step 2 三件事逐字重合。H6.6「Wave A 改引号是止血，本条把守卫固化…**本条不应等待 Wave A**」与台账口径直接矛盾 | ❌ **H6 Step 4 的 CI 片段不可执行**：把 `runs-on: windows-latest` 写在 **step** 上（`:1281-1282`）——GitHub Actions 的 `runs-on` 是 **job 级**键，step 级会被忽略 ⇒ 该步骤照样跑在 ubuntu 上，**双 shell 门禁形同虚设**（恰是本条的核心诉求） | ⚠️ H6.6 已点出 `ci.yml` 与 X1 Step 5 / X2 Step 3 的三处改动，「分片级注记」也建议同 PR；但**没有**把「N-P0-02 ↔ H6」写进那张边界表 | ✅ Step 2(b) 的 Windows 8191 命令行长度风险与 Step 3 的收集范围 diff 风险都识别到了 | **must-fix** |
| **C1 注释承诺≠实现**（`:1341-1394`） | ✅✅ 三条全部核对通过：(a) chunk-splitter 的四处承诺已在 H4 展开且实测证伪；(b) `token-chunk-cache.ts` 生产侧确不调用 `splitTextIntoChunks`；(c) `RULE.md:13` 确写「过滤逻辑：`packages/core/src/domain/agent/session/`」，实测该目录**只有 2 个文件**，`in-memory-agent-session.ts` 文件头确为 `In-memory agent session (tests).` | ✅ 处置边界正确：`(c)` 只写注记、**不写动作**（代理禁写 `docs/apm/`），由主代理/用户改 | ✅（复用 H4.3） | ✅ | ✅ | **OK** |
| **C2 RULE 提交项**（`:1397-1437`） | ❌ **前提已失**：E7 实测主仓与 worktree 的 `docs/apm/RULE.md` **SHA256 完全相同**（`16A5B011…94C`）、**两侧均 140 行**（spec 写「118 行」，错）、`Compare-Object` 差异 0；主仓 `git status --short docs/apm/RULE.md` **输出为空**（无 `M`），`git log -1 -- docs/apm/RULE.md` = `fe79b781` ⇒ **「已在工作区但未提交」「worktree 是旧提交版、子代理会读到旧的」两条病症均不成立** | ❌ 修法（提交 RULE.md、重新 checkout/rebase）**无对象可操作**，照做会是无意义动作 | ❌ C2.4 的验收 `git status --short docs/apm/RULE.md ⇒ 输出为空` **现在就已经通过**（假验收） | ❌ C2.4 依赖段写「**必须在 Wave E 落地前完成**，否则后续 wave 读到的 RULE 仍是旧版」——该阻塞理由已被证伪 | — | **must-fix（作废）** |

**verdict 计数：OK 2 · must-fix 6**

---

## 2 · 牙齿三判据自检表（RULE「验收断言的『牙齿』三条判据」逐条过）

> 判据原文（RULE:85）：① **有牙吗**（把被测实现改成错的或整段删掉，这条会红吗？恒真的断言是废断言）；
> ② **在我的测试文件的进程/顺序/事务约束下可能恒红吗**（进程级模块标记被同文件第一条用例消费）；
> ③ **同一份夹具只服务一套期望吗**（互斥夹具 + 互斥期望挂在同一用例名上）。

### 2.1 spec 自检表复核

| 断言 | spec 自评 | 本机复核 | 结论 |
|---|---|---|---|
| **H2 Step 1** `NORMALIZED_OPTIONAL_FIELDS satisfies Record<Exclude<keyof AgentPromptLayout,…>, null>` | 双向锁成立 | **E3 实测双向成立**（TS 6.0.3，缺键报错、多余键报错）。附带：`tsconfig.base.json:17 noUnusedLocals: true` ⇒ 该常量必须被导出或被 Step 2 引用，否则 TS6133；spec 的 Step 2 恰好引用了它，链路闭合 | ✅ 判据①成立（**类型层**） |
| **H2 Step 2** `assertNormalizeCoversAllFields()` | 「遍历常量键，与实际 spread 集合对账」 | ❌ 「实际 spread 集合」**运行时不可导出**。若实现为「再抄一份键表」⇒ 删任一 spread 也不红 ⇒ **恒真断言**，正撞判据①的原型事故 | ❌ **必须改写**：改成「按 `Object.keys(NORMALIZED_OPTIONAL_FIELDS)` 逐键塞**哨兵值**→ 调 `normalizeAgentPromptLayoutDomain` → 断言哨兵全部回吐」。这样删任一 spread 必红，且新增字段只要进了常量表就自动进断言面 |
| **H2 用例 1**「全字段 layout 保值」 | 「删 skillsEnabled 的 spread ⇒ 红」 | ⚠️ 局部成立（删现有 7 个字段的 spread 会红），但**新字段场景无牙**：新增第 8 字段 → 常量表补键 → 用例 1 的输入仍是硬编码 7 字段 ⇒ normalize 丢掉新字段也**不红** | ❌ 需与 Step 2 一并泛化为「由常量表驱动」 |
| **H4 E1/E2**（`"。".repeat(200)` 1 块/200、`"。\n".repeat(200)` 1 块/400） | 「删贪吃 while ⇒ 红」，判据②「两条用例断言的是现状，已经是绿的」 | ✅ **E1/E2 实测与断言完全一致 ⇒ 落地即绿**（这是**有意的现状固化**，不是红灯）。台账 `ledger-v2.md:494` 的「当前实现下会红」指的是**把既有 `assertInvariants` 喂这组输入**——那条我实测确实红（`chunk.length=200 > 64`），两者不是一回事，spec 换了一种形态但**没写明这层口径切换** | ✅ 判据①成立；⚠️ 判据②表述成立，但 `:952` 的小标题「**先落红**」与 `:1002` 的「已经是绿的」**自相矛盾**，需统一措辞 |
| **H5.1.1 `T-DS2d`** | 状态「期望**绿**」；判据①「删掉护栏 ⇒ 红」 | ❌ 现状下护栏**根本不参与 rewind**（`mode === "undo_send"` 前置），所以：删护栏 ⇒ 用例仍绿（**无牙**）；不删护栏 ⇒ 用例**红**（**恒红的反向**）。判据①与②双双不成立 | ❌ **重写**：断言改为「rewind 空 targetTree **不抛**、文件数不变、消息按 `truncateAfterSeq = anchor.seq` 截断」，注释写明「rewind 的文件安全来自 `resolve-reconcile-paths.ts:123-130` 的 `hasDirectTargetTree` 门（无 anchor checkpoint ⇒ `directTargetPointers == null` ⇒ `hasDirectTargetTree = false` ⇒ `pathsNeedDelete` 为空），**不是** S-13 护栏」。这样锁的是**另一条真实安全机制**，判据①成立（删掉 `hasDirectTargetTree` 门 ⇒ 文件被删光 ⇒ 红）。另建议在 anchor 之后再追加一条消息，否则截断分支根本没被跑到 |
| **H5.1.2 用例 1/2** | 「删对应 SQL 段 ⇒ 红」 | ✅ 成立（`refs` 是唯一观测面，删掉 SQL 分支即空数组） | ✅ |
| **H5.1.2 用例 3/4（todo）** | 「补上 `chat_session` 分支 ⇒ 由 todo 转绿」 | ⚠️ 方向对，但 **E4 推翻 spec 的理由**：node v22.22.0 的 `it.todo(name, fn)` **会执行 fn**，失败只降级为 `# TODO`、不影响退出码。spec 两处写的「`test.todo` 的 body 不执行」是**事实错误** | ⚠️ 结论不变（仍不阻塞 CI），但论证必须改成「body 会跑、失败被降级为 TODO、不影响退出码」。副作用须写进 spec：todo 用例仍会建会话/写库/耗时 |
| **H5.1.3 `T-RR-1`（todo）** | 判据①「**删**闩锁（现状）⇒ 红」；判据②「否（todo 不执行）」 | ❌ 两栏都错：① todo 永不使 run 变红，「删闩锁 ⇒ 红」只在**删掉 `.todo` 之后**才成立；② 不是「不执行」，是「执行但失败被降级」 | ❌ **必须改写自检表**。正确表述：① 落地当天 = 无牙（`todo`）；实施日删 `.todo` 后，若闩锁被回退则 `seen.length` 变 3 ⇒ 红；② 否（失败降级不影响退出码）；③ 否 |
| **H6 守卫** | 「引号改回单引号 ⇒ 红」 | ✅ 成立，且 **E5 已实证前提**（零收集退出码为 0）。Step 2(b) 的 Node 侧收集把 `files.length > 0` 变成起子进程**之前**的同步判定，判据①比 (a) 的 stdout 正则更硬 | ✅ 判据①成立；⚠️ 判据②「收集数在真实仓库恒 > 0」成立，但**双 shell CI 步骤写错**（step 级 `runs-on`），意味着「在两种 shell 都跑一遍」这个核心验收**当前不可执行** |
| **H6 各包 `collect-check.mjs`** | 「不新增单测——守卫的测试就是②故意破坏」 | ✅ 与 RULE 判据②的原型事故一致（不重蹈同进程二次调用被模块标记挡掉），取舍合理 | ✅ |

### 2.2 「两阶段读数投递通道」条（RULE:123）与 `model-request-retry` 断言的相关性

RULE:123 的核心是「任何先给廉价值、稍后升级的 UI 读数都必须问『第二相靠什么到达 UI』，用轮询等第二相会掩盖真实 UI 没有投递通道的事实（desktop T-T9b 曾如此）」。
**与 H5.1.3 的关系：判据①同族但不是同一处。** T-RR-1 的观测面是 `adapter.chat` 的 `onStream` 回调（同源可注入的缝，正是 RULE 判据①推荐的「回调计数器优于 SQL 探针」形态），
**不是** UI 侧轮询，因此**不违反** RULE:123「别用轮询掩盖投递通道缺失」。
真正被 T-RR-1 揭出的是**上游**问题：`model-request.service.ts:214-230` 每次 attempt 复用同一个 `onStream`，
而 desktop/mobile 的 token 精确标签正是靠这条流推送（`nm:prompt/chatTokenUpdated` / `onPreciseUpgrade`）⇒ **重试会二次驱动下游的推送与计费面**。
建议 spec 在 H5.1.3 补一句注记点出这条因果链，让 wave-b-core2 补闩锁时知道影响面不止 UI 文本重复。

---

## 3 · apps-desktop 债务池抽验表（`ledger-v2.md §3`）

**口径**：§3 记 apps-desktop 簇 **P2 20 / P3 8 = 28 条**，10% ⇒ 须验 **≥3 条**；本机位抽验 **5 条（17.9%）**，覆盖 3 条 P2 + 1 条 P3 + 1 条与 wave-e 直接交叉的 P2。
**条目来源**：§3 只给计数与主题，明细在 `synth/apps-desktop.md`（S-D-05 ~ S-D-31），已逐条编号对应。

| # | 条目 | 簇/级 | 台账主张 | 逐条验证（file:line + 实测） | 定级合理 | 无重复 | 无已修 | verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **S-D-06** X1 门禁失效 | apps-desktop / P2 | `eslint.config.mjs:71-88` + `ci.yml:53-63`；9 处 renderer→core 违规；CI `continue-on-error` | ✅ `eslint.config.mjs` 的 X1 块**精确在 `:71-88`**（`{` @71 → `},` @88，`files:["renderer/**/*.{ts,tsx}"]` + `no-restricted-imports`）；✅ `ci.yml` `:57-59` Lint 带 `continue-on-error` @`:58`、`:61-63` Typecheck 带 @`:62`；✅ grep `apps/desktop/renderer/**` 得 **9 处命中 / 8 个文件**，与 S-D-06「9 条违规 8 个文件」逐一对上 | ✅ 合理（无用户可见故障） | ✅ 与 S-D-04/S-D-05 不同根因 | ✅ 未修（X1 仍是 Wave E 待办） | **confirmed** |
| 2 | **S-D-08** `exitSubagentSession` 不清 `subagentSessionId` | apps-desktop / P2 | `ShellNavProvider.tsx:590` | ✅ 坐标精确：`exitSubagentSession` 定义在 **`:590-592`**，函数体只有 `showNavView("conversation")`；全文件 `setSubagentSessionId` 仅 2 处（`:265` useState、`:583` 进入时 set）⇒ **退出路径确实不清**；✅ `WorkspaceHeaderActions.tsx` 的 `const isSubagentView = subagentSessionId != null;`（在 `:33` 附近）确把它当唯一判据 | ✅ 合理 | ✅ 与 S-D-10/S-D-11 不同根因 | ✅ 未修 | **confirmed** |
| 3 | **S-D-11** 批量删除忽略 `IpcResult.ok` | apps-desktop / P2 | `ChatRail.tsx:160-177, 249-267` | ✅ 坐标精确：`deleteSelectedProjects` 在 `:160-177`，循环体 `for (const id of ids) { await ipcProjectsDelete({ id }); }` **不判返回值**，随后**无条件** `exitProjectBatch()`；`:249-267` 是 `confirmState` 分派区（`delete-sessions-batch` @`:249`、`delete-project` @`:252`）同样只看 await 不看 ok | ✅ 合理（部分成功不可逆但非崩溃） | ✅ | ✅ 未修 | **confirmed** |
| 4 | **S-D-18** 用量统计展示层双端漂移四族 | apps-desktop / P2 | `MetricsDetailPopover.tsx:26-40`、`TokenUsageStatsView.tsx:51-64`、`shared/logic/hit-rate.ts:12`、`TokenUsageStatsView.tsx:93-98` | ✅ `shared/logic/hit-rate.ts` 存在且 `export function hitRate(` **恰在 `:12`**；实现 `if (cacheRead == null \|\| billed <= 0) return null;` ⇒ 桌面端 `cacheRead==null → null`（显示「—」）的 (c) 分叉主张**成立**；✅ 该文件头注释自认「与 `TokenUsageStatsView`/`MetricsDetailPopover` 两份同文件有实现按并（ur-ui-4），**纯搬运不改行为**」⇒ 与 (a) 的「已知待办不是 intentional」口径一致 | ✅ 合理 | ✅ | ✅ 未修 | **confirmed** |
| 5 | **S-D-24** 全簇零消费/死导出批次（索引条） | apps-desktop / P3 | `AgentDefinitionEditorForm.tsx` 1048 行零 importer | ✅ **零 importer 成立**：全 `apps/desktop/renderer` + `apps/desktop/test` grep `AgentDefinitionEditorForm`，命中 7 处**全部在该文件自身**（`:65/:66/:72/:176/:177/:178/:179`）⇒ 确无外部 importer；⚠️ **行数口径**：实测 **1047 行**（`Get-Content .Count`），台账与 wave-e X2 R3 处的「1048」多 1（疑为尾换行口径），建议统一回改为 1047 或标注口径 | ✅ P3 合理（与 §2.10/§2.8 的对抗降级结论一致：pro 给 P1、adv 给 P2、终裁归 dead-backlog 批次 3） | ✅ 与 `dead-backlog.md` 是索引关系不是重复 | ✅ 未修（Wave D 批次 3 待 ★1/★3） | **confirmed（附 1 行之差）** |

**抽验结论**：5/5 定级合理、5/5 无跨条重复、5/5 未被已落地改动消解；唯一口径偏差是第 5 条的 1048/1047 一行之差。
另记一条**债务池本身的结构缺口**（非本 5 条之内）：`ledger §3` 只有计数与主题、**没有逐条清单**，
真正可抽验的明细在 `synth/apps-desktop.md`。建议 judge 要求后续 reviewer 的「债务池抽验」统一以 `synth/<簇>.md` 的 S-xx 编号为抽验单元，并在 spec 的评审协议里写死，否则每轮 reviewer 都要重新推断「哪些条目算这一簇的 P2/P3」。

---

## 4 · must-fix 清单表

| # | 条目 | must-fix 内容 | 证据 / 实测 | 建议改法（doc-fix 可直接照抄） | 严重度 |
|---|---|---|---|---|---|
| **M1** | **H5.1.1** | `T-DS2d` 的期望状态与断言方向都错：现状下 rewind 路径**不进** S-13 护栏（`mode === "undo_send"` 前置），spec 却标「期望绿」并断言抛 `ROLLBACK_UNDO_SEND_EMPTY_TARGET` ⇒ 落地必红 | `message-rollback.service.ts:159-175`（护栏条件含 `plan.mode === "undo_send"`）+ `:355-357`（`mode = isPlainUserUndoSendEligible(anchor) ? "undo_send" : "rewind"`）；安全性实际来自 `resolve-reconcile-paths.ts:123-130` 的 `hasDirectTargetTree` 门 + `message-rollback.service.ts:401-411` | 断言改为：**不抛** `ROLLBACK_UNDO_SEND_EMPTY_TARGET`、`文件数不变`、`消息按 `truncateAfterSeq = anchor.seq` 截断`；注释点名「rewind 的文件安全来自 `hasDirectTargetTree` 门而非 S-13 护栏」；并在 anchor 之后**追加一条消息**让截断分支真正被跑到。判据①随之成立：删掉 `hasDirectTargetTree` 门 ⇒ 文件被删光 ⇒ 红 | **高**（不改则落地当天 CI 红，且把「有第二道安全机制」这一有价值的事实一并丢掉） |
| **M2** | **H6** | 与 Wave A **N-P0-02 重复**，H6.6 的「本条不应等待 Wave A」与台账口径矛盾；且 Step 4 的 CI 片段把 `runs-on: windows-latest` 写在 **step** 上（GitHub Actions 只认 job 级）⇒ 双 shell 门禁不可执行 | `ledger-v2.md:435` N-P0-02 动作列已含「单引号改双引号 + 零收集守卫 `process.exit(1)` + `:23-26` 注释中性化」，与 H6 Step 2 三件事逐字重合；`wave-e.md:1281-1282` | ① 在「分片级注记·与 wave-a 的边界」表里补一行：**N-P0-02 ↔ H6 同属 `run-tests.mjs` 同一处改动**，建议 Wave A 落最小版（改引号 + 注释中性化 + 调同一份 `scripts/lib/zero-collect-guard.mjs`），H6 只承接「通用化到 core + 各包 `collect-check.mjs` + 双 shell CI」，两者**必须同 PR 或严格有序**，守卫实现只能有一份；② Step 4 的 windows 步骤改成独立 `jobs.<id>`（`runs-on: windows-latest`）或用 `strategy.matrix`，删掉 step 级 `runs-on` | **高**（不改则两片各改同一文件、且核心验收跑不起来） |
| **M3** | **H5.1.3** | 三处事实错误：① 「共 11 条用例」实为 **10 条**（spec 自己列的行号就是 10 个）；② `isRetryableError` 的「`:85-88` 判 true」实为 **`:81-84`**；③ 「`test.todo` 的 body 不执行」**错误**，node v22.22.0 会执行 fn、失败降级为 `# TODO` 且不影响退出码 | 逐条核对 `it(` 位于 `:68/:94/:116/:142/:168/:194/:220/:248/:275/:302`；`model-request.service.ts:81-84`；E4 实跑 TAP 输出 | ① 11→10，并注明「台账的 6 条 → 实测 10 条」；② `:85-88` → `:81-84`；③ 把两处「body 不执行」改写为「body 会执行、失败被 node 降级为 `# TODO`、退出码仍 0」，并在风险表补一行「todo 用例仍会建会话/写库/耗时」 | **高**（RULE 明文「条数/行号类结论一律实测复核」） |
| **M4** | **H5.1.3 + H5.1.2** | 牙齿三判据自检表里 todo 两行判据②「否（todo 不执行）」与判据①「删闩锁（现状）⇒ 红」都不成立 | E4 | 自检表按 §2.1 的复核列改写：① 落地当天 = 无牙（todo），实施日删 `.todo` 后才有牙；② 否（失败降级，不影响退出码） | 中 |
| **M5** | **H2** | Step 2 的 `assertNormalizeCoversAllFields` 按字面不可实现有牙（运行时导不出「实际 spread 集合」），照抄键表即恒真断言；用例 1 硬编码 7 字段 ⇒ 新增第 8 字段时「加字段必红」的链在第二段断掉 | E3 证明 Step 1 的类型层守卫本身双向成立；缺口只在运行期那一半 | Step 2 与用例 1 一并泛化：**以 `Object.keys(NORMALIZED_OPTIONAL_FIELDS)` 为唯一事实源**，逐键注入哨兵值 → 调 normalize → 断言哨兵全部回吐；新增字段只要进常量表就自动进断言面。另注：`tsconfig.base.json:17 noUnusedLocals: true` ⇒ 常量必须导出或被断言函数引用 | 中 |
| **M6** | **H4** | ① 回归线漏 4 个真实消费方（core 侧 `chunk-count-accuracy.test.ts`、`serialize-tools-for-token-count.test.ts`、`token-chunk-cache.test.ts:21`、`chunk-splitter.test.ts`）；② `:952` 小标题「先落红」与 `:1002`「已经是绿的」自相矛盾；③ 未写明与台账「当前实现下会红」的口径切换 | grep 实测 4 个额外消费方；E1/E2 实测新用例落地即绿；台账 `:494` 的「会红」指的是**复用既有 `assertInvariants`**（那条确实红，已实测） | ① H4.5 回归线补齐 4 个文件（`token-chunk-cache.test.ts` 尤其重要：它逐块 `chunkHash16`，切分行为一变就大面积红）；② `:952` 改为「先落**现状固化**用例」；③ 加一句口径注记：「台账『当前实现下会红』指复用 `assertInvariants`（实测红）；本片改为新增断言现状行为的用例（实测绿），二者不冲突，理由是被 golden `:41-47` 锁定的贪吃语义不可改」 | 中 |
| **M7** | **C2** | 整条病症已被证伪：主仓与 worktree 的 `RULE.md` **SHA256 相同**、均 140 行（spec 写 118 行）、主仓 `git status` **干净**、该文件已在 `fe79b781` 提交 | E7 | 整条删除，或改写为「2026-10-01 实测：RULE.md 已随 `fe79b781` 提交，主仓与 worktree 内容一致（SHA256 `16A5B011…94C`），原『未提交/旧提交版』病症不成立」；C2.3 的三件事、`:1435` 的「必须在 Wave E 落地前完成」一并删 | 中（留着会误导 judge 排依赖） |
| **M8**（观察，非阻塞） | H5.1.2 / H5.2 / X2 | ① `chat-schema.ts` 的 `chat_session` DDL 实为 **`:17-26`**（spec 写 `:16-25`，逐字引文正确、整体偏移 1 行）；② H5.2 三条定向命令 flag 不一致且自带免责声明；③ wave-e X1 证据表 9 条 import 中有 6 条给的是「import 语句首行」而非 grep 命中的 specifier 行（`useAgentStream.ts:26` vs 实测 `:43`），约定未写明 | 实测 | 口径修正三条，写进 wave-e 的「口径修正」小节 | 低 |

---

## 5 · 结论

**组 C 判定：No-Go（本轮）** —— 证据层与机理推导质量高（E1~E5 七项实测全部对得上、行号命中率极高），但有 **3 条会直接导致执行期返工或冲突的 must-fix**：`T-DS2d` 的期望状态写反（落地必红）、H6 与 Wave A 的 N-P0-02 是同一处改动却声明「不必等待」且双 shell CI 步骤写成 step 级 `runs-on`（核心验收跑不起来）、`test.todo`「body 不执行」的事实错误污染了两条断言的自检论证；另有 C2 整条前提已被证伪（`RULE.md` 已随 `fe79b781` 提交、两侧哈希一致）应当作废。doc-fix 闭合 M1–M7 后可复审转 Go；债务池抽验 5/5 通过，不构成阻塞。

---

### 附：给 judge 的三条跨片提示（不在本组 must-fix 内，但已越界发现）

1. **wave-a 的 N-P0-02 与 wave-e 的 H6 必须归一**（M2）。`SPEC.md §2` 把「N-P0-02」分给 wave-a、把「防再犯钩子⑥」分给 wave-e，而台账 N-P0-02 的动作列本身已含零收集守卫 ⇒ 两片会改同一个 `run-tests.mjs` 的同一段。这是 judge 的职责，本报告只标注不裁。
2. **`ci.yml` 单点被四格改**：wave-a（typecheck 摘 `continue-on-error`）+ wave-e X1 Step 5（Lint 摘）+ wave-e X2 Step 3（renderer ratchet 步骤）+ wave-e H6 Step 4（零收集守卫，含 windows job）。wave-e 的「分片级注记」已建议同 PR，但没覆盖 wave-a 那一格 ⇒ 建议 judge 把四格写成一条显式的 `ci.yml` 改动清单，避免三次 CI 试错。
3. **依赖粒度提示**：`wave-b-core2.md`（SPEC §2 名为 `wave-b-core2`，磁盘上现有 `wave-c2.md` 等 6 个分片，`wave-a.md`/`wave-b-core2.md`/`wave-d.md`/`baseline.md` 尚在飞）。H2/H5 的实施侧全部落在 wave-b-core2，**该片未落地前 H2/H5 的「留证」部分可以先落、但 H2 的 Step 1 一上就编译红**，这条顺序约束 wave-e 已写清，judge 需在依赖图里把它与 SPEC §3 的全局依赖图对齐。
