---
name: nm-code-style
description: novel-master 的代码优化与重构原则。写新代码、重构、内联收敛、假引用/假公开审计、错误处理、命名与文件放置、签名盘点、对象化、CR 修复时使用。
---

# nm 代码优化原则

写、改、重构代码前先过一遍这份清单。目标是**让代码更短、更直、更少层**，不是把代码摆得更"整齐"。

全文顺序即执行顺序：内联 → 简化 → 观察重复 → 收敛工具 → 清导出面 → 对象化。

## 1. 先内联，再判断

**单点私有函数、单点方法、单行转手 wrapper，一律先内联到唯一调用点；零引用直接删。** 不先判断"它看起来像一个阶段"。

- 类内 private 方法同样适用：只有一个类内调用点就内联，`return this.f()` / `return f(x)` 这类薄包装删除。只有该方法独立承载本对象的共享状态/不变量、内联会把状态机拆散时才保留，并写 `nm-style: keep-local — 理由`。
- 模块级单点调用的私有函数同样内联；`z.preprocess` 的回调、`transform` / `toWire` 这类只挂一次的映射直接写箭头。
- 类里用 private 字段承载状态；不要为了"封装"给字段再加一层 private getter/setter。

**例外**：被多处复用的纯比较/纯映射可以留模块级私有函数（如 `sameToolUse`）；内联会制造三份 `JSON.stringify` 时，留函数是对的。

### 1.1 内联 → 简化 → 观察重复 → 再抽象

1. **先内联**到唯一调用点。
2. 在调用点**简化**：合并重复条件、去掉只为下一步服务的中间变量、把三遍遍历改成有序单遍、把 identity Map 改成下标数组、摘掉恒真/恒假的形状守卫。
3. **观察**是否真的存在两处以上相同语义，或多个函数共享同一组可变状态（`seen`、`budget`、缓存、生命周期）。
4. 只有"稳定重复"或"共享可变状态"成立时才重新抽象；优先对象/服务，不要继续造自由函数前缀。

`keep-local` 的**唯一**合法理由：内联简化后仍成立的**状态 / 不变量 / 独立 IO 管线**。理由必须点名它。行数不是理由——超过 100 行本身既不是保留理由，也不是拆分理由；小的外壳、转手 wrapper、零引用函数不允许 keep-local。留下的必须在「未处理项报告」里说明。

先例（2026-10-25）：`DoomLoopDetector` 内联三个 private 方法后，发现轨迹已裁到恰好一个窗口，`slice(-crossRoundWindow)` 是多余复制；`validateAgentDefinition` 内联后 `prompts` 的对象/数组检查被证明冗余，直接要求 `persist` / `dynamic` 是数组即可。`hydrateDirAttach` 先内联进 `hydrateAttach`，才发现 legacy `<file>/<dir>` 解包重复，抽成 `unwrapLegacyBody`；剩余 hydrate 阶段共享 `seen` / `workplaceSeen` / `AttachBudget` / 技能名缓存，才收成 `AttachmentHydrator`。

**死代码沿调用链删到底**：一个符号只剩测试/barrel 引用时，先找它的调用方；调用方自己也没有生产调用，就继续往上，整条链一起删，不要只删叶子留下空壳 caller。先例：`applyAnnotateHighlights` 生产零调用，`findAnnotateOccurrenceInSource` / `buildFlatTextIndex` / `estimateSoftOffsetRangeFromQuoteContext` 全部只服务这条死链，最终整条链与两个 logic 文件一起删除。

## 2. 一行写完

- **函数签名、调用参数列表写在一行**。参数多到一行放不下，先减少参数或缩短参数名，而不是换行。
- **>4 个参数收 params 对象**（p30 定判据，先例 `59dcdf2af`）：依赖（repo/conn/runtime）与语义参数（scopeKey/path）收进单个 `<概念><操作>Params` 对象，字段名即文档；原 options 的可选字段展平进 params、Options interface 退役；孪生参数对（`fromScope+fromPrefix / toScope+toPrefix`）收成端点对象（如 `VfsCopyEndpoint{scope,pathPrefix}`）表达结构。**豁免**：≤4 参不动；平台契约形态（fetch init、Promise executor、原生桥协议）不动；测试工厂豁免。apps 层「依赖注入对 + 操作入参」混排的拆 `Deps`/`Req` 两对象。
- `new AppError("KEY", {detail})` 也写一行。
- 导入语句能一行就一行（1–3 个具名 import 不拆行）。
- 简单表达式不要拆成多行；只有长条件确实需要分段时才换行，且每段要能独立读懂。
- **不写链式 / 嵌套的三元**：`a ? x : b ? y : z`、`a ? (b ? y : z) : w` 一律改成 if / else；按枚举值分支的（字符串字面量联合、固定数字码）用 switch。单层的二选一（`ok ? a : b`）可以留；条件位置里嵌的、同一语句里彼此独立的两个三元也不在门内。`nm-style check` 的 `chained-ternary` 段会拦（`CHAINED_TERNARY`），确有理由的在现场写 `// nm-style: keep-ternary — 理由`。
- **链式调用可以折行**（每链一行），不算拆参数——参数列表折叠才违规。

## 3. 错误进 Either，不抛

