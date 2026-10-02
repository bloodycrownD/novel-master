# fix-spec 验收基线（s-baseline 机位产出）

> 性质：**实跑**记录，不是推演。台账 §11 承认「`tsc -p packages/core` / 三包 `npm test` 全绿 W5–W11 均未执行」，
> 本文件补上这块地基。Wave D 每批验收 = 四域 tsc + 三包测试对照本文件的**已知红清单**判增量，不对照零基线误判。
>
> 纪律：本机位**只跑不改**。未做任何 git 写，未改任何生产/测试代码与配置，未改 `docs/apm/`。
> 唯一写入 = 本文件 + `tmp/baseline-*.log`（构建产物 `dist/`、`webview-dist/` 除外）。

## 0 · 环境与基线标识

| 项 | 值 |
|---|---|
| 仓库 / worktree | `D:\Dev\nm-worktree\mcr` |
| 分支 / HEAD | `feat/repo-mega-cr` / `fe79b7810c0c78c48a18c76486359d7d45e253fa` |
| 实跑日期 | 2026-10-01 |
| OS / 时区 | Windows 10.0.26200 x64 / **China Standard Time (UTC+8)** |
| Node / npm | v22.22.0 / 10.9.4 |
| TypeScript | 6.0.3（仓根 devDep） |
| 日志目录 | `D:\Dev\nm-worktree\mcr\tmp\baseline-*.log` |

⚠️ **时区敏感**：`packages/core` 的 usage-stats 两条红灯依赖本机时区与当前日期（详见 §3.1）。
换机器/换时区复跑时这两条结论可能翻转，判增量前先确认口径。

⚠️ 另注：`git status` 有一处既有未跟踪文件 `?? $null`（历史 Windows shell 转义事故产物，与本轮无关，未动它）。
台账 §11 提到的根目录 4 个空目录哨兵（`(echo`、`exist`、`OK)`、`if`）在本 worktree 不存在。

---

## 1 · 前置构建（RULE「新 worktree 验证清单」三件套）

### 1.1 根 `npm run build` —— **exit 0（绿）；本节原结论已被 R1 judge 推翻并重写**

> 🔁 **R2 订正（依据 `judge-r1.md` C① / R2-1）**：本节原先写的「根 build 因 npm `--workspaces`
> 参数转发而 exit 1、preload 不产出、smoke 假红」是**测量假象，不是仓库缺陷、不是 npm 缺陷、
> 也不是 CI 缺陷**。judge 在同一 HEAD、同一机器、同一 node/npm 上实跑了对照实验，推翻了整条因果链。
> 原「兜底做法 = 逐包 build + 单独补 build:preload」一段整段作废。

日志：`tmp/baseline-00-root-build.log`（原始那份是带 shell 包装跑出来的，见下方铁证）

**原始日志里的现象**：exit 1、14 处报错文本完全一致：

```
error TS5042: Option 'project' cannot be mixed with source files on a command line.
```

命中该错误的 14 个 workspace `build` 脚本：
`cloud-sync-driver-s3`、`llm-sse-native`、`sksp-android`、`sksp-linux`、`sksp-mac`、`sksp-windows`、
`tdbc-conformance`、`tdbc-driver-better-sqlite3`、`tdbc-driver-op-sqlite`、`tdbc-driver-rn`、
`tokenizer-driver-node`、`tokenizer-driver-rn`、`cli`、`mobile`。

**真因（judge 实跑对照，铁证在日志里）**：**cmd.exe 不把 `;` 当命令分隔符**。测量机位执行的是

```
npm run build --workspaces --if-present > log 2>&1 ; echo "EXITCODE=$?"
```

`;`、`echo`、`"EXITCODE=$?"` 被 cmd 当成**三个位置参数**转发给了 `npm run`，npm 再把它们逐个转给每个
workspace 的 `build` 脚本 ⇒ 实际执行成 `tsc -p tsconfig.json ; echo EXITCODE=$?`
⇒ tsc 看到 `-p` 与「源文件」混用 ⇒ TS5042。

