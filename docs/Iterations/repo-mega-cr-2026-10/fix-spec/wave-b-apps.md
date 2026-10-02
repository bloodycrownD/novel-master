# fix-spec 分片 · wave-b-apps（双端 apps）

> 基线：`main@fe79b781`（worktree `D:\Dev\nm-worktree\mcr`，HEAD 实测 `fe79b7810c0c78c48a18c76486359d7d45e253fa`）。
> 本分片条目（**7 条，全部七要素**）：
> **N-P1-04**（desktop 压缩配置 600ms 定时器闭包丢最后一次输入）·
> **§6 #5**（desktop `ChatHistorySearchPanel` 查询失败白屏，**本轮第二源复核成立 → 按 P1 入账**）·
> **AM-1**（mobile `forgetSession` 零生产调用 + 两张无界 Map 挂 LRU）·
> **N-P1-03**（mobile `FileEditor` 路由参数「函数进 params」双重违规）·
> **AM-3**（mobile `RealPrompt` 路由无 scope，详情页入口可能展示别会话提示词）·
> **S-D-04**（desktop `AgentEditorView` 的 `dirtyViews` 守卫恒 false + App 侧 ⚙ 旁路）·
> **E**（desktop 智能体配置加载失败时静默解除原绑定模型）。
> **后三条是 R2 补写**（judge-r1 §A.2 判 AM-3 为「台账已排进 Wave 但没人写」的真漏、S-D-04/E 为「§10 从未排期」，
> R2-4 / R2-6 要求补齐七要素）；其 file:line 同样在 `fe79b781` 工作区**亲自逐条打开核对**，
> 逐条与台账 `ledger-v2.md:159/167/169` 一致、无行号漂移（详见 §0.4）。
> ⚠️ **编号说明**：新增三条按 §7 / §8 / §9 排，**不插在 §5/§6 之前**——
> `§5`（`invoke-registry` 注记，`§5.3 步骤 1`）被 `wave-e.md` X2 的 R0 批次按名回引（R2-12），
> `§6` 已被 `wave-b-core2.md` 与 `judge-r1.md` 按行号引用；重编号会让跨片引用全部悬空。
> 另含两个**注记节**（不立七要素条目）：
> **§6 #6**（`invoke-registry` 无响应类型组 → 写成 N-P1-05 的 **P2 侧配套**）·
> **§6 #7**（`ChatComposer` scope 不一致 → **suspected，待产品确认，不立条目**）。
>
> 撰写纪律：所有 file:line 于本轮在 `fe79b781` 工作区**亲自打开核对**（含 `npx tsc --noEmit -p tsconfig.renderer.json`
> 实跑），**未照抄台账行号**；台账/synth 行号凡与本文不符，**以本文为准**（差异在 §0.3 显式列出）。

---

## 0 · 分片范围、打包建议与口径修正

### 0.1 条目一览

| # | 条目 | 簇 | 严重度 | 量 | 打包建议 |
|---|---|---|---|---|---|
| §1 | N-P1-04 定时器闭包 | apps-desktop | P1 | S | 独立小 PR，**可与 §5 的 compaction 两通道类型补齐搭车** |
| §2 | §6 #5 搜索面板白屏 | apps-desktop | **P1（本轮新入账）** | S | 独立小 PR（可与 §1 打包为「desktop 渲染层两个一行修」） |
| §3 | AM-1 forgetSession + LRU | apps-mobile | P1（拍板项 #13「不降级」前提成立） | M | 独立 PR，**建议拆两提交**：先补三处调用，再挂 LRU |
| §4 | N-P1-03 死路由参数 | apps-mobile | P1 | S | 独立 PR，与 §3 可合（都碰 mobile 删除/导航侧，但文件不相交，可并行） |
| §7 | **AM-3 `RealPrompt` 路由无 scope** | apps-mobile | P1（judge-r1 A.2(a) 判「真漏」，非未排期） | S | 独立小 PR；与 §4 同改 `navigation/types.ts` 但不同行，可并行 |
| §8 | **S-D-04 `dirtyViews` 守卫恒 false + ⚙ 旁路** | apps-desktop | P1（judge-r1 A.2(b) 判「§10 未排期」） | M | **与 `wave-b-core2 §9` 的 B 条同 PR**（同一文件同一段落） |
| §9 | **E 加载失败丢原绑定模型** | apps-desktop | P1（judge-r1 A.2(b)） | M | **与 `wave-b-core2 §9` 的 B 条同 PR**（`applyDefinition` 的 baseline 构造是同一段） |

**§6 #6（`invoke-registry`）不进本波执行面**：它是 N-P1-05（渲染层零类型门禁）的**下游症状**，
本体（424 基线分批清账 + 加门禁）归 `wave-e.md`。本分片只出「P2 侧配套」注记（§5），
把通道清单与 125 条 TS18046 的消减路径交出去，供 wave-e 分批时按文件取用。

### 0.2 为什么 §1/§2 可以排在 wave-b 最前

两条都满足：① 改动面各 < 10 行；② 无接口签名变更、无跨模块契约、**无回归面**；
③ **用户可感**（§1 = 改了配置没生效；§2 = 点查询直接白屏）。
按 `ledger-v2.md` §10 的波次原则「A 零风险止血 → B 用户可见功能缺陷」，这两条应作为 wave-b-apps 的先导。

### 0.3 本轮实跑得到的口径修正（三处，均与台账数字有出入）

| 台账数字 | 本轮实测 | 说明 |
|---|---|---|
| `renderer` typecheck **424** 条错误 | **411**（TS 6.0.3 实测） | `npx tsc --noEmit -p tsconfig.renderer.json`（`apps/desktop` 下）实跑，错误行 **411** 条。台账的 424 是 W11 时点数，本轮 `sr1-apps-c` 与 `sr1-e-a` 两源独立撞车同得 411（分布 `test/` 190 · `renderer/` 178 · `src/` 42 逐项吻合）；**终值以 `fix-spec/baseline.md` S1 定案**，下文的 410 / 402 等派生锚点均按 411 这条口径算 |
| §6 #6「本区 **125** 处 TS18046」 | **138** 条 TS18046，其中 **125** 条来自无响应类型组、**13** 条属另一个 `.props` 族 | 台账的 125 **正确**，但需补口径：138 = 125 + 13。这 13 条全在 `renderer/components/ui/Tooltip.tsx:145,149,153,157` 与 4 个测试文件（`test/fetch-models-modal.test.tsx:139,321`、`test/token-usage-stats-view.test.tsx:361,408,419,430,1334,1352`、`test/workspace-push-menu.test.tsx:89`），**与 `invoke-registry` 无关**，不得算进本条的消减账 |
| §6 #6 病灶含「**db 统计**」整组无响应类型 | ❌ **不成立** | `invoke-registry.ts:659` `ipcDbStats: noArg<IpcResult<DbStatsResult>>`、`:663` `ipcDbMaintenance: noArg<IpcResult<DbMaintenanceResult>>` **已带类型**。台账这一项须删 |

另核到台账未记的两条（写进 §5，不改台账口径）：

- `ChatHistorySearchPanel.tsx:106` 在 411 基线里是 **TS2345**
  （`renderer/features/chat/ChatHistorySearchPanel.tsx(106,20): error TS2345: Argument of type 'IpcErrorPayload' is not assignable to parameter of type 'SetStateAction<string | undefined>'`）
  ⇒ §2 修完，renderer 基线应从 **411 降到 410**（相对量 −1 不变）。这是本分片唯一可量化到个位的验收锚点。
- `invoke-registry.ts:649/653` 的 compaction 两个通道，**类型在 `shared/ipc-types.ts:1613/1622` 已经存在**
  （`CompactionConditionsDto` / `CompactionConditionsSetRequest`），只是没接进 registry，
  main 侧 `handlers/compaction-conditions.ts:12-37` 的返回签名也已经是 `IpcResult<CompactionConditionsDto | null>` / `IpcResult<void>`。
  ⇒ 这两通道是全组 30 个里**唯一零风险、纯补签名**的，可作 wave-e 分批的「第一刀」。

> 📌 **411 这个数字与 `packages/core/dist` 的构建状态相关**：本分片取基线时 `packages/core/dist` 已于 2026-10-01 02:34 建好
> （早于本文撰写 14:16），**不存在「dist 陈旧导致多报」的窗口**；台账的 424 已由本轮 reviewer 在同一 worktree、同 HEAD
> 下**两次独立实跑复现不出来**（均得 411，输出 825 行）。**若在未建 dist 的新 worktree 上取基线，
> 必须先 `npm run build -w @novel-master/core` 再跑 tsc**（RULE:136「新 worktree 验证清单」三件套），
> 否则基线会整体偏高、下面所有「恰好 −1 / 恰好 −9」的锚点全部失效。

### 0.4 R2 补写的三条（§7 / §8 / §9）——来源与本轮复核结论

| 条目 | 缺口成因（judge-r1 A.2） | 认领链 | 本轮复核结论 |
|---|---|---|---|
| **AM-3**（§7） | (a) 台账 §10 已排进 Wave、但没人写 ⇒ **真漏** | `ledger-v2.md:159` → `ledger-v2.md:457` Wave B「（同波顺带）」行 → `SPEC.md §2` → `wave-b-core2.md:1514`（「AM-3 → `wave-b-apps`，不立条」）→ **本条**（认领链最后一跳闭合） | 五个位置逐行复核**全部在位、零行号漂移**：`types.ts:16` / `RealPromptScreen.tsx:23` / `SessionDetailScreen.tsx:397` / `useChatTabController.ts:106-107` / `manager:470-479` |
| **S-D-04**（§8） | (b) §10 从未排进任何 Wave ⇒ 须显式补排 | `ledger-v2.md:167` → judge-r1 A.2(b) → **本条** | 病灶在位：`AgentEditorView.tsx` 与 `App.tsx` 全仓 `dirtyViews` **零命中**（本轮 `findstr /s` 实跑）；`settings-nav.ts:158-175` 守卫读侧完好；⚠️ **「⚙ 旁路 ⇒ 数据丢失」这半句被本轮推翻**，见 §8 病症的「口径修正」 |
| **E**（§9） | (b) 同上 | `ledger-v2.md:169` → judge-r1 A.2(b) → **本条** | 病灶在位：`:232-245` 吞失败 → `:346-356` 传 `null` → `:286-289` 解除 → `:517-521` 保存时 `delete definition.model`（**本轮补到台账未记的最后一跳**） |

**本轮新核出的两条口径修正**（台账未记，写在这里防止执行者照抄旧结论）：

1. **S-D-04 的 ⚙ 旁路不等于「静默丢数据」**。`SettingsOverlay` 关闭时**不卸载** view
   （`:249-256` 只切 `hidden` / `aria-hidden`，`renderContent()` 始终挂载）⇒ 从 ⚙ 关闭**不会**丢表单。
   真实后果是「`onClose()` 副作用不触发（`:361-364` 的 `notifyAgentConfigChanged()` 不跑 ⇒ 聊天侧智能体配置不刷新）」
   ＋「守卫对这个入口完全无效、与 × 按钮语义不一致」。**S-D-04 的数据丢失全部来自 ①（守卫恒 false）那四个走 `guardedNav` 的分发点。**
2. **E 的最后一跳（`:517-521`）台账只写到 `:346-356` 就停了**。没有这一步，「传 null」只是 UI 显示成「默认(跟随)」；
   有了它才是「用户随手改个名字点保存 ⇒ 模型绑定被静默删除」。

---

## 1 · N-P1-04 —— WorkspaceSettingsView 600ms 定时器闭包丢最后一次输入

- **严重度 / 簇**：P1 / apps-desktop。台账 §2.8 记为「对抗双侧撞车」（`w9-ds2-desktopfeat-a-2` × `w9-ds2-desktopfeat-b-4`，
  两个独立双扫机位各自命中）；§10 Wave B 行记「**双扫双中，改动零风险，用户可感**」。

- **病症**：`WorkspaceSettingsView` 的「隐藏起始深度」与「Token 比例」两栏防抖保存用
  `setTimeout(() => { void saveCompaction(); }, 600)`。`onChange` 里先 `setState`（异步，本帧不生效）、
  再调 `scheduleCompactionSave()`；`scheduleCompactionSave` 的依赖是 `saveCompaction`，
  `saveCompaction` 的依赖是 `[compactionEnabled, compactionTokenRatio, compactionHideStartDepth]`
  ⇒ 每次击键都重建 `scheduleCompactionSave`，**`onChange` 里拿到的是本帧闭包**，
  它捕获的 `saveCompaction` 又捕获的是**本次击键之前**的 state 值。
  600ms 后定时器落地的 `conditions.tokenRatio` / `conditions.hideStartDepth` 恒为**上一次击键前**的值。
  ⇒ **最后一次输入永远丢失**：用户把 0.8 改成 0.85、toast 弹「已保存」、库里还是 0.8；
  用户改「隐藏起始深度」6→7 同理。**无任何报错、无任何补救路径**（下次进设置页显示的还是旧值）。
  对照组：同组件 `:259-262` 的开关 `onChange` 走 `void saveCompaction(next)` 显式传参，
  在**同一渲染帧**内同步取值 ⇒ **开关那一路是对的**，只有防抖这一路错。

- **证据**（`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx`，本轮逐行核对）：

  ```
  163    const compactionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  168      compactionSaveTimer.current = setTimeout(() => {
  169        void saveCompaction();
  170      }, 600);
  171    }, [saveCompaction]);
  ```
  ```
  139    const saveCompaction = useCallback(
  140      async (nextEnabled = compactionEnabled) => {
  145            ...(compactionTokenRatio.trim() ? { tokenRatio: Number(compactionTokenRatio) } : {}),
  159      [compactionEnabled, compactionTokenRatio, compactionHideStartDepth],
  ```
  ```
  273                onChange={(e) => {
  274                  setCompactionTokenRatio(e.target.value);
  275                  scheduleCompactionSave();          // ← 闭包捕获上一帧值
  276                }}
  ```

- **修法**（单文件 · `WorkspaceSettingsView.tsx`，函数级）：

  1. 新增一个草稿 ref（放在既有 `compactionSaveTimer` ref 旁边，`:163` 之后）：
     `const compactionDraftRef = useRef({ enabled: compactionEnabled, tokenRatio: compactionTokenRatio, hideStartDepth: compactionHideStartDepth });`
  2. 新增一个 `useEffect(() => { compactionDraftRef.current = { enabled: compactionEnabled, tokenRatio: compactionTokenRatio, hideStartDepth: compactionHideStartDepth }; }, [compactionEnabled, compactionTokenRatio, compactionHideStartDepth]);`
     ——**放 effect 而非渲染期直接赋值**。定时器最短 600ms 才 fire，effect 早已跑完，时序上没有窗口。
  3. 把 `saveCompaction`（`:139-160`）改成**显式三参、依赖清空**：
     `const saveCompaction = useCallback(async (nextEnabled: boolean, tokenRatio: string, hideStartDepth: string) => { ...body 用 nextEnabled/tokenRatio/hideStartDepth... }, []);`
     依赖数组清空 ⇒ 恒定引用 ⇒ `scheduleCompactionSave` 的 `[saveCompaction]` 也不再重建。
     **函数体内部不得再读任何 state**（这是本条验收的「牙齿」所在）。
  4. `scheduleCompactionSave`（`:164-171`）的定时器回调改为：
     `const d = compactionDraftRef.current; void saveCompaction(d.enabled, d.tokenRatio, d.hideStartDepth);`
  5. 两处 `onChange`（`:250-253`、`:273-276`）**保持 `scheduleCompactionSave()` 无参调用不变**
     （value 由 ref 提供，改动面最小）；也可改为 `scheduleCompactionSave(e.target.value)` 显式传参的变体，
     但那样仍要单独处理另一个字段，**不如统一走 ref**。台账给的「显式传参」备选案差异在此记录。
  6. 开关那一路（`:259-262`）改为 `void saveCompaction(next, compactionTokenRatio, compactionHideStartDepth);`
     ——行为等价（当前帧值），只是配合签名改写。
  7. **不改任何对外接口**：`WorkspaceSettingsView` 无 props、无导出类型变更，`ipcCompactionConditionsSet` 的载荷不变。

