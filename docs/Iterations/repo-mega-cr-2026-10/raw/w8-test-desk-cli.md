---
zone: w8-test-desk-cli
agent: 测试语料健康度代理（牙齿三判据 / 死测试 / 续命测试 / fixture 腐烂）
files_scanned: 153（apps/desktop/test 132 + apps/cli/test 21）
measured_at: 2026-10-01
worktree: D:\Dev\nm-worktree\mcr @ 9ca5f5ad
---

# W8 测试语料健康度报告（apps/desktop/test + apps/cli/test）

## 摘要

这两个目录是全仓唯一的 Electron 桌面端与 CLI 端测试语料，共 153 个文件、722 条用例
（desktop 620 + cli 102），全部跑在 `npx tsx --test`（Node 原生 test runner，真 ESM）
上，桌面端靠 `module.register` 钩子链替换 electron / better-sqlite3 / js-tiktoken 等原生模块。
语料本身质量意外地高——**零 skip/only/todo、零重名用例、零「有 it 却无 assert」文件、零空 catch**，
静态声明的用例数与实跑收集数逐一对齐（620/620、102/102），没有孤儿文件。
问题**不在用例内部，而在「用例之外」的四层承托结构**：Windows 收集器空跑、CLI 夹具腐烂导致
26 条永久红灯、桌面测试完全无类型门限、以及若干被作者自己注释出来的顺序依赖。

## 职责与边界

- **桌面侧**：`apps/desktop/test/`（108 个 `.test.ts/.tsx/.js` + 24 个钩子/桩/环境 helper）
  覆盖 main 进程 IPC handler、renderer 组件与 hook、update-check、DB 维护、preload 契约。
  运行器 `apps/desktop/scripts/run-tests.mjs` 负责拼命令 + 注入 `--import register-electron-mock.mjs`。
- **CLI 侧**：`apps/cli/test/`（20 个 `.test.*.test.ts` + `helpers.ts`）
  几乎全是 e2e：`helpers.ts:53` 用 `spawnSync(process.execPath, ["--import","tsx", CLI_ENTRY, ...args])`
  反复拉起真实 CLI 进程，单条用例耗时 29–41 秒。
- **不在本区**：测试所断言的生产实现（各由对应 zone 负责）。本报告只对「断言是否有效、
  夹具是否可信、收集是否真的发生」负责。

## 对外接口

本区不对外提供 API，只被两处消费：

| 消费方 | 位置 | 作用 |
|---|---|---|
| CI | `.github/workflows/ci.yml:66` | `npm run test --workspaces --if-present`（`runs-on: ubuntu-latest`，无 Windows job） |
| 本地开发者 | `npm test -w @novel-master/desktop` / `@novel-master/cli` | AGENTS.md 与 RULE 显示主开发机是 Windows |

## 数据访问

| 目标 | 证据 | 说明 |
|---|---|---|
| `process.env.NOVEL_MASTER_DB` | `apps/desktop/test/desktop-db-test-env.ts:18` | 桌面测试把库路径指向 `mkdtemp` 临时目录，`:24` teardown 时删除 |
| `.test-native/better-sqlite3` | `apps/desktop/scripts/ensure-test-native.mjs:14`、`register-electron-mock.mjs:12-15` | Node-ABI 副本；**仅当 `package.json` 存在才注册钩子** |
| `packages/core/dist` | `apps/desktop/test/core-at-alias-hook.mjs:11` | `@/` 一律从 **dist** 解析，不是 src |
| `os.tmpdir()` 下的 CLI 库 | `apps/cli/test/helpers.ts:9-10` + 各 e2e 的 `mkdtemp` | 每条用例自带 `--db <tmp>/novel.db`，**无真实 home 污染**（已逐个核对） |
| `examples/agents.yaml` | `apps/cli/test/agent-registry-e2e.test.ts:10` | 仓库内固定夹具 |

## 依赖关系

