# CR 报告 · cr1-guards（scope 模式 · 只读评审）

## ① 元信息

| 项 | 值 |
|---|---|
| 节点 | `cr-guards`（code-review-loop · scope 模式 · review_round 1 / dag_version 1） |
| 仓库 | `D:\Dev\nm-worktree\mcr`（分支 feat/repo-mega-cr） |
| base_sha / head_sha | `fe79b781` / `046f4d9c` |
| 被审 commit | `3b4c8d9e`、`5fb269fe`、`046f4d9c`（Wave E 门禁与防再腐） |
| 业务 spec | `docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-e.md`（X1~X4 / H1~H6 / C1 的七要素与验收判据） |
| 本 scope 域 | 门禁语义正确性（B）、可测性（C）、防再腐有效性（G）——CI 接线、编码探针、计数/身份棘轮、零收集守卫、白名单与 eslint 规则 |
| 域外（不判） | Wave D 死码删除本体（cr-dead）、业务实现正确性、各波测试断言的业务语义 |
| 检查维度 | B（守卫语义正确性）+ C（可测性/牙齿自检）+ G（防再腐有效性/CI blocking） |
| 重点核对 | 门 A 选择器覆盖与绕过面、门 B 白名单生成时机与陈旧面、门 C 计数方向性与绕过面、X2 棘轮身份集合的行号敏感性、X4 dist 缺失语义、H3/H6 单源化、pre-commit 绕过面、CI `continue-on-error` 残留 |
| 写入 | 禁改代码 / 禁改 spec / 禁 git 写。本报告为唯一落盘物；`tmp/` 下 8 个探针脚本与隔离探针仓已全部删除，`git diff --stat` 为空 |
| 终态复核 | renderer 棘轮 **371 GREEN**（实跑）、encoding **0/0/0**（实跑 3631 文件）、desktop lint **0 errors**、tdbc-driver-op-sqlite lint **0 errors**、门 B/C 干净重建 **4/4 GREEN** |

---

## ② Must-fix（P0 → P1 → P2）

### P1-1 ★top：`test:collect-guard` 全仓只有 `apps/cli` 一个包暴露 ⇒ H6 的「双 shell 门禁」在 CI 上只覆盖 1/3 个相关包，`packages/core` 与 `apps/desktop` 完全没进门

**位置**：`.github/workflows/ci.yml:128-129` + `apps/cli/package.json:18`（唯一暴露点）

```yaml
      - name: Zero-collect guard
        run: npm run test:collect-guard --workspaces --if-present
```

**实测（探针扫全部 18 个 workspace 的 package.json）**：

```
=== test:collect-guard exposure across ALL workspaces ===
GUARD  @novel-master/cli
  -    @novel-master/desktop
  -    @novel-master/mobile
  -    @novel-master/core
  -    @novel-master/llm-sse-native
  -    @novel-master/sksp-android
  ...（其余 12 个包全部无）
```

实跑复现：`npm run test:collect-guard --workspaces --if-present` 的全部输出**只有一行**
`[collect-check] 扫描面 ...\apps\cli\test（递归 *.test.ts），收集到 20 个文件`。

**机理（这道门禁宣称拦的东西，它没拦）**：H6 的立论是「N-P0-02 的假绿**只在 Windows 出现**
（单引号 + `shell:true` ⇒ Linux 绿 / Windows 静默空跑），所以必须在两种 shell 上各跑一遍」。
spec §H6.2 Step 4 明确要求「**各包**加 `test:collect-guard`」。落地时只给 `apps/cli` 加了：

- `apps/desktop` —— **病灶本体**。它的 `run-tests.mjs:30-33` 正是把单引号改双引号的那处，
  也正是 `shell: true` 唯一的使用方。它**有**内联守卫（`:60-69`），但**没有** `test:collect-guard` 脚本
  ⇒ `--if-present` 直接跳过 ⇒ **windows-latest runner 上 desktop 的收集逻辑一次都没被执行**。
  换句话说：这条门禁在唯一需要它的平台上，没有测它要守的那个包。
- `packages/core` —— `package.json:121` 仍是
  `bash -O extglob -O globstar -c 'tsx ... --test test/**/!(performance).test.ts'`，
  **spec §H6.2 Step 3 要求的「换成仓内 Node 脚本 + 守卫」完全没做**，脚本原样未动。
  它在 Windows 上是「跑不起来」（响亮失败），不是假绿，但 spec 承诺的 core 化没有交付。
- 其余 12 个驱动包全是裸 `tsx --test test/**/*.test.ts`，同样零收集假绿面（node ≥22 收集 0 条退出码为 0）。

**为什么这条是 P1 而不是 P2**：门禁**看起来**完整（独立 job、双 shell matrix、写清了
`runs-on` 是 job 级键的坑），PR review 时很难看出它只跑了一个包。而它没覆盖的两个包
恰好是 desktop（病灶本体，有 `shell:true`）与 core（3126 条用例，spec 自己认定的主战场）。
「Linux 绿 / Windows 静默空跑」这一类 bug 按 spec 的原话「**只能在两种 shell 都跑一遍的门禁里被抓住**」，
而现在这个门禁在 Windows 上只验证了 cli 的 `fs.readdirSync` 递归（一个**不经过 shell**的收集器）。

**修法**（三步，都在 `5fb269fe` 的改动面内）：
1. `apps/desktop/package.json` 加 `"test:collect-guard": "node scripts/collect-check.mjs"`，
   并新建 `apps/desktop/scripts/collect-check.mjs`（照抄 `apps/cli/scripts/collect-check.mjs:17-25`
   的 `collectTestFiles`，扫描面 `test/` 递归 `*.test.{ts,tsx,js}` 三个后缀，对齐 `run-tests.mjs:33` 的三个 glob）。
   ⚠️ 注意 desktop 的收集是 **Node 侧断言 + shell glob 双轨**（`run-tests.mjs` 仍把 glob 交给
   `shell:true` 展开），所以 collect-check 只能证明「文件在」，证明不了「双引号在 Windows 上真能展开」。
   要真验到引号语义，collect-check 应**复刻 `run-tests.mjs` 的 spawn 形态**（起一次极小的子进程，
   例如 `npx tsx --test "test/<某个已知单文件>.test.ts"`，断言 `# tests > 0`），而不是纯 `readdirSync`。
