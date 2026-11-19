---
date: 2026-11-19
---

# nm-style-toolchain：检测器工具链重写技术规格（SPEC）

> 需求来源：用户口述（无 prd.md）。核心诉求：①dead/inline 等引用计数必须形态无关（裸函数 / 对象字面量成员 / namespace / class 一视同仁，「IDE 索引符号而非声明形态」）；②现有脚本职责混乱、轻重不齐，重写为 TS 编译 + CLI + 仓库内插件式规则；③SKILL.md 随工具同步。2026-11-19 用户追拍板：④工具做成正经 npm 包（workspace `tools/nm-style`）+ `npm link` 全局命令，源码普通 `.ts`——不再走 skill 目录内 `.mts` 路线。
> 探索依据：4 份只读探索报告（2026-11-19，脚本精读 / 集成调用面 / 数据格式与 golden / TS 构建约束），关键结论已内化进本文，证据以 `file:line` 标注。
> 目标位置：主仓新 workspace 包 `D:/Dev/Js/novel-master/tools/nm-style/`（根 package.json workspaces 增 `"tools/*"`；skill 目录只留 SKILL.md 文档）；golden 对拍仓：worktree `D:/worktree/error-channel-slim` @ `p24-subject-cluster-core`（683892567）。
> 时序约束：本迭代整体落在 p25（apps+packages 裸函数收口）之前——p25 的每一波验收都吃这套工具。

## 一、设计目标

1. **symbol-index 形态无关**：一张符号表覆盖全部声明形态，dead / inline / exports 审计消费同一张表；引用计数对成员符号用 `Container.member` 限定匹配，顶层符号用裸名匹配。
2. **架构收敛**：check-inline + check-methods + find-fake-exports 三者合并为单一 `hygiene` 规则；消除 8 处复制粘贴（§二.4 清单）；消灭「每段文本跑一遍 + `--json` 再跑一遍」的双执行与 `--changed` 下 fake-exports 逐文件全仓扫描的性能热点。
3. **TS 包化**：正经 workspace 包 `tools/nm-style`（自声明 `"type": "module"`，源码普通 `.ts` → 编译 ESM `.js`），`bin` 挂 `nm-style` 命令 + `npm link` 全局可用；薄启动器自动构建（staleness 检查），零新增运行时依赖（typescript 已是根 devDep，实测 default/named import 均可用）。
4. **CLI 化**：单一入口 `nm-style`，子命令 `check / gate / list / baseline / index`；`--help` 修复为打印用法并 exit 2（现状 `parseFlags` 会把 `--help` 静默丢弃然后全量扫 core）。
5. **数据迁移**：known-false-positives 33 条逐条复核；worktree 旧 dup 基线的 `judgedAfterP17/P18` 人工裁决抢救进新基线；baseline 加 `toolVersion`。
6. **两仓收敛**：检测能力单一实现、单一副本（主仓）；worktree 的 `list-bare-exports.mjs` / `list-subject-clusters.mjs` 与旧 KFP 副本退役。
7. **修已知缺陷**（随重写自然消解，逐项列验收）：inline `isExported` 对箭头函数失效、inline `keepDirective` 对箭头函数取错父节点、check-signatures 私有 gitLines 1MB maxBuffer、suppressPrefixes 不作用于 bare-exports 段、check-oop 注释 `≥8` 与实现 `≥6` 不一致、`scripts/list-bare-exports.mjs` 幽灵引用。

## 二、现状关键事实（方案依据）

### 2.1 覆盖缺口（重写的直接动因）

| 脚本 | 定义收集口径 | 引用计数方式 |
|---|---|---|
| check-inline（:95-101） | 仅具名 FunctionDeclaration + 函数值 VariableDeclaration | 同文件裸名标识符计数（:113-125） |
| check-methods（:101-103） | 仅 ClassDeclaration 成员 | 全仓属性访问**按裸名**计数（:127-139）；private 限同文件同类名 |
| find-fake-exports（:70-96） | 仅顶层 export 声明 | 跨文件裸名聚合，只追 uniqueNames（:141），同名多定义 AMBIGUOUS 不计 |
| check-signatures（:164） | 全部函数形态（无引用计数） | — |

p24 对象化后，core 的 namespace 成员（方法简写 / 箭头属性）掉进 check-inline 与 check-methods 之间的缝；find-fake-exports 只能把整个 namespace 当 variable 记账，逐成员死代码失明。

### 2.2 确认缺陷（重写验收必须逐条勾掉）

1. check-inline `isExported`（:25-28）对箭头函数永远不命中（传入的是 initializer）→ `export const foo = () => {}` 被当私有函数计数；KFP guards.ts 2 条即此缺陷产物。
2. check-inline `keepDirective`（:84-89）对箭头函数 `node.parent.parent` 落到 VariableDeclarationList，leading comments 找不到 → 箭头函数上的 keep 指令全部失效；KFP agent-registry 条目的真因疑似此 bug 而非「>20 行门槛」。
3. check-signatures 私有 gitLines（:28-34）默认 1MB maxBuffer，`--range` 大 diff 静默失败返回空文件集（style-utils 版已是 64MB，双实现漂移）。
4. suppressPrefixes 与 KFP 只覆盖 signatures/inline/methods 三段（check-style.mjs:39 SEGMENTS 白名单），bare-exports / fake-exports / oop 不可豁免——`apps/cli/` 的新增裸导出在 `--changed` 下仍会报。
5. check-oop.mjs:7 注释「≥8」与 :93 实现「≥6」不一致。
6. check-style.mjs:225 注释与 SKILL.md:506 引用的 `scripts/list-bare-exports.mjs` 在主仓不存在（worktree 独有）。
7. check-style 每段双执行（文本透传 + `--json` 重跑，:140-153）；`--changed` 下 fake-exports 每个改动文件各起一次子进程、每次内部全仓 walk（:162-171 + find-fake-exports.mjs:143）。

