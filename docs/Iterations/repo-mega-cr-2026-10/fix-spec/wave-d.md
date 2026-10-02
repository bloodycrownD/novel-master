# fix-spec · Wave D 死码删除分片

> 基线：`feat/repo-mega-cr` @ `fe79b781`。分片范围 = `ledger-v2.md` §10 Wave D 全部四格
> （批次 1 / 批次 2 / 批次 3 / 死通道 / ★4 三条 batch 通道）。
> 撰写纪律（PLAN 第四章第 8 条）：本文件所有 `file:line` 与引文均在撰写轮**重新打开 `fe79b781` 核对**，
> 不照抄 `dead-backlog.md` / `verify-dead.md` 的行号；凡与上游不一致处在 §7「口径修正回写」登记。
> 零 git 写、零 `docs/apm/` 写、零生产/测试代码改动——本文件是本机位唯一产物。

---

## 0 · 口径与本轮自核结论

### 0.1 本文件引用的上游产物

| 来源 | 用途 | 优先级 |
|---|---|---|
| `docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md` §2.9 / §7 ★1★2★3★4 / §10 | 波次归属、拍板项口径 | 最高（口径冲突以此为准） |
| `docs/Iterations/repo-mega-cr-2026-10/synth/dead-backlog.md` | 387 条可执行删除清单、批次切分、行数实测 | 高 |
| `docs/Iterations/repo-mega-cr-2026-10/synth/verify-dead.md` | W6 逐条复核（14 confirmed / 2 adjusted） | 高 |
| `docs/Iterations/repo-mega-cr-2026-10/synth/apps-desktop.md` S-D-05 | IPC 断链 11 条终裁（8 真死 / 1 口径 / 3 待拍板） | 高 |
| `docs/Iterations/repo-mega-cr-2026-10/synth/apps-mobile.md` AM-14 / AM-25 | webview-host 真源分叉、死文件副本 | 中 |
| `docs/Iterations/repo-mega-cr-2026-10/L0/dead-exports.md` | 1317 零消费桶（机器普查，**桶定义有缺陷**，修复步骤见 **§4.9 F-synth-dead-1**） | 只作**线索源**，不作判定源 |
| `docs/apm/RULE.md` | 决策感知：schema migration 退役节奏、WebView 三层产物链、「给 exports 加子路径须同步 tsconfig.test.json paths」、满负载假信号纪律 | 最高（决策依据） |

### 0.2 撰写轮亲核的 10 条事实（与上游的差异见 §7）

| # | 事实 | 亲核方式 |
|---|---|---|
| 1 | 批次 1 的 16 个目标文件**全部存在**，行数与 `verify-dead` 的 `wc -l` 口径逐个吻合（PowerShell 行数口径合计 2236，含 D-102 的 1047） | `Get-Content .Count` 逐文件 |
| 2 | 16 个文件的内容级 grep（`git grep -rln`）**零 importer**，唯一例外是 D-101 的自身 `:3` 注释 | 全仓 grep |
| 3 | `apps/cli/src/vfs/errors.ts` 的 4 个导出确在 `:4 :5 :7 :20`，台账原锚点 `:4,7,20` **漏 `:5 EXIT_RUNTIME`** | 读文件 |
| 4 | `isTaskToolUse` 全仓零引用（连测试都没有）；`resolveSubagentSessionId` 有且仅有 1 个测试文件引用（`subagent-meta-passthrough.test.ts:8`） | `-w` grep |
| 5 | `packages/core/src/service/kkv/index.ts` 的「引用者」是 `tsconfig.test.json:26` 的 paths 映射**与消费该映射的 `test/package-exports-t0.test.ts:4`**（修订：原写「唯一引用者是那一行 paths」不成立）；`package.json` 的 `./kkv` 指向 `dist/public/kkv.js`，且 `src/public/kkv.ts` **不经**该 barrel | 读 `tsconfig.test.json` + `package.json` exports + 全仓 `@novel-master/core/kkv` grep |
| 6 | `packages/core/src/service/session-run-state/index.ts` 全仓零 importer；`src/public/session-run-state.ts:10` **直引** `create-session-run-state-service.js`，不经该 barrel | grep + 读文件 |
| 7 | IPC 8 条真死通道的四处同步点在 `fe79b781` 的确切行号；`VFS_LIST` **没有** invoke-registry 封装（三处而非四处） | 逐通道 grep |
| 8 | 三条 ★4 通道的四处同步点齐全，但 renderer 封装零消费（只在 `client.ts` 再导出） | 逐通道 grep |
| 9 | `menu-overlay-guards.ts` 生产零消费；`LONG_PRESS_MOVE_TOLERANCE_PX` 随之成死，但 `MENU_OPEN_GRACE_MS` 与 `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` **仍活**（详见 §4 目标②） | grep + 读 `menu.ts:1/:199`、`anchored-menu-layout.ts:12` |
| 10 | `validate-prompt-blocks.ts` 的唯一消费者是它自己的测试；`PromptBlock`/`PromptBlockRole` 随之成死，**但 `prompt-block.ts:11 PromptBlockLifecycle` 被 `validate-agent-prompt-layout.ts:14` 与 `agent-prompt-layout.ts:7` 引用，必须保留** | grep + 读文件 |

---

## 1 · 验收线（四域 tsc + 三包测试，对照 `baseline.md` 已知红基线）

> **基线数字以 `fix-spec/baseline.md` 为准**（该文件已落盘，`HEAD = fe79b781`，实跑日期 2026-10-01）。
> 因此本节的判增量方式已从「只写方法」升级为**直接引用 `baseline.md` §4 总表的 9 行实测分母 + 4 个稳定锚点**
> （本文件不复写该表，避免两处数字漂移；取数时一律现读 §4 总表）。
> 下表只列**必须对齐的域**与**命令形态**。

### 1.1 每批跑完必跑的四域类型检查

| 域 | 命令 | 说明 |
|---|---|---|
| core | `npx tsc --noEmit -p packages/core/tsconfig.json` | 生产编译面 |
| core 测试面 | `npx tsc --noEmit -p packages/core/tsconfig.test.json` | **D-207 / D-209 / D-316 直接改这一份配置**，必须单独跑 |
| desktop main | `npx tsc --noEmit -p apps/desktop/tsconfig.json` | `include: ["src/main/**/*","shared/**/*"]` |
| desktop renderer | `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` | ⚠ **已知红 = `baseline.md` §2.1/§4 实测的 411 条**（桶级分解 test 190 / features 160 / src/main 42 / renderer 18 / core 1）。⚠ 台账 §10 沿用的 **424 是 W11 旧值**，已漂移 −13，**不得**再作为判据，见 §1.3 规则 1 |
| mobile | `npm run typecheck`（cwd=`apps/mobile`） | = `tsconfig.build.json` + `src/web/tsconfig.json` + `e2e/tsconfig.json` **三段**。⚠ 覆盖面比 `npx tsc --noEmit -p apps/mobile/tsconfig.json` **宽**（多 `src/web` 与 `e2e`）⇒ 以本命令 / `baseline.md` 口径为准，批次 3 的 webview 相关项才不会漏检 |

### 1.2 每批跑完必跑的三包测试

| 包 | 命令（**必须用仓库既有完整参数，不得简写**） | 本批须记录的**收集数**（对照 `baseline.md` §4） | 满负载纪律 |
|---|---|---|---|
| core | `npm test -w @novel-master/core` | **3126** tests / 3 fail（2 条确定性 usage-stats + 1 条每次不同的性能护栏） | 脚本是 `bash -O extglob -O globstar -c 'tsx … --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/**/!(performance).test.ts'`。**简写成 `npx tsx --test <file>` 会漏两个 flag 并漏掉嵌套目录**（RULE 明载：漏 globstar 时 92/396 个测试文件从未被执行） |
| desktop | `npm test -w apps/desktop` | **628 / 627 / 1**（带参收集口径；末位 1 是满负载 flake，非确定性失败） | ⚠ **N-P0-02 未修前该命令在 Windows 上收集 0 条测试并假绿**（`run-tests.mjs:30` 单引号 + `shell:true`）。Wave D 各批的验收**不得**依赖它，须用 `baseline.md` 记录的等价双引号收集命令，或等 Wave A 的 N-P0-02 落地 |
| mobile | `cd apps/mobile && npm test -- --maxWorkers=2`（`baseline.md` 实跑口径） | **1739 / 1738 / 1**（唯一红 = mermaid 源码正则，确定性） | RULE：满负载下 `metric-detail-sheet` / `stream-token-estimator` 会偶发假红，**降并发复跑**才作数 |

> ⚠ **为什么必须记录收集数**（`baseline.md` §6 提醒 4）：「收集数 = 0 ⇒ exit 1」的零收集守卫**至今未装**。
> 批次 2 会**连删 4 个 mobile 测试文件**（D-203 ~ D-206），若删过头，收集数下降但没有任何红灯提示 ⇒
> 每批必须把「本批收集数」写进下方 §1.3 规则 4 的记录行，与本表分母比对。
>
> ⚠ **mobile 命令写法**：Jest 的 `-w` 就是 `--maxWorkers` 的短参，`npx jest --maxWorkers=2 -w apps/mobile`
> 会把并发数设成非法值，**该写法已废止**，照抄即崩。

### 1.3 判增量规则（硬纪律）

1. **只对照 `baseline.md` 的已知红清单判增量，不对照零基线。** 尤其 `apps/desktop/tsconfig.renderer.json` 的
   **411 条错误是「已知红」**（`baseline.md` §2.1/§4 实测值，桶级 test 190 / features 160 / src/main 42 / renderer 18 / core 1；
   台账 §10 Wave D 验收线格写的 **424 是 W11 旧值，已漂移 −13**），
   Wave D 跑完若错误数 **≤411 ⇒ 无新增**；**>411 ⇒ 新增回归**，须逐条比对是哪几条新出现的。
   ⚠ **411 与 424 之间那一段会被旧判据误当成「无新增」**——这就是必须改用 411 的原因。
2. **mobile 测试必须在 `npm run build -w @novel-master/core` 之后跑（前置绑定「裸 `npx jest` 路径」）。**
   mobile jest 30+ 条 `moduleNameMapper` 直连 `packages/core/dist/**`（`apps/mobile/jest.config.js:59-221` 共 **27 条 core 子路径 + 11 条 driver 子路径**，
   dist 直连首条在 `:59`；`test-utils/core-shim.ts:13-97` 再导出 59 个名字）。
   ⚠ **前置只对裸 `npx jest` 成立**：走 `npm test -w apps/mobile` 时，`apps/mobile/package.json` 的 `pretest` 已是
   `npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3 -w @novel-master/llm-sse-native && npm run build:webview`
   ⇒ **rebuild 自动发生**，此时不必手工跑前置。两条都写等于没写，故按命令形态分别对待。
   ⚠ **构建前置的另一半**（`baseline.md` §6 提醒 1）：根 `npm run build` 在 npm 10.9.4 下会把参数转发给各 workspace 的 `tsc -p`，
   14 个包报 `TS5042`，且 desktop 的 `preload.cjs` 静默无产出 ⇒ desktop `smoke.test.js` 假红。
   ⇒ 验收前须走「逐包 `npm run build -w` + `build:webview` + `build:preload`」，**不得**用根 `npm run build` 兜底。
   **在 rebuild 之前跑出来的任何失败都不可归因**（`verify-dead` §5 #8 实锤 `dist` 是 2026-10-01 02:34 的旧产物）。
   **规则依据**：`docs/apm/RULE.md:70`「改 dist 消费的包必须重建 dist」（支撑本条前置）、
   `docs/apm/RULE.md:74`「给 `@novel-master/core` 新增 exports 子路径必须同步 `packages/core/tsconfig.test.json` 的 paths，
   **paths 缺映射时 tsx 回退 node 解析、经 node_modules 自链加载 `dist/` 旧产物**——同一测试进程 src/dist 双份代码并存，
   测试静默跑旧码且症状诡异（storage-cache-dedup 迭代实锤）」（**D-207 的直接约束，见 §3 的 D-207**）。
3. **core 快照测试是死码删除的硬门**：`packages/core/test/package-exports/snapshots/*.json`（13 份、**553 个去重名字**）由 `public-subpath-allowlist.test.ts:20-32` 用 `Object.keys(mod)` 逐字 `deepEqual`。**任何一批删除后这 13 份快照测试必须全绿**；红了说明删到了 A 类（快照锁定面），该条必须回退。
4. 每批记录一行：`批次号 | 四域 tsc 增量 | 三包测试增量 | 三包收集数（对照 §1.2 分母） | 快照测试 | 净减行数`，贴进提交信息。

---

## 2 · 批次 1 · 零连带（D-101 ~ D-116，16 条）

**开工前置**：无。
**性质**：全部零 importer、零配置引用、零快照面命中、零测试连带——**唯一例外是 D-116（按 B1-a 收窄后）**。
**行数对账**：标称 **2236 行**（16 文件全删口径，`wc -l` 逐个实测，合计与 `verify-dead` 一致）。
按台账 §10 的 **D-116 选 B1-a** 后，`subagent-tool-session-id.ts` 只删 `:29-35`（JSDoc + `isTaskToolUse`）7 行、
文件保留 31 行 ⇒ **本批实际净减 ≈2205 行**（= 2236 − 38 + 7）。
⚠ **净减口径须分两段对账**：2205 是「16 个目标文件本体」口径；**D-114 另连带删 `vfs-path-mapper.ts:187` 一行注释**（+1）
⇒ **合计净减 = 2206 行**。验收对账按 **2206** 走，标称值 2236 仅作口径备案。

---

### D-101｜`apps/desktop/scripts/fix-settings-utf8.mjs`（整文件，547 行）

- **严重度/簇**：P3 死码 / dead-backlog 批次 1 / apps-desktop（scripts）｜**本批第一条施工，风险等级最高**
- **病症**：一个未被任何 npm script / CI 引用的手工脚本，内容是「从固定 commit `d825173` 取回 `AgentEditorView.tsx` 与 `EventsConfigView.tsx` 的旧版本并整文件覆写工作区」。
  **实测跑一次是「破坏先于报错」**——先静默丢代码，再崩：
  - ① `fixEditorView()` 在 `:54` 先把 `AgentEditorView.tsx` 覆写盘。`d825173` 那份是 **471 行**，当前工作区是 **1381 行**
    ⇒ **净丢 910 行**，且**不产生任何报错**（`git diff --stat d825173 HEAD -- …/AgentEditorView.tsx` = `1852 +++++---`）。
  - ② 随后 `fixEventsEditor()` 在 `:63` 的 `readFileSync(eventsPath, "utf8")` 才抛 ENOENT——因为
    `EventsConfigView.tsx`（`:12` 的 `const eventsPath = join(root, "renderer/features/settings/EventsConfigView.tsx")`）
    **在当前树上根本不存在**（`git ls-files apps/desktop/renderer/features/settings/` 的 24 个文件里没有它）。
  ⚠ **`:55` 的守卫 `includes("加载中")` 拦不住**：`d825173` 版第 271 行是字面 `\u52a0\u8f7d\u4e2d`（转义而非实字），
  而 `:41` 的 `fixJsxUnicodeText` 会先把它解码成 `加载中` 再写盘 ⇒ 守卫通过。
  ⚠ 台账原表的「当前树上会 ENOENT 崩」与 `verify-dead` 的「非 ENOENT / 静默成功」**两处都不完整**：
  前者漏了「已丢代码」这一半，后者漏了「仍会崩」。本条按此改写理由，**删除动作与优先级不变**（仍建议全批第一条）。详见 §7 修正 #11。
- **证据**（`fe79b781` 亲核）：
  - `apps/desktop/scripts/fix-settings-utf8.mjs:38`
    ```
      const raw = execSync("git show d825173:apps/desktop/renderer/features/settings/AgentEditorView.tsx", {
    ```
  - `apps/desktop/scripts/fix-settings-utf8.mjs:12` `const eventsPath = join(root, "renderer/features/settings/EventsConfigView.tsx");`
  - `apps/desktop/scripts/fix-settings-utf8.mjs:54` `writeFileSync(agentPath, readable, "utf8");` ← **破坏点（静默丢 910 行）**
  - `apps/desktop/scripts/fix-settings-utf8.mjs:63` `readFileSync(eventsPath, "utf8");` ← **报错点（ENOENT）**
  - `git ls-files apps/desktop/renderer/features/settings/` → 无 `EventsConfigView.tsx`（24 个文件清单里没有）
  - `git show d825173:apps/desktop/renderer/features/settings/AgentEditorView.tsx` → 471 行；当前工作区 1381 行
  - `apps/desktop/scripts/fix-settings-utf8.mjs:3` `Run: node apps/desktop/scripts/fix-settings-utf8.mjs`
    （全仓提及点：自身注释 + `docs/Iterations/config-forms-merge-into-core/spec.md:71` 一处**历史文档提及**——文档不是消费方，不影响删除判定）
  - `git grep -rln -- "fix-settings-utf8" -- apps packages examples scripts .github` → **仅命中本文件自身**
- **修法**：整文件删除（547 行）。**连带清**：无（`package.json` 无 script、CI 无 step；`docs/Iterations/config-forms-merge-into-core/spec.md:71` 有一处**历史文档提及**，文档不是消费方，**不必改**，但 PR 描述里可提一句）。
  附带动作：在本次发版的 `CHANGELOG.md` 记一笔「删除一次性编码修复脚本」——理由是**有人可能已经跑过它**，
  受影响者需要知道回退路径（`git checkout` + `git show d825173:…` 历史）。
- **验收**：① `git grep -rln "fix-settings-utf8"` 归零；② 四域 tsc 无增量；③ 三包测试无增量；④ 净减行数 547（对账表记 547）。
- **测试策略**：无测试文件随之删改（零连带）。
- **回归线**：`apps/desktop/test/settings-agents-tabs.test.ts` 全绿（desktop 测试面唯一触及 `AgentEditorView.tsx` 的测试，源码文本断言，删死文件不影响）；desktop 其余 109 个测试文件无增量。
  ⚠ 原句里的「事件配置编辑器 / `EventsConfigView` 相关测试」**在 desktop 测试面零引用**，已删。
- **依赖**：无。**可独立先落，建议全批第一条**（清掉唯一有破坏性的目标）。
- **风险与回滚**：删除本身零风险；**残留风险是「已有人跑过它」导致工作区被回退**——这是不可逆的本地损失，
  故须在 CHANGELOG 留痕。⚠ 按修正后的病症，这条**比原判断更危险**：崩在第 2 步、毁在第 1 步，
  跑的人看到 ENOENT 会以为「崩了＝没改动」，实际工作区已被覆写。
  回滚粒度：`git revert` 单个 commit（该 commit 只含此文件删除）；**对已跑过的人**，恢复路径是 `git checkout` 该文件 + 按需 `git show d825173:…` 取回旧版。

---

### D-102｜`apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx`（整文件，1047 行）

- **严重度/簇**：P2 死码 / dead-backlog 批次 1 / apps-desktop（renderer features）
- **病症**：1047 行的 forwardRef 智能体定义编辑表单，**全仓零 importer**（16 个 renderer 文件全扫）。
  `AgentEditorView.tsx` 内联了同款表单，构成 **2400 行双源**（`synth/apps-mobile.md` AM-22 注记同源）。
