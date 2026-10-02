---
zone: w9-cliperiph-pro
agent: 检察官（对抗机位，猎杀四端 sksp / 双 tokenizer 复制漂移 / cli 死命令 / 样板冗余）
files_scanned: 82
---

# w9-cliperiph — 检察官报告

## 摘要

CLI 端到端装配层（`nm` 命令树、runtime 工厂、scope 解析）与四类平台驱动包。
SKSP 是密钥存储端口的平台实现（mac/linux/windows/android 四份），
TDBC 是 SQLite 协议抽象的三个驱动（better-sqlite3 / op-sqlite / quick-sqlite-rn），
tokenizer-driver-node / -rn 是提示词 token 计数的两端驱动，另有 cloud-sync S3
对象存储与 llm-sse-native 的原生 SSE 传输。本区几乎全是「同一份逻辑在多端各抄一遍」
的结构，真正的缺陷都藏在抄漏的分支里。

## 职责与边界

- `apps/cli/src/**`：CLI 全部命令树 + DB 打开与服务装配（`runtime.ts` 单点开库）。
- `packages/sksp-{mac,linux,windows,android}/src/**`：`SecretStore` 的平台实现，
  只提供「strategy + 一个 BaseSqliteSecretStore 子类」，SQL 编排归 core。
- `packages/tdbc-driver-{better-sqlite3,op-sqlite,rn}/src/**`：`TdbcDriver` +
  `TdbcConnection` 三个实现，SQL 语义必须一致（由 tdbc-conformance 兜底）。
- `packages/tokenizer-driver-{node,rn}/src/**`：`countPromptLlmInput` 的两端实现。
- `packages/cloud-sync-driver-s3/src/**`、`packages/llm-sse-native/src/**`、
  `packages/tdbc-conformance/src/**`（node:test 断言套件，非生产代码）。
- **不在边界**：core 内部实现（`packages/core/src/**` 只作为被依赖方读证据）、
  mobile / desktop 装配点、android kotlin 侧。

## 对外接口

| 包 | 入口 | 关键导出 |
|---|---|---|
| sksp-mac / -linux | `index.ts` | `registerSkspMacDriver` / `registerSkspLinuxDriver`、`create*SecretStore`、`set*KeychainTestPassthrough` |
| sksp-windows | `index.ts` | `registerSkspWindowsDriver`、`createWindowsSecretStore`、`setDpapiTestPassthrough` |
| sksp-android | `index.ts` / `native.ts` | `registerSkspAndroidDriver`、`createAndroidSecretStore`、`getSkspNativeModule` |
| tdbc-driver-better-sqlite3 | `index.ts` | `registerBetterSqlite3Driver`、`BetterSqlite3Connection`、`AsyncMutex` |
| tdbc-driver-op-sqlite | `index.ts`（动态） / `native.ts`（静态） | `registerOpSqliteDriver`、`OpSqliteDriver`、`NativeOpSqliteAdapter` |
| tdbc-driver-rn | `index.ts` / `native.ts` | `registerRnDriver`、`RnDriver`、`NativeQuickSqliteAdapter` |
| tokenizer-driver-node | `index.ts` | `registerTokenizerNodeDriver`、`countPromptLlmInput`、`countTextWithDefaultEncoding`、`getNodeEncodingForModel` |
| tokenizer-driver-rn | `index.ts` / `native.ts` / `encoding.ts` | `registerTokenizerRnDriver`、`countPromptLlmInputRn`、`getRnEncoding`、`countTextWithDefaultEncoding` |
| cloud-sync-driver-s3 | `index.ts` | `createS3ObjectStorage`、`normalizeEtag`、`isAliyunOssEndpoint` |
| llm-sse-native | `index.ts`（环境无关） / `native.ts`（RN） | `createNativeSseTransportFromBridge`、`NativeSseTransportError`、`NativeSseAbortError`、`registerNativeSseTransportWith` |
| tdbc-conformance | `index.ts` | `runConformanceTests`（C1–C11）、`runNestedBatchParityTests`（NB1–NB3） |

## 数据访问

