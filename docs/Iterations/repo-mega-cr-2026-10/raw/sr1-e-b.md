# sr1-e-b · mega-CR fix-spec wave-e 组 B 审查报告

- **审查对象**：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-e.md`（未入库新文件，md5 `44985935e698c183721fe8d285358a15`，1653 行）
- **仓库 / 基线**：`D:\Dev\nm-worktree\mcr`，HEAD=`fe79b781`
- **本组条目**：X3（WebView 产物门禁）、H1（钩子① 编码扫描）、H3（钩子③ 编码归一）
- **方法**：行号与引文逐处重开代码核对；数字结论全部实测（产物计数用 `node` 逐串统计，包归属用 esbuild `metafile` 的 `inputs` 顺序做字节区间归因；编码用 `TextDecoder(fatal)` 严格解码 + `git ls-files` 全量扫）
- **纪律**：全程只读，未写任何生产/测试/fix-spec 文件；唯一落盘为本报告
- **审查日**：2026-10-01

---

## 1 · 逐条 verdict 表

图例：`OK` = 证据与修法均站得住；`OK*` = 结论对但细节需勘误；`MF` = must-fix（不闭合则 not-ready）

### X3 · WebView 产物门禁（wave-e.md:406-514）

| # | 条目 | 核对结论 | verdict |
|---|---|---|---|
| X3-1 | X3.1 产物实测：`composer-input/app.js` 21 716 字节、`Object.fromEntries` 首现 index=4907、`mountComposerEditor` index=18778 | 两个 index **精确复现**（`code.indexOf` 实测 4907 / 18778）。但「21 716 字节」口径错：该文件磁盘 21 826 字节，21 716 是 UTF-16 码元长度（`s.length`）。 | `OK*` |
| X3-2 | X3.1 命中表（4 包 × 5 构造） | 12 格逐格实测：chat-transcript 6/41/18/12/11 ✅、rich-document 4/37/18/12/11 ✅、composer-input fromEntries=**5** ✅、code-editor `Object.hasOwn=1（CodeMirror）` ❌ —— 该处实为 `Object.prototype.hasOwnProperty.call(...)`（严格正则 `Object\.hasOwn(?!Property)` 命中 **0**）。⇒ code-editor 五个构造真实命中数为 **0**，**「4/4 包命中」应为「3/4」**。另 §X3.1「两个 8MB 大包的主体是第三方库（mermaid / CodeMirror）」中的 CodeMirror 在 1MB 的 code-editor 包里，不在 8MB 包里。 | `MF` |
| X3-3 | X3.1 源码根因链（esbuild metafile 实测） | **完全可复现，逐项吻合**：`composer-input inputs=14 node_modules=0`、`rich-document 775/756`、`code-editor 34/21`、`chat-transcript 926/822`；composer-input 的 5 个 core 模块路径逐字符一致；chat-transcript core=**59**、rich-document/code-editor core=**0**。这节是全篇质量最高的部分。 | `OK` |
| X3-4 | X3.1「一方源码面干净 ⇒ 门 A 零存量债」 | 复现：`git ls-files apps/mobile/src/web apps/mobile/src/webview-host` 共 76 个 ts/tsx，5 个构造命中 **0**。 | `OK` |
| X3-5 | X3.2 门 A 的 `files` glob（`src/web/**` + `src/webview-host/**`） | glob **漏掉实际进包的一方源码**。metafile 归因：`composer-input` 的 14 个 first-party inputs 里有 **3 个在 `src/components/**`**（`agent/prompt-macro-input.ts`、`chat/composer-highlight.ts`、`common/atomic-range-delete.ts`），`code-editor` 也有 1 个（`chat/composer-highlight.ts`）。**N-P0-01 的病根链正是穿过 `src/components/agent/prompt-macro-input.ts`** —— 门 A 对它完全失明。 | `MF` |
| X3-6 | X3.2 门 A「第一天即可 blocking」 | 两个未记录的既有事实：(a) `src/web/tsconfig.json` 的 `lib:["ES2018","DOM"]` **已经在编译期拦掉 4/5 构造** —— 用 `extends` 真 tsconfig 的探针实测报 `TS2550`（fromEntries / at / replaceAll / hasOwn），只有 `structuredClone` 因在 `lib.dom.d.ts` 里而漏网。门 A 的**净增量只有 `structuredClone` + 非类型检查路径**，spec 未记录这层重叠。(b) CI `ci.yml` 的 `Lint` 步骤带 `continue-on-error: true`（实测确认），**门 A 在 X1 摘掉它之前根本不会阻断 CI**；X3.6 依赖节没列 X1。 | `MF` |
| X3-7 | X3.2 门 B「读 `metafile.outputs[outfile].inputs`」 | 这行代码会抛。实测：`outfile` 传绝对路径时，esbuild 的 outputs 键是**相对 cwd 的路径** `webview-dist/composer-input/app.js`，`metafile.outputs[<绝对 outfile>]` 为 `undefined`。另 spec 说「当前已有 `write:false` 探针路径可复用」也不成立：`write:false` 在 `loadWebModule()`（:75，喂 CSS 常量用），`bundleAppJs()`（:107-124）走 `outfile` 落盘，两者是不同函数。 | `MF` |
| X3-8 | X3.2 门 C 的计数口径 | 未定义，且按最自然的子串口径会大面积误计。实测：chat-transcript 的 first-party 命中里，`replaceAll` 出现在 `packages/core/dist/domain/tool/builtin/{skill-tool,vfs-tools}.js`，共 9 处 —— 逐处打开确认**全是 zod 字段名与描述文本**（`replaceAll: z.boolean()`、`input.replaceAll`、`（可配 replaceAll）`），**没有一处是 `String.prototype.replaceAll` 调用**。门 C 若按 `replaceAll` 子串计数，基线里就固化了 9+41 的伪信号；上游改个字段名就棘轮红。 | `MF` |
| X3-9 | X3.3 门 C 牙齿：「把 composer-input 的 `Object.fromEntries` 计数改成 6 → 期望 build 失败」 | **方向反了**。规则是「任何计数上升即 fail」，基线现值 5；把基线改成 6 表示实际值 5 **低于**基线（下降），按规则**不会红**。要造红必须把基线改成 **4**。 | `MF` |
| X3-10 | X3.3 门 A / 门 B 牙齿 | 门 A 牙齿（post.ts 插 `Object.fromEntries`）可执行；门 B 牙齿也成立 —— 实测 esbuild 能从 `src/web/composer-input/webview/runtime` 解析 `@novel-master/core/vfs`（`packages/core/package.json:57` 有该 exports），会把白名单外 core 模块拖进包。唯一问题见 X3-5/X3-7。 | `OK*` |
| X3-11 | X3.4 测试策略与牙齿三判据 | 三判据自检诚实（承认「源码里加一个 fromEntries ⇒ 门 A 红」与门 B 牙齿是两回事）；`eslint . --max-warnings 321` 与「error 不计入 warnings」的判断实测正确。 | `OK` |
| X3-12 | X3.5 回归线 | 逐条核对存在且真实：`npm run typecheck` 确含 `tsc -p src/web/tsconfig.json`；mobile `pretest` 确实调 `build:webview`（故门 B/C 在 CI blocking 的 `Test` 步骤里会被跑到）；`checkWebViewAssets`、`8 个套件` 出处都在 RULE。 | `OK` |
| X3-13 | X3.6 依赖 | 依赖「Wave A 的 N-P0-01 修法」，但 `fix-spec/state.md:19` 显示 `s-wave-a` 仍 `pending`、`wave-a.md` **尚不存在**。且未记 X1 依赖（见 X3-6b）。依赖未闭合。 | `MF` |

### H1 · 钩子① 编码扫描（wave-e.md:608-652）

| # | 条目 | 核对结论 | verdict |
|---|---|---|---|
| H1-1 | H1.1 U+FFFD 9 个文件清单 | 逐个复现，文件名全部正确（core src 4 + core test 3 + mobile 1 + desktop 1）。 | `OK` |
| H1-2 | H1.2 口径修正：「`apps/mobile/src` 只剩 1 个文件、**约 24 处** U+FFFD，与 178 差两个数量级」 | **结论错误，且是从错误数据推出的**。实测 `session-prompt-input.service.ts` 的 U+FFFD **恰好 178 处**（分布在 26 行），与台账 ledger-v2.md:439 的「178 个」**完全吻合**。既不是 24 处，也不是 26 行。spec 据此断言「批次 1 已在别的分支部分执行 / 178 是历史某提交」并推出 `(a)/(b)` 两解 —— 两解都不成立。这条错误会直接误导 Wave A 编码批次的规模估算。 | `MF` |
| H1-3 | H1.1 BOM 共 20 个文件 | 总数 20 复现（core/src 4 + core/test **14** + core/docs 1 + sksp-android/test 1）；但正文写「`packages/core/test/` 下 **15** 个」，实测 **14**（`git ls-files packages/core/test` 逐个验 BOM 头）。同节的「`apps/` 下 0 个」✅。 | `OK*` |
| H1-4 | H1.1「仓库根无 husky/lefthook、`.github/` 只有 3 个 workflow、无编码扫描步骤」 | 三条全部实测成立。 | `OK` |
| H1-5 | H1.1「损坏位置全部在注释或 `it()` 标题里，无运行时字符串」 | 逐行核对成立：desktop vfs.ts:2/:81 是 JSDoc 注释；agent-runner.test.ts:294 是 `it()` 标题；`session-prompt-input.service.ts:110-114` 是 GBK 乱码注释行。 | `OK` |
| H1-6 | H1.3 Step 1 的排除清单 | **排除清单不完整，会导致门禁恒红**。脚本扫描 `apps/` + 后缀含 `.gradle`，排除项写的是 `android/app/build/`（带尾斜杠的目录）。`apps/mobile/android/app/build.gradle` 的路径串**不含** `android/app/build/` ⇒ 会被扫到；实测该文件有 **20 处 U+FFFD**，且 `TextDecoder(fatal)` 判定**非合法 UTF-8**（RULE:113 已记它是 GBK 混编）。spec 的 9 文件基线是在 `apps/*/src` 范围测的，与脚本实际扫描范围不一致。 | `MF` |
| H1-7 | H1.3 Step 1.2「区分『原本就含 FFFD』与『解码失败』」 | 这个设计点是对的、也是本条最有价值的一处。但实测 9 个文件里有 **4 个是解码失败而非含 FFFD**：`session-prompt-input.service.ts`(178)、`ref-to-env.ts`(1)、`secret-store.port.ts`(1)、`message-body-text.test.ts`(3)；另 `tool-definitions.ts`/`composite-secret-store.ts`/`agent-runner.test.ts`/`openai-content-mapper.test.ts`/`vfs.ts` 是合法 UTF-8 内嵌真 FFFD。 | `OK` |
| H1-8 | H1.3 Step 4 清账修法 | 对 4 个**非合法 UTF-8** 的文件，「用 Edit 工具做字节级安全替换把 FFFD 换成正确字符」**在技术上不成立** —— 文件里根本没有 U+FFFD 这个码点，坏的是原始字节。这些文件只能从父提交整体还原（与台账「从父提交还原」一致），不能逐字符替换。spec 未区分这两类。 | `MF` |
| H1-9 | H1.3 Step 2 钩子 / Step 3 CI 步骤 | 可行：`.githooks/` 当前不存在；根 `package.json` 当前无 `prepare`（可加）；`ci.yml` 的 `Format` 步骤存在，Encoding 插在其后可跑；`.githooks/pre-commit` ASCII-only 的提醒与 RULE:84/113 一致。 | `OK` |
| H1-10 | H1.6 回归线 `npm run format:check` | **这条线对本条的改动面无效**。实测全仓只有 `apps/mobile/package.json:12` 定义了 `format:check`；`packages/core` **没有** `format:check` 脚本、也没有 `.prettierrc`。而本条要改的 4 个 core BOM 文件 + 20 个 BOM 全在 `packages/`。另外实测 prettier **保留** BOM（对带 BOM 输入 `format()` 出来的文本仍以 BOM 开头），所以 spec 那句「反之 prettier 不得把 BOM 加回来」是空转。 | `MF` |
| H1-11 | H1.7 依赖 | `blocked-by-decision(★5)` 标注正确（ledger-v2.md:325）；「core 的 4 个 BOM 与 7 个 U+FFFD 不受 ★5 阻塞」的拆分与台账一致。 | `OK` |

### H3 · 钩子③ 编码归一（wave-e.md:890-999）

| # | 条目 | 核对结论 | verdict |
|---|---|---|---|
| H3-1 | H3.1 全部证据行号与引文 | 逐条重开核对，全部命中：`apps/desktop/renderer/features/skills/skill-ui.ts:21-35` ✅（引文四行逐字一致）、`apps/mobile/src/components/skills/skill-ui.ts:48-50 / 53-58` ✅、`packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:26-29` ✅、desktop `skill-ui.ts:37-38` 注释 ✅。 | `OK` |
| H3-2 | H3.1 病症举例「description 里带 `:`（如「用途：调研」），YAML 就被解析成嵌套 map 或抛错」 | **举例不成立**。用真 `parseSkillFrontMatter` 跑 desktop 裸插值模板：输入 `用途：调研`（**全角冒号 U+FF1A**）⇒ `valid=true`、`description` 原样回来，**不复现**。真正触发的是**半角** `": "`：`用途: 调研` / `a: b` ⇒ `valid=false`（`Nested mappings are not allowed in compact mappings`）；另有换行、`#h`、`- d` 触发。病症方向对（全角/半角之分是 spec 自己没分），但作为验收用例的输入是错的（见 H3-5）。 | `MF` |
| H3-3 | H3.1「YAML 就被解析成嵌套 map 或**抛错**」 | 半角冒号下 `parseText` 抛 `ConfigDecodeError`，但 `parseSkillFrontMatter` 用 try/catch 兜住并返回 `valid:false` + `invalidReason`，**对外不抛**。spec 同节自己也写了「解析失败不抛错」，前后不一致。 | `MF` |
| H3-4 | H3.2 Step 1-4 修法可行性 | 全部可行，且依赖闭合已实测：`@novel-master/core/skills` 在 `packages/core/package.json:93` 与 `packages/core/tsconfig.test.json:29` **双侧已存在**（spec 判断 ✅）；`packages/core/test/skills/` 目录存在；`packages/core/src/public/skills.ts` 存在。加新 export **不会破任何快照**：`public-subpath-allowlist.test.ts:5-18` 的 `SUBPATHS` 12 项里**不含 `skills`**，`main-entry-allowlist` 只管主入口，`public-no-config-forms` 只查 config-forms 依赖 ⇒ 无需改快照（spec 未提但结论是好的）。**唯一风险**：mobile 端 `__tests__/skill-info-edit-modal-contract.test.ts:85-87` 用正则 `/export \{withSkillFrontMatterValues\} from '@novel-master\/core\/skills'/` 锁死了 `skill-ui.ts` 的**精确再导出形态**；Step 4 若把两个符号合并成一条 `export {a, b} from ...`，该契约测试立刻红。spec 未提。 | `OK*` |
| H3-5 | H3.4 用例 1「`description 含冒号` ⇒ `buildNewSkillDoc("s","用途：调研")` → `valid===true`」 | **用例无牙齿**。按 H3-2 的实测，这个输入在**有 bug 的 desktop 裸插值实现上同样 `valid===true`** ⇒ 把 `yamlScalar` 换回裸插值，用例 1 仍绿，spec 自评的「牙齿三判据① 有牙吗 ⇒ 成立」不成立。必须改成半角 `用途: 调研`（或 `a: b`）。用例 2（含换行/井号）反倒是有牙的（换行与 `#h` 在 desktop 版确实红）。 | `MF` |
| H3-6 | H3.3 验收命令 | `cd packages/core; npx tsx --test test/skills/build-new-skill-doc.test.ts` 可跑 —— 实测不带 `--tsconfig tsconfig.test.json` 直跑 `test/skills/parse-skill-front-matter.test.ts` 与 `with-skill-front-matter-values.test.ts` 均全绿（后者 import `@novel-master/core/skills` 会解析到已构建的 `dist`，这是既有测试的既有形态，非本条引入）。 | `OK` |
| H3-7 | H3.5 依赖「与 X1 的 `shared/logic/skills.ts` 转发扩充同一文件 ⇒ 建议与 X1 Step 1 同 PR」 | **事实错误**。X3 之外重读 wave-e.md:129-139，X1 Step 1 只动 `shared/logic/{events,chat,provider}.ts` 三个文件，**根本没碰 `skills.ts`** ⇒ 不存在 spec 所说的同文件冲突。 | `MF` |
| H3-8 | H3.4「desktop 有 skill-ui 相关单测吗 —— 落地时确认」 | 现在就能答，spec 不该留成待确认：`apps/desktop/test/` 下与 skill 相关的只有 `skill-zip-import.test.tsx`（覆盖 `withSkillFrontMatterValues`，**不覆盖 `buildNewSkillDoc`**）与 `skills-handlers.test.ts`；**desktop 侧没有任何 `buildNewSkillDoc` 测试**。mobile 侧则有两条源码契约测试读 `skill-ui.ts`（见 H3-4）。 | `OK*` |

