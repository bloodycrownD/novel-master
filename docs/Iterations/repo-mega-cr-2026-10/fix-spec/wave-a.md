# wave-a · 零风险止血（分片 fix-spec）

> 基线：`feat/repo-mega-cr` HEAD=`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`）。
> 本分片负责 SPEC.md §2 分配表中的 `wave-a.md` 一栏：
> **RT-02、N-P0-01、N-P0-02、N-P0-03、CI typecheck 转 blocking、A-14、编码还原批次 1**（共 7 条）。
> 七要素按 `../PLAN.md` 第四章第 8 条。**全部证据均在本分片撰写时重新打开 `fe79b781` 代码逐行核对**
> （行号凡与台账 `ledger-v2.md` 不一致者，正文以实测为准，并在 §8「口径修正」留痕）。

---

## 0 · 本分片的度量基线（本机位实跑，2026-10-01）

RULE「条数 / 行号 / 计数类结论一律实测复核」——下表全部由本分片机位在 `fe79b781` 上实跑产出，**不是照抄台账**：

| 度量 | 命令 | 实测结果 |
|---|---|---|
| 全仓 typecheck | 仓根 `npm run typecheck` | **exit 0，全绿**（16 个 workspace 依次跑完，含 mobile 的 3 段 + `e2e:tsc`） |
| mobile lint | `cd apps/mobile && npx eslint . --max-warnings 99999` | **432 problems（27 errors / 405 warnings）**；`package.json:11` 的 `--max-warnings 321` **已失效**（405 > 321，且 27 errors 本身就让退出码为 1） |
| composer-input 产物 | `node -e` 扫 `apps/mobile/webview-dist/composer-input/app.js` | 21,826 字节；`Object.fromEntries` 首个命中 **index=4907**；`replaceAll` / `Object.hasOwn` / `.at(` 均 **-1**（未命中）；`mountComposerEditor` 在 18778 |
| 编码损坏 | 字节级扫 `git ls-files` 全仓（严格 UTF-8 解码 + `EF BF BD` 计数） | **11 个文件**，分两类（明细见 A7.1） |
| core typecheck | `cd packages/core && npm run typecheck` | 全绿（含在上面的全仓运行里） |

> 本分片**未**实跑三包 `npm test`（`ledger-v2.md:509` 记的硬门槛仍未解除）。测试条数与已知红基线以
> `baseline.md`（s-baseline 机位）为唯一权威口径，本分片只写「必须与 baseline 一致」，不预写数字。

---

## A1 · RT-02 —— runner 每 step 两次独立全会话读

- **严重度 / 簇**：**P0**（台账 §1 终表）· core-runtime
- **簇位置**：`packages/core/src/service/agent/` + `packages/core/src/domain/compaction-conditions/`

### A1.1 证据

**(a) 第一次读 —— `packages/core/src/service/agent/impl/agent-runner.ts:411-413`**（逐行核对，行号与台账一致）：

```ts
        let stepCompactionEmitted = false;

        let visible = await session.list();
```

**(b) 第二次读 —— `agent-runner.ts:517-535`**，压缩评估把 `AgentSession` 整个传进去：

```ts
        if (persistMessages && this.deps.compactionConditions != null) {
          const shouldCompact =
            await this.deps.compactionConditions.shouldRequestCompaction(
              this.deps.session,
```

**(c) 第二次读的落点 —— `packages/core/src/domain/compaction-conditions/triggers/visible-floor.trigger.ts:17-23`**：

```ts
  async shouldTrigger(
    session: AgentSession,
    _evaluation: CompactionEvaluationContext
  ): Promise<boolean> {
    const visible = await session.list();
    return visible.length > this.visibleFloor;
```

链条完整闭合：`agent-runner.ts:519` → `create-compaction-condition-evaluator.ts:83-92`
（`triggersFromConditions` 装出 `VisibleFloorTrigger`，再 `trigger.shouldTrigger(session, evaluation)`）
→ `composite-trigger.ts:23-25` 逐个转发 → `visible-floor.trigger.ts:21` 再发一次 `session.list()`。

两次读互不共享结果。而 `session.list()` 走 `chat-agent-session.ts:31-39` 的
`listBySession(id, { includeHidden: false })`，即**可见集 21 列全量读**（`sqlite-message.repository.ts:28`
的 `MESSAGE_SELECT_COLUMNS`），单次成本已因 v1.5.29 降过，**但读次数没降**。

**语义等价性论证（本条能零风险修的前提）**：`:413` 与 `:519` 之间夹着
`assembleWorkplaceDisplay`（只写 `file_cache` / `rule_snapshot` 两个 KKV 域）
与 `prepareUserMessagesForPrompt`（**不向 `chat_message` 追加任何消息**，仅写 `file_cache` KKV
—— `prepare-user-messages-for-prompt.ts:209` 的 `loadOrFillFileCache` 是唯一的写动作，
所以它**不是纯函数**，但也不碰消息表）与 `buildPromptLlmInputFromLayout`（纯函数），
**没有任何一步向 `chat_message` 追加消息**。因此第二次 `session.list()` 的长度与第一次恒等，
把长度透传下去是**严格等价变换**。

⚠️ **一个必须注意的陷阱**：`agent-runner.ts:449` 是 `visible = await prepareUserMessagesForPrompt(visible, …)`，
`visible` 在这里被**换成 prepare 的产物**。所以条数必须在 `:413` 之后、`:449` 之前取，不能在 `:519` 附近取。

### A1.2 修法（文件·函数级步骤）

**Step 1 — `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts`**
在 `CompactionEvaluationContext`（`:21-41`）末尾新增一个**可选**字段：

```ts
  /**
   * runner 本 step 已从 `AgentSession.list()` 拿到的可见消息条数。
   *
   * 有了它 {@link VisibleFloorTrigger} 直接复用，不再发第二次全会话读（RT-02）；
   * 缺省（非 runner 调用方 / 既有测试）回落到触发器自己 `session.list()`，
   * 因此这条对所有既有调用方与测试**零行为变化**。
   */
  readonly visibleMessageCount?: number;
```

**Step 2 — `visible-floor.trigger.ts:17-23` 改用透传值**：

```ts
  async shouldTrigger(
    session: AgentSession,
    evaluation: CompactionEvaluationContext
  ): Promise<boolean> {
    const visibleCount =
      evaluation.visibleMessageCount ?? (await session.list()).length;
    return visibleCount > this.visibleFloor;
  }
```

（`CompositeConditionTrigger` 与 `TokenRatioConditionTrigger` **一行不动** —— 前者原样转发两个入参，
后者本来就 `_session` 不用。端口签名 `shouldTrigger(session, evaluation)` 保持不变，不新增接口。）

**Step 3 — `agent-runner.ts:413` 之后立刻取条数**（**必须在 `:449` 之前**）：

```ts
        let visible = await session.list();
        // 压缩评估要的只是「可见条数」；VisibleFloorTrigger 自己再 list() 一次
        // 就是每 step 的第二次全会话读。条数在此处定死并透传，触发器零读取（RT-02）。
        // 必须在下方 prepare 覆盖 visible 之前取：那份数组已不是 message 列表。
        const visibleMessageCount = visible.length;
```

**Step 4 — `agent-runner.ts:519-534` 的 evaluation 对象加一行** `visibleMessageCount,`。

**明确不做**：不给 `AgentSession` 加接口、不加进程内 memo、不碰 `chat-agent-session.ts`。
memo / 窄读口是 **RT-01** 的活，归 `wave-b-core1.md`，且它以本条落地后的读数为基线（见 §9 分片级注记）。

### A1.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 语义等价：visibleFloor 触发判定不变
#    packages/core/test/compaction-conditions/ 实有 4 个文件，逐个点名、必须全绿：
#      run-compaction.test.ts
#      compaction-conditions-store.service.test.ts
#      compaction-conditions-v3-migration.test.ts
#      token-ratio-trigger.test.ts   ← 直接构造 CompactionEvaluationContext 字面量并调
#                                      shouldTrigger，是端口改动的最直接观测面
#    它们都走「缺省 ⇒ 自己 list()」的回落分支。
cd packages/core
npm run test:fast -- test/compaction-conditions/
# ② 读次数减半（有牙齿的断言，见 A1.4）
npm run test:fast -- test/agent/agent-runner-compaction.test.ts
npm run test:fast -- test/agent/agent-runner-token-cache.test.ts
# 期望：0 fail，且新用例断言每 step 的 session.list() 调用次数 = step 数（不是 2×step 数）

# ③ 四域 typecheck 仍绿
npm run typecheck          # 仓根，期望 exit 0
```

**可测断言（必须写进测试，不靠人眼）**：装配一个 `visibleFloor` 已配置的假 runner，
用一个计数的 `AgentSession.list` 替身跑一个 ≥3 step 的 run，断言 `listCalls === 3`；
把 Step 1 的透传删掉（即故意回到旧形态）时该断言必须变 `6` 并红 —— 这是牙齿。

**⚠️ 牙齿成立的硬约束（装配要求，缺一条断言即恒绿）**：

1. **必须装配真实的 `VisibleFloorTrigger`**，即经
   `createCompactionConditionEvaluator({conditionsStore: {getConditions: async () => ({enabled: true, visibleFloor: N, hideStartDepth: 6})}, …})`
   （**只配 `visibleFloor`** 时 `tokenCounters` / `providerModels` 不会被触碰，
   `create-compaction-condition-evaluator.ts:52-69` 的 `triggersFromConditions` 可证），
   或直接 `new VisibleFloorTrigger(N)` 包一层。
   **不得沿用** `agent-runner-compaction.test.ts:139-149` 现成的
   `createCompactionConditionsStub` —— 它的 `shouldRequestCompaction` 是纯 stub，
   **从不调 `session.list()`**，第 2 次读根本不存在 ⇒ `listCalls` 恒等于 `stepCount`，
   透传删不删都绿，RULE 牙齿判据①（恒真断言）失效。
2. **计数替身注入 `deps.session`**（这条可行）：`agent-runner.ts:236-238` 实测
   `persistMessages === true` 时传给触发器的 `session` **就是** `this.deps.session` 本身、
   不是包装对象 ⇒ 同一个计数器同时覆盖 `:413` 的那次读与 `:520` 传给触发器的那次读。
3. **把「计数」与「触发语义」拆成两条用例**（见 A1.4），不要塞进同一条 run。

### A1.4 测试策略

- **改动既有文件**：`packages/core/test/agent/agent-runner-compaction.test.ts`
  —— 装配要求见 A1.3 的三条硬约束（**真实 `VisibleFloorTrigger` + 计数替身注入 `deps.session`**），
  并新增**两条**用例：
  - `T-RT02-a（计数）：visibleFloor 配置下每个 step 只发一次全会话读`
    —— 用 `visibleFloor: 999`（**刻意不触发压缩**，免得 `runCompaction` 桩改变步数、
    干扰 `stepCompactionEmitted` 的门控语义），断言 `listCalls === stepCount`；
    把 Step 1 的透传删掉时该断言必须翻倍并红 —— **这是牙齿**。
  - `T-RT02-b（语义）：visibleMessageCount 透传后压缩仍按 visibleFloor 命中`
    —— 用 `visibleFloor: 0`，断言压缩仍然触发、且步数与 `stepCompactionEmitted` 口径不变
    （防止「少读一次」被误实现成「不读」）。
- **不改**：`packages/core/test/compaction-conditions/*`（回落分支必须仍绿，它们是本条的兜底证明）。
- **牙齿三判据自检**：① 有牙吗——去掉 `visibleMessageCount` 透传 ⇒ 计数翻倍 ⇒ 红。成立
  （**前提是按 A1.3 装真实触发器**；沿用 `createCompactionConditionsStub` 则恒绿 = 判据①失效）。
  ② 恒红吗——计数器装在测试自己的假 `AgentSession`（经 `deps.session` 注入）上，不依赖进程级标记。成立。
  ③ 一夹具两期望吗——否（计数与触发语义已按 A1.3 拆成两条独立用例，不再共用同一条 run）。

### A1.5 回归线（必须保持绿）

- `packages/core/test/agent/agent-runner-compaction.test.ts`
- `packages/core/test/agent/agent-runner-abort-rollback.test.ts`
- `packages/core/test/agent/agent-runner-token-cache.test.ts`
- `packages/core/test/compaction-conditions/run-compaction.test.ts`
- `packages/core/test/compaction-conditions/compaction-conditions-store.service.test.ts`
- `packages/core/test/compaction-conditions/compaction-conditions-v3-migration.test.ts`
- `packages/core/test/compaction-conditions/token-ratio-trigger.test.ts`
  （**本目录实有 4 个文件**；该文件直接构造 `CompactionEvaluationContext` 字面量并调 `shouldTrigger`，
  是端口新增可选字段的最直接观测面）
- `packages/core/test/chat/message-visible-floor.test.ts`
- 仓根 `npm run typecheck`

### A1.6 依赖

- **前置**：无。可独立先落，且**应当先落** —— `ledger-v2.md:463` 记的 Wave C 依赖图里
  「RT-02 必须先落」是 RT-01 收窄的读数基线前提。
- **拍板项**：无。
- **与 RT-01 的关系**：RT-01 已由 `ledger-v2.md:549` 终局裁决为 **P1、排进 Wave B**（归 `wave-b-core1.md`）。
  本条落地后，RT-01 的 memo / 窄读口改造要拿「每 step 一次读」作基线；
  **RT-01 若先落且加了 memo，本条会与之语义重叠** ⇒ 两者**必须有序（RT-02 先）或同 PR**。

### A1.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 条数取在 `:449` 之后（`visible` 已被 prepare 覆盖）⇒ 语义漂移 | **中**（最容易犯的错） | 压缩触发点偏移，可能提前/永不压缩 | 修法里已用注释 + 「Step 3 必须在 `:449` 之前」写死；测试同时断言「读次数减半」与「触发语义不变」，两者任一错都会红 |
| 某些调用方已经在 `evaluation` 里带了同名/同义字段 | 低 | 编译红 | Step 1 前后各跑一次 `npm run typecheck`；字段名带 `visibleMessageCount` 前缀，仓内零同名 |
| 回滚 | — | — | 4 个文件的纯增量改动，`git revert` 即回；回滚后每 step 恢复两次读 |

---

## A2 · N-P0-01 —— composer-input WebView bundle 顶层 `Object.fromEntries` 崩旧机

- **严重度 / 簇**：**P0**（台账 §1 终表）· apps-mobile（构建链）
- **注**：本条是台账 Wave A 表**漏了修复格**、由 `fix-spec/SPEC.md:18` 补入 Wave A 的条目。

### A2.1 证据

**(a) 病灶在产物上 —— `apps/mobile/webview-dist/composer-input/app.js`**（本分片实跑复核，index 与台账一致）：

```js
  var BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(BUILTIN_PROVIDER_ROWS.flatMap((row) => row.defaultApiKey != null ? [[row.key, row.defaultApiKey]] : []));
  var BUILTIN_PROVIDER_PROTOCOLS = Object.fromEntries(BUILTIN_PROVIDER_ROWS.map((row) => [row.key, row.protocol]));
```

首个命中 **index=4907**。bundle 是 IIFE，这几行在**模块求值期**执行；
而文件末尾才是：

```js
  var root = document.getElementById("root");
  if (root != null) {
    mountComposerEditor(root);
  }
  bindHostMessageChannel(handleHostMessage);
  post2("ready", { version: BRIDGE_V });
```

`mountComposerEditor` 在 18778 —— **顶层抛异常 ⇒ 编辑器不挂载、`ready` 不上报、宿主握手永不完成**
（chat 内联输入框白屏级无响应，不是降级）。

**(b) 成因链（源码侧，逐跳核对）**：

1. `apps/mobile/src/web/composer-input/webview/runtime/editor.ts:23`
   ```ts
   import {findWhitelistMacroRanges} from '@/components/agent/prompt-macro-input';
   ```
2. `apps/mobile/src/components/agent/prompt-macro-input.ts:1`
   ```ts
   import {ALLOWED_DYNAMIC_ROOT_MACROS} from '@novel-master/core/prompt';
   ```
   全文只用它做两件事：`:9-13` 的 `PROMPT_INSERTABLE_MACROS` 映射 + `:15` 的 `new Set(...)`。
3. `@novel-master/core/prompt` 映射到 `packages/core/package.json:37-40` 的
   `./dist/public/prompt.js` —— **整个 public barrel**（`render-prompt.ts` /
   `apply-thinking-context-for-llm.ts` / provider 相关表全被 esbuild 拖进 bundle）。
4. 而 `ALLOWED_DYNAMIC_ROOT_MACROS` 本体只有 3 个字符串常量
   （`packages/core/src/domain/prompt/logic/validate-dynamic-macros.ts:11-15`）：

   ```ts
   export const ALLOWED_DYNAMIC_ROOT_MACROS = [
     "time",
     "week_cn",
     "filetree",
   ] as const;
   ```

   **为了 3 个字符串，把 core 的 provider 整表拖进了一个 WebView 产物。**

**(c) 为什么 `target: ['es2018']` 没挡住**：`apps/mobile/scripts/build-webview.mjs:107-123`
的 `bundleAppJs` 确实传了 `target: ['es2018']`，但 esbuild 只转译**语法**、不注入 **polyfill**，
`Object.fromEntries` 是运行时内建、原样穿透。

**(d) 影响面**：`apps/mobile/android/build.gradle:4` `minSdkVersion = 26`（Chromium 58）；
`Object.fromEntries` 是 Chrome 73+。**WebView < 73 的机器上顶层直接 `TypeError`。**

### A2.2 修法（文件·函数级步骤）

**Step 1 — `apps/mobile/src/components/agent/prompt-macro-input.ts`：删掉 `@novel-master/core/prompt` 依赖**

把 `:1` 的 import 换成**本地内联常量**（白名单本体只有 3 项，内联零风险）：

```ts
/**
 * dynamic 区可插入的 `$` 根宏白名单。
 *
 * ⚠️ 本数组**刻意内联**，不得改回从 `@novel-master/core/prompt` 导入：
 * 本模块被 WebView 产物 `webview-dist/composer-input/app.js` 引用
 * （`src/web/composer-input/webview/runtime/editor.ts`），而 core 的 public barrel
 * 会把 provider 整表拖进 IIFE，其顶层 `Object.fromEntries` 在 minSdk 26（Chromium 58）
 * 的 WebView 上直接抛 `TypeError` ⇒ 编辑器不挂载、`ready` 不上报（N-P0-01）。
 * 与 core 单源的一致性由 `apps/mobile/__tests__/prompt-macro-input.test.ts`
 * 的等价断言兜住（RN 侧不产 WebView 产物，引用 core 免费）。
 */
