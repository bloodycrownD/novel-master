# wave-e · 文档与防再犯（分片 fix-spec）

> 基线：`feat/repo-mega-cr` HEAD=`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`）。
> 本分片负责 SPEC.md §2 分配表中的 `wave-e.md` 一栏：**X1 收口、renderer typecheck 门禁、
> WebView 产物门禁、tsconfig.test paths 对齐、防再犯钩子 ①~⑥、注释承诺≠实现**。
> 七要素按 PLAN.md 第四章第 8 条；**全部证据均在本分片撰写时重新打开 `fe79b781` 代码逐行核对**，
> 台账（`ledger-v2.md`）的行号与数字凡与实测不符者，正文以实测为准并在「口径修正」小节留痕。

## 0 · 本分片的度量基线（本机位实跑，2026-10-01）

下列数字全部由本分片机位在 `fe79b781` 上实跑产出，**不是照抄台账**（RULE「条数/行号/计数类结论一律实测复核」）：

| 度量 | 命令 | 实测结果 |
|---|---|---|
| desktop lint | `npx eslint src test renderer shared`（`apps/desktop`） | **11 errors / 24 warnings**；errors = 9 × `no-restricted-imports`（X1）+ 2 × `no-regex-spaces` |
| core lint | `npx eslint .`（`packages/core`） | **8 errors / 107 warnings**；其中 `no-regex-spaces` **4 条**（台账写 3 条，见 §1.4 口径修正） |
| driver lint | `npx eslint src test`（`packages/tdbc-driver-op-sqlite`） | **8 errors**，全部是 `Parsing error: ... was not found by the project service` |
| renderer typecheck | `npx tsc --noEmit -p tsconfig.renderer.json` | **411 errors**（唯一口径：`error TS\d+` 行计数）；分布 `test/` 190、`renderer/` 178、`src/` 42、仓外 1 |
| webview 产物 | 扫 `apps/mobile/webview-dist/*/app.js` | **3/4 包命中**禁用构造（code-editor 那格是 `Object.hasOwnProperty` 误伤，严格匹配命中 0；明细见 §X3.1） |
| 一方 web 源码 | 扫 `apps/mobile/src/web/**`、`src/webview-host/**` | **0 命中**（禁用构造在一方源码面已干净 ⇒ 源码级门禁可零债务上线；⚠️ 该扫描面**漏了 `src/components/**`**，见 §X3.2 门 A，mf `sr1-e-b MF-2`） |
| U+FFFD | 字节级扫 `apps/*/src`、`packages/**` | **9 个文件**（mobile 1 / desktop 1 / packages 7） |
| BOM | 字节级扫 `packages/**` | **20 个文件**（core `src/` 4、core `test/` 15、core `docs/` 1、sksp-android `test/` 1） |

---

## X1 · 门禁全量收口

- **严重度 / 簇**：P2（门禁失效，无用户可见故障）· apps-desktop + packages/* + CI
- **病症**：X1 门禁（`eslint.config.mjs` 的 `no-restricted-imports`）本身**配置正确且实跑能抓到**，
  但 ① CI 的 `Lint` / `Typecheck` 步骤带 `continue-on-error: true`，把门禁的红全部吞掉；
  ② 9 处违规一直没人修，于是「再导出层存在却没人用」的现状被固化；
  ③ 10 个驱动包的 eslint 用 `projectService` 去解析一个 `include` 只有 `src/**/*` 的 tsconfig，
  导致 `test/**` 每个文件一条解析错误，门禁在这些包上是**恒红**的——恒红的门等于没有门。

### X1.1 证据

**(a) CI 放行**（`.github/workflows/ci.yml:56-63`，逐行核对）：

```yaml
      - name: Typecheck
        continue-on-error: true
        run: npm run typecheck --workspaces --if-present
```

**(b) 门禁规则本身在位**（`apps/desktop/eslint.config.mjs:71-88`）：

```js
  // X1 gate: ban literal @novel-master/core* in renderer only (main/shared/test remain allowed).
  {
    files: ["renderer/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": [ "error", { patterns: [ { group: ["@novel-master/core", "@novel-master/core/*"],
```

**(c) 9 处违规的精确坐标（本分片逐个 `grep` + 打开 import 块核对；下表**行号 = import 语句起始行**，
6 处是多行 import，specifier 在 import 块末行）**：

| # | file:line | 现 import | 符号 | 改走去向 | 出口是否已备 |
|---|---|---|---|---|---|
| 1 | `renderer/App.tsx:2` | `@novel-master/core/vfs` | `validateVfsEntryName` | `@shared/logic/vfs` | ✅ `shared/logic/vfs.ts:13` |
| 2 | `renderer/features/chat/chat-link-route.ts:19` | `@novel-master/core/chat` | `isHttpUrl`, `resolveChatLinkTarget` | `@shared/logic/chat` | ❌ 需新增 2 |
| 3 | `renderer/features/chat/conversation-abort-retain.ts:1` | `@novel-master/core/events` | 2 type | `@shared/logic/events` | ✅ `shared/logic/events.ts:13-14` |
| 4 | `renderer/features/chat/ConversationPanel.tsx:13` | `@novel-master/core/events` | 4 type | `@shared/logic/events` | ⚠️ 缺 `AgentRunFailedPayload`/`AgentRunStartedPayload` |
| 5 | `renderer/hooks/useAgentRunLifecycle.ts:12` | `@novel-master/core/events` | 3 type | `@shared/logic/events` | ⚠️ 同上缺 2 |
| 6 | `renderer/hooks/useAgentStream.ts:26` | `@novel-master/core/events` | 8 常量 + 8 type | `@shared/logic/events` | ❌ 需新增 12 |
| 7 | `renderer/hooks/useAgentStreamMetrics.ts:30` | `@novel-master/core/provider` | `CHARACTERS_PER_TOKEN_RATIO` | `@shared/logic/provider` | ❌ 需新增 1 |
| 8 | `renderer/providers/ShellNavProvider.tsx:35` | `@novel-master/core/events` | 2 常量 + 2 type | `@shared/logic/events` | ✅ 全备 `events.ts:11-14` |
| 9 | `renderer/providers/ShellNavProvider.tsx:60` | `@novel-master/core/chat` | `chatLinkNotFoundMessage` | `@shared/logic/chat` | ❌ 需新增 1 |

> 8 个文件、9 处。core 侧上游符号全部现成：`packages/core/src/public/events.ts:6-29`
> 已导出 9 个 `EVENT_*` 常量 + 11 个 payload type。

**(d) desktop 2 条 `no-regex-spaces`**（实跑定位）：
`apps/desktop/test/preview-annotate.test.ts:398` 与 `apps/desktop/test/preview-recogito-md.test.ts:139`，
两处同一形态：

```ts
      /const onMouseUp = \(\) => \{[\s\S]*?\n    \};/,
```

**(e) core 实测 8 条 error 的完整构成**（台账只提了 3 条 `no-regex-spaces`）：

| 规则 | 位置 | 条数 |
|---|---|---|
| `no-regex-spaces` | `test/chat/hydrate-tool-results.test.ts:115,167,639`；`test/chat/skill-result-ref.test.ts:275` | **4** |
| `no-control-regex` | `src/domain/character-card/logic/sanitize-entry-filename.ts:7`；`src/domain/chat/repositories/impl/sqlite-message.repository.ts:117` | 2 |
| `prefer-const` | `src/domain/chat/logic/annotate-source-range.ts:379` | 1 |
| `no-useless-escape` | `test/skills/skills.service.test.ts:572` | 1 |

**(f) 驱动包 tsconfig 覆盖缺口**：`eslint.config.base.mjs:24-55` 的 `createTsEslintConfig(tsconfigRootDir, options)`
**已经内置** `options.testTsconfig` 分支，但全仓 14 个使用方里**只有 `packages/core/eslint.config.mjs:69` 传了**：

```js
  ...createTsEslintConfig(tsconfigRootDir, {
    testTsconfig: "./tsconfig.test.json",
  }),
```

其余 **10 个有 `test/` 目录的包**（tdbc-driver-op-sqlite / -better-sqlite3 / -rn、tokenizer-driver-node、
cloud-sync-driver-s3、sksp-windows / -mac / -linux / -android、llm-sse-native）一律
`createTsEslintConfig(import.meta.dirname)` 不带第二参 ⇒ `srcFiles` 退化为 `["**/*.{ts,tsx,mjs,cjs,js}"]`，
而各包 `tsconfig.json` 的 `include` 只有 `["src/**/*"]`。实测 **10 个包共 33 个 test 文件**，
单 `tdbc-driver-op-sqlite` 一个包就 8 条解析错误。
（`tokenizer-driver-rn` **不在此列**——`fe79b781` 上它没有 `test/` 目录，故无同型恒红面。）

### X1.2 口径修正（台账/原始报告需回改的三处）

1. **`shared/logic/events.ts` 自身「2 符号零消费」——不成立，作废。**
   `fe79b781` 上该文件导出的 4 个符号**全部有消费方**：`renderer/features/chat/SessionDetailDrawer.tsx:54-59`
   一次性导入 `EVENT_AGENT_RUN_FINISHED` / `EVENT_AGENT_STEP_COMMITTED` / 两个 payload type。
   `raw/w3-xc-ipc.md:287` 早已就地推翻（"该说法已过时"），但 `synth/apps-desktop.md:169-183`
   （S-D-06 处置三档）仍复述、`ledger-v2.md:487` 仍写进 Wave E 表格。**本分片按已证伪处理，不列入修法**。
   真实病症是**反方向的**：再导出层**供给不足**（4 个 vs 需要的 16 个），9 处违规里有 **5 处**因此绕过它
   （#3/#4/#5/#6/#8；`@novel-master/core/events` 只出现在这 5 处，另 4 处走 vfs / chat / provider）。
   ⚠️ 原文写的「6 处」沿袭自 `raw/w3-xc-ipc.md:287`（「覆盖全部 9 处违规中的 6 处」），**源头就错**——
   该数字在 `w3-xc-ipc.md:287` 待回改，本条只订正 wave-e 侧。
2. **core 的 `no-regex-spaces` 是 4 条不是 3 条**，且 core lint 存量是 **8 errors** 不是「3 条」。
   只修 3 条会让 `npm run lint -w @novel-master/core` 仍然红。
3. **X1 的 9 处违规不是「门禁缺失」而是「门禁被 CI 放行」。** `apps/desktop/package.json:8` 的
   `"lint": "eslint src test renderer shared"` 覆盖面本就够。这决定了 X1 的**修法重心在 CI 那一行**，
   不在 eslint 配置。
4. **X1.1(c) 那张表的行号口径**（sr1-e-c MF-8 显式化）：9 条里**有 6 条给的是 import 语句的起始行**，
   不是 `grep` 命中的 specifier 所在行——多行 import 的 specifier 在 import 块末行。
   典型对照：表里写 `renderer/hooks/useAgentStream.ts:26`（import 语句首行），
   而 grep 命中的 specifier 行是 **`:43`**。**验收时按起始行定位**（改的就是那一行的
   `'@novel-master/core/events'` 字面量），不要拿 `:43` 去 grep 复核。

### X1.3 修法（文件·函数级步骤）

**Step 1 — 补再导出（3 个文件，16 个符号，纯转发）**
- `apps/desktop/shared/logic/events.ts`：追加 12 个符号
  —— 常量 6（`EVENT_AGENT_RUN_STARTED` / `EVENT_AGENT_RUN_FAILED` / `EVENT_AGENT_STREAM_TEXT_DELTA` /
  `EVENT_AGENT_STREAM_THINKING_DELTA` / `EVENT_AGENT_STREAM_TOOL_USE` / `EVENT_AGENT_STREAM_USAGE`）
  + type 6（`AgentRunStartedPayload` / `AgentRunFailedPayload` / `AgentStreamTextDeltaPayload` /
  `AgentStreamThinkingDeltaPayload` / `AgentStreamToolUsePayload` / `AgentStreamUsagePayload`）。
  保持文件头「禁止 `export *`」的纪律，追加到现有 `export { ... }` 块内。
- `apps/desktop/shared/logic/chat.ts`：值导出块（`:37-114`）追加 `isHttpUrl` / `resolveChatLinkTarget` /
  `chatLinkNotFoundMessage`。
- `apps/desktop/shared/logic/provider.ts`：值导出块（`:13-17`）追加 `CHARACTERS_PER_TOKEN_RATIO`。

**Step 2 — 改 8 个文件的 9 条 import**（只改 import 行的 specifier，符号名与用法零改动）

**Step 3 — 修 6 条 lint error**
- desktop 2 条 `no-regex-spaces`：`test/preview-annotate.test.ts:398`、`test/preview-recogito-md.test.ts:139`
  的 `\n    ` 改写为 `\n {4}`。
- core 4 条 `no-regex-spaces`：定位到 5 个连续空格的字面量改写为 ` {5}`。
- core 另 4 条（2 × `no-control-regex` / 1 × `prefer-const` / 1 × `no-useless-escape`）同批修掉，
  **不得留尾巴**——留尾巴则 `lint -w @novel-master/core` 仍红，X1 的验收命令就不成立。
  `no-control-regex` 两处是**故意的**（`sanitize-entry-filename` 的控制字符剔除、
  `sqlite-message.repository.ts:117` 的内容匹配），走**行内 `// eslint-disable-next-line no-control-regex`
  + 一句 WHY 注释**，不要改成 `new RegExp` 绕过 AST 检查。

**Step 4 — tsconfig 覆盖（11 个使用方 = 10 个 packages + `apps/cli`；sr1-e-a MF-3）**
10 个驱动包各新增 `tsconfig.test.json`（照抄 `packages/core/tsconfig.test.json` 的形态）：

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*", "test/**/*"] }
```

并把各包 `eslint.config.mjs` 改成 `createTsEslintConfig(import.meta.dirname, { testTsconfig: "./tsconfig.test.json" })`。

**`apps/cli` 与这 10 个包完全同型，一并处理**（实测 `apps/cli/eslint.config.mjs:3` =
`createTsEslintConfig(import.meta.dirname)` 无第二参；`apps/cli/tsconfig.json` 的 `include` 只有
`["src/**/*"]`；而 `package.json:11` 的 `lint` 是 `eslint src test`，`test/` 下 **20 个 `.test.ts`**
⇒ 同一条恒红面）：
- 新增 `apps/cli/tsconfig.test.json`，同样形态：`include: ["src/**/*", "test/**/*"]`、`noEmit: true`；
- `apps/cli/eslint.config.mjs` 改成
  `createTsEslintConfig(import.meta.dirname, { testTsconfig: "./tsconfig.test.json" })`。

**Step 5 — CI 转 blocking（**依赖 Wave A**，本条只做 desktop/core/驱动包范围；sr1-e-a MF-1 重写）**
`.github/workflows/ci.yml`：
- **`:62`（Typecheck）**：承接 Wave A——Wave A 已摘该行 `continue-on-error`，本条仅确认其后置条件
  （X1.1 的违规归零 + 驱动包 tsconfig 覆盖完成后，Typecheck blocking 才不会被本条遗留打红）。
- **`:58`（Lint）**：**本条不碰**。现状 `ci.yml:59` 是 `npm run lint --workspaces --if-present`
  **单步全 workspace**——摘 `:58` 必被 mobile 的 27 条存量 lint error 打红。desktop/core/驱动包的
  Lint blocking 改由**新增一条独立 CI 步骤**实现：
  `npm run lint -w @novel-master/desktop -w @novel-master/core -w @novel-master/llm-sse-native -w @novel-master/sksp-android -w @novel-master/sksp-linux -w @novel-master/sksp-mac -w @novel-master/sksp-windows -w @novel-master/cloud-sync-driver-s3 -w @novel-master/tdbc-driver-better-sqlite3 -w @novel-master/tdbc-driver-op-sqlite -w @novel-master/tdbc-driver-rn -w @novel-master/tokenizer-driver-node -w @novel-master/tokenizer-driver-rn`
  （**workspace 名写全**，不带 `--if-present`，无 `continue-on-error`）。前置 = 本条 Step 3/4
  已把上述包的 lint 修到 0 error。
- `:58`（全 workspace lint，容忍 mobile）保留到 **mobile lint 存量收口后**再摘，
  届时新步骤与 `:58` 合并（收口动作记在 wave-a 的 mobile 格，不在本条）。

### X1.4 验收（可测命令 + 期望）

```powershell
# ① X1 违规归零（期望：0 error）
cd apps/desktop; npx eslint src test renderer shared        # 期望 0 errors（24 warnings 保持）

# ② core lint 归零（期望：0 errors，warnings 允许）
cd packages/core; npx eslint .                             # 期望 0 errors

# ③ 驱动包 + apps/cli 解析错误归零（期望：0 errors）
cd packages/tdbc-driver-op-sqlite; npx eslint src test      # 期望 0 errors
# 其余 10 个包同命令逐一跑
cd apps/cli; npx eslint src test                           # 期望 0 errors

# ④ 一方源码零直连 core（结构断言，期望 0 行输出）
Select-String -Path (gci -r -Include *.ts,*.tsx apps/desktop/renderer).FullName -Pattern '@novel-master/core'