---

## 2 · 「三门设计」论断的实测核对（撰写机位自报：WebView 门禁『出现即 fail』不可实施，4/4 包先天命中第三方库）

### 2.1 论断①：4 个 bundle 里禁用构造是不是真的先天存在？—— **部分不成立：是 3/4，且 code-editor 那格是误判**

产物实测（`node` 逐串统计，磁盘文件非缓存）：

| 包 | 体积 | `Object.fromEntries` | `replaceAll` | `.at(` | `Object.hasOwn` | `structuredClone` |
|---|---:|---:|---:|---:|---:|---:|
| chat-transcript | 8 668 286 B | 6 | 41 | 18 | 12 | 11 |
| rich-document | 8 145 635 B | 4 | 37 | 18 | 12 | 11 |
| code-editor | 1 004 952 B | 0 | 0 | 0 | **0** | 0 |
| composer-input | 21 826 B | 5 | 0 | 0 | 0 | 0 |

与 spec 表逐格对照：chat-transcript / rich-document / composer-input **12 格中 11 格完全一致**；唯一不一致的是 code-editor 的 `Object.hasOwn`。spec 标注该格为「**1**（CodeMirror）」，实测那一处是：

```js
if (Object.prototype.hasOwnProperty.call(json2, prop)) {   // @codemirror/language 的 jsonParse
```

