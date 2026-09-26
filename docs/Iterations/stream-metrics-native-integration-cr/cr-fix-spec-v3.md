# CR Fix Spec v3（第 1 轮集成评审遗留）: stream-metrics-native 敏捷项收口 + v2 文本订正

> 本文件是**增量第二轮 CR 的执行后复审**产物（`cr-fix-spec-v2.md` 已执行完毕、状态 dev-ready，本轮**不回滚、不推翻**它的任何落地结论）。本轮共 **12 条 must-fix（P0 × 0 / P1 × 1 / P2 × 11）**，其中 **10 条是实现或文档的实质改动**、**2 条是对 v2 自身文本的订正**（`metrics-exec-3` / `ctx-exec-2`）。
>
> **本轮只改文档**：新建本文件 + 订正 v2 的一处（`full2/E-1` 改法 #1 的旧行号）。**不改任何实现代码、不跑门禁、不做 git 写。**
>
> ⚠️ **行号免责（写死，K 节第 9 条同款纪律）**：本文件里出现的所有行号**一律以 `git grep` 实查为准**。**本文件自身落盘后行号同样会漂移**——v3 修订轮（F-4）已经因此改掉了本文件两处**自指行号**（元信息里对 v2 `:739` / `:746` / `:749` 与 `:11` / `:18` / `:967` 的指认，落盘后真值已漂成 `:739` / `:747` / `:750` 与 `:11` / `:18` / `:968`），现改成「锚点句 + 参考真值」双写。**下游做行号类验收时不要把本文件的行号当权威，去实查。**
>
> ⚠️ **代码侧行号的第二类漂移（v3 收尾轮补记）**：本文件引用的 `useAgentStreamMetrics.ts` / `session-stream-unit.ts` 行号也会因**后续波次改注释**而整体位移——wave-1 在 desktop hook 的注释上增删了行，那批锚点**整体 +2**、mobile `session-stream-unit.ts` **+1**。凡是这批行号，本文件与 v2 均已按 **wave-1 落盘后的现值**同步（`recomputeCompletionTokens` 定义 `:202` / 读值合成 `:204` / 重锚 `:301` / tick `:246` / 两次调用 `:272`、`:287`、依赖 `:278`、`:293`；mobile `:642` / `:1108`）。**行号以 `git grep` 实查为准，本文件落盘后可能漂移**——**符号名（`recomputeCompletionTokens` / `composeStreamTokens` / `reanchorStreamTokenBase`）才是权威锚点**。
>
> **文档订正已落盘（由前一轮 spec-fix 节点一并做完，下游勿重复改）**：该轮授权范围内的**十二处文档订正已实际落盘 = v2 七行 + 敏捷项留痕文档五处**——
> **v2 七行**：① `full2/E-1` 的「**改法 #1**」（旧行号同步为回填段真值，**v3 修订轮 F-3 补记**，前一轮只改了一半）；② `full2/E-1` 的「**文件**」栏；③ 「**条件改法 #3**」；④ 「**验收命令**」（这三行是 `metrics-exec-3`，前一轮已落）；⑤ 元信息「**执行后 HEAD**」行；⑥ 元信息「**状态**」行；⑦ Closure 表「**执行状态**」行（这三行是 `ctx-exec-2`，前一轮已落）。
> **敏捷项留痕文档五处**：⑧ ⑨ `prd.md:59` / `prd.md:61`（`agile-5` 计数）；⑩ `prd.md:32`（`agile-5` 不覆盖清单）；⑪ `spec.md:47`（`agile-1` 口径订正）；⑫ `spec.md:78`（`agile-3` R1 段补 desktop 侧口径）。（**v3 修订轮把这五处的行号一并订正成落盘后的真值**——前一轮写的是插入新行之前的 `:58` / `:60` / `:31` 与 `:76`。）
> 下游执行节点负责的是**其余条目的代码 / 测试 / 文档改动**，以及对本文件已落盘那十二处的**人工对读确认**。
>
> ⚠️ **本轮（v3 修订轮）未落盘的部分（防下游重复改 / 防下游漏改）**：⑤ `spec.md:63` 的用例条数副本（`agile-5` 改法 #4 / F-5）、⑤ `prd.md:58` 与 `spec.md:63` 的 core「6 → 7」（`agile-1` 遗留 / F-11）、`spec.md:78` 的 mobile 侧口径一行（`agile-3` 改法 #6 / F-10）、全仓 10 处单位倒置（`units-1` / F-08）、v2 三处事实链的**枚举补全**（`ctx-exec-2` 改法 #3 / F-4）——**这五组都留给下游**，本轮对这五组**一个字都没改**（本轮只改了本文件自身的 N-1 ~ N-9 那九处文本，见下）。
>
> 📖 **本文件三个时间词的口径（写死，避免读者把「谁做的」搞混）**:
> - **前一轮 spec-fix 节点** = 负责落盘上面那**十二处文档订正**的节点（下游**不要重复做**那十二处）；
> - **本轮（v3 修订轮）** = 本文件自身的文本修订轮，含两批：**F-1 ~ F-12**（修 must-fix 条目自身的表述，照做会闭不干净的那些）与 **N-1 ~ N-9**（修 fix-spec 自身的纯文本瑕疵）。**两批都只改 `cr-fix-spec-v3.md` 这一个文件**，不碰实现代码、不碰 v2、不碰 `mobile-perf-2026-09/**`；
> - **前一轮** = 相对「本轮」的上一轮，即**产出本文件初稿 11 条**的那一轮（凡文中说「前一轮写的是旧行号 / 前一轮只改了一半」，指的都是它）。
> ⚠️ **N-1 ~ N-9 为第 3 轮评审发现的 fix-spec 自身文本瑕疵，已在本轮直接落盘，无需下游执行**；它们**不计入** must-fix 计数——**must-fix 仍是 12 条（P0 × 0 / P1 × 1 / P2 × 11）**，Spec deviations 仍 **5 行**、Open questions 仍 **10 条**，三项计数**均不因本轮收口而变动**。

## 元信息

- **repo**: `D:\Dev\Js\novel-master\.worktree\i-stream-metrics-native`
- **branch**: `integration/stream-metrics-native`
- **base_sha**: `5c63d27e`（v2 执行前的 base）
- **head_sha**: `f4cd067a`（本轮**评审范围**的 head；执行后的 HEAD **不是**本字段，以 `git log -1` 为准）
- **prd_path / spec_path**（本批相关业务文档，只读参考 / 少量按本文件订正）:
  - ① `docs/Iterations/mobile-perf-2026-09/bugs/stream-multi-step-rate-freeze/{prd.md,spec.md}`
  - ② `docs/Iterations/mobile-perf-2026-09/features/stream-live-token-estimator/{prd.md,spec.md}`
  - ③ `docs/Iterations/mobile-perf-2026-09/bugs/context-usage-caliber-unify/{prd.md,spec.md}`
  - ④ `docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/{prd.md,spec.md}`
  - ⑤ `docs/Iterations/mobile-perf-2026-09/features/context-usage-real-tokenizer-fallback/{prd.md,spec.md}` ← **本轮主战场**（`agile-*` 五条的落点）
  - CR 目录：`docs/Iterations/stream-metrics-native-integration-cr/{cr-fix-spec.md, cr-fix-spec-v2.md, cr-fix-spec-v3.md}`
- **review_round**: 1 → **2**（v3 修订轮 = 第 2 轮 `review-full` 复核，**11 条无漏项、无 OQ 误升**，但查出 12 处「照做也闭不干净」的缺陷 F-1 ~ F-12）/ **dag_version**: 1
- **状态**: **fix-spec-ready**（主代理 2026-09-27 判定）：12 条 must-fix 全部「**有文件 + 改法 + 验收**」、**未写入的开放 must-fix = 0**、5 条 spec_deviations 均由条目闭合、Open questions 10 条不阻塞。⚠️ **ready ≠ 已修**：这 12 条**仍待执行**（执行须等用户指令；其中 `agile-1` 是 P1，落在已提交的敏捷项代码上）。
- **本轮评审 scope**（三个只读子代理 + 一轮复核）:
  - `review-scope-agile` → 覆盖 ⑤ 敏捷项 `context-usage-real-tokenizer-fallback` 的全部改动，产出 5 条（`agile-1` ~ `agile-5`）；
  - `review-scope-metrics-exec` → 覆盖 v2 执行后的 ①②④ 侧文档与代码注释一致性，产出 3 条（`metrics-exec-1` ~ `metrics-exec-3`）；
  - `review-scope-ctx-exec` → 覆盖 v2 执行后的 ③ 侧与 v2 自身文本，产出 3 条（`ctx-exec-1` ~ `ctx-exec-3`）；
  - `review-full`（round 2）→ **只查「执行方照做能不能干净闭环」**，查出 F-1 ~ F-12，**没有新增漏项**；其中 F-1 是 P1 级（`agile-1` 唯一的回归护栏在带 bug 的实现上也会通过），F-8 因此新增 `units-1` 一条 must-fix。
- **P 级分布**: **P0 × 0、P1 × 1**（`agile-1`）、**P2 × 11**。id 清单：`agile-1` ~ `agile-5`、`metrics-exec-1` ~ `3`、`ctx-exec-1` ~ `3`、**`units-1`**（v3 修订轮新增，见下）。
- **本文件只描述改法，不含任何实现代码改动。** 下游执行方是「已具备本仓全量上下文」的实现节点，措辞按专业口径写，**判定口径一律写死，不留「临场决定」**。

---

## Must-fix（按 P0 → P1 → P2）

> 无 P0。**共 12 条**（P1 × 1 / P2 × 11）。P1 一条（`agile-1`）是「**读数低于真值 36%**」——方向与本迭代的既定目标（把折算换成真分词器）相反，属必须闭合项。
>
> ⚠️ **本文件已按第 2 轮 `review-full` 的 F-1 ~ F-12 修订过一轮**：下面每条带「v3 修订轮」标记的段落就是本轮的改动落点，**改动理由就写在那一段里**（多数是「照做也闭不干净 / 会照着做但做错地方」）。**下游只照「改法 / 验收」执行即可，不需要回头读 F 编号。**

### agile-1 [P1] core helper 的「读出 0 → 按 `text.length` 兜底」会丢掉已固化计数、返回低于真值的数

- **维度**: B（正确性）+ A（诚实性）
- **文件**: `packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts:61-66`（函数体收口）、**`:26`（模块头）/ `:45`（`@param encode` 的 JSDoc）/ `:65`（函数体）三处「1:1 上界」口径**、`:17`（模块头记的 273ms 实测数）、`packages/core/test/infra/tokenizer/count-text-with-tokenizer.test.ts`（新增用例落点）；文档侧同口径复述 `docs/Iterations/mobile-perf-2026-09/features/context-usage-real-tokenizer-fallback/spec.md:47`（其 `:49` 的 ⚠️ 订正段已落盘）
- ⚠️ **行号免责**：本条所有代码行号以 `git grep -n "1:1 上界" -- packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts` 实查为准（v3 写就时为 `:26` / `:45` / `:65`，**共三处**）。
- **问题**（**评审已用真 cl100k 实测复现，下游按此描述理解，不要改写成「疑似」**）:
  - `createIncrementalTokenCounter` 的**读值路径**失败时返回的是「**上一次成功读值**」；本 helper 只读一次，那个「上一次」是 **0**。
  - 于是当**尾窗**（默认 24 字符）整段不可编码时，`tokens` 返回 0，helper 用 `text.length` 顶替——**把此前已经成功固化进 `committedTokens` 的计数整段丢掉**。
  - **实测复现数据**：6,024 字符中文序列化提示词，尾部 24 字符窗口恰好是 `<|endoftext|>` + 11 个无边界 CJK。真值（cl100k 全量 encode）**9,421**，helper 返回 **6,024**——**低估 36%**；裸计数器 `tokens` 为 **0**。
  - 附带的诚实性问题：中文下 `1 字符 ≈ 1 token` 本身就**低于真值**（cl100k 中文约 **1.64 token/字符**（≈0.61 字符/token），1:1 只有真值的 **0.61×**；⚠️ 全仓把这个比值写成「1.64 字符/token」是**单位倒置**，见本文件 `units-1`），而模块头 `:26`、`@param encode` 的 JSDoc `:45` 与函数体 `:65` 的注释把它称作「**1:1 上界**」「**宁可高估**」——**对本 helper 不成立**，是代码注释撒谎。