const ALLOWED_DYNAMIC_ROOT_MACROS = ["time", "week_cn", "filetree"] as const;
```

`:9-13` 与 `:15` 的两处消费点**一行不改**。

**Step 2 — 不改 `packages/core` 的 exports**（重要）

台账给了「深层路径直引」这条备选，但 `packages/core/package.json` 的 `exports` 只暴露了
`./prompt` 等 **26 个**子路径（本分片实测逐个数：`.` / `common` / `agent` / `chat` / `compaction` /
`events` / `feature-flags` / `prompt` / `provider` / `smart-sort-rule` / `message-checkpoint` /
`session-fs` / `vfs` / `workplace` / `format` / `tdbc` / `sksp` / `nmtp` / `kkv` / `session-kkv` /
`session-run-state` / `skills` / `config-forms` / `config-forms/agent` / `config-forms/shared` /
`config-forms/stored-config-validity`），**无一指向 `dist/domain/**`**。要走深引就得新增一个
export 子路径，那会连带触发 `packages/core/test/package-exports/snapshots/*.json` 与
`tsconfig.test.json` paths 对齐（后者是 **wave-e** 的条目）⇒ 跨分片、且不是零风险。
**默认案 = Step 1 的内联**；深引作为备选案记在下方注记。

**Step 3 — 顺带核一遍同产物面的其它构造**

本分片实跑：`webview-dist/composer-input/app.js` 里 `replaceAll` / `Object.hasOwn` / `.at(` 均 **-1**，
即本条目修完后该产物**不含任何台账点名的 4 个 ES2019+ 构造**。

**明确不做**：**防再犯门禁不归本条**。`build-webview.mjs` 的产物扫描门禁是
**wave-e 的 X3**（`wave-e.md:401`；其门 B 白名单建议段在 `:471-481`、依赖段在 `:534-539`），
且 wave-e 已实测「4/4 包先天命中该门禁、须改成门 A/B/C 三段式」。
本条目只交**修复本体**，不碰 `build-webview.mjs`。

### A2.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 重建产物并扫描（期望：四个构造全部 -1，即零命中）
cd apps/mobile
npm run build:webview
node -e "const fs=require('fs');const c=fs.readFileSync('webview-dist/composer-input/app.js','utf8');for(const k of ['Object.fromEntries','replaceAll','Object.hasOwn','.at('])console.log(k,c.indexOf(k));"
# 期望输出：四行全是 -1

# ② 体积塌缩（本分片基线：21,826 字节）
#    期望：明显下降（provider 整表被移出产物）；把前后字节数写进 PR 描述

# ③ 等价性不被破坏
cd apps/mobile
npx jest __tests__/prompt-macro-input.test.ts __tests__/atomic-range-delete.test.ts __tests__/prompt-macro-text-input.test.tsx
# 期望：全绿

# ④ 四域 typecheck
#    仓根 npm run typecheck ⇒ exit 0
```

**注意**：本命令产出的是 gitignore 产物，`webview-dist` 不进 git（`apps/mobile/.gitignore`）。
真机验证须走 `build:webview:native` + gradle 重打（AGENTS.md 硬规则），**不是** Wave A 的验收面。

### A2.4 测试策略

- **改动既有文件**：`apps/mobile/__tests__/prompt-macro-input.test.ts`
  —— 新增用例 `白名单与 core 单源一致（防 N-P0-01 再犯）`：
  ```ts
  it('白名单与 core 单源一致（防 N-P0-01 再犯）', () => {
    expect(PROMPT_INSERTABLE_MACROS.map(m => m.token)).toEqual(
      ALLOWED_DYNAMIC_ROOT_MACROS.map(k => `{{$${k}}}`),
    );
  });
  ```
  其中 `ALLOWED_DYNAMIC_ROOT_MACROS` 从 `@novel-master/core/prompt` 导入
  （mobile jest 里**引用 core 子路径是常规做法**，例如 `__tests__/session-prompt-input.service.test.ts`
  引的是 `@novel-master/core/chat` 与 `@novel-master/core/config-forms/stored-config-validity`）。
  **这条断言就是内联换来的单源保险**：core 加宏而这里没跟 ⇒ 测试红。
  ⚠️ 两处口径澄清，别在实现时写错：
  - mobile 全仓对 `core/prompt` **没有未 mock 的真实导入先例**——只有两处 `jest.mock`
    （`chat-prompt-tokens.test.ts:59`、`compaction-warm-orchestration.test.ts:51`），
    所以拿「别人已经这么引了」当理由是不成立的。
  - `@novel-master/core/prompt` 经 `apps/mobile/jest.config.js:210-213` 映射到
    `packages/core/dist/public/prompt.js` ⇒ **依赖 core 的 dist 已构建**（RULE 已记该前置）；
    **实施时先单跑这一条新断言**，确认 barrel 没把 `yaml` 之类拉进 RN Jest
    （jest 对 `^yaml$` 已有 CJS 兜底，但仍须实跑确认）。
- **不改**：`__tests__/atomic-range-delete.test.ts`、`__tests__/prompt-macro-text-input.test.tsx`（只作回归）。
- **牙齿三判据自检**：① 有牙吗——把内联数组删掉一项 ⇒ 红。成立。
  ② 恒红吗——断言读的是 core 的真实常量，不依赖进程级标记。成立。
  ③ 一夹具两期望吗——否。

### A2.5 回归线（必须保持绿）

- `apps/mobile/__tests__/prompt-macro-input.test.ts`
- `apps/mobile/__tests__/atomic-range-delete.test.ts`
- `apps/mobile/__tests__/prompt-macro-text-input.test.tsx`
- `apps/mobile/__tests__/composer-at-path.test.tsx`（RN 侧同模块消费方）
- `apps/mobile/__tests__/session-prompt-input.service.test.ts`
- `apps/mobile` 全量 `npx jest --maxWorkers=2`（RULE：满负载下性能护栏会偶发超标，降并发跑）
- 仓根 `npm run typecheck`

### A2.6 依赖

- **前置**：无。可独立落。
- **跨分片**：**防再犯门禁归 `wave-e.md` X3**（X3 标题实测在 `wave-e.md:401`；
  其「门 B 白名单建议」段 `:471-481`、依赖段 `:534-539`）。
  本条**不写**那段门禁，但 X3 的「门 B：core 模块依赖准入白名单」**应当把
  `prompt-macro-input.ts → @novel-master/core/*` 列为已修好的样板**。
  ⚠️ **门 B 白名单的终值以本条为准**：
  - **内联案（默认，本条落地的就是它）⇒ composer-input 的门 B 白名单 = `[]`（空数组）** ——
    Step 1 落地后该包**不再有任何 core 模块**（`src/web/**` 全量 grep `@novel-master/core`
    只有 `row-logic.ts:6` 的 `@novel-master/core/chat` 一处，composer-input 侧零命中 ⇒
    它拖进 core 的唯一入口就是 `prompt-macro-input.ts:1`）。
  - **只有走备选深引案**，白名单才是单元素集 `["domain/prompt/logic/validate-dynamic-macros.js"]`。
  ⇒ wave-e 的 X3.2 请按「内联案 = 空数组」落笔，避免两片各留一个互相矛盾的终值。
- **拍板项**：无。

### A2.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 未来 core 加了第 4 个 `$` 宏而 mobile 内联没跟 ⇒ 输入框芯片少一枚 | 中 | 用户可见（小） | A2.4 的等价断言把它变成 CI 红；PR 里写明「改白名单必须同时改两处」 |
| 内联常量与 core 值**恰好一致但顺序不同** ⇒ 芯片顺序变化 | 低 | UI 微变化 | 断言用 `toEqual` 比整个数组（顺序敏感），顺序变了也会红 |
| 有人把 import 改回去「为了单源」 | 中 | **P0 完全复发** | Step 1 的文件头注记写明后果；A2.4 断言提供第二道；wave-e X3 门 B 提供第三道 |
| 回滚 | — | — | 单文件单行改动，`git checkout -- <file>` 即回；回滚后旧机白屏复发，须在 PR 写明 |

> **备选案注记（不采用，写明差异）**：若用户/主代理更看重「不复制常量」，
> 可改为新增 `packages/core` export 子路径 `./prompt-macros` 指向
> `dist/domain/prompt/logic/validate-dynamic-macros.js`，然后
> `prompt-macro-input.ts` 从 `@novel-master/core/prompt-macros` 直引。
> **代价**：新增 export 子路径要同步 `packages/core/test/package-exports/snapshots/*.json`
> （新增一份 allowlist）与 `tsconfig.test.json` 的 paths —— 后者是 **wave-e** 的
> 「`tsconfig.test.json` paths 与 `package.json` exports 对齐」条目。
> ⇒ 走这条要跨分片，且不再是「零风险止血」。**默认案仍是内联。**

---

## A3 · N-P0-02 —— desktop `run-tests.mjs` 单引号收集 0 条假绿

- **严重度 / 簇**：**P0**（台账 §1 终表）· apps-desktop（测试基础设施）
- **台账原话**：这是本波**优先级最高**的一条 —— 它挡住的是「开发者本地的全绿是假的」，
  其他所有门的可信度都挂在它下面。

### A3.1 证据

**`apps/desktop/scripts/run-tests.mjs` 全文 40 行，本分片逐行核对**（行号与台账一致）：

```js
// :22
const extraArgs = process.argv.slice(2).filter((arg) => arg.length > 0);
// :23-26  注释：「默认目标整体加引号交给 node --test 的递归 glob 展开：execSync 走 /bin/sh …」
// :27-30
const testTargets =
  extraArgs.length > 0
    ? extraArgs.join(" ")
    : "'test/**/*.test.ts' 'test/**/*.test.tsx' 'test/**/*.test.js'";