即 `Object.hasOwnProperty`（ES5 全兼容），被朴素的 `Object.hasOwn` 子串计数误伤。严格正则 `Object\.hasOwn(?!Property)` 在 code-editor 上命中 **0**。⇒ **「4/4 包先天命中」应为「3/4」**。

**结论不变**：3/4 已足以否掉「出现即 fail」，改设计的方向是对的。但支撑数字要改，且必须写清匹配语义（这是 X3-8 门 C 口径缺失的根因）。

### 2.2 论断②：命中是不是「第三方库」？—— **成立，但归属要精确到「谁在 bundle 里」**

用 esbuild `metafile` 的 `inputs` 出现顺序做字节区间归因（`bytesInOutput` 累加），再对一方输入逐文件开源码复核：

- **rich-document**：5 个构造的命中 **100% 落在 `node_modules`**（mermaid 核心 chunk、khroma、cytoscape、d3 系、zod）。first-party 命中 **0**。spec 的判断 ✅。
- **chat-transcript**：一方命中只有 9 处，全部来自两个 core dist 模块：
  - `packages/core/dist/domain/tool/builtin/skill-tool.js` → `replaceAll` ×4
  - `packages/core/dist/domain/tool/builtin/vfs-tools.js` → `replaceAll` ×5
  逐处打开确认：**这 9 处全是 zod 字段名与中文描述文本**（`replaceAll: z.boolean().optional().describe(...)`、`{ oldString, newString, replaceAll: input.replaceAll }`、`（可配 replaceAll）`），**没有一处是 `String.prototype.replaceAll` 调用**。
