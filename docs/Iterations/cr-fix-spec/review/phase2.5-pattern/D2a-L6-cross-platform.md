# D2a-L6：L6 跨端一致性跨模块模式识别

## 元信息

- 角度：L6 跨端一致性
- 输入：D1-06-cross-platform + D2-chat-message / D2-provider-llm / D2-vfs / D2-compaction / D2-prompt / D2-agent-tool + D0-1 god module 引用表 / 三端体量 9 : 2 : 1
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly 跨模块聚拢，不读实现代码、不改任何文件、不宣布 ready

## 结论（叙述式）

诶～把 D1-06 的 15 条发现叠在 6 份切片上看完之后，L6 单看时那些「散在三端的小不一致」其实就剩 **4 条系统性反模式 + 1 条标签纠偏**。最值得 Phase 3 先动的是 **「同名 driver / 同名 helper 三端实现不对齐」**——D1-06 当时是把它当成「SKSP、tokenizer、TDBC、SSE 四个独立点」分别打分的，跨切片叠起来看才发现，这是 **4 个不同的 driver 家族（SKSP / tokenizer / TDBC / SSE）在同一个根本原因上反复发病**：core 提供了接口契约和 registry，三端 driver 各写一份实现，**没有 conformance 套件强制 parity**，driver 包之间靠注释和「同名函数」维持默契。换句话说，不是哪一个 driver 出了问题，是「driver 这种形态在仓库里缺少强制的对齐机制」这一层架构性缺失。这条从「4 条 A」升级成「1 条 S」是合理的，因为它一次整改受益面覆盖所有 driver 家族。

第二个模式是 **「mobile 集中漏接 + mobile 反向独占」并存**。D2-provider-llm S1 把 provider 删除的 current\* 清理散落问题抬出来之后，「mobile 完全没接入 provider 删除」和 D1-06 当时写的「mobile 独有 rollbackToMessage」凑成了一对镜像——方向相反、根因相同：**mobile 既是「最大端 35 766 行」又是「消费 core 入口最分散的一端」，没有一份『mobile vs core 功能矩阵契约』在维护**。最关键的纠偏是 D2-chat-message A1 把 D1-06 的 B-4 直接证伪了：`rollbackToMessage` 在 CLI（`apps/cli/src/session/commands.ts:138`）、desktop（`apps/desktop/src/main/ipc/handlers/messages.ts:350` + renderer `ConversationPanel.tsx:489`）、mobile（薄壳 service）三端都有入口，D1-06 当时漏扫了。也就是说「mobile 反向独占」这条目前**只剩 mobile 独有的 stream-buffer / wire-queue**（这条 D1-06 自己已经标成 documented intentional 的 UX 节奏差异，不算债），「mobile 漏接」这条倒是被切片补强了：provider 删除漏接 + Android SKSP `get()` 漏 `version` 列 + mobile 绕过 SKSP registry + mobile 不传 env override。前两条是债，后两条是 documented intentional，但**都集中在 mobile 一端**这件事本身就值得 Phase 3 单独问一句「mobile 是不是缺一份『端侧 core 消费清单』的强制文档」。

第三个模式是 **「core / driver 包对 RN 抽象泄漏」**。D1-06 当时把 cloud-sync-driver-s3 静态 import node:fs 标成 A-7，跨切片看这条根因其实更深——mobile 之所以要维护整整 5 份 shim + polyfills.ts，是因为 **cloud-sync-driver-s3 在 D2-provider-llm 看是 provider/llm 切片的强耦合点**，而它在 mobile 上又是最重的兼容包袱。同一类泄漏还有 SKSP registry 接入不统一（A-5，mobile 直连 `createAndroidSecretStore` 绕过 `registerSkspAndroidDriver`），和 D2-provider-llm S1 提的「删除 provider 的 current\* 清理散在 app 层」——**这三条都是「core 把本该收口的责任外推给三端，三端各自补一份，其中 mobile 补得最不规范」**。

