# p27 R7 探针：desktop/renderer signatures 374 条裁决表

- 范围：`npx nm-style check apps/desktop/renderer --json` 中 rule=signatures 的全部发现——**ARGS 140 / VARDECL 119 / PARAMS 100 / IMPORT 9 / ASSIGN 6 = 374 条**，分布 131 个文件（其余 432 条为 hygiene/bare-exports 等其他规则发现，不在本表）。
- 方法：① 通读 `tools/nm-style/src/rules/signatures.ts` 全部判据；② 对 374 条逐条做 AST 归类（TS API 镜像规则判定逻辑，含 callee/hook/JSX/成员链/展平长度维度），每类人工复核 ≥10 处源码上下文；③ 用合成 fixture 实证四条关键判据（见 §2.6）；④ 对照 `scripts/prettier-guard.mjs` 的工作宽度约定（`--print-width 200`）。
- 总裁决：**豁免 119 / 收一行 255**（收一行内含 240 处直接并一行 + 15 处需先做辅助重构）。IMPORT 9 条按既有 import 规则处理，不新增豁免。
- 本轮**未改任何源码**；波 2 按本表执行。

## 0. 口径基准

- 仓库无全局 prettier write；`scripts/prettier-guard.mjs` 规定 `--write` 必须显式 `--print-width`（推荐 200）。本表一切「一行化」以 **展平后 ≤200 字符** 为可行性线：≤200 的并行结果在 `--print-width 200` 自检下可存活；>200 的 prettier-200 必然重拆，一行状态维持不住，只能豁免或重构（抽具名/抽中间变量）。
- nm-code-style §2 原文口径比宽度更硬（「参数多到一行放不下，先减少参数或缩短参数名，而不是换行」）；本裁决在 renderer 面按锚点放宽了 React 生态形态，逻辑代码面维持原口径。

## 1. 五类裁决总表

判定三值：**豁免**＝落规则层形态豁免/SKIP，不改源码；**收一行**＝源码并一行；**收一行(辅助)**＝先抽具名类型/中间变量或收实参起始行，再满足一行。

### 1.1 ARGS（140）

| 形态 | 判定 | 处数 | 理由 |
| --- | --- | --- | --- |
| hook 调用实参拆行（`useState<T \| null>(\n null,\n)`、`useState<{…内联对象类型…} \| null>(null)`） | **豁免（E1）** | 18 | 锚点点名形态。长泛型/内联对象类型的 useState 一行化必出 90–160 字符 hook 声明行，挤压「状态一眼可读」的惯用排版；与 VARDECL hook 解构是同一物理拆行的两面，必须同豁免否则互相救不回来。 |
| 调用位于 JSX 属性/表达式内，或实参本身是 JSX（`onKeyDown={(e)=>{ handleMultilineSubmitKeyDown(e, () => …, {…}) }}`、`createPortal(<div…>, container)`、`{formatHitRate(…)}`） | **豁免（E2）** | 16 | 锚点点名「深嵌 JSX 内联回调」。prettier 对 JSX 实参/JSX 内回调的标准格式就是拆行；一行规则本意是逻辑代码可读性，不是逼 JSX 对齐。 |
| 成员链调用（`s.replace(…).replace(…)…`、`[...].filter(Boolean).join(" ")`、`parsed.map(…).filter(…).join(…)`） | **豁免（M2，判据修正）** | 22 | 规则误伤：链的每个实参都紧跟在自己的调用点（`.filter(` 之后）上，「参数列表」并没有拆——被拆的是链本身。现行 firstArgMoved 拿「调用起始行」当基准，对成员调用等于拿链首 token 当基准，语义错位。典型重复计数：escapeHtml 一条语句记 4 条、class 拼接一条记 2 条（见 §2.2）。 |
| 纯逻辑调用实参拆行（`createWorkspaceEntry(target,'file',value,projectId,sessionId)` 5 参、`Math.max/min` 2 参、`setX(长布尔/三元)`、`window.dispatchEvent(new CustomEvent(…))`、`new Set(chain)`、`ipcAppUiSet(k, v)`、`console.warn(msg, err)` 等） | **收一行** | 84 | 与 core 同规则。展平长度 41–158 字符（4 处 >200 见 §3.3），全部可并一行或经轻量重构后一行；core 现状零此形态，renderer 收敛后 gate 与 core 同水位。 |

### 1.2 VARDECL（119）