- **验收**（可测断言 / 命令 + 期望）：

  1. **行为断言（主验收，有牙）**：新增用例「最后一次击键的值必须落库」——
     渲染 `WorkspaceSettingsView`，让 `ipcCompactionConditionsGet` mock 返回
     `{ ok: true, data: { schemaVersion: 4, enabled: true, tokenRatio: 0.8, hideStartDepth: 6 } }`；
     驱动「Token 比例」输入框的 `onChange` 连续触发 3 次（`"0.8"` → `"0.85"` → `"0.855"`），
     用 `mock.timers`（**须按上面测试策略显式限定 `apis: ['setTimeout','Date']`**）推进 `600ms`，
     断言捕获到的 `ipcCompactionConditionsSet` 载荷
     `conditions.tokenRatio === 0.855`。**把实现改回 `void saveCompaction()` 无参版，这条必须变红**（这就是 RULE「验收断言三条判据」的第一条：有牙）。
     ⚠️ **每次 `tick(600)` 之前先 `await act(async () => {})`**：让 `compactionDraftRef` 那条 passive effect 先落盘，
     否则断言读到的是**上一帧**的 ref 值，会假红成「ref 没同步」。
  2. 同款断言对「隐藏起始深度」再跑一遍，期望 `hideStartDepth === 7`。
  3. **不回归**：连打 3 次键、只推进 599ms，断言 `ipcCompactionConditionsSet` **调用次数为 0**（防抖语义未被破坏）。
     同样遵守「`tick` 前先 `await act(async () => {})`」的操作细节。
  4. **不回归**：开关那一路 `onChange` 仍即时保存（推进 0ms 即断言已调用 1 次），
     且载荷里的 `tokenRatio`/`hideStartDepth` 是**当前帧**值。
  5. 命令与期望：
     - `cd apps/desktop && npx tsc --noEmit` → 0 错误；
     - `cd apps/desktop && npx tsc --noEmit -p tsconfig.renderer.json` → **仍为 411**（本条不改类型面，见 §5 的搭车说明；基线口径见 §0.3）；
     - `cd apps/desktop && npm test` → 与 `baseline.md` 已知红清单一致、无新增红。
       ⚠️ **Wave A 的 N-P0-02 落地前**，Windows 上 `npm test` 会**收集 0 条并假绿**（`scripts/run-tests.mjs:30` 单引号 + `shell:true`），
       跑之前先按 RULE「新 worktree 验证清单」第三条用递归多扩展名收集器或手工指名文件。

- **测试策略**：

  - 新增测试文件：`apps/desktop/test/workspace-settings-compaction-debounce.test.tsx`
    ⚠️ **该文件位于 `test/**` 内、受 `apps/desktop/tsconfig.renderer.json` 的 `include`（`renderer/**/*`、`shared/**/*`、`test/**/*`）覆盖**，
    **它的类型错会直接计入 renderer 基线**，与验收 5.2 的「仍为 411」和 §2 验收 4 的「恰好 −1」两个锚点直接打架（RULE:109）
    ⇒ **新文件必须 0 类型错**（尤其注意 `ipcCompactionConditionsSet` 的返回是 `unknown`，
    调用处需先收窄或加 `as`，否则会把基线从 411 顶上去）。
  - 复用既有夹具（**全部已有，先例充分**）：
    - `test/react-alias-hook.mjs` —— 解决 `react-test-renderer`（根副本）与 `apps/desktop/node_modules/react`（工作区副本）
      双副本导致 hooks dispatcher 为 null 的问题（`chat-search-race-guard.test.tsx:40-41` 的既成写法）；
    - `test/chat-search-shell-nav-hook.mjs` + `test/chat-search-shell-nav-stub.mjs` —— 把 `useShellNav`
      重定向到 stub。本组件 `:37` 用的是 `notifyAgentConfigChanged`，**该 stub 目前只导出 `openChatLink`**：
      新用例要么给 stub 补 `notifyAgentConfigChanged: () => {}`（**改的是测试夹具，不碰生产代码**），
      要么新增一个 `workspace-settings-shell-nav-hook.mjs`；
    - `window.novelMasterDesktop.invoke` 拦截（`chat-search-race-guard.test.tsx:14` 的受控时序 mock 形态），
      用于把 `ipcCompactionConditionsGet` / `ipcCompactionConditionsSet` 的载荷录下来；
    - `node:test` 的 `mock.timers`，**必须显式限定 `apis`**：
      `t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })`。
      ⚠️ **不限定 `apis` 会让本条四条用例全部挂死**（Node v22 `MockTimers.enable()` 的默认档含 `setImmediate`，
      而 `react-test-renderer` 的 `act()` 靠 scheduler 的 `setImmediate`/`MessageChannel` 冲刷待办 work，
      mock 掉后 `act` 永不返回，且**死因看起来像「实现把定时器删了」**，会把执行者引到错误方向）。
      先例 `test/mermaid-markdown.test.tsx:208` 的 `enable({ now: 1_000 })` 不触发此坑，是因为那个文件不跑 `act`。
  - 用例名（拟）：
    - `T-CMPD-1 防抖 600ms 后落库的是最后一次击键的 tokenRatio`
    - `T-CMPD-2 防抖 600ms 后落库的是最后一次击键的 hideStartDepth`
    - `T-CMPD-3 599ms 未到点不落库（防抖语义保持）`
    - `T-CMPD-4 开关那一路仍即时落库且取当前帧值`
  - **不使用静态源码正则断言作为主验收**：`workspace-settings-subagent-stream.test.ts` 那类静态守卫
    （正则匹配 `useState(true)` 等）在本条上会是**恒真断言**——把 `scheduleCompactionSave` 改成任意形态它都可能照样绿。
    若行为用例因依赖树（`PickerModal` / `Switch` / `settings-ui` / `settings-feedback`）起不来，
    退路是给 `@/utils/settings-feedback` 加一个 stub hook 后再试，**不得**降级成正则断言。

- **回归线**（必须保持绿）：

  - `apps/desktop/test/workspace-settings-subagent-stream.test.ts`（同组件的既有静态守卫 3 条）
  - `apps/desktop/test/settings-nav-guard.test.ts`、`settings-agents-tabs.test.ts`
    （后者 6 例、静态守卫 `SettingsViews.tsx`，是全仓**唯一挂载 `WorkspaceSettingsView`** 的测试文件）
  - `apps/desktop/test/preferences-handlers.test.ts`、`compaction-handler.test.ts`（main 侧不动，应恒绿）

- **依赖**：

  - **前置**：无（Wave B 可独立先落）。
  - **前置（验收依赖）**：`fix-spec/baseline.md` 需已落盘（s-baseline 机位产出，registry.md L219 登记），
    否则验收 5.3 的「与已知红清单一致」这一句无处对照。
  - **可选搭车**：§5 的 compaction 两通道类型补齐（`invoke-registry.ts:649/653`）。两者改的是同一个文件的不同函数
    （`:141-152` 附近 vs `:649/653`），若同 PR 做，验收里那条「renderer 仍为 411」要改成
    「411 − 9 = 402」，且须先按 **RULE:109「给导出接口加必填字段前先扫手写假实现」** 扫一遍
    `test/` 下的手写 mock（`tsconfig.renderer.json` 的 `include` 覆盖 `test/**/*`，测试文件的类型错误会打红生产门限）。
  - **拍板项**：无。

- **风险与回滚**：

  - 风险 1（低）：把 `saveCompaction` 的依赖清空后，若**未来**有人新增了一个读 state 的字段而忘了接 ref，会重现同类 bug。
    缓解：在 `saveCompaction` 上方写明「**本函数必须只读入参，禁止读 state**」的注释；
    `T-CMPD-1/2` 是它的回归锁。
  - 风险 2（极低）：`compactionDraftRef` 用 `useEffect` 同步，若将来把防抖窗口缩到 0ms
    （与 `flush-run-ui` 之类的即时保存混用）会露出 effect 时序窗口。缓解：注释写明「600ms 窗口远大于 effect 时延，改窗口时必须重评」。
  - 回滚：本条只动一个 `.tsx` 的函数体与一个新增 ref/effect，**无数据迁移、无 IPC 契约变更、无新增导出**，
    `git revert` 单条即可，无残留状态需要清理。

---

## 2 · §6 #5 —— ChatHistorySearchPanel 查询失败白屏（**第二源复核成立 → P1**）

- **严重度 / 簇**：**P1** / apps-desktop。台账 §6 列为「单源 P0/P1 候补 #5」（`w9-ds2-desktopfeat-b-2` 报 P1），
  本轮为该条做**第二源独立复核**（对照 `fe79b781` 代码从零重推导，不读原报告论证）。
  §5 一致率表 `desktopfeat` 区把它记为「单方发现的真 P1」。复核结论见下方「复核记录」。

- **病症**：`runQuery` 的失败分支把 **对象**塞进了只接受 `string` 的 `setError`：
  `result.error` 是 `IpcErrorPayload`（`{ code: string; message: string; missingLogicalPaths?: readonly string[] }`），
  `?? '查询失败'` 兜底只在 `error` 为 `null/undefined` 时生效，而 `IpcResult` 的失败分支里 `error` **必存** ⇒
  兜底**永远走不到**，`setError` 恒收到一个对象。随后 `:263-266` 把 `{error}` 直接作为 React 子节点渲染
  ⇒ React 抛 `Objects are not valid as a React child` ⇒ **整个 renderer root 崩溃（无 ErrorBoundary 兜底）**：
  本轮 grep 全 `apps/desktop/renderer` 的 `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError` ⇒ **零命中**，
  面板的唯一挂载点是 `SessionDetailDrawer.tsx:368` ⇒ 异常一路冒到 React 18 root，**整棵树被卸载、整个窗口空白**，
  并不止「查找面板这一块白」。
  关键点：**这不是「错误提示不好看」，而是查询面板整块不可用**，且只在 `!result.ok` 时发生——
  即搜索 IPC 抛错时（后端未就绪、库被云同步占用、DB 维护中）。
  **对照证据（同文件、同一函数）**：`:70` 行的 `FileReferencePicker` 与 `:156` 行的
  `saveCompaction` 都正确地写了 `res.error.message` ⇒ 这是**单点笔误**，不是全组惯例。

- **证据**（`apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx`，本轮逐行核对）：

  ```
  51    const [error, setError] = useState<string | undefined>(undefined);
  ...
  105        if (!result.ok) {
  106          setError(result.error ?? '查询失败');        // ← IpcErrorPayload 对象
  ```
  ```
  263        {error ? (
  264          <p className="chat-history-search__error" role="alert">
  265            {error}                                    // ← 对象作 React child ⇒ 抛错白屏
  ```
  类型侧（`apps/desktop/shared/ipc-types.ts:211-220`）：
  `IpcErrorPayload = { readonly code: string; readonly message: string; readonly missingLogicalPaths?: ... }`；
  `IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorPayload }`（`error` 在失败分支必存）。

- **复核记录（本轮第二源复核，结论：成立，入账 P1）**：

  | 复核步 | 做法 | 结论 |
  |---|---|---|
  | ① 类型链路重推导 | 从 `setError` 的声明（`:51`，`useState<string \| undefined>`）正向推到 `:106` 的实参类型 | `result` 来自 `ipcMessagesSearch`，其注册类型是 `withReq<MessagesSearchRequest, IpcResult<ChatMessageDto[]>>`（`invoke-registry.ts:348-351`）⇒ `result.error: IpcErrorPayload` ⇒ **实参与形参类型不兼容，成立** |
  | ② 编译期坐实 | 实跑 `npx tsc --noEmit -p tsconfig.renderer.json` | 报出 `renderer/features/chat/ChatHistorySearchPanel.tsx(106,20): error TS2345: Argument of type 'IpcErrorPayload' is not assignable to parameter of type 'SetStateAction<string \| undefined>'` ⇒ **类型系统已独立报错，机理无争议** |
  | ③ 运行时后果重推导 | 从 `:263-266` 的 `{error}` 反推 React 语义 | React 对非字符串/数字/元素的对象子节点抛 `Objects are not valid as a React child`，且该 `error ? ... : ...` 位于面板主 render 体内；**全 `renderer/` grep `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError` 零命中**，唯一挂载点 `SessionDetailDrawer.tsx:368` 无边界包裹 ⇒ 异常冒到 React 18 root，整棵树被卸载 ⇒ **整个窗口空白**成立 |
  | ④ 可达性 | 查 `:105` 之前的所有退出路径 | `:102` 是序号守卫的早退（不写 error），`:105` 只在 IPC 返回 `ok:false` 时进 ⇒ 可达但**非必现**；失败来自 main 侧 handler 抛错被 `formatIpcError` 包装（与 `handlers/compaction-conditions.ts:20` 同款形态） |
  | ⑤ 与台账一致性 | 对台账 §6 #5 记录的 `:106` 逐字比对 | **逐字一致**，无行号漂移 |
  | **定级** | 综合 ①–⑤ | **P1**。理由：① 类型系统零争议（不是 suspected）；② 后果是**整个 renderer root 崩溃**而非提示退化；③ 落点只在失败分支，不影响正常查询；④ 修法 1 行、零风险。**判 P1 而非 P0**：主查询路径（`ok:true`）完全正常，崩溃有明确触发条件（后端 IPC 失败），且已有 `role="alert"` 的错误位可承载修复后的文案 |

- **修法**（单行 + 可选兜底，`ChatHistorySearchPanel.tsx`）：

  1. **主修**：`:106` 改为 `setError(result.error.message);`
     ——`IpcErrorPayload.message` 是 `string`（`shared/ipc-types.ts:213`），语义与同仓其余 20+ 处一致
     （`FileReferencePicker.tsx:70`、`WorkspaceSettingsView.tsx:156` 等）。
  2. **可选兜底（防未来再犯，推荐一起做）**：`:106` 写成
     `setError(result.error?.message ?? '查询失败');`
     ——`?.` 不是必需的（`IpcResult` 失败分支里 `error` 必存），但它让「兜底串」第一次真正可达，
     且**不掩盖任何真错误**（`message` 为空串时 React 也不崩）。
     **本 spec 默认案取步骤 1（严格贴合 `IpcResult` 契约）；步骤 2 列为备选差异注记。**
  3. **不做**的事（明确边界，防止 gold-plating）：
     - 不改 `error` 的 state 类型去迁就对象（会让 `:265` 继续崩）；
     - 不加 ErrorBoundary（那是架构变更，属 wave-e 的 X1 面，不在本条）；
     - 不改 `:264` 的渲染结构与 CSS class。
  4. **顺带扫同款笔误**（同 PR 内，成本近零）：在全仓 `apps/desktop/renderer` 内检索
     `setError\((\w+)\.error\b` 且**不是** `.message` 的写法，以及
     `setError\((\w+)\.error\s*\?\?` 的写法。
     本轮已核：当前 `renderer/` 下**只有 `:106` 这一处**（`synth/apps-desktop.md:414` 记录的
     「增删任一 `ipc*` 需同步四处」纪律说明 invoke 封装面就这些文件，逐个读过了）。
     ⇒ **扫完为空 ⇒ 只改一行**，不留额外 diff。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁（主验收，有牙）**：新增用例「IPC 返回 `ok:false` 时面板不崩、且渲染出 `error.message`」——
     mock `window.novelMasterDesktop.invoke` 让 `MESSAGES_SEARCH` 返回
     `{ ok: false, error: { code: 'VFS_ERROR', message: '查询失败：库被占用' } }`，
     提交表单后断言：
     - 面板内出现文本 `查询失败：库被占用`；
     - **`{error}` 位置不是对象**（等价断言：渲染树未抛异常，且 `role="alert"` 节点存在）。
     把 `:106` 改回 `setError(result.error ?? '查询失败')`，此用例**必须变红**。
  2. **兜底可达性**：mock 返回 `{ ok: false, error: undefined as never }`（人工构造，验证 `?.` 分支若被采纳），
     断言渲染出 `查询失败`。**此条只在采纳修法步骤 2 时启用。**
  3. **不回归**：同文件既有的互斥 / 序号守卫用例全绿
     （`chat-search-race-guard.test.tsx` **全文件只有 2 条** `it`：`:80` 源码互斥 + 请求序号守卫、`:90` 竞态行为；
     以及 `chat-search-collapsible-form.test.tsx` 全套 7 例）。
  4. **可量化锚点（最硬的一条）**：
     `cd apps/desktop && npx tsc --noEmit -p tsconfig.renderer.json`
     ⇒ **从 411 条降到 410 条**，且 `ChatHistorySearchPanel.tsx` 不再出现在输出里。
     （411 是本轮 TS 6.0.3 实测基线，**终值以 `fix-spec/baseline.md` S1 定案**；降不到 410 说明改法没落在 `:106`。）
  5. `cd apps/desktop && npx tsc --noEmit` → 0 错误；`npm test` → 无新增红（同 §1 的 Windows 假绿提醒）。

- **测试策略**：

  - **落点文件（既有，直接追加，零新夹具）**：`apps/desktop/test/chat-search-race-guard.test.tsx`。
    选它的理由（本轮核对）：该文件已经具备本条所需**全部**能力 ——
    ① `register(new URL("./react-alias-hook.mjs", …))` 已把 `react` 解析到根副本（`:40`）；
    ② `register(new URL("./chat-search-shell-nav-hook.mjs", …))` 已把 `useShellNav` 打到 stub（`:41`）；
    ③ 已在 `window.novelMasterDesktop.invoke` 上做受控时序 mock（文件头注释 `:14`）；
    ④ 面板是**动态导入**进来的（`:43-45`），不与静态 `renderToStaticMarkup` 用例抢 react 副本。
    追加用例不得改动既有 describe 块的结构与既有 mock 的时序语义。
  - 若 T-CF7 的时序 mock 结构（每次调用挂起、由测试放行）不便于「直接返回 ok:false」，
    则**新建** `apps/desktop/test/chat-search-error-render.test.tsx`，复用上述三个夹具 + 一个立即 resolve 的 invoke mock。
    **两个文件不得在同一进程内混用两套 react 副本**（`chat-search-race-guard.test.tsx:5-11` 的文件头注释已明写此纪律，
    `node --test` 按文件分进程天然满足）。
  - 用例名（拟）：
    - `T-CSErr-1 IPC 返回 ok:false 时面板不白屏，渲染 error.message`
    - `T-CSErr-2（仅采纳步骤 2 时）error 缺席时回落 '查询失败'`
  - **验收断言的牙齿自查**（RULE:85 三条判据）：本条断言的观测面是**渲染后的文本**，
    与被测实现（`:106` 传什么）**同源且不重叠**；不依赖进程级模块标记（无「被同文件第一条用例消费」的耦合）；
    不与任何既有用例共用互斥夹具。✅