第四个模式是 **「core 公共 helper 缺下沉，三端各自补一份校验」**：`assertZipArchive`（D1-06 B-2，CLI 不校验 / Desktop 查 PK / Mobile 扫 EOCD）、`vfsZipExportFileName`（B-3，desktop 与 mobile 字面复制粘贴）、`assertYamlFileName`（B-5，只 mobile 有）。叠加 D2-vfs S2 的关键澄清——core 的 `vfs-zip-validate.ts` 是 import 路径的校验，**不会**救 export 预检不一致，因为 export 阶段还没走到 validate。这说明把 mobile 版本下沉到 core 不是「锦上添花」，是「core 现在的 zip helper 在 export 路径上有真空」。

最后单独说一句 **tokenizer 三端不一致 × 多模块放大**：D1-06 A-4 单看是「Node 走 `countOpenAiStyleMessages` 含 role overhead，RN 手写 `encode().length + 3 + 3`」，跨切片叠 D2-compaction B1 + D2-provider-llm B2 才看清楚放大路径——mobile heuristic 回退时 `counterKind` 撒谎，会被 `token-ratio.trigger.ts` 当成精确数吃进 compaction 判定（B 级），又被 `public/provider.ts` 当成稳定 API 暴露出去（B 级）。这条不单独立模式，归在模式 1 的「driver 不对齐」里，但要在建议方向里写清楚「tokenizer 的整改牵动 compaction + provider 两个下游」。

整体严重度：**S 级 1 条（driver 不对齐）、A 级 3 条（mobile 漏接 / 抽象泄漏 / helper 缺下沉）、纠偏 1 条（B-4 证伪 + B-8 已 documented）**。Phase 3 优先裁决的是模式 1 和模式 3——前者一次整改受益全 driver 家族，后者直接关系到「mobile 是不是被结构性地放在了二等公民位置」。

## 跨模块模式清单

### 模式 1：同名 driver / 同名接口三端实现不对齐（系统性）

- 类型：同一反模式多处出现（类型 1）+ 模块间不一致（类型 2，核心路径）
- 出现模块：SKSP driver（`sksp-{windows,mac,android}`）、tokenizer driver（`tokenizer-driver-{node,rn}`）、TDBC driver（`tdbc-driver-{better-sqlite3,rn}`）、SSE transport（core `llm-sse-transport.ts` 内部分叉为 fetch / XHR）
- 共同特征：core 提供接口契约（SecretStore / TokenCounter / TdbcConnection / postSse）+ 一个 registry / dispatcher 抽象，三端 driver 各写一份实现，**靠注释和同名函数维持默契，没有 conformance 套件强制 parity**。具体形状有四种变体：

  | 变体 | 三端不对齐的具体行为 | 单看严重度（D1-06） | 下游放大 |
  |------|---------------------|--------------------|----------|
  | **SKSP** | 三种 algo tag（`android-keystore-aes-gcm-v1` / `macos-keychain-aes-gcm-v1` / `dpapi-v1`）+ Android ciphertext 存 base64 而非 blob + Android `get()` SELECT 漏 `version` 列 | A（A-5、A-6、B-1） | 跨设备 db-backup 恢复时 `DECRYPT_FAILED`（B-1，已 documented） |
  | **tokenizer** | Node 走 `countOpenAiStyleMessages`（含 role overhead 3+3 + delim）；RN 手写 `enc.encode(content).length + 3 + 3`；RN heuristic 回退时 `counterKind` 仍标家族名而非 `"heuristic"` | A（A-4） | **D2-compaction B1**：`token-ratio.trigger.ts` 把不准的数当精确数喂进 compaction 阈值判定；**D2-provider-llm B2**：tokenizer 整个子系统被 `public/provider.ts` re-export，外部消费者拿到的是「三端行为分叉的 API」 |
  | **TDBC** | better-sqlite3 的 `batchSync` 永远经 `db.transaction()` 形成 SAVEPOINT；RN 的 `batchDirect` 在外层事务内**跳过** BEGIN/COMMIT，不形成 SAVEPOINT | A（A-3） | batch 部分失败时两端持久化结果不同；与 L4 强耦合 |
  | **SSE** | fetch 路径按网络包边界逐段 `onChunk`；XHR 路径经 `createSseChunkEmitter` 做 byte pacing（accumulate → drain → flush），文件顶部注释明说「Fetch path intentionally does not use createSseChunkEmitter」 | A（A-2） | `mobile-sse-stream-resilience` 迭代就是补这条分叉造成的 tail event 丢失 |

