# judge-r1 · R1 全局收口裁决（R1 judge 报告）

> 裁判：`judge-r1`（全局唯一机位）。基线 `fe79b7810c0c78c48a18c76486359d7d45e253fa`（worktree `D:\Dev\nm-worktree\mcr`）。
> 输入：PLAN.md 第四章 S 阶段协议、`fix-spec/{SPEC,baseline,state}.md`、11 个分片首尾与分片级注记、
> `raw/sr1-*.md` × 28 份审查报告的结论节与 must-fix 清单节、`registry.md` 待 judge 段。
> **纪律**：全程只读（零 git 写、零 `docs/apm/` 写、零 fix-spec 分片改动）；本文件是本轮唯一产物。
> 凡裁决与 reviewer 报告冲突处，本报告给出**自己复核的代码 file:line** 或**自己实跑的复现命令**。

---

## 摘要（先说结论）

**R1 结论：No-Go。**

不是「P0 未闭合」意义上的 No-Go——**5 条 P0 全部有七要素条目、修法可执行**。
No-Go 的原因是三条**验收地基级**问题：

1. 🔴 **`baseline.md` §1.1 的「根 build TS5042 根因」是错的**，且这个错误结论已经渗透进
   wave-a §9.2、wave-d §0/§1、registry 待 judge ①，并被提成了「要不要立新条目」。
   我实跑证明：**干净的 `npm run build --workspaces --if-present` exit 0、零 TS5042、preload 正常产出、
   desktop smoke 9/9 全绿**。TS5042 是**测量机位自己的 shell 包装**（cmd.exe 不认 `;`，
   把 `; echo EXITCODE=$?` 当成三个位置参数转发给了每个 workspace 的 `tsc`）造成的**测量假象**，
   不是仓库缺陷、不是 npm 缺陷、不是 CI 缺陷。
2. 🟠 **台账 40 条 P1 里有 7 条在 11 个分片中没有任何七要素落位**（AM-3 / CD-01 / CS-03 / M-01 /
   S-D-04 / E / F-synth-dead-2），另有 1 条（F-synth-dead-1）只有半条。SPEC §1 承诺的「全部 P1（40）」
   与磁盘实况不符。
3. 🟡 **SPEC §3 全局依赖图缺 3 条跨片边**，其中两条是「同一个文件被两片同时改」
   （`run-tests.mjs` 的 N-P0-02↔H6、`tsconfig.test.json:26` 的 D-207↔X4）——不补进依赖图，
   execute 阶段必然撞车。另有 apps §5 与 wave-e X2 R1–R6 的分批归属冲突未裁。

R2 的 must-fix 总表见文末。**13 条待 judge 注记已全部裁决**（B 节），其中 4 条转 R2 落文档、
2 条转 execute-ready 时请用户拍、其余就地闭合。

---

## A · 覆盖完备性对账（SPEC §2 分配表 × 分片实际条目）

### A.0 P0 终表 5 条 —— **5/5 齐**

| 台账 P0 | 分片落点 | 七要素 | 我复核的代码证据 |
|---|---|---|---|
| **RT-02**（core-runtime） | `wave-a.md` A1（:28） | ✅ | `agent-runner.ts:411` `let stepCompactionEmitted = false;` / `:413` `let visible = await session.list();` / `:519` `shouldRequestCompaction(this.deps.session, …)`；`visible-floor.trigger.ts:21` `const visible = await session.list();` —— 四处逐行在位 |
| **N-P0-01**（webview bundle） | `wave-a.md` A2（:222） | ✅ | `prompt-macro-input.ts` 深层直引面；分片自报 21,826 字节基线 |
| **N-P0-02**（desktop 零收集假绿） | `wave-a.md` A3（:428） | ✅ | `apps/desktop/scripts/run-tests.mjs:27-30` 单引号 `testTargets` + `:32-35` `execSync(…, {shell:true})` 逐字在位。**我实跑复现**：`cd apps\desktop && npm test` → `# tests 0 / # fail 0`（exit 0，假绿成立） |
| **N-P0-03**（CLI 开不了第一个会话） | `wave-a.md` A4（:595） | ✅ | `apps/cli/package.json:17` `tsx --test test/**/*.test.ts` |
| **S-CS-01**（云同步 rev 永不推进） | `wave-b-cloudsync.md` §2（:191） | ✅ | `apps/desktop/src/main/services/db-backup.service.ts:113-129` 三处 `.catch(() => undefined)` 逐字在位（`:114` bak 拷贝 / `:125` 回滚 / `:128` unlink） |

**结论：P0 全部有落位、可执行、彼此无重复。** 这是 R1 最扎实的部分。

### A.1 P1 终表 40 条 —— **32/40 有落位，7 条无落位，1 条半落位** 🟠

台账 P1 = §2.2~§2.9 各簇合计 39 条 + §8.1 终裁入账的 RT-01 = **40 条**（与 `ledger-v2.md:549` 一致）。
逐条对账结果：

| # | P1 | 簇 | 分片落位 | 状态 |
|---|---|---|---|---|
| 1 | RT-04 | core-runtime | `wave-b-core1.md` B1-4（:319） | ✅ |
| 2 | RT-08 | core-runtime | `wave-b-core1.md` B1-5（:430） | ✅ |
| 3 | **CD-01**（回滚 plan 不同源） | core-data | — | 🔴 **无落位** |
| 4 | CS-01 renamePrefix | core-storage | `wave-b-core1.md` B1-1（:28） | ✅ |
| 5 | CS-02 oldString 空串 | core-storage | `wave-b-core2.md` §6（:766） | ✅ |
| 6 | **CS-03**（LCS DP/spread 上限） | core-storage | — | 🔴 **无落位** |
| 7 | CS-04 sweep 第 3 步死语句 | core-storage | `wave-b-core1.md` B1-3（:215） | ✅ |
| 8 | CS-05 导入事务分片 | core-storage | `wave-c2.md` C2-1（:29） | ✅ |
| 9 | CS-06 writeOrUpdateFile | core-storage | `wave-c2.md` C2-4（:557） | ✅ |
| 10 | CS-07 DELETE 触发器 | core-storage | `wave-b-core2.md` §7（:869）**权威** | ✅（`wave-c2.md` C2-5 已注记化 :698） |
| 11 | CS-08 导出丢同名文件 | core-storage | `wave-b-core2.md` §8（:1104） | ✅ |
| 12 | CS-09 ZIP 闸 | core-storage | `wave-c2.md` C2-8（:921） | ✅ |
| 13 | CS-10 checkpoint 900 分片 | core-storage | `wave-c2.md` C2-9（:1076） | ✅ |
| 14 | CS-11 copy 事务内全量读 | core-data | `wave-c2.md` C2-3（:433） | ✅ |
| 15 | N-P1-01 项目删除泄漏 | core-storage | `wave-b-core1.md` B1-2（:113） | ✅ |
| 16 | **M-01**（重试探针） | core-misc | — | 🔴 **无落位** |
| 17 | M-03 假时间戳 | core-misc | `wave-b-core2.md` §4（:509） | ✅ |
| 18 | M-04 删模型守卫漏扫 | core-misc | `wave-b-core2.md` §5（:629） | ✅ |
| 19 | N-P1-02 白名单漏字段 | core-misc | `wave-b-core2.md` §1（:84） | ✅ |
| 20 | N-P1-06 importRules 无事务 | core-misc | `wave-c1.md` C1-6（:574） | ✅ |
| 21 | N-P1-07 五处多语句无事务 | core-misc | `wave-c1.md` C1-7（:731） | ✅ |
| 22 | S-CS-02 单例不随 rebootstrap | cloudsync | `wave-b-cloudsync.md` §4（:537） | ✅ |
| 23 | S-CS-03 pull 不查 isAgentActive | cloudsync | `wave-b-cloudsync.md` §6（:774） | ✅ |
| 24 | S-CS-04 busy 令牌泄漏 | cloudsync | `wave-b-cloudsync-x1.md` §1（:33） | ✅ |
| 25 | S-CS-07 备份三处吞错 | cloudsync | `wave-b-cloudsync.md` §1（:38） | ✅ |
| 26 | S-CS-08 S3 多余拷贝 | cloudsync | `wave-b-cloudsync-x1.md` §2（:250） | ✅ |
| 27 | S-CS-09 etag-only 覆盖 rev | cloudsync | `wave-b-cloudsync-x1.md` §3（:390） | ✅ |
| 28 | S-CS-16 记账点在 rebootstrap 前 | cloudsync | `wave-b-cloudsync.md` §3（:445） | ✅ |
| 29 | AM-1 forgetSession + LRU | apps-mobile | `wave-b-apps.md` §3（:341） | ✅ |
| 30 | **AM-3**（RealPrompt 路由无 scope） | apps-mobile | — | 🔴 **无落位** |
| 31 | N-P1-03 函数进 route params | apps-mobile | `wave-b-apps.md` §4（:561） | ✅ |
| 32 | S-D-02 staging 清理无路径断言 | apps-desktop | `wave-b-core2.md` §10（:1329） | ✅ |
| 33 | **S-D-04**（dirtyViews 守卫恒 false + App ⚡ 旁路） | apps-desktop | — | 🔴 **无落位** |
| 34 | B（formSnapshotJson 缺 mode） | apps-desktop | `wave-b-core2.md` §9（:1222） | ✅ |
| 35 | **E**（加载失败丢原绑定模型） | apps-desktop | — | 🔴 **无落位** |
| 36 | N-P1-04 600ms 定时器闭包 | apps-desktop | `wave-b-apps.md` §1（:65） | ✅ |
| 37 | N-P1-05 renderer 零门禁 | apps-desktop | `wave-e.md` X2（:241） | ✅ |
| 38 | **F-synth-dead-1**（L0 桶定义缺陷） | dead-backlog | `wave-d.md` :22/:456/:791 只有口径注记 | 🟡 **半落位** |
| 39 | **F-synth-dead-2**（13 份快照 551 名字） | dead-backlog | — | 🔴 **无落位** |
| 40 | RT-01（§8.1 终裁 P1） | core-runtime | `wave-b-core1.md` B1-6（:520） | ✅ |