| 域 | 落点 | 证据 |
|---|---|---|
| `sksp_secrets` 表 | DDL `ciphertext BLOB / iv BLOB`，`algo` CHECK 限四值 | `packages/core/src/bootstrap/sksp/sksp-schema.ts:8-21` |
| SKSP 读写编排 | `SELECT ciphertext, iv, algo, version ... WHERE ref`；`INSERT ... ON CONFLICT DO UPDATE` | `packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts:38-93` |
| macOS 主密钥 | Keychain service `novel-master` / user `sksp-master-v1`，base64 编码 32B | `packages/sksp-mac/src/keychain.ts:10-11,87` |
| Linux 主密钥 | Secret Service service `novel-master-linux` / 同一 user | `packages/sksp-linux/src/keychain.ts:10-11,87` |
| Windows | DPAPI CurrentUser，无 iv（DB 存 NULL） | `packages/sksp-windows/src/sqlite-secret-store.ts:34-43` |
| Android | Keystore 经 `NativeModules.SkspModule`，密文/iv 存 base64 **文本** | `packages/sksp-android/src/android-secret-store.ts:46-82` |
| Node 编码表 | 进程级单例，registry 键 `enc:<name>`，绝不 free | `packages/tokenizer-driver-node/src/impl/encoding-cache.ts:20-24,103` |
| RN 编码表 | 同 registry，仅 cl100k / o200k 两表 | `packages/tokenizer-driver-rn/src/impl/encoding-cache.ts:69-85` |
| L1 / L2 计数缓存 | 驱动内 `promptWholeCache` / `tokenChunkCache`（core 实现），查 L1 传空 sessionId | `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:190-215` |
| 移动端 DB 文件 | legacy quick-sqlite 布局 `<files>/default/<name>` 探测 + `failOnCreate` | `packages/tdbc-driver-op-sqlite/src/driver.ts:43-56` |
| S3 对象 | `HeadObject` / `GetObject` / `PutObject`（条件头 Aliyun 端点下模拟） | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:156-223` |

## 依赖关系

```
apps/cli/src/main.ts
  └─ runtime.ts ─ registerBetterSqlite3Driver + register{Node,Mac,Linux,Windows}Sksp + registerTokenizerNodeDriver
       └─ @novel-master/core（单一开库 + 全部服务工厂）