| 形态 | 判定 | 处数 | 理由 |
| --- | --- | --- | --- |
| `await` 包裹的多行调用（`const res = await ipcX({…对象实参跨行…})` 38、`await <非 ipc 调用>` 8、`const [a,b] = await Promise.all([…])` 5） | **豁免（M1，判据修正）** | 51 | 规则误伤（fixture 实证）：`const x = fn({\n…\n})` 现行**不报**（checkOneLineValue:185 的 call 宽容分支），`const x = await fn({\n…\n})` 却报——TS AST 里 AwaitExpression 包了一层，call 宽容分支的 `ts.isCallExpression(value)` 探不到内层。同一种调用两种口径，await 不改变「实参是否拆行」这个规则本意；实参拆行归 ARGS 管。 |
| hook 声明 RHS 拆行（`const [a, setA] =\n useState<T \| null>(null)`） | **豁免（E1）** | 8 | 同 ARGS E1，同一物理拆行的另一面。 |
| 条件表达式 RHS 且展平 >200（WorkspaceHeaderActions:94 confirmCopy 对象分支三元、PreviewPane:138 await 三元） | **豁免（E4）** | 2 | prettier-200 必拆，一行状态维持不住；强收必与 prettier 冲突（任务红线）。 |
| 2 分支三元 ≤200（label/hint/aria 文案、`cond ? await a : await b` 等） | **收一行** | 40 | 展平 73–200 字符，一行可读；prettier-200 自检下存活。 |
| 二元链 RHS（`&&`/`||`/`-`，`const canOpen = a || b || c || d`） | **收一行** | 16 | 展平 77–154，全部一行可读。 |
| 成员链/裸调用 RHS 拆行（`(child as {…}).props` 链尾、长调用移行） | **收一行** | 2 | 各 1 处（MermaidMarkdown:404、prompt-macro-input:11），展平 ≤160，一行化可读；其中 call-moved 一行化后实参保持一行（回调体例外由规则自带）。 |

### 1.3 PARAMS（100）

| 形态 | 判定 | 处数 | 理由 |
| --- | --- | --- | --- |
| hook 函数形参解构（useChatMessagesScrollFollow:24，第 2 参 `{ streamingText, … }` 解构） | **豁免（E3）** | 1 | 锚点点名「hook 形参」。解构一行化必出 235 字符签名；hook options 解构是 React 惯用形态。 |
| 组件 props 解构（`({ a, b }: Props)` 跨行） | **豁免（E3，前瞻）** | 0 | 锚点点名，但 renderer 现状 **0 条命中**——组件 props 签名都短到没被报。规则层仍落此豁免分支，防未来组件加 props 时回弹。 |
| 纯逻辑函数签名拆行（1–5 参 + 长类型/内联对象类型：`shouldReloadOnRunFinished(uiRunning, freezeCount, runId)`、`normalizeFenceLang(lang: string \| null \| undefined)`、workspace-actions 全家、useColumnSplitters 辅助函数族、textarea-enter-shortcuts 等） | **收一行** | 99 | 与 core 同规则。签名展平 ≤200 的 88 处直接并一行；>200 的 11 处先抽具名类型（内联对象类型提为具名 interface）/缩参再一行（清单 §3.3）。core 同款签名全部一行，renderer 收敛后无二致。 |

### 1.4 IMPORT（9）

| 形态 | 判定 | 处数 | 理由 |
| --- | --- | --- | --- |
| 1–3 个具名 import 拆行（含单导入拆行：`import {\n IncrementalTokenCounter,\n} from "@shared/logic/format";`） | **按既有 import 规则收一行** | 9 | 规则已自带宽度闸（一行形式 >80 不报），9 条一行形式全部 62–79 字符，逐条并一行即可，无豁免、无规则层改动。 |

### 1.5 ASSIGN（6）

| 形态 | 判定 | 处数 | 理由 |
| --- | --- | --- | --- |
| RHS 为三元大对象（ConversationPanel:588 `streamCallbacksRef.current = readOnly ? {…7 字段…} : {…}`） | **豁免（E4）** | 1 | 展平 >400，prettier-200 必拆。 |
| 赋值 RHS 多参调用拆行（App:272/280/288 `result = await createWorkspaceEntry(…)`/`renameWorkspaceEntry(…)`） | **收一行** | 3 | 与同语句的 ARGS 发现一并消掉，展平 ≤110。 |
| 赋值 RHS 短三元（WorkspaceTree:158、ExplorerPane:72 `dropEffect = types.includes(…) ? "move" : "copy"`） | **收一行** | 2 | 展平 ~78 字符。 |

### 1.6 汇总

