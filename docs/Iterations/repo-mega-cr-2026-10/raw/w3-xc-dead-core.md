---
zone: xc-dead-core
agent: 横切-死导出核实（core）
files_scanned: 4 (L0 输入 + 3 份 raw 旁证) / 实核 core 死导出行 617 + 2 + 356 + core 全量 973 行
---

# W3 横切报告：死导出核实（core 部分）

## 摘要

`L0/dead-exports.md` 用「import 说明符 → 物理文件 + 符号名」精确匹配的口径，普查出全仓 1317 条
零消费导出、26 条 suspect、580 条仅测试消费。本机位负责 core 分片（`packages/core/src/**`），
用**独立实现**的符号级可达性判定器复核：40 条确认死抽样 **100% 复核通过**，2 条 suspect **全是真误报**，
20 条仅测试抽样里 **6 条被 L0 误分类**。全量跑完 core 973 行后，最大发现是 **L0 把「经 barrel 转发到
生产代码」的符号错分到「仅测试消费」桶**——core 356 条里有 127 条（35.7%）其实被生产代码消费。
另外确认了一个 L0 完全看不见的锁定面：`packages/core/test/package-exports/snapshots/*.json`
用 `Object.keys(mod)` 逐字锁住 12 个 public 子入口的运行时导出，core 617 条「确认死」里有 **173 条
落在快照锁定面上**，直接删会让 `public-subpath-allowlist.test.ts` 变红。

## 职责与边界

- **职责**：核实 `L0/dead-exports.md` 里 `packages/core/**` 的三张表（确认死 / suspect / 仅测试消费），
  给出假阳性率、可信删除清单、需人工裁决清单。