- **证据**（亲核）：
  - `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176`
    ```
    export const AgentDefinitionEditorForm = forwardRef<
    ```
  - `git grep -rln -- "AgentDefinitionEditorForm" -- apps packages examples scripts` → **仅命中本文件自身**
  - 争议 #5（`dead-backlog.md`「文案占位价值」）已由 `verify-dead` §5 #5 结清：三处 hint 文案里
    ① `:620` 在本文件内（随文件删）、② `AgentEditorView.tsx:822`、③ `apps/mobile/.../AgentEditorToolsSection.tsx:66`，
    后两处**活着**。⇒ 删除是**纯文档事项**，代码零改动，`docs/apm/memory/20260825-*` 里「三处」改「两处」由用户/主代理执行。
- **修法**：整文件删除（1047 行）。**连带清**：无导入方需改；无测试引用。
- **验收**：① grep 归零；② 四域 tsc 无增量；③ `apps/desktop` renderer 已知红条数 **≤411**（`baseline.md` §4 实测分母，非台账旧值 424）；④ 净减 1047。
- **测试策略**：无测试文件随之删改。
- **回归线**：`apps/desktop/test/settings-agents-tabs.test.ts` 全绿（desktop 测试面**唯一**触及 `AgentEditorView.tsx` 的文件，
  做法是 `agentEditorPath` 拼路径 + `readFileSync` 正则匹配的**源码文本断言**，删死文件不影响它）；desktop 其余 109 个测试文件无增量。
  ⚠ 原稿写的「加载/保存/dirty 守卫用例」在 desktop 侧**没有对应测试文件**，该句已删（撰写轮复查：`git grep -rn "AgentEditorView\|EventsConfigView" -- apps/desktop/test packages/core/test` 仅命中上述文件；
  `EventsConfigView` 在 desktop 测试面**零引用**）。
  注意 `S-D-04` dirty 通道与盲扫条目 **B**（`formSnapshotJson` 缺 `mode`）都落在这个**活的那一半**上，**不得顺手改**。
- **依赖**：无代码依赖。文档侧需在 `docs/apm/memory/20260825-*` 改「三处 hint」→「两处」——**代理禁写 `docs/apm/`，交用户**。
- **风险与回滚**：
  - ⚠ **ledger §10 Wave D「批次 3 新增三组目标」的第 ① 项与本条 D-102 是同一个对象**（见 §4 目标① 与 §7 修正 #1）。
    本分片裁定：**只做一次，归批次 1 的 D-102**，批次 3 不重复施工。
  - 对抗分歧留痕：w9-desktopfeat-pro-1 给 P1（1047 行零引用就该删）、adv 让步 C-1 给 P2（「是复用 config-forms/agent 的表单」），
    对抗裁决 `mitigated` 降 P2 并归 dead-backlog。**若用户拍板「要把它接回去复用」，则本条从批次 1 撤下、移入 Wave E 接线工作。**
  - 回滚粒度：单文件 revert。

---

### D-103｜`apps/desktop/renderer/features/workspace/useWorkspaceTree.ts`（整文件，66 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-desktop（renderer workspace）
- **病症**：三个 workspace 树 hook（`usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader`）打包在一个零 importer 的文件里。
- **证据**（亲核）：
  - `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:7` `export function usePreviewSelection() {`
  - 同文件 `:30 export function useTreeRefreshToken() {`、`:37 export function useTreeLoader(`
  - `git grep -rln -- "useWorkspaceTree" -- apps packages examples scripts` → **零命中**（三个符号名也只在本文件内）
- **修法**：整文件删除（66 行）。连带清：无。
- **验收**：grep 归零 + 四域 tsc 无增量 + 三包测试无增量 + 净减 66。
- **测试策略**：无。
- **回归线**：workspace 文件树加载/展开/预览选中用例全绿（走的是 `WorkspaceTree.tsx` 自身实现，不经本文件）。
- **依赖**：无。
- **风险与回滚**：低。`git revert` 单文件。

---

### D-104｜`apps/mobile/src/components/batch/ListBatchBar.tsx`（整文件，56 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-mobile（components）
- **病症**：批量操作条组件零引用；批量操作能力已由 `ManageHeader.tsx:74-128` 的 `batchMode` 分支完整承担（`synth/apps-mobile.md` AM-25）。
- **证据**（亲核）：
  - `apps/mobile/src/components/batch/ListBatchBar.tsx:15` `export function ListBatchBar({selectedCount, onCancel, onDelete}: Props) {`
  - `git grep -rln -- "ListBatchBar" -- apps packages` → **仅命中本文件自身**
- **修法**：整文件删除（56 行）。连带清：无。
- **验收**：grep 归零 + mobile tsc 无增量 + mobile jest 无增量 + 净减 56。
- **测试策略**：无。
- **回归线**：mobile 批量删除/移动（`useBatchDeleteConfirm` / `VfsFileManager` 批量分支）用例全绿。
- **依赖**：无。
- **风险与回滚**：低。注意**不要**顺手动 `ManageHeader.tsx`（它是活的）。回滚：单文件 revert。

---

### D-105｜`apps/desktop/renderer/features/chat/tool-turn-actions.ts`（整文件，54 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-desktop（renderer chat）
- **病症**：工具轮次「隐藏 / 恢复 / 删除」三个 IPC 调用的唯一调用点。文件零 importer ⇒
  `ipcMessagesHide` / `ipcMessagesShow` / `ipcMessagesDelete` 在 desktop renderer 侧变成**零调用**。
- **证据**（亲核）：
  - `apps/desktop/renderer/features/chat/tool-turn-actions.ts:20` `await ipcMessagesHide({ messageId: assistantMessageId });`
  - `git grep -rn -- "features/chat/tool-turn-actions" -- apps packages` → **零命中**
  - `git grep -rn "ipcMessagesHide\|ipcMessagesShow\|ipcMessagesDelete" -- apps/desktop` 的调用点**只落在本文件**
    （`client.ts:90-95` 只是再导出，`invoke-registry.ts:360-380` 只是封装定义）
- **修法**：整文件删除（54 行）。连带清：无。
- **验收**：grep 归零 + 四域 tsc 无增量 + desktop 测试无增量 + 净减 54。
- **测试策略**：无测试文件随之删改（本文件从未被测试引用）。
- **回归线**：desktop 聊天工具轮的渲染用例全绿。
- **依赖**：无。但**落地后会触发两条级联**（`ipcMessagesHide/Show/Delete` 变零调用）：
  - **D-301**（摘 `MESSAGES_HIDE/SHOW/DELETE` 通道）——已登记在本文件 §5「死通道 3b」，**本批只登记、不在本批施工**（保持批次 1「零连带」性质）。
  - mobile 侧同名文件见 **D-204**（批次 2）。
- **风险与回滚**：低。回滚：单文件 revert；若随后 D-301 出问题，`git revert` D-301 的 commit 即可（两者分属不同 commit）。

---

### D-106｜`apps/mobile/src/components/chat/transcript-selectable-role.ts`（整文件，49 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-mobile（components chat）
- **病症**：对 `@novel-master/core/chat` 的 tail 批量可见性纯函数**再导出 shim**（11 个值/函数 + 4 个类型 + 2 个本地 helper），
  零 importer。功能本体在 core 且被快照锁住，**core 侧不动**。
- **证据**（亲核）：
  - `apps/mobile/src/components/chat/transcript-selectable-role.ts:16-30` 的 `export { … } from '@novel-master/core/chat'` 块
  - `git grep -rln -- "transcript-selectable-role" -- apps packages` → **零命中**（双端两份都是零 importer）
- **修法**：整文件删除（49 行）。连带清：无（core `public/chat.ts` 的转出**不动**，见 §5「快照面」）。
- **验收**：grep 归零 + mobile tsc/jest 无增量 + 净减 49。
- **测试策略**：无（连测试都没有）。
- **回归线**：mobile 转录行选中/批量可见性相关用例全绿（走 `MessageList` legacy-rn 回滚线或 WebView 线，不经本文件）。
- **依赖**：与 **D-107** 同批（双端成对删）。**落地后 desktop `shared/logic/chat.ts` 的 15 行转出变死**，见 §4 批次 3.2 口径与 §7 修正 #4。
- **风险与回滚**：低。回滚：单文件 revert（与 D-107 同 commit 或相邻 commit，二选一但必须都在批次 1 内）。

---

### D-107｜`apps/desktop/renderer/features/chat/transcript-selectable-role.ts`（整文件，47 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-desktop（renderer chat）
- **病症**：D-106 的 desktop 孪生文件，另含一个本地 `buildTailBatchRows`（`:30`）与 `MessageBatchMode`（`:27`），同样零 importer。
- **证据**（亲核）：
  - `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:30` `export function buildTailBatchRows(`
  - `git grep -rln -- "transcript-selectable-role" -- apps packages` → **零命中**
  - `git grep -rn "TailBatchRow\|MessageBatchMode\|buildTailBatchRows" -- apps/desktop` → 命中只落在本文件与 `shared/logic/chat.ts` 的转出
- **修法**：整文件删除（47 行）。连带清：无。
- **验收**：grep 归零 + desktop tsc（main + renderer 已知红）无增量 + desktop 测试无增量 + 净减 47。
- **测试策略**：无。
- **回归线**：desktop 转录行选中/批量用例全绿。
- **依赖**：与 D-106 同批。**落地后 `apps/desktop/shared/logic/chat.ts` 的 15 行转出（:30/:32-34/:49-53/:76-77/:101-102/:108-109）成死**，
  处置口径见 §4 批次 3.2 与 §7 修正 #4（**不计入本批行数**，另立一条摘转出条目）。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-108｜`apps/desktop/renderer/layout/AppMenuBar.tsx`（整文件，40 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-desktop（renderer layout）
- **病症**：应用内菜单栏组件零 importer。它是 `SHELL_MENU_POPUP` 通道的**唯一 renderer 调用方**
  ⇒ 删除后 `SHELL_MENU_POPUP` 全链死。`preload.ts:18/43` 的 `inWindowMenuBar` 恒 `false` 且 renderer 零读取，是它已退役的残骸证据。
- **证据**（亲核）：
  - `apps/desktop/renderer/layout/AppMenuBar.tsx:14` `export function AppMenuBar() {`
  - `apps/desktop/renderer/layout/AppMenuBar.tsx:17` `void ipcShellMenuPopup({`
  - `git grep -rln -- "AppMenuBar" -- apps packages` → **仅命中本文件自身**；
    `git grep -rn "SHELL_MENU_POPUP" -- apps/desktop` 的 renderer 侧调用点**只在本文件 :17**
- **修法**：整文件删除（40 行）。连带清：无（`preload.inWindowMenuBar` 属 **Wave E 的 X1 收口**范围，本批不动）。
- **验收**：grep 归零 + 四域 tsc 无增量 + 三包测试无增量 + 净减 40。
- **测试策略**：无。
- **回归线**：desktop 窗口/菜单（原生应用菜单 `buildApplicationMenu`）用例全绿。
- **依赖**：无。落地后触发级联 **D-303**（`SHELL_MENU_POPUP` 全链删），登记在 §5「死通道 3c」，**本批只登记不施工**。
  ⚠ `verify-dead` §4 的警告成立：**`SHELL_SET_TITLEBAR_THEME` 另有活消费方 `ThemeProvider.tsx:55`，严禁同删**。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-109｜`apps/cli/src/vfs/errors.ts`（整文件，28 行）— **台账施工单修正 ②**

- **严重度/簇**：P3 死码 / 批次 1 / apps-cli
- **病症**：CLI 的 VFS 错误口径副本（`EXIT_USAGE` / `EXIT_RUNTIME` / `formatCliError` / `exitCodeForError`）零 importer。
  真正在用的是 `apps/cli/src/cli-errors.ts`（`main.ts:23-27` 活引）。
  **台账原锚点 `:4,7,20` 漏了 `:5 EXIT_RUNTIME`**（`verify-dead` §2 adjusted）。
- **证据**（亲核，四个导出的确切行号）：
  - `apps/cli/src/vfs/errors.ts:4` `export const EXIT_USAGE = 1;`
  - `apps/cli/src/vfs/errors.ts:5` `export const EXIT_RUNTIME = 2;`  ← **台账漏项，本施工单补齐**
  - `apps/cli/src/vfs/errors.ts:7` `export function formatCliError(error: unknown): string {`
  - `apps/cli/src/vfs/errors.ts:20` `export function exitCodeForError(error: unknown): number {`
  - `git grep -rln -- "vfs/errors" -- apps/cli` → **零命中**（无 `from './errors.js'`、无 `vfs/errors` 说明符）
- **修法**：**整文件删除**（28 行，4 个导出全删，动作是删文件而非摘符号，锚点漏一条不影响施工，但本施工单按台账要求已补 `:5`）。
  **不得顺手删 `apps/cli/src/cli-errors.ts`**（`main.ts:23-27` 活引；它的 `EXIT_RUNTIME` 是另一条同符号的另一份，L0 表也单列了它）。
- **验收**：① grep 归零；② 四域 tsc 无增量；③ 三包测试无增量；④ 净减 28。
- **测试策略**：无。
- **回归线**：CLI 的 e2e 退出码用例（`apps/cli/test/**/*.test.ts`）行为不变——
  ⚠ `apps/cli` **本来就有 26/102 条红灯**（N-P0-03，Wave A 才修），本批**不得**把它们计入新增回归，判增量一律对照 `baseline.md`。
- **依赖**：无。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-110｜`apps/cli/src/vfs/runtime.ts`（整文件，24 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-cli
- **病症**：`createVfsRuntime`（打开库 + bootstrap + 返回 global scoped `VfsService`）与 `resolveDbPath` 再导出，全仓零 importer。
- **证据**（亲核）：
  - `apps/cli/src/vfs/runtime.ts:18` `export async function createVfsRuntime(argv: readonly string[]): Promise<{`
  - `apps/cli/src/vfs/runtime.ts:13` `export { resolveDbPath } from "../runtime.js";`
  - `git grep -rln -- "vfs/runtime" -- apps/cli` → **仅命中本文件自身**
- **修法**：整文件删除（24 行）。连带清：无。
- **验收**：grep 归零 + tsc/测试无增量 + 净减 24。
- **测试策略**：无。
- **回归线**：CLI 全部 e2e 行为不变（同 D-109 的 26 条既有红灯口径）。
- **依赖**：无。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-111｜`apps/mobile/src/hooks/useStreamTailGenerating.ts`（整文件，12 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-mobile（双端同名重复之一）
- **病症**：`useStreamTailGenerating` hook，零 importer；实现是 `uiRunning` 的恒等包装。
- **证据**（亲核）：
  - `apps/mobile/src/hooks/useStreamTailGenerating.ts:8` `export function useStreamTailGenerating(`
  - `git grep -rln -- "useStreamTailGenerating" -- apps packages` → **只命中 D-111 / D-112 两个文件自身**（各自定义行）
- **修法**：整文件删除（12 行）。连带清：无。
- **验收**：grep 只剩 D-112（或两条同批删完归零）+ mobile tsc/jest 无增量 + 净减 12。
- **测试策略**：无。
- **回归线**：mobile 流尾「生成中」指示器用例全绿（走 `MessageList` 内联实现）。
- **依赖**：与 D-112 同批（双端成对删）。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-112｜`apps/desktop/renderer/hooks/useStreamTailGenerating.ts`（整文件，10 行）

- **严重度/簇**：P3 死码 / 批次 1 / apps-desktop（D-111 的双端孪生）
- **证据**（亲核）：
  - `apps/desktop/renderer/hooks/useStreamTailGenerating.ts:8` `export function useStreamTailGenerating(uiRunning: boolean): StreamTailGenerating {`
  - grep 同上，只命中两个文件自身
- **修法**：整文件删除（10 行）。
- **验收 / 测试策略 / 回归线 / 风险与回滚**：同 D-111。
- **依赖**：与 D-111 同批。
- **说明**：`synth/apps-mobile.md` AM-49 记「`useChatTabStream.ts:25` 文件名与唯一导出不符」是**另一条 P3 死债**，
  **不在本波次**，别顺手删（该文件仍被 `ChatTabProvider` 侧引用）。

---

### D-113｜`packages/core/src/common/memoize.ts`（整文件，123 行）

- **严重度/簇**：P3 死码 / 批次 1 / core-common
- **病症**：通用 memoize 工具（单参用 `WeakMap`、多参用 JSON key），**从未接线**。
  文件头 105-116 行的完整 JSDoc 描述了 agent 主循环内「同输入必同输出」的适用场景，但那个调用点从未出现。
- **证据**（亲核）：
  - `packages/core/src/common/memoize.ts:5` ` * @module common/memoize`
  - `git grep -rln -- "common/memoize" -- apps packages examples scripts` → **仅命中本文件自身**
  - `git grep -rln -w -- "memoize" -- apps packages` → 本文件 + 两份 tokenizer 资产 JSON（`claude.json`，词表数据里的同名词，与本符号无关）
  - `common/index.ts` **未**转发本文件 ⇒ 不在快照面
- **修法**：整文件删除（123 行）。连带清：无。
- **验收**：① grep 只剩资产 JSON 的无关同名词；② core `tsc -p packages/core` 通过；
  ③ `packages/core/test/package-exports/**` 13 份快照测试全绿（**删前用 `grep "memoize" snapshots/*.json` 确认为零命中**，撰写轮已确认为零命中）；
  ④ 净减 123。
- **测试策略**：无。
- **回归线**：core 全量测试无增量（重点：tokenizer / provider / agent-runner 三组，它们是最可能曾经想接 memoize 的地方）。
- **依赖**：无。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-114｜`packages/core/src/domain/vfs/logic/infer-scope-from-path.ts`（整文件，74 行）

- **严重度/簇**：P3 死码 / 批次 1 / core-vfs
- **病症**：物理路径反推 `scope_key` 的**迁移专用**函数，零 importer。头注释自述「迁移专用」——
  即它是 schema 迁移期的工具，迁移早已完成（`vfs_entry.scope_key` 已成列）。
- **证据**（亲核）：
  - `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts:2` `* 物理路径反推 scope_key + 纯逻辑查表（迁移专用）。`
  - `git grep -rln -- "infer-scope-from-path" -- apps packages examples scripts` → 本文件 +
    `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts`（**注释提及，非调用**）
  - `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts:187` `* 取值与 \`infer-scope-from-path.ts\` 的反推规则一致：`
- **修法**：① 整文件删除（74 行）；② **连带删** `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts:187` 的那一行注释提及
  （留着就是一条指向已删文件的悬空引用）。**只删注释那一行，不动该文件其余内容**。
- **验收**：① 文件消失、`vfs-path-mapper.ts:187` 注释消失；② core tsc 通过；③ 快照测试全绿；④ 净减 75（74 + 1 行注释）。
- **测试策略**：无。
- **回归线**：core VFS scope 解析用例（`scope_key` ↔ 逻辑路径互转）全绿。
- **依赖**：无。
- **风险与回滚**：低。回滚：单 commit 内含两文件，回滚粒度 = 该 commit。

---

### D-115｜`packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts`（整文件，21 行）

- **严重度/簇**：P3 死码 / 批次 1 / core-infra-kkv
- **病症**：`parseKkvJsonDocument` 全仓零 importer。KKV 的实际解析走 `sqlite-session-kkv.repository.ts` 自己的解析路径。
- **证据**（亲核）：
  - `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts`（全文 21 行，唯一导出 `parseKkvJsonDocument`）
  - `git grep -rln -- "parse-kkv-json-document" -- apps packages examples scripts` → **仅命中本文件自身**
- **修法**：整文件删除（21 行）。
  **连带清**：删文件后 `packages/core/src/infra/kkv/logic/` 目录变空，随之消失（git 不跟踪空目录，无需额外动作，但 PR 描述里要提一句）。
  ⚠ 原稿写「该目录仍有其它活文件，目录不删」——**前提为假**：撰写轮复查 `Get-ChildItem -Recurse packages/core/src/infra/kkv` /
  `git ls-files packages/core/src/infra/kkv/logic/` 均返回**仅这一个文件**，删完目录即空。
