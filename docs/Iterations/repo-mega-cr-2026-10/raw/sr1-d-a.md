---
zone: wave-d / 批次 1（组 A）
agent: sr1-d-a（readonly reviewer · spec-check-loop）
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）、
  fix-spec/wave-d.md（§0-§2 批次 1 + §7 + §8）、
  fix-spec/baseline.md、ledger-v2.md（§10 Wave D + §7 + §11）、
  synth/dead-backlog.md（批次 1 节）、synth/verify-dead.md（§1-§2）、
  docs/apm/RULE.md、以及 16 个目标文件本体 + 全部连带面（grep -rln / git grep）
基线: feat/repo-mega-cr @ fe79b781（worktree D:\Dev\nm-worktree\mcr）
---

# sr1-d-a · Wave D 批次 1（D-101 ~ D-116）逐条审查报告

## 摘要

16 条死码的**存在性、行数、引文、零消费**四项本机位全部亲自复核，**16/16 成立**；
三处台账施工单修正（①D-101 理由 ②D-109 锚点 `:5` ③D-116 选 B1-a）**已全部照 ledger 落进 spec**。
但发现 **4 处 must-fix**：其中 **D-101 的删除理由仍不成立**（`verify-dead` 与 spec 双重误判）、
D-115 的「目录不删」前提为假、验收基线数字过期（424→411，spec §1 未同步 baseline.md）、
以及 D-102 的回归线引用了一个不存在的测试。**组 A = No-Go**（doc-fix 即可转 Go）。

---

## 1 · 逐条 verdict（16 条）

> 复核口径：`Get-Content .Count` 逐文件量行；`git grep -rln` 全仓定位（**含测试侧**，
> 本次额外跑了**不带 pathspec 的全仓版**以暴露 spec 未提的 docs 命中）；引文逐字读原文。

