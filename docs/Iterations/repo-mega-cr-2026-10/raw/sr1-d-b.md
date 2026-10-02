---
zone: raw-sr1
agent: readonly reviewer（wave-d · 组 B）
files_scanned: fix-spec/wave-d.md（§0/§1/§3/§4/§7/§8）、fix-spec/baseline.md、fix-spec/SPEC.md、fix-spec/state.md、ledger-v2.md（§7 ★1★3、§10 Wave D）、synth/dead-backlog.md、synth/verify-dead.md、L0/dead-exports.md、docs/apm/RULE.md:70/74/112、packages/core/{tsconfig.json,tsconfig.test.json,package.json,test/package-exports/**}、apps/mobile/{jest.config.js,test-utils/core-shim.ts,package.json}、批次 2 九条目标源文件与连带测试
baseline: feat/repo-mega-cr @ fe79b7810c0c78c48a18c76486359d7d45e253fa（只读复核，未跑 tsc/测试，未跑任何构建）
---

# sr1-d-b · wave-d 组 B 审查（批次 2 九条 + rebuild core 前置 + 批次 3 规程）

## 0 · 摘要

批次 2 的九条**行号与「零消费」判断整体可靠**：九个目标文件行数逐个实测吻合（38/48/40/47/16/4/13/15/18 = 239），六处 `jest.mock` 行号 6/6 全对，D-202 的三个 `it` 行段区间与两处负向断言行号精确，D-203/D-204/D-205/D-206 的唯一引用者全部核实，D-208 的子路径契约链核实无误。

但有**一处 No-Go（D-207）**：它的修法删掉 `packages/core/tsconfig.test.json:26` 的 `@novel-master/core/kkv` 映射，却**漏掉了唯一消费这条映射的测试** `packages/core/test/package-exports-t0.test.ts:4`，同时又**明文禁止**改成指向 `src/public/kkv.ts`。按 RULE:74，删掉映射后 tsx 会回退 node 解析、经 `node_modules` 自链去加载 `dist/public/kkv.js` 旧产物——这正是该条规则明载的坑，也是本批次最贵的编译/静默跑旧码风险。

批次 3 的规程**结构上是合格的**（不逐条写七要素的判断正确、清单来源分级准确、八步流程与验收门齐全、★1/★3 前置门齐备），但**第 2 步的命中检查写成了一个不可执行的规则**（「命中数 > 0 ⇒ 出批」，而定义处必然命中 ⇒ 348 条会全数出批），且 §4.4 的合计口径「348 + 15」与本节标题「348 + 17」、`ledger-v2.md` §10、`SPEC.md` §2「348+17」三处冲突。

验收线一节（§1）整体**过期**：`baseline.md` 已落盘（23 KB 实跑），spec 仍写「撰写时尚未落盘」，并把 desktop renderer 的已知红分母硬编码为 **424**，而实测基线是 **411**。

---

## 1 · 批次 2 九条逐条 verdict

判定口径：**Go** = 七要素齐、行号在位、零消费可复现、验收可测；**Go-with-fix** = 主体成立但有必须先补的证据/连带缺口；**No-Go** = 按现文施工会破或会静默跑旧码。

| ID | 行号核对 | 零消费 grep 复核（实测） | 连带面 | 验收可测 | 回归线实存 | verdict |
|---|---|---|---|---|---|---|
| **D-201** `session-messages-loader.ts`（38 行） | 文件 38 行 ✓；6 处 `jest.mock` 行号 **6/6 全对**（`:157/:209/:231/:37/:23/:32`）✓；`:421` 注释在位 ✓ | `git grep -rln session-messages-loader` → 恰好那 6 个测试文件，`src` 侧零 importer ✓。⚠ 实测 grep 输出**不含**源文件自身（源文件不出现自己的文件名），spec 写「上列 6 个测试文件 + 本文件」措辞不准（无害） | 摘 6 处 mock + 删 38 行源。**漏点**：`:466` 还有一条含 `session-messages-loader` 的注释（「单元消息面：listBySessionTail…而非 session-messages-loader」），修法只点了 `:421` | 验收①「grep 归零」按现修法**不可达**（`:466` 未被覆盖） | 6 个测试文件实存 ✓ | **Go-with-fix** |
| **D-202** `sanitize-annotate-preview-html.ts`（48 行） | 源 `:24` ✓；import `:26` ✓；正向使用 `:67/:90/:136` ✓；`sanitizePath` 常量 `:43-49` ✓；三个 `it` 行段 `:63-72`、`:74-109`、`:119-150` ✓；保留的 `:111-117` ✓ | 生产零消费 ✓（`git grep -rn sanitizeAnnotatePreviewHtml` 只有源文件 + 两个测试）；`preview-recogito-md.test.ts:76` 是 `doesNotMatch` 负向断言、删源后自动仍绿 ✓ | 改 1 个测试、另一个测试**一字不动** ✓（§7 修正 #9 的口径正确） | ①②③④⑤ 可测；⚠ ③ 的「已知红 ≤424」须改 **411** | 两个测试文件实存，T-SA8 段在 `:153+` ✓ | **Go** |
| **D-203** mobile `flush-run-ui.ts`（40 行） | `:17` `export async function flushRunUi(` ✓ | mobile 侧唯一引用 `apps/mobile/__tests__/flush-run-ui.test.ts:1` ✓；desktop 半边活（`conversation-abort-retain.ts:7` import + `:88` 调用）✓；`session-stream-unit.ts:37/487/774` 只是注释提及、非 import ✓ | 删源 + 删 mobile 测试（3 个 `it` ✓）；desktop 半边不动 ✓ | 可测 | desktop `flush-run-ui.test.ts` 实存 ✓ | **Go** |
| **D-204** mobile `tool-turn-actions.ts`（47 行） | `:10` ✓、`:34` ✓ | mobile 侧唯一引用 `__tests__/tool-turn-actions.test.ts` ✓；desktop 半边独立同形文件 ✓ | 删源 + 删测试；§7 修正 #10「5 个 `it`」实测**正确**（`:65/:73/:80/:88/:96`）✓ | 可测；「D-301 前提此时才成立」的挂接正确（D-105+D-204 双端归零） | mobile 转录工具轮用例在位 | **Go** |
| **D-205** `stream-tail-html-state.ts`（16 行） | `:5` ✓ | 全仓唯一引用 `__tests__/stream-tail-html-state.test.ts:1` ✓（3 个 `it`） | 删源 + 删测试；`runtime/stream/stream.ts` 内联重写为真源 ✓（AM-14 表第 4 行口径） | 可测；「测试测的是没人跑的那份」成立 | stream-tail 相关用例在位 | **Go** |
| **D-206** `apps/mobile/src/vfs/errors.ts`（4 行） | `:4` ✓ | 唯一消费 `apps/mobile/__tests__/errors.test.ts:3`（import 的是 `formatVfsError`）；`formatError` 的其余 10 个消费方全走 `@/errors/format-error` 本体 ✓ | 删源 + 删测试（5 个 `it`） | 可测。⚠ 「依赖：前置 rebuild core」对一条 4 行 shim **过度声明**（本文件不入 bundle、不吃 dist），建议降级为「随批次统一验收」，否则单条不可独立执行 | `format-error` 本体用例在位 ✓ | **Go** |
| **D-207** `service/kkv/index.ts`（13 行）+ `tsconfig.test.json:26` | `index.ts:10` ✓；`tsconfig.test.json:26` 映射行**逐字命中** ✓；`package.json:81-84` 的 `./kkv` → `dist/public/kkv.js` ✓；`src/public/kkv.ts:11-14` 直转实现 ✓ | 「唯一引用者是那一行 paths」**不成立**：`packages/core/test/package-exports-t0.test.ts:4` `import { createKkvService, KkvError } from "@novel-master/core/kkv"` 也吃这条映射（spec 全篇未提这个文件） | **缺一环**：删映射后该 import 无 paths 落点 → tsx 回退 node 解析 → 吃 `dist/public/kkv.js` 旧产物（RULE:74 明载：storage-cache-dedup 迭代踩过同坑，症状诡异）。spec 又明文禁止改成 `./src/public/kkv.ts` ⇒ 现文无出路 | 验收①②可测，但**③在真跑时会以「静默跑旧码」形式通过**，抓不到 | `package-exports-t0.test.ts` 实存（`test/package-exports/` 下 13 份快照确认在 `snapshots/` 子目录）。另：验收③括注「`KkvService`/`KkvErrorCode` 在 A 类」不准——快照里是 `main-entry-allowlist.json:20 KkvError` / `:66 isKkvError`，且主入口 `src/index.ts:153-154` 直接从 `errors/kkv-errors.js` 转出、不经本 barrel ⇒ 删 barrel 不影响主入口 | **No-Go** |
| **D-208** `service/session-run-state/index.ts`（15 行） | `index.ts:7` ✓；`public/session-run-state.ts:10` 直引实现 ✓ | `git grep -rn session-run-state` 全量核对：实现文件 / `public/` / 两个 core 测试 / `project.service.ts:45` / `session.service.ts:44` **零处经 barrel** ✓ | 无连带（不改 tsconfig.test.json 的 `:28` public 映射 ✓、不改 package.json ✓） | 五项验收全可测 | 两个 core 测试直引实现文件 ✓；mobile 侧走 `@novel-master/core/session-run-state`（jest.config.js:134-137 → `dist/public/…`）✓ | **Go** |
| **D-209** `types/agnai-tokenizers.d.ts`（18 行） | 文件 18 行 ✓；`tsconfig.json:12` `include:["src/**/*"]` ✓ | 全仓 `@agnai` 命中清单**与 spec 列的 9 处完全一致**（core 本文件 / tokenizer-driver-node 副本 / node 的 package.json+README+src / rn 的 kt+src / metro.config.js）✓；`packages/core/**` 零 `@agnai/*` import ✓；node 的副本与 core 这份**逐字相同**（19 行内 2 个 `declare module`）✓ | 无 | 六项验收可测，`tsc -p packages/core` 是有效硬门 | `test/infra/tokenizer/**` 与两个 driver 包在位 ✓ | **Go-with-fix**（见 §4 M-3：证据描述有误） |

**统计：Go 6 / Go-with-fix 2（D-201、D-209）/ No-Go 1（D-207）。**

补充实测（不在 spec 内、但影响本组判断）：
- 批次 2 行数对账自洽：九文件实测 239 = apps 193（38+48+40+47+16+4）+ core 46（13+15+18）；spec 的「标称 248 = 239 + 9 个文件各 +1」换算无误 ✓。
- 13 份快照文件确认位于 `packages/core/test/package-exports/snapshots/` ✓（spec §1.3/§4.3 的路径正确）。去重名字实测 **553** 个，spec 写 551，差 2（低危，仅描述性数字）。

---

## 2 · 批次 3 规程评估

### 2.1 结论

**规程方向正确、可保留；但当前版本不可直接执行**——八步流程的第 2 步是一个逻辑上不可满足的规则，且合计口径与上游三处冲突。批次 3 本身仍是 `blocked-by-decision(★1/★3)`，所以「规程不可执行」不影响开工前置判定，但必须在解锁前先补牙。

### 2.2 做对的地方

1. **不逐条写七要素的取舍正确**。348 条逐条展开等于把 spec 写成 `L0/dead-exports.md` 的复制品；spec 改写「机械流程 + 抽检 + 三组新目标逐条」是对的形态。
2. **清单来源分级准确**。`L0/dead-exports.md` 标「只作线索源、不作判定源」，并引 F-synth-dead-1 的 `testOnly` 桶缺陷——我在 `dead-backlog.md:87-98` 复核到原文是「core 356 行全量复核，127 行（35.7%）实际有生产消费方，127/127 全是 barrel 转发路径」，**引用准确**。L0 自身的 1317/26/580 三个数字也与 `L0/dead-exports.md` 摘要表一致 ✓。
3. **机读源缺失的兜底写对了**。实测 `tmp/w3c/` 与 `tmp/l0census/` 在本 worktree **都不存在**（被 `.gitignore` 覆盖），spec 明确「缺失时不得因此跳过条目，改按附录 A 施工」✓。我也抽查了附录 A 的可执行性：A.2/A.3/A.4 三表均含「文件 + 符号 + 动作」三列，足以驱动 §4.3 的八步。
4. **★1/★3 前置门与硬门槛引用准确**。`ledger-v2.md:321` 的 ★1 原文就是「解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`（W5–W11 均未执行过）」，`ledger-v2.md:323` 的 ★3 原文就是「必须用户确认共享形态不是为分端裁剪的产物」，spec §4.2 两处均为**逐字级准确引用** ✓。
5. **构造性前提（13 份快照必须全绿）独立于拍板项写成硬门** ✓，这是对的——快照红是客观事实，不需要用户拍。

### 2.3 规程的牙缺口（按严重度）

| # | 缺口 | 实证 | 后果 |
|---|---|---|---|
| **G-1** | **§4.3 第 2 步「命中数 > 0 ⇒ 该条出批」不可执行** | 该步的检查是 `git grep -rn -w -e "<符号>"`。任何符号在**自己的定义行**必然命中。 | 348 条**全部**会在命中检查处出批，规程原地自锁。必须改写为「命中数 **减去定义处命中数** 后 > 0 ⇒ 出批」，并给出定义处的判定口径（定义文件内该符号的声明行）。 |
| **G-2** | **§4.3 第 2 步与 §4.5 抽检口径互相矛盾** | §4.3 说「命中 > 0 即出批」；§4.5 说「命中**消费方**或快照 ⇒ 整批停止」。 | 两条规则给出不同的出批判据，执行者不知道听谁的。须统一为「定义处以外的命中 = 消费方」。 |
| **G-3** | **§4.4 合计口径三处冲突** | §4 标题写「348 + **17** 符号级」；§4.4 表合计写「**348 + 15**」；`ledger-v2.md` §10 Wave D 写「3.1 core 符号级 348 条；3.2 级联 **17 条**」；`SPEC.md` §2 写「批次 3（348+**17** 符号…）」。 | 行数对账与批次边界不可信。裁定：**合计 = 348 + 17**。 |
| **G-4** | **B3-d 的 ID 范围标错** | 死通道 3.2 是 D-301~D-317 共 17 条；D-301 已移入 §5.3、D-303 已移入 §5.4，余 15 条 = **D-302 / D-304 + D-305~D-317**。spec 写「D-305~D-317 剩 15 条」——该 ID 范围只有 13 条。 | 施工时按 ID 范围取批会漏掉 D-302/D-304（两条 ★4 通道）。 |
| **G-5** | **B3-d 一行没有逐条 blocked 标记** | 15 条里：D-302/D-304 = `blocked-by-decision(★4)`；D-311/D-314 = `blocked-by-decision(★2)`；D-316 = `blocked-by-decision(★3)`；D-315 = 快照门槛（`main-entry-allowlist.json` 锁定）。**★2 根本没出现在 §4.2 的门表里**，只在 §8 汇总表出现。 | 只读 §4 的施工者会以为 D-311/D-314 可直接删（D-311 的 spec 明写「预留」，删它违背文档约定）。 |
| **G-6** | **抽检断言无法落地** | §4.5 让人「人工跑第 4.3 节的第 2、3 步」——第 2 步正是失效的 G-1；且「结论」栏没有判定阈值（命中几条算零消费？定义处几条算不算？）。 | 抽检形式化，落不了地。须写死判据：「定义处以外的命中数 = 0 **且** 13 份快照 0 命中」。 |
| **G-7**（低危） | §4.3 第 3 步的快照检查命令 `grep "<符号>" packages/core/test/package-exports/snapshots/*.json` | 路径正确（实测 `snapshots/` 子目录存在、13 份 JSON 在位），但 Windows cmd 下裸 `grep` 不做 glob 展开。 | 施工时命令需改成 git-bash 形态或逐文件跑。 |

### 2.4 关于「348 + 17 不逐条写」这一判断的独立评价

同意。理由补一条 spec 没写的：**A 类 173 条的处置本身待 ★1 拍板**，若拍板结果是把 A-type 99 条也放进批次 3，清单会从 348 涨到 447，逐条化的 spec 立刻作废。规程形态对拍板结果免疫，这是它相对逐条化的结构性优势。

---

## 3 · rebuild core 前置的表述核验

### 3.1 引用准确性 —— 准确

- spec §3 开头引「`verify-dead` §3 补记 + §5 #8：撰写时 `dist` 是 2026-10-01 02:34 的旧产物」。我在 `synth/verify-dead.md:108`（§3 补记，原文含「`packages/core/dist` 在本工作树是存在的（2026-10-01 02:34 构建产物）…在 rebuild 之前跑 mobile 测试得到的任何失败都不可信」）与 `:135`（§5 争议 #8）两处均核实到该表述，**引用准确** ✓。
- 「mobile jest 30+ 条 `moduleNameMapper` 直连 `dist/**`」的数量口径成立：实测 `apps/mobile/jest.config.js` 中 core 子路径直连 dist 的映射 27 条，加上各 driver 包共 38 条，>30 成立 ✓。`test-utils/core-shim.ts` 实测 97 行、其中 36 行含 `dist/`，spec 写「13-97 行再导出 59 个名字」，行段成立 ✓。

### 3.2 行号引用 —— 不准确（低危但需订正）

spec 三处（§1.3 规则 2、§3 开头、D-207 回归线）都写 `apps/mobile/jest.config.js:37,45,47,48,58`。实测这五行是 **mock shim 映射**（`:37` reanimated-mock、`:45` notifee-mock、`:47` blob-util-mock、`:48` op-sqlite-mock、`:58` core-shim），**没有一行直连 dist**。真正直连 dist 的第一条在 `:59`（`^@novel-master/core/chat$`）。结论（mobile 吃 dist）没错，但锚点指错了五行。

### 3.3 表述本身的缺口 —— 需 must-fix

1. **前置没有绑定命令形态**。实测 `apps/mobile/package.json` 的 `pretest` 已经是
   `npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3 -w @novel-master/llm-sse-native && npm run build:webview`。
   ⇒ 走 `npm test -w apps/mobile` 时 **rebuild 自动发生**，硬前置是冗余的；只有走裸 `npx jest` 才必须手工 rebuild。spec 应写明「前置绑定哪条命令」，否则两条都写等于没写。
2. **§1.2 给的 mobile 命令本身有语法错**：`npx jest --maxWorkers=2 -w apps/mobile`。Jest 的 `-w` 就是 `--maxWorkers` 的短参，后面跟 `apps/mobile` 会把并发数设成非法值。`baseline.md` 的可用口径是 `cd apps/mobile && npm test -- --maxWorkers=2`。
3. **漏收 baseline 的构建前置**：根 `npm run build` 在 npm 10.9.4 下会把参数转发给各 workspace 的 `tsc -p`，14 个包报 `TS5042`，且 desktop 的 `preload.cjs` 静默无产出 ⇒ desktop `smoke.test.js` 假红。验收前必须走「逐包 `npm run build -w` + `build:webview` + `build:preload`」。这一条直接影响批次 2 的 desktop 验收（D-202），spec 未收。

### 3.4 附带发现：RULE:74 恰恰是 D-207 漏项的根因

RULE 明载两条最直接的依据，spec 都没引：

- **RULE:70**「改 dist 消费的包必须重建 dist」——支撑 rebuild 前置 ✓；
- **RULE:74**「给 `@novel-master/core` 新增 exports 子路径必须同步 `packages/core/tsconfig.test.json` 的 paths：**paths 缺映射时 tsx 回退 node 解析，经 node_modules 自链加载 `dist/` 旧产物**——同一测试进程 src/dist 双份代码并存，测试静默跑旧码且症状诡异（storage-cache-dedup 迭代实锤）」。

D-207 的修法（删掉 `tsconfig.test.json:26` 且禁止改指 public）**正是 RULE:74 描述的那个坑**，而它的唯一受害测试 `package-exports-t0.test.ts:4` 就是 spec 漏掉的那一处。spec 引了 verify-dead 却没引 RULE 的直接规则，是本组最实质的证据链缺口。

---

## 4 · 验收线的 baseline.md 引用形态

| # | 形态问题 | 实测 |
|---|---|---|
| **B-1** | **§1 写「撰写时尚未落盘」，事实已过期** | `fix-spec/baseline.md` 已落盘，23 094 字节，`HEAD = fe79b781`，实跑日期 2026-10-01。§8 汇总表的「撰写时该文件尚未产出」同样过期。 |
| **B-2** | **renderer 已知红分母硬编码 424（4 处），实为 411** | `baseline.md` §2.1/§4 明写「台账 424 → 实测 **411**，漂移 −13」，并给出桶级分解（test 190 / features 160 / src/main 42 / renderer 18 / core 1）。spec §1.1、§1.3 规则 1、D-202 验收 ③ 等处的「≤424 ⇒ 无新增」判据**会误判**：真跑出 411~424 之间都被当成「无新增」，实际基线是 411。 |
| **B-3** | **三包测试分母一个都没落** | baseline 已给：core **3126 tests / 3 fail**（2 确定性 usage-stats + 1 每次不同的性能护栏）、desktop 带参 **628 / 627 / 1**（满负载 flake）、mobile **1739 / 1738 / 1**（mermaid 源码正则，确定性）。spec 只写「对照 baseline.md」，在 baseline 已存在的前提下这属于可测性缺口——验收人无从判「增量」。 |
| **B-4** | **desktop 带参命令没抄进 spec** | baseline §3.2(b) 给了可直接用的 `npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"`；spec 只写「须用 `baseline.md` 记录的等价双引号收集命令」。 |
| **B-5** | **没收「零收集守卫缺失」这条** | baseline §6 提醒 4：`收集数 = 0 ⇒ exit 1` 的闸至今未装。对 Wave D 尤其重要——批次 2 大幅删测试文件（D-203~D-206 连删 4 个 mobile 测试文件），**删多了会出现「收集数下降但没人发现」**。spec §1.2 只警告了假绿，没要求记录收集数。 |
| **B-6** | **mobile tsc 命令与 baseline 口径不一致** | spec 写 `npx tsc --noEmit -p apps/mobile/tsconfig.json`；baseline 跑的是 `npm run typecheck`（= `tsconfig.build.json` + `src/web/tsconfig.json` + `e2e/tsconfig.json` 三段）。前者覆盖面更窄，web 侧改动（如批次 3 的 webview 相关项）会漏检。 |

---

## 5 · 口径修正核验（撰写机位自报 6 处 + ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT）

| 修正 # | 自报内容 | 我的复核 | 判定 |
|---|---|---|---|
| **#4** | 「连带清 10 个悬空符号」→ 实测 **15 个**（11 值/函数 + 4 类型），且台账漏列 `selectVisibilityBatchEligibleIdsFromAnchor`（`chat.ts:102`） | `apps/desktop/shared/logic/chat.ts:102` 命中 ✓；另有 `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:18`、`apps/mobile/src/components/chat/transcript-selectable-role.ts:23` 两处 import，`packages/core/src/public/chat.ts:288` 转出。**补充约束 spec 未标**：该名字在 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json:142` 有快照锁 ⇒ 双端 `chat.ts` 转发行可摘，core 侧不可动。 | **成立**（需补标快照约束） |
| **#6** | `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` **不是直接死码**，是经 `anchored-menu-layout.ts:12` 再导出的死值；两处必须同删否则编译红 | 逐条实测：`constants.ts:21` 声明 ✓；`anchored-menu-layout.ts:12` 是 `export { … }` 块内该名的**唯一一行** ✓；同文件 import 块 `:20-30` **不含**它 ✓（函数体也不用）；RN 端口 `components/chat/anchored-menu-layout.ts:6` 是 `export *`，故无第三处引用 ✓；`LONG_PRESS_MOVE_TOLERANCE_PX` 的消费者确实只有 `menu-overlay-guards.ts:6/:10/:16` + 自己的测试 ✓。修法给的删除区间 `constants.ts:12-13`（JSDoc+声明）与 `:20-21` 逐行对齐 ✓。 | **准确**（本组最扎实的一条修正） |
| **#7** | `MENU_OPEN_GRACE_MS` 是活的、严禁跟着删；台账「语义被手写内联」只对谓词成立 | `menu.ts:1` `import {MENU_OPEN_GRACE_MS} from '@web/shared/constants'` ✓；`:199` `Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS` ✓；`chat-transcript-boot-script.test.ts:17/:93/:261` 三处断言 ✓；`constants.ts:10` 声明 ✓。 | **准确** |
| **#8** | `bind-shell-events.ts:4` 是直接出处；`RULE.md:11` 是同族旁证、不是直接决策记录 | `RULE.md:11` 实为「**小米/HyperOS 上批注划词菜单不可用（2026-09-28 四轮调查定案，用户拍板 hold 不适配）**」——确系 Android 划词菜单条目，与「webview 长按开菜单退役」不是同一条决策。§4.7 目标② 已按准确措辞写。 | **准确** |
| **#9** | D-202 连带测试实为 **2 个**文件、其中 **2 处负向断言须保留** | `preview-annotate-source-anchor.test.ts:114` 与 `preview-recogito-md.test.ts:76` 两处 `doesNotMatch` ✓；`:43-49` 的 `sanitizePath` 常量随之删 ✓。 | **准确** |
| **#10** | D-204 测试是 **5 个 `it`**（台账写 4） | 实测 5（`:65/:73/:80/:88/:96`）✓。 | **准确** |

**合计：6 处口径修正全部成立，ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT 那条尤其经得起复核。** 唯一需要在回写时补的是 #4 的快照约束。

---

## 6 · must-fix 清单

| ID | 级别 | 位置 | 问题 | 建议改法 | 归属 |
|---|---|---|---|---|---|
| **M-1** | **P0** | `wave-d.md` D-207 §3 修法/验收 | 删 `tsconfig.test.json:26` 却漏掉唯一消费方 `packages/core/test/package-exports-t0.test.ts:4`（`import { createKkvService, KkvError } from "@novel-master/core/kkv"`），且禁止改指 public ⇒ tsx 回退 node 解析吃 `dist` 旧产物（RULE:74 明载坑） | 二选一并写死：① 把 `:26` 的映射改指 `./src/public/kkv.ts`（该 barrel 已导出 `createKkvService` + `KkvError`，测试需求全覆盖），并同步登记到 §7 修正 #3 的 Wave E 交叉说明；② 保留 barrel、只从验收里撤下本条。**同时**把验收③的括注改成「快照里的是 `main-entry-allowlist.json:20 KkvError` / `:66 isKkvError`；主入口 `src/index.ts:153-154` 直转 `errors/kkv-errors.js`，删 barrel 不影响主入口」 | 本组 |
| **M-2** | **P0** | `wave-d.md` §4.3 第 2 步 | 「命中数 > 0 ⇒ 该条出批」不可执行（定义处必然命中 ⇒ 348 条全出批）；且与 §4.5 的「命中消费方」口径矛盾 | 改写为「**定义处以外的命中数 > 0 ⇒ 该条出批**」，并在规程里给出定义处的判定口径；§4.5 同步引用同一判据 | 本组 |
| **M-3** | **P1** | `wave-d.md` §4.4 表合计行 + B3-d 行 | 合计「348 + 15」与 §4 标题「348 + 17」、`ledger-v2.md` §10、`SPEC.md` §2 三处冲突；B3-d 标「D-305~D-317 剩 15 条」，而该 ID 范围只有 13 条 | 合计改 **348 + 17**；B3-d 改为「D-302 / D-304 + D-305~D-317 共 15 条」，并在该行加 blocked 标记（★4 ×2、★2 ×2、★3 ×1、★1 快照 ×1） | 本组 |
| **M-4** | **P1** | `wave-d.md` §1.1 / §1.3 / D-202 验收③ | renderer 已知红分母硬编码 **424**，`baseline.md` 实测 **411** ⇒ 判增量会误判 | 全部改为 411，并补 `baseline.md` 的桶级分解引用 | 本组 |
| **M-5** | **P1** | `wave-d.md` §1 开头 + §8 末行 | 「`baseline.md` 撰写时尚未落盘 / 尚未产出」已过期（文件已落盘，实跑 2026-10-01） | 改为「以 `baseline.md` §4 总表的实测分母为准」，并把 §1 的「判增量方法」升级为「直接引用 §4 总表的 9 行分母 + 4 个稳定锚点」 | 本组 |
| **M-6** | **P1** | `wave-d.md` §1.2 mobile 命令 | `npx jest --maxWorkers=2 -w apps/mobile` 语法错（jest 的 `-w` 就是 `--maxWorkers`） | 改为 `cd apps/mobile && npm test -- --maxWorkers=2`（baseline 实跑口径） | 本组 |
| **M-7** | **P1** | `wave-d.md` §4.5 抽检规则 | 抽检断言无法落地（复用失效的第 2 步，且无判定阈值） | 写死判据：「定义处以外命中数 = 0 **且** 13 份快照 0 命中」；记录表增列「定义处命中数」 | 本组 |
| **M-8** | **P1** | `wave-d.md` §3 开头 + §1.3 规则 2 + D-207 回归线 | `jest.config.js:37,45,47,48,58` 五行实为 mock shim 映射，非 dist 直连；dist 直连首条在 `:59` | 改为「`jest.config.js:59-221` 共 27 条 core 子路径 + 11 条 driver 子路径，`core-shim.ts:13-97`」 | 本组 |
| **M-9** | **P1** | `wave-d.md` D-201 修法第 3 步 | 验收①「grep 归零」不可达：`:466` 另有一条含本文件名的注释，修法只点了 `:421` | 修法补上 `:466`（或把验收①改成「src 侧归零 + 注释内不得再出现本文件名」） | 本组 |
| **M-10** | **P2** | `wave-d.md` §3 开头 / §1.3 规则 2 | 未引 RULE:70、**RULE:74** 两条最直接的规则依据（而 RULE:74 正是 M-1 的根因） | 补引两条 | 本组 |
| **M-11** | **P2** | `wave-d.md` D-209 证据 | 「唯一导出 `cleanText` + `declare module "@agnai/tokenizer"`」错误：该文件是 ambient `.d.ts`，**无任何 export**，声明的是 `@agnai/sentencepiece-js` 与 `@agnai/web-tokenizers` 两个模块 | 照实改写（修法与验收不受影响） | 本组 |
| **M-12** | **P2** | `wave-d.md` §3 开头 / §1.3 规则 2 | rebuild 前置未绑定命令形态：走 `npm test -w apps/mobile` 时 `pretest` 已自动重建 core，硬前置仅对裸 `npx jest` 成立 | 写明「前置绑定裸 `npx jest` 路径」；并补 baseline §6 提醒 1 的构建三件套（根 `npm run build` 会 TS5042 + preload 静默缺产） | 本组 |
| **M-13** | **P2** | `wave-d.md` §4.2 门表 | ★2（D-311/D-314）未进 §4.2 的门表，只在 §8 出现；D-315 的快照锁也未点名 | §4.2 门表补 ★2 行 + 「D-315 快照锁」行 | 本组 |
| **M-14** | **P2** | `wave-d.md` §1.3 / D-202 回归线 | 快照去重名字写 551，实测 553 | 改为 553（低危描述性数字） | 本组 |
| **M-15** | **P2** | `wave-d.md` D-206 依赖 | 4 行 shim 不吃 dist，「依赖：前置 rebuild core」过度声明 | 降级为「随批次统一验收」，允许单条独立执行 | 本组 |
| **M-16** | **P2** | `wave-d.md` §1.1 mobile 行 | mobile tsc 命令覆盖面窄于 baseline 口径（漏 `src/web` 与 `e2e`） | 改为 `npm run typecheck`（cwd=`apps/mobile`）或补注覆盖面差异 | 本组 |
| **M-17** | **P2** | `wave-d.md` §1.2 / §4.4 | 未要求记录「测试收集数」；批次 2 连删 4 个 mobile 测试文件，收集数下降无人把关（baseline §6 提醒 4：零收集守卫至今未装） | 验收表增「收集数」一列，与 baseline 分母比对 | 本组 |
| **M-18** | **P2** | `wave-d.md` §7 修正 #4 | 「15 个悬空符号」未标 `selectVisibilityBatchEligibleIdsFromAnchor` 在 `public-chat-allowlist.json:142` 有快照锁 | 补标：双端 `chat.ts` 转发行可摘、core `public/chat.ts:288` 不可动 | 组 C（回写时带上） |

---

## 7 · 结论

**组 B：No-Go。**

一句话理由：批次 2 的九条本身质量很高（行号与零消费判断九条里八条可复现、口径修正 6 处全成立），但 **D-207 的修法会撞上 RULE:74 明载的「paths 缺映射 → tsx 回退吃 dist 旧产物」坑**（漏改 `package-exports-t0.test.ts:4` 又禁止改指 public），叠加**批次 3 规程第 2 步「命中数 > 0 即出批」这条不可执行规则**与 **§4.4「348 + 15」对「348 + 17」的三处口径冲突**，再加**验收线把 renderer 已知红分母写成 424（实为 411）且宣称 baseline.md 未落盘**——这三类问题都会在施工当天直接变成错删或误判，属 must-fix 而非 polish。

修复路径是收敛的：M-1 改一行映射指向（或撤下本条）、M-2/M-3 改两处规程文字、M-4~M-6 把 §1 绑到已落盘的 `baseline.md` 实测分母与命令；M-7~M-18 为登记与措辞级。**批次 2 其余八条已具备 execute-ready 条件**，可在 M-1 闭合后单独放行，不必等批次 3 规程重写。

---

*本机位只读：零 git 写、零 `docs/apm/` 写、零生产/测试代码与 fix-spec 改动。未执行 tsc / 测试 / 构建（验收数字一律引 `baseline.md` 或注明未实跑）。唯一产物 = 本文件。*