2. `packages/core` 落地 spec §H6.2 Step 3：新建 `packages/core/scripts/run-tests.mjs`
   （`fs` 递归 `test/**/*.test.ts`、排除 `performance.test.ts`、断言非零、`spawnSync` 不经 shell），
   `package.json` 的 `test` / `test:fast` 都改指它；`test:collect-guard` 同样指向一个薄封装。
   ⚠️ spec §H6.7 已预警「收集范围悄悄变了」——上线前必须**逐条 diff 旧 glob 与新收集器的文件列表**并写进 PR。
3. 顺手把 12 个驱动包的 `test` 从裸 `tsx --test test/**/*.test.ts` 收编（可先只加 `test:collect-guard`，
   不改 `test` 本体，成本极低）。

**验证口径**：修完后在 **windows-latest** 上，`npm run test:collect-guard --workspaces --if-present`
的输出里必须**同时出现** desktop 与 core 的扫描面行；且故意把 desktop 的 glob 改回单引号
（或把 core 收集目录指向不存在路径）⇒ **windows-latest 那一格必须红**（这才是 H6 Step 5 的验收）。

---

### P1-2：X2 棘轮的「错误身份集合」把**行号+列号**写进身份 ⇒ 任何无关的行位移都会让门禁假红（实测 78 条幻影）

**位置**：`apps/desktop/scripts/check-renderer-typecheck.mjs:35`（`IDENTITY_RE`）、`:66`（`id` 构造）

```js
const IDENTITY_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;
...
const id = `${file.trim()}(${line},${column}): ${code}: ${message.trim()}`;
```

**实测（探针已删）**：在 `renderer/features/settings/SettingsViews.tsx`（该文件有 **79 条**基线错误）
**顶部插一行注释**——语义上「一条错误都没新增、没删除、没修复」——然后跑棘轮：

```
[renderer-ratchet] RED: 78 new error identities (now 371 / baseline 371)
  renderer/features/settings/SettingsViews.tsx
```

**机理**：身份 = `file(line,col) + code + message`。行号一变，同一条错误就换了一个身份 ⇒
`S \ S0` 非空 ⇒ 判红。而 `now 371 / baseline 371` 说明**总数完全没变**，红的原因纯粹是坐标漂移。

这不是假阳性的美观问题，是**门禁信噪比**：在一个 79 条错误的文件上方加一行注释（加个 import、
加条注释、改个空行）就要走一次 `--update` 重写基线。而 `--update` 是**无条件的**：

```js
if (process.argv.includes("--update")) {
  writeBaseline(ids, { previous: baseline.maxErrors });
```

⇒ 一次「插注释 → 78 幻影红 → `--update`」的循环里，`--update` 会把**真实新增的错误一并写进基线**。
spec §X2.8 自己列了这条风险「棘轮 `maxErrors` 被后人顺手调到很大绕过」，但给出的缓解只有
「PR 里说明理由」；行号敏感性把这条风险从「需要恶意」降级成「一次误操作就会发生」。

**正面确认（不要改坏的部分）**：`maxErrors` 天花板的**方向是对的**——`if (ids.size > baseline.maxErrors)`
配合 `--update` 写入的 `maxErrors: ids.size`，使得「只调小 maxErrors、不动 known 数组」必红，
「只把基线做大」则被 `S \ S0` 拦。这两条互补的设计（`:130-136` 的注释已写明意图）成立，
spec §X2.4 ③「把 maxErrors 调到 400 → 期望 exit=1」的验收方向**已被正确实现**（该条 spec 原文
「调到 400」在 371 的终态下应理解为「调到低于实跑值」）。

**修法（二选一，推荐前者）**：
- **(a) 身份去掉坐标，只留 `file + code + message`，另存一份坐标仅用于打印定位。**
  判定用 `file|code|message`（`message` 已含足够区分度，tsc 对同一文件的同一 code 通常消息不同）；
  打印新增项时再从本次实跑结果里取出行列。这样行位移不再产生幻影，而「同一个文件里新增一条
  相同 code 相同 message 的错误」这种极窄形态仍会被 `file+code+message` 抓到。
  ⚠️ 代价：同一文件内两条**完全同文**的错误只能按 `Set` 计一条，`:118` 打印的 `now` 计数会与
  tsc 原始条数有微差。需在 `$comment` 里写明「`now` 是去重后的身份数，不是 tsc 原始条数」。
- **(b) 保留坐标身份，但给 `--update` 加一道「新增条目必须逐条列出理由」的强制交互**
  （非 TTY 时拒绝 `--update`）。这不解决假红，只降低误用。

**补一条自检用例**（当前 0 条）：拿一份固定的两行样例输出喂 `parseIdentities`，
断言「同一文件内插入前置行后，身份集合大小不变」。这条用例就是这条 bug 的牙齿。

---

### P1-3：pre-commit 钩子读的是**工作区**内容而非**暂存区**内容 ⇒ 「先 `git add` 脏版本、再把工作区改干净」可绕过，且提交进仓库的正是脏版本

**位置**：`scripts/check-encoding.mjs:105-112`（`listStagedFiles`）+ `:66`（`readFileSync(file)`）

```js
function listStagedFiles() {
  const listed = tryGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"]);
  ...
  return listed.split("\0").filter(Boolean).map((rel) => path.join(repoRoot, rel));
}
...
buffer = readFileSync(file);   // ← 读工作区，不是 `git show :<path>` 的暂存区 blob
```

**实测（隔离探针仓，探针已删）**：

```
[probe] staged blob has FFFD : true      ← git show :apps/demo/src/staged.ts 里有 U+FFFD
[probe] worktree  has FFFD   : false     ← 工作区已改干净
[probe] --staged exit code    : 0         ← 钩子放行
[probe] VERDICT                : BYPASS CONFIRMED - hook green but commit carries FFFD
```

**机理**：`--staged` 模式用 `git diff --cached --name-only` 取的是**文件名清单**（这一步是对的），
但随后用 `readFileSync` 读的是**工作区当前内容**。`--diff-filter=ACM` 保证文件在暂存区里是
「新增/已改/复制」状态，却完全不看那个 blob 的字节。于是「暂存脏版本 → 工作区擦干净 → 提交」
这条普通得不能再普通的工作流（编辑器自动保存、`git add -p` 后再格式化、IDE 里改了没暂存……）
会让钩子绿着过，而 commit 里躺着 U+FFFD。

**定级说明**：这是 **P1 而非 P0**，因为存在权威兜底——CI 的 `Encoding` 步（`ci.yml:66-67`，
无 `continue-on-error`）在**提交后的 PR 上**用全量 `git ls-files` 扫，会红。
但它把 spec §H1.8 那条「高概率风险：钩子形同虚设」从「配置没装上」升级成了「**装着也会漏**」，
且漏的方向恰好是最坏的那个（脏内容进了历史）。spec 给的缓解「① CI 步骤是权威门禁」成立，
但钩子本身的实现缺陷没有被指出过。