| ID | 目标 | 行数（spec / 实测） | 零消费复核 | 引文核对 | verdict |
|---|---|---|---|---|---|
| **D-101** | `apps/desktop/scripts/fix-settings-utf8.mjs` | 547 / **547** ✅ | ✅ 仅自身 `:3` 注释（另有 `docs/Iterations/config-forms-merge-into-core/spec.md:71` 一处文档提及，spec 未提但非消费方） | `:38` execSync 引文逐字一致 ✅ | **CONDITIONAL** — 死码成立、须删，但**删除理由错**（见 M-1） |
| **D-102** | `.../settings/AgentDefinitionEditorForm.tsx` | 1047 / **1047** ✅ | ✅ 全仓仅自身；**测试侧零引用**（`git grep -rn -- apps/desktop/test packages/core/test apps/mobile/__tests__` 退出码 1） | `:176` `export const AgentDefinitionEditorForm = forwardRef<` 逐字一致 ✅ | **CONDITIONAL** — 主体成立，**回归线引用不存在的测试**（见 M-3） |
| **D-103** | `.../workspace/useWorkspaceTree.ts` | 66 / **66** ✅ | ✅ 三个符号（`usePreviewSelection`/`useTreeRefreshToken`/`useTreeLoader`）全仓仅本文件 | `:7`/`:30`/`:37` 三处行号全对 ✅ | **PASS** |
| **D-104** | `apps/mobile/src/components/batch/ListBatchBar.tsx` | 56 / **56** ✅ | ✅ 全仓仅自身；测试侧零引用 | `:15` 逐字一致 ✅ | **PASS** |
| **D-105** | `.../features/chat/tool-turn-actions.ts` | 54 / **54** ✅ | ✅ `features/chat/tool-turn-actions` 全仓零命中；`ipcMessagesHide/Show/Delete` 调用点**只在本文件**（`client.ts:90-95` 再导出、`invoke-registry.ts:360-380` 封装，均非调用） | `:20` 逐字一致 ✅ | **PASS** |
| **D-106** | `apps/mobile/.../transcript-selectable-role.ts` | 49 / **49** ✅ | ✅ `transcript-selectable-role` 全仓零命中（生产+测试） | spec 写「`:16-30` 的 export 块」，实际 export 块是 **`:17-29`**（`:16` 是空行、`:30` 是 `}` 后的空行）——**偏移 1 行，轻微** | **PASS**（行号区间标注不精确，不影响施工） |
| **D-107** | `apps/desktop/.../transcript-selectable-role.ts` | 47 / **47** ✅ | ✅ 同上；`buildTailBatchRows`/`MessageBatchMode` 仅本文件 + `shared/logic/chat.ts` 转出 | `:30` `export function buildTailBatchRows(` ✅、`:27` `MessageBatchMode` ✅ | **PASS** |
| **D-108** | `.../layout/AppMenuBar.tsx` | 40 / **40** ✅ | ✅ `AppMenuBar` 全仓仅自身；`ipcShellMenuPopup` 调用点只在本文件 `:17` | `:14`/`:17` 逐字一致 ✅；`preload.ts:18/43` 的 `inWindowMenuBar` ✅ | **PASS** |
| **D-109** | `apps/cli/src/vfs/errors.ts` | 28 / **28** ✅ | ✅ `vfs/errors` 在 `apps/cli` 零命中；四个符号在 cli 侧只有 `cli-errors.ts` 那一份在用 | **`:4/:5/:7/:20` 四个锚点全部逐字核对通过** ✅（含修正 ② 补的 `:5 EXIT_RUNTIME`）；`main.ts:23-27` ✅ | **PASS** |
| **D-110** | `apps/cli/src/vfs/runtime.ts` | 24 / **24** ✅ | ✅ `vfs/runtime` 在 `apps/cli` 零命中；`createVfsRuntime` 全仓仅本文件（另 `docs/.../mobile-app-scaffold/spec.md:19` 一处历史文档提及，非消费方） | `:18`/`:13` 逐字一致 ✅ | **PASS** |
| **D-111** | `apps/mobile/src/hooks/useStreamTailGenerating.ts` | 12 / **12** ✅ | ✅ 只命中 D-111/D-112 两文件自身 | `:8` 逐字一致 ✅ | **PASS** |
| **D-112** | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | 10 / **10** ✅ | ✅ 同上 | `:8` 逐字一致 ✅ | **PASS** |
| **D-113** | `packages/core/src/common/memoize.ts` | 123 / **123** ✅ | ✅ `common/memoize` 全仓仅自身；`-w memoize` 命中本文件 + 两份 `claude.json` 词表数据（无关，与 spec 口径一致） | `:5` ` * @module common/memoize` ✅；`common/index.ts` **确认未转发**（28 行全文读过）✅；13 份快照零命中 ✅ | **PASS** |
| **D-114** | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | 74 / **74** ✅ | ✅ 唯一外部命中是 `vfs-path-mapper.ts:187` 的**注释**（非调用） | `:2` `* 物理路径反解为 scope_key + 纯逻辑路径（迁移专用）。` ✅；`vfs-path-mapper.ts:187` 逐字一致 ✅ | **PASS** |
| **D-115** | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | 21 / **21** ✅ | ✅ 全仓零命中；13 份快照零命中 | 唯一导出 `parseKkvJsonDocument` ✅ | **CONDITIONAL** — 死码成立，但**「目录仍有其它活文件」前提为假**（见 M-2） |
| **D-116** | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | 38 / **38** ✅ | ✅ `isTaskToolUse` 全仓仅自身；`resolveSubagentSessionId` **确有 1 处测试消费**：`subagent-meta-passthrough.test.ts:8` import + `:64/:66/:69/:70/:72` | `:33` 函数体 ✅；`:29-35` = JSDoc 3 行（29/30/31… 实为 **29-32 共 4 行** 含 `*/`）+ 空行 + 函数 3 行 ⇒ **删除区间 `:29-35` 正确、7 行正确**；`build-tool-result-block.ts` 的 `resolveSubagentSessionIdFromOutcome` 确认是**另一函数**（`:548` 定义，`:439` 调用） | **PASS** |

**小计：PASS 12 / CONDITIONAL 4（D-101、D-102、D-115 + 批次级基线问题）/ FAIL 0。**

### 1.1 连带面实测（每条删完会带走什么）

