---
name: nm-code-style
description: novel-master 的代码优化与重构原则。写新代码、重构、内联收敛、假引用/假公开审计、错误处理、命名与文件放置、CR 修复时使用。
---

# nm 代码优化原则

写、改、重构代码前先过一遍这份清单。目标是**让代码更短、更直、更少层**，不是把代码摆得更"整齐"。

## 1. 先内联，再判断

- **类内方法同样受单点内联/死代码检查**：private 方法只有一个类内调用点就内联；零引用删除；`return this.f()` / `return f(x)` 这类薄包装删除。private 方法只有在 >20 行、承担独立不变量或管线阶段且有多个调用点时才保留，并写 `nm-style: keep-local — 理由`。
- 类里用 private 字段承载状态；不要为了“封装”给字段再加一层 private getter/setter。
- 模块级单点调用的私有函数同样内联；`z.preprocess` 的回调、`transform`/`toWire` 这类只挂一次的映射也直接写成箭头。
- 只有**被多处复用的纯比较/纯映射**才留模块级私有函数（如 `sameToolUse`）；内联会制造三份 `JSON.stringify` 时，留函数是对的。
- 内联后重点检查四件事：重复条件、可合并的连续步骤、只为下一步服务的中间变量、恒真/恒假的形状守卫。

先例：`DoomLoopDetector` 内联三个 private 方法后，发现轨迹已裁到恰好一个窗口，`slice(-crossRoundWindow)` 是多余复制；`validateAgentDefinition` 内联后，`prompts` 的对象/数组检查被证明冗余，直接要求 `persist`/`dynamic` 是数组即可。

- **死代码沿调用链删到底**：一个符号只剩测试/barrel 引用时，先找它的调用方；调用方自己也没有生产调用，就继续往上，整条链一起删，不要只删叶子留下空壳 caller。先例：`applyAnnotateHighlights` 生产零调用，它的 `findAnnotateOccurrenceInSource` / `buildFlatTextIndex` / `estimateSoftOffsetRangeFromQuoteContext` 全部只服务这条死链，最终整条链与两个 logic 文件一起删除。

## 2. 一行写完

- **函数签名、调用参数列表写在一行**，不按参数拆行。参数多到一行放不下，先减少参数或缩短参数名，而不是换行。
- `new XxxError("CODE", "message")` 也写一行，不要为了"可读"把 code 和 message 拆成两行。
- 简单表达式不要拆成多行；只有长条件确实需要分段时才换行，且换行后每段要能独立读懂。
- 导入语句能一行就一行。

## 3. 错误进 Either，不抛

- 域逻辑/校验函数返回 `Result<T, E>`（`Result.ok` / `Result.err`），函数体内不 throw。
- 在**边界**统一决定是否抛：runner、service、tool、IPC handler、CLI 命令处写 `if (!result.ok) throw result.error;`。边界之外不再复制判断。
- 不要给错误工厂再包一层：`agentDoomLoop()` 这种只有 `new AgentError` 的 wrapper 直接删，调用点写 `new AgentError(...)`。
- 不要为了"统一"把本来有 code 的域错误包成 `Error` 或丢失 code；要么保留域错误，要么迁到统一 `AppError` 注册表，别造中间壳。
- zod 的 `preprocess` / `transform` 是例外：它的失败协议就是 throw，没有 Result 通道。Result 边界放在 `decode` 和校验函数，不要在 schema 里硬塞 Result 再 throw 回去。

## 4. 不为抽象而抽象

- **单行转手 wrapper 删掉**：函数体只有 `return f(x)`、没有策略/校验/前缀/默认值/依赖隔离时，直接把 `f` 暴露给调用点。先例：`resolveSavedModelId`、`generateAgentRunId`、`mergeAgentDefinitionPatch` 都被删过。
- 只有一个消费者的通用类型机器不要上：为 `AgentDefinition` 写递归 `MergePatch<T>` 是标准 RFC 写法，但这里只有一个模型，显式 patch interface 更好读。判断标准是**消费者数量 + 模型稳定性**，不是"标准不标准"。
- 包装层只有在增加**策略、校验、默认值、协议转换，或隔离不稳定依赖**时才值得保留。
- 判据看"它认识谁"，不看"谁在调它"：逻辑跟数据模型走。合并规则认识 `AgentDefinition`，就放 `domain/agent/logic`；tool 只是入口，不是语义所有者。反过来，只有 tool 认识的 schema/action 分发不要塞进 domain。
- YAGNI：没有生产者的错误码、没有调用方的别名、没有第二消费者的抽象，直接删，不占号不占文件。

