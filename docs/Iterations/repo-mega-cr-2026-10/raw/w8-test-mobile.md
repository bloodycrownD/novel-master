---
zone: w8-test-mobile
agent: 测试语料健康度（应用侧测试）——按 RULE.md「验收断言的牙齿三条判据」审 apps/mobile/__tests__ 全量 + e2e/
files_scanned: |
  实扫 237 个文件（apps/mobile/__tests__/**/*.ts|tsx，含 __snapshots__/1 与 helpers/1）
  + apps/mobile/e2e/ 24 个文件（config 3 / specs 5 / pageobjects 4 / helpers 4 / fixtures 2 / scripts 4 / tsconfig+README 2）
  + 只读取证的支撑面：apps/mobile/jest.config.js、test-utils/*（8 个桩）、tsconfig.json、tsconfig.build.json、
    package.json、src/web/rich-document/webview/main.ts、src/components/ui/TextPromptModal.tsx、
    src/components/chat/MessageEditModal.tsx、src/components/form/ScreenFormLayout.tsx、
    src/services/chat-transcript-telemetry.ts、src/components/rich-content/highlight-code.ts、
    apps/desktop/renderer/components/code-block.tsx、
    packages/core/src/bootstrap/{chat/chat-schema.ts, kkv/kkv-schema.ts, provider/provider-schema.ts}、
    docs/apm/RULE.md、docs/Iterations/repo-mega-cr-2026-10/PLAN.md
  实测命令（数字均为本机实测，非照抄）：
    npx jest --listTests            → 236 个套件（237 减去 jest.config.js testPathIgnorePatterns 排除的 __tests__/helpers/）
    npx jest --ci --silent           → Test Suites 2 failed / 234 passed；Tests 2 failed / 1733 passed / 1735 total；
                                      Snapshots 1 passed；Time 28.286s；末尾必现 "A worker process has failed to exit gracefully"
    git config core.autocrlf         → true（仓库根无 .gitattributes）
    git ls-files apps/mobile/webview-dist → 仅 1 条（.gitkeep）
---

## 摘要

`apps/mobile/__tests__/`（237 文件 / 约 1.86 MB / 1735 条 Jest 用例）+ `apps/mobile/e2e/`（5 spec）这套语料，
验的是 RN 端的核心逻辑、hooks、WebView 桥接契约与少量 UI 树形态，另有一条 Appium 真机链路。
本轮按 RULE.md 第 82 行的「牙齿三条判据」逐条判：**无牙断言 7 类、死测试 5 类、续命/fixture 腐烂 4 类、
快照与黄金值锁死过时行为 3 类**。最实的一条是 e2e fixture SQL 与当前 `llm_saved_model` DDL 不匹配，
注入脚本必然中断，fixture spec 结构性跑不起来（这不在 RULE 106 已记的范围内）。

## 职责与边界

- **本机位职责**：只判「测试语料本身是否健康」——断言有没有牙、用例会不会永远绿/永远红、被测对象是否还在、
  夹具是否还合 schema、黄金值是否锁死了旧行为。**不判**生产代码对错（归 `w2-mobile-*` 与 W4 对抗对）。
- **不在本机位范围**：mobile 生产代码（`apps/mobile/src/**`，约 1.4k 文件）本身的质量；
  core 侧测试（归 W3/W8 其它机位）；desktop 测试。
- **判定口径**：
  - 牙齿判据①（有牙吗）：把被测实现改成错的，这条会不会红。不红 = 无牙。
  - 牙齿判据②（在我的测试文件的进程/顺序约束下可能恒红吗）：模块级标记、默认 5s timeout、真实时钟。
  - 牙齿判据③（同一份夹具只服务一套期望吗）：手抄副本、条件分支、跨端对齐夹具。

## 对外接口

本区域不导出生产符号，只被两处消费：

| 消费方 | 位置 | 说明 |
|---|---|---|
| `npm test` → `jest` | `apps/mobile/package.json:34`（`pretest` 先 build core + `build:webview`） | 唯一默认执行入口 |
| `npm run typecheck` | `apps/mobile/package.json:47` → `tsc -p tsconfig.build.json` | **不含 `__tests__/`**（`tsconfig.build.json:6` 显式 `exclude: ["__tests__/**/*"]`） |
| `npm run e2e` | `package.json:48` → `wdio run ./e2e/wdio.conf.ts` | 需模拟器 + Appium |

**关键边界事实**：`__tests__/` 只在 `tsconfig.json`（非 build 那个）的 `include` 里（`tsconfig.json:44`），
所以 `npm run typecheck` **不覆盖测试文件**。测试里引用了已删除的具名导出，类型门不会拦，只有跑 jest 才炸——
若该用例恰好恒真（如 F-w8-05），就永远不炸。

## 数据访问

本区域不直接访问生产数据层，但通过被测代码与夹具间接约定：

- **e2e 夹具直写生产库**：`apps/mobile/e2e/fixtures/tool-turn-session.sql` 往
  `chat_project` / `chat_session` / `chat_message` / `llm_saved_model` / `kkv_entry` 五张表插数据，
  库路径 `/data/data/com.novelmaster/files/default/novel_master_vfs`
  （`e2e/scripts/inject-tool-turn-fixture.mjs:20-21`）。DDV 出处：
  `packages/core/src/bootstrap/chat/chat-schema.ts:9-62`、`kkv/kkv-schema.ts:9-14`、
  `provider/provider-schema.ts:21-32`。
- **KKV 域**：`nm-workspace-state` / `currentModelId|currentProjectId|currentSessionId`
  （夹具 sql:96-99；SSoT 在 `packages/core/src/service/persistent-state/impl/workspace-state-keys.ts:8,13`）。
- **构建产物当夹具**：`apps/mobile/webview-dist/**`（8 个套件经 `__tests__/helpers/read-webview-dist.ts` 读）。
  该目录**不入库**（`git ls-files` 仅 `.gitkeep`），靠 `pretest` 的 `build:webview` 生成。
