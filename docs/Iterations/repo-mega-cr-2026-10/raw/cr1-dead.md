# CR 报告 · cr1-dead（scope 模式 · 只读评审）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-dead`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `496b6fd8`（core 批次 1+2 + validate-prompt-blocks/PromptBlock 联合删除）、`6594b67c`（desktop/mobile 死通道 8 条 + 三组新目标） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-d.md`（D-101~116 / D-201~209 / §4.7 三组新目标 / §5 死通道 8 条） |
| 本 scope 域 | core 死码（D-101~116、D-201~209）、`validate-prompt-blocks`/`PromptBlock` 联合删除（Lifecycle 保留）、desktop/mobile 死通道与死常量、renderer 棘轮 371 |
| 域外（不判） | Wave E 门禁实现质量（cr-guards）、Wave A/B/C 的实现、批次 3（★1/★3 拍板项，**未施工是拍板项不是缺陷**） |
| 检查维度 | A（误删活码）/ B（删后语义等价）/ C（renderer 棘轮 411→371）/ G（五点删净口径） |
| 实跑（本机位只读） | renderer tsc 实测 **371**；core `npm test` **3296 tests / 3293 pass / 3 fail**（=基线 3 条已知红）；desktop（baseline 等价命令）**660 / 659 / 1**（=基线那条满负载 flake）；mobile jest **1744 / 1742 / 2**（1 条已知红 + 1 条隔离复跑转绿的负载 flake）；desktop lint **0 error / 21 warning**；core `tsc -p tsconfig.json` **0**；`tsc -p tsconfig.test.json` **454 TS6059 + 0 其它** |
| 写入 | 禁改代码 / 禁改 spec / 零 git 写。本报告为唯一落盘物；临时探针（`tmp/crd-dead-*`、`packages/core/tmp-crd-dead-*`）已删除 |

---

## ② Must-fix

> **P0 = 0**。逐条 grep 核下来，**没有一条活码被误删**。

### P2-1 ★top：`renderer 基线 411→371` 的归因是错的 —— 这个数字里只有约 1/3 属于 Wave D

**位置**：commit `6594b67c` 提交信息尾段「——renderer 基线 411→371」；佐证文件 `docs/Iterations/repo-mega-cr-2026-10/fix-spec/baseline.md:14/106`（`HEAD = fe79b781`、`411`）

**机理（棘轮失真的证明，探针已删）**：

`baseline.md` 自己写着 411 是在 **`fe79b781`** 上实测的。而本仓的提交顺序是

```
fe79b781 → c667be0f → 759372c8 → d68a848b   （Wave C，3 个 commit）
          → 496b6fd8 → 6594b67c             （Wave D，本节点被审的两个）
          → 3b4c8d9e → 5fb269fe → 046f4d9c  （Wave E）
```

（`git merge-base --is-ancestor fe79b781 c667be0f` 为真 ⇒ **411 是 Wave C 之前的数**，不是 Wave D 的直接前驱数。）

把 `tmp/baseline-04-tsc-renderer.log`（411 条身份）与当前实跑（371 条）按「文件 + 错误码 + 消息」归一后做差集（临时探针，结论如下）：

| 口径 | 值 |
|---|---|
| base（fe79b781）身份数 | 411 |
| 当前（HEAD）身份数 | 371 |
| 含行号列号逐字相同 | 311 |
| 归一后**消失** | **59** |
| 归一后**新增** | **19** |
| 411 − 59 + 19 | **371** ✔ 与实跑自洽 |

消失的 59 条按文件聚合：