- **改法**（**三步，依次照做，判定口径已写死**）:
  1. **构造计数器时显式收紧尾窗**：`createIncrementalTokenCounter({ encode, tailChars: 0, commitStepChars: 1 })`。
     - 此时 `normalLimit = tailChars + commitStepChars = 1`，`push` 内的 `while (tail.length > normalLimit)`（即 `> 1`）会把全文**逐段走固化路径**；固化路径对失败段按 1:1 计入且**不丢段**（`metrics/B-1` 已落地）。
     - 循环结束后尾窗残留 **≤1 字符**——单字符不可能触发特殊 token，**读值路径实际不再可能失败**，`counted === 0` 成为事实上的不可达分支。
     - **`return counted > 0 ? counted : text.length` 必须保留**（作 belt-and-braces 兜底），**不许删**。
  2. **订正口径注释**（**三处同批改**——模块头 `:26`、`@param encode` 的 JSDoc `:45`、函数体 `:61-65`）：把「1:1 上界 / 宁可高估」改为中性表述——「**失败段按 1 字符计 1 token，保证不丢段、读数不倒退；对中文而言 1:1 仍可能低于真值，方向是偏保守但不是上界**」。
     - ⚠️ **v3 修订轮补记（F-2）**：前一轮的授权**只写了 `:26` 与 `:61-65`，漏了 `@param encode` 的 JSDoc `:45`**——那是**第三处**「1:1 上界」。只改两处就收工，等于把一句假陈述留在同一文件的 JSDoc 里，下一个读 API 文档的人照样被骗。**三处必须一起清。**
     - ⚠️ **附注（条件动作，不新增 must-fix）**：若步骤 3 的第 ③ 条性能实测显示 30K 中文耗时相对模块头 `:17` 记的 **273ms** 出现明显偏移，**把 `:17` 那个实测数字一并订正**——否则本条刚把 `:26` 的假陈述改真、又留下 `:17` 的陈旧实测数。同一文件、同批改，不另开条目。
  3. **新增一条 core 用例**（落 `packages/core/test/infra/tokenizer/count-text-with-tokenizer.test.ts`）：在 200 段中文正文之后拼 `"<|endoftext|>" + "甲乙丙丁戊己庚辛壬癸子"`（11 字）。
     - 毒串构造口径**写死**：`<|endoftext|>` 必须**整体落在尾窗内**、且**末尾 11 个字符（整段 CJK）**都是无边界字符（`<|endoftext|>` 里的 `<` `|` `>` 会被 `isBoundaryCharCode` 当切点劈开，末尾无边界才能让毒串整体留在尾窗里）——这是稳定复现的必要条件，改动毒串长度会让用例退化成「不触发」。
     - ⚠️ **正文长度口径也要写死（否则上界会假红）**：毒串按 1:1 计入就是 **24 个 token**（13 字符的 `<|endoftext|>` + 11 个 CJK），要让它在 `1.05` 的余量里「千分之几量级」，**前提是 `encode(正文)` 远大于 480 token**。所以**每段须为成句中文（≥10 字）**——200 段即 ≥2,000 字符 ≈ **3,280 token**，毒串占比 ≈ **0.7%**，稳稳落在带内。**若执行方写成「200 个单字」**（`encode` 才 ≈200~400 token），毒串占比会顶到 6%~12%，**上界必红**——那是用例写坏了，不是实现退化。
     - 断言写成**双边夹逼**（相对夹逼，**禁止硬编码任何数字**——ranks 表随 `js-tiktoken` 版本会变，写死必然在升级后变成假红）：
       - 下界：`cl100kEncode(去掉毒串的正文)` ≤ `count`
       - 上界：`count` ≤ `cl100kEncode(去掉毒串的正文)` × **1.05**
     - ⚠️ **为什么要双边夹逼、两条断言各咬一侧（本条是 P1 的闭环口，不许改回单边）**：这条用例守的 bug，兜底值是 **`text.length`**。按 `units-1` 订正后的**正确单位**（cl100k 中文 ≈ **1.64 token/字符**、≈ **0.61 字符/token**），中文正文下 `text.length` ≈ **0.61 × `encode(正文)`**——**低于真值**。所以**咬住它的是下界**：带 bug 的实现返回 `count = text.length ≈ 0.61 × encode(正文)`，必然**跌破下界 `count >= encode(正文)`** 被抓住（wave-1 实测：把构造参数临时改回默认尾窗复现 bug 后，新用例即报「不可编码尾段不得吞掉已固化计数：12224 < 真值 17200」）。**上界 `count <= encode(正文) × 1.05` 防的是另一侧**——毒串按 1:1 计入、以及任何「多算 / 虚高」型退化（修好后 `count ≈ encode(正文) + 毒串按 1:1 计入` 的 **24 token** = 13 字符的 `<|endoftext|>` + 11 个 CJK，对 200 段成句中文正文是千分之几量级，**稳稳落在带内**）。**双边夹逼保留**：两条都断言 = 同时覆盖「少算」与「多算」两个方向，比单边更严。
       - ⚠️ **留痕（论证方向订正）**：本节论证方向在 v3 修订轮曾写反（**把 `1.64` 当成「字符/token」用，于是推出「兜底值会超出上界」**），**已按 `units-1` 的单位口径与 wave-1 实测（`12224 < 17200`）订正**。下游照这段推理时**务必先按 `units-1` 的 `1.64 token/字符` 读数**，别再把比值当成倒数用。
- **验收 / 测试**（**六条硬指标，缺一不可**）:
  - ① 中文正文相对全量 `encode` 误差 **≤1%**（既有用例，保持）。
  - ② 单次 `encode` 入参恒 **≤64 字符**（既有用例，保持）。
  - ③ 30K 中文计数 **≤400ms**（当前实测 273ms，留 45% 余量）。
  - ④ 病态档 12K 无空白中文串 **≤1s**（当前 491ms）。
  - ⑤ **注释门禁**：`git grep -n "1:1 上界" -- packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts` → 期望**零命中**。写就时实查是 **3 处**（模块头 / `@param encode` JSDoc / 函数体），**少改一处这条 grep 就还剩命中**——它是「三处都清了」的唯一客观判据。
  - ⑥ ⚠️ **护栏真的能红的实测证据（wave-1 执行 `agile-1` 时取得，登记为「不是假绿」的客观判据）**：把 `createIncrementalTokenCounter` 的构造参数**临时改回默认尾窗**（`tailChars` / `commitStepChars` 均不传）复现 bug 后，新用例**如期报错**：`不可编码尾段不得吞掉已固化计数：12224 < 真值 17200`——即**下界先炸**（`12224 ≈ 0.71 × 17200`，与「`text.length` ≈ 0.61 × `encode(正文)`」同向）。恢复 `tailChars: 0 / commitStepChars: 1` 后该用例转绿。**这条报错原文就是「带 bug 时红、修好后绿」的证据**，别只记绿、不记红。
    - ⚠️ **同一段推导还顺带纠正了本条目上面那段论证的方向**（见改法 #3 的 ⚠️ 留痕）：咬住 bug 的是**下界**，不是上界。
  - **为什么必须写死这些指标**（①②③④ 是硬门限、⑤ 是 grep 门禁、⑥ 是「假绿」的反证）：收紧尾窗会**改变切分节奏**（30K 文本的 `tail.slice` 次数由约 **370** 涨到约 **470**）。没有硬指标就无法判定「是否退化」，执行方只能凭感觉收工。
  - ⚠️ **遗留（本轮不预改、但执行方要心里有数）**：本条落地后 ⑤ `prd.md:58` 的 core「**6** 条」与 ⑤ `spec.md:63` 同口径副本里的「**core 6**」**两处**都会变陈旧（→ **7** 条）。
    - ⚠️ **v3 修订轮订正（F-11）**：前一轮写的 `prd.md:57` 是**表格分隔行**（`|---|---|---|---|`；表头在 `:56`），core 那一行的**真行号是 `prd.md:58`**（`agile-5` 的文件栏已同步为 `:59` / `:61` / `:32`）；**第二处**是 `spec.md:63`，前一轮**完全没提**，等于 `agile-1` 落地后会留下一份没被认领的陈旧副本。
    - `spec.md:63` 那一处**已收进 `agile-5` 的授权**（推荐改成**引用式写法**「见 PRD『测试用例』表的四组」，从根上消灭副本分叉）。执行方做 `agile-1` 时**按 `agile-5` 的改法 #4 一并做掉**，不要两处各改一遍。
    - ✅ **下游已落盘（wave-1 收尾）**：⑤ `prd.md` 测试用例表 core 行的条数已由 **6 改为 7**（实查 `count-text-with-tokenizer.test.ts` 的 `it(` 为 **7** 个）；⑤ `spec.md:63` 已改成**引用式**「见 PRD『测试用例』表的四组，**条数以该表为准**」，**不再持数字副本**。本条留痕不再成立。
  - ✅ **文档侧（⑤ `spec.md:47`）的同口径订正已由前一轮落盘**；代码侧三处注释（模块头 `:26`、`@param encode` JSDoc `:45`、函数体 `:61-65`）仍由下游改。
- **来源**: `review-scope-agile` / round 1（MF-1）

### agile-2 [P2] desktop 用对象展开复制 registry 实例，原型方法在运行期丢失

- **维度**: C-orch（跨层装配）
- **文件**: `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:81-85`（`withRealFallbackCounter`）；依据落点 `apps/desktop/src/main/runtime/create-desktop-runtime.ts:93`（`createDefaultTokenCounterRegistry` 调用）、`packages/core/src/infra/tokenizer/logic/create-default-registry.ts:24`（class）/ `:36`（`forSavedModel`）/ `:49`（`forVendorModel`）/ `:61`（`return new DefaultTokenCounterRegistry`）
- **问题**:
  - `withRealFallbackCounter` 用 `{ ...runtime.tokenCounters, heuristic: realFallbackTokenCounter(runtime) }` 复制。
  - `runtime.tokenCounters` 是 `DefaultTokenCounterRegistry` 的**类实例**（**实测确认**：`create-default-registry.ts:24` 是 `class`，`:61` 返回 `new`），其 `forSavedModel` / `forVendorModel` 是**原型方法**（`:36` / `:49`），**不是自有可枚举属性** → **对象展开后运行期消失**。
  - 唯一两个会被 spread 带过去的是**自有属性** `heuristic`（`:25` 字段初始化）与 `getTokenizerOverride`（`:32` 构造函数赋值）。
  - **TypeScript 不报错**，因为 spread 的类型来自接口 `TokenCounterRegistry`（结构类型看得到全部方法），而运行时对象上根本没有那些自有属性。
  - 今天没炸**只因** `countPromptLlmInputHeuristicOnly` 只读 `registry.heuristic`；一旦 core 那条兜底用到 `forVendorModel(...)`，desktop 的**最后一道兜底**就会抛 `forVendorModel is not a function`。
- **改法**（**显式转发，判定写死**）:
  1. 把 `withRealFallbackCounter` 改为**逐个显式转发**，形如：
     ```
     const base = runtime.tokenCounters;
     return {
       getTokenizerOverride: base.getTokenizerOverride?.bind(base),
       forSavedModel: (id, o) => base.forSavedModel(id, o),
       forVendorModel: (id, o) => base.forVendorModel(id, o),
       heuristic: realFallbackTokenCounter(runtime),
     };
     ```
     `getTokenizerOverride` 必须 `.bind(base)`——它是构造函数里接进来的**外部函数值**，被搬成新对象的自有属性后 `this` 会指向新对象而非原实例。
  2. **禁令（写进代码注释，执行方不得违反）**：「**不得用对象展开 `{ ...registry }` 复制 `DefaultTokenCounterRegistry` 实例**——原型方法不会进自有属性，TS 因接口 spread 类型放行而运行时缺失，编译期零告警。」
  3. 注释里点明**为什么今天没炸**（`countPromptLlmInputHeuristicOnly` 只读 `heuristic`），免得下一个人把这条禁令当过度防御删掉。
