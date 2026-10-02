# CR Round 1 · 节点 cr-apps（Wave B 双端 apps 七条 + A7b 编码 + gap 补测）

## 元信息

- repo：`D:\Dev\nm-worktree\mcr`（feat/repo-mega-cr）
- base_sha：`fe79b781` ／ head_sha：`046f4d9c`
- 本 scope commit：`37df8900` — fix(apps): Wave B apps 七条+A7b 编码+补测（N-P1-04 / §6#5 / AM-1 / N-P1-03 / AM-3 / S-D-04 / E）
- 业务 spec：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-b-apps.md`（§1 §2 §3 §4 §7 §8 §9 共七条；§5 invoke-registry 明确划归 wave-e，**不在本 scope**）
- CR fix-spec：`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（draft，首轮）
- 模式：scope（只读评审，未改任何代码 / spec，未做任何 git 写）
- 维度：A（spec 符合度）+ B（语义链与边界）+ C（并发/时序窗口）+ C-orch（编排一致性）+ G（测试缝与测试有效性）

### 实证验证（本轮亲自跑，非引用）

| 命令 | 结果 |
|---|---|
| `apps/desktop` `npx tsc --noEmit` | **0 错误**（输出 0 字节） |
| `apps/mobile` `npx tsc --noEmit -p tsconfig.build.json` | **0 错误** |
| `apps/desktop` `npx tsc --noEmit -p tsconfig.renderer.json` | **371 错**（`ChatHistorySearchPanel.tsx` 已不在输出里 ⇒ §2 的相对锚点成立；绝对值见 P2-5） |
| `apps/desktop` `npm test -- test/agent-editor-dirty-guard.test.tsx test/chat-search-error-render.test.tsx test/settings-overlay-request-close.test.tsx test/workspace-settings-compaction-debounce.test.tsx test/settings-agents-tabs.test.ts` | **24 tests / 24 pass / 0 fail**（走 `scripts/run-tests.mjs` 带参，零收集守卫生效；裸 `node --test` 跑 `.tsx` 会 `ERR_UNKNOWN_FILE_EXTENSION`，非本 commit 问题） |
| `apps/mobile` `npx jest <11 个新增/改动用例文件> --maxWorkers=2` | **11 suites / 11 passed，69 tests / 69 passed** |
| 编码字节级扫描（自写脚本，`git ls-files apps` 全量 1218 文件按 UTF-8 解码计 U+FFFD） | 见下文「A7b 字节级对照」 |

**结论：七条的实现质量明显高于台账描述的基线形态——spec 反复强调的「牙齿」几乎全部真的长出来了（`useRef` 惰性初始化、编译期 `AssertNoFn`、`mock.timers` 显式 `apis`、LRU 命中刷新新鲜度、负向断言）。回归线整体可信。以下 1 个 P1 + 8 个 P2 按维度列出。**

### A7b 编码字节级对照（抽 3 处，全部通过）

自写脚本对比 `fe79b781` 与 HEAD 的 UTF-8 解码结果，逐行 dump 差异：

1. `apps/desktop/src/main/ipc/handlers/vfs.ts:2` — BASE `VFS IPC handlers �?list/read/...` → HEAD `VFS IPC handlers — list/read/...`（U+FFFD → U+2014 em dash）✅
2. 同文件 `:81` — BASE `（消费方 ①）�?*/` → HEAD `（消费方 ①）。*/`（U+FFFD → U+3002 句号）✅
3. `apps/mobile/src/services/session-prompt-input.service.ts` — **BASE U+FFFD 计 178 处 → HEAD 计 0 处**，与 commit message 声称的「178 处」**逐位吻合**；另含 BASE L110-114 五行 GBK 双解码垃圾（`// assemble �� prepare(S0)���� agent-runner ͬԴ��…`）一并重写为可读中文（`// assemble → prepare(S0)，与 agent-runner 同源。…`）✅