- 各模块差异：四个 driver 家族的不对齐**性质不同**——
  - **SKSP 是「设计上必然不对齐」**：Android Keystore / macOS Keychain / Windows DPAPI 是平台原生密钥存储，algo tag 不同是天然约束（B-1 的根因就是这条天然约束）。问题不在 algo 不同，而在 **Android 这一端连 schema 都没跟齐**（漏 `version` 列），这是可以修的纯实现 bug。
  - **tokenizer 是「公式选择不同 + 元数据撒谎」**：两端 tiktoken 公式可以收敛（把 OpenAI style overhead 抽到 core logic），heuristic 回退把 `counterKind` 改回 `"heuristic"` 也能修。这条最危险，因为下游 compaction 判定是「超阈值就触发」的硬开关，计数偏差会让 mobile 该压不压或频繁压缩。
  - **TDBC 是「平台约束 vs 设计选择」**：RN adapter 注释明说「batch inside outer transaction: statements only, no nested BEGIN/COMMIT」——是**有意为之**地避开 SAVEPOINT（RN adapter 不支持）。但 better-sqlite3 这一端隐式支持 SAVEPOINT。最坏情况是「一端隐式有、一端隐式没有」。
  - **SSE 是「同一文件内两条路径」**：这是四个变体里**唯一不在 driver 包层、而在 core 内部**的不对齐。`shouldUseXhrForSse()` 在运行时分发，但两条路径的 chunk 时序和分包粒度不同。

- 系统性根因：**仓库里没有「driver 家族 conformance 套件」**。`tdbc-conformance` 这个包存在（D1-06 §覆盖声明提过），但 D1-06 明确说它「未参与 parity 比较」——也就是说 conformance 套件**存在但没用来做跨端 parity 校验**。SKSP / tokenizer / SSE 连 conformance 包都没有。结果就是「同名接口的契约」靠 driver 包作者自觉维护，core 没有强制门。这是架构层的缺失，不是单个 driver 包的 bug。

- 严重度：**S**。同一反模式在 4 个 driver 家族出现，根因是「缺统一的 driver parity conformance 约定」这种架构层缺失（指导文档 §严重度参考 S 的判定标准原文命中）。同时 4 个里有 3 个（tokenizer / TDBC / SKSP）涉及核心路径（数据持久化、token 计数、密钥存取），不是边缘差异。

- 建议方向（不改代码，只描述方向）：
  1. **最优先**：把 tokenizer 两端的 tiktoken 公式收敛——`countOpenAiStyleMessages` 的 OpenAI style overhead 抽到 core 的 `infra/tokenizer/logic/`，两端 driver 都调同一份；RN 的 heuristic 回退 `counterKind` 改回 `"heuristic"`（与 Node 对齐）。这条牵动 compaction + provider 两个下游，是 ROI 最高的整改。
  2. **结构性整改**：把 `tdbc-conformance` 升格成「所有 driver 家族的 parity 套件」——SKSP 加 `get(set(...))` round-trip 测试、tokenizer 加「同一段文本两端计数差 ≤ N%」断言、SSE 加「两条路径投给上层的 chunk 序列等价」断言。当前 conformance 包「存在但不用」是最浪费的状态。
  3. **设计裁决（留给 Phase 3）**：TDBC 的 SAVEPOINT 行为是「两端都支持」还是「两端都不支持」？SSE 的 chunk emitter 是「两条路径都走」还是「emitter 收敛 + fetch 也包一层」？这两个是接口契约层的设计选择，不是 bug fix。

### 模式 2：mobile 集中漏接（含反向独占的纠偏）

