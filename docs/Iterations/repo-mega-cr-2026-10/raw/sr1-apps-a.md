---
zone: apps
agent: sr1-apps-a（readonly reviewer · 组 A = §1 N-P1-04 + §2 §6#5）
base: main@fe79b781（HEAD 实测 `fe79b781`，与 spec 声明一致）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一章 + 第四章全文）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-apps.md（L1-L315，即 §1/§2 两个条目节）
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（L286-L311 §6 候补表，重点第 5 行）
  - docs/Iterations/repo-mega-cr-2026-10/registry.md（L214-L224 编队登记）
  - docs/apm/RULE.md（验收牙齿三判据 L85、桌面零 mock 基座 L110/L111、新 worktree 三件套 L136）
  - apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx（全文 319 行）
  - apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx（全文 300 行）
  - apps/desktop/shared/ipc-types.ts（L205-L232、L1608-L1625）
  - apps/desktop/renderer/ipc/invoke-registry.ts（L340-L359、L645-L658）
  - apps/desktop/src/main/ipc/handlers/messages.ts（L151-L168）
  - apps/desktop/src/main/ipc/format-ipc-error.ts（全文 111 行）
  - apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx（仅挂载点定位 L62/L368）
  - apps/desktop/test/{react-alias-hook.mjs, chat-search-shell-nav-hook.mjs, chat-search-shell-nav-stub.mjs,
    chat-search-race-guard.test.tsx, chat-search-collapsible-form.test.tsx, workspace-settings-subagent-stream.test.ts,
    settings-nav-guard.test.ts, settings-agents-tabs.test.ts, mermaid-markdown.test.tsx, message-list-stream.test.tsx,
    messages-search-handler.test.ts, compaction-handler.test.ts, preferences-handlers.test.ts}
  - apps/desktop/{tsconfig.renderer.json, scripts/run-tests.mjs}
  - apps/desktop/renderer/{utils/settings-feedback.ts, components/ui/{show-toast.ts,toast-bus.ts,PickerModal.tsx,Switch.tsx},
    features/settings/settings-ui.tsx}
---

## 摘要

组 A 两条目均为**独立复核成立、修法方向正确、可执行**的单文件小改，但**当前不可直接执行**：§1/§2 的验收里挂着一个**不可复现的数字锚点（spec 写 424，实测两次独立实跑都是 411）**，且 §1 的主验收用例（`mock.timers` + `act`）按 spec 原文写法**会挂死**。两处都是 doc-fix 照抄级小改。除此之外的所有行号、引文、夹具先例、修法边界我都逐条从代码重推过，未发现抄错或漏改。

---

## 1 · 逐条 verdict

### 1.1 §1 N-P1-04 —— WorkspaceSettingsView 600ms 定时器闭包（conditional-go）

