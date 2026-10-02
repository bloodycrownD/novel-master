---
zone: w9-cliperiph-adv
agent: advocate（辩护人 / 对抗对·防御方）
files_scanned: |
  apps/cli/src/**/*.ts（48 文件，全部）
  packages/tdbc-conformance/src/{index,suite,nested-batch}.ts
  packages/tdbc-driver-better-sqlite3/src/*.ts
  packages/tdbc-driver-op-sqlite/src/**/*.ts
  packages/tdbc-driver-rn/src/**/*.ts
  packages/tokenizer-driver-node/src/{count-prompt-llm-input,register,index}.ts + impl/encoding-cache.ts
  packages/tokenizer-driver-rn/src/{count-prompt-llm-input,register,index,native}.ts + impl/encoding-cache.ts
  packages/sksp-{mac,linux,windows,android}/src/*.ts
  packages/llm-sse-native/src/{index,native,transport}.ts
  packages/cloud-sync-driver-s3/src/{create-s3-object-storage,index}.ts
  packages/*/package.json（12 个外围包）
  docs/apm/RULE.md（相关条目逐条核）
---

# W9 对抗机位·辩护人报告 —— cli + 外围包 TS 侧

## 摘要

本区域是 novel-master 的**平台适配层与装配层**：`apps/cli` 是 Node 侧的组合根（把 core 的二十几个服务工厂接成一条 `nm` 命令行），`packages/tdbc-driver-*` 是 core 与三种 SQLite 实现之间的连接协议适配，`packages/sksp-*` 是四个平台各自的密钥保管实现，`packages/tokenizer-driver-*` 是两套分词器后端。设计上以「core 定义协议 + 平台包各自实现 + 共享 conformance 套件拉齐语义」为主轴。

## 职责与边界

- **本区域只做装配与平台差异**，不含业务规则。会话/消息/工作区的语义全在 `packages/core`，本区域的 `commands.ts` 都是薄壳（`apps/cli/src/session/commands.ts:47-` 一屏读完一个子命令族）。
- **协议定义在 core，实现在本区域**：`TdbcConnection` / `TdbcDriver` / `SecretStore` / `SkspCryptoStrategy` / `TokenCounterRegistry` 全部在 `packages/core/src/infra/{tdbc,sksp,nmtp}/`，本区域不得反向定义协议。
- **CLI 是唯一持有"进程级装配顺序"的角色**：`registerBetterSqlite3Driver` → `registerPlatformSkspDriver` → `registerTokenizerNodeDriver` → `open` → `bootstrapNovelMaster` → 两个幂等维护任务 → 服务工厂（`apps/cli/src/runtime.ts:171-191`）。
- 明确**不属于**本区域：desktop/mobile 的运行时装配、core 的业务服务实现。

## 对外接口

| 包 | 入口导出 | 关键类型 |
|---|---|---|
| tdbc-driver-better-sqlite3 | `registerBetterSqlite3Driver` / `BetterSqlite3Driver` / `BetterSqlite3Connection` | — |
| tdbc-driver-op-sqlite | `.` 动态 adapter / `./native` 静态 adapter；`registerOpSqliteDriver` | `OpSqliteAdapter`（含可选 `getLegacyDefaultDir` / `getDbPath`） |
| tdbc-driver-rn | 同上双入口 | `RnSqliteAdapter` |
| tdbc-conformance | `runConformanceTests` / `runNestedBatchParityTests` | `ConformanceOptions` / `NestedBatchOptions` |
| sksp-mac/linux/windows/android | 各自 `registerSkspXxxDriver` | 平台 secret store |
| tokenizer-driver-node / -rn | `registerTokenizerNodeDriver` / `registerTokenizerRnDriver` | — |
| llm-sse-native | `.` 环境无关 / `./native` RN 绑定 | `SseTransport` / `LlmSseNativeBridge` |
| cloud-sync-driver-s3 | `createS3ObjectStorage` | `ObjectStoragePort` |

## 数据访问

