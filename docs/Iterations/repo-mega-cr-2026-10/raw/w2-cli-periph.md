---
zone: cli-periph
agent: domain-survey
files_scanned: 127 (apps/cli/src 49 + 12 个外围包 src 78) / 10240 LOC；另核对 4 个 Kotlin 原生文件
---

## 摘要

本区是 novel-master 的「宿主外围层」：CLI（`nm` 命令行，49 文件）承担全部
数据操作的脚本化入口；四个 SKSP 包（sksp-android/linux/mac/windows）各实现一份
平台密钥保管 + `sksp_secrets` 表存储；两个 tokenizer 驱动（node 走 tiktoken(WASM)
/@agnai，RN 走 js-tiktoken + Android 原生桥）给 core 的 NMTP 协议提供各端实现；
三个 TDBC 驱动（better-sqlite3 / op-sqlite / rn(quick-sqlite 回滚线)）加一个跨驱动
一致性套件 tdbc-conformance；llm-sse-native 是 mobile 的 SSE 原生传输；cloud-sync-driver-s3
是 S3 兼容对象存储。全区无 `as any` / `@ts-ignore` / 空 catch，注释密度与决策留痕在
全仓属上乘。

## 职责与边界

- **apps/cli**：`main.ts` 顶层分派 + `runtime.ts` 单点开库/装配服务。命令组分
  preferences / project / session / message / prompt / provider / model / agent /
  compaction-conditions / sort-rule / vfs。CLI 不含任何领域规则，全部经
  `@novel-master/core/*` 子路径。
- **sksp-\***：只提供「平台 strategy」（主密钥取用 + 加解密），SQL 编排收敛到 core 的
  `BaseSqliteSecretStore`。`register.ts` 统一向 core 注册具名 driver。
- **tokenizer-driver-\***：实现 core NMTP 的 `TokenizerDriver` 契约
  （`countPromptLlmInput`）。编码表单例沉在 core `encoding-registry`，驱动只注入构造器。
- **tdbc-driver-\***：实现 core `TdbcDriver`/`TdbcConnection`，三份
  `connection.ts` 是同一协议的三个平台实现（互为复制粘贴漂移的主要来源）。
  `tdbc-conformance` 是 node:test 共享套件，被三个驱动包的 `test/*.test.ts` 消费。
- **llm-sse-native**：`SseTransport` port 的 mobile 原生实现，包内不含
  `react-native` import（`transport.ts` 环境无关，`native.ts` 才绑 RN）。
- **cloud-sync-driver-s3**：`ObjectStoragePort` 的 S3 兼容实现，不静态依赖 `node:fs`。

## 对外接口

| 包 | 关键导出 |
|---|---|
| cli | `main(argv): Promise<number>`；`bin`: `novel-master` / `nm` → `dist/index.js` |
| sksp-linux | `registerSkspLinuxDriver` / `createLinuxSecretStore` / `LinuxSqliteSecretStore` / `setLinuxKeychainTestPassthrough` / `getOrCreateMasterKey` |
| sksp-mac | `registerSkspMacDriver` / `createMacSecretStore` / `MacSqliteSecretStore` / `setMacKeychainTestPassthrough` |
| sksp-windows | `registerSkspWindowsDriver` / `createWindowsSecretStore` / `SqliteSecretStore` / `protectUtf8` / `unprotectUtf8` / `setDpapiTestPassthrough` |
| sksp-android | `registerSkspAndroidDriver` / `createAndroidSecretStore` / `AndroidSecretStore` / `getSkspNativeModule`（子路径 `./native`） |
| tokenizer-driver-node | `registerTokenizerNodeDriver` / `countPromptLlmInput` / `TiktokenTokenCounter` / `getNodeEncodingForModel` / `getNodeEncodingByName` / `DEFAULT_NODE_ENCODING_NAME` |
| tokenizer-driver-rn | `registerTokenizerRnDriver` / `countPromptLlmInputRn` / 子路径 `./native` `./encoding` `./android-native-bridge` |
| tdbc-driver-better-sqlite3 | `registerBetterSqlite3Driver` / `BetterSqlite3Connection` |
| tdbc-driver-op-sqlite | `registerOpSqliteDriver`（`./native` 子路径）/ `OpSqliteConnection` / `OpSqliteAdapter` |
| tdbc-driver-rn | `registerRnDriver`（`./native` 子路径）/ `RnConnection` / `RnSqliteAdapter` |
| tdbc-conformance | `runConformanceTests` / `runNestedBatchParityTests` |
| llm-sse-native | `createNativeSseTransport` / `registerNativeSseTransportWith` / `isNativeSseAvailable`（`./native`）；`createNativeSseTransportFromBridge` / `flattenRequestHeaders`（主入口） |
| cloud-sync-driver-s3 | `createS3ObjectStorage` / `normalizeEtag` / `isAliyunOssEndpoint` |

## 数据访问

| 域 | 位置 | 证据 |
|---|---|---|
| `sksp_secrets` 表 | 四端 sksp 各经 `BaseSqliteSecretStore`（SQL 在 core） | `packages/sksp-linux/src/sqlite-secret-store.ts:61-65`、`packages/sksp-windows/src/sqlite-secret-store.ts:46-50` |
| OS 密钥库 | Linux Secret Service / macOS Keychain（`@napi-rs/keyring`）；Windows DPAPI（`@primno/dpapi`） | `packages/sksp-linux/src/keychain.ts:80-88`、`packages/sksp-mac/src/keychain.ts:80-88`、`packages/sksp-windows/src/dpapi.ts:38-42` |
| Android Keystore | 经 `SkspModule` 原生桥 | `packages/sksp-android/src/native.ts:22-26` |
| SQLite 连接 | `resolveDbPath`：`NOVEL_MASTER_DB` > `--db` > `./.novel-master/novel.db` | `apps/cli/src/runtime.ts:112-121` |
| cli 后台维护任务 | 每次开库串行跑 `runMessageContentCompaction` + `runBlobBinaryNormalization` | `apps/cli/src/runtime.ts:184-191` |
| S3 对象 | `HeadObject` / `GetObject` / `PutObject`（`Bucket=config.bucket`） | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:156-223` |
| 本地文件（cli） | 唯一直接 fs 触点：建库目录 + 读 agent 配置文件 | `apps/cli/src/runtime.ts:178`、`apps/cli/src/config/load-agent-config-file.ts:34` |
| 本地文件（s3 驱动） | 走注入的 `FileSystemPort`，不静态依赖 `node:fs` | `packages/cloud-sync-driver-s3/src/ports/file-system.port.ts:8-13` |

## 依赖关系

```
apps/cli ──> core/{,vfs,agent,chat,provider,compaction,events,smart-sort-rule,
                   message-checkpoint,session-fs,workplace,session-kkv,skills,sksp,
                   feature-flags,prompt,nmtp}
         ──> tdbc-driver-better-sqlite3, tokenizer-driver-node,
             sksp-{mac,windows,linux}      (三份全量静态 import，runtime.ts:77-79)