**修法（一行）**：`--staged` 模式下把 `readFileSync(file)` 换成读暂存区 blob：

```js
// listStagedFiles 改成返回 { rel, content } —— content 来自 `git show :<rel>`（或 `git cat-file blob :<rel>`）
```

注意 `--diff-filter=ACM` 已排除删除态，所以每个 rel 都有 `:path` 可读；`git show :path` 对
含非 UTF-8 字节的 blob 需按 Buffer 读（`execFileSync` 不带 `encoding` 即返回 Buffer，天然正确）。
另外要留意 `git show` 对大文件的性能（`maxBuffer` 已在 `tryGit` 里给了 64 MiB，够用）。

**验证口径**：隔离仓里复跑本次注入序列，`--staged` 必须 exit 1 且点名该文件；
再补一条「暂存干净版 + 工作区改脏 ⇒ 也必须红」（这条现在恰好是对的，因为读工作区会命中脏内容——
修完之后依然要对，两条都绿才算修对）。

---

### P1-4：编码门禁把 `android` **整段**排除 ⇒ `.kt` / `.java` / `.gradle` 三个后缀进了白名单却永远扫不到任何文件

**位置**：`scripts/check-encoding.mjs:41-43`（`SKIP_DIRECTORIES` 含 `"android"`）、`:39`（`SCAN_EXTENSIONS` 含 `.kt`/`.java`/`.gradle`）

```js
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".kt", ".java", ".gradle",
]);
const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", "webview-dist", "coverage", ".git", "android", "build",
]);
```

**实测（探针已删）**：

```
扫描面统计：in-scan 2695 / excluded 811  { android: 32, docs/Iterations: 779 }
android/ 下若不排除会被扫到的文本文件：5 个
  ⇒ 命中 20 处 U+FFFD + 1 个非 UTF-8，全部集中在 apps/mobile/android/app/build.gradle
```

**机理**：spec §H1.3 Step 1 的原始要求是「**外加 `apps/*/android/**`（至少 `**/build.gradle`）**」，
本意是**只排掉那一个 GBK 混编文件**（RULE:113 已把它单列为 Wave A 的另一条修复线）。
落地时把它实现成了「路径任意分段等于 `android` 就整棵子树跳过」，后果是：

- `apps/mobile/android/app/src/main/java/com/novelmaster/MainActivity.kt` 与 `MainApplication.kt`
  （**真机运行的应用源码**）永久脱离编码门禁；
- `.kt` / `.java` / `.gradle` 三个后缀在 `SCAN_EXTENSIONS` 里**完全是摆设**——
  全仓 `.kt` 文件只存在于 `apps/mobile/android/` 下（`git ls-files "*.kt" | findstr /v android` 为空），
  所以这三个后缀今天扫到 0 个文件，将来也不会扫到任何一个。

也就是说：**「本门禁覆盖 Kotlin/Java」这个印象是假的**。这不是误伤风险（不会假红），
是**静默漏扫**——正是 H1 这条钩子要治的那类病（编码损坏进版本库且无人拦截）的翻版。
未来任何 Kotlin 源码的编码损坏都会畅通无阻。

**修法（收窄到文件级，零风险）**：把 `android` 从 `SKIP_DIRECTORIES` 移除，
改成一个**文件级**排除项（与既有的 `SKIP_PATH_PREFIXES` 同款机制）：

```js
/** 显式排除面：GBK 混编文件，RULE:113 已单列为 Wave A 的另一条修复线（wave-e H1.3 Step 1）。 */
const SKIP_PATH_PREFIXES = ["docs/Iterations/", "apps/mobile/android/app/build.gradle"];
```

⚠️ 落地时**必须立刻实跑一次**确认 android 树下真的只有 `build.gradle` 一个命中
（本次实测正是这个结论：5 个候选文件、命中全在 `build.gradle`），否则会当场恒红。
排除理由要写进文件头注释，与现有 `build.gradle` 那段注记合并。

---

### P1-5：门 C 的计数正则只认「紧贴的调用点」，而 WebView 产物是 **esbuild target es2018 的降级输出** ⇒ 门 A 抓到的源码形态里有整整一类在产物里换形，门 C 数不到

**位置**：`apps/mobile/scripts/build-webview.mjs:145-153`（`WEBVIEW_COMPAT_CONSTRUCTS`）、`:242`（`target: ['es2018']`）

```js
const WEBVIEW_COMPAT_CONSTRUCTS = {
  'Object.fromEntries': /Object\.fromEntries\(/g,
  'String.replaceAll': /\.replaceAll\(/g,
  'Object.hasOwn': /Object\.hasOwn(?!Property)\(/g,
  'structuredClone': /\bstructuredClone\(/g,
  'Array.at': /(?<![\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.at\(/g,
};
```

**实测（探针已删）**：

```
[exp1 count-up]  "var x = Object.fromEntries(a);"   -> detected=[Object.fromEntries:1] regressions=1   ← 正向拦截成立
[exp3] "Object.fromEntries /*c*/ (a)"   -> detected=[]  regressions=0   ← 注释插入即漏
[exp3] "Object\n  .fromEntries(a)"       -> detected=[]  regressions=0   ← 换行即漏
[exp3] "Object['fromEntries'](a)"       -> detected=[]  regressions=0   ← 计算属性即漏
[exp3] "globalThis.Object.fromEntries(a)" -> detected=[Object.fromEntries:1] regressions=1
[exp3] "structuredClone /*x*/(a)"        -> detected=[]  regressions=0   ← 注释插入即漏
[exp3] "arr?.at(-1)"                    -> detected=[]  regressions=0   ← 可选链即漏
[exp3] "const at = arr.at; at(-1)"       -> detected=[]  regressions=0   ← 解构后调用即漏
```

**机理与定级**：门 C 的**方向是对的**（`measured > recorded ⇒ red`，`exp1` 坐实；下降为绿，
spec §X3.3 ③ 强调的「基线改大不算红、必须改小」这个方向也正确），
基线与干净重建的实测**逐包逐构造一致**（4 包全 GREEN，`composer-input` 5 构造全 0，
说明 N-P0-01 的修法确实把 `Object.fromEntries` 从产物里清零了）。
但它的**覆盖面**比 spec §X3.2 声称的窄：spec 说门 C 抓的是「某个我们控制的一手依赖升级把新构造带进来」，
而这条路径上的产物是**第三方库**（mermaid / zod / Recogito / CodeMirror）的**降级输出**——
它们不会写成 `Object.fromEntries(`，而可能写成上面那 6 种换形之一（注释/换行是 terser 压缩的常态，
可选链在 es2018 降级后也会变成别的形态）。