- **验收 / 测试**:
  - `apps/desktop/test/chat-prompt-tokens.test.ts` 既有用例**全绿**。
  - **新增一条回归用例**：断言兜底 registry 的 `forSavedModel` / `forVendorModel` **可调用**（或等价地：断言「**无模型早退**」路径**不因 registry 方法缺失而抛错**）。两种写法任选其一，**但必须落在 `test/` 下**。
  - ⚠️ **新增 grep 门禁（v3 修订轮 F-9，防回流）**：只断言「方法可调用」对「下一个人做简化时又写回 `{...registry}`」是**零保护**——那条新用例在 bug 存在的旧代码上也是绿的（`forSavedModel` / `forVendorModel` 若是 `undefined`，只有真的调它才会炸）。所以必须再加一条**形态门禁**：
    - 拆成**两条独立命令**（Windows cmd 下 `\|` 组合模式不可靠，见 v2 K 节同款口径），**各自无输出才算过**：
      ```
      git grep -n -e "\.\.\..*[Tt]okenCounters" -- apps/desktop apps/mobile apps/cli packages/core/src packages/tokenizer-driver-node/src packages/tokenizer-driver-rn/src
      git grep -n -e "\.\.\..*[Rr]egistry"       -- apps/desktop apps/mobile apps/cli packages/core/src packages/tokenizer-driver-node/src packages/tokenizer-driver-rn/src
      ```
    - ⚠️ **必须显式列目录**（v3 修订轮实查）：不限制目录时第二条会命中 `packages/tokenizer-driver-node/assets/tokenizers/*.json` 里的 tokenizer 资产（实测输出 **78MB**），门禁直接不可用。
    - **本批实查基线**：`[Tt]okenCounters` 那条**只命中 `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:84` 一处**（就是本条要改的那行）；`[Rr]egistry` 那条**零命中**。所以「零命中」是可达到的预期值——**加这条门禁是防回流，不是为了对付现存的一堆命中**。
    - 人工排除：若日后命中的是**类型定义**或**普通对象字面量**（如 `{ ...deps, extra }` 这类合法的浅拷贝），**人工确认后保留**，不要连坐删。
- **来源**: `review-scope-agile` / round 1（MF-2）

### agile-3 [P2] desktop 首次兜底会在主进程同步建一整张 cl100k 表（未预热 / 未登记），且 JSDoc 声称「不需要额外建表成本」

- **维度**: B（性能）+ A（诚实性）
- **文件**: `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:38-40`（JSDoc「不需要额外建表成本」）、`apps/desktop/src/main/runtime/create-desktop-runtime.ts`（预热落点，实测该文件无任何 `tokenizer-driver-node` 直连 import——驱动注册在 `apps/desktop/src/main/runtime/connection.ts:24`）；文档侧 `docs/Iterations/mobile-perf-2026-09/features/context-usage-real-tokenizer-fallback/spec.md:78`（R1 缓解段，写就时写的 `:76` 偏两位，是前一轮插入 mobile 侧口径时带出来的漂移）
- **问题**:
  - `getNodeEncodingForModel` 的缓存键是 `model:<tiktokenModel>`、兜底档 `getNodeEncodingByName` 的键是 `enc:cl100k_base`（`packages/tokenizer-driver-node/src/impl/encoding-cache.ts:87` / `:96`）——**两个命名空间互不命中**。
  - desktop 上「**无模型早退** / **web·SP 加载失败** / **主路径抛异常**」三条兜底**首次触发**时，会在 **Electron 主进程同步**建一整张 cl100k WASM 表（**实测 185–248ms**），期间事件循环阻塞、IPC 排队。
  - ⑤ spec `:78` 的 R1 缓解段**只写了 mobile 的 `primeStreamTokenModelHint` 预热**，desktop **既未预热也未登记**。
  - `chat-prompt-tokens.service.ts:39-40` 的 JSDoc 写着「复用驱动里那张**进程级单例**编码表**不需要额外建表成本**」（前半句在 `:39`、句尾「不需要额外建表成本」落在 `:40`）——**与实现不符**（首次兜底触发的那张表恰恰要现建）。
  - ⚠️ **同款窗口在 mobile 侧同样存在，而代码注释把它当成了已解决**（v3 修订轮 F-10 实查）：`apps/mobile/src/services/chat-prompt-tokens.service.ts:100` 断言「cl100k 已在**会话切换**时被 `primeStreamTokenModelHint` 空闲预热，这里**不会再白付一次构造**」。但预热挂在**会话切换**上（`stream-token-estimator.ts:260`），而 UI 读口的「无模型早退」分支（`:101` 的 `countFallbackTokens`）在**冷启动到首次会话切换之间**就能被走到——**那段窗口里没人预热过**。「不会再白付」是**一个未验证的前提**，不是事实。
- **改法**（**写死取方案 a，不留二选一**）:
  1. 在 `apps/desktop/src/main/runtime/create-desktop-runtime.ts` 的启动路径完成后，**空闲预热**一次 cl100k：`setTimeout(() => { getDefaultNodeEncoding(); }, 0)` 形态（`getDefaultNodeEncoding` 由 `@novel-master/tokenizer-driver-node` 导出，`impl/encoding-cache.ts:100`）。
  2. 预热**必须包 `try/catch` 静默**：预热失败不影响启动，走既有降级路径。
  3. **不得阻塞启动**——用 `setTimeout` 形态，不许在主流程里 `await` 它。
  4. 订正 `chat-prompt-tokens.service.ts:39-40` 的 JSDoc：把「不需要额外建表成本」改成「**已由启动后的空闲预热覆盖大部分场景；首次兜底若发生在预热之前，仍有一次约 250ms 的同步建表成本**」。
  5. 在 ⑤ spec `:78` 的 **R1 段补一句 desktop 侧口径**（**已由前一轮落盘**）：desktop 侧已加空闲预热；真机复验项「Hermes 上首次计数的建表耗时」对应到 desktop 时是「**已预热 + 首次兜底若仍发生则有一次约 250ms 成本**」。
  6. ⚠️ **v3 修订轮新增（F-10）：在 ⑤ spec `:78` 的 R1 段再补一句 mobile 侧的对称口径**，措辞与上一句**并列同构**：
     - 文案（写死，照抄即可）：「**mobile 侧同理：预热挂在会话切换上，冷启动到首次会话切换之间的读数仍可能白付一次建表**（RN 侧 `primeStreamTokenModelHint` 覆盖的是切换之后）；本轮**只登记、不改实现**，`apps/mobile/src/services/chat-prompt-tokens.service.ts:100` 那句「不会再白付一次构造」按**未验证前提**对待，1310 真机复验时一并观察。」
     - **低成本取向（写死）**：**只加这一行说明**，**不许**顺手给 mobile 也加一条冷启动预热、也不许改成重构预热时机——那会扩大本轮 diff、且真机倍率未出前无法判断收益。**本条只解决「口径没登记」这个问题。**
     - ⚠️ 行号提醒：R1 段的真行号是 **`spec.md:78`**，不是前一轮写的 `:76`；执行方**动手前先 `git grep -n "风险 R1" -- <⑤ spec>` 定位**。
- **验收 / 测试**:
  - desktop 现有测试**全绿**。
  - 条目级自查：「**预热失败必须静默、不得把启动路径变成可能抛错的路径**」——即预热调用点外层有 `try/catch`，且启动流程**不因它 return/throw**。
  - ✅ **文档侧（⑤ `spec.md:78` 的 R1 段补 desktop 侧口径）已由前一轮落盘**；改法 #6 的 mobile 侧那行与代码侧（预热 + `:39-40` JSDoc）仍由下游改。
- **来源**: `review-scope-agile` / round 1（MF-3）

### agile-4 [P2] CLI 新增的兜底分支零测试覆盖

- **维度**: G（测试覆盖）
- **文件**: `apps/cli/src/prompt/commands.ts:132-140`（新增的真计数兜底分支）、既有测试 `apps/cli/test/prompt-tokens-e2e.test.ts`（**长期基线 5/5 红**，实查 5 个 `it()`：`CLI1` / `CLI2` / `CLI3` / `T9` / `CLI4`）
- **问题**:
  - 该分支所在的 `apps/cli/test/prompt-tokens-e2e.test.ts` 是**长期基线 5/5 红**（⑤ spec `:72` 已登记为「已双树验证的已知基线红」，失败点在 `session create`），**这 15 行在 CI 里从未被执行过**。
  - 留痕 PRD（⑤ `prd.md:43`，即 `| apps/desktop / apps/cli |` 那一行——`prd.md:42` 是上一行的 `| apps/mobile |`）把 CLI 写进了「覆盖」范围，验收标准第 6 条（`prd.md:52`「…**本轮零真回归**…」——`prd.md:51` 是「5. 不越界」）又讲「本轮零真回归」——**没有测试的「零回归」是空话**。
- **改法**:
  1. 把该分支抽成**可注入的纯函数**再测，例如 `export function resolveCliPromptTokens(serialized: string, charRatioCount: number): number`：**真计数优先**（`countTextWithDefaultEncoding(serialized)` 非 `null` 就用它），**只有 `null` 才折算**（用注入进来的 `charRatioCount`）。
  2. 在 `apps/cli/test/` 下**新建**一个 `node:test` 用例文件，断言**三条**：
     ① 拿到真计数时用它（注入一个返回固定真值的编码器 → 断言输出等于该真值，**不是**折算值）；
     ② 返回 `null` 时才退折算（注入一个返回 `null` 的编码器 → 断言输出等于 `charRatioCount`）；
     ③ 输出 JSON 的 `counter` / `estimated` 字段**不变**（兜底切换读数**不得**改这两个字段的口径）。
  3. **禁令（写死）**：「**不得依赖 `prompt-tokens-e2e.test.ts` 验证这条分支**」——它是长期基线 5/5 红，在里面加断言等于把新覆盖绑死在一个永远不绿的套件上。
- **验收 / 测试**: 新建的 `node:test` 文件**三条断言全绿**；既有 `prompt-tokens-e2e.test.ts` 的基线红**维持 5/5、不许因本条变多变少**（少一条说明误删了既有取证用例）。
  - 说明：新测试文件**不在** ⑤ PRD「测试用例」表的四组（core / mobile / desktop / Node 驱动）之内，这是**有意的**——它是 CLI 侧的纯函数单测、不走那四组。执行方**不必**为此新增表行，也不要为了「凑齐」去动 `prd.md` 的表结构。
- **来源**: `review-scope-agile` / round 1（MF-4）

### agile-5 [P2] 敏捷项留痕文档的计数与「不覆盖」清单与实际不符

- **维度**: A（文档一致性）
- **文件**: `docs/Iterations/mobile-perf-2026-09/features/context-usage-real-tokenizer-fallback/prd.md:59`、`:61`、`:32`；**`spec.md:63`（v3 修订轮 F-5 新增授权的第四处）**
- ⚠️ **行号免责 + 订正说明（v3 修订轮 F-5 / F-11）**：前一轮写的 `prd.md:58` / `:60` / `:31` 是**订正落盘前**的行号。`prd.md:32` 补进「不覆盖」清单那一条时**插入了新行**，把后面整体顶了两行 → 真值是 **`:59` / `:61` / `:32`**；`spec.md` 的 R1 段真行号是 **`:78`**（前一轮写的 `:76` 偏两位）。**执行方动手前一律先 `git grep` 定位锚点**（`prd.md` 搜 `## 测试用例` 看表头下一行起三行；`spec.md` 搜 `见 PRD「测试用例」表`）。
- **问题**（四处，均已实查）:
  1. **`:59`**「mobile **10**（改 1 增 3）」——总数 10 **对**，但「**改**」实为 **2 条**：`falls back to heuristic when native bridge is unavailable` 与 `heuristic uses 3.35 character ratio` **两条都被重写改名**。
  2. **`:61`**「Node 驱动 **4 + 改 1**」——实为 `fallback-count.test.ts` 新增 **4** 条 + `count-prompt-llm-input.test.ts` **1 新 + 1 改**（**漏记**新增的那条「中文兜底读数远大于字符折算」）。
     - ⚠️ **本轮实查订正**：`git diff 5c63d27e..f4cd067a` 实查，`count-prompt-llm-input.test.ts` 的变更是 **1 改**（`unknown model uses heuristic` 扩断言）+ **1 新**（`:132`「中文兜底读数远大于字符折算（钉住真分词器真的接上了）」），**不是 2 新**。评审报告的「2 新 + 1 改」若照抄进文档就成**新的假陈述**——故此处以 diff 为准写「**4 + 1 新 1 改**」。
  3. **`:32`**「不覆盖」清单只点名 **desktop renderer 流式指标条**的兜底，**漏列 mobile 的同款落点** `apps/mobile/src/services/session-stream-unit.ts:635-638`（`estimateIncrementTokens`（定义 `:629`）里两个估算器任一为 `null` 时仍走 `ceil(chars / 3.35)`，实查确认）。按意图同属「不覆盖」，但清单未列——**读者会以为 mobile 侧已收口**。
  4. **`:63`（`spec.md`，v3 修订轮 F-5 新增）**：「见 PRD『测试用例』表的四组（**core 6 / mobile 10 / desktop 3 / Node 驱动 4+改1**）」——这是一份与 PRD 表格**同口径的副本**。`prd.md:61` 前一轮已改成「4 + 1 新 1 改」，`spec.md:63` 仍是旧值 → **两份文档对同一组数字分叉，而前一轮没有任何条目覆盖它**。`agile-1` 落地后 core 还会从 6 变 7，这个副本**必然继续漂**。