**§6 复核入账 7 条 P1（SPEC §1 R1 轮更新）—— 7/7 齐**：

| §6 # | 条目 | 落点 | 复核 |
|---|---|---|---|
| #4 | 附件数组整体降级 | `wave-b-core1.md` B1-8（:746） | ✅ |
| #5 | ChatHistorySearchPanel 白屏 | `wave-b-apps.md` §2（:208） | ✅ 我复核 `ChatHistorySearchPanel.tsx:106` `setError(result.error ?? '查询失败');` 逐字在位 |
| #8 | gemini 同名并行塌陷 | `wave-c1.md` C1-8（:903） | ✅ 我复核 `gemini-sse-parser.ts:122` `const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;` + `:133-136` 赋值非累加 |
| #9 | anthropic max_tokens 4096 | `wave-c1.md` C1-9（:1045） | ✅ 我复核 `resolve-thinking-wire.ts:18` `const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096;` 逐字在位 |
| #10 | thinkingSignature 丢失 | `wave-c1.md` C1-10（:1199） | ✅ |
| #11 | Kotlin callTimeout 静默吞 | `wave-c1.md` C1-11（:1356） | ✅ |
| #12 | SkspModule 无 Executor | `wave-c1.md` C1-12（:1560） | ✅ |
| #3 | composer-draft 全有或全无 | `wave-b-core1.md` B1-7（:619）**降 P2** | ✅ 降级正确（写侧恒 `attachments: []`） |

### A.2 7 条无落位 P1 的成因分类与裁决

这 7 条不是同一种漏法，必须分开处理：

**（a）台账 §10 已排进 Wave、但没人写 —— 真漏，须 R2 补写**

- **AM-3**（`ledger-v2.md:159`，`navigation/types.ts:16` `RealPrompt: undefined`，
  `RealPromptScreen.tsx:20-23`，两处入口 `SessionDetailScreen.tsx:397` + `useChatTabController.ts:106-107`）。
  证据链：`ledger-v2.md:457` 的 Wave B「（同波顺带）」行**明确列了 AM-3**；
  `wave-b-core2.md:1514` 自己也写了「AM-3 → `wave-b-apps`，不立条」；
  但 `wave-b-apps.md` 的 §0.1 条目一览（:22-27）只有 4 条（§1 N-P1-04 / §2 §6#5 / §3 AM-1 / §4 N-P1-03），
  **AM-3 不在其中**。⇒ 认领链断在最后一跳。
  **裁决：R2 必须补写，落 `wave-b-apps.md`（与 §3 AM-1 同族、同为 mobile 会话生命周期，量 S）。**

- **CD-01**（`ledger-v2.md:110`，`message-rollback.service.ts:144-264,203-216,399,562-565`，
  4 源印证 + 对抗 upheld + W6 confirmed）。这条最尴尬：**两个分片都声明「不归我」然后互相指向对方**——
  `wave-c1.md:1767-1777` 说「它归 wave-c2……更正……judge 必须裁定真正的 CD-01 归哪个分片……本分片不认领」；
  `wave-c2.md:1249` 说「CD-01 归 wave-c1（s-wave-c1）」。两边形成死循环式甩锅。
  `SPEC.md:25` 的分配表把 Wave C 的「CD-01」写成「全量读收窄残留」，指的是 **CD-13（fork 缺上界读口）**，
  不是这条回滚——台账 §10 `:463` 自己也把 fork 那条误写成 CD-01（`wave-c1.md:43-46` 已指出编号碰撞）。
  **裁决：归 `wave-c2.md`（新增一条），理由三条**：
  ①它是**回滚正确性**（静默丢文件 / 无主残留）不是性能结构，与 wave-c2 的事务边界族同源；
  ②`wave-c2.md` N-3（:1256-1271）已经把「产出写集合的扫描必须留在事务内」这条判据写死，
  CD-01 正是该判据的原型范例，落在同一片才能被该判据覆盖；
  ③它与 C2-1/C2-2 共享 `conn.transaction` 与 AsyncMutex 不可重入的纪律。
  同时**正名**：`ledger-v2.md:463` 的「CD-01 fork 缺上界读口」→ **CD-13**。

**（b）台账 §10 从未把它排进任何 Wave —— 须显式裁决「补排」或「登记为已知限制」**

- **CS-03**（`ledger-v2.md:120`，`longest-common-substring.ts:140-142,164`；DP 换滚动两行 +
  `Math.min(...arr)` 换循环 + 超阈值降级；量 M；W6 实跑 689MB / RangeError / spread 上限 ≈2×10⁵）。
  §10 的 Wave B 与 Wave C 两张表**都没列它**。全 fix-spec 目录仅 `wave-b-core2.md:858` 一句
  「与 CS-03 同文件族但不同文件，wave-c2 可并行」的顺带提及。
- **M-01**（`ledger-v2.md:135`，`model-request.service.ts:69-104,211-243`；
  **三源顶格 + W3 实跑复现 + W8 对抗双签**；量 M）。§10 同样未列。
  全目录仅两处提及：`wave-b-core2.md:341`「不依赖 `M-01`（重试探针）」、
  `wave-e.md` H5.1.3 只写一条 `test.todo` 留证用例（明确「不碰实现」）。
- **S-D-04**（`ledger-v2.md:167`，`AgentEditorView.tsx` 全文零 `dirtyViews` + `App.tsx:344` ⚡ 旁路；
  多源 + W6 盲扫独立重推导 + W9 双源；量 M）。§10 未列。
  `wave-b-core2.md:1316-1317` 只说「与 S-D-04 同文件不同问题」，`:1428` 说「与同簇的 S-D-04 互不依赖，可并行」——
  **两处都把 S-D-04 当成一个已存在的兄弟条目，但全目录没有任何一片写了它**。
- **E**（`ledger-v2.md:169`，`AgentEditorView.tsx:232-244,286-303,346-356`；
  加载失败时保留 `def.model` 原值 + 渲染提示；量 M）。§10 未列。全目录零提及。
  我复核病灶在位：`AgentEditorView.tsx:346-356` `const allModels = await loadAllSavedModels(providerRows);`
  → `applyDefinition(def, pinned != null ? {…} : null)`，加载失败时 `pinned` 为 `undefined` ⇒ 传 `null` ⇒ 原绑定被静默解除。

**裁决（S-D-04 / E / CS-03 / M-01 四条）**：这四条都是**量 M、机理闭合、已被多源印证**的 P1，
把它们留在台账里当「已知限制」等于把 R1 的 No-Go 理由永久化。**R2 必须补排并补写**：
- **S-D-04 + E** → 落 `wave-b-apps.md`（与 §1 同文件 `AgentEditorView`/设置页族；E 与 B 条同属
  `AgentEditorView` 的保存/加载链，与 `wave-b-core2.md` §9 的 B 条同 PR 最省事）；
