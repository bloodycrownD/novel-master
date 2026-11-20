# create-factory-ownership：装配层收口

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p22-public-ownership`（`d3b86ab49`）
> 目标 tag：`p23-create-factory`
>
> **修订版 v2（2026-11-19）**：经三波核查工作流修订（证据见 §九）。调用量与清单数字全部按实测重算；阶段 1 由「改直构保留」改为**删 3 留 1**；补类型迁移、sksp 双 barrel、cli 政策三类缺失步骤；验收命令改为可原样执行的版本。三处命名决策已拍板：**删 3 留 1 / Factory 短方法名 / bundle 收进 ChatServiceFactory**。

## 一、问题诊断

`createXxx` 这类函数目前散落 **96 个**（core 65 / mobile 27 / desktop 4，`grep "^export function create[A-Z]" --include=*.ts` 口径；另有 5 个 `export async function create*` 和 1 个 `.tsx` 内的不在此口径，见 §八）。原稿写 85 是漏抓子集——漏抓 11 个的真正原因是泛型类型参数（9 个）与多行签名、箭头返回类型（各 1 个），参数真正跨行的只有 2 个。问题分两层，**第二层才是真问题**。

### 1.1 形态层：散函数替代了命名空间

同一目录下多个 `create*`，**17 个组**（§八 grep 口径）：

| 目录 | 个数 | 成员 |
|---|---|---|
| `service/chat` | 8 | `createChatServices` / `createChatRepoDeps` / `createProjectService` / `createSessionService` / `createMessageService` / `createUsageStatsService` / `createMessageTranscriptEffectsService` / `createUserVfsTurnServiceBundle` |
| `infra/llm-protocol/logic` | 8 | `createAnthropicSseParser` / `createGeminiSseParser` / `createOpenAiSseParser` / `createAnthropicToolNameWire` / `createLoggingFetch` / `createSseDispatchState` / `createStreamWatchdog` / `createSseChunkEmitter` |
| `service/vfs` | 6 | `createVfsService` / `createScopedVfsService` / `createPhysicalVfsService` / `createVfsBatchIoService` / `createVfsZipIoService` / `createCharacterCardImportService` |
| `apps/mobile/src/services` | 13 | `createCloudSyncProgress` / `createNativeRequestFetch` / `createMobileLlmFetch` / `createRunFinishCalibrationProbe` / `createRunStateWritethrough` / `createTranscriptStreamHandle` / `createSnapshotCompleteSignal` / `createStreamTokenEstimator` / `createSessionStreamTokenEstimator` / `createQuantumYield` / `createScopeKeyCache` / `createLruMap` / `createStreamApplyBuffer` |
| `service/agent` | 4 | `createAgentRunner` / `createAgentRegistryService` / `createAgentAbortRegistry` / `createAgentStreamRegistry` |
| `service/message-checkpoint` | 4 | `createMessageCheckpointService` / `createMessageRollbackService` / `createCheckpointRepoDeps` / `createTruncateTailDepsFromTx` |
| `infra/sksp/impl` | 4 | `createAesGcmStrategy` / `createCompositeSecretStore` / `createEnvSecretStore` / `createKeyringMasterKey` |
| `domain/abort/logic` | 3 | `createAbortError` / `createAbortRegistry` / `createAbortScope` |
| `apps/mobile/src/web/shared` | 3 | `createMermaidSourceCache` / `createBoundPost` / `createViewSlot` |
| `apps/mobile/src/config-forms/agent` | 3 | `createDefaultAgentEditorPrompts` / `createDefaultPersistTextBlock` / `createDefaultDynamicTextBlock` |
| 其余 7 组（各 2 个） | | `service/provider`、`service/compaction-conditions`、`domain/provider/logic`、`infra/tokenizer/logic`、`apps/mobile/src/shims`、`packages/core/src/common`（`createBusyFlag` / `createTranslator`）、`apps/mobile/src/runtime`（`createCallbackSlot` / `createRebootWaiterSlot`） |

**对照 Java**：

| Java | 现状 TS |
|---|---|
| `VfsServiceFactory.create(conn)` | `createVfsService(conn)` |
| `VfsServiceFactory.createScoped(conn, scope)` | `createScopedVfsService(conn, scope)` |
| `MessageCheckpointFactory.createRollback(conn, opts)` | `createMessageRollbackService(conn, opts)` |

`create` 被提到函数名最前面，「造什么」退化成字符串后缀。代价：无法一次 import 拿到整个域的装配入口；IDE 输 `create` 出 96 个候选；「这个域怎么装配」没有唯一答案。

**这违反仓库自己的 nm-code-style 5.3**（无状态多函数同类 → object namespace）；其中三个分项工厂还同时违反 **4.1**（生产 0 引用却公开导出，见 1.2）。

### 1.2 实质层：分项工厂跑完整 bundle（这才是真问题）

`service/chat/create-chat-services.ts` 的结构：

```ts
export function createChatServices(conn, sessionDeps, options?): ChatServiceBundle {
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn, options?.yieldFn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);

  const projects = new DefaultProjectService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo });
  const sessions = new DefaultSessionService({ conn, /* 4 repo + state + agentRegistry */ });
  const messages = new DefaultMessageService({ conn, /* 4 repo */ });
  const usageStats = new DefaultUsageStatsService(conn);

  return { projects, sessions, messages, usageStats };
}

