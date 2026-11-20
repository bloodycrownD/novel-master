---
date: 2026-11-17
status: draft
baseline: 26f3c30aa  # 代码事实以此为准（tag abort-scope-ui）
iteration: common-namespace
---

# common 命名空间收口（common-namespace）技术规格（SPEC）

## 一、需求来源

用户在审查 `packages/core/src/common/` 时提出三条：

1. **`common` 现在从 barrel 平铺导出 25 个裸函数**，命名空间是脏的——`truncateText`、`formatTokenCount`、`isRecord`、`isBinaryFilePath` 平铺在一层，同类不同源看不出来。
2. **工具函数不该耦合业务**：`asString(value, fallback)` 的 `fallback`、`requireString(obj, key, label)` 的 `label` 都是业务需求渗进工具签名的痕迹。正确方向是**下游适应工具**，不是工具适配下游。
3. **纯函数工具应该用 object namespace**（`XXX.xxx()`）而不是平铺裸函数，这符合 nm-code-style §9.3「无状态 class 不是对象 → 改成 object namespace 或模块函数」「值对象没有实例状态时用命名空间对象」。

用户同时明确两条边界：

- **`assert` 不收进命名空间**，保持裸函数（断言原语，包一层只是加壳）
- **`isRecord` 要收进命名空间**（`Guards.isRecord`）

## 二、现状审计（baseline `26f3c30aa`）

### 2.1 `common/index.ts` 的 25 个裸导出与引用面

| 导出 | 引用数 | 所属类别文件 |
|---|---|---|
| `isRecord` | **115** | `guards.ts` |
| `assert` | **69** | `assert.ts` |
| `assertNever` | — | `assert.ts` |
| `AssertionError` | — | `assert.ts` |
| `nullableText` | **31** | `coerce.ts` |
| `formatTokenCount` | **28** | `format-token-count.ts` |
| `truncateText` | **23** | `text.ts` |
| `errorText` | **15** | `error.ts` |
| `pad2` | **13** | `format-number.ts` |
| `createTranslator` | **13** | `i18n.ts` |
| `stringOrEmpty` | 11 | `coerce.ts` |
| `integerAtLeast` | 11 | `coerce.ts` |
| `base64ToBytes` | 11 | `encoding.ts` |
| `fnv1aHex16` | 7 | `hash.ts` |
| `isBinaryFilePath` | 7 | `file.ts` |
| `parseJsonText` | 6 | `json.ts` |
| `applyMergePatch` | 5 | `json.ts` |
| `escapeXmlText` | 4 | `xml.ts` |
| `formatRequestTime` | 4 | `format-time.ts` |

（其余 `bytesToBase64` / `utf8ByteLength` / `isImageFilePath` / `normalizeYamlError` / `normalizeSmartSortImportError` / `compareAppVersions` / `excerptReleaseNotes` / `formatContextUsageLabel` / `formatTokenSourceBadge` / `formatDurationMs` / `pageWindowItems` / `escapeXmlAttr` / `unescapeXmlText` 引用数 ≤4）

**合计约 400+ 处调用点。**

### 2.2 `check-oop.mjs` 的现状

`MANY_EXPORTS`（导出函数 ≥6）在 `common/index.ts` 上必然命中——25 个导出从一个 barrel 出。nm-code-style 第 130 行规定「`MANY_EXPORTS` 只表示人工 review，纯函数模块可以不 OOP」，但**同层 25 个平铺导出**与「一组一类」的可读性目标相悖。

### 2.3 业务耦合的三处实证

```
domain/vfs/logic/action-xml-to-tool-uses.ts:16
  function asString(value: unknown, fallback): string
  ← fallback 是业务默认值，工具不该知道

domain/chat/content/parse-message-content.ts:29
  function requireString(obj, key, label): Result<string, ContentError>
  ← label 是为了拼错误文案

infra/db-backup/provider-table-snapshot-validate.ts:21-29
  function asString(value): string | null
  function asNumber(value): number | null
  function nonEmptyString(value): string | null
  ← 这三个与 common/coerce.ts 的 nullableText 功能重叠，各写一份
```

### 2.4 已存在的对应实现（说明「不是缺工具，是没复用」）

```
common/coerce.ts        stringOrEmpty(value): string
                        integerAtLeast(value, min): number | undefined
                        nullableText(value): string | null        ← 即 asString
common/guards.ts        isRecord(value): value is Record<string, unknown>
common/json.ts          parseJsonText(text): Result<unknown, Error>
                        applyMergePatch(current, patch): T
common/text.ts          truncateText(text, maxChars): string
common/format-number.ts pad2(value): string
```