| 七要素 | verdict | 我实际做的核对 |
|---|---|---|
| 病症（代码重推导） | ✅ **成立** | 独立重推：`onChange`(`:273-276`) → `setCompactionTokenRatio`（异步，本帧不生效）+ `scheduleCompactionSave()`。`scheduleCompactionSave`(`:164-171`) deps `[saveCompaction]`；`saveCompaction`(`:139-160`) deps `[compactionEnabled, compactionTokenRatio, compactionHideStartDepth]`。⇒ 第 N 次击键拿到的是第 N-1 帧渲染出的 `scheduleCompactionSave_N`，其闭包里的 `saveCompaction_N` 捕获的是**第 N-1 帧的 state**。600ms 后落地恒为上一次击键前的值 ⇒ **最后一次输入必丢**。与 spec 描述逐字一致。 |
| 对照组（开关那一路是对的） | ✅ 成立 | `:259-262` `onChange={(next)=>{ setCompactionEnabled(next); void saveCompaction(next); }}` —— `next` 是**同帧参数**，`nextEnabled` 走显式传参不读 state，所以只有它躲过了闭包陷阱。spec 判断正确。 |
| 证据 file:line | ✅ **全部在位、逐字一致** | 逐条核对：`:163` timer ref ✔；`:168-170` `setTimeout(()=>{ void saveCompaction(); }, 600)` ✔；`:171` `}, [saveCompaction]);` ✔；`:139` `const saveCompaction = useCallback(` ✔；`:140` `async (nextEnabled = compactionEnabled) => {` ✔；`:145` `...(compactionTokenRatio.trim() ? { tokenRatio: Number(compactionTokenRatio) } : {}),` ✔；`:159` `[compactionEnabled, compactionTokenRatio, compactionHideStartDepth],` ✔；`:273-276` onChange ✔；`:37` `notifyAgentConfigChanged` ✔；`:250-253` hideStartDepth onChange ✔。**无行号漂移**。 |
| 修法可行性 | ✅ 可行、竞态闭合 | 步骤 3（`saveCompaction` 改三参 + deps 清空）+ 步骤 2（`useEffect` 同步 draft ref）+ 步骤 4（定时器读 ref）三者自洽：定时器最短 600ms 才 fire，passive effect 在 commit 后 ≤1 帧落盘，**防抖路径上无窗口**。grep 复核 `saveCompaction` 全文件仅 `:169`、`:261` 两个调用点 ⇒ **步骤 3 改签名不会有漏改的调用方**，步骤 6 的开关路是唯一需要跟改的。 |
| 修法完备性 | ⚠️ 可执行但有两处未登记（见 must-fix MF-A6 与注记 N1/N2） | ①残余行为未登记：「击键 → 600ms 内点开关」会即时保存一次、600ms 后残留定时器再保存一次（双 toast）。修前就有、非回归，但 spec 的风险节没写，执行者可能误判成新引入的 bug。②`useEffect` 同步 ref 是可行的，但不是唯一解（见 N2）。 |
| 验收「有牙」（判据①） | ✅ **有牙** | T-CMPD-1 把实现改回 `void saveCompaction()` 无参版 → 若 deps 已清空则闭包冻结在首帧 `"0.8"`，断言 `=== 0.855` 必红；若整段回退到原实现同样红。T-CMPD-3（599ms 不落库）在「删掉防抖直接保存」形态下必红。两条都不是恒真断言。 |
| 验收「不恒红」（判据②） | ❌ **会恒红（挂死）** | spec 原文只写「用 `mock.timers` 推进 600ms」。Node v22 `MockTimers` 默认 `apis` 含 `setImmediate`，而 `react-test-renderer` 的 `act()` 靠 scheduler 的 `setImmediate`/`MessageChannel` 冲刷待办 work —— mock 掉即 `act` 永不返回，四条用例全部挂死。详见 **MF-A2**。 |
| 验收「夹具不互斥」（判据③） | ✅ 通过 | 新文件独立进程，4 条用例期望互不冲突；与既有 `workspace-settings-subagent-stream.test.ts`（3 条纯源码正则）不共用夹具。 |
| 测试策略（文件真实存在） | ✅ 全部存在 | `test/react-alias-hook.mjs` ✔（L16-17 把 `react`/`react/*` 重定向到根副本）；`test/chat-search-shell-nav-hook.mjs` ✔（L11-13 精确拦 `@/providers/ShellNavProvider`）；`test/chat-search-shell-nav-stub.mjs` ✔（**只导出 `openChatLink`**，spec 说对了，补 `notifyAgentConfigChanged` 是必需的且对 T-CF7 无副作用）；`test/mermaid-markdown.test.tsx:208` ✔（`t.mock.timers.enable({ now: 1_000 })`，MockTimers 先例成立）。**两个待新建文件（`workspace-settings-compaction-debounce.test.tsx` / `chat-search-error-render.test.tsx`）当前不存在，符合「新增」预期。** |
| 测试策略（可渲染性） | ✅ 比 spec 说的更宽松 | 我顺着依赖树核了一遍：`PickerModal.tsx` / `Switch.tsx` **零 import 纯 JSX**；`settings-ui.tsx` 只 import `Switch` + `BatchCheckbox` + 一个 shared 常量表；`settings-feedback.ts` → `show-toast` → `toast-bus`（纯 Set pub/sub，零 UI 库）。**无 antd、无 CSS import、无 jsdom 依赖** ⇒ spec 里「起不来就退正则」的悲观条款其实用不上，行为用例能直接跑。 |
| 回归线（文件真实存在） | ✅ 存在，但**一条理由是错的** | `workspace-settings-subagent-stream.test.ts` ✔（3 条，正则锁 `useState(true)` 与两个 invoke，本条不动这些行，恒绿）；`settings-nav-guard.test.ts` ✔（14 例）；`settings-agents-tabs.test.ts` ✔（6 例，静态守卫 `SettingsViews.tsx`）；`preferences-handlers.test.ts` ✔（3 例）、`compaction-handler.test.ts` ✔（4 例）；`chat-search-collapsible-form.test.tsx` ✔ 存在但**不共用 `settings-ui`/`Switch`**（见 **MF-A5**）。 |
| 依赖闭合 | ⚠️ **有一处悬空** | 前置无 ✔（单文件、无跨模块契约、组件无 props）。搭车项核实成立：`invoke-registry.ts:649` `noArg(invoke, COMPACTION_CONDITIONS_GET)` / `:653` `withReq<unknown, unknown>` **确无响应类型**，而 `shared/ipc-types.ts:1613 CompactionConditionsDto` / `:1622 CompactionConditionsSetRequest` **类型已存在** ⇒ 「零风险纯补签名」成立。但验收引用了**尚不存在的 `fix-spec/baseline.md`**（registry.md L219 显示 s-baseline 机位仍 `running`）⇒ 见 **MF-A4**。 |
| 拍板项 | ✅ 无 | 与 ledger §7 无交集。 |