# ⑤ 行为零变更（期望：全绿，条数与 baseline.md 一致）
cd apps/desktop; npm test                                   # 期望 0 fail
cd packages/core; npm test                                  # 期望 0 fail
```

### X1.5 测试策略

- **不新增测试**。X1 的「测试」就是上面 5 条门禁命令本身——每条都是「把实现改坏就红」的形态
  （把某条 import 改回 `@novel-master/core/*` ⇒ ① 立刻红；删掉某个驱动包的 `tsconfig.test.json` ⇒ ③ 红）。
- 唯一值得加的一条**结构快照**：把「`shared/logic/*.ts` 里出现的每一个 core 符号」与
  「`renderer/**` 实际 import 的 core 符号」做一次集合对账，断言 renderer 侧集合为空。
  落在 `apps/desktop/test/shared-logic-x1.test.ts`。这条不依赖 eslint，可作为 eslint 未装环境下的兜底。
  **牙齿自检（RULE 验收三判据）**：判据①「把某个 renderer import 改回 core ⇒ 红」——成立；
  判据②「不在 eslint 进程/顺序约束下会恒红」——不涉及；判据③「同一夹具只服务一套期望」——
  本条只挂一套期望，成立。

### X1.6 回归线

- `apps/desktop` 全量 `npm test`（`scripts/run-tests.mjs`）——**注意必须用修好零收集守卫后的命令**
  （见 H6），否则「0 条全绿」是假的。
- `packages/core` 全量 `npm test`。
- `shared/logic/*` 三个文件的既有 0 error lint。

### X1.7 依赖

- **Wave A 的「CI typecheck 转 blocking」**（`ledger-v2.md:437`）是本条 Step 5 的前置——
  Typecheck blocking 先行，本条的独立 lint 步骤才不会与 typecheck 红混在一起归因。
- 反向依赖：本条完成后，X2（renderer 门禁）与 X3（WebView 门禁）才有「CI 会执行」的落点。
- H6（零收集守卫）建议与 Step 5 同一 PR 落地——否则 CI 新加的步骤本身可能就是空跑。
  **（X1.7 依赖表正式补行，sr1-e-a MF-11：`npm test` 回归线的真实性依赖 H6。）**

### X1.8 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 16 个新转发符号里某个在 core 侧其实没导出 | 低（已逐个核过 `public/events.ts`） | 编译红 | Step 1 完成后先跑 `npm run typecheck -w @novel-master/core`，再改 import |
| 改 import 触发 tree-shaking 差异，desktop bundle 变大 | 极低（同名同源转发，vite 解析到同一模块 id） | 体积 | 验收加一条：`npm run build:renderer` 前后 dist 体积差 < 1% |
| 驱动包新增 `tsconfig.test.json` 后 `tsc --build` 引用图变化 | 低 | driver build 失败 | `tsconfig.test.json` 继承 `./tsconfig.json` 并 `noEmit: true`，不参与 `--build`；回滚 = 删文件 + 还原 `eslint.config.mjs` |
| CI 转 blocking 后被 mobile 存量 lint 打红 | **高** | CI 红 | **已消解（MF-1 方案 a）**：本条不碰 `:58`，非 mobile 包的 lint blocking 走新增独立步骤（workspace 名写全）；`:58` 留给 mobile 收口后（记在 wave-a 的 mobile 格） |

---

## X2 · renderer typecheck 门禁

- **严重度 / 簇**：P1（N-P1-05，单源但机理无争议）· apps-desktop
- **病症**：渲染层 + 渲染层测试长期**零类型门禁**。`typecheck` 脚本只跑 `tsconfig.json`，
  而该配置的 `include` 不含 `renderer/`；`build` 走 `vite build`（esbuild 只转译不查类型）。
  `tsconfig.renderer.json` 存在但**没有任何以它跑 `tsc` 的 npm script 或 CI 步骤**
  （唯一引用它的是 `scripts/run-tests.mjs:34` 的 `npx tsx --tsconfig tsconfig.renderer.json --test`，
  不是类型门禁）。

### X2.1 证据

**`apps/desktop/package.json:11`**（逐行核对；`:12` 是 `build:icons`）：

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
```

**`apps/desktop/tsconfig.json:8`**：

```json
  "include": ["src/main/**/*", "shared/**/*"],
```

**`apps/desktop/tsconfig.renderer.json`** 的 `include` 是 `["renderer/**/*", "shared/**/*", "test/**/*"]`，
`lib: ["ES2022","DOM","DOM.Iterable"]`、`jsx: "react-jsx"` —— **以它跑 `tsc` 的** script / CI 步骤一条都没有
（`scripts/run-tests.mjs:34` 的 `npx tsx --tsconfig tsconfig.renderer.json --test` 是复用它给测试定编译上下文，
不产出类型门禁）。

**本分片实跑 `npx tsc --noEmit -p tsconfig.renderer.json` ⇒ 411 errors。**
按顶层目录分布与错误码分布（这决定分批顺序）：

| 目录 | 条数 | 错误码 Top |
|---|---:|---|
| `test/**` | 190 | TS18046 138、TS6307 69、TS2740 4、TS7017 5、TS7016 1 … |
| `renderer/**` | 178 | TS18046、TS2339 42、TS2345 18、TS6133 13 … |
| `src/**`（被 test 传递引入） | 42 | 全部 TS6307 |
| 仓外（`packages/core` dist） | 1 | — |

`renderer/**` 内部再切：`features/settings/` 一个目录占 **152 / 178**，
其中 `SettingsViews.tsx` **79**、`AgentEditorView.tsx` **25**、`ModelSamplingView.tsx` **18**、
`AgentDefinitionEditorForm.tsx` **12** —— 台账说的「四件占大头」在 renderer 口径下是
**134 / 178 = 75%**，成立。

**门禁有牙齿的直接证据**（本分片实跑命中 Wave B 已入账的 P1）：

```
renderer/features/chat/ChatHistorySearchPanel.tsx(106,20): error TS2345: Argument of type
  'IpcErrorPayload' is not assignable to parameter of type 'SetStateAction<string | undefined>'.
```

这正是 `ledger-v2.md:447` 的「§6 #5 查询失败面板白屏」。**一个今天就能被这条门禁抓到的 P1 就在基线里**，
是「424/411 不是 0、但先把它变成可见的红」这一策略的最强论据。
**（R1 定案 2026-10-01：baseline.md 实跑 = 411，与 sr1-e-a / sr1-apps-c 三源独立撞车；台账 424 已漂移作废，X2 全部基线计算以 411 打底。）**
🔗 **基线链路续（impl-E-c 回写，2026-10-01 实测）：424（台账 W11）→ 411（Wave E 撰写时）→ 371（Wave D 落地后同命令 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` 实跑，唯一口径 `error TS\d+` 行计数）。** 即棘轮的分母已经自然下降 40 条——X2 Step 2 的 `maxErrors` 初值若现在才落，应取 **371** 而不是 411；R1 定的 411 只作为「Wave E 撰写当时」的历史快照。

### X2.2 口径修正

- 台账 §2.8 记 **424** 条（W11 实测），本分片同命令实测 **411** 条。两者都不是 0，结论不变；
  **（R1 定案：411 已由 baseline.md 实跑 + 三源撞车确认为唯一权威数，424 作废；分批清单按 411 的分布执行，无需再调。）**
- `renderer/features/chat/ChatHistorySearchPanel.tsx:106` 的 TS2345 会在 Wave B 修完后消失，
  届时基线数字自然下降——这正是棘轮要的行为。

### X2.3 修法（文件·函数级步骤）

**Step 1 — 加 script（零风险，先让它跑起来）**
`apps/desktop/package.json` 的 `scripts` 增两条：

```json
"typecheck:renderer": "tsc --noEmit -p tsconfig.renderer.json",
"typecheck:renderer:ratchet": "node scripts/check-renderer-typecheck.mjs",
```

**Step 2 — 棘轮脚本 `apps/desktop/scripts/check-renderer-typecheck.mjs`（新建）**
行为：跑 `tsc --noEmit -p tsconfig.renderer.json`，把输出写到临时文件，**逐条解析成错误身份集合**
（每条取 `{ file, line, code, message }`；建议直接存 `tsc` 输出行的指纹，即
`renderer/x.tsx(106,20): error TS2345: <message>` 的整行），得到本次的**错误身份集合** `S`。
与 `apps/desktop/typecheck-renderer-baseline.json` 里的**基线身份集合** `S0` 比较：
- `S \ S0`（新增身份，**集合差集**）非空 ⇒ 打印这些新增项（按文件分组）并 `process.exit(1)`；
- `S ⊆ S0` ⇒ 打印 `|S| / |S0|` 并 `exit 0`。

**`maxErrors` 只作二级上限**（基线文件里保留 `"maxErrors": |S0|`，仅用于日志与人工 sanity check，
**不参与判红**）——判红只看集合差集。

**为什么基线必须存身份集合而不是纯计数**（这是本步的关键设计约束）：
纯计数棘轮有**净零绕过**漏洞——修掉 1 条、引入 1 条，总数不变 ⇒ `N == maxErrors` ⇒ 门禁放行，
「以修换坏」的置换型回归从门缝里溜过去；而单靠计数**也推不出身份**，「打印新增的那几条」无从谈起。
身份集合同时解掉两个问题：新增项 = `S \ S0` 的差集，且不允许置换（修 1 条引 1 条仍红）。

**这个设计是本条的关键**：它让门禁**第一天就 blocking**，同时允许错误数单调下降——
不需要先 `continue-on-error` 一轮再收紧，也不需要把 CI 拆成两个阶段。

**Step 3 — CI 挂载**（`.github/workflows/ci.yml`，Typecheck 步骤之后）

```yaml
      - name: Typecheck (renderer ratchet)
        run: npm run typecheck:renderer:ratchet -w @novel-master/desktop
```

**Step 4 — 分批清账（每批一个 PR，每批都把 `maxErrors` 往下调）**

| 批次 | 范围 | 预估减量 | 关键技术动作 |
|---|---|---|---|
| **R0** | `renderer/features/settings/WorkspaceSettingsView.tsx`（9 条 TS18046，`:103-112` 7 条 + `:153/:156` 2 条） | **−9** | 🔁 **R2-12 补录**。类型 `CompactionConditionsSetRequest` 已在 `shared/ipc-types.ts:1622` 与 `handlers/compaction-conditions.ts:25` 现成，只是没接进 `invoke-registry.ts:649/653`（该两行实测是裸 `noArg(...)` / `withReq<unknown, unknown>`）⇒ **纯补签名、零行为变更、零风险**。**归属依据 `wave-b-apps.md §5.3` 步骤 1**（judge-r1 B3 / D.3 终裁采纳「补 R0」）。搭 `wave-b-apps.md §1`（N-P1-04，同文件不同函数）的车同 PR 落地 |
| R1 | `test/**` 的 TS6307 族（69 条） | **−111** | 根因是 `test/**` import `src/main/**` 而 renderer 工程的 `include` 不含 `src/main`。**二选一**：(a) 把 `src/main/**/*` 加进 `tsconfig.renderer.json` 的 `include`（代价：renderer 门禁顺带覆盖 main，**`src/**` 那 42 条全 TS6307 一并归零**）；(b) 给测试单独开 `tsconfig.test.json`（desktop 已有 `tsconfig.renderer.json` 被 `run-tests.mjs` 复用，改动面更大）。**默认建议 (a)**——它零新增文件，且「renderer 门禁顺带覆盖被测试引用的 main 代码」本身是收益。**预估减量说明：`−69` 是仅按 (a) 清掉的 `test/**` TS6307；默认建议 (a) 会把 `src/**` 的 42 条一并归零，故实际减量为 `−111`。** |
| R2 | `renderer/features/settings/SettingsViews.tsx`（79） | −79 | 主因是 TS18046（`x` is of type `unknown`）与 TS2339，典型来源是把 `JSON.parse` / `unknown` 直接当对象用。逐个补窄化或 `as` 断言。 |
| R3 | `renderer/features/settings/{AgentEditorView,ModelSamplingView,AgentDefinitionEditorForm}.tsx`（55） | −55 | 含 2 × TS2704（对只读属性用 `delete`）与 TS2559（组件调用签名不符）。**`AgentDefinitionEditorForm.tsx` 是 Wave D 批次 3 的删除目标（1048 行零引用——sr1-e-c MF-8 标注口径：实跑 `Get-Content .Count` = **1047**，台账的「1048」疑为尾换行口径，**以 1047 为准**——先确认删除再决定修不修）**，见「依赖」。 |
| R4 | `renderer/components/ui/Tooltip.tsx`（5）与其余 components/layout（21） | −26 | `children.props` is unknown：Preact `ComponentChildren` 需要显式窄化 |
| R5 | `test/**` 剩余（121） | −121 | TS2740「假 `WebContents` 对象缺 135 个成员」×4 是最省力的一批：抽一个 `fakeWebContents()` 工厂。TS7016/TS7017（`.mjs` mock 无声明 / `globalThis` 无索引签名）需要 `declarations.d.ts`。 |
| R6 | 剩余长尾 | −N | 收尾；`maxErrors` 降到 0 时把脚本退化为纯 `tsc` 并删掉 baseline 文件 |

> 🔁 **R2-12 说明**：R0 是补录行，`wave-b-apps.md §5.3` 步骤 1 曾把这 9 条排在
> 「与 X2 的 R1–R6 不同的另一套排序」里，导致它们在 R1–R6 中无归属批次
> （judge-r1 D.3 复核：R1–R6 里确实没有 `WorkspaceSettingsView` 这一格）。
> 现已收敛为**唯一批次 R0**，R0 是「零风险第一刀」，排在 R1 之前。

**Step 5 — 归零后**：把 `check-renderer-typecheck.mjs` 换成裸 `tsc --noEmit -p tsconfig.renderer.json`，
删 `typecheck-renderer-baseline.json`，在 `baseline.md` 记终态数字。

### X2.4 验收（可测命令 + 期望）

```powershell
# ① 门禁本身可跑（期望：打印 "411 / 411" 形态的行并 exit 0）
cd apps/desktop; npm run typecheck:renderer:ratchet; echo "exit=$LASTEXITCODE"

# ② 棘轮真的会红（故意破坏 → 必须红，这是唯一有意义的验收）
#    在 renderer/features/chat/ConversationPanel.tsx:516 的 `payload` 后面加一句
#    `const _x: number = payload;`  → 期望 exit=1 且输出里出现该文件的 TS 错误
#    （RULE 判据①：把被测实现改坏就红 —— 成立）

# ③ 棘轮对下调敏感（把 maxErrors 调到 400 → 期望 exit=1；调回 411 → exit=0）

# ④ 每批清账后回归
cd apps/desktop; npm test                                  # 期望 0 fail
cd packages/core; npm test                                 # 期望 0 fail
```

### X2.5 测试策略

- 新增文件：`apps/desktop/scripts/check-renderer-typecheck.mjs`（门禁脚本，不是测试）。
- **不新增 vitest/jest 用例**——renderer 目前没有组件单测基建（desktop 走 `node --test`），
  为这条门禁新建测试基建属于超范围。门禁的可测性由「② 故意破坏」这一条命令保证。
- **牙齿三判据自检**：
  ① 有牙吗——把任一 renderer 文件改出类型错 ⇒ 棘轮红。成立。
  ② 会在我的进程/顺序约束下恒红吗——脚本每次独立起 `tsc` 子进程，无进程级状态，不涉及。
  ③ 同一夹具只服务一套期望吗——只有一套期望（`N ≤ maxErrors`）。成立。

### X2.6 回归线

- `apps/desktop` 全量 `npm test`（`--test-concurrency=2`，RULE 已记 desktop 满负载假信号）。
- `apps/desktop` `npm run lint src test renderer shared` 保持 0 error（X1 的成果）。
- `packages/core` 全量 `npm test`。

### X2.7 依赖

- **Wave A 的「CI typecheck 转 blocking」**——不是硬依赖（棘轮门自身 blocking），
  但**强烈建议同批**：两条都挂在 ci.yml 的 Typecheck 之后，一并 review 省一轮 CI 试错。
- **`baseline.md`（S1）**：本条的 `maxErrors` 初值以 baseline.md 为准；本分片给的 411 是 fallback。
- **Wave D 批次 3 删 `AgentDefinitionEditorForm.tsx`**：R3 批开工前必须先确认该文件是否已被删。
  若已删，R3 减量从 55 降到 43，**不要去修一个即将被删的文件**。
- **Wave B 的 §6 #5（ChatHistorySearchPanel）**：修完后基线自然减 1，属预期。

### X2.8 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 411 条里有大量「其实该改设计而不是加断言」的硬伤（尤其 R2 的 79 条 unknown） | 中 | R2 可能从 S 膨胀到 M | R2 开工前先抽 10 条做分类统计，写进 PR 描述；>30% 需改设计则拆成 R2a/R2b 并回本表拍板 |
| R1 选 (a) 后 renderer 门禁覆盖 `src/main`，与 `tsconfig.json` 的 typecheck 重复 | 高 | 门禁耗时翻倍（当前 desktop typecheck 秒级，加 renderer 后数十秒） | 可接受（CI 30 分钟预算富余）；若嫌慢，改选 (b) |
| 棘轮 `maxErrors` 被后人「顺手调到很大」绕过 | 中 | 门禁名存实亡 | baseline 文件的改动必须在 PR 里单独说明理由；R1~R6 每批都下调，禁止上调 |
| 移动/编辑器对 `delete` 只读属性等 TS2704 的修法引入行为变更 | 低 | 运行时回归 | TS2704 一律改为「构造新对象」而非 `delete`，逐条 review diff |

---

## X3 · WebView 产物门禁（N-P0-01 的唯一防再犯钩子）

- **严重度 / 簇**：P0 级病症的**门禁**（P2 工作量）· apps-mobile 构建链
- **病症**：`composer-input` WebView bundle 在 IIFE 顶层执行 `Object.fromEntries`。
  `Object.fromEntries` 是 Chrome 73+，`minSdkVersion=26`（Chromium 58）⇒ 旧 WebView 顶层直接
  `TypeError`，编辑器不挂载、ready 不上报、宿主等不到握手 ⇒ **chat 内联输入框白屏级无响应**。
  源码面完全看不出来（`prompt-macro-input.ts` 只 import 了一个常量数组）。

### X3.1 证据

**产物实测**（`fe79b781` 的 `apps/mobile/webview-dist/composer-input/app.js`，21 716 字节）：

```
Object.fromEntries 首次出现在 index=4907
mountComposerEditor 在 index=18778          ← 顶层调用先于挂载，白屏机理成立
```

**源码根因链实测**（本分片用 esbuild metafile 重跑 `build-webview.mjs` 的 `bundleAppJs` 参数复现）：

```
composer-input | inputs=14 node_modules=0
  core=[ dist/public/prompt.js, dist/infra/tdbc/index.js, dist/domain/prompt/logic/message-body.js,
         dist/domain/prompt/logic/validate-dynamic-macros.js, dist/domain/provider/logic/builtin-providers.js ]
rich-document  | inputs=775 node_modules=756  core=[]
code-editor    | inputs=34  node_modules=21   core=[]
chat-transcript| inputs=926 node_modules=822  core=[ …59 个 dist 模块… ]
```

为拿 3 个宏白名单字符串常量，**经 `@novel-master/core/prompt` barrel 拖进了 `infra/tdbc/index.js`
（数据库驱动抽象层）与 `domain/provider/logic/builtin-providers.js`**——后者正是 bundle 里
`BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(BUILTIN_PROVIDER_ROWS.flatMap(...))` 的来源。

**这是本条最重要的发现，也是必须写进 spec 的设计约束：**
台账 `ledger-v2.md:80/489` 提的「bundle 里出现这 4 个构造即 fail」这个门禁形态**在 `fe79b781` 上会让
3/4 个包立刻红**（明细见下表），因为两个 8MB 大包的主体是第三方库（mermaid；CodeMirror 在 1MB 的
code-editor 包里，那一格本就是误判），不是我们的代码。

| 包 | 体积 | `Object.fromEntries` | `replaceAll` | `.at(` | `Object.hasOwn` | `structuredClone` |
|---|---:|---:|---:|---:|---:|---:|
| chat-transcript | 8659 KB | 6 | 41 | 18 | 12 | 11 |
| rich-document | 7954 KB | 4 | 37 | 18 | 12 | 11 |
| code-editor | 981 KB | — | — | — | **—** | — |
| composer-input | 21 KB | **5** | — | — | — | — |

> **`code-editor` 那格的勘误（sr1-e-b MF-1 / X3-2）**：本分片原写的 `Object.hasOwn = 1（CodeMirror）`
> 是**朴素子串计数把 `Object.hasOwnProperty` 误伤**的结果。实际那一处是
> `if (Object.prototype.hasOwnProperty.call(json2, prop)) {`（`@codemirror/language` 的 `jsonParse`，
> ES5 全兼容）；用严格正则 `Object\.hasOwn(?!Property)` 在 code-editor 上命中 **0**。
> ⇒ 该包五个构造**真实命中数为 0**，「4/4 包先天命中」应为 **3/4**。
> **匹配语义纪律（门 C 口径的根因，见 §X3.2 门 C）**：`Object.hasOwn` 一律用
> `Object\.hasOwn(?!Property)` 匹配，不许裸子串。

**而一方源码面是干净的**：`apps/mobile/src/web/**` + `apps/mobile/src/webview-host/**` 全量扫描
这 5 个构造 ⇒ **0 命中**。

#### X3.1.1 既有 typecheck 门与门 A 的重叠／互补（sr1-e-b MF-3）

门 A 并不是「从零起的一道新门」，它与**既有的编译期门**有重叠，必须写清楚净增量：

- `apps/mobile/src/web/tsconfig.json` 的 `lib: ["ES2018","DOM"]` **已经在编译期拦掉 5 个构造中的 4 个**
  ——用 `extends` 真 tsconfig 的探针实测报 `TS2550`：`Object.fromEntries` / `Array.prototype.at` /
  `String.prototype.replaceAll` / `Object.hasOwn` 全部编译红；
- **唯一漏网的是 `structuredClone`**（它声明在 `lib.dom.d.ts` 里，`lib:ES2018` 拦不住）
  **加上非类型检查路径**（`.js`/`.mjs`、以及任何不参与 `tsc` 的代码）。
- ⇒ **门 A 的净增量 = `structuredClone` + 非类型检查路径**。这不削弱门 A 的价值
  （ESLint 报错信息更贴近「WebView 老浏览器」语境、且覆盖非类型检查路径），
  但**验收时不要把「4/5 构造」当成门 A 的功劳**。

### X3.2 修法（文件·函数级步骤）

因此本条**拆成两道门**，各司其职：

**门 A · 源码级 ESLint 规则（主力，第一天即可 blocking、零存量债）**
`apps/mobile/eslint.config.mjs` 追加一个块的 `files`：
`['src/web/**/*.{ts,tsx}', 'src/webview-host/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}']`
（**第三个 glob 是 sr1-e-b MF-2 的增补，原文漏了**），启用三条内置规则 + 一条自定义：
- `no-restricted-properties`：`Object.fromEntries` / `Object.hasOwn` / `structuredClone` ⇒ error；
- `no-restricted-syntax`：`MemberExpression` 形如 `X.at(` / `X.replaceAll(` ⇒ error；
- 自定义 `novel-webview/no-es2020-builtin`（写在同文件内，与 core 的 S-5 自定义规则同款形态）
  承载前两条表达不了的形态，报错信息里写明「WebView 运行在 minSdk 26 / Chromium 58，
  只按老浏览器环境写（RULE：mobile webview 改动是三层产物链）」。