- **验收**：文件消失 + core tsc 通过 + 快照测试全绿 + 净减 21。
- **测试策略**：无。
- **回归线**：core KKV 域读写用例全绿。
- **依赖**：无。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-116｜`packages/core/src/domain/tool/logic/subagent-tool-session-id.ts`（**只删 `isTaskToolUse`，7 行**）— **台账施工单修正 ③：选 B1-a**

- **严重度/簇**：P3 死码 / 批次 1 / core-domain-tool
- **病症**：`isTaskToolUse` 全仓零引用（连测试都没有）；同文件的 `resolveSubagentSessionId` **有 1 处测试引用**，不是死码。
  台账批次 1 的总纲原写「全部零测试」，与 D-116 行自述矛盾——`verify-dead` §2 已 adjusted。
- **证据**（亲核，行号以 `fe79b781` 为准）：
  - `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts:33`
    ```
    export function isTaskToolUse(toolName: string): boolean {
      return toolName === "task";
    }
    ```
  - `git grep -rln -w -- "isTaskToolUse" -- apps packages` → **仅命中本文件自身**
  - `git grep -rn -w -- "resolveSubagentSessionId" -- apps packages` →
    `packages/core/test/tool/subagent-meta-passthrough.test.ts:8`（import）+ `:64/:66/:69/:70/:72`（C17 用例）
  - `src` 侧确实零引用（`build-tool-result-block.ts:354` 的 `resolveSubagentSessionIdFromOutcome` 是**另一个本地函数**，不是它）
- **修法（选 **B1-a**，台账 §10 明示）**：
  1. 删 `:29-35`（`isTaskToolUse` 的 JSDoc 3 行 + 函数 3 行）。
  2. **保留** `resolveSubagentSessionId`（`:15-27`）与其 `:1-13` 的模块头/类型 import。
  3. **保留** `ToolUseBlock` / `ToolResultBlock` 的再导出（`:37-38`）——它们属批次 3.1 的「摘 export」项（`synth/dead-backlog.md` 附录 A.4 已列），
     可在本批顺手摘掉（零风险，文件内无人用这两个类型），但**不计入本批强制动作、不计入行数对账**。
  4. **测试不动** ⇒ 批次 1「零测试连带」的总纲成立。
- **备选案 B1-b（不采用，登记差异）**：连 `resolveSubagentSessionId` 一起删，则必须同批删
  `packages/core/test/tool/subagent-meta-passthrough.test.ts:8` 的 import 与 `:64-75` 的 C17 用例，
  此时 D-116 性质等同批次 2（有测试连带），且**该用例是「对称 vfs-tool-file-path」的同源守卫、删了净亏**。
- **验收**：① `isTaskToolUse` grep 归零、`resolveSubagentSessionId` 仍在且测试仍绿；
  ② core tsc 通过；③ core 全量测试无增量（`subagent-meta-passthrough.test.ts` 的 C17 必须仍绿）；④ 净减 **7 行**。
- **测试策略**：**无测试文件删改**（B1-a 的定义就是「测试不动」）。
- **回归线**：`packages/core/test/tool/subagent-meta-passthrough.test.ts` 全绿；core agent/tool 域测试无增量。
- **依赖**：无。
- **口径留痕**：B1-a 落地后，`resolveSubagentSessionId` 成为**「仅测试消费」**符号——
  它落在 `L0/dead-exports.md` 的「仅测试消费」桶（**不是** 363 条 C 类）。
  该桶曾因 F-synth-dead-1 的桶定义缺陷（`testOnly` 未排除 `relayed`）**整体不可直接当删除清单用**；
  🔁 该缺陷已由 **§4.9 F-synth-dead-1** 修正并重跑（口径已排除 `relayed`），
  但**重跑后该桶仍只作线索、不得当删除清单**（快照面与 barrel 侧各有独立约束），★1 解锁议题也**不覆盖**它
  ⇒ 登记为债务池条目，不在本波处置。
- **风险与回滚**：低。回滚：单 commit（只删 7 行）。

---

### 批次 1 小结

| 项 | 值 |
|---|---|
| 条目数 | 16（D-101 ~ D-116） |
| 零 importer | 16/16（撰写轮逐条 grep 核实） |
| 测试连带 | **0**（D-116 按 B1-a 收窄后） |
| 快照面命中 | 0（13 份快照逐份确认为零命中） |
| 标称净减 | 2236 行（16 文件全删口径） |
| **实际净减（B1-a）** | **≈2205 行**（16 个目标文件本体）＋ **D-114 连带删 1 行注释** ⇒ **合计 2206 行**（验收对账按 2206 走） |
| 登记但**不在本批施工**的级联 | D-301（D-105 触发）、D-303（D-108 触发）、`shared/logic/chat.ts` 15 行转出（D-106/D-107 触发） |
| 可独立先落 | D-101（唯一有破坏性的目标，建议第一条）、D-109、D-110 |

---

## 3 · 批次 2 · 有测试/配置连带（D-201 ~ D-209，9 条）

**开工前置（硬门）**：**先 `npm run build -w @novel-master/core` 重建 `packages/core/dist`。**
理由：mobile jest 30+ 条 `moduleNameMapper` 直连 `dist/**`（`apps/mobile/jest.config.js:59-221` 共 **27 条 core 子路径 + 11 条 driver 子路径**，
dist 直连首条在 `:59`；`test-utils/core-shim.ts:13-97` 用 `packages/core/dist/**` 相对路径再导出 59 个名字）。
⚠ 原写的 `:37,45,47,48,58` 五行实为 **mock shim 映射**（reanimated/notifee/blob-util/op-sqlite/core-shim），**没有一行直连 dist**，已订正。
⚠ **前置只绑定裸 `npx jest` 路径**：走 `npm test -w apps/mobile` 时 `apps/mobile/package.json` 的 `pretest` 已自动跑
`npm run build -w @novel-master/core -w @novel-master/cloud-sync-driver-s3 -w @novel-master/llm-sse-native && npm run build:webview` ⇒ 手工前置冗余。
⚠ 构建另需 `build:preload`（根 `npm run build` 会 TS5042 + `preload.cjs` 静默缺产，见 §1.3 规则 2）。
**在 rebuild 之前跑 mobile 测试得到的任何失败都不可归因**（`verify-dead` §3 补记 + §5 #8：撰写时 `dist` 是 2026-10-01 02:34 的旧产物）。
**规则依据**：`docs/apm/RULE.md:70`「改 dist 消费的包必须重建 dist」；`docs/apm/RULE.md:74`「新增 exports 子路径必须同步 `tsconfig.test.json` paths，
**paths 缺映射时 tsx 回退 node 解析、经 node_modules 自链加载 `dist/` 旧产物，测试静默跑旧码**」——后者正是 **D-207** 的直接约束。
批次 2 里 **D-207 / D-209 / D-316（★3）** 三条是编译红风险最高的（改 `tsconfig.test.json` paths、删 ambient d.ts、动对外子路径）。

**共同纪律（`jest.mock` 对不存在的模块会抛 `Cannot find module`）**：**必须先摘 `jest.mock`、再删源文件**，
不允许「先删文件后补测试」。每条都要在同一个 commit 内完成「摘 mock + 删源 + 改断言」三件事。

**行数对账**：标称 **248 行**（`wc -l` 口径，9 个文件各 +1）；PowerShell 行数口径合计 **239 行**
（apps 193 行 + core 46 行）。验收对账用实际删除行数，标称 248 仅作口径备案。

---

### D-201｜`apps/mobile/src/services/session-messages-loader.ts`（整文件，38 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-mobile（services）
- **病症**：三个 loader（`loadSessionMessages` / `loadSessionMessagesTail` / `loadSessionMessagesPage`）零 importer；
  唯一「引用」是 6 个测试文件里的 `jest.mock` 桩。`chat-tab-screen.integration.test.tsx:421` 的注释已明写
  「该 loader 的 hook 消费方已退役」。
- **证据**（亲核，6 处 `jest.mock` 行号逐条核对**全对**）：
  - `apps/mobile/__tests__/chat-tab-screen-legacy-scroll.test.tsx:157` `jest.mock('../src/services/session-messages-loader', () => ({`
  - `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx:209`（同形）；`:421` 注释「…hook 消费方已退役。」
  - `apps/mobile/__tests__/composer-fullscreen.test.tsx:231` `jest.mock('@/services/session-messages-loader', () => ({`
  - `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts:37`（`../src/…` 形）
  - `apps/mobile/__tests__/use-chat-tab-message-actions-set-floor.test.ts:23`（`@/…` 形）
  - `apps/mobile/__tests__/use-chat-tab-message-actions-token-peak.test.ts:32`（`@/…` 形）
  - `git grep -rln "session-messages-loader" -- apps packages` → 上列 6 个测试文件 + 本文件，**`src` 侧零 importer**
- **修法**：
  1. 先摘 6 处 `jest.mock(...)`（含其后的工厂对象字面量整块）。
  2. 再删 `apps/mobile/src/services/session-messages-loader.ts`（38 行）。
  3. 连带清**两处**含本文件名的注释：
     - `chat-tab-screen.integration.test.tsx:421`「该 loader 的 hook 消费方已退役」——若指向的行为已完全消失，可一并删；
     - `chat-tab-screen.integration.test.tsx:466`「单元消息面：listBySessionTail…而非 session-messages-loader」——
       ⚠ **这处原修法漏点**，它同样含本文件名，不清则验收①的「grep 归零」不可达。
     **若两处注释保留，注释里不得再出现本文件名。**
- **验收**：① `grep -rln "session-messages-loader" -- apps packages` 归零（**含注释**——`:421` 与 `:466` 两处都要处理，
  只清 `:421` 则本条验收不可达）；② rebuild core 后 mobile tsc + jest 无增量；
  ③ 6 个测试文件仍全绿（它们改的是被测行为路径，不是断言内容）；④ 净减 38 + mock 块行数。
- **测试策略**：
  - **改**（不删）：6 个测试文件，各摘 1 处 `jest.mock` + 工厂字面量。
    - `chat-tab-screen-legacy-scroll.test.tsx`（:157）
    - `chat-tab-screen.integration.test.tsx`（:209，另处理 :421 与 :466 两处注释）
    - `composer-fullscreen.test.tsx`（:231）
    - `use-chat-tab-message-actions-rollback.test.ts`（:37）
    - `use-chat-tab-message-actions-set-floor.test.ts`（:23）
    - `use-chat-tab-message-actions-token-peak.test.ts`（:32）
  - **删**：无。
- **回归线**：6 个测试文件自身全绿；mobile `chat-tab` / `use-chat-tab-message-actions` 族用例无增量。
- **依赖**：**前置 rebuild core**（见本节开头）。**不得**先跑 mobile 测试看基线。
- **风险与回滚**：中（6 个测试文件同批改）。回滚粒度 = 一个 commit 含 7 个文件；出问题时
  `git revert <commit>` 一次性还原。**建议把 6 个 mock 摘除 + 删源放在同一 commit**，避免中间态红。

---

### D-202｜`apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts`（整文件，48 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-desktop（renderer layout）
- **病症**：`sanitizeAnnotatePreviewHtml` 已零生产消费——desktop 的批注认锚渲染路线
  （`buildAnnotatedSource` + `rehype-raw`）已于 T-SA6 退役（测试 :111 明写「Desktop MD 已退役插锚」）。
  但**两处负向断言**（断言「面板里不再含它」）必须保留。
- **证据**（亲核，`verify-dead` 原表只列了 1 个测试文件，撰写轮查到 **2 个**）：
  - `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts:24` `export function sanitizeAnnotatePreviewHtml(html: string): string {`
  - `apps/desktop/test/preview-annotate-source-anchor.test.ts:26` `import { sanitizeAnnotatePreviewHtml } from "@/layout/sanitize-annotate-preview-html";`
    + 正向使用 3 处：`:67`、`:90`、`:136`
    + **负向断言 1 处（保留）**：`:114` `assert.doesNotMatch(pane, /sanitizeAnnotatePreviewHtml/);`
    + 路径常量 `sanitizePath`（`:43-49`）—— 全文件仅此一处使用 ⇒ 随之删
  - `apps/desktop/test/preview-recogito-md.test.ts:76` `assert.doesNotMatch(pane, /sanitizeAnnotatePreviewHtml/);`
    —— **负向断言，删源文件后仍绿，无需改动**
- **修法**：
  1. 删 `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts`（48 行）。
  2. **改** `apps/desktop/test/preview-annotate-source-anchor.test.ts`：删 `:26` import、删 `sanitizePath` 常量（`:43-49`）、
     删 3 个直接依赖它的 `it`（`:63-72`、`:74-109`、`:119-150`）。**保留** `:111-117` 那个 it（内含 `:114` 负向断言）。
  3. **`preview-recogito-md.test.ts` 一行都不改**（`:76` 是负向断言，删源后自动仍绿）。
- **验收**：① grep 只剩两处负向断言里的字符串字面量；② desktop main tsc 无增量；③ desktop renderer 已知红 **≤411**（`baseline.md` §4 实测分母）；
  ④ desktop 测试无增量（**注意 N-P0-02 未修前 Windows 上收集 0 条、须用 baseline 的等价命令**；同时记录本批收集数并对照 §1.2 分母 628）；⑤ 净减 48 + 3 个 it。
- **测试策略**：
  - **改**：`apps/desktop/test/preview-annotate-source-anchor.test.ts`（删 import + 常量 + 3 个 it，保留 1 个负向 it）。
  - **不改**：`apps/desktop/test/preview-recogito-md.test.ts`（负向断言天然兼容）。
  - **删**：无测试文件。
- **回归线**：`preview-annotate-source-anchor.test.ts` 的 T-SA8 段（划词 offset 用例）与 `preview-recogito-md.test.ts` 全绿。
- **依赖**：无（desktop 不吃 core dist）。可与 D-203~D-206 并行。
- **风险与回滚**：低—中。回滚粒度 = 含「源文件 + 1 个测试文件」的 commit。
  ⚠ **不得**因为「负向断言读起来像引用」就把它一起删——删掉负向断言会让「面板里不含它」这条契约失去守卫（RULE「恒真的断言是废断言」的反面：删掉有效的负向断言是丢覆盖）。

---

### D-203｜`apps/mobile/src/components/chat/flush-run-ui.ts`（mobile 半边，40 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-mobile
- **病症**：mobile 半边的 `flushRunUi` / `flushAgentStepUi` 零生产消费。
  **desktop 半边（`apps/desktop/renderer/features/chat/flush-run-ui.ts`）是活的**，被 `conversation-abort-retain.ts:7` import。
- **证据**（亲核）：
  - `apps/mobile/src/components/chat/flush-run-ui.ts:17` `export async function flushRunUi(`
  - `git grep -rn "flush-run-ui" -- apps/desktop apps/mobile`：
    - `apps/desktop/renderer/features/chat/conversation-abort-retain.ts:7` `import { flushAgentStepUi } from "./flush-run-ui";`（desktop 侧，活）
    - `apps/desktop/test/flush-run-ui.test.ts:6` `} from "@/features/chat/flush-run-ui";`（desktop 侧测试）
    - `apps/mobile/__tests__/flush-run-ui.test.ts:1` `import {flushAgentStepUi, flushRunUi} from '@/components/chat/flush-run-ui';`（mobile 侧，唯一引用）
- **修法**：删 `apps/mobile/src/components/chat/flush-run-ui.ts`（40 行）+ 删 `apps/mobile/__tests__/flush-run-ui.test.ts`（3 个 `it`）。
  **desktop 半边与其测试一个字都不动。**
- **验收**：① grep 后 `flush-run-ui` 只剩 desktop 三处；② mobile tsc/jest 无增量；③ desktop 测试无增量；④ 净减 40 + 测试文件行数。
- **测试策略**：**删** `apps/mobile/__tests__/flush-run-ui.test.ts`（全文 3 个 `it`）。
- **回归线**：mobile run 收尾 / 流式 UI 刷新用例全绿；desktop `flush-run-ui.test.ts` 全绿。
- **依赖**：**前置 rebuild core**（mobile 侧）。
- **风险与回滚**：低。回滚：单 commit（源 + 测试）。

---

### D-204｜`apps/mobile/src/components/chat/tool-turn-actions.ts`（mobile 半边，47 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-mobile（与 D-105 成对）
- **病症**：mobile 半边的 `hideToolTurn` / `deleteToolTurn` 零生产消费，只有自己的测试引。
- **证据**（亲核）：
  - `apps/mobile/src/components/chat/tool-turn-actions.ts:10` `export async function hideToolTurn(`
  - `git grep -rln "flush-run-ui\|tool-turn-actions" -- apps` 复核：mobile 侧命中只在 `apps/mobile/__tests__/tool-turn-actions.test.ts`
  - `apps/mobile/__tests__/tool-turn-actions.test.ts` 实测 **5 个 `it`**（台账原写 4，撰写轮修正为 5）
- **修法**：删 `apps/mobile/src/components/chat/tool-turn-actions.ts`（47 行）+ 删 `apps/mobile/__tests__/tool-turn-actions.test.ts`。
- **验收**：① grep 后 mobile 侧归零；② mobile tsc/jest 无增量；③ 净减 47 + 测试文件行数。
- **测试策略**：**删** `apps/mobile/__tests__/tool-turn-actions.test.ts`（5 个 `it`）。
- **回归线**：mobile 转录工具轮渲染用例全绿。
- **依赖**：**前置 rebuild core**。**连带**：与 D-105 同族；两条落地后
  `ipcMessagesHide/Show/Delete` 在**双端**都变成零调用 ⇒ **D-301** 的施工前提此时才真正成立（见 §5「死通道 3b」）。
- **风险与回滚**：低。回滚：单 commit。

---

### D-205｜`apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts`（整文件，16 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-mobile（webview-host）
- **病症**：`nextStreamTailHtmlField` 的「共享真源」实现零生产消费——
  webview 实际用的是 `runtime/stream/stream.ts:566-579` 的内联重写（`synth/apps-mobile.md` AM-14 表第 4 行）。
  唯一引用是自己的测试 ⇒ **测试测的是没人跑的那份**。
- **证据**（亲核）：
  - `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts:5` `export function nextStreamTailHtmlField(`
  - `git grep -rln "stream-tail-html-state\|nextStreamTailHtmlField" -- apps packages` → 本文件 + `apps/mobile/__tests__/stream-tail-html-state.test.ts`
- **修法**：删源文件（16 行）+ 删测试文件。
- **验收**：grep 归零 + mobile tsc/jest 无增量 + 净减 16 + 测试行数。
- **测试策略**：**删** `apps/mobile/__tests__/stream-tail-html-state.test.ts`。
- **回归线**：`stream.ts` 的流尾 HTML 提交路径用例全绿（`stream-tail` 相关 mobile 用例）。
- **依赖**：**前置 rebuild core**（本文件在 `webview-host/` 下、jest 直测，不入 bundle；但 mobile jest 配置面整体依赖 dist）。
- **风险与回滚**：低。回滚：单 commit。
- **决策感知**：本条属拍板项 **#12** 的同一簇（`webview-host` 三「真源」模块的去向）。
  本条取**「删死导出」**这一侧（与 #12 默认建议「其余 7 个死导出并入 dead-backlog 批次 3」一致），
  **不做「接回去」**——`scrollTopForOffsetFromBottom` 那一个真被用的函数**不在本文件**，不在本条范围。