### 1.2 §2 §6#5 —— ChatHistorySearchPanel 查询失败白屏（conditional-go）

**独立第三源复核（不读撰写机位论证，从代码零起手）——成立，入账 P1 无异议。**

| 复核步 | 我怎么做的 | 结论 |
|---|---|---|
| ① 状态声明侧 | `ChatHistorySearchPanel.tsx:51` `const [error, setError] = useState<string \| undefined>(undefined);` | 形参只收 `string \| undefined` |
| ② 实参侧 | `:106` `setError(result.error ?? '查询失败');` | `??` 只在 `error` 为 `null/undefined` 时生效，而 `IpcResult` 失败分支 `error` 必存（`ipc-types.ts:220`）⇒ **兜底恒不可达**，`setError` 恒收对象 |
| ③ 类型链路 | `ipcMessagesSearch` ← `invoke-registry.ts:348-351` `withReq<MessagesSearchRequest, IpcResult<ChatMessageDto[]>>`；`withReq` 是 `req => invoke<TRes>(channel, req)` 的裸转发（**不 throw、不解包**）⇒ renderer 拿到的就是原始 `IpcResult` | `result.error: IpcErrorPayload` ⇒ 实参形参不兼容 |
| ④ 编译期坐实 | 我实跑 `npx tsc --noEmit -p tsconfig.renderer.json`，输出里逐字命中：`renderer/features/chat/ChatHistorySearchPanel.tsx(106,20): error TS2345: Argument of type 'IpcErrorPayload' is not assignable to parameter of type 'SetStateAction<string \| undefined>'.` | 类型系统零争议，不是 suspected |
| ⑤ 渲染侧 | `:263-266` `{error ? (<p … role="alert">{error}</p>) : null}`，位于面板主 render 体内 | 对象作 React child ⇒ 抛 `Objects are not valid as a React child` |
| ⑥ **无 ErrorBoundary（我加查的第三步）** | grep 全 `apps/desktop/renderer` 的 `ErrorBoundary\|componentDidCatch\|getDerivedStateFromError` ⇒ **零命中**；`ChatHistorySearchPanel` 唯一挂载点是 `SessionDetailDrawer.tsx:368` | 崩溃会冒到 React 18 root ⇒ **实际后果比 spec 写的更重**（见注记 N3）。不影响 P1 定级，但执行者不该按「只有这块面板白」理解 |
| ⑦ 可达性（我加查） | main 侧 `src/main/ipc/handlers/messages.ts:151-168` `handleMessagesSearch` 全函数包在 `try { … } catch (err) { return { ok:false, error: formatIpcError(err) }; }` ⇒ `getDesktopRuntime()` 未就绪 / DB 忙 / core 抛错都会走到失败分支 | `:105` 可达且非必现，spec 判断正确 |
| ⑧ 全仓同款笔误（我重跑了 spec 的第 4 步） | grep `apps/desktop/renderer` 下 `setError\([A-Za-z_$][\w$]*\.error\b(?!\.message)` ⇒ **仅 `ChatHistorySearchPanel.tsx:106` 一处**；`setError\(...\error\s*\?\?` ⇒ **同样仅此一处** | spec 的「只改一行、不留额外 diff」成立 |