| verdict | 豁免 | 收一行 | 计 |
| --- | --- | --- | --- |
| ARGS | 56（hook 18 / jsx 16 / 链 22） | 84 | 140 |
| VARDECL | 61（hook 8 / await 51 / 宽度 2） | 58 | 119 |
| PARAMS | 1 | 99 | 100 |
| IMPORT | 0（按既有规则） | 9 | 9 |
| ASSIGN | 1 | 5 | 6 |
| **计** | **119** | **255** | **374** |

收一行 255 = 240 直接并一行 + 15 处需辅助重构（§3.3）；波 2 完成后 renderer signatures gate 应归零。

## 2. 豁免落地：规则层修改方案

全部落 `tools/nm-style/src/rules/signatures.ts`（不动 KFP、不动其他规则）。理由：KFP 的匹配键是 rule+file+symbol（signatures 走 detail 包含匹配），是**逐条/逐文件**登记机制，做不了形态级豁免；锚点也已点名「按形态豁免比逐条登记好」。M1/M2 属判据修正（规则语义 bug），E1–E4 属形态豁免；两者对 core **零影响**——core 现状 0 findings，豁免/修正只减不增。

> ⚠ spec 同步面：signatures.ts 头注释「五类 verdict：…全阻断、无豁免 verdict（spec §3.3）」需随本表改写；nm-code-style 对应 spec/文档的 §3.3 同步修订为「五类 verdict + 形态豁免（hook/JSX/成员链/await 调用/宽度闸/解构形参）」。KFP 仍保留给**个案规则互斥**（rule-conflict），不做形态豁免的容器。

### 2.1 M1 · await 调用与 call 同口径（消 51 条）

位置：`checkOneLineValue`（signatures.ts:176-187）与 `isBlockExpression`（:170-174）。

```
// 现状：isBlockExpression 已会把 Await/Paren/As/Satisfies/NonNull 解包后再判块形态，
// 但 :185 的 call 宽容分支用的是未解包的 value，await 调用探不到内层 CallExpression。
// 改法：抽出共用解包函数，两个分支都用它。
function unwrapValue(node: ts.Node): ts.Node   // 循环剥 Parenthesized/As/Satisfies/NonNull/Await
// :181  isBlockExpression(value)  → isBlockExpression(unwrapValue(value))
// :185  if (!moved && multiline && (ts.isCallExpression(unwrapValue(value)) || ts.isNewExpression(unwrapValue(value)))) return;
```

行为保持：`moved`（RHS 断到下一行）照报；只有「RHS 起始同行、调用体多行」的 await 调用转为不报，与非 await 版完全同口径。实参拆行仍归 ARGS。

### 2.2 M2 · ARGS「首实参移动」基准修正（消 22 条）

位置：`checkArguments`（signatures.ts:141-155）的 `firstArgMoved`（:150）。

```
// 现状：lineOf(regular[0]) !== lineOf(node.getStart())——对成员调用，「调用起始行」＝链首 token 行，
// 链被换行书写时（s\n  .replace(/a/g, "b")）实参明明紧跟调用点却被判 moved。
// 改法：基准取「实参列表的前界」所在行：
function callSiteLine(node: ts.CallExpression | ts.NewExpression, sf: ts.SourceFile): number {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
    ? lineOf(sf, callee.name.getEnd())      // 成员调用：method 名 token 所在行
    : lineOf(sf, callee.getEnd());          // 直接调用：callee 结束行
}
// :150  firstArgMoved 的比较对象由 lineOf(node.getStart()) 换成 callSiteLine(...)
```

fixture 实证对照（修复后预期）：`s\n .replace(/a/g,"b").replace(/c/g,"d")` 0 报（现为 2 报）；`wrapper(\n 1,\n 2\n)` 仍 1 报（多参真拆行照抓）。

### 2.3 E1 · hook 形态豁免（消 26 条）

位置：`checkArguments`（加在 callbacks/regular 过滤之后、判定之前）+ `checkVariable`。

```
// checkArguments：
if (/^use[A-Z]/.test(node.expression.getText(state.sourceFile))) return;
// checkVariable：
if (ts.isCallExpression(node.initializer) && /^use[A-Z]/.test(node.initializer.expression.getText(state.sourceFile))) return;
```

覆盖 useState/useRef/useMemo/useCallback/useReducer/useContext 及一切 `use*`；`setX` setter 不是 `use*`，照走收一行。不改 `useState` 实参的 regularSplit 判据本身。

### 2.4 E2 · JSX 形态豁免（消 16 条）

位置：`checkArguments`（E1 判定之后）。