- **改法**（**共四处；前三处已由前一轮落盘、第四处留给下游**，别动这两份文档的其他结论）:
  1. ✅ **已落盘** `prd.md:59`「改 1 增 3」→「**改 2 增 3**」（总数 10 不变）。
  2. ✅ **已落盘** `prd.md:61`「4 + 改 1」→ 如实写「**`fallback-count.test.ts` 4 条 + `count-prompt-llm-input.test.ts` 1 新 1 改**」，并**点名那条漏记的新增用例**（「中文兜底读数远大于字符折算」），让读者能按名字去核。
  3. ✅ **已落盘** `prd.md:32`「不覆盖」清单**补一条** mobile 落点：`apps/mobile/src/services/session-stream-unit.ts:635-638`（`estimateIncrementTokens`（定义 `:629`）未注入估算器时仍走 `ceil(chars/3.35)`），措辞与同段 desktop 那条**并列同构**。
  4. **待下游做** `spec.md:63`：**改成引用式写法，不同步数字**——把括号里那串副本换成「**（条数以 PRD『测试用例』表为准，四组）**」。**本文件写死推荐引用式、不要同步数字**：同步只能修好这一次的分叉，下一次 core 6→7（`agile-1` 落地就会发生）它照样漂；引用式则**从根上消灭副本**。
     - 禁令：**不许**顺手把 PRD 表格也改成引用式（PRD 是**真源**，它必须留数字）；**不许**只改 `spec.md:63` 的数字而保留副本形态。
- **验收 / 测试**:
  - 四处逐条**人工对读**（`prd.md:32` / `:59` / `:61`、`spec.md:63`）——本条**不上数字 grep 门禁**（数字随每轮改动变，写死 grep 只会变成下一个假红源）；改完后由执行方回报「四处改前 / 改后原文」即可。
  - `spec.md:63` 另加一条**形态门禁**：`git grep -n "见 PRD「测试用例」表" -- docs/Iterations/mobile-perf-2026-09/features/context-usage-real-tokenizer-fallback/spec.md` → 命中处**后面不得再跟「core N / mobile N / desktop N」这类数字副本**，只允许「条数以 PRD…为准」这类引用。
  - ✅ **前三处已由前一轮代为落盘**（见「元信息」的「文档订正已落盘」说明），下游**不要重复改**；第四处（`spec.md:63`）**本轮未落盘**、由下游做。
- **来源**: `review-scope-agile` / round 1（文档计数 + 不覆盖清单缺口）

### metrics-exec-1 [P2] A-4 只改了业务文档，代码注释里同款「零变化」假陈述还有 4 处

- **维度**: A（诚实性 / 文档一致性）
- **文件**: `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:17` 与 `:150`、`apps/mobile/src/services/session-stream-unit.ts:250`、`apps/mobile/src/services/session-stream-unit-manager.service.ts:293`
- **问题**:
  - `metrics/A-4` 的改法清单与验收 grep **只覆盖 `docs/Iterations/mobile-perf-2026-09`**，代码注释里同款「既有用例零变化 / 零回归」从**枚举缝**里漏过。四条原文实查如下：
    - `useAgentStreamMetrics.ts:17`：「不注入保持启发式——既有用例**零变化**」
    - `useAgentStreamMetrics.ts:150-151`：「**不注入 = 启发式**（`ceil(chars/3.35)`），既有用例零\n变化」
    - `session-stream-unit.ts:250`：「不注入 = 旧启发式行为，既有用例与无 tokenizer 的极简 runtime **零变化**」
    - `session-stream-unit-manager.service.ts:293`：「不注入 = 旧启发式行为（既有测试与极简 runtime **零变化**）」
  - 它们与 v2 `metrics/A-4` 已订正的口径冲突：A-4 落地后「未注入 = 旧行为」只在**未收到 usage 之前**成立。
- **改法**:
  1. 四处统一改写为**带时限的表述**，与 A-4 在 spec 里落的口径**逐字对齐**：「**未收到 usage 前**与旧口径严格一致；usage 到达后按 ①『基线 + 增量』口径」。
  2. **明确不要连坐**（这四处之外的三处「严格一致」是对的，**一个字都不许动**）:
     - `session-stream-unit.ts:1104-1105`「基线为 0 时与既有行为严格一致」——**自带时限限定**（`基线为 0` 就是那个限定，句子跨两行所以写成区间），是对的，**不要删**；
     - `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:8` / `apps/mobile/src/services/session-stream-unit.ts:159` / `:625` 的「严格一致」指的是 **`ceil` 与全量 `countText` 的等价性**（另一回事），**不要动**。
     - ⚠️ **v3 修订轮订正（F-12）**：前一轮把「严格一致」所在的 desktop 那处**指成了 `session-stream-unit.ts:8`**——**该行根本不含这个词**（它是宽限期注释），真身是 **`useAgentStreamMetrics.ts:8`**。照前一轮的清单去 `session-stream-unit.ts:8` 找，会以为「没有这处、不用管」，于是**把真正要保住的 desktop 那处漏在核对范围外**。
- **验收 / 测试**:
  - ⚠️ **v3 修订轮订正（F-6）**：前一轮用**单条组合式 grep**（`"零变化\|零回归"`）。本仓 v2 的 K 节**已明确登记「Windows cmd 下 `\|` 组合模式不可靠」**，本条照该口径**拆成两条独立命令**：
    ```
    git grep -n "零变化" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts apps/mobile/src/services/session-stream-unit.ts apps/mobile/src/services/session-stream-unit-manager.service.ts
    git grep -n "零回归" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts apps/mobile/src/services/session-stream-unit.ts apps/mobile/src/services/session-stream-unit-manager.service.ts
    ```
    **各自无输出才算过**。写就时实查：`"零变化"` 命中 3 处、`"零回归"` **零命中**——所以「零回归」那条是**先绿后红也要跑的**：它防的是下一个人换个词再犯。
  - ⚠️ **这条 grep 抓不全，执行方必须补人工对读**：实查 `useAgentStreamMetrics.ts:150` 那处的「零变化」**被换行拆成了 `既有用例零` + `变化`**，所以 `git grep` 只会命中 `:17` / `session-stream-unit.ts:250` / `session-stream-unit-manager.service.ts:293` **三处**、**漏掉 `:150`**。**grep 零命中之后仍要逐条对读四个文件的相关段落**，确认 `:150` 那处也改掉了（改写时顺手让它不跨行断开）。
  - 同时确认 `:1104-1105` / `useAgentStreamMetrics.ts:8` / `session-stream-unit.ts:159` / `:625` **原样未动**（这四处不许被连坐）。
- **来源**: `review-scope-metrics-exec` / round 1（#1）

### metrics-exec-2 [P2] C-1 漏掉第三处构造时机注释（`novel-master-context.tsx`），落地后成假陈述

- **维度**: A（诚实性）
- **文件**: `apps/mobile/src/runtime/novel-master-context.tsx:178-179`
- **问题**:
  - 原文：「实时 token 估算（stream-metrics-native ②）：**单元创建时建真 BPE 尾窗计数器**（编码名按会话模型解析，未就绪按 cl100k 兜底）」。
  - 该文件在本轮 diff 里**零改动**（`286113be` 与 `f0186106` 都没碰它），而 `metrics/C-1` 已把工厂调用**下移到 `begin()`** → 这条注释**已失效**：此处装配的是**工厂**（`tokenEstimatorFactory: sessionId => createSessionStreamTokenEstimator(rt, sessionId)`，`:180-181`），估算器本体在**单元 `begin()`（run 起手）才建**。
- **改法**（**只改注释，不动 `:180-181` 的工厂装配逻辑**）:
  - 改写为：「实时 token 估算（stream-metrics-native ②）：这里**只装配工厂**；编码表在**会话切换时空闲预热**，估算器本体在**单元 `begin()`（run 起手）同步兜底建**（正文/思考各一条，编码名按会话模型解析，未就绪按 cl100k 兜底）」。
  - 与 `metrics/A-5` 已改过的另两处措辞**保持同构**（同一事实、同一口径，不允许三个地方三种说法）。
- **验收 / 测试**: `git grep -n "单元创建时建" -- apps packages` → 期望**零命中**。
- **来源**: `review-scope-metrics-exec` / round 1（#2）

### metrics-exec-3 [P2] `cr-fix-spec-v2.md` 的 `full2/E-1` 验收命令仍带已被回填段推翻的旧行号

- **维度**: A（文档一致性）
- **文件**: `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec-v2.md` 的 **`full2/E-1` 条目**内**四处**（**用锚点句定位，不写死行号**）:
  - 锚点「**文件**」栏：条目内含 `useAgentStreamMetrics.ts:202`（`recomputeCompletionTokens` 定义）那一行（`git grep -n "full2/E-1" -- <v2>` 定位条目，条目内搜 `recomputeCompletionTokens`）；
  - 锚点「**条件改法 #3**」：条目内含 `不要引用 \`SESSION_STREAM_APPLY_INTERVAL_MS\`` 那一行；
  - 锚点「**验收命令**」：条目内含 `应命中 \`:204\`` 那一行；
  - 锚点「**改法 #1**」：条目内以 `1. \`full/E-1\` 的「文件」栏补上 desktop 三处` 开头那一行。
  - 📌 **参考真值**（写就时实测，落盘后会漂，**以锚点为准**）：上述四行依次为 `:739` / `:747` / `:750` / `:745`。
  - ⚠️ **v3 修订轮补记（F-4）**：前一轮在本文件元信息里把这几处写成 `:739` / `:746` / `:749`，**落盘后已漂成 `:739` / `:747` / `:750`**——本文件自己的行号同样会漂，所以现在改成「锚点句 + 参考真值」双写。**行号以 `git grep` 实查为准，本文件落盘后行号可能漂移**（文首「行号免责」同款口径）。
- **问题**:
  - `full/E-1` 的 ⚠️ 回填段已给出**正确的 HEAD 行号**（`useAgentStreamMetrics.ts:204`（读值合成 `composeStreamTokens`）/ `:301`（重锚 `reanchorStreamTokenBase`）、`setInterval` `:246`、`useAgentStream.ts:98` / `:107`；mobile 侧 `session-stream-unit.ts:642` 定义 / `:1108` 调用），但 `full2/E-1` 条目的**文件栏与验收期望值**仍是 v4 写就时的**旧行号**（`:188` / `:249` / `:264` / `:223`、`useAgentStream.ts:172` / `:188`）。
  - ⚠️ **v3 收尾轮补记（wave-1 之后整体漂移）**：wave-1 在 `useAgentStreamMetrics.ts` 的注释上增删了行，这批锚点**整体 +2**（`recomputeCompletionTokens` 定义 `:200` → `:202`、读值合成 `:202` → `:204`、重锚 `:299` → `:301`、250ms tick `:244` → `:246`、两次 delta 读值调用 `:270` / `:285` → `:272` / `:287`、依赖数组同名引用 `:276` / `:291` → `:278` / `:293`）；mobile 侧 `session-stream-unit.ts` **+1**（定义 `:641` → `:642`、调用 `:1107` → `:1108`）。`useAgentStream.ts:98` / `:107` **未漂移**。**v2 的「文件栏 / 改法 #1 / 验收命令」与 v3 的本条验收期望值均已按此同步**。⚠️ **行号以 `git grep` 实查为准，本文件落盘后可能漂移**（锚点句才是权威）。
  - ⚠️ **而且前一轮只改了一半（F-3）**：条目里的「**文件**」栏、「**条件改法 #3**」、「**验收命令**」三处都订正了，唯独「**改法 #1**」那一句**仍是旧行号**——而那句话恰恰是**指示下游「把 desktop 三处行号补进 `full/E-1`」**的执行指令。照做就会把 `:249` / `:264` / `:172` / `:188` **原样抄进 `full/E-1`**，让刚订正好的地方重新长出旧行号。**本轮（v3 修订轮）已由前一轮 spec-fix 节点代为落盘**（该句同步为 `:204` / `:301`、`:98` / `:107`，并加了一句「行号以回填段为准」；**v3 收尾轮又按 wave-1 后的现状复核过一次，仍是这组数**）。
  - 后果：执行方照 `full2/E-1` 的验收命令跑**必红**，且会被误读成「回填段错了」或「代码回归了」——两个方向的错误结论。
