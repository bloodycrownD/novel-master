---
zone: fix-spec/wave-d
agent: reviewer（readonly · spec-check-loop 第 1 轮）
files_scanned: fix-spec/wave-d.md（1200 行全文）、ledger-v2.md（§2.9/§3/§7 ★4 #12/§10）、docs/apm/RULE.md、synth/dead-backlog.md（附录 A.1~A.4）
review_target: wave-d 组 C = 死通道 8 条 + 3 条 blocked ★4 batch 通道 + 批次 3 三组新目标 + dead 债务池抽验
baseline: feat/repo-mega-cr @ fe79b781（`git rev-parse` 实测确认）
---

# sr1-d-c · Wave D 分片只读审查（组 C）

## 摘要

组 C 的行号质量很高：**§5 死通道 8 条的四处同步点、§6 三条 batch 通道的四处同步点、
`shared/logic/chat.ts` 的 15 个悬空符号、三组新目标的每一个 `file:line`，本轮逐条重新打开
`fe79b781` 核对，除下表列出的偏差外全部命中**。撰写机位自称「撰写轮重新核对、不照抄台账」属实。
两处编译级 must-fix（漏删 import 行，`noUnusedLocals: true` 下必红）与一处后果条款的引用行号错误，
连同一批债务池的可执行性抽验发现，构成 No-Go。

---

## 1 · 逐条 verdict 表

verdict 口径：**PASS** = 七要素在位可施工；**MUST-FIX** = 照 spec 施工会编译红或验收不可测。

### 1.1 死通道 8 条（§5.1 表格 + §5.2 逐条施工单）

| # | 条目 | 行号核对（实测 `fe79b781`） | verdict | 依据 / 缺口 |
|---|---|---|---|---|
| 1 | `PROJECTS_GET_AGENT_CONFIG` | `ipc-types.ts:28` ✓ `handler-registry.ts:235` ✓ + import `:144` ✓ `invoke-registry.ts:204-207` ✓ `client.ts:50` ✓ `handlers/projects.ts:81` ✓ | **PASS** | renderer 零调用实证（`git grep -rn ipcProjectsGetAgentConfig -- apps/desktop` 只命中 `client.ts:50` 与 `invoke-registry.ts:204`）。handler 的 `@deprecated …兼容外部脚本调用` 注释原文见 `handlers/projects.ts:79`，拍板项 #8 的反驳成立。测试 `projects-agent-config-handlers.test.ts` 实测 3 个 `it(`、6 处调用（`:31/:54/:65/:87/:92`）全部围绕这两个 handler ⇒ 「必须与死通道 2 同 commit 删」的判断正确 |
| 2 | `PROJECTS_UPDATE_AGENT_CONFIG` | `ipc-types.ts:29` ✓ `handler-registry.ts:237-238` ✓ + import `:147` ✓ `invoke-registry.ts:208-211` ✓ `client.ts:51` ✓ `handlers/projects.ts:96` ✓ | **PASS** | 同上；`handlers/projects.ts:92-108` 全文为 no-op（恒返回 `{mode:"follow"}`），删净无行为变化 |
| 3 | `SESSIONS_GET_AGENT_BINDING` | `ipc-types.ts:39` ✓ `handler-registry.ts:253` ✓ + import `:158` ✓ `invoke-registry.ts:240-243` ✓ `client.ts:59` ✓ `handlers/sessions.ts:174` ✓ | **PASS**（nit → M9） | 写侧反向守卫核实：`ipcSessionsSetAgentBinding` 有活消费方 `renderer/features/chat/SessionDetailDrawer.tsx:625` ✓。测试实测 4 个 `it(`、读侧调用正好 3 处 `:74/:97/:317` ✓，与 spec 写的行号全对 |
| 4 | `VFS_LIST` | `ipc-types.ts:48` ✓ `handler-registry.ts:263` ✓ + import `:178` ✓ `handlers/vfs.ts:112` ✓ | **PASS** | **§7 修正 #5 实证成立**：`git grep -rn ipcVfsList -- apps packages` 零命中 ⇒ 确实无 `invoke-registry` 封装、无 `client.ts` 再导出，「三处而非四处」正确。取代通道有活消费方：`WorkspaceTree.tsx:94/:95`、`ChatComposer.tsx:189`、`FileReferencePicker.tsx:65` |
| 5 | `WORKPLACE_CAPTURE_SESSION_BLOCK` | `ipc-types.ts:80` ✓ `handler-registry.ts:293-294` ✓ + import `:193` ✓ `invoke-registry.ts:272-275` ✓ `client.ts:68` ✓ `handlers/workplace.ts:143` ✓ | **PASS** | 测试核实精度高：`workplace-handlers.test.ts` 实测 5 个 `it(`，import 在 `:13`，调用 `:207` 落在 `:189` 那个 `it("遗留 captureSessionBlock IPC …")` 内 ⇒ 「删 :13 + 删 :207 所在的那 1 个 it，其余 4 个不动」逐字可执行 |
| 6 | `SMART_SORT_RULE_EXPORT_RULES` | `ipc-types.ts:159` ✓ `handler-registry.ts:415` ✓ `invoke-registry.ts:589-591` ✓ `client.ts:149` ✓ `handlers/smart-sort-rule.ts:154` ✓ | **MUST-FIX（M1）** | **修法漏 import 行**：`handler-registry.ts:96` `handleSmartSortRuleExportRules,` 未列入删除清单。`apps/desktop/tsconfig.json` extends `tsconfig.base.json`（`noUnusedLocals: true`）且 `include: ["src/main/**/*"]` ⇒ 留下孤儿 import 即 TS6133 编译红 |
| 7 | `SMART_SORT_RULE_IMPORT_RULES` | `ipc-types.ts:158` ✓ `handler-registry.ts:416` ✓ `invoke-registry.ts:593-596` ✓ `client.ts:150` ✓ `handlers/smart-sort-rule.ts:166` ✓ | **MUST-FIX（M1）** | 同上，漏 `handler-registry.ts:97`。另注：spec 写的 handler 实现只给了文件名没给行号，建议补 `:154`/`:166` |
| 8 | `SKILLS_EDIT` | `ipc-types.ts:170` ✓ `handler-registry.ts:429` ✓ `invoke-registry.ts:629-632` ✓ `client.ts:159` ✓ `handlers/skills.ts:133` ✓ | **MUST-FIX（M1 + M10）** | 漏 `handler-registry.ts:113`。`⚠ core 的 editSkillFile 必须保留` 的**结论正确**（实证 `packages/core/src/domain/tool/builtin/skill-tool.ts:553` 在用），但出处引文不准 → M10 |

