---
zone: synth-verify
agent: W6 验证代理
mode: 只读（零 git 写、零 docs/apm 写）
input: synth/dead-backlog.md
verified_at: 2026-10-01
---

# W6 验证报告 · dead-backlog.md

## 摘要

对 `synth/dead-backlog.md` 做独立复核，全部结论用 `git grep -n -I -w`（逐符号、跨 apps/packages/examples，排除 node_modules / tmp / docs / CHANGELOG / package-lock / assets）重算，不采信原表的任何数字。

- **批次 1（16 条）逐条复核：14 条 confirmed，2 条 adjusted（D-109 锚点不全、D-116 有 1 处测试连带被漏标），0 条 refuted。**
- **批次 1 具备直接开工条件**，但必须按本报告 §2 的两处修正改写施工单；行数从 2 252 修正为 **2 236**。
- **批次 2 抽 5 条**：4 confirmed / 1 adjusted（D-201 的 6 处 `jest.mock` 名单完全正确，行数 -1）。
- **批次 3 抽 5 条**：3 confirmed / 2 adjusted（D-305 的「22 条 DTO」实测 **20 条**；D-314 的连带面比原表描述更干净，但争议 #2 给它找的「注释证据」是假的）。
- **8 条需人工裁决**逐条给了倾向性建议（§5），其中争议 #1 有新的硬证据：**全仓 13 个包全部 `private: true` + `version: 0.0.0`，`.github/` 与 `scripts/` 里没有任何 `npm publish`** → 「core 是否有仓外 TS 消费者」的答案是「结构上没有」。

---

## 1 · 复核方法与口径

| 项 | 本报告口径 |
|---|---|
| 引用检索 | `git grep -n -I -w -e <名> -- apps packages examples`，再按路径过滤 `node_modules/`、`tmp/`、`docs/`、`CHANGELOG.md`、`package-lock.json`、`*/assets/` |
| 文件级引用 | 同上按**文件名/路径片段**再 grep 一遍（`fix-settings-utf8`、`useWorkspaceTree`、`infer-scope-from-path` …） |
| 配置连带 | 另对 `*.json` `*.js` `*.mjs` `*.cjs` `*.yaml` `*.yml` `*.toml` 全量 grep（结果：批次 1 的 16 个文件在配置面 **零引用**） |
| 快照面 | 直接读 `packages/core/test/package-exports/snapshots/*.json`（13 份）做 `"名字"` 字面命中 |
| 行数 | `fs.readFileSync().split('\n').length - 1`（= `wc -l` 口径） |
| 编译 | **未跑**（只读纪律）。所有 verdict 的「编译红/绿」是静态推断，不是实测 |

原表行数全部 **+1**（`wc -l` 少算一行尾随换行的写法差异），批次 1 16 个文件无一例外，合计 2 252 → **2 236**。

---

## 2 · 批次 1 逐条 verdict（16/16）