**⚠️ 为什么 `src/components/**` 必须进 glob（sr1-e-b MF-2，esbuild metafile 实测）**：
按 metafile 的一方输入归因，`composer-input` 包里 14 个 first-party inputs 有 **3 个落在
`src/components/**`**——`components/agent/prompt-macro-input.ts`、`components/chat/composer-highlight.ts`、
`components/common/atomic-range-delete.ts`；`code-editor` 包里也有 1 个
（`components/chat/composer-highlight.ts`）。**`prompt-macro-input.ts` 正是 N-P0-01 病根链的必经点**，
只扫 `src/web/**` + `src/webview-host/**` 的门 A 对原 P0 **完全失明**。

**⚠️ 门 A 覆盖不到的范围（显式声明，别让读 spec 的人误以为门 A 是全覆盖）**：
门 A 只作用于**一方源码面**。① 它**看不到 `packages/core/dist`**——N-P0-01 的真正病灶
`builtin-providers.js` 的顶层 `Object.fromEntries` 就在 core dist 里，只能由门 B 对住；
② 它看不到 `node_modules`（第三方库）；③ 见 §X3.1.1，与 `src/web/tsconfig.json` 的 `lib:ES2018`
编译期门**重叠 4/5**。
<!-- ✅ judge-r1 B12 已裁定：glob 扩到 `src/components/**`（采纳分片默认案）。
     **但裁定附了一个前置条件**，该条件必须写进本 Step 1 的验收：
     ① 扩 glob 的理由是 `prompt-macro-input.ts` 就在 `src/components/**` 下，不扩则门 A 对
        N-P0-01 病根完全失明（judge 原话）；
     ② **代价**：§X3.1 的「一方源码面 0 命中」是在 `src/web/**` + `src/webview-host/**` 两个 glob 上测的，
        扩到 `src/components/**` 之后这个 0 **不再自动成立**，必须**按新 glob 重测**才能继续支撑
        「首日即绿」（§X3.4 判据②）；
     ③ **兜底分支**：若按新 glob 重测后存量报错超出预期、0 命中不成立，
        **改走 metafile 清单案**——按 §X3.2 门 B 步骤 2 产出的 metafile inputs 清单逐个列 `files` 条目
        （只覆盖实测进 bundle 的一方输入），而不是整片扫 `src/components/**`。
     ⇒ 前置条件已进入 §X3.3 验收命令 ① 与 §X3.4 判据②，不留「首日即绿」的无条件断言。 -->

> 为什么不直接扫 bundle 做门 A？因为 bundle 里的命中几乎全来自第三方库（见上表），
> 门 A 要拦的是**我们新增的**违规，第三方不是我们的责任面。

**门 B · 产物级「依赖准入白名单」（真正对住 N-P0-01 成因的那条）**
改 `apps/mobile/scripts/build-webview.mjs`：
1. `bundleAppJs` 的 esbuild 调用加 `metafile: true`
   （⚠️ sr1-e-b MF-4：原文说「当前已有 `write:false` 探针路径可复用」**指错了函数**——
   `write:false` 在 `loadWebModule()`（喂 CSS 常量用），`bundleAppJs()` 走 `outfile` 落盘，
   两者是不同函数，没有可复用的探针路径）；
2. 读 metafile outputs 里的 inputs 键集合，过滤出 `packages/core/dist/**` 的条目。
   **⚠️ 取值写法（MF-4，原写法会抛）**：`metafile.outputs` 的键是**相对 cwd 的路径**
   （`webview-dist/composer-input/app.js`），用**绝对** `outfile` 去索引会拿到 `undefined`，
   紧接着的 `.inputs` 直接抛错。两种正确写法二选一：
   - `Object.values(metafile.outputs)[0].inputs`（`bundleAppJs` 每次只产一个输出，最简）；
   - 或用**相对** outfile 作键：`metafile.outputs[relative(cwd, outfile)].inputs`。
3. 与同文件内一张显式白名单常量 `WEBVIEW_CORE_ALLOWLIST`（**按包 id 分组**）比对，
   出现白名单外的 core 模块 ⇒ 打印该模块路径 + 「谁 import 了它」并 `process.exit(1)`。

**白名单初值（= 本分片实测的当前集合，上线时照抄）**：
- `composer-input`：`public/prompt.js`、`infra/tdbc/index.js`、`domain/prompt/logic/message-body.js`、
  `domain/prompt/logic/validate-dynamic-macros.js`、`domain/provider/logic/builtin-providers.js`
  —— ⚠️ **这 5 个里只有前 3 个合理**，`tdbc/index.js` 与 `builtin-providers.js` 就是 P0 的病根。
  **默认建议：Wave A 修 N-P0-01（改成深层直引 / 内联 3 个字符串）时，把白名单同步收成
  `["domain/prompt/logic/validate-dynamic-macros.js"]` 之类的最小集**，门 B 从此对住病根。
- `chat-transcript`：59 个 core 模块（`vfs-tools.js` / `subagent-tool.js` / `agent-tool.js` /
  `sqlite-vfs-revision.repository.js` / `search/search-tool.js` 及其 6 个搜索引擎 / `usage-stats.service.js` …）。
  **默认建议：本次只把这份 59 条原样写进白名单当基线**，收敛它是独立议题（与 Wave C 的性能波合并评估），
  不在本条范围。
- `rich-document` / `code-editor`：空数组（实测 0 个 core 模块）。

**门 C · 产物级文本棘轮（可选，建议同批做，成本 30 行）**
`build-webview.mjs` 写完 `app.js` 后，按 §X3.1 的表对 5 个构造做**计数**并与
`apps/mobile/webview-compat-baseline.json` 比对，**任何计数上升即 fail**。
不做「出现即 fail」是因为第三方库；做「不许变多」既能抓住我方新增违规，又不会与上游库升级打架。
唯一能抓住而门 A 抓不到的一类：**某个我们控制的一手依赖升级**（如换 CodeMirror 版本）把新构造带进来。

**⚠️ 计数口径必须写死成「调用点」而不是「子串」（sr1-e-b MF-5）**：
上表的数字是**子串口径**下的观测值；若门 C 的基线也按子串统计，第一天就会把**已有的伪信号**固化成基线。
实测证据（metafile 归因 + 逐处开源码复核）——`chat-transcript` 包里我方仅有 9 处命中，
全部来自两个 core dist 模块，**逐处确认没有一处是 `String.prototype.replaceAll` 调用**：

| 来源模块 | 命中 | 实际形态 |
|---|---:|---|
| `packages/core/dist/domain/tool/builtin/skill-tool.js` | `replaceAll` × 4 | `replaceAll: z.boolean().optional().describe(...)`、中文描述里的「（可配 replaceAll）」 |
| `packages/core/dist/domain/tool/builtin/vfs-tools.js` | `replaceAll` × 5 | `{ oldString, newString, replaceAll: input.replaceAll }` 等**对象字段名** |

即 zod 的**字段名与描述文本**。若按 `replaceAll` 子串计数，这 9 处会进基线 ⇒ 上游改个字段名就棘轮红。
⇒ **门 C 的正则必须带调用语义**：
`.replaceAll(` / `Object.fromEntries(` / `Object.hasOwn(`（配负向断言 `Object\.hasOwn(?!Property)\(`）/
`structuredClone(` / `X.at(`，即**只数「调用点」**。
**基线 JSON 的初值也必须用同一套正则实测**，不得沿用 §X3.1 表里的子串口径数字。
（`rich-document` 侧的命中经 metafile 归因是 **100% 落在 `node_modules`**，我方命中 0，
所以这 9 处伪信号全部来自 `chat-transcript`。）

### X3.3 验收（可测命令 + 期望）

```powershell
# ① 门 A：源码级，期望 0 error
cd apps/mobile; npx eslint src/web src/webview-host
# ①a 🔁 R2-13 前置条件：glob 扩到 src/components/** 之后，**必须按新 glob 重测一次 0 命中**，
#     原来的 0 是在只有两个 glob 的老面上测的，不能直接沿用
cd apps/mobile; npx eslint src/web src/webview-host src/components
#     期望仍 0 error。不成立（存量报错超出预期）⇒ **不降级门 A 覆盖面，改走 metafile 清单案**：
#     按门 B 步骤 2 的 metafile inputs 逐个列 files 条目，只覆盖实测进 bundle 的一方输入

# ①' 门 A 的牙齿：在 apps/mobile/src/web/shared/post.ts 顶上加一行
#    `export const _probe = Object.fromEntries([['a', 1]]);`  → 期望 eslint 报 no-restricted-properties

# ② 门 B：依赖准入
cd apps/mobile; npm run build:webview            # 期望构建成功且不报「白名单外 core 模块」
#    牙齿：在 src/web/composer-input/webview/runtime/ 里加一行
#    `import '@novel-master/core/vfs';`          → 期望 build 失败并打印 dist/vfs/... 路径

# ③ 门 C：产物棘轮
cd apps/mobile; node -e "…按 §X3.2 门 C 的调用点正则读 webview-dist/*/app.js 统计 5 个构造计数…"
#    牙齿：把 composer-input 的 Object.fromEntries **基线改成 4**（实际值 5 高于基线）
#          → 期望 npm run build:webview 失败（sr1-e-b MF-6：原文写「改成 6」方向反了——规则是
#            「任何计数上升即 fail」，基线 6 > 实际 5 属**下降**，按规则不会红；必须把基线改小）

# ④ 端到端（Wave A 修完 N-P0-01 后）
cd apps/mobile; npm run build:webview
Select-String -Path webview-dist/composer-input/app.js -Pattern 'Object.fromEntries'  # 期望 0 行输出
```

> **本条与「验收 = 故意塞一个 `.at(` 进源码跑构建必红」的关系**：台账 §10 Wave E 的这句验收在
> **门 A**（源码级 eslint）下成立且当天可跑；在**产物级**形态下不成立（3/4 包先天命中）。
> 本分片按门 A 兑现这条验收，并额外给出门 B/C 作为产物面的兜底。

### X3.4 测试策略

- `apps/mobile/scripts/build-webview.mjs`（改）+ 新增 `apps/mobile/webview-compat-baseline.json`。
- 门 A 走既有 `npm run lint`（mobile lint 脚本是 `eslint . --max-warnings 321`），
  新规则放在 `src/web/**` 块里，**不新增 warning 计数**（error 不计入 warnings）。
- **牙齿三判据自检**：
  ① 有牙吗——源码里加一个 `Object.fromEntries` ⇒ 门 A 红；把白名单删一条 core 模块 ⇒ 门 B 红。成立。
  ② 恒红吗——门 A 在 `fe79b781` 上一方源码 0 命中，首日即绿（无恒红风险）；
  门 B 的白名单是实测集合，首日即绿；门 C 的基线是实测计数，首日即绿。
  ③ 一夹具两期望吗——否。

