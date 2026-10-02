---
zone: synth-dead
agent: W5 reduce（死码/死导出归并）
files_scanned: |
  输入 3 份：raw/w3-xc-dead-core.md（core 617 确认死 + 2 suspect + 356 仅测试）、raw/w3-xc-dead-apps.md（apps 700 零消费 + 224 仅测试 + periph 补扫 178 导出）、L0/dead-exports.md（1317/26/580 三桶）。
  机读复核：tmp/w3c/tierC.json（363/173/81/157 四分层）、tmp/w3c/delete-list.md（530 行机读删除清单）、tmp/w3c/Alist.md（A 类 173 条禁删面）、tmp/w3c/stats.txt。
  本机位独立复算：行数量级（19 个 apps 死文件 + 6 个 core 死文件逐个 wc）、动作分档互斥性（257/57/49）、re-export 块行数（115 行）、5 条抽样反查（service/kkv/index.ts、ListBatchBar、fix-settings-utf8.mjs、cli/vfs/runtime.ts、subagent-tool-session-id.ts、common/index.ts 非主入口）。
---

# 全仓统一删除 backlog（死码 · 死导出 · 死文件）

## 摘要

L0 的三张死表**不能直接当删除清单用**——它把「文件死」和「导出死」混在一起，把「生产侧经 barrel 转发消费」误判成「仅测试消费」，
还完全看不见 `Object.keys(mod)` 快照锁和 jest `moduleNameMapper` 这两类消费。归并两份 raw 后，全仓**可信可删 = 387 条**：

- **core C 类 363 条 / 186 文件**（不在公开面 + 无生产消费 + 无快照锁），实测净减 **≈ 548 行**；
- **apps / periph 真死 24 条**（17 个整文件 + 4 条级联 IPC + 3 条 core 侧并入项），实测净减 **≈ 2 239 行**。

两表合计 **≈ 2 886 行**（区间 2.6k–3.0k；「只摘 export」类 255 条物理行删除为 0，只算导出面收窄、不计入行数）。
按风险切 3 批，**批次 1（16 条 / 2 252 行）零连带可先跑**，批次 3 里含快照锁定面与 IPC 级联，须先过人工裁决。

## 职责与边界

- **职责**：把 core 侧（363 条 C 类）与 apps/periph 侧（24 条真死）核实结果**并成一张可执行清单**，去重、对齐口径、标前置条件、给批次建议与行数预估。
- **输入边界**：只吃 `raw/w3-xc-dead-core.md`、`raw/w3-xc-dead-apps.md`、`L0/dead-exports.md`。不引入其它机位的 raw（防对抗污染）。
- **不做**：不改任何生产代码（只读纪律，PLAN §5）；不替 `xc-ipc` 裁决 IPC 通道语义；不替 `xc-core-*` 裁决 core 业务逻辑；不拍板「core 是否有仓外消费者」。

## 对外接口

| 出口 | 位置 | 消费方 |
|---|---|---|
| 机读全量清单 | `tmp/w3c/tierC.json` → `.confirmed[]`（363 条 `{file,name,kind,extra}`） | code-dev-loop 直接读，不必解析本文 markdown |
| 人读清单 | `tmp/w3c/delete-list.md`（530 行，逐文件列「摘 export / 删再导出行 / ⚠ barrel 泄漏 / 测试引用」） | 人工复核、逐文件施工 |
| A 类禁删面 | `tmp/w3c/Alist.md`（173 条 / 81 文件，快照锁定） | 批次 3 的禁区清单 |
| B 类待裁决面 | `tmp/w3c/stats.txt` 末段（81 条 / 37 文件） | 需人工裁决章节 |
| periph 补扫 | 本机位 12 包 / 90 文件 / 178 导出 / 零引用 8 条 | `L0/coverage-matrix.md` 需补登记 |

## 数据访问

本机位不触碰数据层，但两处删除前置条件会牵出数据面：

- `packages/core/test/package-exports/snapshots/*.json` 共 **13 份、551 个去重名字**被
  `public-subpath-allowlist.test.ts:20-32` 用 `collectNamedExports`（= `Object.keys(mod)`，
  实现见 `helpers/export-snapshot.ts:2-5`）逐字 `deepEqual`。core 617 条「确认死」里 **173 条**落在这个面上。
- `packages/core/src/domain/tool/builtin/vfs-tools.ts:69` 的 `FILE_OPEN_TOOL_NAMES` 已写进
  `snapshots/main-entry-allowlist.json:12`，删它必须同步改快照，或改成单源化。
- `apps/mobile/test-utils/core-shim.ts:13-97` 用 `packages/core/dist/**` 相对路径再导出 59 个名字，
  而 **`packages/core/dist` 当前不存在**——mobile 单测若删掉某 core 符号，报错会是「解析到不存在的 dist 文件」而不是干净的断言失败。

## 依赖关系

```
L0/dead-exports.md  (1317/26/580 三桶，桶定义有缺陷)
   ├── w3-xc-dead-core  → 617 确认死 → 分层 A173 / B81 / C363
   └── w3-xc-dead-apps  → 700 零消费 → 整文件死 20 / 假阳性 11 / 只去 export …
                              ↓
                    本 backlog 387 条 / 3 批次
                              ↓
              ┌───────────────┴───────────────┐
        code-dev-loop 消费              xc-ipc / xc-core-* 对齐
```

**跨机位依赖**（本清单不单方面裁决）：

- IPC 通道摘除（MESSAGES_HIDE/SHOW/DELETE、MESSAGES_HIDE_RANGE/SHOW_RANGE、SHELL_MENU_POPUP、MESSAGES_TRUNCATE_AFTER）
  须与 `raw/w3-xc-ipc.md` 对齐；main 侧 `bindReq` 仍活着，摘哪一层是 IPC 机位的口径。
- `AgentSession.hideRange` 4 处声明须与 `synth/core-runtime.md` 去重。
- `FILE_OPEN_TOOL_NAMES` 单源化 vs 删公开副本，须与 `synth/core-misc.md` 对齐。

---

## 发现清单

### F-synth-dead-1 | P1 | L0 桶定义缺陷：`testOnly` 未排除 `relayed`

**位置**：`tmp/l0census/dead-exports.mjs:197`

```
const testOnly = rows.filter((r) => r.prod === 0 && r.test > 0);
```

**描述**：`relayed` 是「经 barrel `export {} from` 传递消费」这条边（`dead-exports.mjs:150-157`）。
生产侧从 `public/xxx.ts` 导入、`public/xxx.ts` 再从源文件转发时，这条边的终点记成 `R:<re-export>` 而不是 `P:<importer>`，
于是「生产侧经 barrel 消费 + 测试侧直接 import」的符号 `prod` 数组是空的，被误判进「仅测试消费」桶。

**核实**：core 356 行全量复核，**127 行（35.7%）实际有生产消费方**，且 127/127 全是 barrel 转发路径
（直接 import 的漏判 = 0）。代表：