- 类型：模块间不一致（类型 2）+ god module 影响（类型 3，mobile 作为最大端消费入口最分散）
- 出现模块：provider（D2-provider-llm S1）、SKSP（D1-06 A-5、A-6、B-8）、message-rollback（D2-chat-message A1 纠偏）、stream-buffer（D1-06 B-6，documented intentional）
- 共同特征：mobile 既是三端里体量最大的一端（35 766 行，desktop 的 5 倍、cli 的 9 倍），又是「消费 core 入口最分散、最不规范」的一端。具体形状分两类：

  | 类别 | 项 | 性质 |
  |------|----|------|
  | **mobile 漏接（债）** | provider 删除入口完全缺失（`grep providers\.delete` 在 `apps/mobile/src` 零命中）——D2-provider-llm S1 | 债，无文档说明 mobile 故意不做 |
  | **mobile 漏接（债）** | Android SKSP `get()` SELECT 漏 `version` 列（A-6） | 债，纯实现 bug |
  | **mobile 漏接（documented）** | SKSP composite 不传 env override（B-8） | `infra/sksp/index.ts:7` 注释明说「Mobile：生产运行时 composite 不传 env store」——documented intentional，但 dev/CI e2e 无法 env 注入 |
  | **mobile 绕路（documented 嫌疑）** | mobile 直连 `createAndroidSecretStore(conn)`，绕过 `registerSkspAndroidDriver()` + `resolveSkspDriver()`，导致 `packages/sksp-android/src/register.ts` 在生产代码里是死代码（A-5） | 不是 documented，是事实状态——registry 抽象存在但只有三分之二的端在用 |
  | **mobile 反向独占（纠偏）** | D1-06 B-4「`sessionFs.rollbackToMessage` 仅 mobile 有服务包装」**被 D2-chat-message A1 证伪**：CLI `apps/cli/src/session/commands.ts:138` 有 `nm session rollback` 子命令；desktop 有 `nm:sessions/rollback` IPC handler + renderer `ConversationPanel.tsx:489` 回调；mobile 是薄壳。**三端在 rollbackToMessage 上是对齐的** | 纠偏项 |
  | **mobile 反向独占（合理）** | stream-buffer / stream-wire-queue / stream-apply-buffer（B-6） | `mobile-sse-stream-resilience` 迭代确认是 RN 渲染跟不上 chunk 速率的必要适配，documented intentional |

- 各模块差异：
  - **provider 删除漏接（D2-provider-llm S1）**和 **SKSP `version` 列漏接（A-6）**是同性质的「mobile 漏接」——一个是功能入口漏，一个是 schema 字段漏，根因都是「mobile 没有一份强制 checklist 核对 core 暴露的能力 / schema 是否都消费到了」。
  - **SKSP registry 绕路（A-5）**性质不同——mobile 不是「漏接」，是「绕路」，主动选择了 direct factory 而非 registry。这条要 Phase 3 裁决是「mobile 有合理理由绕路」（那 registry 抽象过度，CLI/desktop 也该改 direct factory）还是「mobile 应该改回 registry」（那 mobile 要补 register 调用）。
  - **rollbackToMessage 三端都有（D2-chat-message A1）**这条是 L6 自身需要做减法的发现——D1-06 §功能矩阵第 6 行「`sessionFs.rollbackToMessage` ❌ / ❌ / ✅ mobile」需要 Phase 3 主代理更正为三端 ✅。这不是模式，是 lens 漂移纠偏。

- 系统性根因：**仓库缺一份「mobile vs core 功能矩阵契约」文档**。D0-1 §三端 app 体量已经标了「mobile 35 766 行远超其余两端，跨端 parity 风险集中在 mobile vs 其余两端」，但没有任何文档维护「mobile 应该消费 core 的哪些能力」清单。结果 mobile 漏接一个 provider 删除入口，要到 D2 切片才被发现；Android 漏一个 `version` 列，要到 L6 横扫才被发现——都是「没有强制 checklist」造成的延迟发现。

- 严重度：**A**。mobile 漏接的债只有两条（provider 删除 + `version` 列），但加上 documented intentional 的两条（env override + registry 绕路）就凑成 4 条集中在 mobile 一端，且其中一条（provider 删除）是用户可见的功能缺口。

- 建议方向（不改代码，只描述方向）：
  1. **短期**：mobile 补 provider 删除入口（或文档说明 mobile 故意不做，目前没有任何 iteration 文档说明）；Android SKSP `get()` SELECT 列表加上 `version` 列，与其他两端对齐。
  2. **结构性整改**：立一份「mobile core 消费清单」文档（类似 `apps/mobile/CORE_PARITY.md`），列出 mobile 应该消费 core 的哪些能力 / 哪些 schema 字段，每次 core 加新能力时 mobile 这边有 PR checklist 核对。
  3. **Phase 3 裁决**：SKSP registry 绕路（A-5）是「mobile 改回 registry」还是「承认 registry 抽象过度」——当前中间状态（抽象存在但只有 2/3 的端在用）是最差的。

