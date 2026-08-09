# D2a-L7：测试 & 可测性跨模块模式识别

## 元信息

- 角度：L7 测试覆盖与可测性
- 输入：D1-07（横扫） + 全部 6 份 D2 切片（vfs / chat-message / provider-llm / agent-tool / compaction / prompt）+ D0-1（代码地图）/ D0-2（文档索引）
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly，未改动任何代码
- 产出日期：2026-08-05

## 结论（叙述式）

诶～把 L7 横扫的发现叠到 6 份切片上以后，画面比单看 D1-07 那张矩阵要更刺眼一点哦——但也更清楚。先说被纠正的部分，不然下面的模式清单不公平：D2-chat-message 在 X2 里直接证伪了 L7「`setMessageFloorAtMessage` 完全无测试」这条 A 级命中——实际上 `test/chat/message-transcript-effects.test.ts` 至少 5 个 it 块在覆盖（T-CR5/T-SF1、T-SF4、T-WEC3、role 校验、错误路径）。L7 当时 grep 的方式有问题，这条要在 phase3 收敛成「缺中间步骤失败的回归测试」，严重度从「A 完全裸奔」降到「A 但 happy path 有保护」。除了这一条，L7 的其他 A 级命中（agent-runner capture 孤儿、provider 跨 store 部分失败、vfs 乐观锁、cloud-sync 续租/中段/并发、sql-template 重复 parse、session-kkv 并发）都被切片再次确认没补上。

把确认过的缺口按模块叠起来，「关键错误路径无测试」就不再是 6 个孤立小洞了，而是同一种系统性反模式——**仓库的测试驱动模式整体偏向 happy path + 单次调用形状断言**。证据链是这样的：agent-runner 有 `captures checkpoint once after parallel mutating tools`（happy），但缺「让 capture 抛错，验证 assistant 是否落库」；chat-message 的 setMessageFloor 有 5+ it 全部断言 hidden/shown 计数与 kkv 清空（happy），但缺「第三步 clearDomain 抛错时前两步是否落库」；provider delete 只断言「删完 secret 没了」（happy），但缺「DB 删成功 secret 删失败」的孤儿；vfs 的 4 处 `expectedVersion` 全给正确版本号（happy），但缺故意给错版本触发乐观锁；cloud-sync 测了 NEED_PULL_FIRST / LOCK_HELD_BY_OTHER，但缺 push 中段租约过期。**六个模块的测试都长着同一张脸：把正常流程跑一遍、断言结果状态，然后停在那里**。failure path 不是覆盖率不够，是根本没建立——这是同一类反模式重复出现的典型形态。

更让人想小抱怨一句的是，这套反模式正好打在仓库最不该裸奔的区域：D0-2 把 vfs（17 迭代）、message+rollback（13）、agent（14）、provider（10）划成高摇摆度模块，而 L7 的测试缺口清单几乎一一对应这些区域——高摇摆度 + 测试缺口 = 每次改 bug 都没有回归网兜底，下次同类型改动还会再破一遍。`rollback-*` 系列 5 个迭代全是给「上游 append+capture 没有事务保证」擦屁股，但**没有一个补丁带「中间步骤失败 → 验证半套状态」的回归测试**——治标补丁叠了五层，回归保护零层。三套测试运行器分裂（core node:test / mobile jest / desktop 自定义）这件事本身在 D1-07 标的是 B，叠上 D2-prompt 和 D2-compaction 之后实际影响比想象中具体——`prompt-assembly-parity.test.ts` 是 Node 端序列化的产物，mobile tokenizer 走不同路径但断言无法跨端共享，跨端 parity 风险因此被放大到「mobile 修了什么 desktop 还不知道」的程度。

下面把模式列出来，最值得 phase3 优先裁决的是模式 1（关键错误路径无测试的系统性反模式）和模式 4（高摇摆度 × 测试缺口的交叉），这两条都到 S 级。

## 跨模块模式清单

### 模式 1：L4 标 A 级的「无事务多步写」全部缺「中间步骤失败 → 半套状态」的回归测试