- **边界**：只管 core 行。apps/* 行由其它机位负责。判定「能不能删」时必须把 core 当作**库**看待——
  core 有 `package.json exports` 公开子入口 + 测试快照锁，所以「本仓无 import」≠「可删」。

## 对外接口

本机位不生产代码，只判定既有导出面。core 的公开面（决定任何一行能否删）：

- `packages/core/package.json:8` 起 26 个 `exports` 子入口（`.` → `src/index.ts`，
  `./agent` `./chat` `./compaction` `./events` `./feature-flags` `./message-checkpoint` `./prompt`
  `./provider` `./session-fs` `./smart-sort-rule` `./vfs` `./workplace` `./config-forms{,/agent,/shared,/stored-config-validity}`
  `./kkv` `./session-kkv` `./session-run-state` `./tdbc` `./nmtp` `./sksp` `./skills` `./common`
  `./format` `./regex` 等），共 994 个展开后的名字。
- 12 个子入口被快照逐字锁定（见「数据访问」）。

## 数据访问

- L0 输入：`docs/Iterations/repo-mega-cr-2026-10/L0/dead-exports.md`
  - 第一节（行 22–1340）确认死 **1317** 行，其中 core **617**
  - 第二节（行 1344–1370）suspect **26** 行，其中 core **2**
  - 第三节（行 1375–1956）仅测试 **580** 行，其中 core **356**
  - 实测复算与文档标注一致：1317 / 26 / 580 ✅
- 快照锁定面：`packages/core/test/package-exports/snapshots/` 13 个 JSON，
  `public-subpath-allowlist.test.ts:20-32` 用 `collectNamedExports`（= `Object.keys(mod)`，
  见 `helpers/export-snapshot.ts:2-5`）逐字 `deepEqual`。13 个快照共锁 551 个不同名字。
- `apps/mobile/test-utils/core-shim.ts`：59 个名字经 `packages/core/dist/**` 路径再导出
  （dist 目录当前**不存在**，L0 的 `resolveSpecifier` 全部解析失败）。

## 依赖关系

- 本机位脚本（只读，可复跑）：
  `tmp/w3c/trace.mjs`（符号级 import/reexport 图 + `export *` 边）、
  `tmp/w3c/verify.mjs`（可达性判定，参数 `s1`/`s2`/`s3`/`s1all`/`s3all`）、
  `tmp/w3c/tier.mjs`（公开面分层）、`tmp/w3c/filelive.mjs`（文件级引用）、
  `tmp/w3c/final.mjs`（生成删除清单）、`tmp/w3c/identity.mjs`（namespace 扫描）。
  依赖 `tmp/l0census/lib.mjs`（L0 的解析器，只借用 `resolveSpecifier`/`scanExports`，
  **不复用 L0 的消费判定逻辑**）。
- 复核器自校验（阳性对照，`tmp/w3c/dbg5.mjs`）：
  `KkvError` prod=5、`formatContextUsageLabel` prod=2、`ChatError` prod=2、
  `sortDirPaths` prod=3、`bootstrapNovelMaster` prod=3；
  阴性对照 `memoize` prod=0、`SessionKkvDomain` prod=0。判定器方向正确。

## 发现清单

### F-xc-dead-core-1 | P1 | `docs/Iterations/repo-mega-cr-2026-10/L0/dead-exports.md:1375-1956`（桶定义见 `tmp/l0census/dead-exports.mjs:197`）

```
const testOnly = rows.filter((r) => r.prod === 0 && r.test > 0);
```

**描述**：L0 把「仅被测试消费」定义为 `prod === 0 && test > 0`，**没有排除 `relayed > 0`**。
而 `relayed` 是「经 barrel `export {} from` 传递消费」——生产代码从 `public/xxx.ts` 导入、
`public/xxx.ts` 再从源文件转发，这条边的终点是 `R:<re-export>` 而**不是** `P:<importer>`（见
`tmp/l0census/dead-exports.mjs:150-157`）。于是「生产侧经 barrel 消费 + 测试侧直接 import」的符号，
`prod` 数组是空的（因为转发不记具体消费方），被判进 testOnly 桶。

**证据**：core 356 行全量复核，127 行（35.7%）实际存在生产消费方，且 127/127 全部是
barrel 转发路径（直接 import 的漏判为 0 行）。典型：

| 符号 | L0 分桶 | 实际生产消费方 |
|---|---|---|
| `packages/core/src/common/format-token-count.ts :: formatContextUsageLabel` | 仅测试 | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:34`、`apps/mobile/src/services/chat-prompt-tokens.service.ts:33` |
| `packages/core/src/errors/chat-errors.ts :: ChatError` | 仅测试 | `apps/cli/src/cli-errors.ts:13`、`apps/mobile/src/errors/format-error.ts:8` |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts :: CloudSyncCoordinator` | 仅测试 | `apps/desktop/src/main/services/cloud-sync.service.ts:12`、`apps/mobile/src/services/cloud-sync.service.ts:7` |
| `packages/core/src/infra/tokenizer/impl/heuristic-token-counter.ts :: CHARACTERS_PER_TOKEN_RATIO` | 仅测试 | 5 个生产文件（`useAgentStreamMetrics.ts:30` 等） |
| `packages/core/src/domain/tool/builtin/search/search-config.ts :: createSearchConfigStore` | 仅测试 | 2 个生产文件 |
| `packages/core/src/service/agent/create-agent-abort-registry.ts :: createAgentAbortRegistry` | 仅测试 | `create-desktop-runtime.ts:8`、`create-mobile-runtime.ts:8` |

**建议**：`testOnly` 改为 `r.prod === 0 && r.relayed === 0 && r.test > 0`。
修完后 core 的「真仅测试」应是 356 − 127 = **229** 行。
**建议**：W3 其它机位（apps 侧死导出）大概率有同款桶污染，需一并回查。
**置信**：confirmed（127/127 逐条追到生产 import 的 file:line）

---

### F-xc-dead-core-2 | P1 | `packages/core/test/package-exports/public-subpath-allowlist.test.ts:20-32` + `helpers/export-snapshot.ts:2-5`

```
const actual = collectNamedExports(mod as Record<string, unknown>);
assert.deepEqual(actual, [...snapshot].sort());
```

**描述**：`Object.keys(mod)` 逐字比对 JSON 快照，L0 的「import 说明符」口径**完全看不见这种消费**
（快照是字符串数组，不是 import 语句）。core 617 条「确认死」里 **173 条（28.0%）**的符号实际
出现在这 12 个 public 子入口的运行时导出面上，删掉即让该测试红。

**证据**：分层实测（`tmp/w3c/tier.mjs`）：

| 层 | core 确认死 617 中 | 文件数 | 含义 |
|---|---|---|---|
| A 快照锁定 public 面 | **173（28.0%）** | 81 | 禁删；要动必须先改 `public/**` 再更新快照 |
| B 公开面无快照 | **81（13.1%）** | 37 | 是 package.json exports 面，外部消费者风险，需人工裁决 |
| C 不在公开面 | **363（58.8%）** | 186 | 可信可删 |

A 类细分（因为快照用 `Object.keys`，**只锁运行时值导出，type-only 测不到**）：

- **A-value 74 条**：删了快照测试必红。抽样核对 58/74 名字确实在某份快照 JSON 里；
  剩下 16 条全是 `packages/core/src/infra/tokenizer/index.ts` 的 `reexport`（`TokenSourceBadge`、
  `ChatTokenEncoder`、`EncodingFactory` 等），它们走 `./tokenizer` 之外的另一入口，快照没覆盖——
  仍属公开面，不能按 C 类处理。
- **A-type 99 条**：type/interface，快照测不到，但**仍在公开 `.d.ts` 契约面**上
  （`KkvErrorCode`、`AgentConfigErrorCode`、`UserVfsTurnView`、`TailBatchMode`…）。
  外部包按类型消费时不受影响，但删了仍是 breaking change。

**建议**：把「是否在 `package.json exports` 展开面上」作为 L0 死导出表的第四个维度，
`isPublic` 现在只判 `index.ts` 与 `public/**` 两个物理文件（`tmp/l0census/dead-exports.mjs:162`），
漏掉了「源文件不在 public 下、但被 public barrel 转发」这一大类。
**置信**：confirmed

---

### F-xc-dead-core-3 | P2 | `apps/mobile/test-utils/core-shim.ts:13-97`

```
export { KkvError } from '../../../packages/core/dist/errors/kkv-errors.js';
```

**描述**：mobile 的 Jest `moduleNameMapper` 把 `@novel-master/core` 映射到 core-shim
（`apps/mobile/jest.config.js:58`），shim 用 `packages/core/dist/**` 相对路径再导出 59 个名字。
`packages/core/dist` 当前不存在，`resolveSpecifier` 对这些说明符 100% 解析失败，
于是「shim 转发 → mobile 测试」这条消费边在 L0 眼里完全不存在。

**证据**：把 shim 的每个 re-export 映射回 src 真实文件后与 L0 三张表求交：
- 「确认死」命中 **6 条**，全在 `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts`：
  `deriveToolUsesFromVfsActions`、`formatUserVfsTurnPreviewBody`、`USER_VFS_TURN_SPAN`、
  `ParsedUserVfsAction`、`ParsedUserVfsEditHunk`、`UserVfsTurnView`。
  这 6 条同时被 `packages/core/src/public/chat.ts:251-260` 转发，且名字出现在
  `test/package-exports/snapshots/public-chat-allowlist.json:15,59,78` —— 双重锁定，
  与 F-2 的 A 类重叠。
- 「仅测试」命中 14 条（同样与 A/B 类重叠）。

**判定**：这是**症状不是独立缺陷**——重叠部分已被 F-2 的公开面分层覆盖。
真正的独立影响是：mobile 单测若删掉某 core 符号，`moduleNameMapper` 会先报
「core-shim 解析到不存在的 dist 文件」而不是干净的断言失败。
**建议**：`resolveSpecifier` 增加 `packages/core/dist/X.js → packages/core/src/X.ts` 的
映射规则（`candidatesFromAbs` 已有 `.js→.ts` 逻辑，只差 `dist→src` 这一跳）。
**置信**：confirmed（6 条 + 14 条已逐条核到 file:line）

---

### F-xc-dead-core-4 | P2 | `packages/core/test/package-exports/duplicate-export-consistency.test.ts:3-9`

```
import * as cfShared from "@novel-master/core/config-forms/shared";
assert.equal(compaction.matchDepth, cfShared.matchDepth);
```

**描述**：`import * as ns` + `ns.X` 展开是 L0 已知盲区（`dead-exports.md:2518` 自述），
但 L0 的兜底只把「同名符号出现在**解析失败的说明符**」标 suspect——而
`@novel-master/core/config-forms/shared` 是**能解析成功**的（`package.json:105` 有 exports 项），
所以这些名字既不被判死、也不被标 suspect，只是安静地留在死表里。

**证据**：全仓 `import * as` 扫描（`tmp/w3c/identity.mjs`）共 21 处 namespace import，
其中 5 处真正消费 core 符号：

| 文件 | namespace | 消费的名字 |
|---|---|---|
| `packages/core/test/package-exports/duplicate-export-consistency.test.ts:4,8` | `compaction` | `matchDepth`, `validateDepthSlice` |
| 同上 `:3,9` | `cfShared` | `matchDepth`, `validateDepthSlice` |
| `packages/core/test/infra/tokenizer/token-counter-mode-no-public-path.test.ts` | `provider` | `parseTokenCounterModePref`, `isValidTokenCounterModePref`, `TOKEN_COUNTER_MODE_PREF_KEY` |
| `packages/core/test/chat/annotate-source-anchor.test.ts` | `publicChat` | `buildAnnotatedSource`, `estimateSoftOffsetRange*`, `locateAnnotateOffsetRangeByQuoteContext`, `ANNOTATE_SOFT_RANGE_*` |
| `packages/core/test/chat/annotate-render-range-schema.test.ts` | `publicChat` | `annotateDraftSchema` |

这些名字全部落在 F-2 的 A/B 类（公开面），所以**没有造成新的误删风险**，但它们是
「L0 判死但测试真在用」的第二类证据。

**建议**：把「能解析成功的说明符上的 namespace 展开」也纳入 suspect 兜底，
或直接用 TS 编译器 API 取代正则（L0 自己在 `dead-exports.md:2517` 承认「不做 AST 语义分析」）。
**置信**：confirmed

---

### F-xc-dead-core-5 | P2 | `packages/core/src/service/kkv/index.ts:1-14` + `packages/core/src/service/session-run-state/index.ts:1-16`

```
/**
 * Internal KKV service factory — not part of the main `@novel-master/core` public API.
 * @remarks App runtimes use this subpath for `AppUiPreferences` wiring only.
 */