```
function isJsxContext(node: ts.CallExpression | ts.NewExpression, args: readonly ts.Expression[]): boolean {
  for (let cur: ts.Node | undefined = node.parent; cur != null; cur = cur.parent)
    if (ts.isJsxAttribute(cur) || ts.isJsxExpression(cur)) return true;
  return args.some((a) => ts.isJsxElement(a) || ts.isJsxSelfClosingElement(a) || ts.isJsxFragment(a)
    || (ts.isParenthesizedExpression(a) && (ts.isJsxElement(a.expression) || ts.isJsxSelfClosingElement(a.expression))));
}
// checkArguments：if (isJsxContext(node, args)) return;
```

### 2.5 E3 · 解构形参豁免（hook / 组件 props，消 1 条 + 前瞻）

位置：`checkParameters`（signatures.ts:131-139）。

```
function isDestructuredParam(node: ts.FunctionLikeDeclaration): boolean {
  return node.parameters.some((p) => !ts.isIdentifier(p.name));
}
function isJsxBody(node: ts.FunctionLikeDeclaration): boolean {
  // 组件启发式：函数体顶层（含最外层 return）直接产出 JSX
  if (node.body == null) return false;
  return ts.isJsxElement(node.body) || ts.isJsxFragment(node.body) || ts.isJsxSelfClosingElement(node.body)
    || /return\s*\(?\s*</.test(node.body.getText(state.sourceFile));   // 取体首层 return，不深扫
}
// checkParameters 的 split 判定之后：
const fnName = functionName(node, state.sourceFile);
if (isDestructuredParam(node) && (/^use[A-Z]/.test(fnName) || isJsxBody(node))) return;
```

非解构形参（本表 99 条收一行桶的主体）不受影响；纯逻辑函数解构形参若未来出现且非 hook/组件，仍照报。

### 2.6 E4 · 宽度闸（消 3 条：VARDECL 2 + ASSIGN 1）

位置：`checkOneLineValue`（signatures.ts:176-187），M1 之后、report 之前。

```
const SIGNATURES_FLAT_LIMIT = 200;   // 与 scripts/prettier-guard.mjs 的工作宽度同源；建议 export 出来并注释出处
// 非 call RHS（M1 未放行的 ternary/binary/member/字面量等）：
const flat = indentOf(state.sourceFile, startLine) + value.getText(state.sourceFile).replace(/\s+/g, " ").length;
if (!isCallLike && flat > SIGNATURES_FLAT_LIMIT) return;   // prettier-200 必拆，一行状态维持不住
```

覆盖 WorkspaceHeaderActions:94（~470）、PreviewPane:138（~230）、ConversationPanel:588（~400）。≤200 的 ternary/binary 照报（这正是 58 条收一行的闸门依据）。

### 2.7 判据实证记录（合成 fixture，tmp-r7-fixture.ts）

| 案例 | 现行行为 | 与裁决的关系 |
| --- | --- | --- |
| `const x = fn({\n a:1, b:2 \n})` | 0 报 | 证明 call 宽容分支存在，M1 只是把 await 版拉齐 |
| `const x = await fn({\n a:1, b:2 \n})` | VARDECL 1 报 | M1 消除的误伤实锤 |
| `wrapper(\n 1,\n 2 \n)` | ARGS 1 报 | 多参真拆行照抓，M1/M2 不放走它 |
| `s\n .replace(/a/g,"b")\n .replace(/c/g,"d")` | ARGS 2 报 | M2 消除的误伤实锤 |
| `const [foo,setFoo] =\n useState<T>(null)` | VARDECL 1 报 | E1 消除对象实锤 |
| `useState<Foo>(同一行短实参)` | 0 报 | hook 实参同行时本就不报，E1 只兜拆行版 |

### 2.8 测试与验证面（波 2 必做）

- `tools/nm-style/test/signatures.test.mjs`：补 M1/M2/E1–E4 正反用例（至少：await 多行对象 0 报、链 0 报、多参拆行仍报、hook ARGS/VARDECL 0 报、JSX 实参 0 报、hook 解构形参 0 报、>200 ternary 0 报、≤200 ternary 仍报）。
- 回归：`node tools/nm-style/bin/nm-style.mjs check packages/core --json` signatures 保持 0；`check apps/desktop/renderer` signatures 落到 255（= 收一行桶）。
- 清理完成后：逐文件 `node scripts/prettier-guard.mjs -- --check --print-width 200 <file>` 自检（任务红线：不跑全局 prettier）。

## 3. 收一行桶：文件清单与预估处数

### 3.1 top 文件（255 处 / 71 文件）