- 类型：同一反模式多处出现 + 与 L4 复合
- 出现模块：agent-runner / chat-message（setMessageFloor 路径）/ provider-llm / vfs / cloud-sync / session-kkv（6 个）
- 共同特征：六个模块都在做 L4 已经标 A 的多步无事务写，且**测试侧全部只有 happy path**。具体形态互相印证：
  - **agent-runner**：`append(assistant) → capture → append(toolResults)` 与 `append(user) → capture`，capture 现在改成 `try/catch + throw`（D2-agent-tool B1）——可观察行为是 RUN_FAILED + partial assistant 仍落库，但**这条现状不变式没有任何 it 块钉死**。L7 原本标的「capture 失败孤儿状态无测试」经 D2-agent-tool 再次确认仍未补。
  - **chat-message setMessageFloor**：D2-chat-message X2 纠正了 L7「完全无测试」的判定（实际有 5+ it 块），但**真正缺的是「第三步 clearDomain 抛错时前两步是否已经落库」的回归**——这条 L4 的核心担忧没被任何测试捕捉。
  - **provider-llm**：delete/create/edit 跨 DB+secretStore 部分失败无测试（L7 A、D2-provider-llm S1 / A1 再次确认）；`memorySecretStore` 是无失败模式的内存实现，注入不进去。
  - **vfs**：4 处 `expectedVersion` 全部给正确版本号，**故意触发乐观锁冲突的 it 块为零**（L7 A、D2-vfs 引用确认）；`runInTransactionOrConn` 的 NESTED_TRANSACTION fallback 分支无测试。
  - **cloud-sync**：测了 happy + NEED_PULL_FIRST / LOCK_HELD_BY_OTHER + snapshot 上传失败 finally 清锁，但**push 中段租约过期、并发设备 push 竞争、网络中段抛 general Error 都没测**（L7 A 原文）。
  - **session-kkv / kkv**：4 个 it 全是 set/get/listKeys/delete + clearDomain + 级联的 happy，**clearSession 与 truncate-tail 在同事务里的协同无任何测试**（L7 A 原文）。
- 系统性根因：**仓库缺一个「失败注入 fixture」的统一模式**。证据有三层：
  1. 六个模块的失败路径无法被测，**根因不是「没人写」，而是「写不出来」**——`memorySecretStore` 没失败模式、`messageCheckpoint` 在测试里走真实 ctx 一定成功、vfs 的 `expectedVersion` 无错误序列样板可抄、cloud-sync 的 storage mock 只支持 happy。每个模块都得自己现造一套「按模式失败」的 mock，没人造过。
  2. D2-prompt §债务表里把这种模式形容成「`computeLlmExportZonesFromLayout` 仍无直接单测」、D2-compaction 把它形容成「trigger / evaluator / store 三层都缺直接单测」——同一句话在六个模块重复出现，说明这是**写测文化的系统性偏差**，不是单模块疏忽。
  3. D0-1 §测试密度统计里高复杂度模块（chat 1/6797、vfs 1/5512、agent-runner 1/42、cloud-sync 2/532）的密度本身就稀疏，叠加「测的全是 happy」之后，failure path 实际覆盖度接近零。
- 严重度：**S**（同一反模式在 6 个核心模块出现，根因是缺统一的失败注入 fixture + 写测文化偏差；与 L4 的 A 级无事务路径一一对应，复合后「已知错且无回归保护」比单看「已知错」更值得优先）
- 建议方向（不改代码）：
  - 短期：每个模块至少补一条「让 N+1 步失败 → 断言前 N 步的可见状态」的 it.todo，先把 L4 的判断变成可执行回归占位。
  - 中期：抽一个 `failing-on-pattern` 的 mock factory（参考 `memorySecretStore` 的形态，加 `failingRefs: Set<string>` 选项），让六个模块的失败注入共享同一套基建。
  - 与 L4 的整改联动：D2a-L4 模式 1 提的「跨资源写编排抽象」一旦落地，对应回归测试就跟着进——phase3 把这两条合并计分。

### 模式 2：算法侧（L2）的「重复 parse / 重复 compile」疑虑在测试侧也无保护