- **M-01** → 落 `wave-b-core2.md`（provider 域，与 M-04 同族；`wave-e.md` H5.1.3 的 `test.todo`
  可直接升级为它的测试落点）；
- **CS-03** → 落 `wave-c2.md`（core-storage 性能族，与 C2-8/C2-9 同波）。

**（c）★1 拍板项的从属条目**

- **F-synth-dead-2**（`ledger-v2.md:181`，13 份快照 551 个去重名字；修法栏原文就是「见拍板项 #1」）。
  它不是一个可独立施工的条目，**是 ★1 的解锁对象本身**。
  **裁决：不补写七要素条目，改为在 `SPEC.md §4` 的 blocked 汇总里显式登记一行**
  「F-synth-dead-2 = ★1 的解锁产物，随 ★1 一并处置」，避免下轮有人当成漏条重排。
- **F-synth-dead-1**（`ledger-v2.md:180`，修法 =「`testOnly` 排除 `relayed` 后重跑 L0」）。
  `wave-d.md` 三处（:22 / :456 / :791）都把它当**口径前提**在用（`L0/dead-exports.md` 只作线索源），
  但没人写它的施工步骤。
  **裁决：半条补齐**——落 `wave-d.md`，只写「重跑 L0 + 重分桶 + 把新桶定义回写 `L0/dead-exports.md`」
  三步 + 一条硬门槛（`★1` 解锁前必须先跑，否则 A.2/A.3 两档的分类都不可信——`sr1-d-c` 债务池抽验
  已实证这一点）。量 S，不阻塞 D 批次 1/2。

### A.3 重复条检查

- **CS-07 双片谱系**：已归一。`wave-b-core2.md` §7 为权威（:869，其「谱系」小节 :873-888 把
  UPDATE 触发器、触发器改名纪律、`vfs-gc-trigger.test.ts` 测试落点三样上收完毕），
  `wave-c2.md` C2-5 已注记化（:698，七要素删除、只留交叉引用）。**我复核无重复、无悬空**：
  `vfs-revision-schema.ts:44-54` 的 DELETE 触发器归零判定确实**无** `AND NOT EXISTS`，
  `:57-68` 的 UPDATE 触发器 `:64-65` 确有逐字同款归零删除 —— core2 收 UPDATE 的判断成立。
- **§6 #1 PushAgentMutex**：`wave-b-cloudsync.md` §7（:904）按台账归并 M-25、不单列 P1 —— 与
  `ledger-v2.md:293` 一致，无重复出账。
- **§6 #6 invoke-registry**：只注记不立条，并入 N-P1-05 的 P2 侧（`wave-b-apps.md` §5，:734）——一致。
- 其余无重复。

### A.4 A 节结论

**P0 5/5 齐；P1 40 条中 32 条齐、7 条无落位、1 条半落位；§6 入账 7 条全齐；无重复条。**
7 条缺口分三类（真漏 2 / 未排期 4 / ★1 从属 1），全部可在一轮 doc-fix + 一次补写内闭合。
**这一节是 No-Go 的第二条理由。**

---

## B · 「待 judge」注记清点与逐条裁决

`Select-String '待 judge' fix-spec/*.md` 命中 **15 处**（分布在 6 个文件），
去重后是 **12 个独立待裁项**。逐条裁决如下（✅ = 就地闭合，注记可保留作留痕；
🔁 = 转 R2 落文档；🙋 = 转 execute-ready 请用户拍）：

| # | 位置 | 待裁内容 | 裁决 | 依据 |
|---|---|---|---|---|
| B1 | `SPEC.md:64` | S-CS-18+19 合并 / S-CS-14 改口径「待 judge 终裁后回写 ledger」 | ✅ **全部采纳**，见 F 节 | 我复核 `synth/cloudsync.md:522/537` 同函数 `setConfig`、`:451` `db-backup.service.ts:99-174` 双份实现 |
| B2 | `wave-b-apps.md:524-531` | B-3 方案②「给 SessionService 加 listByParentSession」是否另立条目 | ✅ **不立**，见 G 节 | `session.port.ts`（88 行）只有 `listByProject`；`listByParentSession` 只在 repository 端口 |
| B3 | `wave-b-apps.md:812-821` | §5 分批归属是否给 wave-e R1–R6 补「R0：compaction 两通道补签名 −9」 | 🔁 **R2 补 R0 行** | §5.3 步骤 1 的 `WorkspaceSettingsView` 9 条在 R1–R6（`wave-e.md:340-347`）**确无归属批次**；且我复核 `invoke-registry.ts:649/653` 两个 compaction 通道确实裸 `noArg(...)` / `withReq<unknown, unknown>`，而 `apps/desktop/shared/ipc-types.ts:1622` `CompactionConditionsSetRequest` 与 `handlers/compaction-conditions.ts:25` 的签名**已现成** ⇒ 纯补签名、零风险，「零风险第一刀」的判断成立 |
| B4 | `wave-b-core1.md:420-426` | B1-4「一条 must-fix 措辞澄清」原文缺失，撰写机位拒绝擅自改写 | ✅ **作废，spec 不改** | 我回读 `raw/sr1-core1-b.md` 全文：§1.3 B1-4 复核要点 7 条**全是正面结论**（「三调用点唯一收敛成立且已实测」「spec 的收敛判断正确、完备」「不新增拒绝面——spec 结论正确」）；§2 重点① 结论是「**写全了，且收敛点判断正确**」。§3 must-fix 表只有 MF-1…MF-5，无一条归属 B1-4。⇒ **报告 verdict 表的「含 1 条 must-fix 澄清」与 §3/§2 自相矛盾，且无任何原文可依，属报告自身笔误**。🔁 附带动作：R2 在 `raw/sr1-core1-b.md` 补一行勘误，避免后续轮次再被这条幽灵 must-fix 绊住 |
| B5 | `wave-b-core2.md:224-226` | MF-2 要求 wave-e.md:908 的 Step 1 小标题同步改 | 🔁 **R2 改**（已复核**确实未改**） | `wave-e.md:908` 现仍写「**Step 1（wave-b-core2 负责，本条负责钩子侧）**」，与 `wave-b-core2.md` §11.3（:1494-1502）「本片交付靶子 + 回归锁用例，**wave-e 交付仓级门禁**（`satisfies` 守卫归 `wave-e` H2 Step 1）」**方向相反**。⇒ 两片口径仍打架，R2 须把 `wave-e.md:908` 改为「Step 1（wave-e H2 负责，wave-b-core2 交付靶子回归锁用例）」 |
| B6 | `wave-b-core2.md:414-415` | 公共尾巴取 `??` 还是保留 WebView 的 `||` | ✅ **取 `??`**（分片默认案），注记闭合 | 我复核三处实现：`apps/desktop/renderer/features/chat/message-blocks.ts:194` `const path = input.path ?? input.dir ?? input.from;`、`apps/mobile/src/components/chat/message-blocks.ts:281` 同款 `??`、**只有** `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts:26` 是 `input.path \|\| input.dir \|\| input.from`。⇒ 三分之二已是 `??`，单源取 `??` 是「取多数 + 取更严语义」（`\|\|` 会把「`path` 明确给空串」静默忽略）。分片已用验收第 7 条把 WebView 的行为漂移钉住，**两端不可两可的要求已满足** |
| B7 | `wave-c1.md:380-385` | C1-3 的 I1 观测面走 (a) MessageService 层桩 还是 (b) 真跑 agent + prototype spy | ✅ **取 (a)**（分片默认案），注记闭合 | 分片已给出不可反驳的技术理由：`chat-agent-session.ts:36` 的 `session.list()` **就是** `listBySession(includeHidden:false)`，真跑口径下 `listBySession` 计数不可能为 0 ⇒ (b) 的原写法恒不成立。(a) 与既有 3 个测试文件同构、改动最小 |
| B8 | `wave-c1.md:521-525` | C1-5 是否把 `project.service.ts:179` 的同型全量读并入本条 | ✅ **并入**（分片默认案），注记闭合 | 同型读、同读口（C1-2 新增的 `listReadRefTargetsBySession`）、边际改动一行；不并入则「全量读收窄系列」名不副实（`sr1-c1-a` 已把这条列为 must-fix「名不副实」） |
| B9 | `wave-c1.md:976-981` | C1-8 是否两侧对齐（非流式 `gemini-content-mapper.ts:262-265` 的 `${name}-${blocks.length}`） | ✅ **不对齐**，只改流式侧，注记闭合 | 分片已复核非流式侧 `blocks.length` **单调递增** ⇒ 两个同名调用必得不同 id ⇒ **该路径无缺陷**；改它是「无病而治」，代价是纯 wire 可见变化 + Gemini 对 `functionCall.id` 的容忍度**本轮未实测**（真机验证会从「建议」升为阻塞前置） |
| B10 | `wave-c1.md:1888-1891` | 「跨 N 次 repo 调用必须包事务」评审约定落 `docs/apm/RULE.md` 还是 service JSDoc | 🙋 **转 execute-ready 请用户拍**，默认案 ①（RULE） | PLAN 第四章第 11 条 + `AGENTS.md` 硬纪律：代理禁写 `docs/apm/`。约定文本分片已拟好（:1880-1884），落盘动作留主代理/用户 |
| B11 | `wave-d.md:676-688` + `:1335` + `:1357` | D-207 的 `tsconfig.test.json:26` 去向二选一 | ✅ **裁定方案 ①（改指 `./src/public/kkv.ts`）**，见 C③ | 我复核四处：`packages/core/tsconfig.test.json:26` = `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]`；`packages/core/package.json` 的 `"./kkv"` → `./dist/public/kkv.js`；`packages/core/test/package-exports-t0.test.ts:4` `import { createKkvService, KkvError } from "@novel-master/core/kkv";`；`packages/core/src/public/kkv.ts` 导出 `createKkvService` + `KkvError`（**完全覆盖该测试需求**）。🔁 R2 回写 `wave-d.md` 三处 |
| B12 | `wave-e.md:500-504` | 门 A 的 glob 是否扩到 `src/components/**` | ✅ **扩**（分片默认案），**但带一个前置条件** | `prompt-macro-input.ts` 正在 `src/components/**` 下（`wave-e.md:490-493` 自述），不扩则门 A 对原 P0 病根**完全失明**。🔁 前置条件转 R2：落地 Step 1 时**必须按新 glob 重测**「一方源码面 0 命中」，不成立则改走 metafile 清单案 |
| B13 | `wave-e.md:764-766` | `check-encoding.mjs` 真实扫描面的基线总数待重测 | ✅ **不代填数字**，转实施机位 | judge 不预填未实测的数字（RULE「计数类结论一律实测复核」）。分片已锁定唯一已知增量（`build.gradle`）与验收口径 |
| B14 | `wave-e.md:1641-1642` + `:1763` | N-P0-02（wave-a）与钩子⑥（wave-e H6）是同一处改动，跨片归一属 judge 职责 | ✅ **采纳 wave-e 口径**，见 C② | 台账 `ledger-v2.md:435` 的 N-P0-02 动作列本身已含三件事 ⇒ 两片确实改同一段。🔁 R2 写进 `SPEC.md §3` 依赖图 |