| ID | 连带清项 | 实测结论 |
|---|---|---|
| D-101 | 无 | ✅ 确认：`package.json` 无 script、CI 无 step。**但 `docs/Iterations/config-forms-merge-into-core/spec.md:71` 有一行历史文档提及**（不影响删除，spec 未列，可接受） |
| D-102 | 无导入方、无测试 | ✅ 但删除后 `AgentEditorView.tsx:822` 与 mobile `AgentEditorToolsSection.tsx:66` 两处 hint 文案仍活（spec 口径正确：`:620` 在死文件内随删）——三处→两处的文档同步结论**成立** |
| D-103 | 无 | ✅ |
| D-104 | 无 | ✅ `ManageHeader.tsx:74-128` 的 `batchMode` 分支确认仍在且活 |
| D-105 | 无 | ✅ 连带效应（`ipcMessagesHide/Show/Delete` 变零调用 → 触发 D-301）已登记不施工，处置正确 |
| D-106/D-107 | 无 | ✅ 连带（`shared/logic/chat.ts` 15 行转出成死）已登记、归批次 3.2，不计入本批行数，处置正确 |
| D-108 | 无 | ✅ 连带（D-303）已登记；`SHELL_SET_TITLEBAR_THEME` 有活消费方 `ThemeProvider.tsx:55`，spec 的禁删警告**成立** |
| D-109 | **禁删 `cli-errors.ts`** | ✅ 警告成立：`main.ts:25-27` 活引 `EXIT_USAGE`/`exitCodeForError`/`formatCliError` |
| D-110 | 无 | ✅ `resolveDbPath` 的真身在 `apps/cli/src/runtime.ts`，本文件只是再导出 |
| D-111/D-112 | 无 | ✅ core 侧 `computeStreamTailGenerating` + 快照 `public-chat-allowlist.json:42` 是**另一套**（core 自有），删这两个 hook 不触及 |
| D-113 | 无 | ✅ 不在快照面（`common/index.ts` 未转发） |
| D-114 | **连带删 `vfs-path-mapper.ts:187` 一行注释** | ✅ 成立，净减 75 行口径正确 |
| D-115 | 无 | ⚠ 目录前提错（见 M-2） |
| D-116 | 无 | ✅ `:37-38` 的 `ToolUseBlock`/`ToolResultBlock` 再导出**保留**正确（spec 明确不计入本批行数，处置得当） |

### 1.2 「仅测试消费」标注（本任务硬要求逐条标出）

| 符号 | 状态 |
|---|---|
| `resolveSubagentSessionId` | **仅测试消费**（`packages/core/test/tool/subagent-meta-passthrough.test.ts` 一处）。spec 已在 D-116「口径留痕」显式登记为债务池、不在本波处置 ✅ |
| 其余 15 条的目标文件/符号 | **零消费**（生产与测试双侧）。D-106/D-107 落地后新增的「仅测试消费」符号（`shared/logic/chat.ts` 的 15 个转出）已归批次 3.2，不在本批 ✅ |

---

## 2 · 三处台账施工单修正 · 抽查（ledger §10 Wave D 批次 1 格）

ledger 原文（`ledger-v2.md:475`）：
> 三处施工单修正照 v1：① D-101 理由改写为「静默回退工作区、非 ENOENT」② D-109 锚点补 `:5 EXIT_RUNTIME` ③ D-116 **选 B1-a**（只删 `isTaskToolUse`，保留 `resolveSubagentSessionId`）

| # | 修正要求 | spec 落点 | 抽查结论 |
|---|---|---|---|
| ① | D-101 理由改「静默回退工作区、非 ENOENT」 | `wave-d.md:88` | **照抄达标**——字面落进去了。但**所依据的上游判断本身有误**，理由文本仍不成立 ⇒ M-1 |
| ② | D-109 锚点补 `:5` | `wave-d.md:254` + 验收 `:258` | ✅ **完全达标**。`:5 export const EXIT_RUNTIME = 2;` 逐字核对通过，且 spec 明确「锚点漏一条不影响整文件删，但按台账要求补齐」 |
| ③ | D-116 选 B1-a | `wave-d.md:373/389-401` | ✅ **完全达标**。B1-b 作为「不采用的备选」登记差异、B1-a 四步动作清晰、验收「净减 7 行」与行数对账 2205 自洽（`2236−38+7=2205` 本机位算过 ✅） |