- **源码文本当夹具**：25 个套件用 `readFileSync` 直接读 `src/**` 源码做字符串/正则断言
  （`ui-parity-regressions.test.ts:13`、`chat-tab-provider-static-guard.test.ts:17-20`、
  `new-skill-modal-contract.test.ts:15-18` 等）。
- **`__tests__/__snapshots__/`**：全仓唯一一份，`decode-entities-parity.test.ts.snap`。

## 依赖关系

```
__tests__/**  ──import──▶  @/…            → src/**（237 个 @/ 导入全部命中，0 悬空，已实测）
             ──import──▶  ../test-utils/* → 9 个桩（reanimated / keyboard-controller / webview /
                                            notifee / blob-util / op-sqlite / document-picker / core-shim）
             ──import──▶  @novel-master/core{,/chat,/common,/regex,/vfs,…}（jest.config.js moduleNameMapper
                            逐条直连 packages/core/dist/** 真实产物，不走 workspace symlink）
             ──import──▶  @web/*          → src/web/*（Preact 侧，独立 tsconfig）
             ──readFileSync──▶ src/** 源码文本、webview-dist 产物
e2e/**       ──运行时 adb──▶ com.novelmaster 设备沙箱（注入夹具 + 驱动 Appium）
             ──selector──▶ RN testID（落 resource-id）与 WebView DOM class/data-id
```

**被谁消费**：`jest.config.js` 的 `testPathIgnorePatterns` 只排除 `__tests__/helpers/`（有注释解释
「helper 又会被当成套件跑」，是真坑）；`collectCoverageFrom` 只覆盖 `src/{services,storage,hooks,runtime}`
四目录，**`src/components` 与 `src/screens` 全无覆盖率可见性**——而 UI 树形态类断言（`*.test.tsx`）恰好全在
这两处。这解释了为什么 F-w8-02 那族无牙断言能长期存活：既没覆盖率门槛，也没牙齿。

## 发现清单

### A. 无牙断言

| 编号 | 级别 | 位置 | 描述 / 建议 / 置信 |
|---|---|---|---|
| **F-w8-01** | P1 | `apps/mobile/__tests__/decode-entities-parity.test.ts:27-47, 110-114` | 见下 |
| **F-w8-02** | P1 | `apps/mobile/__tests__/keyboard-avoid-android.test.tsx:113-132,163-227` + `session-detail-screen.test.tsx:581-609` | 见下 |
| **F-w8-03** | P1 | `apps/mobile/e2e/specs/chat.tool-phase-and-order.e2e.ts:41-50` | 见下 |
| **F-w8-04** | P2 | `apps/mobile/__tests__/ui-parity-regressions.test.ts:25-28` | 见下 |
| **F-w8-05** | P2 | `apps/mobile/__tests__/llm-sse-native.smoke.test.ts:18-27` | 见下 |
| **F-w8-06** | P3 | `apps/mobile/__tests__/directory-rule-sheet.test.tsx:70-87` | 见下 |
| **F-w8-07** | P3 | `apps/mobile/__tests__/map-cloud-sync-sdk-error.test.ts:74-76` | 见下 |

---

**F-w8-01 | P1 | `apps/mobile/__tests__/decode-entities-parity.test.ts:110-114` + `:27-47`**

> ```ts
> /** desktop `apps/desktop/renderer/components/code-block.tsx` 的 FENCE_LANG_ALIAS 双写副本。 */
> const FENCE_LANG_ALIAS_FIXTURE: Record<string, string> = { typescript: 'typescript', … };
> it('mobile LANG_ALIAS 与 desktop FENCE_LANG_ALIAS 夹具逐项相等', () => {
>   expect(LANG_ALIAS).toEqual(FENCE_LANG_ALIAS_FIXTURE);
>   expect(Object.keys(LANG_ALIAS)).toHaveLength(19);
> ```

**描述**：这条测试自称「双端对齐守护」（文件头 1-13 行 + 用例名 110 行），但它比的是
`src/components/rich-content/highlight-code.ts` 的 `LANG_ALIAS` 与**测试文件内手抄的副本**。
desktop 真源 `apps/desktop/renderer/components/code-block.tsx:15` 是模块私有 `const`，从未被读取或 import。
**证明**：把 desktop 的 `FENCE_LANG_ALIAS` 删掉 3 个别名、或加 1 个新别名，本测试照样绿——
它守的是自己的副本，与被宣称的对象零耦合。牙齿判据①在此彻底失效。

**建议**：要么把 desktop 表导出并在两侧测试里都 import 真源，要么在本测试里
`readFileSync` desktop 的 `code-block.tsx` 并解析出那张表来比。手抄副本最多只能当「已知的已知」注释，
不能当守卫。

**置信**：confirmed（本机实测两侧当前都是 19 键且内容一致，所以今天绿；耦合缺失是结构性的）

---

**F-w8-02 | P1 | `keyboard-avoid-android.test.tsx:113,163,180,202`（4 例）+ `session-detail-screen.test.tsx:581`（1 例）**

> ```ts
> // keyboard-avoid-android.test.tsx:126-131
> const nodeWithTransform = findNodeWithTransform(tree.root);
> expect(nodeWithTransform).toBeDefined();
> // Android 分支外层是普通 View，不再有 KeyboardAvoidingView
> expect(countKeyboardAvoidingView(tree.root)).toBe(0);
> ```
> ```ts
> // session-detail-screen.test.tsx:589-604（注释是自认）
> // clipStyle 产出 {marginBottom: -0}（键盘收起时 height=0），所以我 marginBottom 样式的节点。
> expect(nodesWithMarginBottom.length).toBeGreaterThanOrEqual(1);
> ```