### 2.3 集成契约（重写必须保形或显式声明变更）

- nm-style 脚本**不进 package.json / git hooks / CI**（scripts/README.md:3「手动执行，不进 CI」），全部调用由 SKILL.md 与 Iterations spec 文档驱动 → CLI 形状变更的同步面是文档，不是自动化。
- 硬契约：check-style 汇总行格式 `check-style: PASS|FINDINGS（signatures=… inline=… methods=… exports=… bare-exports=… oop=…）`（check-style.mjs:250，多处 spec 验收读数依赖）；退出码三值制 0/1/2（scripts/README.md:22）；KFP 匹配键 `segment+file+symbol(+line)` 与 `suppressPrefixes`（check-style.mjs:96-106, :80-82）；`keep-bare` 注释须在 export 行前 3 行内（:187）；`keep-local` 现行语义 = 单点引用且 >20 行（check-inline.mjs:130，与 SKILL.md:29「行数不是理由」的张力保持现状不动，不在本迭代解决）。
- `check-style --all` 因既有债恒 exit 1、「只记录不当通过条件」是 5+ 处文档的既有约定 → 新工具保持同语义（全量体检通道存在、阻断口径不变），文档约定无需翻案。
- p25 将继续按 subject-cluster-oop spec §八 的命令面跑 → cutover 后该节命令必须换成新 CLI。

### 2.4 可合并的重复实现（8 处）

1. find-fake-exports 自带全套工具副本且已漂移（SKIP_DIRS 缺 `build`、isTestPath 缺 `/e2e/`，:32-64 vs style-utils.mjs:13, :31-33）。
2. gitLines 双实现（64MB vs 1MB）。
3. passThroughCall 两份全同（check-inline.mjs:39-46 = check-methods.mjs:59-66）；isPassThrough/isParamDerived 两份近似（对象字面量分支只在 inline 版）。
4. keepDirective 三份（inline / methods / fake-exports keepPublicOf，别名写法还各不相同）。
5. BLOCKING verdict 集合两份手工同步（check-style.mjs:40 与 check-methods.mjs:181）。
6. 「collectFiles→parseSource→forEachNode→isAdded→sort→formatTable→JSON 双模」管线样板 ×6。
7. 函数形定义收集三处各自实现（inline :95-101 / oop :30-45 / fake-exports :70-96）——正是 symbol-index 要统一的核心。
8. 导出识别四处（inline isExported+exportedNamesOf / oop isExported / fake-exports hasExportModifier）。

### 2.5 数据与 golden 现状

- 主仓 `scripts/dup-signatures-baseline.json`：`{note, namedGroups:66, shapedGroups:176, named:{…}, shaped:{…}}`；gate 只比键集合（新增键 → exit 1），site 列表纯展示；基线路径**相对脚本**（list-dup-signatures.mjs:163）→ 借调时恒用主仓基线——主仓这份 66/176 实为扫 worktree p24 态的快照（主仓自身 src 非 p24 形态，两仓 src 差 1885 文件）。
- worktree `scripts/dup-signatures-baseline.json`：105/253 旧态，含 `judgedAfterP17`（named 12 组 + shaped 4 组）与 `judgedAfterP18`（shaped 1 组带理由）人工裁决——**唯一完整副本，迁移时必须先抢救**；现行工具已不读它。
- worktree `scripts/bare-exports-baseline.json`：`{note, generatedAt, includeTests:false, files:{path:[fnNames]}}` = 283 文件/816 函数，由 `list-subject-clusters.mjs --update-baseline` 写回，clusters gate 与 bare-exports gate 共用。
- KFP：`{note, matching, entries[33], suppressPrefixes:["apps/cli/"]}`；entry 字段 `segment|file|symbol(null=整文件)|line?(0 使用)|category?(6 条缺)|reason|basis?`；分布 inline 19 / methods 13 / signatures 1；worktree 旧副本 29 条已分叉。
- golden 对拍期望（子代理已在 p24 tag 现场验证全 PASS）：bare-exports gate 283→283（新增 0）、`list-bare-exports --summary` TOTAL 283/816 且 core 桶 0 行、dup gate 同名 66→66 / 形态 176→176、clusters gate PASS、A 类旧名 grep（core 侧）0。

### 2.6 TS 构建与包化约束（探索实测 + 用户拍板 npm link）