- CLI 全量经 `TdbcConnection`，无直连 sqlite。默认库 `./.novel-master/novel.db`（`runtime.ts:85`），可由 `NOVEL_MASTER_DB` 或 `--db` 覆盖（`runtime.ts:112-121`）。
- 启动固定跑两个幂等后台任务：`runMessageContentCompaction`（压缩谓词 `content_json != ''`）、`runBlobBinaryNormalization`（blob 形态归一），RULE.md:32 记录了二者口径与 KKV 完成标记。
- SKSP 侧唯一直接表：`sksp_secrets`（`packages/core/src/bootstrap/sksp/sksp-schema.ts`），SQL 编排全部收敛在 core 的 `BaseSqliteSecretStore`，平台包只提供 strategy。
- sksp-android 的密文以 **base64 文本**入库而非 BLOB（`packages/sksp-android/src/android-secret-store.ts:5-7` 注释：quick-sqlite heap 损伤 workaround）；mac/linux/windows 走 Uint8Array。
- sksp-mac 与 sksp-linux 的 keyring **service 名不同**（`"novel-master"` vs `"novel-master-linux"`，`sksp-mac/src/keychain.ts:10` / `sksp-linux/src/keychain.ts:10`），是刻意的跨平台隔离，避免 Linux 上误读 macOS 遗留条目。

## 依赖关系

- **依赖 core**（单向）：所有驱动包 `import ... from "@novel-master/core"` 或 `/tdbc` `/sksp` `/nmtp` 子路径。驱动包**不反向依赖 app**。
- **被 app 消费**：CLI → better-sqlite3 + sksp-{mac,linux,windows} + tokenizer-driver-node（`apps/cli/package.json:19-26`）；mobile → op-sqlite + rn + sksp-android + tokenizer-driver-rn。
- **驱动包之间零依赖**：op-sqlite 与 rn 之间无 import 关系，rn 不 import op-sqlite，反之亦然（实测 `git grep` 确认）。
- tdbc-conformance 只依赖 core，**被三个驱动包作为 devDependency 引用**（不是 peer）——决定了它必须先 build 出 dist 才能被驱动测试消费。

---

# 一、辩护理由清单

> 立场：论证本区域的设计是有意为之且合理的。以下每条给出可核验的依据；凡我认为是**故意设计**的，不接受"这是冗余/应该抽象"的指控。

## A-1 conformance 契约的设计是本区域最扎实的部分，应予肯定而非批评

**辩护**：C1–C11 覆盖了 `TdbcConnection` 协议面上**每一条会产生跨端语义分歧的轴**：关闭后拒绝（`suite.ts:37`）、`?` 绑定（`:66`）、null/undefined 统一为 SQL NULL（`:96`）、BLOB 往返（`:128`）、事务提交可见（`:158`）、异常回滚（`:186`）、batch 计数与全量可见（`:215`）、batch 失败全量回滚（`:246`）、**嵌套事务显式拒绝**（`:278`）、SqlTemplateParser 贯通（`:309`）、未注册驱动报错（`:325`）。

这十一条不是"随便测几个"，而是**逐条对应一个曾经或正在咬人的跨端 bug**：blob 绑定形态（bindings 归一化的存在理由）、batch 原子性（`batchSync` 内层 `db.transaction()` 的存在理由）、嵌套事务（`TransactionalConnection.transaction` 返回 rejected promise 的存在理由）。**协议测试是"为什么这些看起来冗余的代码必须存在"的唯一书面答案**——没有它，任何一次"简化"都会被后来人误删。

**NB1–NB3 单独成套**（`nested-batch.ts`）也是对的：SAVEPOINT 语义（`nested-batch.ts:1-7` 模块头）是一个**独立于基础协议**的高阶契约，混进 C1–C11 会让基础契约的失败面变大。分成两个导出函数、让驱动各自在自己的 harness 文件里挂载，是正确的可组合粒度。

## A-2 "平台分支复制而非抽象"在本区域是**正确决策**，且决策链完整可追

**辩护**：三处复制，逐一给出它**为什么在这里是正确的**：

1. **`tdbc-driver-op-sqlite` 与 `tdbc-driver-rn` 的 ~300 行协议层复制**（实测 `connection.ts` 316/330 行、行级同构度 38/316——差异集中在注释与 yield 策略）。这不是疏忽，是 2026-08-16 用户拍板的**平行包回滚线**：`docs/Iterations/replace-quick-sqlite/spec.md:40` 明写「协议层代码复制到新包而非跨包复用：约 300 行重复换取完全隔离；旧包验证通过后整体删除时，新包无依赖残留」，RULE.md:26 把它记为持久规则。
   **为什么复制是对的**：如果 rn 驱动 import op-sqlite 的 `AsyncMutex`，那么"回滚 = mobile 侧两行 import + driver 名"就会变成"回滚 = 还要回滚一个共享包"，回滚半径从 2 行膨胀到 1 个包 + 它的所有消费者。**复制把回滚的爆炸半径钉死在编译期可见的两个文件里。** 在一个"移动端换 SQLite 库"这种高风险、需要在真机上一键回退的场景下，这个代价换得非常值。