**描述**：这就是本轮要找的「reanimated 桩返回终值导致的恒真族」，共 5 条。链条是：
`test-utils/react-native-keyboard-controller-mock.tsx:38-43` 的 `useReanimatedKeyboardAnimation()`
恒返回 `{height: {value: 0}, progress: {value: 0}}`（模块级变量 `keyboardHeightForTests` 默认 0，
**这 5 条用例一次都没调 `__setKeyboardHeightForTests`**）；`test-utils/react-native-reanimated-mock.tsx:8-10`
的 `useAnimatedStyle(factory)` 每次渲染直接执行 factory。于是
`MessageEditModal.tsx:58-62` 的 `panelAvoidStyle` 恒为 `transform:[{translateY: Math.min(0,0)/2}]` = `[{translateY:0}]`，
`ScreenFormLayout.tsx:40-43` 的 `clipStyle` 恒为 `{marginBottom: -0}`——**是常量**。
测试只断言「树里存在一个带 transform 数组的节点」/「存在一个带数字 marginBottom 的节点」，
**从不断言 translateY 的数值**。

**证明**：把 `MessageEditModal.tsx:61` 的 `/ 2` 改成 `/ 3`（fraction 语义直接错），或把 `Math.min(0, …)` 删掉，
这 5 条用例全部照绿。用例名承诺的语义差异更是完全没验——T-KB2 声称「居中弹窗 fraction=0.5」、
T-KB3 声称「贴底 sheet fraction=1 整键盘高度」（用例名见 113/163 行），但两条断言的是**同一个东西**
（存在 transform），无法区分。对照组是同仓的正解：`use-adaptive-keyboard-sheet-style.test.ts:80-84`
注入了 `__setKeyboardHeightForTests(-500)` 并断言 `maxHeight === screenH - 500`（有牙）。

**建议**：这 5 条统一改为：先 `__setKeyboardHeightForTests(-300)` 触发 rerender，
再 `expect(style.transform).toEqual([{translateY: -150}])`（T-KB2）/ `[{translateY: -300}]`（T-KB3），
并补一条断言 T-KB2 与 T-KB3 的 translateY **不相等**——这条才真的把 fraction 差异钉住。

**置信**：confirmed

---

**F-w8-03 | P1 | `apps/mobile/e2e/specs/chat.tool-phase-and-order.e2e.ts:41-50`**

> ```ts
> const hasPhaseBar = await browser.execute((id: string) => {
>   const row = document.querySelector('.row.message.assistant[data-id="' + id + '"]');
>   return row?.querySelector('.tool-phase-bar') != null;
> }, messageId);
> if (hasPhaseBar) {
>   await chatTranscriptPage.expectToolPhaseBarVisible(true);
> }
> ```

**描述**：条件断言——探针为假时整条断言静默跳过，用例仍计绿。**证明**它实际上永远走 false 侧：
`e2e/pageobjects/chat-transcript.page.ts:212-222` 的 `expectToolPhaseBarVisible(true)` 断言
文案含「正在执行工具调用」，而同文件 `:224-228` 的 `expectNoPendingToolSpinner()` 断言
`.tool-status.pending, .tool-pending-spinner` 计数为 0，且 `:203` 的 `assertMessageHasToolGroup`
只要求工具组存在。fixture（`fixtures/tool-turn-session.sql:35-44`）里的 `e2e-fix-a1` 是一条**已完结**的
tool_use（`tu1` 配对 `e2e-fix-utr`），没有任何在跑的工具——「正在执行工具调用」与「零 pending」
在同一次调用里互斥。两条断言同时成立 ⇒ `hasPhaseBar` 分支实际是死路。

**建议**：二选一——要么把断言改成无条件的 `expect(await phaseBar.isExisting()).toBe(false)`
（承认「已完结回合不残留 phase bar」才是本用例要锁的行为），要么先把 fixture 换成一条未完结的工具回合
再加无条件断言。别留条件分支。

**置信**：confirmed

---

**F-w8-04 | P2 | `apps/mobile/__tests__/ui-parity-regressions.test.ts:25-28`**

> ```ts
> it('panelCenter 不设 gap（否则 actions 段间距会叠成 20）', () => {
>   const panelCenter = src.match(/panelCenter:\s*\{[^}]*\}/)?.[0] ?? '';
>   expect(panelCenter).not.toMatch(/gap/);
> });
> ```

**描述**：`?? ''` 是**潜藏恒真**。今天 `panelCenter` 确实在
`src/components/ui/TextPromptModal.tsx:181` 存在，所以断言有牙；但只要该 key 被改名、搬进
`StyleSheet.compose`、或拆成多行常量，`match` 返回 `null` → `''` → `expect('').not.toMatch(/gap/)`
**必然通过**。这是牙齿判据①的退化路径：断言保护的对象消失时，断言自己变永真。

**证明**：同仓已有正确写法作对照——`chat-tab-provider-static-guard.test.ts:42-45`
显式加了 `it('守卫文件存在（防路径漂移导致空跑）')`，正是这条缺的那一句；
`new-skill-modal-contract.test.ts:24-25` 也是先 `expect(branchIdx).toBeGreaterThanOrEqual(0)` 再切段。

**建议**：先 `expect(src).toMatch(/panelCenter:\s*\{/)` 钉存在性，再取块做 `not.toMatch(/gap/)`。
更彻底的做法是把这 7 条源码正则断言改成渲染树断言（渲染树断言天然对重命名敏感），
只在样式数值无法从渲染树读出时才回退源码契约。

**置信**：confirmed（退化路径）/ suspected（当前是否有牙——有）

---

**F-w8-05 | P2 | `apps/mobile/__tests__/llm-sse-native.smoke.test.ts:18-27`**

> ```ts
> it('native 入口在 Jest（无 LlmSseNative 模块）下安全加载且不可用', () => {
>   expect(isNativeSseAvailable()).toBe(false);
> });
> it('native 不可用时 registerNativeSseTransportWith 返回 false（装配点据此回落 XHR）', () => {
>   const register = jest.fn();
>   expect(registerNativeSseTransportWith(register)).toBe(false);
>   expect(register).not.toHaveBeenCalled();
> });
> ```