- **回归线**：

  - `apps/desktop/test/chat-search-race-guard.test.tsx`（既有 2 例：`:80` / `:90`）
  - `apps/desktop/test/chat-search-collapsible-form.test.tsx`
  - `apps/desktop/test/messages-search-handler.test.ts`（main 侧 handler，本条不改，应恒绿）
  - `apps/desktop/test/message-list-stream.test.tsx`（`MessageList` 共用渲染面）

- **依赖**：

  - **前置**：无。可与 §1 同 PR（两处都是 renderer 单文件单行/小改），也可各自独立。
  - **相关但非前置**：§5（invoke-registry 类型补齐）。**本条不需要它**——
    `ipcMessagesSearch` 在 `invoke-registry.ts:348-351` **本来就是全类型标注的**
    （`IpcResult<ChatMessageDto[]>`）⇒ 这正是「TS2345 早就能报出来、只是没人跑这道门禁」的样本，
    正好作为 wave-e「先把它变成可见的红」的价值论据。
  - **拍板项**：无。

- **风险与回滚**：

  - 风险 1（极低）：`result.error.message` 在 `message` 为空串时渲染空白 `role="alert"`。
    缓解：这是 main 侧 `formatIpcError` 的产出，已被全仓 20+ 处同款写法验证过；不额外加逻辑。
  - 风险 2（无）：不改类型、不改契约、不改渲染结构，**不存在跨模块影响**。
  - 回滚：`git revert` 单条，无任何落盘状态需要清理。

---

## 3 · AM-1 —— `forgetSession` 零生产调用 + 两张无界 Map

- **严重度 / 簇**：P1 / apps-mobile。台账 §2.7 记「5 处独立撞车 + W6 行号抽查 + revalidate-b valid（行号完全未漂）」。
  **拍板项 #13 前提照旧**：`ledger-v2.md` §7 #13「AM-1 是否整体降 P2」的默认建议是
  「**不降级**；若最终决定降 P2，『加 LRU』这半个修法仍要保留」，
  且 revalidate-b 已复核「两张 Map 仍无界、无任何 LRU」⇒ **「不降级」的前提成立，本条按 P1 写全七要素**；
  **即使终局用户改判降 P2，下半张（挂 500 LRU）也必须保留**（见「风险与回滚」）。

- **病症**：`SessionStreamUnitManager.forgetSession` 的 JSDoc 明写「**Step 6 会话删除链路调用**」，
  但**全仓生产调用方为 0**（本轮实跑 grep `apps/mobile/src` + `packages`：只命中 manager 自身的
  3 处注释（`:50` / `:246` / `:323`）与定义行 `:717`；测试侧 6 处命中在
  `__tests__/session-stream-unit-manager.service.test.ts:765` 与 `__tests__/session-stream-unit-persist.test.ts`）。
  ⇒ 用户删除会话后，manager 里四张 Map 全部残留该会话：
  ① `idleMessageViews` —— 存的是**深拷贝的整段消息面**（`removeUnit:1624-1629` 是 `[...handover.messages]`，
     `hydrateSessionMessages` 侧同款），会话已从库删掉、用户已在 UI 上看不到，**内存里仍留着全文副本**；
  ② `settledProjections` —— 「上次生成」的常驻投影，无上限；
  ③ `pendingChildParentByChild` —— 双向父子反查，作为父/子两侧都残留；
  ④ `units` / `consumptiveSessions` / `writethroughs` —— 活跃单元与 `agentActive` refcount **不减**，
     活跃单元删除后永远挂着（`forgetSession:732` 的 `decrementAgentActive` 永不执行）。
  另有一层与删除链路无关的病：**两张 Map 无上界**，用户长期使用会单调增长（`SESSION_STREAM_MAX_SETTLED_UNITS = 8`
  这个常量只管 `units`，管不到它们）。

- **证据**（本轮逐行核对）：

  ```
  353    private readonly settledProjections = new Map<string, SessionStreamSettledProjection>();
  358    private readonly idleMessageViews = new Map<string, IdleMessageView>();
  ```
  ```
  717    forgetSession(sessionId: string): void {
  732        decrementAgentActive();                 // ← 活跃 refcount 的唯一减点
  738      this.settledProjections.delete(sessionId);
  739      this.idleMessageViews.delete(sessionId);
  740      this.notifyChanged();
  ```
  ```
  524        await runtime.sessions.delete(targetSessionId);   // useChatTabScope handleDeleteSession
  526        clearSessionViewCache(sessionViewCacheKey(projectId, targetSessionId));  // ← 只清外部缓存，不碰 manager
  570          await runtime.sessions.delete(id);                // deleteSelectedSessions 循环体，同款
  ```
  本轮 grep 佐证：`apps/mobile/src` 与 `packages` 全域内 `forgetSession` 命中仅 4 行，全在 manager 自身
  （3 行注释 + `:717` 定义），**生产调用方 = 0**；`__tests__` 侧另有 6 处调用（说明 manager 侧行为本身有测试）。

- **修法**（两个文件 · 三个函数级步骤 + 一个新建模块）：

  **上半张 · 三处删除成功分支补调（改 `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts`）**
  —— 该 hook 的入参里已有 `runtime: MobileNovelMasterRuntime`（`:51` / `:62`），
  `runtime.sessionStreamUnitManager` 直接可达，**不需要新增任何依赖或上下文**。

  1. `handleDeleteSession`（`:521-541`）：在 `await runtime.sessions.delete(targetSessionId);` 成功之后、
     `clearSessionViewCache` 旁边补
     `runtime.sessionStreamUnitManager.forgetSession(targetSessionId);`
     （放 `try` 块内、删除成功之后；`forgetSession` 是纯内存同步方法、不抛错，不影响 `catch` 语义）。
  2. `deleteSelectedSessions`（`:564-589`）：循环体 `:570` 之后**逐个**补
     `runtime.sessionStreamUnitManager.forgetSession(id);`
     ——该函数是「部分成功语义」（`:567` 注释：先删成功的保持已删、不回滚），
     因此**每个 delete 成功就要立刻 forget 一次**，不能攒到最后统一做。
  3. `handleDeleteProjects`（`:591-610`）：项目删除会**级联删掉该项目下全部会话**，
     但 manager 的两张 Map **以 sessionId 为键、不含 projectId 维度**
     （`projectId` 只被透传给外部的 `sessionViewCacheKey`，见 `:852/:869/920`）
     ⇒ **不能**从 hook 侧的 `sessions` state 枚举（`:396-417` 的 `reloadLists` 只装当前项目的会话）。
     **默认案（⚠️ 已知缺口：只覆盖顶层会话）**：删除**前**先 `const doomed = await runtime.sessions.listByProject(id);`，
     `await runtime.projects.delete(id);` 成功之后 `for (const s of doomed) { manager.forgetSession(s.id); }`。
     `listByProject` 是已存在的读口、项目删除是低频重操作，多一次读可接受。
     **缺口显式声明（执行者必须知道，不要当成漏做）**：`listByProject` 的 SQL 硬编码
     `parent_session_id IS NULL`（`packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts:38-49`，`:44`）
     ⇒ 返回值**只有顶层会话，子 agent 会话不在结果里**；而 manager 恰恰为子会话写过 `settledProjections`
     （消费型分支 `:1414-1427` 的 `:1421`）⇒ **项目删除后子 agent 会话的条目仍会残留**，
     **靠下半张 LRU（500 上限）兜底**，不靠本步。
     ⇒ 本步**必须**在 `handleDeleteProjects` 上留一条 TODO，注明「`listByProject` 只返顶层会话，
     子 agent 会话缺口待 core 侧补 BFS 读口后回收」，并在 `docs/apm/RULE.md` 登记「manager 的会话↔项目归属缺口」。
     备选差异注记：若不接受这次额外读，则本步退化为「只靠下半张 LRU 兜底」，TODO 与 RULE 登记同样**必须**保留。

  **下半张 · 两张 Map 挂 500 LRU（改 `apps/mobile/src/services/session-stream-unit-manager.service.ts`）**

  4. 在 `apps/mobile/src/services/scope-key-cache.ts` 中新增一个与 `createScopeKeyCache` **同款 LRU 语义**的
     扁平工厂 `createLruMap<T>(maxEntries: number)`，返回 `{ size, get, set, clear, clearAll }`
     （**不要**复用 `createScopeKeyCache`：它的返回类型把 `key(projectId, sessionId)` 与
     `clearByProjectPrefix` 列为必需成员，而这两张 Map 的键是裸 sessionId，用它会产生两个从未被调用的死成员）。
     实现直接抄 `createScopeKeyCache:23-54` 的 `Map` + 命中刷新新鲜度 + 超限淘汰最旧那段。
  5. `:358` 的 `idleMessageViews` 与 `:353` 的 `settledProjections` 改用 `createLruMap<...>(500)`。
     **本轮已核全部使用点**（grep 逐行）：
     `idleMessageViews` = `get` ×5（`:896/:906/:983/:998/:1026`）+ `set` ×8（`:923/:929/:991/:1003/:1019/:1028/:1043/:1624`）
     + `clear` ×1（`:739`）+ `clearAll` ×1（`:1971`）；
     `settledProjections` = `get` ×2（`:685/:706`）+ `set` ×3（`:636/:1421/:1443`）+ `clear` ×1（`:738`）+ `clearAll` ×1（`:1970`）。
     ⇒ **映射 1:1 无缺口**；且**两处都没有任何迭代**（本轮已 grep `of this.settledProjections` /
     `.keys()` / `.entries()`，零命中）⇒ LRU 的「命中即 delete+set 重排顺序」语义**不影响任何既有逻辑**。
  6. LRU 上限常量 `500` 与 `apps/mobile/src/services/chat-session-view-cache.ts:12`
     （`createScopeKeyCache<SessionViewCache>({ maxEntries: 500 })`）**同口径**，
     且 `__tests__/scope-cache-lru-bound.test.ts:26` 已把 `const CAP = 500` 钉成测试常量 ⇒ 沿用，不新造数字。
  7. **不改**：`units`（已有 `SESSION_STREAM_MAX_SETTLED_UNITS = 8` 的 `evictSettledOverflow` LRU，见 `:158-158` / `:1592-1606`）、
     `writethroughs`、`listeners` —— 都不在本条范围。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁 A（主验收，有牙）**：mock runtime 的 `sessionStreamUnitManager.forgetSession` 为 `jest.fn()`，
     驱动 `handleDeleteSession` 成功删除 s1 ⇒ 断言 `forgetSession` **被以 `'s1'` 调用恰好 1 次**；
     `delete` 抛错 ⇒ 断言 `forgetSession` **调用 0 次**（不得在失败路径上误清）。
  2. **回归锁 B（部分成功语义）**：批选三个会话 `[s1,s2,s3]`，让 `sessions.delete` 在 s2 上抛错
     ⇒ 断言 `forgetSession` 依次收到 `s1`、**然后停住**（s2/s3 未删不得清），
     且 `deletedSessionIds` 顺序为 `s1,s2`（与既有 `use-chat-tab-scope-batch-delete.test.ts` 的夹具同款）。
  3. **回归锁 C（项目删除）**：mock `sessions.listByProject` 返回 `[{id:'p1s1'},{id:'p1s2'}]`，
     `projects.delete('p1')` 成功 ⇒ 断言 `forgetSession` 收到 `p1s1`、`p1s2`；
     `projects.delete` 抛错 ⇒ 断言两者都**未**收到。
     **本锁必须同时带一条负向断言**：在 `listByProject` 的返回值里塞一个**子 agent 会话**
     （如 `{id:'p1s1c1', parentSessionId:'p1s1'}`），断言它的 id **不在** `forgetSession` 的参数序列里。
     ⚠️ 这条**断言的是「漏清」这个已知缺口本身**（对应 B-3 裁决①，`listByProject` 硬编码
     `parent_session_id IS NULL`），**不是缺陷、不是待修的 red**——它写在用例里是为了让缺口**显式可见**，
     将来 core 侧补上 BFS 读口后，这条断言会翻红并提醒把缺口回收掉。
     反过来说，**正因为本锁把 `listByProject` mock 掉了（唯一能暴露该缺口的信息源），
     单独看「顶层会话被清了」这条正向断言对子会话漏清是恒绿的** ⇒ 负向断言是本锁唯一的牙。
  4. **回归锁 D（LRU 封顶）**：往 `idleMessageViews` / `settledProjections` 各灌 `CAP + 1` 个会话
     ⇒ 断言暴露的 size 探针 `=== CAP`，且最早那个 id 的读口返回 `undefined`
     （探针按 `chat-session-view-cache.ts:46-49` 的 `*CacheSize()` 先例，在 manager 上加两个
     test-only 导出 `idleMessageViewsSize()` / `settledProjectionsSize()`）。
  5. **回归锁 E（LRU 不误伤活跃会话）**：灌满 500 后，**重新读一次**最近写入的那个会话
     （命中即刷新新鲜度）⇒ 断言它**仍可读**，而被淘汰的是最早写入的那个。
  6. **不回归**：既有 `session-stream-unit-manager.service.test.ts` 全套
     （含 `:654` 的 `T-U1: LRU 上限 8`、`:764-765` 的 `forgetSession` 行为用例、`:1140` 的 interrupted 用例）
     与 `session-stream-unit-persist.test.ts` / `session-stream-unit-messages.test.ts` /
     `session-stream-unit-pipeline.test.ts` / `session-stream-unit-s6-wiring.test.ts` 全绿。
  7. 命令与期望：
     - `cd apps/mobile && npx tsc --noEmit -p tsconfig.build.json` → 0 错误；
     - `cd apps/mobile && npm test -- --maxWorkers=2` → 全绿（**除已知红的 1 条**，见下）。
       ⚠️ **`--maxWorkers=2` 是硬要求**（RULE:111：满负载下 mobile 全量会挂 `metric-detail-sheet`
       与 `stream-token-estimator` 两个耗时护栏用例，`--maxWorkers=2` 稳定复现）。
       🔁 **R2-14 已刷新分母**：本行原文写「稳定 1604/1604」，那是 W11 台账口径、**已过期**；
       `fix-spec/baseline.md §3.3 / §4` 实测为 **1739 tests / 237 suites / 1738 pass / 1 fail / 1 snapshot passed**
       （命令 `npm test -- --maxWorkers=2`，cwd = `apps/mobile`，日志 `tmp/baseline-08-mobile-jest.log`），
       那 1 条是**确定性真红** `__tests__/mermaid-fullscreen.test.ts` 的 `T-MF3`（源码正则断言，隔离复跑仍红）。
       ⇒ 本条与 §7 的验收口径统一为「**红条目仍为 1 条、位置不变**；分母因新增用例而 +N，不要求等于 1739」。
     - `cd apps/mobile && npm run lint` → 警告数不增（脚本自带上限 `--max-warnings 321`）。
  8. **移动端真机/模拟器**（可选，AGENTS.md 硬规则）：本条是纯内存生命周期修复，
     **不需要出包实测**即可验收；若要实测，走「Metro 从真实路径起 + `adb install -r -d` 覆盖装」，
     **任何设备一律禁止 `adb uninstall` / 清除应用数据**。