```
ci.yml(ubuntu) ──> npm test --workspaces
                      ├── apps/desktop: package.json#test
                      │     └── scripts/run-tests.mjs  (pretest: ensure-test-native.mjs)
                      │           ├── NODE_OPTIONS=--import test/register-electron-mock.mjs
                      │           │     └── register() × 3~4: electron-hook / core-at-alias-hook
                      │           │                        / js-tiktoken-hook / better-sqlite3-hook
                      │           └── npx tsx --tsconfig tsconfig.renderer.json --test <glob>
                      └── apps/cli: package.json#test = tsx --test test/**/*.test.ts
                            └── helpers.ts#runNm -> spawnSync(tsx src/index.ts ...)
```

**未被任何门限消费**：`tsconfig.renderer.json`（含 `test/**/*`）只被 `run-tests.mjs:33` 当作
tsx 的 tsconfig 和 `eslint.config.mjs:65` 的 project 用；`npm run typecheck` 用的是
`tsconfig.json`（`apps/desktop/tsconfig.json:8` 的 include 只有 `src/main/**/*` 与 `shared/**/*`），
**不含 test/**。

---

## 发现清单

### 分类一：无牙断言

#### F-w8-1 ｜ P0 ｜ `apps/desktop/scripts/run-tests.mjs:30` ｜ Windows 上收集 0 条并输出假绿

```js
: "'test/**/*.test.ts' 'test/**/*.test.tsx' 'test/**/*.test.js'";
// :23-26 注释：「默认目标整体加引号交给 node --test 的递归 glob 展开：execSync 走 /bin/sh」
```

**这是本区最严重的一条，且被错误注释掩盖。**

实测（`apps/desktop` 下）：

| 跑法 | 收集结果 |
|---|---|
| `npm test`（当前默认，单引号） | `1..0` / `# tests 0` / `# fail 0` ← **退出码 0，全绿，一条没跑** |
| `npx tsx --test "test/**/*.test.ts" "..."`（双引号等价） | `# tests 620` / `# pass 616` / `# fail 4` |

证明链：
1. `run-tests.mjs:34` 的 `execSync(..., { shell: true })` 在 Windows 上用的是 cmd.exe，
   实测 `process.env.ComSpec = C:\WINDOWS\system32\cmd.exe`。cmd.exe **不把单引号当引号**，
   原样传给 node，`node --test` 把 `'test/**/*.test.ts'` 当成含字面引号的 pattern → 匹配 0 个文件。
2. 注释里「execSync 走 /bin/sh」这个前提**只在 Linux 成立**，CI 是 `ubuntu-latest` 所以线上绿，
   Windows 本地永远空跑。
3. 运行器**没有零测试守卫**：`1..0` 的退出码是 0，任何 `&&` 链都判为成功。

影响：本机开发者跑 `npm test` 得到的「全绿」不代表任何东西；而 620 条真实用例里此刻有 4 条红的，
它们在 Windows 上永远不会浮现。

- **建议**：`testTargets` 改成双引号（node 侧仍会递归展开，语义不变），并在子进程退出码为 0
  而收集数为 0 时 `process.exit(1)`；或直接用 `node:test` 的 `--test-force-exit` 配合自建文件枚举
  绕开 shell 传参。同时把 `:23-26` 的注释改成「Linux 与 Windows shell 引号语义不同」的中性表述。
- **置信**：confirmed（实测四组对照 + ComSpec 实测）

#### F-w8-2 ｜ P1 ｜ `apps/desktop/test/agent-prelude-terminal.test.ts:216-219`、`agent-run-early-exit.test.ts:66-69` ｜ assert 之后的 if 分支不可达，内层断言永不执行

```ts
assert.equal(second.ok, true, "前奏终态后必须能立刻再发");
if (!second.ok) {
  assert.notEqual(second.error.code, "AGENT_BUSY");   // ← 永不执行
}
```

证明：`node:assert/strict` 的 `equal` 带 `asserts actual is T` 签名，第一行已经把 `second.ok`
收窄为 `true`，`if (!second.ok)` 的分支类型被推成 `never`。tsc 对这两行直接报
`error TS2339: Property 'error' does not exist on type 'never'`——**编译器已经证明它是死代码**。
测试/ 下共 42 条 TS2339。