| 条数 | 文件 | 归属 |
|---|---|---|
| **12** | `renderer/features/settings/AgentDefinitionEditorForm.tsx` | ✅ **Wave D（D-102 整文件删）** |
| **1** | `test/preview-annotate-source-anchor.test.ts` | ✅ **Wave D（D-202 删 3 个 it）** |
| 32 | `test/token-usage-stats-view.test.tsx` | ❌ Wave C/E（本波未碰此文件） |
| 5 | `test/workspace-push-menu.test.tsx` | ❌ Wave C/E |
| 4 | `test/fetch-models-modal.test.tsx` | ❌ Wave C/E |
| 4 | `test/metrics-detail-popover.test.tsx` | ❌ Wave C/E |
| 1 | `renderer/features/chat/ChatHistorySearchPanel.tsx` | ❌ Wave C（`c667be0f` 改过此文件 3+/1-） |

新增的 19 条同样全部落在 Wave D 没碰过的文件上：`test/cloud-sync-pull-accounting.test.ts` TS2339 ×3（该文件是 `c667be0f` 新增的）、`test/token-usage-stats-view.test.tsx` ×18 之类。

⇒ **净减 40 = Wave D 的 13 + Wave C/E 的 27（含置换）**。也就是说「新增的 40 条减少是死码消失带来的真减少」这个前提**部分不成立**：减少是真的（不是被不当过滤），但**只有 13 条能记在 Wave D 头上**，其余 27 条是 Wave C 的战果。

**为什么这条不能只算文案问题**：棘轮文件 `apps/desktop/typecheck-renderer-baseline.json` 是在 Wave E 的 `3b4c8d9e` 才创建的（`git log --follow` 只有一个 commit），它记的 371 是**当前实跑值**、本身完全忠实（我实测 371，`known` 371 条、`maxErrors` 371，三者相等 ⇒ 无过滤、无静默剔除）。问题在于**归属**：如果日后有人按提交信息把「Wave D 净减 40 条 renderer 错误」记进台账，然后**回退这两个 Wave D commit**，实跑会回到 384 而不是 411 —— 回退后棘轮与代码就对不上了，而且没有任何守卫会报。

**修法建议**（三选一，都不改实现）：
1. 最低成本：把 `ledger-v2.md` §10 Wave D 行与 `wave-d.md` 各条验收③里的「renderer ≤411 / 411→371」改成「Wave D 自身净减 13（AgentDefinitionEditorForm 12 + preview-annotate-source-anchor 1）；411→371 的其余 27 条归 Wave C」；
2. 若要留下可复现证据：把本次的归一差集脚本按 `§4.9 F-synth-dead-1` 的口径固化到 `scripts/`，或至少把两份 tsc 输出留一份在 `tmp/` 之外的可归档位置；
3. **给「删除类 commit 声明 ratchet 数字」立一条通则**：声明时必须写清「本 commit 的直接父提交上的实跑值 → 本 commit 的实跑值」，而不是引用本波开工前的某个历史基线。这条通则对 Wave E 之后的每一波都成立。

---

### P2-2：`formatVfsError` 被本波**变成**零消费，却只删了它的测试、没删它 —— 还留下了一句已经不成立的注释

**位置**：`apps/mobile/src/errors/format-error.ts:83-86`（随本波成为孤儿）、`apps/mobile/src/vfs/errors.ts`（已删）、`apps/mobile/__tests__/errors.test.ts`（已删）

```ts
/** @deprecated Prefer {@link formatError}; kept for VFS call sites. */
export function formatVfsError(error: unknown): string {
  return formatError(error);
}
```

**机理（漏删）**：
- 删前：`formatVfsError` 的唯一引用链是 `apps/mobile/src/vfs/errors.ts`（死再导出 shim）→ `__tests__/errors.test.ts`（5 个 `it`）。
- 删后：`git grep -rn "formatVfsError\b" -- apps packages` 在**全仓只剩定义行本身**（`format-error.ts:84`），零生产消费方、零测试。
- 而 JSDoc 写的理由「kept for VFS call sites」现在**是假的**：mobile 侧所有 VFS 文案走的是 core 的 `formatVfsErrorForUser`（`VfsFileManager.tsx:48/794`），`formatError` 才是实际在用的那个（7 个消费者）。