### 4.1 假引用与假公开

- **假引用**：符号的“引用”只来自测试、public allowlist、类型注释或自身模块；生产代码零 import。测试 import 是为了让被导出符号可测，不是消费者。
- **假公开**：符号在 `public/*.ts` / allowlist 里有名字，但 `packages/*/src`、`apps/*/src` 里没有任何生产 import。allowlist 是承诺，不是引用。
- 判断顺序：
  1. 只搜生产代码（排除 `test/`、`__tests__/`、`dist/`、`public/`），得到真实引用数；
  2. 生产引用为 0 → 假公开或死代码，先撤 public 导出，再决定删不删；
  3. 只有 1 处生产引用 → 先撤 public 导出；不是跨层契约就直接内联；
  4. 只有测试直接 import → 不构成保留理由；测试改走公开入口/service，或随内联删除；
  5. service→domain 这类跨层唯一入口可以保留**一个内部 export**，但它不该出现在 public allowlist 里。
- 先例：`parseCharacterCardToMdTree` 曾在 public allowlist、service 一处调用、测试多处直引；public 是假的，已撤导出并把解析并回 domain 单文件；`validateMdTreeForImport` / `validateMdTreeLimits`、`sanitizeEntryFilename`、`extractPngCharaJsonText` 都是一处引用，已内联。
- 先例：`buildAnnotatedSource`、`applyAnnotateHighlights` 这类“保留供测试/兼容”的导出，生产零引用就整条删；测试不是保留理由，兼容也要有真实消费者。

**审计脚本**（skill 自带，不用装依赖）：

```bash
node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs packages/core/src/domain/character-card
```

输出列：`prod` / `test` = 生产 / 测试代码里的 **调用点 / 值引用点**（`Nc/Nr`；`prod` 含同文件调用）；已解析 named import、`as` 别名与 `@novel-master/core/chat` 这类 barrel 转发；`public` 是否在 allowlist；`kind` 为 function / class / variable。verdict：

- `FAKE_PUBLIC`：public 有名字但生产调用 / 引用 0；
- `TEST_ONLY`：非 public、生产 0、只有测试引用；
- `DEAD`：生产 / 测试都 0；
- `INLINE_CANDIDATE`：非 public、生产 1 处（函数）；
- `INLINE_CANDIDATE`：生产 1 处（函数）；**public=yes 只表示撤导出时还要同步 barrel/allowlist，不是保留理由**。默认内联；确认不能内联时写 `nm-style: keep-public — 理由`，并在交付报告列未处理项；
- `AMBIGUOUS`：同名多定义，计数按名字合并，需人工看；
- `KEEP` / 类 / 常量：类保留状态边界，大写常量是命名契约，不做 inline 候选。

仍是启发式：同名遮蔽、动态属性、跨包重建导出需人工复核；`--strict` 时 `DEAD` / `FAKE_PUBLIC` / `TEST_ONLY` / `INLINE_CANDIDATE` 退出码 1。

## 5. 通用工具与命名

- 通用谓词/纯工具统一放 `packages/core/src/common/`，经 `@novel-master/core/common` 给三端共用。发现**第二份**就地实现时就收敛，不等到第三份。
- 文件名按**类别**起（`guards.ts`、`merge-patch.ts`），不要按单个函数起（`is-record.ts`）。下一个小工具应该能并进已有类别文件。
- 模块名要能看出职责；`is-record.ts` 这种抽象名会让下一个守卫又新开一个文件。

## 6. 类型与不可达守卫