`baseline-00-root-build.log:3` 的**根级 banner 自己就是**
`> npm run build --workspaces --if-present ; echo EXITCODE=$?` —— 那个 `; echo EXITCODE=$?`
本来就属于**调用方的 shell 行**，不属于仓库。这是判定「测量机位而非仓库」的铁证。

**judge 的四组对照实验**（同 HEAD / 同机器 / 同 node npm）：

| 实验 | 命令形态 | 结果 |
|---|---|---|
| 1 | `cd packages\tdbc-conformance && npm run build tdbc-conformance`（手塞位置参数） | TS5042 —— 证明「位置参数会被转发」，但**不证明** npm `--workspaces` 有缺陷 |
| 2 | 根 build **带 `;` 包装**（即 baseline 原始命令形态） | 14 处 TS5042、exit 1，每个 banner 都是 `> tsc -p tsconfig.json ; echo EXITCODE=$?` |
| 3 | 根 build，**只把包装从 `; echo` 换成 `&& echo`** | **exit 0**；日志 216 行，TS5042 命中 0 次、`npm error` 0 次、`echo EXITCODE` 命中 0 次 |
| 4 | 根 build，`cmd /c` 内层**无任何追加** | **exit 0** |

旁证：`npm run build -w @novel-master/tdbc-conformance -w @novel-master/cloud-sync-driver-s3`
（`-w` 形态不带那个后缀）**正常绿**，进一步佐证问题出在调用形态而非 npm 的 `--workspaces` 实现。
CI 是 `ubuntu-latest`，`;` 在那里是合法分隔符，因此这条在任何 CI 上都不会出现。

**连带核验（实验 3/4 之后）**：`apps/desktop/dist/src/preload/preload.cjs` **存在**、mtime 为本次构建时刻；
`apps/desktop` 单跑 smoke.test.js → **9/9 全绿**（含
`"preload exposes novelMasterDesktop IPC bridge API"`）。⇒ 原「preload 不产出」「desktop smoke 假红」
两条连带影响**随之作废**（§5 F3 与 §6 第 1 条已同步订正）。

**给 Wave D/E 的口径**：**根 `npm run build` 一把梭可用，不必逐包 build，也不需要额外补
`build:preload`。** 唯一的纪律是：**Windows 下取退出码不要用 `;` 串联**（cmd 不认 `;`），改用 `&&`
或读 `$LASTEXITCODE`；否则会把三个位置参数转发进每个 workspace 的 `build`，造出上面那 14 处假 TS5042。
（若想在规则层长期防再犯，形态应是 RULE 级提示「cmd.exe 用 `&`/`&&` 不用 `;`」，不是 fix-spec 条目。）

### 1.2 `apps/mobile` 的 `npm run build:webview` —— **exit 0（绿）**

日志：`tmp/baseline-02-webview.log`。产出 `webview-dist/` 四个 bundle（`chat-transcript` / `rich-document` /
`code-editor` / `composer-input`）。缺这一步 mobile jest 会有 8 套件 32 例假红，本轮未出现。

### 1.3 依赖包 dist 落地核查（构建后实测文件数）

`core` 2564 文件、`cloud-sync-driver-s3` 16、`tdbc-driver-better-sqlite3` 20、`tokenizer-driver-node` 44、
`llm-sse-native` 16、`sksp-*` 16~20、`tdbc-driver-op-sqlite` 48、`tdbc-driver-rn` 44、`tokenizer-driver-rn` 28 —— 均已落地。

---

## 2 · 四域 typecheck

| # | 命令（cwd = worktree 根） | exit | 错误数 | 判定 |
|---|---|---|---|---|
| T1 | `npx tsc --noEmit -p packages/core` | **0** | **0** | 绿 |
| T2 | `npx tsc --noEmit -p apps/desktop`（主进程，`include: src/main/**/* + shared/**/*`） | **0** | **0** | 绿 |
| T3 | `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` | **1** | **411** | **已知红** |
| T4 | `npm run typecheck`（cwd = `apps/mobile`，含 `pretypecheck` 的 6 包重建 + `tsconfig.build.json` + `src/web/tsconfig.json` + `e2e/tsconfig.json` 三段） | **0** | **0** | 绿 |

