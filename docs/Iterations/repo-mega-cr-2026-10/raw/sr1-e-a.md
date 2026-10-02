---
zone: fix-spec-review
agent: sr1-e-a（wave-e 组 A · X1 门禁收口 + renderer typecheck 门禁 + tsconfig.test paths 对齐）
files_scanned: docs/Iterations/repo-mega-cr-2026-10/{PLAN.md, ledger-v2.md, fix-spec/{SPEC.md,wave-e.md,state.md}, raw/w3-xc-ipc.md, synth/apps-desktop.md}、docs/apm/RULE.md、.github/workflows/ci.yml、eslint.config.base.mjs、apps/desktop/{package.json,tsconfig.json,tsconfig.renderer.json,eslint.config.mjs,renderer/**,test/preview-*.test.ts}、apps/cli/{package.json,tsconfig.json,eslint.config.mjs}、apps/mobile/package.json、packages/core/{package.json,tsconfig.json,tsconfig.test.json,eslint.config.mjs,src/public/events.ts,test/package-exports/**}、packages/*/{tsconfig.json,eslint.config.mjs,test/**}（13 包）
基线: fe79b781（只读，未执行任何 lint/tsc/npm 命令，外部数字留 judge）
---

# sr1-e-a · wave-e 组 A 只读审查

## 摘要

组 A 三条目里，**X1 与 X2 的证据密度罕见地高**：9 处 renderer→core 违规清单、core 8 条 lint error 的
逐条 file:line、`shared/logic/*` 再导出层的每一处行号，我都重新打开 `fe79b781` 核过，**全部命中**，
包括 `annotate-source-range.ts:379` 的 `let matchLen`（该变量在同文件 `:252` 有再赋值、`:379` 这处没有，
`prefer-const` 判定精确到令人信服）。真正的问题不在「病症写没写对」，而在**修法层有两处 P0**：
X1 Step 5（CI 转 blocking）三处自相矛盾且按当前 CI 结构**不可实施**；
以及**「tsconfig.test paths 对齐」这整个条目在 wave-e.md 里根本没有节**——尽管 SPEC.md:26、
wave-e.md 自己的文首、ledger-v2.md:490 三处都承诺了它。

## 1 · 逐条 verdict 表

| # | 条目/子节 | verdict | 判定依据（实测） |
|---|---|---|---|
| 1 | X1 病症与严重度（P2） | Go | 三个子病症全部实测成立 |
| 2 | X1.1(a) CI 放行证据 | Go | `ci.yml:58` / `:62` 两行 `continue-on-error` 精确 |
| 3 | X1.1(b) 门禁规则在位 | Go | `apps/desktop/eslint.config.mjs:71-88` 逐行一致 |
| 4 | X1.1(c) 9 处违规清单 | Go | 9/9 文件·符号·行号命中（见 §2） |
| 5 | X1.1(d) desktop 2 条 `no-regex-spaces` | Go | `test/preview-annotate.test.ts:398`、`test/preview-recogito-md.test.ts:139` 精确 |
| 6 | X1.1(e) core 8 error 构成 | Go | 4+2+1+1=8，逐条 file:line 全部命中 |
| 7 | X1.1(f) 驱动包 tsconfig 缺口 | Conditional | 主体全对；包清单误列 `tokenizer-driver-rn`（MF-5） |
| 8 | X1.2.1 events.ts「2 符号零消费」证伪 | Conditional | 实质正确、引用与计数错（MF-6） |
| 9 | X1.2.2 core `no-regex-spaces` 是 4 条 | Go | 与实测一致 |
| 10 | X1.2.3 修法重心在 CI 那一行 | Go | `apps/desktop/package.json:8` 精确 |
| 11 | X1.3 Step 1 补 16 符号 | Go | 与 9 处违规的符号并集逐个对账一致 |
| 12 | X1.3 Step 2 改 9 条 import | Go | 只改 specifier，可执行 |
| 13 | X1.3 Step 3 修 6 条 lint | Go | `\n {4}` / ` {5}` / disable-next-line 三种手法均正确 |
| 14 | X1.3 Step 4 驱动包 tsconfig 覆盖 | Conditional | 模板经 core 同形态实证可行；**漏 `apps/cli`**（MF-3） |
| 15 | **X1.3 Step 5 CI 转 blocking** | **No-Go** | 三处自相矛盾 + 按 CI 现状不可实施（MF-1） |
| 16 | X1.4 验收可测性 | Conditional | 5 条命令均可跑；⑤ 缺 H6 前置（MF-11 邻接） |
| 17 | X1.5 测试策略 | Go | 「门禁即测试」+ 一条结构快照，形态成立 |
| 18 | X1.6 回归线存在性 | Go | 两条 `npm test` 真实存在（`package.json:24`） |
| 19 | X1.7 依赖闭合 | Conditional | Wave A 引用清晰；H6 未进依赖表（MF-11） |
| 20 | X1.8 风险与回滚 | **No-Go** | 末行与 Step 5 直接对立（MF-1 同源） |
| 21 | X2 病症表述 | Conditional | 事实对、`package.json` 行号 off-by-one + 一句自相矛盾（MF-7、MF-8） |
| 22 | X2.1 tsconfig/lint 覆盖证据 | Go | `tsconfig.json:8`、`tsconfig.renderer.json` include/lib/jsx 全对 |
| 23 | X2.1 411 分布的内部自洽 | Go | 算术全通（见下） |
| 24 | X2.1 门禁牙齿证据 | Go | `ChatHistorySearchPanel.tsx:106` 实测在位 |
| 25 | X2.2 口径修正（424 vs 411） | Go | 明确让位 `baseline.md`，处理得当 |
| 26 | X2.3 Step 1+2 棘轮门 | Conditional | 机制可行，基线数据模型不足（MF-4） |
| 27 | X2.3 Step 3 CI 挂载 | Go | 挂在 Typecheck 之后，合理 |
| 28 | X2.3 Step 4 分批 R1~R6 | Conditional | 算术自洽；R1 预估减量写错（MF-9） |
| 29 | X2.3 Step 5 归零后退化 | Go | 完整 |
| 30 | X2.4 验收 | Conditional | ② 可执行；③ 标题与内容相反（MF-10） |
| 31 | X2.5 测试策略与三判据 | Go | 不新建测试基建的理由成立 |
| 32 | X2.6 回归线 | Go | `--test-concurrency=2` 有 RULE:111 实锤先例 |
| 33 | X2.7 依赖闭合 | Go | 四条依赖全清晰，Wave D 交互处理得好 |
| 34 | X2.8 风险与回滚 | Go | 覆盖到位 |
| 35 | **tsconfig.test paths 对齐条** | **No-Go** | **整节缺失**（MF-2） |
| 36 | 附：paths 条的可实施性评估 | Conditional | 3 个未写约束 + 与 D-207 方向冲突（MF-13） |

**verdict 计数：Go 23 / Conditional 10 / No-Go 3，合计 36 条。**

### 411 分布的内部自洽核算（外部数字留 judge）

- 190 + 178 + 42 + 1 = **411** ✅ 与 §X2.1 首句一致
- R1(69) + R5(121) = **190** = `test/**` 全量 ✅
- R2(79) + R3(55) + R4(26) = **160** ≤ `renderer/**` 178，留 18 给 R6 ✅
- 四件 79+25+18+12 = **134**，134/178 = **75.3%** ≈ spec 写的 75% ✅
- 四件 134 ≤ `features/settings/` 152 ≤ `renderer/**` 178 ✅
- R3 25+18+12 = **55** ✅

结论：**spec 内部自洽，外部数字（424/813/各文件条数）本机位不重复实跑，交 judge 对 `baseline.md`。**

## 2 · 9 处违规清单核对表

**违规判定依据（先答你问的那一题）**：依据是 **import specifier 的字面路径形态**，不是 tsconfig paths。
唯一权威是 `apps/desktop/eslint.config.mjs:71-88` 那条 `no-restricted-imports`：
`group: ["@novel-master/core", "@novel-master/core/*"]` 作用在 `files: ["renderer/**/*.{ts,tsx}"]` 上。
该规则的注释原文即「ban literal `@novel-master/core*` in renderer only（main/shared/test remain allowed）」。
实测 renderer 下 `@novel-master/core` 的 import 共 9 条、分布 8 个文件，与 spec 完全吻合。

**行号约定**：spec 记的是 **import 语句的起始行**（6 处是多行 import，specifier 在块尾）。
这个约定 spec 未声明，6/9 的行号与 specifier 实际所在行不同（如 #6 记 `:26`、specifier 在 `:43`），
容易让复核者误判为「行号漂了」。补一句声明即可（MF-12）。

| # | spec 记的行 | 实测 | 符号数核对 | 出口「是否已备」核对 |
|---|---|---|---|---|
| 1 | `renderer/App.tsx:2` | ✅ `:2` 单行 | `validateVfsEntryName` ×1 ✅ | ✅ `shared/logic/vfs.ts:13` 精确 |
| 2 | `renderer/features/chat/chat-link-route.ts:19` | ✅ `:19` 单行 | 2 个 ✅ | ❌ 确需新增（`chat.ts:37-114` 内无这两个）✅ |
| 3 | `renderer/features/chat/conversation-abort-retain.ts:1` | ✅ 起始行 `:1`（specifier `:4`） | 2 type ✅ | ✅ `events.ts:13-14` 精确 |
| 4 | `renderer/features/chat/ConversationPanel.tsx:13` | ✅ 起始行 `:13`（specifier `:18`） | 4 type ✅ | ⚠️ 确缺 2 ✅ |
| 5 | `renderer/hooks/useAgentRunLifecycle.ts:12` | ✅ 起始行 `:12`（specifier `:16`） | 3 type ✅ | ⚠️ 同上 ✅ |
| 6 | `renderer/hooks/useAgentStream.ts:26` | ✅ 起始行 `:26`（specifier `:43`） | **8 常量 + 8 type** ✅ | ❌ 确需新增 12 ✅ |
| 7 | `renderer/hooks/useAgentStreamMetrics.ts:30` | ✅ `:30` 单行 | 1 个 ✅ | ❌ 确需新增 1 ✅ |
| 8 | `renderer/providers/ShellNavProvider.tsx:35` | ✅ 起始行 `:35`（specifier `:40`） | 2 常量 + 2 type ✅ | ✅ 全备，`events.ts:11-14` 精确 |
| 9 | `renderer/providers/ShellNavProvider.tsx:60` | ✅ `:60` 单行 | 1 个 ✅ | ❌ 确需新增 1 ✅ |

**符号总数对账**（Step 1 的「16 个符号 / 追加 12」）：
9 处违规的符号并集 = 事件常量 8（`RUN_STARTED/RUN_FINISHED/RUN_FAILED/STEP_COMMITTED` +
4 个 `STREAM_*`）+ payload type 8 = **16**；
`shared/logic/events.ts` 现有 4（`:11-14`）⊂ 该集 ⇒ **需追加 12**，
spec 列的 6 常量 + 6 type 与差集**逐个吻合**。`chat.ts` +3、`provider.ts` +1 亦吻合。**算术无误。**

**core 上游现成性**：`packages/core/src/public/events.ts` 实测导出 **9 个 `EVENT_*`（`:7-15`）+ 11 个 payload type（`:19-28`）**，
spec 写的「`public/events.ts:6-29` 已导出 9 个 + 11 个」✅ 命中。

**顺带印证 X1.2.1 的实质结论**：`shared/logic/events.ts` 的 4 个符号确有消费方——
`renderer/features/chat/SessionDetailDrawer.tsx:54-59` 一次性导入那 4 个 ✅ 精确。
「零消费」是错的，**作废该修法正确**。

## 3 · must-fix 清单

| ID | 级别 | 位置 | 问题 | 建议改法 |
|---|---|---|---|---|
| **MF-1** | **P0** | X1 §X1.3 Step 5 ↔ §X1.7 ↔ §X1.8 末行 | 三处对立：Step 5 说「删 `:58`（Lint）与 `:62`（Typecheck）**两行**」；§X1.7 说「否则 Step 5 会让 mobile 的 27 条 lint error 一次性把 CI 打红」；§X1.8 末行说「本条**只摘 Typecheck** 的 `continue-on-error`（Wave A 已做）；Lint 那一行留到 mobile 收口后」。**且按现状不可实施**：`ci.yml:59` 是 `npm run lint --workspaces --if-present` 单步全 workspace，spec 没有任何「按 workspace 拆步」的动作 ⇒ 删 `:58` 必被 mobile 打红，不删则 Lint 仍全放行，两条路都达不到 Step 5 宣称的效果 | 明确二选一并写死：**(a)** Step 5 改为「**本条不碰 `:58`**，只承接 Wave A 已落的 `:62`；desktop/core/驱动包的 Lint 归 blocking 由**新增一条独立 CI 步骤** `npm run lint -w @novel-master/desktop -w @novel-master/core -w @novel-master/tdbc-driver-* …` 实现（写全 workspace 名），`:58` 保留到 wave-a 收 mobile 存量时再摘；**(b)** 把 `:58` 整体推给 wave-a，本条 Step 5 只剩「承接」。同步改 §X1.8 末行与 §X1.7 措辞 |
| **MF-2** | **P0** | wave-e.md 全文 | **「tsconfig.test paths 对齐」整节缺失**。`## ` 级标题共 13 个：X1 / X2 / X3 / H1~H6 / C1 / C2 / 分片级注记，**无此条**；全文 `kkv` 零命中。而 `SPEC.md:26`、`wave-e.md:5` 文首、`ledger-v2.md:490` Wave E 表三处都承诺了它 ⇒ 覆盖完备性缺口 | 按七要素补一节（可直接用 §5 的素材成文） |
| **MF-3** | P1 | X1 §X1.3 Step 4 | **漏 `apps/cli`**：`apps/cli/eslint.config.mjs:3` = `createTsEslintConfig(import.meta.dirname)`（无 `testTsconfig`），`tsconfig.json` 的 `include` 只有 `["src/**/*"]`，`package.json:11` 的 `lint` 是 `eslint src test`，`test/` 下 **20 个 `.test.ts`** ⇒ 与 10 个驱动包**完全同型**的恒红面，Step 4 的「10 个包」清单不含它。修完后 CI 一旦把 Lint 转 blocking，这里会炸 | Step 4 改为「11 个使用方 = 10 个 packages + `apps/cli`」，并同步 X1.4 ③ 的「其余 9 个包」→ 10 |
| **MF-4** | P1 | X1 §X2.3 Step 2 | 棘轮基线只存 `{"maxErrors": N}`（**计数**），却要求「`N > maxErrors` ⇒ 打印**新增的那几条**（按文件分组）」——**从计数推不出身份**。更要命的是纯计数棘轮有**净零绕过**漏洞：修 1 条 + 引入 1 条，总数不变 ⇒ 门禁放行 | 基线改为存**错误身份集合**（`{file, line, code, message}` 数组或 `tsc` 输出的指纹行），`maxErrors` 只作二级上限；打印新增项 = 集合差集。这样才同时满足「打印新增」与「不允许置换」 |
| **MF-5** | P2 | X1 §X1.1(f) | 包清单列了 **11 个名字**却说「10 个」，且 `tokenizer-driver-rn` **没有 `test/` 目录**（实测）。实际 10 个 = cloud-sync-driver-s3 / llm-sse-native / sksp-{android,linux,mac,windows} / tdbc-driver-{better-sqlite3,op-sqlite,rn} / tokenizer-driver-**node** | 删掉 `tokenizer-driver-rn`。附带正面确认：「10 个包共 33 个 test 文件」「op-sqlite 单包 8 条」**实测全对**（33 = 1+3+2+1+1+1+4+8+7+5） |
| **MF-6** | P2 | X1 §X1.2.1 | ① 引用错：`synth/apps-desktop.md:410` 的原文是「头注释明文：renderer 不得 import core —— 实际被违反 9 处（S-D-06）」，**不是**「2 符号零消费」；全篇 `findstr` 无该表述（真正相关的是 `:169-183` 的 S-D-06 处置三档）。② 计数错：「9 处违规里有 **6** 处因此绕过它」——实测 `@novel-master/core/events` 只出现在 #3/#4/#5/#6/#8 共 **5** 处（#1 vfs、#2/#9 chat、#7 provider）。该 6 沿袭自 `raw/w3-xc-ipc.md:287`（原文「覆盖全部 9 处违规中的 6 处」），源头就错 | 引用改指 `synth/apps-desktop.md:169-183`；「6 处」改「5 处」，并顺手在 §X1.2.1 点名 w3-xc-ipc:287 同源待回改 |
| **MF-7** | P2 | X2 §X2.1 | 引 `apps/desktop/package.json:12`，实际 `typecheck` 在 **`:11`**（`:12` 是 `build:icons`）。台账 §2.8 写的 `:11` 才对 | 改 `:11` |
| **MF-8** | P2 | X2 §X2.1 | 「`tsconfig.renderer.json` **没有任何 npm script / CI 步骤引用它**」与**本文自相矛盾**：§X2.3 R1(b) 写「desktop 已有 `tsconfig.renderer.json` 被 `run-tests.mjs` 复用」，§H6.1 引的 `run-tests.mjs:34` 正是 `npx tsx --tsconfig tsconfig.renderer.json --test` | 窄化为「**没有任何以它跑 `tsc` 的 npm script 或 CI 步骤**」 |
| **MF-9** | P2 | X2 §X2.3 Step 4 R1 | R1 预估减量写 `−69`，但其默认建议 (a)「把 `src/main/**/*` 加进 `tsconfig.renderer.json` 的 `include`」会**同时消掉 `src/**` 那 42 条全 TS6307**（tsconfig 自身实测：`include: ["renderer/**/*","shared/**/*","test/**/*"]`，确不含 `src/main`）⇒ 实际减量 **−111** | 改 `−111`，或在表下注明「−69 是 R1a、其余 42 条随 (a) 一并归零」 |
| **MF-10** | P2 | X2 §X2.4 ③ | 标题「棘轮**不会误杀**（把 maxErrors 调到 400 → 期望 exit=1）」——调到 400 < 411 期望的是**红**，标题与内容相反 | 标题改「棘轮对下调敏感」 |
| **MF-11** | P2 | X1 §X1.6 / §X1.7 | H6 出现在 §X1.6 回归线（「必须用修好零收集守卫后的命令」）与 §X1.7 末行（「建议同 PR」），但**不在 §X1.7 依赖表**；§X1.4 ⑤ 的 `npm test` 验收也没带这个前置 | §X1.7 依赖表补一行「H6（零收集守卫）：`npm test` 回归线的真实性依赖它，同 PR 或先行」 |
| **MF-12** | P2 | X1 §X1.1(c) | 行号取「import 语句起始行」这一约定未声明，6/9 与 specifier 实际行不同 | 表头加一句「行号 = import 语句起始行」 |
| **MF-13** | P1 | 待补的 paths 条 | 见 §5，4 个约束 spec 必须写死，其中「与 D-207 方向相反」是**跨分片依赖**，漏了会与 wave-d 打脸 | 补节时一并写入 |

## 4 · 结论

**组 Go/No-Go：No-Go**（doc-fix 后可转 Go）。

一句话理由：**X1 的 Step 5 在同一节里被自己否掉了三次、且按现有 `ci.yml` 结构根本落不下去，
而组 A 的第三个条目「tsconfig.test paths 对齐」整节缺失——两条 P0 都是文档级、可由主代理直接闭合，
不需要重跑任何实测。**

正面结论也记一笔：**X1 的证据质量在本轮分片里属上乘**，9 处违规、core 8 条 error、
`shared/logic/*` 每一处行号、`public/events.ts` 的 9+11 符号、`SessionDetailDrawer.tsx:54-59`
全部经得起逐行复核；X2 的 411 分布与 R1~R6 分批在算术上完全自洽，依赖（Wave A / Wave D 批次 3 /
Wave B §6#5 / `baseline.md`）四条写得清楚、边界干净。**补齐 MF-1~MF-13 之后，这组可以 execute。**

## 5 · 附：paths 对齐条的底层事实与可实施性（供 doc-fix 直接成文）

### 5.1 病症侧（全部实测，供 MF-2 使用）

- `packages/core/tsconfig.test.json:26` = `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]` ✅ 与台账一致
- `packages/core/package.json:81-83` = `"./kkv": { "types": "./dist/public/kkv.d.ts", "import": "./dist/public/kkv.js" }` ✅
  ⇒ **同一子路径，paths 指内部 barrel、exports 指公共 barrel**，台账这一句是对的
- `packages/core/test/package-exports/public-subpath-allowlist.test.ts:28` 的写法是
  `await import(\`@novel-master/core/${name}\`)`，而 `SUBPATHS`（`:5-18`）只有 12 项、**不含 `kkv`**，
  `snapshots/` 下也**无 `public-kkv-allowlist.json`** ⇒ 「package exports 契约测试验的是错的 barrel」
  这句在 kkv 上更精确的表述是：**kkv 压根没被任何契约测试覆盖**。
- 这 12 项之所以「验的是 src barrel」，是因为 core 测试跑在
  `tsx --tsconfig tsconfig.test.json` 下，bare specifier 被 `paths` 接管 → 解析到 `./src/public/*.ts`。
- 先例条文：`docs/apm/RULE.md:74`「给 @novel-master/core 新增 exports 子路径必须同步
  `packages/core/tsconfig.test.json` 的 paths」✅ 存在，spec 在 H3.4 引对了。

### 5.2 「补一条测试真解 `dist/public/kkv.js`」在 node:test 下可行吗

**可行，但 spec 至少要补写 4 条约束，否则落地必踩**（MF-13）：

1. **必须显式绕开 tsx 的 `paths`。** 用 `import("@novel-master/core/kkv")` 是**无效的**——tsx 会照样按
   `tsconfig.test.json` 的 `paths` 解析到 `src/service/kkv/index.ts`。可行写法只有
   相对路径 `new URL("../../dist/public/kkv.js", import.meta.url)`，或
   `createRequire(import.meta.url).resolve("@novel-master/core/kkv")`（走 node `exports` 解析）。
   spec 必须点名用哪一种。
2. **恒红风险（判据②）。** `dist/` 是 gitignore 产物、且**可能是旧产物**
   （`synth/verify-dead.md:135` 实测「`packages/core/dist` 存在但是旧的（2026-10-01 02:34）」）。
   新 clone / 未 build 的本地环境这条测试必红。须写明：① 前置 `npm run build -w @novel-master/core`；
   ② CI 侧排在 `Build workspaces`（`ci.yml:50-51`）之后；③ 或在测试内对 dist 缺失做 `test.todo` 降级。
3. **与 D-207 方向相反（跨分片依赖，必须写进「依赖」）。**
   `synth/dead-backlog.md:246` 与 `raw/verify-dead.md:105` 都记：**D-207 要删
   `packages/core/src/service/kkv/index.ts`，并「连带删 `tsconfig.test.json:26` 的映射」**。
   本条若走「把 paths 改指 `./src/public/kkv.ts`」的方向，落地后 D-207 的连带项就变成空操作；
   两条必须显式声明先后，否则 wave-d 与 wave-e 会互相打脸。
4. **定级要说清是「修 bug」还是「加守卫」。** `raw/w9-bootstrap-pro.md:112/122` 实测两份 barrel
   「逐行对应、内容等价」⇒ 若内容确实等价，本条**不是功能修复，是加一道防漂移守卫**。
   spec 现在的严重度栏没写这一层，实施方会按「修 bug」估工。

## 附：本机位**未**实跑、留给 judge 的外部数字

`411`（vs 台账 `424`、原报告 `813`）、`24 warnings`、`107 warnings`、driver `8 errors`、
`features/settings` `152/178` 与四件 `79/25/18/12`、`chat-transcript`/`rich-document` 等产物计数、
mobile `27 errors / 405 warnings`。这些需在 `baseline.md`（S1 机位）同机器同一次实跑上定案。
**spec 内部自洽性我已全部核过，结论是自洽的**（§1 第 23 行）。