### 模式 3：core / driver 包对 RN 的抽象泄漏

- 类型：同一反模式多处出现（类型 1）+ 抽象边界议题
- 出现模块：cloud-sync-driver-s3（D1-06 A-7）、SKSP registry（D1-06 A-5）、provider service delete 清理（D2-provider-llm S1）
- 共同特征：**core / driver 包把本该收口在 core 层的责任外推给三端 app，三端各自补一份，其中 mobile 补得最不规范**。具体形状：

  | 变体 | core 外推的责任 | 三端各自补的形状 | mobile 补得最不规范的表现 |
  |------|----------------|-----------------|--------------------------|
  | **cloud-sync-driver-s3** | 包顶部静态 `import { readFile, writeFile } from "node:fs/promises"`——设计上声明 DI（`S3ObjectStorageDeps`），物质上仍然泄漏（A-7） | mobile 维护 `shims/{node-fs,aws-rn-fetch-handler,aws-rn-stream-collector,aws-xml-parser,tiktoken}.js` + `polyfills.ts` 全局打 Buffer / ReadableStream / TransformStream / DOMParser / Node / Blob.arrayBuffer 补丁 | 整整 5 份 shim 文件 + 全局 polyfill，藏在 `apps/mobile/src/shims/` 像临时补丁而非官方兼容层 |
  | **SKSP registry** | core/sksp 提供 `registerSkspDriver()` / `resolveSkspDriver()` 注册表抽象（A-5） | CLI / desktop 走 registry；mobile 直连 `createAndroidSecretStore(conn)` 绕过 registry | `packages/sksp-android/src/register.ts` 在生产代码里是死代码（只有测试用） |
  | **provider delete current\* 清理** | core `provider.service.ts:138-154` 的 delete 不动 `currentProviderId` / `currentModelId`（D2-provider-llm S1） | CLI `apps/cli/src/provider/commands.ts:94-112` 和 desktop `apps/desktop/src/main/ipc/handlers/providers.ts:89-104` 各写一份清理逻辑（字面近似但物理分离） | mobile **完全漏接**（无 provider 删除入口） |

- 各模块差异：
  - **cloud-sync-driver-s3 是「DI 契约与物质依赖矛盾」**——包声称可注入 readFile/writeFile，但静态 import 让 RN bundler 必须解析 node:fs，要么靠 shim 兜底要么打包失败。这是「设计文档说 DI，代码现实说硬依赖」的典型漂移。
  - **SKSP registry 是「抽象存在但只有 2/3 的端在用」**——和 cloud-sync-driver-s3 不同，这里 core 抽象本身是对的（registry 模式），问题是 mobile 不消费。整改方向是「mobile 改回 registry」或「承认抽象过度，三端都改 direct factory」二选一，当前中间状态最差。
  - **provider delete 清理是「core 没收口，三端各自补」**——和前两条不同，这里 core 完全没提供清理能力，落到 app 层各写一份。D2-provider-llm S1 已经标 S 级，建议是收进 core（或一个 `ProviderLifecycleService` 高层编排），让三端调同一个入口。这条本身是 provider 模块的债，但 **L6 视角看它是「同一个『core 外推责任』的反模式第三处命中」**——所以归在这条跨模块模式下，不重复展开 provider 模块的具体修复建议。

- 系统性根因：**driver 包 / service 包的「DI 契约」没有强制校验**。cloud-sync-driver-s3 的 `S3ObjectStorageDeps` 是 TS 类型层面的 DI 声明，但静态 import 不在 TS 类型里体现——TS 编译通过不代表 RN bundler 能解析。同理 SKSP registry 的「register 一次 → resolve by name」是运行时契约，没有静态检查能发现 mobile 不消费。**「core 提供抽象」和「端侧消费抽象」之间没有强制的连接验证**。

- 严重度：**A**。cloud-sync-driver-s3 是 1 个核心模块的硬依赖泄漏，SKSP registry 是 1 个抽象的「存在但不用」状态，provider delete 是 1 个 core 责任外推——3 处命中但分散在不同子系统，没到 S 的「3+ 核心模块同一根因」门槛。