| 七要素 | verdict | 我实际做的核对 |
|---|---|---|
| 病症 + 证据 | ✅ 全部在位、逐字一致 | `:51` ✔、`:105-106` ✔、`:263-266` ✔；`ipc-types.ts:211-220` 的 `IpcErrorPayload` 三字段 + `IpcResult` 两分支 ✔。**§6 第 5 行台账记录的 `:106` 与本 spec `:106` 逐字相同，无漂移**（台账/spec/代码三方对齐）。 |
| 修法可行性 | ✅ 可行、边界完备 | 主修 `result.error.message` —— `message` 在 `ipc-types.ts:213` 是 `readonly string` **必存**（非可选）。我把 `format-ipc-error.ts` 全部 9 个返回分支逐个看过（CloudSync / ZodError / VfsError / SkillError / CharacterCardError / ToolError×2 / AgentTurnError / 泛型 Error / 兜底 `String(err)`），**没有任何一条能返回缺 `message` 的 payload** ⇒ `.message` 取法在生产链路上恒安全。备选 `?.message ?? '查询失败'` 语义也正确（`??` 不吃空串，但 `?.` 兜的是 `error` 本身缺席，人工构造场景成立）。 |
| 「不做」三条边界 | ✅ 合理 | 不迁就 state 类型 / 不加 ErrorBoundary / 不改渲染结构与 class —— 都站得住（ErrorBoundary 归 wave-e X1 面，边界切得对）。 |
| 验收「有牙」（判据①） | ✅ **有牙** | T-CSErr-1 观测面是**渲染后的文本**（`查询失败：库被占用`）+ `role="alert"` 节点存在，与被测实现「`:106` 传什么」**同源但不重叠**；把 `:106` 改回 `setError(result.error ?? '查询失败')` ⇒ React 抛 child 错误、用例必红。不是恒真断言。 |
| 验收「不恒红」（判据②） | ✅ 通过 | 新用例不依赖任何进程级模块标记；spec 特意选了「追加到既有文件 / 或新建独立文件」而非同进程混装。 |
| 验收「夹具不互斥」（判据③） | ✅ 通过 | 无既有用例共用互斥夹具。 |
| 验收可测（数字锚点） | ❌ **锚点数字错** | spec 要求「424 → 423」。**实测基线是 411**（我在同一 worktree、同 HEAD、`packages/core/dist` 已于 02:34 建好的条件下独立实跑两次，两次都是 411；另一机位留下的同命令 scratch 输出也是 825 行/411 条，第三次互证）。⇒ 见 **MF-A1**。 |
| 测试策略（文件真实存在） | ✅ 存在，但**用例数错** | `chat-search-race-guard.test.tsx` ✔ 存在，我逐行读过：L40 `register(react-alias-hook)` ✔、L41 `register(chat-search-shell-nav-hook)` ✔、L100-107 `window.novelMasterDesktop.invoke` 受控挂起 mock ✔（文件头注释 L13-14 说的就是它）、L43-45 动态导入面板 ✔。**但全文件只有 2 条 `it`（L80 源码守卫、L90 竞态行为），spec 写的「T-CF7 全套 4 条」不成立** ⇒ 见 **MF-A5**。spec 察觉到的「挂起式 mock 不便直接返回 ok:false ⇒ 备选新建 `chat-search-error-render.test.tsx`」判断正确。 |
| 回归线（文件真实存在） | ✅ 全部存在 | `chat-search-race-guard.test.tsx`（2 例）✔、`chat-search-collapsible-form.test.tsx`（7 例）✔、`messages-search-handler.test.ts`（7 例）✔、`message-list-stream.test.tsx`（4 例）✔。 |
| 依赖闭合 | ✅ 闭合 | 前置无 ✔。spec 关于「§5 的 invoke-registry 类型补齐**不是**本条前置」的论证我核了：`ipcMessagesSearch` 在 `:348-351` 本就全类型标注 ✔，作为「类型系统早就能报、只是没人跑门禁」的论据成立。拍板项无 ✔。 |