**口径条目（§5.5）**

| 条目 | 核对 | verdict |
|---|---|---|
| `VFS_START_DRAG`「send 型四段链路完整、非断链」 | 实证四段齐全：`preload.ts:71-73`（`ipcRenderer.send`）→ `handler-registry.ts:280-282`（注释明写「须在 drag 流程中同步触发，使用 send 而非 invoke」）→ `handlers/vfs.ts:443 startDragExport` → 失败回推 `vfs.ts:450` → renderer `client.ts:256` + `workspace-batch-dnd.ts:92`。**不进 `invoke-registry` 是设计如此，表述正确** | **PASS**（nit → M8） |
| `preload.inWindowMenuBar` 残骸 | 实证 `preload.ts:18`（类型）+ `:43`（`inWindowMenuBar: false`），renderer 零读取 ✓ | **PASS** |

**级联（§5.3 / §5.4，本轮顺带核）**：D-301 前置（D-105+D-204）、D-303 前置（D-108）与
`SHELL_SET_TITLEBAR_THEME` 不可同删（`ThemeProvider.tsx:55` 活消费）三条写法自洽，无异议。

### 1.2 三条 batch 通道 · `blocked-by-decision(★4)`（§6）

| 项 | 核对 | verdict |
|---|---|---|
| 四处同步点 | `ipc-types.ts:90/91/92` ✓ `handler-registry.ts:303/304/305` ✓ `invoke-registry.ts:368-371/372-375/376-379` ✓ `client.ts:92/93/94` ✓；`git grep -rn "ipcMessagesHideRange\|ipcMessagesShowRange\|ipcMessagesTruncateAfter" -- apps/desktop` ⇒ 只命中 `invoke-registry.ts` 定义行与 `client.ts:92-94` 再导出，**零调用点** ✓ | **PASS** |
| 案 B（默认案）：真死删 + 清悬空符号 | `shared/logic/chat.ts` 15 个符号行号**逐条实测全对**：`:30 :32 :33 :34 :49 :50 :51 :52 :53 :76 :77 :101 :102 :108 :109` ✓。「唯一 desktop 消费者是 D-106/D-107」实证成立——全仓这 15 个名字只落在 `renderer/features/chat/transcript-selectable-role.ts`、`shared/logic/chat.ts`、mobile 同名死文件、core 两个 logic 实现 + 两个 core 测试 + `public/chat.ts` + 快照 allowlist。core 侧不动正确（`public-chat-allowlist.json` 锁定）。**代价条款写清**（core 的 `hideRange`/`truncateMessagesAfter` 仍在，重接成本是桌面侧三段包装） | **PASS** |
| 案 A（保留通道 + 补 UI） | 后果三条写清。**S-D-07 病灶实证成立**：`message-transcript-effects.service.ts:63-77` 的 `truncateMessagesAfter` 事务内只调 `truncateTailInTransaction`，全文件 `invalidateSessionApiPromptTokenEntry` 只出现在 `:12`（import）与 `:186`（`setMessageFloorAtMessage` 路径），`invalidateToolUseCount` 在本文件零出现 ⇒ 双失效确为遗漏。`⇒ P2 升 P1` 的论证链完整 | **MUST-FIX（M2 + M3 + M4）** |