门 C 因此**不是**门 B 的补充网，而是一道**只对「我们自己的代码被原样打进产物」有效**的网。
这个定位需要写进基线 JSON 的 `$comment`（现在只写了「不与上游库升级打架」）。

**修法**：
- 把 5 条正则改成**容忍分隔符**的形态，优先最小改动：
  `Object\s*\.\s*fromEntries\s*\(`、`\.\s*replaceAll\s*\(`、`Object\s*\.\s*hasOwn(?!Property)\s*\(`、
  `\bstructuredClone\s*\(`、现有 `Array.at` 保持。
  ⚠️ 改完**必须重测基线**（`--update-compat` 或手工），因为 `chat-transcript`（37 处 replaceAll）
  这类高计数包对空白容忍度敏感，基线值可能变。
- `Object['fromEntries']` 这类**计算属性**形态建议**不进产物面**（产物里极少出现，
  出现了也说明有人在手写绕过），但要在 `$comment` 里显式声明「计算属性形态由门 A 在源码面兜住」。
- 在 `build-webview.mjs` 的门 C 注释里补一句净增量口径（与门 A 那段同款）：
  「门 C 只对『我方源码原样进产物』有效；第三方库的降级/压缩形态它数不到。」

**不要**把门 C 改成「出现即 fail」——spec §X3.2 已经用 3/4 包先天命中论证过那条路走不通。

---

### P2-1：X1 的 eslint 门只管 `import` / `export ... from` 语句，不管动态 `import()` 与 `require()`

**位置**：`apps/desktop/eslint.config.mjs:71-88`（`no-restricted-imports` 的 `patterns` 形态）

**实测（探针已删）**：向 `renderer/` 注入 4 种形态，eslint 只报出 2 条：

```
1:1  error  '@novel-master/core/vfs' import is restricted ...          ← 静态 import ✔
6:1  error  '@novel-master/core/chat' import is restricted ...          ← export ... from ✔
（2:1 的 await import("@novel-master/core/chat") 与 5:1 的 require("@novel-master/core/events") 均未报）
```

**但兜底网补上了**：同一份注入下，X1 的结构快照测试
（`apps/desktop/test/shared-logic-x1.test.ts`）两条用例都红了——
第 1 条按**字样级**判定（`code.includes(CORE_SPECIFIER)`，剥注释后）直接点名文件；
第 2 条按**绑定级**判定，`renderer 存在指向 core 的语句：["... import @novel-master/core/vfs [validateVfsEntryName]","... export @novel-master/core/chat [isHttpUrl]"]`。

⇒ **净结论：X1 的实际拦截能力 = eslint（窄）+ 结构快照测试（宽）= 合格**。
`no-restricted-imports` 不覆盖动态/require 是 ESLint 核心规则的已知边界，不是本次实现的缺陷。
**建议**：在 `eslint.config.mjs:71` 的注释里补一句「本规则只覆盖静态 import/export；
动态 import() 与 require() 由 `test/shared-logic-x1.test.ts` 的字样级用例兜住」，
避免后人以为 eslint 那条是全覆盖而删掉结构快照测试。

**顺带确认（X1 结构快照测试的设计质量值得肯定）**：
它有「防恒真」第三条用例（`shared/logic 再导出面非空` + 「shared 侧只准 export 不准 import」），
这正是 H2 §Step 2 警告过的「把同一份键表抄两遍 ⇒ 断言恒真」陷阱，本条避开了。
`stripNonCode` 先掩字符串再删注释的顺序也是对的（文件头 `:50-57` 写明了理由）。

---

### P2-2：`docs/Iterations/` 排除面 779 个文件，占整个扫描面的 22%——排除本身合规，但「只排这一个子目录」需要写明理由

**位置**：`scripts/check-encoding.mjs:45`（`SKIP_PATH_PREFIXES = ["docs/Iterations/"]`）

实测扫描面：`in-scan 2695 / excluded 811`，其中 `docs/Iterations` **779**、`android` 32。

spec §H1.3 Step 1 只要求「**显式声明 `docs/` 不在扫描面内**」（含 `docs/Iterations`），
落地成**只排 `docs/Iterations/`、保留 `docs/apm/` 与 `packages/*/docs/`**——这比 spec 更严，
方向正确（`docs/apm/RULE.md` 与 `packages/core/docs/public-api.md` 都是真会被工具链读的中文文档）。

**问题**：`docs/Iterations/` 是本仓**迭代过程文档面**（本报告所在目录也是它），
779 个文件里含大量 spec / ledger / raw 报告。这些文件里出现 U+FFFD 或 BOM 是**历史留痕的正常形态**
（它们记录的正是「哪里有编码损坏」这件事本身）。文件头注记已经写明了这个理由（`:13-16`）。

**要做的**：把注记补上**量级**（「实测 779 个文件、占扫描面 22%」），
并明确「`docs/Iterations/` 下的内容不视为源码，编码损坏在那儿是**记录**而非**病症**」。
否则下一个读代码的人看到 22% 的排除比例会合理地怀疑门禁被做空了。

---

### P2-3：门 A 的自定义规则放过「解构后调用」形态，而规则注释明确声称覆盖这一形态

**位置**：`apps/mobile/eslint.config.mjs:33-36`（注释声称覆盖「解构取引用（`const {at} = arr`）」）、
`:83-98`（`shadowed` 集合的收集逻辑）

**实测（探针已删）**：第一轮 8 形态注入命中 7 条，**第 8 条（解构）未命中**；
第二轮针对性复测：

```ts
const { at } = [1, 2, 3];
export const a = at(-1);        // ← 门 A 完全没报
const { fromEntries } = Object;
export const b = fromEntries([["k", 1]]);   // ← 被 no-restricted-properties 报了（因为右侧 Object.fromEntries 是成员访问）
```

**机理**：`shadowed` 集合把 `const { at } = [...]` 的 `at` 记为「已遮蔽」，
于是后续裸标识符 `at` 被 `:141` 的 `if (shadowed.has(name)) return;` 放行。
注释里把「解构」列为自定义规则存在的理由之一，但实现只做了**反向**（放行遮蔽），
没做**正向**（在解构发生时报告）。