- 域逻辑/校验函数返回 `Result<T, E>`（`Result.ok` / `Result.err`），函数体内不 throw。
- 在**边界**统一决定是否抛：runner、service、tool、IPC handler 处写 `if (!result.ok) throw result.error;`。边界之外不再复制判断。
- **取消不是错误**：`checkpoint()` 返回 `Interrupt | null`，长任务返回 `Outcome<T>`；`Result` 的 `E` 只装业务失败。
- 不要给错误工厂再包一层：`agentDoomLoop()` 这种只有 `new AppError(...)` 的 wrapper 直接删，调用点写构造。
- 不要为了"统一"把本来有 code 的域错误包成 `Error` 或丢失 code；要么保留域错误，要么迁到统一 `AppError` 注册表，别造中间壳。
- **编程错误不占产品码**：不变量破坏用 `assert(cond, msg)`（抛 `AssertionError`，不被 `isAppError` 命中），不要 `throw new AppError("*_INVARIANT_VIOLATION")`。
- zod 的 `preprocess` / `transform` 是例外：它的失败协议就是 throw，没有 Result 通道。Result 边界放在 `decode` 和校验函数，不要在 schema 里硬塞 Result 再 throw 回去。
- **抛异常的写法只有八种，盘点工具全都认**：`throw r.error`、`throw createAbortError()` / `AbortError.create()`、`throw new AppError`、`throw new Error`、`throw new <其它错误类>`、`throw <其它表达式>`（再抛 `throw e`、三元、调用结果等），以及 **T7 转抛 helper 的定义**——显式标注 `never` 返回、体是单条 throw（或单条 return 调用另一转抛 helper 的传递链）的函数——与 **T8 这类 helper 的调用点**（裸调用和 `Obj.helper(...)` 属性链都算，站点带 helper 名）。后两种语句形态曾经是盲区（2026-11-26 补上），helper 两形态是同一轮补上的盲区：不要以为把 throw 包进 `raiseRunError(x): never` 这类 helper、或在调用点借 helper 转手就不算抛——helper 与每个调用点一起盘点，helper 的唯一修法是删掉它改 `Result.err` 直返。断言豁免：名字以 `assert` 开头（大小写不敏感）或体内 throw 的是 `new AssertionError` 的不算转抛 helper，编程错误走合法不变量通道；`nm-throw: keep` 不豁免收集，带 keep 的 helper 站点照常入表判 KEEP。自己写的函数之间用 `Result` 传递失败；只有平台契约逼着你抛的地方才抛，并在现场写 `// nm-throw: keep — 理由`。跑 `nm-style throw-audit --gate` 看未登记站点，`nm-style throw-audit` 出全量表。

## 4. 不为抽象而抽象

- **单行转手 wrapper 删掉**：函数体只有 `return f(x)`、没有策略/校验/前缀/默认值/依赖隔离时，直接把 `f` 暴露给调用点。先例：`resolveSavedModelId`、`generateAgentRunId`、`mergeAgentDefinitionPatch` 都被删过。
- 只有一个消费者的通用类型机器不要上：为 `AgentDefinition` 写递归 `MergePatch<T>` 是标准 RFC 写法，但这里只有一个模型，显式 patch interface 更好读。判断标准是**消费者数量 + 模型稳定性**，不是"标准不标准"。
- 包装层只有在增加**策略、校验、默认值、协议转换，或隔离不稳定依赖**时才值得保留。
- 判据看"它认识谁"，不看"谁在调它"：逻辑跟数据模型走。合并规则认识 `AgentDefinition`，就放 `domain/agent/logic`；tool 只是入口，不是语义所有者。
- YAGNI：没有生产者的错误码、没有调用方的别名、没有第二消费者的抽象，直接删，不占号不占文件。

### 4.1 假引用与假公开

- **假引用**：符号的"引用"只来自测试、public allowlist、类型注释或自身模块；生产代码零 import。
- **假公开**：符号在 `public/*.ts` / allowlist 里有名字，但 `packages/*/src`、`apps/*/src` 里没有生产 import。**allowlist 是承诺，不是引用。**
- **假 export（引用别名）**：`export const A = B.c;` —— 整个"导出"就是把 `B.c` 换了个名字，没有任何新实现、没有参数化、没有语义增量。它不是包装层，是名字污染。

判断顺序：

1. 只搜生产代码（排除 `test/`、`__tests__/`、`dist/`、`public/`），得到真实引用数；
2. 生产引用为 0 → 假公开或死代码，先撤 public 导出，再决定删不删；
3. 只有 1 处生产引用 → 先撤 public 导出；不是跨层契约就直接内联；
4. 只有测试直接 import → 不构成保留理由；测试改走公开入口/service，或随内联删除；
5. service→domain 这类跨层唯一入口可以保留**一个内部 export**，但它不该出现在 public allowlist 里。

`nm-style check` hygiene 段的 verdict 与处理（旧 inline / methods / find-fake-exports 三检测器已并成一段）：

| verdict | 含义 | 处理 |
|---|---|---|
| `FAKE_PUBLIC` | public 有名字但生产引用 0 | 撤 public → 决定删不删 |
| `TEST_ONLY` | 非 public、生产 0、只有测试引用 | 测试不是保留理由；改走公开入口或删 |
| `DEAD` | 生产/测试都 0 | 沿死链删到底 |
| `INLINE_CANDIDATE` | 非 public、生产 1 处（函数/方法） | **默认内联**；`public=yes` 只是撤导出时要同步 barrel/allowlist，**不是保留理由**。确认不能内联才写 `nm-style: keep-public — 理由` |
| `PASS_THROUGH` | 单行转手（函数体只有 `return g(x)` / `return new G(x)`，含 this/super 转发与实参派生形态） | 删 wrapper，调用点直呼 g |
| `AMBIGUOUS` | 同名多定义（跨类/跨容器），按名计数不可靠 | 人工看，不自动判死 |
| `KEEP_PUBLIC` | 多处生产消费，公开合理 | 不处理 |
| `KEEP_LOCAL` | 命中 `nm-style: keep-local` 指令 | 见 §1.1；理由不成立时仍要处理 |
| 类 / 常量 | 类保留状态边界，大写常量是命名契约 | 不做 inline 候选 |

先例：`parseCharacterCardToMdTree` 曾在 public allowlist、service 一处调用、测试多处直引；public 是假的，已撤导出并把解析并回 domain 单文件。

`--strict` 时 `DEAD` / `FAKE_PUBLIC` / `TEST_ONLY` / `INLINE_CANDIDATE`（含 public 单点）退出码 1。仍是启发式：同名遮蔽、动态属性、跨包重建导出需人工复核。

#### 引用别名：`export const A = B.c`