### 1.3 三组新目标（§4.7）

| 目标 | 核对 | verdict |
|---|---|---|
| ① `AgentDefinitionEditorForm.tsx` | **亲自 grep 验证**：PowerShell `(Get-Content).Count` = **1047**（台账/ledger 写 1048 = `wc -l` 口径差，spec §0.2 事实 1 已登记该口径，非错）。`git grep -rln AgentDefinitionEditorForm -- apps packages examples scripts .github` ⇒ **只命中文件自身**，代码零 importer 成立 | **PASS**（nit → M11） |
| ② webbridge 死协议 + `menu-overlay-guards.ts` + 两个常量 | 全对，见 §2.2 专项 | **PASS**（nit → M7） |
| ③ `validate-prompt-blocks.ts` + `PromptBlock` | 全对，红线守住，见 §2.3 专项 | **PASS**（nit → M7） |

**逐条 verdict 计数：PASS 12 / MUST-FIX 4**（死通道 6、7、8 + §6 案 A 修法条款）。

---

## 2 · 三组新目标专项核验

### 2.1 目标① · `AgentDefinitionEditorForm.tsx`（1048 行零引用）

- **行数**：实测 1047（PowerShell 口径）。ledger §10 批次 3 与 dead-backlog D-102 行写 1048，spec 写 1047 并在 §0.2 事实 1 登记「含 D-102 的 1047」⇒ **口径差异已被 spec 显式登记，不算缺陷**。
- **零引用**：`apps packages examples scripts .github` 全域只命中文件自身 ⇒ 成立。
- **重复登记问题（§7 修正 #1）**：spec 裁定「只做一次，归批次 1 的 D-102，批次 3 只登记」——
  若两处都施工，2236 与 ≈386 两处对账都会多算 1047 行。裁定正确，**judge 须确认**。
- **对抗分歧留痕完整**：w9-desktopfeat-pro-1 给 P1 × adv-C-1 给 P2，裁决 `mitigated` 降 P2，且
  「若用户拍板要接回去复用则撤下移入 Wave E」的退路写清了 ⇒ 符合 PLAN 第三章「决策感知」。

### 2.2 目标② · webbridge 死协议 + `menu-overlay-guards.ts` + 两个常量 — **撰机位的修正成立且重要**

**（a）死协议项**

