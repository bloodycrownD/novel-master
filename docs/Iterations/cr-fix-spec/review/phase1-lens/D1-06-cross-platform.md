# D1-06：L6 跨端一致性

> 角度横扫报告（readonly）。从 CLI / desktop / mobile 三端行为一致性这一个角度扫遍仓库。
> 依据：`docs/review/guides/lens-L6-cross-platform.md` + `docs/review/phase0/D0-1-code-map.md`。
> 核心张力：mobile 35 766 行 vs desktop 7 192 vs cli 4 010（9 : 2 : 1），大量逻辑只在 mobile 上跑过。

## 元信息

- 角度：L6 跨端一致性
- 仓库扫描范围：`packages/core/src/infra/{llm-protocol,tokenizer,tdbc,sksp}/**`、`packages/{tokenizer,tdbc,sksp,cloud-sync}-*/src/**`、`apps/{cli,desktop,mobile}/src/**`
- 严重度参考：S/A/B/C（见指导文档 §严重度参考）
- 关键交叉文件：`docs/review/phase0/D0-1-code-map.md`、`docs/review/phase1-lens/D1-03-architecture.md`、`docs/Iterations/{sksp,sksp-mac,mobile-sse-stream-resilience,mobile-cloud-sync-rn-compat,remove-mobile-vfs-zip-native}/`
- 轮次：第 1 轮（首次派遣）

---

## 结论