**定级 P2 的理由**：`at` 的解构调用在真实代码里罕见（`.at(-1)` 直接写更自然），
且门 C 仍会在产物层数到 `.at(` 之外——不对，门 C 也数不到（见 P1-5 的 `arr?.at` 换形），
所以这两条形态目前**两道门都漏**。但它们都不改变 N-P0-01 那类**顶层执行**的破坏机理
（`Object.fromEntries` 顶层执行会白屏，`arr.at(-1)` 在表达式位置求值失败只抛 TypeError），
后果轻于原 P0。

**修法**（二选一）：
- **(a) 改注释**（最小、诚实）：把 `:33-36` 注释里「解构取引用」从「已覆盖」列表里去掉，
  改成「**刻意不覆盖**解构形态：局部遮蔽是合法的 polyfill 写法
  （如 `const structuredClone = require('./shim')`），一刀切会误伤」。
  这个说法与实现是一致的——`shadowed` 的存在本身就是这个设计意图。
- **(b) 真要拦**：在 `VariableDeclarator` / `:function` 的收集处，若被收集的名字命中
  `WEBVIEW_RESTRICTED_MEMBERS` 或 `WEBVIEW_RESTRICTED_GLOBALS`，报一条
  `restrictedMember`。⚠️ 代价是会把 polyfill 写法也拦掉（`const { at } = Array.prototype` 是合法降级），
  需要给 `eslint-disable-next-line` 留出口。

倾向 (a)：门 A 的价值在报错语境与零存量债，不在于把每条理论路径都堵死。

---

### P2-4：门 B 的白名单是**构建时**判定的（正确），但 60 条 `chat-transcript` 条目无逐条理由注释

**位置**：`apps/mobile/scripts/build-webview.mjs:60-127`（`WEBVIEW_CORE_ALLOWLIST`）

**先记正面**：spec §X3.7 列的最高概率风险「门 B 白名单写死 59 条，后续有人顺手加一条绕过门」，
在落地形态上被**正确处理**了——白名单是**构建时**从 `metafile` 读的，
**不存在「陈旧 metafile 放行新直连」的问题**（每次 `bundleAppJs` 都传 `metafile: true`，
`assertCoreAllowlist` 紧跟在 `bundleAppJs` 之后同步执行，`build-webview.mjs:485-487`）。
这回答了本轮检查维度 B 里的「门 B 生成时机」一问：**时机正确，无陈旧面**。

**注入实验（探针已删）**：给 `composer-input` 的 webview 入口加一条**真实存在**的 core 导出
（`import { createVfsService } from "@novel-master/core/vfs"`），重跑构建：

```
[gate B / webview core allowlist] RED: package composer-input pulls 13 core module(s) outside the allowlist
  packages/core/dist/infra/tdbc/index.js          ← 正是 N-P0-01 的病根模块
  packages/core/dist/public/vfs.js
    <- imported by: apps/mobile/src/web/composer-input/webview/runtime/model.ts  @novel-master/core/vfs
  ...（共 13 条）
```

⇒ **门 B 有真牙，且归因链正确**（同时点名了「哪个模块」与「谁 import 了它」，
`build-webview.mjs:320-343` 那段「必须读顶层 `metafile.inputs[x].imports` 而不是
`outputs[k].inputs[x]`」的注释是对的——我实测拿到了 importer 归因）。
顺带坐实了 P0 病根模块 `infra/tdbc/index.js` 确实是从 core barrel 传递进来的。

**剩下的问题**：`chat-transcript` 那 **60 条**（spec 说 59，实测 60）白名单条目是**光秃秃的字符串数组**，
没有一条带注释。spec §X3.7 的缓解写的是「白名单条目必须写注释说明**为什么需要**；
PR review 时逐条问『删了会怎样』」——**这条缓解没有落地**。后果是这 60 条变成了
「看着像黑名单、其实是白名单」的隐形债务：下一个人往里加一条不会有任何摩擦，
而门 B 只知道「在白名单里就放行」。

**修法**（不改判定逻辑，只加可维护性）：把数组元素从 `string` 换成
`{ id: string, why: string }`（或在数组上方按来源分组加块注释：vfs 工具族 / search 工具族 /
schema 族 / bootstrap 族）。`assertCoreAllowlist:308-316` 的消费侧只需改成取 `.id`。
成本约 30 行，收益是让 spec 承诺的 review 摩擦真实存在。

---

## ③ Should-fix 与观察项

1. **`Encoding` 步与 `Format` 步的顺序值得记一笔（正面）**：`ci.yml:60-67` 把 `Format` 放 `Encoding` 之前。
   `Format`（prettier）实测**保留 BOM**（spec §H1.6 MF-10 已记），所以这个顺序是对的——
   编码门禁是 BOM 的权威判据，放在 format 之后不会漏。**但**反过来，prettier 若哪天改成
   「规范化掉 FFFD」或「加 BOM」，这条顺序就变成先污染后检测；建议在 `ci.yml:63-65` 的注记里
   把「prettier 保留 BOM、故本步必须在其后」这层因果写进去（现在只写了「三类分开报」）。

2. **`link-hooks.mjs` 的「永不失败」纪律正确，但有个反向风险**：`scripts/link-hooks.mjs:37-44`
   catch 一切并 `console.warn` 后静默退出 0。这对 `prepare` 是对的（不让 `npm install` 挂）。
   但它意味着**钩子没装上时没有任何本地信号**，只有 CI 能发现。
   spec §H1.8 的缓解 ②③（README + `prepare` 自动配置）里，README 那条已落地
   （`README.md:127`，实测在位），`prepare` 已挂根 `package.json:17`。
   **建议**：把 warn 升级为「非 TTY 下静默、Tty 下加一行醒目提示」，
   或在 `check-encoding.mjs` 开头检测一次 `core.hooksPath` 是否指向 `.githooks`，
   没指向就在 CI 日志里打一条提醒（成本极低，能把「我以为钩子装上了」这个误解显式化）。

3. **`--staged` 模式完全依赖 `git diff --cached`，在「首次提交」场景下覆盖不全**：
   `--diff-filter=ACM` 排除了 `D`（删除，合理）与 `R`/`T`（重命名/类型变更）。
   重命名一个带 BOM 的文件时，暂存区里只有新路径，`git show :<新路径>` 可读，行为正确——
   这条没问题，**列在这里只是为了说明我核对过**。