- **测试策略**：

  - **新增**：`apps/mobile/__tests__/use-chat-tab-scope-forget-session.test.ts`
    ——夹具从 `use-chat-tab-scope-batch-delete.test.ts` **整份复制其 mock runtime 骨架**
    （`deletedSessionIds` / `deletedProjectIds` 数组在 `:49-50`、`mockRuntime` 在 `:52-76`），
    额外在 `mockRuntime` 上挂 `sessionStreamUnitManager: { forgetSession: jest.fn() }`。
    理由：`node --test` 按文件分进程，但 **jest 的 `jest.mock` 是按文件隔离的**，
    把新断言塞进既有文件会与它既有的 `chat-agent-meta` / `chat-prompt-tokens.service` mock 交织，
    独立成文件更符合 RULE:85 第二条（「同一份夹具只服务一套期望」的同族风险）。
  - **必须同时改既有夹具（B-4，漏改会直接变红）**：在
    `apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` 的 `mockRuntime`（`:52-76`）上
    **加 `sessionStreamUnitManager: { forgetSession: jest.fn() }`**。
    理由：该文件的 `mockRuntime` **没有**这个字段，补调后 `runtime.sessionStreamUnitManager.forgetSession(...)`
    会抛 `TypeError`，被 `deleteSelectedSessions` / `handleDeleteProjects` 的 `catch` 吞成 toast
    ⇒ `:145` 的 `expect(mockShowToast).not.toHaveBeenCalled()` **变红**（`handleDeleteProjects` 三条同理）。
    全仓仅此一个文件触碰删除路径，**只改测试夹具、不碰生产代码**（符合 RULE）。
  - **新增**：`apps/mobile/__tests__/session-stream-unit-maps-lru-bound.test.ts`
    ——夹具从 `scope-cache-lru-bound.test.ts:26` 的 `const CAP = 500` 与 `beforeEach` 清空形态照抄，
    被测对象换成 manager（新建 manager 需注入 `sessionStreamUnitManager.service.test.ts:72-77` 那套
    `new SessionStreamUnitManager({runtime, runAgentTurn, yieldQuantum})` 的 `SessionStreamUnitManagerParams`）。
    ⚠️ 该文件**必须独立**（独立 jest 进程），否则 `runStartupMaintenanceOnce` 类进程级标记会被同文件首条用例消费。
  - **两张 Map 都是 `private`、无 test-only 注入口 ⇒ 灌数路径必须写死（B-5，否则测试落不了地）**：
    - `idleMessageViews`：用**公开**的 `hydrateSessionMessages(projectId, sessionId)`（`manager:915-936`，无单元即写）循环灌；
    - `settledProjections`：**只能**注 fake `runStateService.listByStatuses(['settled'])` 返回 `CAP+1` 条 settled 行，
      调 `markHydrated()` 后 `await hydrate()` 走 `:626-655` 的回填分支；
      ⚠️ `hydrate` 是**逐行** `await this.yieldQuantum()`，构造时必须注 `yieldQuantum: async () => {}`（见 `:291` / `:631`），
      否则 `CAP+1` 次会让用例慢到超时；
    - **不要**走「跑 `CAP+1` 次真实 run 收尾」那条路（`:1421/:1443` 每次都带 `upsertSettledRunStateQuietly` +
      `persistFinalRateQuietly` 的 fire-and-forget 副作用）。
  - 用例名（拟）：
    - `T-AM1-1 会话删除成功 → forgetSession(id) 恰一次；删除失败 → 零次`
    - `T-AM1-2 批量删除部分成功 → 只 forget 已删成功的，失败及其后的不清`
    - `T-AM1-3 项目删除成功 → 该项目的顶层会话被 forget；删除失败 → 零次；子 agent 会话**不被** forget（已知缺口，B-3 裁决①）`
    - `T-AM1-4 idleMessageViews / settledProjections 插入 CAP+1 → size 封顶且最旧淘汰`
    - `T-AM1-5 LRU 命中刷新新鲜度 → 最近读过的会话不被淘汰`
  - **验收断言的牙齿自查**：断言 1/2/3 的观测面是 **`forgetSession` 的调用参数序列**（注入缝，与实现同源且可注入，
    优于 SQL 探针）；断言 4/5 的观测面是 **size 探针 + 具体 id 的读口**，
    两者都**不是**「map 里没有这个 key」这种可被实现换形态绕开的弱观测。

- **回归线**（必须保持绿）：

  - `apps/mobile/__tests__/session-stream-unit-manager.service.test.ts`（含 `T-U1`、`forgetSession`、interrupted 三族）
  - `apps/mobile/__tests__/session-stream-unit-persist.test.ts`、`-messages`、`-pipeline`、`-s6-wiring`
  - `apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts`（**本条改的是同一个 hook**，
    其「部分成功」三条断言必须仍绿 —— 这是最关键的一条交叉回归；
    **且本条必须给它的 `mockRuntime` 补 `sessionStreamUnitManager: { forgetSession: jest.fn() }`，见测试策略 B-4**）
  - `apps/mobile/__tests__/chat-session-view-cache.test.ts`、`scope-cache-lru-bound.test.ts`、`scope-key-cache.test.ts`
  - `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`、`chat-composer.integration.test.tsx`

- **依赖**：

  - **前置**：无（Wave B 可独立先落；与 §4 文件不相交，可并行）。
  - **🔁 B-3 的跨簇建议（方案②）——judge 已裁（R2-16，本分片 R2 补写）：不立条目**。
    judge-r1 G 节的四条理由：① **量级错配**——从 S 涨到 M 且要动 **core 的公共接口**，
    触发 RULE:109「给导出接口加必填字段前先扫手写假实现」，会把 `wave-b-apps` 从「小改、文件不相交」
    变成「跨 core 公共面的接口变更」，与本分片定位冲突；
    ② **AM-1 已有正确兜底**（本条方案①已把缺口显式化：TODO + 验收负向断言 + RULE 登记，缺口不会被当成「已修」）；
    ③ **台账没把它算进 AM-1**（`ledger-v2.md:158` 的 AM-1 修法原文是「三处补调 + 两张 Map 挂 500 LRU」，没有 BFS）
    ⇒ 它是**独立于 AM-1 的另一条缺陷**，不该搭 AM-1 的车改口径；
    ④ **不属于 Wave B–E 的执行面**（更接近 wave-e X1 Step 1 的 `shared/logic/*` 再导出面）。
    **处置（本分片按此执行，不再回头请示 judge）**：
    - **不立七要素条目**，登记为**债务池 P2**（建议编号 `N-P1-08` 或 `AM-6`，由主代理定）；
    - 在 `ledger-v2.md §7` 拍板项里**新增一条**：「是否给 `SessionService` 增 `listByParentSession`
      以在 apps 侧做 BFS 展开（涉及 core 公共接口 + RULE:109 假实现扫描）」——
      这是**范围取舍**，属用户/主代理的账（judge-r1 H.4 已列入 execute-ready 请用户拍）；
    - 病灶事实（judge 复核，**本分片不重复论证**）：`packages/core/src/service/chat/session.port.ts`（全文 88 行）
      的会话枚举方法**只有 `listByProject`**；`listByParentSession` 只在 repository 端口
      `packages/core/src/domain/chat/repositories/session.port.ts:14` 有；core 自己的两处都做了 BFS 展开
      （`project.service.ts:160-171` / `physical-vfs.service.ts:311`、`:511`）
      ⇒ **AM-1 步骤 3 的子 agent 会话缺口属实**，本条照方案①落盘。
  - **拍板项 #13**：`ledger-v2.md` §7 #13「AM-1 是否整体降 P2」——默认建议「不降级」，
    本分片按默认案写；**若终局改判 P2**：
    **上半张（三处补调）可撤、下半张（挂 500 LRU）必须保留**（台账原文：「『加 LRU』这半个修法仍要保留」）。
    这也是本条把两半写在一起、且 LRU 半独立成步骤 4-6 的原因。
  - **与 §4 的关系**：§4 改 `navigation/types.ts` + `FileEditorScreen` + `SubagentSessionScreen` 的 navigate 调用点；
    本条改 `useChatTabScope` 的**删除分支**。两者同文件不同函数（`openFileEditor:616` vs 删除三函数 `:521/:564/:591`）
    ⇒ **同 PR 可行，但建议分两个提交**，避免交叉回归时定位困难。

- **风险与回滚**：

  - 风险 1（中，**唯一需要盯的**）：**挂 LRU 后，「无单元会话的消息面」在超过 500 个会话后可能消失**。
    表现：用户切到一个很久没打开过的会话，首帧消息区空白，直到某次重新水合/分页才补上。
    缓解：`removeUnit:1618-1629` 的交接语义（投影消息面 → idle 视图）保证**活跃/刚结束**的 run 一定在
    `units` 里（有独立的 `SESSION_STREAM_MAX_SETTLED_UNITS = 8` 保护），
    500 上限只影响「长期没碰的会话」——这类会话重进时必走 `loadSessionTailMessages`
    （JSDoc 起于 `:843`、分发体 `:850-861`，无单元时转 `loadIdleTailMessages:948-976`）
    或 `hydrateSessionMessages`（`:915`）重新填充。**验收 5 就是这条风险的锁**。
  - 风险 2（低）：`handleDeleteProjects` 新增的 `listByProject` 读口在项目会话数极大时会拖一点删除耗时。
    缓解：项目删除是低频重操作，且 `listByProject` 是已有索引读口；必要时与 `projects.delete` 并行发起。
  - 风险 3（低）：`createLruMap` 是新导出符号 ⇒ 会被 Wave D 的死码普查当成候选。
    缓解：新符号有生产调用方（步骤 5），且注释里写明「与 `createScopeKeyCache` 同款 LRU 语义、为何不复用」。
  - 回滚：上半张与下半张**可独立回滚**——
    - 只回滚下半张（改回裸 `new Map`）：三处 `forgetSession` 调用仍在，删除路径正确性不受影响，
      只是回到「无上界」；两个 test-only size 导出可一并撤。
    - 只回滚上半张：LRU 仍在兜底，删除会话后条目最多存活到被淘汰为止（不再是永久泄漏）。
    - 全量 `git revert`：无数据迁移、无 schema 变更、无 IPC 契约变更。

---

## 4 · N-P1-03 —— `FileEditor` 路由参数「函数进 params」双重违规

- **严重度 / 簇**：P1 / apps-mobile。台账 §2.7 记「**多源**（`w9-mobilenav-pro-1` 与 `w9-mobilenav-2` 同区两条 P1；
  对抗方让步清单**未列**）；W11 复核 `types.ts:51` 确仍是这个函数 param」。
  本轮二次核对确认行号无漂移。

- **病症**：`FileEditor` 路由的 params 类型里放了一个**函数**：
  ```ts
  /** Called after a successful session-scope save (refreshes workspace list). */
  onSessionVfsSaved?: () => void;
  ```
  两重违规：
  ① **可序列化性**：React Navigation 的 `params` 会被写进 state（`navigate` 的 `merge`/`freeze`、状态持久化、
    深链解析都要求可序列化），函数值在序列化时被**丢弃**。仓库自己的既有文档已经写明了这条铁律——
    `apps/mobile/src/navigation/types.ts:60-61` 的 `PromptEditor` 注释：
    「回调不走路由参数（不可序列化），由 prompt-editor-callback 模块级存取」。
    ⇒ **同一份类型文件里，另一条路由已经按这条规矩做了，`FileEditor` 没做。**
  ② **零调用方**：全仓 grep `onSessionVfsSaved` 只有 3 处命中——
    类型声明 `types.ts:52`、`FileEditorScreen.tsx:60` 的解构、`:190` 的调用点。
    **8 个 `navigate('FileEditor', …)` 调用点一处都没传它** ⇒ `onSessionVfsSaved?.()` 恒为 `undefined?.()`，
    即恒 no-op ⇒ **session scope 保存成功后，聊天页工作区列表不刷新**（用户刚改完文件、回到会话、
    看到的是旧的工作区内容）。

- **证据**（本轮逐行核对）：

  ```
  apps/mobile/src/navigation/types.ts
  51      /** Called after a successful session-scope save (refreshes workspace list). */
  52      onSessionVfsSaved?: () => void;
  ```
  ```
  apps/mobile/src/screens/stack/FileEditorScreen.tsx
  60    const {path, scopeKind, projectId, sessionId, skillRef, onSessionVfsSaved} =
  ...
  190            onSessionVfsSaved?.();
  ```
  调用面核实（grep `'FileEditor'`，8 处 `navigate`）：
  `useChatTabScope.ts:625`（session scope）、`:632`（project scope）、
  `SubagentSessionScreen.ts:185`（session scope）、`:215`（session scope）、`:222`（project scope）、
  `GlobalTemplateScreen.tsx:31`（**physical** scope）、`SkillDetailScreen.tsx:98`（**skill** scope），
  外加注册处 `RootNavigator.tsx:167` 与类型处 `FileEditorScreen.tsx:35`
  ⇒ **session scope 的调用点 3 处，非 session 的 4 处（project 2 + physical 1 + skill 1）**，
  **两类都没有传该 param**。（本条修法只碰那 3 处 session 调用点，非 session 的 4 处不接线。）

- **修法**（`FileEditor` 删 param + 走仓库既有「模块级回调存取」范式）：

  1. **新建** `apps/mobile/src/components/agent/file-editor-saved-callback.ts`，
     **逐字照** `apps/mobile/src/components/agent/prompt-editor-callback.ts` 的形状：
     模块级 `let onSaved: (() => void) | null = null;`
     + `export function setFileEditorOnSessionVfsSaved(cb: () => void)`（push 前写入，每次覆盖）
     + `export function takeFileEditorOnSessionVfsSaved(): (() => void) | null`（挂载时读取并清空，
     **take 语义防串台**，与 `prompt-editor-callback.ts:17-22` 的注释理由一致）。
     模块头注释照抄 `prompt-editor-callback.ts:2-6` 的理由陈述（「React Navigation 路由参数要求可序列化，
     函数放进 params 会触发 "Non-serializable values" 警告」）。
     **不复用 `prompt-editor-callback.ts` 本身**：它的签名是 `(text: string) => void`，语义与取值时机都不同。
  2. **删** `apps/mobile/src/navigation/types.ts:51-52` 两行（含那句已失效的注释）。
  3. **改** `apps/mobile/src/screens/stack/FileEditorScreen.tsx`：
     `:60` 的解构去掉 `onSessionVfsSaved`；组件内改为
     `const onSessionVfsSavedRef = useRef<(() => void) | null>(takeFileEditorOnSessionVfsSaved());`
     （**只在 session scope 保存成功那一个分支** `:190` 处 `onSessionVfsSavedRef.current?.();`，保持其余保存路径不触发）。
     ⚠️ **必须走 `useRef` 惰性初始化，不能把 `take…()` 裸写在渲染体里**：
     `FileEditor` 挂载后的首次 `setContent`（加载完成必然触发）之后的**任何一次重渲染**都会再 take 一次、
     拿到 `null` 并覆盖局部变量 ⇒ 回调事实上永不生效，**正好复现原病灶**。
     仓库正确范式见 `PromptEditorScreen.tsx:105-107`
     `const onSavedRef = useRef<PromptEditorOnSaved | null>(takePromptEditorOnSaved());`。
  4. **接线**（3 处 session scope 调用点）：
     - `useChatTabScope.ts:625` 的 `openFileEditor`（`scopeKind === 'session'` 分支）：
       `navigate` 之前 `setFileEditorOnSessionVfsSaved(bumpWorktreeUiToken);`
       —— `bumpWorktreeUiToken` 是该 hook 已有的工作区列表刷新入口
       （`:612-614` 定义，`:762-763` 已从 hook 返回），**零新增 state**。
     - `SubagentSessionScreen.tsx:185`（`onOpenToolFile`）与 `:215`（链接分支）：
       本轮已核 `:63-69` 的 state 只有 `messages` / `initialLoading` / `richTextEnabled` / `unitView` / `webviewReadyEpoch`
       ⇒ **该屏没有工作区列表**。
       **默认案**：这两处 `setFileEditorOnSessionVfsSaved(() => {})`（显式传 no-op 并写注释说明
       「子会话屏无工作区列表，保存后的刷新对象是主会话工作区，由主会话侧重进时补齐」），
       **不**擅自给该屏新建列表 state。
       备选差异注记：若产品要求子会话屏也要即时刷新，则另立一条给该屏加 `bumpFileListToken`，
       **不并进本条**（会把 P1/S 膨胀成 M）。
  5. **加编译期回归锁**：**新建** `apps/mobile/src/navigation/param-serializability.ts`，
     放 `type AssertNoFn<T> = T extends (...args: never[]) => unknown ? false : true;` +
     `const _fileEditorParamsAreSerializable: AssertNoFn<RootStackParamList['FileEditor']> = true;`
     （由 `tsconfig.build.json` 覆盖 ⇒ 「不可序列化成员不得进 params」从此有牙，见验收 1）。
     放 `src/` 而非 `__tests__` 的理由见验收 1 的 ⚠️ 注记。
  6. **明确不做**：
     - 不改 `FileEditor` 的其余 params（`path`/`scopeKind`/`projectId`/`sessionId`/`skillRef` 全部可序列化，正确）；
     - 不改 `saveVfsEditableFile` 的 IPC 契约；
     - 不动 `PromptEditor` 路由（它已经是对的，`:60-61` 注释即正确范式，本条只**引用**它）。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁 A（契约，有牙 —— ⚠️ 必须落在 `src/` 的编译期断言，不能写在 jest 用例里）**：
     **新建** `apps/mobile/src/navigation/param-serializability.ts`，放一条**编译期**断言：
     `type AssertNoFn<T> = T extends (...args: never[]) => unknown ? false : true;`
     `const _fileEditorParamsAreSerializable: AssertNoFn<RootStackParamList['FileEditor']> = true;`
     （`RootStackParamList` 从 `@/navigation/types` import）。
     把它放到 `src/` 内是因为 **mobile 的 jest 用 `@react-native/jest-preset`（babel-jest，`jest.config.js:11`）不做类型检查**，
     类型表达式会被 babel 直接抹除；且 `tsconfig.build.json` 的 `exclude` 含 `__tests__/**/*` ⇒
     **写在 `__tests__` 里的「逐字段取 `typeof`」是永远不会红的废断言**（违反 RULE:85 第一条）。
     改完后 `npx tsc --noEmit -p tsconfig.build.json` 一旦把 `onSessionVfsSaved` 加回 `types.ts:52` 即报红。
     ⚠️ 类型表达式要用 `RootStackParamList['FileEditor']` —— 仓内**不存在** `FileEditorParamList` 这个类型名。
  2. **回归锁 B（端到端刷新真的接上了）**：mock `ipcMessagesSearch` 无关，改为：
     ① `setFileEditorOnSessionVfsSaved(spy)`；② 模拟 `FileEditor` 挂载（调 `takeFileEditorOnSessionVfsSaved()`）；
     ③ 触发 session scope 保存成功；④ 断言 `spy` 被调用 **1 次**，且工作区列表 token 已 +1。
     把 `useChatTabScope.ts:625` 处的 setter 调用删掉，此断言**必须变红**。
     **本条必须内含一次「重渲染后再保存」**：在 ② 挂载（取走回调）之后、③ 触发保存之前，
     **先制造一次重渲染**（改动文件 content / 触发 `setSaving` 等任意 state 更新走一轮 render），
     再断言 `spy` 仍被调用 1 次。
     ⚠️ 不加这一步，验收会漏掉 B-2 那个洞：把 `useRef` 改回渲染期裸调 `take…()` 也照样绿
     ——首次挂载那一次保存仍能工作，必须靠「重渲染之后才保存」才照得出回调已被重取成 `null`。
  3. **回归锁 C（take 语义防串台）**：写入 cb1 → 取走 → 再取 ⇒ 第二次返回 `null`。
  4. **回归锁 D（不回归：8 个 navigate 调用点全部仍能编译）**：
     `npx tsc --noEmit -p tsconfig.build.json` → 0 错误（删 param 后若有残留传参会立刻报
     `Object literal may only specify known properties`）。
  5. 命令与期望：
     - `cd apps/mobile && npx tsc --noEmit -p tsconfig.build.json` → 0 错误；
     - `cd apps/mobile && npm test -- --maxWorkers=2` → 全绿（同 §3 的 `--maxWorkers=2` 硬要求）。