| ID | 文件 | 存在 | 实测行 | 零 importer | 零外部符号引用 | 零配置引用 | 快照面 | verdict |
|---|---|---|---|---|---|---|---|---|
| D-101 | `apps/desktop/scripts/fix-settings-utf8.mjs` | ✅ | 547 | ✅ 仅自身 `:3` 注释 | ✅ | ✅ 无 `package.json` script 引用 | n/a | **adjusted**（死是真的，「ENOENT 崩」不成立，见下） |
| D-102 | `.../settings/AgentDefinitionEditorForm.tsx` | ✅ | 1 047 | ✅ 零引用（含 `AgentEditorView` 等 16 个 renderer 文件全扫） | ✅ | ✅ | n/a | **confirmed**（争议 #5 已定位，见 §5） |
| D-103 | `.../workspace/useWorkspaceTree.ts` | ✅ | 66 | ✅ | ✅ `usePreviewSelection`/`useTreeRefreshToken`/`useTreeLoader` 三符号全仓仅本文件 | ✅ | n/a | **confirmed** |
| D-104 | `apps/mobile/src/components/batch/ListBatchBar.tsx` | ✅ | 56 | ✅ | ✅ | ✅ | n/a | **confirmed** |
| D-105 | `.../features/chat/tool-turn-actions.ts` | ✅ | 54 | ✅ `features/chat/tool-turn-actions` 零命中 | ✅ `hideToolTurn`/`deleteToolTurn` 的 desktop 侧零外部引用（mobile 同名文件另有 5 个 `it`，属 D-204） | ✅ | n/a | **confirmed** |
| D-106 | `apps/mobile/.../transcript-selectable-role.ts` | ✅ | 49 | ✅ | ✅ | ✅ | n/a | **confirmed** |
| D-107 | `apps/desktop/.../transcript-selectable-role.ts` | ✅ | 47 | ✅ | ✅ | ✅ | n/a | **confirmed** |
| D-108 | `apps/desktop/renderer/layout/AppMenuBar.tsx` | ✅ | 40 | ✅ `AppMenuBar` 全仓仅自身定义 | ✅ | ✅ | n/a | **confirmed** |
| D-109 | `apps/cli/src/vfs/errors.ts` | ✅ | 28 | ✅ 无 `from './errors.js'`、无 `vfs/errors` 说明符 | ✅ `EXIT_USAGE`/`EXIT_RUNTIME`/`formatCliError`/`exitCodeForError` 四符号在 cli 侧只有 `cli-errors.ts` 那一份在用（`main.ts:23-27` 引的是 `./cli-errors.js`） | ✅ | n/a | **adjusted**（锚点 `:4,7,20` 漏了 `:5` 的 `EXIT_RUNTIME`） |
| D-110 | `apps/cli/src/vfs/runtime.ts` | ✅ | 24 | ✅ `vfs/runtime` 零命中 | ✅ `createVfsRuntime` 全仓仅本文件 `:18` | ✅ | n/a | **confirmed** |
| D-111 | `apps/mobile/src/hooks/useStreamTailGenerating.ts` | ✅ | 12 | ✅ | ✅ 仅与 desktop 同名文件互相 grep 命中（各自定义行） | ✅ | n/a | **confirmed** |
| D-112 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | ✅ | 10 | ✅ | ✅ 同上 | ✅ | n/a | **confirmed** |
| D-113 | `packages/core/src/common/memoize.ts` | ✅ | 123 | ✅ `common/memoize` 仅自身 `@module`；`common/index.ts` **未**转发 | ✅ `memoize` 全仓仅本文件（`package-lock.json` 的 `memoize-one` 是第三方依赖，无关） | ✅ | ✅ 13 份快照零命中 | **confirmed** |
| D-114 | `.../domain/vfs/logic/infer-scope-from-path.ts` | ✅ | 74 | ✅ | ✅ 唯一外部命中是 `vfs-path-mapper.ts:187` 的**注释** | ✅ | ✅ 快照零命中 | **confirmed**（删注释同步做） |
| D-115 | `.../infra/kkv/logic/parse-kkv-json-document.ts` | ✅ | 21 | ✅ | ✅ `parseKkvJsonDocument` 全仓仅本文件 | ✅ | ✅ 快照零命中 | **confirmed** |
| D-116 | `.../domain/tool/logic/subagent-tool-session-id.ts` | ✅ | 38 | ✅ | ⚠ `isTaskToolUse` 零引用（含测试）；**`resolveSubagentSessionId` 有 1 处测试引用** | ✅ | ✅ 快照零命中 | **adjusted**（见下） |

### D-101 —— refuted 子命题

原表写「跑一次会从固定 commit `d825173` 覆写工作区，当前树上会 **ENOENT 崩**」。实测：

```
git cat-file -t d825173                    → commit（存在，2026-06-06 fix(desktop): restore UTF-8 ...）
git cat-file -e d825173:.../AgentEditorView.tsx → 存在
```

所以脚本**不会崩**，它会**静默成功并把工作区的 `AgentEditorView.tsx` 回退成 2026-06 的版本**，同时 `fixEventsEditor` 在当前 `EventsConfigView.tsx` 不含 `动作 `/`事件配置` 字面时整文件重写。**风险等级比原表描述更高，不是更低**——它是「跑一次就丢代码」而不是「跑一次就报错」。这条仍然是全批次最该先删的，但删的理由要改写。

### D-109 —— adjusted 子命题