全量扫描结论：`apps/` 下所有 `.ts/.tsx/.js/.mjs/.json/.md/.css/.html` 在 HEAD 上 **U+FFFD = 0、BOM = 0**，唯一的例外见 P2-7。

---

## 1 · Must-fix（按 P0 → P1 → P2）

### P0

**无。** 七条的主病灶（最后一次击键丢失 / 白屏 / forgetSession 零调用 / 死路由 / 跨会话提示词 / dirty 恒不上报 / 保存静默删绑定）在 HEAD 上均已按 spec 的修法落地，且各自的主验收断言有牙。

### P1-1 ★ `AgentEditorView`：unresolved 态下改选有效模型，下拉与提示双双说谎（B + A）

**位置**：`apps/desktop/renderer/features/settings/AgentEditorView.tsx:702-720`（`handleModelSelect`）与 `:854-869`（`<select value>`）

```tsx
// :702 handleModelSelect
if (id === "") { ...; setUnresolvedModelId(null); return; }      // ← 只有这一支清了
if (id === UNRESOLVED_MODEL_OPTION_VALUE) { setModelEnabled(true); return; }
setModelEnabled(true);
setSavedModelId(id);           // ← 正常分支【没有】setUnresolvedModelId(null)
```
```tsx
// :854 <select>
value={unresolvedModelId != null
  ? UNRESOLVED_MODEL_OPTION_VALUE      // ← 优先级最高，把刚选的真实模型盖掉
  : modelEnabled ? savedModelId : ""}
```

**机理**：`unresolvedModelId` 在用户「原绑定模型不可用」的初始态下非空。用户打开下拉选一个**有效模型**时，`handleModelSelect` 只更新 `savedModelId` / `providerId`，`unresolvedModelId` 原样留着 ⇒ 下一次渲染时 `value` 的三段表达式第一段命中 ⇒ `<select>` 显示值被强制拉回 `⚠ 原绑定模型当前不可用`；`:885-890` 那条 `settings-hint--compact` 提示也照旧渲染，继续宣称「保存将保留原绑定」。

**后果**：
- 用户看到的选中项与他刚做的选择**不一致**（选项列表里始终挂着那个 ⚙ 哨兵项）；
- 提示文案变成**假话**——此时 `modelTouchedByUser === true`，`:597` 的判定落到 `else if (modelEnabled && savedModelId)`，实际落库的是**新模型**，与提示说的「保留原绑定」正好相反；
- 这条路径上「用户能主动改绑」这一 spec §9 修法步骤 3 的核心诉求，在 UI 上**不可见**——用户会以为自己没改成，从而放弃修复、或者改去手工删服务商。

**为什么没被测出来**：spec §9 验收 5（T-E-1…T-E-5）只覆盖了「不碰下拉直接保存」「选回『默认(跟随)』」「成功路径」三条，**没有一条覆盖「unresolved 态下改选一个有效模型」**。本 commit 落的 `agent-editor-dirty-guard.test.tsx:271-373` 逐条对上了 spec 的六条验收，但 spec 本身漏掉了这一格。

**建议修法**（一行，与既有 `id === ""` 分支同款）：在 `handleModelSelect` 的正常分支补 `setUnresolvedModelId(null);`。
⚠️ 补之前先定口径：清掉 `unresolvedModelId` 后提示消失，用户再也看不到「原来的绑定是什么」。若产品希望保留提示，建议把「原值」拆成独立的 `originalModelId` 只用于渲染文案，与「当前是否要保留」解耦——见 §3 Open question 1。

---

### P2-1 LRU 淘汰与 `loadIdleOlderMessages` 的 `await` 窗口相撞，本次「上翻更早消息」被静默丢弃（B + C）