**B 节结论：15 处 / 12 项全部裁定完毕。4 项转 R2（B3/B5/B11/B12）、1 项转用户拍（B10）、
1 项附带勘误（B4）、6 项就地闭合（B1/B2/B6/B7/B8/B9/B13/B14 中的闭合部分）。
无一项遗留到 R2 之后再判。**

---

## C · 跨片矛盾终裁

### C① TS5042：**不立新条目**；并判定 `baseline.md §1.1` 事实错误 🔴

registry 待 judge ① 与 `baseline.md §1.1` 都主张：npm 10.9.4 下
`npm run build --workspaces --if-present` 会把一个额外位置参数转发给每个 workspace 的 `build` 脚本，
导致 14 个 `tsc -p` 脚本报 TS5042、根 build exit 1、desktop `preload.cjs` 不产出、smoke 假红。
**这个因果链我实跑推翻了。**

**复现实验（全部在 `fe79b781`、同一台机器、同一 node/npm）**：

```
# 实验 1：baseline.md §1.1 的「根因复现」—— 确实成立，但证明的不是它声称的事
cd packages\tdbc-conformance && npm run build tdbc-conformance
> tsc -p tsconfig.json tdbc-conformance
error TS5042: Option 'project' cannot be mixed with source files on a command line.

# 实验 2：根 build，按 baseline.md 的命令形态跑（带 shell 包装）
npm run build --workspaces --if-present > log 2>&1 ; echo "EXITCODE=$?"
→ 14 处 TS5042、exit 1，日志里每个 banner 都是
  > tsc -p tsconfig.json ; echo EXITCODE=$?

# 实验 3：根 build，同一条命令，只把 shell 包装从 "; echo" 换成 "&& echo"
npm run build --workspaces --if-present > log 2>&1 && echo OK
→ OK（exit 0）。日志 216 行，TS5042 命中 0 次、npm error 0 次、
  "echo EXITCODE" 命中 0 次。

# 实验 4：再换一种包装（cmd /c 内层，无任何追加）
cmd /c "npm run build --workspaces --if-present > log 2>&1"
→ CLEAN_EXIT=0

# 连带核验（实验 3/4 之后）：
apps/desktop/dist/src/preload/preload.cjs  存在，mtime = 本次构建时刻
apps/desktop 单跑 smoke.test.js            → 9/9 全绿（含
                                               "preload exposes novelMasterDesktop IPC bridge API"）
```

**结论**：TS5042 的真因是 **cmd.exe 不把 `;` 当命令分隔符**。测量机位（s-baseline）在 Windows 上
执行 `npm run build … ; echo "EXITCODE=$?"` 时，`;`、`echo`、`"EXITCODE=$?"` 被 cmd 当成**三个位置参数**
传给了 `npm run`，npm 再把它们转发给每个 workspace 的 `build` 脚本 ⇒ `tsc -p tsconfig.json ; echo EXITCODE=$?`
⇒ tsc 看到 `-p` 与「源文件」混用 ⇒ TS5042。
`baseline-00-root-build.log:3` 自己就留下了铁证：**根级 banner 也是**
`> npm run build --workspaces --if-present ; echo EXITCODE=$?` —— 那个 `; echo EXITCODE=$?`
本来就属于**调用方的 shell 行**，不属于仓库。
（我另跑了 `npm run build -w @novel-master/tdbc-conformance -w @novel-master/cloud-sync-driver-s3`
—— `-w` 形态**不带**这个后缀、正常绿，进一步佐证问题出在调用形态而非 npm 的 `--workspaces` 实现。）

**裁决**：
1. **不立新条目**。这不是仓库缺陷、不是 npm 缺陷、不是 CI 缺陷（CI 是 ubuntu-latest，
   `;` 在那里是合法分隔符）。给它立条目等于把一个测量假象写进 backlog。
2. 🔁 **R2 must-fix（验收地基级）**：改写 `baseline.md §1.1`（根因、影响面、兜底做法三段全部重写）、
   §5 假信号表 F3 的归因、§6 提醒 1「根 `npm run build` 不能一把梭」——
   **这一条现在是 actively harmful**，它会让 execute 机位刻意回避一条本来正确的命令。
3. 连带订正：`baseline.md §3.2` 的 F3 结论「假信号」方向对但**归因错**；desktop 已知红仍是
   628/627/1（`cr-05` 满负载 flake，隔离绿），我今天的实跑拿到 628/628/0，与「flake 会漂」一致。
4. 若仍想留一条防再犯，**形态应是 RULE 级提示**（cmd.exe 用 `&` 不用 `;`），
   不是 fix-spec 条目。建议在 execute-ready 请用户拍时一并提出。

### C② H6 ↔ N-P0-02 归一方向：**采纳 wave-e 口径** ✅

台账 `ledger-v2.md:435` 的 N-P0-02 动作列逐字含三件事：「`run-tests.mjs:30` 单引号改双引号 +
零收集守卫 `process.exit(1)` + `:23-26` 注释中性化」；`wave-e.md` H6 Step 2 的三件事与之**逐字重合**
⇒ 两片改同一个文件的同一段。我复核 `run-tests.mjs:27-30` 确认单引号在位、`:34` `shell: true` 在位。

**终裁**：
- **wave-a A3 落最小版**：改引号 + 注释中性化 + **调用**同一份 `scripts/lib/zero-collect-guard.mjs`；
- **wave-e H6 只承接通用化**：`packages/core/scripts/run-tests.mjs` 化 + 各包 `scripts/collect-check.mjs`
  + 双 shell CI job（`wave-e.md:1569-1589` 已用 job 级 `runs-on` + matrix，写法正确）；
- **守卫实现全仓只能有一份**，两片**必须同 PR 或严格有序（wave-a 在前）**；
- 🔁 R2 写进 `SPEC.md §3` 依赖图（当前图里没有这条边 —— 这是 A/D 两节的交叉缺口）。