| 符号 | L0 分桶 | 实际生产消费方 |
|---|---|---|
| `common/format-token-count.ts :: formatContextUsageLabel` | 仅测试 | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:34`、`apps/mobile/src/services/chat-prompt-tokens.service.ts:33` |
| `errors/chat-errors.ts :: ChatError` | 仅测试 | `apps/cli/src/cli-errors.ts:13`、`apps/mobile/src/errors/format-error.ts:8` |
| `infra/cloud-sync/impl/cloud-sync-coordinator.ts :: CloudSyncCoordinator` | 仅测试 | `apps/desktop/src/main/services/cloud-sync.service.ts:12`、`apps/mobile/src/services/cloud-sync.service.ts:7` |
| `service/agent/create-agent-abort-registry.ts :: createAgentAbortRegistry` | 仅测试 | `create-desktop-runtime.ts:8`、`create-mobile-runtime.ts:8` |

**修正**：`testOnly` 改为 `r.prod === 0 && r.relayed === 0 && r.test > 0`。修完 core 真「仅测试」= 356 − 127 = **229 条**。
**落地动作**：**在消费 L0「仅测试」表之前必须先改这一行并重跑**，否则该表 35.7% 的行会被当成可删。
**置信**：confirmed（127/127 逐条追到 file:line）

---

### F-synth-dead-2 | P1 | 快照锁定面：core「确认死」里 173 条直接删会红测试

**位置**：`packages/core/test/package-exports/public-subpath-allowlist.test.ts:20-32` + `helpers/export-snapshot.ts:2-5`

**描述**：`Object.keys(mod)` 逐字比对 JSON 快照，L0 的「import 说明符」口径**看不见这种消费**。分层实测：

| 层 | core 确认死 617 中 | 文件数 | 含义 | 处置 |
|---|---|---|---|---|
| A 快照锁定 public 面 | **173（28.0%）** | 81 | 删了快照测试必红 | **禁删**（`tmp/w3c/Alist.md`） |
| B 公开面无快照 | **81（13.1%）** | 37 | 删了不立刻红，但静默破坏外部消费者 | **需人工裁决**（`tmp/w3c/stats.txt` 末段） |
| C 不在公开面 | **363（58.8%）** | 186 | 可信可删 | 进 backlog |

A 类细分（快照用 `Object.keys`，**只锁运行时值导出，type-only 测不到**）：**A-value 74 条**删了必红；
**A-type 99 条**删了不会让任何测试变红，但仍在公开 `.d.ts` 契约面上（`KkvErrorCode`、`UserVfsTurnView`、`TailBatchMode`…），
按保守口径仍判禁删。

**落地动作**：任何触及 A 类文件名的删除，先走「① 从 `public/**` barrel 摘掉 → ② 更新对应 `snapshots/public-<sub>-allowlist.json`
→ ③ 确认无仓外消费者」三步，不允许直接删。
**置信**：confirmed

---

### F-synth-dead-3 | P2 | `apps/mobile/test-utils/**` 被 L0 当生产文件，72 条误判

**位置**：`apps/mobile/jest.config.js:37,45,47,48,58`

```
'^@novel-master/core$': '<rootDir>/test-utils/core-shim.ts'
```

**描述**：L0 把 `apps/mobile/test-utils/**` 按「非 test/ 目录」口径算作生产文件（`dead-exports.md:2521` 已自述），
但这些文件是 jest `moduleNameMapper` 的**注入目标**，共 **5 文件 / 72 条**导出零消费：`core-shim.ts` 59 条、
`notifee-mock.ts` 7 条、`react-native-reanimated-mock.tsx` 3 条、`react-native-blob-util-mock.ts` 2 条、
`op-sqlite-mock.ts` 1 条。

**附带盲区**：`core-shim.ts` 用 `packages/core/dist/**` 相对路径再导出，而 dist 目录**当前不存在**，
`resolveSpecifier` 对这些说明符 100% 解析失败。把它映射回 src 后与三张表求交：「确认死」命中 **6 条**
（全在 `domain/chat/logic/user-vfs-turn-view.ts`，且名字已在 `public-chat-allowlist.json:15,59,78` 里，与 F-2 的 A 类重叠）。
**落地动作**：`dead-exports.mjs` 的 `candidatesFromAbs` 加一条 `packages/core/dist/X.js → packages/core/src/X.ts` 映射；
判读任何 apps 行前先排除 `test-utils/`。
**置信**：confirmed

---

### F-synth-dead-4 | P2 | apps 侧「全部导出都死」≠「文件死」：194 → 20

**描述**：L0 表里 174 个文件级条目是「导出死」不是「文件死」。成因按可复核的解析器缺项分布：

1. **只被文件内部使用**（最大一类）：`apps/desktop/shared/ipc-types.ts` 22 条 DTO（1741 行活文件）、
   `src/main/shell-menu.ts::buildApplicationMenu`、`src/main/ipc/forward-agent-activity.ts::detachAgentActivityForwarder`。
2. **别名重导出**：`handler-registry.ts:223 registerHandlersFromRegistry` ← `register-handlers.ts:4` 改名为 `registerIpcHandlers`。
3. **动态 `import()`**：`update-check.service.ts::runUpdateCheck` ← `ipc/handlers/app-info.ts:26 await Promise.all([…, import(…)])`。
4. **tsconfig/babel 路径别名**：`@shared/logic/*`、`@/`、`@web/*`（人工 grep 极易误判 `apps/desktop/shared/logic/*.ts`）。
5. **构建入口**：`apps/mobile/scripts/build-webview.mjs` 的 4 个 `entryRel` + 3 个 `loadWebModule` 目标
   （`bootTranscript`、`MERMAID_FULLSCREEN_CSS`、rich-content-styles 3 条）。
6. **默认导出钩子**：`apps/desktop/scripts/after-pack.mjs:14 afterPack`（electron-builder 钩子，且有测试）。

**落地动作（判读规则，写进 backlog 每一条的判读前置）**：
**L0 表的每一行必须先判文件可达性，再判符号**；文件可达但符号外部零消费 → 动作是「摘 export」，不是「删」。
**置信**：confirmed

---

### F-synth-dead-5 | P2 | `namespace import` 盲区：21 处 import 中 5 处真消费 core

**描述**：L0 自述「不做 AST 语义分析」，`import * as ns` + `ns.X` 展开会判成零消费，兜底只覆盖「同名符号出现在**解析失败的**说明符」。
但能解析成功的说明符上的 namespace 展开**既不判死也不标 suspect**，安静地留在死表里：

| 文件 | namespace | 消费的名字 |
|---|---|---|
| `packages/core/test/package-exports/duplicate-export-consistency.test.ts:3,4,8,9` | `cfShared` / `compaction` | `matchDepth`, `validateDepthSlice` |
| `packages/core/test/infra/tokenizer/token-counter-mode-no-public-path.test.ts` | `provider` | `parseTokenCounterModePref`, `isValidTokenCounterModePref`, `TOKEN_COUNTER_MODE_PREF_KEY` |
| `packages/core/test/chat/annotate-source-anchor.test.ts` | `publicChat` | `buildAnnotatedSource`, `estimateSoftOffsetRange*`, `locateAnnotateOffsetRangeByQuoteContext`, `ANNOTATE_SOFT_RANGE_*` |
| `packages/core/test/chat/annotate-render-range-schema.test.ts` | `publicChat` | `annotateDraftSchema` |

**核实**：这些名字全部落在 F-2 的 A/B 类，**本轮不造成新的误删风险**，但它们证明「L0 判死 ≠ 测试没用」。
**落地动作**：批次 3 施工时，凡删除动作命中上表任一名字，一律先读对应测试文件。
**置信**：confirmed

---

### F-synth-dead-6 | P3 | 口径修正：C 类动作分档是**互斥**的，raw 报告里的 265/98/57 是重叠计数

**核实**（本机位对 `tierC.json.confirmed[]` 重算，按 `extra` 列（`是（仅内部用，export 冗余）`=265 / `否`=98）
与 `kind==='reexport'`（57）交叉统计，并先把 6 个整文件单独拆出）。实际**互斥**分档是：

| 动作 | 条数 | 文件数 | 物理行删除 | 说明 |
|---|---|---|---|---|
| 只摘 `export` 关键字 | **255** | 156 | 0 | 符号在定义文件内活着，最安全 |
| 删 barrel 转发行 | **53** | 16 | ≈112 行 | `kind=reexport`，实测 `export {}` 块行数 |
| 整段删除符号本体 | **40** | 30 | ≈166 净行 | 实测符号声明行跨度 209 行 − 整文件内重叠 43 行 |
| 整文件删除 | **15**（6 文件） | 6 | 270 行 | 文件零引用 + 全部导出判死 |

255 + 53 + 40 + 15 = 363 ✅
（raw 报告写的 265/98/57 里，10 条 reexport 同时带 `extra=是`、9 条同时带 `extra=否`，故三档加起来 420 ≠ 363。）

**落地动作**：code-dev-loop 分波次时用互斥口径（**255 / 53 / 40 / 15**），不要用 265/98/57。
**置信**：confirmed（本机位对 363 条全量重算，非抽样）

---

## 统一删除 backlog（387 条 · 3 批次）

> **消费方式**：批次 1/2 直接照表施工；批次 3 先读「需人工裁决」章节再决定动哪几条。
> **机读源**：批次 3 的 363 条见附录 A（本文末尾）或 `tmp/w3c/tierC.json` → `.confirmed[]`。
> **行数为实测**（逐文件 `wc` / `export {}` 块行数扫描），非估算。

### 批次 1 · 零连带，删文件即净减（16 条 / 实测 2 252 行）

**前置**：无。全部零 importer、零内部自用、零测试、零快照面。跑完 `tsc -p` 对应包 + 目标测试即收。
⚠ 口径提示：**D-113 ~ D-116 的符号已计入 core C 类 363 条**（见附录 A），此处只按「整文件/整段」动作先行施工，不重复计数。

| ID | 文件 | 行 | 连带测试 | 前置条件 |
|---|---|---|---|---|
| D-101 | `apps/desktop/scripts/fix-settings-utf8.mjs` | **548** | 无 | 无。**顺带消除未接线地雷**：跑一次会从固定 commit `d825173` 覆写工作区，当前树上会 ENOENT 崩 |
| D-102 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176` | **1048** | 无直接测试 | ⚠ 见争议 #5：apm memory 三处 hint 文案同步（**只改文档，不改代码**，可放 B1） |
| D-103 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:7,30` | 67 | 无 | 无。本机位已复核零 importer |
| D-104 | `apps/mobile/src/components/batch/ListBatchBar.tsx:15` | 57 | 无 | 无。本机位已复核零引用；批量操作已由 `ManageHeader.tsx` 承担 |
| D-105 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:12,42` | 55 | 无 | 无。**连带效应见 D-301**（`ipcMessagesHide/Show/Delete` 失去唯一调用点） |
| D-106 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | 50 | 无 | 与 D-107 同批；删后 `shared/logic/chat.ts` 的 tail-batch 导出将只剩测试消费 → **复查项**（争议 #4） |
| D-107 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:12` | 48 | 无 | 同 D-106 |
| D-108 | `apps/desktop/renderer/layout/AppMenuBar.tsx:14` | 41 | 无 | 无。**连带效应见 D-303**（`SHELL_MENU_POPUP` 全链死） |
| D-109 | `apps/cli/src/vfs/errors.ts:4,7,20` | 29 | 无 | 无。CLI 错误口径已由 `apps/cli/src/cli-errors.ts` 承担，**不要顺手删 `cli-errors.ts`** |
| D-110 | `apps/cli/src/vfs/runtime.ts:13,18` | 25 | 无 | 无。本机位已复核 `createVfsRuntime` 全仓零 importer |
| D-111 | `apps/mobile/src/hooks/useStreamTailGenerating.ts:8` | 13 | 无 | 与 D-112 同批（双端同名重复） |
| D-112 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts:8` | 11 | 无 | 同 D-111。实现是 `uiRunning` 的恒等包装 |
| D-113 | `packages/core/src/common/memoize.ts` | 124 | 无 | 整文件。全文件零引用，`common/index.ts` 未转发；105-116 有完整 JSDoc 但从未接线 |
| D-114 | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | 75 | 无 | 整文件。唯一交叉引用是 `vfs-path-mapper.ts:187` 的**注释**提及 → 顺手删注释 |
| D-115 | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | 22 | 无 | 整文件 |
| D-116 | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts:33` | 39 | `resolveSubagentSessionId` 有 1 处测试 | 删 `isTaskToolUse`（零引用，连测试都没有）+ `resolveSubagentSessionId`（本机位已复核 src 内零引用）；**保留文件里其余类型** |

### 批次 2 · 有测试 / 有配置连带（9 条 / 实测 248 行）

**前置**：必须**同批处理测试**，不允许先删文件后补测试（`jest.mock` 对不存在的模块会抛 `Cannot find module`）。

| ID | 文件 | 行 | 连带测试 | 前置条件 |
|---|---|---|---|---|
| D-201 | `apps/mobile/src/services/session-messages-loader.ts:15,23` | 39 | ⚠ **6 个测试的 `jest.mock`** | **必须先摘 6 处 `jest.mock`**：`chat-tab-screen.integration.test.tsx:209`（`:421` 注释明写「该 loader 的 hook 消费方已退役」）、`chat-tab-screen-legacy-scroll.test.tsx:157`、`composer-fullscreen.test.tsx:231`、`use-chat-tab-message-actions-rollback.test.ts:37`、`-set-floor.test.ts:23`、`-token-peak.test.ts:32` |
| D-202 | `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts` | 49 | `apps/desktop/test/preview-annotate-source-anchor.test.ts:26,48` | 同批删/改测试 |
| D-203 | `apps/mobile/src/components/chat/flush-run-ui.ts:1` | 41 | `apps/mobile/__tests__/flush-run-ui.test.ts` | 删 mobile 半边 + 测试。**desktop 半边保留**（被 `conversation-abort-retain.ts:7` import） |
| D-204 | `apps/mobile/src/components/chat/tool-turn-actions.ts:10,34` | 48 | `apps/mobile/__tests__/tool-turn-actions.test.ts`（4 个 it） | 删文件 + 测试。desktop 半边在 D-105 |
| D-205 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts` | 17 | `apps/mobile/__tests__/stream-tail-html-state.test.ts` | 同批删测试 |
| D-206 | `apps/mobile/src/vfs/errors.ts` | 5 | `apps/mobile/__tests__/errors.test.ts` | 同批删测试 |
| D-207 | `packages/core/src/service/kkv/index.ts` | 14 | 无 | 整文件。⚠ **连带删 `packages/core/tsconfig.test.json:26` 的 `"@novel-master/core/kkv": ["./src/service/kkv/index.ts"]` 映射**（与 `package.json:81` 指向 `dist/public/kkv.js` 不一致）。本机位已复核：该文件零 importer，所有消费都走 `create-kkv-service.js` / `kkv.port.js` 直连 |
| D-208 | `packages/core/src/service/session-run-state/index.ts` | 16 | 无 | 整文件。`package.json:89` 指向 `dist/public/session-run-state.js`；`tsconfig.test.json:28` 的映射指向 public，不受影响 |
| D-209 | `packages/core/src/types/agnai-tokenizers.d.ts` | 19 | 无 | 整文件。删前**必跑 `tsc -p packages/core`**：它是 ambient declaration，靠 `tsconfig.json:12` 的 `include: ["src/**/*"]` 进编译。已复核 core 内零 `@agnai/*` import（真使用者是 `packages/tokenizer-driver-node`，自带一份同名 d.ts） |