这直接撞上本波自己的验收口径：`wave-d.md` §3 D-202 明确写了「⚠ **不得**因为负向断言读起来像引用就把它一起删」——本条是它的镜像：**也不该因为「测试读起来像在测它」就把唯一的消费者删掉、却把被测函数留下**。而且被删的那 5 个 `it`（VfsError 中文映射、TdbcError cause 拼接、generic Error、非 Error 值）测的是**一个纯函数的行为**，不是那层 4 行 shim —— 只要把 import 从 `@/vfs/errors` 改指 `@/errors/format-error`，5 条断言一条都不用丢。

**修法建议**：二选一（都在同一个 commit 内闭环）：
- (a) 保留 `formatVfsError`（它在 public 面外、无害），把 `__tests__/errors.test.ts` 按上面的改指**恢复回来**（5 条断言全部有效），并把 JSDoc 的「kept for VFS call sites」改成「暂留兼容，VFS 文案已改走 core 的 `formatVfsErrorForUser`」；
- (b) 既然已经零消费，就把 `formatVfsError` 一并删掉（JSDoc + 函数 4 行），别留一个带假理由的 `@deprecated` 导出给下一个人当「还有 VFS 调用点」的线索。

倾向 (a)：它是纯函数、有可测行为、且已经写好了；顺手保住覆盖比删干净更划算。

---

### P2-3：D-101 的 CHANGELOG 留痕没做 —— 而这条是全波唯一有「不可逆本地损失」的删除

**位置**：`CHANGELOG.md`（`git diff fe79b781 HEAD --stat -- CHANGELOG.md` = 空，本波两 commit 均未碰）；spec 锚点 `wave-d.md:139-141`（D-101 修法「附带动作：在本次发版的 `CHANGELOG.md` 记一笔『删除一次性编码修复脚本』」）

**机理（漏删的第五点）**：

`apps/desktop/scripts/fix-settings-utf8.mjs`（547 行）不是一个普通的死文件。spec 自己查实了它的真实行为是**「破坏先于报错」**：`:54` 先把 `AgentEditorView.tsx` 静默覆写成 `d825173` 版的 **471 行**（当前 1381 行，**净丢 910 行且零报错**），`:63` 才因 `EventsConfigView.tsx` 不存在而 ENOENT 崩。跑过它的人看到 ENOINT 会以为「崩了＝没改动」，实际工作区已经被改过了。

⇒ 对**已经跑过这个脚本的人**，本 commit 是他们唯一的告知渠道；没有 CHANGELOG = 没人知道自己的 `AgentEditorView.tsx` 少了 910 行、也不知道回退路径（`git checkout` + `git show d825173:…`）。这不是「文档洁癖」，这是本波唯一一处**影响用户既有本地数据**的删除。

**修法**：本次发版的 `CHANGELOG.md` 加一条「Removed: `apps/desktop/scripts/fix-settings-utf8.mjs`（一次性编码修复脚本，从未接入任何 npm script / CI）。若你在旧版本上跑过它，`renderer/features/settings/AgentEditorView.tsx` 可能已被覆写成 `d825173` 的 471 行版本，恢复方式：`git checkout apps/desktop/renderer/features/settings/AgentEditorView.tsx`」。放不放 `Unreleased` 由主代理按发版节奏定。

---

### P2-4：`packages/core/docs/public-api.md:76` 留了一条指向已删类型的悬空文档行

**位置**：`packages/core/docs/public-api.md:76`

```
| 遗留 PromptBlock 类型 | 内部 `domain/prompt/model/prompt-block.js` | `@novel-master/core/prompt` |
```