4. **X4 的 kkv dist 守卫在 `dist` 缺失时的行为是「响亮失败」，符合 spec 判据②**：
   `public-kkv-dist-resolution.test.ts:61-69` 用 `assert.fail` 给出可操作信息
   （「先跑 `npm run build -w @novel-master/core`」），且**刻意不降级为 `test.todo`**
   （文件头 `:7-8` 明写「守卫静默跳过就等于没有守卫」）。
   ⚠️ 实测确认 `packages/core/dist/public/kkv.js` 当前**存在**（`Test-Path` = True），
   所以这条守卫在当前环境不会恒红。**唯一未验证项**：新 clone 未 build 时 CI 侧是否排在
   `Build workspaces`（`ci.yml:50-51`）之后——从 ci.yml 看 `Test` 步（`:99-100`）确实在
   `Build workspaces` 之后，**顺序成立**。另注记一条实测修正：spec §X4.2 约束① 写的
   `createRequire().resolve()` 在本仓**不成立**（`"./kkv"` 只有 `types`+`import` 条件、无 `require` 条件），
   实现改用「纯 node 子进程跑 `import.meta.resolve`」，文件头 `:10-27` 把两个原因都写清了——
   **这个偏离是正确且有实测支撑的**，不是偷懒。

5. **H2 的 `satisfies` 编译期守卫到位**：`normalize-agent-prompt-layout.ts:66-74` 的
   `NORMALIZED_OPTIONAL_FIELDS ... satisfies Record<Exclude<keyof AgentPromptLayout, "persist"|"dynamic">, null>`
   双向锁成立（`:95` 还有第二处 `satisfies`），`:111` 的 `assertNormalizeCoversAllFields`
   用哨兵值驱动（不是抄一遍键表），符合 spec §H2.2 Step 2 警告的「恒真」陷阱规避要求。
   `:141-142` 还把三层守卫（常量表 / 断言函数 / 测试夹具）互相指了路，可维护性好。

6. **H3 的单源化是真的一处定义多处消费**（实测四条链路全部转发，无一份复刻）：

   | 位置 | 形态 |
   |---|---|
   | `packages/core/src/domain/skills/logic/build-new-skill-doc.ts` | **唯一定义**（带 `'mobile'` 变体参数） |
   | `packages/core/src/public/skills.ts:28` | barrel 转发 |
   | `apps/desktop/shared/logic/skills.ts:12` | X1 再导出层转发 |
   | `apps/desktop/renderer/features/skills/skill-ui.ts:23` | `export { buildNewSkillDoc } from "@shared/logic/skills"` |
   | `apps/mobile/src/components/skills/skill-ui.ts:7,58` | `import … as buildNewSkillDocCore` → `buildNewSkillDocCore(name, description, 'mobile')` |

   ⇒ 满足 spec §H3.6 风险表里的「更保守默认建议（两版正文都保留、只统一 front matter 转义）」：
   变体参数保留了双端文案差异，同时消除了转义分叉。**这是本波单源化做得最干净的一条。**
   另注：spec §H3.2 Step 4 警告的「mobile 契约测试用正则锁死 `export {withSkillFrontMatterValues} from …`
   这一条独立语句、不得合并」这条硬约束，实现保留了独立 import 语句（`:7`），
   未触发该契约测试——**符合 spec**。

7. **H6 的「单源化」目标达成**：`scripts/lib/zero-collect-guard.mjs` 是唯一实现，
   `apps/desktop/scripts/run-tests.mjs:6-10` 与 `apps/cli/scripts/run-tests.mjs:26-29` 与
   `apps/cli/scripts/collect-check.mjs:12` 三处均 import 同一份，无一处复刻正则或退出码逻辑。
   spec §H6.6「守卫实现只能有一份」**达成**。`parseCollectedCount` 三个出口实测正确
   （`0`→0 / `'# tests 12'`→12 / `''`→null / 缺汇总行→null）；
   `assertNonZeroCollected` 三种输入实测：`0`→exit 1、`null`→exit 1、`5`→exit 0。**守卫本体逻辑无误**。
   ⇒ **P1-1 是「谁调用了它」的问题，不是「它对不对」的问题**。

8. **CI blocking 接线核对（正面）**：
   - `Lint` 步（`ci.yml:69-71`）保留 `continue-on-error: true`，**这是有意的、且注记写明了理由**
     （mobile 27 errors + `--max-warnings 321` 失效，属 wave-a A5.3）⇒ 符合 spec §X1.3 Step 5 的方案 a。
   - 新增的 `Lint (blocking: desktop/core/drivers)` 步（`:77-94`）**无 `continue-on-error`、
     无 `--if-present`**，且我把 15 个 workspace 名逐个核了：**全部存在于 package.json 且全部有 `lint` 脚本**
     （`tokenizer-driver-rn` 是 `eslint src`、`tdbc-conformance` 是 `eslint src`，其余 13 个是 `eslint src test`）
     ⇒ 名字写全、无拼写错误、不会因缺脚本而空跑。**这是本波 CI 接线最扎实的部分。**
   - `zero-collect-guard` 独立 job 的 `runs-on: ${{ matrix.os }}` **写在 job 级**
     （`:110`），正确避开了 spec §H6.2 Step 4 点名的「step 级 `runs-on` 会被 GitHub Actions 忽略」陷阱。
     `fail-fast: false` 也对（两格独立判红）。**结构对，覆盖面错（见 P1-1）。**
   - `Typecheck` 步（`:96-97`）**已无 `continue-on-error`**（Wave A 的成果），本波只承接，符合 spec §X1.7。
   - 文件头设计要点（`:6-7`）仍写着「lint 暂时 continue-on-error」，**与新增的 blocking 步并列存在但不矛盾**
     （前者指全 workspace 那条），建议加半句区分以免读者误解。

9. **`tdbc-conformance` 被加进 blocking lint 名单但不在 spec §X1.3 Step 5 的枚举里**：
   spec 列了 15 个 `-w` 参数但**没有** `@novel-master/tdbc-conformance`（spec 原文列的是
   desktop/core/llm-sse-native/sksp×4/cloud-sync-driver-s3/tdbc-driver×3/tokenizer-driver×2 = 14 个，
   落地加了 cli 与 tdbc-conformance = 16… 实测 15 个）。
   ⇒ **加包是净收益**（两个都是 lint 0 error 的包），但属于 spec 之外的扩权。
   **不判为偏离**，仅记录：本仓的 CI lint 覆盖面已**超过** spec 承诺的范围。