**描述**：**环境自证型恒真**。第 1 条断言的是「RN jest-preset 的 `NativeModules` 是空 mock」
（用例自己的注释 19 行就是这么写的）——这是环境事实，不是被测代码的性质。真机/真 native 模块在场时
`isNativeSseAvailable()` 的行为在这条里**零覆盖**；而它恰恰是「native 通道能不能用」的唯一判据。
第 2 条更弱：`register` 是测试自己造的 `jest.fn()`，`not.toHaveBeenCalled()` 在
`registerNativeSseTransportWith` 返回 false 的前提下必然成立——它没有区分「因为不可用所以不调」
与「因为根本没接线所以不调」。

**证明**：把 `isNativeSseAvailable()` 改成恒返回 `true`（真机上就是错的行为），本测试仍绿——
因为 jest 里 `NativeModules.LlmSseNative` 本来就 undefined。

**建议**：把这两条降级为「前提自检」并从回归套件移出（改名 `*.env-check.ts` 或加 tag 排除），
另补真路径用例：注入一个 fake `NativeModules.LlmSseNative` 后断言 `isNativeSseAvailable() === true`
且 `register` 被调用。这样才有牙。

**置信**：confirmed

---

**F-w8-06 | P3 | `apps/mobile/__tests__/directory-rule-sheet.test.tsx:70-87`**

> ```ts
> it('渲染树存在 maxHeight + flexShrink:1 的收缩容器：键盘收缩时底部按钮行不被裁', () => {
>   const shrinkers = renderer.root.findAll(node => {
>     const flat = flattenStyle(node.props?.style);
>     return flat.flexShrink === 1 && typeof flat.maxHeight === 'number';
>   });
>   expect(shrinkers.length).toBeGreaterThan(0);
> });
> ```

**描述**：F-w8-02 同族的轻症。用例名后半句「键盘收缩时底部按钮行不被裁」完全没有断言支撑——
全文没有 `__setKeyboardHeightForTests`，也没有对 `maxHeight` 的**数值**做任何断言，只判 `typeof === 'number'`。
**证明**：把 `maxHeight` 从 `'60%'` 改成 `'5%'`，或删掉键盘联动逻辑，本条照绿。

**建议**：注入键盘高度后断言具体 `maxHeight` 数值随键盘收缩而下降；或按用例名后半句改成
「收缩后 footer 按钮行仍在可见区域内」的几何断言。

**置信**：confirmed

---

**F-w8-07 | P3 | `apps/mobile/__tests__/map-cloud-sync-sdk-error.test.ts:74-76`**

> ```ts
> if (messageNotContains) {
>   expect(result.message).not.toContain(messageNotContains);
> }
> ```

**描述**：`describe.each` 驱动的数据表里，`messageNotContains` 是可选字段（20-62 行的 case 表中只有
一条 case 填了它）。不填的 case 静默跳过这条断言，而**没有任何机制**提示新增 case 忘了填。
同形的还有 F-w8-03（e2e）。这是一整类「条件断言」模式在本仓的第三次出现（另两处见 F-w8-04 的 `?? ''`
与 F-w8-03 的 `if (hasPhaseBar)`）。

**建议**：把可选字段改成必填（不适用就写 `messageNotContains: null` 并在断言处显式 `expect(x).toBeNull()`），
或在表驱动上方加一条不变式测试：`cases.every(c => 'messageNotContains' in c)`。

**置信**：confirmed

### B. 死测试

| 编号 | 级别 | 位置 | 描述 / 建议 / 置信 |
|---|---|---|---|
| **F-w8-08** | P1 | `chat-transcript-telemetry.test.ts:19-71`（3 条） | 见下 |
| **F-w8-09** | P2 | `mermaid-fullscreen.test.ts:104-106`（**实测红**） | 见下 |
| **F-w8-10** | P2 | `token-usage-stats-screen.test.tsx:405`（**实测并行红、单跑绿**） | 见下 |
| **F-w8-11** | P3 | 全量跑的 worker 泄漏（`A worker process has failed to exit gracefully`） | 见下 |
| **F-w8-12** | P3 | 8 个套件依赖未入库的 `webview-dist` 产物 | 见下 |

---

**F-w8-08 | P1 | `apps/mobile/__tests__/chat-transcript-telemetry.test.ts:19-71`**

> ```ts
> it('logs legacy_cache_discarded with wrong_version reason', () => {
>   if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) { return; }        // ← 零断言直接返回
>   emitChatTranscriptTelemetry({name: 'legacy_cache_discarded', reason: 'wrong_version'});
>   expect(infoSpy).toHaveBeenCalledWith('[ChatTranscriptTelemetry]', 'legacy_cache_discarded', …);
> });
> ```

**描述**：这个文件 3 条用例全部按 `CHAT_TRANSCRIPT_TELEMETRY_ENABLED`
（`src/services/chat-transcript-telemetry.ts:2-3`，定义是 `__DEV__ ? true : false`）分叉：

- 第 44-57 条在 flag 为 false 时**直接 return，零断言**——一条永远绿的空壳用例。今天 Jest 下 `__DEV__=true`
  所以会跑，但守卫设计使它在任何生产配置下变成死测试。
- 第 19-42、59-71 条在 flag 为 false 时退化成 `expect(infoSpy).not.toHaveBeenCalled()`——
  这是「emitter 是 no-op」的**自证**，恒真：把 `emitChatTranscriptTelemetry` 整个删成空函数，它照样绿。

**证明**：牙齿判据①——把 `src/services/chat-transcript-telemetry.ts:36-42` 的函数体删空（只留 `return`），
这 3 条用例在 `__DEV__=false` 口径下全绿。

**建议**：用 `jest.isolateModules` + `jest.replaceProperty`/`jest.doMock` 把常量按两种取值各跑一遍：
flag=true 档断言 `console.info` 的完整调用参数，flag=false 档断言 `console.info` 零调用。
两个口径都变成有牙的正向断言，「死分支」自然消失。

**置信**：confirmed

---

**F-w8-09 | P2 | `apps/mobile/__tests__/mermaid-fullscreen.test.ts:104-106`（本轮实测红）**

> ```ts
> expect(main).toMatch(/\}\);\n\nbindAnnotateUi[\s\S]*mountMermaidViewerPortal/);
> ```