| 项 | spec 证据 | 实测 |
|---|---|---|
| `messagePatch` | `ChatTranscriptBridge.ts:189` | ✓ 逐字一致。`git grep -rn messagePatch -- apps packages` ⇒ **仅 3 处**：`:189` 类型声明 + `web/composer-input/webview/runtime/bridge.ts:67` 注释 + `runtime/model.ts:6` 注释。**无发送方、无处理方** |
| `log`（transcript） | `ChatTranscriptBridge.ts:254` | ✓ 在 `TranscriptToHostMessage` 联合内，`BridgeEnvelope<'log', …>` 占 `:253-256` 共 4 行，spec 的删 4 行口径精确 |
| `log`（rich-document） | `RichDocumentBridge.ts:88` | ✓ 占 `:87-90` 共 4 行 |
| 无处理方 | `case 'log'` / `=== 'log'` 零命中 | ✓ `git grep -rn "'log'" -- apps/mobile/src` ⇒ 仅两处类型声明；测试目录命中的 4 处全是 `console.log` spy，无协议消费者 |
| 测试零引用 | 两个 bridge 测试不引用 | ✓ `git grep -rn "messagePatch\|'log'" -- apps/mobile/__tests__ apps/desktop/test` ⇒ 零协议命中 ⇒ spec「不改这两个测试文件」成立 |

**（b）`menu-overlay-guards.ts`**

- `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` 实测 **35 行** ✓，
  `shouldCancelLongPressForMove` 在 `:13` ✓；`__tests__/menu-overlay-guards.test.ts` 实测 **55 行 / 3 个 `it`**（`:9/:24/:33`）✓。
- 生产零消费成立：全仓这两个函数名只落在本文件与自己的测试 ✓。
- **退役出处措辞准确（§7 修正 #8 核实通过）**：`bind-shell-events.ts:4` 原文
  「消息菜单由气泡右上角 ⋯ 触发（`openContextMenuFromAnchor`），不再绑定长按开菜单。」——这才是
  「长按开菜单已退役」的**直接出处**；`docs/apm/RULE.md:11` 记的是 Android 小米/HyperOS 批注划词菜单
  hold（原文：「**小米/HyperOS 上批注划词菜单不可用（2026-09-28 四轮调查定案，用户拍板 hold 不适配）**」），
  属同族旁证。spec 明确写「RULE 不是直接决策记录、引用时须按此措辞」⇒ **处理正确，未把 RULE 误当决策源**。

**（c）⚠ `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` —— 任务点名的这条修正，核实结论：修正成立，处置正确**