---

## 3 · must-fix 清单（doc-fix 照抄级）

| # | 位置 | 问题 | 证据 | 建议改法（照抄即用） |
|---|---|---|---|---|
| **M-1** | `wave-d.md:88`（D-101 病症）+ `:104`（风险与回滚） | **删除理由仍不成立**。spec 与 `verify-dead.md:61-68` 都写「脚本不会崩 / 非 ENOENT」，**实测会崩**：`fixEventsEditor()` 在 `:63` 对 `eventsPath` 做 `readFileSync(eventsPath, "utf8")`，而 **`apps/desktop/renderer/features/settings/EventsConfigView.tsx` 在当前树上根本不存在**（`Test-Path` = False；`git ls-files apps/desktop/renderer/features/settings/` 24 个文件里无它）⇒ 跑到 `main()` 的第二步必抛 ENOENT。真实行为是「**先在 `:54` 把 `AgentEditorView.tsx` 静默覆写成 2026-06 的 471 行版本（当前 1381 行，净丢 910 行），再在 `:63` ENOENT 崩**」——**先破坏后报错**，比 spec 写的「静默成功」更危险，也比台账原写的「ENOENT 崩」多了「已丢代码」这一半。<br>附：`:55` 的守卫 `includes("加载中")` **不会拦住**——`d825173` 版第 271 行是字面 `\u52a0\u8f7d\u4e2d`（转义而非实字），而 `:41` 的 `fixJsxUnicodeText` 会把它解码成 `加载中` 再写盘 ⇒ 守卫通过。 | `fix-settings-utf8.mjs:54`（`writeFileSync(agentPath, readable, "utf8")`）、`:63`（`readFileSync(eventsPath, "utf8")`）、`:12`（`const eventsPath = join(root, "renderer/features/settings/EventsConfigView.tsx")`）；`git ls-files apps/desktop/renderer/features/settings/` 无 EventsConfigView；`git show d825173:...AgentEditorView.tsx` = 471 行 vs 当前 1381 行；`git diff --stat d825173 HEAD -- .../AgentEditorView.tsx` = `1852 +++++---` | 把 D-101 病症改为：**「跑一次先静默把工作区 `AgentEditorView.tsx` 覆写成 `d825173` 的 471 行版本（当前 1381 行，丢 910 行），随后 `fixEventsEditor` 因 `EventsConfigView.tsx` 已不存在而 ENOENT 崩——即『破坏先于报错』」**。§7 增一条口径修正 #11：上游 `dead-backlog.md:217` 与 `verify-dead.md:61-68` 的「非 ENOENT」判断均需订正（两者都只验了 `d825173` 的 commit/blob 存在性，**没验目标文件在当前树上是否存在**）。**删除动作与优先级不变**（仍建议全批第一条） |
| **M-2** | `wave-d.md:364`（D-115 修法·连带清） | **前提为假**。spec 写「`infra/kkv/logic/` 目录仍有其它活文件，目录不删」——实测该目录下**只有 `parse-kkv-json-document.ts` 这一个文件**（`Get-ChildItem -Recurse` 返回 1 个文件）。删完目录即空。 | `Get-ChildItem -Recurse packages/core/src/infra/kkkv` → 仅 `logic/parse-kkv-json-document.ts`；`git ls-files packages/core/src/infra/kkv/logic/` 单行 | 改为：**「连带清：删文件后 `packages/core/src/infra/kkv/logic/` 目录变空，随之消失（git 不跟踪空目录，无需额外动作，但 PR 描述里要提一句）」** |
| **M-3** | `wave-d.md:125`（D-102 回归线） | **回归线引用了不存在的测试**。spec 写「桌面端智能体编辑的加载/保存/dirty 守卫用例全绿（`AgentEditorView` 相关）」——实测 desktop 测试面**唯一**触及 `AgentEditorView` 的是 `apps/desktop/test/settings-agents-tabs.test.ts`，且它只做**源码文本断言**（`agentEditorPath` 拼路径 + `readFileSync` 正则匹配），**不是**渲染/保存/dirty 守卫用例。「加载/保存/dirty 守卫」在 desktop 侧**无对应测试文件**。 | `git grep -rn "AgentEditorView\|EventsConfigView" -- apps/desktop/test packages/core/test` → 仅 `settings-agents-tabs.test.ts`（其 `:22` 是路径常量、`:74` 是 `it("AgentEditorView general 只读分支…")` 源码断言、`:114` 是注释）；`git grep -rn "dirty" -- apps/desktop/test` 无智能体编辑相关命中 | 改为：**「回归线：`apps/desktop/test/settings-agents-tabs.test.ts` 全绿（唯一触及 `AgentEditorView.tsx` 的测试，源码文本断言，删死文件不影响）；desktop 其余 109 个测试文件无增量」**。⚠ `EventsConfigView` 在 desktop 测试面**零引用**，原句里的「事件配置编辑器」回归线同样无落点，一并删 |
| **M-4** | `wave-d.md:55` / `:68` / `:123`（§1.1 表 / §1.3 规则 1 / D-102 验收③） | **验收基线数字过期**。spec 三处硬写「renderer 已知红 **424** 条、`≤424` 即无新增」，但 `fix-spec/baseline.md` 已于本轮落盘（`§2.1` 实测 **411** 条，并明写「台账的 424 已过期」）且 `§8` 的 spec 自己已经引用了 411（`:1284`）。**spec 内部自相矛盾**：§1 写 424、§8 写 411。另 `baseline.md` 补了三件 spec §1 没有的事：① 根 `npm run build` 一把梭会 TS5042 失败、须逐包 build ② desktop 测试必须用带参调用 `npm test -- "test/**/*.test.ts" ...`（默认路径收 0 条假绿）③ mobile 必须 `npm test -- --maxWorkers=2` 且 `pretest` 自动重建 core（spec §1.3 规则 2 写「必须先手工 `npm run build -w @novel-master/core`」，走 `npm test` 路径时**冗余**）。 | `baseline.md:80`（T3 = 411）、`:85-88`（424→411 漂移说明）、`:265`（§4 总表 renderer = 411）、`:296-299`（§6 落地提醒 1/3）、`:243`（mobile 命令 + pretest 说明）；对照 `wave-d.md:55,68,123` 与 `wave-d.md:1284` | §1.1 表格 renderer 行：`424` → **411**；§1.3 规则 1：`≤424` → **≤411**、`:424` → `:411`；D-102 验收③ 同步改 **411**。另在 §1 增一段 **「baseline 已落盘」提示**：验收前须逐包 `npm run build -w`（禁根 `npm run build` 一把梭，TS5042）+ 补 `build:preload -w @novel-master/desktop`；desktop 测试用 `baseline.md §3.2(b)` 的带参命令；mobile 用 `npm test -- --maxWorkers=2`（`pretest` 已含 core 重建，§1.3 规则 2 的手工前置仅对裸 `npx jest` 成立） |