// :32-35
execSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  { cwd: desktopRoot, stdio: "inherit", env, shell: true },
);
```

三重问题（逐条在本分片确认）：

1. **`:30` 三个 glob 用单引号包裹**，`:34` 的 `shell: true` 在 Windows 上走 `cmd.exe`，
   而 **cmd.exe 不把单引号当引号** ⇒ `node --test` 收到含**字面单引号**的 pattern
   ⇒ 匹配 0 个文件。
2. `execSync` 只看子进程退出码。`node --test` 跑 0 条用例时输出 `1..0` / `# tests 0`，
   **退出码是 0** ⇒ 脚本 `exit 0` ⇒ **假绿**。
3. `:23-24` 的注释「execSync 走 `/bin/sh`（无 globstar）」**只在 Linux 成立**；
   CI 跑的是 `ubuntu-latest` ⇒ 线上绿，本地 Windows 静默空跑。

**旁证（测试侧自己知道这件事）**：`RULE.md:111` 已把这条记成「Windows 下跑本仓测试的两个假信号」之首。

### A3.2 修法（文件·函数级步骤）

**Step 1 — `:30` 单引号改双引号**（node 侧仍递归展开，语义不变；双引号在 `/bin/sh` 与 `cmd.exe` 下都是引号）：

```js
    : '"test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"';
```

**Step 2 — 零收集守卫（收集数为 0 ⇒ `process.exit(1)`）**

`stdio: "inherit"` 时拿不到输出，守卫无从下手；把 stdout 改成 `pipe`、跑完再转发：

```js
// stdio: ["inherit", "pipe", "inherit"] —— stderr 继续直通（tsc/tsx 的报错实时可见），
// stdout 收进内存是为了读 tap 汇总行（node --test 在非 TTY 下用 tap reporter）。
// ⚠️ maxBuffer 必须显式放大：spawnSync 的默认上限是 1 MiB，stdout 一旦超出就会
//    **静默截断**并返回 status=null —— 被截掉的正是末尾那段 `# tests N`，
//    守卫于是把「跑过了」误判成「收集 0 条」，报出一句完全误导的错误信息。
//    （实测当前 628 条用例的 stdout = 204,614 字节，距 1 MiB 还有 5× 余量；
//      写大不是嫌小，是不给套件增长留悬崖。）
const result = spawnSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  {
    cwd: desktopRoot,
    stdio: ["inherit", "pipe", "inherit"],
    env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);
process.stdout.write(result.stdout ?? "");
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
// 零收集守卫：node --test 收集 0 条时退出码是 0（N-P0-02 的假绿）。
// 这里显式解析 `# tests N`，N 为 0 或缺失即视为「什么都没跑」⇒ 失败。
const collected = /^# tests (\d+)$/m.exec(result.stdout ?? "")?.[1];
if (collected === undefined || Number(collected) === 0) {
  console.error(
    `[run-tests] 收集到 0 条用例（# tests 行缺失或为 0）。` +
    `当前 shell=${process.platform}；testTargets=${testTargets}。` +
    `spawnSync error=${result.error?.code ?? "none"}。` +
    `这是 N-P0-02 的假绿形态 —— 请检查 glob 与 shell 引号语义。`,
  );
  process.exit(1);
}
```

（`execSync` 相应换成 `spawnSync`，`import { execSync }` 改成 `import { spawnSync }`。）

**Step 3 — `:23-26` 注释中性化**（平台假设不得写成事实，这是 RULE 的口径）：

```js
// 默认目标整体加双引号交给 node --test 的递归 glob 展开：引号阻止 shell 自己展开
// （Linux 与 Windows 的 shell 引号语义不同，单引号只在 Linux 生效），
// 由 node 侧 `**` 递归匹配顶层与任意深度子目录，三个模式按扩展名互不重叠、无重复。
```

**Step 4（可选，不在默认范围）** `--test-concurrency=2`。
RULE 记 desktop 满负载下 `blob-binary-normalization-service.test.ts` 的 `cr-05` 会偶发超时，
降并发即全绿。但它改变默认并行度、且真值取决于机器负载 ⇒ **交由 `baseline.md` 定夺，本条默认不改**。

**明确不做**：**不做「Node 侧自己递归收集文件、绕开 glob」的重构**。
那是 wave-e H6 的通用化方案（`wave-e.md:1242-1290`），它要连带解决命令行长度与
`packages/core` 的 `bash -O globstar` 脚本，跨包跨分片。本条只止血 desktop 一处。

### A3.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 真跑（期望：# tests N 中 N > 0，且与 baseline.md 的 desktop 条数一致）
cd apps\desktop
npm test
# 反面：修好前 Windows 上这一条输出是 "# tests 0"

# ② 零收集守卫的牙齿（必须做，否则守卫是废的）
#    临时把 testTargets 改回单引号（或把目录改成 ./nonexistent）
#    ⇒ 期望：进程 exit 1，并打印「收集到 0 条用例」+ 当前 shell 名

# ③ 退出码透传
#    故意让某条断言失败 ⇒ 期望 npm test 的退出码非 0（不被守卫吞掉）

# ④ 显式传参路径不被守卫误伤
cd apps\desktop
npm test -- test/vfs-delete-handler.test.ts
# 期望：收集 1 个文件、跑完 exit 0
```

### A3.4 测试策略

- **不新增单测**。守卫的测试就是 §A3.3 的「② 故意破坏」+ 「③ 退出码透传」。
  给守卫写单测会踩 RULE 判据②的原型事故（进程级模块标记被首条用例消费）。
- **改动既有文件**：无测试文件改动；只改 `apps/desktop/scripts/run-tests.mjs` 一个文件。
- **牙齿三判据自检**：① 有牙吗——单引号 ⇒ `# tests 0` ⇒ exit 1。成立。
  ② 恒红吗——真实仓库收集数恒 > 0。成立。③ 一夹具两期望吗——否。

### A3.5 回归线（必须保持绿）

- `apps/desktop` 全量 `npm test`（**注意：这正是被本条修好的命令**；修好前 Windows 上是 0 条假绿）
  —— **628 tests / 627 pass / 1 fail 为已知红基线**（`cr-05` 满负载 flake，隔离复跑 4/4 绿，
  见 baseline §3.2(c) / F4）⇒ 判据是「**红条目数与位置不得增加**」，不是「全量零红」。
  照字面要求「保持全绿」会让人误以为本条引入了回归。
- `packages/core` 全量 `npm test`（不受本条影响，但同在 CI `Test` 步）
  —— 3126 tests / 3 fail，按 baseline §4 的「红条目数与位置不得增加」口径。
- `apps/mobile` 全量 `npx jest --maxWorkers=2`
  —— 1739 tests / 1 fail，同上按 baseline §4 的「不得增加」口径。
- 仓根 `npm run typecheck`

### A3.6 依赖

- **前置**：无。
- **跨分片**：**通用化（任意 `node --test` 包装脚本都要有零收集守卫）归 wave-e H6**
  （`wave-e.md:1198`）。`wave-e.md:1326-1328` 已写明「H6 不应等待 Wave A，两条可并行；
  若 Wave A 先落，H6 的 Step 2 只需加守卫、不用改引号」⇒ **本条先落对 wave-e 是净收益**。
- **与 A5 同 PR**（两条都动 CI 语义）。
- **拍板项**：无。

### A3.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| stdout 改 `pipe` 后输出不再实时刷屏（长套件体感变差） | 中 | 开发体验 | 跑完一次性 `process.stdout.write` 转发；条数不大（百级），内存可忽略 |
| `encoding: "utf8"` + `shell: true` 在 Windows 下 stdout 里混入 cmd 的 banner | 低 | 正则仍能匹配 `# tests N` | 正则用 `^# tests (\d+)$` 的多行模式；若 banner 污染行首，`^` 换成 `^\s*# tests` |
| 守卫在「显式传了一个不存在路径」时 exit 1，与用户「我就是想跑 0 条」的心智不符 | 低 | 体验 | 错误信息已明写「这是 N-P0-02 的假绿形态 —— 请检查 glob 与 shell 引号语义」，指向明确 |
| **stdout 超 `maxBuffer` ⇒ `status=null` + 静默截断，守卫把「跑过了」误判成零收集** | 低（实测当前 204,614 字节 / 余量 5×，但套件在长） | **高**：报出一句与真实原因无关的错误信息，把人引向引号排查 | Step 2 已显式设 `maxBuffer: 64 * 1024 * 1024`（默认 1 MiB 会静默截断）；错误信息里额外带 `result.error?.code`，让 `ENOBUFS` 这类信号直接可读 |
| 回滚 | — | — | 单文件改动，`git checkout -- apps/desktop/scripts/run-tests.mjs`；回滚后 Windows 假绿复发，**须在 PR 写明** |

---

## A4 · N-P0-03 —— CLI 开不了第一个会话 + `[nm-boot]` 污染 stdout

- **严重度 / 簇**：**P0**（台账 §1 终表）· apps-cli / core
- **性质**：台账的 P0-03 是「26/102 条 CLI 测试永久红灯」的**症状**；
  本条目只修其中**两条已实锤的独立根因**（`ledger-v2.md:514` 明记「只归因了 2 条根因，其余 24 条未逐条归因」）。
  **「26 条红灯逐条归因」是这两条落地之后的后续工作，不在本条目范围。**

### A4.1 证据

#### 缺陷① —— 全新库上 `nm session create` 必然失败（CLI 无任何创建 agent 的入口）

**根因链逐跳核对（本分片亲自打开 `fe79b781` 的现行代码）**：

**(i) CLI 侧调用点** —— `apps/cli/src/session/commands.ts:63-72`：

```ts
    case "create": {
      const projectId = await deps.scope.resolveProjectId(flags);
      …
      const s = await deps.sessions.create(projectId, title);
```

**(ii) core 侧失败点** —— `packages/core/src/service/chat/impl/session.service.ts:106-118`（台账写 `:105-113`，实测下移 1 行）：

```ts
    const agentId = await resolveWorkspaceAgentForNewSession({
      state: this.deps.state,
      agentRegistry: this.deps.agentRegistry,
    });
    if (agentId == null || agentId === "") {
      throw chatInvalidArgument(
        "新建会话失败：workspace 未配置 Agent，且 registry 为空"
      );
```

**(iii) 取 agentId 的逻辑** —— `packages/core/src/service/agent/logic/agent-run-shared.ts:64-71`：

```ts
  const fromState = await deps.state.getCurrentAgentId();
  if (fromState != null && fromState !== "") {
    return fromState;
  }
  const ids = await deps.agentRegistry.listAgentIds();
  return ids[0];
```

**(iv) 致命的一步** —— `packages/core/src/service/agent/impl/agent-registry.service.ts:64-66` vs `:68-76`：

```ts
  async listAgentIds(): Promise<readonly string[]> {
    return this.deps.repository.listIds();          // 只读 DB，不含虚拟 general
  }
  async list(): Promise<readonly AgentDefinition[]> {
    const dbDefs = await this.deps.repository.list();
    …
    return [...dbDefs, DEFAULT_SUBAGENT_DEFINITION]; // ← 虚拟 general 在这里
```

**(v) 为什么不能用「让 `listAgentIds()` 对齐 `list()`」这条备选** ——
`packages/core/src/service/agent/agent-registry.port.ts:13-19` 的注释已经把这个堵死了：

```
   * `list()`：…（含虚拟 seed `general`，DB 同名优先）。`task` 工具按 name 查询用；
   * 与 `get` 不同——`get(id)` 入参是 UUID，**虚拟 general 没有 id**，因此 `get` 不合并虚拟
```

`DEFAULT_SUBAGENT_DEFINITION`（`packages/core/src/service/agent/default-subagent-definition.ts:19-32`）
确实**没有 `id` 字段** ⇒ **`listAgentIds()` 没有任何合法的方式把 general 纳进来**。
⇒ 台账给的两条修法里，**只有「给 CLI 加创建入口」这条成立**。

**(vi) 缺口确实存在** —— CLI 的 agent 子命令（本分片逐个 `grep` 出来的完整清单）：

- `apps/cli/src/agent/registry-commands.ts:43,54,63,76,85,107` → `list` / `show` / `import` / `export` / `migrate` / `delete`
- `apps/cli/src/agent/commands.ts:114-121` 只把这 6 个转发给 `runAgentRegistryCommand`
- **无 `create`、无 `upsert`**

**(vii) bootstrap 也不种 agent** —— `packages/core/src/bootstrap/` 下的 seed 只有
`seed-builtin-providers.ts` / `seed-builtin-skills.ts` / `builtin-smart-sort-rules.ts`，
**没有 agent 种子** ⇒ 全新库 registry 必空 ⇒ `nm session create` 必失败。