日志：`tmp/baseline-01-tsc-core.log` / `baseline-03-tsc-desktop.log` / `baseline-04-tsc-renderer.log` / `baseline-05-mobile-typecheck.log`

### 2.1 T3 复核：**台账 424 → 实测 411，漂移 −13**

`tsconfig.renderer.json` 无 `incremental`/`composite`（仓里那个 `tsconfig.renderer.tsbuildinfo` 是死文件，不影响结果），
411 这个数可复现。台账的 424 已过期，**Wave E 的 renderer 门禁分批必须改用 411 打底**。

按目录聚合（411 = 190 + 160 + 42 + 18 + 1）：

| 桶 | 条数 | 说明 |
|---|---|---|
| `apps/desktop/test/**` | **190** | `include` 里带了 `test/**/*`，测试文件自身类型错也计入 |
| `apps/desktop/renderer/features/**` | **160** | 与台账记的 160 **完全一致**（漂移全在 test / src 两桶） |
| `apps/desktop/src/main/**` | **42** | 由 test 文件 import 带入（`tsconfig.renderer.json` 并不 include `src/**`） |
| `apps/desktop/renderer/`（非 features） | **18** | |
| `packages/core/src/errors/session-fs-errors.ts` | **1** | 跨包唯一一条：TS2307 找不到 `@/domain/chat/logic/rollback-confirm-copy.js` |

按错误码聚合（Top）：TS18046 ×138、**TS6307 ×69**、TS18047 ×49、TS2339 ×42、TS2322 ×21、TS2345 ×18、TS6133 ×13、TS2571 ×11、TS2559 ×11、TS2540 ×10、TS7006 ×8、TS7017 ×5。

单文件 Top 12：`renderer/features/settings/SettingsViews.tsx` 79、`test/chat-prompt-tokens.test.ts` 45、
`test/token-usage-stats-view.test.tsx` 43、`renderer/features/settings/AgentEditorView.tsx` 25、
`renderer/features/settings/ModelSamplingView.tsx` 18、`test/workspace-push-menu.test.tsx` 17、
`renderer/features/settings/AgentDefinitionEditorForm.tsx` 12、`renderer/features/settings/FetchModelsModal.tsx` 9、
`test/fetch-models-modal.test.tsx` 9、`renderer/features/settings/WorkspaceSettingsView.tsx` 9、
`test/metrics-detail-popover.test.tsx` 7、`src/main/ipc/handlers/vfs.ts` 6。

**给 Wave E 的口径**：清账优先级沿用台账四件套（`SettingsViews` / `AgentEditorView` / `ModelSamplingView` /
`AgentDefinitionEditorForm` 合计 134 条，占 features 桶 84%），但**验收分母写 411，不是 424**。
TS6307 那 69 条是「文件不在项目内却被引用」的组合项目错误，多半是 tsconfig `include`/`paths` 口径问题，
应在逐文件清账之前先用一次配置面收敛吃掉，否则 411 这个基线会跟着 include 面变动而漂。

### 2.2 mobile lint —— **exit 1，432 problems（27 errors + 405 warnings）**

命令：`npm run lint`（cwd = `apps/mobile`，脚本为 `eslint . --max-warnings 321`）。日志：`tmp/baseline-09-mobile-lint.log`

**复核结论：台账记的「实测 405」是准确的** —— 405 就是 **warning** 数；台账漏记了同时还有 **27 个 error**。
`--max-warnings 321` 这道闸门有两道坎：warning 405 > 321，且 27 个 error 本身就让 eslint 退出 1。
所以「321 vs 405」的差距只是问题的一半，另一半是 27 个 error 此前没被记账。

按规则聚合：