- 建议方向（不改代码，只描述方向）：
  1. **cloud-sync-driver-s3**：把 `readFile/writeFile` 默认实现改成 lazy require（避免静态 import），或者承认 node-leaning API 是核心现实、把 mobile 的 shim 目录作为「官方 RN 兼容层」文档化（而不是藏在 `apps/mobile/src/shims/` 像临时补丁）。
  2. **SKSP registry**：见模式 2 的 Phase 3 裁决建议。
  3. **provider delete 清理**：D2-provider-llm S1 已给具体整改方向（收进 core 或 `ProviderLifecycleService`），本报告不重复。

### 模式 4：core 公共 helper 缺下沉，三端各自补校验

- 类型：模块间不一致（类型 2，边缘路径为主，但含错误码 / 错误时机差异）+ god module 缺失
- 出现模块：vfs-zip（D1-06 B-2、B-3 + D2-vfs S2）、agent-yaml（D1-06 B-5）
- 共同特征：core 暴露的某个能力（vfs zip import/export、agent yaml import）在三端 app 层各自补一份**校验 / 命名 helper**，深度不一致、字面重复。具体：

  | 变体 | core 侧 | 三端补的形状 | 不一致后果 |
  |------|---------|-------------|-----------|
  | **`assertZipArchive`** | core 有 `domain/vfs/logic/vfs-zip-validate.ts`，但 D2-vfs S2 澄清：这是 **import 路径**上的校验（防恶意 / 损坏 zip 进入 import），**不查 EOCD 结构完整性** | CLI 不校验；Desktop 查 PK 魔数；Mobile PK + EOCD 扫描 | 同一个截断 zip，desktop 预检通过 → core validate 通过 → unzip 阶段失败；mobile 预检阶段就拒绝。错误码、错误消息、错误时机三端都不同 |
  | **`vfsZipExportFileName`** | core 无对应 helper | desktop `vfs-zip.service.ts:11-23` 与 mobile `vfs-zip.service.ts:18-30` 字面复制粘贴（`vfs-global-{pathSuffix}.zip` / `vfs-project-{projectId}{pathSuffix}.zip` / `vfs-session-{sessionId}{pathSuffix}.zip`） | 任何一边改命名规则另一边都不会同步 |
  | **`assertYamlFileName`** | core 的 `validateAgentDefinition` 不校验文件名扩展 | mobile `agent-yaml.service.ts:84` 有 `assertYamlFileName`；desktop `agent-yaml.service.ts:64-95` 不校验 | mobile 选 `.txt` 文件前端拒绝，desktop 选 `.txt` 进入 YAML parse 阶段才报错 |

- 各模块差异：
  - **`assertZipArchive` 是「core 有 validate 但目标不同」**——D2-vfs S2 的关键贡献是把「core 的 validate」和「三端的 assertZipArchive」区分清楚：前者是防恶意 zip 进 import 流程（查路径穿越 + 编码 + zip bomb 上限），后者是 export 预检防不可读字节当 ZIP 处理（查结构完整性）。**core 的 validate 不会救 assertZipArchive 不一致**，因为 export 阶段还没走到 validate。这条澄清很重要，它说明下沉 mobile 版本到 core 不是「锦上添花」，是「core 现在的 zip helper 在 export 预检路径上有真空」。
  - **`vfsZipExportFileName` 是「纯 helper 复制粘贴」**——最简单的一种，没有任何设计冲突，下沉到 core 的 `createVfsZipIoService` 或单独 zip helper 即可。
  - **`assertYamlFileName` 是「同一类无效输入两端拒绝阶段不同」**——和 D2-vfs S2 同性质，都是「错误时机不一致」。

- 系统性根因：**core 的 zip / yaml helper 集合不完整**。core 有 import 路径的 `vfs-zip-validate.ts`，但没有 export 预检的 `assertZipStructure`；core 有 `validateAgentDefinition`，但不校验文件名。这些「core 没收口的 helper」自然就被三端各自补，深度不一致。

- 严重度：**A**。3 处命中（zip 校验 / zip 文件名 / yaml 文件名）跨 2 个模块（vfs / agent），其中 `assertZipArchive` 的错误时机不一致对用户可见（同一坏文件三端报错不同）。没到 S 是因为都是边缘路径（export 预检 / 文件名校验），不在事务 / 错误处理 / 并发这种核心路径上。