| 处数 | 文件 |
| --- | --- |
| 24 | apps/desktop/renderer/hooks/useColumnSplitters.ts |
| 15 | apps/desktop/renderer/features/chat/ConversationPanel.tsx |
| 15 | apps/desktop/renderer/App.tsx |
| 13 | apps/desktop/renderer/features/workspace/workspace-actions.ts |
| 12 | apps/desktop/renderer/features/chat/ChatComposer.tsx |
| 10 | apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx |
| 9 | apps/desktop/renderer/layout/preview-recogito.ts |
| 8 | apps/desktop/renderer/components/MermaidMarkdown.tsx |
| 7 | apps/desktop/renderer/features/workspace/WorkspaceTree.tsx |
| 6 | apps/desktop/renderer/components/code-block.tsx ／ features/chat/conversation-abort-retain.ts ／ features/chat/ToolCallCard.tsx（并列） |

其余 60 文件合计 118 处（1–5 处/文件）。注意一条语句可能对应多条 finding（链式调用嵌套每层一报：escapeHtml 两处各 4 条、class 拼接三处各 2 条）——按语句并一行后 finding 数多于语句数是正常收敛。

### 3.2 直接并一行（240 处）

操作模式：多参调用/签名并一行、RHS 三元/二元链并一行、import 并一行、赋值 RHS 并一行。约束：展平 ≤200（本桶全部达标）；改完每文件过 `prettier-guard --check --print-width 200`。

### 3.3 辅助重构（15 处）

| 位置 | 现状展平 | 辅助动作 |
| --- | --- | --- |
| components/ui/codemirror-theme.ts:6（ARGS，EditorView.theme 巨型配置对象） | ~500 | 实参起始收回调用行（`EditorView.theme({` 同行，对象体保持多行）——规则即过，prettier-200 不重拆 |
| features/chat/ConversationPanel.tsx:767+768（ARGS ×2，同一嵌套语句 setComposerAttachments(applyUndoAnnotateRestore(…))） | ~210 | 内层调用抽具名局部（如 `const restored = applyUndoAnnotateRestore(…)`，一行放不下再按参拆具名中间量），外层一行 |
| ipc/invoke-registry.ts:299（ARGS，withReq<{6 字段内联类型}, …>） | ~290 | 内联请求类型抽具名（CloudSyncSetConfigRequest 等），签名行回到 ≤200；invoke-registry 全文件本就是「一行一通道」表，抽类型与表风格一致 |
| hooks/useAgentStreamMetrics.ts:157（PARAMS，347） | 347 | 长参数类型抽具名（指标视图入参打包） |
| features/chat/conversation-abort-retain.ts:93（PARAMS，344） | 344 | options 内联对象类型抽具名（RunFinishedAbortRetainOptions） |
| features/workspace/workspace-actions.ts:251（PARAMS，264） | 264 | 参数类型收窄/抽具名后一行 |
| features/chat/rollback-composer.ts:14（PARAMS，260） | 260 | restore 内联对象类型抽具名（ComposerRestoreSnapshot） |
| features/chat/rollback-annotate-restore.ts:38（PARAMS，250） | 250 | 4 参长 DTO 名抽参数对象或缩短参数名（nm-style §2 原口径） |
| features/workspace/workspace-actions.ts:72（PARAMS，234） | 234 | 5 参打包为具名入参对象（CreateWorkspaceEntryRequest） |
| features/workspace/workspace-actions.ts:55（PARAMS，233） | 233 | 同上（saveFileInclusion 入参对象） |
| features/chat/chat-link-route.ts:54（PARAMS，232） | 232 | deps 内联对象类型抽具名（ChatLinkDeps） |
| features/chat/ConversationPanel.tsx:700（PARAMS，229） | 229 | useCallback 内箭头函数的 options 内联类型抽具名（ExecuteRollbackOptions） |
| features/settings/prompt-macro-input.ts:125（PARAMS，229） | 229 | 返回/入参内联对象类型抽具名（InsertTextAtSelectionResult） |
| features/workspace/workspace-actions.ts:104（PARAMS，212） | 212 | 4 参类型抽具名后一行 |

## 4. 明确不做的事

- 不动 `tools/nm-style/known-false-positives.json`（形态豁免不进 KFP，理由见 §2）。
- 不收 await 单对象实参的 IPC 调用（M1 后规则不再报；其中个别书写散乱的如 ShellNavProvider:743 对象体内有空行，属可整理项，不入 gate 范围）。
- 不跑全局 prettier；波 2 只对触碰过的文件做 `--check --print-width 200` 自检。
- IMPORT 不新增豁免（既有规则宽度闸已正确）。