| 规则 | error | warning |
|---|---|---|
| `react-hooks/exhaustive-deps` | **21** | 0 |
| `import/first` | **4** | 0 |
| `no-undef` | **2** | 0 |
| `no-void` | 0 | **138** |
| `react-native/no-inline-styles` | 0 | **97** |
| `@typescript-eslint/no-explicit-any` | 0 | **82** |
| `@typescript-eslint/no-unused-vars` | 0 | 32 |
| `@typescript-eslint/no-shadow` | 0 | 30 |
| `react-hooks/exhaustive-deps`（warning 侧余量） | — | 21 归在 error 行 |
| `no-bitwise` | 0 | 12 |
| `no-new` | 0 | 6 |
| `no-useless-escape` | 0 | 4 |
| `consistent-this` | 0 | 2 |

**给 Wave A/E 的口径**：mobile lint 的已知红基线 = **27 error + 405 warning**。
27 个 error 是「清完就能让 eslint 从 exit 1 变成只剩 warning 超阈」的最小可交付集，优先级高于 405 条 warning。

---

## 3 · 三包测试

### 3.1 `npm test -w packages/core` —— exit 1，**3126 tests / 679 suites / 3123 pass / 3 fail / 0 skip**

日志：`tmp/baseline-06-core-test.log`（run1）、`baseline-06c-core-test2.log`（run2）、`baseline-06b-core-rerun.log`（隔离复跑）。
**台账口径 2748 已过期，实测 3126（+378）**。必须走包自带 `npm test`（内部是 `bash -O extglob -O globstar -c 'tsx … --test test/**/!(performance).test.ts'`），
Windows 下若手拼 `tsx --test` 会被 `!(performance)`  extglob 打回空收集。

两次全量跑（同一台机器、同一 HEAD）**fail 数恒为 3，但第三条每次不同**：

| 轮次 | 第 1、2 条（稳定） | 第 3 条（每次不同） |
|---|---|---|
| run1 | `usage stats service (T-S5)` 套件下 2 条子用例 | `test/infra/message-content-decompression.test.ts` → 套件 `反向搬运用时护栏（T-MP-P1）`，子用例「100 行压缩→明文解压写回耗时不超同构明文全量读基线的 15 倍」 |
| run2 | 同上 | `test/message-checkpoint/checkpoint-seed-batch-perf.test.ts` → 套件 `checkpoint seed 批量化性能（200 文件 × 500 消息）` |

**判定（按 RULE 降并发/隔离复跑法）**：

- **真红（已隔离复现，计入已知红基线）** —— `packages/core/test/chat/usage-stats.service.test.ts`，2 条子用例：
  1. `T-C2: 本地时区天边界：本地 00:30 入当日桶、昨日 23:30 入前一日桶；闭区间双端含`
     —— `usage-stats.service.test.ts:180`，`strictEqual` 期望 60 实得 **30**；
  2. `T-C6: DST 切换日按挂钟日归桶（春季拨快 2026-03-08 / 秋季拨慢 2026-11-01 NYC）`
     —— `usage-stats.service.test.ts:952`，`strictEqual` 期望 2 实得 **1**。
  隔离复跑（`npm run test:fast -- test/chat/usage-stats.service.test.ts test/infra/message-content-decompression.test.ts`，
  55 tests / 53 pass / 2 fail）**仍然红**，且同批的解压套件转绿 → 判定为与机器负载无关的**确定性红灯**。
  从断言形态看是本地时区（UTC+8）与当前日期（2026-10-01）相关的环境/日期依赖，不是本次迭代引入。
  ⚠️ 这两条**会随日期推移自行翻转**，Wave D/E 判增量时应先单独复跑该文件确认口径。

- **假信号（满负载耗时护栏，隔离复跑变绿，不计入已知红）**：
  上述两条**性能护栏套件**，两次全量各命中一条不同的，隔离跑均绿。
  core 的 `test` 脚本没有暴露 `--test-concurrency` 入口（`bash -c '…'` 固定串），本轮用「隔离复跑」判定，
  未能在全量低并发口径下复跑。若后续要彻底消抖，见 Wave E「tsconfig/脚本面收口」条目。

**core 已知红基线（判增量用）：3 fail，其中 2 条确定性 + 1 条「每次不同的性能护栏」。**