**描述**：把 **CRLF 行尾**当成了源码契约。实测：仓库根**无 `.gitattributes`**，`git config core.autocrlf` = `true`，
`src/web/rich-document/webview/main.ts` 56 行**全部 CRLF**。断言里的 `\n\n` 在 Windows checkout 上
永远匹配不上。本轮 `npx jest --ci --silent` 与单独重跑该文件，**两次都稳定红在这一条**
（`Tests: 1 failed, 20 passed`）。

**关键澄清**：源码语义**没有变**——`main.ts:44` 的 `});` 收尾 `registerSetDocumentView` 回调、
`:46` 的 `bindAnnotateUi()`、`:49` 的 `mountMermaidViewerPortal(...)` 三者的相对位置与断言意图完全一致。
红的只是行尾。

**建议**（两条都要）：
1. 立刻把这类断言的 `\n` 换成 `\s*\n\s*` 或先把文本归一：`src.replace(/\r\n/g, '\n')`。
   仓库层面更根本的修法是补 `.gitattributes`（`* text=auto eol=lf`），让行尾不再随平台漂移。
2. 顺带审计同族的源码正则断言：25 个套件用 `readFileSync` 读 `src/**` 做字符串断言，
   本轮全绿说明**当前只有这一处**把行尾写进了正则，但它说明这类断言的维护成本是真实的。

**置信**：confirmed（CRLF 计数、行尾、两次重跑结果均为本机实测）

---

**F-w8-10 | P2 | `apps/mobile/__tests__/token-usage-stats-screen.test.tsx:405`（实测并行红、单跑绿）**

> ```
> thrown: "Exceeded timeout of 5000 ms for a test."  at __tests__/token-usage-stats-screen.test.tsx:405:5
> ```

**描述**：牙齿判据②（顺序/负载约束下可能恒红）。该 `it` 没有自定义 timeout，落在 Jest 默认 5s。
实测：全量并行跑时该套件 18.6s 挂在这条；**单独重跑同一文件 3.5s 全绿（37/37）**。也就是说这不是回归，
是并行负载下的耗时护栏——与 RULE.md 第 104 行记的 core 侧「3× 耗时护栏在并行负载下实测 3.02×」是同一族。

**建议**：给 `describe('T-S7 …')` 挂 `jest.setTimeout(20_000)`（或把 `ProfileTabScreen` 的重渲染
在测试里 mock 掉数据层），让「慢」与「错」两件事解耦。别把默认 5s 当性能预算。

**置信**：confirmed（两次实测：全量红 / 单跑绿）

---

**F-w8-11 | P3 | 全量跑的 worker 泄漏**

> ```
> A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to
>  improper teardown. Try running with --detectOpenHandles to find leaks.
> ```

**描述**：`npx jest --ci --silent` 全量跑完必现此行（即便 236 套件都收集到了）。说明至少有一个套件
留了未清 timer/handle。与 F-w8-10 叠加时，会把「本来就慢」放大成「随机超时」。

**建议**：跑一次 `npx jest --detectOpenHandles` 定位泄漏源（重点怀疑带真实定时器的
`run-finish-calibration-probe.test.ts`、`storage-config-screen-poll.test.tsx`、
`session-stream-unit-*.test.ts` 这几族——它们大量用 `jest.advanceTimersByTime`）。
本轮未跑 `--detectOpenHandles`（耗时超预算），标 suspected。

**置信**：suspected（有实测现象，未定位到具体文件）

---

**F-w8-12 | P3 | 8 个套件依赖未入库的 `webview-dist` 构建产物**

> ```ts
> // __tests__/helpers/read-webview-dist.ts:14-18
> if (!fs.existsSync(abs)) {
>   throw new Error(`缺少 webview-dist 产物: ${abs}（请先 npm run build:webview）`);
> }
> ```

**描述**：`apps/mobile/webview-dist/` **只提交了 `.gitkeep`**（`git ls-files apps/mobile/webview-dist`
实测 1 条）。依赖它的 8 个套件是：`chat-transcript-boot-script.test.ts`、
`chat-transcript-rich-styles.test.ts`、`code-copy.test.ts`、`code-editor-boot-script.test.ts`、
`mermaid-fullscreen.test.ts`、`mermaid-webview.test.ts`、`rich-document-boot-script.test.ts`、
`rich-document-doc-body-concat.test.ts`。走 `npm test` 时 `pretest`（`package.json:33`）会先
`build:webview`，没问题；但 IDE 的 jest 集成、`npx jest --changed`、CI 里的定向跑都会**直接抛错**
（本轮首次跑就是靠工作区里已存在的产物才跑通的）。

**建议**：把这 8 个套件的产物依赖显式化——`jest.config.js` 的 `globalSetup` 里跑一次 build，
或给它们单独一个 `test:webview` 脚本，让「缺产物」变成启动期的清晰报错而不是 8 个套件各自抛。

**置信**：confirmed

### C. 续命测试 / fixture 腐烂

| 编号 | 级别 | 位置 | 描述 / 建议 / 置信 |
|---|---|---|---|
| **F-w8-13** | P2 | `apps/mobile/e2e/fixtures/tool-turn-session.sql:80-94` | 见下 |
| **F-w8-14** | P2 | `apps/mobile/e2e/pageobjects/app.page.ts:110,251` | 见下（intentional，RULE 106 ④） |
| **F-w8-15** | P3 | 4 处把源码常量抄进断言 | 见下 |
| **F-w8-16** | P3 | `chat-transcript-boot-script.test.ts:240-243` 退役守卫 | 见下（intentional） |

---

**F-w8-13 | P2 | `apps/mobile/e2e/fixtures/tool-turn-session.sql:80-94`（fixture 腐烂，本轮最有实据的一条）**

> ```sql
> INSERT OR IGNORE INTO llm_saved_model (
>   provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
> ) VALUES ('anthropic', 'claude-3-5-sonnet-20241022', 'E2E Fixture Model', '{}', …);
> ```

**描述**：与当前 DDL 不匹配。`packages/core/src/bootstrap/provider/provider-schema.ts:21-30` 的
`llm_saved_model` 定义是：