- 校验不可信输入（LLM JSON、YAML、IPC）时，先把字段读进 `const x: unknown = ...` 再判断；直接对已声明类型判断，TS 收窄后会把运行时守卫判成 unreachable。
- 不要用类型断言掩盖运行时形状；断言只用于"边界已验过"的地方。
- 去掉冗余形状检查：要求 `obj.a` / `obj.b` 都是数组，已经能拒绝字符串、数组、数字，不必再先查 `typeof obj === "object"` 和 `Array.isArray(obj)`。

## 7. 验证节奏

- 改完先跑 typecheck，再跑相关测试，再 lint 改动文件；不要只跑一个就宣布完成。
- 改了公共导出或 `dist` 消费方，重建 core 并跑 package-exports 快照。
- 提交前看 `git diff --stat` 和关键 diff，避免整文件 CRLF/LF 换行噪音；换行噪音单独还原，不要混进逻辑提交。

## 8. 脚本化检查（改完必跑，循环到 PASS）

不要只靠通读代码找违规；先跑脚本，按报告改，再跑。内联/删除会制造新的单点与死引用，所以**至少循环 2 次**，直到 signatures/inline 都是 0 处。

```bash
# 只扫本次 git 改动（默认排除 test/__tests__/dist）；导出审计按严格模式
node .agents/skills/nm-code-style/scripts/check-style.mjs --changed

# 全 core 死导出体检；不受 --changed 限制，能扫到本轮没改过的文件
node .agents/skills/nm-code-style/scripts/check-style.mjs --all

# 扫指定目录/文件；需要连测试一起扫时加 --include-tests
node .agents/skills/nm-code-style/scripts/check-style.mjs packages/core/src/domain/chat/logic
node .agents/skills/nm-code-style/scripts/check-style.mjs --changed --include-tests
```

`--changed` 只看改过的文件；未改动文件里的死导出（例如 `computeStreamTailGenerating` 这种只剩 public 转发 + 测试的旧模块）必须靠 `--all` 或显式传目录才能发现。**每轮收尾至少跑一次 `--all`，不要只跑 `--changed`。**

| 脚本 | 检测 | 处理 |
| --- | --- | --- |
| `check-signatures.mjs` | 多行函数参数、调用参数、`new` 构造、1–3 个具名 import 拆行、const/赋值右侧简单表达式拆行 | 参数并回一行；RHS 并回一行或抽有名字的中间变量；放不下先减参数或缩短名字 |
| `check-inline.mjs` | `DEAD_LOCAL` 零引用私有函数、`INLINE_LOCAL` 单点私有函数、`PASS_THROUGH` 单行转手、`KEEP_LOCAL`（keep-local 豁免） | 删除 / 内联 / 删 wrapper；`KEEP_LOCAL` 仅限 >20 行的有名字管线阶段，且需在报告说明 |
| `check-methods.mjs` | `DEAD_METHOD` 零生产引用、`INLINE_METHOD` 单点生产引用、`PASS_THROUGH_METHOD` 薄包装、`DEPRECATED_DEAD` / `DEPRECATED_METHOD`、`AMBIGUOUS_METHOD` | 类方法同样删除 / 内联 / 删 wrapper；public 方法单点先判断是否撤 public；同名跨类的方法需人工看，不直接判死 |
| `find-fake-exports.mjs` | `FAKE_PUBLIC` / `TEST_ONLY` / `DEAD` / `INLINE_CANDIDATE` / `AMBIGUOUS` | 撤 public → 看调用点 → 沿死链删到底；`INLINE_CANDIDATE` 默认内联（public=yes 也一样），确认不能内联才写 `nm-style: keep-public` 理由；`--strict` 问题类退出码 1 |
| `check-oop.mjs` | `OOP_CANDIDATE`（共享状态 + 多导出函数）、`MANY_EXPORTS`（导出函数 ≥6，人工 review） | 有状态才对象化；纯函数命名空间不建类；`OOP_CANDIDATE` 必须处理或报告理由 |