- **改法**（**取「同步行号 + 加一句以回填段为准」的双保险**）:
  1. ✅ **已落盘（前一轮）** `full2/E-1` 的「**文件**」栏与「**验收命令**」里的行号**同步成回填段的真值**（值见下方验收）。
  2. ✅ **已落盘（前一轮）** 在该条目加一句：「⚠️ **本条行号已由 `full/E-1` 的 ⚠️ 回填段订正，验收以回填段为准**。」
  3. ✅ **已落盘（本轮补记，F-3；v3 收尾轮按 wave-1 后现状复核仍成立）** 「**改法 #1**」那句的旧行号同步为真值（`:204` / `:301`、`:98` / `:107`），并注明「**行号一律以 `full/E-1` 的 ⚠️ 回填段与本条目「文件」栏为准**」。
  4. **禁令**：「**不要改 `full/E-1` 的回填段**」——它是当前**唯一正确**的一份，改它等于用一个错数换一个错数。
  5. ⚠️ **v3 修订轮登记的残留（前一轮 spec-fix 节点无授权改，记在这里免得被当成漏改，F-3 的同源问题）**：v2 **元信息段**里另有一句也带着同款旧行号。它同样会把旧行号带进下一次复读。**v3 收尾轮已拿到更宽的 v2 授权，已把它一并同步为 `:204` / `:301`**（同一个坑、同一个修法，**不另开 must-fix**）。
- **验收 / 测试**（前一轮已按回填真值同步、本轮补上「改法 #1」那一行；执行方复核即可）:
  - `git grep -n "composeStreamTokens\|reanchorStreamTokenBase\|setInterval" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` → 命中 `:204`（读值合成）、`:301`（重锚）、`:246`（250ms tick）。
  - `git grep -n "recomputeCompletionTokens" -- apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` → 命中 `:202`（定义）、`:272` / `:287`（两次调用；`:278` / `:293` 是 `useCallback` 依赖数组里的同名引用，**不算调用**）。
  - `git grep -n "applyTextDelta\|applyThinkingDelta" -- apps/desktop/renderer/hooks/useAgentStream.ts` → 命中 `:98` / `:107`（定义）。
  - `git grep -n "recomputeCompletionTokens" -- apps/mobile/src/services/session-stream-unit.ts` → 命中 `:642`（定义）、`:1108`（调用）。
  - ⚠️ **行号以 `git grep` 实查为准，本文件落盘后可能漂移**（上面这组值是 **wave-1 落盘后**的现值；wave-1 之前的旧值 `recomputeCompletionTokens` 定义 `:200` / 读值合成 `:202` / 重锚 `:299` / tick `:244` / 调用 `:270`、`:285` / 依赖 `:276`、`:291`，mobile `:641` / `:1107` **已全部作废**）。
  - ⚠️ **v3 修订轮提醒（K 节第 10 条同款）**：上面四条里的 `\|` **组合模式在 Windows cmd 下不可靠**（v2 K 节已登记过这个坑）。**执行方跑之前把它们按 `\|` 拆成独立命令逐个跑**，别因为「一条命令没输出」就判绿——很可能那条命令根本没按预期匹配。**核对的是「命中行 + 行号」，不是「命令返回了什么」。**
  - ✅ **本轮（v3 修订轮）已由前一轮 spec-fix 节点代为落盘**（v2 `full2/E-1` 的「改法 #1」/ 文件栏 / 条件改法 #3 / 验收命令 四行），下游**只需逐条复核上面四条 grep**、不要重复改。
- **来源**: `review-scope-metrics-exec` / round 1（#3）

### ctx-exec-1 [P2] `50e81d4d` 的字段移除在测试里没删净，且提交说明与 fix-spec「执行记录」都声称已同步

- **维度**: A（诚实性）
- **文件**: `packages/core/test/infra/tokenizer/prompt-token-invalidation.test.ts:50`、`packages/core/test/compaction-conditions/run-compaction.test.ts:82`、`packages/core/test/compaction-conditions/token-ratio-trigger.test.ts:71`、`packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts:239`（四处**实查确认**，值分别为 `"run-previous"` × 3、`"run-before-restart"` × 1）
- **问题**:
  - `SessionApiPromptTokenEntry` **已无 `runId` 字段**（`50e81d4d` 移除，OQ #4 用户拍板），但**仍有 4 处测试对象字面量**把 `runId: "..."` 传给 `serializeSessionApiPromptTokenEntry` → **TS 超额属性错误（TS2353/TS2322）**。
  - **任何门禁都拦不住**（三条原因叠加，本条的隐蔽性来自此）：
    ① core `typecheck` 用 `tsconfig.json`，其 `include` 只有 `["src/**/*"]`，**不含 `test/`**；
    ② 测试走 `tsx`，**只剥类型不查类型**；
    ③ 运行期 `JSON.stringify` **丢弃未知键** → 4 个文件**全绿**。
  - 后果：它与 `50e81d4d` 提交说明里「测试同步：…resolve fixture」、以及 fix-spec v2「执行记录」中「字段已删净」的表述**构成假陈述**——一旦 core 的 `typecheck` 覆盖到 `test/`（见 Open questions 第 7 条），当场 4 处报错。
- **改法**:
  1. 删掉这 **4 行** `runId: ...`。
  2. 若某处的**本意**是「造一条带旧字段的老行」（模拟历史数据），改用 `packages/core/test/infra/tokenizer/session-api-prompt-token-store.test.ts:77-92` 那种**裸 `JSON.stringify({ ... someRemovedLegacyKey })`** 的写法表达——**不要往类型化入口塞超额键**。
- **验收 / 测试**:
  - `git grep -n "runId" -- packages/core/test/infra/tokenizer packages/core/test/compaction-conditions` → 期望**零命中**（`stream_metrics` / `finalRate` 相关文件除外，那条链路**有读取方、未动**）。
  - 4 个相关测试文件**实跑全绿**（删字段不该改行为，若红了说明某处真的依赖了它——回来找执行方，不要顺手加回）。
- **来源**: `review-scope-ctx-exec` / round 1（sscope-mf-1）

### ctx-exec-2 [P2] fix-spec v2 关于「执行后 HEAD」的肯定式断言已被后续提交打破

- **维度**: A（诚实性）+ K（交付面）
- **文件**: `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec-v2.md` 的三处（**用锚点句定位，不写死行号**）:
  - 锚点 A：元信息「**执行后 HEAD**」行（`git grep -n "执行后 HEAD" -- <v2>` 命中，含 `实跑 \`git log --oneline 71692b11..f4cd067a\` 有 **8 笔**`）；
  - 锚点 B：元信息「**状态**」行（含 `71692b11` **之后另有 8 笔提交**）；
  - 锚点 C：文末 Closure 表「**执行状态**」行（含 `71692b11` **之后另有 8 笔提交**）。
  - 📌 **参考真值**（写就时实测，落盘后会漂，**以锚点为准**）：依次为 `:11` / `:18` / `:968`。
  - ⚠️ **v3 修订轮补记（F-4）**：前一轮在本文件元信息里写的是 `:11` / `:18` / `:967`，**落盘后真值是 `:968`**（插入一行导致下移）。现在改成「锚点句 + 参考真值」双写，**行号以 `git grep` 实查为准，本文件落盘后行号可能漂移**（文首「行号免责」同款口径）。
- **问题**:
  - 三处断言「执行后 HEAD = `71692b11`，**其后仅剩本文件终态标注与 `.iteration-state.yaml` 落盘，不再产生代码 / 业务文档改动**」。
  - 实跑 `git log --oneline 71692b11..f4cd067a` 有 **8 笔**，其中 `50e81d4d`（refactor，**代码**）、`f0186106`（feat，**代码**）、`4e179e1a`（feat，**代码**）**三笔实质改代码**，`acf1802d` 还新建了业务 spec（⑤ 敏捷项留痕）。
  - ⚠️ **v3 修订轮新增（F-4 的第二半）：「8 笔」与枚举不自洽**。三处订正文字都写「**8 笔**提交」，但**枚举只列了 5 笔**（`50e81d4d` / `f0186106` / `4e179e1a` / `acf1802d` / `f4cd067a`），**漏了 3 笔**：`31923b2c`（v2 终态标注：执行记录 + `full/E-1` 回填 + 状态推进）、`f9d0de90`（dev-ready 终态落盘：消除 `head_sha` 自指歧义 + 状态文件收口）、`0d79f559`（OQ #4 拍板落地标注）。**写着 8 笔、只列 5 笔，等于给下一个复读的人埋一个「是不是漏读了」的疑问**——而这两者必须只留一个。
  - 锚点 A（元信息「**执行后 HEAD**」行）末尾那句「真实 HEAD 以 `git log -1` 为准」**只能缓解、不能推翻**同一段里的肯定式断言——读者会先读到承诺、再读到缓解句，承诺仍在。
- **改法**（**四条：① ② 已由前一轮落盘、③ 是 v3 修订轮新增且本轮未落盘、④ 是禁令**）:
  1. 三处统一补后续事实链（**按顺序写，别打乱**）:
     - `50e81d4d` —— OQ #4 `runId` / `lastMessageSeq` 字段移除（**用户拍板**）；
     - `f0186106` + `4e179e1a` + `acf1802d` —— 敏捷项 **`context-usage-real-tokenizer-fallback`**（真分词器兜底估算）；
     - `f4cd067a` —— 编排 / 文档落盘（**本轮评审范围的 head**）。
  2. **删掉「其后不再产生代码改动」这句承诺**——它已被打破，留着就是下一次复读的误导源。改成中性的「**其后另有 8 笔提交，见下述事实链**」。
  3. ⚠️ **v3 修订轮新增（F-4）· 枚举补全**：本文件**写死取「补全枚举」**这一支（另一半是「把 8 笔改成 5 笔」，**本文件判它错**，理由见验收）——三处统一把那 3 笔补进事实链，按时间序插在对应位置：
     - `31923b2c` —— v2 终态标注（执行记录 21 行逐行结果 + `full/E-1` 回填 + 状态推进），排在**最前**；
     - `f9d0de90` —— dev-ready 终态落盘（消除 `head_sha` 自指歧义 + 状态文件收口）；
     - `0d79f559` —— OQ #4 拍板落地标注（字段移除已执行 + 状态文件记用户决策），排在 `50e81d4d` 之后。
     - 补全后的顺序即 `git log` 的逆序：`31923b2c` → `f9d0de90` → `0d79f559` → `50e81d4d` → `f0186106` + `4e179e1a` + `acf1802d` → `f4cd067a`，**8 笔全列**。
  4. **禁令**：「**数字与枚举只许留一处口径**」——补全后三处都必须是「8 笔 + 8 个 sha」；**不许**一处补全、另一处仍写 5 笔（那是把一个不自洽换成三个不自洽）。
- **验收 / 测试**:
  - 三处（锚点 A / B / C）**逐条对读**，确认：①「不再产生代码改动」的措辞**零残留**；② 三条事实链（`50e81d4d` / `f0186106`+`4e179e1a`+`acf1802d` / `f4cd067a`）**都出现**且顺序一致；③ **补全后 8 个 sha 全列**，且「8 笔」这个数字与枚举条数**相等**。
  - 计数口径**必须实跑复核**：`git log --oneline 71692b11..f4cd067a` 是 **8 笔**（v3 修订轮已实跑，8 个 sha 依次为 `f4cd067a` / `acf1802d` / `4e179e1a` / `f0186106` / `0d79f559` / `50e81d4d` / `f9d0de90` / `31923b2c`）。**既然实跑是 8，「8 笔」就是真值 → 必须补全枚举，不许改成 5。**
  - ⚠️ **本轮 v2 的文件授权只覆盖 `full2/E-1` 的「改法 #1」**，所以**这一处（改法 #3 的枚举补全）本轮未落盘**，由下游执行；下游改完在回报里把它单列（它同样**不产生任何实现 diff**）。
  - ⚠️ **不要顺手改 v2 的「base_sha / head_sha」行**：那两行记的是**评审范围**（`83a434d7` → `fad16a12`），本文件元信息里的 `5c63d27e` / `f4cd067a` 记的是**本轮 v3 的范围**，两套口径各自成立，不要互相对齐。