10. **驱动包 `tsconfig.test.json` 形态核对（046f4d9c 的主体）**：逐包核了
    `packages/tdbc-driver-op-sqlite` 等 8 个包的 `eslint.config.mjs`（全部改成
    `createTsEslintConfig(import.meta.dirname, { testTsconfig: "./tsconfig.test.json" })`）
    与 `tsconfig.test.json`（全部是 `extends ./tsconfig.json` + `noEmit: true` +
    `include: ["src/**/*", "test/**/*"]`，与 spec §X1.3 Step 4 给的模板逐字一致）。
    **实跑验证恒红面已消解**：`cd packages/tdbc-driver-op-sqlite && npx eslint src test`
    ⇒ `1 problem (0 errors, 1 warning)`，spec 记录的 8 条 `Parsing error: ... was not found by
    the project service` **全部消失**。**X1 Step 4 达成。**

11. **观察：门 A 的 lint 基线与 mobile 的 `--max-warnings 321` 相互独立**：
    `npx eslint src/web src/webview-host src/components` 实测 **153 problems（16 errors + 137 warnings）**，
    但按 ruleId 过滤，**三条门 A 规则命中 0 次**（`GATE_A_RULE_HITS=0`）⇒ 门 A 首日即绿成立
    （spec §X3.4 判据②要求按新 glob 重测，这一条已兑现）。
    那 16 个 error 全是 `react-hooks/exhaustive-deps` 等 RN 基线存量，属 mobile 收口范围（wave-a）。
    ⚠️ **但这意味着门 A 在 CI 上目前不 blocking**——mobile 的 lint 只走 `ci.yml:69-71` 那条
    `continue-on-error: true` 的全 workspace 步。spec §X3.6 已显式承认这一点
    （「在 X1 摘掉它之前，门 A 根本不会阻断 CI」），而 X1 的方案 a 正是**不摘那一条**
    ⇒ **门 A 至今是「本地/lint 时生效、CI 不拦」的半门禁**。这是 spec 已知并接受的权衡，
    记录在此以便 mobile 收口时不要遗漏把它转成 blocking。

---

## ④ 结论 verdict

### 注入实验矩阵（全部实跑，探针已删）

| # | 门 | 注入样例 | 期望 | 实测 | 判定 |
|---|---|---|---|---|---|
| 1 | **H1 编码** | 隔离仓：BOM 前缀文件 | 红 | ✗ 报 `bom` 1 | ✅ |
| 2 | **H1 编码** | 隔离仓：真 U+FFFD 文件 | 红 | ✗ 报 `fffd` 1 | ✅ |
| 3 | **H1 编码** | 隔离仓：非 UTF-8 字节文件 | 红 | ✗ 报 `fffd` 2 + `bad-utf8` 1（三类分开报，符合 MF-9 修法分派） | ✅ |
| 4 | **H1 编码** | 隔离仓：干净仓 | 绿 | ✓ `OK：扫描 2 个跟踪文件，0 命中` exit 0 | ✅ |
| 5 | **H1 pre-commit** | 暂存脏版 + 工作区擦干净 | 红 | ✗ **exit 0 放行，commit 带 FFFD** | ❌ **P1-3** |
| 6 | **H6 零收集** | `collected=0` | 红 | ✓ exit 1 | ✅ |
| 7 | **H6 零收集** | `collected=null`（汇总行缺失） | 红 | ✓ exit 1 | ✅ |
| 8 | **H6 零收集** | `collected=5` | 绿 | ✓ exit 0 | ✅ |
| 9 | **H6 CI 覆盖** | `test:collect-guard --workspaces --if-present` | 覆盖 3+ 包 | ✗ **只有 `apps/cli` 一行输出** | ❌ **P1-1** |
| 10 | **X2 棘轮** | renderer 加一个类型错 | 红 | ✓ `RED: 1 new error identities (372/371)` | ✅ |
| 11 | **X2 棘轮** | 现状 | 绿 | ✓ `GREEN: 371 / 371 (maxErrors=371, ceiling enforced)` | ✅ |
| 12 | **X2 棘轮** | 79 错误文件顶部插 1 行注释 | 绿（无新增） | ✗ `RED: 78 new error identities` | ❌ **P1-2** |
| 13 | **X1 eslint** | renderer 静态 `import` core | 红 | ✓ `no-restricted-imports` @1:1 | ✅ |
| 14 | **X1 eslint** | renderer `export … from` core | 红 | ✓ @6:1 | ✅ |
| 15 | **X1 eslint** | renderer `await import()` core | 红 | ✗ **未报**（规则边界） | ⚠️ P2-1（由 #16 兜住） |
| 16 | **X1 快照测试** | 同 #13~#15 全 4 形态 | 红 | ✓ 2 条用例红，点名文件与绑定 | ✅ 兜底成立 |
| 17 | **门 A** | 8 种受限构造（`Object.fromEntries` / `hasOwn` / `structuredClone` / `.at` / `.replaceAll` / 计算属性 / 可选链 / 解构） | 红 7/8 | ✓ 命中 7，**解构形态漏** | ⚠️ **P2-3** |
| 18 | **门 A** | 现状（新 glob 三目录） | 绿 | ✓ 三条规则命中 **0**（`GATE_A_RULE_HITS=0`），首日即绿成立 | ✅ |
| 19 | **门 B** | composer-input 加真实 core barrel import | 红 | ✓ `RED: pulls 13 core module(s)`，含 `infra/tdbc/index.js` + importer 归因 | ✅ |
| 20 | **门 B** | 干净重建 | 绿 | ✓ 4 包全绿、无白名单外模块 | ✅ |
| 21 | **门 C** | 计数上升 | 红 | ✓ `regressions=['Object.fromEntries']` | ✅ |
| 22 | **门 C** | 计数下降（清账） | 绿 | ✓ `regressions=0`（方向正确） | ✅ |
| 23 | **门 C** | 干净重建 4 包 vs 基线 | 绿 | ✓ 逐构造一致（composer-input 5 构造全 0） | ✅ |
| 24 | **门 C** | 6 种换形态（注释/换行/计算属性/可选链/解构） | 红 | ✗ **全部漏**（仅 `globalThis.` 前缀那档命中） | ❌ **P1-5** |
| 25 | **X1 Step 4** | tdbc-driver-op-sqlite `eslint src test` | 0 error | ✓ `0 errors, 1 warning`（8 条 Parsing error 消失） | ✅ |
| 26 | **H1 覆盖面** | `android/` 整段排除 | — | ✗ 32 个文件（含 2 个真机 Kotlin 源码）被跳过，3 个后缀永久空转 | ❌ **P1-4** |
| 27 | **H1 扫描面** | 全仓统计 | — | `in-scan 2695 / excluded 811`（`docs/Iterations` 779 + `android` 32） | ⚠️ P2-2 |

### 总结论

**verdict: not-ready**（2 条 must-fix 属「门禁自身失效/绕过」，需在本波内闭环）