- 建议方向（不改代码，只描述方向）：
  1. 把 mobile 的 EOCD 扫描版 `assertZipArchive` 下沉到 core（比如 `domain/vfs/logic/vfs-zip-validate.ts` 加一个 `assertZipStructure(bytes)`），三端 import 入口先调它再做 validate；`vfsZipExportFileName` 一并下沉到 core 的 zip helper。
  2. `assertYamlFileName` 下沉到 core 的 `validateAgentDefinition` 之前，三端调同一个校验。

## 自身纠偏（不计严重度）

D1-06 的两条发现被切片纠正或限定：

- **B-4（`sessionFs.rollbackToMessage` 仅 mobile 有服务包装）已被 D2-chat-message A1 证伪**。grep `rollbackToMessage` 在当前代码里三端都有入口：CLI `apps/cli/src/session/commands.ts:138`（`nm session rollback --message <id>` 子命令）、desktop `apps/desktop/src/main/ipc/handlers/messages.ts:350`（IPC handler，还透传 `skipVfsReconcile` / `revisionHeadBackfill` 选项）+ renderer `apps/desktop/src/main/.../ConversationPanel.tsx:489`（UI 回调）、mobile `apps/mobile/src/services/message-rollback.service.ts`（薄壳）。**D1-06 §功能矩阵第 6 行需要 Phase 3 主代理更正为三端 ✅**。性质是 lens 漂移——D1-06 写作时这三端入口可能还没合进来，或者 reviewer 漏扫了。
- **B-8（mobile env override 缺失）维持 documented intentional**。D2-provider-llm S2 进一步澄清：`infra/sksp/index.ts:7` 明确注释「Mobile：生产运行时 composite 不传 env store」，且当前实现把空串 / 纯空白视为未命中，**比 spec 更安全**（`sksp/spec.md:248` 的 `v !== undefined ? v : null` 是不安全版）。这条不是 L6 的债，是 L11 的 spec drift——但 L6 视角下「mobile 不传 env」这条 documented intentional 的状态得到强化，不应再当成「mobile 漏接」。

D1-06 其余发现（A-1 CLI 硬编码 Windows SKSP、A-2 SSE 不对齐、A-3 TDBC 不对齐、A-4 tokenizer 不对齐、A-5 SKSP registry 不统一、A-6 Android 漏 version 列、A-7 cloud-sync node:fs 泄漏、B-1 跨设备 sksp 密文不可解、B-2 vfs-zip 校验深度不同、B-3 vfsZipExportFileName 重复、B-5 yaml 文件名校验、B-6 stream-buffer、B-7 db-backup 缺 runtime handle 清理）在切片里没有被纠正，均已吸收到上面的 4 条跨模块模式里：

- A-1 / A-5 / A-6 → 模式 1（SKSP driver 不对齐）+ 模式 2（mobile 集中漏接）
- A-2 → 模式 1（SSE 两条路径不对齐）
- A-3 → 模式 1（TDBC 嵌套事务不对齐）
- A-4 → 模式 1（tokenizer 三端不对齐）+ 模式 1 建议方向里写明的「tokenizer 牵动 compaction + provider 下游」
- A-7 → 模式 3（core/driver 包对 RN 抽象泄漏）
- B-1 → 模式 1（SKSP 跨设备恢复 DECRYPT_FAILED，已 documented 平台天然约束）
- B-2 / B-3 → 模式 4（core helper 缺下沉）
- B-5 → 模式 4（core helper 缺下沉）
- B-6 → 维持 documented intentional（mobile 必要的 RN 渲染适配）
- B-7（mobile db-backup 缺 runtime handle 清理）→ 没有切片纠正，维持 D1-06 单角度 B 级判定，不在跨模块模式里重复

## 覆盖声明

**读了**：D1-06 全文（15 条发现 + driver parity 矩阵 + 功能矩阵）；D2-chat-message 全部交叉发现（重点 A1 rollback 跨端纠偏）；D2-provider-llm 全部交叉发现（重点 S1 provider 删除散落 + S2 SKSP env drift + B2 tokenizer re-export）；D2-vfs 全部交叉发现（重点 S2 zip 校验 × core validate 关系澄清）；D2-compaction 交叉发现里与 L6 相关的部分（S1 estimateTokens + B1 mobile heuristic 回退污染 compaction 判定）；D0-1 god module 引用表 + 三端体量比 9 : 2 : 1。