- **来源**: `review-scope-ctx-exec` / round 1（sscope-mf-2）

### ctx-exec-3 [P2] `ctx-usage/A-1` 的读侧验收按字面不可满足，且既未落地也未登记

- **维度**: G（测试覆盖）+ A（诚实性）
- **文件**: `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec-v2.md:132`（A-1 验收第 2 条）、同文件「执行记录」的 deviation **#6** 行
- **问题**:
  - v2 A-1 验收第 2 条要求：「seed 一条 `savedModelId` **相同**的新行后，不调 `updateSessionAgentConfig`、直接调 `resolveCurrentPromptTokens` → 断言 `source === 'local'`」。
  - 这与实现**直接冲突**：读口**只用 `savedModelId` 指纹**判定，指纹相同必然返回 `api` → **该断言必红**。v2 `:133` 自己也已论证「读口**根本没有** agentId / prompt layout 指纹」——**同一段内自我否定**。
  - 实查 `resolve-current-prompt-tokens.test.ts`：**无此用例**（`:147` 的 T-T9 是**反方向**——指纹**不**符时回退 `local`）。
  - 「执行记录」`#6` 只报了反向用例，**既没说这条没做、也没登记成 deviation** → 又一处「账面全绿、实际缺环」。
- **改法**（**写死取方案 ①**）:
  1. 把 v2 **A-1 验收第 2 条**改写为：「**读口无 agent 指纹 ⇒ 不设读侧用例**；改为在 ③ spec 留痕（已落地于 `spec.md:44`），回归由**挂点正反两条用例**承担。」
  2. 在「执行记录」deviation **#6** 行**补上这句结论**，不留空白（`#6` 现有的「已闭合 by `ctx-usage/A-1`」后面追加，不要重写它已经成立的结论）。
  3. **禁令**：**不必真去写那条不可能通过的用例**。写一条必红的用例比不写更糟——它会污染 baseline、并在下一轮被当成「实现回归」误读。
- **验收 / 测试**: v2 `:132` 与「执行记录」`#6` **两处对读**，确认：① `:132` 已是方案 ① 的表述；② `#6` 行含「读口无 agent 指纹 ⇒ 不设读侧用例」这层结论。
- **来源**: `review-scope-ctx-exec` / round 1（sscope-mf-3）

### units-1 [P2] 全仓把「1.64 token/字符」写成「1.64 字符/token」（单位倒置）

- **维度**: A（诚实性 / 文档一致性）
- **落点**（`git grep -n "1\.64 字符/token" -- apps packages docs` 实查 **10 处、跨 9 个文件**；下方列全，**行号以实查为准**）:
  - 代码注释 3 处：`packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts:7`（模块头「为什么折算必须下台」）、`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:52`、`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:72`；
  - 驱动实现注释 1 处：`packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:28`；
  - 测试注释 3 处：`packages/tokenizer-driver-node/test/count-prompt-llm-input.test.ts:133`、`apps/desktop/test/chat-prompt-tokens.test.ts:189`、`apps/mobile/__tests__/mobile-prompt-token-counter.test.ts:200`；
  - 业务文档 3 处：⑤ `prd.md:21`、⑤ `spec.md:10`、⑤ `spec.md:49`。
- **问题**（**评审已实查，下游按此理解，不要改写成「疑似」**）:
  - 实测数据：**2,002 字符 → 3,288 tokens**、**30,038 字符 → 49,151 tokens** → **≈1.64 token/字符**（即 **≈0.61 字符/token**）。全仓却一律写成「**1.64 字符/token**」——**单位倒置，数值差了一个「取倒数」的错误**。
  - 倒置之后，**同一份文档里的另两句就自相矛盾**：若真是「1.64 字符/token」，那 1:1 就是**真值的 1.64 倍（高估）**，可同一段又写「**1:1 只有真值的 0.61×**」「**折算低估 82%~84%**」——**只有按「1.64 token/字符」读，这两句才成立**。所以这**不是文风问题，是同一段里两套互斥口径**，读者按字面取任意一句都会得出相反结论。
  - ⚠️ **同批次还要顺带对读的 7 处**（它们**没写**「1.64」，所以上面的 grep 抓不到，但结论同源）：`apps/cli/src/prompt/commands.ts:134`、`apps/desktop/src/main/services/chat-prompt-tokens.service.ts:6`、`apps/mobile/src/services/chat-prompt-tokens.service.ts:13`、`packages/tokenizer-driver-node/src/impl/encoding-cache.ts:44`、`packages/tokenizer-driver-rn/src/impl/encoding-cache.ts:45`、`packages/tokenizer-driver-node/src/impl/sentencepiece-token-counter.ts:23`、`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:7` —— 这 7 处只写了「**对中文正文系统性低估 82%~84%**」。⚠️ **末位那一处特别容易被漏**：它在 `count-prompt-llm-input.ts` 的**模块头**，与本条目落点清单里的 `:52` **同属一个文件**，但 `:52` 带 `1.64`、`:7` 不带，grep 只抓得到前者——**改完 `:52` 若不顺手扫一眼同文件 `:7`，这一处就会原地不动**。这 7 处**本身没有倒置单位、不用改数字**，但那个百分比**只在正确口径下成立**，所以**同批复核一遍措辞即可**（若某处顺手带了「1.6 倍」之类的说法，按本条口径改）。
  - ⚠️ **与 `agile-1` 直接相关**：`agile-1` 的问题描述引用了这个比值（用来论证「1:1 兜底对中文是低于真值、不是上界」），其新增用例的**判别力也建立在同一个数上**（带 bug 时兜底值 `text.length ≈ 0.61 × encode(正文)`、**低于真值** → **下界**咬住它；**上界 `× 1.05` 防的是多算 / 虚高那一侧**；**双边夹逼保留** = 两条都断言，同时覆盖少算与多算）。**口径写反，`agile-1` 那条 P1 护栏的因果链就断了**——`agile-1` 条目里已加交叉引用。
- **改法**（**统一改成双写法，不许只改一边**）:
  1. 上述 10 处**一律**改成「**≈1.64 token/字符（≈0.61 字符/token）**」。
  2. **若某处语境确实需要「字符/token」口径**（例如在讲英文 `3.5~3.6 字符/token`、或要跟那个并排对照），**不要把 1.64 硬塞进那个句式**——改成「**0.61 字符/token**」，或干脆在中文语境只留 `token/字符` 那一半。**判据一句话**：`1.64` 后面只能跟 `token/字符`。
  3. **禁令**：**不许**借这条顺手改任何**行为**或**数字**（`3.35` / `0.85` / 门限一律不动）——本条是**纯口径订正**。也不许把「82%~84%」这个结论改掉：**在正确口径下它是对的**。
- **验收 / 测试**:
  - `git grep -n "1.64 字符/token" -- apps packages docs` → 期望**零命中**。
  - 10 处**逐处人工对读**（grep 抓不到散落在长注释里的换行拆词），确认每一处都满足「`1.64` 后只跟 `token/字符`」，且英文那半的「3.5~3.6 字符/token」**原样未动**。
  - 上文那 **7 处**同批次措辞**一并对读**（它们数字没写错，只需确认百分比表述与新口径同源、不含「1.6 倍」之类倒置说法）；其中 **`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:7` 与本条落点的 `:52` 同文件，grep 只抓得到 `:52`**，改完 `:52` 后**必须另扫一眼 `:7`**。
  - ⑤ `spec.md:49` 那处**与 `agile-1` 联动**：它同段还写着「1:1 只有真值的 0.61×」，改的时候**两半要一起对**，别只改 `1.64` 那一半。
  - ⚠️ **本条与 `agile-1` 的先后**：建议**先做 `units-1` 再做 `agile-1` 的用例**——`agile-1` 的上界取 1.05 依赖读者对「1.64 token/字符」的正确理解，文档口径没先修对，写用例的人容易按倒置口径去估余量。
- **来源**: v3 修订轮 `review-full`（F-8，单位倒置全仓普查）

---

## Spec deviations

> 判定口径同 v2：**open** = 文档声明与实现不符、必须由本文件的 must-fix 闭合；**一致** = 声明与实现相符。
>
> **本轮共 5 行 open，全部已由上方 must-fix 条目闭合**（执行完成后把这 5 行的「判定」列改成闭合指向，不要新增行）。**第 5 行是 v3 修订轮新增的**（单位倒置）。

| # | 位置 | 声明 | 实际 | 判定 |
|---|---|---|---|---|
| 1 | `packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts` 的**三处**「1:1 上界」（模块头 `:26` / `@param encode` JSDoc `:45` / 函数体 `:65`）+ ⑤ `spec.md:47` | 不可编码段按「**1:1 上界**」兜底、「**宁可高估**」 | 1:1 对中文**低于真值**（0.61×）；且「读出 0 → `text.length`」这条收口会**丢掉已固化的计数**（实测 6,024 vs 真值 9,421，**低估 36%**） | **open → 由 `agile-1` 闭合**（收紧尾窗 `tailChars: 0 / commitStepChars: 1` 让读值路径不再可能失败 + **三处**注释口径改中性 + 新增**双边夹逼**用例）<br>✅ **v3 修订轮的闭环加固**：① 护栏断言从「单边 `>=`」改成 **`encode(正文) <= count <= encode(正文) × 1.05`**——带 bug 时兜底值是 `text.length ≈ 0.61 × encode(正文)`、**低于真值**，所以**咬住它的是下界**（必然跌破 `count >= encode(正文)`）；**上界 `× 1.05` 防的是多算 / 虚高那一侧**（毒串按 1:1 计入等），**双边夹逼保留** = 两条都断言，同时覆盖「少算」与「多算」，比单边更严；② 注释授权从 2 处补到 **3 处**（漏了 `@param encode` 的 JSDoc `:45`），验收加 `git grep -n "1:1 上界" -- <该文件>` 零命中。文档侧遗留：⑤ `prd.md:58` 与 ⑤ `spec.md:63` 的 core「6 → 7」（前者由 `agile-1` 顺手做、后者由 `agile-5` 改法 #4 收口） |
| 2 | ⑤ `spec.md:78` 风险 R1「缓解」段 | 风险已缓解 | 缓解**只覆盖 mobile 的 `primeStreamTokenModelHint` 预热**；desktop **未预热、未登记**，其三条兜底首次触发会在 Electron 主进程**同步建一整张 cl100k 表**（185–248ms）。**v3 修订轮另查**：mobile 侧同款窗口（**冷启动 → 首次会话切换**）也未登记，而 `apps/mobile/src/services/chat-prompt-tokens.service.ts:100` 的「不会再白付一次构造」是**未验证前提** | **open → 由 `agile-3` 闭合**（desktop 启动后空闲预热 + try/catch 静默 + 订正 `:39-40` JSDoc + R1 段补 desktop 侧口径）<br>✅ **v3 修订轮的闭环加固**：R1 段真行号是 **`:78`**（前一轮写的 `:76` 偏两位）；并**新增改法 #6**——R1 段**再补一行 mobile 侧对称口径**（只登记、不改实现、不给 mobile 加预热）。⚠️ desktop 侧那行**已由前一轮落盘**，mobile 侧那行**留给下游** |
| 3 | ⑤ `prd.md:59` / `:61` / `:32`（+ **`:63` 副本**） | 「改 1 增 3」/「4 + 改 1」/ 不覆盖清单已列全 | 改实为 **2** 条；Node 驱动实为 **4 + 1 新 1 改**（漏记一条新增「中文兜底读数远大于字符折算」；**diff 实查订正**——评审报的「2 新」是笔误，照抄会写成新的假陈述）；不覆盖清单**漏列** mobile `session-stream-unit.ts:635-638`；**`spec.md:63` 另有一份同口径副本**（「core 6 / mobile 10 / desktop 3 / Node 驱动 4+改1」），`prd.md:61` 改完它就分叉 | **open → 由 `agile-5` 闭合**（三处已落盘 + **新增第四处**把 `spec.md:63` 改成引用式写法）<br>✅ **v3 修订轮的闭环加固**：① 授权从 3 处扩到 **4 处**，第四处是 `spec.md:63` 的副本——**推荐改成「条数以 PRD『测试用例』表为准」的引用式**，从根上消灭副本分叉（同步数字只能修好这一次，`agile-1` 让 core 6→7 它照样漂）；② 三处落盘行号真值订正为 **`prd.md:59` / `:61` / `:32`**（补「不覆盖」那行时插入新行导致下移），R1 段真行号 **`:78`**。⚠️ 第四处**本轮未落盘**、由下游做 |
| 4 | `50e81d4d` 提交说明「测试同步」+ v2「执行记录」「字段已删净」 | `runId` 已从类型与测试中删净 | 类型已删，**4 处测试对象字面量仍传 `runId`**；core `typecheck` 不覆盖 `test/`、测试走 `tsx` 只剥类型、`JSON.stringify` 丢未知键 → **4 个文件全绿、零门禁能拦** | **open → 由 `ctx-exec-1` 闭合**（删 4 行；「造老行」的意图改用裸 `JSON.stringify` 写法） |
| 5 | 全仓 10 处「**1.64 字符/token**」表述（代码注释 / 驱动实现注释 / 测试注释 / ⑤ `prd.md:21` / `spec.md:10` / `spec.md:49`） | 「1.64 字符/token」 | 实测 **≈1.64 token/字符（≈0.61 字符/token）**，2,002 字符 → 3,288 tokens、30,038 字符 → 49,151 tokens——**单位倒置**；且倒置后同段的「1:1 只有真值的 0.61×」「折算低估 82%~84%」两句**互相矛盾** | **open → 由 `units-1` 闭合**（统一改成「≈1.64 token/字符（≈0.61 字符/token）」；`git grep -n "1.64 字符/token" -- apps packages docs` 零命中）。⚠️ **本条是 `agile-1` 的因果前提**（其上界判别力建立在 1.64 这个数上），建议**先做 `units-1` 再做 `agile-1` 的用例** |