**上面 §2.3 那三个 `provider-table-snapshot-validate` 私有函数，功能已被 `coerce.ts` 覆盖。**

## 三、目标形态

### 3.1 分组（object namespace）

```ts
// packages/core/src/common/coerce.ts
export const Coerce = {
  /** 非字符串（含 null / undefined / 数字 / 对象）→ 空串 */
  string: (value: unknown): string,
  /** 可空文本；null / undefined → null，其余 String(value) */
  nullableText: (value: unknown): string | null,
  /** 数字（含数字字符串）→ number，其余 → undefined */
  number: (value: unknown): number | undefined,
  /** 非负数字 → number，其余（负数 / 非数字 / NaN / Infinity）→ undefined */
  nonNegativeNumber: (value: unknown): number | undefined,
  /** 非空字符串（trim 后非空）→ string，其余 → null */
  nonEmptyText: (value: unknown): string | null,
  /** JSON 文本 → Record，解析失败或不是对象 → null */
  record: (text: string | null | undefined): Record<string, unknown> | null,
  /** 从容器的键里取可空文本 */
  pickText: (container: unknown, key: string): string | null,
} as const;

// packages/core/src/common/guards.ts
export const Guards = {
  isRecord: (value: unknown): value is Record<string, unknown>,
  isNonEmptyString: (value: unknown): value is string,
  isBinaryFilePath: (path: string): boolean,
  isImageFilePath: (path: string): boolean,
} as const;

// packages/core/src/common/json.ts
export const Json = {
  parseText: (text: string): Result<unknown, Error>,
  mergePatch: <T>(current: T, patch: unknown): T,
} as const;

// packages/core/src/common/text.ts
export const Text = {
  truncate: (text: string, maxChars: number): string,
  truncateToBytes: (text: string, maxBytes: number): string,
  escapeRegExp: (s: string): string,
} as const;

// packages/core/src/common/number.ts（原 format-number.ts）
export const Number = {
  pad2: (value: number): string,
  formatBytes: (bytes: number): string,
  trimFraction: (n: number): string,
} as const;

// packages/core/src/common/encoding.ts
export const Encoding = {
  base64ToBytes: (base64: string): Uint8Array,
  bytesToBase64: (bytes: Uint8Array): string,
  utf8ByteLength: (text: string): number,
} as const;

// packages/core/src/common/xml.ts
export const Xml = {
  escapeText: (value: string): string,
  escapeAttr: (value: string): string,
  unescapeText: (text: string): string,
} as const;

// packages/core/src/common/hash.ts
export const Hash = {fnv1aHex16: (text: string): string} as const;

// packages/core/src/common/errors.ts（原 error.ts）
export const Errors = {
  text: (error: unknown): string,
  normalizeYaml: (error: unknown, fallback: string | CoreMessageDescriptor): Error,
  normalizeSmartSortImport: (error: unknown): Error,
} as const;

// packages/core/src/common/release.ts
export const Release = {
  compareVersions: (local: string, remote: string): Result<-1 | 0 | 1, AppError>,
  excerptNotes: (body: string, focus?: ReleaseNotesFocus): string,
} as const;

// packages/core/src/common/token-format.ts（原 format-token-count.ts + usage-stats-format.ts 合并）
export const TokenFormat = {
  count: (n: number): string,
  contextUsageLabel: (count: number, contextWindow?: number, badge?: TokenSourceBadge): string,
  sourceBadge: (source: "api" | "local" | undefined, counterKind: string, estimated: boolean): TokenSourceBadge,
  requestTime: (ms: number): string,
  durationMs: (ms: number | null): string,
  pageWindow: (current: number, totalPages: number): (number | "…")[],
} as const;
```

### 3.2 为什么 `isRecord` 收进 `Guards`、`assert` 不收

两者都是「判定」，但性质相反：

| | 返回 | 行为 | 调用方义务 |
|---|---|---|---|
| `isRecord(value)` | `boolean`（`value is Record<string, unknown>`） | 只回答「是不是」 | 必须自己处理 false 分支 |
| `assert(cond, msg)` | `asserts cond` | 不是就抛 `AssertionError` | 无需处理，继续写 |

**一个是问句，一个是命令句。**

- `isRecord` 是 type predicate，`guards.ts` 的模块注释已写明「只放输入 unknown、输出类型收窄或布尔的小函数」——它属于这个类别，收进 `Guards` 让「这是 common 的谓词」在调用点可见。
- `assert` 是运行时中断原语，包成 `Assert.assert()` 只是加壳，**用户已拍板保持裸函数**。

`isRecord` 的引用面：core 98 处 + mobile 17 处 = **115 处**，是本期最大的一组机械改动。