- **测试策略**：

  - **新增**：`apps/mobile/__tests__/file-editor-saved-callback.test.ts`
    —— 覆盖 2/3（纯 TS + 模块级单例，独立 jest 进程）。
    ⚠️ **验收 1 不落在这个文件里**（babel 抹类型 ⇒ 恒绿），它由 `src/navigation/param-serializability.ts` 承担。
  - **改**：`apps/mobile/__tests__/file-editor-screen.test.tsx`（既有文件）
    —— 覆盖 2：`FileEditorScreen` 挂载时经 `useRef` 取走回调、session scope 保存成功后调用它，
    **且保存前先制造一次重渲染**（锁 B-2 那个洞）。该文件已存在且已在渲染 `FileEditorScreen`，**只追加用例、不改既有夹具**。
  - **新增**：`apps/mobile/__tests__/open-file-editor-refresh.test.ts`
    —— 覆盖 2 的「接线」半：mock `navigation.navigate`，调 `useChatTabScope` 返回的 `openFileEditor`
    走 session scope 分支，断言 `navigate` 被调用的**前一刻**回调已写入
    （用 `takeFileEditorOnSessionVfsSaved()` 在 mock 内当场读取并记录，断言拿到的是一个函数）。
    夹具从 `use-chat-tab-scope-batch-delete.test.ts` 的 `:49-50`（数组）+ `:52-76`（`mockRuntime`）骨架复制。
  - 用例名（拟）：
    - `T-FEPar-1（编译期，非 jest）FileEditor 路由 params 不含函数成员 —— src/navigation/param-serializability.ts`
    - `T-FEPar-2 重渲染之后 session scope 保存成功，回调仍被调用一次（工作区列表刷新）`
    - `T-FEPar-3 take 语义：回调取走即清，第二次取为 null`
    - `T-FEPar-4 openFileEditor(session) 在 navigate 前写入回调`
  - **验收断言的牙齿自查**：1 是**编译期**断言（由 `tsc` 判定，改动实现必红，不受 babel 影响）；
    2 的观测面是「注入的 spy 被调用」且**必须跨一次重渲染**（否则 `useRef` 改回裸调也照样绿）；
    3 是纯单例断言；4 的观测面是「navigate 被调用前回调已在位」，**不依赖 UI 文案**，不踩 RULE:85 第一条。

- **回归线**（必须保持绿）：

  - `apps/mobile/__tests__/file-editor-screen.test.tsx`（**本条改的同一个屏**）
  - `apps/mobile/__tests__/prompt-editor-screen.test.tsx`、`composer-fullscreen.test.tsx`
    （同范式 `prompt-editor-callback` 的真实覆盖就在这两个文件里；**不存在** `prompt-editor-callback.test.ts`）
  - `apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts`、`use-chat-tab-scope-token-debounce.test.ts`、
    `use-chat-tab-scope-parallel-queries.test.ts`（**本条改的同一个 hook**）
  - `apps/mobile/__tests__/chat-link-nav.test.ts`（**本条改的 `SubagentSessionScreen` 链接分支在其覆盖下**；
    **不存在** `chat-link-route.test.ts`）
  - `apps/mobile/__tests__/subagent-session-screen-metrics.test.tsx`
    （真正挂载 `SubagentSessionScreen` 的那一条，见修法步骤 4 的两处 setter 调用）
  - `apps/mobile/src/components/agent/prompt-editor-callback.ts` **一行不改**（它是本条引用的正确范式）

- **依赖**：

  - **前置**：无。可与 §3 并行（§3 改删除分支、本条改 `openFileEditor`，同文件不同函数）。
  - **拍板项**：无。但**口径选择 1 处**（见修法步骤 4 的 `SubagentSessionScreen` no-op vs 新增 token）
    —— 默认案是 no-op，属「实现细节级口径」而非产品级争议，**不阻塞执行**；
    若 review 认为子会话屏也该即时刷新，按备选案另立一条即可，不影响本条其余部分。

- **风险与回滚**：

  - 风险 1（中）：模块级单例的**时序脆弱性**——若两个 `FileEditor` 打开路径交错（用户快速连开两个），
    后写覆盖先写，可能把回调送到错的屏。
    这是 `prompt-editor-callback.ts` 已知的同款权衡（它的注释 `:12` 明确写「每次打开全屏都覆盖新回调」）。
    缓解：`FileEditor` 是**全屏 push 屏**，同一时刻只有栈顶一个活着 ⇒ 覆盖式单例在本场景下是安全的；
    **回归锁 3 的 take 语义**保证「取走即清」，避免**上一次**打开的回调泄漏到下一次。
  - 风险 2（低）：删掉 `onSessionVfsSaved` 后若有**仓外/未搜到的**调用方（不可能——RN 路由调用方必在仓内），
    tsc 会立即报出来。验收 5 的 `tsc` 就是这个兜底。
  - 回滚：本条新增一个 `.ts` 模块 + 改 4 处调用点 + 删 2 行类型，**无数据迁移、无导航栈结构变更**，
    `git revert` 即可；若只回滚调用点接线而保留新模块，该模块变成死导出（会被 Wave D 批次 3 收走）。

---

## 5 · §6 #6 —— `invoke-registry` 无响应类型组（**N-P1-05 的 P2 侧配套，不立七要素条目**）

> **定位**：台账 §6 #6 已判「与 #2 同源（渲染层无门禁的下游症状），建议并入 N-P1-05 的 P2 侧，不单列 P1」。
> `fix-spec/SPEC.md` §2 的分片表也明确：「#6 invoke-registry（并入 N-P1-05 P2 侧注记）」。
> **N-P1-05 的本体（renderer 零类型门禁、renderer 基线分批清账、加 `typecheck:renderer` script 与 CI 步骤）
> 归 `wave-e.md`，本分片不写本体。**
> 本节只交付两样东西：**① 无响应类型的通道完整清单（可直接当 wave-e 的分批输入）；② 125 条 TS18046 的消减路径。**

### 5.1 病灶复核与通道清单

`invoke-registry.ts` 的三个工厂在**不给类型实参**时，`T` / `TReq` / `TRes` 一律推断成 `unknown`：

```
135  function noArg<T>(invoke: InvokeFn, channel: string): () => Promise<T> {   // 不给 T ⇒ Promise<unknown>
139  function withReq<TReq, TRes>(invoke, channel): (req: TReq) => Promise<TRes> // 两个都不给 ⇒ req: unknown, Promise<unknown>
154  function withBool<TRes>(invoke, channel): (enabled: boolean) => Promise<TRes>
```

本轮逐行核对，**共 30 个封装落在这一档**，连续/近连续分布在四个区（台账写的 `474-525` 只覆盖了前两段，
**行号区间不完整**，此处补全）：

| 区 | 行号（`fe79b781` 实测） | 封装 | 台账是否提到 |
|---|---|---|---|
| **服务商 / 模型** | `:474`（`noArg`）、`:475`、`:479`、`:483`、`:487`、`:491`、`:495`、`:499`、`:503`、`:507`、`:511`、`:515`、`:519`、`:523` | `ipcProvidersList/Get/Create/Edit/Delete`、`ipcProviderModelsSavedList/Fetch/SuggestList/Save/DeleteSaved/GetSaved/EditSaved/UpdateSettings/ResetContextWindow` | ✅（台账的 `474-525` 覆盖到这里） |
| **agent registry / YAML** | `:527`（`noArg`）、`:532`、`:536`、`:544`、`:548` | `ipcAgentRegistryList/Upsert/Delete`、`ipcAgentYamlExport/Import` | ✅ |
| **压缩条件 / 备份 / db** | `:649`（`noArg`）、`:653`、`:657`（`noArg`）、`:658`（`noArg`） | `ipcCompactionConditionsGet/Set`、`ipcBackupExport/Import` | ⚠️ 台账把 **db 统计**也列进来了，**但 `:659` `ipcDbStats` 与 `:663` `ipcDbMaintenance` 已有类型**（`noArg<IpcResult<DbStatsResult>>` / `noArg<IpcResult<DbMaintenanceResult>>`）⇒ **台账这一项须删** |
| **云同步** | `:667`（`noArg`）、`:668-680`、`:681`（`withBool<unknown>`）、`:685`（`noArg`）、`:689`（`noArg`）、`:693`（`noArg`）、`:694-695`（裸 `invoke(...)`，未给 `T`） | `ipcCloudSyncGetConfig/SetConfig/SetEnabled/TestConnection/GetLocalStatus/Pull/Push` | ✅ |

**合计 30 个封装**。台账 §6 #6 的「服务商/模型/agent-registry/YAML/云同步/备份/db 统计」七组里，
**「db 统计」不成立**（已带类型），其余六组全部复核成立。

### 5.2 后果量化（**本轮实跑**，修正口径）

`npx tsc --noEmit -p tsconfig.renderer.json`（`apps/desktop` 下）→ **411 条错误**（TS 6.0.3 实测）。
口径同 §0.3：台账的 424 是 W11 时点数，本轮 `sr1-apps-c` 与 `sr1-e-a` 两源独立撞车同得 411，
**终值以 `fix-spec/baseline.md` S1 定案**。
其中 **TS18046 共 138 条**，拆开是两个不相干的族：

| 族 | 条数 | 分布 | 是否本条 |
|---|---:|---|---|
| **invoke-registry `unknown` 族** | **125** | **全部集中在 6 个 renderer 生产文件**：`features/settings/SettingsViews.tsx` 69、`ModelSamplingView.tsx` 18、`AgentEditorView.tsx` 18、`WorkspaceSettingsView.tsx` 9、`FetchModelsModal.tsx` 7、`AgentDefinitionEditorForm.tsx` 4 | ✅ 本条 |
| `.props` 族 | 13 | `components/ui/Tooltip.tsx:145,149,153,157`（4）+ 4 个 **测试文件**（`test/fetch-models-modal.test.tsx:139,321`、`test/token-usage-stats-view.test.tsx:361,408,419,430,1334,1352`、`test/workspace-push-menu.test.tsx:89`） | ❌ 与本条无关（`react-test-renderer` 的 `TestInstance.props` 是 `unknown`），**不得算进本条消减账** |

⇒ **台账「125 处」的数字正确**，但需补上「138 = 125 + 13」这个口径，
否则 wave-e 按「138 − 125 = 13 条无关」对照会误判。

**125 条的按文件分布（wave-e 分批的直接输入）**：
`SettingsViews.tsx` 69（占 55%）· `ModelSamplingView.tsx` 18 · `AgentEditorView.tsx` 18 ·
`WorkspaceSettingsView.tsx` 9 · `FetchModelsModal.tsx` 7 · `AgentDefinitionEditorForm.tsx` 4。
⇒ **`SettingsViews.tsx` 一个文件就占过半**，wave-e 首批应当只打这一个文件。

### 5.3 消减路径（**按风险从低到高排序**，交 wave-e 使用）

1. **零风险首批（纯补签名，main 侧类型已现成）**：`invoke-registry.ts:649` `:653` 两个 compaction 通道。
   `shared/ipc-types.ts:1613` `CompactionConditionsDto`、`:1622` `CompactionConditionsSetRequest`
   **已存在**；main 侧 `src/main/ipc/handlers/compaction-conditions.ts:12` / `:24` 的返回签名
   已经是 `IpcResult<CompactionConditionsDto | null>` / `IpcResult<void>`。
   ⇒ 只需把这两个类型填进 `noArg<>` / `withReq<>`，**handler 零改动、契约零变更**。
   消减：`WorkspaceSettingsView.tsx` 的 **9 条** TS18046 全消（该文件 `:103-112` 的 7 条 + `:153/:156` 的 2 条，
   全部来自 `compactionRes` / `res` 这两个变量）。
   ⚠️ 本条与 §1 同文件 ⇒ **§1 的搭车建议成立**（届时 §1 验收里的「renderer 仍为 411」要改成「411 − 9 = 402」）。
2. **低风险（响应类型已在上游存在，只需 import）**：`ipcBackupExport/Import`（`:657-658`）、
   `ipcDbStats` 同族的云同步 7 个 —— 逐个回 main 侧 handler 取既有返回类型；
   若 handler 也返回 `unknown`，则**该通道的类型定义需要新建**（此时必须按 **RULE:109**
   先扫「手写假实现」：`tsconfig.renderer.json` 的 `include` 覆盖 `test/**/*`，
   给公共接口加必填成员会让双端测试的对象字面量报 TS2741）。
3. **中风险（需逐条核对 handler 实际返回形状）**：服务商 / 模型 14 个 + agent registry 3 个 + YAML 2 个。
   这几组的 handler 大概率已有 DTO，只是没被 registry 引用 ⇒ 属于「搬类型」；
   但 `withReq<unknown, unknown>` 的**入参**侧是 `unknown`，改成具体请求类型后，
   调用点传的字面量必须逐字段合法（`SettingsViews.tsx:1273/1301/1502` 等），**会暴露真实的载荷不符**。
4. **收口**：`AgentDefinitionEditorForm.tsx` 的 4 条**先不动**——该文件 1048 行、全仓零引用，
   已被台账降 P2 并归入 **Wave D 批次 3**（死码删除）。**门禁清账时不要为一个待删文件花力气**；
   若 Wave D 先删掉它，这 4 条自动消失，基线变成 407（411 − 4）。

### 5.4 与 wave-e 本体的边界（一句话）

**wave-e 管「加门禁 + 清 renderer 基线」；本节管「哪 30 个通道、每个通道该填什么类型、消减顺序怎么排」。**

🔗 **分批归属已收敛为唯一批次 R0（judge-r1 D.3 + R2-12）**：本节的跨片分批归属已对账完毕，
结论 = 给 R1–R6 补一行「**R0：compaction 两通道补签名 −9**」并回引 §5.3 步骤 1，
落点已写进 `wave-e.md:342`（R2-12 补录，归属依据 `wave-b-apps.md §5.3` 步骤 1）。
撰写本节时按「wave-e 的分批清账一节会直接引用 §5.2 的按文件分布与 §5.3 的消减顺序」来设分工，但复核发现
`wave-e.md` 的 **R1–R6 是自洽的、并未引用本节**（R2 = `SettingsViews.tsx` 79 条整体、
R3 = `AgentEditorView` + `ModelSamplingView` + `AgentDefinitionEditorForm` 55 条，
与 §5.3「compaction 两通道 → 备份/云同步 → 服务商/模型」的排序**不是同一套**）；
更关键的是 §5.3 步骤 1 的 `WorkspaceSettingsView` 9 条在 R1–R6 里**没有归属批次**（只能落进 R6「剩余长尾」）
⇒ 本节标榜的「零风险第一刀」在 wave-e 现有计划里**没有落点**。
**该缺口已由 R2-12 补 R0 批次闭合；对账已完成，本分片不再回头请示 judge。**
本节交付物（30 个通道清单与逐通道类型映射、125 条按文件分布）仍是可独立取用的输入数据。

---

## 6 · 分片级注记

### 6.1 与 `wave-e.md`（N-P1-05 本体）的边界

| 事项 | 归属 | 理由 |
|---|---|---|
| `apps/desktop/package.json:11` 加 `typecheck:renderer` script、`.github/workflows/ci.yml:63` 挂上它 | **wave-e** | 门禁本体；且依赖 Wave A 的「typecheck 转 blocking」 |
| renderer 基线（411）的分批清账计划（按文件排波次） | **wave-e** | 清账主战场；其 R1–R6 与本文 §5.2/§5.3 **不是同一套排序**（见 §5.4 的待对账注记） |
| **30 个无响应类型通道的清单与各自应填的类型** | **本文 §5**（已交付） | 是 wave-e 清账的**输入数据**，不是执行面 |
| `ChatHistorySearchPanel.tsx:106` 的 TS2345 | **本文 §2** | 它是一处**真运行时缺陷**（白屏），不是类型债；顺带把基线降到 410 |
| `WorkspaceSettingsView.tsx` 的 9 条 TS18046 | **§5.3 步骤 1**，可搭 §1 的车 | 两处类型已现成，零风险 |
| `Tooltip.tsx` + 4 个测试文件的 13 条 `.props` TS18046 | **wave-e（但不在 N-P1-05 的 125 账里）** | 独立族（`react-test-renderer` 的 `TestInstance.props`），台账未收，建议 wave-e 顺手单开一条 P2 |
| `tsconfig.renderer.json` 覆盖 `test/**/*` 带来的「测试文件类型错误会打红生产门限」约束 | **wave-e**（RULE:109 的现有纪律） | 引用即可，不重复立规 |