---

### D-206｜`apps/mobile/src/vfs/errors.ts`（整文件，4 行）

- **严重度/簇**：P3 死码 / 批次 2 / apps-mobile
- **病症**：`export {formatError, formatVfsError} from '@/errors/format-error';` 的死再导出 shim，零消费（只有自己的测试）。
- **证据**（亲核）：
  - `apps/mobile/src/vfs/errors.ts:4` `export {formatError, formatVfsError} from '@/errors/format-error';`
  - `git grep -rln "vfs/errors" -- apps/mobile` → 本文件 + `apps/mobile/__tests__/errors.test.ts`
- **修法**：删源文件（4 行）+ 删测试文件。
- **验收**：grep 归零 + mobile tsc/jest 无增量 + 净减 4 + 测试行数。
- **测试策略**：**删** `apps/mobile/__tests__/errors.test.ts`。
- **回归线**：mobile 错误格式化用例（`format-error` 本体）全绿。
- **依赖**：**随批次统一验收，不单列前置**。⚠ 本条是 4 行 shim、**不入 bundle、不吃 `dist`**，原写「依赖：前置 rebuild core」属过度声明；
  按此降级后本条**允许单条独立执行**，rebuild 只作为批次级统一验收的一部分。
- **风险与回滚**：低。回滚：单 commit。

---

### D-207｜`packages/core/src/service/kkv/index.ts`（整文件，13 行）+ `tsconfig.test.json:26`（配置连带）

- **严重度/簇**：P3 死码 + **配置连带** / 批次 2 / core-service-kkv｜**编译红风险最高的三条之一**
- **病症**：内部 KKV barrel 零 importer。**「零 importer」不等于「零消费」**——消费它的是一行 tsconfig paths 映射
  （`tsconfig.test.json:26`）**与一个吃该映射的 core 测试**（`test/package-exports-t0.test.ts:4`）；
  而该映射与 `package.json` 的 `./kkv` 子路径**指向不同的 barrel**——这正是 Wave E 新增条目
  「`tsconfig.test.json` paths 与 `package.json` exports 对齐」要修的那个不一致。
- **证据**（亲核）：
  - `packages/core/src/service/kkv/index.ts:10` `export { createKkvService } from "./create-kkv-service.js";`
  - `packages/core/tsconfig.test.json` 的 paths 段（实测第 26 行）：
    ```
    "@novel-master/core/kkv": ["./src/service/kkv/index.ts"],
    ```
  - `packages/core/package.json` 的 exports：`"./kkv": {"types":"./dist/public/kkv.d.ts","import":"./dist/public/kkv.js"}`
  - `git grep -rln -- "service/kkv/index" -- apps packages` → 仅命中 `packages/core/tsconfig.test.json`
  - ⚠ **但这条 paths 映射不是唯一消费方**：`packages/core/test/package-exports-t0.test.ts:4`
    ```
    import { createKkvService, KkvError } from "@novel-master/core/kkv"
    ```
    **也吃这条映射**（经 `@novel-master/core/kkv` 这个 bare specifier 落到 `tsconfig.test.json` 的 paths）。
    ⇒ 删掉 `:26` 而不动这个测试，它就会**失去 paths 落点**（详见修法第 3 条与 RULE:74）。
  - `src/public/kkv.ts:11-14` 是**直接**从 `create-kkv-service.js` / `kkv.port.js` / `kkv-errors.js` 转出，**不经** `service/kkv/index.ts`
    （且已导出 `createKkvService` + `KkvError`，覆盖上面那个测试的全部需求）
- **修法**（`tsconfig.test.json:26` 的去向**已裁定 = 方案 ①**，judge-r1 §C③；方案 ②「保留 barrel、撤下本条」**作废**）：
  1. 删 `packages/core/src/service/kkv/index.ts`（13 行）。
  2. 把 `packages/core/tsconfig.test.json:26` 的映射**由** `["./src/service/kkv/index.ts"]` **改指** `["./src/public/kkv.ts"]`
     ——**不是**把整行删掉。原第 2 步写的「连带删该行整行 / 选方案 ② 时不执行」属方案 ② 的表述，随方案 ② 一并作废。
  3. ⚠ 原写的「**不要**改成指向 `./src/public/kkv.ts`——把对齐留给 Wave E」**已撤销**：按 `docs/apm/RULE.md:74`，
     「paths 缺映射 ⇒ tsx 回退 node 解析、经 `node_modules` 自链加载 `dist/public/kkv.js` 旧产物 ⇒ 测试静默跑旧码」，
     而 `wave-e.md` 的 **X4.2 第 3 条**只保证「X4 本身不改动 paths」，**并不禁止 D-207 把该映射改指 public**。
     ⇒ 终裁为 **D-207 在前**：本条先改指 public、再删 `service/kkv/index.ts`；**wave-e X4 在后**，只加守卫测试、不动 paths。
  4. `packages/core/test/package-exports-t0.test.ts:4` 的 bare specifier `@novel-master/core/kkv` 由第 2 步获得**确定解析落点**
     （`src/public/kkv.ts:11-14` 已导出 `createKkvService` + `KkvError`，完全覆盖该测试需求、且不经被删的 barrel），
     **不得**留下一个失去 paths 映射的 bare specifier（那会命中 RULE:74 的静默跑旧码坑）。

<!-- judge-r1 §C③ 终裁（替代原「待 judge」注释块）——
     原 sr1-d-b.md M-1 的二选一（① 改指 `./src/public/kkv.ts` / ② 保留 barrel、只从验收里撤下本条）**已裁定**：
     取**方案 ①**，D-207 `:26` **改指 `./src/public/kkv.ts`**。方案 ② 不可取——「只删映射」命中 RULE:74 的静默跑旧码坑，
     保留内部 barrel 则两条同子路径双 barrel 的病灶留着。**D-207 的 execute-blocked 解除**，按上文修法施工；
     顺序约束与 X4 的一致性口径见 §7 修正 #3 与 §8「已裁定（judge-r1 §C③）」行。
-->

- **验收**：
  1. `tsc --noEmit -p packages/core/tsconfig.test.json` 通过（**这一条是本条的核心验收**，别只跑 `tsconfig.json`）；
  2. `tsc --noEmit -p packages/core/tsconfig.json` 通过；
  3. core 全量测试无增量（`package-exports/**` 13 份快照测试必须全绿）。
     括注订正：快照里命中的是 `main-entry-allowlist.json:20 KkvError` / `:66 isKkvError`；
     主入口 `src/index.ts:153-154` 直接从 `errors/kkv-errors.js` 转出、**不经本 barrel**
     ⇒ 删 barrel 不影响主入口。另：`package-exports-t0.test.ts` 必须**真跑**（见下方 RULE:74 风险），
     快照全绿不足以证明它没在吃 `dist` 旧码；
  4. rebuild core 后 mobile jest 无增量；
  5. 净减 **13**（源文件 13 行；`tsconfig.test.json:26` 是**改指**不是删行，配置行净减 **0**）。
     ⚠ 原写「净减 14（13 + 1 行配置）」属方案 ②（删整行）的口径，随方案 ② 作废。
- **测试策略**：**删/改**：无测试文件；改的是 `packages/core/tsconfig.test.json`（配置，非测试）。
  ⚠ `packages/core/test/package-exports-t0.test.ts` 的 import 是**隐式消费**，不被任何 grep「符号名」口径覆盖 ⇒ 必须人工点名对账。
- **回归线**：core KKV 全量测试无增量；mobile `core-shim` 相关测试（`apps/mobile/jest.config.js:59-221` 那 27 条 core 子路径映射）无增量。
- **依赖**：**前置 rebuild core**。⚠ 与 Wave E「tsconfig.test paths 对齐」条目（X4）**有顺序依赖，一律 D-207 在前、X4 在后**（judge-r1 §C③ 终裁）；两片互不改动对方负责的那一面，口径见 §7 修正 #3。
- **风险与回滚**：中（改了测试期路径映射）。
  ⚠ **最高风险 = RULE:74 明载的静默跑旧码**：若最终落地成「`:26` 删掉且 `package-exports-t0.test.ts` 未改」，
  tsx 会回退 node 解析、经 `node_modules` 自链加载 `packages/core/dist/public/kkv.js` 旧产物——
  同一测试进程 src/dist 双份代码并存，**测试照绿但验的不是新代码**（storage-cache-dedup 迭代实锤过同坑）。
  ⇒ **判据不是「tsc 过 + 测试绿」，而是「`:4` 那条 import 解析到 `src/public/kkv.ts`」**（可在测试里断言解析路径，或核对 tsx 解析日志）。
  回滚：单 commit 含「源文件 + tsconfig.test.json」两处；
  若 mobile 出现「解析到不存在的 dist 文件」类报错，**先 rebuild 再判**，不要据此回滚。

---

### D-208｜`packages/core/src/service/session-run-state/index.ts`（整文件，15 行）

- **严重度/簇**：P3 死码 / 批次 2 / core-service-session-run-state
- **病症**：内部 barrel 零 importer。`package.json` 的 `./session-run-state` 指向 `dist/public/session-run-state.js`，
  而 `tsconfig.test.json` 的映射也指向 **public**，所以本文件删掉不影响任何子路径契约。
- **证据**（亲核）：
  - `packages/core/src/service/session-run-state/index.ts:7` `export { createSessionRunStateService } from "./create-session-run-state-service.js";`
  - `packages/core/src/public/session-run-state.ts:10` `export { createSessionRunStateService } from "../service/session-run-state/create-session-run-state-service.js";`
    （**直引实现文件，不经 `service/session-run-state/index.ts`**）
  - `git grep -rln -- "session-run-state/index" -- apps packages` → **零命中**；
    `git grep -rln "create-session-run-state-service" -- packages apps` → 实现文件 + `public/session-run-state.ts` + 两个 core 测试 + `project.service.ts` / `session.service.ts`
- **修法**：整文件删除（15 行）。**不改** `tsconfig.test.json`（它的映射已指向 public，不受影响）、**不改** `package.json`。
- **验收**：① 文件消失；② core 两份 tsconfig 均通过；③ core 全量测试无增量
  （`packages/core/test/session-run-state/{session-run-state.service,session-run-state.fork-copy-guard}.test.ts` 是直引实现文件的，必须仍绿）；④ 净减 15。
- **测试策略**：无测试文件删改。
- **回归线**：`session-run-state` 族测试全绿；mobile `session-stream-unit-persist.test.ts` / `session-stream-unit-final-rate.test.ts` 无增量（依赖 `./session-run-state` 子路径）。
- **依赖**：**前置 rebuild core**（mobile 侧走子路径 → `dist`）。
- **风险与回滚**：低。回滚：单文件 revert。

---

### D-209｜`packages/core/src/types/agnai-tokenizers.d.ts`（整文件，18 行）

- **严重度/簇**：P3 死码 + **ambient declaration** / 批次 2 / core-types｜**编译红风险最高的三条之一**
- **病症**：core 内的一份 `@agnai/*` ambient declaration。真使用者是 `packages/tokenizer-driver-node`，
  它**自带一份同名 d.ts**，不依赖 core 这份。
- **证据**（亲核）：
  - `packages/core/src/types/agnai-tokenizers.d.ts`（18 行）。⚠ **证据口径修订**：
    它是 **ambient `.d.ts`，本身无任何 `export`**（原写「唯一导出 `cleanText`」**错误**）；它声明的是
    **两个**模块——`declare module "@agnai/sentencepiece-js"` 与 `declare module "@agnai/web-tokenizers"`
    （原写 `declare module "@agnai/tokenizer"` **错误**）。`packages/tokenizer-driver-node` 自带的同名副本与本文件**逐字相同**。
  - `git grep -rln "agnai" -- apps packages examples` 的命中清单：`packages/core/src/types/agnai-tokenizers.d.ts`（本文件）、
    `packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts`（driver 自带副本）、
    `packages/tokenizer-driver-node/{package.json,README.md,src/**}`、
    `packages/tokenizer-driver-rn/{android/**/TokenizerEngine.kt,src/count-prompt-llm-input.ts}`、
    `apps/mobile/metro.config.js`（**需核**）
  - **`packages/core/**` 内零 `@agnai/*` import**（撰写轮逐条 grep 确认）
- **修法**：整文件删除（18 行）。删前**必跑** `tsc -p packages/core`：它是 ambient declaration，
  靠 `tsconfig.json:12` 的 `include: ["src/**/*"]` 进编译面。
- **验收**：
  1. `tsc --noEmit -p packages/core/tsconfig.json` 通过（**删 ambient d.ts 的唯一硬门**）；
  2. `tsc --noEmit -p packages/core/tsconfig.test.json` 通过；
  3. core 全量测试无增量（tokenizer 域是本条的最大风险面）；
  4. rebuild core 后 mobile jest 无增量（mobile 通过 `@novel-master/nmtp` 间接触达 tokenizer 驱动）；
  5. 净减 18。
- **测试策略**：无测试文件删改。
- **回归线**：`packages/core/test/infra/tokenizer/**` 全绿；`tokenizer-driver-node` / `tokenizer-driver-rn` 两包的构建与测试无增量
  （⚠ 它们**自带** d.ts，不吃 core 这份——但如果某个 driver 的 `tsconfig` 通过 workspace 引用 core 的 ambient，删了会红，**这一条是本条的主要回归面**）。
- **依赖**：**前置 rebuild core**（RULE：「改 dist 消费的包必须重建 dist」）。
- **风险与回滚**：中（ambient 声明的消失是全局编译面事件）。回滚：单文件 revert。

---

### 批次 2 小结

| 项 | 值 |
|---|---|
| 条目数 | 9（D-201 ~ D-209） |
| 标称净减 | 248 行（`wc -l` 口径） |
| 实际净减（含测试/mock/配置行） | 239 行源文件 + 测试与 `jest.mock` 块；`tsconfig.test.json` **1 行改指**（净减 0，见 D-207 验收第 5 条） |
| 删/改的测试文件 | 改 7（D-201 × 6、D-202 × 1）；删 4（D-203、D-204、D-205、D-206） |
| 编译红风险最高 | D-207（改 paths）、D-209（删 ambient d.ts） |
| 硬前置 | **`npm run build -w @novel-master/core`（rebuild 之前 mobile 失败不可归因）** |

---

## 4 · 批次 3 · 批量操作规程（348 + 17 符号级）

> **本节不逐条写七要素**（348 条逐条写等于把 spec 写成 L0 表的复制品，且 `L0/dead-exports.md` 自身桶定义有缺陷——修复步骤见 §4.9）。
> 本节写**机械流程 + 抽检规则 + 三组新目标的逐条七要素**。

### 4.1 清单来源与可信度分级

| 来源 | 内容 | 用法 |
|---|---|---|
| `synth/dead-backlog.md` 附录 A（人读表） | 363 条 C 类按四档动作分列 | **主清单**（人读），但**★1 拍板前只作线索、不进首批**——A.3「删 barrel 转发行」抽样 11 条里 **6 条落在快照锁定面**：`executeTemplate`（`main-entry-allowlist.json:60`）、`parseUrl`（`:78`）、`DEFAULT_HIDE_START_DEPTH`（`public-compaction-allowlist.json:3`）、`layoutHasWorkplace`（`public-prompt-allowlist.json:13` + `public-workplace-allowlist.json:17`）、`messageBodyTextFromBlocks`（`public-prompt-allowlist.json:15`）、`formatApplicationModelId`（`public-provider-allowlist.json:42`） |
| `tmp/w3c/tierC.json` → `.confirmed[]` | 同 363 条的机读版（`{file,name,kind,extra}`） | 可用则用它驱动批量脚本；**该目录被 `.gitignore` 覆盖、不在版本库**，缺失时**不得**因此跳过条目，改按附录 A 施工 |
| `L0/dead-exports.md` | 1317 零消费桶 + 26 suspect + 580「仅测试」 | **只作线索源**（结论不变，理由已更新）。~~`testOnly` 桶（`tmp/l0census/dead-exports.mjs:197`）**未排除** `relayed`~~：该缺陷由 **§4.9 F-synth-dead-1** 修正并重跑（127/356 = 35.7% 实为 barrel 转发的生产消费）；但**重跑后仍只作线索源**——快照面（F-synth-dead-2 / ★1）与 barrel 转出侧各有独立约束 |
| `tmp/w3c/delete-list.md` | 530 行逐文件清单，含「测试引用」与「⚠ barrel 泄漏」标记 | 辅助（同样在 `.gitignore` 内） |
| `tmp/w3c/Alist.md` | A 类快照锁定 173 条 / 81 文件 | **禁区清单**（★1 未拍板前禁碰） |

**扣除已先行施工的 15 条 / 6 文件**（D-113、D-114、D-115、D-207、D-208、D-209）⇒ 剩余 **348 条**。
⚠ **348 这个数含待出批项**：§4.3 第 3 步（快照命中 ⇒ 该条出批）会在执行时削掉其中一部分，抽验已实测 A.3 档 6/11 落快照面
⇒ **该清单在 ★1 拍板前不可直接当施工单用**，实际可施工条数会明显少于 348。

### 4.2 前置门（★1 / ★3 未拍板前，批次 3 一律 blocked）

| 门 | 内容 | blocked 范围 |
|---|---|---|
| **★1** | 快照锁定面 A 类 173 条（value 74 + type 99）的去留 | 全部 348 条里**只要动作会改到 `packages/core/test/package-exports/snapshots/*.json` 命中的符号**，或改到 `src/public/**` 的 barrel，都 blocked |
| **★3** | `config-forms/shared/{depth-slice,application-model-id}.ts` 与 `domain/**` 的同名同签名双份是不是「迁移残留」 | D-316 及其 barrel 转发行（`config-forms/shared/index.ts` 的 4 个转发 + `config-forms/agent/index.ts` 的 3 个转发）blocked |
| **★2** | `D-311 resolveLatestReleaseFromList`（**保留**，`docs/Iterations/about-and-update-check/spec.md:187` 明写「预留」）/ `D-314 AgentSession.hideRange`（可删，`verify-dead` §5 #2 已证那条「intentional 注释」在代码里不存在） | D-311 / D-314 两条（B3-d 内）。⚠ 只读 §4 的施工者容易以为 D-311 可直接删，**它必须保留** |
| **快照锁（非拍板，构造型）** | `D-315` 命中 `main-entry-allowlist.json` ⇒ 该条受快照锁约束 | D-315 单条 blocked，**不需要用户拍板**（快照红是客观事实），与其他 A 类条目同门 |
| 构造性前提（非拍板） | 任何一批删除后，13 份快照测试必须全绿 | 硬门，不满足即回退该条 |