2. **sksp 四包各持一份 crypto/sqlite-secret-store**。mac 与 linux 的 `crypto.ts` 逐行同构（实测 61 行中 60 行完全一致，仅模块注释一处差异）；`sqlite-secret-store.ts` 差异只有 `ALGO` 常量与类型名（实测 diff 10 行）。windows 走 DPAPI（无 iv 概念，`sqlite-secret-store.ts:33-43`），android 走 Keystore + base64 文本，形态确实不同。
   **为什么复制是对的**：这四个包是**四个独立发布的 npm 包**，各自 `package.json` 声明不同的原生依赖（mac/linux 依赖 `@napi-rs/keyring`，windows 依赖 `@primno/dpapi`，android 依赖 RN 原生模块）。抽公共包意味着新引入一个包 + 一次版本协调，而收益只是消除 60 行**不含任何平台分支**的纯算法。`crypto.ts` 里的 AES-256-GCM 是标准实现、无平台差异、无 novel-master 特有口径——**它恰好是那种"抽出来收益最低、耦合风险最高"的代码**。**keychain 服务名的分离（`novel-master` vs `novel-master-linux`）证明作者是有意识地在 keyring 层面隔离平台，而不是无脑复制。**

3. **tokenizer driver 的 node/rn 双实现**（实测 `count-prompt-llm-input.ts` 325 vs 409 行、行级同构度仅 5/325）。**这两个根本不是复制，是两套不同的技术栈**：node 走 `tiktoken` WASM（`impl/encoding-cache.ts:45-50` 导入 `tiktoken`），rn 走 `js-tiktoken/lite` + ranks 模块（`impl/encoding-cache.ts:34-36`）。二者只在**契约层**（`CountPromptLlmInputParams` / `PromptTokenCountResult`，由 core 定义）汇合。共享的只是 core 里的 `getEncoding` 注册表与 `countTextWithIncrementalTokenizer`/`splitTextIntoChunks`/`promptWholeCache` 等纯函数——**该共享的已经全部下沉到 core 了**，剩下的差异是真实的运行时约束（Hermes 不能跑 @agnai 的 WASM、Metro 不能引 p50k ranks，见 `count-prompt-llm-input.ts:164-170`）。**这一处我完全接受现状。**

## A-3 驱动面被主动收窄，"最小面"的努力是真实的且有痕迹

**辩护**：不是所有地方都复制，**该共享的都共享了**：

- **`AsyncMutex` 是唯一被三处复制的**（19 行 × 3），但它同时被 `tdbc-driver-better-sqlite3` 独立实现了一份带完整 JSDoc 的版本（`packages/tdbc-driver-better-sqlite3/src/mutex.ts`）。也就是说作者**知道** core 里没有它，仍然选择放在驱动包——因为 mutex 的语义绑定"这条连接是单线程同步 SQLite"这一前提，core 的协议层不该持有。
- **conformance 套件被三个驱动包以 devDependency 共享**（实测三份 `package.json` 均含 `"@novel-master/tdbc-conformance": "*"`），这是本区域**最有效的抽象**：行为拉齐不靠代码共享，靠**同一套断言**。
- **`registerOpSqliteDriverWith` 单点**（`packages/tdbc-driver-op-sqlite/src/register.ts:28`）显式注释「`index.ts` 与 `native.ts` 两个入口的 `registerOpSqliteDriver` 是平行实现……统一转发到这里：单点实现、两入口天然一致，杜绝『只改 index.ts 漏掉 native.ts』的分叉」。**这是作者已经识别并修复过一次入口分叉风险的直接证据**（对比 rn 侧就没有这个收口，见下）。

## A-4 平台分支的注释承载了**不可从代码推出的实测知识**，抽象会丢失这些