### 3.2 三个例外：不进命名空间

| 符号 | 理由 |
|---|---|
| `assert` / `assertNever` / `AssertionError` | 断言原语。写成 `Assert.assert()` 只是加壳，违反 nm-code-style 第 45 行「不要给错误工厂再包一层」的精神。**用户已拍板：`assert` 不收进命名空间。** |
| `createTranslator` + `MessageLike` / `MessageParams` / `MessageCatalog` 类型 | i18n 是工厂 + 类型族，不是一类工具函数。保持裸导出。 |
| `Guard` 类型 `AppErrorGuard` 等 | 类型声明不占运行时命名空间。 |

### 3.3 业务与工具的边界（下游适应工具）

**工具签名只接原语，不接业务概念。**

| 现状（错） | 目标（对） |
|---|---|
| `asString(value, fallback)` | `Coerce.string(value)`，业务侧 `\|\| "（未命名）"` |
| `requireString(obj, key, label): Result<_, ContentError>` | `Coerce.pickText(obj, key)`，业务侧判 null 后自己构造带 label 的错误 |
| `nonEmptyString(value)` 私有版 | `Coerce.nonEmptyText(value)` |
| `truncate(text, maxChars)` 私有版 | `Text.truncate(text, maxChars)` |

**判据**：函数签名里出现业务名词（`label` / `fallback` / 具体实体名）即为耦合，必须改到调用侧。

## 四、实施策略（一次性完成，不分阶段）

**用户明确要求：一个工作流一次做完，不做「先加 re-export 再替换再删」的三段式。** 理由是分段会留下「两套写法并存」的中间态，后续维护者不知道该用哪套，而且 re-export 过渡期一旦忘记删就永久留壳。

### 4.1 一次改完的形态

`common` 的 11 个文件改成 object namespace 的同时，**同一轮内把全部调用点改完**，`index.ts` 直接只导出 namespace 对象（+ `assert` / i18n 例外），不留任何裸函数 re-export。

编译在过程中必然红——这是预期，由收敛波统一修到绿。

### 4.2 分片（按文件零交集，7 片并行）

| 片 | 范围 | 规模 |
|---|---|---|
| C1 | `packages/core/src/common/` 全部 11 个文件改 namespace + `index.ts` 收口 | 15 文件 |
| C2 | `packages/core/src/domain/` 的全部调用点 | 约 60 文件 / 180 处 |
| C3 | `packages/core/src/service/` 的全部调用点 | 约 40 文件 / 90 处 |
| C4 | `packages/core/src/infra/` + `packages/core/src/presentation/` + `packages/core/src/errors/` 的调用点 | 约 30 文件 / 70 处 |
| C5 | `packages/core/src/public/` + `packages/core/src/index.ts` 的转发改指 | 约 12 文件 |
| C6 | `apps/desktop/` 的全部调用点 | 约 25 文件 / 60 处 |
| C7 | `apps/mobile/` 的全部调用点 | 约 20 文件 / 50 处 |

每片拿到的是**该目录下的确定文件清单**（由探针波用 `git grep` 生成，不靠记忆枚举）。

### 4.3 波次

```
波1  探针（1 片，只读）：跑 git grep 生成「每个旧裸函数 → 引用的文件:行」完整映射表，
      按 C2~C7 的目录归属切成 6 份确定清单，落盘到 /tmp/ns-shards/{c2..c7}.txt
波2  C1~C7 七片并行（各自读自己的清单文件；C1 先改 common 本体，其余片按清单改调用点）
波3  收敛（编译红按文件分片修，最多 6 轮）
波4  测试收敛（core 全量 + 三端）
波5  门禁与 tag
```

**波 2 的 C1 与其他六片有依赖**：C1 改完 namespace 之前，其他片改调用点会引用不存在的符号。但因为是同时改、波 3 统一收敛，顺序不影响最终结果——**每片都按目标形态写，不迁就中间态**。

### 4.4 每片的纪律

- 只改自己清单里的文件
- **按目标形态写**：`import {Coerce} from "@novel-master/core/common"` + `Coerce.nullableText(x)`，不写兼容层
- 拿不准的（比如某个调用点用的是 `nullableText` 还是 `stringOrEmpty` 语义）进 notes，不猜
- 不 build、不 commit、不动 `node_modules` / `dist`

## 五、变更点清单