牙齿判据①复核：这条断言改掉被测实现会不会红？**不会**——外层 `assert.equal(second.ok, true)`
已经承担了全部牙齿（真返回 AGENT_BUSY 时 ok=false、第一条就红），内层那句纯属摆设且误导读者
以为「有专门一条断言在查 AGENT_BUSY」。

- **建议**：删除不可达的 `if` 块；若想保留「不是 AGENT_BUSY」的显式意图，改写成
  `assert.equal(second.ok, true, "不应返回 AGENT_BUSY")` 一句。
- **置信**：confirmed（tsc 输出 + 源码）

### 分类二：死测试

#### F-w8-3 ｜ P2 ｜ `apps/desktop/test/stream-token-estimator.test.ts:49` ｜ 断言「必须是本文件第一条用例」

```ts
// :34-39 「本条**必须是文件里的第一条用例**……位置即是断言的一部分。」
const before = jsTiktokenTestHandle.constructionCount;
assert.equal(before, 0, "本条之前不应有任何编码表构造");
```

RULE L82 牙齿判据②的教科书样本：进程级模块状态（`js-tiktoken-hook.mjs:36` 的
`constructionCount` + core `encoding-registry` 单例）被文件里**第一条**抛错工厂的用例消费。
当前绿（node:test 按声明顺序执行），但在上方插入任何一条调用
`createDesktopStreamTokenEstimator()` 的用例，它立刻变成永久红。

作者已经写明了约束却没修。RULE L82 给的修法是「把不可观测的正向路径拆到独立测试文件（独立进程）」。

- **建议**：把这条拆成独立文件 `stream-token-estimator-registry-singleton.test.ts`。
- **置信**：confirmed

#### F-w8-4 ｜ P2 ｜ `apps/desktop/test/use-agent-stream-metrics-hook.test.tsx:334` ｜ 依赖模块级去重标志未被消耗

```tsx
// :309-313 「以下三条的**声明顺序有依赖**：工厂抛错的告警去重标志是模块级的
//          （useAgentStreamMetrics.ts 的 warnedEstimatorFactoryFailure，跨 run 累积）」
assert.equal(warnings.length, 1);
```

同判据②：`warnedEstimatorFactoryFailure` 是模块级「只告警一次」标志，
「首次告警一次并带 err」这条必须排在所有其他抛错工厂用例之前，否则看到 0 条告警、永久红。

**同族反向问题**：`:374` 那条（工厂返回 null 与工厂抛错）明确注释「已由上一条用例消耗掉一次性告警」，
因此它对告警口径**不再有任何观测面**——这正是判据②所说的「后续用例里相关路径永远不可观测」。
目前该用例只断言 token 读值，纪律尚可，但一旦有人给它加一条告警断言，就是条恒绿断言。

- **建议**：同 F-w8-3，拆分独立进程；或给被测模块加 `__test__.resetWarnedFlag()` 测试注入口。
- **置信**：confirmed

#### F-w8-5 ｜ P2 ｜ `apps/desktop/test/after-pack.test.js:14` ｜ darwin codesign 主路径零覆盖

```js
await afterPack({ electronPlatformName: "win32", ... });
assert.ok(true, "win32 should no-op without throwing");
```

`assert.ok(true)` 是恒真断言行（判据①），永不失败；真正承担牙齿的是 `await` 不抛异常。
被测的 macOS ad-hoc codesign 分支（`scripts/after-pack.mjs:19-32`，含 `result.status !== 0`
的失败抛错）**没有任何用例覆盖**。

- **建议**：用可注入的 spawn 缝替换 `codesign` 调用后补一条 darwin 正向 + 一条 codesign 失败负向；
  `assert.ok(true)` 删掉。
- **置信**：confirmed

#### F-w8-6 ｜ P3 ｜ `apps/cli/test/helpers.ts:157-164` ｜ `createSavedModelId` 的 `providerId` 分支是死代码