**辩护**：`op-sqlite/src/connection.ts:73-80` 那段注释记录的是"quick-sqlite 时代真机实测：事务内连续中大体积写语句会稳定报 disk I/O error 或 SIGSEGV，故事务内一律同步执行"，`runAdapter` 的 16ms 时间量子让步（`:262-265`）记录的是"逐语句 setTimeout(0) 在会话复制 2 万条时每条都付一次定时器往返，真机实测几十秒级卡顿"。`bindings.ts:10-14` 记录的是"荣耀 EBG-AN00，2026-09-28，6 项探针全 PASS"的 blob 绑参实测矩阵。

**这些注释是这套平行包能安全存在的根本原因**：如果 `AsyncMutex`/bindings/runAdapter 被抽成 core 共享实现，将来 quick-sqlite 时代的结论变更时，**维护者会去改 core，而 core 里那段代码已经看不出它曾经服务过哪个平台、基于哪次真机实测**。复制保留了"这段代码属于 quick-sqlite 时代"这一考古信息，抽象会把它洗成"通用工具"。这是**用物理隔离承载知识归属**，在本项目的规模下是划算的。

## A-5 CLI 的组合根是单一入口，且错误分类/退出码有统一收口

**辩护**：`runtime.ts` 是唯一持有装配顺序的文件（实测 CLI 48 个源文件中只有它 import 驱动包），`main.ts` 是唯一分发命令的文件（`:98-192`），错误格式化与退出码收在 `cli-errors.ts`（11 种领域错误 + 兜底，`cli-errors.ts:39-55`）。三个 `resolve-*-scope` 文件（`resolve-scope` / `resolve-entity` / `resolve-provider-scope`）把"flag > 持久状态 > 带提示的报错"这条优先级规则**写在了三个地方各一次**，而不是散在 20 个命令里——**这是有意的局部收敛，不是重复**。

## A-6 tdbc-conformance 作为 devDependency 而非 peer，是正确的依赖方向

**辩护**：三个驱动包的 `dependencies` 中**没有** `@novel-master/tdbc-conformance`，只有 devDependencies。conformance 包本身 `dependencies: {"@novel-master/core": "*"}`。这保证了 **conformance 永不进入任何生产 bundle**，同时又能在 CI 里被三个包共同消费。选 peer 会让 npm 在生产安装时要求它，方向就错了。

---

# 二、发现清单

> 立场说明：以下是我**作为辩护人愿意承认**的问题。凡我判定为"故意设计"的，标 `intentional` 并给出依据，不接受删除类指控。

## F-w9-adv-1 | P1 | apps/cli/package.json:17 + 全部 22 个 CLI e2e 用例 | confirmed

```
"test": "tsx --test test/**/*.test.ts"
```

**实测（本代理亲跑，非照抄）**：

```
> cd apps/cli && npm test
# tests 102
# pass 76
# fail 26
```

**26 个失败的根因是两个各自独立的真实缺陷，不是环境问题**（这一点与 `docs/apm/memory/20260906-regex-removal-impl.md:23` 把它们归为「#32 记录的环境问题」的旧判断相反，我做了确定性复现）：

**根因 1：`nm session create` 在全新库上必然失败。** 手工复现：

```
$ node --import tsx src/index.ts project create --name A --db <tmp>/novel.db
<uuid>
$ node --import tsx src/index.ts session create --title main --db <tmp>/novel.db
新建会话失败：workspace 未配置 Agent，且 registry 为空
exit=2
```

链路：`apps/cli/src/session/commands.ts:67` → `packages/core/src/service/chat/impl/session.service.ts:105-113` 在 `resolveWorkspaceAgentForNewSession` 返回空时直接抛错。空是因为 `resolveWorkspaceAgentForNewSession`（`packages/core/src/service/agent/logic/agent-run-shared.ts:64-71`）先读 state 再回落 `agentRegistry.listAgentIds()`，而 `listAgentIds()`（`agent-registry.service.ts:64-66`）**只读 DB，不含虚拟的 `general`**（只有 `list()` 在 `:75` 才追加 `DEFAULT_SUBAGENT_DEFINITION`）。
**而 CLI 侧没有任何创建 agent 的命令**——`nm agent` 的子命令是 `run|continue|list|show|import|export|migrate|delete`（`apps/cli/src/agent/commands.ts` 的 usage 行），`import` 需要外部文件。**结论：全新机器上 `nm` 无法创建第一个会话。** 引入这行的是 c3032e5e（2026-08-02「移除 session agent config 的 workspace 回退层」）。

**根因 2：`[nm-boot]` 迁移日志打到 stdout，污染机器可读输出。** 实测：