**没深入读**：D2-agent-tool、D2-prompt 全文——grep `跨端|CLI|desktop|mobile|三端|RN|Electron|parity|driver|tokenizer|sksp|tdbc|secret|secretStore` 在这两份切片零命中，确认与 L6 角度无交叉。D2-compaction 只读了 L6 相关的 S1 / B1 段落，其余算法 / 复杂度发现（如 ARCHITECTURE.md documented exception 失效）属于 L2/L3 角度，不在本报告范围。

**没做**：回派核实任何代码——D2-chat-message A1 对 B-4 的纠偏基于切片已给出的 grep 结果（`apps/cli/src/session/commands.ts:138` 等），本报告信任切片结论，不重新翻代码。如果 Phase 3 要把 D1-06 §功能矩阵的 rollbackToMessage 行更正为三端 ✅，建议主代理做一次代码回派最终确认。

## 给 Phase 3 的线索

1. **模式 1（driver 不对齐）↔ L4 错误与事务 + L1 数据模型**：A-3（TDBC batch 嵌套事务）在 L4 视角下如果不区分 node vs RN 的 SAVEPOINT 行为，可能会把 batch 失败的回滚边界当成一致的——L6 的立场是「两端在『外层事务内 batch 部分失败』时持久化结果不同」，这是潜在冲突点。同理 A-4（tokenizer 计数公式）↔ L1 compaction 阈值判定：L1 如果默认三端 tokenCounters 行为等价，会漏掉 mobile 端 heuristic 回退导致的计数偏差。**建议 Phase 3 把「driver 家族 conformance 套件」作为 L6 + L4 + L1 三角度共同裁决项**。

2. **模式 1 的 tokenizer 变体 ↔ D2-compaction B1 + D2-provider-llm B2**：tokenizer 三端不对齐**不是 L6 一个角度的事**——它在 compaction 判定路径上有实际后果（D2-compaction B1，mobile heuristic 回退污染 token-ratio 阈值），又在 provider public face 上被 re-export 污染（D2-provider-llm B2）。**建议 Phase 3 把 tokenizer 作为一个独立跨切片议题**，不要拆给 L6 / L2 / L8 各管一段。

3. **模式 2 的 SKSP registry 绕路（A-5）↔ L3 架构 + L8 API**：L3 可能会说「registry 模式架构正确，mobile 不用是 mobile 的事」；L8 可能会说「`resolveSkspDriver` 接口稳定」。L6 的立场：**接口稳定 + 一端绕路 = 行为分叉风险**（mobile 不走 registry 意味着未来 registry 加缓存 / 加校验 / 加多 driver fallback 时 mobile 都享受不到）。**Phase 3 需要二选一裁决**：「mobile 改回 registry」还是「承认 registry 抽象过度」。

4. **模式 3 的 cloud-sync-driver-s3 静态 import ↔ L3 架构**：L3 在评包依赖时如果只看 `package.json` 的 `dependencies`，会漏掉「包源码静态 import node 模块」这个事实上的硬依赖。**L6 的立场：static import 比 package.json 描述更能说明抽象泄漏**——建议 Phase 3 把这条作为 L3 评 driver 包依赖时的硬性检查项。

5. **模式 4 的 zip helper 下沉 ↔ D2-vfs S2**：D2-vfs S2 已经把「core 的 vfs-zip-validate 是 import 路径校验、不救 export 预检不一致」这条关系澄清清楚。整改方向（把 mobile 版 `assertZipArchive` 下沉到 core）是 L6 + L8 + L4 共识，**Phase 3 不需要裁决，直接列整改清单即可**。

6. **B-4 纠偏**：D1-06 §功能矩阵第 6 行「`sessionFs.rollbackToMessage` ❌ / ❌ / ✅ mobile」**必须由 Phase 3 主代理更正为三端 ✅**，否则 Phase 4 synthesis 会基于错误的 parity 矩阵打分。这是 lens 漂移纠偏，不是新发现。