### 3.2 `apps/desktop` 测试 —— **包自带脚本在 Windows 上静默空跑（exit 0，收集 0 条）**

这是本轮最重要的发现之一，属于台账 N-P0-02 / 防再犯钩子⑥那一族，**且尚未修复**。

**(a) 直接 `npm test`（脚本默认路径）—— 假绿**

日志：`tmp/baseline-07-desktop-test.log`

```
> node scripts/run-tests.mjs
TAP version 13
1..0
# tests 0
# suites 0
# pass 0
# fail 0
# duration_ms 8.8989
EXITCODE=0
```

原因：`apps/desktop/scripts/run-tests.mjs:27-30` 的默认目标是
`'test/**/*.test.ts' 'test/**/*.test.tsx' 'test/**/*.test.js'`（**单引号**），
注释里写的修复理由（“引号阻止 shell 展开，由 node 侧 `**` 递归匹配”）只在 `sh` 下成立。
Windows 上 `execSync(..., { shell: true })` 走的是 `cmd.exe`，cmd **不把单引号当引号**，
于是带引号的 glob 原样进到 `node --test`，匹配 0 个文件；而 `node --test` 收 0 条时 **exit 0** ——
静默空跑，CI 上看起来是绿的。**「两种 shell 都跑一遍」的门禁缺失依旧。**

**(b) 实际能跑起来的调用（Wave D/E 验收请用这条）**

```
cd apps/desktop
npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"
```

参数经 npm → `run-tests.mjs` 的 `extraArgs` 分支 → 拼成不带引号的三个 glob → cmd 不展开 → node 侧递归匹配。
实测收集 **628 tests / 126 suites**。仓内 `apps/desktop/test/` 下共 **110 个测试文件**
（`*.test.ts` 95、`*.test.tsx` 12、`*.test.js` 3），五扩展名口径已由脚本覆盖，收集面完整。

**(c) 三次全量实跑（pretest 的 `ensure-test-native.mjs` 正常，better-sqlite3 已对齐系统 Node）**

| 轮次 | tests | pass | fail | 唯一失败项 |
|---|---|---|---|---|
| run1（`baseline-07b`） | 628 | 627 | 1 | `test/smoke.test.js`：`dist/src/preload/preload.cjs missing — run npm run build -w @novel-master/desktop` |
| run2（`baseline-07d`） | 628 | 627 | 1 | `desktop blob 归一调度服务（cr-03 / cr-05）` 套件 → 子用例 `cr-05：轮内连接被关（not open）不永久死亡——退避后重挂并完成归一`，断言「not open 注入必须真被消费」`false !== true` |
| run3（`baseline-07g`） | 628 | 627 | 1 | 同 run2，同一条 |

- run1 的红是 **构建产物缺失导致的假红**：当时跑根 build 用的命令带了 `; echo EXITCODE=$?` 包装，
  cmd.exe 把这三段当位置参数转发给每个 `tsc -p`，`build:preload` 遂静默无产出（**R2 订正：归因在
  测量机位的 shell 包装，不是根 build 的参数转发缺陷**——干净根 build 正常产出 preload、smoke 9/9 全绿，见 §1.1）。
  单独补跑 `npm run build:preload -w @novel-master/desktop` 后该用例转绿（run2/run3 佐证）。
- run2/run3 的红是 **满负载假信号**：`npm test -- test/blob-binary-normalization-service.test.ts` 隔离跑
  **4 tests / 4 pass / 0 fail**（`baseline-07e`）。两次全量都命中同一条，属可复现的负载敏感 flake。

**(d) `--test-concurrency=2` 全量复跑的尝试与结论（记录以免后人重踩）**