hygiene 段**抓不到这一种**——它按标识符计数，`formatCharCount` 有 5 个调用方，所以判 `KEEP_PUBLIC`；`PASS_THROUGH` 只认「单 return 调用/new」的转手函数，`export const A = B.c` 这种没有函数体的别名不在其内，仍要靠下面的 grep 兜底。

判据：**A 与 `B.c` 是不是同一件事换名**。

```ts
// ❌ 假 export —— 零语义增量，调用方多记一个名字、仓里多一个文件
export const formatCharCount = Number.charCount;
// 注释自白：「本别名保留给 @novel-master/core/format 子入口与既有调用点」
//             ↑「保留给既有调用点」= 过渡壳 = 永久壳

// ✅ 该留 —— 名字表达用途/配置项语义，不是同义改写
export const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = ANTHROPIC_SAMPLING_DEFAULTS.max_tokens;

// ✅ 该留 —— 隔离依赖方向（tokenizer driver 包不该直接 import service/prompt）
export const serializePromptLlmInput = PromptBuilder.cliText;
//    4 个包 + 2 端消费，名字是「token 计数 parity 契约」而非「cliText 的别名」
```

**「有消费者」不构成保留理由，要问「消费者改得动吗」。** `formatCharCount` 的 5 个调用方全是一行改（`formatCharCount(x)` → `Number.charCount(x)`），却被「有消费者」挡住了好几轮。

扫描命令（hygiene 段按标识符计数，抓不到别名形态，要单独跑）：

```bash
grep -rnE "^export const [a-zA-Z_][a-zA-Z0-9_]* *(:[^=]+)?= *[A-Z][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]* *;" --include=*.ts packages/core/src
```

删的时候连文件一起删（若整文件只有这个别名），调用方改成直接引 `B` 并调 `B.c`。

#### public barrel 按归属装，不按便利装

`public/<域>.ts` 的每个符号，实现文件应该属于同一域。跨域塞进来的标志是注释里出现「**避免新增子路径依赖**」「**就近转出**」——那是桶子按便利塞的自白。

先例：`public/format.ts` 装着 `createIncrementalTokenCounter`（实现于 `infra/tokenizer/logic/`）和 `StreamTokenSource`（实现于 `domain/session-run-state/model/`）。

**为什么这是病而不只是不好看**：读 `import { X } from "@novel-master/core/format"` 的人会以为 X 是 format 域的东西，找实现时在 `domain/format/` 里找不到；而这个 barrel 会随时间越装越杂，最后没有任何归属含义。

处理：符号移到正确的 barrel（已有则加，没有则新建 `public/<域>.ts` 并在 `package.json` 的 `exports` 登记子路径），然后改所有消费方的 import 路径。**这类改动不碰任何逻辑，但会波及大量文件**——先穷举消费方清单再动手。

## 5. 通用工具与命名

通用谓词/纯工具统一放 `packages/core/src/common/`，经 `@novel-master/core/common` 给三端共用；**发现第二份就地实现时就收敛，不等到第三份**（怎么发现见 §5.1）。文件名按**类别**起（`guards.ts`、`json.ts`），不要按单个函数起（`is-record.ts`）——下一个小工具应该能并进已有类别文件。

### 5.1 语义族收敛

「发现第二份就收敛」不能靠通读代码——语义相同的函数往往**名字不同**，肉眼扫不出来。固定流程：

```bash
nm-style baseline write dup --baseline D:/tmp/sig.json
```

JSON 里两个视图各有用途：`named`（同名不同文件，含同名同签名——完整签名重复自然落在同名组里）、`shaped`（名字不同但参数形态相同）。**扫描含 export**——跨域重复的典型形态是「一处 export、另一处私有」。

**按语义族归类，不按文件名归类**。已确认的高频族：

| 族 | 典型成员 | 归属 |
|---|---|---|
| 类型窄化 / 取值 | `asString` / `asNumber` / `nonEmptyString` / `num` / `nullableText` / `pickStringField` / `safeParseRecord` | `common/coerce.ts` 的 `Coerce` |
| 类型谓词 | `isRecord` / `isNonEmptyString` / `isBinaryFilePath` / `isImageFilePath` | `common/guards.ts` 的 `Guards` |
| JSON | `parseJson` / `parseJsonObject` / `parseJsonText` | `common/json.ts` 的 `Json` |
| 截断 / 转义 | `truncate` / `truncateText` / `truncateToByteBudget` / `escapeRegExp` / `escapeHtml` | `common/text.ts` 的 `Text` |
| 数值格式化 | `pad` / `pad2` / `labelCount` / `trimTrailingZeros` / `formatByteSize` / `trimFraction` | `common/number.ts` 的 `Number` |
| **文本变换** | `stripXxx` / `trimXxx` / `normalizeXxx` / `escapeXxx` / `sanitizeXxx` / `collapseXxx` | `common/text.ts` 的 `Text` |
| row mapper | `rowToMessage` / `rowToProject` / `rowToSession` | **不收敛**：字段集合不同，同名不同责 |
| 错误构造 wrapper | `invalid` / `fail` / `alreadyExists` / `engineNotFound` | **删**：一句 `Result.err(new AppError(...))` 的包装，直接写构造 |
| UI 组件回调 | `handleSave` / `sync` / `handleConfirm` | **不收敛**：同名不同责，每个组件提交的实体不同 |

**动词前缀也是分类维度**。`stripWorkplaceLinePrefix(body: string): string` 与 `stripToolResultLinePrefix(body: string): string` 同文件、同签名、逐行同构（只差一个正则常量），但族表里若没有「文本变换」这一行就会被跳过。审计时按 `[strip|trim|normalize|escape|sanitize|collapse|format|parse|build|to|resolve|ensure]` 各切一遍，同动词 + 签名同构就是候选族。

**判据不是「名字像不像」，是「同一输入是否产出同一输出」。** `asString(v, fallback)` 与 `nullableText(v)` 名字不同、参数不同，但「把 unknown 变成 string」是同一件事 → 收敛到 `Coerce`，`fallback` 留给调用侧。