#### 缺陷② —— `[nm-boot]` 迁移日志打到 stdout，破坏「stdout 只输出机器可读值」契约

**三个打印点（`git grep -rn "nm-boot" -- packages/core/src` 全量，本分片逐个打开确认）**：

1. `packages/core/src/bootstrap/schema-migrations/index.ts:67`
   ```ts
       console.log(`[nm-boot] migration run: ${migration.id}`);
   ```
2. 同文件 `:71`
   ```ts
       console.log(`[nm-boot] migration applied: ${migration.id}`);
   ```
3. `packages/core/src/bootstrap/schema-migrations/retire-pref-session-fs-version-check-v1.ts:40-43`
   ```ts
       console.log(
         `[nm-boot] ${RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID}: 清理死键 ${PREFERENCES_MODULE}/${RETIRED_PREF_KEY}（${deleted} 行）`
       );
   ```

**危害已被仓库自己承认**：`apps/cli/test/helpers.ts:39-46` 专门写了一个过滤器
「去掉 bootstrap 打到 stdout/stderr 的 `[nm-boot] …` 行」，`parseProviderList`（`:107`）
与 `parseSavedModelList`（`:142`）也各自带 `!line.startsWith("[nm-boot]")` 过滤。
**stdout 契约一旦被破，CLI 脚本化调用方只能靠正则剥垃圾。**

### A4.2 修法（文件·函数级步骤）

#### 缺陷① 的修法：给 CLI 加 `nm agent create`

**Step 1 — `apps/cli/src/agent/registry-commands.ts` 新增 `case "create"`**（插在 `:42` 的 switch 首位）：

```ts
    case "create": {
      // 全新机器上开第一个会话的必要入口：registry 空 ⇒ session create 直接失败
      // （resolveWorkspaceAgentForNewSession 回落到 listAgentIds()[0]，而
      //  虚拟 general 没有 id、不可能出现在 listAgentIds 里）⇒ N-P0-03。
      const name = flagString(flags, "name") ?? args[0];
      if (name == null || name.trim() === "") {
        throw new Error("Usage: nm agent create --name <name> [--system <prompt>]");
      }
      const system = flagString(flags, "system") ?? "你是一个写作助手。";
      const agentId = randomUUID();
      await registry.upsert(
        agentId,
        {
          name: name.trim(),
          description: flagString(flags, "description") ?? "",
          prompts: { system, persist: [], dynamic: [] },
        } satisfies AgentDefinition,
        createRegistryValidateOptions(rt),
      );
      // 顺带把 workspace 当前 agent 指过去：session create 优先读 state，
      // 这样即使 registry 里有别的 agent，用户新建的会话也用自己刚建的。
      await rt.state.setCurrentAgentId(agentId);
      console.log(agentId); // 与 `nm session create` 同口径：stdout 只出 id
      return;
    }
```

配套：`import { randomUUID } from "node:crypto"`、
`import type { AgentDefinition } from "@novel-master/core/agent"`；
**`default:` 分支的 usage 串**（`:117-119`）加上 `create`。

**Step 2 — `apps/cli/src/agent/commands.ts:113-121` 的转发 case 列表加上 `"create"`。**

**Step 3 — 更新帮助文案**：`registry-commands.ts:46` 的 `list` 空态提示
`"No agents in registry. Run: nm agent import <path>"`
→ 追加一句 `"or: nm agent create --name <name>"`。
（这是用户撞上这个 P0 时**唯一**看到的文案，是修法的一部分，不是装饰。）

**Step 4 — 确认 upsert 校验不会把新命令卡住**：`createRegistryValidateOptions`（`:124-133`）
只校验 saved model 与已注册工具名；新定义不带 `model`、无 tools 限制 ⇒ 不触发。

> **不采用**「seed 一个默认 agent 进 bootstrap」。那会改变**所有**新建库的行为（桌面/移动端也会多一个 agent），
> 属产品面变更，不在 Wave A 的零风险范围内。

#### 缺陷② 的修法：`[nm-boot]` 三处改 stderr

**Step 5 — `schema-migrations/index.ts:67` 与 `:71`**：`console.log` → `console.error`。

**Step 6 — `retire-pref-session-fs-version-check-v1.ts:40-43`**：`console.log` → `console.error`。

**Step 7 — 不改 `stripBootLogs` / `parseProviderList` / `parseSavedModelList`**：
`stripBootLogs` 保留（stderr 上仍可能有行，
且 `provider create` 就是「打印 UUID 到 **stderr**」的老口径，见 `helpers.ts:123-134`），
只是改完之后 stdout 侧那两处 `!line.startsWith("[nm-boot]")` 过滤自然不再命中（**保留无害**，
删了反而会让「旧版本残留输出」打红测试）。
（同文件**只允许新增** `parseAgentId`，见 §A4.4。）

**明确不做**：**不改任何 RUNTIME 字符串**（与 A7 同一纪律）；不改任何测试夹具的期望输出。

### A4.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 缺陷①的牙齿：全新库上开第一个会话
#    ⚠️ 空库上 `session create` **到不了** A4.1(ii) 的目标错误：apps/cli/src/config/resolve-scope.ts:29-35
#    会先抛 `Missing --project <id>`；即便补上 --project，session.service.ts:414-418 的
#    requireProject 还会抛 chatNotFound("project")。⇒ 脚本必须**先建 project**。
cd apps\cli
$db = "$env:TEMP\nm-p003-empty.db"
Remove-Item $db -ErrorAction SilentlyContinue        # 全新库（该路径不存在）
#    修前取证（**有 project、无 agent** 的库上）：
npm run dev -- project create --db $db --name p
npm run dev -- session create --db $db --project <上一步打印的 projectId> --title t1
#    修前期望：throw "新建会话失败：workspace 未配置 Agent，且 registry 为空"
#    修后（同一个库上先 create agent、再 create session）：
npm run dev -- agent create --db $db --name smoke
npm run dev -- session create --db $db --project <同一个 projectId> --title t1
#    期望：agent create 打印一个 UUID；session create 打印会话 UUID 且退出码 0

# ② 缺陷②的牙齿：stdout 洁净
#    ⚠️ 必须换一个**全新 db 路径**（先删文件再跑）：① 跑完之后该库的 6 条 schema migration
#    早已 applied（schema-migrations/index.ts:36-43 共 6 条），`[nm-boot]` 一次都不会打
#    ⇒ 复用同一个库会让这条断言**零牙齿、改前改后都过**。下面用本脚本里第一个打开
#    该 db 的命令（`project create`）来触发迁移并抓它的 stdout。
$db2 = "$env:TEMP\nm-p003-stdout.db"
Remove-Item $db2 -ErrorAction SilentlyContinue
npm run dev -- project create --db $db2 --name p2
#    改前：stdout 混入 **12 行** `[nm-boot] migration run/applied: …`
#          （`ledger-v2.md:82` 的实测数字 = 6 × run/applied，不是「两行」）
#    改后：`[nm-boot]` 行数 = **0**，stdout **恰 1 行**（project UUID）

# ③ 四域 typecheck + CLI 现有套件
cd apps\cli; npm run typecheck     # exit 0
cd apps\cli; npm test
#    ⚠️ `baseline.md` §4「已知红基线」总表**没有 `apps/cli` 行**、§3 也只跑了 core/desktop/mobile
#    ⇒ 本条**不写「与 baseline 对照」**（当前无可比基线）。判据二选一，PR 描述里写明用了哪条：
#      (a) 默认：以 `ledger-v2.md:82` 的 **26/102** 为判增量基线 ——
#          修后 tests 数 >= 26、fail 数 <= 26，本条目只允许减少红、不允许新增红；
#      (b) 替代：先在 `baseline.md` 补一行 `apps/cli` 基线
#          （`tsx --test test/**/*.test.ts` 的 tests/fail 实测数，由 s-baseline 机位执行），
#          再改用「与 baseline 对照」。
cd packages\core; npm run typecheck
```

**可测断言**（写进 `apps/cli/test/agent-registry-e2e.test.ts`）：

- `nm agent create` 在空库上退出码 0，stdout 恰为 1 行且可被 `parseAgentId` 解析成 UUID
  （取法照 `apps/cli/test/helpers.ts:123-134` 的 `parseCreatedProviderId`：**取 stdout 的尾行**，
  不要自己另立一套口径）；
- 紧接着 `nm session create` 退出码 0；
- `nm session create` 的 **stdout 不含 `[nm-boot]`**（用 `stripBootLogs` **不** 调用、直接断言 `includes` 为 false
  —— 否则过滤器会把证据洗掉，这正是「恒真断言」的经典形态）。

### A4.4 测试策略

- **改动既有文件**：
  - `apps/cli/test/agent-registry-e2e.test.ts` —— 新增
    `nm agent create：空库上创建出可用 agent（stdout 恰一行 UUID）`、
    `nm agent create 后 nm session create 不再失败（全新库第一个会话）`。
  - `apps/cli/test/helpers.ts` —— **只新增**一个 `parseAgentId(stdout)`，
    取尾行的口径**参照** `parseCreatedProviderId`（同文件 `:123-134`，取 stdout 尾行再校验 UUID），
    **不改** `stripBootLogs` / `parseProviderList` / `parseSavedModelList`。
- **不改**：`apps/cli/test/session-rollback-e2e.test.ts` 等 22 个既有用例
  （它们是 26 条红灯的取证现场，**本条目不得顺手改它们的期望**）。
- **牙齿三判据自检**：① 有牙吗——把 `case "create"` 删掉 ⇒ 空库 `session create` 重新失败 ⇒ 红。成立。
  ② 恒红吗——用 `--db` 指向临时空库，每个用例自造夹具，不依赖仓库内既有库状态。成立。
  ③ 一夹具两期望吗——否。

### A4.5 回归线（必须保持绿）

- `apps/cli` 全量 `npm test`（**⚠️ `baseline.md` 当前没有 `apps/cli` 基线行**，见 §A4.3 ③ 的二选一；
  默认判据 = `ledger-v2.md:82` 的 **26/102**：本条目**只允许减少红、不允许新增红**）
- `packages/core` 全量 `npm test`（缺陷②改的是 core 的 bootstrap 日志流，
  `packages/core/test/bootstrap/**` 与任何断言 stdout 洁净的用例必须绿）
- `apps/desktop` / `apps/mobile` 全量（bootstrap 改动影响三端启动路径）
- 仓根 `npm run typecheck`

### A4.6 依赖

- **前置**：无。缺陷①与缺陷②**互相独立，可分两个 commit**。
- **跨分片**：无冲突文件。
- **拍板项**：无。
- **后续（本条目范围外）**：26 条红灯的逐条归因。台账已归因 2 条（即本条）；
  余 24 条须在 `baseline.md` 出基线后另开条目。

### A4.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| `console.log` → `console.error` 让某些「靠 stdout 抓迁移日志」的人工流程失效 | 低 | 运维便利性 | 日志**内容一字未改**，只是换了流；抓日志的人改抓 stderr 即可 |
| `nm agent create` 造出的最小 agent 缺 `workplace` 开关，跑起来工作区不注入 | 中 | 首会话体验弱 | `--system` 允许用户自己写；且 `AgentDefinition` 的 prompts 可后续 `nm agent import` 覆盖。**本条目只保证「能开会话」，不保证「配置好用」** |
| `upsert` 拒绝与内置 `general` 同名（`agent-registry.service.ts:108-111`） | 低 | 报错信息清晰 | 这是**期望行为**，测试里用非保留名 |
| 回滚 | — | — | 两个独立 commit，各可单独 revert |

---

## A5 · CI typecheck 转 blocking

- **严重度 / 簇**：P0 的门禁面（台账 Wave A「CI typecheck 转 blocking」行）· CI

### A5.1 证据

**`.github/workflows/ci.yml:53-66`**（全文 67 行，本分片逐行核对）：

```yaml
      # lint / typecheck 还有既存错误，先就位但允许失败，后续逐步修到全绿（gates/G-1 分步收敛）
      - name: Format
        run: npm run format:check

      - name: Lint
        continue-on-error: true
        run: npm run lint --workspaces --if-present

      - name: Typecheck
        continue-on-error: true
        run: npm run typecheck --workspaces --if-present
```

- `:58` Lint 带 `continue-on-error: true`
- **`:62` Typecheck 带 `continue-on-error: true`** ← 本条要删的就是这一行（台账记 `:62`，逐字命中）
- 头部注释 `:6-7` 写着「lint / typecheck 暂时 continue-on-error，因为仓库里还有既存错误」

**关键实测（本分片跑出来的，是本条能否落地的唯一依据）**：

```
cd D:\Dev\nm-worktree\mcr
npm run typecheck
```

**结果：`exit 0`，全绿。** 16 个 workspace 全部跑完，含
`@novel-master/core`、`@novel-master/desktop`、`@novel-master/cli`、
`@novel-master/mobile`（`tsconfig.build.json` + `src/web/tsconfig.json` + `e2e:tsconfig.json` 三段）。

⇒ **「因为仓库里还有既存错误所以先放行」这条理由，对 Typecheck 已经不成立了。**
（对 Lint 仍然成立，见 §A5.3。）

### A5.2 修法（文件·函数级步骤）

**Step 1 — `.github/workflows/ci.yml:62` 删除 `continue-on-error: true`**（该行整体删掉，
`Typecheck` 步只剩 `run:` 一行）。

**Step 2 — 更新头部注释 `:5-7`**，把「lint / typecheck 暂时 continue-on-error」改成只讲 lint：

```yaml
# - test / format / typecheck 是 blocking；lint 暂时 continue-on-error，
#   因为仓库里还有既存错误（逐项清账见 wave-e X1 的 lint 批次）
```

**Step 3 — 不给 `Lint`（`:58`）动手术**，也不删 `:58`。理由见 A5.3。

**明确不做**：**不把 renderer 门禁带进来**。`apps/desktop/package.json` 的 `typecheck`
只跑 `tsc --noEmit -p tsconfig.json`，而该 tsconfig 的 `include` 是
`["src/main/**/*", "shared/**/*"]` —— **不含 `renderer/`**。
`tsconfig.renderer.json` 存在且 `include: ["renderer/**/*","shared/**/*","test/**/*"]`，
但**没有任何 npm script 引用它**（本分片逐字读过 desktop 的 `package.json` scripts）。
⇒ 摘掉 `continue-on-error` 之后，CI 依然看不见 renderer 的那批错误（wave-e 实测 411 条）。
**把 renderer 变成「可见的红」是 wave-e X2 的活**，不在本条。