```ts
export function createSavedModelId(dbPath: string, vendorModelId: string, providerId?: string) {
  if (providerId != null) {
    runNm(["provider", "use", "--providerId", providerId, "--db", dbPath]);  // ← 永不进入
```

全仓唯一调用点 `helpers.ts:239` 走的是 `seedMockProviderModels` 内部调用，不传该参
（它自己在 `:236` 已经 `provider use` 过了）。整个 `providerId != null` 分支 0 次执行。

- **建议**：删掉该可选参数，或补一条真正走该分支的用例。
- **置信**：confirmed（全仓 grep 只有两个引用点）

### 分类三：续命测试

#### F-w8-7 ｜ P1 ｜ `apps/desktop/tsconfig.json:8` + `package.json#typecheck` ｜ 190 条测试类型错误零门限

```
$ npx tsc --noEmit -p tsconfig.renderer.json
test/ 下 190 条错误，涉及 41 个文件
按码：TS18047×49（可能为 null）、TS2339×42、TS6307×27、TS2322×12、TS2559×10、
      TS2571×11、TS18046×9、TS6133×6、TS7017×5、TS2740×4 ……
错误最多的文件：chat-prompt-tokens.test.ts(45)、token-usage-stats-view.test.tsx(43)、
                workspace-push-menu.test.tsx(17)、fetch-models-modal.test.tsx(9)
```

而**没有任何一道 CI 步骤会拦它们**：

1. `apps/desktop/package.json` 的 `typecheck` 是 `tsc --noEmit -p tsconfig.json`，
   该文件 `:8` 的 include 只有 `["src/main/**/*", "shared/**/*"]` —— **不含 `test/`**；
2. `.github/workflows/ci.yml:61-63` 的 Typecheck 步骤还带 `continue-on-error: true`；
3. Lint 步骤（`:57-59`）同样 `continue-on-error`；
4. Windows 上 `npm test` 又收集 0 条（F-w8-1）。

其中 TS6307×27 是**结构性**的：`tsconfig.renderer.json` 只 include
`["renderer/**/*", "shared/**/*", "test/**/*"]`，不含 `src/main/**`，
但 `test/agent-registry-handlers.test.ts:9`、`test/blob-binary-normalization-service.test.ts:17`
等大量用例要 import 主进程模块，于是报 "File … is not listed within the file list of project"。
这说明 `tsconfig.renderer.json` 从设计上就没打算真正 typecheck 这批测试。

**同时这条与 RULE L101 直接冲突**：RULE 写「desktop 的 `tsconfig.renderer.json` 的 `include`
覆盖 `test/**/*`，测试文件的类型错误会打红生产类型检查门限（`npx tsc --noEmit -p
apps/desktop/tsconfig.renderer.json`）」——实测该门在标准流程里**不存在**。
RULE L101 这条已腐烂，建议主代理一并订正（本次只读，未改）。

- **建议**：① 给 `apps/desktop` 增加一个 `typecheck:test` 脚本指向 `tsconfig.renderer.json`
  并把 `src/main/**/*` 加进该 tsconfig 的 include（消除 TS6307）；② 至少先把 42 条 TS2339
  （死断言，见 F-w8-2）与 49 条 TS18047 清掉，它们会直接暴露更多无牙断言。
- **置信**：confirmed（tsc 实跑 + package.json / ci.yml 原文）

#### F-w8-8 ｜ P2 ｜ `apps/desktop/test/core-at-alias-hook.mjs:11` ｜ 桌面测试锁的是 dist，改 src 不重建就静默跑旧码

```js
const coreDistRoot = path.resolve(__dirname, "../../../packages/core/dist");
```

桌面测试里一切 `@/` 导入都从 **core 编译产物**解析。这意味着改 `packages/core/src/**` 后
不重建 dist，桌面侧 620 条用例会全绿地跑在旧代码上。这是 RULE L71（新增 exports 子路径要同步
`packages/core/tsconfig.test.json` 的 paths，否则 tsx 回退 node 解析吃 `dist/` 旧产物）
在桌面侧的同族落点，而桌面测试对 dist  freshness 没有任何守卫。