- `check-style.mjs --changed` / `--all` / `--strict` 现在把导出审计也计入退出码；默认全 core 扫描仍只输出线索表。`INLINE_CANDIDATE` 默认按内联处理；只有确认是跨层唯一入口才留，并在声明上方写 `nm-style: keep-public — 理由`。
- 单点私有函数默认内联；只有 **>20 行、有名字的管线阶段** 才可写 `nm-style: keep-local — 理由`，且必须在“未处理项报告”里说明；小的外壳、转手 wrapper、零引用函数不允许用 keep-local。
- 脚本自测：`node --test .agents/skills/nm-code-style/scripts/test-find-fake-exports.mjs`（fixture 覆盖 barrel 单/双调用、测试引用、类型引用、public 单引用与 keep-public 豁免）、`node --test .agents/skills/nm-code-style/scripts/test-check-signatures.mjs`（fixture 覆盖单参数/单实参/单 import 与 const/赋值 RHS 拆行，并确认对象/数组/箭头函数多行不误报）、`node --test .agents/skills/nm-code-style/scripts/test-check-methods.mjs`（类方法 dead / inline / pass-through / deprecated）、`node --test .agents/skills/nm-code-style/scripts/test-check-oop.mjs`（共享状态 → OOP_CANDIDATE；纯函数多导出 → MANY_EXPORTS；已有对象 → 不报）。
- `--changed` 只报新增行（未跟踪文件按整文件新增），适合修复循环；全量体检时传目录。每轮改完立刻重跑，直到 `check-style: PASS`。
- 脚本按标识符/import 计数，是启发式：barrel 转发、同名遮蔽、动态引用需人工复核。
- 不要用脚本自动改文件；报告只给位置，改动仍按本 skill 的语义判断。

## 9. 领域角色与对象化（最后一步）

顺序上先收死代码、单点内联、导出面、签名、重复工具；这些都干净后，才看要不要对象化。**不要一边修 bug 一边把模块改成类。**

### 9.1 先选 DDD 角色，再选形态

| 角色 | 形态 | 行为放哪 | 例 |
| --- | --- | --- | --- |
| Entity | class（或组合式领域对象） | 单实体的谓词、派生值、不变量 | `ChatMessageEntity.from(msg).isUserInput()` |
| Value Object | class / 冻结对象 | 只依赖自身值的操作 | `content.toolUseCount()`、`path.parent()` |
| Domain Service | 无状态对象/类 | 跨实体、但不碰 repository/IO 的领域操作 | `AttachmentScanner.scanAtPaths()` |
| Application Service / Use Case | 类，名词命名 | 编排 repository、IO、多聚合 | `PrepareUserMessages.execute()` |
| Policy / Resolver | 无状态对象 | 策略判定、目标解析 | `ComposerSendPolicy.evaluate()`、`ChatLinkResolver.resolve()` |
| Codec / Factory | 无状态对象 | encode/decode、build/parse | `AttachmentXmlCodec.encodeFileRef()` |
| Presentation / View | view model | chip、摘要、预览、文案 descriptor | `RollbackConfirmView.forPrimary()`、`view.previewBody()` |
| DTO / Record | interface/type | 纯数据，无行为 | `ChatMessageDto`、`ChatMessageRecord` |

判定规则：

- 只用**一个对象自身字段** → 该对象的方法；
- 同一聚合内多个对象协作 → 聚合根/值对象方法；
- 跨聚合、需要 repository/IO → domain/application service；
- 只做编码/解码 → codec；
- 只给 UI 展示 → presentation/view；
- 纯数据跨进程 → DTO，**不要**把方法塞回 DTO。

### 9.2 命名：名词是角色，动词是方法

- 服务/对象名用**角色名词**：`AttachmentScanner`、`ComposerSendPolicy`、`AttachmentXmlCodec`、`ForkCopySeeder`
- 方法名用**动词**：`scanAtPaths`、`evaluate`、`encodeFileRef`、`seed`
- 不再写 `xxxForPrompt` / `xxxFromAttachment` / `prepareXxxForYyy` 这类把上下文全塞进函数名的自由函数
- 同一前缀反复出现在多个导出上，说明它应该是模块/对象，不是函数前缀
- `Manager` / `Helper` / `Util` / `Service` 只在确实表达角色时使用；说不清职责就不要加
- DTO / Record / Entity 分工明确：`ChatMessageRecord`（DB 行）、`ChatMessageDto`（IPC）、`ChatMessage`（实体）