- 根 package.json 无 `"type"` 字段、workspaces 仅 `packages/*` + `apps/*`（package.json:7-10）→ 工具做成 `tools/nm-style` 包并加入 workspaces（增 `"tools/*"`）：包内自声明 `"type": "module"`，源码普通 `.ts`，tsc 产出 `.js` 即 ESM（NodeNext 相对导入写 `.js` 后缀）。CJS emit 路线否决（与 README「禁止 require」冲突、丢顶层 await）；原 `.mts` 路线随之作废——`.ts` 本就在 check-encoding.mjs:52 白名单内，**无需再动编码门禁**（dist/ 在 skip 名单）。
- typescript 6.0.3 纯 CJS、无 `exports` 字段，`import ts from "typescript"` default/named 实测均通；包在 workspaces 内由根 devDep 提升满足，不新增依赖。
- 编译调用必须 `spawnSync(process.execPath, [<node_modules>/typescript/bin/tsc, "-p", <tsconfig>])` 参数数组式（win32 无 shell 时 `.cmd` shim 不可执行）。
- tsconfig 继承根 `tsconfig.base.json`（ES2022/NodeNext/strict），关闭 `composite/declaration/declarationMap`，**不写 baseUrl**（写了才需要 ignoreDeprecations，packages/core 的坑）；`dist/` 已被根 .gitignore:4 全局忽略。
- `npm link`（用户拍板）：包声明 `bin: {"nm-style": "./bin/nm-style.mjs"}`，在主仓根 `npm link -w nm-style`（仿既有 `link:cli` 先例，避免包目录内裸 link 的 npm 版本差异）link 一次 → 全局 `nm-style` 命令在任意 cwd（含两个 worktree）可用，且**永远执行主仓构建**——工具版本天然收敛为单一来源。Windows 下 npm 生成 `.cmd`/sh shim，Git Bash 可用。
- 根 build 聚合（有意选择，显式声明）：nm-style 的 `build` script 经根 `npm run build --workspaces --if-present` 进入 CI build 步（ci.yml blocking）——顺带当编译门禁，系有意选择；test/typecheck/lint/format:check 聚合对新包 `--if-present` 安全跳过（新包只声明 build，不声明这些 script）。副作用：新增 workspace 必须重生成 package-lock.json 并提交，否则 CI 的 `npm ci` 同步校验直接红。
- cwd 契约：保持「cwd = 被扫仓根」（SKILL 用法行与各 spec 都依赖）；启动器与 dist 自身资产（known-false-positives.json）一律 `import.meta.url` 定位，禁止用 cwd 定位自己的东西。
- tsx 4.22.3 虽在根提升，但属 apps/cli 的 devDep——跨包隐式依赖提升产物不稳，否决「tsx 直跑」路线，理由记录在案。

## 三、总体方案

### 3.1 目标架构

```text
tools/nm-style/                          # 新 workspace 包（根 workspaces 增 "tools/*"）
├── package.json                         # name nm-style / private / type: module / bin: nm-style→./bin/nm-style.mjs / scripts.build = tsc -p
├── tsconfig.json                        # extends 根 tsconfig.base.json；rootDir src、outDir dist；关 composite/declaration；不写 baseUrl
├── bin/nm-style.mjs                     # 薄启动器（shebang）：src/dist staleness → 自动 tsc → 拉起 dist/cli.js 透传 argv 与退出码
├── known-false-positives.json           # 随包迁来（dist 侧按包根定位；schema 见 §3.5）
├── src/                                 # TS 源（.ts）
│   ├── cli.ts                           # 子命令分发：check / gate / list / baseline / index / --help
│   ├── lib/
│   │   ├── core.ts                      # walk/collectFiles/toPosix/isTestPath/parseSource/lineOf/formatTable/parseFlags
│   │   ├── git.ts                       # gitLines(64MB)/changedFiles/addedLineFilter(hunk 配对)/headExportFnNames/worktreeMainRoot
│   │   ├── symbols.ts                   # symbol-index：收集 + 限定引用计数（本重写的核心）
│   │   ├── directives.ts                # keep-bare/keep-local/keep-public 统一解析（修箭头函数找错节点 bug）
│   │   ├── kfp.ts                       # known-false-positives 加载 + 匹配（键：rule+file+symbol+line）
│   │   └── report.ts                    # Finding 类型 / verdict 集合 / 表格与 JSON 输出 / 退出码聚合
│   └── rules/
│       ├── signatures.ts                # §2 五类拆行检测，判据原样迁移（含 --range/--since）
│       ├── hygiene.ts                   # inline+methods+find-fake-exports 三合一（吃 symbol-index）
│       ├── bare-exports.ts              # 正则口径 + 豁免链 + HEAD 兜底原样迁移；--changed 拦新增
│       ├── dup.ts                       # 同名/同形态签名 gate（baseline v2）
│       ├── clusters.ts                  # bare-exports gate + 域桶清单（接 worktree 两脚本的职责）
│       └── oop.ts                       # OOP 候选（≥6 判据为准，注释修正）
└── test/                                # node --test（.test.mjs，经 bin 启动器驱动被测 CLI；构建新鲜度由启动器保证）

.agents/skills/nm-code-style/
└── SKILL.md                             # 随 cutover 改写；命令一律指向 nm-style（npm link 后的全局命令，node <主仓>/tools/nm-style/bin/nm-style.mjs 为兜底）
```

### 3.2 symbol-index 设计（§一.1 的落地）