---

## Open questions / 待拍板

> 以下是评审提出但**未认定**的问题，**不是 must-fix**，执行时**不得顺手改**。它们不阻塞 `agile-1` ~ `agile-5`、`metrics-exec-*`、`ctx-exec-*` 与 `units-1` 的落地；请用户逐条拍板后再决定是否单开条目。**第 9、10 条是 v3 修订轮新增，与既有 8 条同级。**

1. **Node 侧「缓存后不 `free`」的内存上界**，以及 `clearTiktokenEncodingCache()` 已**无任何调用方**。⑤ `prd.md:40` 把「缓存后不 free」写成设计选择，但**上界是多少、进程生命周期内会占多少内存，没有任何文档或门禁**；配套的清理函数失去调用方后是死代码还是待用 API，也没登记。**是否需要登记内存上界 / 是否删掉那个清理函数**？
2. **两份 `encoding-cache.ts`（RN 143 行 / Node 142 行）是否该收敛到 core**？两边逻辑几乎同构。可行的收敛形态是「core 提供**注入式工厂**、core 自身**不 import** `tiktoken` / `js-tiktoken`」——但这会新增一个抽象层与两处调用改造。**本轮不动，倾向记 backlog**，请用户拍板是否值得。
3. **RN 侧 `index.ts` 主入口那 12 行转出是否只为测试保留**？若只是为了测试能 import 而在**生产主入口**上加转出，属于为测试污染生产面；替代形态是子路径导出。**请用户拍板**。
4. **本次行为变更要不要补 CHANGELOG**？v2 `full/K-1` 已把 ①②③ 的 CHANGELOG 同步列过一条，但 ⑤ 敏捷项（`f0186106` / `4e179e1a`）**不在 v2 的 CHANGELOG 范围内**，且它带来的是**用户可见的行为变更**（中文会话占用读数大幅上移、压缩触发点前移）。**请用户拍板是否补 `CHANGELOG.md` Unreleased**。
5. **RN 侧 `countTiktoken` 仍「每调用建表 + `free`」**，与 Node 侧新的「单例 + 不 free」**并存且口径相反**。mobile 的流式估算已经改走单例（`getRnEncoding`），但 `countTiktoken` 这条路径仍在每调用建表。**是否要一并收敛、还是有意保留**（例如它只用于一次性 CLI/工具场景）？
6. **失败缓存 `null` 不重试，在 RN 上是否会因一次瞬时失败导致整进程退化**？Node 侧有 `registerTokenizerNodeDriver` 兜底，RN 侧一旦 `getRnEncoding` 因瞬时原因失败并把 `null` 缓存住，**整进程后续都走字符折算**。**要不要加延迟重试 / 短 TTL**？
7. **core `typecheck` 不覆盖 `test/**` 这条结构性缺口是否单开一条**？实查：`packages/core/tsconfig.json` 的 `include` 只有 `["src/**/*"]`；`tsconfig.test.json` **因 `rootDir` 报错跑不了 `tsc -p`**（实跑 `TS6059`）。后果就是 `ctx-exec-1` 那 4 处 TS 超额属性错误**零门禁可拦**。**请用户拍板是否单开一条修**（修它会让一批历史测试的类型债一次性暴露，需预留处理量）。
8. **双端注释里「见 ③ spec `:46`」的行号已漂移**。③ spec 的「范围收窄」段**实际在 `:50`**，而代码/文档里若干处仍写 `:46`。**是否本轮统一刷一遍行号引用**（本轮**未列入** must-fix——只影响阅读、不影响行为，且散布在多个文件，混进本轮会扩大 diff）。
9. **（v3 修订轮新增）⑤ 两份留痕文档的「用例条数副本」要不要彻底去重**。`spec.md:63` 抄了一份 PRD「测试用例」表的数字，**任何一边改数字就会分叉**——`agile-1` 让 core 6→7 就是活例子（前一轮 `agile-5` 改了 PRD、没看见 SPEC 那份，直接制造了新分叉）。本轮已在 `agile-5` 授权里**把这一处改成引用式写法**（推荐支），**但没回答更一般的问题**：这类「跨文档数字副本」**要不要列成一条常规纪律**（写进 RULE / 文档模板检查：spec 只许引用 PRD 的表，不许复述数字）？**请用户拍板**。
10. **（v3 修订轮新增）「token/字符」比值的单一事实源要不要落进常驻文档**。`units-1` 能把全仓 **10 处**倒置单位改对，但 `1.64` 这个数**同时散在代码注释、测试注释、PRD、SPEC 四个层次**，且**随 `js-tiktoken` 版本漂**（`agile-1` 之所以禁止硬编码数字，正是同一个原因）。**要不要立一条常驻口径**（例如写进 `docs/apm/RULE.md`：凡涉及 token/字符换算的表述**一律双写**「≈X token/字符（≈Y 字符/token）」，不许单边；或指定一个可被 import 的常量作单一事实源）？**请用户拍板**。

---

## 已豁免（用户确认不修）

- 本轮**无**经用户显式确认豁免的 must-fix。
- 上面「Open questions」**10 条**（**v3 修订轮新增 2 条**：#9（用例条数副本是否彻底去重）、#10（「token/字符」单位是否落 RULE 作单一事实源））**不是豁免**，是**待拍板**：拍板结果可能是「修」「记 backlog」「不修」三选一。执行方**不得**在未拍板前把它们当「已豁免」跳过，也**不得**顺手改。

---

## 合并后 QA（manual_user）

> 本轮 12 条**全部不上真机**（无一条是 UI / 渲染层行为变更；唯一影响主进程的是 `agile-3` 的**空闲预热**，它不改变任何读数口径）。

| 项 | 复验内容 | 触发方式 | 备注 |
|---|---|---|---|
| `agile-1` | ①30K 中文计数 **≤400ms**；②病态档 12K 无空白中文串 **≤1s**；③中文正文相对全量 `encode` 误差 **≤1%**；④新用例的**双边夹逼**上下界都成立 | Node 侧定向跑 `packages/core/test/infra/tokenizer/count-text-with-tokenizer.test.ts`（**desktop / mobile 端不需要真机**） | 门限收紧的**原因**见该条：切分节奏变了（`tail.slice` 约 370 → 约 470），没有硬指标无法判退化。**v3 修订轮**：④ 必须**带 bug 的实现跑不过**（带 bug 时兜底值 `text.length ≈ 0.61 × encode(正文)`、**低于真值** → **下界先炸**，wave-1 实测报错 `不可编码尾段不得吞掉已固化计数：12224 < 真值 17200`；**上界 `× 1.05` 防的是多算 / 虚高那一侧**；**双边夹逼保留** = 两条都断言，同时覆盖少算与多算）——执行方**改完先故意回退验证一次红**，别只验绿 |
| `agile-3` | desktop 冷启动后立即发一条消息，**首次上下文占用计数不应出现可感卡顿** | Electron 桌面端冷启动 → 立刻进一个有中文历史的会话 | 预热是**空闲**的，理论上不阻塞；这一条只是确认「预热没把卡顿从兜底搬到启动」。**可延后到 1310 包一起做** |
| `metrics-exec-1` | 四个文件的注释人工对读 + **两条** grep 各自零命中（⚠️ grep 抓不到 `:150`，见该条） | 纯文档 | 确认 `:1104-1105` / `useAgentStreamMetrics.ts:8` / `session-stream-unit.ts:159` / `:625` **未被连坐** |
| `units-1` | 10 处逐处人工对读 + 另 7 处同批次措辞对读（⚠️ `count-prompt-llm-input.ts:7` 与落点 `:52` 同文件、grep 抓不到）+ `git grep -n "1.64 字符/token" -- apps packages docs` 零命中 | 纯注释 / 纯文档 | 「`1.64` 后只跟 `token/字符`」；英文那半的「3.5~3.6 字符/token」与「82%~84%」**不许动** |
| `ctx-exec-1` | core 四个测试文件实跑全绿；`git grep runId` 在两个测试目录下零命中 | 纯测试 | 删字段不该改行为；红了说明某处真依赖它 |
| 全部文档类 | `agile-5` **四处**、⑤ `spec.md:78`（`agile-3` 改法 #6）、v2 `full2/E-1` 四行（`metrics-exec-3`）+ 枚举补全（`ctx-exec-2`）人工对读 | 纯文档 | `agile-5` 的前三处**已落盘**、第四处（`spec.md:63`）由下游做；`agile-5` 明确**不上数字 grep 门禁**，回报改前 / 改后原文即可 |

> **不上真机的理由**（写死，免得下一轮又把它列进去）：本轮 12 条里**没有一条改变读数口径给用户看**——`agile-1` 是把**已经低估的数**修准（只会往上走）、`agile-2` / `agile-3` / `agile-4` 是装配与覆盖、`metrics-exec-*` / `ctx-exec-*` / `units-1` 全部是注释与留痕文档。**真机复验的口径仍是 v2「合并后 QA」那一张表**（1310 包），本轮**不新增行**。
>
> **但要记住一条**：如果本轮在 1310 包之前落地，`agile-1` 改的是**⑤ 敏捷项的读数来源**（`countTextWithIncrementalTokenizer`），而 ⑤ 的真机复验项「中文会话的『预估』读数不再低估」原本是按**旧 helper** 测的基准。**1310 包出包时应以本轮落地后的实现为准重测那一项**，别拿旧基准对。

---

## K 节建议（下游执行时闭合）