export { createKkvService } from "./create-kkv-service.js";
```

**描述**：这是**真死文件**（唯一两个「整文件可删」且文件本身零引用的实质候选），
但不是普通死代码——它们是**被 `public/` 取代的历史 barrel**，文档注释还写着「App runtimes use
this subpath」，而实际 `package.json:81` 的 `./kkv` 指向 `dist/public/kkv.js`。
`packages/core/tsconfig.test.json:26` 还残留 `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]`
映射，与 `package.json` 不一致。

**证据**：
- `service/kkv/index.ts` 全仓零 import（`tmp/w3c/filelive.mjs`，import + `export…from` + `export *` 三类边全查）；
  唯一残留引用是 `tsconfig.test.json:26` 的 paths 映射。
- `service/session-run-state/index.ts` 同理，`package.json:89` 指向 `dist/public/session-run-state.js`。
- 两文件的全部导出（5 + 5 个）都在 core 617 条确认死里，且都不在公开面（F-2 的 C 类）。

**建议**：删这两个文件 + 同步删 `tsconfig.test.json:26` 的 `@novel-master/core/kkv` 映射
（`:28` 的 session-run-state 映射指向 public，不受影响）。先确认无人依赖 test tsconfig 的旧路径。
**置信**：confirmed（文件级）/ suspected（tsconfig.test.json 是否有人用，需人工确认）

---

### F-xc-dead-core-6 | P3 | `packages/core/src/config-forms/shared/application-model-id.ts:6,21` vs `packages/core/src/domain/provider/logic/application-model-id.ts:10,29`

```
// config-forms/shared/application-model-id.ts
export function parseApplicationModelId(modelId: string): {
// domain/provider/logic/application-model-id.ts
export function parseApplicationModelId(modelId: string): {
```

**描述**：同名同签名的**双份实现**。`config-forms/shared/index.ts:3-6` 与
`domain/provider/logic/index` 各自转发一份；`public/provider.ts:14-15` 用的是 domain 那份。
`config-forms/shared/index.ts` 的 4 个转发（`formatApplicationModelId`、`matchDepth`、
`parseApplicationModelId`、`validateDepthSlice`）全部零消费 → 属 C 类可删，
但 `config-forms/shared/depth-slice.ts` 与 `duplicate-export-consistency.test.ts:8` 有身份断言耦合。

**建议**：`config-forms/shared/depth-slice.ts` 与 `application-model-id.ts` 疑似 `domain/` 的
迁移期双形态残留（`config-forms/shared/depth-slice.ts:2` 自述 "re-exported from core dist (lean module, no barrel)"）。
建议整体删除 `config-forms/shared/{depth-slice,application-model-id}.ts` + 改 `config-forms/shared/index.ts`，
但必须同步改 `duplicate-export-consistency.test.ts`（它断言 `cfShared.matchDepth === compaction.matchDepth`）。
**置信**：suspected（双份实现已确认，"迁移残留"是推测）

---

### F-xc-dead-core-7 | P3 | `packages/core/src/types/agnai-tokenizers.d.ts:1-18`（L0 suspect 行 1369-1370）

```
declare module "@agnai/sentencepiece-js" {
  export class SentencePieceProcessor {
```

**描述**：L0 把 `SentencePieceProcessor` / `Tokenizer` 标为 suspect，理由是「同名符号出现在
`@agnai/sentencepiece-js` / `@agnai/web-tokenizers` 等未解析说明符里」。**这是纯误报**：
core 里没有任何文件 import 这两个包；真正 import 的是 `packages/tokenizer-driver-node/src/impl/*`，
而 node 驱动**自带一份一模一样的 d.ts**（`packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts:1,11`）。

**证据**：
- `rg "@agnai/" packages apps scripts` → 只有 `tokenizer-driver-node/{src/impl/*,src/types/*,package.json}`、
  `packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:4`（注释）、README 命中；core 内零 import。
- core 的这份 d.ts 靠 `packages/core/tsconfig.json:12` 的 `"include": ["src/**/*"]` 被纳入编译，
  纯 ambient declaration，无运行时价值。
- 同文件第 8 行 `cleanText` 被 L0 判为**确认死**（第 1339 行），本机位复核一致。

**建议**：整文件删除 `packages/core/src/types/agnai-tokenizers.d.ts`（唯一零引用的 core 文件之一）。
删前需确认 core 编译不需要它——因为 core 内部无人 import `@agnai/*`，
**建议实跑一次 `tsc -p packages/core` 验证**。
**置信**：confirmed（零 import 已证）/ suspected（删后 tsc 是否仍过，需编译验证）

---

### F-xc-dead-core-8 | P3 | `packages/core/src/common/memoize.ts:117`

**描述**：40 条抽样里的第 11 条。整个文件只有 `memoize` 一个导出，**文件本身零 import**
（`memoize.ts` 在 `common/index.ts` 里没有转发，`rg -w memoize packages apps` 只命中文件自身与
`memoizeSingle`/`memoizeMulti` 两个私有 helper）。

**证据**：`tmp/w3c/v1.txt:11` 复核结果 `prod=[] test=[]`；`tmp/w3c/filelive2.txt:747` 确认零引用。
同批还有 3 个零引用文件：`domain/vfs/logic/infer-scope-from-path.ts`（唯一交叉引用是
`domain/vfs/logic/vfs-path-mapper.ts:187` 的**注释**提到它）、「`infra/kkv/logic/parse-kkv-json-document.ts`」。

**建议**：整文件删除。`memoize.ts:105-116` 有完整 JSDoc + `@example`，说明它是有意写的工具但从未接线。
**置信**：confirmed

---

## 可信删除清单（C 类：确认死 + 不在公开面 + 无生产消费）

> 完整机读版：`tmp/w3c/delete-list.md`（530 行，逐文件列出「摘 export / 删再导出行 / ⚠ barrel 泄漏 / 测试引用」）。
> 规模：**363 个符号 / 186 个文件**。其中运行时值导出 150 条、type-only 213 条。
> 动作分类：文件内自用=是 → 265 条（**只摘 `export` 关键字，最安全**）；
> 文件内自用=否 → 98 条（**整段删除**）；`kind=reexport` → 57 条（**删 barrel 转发行**）。

### 6.1 整文件可删（文件零引用 + 全部导出判死）— 最高优先级

| 文件 | 导出 | 备注 |
|---|---|---|
| `packages/core/src/common/memoize.ts` | `memoize` | 全文件（F-8） |
| `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | `InferredScope`, `inferScopeFromPhysicalPath` | 全文件；`vfs-path-mapper.ts:187` 只是注释提及 |
| `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | `parseKkvJsonDocument` | 全文件 |
| `packages/core/src/service/kkv/index.ts` | `createKkvService`, `KkvError`, `isKkvError`, `KkvErrorCode`, `KkvService` | 全文件；**连带删 `tsconfig.test.json:26` 的 `@novel-master/core/kkv` 映射**（F-5） |
| `packages/core/src/service/session-run-state/index.ts` | `createSessionRunStateService`, `SessionRunState`, `SessionRunStateService`, `SessionRunStateSettleInput`, `SessionRunStatus` | 全文件（F-5） |
| `packages/core/src/types/agnai-tokenizers.d.ts` | `cleanText` + ambient `SentencePieceProcessor`/`Tokenizer` | 建议整文件删；**删前跑 `tsc -p packages/core`**（F-7） |

### 6.2 部分可删（文件仍被引用，只能摘 export / 删符号）— 180 个文件

见 `tmp/w3c/delete-list.md`。三类需要额外小心的：

**(a) barrel 转出泄漏（21 个文件 / 44 条）**：文件本身零消费，但符号名被某个中间 barrel
（`infra/tokenizer/index.ts`、`infra/tdbc/index.ts`、`infra/cloud-sync/index.ts`、
`src/index.ts` 等）转发。摘 export 前必须同步删 barrel 里的那一行，否则 barrel 编译红。
完整 ⚠ 清单见 `tmp/w3c/delete-list.md` 中含 `⚠` 的 21 条。

**(b) 有测试引用的（122 个文件）**：测试直接 import 了这些符号。删符号的连带动作是删/改测试。
按 `tmp/w3c/delete-list.md` 每条的「测试引用」字段定位。测试密度最高的几个：
`domain/chat/model/message.ts`（+33 个测试文件）、`domain/chat/model/message-attachment.schema.ts`（+8）、
`errors/tool-errors.ts`（+10）。

**(c) 高杠杆单点摘除（摘完 export 后 L0 死表可清零的文件）**：
`bootstrap/vfs/vfs-revision-schema.ts`（5 条 DDL 全死，只剩 `VFS_REVISION_SCHEMA_STATEMENTS` 聚合导出在用）、
`config-forms/agent/agent-editor-state.ts`（6 条）、`domain/vfs/logic/diff-workspace-for-user-vfs-flush.ts`（5 条）、
`infra/cloud-sync/impl/cloud-sync-coordinator.ts`（7 条，含 4 个 `__reset*ForTests` 测试钩子）。

## 需人工裁决清单

### 7.1 A 类：快照锁定公开面 — 173 条 / 81 文件（**禁删**）

完整清单：`tmp/w3c/Alist.md`。要动必须：(1) 从 `public/**` barrel 摘掉 → (2) 更新对应
`snapshots/public-<sub>-allowlist.json` → (3) 确认无外部包消费。代表文件：

- `packages/core/src/errors/kkv-errors.ts`（`KkvErrorCode`）— `public/kkv.ts:14` + `src/index.ts:153` + `service/kkv/index.ts:13` 三处转发
- `packages/core/src/errors/agent-config-errors.ts`（`AgentConfigErrorCode`）— `public/agent.ts:51`
- `packages/core/src/infra/cloud-sync/index.ts`（15 条）— 整个 cloud-sync 公开面
- `packages/core/src/infra/tdbc/index.ts`（`ParsedTdbcUrl`, `TdbcErrorCode`）— 被 4 个 tdbc 驱动包 + sksp-android 消费
- `packages/core/src/infra/sql-template/index.ts`（10 条）
- `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts`（6 条）— 与 F-3 的 dist 盲区重叠
- `packages/core/src/infra/tokenizer/index.ts`（16 条 reexport）— 快照未覆盖但仍公开面，属「无快照的 A 类」

### 7.2 B 类：公开面无快照 — 81 条 / 37 文件（**需产品/架构判断**）

完整清单见 `tmp/w3c/stats.txt` 末段。这些符号在 `package.json exports` 展开面上但没被快照锁住，
删了不会立刻红测试，但会静默破坏外部消费者。分组：

- **错误码联合类型（14 条，最典型）**：`errors/{config-decode,preferences,skill,tool,tdbc,nmtp}-errors.ts`
  的 `*ErrorCode`、`errors/kkv-errors.ts::KkvErrorCode`、`infra/cloud-sync/errors::CloudSyncErrorCode`、
  `infra/db-backup/index.ts::ProviderTableSnapshotErrorCode`。
  这些是 `ErrorCode` 判别联合的一环，单独摘掉会让 `instanceof`/code 分支在外部编译不过。
- **配置域常量（17 条）**：`domain/tool/builtin/vfs-tools.ts`（4 条 `*_TOOL_NAMES` / `isMutatingVfsToolName`）、
  `infra/sql-template/index.ts`（10 条）、`domain/skills/**`（6 条类型）。
  `main-entry-allowlist.json:21-22` 已锁了 `MUTATING_VFS_TOOL_NAMES`，同组的
  `FILE_OPEN_TOOL_NAMES` / `FileToolName` / `isMutatingVfsToolName` 未锁 —— 快照覆盖不完整是独立问题。
- **疑似迁移双形态（4 条）**：`config-forms/shared/application-model-id.ts`（2）、
  `config-forms/shared/depth-slice.ts`（2）— 见 F-6。
- **接口形态类型（12 条）**：`domain/tool/builtin/builtin-tool-context.ts`（`VfsToolContext`, `ToolResourceQuota`）、
  `domain/format/**`（4 条）、`infra/db-maintenance/index.ts`（6 条）等。

### 7.3 仅测试消费组 — 需先修 L0 再重跑

core 356 条里 **127 条是桶污染**（F-1），修桶后剩 229 条才是真「仅测试」。
其中 143 条落在 A 类（快照锁定）、56 条 B 类、**157 条 C 类**可按 6.2 处理。
**结论：这张表现在不能直接用于删除决策，必须先修 `dead-exports.mjs:197` 再重跑。**

## 争议与存疑

1. **快照只锁运行时值导出，type-only 完全没覆盖**。`collectNamedExports` 用 `Object.keys(mod)`
   （`helpers/export-snapshot.ts:2-5`），type/interface 在编译后不存在于运行时。
   这意味着 **A-type 99 条删了不会让任何测试变红**。我按「仍是公开 `.d.ts` 契约面」保守判为禁删，
   但如果项目实际没有外部 TS 消费者，这 99 条是可删的。**需要用户拍板：core 是否有仓外消费者？**
2. **`infra/tokenizer/index.ts` 的 16 条 reexport 不在任何快照里**。它们既不在
   `public-provider-allowlist.json` 也不在 `main-entry-allowlist.json`，但确实在公开面上。
   是快照过期还是走了第三个入口，**未查清**。
3. **我复核器的口径与 L0 略有差异**：我用 `export *` 边做名字穿透（L0 也做），
   但我还额外查了 namespace 展开（F-4）。若 L0 后续也纳入 namespace，
   core 617 条「确认死」里可能还有 **0～16 条**（`infra/tokenizer/index.ts` 那批）要再降级。
   我未把这批计入假阳性率，因为它们已被公开面分层拦下。
4. **未验证**：我没有实跑 `tsc` / `npm test` 验证任何删除动作的安全性——
   本机位是只读纪律（PLAN.md §5）。F-5 / F-7 的删除建议需要编译验证才能落地。
5. **apps 侧（700 条确认死 + 24 suspect + 224 仅测试）本机位未覆盖**，
   `apps/mobile/test-utils/**` 被 L0 当生产文件统计的问题（`dead-exports.md:2521` 自述）
   在那边影响更大，需 apps 侧机位专门核实。