apps/mobile ─> tdbc-driver-op-sqlite/native, sksp-android, tokenizer-driver-rn/native,
               llm-sse-native/native, cloud-sync-driver-s3
apps/desktop ─> tdbc-driver-better-sqlite3, sksp-{mac,windows,linux},
               tokenizer-driver-node, cloud-sync-driver-s3

被消费侧（不在本区）：core 只经 `TdbcDriver`/`TokenizerDriver`/`SecretStore`/
`SseTransport`/`ObjectStoragePort` 五个 port 反向依赖本区；`BaseSqliteSecretStore`
与 `getEncoding`(encoding-registry) 是 core 侧的收敛点，四个 sksp / 两个 tokenizer
都往这里汇。
```

**循环依赖**：无。`tokenizer-driver-*/src/count-prompt-llm-input.ts:49-50` 与 `:72-73`
的 `DRIVER_NAME` 注释显式说明「import 会成环，故就地重复」——这是有意的字符串重复，
不是缺陷。

---

## 发现清单

### A. tokenizer 双驱动复制粘贴漂移（重点）

**F-cli-periph-1 | P1 | `packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:241`**

```ts
    return { count, counterKind: "tiktoken", estimated: false };
```

node 侧同名逻辑多了 cr-tok-1 修正（`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:262-278`）：

```ts
      tokenCount = countOpenAiStyleChunked(encoding, serialized, tiktokenModel, scope);
      counterKind = "tiktoken";
      if (family === "tiktoken" && resolveTokenizerFamily(vendorModelId, "auto") !== "tiktoken") {
        estimated = true;
      }
```

**描述**：当 tiktoken 身份来自「强制 override」而非模型自身解析时，RN 驱动恒报
`estimated: false`，node 侧已修。override 来自用户可配的 `tokenCounterMode`
（`packages/core/src/service/provider/logic/resolve-token-counter-mode-for-model.ts:18`
→ `getTokenCounterMode`）。**后果有两条**：
① `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:86`
的 `counterKind === "heuristic" || estimated` 判定为 false，压缩阈值**跳过 0.85
安全系数**——拿 cl100k 对 claude/glm 的近似值卡精确阈值；
② `packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:241` 的
`entry.estimated === false` 判定为 true，该条目被收进 pendingWrites **跨重启落 KKV**，
而 RULE 写明 promptWholeCache 只收精确档。
**建议**：把 node 侧 cr-tok-1 的 3 行判定同步进 RN `countTiktoken`；更彻底的做法是把
这段判定下沉到 core（两个驱动共用），避免第三次漂移。
**置信**：confirmed（两侧代码对读 + 消费点代码对读）。

**F-cli-periph-2 | P1 | `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:249-253`**

```ts
      const tiktokenModel = mapVendorModelIdToTiktokenModel(vendorModelId);
      const encoding = getNodeEncodingForModel(tiktokenModel);