### C③ X4 ↔ D-207 顺序：**D-207 在前，且 `:26` 必须改指 public** ✅

两片已互写依赖（`wave-e.md:661-665` 与 `wave-d.md:703`），方向一致、无环。但 `tsconfig.test.json:26`
的**去向**两片都没拍（`wave-d.md:676` 留了待 judge 注释块）。

**终裁：方案 ① —— D-207 把 `:26` 改指 `./src/public/kkv.ts`，然后删 `service/kkv/index.ts`。**

依据（四处我逐行核过）：
- `packages/core/tsconfig.test.json:26` = `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]`（内部 barrel）；
- `packages/core/package.json` 的 `"./kkv"` → `{"types":"./dist/public/kkv.d.ts","import":"./dist/public/kkv.js"}`（公共 barrel）；
- `packages/core/test/package-exports-t0.test.ts:4` `import { createKkvService, KkvError } from "@novel-master/core/kkv";`
  —— **它吃这条 paths 映射**（`wave-d.md:664-669` 已指出，我确认 `git grep` 全仓仅此一处消费方）；
- `packages/core/src/public/kkv.ts` 逐行导出 `createKkvService` / `KkvError` / `isKkvError` / 类型，
  **完全覆盖该测试的需求**、且不经被删的 barrel。

方案 ②（保留 barrel、撤下 D-207）**不可取**：`docs/apm/RULE.md:74` 明载「给 `@novel-master/core`
新增 exports 子路径必须同步 `tsconfig.test.json` 的 paths；paths 映射缺失时 tsx 回退 node 解析、
经 `node_modules` 自链加载 `dist/` 旧产物 ⇒ 测试静默跑旧码」（我已开 `RULE.md:74` 逐行读过，语义一致）。
「只删映射」会命中这个坑；保留内部 barrel 则两条同子路径双 barrel 的病灶留着。

**执行顺序**：**D-207 在前**（删 barrel + `:26` 改指 public）→ **wave-e X4 在后**（只加守卫测试、
补 `kkv` 进 `public-subpath-allowlist.test.ts` 的 SUBPATHS）。X4「不改动 paths 本身」的设计与 ① 完全兼容。
（我复核 `public-subpath-allowlist.test.ts:5-18` 的 `SUBPATHS` 确为 12 项、不含 `kkv` ⇒ 「kkv 零契约覆盖」成立。）
🔁 R2 回写 `wave-d.md:676-688`（修法第 3 步）、`:1335`（§7 修正 #3）、`:1357`（§8 待 judge 行）三处。

### C④ M-04 独立提交后的 P1-S 批次边界：**维持 core2 默认案** ✅

`sr1-core2-b §2.2/§2.3` 裁定 M-04 量级 = M（台账 §2.5「量」列）而非 Wave B 行的「全部 S」，
归属 =「留在本 PR、单列独立 commit C3b」，并把「四个 commit」改为「五个」（C1/C2/C3a/C3b/C4）。
**judge 采纳。** 复核依据：`find-saved-model-references.ts` 全文件**零 `chat_session` 字样**
（我 `git grep` 确认），且 `findSavedModelReferences` 的**唯一调用方是 `provider-model.service.ts:173`**，
`provider.service.ts` 的 `delete()` 流水线**零调用** ⇒ 「删服务商整条绕过守卫」成立，确非 S 级一行补漏。

**边界终裁**：
- M-04 留在 P1-S 批次 PR 内，**单列 C3b**；PR 正文注明「本批含 1 条台账量级 M（M-04）」；
- C3a 收其余六条（M-03 / CS-02 / CS-08 / B / S-D-02 / summarizeToolInput），C3a/C3b 同 PR、两个 commit；
- **移出方案已被证伪、不得复活**：Wave C「事务边界收窄」格是 core-storage + core-data 的
  CS-05/06/07/11，**没有任何 provider 行的落点**（`wave-b-core2.md:52-55` 已论证，我核对 `wave-c2.md §0`
  条目总览 :14-22 确认无 provider 条目）。若将来要移出，只能「M-04 独立成 PR」；
- 批次仍受一条跨波约束：**C4（CS-07）写好但不与 C1–C3 一起合入**，待 `wave-c2` 的 CS-06 合入后再单独合。

---

## D · 依赖图闭合性检查

### D.1 SPEC §3 现有 9 条边 —— **全部闭合，无断链、无环** ✅

| 依赖边 | 分片侧声明位置 | 复核 |
|---|---|---|
| `baseline` → Wave D 验收线 | `wave-d.md:56-80`（411 / 3126 / 628 / 1739 四项分母逐条对照）、`:1356` | ✅ 且我在 `tmp/baseline-04-tsc-renderer.log` 里数出 **411**、在 `baseline-06-core-test.log` 数出 `# tests 3126 / # fail 3`、在 `baseline-07d-desktop-test2.log` 数出 `# tests 628 / # fail 1`、在 `baseline-08-mobile-jest.log` 数出 `Tests: 1739` —— **四个分母全部实测对得上** |
| `baseline` → renderer 门禁分批（E） | `wave-e.md:293/298`（R1 定案 411）、`:390/399` | ✅ |
| `RT-02`（A）→ `RT-01`（B） | `wave-a.md:1572` §9.2、`wave-b-core1.md:857/870`、B1-6 依赖栏、`wave-c1.md:1714-1724` N-1 | ✅ 三处同向，且 c1 明确「断言按读口解耦、不写跨条断言」 |
| CI typecheck blocking（A）→ X1 / X2（E） | `wave-a.md:1579`、A5 验收③；`wave-e.md` X1 Step 5 / X2 Step 3 | ✅ |
| `S-CS-07`（B-cs）可独立先落 | `wave-b-cloudsync.md:38` §1 + `:966` 提交顺序第 1 位 | ✅ |
| `CS-06`（C2）→ `CS-07` | **唯一权威表述** = `wave-c2.md:1205-1226` N-1；对侧镜像 = `wave-b-core2.md:57-67` §0.3 + `:871` 依赖栏 | ✅ 两处同向、均声明「技术上零耦合、可互换，台账口径是归因清晰度而非技术必然」——**这是本轮跨片对齐做得最好的一处** |
| rebuild core → Wave D 批次 2 | `wave-d.md:1355`（硬前置非拍板）、`:703` D-207 依赖栏 | ✅ |
| `★5` → 编码批次 1（A） | `wave-a.md:1257/1404/1505`（三处标 `blocked-by-decision(★5)`，且都限定「仅 sksp 三处」） | ✅ |
| `★1/★3` → Wave D 批次 3；`★4` → 三条 batch 通道；`★2` → D-311/D-314 | `wave-d.md:851-852`（逐条标）、`:1059`、`:1247`、`:1351-1354` | ✅ |

### D.2 缺 3 条跨片边（其中 2 条是「同一文件被两片同时改」）🟡

**必须补进 `SPEC.md §3`**：

1. 🔴 **`N-P0-02`（wave-a A3）↔ `H6`（wave-e）—— 同一个 `run-tests.mjs` 的同一段**。
   当前 §3 图里**完全没有这条边**，只有 `wave-e.md:1632-1642` 单方面标注。
   不补 ⇒ 两个 PR 各改一次，第二片必然覆盖第一片。终裁见 C②。
2. 🔴 **`D-207`（wave-d 批次 2）↔ `X4`（wave-e）—— 同一个 `tsconfig.test.json:26`**。
   两片互相写了依赖（`wave-e.md:679` / `wave-d.md:703`），但 §3 图里没有这条边。
   终裁见 C③（顺序 D-207 → X4）。
3. 🟡 **`baseline.md` → `wave-a` A4（N-P0-03 的 CLI 验收）**。
   `baseline.md §4` 总表**没有 `apps/cli` 行**，§3 也只跑了 core/desktop/mobile。
   `wave-a.md:799-805` 自己发现了这点，并给了二选一判据（(a) 以 `ledger-v2.md:82` 的 26/102 为增量基线 /
   (b) 先给 baseline 补一行 CLI 基线）。**judge 裁 (b)**——
   「CLI 开不了第一个会话」是 P0，它的验收基线不该挂在台账的历史数字上；
   🔁 R2 补一节 `baseline.md §3.4 · apps/cli`（`tsx --test test/**/*.test.ts` 的 tests/fail 实测数）。
   ⚠️ 代理禁写 `docs/apm/` 但 baseline.md 不是 apm，补跑由实施机位或主代理执行。

### D.3 apps §5 与 wave-e X2 的分批归属冲突 🟡