1. **只跑定向测试，不跑全量 prettier。** `apps/mobile` 基线已有 **635 个文件**不合规，跑全量 `format:check` / `prettier --write` 会引入与本轮修复无关的噪声 diff。本轮只对本轮**改动过的文件**跑 eslint / typecheck。
2. **`metrics-exec-3` 与 `ctx-exec-2` 是对 v2 自身文本的订正，不是对代码的改动。** 这两条**不产生任何实现 diff**——执行方改完要在回报里**单独列出来**，不要混进「代码改动」清单，否则会误判本轮的实现变更面。判定口径：改的**只有** `cr-fix-spec-v2.md` 这一个文档。
3. **`ctx-exec-1` 删字段前先确认那 4 处不是有意在造「老行」**。若某处本意如此，按该条改法 #2 改用裸 `JSON.stringify({ ... })` 的写法（照 `session-api-prompt-token-store.test.ts:77-92`），**不要**为了「保住测试意图」而往类型化入口塞超额键——那等于把 TS 错误换个地方藏。
4. **`agile-1` 的三条硬门限（≤1% / ≤64 字符 / ≤400ms / ≤1s）是执行方验收的判据，不是「可讨论的建议值」**。任一条不达标就要回来讨论，**不许自行放宽门限**（放宽会把这个 fix-spec 变成下一个复读的误导源）。若确实要放宽，按 v2 的做法**先在 spec 里登记 + 请用户照准**。**外加 v3 修订轮的第 5 条：那条新用例必须「带 bug 时红、修好后绿」——只验绿等于没验。**
5. **`agile-2` 的禁令要落进代码注释，不只是本文件的条目**。理由写死：这是唯一一处「**编译期零告警、运行期才炸、且今天不炸只因另一条链没用到**」的缺陷——没有注释，下一个人做「简化」时一定会把它改回去。**v3 修订轮补的 grep 门禁是第二道防线，不能替代代码注释。**
6. **`agile-3` 的预热不许改成同步 await、不许去掉 try/catch**。启动路径一旦可能抛错，就是把「偶发的一次性卡顿」换成「启动失败」，那是净负收益。**同理，mobile 侧只登记口径、不许顺手加冷启动预热**（改法 #6 已写死这个低成本取向）。
7. **`metrics-exec-1` 的 grep 门限抓不全**（`useAgentStreamMetrics.ts:150` 的「零变化」被换行拆开）。**grep 之后必须人工对读**，并且**同时确认那四处「对的严格一致」没被连坐删改**（`:1104-1105` / `useAgentStreamMetrics.ts:8` / `session-stream-unit.ts:159` / `:625`）。这是本条最容易「假绿」的地方。**另：两条 grep 必须拆开跑**（Windows cmd 下 `\|` 组合模式不可靠，见 v2 K 节）。
8. **执行完成后**：把本文件「状态」从 `draft` 推进、把「Spec deviations」**5 行**逐行标注闭合指向、填「Fix-Spec Closure」。**不要动 v2 的任何其它内容**——v2 已执行完毕、状态 dev-ready，本轮对它只有 `metrics-exec-3`（`full2/E-1` 四行）与 `ctx-exec-2`（枚举补全）这类文本订正。
9. ⚠️ **（v3 修订轮新增）行号类验收一律以 `git grep` 锚点定位，不写死行号**。**本轮 v3 自己就踩了两次**：① 元信息里对 v2 的自指行号（`:739` / `:746` / `:749`、`:11` / `:18` / `:967`）**落盘即漂**（真值变成 `:739` / `:747` / `:750`、`:11` / `:18` / `:968`）；② 敏捷项留痕文档的落盘行号（`prd.md:58` / `:60` / `:31`、`spec.md:47` / `:76`）**因为前一轮插入了新行而整体下移**（真值 `:59` / `:61` / `:32`、`spec.md:78`）。**所以本文件里凡是「文件:行」的表述，都配了「锚点句」或「行号免责」**——下游照做时**先 `git grep` 定位锚点、再取行号**，不要把本文件写就时的行号当权威；**写验收命令时也优先写锚点（可 grep 的那句话/那个符号）而不是行号**。
10. **Windows cmd 下 grep 的一条通病：组合模式与不限目录都很危险**。本轮实查踩到两次——① `"零变化\|零回归"` 这种 `\|` 组合在 v2 K 节已登记不可靠（→ 拆两条）；② `git grep -n "\.\.\..*[Rr]egistry" -- apps packages` 会命中 `packages/tokenizer-driver-node/assets/tokenizers/*.json` 里的 tokenizer 资产，**输出 78MB 直接不可用**（→ 必须显式列目录）。**写门禁时默认拆条 + 限目录。**

---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| **fix-spec-ready** | **yes**（主代理 2026-09-27 判定）。判据逐条落地：**未写入的开放 must-fix = 0**；12 条 must-fix 全部「有文件 + 改法 + 验收」；无 open spec_deviations（5 行均由条目闭合）；Closure 表已附。⚠️ **ready ≠ 已修**——**12 条仍待执行**，须等用户指令。 |
| **执行状态** | **未执行**（12 条 must-fix 一条都还没做）。本轮**只改文档**：新建本文件 + 订正 v2 **一处**（`full2/E-1` 的「改法 #1」旧行号；前一轮另已落盘 `metrics-exec-3` 三行 + `ctx-exec-2` 三行）+ 敏捷项留痕文档**五处**（`agile-5` 三处 `prd.md:59`/`:61`/`:32`、`agile-1` 的 `spec.md:47`、`agile-3` 的 `spec.md:78`，**均为前一轮落盘**）+ **本文件自身 N-1 ~ N-9 九处纯文本收口（第 3 轮评审查出，已在本轮直接落盘、无需下游执行）**。**未改任何实现代码、未跑门禁、未做任何 git 写**（⚠️ 另：v3 收尾节点按 `n5b-docs-residue` 授权把 wave-1 之后的**代码侧参考行号**（desktop hook **+2** / mobile unit **+1**）在 v2 与本文件里统一同步了一次，并把 3+1 处「论证方向写反」的**倒置比值**残留收口为正确方向（**下界咬 bug、上界防虚高、双边夹逼保留**）；**纯文本收口，不改任何计数与状态**，状态与本表由主代理收口） |
| **fix_spec_path** | `docs/Iterations/stream-metrics-native-integration-cr/cr-fix-spec-v3.md` |
| **base_sha / head_sha** | `5c63d27e` → `f4cd067a`（**评审范围**；执行后的 HEAD 以 `git log -1` 为准，不写进本字段） |
| **dag_version / review_round** | 1 / **1 → 2**（round 2 = `review-full` 复核，本轮据此修订，**无新增漏项**）。⚠️ 第 3 轮 `review-full` 复核产出的 N-1 ~ N-9 **是 fix-spec 自身的纯文本瑕疵、不是新 must-fix**，故 `review_round` 字段与 `dag_version` **一律不变**——**它没有新增任何条目，四项计数口径全部沿用** |
| **N-1 ~ N-9（fix-spec 自身文本瑕疵）** | **9 处，已在本轮直接落盘、无需下游执行**；**不计入** must-fix 计数。口径：N-1 / N-2 是「已豁免」段与 Closure 表的 **OQ 计数与编号自相矛盾**、N-3 是 `units-1` 的**文件计数笔误**、N-4 是「本节点」**作用域自相矛盾**、N-5 / N-6 是 `agile-1` 的**毒串长度与正文长度前提**、N-7 是 `agile-4` 的 **PRD 行号偏一位**、N-8 是 `agile-3` 的**缓存键 / JSDoc 行号不准**、N-9 是 `units-1` **同批复核清单漏 1 处**。另：第 4 轮终验残留的 **R4-01**（毒串「末尾 8 字符」残留）与 **R4-02**（把 `prd.md:57` 说成表头行，实为分隔行）两处，已由**主代理按 skill 的 trivial 直接执行豁免**一并改正（改动仅本文件两行文本） |
| **P0 / P1 / P2（已写入 fix-spec）** | **0 / 1 / 11**（合计 **12** 条）。P1 = `agile-1`；P2 = `agile-2` ~ `agile-5`、`metrics-exec-1` ~ `3`、`ctx-exec-1` ~ `3`、**`units-1`**（v3 修订轮新增） |
| **未写入的开放 must-fix** | **0**（三个 scope 的 11 条 + 修订轮新增的 `units-1` 已全部写入；评审提的其余疑点已全部进 Open questions **10** 条，**未按 must-fix 记**）。⚠️ 第 3 轮查出的 N-1 ~ N-9 属**本文件自身文本瑕疵**、已就地落盘，**同样不算 must-fix** |
| **spec_deviations** | **5 行、全部 open，均由上列 must-fix 条目闭合**：#1 → `agile-1`（**闭环依赖 v3 修订轮的双边夹逼断言 + 三处注释授权**）；#2 → `agile-3`（**含 mobile 侧对称口径**）；#3 → `agile-5`（**含 `spec.md:63` 副本收敛**）；#4 → `ctx-exec-1`；**#5 → `units-1`**（v3 修订轮新增：单位倒置） |
| **C-orch** | ✅ 已查（三个 scope 的跨层装配问题均已定位到具体落点：`agile-2` 的 registry 展开丢原型方法、`agile-3` 的驱动注册与预热落点、`ctx-exec-1` 的类型化入口边界） |
| **合并后 QA（manual_user）** | **不阻塞**：本轮 12 条**全部不上真机**（无一条是 UI / 渲染层行为变更）。真机复验沿用 v2「合并后 QA」那张表，**本轮不新增行**；唯一需注意的是 `agile-1` 落地后 1310 包的「中文预估读数」基准要以新实现重测 |
| **Open questions** | **10 条**（不阻塞执行；v3 修订轮新增 ⑨⑩，故既有 8 条 + 新增 2 条 = 10，**编号 ①~⑩ 各出现一次**）：① Node 侧不 free 的内存上界 + 清理函数无调用方；②两份 `encoding-cache.ts` 是否收敛到 core；③RN `index.ts` 那 12 行转出是否只为测试；④ 敏捷项要不要补 CHANGELOG；⑤ RN `countTiktoken` 每调用建表与新单例并存；⑥失败缓存 `null` 不重试在 RN 上的整进程退化风险；⑦core `typecheck` 不覆盖 `test/**` 是否单开一条；⑧双端「见 ③ spec `:46`」行号漂移是否统一刷；**⑨⑤ 两份留痕文档的「用例条数副本」要不要彻底去重**；**⑩token/字符 比值的单一事实源要不要落进常驻文档** |

**唯一 P1（最要紧）**：`agile-1` —— core helper 在尾窗整段不可编码时**丢掉已固化的计数**，返回**低于真值 36%** 的数（实测 6,024 vs 真值 9,421）。方向与本迭代「把折算换成真分词器」的目标**完全相反**：它会在毒串恰好落在尾窗时，把已经数准的上下文占用重新打回一个偏低的数，并把该行为在注释里称作「上界」。**改法已写死（收紧尾窗 → 读值路径不再可能失败），无二选一。**
⚠️ **v3 修订轮给这条 P1 补了一条硬要求**：护栏用例**必须双边夹逼**（`encode(正文) <= count <= encode(正文) × 1.05`）。**咬住这个 bug 的是下界**——它的兜底值是 `text.length`，中文下 ≈ `0.61 × encode(正文)`、**低于真值**，必然跌破 `count >= encode(正文)`（wave-1 实测报错 `不可编码尾段不得吞掉已固化计数：12224 < 真值 17200`）；**上界 `× 1.05` 防的是多算 / 虚高那一侧**（毒串按 1:1 计入等）。**双边夹逼保留**：两条都断言 = 同时覆盖「少算」与「多算」。**执行方改完必须先回退验证一次红，再确认绿。**

**轮次记录**：增量第二轮 CR（v2 已执行、dev-ready）→ **集成评审 round 1**（三个 scope：agile 5 条 / metrics-exec 3 条 / ctx-exec 3 条）→ **本文件 `cr-fix-spec-v3.md` 初稿（draft，11 条）** → **round 2 `review-full` 复核（无漏项、无 OQ 误升；12 处「照做也闭不干净」的缺陷 F-1 ~ F-12）** → **v3 修订轮（12 条：F-1 改 `agile-1` 断言为双边夹逼、F-8 新增 `units-1`、其余 10 处为补授权 / 补 grep 门禁 / 补登记 / 修行号）** → **round 3 `review-full` 复核（F-1 ~ F-12 修订 12/12 全部闭合，5 组未落盘项登记完整、无重复无冲突；另查出 9 处 fix-spec 自身纯文本瑕疵 N-1 ~ N-9）** → **纯文本收口轮（N-1 ~ N-9 直接落盘，不计入 must-fix 计数）** → **round 4 `review-full` 终验（N-1 ~ N-9 全部落盘、8 项独立实查通过；仅余 R4-01 / R4-02 两处一行文本瑕疵，判定「不改变任何 must-fix 的改法与验收」）** → **主代理 trivial 直接执行（改正 R4-01 / R4-02 两行）→ 判定 `fix-spec-ready`（2026-09-27）**。