```

**描述**：node 侧只走「vendorModelId → mapVendorModelIdToTiktokenModel →
tiktoken 官方映射」一跳。RN 侧 `resolveRnEncodingName`
（`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:158-188`）显式做了
两跳并**有意规避出界表**——其模块注释点名 `text-davinci-003`（真 p50k）会被 core
映射成 `gpt-3.5-turbo`（cl100k）。核对 `packages/core/src/infra/tokenizer/logic/resolve-tokenizer-family.ts:80-82`
（`TEXT_COMPLETION_MODELS` 命中即返回 `"tiktoken"`）与 `:136-171`
（`mapVendorModelIdToTiktokenModel` 对 `text-davinci-003` 一路穿透到默认
`return "gpt-3.5-turbo"`）——**node 侧确实会把 p50k 模型报成 cl100k 精确读数
`counterKind:"tiktoken"`**，且因 family==="tiktoken" 且 auto 也是 tiktoken，
cr-tok-1 的兜底判定也不会把它降级。`gpt2` 家族（`:129-131` 解析为 `"gpt2"`，node
在 `:248` 与 tiktoken 同分支处理）同样中招：映射落到 cl100k 后报精确档。
RN 侧对这两类都如实报 heuristic。
**建议**：node 侧 `getNodeEncodingForModel` 前加一层与 RN 对称的三态解析
（认识但出界 → 返回 null 走兜底），或把 `resolveRnEncodingName` 的两跳口径下沉 core。
**置信**：confirmed（core 两个函数全文已读 + 两侧调用点对读）。

**F-cli-periph-3 | P2 | `packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:131-140`**

```ts
export async function countWebFamilyPrompt(
  family: TokenizerFamily, serialized: string,
): Promise<{ readonly count: number; readonly estimated: boolean }> {
  const counter = new WebTokenizerCounter(family as ...);
  const count = await counter.countSerializedPrompt(serialized);
  return { count, estimated: counter.failedLoad };
}
```

**描述**：`WebTokenizerCounter.instance` 与 `loadError` 是**实例字段**，而入口每次
调用都 `new` 一个新实例 → `getInstance()` 的 `if (this.instance != null) return`
（`:53-55`）与 `if (this.loadError) return null`（`:56-58`）**跨调用永不命中**。
后果：① claude/llama3/qwen2/command-*/nemo/deepseek/glm 八个家族每次计数都要
`readFileSync` + `Tokenizer.fromJSON` 重新解析整张 ranks JSON；② 资产缺失时
每次都重试 IO/解析——`impl/sentencepiece-token-counter.ts:104-113` 完全同款
（`processor` / `loadError` 同样是实例字段）。**这与本文件 `:35-36` 的注释
「失败被缓存、本进程不再重试」直接矛盾**。
对照：tiktoken 精确档已正确走 core `encoding-registry` 的进程级单例
（`impl/encoding-cache.ts`），WEB/SP 两族是唯一漏收敛的。
**建议**：两族按 family 建模块级 `Map<TokenizerFamily, Tokenizer>` 单例，
或并入 core `getEncoding` 的 registry（`getEncoding` 已是通用单点）。
**置信**：confirmed。

**F-cli-periph-4 | P2 | `packages/tokenizer-driver-rn/`（无 `test/` 目录）**

**描述**：`tokenizer-driver-node/test/` 有 5 个测试文件（`count-prompt-llm-input` /
`fallback-count` / `encoding-cache` / `tiktoken-token-counter` /
`count-openai-style-message`），`tokenizer-driver-rn/test/` **目录不存在**。
两个驱动 324 行 vs 408 行的同构实现，精确度不同的那几处（见 F-1/F-2）恰好落在
只有 node 侧有测试的路径上——这是漂移得以长期存活的直接原因。
**建议**：把 F-1/F-2 的对拍用例（claude + override=tiktoken、text-davinci-003、
gpt2-xxx）下沉到 core 做跨驱动 golden，两个驱动共用。
**置信**：confirmed（`ls packages/*/test` 实测）。

**F-cli-periph-5 | P3 | `packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:125,143`**

```ts
export class ClaudeWebTokenCounter extends WebTokenizerCounter {
export function messagesToOpenAiStyle(   // /** @internal test helper */
```

**描述**：`ClaudeWebTokenCounter` 与 `messagesToOpenAiStyle` 全仓零引用
（逐符号 `grep -rnw` 实测，含 `index.ts` barrel 与所有 test 目录），注释却标
`@internal test helper`——实际没有任何测试用它。属重构后遗留的死导出。
同包的 `SentencePieceTokenCounter`（`:35`）虽未被外部引用但被同文件 `:108` 自用，
不算死码。
**建议**：删除这三处（`ClaudeWebTokenCounter`、`messagesToOpenAiStyle`、
`NodeEncodingFactory` 的 export 关键字——后者 `impl/encoding-cache.ts:66` 也只在本文件用）。
**置信**：confirmed。

### B. 四端 sksp 复制粘贴漂移（重点）

**F-cli-periph-6 | P2 | `packages/sksp-linux/src/crypto.ts` vs `packages/sksp-mac/src/crypto.ts`**

**描述**：`diff` 实测两文件**仅第 2 行模块注释不同**，其余 59 行
（`encryptUtf8` / `decryptUtf8`，AES-256-GCM + 12B IV + 16B tag 拼接格式）
逐字节相同。windows 走 DPAPI 无此文件，android 走 Keystore 桥也无——即
「同一份加解密实现被复制两遍，无共享」。
**建议**：下沉为 `packages/core/src/infra/sksp/logic/aes-gcm.ts`
（core 已有 `BaseSqliteSecretStore` 收敛点，同一方向），两个 sksp 包薄包装 re-export。
**置信**：confirmed（`diff` 实测仅 1 行差异）。

**F-cli-periph-7 | P2 | `packages/sksp-linux/src/keychain.ts:10` vs `packages/sksp-mac/src/keychain.ts:10`**

```ts
const SERVICE = "novel-master-linux";   // linux
const SERVICE = "novel-master";         // mac
const USER = "sksp-master-v1";          // 两端同值
```

**描述**：两文件除 SERVICE/平台判定/文案外**完全同构**（`diff` 实测 6 处差异，
其余 89 行一致）。SERVICE 名不对称：mac 用无后缀的 `novel-master`，linux 加了
`-linux` 后缀。同一份 SQLite 库（`sksp_secrets` 表）在两端都能打开，algo 列
（`linux-secret-service-aes-gcm-v1` / `macos-keychain-aes-gcm-v1`）不同所以密文不会
互读，**当前无实害**；但命名不对称意味着「按 service 名做运维排查/清理残留条目」
时两边口径不一致，且未来若有人加第三端很容易再漂一次。
**建议**：统一命名规范（建议两端都用 `novel-master` + 平台后缀，或都用无后缀
——keyring 本身按平台分库，无后缀也天然隔离），并在两个 keychain.ts 顶部加
「本文件是 X 平台的副本，改动须同步 Y」的交叉引用注释。
**置信**：confirmed（漂移本身 confirmed；命名不一致的实害为 suspected，现阶段无实害）。

**F-cli-periph-8 | P2 | `packages/sksp-linux/src/keychain.ts:82-88`（mac 同构 `:82-88`）**

```ts
    const entry = new Entry(SERVICE, USER);
    const existing = entry.getPassword();
    if (existing != null) { return parseMasterKey(existing, ref); }
    const key = randomBytes(MASTER_KEY_BYTES);
    entry.setPassword(Buffer.from(key).toString("base64"));
    return new Uint8Array(key);