`run-tests.mjs` 的 `extraArgs` 会被当成**测试目标**直接拼到 `--test` 后面，**没有位置留给 `--test-concurrency`**，
所以无法经包脚本降并发。改用手拼 `npx tsx --tsconfig tsconfig.renderer.json --test --test-concurrency=2 …`
（`tmp/baseline-07f`）**结果不可用**：只收集到 536 tests，且 23 个**文件级** `not ok`（`exitCode: 1`、无 stderr），
比包脚本的 628 少一截——手拼路径没能等价复现 `run-tests.mjs` 的 Electron mock 装载环境。
**结论：desktop 目前没有可信的「全量低并发」跑法**，只能用「包脚本全量 + 失败项隔离复跑」两步判假信号。

**desktop 已知红基线（判增量用）：628 tests / 627 pass / 1 fail，且该 1 条为满负载 flake（隔离绿）；
同时 `npm test` 默认路径在 Windows 上是收集 0 条的假绿，必须用 (b) 的带参调用。**

### 3.3 `apps/mobile` jest —— exit 1，**1739 tests / 237 suites / 1738 pass / 1 fail / 1 snapshot passed**

命令：`npm test -- --maxWorkers=2`（cwd = `apps/mobile`；`pretest` 自动重建 core + 3 驱动 + webview）。
日志：`tmp/baseline-08-mobile-jest.log`（全量，37.2s）、`tmp/baseline-08b-mobile-iso.log`（隔离复跑）。
**台账口径 1604 已过期，实测 1739（+135）。**

唯一红灯：`__tests__/mermaid-fullscreen.test.ts` → 用例
`mermaid 全屏查看器两管线接线 (T-MF3) — rich-document main 挂接不进 setDocument 视图刷新链路（T-MV1 顺序不变）`。
断言是对 `src/web/rich-document/webview/main.ts` 源码文本做正则匹配：
`/\}\);\n\nbindAnnotateUi[\s\S]*mountMermaidViewerPortal/` 未命中。
隔离复跑（`npx jest __tests__/mermaid-fullscreen.test.ts --maxWorkers=2`）**21 tests / 20 pass / 1 fail，仍然红** →
判定为**确定性真红**（源码文本顺序断言与实际不符），计入已知红基线。
附带噪音：该套件有若干 `Cannot log after tests are done`（异步 console 泄漏），不影响判定。

**mobile 已知红基线：1739 tests / 1738 pass / 1 fail（mermaid-fullscreen 源码正则断言）。**

---

## 4 · 「已知红基线」总表（Wave D/E 验收线直接引用）

| 域 | 命令 | exit | 分母 | 已知红 | 性质 |
|---|---|---|---|---|---|
| core tsc | `npx tsc --noEmit -p packages/core` | 0 | 0 错 | **0** | 绿 |
| desktop 主进程 tsc | `npx tsc --noEmit -p apps/desktop` | 0 | 0 错 | **0** | 绿 |
| desktop renderer tsc | `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` | 1 | **411** | **411** | 已知红（台账 424 已漂移） |
| desktop renderer tsc（**Wave D 后新基线**） | `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` | 1 | **371** | **371** | 已知红（2026-10-01 impl-E-c 实跑；口径同 §2.1：`error TS\d+` 行计数。链路 424 → 411 → **371**，棘轮分母取本行） |
| mobile typecheck | `npm run typecheck`（`apps/mobile`） | 0 | 0 错 | **0** | 绿 |
| mobile lint | `npm run lint`（`apps/mobile`） | 1 | 432 problems | **27 error + 405 warning** | 已知红（阈 321） |
| core 测试 | `npm test -w packages/core` | 1 | **3126** tests | **2 确定性**（usage-stats T-C2/T-C6）+ **1 条每次不同的性能护栏** | 已知红 |
| desktop 测试（带参） | `npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"` | 1 | **628** tests | **1**（`cr-05 not open` 满负载 flake，隔离绿） | 已知红（假信号） |
| desktop 测试（默认） | `npm test`（`apps/desktop`） | **0** | **0**（收集 0） | —— | **假绿，Windows 空跑** |
| mobile jest | `npm test -- --maxWorkers=2`（`apps/mobile`） | 1 | **1739** tests | **1**（`mermaid-fullscreen` 源码正则） | 已知红（确定性） |