### A5.3 「mobile `--max-warnings` 差距」——记一笔（不修）

**本分片实测**（`cd apps/mobile && npx eslint . --max-warnings 99999`）：

```
✖ 432 problems (27 errors, 405 warnings)
```

**与 `apps/mobile/package.json:11` 的差距**：

```json
    "lint": "eslint . --max-warnings 321",
```

| 项 | 声明值 | 实测值（2026-10-01，`fe79b781`） | 差距 |
|---|---:|---:|---:|
| `--max-warnings` 上限 | 321 | **405 warnings** | **+84，门限已失效** |
| errors | 0（`--max-warnings` 不覆盖 errors） | **27 errors** | 27 —— 任意一条 error 都让退出码为 1 |

**结论与处置**：

1. **mobile lint 现在就是红的，且与 `--max-warnings` 无关** ——
   27 条 error 本身就足以让 `eslint .` 退出码非 0。
2. 因此**「把 `--max-warnings` 提到 405」这一条单独做没有意义**（仍然红）。
3. ⇒ **本条目不把 `Lint`（`ci.yml:58`）转 blocking。**
4. **记一笔的处置建议**（交 wave-e 的 lint 批次 / `baseline.md` 定档）：
   - 27 条 error 逐条归因并清零（wave-e 已实测 desktop 11 / core 8 / driver 8 条，
     **mobile 这 27 条本分片只记数、未逐条归因**）；
   - 清零后再把 `--max-warnings` 从 321 提到实测值并**锁进 `baseline.md`**，
     让「新增一条 warning 就红」这件事真正生效；
   - 两步完成前，`Lint` 步保持 `continue-on-error: true`。

### A5.4 验收（可测断言 / 命令 + 期望）

```powershell
# ① 本地等价命令（期望：exit 0）
cd D:\Dev\nm-worktree\mcr
npm run typecheck
echo "exit=$LASTEXITCODE"        # 期望 exit=0

# ② YAML 形状检查（期望：Typecheck 步不再有 continue-on-error，Lint 步仍有）
#    ⚠️ 必须是**单行** node -e：RULE 明记「cmd 下多行 node -e 会被静默丢弃整条命令
#    （无报错无输出）」。原来的四行版在 cmd 下报「'Typecheck)[\s\S]*?' 不是内部或外部命令」，
#    换 bash 才跑得通 —— 照抄进 PowerShell/cmd 就是一次静默空跑，
#    而静默空跑正是本条目要消灭的假绿同族。下面这条已实测可在 cmd / PowerShell / bash 三处跑通：
node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=s.match(/- name: (Lint|Typecheck)[\s\S]*?(?=\n      - name:|\n\S|\$)/g)||[];console.log(m.map(x=>x.split('\n')[0].trim()+' | coe='+/continue-on-error/.test(x)).join('\n'))"
# 期望输出：
#   Lint | coe=true
#   Typecheck | coe=false

# ③ 负向验证：临时往 packages/core/src 塞一个类型错误
#    ⇒ 期望：npm run typecheck 退出码非 0（证明这一步真的有牙齿）

# ④ CI：开一个只改本文件的 PR ⇒ Typecheck 步必须是绿的（不再是黄色）
```

### A5.5 测试策略

- **不新增单测**（改的是 YAML）。
- **测试即「③ 故意注入类型错误」** —— 必须做，否则「摘掉 continue-on-error」可能只是把
  「反正没人看」变成「更没人看」。
- **牙齿三判据自检**：① 有牙吗——注入 TS 错误 ⇒ 红。成立。
  ② 恒红吗——干净树上恒绿（本分片已实跑）。成立。③ 一夹具两期望吗——否。

### A5.6 回归线（必须保持绿）

- 仓根 `npm run typecheck`（16 个 workspace，本分片实测 exit 0）
- CI 的 `Build workspaces` 步（`ci.yml:51` 的 `npm run build --workspaces --if-present`）
  本机**实跑 exit 0、零 TS5042**，它是绿的前置 ⇒ **该步的顺序不能动**。
  > ⚠️ **与 baseline §1.1 的口径差异，必须回写 baseline**：§1.1 记的「根 `npm run build`
  > exit 1、14 个包 TS5042」只在**带额外位置参数**的形态下复现（`npm run build <包名>` 即触发，
  > 已复现 exit 1），**不是 CI 跑的那条命令**。两条不是同一条命令 —— 实施者若照 baseline
  > 的红灯数理解，会以为 CI `Build workspaces` 本来就红，进而误判本条的 typecheck
  > 转 blocking 不可行。
- 「typecheck 依赖 `dist/`」这句要**收窄**为：**desktop 的 project references 要求上游包先 build**
  （`apps/desktop/tsconfig.json` 的 6 条 `references`）；`apps/mobile` 有 `pretypecheck` 自建依赖，
  其余包是裸 `tsc --noEmit`、**不读 dist**。
- `npm run format:check`（`:54-55`，blocking 步；改 YAML 不影响，但顺带确认 prettier 不管 `.github/`）

### A5.7 依赖

- **前置**：无。但**必须与 A3 同 PR** —— A3 修的正是「本地 `npm test` 假绿」，
  A5 把 typecheck 转 blocking 后 CI 才真正可信；两条一起落，本地与线上的口径才对得上。
- **下游**：`ledger-v2.md:487-488` 记的 Wave E X1（全量收口）与 X2（renderer typecheck 门禁）
  **都依赖本条** —— 门禁的兜底先立，上游的清理才有意义。
- **拍板项**：无。
- **跨分片提示**：wave-e 的 X1 Step 5 / X2 Step 3 / H6 Step 4 也都改 `ci.yml`
  （`wave-e.md:1451` 已建议合成同一个 PR）。若本条先落，wave-e 的三处改动就是**纯追加**。

### A5.8 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| CI（ubuntu + 全新 `npm ci`）上出现本地复现不了的类型错（平台差异、路径分隔符、可选依赖类型） | 低 | **CI 立刻红** | 首个 PR 若红：**先记进 `baseline.md` 判断是既存还是新引入**，再决定修还是回退，**不要立刻把 `continue-on-error` 加回去**（那等于本条没做） |
| `Test` 步的既有红（台账记 CLI 26/102 红）让人把账算到本条头上 | 中 | 归因混乱 | PR 描述里写明「本条只改 Typecheck 步；Test 步的红是既存基线，以 `baseline.md` 为准」 |
| 回滚 | — | — | 单行删除，`git revert` 即回 |

---

## A6 · A-14 闸门（intentional）+ `resourceQuota` 清账 + search filter 死路径早退

- **严重度 / 簇**：P2（占位/死路径）· core-tool
- **⚠️ 硬约束（台账 `ledger-v2.md:438` 原话）**：**清理时不得动闸门装配点与 policy 调用。**
  本条完全遵守：A-14 的闸门**一行行为代码都不改**。

### A6.1 证据

**(a) A-14 闸门 = intentional 占位，本分片复核为真**

- 闸门类型与纯函数：`packages/core/src/domain/tool/logic/tool-path-policy.ts`
  （`extractInputPaths:20` / `pathStartsWithPrefix:43` / `isPathAllowed:65` /
  `findDisallowedPath:81` / `readAllowedPaths:104` / `checkToolPathPolicy:127`）。
- **唯一的 policy 调用点** —— `packages/core/src/domain/tool/logic/tool-runner.ts:97-103`：
  ```ts
      // A-14: path 白名单二次校验（schema 之后的第二道闸）。
      const disallowedPath = checkToolPathPolicy(parsedIn.data, ctx);
      if (disallowedPath !== null) {
        throw toolPathForbidden(name, disallowedPath);
      }
  ```
- **三个装配点全部写死 `undefined`**（`git grep -n allowedPaths` 全量，本分片逐个打开核对；
  **行号与 raw 报告不一致，以实测为准**）：
  | 文件 | 实测行 | raw 报告写的 |
  |---|---|---|
  | `packages/core/src/service/agent/logic/run-agent-turn.ts` | **`:993`**、`:1351` | `:926`、`:1276` |
  | `packages/core/src/service/chat/create-user-vfs-turn-service.ts` | **`:83`** | `:78` |
- ⇒ `readAllowedPaths` 恒 `undefined` ⇒ `findDisallowedPath` 在 `tool-path-policy.ts:85-87` 首行 `return null`
  ⇒ **闸门在生产里恒放行、运行时成本为零**。
- **intentional 的出处**：`raw/w9-tool-pro.md:94` 引 `docs/Iterations/cr-fix-spec/spec.md:172` Step 28
  「加资源配额占位」；辩护方 `raw/w9-tool-adv.md:142-159` 给了三条保留理由
  （闸门位置正确且不可事后摆放 / 契约已固定在类型上 / 有测试锁定语义）。

**(b) `resourceQuota` 零读取方（本分片 `git grep -rn "resourceQuota" -- packages apps` 全量，6 处）**

| # | 位置 | 性质 |
|---|---|---|
| 1 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts:163-166` | `ToolResourceQuota` 接口定义（`maxWriteBytes?` / `maxCalls?`） |
| 2 | 同文件 `:197` | `BuiltinToolContext.resourceQuota?` 字段 |
| 3 | `packages/core/src/service/agent/logic/run-agent-turn.ts:994` | `resourceQuota: undefined,` |
| 4 | 同文件 `:1352` | `resourceQuota: undefined,` |
| 5 | `packages/core/src/service/chat/create-user-vfs-turn-service.ts:84` | `resourceQuota: undefined,` |
| 6 | `packages/core/src/index.ts:221` | `ToolResourceQuota,` 的 **type-only** 再导出 |

**零读取点、零测试引用**（grep 覆盖 `packages/**` 与 `apps/**`，含 `test/`）。
且 `packages/core/test/package-exports/snapshots/*.json` **13 份快照里没有一份含
`ToolResourceQuota` / `BuiltinToolContext`**（`main-entry-allowlist.json` + 12 份
`public-*-allowlist.json`，本分片逐份扫过）—— 因为它是**类型**、运行时不导出，删它不动快照。

**(c) search filter 死路径**

工具侧**从不**提供这两个选项 —— `packages/core/src/domain/tool/builtin/search/search-tool.ts:208`：

```ts
    const options = { maxResults: normalizeMaxResults(input.maxResults) };
```

而 `search-tool.ts:145-161` 的 `inputSchema` 只有 `query` / `maxResults` / `engine` 三个字段。
但 `packages/core/src/domain/tool/builtin/search/types.ts:83-88` 声明了：

```ts
/** 引擎适配器入参选项（工具 schema 本期只开放 query/maxResults/engine）。 */
export interface SearchToolOptions {
  readonly maxResults?: number;
  readonly recencyFilter?: SearchRecency;
  readonly domainFilter?: readonly string[];
}
```

⇒ 五个引擎适配器（`bocha.ts:132` / `brave.ts:96-97` / `duckduckgo.ts:169` / `searxng.ts:73` /
`tavily.ts:39`）里的过滤分支**生产恒不走**，每次都命中 `types.ts:177-179` 的早退：

```ts
  if (filters.include.length === 0 && filters.exclude.length === 0) {
    return true;
  }
```

**但不能删**：`docs/Iterations/web-search-tool/spec.md:106` 的 T-A5 / T-A6 把 domainFilter
列为**必测验收项**，且 `packages/core/test/tool/search-engines.test.ts`（约 12 处）与
`duckduckgo.test.ts`（约 4 处）**直接以这些字段为断言对象**。
删它们 = 删掉有 spec 契约、有测试锁定的行为 ⇒ **不是零风险，且属 Wave D / 需先拍板**。

### A6.2 修法（文件·函数级步骤）

#### A6.2.1 A-14 闸门：**零行为改动，只补注释**（装配点与 policy 调用一律不碰）

**Step 1 — `packages/core/src/domain/tool/builtin/builtin-tool-context.ts:190-191`**：
把像「决议」的表述改成现状 + 前置条件：

```ts
   * `undefined` 表示不限制（向后兼容）——**当前三端 runtime 全部硬写 `undefined`**
   * （`run-agent-turn.ts:993` / `:1351`、`create-user-vfs-turn-service.ts:83`），
   * 故这道闸门在生产中恒放行、运行时成本为零。
   * ⚠️ 这是**有意分期占位**（A-14，出处 `docs/Iterations/cr-fix-spec/spec.md:172`），
   * 不是缺陷。**接线前必须先修三处已知缺口**，否则闸门形同虚设甚至误杀：
 *   ① `pathStartsWithPrefix` 是纯字符串前缀比对、不解 `..`（`src/../../x` 可逃逸）
 *      （`tool-path-policy.ts:43`）；
 *   ② `PATH_FIELDS` 漏 `glob.options.cwd`（`vfs-tools.ts:459`）与
 *      `grep.options.pathPrefix`（`vfs-tools.ts:519`）；
 *   ③ `filePath` 在 `PATH_FIELDS` 里但**无任何内置工具的 `inputSchema` 声明它**
 *      （`git grep filePath -- packages/core/src` 的命中全是 VFS 逻辑的局部变量 / 形参，
 *      如 `ensure-parent-dirs.ts` / `workplace-rule-engine.ts`，**不是工具入参**）；
 *      且 `skill` 工具的 `path` 是技能目录相对路径（真实落点在 `/meta/skills/...`），
 *      开了会被整片误杀。