```

**描述**：`getPassword → 若无则生成 → setPassword` 是无锁 check-then-act。
首次启动后并发两笔 encrypt（`BaseSqliteSecretStore` 允许同一 ref 并发）会各自
生成不同主密钥，**后写者胜出**，先写者已用它加密的密文永久不可解
（且 `keychain.getPassword` 只在 decrypt 路径报错，用户看到的现象是
「某个 provider 的 apiKey 突然坏了，提示重填」）。窗口极窄（仅首次创建），
但代价是静默数据损坏。
**建议**：加进程内 single-flight（`let inflight: Promise<Uint8Array> | null`，
`getOrCreateMasterKey` 入口复用）；跨进程可不做（keyring 自身有锁，
最坏也只是覆盖，与现状同级）。
**置信**：suspected（竞态存在且可构造，未在真机复现）。

**F-cli-periph-9 | P3 | `packages/sksp-android/src/android-secret-store.ts:49-50` 与 `:67-68`**

```ts
  async encrypt(ref, plain) {
    const native = getSkspNativeModule();   // ← 在 try 之外
    try {
      const enc = await native.encrypt(ref, plain);
```

**描述**：`getSkspNativeModule()` 在 `try` 块**外**调用，模块未链接时抛的是裸
`Error("SkspModule is not linked (Android only)")`（`src/native.ts:24`），
绕过了本函数精心构造的 `SkspError("ENCRYPT_FAILED", ...)` 包装。decrypt 路径
（`:67-68`）同款。对比同文件里其余错误路径全部走 `SkspError`。
**建议**：把 `getSkspNativeModule()` 挪进 `try`，或在 `native.ts` 里直接抛
`SkspError`。另：`sksp-android` 与 `llm-sse-native/src/native.ts:43-49` 都缺
`isAvailable()` 门（后者有 `isNativeSseAvailable` 三方法逐个 typeof 探测，
前者只有 lazy getter），与 RULE「RN bridgeless 纪律」的精神一致但形式不齐。
**置信**：confirmed。

**F-cli-periph-10 | P3 | `packages/sksp-android/src/android-secret-store.ts:37-43`**

```ts
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
```

**描述**：逐字符字符串拼接 O(n) 次分配，绕过引擎优化。密钥体积小（apiKey 几十~几百
字节）所以当前无实害，但与 RN 侧解码侧 `Uint8Array.from(atob(b64), c => ...)`（`:33-35`）
不对称。另 linux/mac/windows 三处的 `rowCiphertext`/`rowIv`
（如 `sksp-linux/src/sqlite-secret-store.ts:22-45`）把 `string` 列当 **latin1 二进制**
解码，而 android 的 `decodeBlob`（`:23-31`）把 `string` 列当 **base64** 解码——
两套语义相反的 helper 复制在四个包各一份，视觉上极像，改错一处极难察觉。
**建议**：把「按 ALGO 决定 string 列语义」的解码收敛到 core `BaseSqliteSecretStore`
（同 `SkspCryptoStrategy.algo` 已有的分派位），四端只提供 platform 原语。
**置信**：confirmed（helper 差异）；性能影响 suspected。

### C. TDBC 三驱动样板重复

**F-cli-periph-11 | P2 | `packages/tdbc-driver-better-sqlite3/src/connection.ts:57-62`（op-sqlite `:69-82`、rn `:62-74` 三处同款）**

```ts
      this.inTransaction = true;
      const txConn = new TransactionalConnection(this);
      // --- transaction boundary: explicit BEGIN / COMMIT / ROLLBACK ---
      this.db.exec("BEGIN");       // ← 在 try 之前
      try {
```

**描述**：`inTransaction = true` 已置位而 `BEGIN` 在 `try` 之外。`BEGIN` 失败
（磁盘满、库被自动中断、底层连接已断）时异常直接逃出 `mutex.run`，**`inTransaction`
永久停在 true**，此后该连接的所有 `transaction()` 一律抛 `NESTED_TRANSACTION`，
且因 `finally` 未执行，`lastYieldAt`/`savepointDepth` 也不复位。连接从此不可用
事务直到进程重启。三个驱动实现完全同款（RULE 记录的「事务内全同步 + SAVEPOINT」
防御策略被逐字复制了三遍，包括这段边界代码）。
**建议**：`BEGIN` 移入 `try`，或在 `BEGIN` 失败分支显式复位 `inTransaction`；
更彻底的做法是把这段 transaction 边界收敛到 core 的共享基类
（三个驱动的差异只在 `runAdapter` 一处）。
**置信**：confirmed（三处代码对读；失败路径为静态推导，未构造用例）。

**F-cli-periph-12 | P2 | `packages/tdbc-driver-rn/src/driver.ts:42-45`**

```ts
      await adapter.execute("PRAGMA foreign_keys = ON");
      return new RnConnection(adapter);
```

**描述**：op-sqlite 的 `finishOpen`（`packages/tdbc-driver-op-sqlite/src/driver.ts:69-82`）
在 `foreign_keys` 之外**还设了 `PRAGMA temp_store = MEMORY`**，注释写明这是
「Android 12 及以下部分设备临时目录不可写、大事务报 disk I/O error」的兜底——
也就是驱动从 rn 换到 op-sqlite 的根因之一。rn（回滚线）**没有这条 pragma**，
回滚后该 bug 会原样复现。同款缺失还有 `isBackground` 后台让步注入
（`packages/tdbc-driver-rn/src/connection.ts:28` 构造函数不收该参数，
op-sqlite 在 `:28-35` 收）——回滚后 app 后台跑事务会因 `setTimeout(0)` 停摆而挂到
回前台。
**建议**：这两条明确写进回滚 checklist（在 rn 的 driver.ts / connection.ts
头部注释里加「与 op-sqlite 的已知差异清单」），而不是只存在于 RULE.md 里。
**置信**：confirmed（缺失）；回滚后果为 suspected（需真机验证）。

**F-cli-periph-13 | P2 | `apps/mobile/src/db/connection.ts:10-12,69-74` + `apps/mobile/package.json:41`**

**描述**：`@novel-master/tdbc-driver-rn` 是 apps/mobile 的 **declared dependency**，
并出现在 `prestart` / `preandroid` / `preios` 三条预构建清单里
（`package.json:28-30`），但全仓 `grep registerRnDriver` **零命中**——
`connection.ts` 只有 `registerOpSqliteDriver` / `registerSkspAndroidDriver` /
`registerTokenizerRnDriver`。RULE 写「mobile 回滚仅需 `connection.ts` 两行
（`registerRnDriver` + `driver:'rn'`）」，**这条回滚说明已过期**：import 行已被
删除，实际回滚需改 3 处（补 import、加 register 调用、改 driver 串）。
同时每次 mobile 构建都在为一条不装配的驱动付出编译时间。
**建议**：二选一——(a) 在 `connection.ts` 留一条注释掉的回滚 import + 同步修正
RULE；或 (b) 若已确定不保留回滚线，从 `package.json` 依赖与三条预构建清单中摘掉，
省 CI 时间。RULE 本身写的是「保留作回滚线」，倾向 (a) 但要修正文档。
**置信**：confirmed（grep 实测 + package.json 实读）。

**F-cli-periph-14 | P3 | `packages/tdbc-driver-rn/src/index.ts:20` vs `src/native.ts:19`**

```ts
// index.ts
export function registerRnDriver(adapter?: import("./adapter.js").RnSqliteAdapter): void {
  registerDriver(new RnDriver(adapter ?? new QuickSqliteAdapter()));
// native.ts
export function registerRnDriver(adapter?: RnSqliteAdapter): void {
  registerDriver(new RnDriver(adapter ?? new NativeQuickSqliteAdapter()));
```

**描述**：op-sqlite 已为这个问题建了 `src/register.ts` 单点转发，其模块头注释
（`packages/tdbc-driver-op-sqlite/src/register.ts:1-6`）明写「统一转发到这里：
单点实现、两入口天然一致，杜绝『只改 index.ts 漏掉 native.ts』的分叉」。
rn 没跟进，两个入口各写一份注册函数。附带小漂移：`index.ts:20` 用内联
`import("./adapter.js").` 类型、`native.ts:8` 用顶层 `import type`——同一函数
签名两种写法。
**建议**：把 op-sqlite 的 `register.ts` 模式复制到 rn。
**置信**：confirmed。

**F-cli-periph-15 | P3 | `packages/tdbc-driver-op-sqlite/src/connection.ts:182-183`**

```ts
      const sp = `tdbc_sp_${++this.savepointDepth}`;
      await this.runAdapter(`SAVEPOINT ${sp}`, undefined);
      try {
```

**描述**：`savepointDepth` 的自增在 `try` 之前，而 `finally { this.savepointDepth--; }`
（`:207`）在 try 之内。`SAVEPOINT` 语句本身抛错（事务已被自动中断）时深度**只增不减**。
后果轻微（仅 savepoint 名字里的计数器单调增长、不会重名），但计数器随长事务
无限增长会让名字变长。同款在 `packages/tdbc-driver-rn/src/connection.ts` 同位置。
**建议**：把 `++` 挪到 SAVEPOINT 成功之后，或用局部变量 + try/finally 局部归位。
**置信**：confirmed（逻辑推导；实害轻微）。

**F-cli-periph-16 | P3 | `packages/tdbc-conformance/src/suite.ts:326-339`**

```ts
      it("open without registered driver throws UNKNOWN_DRIVER", async () => {
        clearDrivers();
        beforeUnknownDriverTest?.();
```

**描述**：C11 调 core 的**全局** `clearDrivers()`，把进程内所有已注册驱动清空，
再靠调用方在 `afterUnknownDriverTest` 回调里重注册。该套件被 3 个驱动包的
`test/*.test.ts` 共享，而 node:test 的顶层 describe 都在同一进程内注册——
`afterUnknownDriverTest` 是 `?.` 可选，**漏传则该测试文件后续所有驱动测试
静默变成 UNKNOWN_DRIVER 红灯**（好在会红不是静默绿）。此外套件对
`inTransaction` 卡死（见 F-11）、`savepointDepth` 泄漏（F-15）、
后台让步分支（op-sqlite 有专属测试 `connection-yield-background.test.ts` 而
rn 没有）均无覆盖。
**建议**：C11 的 `clearDrivers` 改为「保存 registry 快照 → 恢复」而非单向清空；
`afterUnknownDriverTest` 改成必填参数。补一条 C12：`BEGIN` 失败后连接仍可开事务。
**置信**：confirmed。

### D. CLI

**F-cli-periph-17 | P2 | `apps/cli/src/main.ts:189-191`**

```ts
  const name = argv[0] ?? "world";
  console.log(`Hello, ${name} from ${PACKAGE_NAME}`);
  return 0;
```

**描述**：脚手架残留。**任何无法识别的顶层命令都打印一句问候并返回退出码 0**。
`nm porject list`（拼错）、`nm sesion`、CI 里写错的命令全部「成功」。
`main.ts:101-106` 已经为 `config` / `kkv` 两个已知退役命令专门做了提示，
说明退役命令是被认真处理的——唯独漏了通用兜底。
**建议**：兜底分支改为 `console.error("Unknown command: …") + 打印 usage + 返回 EXIT_USAGE`。
**置信**：confirmed。

**F-cli-periph-18 | P2 | `apps/cli/src/main.ts:129`（先开库）vs `:133-136`（后判空）**

```ts
  ) {
    const rt = await createNovelMasterRuntime(argv);   // :129 开库 + bootstrap + 两个维护任务
    try {
      const sub = argv[1];
      if (sub == null) {
        console.error(`Usage: novel-master ${top} <subcommand> ...`);
```

**描述**：`nm project`（漏子命令）、`nm session`、`nm agent` 等 10 个命令组全部
**先**跑 `createNovelMasterRuntime` —— 该函数含 `bootstrapNovelMaster` 加
`runMessageContentCompaction` + `runBlobBinaryNormalization` 两个同步维护任务
（`runtime.ts:184-191` 的注释自陈「各 60s 同步预算、最坏合计约 120s」），
**之后**才判 `sub == null` 打印 usage。`runVfs` 同款：`:71` 开库在 `:85` 的
子命令合法性检查之前，`nm vfs nonexistent` 会先建库跑满两个任务再报 usage。
对一个「打错字就退出」的路径来说代价过大。
**建议**：把子命令合法性检查上移到 `createNovelMasterRuntime` 之前。
**置信**：confirmed（控制流直读 + 维护任务预算引自本仓注释）。

**F-cli-periph-19 | P2 | `apps/cli/src/vfs/errors.ts`（整文件，28 行）**

**描述**：该文件的 `EXIT_USAGE` / `EXIT_RUNTIME` / `formatCliError` /
`exitCodeForError` 是 `apps/cli/src/cli-errors.ts` 的**子集逐字复制**
（后者 87 行，多 10 个错误类型分支）。全仓 `grep "vfs/errors"` **零命中**——
纯死文件，且是复制粘贴的复制粘贴（`cli-errors.ts` 才是真源）。
**建议**：删除。
**置信**：confirmed（逐行比对 + grep 实测）。

**F-cli-periph-20 | P2 | `apps/cli/src/vfs/runtime.ts`（整文件，24 行）**

**描述**：`createVfsRuntime` 包装 `createNovelMasterRuntime` 并返回
`{ vfs: rt.globalVfs(), conn: rt.conn }`。全仓零引用（`main.ts` 走的是
`createNovelMasterRuntime` 直调 + `rt.globalVfs()`），**且其 `conn` 从不 close**——
即便被接上也是一个句柄泄漏的封装。纯死文件。
**建议**：删除。
**置信**：confirmed（grep 实测）。

**F-cli-periph-21 | P2 | `apps/cli/src/config/load-agent-config-file.ts:65-70`**

```ts
/**
 * Reads a single-agent config file (not a bundle).
 */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  return loadAgentFromConfig(path);
}
```

**描述**：零引用的 6 行转发壳。注释说「not a bundle」但实现与
`loadAgentFromConfig` 完全相同（后者在 bundle 时会要求 `--agent-id`）——注释与
行为不符，若将来真被接上就是文档级 bug。
**建议**：删除。
**置信**：confirmed（grep 实测）。

**F-cli-periph-22 | P3 | `apps/cli/src/cli-errors.ts:62-87`**

```ts
export function exitCodeForError(error: unknown): number {
  if (error instanceof AgentError) { return EXIT_RUNTIME; }
  if (error instanceof VfsError || ... || error instanceof SkspError) { return EXIT_RUNTIME; }
  if (error instanceof Error && error.message.startsWith("Usage:")) { return EXIT_USAGE; }
  return EXIT_RUNTIME;
}
```

**描述**：前两个 `if` 分支的返回值与最后的兜底**完全相同**（都是
`EXIT_RUNTIME`），12 个 `instanceof` 检查因此全是无效分支——函数实际只有
「message 以 `Usage:` 开头 → 1，否则 → 2」两档行为，35 行代码在演一出没演完的戏。
**建议**：简化为两行（保留 `startsWith("Usage:")` 判定 + 默认 2），并把「usage 错误
用 message 前缀识别」这一脆弱约定（任何领域错误只要文案以 `Usage:` 开头就会被
误判成退出码 1）改为抛一个 `UsageError` 类型。
**置信**：confirmed。

**F-cli-periph-23 | P3 | `apps/cli/src/session/commands.ts:154, 164, 173, 182`**

```ts
  if (group === "export-zip") {
    const idx = args.indexOf(group);
    await runExportZip(deps.conn, {...}, args.slice(idx + 1));
```

**描述**：用 `args.indexOf(group)` 在**含 flag 的整串**里找子命令位置。若某个 flag
的**值**恰好等于子命令名且出现在子命令之前（如
`nm session vfs --title export-zip export-zip`），`idx` 会落在 flag 值上，
`args.slice(idx+1)` 得到 `[]`，参数被静默吞掉。`group` 来自 `positional[0]`
（`parseCliArgs` 已把 flag 与值分离），正确做法是记录 `positional` 索引。
同款模式在 `:115`（`args[0] === "vfs"`）、`apps/cli/src/session/workplace.ts:26`、
`apps/cli/src/project/workplace.ts:21` 出现——三处都在做
「调用方可能传了也可能没传 `workplace`/`vfs` 前缀」的防御性剥离，而
`apps/cli/src/vfs/workplace.ts:18`（`main.ts` 唯一调用方）不做。同一语义
两套写法。
**建议**：统一在 `parseCliArgs` 返回 `positional` 时附带索引，改用索引切分；
三处前缀剥离逻辑收敛到一处。
**置信**：confirmed（切分逻辑直读；触发条件为构造性推导）。

**F-cli-periph-24 | P3 | `apps/cli/src/provider/commands.ts:91, 146`**

```ts
        apiKey: flagString(flags, "apiKey"),      // create
          patch.apiKey = flagString(flags, "apiKey") ?? "";   // edit
```

**描述**：apiKey 只能经命令行参数传递，会进入 shell history 与
`ps -ef`/任务管理器。更值得注意的是，**四个 sksp 包的错误文案统一把
「重跑 `nm provider edit --apiKey`」作为修复指引**
（如 `sksp-windows/src/dpapi.ts:65,79`、`sksp-linux/src/keychain.ts:50,73`），
即产品在主动引导用户把密钥放上命令行。
**建议**：支持 `--apiKey-stdin`（从 stdin 读）或 `--apiKey-file <path>`，
并把 sksp 错误文案的修复指引指向该形式。
**置信**：confirmed（代码）；密钥暴露面为 suspected（取决于用户 shell 配置）。

**F-cli-periph-25 | P3 | `apps/cli/src/runtime.ts:151-153`**

```ts
  readonly savedModels: ProviderServiceBundle["savedModelRepo"];
  /** {@link AgentTurnRuntimePort} 别名；与 savedModels 同源。 */
  readonly savedModelRepo: ProviderServiceBundle["savedModelRepo"];
```

**描述**：同一对象以两个名字暴露（`:271-272` 赋同值）。同时
`NovelMasterRuntime` 上还有 `physicalVfs()` / `workplace()` / `skills()` /
`globalVfs()` / `projectVfs()` / `sessionVfs()` 六个**每次调用 new 新实例**的工厂
方法——RULE 的「常驻工作区」条目已就同类问题给出警告
（`workplace` 工厂每次 new 会让 `liveViewInFlight` 的并发去重跨 step 失效，
agent-runner 已提升到循环外）。CLI 是短命单命令进程，风险小，但
`globalVfs()` 已在 `:91` 与 `:255` 被连续调用两次产生两个实例。
**建议**：去掉 `savedModelRepo` 别名（或标注 `@deprecated`）；`globalVfs()` 提到
`createNovelMasterRuntime` 内构造一次。
**置信**：confirmed（双别名）；工厂重复实例化为 confirmed（`:91` 与 `:255`）。

**F-cli-periph-26 | P3 | `apps/cli/package.json` `scripts.test`**

```json
    "test": "tsx --test test/**/*.test.ts"
```

**描述**：RULE 已记录同类脚本的两个「假绿」形态（desktop 的 `run-tests.mjs`
单引号 glob 收 0 条；core 缺 `-O globstar` 只展开一层目录）。cli 这条
`test/**/*.test.ts` 依赖 tsx 自身的 glob 展开。cli 的 20 个测试文件**都在
`test/` 平铺**，所以当前形态无害；但若日后引入 `test/e2e/` 之类子目录，
覆盖面会静默缩水。
**建议**：核对一次 `npm test -w @novel-master/cli` 的实际收集条数
（`# tests N`），并把条数写进 CI 门限防回退。
**置信**：suspected（未实跑；`test/` 现状为平铺已确认）。

### E. llm-sse-native

**F-cli-periph-27 | P2 | `packages/llm-sse-native/src/transport.ts:180-258`**

```ts
          routes.set(requestId, { ... });
          if (signal != null) { ... signal.addEventListener("abort", onAbort, { once: true }); }
          bridge.sseConnect(requestId, url, headersKv, body, readTimeoutMs, callTimeoutMs);
```

**描述**：`routes.set` 与 `addEventListener` 都发生在 `sseConnect` 之前，且**不在
try 内**。`sseConnect` 同步抛错（native 侧「duplicate requestId」——模块头注释
`:61-67` 明确说这个错误真实存在；或 bridgeless 下的 interop 异常）时：
① Promise 因 executor 内抛错而 reject（这点对，符合契约），但
② `routes` 里的 `requestId` 条目**永不删除**（`finish()` 没被调用），
③ `signal` 上的 abort 监听器**永不摘除**（`{ once: true }` 只在触发时解绑）。
长期运行下每次此类失败泄漏一条 route + 一个 AbortSignal 监听器。
**建议**：把 `sseConnect` 包进 try，catch 内先 `routes.delete(requestId)` +
摘监听器再 `reject(new NativeSseTransportError("network", …))`。
**置信**：confirmed（控制流直读）。

**F-cli-periph-28 | P3 | `packages/llm-sse-native/src/transport.ts:122-145`**

```ts
  bridge.events.addListener(LLM_SSE_EVENT_HEADERS, (event) => { ... });
  bridge.events.addListener(LLM_SSE_EVENT_CHUNK,  (event) => { ... });
  bridge.events.addListener(LLM_SSE_EVENT_DONE,   (event) => { ... });
  bridge.events.addListener(LLM_SSE_EVENT_ERROR,  (event) => { ... });
```

**描述**：`LlmSseEventSink.addListener` 明确返回退订函数（`types.ts:55`），
`createNativeSseTransportFromBridge` 四个调用**全部丢弃返回值**。生产路径靠
`src/native.ts:79-94` 的 `cachedTransport` 单例挡住重复订阅（模块头注释
「避免重复 addListener」）；但 `resetNativeSseTransportForTests()`（`:97-99`）
只清 `cachedTransport` 不退订，重置后再 `createNativeSseTransport()` 会叠加
第二套监听器。测试环境下每条事件被两套 routes 分发（各自的 map 都是空的，
无害但会掩盖真实缺陷）。
**建议**：收集四个退订函数，挂到 transport 对象上（如 `__dispose`），
`resetNativeSseTransportForTests` 先调它。
**置信**：confirmed。

**F-cli-periph-29 | P3 | `packages/llm-sse-native/src/transport.ts:153` 与 `types.ts:46`**

```ts
      const readTimeoutMs = timeouts?.readMs ?? -1;   // transport.ts:153
/** @deprecated 读超时已退役（恒禁用）… */                    // types.ts:43-46
export const LLM_SSE_DEFAULT_READ_TIMEOUT_MS = 30_000;
```

**描述**：RULE 已写明「Kotlin `readTimeoutMs` 参数（仅 JS 接口兼容）」是**已退役件**，
但 JS 侧仍在 `sseConnect` 调用点实参传值（`transport.ts:255`），
`LLM_SSE_DEFAULT_READ_TIMEOUT_MS` 也仍导出且带 `@deprecated`。
三处一致说明这是有意保留（Kotlin 侧常量与参数不能单方删，会破坏 ABI），
但 `types.ts:110` 的 `nativeTimeouts.readMs` 仍是公开可写字段——
外部调用方能塞一个看似生效实则被 native 忽略的值。
**建议**：把 `readMs` 标 `@deprecated`（与 `LLM_SSE_DEFAULT_READ_TIMEOUT_MS`
一致）或直接从 `SseTransport` port 移除，只在 native 模块类型上保留。
**置信**：intentional（RULE 明写退役口径），此处仅指出**公开 port 上仍留有可写字段**
这一残留。

### F. cloud-sync-driver-s3

**F-cli-periph-30 | P2 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:194-198`**

```ts
      if (emulateConditionalPut && hasConditionalPut) {
        const head = await this.head(key);
        assertConditionalPutPreconditions(head, options);
        putOptions = undefined;
      }
```

**描述**：阿里云 OSS 模拟条件写的实现是「HEAD 校验 → 丢弃条件头 → 无条件 PUT」，
**check 与 write 之间无原子性**。两个并发客户端（两台机器上的同一 workspace，或
同机两进程）可同时通过 HEAD 校验、随后都执行无条件 PUT → **后写者静默覆盖前写者**，
即 lost update，而调用方拿到的是成功返回的 etag。
`assertConditionalPutPreconditions`（`:69-87`）抛的 `LOCK_CONTENTION` 在这条路径上
只能挡住**已被别人改过**的窗口，挡不住「同时开始」。
注意这是端点能力限制下的必然降级（注释 `:59` 已写明 OSS 不支持条件头），
问题在于**降级的语义边界没有被记录在案**——读代码的人会以为「冲突检测还在」。
**建议**：至少在模块头与该分支加注释写明「这是 best-effort 冲突检测，存在 TOCTOU
窗口；OSS 端点下并发同步可能丢更新」；若可接受，在 core 侧对该端点禁用
「同一 key 并发写」的场景或加重试/版本号兜底。
**置信**：suspected（竞态为静态推导，未实测 OSS 行为）。

**F-cli-periph-31 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:174-187`**

```ts
    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
```

**描述**：`head()` 有完整的 404 归一（`isNotFoundError` 三形态判定，`:33-57`），
`get()` **没有**——key 不存在时抛出 AWS SDK 原始错误对象（`NoSuchKey`），
调用方拿不到 `CloudSyncError` 家族的类型化错误码。而 `getToPath`（`:231-235`）
直接调 `get()`，因此「下载一个已被另一端删除的快照」会走未归一路径。
**建议**：`get` 的 catch 里同样过 `isNotFoundError`，抛
`CloudSyncError("NOT_FOUND", …)`（或按 core `ObjectStoragePort` 的既有错误码约定）。
**置信**：confirmed。

**F-cli-periph-32 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:195, 228, 232`**

```ts
        const head = await this.head(key);
        return storage.put(key, body, options);
        const { body, etag } = await storage.get(key);
```

**描述**：`put` 内部用 `this.head(...)`，`putFile`/`getToPath` 用闭包变量
`storage.xxx`（绕过 `this` 绑定）。三种写法混用。`storage` 是普通对象字面量，
`put` 一旦被解构传递（`const { put } = storage; await put(...)`，在 fp 风格代码里
很常见）`this` 即为 `undefined` → `this.head` 抛 TypeError。
`putFile` / `getToPath` 不受影响（用闭包），所以这是一个「只在一个方法里坏」的
隐性不一致。
**建议**：`put` 内也改用 `storage.head(key)`，全文件统一走闭包引用。
**置信**：confirmed（`this` 用法直读）。

**F-cli-periph-33 | P3 | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:89-110` + `:60-67`**

**描述**：`isPreconditionFailedError` 把 412 一律映射成
`CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试")`。但 412 也可能是
**端点不支持条件头**（非阿里云 OSS 的部分 S3 兼容实现）返回的。
此时用户看到的是「同步冲突，请重试」，反复重试永远失败，而真实病因是
「这个端点不支持条件写」。`isAliyunOssEndpoint`（`:60-67`）只白名单了
`*.aliyuncs.com`，其他不支持条件写的端点会掉进 412 分支。
**建议**：无法判定 412 成因时，文案改为同时提示两种可能
（「同步冲突，或该端点不支持条件写（If-Match）」）。
**置信**：suspected（依赖具体 S3 实现行为，未实测）。

---

## 争议与存疑

1. **F-1/F-2 到底该修 node 还是 RN？** 两处漂移方向相反：F-1 是 RN 缺 node 的
   cr-tok-1 修正（RN 该补），F-2 是 node 缺 RN 的出界防护（node 该补）。我的建议是
   两侧都收敛到 core 的 `resolveTokenizerEncoding(modelId, supportedEncodings)`
   三态 helper，而不是各补三行——但这会动 core 的 `infra/tokenizer`，超出本区边界，
   需要 core 机位与 W5 reduce 协调。**不抹平**：若只允许改一侧，应先改 F-1（RN 侧
   影响真实在用的 mobile 端且后果是可触发的压缩阈值失准），F-2 影响的 p50k/gpt2
   老模型在 2026 年的 provider 列表里已近乎绝迹，实际触发概率低。

2. **F-11（BEGIN 在 try 外）是否可达？** `BEGIN` 失败的现实触发条件我没能确认——
   better-sqlite3 侧 `db.exec("BEGIN")` 失败需要磁盘 I/O 失败一类环境级故障；
   op-sqlite/rn 侧除了同样的原因，还有「事务已被上一条语句自动中断」这一 SQLite
   语义（代码里 `:87-89` 的注释恰好承认了「某些 SQLite 错误会自动中断事务」）。
   我按**代码缺陷**定级 P2，但**实际发生率未知**——若 reduce 认为该按 P3 处理，
   我不反对，但建议在 `tdbc-conformance` 补一条用例把行为钉死（F-16 的建议）。

3. **F-12（rn 缺 temp_store pragma）算不算 intentional？** RULE 写 rn「保留作
   回滚线」——回滚线的定义本就是**回到旧行为**，缺新修复可以论证为 intentional。
   我判 P2 的理由是：回滚的**决策成本**被低估了（回滚会把这个 bug 原样带回来，
   而 RULE 里记录的正是当年换库的根因）。但若团队认为「回滚只在紧急时用、
   紧急时本来就接受旧 bug」，这条应降为 intentional 并在 RULE 里写明。
   **请 W5 reduce 裁决。**

4. **F-13（rn 在 mobile package.json 里但不装配）** 我倾向「修正文档 + 留注释回滚
   import」而非「摘掉依赖」，因为 RULE 明确说保留回滚线。但摘掉依赖能省下每次
   mobile 构建的编译时间（`preandroid` 每次都 `npm run build -w ... tdbc-driver-rn`），
   这也是一个真实的成本。**取舍请用户/主代理定。**

5. **F-26（`test/**/*.test.ts` glob）我标 suspected 而非 confirmed**，因为我遵守
   只读纪律**没有实跑** `npm test -w @novel-master/cli` 去数收集条数。RULE 里
   两个同族假绿案例说明这个形态在本仓反复咬人，值得实跑核实后再定级。

6. **未覆盖的盲区**：本区只做了 src 的静态测绘。四个 Kotlin 原生文件
   （`sksp-android/android/.../SkspModule.kt`、`llm-sse-native/android/.../LlmSseModule.kt`
   及其 Package）我只用 `grep -n "fun \|@ReactMethod"` 数了方法面
   （LlmSseModule 有 `sseConnect`/`sseAbort`/`request` 三个 `@ReactMethod` +
   `invalidate`/`onCatalystInstanceDestroy`/`shutdown`），
   **其内部实现（OkHttp client 复用、UTF-8 前缀长度计算 `completeUtf8PrefixLength`、
   合批阈值 `maybeFlush`）完全未审**。若 W3 需要「IPC 双侧」横切，Kotlin 侧应单独派机位。