- **composer-input**：5 处 `Object.fromEntries` 全部来自 `packages/core/dist/domain/provider/logic/builtin-providers.js`，且 `BUILTIN_DEFAULT_API_KEY_BY_KEY = Object.fromEntries(...)` 位于模块顶层 → esbuild 直接内联到 IIFE 顶层 → **P0 机理链完整成立**（spec 判断 ✅）。

**对「误报率论证」的补强**：现有证据比 spec 写的更强 —— 两个 8MB 包的命中不只「99% 第三方」，而是「**100% 第三方 + 我方 9 处伪信号（字段名）**」。也就是说 naive 子串计数的误报不是「可能」，而是**已经在发生**。门 C 的基线若按 spec 的「统计 5 个构造计数」实现，第一天就会把 9 处字段名固化进去。

### 2.3 论断③：三门设计每道门可测吗？—— 门 A 可测但有覆盖漏洞，门 B 的实现代码有 bug，门 C 的牙齿方向反了

| 门 | 可测性 | 实测结论 |
|---|---|---|
| **门 A**（源码级 ESLint） | ✅ 机制可行 | **但 glob 漏 `src/components/**`** —— metafile 证明 `composer-input` 包里有 3 个一方文件在 glob 外，`code-editor` 有 1 个，而 `src/components/agent/prompt-macro-input.ts` **正是 N-P0-01 病根链的必经点**。门 A 对原 P0 完全失明。另外 5 个构造中 4 个已被 `src/web/tsconfig.json` 的 `lib:ES2018` 在编译期拦掉（`TS2550` 实测），门 A 的净增量只有 `structuredClone`（在 `lib.dom.d.ts` 里，编译期不拦）；且 CI `Lint` 带 `continue-on-error: true`，门 A 在 X1 之前不阻断。 |
| **门 B**（core 依赖准入白名单） | ✅ 机制可行，❌ 实现有 bug | 白名单初值与实测**完全吻合**（composer-input 5 条 / chat-transcript 59 条 / 其余空），这是本条最扎实的设计。但 spec 的实现指令 `metafile.outputs[outfile].inputs` 会拿到 `undefined`（outputs 键是相对路径）；「已有 `write:false` 探针路径可复用」也指错了函数（`write:false` 在 `loadWebModule`，不在 `bundleAppJs`）。 |
| **门 C**（产物计数棘轮） | ⚠️ 口径未定义 | 计数语义缺失导致不可测（见 2.2）。且 spec 自己的牙齿「基线 5 改成 6 ⇒ 期望失败」**方向反了**，规则是「上升即 fail」，5 低于 6 不会红；应改成 4。 |