> 🔁 **R2-13 写入判据② 的前置条件（judge-r1 B12 裁定附条件）**：判据② 里「门 A 首日即绿」这句
> **只在新 glob（`src/web/**` + `src/webview-host/**` + `src/components/**`）上重测出 0 命中后才成立**。
> **落地 Step 1 时必须先按新 glob 跑一遍 `npx eslint src/web src/webview-host src/components`**，
> 实测 0 才允许保留「首日即绿」这句；不成立就**改走 metafile 清单案**（按 §X3.2 门 B 步骤 2 的
> metafile inputs 清单逐个列 `files` 条目）。
> **理由**：旧面的 0 命中是在两个 glob 上测的，`prompt-macro-input.ts` 落在 `src/components/**` 内
> 且正是 N-P0-01 病根链的必经点——不扩 glob 门 A 对病根失明，扩了 glob 又必须重测，
> 这两条是一体的，不能只做前半条就宣布「首日即绿」。

### X3.5 回归线

- `apps/mobile` `npm run build:webview` 成功 + 4 个包产物体积与 baseline 差 < 5%。
- `apps/mobile` `npm run typecheck`（含 `src/web/tsconfig.json` 那一路）。
- `apps/mobile` `npm test`（mobile 侧有 8 个套件依赖 `webview-dist` 产物，RULE 已记）。
- `apps/mobile` gradle `checkWebViewAssets` 门禁（RULE 已记：缺 webview 资产会拦 assembleDebug）。

### X3.6 依赖

- **Wave A 的 N-P0-01 修法**（`prompt-macro-input.ts` 改深层直引或内联 3 个字符串）——
  门 B 的 `composer-input` 白名单应当在 N-P0-01 落地**之后**收紧到最小集。
  若 Wave A 未先落，门 B 白名单就照 §X3.1 的 5 条原样写（此时门 B 仍能抓住**下一次**扩散）。
  **⚠️ 这条依赖目前未闭合**（sr1-e-b MF-15）：`fix-spec/state.md:19` 显示 `s-wave-a` 仍 `pending`、
  `wave-a.md` **尚不存在**。⇒ 写成硬 gate 条件：
  **`wave-a.md` 未落盘前，门 B 的 `composer-input` 白名单按 §X3.1 的 5 条原样上线**；
  只有在 wave-a 的 N-P0-01 修法成文且落盘后，才把白名单收成最小集。
  **不得在 wave-a 未定稿时擅自收紧**（否则 Wave A 落地后需要二次改回）。
- **X1（摘 CI `Lint` 的 `continue-on-error`）**（sr1-e-b MF-3）：`.github/workflows/ci.yml` 的
  `Lint` 步骤实测带 `continue-on-error: true` ⇒ **在 X1 摘掉它之前，门 A 根本不会阻断 CI**。
  「门 A 第一天即可 blocking」这句只在 X1 落地后成立。归 X1 / wave-a 负责，本条只承接。
- 与 Wave C 无耦合。

### X3.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 门 B 白名单写死 59 条 chat-transcript 条目，后续有人「顺手加一条」绕过门 | **高** | 门 B 失效 | 白名单条目必须写注释说明「为什么需要」；PR review 时逐条问「删了会怎样」。回滚 = 把该模块加回白名单并写明理由 |
| 门 C 的计数棘波在第三方库升级时被误伤 | 中 | 发版被卡 | 升级 PR 里同时更新 baseline JSON（这是预期动作，不是绕过） |
| 门 A 的自定义规则误报（`.at(` 也会匹配 `Map.prototype.at` 的合法用法） | 低 | 开发者烦 | 规则允许行内 `eslint-disable-next-line` + 必须写 WHY |
| 改 `build-webview.mjs` 影响 4 条 `npm run build:webview*` 脚本链 | 低 | mobile 全链路 build 失败 | `metafile: true` 是 esbuild 官方选项，不改变输出；验收跑一遍 `build:webview:native` 确认拷贝链未断 |

---

## X4 · `tsconfig.test.json` paths 与 `package.json` exports 对齐（sr1-e-a MF-2 补节）

**严重度/簇**：P2 · core 测试基建（**定级口径：这是「加一道防漂移守卫」，不是功能修复**——
w9-bootstrap-pro 实测两份 barrel 逐行对应、内容等价；守卫防的是未来漂移，sr1-e-a MF-13④）。

### X4.1 病症与证据（`fe79b781` 实读）

`packages/core/tsconfig.test.json:26` = `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]`
（**内部 barrel**）；`packages/core/package.json:81-83` 的 `"./kkv"` exports 指向
`./dist/public/kkv.js`（**公共 barrel**）⇒ 同一子路径两处指向不同 barrel。
后果：core 测试跑在 `tsx --tsconfig tsconfig.test.json` 下，bare specifier 被 paths 接管
解析到 `src/public/*.ts`——现有 12 项契约测试验的全是 src barrel；而 `kkv` 压根不在
`test/package-exports/public-subpath-allowlist.test.ts:5-18` 的 SUBPATHS 里（12 项不含它），
**即 kkv 目前零契约覆盖**（比台账「验的是错的 barrel」更精确的表述）。
先例条文：RULE「给 core 新增 exports 子路径必须同步 tsconfig.test.json paths」。

### X4.2 修法（四条约束写死，sr1-e-a §5.2）

1. **测试解析必须显式绕开 tsx 的 paths**：`import("@novel-master/core/kkv")` 在 tsx 下
   仍会被 paths 接管到 `src/service/kkv/index.ts`，**无效**。写法二选一：
   `new URL("../../dist/public/kkv.js", import.meta.url)` 相对导入，或
   `createRequire(import.meta.url).resolve("@novel-master/core/kkv")`（走 node exports 解析）。
   本 spec 定：用 `createRequire().resolve()` 解析 + 断言解析产物路径以 `dist/public/kkv` 结尾，
   再 `import()` 之。
2. **恒红防护**（判据②）：`dist/` 是 gitignore 产物且可能陈旧（verify-dead 实测过旧 dist）。
   新 clone / 未 build 环境必红。三选一（定：①+②）：① 测试文件头注释声明前置
   `npm run build -w @novel-master/core`；② CI 侧排在 `Build workspaces`（`ci.yml:50-51`）之后；
   ③ dist 缺失时 `test.todo` 降级（不采，守卫不该静默跳过）。
3. **与 D-207 的方向协调（跨分片依赖，必须写进依赖栏）**：D-207（wave-d 批次 2）要删
   `packages/core/src/service/kkv/index.ts` 并**连带删 `tsconfig.test.json:26` 的映射**。
   本条不改动 paths 本身（只加守卫测试）⇒ 与 D-207 天然兼容：D-207 落地删映射后，
   本守卫测试恰好继续验证「删掉映射后 exports 解析仍指向公共 barrel」。**顺序约束：
   若 D-207 先落，本条测试无需改；若本条先落，D-207 实施时须跑本测试确认仍绿。**
4. **SUBPATHS 补 `kkv`**：把 `kkv` 加进 `public-subpath-allowlist.test.ts` 的 SUBPATHS
   （12→13 项），让常规契约测试也覆盖它（仍验 src barrel，但至少有名单）。

### X4.3 验收

新增 `test/package-exports/public-kkv-dist-resolution.test.ts`：
`createRequire(import.meta.url).resolve("@novel-master/core/kkv")` 的解析路径含 `dist/public/kkv`
且 `import()` 成功、导出非空对象；故意把 exports 指回内部 barrel（或删 exports）⇒ 必红。

### X4.4 测试策略 / 回归线 / 依赖 / 风险

- 测试策略：如上新增一个文件（含 dist 缺失时的清晰失败信息，提示先 build）。
- 回归线：`test/package-exports/` 既有 12 项 allowlist 全绿不变。
- 依赖：**D-207（wave-d 批次 2）**——见 X4.2 第 3 条的顺序约束；`baseline.md`（build 前置）。
- 风险与回滚：纯新增测试，单文件 revert 即回滚。

---

## H1 · 钩子① 编码（U+FFFD / BOM 扫描）

- **严重度 / 簇**：P2 · 全仓
- **病症**：编码损坏（U+FFFD 替换字符）与 UTF-8 BOM 已经进了版本库，
  且**没有任何门禁**阻止它们再次进入。BOM 还会让部分工具链把首行当 BOM 处理。
  更危险的是：损坏一旦进到**运行时字符串**里就是静默的用户可见错误，
  而目前它们藏在注释和测试标题里纯属侥幸。

### H1.1 证据

**本分片字节级实测（`fe79b781`）**：

- **U+FFFD 共 9 个文件**：`packages/core/src/infra/llm-protocol/logic/tool-definitions.ts`、
  `packages/core/src/infra/sksp/impl/composite-secret-store.ts`、
  `packages/core/src/infra/sksp/logic/ref-to-env.ts`、
  `packages/core/src/infra/sksp/ports/secret-store.port.ts`、
  `packages/core/test/agent/agent-runner.test.ts`、
  `packages/core/test/chat/message-body-text.test.ts`、
  `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts`、
  `apps/mobile/src/services/session-prompt-input.service.ts`、
  `apps/desktop/src/main/ipc/handlers/vfs.ts`。

  逐行核对**损坏位置全部在注释或 `it()` 标题里**，无一处运行时字符串。例如
  `packages/core/src/infra/sksp/logic/ref-to-env.ts:8`：

  ```
   * `provider/<id>/apiKey` ??`NOVEL_MASTER_PROVIDER_<ID>_API_KEY`.
  ```

  （`??` 即两个 U+FFFD，原本是 `→` 之类的符号。）

- **BOM 共 20 个文件**（`packages/**`，不含 node_modules / dist）：
  `packages/core/src/` 下 **4 个**——`domain/vfs/logic/extract-mutating-paths.ts`、
  `infra/llm-protocol/logic/sse-parse-errors.ts`、`infra/llm-protocol/logic/tool-arguments-parse.ts`、
  `service/session-fs/create-session-fs-service.ts`；`packages/core/test/` 下 15 个；
  `packages/core/docs/public-api.md` 1 个；`packages/sksp-android/test/rn-mock-hook.mjs` 1 个。
  **`apps/` 下 0 个。**

- **无既有门禁**：仓库根 `package.json` 无 husky / lefthook / simple-git-hooks 依赖，
  `.github/` 只有 3 个 workflow（`ci.yml` / `release.yml` / `android-nightly.yml`），
  没有任何编码扫描步骤。

### H1.2 口径修正

**实测与台账一致，178 这个数字成立（sr1-e-b MF-7 勘误）**：
`fe79b781` 上 `apps/mobile/src/services/session-prompt-input.service.ts` 的 U+FFFD
**恰好 178 处、分布在 26 行**，与台账 `ledger-v2.md:439`「从父提交还原 178 个 U+FFFD」
**完全吻合**。（⚠️ 本分片初稿曾写「只剩 1 个文件、**约 24 处**，与 178 差两个数量级」，
并据此推出「批次 1 已在别的分支部分执行 / 178 是历史某提交」两解——**两解都不成立，是错误数据推出来的，已作废**。）

⇒ **178 是 Wave A 编码还原批次 1 的规模依据**，不是历史遗留值；
`★5 拍板项（先还原 7 个纯注释文件）仍然卡着 `apps/mobile` 的修复动作**，门禁本身不受 ★5 阻塞。
**门禁初值一律以 `baseline.md` 的同一次实跑为准**（RULE：计数类结论一律实测），
但规模估算按 178 走。

### H1.3 修法（文件·函数级步骤）

**Step 1 — 扫描脚本 `scripts/check-encoding.mjs`（新建，仓内工具，遵守 RULE「可复用工具收编 scripts/」）**
零依赖，`node:fs` + 字节读：
1. 递归遍历 `apps/` `packages/` `scripts/`，过滤后缀 `.ts/.tsx/.js/.mjs/.json/.md/.yml/.kt/.java/.gradle`，
   排除 `node_modules/`、`dist/`、`webview-dist/`、`android/app/build/`、`coverage/`、`.git/`，
   **外加 `apps/*/android/**`（至少 `**/build.gradle`，sr1-e-b MF-8）**——
   ⚠️ 原先只排 `android/app/build/`（**目录**、带尾斜杠）而 `apps/mobile/android/app/build.gradle`
   的**路径串不含**该子串 ⇒ 会被扫到，而它有 **20 处 U+FFFD 且 `TextDecoder(fatal)` 判非合法 UTF-8**
   （RULE:113 已记它是 **GBK 混编**、必须字节级替换）⇒ 门禁**恒红**。
   排除它的理由写进脚本注释：GBK 混编文件属另一条修复线（Wave A），本门禁不接管。
   **同时显式声明：`docs/` 不在扫描面内**（实测 `docs/Iterations/` 下另有 3 个 BOM + 2 个 FFFD，
   不算错，但必须声明，否则读者会误以为全仓干净）；
2. 读 Buffer：前三字节 `EF BB BF` ⇒ 报 `bom`；按 UTF-8 解码后含 `\uFFFD` ⇒ 报 `fffd`；
   （**注意**：文件本身不是合法 UTF-8 时解码会产 replacement char，脚本要区分
   「原本就含 FFFD」与「解码失败」两种情形并分别报——前者才是本条要治的）；
3. **只读 git 跟踪文件**更准：用 `git ls-files -z` 取清单（避免扫到本地 scratch）。
   ⚠️ 子代理禁 git 写，但 `git ls-files` 是只读，脚本在 CI 与提交钩子里跑没有问题；
4. 命中即打印 `path:line` 并 `process.exit(1)`。

> **基线数字必须按脚本的真实扫描范围重测（MF-8）**：§H1.1 的「9 个 U+FFFD / 20 个 BOM」是在
> `apps/*/src` + `packages/**` 范围上测的，**与脚本的扫描面不一致**。落地 Step 1 时先跑一遍
> 全量扫描拿到真实命中清单，再据此建基线，不要沿用 §H1.1 的 9/20。
> 已知差异：`apps/mobile/android/app/build.gradle` 会被新扫描面命中（20 处 FFFD、非合法 UTF-8），
> 排除后其余命中应与 §H1.1 一致。
> 🔗 **已裁（judge-r1 B13）**：MF-8 只要求「按脚本真实扫描范围重测」，**本 spec 不代填精确总数**——
>      已知增量只有 `build.gradle` 这一个；scripts/ 目录（后缀 .mjs/.js）的实测交**实施机位**重测后回填。

**Step 2 — 提交钩子**
仓内**没有** husky 之类基建，故走零依赖路线：
- 新增 `.githooks/pre-commit`（ASCII-only，RULE「.cmd 批处理按 ANSI/GBK 解析」的同族纪律），
  内容 `node scripts/check-encoding.mjs --staged`；
- 根 `package.json` 加 `"prepare": "node scripts/link-hooks.mjs"` 或直接在 README/AGENTS 记
  `git config core.hooksPath .githooks`（一次性、每个 clone 需执行 ⇒ 必须在 README 显著位置写明）。

**Step 3 — CI 步骤**（`.github/workflows/ci.yml`，`Format` 之后）

```yaml
      - name: Encoding
        run: node scripts/check-encoding.mjs
```

**Step 4 — 清账（与 Wave A 编码批次同批，本条负责 core + 全仓 BOM）**
- **core 4 个 BOM 文件**（`extract-mutating-paths.ts` / `sse-parse-errors.ts` /
  `tool-arguments-parse.ts` / `create-session-fs-service.ts`）与编码批次同批处理，去 BOM **只动前 3 字节**。
- **core 15 个 test BOM + `core/docs/public-api.md` + `sksp-android/test/rn-mock-hook.mjs`** 同批去 BOM。
- **7 个 U+FFFD 文件**（4 个 core src + 3 个 core test）与批次同批还原为正确字符；
  `apps/mobile/src/services/session-prompt-input.service.ts`（**178 处 / 26 行**，见 §H1.2 勘误）与
  `apps/desktop/src/main/ipc/handlers/vfs.ts`（2 处）一并处理。
- **纪律：清账分两类，修法不同（sr1-e-b MF-9）**——9 个 U+FFFD 文件里
  **4 个是非法 UTF-8**（`TextDecoder(fatal)` 解码失败），文件里**根本没有 U+FFFD 这个码点**，
  坏的是**原始字节**：

  | 类别 | 文件 | 修法 |
  |---|---|---|
  | **A 类：合法 UTF-8 内嵌真 FFFD**（5 个）`tool-definitions.ts` / `composite-secret-store.ts` / `agent-runner.test.ts` / `openai-content-mapper.test.ts` / `vfs.ts` | 码点确实存在 | **Edit 工具做字节级安全替换**（RULE：PowerShell 管道改写 UTF-8 中文文件必毁编码） |
  | **B 类：非合法 UTF-8，坏的是字节**（4 个）`session-prompt-input.service.ts`(178) / `ref-to-env.ts`(1) / `secret-store.port.ts`(1) / `message-body-text.test.ts`(3) | 无 FFFD 码点 | **不可逐字符替换**（找不到东西可替换）⇒ **从父提交整体还原**（与台账「从父提交还原」一致），落地用 `git checkout <父提交> -- <路径>`，再 `git diff --numstat` 逐行核对 |

  ⇒ 原稿「一律用 Edit 工具做字节级安全替换」**只对 A 类成立**，B 类照做会得到「什么都没改」的空 diff。
  两类共同的验收：`git diff --numstat` 逐文件核对，只应有被改的那几行。

### H1.4 验收（可测命令 + 期望）

```powershell
# ① 门禁可跑且当前状态是「红」（期望：列出 U+FFFD 与 BOM 文件清单并 exit 1）
node scripts/check-encoding.mjs; echo "exit=$LASTEXITCODE"

# ② 门禁的牙齿：在任意 .ts 文件里插一个 U+FFFD → 期望报出该文件与行号
#    在任意 .ts 文件首部写 BOM → 期望报 bom

# ③ 清账后（期望：exit 0 且无输出）
node scripts/check-encoding.mjs; echo "exit=$LASTEXITCODE"

# ④ 回归
cd packages/core; npm test        # 期望 0 fail（改的 7 个 FFFD 文件里 3 个是测试文件）
cd apps/desktop; npm test         # 期望 0 fail
cd apps/mobile; npx jest --maxWorkers=2   # 期望全绿（RULE：mobile 降并发跑）
```

### H1.5 测试策略

- 新增：`scripts/check-encoding.mjs`、`.githooks/pre-commit`。
- 门禁的测试就是「①故意破坏 → 红 / ③清账后 → 绿」，不写单测。
- **牙齿三判据自检**：① 有牙吗——插一个 FFFD ⇒ 红；成立。
  ② 恒红吗——清账前门禁是红的，这是**预期**（Step 3 上 CI 的时点必须在 Step 4 清账**之后**，
  否则 CI 从第一天就红）；判据②问的是「测试本身会不会恒红」，本条的门禁在 Step 4 完成后恒绿。成立。
  ③ 一夹具两期望吗——否。

### H1.6 回归线

- `packages/core` / `apps/desktop` / `apps/mobile` 三包 `npm test`。
- **改动面零漂移**：`git diff --numstat` 逐文件核对，**只含目标行**（去 BOM 只应有 `-1/+1`
  或行数不变；FFFD 替换只应有被改的那几行）。
  ⚠️ **原写的 `npm run format:check` 对本条改动面无效（sr1-e-b MF-10）**：
  全仓**只有 `apps/mobile/package.json:12`** 定义了 `format:check`，`packages/core` **既无该脚本也无 `.prettierrc`**，
  而本条要改的 20 个 BOM + 9 个 FFFD **全在 `packages/` 与 `apps/*/src`**。
  另外实测 **prettier 保留 BOM**（带 BOM 的输入 `format()` 出来仍以 BOM 开头），
  所以「反之 prettier 不得把 BOM 加回来」这句是**空转**，一并删掉。
  **回归线不含任何 prettier 环节**；BOM 的权威判据是 `scripts/check-encoding.mjs` 自己。

### H1.7 依赖

- **Wave A 的编码还原批次 1**（★5 拍板卡着 `apps/mobile` 部分）——**门禁本身不等 ★5**，
  但「清账」那一步里 `apps/mobile/src/services/session-prompt-input.service.ts` 的 **178 处**
  应与批次 1 同 PR（避免两波人改同一文件；且该文件是 §H1.3 Step 4 的 **B 类**——
  非合法 UTF-8，只能从父提交整体还原，见 MF-9）。
- core 的 4 个 BOM 与 7 个 U+FFFD 不受 ★5 阻塞，可独立落。

### H1.8 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 文本级工具重写把文件里**未损坏**的中文也毁掉 | **高**（RULE 有两次实锤事故） | 大面积乱码 | 一律 Edit 工具字节级替换；`git diff --numstat` 逐文件核对，出现「1 行改动报 20/20」立刻 `git checkout --` 还原重做 |
| 去 BOM 后某些工具链行为变化（如 `sed`/`.ps1` 脚本） | 低 | 构建/脚本异常 | 全量 `npm test` 兜底 + `scripts/check-encoding.mjs` 复跑（⚠️ 不用 `format:check`，见 §H1.6 MF-10）；回滚 = 恢复 BOM（本条与批次 1 同一 PR，回滚一起退） |
| B 类（非合法 UTF-8）文件照 A 类做法逐字符 Edit 替换 | **中** | 静默空 diff，损坏仍在 | §H1.3 Step 4 已把两类分表写死；B 类走「从父提交整体还原」，落地后 `git diff --numstat` 若为空行数即说明走错了路径 |
| 提交钩子因 `core.hooksPath` 未配置而静默不生效 | **高**（每人 clone 一次） | 门禁形同虚设 | ① CI 步骤是**权威门禁**（不依赖本地配置）；② README + AGENTS.md 显著位置写 `git config core.hooksPath .githooks`；③ `scripts/link-hooks.mjs` 挂 `prepare`，`npm install` 时自动配置 |
| `git ls-files` 在浅克隆 / tarball 场景不可用 | 低 | 脚本崩 | 拿不到清单时回落全量遍历并 warn |

---

## H2 · 钩子② 白名单完整性（exhaustiveness 断言）

- **严重度 / 簇**：P1（N-P1-02 本体）· core-misc
- **病症**：`normalizeAgentPromptLayoutDomain` 用一串条件 spread 逐字段挑拣，
  **新增 `AgentPromptLayout` 字段时不会编译报错、也不会测试红**，只是静默丢字段。
  这已经**连续漏了两次**：上次 `customAttach`、这次 `skillsEnabled` / `skillsPrefix`。

### H2.1 证据

**`packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts:54-74`**（全文核对）：

```ts
export function normalizeAgentPromptLayoutDomain(
  layout: AgentPromptLayout
): AgentPromptLayout {
  const persist = layout.persist.filter(/* ... */);
  return {
    ...(layout.system != null && layout.system.trim() !== "" ? { system: layout.system } : {}),
    ...(layout.persistEnabled === true ? { persistEnabled: true } : {}),
    ...(layout.dynamicEnabled === true ? { dynamicEnabled: true } : {}),
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout) ? { customAttach: layout.customAttach } : {}),
    persist,
    dynamic: [...layout.dynamic],
  };
}
```

**`packages/core/src/domain/prompt/model/agent-prompt-layout.ts:83-114`** 的 `AgentPromptLayout`
有 **7 个可选字段 + 2 个数组**：`system` / `persistEnabled` / `dynamicEnabled` / `workplace` /
`customAttach` / `skillsEnabled` / `skillsPrefix` + `persist` / `dynamic`。
`:105` 与 `:110` 正是缺失的两个：

```ts
  readonly skillsEnabled?: boolean;
  readonly skillsPrefix?: string;