### 6.2 §6 #7 `ChatComposer` scope 不一致 —— **只注记，不立条目**

**台账原文（`ledger-v2.md` §6 第 7 行，逐字保留）**：

> | 7 | `ChatComposer` scope 与 core hydrate 域不一致 | apps-desktop | `ChatComposer.tsx:189-193` + `FileReferencePicker.tsx:65-67` 用 `vfsScope("session",…)`，而 main 侧 `resolve-vfs-scope.ts:30-34` 把 `'session'` 映射成 core `{kind:"project"}`；core hydrate 走 `toolCtx.vfs` = session 域 ⇒ **候选列的是项目工作区文件、`@路径` 却从会话工作区读** | P1 但标 suspected（w9-ds2-desktopfeat-a-3） | ✅代码链路复核成立，**但报告自标 suspected 且明确要求产品确认「desktop 是否刻意只让引用项目模板」** ⇒ 保留 P1-suspected，不入账 |

**本轮代码复核（只复核事实，不重新定级）——链路完全属实，行号逐条核实**：

| 环节 | file:line（`fe79b781` 实测） | 事实 |
|---|---|---|
| ① 渲染层构造 scope | `apps/desktop/renderer/ipc/client.ts:261-267` | `vfsScope(workspaceScope, projectId?, sessionId?)` 原样返回 `{ workspaceScope, projectId, sessionId }` |
| ② 两处调用点 | `ChatComposer.tsx:189-191`（`@` typeahead）、`FileReferencePicker.tsx:65-67`（`@` 路径选择器） | 两处都调 `vfsScope("session", projectId, sessionId)` |
| ③ main 侧 handler | `apps/desktop/src/main/ipc/handlers/workplace.ts:84` → `:101` → `:102` | `handleWorkplaceBuildListRows` → `resolveVfsScopeFromRequest(req)` → `getWorkplaceForScope(rt, scope)` |
| ④ 映射本体 | `apps/desktop/src/main/ipc/resolve-vfs-scope.ts:30-34` | `case "session": … return { kind: "project", projectId: req.projectId };` ⇒ **`sessionId` 被丢弃** |
| ⑤ 取域 | 同文件 `:84-90` → `rt.workplace(scope)` | 拿到的是 **project 域**的 workplace |

⇒ **候选列一侧** ①②③④⑤ 逐跳闭合：**候选列表确实列的是项目工作区文件，而 `sessionId` 在 ④ 被静默丢掉。**

**同时补一条台账未记、但对产品判断至关重要的证据（本轮新核）**：
`apps/desktop/src/main/ipc/resolve-vfs-scope.ts:35-46` 另有一个 `"chat"` 分支，
它**同时校验 `projectId` 与 `sessionId`** 并返回 `{ kind: "session", projectId, sessionId }` ⇒
**core 的真 session 域在 desktop IPC 侧是有正确入口的（`workspaceScope: "chat"`），只是 composer 没用它。**
这一条把问题从「无法修复」改成了「改一个字符串即可」，但**不改变它需要产品先回答的那个问题**。

**本轮补核另一半（台账病灶的另一半，原为从台账继承未复核）**：core hydrate 走 `toolCtx.vfs` = session 域这一半，
本轮已独立复核成立——`packages/core/src/domain/agent/run-agent-turn.ts:733/:868/:1247` 三处的 toolCtx.vfs
**均取 `runtime.sessionVfs(scope.projectId, scope.sessionId)`**，`:1103` 的 JSDoc 明写子 agent 同款
（「子 agent `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`」）⇒ **台账「hydrate 走 session 域」亦成立，
病灶两端俱在**。注记结论不变（仍为 P1-suspected，仍不入账）。

**⚠️ 需要用户确认的问题（台账原文，一字不改）**：

> **desktop 是否刻意只让引用项目模板？**

具体化为三个子问题（供用户逐条答）：
1. desktop 聊天框里 `@` 补全出来的候选，**产品意图**是「项目工作区的文件」还是「当前会话工作区的文件」？
2. 若答案是「会话工作区」，那么 **`@` 选中的路径在 core hydrate 时能读到吗？**
   （hydrate 走 `toolCtx.vfs`，按台账是 session 域 ⇒ 能读到；但若候选给的是项目域路径，
   在一个「会话工作区里没有同名文件」的场景下就是**候选存在、点击后读不到**。）
3. 若答案是「刻意只让引用项目模板」，则 `resolve-vfs-scope.ts:30-34` 这个
   `case "session"` 映射就是一个**与真实意图不符的历史命名**（同文件 `:48` 对 `physical` 的注释
   已自述「physical 为只读物理树浏览域」这类口径说明的历史包袱），
   ⇒ 正确修法可能是**改映射**（把 `"session"` 映到 `{kind:"session"}`，并把现有 project 用途迁到 `"chat"`）
   而不是改调用点。**两条修法的回归面完全不同，仓内 `workspaceScope: "session"` 的其它调用方需要一起盘点**
   （本轮 grep 到 `vfsScope` 在 desktop renderer 侧还有多处调用，**未逐一核对是否都是 project 语义**）。

**本分片的处置**：
- **不立条目、不进 Wave B 执行面**、**不进 fix-spec 化范围**（`SPEC.md` §1 已把 §6 #7 归为「suspected 留产品确认」）。
- **不写修法**：在用户回答上面三个子问题之前，任何修法都是在猜产品意图。
- **登记为待拍板项**：建议主代理在 `ledger-v2.md` §7 的拍板项清单里补一条
  「desktop `@` 补全的 scope 语义（项目 vs 会话）」，与 ★4/★5/★16/★17 同级；
  **拍板前 wave-e 不动这段**。
- **顺带提醒 wave-e**：X1 门禁全量收口时会碰到 `resolve-vfs-scope.ts`，
  **不得**在收口过程中「顺手修正」这个映射——那等于替产品拍板。

---

## 7 · AM-3 —— `RealPrompt` 路由无 scope，详情页入口可能展示**别的会话**的提示词（R2 补写）

- **严重度 / 簇**：P1 / apps-mobile，量 **S**。台账 `ledger-v2.md:159`（revalidate-b valid：路由参数确认未加、
  两处入口确认零参数；⭐ W9 独立撞车 `w9-mobilenav-pro-2`）。judge-r1 A.2(a) 判其为
  「**台账 §10 已排进 Wave、但没人写**」的**真漏**（不是未排期），R2-4 要求补齐七要素。
  认领链：`ledger-v2.md:159` → `ledger-v2.md:457` Wave B「（同波顺带）」行 → `SPEC.md §2` →
  `wave-b-core2.md:1514`（「AM-3 → `wave-b-apps`，不立条」）→ **本条**（最后一跳闭合）。

- **病症**：`RealPrompt` 路由的参数类型是 `undefined`（`types.ts:16`），两处入口 `navigate('RealPrompt')`
  都不传参，屏内 `RealPromptScreen.tsx:23` 于是从 `useMobileScope()` 读**全局 scope**。
  只要「用户点开的那个会话」与「全局 scope 当前会话」不是同一个，屏上渲染的就是**另一个会话**的提示词：
  - 触发路径（后台通知点按，**栈外写 scope**）：`session-stream-unit-manager.service.ts:470-479`
    注册的 tap handler 里 `if (getCurrentSessionId() !== sessionId) void setCurrentSession(sessionId)`
    → `scopeBridge` 实现（`novel-master-context.tsx:240-250`）`await setMobileSession(...)` + `setScope(next)`
    ⇒ **不需要任何 UI 交互，后台事件直接改 React state**；
  - 紧接着 `navigateToChatTabFromNotification()`（`agent-finished-notification.ts:496-499`）
    调 `navigate('MainTabs', {screen:'Chat'})`，**不带 `pop`**、而 `RootNavigator.tsx:213` 的 `MainTabs`
    **没有 `getId`** ⇒ 栈顶是 `SessionDetail(A)` 时不会 pop 回去，而是**压入第二个 `MainTabs`**；
  - 于是用户回到前台时**栈顶仍是 `SessionDetail(A)`**（按一次返回键才落回），scope 已是 B。
    在这个「详情页 A」里点「查看提示词」⇒ 屏读 scope=B ⇒ **显示 B 的提示词，页面却停在 A 的框里**。
  - 后果定级依据：**错数据 + 零逃生路线 + 无自我提示**——`header-config.ts:20` 标题固定「查看提示词」，
    `RealPromptScreen.tsx:61-90` 全文不出现会话名 / sessionId ⇒ 用户无法察觉自己对错了会话。
  - **对照证据（同页、同一屏的另一个入口）**：`SessionDetailScreen.tsx:366` 的「聊天记录」入口
    **明确传** `{projectId, sessionId}` ⇒ 这是单点漏传，不是全屏惯例。

- **证据**（`fe79b781` 工作区本轮逐行核对，行号与台账一致）：

  ```
  apps/mobile/src/navigation/types.ts
  16    RealPrompt: undefined;
  ```
  ```
  apps/mobile/src/screens/stack/SessionDetailScreen.tsx
   67    const {projectId, sessionId} = route.params;                    // ← 屏自己手里就有 id
   66      navigation.navigate('ChatHistorySearch', {projectId, sessionId})  // 同页另一入口：传了
   397      onPress={() => navigation.navigate('RealPrompt')}             // 本入口：没传
  ```
  ```
  apps/mobile/src/screens/stack/RealPromptScreen.tsx
   23    const {projectId, sessionId} = useMobileScope();   // ← 唯一数据源是全局 scope
   38        const list = await buildRealPromptPreviewSegments(runtime, {projectId, sessionId});
  ```
  ```
  apps/mobile/src/services/session-stream-unit-manager.service.ts
   472      if (this.scopeBridge?.getCurrentSessionId() !== sessionId) {
   474        void this.scopeBridge?.setCurrentSession(sessionId).catch(() => undefined);  // 栈外改 scope
  ```
  ```
  apps/mobile/src/screens/tabs/chat-tab/useChatTabController.ts
   106    const onNavigateRealPrompt = useCallback(() => {
   107      ctx.navigation.navigate('RealPrompt');            // ← 第二处入口，同样零参数
  ```

- **修法**（4 处 · 1 个文件改类型 + 1 个屏取值 + 2 个入口接线）：

  1. `apps/mobile/src/navigation/types.ts:16`：
     `RealPrompt: {projectId?: string; sessionId?: string} | undefined;`
     —— **可选 + 缺省回落**，形状照同文件 `:62-68` 的 `PromptEditor`（它已带 `projectId?/sessionId?`，
     且 `:56-61` 的注释正是「回调不走路由参数」那条范式的出处）。
  2. `apps/mobile/src/screens/stack/RealPromptScreen.tsx:20-23`：加
     `const route = useRoute<RouteProp<RootStackParamList, 'RealPrompt'>>();`
     与 `const params = route.params ?? {};`，然后把取值改成
     `const projectId = params.projectId ?? scopeProjectId; const sessionId = params.sessionId ?? scopeSessionId;`
     （`useMobileScope()` 仍要调，**回落分支依赖它**）。
     ⚠️ **必须保留回落分支**：本仓还有「无参进栈」的存量路径（见风险 2），删掉回落会让那些入口直接变「请先选择项目与会话」。
  3. `apps/mobile/src/screens/stack/SessionDetailScreen.tsx:397`：
     `onPress={() => navigation.navigate('RealPrompt', {projectId, sessionId})}` —— 直接用 `:67` 解出的值。
  4. `apps/mobile/src/screens/tabs/chat-tab/useChatTabController.ts:106-108`：
     `ctx.navigation.navigate('RealPrompt', {projectId: ctx.projectId ?? undefined, sessionId: ctx.sessionId ?? undefined})`
     —— 两值皆空时等价于今天的无参调用（屏内回落），**不引入新分支**。
  5. **明确不做**：不改 `RootNavigator.tsx:222-226` 的装配与 `options={{animation:'none'}}`；
     不改 `header-config.ts:20`；不改 `buildRealPromptPreviewSegments` 的签名（`prompt-preview.service.ts:57`）；
     **不**顺带修 `navigateToChatTabFromNotification` 的「压入第二个 MainTabs」（那是另一条 P2，见依赖栏）。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁 A（屏内取值，主验收，有牙）**：新增 `apps/mobile/__tests__/real-prompt-screen-scope.test.tsx`：
     mock `useMobileScope` → `{projectId:'pB', sessionId:'sB'}`，mock `useRoute` → `{params:{projectId:'pA', sessionId:'sA'}}`，
     mock `buildRealPromptPreviewSegments` 为 jest.fn ⇒ 断言它收到 **`{projectId:'pA', sessionId:'sA'}`**。
     把修法步骤 2 改回「只读 `useMobileScope`」⇒ **本锁必须变红**（这是 RULE:85 第一条要求的「牙」）。
  2. **回归锁 B（回落分支，防过修）**：同上但 `useRoute` 返回 `{params: undefined}`
     ⇒ 断言 `buildRealPromptPreviewSegments` 收到 `pB/sB`。删掉 `?? scopeProjectId` 的回落 ⇒ **变红**。
  3. **回归锁 C（入口 1 接线）**：在**既有** `apps/mobile/__tests__/session-detail-screen.test.tsx` 追加一例
     （该文件 `:152-155` 已 mock `useRoute`/`useNavigation`、`:546-561` 已有「点击入口 → 断言 `mockNavigate` 实参」的同款范式，
     **只追加、不改既有 mock**）：点 `testID="real-prompt-row"` ⇒ 断言
     `mockNavigate` 被以 `('RealPrompt', {projectId:'p1', sessionId:'s1'})` 调用。
     把 `:397` 改回无参 ⇒ 变红。
  4. **回归锁 D（入口 2 接线）**：新增 `apps/mobile/__tests__/chat-tab-real-prompt-nav.test.ts`，
     夹具从 `use-chat-tab-scope-batch-delete.test.ts:49-76` 的数组 + `mockRuntime` 骨架照抄
     （`ctx` 只需 `navigation` / `projectId` / `sessionId` / `chatMessages` 等 `useChatTabController` 真正读到的字段），
     调 hook 返回的 `onNavigateRealPrompt()` ⇒ 断言 `navigate` 实参含 `projectId`/`sessionId`。
     ⚠️ `useChatTabController` 依赖 `useChatTabContext()`（`ChatTabProvider`），
     **不得**去挂载 Provider（会牵进整个 chat-tab 依赖树）；按该 hook 实际读取的字段造最小 ctx 即可，
     缺字段会在解构处直接抛错，属**夹具漏字段**而非实现问题。
  5. **类型门**：`cd apps/mobile && npx tsc --noEmit -p tsconfig.build.json` → **0 错误**；
     `npm run typecheck` → 0（基线见 `baseline.md §4`：mobile typecheck 已知绿）。
     ⚠️ 入口 4 若把 `projectId` 写成 `string | undefined` 直接塞进 params，必须先过 `?? undefined` 收窄，
     否则 tsc 报 `Type 'undefined' is not assignable`。
  6. **mobile jest**：`cd apps/mobile && npm test -- --maxWorkers=2`
     ⇒ **红条目仍为 1 条且位置不变**（`__tests__/mermaid-fullscreen.test.ts` 的 `T-MF3`，
     `baseline.md §3.3` 判定的确定性真红）；分母因新增用例 +N，**不要求等于 1739**。
     `--maxWorkers=2` 是硬要求（见 §3 验收 7 与本文件 §0.3 的 RULE:111 提醒）。

- **测试策略**：

  - **新增** `__tests__/real-prompt-screen-scope.test.tsx`（覆盖 1/2）：纯函数式夹具——
    mock `@/hooks/useMobileScope`、`@react-navigation/native` 的 `useRoute`、
    `@/services/prompt-preview.service` 的 `buildRealPromptPreviewSegments`；
    主题 hook（`@/theme/ThemeProvider`）与 `PromptPreviewSegmentCard` 走既有的 `jest.mock` 简化写法
    （同 `session-detail-screen.test.tsx:63-150` 的成套 mock 形态）。
  - **追加** `__tests__/session-detail-screen.test.tsx`（覆盖 3）：零新夹具，只加一条 `it`。
  - **新增** `__tests__/chat-tab-real-prompt-nav.test.ts`（覆盖 4）。
  - **断言的牙齿自查**（RULE:85 三条判据）：1/2 的观测面是 `buildRealPromptPreviewSegments` 收到的**实参**
    （注入缝，与实现同源）；3/4 的观测面是 `navigate` 的**实参序列**；四条都不依赖渲染文本，
    也不共用互斥夹具（jest 的 `jest.mock` 按文件隔离）。