---

## 2 · must-fix 清单（doc-fix 照抄级）

| # | 条目 | 严重度 | 位置 | 问题 | 照抄改法 |
|---|---|---|---|---|---|
| **MF-A1** | §1 + §2 | **高（挡执行）** | §2 验收 4；§1 验收 5.2；连带 §0.3 第 1 行 | **renderer 基线数字 424 不可复现，实测 411。** 我在 `D:\Dev\nm-worktree\mcr\apps\desktop` 实跑 `npx tsc --noEmit -p tsconfig.renderer.json`，两次独立跑均得 **411** 条 `error TS`（输出 825 行；错误分布 renderer=178 / test=190 / src=42）；TS18046 = 138（与 spec 数字一致），`ChatHistorySearchPanel.tsx(106,20) TS2345` 逐字在位。`packages/core/dist` 建于 10-01 02:34，早于 spec 撰写（14:16），**不存在「dist 陈旧导致多报」的窗口**。⇒ 「424 → 423」这条被 spec 自称「最硬的一条」的锚点会直接判执行者失败。 | ①§2 验收 4 改为：「`npx tsc --noEmit -p tsconfig.renderer.json` ⇒ **`ChatHistorySearchPanel.tsx` 不再出现在输出中**，且总条数由 **411 降为 410**（411 为本轮在 fe79b781 实测基线，两次独立实跑一致）」；②§1 验收 5.2 的「仍为 424」改为「仍为 **411**」；③§0.3 表格首行「424 ✅ 一致」改为「**411**（本轮 reviewer 实测两次；原记 424 不可复现）」；④§1 依赖节的搭车换算「424 − 9 = 415」改为「**411 − 9 = 402**」（那 9 条 `WorkspaceSettingsView` 的 TS18046 已逐条核实为 `:103,9 / :103,29 / :104,28 / :106,9 / :107,20 / :111,9 / :112,20 / :153,11 / :156,28`）；⑤全文补一句「该数字与 `packages/core/dist` 构建状态相关，若 worktree 未建 dist 须先 `npm run build -w @novel-master/core` 再取基线（RULE:136 三件套）」。 |
| **MF-A2** | §1 | **高（挡执行）** | §1 测试策略（`mock.timers` 那条）+ 验收 1/3 | **`mock.timers` 未限定 `apis`，用例会挂死。** Node v22（本 worktree `node -v` = v22.22.0）`MockTimers.enable()` 默认 `apis` 含 `setImmediate`；`react-test-renderer` 的 `act()` 靠 scheduler 的 `setImmediate`/`MessageChannel` 冲刷待办 work，mock 掉后 `act` 永不返回 ⇒ T-CMPD-1~4 全部挂死，且**死因看起来像"实现把定时器删了"**，会把执行者引到错误方向。 | 测试策略的 MockTimers 那条改为：「`t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })` —— **必须显式限定 `apis`**：`react-test-renderer` 的 `act()` 依赖 scheduler 的 `setImmediate`/`MessageChannel`，默认档会把它们一起 mock 掉导致 `act` 永不返回（先例 `mermaid-markdown.test.tsx:208` 的 `enable({ now: 1_000 })` 不触发是因为它不跑 `act`）」。并在验收 1/3 补一句操作细节：「每次 `tick(600)` 前先 `await act(async () => {})`，让 `compactionDraftRef` 的 passive effect 先落盘，否则断言的是上一帧 ref 值」。 |
| **MF-A3** | §1 + §2 | **中** | §1 验收 5.3；§2 验收 5 | **验收引用了不存在的产物。** 两条都写「与 `baseline.md` 已知红清单一致」，但 `fix-spec/` 下只有 `SPEC.md / state.md / wave-{a-apps,b-cloudsync,b-core1,c2,e}.md`；`docs/Iterations/repo-mega-cr-2026-10/` 全树无 `baseline*.md`；`registry.md:219` 显示 `s-baseline` 机位状态仍为 `running`（报告路径 `fix-spec/baseline.md` 尚未落盘）。⇒ 该验收项目前不可执行。 | 两条的「依赖」节各加一行：「**前置**：s-baseline 机位产出 `fix-spec/baseline.md`（registry.md L219，当前 running）」；并在验收里把措辞改为可退化的形式：「`npm test` 结果与 `fix-spec/baseline.md` 已知红清单一致；**该文件未就绪时，改为指名回归线文件逐个跑并留档**（Windows 上 `scripts/run-tests.mjs:30` 的默认 glob 是单引号，**不带参数跑会收集 0 条并假绿**，须用双引号 glob 或递归多扩展名收集器，见 RULE:111/L136）」。 |
| **MF-A4** | §1 | **中** | §1 测试策略 | **新测试文件落在 `test/` 下，会直接参与生产类型门禁。** `apps/desktop/tsconfig.renderer.json` 的 `include` 是 `["renderer/**/*","shared/**/*","test/**/*"]`（RULE:109）⇒ 新建的 `workspace-settings-compaction-debounce.test.tsx` 若带类型错，会**抬高 renderer 基线**，与 MF-A1 的「恰好 −1 / 恰好不变」锚点直接打架。spec 只在 §5 搭车处提了这纪律，本条新增文件处没提。 | 测试策略新增测试文件那条补一句：「新文件位于 `test/**` 内、受 `tsconfig.renderer.json` 的 `include` 覆盖，**其类型错会直接计入 renderer 基线**（RULE:109）⇒ 新文件必须 0 类型错（尤其是 `ipcCompactionConditionsSet` 返回 `unknown`，调用处需 `as` 或先收窄，否则会把基线从 411 顶上去）」。 |
| **MF-A5** | §2 | **低** | §2 验收 3；§2 回归线第 1 条 | **「T-CF7 全套 4 条」与实况不符。** `apps/desktop/test/chat-search-race-guard.test.tsx` 全文只有 **2 条** `it`（L80「源码：两按钮互斥 + 请求序号守卫存在」、L90「append 进行中新查询：旧 append 响应晚到不落地」）。 | 两处「4 条」改为「**2 条**（`:80` 源码互斥/序号守卫 + `:90` 竞态行为）」。 |
| **MF-A6** | §1 | **低** | §1 回归线第 3 条 | **回归线理由错误。** `chat-search-collapsible-form.test.tsx` 的 import 只有 `node:*`、`react-dom/server`、`@shared/ipc-types`、`@/features/chat/MessageList` —— **完全不碰 `settings-ui` / `Switch`**，与本条改动无关，spec 给的「共用 `settings-ui` / `Switch` 无改动则不受影响」是误引。 | 该条改为 `apps/desktop/test/settings-agents-tabs.test.ts`（6 例，静态守卫 `SettingsViews.tsx` —— 全仓唯一挂载 `WorkspaceSettingsView` 的文件），并删掉 `chat-search-collapsible-form.test.tsx`；或在原地注明「保留仅为 desktop 全量套件兜底，与本条无直接耦合」。 |