### 3.1 非 must-fix 的轻微项（可留可改，不阻塞）

| # | 位置 | 说明 |
|---|---|---|
| L-1 | `wave-d.md:197`（D-106 证据） | 写「`:16-30` 的 export 块」，实测 export 块是 **`:17-29`**（`:16` 空行、`:30` 空行）。偏移 1 行，不影响施工判定（该条只作为「这是 re-export shim」的佐证）。 |
| L-2 | `wave-d.md:390`（D-116 修法第 1 步） | 「JSDoc 3 行 + 函数 3 行」表述与「7 行」不自洽——JSDoc 实为 `:29-32` **4 行**（含收尾 `*/`），加空行 + 函数 3 行 = 8 个物理行里删 7 行（`:32` 的 `*/` 与空行归属不同数法）。**删除区间 `:29-35` 与净减 7 行两个数都是对的**，只是文字分解不严谨。 |
| L-3 | `wave-d.md:88`（D-101 证据） | 「全仓唯一提及点即自身注释」不完整——`docs/Iterations/config-forms-merge-into-core/spec.md:71` 也有一行历史文档提及。不影响删除判定（文档不是消费方），但若 M-1 改写理由时可一并补上以示无遗漏。 |

---

## 4 · 七要素完备性抽检（PLAN 第四章第 8 条）