### 2.4 编码扫描钩子的排除清单是否写全？—— **没写全，会恒红**

spec §H1.3 Step 1 的扫描面：`apps/` `packages/` `scripts/`，后缀白名单含 `.kt/.java/.gradle`，排除 `node_modules/ dist/ webview-dist/ android/app/build/ coverage/ .git/`。

按此规则实跑，会多命中两类 spec 基线里没有的文件：

1. **`apps/mobile/android/app/build.gradle`** —— 20 处 U+FFFD，`TextDecoder(fatal)` 判非合法 UTF-8（RULE:113 已记它是 GBK 混编、必须字节级替换）。排除项写的是 `android/app/build/`（目录），路径串 `apps/mobile/android/app/build.gradle` **不含**该串 ⇒ 命中。spec 的「9 个文件」基线是在 `apps/*/src` 范围测的，与脚本范围不一致。
2. **`docs/` 未纳入扫描面**，但实测 `docs/Iterations/` 下有 3 个 BOM（`post-1.3.14-code-review/prd.md`、`rollback-revision-head-backfill/{prd,spec}.md`）+ 2 个 FFFD（`mobile-chat-composer-annotate-ux/prd.md`、`cr-fix-spec/review/phase0/knip-raw-output.txt`）。不算错（范围是 spec 自己定的），但 spec 没声明「docs 不在范围内」，读者会误以为全仓干净。