---

## 3 · 非阻塞注记（建议采纳，不挡 Go）

| # | 条目 | 内容 |
|---|---|---|
| N1 | §1 风险节 | 修完后仍存在（修前也有，非回归）：「击键 → 600ms 内点开关」会先即时保存一次、600ms 后残留定时器再保存一次 ⇒ 双 toast + 两次 IPC。spec 的风险节没登记，执行者容易误判成新引入的 bug。建议补一行「行为与修前一致，不在本次范围」。 |
| N2 | §1 修法步骤 2 | `compactionDraftRef` 也可以**直接在两处 `onChange` 里同步写**（`compactionDraftRef.current.tokenRatio = e.target.value`），比 `useEffect` 少一跳、天然无时序窗口。spec 现有方案已正确，非 must-fix；但若执行者偏好，可作等价备选（写进备选差异注记即可）。 |
| N3 | §2 病症 | 我 grep 全 renderer 的 `ErrorBoundary / componentDidCatch / getDerivedStateFromError` ⇒ **零命中**，唯一挂载点 `SessionDetailDrawer.tsx:368` ⇒ 实际后果不止「查找面板白屏」，是 React 18 root 整棵树被卸载、整个窗口空白。P1 定级我认可（触发条件明确、主查询路径正常、修法一行），但正文「整个查找面板崩溃白屏」应改为「**整个 renderer root 崩溃（无 ErrorBoundary 兜底）**」，避免执行时低估影响面、也避免日后有人按「影响很小」把它排到波次末尾。 |
| N4 | §2 风险 1 | 我把 `format-ipc-error.ts` 全部 9 个返回分支逐条看过，**没有任何一条能返回缺 `message` 的 payload**（最低是兜底 `String(err)`）⇒ `message` 为空串的唯一可能是 `new Error()`，此时 React 渲染空 `role="alert"`，**不崩**。步骤 1 与步骤 2 在这一点上完全等价，spec「不额外加逻辑」的判断成立，无需改。 |