> ```sql
> CREATE TABLE IF NOT EXISTS llm_saved_model (
>   id TEXT NOT NULL PRIMARY KEY,
>   provider_id TEXT NOT NULL,
>   vendor_model_id TEXT NOT NULL,
>   model_name TEXT NOT NULL,          -- ← 夹具没给
>   settings_json TEXT NOT NULL CHECK (settings_json IS NULL OR json_valid(settings_json)),
>   created_at_ms INTEGER NOT NULL,
>   updated_at_ms INTEGER NOT NULL,
>   FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE   -- ← 夹具没插 llm_provider 行
> );
> ```

夹具**既没给 `id`（NOT NULL PRIMARY KEY）也没给 `model_name`（NOT NULL）**，且 `provider_id='anthropic'`
引用了一条脚本从未插入的 `llm_provider` 行。注入器 `e2e/scripts/inject-tool-turn-fixture.mjs:78`
是单发 `db.exec(sql)`——该语句必抛，脚本在此中断。

**证明（完整失效链）**：`db.exec` 在 autocommit 下逐句执行，所以 `chat_project`/`chat_session`/
`chat_message` 已经在中断前落库；但 `llm_saved_model` 之后的 `INSERT OR REPLACE INTO kkv_entry`
三行（`currentModelId`/`currentProjectId`/`currentSessionId`，sql:96-99）**不会执行**。
结果：会话行在、模型不在、`currentModelId` 未设 →
`openFixtureSession()`（`e2e/helpers/fixture-session.ts:38-53`）调 `ensureWorkspaceModel()` →
`selectFirstWorkspaceModel()` 在 `e2e/pageobjects/app.page.ts:263-271` 抛
`[e2e] No saved workspace models`。**T-E2 / T-E3 两条 fixture spec 结构性跑不起来**，
而 `allowFixtureSkip()` 只在显式设 `E2E_ALLOW_FIXTURE_SKIP=1` 时才跳（RULE 106 ② 记的
「cmd 里 `set X=Y` 会带尾随空格」正是这条 env 门的老坑）。

**顺带核对（好消息，避免误伤）**：`chat_session` / `chat_message` 的列与当前
`packages/core/src/bootstrap/chat/chat-schema.ts:17-62` **仍兼容**（`title` 可空、
`provider_id`/`attachments_json`/`content_encoding` 等新增列都可空或带默认）；
`kkv_entry (module, key, value)` 与 `kkv-schema.ts:9-14` 完全一致。**腐烂只集中在 `llm_saved_model` 这一句**。

**建议**：① 夹具补 `id`（如 `'e2e-fixture-model'`）与 `model_name`（`'E2E Fixture Model'`）两列；
② 前面补一条 `INSERT OR IGNORE INTO llm_provider (id, name, …)` 满足外键（字段按
`provider-schema.ts` 的 DDL 补全）；③ 注入器改成逐语句执行并把失败的 SQL 与参数打出来，
让下次腐烂在注入时就红，而不是在 5 分钟的模拟器跑里报一句 `No saved workspace models`。

**置信**：confirmed（DDL 逐列核对 + 注入路径逐行追）

---

**F-w8-14 | P2 | `apps/mobile/e2e/pageobjects/app.page.ts:110` 与 `:251`**

> ```ts
> for (const selector of ['~关闭项目列表', '~关闭']) { … }   // :110，抽屉关闭按钮双候选
> const tabChat = await $('~tab-chat');                      // :251，用 accessibility id 查 testID
> ```

**描述**：RULE.md 第 106 行 ④ 已记「`apps/mobile/e2e` 的页对象与当前 UI 已多处脱节（抽屉关闭按钮、
`tab-chat` 等）」。本轮复核确认**两处仍在**，并额外指出 `:251` 的自相矛盾：同文件 `:20-24` 的注释
自己写明「本机 Appium/UiAutomator2 的 accessibility id 只按 `content-desc` 匹配，RN 的 `testID`
落 `resource-id`」，所以 `:166/:172` 的 `byTestId('tab-chat')` 是对的，而 `:251` 的 `~tab-chat`
必然查不到 → 恒落进 `openLatestSession()` 兜底分支。RULE 同时记了
「`wdio.shared.conf.ts` 每条 spec 重装 + 清数据 → 注入的 fixture 活不过一个 session，fixture 用例在当前
配置下结构性跑不了」——本轮读 `wdio.shared.conf.ts:15-35` 后确认：现在的 cap 是「有 debug APK 就带
`appium:app`（会重装清数据），没有就 `noReset: true`」，RULE 的描述对「带 APK 那条路径」依然成立。

**建议**：`:251` 改用 `byTestId('tab-chat')`（与同文件其余 6 处统一）；抽屉关闭按钮的两候选
收敛成一个（先查 `src/components/**` 里 `ModalShell` 的实际 a11yLabel 是什么）。

**置信**：confirmed 现象 / **intentional 记账**（RULE.md 106 ④ 已列为已知债，本条只做现状复核与
「`:251` 是自相矛盾写法」的补充，不重复立项）

---

**F-w8-15 | P3 | 4 处把源码常量抄进断言（字面量锁）**

> ```
> chat-transcript-stream-block.test.ts:152  expect(src).toContain('STREAM_RICH_UPGRADE_MS = 350')
> code-copy.test.ts:41                      expect(src).toContain('COPY_FEEDBACK_MS = 1500')
> chat-transcript-boot-script.test.ts:93    expect(script).toContain(`MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS}`)
> ```

**描述**：把「某个常量恰好等于某个数」当契约。本轮逐个核对源值：
`src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts:17` = `350` ✓、
`src/web/shared/code-copy.ts:15` = `1500` ✓、`src/web/shared/constants.ts:10` = `400` ✓——
**三处当前都与源码一致，所以不是红灯**。但改常量即红、而行为毫无变化，属锁死实现细节。