Wave E 的门禁**骨架是对的，而且质量明显高于同类工作**：X2 棘轮用「错误身份集合 + maxErrors 天花板」
双机制（方向性正确，注入 #10/#11/#12 全部按预期）、门 B 在构建时判定（**无陈旧 metafile 面**，
回答了本轮维度 B 的核心疑问）、门 C 方向正确、门 A 首日即绿（按新 glob 重测过）、
H2/H3 的单源化是真的一处定义多处消费、H6 的守卫实现只有一份且逻辑无误、
X1 Step 4 的恒红面实测消解、CI blocking lint 步的 15 个 workspace 名逐个核对无错。

**但有 5 条 must-fix（0 个 P0 / 5 个 P1）**，其中两条是「门禁宣称拦的东西它没拦」：
**H6 的双 shell 门禁只覆盖 3 个相关包里的 1 个**（P1-1，含病灶本体 desktop）、
**pre-commit 钩子读工作区而非暂存区、可被普通工作流绕过**（P1-3）。
另三条是覆盖/信噪比问题：棘轮行号敏感性（P1-2）、`android` 整段排除使 Kotlin 永久脱扫（P1-4）、
门 C 正则不认换形（P1-5）。

**定级说明**：**0 个 P0**。理由是所有缺口都有权威兜底或只影响局部——
P1-1 的 Windows 面缺口被 desktop 内联守卫 + Linux CI 部分覆盖（但覆盖的形态不对，见 §④-9），
P1-3 被 CI `Encoding` 步（无 `continue-on-error`）兜住，P1-2 只造成假红不造成漏放，
P1-4/P1-5 是覆盖缺口不影响现有正确性。**没有一条会导致「CI 绿但用户已受损」**。

**建议的收敛顺序**：P1-1 与 P1-3 优先（都是绕过，且都在 `5fb269fe` 的改动面内，改动量小）；
P1-4 是一行改动 + 一次实跑确认；P1-5 需重测基线、建议与下次依赖升级同批；
P1-2 可先只加那条自检用例把行为钉住，身份构造的改造可以延到下一波。

---

## ⑤ 附：本节点**核对通过**的重点项（避免下游重复劳动）

1. **门 B 的生成时机（维度 B 明确点名）**：`metafile: true` 在 `bundleAppJs`（`build-webview.mjs:252`）内传入，
   `assertCoreAllowlist` 紧跟其后同步调用（`:485-487`），**每次构建现读现判**。
   ⇒ **不存在「陈旧 metafile 放行新直连」的面**，spec 的疑虑不成立。
   `readMetafileInputs`（`:270-288`）的相对/绝对键问题按 spec MF-4 的两种写法都做了（相对键优先 + 回落），
   且回落链里有 `throw`（`:272`/`:283`）——**拿不到 inputs 时是响亮失败，不是静默放行**，符合门禁语义。

2. **门 C 的计数方向（维度 B 明确点名）**：`measured[name] > recorded[name]` ⇒ red（`:401-403`），
   下降为绿。spec §X3.3 ③ 自己勘误过的「基线改成 6（更大）方向反了」这个坑**没有踩**。
   基线 JSON 的 `$comment` 也把这条写清楚了。注入 #21/#22 双向坐实。

3. **X2 棘轮的方向性（维度 B 明确点名）**：`maxErrors` 是**天花板**（`ids.size > maxErrors` ⇒ red），
   `--update` 写入 `maxErrors: ids.size` ⇒ 「棘轮只许降不许升」成立。
   spec §X2.4 ③ 的验收（把基线调小 ⇒ 红）在实现里是**对**的（虽然 spec 那句「调到 400」的措辞
   在 371 终态下容易读反，实际应理解为「调到低于实跑值」）。注入 #10/#11 双向坐实。

4. **CI 是否真 blocking（维度 G 明确点名）**：
   - `continue-on-error` 全仓只剩 **1 处**（`ci.yml:70`，全 workspace `Lint` 步），
     且注记写明是 mobile 收口前的有意保留。**其余新增门禁步（`Encoding` / blocking `Lint` /
     `Typecheck` / `Test` / `zero-collect-guard` job）全部无 `continue-on-error`、无 `if: always()` 之类的条件放行。**
   - `zero-collect-guard` 的 `runs-on` 在 job 级（`:110`）✔，`matrix.os` 双 shell ✔，`fail-fast: false` ✔。
   - 唯一实质缺口是覆盖面（P1-1），不是 blocking 性。

5. **X4 的 dist 缺失/过期语义（维度 B 明确点名）**：缺失 ⇒ `assert.fail` 带可操作提示、
   **不降级 `test.todo`**（`public-kkv-dist-resolution.test.ts:61-69` + 文件头 `:7-8`）；
   CI 侧 `Test` 步在 `Build workspaces` 之后（`ci.yml:99` vs `:50`）⇒ 新 clone 不会恒红。
   实测 `dist/public/kkv.js` 当前存在。**这条门禁的语义完全符合 spec 判据②。**

6. **H1 的清零是真清不是探针排除**：`node scripts/check-encoding.mjs` 实跑
   `OK：扫描 3631 个跟踪文件，0 命中`，`--baseline` 口径下 bom/fffd/bad-utf8 = 0/0/0。
   隔离仓的 3 类注入全部被抓（#1~#3）⇒ **清零是真的，探针没有靠排除规则把 21+3+2 藏起来**。
   ⚠️ 但排除面本身有两处需要收窄/说明：P1-4（`android` 整段）、P2-2（`docs/Iterations` 需补量级与理由）。

7. **门 A 的「净增量」口径（spec §X3.1.1 要求不要把 4/5 算成门 A 的功劳）**：
   `apps/mobile/eslint.config.mjs:258-262` 已经把这个口径写进注释了
   （「`src/web/tsconfig.json` 的 `lib: ES2018` 已在编译期拦掉 4 个；门 A 的净增量 = `structuredClone`
   + 非类型检查路径」）⇒ **spec 的这条提醒被正确采纳**，不是空话。

8. **门 A 自定义规则的 shadowing 收集面**：`collectPatternNames`（`:169-191`）覆盖
   Identifier / ObjectPattern / ArrayPattern / AssignmentPattern / RestElement 五种 pattern，
   加上 `VariableDeclarator` 的 init、`ImportDeclaration` 的 local、`FunctionDeclaration`/`ClassDeclaration` 的 id。
   覆盖面比一般实现宽，`(:function` 收集参数这条尤其到位。**没有发现漏收集的常见形态。**