**位置**：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1004-1047`

```ts
this.idleMessageViews.set(sessionId, {...idle, loadingMoreMessages: true});   // :1004
this.notifyChanged();
try {
  const older = await this.runtime.messages.listBySessionPage(...);          // :1007 ← await
  const current = this.idleMessageViews.get(sessionId);                      // :1011
  if (current == null) { return; }                                           // :1013 ← 直接放弃
```

`idleMessageViews` 现在是 `createLruMap(500)`。在 `:1007` 这个 `await` 挂起期间，只要别的路径往这张表里灌进 501 个不同 sessionId，本会话的条目就会被淘汰，于是 `:1011` 拿到 `null`、`:1013` 直接 return；`finally`（`:1039`）同样拿到 `null`，连 `loadingMoreMessages` 的复位都不必做（条目已经不在表里）。

净效果不是崩溃而是**静默失效**：这一页「更早的消息」永远加载不出来，用户往上翻就是空。spec §3 修法步骤 5 的核对结论写的是「映射 1:1 无缺口」「命中即 delete+set 重排**不影响任何既有逻辑**」——这句话对**同步**的 get/set 成立，对**跨 await 的 read-modify-write 不成立**，spec 漏了这一类。

**建议**（择一，成本都很低）：
- 在 `:1011` 的 `current == null` 分支里补一次 `loadSessionTailMessages(sessionId, projectId)` 兜底重建（语义与注释里承诺的「重进时重新填充」对齐）；
- 或把 `:1004` 的 `loadingMoreMessages:true` 状态从 LRU 表里挪到一张**不参与淘汰**的小表（与 `SESSION_STREAM_MAX_SETTLED_UNITS` 的 `units` 同款保护）。

### P2-2 `createLruMap.get` 用 `hit !== undefined` 判命中，`T` 含合法 `undefined` 值时新鲜度不刷新（B）

**位置**：`apps/mobile/src/services/scope-key-cache.ts:60-70`

```ts
get(k) {
  const hit = entries.get(k);
  if (hit !== undefined) { entries.delete(k); entries.set(k, hit); }
  return hit;
}
```

当前两处使用点的 `T`（`SessionStreamSettledProjection` / `IdleMessageView`）都不含 `undefined`，所以**当前无实害**。但这是个通用工厂（导出且被 manager 当基础设施用），一旦将来塞进 `T | undefined` 的值，写入 undefined 的那条永远不会刷新新鲜度 ⇒ 被优先淘汰，且症状（"莫名其妙丢了"）与病因相隔十万八千里。改成 `if (entries.has(k))` 即可，同样零成本。

### P2-3 `useChatTabScope` 的 TODO 措辞不准：这个缺口今天就能收，不必等 core（C-orch）

**位置**：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:604-609`

```
//   待办：core 侧补 BFS 读口（listByParentSession）后，把这里的展开补上并回收该缺口。
```

实测 `listByParentSession` **在 core 里已经存在**，不是「待补」：
- `packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts:51`（仓储实现）
- `packages/core/src/domain/chat/repositories/session.port.ts:14`（仓储 port）
- `packages/core/src/service/vfs/impl/physical-vfs.service.ts:311 / :511`（已有两处 BFS 队列展开的既成写法）

真正缺的是**服务层 `SessionService` 的暴露**（`packages/core/src/service/chat/session.port.ts:15` 只有 `listByProject`），而 `packages/core/src/service/chat/impl/project.service.ts:161-170` 已经把「顶层 + 逐层展开子会话」的模板写好了。

这条 TODO 按现在的措辞会让后来者以为要等 core 大改，实际是「在 service port 上加一行 + 在 mobile 侧复用现成 BFS 模板」。spec §3 修法步骤 3 本身就写了「默认案（⚠ 已知缺口）」并允许只靠 LRU 兜底，所以**当前实现不算 spec 违规**；但注释把「core 侧补读口」和「service 层没导出」混成了一件事，会把一个今天能收的缺口拖成待办。

### P2-4 spec 明文要求的 `docs/apm/RULE.md` 登记没有落（A）

spec §3 修法步骤 3 结尾：「⇒ 本步**必须**在 `handleDeleteProjects` 上留一条 TODO … **并在 `docs/apm/RULE.md` 登记「manager 的会话↔项目归属缺口」**」。

实测：`git grep "会话↔项目\|manager 的会话\|归属缺口" -- docs/` 全仓**零命中**。代码侧的 TODO 留了，RULE 侧那一半没落。这条缺口靠 500 LRU 兜底、且子会话的投影可能持有消息全文，属于「必须跨轮次记住」的那一类知识，正是 RULE 该承载的内容。

### P2-5 spec 的 renderer 基线绝对锚点（411 / 410）在本 HEAD 已过期（C-orch）

spec §1 验收 5.2、§8 验收 5 要求「仍为 **411**」，§2 验收 4 要求「恰好 **410**」。实测本 HEAD 是 **371** —— 因为 Wave D（`6594b67c`「renderer 基线 411 → 371」）已经在两次 CR 之间落地了。

相对语义**成立**（`ChatHistorySearchPanel.tsx` 已不在 tsc 输出里；新增的 4 个 desktop 测试文件在 `test/**` 内、受 `tsconfig.renderer.json` 的 include 覆盖，也没有顶出新错误）。但绝对数字已经失去锚定作用：按 spec 字面「应为 410」去验收会得到一个假的「多了 39 条红」的结论。建议后续 spec 把这类锚点改写成相对表述（「比 Wave D 后的 371 少 1 条」）或直接引用 `baseline.md` 的当期值。

### P2-6 新增用例的 act 环境卫生（G）

两处实跑可见：

- `apps/desktop/test/chat-search-error-render.test.tsx` 运行期打印 `The current testing environment is not configured to support act(...)` ⇒ 该文件未设 `IS_REACT_ACT_ENVIRONMENT`。用例仍然绿，但 act 未生效时 React 的批处理与 effect 时序与真实渲染不同源，**这正是 spec §1 反复强调「tick 前先 `await act(async () => {})`」要防的那类偏差**，出现在本 commit 自己的新夹具里。
- mobile 侧 6 个新/改用例在收尾时刷 `Cannot log after tests are done … An update to Harness inside a test was not wrapped in act(...)`（`use-chat-tab-scope-forget-session.test.ts` 等）⇒ `mountScope()` 之外仍有未 await 的 state 更新在用例结束后落地。

都不影响断言正确性（观测面都是 mock 的调用参数序列），属夹具卫生，记 P2。

### P2-7 A7b 编码扫描在 `apps/` 下还有一个文本文件没扫到（G）

全量扫描 1218 个受版本控制的 `apps/` 文件，唯一**仍带 U+FFFD 的文本文件**是：

`apps/mobile/android/app/build.gradle` — BASE 20 处 / HEAD **20 处（未动）**，且含字面量 `&#65533;`（数字字符引用写在 `.gradle` 注释里不会被解释，就是纯乱码文本），例如：

```
BASE/HEAD L12:  /* Folders �&#65533; hoisted deps at monorepo root */
BASE/HEAD L118: // 避免用任务名是否泛匹�&#65533; release—�&#65533;./gradlew build �&#65533; taskNames=[build] 会误判�&#65533;
```

commit message 的 A7b 只声明了 `session-prompt-input` + `vfs.ts` 两个文件，所以**不构成 spec 违规**；但它就在 `apps/` 下面、且是纯注释（不影响构建），同一次扫描顺手收掉的成本近零。建议要么纳入 A7b 收尾，要么在 commit message / RULE 里显式声明「A7b 在 apps/ 侧只覆盖这两个文件，`android/` 下的 gradle 脚本不在扫描面」，避免下一轮又当成漏做。

### P2-8 `App.tsx` 的 `onClose` 内联 ⇒ `requestClose` 每次提交都被重写（B，低）

`apps/desktop/renderer/App.tsx:372-375` 的 `onClose={() => { setSettingsOpen(false); notifyAgentConfigChanged(); }}` 是内联箭头 ⇒ `DesktopOverlays` 每次重渲染都产生新身份 ⇒ `SettingsOverlay` 的 `handleClose`（deps `[guardedNav, onClose]`）跟着换身份 ⇒ `useImperativeHandle(ref, () => ({requestClose: handleClose}), [handleClose])` 每次提交都重写 ref。

**功能上没有任何问题**（`settingsOverlayRef.current.requestClose()` 拿到的永远是最新闭包，这正是 useCallback+useImperativeHandle 该有的行为）。但它让「这个 ref 稳不稳」这件事永远无法靠引用稳定性推理——将来若有人在 `requestClose` 上挂 memo 化的下游（比如把 guard 结果缓存起来），就会踩到这个不稳定源。spec §8 修法步骤 2 只说了「`notifyAgentConfigChanged()` 一行不改」，没提这层。记 P2 供拍板。

---

## 2 · Spec deviations

1. **`docs/apm/RULE.md` 登记缺失**（spec §3 修法步骤 3 明文要求「必须」）→ 见 P2-4。
2. **renderer 基线绝对锚点失效**（spec §1 验收 5.2 / §2 验收 4 / §8 验收 5 的 411 / 410）→ 见 P2-5。属 spec 自身与 HEAD 不同步，非本 commit 造成，但会让按字面验收的人得到假红。
3. **未发现其它偏离**。逐条对照结论：
   - §1 N-P1-04：草稿 ref 走 `useEffect` 同步（不在渲染期赋值）✅、`saveCompaction` 改成显式三参且**函数体内零 state 读取**✅、依赖清空✅、定时器回调读 ref✅、开关那一路改显式传参✅、上方写了「禁止读 state」的注释✅。四条验收用例（T-CMPD-1…4）实测全绿。
   - §2 §6#5：`setError(result.error.message)` 逐字取 spec 默认案（步骤 1，非步骤 2 的 `?.` 兜底）✅；未改 error 的 state 类型、未加 ErrorBoundary、未改渲染结构 ✅。`T-CSErr-1` 实测绿。
   - §3 AM-1：三处 `forgetSession` 补调位置与 spec 完全一致（单删在 delete 成功后、批删**逐个**补、项目删在 delete 成功后遍历）✅；`createLruMap` 独立于 `createScopeKeyCache`、未造死成员 ✅；上限 500 与 `chat-session-view-cache` 同口径 ✅；`units` / `writethroughs` / `listeners` 未动 ✅；新增 test-only `*Size()` 探针 ✅。项目删除前的 `listByProject` 与 TODO 齐备 ✅。
   - §4 N-P1-03：新模块逐字照 `prompt-editor-callback` 形状（`set` 覆盖写 / `take` 读取并清空）✅；`types.ts` 的 `onSessionVfsSaved` 两行删除✅；`FileEditorScreen` 用 **`useRef` 惰性初始化**（不是渲染期裸调）✅；3 处 session 调用点接线齐（`useChatTabScope` 1 处 + `SubagentSessionScreen` 2 处写 no-op）✅；非 session 的 4 处按 spec「不接线」✅；编译期守卫落在 `src/navigation/param-serializability.ts`（已核实被 `tsconfig.build.json` 的 `include: ["src/**/*"]` 覆盖，`AssertNoFn` 对对象类型恒为 `true` ⇒ 真的会长牙）✅。
   - §7 AM-3：类型改可选 + 屏内回落✅、两处入口接线✅、**没有**顺手改 `RootNavigator` / `header-config` / `prompt-preview.service` ✅。
   - §8 S-D-04：dirty effect 落在**三个早返回之前**（`:444-467`，早返回在 `:469` 起）✅、effect 内自算 `dirty` 而非引用 `:722` 那个✅、add/else-delete/cleanup 三段齐✅。`App.tsx` 收归 `requestClose` 且**打开路径不过守卫** ✅。
   - §9 E：`loadAllSavedModels` 返回 `{models, failedProviderIds}`、失败不吞✅；三分支取代二分支✅；**没有给 `applyDefinition` 加第三个位置参数**（既有静态守卫 `applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null)` 未被打破，实测仍绿）✅；保存保留原值✅；`settings-hint--compact` 提示✅。唯一偏离见 P1-1。

---

## 3 · Open questions / 待拍板

1. **P1-1 的口径**：`unresolvedModelId` 该在「用户改选了别的模型」时清掉，还是保留只用于文案？清掉 = 一行修好、但用户看不到「原来绑的是什么」；保留 = 需要把「原值」与「当前是否保留」拆成两个 state。要拍的是产品口径：模型下拉是「当前生效绑定」还是「编辑缓冲」。
2. **`build.gradle` 的 20 处 mojibake**（P2-7）是否纳入 A7b 收尾范围？它是 gradle 注释、不影响构建，但落在 `apps/` 扫描面内。
3. **`onClose` 是否值得 `useCallback` 化**（P2-8）？纯稳定性收益、无功能收益，属「要不要现在做」的取舍。
4. **`loadIdleOlderMessages` 的 LRU 窗口**（P2-1）：选「null 时兜底重载」还是「把 in-flight 标记挪出 LRU 表」？前者改动小但多一条重载路径，后者更干净但要动 `IdleMessageView` 的存储形态。

---

## 4 · 已豁免（用户确认不修）

（无）

---

## 5 · 合并后 QA（manual_user）

- **P1-1 复现路径**：桌面设置 → 智能体 → 选一个模型已从库里删掉（或临时把某服务商的模型列表 mock 成加载失败）的智能体 → 确认下拉显示 ⚠ 项且有提示 → **在 ⚠ 态下从下拉里选一个当前有效的模型** → 看下拉是否仍停在 ⚠ 项、提示是否还在 → 改 maxSteps 保存 → 回智能体列表确认绑定到底写成了哪个。修复后应变为：下拉显示新模型、提示消失。
- **P2-1 复现路径**：造 >500 个会话（或临时把 `SESSION_STREAM_MAX_MESSAGE_VIEWS` 调小到 5），在一个 idle 会话里点「上翻更早消息」，同时让另一个路径灌满 LRU，看这一页是否永久加载不出来。
- mobile 真机项（Gradle 出包 / `adb install -r -d` / 覆盖安装不卸载）本轮**未跑**；按仓库硬规则需 Metro dev server + 真机在场确认，属 manual_user 项。
- AM-3 的原始触发链（后台通知栈外改 scope → 栈顶仍是旧详情页）需要真机推送/通知时序，自动化测试只能覆盖参数接线那一层，端到端仍需人工。

---

## 6 · K 节建议（下游执行时闭合）

1. 把「`docs/apm/RULE.md` 登记 manager 会话↔项目归属缺口」写成 AM-1 的**收口判据**（而不是修法正文里的一句附带要求），并在 cr-fix-spec 的 Must-fix 里挂一条可勾选项，避免「代码改了、登记忘了」。
2. 全仓 spec 里的**基线绝对数字**（renderer 411 / mobile 1739 / desktop 红条目计数）统一改成两种之一：引用 `baseline.md` 的当期值，或写成相对表述（本 commit 的 §2「恰好 −1」是唯一写得对的形态）。两次 CR 之间 Wave D 已经把 411 打到 371，说明绝对数字的半衰期比一轮 CR 还短。
3. spec §3 步骤 5 那句「映射 1:1 无缺口 ⇒ LRU 不影响任何既有逻辑」应补一条核对项：**逐个 `set` 点检查它与上一次 `get` 之间是否隔着 `await`**。本 commit 的 LRU 本身没错，是这条核对项缺了才让 P2-1 溜过去；同类核对（"新引入的有界容器会不会打断既有的跨 await 读改写"）值得进 RULE。
4. spec §9 验收清单建议补第七条：「unresolved 态下改选一个有效模型 ⇒ 下拉显示新模型、提示消失、保存载荷为新模型」。这条既是 P1-1 的回归锁，也提醒后续 spec：**给 UI 加了「哨兵置顶项 + 优先级 value」这种组合时，验收必须覆盖「用户从哨兵项移到正常项」这个方向**。