- 类型：同一反模式 + 与 L2 复合
- 出现模块：sql-template（infra）/ regex（domain）
- 共同特征：L2 在两个完全独立的算法模块都标过「热路径反复 parse、无 AST 缓存」性能疑虑——`SqlTemplateParser.parse` 无缓存（L2-F1）、`RegexConfigService.listCompiledRulesForGroup` 可能缓存了 `new RegExp` 也可能没（L2-F17）。L7 这边对两个模块都核查过测试：**sql-template 的 parser.test.ts / sql-template.test.ts 8 个 it 块全部只对同一模板 parse 一次**；regex 那边 `compileRegexRule` 的 INVALID_PATTERN 分支只有 service.createRule 间接覆盖一次，**没有任何 it 块「重复 compile 同一 rule」**。
- 系统性根因：与模式 1 同源——**测试驱动模式整体偏向单次调用形状断言**。「单次 parse → 断言 AST 形状」这种写法在仓库里是默认模板，但它对「加缓存 / 误删缓存 / 跨调用状态污染」这类改动**完全无感**：未来谁加上 `Map<template, AstNode[]>` 缓存，所有现有测试都会继续过；反过来谁把 parser 改成有状态，测试也不会红。
- 各模块差异：sql-template 那侧 L2 的判断更确定（无缓存是事实），L7 缺口是「重复 parse 行为保护」；regex 那侧 L2 自身还没核实是否真有缓存，L7 的缺口是「无论现状如何，测试都不会变化」——后者更隐蔽。
- 严重度：A（同一反模式在 2 个算法核心模块出现；不是 S 因为影响的不是业务正确性，而是「未来的优化 / 重构没有回归网」，但与 L2 复合后值得 phase3 一起裁决）
- 建议方向：两个模块都补一组「同一模板 / rule 连续 parse/compile 1000 次，断言每次结果一致」的行为保护测试；可选加一条性能 smoke 把「重复是常态」写进断言基线。L2 的整改和 L7 的整改可以打包成一个 PR。

### 模式 3：三套测试运行器分裂的实际跨端复用缺口

- 类型：模块间不一致（应该一致但不一致）+ god module 的跨模块影响
- 出现模块：core（node:test）/ mobile（jest）/ desktop（自定义 `scripts/run-tests.mjs`）/ cli（node:test 风格）
- 共同特征：D1-07 标 B 的「运行器分裂」在切片叠加后影响变得具体——不是抽象的「API 不兼容」，而是有几条具体的测试用例因为运行器不同**无法跨端复用**：
  1. **mock API 不兼容**：core 用 `mock.fn()`，mobile 145 个 jest 测试用 `jest.fn()`。D2-prompt 已经核实 `prompt-assembly-parity.test.ts` 是 Node 端序列化产物——同一段 prompt 装配逻辑在 mobile 端的 jest 测试无法直接拿这套断言，因为 mock 体系不通。
  2. **fixture 不互通**：core 的 `novelMasterTestFixture()`（92 个测试文件使用）在 mobile / desktop **没有对应版本**（D1-07 grep 跨 app 目录零命中）。这意味着 mobile 的 145 个 jest 测试用的是 RN preset + 自建 fixture，desktop 的 66 个用的是另一套——三端各自维护一份「core 行为快照」，互相不知道对方在断言什么。
  3. **tokenizer 路径分叉放大 parity 风险**：D2-compaction §S1 / D2-provider-llm §B1 都标了 tokenizer 三端不一致（mobile 某些模型回退到启发式、compaction trigger 又是硬阈值）——而 compaction 判定路径在 mobile 集成测试里被 stub 成 `undefined`（`apps/mobile/__tests__/agent-run.service.integration.test.ts:46`）。**mobile 集成测根本没覆盖 compaction 判定路径**，desktop / cli 的对应测试也无法跨端引用——这是运行器分裂最具体的代价。
- 系统性根因：`Iterations/core-test-fixture-sharing` 在 core 内部建立了共享 fixture，但**跨端共享层完全缺失**。这不是「不想共享」，是「RN 必须 jest、desktop 有 electron 特殊性」的现实约束叠加了「没人抽 core 行为契约层」的设计缺位。
- 严重度：A（运行器分裂本身是 L6 / L10 的现实约束，B 合理；但「跨端共享 fixture + 行为契约测试」的缺位放大了 mobile / desktop 与 core 的行为偏差风险，升到 A；不是 S 因为业务正确性不受直接影响）
- 建议方向：抽一个「core 行为契约测试」子集——用纯输入/输出快照描述 message / vfs / checkpoint / compaction 的可观察行为，三端都引用同一份断言。短期不可消除运行器分裂，但行为对齐的最小可行保护可以建立。phase3 与 L6（跨端一致性）合并裁决。

### 模式 4：高摇摆度模块 × 测试缺口的交叉——「反复改同一个 bug 但没建回归网」