`wave-b-apps.md:812-821` 自报：`wave-e.md` 的 R1–R6 是自洽的、与 §5.3 不是同一套排序，
且 §5.3 步骤 1 的 `WorkspaceSettingsView` 9 条**在 R1–R6 里没有归属批次**。
我核对 `wave-e.md:340-347` 的 R1–R6：R2 = `SettingsViews.tsx` 79、R3 = `AgentEditorView` +
`ModelSamplingView` + `AgentDefinitionEditorForm` 55、R4 = `Tooltip` + components/layout、R5/R6 = test/** 与长尾
——**确实没有 `WorkspaceSettingsView` 这一格**。

**终裁：采纳「补 R0」**。理由：`WorkspaceSettingsView.tsx:103-112`（7 条）+ `:153/:156`（2 条）
共 9 条 TS18046，两处类型在 `shared/ipc-types.ts` 已现成、只是没接进 `invoke-registry.ts:649/653`
（我逐行读过该两行，确实是裸 `noArg(...)` 与 `withReq<unknown, unknown>`）
⇒ 纯补签名、零行为变更、零风险，且**能搭 `wave-b-apps.md §1`（N-P1-04，同一个文件不同函数）的车**。
🔁 R2 在 `wave-e.md` X2.3 Step 4 的批次表里补一行 `R0`，并回引 `wave-b-apps.md §5.3` 步骤 1。

### D.4 D 节结论

**现有 9 条边全闭合、无环；缺 3 条边（2 条高、1 条中）+ 1 处分批归属冲突，全部已裁。**
无环 —— 唯一接近环的候选（N-P0-02 ↔ H6 同文件）在 C② 已用「wave-a 最小版在前、H6 通用化在后、
守卫单份」定死方向。

---

## E · 基线终案

### E.1 411（三源 + baseline 撞车）—— **确认，且我第四源复核通过** ✅

- `baseline.md §2.1` 实跑 411（`npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json`）；
- `raw/sr1-e-a.md`、`raw/sr1-apps-c.md` 两份 reviewer 独立实跑同得 411，分布逐项吻合
  （`test/` 190 · `renderer/` 178 · `src/` 42）；
- 台账 `ledger-v2.md:171` 的 **424 作废**（W11 时点数，漂移 −13）；
- **judge 第四源**：`Select-String 'error TS\d+' tmp/baseline-04-tsc-renderer.log | Measure-Object` = **411**。

**各分片引用形态一致**（`grep 424` 逐处核过）：`wave-e.md:293/298` 已写「R1 定案：411 为唯一权威数、
424 作废」；`wave-b-apps.md:43/767-768` 已改口径并给出 410/402 派生锚点；`wave-d.md:56/78/80/169` 全部用 411。
**唯一两处残留**：`wave-b-cloudsync.md:984` 与 `:1023` 还在写「424 条已知红」——这两句在
「与 wave-a/wave-e 的边界」散文里、不在任何验收断言上，**属低危**，
🔁 R2 顺手改成 411（否则下一个人照抄会再漂一次）。

### E.2 三包已知红 —— **引用形态基本一致** ✅

| 包 | baseline 已知红 | 各分片引用 | 复核 |
|---|---|---|---|
| core | **3126 tests / 3 fail**（2 条确定性 usage-stats T-C2/T-C6 + 1 条每次位置漂的性能护栏） | `wave-a.md:569`、`wave-d.md:63/856` | ✅ 我在 `tmp/baseline-06-core-test.log` 数出 `# tests 3126 / # pass 3123 / # fail 3`，逐字一致 |
| desktop | **628 / 627 / 1**（`cr-05` 满负载 flake，隔离 4/4 绿）；**默认 `npm test` 是 `# tests 0` / exit 0 的假绿** | `wave-a.md:565`、`wave-d.md:64`、`wave-b-core2.md:1402`、`wave-c2.md:1310`、`wave-b-cloudsync-x1.md:365` | ✅ 我实跑 `cd apps\desktop && npm test` → `# tests 0 / # fail 0`；实跑 `npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"` → **`# tests 628 / # pass 628 / # fail 0`**（flake 今天没复现，与「位置会漂」一致） |
| mobile | **1739 / 1738 / 1**（`mermaid-fullscreen` 源码正则断言，确定性） | `wave-a.md:571`、`wave-d.md:65` | ✅ 我在 `tmp/baseline-08-mobile-jest.log` 数出 `Tests: 1 failed, 1738 passed, 1739 total` |
| mobile lint | **27 error + 405 warning**（阈 321，两道坎） | `wave-a.md:1542` §8 #6 已采信并采纳「本条不能顺带把 Lint 转 blocking」的结论 | ✅ 与 `baseline.md §2.2` 一致 |

「红条目的条数与位置不得增加」的判增量规则（`baseline.md:273-275`）在 wave-d §1 验收线被完整继承，
形态一致。**desktop 默认 `npm test` 假绿这条，各分片都写成了「N-P0-02 未修前不得用它判绿」——
纪律一致，且我今天实跑再次证实它仍然成立。**

### E.3 🔴 但 `baseline.md §1.1` 的根因结论是错的 —— 这是 R1 的 No-Go 第一条理由

详见 C①。必须重写的段落：`§1.1`（根因 / 连带影响 / 兜底做法三段）、
`§5` 假信号表 F3 的归因、`§6` 提醒 1。
**注意这条错误的扩散面**：它已经写进 `wave-a.md §9.2`（:1574「wave-e 已声明不阻塞于 Wave A…」同段的上下文）、
`wave-d.md §0/§1` 的验收前置、`registry.md:291` 待 judge ①，
并被 `baseline.md §6:1` 升格成「验收脚本必须改成逐包 build」的**行动指令**。
不订正，execute 机位会为一个不存在的问题付出逐包 build 的复杂度。

### E.4 🟡 三处陈旧分母（RULE 明令「计数类结论一律实测复核」）

| 位置 | 现写 | 实测 | 处理 |
|---|---|---|---|
| `wave-e.md:1609` | `packages/core` 全量「约 **2748** 条」 | baseline 实测 **3126** | 🔁 R2 改 3126 |
| `wave-e.md:1624` | 同上（H6.5 回归线） | 同上 | 🔁 R2 改 3126 |
| `wave-e.md:1558` | 收集「当前应约 **396** 个文件」 | `Get-ChildItem packages/core/test -Recurse -Filter *.test.ts` = **434** | 🔁 R2 改实测值并注明扫描面 |
| `wave-b-apps.md:466` | mobile 满负载「稳定 **1604**/1604」 | baseline 实测 **1739** | 🔁 R2 改 1739 |

（`baseline.md §3.1/§3.3` 自己已记「台账口径 2748 已过期 / 1604 已过期」，只是 wave-e 与 wave-b-apps
没跟上。）

### E.5 E 节结论

**411 与三包已知红：确认，四源复核通过，各分片引用形态一致（2 处低危残留）。**
**但根 build TS5042 的根因结论错误且已扩散成行动指令；另有 4 处陈旧分母。**

---

## F · 债务池移交 —— 回写 ledger 清单（回写动作留主代理）

以下 6 项**终裁采纳**，请主代理按此回写。⚠️ 我实测发现：**这些条目并不在 `ledger-v2.md` 里**，
它们的真源在 `synth/*.md` 与 `L0/*.md` —— 回写目标要按这个改。