原表写 `apps/cli/src/vfs/errors.ts:4,7,20`，实际该文件 4 个导出落在 `:4 EXIT_USAGE` / `:5 EXIT_RUNTIME` / `:7 formatCliError` / `:20 exitCodeForError`，**漏了 `:5`**。因为整个文件零 importer，动作是「整文件删」，锚点漏一条不影响施工，但要改过来免得 code-dev-loop 按 `:4,7,20` 删完留一个孤儿 `EXIT_RUNTIME`。

### D-116 —— adjusted（有真实连带，原表漏标）

原表批次 1 的总纲写「全部零 importer、零内部自用、**零测试**、零快照面」，但 D-116 行自己又写「`resolveSubagentSessionId` 有 1 处测试」。实测这处测试是真的：

```
packages/core/test/tool/subagent-meta-passthrough.test.ts:8   import { resolveSubagentSessionId } from "@/domain/tool/logic/subagent-tool-session-id.js";
packages/core/test/tool/subagent-meta-passthrough.test.ts:64  it("C17: resolveSubagentSessionId 从 meta 读取（对称 vfs-tool-file-path）", ...)
```

`src` 侧确实零引用（`build-tool-result-block.ts:354` 的 `resolveSubagentSessionIdFromOutcome` 是**另一个本地函数**，不是它）。所以 D-116 有两个互斥动作，必须选一个：

- **B1-a（推荐，仍属批次 1）**：只删 `isTaskToolUse`（`:33-37`，零引用零测试），保留 `resolveSubagentSessionId` + `ToolUseBlock`/`ToolResultBlock` 转出。测试不动，批次 1「零测试」总纲成立。
- **B1-b**：连 `resolveSubagentSessionId` 一起删，**必须同批删掉 `subagent-meta-passthrough.test.ts` 的 C17 用例（`:8` import + `:64-75`）**，否则 `tsc` 与该测试直接红。选这条等于把 D-116 降级成批次 2 的性质。

### 批次 1 的连带（不阻塞开工，但要登记）

| 触发 | 连带 | 实测结论 |
|---|---|---|
| D-105 落地 | `ipcMessagesHide`/`Show`/`Delete` 的 renderer 唯一调用点消失 | 确认：这三个 client 函数在 `apps/desktop/renderer` 里的调用点只有 `tool-turn-actions.ts`。**但 `ipcMessagesHideRange`/`ShowRange`/`TruncateAfter` 现在就已经零 renderer 调用**（只在 `client.ts` 再导出 + `invoke-registry.ts` 注册），所以 D-301/D-302/D-304 是三条独立的级联，不是一条 |
| D-108 落地 | `SHELL_MENU_POPUP` 全链死 | 确认：renderer 唯一调用者是 `AppMenuBar.tsx:17`。**`SHELL_SET_TITLEBAR_THEME` 另有活消费方 `ThemeProvider.tsx:55`**，原表的「别同删」警告成立 |
| D-106/D-107 落地 | `apps/desktop/shared/logic/chat.ts` 的 tail-batch/visibility 转出变零消费 | 确认（争议 #4 的问句有确定答案）：`computeTailBatchRangeFromSelection` / `selectTailBatchEligibleIdsFromAnchor` / `tailBatchDeleteAfterSeq` / `computeTailBatchAffectedIds` / `isTailBatchRowSelectable` / `computeVisibilityBatchAffectedIds` / `transcriptSelectableRole` / `isTranscriptRowSelectable` / `computeHide|ShowRangeFromSelection` 在 `apps/desktop` 侧的命中只有 `chat.ts` 自身转出 + 待删的两个 `transcript-selectable-role.ts`，**6 个 desktop 测试文件（`message-blocks`/`preview-*`/`rollback-*`/`composer-at-path`）没有一个引它们**。core 侧 `public/chat.ts` 仍转出且被快照锁住，所以**删 apps 侧这两文件不会让任何测试变红**；`chat.ts` 的 `:49-53 :76-77 :101-102 :108-109` 共 14 行转出随之成为可摘项 |

---

## 3 · 批次 2 抽样（抽 5 条 / 共 9 条）