```

**Step 2 — 顺手修 `builtin-tool-context.ts:180-181` 的双 `/**`**（同文件，
`:179 sessionKkv` 的 JSDoc 被第二个 `/**` 吞进第一个块里，`:193 allowedPaths` 的文档归属错位）：

```ts
  readonly sessionKkv?: SessionKkvService;
  /**
   * 可选：VFS 内允许访问的路径前缀白名单（A-14 path policy）。
```

**Step 3 — `packages/core/src/domain/tool/logic/tool-path-policy.ts:10-11`** 的模块头
补一句「生产恒 `undefined`、接线前先修三处缺口」的指针（引 Step 1 的注释，不复制全文）。

#### A6.2.2 `resourceQuota`：真删（5 处源码 + 1 处 type 导出）

**Step 4** — 删 `builtin-tool-context.ts:155-166` 的 `ToolResourceQuota` 接口块 +
`:194-197` 的 `resourceQuota` 字段块。
**Step 5** — 删 `run-agent-turn.ts:994`、`:1352`、`create-user-vfs-turn-service.ts:84` 三处赋值。
**Step 6** — 删 `packages/core/src/index.ts:221` 的 `ToolResourceQuota,`。
**Step 7** — 在 PR 描述里点名出处：`docs/Iterations/cr-fix-spec/spec.md:172` Step 28 要求的占位；
**若将来要做资源配额，从 git 历史取回即可**（本条是纯删除，无迁移成本）。

#### A6.2.3 search filter 死路径：**只做早退收口与留证，不删实现**

**Step 8 — `search-tool.ts:207-208` 加注记**：

```ts
    // ⚠️ 生产恒不带 domainFilter / recencyFilter：inputSchema（`:145-161`）未开放这两项，
    // 五个引擎适配器里的过滤分支因此永远命中 types.ts:177-179 的早退。
    // 有意保留实现与测试（web-search-tool spec 的 T-A5 / T-A6 锁着它们），勿当死码删。
    const options = { maxResults: normalizeMaxResults(input.maxResults) };
```

**Step 9 — `search-tool.ts` 的 `description`（`:134-144`）不得提 `domainFilter` / `recencyFilter`**
（当前已没提，**本条只是把它钉成验收项**：改 description 时不得新增这两个入参）。

### A6.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 闸门装配点与 policy 调用零改动（用 git 逐行核）
#    ⚠️ 这条**必须拆成 ①a / ①b 两条互不重叠的断言**：原来的写法把「零行代码改动」
#    与括注里的「Step 5 删的是 resourceQuota 行」挂在同一条 git diff 上，
#    而 run-agent-turn.ts / create-user-vfs-turn-service.ts 正是要删行的那两个文件
#    ⇒ 两条期望不可能同时成立，实施者只能二选一猜（RULE 牙齿判据③「一夹具两期望」）。
cd D:\Dev\nm-worktree\mcr

# ①a 闸门装配点零改动：把 resourceQuota 行过滤掉后，闸门相关符号必须零命中
git diff -U0 -- packages/core/src/service/agent/logic/run-agent-turn.ts `
              packages/core/src/service/chat/create-user-vfs-turn-service.ts `
              packages/core/src/domain/tool/logic/tool-runner.ts `
              packages/core/src/domain/tool/logic/tool-path-policy.ts `
  | Select-String -NotMatch 'resourceQuota' `
  | Select-String -Pattern '^[+-].*allowedPaths|^[+-].*checkToolPathPolicy|^[+-].*toolPathForbidden'
# 期望：**零命中**（allowedPaths 三处与 policy 调用原样保留；后两个文件零改动或仅注释改动）

# ①b 删除面：git diff --stat 期望恰为 4 文件，且净行数如下
git diff --stat -- packages/core/src/domain/tool/builtin/builtin-tool-context.ts `
                    packages/core/src/service/agent/logic/run-agent-turn.ts `
                    packages/core/src/service/chat/create-user-vfs-turn-service.ts `
                    packages/core/src/index.ts
# 期望：run-agent-turn.ts 净 -2（:994 / :1352）、create-user-vfs-turn-service.ts 净 -1（:84）、
#       builtin-tool-context.ts 净 -14（接口 12 + 字段 2 + JSDoc 归并）、index.ts 净 -1

# ② resourceQuota 已清零
git grep -n "resourceQuota" -- packages apps
# 期望：零命中

# ③ 闸门语义未变（唯一允许被这次改动碰红的既有测试，且它必须仍绿）
cd packages\core
npm run test:fast -- test/tool/tool-runner-path-policy.test.ts
npm run test:fast -- test/tool/tool-runner.test.ts
# 期望：0 fail（该文件覆盖 undefined / 多前缀 / 越界 / 前缀相等四种语义）

# ④ search 侧零改动
git diff --stat -- packages/core/src/domain/tool/builtin/search/ packages/core/test/tool/search-engines.test.ts packages/core/test/tool/duckduckgo.test.ts
# 期望：src 侧只出现 Step 8 的注释行；两个测试文件零改动

# ⑤ 四域 typecheck
#    仓根 npm run typecheck ⇒ exit 0
```

### A6.4 测试策略

- **不新增、不改动任何测试文件。**
- 理由：Step 1-3 与 Step 8-9 是纯注释（零行为），Step 4-7 是零读取方的死符号删除
  （grep 已证零测试引用、零快照引用）。**本条的价值在「让意图与事实对齐」，不在改行为。**
- **牙齿三判据自检**：① 有牙吗——本条没有需要牙齿的断言（无行为改动）；
  它的验证面是 §A6.3 的 ①②④ 三条 `git grep` / `git diff` 静态断言 + ③ 的既有回归。成立。
  ② 恒红吗——③ 的四条语义用例在本条前后都必须绿，任何一条红了都说明闸门被动过。成立。
  ③ 一夹具两期望吗——**原先命中**（§A6.3 的 ① 把「零代码改动」与「删 `resourceQuota` 行」
  挂在同一条 `git diff` 上）⇒ 已按 MF-5 拆成互不重叠的 ①a / ①b 两条断言，现为「否」。

### A6.5 回归线（必须保持绿）

- `packages/core/test/tool/tool-runner-path-policy.test.ts` ← **本条最重要的一条**（它就是 A-14 的语义锁）
- `packages/core/test/tool/tool-runner.test.ts`
- `packages/core/test/tool/tool-runner-parallel.test.ts`
- `packages/core/test/tool/agent-tool.test.ts`（`agent` 工具按 name 查 `list()`，与 `listAgentIds()` 的差异是 A4 缺陷①的同族）
- `packages/core/test/tool/search-tool.test.ts` / `search-engines.test.ts` / `duckduckgo.test.ts` / `search-config.test.ts`
- `packages/core/test/package-exports/*`（4 个 allowlist 测试 + 13 份快照；
  4 个 `.test.ts` = `duplicate-export-consistency` / `main-entry-allowlist` /
  `public-no-config-forms` / `public-subpath-allowlist`，
  第 5 个 `helpers/export-snapshot.ts` 不是测试）
- `packages/core` 全量 + 仓根 `npm run typecheck`

### A6.6 依赖

- **前置**：无。可独立落。
- **拍板项**：**无**（`resourceQuota` 的 intentional 出处是 `cr-fix-spec/spec.md:172`，
  不在 `ledger-v2.md:319-337` 的 17 项拍板清单里）。
  ⇒ **默认案 = 删**；若主代理或用户认为「占位要留着」，备选案是「只做 Step 1-3 的注释、
  不做 Step 4-7 的删除」——那样本条就只剩注释价值，**须在 PR 里写明这个差异**。
- **跨分片**：无文件冲突。`index.ts` 的 type 导出与 wave-d 的死码批次 3 不同批
  （`ToolResourceQuota` 不在 348 条符号清单里 —— 那是 core 内部符号，本条是 `index.ts` 的公共 type 导出）。

### A6.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| 删 `resourceQuota` 时漏掉某处对象字面量赋值 ⇒ 编译红 | 低 | 编译失败，CI 立刻抓到 | `npm run typecheck` 是硬验收；`git grep resourceQuota` 必须零命中 |
| 有人把 `allowedPaths` 「顺手接线」了 ⇒ Step 1 注释里那三条缺口全部生效 | 中 | **安全闸门形同虚设 / skill 工具被整片误杀** | Step 1 的注释把三处缺口与坐标写死；§A6.3 的 ① 用 `git diff` 把装配点钉成「零代码改动」 |
| 注释改动触发 `format:check` 差异 | 低 | CI 红 | 注释按 prettier 风格写（行宽 ≤ 80、2 空格缩进的续行），提交前跑 `npm run format:check` |
| 回滚 | — | — | Step 1-3 与 Step 4-7 是两组独立改动，可分别 revert |

---

## A7 · 编码还原批次 1（★5 部分阻塞）

- **严重度 / 簇**：P2 · apps-mobile + apps-desktop + packages/core（编码损坏）
- **状态**：**`blocked-by-decision(★5)`** —— 但★5 只卡 **sksp 三处**；
  非 sksp 的 **5 个文件共 74 处** U+FFFD（其中 `message-body-text.test.ts` 属**非 UTF-8** 类，
  不是「合法 UTF-8 里塞了 FFFD」）与 **2 个 GBK 污染文件**（`session-prompt-input.service.ts` 178 处
  ＋ `message-body-text.test.ts` 3 处）**不受★5 阻塞，可先落**。

### A7.1 证据（本分片字节级实测，覆盖全仓 `git ls-files`）

⚠️ **必须先说清一个分类**：本条不是「178 个 U+FFFD」一种东西，而是**两类**。
wave-e 的 H1（`wave-e.md:529-537`）把两类混成一句「9 个文件含 U+FFFD」，
本分片按字节把它们拆开：

**类 1 —— 「字面 U+FFFD 字节（`EF BF BD`）已入库，且文件本身是合法 UTF-8」：5 个文件 / 72 处**

| 文件 | 处数 | 损坏位置 | 逐行核对结论 |
|---|---:|---|---|
| `apps/mobile/src/services/session-prompt-input.service.ts` | （见类 2） | — | — |
| `apps/desktop/src/main/ipc/handlers/vfs.ts` | **2** | `:2`、`:81` | **全在文件头 JSDoc 与一处 `/** */` 行内注释** |
| `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts` | **1** | `:2` | 文件头 JSDoc 首行 |
| `packages/core/src/infra/sksp/impl/composite-secret-store.ts` | **1** | `:17` | JSDoc 行内 —— **★5 的 sksp 三处之一** |
| `packages/core/test/agent/agent-runner.test.ts` | **64**（分布 8 行） | `:294`、`:351`、`:417`、`:460`、`:520`、`:789`（+2）、**`:1133`** | 前 7 行**全在 `it("…")` 的用例标题字符串里**；**`:1133` 是 `/** … */` JSDoc 块注释，不是用例标题**（9 处） |
| `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts` | **4** | `:13`、`:56`、`:82`、`:146` | **全在 `it("…")` 的用例标题字符串里** |

引文（`apps/desktop/src/main/ipc/handlers/vfs.ts:2`、`:81`）：

```
 * VFS IPC handlers?list/read/write/mkdir/delete/rename for global/project/session scopes.
 /** VFS 变更成功后通知 renderer 刷新 Explorer（消费方 ①）?*/