**判增量规则**：某批改动后重跑上表，**红条目的条数与位置不得增加**即为通过。
`renderer 411`、`mobile lint 27/405`、core 的 usage-stats 两条、mobile 的 mermaid 一条，是四个稳定锚点。
core 第 3 条与 desktop 那 1 条是**位置会漂的性能/负载红**，只要总数不增、且隔离复跑绿，即判为未引入回归。

> 🔗 **计数口径硬规则（R2-14 判据）**：任何分片/spec 引用「已知红条数 / 测试分母 / 收集数」这类计数类数字前，
> **一律以本文件 `baseline.md` §4 总表为准**（`HEAD = fe79b781`，实跑 2026-10-01）。台账 `ledger-v2.md` 与
> 历史分片里的旧数（如 renderer `424`、core「约 2748」、mobile「约 396」、desktop「稳定 1604/1604」）
> 均为陈旧值，引用时必须带扫描面一起写。

---

## 5 · 假信号处理记录（RULE 判定法：初跑红 → 复跑验证 → 归类）

| # | 初跑红 | 复跑方式 | 复跑结果 | 判定 |
|---|---|---|---|---|
| F1 | core `# fail 3` 中的 `反向搬运用时护栏（T-MP-P1）`（解压耗时 ≤ 15× 基线） | 隔离跑该文件 | 同文件整绿 | **假信号**（满负载耗时护栏） |
| F2 | core run2 `# fail 3` 中的 `checkpoint seed 批量化性能（200 文件 × 500 消息）` | 与 F1 同批隔离跑（另批） | 整绿 | **假信号**（同族性能护栏；两次全量命中不同条目） |
| F3 | desktop run1 `smoke.test.js`：preload.cjs missing | 补跑 `npm run build:preload -w @novel-master/desktop` 后全量复跑 | 转绿 | **假信号成立，但归因订正（R2 / judge-r1 C①）**：不是根 build 的参数转发污染，而是**测量机位的 shell 包装**——cmd.exe 把 `; echo EXITCODE=$?` 当三个位置参数转发给每个 `tsc -p`，才造出 preload 无产出的连锁假象。干净根 build（`&&` 包装或 `cmd /c` 无追加）**exit 0、preload.cjs 正常产出、smoke 9/9 全绿**，见 §1.1 |
| F4 | desktop run2/run3 `cr-05：not open 注入必须真被消费` | 隔离跑 `test/blob-binary-normalization-service.test.ts` | 4/4 全绿 | **假信号**（满负载时序 flake） |
| F5 | desktop `npm test` 默认路径 `# tests 0` / exit 0 | 改带参调用 | 628 tests 正常收集 | **不是测试红，是收集器红**（Windows 单引号 glob，见 §3.2a） |
| F6 | 手拼 `--test-concurrency=2` 全量（`baseline-07f`）23 个文件级 `not ok` | — | 收集数反降为 536 | **复跑手段本身失效**，已作废，不作为基线证据 |
| F7 | core `usage-stats.service.test.ts` T-C2 / T-C6 | 隔离复跑 | **仍红** | **真红**，入已知红基线 |
| F8 | mobile `mermaid-fullscreen.test.ts` T-MF3 | 隔离复跑 | **仍红** | **真红**，入已知红基线 |

---

## 6 · 给 Wave D / Wave E 的落地提醒

1. **验收前必须先跑 §1 的构建三件套。R2 订正（judge-r1 C① / R2-2）**：根 `npm run build`
   **可以一把梭**——原「根 build 不能一把梭、验收脚本必须改成逐包 build + 补 build:preload」的
   **行动指令撤回**（它会让 execute 机位为不存在的问题付逐包 build 的复杂度）。
   硬门只剩一条：**Windows 下取退出码不要用 `;` 串联**（改 `&&` 或读 `$LASTEXITCODE`），否则会造出 14 处假 TS5042。
   `npm run build:webview`（`apps/mobile`）仍需单跑，理由是 §1.2 本身，不是 §1.1。