这张表是 §5「Canonical 路径表」，列头是「能力 / Canonical / 已移除」，语义是「同一能力在两处重复导出，必须指向同一实现」。本波把 `PromptBlock` 与 `PromptBlockRole` 从 `prompt-block.js` 摘掉后，该文件只剩 `PromptBlockLifecycle`，而 `PromptBlockLifecycle` **从来没有**从 `@novel-master/core/prompt` 转出过 ⇒ 这一行现在描述的「重复导出关系」**根本不存在**。

本波在别处对同类事情很上心：`agent-prompt-layout.ts:80` 的 `{@link PromptBlock}` 被改写了、`web/composer-input/.../bridge.ts:67` 与 `runtime/model.ts:6` 里提到「log/messagePatch 类死消息」的注释也被改写了 —— 唯独漏了这份 core 自带的架构文档。

**修法**：把 `:76` 整行删掉，或改写为「遗留 `PromptBlockLifecycle` | 内部 `domain/prompt/model/prompt-block.js` | —（未对外转出）」。若 `:74` 的「已删除 export」那类写法是本表既有惯例，按那个体例写即可。

---

### P2-5：`prompt-block.ts` 被改成了**无文件尾换行**（本波新引入，不是继承的）

**位置**：`packages/core/src/domain/prompt/model/prompt-block.ts:8`（末字节是 `;`，无 LF）

diff 末尾的 `\ No newline at end of file` 是本 commit 新加的（改前该文件以 `};\n` 结尾）。`eslint.config.base.mjs` 没开 `eol-last`，所以 lint 绿、core 测试绿、tsc 绿 —— 三道门全都看不见它。但：

- `cr1-c2.md` 的 P2-4 已经把「缺尾换行」登记为**波级习惯**（当时统计全仓 1951 个 `.ts` 里有 29 个缺，其中 8 个是 Wave C 新增）；
- 本波又新增 1 个 ⇒ 这条习惯在往下传染；
- Wave E 的 H1 编码扫描钩子只抓 BOM / FFFD / 非 UTF-8，**抓不到缺尾换行**，所以不会被自动收口。

**修法**：补一个 `\n`。不要逐文件零敲 —— 建议登记为一条统一清理项，与 Wave E 编码扫描钩子一并收口（钩子加一条「末字节非 LF」判定，或开 `eol-last`）。

---

### P2-6（跨域观察 · 修法归 cr-guards）：棘轮文件里 `previousMaxErrors: 360` 查无出处

**位置**：`apps/desktop/typecheck-renderer-baseline.json:4-5`

```json
"maxErrors": 371,
"previousMaxErrors": 360,
```

`writeBaseline()` 的语义是 `previousMaxErrors = 改写前的 maxErrors`，且 `check-renderer-typecheck.mjs` 的 `--update` 会打印 `was <旧值>`。但这个文件是在 `3b4c8d9e`（Wave E）**一次性新增**的（`git log --follow` 只有这一个 commit），不是 `--update` 产物 ⇒ `360` 是手写进去的。我在 `tmp/` 下留存的实现轮/CR 轮 tsc 日志里逐个数过（`renderer-tsc.txt` 371、`d-t3.log` 371、`d-t4.log` 0、`core-tc.log` 0、`desktop-tc.log` 1、`cr-desktop-tsc.log` 0），**没有任何一份记录过 360**。

按该文件自己的 `$comment`（「count/identity numbers are always measured, never copied from spec」），这个字段要么补上出处、要么改成 `null`（`writeBaseline` 在 `previous == null` 时就是写 `null`）。

**定级说明**：本条的**实现**在 Wave E commit 里，属 cr-guards 域；本节点只报「这个字段与本波声明的 411→371 数字属于同一族记账问题」这一事实，不越界判门禁实现质量。

---

## ③ Should-fix 与观察项（含正向确认）

### ③-1 核对通过的重点项（下游不必重复劳动）