```
$ node --import tsx src/index.ts project create --name A --db <fresh>/novel.db
STDOUT>>> [nm-boot] migration run: retire-pref-session-fs-version-check-v1
           [nm-boot] migration applied: ...
           ...（12 行）
           dde1a0c6-bc0b-4fb6-a56e-b29cd45fdb37   ← 命令真正的输出
           <<<
STDERR>>> <<<
```

源头 `packages/core/src/bootstrap/schema-migrations/index.ts:67,71` 用 `console.log`。CLI 的 stdout 是**机器可读契约**（`project create` 承诺 stdout 只有 UUID），日志混进去直接破坏契约。测试侧已经有人踩过并写了 `stripBootLogs`（`apps/cli/test/helpers.ts:40`）做局部绕过——**但只被 4 个测试文件用了**，`cli-context-e2e.test.ts`、`vfs-zip-e2e.test.ts` 等没用，于是 T1 断言 `config.currentProjectId === projectId` 时实际拿到的 projectId 前面糊着 12 行日志（实测 T1 的 expected/actual 差异正是这些日志行）。

**建议**：① 根因 1 二选一——`nm` 加 `agent create` 子命令，或 `session create` 在 registry 为空时回落虚拟 `general`（后者更贴近 RULE.md:39「内置虚拟 general 子代理」的既有设计）。② 根因 2 把 `[nm-boot]` 迁到 stderr，或加 `NM_SILENT_BOOT=1` 门控（注意 RULE.md:103 记录的"Windows 单引号 glob 假绿"是同类信号污染，先例在册）。③ **无论怎么修，26 个红用例会全绿——这条本身就是"CI 从未拦住它"的证据**：`.github/workflows/ci.yml:65-66` 的 Test 步没有 `continue-on-error`，说明 main 上这个 suite 一直是红的，或者 CI 根本没跑到 apps/cli（建议一并核实）。

## F-w9-adv-2 | P2 | packages/tdbc-driver-better-sqlite3/src/connection.ts:66-71 | confirmed

```
    } catch (cause) {
      this.db.exec("ROLLBACK");
```

**这是平行包复制已经产生漂移的铁证，也是本区域唯一一处"复制代价大于收益"的地方。** 对比 op-sqlite 与 rn 的同一段：

```
// op-sqlite/src/connection.ts:86-99
    } catch (cause) {
      // ROLLBACK 失败不能掩盖原始错误：某些 SQLite 错误会自动中断事务
      //（此时 ROLLBACK 报 "no transaction is active"），吞掉它只打日志，
      // 原始错误照常抛出，否则用户只看到回滚失败而真正的病因被吞。
      try {
        await this.runAdapter("ROLLBACK", undefined);
      } catch (rollbackError) { console.warn(...); }
```

**两个 RN 系驱动都写了「ROLLBACK 失败不能掩盖原始错误」的防御，better-sqlite3 没有。** 后果是具体的：SQLite 因磁盘满/IO 错误自动中断事务时，`ROLLBACK` 抛 `cannot rollback - no transaction is active`，**这个二次异常会顶替掉真正的病因**（disk I/O error）冒到用户面前。这不是风格差异，是可观测的错误信息劣化。

**建议**：把 op-sqlite 的 try/catch + warn 结构回填 better-sqlite3（3 行）。**这条同时是对 A-2 辩护边界的一次诚实承认**：复制保住了平台知识，但没保住防御——因为防御是在复制**之后**才被想到的，而复制让这个改进需要**手工同步三处**而不是改一处。

## F-w9-adv-3 | P2 | 三个驱动包 connection.ts 的 `transaction()` | confirmed

```
// better-sqlite3 :57-62          // op-sqlite :69-81           // rn :63-73
this.inTransaction = true;        this.inTransaction = true;  this.inTransaction = true;
const txConn = new TxConn(this);  const txConn = new TxConn(this); const txConn = ...
this.db.exec("BEGIN");            await this.runAdapter("BEGIN", undefined);  await ...
try {                             try {                       try {
```

三份代码**都把 `BEGIN` 放在了 `try` 之外**。若 `BEGIN` 本身抛错（磁盘满、库被锁、底层 native 报错），`finally { this.inTransaction = false }` 永远不会执行 → **该连接的 `inTransaction` 永久卡在 true**，此后所有 `transaction()` 调用都抛 `NESTED_TRANSACTION`，连接实质报废且无自愈路径。