```

**漏字段的后果不是「少个字段」而是语义反转**：`skillsEnabled: false` 的语义是
「不注入技能索引 + `resolveAgentToolRegistry` 摘除 skill 工具」（`:100-104` 的注释明写）。
经 normalize 丢掉该字段 ⇒ 下游读到 `undefined` ⇒ **按「缺省 = true」处理 ⇒ 用户关了技能能力却仍在注入**。

**唯一消费链当前无生产调用方**（`resolveAgentDefinitionFromStorage` 只被 3 个测试文件引用，
且 `apps/desktop/shared/logic/config-forms-stored-config-validity.ts` 显式禁止 renderer 调用），
所以定级 P2 潜伏、P1 修法——本条是**钩子**，不是 P1 功能修复本体（本体在 wave-b-core2 的 N-P1-02）。

### H2.2 修法（文件·函数级步骤）

**Step 1（wave-e H2 负责，wave-b-core2 交付靶子回归锁用例）** — 在
`normalize-agent-prompt-layout.ts` 里把白名单显式化并挂编译期守卫：

```ts
/** normalize 覆盖的可选字段全集：新增 AgentPromptLayout 字段时本行编译红（缺键）/ 多键也红（stale）。 */
const NORMALIZED_OPTIONAL_FIELDS = {
  system: null, persistEnabled: null, dynamicEnabled: null,
  workplace: null, customAttach: null, skillsEnabled: null, skillsPrefix: null,
} satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>;
```

`Exclude<…>` + `satisfies` 双向锁：**新增字段忘了加 ⇒ `Record` 缺键 ⇒ 编译红；
加了已删除的字段 ⇒ excess property ⇒ 编译红。** 这是「删掉 spread 即红」的编译期形态。

> 🔁 **R2-11 口径订正（judge-r1 B5 / B 节裁定）**：本 Step 1 的小标题原文写的是
> 「wave-b-core2 负责，本条负责钩子侧」，与 `wave-b-core2.md §11.3`（`:1494-1502`）的分工声明
> **方向相反**——后者明写「本片（core2）交付靶子 + 回归锁用例、**wave-e 交付仓级门禁**，
> `satisfies` 守卫归 wave-e H2 Step 1」。
> ⇒ 已按 core2 §11.3 的口径对调为现在的措辞：**仓级 `satisfies` 编译期守卫归 wave-e H2（本 Step 1）**，
> core2 侧交付的是靶子（normalize 白名单与 spread 的实现本体）与回归锁用例。
> 两侧分工以 `wave-b-core2.md §11.3` 为唯一权威表述。

**Step 2 — 断言函数**（同文件导出，供测试与生产双用）

⚠️ **不能按「与 `layoutHasWorkplace`/`layoutHasCustomAttach`/… 的实际 spread 集合对账」的字面写法实现**
（sr1-e-c MF-5）：运行期导不出「实际 spread 集合」，若把同一份键表再抄一遍进断言体，
断言恒真、删任一 spread 也不红——正撞牙齿判据①的原型事故。**改用哨兵值驱动**：

```ts
export function assertNormalizeCoversAllFields(): void {
  // 唯一事实源 = NORMALIZED_OPTIONAL_FIELDS；每个可选字段一个唯一的哨兵值，
  // 逐键塞进 layout，跑 normalize，断言哨兵被原样回吐。
  // ⇒ 删任一 spread ⇒ 该字段的哨兵回不来 ⇒ 红（判据①成立）
  // ⇒ 新增第 8 个字段只要进了常量表，就自动进入断言面，不需要改测试
}
```

⚠️ `tsconfig.base.json:17` 是 `noUnusedLocals: true` ⇒ `NORMALIZED_OPTIONAL_FIELDS`
**必须导出、或被本断言函数引用**，否则 TS6133。上面这版写法天然满足。

**Step 3 — 新增测试** `packages/core/test/prompt/normalize-agent-prompt-layout-exhaustive.test.ts`
（详见 H2.4 测试策略）

**Step 4 — 兜底断言（core-misc 建议的第 2 条）**
`computeLlmExportZonesFromLayout`（`render-prompt.ts:104-113`）的 persistCount **只看
`options.skillsIndex.length`、不看 `layout.skillsEnabled`**，与真正拼装的
`buildPromptLlmInputFromLayout` 双保险不一致（`:561-566` 的分析：当前不可达，但是跨文件隐式不变量）。
建议抽 `shouldInjectSkillsIndexMessage(layout, skillsIndex)` 纯函数由两处共用。
**本条只挂一条「删掉 spread 即红」的测试断言，不动 `render-prompt.ts` 的行为**——
行为修法归 wave-b-core2。

### H2.3 验收

```powershell
# ① 编译期守卫：给 AgentPromptLayout 加一个 readonly foo?: string
#    → 期望 `npx tsc --noEmit -p packages/core/tsconfig.json` 报 Record 缺键
#    → 撤销后重新编译，期望 0 error

# ② 运行期断言
cd packages/core; npx tsx --test test/prompt/normalize-agent-prompt-layout-exhaustive.test.ts

# ③ 回归
cd packages/core; npm test      # 期望 0 fail
```

### H2.4 测试策略

**新增文件**：`packages/core/test/prompt/normalize-agent-prompt-layout-exhaustive.test.ts`

| 用例名 | 内容 | 牙齿自检 |
|---|---|---|
| `全字段 layout 经 normalize 后逐字段保值` | **由 `Object.keys(NORMALIZED_OPTIONAL_FIELDS)` 驱动**构造输入（逐键塞哨兵值，断言 `normalize` 逐键回吐），**不再硬编码 7 个字段** | ① 把 `skillsEnabled` 的 spread 删掉 ⇒ 红；**且新增第 8 个字段时只要补进常量表就自动进断言面**，不必改测试 |
| `缺省字段不被写入` | 传一个只有 `persist`/`dynamic` 的 layout，断言输出键集合恰为 `['persist','dynamic']` | ① 删掉某个 `layoutHasX` 判断 ⇒ 红 |
| `assertNormalizeCoversAllFields 不抛` | 直接调 Step 2 的断言函数 | ① 从 `NORMALIZED_OPTIONAL_FIELDS` 删一个键 ⇒ 编译已红（编译期），运行期再补一条「键集合与 model 反射一致」的断言 |

**三判据**：
① 有牙吗——成立（主用例直接对住「漏字段」这个病）。
② 恒红吗——**注意 RULE 判据②的同类陷阱**：`AgentDefinitionEditorForm` 那条是「进程级模块标记被同文件第一条用例消费」；
本条无进程级状态，3 条用例互相独立。成立。
③ 一夹具两期望吗——3 条用例各有独立输入，无互斥夹具。成立。

### H2.5 回归线

- `packages/core` 全量 `npm test`。
- `packages/core/test/config-forms/**`（`formSnapshotJson` 那条 P1 的测试在同族目录）。
- `npx tsc --noEmit -p packages/core/tsconfig.test.json`。

### H2.6 依赖

- **wave-b-core2 的 N-P1-02**（补 `skillsEnabled` / `skillsPrefix` 两个 spread）：**必须与本条同 PR 或
  严格在前**。理由：Step 1 的 `satisfies` 一旦加上就编译红，wave-b-core2 的修法是唯一解法。
- 本条**不得**自己动 `normalizeAgentPromptLayoutDomain` 的行为（那是 wave-b-core2 的职责），
  除非两边合并成同一个 PR。

### H2.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| `satisfies Record<Exclude<keyof …>>` 在 TS 6 下 excess property 检查行为与预期不符 | 低 | 守卫失效或误报 | Step 1 完成后**当场跑一次「加字段 ⇒ 编译红 / 删键 ⇒ 编译红」双向验证**，写入 PR 描述 |
| 有人为了「让编译过」而把 `NORMALIZED_OPTIONAL_FIELDS` 改成 `Partial<…>` 或加 `as` | 中 | 守卫被绕过 | 规则写进文件头注释：禁止 `as` / `Partial`；review 时若见到即打回 |
| 与 wave-b-core2 分头改同一文件 | 中 | 冲突 | 严格按「本条只加常量与断言函数、wave-b-core2 只加两个 spread」的分工；冲突时以 wave-b-core2 的 PR 为准重放本条 |

---

## H3 · 钩子③ 编码归一（front matter 单源）

- **严重度 / 簇**：P2（core-misc M-02，双端行为漂移）· apps-desktop + apps-mobile + core
- **病症**：两端各手拼一份 SKILL.md 新建模板，**desktop 端裸插值、mobile 端用 `JSON.stringify` 转义**。
  用户在 desktop 新建技能时只要 description 里带**半角** `": "`（如「用途: 调研」），
  YAML 就被解析成嵌套 map 而**返回 `valid:false` + `invalidReason`**，
  技能**创建后立即显示为「无效技能」**；mobile 端同一输入正常。
  ⚠️ **必须是半角冒号 + 后跟空格**（sr1-e-b MF-11）：**全角** `：`（U+FF1A）实测**不复现**
  ——用真 `parseSkillFrontMatter` 跑 desktop 裸插值模板，输入「用途：调研」仍 `valid=true`、
  `description` 原样回来。真正触发的还有：值里含换行、以 `#` 开头（注释）、以 `- ` 开头（序列项）。
  ⚠️ 也**不是抛错**：`parseSkillFrontMatter` 对 `parseText` 的 `ConfigDecodeError` 有 try/catch，
  对外只返回 `valid:false` + `invalidReason`，**不抛**（与 §H3.1 下文「解析失败不抛错」自洽）。

### H3.1 证据

**`apps/desktop/renderer/features/skills/skill-ui.ts:21-35`**：

```ts
export function buildNewSkillDoc(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
```

**`apps/mobile/src/components/skills/skill-ui.ts:48-50, 53-58`**：

```ts
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
export function buildNewSkillDoc(name: string, description: string): string {
  return ['---', `name: ${yamlScalar(name)}`, `description: ${yamlScalar(description)}`, ...
```

**下游判无效的实现**（`packages/core/src/domain/skills/logic/parse-skill-front-matter.ts`）：
解析失败走 `valid: false` + `invalidReason`，UI 显示「无效技能」但**保留在清单里**。

**关键发现：core 里已经有转义原语，只是 `buildNewSkillDoc` 从没下沉。**
`packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:26-29`：

```ts
/** YAML 双引号标量：JSON 字符串本身即合法 YAML double-quoted scalar。 */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
```

同文件的「编辑信息 / ZIP 导入」front matter 回写**已经**是 core 单源（desktop 侧注释
`skill-ui.ts:37-38` 明写「front matter 重写已回收为 core 单源」）——
**只有「新建模板」这一条漏了**。这让本条的修法比 synth 建议的更小：不需要新建逻辑，只需搬家。

### H3.2 修法（文件·函数级步骤）

**Step 1 — core 新建 `packages/core/src/domain/skills/logic/build-new-skill-doc.ts`**
- 导出 `buildNewSkillDoc(name: string, description: string): string`；
- `yamlScalar` 从 `with-skill-front-matter-values.ts` **提取**到同目录的 `yaml-scalar.ts`
  （或直接 export 复用），两处共用一个实现；
- 模板正文沿用 **desktop 版**的结构（`# name` + 辅助文件引导注释），
  因为 desktop 是要修的那一端、mobile 是好的那一端，取 desktop 的文案可避免行为回退。