**明确不收敛的不要浪费轮次去判**（`rowTo*` / `handleSave` 这类）——它们的共同点是「输入输出类型完全不同」。

### 5.2 工具与业务的边界（下游适应工具）

**只适用于 `common/` 里的通用工具。域内私有 helper 不适用本判据。**

判据：通用工具的签名里出现业务名词（`label` / `fallback` / `field` / 具体实体名）即为耦合，必须改到调用侧。

```ts
// 错：fallback 是业务默认值，工具不该知道
function asString(value: unknown, fallback: string): string

// 对：工具只做形态判定，业务侧自己补默认值
Coerce.string(value): string
const name = Coerce.string(raw.name) || "（未命名）";
```

```ts
// 错：从容器取字段时带上业务标签
function pickLabeled(obj: Record<string, unknown>, key: string, label: string): string | null

// 对：工具只取值
Coerce.pickText(obj, key): string | null
// 业务侧自己转成带 label 的错误
const v = Coerce.pickText(obj, key);
if (v === null) return Result.err(new AppError("CHAT_INVALID_ARGUMENT", {detail: `${label} 缺失`}));
```

**反向也成立（这条最容易漏）**：**领域里出现「只做原语变换、不含业务概念」的函数时，该提到工具层**，即使它只有一份。

```ts
// 现在：领域私有，但它是通用能力（按行去某种前缀）
function stripWorkplaceLinePrefix(body: string): string {
    const lines = body.split("
");
    return lines.map((line) => line.replace(WORKPLACE_LINE_PREFIX, "")).join("
");
}

// 该拆成：工具接原语，领域常量留在域内
Text.stripLinePrefix(body, WORKPLACE_LINE_PREFIX)     // common/text.ts
const WORKPLACE_LINE_PREFIX = /^ *│/;                  // 留在 render-prompt.ts
```

判据：**函数体 1-3 行、只做字符串/数组/数字变换、不引用任何实体类型、不构造错误** → 通用能力候选。哪怕只有一个调用方，只要它「不认识任何业务概念」，就该进 `common/`。

**域内校验函数不适用本判据**：`domain/chat/content/parse-message-content.ts` 的 `requireString(obj, key, label): Result<string, ContentError>` 是**域内校验**——它既做形态判定又负责构造带错误码的业务错误，`label` 是它自己的错误文案素材，不是从工具漏过去的业务概念。这类函数保留，内部可以复用 `Coerce.pickText`，但不要为了「通用」把 `label` 拿掉。

**为什么不能一刀切**：`Coerce.nonEmptyText` 是「trim 后非空则返回原串」，而 `requireString` 是「是字符串且非空串」（不 trim）——两者在 `"  "` 这种输入上结果不同。强行统一会改行为。

### 5.3 工具模块用 object namespace，纯函数族优先于无状态 class

`common/` 的纯函数按类别收进 **object namespace**。无状态 `class Xxx { static f() {} }` 允许（用户裁决：静态 class 不禁），但纯函数族**优先** object namespace——class 壳只用到了名字空间功能，却额外背上可 new / 可 extends / 成员默认可变 / prototype 链四样用不上的语义；object 字面量一步构造、`as const` 天然只读、`Object.keys` 可枚举（dup/门禁友好）。已有 namespace 不返工改 class；有共享可变状态才用 class。

```ts
// common/coerce.ts
export const Coerce = {
    /** 非字符串（含 null / undefined / 数字 / 对象）→ 空串；空串原样保留 */
    string: (value: unknown): string => (typeof value === "string" ? value : ""),
    /** null / undefined → null；其余 String(value) */
    nullableText: (value: unknown): string | null => (value == null ? null : String(value)),
    /** 整数或整数数字串且 >= min；其余 → undefined */
    integerAtLeast: (value: unknown, min: number): number | undefined => {...},
} as const;
```

调用点：`import {Coerce} from "@novel-master/core/common"` → `Coerce.nullableText(x)`。

**理由**：`common/index.ts` 曾平铺 25 个裸导出（`isRecord` 与 `truncateText` 并列），同类不同源看不出；object namespace 让「这是哪一类工具」在调用点可见，同时规避 oop 段的 `MANY_EXPORTS`。

**两个例外**：

- `assert` / `assertNever` / `AssertionError` 保持裸函数——断言是运行时中断原语，包成 `Assert.assert()` 只是加壳（§4 同理）。
- `createTranslator` + i18n 的 `MessageLike` / `MessageParams` / `MessageCatalog` 保持裸导出——工厂 + 类型族不是一类工具函数。

### 5.4 私有 helper 不得重写已导出函数

出现「私有 helper 与某个已 export 的函数签名完全相同」时，**删私有、改 import**：

```bash
nm-style baseline write dup --baseline D:/tmp/dup.json     # named 里一方 export、一方 local 的条目
```

先例（2026-11-17 实测）：`vfs-tree-copy.ts` 的私有 `normalizePrefix` 与 `sqlite-workplace.repository.ts` 的私有 `escapeLike`，各自重写了 `scope-prefix-helpers.ts` 里已 export 的同名同签名函数——已删私有改 import。

**同名不等于同语义**：`infra/cloud-sync/logic/paths.ts:10` 也有个 `normalizePrefix(prefix: string): string`，但它是「trim + 补尾斜杠」，与 `scope-prefix-helpers` 的「去尾斜杠」**相反**，保留原样。判等价必须读两份实现。

## 6. 类型与不可达守卫

- 校验不可信输入（LLM JSON、YAML、IPC）时，先把字段读进 `const x: unknown = ...` 再判断；直接对已声明类型判断，TS 收窄后会把运行时守卫判成 unreachable。
- 不要用类型断言掩盖运行时形状；断言只用于"边界已验过"的地方。
- 去掉冗余形状检查：要求 `obj.a` / `obj.b` 都是数组，已经能拒绝字符串、数组、数字，不必再先查 `typeof obj === "object"` 和 `Array.isArray(obj)`。