**建议**（三处各 1 行）：把 `BEGIN` 移进 `try`，或把 `this.inTransaction = true` 移到 `BEGIN` 成功之后。op-sqlite/rn 还多一层：`runAdapter` 依赖 `inTransaction` 来决定走同步还是异步（`:257`），BEGIN 失败后若状态卡死，后续排障语句也会走错分支。

## F-w9-adv-4 | P3 | 三个驱动包的 `mutex.ts` | confirmed（可低成本收敛）

实测三份 `mutex.ts` 各 19 行，`rn` 与 `op-sqlite` 逐行相同（仅模块注释），`better-sqlite3` 多 4 行 JSDoc。**与 A-2 辩护的边界**：19 行、无平台语义、三个包都已依赖 core——**这一处是复制收益为负的**，与 op-sqlite 的 ~300 行协议层不同。core 的 `infra/tdbc/` 下沉一个 `AsyncMutex` 即可，驱动包改为 import。**但收益也确实只有 38 行**，列 P3。

## F-w9-adv-5 | P3 | apps/cli/src/vfs/errors.ts（整文件） | confirmed

该文件导出 `EXIT_USAGE` / `formatCliError` / `exitCodeForError`，与 `apps/cli/src/cli-errors.ts` 是**同名的早期版本**（只认 `VfsError` / `TdbcError`）。实测全仓无任何 importer（`git grep "vfs/errors"` 只命中 mobile 侧的另一份同名文件与历史 spec 文档）。**纯死文件，删除零风险。**

## F-w9-adv-6 | P3 | apps/cli/src（11 处） | confirmed

`function flagString(flags, key)` 在 `agent/commands.ts:28`、`agent/registry-commands.ts:19`、`compaction-conditions/commands.ts:15`、`config/resolve-entity.ts:9`、`config/resolve-provider-scope.ts:13`、`config/resolve-scope.ts:9`、`model/commands.ts:19`、`provider/commands.ts:13`、`provider/model/commands.ts:19`、`provider/model/sampling-commands.ts:17`、`sort-rule/commands.ts:21` —— 11 份逐字相同。5 行纯函数，`config/parse-args.ts` 已有天然的归属地。**与 A-5 的辩护不冲突**：那三条 `resolve-*-scope` 是有语义的收敛，`flagString` 是无语义的复制。

## F-w9-adv-7 | P3 | packages/tdbc-conformance/package.json:14 | confirmed

```
"test": "tsx --test test/**/*.test.ts"
```

该包 `git ls-files` 只有 `eslint.config.mjs` / `package.json` / `src/{index,nested-batch,suite}.ts` / `tsconfig.json` —— **没有任何 test 目录**。实测 `npm test` 输出 `# tests 0 / # pass 0`，**退出码 0**。作为 fixture 包这本身可接受，但**它与 RULE.md:103 记录的 desktop「单引号 glob 收集 0 条测试却全绿」是同一种假绿形态**。建议要么删掉这个 script，要么加一条断言"收集到 ≥1 个用例"，避免将来有人在 conformance 包里加测试却因 glob 问题静默不跑。

---

# 三、让步清单（我明确承认、不予辩护的部分）