### 9.3 什么时候才 OOP

只有同时满足才值得对象化：

1. 有**共享可变状态**（`Map` / `Set` / 数组 / `let`），或多个操作围绕同一个实体；
2. 至少两个导出函数读写同一份状态；
3. 有生命周期、订阅、不变量需要封装（store / cache / 连接池 / 状态机 / 队列）。

不要 OOP 的情况：

- 纯函数工具（`composer-at-path`、`build-attachment-action-xml` 这类）——导出再多也只是命名空间，建类只增加壳；
- DTO / schema / factory（`MessageContent` 这类持久化数据）；
- 单个函数、React hook（hook 本身就是状态边界）；
- 只是为了“看起来面向对象”。

### 9.4 迁移顺序

- 先做**实体/值对象自身行为**（`ChatMessage`、`MessageContent`、`MessageAttachment`），保留 DTO mapper；
- 再把 presentation 从 domain 拆出去（status chip、tool summary、VFS preview、rollback copy）；
- 然后把 service 按角色命名（scanner / policy / use case / codec / seeder）；
- 状态放 class private 字段，操作放实例方法；进程级单例导出 `xxxStore`，不要模块顶层 `const map` + 一堆 free functions；
- 先对象化内部并保留方法引用兼容，再切消费者，最后撤别名 / public / allowlist；不要一次性把 API 和状态迁移混在一起；
- `check-oop.mjs` 的 `OOP_CANDIDATE` 必须处理或按“未处理项报告”给理由；`MANY_EXPORTS` 只表示人工 review，纯函数模块可以不 OOP；
- `check-methods.mjs` 的 `DEAD_METHOD` / `INLINE_METHOD` / `PASS_THROUGH_METHOD` 与自由函数同口径处理；类方法不能成为新的死角。

## 交付前 30 秒检查

- 有没有跑 `check-style.mjs --changed`，并循环到 0 处？收尾再跑一次 `--all` 找未改动文件的死导出。
- `check-oop.mjs` 的 `OOP_CANDIDATE` 处理了吗？`MANY_EXPORTS` 看过并说明纯函数/该 OOP 了吗？
- `INLINE_CANDIDATE` 都处理了吗？public=yes 也一样默认内联；留必须写 `nm-style: keep-public` 理由。
- 只调用一次的 private / 模块级函数，内联了吗？（`check-inline`）；类方法有没有 `DEAD_METHOD` / `INLINE_METHOD` / `PASS_THROUGH_METHOD`？（`check-methods`）
- 死链的 caller 也一起删了吗？
- 这个 export 的生产引用有几处？测试 import / allowlist 都不算消费者。（`find-fake-exports`）
- 有没有 `return f(x)` 这种单行转手 wrapper？（`check-inline` 的 `PASS_THROUGH`）
- 签名、调用参数、错误构造，是不是还有多行？（`check-signatures`）
- 域逻辑里还有 throw 吗？throw 是否都收在边界？
- 这个 Result 真的有失败分支吗，还是为了“统一”硬加的？
- 有没有第二份通用工具/守卫/纯映射该进 `core/common`？
- 改完 typecheck、相关测试、lint 都跑了吗？

## 未处理项报告（强制）

`DEAD` / `FAKE_PUBLIC` / `TEST_ONLY` / `INLINE_CANDIDATE` 只要本轮没改掉，交付说明必须逐条列出：

| 符号 | verdict | prod/test | 不处理理由 | 证据 |
| --- | --- | --- | --- | --- |

没有这张表 = 视为漏处理。`nm-style: keep-public` 只是代码里的标记，不能替代报告里的理由。

**“public / 共享 API”不是理由。** public 只说明撤导出时要同步 barrel 与 allowlist，不说明调用点不止一个；必须说明为什么唯一调用方不能 own 这段逻辑，例如三端共用的唯一入口、跨端契约常量、测试支持 API。说不出来就内联或删除。