- **回归线**（必须保持绿）：

  - `apps/mobile/__tests__/session-detail-screen.test.tsx`（**本条改的同一屏**，只追加用例）
  - `apps/mobile/__tests__/prompt-editor-screen.test.tsx`（同款「可选 scope 走路由参数」范式，本条只引用）
  - `apps/mobile/__tests__/chat-link-nav.test.ts`、`subagent-session-screen-metrics.test.tsx`
    （`RootStackParamList` 的既有消费面；`navigation/types.ts` 一行改动波及它们的编译）
  - `apps/mobile/src/navigation/header-config.ts`、§4 的 `file-editor-saved-callback` 相关用例
    （§4 步骤 2 删的是 `types.ts:51-52`，与本条改的 `:16` 不同行 ⇒ 可并行、但**同 PR 时注意 hunk 不交叠**）

- **依赖**：

  - **前置**：无。可与 §3、§4 并行（§3 改删除分支、§4 改 `FileEditor` 路由参数；本条只碰 `types.ts:16`
    与 `RealPromptScreen` / 两个入口）。
  - **相关但非前置**：`navigateToChatTabFromNotification` 压入第二个 `MainTabs`
    （`agent-finished-notification.ts:496-499` + `RootNavigator.tsx:213` 无 `getId`；
    台账 `ledger.md:270` 拍板项 #14、`synth/verify-apps-mobile.md` 验证过程 3）**是独立的一条 P2，本条不修**。
    ✅ 本条对该缺陷**免疫**：修完之后即使栈里有两个 `MainTabs`，用户从「详情页 A」点进去看到的仍是 A 的提示词。
  - **拍板项**：无。

- **风险与回滚**：

  - 风险 1（低）：新增「route 优先」后，若将来新增一处入口**忘记传参**，该入口会读到「栈外被改过的全局 scope」
    ——与今天完全一样（今天所有入口都是这个行为）⇒ **不会比现状更差**，且验收 C/D 会强制两处既有入口接线。
  - 风险 2（极低）：存量无参进栈路径（若存在）走回落分支，行为与今天逐字一致。
    ⚠️ 本轮已核 `git grep RealPrompt -- apps/mobile/src` 只有两处 `navigate`，**当前没有无参的第三方入口**；
    回落分支是**防御性**保留，不是为了迁就现存调用方，执行者不要因为「没人用」就删掉它。
  - 风险 3（无）：不改存储、不改 IPC、不改 service 签名。
  - 回滚：4 处改动（1 行类型 + 1 处屏内取值 + 2 处入口）可 `git revert`；
    若只回滚入口接线而留类型与屏内取值，行为退化为今天的形态，**无残留状态**。

---

## 8 · S-D-04 —— `AgentEditorView` 从不上报 dirty ⇒ 设置导航守卫对智能体配置页恒不生效（R2 补写）

- **严重度 / 簇**：P1 / apps-desktop，量 **M**。台账 `ledger-v2.md:167`（含盲扫条目 **A**；
  多源 + W6 盲扫独立重推导 + revalidate-b valid + ⭐ W9 双源 `w9-ds2-desktopfeat-a-1` × `w2-desktop-features-3`）。
  judge-r1 A.2(b) 判其为「**§10 从未排进任何 Wave**」⇒ R2 补排补写（R2-6）。

- **病症**：守卫的**读侧**是好的——`settings-nav.ts:158-175` 的 `shouldGuardSettingsNav` 纯函数
  在 `currentViewId==='agentEditor' && dirtyViews.has('agentEditor')` 时会返回 `true`
  （既有单测 `settings-nav-guard.test.ts:75-82` 就锁着这个分支）。**坏的是写侧**：
  `nav.dirtyViews` 的**唯一写入方**是 `SkillDetailView.tsx:140-149` 那个 effect，
  `AgentEditorView.tsx` **全文零 `dirtyViews`**（本轮 `findstr /s` 实跑，`App.tsx` 同样零命中）
  ⇒ `dirtyViews.has("agentEditor")` **恒 false** ⇒ Overlay 的**四个分发点全部直接卸载**：

  | 分发点 | file:line | 动作 |
  |---|---|---|
  | 侧导航点别的分类 | `SettingsOverlay.tsx:268-272` | `navigateTopLevel(item.id)` → `viewId` 变 → `<div key={viewId}>`（`:312`）卸载表单 |
  | 顶栏返回 | `SettingsOverlay.tsx:291-300` | `popView()` 同上 |
  | 事件跳转（技能面板/工具卡片） | `SettingsOverlay.tsx:165-194` | `guardedNav` 拦不住 → 照常切 |
  | 右上角 × 关闭 | `SettingsOverlay.tsx:236-247` | `setViewId("workspace")` + `navStateRef.current = {}` ⇒ 必卸载 |

  ⇒ 用户在智能体配置页改了提示词正文 / 工具策略 / maxSteps，点任何一处离开 ⇒
  `ConfirmModal`（`:320-331`）**不弹** ⇒ **未保存内容静默丢弃，无任何补救路径**。

  **口径修正（台账把两半并列，本轮拆开）**：
  台账写的「`App.tsx:344` ⚡ 旁路」经本轮读码**不是同等级的危害**，执行者不要按「也会丢数据」去做：
  - `App.tsx:344` 的 `onToggleSettings={() => setSettingsOpen(open => !open)}` 确实**绕过了 Overlay 内的 `handleClose`**；
  - 但 `SettingsOverlay` 关闭时**不卸载** view（`:249-256` 只切 `hidden` / `aria-hidden`，`renderContent()` 始终挂载）
    ⇒ 从 ⚙ 关闭**当前不会丢表单**；
  - 真实后果是 ① **`onClose()` 副作用不触发**（`App.tsx:361-364` 的 `notifyAgentConfigChanged()` 不跑
    ⇒ 用户改完智能体配置、点 ⚙ 关闭，聊天侧 / 我的页的智能体列表**不刷新**）
    与 ② **守卫对这个入口完全无效**、且与 × 按钮语义不一致（× 会回 workspace 并触发 `onClose`，⚙ 两样都不做）。
  - **结论：S-D-04 的「静默丢数据」全部来自上面那张表的四个 `guardedNav` 分发点；⚙ 旁路是「刷新缺失 + 语义不一致 + 未来隐患」。**

- **证据**（`apps/desktop` 本轮逐行核对；`findstr /s dirtyViews apps\desktop\renderer` → **零命中**，只命中 `SkillDetailView`）：

  ```
  apps/desktop/renderer/features/settings/SkillDetailView.tsx   ← 全仓唯一写入方
   140    useEffect(() => {
   142        nav.dirtyViews.add("skillDetail");
   147      return () => { nav.dirtyViews.delete("skillDetail"); };   // 卸载清理
  ```
  ```
  apps/desktop/renderer/features/settings/AgentEditorView.tsx
   630    const dirty = savedBaseline != null && snapshot !== savedBaseline;   // 算出来了，但从不外报
  ```
  ```
  apps/desktop/renderer/App.tsx
   344            onToggleSettings={() => setSettingsOpen(open => !open)}      // ← 绕过 handleClose
   361          onClose={() => { setSettingsOpen(false); notifyAgentConfigChanged(); }}
  ```

- **修法**（2 个文件 · 3 步）：

  1. `apps/desktop/renderer/features/settings/AgentEditorView.tsx` —— **新增 dirty 上报 effect，
     逐字照 `SkillDetailView.tsx:140-149` 的形状**（add / else delete / 卸载 cleanup delete，deps `[dirty, nav]`）。
     ⚠️⚠️ **放置位置是本步的牙齿，不能放在 `:630` 那一带**：
     `AgentEditorView` 在 `:389`（`!agentId`）、`:429`（`invalidHealth`）、`:465`（`loadError`）三处**提前 return**，
     `:630` 之后的代码不在所有渲染路径上 ⇒ 把 `useEffect` 放那里会**违反 hooks 规则**（条件调用），
     且 ESLint `react-hooks/rules-of-hooks` 会直接报错。
     正确落点：**紧跟 `:382-387` 那个「内置 general 设标题」的 effect 之后**
     （即 `:387` 之后、`:389` 的 `if (!agentId)` 之前）——
     `snapshot`（`:169-217` 的 useMemo）与 `savedBaseline`（`:154`）两个依赖都已在早返回之上，位置安全。
     effect 内自己算 `const dirty = savedBaseline != null && snapshot !== savedBaseline;`，
     **不要**去引用 `:630` 那个 `dirty`（它在早返回之下，引用不到）。
     ⚠️ 早返回的三种态（无 agentId / 配置损坏 / 加载失败）**本就不该上报 dirty**——那时没有可编辑表单，
     写进 effect 的注释里，避免后来者以为漏了。
  2. `apps/desktop/renderer/App.tsx:344` —— **把「关闭设置」收归 Overlay 的 `handleClose` 单一入口**：
     给 `SettingsOverlay` 暴露一个句柄（推荐 `forwardRef` + `useImperativeHandle` 暴露 `requestClose: () => void`，
     内部就是 `handleClose` 本体；或等价地给 Overlay 加一个 `closeRequestToken: number` prop），
     App 侧改成 `onToggleSettings={() => (settingsOpen ? ref.current?.requestClose() : setSettingsOpen(true))}`。
     ⚠️ **保持守卫单点在 Overlay 内**：`handleClose` 落地的 `onClose()`（`SettingsOverlay.tsx:245`）
     仍是 App 传进来的那个，`notifyAgentConfigChanged()` 因此**不丢**（`:361-364` 一行不改）。
     ⚠️ **打开路径不过守卫**（打开不卸载任何 view），不要顺手给它也套一层。
  3. **明确不做**：不改 `shouldGuardSettingsNav` 纯函数、不改 `settings-nav.ts` 的接口定义
     （`dirtyViews` 字段与「挂载首跑即写入、卸载即清理」的约定 `:89-99` 已经写好了，本条只是第二个使用方）、
     不动 `SkillDetailView`、不动 `ConfirmModal`。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁 A（写侧，主验收，有牙）**：新增 `apps/desktop/test/agent-editor-dirty-guard.test.tsx`：
     用手写 `nav` fake（`{navState:{}, dirtyViews: new Set(), push, pop, setAgentEditorTitle}`，
     断言直接读这个 Set —— 与生产同源，不做源码正则），
     mock `ipcAgentRegistryGet` / `ipcProvidersList` / `ipcProviderModelsSavedList` 让加载成功，
     渲染 `AgentEditorView` → 改一个字段（如 `maxSteps`）⇒ 断言 **`nav.dirtyViews.has("agentEditor") === true`**；
     卸载后断言 **`has("agentEditor") === false`**。
     把修法步骤 1 的 effect 整段删掉 ⇒ **两条都变红**。
  2. **回归锁 B（守卫真的拦得住，端到端）**：同上，改字段后调 `nav.push('providers')` —— 这是 `nav.push` 裸入口、
     **按设计不过守卫**（`SettingsOverlay.tsx:131-133` 有注释说明）⇒ 断言 A 那步已证明 `dirtyViews` 有标记即可；
     **不要**把 B 写成「push 被拦」，那会与既有设计冲突。真正要验的是 Overlay 层：
     在 `SettingsOverlay` 侧新增一例「`currentViewId='agentEditor'` 且 `dirtyViews` 含 `agentEditor` 时
     点 × ⇒ `onClose` 未被调用、`ConfirmModal` 可见」——用 `settings-nav-guard.test.ts:75-82` 的纯函数结论
     + 组件层各跑一半，前者已绿、后者是本条新增。
  3. **回归锁 C（⚙ 旁路，有牙）**：`onClose` 副作用不丢——断言「从 ⚙ 关闭时，若守卫放行则 `onClose` 被调用一次
     （含 `notifyAgentConfigChanged`）」；守卫拦截时 `onClose` **零次**。
     ⚠️ `App.tsx` **全仓无任何测试挂载**（`smoke.test.js` 是静态断言，不渲染 React）⇒ 组件层测试的宿主是
     `SettingsOverlay` + `AppChrome`：**把 `AppChrome` 的 ⚙ 按钮 `onClick` 换成测试里的 `handle.requestClose`**，
     断言拦截时 `onClose` 零次。`App.tsx:344` 那行接线本身由**静态守卫**兜底
     （见测试策略，形态与既有 `settings-agents-tabs.test.ts:74-92` 的 AgentEditorView 静态守卫完全一致）。
     把 `:344` 改回 `setSettingsOpen(open => !open)` ⇒ **静态守卫变红**。
  4. **不回归（纯函数层必须全绿）**：`cd apps/desktop && npx tsc --noEmit` → 0 错误；
     `settings-nav-guard.test.ts` 全部既有用例（`isSameSkillRef` 4 例 + `shouldGuardSettingsNav` 8 例）绿。
  5. **renderer 基线**：`npx tsc --noEmit -p tsconfig.renderer.json` ⇒ **仍为 411**
     （本条不碰类型面；⚠️ 新测试文件落在 `test/**` 内、受该 tsconfig 的 `include` 覆盖，**必须 0 类型错**，
     否则会把 §2 验收 4 的「恰好 −1 = 410」与 §1 验收 5.2 的两个锚点顶歪）。
  6. **desktop 测试**：带参调用 ⇒ 红条目仍为 1 条（`cr-05 not open` 满负载 flake，隔离复跑绿，`baseline.md §3.2/§4`），
     分母 +N。⚠️ **默认 `npm test` 在 Windows 上是收集 0 条的假绿**（`run-tests.mjs:27-30`，
     Wave A 的 N-P0-02 未落前不得用它判绿，见本文件 §1 验收 5 的提醒）。

- **测试策略**：

  - **新增** `apps/desktop/test/agent-editor-dirty-guard.test.tsx`（覆盖 1、2 的组件半）：
    夹具 = `register(new URL("./react-alias-hook.mjs", …))`（`chat-search-race-guard.test.tsx:40` 的既成写法，
    解决 `react-test-renderer` 与 `apps/desktop/node_modules/react` 双副本）+ `window.novelMasterDesktop.invoke` 录载荷。
    若 `AgentEditorView` 的依赖树（`settings-ui` / `PromptMacroTextarea` / `Switch` / `ToolPolicyPicker` / `Tooltip`）起不来，
    按 §1 的退路给 `@/utils/settings-feedback` 之类加 stub 后再试，**不得降级为源码正则断言**。
  - **追加** `apps/desktop/test/settings-agents-tabs.test.ts`（**既有文件、只追加**）：
    加一条静态守卫，锁两处「接线」而非行为——
    ① `AgentEditorView.tsx` 源码含 `nav.dirtyViews.add("agentEditor")`（或等价的 add/delete/cleanup 三段）；
    ② `App.tsx` 源码**不再**出现 `onToggleSettings={() => setSettingsOpen(open => !open)}`。
    ⚠️ 这两条**明确是弱观测**（形态改了但语义没改也可能红），只作**接线兜底**；
    **主验收是回归锁 A**（行为断言）。这是对 RULE:85 第一条的自觉让位：该文件已是全仓
    「挂载 `WorkspaceSettingsView` 的唯一测试文件」且通篇是静态守卫（`:40-98`），加在这里不引入新范式。
  - 用例名（拟）：`T-SD04-1 改字段后 agentEditor 上报 dirty、卸载后清除`、
    `T-SD04-2 agentEditor dirty 时点 × → onClose 零次且确认弹窗可见`、
    `T-SD04-3 ⚙ 关闭走 requestClose（静态接线守卫）`。
  - **断言的牙齿自查**：主验收 A/B 的观测面是 `nav.dirtyViews` 这个**注入 Set** 与 `onClose` 的调用次数
    （注入缝，与实现同源、可注入）；C 是弱观测且已标注为兜底。

- **回归线**（必须保持绿）：

  - `apps/desktop/test/settings-nav-guard.test.ts`（**守卫读侧全族**）
  - `apps/desktop/test/settings-agents-tabs.test.ts`（**本条追加静态守卫的宿主**，含 `:79` 的
    `applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null)` 与 `:89` 的 `disabled={saving || isBuiltin}` 两条断言）
  - `apps/desktop/test/settings-agents-delete-confirm.test.ts`、`skills-manage-export-menu.test.ts`、
    `smart-sort-rules-view.test.ts`（同 Overlay 的其它 view 出口）
  - `apps/desktop/test/session-detail-drawer.test.ts`（`AppChrome` 侧不回归）
  - `packages/core/test/config-forms/agent-editor-state.test.ts`（若与 §9 / `wave-b-core2 §9` B 条同 PR，见依赖栏）

- **依赖**：

  - **前置**：无。
  - **🔗 同 PR 见 `wave-b-core2.md §9` 的 B 条（`formSnapshotJson` 缺 `mode`）**：
    B 条要求「基线侧与实时侧同时带 `mode`」，而本条步骤 1 的 effect 依赖的正是 `dirty` 判定
    （`:630` 的 `savedBaseline` vs `snapshot`）⇒ **B 条不修时，本条的 effect 会是「恒 false」的另一种形态**
    （改作用域不 dirty ⇒ 不上报 dirty ⇒ 守卫对该字段无效）。**两条必须同 PR 落地、一起验收。**
    两者改的是**同一文件**：`AgentEditorView.tsx`（B 条动 `:291-303` 的 baseline 构造，本条动 `:387` 之后的 effect）——
    hunk 不交叠，但**验收必须合并跑**（B 条的「打开即 dirty」端到端断言 + 本条的 A/B 锁）。
  - **与 §9（E）的关系**：同文件、同 PR 可行（§9 改 `applyDefinition` 与 `loadAgent` 的 model 处理，
    本条只加一个 effect）⇒ 建议 §8 + §9 + `wave-b-core2 §9` B 条**合成一个 PR、三个独立 commit**。
  - **拍板项**：无。