**★1 解锁的硬门槛（台账原文，不得省略）**：判「无仓外 TS 消费者」⇒ 解锁 A-type 99 条进批次 3，
**但解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`**（W5–W11 均未执行过这三项，是全迭代唯一未解除的硬门槛）。
撰写轮已知的实跑事实（`verify-dead` §5 #1）：全仓 13 个包全部 `private: true` + `version: 0.0.0`、无 `publishConfig`，
`.github/**` 与 `scripts/**` 里 `npm publish` 零命中、发布只走 GitHub Release（APK/EXE/DMG）——
这是「结构上没有仓外 TS 消费者」的硬证据，但**不替用户拍板**。

### 4.3 删除的机械流程（每批照此八步，不得跳步）

1. **取批**：从附录 A 按动作档取下一批（档位与条数见下表）。
2. **命中检查**（每条必做）：对本批每个符号名跑
   `git grep -rn -w -e "<符号>" -- apps packages examples scripts .github`
   并把输出存进提交信息。**判据 = 「定义处以外的命中数 > 0 ⇒ 该条出批」**：
   - **定义处**：该符号在其**定义文件内**的声明行（`export` / `declare` / 类型别名 / 函数头那一行）。
     任何符号在自己的定义行必然命中，所以**必须先减去定义处命中**，否则 348 条会**全部**在此出批、规程原地自锁。
   - 减完仍 > 0 的命中即**消费方**（哪怕只在注释里——注释命中单独记「连带注释清理」项）。
   - 记录时**同时写下「定义处命中数」与「定义处以外命中数」两个数**（§4.5 抽检与 §4.8 记录表都用这两个口径）。
   - **§4.5 抽检与本步用同一判据**：所谓「命中消费方」= 定义处以外的命中。两处口径不得各写一套。
3. **快照检查**：对每个符号跑 `grep "<符号>" packages/core/test/package-exports/snapshots/*.json`。
   **命中 ⇒ 该条出批**（A 类，★1 未拍前禁删）。
4. **删除**：按动作档执行（摘 export / 删转发行 / 删符号段）。**摘 barrel 转发行时必须同批删中间 barrel 里的那一行**，
   `delete-list.md` 里带 `⚠` 的 21 条是 barrel 泄漏，逐个核对（否则 barrel 编译红）。
5. **单批验收门**（见 4.4）。
6. **提交**：`git diff --stat` 核对净减行数是否落在该档预估区间；**提交前跑 `git diff -U0 | findstr "^@@"` 过一遍 hunk 头**
   （RULE：编辑器旧缓冲回写 + `prettier --write` 重排无关行两个坑都要靠这一步抓）。
7. **对账**：把本批「出批条目 / 实际删除 / 净减行数」写回本节末尾的批次记录表。
8. **下一批**：上一批四域 tsc + 三包测试 + 快照测试全绿才开下一批。**任一红 ⇒ 停下报告，不许「下一批一起修」。**

### 4.4 单批上限与验收门

| 子批 | 动作 | 条数 | 文件数 | 物理行删除 | 单批硬上限 |
|---|---|---|---|---|---|
| **B3-a** | 只摘 `export` 关键字（符号在定义文件内活着） | 255 | 156 | 0 | **≤25 符号 / ≤10 文件** |
| **B3-b** | 删 barrel 转发行 | 53 | 16 | ≈112 | **≤8 文件**（转发行高度耦合，宁少勿多） |
| **B3-c** | 整段删除符号本体 | 40 | 30 | ≈166 | **≤8 符号 / ≤6 文件** |
| **B3-d** | apps/core 级联 + 去 export（**D-302 / D-304 + D-305~D-317 共 15 条**）<br>⚠ ID 范围：`D-305~D-317` 只有 13 条，另两条是 **D-302 / D-304**（按 ID 范围取批会漏掉这两条 ★4 通道） | 15 | — | ≈108 | **≤5 条**（每条都要人工核对 IPC 四处 / 跨端一致性） |
| | **合计** | **348 + 17** | — | **≈386** | **单批 diff 硬上限 400 行** |

> **合计口径订正**：原稿写「348 + 15」，与本节标题「348 + 17」、`ledger-v2.md` §10 Wave D（「3.1 core 符号级 348 条；3.2 级联 **17 条**」）、
> `SPEC.md` §2（「批次 3（348+**17** 符号…）」）三处冲突。**裁定：合计 = 348 + 17**。
> 15 是 B3-d 这个子批的条数（17 条级联里 D-301 已移入 §5.3、D-303 已移入 §5.4），不是总合计。
>
> **B3-d 的 15 条逐条 blocked 标记**（⚠ 只读 §4 的施工者以为它们都能直接删）：
> `D-302` / `D-304` = `blocked-by-decision(★4)`；`D-311` / `D-314` = `blocked-by-decision(★2)`；
> `D-316` = `blocked-by-decision(★3)`；`D-315` = 快照门槛（`main-entry-allowlist.json` 锁定）；其余 7 条无拍板依赖。

- 上限取「条数上限」与「400 行 diff」双约束的**小者**。
- **单批验收门 = §1 的四域 tsc + 三包测试 + 13 份快照测试全绿**，判增量对照 `baseline.md`。
  **必须同时记录三包「测试收集数」并与 §1.2 的分母（core 3126 / desktop 628 / mobile 1739）比对**——
  零收集守卫至今未装（`baseline.md` §6 提醒 4），收集数异常下降没人会报错，只能靠人记。
- B3-b 额外门：**rebuild core 后**再跑 mobile 测试（子路径 barrel 变更会影响 `dist/public/**`）。

### 4.5 抽检规则（每批抽 3 条人工验证零消费）

- 每批**开工前**抽 3 条（建议：1 条来自改动面最大的文件、1 条来自带 `⚠ barrel 泄漏` 标记的文件、1 条随机），
  人工跑第 4.3 节的第 2、3 步检查（第 2 步必须按 §4.3 的**定义处以外命中**口径跑，不可用旧「命中 > 0」口径），
  **把原始 grep 输出贴进提交信息**。
- **判定阈值（写死，否则抽检落不了地）**：抽中的 3 条必须**同时**满足
  ① **定义处以外的命中数 = 0**；② **13 份快照对 3 个符号名的命中数 = 0**。
  两条都满足 ⇒ 判「零消费」；任一条不满足 ⇒ **整批停止**，该条出批，其余条目重新过一遍命中检查（怀疑清单生成口径有系统性偏差）。
- 每批结束前再抽 3 条做**事后复核**（同一批里另 3 条），确认「删完没有留下悬空 re-export」。
- 抽检记录进 §4.8 批次记录表（抽中的符号名 + **定义处命中数** + 定义处以外命中数 + 快照命中数 + 结论 + 是否出批）。

### 4.6 高杠杆文件清单（B3-a / B3-b 优先批，杠杆最大）

`infra/tokenizer/index.ts`（摘 13 / 转出 35 行 ⚠ 争议 #6 已由 `verify-dead` §5 #6 结清：13 条全 NOT-IN-SNAPSHOT，可删）、
`domain/tool/builtin/curl-tool.ts`(8)、`domain/tool/logic/format-tool-output.ts`(8)、`infra/tdbc/index.ts`(8/9)、
`service/session-kkv/index.ts`(8/10)、`domain/tool/builtin/skill-tool.ts`(7)、`infra/cloud-sync/impl/cloud-sync-coordinator.ts`(7，含 4 个 `__reset*ForTests`)、
`infra/sksp/index.ts`(7/8)、`config-forms/agent/index.ts`(转出 8)、`bootstrap/schema-migrations/index.ts`(6)、`infra/nmtp/index.ts`(6)。

**连带测试密度最高的文件**（删除前必须先读对应测试）：`domain/chat/model/message.ts`(+33 个测试文件)、
`errors/tool-errors.ts`(+10)、`domain/chat/model/message-attachment.schema.ts`(+8)、
`config-forms/agent/agent-editor-state.ts`(6 + 2 测试)、`bootstrap/schema-migrations/index.ts`(7 个测试)。

> ⚠ **上表两个 barrel 文件在 ★1 拍板前只作线索、不进 B3 首批**（抽验实锤，与上句所引的 `verify-dead` §5 #6「13 条全 NOT-IN-SNAPSHOT」至少一条不成立）：
> - `infra/tdbc/index.ts`——9 个转出里 `executeTemplate`（`:23` 转出 + `packages/core/src/index.ts:37` 根 barrel 消费）与
>   `parseUrl`（`:14` 转出 + `packages/core/src/index.ts:31` 根 barrel 消费）都被**根 barrel 消费且落快照**
>   （`main-entry-allowlist.json:60/:78`）；同 barrel 的 `TdbcErrorCode` / `ParsedTdbcUrl` 也经 `index.ts:40-50` 落到根导出面
>   ⇒ 删这四行不是「删死代码」，是「删根导出面」，★1 前禁碰。
> - `infra/tokenizer/index.ts`——`TOKEN_COUNTER_MODE_PREF_KEY` 命中 `public-provider-allowlist.json:19`
>   且被 `public/provider.ts:213` 转出 ⇒ 「摘 13 全 NOT-IN-SNAPSHOT」对这一条**不成立**。

### 4.7 三组新目标 · 逐条七要素

---

#### 目标① · `AgentDefinitionEditorForm.tsx`（1048 行）— **与 D-102 同对象，本节只做登记口径**

- **严重度/簇**：P2 死码 / apps-desktop / **ledger §10 在 Wave D 的批次 1 与批次 3 两处重复登记了同一个对象**
- **病症**：1047 行智能体定义编辑表单全仓零引用（详见 §2 的 D-102 完整七要素）。
- **证据**：见 D-102（`AgentDefinitionEditorForm.tsx:176` + 全仓 grep 零命中）。
- **修法（口径裁定）**：**只做一次，归批次 1 的 D-102**。批次 3 的「新增三组目标 ①」在本分片中**登记为 D-102 的引用**，
  不重复施工、不重复计入行数（否则 2236 与 ≈386 两处对账都会多算 1047 行）。
- **验收**：以 D-102 的验收为准。⚠ 其中验收① 的 grep 口径是 `apps packages examples scripts` 四域（`src` 侧零 importer 即算过）；
  **`docs/` 侧另有 20 个文件历史提及**本符号（迭代文档 + `docs/apm/memory/` 6 篇）——**历史文档提及不算引用，不在范围、不需改**，
  施工者不必去动那 20 个文档。
- **测试策略**：同 D-102（无）。
- **回归线**：同 D-102。
- **依赖 / 风险与回滚**：同 D-102。
- **若用户拍板改接线**：本条从批次 1 撤下、连同 §2 D-102 一起移出 Wave D，改由 Wave E 承接「把 `AgentEditorView` 迁到它」的接线工作。

---

#### 目标② · webbridge 死协议 `messagePatch` / `log` + `menu-overlay-guards.ts` + 两个「死常量」— **拍板项 #12 的落地**

- **严重度/簇**：P2 死码 / apps-mobile（WebView 桥 + webview-host）／**拍板项 #12 的默认建议案**
- **病症**：四处死代码：
  1. `messagePatch` 协议项——只在类型联合里声明，**无发送方、无处理方**；
  2. `log` 协议项（transcript + rich-document 各一处）——同上；
  3. `menu-overlay-guards.ts` 整个文件——自称「真源」但生产零消费，谓词被 webview 侧内联重写；
  4. 两个数值常量——**撰写轮修正：只有一个是死的**（见下）。
- **证据**（亲核）：
  - `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:189`
    ```
      | BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
    ```
  - `apps/mobile/src/components/chat/ChatTranscriptBridge.ts:254` `      'log',`（`TranscriptToHostMessage` 联合成员）
    `apps/mobile/src/components/vfs/RichDocumentBridge.ts:88` 同形（`RichDocumentToHostMessage` 联合成员）
  - 全仓 `git grep -rn "messagePatch" -- apps packages` ⇒ **只有上面那 1 处类型声明 + 2 处注释**
    （`web/composer-input/webview/runtime/bridge.ts:67` 与 `runtime/model.ts:6` 的注释里提到「log/messagePatch 类死消息」）；
    `git grep -rn "case 'log'\|=== 'log'"` ⇒ **零命中**（无处理方）；web 侧无 `post('log', …)`（无发送方）。
  - `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts:13`
    ```
    export function shouldCancelLongPressForMove(
    ```
    `git grep -rln "menu-overlay-guards\|shouldCancelLongPressForMove\|shouldIgnoreMenuOutsideDismiss" -- apps packages`
    ⇒ **只有本文件 + `apps/mobile/__tests__/menu-overlay-guards.test.ts`（3 个 it）**，生产零消费。
  - **退役的直接出处**：`apps/mobile/src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts:4`
    ```
     * 消息菜单由气泡右上角 ⋯ 触发（`openContextMenuFromAnchor`），不再绑定长按开菜单。
    ```
    ⇒ 「长按开菜单」是**已退役**路径，不是待接线路径。`docs/apm/RULE.md` 的「批注（annotate）」条目记载的是
    **Android 小米/HyperOS 上划词菜单不可用、用户拍板 hold**，属同一「长按/划词菜单」族，可作旁证，
    但**不是**「webview 长按开菜单退役」的直接决策记录 —— spec 引用时须按此措辞，不得把 RULE 写成直接出处。
  - **常量口径修正（撰写轮亲核，与台账「连带两个死常量」的表述不同）**：
    - `LONG_PRESS_MOVE_TOLERANCE_PX`（`apps/mobile/src/web/shared/constants.ts:13`）——
      消费者只有 `menu-overlay-guards.ts:6/:10/:16` 与它自己的测试 ⇒ **删掉 menu-overlay-guards.ts 后成死，可删**。
    - `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`（`apps/mobile/src/web/shared/constants.ts:21`）——
      **不是「只在死文件里」**：它还被 `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts:12`
      **再导出**（该文件是活的，`web/chat-transcript/webview/runtime/menu/menu.ts` 在 import 它的布局函数）。
      但 `anchored-menu-layout.ts` 的 import 块（`:20-30`）与函数体**都没有引用它** ⇒ 它是**经再导出链的死值**。
      ⇒ 处置必须是「删 `constants.ts:20-21` **且** 删 `anchored-menu-layout.ts:12` 的那一行再导出」，**只删一处会编译红**。
    - **反向守卫**：`MENU_OPEN_GRACE_MS`（`constants.ts:10`）是**活的**——
      `web/chat-transcript/webview/runtime/menu/menu.ts:1` `import {MENU_OPEN_GRACE_MS} from '@web/shared/constants';`
      与 `:199` `Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS`，另有
      `apps/mobile/__tests__/chat-transcript-boot-script.test.ts:17/:93/:261` 三处断言。**严禁跟着删。**
      ⇒ 台账「语义被手写内联在 `menu.ts:194-202`」的表述**只对谓词成立**，常量是 import 的；照台账原话施工会误删 `MENU_OPEN_GRACE_MS`。
- **修法**：
  1. 删 `ChatTranscriptBridge.ts:189` 的 `messagePatch` 联合成员（1 行）。
  2. 删 `ChatTranscriptBridge.ts:253-256` 的 `log` 联合成员（4 行）与 `RichDocumentBridge.ts:87-90` 的 `log` 联合成员（4 行）。
  3. 删 `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` 整个文件（35 行）
     + 删 `apps/mobile/__tests__/menu-overlay-guards.test.ts`（55 行，3 个 it）。
  4. 连带删 `apps/mobile/src/web/shared/constants.ts:12-13`（`LONG_PRESS_MOVE_TOLERANCE_PX`）**与** `:20-21`（`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`）。
  5. 连带删 `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts:12` 的再导出行。
  6. **同步清理注释**：`web/composer-input/webview/runtime/bridge.ts:67` 与 `runtime/model.ts:6` 里提到「log/messagePatch 类死消息」的注释，
     改成不再引用已删协议项的表述（或直接删该句）——否则留下一条指向不存在协议的注释。
  7. **不做**：把 webview 侧的内联谓词改成 import 共享真源（拍板项 #12 的「接回去」方案）。理由：功能已由
     `bind-shell-events.ts:4` 记录的 ⋯ 按钮路径承担，长按路径已退役，接回去等于给一条死路径接活。
- **验收**：
  1. `git grep -rn "messagePatch" -- apps packages` 归零（除清理后的注释）；
  2. `git grep -rn "'log'" -- apps/mobile/src` 归零；
  3. `LONG_PRESS_MOVE_TOLERANCE_PX` / `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 全仓归零；**`MENU_OPEN_GRACE_MS` 仍在且 3 处 boot-script 断言仍绿**；
  4. mobile tsc + jest 无增量；**bridge 协议测试全绿**（`chat-transcript-bridge.test.ts`、`rich-document-bridge.test.ts`、
     `web-host-message.test.ts`、`chat-transcript-boot-script.test.ts`）；
  5. **rebuild core 后**重跑 webview 侧用例（`webview-host` 属 Jest 直测面，不入 bundle，但仍按纪律跑）；
  6. 净减：35 + 55 + **5**（两个常量：`constants.ts:12-13` 2 行 + `:20-21` 2 行 + `anchored-menu-layout.ts:12` 1 行） + 9（两处协议联合成员） = **104 行**。
     ⚠ 原写「9（两个常量的注释+声明）」是笔误（漏算 `anchored-menu-layout.ts:12` 的再导出行、又把 4 行常量写成 9 行）。
- **测试策略**：
  - **删**：`apps/mobile/__tests__/menu-overlay-guards.test.ts`（3 个 it）。
  - **改**：`apps/mobile/src/components/chat/ChatTranscriptBridge.ts`、`apps/mobile/src/components/vfs/RichDocumentBridge.ts`（删协议成员）。
  - **不改**：`apps/mobile/__tests__/chat-transcript-bridge.test.ts` 与 `rich-document-bridge.test.ts`
    （撰写轮核实：两个测试文件**零引用** `log` / `messagePatch`，删协议成员不影响它们）。
- **回归线**：mobile WebView 桥全部用例全绿（尤其 `chat-transcript-boot-script.test.ts` 的 `MENU_OPEN_GRACE_MS` 三处断言、
  `code-copy.test.ts`、`message-action-menu.test.tsx`、`anchored-menu-layout{,-parity}.test.ts`）——
  菜单与锚定布局是本条的邻接面，**必须保持绿**。
- **依赖**：**★12 是拍板项但本条按其默认建议案撰写**（默认建议 = 「接回 `scrollTopForOffsetFromBottom` 一个，其余 7 个死导出并入 dead-backlog 批次 3」），
  故本条**不阻塞**；但若用户改拍「全部接回去」，本条整条作废、改走接线工作。
  另：`scroll.ts` 里的 `scrollTopForOffsetFromBottom`（真被用）**不在本条范围**。
- **风险与回滚**：中（协议类型面 + 两个跨端共享常量）。
  - 风险 1：删 `MENU_OPEN_GRACE_MS`（误判）会直接改变「长按后 touchend 不关闭菜单」的宽限行为 ⇒ 已用「反向守卫」条锁死。
  - 风险 2：`anchored-menu-layout.ts:12` 只删常量不删再导出 ⇒ `tsc` 红；两处必须同批。
  - 回滚粒度：一个 commit（6 个文件）；出问题时整 commit revert。

---

#### 目标③ · `validate-prompt-blocks.ts` + `PromptBlock` / `PromptBlockRole` 联合类型

- **严重度/簇**：P2 死码 / core-domain-prompt
- **病症**：`validate-prompt-blocks.ts`（178 行）把 YAML 解析出的 block 映射校验成 `PromptBlock[]`，
  但**生产侧零消费**——现行 prompt 布局走的是 `validate-agent-prompt-layout.ts`（`validateAgentPromptLayout` 家族）。
  唯一消费者是它自己的测试（215 行 / 13 个 it）。
- **证据**（亲核）：
  - `packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts:144` `export function validatePromptBlocksFromMap(`
    （`:177-178` 有 `@alias` 的 `validatePromptBlocks`）
  - `git grep -rn "validate-prompt-blocks\|validatePromptBlocks" -- apps packages`
    ⇒ `src` 侧只有本文件；其余全是 `packages/core/test/prompt/validate-prompt-blocks.test.ts`（13 个 it）
  - `packages/core/src/domain/prompt/model/prompt-block.ts:14` `export type PromptBlock =`
    `git grep -rn "PromptBlock\b" -- packages/core/src` ⇒ **`PromptBlock` 的唯一消费者就是 `validate-prompt-blocks.ts`**
    （`agent-prompt-layout.ts:80` 只是 JSDoc 里的 `{@link PromptBlock}` 提及）
  - `PromptBlockRole`（`prompt-block.ts:8`）⇒ 消费者同上四个点（`validate-prompt-blocks.ts:11/:14/:36/:86/:98`）
  - ⚠ **`PromptBlockLifecycle`（`prompt-block.ts:11`）仍活着**：
    `validate-agent-prompt-layout.ts:14` `import type { PromptBlockLifecycle } from "../model/prompt-block.js";`
    与 `agent-prompt-layout.ts:7` `import type { PromptBlockLifecycle } from "./prompt-block.js";`
    ⇒ **不能整文件删**，这是台账与 SPEC 都点名的红线。
- **修法**（三步，**顺序不可换**）：
  1. 删 `packages/core/test/prompt/validate-prompt-blocks.test.ts`（215 行，13 个 it）。
  2. 删 `packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts`（178 行）。
  3. 从 `packages/core/src/domain/prompt/model/prompt-block.ts` **摘掉** `PromptBlockRole`（`:7-8`）与 `PromptBlock`（`:13-26`），
     **保留** `PromptBlockLifecycle`（`:10-11`）与模块头（`:1-5`）。摘掉的 `:7-8`（2 行）+ `:13-26`（14 行）= **16 行**
     ⇒ 文件因此从 26 行缩到 **10 行**，**文件本身不删**。
  4. 顺带把 `agent-prompt-layout.ts:80` 的 JSDoc `{@link PromptBlock}` 改成指向 `AgentPromptLayout`，
     免得留下指向已删类型的文档链接。
- **验收**：
  1. `git grep -rn "validatePromptBlocks\|PromptBlockRole" -- apps packages` 归零；
  2. `git grep -rn "PromptBlockLifecycle" -- packages` **仍命中 2 处 import**（证明红线没踩）；
  3. `tsc --noEmit -p packages/core/tsconfig.json` 与 `-p tsconfig.test.json` 均通过；
  4. **13 份快照测试全绿**——撰写轮已核实 `PromptBlock` / `PromptBlockRole` / `validatePromptBlocks`
     **均不在** `public-prompt-allowlist.json` 的 22 个名字里，且 `public/prompt.ts` 不转出 `prompt-block.js`
     （`git grep "prompt-block" -- packages/core/src/public` 零命中）⇒ 快照面中性；
  5. core 全量测试无增量（重点：`test/prompt/**` 整族 + `test/package-exports/**`）；
  6. rebuild core 后 mobile jest 无增量（mobile 有 30+ 条走 `dist/**`）；
  7. 净减 = 215（测试）+ 178（源）+ **16**（`prompt-block.ts` 摘掉的 2 + 14 行）= **409 行**（修法第 4 步那行 JSDoc 是改写、不计行数）。
- **测试策略**：
  - **删**：`packages/core/test/prompt/validate-prompt-blocks.test.ts`（13 个 it）。
  - **改**：无其它测试（13 个 it 全部围绕被删函数）。
  - **新增**：无。⚠ **不要**为「删掉了一整套校验」补新测试——活着的等价物是
    `validateAgentPromptLayout` 家族，它已有自己的测试；补测试等于给死路径续命。
- **回归线**：`packages/core/test/prompt/**` 除被删文件外全绿；`validate-agent-prompt-layout` 族测试全绿
  （它们是本条删除后**唯一**的 prompt 布局校验防线，必须确认它们在位且全绿）。
- **依赖**：无拍板依赖（不在 A 类快照面、不在 ★3 的 `config-forms/shared` 范围）。
  ⚠ 与 Wave B 的 **N-P1-02**（`normalizeAgentPromptLayout` 白名单补 `skillsEnabled`/`skillsPrefix`）**不同文件、无顺序依赖**，
  但两者都动 prompt 布局的**校验完整度**——若同波施工，须在提交信息里写明
  「删的是 `PromptBlock` 这条已退役的校验路径，活着的 `validateAgentPromptLayout` 由 N-P1-02 加固」，避免评审误判为「把校验删了」。
- **风险与回滚**：中（删掉一整套运行时校验 + 215 行测试）。
  - 风险 1：**误把 `prompt-block.ts` 整文件删掉** ⇒ `PromptBlockLifecycle` 的两个 import 编译红（验收第 2 条就是抓这个）。
  - 风险 2：以为「prompt 布局少了一层校验」是缺陷——不是，活着的校验在 `validate-agent-prompt-layout.ts`，RULE 与本条均已对齐。
  - 回滚粒度：一个 commit（3 个源/配置文件 + 1 个测试文件）。

---

### 4.8 批次 3 施工记录表（施工时填）

| 批号 | 子批 | 抽检 3 条（符号名） | 定义处命中数 / 定义处以外命中数 | 快照命中数 | 命中/出批 | 实际删除符号数 | 净减行数 | tsc 增量 | 测试增量 | 收集数（对照分母） | 快照 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| （待填） | B3-a | | | | | | | | | | | |

---

### 4.9 F-synth-dead-1｜L0 死导出普查的「仅测试消费」桶定义缺陷（**量 S**，重跑型条目）

> **本条是批次 3 的数据地基，不是死码删除条目**——它不改一行业务代码，只改普查脚本一行 + 重跑 + 回写 L0 产物。
> 归 `wave-d.md`，因为批次 3 的 348 条主清单、§4.1 的可信度分级、批次 1 小结里 `resolveSubagentSessionId`
> 的「仅测试消费」归类，三处**都把它当前提**在用，而本文件此前只写了口径注记、没有写施工步骤
> （judge-r1 R2-9：`ledger-v2.md:180` 半落位）。**量 S，不阻塞批次 1 / 批次 2。**

- **严重度/簇**：P1 数据地基缺陷 / dead-backlog / L0 普查产物（`ledger-v2.md:180`；发现报告 `synth/dead-backlog.md:75`、`raw/w3-xc-dead-core.md:67`）
- **病症**：L0 普查把「仅测试消费」定义为「生产零消费、测试有消费」，**漏掉「生产侧经 barrel 转发消费」这条边**。
  `relayed` 边（经 `export {} from` 传递消费）的终点被记成 `R:<re-export>` 而不是 `P:<importer>`，
  于是「生产侧经 `public/**` barrel 消费 + 测试侧直接 import 源文件」的符号，`prod` 数组是空的
  ⇒ **被误判进「仅测试消费」桶**。后果：该桶 35.7% 的行若被当成删除清单，会删掉**有生产消费方**的导出。

  判定式（`tmp/l0census/dead-exports.mjs:197` 原文）：
  ```js
  const testOnly = rows.filter((r) => r.prod === 0 && r.test > 0);
  ```
- **证据**（本轮亲核；机读计数因脚本缺失不可复跑，见「风险」）：
  - **机理逐行实证**（三条代表符号，链路已追到 `file:line`）：
    | 符号 | 定义处 | barrel 转出（`relayed` 边） | 真实生产消费方 |
    |---|---|---|---|
    | `formatContextUsageLabel` | `packages/core/src/common/format-token-count.ts:78` | `packages/core/src/public/provider.ts:145` | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:34`、`apps/mobile/src/services/chat-prompt-tokens.service.ts:33` |
    | `ChatError` | `packages/core/src/errors/chat-errors.ts:13` | `packages/core/src/public/chat.ts:1` `export { ChatError } from "../errors/chat-errors.js";` | `apps/cli/src/cli-errors.ts:13`、`apps/mobile/src/errors/format-error.ts:8` |
    | `createAgentAbortRegistry` | `packages/core/src/service/agent/create-agent-abort-registry.ts:16` | `packages/core/src/public/agent.ts:44` | `apps/desktop/src/main/runtime/create-desktop-runtime.ts:8`、`apps/mobile/src/runtime/create-mobile-runtime.ts:8` |
    ⚠ **`dead-backlog.md:95` 把后两个写成 `create-desktop-runtime.ts:8` / `create-mobile-runtime.ts:8`（缺目录）**，
    真实路径带 `runtime/` 一层，照抄 grep 会零命中。
  - **产物分桶实况**（`L0/dead-exports.md`，本轮重新数过行）：摘要表 `:16` 写「仅被测试消费 580」；
    §三 表体 `:1376-1955` 实为 **580 行**，其中 `packages/core/**` **356 行**（去重后 **348 个符号**）；
    §一 `:23-1339` 实为 **1317 行**，其中 core **617 行**；§二 `:1345-1370` 实为 **26 行**（与摘要一致）。
    ⇒ 摘要与表体自洽，**桶的错不在计数，在定义**。
  - **快照面抽样行号逐条核对通过**（A.3 档「删 barrel 转发行」抽样的 6 个符号，全部命中且行号与 `raw/sr1-d-c.md:193-198` 一致）：
    `main-entry-allowlist.json:60 executeTemplate` / `:78 parseUrl` / `:3 DEFAULT_HIDE_START_DEPTH`（`public-compaction-allowlist.json`）
    / `:13 layoutHasWorkplace` + `public-workplace-allowlist.json:17` / `:15 messageBodyTextFromBlocks`（`public-prompt-allowlist.json`）
    / `:42 formatApplicationModelId`（`public-provider-allowlist.json`）。
    ⚠ 台账的「core 确认死 617 中 **173** 条落快照锁定面 / **81** 文件」是 `tmp/w3c/` 的机读口径，
    **该目录随 `tmp/` 一起不在工作树，本条不复核此数**（它属 F-synth-dead-2 / ★1 的口径，不属本条）。
  - **已知污染面不止 §三 一张表**：抽验已证明同一缺陷在 `synth/dead-backlog.md` 附录 A 的 **A.2（整段删除）与
    A.3（删 barrel 转发行）两档同时复现**（`raw/sr1-d-c.md:170`、`:242`）⇒ **重跑后必须重新分桶，不只是重排 §三**。
- **修法**（三步，缺一不可）：
  1. **改判定式一行**：`tmp/l0census/dead-exports.mjs:197` 的 `testOnly` 改为
     `rows.filter((r) => r.prod === 0 && r.relayed === 0 && r.test > 0)`。
  2. **重跑 L0，并按新桶重新分桶**：`node tmp/l0census/dead-exports.mjs`（`L0/dead-exports.md:4` 声明的可复跑命令）。
     预期 core「真仅测试」从 356 降到 **356 − 127 = 229 行**（127/127 全部是 barrel 转发路径，直接 import 的漏判 = 0）。
     同一次重跑要重新产出 A.2 / A.3 两档的分桶结果，**不得**只刷新 §三 表。
  3. **回写 L0 产物**：`L0/dead-exports.md` 的摘要表（`:16` 的 580）**与 §三 表体（`:1376-1955`）必须同批更新**，
     并在 §五「方法与已知局限」（`:2515-2523`）补一条口径注记——「§三 表的定义已排除 `relayed`；本表**不等于**删除清单」。
     连带检查并同步：`L0/coverage-matrix.md`（同一 `tmp/l0census/` 产物族，`ledger.md:142` 要求同批更新）、
     `synth/dead-backlog.md:350` 的依赖行（该行已写「F-1 桶定义修复；**修完必须重跑 L0** 才能使用『仅测试』表」，与本条一致，保留）。
- **验收**：
  1. **桶定义断言**：`grep -n "const testOnly" tmp/l0census/dead-exports.mjs` 的返回值含 `r.relayed === 0`；
  2. **重跑成功**：`node tmp/l0census/dead-exports.mjs` exit 0，`L0/dead-exports.md` 被重新生成；
  3. **计数回归**：重生成后 core §三 行数 = **229**（= 356 − 127），且 §三 表内**零行**满足「存在生产消费方」——
     抽 5 行跑 `git grep -rn -w -e "<符号>" -- apps packages` 人工确认，逐行追到具体消费方即判红；
  4. **A.2 / A.3 重新分桶**：附录 A 两档的行数与 `tmp/w3c/tierC.json` 重新对账，**新出现的「疑似可删」行逐条人工过一遍 barrel**；
  5. **摘要与表体一致**：`L0/dead-exports.md` 摘要 `:16` 的数与 §三 实际行数相等（对齐现有 `:14`/`:15` 的写法）；
  6. **本条不改业务代码** ⇒ 四域 tsc / 三包测试**无需跑**（跑了也不该有任何增量；若跑出增量，说明误改了生产文件）。
- **测试策略**：**无测试文件增删改**。验收手段是「重跑产物 + 5 行人工追 `file:line`」，
  口径同 §4.3 第 2 步的 `git grep -rn -w` 命中检查。
- **回归线**：**不产生运行时回归面**（产物文档 + 普查脚本）。真正的风险不是回归，是**新桶被误当施工单**
  ⇒ 回归线的实质约束是「新 §三 表在 §5「方法与已知局限」里必须带『不等于删除清单』的注记」。
- **依赖**：
  - 🔴 **硬门槛（★1 解锁前必须先跑本条）**：`★1` 判「无仓外 TS 消费者」要解锁 A-type 99 条，
    而 A/B/C 三档的分层**就是从 L0 的桶里算出来的** ⇒ 桶没修对，解锁对象就是错的集合。
    顺序：**F-synth-dead-1 → 重跑分桶 → ★1 拍板 → 批次 3 取批**。
  - **前置**：脚本 `tmp/l0census/dead-exports.mjs` **当前不在工作树**（见风险），须先恢复。
  - **不阻塞**：批次 1（16 条）、批次 2（9 条）、§5 死通道（8 条）、§6 batch 通道——它们都不消费 L0 的桶。
  - ⚠ 与 `raw/sr1-d-c.md` M5（「债务池在 ★1 拍板前不可直接当施工单」）**同向**：本条是把那三处降级理由**坐实**，
    不是解除它；`348 条` 这个数在重跑后**会变**。
- **风险与回滚**：
  - **风险 1（本条最大的现实障碍）**：`tmp/` 被 `.gitignore:50` 整目录忽略，
    `tmp/l0census/dead-exports.mjs` 在本 worktree **实测不存在**（`raw/sr1-d-b.md:56` 早已记录同一事实），
    `tmp/w3c/` 同理。⇒ **本条无法「打开文件改一行」**，必须先从 W0/L0 撰写轮产物**恢复脚本**，
    或按 `L0/dead-exports.md:4` 声明的解析口径**重写**一份等效普查器。
    ⚠ 重写版**必须逐条对齐原口径**（导出抽取用正则、不做 AST、symbol 名精确匹配、动态 `import`/`require` 只在解析到仓内文件时记边、
    `apps/mobile/test-utils/**` 按「非 test/ 目录」算生产文件——见 `L0/dead-exports.md:2517-2521`），
    **否则新旧两版数字不可比，本条等于白做**。判据：新脚本跑出的「生产文件数 / 命名导出总数」
    必须先复现 `L0/dead-exports.md:12-13` 的 **1342 / 4981**，再动 `testOnly` 那一行。
  - **风险 2**：改了判定式却**没重跑** ⇒ 产物与脚本不一致，后续机位继续拿 356 行的旧表当数。
    ⇒ 验收第 2/3 条就是抓这个（脚本有 `relayed` 判定 **且** §三 行数 = 229）。
  - **风险 3**：只刷 §三 不重分 A.2/A.3 ⇒ 附录 A 的 348 条主清单仍是按错桶分的，批次 3 照旧会大面积出批。
  - **风险 4（反向）**：过度相信新桶。229 行是「**零生产消费方**」，**不等于**「可删」——
    快照面（F-synth-dead-2 / ★1）与 barrel 转出侧仍各自独立成立，本条**不解除任何 blocked**。
  - **回滚**：单 commit（脚本一行 + L0 产物若干行）。回滚无副作用——旧产物与旧判定式配套。
- **对既有口径的三处改写**（本条落地后必须同步，避免下一个人再被同一处绊住）：
  - §4.1 表（`:791`）`L0/dead-exports.md` 行的「只作线索源」结论**不变**，但理由要改写为
    「桶定义已由本条修正；**重跑后仍是线索源**，因为快照面与 barrel 侧各有独立约束」；
  - 批次 1 小结（`:456-457`）`resolveSubagentSessionId` 归入「仅测试消费」桶的注记**不变**（B1-a 落地后它确实零生产消费方），
    但「该桶因 F-synth-dead-1 的桶定义缺陷**整体不可直接当删除清单用**」这句要改成「该桶已按修正口径重跑，
    仍只作线索、不得当删除清单」；
  - §4.6 高杠杆清单与 §8 的 `★1` 行**不因本条解锁**。

---

## 5 · 死通道 · S-D-05 终裁（8 条真死删 + 2 条级联）

> **S-D-05 的 11 条终裁口径**：8 条真死删 + 1 条口径修正（`VFS_START_DRAG`，**不是断链，不改代码**）
> + 3 条待拍板（`MESSAGES_HIDE_RANGE` / `SHOW_RANGE` / `TRUNCATE_AFTER` → §6，blocked-by-decision ★4）。
> 本节只做那 8 条 + 2 条由批次 1 触发的级联。

### 5.1 「四处同步点」的准确形态（撰写轮逐条核对）

| # | 通道 | ① `shared/ipc-types.ts` 通道常量 | ② `handler-registry.ts` `bindReq` | ③ `invoke-registry.ts` 封装 | ④ `client.ts` 再导出 | ⑤ handler 实现 |
|---|---|---|---|---|---|---|
| 1 | `PROJECTS_GET_AGENT_CONFIG` | `:28` | `:235`（import `:144`） | `:204-207` | `:50` | `handlers/projects.ts:81` |
| 2 | `PROJECTS_UPDATE_AGENT_CONFIG` | `:29` | `:237-238`（import `:147`） | `:208-211` | `:51` | `handlers/projects.ts:96` |
| 3 | `SESSIONS_GET_AGENT_BINDING` | `:39` | `:253`（import `:158`） | `:240-243` | `:59` | `handlers/sessions.ts:174` |
| 4 | `VFS_LIST` | `:48` | `:263`（import `:178`） | **无**（见 §7 修正 #5） | **无** | `handlers/vfs.ts:112` |
| 5 | `WORKPLACE_CAPTURE_SESSION_BLOCK` | `:80` | `:293-294`（import `:193`） | `:272-275` | `:68` | `handlers/workplace.ts:143` |
| 6 | `SMART_SORT_RULE_EXPORT_RULES` | `:159` | `:415`（`bindNoArg`，import `:96`） | `:589-591` | `:149` | `handlers/smart-sort-rule.ts:154` |
| 7 | `SMART_SORT_RULE_IMPORT_RULES` | `:158` | `:416`（import `:97`） | `:593-596` | `:150` | `handlers/smart-sort-rule.ts:166` |
| 8 | `SKILLS_EDIT` | `:170` | `:429`（import `:113`） | `:629-632` | `:159` | `handlers/skills.ts:133` |

> ⚠ **② 的 import 行与 `bindReq` 行是同一条必删项**（第 1/2/3/4/5 条的 import 行已在各行括注里，第 6/7/8 条本轮补齐）：
> `apps/desktop/tsconfig.json` extends `tsconfig.base.json`（**`noUnusedLocals: true`**）且 `include: ["src/main/**/*","shared/**/*"]`
> ⇒ 只删 `bindReq`/`bindNoArg` 行而留下 `handleSmartSortRuleExportRules,` / `handleSmartSortRuleImportRules,` / `handleSkillsEdit,`
> 这三条孤儿 import，即 **TS6133 编译红**。