| 要素 | 批次 1 覆盖 | 备注 |
|---|---|---|
| 病症 | 16/16 ✅ | M-1、D-115 两处需改 |
| 证据（file:line + 引文，撰写轮重核） | 16/16 ✅ | 本机位逐条复核，**16 条的 file:line 与引文全部命中**（仅 D-106 区间偏 1 行，见 L-1）。**未发现照抄台账行号的条目** |
| 修法（文件·函数级） | 16/16 ✅ | D-116 的 B1-a 四步最清晰（含「保留什么/不计入什么」） |
| 验收（可测） | 16/16 ⚠ | 全部可测，但**基线数字过期**（M-4）。删除行数对账口径自洽：标称 2236、实际 2205、D-114 额外 +1 行注释 ⇒ 本批实际净减 **2206**（spec 未把 D-114 的那 1 行计入批次小结的 2205，**对账时需按 2206 走**或明示分开计） |
| 测试策略 | 16/16 ✅ | 15 条「无测试删改」+ D-116「B1-a 定义就是测试不动」，与实测一致 |
| 回归线 | 14/16 ⚠ | D-102 引用不存在的测试（M-3）；D-101 的回归线「`AgentEditorView`/`EventsConfigView` 相关测试」中 **`EventsConfigView` 在 desktop 测试面零引用**（同 M-3 一并修）。其余 14 条引用的测试面均实存 |
| 依赖 | 16/16 ✅ | 全部「依赖：无」，且级联（D-301/D-303/`shared/logic/chat.ts` 15 行）明确「本批只登记不施工」，批次 1 的「零连带」性质成立。**依赖闭合 ✅** |

---

## 5 · 结论

### 组 A 判定：**No-Go**

**一句话理由**：16 条死码的存在性、行数、引文、零消费四项本机位 16/16 复核通过、三处台账修正全部照落，
但 **D-101 的删除理由经实测仍不成立**（`EventsConfigView.tsx` 早已不在树上，脚本是「先静默丢 910 行代码、再 ENOENT 崩」，
spec 与 `verify-dead` 写的「非 ENOENT / 静默成功」双重误判），叠加 D-115 的目录前提为假、
D-102 回归线指向不存在的测试、验收基线仍写 424 而 `baseline.md` 已实测 411 —— **四处 must-fix 全部是文档层、doc-fix 照抄即可闭合，不动任何生产/测试代码**。

### must-fix 计数

| 类别 | 数量 |
|---|---|
| **must-fix（M-1 ~ M-4）** | **4** |
| 轻微项（L-1 ~ L-3） | 3 |
| PASS 条目 | 12 |
| CONDITIONAL 条目 | 3（D-101 / D-102 / D-115） |
| FAIL 条目 | **0** |

### 转 Go 的最小动作（doc-fix，不需再派机位）

1. 按 M-1 改写 D-101 病症与风险段，并在 §7 增口径修正 #11（订正 `dead-backlog.md:217` + `verify-dead.md:61-68`）；
2. 按 M-2 改 D-115「连带清」一句；
3. 按 M-3 改 D-102 回归线，删掉 `EventsConfigView` 相关表述；
4. 按 M-4 把 §1.1/§1.3/D-102 验收的 `424` 统一改为 `411`，并把 `baseline.md` 的三条落地提醒（逐包 build / desktop 带参测试命令 / mobile `--maxWorkers=2`）补进 §1；
5. 顺手把批次 1 小结的净减口径补一句「D-114 另连带删 1 行注释 ⇒ 合计 2206」。

---

*本机位只读：零 git 写、零 `docs/apm/` 写、零生产/测试代码与 fix-spec 改动。唯一写入 = 本文件。*