**Symbol 定义**：`{ name, container: null | {kind:'namespace'|'object'|'class', name}, form, file, line, exported, isPrivate, deprecated }`；`form` 八值枚举（本节为唯一权威清单，§七 T-SI 以此为准）：`bare-fn | var-fn | object-method | object-arrow | object-binding | class-method | class-accessor | namespace-object`。

收集口径（一表全收，判定层各自取用）：
- 具名 FunctionDeclaration（bare-fn）、函数值 VariableDeclaration（var-fn）——**不限顶层**：函数体内的嵌套具名函数/函数值变量同收（对齐旧 check-inline 全树遍历与旧 dup 全递归口径；现存基线 named 组的 feed/drain/finishPartial 物理载体就是工厂内嵌套函数，收窄会让 dup 组静默消失、judged 裁决悬空）。
- 对象字面量成员：方法简写（object-method）、箭头/函数表达式属性（object-arrow）——namespace 对象、工厂返回对象、port 实现对象同口径。
- **绑定形态成员（object-binding，新增）**：对象字面量的标识符值属性（`{ check: checkForUpdates }`）与对已知 namespace 对象的成员赋值（`Ns.check = fn`）——视为「成员注册」：被绑定函数同时登记为该容器的成员符号（参与 `Container.member` 限定计数），绑定位的裸名引用**不计消费**。这是旧 PromptBuilder/UpdateCheck 六条 KFP 假阳性的机制级修复。
- class 成员：MethodDeclaration / Get/SetAccessor（class-method / class-accessor）。
- 顶层导出的 namespace 对象本身入表（namespace-object，供 exports 审计判整对象死活）。

**引用解析**：
- 顶层符号（container=null）：全仓裸名标识符计数，剔除定义名 / 属性名位置 / Import/ExportSpecifier / TypeReference / TypeQuery / 自引用 / JSDoc 与注释节点（遍历用 `forEachChild` 语义——旧 getChildren 全遍历把 `{@link}` 当引用是已证假阳性源）。
- 成员符号：按 `Container.member` 属性访问链计数（`LogFactory.create(...)` 命中 LogFactory 的 create）；接收者无法静态归因到具体容器时，按属性名命中**全部同名成员**——保守归因，宁可漏报不误杀删除建议。跨容器同名不互算。
- private class 方法沿用旧限定：只数**同文件且同类**的引用（`this.helper()` 的接收者未知不得跨类归因，防 private 计数虚增漏报 DEAD）；isPrivate 字段即为此接。
- **导出面（exported 符号）计数沿用 fake-exports 机制全套**：import 感知（named / `as` 别名 / namespace import 解析）+ prod/test 分桶（isProductionPath 口径：`packages/*/src`、`apps/*/src`、非 test、`packages/core/src/public/` 不算消费者）+ 只追仓内唯一名（uniqueNames，同名多定义直接 AMBIGUOUS 短路一切 verdict）+ public snapshot allowlist（`packages/core/test/package-exports/snapshots/*.json`，按被扫仓根定位，决定 prod=0 时判 FAKE_PUBLIC 还是 DEAD/TEST_ONLY）。
- 显式不做（v1 边界，写进 SKILL）：不上 `ts.createProgram` 语义解析——port 接口经实现对象转发的调用点按属性名保守归因已覆盖九成，残余场景继续走 KFP port-impl 条目兜底；真被咬了再立 v2。

### 3.3 规则与 verdict 语义

| 规则 | 来源 | verdict |
|---|---|---|
| signatures | check-signatures 原样 | PARAMS/ARGS/IMPORT/VARDECL/ASSIGN（全阻断，无豁免 verdict，保持现状） |
| hygiene | 三合一 | `FAKE_PUBLIC` / `DEAD` / `TEST_ONLY` / `INLINE_CANDIDATE` / `PASS_THROUGH` / `AMBIGUOUS` / `KEEP_PUBLIC` / `KEEP_LOCAL`；每行附 `face`（private / class-public / exported）与 `form` 列。旧名映射与阻断矩阵见下 |
| bare-exports | check-style 内置段 + worktree list-bare-exports 口径合一 | `BARE_EXPORT`（--changed 阻断；--all INFO 计数）；豁免链不变（.tsx PascalCase / use* / 前 3 行 keep-bare / HEAD 同名兜底）；实现口径以 worktree 基线生成器为权威（同名重载去重保留首行、扫描域见 §3.5.3） |
| dup | list-dup-signatures 并入 | gate 比键集合，语义不变；baseline v2 |
| clusters | worktree 两脚本收编 | **四视图全保留**（同主体族 / 修饰词复读 / 长名榜 / 裸函数榜 → `list clusters --all`）+ 域桶清单（`list bare --summary|--bucket`）；基线 gate 并入 `gate bare`（旧 `--gate` 读的就是 bare-exports-baseline，同源合一，不再设独立 `gate clusters`） |
| oop | check-oop 原样 | OOP_CANDIDATE / MANY_EXPORTS（≥6）；默认记录，`--strict` 才阻断（现状保形） |