// 下面四个「分项工厂」全部经过上面的完整 bundle：
export function createProjectService(conn): ProjectService {
  return createChatServices(conn, _stubSessionDeps()).projects;
}
export function createSessionService(conn, sessionDeps): SessionService {
  return createChatServices(conn, sessionDeps).sessions;
}
export function createMessageService(conn): MessageService {
  return createChatServices(conn, _stubSessionDeps()).messages;
}
export function createUsageStatsService(conn): UsageStatsService {
  return createChatServices(conn, _stubSessionDeps()).usageStats;
}
```

**调用量（两个口径都给，v1 只给了前者）：**

| 函数 | mention 数（`\b名字\b`，含定义/import/注释/测试） | 生产调用 | 测试调用 |
|---|---|---|---|
| `createUsageStatsService` | 40 | **0** | 38（几乎全在 `usage-stats.service.test.ts` 一个文件） |
| `createMessageService` | 24 | 1（`create-message-transcript-effects.ts:21`；停维的 apps/cli 另有 1） | 7 |
| `createProjectService` | 11 | **0**（cli 1，停维） | 3 |
| `createSessionService` | 10 | **0**（cli 1，停维） | 3 |
| `createChatServices` | 12 | 2 外部（desktop/mobile runtime）+ 4 内部（分项工厂经 bundle） | 0 |

v1 的「40 / 24 / 11 / 11 / 2」与「75 处」「86 处」全是 mention 数及其求和，把测试和文档注释当成了调用方。**bundle 纯浪费的真实承受者是测试侧 51 处（38+7+3+3）+ 生产侧 1 处**：每一次都构造 6 个 Sqlite 仓储 + 4 个 Service + 1 个 `_stubSessionDeps()` 假对象，扔掉其中 9 个。结论不变，规模重新定级：浪费是真的，但 98% 发生在测试里。

最极端的是 `createUsageStatsService`：

```ts
// 实际需要的：
export class DefaultUsageStatsService implements UsageStatsService {
  private readonly parser = new SqlTemplateParser();
  constructor(private readonly conn: TdbcConnection) {}
}