| # | 让步内容 | 严重度 | 依据 |
|---|---|---|---|
| S-1 | `nm session create` 在全新库上必然失败，CLI 无任何创建 agent 的命令 → 全新安装的 CLI 用户开不了第一个会话 | **P1** | F-w9-adv-1 根因 1，已手工确定性复现 |
| S-2 | `[nm-boot]` 迁移日志污染 CLI stdout，破坏"stdout 只输出机器可读值"的契约；已导致 e2e 用例集体红 | **P1** | F-w9-adv-1 根因 2，已手工复现 stdout 12 行污染 |
| S-3 | `apps/cli` 测试 26/102 失败（76 通过），且 CI Test 步未加 `continue-on-error` 却未见拦截 | **P1** | F-w9-adv-1 实测 |
| S-4 | better-sqlite3 的 ROLLBACK 未做「失败不掩盖原始错误」防御，op-sqlite/rn 有 → 复制漂移的可观测后果 | P2 | F-w9-adv-2 |
| S-5 | 三驱动 `BEGIN` 在 try 外，失败即永久卡死 `inTransaction` | P2 | F-w9-adv-3 |
| S-6 | `AsyncMutex` 三份复制收益为负（与协议层 ~300 行复制性质不同，不适用 A-2 辩护） | P3 | F-w9-adv-4 |
| S-7 | `apps/cli/src/vfs/errors.ts` 整文件死代码 | P3 | F-w9-adv-5 |
| S-8 | `flagString` 11 处逐字复制 | P3 | F-w9-adv-6 |
| S-9 | tdbc-conformance 的 test script 收 0 条测试仍退出 0 | P3 | F-w9-adv-7 |
| S-10 | op-sqlite 与 rn 的 `conformance.test.ts` 均未挂载 `runNestedBatchParityTests`（实测三份 conformance.test.ts 全为 `false`），NB 套件靠**三个独立文件**（`nested-batch-parity.test.ts`）分别挂载。**我曾想把这算作缺陷，撤回**：分文件挂载是刻意的可组合粒度（见 A-1），且三份 harness 都在，覆盖不缺。**唯一真实缺口是 PRAGMA 验证的不对称**：better-sqlite3 有 `test/foreign-keys.test.ts`、op-sqlite 在 adapter 测试中断言了 `PRAGMA foreign_keys` 与 `temp_store`、**rn 驱动零 PRAGMA 断言**——而 rn 正是那条"随时可能被切回来的回滚线" | P3 | `git grep foreign_keys` 三包命中情况 |

---

# 四、争议与存疑（不抹平分歧，交由 W7 裁决）

1. **"26 个红用例"是否应算 CLI 区域的问题？** 我的判断是**算**，但根因落在 core（`session.service.ts` 的 agent 前置 + `schema-migrations/index.ts` 的 console.log）与 CLI 装配面的交界。**争议点**：主代理可能认为这属于 core-agent / core-bootstrap 机位的地盘而从本区剥离。**我的立场**：CLI 是唯一受害者（只有 CLI 有"stdout 必须机器可读"这条契约、且只有 CLI 没有 UI 路径去创建 agent），**修复责任在本区**，但**根因归属跨区**，reduce 时不应重复计条。

2. **A-2 对 op-sqlite/rn ~300 行复制的辩护，与 S-4/S-5 的存在是否自相矛盾？** 我不认为矛盾，但**这是本报告最可能被反驳的一点**，我如实标出：复制的收益（回滚半径 + 知识归属）已在 A-2/A-4 论证；复制的代价（S-4/S-5 需要手工同步三处）在本次 CR 中**已经实际发生了一次**。**我的最终立场**：这个 trade 在"真机回滚"这个具体场景下仍然划算，但**代价不该被浪漫化**——它不是"零成本的好设计"，而是"用一次已发生的漂移买来的确定性"。若 W7 倾向收敛，唯一我能接受的收敛方式是**只抽 `AsyncMutex`（F-w9-adv-4），不动 connection/bindings/runAdapter**。

3. **sksp-mac 与 sksp-linux 的 `crypto.ts` 61 行里 60 行相同**——我判为"不值得抽"（四包独立发布 + 无平台语义）。**可能的反对意见**：这 60 行是 AES-256-GCM 标准实现，**不含任何 novel-master 口径**，抽到 core 的风险其实很低。**我不完全坚持**，标为存疑；若 W7 认为该抽，代价是新增一个包（或并入 core）+ 四处 import 调整。

4. **本报告完全未审 4 个 Kotlin 原生文件**（`tokenizer-driver-rn/android/src/main/java/**` 6 个文件、`sksp-android/.../SkspModule.kt`、`llm-sse-native/.../LlmSseModule.kt`）。W2 cli-periph 已记录该盲区。**我不假装覆盖**：本报告的所有结论仅限 TS 侧。Kotlin 侧（尤其 `TokenizerEngine.kt` 的分词口径是否与 TS 侧 `count-prompt-llm-input.ts` 对齐）需另派机位。

5. **`packages/tdbc-driver-rn` 的整体存废**。RULE.md:26 记它是"回滚线"，`docs/Iterations/replace-quick-sqlite/spec.md:171` 记回滚方案是"mobile 侧两行换回"。我按 intentional 处理（不报"死代码"）。**但存疑**：mobile 的 `package.json:28-30` 三个 pre* 脚本仍在构建它，CI 的 `release.yml:93` / `android-nightly.yml:64` 也在构建它——**一条"回滚线"占着三个 CI 构建位**。若 W7 讨论退役顺序，我建议先答"op-sqlite 已在真机稳定运行多久"再定。