**零 renderer 消费的亲核结论**：
`git grep -rn "ipcProjectsGetAgentConfig|ipcProjectsUpdateAgentConfig|ipcSessionsGetAgentBinding|ipcWorkplaceCaptureSessionBlock|ipcSmartSortRuleImportRules|ipcSmartSortRuleExportRules|ipcSkillsEdit" -- apps/desktop`
⇒ 命中**只有** `client.ts` 的再导出行与 `invoke-registry.ts` 的封装定义行，**renderer 组件/hook 零调用**。

### 5.2 逐条施工单（8 条）

> 八条共享同一验收门：**① 四域 tsc 无增量 ② desktop 测试无增量（对照 `baseline.md`，注意 N-P0-02 的假绿）③ desktop renderer 已知红 ≤411
> ④ 13 份 core 快照测试全绿（本批不碰 core，但 `handler-registry` 改动可能间接影响 core 测试，故统一跑）
> ⑤ 每条四处同步点 grep 全归零**。
> **回滚粒度建议：8 条放在 3 个 commit 内**——① ③④ 一批（同属「projects/sessions 退役」）② ⑤ 一批 ③ ⑥⑦⑧ 一批（同属「被 yaml/整文件写取代的旧通道」），
> 任一批出问题可单独 revert 而不必回滚全部 8 条。