2. **renderer 门禁分母改 411**，并先做一次 `include`/`paths` 口径收敛吃掉 69 条 TS6307，否则基线会随配置面漂。
3. **desktop 收集器在 Windows 上仍是坏的**（`run-tests.mjs` 单引号 glob + `node --test` 收 0 条仍 exit 0）。
   这条应当作为 Wave E 的硬条目；在修好之前，desktop 验收一律用 §3.2(b) 的带参调用。
4. **防再犯钩子⑥（零收集守卫）仍然缺失**：F5 证明「收集数为 0 ⇒ exit 1」这道闸至今没装，
   `node --test` 收 0 条静默 exit 0 会持续骗人。
5. **core / mobile 的测试分母已漂**（2748 → 3126、1604 → 1739），台账里所有「约 N 条」的表述都要按本表更新。
6. **mobile lint 的 27 个 error 此前未被记账**，只盯 `--max-warnings 321` 会漏掉它们。
7. core 的 usage-stats 两条红与本机时区/日期相关，跨机器复跑前先单独确认口径。

---

## 7 · 本轮执行命令清单（全部实跑，日志在 `tmp/`）

| # | 命令 | cwd | 日志 |
|---|---|---|---|
| 1 | `npm run build` | 根 | `tmp/baseline-00-root-build.log` |
| 2 | `npm run build -w <7 个包>` | 根 | `tmp/baseline-00b-pkgbuild.log` |
| 3 | `npx tsc --noEmit -p packages/core` | 根 | `tmp/baseline-01-tsc-core.log` |
| 4 | `npm run build:webview` | `apps/mobile` | `tmp/baseline-02-webview.log` |
| 5 | `npx tsc --noEmit -p apps/desktop` | 根 | `tmp/baseline-03-tsc-desktop.log` |
| 6 | `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` | 根 | `tmp/baseline-04-tsc-renderer.log` |
| 7 | `npm run typecheck` | `apps/mobile` | `tmp/baseline-05-mobile-typecheck.log` |
| 8 | `npm test -w packages/core` | 根 | `tmp/baseline-06-core-test.log` |
| 9 | `npm run test:fast -- test/chat/usage-stats.service.test.ts test/infra/message-content-decompression.test.ts` | `packages/core` | `tmp/baseline-06b-core-rerun.log` |
| 10 | `npm test -w packages/core`（run2） | 根 | `tmp/baseline-06c-core-test2.log` |
| 11 | `npm test`（默认路径） | `apps/desktop` | `tmp/baseline-07-desktop-test.log` |
| 12 | `npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"` | `apps/desktop` | `tmp/baseline-07b-desktop-test.log` |
| 13 | `npm run build:preload -w @novel-master/desktop` | 根 | `tmp/baseline-07c-preload.log` |
| 14 | 同 12（run2） | `apps/desktop` | `tmp/baseline-07d-desktop-test2.log` |
| 15 | `npm test -- test/blob-binary-normalization-service.test.ts` | `apps/desktop` | `tmp/baseline-07e-blob-isolated.log` |
| 16 | 手拼 `tsx --test --test-concurrency=2`（**已作废**，见 F6） | `apps/desktop` | `tmp/baseline-07f-desktop-lowconc.log` |
| 17 | 同 12（run3） | `apps/desktop` | `tmp/baseline-07g-desktop-test3.log` |
| 18 | `npm test -- --maxWorkers=2` | `apps/mobile` | `tmp/baseline-08-mobile-jest.log` |
| 19 | `npx jest __tests__/mermaid-fullscreen.test.ts --maxWorkers=2` | `apps/mobile` | `tmp/baseline-08b-mobile-iso.log` |
| 20 | `npm run lint` | `apps/mobile` | `tmp/baseline-09-mobile-lint.log` |
| 21（cr-func-A 补记） | `npm run format:check` | `apps/mobile` | **674 文件存量红（CRLF/LF 基线；Wave A 改动 8 文件均不在红名单）**——Format 是 CI blocking 步，存量清账前实际不可绿，与 Lint 同属「已知红须收口」族 |
| — | 旁证探针（不计基线） | | `tmp/probe-s3-tsc.log` |