## 7. 验证节奏

- 改完先跑 typecheck，再跑相关测试，再 lint 改动文件；不要只跑一个就宣布完成。
- 改了公共导出或 `dist` 消费方，重建 core 并跑 package-exports 快照。
- 提交前看 `git diff --stat` 和关键 diff，避免整文件 CRLF/LF 换行噪音；换行噪音单独还原，不要混进逻辑提交。
- **判测试红之前先降并发复跑**：高并发下 5s 超时与墙钟护栏抖动会产生假红（实测：8 worker 跑 mobile 全量报 111 红，`--maxWorkers=2` 复跑真实红只有 20 个；core 的 `T-N5` / `T-TC4` 单跑两次全绿）。

## 8. 脚本化检查（改完必跑，循环到 PASS）

不要只靠通读代码找违规；先跑脚本，按报告改，再跑。**至少循环 2 次**，直到 signatures/hygiene 都是 0 处（KFP 命中降级的 INFO 行不算）；**每轮收尾至少跑一次 `--all`**（`--changed` 看不到未改动文件里的死导出）。

```bash
nm-style check --changed                      # 只扫本次改动（diff 新增行）
nm-style check --all                          # 缺省扫 packages/core/src 全量体检
nm-style check <dir|file>                     # 扫指定目录/文件
nm-style check --changed --include-tests      # 连测试文件一起扫
nm-style check --range <spec> | --since <base> # 按区间扫（CI 用）
nm-style gate dup                              # dup 键集合门禁（新增重复组 exit 1）
nm-style gate bare                             # bare-exports 基线门禁（新增裸导出 exit 1）
```

| 段 | 检测 | 处理 |
| --- | --- | --- |
| `signatures` | 多行函数参数、调用参数、1–3 个具名 import 拆行、const/赋值 RHS 拆行 | 参数并回一行；RHS 并回一行或抽有名字的中间变量 |
| `hygiene` | `DEAD` / `INLINE_CANDIDATE` / `PASS_THROUGH` / `FAKE_PUBLIC` / `TEST_ONLY` / `AMBIGUOUS` / `KEEP_*`（旧 inline+methods+find-fake-exports 三合一） | 见 §4.1 的 verdict 表 |
| `bare-exports` | `--changed` 拦新增裸顶层 export function；`--all`/指定目录报存量计数（INFO） | 收进主体 namespace（§9.7）或写 `nm-style: keep-bare` |
| `dup` | 增量判据透传（新增重复组才红），基线在 `scripts/dup-signatures-baseline.json` | 按 §5.1 语义族归类；不阻断（门禁走独立 `gate dup`） |
| `top-let` | `TOP_LEVEL_LET`（模块顶层 / namespace 体内裸 `let`） | 改成对象槽；确有理由写 `nm-style: keep-top-let` |
| `chained-ternary` | `CHAINED_TERNARY`（真 / 假分支里再接一个三元，允许外套括号） | 改成 if / else 或 switch（§2）；确有理由写 `nm-style: keep-ternary` |
| `throw-audit`（独立命令，check 里只透传数量） | 八形态 throw 盘点：T1 unwrap / T2 取消 / T3 AppError / T4 Error / T5 自定义错误类 / T6 再抛或其它表达式 / T7 转抛 helper 定义（显式 never + 体单条 throw 或单条 return 调用链）/ T8 转抛 helper 调用点（带 helper 名） | 所在函数返回 Result/Outcome 却 throw → `VIOLATION`（改 return）；普通函数无 catch → `VIOLATION-B`（该改 Result）；普通函数有 catch → `BOUNDARY`（合法边界，须在 baseline 登记理由）；T7 定义站点 → `VIOLATION-B`（唯一修法是删 helper 改 `Result.err` 直返，体内语句站点与 T7 并存各占一键）；`nm-throw: keep — 理由` → `KEEP`；断言豁免（`assert*` 名字 / 体内 `new AssertionError`）不产生 T7/T8 |
| `oop` | `OOP_CANDIDATE`（共享状态 + 多导出）、`MANY_EXPORTS`（导出 ≥6） | INFO 呈现；`--strict` 才阻断；见 §9.3 |

**汇总行记法**：`nm-style: PASS|FINDINGS（signatures=N hygiene=N bare-exports=INFO(N)|N dup=… oop=INFO(N)|N）`。`INFO(N)` 表示该段只计数不阻断——bare-exports 在非增量模式（`--all`/指定目录）恒 `INFO(N)`，`--range`/`--since` 下 bare 段恒 INFO（增量按 hunk 语义不可判）；`|` 右侧是阻断数。hygiene 一个数并入旧 inline/methods/exports 三段的阻断合计。

**bare-exports 全域口径**（`gate bare` / `list bare` / `check` 该段一致）：`packages/*/src` + `apps/(desktop|mobile)/src`、排除 `apps/cli` 与 `.d.ts`、未跟踪文件计入、同名重载去重保留首行；`nm-style: keep-bare` 豁免看符号上方 3 行内的注释。

脚本自测：`cd tools/nm-style && node --test --test-concurrency=1 "test/*.test.mjs"`（glob 必须带引号、并发钉死串行——bootstrap 用例有约 2s 的坏文件窗口，并发会连累邻居假红）。

工具是按标识符/import 计数的启发式：barrel 转发、同名遮蔽、动态引用需人工复核（同名多定义已收敛为 `AMBIGUOUS` 档，不再按名判死）。**不要用脚本自动改文件**——报告只给位置，改动按本 skill 的语义判断。

**已知假阳性清单**：`tools/nm-style/known-false-positives.json` 登记「报出但不该改」的条目（跨类同名、接口实现、序列化钩子、导出 API 等），命中清单的从阻断降为 `INFO`。新增条目必须附理由与判定依据；确认已不触发的条目移入文件尾部 `retired` 段留档（不参与匹配）；`suppressPrefixes` 里的路径整体跳过（`apps/cli/` 已停止维护）。