**建议**：前两处删掉数值断言，改成「该常量被用在了正确的调用点上」（如
`expect(src).toMatch(/setTimeout\([^,]+,\s*COPY_FEEDBACK_MS\)/)`）——这样常量可调而契约不破。
第三处（`:93`）**已经是正确写法**（用 import 的常量拼接），可作前两处的修法参照；同文件 `:261` 的
`var MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS};` 同理。

**置信**：confirmed

---

**F-w8-16 | P3 | `chat-transcript-boot-script.test.ts:240-243`（退役守卫）**

> ```ts
> it('T-BR-CT-07: no parseUserVfsAction / user-vfs-action regression', () => {
>   expect(script).not.toContain('user-vfs-action');
>   expect(script).not.toContain('parseUserVfsAction');
> });
> ```

**描述**：`user-vfs-action` / `parseUserVfsAction` 是已退役形态的标识（core 侧 `user_vfs_pending`
按 RULE.md 第 31 行已「user ops 拆除后已无写入方」）。但本轮核对发现
**user VFS 整条线在 mobile 生产侧仍活着**：`src/components/vfs/VfsFileManager.tsx:46,176,515-565`、
`src/services/vfs-operations.service.ts:10-183`、`src/runtime/create-mobile-runtime.ts:118,197`
都还在用 `isUserVfsUnifiedToolTurnEnabled()` / `userVfsTurn.executeOp`。所以这条断言守的是
**WebView 侧已退役的旧解析器**，不是整条 user VFS 功能。

**标记 intentional**：这是「退役项防复活」守卫，语义正确，只是命名容易让人误以为整条线已退役。
建议把用例名改成「WebView 侧不再有 user-vfs-action 解析器（user VFS 现由 RN 侧 userVfsTurn 执行）」，
消除歧义。

**置信**：confirmed（生产侧逐文件核对）

### D. 快照/黄金值锁死过时行为

| 编号 | 级别 | 位置 | 描述 / 建议 / 置信 |
|---|---|---|---|
| **F-w8-17** | P2 | `anchored-menu-layout-parity.test.ts:31-69`（3 条） | 见下 |
| **F-w8-18** | P3 | `decode-entities-parity.test.ts:92-101` + `.snap` | 见下 |
| **F-w8-19** | P3 | 4 处真实时钟性能护栏 | 见下 |

---

**F-w8-17 | P2 | `apps/mobile/__tests__/anchored-menu-layout-parity.test.ts:31-69`**

> ```ts
> /** …下方黄金值来自重构前 WebView 内联公式（menu.ts L58-135）的手算结果，
>  *  锁死两端口共享后的输出不回归。 */
> it('flips above with pre-refactor WebView golden layout', () => {
>   expect(layout).toEqual({left: 74, top: 272, width: 132, maxHeight: 240, scrollable: false});
> });
> ```

**描述**：文件头自认黄金值来自**已被重构掉的旧内联公式**（`menu.ts L58-135` 早已不存在）。
这就是「快照测试锁死过时行为」的典型形态：锁住的是历史输出，不是当前的正确性判据。
**证明**：`layoutAnchoredMenu` 是共享真源
`src/webview-host/chat-transcript/anchored-menu-layout.ts`，它一旦因任何设计调整而改（宽度地板、
翻转阈值、`maxHeight` cap 比例任一），这 3 条立刻红——但它们并不能证明新值对，只能证明「和上次一样」。
注释里给的是**算式**（如 `:32` 的 `longest=2 → 2*14+32=60 < MIN_WIDTH 132；cap=360-24=336；min(336,200,132)=132`），
算式锁的是**推导过程**，比锁结果强，但也没写成可执行断言。

**同文件内的强对照**：`:21-29` 用 `toBe` 比函数引用（`expect(rnReexport.layoutAnchoredMenu).toBe(shared.layoutAnchoredMenu)`），
这是**真有牙**的双端口径断言——它证明 RN 端口就是同一函数。同一文件里两种强度并存，
说明作者清楚差别，只是黄金值那 3 条没有更好的替代。

**建议**：把算式转成不变量断言（不随设计调整而失效的那种）：
`left >= 0 && left + width <= viewportWidth - 2*SCREEN_MARGIN`、
翻转后 `top + maxHeight <= anchor.y`、未翻转时 `top >= anchor.y + anchor.height`、
`scrollable === (itemCount * ITEM_LAYOUT_HEIGHT > maxHeight)`。
黄金值降级为注释里的推导示例。

**置信**：confirmed

---

**F-w8-18 | P3 | `apps/mobile/__tests__/decode-entities-parity.test.ts:92-101` + `__snapshots__/decode-entities-parity.test.ts.snap`**

> ```ts
> it('双端输出一致性快照（人为改任一侧实现即变红）', () => {
>   const rows = SAMPLES.map(sample => ({input: sample, full: rnDecode(sample), preserveAngle: …,
>                                        webFull: webDecode(sample), webPreserveAngle: …}));
>   expect(rows).toMatchSnapshot();
> });
> ```

**描述**：全仓**唯一**一条 `toMatchSnapshot`（实测：`grep toMatchSnapshot|toMatchInlineSnapshot` 只命中此一处，
快照文件也只此一份，jest 报 `Snapshots: 1 passed`）。两个问题：

1. **冗余**：RN 侧与 WebView 侧是**两份实现**
   （`src/components/rich-content/decode-literal-html-entities.ts` 与 `src/web/shared/decode-entities.ts`），
   快照把同一批值存了两遍（`full`/`webFull`、`preserveAngle`/`webPreserveAngle`）。真正想锁的是「两边相等」，
   而这件事同文件 `:69-90` 的 3 条 `expect(rnDecode(s)).toBe(webDecode(s))` 已经做了。快照那条的价值只在
   「任一侧**同时**改了实现、但两边仍相等」时能发现——这场景下它有用，不是纯冗余。
2. **覆盖不足**：`SAMPLES`（`:49-66`）是手挑的 16 条。`entities` 包（jest.config.js 的
   `transformIgnorePatterns` 白名单里明确列了它）升级、实体表扩容时，新实体不在样本里 →
   快照不红、真实行为漂移无人知。**建议**加一条不变式：把实体表里所有具名实体都纳入 `SAMPLES` 派生，
   或至少加一条「`entities` 包版本变更时 `SAMPLES` 必须同步」的显式注释 + 表规模断言。