先讲总判断：**这套代码的跨端骨架其实搭得不错——core 几乎不泄漏平台判断，三端 runtime 都通过 `@novel-master/core/<ctx>` subpath 走公共面，没有谁私路径偷渡进 src/**。** 在 `packages/core/src/` 里搜 `Platform.OS`、`process.platform`、`typeof window`、`from 'react-native'`、`from 'fs/path/crypto/http/node:'` 全部零命中——也就是说，core 自己确实做到了「平台无关」。SSE 这种最容易泄漏的能力甚至被收编到一份 `llm-sse-transport.ts` 里，靠 `shouldUseXhrForSse()` 在运行时分发到 fetch 或 XHR，没有让端侧各自写一份 postSse。这是值得肯定的系统性优点。

但骨架干净不等于行为对齐。**真正的问题集中在「同一个接口、三套实现，谁也没去对齐 observable 行为」**。最显眼的是 SKSP 密钥：三端用了三种不同的 algo tag（`android-keystore-aes-gcm-v1` / `macos-keychain-aes-gcm-v1` / `dpapi-v1`），Android 这一端连 `get()` 的 SELECT 列都漏了 `version` 字段；CLI 干脆写死 `resolveSkspDriver("windows")`，macOS / Linux 上跑 CLI 等于直接走 DPAPI 分支——这是 A 级抽象漏到端侧的样本。tokenizer 计数也是一个重灾区，Node driver 和 RN driver 对同一段文本的 tiktoken 计数公式不一样（一个走 `countOpenAiStyleMessages` 含 role overhead，另一个手写 `encode().length + 3 + 3`），WEB/SP 家族在 RN 上 native 不可用时会回退到 heuristic，但 `counterKind` 仍然标成家族名而不是 `heuristic`，这种「声称精确其实是估算」的元数据撒谎会让上层 compaction 判定失真。

第三个层面是**端侧各自补丁，core 没收敛**。vfs-zip 的 `assertZipArchive` 在三端各写一份、深度还不一样（CLI 不校验、Desktop 只查 PK 魔数、Mobile 还扫 EOCD）；`vfsZipExportFileName` 三处重复定义。mobile 为了消费 `cloud-sync-driver-s3`，不得不维护一整套 `shims/` 目录（`node-fs.js` / `aws-rn-fetch-handler.js` / `aws-rn-stream-collector.js` / `aws-xml-parser.js` / `tiktoken.js`）+ `polyfills.ts` 里全局打 Buffer / ReadableStream / TransformStream / DOMParser / Node / Blob.arrayBuffer 补丁——这本质上是 core / driver 包的 API 表面对 RN 不友好造成的泄漏，mobile 在用打补丁的方式替 core 还债。最后 mobile 比 desktop 多出 stream-buffer / stream-wire-queue / message-rollback / db-backup 的 chunked write 等一整套适配，这些有的是必要的平台韧性补丁，有的（比如 message-rollback）则是功能仅 mobile 可见的实际能力缺失。

整体 parity 水平：**接口层 A-，行为层 B+，功能矩阵 B**。骨架很正，肌肉没对齐。漏得最厉害的两条边是 **SKSP 三 driver** 和 **tokenizer 两 driver**——这两个正好都是「同名 SecretStore / TokenCounter 接口、底层完全不同的实现」，最容易出现「用户在 mobile 上做的操作到 desktop 上看起来不对」的 S 级症状，目前还没到数据不一致的程度，但已经是高危区。

---

## 角度 × 模块矩阵

### CLI（基准端，最小）

CLI 是三端里消费 core 最直接的一端，没有 IPC、没有 UI 层，runtime 直接组装 service。但它有两个明显的端侧遗漏：第一，`apps/cli/src/runtime.ts:144-146` 只调了 `registerBetterSqlite3Driver()` / `registerSkspWindowsDriver()` / `registerTokenizerNodeDriver()`，然后第 162 行写死 `resolveSkspDriver("windows").createStore(conn)`——desktop 已经抽了 `getPlatformSkspName()` 在 darwin 上切到 macos driver，CLI 没复用这个抽象，等于「CLI 实质只能在 Windows 上完整工作」。第二，CLI 没有 vfs-zip 的 `assertZipArchive` 校验（`apps/cli/src/vfs/commands/export-zip.ts` 直接 `writeFile(out, bytes)`），也没有 message rollback 入口，没有 cloud-sync 服务（cloud-sync-driver-s3 在 CLI 里完全没被消费）。

### desktop（Electron）

Desktop 的 runtime 结构基本是 CLI 的「平台分支强化版」：`apps/desktop/src/main/runtime/register-platform-drivers.ts` 里 `process.platform === "darwin"` 分支正确切换 SKSP driver，`create-desktop-runtime.ts` 复用了 CLI 的 env composite 模式（`createCompositeSecretStore({ db, env: createEnvSecretStore() })`），保留 `NM_SKSP_DISABLE_ENV` 开关。IPC handler 层把 agent registry / vfs / cloud-sync / db-backup 都暴露给 renderer。但 desktop 缺 mobile 已有的几样东西：没有 stream-buffer（流式输出直接从 eventBus 投到 renderer，没有节奏缓冲），没有 message-rollback 服务包装（core 的 `sessionFs.rollbackToMessage` 在 desktop 完全没被调用），没有 `assertYamlFileName` 这种文件名校验。

### mobile（最大端，35k 行）

Mobile 是三端里**既要消费 core 又要替 core 还债最多**的一端。runtime 通过 `@novel-master/core/<ctx>` subpath 拉全套 service，但 SKSP 走的是 `createAndroidSecretStore(conn)` 直连，**绕过了 `registerSkspAndroidDriver()` + `resolveSkspDriver()` 注册表**——这意味着 `packages/sksp-android/src/register.ts` 在生产代码里实际无人调用，是死代码。mobile 多出来的 30+ 个 service 文件里，相当一部分是 RN 平台约束逼出来的补丁：`shims/` 五份 RN 兼容 shim、`polyfills.ts` 全局补丁、`db-backup.service.ts` 用 chunked ascii write 绕开 Hermes 堆限制（desktop 直接 `writeFile`）、`stream-buffer.service.ts` 整套批处理（desktop 无对应）。这些补丁单看都合理，但累计起来形成了一个事实：**mobile 在用 35k 行里的相当一部分，补偿 core / driver 包对 RN 的不友好**。

---

## driver parity 矩阵

| 能力 | CLI（node） | desktop（node + Electron） | mobile（RN + Android） | parity 判定 |
|------|-------------|----------------------------|------------------------|-------------|
| **tokenizer** | `tokenizer-driver-node`：tiktoken 走 `countOpenAiStyleMessages`（含 role overhead 3+3 + tiktokenModel 映射）；WEB/SP 走 `@agnai/web-tokenizers` + sentencepiece JS | 同 CLI（同 driver 包） | `tokenizer-driver-rn`：tiktoken 走 `enc.encode(content).length + 3 + 3`（公式不同）；WEB/SP 走 Android NovelMasterTokenizer native，缺失时 heuristic 回退但 `counterKind` 仍标家族名 | **A — 行为分叉**（同一段文本两端计数结果可能不同；估算/精确的元数据语义不一致） |
| **tdbc** | `tdbc-driver-better-sqlite3`：`batchSync` 永远经 `db.transaction()` 包裹（事务内会形成 SAVEPOINT） | 同 CLI | `tdbc-driver-rn`：`batchDirect` 在外层事务内时**跳过** BEGIN/COMMIT，直接跑 statements，不形成 SAVEPOINT | **A — 事务嵌套语义不一致**（外层事务内 batch 失败时回滚范围不同） |
| **sksp** | 写死 `resolveSkspDriver("windows")`，algo `dpapi-v1`，ciphertext 存 Uint8Array blob | `process.platform` 分支 → `macos-keychain-aes-gcm-v1`（Keychain + AES-GCM）或 `dpapi-v1` | `createAndroidSecretStore` 直连（绕过 registry），algo `android-keystore-aes-gcm-v1`，ciphertext 存 **base64 string**（非 blob），`get()` SELECT 漏 `version` 列 | **A — 三 driver 行为不对齐 + CLI 平台硬编码 + Android schema 滞后** |
| **cloud-sync** | 不消费（CLI 无 cloud-sync 入口） | `cloud-sync-driver-s3` + node `S3Client` + `node:fs/promises` + `node:crypto` | `cloud-sync-driver-s3` + `createRnS3Client` shim + `ReactNativeBlobUtil` 注入 readFile/writeFile + Buffer polyfill | **B — 同 coordinator，两端 fs/HTTP/S3 client 实现不同**（mobile 走 5 份 shim 补平台差异） |
| **SSE（llm-protocol）** | fetch 路径（`postSseViaFetch`） | 同 CLI | XHR 路径（`postSseViaXhr`，经 `createSseChunkEmitter` 做 byte pacing） | **A — 同一接口两条路径**（chunk 投递时序与分包粒度不同；见发现 A-2） |

---

## 功能矩阵

| core 能力 | CLI | desktop | mobile | 备注 |
|-----------|-----|---------|--------|------|
| provider（createProviderServices） | ✅ 用 | ✅ 用 | ✅ 用 | 三端一致 |
| vfs（createScopedVfsService） | ✅ 用 | ✅ 用 | ✅ 用 | 三端一致 |
| vfs-zip export/import | ✅ 用，**不校验** zip 魔数 | ✅ 用，校验 PK 魔数 | ✅ 用，校验 PK 魔数 + EOCD | 校验深度三端不同（B） |
| agent registry（registerBuiltinTools probe） | ✅ 用 | ✅ 用 | ✅ 用 | 三端 probe 模式一致 |
| events / eventOrchestrator | ✅ 用 | ✅ 用 | ✅ 用 | 三端一致 |
| sessionFs.rollbackToMessage | ❌ 未暴露 | ❌ 未暴露 | ✅ mobile 有 `message-rollback.service.ts` 包装 | 功能仅 mobile 可见（B，需确认是否有意） |
| cloud-sync（CloudSyncCoordinator） | ❌ 未消费 | ✅ 用 | ✅ 用 | CLI 缺整个 cloud-sync 模块 |
| db-backup export/import | ❌ 无服务层 | ✅ 用 node fs | ✅ 用 chunked ascii write（Hermes 约束） | mobile 缺 `clearRuntimeHandle` 等价清理（B） |
| SKSP env override（`createEnvSecretStore`） | ✅ 有，支持 `NM_SKSP_DISABLE_ENV` | ✅ 有，同 CLI | ❌ composite 不传 env | documented intentional（index.ts 注释），但 dev/CI 调试移动端无法 env 覆盖 |
| thinkingLevel 默认值 | core schema Zod default `off` | 同 | 同 | 三端一致（读盘 default 一致） |
| compaction conditions evaluator | ✅ 立即构造 | ✅ 立即构造 | ⚠️ lazy 构造（`lazyCompactionConditionEvaluator`） | mobile 用懒构造规避启动期依赖顺序，行为等价 |
| stream-buffer / wire-queue | ❌ 无 | ❌ 无 | ✅ 一整套 | mobile 独有的流批处理层（UX 节奏差异，非数据层） |

---

## 发现清单

### A-1 CLI 硬编码 Windows SKSP driver

- 位置：`apps/cli/src/runtime.ts:145`（`registerSkspWindowsDriver()`）、`apps/cli/src/runtime.ts:162`（`resolveSkspDriver("windows").createStore(conn)`）
- 问题：CLI runtime 只注册 Windows DPAPI driver，并写死 `resolveSkspDriver("windows")`。desktop 已经在 `apps/desktop/src/main/runtime/register-platform-drivers.ts` 抽了 `getPlatformSkspName()`（darwin → macos，否则 windows），CLI 没复用这个抽象。结果是在 macOS 或 Linux 上跑 CLI：要么 `resolveSkspDriver("windows")` 因为 driver 没注册而抛 `NOT_REGISTERED`，要么 DPAPI 在非 Windows 平台加解密直接失败。
- 依据：`packages/sksp-windows/src/dpapi.ts` 依赖 `@primno/dpapi`，是 Windows 专用 native 模块；`docs/Iterations/desktop-app/spec.md` 第 21–31 行明确指出 CLI 这种硬编码是「desktop 需平台分支 SKSP」的反例。
- 建议：不改代码。整改方向是把 desktop 的 `getPlatformSkspName()` / `registerPlatformSkspDriver()` 上提到一个共享位置（比如 `@novel-master/core/sksp` 暴露一个 `registerPlatformSkspDriverForNode(process.platform)`），CLI 和 desktop 都调它。
- 涉及角度：L3（架构——共享 helper 该放哪层）、L8（API——`resolveSkspDriver` 的 explicit 参数语义）

### A-2 SSE transport fetch 与 XHR 两条路径不对齐

- 位置：`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts`
- 问题：`postSse` 通过 `shouldUseXhrForSse()`（检测 `navigator.product === "ReactNative"`）分发到两条路径。fetch 路径（`postSseViaFetch`）每收到一段 byte 就直接 `onChunk(chunk)`；XHR 路径（`postSseViaXhr`）经过 `createSseChunkEmitter` 做 byte pacing（accumulate → drain → flush）。两条路径对同一份 SSE 流投给上层 `onChunk` 的**时序和分包粒度不一样**——fetch 是按网络包边界逐段投递，XHR 是按 onprogress 节奏投递并带同步 flush。文件顶部注释也明说了「Fetch path intentionally does not use createSseChunkEmitter」。
- 依据：`docs/Iterations/mobile-sse-stream-resilience/` 整个迭代就是为了补 RN XHR 韧性，说明这条分叉已经造成过 mobile 端的 tail event 丢失。当前 XHR 路径在 `onload` 里强制同步 flush 兜底，但 fetch 路径没有等价的 tail 处理（依赖 reader `done` 自然结束）。
- 建议：不改代码。整改方向是把 chunk emitter 统一成两条路径都走——要么 fetch 也包一层 emitter，要么把 XHR 的 pacing 收敛进 emitter 同时给 fetch 用。关键是 observable 行为对齐：上层不应感知到底层是 fetch 还是 XHR。
- 涉及角度：L5（并发——abort/重连语义是否两端一致）、L8（API——`postSse` 的契约是否允许两条路径行为不同）

### A-3 TDBC batch 嵌套事务行为分叉

- 位置：`packages/tdbc-driver-better-sqlite3/src/connection.ts:122-151`（`batchSync` 永远经 `db.transaction()`）；`packages/tdbc-driver-rn/src/connection.ts:135-172`（`batchDirect` 在 `inTransaction` 时跳过 BEGIN/COMMIT）
- 问题：当 `batch` 在外层 `transaction(fn)` 内被调用时——better-sqlite3 这一端通过 better-sqlite3 自带的 `db.transaction()` 会创建 SAVEPOINT（better-sqlite3 的 nested transaction 语义），batch 中某条失败可以独立回滚到 SAVEPOINT，外层事务不受影响；RN 这一端在 `inTransaction === true` 分支里**直接跑 statements 不再包裹**，batch 中途失败时已经执行的语句会留在**外层事务里**，只有外层 ROLLBACK 才能清掉。同一段业务代码在两端跑出来的「batch 部分失败后外层事务可见状态」不一样。
- 依据：better-sqlite3 文档明确 `db.transaction()` 支持嵌套（用 SAVEPOINT 实现）；RN 端代码注释「batch inside outer transaction: statements only, no nested BEGIN/COMMIT」直接确认了这个分叉是有意为之的（避免 RN adapter 不支持 SAVEPOINT），但结果是行为不对齐。
- 建议：不改代码。整改方向是在 TDBC 协议层面明确「嵌套 batch 的失败语义」（独立回滚 vs 影响外层），然后让两端的 SAVEPOINT 行为对齐——要么两端都支持 SAVEPOINT，要么两端都不支持。当前是 node 端隐式支持、RN 端隐式不支持，最坏的情况。
- 涉及角度：L4（错误与事务——batch 失败的回滚边界）、L1（数据模型——同一 batch 在两端持久化结果可能不同）

### A-4 tokenizer 三端计数公式不一致

- 位置：`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:46-117`；`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:69-91, 101-139`
- 问题：三处实质分叉——
  1. **tiktoken 家族**：Node 走 `countOpenAiStyleMessages(encoding, [wrapSerializedPromptAsSystemMessage(serialized)], tiktokenModel)`，这个函数在 `logic/count-openai-style-message.ts` 里按 OpenAI 的 role overhead 公式累加（每条 message 3 token + content 长度 + delim 3）；RN 直接 `enc.encode(message.content).length` 然后手加 `3 + 3`。两边对同一文本算出来的数不一样，因为 Node 的 `countOpenAiStyleMessages` 还会处理 message array 的结构化 overhead。
  2. **WEB / SP 家族 native 缺失回退**：Node 走 `@agnai/web-tokenizers` + sentencepiece JS（精确）；RN 走 Android NovelMasterTokenizer native，native 不可用时回退到 `heuristicCount(serialized)`（`Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO)`），**但 `counterKind` 仍然标成家族名**（如 `"claude"`），`estimated: true`。Node 在 tiktoken 失败回退时 `counterKind` 标 `"heuristic"`。RN 的元数据撒谎会让上层 compaction 判定误以为还在用精确 tokenizer。
  3. **tokenizerOverride 与 savedModels 解析路径**：两端 `resolveVendorModelId` 完全一致，但 GPT 路径下 Node 会再做 `mapVendorModelIdToTiktokenModel` 映射 + `encoding_for_model`，RN 也做但失败时不重试 heuristic（直接 catch → heuristic）。
- 依据：`docs/Iterations/nmtp/`（NMTP 协议）、`docs/Iterations/mobile-llm-streaming/`（RN driver 入口）。mobile 35k 行里大量 compaction 条件判定依赖 `tokenCounters`，而 `compactionConditionEvaluator` 三端都用 `createDefaultTokenCounterRegistry({})`（mobile）/`({ savedModels })`（desktop）——同一个 evaluator 在不同端基于不同的计数结果做判定。
- 建议：不改代码。整改方向：把 tiktoken 的 OpenAI style message overhead 公式抽到 core 的 `logic/` 里，两端 driver 都调；RN 的 heuristic 回退要把 `counterKind` 改回 `"heuristic"`（与 Node 对齐），不能让家族名出现在估算路径上。
- 涉及角度：L1（compaction 阈值判定依赖计数准确性）、L2（算法——tokenizer 选型的 family 分流逻辑应该共享）

### A-5 SKSP driver registry 接入方式三端不统一

- 位置：`apps/cli/src/runtime.ts:145,162`（注册 + resolve）；`apps/desktop/src/main/runtime/register-platform-drivers.ts:15-23` + `create-desktop-runtime.ts:78-79`（注册 + resolve）；`apps/mobile/src/runtime/create-mobile-runtime.ts:42,64`（**直接 `createAndroidSecretStore(conn)`，不走 registry**）
- 问题：core/sksp 提供了 `registerSkspDriver()` / `resolveSkspDriver()` 注册表模型，CLI 和 desktop 都遵守「register 一次 → resolve by name 拿 store」的模式。mobile 完全绕过——`packages/sksp-android/src/register.ts` 里的 `registerSkspAndroidDriver()` 在生产代码里**没有任何调用方**（只有测试用），等于死代码。这导致三端 secret store 的构造路径完全不同：两端走 registry 抽象，一端走 direct factory。
- 依据：`packages/sksp-android/src/index.ts` 检查导出——`registerSkspAndroidDriver` 是导出的，但 `apps/mobile/src/runtime/create-mobile-runtime.ts` 只 import 了 `createAndroidSecretStore`。
- 建议：不改代码。整改方向：要么 mobile 也改走 `registerSkspAndroidDriver()` + `resolveSkspDriver("android")` 与其他两端对齐，要么承认 registry 模式过度抽象、把 CLI/desktop 也改成 direct factory。当前的中间状态是最差的——抽象存在但只有三分之二的端在用。
- 涉及角度：L3（架构——registry 模式是否应该统一）、L8（API——`resolveSkspDriver` 的契约）

### A-6 Android SKSP `get()` 滞后于 schema

- 位置：`packages/sksp-android/src/android-secret-store.ts:55`（`SELECT ciphertext, iv, algo FROM sksp_secrets WHERE ref = #{ref}`）；对比 `packages/sksp-mac/src/sqlite-secret-store.ts:60` 和 `packages/sksp-windows/src/sqlite-secret-store.ts:45`，都 SELECT 了 `version` 列。
- 问题：Android 的 `get()` 只查了 `ciphertext, iv, algo`，漏了 `version`。当前 schema 里 `version` 字段写入时硬编码 `1`（三端 set 都是 `version: 1`），所以暂时无影响。但 mac/windows 都查了说明 schema 设计意图是 version 用于未来迁移判断——Android 这条 SELECT 在 version 升到 2 时会直接读不到字段，要么静默忽略（如果 TDBC 把缺失列映射成 undefined），要么后续 `restoreProviderTableSnapshot` 等依赖 version 的逻辑出错。
- 依据：三端 `set()` 的 INSERT 都写了 `version` 列（android 第 121 行、mac 第 98 行、windows 第 81 行），说明 schema 是统一的；只有 android 的 `get()` 没读。
- 建议：不改代码。整改方向：Android 的 SELECT 列表加上 `version`，与其他两端对齐。
- 涉及角度：L1（数据模型——schema 字段读取一致性）、L4（错误与事务——未来的 version 迁移）

### A-7 core / driver 包对 RN 的抽象泄漏

- 位置：`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:9`（静态 `import { readFile, writeFile } from "node:fs/promises"`）；`apps/mobile/src/polyfills.ts`（全局打 Buffer / ReadableStream / TransformStream / DOMParser / Node / Blob.arrayBuffer）；`apps/mobile/src/shims/{node-fs,aws-rn-fetch-handler,aws-rn-stream-collector,aws-xml-parser,tiktoken}.js`
- 问题：cloud-sync-driver-s3 这个包是设计成「可注入 readFile/writeFile」（`S3ObjectStorageDeps`），mobile 也确实注入了 `ReactNativeBlobUtil.fs.readFile` / `writeFile` override。但包顶部仍然是**静态 `import "node:fs/promises"`**——这意味着 RN bundler（Metro）必须解析这个 import，要么打包进 node:fs polyfill，要么靠 mobile 的 `shims/node-fs.js` 兜底。设计上是 DI，物质上仍然泄漏。同理 AWS SDK v3 在 RN 上需要 `RnFetchHttpHandler` / `createRnStreamCollector` / xml-parser shim——mobile 维护了整整 5 份 shim 文件来补偿。
- 依据：`docs/Iterations/mobile-cloud-sync-rn-compat/` 整个迭代就是为了补这套兼容性，说明这是历史确认过的痛点。
- 建议：不改代码。整改方向有两种——要么 cloud-sync-driver-s3 把 `readFile/writeFile` 默认实现改成 lazy require（避免静态 import），要么承认 node-leaning API 是核心现实、把 mobile 的 shim 目录作为「官方 RN 兼容层」文档化（而不是藏在 apps/mobile/src/shims/ 里像临时补丁）。
- 涉及角度：L3（架构——driver 包的依赖描述）、L8（API——`createS3ObjectStorage` 的依赖注入契约）

### B-1 SKSP 跨设备 cloud-sync 恢复时密文不可解

- 位置：algo tag 三端不同——`packages/sksp-android/src/android-secret-store.ts:20`、`packages/sksp-mac/src/sqlite-secret-store.ts:22`、`packages/sksp-windows/src/sqlite-secret-store.ts:21`；Android ciphertext 存 base64 string，mac/windows 存 Uint8Array blob。
- 问题：`sksp_secrets` 表里 algo 字段三端各带平台 tag。当用户在 mobile 上做完整 db-backup 然后在 desktop 上恢复（`importDatabaseBackupFromBytes` → `restoreProviderTableSnapshot`），备份里的 sksp_secrets 行 algo 是 `android-keystore-aes-gcm-v1`，desktop 这端 driver 读到会直接抛 `DECRYPT_FAILED`（三端 get 都有 `if (String(row.algo) !== ALGO) throw`）。core/sksp/index.ts 的注释已经写明「跨用户/设备恢复可能 DECRYPT_FAILED」，但这意味着用户跨设备迁移必须重新输入 apiKey——这是一个跨端 UX 不一致的来源。
- 依据：`packages/core/src/infra/sksp/index.ts:9-10`（"备份：sksp_secrets 含平台绑定密文；跨用户/设备恢复可能 DECRYPT_FAILED"）。
- 建议：不改代码。这是平台密钥存储的天然约束（Android Keystore 的 key 出不来）。整改方向是产品层——跨设备同步时主动跳过 sksp_secrets 表（或在 backup export 时 scrub 掉，类似 `scrubProviderTablesInDatabase`），让用户在新设备上重新配置 apiKey，而不是让用户撞到 DECRYPT_FAILED。
- 涉及角度：L1（数据模型——跨设备备份的表过滤策略）、L4（错误处理——DECRYPT_FAILED 的用户可见消息）

### B-2 vfs-zip 校验深度三端不同

- 位置：`apps/cli/src/vfs/commands/export-zip.ts`（不校验）；`apps/desktop/src/main/services/vfs-zip.service.ts:25-38`（只查 PK 魔数）；`apps/mobile/src/services/vfs-zip.service.ts:55-95`（PK 魔数 + `findZipEocdOffset` 扫 EOCD）
- 问题：同名 `assertZipArchive` 在三端行为不同。CLI 根本不调；Desktop 检查 PK 魔数（`50 4b 03/05/07 04/06/08`）；Mobile 在 PK 魔数基础上还做 EOCD（End of Central Directory）签名扫描，能识别「文件头正确但归档被截断」的情况。用户在 desktop 上 import 一个截断的 zip 会通过校验然后在 unzip 阶段失败，在 mobile 上会在校验阶段就被拒绝——同一种坏文件两端报错时机和错误信息不同。
- 依据：`docs/Iterations/remove-mobile-vfs-zip-native/` + `vfs-zip-native-compression/`（vfs zip 平台差异收敛案例，但校验深度没收敛）。
- 建议：不改代码。整改方向：把 `assertZipArchive`（含 EOCD 扫描）下沉到 core/vfs 的 `createVfsZipIoService` 里，三端调 core 的同一份校验。
- 涉及角度：L4（错误处理——同一坏文件的错误码和消息应该一致）

### B-3 `vfsZipExportFileName` 三处重复

- 位置：`apps/cli/src/vfs/commands/export-zip.ts`（CLI 不生成文件名，由用户 --out 指定）；`apps/desktop/src/main/services/vfs-zip.service.ts:11-23`；`apps/mobile/src/services/vfs-zip.service.ts:18-30`
- 问题：desktop 和 mobile 的 `vfsZipExportFileName` 函数实现完全一致（`vfs-global-{pathSuffix}.zip` / `vfs-project-{projectId}{pathSuffix}.zip` / `vfs-session-{sessionId}{pathSuffix}.zip`），是字面意义上的复制粘贴。任何一边改了命名规则另一边都不会同步。
- 依据：两份文件对比，逻辑字符级一致。
- 建议：不改代码。整改方向：下沉到 `@novel-master/core/vfs` 的 `createVfsZipIoService` 或单独 helper。
- 涉及角度：L3（架构——共享 helper 该放哪层）

### B-4 `sessionFs.rollbackToMessage` 仅 mobile 有服务包装

- 位置：`apps/mobile/src/services/message-rollback.service.ts`（包装 `runtime.sessionFs.rollbackToMessage`）；grep `rollbackToMessage` 在 `apps/desktop/` 和 `apps/cli/src/` 零命中。
- 问题：core 提供了 `sessionFs.rollbackToMessage` 能力（`@novel-master/core/session-fs`），mobile 把它包成了 UI 可消费的 service，desktop 和 CLI 完全没暴露这个入口。用户在 mobile 上能「回滚到某条消息」，在 desktop 上做不了同样的操作——功能矩阵不对齐。
- 依据：core/session-fs 导出了这个能力，说明设计上是三端通用能力；mobile 单端消费 = 端侧遗漏而非有意限制（无 iteration 文档说明 desktop 故意不做）。
- 建议：不改代码。整改方向：确认 desktop 是否应该有等价入口；如果有，desktop 的 IPC handler 层补一个 `nm:sessions/rollback`。
- 涉及角度：L8（API——core 暴露的能力端侧应该一致消费）

### B-5 mobile agent-yaml 多了文件名校验

- 位置：`apps/mobile/src/services/agent-yaml.service.ts:84`（`assertYamlFileName(file.name)`）；`apps/desktop/src/main/services/agent-yaml.service.ts:64-95`（无文件名校验，只看 dialog 选的文件）
- 问题：同名 import 函数，mobile 在 pick 后会校验文件名（`assertYamlFileName` 来自 `./yaml-document-pick`），desktop 不校验。用户在 mobile 上选了一个 `.txt` 文件会被前端拒绝，desktop 上选 `.txt` 文件会进入 YAML parse 阶段才报错。UX 不一致。
- 依据：对比两份 `importAgentYaml*` 函数。
- 建议：不改代码。整改方向：要么 desktop 也加文件名 / 扩展名校验，要么把校验下沉到 core 的 `validateAgentDefinition` 之前。
- 涉及角度：L4（错误处理——同一类无效输入应该同一阶段拒绝）

### B-6 mobile stream-buffer 是独占的流批处理层

- 位置：`apps/mobile/src/services/{stream-buffer,stream-wire-queue,stream-apply-buffer}.service.ts`
- 问题：mobile 维护了一整套 stream buffering 层（`StreamBufferOptions` 含 `flushIntervalMs` / `maxCharsPerBuffer` / `dropThinkingOnOverflow`），插在 SSE chunk 到达和 UI 渲染之间。desktop 直接从 eventBus 投到 renderer，没有这层。结果是同一段 LLM 输出在 mobile 上是「按帧缓冲后批量渲染」，在 desktop 上是「逐 chunk 渲染」——打字节奏的 UX 差异显著。
- 依据：`docs/Iterations/mobile-sse-stream-resilience/` 说明 RN 渲染跟不上原始 chunk 速率，所以加了这层。desktop 没这个问题所以没加。属于必要的平台适配，不是 bug，但属于「跨端 observable 行为差异」。
- 建议：不改代码。这是合理的平台差异。仅需在文档里说明「mobile 流式输出有 batch 缓冲层，desktop 没有」。
- 涉及角度：L2（算法——流式输出的投递策略）

### B-7 mobile db-backup 缺 runtime handle 清理

- 位置：`apps/mobile/src/services/db-backup.service.ts:145-178`（`importDatabaseBackupFromPath`）；对比 `apps/desktop/src/main/services/db-backup.service.ts:28-31, 95-96`（`closeLiveDbForBackupImport` 先调 `clearDesktopRuntimeHandle()` 再 `closeDesktopConnection()`）
- 问题：desktop 在导入备份替换 db 文件前，会先 `clearDesktopRuntimeHandle()` 清掉 runtime 单例句柄，再 close connection，避免替换过程中有 stale conn 被复用。mobile 的 `importDatabaseBackupFromPath` 只调了 `closeMobileConnection()`，没有等价的 runtime handle 清理步骤。如果 mobile 也有 runtime singleton（`MobileNovelMasterRuntime` 的 provider context），替换 db 后旧 runtime 句柄持有的 conn 引用可能指向已被 cp 替换的文件，触发 stability 问题——这正好对应 Phase 0 提到的 `mobile-stability-db-migration` 迭代。
- 依据：对比两份 `importDatabaseBackupFromPath` 实现；desktop 的注释明确写 "Close live DB only after dropping the runtime handle (avoids stale conn use)"。
- 建议：不改代码。整改方向：确认 mobile 是否有等价的 runtime handle 需要在 close 前清掉；如果有（`NovelMasterProvider` 的 context 持有 runtime），应该补一个 `clearMobileRuntimeHandle()` 等价步骤。
- 涉及角度：L5（并发——替换 db 文件时的句柄生命周期）

### B-8 env secret override 层在 mobile 缺失

- 位置：`apps/mobile/src/runtime/create-mobile-runtime.ts:63-65`（`createCompositeSecretStore({ db: createAndroidSecretStore(conn) })`，不传 env）；`apps/cli/src/runtime.ts:163-170` 和 `apps/desktop/src/main/runtime/create-desktop-runtime.ts:80-87` 都传了 env。
- 问题：CLI 和 desktop 都允许通过 `NOVEL_MASTER_PROVIDER_<ID>_API_KEY` 环境变量覆盖 DB 里的 apiKey（env 优先），并提供 `NM_SKSP_DISABLE_ENV=1` 关闭。mobile 完全没有这一层。这在生产是合理的（mobile 没有shell），但在 dev / CI 跑 mobile e2e（`mobile-android-e2e-appium`）时无法用环境变量注入测试 apiKey。
- 依据：`packages/core/src/infra/sksp/index.ts:7` 明确注释「Mobile：生产运行时 composite 不传 env store」——documented intentional。
- 建议：不改代码。建议是在 dev build 里可选地开启 env override（用 `__DEV__` 分支），方便 e2e 测试。
- 涉及角度：L7（测试覆盖——mobile e2e 的 apiKey 注入路径）

---

## 覆盖声明

**查了**：core 的 SSE / tokenizer / tdbc / sksp 四个 infra 子目录；三端 driver 包（tokenizer-node/rn、tdbc-better-sqlite3/rn、sksp-android/mac/windows、cloud-sync-driver-s3）的源码；三端 runtime 入口（`runtime.ts` / `create-desktop-runtime.ts` + `register-platform-drivers.ts` / `create-mobile-runtime.ts`）；三端 vfs-zip / agent-yaml / db-backup / cloud-sync service；mobile 的 polyfills + shims 目录；`apps/mobile/src/services/` 全部 36 个 service 文件名清单 + desktop 18 个 service 文件名清单的对比。

**没查**：三端 UI 组件层（mobile `components/` 284 文件里的大部分、desktop renderer）；mobile android Kotlin/Java 原生代码（`apps/mobile/android/` 5 个文件——只在 tokenizer native bridge 层面引用，未深入）；desktop preload / IPC handler 的全部细节（只抽查了 agent-registry 一处）；tdbc-conformance 包（这是 conformance 测试套件，未参与 parity 比较）；具体 SSE 事件解析（anthropic-sse-parser / openai-sse-parser / gemini-sse-parser）在三协议 × 两路径下的行为——这块需要 L2/L4 角度深入。

**为什么**：L6 角度的核心是「跨端分歧 + 抽象泄漏」，UI 层的差异属于 C 级（非行为层面），不进入本报告；Kotlin 原生层只在它通过 RN bridge 暴露的接口边界上才与 parity 相关（已查 tokenizer/sksp 的 bridge）。

---

## 待交叉的线索

1. **A-3（TDBC batch 嵌套事务）↔ L4 错误与事务**：L4 角度如果不区分 node vs RN 的 SAVEPOINT 行为，可能会把 batch 失败的回滚边界当成一致的——实际上两端在「外层事务内 batch 部分失败」时持久化结果不同。这是潜在冲突点。

2. **A-4（tokenizer 计数公式）↔ L1 数据模型 + L2 算法**：L1 在评 compaction 阈值判定时如果默认三端 tokenCounters 行为等价，会漏掉 mobile 端 native 缺失时 heuristic 回退导致的计数偏差；L2 评 tokenizer 算法时如果不区分两端 driver 实现，可能会把「公式不同」误判为「同一算法」。建议 phase3 交叉时把「tiktoken OpenAI style overhead 是否两端共享」作为对齐问题确认。

3. **A-5（SKSP registry 接入不统一）↔ L3 架构 + L8 API**：L3 可能会说「registry 模式架构正确，mobile 不用是 mobile 的事」；L8 可能会说「`resolveSkspDriver` 接口稳定」。但 L6 的立场是：**接口稳定 + 一端绕路 = 行为分叉风险**（mobile 不走 registry 意味着未来 registry 加缓存 / 加校验 / 加多 driver fallback 时 mobile 都享受不到）。phase3 需要判定这是「mobile 有合理理由绕路」还是「registry 抽象过度」。

4. **A-7（cloud-sync-driver-s3 静态 import node:fs）↔ L3 架构**：L3 在评包依赖时如果只看 `package.json` 的 `dependencies`，会漏掉「包源码静态 import node 模块」这个事实上的硬依赖。L6 的立场是：**static import 比 package.json 描述更能说明抽象泄漏**。

5. **B-1（跨设备 sksp 密文不可解）↔ L1 数据模型 + cross-device-cloud-sync 迭代**：这是用户可见的跨端 UX 痛点，但根因是平台密钥存储的天然约束。phase3 需要判定是「在 db-backup export 时 scrub 掉 sksp_secrets」（数据模型层修），还是「让 DECRYPT_FAILED 的用户消息更友好」（错误处理层修）。

6. **A-2（SSE 两条路径不对齐）↔ L5 并发**：L5 评 abort / 重连时如果默认两条路径并发安全就够，会漏掉「chunk 时序不同导致上层状态机推进不同」的问题。L6 的立场：并发安全 + 投递时序不一致 = 两个独立的问题。