- **风险与回滚**：

  - 风险 1（中，唯一需要盯的）：**上报 dirty 后，用户改了智能体配置点侧导航会被拦**——
    这正是本条的目的，但它会让一批「以前能直接跳走、现在要确认」的操作路径变长。
    缓解：`ConfirmModal` 已有「未保存的更改 / 有未保存的更改，离开将丢弃。是否继续？」文案（`:320-324`），
    取消即留在原页，符合预期；**不额外加「本次会话不再提示」之类的开关**（那是产品决策，不在本条）。
  - 风险 2（低）：effect 落点写错位置 ⇒ 触发 `react-hooks/rules-of-hooks` 报错或运行期 hook 顺序错乱。
    缓解：位置已在修法里写死（`:387` 之后、`:389` 之前），验收 1 的「卸载后清除」用例会照出放错位置的情况。
  - 风险 3（低）：⚙ 改走 `requestClose` 后，**从 ⚙ 关闭会重置到 workspace**（与 × 一致）
    ⇒ 未保存的 agent 编辑在关闭时若被守卫拦下，用户取消则设置页仍开着（符合预期）；
    若守卫放行则 view 被卸载重置——与今天的 × 行为一致，**不引入新的丢失路径**。
  - 回滚：**两步可独立回滚**——只回滚 App 侧（守卫仍对四个 Overlay 分发点有效，只是 ⚙ 入口继续旁路）；
    只回滚 effect（守卫回到「只对 skillDetail 生效」的现状）。无数据迁移、无契约变更。

---

## 9 · E —— 智能体配置**加载失败**时静默解除原绑定模型，保存即落库（R2 补写）

- **严重度 / 簇**：P1 / apps-desktop，量 **M**。台账 `ledger-v2.md:169`（盲扫新增；W6 读码闭环 +
  revalidate-b valid：六步失败链逐跳仍在，revalidate-b 独立复核到 `:346-356` 的 `allModels.find`
  与 `:351-356` 传 `null`，并确认无任何缓解）。judge-r1 A.2(b) 判 §10 未排期 ⇒ R2 补排补写（R2-6）。

- **病症**：**原绑定模型在「模型列表加载不出来」时被当成「本来就没绑定」**。六步链（本轮逐行复核）：

  1. `loadAllSavedModels`（`:221-251`）逐服务商 `ipcProviderModelsSavedList`，**失败即吞**：
     `:235/:242` 的 `res.ok ? res.data.map(...) : []` ⇒ 单个服务商失败，它下面所有模型静默消失；
  2. `ipcProvidersList`（`:324`）整体失败时，`providerRows` 直接取 `[]`（`:337-343`）⇒ 一个模型都拿不到；
  3. `loadAgent` 用 `allModels.find(m => m.id === def.model)`（`:346-350`）找 `pinned` ⇒ 找不到就是 `undefined`；
  4. `:351-356` 把 `null` 传给 `applyDefinition`（`pinned != null ? {...} : null`）；
  5. `applyDefinition`（`:286-289`）按「无 pin」渲染表单：`setModelEnabled(false)` / `setProviderId("")` /
     `setSavedModelId("")` ⇒ 「专属模型」下拉（`:764-769`）显示「**默认(跟随)**」，
     **页面上没有任何提示**告诉用户「你的专属模型刚才还在」；
  6. `save()`（`:517-521`）`if (modelEnabled && savedModelId) … else delete definition.model;`
     ⇒ **用户只要改了别的字段（让 `dirty` 为真）并点保存，原绑定模型就被从库里删掉**。
     而 `:291-303` 的 baseline 也是按 `modelOn=false` 落的 ⇒ 保存后快照与基线一致，
     toast 还弹「已保存智能体配置」⇒ **全程无任何异常信号**。

  ⚠️ **本轮补到台账未记的最后一跳**：台账把病灶记在 `:346-356`（传 `null`）就停了。
  没有 `:517-521`，传 `null` 只是 UI 显示退化；**有了 `:517-521` 才是「静默删除用户数据」**——
  两者之间还隔着一次用户点保存的交互，所以本条定 P1 而不是 P0。

- **证据**（`apps/desktop/renderer/features/settings/AgentEditorView.tsx`，本轮逐行核对）：

  ```
   232      const results = await Promise.all(
   234        ipcProviderModelsSavedList({ providerId: p.id }).then((res) =>
   235          res.ok ? res.data.map(...) : [],        ← 失败即吞，无任何标记
  ```
  ```
   346      const allModels = await loadAllSavedModels(providerRows);
   348      const pinned = def.model != null ? allModels.find(m => m.id === def.model) : undefined;
   353        applyDefinition(def, pinned != null ? {providerId: ..., modelId: pinned.id} : null);
  ```
  ```
   286      const modelOn = pinned != null;      // ← null 被当成「本来就没绑定」
   288      setProviderId(pinned?.providerId ?? "");
   517    if (modelEnabled && savedModelId) { definition.model = savedModelId; } else { delete definition.model; }
  ```
  ```
   765              value={modelEnabled ? savedModelId : ""}    // 下拉显示「默认(跟随)」
   769              <option value="">默认(跟随)</option>
  ```

- **修法**（单文件 · `AgentEditorView.tsx`，4 步，**不碰 core、不碰 IPC 契约**）：

  1. **`loadAllSavedModels`（`:221-251`）不吞失败**：返回形状从 `Array<...>` 改为
     `{ models: Array<...>; failedProviderIds: string[] }`（或等价地加一个 `modelLoadFailures` state），
     `:235/:242` 的 `: []` 改为 `: {models: [], failed: true}` 形态。
     ⚠️ 该函数**只有一个调用方**（`:346`，本轮 grep 确认）⇒ 改签名无外部影响。
  2. **`loadAgent`（`:346-356`）三分支取代二分支**：
     - `def.model == null` ⇒ 仍传 `null`（本来就没绑定，**行为零变化**）；
     - 找到 `pinned` ⇒ 仍传 `{providerId, modelId}`；
     - `def.model != null` 但**找不到** ⇒ 传**新的第三种形态** `{unresolved: true, rawId: def.model}`
       （把 `applyDefinition` 的第二参从 `X | null` 放宽成
       `{kind:'none'} | {kind:'pinned';providerId;modelId} | {kind:'unresolved';rawId}` 之类的可辨识联合）。
     ⚠️ **不要给 `applyDefinition` 加第三个位置参数**：既有静态守卫
     `settings-agents-tabs.test.ts:79` 断言的是 `/applyDefinition\(DEFAULT_SUBAGENT_DEFINITION, null\)/`，
     加第三个参数会把这条既有守卫打红 ⇒ 用**第二参的形状**表达，不动参数个数。
  3. **`unresolved` 态的表单与保存语义**（这是本条的核心，不是纯 UI 装饰）：
     - 新增 state `unresolvedModelId: string | null`（存 `def.model` 原串）；
     - 「专属模型」下拉（`:764-769`）在 `unresolvedModelId != null` 时**加一个置顶 option**
       「⚠ 原绑定模型当前不可用（<rawId>）」并选中它 ⇒ 用户一眼看得出「有个绑定，但列表里没有」；
     - **保存时保留原值**：`save()`（`:517-521`）的判定改为
       `if (unresolvedModelId != null && !modelTouchedByUser) definition.model = unresolvedModelId;`
       （`modelTouchedByUser` 由 `handleModelSelect`（`:618-628`）置位）；
     - **给用户显式解除的出口**：置顶 option 之外再渲染一个「解除绑定」按钮 / 或让用户把下拉选回
       「默认(跟随)」即视为显式解除（后者零新增 UI，**默认案取后者**，另加一条提示文案说明）；
     - `applyDefinition` 的 baseline（`:291-303`）必须与表单取值同源 ⇒ 加载后**不得**一打开就 dirty。
  4. **渲染提示**：在「模型」section（`:759-782`）内、`SettingsField` 之后渲染一条
     `settings-hint--compact`（`:741-743` 已有先例）或 `settings-error-panel__message`（`:470` 先例）文案：
     「原绑定模型当前不可用（服务商可能已删除或模型列表加载失败），保存将**保留**原绑定；选择『默认(跟随)』可解除。」
  5. **明确不做**：不改 `buildAgentDefinitionFromForm`、不改 `handleModelSelect` 的既有语义、
     不给 `ipcProviderModelsSavedList` 加重试（那是另一条面）、不动 core 的 `AgentDefinition` 契约。

- **验收**（可测断言 / 命令 + 期望）：

  1. **回归锁 A（主验收，有牙）**：新增 `apps/desktop/test/agent-editor-model-pin-preserve.test.tsx`：
     mock `ipcAgentRegistryGet` 返回 `value.model = 'm-pinned'`；mock `ipcProvidersList` 返回**一个**服务商；
     mock 该服务商的 `ipcProviderModelsSavedList` 返回 `{ok:false, error:{code:'X', message:'boom'}}`；
     改一个无关字段（如 `maxSteps`）后点「保存」⇒ 断言录到的 `ipcAgentRegistryUpsert` 载荷
     **`definition.model === 'm-pinned'`**。
     **牙齿**：把 `:351-356` 改回 `pinned != null ? {...} : null` ⇒ `definition.model` 变 `undefined` ⇒ **变红**。
  2. **回归锁 B（最坏形态：providerRows 为空）**：`ipcProvidersList` 本身返回 `{ok:false}` ⇒ 同 A 的保留断言
     （当前实现下这是「一个模型都拿不到」的最坏形态，也是最容易漏测的一支）。
  3. **回归锁 C（提示可见）**：A/B 两种失败态下断言渲染树包含「原绑定模型当前不可用」字样。
  4. **回归锁 D（不误报）**：`def.model == null`（出厂无绑定）⇒ **不渲染**该提示，
     保存后 `definition.model` 仍为 `undefined`。**这条防「把没绑定也报成不可用」的过度修法。**
  5. **回归锁 E（用户仍能主动解除）**：在 A 的失败态下把下拉选回「默认(跟随)」再保存
     ⇒ 载荷 `definition.model === undefined`。**这条防「保留原绑定」把选择权也冻住。**
  6. **回归锁 F（不回归：成功路径）**：`ipcProviderModelsSavedList` 返回含 `m-pinned` ⇒
     不渲染提示、载荷 `definition.model === 'm-pinned'`、且**加载后未改动时 `dirty === false`**
     （锁 baseline 一致性；⚠️ 这条与 `wave-b-core2 §9` B 条的「打开即 dirty」断言是同一条断言的加强版）。
  7. **命令与期望**：`cd apps/desktop && npx tsc --noEmit` → 0 错误；
     `npx tsc --noEmit -p tsconfig.renderer.json` → **仍为 411**（同 §8 验收 5 的约束：新测试文件在 `test/**` 内、必须 0 类型错）；
     desktop 带参 `npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"` →
     红条目仍为 1 条、位置不变，分母 +N（⚠️ 默认 `npm test` 是 Windows 假绿）。

- **测试策略**：

  - **新增** `apps/desktop/test/agent-editor-model-pin-preserve.test.tsx`（覆盖 1–6）：
    夹具与 §8 的 `agent-editor-dirty-guard.test.tsx` **同源**（`react-alias-hook.mjs` + `window.novelMasterDesktop.invoke` 录载荷
    + 手写 `nav` fake）⇒ **两条建议放同一个文件**（同一屏、同一夹具、同一组期望，符合 RULE:85 第二条），
    或至少共用同一份 `makeNav()` 工厂。
    ⚠️ 依赖树起不来时按 §1 的退路加 stub，**不得**降级成源码正则断言。
  - **追加** `apps/desktop/test/settings-agents-tabs.test.ts`（弱观测兜底，只加一条）：
    断言 `AgentEditorView.tsx` 源码**不再**出现 `pinned != null ? {providerId` 这段「找不到就传 null」的表达式
    ——形态守卫，明确标注为兜底（与 §8 的 C 同理）。
  - 用例名（拟）：`T-E-1 单服务商模型列表失败 → 保存仍保留原绑定 + 有提示`、
    `T-E-2 ipcProvidersList 失败 → 同上`、
    `T-E-3 无绑定不误报`、
    `T-E-4 显式选回「默认(跟随)」可解除绑定`、
    `T-E-5 成功路径不渲染提示且加载后不 dirty`。
  - **断言的牙齿自查**：1/2/4/5 的观测面是 **`ipcAgentRegistryUpsert` 载荷的 `definition.model` 字段**
    （录载荷的注入缝，**不是**「下拉显示成什么」这种可被形态绕开的弱观测）；
    3 是渲染文本（弱但必要，与 1 互补）；6 的 `dirty` 是同源 JSON 比对。

- **回归线**（必须保持绿）：

  - `apps/desktop/test/settings-agents-tabs.test.ts`（**既有守卫 `:79` / `:89` 不得变红**）
  - `apps/desktop/test/settings-nav-guard.test.ts`
  - `apps/desktop/test/agent-registry-handlers.test.ts`（main 侧 upsert/get，本条不改 handler，应恒绿）
  - `apps/desktop/test/agent-run-saved-model-session.test.ts`（会话侧读 agent 绑定的消费面）
  - `apps/desktop/test/settings-db-maintenance-ui.test.ts`（同 Overlay 的出口面，不回归）
  - `packages/core/test/config-forms/agent-editor-state.test.ts`（若与 B 条同 PR，见依赖栏）

- **依赖**：

  - **前置**：无。
  - **🔗 同 PR 见 `wave-b-core2.md §9` 的 B 条（`formSnapshotJson` 缺 `mode`）**：
    B 条的修法步骤 2 改的正是本条修法步骤 3 要碰的**同一段**（`AgentEditorView.tsx:291-303` 的
    `setSavedBaseline(formSnapshotJson({...}))`）；且 B 条的验收里那条
    「加载后未改动时 snapshot 与 savedBaseline 相等」**就是本条验收 6** ⇒ 两条同 PR、一次跑完。
    **顺序无要求**（hunk 不交叠：B 条加 `mode` 一行、本条加 model 三项与 unresolved 分支），但**必须同 PR**，
    否则「baseline 一致性」这条断言会被两边的半成品各打红一次。
  - **与 §8（S-D-04）的关系**：同一文件、可同 PR（§8 加 effect、§9 改 model 处理）⇒ 建议与 §8 合成
    「desktop 设置页两条」一个 commit 组，**各自独立 commit**。
  - **拍板项**：无。⚠️ 若产品认为「模型列表加载失败时应直接禁用保存按钮、逼用户重试」，
    那是**比本条更大**的口径（改的是保存可用性而非保存语义），**另立一条**，不并进本条。

- **风险与回滚**：

  - 风险 1（中，**本条的主要风险**）：把「保留原绑定」做成默认，会让「那个模型确实该被解除」的用户
    多一步（把下拉选回「默认(跟随)」）。缓解：验收 5 就是这条风险的锁——保留 ≠ 冻结。
  - 风险 2（低）：`applyDefinition` 第二参从 `X | null` 放宽成可辨识联合 ⇒ 两个调用点
    （`:319` general、`:351` 正常分支）都要改。其中 `:319` 的 `applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null)`
    被既有静态守卫 `settings-agents-tabs.test.ts:79` 逐字匹配 ⇒ **要么保持 `null` 作为「无绑定」形态、
    要么同步改那条守卫**；本条默认案是**保持 `null`**（把联合类型写成
    `null | {providerId; modelId} | {unresolved: true; rawId: string}`），使 `:319` 一行不改、既有守卫不受影响。
  - 风险 3（低）：`unresolvedModelId` 与 `handleModelSelect` 的「用户显式动过」标记若不同步，
    会出现「用户选了新模型但仍保存旧绑定」。缓解：把标记**只在 `handleModelSelect` 里置位**，
    并由验收 4/E 两条正反用例夹住。
  - 回滚：单文件改动（1 个函数签名 + 1 个新 state + 保存分支 + 1 条提示），`git revert` 即可；
    **回滚后行为退化为今天的「静默解除」形态**，无数据迁移、无 schema 变更、无残留状态。

---

*本分片所有 file:line 于 `fe79b781`（worktree `D:\Dev\nm-worktree\mcr`，HEAD 实测
`fe79b7810c0c78c48a18c76486359d7d45e253fa`）工作区逐条打开核对；`npx tsc --noEmit -p tsconfig.renderer.json`
为撰写期实跑结果（411 条基线 / 138 条 TS18046 = 125 + 13；基线口径见 §0.3，终值以 `fix-spec/baseline.md` S1 定案）。*

*R2 补写（§7 AM-3 / §8 S-D-04 / §9 E）的核对方式同上：三处的**全部** file:line 都在本轮于 `fe79b781`
工作区 `Read`/`findstr` 实跑复核（`git grep RealPrompt -- apps/mobile/src`、
`findstr /s dirtyViews apps\desktop\renderer`、`findstr /s 未保存 renderer` 等），
**未照抄台账行号**；与 `ledger-v2.md:159/167/169` 逐条比对**无行号漂移**，台账唯一的口径缺口（E 少了 `:517-521` 这一跳）
已在 §9 病症里显式补上。R2-14 的陈旧分母（mobile 1604 → **1739 tests / 237 suites / 1738 pass / 1 fail**，
`fix-spec/baseline.md §3.3 / §4` 实测）已在 §3 验收 7 就地刷新。*