```

引文（`packages/core/test/agent/agent-runner.test.ts:294`、`:417`）：

```
it("T-ARP-C1: abort + text/thinking blocks  partial assistant tool_results", async () => {
it("T-ARP-C3: abort ޵ڶ model requeststepsExecuted===0", async () => {
```

> `:417` 的 `޵ڶ` 是**不可逆片段**（原本是 GBK 中文被误解码后残留的合法字符），
> 不能靠机械替换还原 —— 必须逐行人工判读补写。

**类 2 —— 「文件不是合法 UTF-8（GBK 污染）；按 UTF-8 读会炸出一片 replacement char」：6 个文件**

| 文件 | 严格 UTF-8 解码 | 按 UTF-8 读出的 U+FFFD 数 | 处置 |
|---|---|---:|---|
| `apps/mobile/src/services/session-prompt-input.service.ts` | **INVALID**（首个坏字节在 **index 835**） | **178** ← 台账的「178」就是它 | ✅ **本条目主目标** |
| `packages/core/src/infra/sksp/logic/ref-to-env.ts` | **INVALID** | — | ⛔ **★5 sksp 三处之二** |
| `packages/core/src/infra/sksp/ports/secret-store.port.ts` | **INVALID** | — | ⛔ **★5 sksp 三处之三** |
| `packages/core/test/chat/message-body-text.test.ts` | **INVALID** | 3（`:22`/`:44`/`:53`，全在 `it()` 标题） | ✅ 可做 |
| `apps/mobile/android/app/build.gradle` | **INVALID** | — | ⛔ **明确排除**，见 A7.2 |
| `docs/Iterations/mobile-chat-composer-annotate-ux/prd.md` | **INVALID** | 2（`:12` 标题行） | ⚠️ 文档面，另行处理 |

> ⚠️ 「首个坏字节 = 835」的口径：字节序列是 `e5 9c 3f`（`e5` 起 3 字节、但第 1 个续字节已被替换成 `?`）；
> **833 落在合法序列 `e6 96 b0`（合法「鎴」）的中间**，不是坏字节起点 —— 报 833 会让人切错位置。

**「178 个 U+FFFD 全部在注释里」——本分片实测确认**：
对 `session-prompt-input.service.ts` 做 `GBK decode → GBK encode → UTF-8 decode` 的还原实验，
还原后逐行分类：**28 行受损注释**，**0 行代码**
（还原文本里另有 8 行含 `?`，逐行看过全是 TS 的三元/可选链 `?.`，不是损坏）。
**损坏 100%  confined 在注释与 JSDoc。**

引文（还原后可见的原始中文，`session-prompt-input.service.ts` 第 27-37 行）：

```
/**
 * chip 刷新的中途弃权信号（2026-09-30 回滚竞态实锤）：回滚触发的刷新…
 * run 注册…~0.6s 起跑，冻结闸（只在防抖执行时判定）拦不到「已经在跑…
 * 的这一轮——它…build 与发送链共享 JS 线程与单 SQLite 连接，曾…POST
```

### A7.2 修法（文件·函数级步骤）

#### A7.2.1 可落的 6 个文件（不受★5 阻塞）

**Step 1 — 类 2 的两个**非 UTF-8** 文件走「`git checkout` 现成 good-rev + 重打」**

台账动作是「**从父提交还原**」。本分片已把 good-rev **实测钉死**，不必再逐个历史提交试解码：

**① `apps/mobile/src/services/session-prompt-input.service.ts` — good-rev = `46b37654`（2026-09-29）**

- 该版本**合法 UTF-8、0 个 U+FFFD、中文完好**（第 32-36 行 `可见消息列表（SQL 层已滤 hidden）…` 正常显示）。
- 其后仅 3 个提交：`acb4379e` / `d3b1049a` / `23e56dba`；
  `git diff --numstat 46b37654 HEAD` = **+90 / −22** ⇒ 还原工作量就是这 112 行。

```powershell
cd D:\Dev\nm-worktree\mcr
# 取 good-rev 的完好版本（字节级、零解码风险）
git checkout 46b37654 -- apps/mobile/src/services/session-prompt-input.service.ts
# 把 46b37654 之后的**真实代码改动**逐条用 Edit 工具重打（对照 `git diff 46b37654 HEAD -- <path>`）
git diff 46b37654 HEAD -- apps/mobile/src/services/session-prompt-input.service.ts
# 验收
```

**② `packages/core/test/chat/message-body-text.test.ts` — good-rev = `d054a523`**

- 与 HEAD 的差异仅 **+4 / −4** 行 ⇒ 走 checkout 路线成本极低。
- 该版本的**三条用例名就是正确形态**，可直接照抄：
  `text only → hello` / `thinking only → empty` / `image → [image]`
  ⇒ 受损字符就是 `→`。

```powershell
git checkout d054a523 -- packages/core/test/chat/message-body-text.test.ts
git diff d054a523 HEAD -- packages/core/test/chat/message-body-text.test.ts
```

> ⚠️ **因此本文件不再走「GBK 往返 + 51 处 `?` 人工判读」那条路**。
> 既然 git 里就有完好的历史版本，就**不得手工重打中文**：checkout + 重打后续真实改动
> 即可**逐字节**还原，把二次毁码的人工风险整块消掉。

**Step 2 — 类 1 的字面 U+FFFD 文件（合法 UTF-8，4 个可做）用 Edit 工具逐处替换**

- `apps/desktop/src/main/ipc/handlers/vfs.ts`（2 处，注释）
- `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts`（1 处，注释）
- `packages/core/test/agent/agent-runner.test.ts`（8 行 64 处：7 行 `it()` 标题 + **`:1133` 的 JSDoc 块注释**）
- `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts`（4 处，`it()` 标题）

这四个文件实测**没有近的 good-rev**（`agent-runner.test.ts` 最后 good-rev `9083af16` 只有 26,884 字节
vs HEAD 54,875；`vfs.ts` 最后 good-rev `5f5204ab` 8,842 字节 vs HEAD 13,701）⇒ **重放不可行，
Edit 路线是唯一可行选择**。

形态统一是 `[U+FFFD][U+FFFD]` 或 `[U+FFFD]?`，原本是 `→` / `—` / `·` 一类的分隔符。
**逐处按上下文补成正确符号；中文内容按语义补写。**
其中 `agent-runner.test.ts:417` 的 `޵ڶ` 是**不可逆片段**（无近 good-rev 可借），
必须逐行人工判读补写。

**Step 3 — 纪律（RULE 强制，两次实锤事故）：按「文件是否合法 UTF-8」分流**

> **合法 UTF-8 的文件**（`vfs.ts` / `tool-definitions.ts` / `agent-runner.test.ts` /
> `openai-content-mapper.test.ts`）：用 **Edit 工具**逐处替换，禁止 PowerShell 管道
> `Get-Content -Raw | -replace | Set-Content`（它按系统 ANSI/GBK 写回，会毁掉文件里**未损坏**的中文）。
>
> **非 UTF-8 的文件**（`session-prompt-input.service.ts` / `message-body-text.test.ts`）：
> **只允许 `git checkout <good-rev> -- <path>` + 重打**，禁止**任何文本级写入** ——
> 包括 Edit 工具。Edit 同样要经「读文本 → 解码 → 改 → 重编码 → 写回」，
> 在非 UTF-8 文件上与被禁的 PS 管道**风险等价**，同样会二次毁码。
>
> 两种路线都在提交前逐文件 `git diff --numstat`；出现「改了 1 行却报 20/20」
> 立刻 `git checkout --` 还原重做。

#### A7.2.2 ⛔ 明确排除的三项

**Step 4 — `apps/mobile/android/app/build.gradle`：不动。**
它按 RULE 记载是**混合编码**（UTF-8 段 + GBK 段并存），文本级重写必然二次毁码；
正确做法是字节级替换（`Buffer.indexOf` 定位 + 拼接），而本条目只需要在它的**注释里**
换掉 U+FFFD —— 收益 20 处、风险是毁掉一个出包关键文件。**明确不做，登记为独立条目。**

**Step 5 — `docs/Iterations/mobile-chat-composer-annotate-ux/prd.md`：不在本条范围。**
文档面归 Wave E 的文档轮；本条目只管源码与测试。

**Step 6 — `blocked-by-decision(★5)`：sksp 三处。**
`composite-secret-store.ts:17` / `ref-to-env.ts:8` / `secret-store.port.ts:2`，
三处形态完全一致（都是一个分隔符变成了 `[U+FFFD][U+FFFD]` 或 `[坏字节]?`）：

```
 * Read order: env hit?DB; writes go to DB only.            （composite-secret-store.ts:17）
 * `provider/<id>/apiKey`?`NOVEL_MASTER_PROVIDER_<ID>_API_KEY`.（ref-to-env.ts:8）
 * Secret Key Storage Protocol?async secret store port.        （secret-store.port.ts:2）
```

**★5 的默认建议是「先只还原已核实纯注释的 7 个文件，`sksp` 三处单独人工看过再定」**
（`ledger-v2.md:325`）。⇒ 本条目把 sksp 三处**整块挂起**，等用户拍板；
参考物是 ledger §11 记的仓库根 4 个空目录（`(echo` / `exist` / `OK)` / `if`）——
**同一族 Windows shell 转义事故的产物，可能就是有人故意留下的哨兵字符。**

### A7.3 验收（可测断言 / 命令 + 期望）

```powershell
# ① 编码扫描（wave-e 的 scripts/check-encoding.mjs 若已落则直接用；未落用下面这条单行命令）
cd D:\Dev\nm-worktree\mcr
node -e "const fs=require('fs'),cp=require('child_process');const S=require('util');const L=cp.execSync('git ls-files',{encoding:'utf8'}).split('\n');const SKIP=/(node_modules|[\\/]dist[\\/]|webview-dist|android[\\/]app[\\/]build)/;const EXT=/\.(ts|tsx|js|mjs|json|md|yml|yaml|kt|java|gradle|html|css)$/;let bad=0;for(const f of L){if(!EXT.test(f)||SKIP.test(f))continue;const b=fs.readFileSync(f);const t=b.toString('utf8');const n=(t.match(/\uFFFD/g)||[]).length;if(n>0){console.log(f,n);bad++;}}console.log('files with U+FFFD =',bad);"
```

- **修前期望**（本分片实跑该命令的原始输出，逐行照录）：

  ```
  apps/desktop/src/main/ipc/handlers/vfs.ts 2
  apps/mobile/src/services/session-prompt-input.service.ts 178
  docs/Iterations/mobile-chat-composer-annotate-ux/prd.md 2
  packages/core/src/infra/llm-protocol/logic/tool-definitions.ts 1
  packages/core/src/infra/sksp/impl/composite-secret-store.ts 1
  packages/core/src/infra/sksp/logic/ref-to-env.ts 1
  packages/core/src/infra/sksp/ports/secret-store.port.ts 1
  packages/core/test/agent/agent-runner.test.ts 64
  packages/core/test/chat/message-body-text.test.ts 3
  packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts 4
  files with U+FFFD = 10
  ```

- **修后期望**：`files with U+FFFD = 4`，只剩
  `sksp/impl/composite-secret-store.ts` / `sksp/logic/ref-to-env.ts` / `sksp/ports/secret-store.port.ts`
  （★5 挂起）+ `docs/.../prd.md`（文档面，另行处理）。
  **恰好消失的 6 个**就是 Step 1/Step 2 的清单。
- **`apps/mobile/android/app/build.gradle` 不会出现在这份清单里** —— 它的 `SKIP` 正则
  `android[\\/]app[\\/]build` 把它一起挡掉了（而它本来也只有「非 UTF-8」那一类问题、
  字面 `EF BF BD` 为 0）。这正好是 Step 4 排除它的另一条理由：**连扫描都不该碰它**。
  若 wave-e 的 `check-encoding.mjs` 没有这条 SKIP，必须补上，否则那条命令会把
  `build.gradle` 报成「解码失败」，诱发有人去「修」一个按 RULE 禁止文本级重写的文件。

```powershell
# ② 严格 UTF-8 校验（对本条目动过的 6 个文件）
#    修前实测：session-prompt-input.service.ts = INVALID、message-body-text.test.ts = INVALID，
#              其余 4 个本来就 VALID（类 1 是「合法 UTF-8 里塞了 U+FFFD」）
#    修后期望：6 个全部 VALID
node -e "const fs=require('fs');for(const f of ['apps/mobile/src/services/session-prompt-input.service.ts','apps/desktop/src/main/ipc/handlers/vfs.ts','packages/core/src/infra/llm-protocol/logic/tool-definitions.ts','packages/core/test/agent/agent-runner.test.ts','packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts','packages/core/test/chat/message-body-text.test.ts']){const b=fs.readFileSync(f);let ok='VALID';try{new (require('util').TextDecoder)('utf-8',{fatal:true}).decode(b)}catch{ok='INVALID'}console.log(f,ok);}"

# ③ 回归（改的 3 个是测试文件 ⇒ 用例名不能变）
cd packages\core; npm run test:fast -- test/agent/agent-runner.test.ts
cd packages\core; npm run test:fast -- test/chat/message-body-text.test.ts
cd packages\core; npm run test:fast -- test/infra/llm-protocol/openai-content-mapper.test.ts
# 期望：0 fail，且 **it() 用例名与改前逐字相同**（除标题里的乱码被换成正确字符）
cd apps\mobile; npx jest --maxWorkers=2
# 期望：全绿（RULE：mobile 必须降并发跑）
cd D:\Dev\nm-worktree\mcr; npm run format:check
# 期望：exit 0（去 U+FFFD 不得引入 prettier 差异）
```

**「it() 用例名逐字相同」这条要单独对**：改前先把 8 + 4 + 3 条用例名导出来存底，
改后逐条 diff，只允许乱码字符位置发生变化。
⚠️ **但用例名清单覆盖不到 `agent-runner.test.ts:1133`** —— 那一行是 `/** … */` JSDoc 块注释
（9 处），不是 `it()` 标题 ⇒ 必须**单独把 `:1133` 这一行的原文存底、改后逐字 diff**，
否则这 9 处会漏检。

### A7.4 测试策略

- **不新增测试**。本条目改的是注释与 `it()` 标题。
- **必须做的验证**（替代单测）：
  1. `git diff --numstat` 逐文件核对（只应有被改的那几行）；
  2. 严格 UTF-8 解码校验；
  3. `it()` 用例名逐条 diff（用例名是别人 grep 的坐标，**改名等于破坏契约**）
     ＋ **`agent-runner.test.ts:1133` 的 JSDoc 块注释行单独 diff**（它不在用例名清单里）；
  4. 三条被改测试文件 + mobile 全量跑绿。
- **牙齿三判据自检**：本条无新断言。① 有牙吗——不适用；
  它的验证面是上面的静态 diff + 解码校验 + 回归线。成立。
  ② 恒红吗——不适用。③ 一夹具两期望吗——不适用。

### A7.5 回归线（必须保持绿）

- `packages/core/test/agent/agent-runner.test.ts`（改了 8 条用例名）
- `packages/core/test/chat/message-body-text.test.ts`（改了 3 条用例名）
- `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts`（改了 4 条用例名）
- `apps/mobile/__tests__/session-prompt-input.service.test.ts`
  与 `__tests__/session-prompt-input-workplace-bail.test.ts`
  （动的是被它们 import 的源码）
- `apps/desktop/test/` 全量（`vfs.ts` 被 7 个测试引用）
- `packages/core` / `apps/desktop` / `apps/mobile` 全量
- `npm run format:check`
- 仓根 `npm run typecheck`

### A7.6 依赖

- **前置**：**`blocked-by-decision(★5)`** —— 仅对 sksp 三处。
  其余 6 个文件**可先落**，且**建议先落**（★5 既然已经卡了，就别让它卡住整批）。
- **跨分片**：**防再犯门禁（提交钩子 + CI 编码扫描）归 wave-e H1**
  （`wave-e.md:517`）。本条目**只做还原本体**，不写门禁。
  ⚠️ wave-e 的 H1 Step 4 也列了同样的清账清单（`wave-e.md:594-600`）——
  **两波人改同一批文件会撞车**。建议：**wave-e 的 H1 Step 4 让位，本条目做还原，wave-e 只做门禁**，
  并在两个分片之间同步这一条（见 §9「与其它分片的边界」）。
- **★5 的本条目处置**：把三处 sksp 的 **file:line + 完整引文** 写进 §A7.1，
  让用户拍板时不必再翻代码。
- **⚠️ 「不得改 RUNTIME 字符串」红线的适用范围**：该红线指**运行期注入 LLM / UI 的行为字符串**
  （提示词、系统提示、工具 description 之类）；**`it()` 用例标题与注释不在其内**。
  本条目改的正是这两类内容（`it()` 标题本身是字符串字面量，严格读法会把它一并禁掉）——
  但标题里**可读的部分必须逐字不动**，只替换损坏字符。

### A7.7 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| **文本级工具重写把文件里未损坏的中文也毁掉** | **高**（RULE 有两次实锤） | 大面积乱码 | 按 Step 3 分流：合法 UTF-8 的 4 个文件只用 Edit 工具；**非 UTF-8 的 2 个文件禁止任何文本级写入，只走 `git checkout <good-rev>`**；`git diff --numstat` 逐文件核对，出现异常立刻 `git checkout --` 还原重做 |
| 改了 `it()` 用例名 ⇒ 有人 grep 旧名找不到用例 | 中 | 协作成本 | 只改乱码字符，**用例名的可读部分逐字不动**；改前导出一份用例名清单做 diff（另加 `:1133` 的 JSDoc 行单独 diff） |
| `session-prompt-input.service.ts` 的 `good-rev`（`46b37654`，+90/−22）之后有多次真实代码改动，重放时漏掉 | **中** | 编译红或行为漂移 | 步骤化：`checkout 46b37654` → 按 `git diff 46b37654 HEAD` 逐条重打 → `npm run typecheck` + mobile 全量；`git diff` 逐 hunk 人工过一遍 |
| 回滚 | — | — | 6 个文件各自 `git checkout -- <path>`；★5 三处若已动则同批回滚 |

---

## 8 · 口径修正（本分片实测 vs 台账 / 其它分片）

> RULE：「条数 / 行号 / 计数类结论一律实测复核；评审分歧由主代理实测裁决」。
> 下表六条**以本分片实测为准**，请 judge 轮据此裁。

| # | 出处 | 台账 / 兄弟分片的说法 | 本分片在 `fe79b781` 的实测 | 影响 |
|---|---|---|---|---|
| 1 | `raw/w9-ds2-tool-*.md`（经 `ledger-v2.md:438` 转述） | A-14 三个装配点在 `run-agent-turn.ts:926` / `:1276`、`create-user-vfs-turn-service.ts:78` | **`:993` / `:1351` / `:83`**（行号整体下移 ~67 / ~5） | A6.2.1 的坐标；不改则注释指错行 |
| 2 | `ledger-v2.md:82` | 根因链 `session.service.ts:105-113` | **`create` 在 `:106`，取 agentId 在 `:110-113`，抛错在 `:114-118`** | A4.1 的引文 |
| 3 | `wave-e.md:561-564` | 「`session-prompt-input.service.ts` 实测**约 24 处** U+FFFD，与 178 差两个数量级」 | **178**（与台账一致）；差异的真正来源是 **wave-e 把「文件不是合法 UTF-8」与「含字面 `EF BF BD`」两类混为一谈** —— 该文件字面 `EF BF BD` 为 **0** | A7 的处置路线完全不同：wave-e 以为是「替换字符」，实为 **GBK 污染、须从父提交整体还原** |
| 4 | `wave-e.md:529-537` | 「U+FFFD 共 **9 个文件**」（单一类别） | **11 个文件、两类**：字面 `EF BF BD` **5 个 / 72 处** + 非 UTF-8 文件 **6 个**（含 `build.gradle` 与 `prd.md`） | A7 的清单；wave-e 的 `check-encoding.mjs` 设计**必须**能区分这两类（wave-e Step 2 已经预留了这个区分，✅ 方向对） |
| 5 | `wave-e.md:15-16` / `:21` | renderer typecheck **411** 条（wave-e 实测）；台账 `:171` 写 **424** | 本分片**未复跑** renderer typecheck（不在 Wave A 范围） | 无冲突；**以 `baseline.md` 为唯一权威数字**，wave-e 已自行声明此事 |
| 6 | `ledger-v2.md:437` | 「mobile `--max-warnings 321` 与实测 405 的差距」 | **405 warnings + 27 errors**（本分片 `npx eslint . --max-warnings 99999` 实跑）。⇒ 差距不只是 +84 条 warning，**还有 27 条 error 让 `Lint` 无论如何都是红** | A5.3 的结论：**本条不能顺带把 Lint 转 blocking**，且「只把 321 改成 405」这一条单独做**无意义** |
| 7（cr-func-A 勘误） | 本文件 §A6.3①b | 「`builtin-tool-context` 净 -14 行」 | 实测 **净 -6**（Step 1 新增 14 行接线注释抵消了删除量）——spec 口径算错，非实现偏离 | 无 |
| 8（A7b 落点登记，cr-func-A 裁定） | §A7.2.1 | 「6 文件全部 good-rev 还原」 | **实落 1/6**：仅 `message-body-text.test.ts` 可安全还原（其余 5 文件损坏后有实质改动 +90/+204/+931/+281 行，整文件还原会抹掉新代码；`tool-definitions.ts` 无完好历史版本）⇒ 5 文件转 **fix-A7b**：按 §A7.2.1 Step 2 的逐处替换路线，**必须字节级替换**（impl-A7 实锤：写文件工具对中文有 GBK 中转毁码风险——`→` 被写成双 U+FFFD） | 范围收窄已声明，非路线偏离 |

**另有一处台账原文需要修正**：`ledger-v2.md:82` 给 N-P0-03 的两个修法
（「给 CLI 加 agent 创建入口」**或**「让 `listAgentIds()` 对齐 `list()` 的 `general` 语义」）
**后者不成立** —— `packages/core/src/service/agent/agent-registry.port.ts:13-19` 的注释明写
「虚拟 general **没有 id**，`get(id)` 不合并虚拟」，而 `listAgentIds()` 返回的是 id 数组。
建议在终局版台账里把这一条改掉，避免下一轮又有人走那条路。

---

## 9 · 分片级注记

### 9.1 条目间的建议顺序与 PR 切分

| 顺序 | 条目 | 理由 | 可否并行 |
|---|---|---|---|
| 1 | **A3 + A5**（同一个 PR） | 两条都动 CI/测试语义，且 A3 修的正是「本地绿是假的」、A5 把 typecheck 转 blocking —— 合起来才让「本地与线上一致」这句话成立 | 与其余全部并行 |
| 2 | **A1**（独立 PR） | 纯 core 性能读数减半，零行为变化；且它是 RT-01 的前置基线，**越早落越好** | 独立 |
| 3 | **A2**（独立 PR） | 单文件单行 + 一条 mobile jest 断言；改完 `build:webview` 产物即刻验证 | 独立 |
| 4 | **A4**（两个独立 commit，建议同 PR） | 缺陷①（CLI 新命令）与缺陷②（日志流）互不依赖，但都是 P0，同 PR 便于一次回归 | 独立 |
| 5 | **A6**（独立 PR） | 纯注释 + 死符号删除，无行为改动 | 独立 |
| 6 | **A7**（独立 PR，**最后落**） | 它要动三个测试文件的用例名 + 一个 GBK 源码文件，还原过程需要最多的人工判读；放最后避免与别的波次抢同一批文件 | 等 ★5 对 sksp 三处的答复（可先落非 sksp 部分） |

**整体建议**：A3+A5 一个 PR，A1 / A2 / A4 / A6 / A7 各一个 PR，共 **6 个 PR**。
A7 若 ★5 未答，先合「非 sksp 部分」，sksp 三处留 TODO 注释。

### 9.2 与其它分片的边界

| 事项 | 归属 | 本分片的处置 |
|---|---|---|
| **RT-02 的读数基线 → RT-01** | RT-01 归 `wave-b-core1.md` | 本分片只落地「每 step 一次读」；**wave-b-core1 写 RT-01 的 memo / 窄读口时，必须以本条落地后的读数为基线**，且 **RT-02 必须先落或与 RT-01 同 PR**（否则 RT-01 的 memo 会与本条的透传重复实现同一件事） |
| **N-P0-01 的防再犯门禁**（`build-webview.mjs` 产物扫描） | **wave-e X3**（`wave-e.md:401`） | 本分片**只写修复本体**，一个字都不碰 `build-webview.mjs`。X3 的「门 B：core 模块依赖准入白名单」应把 `prompt-macro-input.ts → @novel-master/core/*` 记为已修好的样板。**门 B 白名单终值以本条为准：内联案 ⇒ composer-input 白名单 = `[]`（空数组），不是单元素集** |
| **零收集守卫的通用化**（core 的 `bash -O globstar` 脚本、`test:fast`、双 shell CI 步骤） | **wave-e H6**（`wave-e.md:1198`） | 本分片只修 desktop 一处的引号 + 最小守卫。**wave-e 已声明「不阻塞于 Wave A，若 Wave A 先落，H6 的 Step 2 只需加守卫、不用改引号」⇒ 本分片先落对 wave-e 是净收益** |
| **编码的防再犯门禁**（`scripts/check-encoding.mjs` + 提交钩子 + CI 步骤） | **wave-e H1**（`wave-e.md:517`） | ⚠️ **两边清单重叠**：wave-e H1 Step 4 也列了同一批文件。**建议 wave-e 的 Step 4 让位给本分片**（本分片做还原，wave-e 只做门禁）。若 wave-e 已先动，须以本分片 §A7.1 的实测分类为准重新对账 |
| **编码门禁对「非 UTF-8 文件」的识别** | wave-e H1 | wave-e Step 2 已预留「区分原本就含 FFFD 与解码失败两种情形」—— ✅ **方向正确且必要**（本分片实测有 6 个文件属后者）。请 wave-e 补上「文件非 UTF-8」必须是独立一类并单独 exit code |
| **CI `Lint` 摘 `continue-on-error`** | wave-e X1 Step 5 | 本分片**只转 Typecheck**（`:62`）。mobile 的 27 errors + `--max-warnings 321` 失效：wave-e 的边界表已把它划给 wave-a，本分片的处置是**只记数 + 给处置建议**（见 A5.3），实际清账随 wave-e 的 lint 批次 |
| **CI `ci.yml` 的其他改动**（X1 Step 5 / X2 Step 3 / H6 Step 4） | **wave-e** | 本分片只删 `:62` 一行；wave-e 的三处是纯追加。若能协调，**建议合成同一个 PR**（wave-e 已提出该建议） |
| **N-P1-05 / X2 renderer typecheck 门禁** | **wave-e X2** | 本分片的 A5 明确**不带 renderer 进来**（desktop 的 `typecheck` 只覆盖 `src/main` + `shared`）。A5 落地后 renderer 依然对 CI 隐形，这正是 X2 要解决的事 |
| **★5 拍板项** | 用户 | 本分片**只挂起 sksp 三处**并把 file:line + 引文备齐；其余 6 个文件不阻塞 |

### 9.3 本分片留给 judge 轮的三件事

1. **A2 的修法选型**：默认案 =「3 项内联 + RN 侧 jest 等价断言」；
   备选案 =「新增 core export 子路径 `./prompt-macros` 走深引」，代价是跨分片（要碰
   `package-exports` 快照 + `tsconfig.test.json` paths，归 wave-e）。**默认案更符合 Wave A 的
   「零风险止血」定位**，请 judge 确认这个取舍可以接受。
2. **A6 的 `resourceQuota` 取舍**：默认案 = 删（零读取方、零测试引用、零快照引用）；
   备选案 = 只补注释不删。**删是「承认这个占位不会实现」**，属于对旧 spec
   （`cr-fix-spec/spec.md:172`）的一次事实性推翻 —— 请 judge 裁一次，
   并考虑是否需要在 `docs/apm/RULE.md` 留一句（**由主代理执行，代理禁写 `docs/apm/`**）。
3. **A7 与 wave-e H1 的清单重叠**：两份 spec 动了同一批编码文件。
   建议明确「还原归 wave-a、门禁归 wave-e」，并把本分片 §A7.1 的两类分类
   （字面 `EF BF BD` / 非 UTF-8）作为唯一权威清单回写进 `wave-e.md` H1.1。


> **输出格式注记（CR-W5-A 补, 2026-10-02）**：desktop run-tests.mjs 因零收集守卫需读子进程 stdout 末尾的 `# tests` 汇总，本地测试输出由 spec reporter（人读表格）永久性变为 TAP（形如 `ok N - 名称`）、且为缓冲后一次性回放（跑测试期间终端无实时输出属预期）。详见 scripts 内注释与 CHANGELOG Unreleased。