### 8.1 hygiene 段导出面的数字不是假阳性

`signatures` PASS **不覆盖 hygiene 段**——它只管「一行写完」，而 `FAKE_PUBLIC` / `DEAD` / `TEST_ONLY` 管的是「导出了但没人用」。

所以不能写成「三段 PASS 所以 exports 的 FIND 是假阳性」。那是护身符。实测一轮清理前后：

```
基线    FAKE_PUBLIC=40  DEAD=176  TEST_ONLY=78
清理后  FAKE_PUBLIC=1   DEAD=63   TEST_ONLY=90
```

`FAKE_PUBLIC 40` 全是 `0c/0r 0c/0r yes` —— 在 `public/*.ts` 的 re-export 名单里，但 public 面零消费。这不是假阳性，是**40 个零消费的公开承诺**。

| verdict | 常被误当 | 实际要做 |
|---|---|---|
| `FAKE_PUBLIC` | 「public 面本来就宽，正常」 | 逐个定性：撤 public / 删实现 / 留（留要写理由） |
| `DEAD` | 「脚本只数调用不数类型引用，都是假阳性」 | 先按形态分桶（`*Options`/`*Input` 类型位置、`*_MS`/`*_LIMIT` 测试契约、`*Schema` zod 推导、其余真死码），再逐桶定处置。**「其余」桶是真待办** |
| `TEST_ONLY` | 「测试在用的都是契约常量」 | 分四桶：A 契约常量与类型（留）、B 测试接缝（收口 `@internal`）、C 测试便利（删或搬 `test/helpers`）、D 未接线生产组件（接线或删） |

**桶间会迁移**：撤掉一批冗余 export 后，原本算 DEAD 的符号如果测试还在用，会滑进 TEST_ONLY。单看某个数字涨了没意义，要看**各桶内容**。

读表还要注意列含义：hygiene 段输出 `verdict location rule face form symbol detail`——`face` 是该符号的公开面（private / class-public / exported），`exported` 面的引用计数来自全仓 globalRefs（生产与测试合一）；`FAKE_PUBLIC` 判据就是生产引用 0。要看分桶计数（生产/测试各多少）用 `--json`。

## 9. 对象化（最后一步）

前面都干净后才看要不要对象化。**不要一边修 bug 一边把模块改成类。**

### 9.1 先选 DDD 角色，再选形态

| 角色 | 形态 | 行为放哪 | 例 |
| --- | --- | --- | --- |
| Entity | class（或组合式领域对象） | 单实体的谓词、派生值、不变量 | `ChatMessage.from(msg).isUserInput()` |
| Value Object | class / 冻结对象 | 只依赖自身值的操作 | `content.toolUseCount()`、`path.parent()` |
| Domain Service | 无状态对象/类 | 跨实体、但不碰 repository/IO 的领域操作 | `AttachmentScanner.scanAtPaths()` |
| Application Service / Use Case | 类，名词命名 | 编排 repository、IO、多聚合 | `PrepareUserMessages.execute()` |
| Policy / Resolver | 无状态对象 | 策略判定、目标解析 | `ComposerSendPolicy.evaluate()` |
| Codec / Factory | 无状态对象 | encode/decode、build/parse | `AttachmentXmlCodec.encodeFileRef()` |
| Presentation / View | view model | chip、摘要、预览、文案 descriptor | `RollbackConfirmView.forPrimary()` |
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
- **名字必须能自解释深浅语义**：`isAppError(e, key)` 是浅查自身 `instanceof`，沿 cause 链深查的是另一件事——两者并存时必须改名（如 `matchesAppErrorCodeDeep`），否则调用方必然误引

### 9.3 什么时候才 OOP

**先看有没有状态，再决定形态。三种情况互斥：**

| 情况 | 形态 |
|---|---|
| **有共享可变状态**（`Map` / `Set` / 数组 / `let`），多个操作读写它，有生命周期/订阅/不变量需要封装 | **class**，或**工厂返回 object with closure**（状态在闭包里）。二者择一，看是否需要 `instanceof` / 继承 |
| **无状态、多个函数属于同一类别** | **object namespace**（`export const Xxx = {...} as const`），见 §5.3 |
| **无状态、只有一个函数** | 裸函数，不分组 |

「有共享可变状态」这一条**不要求同时具备生命周期**——只要两个以上操作读写同一份状态、且有跨调用保留的数据，就够（`createDriverRegistry` 的 `drivers` Map 属此类）。

不要 OOP 的情况：

- 纯函数工具（`composer-at-path`、`build-attachment-action-xml` 这类）——建类只增加壳，用 object namespace；
- 无状态 `class Xxx { static f() {} }` 允许，但纯函数族优先 object namespace（§5.3）；
- DTO / schema / factory（`MessageContent` 这类持久化数据）；
- 单个函数、React hook（hook 本身就是状态边界）；
- 只是为了"看起来面向对象"。

### 9.4 签名盘点与 OOP 聚合审查（只读签名，不读实现）

§5.1 解决「重复」，本节解决「聚合」——**哪些函数族在操作同一个实体，该收成对象**。

读代码看不出这类信号：五个函数可能名字完全不同、散在不同文件，但它们的**首参都是同一个 runtime / 同一批 repo 元组**。把全部签名排在一起，这种模式肉眼可辨。

```bash
node scripts/list-all-signatures.mjs <repo-root> --all --out D:/tmp/all-signatures.txt
nm-style baseline write dup --baseline D:/tmp/dup.json            # 交叉验证语义重复（named/shaped 视图）
```

**三种 OOP 信号：**

**① `createXxxState()` + 一串 `fn(state, …)`**

```ts
createAnthropicSseParserState(): AnthropicSseParserState
feedAnthropicSseChunk(state, chunk, onStream?, toolNames?): void
finishAnthropicSse(state, ...): ...
```

「create state → 每个函数首参都是它」= **闭包/类被手写成显式穿参**。改成 `createAnthropicSseParser()` 返回 `{feed, finish, finishPartial}`，state 收进闭包。