**Step 2 — `packages/core/src/public/skills.ts` 加转发**
`export { buildNewSkillDoc } from "../domain/skills/logic/build-new-skill-doc.js";`

**Step 3 — `apps/desktop/shared/logic/skills.ts` 加转发**（X1 的再导出层，同款纪律：不许 `export *`）

**Step 4 — 两端改用单源**
- `apps/desktop/renderer/features/skills/skill-ui.ts`：删掉本文件的 `buildNewSkillDoc` 实现，
  改为 `export { buildNewSkillDoc } from "@shared/logic/skills";`（保持对外 API 名不变，调用方零改动）。
- `apps/mobile/src/components/skills/skill-ui.ts`：同样改为从 `@novel-master/core/skills` 转发，
  删掉模块私有的 `yamlScalar`。
  （RULE：给 `@novel-master/core` 加 exports 子路径必须同步 `packages/core/tsconfig.test.json` 的 paths——
  但 `/skills` **已存在**于两者，无需新增映射。）
- **⚠️ 既有契约测试锁死了 mobile 侧再导出的精确形态（sr1-e-b MF-13）**：
  `apps/mobile/__tests__/skill-info-edit-modal-contract.test.ts:85-87` 用正则
  `/export \{withSkillFrontMatterValues\} from '@novel-master\/core\/skills'/`
  匹配 `skill-ui.ts` 源码。**若把两个符号合并成一条 `export {a, b} from ...`，该测试立刻红。**
  ⇒ **纪律：`skill-ui.ts` 必须保留 `export {withSkillFrontMatterValues} from '@novel-master/core/skills';`
  这一条独立语句，`buildNewSkillDoc` 另起一条 `export { buildNewSkillDoc } from '@novel-master/core/skills';`，
  不得合并成一条。** 落地后必跑该测试文件（见 §H3.4 回归线）。

### H3.3 验收

```powershell
# ① 新增 core 测试
cd packages/core; npx tsx --test test/skills/build-new-skill-doc.test.ts

# ② 回归
cd packages/core; npm test
cd apps/desktop; npm test
cd apps/mobile; npx jest --maxWorkers=2
```

### H3.4 测试策略

**新增文件**：`packages/core/test/skills/build-new-skill-doc.test.ts`

| 用例名 | 内容 |
|---|---|
| `description 含半角冒号时产出的 front matter 可被 parseSkillFrontMatter 解析` | `buildNewSkillDoc("s", "用途: 调研")` → `parseSkillFrontMatter(doc).valid === true`，且 `description === "用途: 调研"`。**⚠️ 必须用半角 `": "`，不许用全角 `：`（sr1-e-b MF-12）**——全角输入在**有 bug 的 desktop 裸插值实现上同样 `valid===true`**，原用例因此**没有牙齿** |
| `description 含引号/换行/井号时同样可解析` | 三个 case 参数化（换行与 `#h` 在 desktop 裸插值版上确实红 ⇒ 这条**有牙**，原判定成立） |
| `name 含冒号时同样可解析` | 同上，对 `name`（半角） |
| `产出结构仍是 front matter + 标题 + 引导说明` | 锁模板形态，防 Step 1 搬文案时走形 |

**牙齿三判据**：① 有牙吗——把 `yamlScalar` 换回裸插值 ⇒ 用例 1 立刻红。
（**成立的前提是用例 1 的输入已改成半角**；全角输入下撤掉 `yamlScalar` 用例 1 仍绿，判据①不成立。）
② 恒红吗——`parseSkillFrontMatter` 走真实 `parseText(…, "yaml")`，无进程级状态。成立。
③ 一夹具两期望吗——否。

**回归线**：`packages/core` 全量；`apps/desktop` 全量（desktop 有 skill-ui 相关单测吗——
落地时确认，若无则以 core 用例为准）；`apps/mobile` 全量（`--maxWorkers=2`）。
**⚠️ 追加点名（MF-13）**：`apps/mobile/__tests__/skill-info-edit-modal-contract.test.ts`
——它用正则锁死 `skill-ui.ts` 的精确再导出形态，Step 4 合并 export 语句就会把它打红；
另有 `apps/mobile/__tests__/` 下另一条读 `skill-ui.ts` 的源码契约测试，同样必跑。

### H3.5 依赖

- 与 **wave-b-core2 / wave-b-apps** 无硬依赖，可独立落。
- ~~与 X1 的 `shared/logic/skills.ts` 转发扩充同一文件 → 建议与 X1 Step 1 同 PR（同一文件两处改动，
  分开 PR 必冲突）。~~ **该陈述作废（sr1-e-b MF-14，事实错误）**：
  X1 Step 1 只动 `shared/logic/{events,chat,provider}.ts` **三个文件，从未碰 `skills.ts`**
  ⇒ **不存在同文件冲突**。若仍要与 X1 同 PR，理由只能是「同一迭代、便于一次回归」，**不是文件冲突**。
- **mobile 侧 `__tests__/skill-info-edit-modal-contract.test.ts` 是本条的真实约束面**（见 §H3.2 Step 4）。

### H3.6 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 模板正文从 mobile 版换成 desktop 版 ⇒ mobile 端新建技能的文档正文变了 | 中 | mobile 用户看到不同的引导文案 | Step 1 明确「取 desktop 文案」并把「引导说明段」也一并搬过去；或者反过来**两版正文都保留**、只统一 front matter 转义（更保守，**默认建议此项**） |
| desktop 的 `buildNewSkillDoc` 被 re-export 后，renderer 侧多了一层 barrel | 低 | 无 | X1 的再导出层已是既定设计 |
| 回滚 | — | — | 单文件回滚即可（core 新文件 + 两端各一行转发） |

---

## H4 · 钩子④ 边界用例（chunk-splitter 密集句末符）

- **严重度 / 簇**：P2（测试缺口，暴露文档承诺错误）· core-infra/tokenizer
- **病症**：`splitTextIntoChunks` 的头注释与常量注释都承诺「每块 ≤64 / 逐块 encode ≤64」，
  但规则①「贪吃连续句末符号」在句末符密集输入下产出**远超 64 的单块**。
  现有测试的 `assertInvariants` 恰好只喂「无句末符」或「句末符稀疏」的语料，从未踩到。

### H4.1 证据

**`packages/core/src/infra/tokenizer/logic/chunk-splitter.ts:11-14`**：

```
 * ③ 块内无任何软边界时按上限**硬切**（无空白长中文串的病态输入由此兜住，
 *    保证后续逐块 encode 恒 ≤64 字符，防 O(len²)）。
```

**同文件 `:21-22`**：

```ts
/** 单块字符数硬上限：与增量计数器 MAX_ENCODE_CHARS 对齐（每次 encode ≤64）。 */
export const MAX_CHUNK_CHARS = 64;
```

**同文件 `:38-42` 把「每块长度恒 ≤ 64」列为「不变量（测试锁定）」**——但它不是不变量。

**实现（`:52-61`）证明它不成立**：

```ts
    if (SENTENCE_END_CHARS.has(ch)) {
      let end = i + 1;
      while (end < n && SENTENCE_END_CHARS.has(text[end]!)) end++;
      chunks.push(text.slice(start, end));
```

`"。".repeat(200)` ⇒ 一个 200 字符的块；`"。\n".repeat(200)` ⇒ 一个 400 字符的块。
两者都过不了 `chunk-splitter.test.ts:22-27` 的 `assertInvariants`（`chunk.length <= 64`）。

**并且这不是 bug，是被 golden 测试刻意锁住的行为**：`chunk-splitter.test.ts:41-47`
断言 `"。。。！！！"` 是**一个**块。所以**要改的是注释承诺，不是实现**。

**附带的更深问题（须在 spec 里点名）**：
`splitTextIntoChunks` **当前零生产消费方**——`packages/core/src` 里只有
`infra/tokenizer/index.ts:81` 与 `public/provider.ts:156` 两处 barrel 转发。
**测试侧消费方不止一处**（sr1-e-c MF-6 订正原文「消费方只有 mobile 那一家」的说法）：除
`apps/mobile/__tests__/mobile-prompt-token-counter.test.ts:504-506` 外，core 侧还有 4 个文件
（明细见 H4.5 回归线），其中 `token-chunk-cache.test.ts` 逐块算 `chunkHash16`。
而头注释宣称的「token 块缓存（message-token-cache）的切分基础」——`token-chunk-cache.ts`
自己 `import { hashContent }`，**并不调用 `splitTextIntoChunks`**。
即：**「切分点漂移 = 缓存永远 miss」这条因果链今天没有任何生产代码承受**（测试面承受）。

### H4.2 修法（文件·函数级步骤）

**Step 1 — 先落现状固化用例（这是本条的价值所在：把贪吃语义固化成回归）**
`packages/core/test/infra/tokenizer/chunk-splitter.test.ts` 增两条用例，
**先断言当前真实行为**（而不是先改实现）：

```ts
it("T-TC1-E1: 句末符密集输入下贪吃段突破 64 上限（既有设计，注释承诺已订正）", () => {
  const chunks = splitTextIntoChunks("。".repeat(200));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.length, 200);
  // 划分性不变量在超限形态下**依然成立**——这是真正该守的不变量
  assert.equal(chunks.join(""), "。".repeat(200));
});
// "。\n".repeat(200) 同款：1 块 / 400 字符
```

**Step 2 — 改注释承诺（`chunk-splitter.ts:11-14` / `:21-22` / `:36` / `:38-42` 四处）**
- `:14` 的「保证后续逐块 encode 恒 ≤64 字符，防 O(len²)」改写为
  「**软/硬切两条路径**保证块长 ≤64；**规则①的贪吃段不受上限约束**（句末符连续输入可产出长块，
  这是被 golden 锁定的设计：贪吃是为避免空块/碎块），调用方若需硬上限须自行二次切分」；
- `:22` 的「单块字符数硬上限」改写为「**软切上限**（规则②③适用）；规则①贪吃段可超出」；
- `:36` 的函数签名注释「切成 ≤MAX_CHUNK_CHARS 字符的块序列」改写为「切成不超过
  `MAX_CHUNK_CHARS`（规则②③）或一个贪吃句末段（规则①）的块序列」；
- `:38-42` 的不变量清单：**删掉「每块长度恒 ≤ 64」**，替换为两条真不变量
  ——① `join("")` 逐字节还原；② **除规则①贪吃段外**每块 ≤ `MAX_CHUNK_CHARS`。
- `:4-7` 的「这是内容寻址缓存正确性的前提」补一句「⚠️ 当前 `splitTextIntoChunks` 无生产消费方
  （仅 barrel 转发 + mobile 一处测试），该前提今天没有生产代码承受」。

**Step 3 — 生产侧零改动。** 若将来 `token-chunk-cache` 真接上 `splitTextIntoChunks`，
需在同一 PR 里把「贪吃段二次切分」补上；本条只留一句 TODO 注记指向该文件。

### H4.3 验收

```powershell
cd packages/core; npx tsx --test test/infra/tokenizer/chunk-splitter.test.ts
# 期望：全绿（含新增 2 条），0 fail

# 牙齿自检：把 :55 的贪吃 while 循环删掉（改成 end = i+1）
#   → E1 用例红（chunks.length 从 1 变 200），golden 的 "。。。！！！" 用例也红

# 回归
cd packages/core; npm test
```

### H4.4 测试策略

- 只改 `packages/core/test/infra/tokenizer/chunk-splitter.test.ts`（+2 用例，0 删改既有）。
- **断言选型纪律（RULE「性能护栏取数量级回归线」的同族）**：本条断言的是**长度与块数**这类
  精确不变量，不是耗时——RULE 明确「精确不变量改用计数式断言」。此处 `chunks.length === 1` 与
  `chunks[0].length === 200` 就是计数式。
- **三判据**：① 有牙吗——删贪吃 while ⇒ 红。成立。
  ② 恒红吗——两条用例断言的是**现状**，落地即绿（sr1-e-c E1/E2 实测与断言完全一致），
  这是**有意的现状固化**，不需要等实现改。成立。
  ③ 一夹具两期望吗——否。

**⚠️ 与台账的口径切换（sr1-e-c MF-6）**：台账 `ledger-v2.md:494` 说的「当前实现下会红」指的是
**把既有的 `assertInvariants` 喂这组输入**（`chunk.length=200 > 64`，实测确实红）；
本片改为**新增断言现状行为的用例**（实测绿）。二者不冲突，理由是被 golden
`chunk-splitter.test.ts:41-47` 锁定的贪吃语义**不可改**——本条要修的是注释承诺，不是实现。
本小节标题一律用「先落**现状固化**用例」，不再用「先落红」，避免与 H4.4 的「落地即绿」读起来打架。

### H4.5 回归线

- `packages/core` 全量 `npm test`。
- `apps/mobile/__tests__/mobile-prompt-token-counter.test.ts`（跨端消费方，锁 `chunkHash16` 稳定性）。
- **core 侧另外 4 个真实消费方**（sr1-e-c MF-6 补，原文只列了 mobile 一家；`splitTextIntoChunks` 的
  消费方**不止** mobile，回归线漏掉它们等于漏掉四片红）：
  - `packages/core/test/infra/tokenizer/chunk-count-accuracy.test.ts`（7 处断言）；
  - `packages/core/test/infra/tokenizer/serialize-tools-for-token-count.test.ts`（3 处）；
  - `packages/core/test/infra/tokenizer/token-chunk-cache.test.ts:21`——
    **最重要**：`countRound` 里逐块 `chunkHash16`，切分行为一变就大面积红；
  - `packages/core/test/infra/tokenizer/chunk-splitter.test.ts`（本条自身）。
  ⚠️ 别被 `token-chunk-cache.ts` 的生产侧迷惑：它**不调用** `splitTextIntoChunks`
  （imports 只有 `hashContent` 等），但**它的测试调用**——这正是「生产零消费方 ≠ 测试零消费方」的样例。

### H4.6 依赖

- 与 Wave B / C 的对应修法**无强耦合**：本条只订正注释 + 固化现状行为。
- 若 Wave C 决定把 `splitTextIntoChunks` 真正接进 `token-chunk-cache`，**Step 2 的四条注释要重写**，
  且 E1/E2 两条用例的期望值要跟着改（那时它们会从「固化现状」变成「真回归锁」）。

### H4.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 「贪吃段可超 64」被后来人当成漏洞去「修」（加长度上限） | 中 | golden 用例红 + 块形态变化 → 缓存 hash 全变 | 注释里写明「被 golden 锁定的设计」并指向 `chunk-splitter.test.ts:41-47` |
| 只改注释不落测试 ⇒ 下一个不知道这段历史的人还会踩 | **高** | 承诺又变回错的 | Step 1 的两条用例是本条的主体，缺一不可 |
| 回滚 | — | — | 注释改动 + 2 条测试，git revert 即可 |

---

## H5 · 钩子⑤ 测试缺口（三处，含牙齿三判据自检）

- **严重度 / 簇**：P2（测试缺口）· core-message-checkpoint / core-provider
- **病症**：三处「行为已实现、但没有任何测试锁住关键分支」，一旦回归不会被发现。

### H5.1 证据与修法

#### H5.1.1 `rollback-empty-target-guard.test.ts` 缺 rewind 空树用例

**证据**：`packages/core/test/message-checkpoint/rollback-empty-target-guard.test.ts` 共 3 条用例，
逐条核对**全部走 `undo_send` / 首条 plain user 路径**：
- `T-DS2a`（`:18`）首条 plain user 无 baseline → 抛 `ROLLBACK_UNDO_SEND_EMPTY_TARGET`；
- `T-DS2b`（`:60`）`skipVfsReconcile: true` → 只截断消息；
- `T-DS2c`（`:83`）anchor 有 checkpoint → 正常回滚。

**缺口**：**rewind（回滚到助手消息）路径**的 `targetTree` 为空时，**空 targetTree 的文件安全**零覆盖。
台账与 revalidate-b 都点到了这条（`ledger-v2.md:495`）。

**⚠️ 但「护栏对 rewind 同样生效」这个前提不成立（sr1-e-c MF-1 实测）**：
`message-rollback.service.ts:159-175` 的护栏条件是
`!skipVfsReconcile && plan.mode === "undo_send" && plan.targetTree.size === 0`，
而 `:355-357` 的 mode 取值是 `isPlainUserUndoSendEligible(anchor) ? "undo_send" : "rewind"`
⇒ **回滚到 assistant 消息时 mode 恒为 `rewind`，永不进这条护栏**。
所以本用例若断言「抛 `ROLLBACK_UNDO_SEND_EMPTY_TARGET`」**落地当天必红**（H5.3/5.6 的旧写法已按此重写）。
rewind 的文件安全实际来自**另一条机制**：`resolve-reconcile-paths.ts:123-130` 的 `hasDirectTargetTree` 门
（无 anchor checkpoint ⇒ `directTargetPointers == null` ⇒ `hasDirectTargetTree = false` ⇒ `pathsNeedDelete` 为空），
再叠加 `message-rollback.service.ts:401-411` 的消息截断。