**另一个真问题**（spec 的设计点对、修法错）：9 个 U+FFFD 文件里 **4 个是非法 UTF-8**（`session-prompt-input.service.ts`、`ref-to-env.ts`、`secret-store.port.ts`、`message-body-text.test.ts`），坏的是原始字节而非码点。这类文件无法靠「替换 FFFD」修，只能从父提交整体还原 —— 而 §H1.3 Step 4 恰恰写的是逐字符 Edit 替换。

### 2.5 验收可测（牙齿三判据）· 测试策略 · 回归线 · 依赖闭合

| 检查项 | 结论 |
|---|---|
| **门禁类条目断言「故意塞入必红」** | 门 A 牙齿写了（post.ts 插 `Object.fromEntries`）✅ 但覆盖面不全（X3-5）；门 B 牙齿写了（`import '@novel-master/core/vfs'`）✅ 且实测该 specifier 可解析；门 C 牙齿**方向反了**（X3-9）❌；编码门禁牙齿两条都写了 ✅；`.githooks` 的 `core.hooksPath` 未配则静默失效，spec 已在风险表承认并给了三条缓解 ✅。 |
| **测试策略真实存在** | X3：门 A 走既有 mobile lint（`eslint . --max-warnings 321`，实测确认）、门 B/C 改 `build-webview.mjs` + 新增 baseline JSON，均可落地。H1：明说「不写单测，靠故意破坏」，符合本仓惯例。H3：4 个用例 + 1 个结构锁用例，用例名/断言具体。 |
| **回归线真实存在** | X3 三条全部实测存在（typecheck 含 web tsconfig / `pretest` 会跑 `build:webview` / `checkWebViewAssets`）。H3 三条存在（core/desktop 全量 + mobile `--maxWorkers=2`）。**H1 的 `npm run format:check` 是空转** —— 全仓只有 `apps/mobile` 定义了该脚本，`packages/core` 既无脚本也无 prettier 配置，而本条改的全在 `packages/`（MF，见 H1-10）。 |
| **依赖闭合** | X3 依赖 wave-a 的 N-P0-01，但 `state.md:19` 显示 `wave-a.md` 尚未撰写；X3 还漏记了 X1 依赖（门 A 要真阻断必须先摘 `continue-on-error`）。H1 的 ★5 依赖标注正确。**H3 的依赖陈述有一处事实错误**：X1 Step 1 只动 `events/chat/provider.ts`，从未碰 `skills.ts`（MF，见 H3-7）。 |

---

## 3 · must-fix 清单