- 类型：摇摆度交叉（D0-2 §1 摇摆度分级 + L7 测试缺口）
- 出现模块：vfs（17 迭代）/ message+rollback（13）/ agent（14）/ provider（10）—— L7 测试缺口清单与之几乎一一对应
- 共同特征：把 L7 的 A 级测试缺口按模块分布，再叠 D0-2 的摇摆度：
  - **vfs 17 迭代** × L7「乐观锁冲突无测试 + 并发写无测试 + NESTED_TRANSACTION fallback 无测试」
  - **message+rollback 13 迭代** × L7「setMessageFloor 中间步失败无回归（D2-chat-message X2 纠正后保留的缺口）+ agent capture 孤儿无测试 + session-kkv 事务协同无测试」
  - **agent 14 迭代** × L7「agent-runner capture 失败孤儿无测试 + abort 三分支不一致无测试（L5）」
  - **provider 10 迭代** × L7「跨 store 部分失败无测试 + SKSP 孤儿兜底机制 service 不触发（D2-provider-llm A）」
- 系统性根因：这是「局部修补无法解决全局问题」的直接证据。最典型的是 `rollback-*` 系列 5 个迭代——D2a-L4 模式 3 已经把它们按「治本 vs 治标」分了类，**4 个治标补丁没有一个带「中间步骤失败 → 验证半套状态」的回归测试**。也就是说「下游吞下上游的债」这套模式，测试侧也在「下游补 happy 测试，上游 failure path 裸奔」——结构上完全同构。每次新补丁都是先加 happy path 验收，**没有人在补丁里加「这条补丁防的 bug 长什么样」的反向回归**。
- 各模块差异：vfs 的摇摆度最高 + 测试密度最低（1/178）+ god module 集中（path-mapper 42 引用、entry.port 28、sqlite-vfs-entry.repository 24），三者叠加使 vfs 成为「全仓库测试债务最重」的区域；agent 那边因为 model mock 文化健康，密度尚可，但 failure path 与 abort 分支同样裸奔。
- 严重度：**S**（高摇摆度 4 个模块全部命中测试缺口；「治标补丁零回归」是结构性问题，会在下次同类改动时再次破）
- 建议方向：与模式 1 的整改联动——任何一个高摇摆度模块的修复 PR，必须带「这条修复防的 bug 长什么样」的回归测试作为合并条件。phase3 把这条作为「修复前置门槛」写进裁决。

### 模式 5：L7 自身的 lens 漂移——单条 A 级命中被切片证伪

- 类型：lens 漂移修正（非跨模块反模式，但对评分有结构性影响，单列）
- 出现模块：chat-message（D2-chat-message X2 纠正）
- 共同特征：L7 在 D1-07 §发现清单 §A 写「`setMessageFloorAtMessage` **完全无测试**」，原文依据是 `grep -r "setMessageFloorAtMessage" packages/core/test` 无命中。D2-chat-message 实际打开 `test/chat/message-transcript-effects.test.ts` 核实，**至少 5 个 it 块覆盖**（T-CR5/T-SF1、T-SF4、T-WEC3、role 校验、system role 抛错），方法名出现在 it 描述字符串与 `effects.setMessageFloorAtMessage(...)` 调用里，grep 应能命中——说明 L7 当时的搜索方式有问题（很可能搜的是文件名而不是内容）。
- 系统性根因：D1-07 是单角度首次横扫，grep 习惯偏向「文件名 + 函数名」而不是「测试描述字符串 + 调用点」，遇到「方法名出现在描述里但不出现在文件名里」的情况会漏判。这是 L7 单角度的方法论缺陷，不是仓库的问题。
- 影响范围：**只有这一条被纠正**。L7 其他 A 级命中（agent-runner capture 孤儿、provider 跨 store、vfs 乐观锁、cloud-sync 续租/中段/并发、sql-template 重复 parse、session-kkv 并发）经切片再次确认，未被证伪。D2-chat-message 同时指出真正的缺口是「缺中间步骤失败的回归测试」（被吸收进本报告模式 1）。
- 严重度：B（单条命中纠正，不影响整体画面；但 phase3 必须把 D1-07 §A 第二条收敛成「A 但有 happy path 保护」，不能直接照抄横扫原文）
- 建议方向：phase3 主代理在做角度合并计分时，对 L7 的每条 A 级命中都要回查对应 D2 切片是否做了证伪；本报告的模式 1 已经把「缺中间步骤失败回归」作为共性吸收，所以单条纠正是收敛而不是删除。