| # | 事项 | 终裁 | 真源（回写目标） | 我复核的证据 |
|---|---|---|---|---|
| F1 | **S-CS-18 + S-CS-19 合并** | ✅ 合并为**单条 P2**（同函数同根因：`cloud-sync-config.store.ts` 的 `setConfig` 非事务 + 不重置 `lastSyncedRev`） | `synth/cloudsync.md:522` + `:537`（两条同函数） | 两行同指 `setConfig`，病灶同源 |
| F2 | **S-CS-14 改口径** | ✅ 改写为「**S-CS-07 的残留子项**：抽 `replaceDbFileWithSnapshot(write)` 单一内核，消除 `FromPath`/`FromBytes` 双份实现」 | `synth/cloudsync.md:451`、`:886`（M4.3 单点修改面） | 口径改写的目的是**防「S-CS-07 已修 ⇒ S-CS-14 自然消失」的错误核销**，必须落进台账正文而非仅在 fix-spec 附注 |
| F3 | **S-CS-13 = push 侧 / S-CS-03 = pull 侧** | ✅ **两条都做**，写死边界 | `synth/cloudsync.md:435`（S-CS-13 `coordinator.ts:256,267`）↔ `ledger-v2.md:147`（S-CS-03 `coordinator.ts:143-182`） | 我 `git grep isAgentActive -- cloud-sync-coordinator.ts`：**只有 `:219` 与 `:267` 两处，都在 push 路径**；`pull()`（143-182）零命中 ⇒ 「pull 侧完全空白」成立，两条确实不同侧不同位置 |
| F4 | **CD-20 降 P3** | ✅ 改写并降 **P3** | `synth/core-data.md:103`（P2 → P3） | 我复核：`message-content-compaction.ts` **已不存在**（`git ls-files "*message-content*"` 只有 `decompression`），残留面确实只剩标记清理。**且病灶在位**：`db-maintenance.service.ts:100-104` 的 `DELETE FROM kkv_entry WHERE module = ? AND key = ?` 参数是 `["nm-blob-binary", "startupMaintenancePending"]` —— **只清 blob 侧**；而 `message-content-decompression.ts:35/94` 明确消费 `nm-message-content/startupMaintenancePending` ⇒ 下次冷启动多跑一次维护 |
| F5 | **CD-34 核销** | ✅ **核销（stale，前提消失）** | `synth/core-data.md:122`（P3）→ 移入 `ledger-v2.md §9`「已被 v1.5.29 消化的条目」 | 消解池缓存已整体撤销、两分支差异不复存在。⚠️ `ledger-v2.md:48` 的「移出台账池」行**已经列了 CD-34** ⇒ 台账层其实已核销，**待办只是把 `synth/core-data.md:122` 同步改掉**，否则两份文档打架 |
| F6 | **台账 P2/P3 行号统一刷新** | 🔁 **不在本轮做全量**，改为在 `ledger-v2.md §11` 加一句硬口径 | `ledger-v2.md:508` 已有「引用前以 `git log -1` 复核」，把它升级为**加粗硬约束** | CD-03/CD-09 已实证漂移、CD-20 病灶文件已消失；全量刷新要重跑 L0，代价与收益不成比例 |

**F 节结论：6 项全部裁决完毕；F1~F5 转主代理回写（目标文件是 `synth/*.md`，不是 `ledger-v2.md`），
F6 降级为一句硬口径。**

---

## G · B-3 的 `listByParentSession` 是否另立条目：**不立** ✅

**病灶属实**（我逐条复核）：
- `packages/core/src/service/chat/session.port.ts`（全文 88 行）里 `SessionService` 接口的
  会话枚举方法**只有 `listByProject(projectId: string)`**（`:15`），**确实没有 `listByParentSession`**；
- 该方法在 **repository 层是有的**：`packages/core/src/domain/chat/repositories/session.port.ts:14`
  `listByParentSession(parentSessionId: string): Promise<ChatSession[]>;`，
  实现在 `sqlite-session.repository.ts:51`；
- core 自己的两处都做了 BFS 展开：`project.service.ts:160-171`（含注释
  「子 agent 会话需要 BFS 展开，否则会留孤儿 messages/fs/kkv/vfs」）与
  `physical-vfs.service.ts:311` / `:511`；
- ⇒ **AM-1 步骤 3 的子 agent 会话缺口是真的**，`wave-b-apps.md:527-528` 的陈述准确。

**但本轮不立条目**，四条理由：
1. **量级错配**：从 S 涨到 M，且要动 **core 的公共接口** ⇒ 触发 `RULE:109`「给导出接口加必填字段前先扫手写假实现」，
   需要扫全仓的 `SessionService` 手写实现与测试 mock。把它塞进 Wave B 会让 `wave-b-apps.md`
   从「4 条小改」变成「跨 core 公共面的接口变更」，与该分片「零风险、文件不相交」的定位冲突。
2. **AM-1 已经有正确的兜底**：分片按**方案①**落盘——显式写缺口 + TODO + RULE 登记 + 验收负向断言
   （`wave-b-apps.md:531`），缺口是**显式可见**的，不会被当成「已修」。
3. **台账没把它算进 AM-1**：`ledger-v2.md:158` 的 AM-1 修法原文是「三处删除成功分支补调 + 两张 Map 挂 500 LRU」，
   没有 BFS。⇒ 它是**独立于 AM-1 的另一条缺陷**，不该搭 AM-1 的车改口径。
4. **它不是 Wave B–E 的执行面**：wave-e X1 Step 1 要动的正是 `shared/logic/*` 的再导出面，
   「把 `SessionService` 的枚举能力补全并接通」在精神上更接近那条。

**处置**：
- **不立七要素条目**，登记为**债务池 P2**（建议编号 `N-P1-08` 或 `AM-6`，由主代理定）；
- 在 `ledger-v2.md §7` 拍板项里**新增一条**：「是否给 `SessionService` 增 `listByParentSession`
  以在 apps 侧做 BFS 展开（涉及 core 公共接口 + RULE:109 假实现扫描）」——
  这是**范围取舍**，属用户/主代理的账，不由 judge 代拍；
- 在 `wave-b-apps.md §3` AM-1 的「待 judge 裁决的跨簇建议」注记里，把本裁决结论一句写死
  （🔁 R2），避免下一轮再被同一个问题绊住。

---

## H · R1 结论

### H.1 判据逐条对账

`fix-spec/SPEC.md` 头部的 R1 判据是：「**无未闭合 P0**（矛盾 / 缺失契约 / 与代码硬冲突 / 验收不可测）；
**P1 已修或已入「已知限制」**；**全局 judge Go**。」

| 判据 | 结果 | 依据 |
|---|---|---|
| 无未闭合 P0 | ✅ **满足** | A.0：5/5 有七要素条目；我逐条复核了 RT-02、N-P0-02、S-CS-07 的病灶代码 |
| P1 已修或已入「已知限制」 | ❌ **不满足** | A.1：40 条中 7 条无任何落位（其中 AM-3/CD-01 是台账已排进 Wave 的真漏），1 条半落位 |
| 全局 judge Go | ❌ **不满足** | C① 的 baseline 根因错误 + D.2 的 3 条缺边 |

### H.2 结论

# 🔴 **R1 = No-Go。**

**不是「P0 塌了」的 No-Go**——这一轮的骨架是可信的：11 个分片结构齐整、七要素覆盖率在 P0 上是 100%、
28 份 reviewer 报告的 must-fix 基本都被 dfx-* 收干净了、跨片归一（CS-07 / CS-06→CS-07 / N-P0-02↔H6）
在多数情况下做到了双向一致。**挡住 execute 的是三条「地基级」问题，都可以在 R2 一轮内闭合**：

1. `baseline.md §1.1` 的 TS5042 根因错误，且已扩散成行动指令（C①）；
2. 7 条 P1 无七要素落位（A.2）；
3. 依赖图缺 3 条跨片边 + 1 处分批归属冲突（D.2/D.3）。

**建议**：R2 只做 doc-fix + 一次小规模补写（7 条 P1 中 6 条量 S/M、单文件或单簇），
**不重新放 reviewer**（现有 28 份报告已覆盖这些条目的行号与机理，补写机位只需照台账 + 已核实的
file:line 落七要素即可）。R2 完成后若 must-fix 表清零，可直接进 R3 judge 复核并给 Go。

### H.3 R2 must-fix 总表

按优先级排。**P0 = 验收地基级（不做则 execute 会踩坑），P1 = 覆盖完备性，P2 = 一致性/卫生。**