**修法**：在同文件加 `T-DS2d`：建会话 → 写 3 个文件 → 追加 user + assistant → **在 anchor 之后再追加一条消息**
（不追加则截断分支跑不到，见下）→ **不建任何 checkpoint** →
调 `rollbackToMessage(session.id, project.id, assistant.id)`，断言三件事：
1. **不抛** `ROLLBACK_UNDO_SEND_EMPTY_TARGET`；
2. **文件数不变**（3 个文件全部留存）；
3. 消息按 `truncateAfterSeq = anchor.seq` 截断（anchor 之后那条被删，anchor 及其之前保留）。

用例注释须点名：**「rewind 的文件安全来自 `hasDirectTargetTree` 门，不是 S-13 护栏」**——
这样锁的是另一条真实安全机制，判据①成立：删掉 `hasDirectTargetTree` 门 ⇒ `pathsNeedDelete` 不再为空 ⇒
文件被删光 ⇒ 红。
**并把新用例放在独立文件 `rollback-empty-target-guard-rewind.test.ts`**——
理由见「牙齿三判据②」。

#### H5.1.2 `findSavedModelReferences` 缺 `chat_session` 端到端回归

**证据**：`packages/core/src/domain/provider/logic/find-saved-model-references.ts:32-93` 扫三处：
`kkv_entry`（`currentModelId`）、`agent_definition.prompts_json.model`、
`chat_project.agent_config_json.definition.model`。
**没有 `chat_session` 分支**，而 `packages/core/src/bootstrap/chat/chat-schema.ts:17-26` 显示
（sr1-e-c MF-8 口径修正：原文写 `:16-25`，逐字引文正确、整体偏移 1 行；该 DDL 块起于 `:17`）

```sql
  `CREATE TABLE IF NOT EXISTS chat_session (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    composer_draft_json TEXT NULL,
    agent_config_json TEXT NULL,
```

RULE「会话智能体」条明写：会话有「可选 `modelId` 覆盖 agent pin 的模型」。
⇒ **一个被 session 级 `modelId` 覆盖引用的已保存模型，删除时扫不出来**
（`provider-model.service.ts:168-180` 的 `deleteSaved` 只看 `refs.length`）。
**更糟的是：全仓没有任何测试文件 import `findSavedModelReferences`**
（`test/**` 零命中），只有 `provider-model.service.test.ts` 的 T-SM8 三条覆盖另外三处引用。

**修法**（本条只补回归，**不修 `findSavedModelReferences` 的实现**——那是 wave-b-core2 或独立条目的事）：
- 新增 `packages/core/test/provider/find-saved-model-references.test.ts`；
- 用例 1：`agent_definition.model` 指向目标 ⇒ 返回含 `agent_definition:<id>`；
- 用例 2：`chat_project.agent_config_json.definition.model` ⇒ 返回含 `chat_project:<id>`；
- 用例 3：**`chat_session.agent_config_json` 里带 `modelId` 覆盖 ⇒ 断言当前返回 `[]`（`valid: false` 留证）**，
  注释写明「这是已知缺口，实施方在 wave-b-core2 补 `chat_session` 分支后把本用例翻成 `valid: true`」；
- 用例 4（端到端）：走 `providerModels.deleteSaved(id)`，断言在存在 session 覆盖时
  **应**抛 `SAVED_MODEL_IN_USE`；**若当前不抛，本用例先标 `test.todo` 留证**，
  不阻塞 CI（这是「已知缺口留证」的标准做法：断言写出来、期望标 todo，
  实施的那天只需删 `.todo`）。

**⚠️ 纪律**：用例 3/4 的期望若写成「当前行为」，就变成了**把 bug 锁死的断言**——
这违反牙齿判据①的精神。因此本条的要求是：**用例 3/4 写成 `test.todo` + 完整断言体**
（`test.todo` 语义上标记「待实施」；⚠️ node v22.22.0 的 `test.todo(name, fn)` **会执行 fn**，
失败只被 node 降级成 `# TODO`、**不影响退出码**——sr1-e-c E4 实跑：`not ok 1 - … # TODO` 但 `# fail 0`、退出码 0），
实施日只删 `.todo` 一个词。

#### H5.1.3 `model-request-retry.test.ts` 缺「attempt1 产出后失败」用例

**证据**：`packages/core/test/provider/model-request-retry.test.ts` 共 10 条用例
（逐条核对：`:68` / `:94` / `:116` / `:142` / `:168` / `:194` / `:220` / `:248` / `:275` / `:302`
—— **10 个行号，即 10 条**；原文写「11 条」是数错，sr1-e-c MF-3 已订正），
**每一条的 `adapter.chat` 都在产出任何输出之前就 throw**，
**没有一条使用 `LlmChatRequest.onStream`**。
而 `packages/core/src/service/provider/impl/model-request.service.ts` 的重试循环里：

```ts
        return await adapter.chat({
          ...
          onStream: options?.onStream,
```

**每次 attempt 都把同一个 `onStream` 原样传下去，没有任何「已产出」闩锁。**
⇒ attempt1 若已 `text-delta` 出去、随后抛一个 `isRetryableError` 判为可重试的错误
（如非 `ProviderError` 的传输层失败，`:81-84` 判 `true`），attempt2 会**二次驱动同一个 onStream**
⇒ UI 上出现重复文本 + 重复计费。台账说的「现有 6 条全只覆盖无输出失败」在 `fe79b781` 上是 **10 条**
（原文写 11 条，系把行号数错；sr1-e-c MF-3 已订正）。

**修法**（同文件加一条，用牙齿三判据自检过的断言）：

```ts
it("T-RR-1: attempt1 已产出 text-delta 后失败 → onStream 不得被二次驱动", async () => {
  let calls = 0;
  const seen: string[] = [];
  const adapter: LlmProtocolAdapter = {
    kind: "openai",
    listModels: async () => ({ models: [] }),
    chat: async (req) => {
      calls += 1;
      req.onStream?.({ type: "text-delta", text: "第一次" });
      // 传输层失败（非 ProviderError）→ isRetryableError 判 true
      throw new Error("ECONNRESET");
    },
  };
  // ... 构造 svc（maxRetries: 2）
  await assert.rejects(() => svc.request(SAVED_MODEL_ID, "hi", {
    onStream: (e) => { if (e.type === "text-delta") seen.push(e.text); },
  }));
  assert.ok(calls >= 2, "本用例要求重试确实发生了");
  assert.equal(seen.length, 1, "重试不得二次驱动 onStream（重复输出/重复计费）");
});
```

**⚠️ 这条用例在当前实现下会红。** 这正是它的价值——它把「无闩锁」这个隐患变成 CI 可见的红。

> 🔁 **R2 口径订正（judge-r1 A.2(b) / R2-7）**：本条揭出的缺陷就是台账 **M-01（重试探针）**，
> `judge-r1` 已裁定 M-01 归 `wave-b-core2.md` 补写（量 M）。
> ⇒ **本条 H5.1.3 原写的「用 `test.todo` 留证」自本轮起撤销**：M-01 已有实条目承接，
> `test.todo` 不再是它的兜底机制（`test.todo` 的 `name`/`fn` 在 node v22.22.0 下会执行 fn，
> 拿它长期挂着一个已立项的缺口，会让 PR review 误判成「已覆盖」）。
> **测试落点归 `wave-b-core2.md` 的 M-01 补写条**（该条自带 `T-RR-1` 的落地步骤与验收判据），
> 本节仅保留病因分析与用例草案作为该条的**引用来源**，不再自行落 `test.todo`。

> **注记（sr1-e-c §2.2，影响面提示）**：T-RR-1 揭出的不只是一个 UI 文本重复问题——
> desktop/mobile 的 token 精确标签正是靠这条 `onStream` 流推送
> （`nm:prompt/chatTokenUpdated` / `onPreciseUpgrade`），所以「每次 attempt 复用同一个 `onStream`」
> ⇒ **重试会二次驱动下游的推送与计费面**。wave-b-core2 补闩锁时影响面不止 UI 文本，勿按「小重复」估工。
> （这条**不违反** RULE「两阶段读数投递通道」条——`onStream` 是同源可注入的回调，不是 UI 侧轮询。）

### H5.2 验收

```powershell
# ① 新用例单独跑
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/message-checkpoint/rollback-empty-target-guard-rewind.test.ts
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/provider/find-saved-model-references.test.ts
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/provider/model-request-retry.test.ts

# ⚠️ 三条命令的 flag 必须**完全一致**（sr1-e-c MF-8 口径修正）：
#    原文这里第一条带两个 flag、后两条不带，还自带「实跑时一律带全」的免责声明——
#    自相矛盾的命令示例本身就是复现材料（RULE「Windows 两个假信号」那条纪律）。
#    统一形态 = `--experimental-test-module-mocks --tsconfig tsconfig.test.json`，
#    否则 tokenizer driver 未注册时得到的是假信号而不是真失败。

# ② 回归
cd packages/core; npm test      # 期望 0 fail
```

### H5.3 测试策略

| 新增/改动文件 | 用例数 | 状态 |
|---|---|---|
| `test/message-checkpoint/rollback-empty-target-guard-rewind.test.ts`（**新文件**） | 1（`T-DS2d`） | 期望**绿**（锁的是 `hasDirectTargetTree` 门这条真机制；**不是** S-13 护栏，见 H5.1.1 的 sr1-e-c MF-1 说明） |
| `test/provider/find-saved-model-references.test.ts`（新文件） | 4 | 2 绿 + 2 `test.todo` |
| `test/provider/model-request-retry.test.ts`（改） | +1（`T-RR-1`） | 🔁 **R2-7 订正：已不是 `test.todo`**，改由 `wave-b-core2.md` 的 M-01 实条目承接（该条自带用例体与验收）；本分片只提供病因分析与草案 |

**为什么 rewind 用例要放独立文件**（RULE 牙齿三判据②的直接应用）：
`novelMasterTestFixture()` 是进程级 fixture，同一文件内多条用例共享连接与种子数据。
把 rewind 用例塞进原文件会让它与 `T-DS2a/b/c` 共享进程状态——**若某条前置用例把
`startupMaintenanceRan` 之类的进程级标记消费掉，rewind 的正向路径可能永远不可观测**。
**独立文件 = 独立进程**（`node --test` 按文件分进程），这是 RULE 明写的修法。

**三判据逐条自检**：

| 断言 | ① 有牙吗 | ② 会恒红吗 | ③ 一夹具两期望吗 |
|---|---|---|---|
| `T-DS2d` | 删掉 `resolve-reconcile-paths.ts` 的 `hasDirectTargetTree` 门 ⇒ 文件被删光 ⇒ 红（**不是**删 S-13 护栏——rewind 走不到它） | 否，独立进程 | 否 |
| `findSavedModelReferences` 用例 1/2 | 把对应 SQL 段删掉 ⇒ 红 | 否 | 否 |
| 用例 3/4（todo） | 补上 `chat_session` 分支 ⇒ 由 todo 转绿；**落地当天无牙**（todo 不判红），实施日删 `.todo` 后才有牙 | 否（body 会执行，但失败被 node 降级为 `# TODO`，不影响退出码） | 否 |
| `T-RR-1`（**R2-7 后已转由 wave-b-core2 的 M-01 承接**） | **加**闩锁 ⇒ 由 M-01 条落地后转绿；**删**闩锁（现状）⇒ 红——判据随 M-01 条走，本分片不再挂 `.todo` | 否（不再适用：M-01 的用例是常规用例，不走 todo 豁免） | 否 |

> 上两行的 ①② 表述按 sr1-e-c MF-4（E4 实跑）订正：node v22.22.0 的 `test.todo(name, fn)` **会执行 fn**，
> 失败只被降级为 `# TODO`、`# fail 0`、退出码仍 0。原文写的「todo 不执行」是事实错误。
> **副作用须写进实施须知**：todo 用例仍会真的建会话、写库、消耗时间（用例 4 会走
> `providerModels.deleteSaved`）。

### H5.4 回归线

- `packages/core` 全量 `npm test`。
- `packages/core/test/message-checkpoint/**` 全目录。
- `packages/core/test/provider/**` 全目录。

### H5.5 依赖

- **H6（零收集守卫）**：本条新增了 3 个测试文件，若 H6 未先落，
  「`npm test` 全绿」这个回归线在 Windows 上是**假的**。⇒ **H6 必须先于本条落地或同 PR**。
- 用例 3/4 的**实施**（不是留证）依赖 wave-b-core2 相应条目（M-04）；本条只留证。
  🔁 **R2-7 订正**：`T-RR-1` 的**实施与测试落点均已整体移交 wave-b-core2 的 M-01**，
  本条不再挂 `test.todo`、也不再是它的实施依赖方。

### H5.6 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `test.todo` 被后人当成「测试已覆盖」删掉标记而不补实现 | **高** | 缺口被永久掩埋 | `test.todo` 的**描述里写清实施条目编号**（如「实施见 wave-b-core2 N-P1-XX」）；PR review 见 todo 必问 |
| `T-DS2d` 落成时用了「assert 抛 S-13 护栏」这个错误方向 | **已消解（sr1-e-c MF-1）** | CI 红 + 丢掉一条真实安全机制 | 断言改为「不抛 + 文件数不变 + 按 `truncateAfterSeq` 截断」，并点名安全机制来自 `hasDirectTargetTree` 门；另须在 anchor 之后追加一条消息让截断分支真正被跑到 |
| 独立文件增加了 core 测试进程数 | 低 | 全量测试变慢 | 3 个文件可忽略 |

---

## H6 · 钩子⑥ 零收集守卫

- **严重度 / 簇**：P0 的**通用化**（N-P0-02 的教训）· 全仓测试基础设施
- **病症**：任何 `node --test` / `vitest` 包装脚本，如果「glob 展开失败 → 收集 0 条 → 退出码 0」，
  就是**假绿**。N-P0-02 就是这么发生的：Windows 下单引号不被当引号 ⇒ 匹配 0 个文件 ⇒ `1..0` ⇒ 绿。
  而「Linux 绿 / Windows 静默空跑」这一类 bug **只能在「两种 shell 都跑一遍」的门禁里被抓住**。

### H6.1 证据

**`apps/desktop/scripts/run-tests.mjs:23-35`**（全文核对）：

```js
// 默认目标整体加引号交给 node --test 的递归 glob 展开：execSync 走 /bin/sh
// （无 globstar），`test/**` 只展开一层子目录，顶层 *.test.ts 全部缺席
const testTargets =
  extraArgs.length > 0
    ? extraArgs.join(" ")
    : "'test/**/*.test.ts' 'test/**/*.test.tsx' 'test/**/*.test.js'";

execSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  { cwd: desktopRoot, stdio: "inherit", env, shell: true },
);
```

三重问题：
1. `:30` 三个 glob 用**单引号**包裹；`:34` 的 `shell: true` 在 Windows 走 `cmd.exe`，cmd 不把单引号当引号
   ⇒ `node --test` 收到含**字面引号**的 pattern ⇒ 匹配 0 个文件。
2. `execSync` 只看子进程退出码；`node --test` 跑 0 条时退出码是 **0** ⇒ 脚本 `exit 0`。
3. `:23-26` 的注释「execSync 走 `/bin/sh`」**只在 Linux 成立**，CI 是 `ubuntu-latest` 所以线上绿。

**同类面（第二个包装脚本）**：`packages/core/package.json` 的 `scripts.test`：

```json
"test": "bash -O extglob -O globstar -c 'tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/**/!(performance).test.ts'"
```

`bash -O extglob` 在**没有 bash 的 Windows 环境**直接跑不起来；
`test:fast` 则是裸 `tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test`——
**传一个拼错的路径进去，收集 0 条、退出码 0、看起来全绿**（RULE 已记的同族假信号）。

**CLI 侧**：`apps/cli/package.json` 的 `"test": "tsx --test test/**/*.test.ts"`——
node ≥22 的 `--test` 自身支持 glob 展开，cmd 不做展开反而是对的，**这一侧是安全的**（不要误伤）。

### H6.2 修法（文件·函数级步骤）

**Step 1 — 通用守卫模块 `scripts/lib/zero-collect-guard.mjs`（新建，仓内可复用工具，遵守 RULE 收编 `scripts/` 的纪律）**

导出 `assertNonZeroCollected({ collected, where })`：`collected === 0` ⇒ 打印诊断
（命令、cwd、glob 展开后的实际文件数）并 `process.exit(1)`。

**Step 2 — `apps/desktop/scripts/run-tests.mjs`**
- `:30` 三个 glob 改**双引号**（node 侧仍递归展开，语义不变；`shell:true` 的语义在两种 shell 下都正确）；
- `:23-26` 注释改成中性表述：「Linux 与 Windows 的 shell 引号语义不同，故用双引号」
  （RULE 反对把平台假设写进注释当事实）；
- 收集数怎么拿？**两条路**：
  - (a) `spawnSync` + `stdio: 'pipe'`，从 stdout 里正则抓 `^# tests (\d+)$`；
  - (b) **更稳**：**收集在 Node 侧自己做**——用 `fs.readdirSync(dir, {recursive:true})` 递归
    列出匹配三个模式的文件，把**绝对路径列表**传给 `--test`（不经 shell 展开），
    然后断言 `files.length > 0`。
  **默认建议 (b)**：它同时消灭了「引号语义」这个整类问题（不再需要给 glob 加引号），
  且收集数在起子进程**之前**就已知。（RULE 已记：worktree 里的可复用模板
  `tmp/desktop-full.mjs` 用的正是「五扩展名 + 递归」这一形态。）