## 覆盖声明

读了的：

- `docs/review/phase1-lens/D1-07-testing.md` 全文（横扫原文）。
- 全部 6 份 D2 切片（chat-message / vfs / agent-tool / provider-llm / compaction / prompt）的 L7 相关段落 + 债务清单 + 与测试相关的交叉发现；D2-chat-message 的 X2（L7 证伪）和 S2、D2-agent-tool 的 B1（capture 改造后的不变式）、D2-vfs 的 §单角度引用、D2-provider-llm 的 S1/A1、D2-prompt 的 §债务表 B/C、D2-compaction 的 S1/A1/C1 都逐条对照过。
- `docs/review/guides/phase2.5-cross-module.md` 全文（指导文档）。
- `docs/review/phase0/D0-1-code-map.md` 的 god module / 测试密度段落。
- `docs/review/phase0/D0-2-docs-index.md` 的摇摆度分级段落。
- 参考已有的 D2a-L4 报告对齐输出格式与严重度判定的口径。

没读的（声明）：

- **没有再翻任何实现代码**——本阶段是 readonly 二次分析，所有「测试存在 / 不存在」的判断都基于 D1-07 与 D2 切片的现有结论。D2-chat-message X2 的纠正已被切片核实过，本报告直接采信。
- **没有跑任何测试**——L7 横扫和 D2 切片都是静态扫描，本报告也是。
- **没有读其他角度的 D2a 报告**（D2a-L1 / L2 / L8 已存在，D2a-L4 用于格式对齐）——跨角度对比是 phase3 的事，不是本报告的边界。
- D2-vfs 的完整测试用例清单、D2-compaction 的 trigger 组合细节、D2-prompt 的 Context Bundle 测试稀疏这些点都在切片里被标过，本报告按规则不重复单模块发现，只在模式 1 / 2 里吸收其共性。
- mobile 145 个 jest 测试与 desktop 66 个自定义 runner 测试的内容未逐个核对（与 D1-07 同口径）；本报告关于运行器分裂的判断是基于「跨端共享 fixture 缺失 + tokenizer 路径分叉」这两条已被切片确认的事实，不是重新核测。

为什么没宣布 ready：本次是 L7 单角度的 Phase 2.5 第 1 轮跨模块识别，没有跑测试、没有读其他角度的 D2a 报告，模式 1 与 D2a-L4 模式 1 / 模式 3、模式 2 与 D2a-L2、模式 3 与 L6 / L10、模式 4 与 D2a-L4 模式 4 都有显著交叉，明显还需要 phase3 把这些线索叠在一起才能给最终严重度。

## 给 Phase 3 的线索

- **模式 1 与 D2a-L4 模式 1 必须合并计分**：L4 的「跨资源多步写无事务」A 级发现 + L7 的「failure path 无测试」A 级发现一一对应，复合后应升到 S——「已知错且无回归保护」是仓库当前最高优先级的债。建议 phase3 主代理把这对组合作为修复路线图的入口。
- **模式 2 与 L2 复合**：L2 的 sql-template 缓存缺失（L2-F1）+ regex compile 缓存疑虑（L2-F10/F17）+ L7 的「重复 parse 无测试」是一组三连，phase3 应当裁决「加缓存」与「加重复 parse 回归」是否打包做。
- **模式 3 与 L6 / L10 复合**：跨端运行器分裂是 L6（跨端一致性）和 L10（构建基础设施）共同关心的领域；L7 这边给出的是「具体哪些测试用例无法跨端复用」（mock API、fixture、tokenizer parity），phase3 应当把这条作为「短期不可消除但可补救 core 行为契约测试」的具体整改项。
- **模式 4 是元层面的**：高摇摆度 × 测试缺口的交叉不只是 L7 的事，phase3 应当把「修复 PR 必须带反向回归」作为流程层面的裁决，写进最终修复 spec。
- **潜在冲突**：L3 可能为「运行器分裂」辩护（RN 必须 jest、desktop 有 electron 特殊性），这点 L7 同意，但**core 行为契约测试的缺位是可补救的**——phase3 不要把模式 3 整条 dismiss 掉。
- **L7 自身的纠正**（模式 5）需要 phase3 主代理在合并角度时手动收敛——D1-07 §A 第二条不能照抄，必须改成「缺中间步骤失败回归，但 happy path 有 5+ it 保护」。