**hygiene 旧名映射**：FAKE_PUBLIC 保留原名；DEAD_LOCAL/DEAD_METHOD/DEPRECATED_DEAD→`DEAD`（deprecated 进 note），DEPRECATED_METHOD→deprecated 进对应行 note（旧版「deprecated 优先于一切」分支是已证误报源，KFP 多条佐证）；INLINE_LOCAL/INLINE_METHOD→`INLINE_CANDIDATE`；PASS_THROUGH_METHOD→`PASS_THROUGH`；fake-exports 正向 `KEEP` 并入 `KEEP_PUBLIC`；AMBIGUOUS_METHOD→`AMBIGUOUS`。**求值顺序**：同名多定义（uniqueNames 之外）→ `AMBIGUOUS` 短路一切；否则 PASS_THROUGH 判定 → 引用计数分支（0/1/多）→ keep 指令裁决。PASS_THROUGH 判定取两旧版判据并集（对象字面量实参分支 + this/super callee 分支）。

**hygiene 阻断矩阵（verdict × face × mode，保旧语义）**：

| face | 阻断条件 |
|---|---|
| private（私有顶层/嵌套函数、private class 方法） | 非 KEEP_LOCAL 全阻断（= 旧 inline 段 + methods 段私有面，任何模式）；AMBIGUOUS 短路不计阻断（旧版 AMBIGUOUS 仅产生于公有方法，不新增扩张） |
| class-public（公有 class 方法） | DEAD / INLINE_CANDIDATE / PASS_THROUGH 阻断（= 旧 methods 白名单，任何模式）；AMBIGUOUS / KEEP_* 不阻断 |
| exported（顶层导出与 namespace 成员导出） | FAKE_PUBLIC / DEAD / TEST_ONLY / INLINE_CANDIDATE 仅在 `--changed`/`--all`/`--strict` 模式阻断（= 旧 exports 段：默认目录模式恒不阻断） |

**KFP 覆盖面（显式声明）**：KFP/suppressPrefixes 值域收窄为**有行结构的规则** `signatures | hygiene | oop`；`segment` 字段更名 `rule`，旧值映射 `inline→hygiene`、`methods→hygiene`。**bare-exports / dup / clusters 不吃 KFP**——bare-exports 的豁免唯一通道是源码内 `nm-style: keep-bare` 注释（显式、随代码走），gate 类新增即红，不允许清单静默放行。匹配算法不变（rule+file+symbol.endsWith('.'+symbol)+line 可选），但 signatures 段的 symbol 匹配改用「detail 包含 symbol」——旧精确/后缀匹配对 signatures 的 detail（调用表达式切片）从来匹配不上（raceWithCancel 条目即实例），迁移复核时按「匹配键失配」归档。

**check 命令的阻断口径（与旧 check-style 逐项对齐）**：`check` = signatures + hygiene（按上矩阵）+ bare-exports（--changed 阻断 / 否则 INFO）+ dup-gate 透传（**不阻断**，保持现状）+ oop（仅 --strict 阻断）。缺省扫描面 = `<cwd>/packages/core/src`（保旧默认）。汇总行：`nm-style: PASS|FINDINGS（signatures=… hygiene=… bare-exports=… dup=… oop=…）`——相对旧格式的全部变更（前缀 check-style→nm-style、inline/methods+exports 三段并为 hygiene、新增 dup 段）记入 §3.6 文档同步清单。

### 3.4 CLI 与启动器

```text
nm-style <command> [args]                # npm link 后全局可用；兜底 node <主仓>/tools/nm-style/bin/nm-style.mjs
  check   [--changed | --all | <paths...>] [--strict] [--json] [--include-tests]   # 缺省扫 <cwd>/packages/core/src
  gate    dup | bare                     # dup=键集合比对；bare=bare-exports-baseline 比对（原 clusters gate 同源并入）；新增 0 才 exit 0
  list    bare --summary | --bucket <桶> | clusters --all   [--json]               # 域桶清单 / clusters 四视图
  baseline write dup | bare             # 重生成基线（必须显式 --baseline <path>，防误写）
  index   [--json]                      # 调试：dump symbol-index
  --help / 无参 / 未知命令               # 打印用法，exit 2（修现状 --help 静默全扫的坑）
```

- 启动器 `bin/nm-style.mjs`：`import.meta.url` 自定位 → 递归比较 `src/` 与 `dist/` mtime → 落后则 `spawnSync(process.execPath, [tscBin, "-p", tsconfig])`（tscBin 由包位置向上解析 node_modules/typescript/bin/tsc）→ 再拉起 `dist/cli.js` 透传 argv 与退出码。编译失败 exit 3（不与 0/1/2 混淆）；typescript 缺失给可读报错。link 指向主仓包 → 所有 worktree 天然共用主仓构建与版本。**构建互斥**：多进程并发触发重编译时以锁文件/临时目录原子换名串行化（`node --test` 并行场景防半成品 dist）。
- 资产定位：`known-false-positives.json` 随包走（包根），dist 侧按 `import.meta.url` 回指包根定位；baseline 定位规则——`gate` / `list` / `check` 的内置 dup 透传**可省略**，默认 `<被扫仓根>/scripts/<对应基线文件>`（dup→dup-signatures-baseline.json、bare→bare-exports-baseline.json）；`baseline write` **必须显式** `--baseline <path>`（防误写）——**废除「脚本在哪个仓就用哪份基线」的暗语义**，借调 worktree 时行为由参数与默认值显式决定。
- 退出码全局约定：0 = 干净 / gate 无新增；1 = 有发现或 gate 新增；2 = 用法错误或缺文件；3 = 构建失败。