本仓当前状态是**安全的**（实测 dist 2552 文件、最新 10/01 02:34，晚于 src 的 09/30 23:44），
但这是巧合而非机制。

- **建议**：在 `run-tests.mjs` 里比较 src/dist 最新 mtime，dist 落后即警告或 fail-fast。
- **置信**：confirmed（钩子源码 + mtime 实测）

#### F-w8-9 ｜ P2 ｜ `apps/desktop/test/packaging.test.js:11-42` ｜ 发行打包混进单测套件

```js
test("electron-builder --dir produces unpacked app", { timeout: 600_000 }, () => {
  const result = spawnSync("npx", ["electron-builder", "--dir", ...], { shell: true, ... });
```

单测套件里跑一次完整 electron-builder 打包（600 秒超时）。本机基线 620 条里的 4 条红灯
有 3 条来自 `smoke.test.js`（依赖 `dist/src/preload/preload.cjs`、`dist/renderer/index.html`、
`build/icons/icon.ico` 这些构建产物），另 1 条正是这条 `packaging.test.js`。

它们「响亮地红」而不是静默跳过，这点是好的；但把发行打包放进默认单测套件，
意味着任何人本地跑一次 `npm test`（在 Linux 上）都要付几分钟打包代价。

- **建议**：移到独立脚本（如 `test:packaging`），默认套件只保留 `existsSync` 契约断言。
- **置信**：confirmed

#### F-w8-10 ｜ P3 ｜ 11 处 `assert.equal(x.ok, true); if (!x.ok) return;` 死守卫

分布：`session-prompt-input.service.test.ts`（8 处：:62/:68/:77/:138/:142/:147/:291/:297）、
`chat-prompt-tokens-run-suppression.test.ts`（3 处：:107/:112/:130）、
`vfs-zip-export-name.test.ts:43-46`（1 处）。

与 F-w8-2 的区别：这些是**类型收窄工具**（`assert.equal` 不是断言签名时 TS 无法收窄，
需要显式 `if` 让 `project.ok` 走 true 分支），属于合理写法，只是 `return` 分支运行时不可达。
- **置信**：intentional（合理但冗余；改用 `assert.ok` 可省 11 处死分支）

### 分类四：fixture 腐烂

#### F-w8-11 ｜ P0 ｜ `apps/cli/test/*` 8 个文件 ｜ 26/102 条永久红灯，仓库自己已记为「既有债」

**实测**（`apps/cli` 下 `npm test`，dist 已于 10/01 02:34 重建、晚于 src，排除 stale-dist 假象）：

```
# tests 102   # pass 76   # fail 26
```

按文件归因：

| 文件 | 失败数 | 根因 |
|---|---|---|
| `vfs-zip-e2e.test.ts` | 4 | **B**：`project not found: [nm-boot] migration run: retire-pref-session-fs-version-check-v1` |
| `prompt-tokens-e2e.test.ts` | 5 | **A**：`新建会话失败：workspace 未配置 Agent，且 registry 为空` |
| `cli-context-e2e.test.ts` | 8 | A + 级联（T1/T3/T4/T5/T6/T8/T11） |
| `agent-config-e2e.test.ts` | 2 | A + 级联（E1/C2，报 `Missing --session <id>`） |
| `agent-registry-e2e.test.ts` | 2 | A（E3） |
| `agent-smoke-e2e.test.ts` | 2 | A + `Doom loop` 文案未匹配 |
| `workplace-e2e.test.ts` | 2 | 断言 `/\t\/s\.md\t/` 与 `<file path="` 未匹配 |
| `template-pull-e2e.test.ts` | 1 | deep-equal 不符 |

**根因 A —— fresh DB 没种 agent。** 产品在 `c3032e5e`（移除 session agent config 的
workspace 回退层）后给 `session create` 加了前置条件：workspace 没配 Agent 且 registry 为空就
`status=2`。手工复现（干净 tmp 库、逐条命令打印 status）：