**② 同一元组在 N 个自由函数间反复出现**

```ts
restorePathToRevision(vfs, revisionRepo, scope, logicalPath, version, liveHeadByPath?, entryRepo?, prefetch?, checkpointEntryId?, contentStore?)   // 10 参
sweepSessionRevisions(revisionRepo, _entryRepo, _checkpoints, projectId, sessionId, _conn, options?)                                                 // 三个下划线弃参
```

判据：
- 元组超过 4 个成员且重复出现 ≥5 次 → 收成 `createXxxOps(deps)` 或一个命名上下文类型
- **出现 `_xxx` 下划线弃参**（签名里有、函数不用）= 元组硬塞的直接痕迹，必须处理
- **出现 2 种以上并行的 `XxxDeps` 类型** = 聚合正在无序自发形成，比「没聚合」更糟

**③ 模块级可变状态的间接痕迹**

```ts
getXxx() / registerXxx() / clearXxx() / resetXxx() / xxxForTests(...)     ← clear/reset/ForTests 是强信号
initXxx() / disposeXxx() / startXxx() / stopXxx()                          ← 生命周期信号
lookupXxx() / rememberXxx() / clearXxx()                                   ← 模块顶层 Map 的三件套
```

**④ 名词族（同一实体的动词集合）**

```ts
getSession / setSession / deleteSession / listSessions / renameSession
```

名字的宾语相同、首参都是该实体的标识（`id: string` / `scope: XxxScope`）→ 同一实体的操作族。**参数列表各不相同时，信号 ②（同一元组）抓不到，但名词这条能抓到。**

**⑤ 对象化未完成（已有对象，同域还有散落自由函数）**

同一文件/同目录里同时存在「有状态的 class 或 object」和「操作同一状态的自由函数」→ 该收。

实测先例：`decoded-content-cache.ts` 里类 `DecodedContentPool`（get/set/delete/clear/stats）与自由函数 `lookupDecodedContentBody` / `rememberDecodedContentBody` / `clearDecodedContentCaches` 并存——自由函数是隐藏单例池的门面，两套 API 同时对外。

**⑥ 模块级私有工厂 + 一堆方法各调一次**

```ts
function reposFor(conn: TdbcConnection): Repos          // 模块级私有工厂
async function listMessages(conn, ...) { const r = reposFor(conn); ... }
async function saveMessage(conn, ...)  { const r = reposFor(conn); ... }
```

每个方法都先 `reposFor(conn)` 再干活 → `repos` 每次重建，对象持有状态的好处没吃到。判据：模块级有 `xxxFor(conn|runtime)` + 同文件 3 个以上函数以它的返回值开头。实测先例：`project.service.ts:36` / `session.service.ts:39`。

**与 oop 段的关系是「交叉看」，不是「各自出报告」**：

- oop 段的 `OOP_CANDIDATE` = **已确认有共享状态**（模块顶层 `let`/`Map`/`Set`）的清单，但它看不到「三个不同文件在操作同一实体」
- 签名审查看得到跨文件的名词族/元组族，但看不到模块顶层变量

正确用法：**先跑 `nm-style check --all` 看 oop 段的 `OOP_CANDIDATE`，再用签名审查找它漏的跨文件聚合，然后交叉**——一个模块被 oop 段报 `OOP_CANDIDATE`、同时签名上与其他两处同构，就是三处一起改的强信号。

实测反例：十四期的三个 driver registry 各自被 oop 段报 `OOP_CANDIDATE`（因为有 `drivers` Map），但当时的处理是「三者各自保留现状」；直到签名审计发现三份 `resolve` 兜底逻辑完全一样，才做泛型化。**两套结果不交叉就必然漏。**

**签名审查只提供线索，不做定论。** 实测过的三类误判：

1. **「同签名 = 同职责」错** —— `rowToMessage` / `rowToProject` / `rowToSession` 同参同返回，字段集合完全不同
2. **「名字一样 = 语义一样」错** —— `normalizePrefix` 两处实现语义相反（见 §5.4）
3. **「参数逐字相同 = 可合并」错** —— 有的参数完全相同但错误处理策略真的不同（错误码、descriptor 字段、透传分支各异），不能合；也有的参数完全相同、控制流一致、只有错误码不同，能合

正确用法：**签名叫你去看哪几处，是否合并由读实现后定。**

### 9.5 迁移顺序

- 先做**实体/值对象自身行为**（`ChatMessage` 类 + `ChatMessageData` 边界；`MessageContent` 仍是值对象），保留 DTO mapper；
- 再把 presentation 从 domain 拆出去（status chip、tool summary、VFS preview、rollback copy）；
- 然后把 service 按角色命名（scanner / policy / use case / codec / seeder）；
- 状态放 class private 字段，操作放实例方法；进程级单例导出 `xxxStore`，不要模块顶层 `const map` + 一堆 free functions；
- 先对象化内部并保留方法引用兼容，再切消费者，最后撤别名 / public / allowlist；不要一次性把 API 和状态迁移混在一起；
- oop 段的 `OOP_CANDIDATE` 必须处理或按「未处理项报告」给理由；`MANY_EXPORTS` 只表示人工 review，纯函数模块可以不 OOP；
- hygiene 段的类方法判定（`DEAD` / `INLINE_CANDIDATE` / `PASS_THROUGH`）与自由函数同口径处理；类方法不能成为新的死角。

### 9.6 数据包装类反模式

遇到 `XxxEntity` / `XxxModel` 先问：它是不是只持有一个 DTO/值对象，然后把方法转发过去？

```ts
// 反例：ChatMessageEntity 只是 ChatMessage 的平行 wrapper
class ChatMessageEntity {
  private constructor(private readonly message: ChatMessage) {}
  static from(message: ChatMessage) { ... }
  isUserInput() { return this.message.role === "user"; }
}
```

这不是组合，也不是继承；它只是把 `ChatMessage` 的行为拆到另一个名字里。如果行为只读被包装对象自身的字段：