---

## 4 · 结论

**组 A（§1 N-P1-04 + §2 §6#5）：No-Go（当前）——两条的病症、修法、行号、夹具先例我都逐条从代码重推过、无一处抄错，但验收层压着两个「照抄就能修好」的硬伤：renderer 基线写成 424 而实测两次都是 411（MF-A1），以及 §1 主验收的 `mock.timers` 不限定 `apis` 会让 `act` 挂死（MF-A2）。doc-fix 闭掉 MF-A1~A6 六条后可转 Go。**

- verdict 计数：**conditional-go × 2（§1、§2）｜成立 × 2｜改文档即可执行 × 2｜No-Go × 1**
- must-fix：**6 条**（高 2 / 中 2 / 低 2），全部为 spec 文本级改动，不触碰生产代码、不改修法方向、不改定级
- 依赖闭合：§2 ✅；§1 ⚠️（`fix-spec/baseline.md` 未登记为前置，MF-A3）
- 拍板项：0（两条均无）

### 复核纪律自述
全程只读：未执行任何 git 写、未触碰 `docs/apm/`、未改生产/测试代码与 fix-spec。唯一写入为本报告；中途为跑 tsc 基线临时落过一个 `tmp-sr1a-tsc-renderer.txt`，已删除（该文件是另一机位的同命令产物，我核对后确认与我方逐字一致，随即清掉）。定位一律 `Select-String`/`Get-ChildItem -Recurse` 列文件后定点读，未做全仓内容级 grep。