### 3.5 数据迁移

1. **KFP 33 条逐条复核**（cutover 的硬门槛）：新工具对 worktree p24 tag 全量跑 → 每条旧 entry 判「不再命中（缺陷修复后自然消解）→ 移入文件尾部 `retired` 段留档」或「仍命中 → 迁移为 `rule` 新 schema」。预期批量退役 **9 条**：guards.ts 2 条（isExported 箭头 bug）、PromptBuilder/UpdateCheck 成员绑定 6 条（object-binding 注册语义修复）、agent-registry 1 条（keepDirective bug 修复后函数 23 行 > 20 门槛、keep-local 生效）。smart-sort-rule 1 条**预期迁移而非退役**——函数体约 13 行，bug 修复后仍不满足 keep-local 的 >20 行豁免（§2.3 锁死不动），按「仍命中」迁移并保留理由。raceWithCancel（signatures 段）复核时注意旧匹配键从来未命中过（§3.3 匹配修复说明），按「匹配键失配」归档而非「缺陷修复」。worktree 旧副本（29 条）直接废弃。
2. **dup baseline v2**：schema 加 `toolVersion`、`generatedAt`；`judged` 段从 worktree 旧文件抢救 `judgedAfterP17/P18` 全部人工裁决（named 12 组 + shaped 4 组 + shaped 1 组，含理由文本）并入；`named/shaped` 机械重生成。gate 语义不变（键集合比对，新增 exit 1）。主仓 66/176 是旧工具口径——新工具口径变化**双向影响键空间**（嵌套函数收录已对齐旧全递归口径、namespace 方法新入表），**允许基线数值变化**，以「p24 tag 上重生成 → delta 清单落盘为文件、逐组双向过目（新增组=新收口 namespace 同名方法族；**消失组必须为 0**——嵌套口径已对齐，出现消失即口径回退）」为对拍标准，替代旧数值。
3. **bare-exports baseline**：`files` map 结构不变，加 `toolVersion`；p24 tag 重生成必须与现存 283 文件/816 函数 **`files` map 逐文件逐函数零 diff**（note/generatedAt/toolVersion 等元数据字段除外）。实现口径逐条钉死（两份旧实现本身不一致，**取 worktree 基线生成器口径为权威**）：同名重载去重保留首行；扫描域 = `packages/*/src` + `apps/(desktop|mobile)/src`、排除 apps/cli 与 `.d.ts`、`git ls-files` 含 `--others`（未跟踪文件计入）；`check --all` 的 INFO 计数与 `baseline write bare` 都用该域（废掉旧 check-style 段默认只扫 core 的行为）——该域是 bare-exports 规则的**全域口径**，`check --changed` / `check <paths>` 下的该段同域；bare-exports 段不吃 KFP/suppress（§3.3），gate 新增即红。
4. 生成方式：`nm-style baseline write dup|bare` 取代 `--write-baseline` / `--update-baseline`。

### 3.6 两仓收敛与 cutover

- 单一实现落主仓 `tools/nm-style`（git 跟踪，worktree rebase 即得源码副本；运行时统一走 npm link 的全局命令 = 主仓构建）。
- worktree 退役：`scripts/list-bare-exports.mjs`、`scripts/list-subject-clusters.mjs`（职责已由 `gate bare` + `list bare` / `list clusters` 接管）、`.agents/skills/nm-code-style/scripts/` 旧副本（随 rebase 被主仓新版覆盖）、旧 KFP 29 条副本。`scripts/bare-exports-baseline.json` **保留原地不动**（p25 的锁存基线）。
- 主仓退役：`scripts/list-dup-signatures.mjs`（并入 dup 规则）；`list-all-signatures.mjs` 保留不动（纯盘点，不涉判定）。旧检测器 6 脚本 + lib + 5 个 test 在 burn-in 全绿后删除。
- 文档同步面（cutover 步骤内完成）：SKILL.md（§4.1 verdict 表 / §5 引用别名 grep / §8 工具表与自测命令 / §8.1 / §9.4 / §9.7 检测器命令 / 交付前检查 / 未处理项表头）；scripts/README.md（:3 直接 node 跑条款加编译型工具例外、:17 ESM 条款注明 tools 包自声明 type:module、:19-20 shebang 与文件头义务落点、:22 退出码三值制加「3=构建失败」例外、prettier-guard 路径、门禁表）；knip.json（新 workspace 若被扫出未用导出则登记 bin 入口）；worktree subject-cluster-oop spec 的 **§二/§四/§六/§八** 中全部检测器命令行与验收读数换新（p25 执行依据，不只 §八）；汇总行格式变更（前缀 nm-style、hygiene 合段、新增 dup 段）在 SKILL 与 p25 spec 验收读数处同步。历史 Iterations spec 是既往执行记录，不回写。

## 四、最终项目结构