---

#### 死通道 1 · `PROJECTS_GET_AGENT_CONFIG`（P2 / apps-desktop）

- **病症**：项目级内联 agent 配置的读通道，**已下线功能**（RULE「项目智能体（已下线）」：`chat_project.agent_config_json` 自 v1.4.26 起移除 UI 入口与解析分支，DB 列置空保留）。renderer 零调用。
- **证据**：`apps/desktop/shared/ipc-types.ts:28` `PROJECTS_GET_AGENT_CONFIG: 'nm:projects/getAgentConfig',`；
  `apps/desktop/src/main/ipc/handler-registry.ts:235` `bindReq(IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG, handleProjectsGetAgentConfig);`；
  renderer 零调用（5.1 grep）。handler 侧的 `@deprecated`「兼容外部脚本」理由**不成立**（Electron IPC 只有 renderer 能调），
  但按拍板项 **#8** 的要求，**删前人工确认一次** `examples/` + `scripts/` 无直连（撰写轮已 grep：零命中）。
- **修法**：删 ①`ipc-types.ts:28` ②`handler-registry.ts:235` + import `:144` ③`invoke-registry.ts:204-207` ④`client.ts:50` ⑤`handlers/projects.ts:81` 的整个 `handleProjectsGetAgentConfig`；
  **连带删** `apps/desktop/test/projects-agent-config-handlers.test.ts`（3 个 it 全部围绕这两个 handler）。
- **验收**：四处 + handler + 测试 grep 全归零 + 四域 tsc 无增量 + desktop 测试无增量。
- **测试策略**：**删** `apps/desktop/test/projects-agent-config-handlers.test.ts`（**注意它同时覆盖读与写两个 handler ⇒ 必须与死通道 2 同批删**，
  单独删通道 1 会让该测试的写侧用例失去被测对象而编译红）。
- **回归线**：desktop 设置页智能体编辑用例全绿；`SessionDetail`/`AgentEditorView` 加载链路不变。
- **依赖**：与**死通道 2 同 commit**。**不依赖** Wave B 的 S-D-04 / 条目 B。
- **风险与回滚**：低。回滚：单 commit。

#### 死通道 2 · `PROJECTS_UPDATE_AGENT_CONFIG`（P2 / apps-desktop）

- **证据**：`apps/desktop/shared/ipc-types.ts:29` `PROJECTS_UPDATE_AGENT_CONFIG: 'nm:projects/updateAgentConfig',`；
  `handler-registry.ts:237-238`；renderer 零调用；`handlers/projects.ts:96` `export async function handleProjectsUpdateAgentConfig(`。
- **修法**：删 ①`ipc-types.ts:29` ②`handler-registry.ts:237-238` + import `:147` ③`invoke-registry.ts:208-211` ④`client.ts:51` ⑤`handlers/projects.ts:96` 的整个函数。
- **验收 / 回归线**：同死通道 1。
- **测试策略**：与死通道 1 合并删 `projects-agent-config-handlers.test.ts`。
- **依赖**：与死通道 1 同 commit。
- **风险与回滚**：低。同上。

#### 死通道 3 · `SESSIONS_GET_AGENT_BINDING`（P2 / apps-desktop）

- **病症**：会话 agent 绑定的**读**侧冗余（写侧 `setAgentBinding` 是活的）。生产侧唯一调用者本应是 core 测试，renderer 从不读。
- **证据**：`apps/desktop/shared/ipc-types.ts:39` `SESSIONS_GET_AGENT_BINDING: 'nm:sessions/getAgentBinding',`；
  `handler-registry.ts:253`；renderer 零调用；`handlers/sessions.ts:174` `export async function handleSessionsGetAgentBinding(`。
- **修法**：删 ①`ipc-types.ts:39` ②`handler-registry.ts:253` + import `:158` ③`invoke-registry.ts:240-243` ④`client.ts:59` ⑤`handlers/sessions.ts:174` 的整个函数。
  ⚠ **写侧 `SESSIONS_SET_AGENT_BINDING` 一律不动**（它是活的）。
- **验收**：四处 grep 归零 + desktop 测试无增量。
- **测试策略**：**改** `apps/desktop/test/sessions-agent-binding-handlers.test.ts`（4 个 it，3 处调用 `:74/:97/:317`）
  ——只删读侧相关的断言/用例，**保留写侧用例**。⚠ 这是本节唯一「改测试而非删测试」的通道，改前须逐 `it` 判定归属。
  ⚠ **两处必须按 `it` 拆、不能整删**：① `:43` 那个 `T-D1` 的 `it` 是**读写混合**的——读侧 `:74`/`:97` 与写侧 `:87`/`:104` 在同一个 `it` 里
  ⇒ 只能**拆断言**（删读侧 `:74`/`:97`、写侧四步原样保留），整删会连带削掉写侧覆盖；
  ② `:317` 那处落在 `:245` 的 T-C2 里 ⇒ **只删 `:317` 一行**，不碰该 `it` 的其余部分。
- **回归线**：会话 agent 绑定（设置页绑定模型/智能体）用例全绿。
- **依赖**：无。
- **风险与回滚**：中（测试要按 `it` 精细拆）。回滚：单 commit。

#### 死通道 4 · `VFS_LIST`（P2 / apps-desktop）

- **病症**：VFS 列目录通道，被 `ipcPhysicalList` / `ipcWorkplaceBuildListRows` 取代，renderer 零调用。
- **证据**：`apps/desktop/shared/ipc-types.ts:48` `VFS_LIST: 'nm:vfs/list',`；
  `handler-registry.ts:263` `bindReq(IPC_CHANNELS.VFS_LIST, handleVfsList);`；
  `handlers/vfs.ts:112` `export async function handleVfsList(`；
  **撰写轮实测：没有 `invoke-registry.ts` 封装、没有 `client.ts` 再导出** ⇒ 本条实为**三处**而非四处（见 §7 修正 #5）。
- **修法**：删 ①`ipc-types.ts:48` ②`handler-registry.ts:263` + import `:178` ⑤`handlers/vfs.ts:112` 的整个函数。
- **验收**：grep 全归零 + desktop main tsc 无增量（`vfs.ts` 属 `src/main/**`，在 `tsconfig.json` 的 include 内）+ desktop 测试无增量。
- **测试策略**：无测试引用（撰写轮 grep 无命中）。
- **依赖**：**无**（与拍板项 #8 的「`VFS_LIST` 是否有非 UI 消费方」无关——该争议问的是 `examples/`/`scripts/` 直连，撰写轮 grep 零命中）。
- **风险与回滚**：低。回滚：单 commit。

#### 死通道 5 · `WORKPLACE_CAPTURE_SESSION_BLOCK`（P2 / apps-desktop）

- **病症**：工作区会话块快照通道，单测续命（`it` 名自写「遗留」），renderer 零调用。
- **证据**：`apps/desktop/shared/ipc-types.ts:80` `WORKPLACE_CAPTURE_SESSION_BLOCK: 'nm:workplace/captureSessionBlock',`；
  `handler-registry.ts:293-294`；`invoke-registry.ts:272-275`；`client.ts:68`；`handlers/workplace.ts:143` `export async function handleWorkplaceCaptureSessionBlock(`；
  测试 `apps/desktop/test/workplace-handlers.test.ts:13`（import）+ `:207`（调用），该文件共 5 个 it。
- **修法**：删 ①`ipc-types.ts:80` ②`handler-registry.ts:293-294` + import `:193` ③`invoke-registry.ts:272-275` ④`client.ts:68` ⑤`handlers/workplace.ts:143` 的整个函数。
- **验收**：四处 grep 归零 + desktop 测试无增量。
- **测试策略**：**改** `apps/desktop/test/workplace-handlers.test.ts`——删 `:13` 的 import 与 `:207` 所在的那 **1 个 it**（共 5 个 it，其余 4 个不动）。
- **回归线**：工作区规则 / 目录规则用例全绿。
- **依赖**：无。
- **风险与回滚**：低。回滚：单 commit。

#### 死通道 6 · `SMART_SORT_RULE_EXPORT_RULES`（P2 / apps-desktop）

- **病症**：智能排序规则整包导出通道，被 `yamlExport` 取代，renderer 零调用。
- **证据**：`apps/desktop/shared/ipc-types.ts:159` `SMART_SORT_RULE_EXPORT_RULES: 'nm:sort-rule/exportRules',`；
  `handler-registry.ts:415` `bindNoArg(IPC_CHANNELS.SMART_SORT_RULE_EXPORT_RULES, handleSmartSortRuleExportRules);`；
  `invoke-registry.ts:589-591`；`client.ts:149`；renderer 零调用。
- **修法**：删 ①`ipc-types.ts:159` ②`handler-registry.ts:415` **+ import `:96 handleSmartSortRuleExportRules,`** ③`invoke-registry.ts:589-591` ④`client.ts:149` ⑤`handlers/smart-sort-rule.ts:154` 的整个实现。
  ⚠ **core / CLI 一行不动**（`smart-sort-rule` 域的 yaml 导出是活的）。
  ⚠ **② 的 import 行漏删即编译红**（`noUnusedLocals: true` ⇒ TS6133，见 §5.1 表后的说明）。
- **验收**：四处 grep 归零 + desktop 测试无增量。
- **测试策略**：无直接测试引用（撰写轮 grep 无命中）。
- **依赖**：与**死通道 7** 同 commit（同属 yaml 取代族）。
- **风险与回滚**：低。回滚：单 commit。

#### 死通道 7 · `SMART_SORT_RULE_IMPORT_RULES`（P2 / apps-desktop）

- **证据**：`ipc-types.ts:158`；`handler-registry.ts:416`；`invoke-registry.ts:593-596`；`client.ts:150`；renderer 零调用。
- **修法 / 验收 / 测试策略 / 依赖 / 风险与回滚**：同死通道 6（**必须与 6 同 commit**），
  唯二处差异：② 的 import 行是 **`handler-registry.ts:97 handleSmartSortRuleImportRules,`**（不是 `:96`），
  ⑤ 的实现是 `handlers/smart-sort-rule.ts:166`（不是 `:154`）。
- **回归线**：智能排序规则 UI 用例全绿（`TokenUsageStatsView` 同族设置页一并确认）。

#### 死通道 8 · `SKILLS_EDIT`（P2 / apps-desktop）

- **病症**：技能编辑通道，desktop 走整文件 `ipcSkillsWrite`，renderer 零调用。
- **证据**：`apps/desktop/shared/ipc-types.ts:170` `SKILLS_EDIT: 'nm:skills/edit',`；
  `handler-registry.ts:429` `bindReq(IPC_CHANNELS.SKILLS_EDIT, handleSkillsEdit);`；
  `invoke-registry.ts:629-632`；`client.ts:159`；renderer 零调用。
- **修法**：删 ①`ipc-types.ts:170` ②`handler-registry.ts:429` **+ import `:113 handleSkillsEdit,`** ③`invoke-registry.ts:629-632` ④`client.ts:159` ⑤`handlers/skills.ts:133` 的 `handleSkillsEdit` 实现。
  ⚠ **② 的 import 行漏删即编译红**（`noUnusedLocals: true` ⇒ TS6133，见 §5.1 表后的说明）。
  ⚠ **core 的 `editSkillFile` 必须保留**——实证出处是
  `packages/core/src/domain/tool/builtin/skill-tool.ts:553`（LLM 工具在用）；
  `docs/apm/RULE.md:30` 的「技能域」条目覆盖该域但**未点名本符号**，不能拿它当直接依据。
- **验收**：四处 grep 归零 + desktop 测试无增量。
- **测试策略**：无直接测试引用（撰写轮 grep 无命中）。
- **依赖**：与死通道 6/7 同 commit 或独立 commit。
- **风险与回滚**：低。回滚：单 commit。

---

### 5.3 级联 3b · D-301（`MESSAGES_HIDE` / `SHOW` / `DELETE`）— **由批次 1 D-105 + 批次 2 D-204 触发**

- **病症**：三条通道在 **desktop** 侧的 renderer 唯一调用点是 D-105 的 `tool-turn-actions.ts`；
  删掉后 renderer 零调用 ⇒ 整条链（通道 + handler + 封装 + 再导出）成为死码。
  ⚠ **撰写轮修正**：这三条与 §6 的三条 range 通道**是三条独立级联，不是一条**（`verify-dead` §2 已指出原表挂错因）。
- **证据**（亲核）：`ipcMessagesHide/Show/Delete` 在 `apps/desktop` 的调用点**只在**
  `apps/desktop/renderer/features/chat/tool-turn-actions.ts`（D-105，D-105 删除后归零）；
  `client.ts:90/91/95` 是再导出，`invoke-registry.ts:360/364/380` 是封装定义。
- **修法**（**前置：D-105 与 D-204 都已落地**）：删三条通道的 ①`ipc-types.ts` 常量 ②`handler-registry.ts` `bindReq` + import ③`invoke-registry.ts` 封装 ④`client.ts` 再导出 ⑤handler 实现（`handlers/messages.ts`）。
- **验收**：四处 grep 归零 + desktop 测试无增量。
- **测试策略**：删前先 grep `handleMessagesHide|handleMessagesShow|handleMessagesDelete` 的测试引用，逐条判定。
- **回归线**：消息隐藏/恢复/删除 UI 用例全绿（**注意 RULE：hide/show 与 `usage_stats.toolUseCount` 失效正交**，
  删的是 IPC 通道不是 core 失效逻辑，勿顺手改 `message.service.ts`）。
- **依赖**：**D-105（批次 1）+ D-204（批次 2）**。登记在批次 3.2 的施工单里，但**不在批次 3 的 348 条内**。
- **风险与回滚**：低。回滚：单 commit。

### 5.4 级联 3c · D-303（`SHELL_MENU_POPUP`）— **由批次 1 D-108 触发**

- **病症**：`SHELL_MENU_POPUP` 的 renderer 唯一调用者是 D-108 的 `AppMenuBar.tsx:17`，删掉后全链死。
- **证据**（亲核）：`git grep -rn "SHELL_MENU_POPUP" -- apps/desktop` ⇒ `ipc-types.ts:199`、`handler-registry.ts:476`
  `bindEventReq(IPC_CHANNELS.SHELL_MENU_POPUP, handleShellMenuPopup);`、`invoke-registry.ts:716-723`、`client.ts:182`、
  `AppMenuBar.tsx:2/:17`（唯一调用点）。
- **修法**（前置：D-108 已落地）：删 ①`ipc-types.ts:199` ②`handler-registry.ts:476` + import ③`invoke-registry.ts:716-723` ④`client.ts:182` ⑤`handleShellMenuPopup` 实现。
  ⚠ **`SHELL_SET_TITLEBAR_THEME` 绝对不可同删**——它有活消费方 `apps/desktop/src/renderer/providers/ThemeProvider.tsx:55`（撰写轮核）。
- **验收**：四处 grep 归零（**且 `SHELL_SET_TITLEBAR_THEME` 仍在、`ThemeProvider` 仍引**）+ desktop 测试无增量。
- **测试策略**：删前 grep `handleShellMenuPopup` 的测试引用。
- **回归线**：主题切换 / 标题栏用例全绿。
- **依赖**：**D-108（批次 1）**。登记在批次 3.2，同样不在 348 条内。
- **风险与回滚**：低。回滚：单 commit。

### 5.5 口径修正（非断链，不改代码）

- **`VFS_START_DRAG`**：**send 型四段链路完整**（`preload.ts:71-73` `ipcRenderer.send` → `handler-registry.ts:280-282`
  （注释明写「须在 drag 流程中同步触发，使用 send 而非 invoke」）→ `handlers/vfs.ts:443 startDragExport`
  → 失败回推 `handlers/vfs.ts:450`；renderer 侧 `client.ts:256` + `workspace-batch-dnd.ts:92`），
  它没进 `invoke-registry` 是**设计如此**，不是断链。
  ⚠ 失败通道的**准确名**是常量 **`VFS_START_DRAG_FAILED`**（通道值 `'nm:vfs/startDragFailed'`，`ipc-types.ts:74`）——
  「`vfs-start-drag-failed`」这个字符串在仓库里**不存在**，别按它去 grep。**本波不改任何代码**，
  只把 L0 的断链总数由 12 修正为 11。
- **`preload.inWindowMenuBar`**：硬编码 `false` 且 renderer 零读取，是 D-108 已退役的残骸。
  属 **Wave E 的 X1 收口**范围，**Wave D 不动**（登记，不施工）。

---

## 6 · 三条 batch 通道 · `blocked-by-decision(★4)`

> **默认案 = B（真死删 + 连带清悬空符号）**，按台账 §7 ★4 的默认建议撰写。
> 本节两案后果都写清，**不替用户拍板**。

### 6.1 事实基线（撰写轮亲核）

三条通道的四处同步点齐全、renderer 封装零消费：

| 通道 | ① `ipc-types.ts` | ② `handler-registry.ts` | ②的 import 行 | ③ `invoke-registry.ts` | ④ `client.ts` |
|---|---|---|---|---|---|
| `MESSAGES_HIDE_RANGE` | `:90` `MESSAGES_HIDE_RANGE: 'nm:messages/hideRange',` | `:303` `bindReq(IPC_CHANNELS.MESSAGES_HIDE_RANGE, handleMessagesHideRange);` | `:126` `handleMessagesHideRange,` | `:368-371` | `:92` |
| `MESSAGES_SHOW_RANGE` | `:91` | `:304` | `:132` `handleMessagesShowRange,` | `:372-375` | `:93` |
| `MESSAGES_TRUNCATE_AFTER` | `:92` `MESSAGES_TRUNCATE_AFTER: 'nm:messages/truncateAfter',` | `:305` | `:133` `handleMessagesTruncateAfter,` | `:376-379` | `:94` |

> ⚠ **② 的 import 行是独立的一处必删项**：`apps/desktop/tsconfig.json` extends `tsconfig.base.json`
> （**`noUnusedLocals: true`**）⇒ 只删三条 `bindReq` 行而留下上面三条孤儿 import，即 **TS6133 编译红**。

**renderer 零消费**：`git grep -rn "ipcMessagesHideRange|ipcMessagesShowRange|ipcMessagesTruncateAfter" -- apps/desktop`
⇒ 只有 `invoke-registry.ts` 的定义与 `client.ts:92-94` 的再导出，**零调用点**。
**UI 于 commit `722e27d5` 主动删除**（台账原文），批量隐藏/截断的 UI 入口已下线。

### 6.2 默认案 B（真死删 + 连带清 10 个悬空符号）