| # | 级别 | 事项 | 落点（文件:行） | 完成判据 |
|---|---|---|---|---|
| **R2-1** | 🔴 P0 | **重写 `baseline.md §1.1`**：TS5042 真因是 cmd.exe 把 `; echo EXITCODE=$?` 当位置参数转发（附我的实验 2/3/4 对照），**不是 npm 的 `--workspaces` 缺陷、不是仓库缺陷**；连带影响（preload 缺失 / smoke 假红）随之作废；**兜底做法整段删除**（干净根 build exit 0，不需要逐包 build） | `fix-spec/baseline.md:31-60` | 文中不再出现「根 `npm run build` 不能一把梭」「必须逐包 `npm run build -w` + 补 `build:preload`」 |
| **R2-2** | 🔴 P0 | **订正 §5 F3 与 §6 提醒 1** 的归因；把「验收脚本必须改为逐包 build」这条**行动指令撤回** | `baseline.md:285`（F3 行）、`:296-297`（§6 第 1 条） | 与 R2-1 口径一致；F3 明确写「假信号成立，但归因是测量机位的 shell 包装，不是根 build 参数转发污染」 |
| **R2-3** | 🔴 P0 | **SPEC §3 依赖图补 3 条边**：①`N-P0-02`(A3) ↔ `H6`(E) 同文件，wave-a 最小版在前、守卫单份；②`D-207`(D) → `X4`(E) 顺序，D-207 在前且 `:26` 改指 `./src/public/kkv.ts`；③`baseline` → `wave-a` A4（补 apps/cli 基线，采纳判据 (b)） | `fix-spec/SPEC.md:35-47` | 三条边在图里，且与 C②/C③ 的终裁逐字一致 |
| **R2-4** | 🟠 P1 | **补写 AM-3**（`RealPrompt` 路由加可选 `{projectId?, sessionId?}` + 两处入口显式传；量 S） | `fix-spec/wave-b-apps.md`（新增 §5，§0.1 条目表同步加行） | 七要素齐；认领链 `ledger-v2.md:457` → `SPEC.md §2` → `wave-b-core2.md:1514` → 本条 闭合 |
| **R2-5** | 🟠 P1 | **补写 CD-01**（回滚 plan 四步重排；量 L），归 `wave-c2.md`；同时把 `ledger-v2.md:463` 的「CD-01 fork 缺上界读口」**正名为 CD-13** | `fix-spec/wave-c2.md`（新增一条 + §0 条目总览加行）；`SPEC.md:25` 分配表同步 | 七要素齐；`wave-c1.md:1767-1777` 的「不认领」注记改为「已移交 wave-c2 §N」；`wave-c2.md:1249` 的错误归属声明改正 |
| **R2-6** | 🟠 P1 | **补写 S-D-04 + E**（`AgentEditorView` dirtyViews 守卫 + App ⚡ 旁路；加载失败保留 `def.model`），落 `wave-b-apps.md`，与 `wave-b-core2.md §9` 的 B 条同 PR | `fix-spec/wave-b-apps.md`（新增两条） | 七要素齐；`wave-b-core2.md:1316/1428` 的「兄弟条目」引用改为指向实条 |
| **R2-7** | 🟠 P1 | **补写 M-01**（attempt 级「本次是否已产出」探针），落 `wave-b-core2.md`；把 `wave-e.md` H5.1.3 的 `test.todo` 升级为它的测试落点 | `fix-spec/wave-b-core2.md`（新增一条）；`wave-e.md` H5.1.3 同步 | 七要素齐；`wave-b-core2.md:341` 的「不依赖 M-01」改为依赖声明 |
| **R2-8** | 🟠 P1 | **补写 CS-03**（DP 滚动两行 + `Math.min(...arr)` 换循环 + 超阈值降级；量 M），落 `wave-c2.md` | `fix-spec/wave-c2.md`（新增一条） | 七要素齐；`wave-b-core2.md:858` 的顺带提及改为实条引用 |
| **R2-9** | 🟠 P1 | **补齐 F-synth-dead-1**（`testOnly` 排除 `relayed` 后重跑 L0 + 重分桶 + 回写 `L0/dead-exports.md`；量 S）；并在 `SPEC.md §4` 显式登记 **F-synth-dead-2 = ★1 的解锁产物**，不按漏条处理 | `fix-spec/wave-d.md`（新增一条）；`SPEC.md` §4 | 两条都不再处于「有人引用、没人施工」的状态 |
| **R2-10** | 🟡 P2 | **D-207 `:26` 三处回写**：修法第 3 步改为「改指 `./src/public/kkv.ts`」、§7 修正 #3 的「修法冲突」段改写、§8 待 judge 行改为「已裁定：方案 ①」 | `wave-d.md:676-688`、`:1335`、`:1357` | 三处口径一致；待 judge 注释块替换为裁定结论 |
| **R2-11** | 🟡 P2 | **wave-e.md:908 Step 1 小标题改口径**（现写「wave-b-core2 负责」，与 core2 §11.3 相反） | `wave-e.md:908` | 与 `wave-b-core2.md:1494-1502` 的分工声明一致 |
| **R2-12** | 🟡 P2 | **X2 批次表补 R0 行**（compaction 两通道补签名 −9），回引 `wave-b-apps.md §5.3` 步骤 1 | `wave-e.md:340-347` | `WorkspaceSettingsView` 的 9 条有明确归属批次 |
| **R2-13** | 🟡 P2 | **门 A glob 扩到 `src/components/**` 的前置条件写进验收**：Step 1 落地时必须按新 glob 重测「一方源码面 0 命中」，不成立则改走 metafile 清单案 | `wave-e.md:500-504`、X3.4 判据② | 验收节含「按新 glob 重测」这一步；不留「首日即绿」的无条件断言 |
| **R2-14** | 🟡 P2 | **4 处陈旧分母刷新**：3126（两处）、434 个文件、1739 | `wave-e.md:1609`、`:1624`、`:1558`；`wave-b-apps.md:466` | 全部等于 `baseline.md` 实测值；`baseline.md §11` 加一句「计数类引用前以 baseline §4 为准」 |
| **R2-15** | 🟡 P2 | **B4 幽灵 must-fix 勘误**：`raw/sr1-core1-b.md` 补一行「verdict 表的『B1-4 含 1 条 must-fix 澄清』为报告笔误，§2/§3 均无此条，judge 已裁定作废」；`wave-b-core1.md:420-426` 的待 judge 注释块改为裁定结论 | `raw/sr1-core1-b.md`、`fix-spec/wave-b-core1.md:420-426` | 后续轮次不再被这条无原文的 must-fix 绊住 |
| **R2-16** | 🟡 P2 | **B-3 裁决落文档**：`wave-b-apps.md:524-531` 的「待 judge」注记改为「judge 已裁：不立条目，登记债务池 P2 + 新增拍板项」 | `fix-spec/wave-b-apps.md:524-531`；`ledger-v2.md §7`（新增一条拍板项） | 注记不再悬空 |
| **R2-17** | 🟡 P2 | **债务池回写**（F1~F5）：S-CS-18+19 合并 / S-CS-14 改口径 / S-CS-13 与 S-CS-03 边界写死 / CD-20 降 P3 / CD-34 核销同步到 `synth/core-data.md:122`。⚠️ **真源在 `synth/*.md`，不在 `ledger-v2.md`** | `synth/cloudsync.md:435/451/522/537`、`synth/core-data.md:103/122` | 两份文档不再打架 |
| **R2-18** | 🟡 P2 | **`SPEC.md §1` 的 P1 计数口径与实况对齐**：现写「全部 P1（40）」，R2 完成后应为「40 + §6 入账 7 = 47 条全部有落位」，并列出 F-synth-dead-2 的 ★1 从属口径 | `fix-spec/SPEC.md:10` | 计数与磁盘实况一致（judge 复核：A.1 表） |

**R2 范围建议**：R2-1~R3 是纯文档改（半小时内可落），R2-4~R2-9 是补写六条 P1 的七要素
（每条需重开 `fe79b781` 核行号，但机理与 file:line 我已在 A 节给出、reviewer 报告也已覆盖，
**不需要重新放 reviewer 机位**），R2-10~R2-18 是口径与卫生。

### H.4 execute-ready 的前置（与 R2 并行推进，不阻塞 R2）

- 🙋 **B10**：「跨 N 次 repo 调用必须包事务」评审约定落 `docs/apm/RULE.md`（默认案 ①）——
  代理禁写 `docs/apm/`，请用户在 execute-ready 确认时一并拍板，主代理落盘。
- 🙋 **G 节新增拍板项**：`SessionService` 是否增 `listByParentSession`（涉及 core 公共接口）。
- 🙋 **★1 / ★3 / ★4 / ★5 / ★16 / ★17** 六项既有拍板项照 `SPEC.md §4` 原计划随 execute-ready 确认提出；
  ★2（D-311 保留 / D-314 可删）与 ★5 的默认案可先写，**真正卡执行的只有 ★1/★3/★4/★17 与 ★5 的 sksp 三处**。
- 🔁 **R2-3③ 附带的 CLI 基线补跑**（`tsx --test test/**/*.test.ts` 的 tests/fail 实测数）——
  这是 P0 条目 N-P0-03 的验收地基，建议在 R2 窗口内由实施机位或主代理跑掉。

---

*本报告为 R1 全局 judge 的唯一产出。全程只读：零 git 写、零 `docs/apm/` 写、零 fix-spec 分片改动、
零生产/测试代码改动。唯一副作用是构建产物（`dist/`、`webview-dist/`、`preload.cjs`）被我的验证实验
重新生成，以及 `tmp/judge-*.log` 三个临时日志。*
