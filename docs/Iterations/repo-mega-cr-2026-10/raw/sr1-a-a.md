---
zone: wave-a / 组 A
agent: sr1-a-a（readonly reviewer）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）、
  fix-spec/wave-a.md（A3 / A5 / A6 三节逐行）、
  fix-spec/baseline.md（§2.2 / §3.2 / §4 / §6）、
  docs/apm/RULE.md（实现禁令与坑：验收断言牙齿三判据、Windows 两个假信号、条数实测纪律）、
  apps/desktop/scripts/run-tests.mjs、.github/workflows/ci.yml、
  apps/desktop/package.json、package.json、packages/core/package.json、apps/mobile/package.json、
  tsconfig.base.json、apps/desktop/tsconfig.json、apps/desktop/tsconfig.renderer.json、
  packages/core/src/domain/tool/logic/tool-path-policy.ts、tool-runner.ts、
  packages/core/src/domain/tool/builtin/builtin-tool-context.ts、packages/core/src/index.ts、
  packages/core/src/service/agent/logic/run-agent-turn.ts、create-user-vfs-turn-service.ts、
  packages/core/src/domain/tool/builtin/search/{search-tool.ts,types.ts,engines/*}、
  packages/core/test/package-exports/**、packages/core/test/tool/*（8 个）、
  ledger-v2.md:433-439 / :480-497 / :317-337、wave-e.md（H6 / 边界表）、
  raw/w9-tool-pro.md、raw/w9-tool-adv.md、docs/Iterations/cr-fix-spec/spec.md:172、
  docs/Iterations/web-search-tool/spec.md:105-107
实跑命令: >
  npm run typecheck --workspaces --if-present（exit 0）、
  npm run build --workspaces --if-present（exit 0，TS5042 = 0）、
  desktop 双引号 glob 全量（# tests 628 / 627 pass / 1 fail）、
  desktop 单引号 glob（# tests 0，STATUS=0 —— 假绿复现）、
  spawnSync(shell:true) 探针 ×4（双引号 628 / 单引号 0 / 单文件 1 / stdout 204,614 字节）、
  mobile eslint --max-warnings 99999（432 problems = 27 errors + 405 warnings）、
  desktop eslint（35 problems = 11 errors）、core eslint（115 problems = 8 errors）、
  core test:fast tool-runner-path-policy.test.ts（16/16 pass）
---

## 摘要

组 A 三条（A3 desktop 收集器假绿、A5 CI typecheck 转 blocking、A6 A-14 占位清账 + search filter 早退）
的**病症从代码重推导全部成立，行号逐处命中**，无一条 fabrication。
但三处 must-fix 集中在「验收断言的可执行性与口径」上：
A3 的零收集守卫在 `stdio:"pipe"` 下有 **maxBuffer 截断**风险未列（实测 stdout 204KB，Node 默认上限 1MB，当前安全但无量级护栏）、
且守卫对「显式传一个存在的文件但该文件 0 条用例」不区分（可接受）；
A5 有一条**修法与实测证据冲突**——§A5.6 断言「CI `Build workspaces` 步必须仍绿」，
而本机实跑该步 exit 0、无 TS5042，baseline §1.1 记的「根 `npm run build` exit 1」只在**额外位置参数**下复现，两者不是同一条命令，spec 未区分；
A6 存在**两处数字口径错误**（快照 14 份实测 13 份、allowlist 测试「5 个」实测 4 个）与**一处边界不可判**（验收①期望「零行代码改动」但 Step 5 要删 `resourceQuota` 行，同文件同时出现「零改动」与「删行」两条互斥期望 ⇒ 命中 RULE 牙齿判据③「一夹具两期望」）。

## 逐条 verdict

| # | 条目 | 病症（代码重推导） | 行号核对 | 修法可行/完备 | 验收可测（牙齿三判据） | 测试策略/回归线 | 依赖闭合 | verdict |
|---|---|---|---|---|---|---|---|---|
| A3 | N-P0-02 desktop 收集 0 条假绿 | **成立**。`run-tests.mjs:30` 单引号 + `:34` `shell:true`；实跑单引号 ⇒ `# tests 0` / STATUS=0 | **逐字命中**：`:22` extraArgs、`:23-26` 注释、`:27-30` testTargets、`:32-35` execSync、`:34` shell:true。全文 40 行无误 | **可行**。Step 1 改双引号经实跑验证：spawnSync(shell:true) + 双引号 ⇒ **628 tests**，与 baseline §3.2(b) 完全一致 | **有牙**。实测单引号路径 `MATCH="0"` ⇒ 守卫必红（`collected==="0"`）；显式单文件 `MATCH="1"` 不被误伤。**但见 MF-1** | 不新增单测（策略正确，理由引用 RULE 判据②成立）；回归线 4 条真实存在且我实测 desktop/core/mobile 三套命令均真跑 | 前置无；与 A5 同 PR 已写明；wave-e H6 边界已在 wave-e:1629 对齐 | **PASS-with-MF**（MF-1、MF-2） |
| A5 | CI typecheck 转 blocking | **成立**。`ci.yml:62` `continue-on-error: true` 逐字命中；`:58` Lint 同款；`:6-7` 头部注释仍在说 typecheck 放行 | **逐字命中**：`:53-66` 引用块、`:58`、`:62`、`:6-7` 全部准确 | **可行且实测支撑**。`npm run typecheck --workspaces --if-present` **exit 0**，16 个 workspace 全跑完（我逐条数了 14 个包 + mobile 3 段 + e2e:tsc）⇒ 「既存错误所以放行」对 Typecheck 已不成立 | **有牙**。验收②的 YAML 形状检查我实跑，当前输出 `Lint | true` / `Typecheck | true`；改后必须变 false。验收③注入类型错误有牙。**但验收②的正则在多行 `node -e` 下有 PowerShell/cmd 转义坑（MF-4）** | 不新增单测（改 YAML，策略正确）；回归线 4 条存在 | 下游 wave-e X1/X2 依赖已写明并与 wave-e:487-488 逐字对齐 | **PASS-with-MF**（MF-3、MF-4） |
| A6 | A-14 闸门 intentional + resourceQuota 清账 + search filter 早退 | **成立**。三处 `allowedPaths: undefined` 实锤（`run-agent-turn.ts:993`/`:1351`、`create-user-vfs-turn-service.ts:83`）；policy 恒 `undefined` ⇒ `findDisallowedPath:85-87` 首行 return null | **逐字命中**（且比台账/raw 更准，spec 已自纠 raw 报告的 `:926`/`:1276`/`:78`）。`resourceQuota` grep 实测 4 处（spec 表列 6 处含类型定义与 index 导出，大小写敏感 `resourceQuota` 只 4 命中、加上 `ToolResourceQuota` 才 6 —— spec 的表述成立）；search `:208` options 只带 maxResults ✓、`:145-161` inputSchema 三字段 ✓、`types.ts:177-179` 早退 ✓ | **可行**。Step 1-3 纯注释、Step 4-7 纯删除，实测 grep 零测试引用、13 份快照零命中 ⇒ 不动快照。**但验收①的期望自相矛盾（MF-5）** | **③ 一夹具两期望 —— 命中**（MF-5）。①有牙（git diff 逐行）、②不恒红（`tool-runner-path-policy.test.ts` 实跑 16/16 绿） | 不新增测试（策略正确）；回归线 8 条我逐个 Test-Path 全部存在 | 拍板项「无」经核 `ledger-v2.md:317-337` 的 17 项清单确无 A-14/resourceQuota ✓ | **PASS-with-MF**（MF-5、MF-6、MF-7） |

计数：**PASS-with-MF 3 / FAIL 0**（无 outright fail；三条都必须先闭合 MF 才能 execute-ready）。

## 与 baseline 的口径一致性核对

| 核对点 | spec 口径 | baseline 口径 | 我的实测 | 一致？ |
|---|---|---|---|---|
| desktop 带参收集条数 | A3.3①「与 baseline.md 的 desktop 条数一致」，不写死数字 | §3.2(b) 628 tests / 126 suites | **628 tests / 126 suites / 627 pass / 1 fail** | ✅ 一致，且 spec 的验收命令**实测能收集到 628 而非 0** |
| desktop 默认路径假绿 | A3.3①「反面：修好前输出 `# tests 0`」 | §3.2(a) `# tests 0` / exit 0 | 单引号实跑 `# tests 0`，`spawnSync` STATUS=0 / `MATCH="0"` | ✅ 一致，**且守卫牙齿经实跑验证有牙** |
| desktop 已知红 | A3.5 回归线只写「全量保持绿」 | §3.2(c) 1 fail = `cr-05` 满负载 flake，隔离 4/4 绿 | 隔离跑同一条仍红（满负载），628 分母复现 | ⚠️ **口径缺口（MF-2）**：A3.5 没写「这 1 条是已知红」，字面要求「全量绿」会与 baseline 冲突 |
| mobile lint 差距 | §A5.3 表：321 vs **405 warnings（+84）** + **27 errors**；`package.json:11` 失效 | §2.2：**432 problems（27 errors + 405 warnings）**，阈 321 | **`✖ 432 problems (27 errors, 405 warnings)`** | ✅ **完全一致**（数字、拆分、阈值三处全对）。`package.json` 第 11 行确为 `"lint": "eslint . --max-warnings 321"` |
| CI Build workspaces 步 | §A5.6「`Build workspaces` 步必须仍绿 —— typecheck 依赖 dist」 | §1.1：根 `npm run build` **exit 1**，14 个包 TS5042 | **`npm run build --workspaces --if-present` 实跑 exit 0、TS5042 = 0**；TS5042 只在 `npm run build <额外位置参数>` 时复现（我复现成功，exit 1） | ❌ **MF-3（口径冲突）**：baseline 与 spec 谈的都不是 CI 实际跑的那条命令 |
| renderer 411 | A5.2「明确不做」引用 wave-e 实测 411 | §2.1 台账 424 已漂移、实测 411 | 未复跑（成本高），采信 baseline | ✅ 一致（spec 未预写数字，正确） |
| 快照份数 | A6.1(b)/A6.5「14 份快照」「5 个 allowlist 测试」 | — | **13 份 `.json` 快照、4 个 `.test.ts`** | ❌ **MF-6（数字错）** |

## must-fix 清单（doc-fix 照抄级）

| ID | 位置 | 问题 | 必须改成 |
|---|---|---|---|
| **MF-1** | A3.2 Step 2 / A3.7 风险表 | 守卫用 `spawnSync` + `stdio:["inherit","pipe","inherit"]` + `encoding:"utf8"`，但 **spawnSync 默认 `maxBuffer` = 1 MiB，超出即 `status=null` + 静默截断**。实测当前 628 条 stdout = **204,614 字节**（安全，余量 5×），但 spec 未提这个已知悬崖：一旦套件增长或某次跑出巨量 stdout，守卫会因「`# tests` 行被截断」而误判成零收集，**报出误导性的错误信息**。A3.7 风险表只列了 banner 污染与体感变差，漏了这条 | Step 2 代码块加 `maxBuffer: 64 * 1024 * 1024`（并在注释里写明「不设则默认 1 MiB 会静默截断，守卫误判」）；A3.7 风险表补一行：`stdout 超 maxBuffer ⇒ status=null 且守卫误判零收集` → 缓解 = 显式设大 maxBuffer + 错误信息里带上 `result.error?.code` |
| **MF-2** | A3.5 回归线第 1 条 | 字面写「`apps/desktop` 全量 `npm test`」为「必须保持绿」，但 baseline §3.2(c) 实测该命令**本身就是 627/628、1 fail**（`cr-05` 满负载 flake，隔离 4/4 绿）。照字面验收会让人以为本条引入了回归 | 改为「`apps/desktop` 全量 `npm test`：**628 tests / 627 pass / 1 fail 为已知红基线**（`cr-05` 满负载 flake，隔离复跑 4/4 绿，见 baseline §3.2(c)/F4）；**红条目数与位置不得增加**」。同条补一句 `packages/core`（3126/3 fail）与 `apps/mobile`（1739/1 fail）也按 baseline §4 的「不得增加」口径 |
| **MF-3** | A5.6 回归线第 2 条 | 「CI 的 `Build workspaces` 步必须仍绿 —— typecheck 依赖 `dist/`」。**实测 `npm run build --workspaces --if-present`（= ci.yml:51 的逐字命令）exit 0、零 TS5042**；baseline §1.1 记的「根 `npm run build` exit 1 / 14 个 TS5042」只在**额外位置参数**形态下复现（`npm run build cloud-sync-driver-s3` → TS5042，exit 1，我已复现）。两条不是同一条命令，spec 直接引用 baseline 的红灯数会让实施者以为 CI Build 步本来就红、进而误判 A5 的 typecheck 转 blocking 不可行 | 改写为：「CI `Build workspaces`（`ci.yml:51` 的 `npm run build --workspaces --if-present`）本机实跑 **exit 0、零 TS5042**，是绿的前置；⚠️ baseline §1.1 记的 TS5042 只在 `npm run build <额外位置参数>` 形态复现（`npm run build <pkg名>` 即触发），**不是 CI 跑的那条命令** —— 该差异须回写 baseline，避免后续 wave 误引」。另补：typecheck 对 dist 的依赖只体现在 `references` 解析（desktop/tsconfig.json 的 6 条 references），`mobile` 有 `pretypecheck` 自建、其余包是裸 `tsc --noEmit` 不读 dist ⇒ 「依赖 dist」这句应收窄为「desktop 的 project references 要求上游包先 build」 |
| **MF-4** | A5.4 验收② | 那条 `node -e` 是**跨 4 行的双引号 shell 串**且内含 `\|`、`\|`、`\Z`、`/` 等需 shell 转义的字符。RULE 明写「cmd 下多行 `node -e` 会被静默丢弃整条命令（无报错无输出）」。我在 cmd 下实跑该命令**确实失败**（`'Typecheck)[\s\S]*?' 不是内部或外部命令`），换 bash 才成功 → **照 spec 抄进 PowerShell 会静默空跑**，正是本条目要消灭的假绿同族 | 二选一并写进 spec：①（推荐）改成单行、去掉 `console.log` 的多参数形态：<br>`node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=s.match(/- name: (Lint|Typecheck)[\s\S]*?(?=\n      - name:|\n\S|\$)/g)||[];console.log(m.map(x=>x.split('\n')[0].trim()+' | coe='+/continue-on-error/.test(x)).join('\n'))"`<br>② 或明确标注「**必须写进 `.mjs` 文件再 `node <file>`**，禁止多行 `node -e`」，并把文件落点写死（如 `tmp/check-ci-coe.mjs`） |
| **MF-5** | A6.3 验收① | **命中 RULE 牙齿判据③「同一份夹具只服务一套期望吗」的互斥**。同一条 `git diff` 同时挂两条互斥期望：「前两个文件**只出现注释/空白以外的零行代码改动**」 vs 括注「**Step 5 删的是 `resourceQuota` 行**」。`run-agent-turn.ts` 与 `create-user-vfs-turn-service.ts` 正是 Step 5 要删行的两个文件 ⇒ 「零行代码改动」与「删 1 行」不可能同时成立，实施者必然二选一猜 | 拆成两条互不重叠的断言：<br>**①a 闸门装配点零改动**：`git diff -U0 -- <四个文件>` 过滤掉 `resourceQuota` 行后，`allowedPaths: undefined` / `checkToolPathPolicy(` / `toolPathForbidden(` **零命中**（用 `git diff` 输出 grep `^[+-].*allowedPaths\|^[+-].*checkToolPathPolicy` 期望空）；<br>**①b 删除面**：`git diff --stat` 期望恰为 4 文件、且 `run-agent-turn.ts` 净 -2 行（`:994`/`:1352`）、`create-user-vfs-turn-service.ts` 净 -1 行（`:84`）、`builtin-tool-context.ts` 净 -14 行（接口 12 + 字段 2 + JSDoc 归并）、`index.ts` 净 -1 行 |
| **MF-6** | A6.1(b) 末段 + A6.5 回归线倒数第 2 条 | 两处数字错：①「`packages/core/test/package-exports/snapshots/*.json` **14 份**快照」—— 实测 **13 份**（`main-entry-allowlist.json` + 12 个 `public-*-allowlist.json`）；② A6.5「（**5 个** allowlist 测试 + 快照 14 份）」—— 实测 **4 个** `.test.ts`（`duplicate-export-consistency` / `main-entry-allowlist` / `public-no-config-forms` / `public-subpath-allowlist`），第 5 个是 `helpers/export-snapshot.ts`（不是测试） | ①改「14 份」为「**13 份**（`main-entry-allowlist.json` + 12 份 `public-*-allowlist.json`），我逐份扫过、零份含 `ToolResourceQuota`/`BuiltinToolContext`」；②A6.5 改「（**4 个** allowlist 测试 + **13 份**快照）」。RULE「条数类结论一律实测复核」 |
| **MF-7** | A6.2.1 Step 1 注释③ / A6.1(a) | Step 1 注释里断言「`filePath` 在本仓无任何工具使用」——我实测 `git grep filePath -- packages/core/src` 命中 20+ 处，但**全部是局部变量名或 VFS 逻辑函数的形参**（`ensure-parent-dirs.ts` / `restore-mutating-paths-heads` / `workplace-rule-engine.ts`），**没有一处是 tool `inputSchema` 的字段**（`PATH_FIELDS` 里的 `"filePath"` 是唯一与工具相关的命中）。⇒ 结论成立但**证据表述会被实施者读成「grep 不到 filePath」而当场证伪** | 注释改为可自证的表述：「`filePath` 在 `PATH_FIELDS` 里但**无任何内置工具的 `inputSchema` 声明它**（`git grep filePath -- packages/core/src` 的命中全是 VFS 逻辑的局部变量/形参）」。同批把 ①`pathStartsWithPrefix` 不解 `..`、②`PATH_FIELDS` 漏 `glob.options.cwd`（`vfs-tools.ts:459`）与 `grep.options.pathPrefix`（`vfs-tools.ts:519`）也各补一条 file:line —— 这两条我已实测确认成立 |

## 结论

**组 A：No-Go（3 条全部 PASS-with-MF，须 doc-fix 闭合 7 条 must-fix 后复审）。**

一句话理由：病症与行号零 fabrication、三条修法方向都成立，但 **A6 验收①把「零代码改动」与「删 resourceQuota 行」挂在同一条 `git diff` 上互斥（牙齿判据③）**、
**A5 验收②的多行 `node -e` 在 Windows 上会静默空跑（本条目自己要去除的假绿同族）**、
**A3 回归线未标已知红会让人误判回归**——这三条任一未闭合都会让 execute 阶段产出「假绿验收」，与 Wave A 止血的本意相反。