- **修法（三段）**：
  1. 删上表 12 个同步点（3 通道 × 4 处）**+ `handler-registry.ts:126/:132/:133` 三行 import**
     （`handleMessagesHideRange,` / `handleMessagesShowRange,` / `handleMessagesTruncateAfter,`；漏删即 `noUnusedLocals` 编译红）
     + `handlers/messages.ts` 里 `handleMessagesHideRange` / `handleMessagesShowRange` / `handleMessagesTruncateAfter` 三个实现。
  2. **连带清 `apps/desktop/shared/logic/chat.ts` 的悬空转出**（撰写轮实测口径：**15 个符号 / 15 行**，
     台账写的「10 个」是值/函数口径，见 §7 修正 #4）：
     `:30 MessageVisibilityBatchMode`、`:32 TailBatchMode`、`:33 TailBatchRow`、`:34 TranscriptSelectableRole`、
     `:49 computeHideRangeFromSelection`、`:50 computeShowRangeFromSelection`、`:51 computeTailBatchAffectedIds`、
     `:52 computeTailBatchRangeFromSelection`、`:53 computeVisibilityBatchAffectedIds`、`:76 isTailBatchRowSelectable`、
     `:77 isTranscriptRowSelectable`、`:101 selectTailBatchEligibleIdsFromAnchor`、`:102 selectVisibilityBatchEligibleIdsFromAnchor`、
     `:108 tailBatchDeleteAfterSeq`、`:109 transcriptSelectableRole`。
     **这 15 行的唯一 desktop 消费者是 D-106/D-107 两个死文件**（撰写轮 grep 确认；6 个 desktop 测试文件零引用），
     ⇒ **前置：D-106 + D-107（批次 1）已落地**。
     ⚠ **core 侧 `public/chat.ts` 的对应转出不动**（被 `public-chat-allowlist.json` 快照锁住）。
  3. `MessageBatchMode` 类型（定义在两个死文件里）随文件删除自然消失，**无需额外动作**。
- **验收**：四处 grep 归零 + `shared/logic/chat.ts` 15 个符号 grep 归零 + core 13 份快照测试**全绿**（core 侧一个字节都不改，是「必须仍绿」的硬断言）+ desktop 测试无增量 + mobile jest 无增量（mobile 有同名 `transcript-selectable-role` 已由 D-106 删除）。
- **测试策略**：删前 grep 三个 handler 的测试引用，逐条判定；**预期为零**（撰写轮未发现）。
- **回归线**：消息隐藏/恢复/截断 UI 用例全绿；`chat.ts` 的 6 个 desktop 消费者测试
  （`message-blocks` / `preview-*` / `rollback-*` / `composer-at-path`）全绿。
- **依赖**：**★4 拍板** + **D-106/D-107（批次 1）**。
- **后果（选 B）**：三处「已注册但零 UI 入口」的通道消失，导出面收窄约 27 行。
  **代价**：若将来产品要重做「批量隐藏 / 按范围截断」的 UI，需要重新加通道 + 重新写 handler 包装
  （core 侧的 `hideRange` / `showRange` / `truncateMessagesAfter` **仍在**，重接的成本是桌面侧三段包装，不是重写业务）。

### 6.3 备选案 A（保留通道 / 走「补 UI」路线）

- **修法**：三条通道**一律不删**，改为补 UI 入口（批量隐藏/显示/截断的菜单项）。
- **后果（选 A）—— 台账明载的升级触发条件**：
  1. **`S-D-07` 立刻升 P1**。病灶：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77`
     的 `truncateMessagesAfter` 只在 `conn.transaction` 里调 `truncateTailInTransaction`，
     **漏** `invalidateSessionApiPromptTokenEntry` 与 `invalidateToolUseCount`；
     同文件兄弟方法 `setMessageFloorAtMessage`（`:186` 附近）与 `message.service.ts:500-501`
     （**注意不是 `:459/490`**——`:459` 落在 `updateHiddenRange` 的实参里，不是失效逻辑）都做了双失效
     ⇒「同语义三条路径都双失效」证明这是遗漏而非取舍。
     更直接的证据是：**core 侧存在两条平行截断实现**——`message.service.ts:468 truncateAfter` 有双失效、
     `message-transcript-effects.service.ts:63 truncateMessagesAfter` 没有。
     一旦通道真被点，`truncateAfter` 就是「占用标签不清 + 工具调用数不失效」的用户可见错数据 ⇒ P2 升 **P1**。
  2. 需连带补 **`AgentSession.hideRange` 的 production 侧接线**（D-314 的声明面：生产侧**零调用** ✓，
     但测试侧是 **3 处 / 2 个文件**——`packages/core/test/agent/agent-session.test.ts:26`、
     `agent-session.test.ts:67`、`packages/core/test/service/agent/read-ref-production-smoke.test.ts:183`）。
     ⚠ **「唯一调用者是 `agent-session.test.ts:26`」这句不成立**：删 D-314 时漏掉
     `read-ref-production-smoke.test.ts:183` ⇒ 该测试文件编译红。
  3. 需连带补 `shared/logic/chat.ts` 那 15 个悬空转出的**真实 UI 消费者**（否则转出继续悬着）。
- **结论注记**：A 案不是「保留三行通道」，而是一条**产品功能线**（批量可见性 + 范围截断 UI），
  其工作量与验收口径都超出死码清理波次，**建议单独开 PRD**。

### 6.4 两案共同的不可省前置

无论 A 还是 B，**动手前都必须**：
① rebuild core；② 跑 13 份 core 快照测试并全绿；③ 跑 `shared/logic/chat.ts` 的 6 个 desktop 消费者测试并全绿。
**理由**：这三条通道的 handler 背后是 core 的 `hideRange` / `truncateMessagesAfter`，
删除桌面侧包装不等于 core 侧无引用——快照测试是唯一能证明「core 公共面没被动」的硬门。

---

## 7 · 口径修正回写清单（撰写轮亲核与上游的差异）

> 这些差异**必须在 spec-check-loop 的 judge 轮裁定**，并由主代理回写到对应上游文档。
> 本机位**只写在这里**，不回写 `ledger-v2.md` / `dead-backlog.md`（只读纪律）。

| # | 上游原文 | 撰写轮亲核 | 影响 | 建议回写目标 |
|---|---|---|---|---|
| 1 | `ledger-v2.md` §10 Wave D 批次 3 新增三组目标含「① `AgentDefinitionEditorForm.tsx`」，同时批次 1 的 D-102 也是同一文件 | **同一对象被登记两次**，若两处都施工，2236 与 ≈386 两处行数对账都会多算 1047 | 行数对账错 | 本分片裁定「归 D-102，批次 3 只登记」；请 judge 确认，并在 `ledger-v2.md` §10 批次 3 格去掉 ① 或注明「已并入 D-102」 |
| 2 | D-116 台账锚点 `:33`、动作「删 `isTaskToolUse`」 | `fe79b781` 实为 `:29-35`（JSDoc 3 行 + 函数 3 行）；且**保留** `resolveSubagentSessionId` 后本批净减从 2236 变 **≈2205** | 行数对账 | `dead-backlog.md` D-116 行补行号与净减口径 |
| 3 | D-207 删 `service/kkv/index.ts` + 删 `tsconfig.test.json:26` 映射；**Wave E 另有独立条目**「`tsconfig.test.json` paths 与 `package.json` exports 对齐」，其修法隐含「把这条路径改指 public barrel」 | **两片的修法并不冲突，原判「修法冲突」作废**：`wave-e.md` **X4.2 第 3 条**写明「本条（X4）不改动 paths 本身，只加守卫测试」⇒ X4 侧压根不碰 `:26`，D-207 改指 public 不与它争同一行；`X4.2` 同时声明「若 D-207 先落，X4 测试无需改」，两片口径本就同向。⚠ 真正成立的是**顺序约束**，不是修法矛盾：**同一个 PR 时必须 D-207 在前**（改指 `./src/public/kkv.ts` + 删 barrel）→ **X4 在后**（把 `kkv` 补进 `public-subpath-allowlist.test.ts` 的 `SUBPATHS`）；若拆成不同 PR，两片**互不依赖**、顺序不限（口径见 §8「已裁定」行）。**更硬的约束**：`docs/apm/RULE.md:74` 明载「paths 缺映射 ⇒ tsx 回退 node 解析、经 `node_modules` 自链加载 `dist/` 旧产物 ⇒ 测试静默跑旧码」，而**唯一受害方是 `packages/core/test/package-exports-t0.test.ts:4`**（`import { createKkvService, KkvError } from "@novel-master/core/kkv"`），原稿完全没提这个文件 ⇒ 「只删映射」是死路，这一条不受「不冲突」影响，仍然有效 | 若顺序颠倒 ⇒ X4 的守卫测试与 D-207 的 paths 改动互相覆盖；单走「只删映射」⇒ 静默跑 `dist` 旧码 | **judge-r1 §C③ 已终裁：取方案 ①**（D-207 把 `:26` 改指 `./src/public/kkv.ts`，然后删 `service/kkv/index.ts`），方案 ②（保留 barrel、撤下 D-207）**作废**。本行「修法冲突」段已按 C③ 改写为「不冲突 + 有顺序约束」，D-207 侧口径已回写（§3 D-207 修法第 2/3 步、§8「已裁定」行）；🔁 连带 `SPEC.md §3` 依赖图须补这条边（judge-r1 R2-3②） |
| 4 | 「连带清 10 个悬空符号」 | 实测 **15 个**（11 值/函数 + 4 类型），且台账漏列 `selectVisibilityBatchEligibleIdsFromAnchor`（`chat.ts:102`） | 漏删 5 行。⚠ **补标快照约束**：`selectVisibilityBatchEligibleIdsFromAnchor` 在 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json:142` **有快照锁**（另有 `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:18` 与 `apps/mobile/src/components/chat/transcript-selectable-role.ts:23` 两处 import、`packages/core/src/public/chat.ts:288` 转出）⇒ **双端 `chat.ts` 的转发行可摘，core `public/chat.ts:288` 绝不可动** | `dead-backlog.md` 争议 #4 与 `ledger-v2.md` §10 把「10 个」改为「15 个（11 值 + 4 类型）」，并补上述快照锁约束 |
| 5 | 「每条须同步改**四处**」（S-D-05 8 条） | `VFS_LIST` 在 `fe79b781` **没有** `invoke-registry` 封装、也没有 `client.ts` 再导出 ⇒ 实为**三处** | 施工单照抄「四处」会去找不存在的代码 | 本分片 §5.1 已逐条列出真实形态；请 judge 确认 |
| 6 | 拍板项 #12「连带两个死常量（`LONG_PRESS_MOVE_TOLERANCE_PX`、`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`）」 | `LONG_PRESS_MOVE_TOLERANCE_PX` 确死；`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 是**经 `anchored-menu-layout.ts:12` 再导出的死值**，删常量必须同删再导出行，否则编译红 | 只删一处 ⇒ `tsc` 红 | `ledger-v2.md` §7 #12 与 `synth/apps-mobile.md` AM-14 补「两处同删」 |
| 7 | 同上：「语义被手写内联在 `menu.ts:194-202`」 | `menu.ts:1` **import** 了 `MENU_OPEN_GRACE_MS`、`:199` 在用；只有谓词是内联的。⇒ **`MENU_OPEN_GRACE_MS` 是活的，严禁跟着删** | 照原文施工会删掉活常量 ⇒ 改变「长按后 touchend 不关菜单」的宽限行为 | `ledger-v2.md` §7 #12 的描述改写为「谓词内联、常量仍 import」 |
| 8 | 「`bind-shell-events.ts:4-5` 注释 + `RULE.md:11` 双出处证明『长按开菜单』是用户拍板退役的」 | `bind-shell-events.ts:4` 的注释是**直接出处**（原文：「消息菜单由气泡右上角 ⋯ 触发…不再绑定长按开菜单」）；`RULE.md:11` 记的是**Android 小米/HyperOS 批注划词菜单 hold**，属同族旁证，**不是** webview 长按菜单退役的直接决策记录 | 引用出处不准确会在 review 时被质疑 | 本分片 §4.7 目标② 已按准确措辞写；建议同步订正 `ledger-v2.md` §7 #12 |
| 9 | D-202「连带测试：`preview-annotate-source-anchor.test.ts:26,48`」 | 实测还有 `preview-recogito-md.test.ts:76`，但它是 `doesNotMatch` **负向断言**（删源后仍绿、无需改）；`preview-annotate-source-anchor.test.ts` 里 `:114` 同为负向断言须保留、`:43-49` 的 `sanitizePath` 常量随之删 | 施工时可能误删负向断言（丢覆盖） | 本分片 D-202 已写清；`dead-backlog.md` D-202 行补「2 个测试文件，其中 2 处负向断言须保留」 |
| 10 | D-204「`tool-turn-actions.test.ts`（4 个 it）」 | 实测 **5 个 `it(`** | 删测试时按条数核对会漏 1 条 | `dead-backlog.md` D-204 行改为 5 |
| 11 | `synth/dead-backlog.md:217` 与 `synth/verify-dead.md:61-68` 均判 D-101「脚本不会崩、非 ENOENT，只是静默回退工作区」（台账 §10 的施工单修正 ① 照此改写了理由） | **两处判断均需订正**：它们只验了 commit `d825173` 与 blob 的**存在性**，**没验 `EventsConfigView.tsx` 在当前树上是否存在**（`git ls-files apps/desktop/renderer/features/settings/` 无它）。实测真实行为是「**破坏先于报错**」：`:54` 先静默把工作区 `AgentEditorView.tsx` 覆写成 `d825173` 的 471 行版本（当前 1381 行，**净丢 910 行**），`:63` 才因 `eventsPath` 不存在而 ENOENT 崩 | 照上游写「非 ENOENT」会让施工者低估风险（以为崩了＝没改动），漏掉 CHANGELOG 留痕的必要性 | `dead-backlog.md:217` 与 `verify-dead.md:61-68` 均改为「**破坏先于报错**：先静默丢 910 行 `AgentEditorView.tsx`，再 ENOENT 崩」；`ledger-v2.md` §10 批次 1 D-101 行的理由同步改写。**删除动作与优先级不变**（仍建议全批第一条） |

---

## 8 · 阻塞与待拍板汇总（本分片）

| 标记 | 内容 | 阻塞范围 | 默认案 |
|---|---|---|---|
| `blocked-by-decision(★1)` | 快照锁定面 A 类 173 条（value 74 / type 99）的去留 | 批次 3 的 348 条中凡命中快照或改 `src/public/**` barrel 者 | 判「无仓外 TS 消费者」→ 解锁 A-type 99 条。**硬门槛：解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`（W5–W11 从未执行过）** |
| `blocked-by-decision(★3)` | `config-forms/shared/{depth-slice,application-model-id}.ts` 与 `domain/**` 的双份同名同签名 | D-316 + `config-forms/{shared,agent}/index.ts` 的相关转发行 | 倾向「迁移残留」可删，**但必须用户确认「共享形态不是为分端裁剪的产物」**（`config-forms/shared` 是 `package.json:105` 的正式对外子路径，动它等于动子路径清单） |
| `blocked-by-decision(★4)` | `MESSAGES_HIDE_RANGE` / `SHOW_RANGE` / `TRUNCATE_AFTER` 三条 batch 通道 | §6 全节 | **B（真死删 + 清 15 个悬空符号）**；若改 A，`S-D-07` 立刻升 **P1** |
| `blocked-by-decision(★2)` | `D-311 resolveLatestReleaseFromList`（保留）/ `D-314 AgentSession.hideRange`（可删） | D-311 / D-314 两条 | **D-311 保留**（`docs/Iterations/about-and-update-check/spec.md:187` 明写「预留」，按 PLAN §3 标 intentional）；**D-314 可删**（`verify-dead` §5 #2 已证 `ephemeral-overlay-agent-session.ts` 那条「intentional 注释」**在代码里不存在**）。⚠ 删它时**测试侧 3 处 / 2 文件须同批处理**：`packages/core/test/agent/agent-session.test.ts:26/:67` 与 `packages/core/test/service/agent/read-ref-production-smoke.test.ts:183`，漏掉第三个文件即编译红 |
| 硬前置（非拍板） | rebuild `packages/core/dist` | 批次 2 全部 9 条、批次 3 的 B3-b/B3-d | — |
| 硬前置（非拍板） | **F-synth-dead-1（§4.9）**：L0「仅测试消费」桶排除 `relayed` 后重跑 + 重新分桶 + 回写 `L0/dead-exports.md` | **★1 解锁前**（A/B/C 三档的分层由 L0 桶算出）；**不阻塞**批次 1 / 批次 2 / §5 死通道 / §6 batch 通道 | 量 S。⚠ 执行前须先恢复/重写普查脚本——`tmp/l0census/dead-exports.mjs` 被 `.gitignore:50` 整目录忽略、当前工作树**不存在**；重写版须先复现 `L0/dead-exports.md:12-13` 的 1342 / 4981 再动判定式 |
| `★1` 的解锁产物（非独立施工项） | **F-synth-dead-2**（`ledger-v2.md:181`，13 份 core 快照 / 553 个去重名字） | 随 **★1** 一并处置 | **不按漏条重排、不单列七要素条目**——它的修法栏原文就是「见拍板项 #1」，本质是 **★1 的解锁对象本身**。🔁 须在 `SPEC.md §4` 的 blocked 汇总里显式登记一行「F-synth-dead-2 = ★1 的解锁产物，随 ★1 一并处置」，避免下一轮有人当成漏条（本条**不在 wave-d 内闭合**，登记动作留主代理/回写机位）。⚠ 13 份快照 / **553** 个去重名字这个数本轮实点过（`snapshots/*.json` 13 份、并集 553），与台账 `:181` 写的 551 有出入，回写时按 553 |
| 硬前置（非拍板） | `fix-spec/baseline.md` 的已知红清单 | 全部四域 tsc + 三包测试的判增量 | **数字一律以已落盘的 `baseline.md` §4 总表为准**（`HEAD = fe79b781`，实跑 2026-10-01；renderer 已知红 **411**、三包分母 3126 / 628 / 1739）。⚠ 原写的「撰写时该文件尚未产出」**已过期** |
| 已裁定（judge-r1 §C③） | D-207 的 `tsconfig.test.json:26` 去向：① 改指 `./src/public/kkv.ts` / ② 保留 barrel、撤下本条 | — （**已解锁**） | **取方案 ①**：D-207 把 `:26` **改指 `./src/public/kkv.ts`**（`src/public/kkv.ts:11-14` 已导出 `createKkvService` + `KkvError`，覆盖 `test/package-exports-t0.test.ts:4` 的全部需求），然后删 `service/kkv/index.ts`。**拆成不同 PR 时 D-207 与 X4 互不依赖、顺序不限**（X4 只加守卫测试、不改 paths，D-207 改指 public 后 X4 测试继续绿）；**但若要同 PR，必须 D-207 在前**（与 §7 修正 #3 的顺序约束同口径）。方案 ② 作废（只删映射命中 RULE:74 静默跑旧码；保留 barrel 则双 barrel 病灶留着） |
| 依赖 Wave A | N-P0-02（desktop 测试收集器假绿） | §5 死通道与 §6 的 desktop 测试验收 | 未修前**不得**用 `npm test -w apps/desktop` 作验收证据，须用 `baseline.md` 的等价收集命令 |

---

*本文件为 S 阶段 Wave D 分片撰写机位（s-wave-d）产出。所有 `file:line` 与引文均在 `fe79b781` 亲核；
只读纪律：零 git 写、零 `docs/apm/` 写、零生产/测试代码改动。*