| 文件 | 改动 |
|---|---|
| `common/coerce.ts` | 新建 `Coerce` 对象（7 个方法：string / nullableText / number / nonNegativeNumber / nonEmptyText / record / pickText）；原三个函数收进去 |
| `common/guards.ts` | 新建 `Guards` 对象（isRecord / isNonEmptyString / isBinaryFilePath / isImageFilePath）；从 `file.ts` 搬入两个路径判断 |
| `common/json.ts` | 新建 `Json` 对象（parseText / mergePatch） |
| `common/text.ts` | 新建 `Text` 对象（truncate / truncateToBytes / escapeRegExp）；`truncateToBytes` 与 `escapeRegExp` 为新增 |
| `common/format-number.ts` → `common/number.ts` | 改名 + 新建 `Number` 对象（pad2 / formatBytes / trimFraction） |
| `common/encoding.ts` | 新建 `Encoding` 对象 |
| `common/xml.ts` | 新建 `Xml` 对象 |
| `common/hash.ts` | 新建 `Hash` 对象 |
| `common/error.ts` → `common/errors.ts` | 改名 + 新建 `Errors` 对象 |
| `common/release.ts` | 新建 `Release` 对象 |
| `common/format-token-count.ts` + `common/usage-stats-format.ts` → `common/token-format.ts` | 合并 + 新建 `TokenFormat` 对象（6 个方法） |
| `common/assert.ts` | **不动**（保持裸函数） |
| `common/i18n.ts` | **不动**（工厂 + 类型族） |
| `common/index.ts` | 阶段 1 双导出，阶段 3 只导出 namespace + assert + i18n |
| `common/file.ts` | 两个判断搬进 `guards.ts` 后删除该文件（`extensionOf` 若存在且仅一处用，一并处理） |
| 约 400 处调用点 | 按阶段 2 的分组顺序替换 |

## 六、验收

### 6.1 确定性门禁

| 项 | 判据 |
|---|---|
| 根 typecheck | `npm run typecheck` exit 0，0 个 error TS |
| core 全量 | `npm test --prefix packages/core` 0 fail |
| 桌面 / 移动 | `npm test --prefix apps/desktop` / `apps/mobile` 0 fail |
| nm style 三段 | `check-style --all` 的 signatures / inline / methods 全 PASS |
| `MANY_EXPORTS` | `common/index.ts` 上不再报（导出对象数 ≤ 12） |
| 裸函数清零 | `grep -rn "from \"@/common/index.js\"" ...` 里不再出现阶段 3 删除的裸名 |

### 6.2 行为等价

- 所有迁移函数**逐个**保证：同一输入产生同一输出（含边界：`null` / `undefined` / `NaN` / 空串 / 非字符串）
- `Coerce.nullableText(null)` === `null`，`Coerce.string(null)` === `""`（语义不同，不许混）
- `Coerce.number("12")` === `12`，`Coerce.number("12.5")` === `12.5`，`Coerce.number("abc")` === `undefined`

### 6.3 新增测试

- `common/coerce` 单测：每个方法的边界矩阵（`null` / `undefined` / 数字 / 数字字符串 / 空串 / 空白串 / 对象 / 数组 / NaN / Infinity）
- `common/guards` 的 `isNonEmptyString` 边界
- `Text.escapeRegExp` 对 `.*+?^${}()|[]\` 全字符集
- `Number.formatBytes` / `trimFraction` 边界（0 / 负数 / 极大值）

## 七、不在范围

- **`apps/cli`** 已停止维护，不迁移、不计入门禁
- **有状态的类**（`DoomLoopDetector`、`AgentActivityTracker`、`PushAgentMutex` 等）继续用 class，nm-code-style §9.3「有状态才对象化」
- **各域内部的私有 helper 是否提升为公共工具**：本迭代只做「`common` 已导出但各域重写」的那批（审计出 16 个类型窄化 + 12 个格式化），域内独有的私有函数不动
- **`utils/` 与 `common/` 的合并**：若存在其他 `utils` 目录，另行评估

## 八、风险与回滚

| 风险 | 缓解 |
|---|---|
| 400 处调用点替换漏改 | 阶段 1 保留裸函数 re-export，编译恒绿；阶段 3 之前跑一次全量 grep 确认零残留 |
| `Coerce.string` 与 `Coerce.nullableText` 语义混淆（`""` vs `null`） | 6.2 逐条锁边界；两函数 JSDoc 明确写「非字符串 → 空串」与「null/undefined → null」 |
| `Number` 与 `TokenFormat` 的分工不清 | `Number` 只做数值格式化（补零/字节/小数裁剪），`TokenFormat` 只做 token 相关展示（计数/上下文占用/请求耗时） |
| 阶段 3 删得太早 | 每组替换完独立跑 typecheck + core 测试；阶段 3 单独一个提交，出问题 `git revert` 即可 |