| ID | 抽样核对点 | 实测 | verdict |
|---|---|---|---|
| D-201 | `apps/mobile/src/services/session-messages-loader.ts` 的 6 处 `jest.mock` 名单 | **6/6 全对**：`chat-tab-screen-legacy-scroll.test.tsx:157`、`chat-tab-screen.integration.test.tsx:209`、`composer-fullscreen.test.tsx:231`、`use-chat-tab-message-actions-rollback.test.ts:37`、`-set-floor.test.ts:23`、`-token-peak.test.ts:32`。`integration.test.tsx:421` 的「hook 消费方已退役」注释也在。`src` 侧零 importer | **confirmed**（行数 38，-1） |
| D-203 | `apps/mobile/src/components/chat/flush-run-ui.ts` | mobile 侧只有 `__tests__/flush-run-ui.test.ts`（3 个 `it`）引用；desktop 半边 `conversation-abort-retain.ts:7` 确实独立 import `./flush-run-ui`（不同路径），删 mobile 不影响 | **confirmed** |
| D-205 | `stream-tail-html-state.ts` | 全仓唯一引用是 `__tests__/stream-tail-html-state.test.ts:1` | **confirmed** |
| D-207 | `packages/core/src/service/kkv/index.ts` | `service/kkv/index` 全仓唯一命中是 `packages/core/tsconfig.test.json:26` 的 `@novel-master/core/kkv → ./src/service/kkv/index.ts`；`package.json` 的 `./kkv` 指向 `dist/public/kkv.js`，而 `src/public/kkv.ts` 是**直接**从 `create-kkv-service.js`/`kkv.port.js`/`kkv-errors.js` 转出、不经 `service/kkv/index.ts`。原表对「两处不一致」的判断成立 | **confirmed** |
| D-209 | `packages/core/src/types/agnai-tokenizers.d.ts` | 全仓 `@agnai` 只出现在本文件（ambient declare）、`packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts`（同名副本，driver 自带）、以及 driver 包的 `package.json` 依赖。`packages/core/**` 内**零** `@agnai/*` import | **confirmed**（但 ambient 文件在 `tsconfig.json:12` 的 `include:["src/**/*"]` 内，删后必须 `tsc -p packages/core` 实跑，本报告未跑） |

补一条原表没提的口径修正：`packages/core/dist` **在本工作树是存在的**（`2026-10-01 02:34` 构建产物，含 `public/*`、`config-forms/shared/*`）。原报告 §「数据访问」写「`packages/core/dist` 当前不存在」——**该结论已过期**（多半是当时没先 build core）。影响：mobile 单测如果删了某个 core 符号，报错会是「解析到**旧** dist 文件 / 缺符号」而不是「找不到 dist」。施工前必须先 `npm run build -w @novel-master/core` 再跑 mobile 测试，否则 mobile 侧的失败信号不可信。

---

## 4 · 批次 3 抽样（抽 5 条 / 共 17 条 + 附录 A 363 条）

