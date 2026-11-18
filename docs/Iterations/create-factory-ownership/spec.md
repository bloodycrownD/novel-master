# create-factory-ownership：装配层收口

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p22-public-ownership`（`d3b86ab49`）
> 目标 tag：`p23-create-factory`

## 一、问题诊断

`createXxx` 这类函数目前散落 **85 个**（core 65 / mobile 27 / desktop 4，另有多行参数的约 11 个未被统计脚本抓到）。问题分两层，**第二层才是真问题**。

### 1.1 形态层：散函数替代了命名空间

同一目录下多个 `create*`，**15 个组**：

| 目录 | 个数 | 成员 |
|---|---|---|
| `service/chat` | 8 | `createChatServices` / `createChatRepoDeps` / `createProjectService` / `createSessionService` / `createMessageService` / `createUsageStatsService` / `createMessageTranscriptEffectsService` / `createUserVfsTurnServiceBundle` |
| `infra/llm-protocol/logic` | 7 | `createAnthropicSseParser` / `createGeminiSseParser` / `createOpenAiSseParser` / `createAnthropicToolNameWire` / `createLoggingFetch` / `createSseDispatchState` / `createStreamWatchdog` |
| `service/vfs` | 6 | `createVfsService` / `createScopedVfsService` / `createPhysicalVfsService` / `createBatchIo` / `createZipIo` / `createCharacterCardImport` |
| `service/agent` | 4 | `createAgentRunner` / `createAgentRegistryService` / `createAgentAbortRegistry` / `createAgentStreamRegistry` |
| `service/message-checkpoint` | 4 | `createMessageCheckpointService` / `createMessageRollbackService` / `createCheckpointRepoDeps` / `createTruncateTailDepsFromTx` |
| `infra/sksp/impl` | 4 | `createAesGcmStrategy` / `createCompositeSecretStore` / `createEnvSecretStore` / `createKeyringMasterKey` |
| `domain/abort/logic` | 3 | `createAbortError` / `createAbortRegistry` / `createAbortScope` |
| `apps/mobile/src/services` | 10 | `createCloudSyncProgress` / `createNativeRequestFetch` / `createMobileLlmFetch` / `createRunFinishCalibrationProbe` / `createRunStateWritethrough` / `createTranscriptStreamHandle` / `createSnapshotCompleteSignal` / `createStreamTokenEstimator` / `createSessionStreamTokenEstimator` / `createQuantumYield` |
| `apps/mobile/src/config-forms/agent` | 3 | `createDefaultAgentEditorPrompts` / `createDefaultPersistTextBlock` / `createDefaultDynamicTextBlock` |
| 其余 6 组（各 2 个） | | `service/provider`、`service/compaction-conditions`、`domain/provider/logic`、`infra/tokenizer/logic`、`apps/mobile/src/shims`、`apps/mobile/src/web/shared` |

**对照 Java**：

| Java | 现状 TS |
|---|---|
| `VfsServiceFactory.create(conn)` | `createVfsService(conn)` |
| `VfsServiceFactory.createScoped(conn, scope)` | `createScopedVfsService(conn, scope)` |
| `MessageCheckpointFactory.createRollback(conn, opts)` | `createMessageRollbackService(conn, opts)` |

`create` 被提到函数名最前面，「造什么」退化成字符串后缀。代价：无法一次 import 拿到整个域的装配入口；IDE 输 `create` 出 85 个候选；「这个域怎么装配」没有唯一答案。

**这违反仓库自己的 nm-code-style 5.3**：无状态多函数同类 → object namespace。

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

**调用量实测：**

```
createUsageStatsService  : 40 处
createMessageService     : 24 处
createProjectService     : 11 处
createSessionService     : 11 处
createChatServices       :  2 处生产（desktop runtime / mobile runtime）
```

**75 处调用方只要 1 个服务，却每次都构造 6 个 Sqlite 仓储 + 4 个 Service + 1 个 `_stubSessionDeps()` 假对象，然后扔掉其中 9 个。**

最极端的是 `createUsageStatsService`：

```ts
// 实际需要的：
export class DefaultUsageStatsService implements UsageStatsService {
  private readonly parser = new SqliteTemplateParser();
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

## 二、判据（写进 spec，执行者照此裁决）

一个 `create*` 函数该不该存在、该长什么样：

| 条件 | 处置 |
|---|---|
| 有**第二个消费者**的装配件（如 `createCheckpointRepoDeps` 被 rollback + truncateTail 共用） | 留，进 Factory |
| 有**构造时序/生命周期约束**（如 conn vs tx 必须分造） | 留，进 Factory，注释说明约束 |
| 是 `public/` 面唯一入口、删掉会暴露实现类 | 留，进 Factory，+ `nm-style: keep-public` 注释 |
| 分项工厂经由完整 bundle 取其一 | **必改成直接构造**，不管是否 namespace 化 |
| 只做参数透传给下一个 `create*` | **删**，调用方直接用原对象 |
| 函数体仅 `return new Impl({conn})` 且无非它不可的理由 | 可保留在 Factory 内，但**不得假装有装配逻辑** |

## 三、范围与阶段

**两阶段，阶段 1 消费侧零改动，必须先做且可独立验收。**

### 阶段 1：分项工厂去 bundle 化（P0）

只改 `packages/core/src/service/chat/create-chat-services.ts` 里四个分项工厂的函数体，**签名与函数名一律不变**，消费侧 86 处零改动。

```ts
/** Creates a {@link ProjectService} instance. */
export function createProjectService(conn: TdbcConnection): ProjectService {
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  return new DefaultProjectService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo });
}

export function createSessionService(conn: TdbcConnection, sessionDeps: ChatServicesSessionDeps): SessionService {
  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  return new DefaultSessionService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, state: sessionDeps.state, agentRegistry: sessionDeps.agentRegistry });
}

export function createMessageService(conn: TdbcConnection): MessageService {
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  return new DefaultMessageService({ conn, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, checkpoints: checkpointRepo, revisions: revisionRepo });
}

export function createUsageStatsService(conn: TdbcConnection): UsageStatsService {
  return new DefaultUsageStatsService(conn);
}
```

**删掉 `_stubSessionDeps()` 及其注释**（不再有人需要占位对象）。

**注意**：`createMessageService` 的 `messageRepo` 少了 `options?.yieldFn`，因为原签名就不收 options。若实测需要（`yieldFn` 影响列表解析让步），在签名上加可选 `options?: ChatServicesOptions` 并同步 24 处调用点——**先按不加实现，编译红再补**。

**阶段 1 验收要点**：现有测试全绿 + 新增一条断言「`createUsageStatsService` 不构造 `DefaultProjectService`」（用 jest mock 计数或 spy）。

### 阶段 2：object namespace 化（P1/P2）

按组做，每组一个 atomic commit。**命名 `XxxFactory`（Java 习惯）而非 `XxxServices`，因为它们的职责就是「造」。**

优先级与顺序：

| 序 | 组 | Factory 名 | 是否需改消费方 | 备注 |
|---|---|---|---|---|
| P1-1 | `service/vfs` 6 个 | `VfsServiceFactory` | 是（`public/vfs.ts` + 消费方） | 同域散落最严重 |
| P1-2 | `service/chat` 8 个 | `ChatServiceFactory` | 是（86 处） | 阶段 1 之后再做，避免叠加风险 |
| P1-3 | `service/message-checkpoint` 4 个 | `MessageCheckpointFactory` | 是 | 已有 `createCheckpointRepoDeps` 的复用关系 |
| P2-1 | `service/agent` 4 个 | `AgentServiceFactory` | 是 | |
| P2-2 | `service/compaction-conditions` 2 个 | `CompactionFactory` | 是 | |
| P2-3 | `service/provider` 2 个 | `ProviderServiceFactory` | 是 | |
| P2-4 | `infra/sksp/impl` 4 个 | `SkspFactory` | 是 | 跨包（4 个 sksp 包消费） |
| **不做** | `infra/llm-protocol/logic` 7 个 | — | — | 三协议 SSE parser 是**同名不同构**，package 成一个 Factory 会暗示可互换。保持散函数 |
| **不做** | `domain/abort/logic` 3 个 | — | — | `createAbortError` 是错误工厂不是服务工厂，混在一起语义错 |
| **不做** | `apps/mobile/src/services` 10 个 | — | — | 10 个彼此无关（fetch 适配 / 缓存 / 探针 / 让步），不是同一域 |
| **不做** | `apps/mobile/src/config-forms/agent` 3 个 | — | — | 是 `createDefaultXxx`（默认值构造），不是装配 |

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

然后**删掉六个 `create-*-service.ts` 文件**（若整文件只有那一个函数），`public/vfs.ts` 从 6 行 re-export 变成 1 行。

## 四、明确不做

- **不改任何 service 实现类**。构造函数、方法、字段一律不动。
- **不合并 `createChatServices` bundle 本身**。它存在的理由是「多服务共享同一批 repo」，desktop/mobile 两个 runtime 各需一份，保留。
- **不改 `public/` 的 exports 子路径**。本 spec 只改符号形态，不改包对外路径。
- **不动 `apps/cli`**（已从 workspaces 摘除）。
- **不做「全部 85 个都 namespace 化」**。只做 §三 表里列出的 7 个组。
- **不做 `create*` 改名以外的重构**。函数体除阶段 1 的四个外，一行不动。

## 五、执行步骤

1. **阶段 1**（一个 commit）：改四个分项工厂 + 删 `_stubSessionDeps` + 补一条 spy 断言。
   - 验收：`npm test --prefix packages/core` 全绿，且新断言证明 `createUsageStatsService` 不再构造 `DefaultProjectService`。
2. **P1-1 `VfsServiceFactory`**（一个 commit）：新建 factory 文件 → 删六个原文件 → 改 `public/vfs.ts` → 改消费方。
3. **P1-2 `ChatServiceFactory`**（一个 commit）：同上，消费方 86 处。
4. **P1-3 `MessageCheckpointFactory`**（一个 commit）。
5. **P2 各组**，每组一个 commit。
6. **收敛**：根 typecheck + core/desktop/mobile 全量 + `check-style --all` 三段 + `dup-gate`。
7. **打 tag `p23-create-factory`**。任一项不达标按真实状态提交，tag 用 `p23-create-factory-partial`。

**每组做完立即跑该组的消费方编译**，不要攒到最后——`ChatServiceFactory` 涉及 86 处，攒着会一次性红太多看不出根因。

## 六、验收判据

```
1. 根 typecheck                         exit 0（14 workspace）
2. packages/core 全量测试               exit 0
3. apps/desktop 全量测试                exit 0
4. apps/mobile 全量测试                 exit 0
5. check-style --all 三段               signatures / inline / methods 全 PASS
6. dup-gate                             新增 0
7. export function create*（同域 ≥2 的组）  15 组 → 8 组（做完 7 组后）
8. 分项工厂是否还走 bundle                0 处（`grep "createChatServices(conn" service/chat/` 只剩 bundle 自身定义）
9. _stubSessionDeps                     已删除，全仓 0 命中
```

**第 8 条自检命令：**

```bash
grep -rn "createChatServices(" packages/core/src/service/chat/ | grep -v "export function createChatServices"
# 期望：0 行
```

## 七、风险

| 风险 | 缓解 |
|---|---|
| 阶段 1 改成直接构造后，某个服务间其实有隐性共享状态 | 已核实四个 repo 均无状态（只收 conn + 少量不可变配置）。若测试红，回退该分项并在报告里写明哪个服务有隐性依赖 |
| `createMessageService` 加 `yieldFn` 会改签名，牵连 24 处 | 先不加，看编译/测试是否红；红再补并同步 |
| Factory 化后 `public/*.ts` 的 re-export 数量骤减，可能触发 exports 段 DEAD/TEST_ONLY 变化 | 按 `check-style` 的 exports 段如实记录，不强行清零（该段 FIND 是待办不是假阳性，但不是本 spec 的验收项） |
| 86 处消费方一次改，编译红太多 | 分 3 片（core 内部 / desktop / mobile），每片改完单独 typecheck |
| `check-oop.mjs` 的 MANY_EXPORTS 在改前就红 | 改成 object namespace 后单文件导出数从 N 降到 1，只会变好 |

## 八、附：完整 `create*` 清单（85 个，供执行时核对）

已抓取并落盘，执行者重跑即可：

```bash
grep -rn "^export function create[A-Z]" --include=*.ts packages/core/src apps/desktop/src apps/mobile/src \
  | grep -viE "dist[\\\\/]"
```

**形态统计（本次调研实测）：**

```
总计                85（另约 11 个多行参数未被统计脚本抓到，grep 口径 96）
纯壳（1 行+单 new）   8
多个 new（真装配）    26
含 spread 展开       9
参数恰好 1 个        53
```