```
$ session create   status=2   stderr="新建会话失败：workspace 未配置 Agent，且 registry 为空"
$ session use --session ""   status=2   stderr="session not found:"
```

于是 `sessionId` 变成空串，后续 `agent continue` 报 `Missing --session <id>` —— 全是级联症状。

**根因 B —— `[nm-boot]` 日志混进 stdout。** 新库第一条命令会打 migration 日志到 stdout，
`.stdout.trim()` 整段当 id 用。仓库在 `a1795ba2` 提交信息里把这两条都写成了已知根因，
**但只修了 3 个文件**（chat-smoke / session-rollback / preferences-C5），并在同一段明确写道：

> 「其余 CLI 套件的同类失败属**既有债，不在本 spec 范围**。」

也就是说这 26 条红灯是**仓库主动挂账、三周未偿**（`a1795ba2` 日期 2026-09-06，HEAD `9ca5f5ad`
日期 2026-09-30）。CI 的 Test 步骤（`ci.yml:65-66`）没有 `continue-on-error`，
所以 ubuntu 上应当同样红——但这需要主代理用 CI 实际状态复核（见「争议与存疑」）。

- **置信**：confirmed（根因与挂账均有提交信息原文 + 手工复现 + 实跑计数）

#### F-w8-12 ｜ P1 ｜ 同一批 CLI 用例 ｜ 夹具步骤丢弃返回码，把夹具失败伪装成生产失败

这是 F-w8-11 的**可诊断性放大器**，直接违反牙齿判据③（同一份夹具服务了一套互斥期望）。

```ts
// apps/cli/test/agent-config-e2e.test.ts
:24  runNm(["project", "create", ...]).stdout.trim();        // status 丢弃
:25  runNm(["project", "use", ...], {...});                   // 返回值整个丢弃
:33  runNm(["session", "use", ...], {...});                   // 返回值整个丢弃  ← 真凶
:48  assert.equal(agent.status, 0, agent.stderr);              // 报错指向生产
```

```ts
// apps/cli/test/helpers.ts:236 —— seedMockProviderModels 内部
runNm(["provider", "use", "--providerId", providerId, "--db", dbPath], runOpts);  // status 丢弃
```

后果实证：真凶是 `:33` 的 `session use` 静默失败（sessionId=""），但 26 条红灯里报出来的却是
`Missing --session <id>`、`Path not found: /t.md`、`No session titled "Main"`、
`session not found:` 这些**指向产品**的误导性错误。任何人顺着报错去查生产代码都会跑偏，
而真正的第一现场（`session create` status=2）根本不会出现在任何一条失败信息里。

- **建议**：把 `seedMockProviderModels` 提为 `helpers.ts` 的统一入口，内部对**每一步**做
  `assert.equal(r.status, 0, \`[夹具] nm ${args.join(" ")}\n${r.stderr}\`)`，
  失败信息打上 `[夹具]` 前缀，让夹具问题与产品问题在 TAP 输出里一眼可分。
- **置信**：confirmed

#### F-w8-13 ｜ P1 ｜ `apps/cli/test/` ｜ 「从 stdout 取 id」有四套并存实现 + 30 余处裸 `.trim()`

| 实现 | 位置 | 使用者 |
|---|---|---|
| `stripBootLogs` | `helpers.ts:40-46` | agent-smoke、prompt-tokens、provider、template-pull、helpers 内部 |
| `lastLine`（本地私有） | `chat-smoke-e2e.test.ts:34` | 仅本文件 |
| `lastLine`（本地私有） | `preferences-e2e.test.ts:109` | 仅本文件 |
| `lastLine`（本地私有） | `session-rollback-e2e.test.ts:80` | 仅本文件 |
| **显式拒绝 `stripBootLogs`** | `sort-rule-e2e.test.ts:21` | 「不用 helpers 的 stripBootLogs：其末尾 trim 会吃掉末行行尾的空 flags 列分隔 tab」 |
| **裸 `.stdout.trim()`** | 30+ 处 | agent-config(6)、cli-context(11)、vfs-zip(7)、workplace(4)、template-pull(2)… |