| ID | 抽样核对点 | 实测 | verdict |
|---|---|---|---|
| D-301 | `MESSAGES_HIDE/SHOW/DELETE` renderer 调用点 | `ipcMessagesHide` 命中只在 `tool-turn-actions.ts:7,20,28,31` + `client.ts:90` + `invoke-registry.ts:360`；`Show`/`Delete` 同构。D-105 落地后 renderer 零调用成立 | **confirmed** |
| D-303 | `SHELL_MENU_POPUP` + 同段 `SHELL_SET_TITLEBAR_THEME` | `SHELL_MENU_POPUP` renderer 唯一调用者 `AppMenuBar.tsx:17`（待删）；`SHELL_SET_TITLEBAR_THEME` 活消费方 `ThemeProvider.tsx:55` → **不可同删** | **confirmed**（警告成立） |
| D-305 | `ipc-types.ts` 「22 条 DTO 外部零引用」 | 对该文件 216 个 export 名逐个 `-l -w` 全仓反查，**外部零引用 = 20 条**：`BootstrapStatusReady`、`BootstrapStatusFailed`、`ProjectAgentModeDto`、`AppGetInfoData`、`VfsBatchConflictDto`、`WorkplaceRuleState`、`WorkplaceInclusionMode`、`WorkplaceDisplayState`、`MessageMetadataDto`、`AgentPickerRowDto`、`ModelPickerRowDto`、`SessionUsageLastRequestDto`、`MessageAttachmentActionDto`、`StoredConfigInvalidDto`、`SmartSortRuleBundleRuleDto`、`SmartSortRuleMatchDto`、`BlobBinaryTableIdDto`、`BlobBinaryTableStatusDto`、`CloudSyncSetEnabledRequest`、`SearchEngineStatusDto`。这 20 条**也没有任何测试引用**（逐条查外部文件，无一命中测试目录） | **adjusted**：22 → **20**。动作口径「只摘 export、文件活」正确 |
| D-314 | `AgentSession.hideRange` 4 处声明 | 生产侧零调用；唯一调用者是 `packages/core/test/agent/agent-session.test.ts:26`。`MessageService.hideRange`（`message.service.ts:389`）是**另一个接口**，被 `message-transcript-effects.service.ts:51,125,151` + `apps/cli/src/message/commands.ts:174` + 桌面 `messages-set-floor-handler.test.ts:85` 消费，**必须活着**。原表的「勿伤活的 MessageService.hideRange」警告成立 | **confirmed**（但连带面比原表描述更干净：只有 1 个测试文件要改，另加争议 #2 的假证据，见 §5） |
| D-316 | `config-forms/shared/{depth-slice,application-model-id}.ts` 双份实现 | 4 个符号（`matchDepth`/`validateDepthSlice`/`format|parseApplicationModelId`）在 `config-forms/shared/` 内的全部出口只有 `index.ts:2-6`；`index.ts` 的外部消费方是 ①`duplicate-export-consistency.test.ts:8-9`（断言与 `compaction` 同源）②`apps/desktop/shared/logic/config-forms-shared.ts`（只转 `API_KEY_STATUS_LABELS`，来自 `ui-labels.ts`）③`apps/mobile/src/components/provider/ApiKeyStatusTag.tsx:6`（只取 `API_KEY_STATUS_LABELS`）④`jest.config.js:190` + `package.json:105` 子路径。**`index.ts` 本身必须留**（`ui-labels` 走它） | **confirmed**（前置条件比原表多一条：mobile jest 直连 `dist/config-forms/shared/index.js`，改完必须 rebuild core 再跑 mobile 测试） |

---

## 5 · 8 条需人工裁决 · 倾向性建议（不代拍板）