见 §3.1。worktree 侧最终态：scripts/ 只剩 `bare-exports-baseline.json`、`dup-signatures-baseline.json`（salvage 后保留旧件，p25 收口后统一清理）、`typecheck-workspaces.mjs`、`check-public-ownership.mjs` 等非 nm-style 工具；检测器统一走 npm link 的全局 `nm-style`（= 主仓构建）。

## 五、变更点清单

**新增**：`tools/nm-style/`（package.json + bin 启动器 + tsconfig + `src/**`（cli + lib×6 + rules×6）+ known-false-positives.json 迁入 + `test/**`）；根 package.json workspaces 增 `"tools/*"`（仅此一处）。
**改写**：`SKILL.md`（工具章节）、根目录 `scripts/README.md`（§3.6 列明的条款）、`tools/nm-style/known-false-positives.json`（schema 迁移）、主仓 `scripts/dup-signatures-baseline.json`（v2 重生成 + judged 并入）、`knip.json`（如需）。
**删除**（burn-in 后）：主仓 6 检测器 + lib/style-utils.mjs + 5 个 test-*.mjs + scripts/list-dup-signatures.mjs；worktree 两个 list-*.mjs；测试夹具残渣目录 `.agents/skills/nm-code-style/scripts/packages/`、`scripts/tmp/` 幽灵件；cutover 后 `.agents/skills/nm-code-style/` 只剩 SKILL.md。
**不碰**：根 package.json 除 workspaces 一行外的全部内容、git hooks、CI 配置、根 tsconfig.base.json、worktree 的 bare-exports-baseline.json、`docs/Iterations/create-factory-ownership/spec.md`（用户修改态，永不 commit）。

## 六、详细实现步骤

- Step 1 — phase-scaffold — blocking: yes — qa: auto：`tools/nm-style` 包骨架（package.json + tsconfig + bin 启动器）+ hello 空规则跑通 + 根 workspaces 增 `tools/*` + 根 `npm install` 重生成 package-lock.json（CI `npm ci` 同步校验依赖）+ 根 `npm link -w nm-style`（仿 `link:cli` 先例）。验收：link 后任意 cwd 下 `nm-style --help` exit 2；首跑自动编译；src 改动后再跑触发重编译；编译中途失败 exit 3；worktree 根下（cwd=worktree）`nm-style` 同样可用且用主仓构建；`npm ci` 不因 lockfile 失同步而红。
- Step 2 — phase-core-lib — blocking: yes — qa: auto：core/git/directives/kfp/report 迁移。验收：addedLineFilter hunk 配对与 HEAD 兜底各有红绿单测（现状零覆盖）；directives 对箭头函数取到注释（回归旧 bug）；KFP 33 条加载零警告、匹配算法单测（含 symbol:null 整文件、`.symbol` 后缀、suppressPrefixes）。
- Step 3 — phase-symbol-index — blocking: yes — qa: auto：symbols.ts。验收：§3.2 八值 form 收集矩阵单测（嵌套函数、object-binding 两形态必含）；限定计数断言（跨容器同名不互算、`Obj.member` 命中、object-binding 注册位不计消费、裸名不串扰成员、定义点/类型位置/JSDoc 剔除）；private class 方法同文件同类限定；port 属性调用保守归因用例。
- Step 4 — phase-rule-signatures — blocking: yes — qa: auto：signatures 迁移 + `--range/--since`；旧 62 行测试用例语义全量搬运并转绿。
- Step 5 — phase-rule-hygiene — blocking: yes — qa: auto：三合一。验收：旧 test-inline/methods/find-fake-exports 全部用例语义搬运（verdict 按映射表换名、阻断按 §3.3 矩阵）；新增 object-member/class-method 的 DEAD/INLINE 用例；`--changed` 行过滤 + 引用面恒全仓语义保形；§3.5.1 预期退役 9 条（guards 2 + 成员绑定 6 + agent-registry 1）在 p24 tag 上确认不再触发（进 retired），smart-sort-rule 1 条确认「仍命中」并迁移。
- Step 6 — phase-rule-gates — blocking: yes — qa: auto：bare-exports / dup(v2+judged salvage) / clusters / oop。验收：bare-exports 正则与豁免链对旧实现逐条 diff 为零；`--changed` 下新增裸函数 fixture 报 BARE_EXPORT、HEAD 已有名不报；dup gate 新增键 exit 1；`--help` exit 2。
- Step 7 — phase-golden-burnin — blocking: yes — qa: auto：worktree p24 tag（cwd=worktree；旧工具一律用主仓副本与主仓 33 条 KFP 对拍）三门对拍 + 全量扫描，delta 与复核清单**落盘为文件**。验收：bare-exports 基线重生成 `files` map 零 diff（283/816）；dup 基线 v2 重生成，delta 文件逐组双向可解释（消失组=0，新增组=namespace 同名方法族；人工过目不阻塞 exit code）；`gate bare` PASS（283→283）；`check --all` 输出与旧 check-style 各段发现数对照，差异可归因到已知缺陷修复**或 §3.2/§3.3 显式声明的口径变更**，零其他不明差异；KFP 33 条复核清单落盘（retired / migrated 双向有据）。
- Step 8 — phase-cutover-docs — blocking: yes — qa: auto：删除旧脚本与幽灵夹具；SKILL.md / scripts/README.md / knip.json（如需）/ worktree subject-cluster-oop spec（§二/§四/§六/§八）同步；随后按序：**主仓 cutover commit → worktree rebase**（`.agents/skills/nm-code-style/scripts/` 为 modify/delete 冲突，预期解法 `git rm -r` 保主仓删除；根 package.json workspaces 冲突手并保 `tools/*`）→ **worktree 退役 commit**（两个 list-*.mjs 删除 + KFP 旧副本废弃）。
- Step 9 — phase-cleanup — blocking: no — qa: auto：主仓 `nul` 残渣与 `scripts/tmp` 幽灵件提示用户处置；记忆收尾。