- 顺带补 `--test-concurrency=2`（RULE 已记：desktop 满负载下 `blob-binary-normalization-service.test.ts`
  的 `cr-05` 会偶发超时，降并发即 581/581 全绿）。

**Step 3 — `packages/core`**
- `scripts.test` 的 `bash -O extglob -O globstar -c '...'` 换成一个仓内 Node 脚本
  `packages/core/scripts/run-tests.mjs`：用 `fs` 递归收集 `test/**/*.test.ts`（排除 `performance.test.ts`），
  断言收集数 > 0（🔁 **R2-14 刷新**：`baseline.md §4` 实测 `Get-ChildItem packages/core/test -Recurse -Filter *.test.ts`
  = **434 个文件**；原文写的「约 396」是陈旧值，已作废。**扫描面 = `packages/core/test` 递归、仅 `*.test.ts`，
  含 `performance.test.ts`，故实收集数会略小于 434**——引用这个数时必须带扫描面一起写），再 `spawnSync` 起
  `tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test <files...>`。
- `test:fast` 加同样的守卫（传 0 个路径 ⇒ exit 1）。

**Step 4 — CI 步骤（门禁要在两种 shell 都跑一遍）**

⚠️ **`runs-on` 是 job 级键，写在 step 上会被 GitHub Actions 忽略**（该步骤照样跑在默认的
ubuntu runner 上，双 shell 门禁形同虚设——而这恰是本条的核心诉求，sr1-e-c MF-2）。
必须走**独立 job** 或 `strategy.matrix`，二选一：

```yaml
# 方案 a（默认建议）：独立 job，runs-on 在 job 级
  zero-collect-guard:
    name: Zero-collect guard (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # N-P0-02 的假绿只在 Windows 出现：单引号 + shell:true 在 Linux 绿、Windows 静默空跑，
      # 只跑 Linux 等于没测。零收集退出码为 0 这件事已由实测证实（零收集 ⇒ EXIT=0）。
      - name: Zero-collect guard
        run: npm run test:collect-guard --workspaces --if-present

# 方案 b：留在主 job 的 steps 里，用 matrix.os 传给一个 bash/pwsh 封装脚本
# （同样不能出现 step 级 runs-on）
```

各包加 `"test:collect-guard": "node scripts/collect-check.mjs"`（薄封装 `zero-collect-guard.mjs`）。

**Step 5 — 故意破坏验收**（唯一有意义的验收）
临时把 `run-tests.mjs` 的 glob 改回**单引号**（或把路径写成一个不存在的目录），
跑 `npm test` ⇒ **期望 exit 1 且打印「收集 0 条」**；在 ubuntu 与 windows 两个 runner 上**各跑一次**。

### H6.3 验收

```powershell
# ① 守卫可跑（期望：打印收集到的文件数并 exit 0）
cd apps/desktop; npm run test:collect-guard
cd packages/core; npm run test:collect-guard

# ② 牙齿：把 run-tests.mjs 的 testTargets 改成单引号 → 期望 exit=1
#    把收集目录改成 ./nonexistent      → 期望 exit=1

# ③ 回归
cd apps/desktop; npm test                              # 期望 0 fail（条数与 baseline.md 一致）
cd packages/core; npm test                             # 期望 0 fail（3126 条，RULE 已记口径）
#    🔁 R2-14 刷新：基线实测 # tests 3126 / # pass 3123 / # fail 3（其中 2 条确定性 + 1 条性能护栏），
#       原文写的「约 2748」已作废（judge-r1 E.4）。
```

### H6.4 测试策略

- 新增：`scripts/lib/zero-collect-guard.mjs`、各包 `scripts/collect-check.mjs`。
- **不新增单测**——守卫的测试就是「② 故意破坏」。给守卫写单测会重蹈
  「同进程二次调用被模块级标记挡掉」的覆辙（RULE 判据②的原型事故就是 `startupMaintenanceRan`）。
- **三判据**：① 有牙吗——引号改回单引号 ⇒ 红。成立。
  ② 恒红吗——收集数在真实仓库恒 > 0，不涉及进程级标记。成立。
  ③ 一夹具两期望吗——否。

### H6.5 回归线

- `apps/desktop` 全量（**必须**是守卫修好后的命令；RULE 已记：修好前 Windows 上是 0 条假绿）。
- `packages/core` 全量（🔁 **R2-14 刷新**：当前口径 **3126 条** = 基线实测 `# tests 3126 / # pass 3123 /
  # fail 3`；原文写的「约 2748」是台账旧数，已作废，判绿以 `baseline.md §4` 为准）。
- `apps/mobile` `npx jest --maxWorkers=2`（jest 自带 collected 数断言，**不需要**本守卫；
  但要在脚本注释里写明「jest 已有守卫，勿重复加」）。

### H6.6 依赖

- **X1 的 Step 5（CI 改 blocking）**应与本条同 PR——两条都改 `ci.yml` 的 Test 段。
- **X2 的棘轮门禁**同理（都在 ci.yml 加步骤）。
- 与 N-P0-02（Wave A 修 `run-tests.mjs` 单引号）**是同一处改动，不是「同一条线的两段」**
  （sr1-e-c MF-2 实测）：台账 `ledger-v2.md:435` 的 N-P0-02 动作列里**已经**写了
  「单引号改双引号 **+ 零收集守卫 `process.exit(1)` + `:23-26` 注释中性化**」三件事，
  与本条 Step 2 的三件事**逐字重合** ⇒ 两片会改同一个文件的同一段。
  **归一方向（本片口径，照抄自 sr1-e-c MF-2）**：
  - **Wave A 落最小版**：改引号 + 注释中性化 + 调**同一份** `scripts/lib/zero-collect-guard.mjs`；
  - **本条 H6 只承接通用化**：core 侧的 `run-tests.mjs` 化 + 各包 `collect-check.mjs` + 双 shell CI；
  - 两者**必须同 PR 或严格有序**，且**守卫实现只能有一份**（不许两片各写一个守卫模块）。
  原文那句「本条不应等待 Wave A」已按此改写。
  🔗 **已裁（judge-r1 C② + B14，采纳 wave-e 口径）**：跨片归一结论已终裁，并已作为依赖边写进 `SPEC.md §3`。
  守卫实现只能有一份、Wave A 在前。本节不再保留「待 judge」自述。

### H6.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 改用「Node 侧收集 + 绝对路径」后，命令行长度超 Windows 8191 限制 | **中**（desktop 有 620+ 文件） | Windows 上起不了进程 | 按目录分批 spawn（每批 ≤ 100 个文件），或写临时清单文件用 `node --test --test-reporter` 读。**落地时必须先在 Windows 上实跑一次** |
| core 从 `bash -O globstar` 换成 Node 收集后，收集范围悄悄变了（多收/少收文件） | 中 | 测试条数变化 → 误判回归 | 上线前**逐条 diff 旧 glob 与新收集器的文件列表**，把 diff 结果写进 PR；`baseline.md` 记条数 |
| CI 加 `windows-latest` runner 使 CI 时长 +N 分钟 | 低 | CI 变慢 | 只跑 `test:collect-guard`（不起全量测试），成本是秒级 |
| 回滚 | — | — | 守卫是新增文件 + 脚本改动，`git revert` 即可；回滚后 Windows 假绿风险回归，**须在 PR 里写明** |

---

## C1 · 注释承诺 ≠ 实现

- **严重度 / 簇**：P2 · core-infra/tokenizer + 主仓 RULE
- **病症**：代码注释与 RULE 文档里存在**被反复引用、但与实现不符**的承诺。
  这类东西比没有文档更危险：后来人按注释推理，推理链全程错误。

### C1.1 证据

**(a) `chunk-splitter.ts:12-14` 的「逐块 encode ≤64」** —— 已在 H4 完整展开，
不成立（`"。".repeat(200)` 产出单块 200 字符）。同文件 `:21-22`、`:36`、`:40` 四处同款承诺。

**(b) `chunk-splitter.ts:4-7` 的「这是内容寻址缓存正确性的前提」**：
`splitTextIntoChunks` **零生产消费方**（只有 barrel 转发；测试消费方 5 处见 H4.5，
但 `token-chunk-cache.ts` 自己不调用它）。这条因果链今天没有任何生产代码承受。

**(c) 主仓 `docs/apm/RULE.md` 的 hidden 过滤指向测试假件**（`RULE.md:13` 末段）：

> → `packages/core/src/domain/chat/model/message.ts`（`hidden` 字段）、过滤逻辑：
> `packages/core/src/domain/agent/session/`

实测该目录**只有两个文件**：

```
packages\core\src\domain\agent\session\agent-session.port.ts
packages\core\src\domain\agent\session\impl\in-memory-agent-session.ts
```

而 `in-memory-agent-session.ts` 的文件头自己写着：

```
 * In-memory agent session (tests).
```

**它是测试替身**。真实的 hidden 过滤在
`domain/chat/repositories/impl/sqlite-message.repository.ts`（`includeHidden` 参数）、
`service/agent/impl/chat-agent-session.ts`、`service/chat/impl/message.service.ts` 三处。

### C1.2 修法

**(a)(b)** 已在 H4 Step 2 落地（四处注释 + 文件头前提声明）。

**(c) 的处置是「写注记，不写动作」**——RULE.md 属主仓 `docs/apm/`，**代理禁写**（AGENTS.md +
RULE.md:91 明文）。本条只做两件事：
1. 在本分片留一条**注记**（见文末「分片级注记」与 C2 条目），把正确路径与错误路径都写清；
2. 由**主代理/用户**在主仓改 `RULE.md:13` 的这一行。

### C1.3 验收 / 测试策略 / 回归线 / 依赖 / 风险

- 验收：`cd packages/core; npx tsx --test test/infra/tokenizer/chunk-splitter.test.ts` 全绿。
- 测试策略：见 H4.4。
- 回归线：`packages/core` 全量 `npm test`。
- 依赖：(c) 依赖**用户/主代理**在主仓提交；本 wave 内不阻塞。
- 风险：把注释改「对」但把注释删掉，等于把知识也删了。**只订正、不删除**。

---

## C2 · RULE 提交项 —— **已作废（病症被实测证伪，sr1-e-c MF-7）**

- **原严重度 / 簇**：P3（流程项）· 主仓 docs/apm
- **原病症（已证伪，不成立）**：主仓 `docs/apm/RULE.md` 的 2026-09-29 修正**已在工作区但未提交**，
  而本 worktree checkout 的是旧提交版 ⇒ 迭代期间读到的 RULE 与用户手上的不一致。

### C2.1 证伪证据（2026-10-01 实测）

| 检查 | 实测结果 |
|---|---|
| 主仓 vs worktree `docs/apm/RULE.md` 的 SHA256 | **完全相同**（`16A5B011…94C`） |
| 两侧行数 | 均 **140 行**（原文写「118 行」，是旧版口径） |
| `Compare-Object` 两侧差异 | **0** |
| 主仓 `git status --short docs/apm/RULE.md` | **输出为空**（无 `M`，工作区干净） |
| `git log -1 -- docs/apm/RULE.md` | **`fe79b781`**（已随本迭代基线提交） |

⇒ 台账 `ledger-v2.md:486` 记的「已在工作区但未提交」「worktree 是旧提交版、子代理会读到旧的」
**两条病症均不成立**，本条整条作废：原来的修法（提交 RULE.md、重新 checkout/rebase）**无对象可操作**，
照做是无意义动作。

### C2.2 处置（保留条目的唯一原因）

条目**保留而不删除**，是因为 C1(c) 的「RULE.md hidden 过滤路径写错」这件事**仍然成立**，
且仍需由用户/主代理在主仓改——那件事与「RULE.md 有没有提交」无关，与本条被证伪的病症无关。
C1(c) 的正确路径与错误路径写在 C1.1(c)，此处不再重复。

- 本 wave 仍**不执行任何提交动作**、**不写 `docs/apm/` 下任何文件**
  （AGENTS.md + RULE.md:91 的子代理禁令）。
- ⚠️ 唯一剩下的、与 C1(c) 合并提交的建议：改 `RULE.md:13` 的 hidden 过滤路径那一行时，
  一并把 C1.1(c) 给的正确路径写进去。**这不是阻塞项**（RULE 当前版本两侧一致，不会读错）。

### C2.3 验收 / 测试策略 / 回归线 / 依赖 / 风险

- 验收：**无**（原文那条 `git status --short docs/apm/RULE.md ⇒ 输出为空` 是**假验收**——
  它在写下的时候就已通过，且不覆盖任何病症；已删）。
- 测试策略：无（纯流程项）。
- 回归线：无。
- 依赖：**无**。原文「必须在 Wave E 落地前完成，否则后续 wave 读到的 RULE 仍是旧版」的
  **阻塞理由已被证伪**，不再成立——后续 wave 读到的就是 `fe79b781` 那一版。
- 风险：无（留着旧文本才会误导 judge 排依赖）。

---

## 分片级注记

### 与 wave-a 的边界

| 事项 | 归属 | 本分片的处置 |
|---|---|---|
| CI `Typecheck` 摘 `continue-on-error` | **wave-a** | 本分片不重复做；X1 的 Step 5 只承接其结果 |
| CI `Lint` 摘 `continue-on-error` | **wave-a 定调 + 本分片兑现** | wave-a 拍板「Lint 分步」；本分片负责把 desktop/core/驱动包修到 0 error，**mobile 的 27 errors + `--max-warnings 321` 失效问题仍归 wave-a** |
| N-P0-01 的源码修法（`prompt-macro-input.ts` 改深层直引） | **wave-a** | 本分片只做门禁（X3），且 X3 门 B 的白名单**收紧到最小集这一步等 wave-a 落地后做** |
| N-P0-02 的 `run-tests.mjs` 单引号止血 **+ 零收集守卫 + 注释中性化** | **wave-a 落最小版，本分片 H6 承接通用化** | **两片改的是同一处**（台账 `ledger-v2.md:435` 的 N-P0-02 动作列已含 H6 Step 2 的三件事，sr1-e-c MF-2 实测）。守卫实现只能有一份：wave-a 调 `scripts/lib/zero-collect-guard.mjs`，本分片只做 core 化 + 各包 `collect-check.mjs` + 双 shell CI；**必须同 PR 或严格有序**。🔗 **已裁（judge-r1 C② + B14）**，见 H6.6 与 `SPEC.md §3` 依赖边 |
| 编码还原批次 1（apps/mobile，★5 卡） | **wave-a** | 本分片 H1 只负责 core 的 4 BOM + 7 U+FFFD + 全仓 BOM，不碰 mobile 的还原动作 |
| X1 / X2 / X6 对 `ci.yml` 的改动 | **本分片** | 三处都改 `ci.yml`（X1 Step 5、X2 Step 3、H6 Step 4），**建议合成同一个 PR**，避免三次 CI 试错 |

### 与 wave-b-core2 的边界

| 事项 | 归属 | 本分片的处置 |
|---|---|---|
| N-P1-02 补 `skillsEnabled`/`skillsPrefix` 两个 spread | **wave-b-core2** | 本分片 H2 只加 `satisfies` 守卫 + 断言 + 3 条测试。**若 wave-b-core2 先落，H2 变为纯追加**；若本分片先落，H2 的 Step 1 会让 core 编译红 ⇒ **两者必须同 PR 或严格有序** |
| `findSavedModelReferences` 补 `chat_session` 分支 | 建议 **wave-b-core2** | 本分片 H5.1.2 只写**留证用例**（`test.todo`），不碰实现 |
| `model-request` 重试闩锁 | **wave-b-core2（M-01，judge-r1 已裁定落该片）** | 本分片 H5.1.3 的 `test.todo` 已撤销（R2-7），测试落点改由 M-01 实条目承接；本分片不碰实现 |
| `computeLlmExportZonesFromLayout` 的 skills 双保险 | 建议 **wave-b-core2** | 本分片 H2 Step 4 只挂「删掉 spread 即红」的断言，**不动行为** |
| core 的 4 条 `no-regex-spaces` + 4 条其他 lint error | **本分片 X1** | wave-b-core2 不碰 |

### 本分片的三处「与台账不一致」汇总（供 judge 轮裁）

1. **`shared/logic/events.ts`「2 符号零消费」不成立**（`fe79b781` 上 4 符号全有消费方，
   `raw/w3-xc-ipc.md:287` 早已推翻）。本分片按已证伪处理，**不入修法**，
   建议同时回改 `ledger-v2.md:487` 与 `synth/apps-desktop.md:410`。
2. **X3 的门禁形态必须改写**：台账的「bundle 出现 4 个构造即 fail」在 `fe79b781` 上
   **3/4 包先天命中**（`rich-document` 命中 100% 第三方；`code-editor` 那格是 `Object.hasOwnProperty`
   误伤、严格匹配实为 0 ⇒ 真实是 3/4 而非 4/4），不可实施。本分片改为
   **门 A（源码 eslint，零存量债、当天 blocking）+ 门 B（core 模块依赖准入白名单，对住病根）
   + 门 C（产物计数棘轮）**。台账的验收句「故意塞一个 `.at(` 进源码跑构建必红」在**门 A** 下成立。
3. **X2 的基线数字**：台账 424 / 本分片实测 411，**两者都不是 0**，
   权威数字以 `baseline.md` 为准；本分片给的「分批清单」按 411 的分布写（`test/` 190 / `renderer/` 178 / `src/` 42）。