| ID | 位置 | 问题 | 建议改法 |
|---|---|---|---|
| **MF-1** | wave-e.md:441-447（X3.1 表 + §0 表「4/4 包命中」） | code-editor 的 `Object.hasOwn=1` 实为 `Object.hasOwnProperty`（严格匹配命中 0）⇒ 应为 **3/4**；同节「8MB 大包含 CodeMirror」也不实 | 表中 code-editor 该格改 `—`；§0 与 §X3.1 的「4/4」改「3/4」；补一句匹配语义（`Object.hasOwn` 必须带负向断言排除 `hasOwnProperty`） |
| **MF-2** | wave-e.md:457-461（X3.2 门 A `files`） | glob 漏 `src/components/**`，而 `src/components/agent/prompt-macro-input.ts` 是 N-P0-01 病根链必经点；metafile 证明 composer-input 包内 3 个、code-editor 包内 1 个一方文件在 glob 外 | glob 扩为 `src/web/**` + `src/webview-host/**` + `src/components/**`（或按 metafile 实测的一方输入清单落白名单），并补「门 A 覆盖不到 `packages/core/dist`」的显式声明 |
| **MF-3** | wave-e.md:417-424 + 539-545（门 A 定位 + X3.6） | 未记录两件既有事实：① `src/web/tsconfig.json` 的 `lib:ES2018` 已编译期拦掉 4/5 构造（实测 `TS2550`），门 A 净增量只有 `structuredClone`；② CI `Lint` 带 `continue-on-error: true`，门 A 在 X1 之前不阻断 | X3.1 补一段「既有 typecheck 门与门 A 的重叠/互补」；X3.6 依赖节显式加 `X1（摘 continue-on-error）` |
| **MF-4** | wave-e.md:431（门 B「读 `metafile.outputs[outfile].inputs`」） | outputs 键是相对 cwd 路径（`webview-dist/<pkg>/app.js`），用绝对 `outfile` 取值得 `undefined` → `.inputs` 抛错 | 改为 `Object.values(metafile.outputs)[0].inputs`（或用相对 outfile 作键）；同时删掉「当前已有 `write:false` 探针路径可复用」—— `write:false` 在 `loadWebModule()`，`bundleAppJs()` 走 `outfile` |
| **MF-5** | wave-e.md:448-452（门 C 计数口径） | 口径未定义；按子串计会把 core 的 9 处 `replaceAll` **字段名/描述文本**固化成基线（实测证据见 §2.2） | 明确计数语义为「调用点」而非子串：`.replaceAll(` / `Object.fromEntries(` / `Object.hasOwn(` / `structuredClone(` / `X.at(`，并在 spec 里贴出这 9 处伪信号作为「为什么不能子串计」的证据 |
| **MF-6** | wave-e.md:470（门 C 牙齿） | 方向反了：基线 5 改 6 = 实际值低于基线，按「上升即 fail」**不会红** | 改为「把基线改成 **4** ⇒ 期望 `npm run build:webview` exit 1」 |
| **MF-7** | wave-e.md:653 / 690 / 731（H1.2 口径修正 + Step 4 + H1.7） | 「约 24 处，与 178 差两个数量级」错误：`session-prompt-input.service.ts` 实测**恰好 178 处 / 26 行**，与台账 :439 的 178 **完全吻合**；由此推出的「批次 1 已部分执行 / 178 是历史值」两解均不成立 | 删掉整段错误口径修正，改为「实测与台账一致」；178 这个数字保留并作为 Wave A 编码批次的规模依据 |
| **MF-8** | wave-e.md:571-576（H1.3 Step 1 排除清单） | 排除清单不完整 ⇒ 门禁恒红：`apps/mobile/android/app/build.gradle` 有 20 处 U+FFFD、非合法 UTF-8（RULE:113 GBK 混编），路径不含排除串 `android/app/build/`；且 spec 的 9 文件基线是在 `apps/*/src` 范围测的，与脚本范围不一致 | 排除项加 `apps/*/android/**`（或至少 `**/build.gradle`）并注明理由（GBK 混编，见 RULE:113）；基线数字改为「按脚本真实扫描范围重测」后的值；顺带声明 `docs/` 不在范围内 |
| **MF-9** | wave-e.md:594-603（H1.3 Step 4 清账） | 对 4 个**非合法 UTF-8** 的文件（`session-prompt-input.service.ts`、`ref-to-env.ts`、`secret-store.port.ts`、`message-body-text.test.ts`），「Edit 字节级替换把 FFFD 换成正确字符」不成立 —— 文件里没有 U+FFFD 码点，坏的是原始字节 | Step 4 分两类写：合法 UTF-8 内嵌 FFFD 的 5 个走 Edit 精确替换；非法 UTF-8 的 4 个走「从父提交整体还原 + `git diff --numstat` 逐行核对」 |
| **MF-10** | wave-e.md:634（H1.6 回归线 `npm run format:check`） | 该回归线对本条改动面**无效**：全仓只有 `apps/mobile/package.json:12` 定义 `format:check`，`packages/core` 无脚本也无 `.prettierrc`；而本条改的 20 个 BOM + 9 个 FFFD 全在 `packages/`。另实测 prettier **保留** BOM（带 BOM 输入 format 后仍以 BOM 开头），「prettier 不得把 BOM 加回来」是空转 | 换成可执行的回归线（如「改动文件 `git diff --numstat` 只含目标行」+ core/desktop/mobile 三包 `npm test`）；或删掉 prettier 那句 |
| **MF-11** | wave-e.md:789-793（H3.1 病症举例） | 「`用途：调研` ⇒ YAML 被解析成嵌套 map 或抛错」不成立：全角冒号 U+FF1A 下 desktop 裸插值模板实测 `valid=true`；真正触发的是**半角** `": "`（或换行 / `#` / `- `）。同节「抛错」也不对 —— `parseSkillFrontMatter` try/catch 后返回 `valid:false`，对外不抛 | 举例换成半角 `用途: 调研`；同节把「抛错」改为「返回 `valid:false` + `invalidReason`」（与本节自己写的「解析失败不抛错」对齐） |
| **MF-12** | wave-e.md:874（H3.4 用例 1） | **用例无牙齿**：输入 `用途：调研` 在有 bug 的 desktop 裸插值实现上同样 `valid===true` ⇒ 撤掉 `yamlScalar` 用例 1 仍绿，spec 自评的牙齿判据①不成立 | 用例 1 的输入改为半角 `用途: 调研`（或 `a: b`），并保留 `description` 原样回读的断言 |
| **MF-13** | wave-e.md:848-854（H3.2 Step 4 mobile 端） | 未识别既有契约测试约束：`apps/mobile/__tests__/skill-info-edit-modal-contract.test.ts:85-87` 用正则 `/export \{withSkillFrontMatterValues\} from '@novel-master\/core\/skills'/` 锁死 `skill-ui.ts` 的精确再导出形态；把两个符号合并成 `export {a, b} from ...` 会让该测试立刻红 | Step 4 加一句纪律：`skill-ui.ts` 必须保留 `export {withSkillFrontMatterValues} from '@novel-master/core/skills';` 这一条独立语句，不得合并；H3.4 回归线点名该测试文件 |
| **MF-14** | wave-e.md:889-891（H3.5 依赖） | 事实错误：X1 Step 1 只动 `shared/logic/{events,chat,provider}.ts`，**从未碰 `skills.ts`** ⇒ 不存在 spec 所说的「同一文件两处改动、分开 PR 必冲突」 | 删掉该冲突陈述与「建议同 PR」；若仍要同 PR，理由改为「同一迭代、便于一次回归」而非文件冲突 |
| **MF-15** | wave-e.md:539-545（X3.6 依赖） | 依赖未闭合：`fix-spec/state.md:19` 显示 `s-wave-a` 仍 `pending`、`wave-a.md` 不存在，门 B 白名单收紧挂在未撰写的分片上 | 依赖节注明「wave-a.md 未落盘前，门 B 的 `composer-input` 白名单按 §X3.1 的 5 条原样上线（spec 已有此回退方案，需在依赖节正式写成 gate 条件）」 |

---

## 4 · 结论

**组 B：No-Go。**

一句话理由：改三门设计的**方向与主要证据都站得住**（3/4 包确实先天命中、`rich-document` 命中 100% 第三方、composer-input 的 5 处 `fromEntries` 确实来自 core 顶层 ⇒ 「出现即 fail」不可实施这个判断成立），但 spec 存在 **15 条 must-fix**，其中 4 条会直接导致执行期返工或门禁形态错误 —— 门 B 的实现代码取不到值就抛、门 C 的牙齿方向反了、H1 的排除清单漏掉 `build.gradle` 导致恒红、H3 的旗舰用例没有牙齿；另有 H1.2 那条「与台账差两个数量级」的错误口径修正，会把 Wave A 编码批次的规模估算带偏。

**放行条件**：MF-1 ~ MF-15 全部闭合（其中 MF-1/MF-7/MF-11/MF-12 属事实错误类，须由 doc-fix 直接改写；MF-4/MF-5/MF-6 属门 B/C 实现类，须先定死计数语义再改实现步骤），改完可无脑重跑本报告的复现命令。