1. **「联合删除的红线」切得干净**：`prompt-block.ts` 只摘了 `PromptBlockRole` 与 `PromptBlock`，`PromptBlockLifecycle` 保留。`git grep -rn PromptBlockLifecycle -- packages` 命中 **2 处 import**（`validate-agent-prompt-layout.ts:14`、`agent-prompt-layout.ts:7`）＋ 定义行，验收第 2 条成立。`validate-prompt-blocks.ts`（178 行）与其测试（215 行）整体删除后，`git grep -rn "validatePromptBlocks\|PromptBlockRole" -- apps packages` **归零**。
2. **D-207「改指 src/public」的语义等价性成立，且有真牙齿**：被删的 `service/kkv/index.ts` 的导出面是 `createKkvService / KkvService / KkvError / isKkvError / KkvErrorCode` 五项，`src/public/kkv.ts:11-14` 导出的是**同样五项、同样来源文件**（`create-kkv-service.js` / `kkv.port.js` / `kkv-errors.js`）⇒ 类身份与模块身份都不变。`tsconfig.test.json:26` 改指 `./src/public/kkv.ts` 后，**唯一受害方** `packages/core/test/package-exports-t0.test.ts:4` 需要的 `createKkvService + KkvError` 均被覆盖，RULE:74 的「静默跑 dist 旧码」坑已闭合 —— 而且是被 **Wave E 的 X4 守卫 `public-kkv-dist-resolution.test.ts` 用一条专门的 `it`（`:110`「src 侧（tsx paths 解析）与 dist 侧导出一致」）钉住的**，该测试在本轮 core 全量里通过。这条验收比 spec 自己要求的「tsc 过 + 测试绿」硬。
3. **D-209 删 ambient d.ts 确实安全**：`git grep -rn "@agnai" -- apps packages examples` 在 `packages/core/**` 内**零命中**；`packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts` 自带一份逐字相同的副本，driver 侧不经 core 编译面。core `tsc -p tsconfig.json` 实跑 0 错。
4. **8 条死通道「五点删净」逐条核实**：对每条通道核了 ①`shared/ipc-types.ts` 常量 ②`handler-registry.ts` 的 `bindReq`/`bindNoArg` **与 import 行** ③`invoke-registry.ts` 封装 ④`renderer/ipc/client.ts` 再导出 ⑤`handler` 实现 —— 8 条 × 全部同步点，`git grep` **全仓零命中**（含原始通道字符串 `'nm:projects/getAgentConfig'` 等 8 个，全仓仅 3 处历史迭代文档提及，文档不是消费方）。`noUnusedLocals: true` 下最容易漏的三条孤儿 import（`handleSmartSortRuleExportRules` / `handleSmartSortRuleImportRules` / `handleSkillsEdit`）**同批删净**，desktop main tsc 实跑 0 错。
5. **`MENU_OPEN_GRACE_MS` 反向守卫守住了**：删 `LONG_PRESS_MOVE_TOLERANCE_PX` 与 `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 时**没有误伤**它。`menu.ts:1` 的 import 与 `:199` 的使用仍在，`chat-transcript-boot-script.test.ts:17/93/261` 三处断言仍绿（本轮 mobile 全量里该套件通过）。`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` 的**再导出行**（`anchored-menu-layout.ts:12`）与常量**同批删除**，`constants.ts` 与 `anchored-menu-layout.ts` 两个文件的 diff 我逐行看过，没有留下会 `tsc` 红的孤儿转出。
6. **死协议项删的是类型面、不是运行时面**：`messagePatch` / `log` 三处联合成员删除后，`git grep -rn "'log'" -- apps/mobile/src` **归零**、`case 'log'` 零命中 ⇒ 无发送方也无处理方，删类型联合不改变任何运行时分派。两处提到「log/messagePatch 类死消息」的注释也同步改写了。
7. **`jest.mock` 先摘后删的纪律守住了**：D-201 的 6 处 `jest.mock` 与工厂字面量全摘干净（`session-messages-loader` 全仓归零，含 `:421`/`:466` 两处注释）；`flush-run-ui` / `tool-turn-actions` / `stream-tail-html-state` 的 jest.mock 与源文件同批处理，无「`Cannot find module` 风险」。
8. **负向断言保住了**：D-202 删源后，`preview-annotate-source-anchor.test.ts:46` 与 `preview-recogito-md.test.ts:76` 两处 `doesNotMatch(pane, /sanitizeAnnotatePreviewHtml/)` 都还在，「面板里不含它」这条契约没被顺手删掉。
9. **写侧覆盖没被连坐**：`sessions-agent-binding-handlers.test.ts` 删掉读侧断言后，`verifyBindingCommitted` 改走 `rt.sessions.getSessionAgentConfig(sessionId)`（与被删通道**同一个数据源**），T-D1 的写侧四步与 T-C2 的其余部分完整保留；`workplace-handlers.test.ts` 只删了 `captureSessionBlock` 那 1 个 `it`，其余 4 个未动。
10. **快照面零命中**：两个 Wave D commit 对 `packages/core/test/package-exports/**` 的 diff 为**空**，13 份快照测试在 core 全量里全绿。
11. **桌面的孪生活文件没被误删**：`flush-run-ui` 的 desktop 半边与 `apps/desktop/test/flush-run-ui.test.ts` 一字未动（`conversation-abort-retain.ts:7` 是活 import）；双端 `transcript-selectable-role.ts` 都删了，但 core `public/chat.ts` 的转出没碰（快照锁），`apps/desktop/shared/logic/chat.ts` 的 15 行悬空转出按 spec 登记到批次 3.2、**本批不施工**（不是漏删）。

### ③-2 观察项（不必在本波修，登记即可）

- **`D-301` / `D-303` 两条级联仍挂在树上**：`ipcMessagesHide/Show/Delete` 与 `ipcShellMenuPopup` 现在在 `client.ts`/`invoke-registry.ts`/`handler-registry.ts` 的封装已无 renderer 消费者（D-105 / D-108 的唯一调用点已删），整链可摘。spec §5.3/§5.4 明确「登记在批次 3.2、**不在本波施工**」⇒ **合规**，只是提醒下游别忘了它们现在真的只剩封装没有调用方了。
- **`subagent-tool-session-id.ts` 的 `ToolUseBlock` / `ToolResultBlock` 再导出还在**（文件尾两行）。spec D-116 第 3 步写的是「可在本批顺手摘掉，也可不摘，不计入强制动作」⇒ 合规。core 测试全绿说明无人吃它。
- **`tsc -p packages/core/tsconfig.test.json` 这道验收门噪音极大**：实跑 **454 条 TS6059**（`rootDir=src` vs `include: test/**/*`，一条测试文件一条）+ **0 条真实类型错**。它是 `tsconfig.test.json` 的结构性问题、不是本波引入（`tsconfig.json` 的 `rootDir` 与 test include 天生冲突），但作为 D-207/D-209 的「核心验收门」，它输出 454 条红、任何人第一眼都会读成「没过」。本波之所以没踩坑，是因为**另有真门**（core 全量测试 + X4 守卫）兜住了。建议把「core 测试面 typecheck」从 `wave-d.md` §1.1 的必跑表里挪到「信息性」，或单独修 `rootDir`。
- **`tmp/` 里遗留了大量上一轮的实现/CR 探针**（`kkv-probe.mts`、`d1xx.txt`、`_cr1c1-*.diff`、`crd-*` 之外的十余个等）。`tmp/` 被 `.gitignore` 整目录忽略、不进版本库，所以不是代码缺陷；但「用完必须删除」这条纪律在本波是**没执行到底**的，建议与 P2-5 的编码清理一并收口。

---

## ④ 结论 verdict

**抽样范围与计数**

| 类别 | 数量 | 核对方式 |
|---|---|---|
| 整文件删除 | **32**（`496b6fd8` 8 个 + `6594b67c` 24 个） | `git diff --diff-filter=D` 全量列出，逐个按「模块名 / 导出符号名 / 文件名」三口径 `git grep` 全仓（`apps packages examples scripts .github`） |
| 符号级摘除 | **≈14**：`PromptBlockRole`、`PromptBlock`、`isTaskToolUse`、`LONG_PRESS_MOVE_TOLERANCE_PX`、`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` + 其再导出行、`messagePatch`、`log`×2、`infer-scope-from-path.ts` 注释提及 + 2 处提及死协议的注释 | 同上 |
| 死通道同步点 | **8 条通道**（含 3 个 handler 实现、8 条 import 行、8 条 bindReq、7 条 invoke 封装、7 条 client 再导出、8 条通道常量） | 逐通道按 spec §5.1 的五点表核 + 原始通道字符串 grep |
| **合计抽样符号/同步点** | **≈78** | |

**判定结果**

| 指标 | 值 |
|---|---|
| 抽样核对总数 | **≈78** |
| **误删活码数** | **0** |
| 漏删（本次新造出的孤儿/失真注释） | **2**（P2-2 `formatVfsError`；P2-4 `public-api.md:76`） |
| 文档/记账失真 | **3**（P2-1 棘轮归因、P2-3 CHANGELOG、P2-6 `previousMaxErrors: 360`） |
| 新引入的风格 nit | **1**（P2-5 缺尾换行） |
| P0 / P1 | **0 / 0** |

**验收线实测对照（对照 `baseline.md` §2/§3 的已知红清单判增量，不对照零基线）**

| 域 | 基线 | 本轮实跑 | 增量 |
|---|---|---|---|
| core `tsc -p tsconfig.json` | 0 | **0** | 0 ✔ |
| desktop main `tsc -p tsconfig.json` | 0 | 由 desktop 测试 pretest + lint 覆盖，0 error | 0 ✔ |
| desktop renderer `tsc -p tsconfig.renderer.json` | 411 | **371** | **−40**（但见 P2-1：Wave D 自身只占 −13） |
| core `npm test` | 3126 / 3 fail | **3296 / 3 fail**（2 条 usage-stats 确定性 + 1 条性能护栏） | **0 新增红** ✔ |
| desktop 测试 | 628 / 627 / 1 | **660 / 659 / 1**（同一条 blob 归一满负载 flake） | **0 新增红** ✔ |
| mobile jest | 1739 / 1738 / 1 | **1744 / 1742 / 2** | **表面 +1**；隔离复跑 `chat-transcript-webview.test.tsx` **40/40 全绿** ⇒ 判为满负载假信号（RULE「降并发复跑才作数」）。另 1 条 `mermaid-fullscreen` 为基线已知确定性红 ✔ |
| desktop lint | — | **0 error / 21 warning** | 0 error ✔ |

**综合判定**：**Wave D 的两个 commit 在「不误删活码」这一条上是干净的** —— 32 个整文件删除 + 14 个符号级摘除 + 8 条死通道五点删净，抽样 ≈78 个符号/同步点，误删 **0**；三包测试零新增红、两处被本波点名的「反向守卫」（`MENU_OPEN_GRACE_MS`、`PromptBlockLifecycle`）与两处被点名的「负向断言」都守住了；D-207 的 `paths` 改指不仅语义等价，还有 Wave E X4 的专门守卫钉住。缺陷集中在**波外记账与收尾**（P2-1 棘轮归因、P2-3 CHANGELOG、P2-4 悬空文档行、P2-5 缺尾换行、P2-6 字段无出处）与**一处漏删**（P2-2），全部可在下一轮零风险收口，无一需要回滚已删代码。

---

*本文件为 code-review-loop 的 `cr-dead` 机位（scope 模式 · review_round 1 / dag_version 1）产出。只读纪律：零 git 写、零生产/测试代码改动、零 fix-spec 改动。*