| # | 议题 | 新增硬证据 | 我的倾向 |
|---|---|---|---|
| **1** | 快照锁定面 173 条（type 99 / value 74），问的是「core 是否有仓外 TS 消费者」 | **全仓 13 个包全部 `private: true` + `version: 0.0.0`，无 `publishConfig`；`.github/**` 与 `scripts/**` 里 `npm publish` 零命中。发布只走 GitHub Release（APK/EXE/DMG）** | **倾向「无仓外 TS 消费者」→ A-type 99 条解锁进批次 3**。理由：仓外要消费只能靠 `git clone` + workspace link，那属于 fork 内部协作、不构成契约面。**但解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`**（本轮只读没跑，这是唯一硬门槛）。若用户认为「谁 clone 谁负责」，则维持全禁删 |
| **2** | 「intentional 预留」判定（D-311 `resolveLatestReleaseFromList` / D-314 `AgentSession.hideRange`） | `docs/Iterations/about-and-update-check/spec.md:187` **确实**写着「**预留**：导出 `resolveLatestReleaseFromList(releases, platform)` 供未来分端 workflow 替换实现」——**D-311 的证据成立**。但 D-314 引用的 `ephemeral-overlay-agent-session.ts:50-52` 那句「overlay compaction 若要实现，在 ephemeral overlay 上实现 `hideRange`」**在代码里不存在**（`git grep "overlay compaction"` 零命中；该文件 `:71-73` 只有一行无注释的委托实现）——**D-314 的「intentional」证据是假的** | **拆开处理**：D-311 **保留**（spec 明写预留，按 PLAN §3 标 intentional，删它违背文档）；D-314 **可删**（它没有任何 intentional 依据，实测唯一消费者是 1 个测试的 1 个用例，连带成本 = 删 4 处声明 + 删 `agent-session.test.ts` 的那个 `it`） |
| **3** | 迁移双形态：`config-forms/shared/*` 与 `domain/**` 同名同签名 | `git log` 查到两笔：①`eb8ae68b`（2026-06-12）**「feat(core): 迁入 config-forms 源码并注册子路径 exports」** ← 这就是迁移动作本身；②`f104af1c`（2026-08-30）「清理 10 tag 以前迁移代码」里**单独改过** `application-model-id.ts`（1 行）。两份文件内容**不相同**（1 409 B vs 1 773 B，shared 版更瘦）。`duplicate-export-consistency.test.ts` 是**刻意**加的同源守卫 | **倾向「迁移残留」成立，可删**。两份 shared 文件的出口只有 `index.ts:2-6`，而 `index.ts` 因 `ui-labels` 必须留。施工形态：删 `config-forms/shared/{depth-slice,application-model-id}.ts` 两个文件 + 删 `index.ts:2-6` 五行 + 删/改 `duplicate-export-consistency.test.ts`（它现在断言的正是不该存在的那份重复）+ rebuild core + 跑 mobile 测试。**这条必须由用户确认「共享形态不是为分端裁剪产物」**——`config-forms/shared` 是 `package.json:105` 的正式子路径，动它等于动对外子路径清单 |
| **4** | D-106/D-107 后 `shared/logic/chat.ts` 的 tail-batch 连锁 | 已给出确定答案：apps 侧那 9 个符号在 `apps/desktop` 的命中**只有** `chat.ts` 自身转出 + 两个待删文件，6 个 desktop 测试文件**零引用**；core 侧 `public/chat.ts` 仍转出且被 `public-chat-allowlist.json` 快照锁住 | **原表的问句成立但风险被高估了**：删 D-106/D-107 不会让任何测试变红，core 快照也不受影响。连锁只是「`chat.ts` 14 行转出变可摘」，属于低风险顺手项。**D-304（MESSAGES_TRUNCATE_AFTER）实测现在就已经零 renderer 调用**，与 D-106/107 无因果关系，可独立处理 |
| **5** | D-102 的「文案占位价值」（apm memory 提到的三处 hint） | 三处 hint 已全部定位：**①`AgentDefinitionEditorForm.tsx:620`**（待删文件自己）、**②`AgentEditorView.tsx:822`**、**③`apps/mobile/src/components/agent/agent-editor/AgentEditorToolsSection.tsx:66`**，文案都是「未配置时使用全部内置工具（11 个）」 | **确认 D-102 可删，且是纯文档事项**：三处里有两处（②③）活着，删掉①之后 hint 从三处变两处，只要在 `docs/apm/memory/20260825-*` 那条把「三处」改成「两处（desktop AgentEditorView / mobile AgentEditorToolsSection）」。**代码零改动**，D-102 可以留在批次 1 |
| **6** | `infra/tokenizer/index.ts` 分类冲突（13 条到底是不是禁删） | 13 个名字（`CONTEXT_WINDOW_RULES` / `DEFAULT_CONTEXT_WINDOW_TOKENS` / `ENCODING_RETRY_TTL_MS` / `invalidate|parse|read|serialize|writeSessionApiPromptTokenEntry` / `registerTokenizerDriver` / `ResolveCurrentPromptTokensOptions` / `SessionApiPromptTokenEntry` / `setClockForTests`）逐个对 13 份快照做字面命中：**全部 NOT-IN-SNAPSHOT**。且它们的真源都在 logic 层并被**直连消费**：`agent-runner.ts:38-41` 从 `logic/session-api-prompt-token-store.js` 直引、`test/.../encoding-registry.test.ts:13-20` 从 `encoding-registry.js` 直引、`test/.../registry.test.ts` 从 `src/infra/nmtp/index.js` 直引 | **prose 错、`tierC.json` 对**：这 13 条在 `index.ts` 里是纯转发、零快照锁、零 barrel 消费者，**可以直接按 C 类删**。原报告「采信 tierC.json 但须人工确认」的保留可以解除——本报告已替它做完确认。**唯一残留风险**：`index.ts` 走的是 `export * from` 语义之外的具名块，删行时要确认没有 `export *` 兜底（实测全文件是具名 `export {}` 块，无 `export *`），故逐行删安全 |
| **7** | webview「注册表注入型」导出 | **已确认可达，不该进 backlog**：`apps/mobile/src/web/chat-transcript/webview/main.ts:8` `import {registerRenderContextMenu} from './runtime/menu/menu'`；`ui/menu/MenuOverlay.tsx:17`、`ui/render/MessageRow.tsx:9,10`、`ui/stream/StreamTail.tsx:22` 都直接 import `runtime/menu/menu` / `runtime/stream/stream` | **建议关闭争议 #7**：`menu.ts` / `stream.ts` 不是「注册表注入」而是**普通直接 import**，11 条 / 9 条导出有真实组件消费方。原报告「未逐个确认」的缺口已补上，**这两处不进任何删除批次** |
| **8** | 两份 raw 都未实跑编译/测试 | 本轮同样**未跑** `tsc` / `npm test`（只读纪律）。另发现一条新风险：`packages/core/dist` 存在但是**旧的**（2026-10-01 02:34），mobile jest 30+ 条 `moduleNameMapper` 直连 `dist/**` | **维持原判并加一条硬前置**：批次 2/3 开工前必须①`npm run build -w @novel-master/core` ②`tsc --noEmit -p packages/core` ③双端 `npm test`。**在 rebuild 之前跑 mobile 测试得到的任何失败都不可归因**。D-207（改 `tsconfig.test.json` 路径映射）、D-209（ambient d.ts）、D-316（子路径 barrel）三条是编译红风险最高的三条 |

---

## 6 · 批次 1 开工条件（结论）

**批次 1 具备直接开工条件。** 16 条里 14 条零连带、2 条（`D-101` 的理由改写、`D-116` 的动作二选一）需要先按本报告修正施工单。开工前把 backlog 的批次 1 表改成下面这版即可：

| ID | 修正后动作 | 附带必做 |
|---|---|---|
| D-101 | 删 `apps/desktop/scripts/fix-settings-utf8.mjs`（547 行） | 理由改写为「静默回退工作区，非 ENOENT」；建议在 CHANGELOG 记一笔，因为有人可能已经跑过它 |
| D-109 | 删**整个** `apps/cli/src/vfs/errors.ts`（28 行，4 个导出 `:4 :5 :7 :20`） | 不要动 `apps/cli/src/cli-errors.ts`（`main.ts:23-27` 活引） |
| D-116 | **选 B1-a**：只删 `isTaskToolUse`（`:33-37`），保留 `resolveSubagentSessionId` 与 `ToolUseBlock`/`ToolResultBlock` 转出 | 若坚持连 `resolveSubagentSessionId` 一起删，则必须同批删 `subagent-meta-passthrough.test.ts:8,:64-75`，此时 D-116 性质等同批次 2 |
| 其余 13 条 | 按原表执行 | D-114 顺手删 `vfs-path-mapper.ts:187` 的注释；D-105/D-108 的连带（D-301/D-303）只登记、**不在批次 1 施工** |

批次 1 跑完的验收线：`tsc --noEmit`（core / desktop / mobile 三包）+ `npm test`（core / desktop / mobile 三包）全绿。**本报告没有实跑这些命令**，这一条是开工时的义务，不是已完成的验证。

---

## 7 · 复核过程中发现的、原表未登记的问题

1. **`packages/core/dist` 存在且已过期**（原报告称不存在）→ mobile 测试的失败信号在 rebuild 前不可信（争议 #8 的加强理由）。
2. **全仓 13 包全 `private: true` + `version: 0.0.0`，无 `npm publish`** → 这是争议 #1 的直接证据（§5 #1）。
3. **`ipcMessagesHideRange` / `ShowRange` / `TruncateAfter` 现在就零 renderer 调用**，与 D-106/D-107 无因果关系；原表把 D-302/D-304 挂在 D-106/D-107 后面属挂错因（§5 #4）。
4. **`D-305` 实测 20 条而非 22 条**，且这 20 条连测试都没引（§4）。
5. **争议 #2 里 `AgentSession.hideRange` 的「intentional 注释」不存在**（§5 #2）。
6. **争议 #7 的 webview 模块是普通直接 import，不是注册表注入**，可达，建议关闭（§5 #7）。
7. **`config-forms/shared` 是 `package.json:105` 的正式对外子路径**，D-316 动它等于动子路径清单，风险等级高于原表标注（§5 #3）。
8. 根目录存在 4 个空目录 `(echo`、`exist`、`OK)`、`if` —— 历史 Windows shell 转义事故产物，`git status` 里不显示（空目录不入库），但会干扰 `dir /b` 与后续脚本。**建议单独清理**，不在本次 CR 范围。

---

*本报告只读产出：未执行任何 git 写操作，未写 `docs/apm/`。临时脚本在 `tmp/w6/`（已被 `.gitignore` 覆盖）。*