同一语义（取 CLI 输出里的 UUID）有四份实现、一份显式豁免说明、以及三十余处未加固的裸调用——
F-w8-11 的根因 B 正是从这张表里漏出来的。`stripBootLogs` 的语义缺陷（末尾 trim 吃掉 TSV 尾 tab）
是真问题，但它被就地私建了 3 份副本绕开，而不是收敛进 helper。

- **建议**：在 `helpers.ts` 收敛出唯一入口 `extractCliId(stdout)`（内部走「剥 `[nm-boot]` 行 → 取
  末个非空行 → 按需保留尾 tab」），让 `sort-rule` 的 TSV 例外走显式开关参数而不是复制实现。
- **置信**：confirmed

---

## 未发现问题（已实测排除，供 reduce 阶段免得重复扫）

| 检查项 | 方法 | 结果 |
|---|---|---|
| `.skip` / `.only` / `.todo` / `xit` | 全 153 文件 grep | **0 处** |
| 同文件内重名用例 | 静态扫描 128 个 ts/tsx | **0 处** |
| 「有 `it()` 但零 `assert.`」文件 | 静态扫描 | **0 处** |
| 空 `catch {}` | 静态扫描 | **0 处** |
| 孤儿文件（未被 glob 收集） | 静态计数 vs 实跑收集数 | desktop 620/620、cli 102/102，**完全对齐** |
| `helpers.ts` 真实 home 污染 | 逐条核对 `runNm` 调用 | 全部带 `--db <tmp>`，**干净** |
| ESM 钩子链 RULE L102 合规性 | 读 `js-tiktoken-hook.mjs:38-44` | 严格用 `createRequire(...).resolve()` 取真实路径，**无裸 specifier**，是全仓正确范式 |
| 全局 `COUNT(*)` 断言污染 | RULE L69 专项扫 `vfs_content_blob` 等 | 仅 `blob-binary-normalization-service.test.ts:165` 一处，但它的谓词刻意求「legacy 行清零」，属全局不变量，**判 intentional** |

---

## 争议与存疑

1. **CI 当前是否真的红**：`ci.yml:66` 的 `npm run test --workspaces --if-present` 没有
   `continue-on-error`，而我在 Windows 上实测 26 条 CLI 红灯、且已排除 stale dist 与平台差异
   （`session create` 的前置条件与 OS 无关）。若 ubuntu 上同样红，说明主干 CI 已挂三周——
   这超出本区职责，**请主代理用 CI 实际状态复核**后再决定是否升级为 P0 级流程问题。
   我未联网查 CI 运行记录，保持存疑不抹平。

2. **`blob-binary-normalization-service.test.ts:165` 是否算 RULE L69 违规**：该断言是
   `SELECT COUNT(*) FROM vfs_content_blob WHERE (encoding='zlib-b64' OR …) == 0`，
   未按测试自己的 scope 过滤，理论上会被 bootstrap 种子行污染。但它的语义是「全表不再有
   legacy 编码行」，本身就是全局不变量，过滤反而会削弱牙齿。**我判 intentional**，
   但承认 RULE L69 的字面要求与此处存在张力，交 reduce 阶段裁决。

3. **F-w8-1 的修复方案取舍**：改成双引号能立刻在 Windows 上恢复收集，但也意味着 Windows 上
   `npm test` 会**立刻变红**（当前那 4 条构建产物依赖的红灯会浮现）。是否先修夹具再修收集器，
   属于排序决策，不在本区权限内。

4. **`F-w8-4` 的严重度拿不准**：该用例当前纪律良好（只断言 token 读值，不碰已消耗的告警标志），
   我给 P2 是因为「任何人给它加一条告警断言就会得到恒绿断言」这个陷阱很近。若 reduce 阶段认为
   可降为 P3，我不反对。

5. 我未修改任何生产代码或测试代码，未做任何 git 写操作，未创建/修改 `docs/apm/` 下任何文件。
   过程中的临时探针脚本已全部删除。