- 它「怎么个不死法」：**它不是「只在死文件里」的那种死**。常量本体在
  `apps/mobile/src/web/shared/constants.ts:20-21`（注释 + 声明），而
  `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts:7-19` 是一个**活文件**的
  `export {…} from '../../web/shared/constants'` 块，`:12` 就在这个块里把
  `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 再导出了一次。而该文件的 `import` 块（`:20-30`）**不含**它，
  函数体（`anchoredMenuMaxHeight`/`layoutAnchoredMenuInternal`/`computeAnchoredMenuWidth`）也**零引用**它
  —— 且该文件头部第 3 行自称「**数值常量真源**：`src/web/shared/constants.ts`」，视觉上极像在用。
- 全仓 `git grep -nw ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` ⇒ **只有这两处**（`constants.ts:21` 定义 +
  `anchored-menu-layout.ts:12` 再导出），连 RN 侧 `components/chat/anchored-menu-layout.ts` 的转出也没有实际消费者
  ⇒ 严格说是**「经再导出链的死值」**，不是活码。
- **spec 的处置（两处同删）正确且必要**：只删 `constants.ts:20-21` 而留下
  `anchored-menu-layout.ts:12`，那一行就成了指向已删符号的悬空导出 ⇒ `tsc` 直接红。
  spec 把它写进「风险 2」并要求同批处理，判断准确。
- **反向守卫核实通过**：`MENU_OPEN_GRACE_MS`（`constants.ts:10`）是**活的**——
  `web/chat-transcript/webview/runtime/menu/menu.ts:1` `import {MENU_OPEN_GRACE_MS} from '@web/shared/constants';`
  + `:199` `Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS`，另有
  `__tests__/chat-transcript-boot-script.test.ts:17/:93/:261` 三处断言（`:93` 断言源码常量、`:261` 断言 boot 产物含
  `var MENU_OPEN_GRACE_MS = 400;`）。台账 #12 原话「语义被手写内联在 `menu.ts:194-202`」**只对谓词成立**，
  spec 拒绝照抄并加「反向守卫：严禁跟着删」⇒ **正确拦下了一个会改变宽限行为的误删**。

### 2.3 目标③ · `validate-prompt-blocks.ts` + `PromptBlock` — **红线守住**

| 检查 | 实测 | 结论 |
|---|---|---|
| 行数 | `validate-prompt-blocks.ts` = **178** ✓；`test/prompt/validate-prompt-blocks.test.ts` = **215** ✓、**13 个 `it(`** ✓；`prompt-block.ts` = **26** ✓ | 全对 |
| 生产零消费 | `git grep -rn "validate-prompt-blocks\|validatePromptBlocks" -- apps packages` ⇒ `src` 侧只有本文件，其余全是那个测试文件 | 成立 |
| `PromptBlock` 唯一消费者 | `git grep -nw PromptBlock -- packages/core/src` ⇒ 只有 `validate-prompt-blocks.ts`（`:2 :9 :67 :142 :146 :157`）+ 定义 `prompt-block.ts:14` + **JSDoc 提及** `agent-prompt-layout.ts:80` `{@link PromptBlock}` | 成立，且 spec 已把 `:80` 单列为「顺带改 JSDoc」，无遗漏 |
| `PromptBlockRole` 消费者 | `validate-prompt-blocks.ts:11/:14/:36/:86/:98` —— spec 写的 5 个行号**逐一命中** | 成立 |
| 🔴 **`PromptBlockLifecycle` 红线** | `prompt-block.ts:11` 定义；**两处 import 仍在**：`validate-agent-prompt-layout.ts:14`、`agent-prompt-layout.ts:7`（另有 `:25/:42` 在用） | **红线未被踩**；spec 的「不能整文件删」判断正确 |
| 快照面中性 | `git grep -nw "PromptBlock\|PromptBlockRole\|validatePromptBlocks" -- packages/core/test/package-exports/snapshots` ⇒ **零命中**；`public/prompt.ts` 只转出 `Persist/Dynamic/…PromptBlock`（不同名），**不转出 `prompt-block.js`** | 「快照面中性」核实通过 |

**边界判断**：删掉的是 `PromptBlock`/`PromptBlockRole` 这条**已退役的校验路径**，活着的校验是
`validateAgentPromptLayout` 家族。spec 额外写明「⚠ 不要为删掉一整套校验补新测试——活着的等价物已有自己的测试，
补测试等于给死路径续命」，以及与 Wave B 的 N-P1-02 同波施工时须在提交信息写明区分 ⇒ 与 RULE 口径对齐，无异议。

---

## 3 · dead 债务池抽验表

**口径**：池 = `synth/dead-backlog.md` 附录 A 的 core C 类 363 条，扣除 spec §4.1 已先行施工的 15 条
⇒ 剩余 **348 条**（批次 3 主清单）。抽验 **58 个符号 + 6 个文件 = 池的 16.7%**（≥10% 达标）。
抽验维度按 PLAN 第四章第 12 条：**定级合理 / 无重复 / 无已修**。

| 档 | 抽样 | 无已修 | 无重复 | 定级/可执行性 | 命中问题 |
|---|---:|---|---|---|---|
| **A.1 整文件可删** | 6/6 文件 | ✓ 六个文件全部仍存在 | ✓ | ✓ 合理 | 0 |
| **A.2 整段删除** | 21 符号 / 30 文件 | ✓ 全部仍在 `fe79b781` | ✓ | ⚠ **3 类问题** | 见下 D-1/D-2/D-3 |
| **A.3 删 barrel 转发行** | 11 符号 / 11 文件 | ✓ | ✓ | ❌ **6/11 落在快照锁定面** | 见下 D-4 |
| **A.4 只摘 export** | 26 符号 / 26 文件 | ✓ | ✓ | ✓ 快照面全干净（26/26 零命中） | 0 |

### D-1（P2）`infra/tdbc` 四符号是**硬阻断**，台账把它们列为可执行条目

抽样发现 `TdbcErrorCode`、`ParsedTdbcUrl`（A.2「删符号段」）与 `executeTemplate`、`parseUrl`
（A.3「删 barrel 转发行」）四条，全部经由同一个 barrel 进入 **core 根导出面**：

```
packages/core/src/index.ts:31   parseUrl,        ┐
packages/core/src/index.ts:37   executeTemplate, │ 来自
packages/core/src/index.ts:40-50 TdbcErrorCode,  │ "./infra/tdbc/index.js"
                                 ParsedTdbcUrl,   ┘
packages/core/src/infra/tdbc/index.ts:14  export { open, parseUrl } from "./logic/open.js";
packages/core/src/infra/tdbc/index.ts:23  export { executeTemplate, queryTemplate } from "./logic/template-helper.js";
```

删 `infra/tdbc/index.ts` 的这四行 ⇒ `packages/core/src/index.ts` 编译红；且 `parseUrl`/`executeTemplate`
本身就在 `snapshots/main-entry-allowlist.json:60/:78` 里 ⇒ 连带 A 类快照面。
**这正是 F-synth-dead-1 描述的桶定义缺陷（`testOnly` 未排除 `relayed`）在 A.2/A.3 档的复现。**

### D-2（P3）A.2 档把「barrel 转出」误分到「整段删除」档

抽样中 `EnvSecretStoreLike`（定义在 `infra/sksp/impl/composite-secret-store.ts:10`，`sksp/index.ts:31` 只是 re-export）、
`VfsZipIoService`（定义在 `domain/vfs/ports/vfs-zip-io.port.ts:24`，`service/vfs/vfs.port.ts:16` 是 re-export）、
`VfsEntryKind`（定义在 `domain/vfs/model/vfs-entry.ts:12`，`vfs-entry.port.ts:320` 是 `export type {…} from`）——
三条的真实动作都是「删一行 re-export」，属 A.3 档，被登记在 A.2「整段删除（文件仍被引用）」档。
后果不是编译红（已逐条确认无 barrel 内消费），而是**执行时按 A.2 的「删符号段」动作会误删到定义本体**。

### D-3（P2）「已核实为死但结论相反」的两条反向修正（本轮证伪撰写机位一处判断）

撰写机位在 §4.6 高杠杆清单里把 `infra/tdbc/index.ts` 列为「摘 8 / 转出 9」的优先批。
实测该 barrel 的 9 个转出里有 2 个（`executeTemplate`/`parseUrl`）被根 barrel 消费并被快照锁定 ⇒
**该文件不应进 B3-b 首批**。同档 `infra/tokenizer/index.ts`（摘 13 / 转出 35 行）里
`TOKEN_COUNTER_MODE_PREF_KEY` 同样命中 `public-provider-allowlist.json:19` 且被 `public/provider.ts:213` 转出
⇒ **「13 条全 NOT-IN-SNAPSHOT，可删」（争议 #6 结清结论）至少对这一条不成立**。
这条不影响 execute-readiness（§4.3 第 3 步会在执行时把它出批），但会让 B3-b 首批大面积出批。

### D-4（P2）A.3 档 6/11 抽样符号落在快照锁定面（A 类，★1 未拍前禁删）

| 符号（附录 A.3 登记为「B3 删 barrel 转发行」） | 实际快照命中 |
|---|---|
| `executeTemplate` | `snapshots/main-entry-allowlist.json:60` |
| `parseUrl` | `snapshots/main-entry-allowlist.json:78` |
| `DEFAULT_HIDE_START_DEPTH` | `snapshots/public-compaction-allowlist.json:3` |
| `layoutHasWorkplace` | `snapshots/public-prompt-allowlist.json:13` **且** `snapshots/public-workplace-allowlist.json:17` |
| `messageBodyTextFromBlocks` | `snapshots/public-prompt-allowlist.json:15` |
| `formatApplicationModelId` | `snapshots/public-provider-allowlist.json:42` |

A.3 干净的部分：`CONTEXT_WINDOW_RULES`、`registerTokenizerDriver`、`assertValidRef`、
`markSchemaMigrationApplied`、`ReleaseNotesFocus`、`TemplateParser`（6/11 零快照命中）。

**判定**：spec §4.2 的 ★1 前置门与 §4.3 第 3 步（「快照命中 ⇒ 该条出批」）在**流程上已经拦得住**，
所以这不构成 spec 的可执行性缺陷；但它说明**债务池的「可执行清单」在 ★1 拍板前不能直接当施工单用**，
`348 条` 的预估会明显缩水。回写建议已进 §4 must-fix（M5）。

---

## 4 · must-fix 清单

| # | 级别 | 位置 | 问题 | 建议改法 |
|---|---|---|---|---|
| **M1** | **P1（阻塞）** | §5.2 死通道 6 / 7 / 8 的「修法」 | 漏删 `handler-registry.ts` 的 import 行：`:96 handleSmartSortRuleExportRules,`、`:97 handleSmartSortRuleImportRules,`、`:113 handleSkillsEdit,`。`apps/desktop/tsconfig.json` extends `tsconfig.base.json`（`noUnusedLocals: true`，已读文件确认）且 `include: ["src/main/**/*"]` ⇒ 照现文施工必得 TS6133 编译红 | 三条「修法」各补 `+ import :96/:97/:113`；§5.1 表格 6/7/8 行的 ② 列同步补 `（import :96/:97/:113）` |
| **M2** | **P1（阻塞）** | §6.2 案 B 修法第 1 段 | 「删上表 12 个同步点（3 通道 × 4 处）+ 三个 handler 实现」漏了 `handler-registry.ts:126/:132/:133` 三行 import（实测：`handleMessagesHideRange,` / `handleMessagesShowRange,` / `handleMessagesTruncateAfter,`），同样触发 `noUnusedLocals` 编译红 | 修法第 1 段补「+ `handler-registry.ts:126/:132/:133` 三行 import」；§6.1 事实基线表同步补 import 列 |
| **M3** | P2 | §6.3 案 A 后果① | 引用行号错：写「`message.service.ts:459/490` 都做了双失效」。实测 `:459` 落在 `updateHiddenRange` 的 `updateHiddenRange(sessionId, fromSeq, toSeq, …)` 实参里；真正的双失效在 **`message.service.ts:500-501`**（`await this.invalidatePromptTokens(sessionId); await this.invalidateToolUseCount(sessionId);`，属 `truncateAfter` 的 null-anchor 分支）。PLAN 第四章第 8 条要求撰写轮重新核对行号 | 改为 `:500-501`，并可补一句「core 侧存在**两条平行截断实现**（`message.service.ts:468 truncateAfter` 有双失效、`message-transcript-effects.service.ts:63 truncateMessagesAfter` 没有）」——这比原文更直接地支撑「遗漏而非取舍」 |
| **M4** | P2 | §6.3 案 A 后果② / §8 ★2 的 D-314 | 「`AgentSession.hideRange` 生产零调用，唯一调用者是 `packages/core/test/agent/agent-session.test.ts:26`」**不完整**。实测生产侧确实零调用 ✓，但测试侧有 **3 处、2 个文件**：`agent-session.test.ts:26`、`agent-session.test.ts:67`、`packages/core/test/service/agent/read-ref-production-smoke.test.ts:183` | 补齐 3 处 / 2 文件；否则按现文删 D-314 会让 `read-ref-production-smoke.test.ts` 编译红 |
| **M5** | P2 | §4.1 清单来源表 + 债务池（§3 D-1/D-3/D-4） | 债务池「可执行清单」在 ★1 拍板前不可直接当施工单：① `infra/tdbc/index.ts` 四符号（`TdbcErrorCode`/`ParsedTdbcUrl`/`executeTemplate`/`parseUrl`）经 core 根 barrel 消费且落快照；② A.3 抽样 6/11 落快照；③ §4.6 把 `infra/tdbc/index.ts`、`infra/tokenizer/index.ts` 列为高杠杆首批，但两文件都有快照命中项 | 三处各加一句「★1 拍板前，这 N 条只作线索、不进首批」；`348` 的行数/条数预估标注「含待出批项」 |
| **M6** | P3 | §5.1 表格 | 6/7/8 三行的 ② 列缺 import 行号（1/2/3/4/5 行都有），与 M1 同源 | 同 M1 一并补 |
| **M7** | P3 | §4.7 目标② 验收⑥ / 目标③ 修法③④验收⑦ | 行数对账偏差：目标②「9（两个常量的注释+声明）」实测是 `constants.ts` 4 行（`:12-13` + `:20-21`）+ `anchored-menu-layout.ts:12` 1 行 = **5 行** ⇒ 净减 108 应为 **104**；目标③「从 26 行缩到约 11 行」摘的是 `:7-8`(2) + `:13-26`(14) = 16 行 ⇒ 缩到 **10 行**，净减 408 应为 **409** | 两处数字改正（spec 自己在 §7 修正 #4 为 10/15 的行数纠错过一次，口径应统一） |
| **M8** | P3 | §5.5 | 通道名写错：`push 失败通道 vfs-start-drag-failed` 这个字符串在仓库里不存在。实际是常量 `VFS_START_DRAG_FAILED`、通道值 `'nm:vfs/startDragFailed'`（`ipc-types.ts:74`） | 改为 `VFS_START_DRAG_FAILED`（`'nm:vfs/startDragFailed'`），顺手可补 `preload.ts:71-73 → handler-registry.ts:280-282 → handlers/vfs.ts:443 → :450` 四段链路行号，让「非断链」这个结论可被复核 |
| **M9** | P3 | §5.2 死通道 3 测试策略 | 「逐 `it` 判定归属」方向对，但漏点出关键细节：`:43` 那个 `T-D1` 的 `it` 是**读写混合**的——读侧 `:74`/`:97` 与写侧 `:87`/`:104` 在同一个 `it` 里 ⇒ 必须**拆断言**，不能整删；`:317` 那处则在 `:245` 的 T-C2 里 | 补一句「`:43` 的 T-D1 须拆断言保留写侧四步，`:245` 的 T-C2 只删 `:317` 一行」 |
| **M10** | P3 | §5.2 死通道 8 的 ⚠ 条 | 引文不准：「RULE『技能域』条目明载」——`docs/apm/RULE.md:30` 的技能域条目**未点名** `editSkillFile`。实证依据在 `packages/core/src/domain/tool/builtin/skill-tool.ts:553` | 改为「`skill-tool.ts:553` 在用（LLM 工具），RULE『技能域』条目覆盖该域但未点名本符号」 |
| **M11** | P3 | §4.7 目标① / D-102 验收① | 验收 grep 口径只写了 `apps packages examples scripts`。实测 `AgentDefinitionEditorForm` 在 **`docs/` 侧还有 20 个文件提及**（迭代文档 + `docs/apm/memory/` 6 篇）⇒ 历史文档不必改，但验收条文应显式说明「docs 侧提及不算引用」，否则施工者可能去改 20 个文档 | 验收①补「（docs 侧 20 处历史提及不在范围，不需改）」 |

---

## 5 · 结论

**组 C 判定：No-Go**（须 doc-fix 闭合 M1、M2 两项编译级 must-fix 后转 Go；M3~M11 可同轮一并回写）。

**一句话理由**：组 C 的行号与边界判断整体扎实（死通道 8 条 + batch 3 通道 + 三组新目标的
`file:line` 逐条实测命中率极高，`VFS_LIST` 三处口径、`VFS_START_DRAG` 非断链、
`PromptBlockLifecycle` 红线、`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 两处同删、`MENU_OPEN_GRACE_MS`
反向守卫五处关键修正全部成立），但**死通道 6/7/8 与 §6 案 B 的修法都漏了 `handler-registry.ts` 的
import 行，在 `noUnusedLocals: true` 下照文施工必红**，且债务池抽样证明 A.2/A.3 档存在经根 barrel
与快照锁定面传导的误分类条目，须在 ★1 拍板前先降级为线索源。

**给 judge 的三点提示**：
1. §7 十条口径修正中，**#1 / #4 / #5 / #6 / #7 / #8 六条本轮实证成立**，可直接采信回写；
   #2（D-116 行号与净减）、#3（D-207 与 Wave E 的修法冲突）本轮未展开复核，仍需 judge 或另派机位确认。
2. **债务池的桶定义缺陷（F-synth-dead-1）不只影响 A 类，它在 A.2/A.3 两档同时存在**——
   建议把「`testOnly` 排除 `relayed` 后重跑 L0」这条 ★1 的解锁动作扩到「重跑后 A.2/A.3 两档需重新分桶」。
3. 组 C 与其它分片的**唯一跨界依赖**是 D-207 ↔ Wave E 的 `tsconfig.test.json` paths 对齐条目（§7 修正 #3），
   该条本轮未复核，建议单独派机位。

---

*本机位为 readonly reviewer：零 git 写、零 `docs/apm/` 写、零生产/测试代码与 fix-spec 改动。
唯一产物为本报告。所有 `file:line` 均在 `fe79b781` 重新打开核对，命令口径为 `git grep -n -w -o`
与 PowerShell `(Get-Content).Count`。*