1. **行为归被包装对象**：把 `ChatMessage` 从 interface 提升为 class，字段仍在，方法直接挂在 `this` 上；
2. **数据归边界**：另设 `ChatMessageData`（DB / IPC 纯形状），持久化与 DTO 只认它；不要为了省一个 mapper 让 class 跨 `JSON.stringify` / IPC；
3. **子字段不是 Entity**：`MessageContent` 是 `ChatMessage.content` 的值对象，不要把它的 `toolUseCount` 单独包装成 `MessageContentEntity`；
4. **单成员 class 优先 object namespace**：只有一个常量/一个无状态 helper 的 class 改成 object namespace（静态 class 允许但纯函数族优先 namespace，见 §5.3），不要 `new` 一个壳。

审计 `logic` 目录时按四类标记：

- **有状态服务**：`ChatAnnotateDraftStore`、`AttachBudget`、`AttachmentHydrator` —— class 合理；
- **无状态领域服务**：`AttachmentScanner`、`AttachmentXmlCodec`、`ComposerSendPolicy`、`ChatLinkResolver` —— 可以是单例对象，但不要假装持有状态；
- **值对象**：`AttachmentPath`、`PromptPathSeen`、`ComposerAtPath` —— 若没有实例状态，用命名空间对象，不要靠 `new` 制造身份；
- **数据包装/假对象**：`MessageContentEntity`、`UserVfsTurnStorage`、`ChatMessageEntity` —— 删除或提升为真正的实体。

### 9.7 顶层裸函数收口（subject-cluster，2026-11-19 立项）

**顶层裸 `export function` 本身是异常态**——即使构不成 ≥3 动词的族，裸导出也不该是默认形态。作用范围由结构（namespace / class）表达，不由名字后缀表达。`createXxx` 族（p23 收成 `XxxFactory`）与「同一主体多动词族」（`SessionApiPromptTokenEntry.read`）是同一原则的两面。

三个可机械化信号：同主体多动词族（`getXxx`/`setXxx`/`deleteXxx`/`renameXxx` 宾语相同）、修饰词复读（`ForTests`/`After*`/`FromLayout`/`InTransaction` ×3+）、超长名（≥32 字符）。

统一改法（机械规则，不做风格判断）：

- **namespace 命名**默认取文件名 PascalCase（`vfs-path-mapper.ts` → `VfsPathMapper`）；文件名带动词前缀（`create-abort-scope.ts`）或与域内符号冲突时，按内容主体起名并在 notes 登记理由。
- 一个文件一个 namespace；文件内**全部**裸 export function 收进去；非 export 的顶层函数**同时收**（同文件内调用改 `Ns.fn(...)`）。
- **成员名剥主体词**：`resolveLogicalPath` → `VfsPathMapper.resolve`；无主体词的保留（`read`/`write`/`parse`）；剥后撞名保留区分性修饰（`resolveNeedDelete`），不许 `resolve2`。
- **硬切，不留兼容壳**：禁止 `export const resolveLogicalPath = VfsPathMapper.resolve` 引用别名（§4.1 已判死刑的形态）。消费方 import 与调用点同步迁移。
- **既有裁决不翻案**：`XxxFactory`（p23）、十八期保留项（persistent-preferences 门面、composer-status 双端镜像）、`common/` 11 个 namespace（p12）是目标形态，不重做。

豁免（默认不允许，必须显式）：React 组件（`.tsx` + PascalCase）、`use*` hooks（React 顶层调用规则）、test 目录、其余确有理由的写 `// nm-style: keep-bare: <理由>` 进 baseline。

检测器：`nm-style list bare --summary|--bucket <桶>` 圈精确清单；`nm-style gate bare` 守增量（新增裸导出 exit 1；全域口径见 §8）；`nm-style check --changed` 的 bare-exports 段拦新增。

## 交付前检查

- 跑过 `nm-style check --changed` 并循环到 0 处？收尾再跑一次 `--all`。
- oop 段的 `OOP_CANDIDATE` 处理了吗？`MANY_EXPORTS` 看过并说明纯函数/该 OOP 了吗？
- 只调用一次的 private / 模块级函数内联了吗？类方法有没有 `DEAD_METHOD` / `INLINE_METHOD` / `PASS_THROUGH_METHOD`？
- 这个 export 的生产引用有几处？测试 import / allowlist 都不算消费者。`INLINE_CANDIDATE` 默认内联（`public=yes` 也一样）。
- 死链的 caller 也一起删了吗？有没有 `return f(x)` 这种单行转手 wrapper？
- 签名、调用参数、错误构造，是否还有多行？
- 域逻辑里还有 throw 吗？throw 是否都收在边界？不变量破坏用 `assert` 了吗？
- 这个 `Result` 真的有失败分支吗，还是为了"统一"硬加的？
- 有没有第二份通用工具/守卫/纯映射该进 `core/common`？（跑 §5.1 的 dup 扫描）
- 有没有「同一首参反复出现 / createXxxState + fn(state) / clear·ForTests 痕迹」该收成对象？（跑 §9.4 的 `list-all-signatures`）
- 改完 typecheck、相关测试、lint 都跑了吗？测试红先降并发复跑过吗？

## 未处理项报告（强制）

`DEAD` / `FAKE_PUBLIC` / `TEST_ONLY` / `INLINE_CANDIDATE` / `PASS_THROUGH`（nm-style hygiene 段 verdict）只要本轮没改掉，交付说明必须逐条列出：

| 符号 | verdict | prod/test | 不处理理由 | 证据 |
| --- | --- | --- | --- | --- |

没有这张表 = 视为漏处理。代码里的 `nm-style: keep-public` / `keep-local` 只是标记，**不能替代报告里的理由**。

**「public / 共享 API」不是理由。** public 只说明撤导出时要同步 barrel 与 allowlist，不说明调用点不止一个；必须说明为什么唯一调用方不能 own 这段逻辑，例如三端共用的唯一入口、跨端契约常量、测试支持 API。说不出来就内联或删除。