## 七、测试策略

统一 `node --test tools/nm-style/test/`（目录参数，Node 20 兼容；fixture 就地构造，禁止再污染 cwd——旧夹具残渣教训；git 依赖用例在 gitignored `tmp/` 临时 `git init` 构造、用完清理）；T-BS 组与触发重编译的用例以 `--test-concurrency=1` 跑（构建互斥兜底）；每个规则至少一正一负；形态矩阵以 §3.2 八值 form 为准 × 判定（DEAD / INLINE）全覆盖。

- T-SI1~T-SI8 — blocking: yes — 八值 form 收集与限定计数各一（嵌套函数、object-binding 注册位不计消费必含）（映射 Step 3）
- T-LB1 — blocking: yes — addedLineFilter hunk 配对红绿（纯新增报 / 移动不报）（映射 Step 2）
- T-LB2 — blocking: yes — HEAD 同名导出兜底（映射 Step 2）
- T-DI1 — blocking: yes — 箭头函数 keep-local/keep-public 指令生效（回归旧 bug）（映射 Step 2）
- T-KF1~T-KF3 — blocking: yes — KFP 匹配三态：symbol 精确 / null 整文件 / `.symbol` 后缀 + suppressPrefixes（映射 Step 2）
- T-RS1~T-RS5 — blocking: yes — signatures 五类各一正一负（映射 Step 4）
- T-HY1~T-HY8 — blocking: yes — hygiene：对象成员 DEAD / 对象成员单点 INLINE / 导出面 TEST_ONLY / FAKE_PUBLIC×public snapshot allowlist / AMBIGUOUS 短路 / PASS_THROUGH 顶层与 class 两形态 / strict 与默认模式阻断差异（导出面）/ deprecated 进 note 不再吞判定（映射 Step 5）
- T-BA1~T-BA3 — blocking: yes — bare-exports：--changed 新增报 / HEAD 既有名不报 / 同名重载去重保留首行（映射 Step 6）
- T-DU1~T-DU3 — blocking: yes — dup gate 新增键 exit 1 / 消除键不阻断 / v2 schema 含 toolVersion 与 judged 段存在性断言（映射 Step 6/7）
- T-CL1~T-CL2 — blocking: yes — `gate bare` 基线比对 + `list bare --summary|--bucket` + `list clusters --all` 四视图（映射 Step 6）
- T-OP1~T-OP2 — blocking: yes — oop：共享可变状态 OOP_CANDIDATE 正例 / class 实例模块负例（映射 Step 6）
- T-GD1~T-GD3 — blocking: yes — golden 三门对拍（bare 零 diff / dup delta 双向可解释且消失组=0 / gate bare PASS）（映射 Step 7）
- T-BS1~T-BS3 — blocking: yes — 启动器：staleness 重编译 / 编译失败 exit 3 / --help exit 2（映射 Step 1）

## 八、风险与回滚

| 风险 | 缓解 |
|---|---|
| golden 对拍不齐（新口径发现数对不上旧工具） | Step 7 是硬门槛：不齐不 cutover，旧脚本保留并行，逐差异归因；回滚 = 删 src/ 与启动器（git revert 即可，旧脚本至 Step 8 前始终在库） |
| KFP 回爆（条目匹配不到 → 重新阻断） | Step 5/7 两道复核：retired 迁移必须给出「新工具不触发」的运行证据，不许凭推断退役 |
| dup 基线数值跳变引发误读 | §3.5.2 显式允许数值变化，以 delta 逐组可解释替代旧数值锁定；judged 人工裁决先抢救后重生成 |
| worktree / 主仓漂移复发 | 单一实现 + 单一副本；cutover 步骤含 worktree 侧退役提交；基线显式参数化废掉暗语义 |
| p25 时序被本迭代拖住 | 若 Step 7 超 1 个工作日未收敛 → 降级预案：旧架构上打两个最小补丁（inline 收对象成员 + 成员限定计数）放行 p25，重写继续并行；本迭代完成前 p25 不开工是首选序 |
| npm link 环境差异（换机 / link 丢失 / 未 link） | SKILL 记录兜底调用形态 `node <主仓>/tools/nm-style/bin/nm-style.mjs`，与 link 等价（同一启动器同一构建）；link 只是便捷层，不是正确性依赖 |
| check-style 汇总行格式被外部读数依赖 | 段名变更（inline/methods→hygiene）列进 cutover 文档同步清单，逐处改读 |
| worktree rebase 冲突（modify/delete + workspaces 手并） | Step 8 顺序写死（主仓 cutover commit → rebase + `git rm -r` 决断 → worktree 退役 commit）；退役提交必须落在 rebase 之后 |