sksp-*  ──► @novel-master/core/sksp (BaseSqliteSecretStore, SkspError)
tdbc-*  ──► @novel-master/core (TdbcConnection/TdbcDriver/registerDriver/normalizeBindings)
tokenizer-* ─► @novel-master/core/provider (registry, countOpenAiStyleMessages, HeuristicTokenCounter, promptWholeCache)
llm-sse-native ──► 无 core 依赖（鸭子类型 port，app 装配点注入 registerSseTransport）
cloud-sync-driver-s3 ──► @aws-sdk/client-s3 + @novel-master/core（ObjectStoragePort / CloudSyncError）
```

被谁消费：`apps/mobile/src/db/connection.ts`（op-sqlite + sksp-android + tokenizer-rn）、
`apps/mobile/src/runtime/create-mobile-runtime.ts`（SKSP composite）、
`apps/desktop`（better-sqlite3 + sksp-windows + tokenizer-node）、
`apps/cli/src/runtime.ts:174-176`（三注册点同处一个函数）。

---

## 发现清单

### F-w9-cliperiph-1 | P2 | `apps/cli/src/vfs/errors.ts:1-28`（整文件）

```
export const EXIT_USAGE = 1;
export function formatCliError(error: unknown): string { ... }
export function exitCodeForError(error: unknown): number { ... }
```

**描述**：本文件与 `apps/cli/src/cli-errors.ts` 是同一对函数的**两份实现**，
`vfs/errors.ts` 版只认 `VfsError` / `TdbcError` 两个类型。实测全仓引用
（`node tmp/w9grep.mjs apps/cli EXIT_USAGE`）只有两处声明 + `main.ts:25,89,105,135`
从 `cli-errors.ts` 导入，**`vfs/errors.ts` 零 importer**。`cli-errors.ts` 是当前
唯一生效的那份（认 12 类错误），`vfs/errors.ts` 是重构前的遗留。

**建议**：删除 `apps/cli/src/vfs/errors.ts`。它是纯死文件，且是一枚定时炸弹——
若日后有人从 `./vfs/errors.js` 导入 `exitCodeForError`，会拿到只认两类的旧版本，
`ProviderError` / `SkspError` 等的 exit code 行为与主链路不一致。

**置信**：confirmed（引用数实测为 0）

---

### F-w9-cliperiph-2 | P2 | `apps/cli/src/main.ts:189-191`

```
const name = argv[0] ?? "world";
console.log(`Hello, ${name} from ${PACKAGE_NAME}`);
return 0;
```

**描述**：`nm` 走到这里说明**顶层命令拼错了**（或没给参数），但代码把它当成
scaffold 时代的 hello-world 兜底：`nm frobnicate` 会打印
`Hello, frobnicate from @novel-master/core` 并 **返回 0**。这有两个后果：
①拼错的命令以成功退出，CI / shell 脚本里的 `nm <错字> && echo ok` 会静默通过；
②与 `top === "config" || top === "kkv"` 分支（`main.ts:101-106`）的显式
`EXIT_USAGE` 口径自相矛盾——同样是「未知命令」，走那分支返回 1、走兜底返回 0。

**建议**：兜底分支改为 `console.error` 打全局 usage 并 `return EXIT_USAGE`；
若确实想保留 hello 行为，至少不能 return 0。

**置信**：confirmed

---

### F-w9-cliperiph-3 | P2 | `apps/cli/src/main.ts:99-115` + `117-187`

```
if (top === "vfs") { try { return await runVfs(argv.slice(1)); } ... }
if (top === "preferences" || top === "project" || ...) {
  const rt = await createNovelMasterRuntime(argv);   // ← 开库在这里
  try {
    const sub = argv[1];
    if (sub == null) { console.error(`Usage: ...`); return EXIT_USAGE; }
```

**描述**：`createNovelMasterRuntime` 里有**实打实的重活**——`mkdir` 建库目录、
`open()`、`bootstrapNovelMaster()` 全量 DDL、以及两个后台搬运任务
（`runMessageContentCompaction` / `runBlobBinaryNormalization`，各 60s 同步预算，
合计最坏约 120s，见 `runtime.ts:184-191`）。而 `sub == null` 的 usage 判定
发生在**开库之后**。即 `nm preferences`（漏打子命令）会先付一次全量 bootstrap
才告诉用户「Usage: nm preferences <subcommand>」。`runVfs` 侧同样
（`main.ts:71` 先开库，`85-90` 才判子命令合法性）。

**建议**：把子命令白名单校验前移到 `createNovelMasterRuntime` 之前。
顶层的 `if (top === ...)` 白名单已经是前置校验了，白名单内再补一层子命令校验即可。

**置信**：confirmed

---

### F-w9-cliperiph-4 | P2 | `apps/cli/src/vfs/runtime.ts:1-25`（整文件）

```
export { resolveDbPath } from "../runtime.js";
export async function createVfsRuntime(argv: readonly string[]): Promise<{...}> {
  const rt = await createNovelMasterRuntime(argv);
  return { vfs: rt.globalVfs(), conn: rt.conn };
}
```

**描述**：本文件是 `runtime.ts` 的一层**无引用转发**。实测
（`node tmp/w9grep.mjs . createVfsRuntime`）生产代码里只出现在本文件 `:18` 一处，
`main.ts` 的 vfs 分支直接用 `createNovelMasterRuntime` + `rt.globalVfs()`。
同文件 re-export 的 `resolveDbPath` 同样零 importer（`resolveDbPath` 在
`runtime.ts:112` 有定义、在 `runtime.ts:117` 自用）。

**建议**：删除 `apps/cli/src/vfs/runtime.ts`。

**置信**：confirmed

---

### F-w9-cliperiph-5 | P2 | `apps/cli/src/config/load-agent-config-file.ts:65-70`

```
/** Reads a single-agent config file (not a bundle). */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  return loadAgentFromConfig(path);
}
```

**描述**：`loadAgentFromConfig`（同文件 `:30`）才是实际调用方
（`agent/commands.ts:82`）。`loadAgentConfigFile` 是它去掉 `agentId` 参数的
退化包装，实测零 importer。doc comment 还写着「(not a bundle)」，而它转发的
`loadAgentFromConfig` **明确支持 bundle**（`isAgentsBundleDocument` 分支，`:38-60`）——
注释与实现语义相反，留在原地会误导后来者以为单读路径不支持 bundle。

**建议**：删除该函数（同 F-4 一并处理）。

**置信**：confirmed

---

### F-w9-cliperiph-6 | P2 | `packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:124-147`

```
export class ClaudeWebTokenCounter extends WebTokenizerCounter {
  constructor() { super("claude"); }
}
...
/** @internal test helper */
export function messagesToOpenAiStyle(
  messages: readonly { role: string; content: string }[],
): OpenAiStyleMessage[] { ... }
```

**描述**：`ClaudeWebTokenCounter` 是 `new WebTokenizerCounter("claude")` 的零增益
子类（`countWebFamilyPrompt` 直接 `new WebTokenizerCounter(family)`，不经过它，
`:135-137`）；`messagesToOpenAiStyle` 是 `messages.map(m => ({role, content}))`
的 identity 映射，而 `OpenAiStyleMessage` 就是这个形状。两者实测均零 importer。

**建议**：删除两个符号。`@internal test helper` 的注释在本仓没有约束力
（本仓不用 `@internal` 做可见性裁剪，只是注释），留着就一定会被当活代码引用。

**置信**：confirmed

---

### F-w9-cliperiph-7 | P2 | `packages/sksp-mac/src/sqlite-secret-store.ts:22-45` ≡ `packages/sksp-linux/src/sqlite-secret-store.ts:22-45`

```
function rowCiphertext(row: Row): Uint8Array {
  const raw = row.ciphertext;
  if (raw instanceof Uint8Array) { return raw; }
  if (typeof raw === "string") { return new Uint8Array(Buffer.from(raw, "binary")); }
  throw new SkspError("DB_ERROR", "Invalid ciphertext column type");
}
```

**描述**：`rowCiphertext` / `rowIv` 两个函数在 mac 与 linux 两包**逐字相同**（`fc /n`
实测除文件头注释外无差异），`crypto.ts` 更是**整个文件仅第 2 行注释不同**
（`AES-256-GCM encrypt/decrypt for macOS` vs `for Linux`，`fc /n` 确认
1858 字节、仅 1 行差异）。`keychain.ts` 同样是模板复制，仅平台名与服务名字符串不同。
四端 sksp 的真实差异只有「怎么拿主密钥」和「密文是 Uint8Array 还是 base64 文本」
两点，其余全在抄。

**建议**：AES-GCM 加解密与行解码沉到 core（放 `infra/sksp/impl/`，
与 `base-sqlite-secret-store.ts` 同级），mac/linux 只保留 `keychain.ts` 里的
`getOrCreateMasterKey`；android 的 base64 形态差异已由 `SkspCryptoStrategy` 的
`unknown` 载荷类型承载，不需要复制 AES 代码。

**置信**：confirmed

---

### F-w9-cliperiph-8 | P2 | `packages/tdbc-driver-rn/src/*` vs `packages/tdbc-driver-op-sqlite/src/*`（8 个文件对）

```
// tdbc-driver-rn/src/row-mapper.ts:33-48 与 op-sqlite/src/row-mapper.ts:33-48
function rowFromObject(record: Record<string, unknown>): Row { ... }
function rowFromArray(values: unknown[], columnNames: readonly string[]): Row { ... }
```

**描述**：RN 与 op-sqlite 两个驱动的同名文件是**逐字复制**（`fc /n` 确认
`row-mapper.ts` 除类型名 `QuickSqliteResult`→`OpSqliteResult` 与注释外**完全相同**，
93 行 vs 93 行；`mutex.ts` 去掉注释后 sha256 完全一致；`connection.ts` 316 vs 330 行，
差异仅 `driver: "rn"` vs `"op-sqlite"` 字符串、日志前缀、以及 op-sqlite 多出的
`isBackground` 后台让步分支）。`bindings.ts`（27 vs 35 行）、`adapter.ts`、
`register.ts`、`index.ts`、`native.ts` 同理。

`row-mapper.ts` / `bindings.ts` / `mutex.ts` 三个文件**与平台完全无关**
（只有类型参数名不同），是纯冗余。

**建议**：
① `row-mapper.ts` / `bindings.ts` / `mutex.ts` 三者沉 core（`infra/tdbc/impl/`），
   做成 `rowsFromResult(result: {rows?; columnNames?; metadata?}): Row[]` 的泛型函数，
   两端共用；
② `connection.ts` 的 SAVEPOINT 嵌套 + 事务边界 + 16ms 让步是一整套语义，
   抽成 core 的 `createSqliteAdapterConnection({ driverName, adapter, isBackground })`
   工厂，两端只提供 adapter。

**注**：RULE.md「TDBC 驱动层」条目明确写了 quick-sqlite 旧驱动
（`tdbc-driver-rn`）**保留作回滚线**，所以「rn 包的存在」是 intentional、
不是问题；本条针对的是**它与 op-sqlite 之间的代码复制**，回滚线不需要一份独立的
SQL 语义实现。

**置信**：confirmed（`fc /n` 与 sha256 实测）

---

### F-w9-cliperiph-9 | P2 | `packages/tdbc-driver-rn/src/connection.ts:206-227`（≡ op-sqlite `:212-233`）

```
// --- batch boundary: standalone transaction via adapter ---
await this.runAdapter("BEGIN", undefined);
try {
  const result = await runStatements();
  await this.runAdapter("COMMIT", undefined);
```

**描述**：`runAdapter` 的分流条件是 `this.inTransaction && this.adapter.executeSync`
（`connection.ts:250`）。独立 batch 路径此时 **`inTransaction === false`**
（`inTransaction` 只在 `transaction()` 里置位，`:62` / `:98`），于是
`BEGIN`、`runStatements()` 里每一条语句、`COMMIT` 全部走 **async `adapter.execute`**。

而同一文件的模块注释（`:66-72`）与 `runAdapter` 注释（`:238-245`）都把
「事务内 async execute 走后台线程与 JS 线程并发同一连接 → disk I/O error / SIGSEGV」
写成真机实测结论。独立 batch 是**包在 BEGIN/COMMIT 里的真事务**，却因为
`inTransaction` 标志没置位而整段走 async 路径，正好落在注释描述的危险组合上。
`nb_parity` / `conformance_batch` 用的都是 2–3 行小批量，测不出来。

**建议**：`batchDirect` 的独立事务分支要么把 `inTransaction` 也置位
（让 `runAdapter` 走 executeSync + 让步），要么在 `runAdapter` 里加
「BEGIN/COMMIT 语境」判定。改完需要在 conformance 里加一条
「独立 batch 内多条语句走 executeSync」的计数断言（现在 NB 套件测不到这条分支）。

**置信**：suspected —— 分流逻辑与注释矛盾是确定的；「独立 batch 在真机上是否会
真的触发 disk I/O error」我没在真机验证过，但按注释的自述口径这是已知的失败形态。

---

### F-w9-cliperiph-10 | P2 | `packages/tdbc-driver-op-sqlite/src/index.ts:24-32` vs `native.ts:23-31`

```
// index.ts
export function registerOpSqliteDriver(adapter?, isBackground?): void {
  registerOpSqliteDriverWith(adapter ?? new OpSqliteDynamicAdapter(), isBackground);
}
// native.ts
export function registerOpSqliteDriver(adapter?, isBackground?): void {
  registerOpSqliteDriverWith(adapter ?? new NativeOpSqliteAdapter(), isBackground);
}
```

**描述**：op-sqlite 包**已经做对了**这件事——`register.ts:28-33` 的
`registerOpSqliteDriverWith` 是单点实现，模块头注释明写「统一转发到这里：
单点实现、两入口天然一致，杜绝『只改 index.ts 漏掉 native.ts』的分叉」。

**同仓的 `tdbc-driver-rn` 没有做**：`index.ts:20-22` 与 `native.ts:19-21` 是
两份平行实现，各自 `new RnDriver(adapter ?? new XxxAdapter())`。
两份都是 3 行，改一处忘另一处不会被任何东西挡住。

**建议**：`tdbc-driver-rn` 照抄 op-sqlite 的 `register.ts` 单点模式
（把 `registerRnDriverWith(driver)` 抽出来）。这是「已识别但只修了一端」的样板漂移。

**置信**：confirmed

---

### F-w9-cliperiph-11 | P2 | `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:49-50` 与 `packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:72-73`

```
/** 与 `register.ts` 的 NODE_DRIVER_NAME 同值（L2 计数器身份段；import 会成环，故就地重复）。 */
const DRIVER_NAME = "node";
```

**描述**：`L2` 计数器身份段（`buildCounterScope` 的 `driverName`）靠**字面量**与
`register.ts:15` 的 `NODE_DRIVER_NAME` / `register.ts:10` 的 `RN_DRIVER_NAME` 对齐。
注释诚实地说明了「import 会成环，故就地重复」。但这是**缓存键的静默一致性依赖**：
任一端改了 `register.ts` 的常量而没改 `count-prompt-llm-input.ts`，
`buildCounterScope` 产出的 scope 字符串就变了 → 该端的 L2 块缓存与 L1 整串缓存
**全部 miss**（不报错、不脏读，只是命中率归零、退化成每次现算）。
`buildCounterScope` 的实现不在本区（在 core），但两个 `register.ts` 与两个
`count-prompt-llm-input.ts` 的耦合是本区的。

**建议**：把驱动名常量下沉到 core（`infra/tokenizer/`），两端 `register.ts` 与
`count-prompt-llm-input.ts` 都从 core 引，彻底断开环。退一步的方案是在
`register.ts` 里加一条启动期断言（`buildCounterScope` 结果含预期 driverName），
让漂移变成会响的错而不是静默的性能塌陷。

**置信**：confirmed（耦合关系）；影响面（命中率归零）为 suspected

---

### F-w9-cliperiph-12 | P2 | `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:273-278`

```
if (family === "tiktoken" && resolveTokenizerFamily(vendorModelId, "auto") !== "tiktoken") {
  estimated = true;
}
```

**描述**：node 驱动在 tiktoken 精确档里有一段**「身份来自 override 则必须标
estimated」的判定**，注释（`:265-272`）说这是 cr-tok-1 的修复：不标的话
「压缩阈值会跳过 0.85 安全系数、L1 还会把条目收进 pendingWrites 跨重启落 KKV」。

RN 驱动的对应位置（`tokenizer-driver-rn/src/count-prompt-llm-input.ts:241`）是
`return { count, counterKind: "tiktoken", estimated: false };`——**无条件 false**，
没有这段判定。RN 侧靠 `resolveRnEncodingName`（`:172-188`）在解析出界时返回
`null` 来降级，但那挡不住「模型名在 cl100k/o200k 域内、而 override 强制成了 tiktoken」
的情形：此时 family 是被强制的，算的是 cl100k 对非 OpenAI 家族的近似，
却报成精确档。

两端对同一语义给出不同的 `estimated`，下游（压缩阈值、L1 落 KKV）按不同口径处理。

**建议**：把这段判定提到 core，两端共用（同 F-11 的下沉思路）。
补一条对拍用例：`tokenizerOverride: "tiktoken"` + `vendorModelId: "glm-4.6"`，
断言两端 `estimated` 都是 `true`。

**置信**：suspected —— 差异是确定的（读过两端代码），但「RN 侧这个具体输入
真的能落到 `estimated: false`」我没有跑起来验证（需要真实 registry +
`tiktokenOverride` 注入），留给 W6 验证。

---

### F-w9-cliperiph-13 | P3 | `apps/cli/src/**`（11 处）

```
function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}
```

**描述**：`flagString` 在 `apps/cli/src` 里有 **11 份**（`agent/commands.ts:28`、
`agent/registry-commands.ts:19`、`compaction-conditions/commands.ts:15`、
`config/resolve-entity.ts:9`、`config/resolve-provider-scope.ts:13`、
`config/resolve-scope.ts:9`、`model/commands.ts:19`、`provider/commands.ts:13`、
`provider/model/commands.ts:19`、`provider/model/sampling-commands.ts:17`、
`sort-rule/commands.ts:21`）。其中 8 份变量名是 `v`、3 份是 `value`（`config/` 下），
去掉注释后分成两个 sha256 组，**代码逻辑完全相同**。

`apps/cli/src/vfs/parse-args.ts` 是 CLI 的公共 argv 解析层，`flagString` 天然属于那里。

**建议**：`flagString` 上提到 `vfs/parse-args.ts`（或新建 `config/flag-helpers.ts`）
导出，11 处改 import。顺手加一个 `flagBool(flags, key)`——`preferences/commands.ts`
等处现在都在手写 `flags.get("save") === true` / `flags.get("tokens") === true`。

**置信**：confirmed（脚本分组实测）

---

### F-w9-cliperiph-14 | P3 | `apps/cli/src/session/commands.ts:182` + `project/vfs.ts:80`

```
const vfs = deps.sessionVfs(projectId, sessionId);
const idx = args.indexOf(group);
const subArgs = args.slice(idx + 1);
```

**描述**：`group` 来自 `parseCliArgs` 的 `positional[0]`（已剥掉 flag 与 flag 值），
但 `idx` 却在**原始 `args`** 里 `indexOf`。若某个 flag 的值恰好等于子命令名
（`nm session vfs --path read read`：`positional[0] === "read"`，
但 `args.indexOf("read")` 命中的第一个是 `--path` 的值），切出来的 `subArgs`
就会错位，把 flag 值当成了子命令后的位置基准。

`project/vfs.ts:48/61/80` 三处用同一个 `vfsRest.indexOf(sub)` 模式，同样问题。

**建议**：`parseCliArgs` 已经在剥 flag，直接用 `positional.slice(1)` 作 `subArgs`
（但 export-zip / import-zip / import-character-card 三条需要它们后面的原始 args，
可让 `parseCliArgs` 额外返回每个 positional 的原始下标）。改动面小但要三处一起改。

**置信**：confirmed（逻辑推演，未实跑 CLI 复现）

---

### F-w9-cliperiph-15 | P3 | `packages/llm-sse-native/src/types.ts:38-46` + `transport.ts:153`

```
/** @deprecated 读超时已退役（恒禁用）；唯一自动兜底是整调用 callTimeout */
export const LLM_SSE_DEFAULT_READ_TIMEOUT_MS = 30_000;
```
```
const readTimeoutMs = timeouts?.readMs ?? -1;
```

**描述**：`LLM_SSE_DEFAULT_READ_TIMEOUT_MS` 被标 `@deprecated`，注释说读超时已退役。
实测（`node tmp/w9grep.mjs packages LLM_SSE_DEFAULT_READ_TIMEOUT_MS`）它只出现在
自己的定义处和 `index.ts:21` 的 re-export，**没有任何消费方**。`transport.ts:153`
的缺省值直接写 `-1`（禁用），根本没引用这个常量。

RULE.md「LLM 流式请求不设固定空闲超时」条目已把「readTimeoutMs 退役」记为
**拍板决定**（Kotlin 侧参数保留仅为 JS 接口兼容），所以「参数位保留」是 intentional。
但**这个 JS 侧常量不在「接口兼容」的必要集合里**——Kotlin 侧留参数是因为跨语言
签名对齐，TS 侧没有任何一侧读它。

**建议**：从 `types.ts` 与 `index.ts` 删除该常量（或至少不再从 `index.ts` re-export，
避免它继续出现在包的公开面上）。`@deprecated` 标注挡不住下一个人 import 它。

**置信**：confirmed

---

### F-w9-cliperiph-16 | P3 | `packages/tdbc-conformance/src/suite.ts:23,25,326-339`

```
/** Clears drivers before C11 (unknown driver case). */
beforeUnknownDriverTest?: () => void;
```

**描述**：C11 已经在 `suite.ts:326` 调了 `clearDrivers()`，紧接着 `:327` 又调
`beforeUnknownDriverTest?.()`。三个 driver 的 harness 都把这个钩子实现成
**再调一次 `clearDrivers()`**（`tdbc-driver-rn/test/conformance.test.ts:12-14`、
`tdbc-driver-op-sqlite/test/conformance.test.ts:12-14`、
`tdbc-driver-better-sqlite3/test/conformance.test.ts:18-20`）——第二次调用是空的。

钩子的**真实意图**看 `afterUnknownDriverTest` 就清楚了：只有 better-sqlite3 实现了
它（`registerBetterSqlite3Driver()` 恢复注册表，`:21-23`），另两个是空实现
（注释「C11 only; other tests use injected driver directly」）。也就是说
C11 跑完会**永久清空 RN / op-sqlite 两个包的 driver 注册表**，只靠「后续用例都用
注入的 driver 实例、不走 `open()`」这个巧合没出事。哪天有人给任一包加一条
走 `open()` 的用例，就会 `UNKNOWN_DRIVER` 红灯，而报错点在完全无关的用例里。

另外 C11 的 `try/finally` 里 `clearDrivers()` 在 `try` 之外（`:326` 在 `:328` 之前），
若 `beforeUnknownDriverTest` 本身抛错，`afterUnknownDriverTest` 不会执行。

**建议**：① 三个 harness 的 `beforeUnknownDriverTest` 全删（suite 已经 clear）；
② `afterUnknownDriverTest` 在 RN / op-sqlite 侧补上 `registerRnDriver()` /
`registerOpSqliteDriver(mockAdapter)`，让 C11 自带恢复；
③ `clearDrivers()` 挪进 `try` 之前紧邻 `beforeUnknownDriverTest`，
`afterUnknownDriverTest` 挪到能覆盖 hook 抛错的结构里。

**置信**：confirmed

---

### F-w9-cliperiph-17 | P3 | `packages/tdbc-driver-better-sqlite3/src/connection.ts:67`

```
} catch (cause) {
  this.db.exec("ROLLBACK");
  if (cause instanceof TdbcError) { throw cause; }
```

**描述**：better-sqlite3 的 `transaction()` catch 分支**裸调 `ROLLBACK`，
不 try/catch**。另两个驱动（rn `:82-91`、op-sqlite `:90-99`）都显式包了
try/catch 并 `console.warn`，注释写明「ROLLBACK 失败不能掩盖原始错误：
某些 SQLite 错误会自动中断事务（此时 ROLLBACK 报 no transaction is active）」。

同仓的 `batchSync`（`:135-151`）用的 `this.db.transaction(...)` 本身就是
better-sqlite3 内建的 savepoint 事务，它对回滚失败是处理过的；但 `:61-75`
这个手写 BEGIN/COMMIT/ROLLBACK 是裸的。回调里若执行了会中断事务的语句
（如 `db.exec` 到已关闭连接、或用户回调自己 COMMIT/ROLLBACK），
`ROLLBACK` 抛错会**顶掉**真正的业务异常。

**建议**：与另两个驱动对齐——`try { this.db.exec("ROLLBACK"); } catch (e) { console.warn(...) }`。
三端对同一失败形态的处理口径不该不一样，尤其 desktop/CLI 都走这条路径。

**置信**：confirmed

---

### F-w9-cliperiph-18 | P3 | `packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts`（整文件）

**描述**：与 `packages/core/src/types/agnai-tokenizers.d.ts` **逐字节相同**
（sha256 实测同为 `a5712f9b60d4…`，均 546B）。两处 `declare module` 覆盖
`@agnai/sentencepiece-js` 与 `@agnai/web-tokenizers`。TS 的 ambient module 声明
是**全局合并**的，两份同内容声明不会互相覆盖，但会让「这个类型从哪来」变得不确定
（改一处另一处不动，且 tsc 不会报重复）。

**建议**：driver 侧改为 `/// <reference types="@novel-master/core/..." />` 或直接删掉，
依赖 core 的 ambient 声明（`tokenizer-driver-node` 已经 import core 的
`SkspError`/`TokenCounter` 等一堆类型，多这一份声明不增加耦合成本）。

**注**：该文件里 `cleanText` 导出无人使用，但它属于整块 ambient 声明，
与 core 侧同款；本条只报「重复声明」，不单独报 `cleanText`（core 那份由 core 机位负责）。

**置信**：confirmed

---

### F-w9-cliperiph-19 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:194-198`

```
if (emulateConditionalPut && hasConditionalPut) {
  const head = await this.head(key);
  assertConditionalPutPreconditions(head, options);
  putOptions = undefined;
}
```

**描述**：`put` 声明为对象字面量的方法 shorthand，内部用 `this.head(key)`
（同文件 `:195`）自我调用。这要求 `put` 永远以 `storage.put(...)` 形式被调用。
本文件内部确实如此（`putFile` 在 `:228` 写的是 `storage.put(key, body, options)`，
不是 `this.put`）——**写法是对的**，但 `this` 依赖只差一个词的改动就会断
（改成 `const { put } = storage` 或把方法传给 `Array.map` 就静默变成
`this === undefined`）。同文件的 `getToPath`（`:232`）用的是 `storage.get(key)`，
两处风格还不同。

**建议**：改成闭包内自引用（`putFile` 已经示范了正确写法），
把 `put` 的实现提成一个局部 `const doPut = async (...)`，对象字面量里两处都引它。
纯防御性，零行为变化。

**置信**：confirmed（当前正确）；风险为 suspected

---

### F-w9-cliperiph-20 | P3 | `packages/tokenizer-driver-rn/src/encoding.ts:12-23` ≡ `index.ts:15-26`

**描述**：`encoding.ts`（Metro 免 RN 运行时依赖的子路径入口）与 `index.ts` 的
`impl/encoding-cache` re-export 段是**逐字相同的 7 个符号**
（`getRnEncoding` / `getDefaultRnEncoding` / `countTextWithDefaultEncoding` /
`DEFAULT_RN_ENCODING_NAME` / `RnEncodingName` / `RnTokenEncoding` /
`__resetRnEncodingCacheForTests` / `__setRnEncodingFactoryForTests`）。

`encoding.ts` 的存在有明确理由（模块头 `:1-8`：主入口会拖进 `android-native-bridge`
→ `react-native`，纯逻辑侧只要编码表），**这个拆分是 intentional**。但 re-export
清单被抄了两份，没有单点。

**建议**：`index.ts` 改成 `export * from "./encoding.js";`，
让「哪些符号属于免 RN 子路径」只在 `encoding.ts` 声明一次。
node 侧的 `count-openai-style-message.ts`（`logic/` 下，26 行纯 re-export，
转发 core 的 4 函数 + 3 类型）已经是这个模式的先例。

**置信**：confirmed

---

## 争议与存疑

1. **`nm` 顶层缺 `--help` / `-h`**：README.md:124 写着「CLI → `npm run link:cli` → `nm --help`」，
   但 `main.ts` 全文没有 `--help` 分支——`nm --help` 会走到 F-2 的 hello 兜底，
   打印 `Hello, --help from @novel-master/core` 并 return 0。
   我**没有把它单列为发现**，因为不确定它是「README 写错了」还是「功能漏了」
   （后者该是 P1 级需求缺口，不是 CR 能定的）。交给主代理裁决。

2. **`nm config` / `nm kkv` 的显式 Unknown 提示**（`main.ts:101-106`）：
   看起来像退役命令的迁移提示（文案提到「workspace pointers are set via
   project/session/provider/model use」），但我没有在 RULE.md 或迭代文档里
   找到「这两个命令是拍板退役并保留提示」的记载。按协议第 3 条，
   **找不到出处就不能标 intentional**，所以我既没报「死代码」也没标 intentional，
   留作存疑。相关地，`nm model` 的 `use` 分支（`model/commands.ts:35-42`）与
   `preferences/commands.ts` 反复出现的「请改 workspace 当前模型」提示，
   指向同一套「current 指针」语义，我未逐一核对 core 侧是否全部对接。

3. **F-9 的严重度**：我按 P2 报（复制漂移类），但若真机上独立 batch 确实会
   触发 disk I/O error，那是 P1。这取决于批量大小——conformance 只测 2–3 行，
   真实搬运是 ≤100 行/批。需要一条真机复现才能定级，W6 验证时请优先处理。

4. **`llm-sse-native` 的 `routes` Map 生命周期**（`transport.ts:120`）：
   `finish()` 在 settle 时 `routes.delete(requestId)`，看起来没有泄漏。
   但若 native 侧既不发 DONE 也不发 ERROR（进程被杀、JSI 异常），
   route 会常驻直到该 requestId 被 native 释放。`REQUEST_ID_INSTANCE_PREFIX`
   的注释（`:61-68`）说「requestId 直到 abort/callTimeout 才释放」——
   callTimeout 600s 兜底，所以最长泄漏 600s。不构成泄漏，只是我确认过没有更糟的。

5. **`registerSkspDriver` 的 `createStore(connection: unknown)`**
   （`packages/core/src/infra/sksp/logic/registry.ts:13`）：签名用 `unknown`，
   四个 sksp 包的 `register.ts` 各写一次 `conn as TdbcConnection`。
   这是 core 侧的签名缺陷（属 core 机位），但四个包各抄一次 cast 是本区的样板。
   与 F-7 同批下沉时可一并收。

6. **`tdbc-driver-rn` 是否该整体退役**：RULE.md 明写「quick-sqlite 旧驱动保留作
   回滚线——mobile 回滚仅需 `apps/mobile/src/db/connection.ts` 两行加重装 APK」。
   这是**拍板保留**，我不报「rn 包该删」。但保留一条回滚线的成本是
   F-8 描述的整套 SQL 语义双份维护；报告里我给的是「共享实现、保留两个 adapter」
   的折中方案，而不是「删包」。