**置信**：confirmed（快照/断言分布为实测；覆盖不足为 suspected——取决于 `entities` 的升级节奏）

---

**F-w8-19 | P3 | 4 处真实时钟性能护栏**

> ```
> stream-token-estimator.test.ts:107-109   ASSERT_MEDIAN_PUSH_MS = 5 / ASSERT_AVG_PUSH_MS = 5 / ASSERT_MAX_PUSH_MS = 150
> stream-token-estimator.test.ts:129-131  expect(result.medianPushMs).toBeLessThanOrEqual(ASSERT_MEDIAN_PUSH_MS)
> session-stream-unit-accum-perf.test.ts:210  expect(elapsed).toBeLessThan(500)
> chat-transcript-snapshot-bytes.test.tsx:423  expect(prescanMs - beginMs).toBeLessThan(2000)
> ```

**描述**：牙齿判据②的反面——**在测试文件的进程/负载约束下可能恒红**。全部打在真实
`performance.now()` / 墙钟上。`stream-token-estimator.test.ts:95-105` 的注释自己量化了余量：
「空闲机均摊 0.47ms／中位 0.5ms，全量并行时实测 1.03ms」——对 5ms 的线只有 **约 5× 余量**，
而 RULE.md 第 104 行记录的 core 侧同类护栏在并行负载下实测到 **3.02×**。本轮全量跑这 4 处**没红**，
但余量已经很薄，且 Windows 调度噪声通常比 Linux CI 大。

**标记 intentional**：文件头已把「数量级线不是精度基准」写清，并给了峰值线放宽到 150ms 的理由
（2026-09-27 全量并行实测出现过 71ms 单次尖峰）。这与 RULE 104 的先例一致，不当缺陷报。
**建议**（观察项，非缺陷）：CI 上固定 jest 并行度，或对峰值线加一次 retry；
`session-stream-unit-accum-perf.test.ts:210` 那条 500ms/5000 次的余量看起来最薄（若缓存失效，
5000×25k 字符 join 才会爆——但如果缓存只是「部分失效」到只慢 3×，这条恰好卡在边界）。

**置信**：intentional（记账）/ suspected（余量风险）

## 争议与存疑

1. **「断言全是 mock 调用计数」的 161 条，不算缺陷。** 机器扫出 161 条用例的**全部**断言都是
   `toHaveBeenCalled*` 形式（`agent-finished-notification.test.ts`、`use-chat-tab-scope-token-debounce.test.ts`、
   `session-stream-unit-manager.service.test.ts` 等大族）。我逐族看过代表：它们的被测点**就是**调用契约
   （「切 tab 要 reload()」「第二次发送被 Manager 拒绝」），mock 的是真边界端口而不是被测实现。
   把 `service.reload()` 换成 `service.noop()` 或删掉调用点，这些都会红——**有牙**。所以我**不把 161 当问题报**。
   但它们共同的盲区是：**只看「调了没、调了什么参」，不看效果**。若哪次重构把
   `await service.reload()` 改成 `service.reload()`（丢掉 await），这些用例全绿而行为已坏。
   这属于「mock 断言的固有天花板」，不是逐条缺陷，建议在 mobile 的测试规约里加一句口径
   （至少对 IO 类调用补一条「结果被消费」的断言），而不进本轮台账。

2. **`keyboard-avoid-android.test.tsx` 那 4 条该判 P1 还是 P2，有分歧。** 判 P1 的理由是
   「把实现的避让数学改错，5 条用例照绿」——这是 RULE 牙齿判据①的最严格形态。判 P2 的理由是
   这几兄弟在 mobile 上是**真机行为、不是纯逻辑**，reanimated 桩本来就不跑时间轴，
   团队选择「结构断言」是有意识的降级（文件头 11-16 行把三个桩的语义都写明了）。
   我按「缺陷严重度」判 P1（5 条用例、覆盖 2 个真机交互风险点：弹窗与表单底部按钮被键盘遮挡），
   但请裁决者知道存在「有意降级」这一读法；若判定为有意，则应把这 5 条改名为
   「结构回归（数值由 T-HOST7 那类数值用例覆盖）」，避免它们冒充数值守卫。

3. **F-w8-09（CRLF）该记 P2 还是 P0，取决于 CI 跑在什么 OS。** 如果 CI 是 Linux
   （`autocrlf` 生效为 `input`/无转换），这条在 CI 上是绿的、只有 Windows 开发机红 → P2（本地开发摩擦）。
   如果有 Windows CI 或 Windows 协作者的机器把 `npm test` 计入门禁 → P0（门禁长期红）。
   我按「默认 Linux CI」判 P2。**但无论如何都建议补 `.gitattributes`**——这是本轮唯一一条
   我能给出**确定复现步骤**的发现（两次重跑稳定红在同一行）。

4. **`webview-dist` 那 8 个套件（F-w8-12）算不算问题？** 走 `npm test` 完全正常，
   我判 P3 的依据是「`npx jest` 是本仓文档与 PLAN 里到处在用的入口（我本轮自己也是这么跑的）」。
   若团队口径是「只允许 `npm test`」，这条应降为 P4/不报。**这条需要裁决者给口径。**

5. **`ui-parity-regressions.test.ts` 这 25 个「读源码做正则断言」的套件，我没有逐条判。**
   本轮全绿（除 F-w8-09），说明它们**当前**与源码一致；但这一类断言的长期维护成本是可预见的
   （F-w8-09 已经因此红过一次，F-w8-04 的 `?? ''` 是它的退化形态）。我把它作为一条**架构级观察**
   放在「争议与存疑」而不是台账里：是否要把「源码正则断言」整体迁到渲染树断言，是一次独立的决策，
   不该在 CR 台账里逐条记。若裁决者认可，建议单开一条 backlog（`tests/G-3` 豁免的复核）。