### 批次 3 · 需先过裁决 / 需 barrel 同步（core 剩余 348 条符号级 + 17 条级联 / 实测 ≈386 行）

#### 3.1 core 符号级 363 条（附录 A / `tmp/w3c/tierC.json` → `.confirmed[]`）

> 下列 363 条中，**15 条（6 个整文件）已在批次 1/2 先行施工**（D-113/D-114/D-115/D-207/D-208/D-209），
> 此处 **348 条**是剩余量：255 摘 export + 53 转发行 + 40 整段。

| 动作 | 条数 | 行 | 批次内子批 | 前置条件 |
|---|---|---|---|---|
| **只摘 `export` 关键字** | **255** | 0 | B3-a | 无（符号在定义文件内活着）。**最高杠杆文件**：`infra/tokenizer/index.ts`(13)、`domain/tool/builtin/curl-tool.ts`(8)、`domain/tool/logic/format-tool-output.ts`(8)、`infra/tdbc/index.ts`(8)、`service/session-kkv/index.ts`(8)、`domain/tool/builtin/skill-tool.ts`(7)、`infra/cloud-sync/impl/cloud-sync-coordinator.ts`(7，含 4 个 `__reset*ForTests`)、`infra/sksp/index.ts`(7) |
| **删 barrel 转发行** | **53** | ≈112 | B3-b | ⚠ 摘 export 前**必须同步删中间 barrel 里的那一行**，否则 barrel 编译红。`tmp/w3c/delete-list.md` 中含 `⚠` 的 21 条是 barrel 泄漏，**必须逐个核对**。高杠杆：`infra/tokenizer/index.ts`(35 行 export 块 ⚠见争议 #6)、`service/session-kkv/index.ts`(10)、`infra/tdbc/index.ts`(9)、`config-forms/agent/index.ts`(8)、`infra/sksp/index.ts`(8)、`bootstrap/schema-migrations/index.ts`(6)、`domain/prompt/logic/message-body.ts`(6)、`infra/nmtp/index.ts`(6)、`config-forms/shared/index.ts`(5) |
| **整段删除符号本体** | **40** | ≈166 | B3-c | 30 个文件。最大单体：`domain/chat/logic/diff-workspace-for-user-vfs-flush.ts::collectUserOpsChangedPaths`(25)、`domain/chat/model/message-attachment.schema.ts::MessageAttachments`(23)、`bootstrap/schema-migrations/schema-migrations-table.ts::isSchemaMigrationApplied`(12)、`config-forms/agent/agent-editor-state.ts::toolsFromDefinition`(7)、`domain/vfs/logic/vfs-zip-path.ts` 2 条(7+3)、`domain/provider/logic/builtin-providers.ts::builtinProtocolByProviderId`(8)。**已复核可安全删**：`infra/tokenizer/logic/read-token-counter-mode-pref.ts::TOKEN_COUNTER_MODE_PREF_KEY`（同文件 `isValidTokenCounterModePref`/`parseTokenCounterModePref` 只用 `VALID_FAMILIES`，不引用它；同行 25 行 span 是本机位测量的上界，实际只删 1 行） |

**连带测试密度最高的文件**（`tmp/w3c/delete-list.md` 的「测试引用」字段定位）：
`domain/chat/model/message.ts`(+33 个测试文件)、`errors/tool-errors.ts`(+10)、`domain/chat/model/message-attachment.schema.ts`(+8)、
`config-forms/agent/agent-editor-state.ts`(6 条 + 2 测试)、`bootstrap/schema-migrations/index.ts`(7 个测试)。

#### 3.2 apps / core 侧级联与去 export（17 条 / ≈108 行 + 去 export 0 行）

| ID | 位置 | 行 | 前置条件 |
|---|---|---|---|
| D-301 | `IPC_CHANNELS.MESSAGES_HIDE`/`MESSAGES_SHOW`/`MESSAGES_DELETE` + `invoke-registry.ts:360-380` + `client.ts:90` + `main/ipc/handler-registry.ts` 的 `bindReq` | ≈15 | D-105/D-204 落地后 renderer 零调用。**须与 `raw/w3-xc-ipc.md` 对齐**再摘 main 侧 handler |
| D-302 | `MESSAGES_HIDE_RANGE`/`MESSAGES_SHOW_RANGE` 通道 + `invoke-registry.ts:371,375` + `handler-registry.ts:303-304` + `shared/ipc-types.ts:90-91` 常量 | ≈8 | **已注册未接线**（全仓无组件调用）。与 D-314 同一能力的两端，须同批 |
| D-303 | `IPC_CHANNELS.SHELL_MENU_POPUP` + `handler-registry.ts:476 bindEventReq` + `ipc-types.ts:199` | ≈4 | D-108 落地后全链死。⚠ **先核实 `SHELL_SET_TITLEBAR_THEME` 是否另有消费方**，别同删 |
| D-304 | `MESSAGES_TRUNCATE_AFTER` 通道 + `shared/logic/chat.ts` 的 tail-batch 导出 | ≈5 | 须与 `xc-ipc` 对齐；D-106/D-107 后 renderer 零入口，需确认 tail 批量 UI 已下线 |
| D-305 | `apps/desktop/shared/ipc-types.ts` 22 条 DTO | 0 | 只摘 export（1741 行活文件，DTO 被同文件 IPC 泛型/通道表引用） |
| D-306 | `src/main/shell-menu.ts:28 buildApplicationMenu` | 0 | 只摘 export（`:94 Menu.setApplicationMenu()` 自用） |
| D-307 | `src/main/ipc/forward-agent-activity.ts:37 detachAgentActivityForwarder` | 0 | 只摘 export（`:31,:33` 自用；`main.ts` 用的是本地同名变量） |
| D-308 | 双端 `src/main/update-check/app-meta.ts` 的 `githubReleasesUrl`/`licenseUrl`/`githubRepoUrl` + 双端 `update-check/types.ts:1 UpdateCheckStatus` | 0 | 只摘 export 或删函数。⚠ **`GITHUB_REPO`/`githubRepoUrl` 在文件内解构自用 → 只摘 export**；真正活着的是 `githubLatestReleaseApiUrl` 与 `resolveLatestRelease` |
| D-309 | `renderer/hooks/useAgentStream.ts` 的 `UseAgentStreamOptions`/`UseAgentStreamResult` | 0 | 只摘 export。⚠ 文件本体**活**，`docs/apm/RULE.md`「子会话写入刷新」条目拿它当守卫 |
| D-310 | `src/main/services/agent-yaml.service.ts` 的 `decode/encodeAgentYamlText` | 0 | 只摘 export。文件被 `ipc/handlers/agent-registry.ts:26` import，是活的 |
| D-311 | `src/main/update-check/resolve-latest-release.ts:20 resolveLatestReleaseFromList` | 0 | ⚠ **需用户拍板**：spec `docs/Iterations/about-and-update-check/spec.md:187` 明写「预留」→ 见争议 #2 |
| D-312 | `apps/cli/src/cli-errors.ts` 的 `EXIT_RUNTIME` + `apps/cli/src/vfs/parse-args.ts` 的 `ParsedCliArgs` | 0 | 只摘 export。⚠ **两文件都有活跃 importer**（`parse-args.ts` 有 30 个），不得删文件 |
| D-313 | periph 8 条零引用导出：`tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:125,143`、`sentencepiece-token-counter.ts:35`、`encoding-cache.ts:66`、`llm-sse-native/src/transport.ts:77`、`sksp-android/src/native.ts:9`、`tdbc-driver-op-sqlite/src/adapter.ts:8`、`tdbc-driver-rn/src/adapter.ts:8` | 0 | 逐个确认不在 `package.json exports` 对外契约面。⚠ `tdbc-driver-*` 的 `*Rows` 属 `docs/apm/RULE.md`「quick-sqlite 旧驱动保留作回滚线」范围，**动前须确认 rollback 线还挂不挂这两个包** |
| D-314 | `packages/core/src/domain/agent/session/agent-session.port.ts:52` + `service/agent/impl/chat-agent-session.ts:53` + `ephemeral-overlay-agent-session.ts:71` + `in-memory-agent-session.ts:60` 的 `hideRange` | ≈12 | ⚠ **勿伤活的 `MessageService.hideRange`**（`message.service.ts:389`，被 `message-transcript-effects.service.ts:51,125,151` + `apps/cli/src/message/commands.ts:174` 调用）。与 D-302 同批；**须与 `synth/core-runtime.md` 去重** |
| D-315 | `packages/core/src/domain/tool/builtin/vfs-tools.ts:69` + `src/index.ts:195` 的 `FILE_OPEN_TOOL_NAMES` 重复副本 | ≈4 | ⚠ **快照门槛**：`main-entry-allowlist.json:12` 已锁。**口径是单源化不是删除**——让 `domain/tool/logic/vfs-tool-file-path.ts:10` 引公开版。须与 `synth/core-misc.md` 对齐 |
| D-316 | `packages/core/src/config-forms/shared/{depth-slice,application-model-id}.ts` + 改 `config-forms/shared/index.ts` | ≈60 | ⚠ **双份实现已确认，"迁移残留"是推测**。必须同步改 `duplicate-export-consistency.test.ts:8`（它断言 `cfShared.matchDepth === compaction.matchDepth`）。见争议 #3 |
| D-317 | `packages/core/src/service/kkv/index.ts` + `service/session-run-state/index.ts` 的 barrel 交叉 | 0 | 已并入 D-207/D-208，此处仅登记，避免与 `synth/core-runtime.md` 重复施工 |

---

## 需人工裁决（不进代码-dev-loop 自动波次）

| # | 议题 | 事实 | 影响面 | 裁决人 |
|---|---|---|---|---|
| **1** | **快照锁定面（A 类 173 条）** | `Object.keys(mod)` 只锁**运行时值导出**；A-type 99 条（`KkvErrorCode`、`UserVfsTurnView`、`TailBatchMode`…）删了**不会让任何测试变红**，但仍在公开 `.d.ts` 契约面上 | 99 条 type + 74 条 value 的去留 | **需用户拍板：core 是否有仓外 TS 消费者？** 有 → 全禁删；无 → A-type 99 条可进批次 3 |
| **2** | **「intentional 预留」判定** | `resolve-latest-release.ts:20 resolveLatestReleaseFromList` 被 `docs/Iterations/about-and-update-check/spec.md:187` 明写「预留：导出 … 供未来分端 workflow 替换实现」；`AgentSession.hideRange` 在 `ephemeral-overlay-agent-session.ts:50-52` 有注释「overlay compaction 若要实现，在 ephemeral overlay 上实现 `hideRange`」 | D-311、D-314 两条 | 按 PLAN §3「RULE/迭代文档写明是故意设计的标 intentional」，**本机位不自行判死**。倾向删，但须用户定 |
| **3** | **迁移双形态：barrel 转发存疑** | `config-forms/shared/{depth-slice,application-model-id}.ts` 的 `parseApplicationModelId` 与 `domain/provider/logic/application-model-id.ts` **同名同签名双份实现**；前者自述 "re-exported from core dist (lean module, no barrel)"。而 `config-forms/shared/index.ts` 的 4 个转发零消费（C 类），定义本身却在 B 类 | D-316，约 60 行 | 需读 `git log` 确认是迁移残留还是刻意双形态 |
| **4** | **删 B-03/B-04 后 `shared/logic/chat.ts` 的连锁** | 该文件有 14 个 renderer 消费方（`message-blocks.ts:4`、`preview-annotate.ts:26,38` 等），**不会整文件死**，但 tail-batch 那批导出（`TailBatchRow`/`TranscriptSelectableRole`/`computeTailBatch*`）届时**将只剩测试消费**。apps 机位**未逐条核实这批导出在 `chat.ts` 内的其它消费** | D-106/D-107/D-304 | 施工 D-106 时复查 |
| **5** | **哨兵字符甄别：`AgentDefinitionEditorForm` 的「文案占位价值」** | `docs/apm/memory/20260906-web-search-tool-overflow-sink.md:64` 写「`AgentDefinitionEditorForm` 未挂载组件照旧同步」，暗示这个 1048 行孤儿**仍被当作 hint 文案第三处在维护**。apps 机位**没有去核那三处 hint 文案当前实际在哪个文件里**，故 D-102 的前置条件描述是推测性的 | D-102（最大单条） | 施工前先定位三处 hint 文案实体 |
| **6** | **`infra/tokenizer/index.ts` 分类冲突** | prose 说「16 条 reexport 不在任何快照里，**属无快照的 A 类，禁删**」；但 `tierC.json` 把其中 **13 条放进 `confirmed`（C 类可信删）** + 28 条放 `snap`（A 类）+ 1 条 `testOnlyC` | B3-a/B3-b 的 13 条（≈35 行 export 块） | **两处 artifact 自相矛盾**。本 backlog 采信 `tierC.json`（可复跑），但**动前须人工确认这 13 条是否真不在任何快照里** |
| **7** | **webview「注册表注入型」导出** | `apps/mobile/src/web/**` 的 `runtime/menu/menu.ts`(11 条)、`runtime/stream/stream.ts`(9 条) 经 `@web/` 别名被 `main.ts` 入口间接拉起，属**可达**，apps 机位按「只去 export」处理但**未逐个确认** | 未进本 backlog | 交给 `xc-webview` 类机位或 W6 验证 |
| **8** | **两份 raw 都自述未验证编译/测试** | PLAN §5 只读纪律 → core 机位明写「我没有实跑 `tsc` / `npm test` 验证任何删除动作的安全性」。D-207/D-209 的删除建议**需要编译验证才能落地** | 批次 2 | code-dev-loop 执行时必须补 `tsc -p packages/core` + 各 app 测试 |

### 争议计数

本节列 **8 条**待裁决，其中 **6 条**（#1 #2 #3 #4 #5 #6）会改变 backlog 的**条目集合或批次归属**，2 条（#7 #8）是施工期复查项。

---

## 行数预估

| 批次 | 条目数 | 物理行删除 | 依据 |
|---|---|---|---|
| 批次 1 · 零连带整文件/整段 | 16 | **2 252** | 逐文件 `wc -l` 实测（含 D-102 的 1 048、D-101 的 548） |
| 批次 2 · 有测试 / 配置连带 | 9 | **248** | 逐文件实测 |
| 批次 3-a · core 删 barrel 转发行 | 53 | **≈112** | 扫描 16 个文件的 `export {}` 块实测 115 行 − 整文件内 3 行 |
| 批次 3-b · core 整段删符号 | 40 | **≈166** | 实测符号声明行跨度 209 行 − 整文件内重叠 43 行（跨度测量为上界，`TOKEN_COUNTER_MODE_PREF_KEY` 实测 25 行 / 实际 1 行） |
| 批次 3-c · core 只摘 export | 255 | **0** | 只删 `export` 关键字，保留实现 |
| 批次 3-d · apps/core 级联 + 去 export | 17 | **≈108**（其中 D-316 ≈55 需裁决） | IPC 常量 / 通道行 / `hideRange` 4 处声明 / 双份实现 |
| **合计** | **≈397** | **≈2 886** | **区间 2 600 – 3 000 行** |

**交叉验证与去重**：
- **apps raw 自估 ≈2.2k 行**；本机位实测 17 个 apps 死文件 + `cli/vfs/runtime.ts` + `session-messages-loader.ts` = **2 191 行** ✅
  （再加 IPC 级联 +32、`hideRange` 4 处声明 +12、`FILE_OPEN_TOOL_NAMES` +4 → **2 239 行**）。
- **core raw 未给行数**；本机位对 363 条全量实测 → **548 行**（270 整文件 + 166 整段 + 112 转发行）。
- **唯一交叉重复**：`packages/core/src/domain/tool/logic/subagent-tool-session-id.ts`——apps 机位报成 F-xc-dead-apps-13（F-c），
  但它同时落在 core C 类 363 条里（`isTaskToolUse`，见附录 A.2）。**合并后只算 1 条，以 D-116 为准。**
- **不在 363 条里的 raw 条目**：`hideRange`（属「仅测试」桶）、`FILE_OPEN_TOOL_NAMES`（属 B 类公开面）、
  `config-forms/shared/*` 双份实现（属 B 类）——三者与 C 类不冲突，是并列的独立候选。

**权威条目集合** = 363（core C 类，附录 A）+ 24（apps 真死）+ 1（`config-forms/shared` 候选 D-316）+ 9（D-305~D-313 去 export）
≈ **397 个作业单元**（387 条为 raw 已核实的「真死」，10 条为本机位补的导出面收窄项）。
**以 `tmp/w3c/tierC.json` + 本表 D-xxx ID 为准，不要按表头数字复算。**

**若议题 #1 判定「core 无仓外 TS 消费者」**：解锁 A-type 99 条，另可加 **≈400 行**（需先改 `L0/coverage-matrix.md` 重跑口径）。

**不计入行数的部分**：255 条「只摘 export」（物理行删除 0，只减导出面）+ D-305~D-312 去 export 批（约 40 符号，0 行）+ D-313 periph 8 条（0 行）。
这部分的价值是**收窄导出面、让 knip / tsc 不再报未消费**，不是净减代码量。

---

## 依赖关系（机位）

| 本 backlog 依赖 | 用途 |
|---|---|
| `raw/w3-xc-ipc.md` | D-301~D-304 的通道摘除口径（main 侧 handler 归属） |
| `synth/core-runtime.md` | D-314 / D-317 的 `AgentSession.hideRange`、`service/{kkv,session-run-state}` 去重 |
| `synth/core-misc.md` | D-315 `FILE_OPEN_TOOL_NAMES` 单源化 vs 删公开副本 |
| `L0/coverage-matrix.md` | periph 12 包 / 90 文件补登记（F-20），否则后续机位重复劳动 |
| `tmp/l0census/dead-exports.mjs:197` | F-1 桶定义修复；**修完必须重跑 L0** 才能使用「仅测试」表 |
---

## 附录 A · core C 类 363 条全量清单（186 文件）

> 机读源：`tmp/w3c/tierC.json` → `.confirmed[]`（`{file,name,kind,extra}`）。
> 本附录按动作分三档渲染，code-dev-loop 可直接按 `动作` 列分波次消费。
> `动作=摘export` = 只删 `export` 关键字，保留实现（物理行删除 = 0，行为零风险）。
> `⚠` = 该文件的 barrel 转出被判定为「barrel 转出而非真消费」，删前须逐个核对。

### A.1 整文件可删（6 文件 · 270 行）

| 文件 | 导出 | 连带测试 | 批次 |
|---|---|---|---|
| `packages/core/src/common/memoize.ts` | memoize | 无 | 见正文 D-113/114/115/207/208/209 |
| `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | InferredScope, inferScopeFromPhysicalPath | 无 | 见正文 D-113/114/115/207/208/209 |
| `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | parseKkvJsonDocument | 无 | 见正文 D-113/114/115/207/208/209 |
| `packages/core/src/service/kkv/index.ts` | createKkvService, isKkvError, KkvError, KkvErrorCode, KkvService | 无 | 见正文 D-113/114/115/207/208/209 |
| `packages/core/src/service/session-run-state/index.ts` | createSessionRunStateService, SessionRunState, SessionRunStateService, SessionRunStateSettleInput, SessionRunStatus | 无 | 见正文 D-113/114/115/207/208/209 |
| `packages/core/src/types/agnai-tokenizers.d.ts` | cleanText | 无 | 见正文 D-113/114/115/207/208/209 |

### A.2 整段删除（文件仍被引用，删符号本体）— 40 条 / 30 文件

| 文件 | 符号 | 动作 | 批次 |
|---|---|---|---|
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `buildToolsPolicy`, `joinPersistBlocksForLayout`, `toolsFromDefinition` | 删符号段 | B3 |
| `packages/core/src/service/vfs/vfs.port.ts` | `VfsGrepMatchMode`, `VfsZipImportOptions`, `VfsZipIoService` | 删符号段 | B3 |
| `packages/core/src/config-forms/stored-config-validity/types.ts` | `CURRENT_AGENT_SCHEMA_VERSION`, `CURRENT_EVENTS_SCHEMA_VERSION` | 删符号段 | B3 |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `logicalFromZipDirectoryEntryName`, `zipDirectoryEntryNameFromLogical` | 删符号段 | B3 |
| `packages/core/src/infra/nmtp/index.ts` | `TokenizerDriver`, `TokenizerErrorCode` | 删符号段 | B3 |
| `packages/core/src/infra/sksp/index.ts` | `EnvSecretStoreLike`, `SkspDriver` | 删符号段 | B3 |
| `packages/core/src/infra/sql-template/index.ts` | `ForeachAttrs`, `TrimAttrs` | 删符号段 | B3 |
| `packages/core/src/infra/tdbc/index.ts` | `ParsedTdbcUrl`, `TdbcErrorCode` | 删符号段 | B3 |
| `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` | 删符号段 | B3 |
| `packages/core/src/bootstrap/schema-migrations/schema-migrations-table.ts` | `isSchemaMigrationApplied` | 删符号段 | B3 |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_ENTRY_INDEX_DDL` | 删符号段 | B3 |
| `packages/core/src/bootstrap/vfs/vfs-schema.ts` | `VFS_ENTRY_SCOPE_PATH_INDEX_DDL` | 删符号段 | B3 |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `collectUserOpsChangedPaths` | 删符号段 | B3 |
| `packages/core/src/domain/chat/model/message-attachment.schema.ts` | `MessageAttachments` | 删符号段 | B3 |
| `packages/core/src/domain/depth/logic/depth-slice.ts` | `depthSliceFromWire` | 删符号段 | B3 |
| `packages/core/src/domain/events/model/event-types.ts` | `NovelMasterEventPayload` | 删符号段 | B3 |
| `packages/core/src/domain/message-checkpoint/model/message-checkpoint.ts` | `MessageCheckpoint` | 删符号段 | B3 |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `builtinProtocolByProviderId` | 删符号段 | B3 |
| `packages/core/src/domain/provider/model/saved-model-settings.schema.ts` | `savedModelSettingsDocumentSchema` | 删符号段 | B3 |
| `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts` | `SessionKkvDomain` | 删符号段 | B3 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `VfsToolContext` | 删符号段 | B3 |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `isTaskToolUse` | 删符号段 | B3 |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `VfsGrepMatchMode` | 删符号段 | B3 |
| `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | `VfsEntryKind` | 删符号段 | B3 |
| `packages/core/src/errors/agent-runtime-errors.ts` | `agentUnsupportedProvider` | 删符号段 | B3 |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `__resetDefaultPushAgentMutexForTests` | 删符号段 | B3 |
| `packages/core/src/infra/tokenizer/index.ts` | `ForVendorModelOptions` | 删符号段 | B3 |
| `packages/core/src/infra/tokenizer/logic/count-openai-style-message.ts` | `CountOpenAiStyleMessageOptions` | 删符号段 | B3 |
| `packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts` | `TOKEN_COUNTER_MODE_PREF_KEY` | 删符号段 | B3 |
| `packages/core/src/service/session-kkv/index.ts` | `SessionKkvService` | 删符号段 | B3 |

### A.3 删 barrel 转发行（reexport）— 53 条 / 16 文件 · ≈112 行

| 文件 | 符号 | 批次 |
|---|---|---|
| `packages/core/src/infra/tokenizer/index.ts` | `CONTEXT_WINDOW_RULES`, `DEFAULT_CONTEXT_WINDOW_TOKENS`, `ENCODING_RETRY_TTL_MS`, `invalidateSessionApiPromptTokenEntry`, `parseSessionApiPromptTokenEntry`, `readSessionApiPromptTokenEntry`, `registerTokenizerDriver`, `ResolveCurrentPromptTokensOptions`, `serializeSessionApiPromptTokenEntry`, `SessionApiPromptTokenEntry`, `setClockForTests`, `writeSessionApiPromptTokenEntry` | B3 |
| `packages/core/src/service/session-kkv/index.ts` | `fileCacheKey`, `RULE_SNAPSHOT_CANON_KEY`, `SESSION_KKV_COMPOSER_STATUS_DOMAINS`, `SESSION_KKV_DOMAIN_RULE_SNAPSHOT`, `SESSION_KKV_DOMAIN_USER_VFS_PENDING`, `USER_VFS_PENDING_QUEUE_KEY`, `WorkplaceDisplayStatus` | B3 |
| `packages/core/src/infra/tdbc/index.ts` | `executeTemplate`, `getDriver`, `listDrivers`, `parseUrl`, `queryTemplate`, `resolveDriver` | B3 |
| `packages/core/src/infra/sksp/index.ts` | `assertValidRef`, `EnvSecretStore`, `getSkspDriver`, `refToEnvVar`, `resolveSkspEnvOverride` | B3 |
| `packages/core/src/config-forms/shared/index.ts` | `formatApplicationModelId`, `matchDepth`, `parseApplicationModelId`, `validateDepthSlice` | B3 |
| `packages/core/src/config-forms/agent/index.ts` | `AgentDisplayNameSlot`, `formatApplicationModelId`, `parseApplicationModelId` | B3 |
| `packages/core/src/domain/prompt/logic/message-body.ts` | `formatChatMessageForCliPreview`, `messageBodyTextFromBlocks`, `messageBodyTextFromContent` | B3 |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `isSchemaMigrationApplied`, `markSchemaMigrationApplied` | B3 |
| `packages/core/src/common/index.ts` | `ReleaseNotesFocus`, `TokenSourceBadge` | B3 |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `dynamicTextBlockValueSchema`, `persistBlockValueSchema` | B3 |
| `packages/core/src/infra/nmtp/index.ts` | `getTokenizerDriver`, `resolveTokenizerDriver` | B3 |
| `packages/core/src/domain/compaction-conditions/model/compaction-conditions.schema.ts` | `DEFAULT_HIDE_START_DEPTH` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/restore-path.ts` | `ensureDirectoryChain` | B3 |
| `packages/core/src/infra/sql-template/index.ts` | `TemplateParser` | B3 |
| `packages/core/src/infra/tokenizer/logic/format-token-source-badge.ts` | `TokenSourceBadge` | B3 |
| `packages/core/src/service/workplace/assemble-workplace-display.ts` | `layoutHasWorkplace` | B3 |

### A.4 只摘 export 关键字（符号在文件内活着）— 255 条 / 156 文件 · 物理行删除 0

| 文件 | 符号 | 批次 |
|---|---|---|
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_DEFAULT_TIMEOUT_SECONDS`, `CURL_MAX_HEADER_VALUE_BYTES`, `CURL_MAX_HEADERS`, `CURL_MAX_REQUEST_BODY_BYTES`, `CURL_MAX_RESPONSE_BYTES`, `CURL_MAX_TIMEOUT_SECONDS`, `CurlToolInput`, `CurlToolOutput` | B3 |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatCurlOutput`, `formatGlobOutput`, `formatGrepOutput`, `formatReadOutput`, `formatSearchOutput`, `formatSkillLoadOutput`, `FormatToolErrorForLlmOptions`, `isSkillLoadOutput` | B3 |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolEditOutput`, `SkillToolInput`, `SkillToolListOutput`, `SkillToolLoadOutput`, `SkillToolOutput`, `SkillToolReadOutput`, `SkillToolWriteOutput` | B3 |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolGetOutput`, `AgentToolInput`, `AgentToolListEntry`, `AgentToolListOutput`, `AgentToolOutput`, `AgentToolWriteOutput` | B3 |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `CloudSyncCoordinatorDeps`, `getDefaultPushAgentMutex`, `PullOptions`, `PullResult`, `PushOptions`, `PushResult` | B3 |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_IDS`, `BUILTIN_PROVIDER_UUID_GOOGLE`, `BUILTIN_PROVIDER_UUID_OPENROUTER`, `builtinProtocolByProviderKey`, `BuiltinProviderSeedRow` | B3 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `BuiltinToolContext`, `GlobToolOutput`, `GrepToolOutput`, `ReadToolOutput`, `VfsReadResult` | B3 |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_DELETE_TRIGGER_DDL`, `VFS_REVISION_INSERT_TRIGGER_DDL`, `VFS_REVISION_TABLE_DDL`, `VFS_REVISION_UPDATE_TRIGGER_DDL` | B3 |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `WorkspaceFlushAddedFile`, `WorkspaceFlushChangedFile`, `WorkspaceFlushDiff`, `WorkspaceFlushDiffInput` | B3 |
| `packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts` | `MutatingPathHeadAbsent`, `MutatingPathHeadDirectory`, `MutatingPathHeadPresent`, `MutatingPathHeadSnapshot` | B3 |
| `packages/core/src/infra/tokenizer/logic/count-tokens.ts` | `ChatTokenCountKind`, `ChatTokenEncoder`, `ChatTokenMessage`, `CountTokensOptions` | B3 |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `AdvanceGenerationOptions`, `CHUNK_CACHE_MAX_TOTAL_ENTRIES`, `CounterScopeInput`, `TokenChunkCacheItem` | B3 |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `hasEffectivePromptSource`, `parseToolsList`, `PROMPT_BLOCK_ROLES` | B3 |
| `packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts` | `DynamicPromptBlockWire`, `PersistPromptBlockWire`, `PersistTextBlockWire` | B3 |
| `packages/core/src/domain/tool/builtin/overflow-sink.ts` | `extensionForContentType`, `OVERFLOW_SINK_DIR`, `SinkOversizedInput` | B3 |
| `packages/core/src/domain/tool/builtin/search/search-tool.ts` | `SEARCH_CHAIN_BUDGET_MS`, `SearchToolInput`, `SearchToolOutput` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` | `CopyVfsTreeOptions`, `ReplaceVfsSubtreeOptions`, `VfsCopyScope` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `basenameOfLogicalPath`, `logicalFromZipEntryName`, `zipEntryNameFromLogical` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts` | `VFS_ZIP_MAX_ENTRY_COUNT`, `VFS_ZIP_MAX_UNCOMPRESSED_BYTES`, `VfsZipValidatedPayload` | B3 |
| `packages/core/src/domain/workplace/repositories/workplace.port.ts` | `InclusionMode`, `WorkplaceDirRule`, `WorkplaceFileRule` | B3 |
| `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts` | `BlobBinaryStatus`, `BlobBinaryTableId`, `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` | B3 |
| `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `MESSAGE_CHECKPOINT_FILE_TABLE_DDL`, `MESSAGE_CHECKPOINT_TABLE_DDL` | B3 |
| `packages/core/src/domain/agent/logic/doom-loop.ts` | `assertNoDoomLoop`, `DoomLoopChecksConfig` | B3 |
| `packages/core/src/domain/character-card/logic/extract-png-chara.ts` | `extractPngCharaBase64`, `PNG_SIGNATURE` | B3 |
| `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts` | `DEFAULT_HEURISTIC_SAFETY_FACTOR`, `TokenRatioTriggerOptions` | B3 |
| `packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` | `isLegacyWorktreeWireBlock`, `LegacyPersistWorktreeWireBlock` | B3 |
| `packages/core/src/domain/provider/model/saved-model-settings.schema.ts` | `savedModelSettingsV2DocumentSchema`, `thinkingLevelSchema` | B3 |
| `packages/core/src/domain/skills/logic/skill-paths.ts` | `SkillRelPathInvalidReason`, `SkillRelPathResolution` | B3 |
| `packages/core/src/domain/tool/builtin/search/engines/brave.ts` | `BRAVE_DOMAIN_FILTER_COUNT`, `BRAVE_TIMEOUT_MS` | B3 |
| `packages/core/src/domain/tool/logic/fs-command.ts` | `FsCommand`, `FsLsOutput` | B3 |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `ToolResultBlock`, `ToolUseBlock` | B3 |
| `packages/core/src/domain/vfs/logic/compute-replace-result.ts` | `ComputeReplaceResult`, `ComputeReplaceResultOptions` | B3 |
| `packages/core/src/domain/vfs/logic/revision-ref-count.ts` | `CheckpointFilePointer`, `RepairReport` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-grep.ts` | `VfsGrepContentRow`, `VfsGrepMatchMode` | B3 |
| `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts` | `FillFileCacheOptions`, `LoadOrFillFileCacheDeps` | B3 |
| `packages/core/src/domain/workplace/logic/workplace-eval.ts` | `SortDirPathsOptions`, `SortFilesForDirOptions` | B3 |
| `packages/core/src/domain/workplace/logic/workplace-file-tree.ts` | `RenderWorkplaceFileTreeForMacroParams`, `RenderWorkplaceFileTreeParams` | B3 |
| `packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts` | `PushAgentMutexAcquireErrorCode`, `PushAgentMutexAcquireOptions` | B3 |
| `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts` | `DecodedContentPoolLimits`, `DecodedContentPoolStats` | B3 |
| `packages/core/src/infra/events/simple-event-bus.ts` | `EventHandler`, `SimpleEventBusOptions` | B3 |
| `packages/core/src/infra/llm-protocol/logic/gemini-content-mapper.ts` | `ChatMessagesToGeminiContentsOptions`, `GeminiPartsToBlocksOptions` | B3 |
| `packages/core/src/infra/llm-protocol/logic/stream-partial-blocks.ts` | `StreamPartialInput`, `StreamPartialToolUse` | B3 |
| `packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts` | `StreamWatchdog`, `StreamWatchdogOptions` | B3 |
| `packages/core/src/infra/prompt-template/macro-scan.ts` | `MacroAction`, `MacroActionKind` | B3 |
| `packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `ChatTokenEstimateMemoEntry`, `stampToolsForEstimateMemo` | B3 |
| `packages/core/src/service/integrity-repair.ts` | `IntegrityRepairKind`, `IntegrityRepairReport` | B3 |
| `packages/core/src/service/message-checkpoint/truncate-tail-wiring.ts` | `TruncateTailDeps`, `TruncateTailParams` | B3 |
| `packages/core/src/service/prompt/render-prompt.ts` | `PromptLlmInput`, `PromptRenderContext` | B3 |
| `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts` | `SmartSortBuiltinSeedRow`, `SmartSortRuleServiceDeps` | B3 |
| `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts` | `SchemaColumnAlignment` | B3 |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `SchemaMigration` | B3 |
| `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` | `AGENT_CONFIG_SEED_VERSION` | B3 |
| `packages/core/src/bootstrap/skills/skills-schema.ts` | `SKILL_DISABLED_SCOPE_INDEX` | B3 |
| `packages/core/src/bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts` | `BuiltinSmartSortRuleSeedRow` | B3 |
| `packages/core/src/bootstrap/smart-sort-rule/smart-sort-rule-schema.ts` | `SMART_SORT_RULE_ORDER_INDEX` | B3 |
| `packages/core/src/bootstrap/vfs/vfs-content-blob-schema.ts` | `VFS_CONTENT_BLOB_TABLE_DDL` | B3 |
| `packages/core/src/bootstrap/vfs/vfs-schema.ts` | `VFS_ENTRY_TABLE_DDL` | B3 |
| `packages/core/src/bootstrap/workplace/workplace-schema.ts` | `WORKPLACE_FILE_SCOPE_INDEX` | B3 |
| `packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts` | `ResolveAgentToolRegistryOptions` | B3 |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `AgentDefinitionDocument` | B3 |
| `packages/core/src/domain/character-card/logic/character-card-to-md-tree.ts` | `normalizedCardToMdTree` | B3 |
| `packages/core/src/domain/character-card/logic/parse-character-card-json.ts` | `stripUtf8BomText` | B3 |
| `packages/core/src/domain/character-card/logic/validate-md-tree-paths.ts` | `assertMdTreeRelativePathAllowed` | B3 |
| `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts` | `AttachmentDisplayKind` | B3 |
| `packages/core/src/domain/chat/logic/composer-sendable-input.ts` | `ComposerSendableInput` | B3 |
| `packages/core/src/domain/chat/logic/message-content-codec.ts` | `EncodedMessageContent` | B3 |
| `packages/core/src/domain/chat/logic/seed-fork-copy-parity.ts` | `SeedForkCopyParityInput` | B3 |
| `packages/core/src/domain/chat/model/message.ts` | `MessageUsage` | B3 |
| `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | `CompactionConditionModelContext` | B3 |
| `packages/core/src/domain/depth/logic/depth-from-tail.ts` | `depthFromTailIndex` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` | `BackfillBaselineResult` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/backfill-missing-revision.ts` | `BackfillRevisionDeps` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/resolve-reconcile-paths.ts` | `ReconcilePathSets` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/resolve-target-tree.ts` | `RollbackTargetTreeResolution` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/restore-path.ts` | `RestorePathOutcome` | B3 |
| `packages/core/src/domain/message-checkpoint/logic/revive-deleted-entry.ts` | `ReviveDeletedEntryDeps` | B3 |
| `packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts` | `DynamicMacroContext` | B3 |
| `packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts` | `validatePromptBlocksFromMap` | B3 |
| `packages/core/src/domain/provider/model/model-suggestion-cache.schema.ts` | `modelSuggestionCacheDocumentSchema` | B3 |
| `packages/core/src/domain/provider/model/model-suggestion-cache.ts` | `ModelSuggestionEntry` | B3 |
| `packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts` | `HashedFileCachePayload` | B3 |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts` | `CreateSmartSortRuleFields` | B3 |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `ResolveChildModelIdResult` | B3 |
| `packages/core/src/domain/tool/builtin/search/engines/duckduckgo.ts` | `DUCKDUCKGO_TIMEOUT_MS` | B3 |
| `packages/core/src/domain/tool/builtin/search/engines/searxng.ts` | `SEARXNG_TIMEOUT_MS` | B3 |
| `packages/core/src/domain/tool/builtin/search/engines/tavily.ts` | `TAVILY_TIMEOUT_MS` | B3 |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `AgentDefinition` | B3 |
| `packages/core/src/domain/tool/logic/fs-command-classify.ts` | `FsCommandClassification` | B3 |
| `packages/core/src/domain/tool/logic/tool-output-limits.ts` | `TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX` | B3 |
| `packages/core/src/domain/vfs/content-store/logic/resolve-stored-content.ts` | `StoredContentFields` | B3 |
| `packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts` | `asUint8Array` | B3 |
| `packages/core/src/domain/vfs/logic/entry-sequence-repair.ts` | `VFS_ENTRY_SEQUENCE_REPAIR_NAME` | B3 |
| `packages/core/src/domain/vfs/logic/extract-mutating-paths.ts` | `MutatingToolCall` | B3 |
| `packages/core/src/domain/vfs/logic/longest-common-substring.ts` | `LongestCommonSubstringResult` | B3 |
| `packages/core/src/domain/vfs/logic/validate-entry-name.ts` | `vfsEntryNameOfPath` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-exclude-prefixes.ts` | `normalizeExcludePrefix` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-move.ts` | `assertMoveTargetAvailable` | B3 |
| `packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts` | `ZipCentralDirEntry` | B3 |
| `packages/core/src/domain/vfs/model/vfs-list-entry.ts` | `VfsEntryKind` | B3 |
| `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | `BatchIngestTypeConflict` | B3 |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `VfsEntryKind` | B3 |
| `packages/core/src/domain/workplace/logic/smart-sort.ts` | `SmartSortKeyDetail` | B3 |
| `packages/core/src/errors/tool-errors.ts` | `ToolErrorDetails` | B3 |
| `packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts` | `CloudSyncErrorCode` | B3 |
| `packages/core/src/infra/db-backup/provider-table-snapshot-error.ts` | `ProviderTableSnapshotErrorCode` | B3 |
| `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts` | `RunMessageContentCompactionOptions` | B3 |
| `packages/core/src/infra/llm-protocol/logic/anthropic-sse-parser.ts` | `AnthropicSseParserState` | B3 |
| `packages/core/src/infra/llm-protocol/logic/anthropic-tool-names.ts` | `ANTHROPIC_WIRE_TOOL_NAME_PATTERN` | B3 |
| `packages/core/src/infra/llm-protocol/logic/dispatch-sse-chunk.ts` | `SseDispatchState` | B3 |
| `packages/core/src/infra/llm-protocol/logic/gemini-sse-parser.ts` | `GeminiSseParserState` | B3 |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `PostSseOptions` | B3 |
| `packages/core/src/infra/llm-protocol/logic/openai-content-mapper.ts` | `OpenAiChatMessage` | B3 |
| `packages/core/src/infra/llm-protocol/logic/openai-sse-parser.ts` | `OpenAiSseParserState` | B3 |
| `packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts` | `SseChunkEmitter` | B3 |
| `packages/core/src/infra/llm-protocol/logic/sse-line-buffer.ts` | `SseLineBufferState` | B3 |
| `packages/core/src/infra/llm-protocol/logic/tool-arguments-parse.ts` | `TryParseToolArgumentsResult` | B3 |
| `packages/core/src/infra/prompt-template/macro-render.ts` | `MacroRenderContext` | B3 |
| `packages/core/src/infra/serialization/stringify-text.ts` | `TextFormat` | B3 |
| `packages/core/src/infra/sql-template/errors.ts` | `SqlTemplateErrorCode` | B3 |
| `packages/core/src/infra/sql-template/evaluator.ts` | `EvaluateState` | B3 |
| `packages/core/src/infra/sql-template/expression.ts` | `EvaluateTestOptions` | B3 |
| `packages/core/src/infra/sql-template/placeholder.ts` | `BindResult` | B3 |
| `packages/core/src/infra/sql-template/tags/where.ts` | `stripLeadingAndOr` | B3 |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `EncodingFactory` | B3 |
| `packages/core/src/infra/tokenizer/logic/count-openai-style-message.ts` | `TokenEncoder` | B3 |
| `packages/core/src/infra/tokenizer/logic/create-default-registry.ts` | `CreateDefaultTokenCounterRegistryDeps` | B3 |
| `packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts` | `PromptTokenSource` | B3 |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-cache.ts` | `SessionApiPromptTokenCacheEntry` | B3 |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts` | `SessionApiPromptTokenEntry` | B3 |
| `packages/core/src/service/agent/impl/agent-registry.service.ts` | `DefaultAgentRegistryServiceDeps` | B3 |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `DefaultAgentRunnerDeps` | B3 |
| `packages/core/src/service/chat/create-chat-services.ts` | `ChatServicesOptions` | B3 |
| `packages/core/src/service/chat/impl/message-transcript-effects.service.ts` | `MessageTranscriptEffectsServiceDeps` | B3 |
| `packages/core/src/service/chat/impl/message.service.ts` | `MessageServiceDeps` | B3 |
| `packages/core/src/service/chat/impl/project.service.ts` | `ProjectServiceDeps` | B3 |
| `packages/core/src/service/chat/impl/session.service.ts` | `SessionServiceDeps` | B3 |
| `packages/core/src/service/compaction-conditions/create-compaction-condition-evaluator.ts` | `CreateCompactionConditionEvaluatorDeps` | B3 |
| `packages/core/src/service/compaction-conditions/hide-message.action.ts` | `HideMessageHandlerDeps` | B3 |
| `packages/core/src/service/coordinated-write.ts` | `WriteStep` | B3 |
| `packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts` | `MessageCheckpointServiceDeps` | B3 |
| `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts` | `MessageRollbackServiceDeps` | B3 |
| `packages/core/src/service/provider/impl/model-request.service.ts` | `DefaultModelRequestServiceDeps` | B3 |
| `packages/core/src/service/provider/impl/provider-model.service.ts` | `DefaultProviderModelServiceDeps` | B3 |
| `packages/core/src/service/provider/impl/provider.service.ts` | `DefaultProviderServiceDeps` | B3 |
| `packages/core/src/service/session-fs/create-session-fs-service.ts` | `SessionFsServiceOptions` | B3 |
| `packages/core/src/service/session-fs/impl/session-fs.service.ts` | `SessionFsServiceDeps` | B3 |
| `packages/core/src/service/skills/impl/skills.service.ts` | `SkillsServiceDeps` | B3 |
| `packages/core/src/service/template/logic/initialize-session-workspace.ts` | `InitializeSessionWorkspaceOptions` | B3 |
| `packages/core/src/service/vfs/create-vfs-batch-io-service.ts` | `CreateVfsBatchIoServiceOptions` | B3 |
| `packages/core/src/service/vfs/create-vfs-zip-io-service.ts` | `CreateVfsZipIoServiceOptions` | B3 |
| `packages/core/src/service/vfs/impl/character-card-import.service.ts` | `DefaultCharacterCardImportServiceOptions` | B3 |
| `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts` | `DefaultVfsBatchIoServiceOptions` | B3 |
| `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts` | `DefaultVfsZipIoServiceOptions` | B3 |
| `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts` | `EnsureImportDirRulesDeps` | B3 |
| `packages/core/src/service/workplace/impl/workplace-view-cache.ts` | `WorkplaceViewCacheEntry` | B3 |
| `packages/core/src/service/workplace/impl/workplace.service.ts` | `WorkplaceServiceDeps` | B3 |