// 现在做的是：造 10 个对象，取最后那一个
export function createUsageStatsService(conn: TdbcConnection): UsageStatsService {
  return createChatServices(conn, _stubSessionDeps()).usageStats;
}
```

`_stubSessionDeps()` 的注释自白：

> `createProjectService` / `createMessageService` 不消费 session 依赖，但**复用 `createChatServices` 时仍需构造一份占位**（永不触发 state/registry 调用）

**这就是「工厂复用」的真相：复用是真的，代价也是真的，而且是纯浪费。**

**并且按 nm-code-style §4.1，`createProjectService` / `createSessionService` / `createUsageStatsService` 生产引用为 0、仅测试引用，却在 public 面（`public/chat.ts:80-82`）——假公开候选，处置是删不是留（见 §三 阶段 1，已拍板）。**

## 二、判据（写进 spec，执行者照此裁决）

一个 `create*` 函数该不该存在、该长什么样：

| 条件 | 处置 |
|---|---|
| 生产引用 0、仅测试引用、却在 public 面（假公开候选，nm-code-style §4.1） | **删**：先撤 public 导出，测试改直构 impl；不进 Factory |
| 有**第二个消费者**的装配件（如 `createCheckpointRepoDeps` 被 rollback + truncateTail 共用） | 留，进 Factory |
| 有**构造时序/生命周期约束**（如 conn vs tx 必须分造） | 留，进 Factory，注释说明约束 |
| 是 `public/` 面唯一入口、删掉会暴露实现类 | 留，进 Factory，+ `nm-style: keep-public` 注释 |
| 分项工厂经由完整 bundle 取其一 | **必改成直接构造或删除**（见第一行），不管是否 namespace 化 |
| 只做参数透传给下一个 `create*` | **删**，调用方直接用原对象 |
| 函数体仅 `return new Impl({conn})` 且无非它不可的理由 | 可保留在 Factory 内，但**不得假装有装配逻辑** |

**裁决顺序：公开面约束（第 1/4 行）> 时序/复用（第 2/3 行）> 去 bundle（第 5 行）> 删透传与裸壳（第 6/7 行）。** 命中公开面行且考虑撤导出的，走 nm-code-style §4.1 假公开流程（先撤 public、再决定删不删），不在本表就地裁决。

## 三、范围与阶段

**两阶段。阶段 1 生产消费侧零改动（workspaces 内），必须先做且可独立验收。**

### 阶段 1：分项工厂「删 3 留 1」（P0）

只改 `packages/core/src/service/chat/create-chat-services.ts` 与 `packages/core/src/public/chat.ts`，外加测试改写。

**留 1**——`createMessageService` 是唯一有生产消费者的分项工厂（core 内部 1 处 + cli 1 处），签名与函数名不变，函数体改为直接构造：

```ts
export function createMessageService(conn: TdbcConnection): MessageService {
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  return new DefaultMessageService({ conn, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, checkpoints: checkpointRepo, revisions: revisionRepo });
}
```

（已逐字段比对过 `MessageServiceDeps{conn, sessions, messages, vfs, checkpoints, revisions}`，能编译；经 bundle 时 `options?.yieldFn` 本来就是 undefined，行为逐字节等价。）

**删 3**——`createProjectService` / `createSessionService` / `createUsageStatsService`（生产 0 引用，nm-code-style §4.1）：

1. 从 `create-chat-services.ts` 删除三个函数；
2. `public/chat.ts` 撤掉这三个导出（保留 `createChatServices` 与 `createMessageService`）；
3. **删掉 `_stubSessionDeps()` 及其注释**，连带删只被它使用的 `Result` import；
4. 测试改写 44 处：`usage-stats.service.test.ts` 38 处 `createUsageStatsService(conn)` → `new DefaultUsageStatsService(conn)`（改一个 import，文件内替换）；`createProjectService` 3 处、`createSessionService` 3 处按测试意图改——测服务行为的直接构造 impl（`new DefaultProjectService({ conn, projects: ..., ... })`），纯测工厂转发的用例直接删（工厂已不存在）。

**yieldFn 决策（已拍板）**：不加 `options` 参数。「编译红再补」这个触发器永远不会触发——`yieldFn` 是 `SqliteMessageRepository` 第二可选参（`sqlite-message.repository.ts:166`），不传走直通同步 map，编译和测试都不会红；分项工厂路径本就从未注入过它。能力缺口以注释记录在 `createMessageService` 上：yieldFn 只由 desktop/mobile 主 runtime 经 bundle 注入，未来若要经 factory 注入再加参。

**阶段 1 验收要点**：

1. `npm test --prefix packages/core`（实为 `node scripts/run-tests.mjs`）全绿；
2. 新增断言「`createMessageService` 不构造 `DefaultProjectService` / `DefaultSessionService`」。**core 没有 jest**（test script = `node scripts/run-tests.mjs`，node:test + tsx，runner 已传 `--experimental-test-module-mocks`；jest 只在 apps/mobile），且 `mock.method` / `jest.spyOn` 都拦不住 `new`——正确写法是 node:test 的 `mock.module`：测试文件在 import `create-chat-services.js` **之前**注册替身（调用即抛错的 class，替换 `DefaultProjectService` / `DefaultSessionService`），调用 `createMessageService(conn)` 后断言计数为 0，再补一条 `instanceof DefaultMessageService` 正向锚定。现成范式：`packages/core/test/agent/agent-runner-compaction.test.ts:53`、`packages/core/test/workplace/assemble-backfill-no-recompress.test.ts:29`。新测试放进 `packages/core/test/service/chat/`（由 run-tests.mjs 统一跑，单独 `node` 跑拿不到 module-mocks flag）；
3. grep 验证：`_stubSessionDeps` 全仓 0 命中；`createProjectService|createSessionService|createUsageStatsService` 在 `packages/core/src` 与 `public/` 0 命中（apps/cli 例外，见 §四）。

### 阶段 2：object namespace 化（P1/P2）

按组做，每组一个 atomic commit。**命名 `XxxFactory`（Java 习惯），方法名用短名**（已拍板）：`create` + 去掉域前缀与 `Service` 冗余后缀；每组一张「现状名 → 方法名」映射表，映射表即命名决策的最终裁定。

优先级与顺序（P1-1 先行的理由：vfs 无 bundle 纠缠、改动最机械，先用它验证 Factory 模式；P1-2 依赖阶段 1 且含 yieldFn 历史包袱与类型迁移，压后降叠加风险）：

| 序 | 组 | Factory 名 | 成员与映射（现状名 → 方法名） | 消费方（生产/测试调用） | 备注 |
|---|---|---|---|---|---|
| P1-1 | `service/vfs` 6 个 | `VfsServiceFactory` | `createVfsService→create`、`createScopedVfsService→createScoped`、`createPhysicalVfsService→createPhysical`、`createVfsBatchIoService→createBatchIo`、`createVfsZipIoService→createZipIo`、`createCharacterCardImportService→createCharacterCardImport` | 49 / 174（223 处，七组之最） | 类型迁移见下方清单；`createVfsService` 不在 public 面（0 生产、42 测试调用） |
| P1-2 | `service/chat` 阶段 1 后剩 5 个 | `ChatServiceFactory` | `createChatServices→createBundle`、`createMessageService→createMessage`、`createChatRepoDeps→createRepoDeps`、`createMessageTranscriptEffectsService→createMessageTranscriptEffects`、`createUserVfsTurnServiceBundle→createUserVfsTurnBundle` | ~17 / ~24 | bundle 语义不变、符号收进 `createBundle`（已拍板）；**不得动 `checkpoint-repo-wiring.ts`（归 P1-3 管）**；消费方按文件分片，每片改完单独 typecheck |
| P1-3 | `service/message-checkpoint` 4 个 | `MessageCheckpointFactory` | `createMessageCheckpointService→create`、`createMessageRollbackService→createRollback`、`createCheckpointRepoDeps→createRepoDeps`、`createTruncateTailDepsFromTx→createTruncateTailDeps`（首参即 tx） | 16 / 26 | **`checkpoint-repo-wiring.ts` 只瘦身不整删**：`truncateTailInTransaction` 与 `TruncateTailDeps`/`TruncateTailParams` 被 service/chat 跨域消费（`message.service.ts:37`、`message-transcript-effects.service.ts:13`）与测试消费，留在原文件；`MessageRollbackServiceOptions` 随迁（唯一外部消费者 `rollback-probe.test.ts` 一行 import；session-fs 刻意不复用它，注释原文「本地定义而非复用」） |
| P2-1 | `service/agent` 4 个 | `AgentServiceFactory` | `createAgentRunner→createRunner`、`createAgentRegistryService→createRegistry`、`createAgentAbortRegistry→createAbortRegistry`、`createAgentStreamRegistry→createStreamRegistry` | 9 / 176 | `CreateAgentRunnerDeps` 随迁（`public/agent.ts:29` re-export 要改源） |
| P2-2 | `service/compaction-conditions` 2 个 | `CompactionFactory` | `createCompactionConditionsStore→createConditionsStore`、`createCompactionConditionEvaluator→createEvaluator` | 6 / 11 | `CompactionConditionEvaluator` 类型随迁：service/agent 4 文件 + `public/compaction.ts:17` + desktop/mobile/cli runtime types 都在消费 |
| P2-3 | `service/provider` 2 个 | `ProviderServiceFactory` | `createProviderServices→create`、`createModelRetryPolicyService→createRetryPolicy` | 4 / 41 | `ProviderServiceBundle` 类型随迁（`public/provider.ts:82` + desktop/mobile runtime types + cli） |
| P2-4 | `infra/sksp/impl` 4 个 | `SkspFactory` | `createAesGcmStrategy`、`createKeyringMasterKey`、`createCompositeSecretStore`、`createEnvSecretStore`（组内无域前缀可去，保持原名） | ~9 / ~10 | **消费图**：只有 sksp-linux / sksp-mac 经 `@novel-master/core/sksp-node` 消费前两个；sksp-android / sksp-windows 不消费这 4 个（windows 只 import `SkspRowBinary`）；desktop/mobile/cli 经 `/sksp` 消费后两个。**双 barrel 约束**：必须同时改 `index.ts` 与 `node.ts`，且 `node.ts` 头注释明令「只对 Node 平台包开放、禁止从 index 再导出」（`node:crypto` 进 RN bundle 会炸）——node 侧符号不得漏进 RN 面（验收 §六.11） |

**类型迁移清单（每组动手前先做，v1 整体漏了这一步）：**

- `CreateVfsBatchIoServiceOptions` / `CreateVfsZipIoServiceOptions`：文件私有（无 export、全仓零外部引用、注释标 @internal 回滚单测专用）——**在新工厂文件里重新声明、不导出**即可；
- `CreateCharacterCardImportServiceOptions`：public 契约（`public/vfs.ts:8`）——随迁到工厂文件并**保留 export 与 public re-export**；
- `CreateAgentRunnerDeps` / `ProviderServiceBundle` / `CompactionConditionEvaluator` / `MessageRollbackServiceOptions`：随各自工厂迁移，改所有消费方 import 源。

每组迁完先跑全仓 typecheck 再动下一个。

**目标形态示例（VfsServiceFactory）：**

```ts
// packages/core/src/service/vfs/vfs-service-factory.ts
export const VfsServiceFactory = {
  create: (conn: TdbcConnection) => new DefaultVfsService({ conn }),
  createScoped: (conn: TdbcConnection, scope: VfsScope) => ...,
  createPhysical: (conn: TdbcConnection) => new DefaultPhysicalVfsService({ conn }),
  createBatchIo: (conn: TdbcConnection, options: CreateVfsBatchIoServiceOptions = {}) => ...,
  createZipIo: (conn: TdbcConnection, options: CreateVfsZipIoServiceOptions = {}) => ...,
  createCharacterCardImport: (conn: TdbcConnection, options: CreateCharacterCardImportServiceOptions = {}) => ...,
} as const;
```

（示例里的方法名是**目标名**——上面的映射表是裁定，不要回填成「现状如此」。）

然后删掉六个 `create-*-service.ts` 原文件（迁移类型之后），`public/vfs.ts` 从 6 行（5 函数 + 1 类型）变成 **2 行**（`VfsServiceFactory` 1 行 + `CreateCharacterCardImportServiceOptions` 1 行）。注意 `createVfsService` 本就不在 public 面，Factory 化它不减 public 行数，只减内部散函数。

## 四、明确不做

- **不改任何 service 实现类**。构造函数、方法、字段一律不动。
- **不合并 `createChatServices` 的 bundle 语义**。多服务共享同一批 repo 的装配形态保留（desktop/mobile runtime 各需一份），但符号收进 `ChatServiceFactory.createBundle`（已拍板）。
- **不改 `public/` 的 exports 子路径**。本 spec 只改符号形态，不改 package.json 的 exports 路径。
- **apps/cli：不改其代码，也不纳入验收**。cli 已从 workspaces 摘除、已停止维护（check-style 的 suppressPrefixes 整体跳过它），root typecheck/test 不覆盖。本 spec 的删除/改名会让 cli 源码引用失效（runtime.ts 的分项工厂调用、`/chat` `/agent` `/compaction` `/sksp` `/provider` 的符号 import），**属预期**；每组 commit message 必须列出该组 cli 受影响符号清单留档，供将来复活时对照。
- **不做「全部 96 个都 namespace 化」**。只做 §三 表里列出的 7 个组。
- **不做「create* 改名以外的重构」**——例外（均为本 spec 范围内的必要附带改动）：阶段 1 的测试改写与 public 撤导出；各组的类型迁移；P1-3 的 `checkpoint-repo-wiring.ts` 瘦身；P2-4 的双 barrel 修改；`public/*.ts` 的 re-export 行调整。

## 五、执行步骤

1. **阶段 1**（一个 commit）：删 3 个分项工厂 + `createMessageService` 直构 + 删 `_stubSessionDeps` + `public/chat.ts` 撤 3 导出 + 44 处测试改写 + 补 `mock.module` 断言。
   - 验收：core 测试全绿 + §三 阶段 1 的三条 grep 验证。
2. **P1-1 `VfsServiceFactory`**（一个 commit）：迁类型 → 新建 factory 文件 → 删六个原文件 → 改 `public/vfs.ts` → 改消费方（生产 49 / 测试 174，按文件分片）。
3. **P1-2 `ChatServiceFactory`**（一个 commit）：成员 5 个；消费方按文件分片（生产 ~17 / 测试 ~24），不碰 `checkpoint-repo-wiring.ts`。
4. **P1-3 `MessageCheckpointFactory`**（一个 commit）：4 个 create* 进 factory，TruncateTail 一族留原文件。
5. **P2 各组**，每组一个 commit；P2-4 严格执行双 barrel 约束。
6. **收敛**：根 typecheck + core/desktop/mobile 全量测试 + check-style（跑法见 §六.5）+ dup-gate（跑法见 §六.6）。
7. **打 tag `p23-create-factory`**。任一项不达标按真实状态提交，tag 用 `p23-create-factory-partial`。

**每组做完立即跑该组消费方的 typecheck**，不要攒到最后。分片一律按文件、生产/测试两维切：大测试文件（agent-runner 系 80 处、usage-stats 系阶段 1 已处理）单独成片。

## 六、验收判据

```
1. 根 typecheck                          exit 0（14 workspace；apps/cli 不在内也不补跑，见 §四）
2. packages/core 全量测试                exit 0
3. apps/desktop 全量测试                 exit 0
4. apps/mobile 全量测试                  exit 0
5. check-style 三段                      signatures / inline / methods 全 PASS（跑法见下；exports 段 FIND 按风险表如实记录）
6. dup-gate                              新增组键 0
7. export function create*（同域 ≥2 的组）  17 组 → 10 组（做完 7 组后；阶段 1 删 3 后 chat 组剩 5 个仍算组）
8. bundle 旁路 0 处                       阶段 1 后见命令 A；P1-2 后见命令 B
9. _stubSessionDeps                      已删除，全仓 0 命中
10. 阶段 1 删掉的 3 个分项工厂            packages/core/src 与 public/ 0 命中（cli 例外）
11. P2-4 双 barrel                        node 侧符号不漏进 index/RN 面
```

**check-style 实际跑法（§六.5）**：脚本在主仓 skill 目录，`repoRoot = process.cwd()`，且 `--all` 硬编码只扫 `packages/core/src`——cwd 必须是目标仓根，三段覆盖要跑三次：

```bash
cd D:/worktree/error-channel-slim
node D:/Dev/Js/novel-master/.agents/skills/nm-code-style/scripts/check-style.mjs --all
node D:/Dev/Js/novel-master/.agents/skills/nm-code-style/scripts/check-style.mjs apps/desktop/src
node D:/Dev/Js/novel-master/.agents/skills/nm-code-style/scripts/check-style.mjs apps/mobile/src
```

**dup-gate 实际跑法（§六.6）**：目标仓 `scripts/` 只有 baseline 没有脚本本体，借主仓跑：

```bash
node D:/Dev/Js/novel-master/scripts/list-dup-signatures.mjs D:/worktree/error-channel-slim --gate
```

baseline 解析到主仓（两仓 baseline 当前同态）；本 spec 合并后建议同步刷新两仓 baseline，避免分叉后 gate 失真。

**第 8 条自检命令：**

```bash
# 命令 A（阶段 1 后）：bundle 只剩定义行
grep -rn "createChatServices(" packages/core/src/service/chat/
# 期望：仅 1 行定义；P1-2 后改验——

# 命令 B（P1-2 后）：createBundle 生产调用恰 2 处（desktop/mobile runtime）
grep -rn "\.createBundle(" --include=*.ts packages/core/src apps/desktop/src apps/mobile/src | grep -v "vfs\|checkpoint\|agent\|sksp"
```

## 七、风险

| 风险 | 缓解 |
|---|---|
| 阶段 1 删分项工厂后，服务间隐性共享状态暴露 | 已核实六个 repo 均无状态（只存 conn + 不可变配置；`SqliteVfsContentStore` 缺省构造无副作用），三个 Default service 构造纯赋值；delete/copy 路径在事务内经 `createChatRepoDeps(tx)` 自建 repo，不依赖实例身份。若测试红，回退该分项并在报告里写明哪个服务有隐性依赖 |
| yieldFn 缺口 | 已拍板不加参：编译/测试都不会红（可选参、缺省直通、分项工厂路径本就 undefined）。缺口以注释记录在 `createMessageService`，未来经 factory 注入再加参 |
| 类型定义在被删/改文件里，直接删文件编译红 | 按各组的类型迁移清单先迁后删；每组迁完先跑全仓 typecheck。`CreateVfsBatchIo/ZipIoOptions` 文件私有零外部引用，重声明即可 |
| sksp node 侧符号漏进 RN 面 | 双 barrel 约束（P2-4 备注）+ §六.11 验收 |
| 测试侧改写量大被低估 | vfs 174 / agent 176 / chat 24 处测试调用——按文件分片，大文件单独成片；判定测试红之前先降并发复跑（nm-code-style §7） |
| Factory 化后 `public/*.ts` re-export 数变化触发 exports 段 DEAD/TEST_ONLY 变化 | 按 check-style 的 exports 段如实记录，不强行清零（该段 FIND 是待办不是假阳性，不是本 spec 验收项） |
| dup-gate baseline 漂移 | gate 借主仓脚本跑、baseline 在主仓；两仓演化分叉后会失真——合并后同步刷新两仓 baseline |
| apps/cli 静默失效 | 预期内（§四）；每组 commit message 列 cli 受影响符号留档 |
| ~~check-oop MANY_EXPORTS 改前就红~~ | 不成立：受影响文件当前最大导出 5 < 阈值 6（`check-oop.mjs:93`；头注释写 ≥8 与代码不一致，已知怪癖），受影响目录现状全 KEEP。namespace 化后 object literal 不进签名记录，只会更干净 |

## 八、附：完整 `create*` 清单与口径

执行者重跑对账（v1 命令漏抓 async，两条都给）：

```bash
# 窄口径（本 spec 全部数字按此口径）：96 个
grep -rn "^export function create[A-Z]" --include=*.ts packages/core/src apps/desktop/src apps/mobile/src \
  | grep -viE "dist[\\\\/]"

# 宽口径（对账用）：102 个 = 96 + 5 个 async + 1 个 .tsx
grep -rnE "^export (async )?function create[A-Z]" --include=*.ts --include=*.tsx packages/core/src apps/desktop/src apps/mobile/src \
  | grep -viE "dist[\\\\/]"
```

窄口径之外的有：`createVfsFile` / `createVfsDirectory`（domain/vfs/logic，async × 2）、`createDesktopNovelMasterRuntime` / `createMobileNovelMasterRuntime`（async）、`createBlankAgent`（async）、`createNotificationPrefBridge`（.tsx）——均不在改造范围，但 domain/vfs/logic 因这 2 个 async 在宽口径下也构成一组。

**形态统计（96 窄口径，TS AST 复核）：**

```
总计                96（core 65 / mobile 27 / desktop 4）
纯壳（1 行+单 new）   8
多个 new（真装配）    27
含 spread 展开       12
参数恰好 1 个        58
```

（v1 的 26/9/53 是 85 漏抓子集上的数字；漏抓 11 个 = 9 个泛型类型参数 + `createCompositeSecretStore` 多行签名 + `createQuantumYield` 箭头返回类型。）

## 九、核查证据（v2 修订依据）

2026-11-19 三波核查工作流（主会话预核查交叉验证）：

| 波次 | 任务 | 关键产出 |
|---|---|---|
| 预核查（主会话） | 清单分组 / chat 链通读 / 调用量口径初查 | 首次发现 mention vs 调用口径分裂、`createVfsService` 不在 public 面 |
| Wave 1（并发 3） | 清单 AST 复核 / 装配链逐字段比对 / 下游消费全图 | 17 组与形态统计复算；阶段 1 代码逐字段可编译；各组生产/测试调用数；类型归属全图 |
| Wave 2（并发 2） | 高严重度独立复核 | 5 条确认、1 条推翻（session-fs 并不消费 `MessageRollbackServiceOptions`）；core 无 jest 实证 |
| Wave 3（1） | 冷读评审 | 8 条新发现（75/86 自相矛盾、判据表缺裁决顺序、§四与 P1-3/P2-4 自相矛盾、check-style 扫描范围盲区等） |

关键实测锚点：生产调用 `createChatServices` 2 外部 + 4 内部、`createMessageService` 1、其余分项工厂 0；grep 窄口径 96；同域 ≥2 组 17 个；vfs 223 调用点（49/174）；`CreateVfsBatchIoServiceOptions` / `CreateVfsZipIoServiceOptions` 文件私有（`create-vfs-batch-io-service.ts:13`、`create-vfs-zip-io-service.ts:13`）；core test runner 传 `--experimental-test-module-mocks`（`run-tests.mjs:147`）。
