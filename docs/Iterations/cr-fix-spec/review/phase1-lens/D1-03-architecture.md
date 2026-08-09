# D1-03：L3 架构 & 依赖

> 角度横扫报告（readonly）。覆盖源码 import 层面 + monorepo 包描述层面两个维度。
> 依据：`packages/core/ARCHITECTURE.md` + `docs/review/guides/lens-L3-architecture.md`。
> Phase 0 已确认的三类硬违规（domain→service、infra→service、apps 绕过 facade）按指导要求**不重扫**——本报告只做灰色地带与新发现。

## 元信息

- 角度：L3 架构 & 依赖
- 仓库扫描范围：`packages/core/src/`、`packages/*/package.json`、`apps/*/package.json`、根 `package.json`
- 严重度参考：S/A/B/C（见指导文档 §严重度参考）
- 关键交叉文件：`docs/review/phase0/D0-1-code-map.md`

---

## 结论

诶～这份报告最重要的发现，是指导文档本身那条「顶层 index.ts 只有 183 行，负担过重」的前提**已经过时了**。当前代码里其实是一套**两层 facade**——顶层 `src/index.ts` 只暴露纯基础设施（SQL template / TDBC / bootstrap / cloud-sync / 序列化等），而 13 个领域语境各自有一个 `src/public/<ctx>.ts` barrel，通过 `@novel-master/core/<ctx>` 这种 subpath export 对外。apps 的实际消费数据印证了这点：subpath 引用合计 400+ 次（chat 93、vfs 54、provider 39 …），而顶层 index 反而只有少量基础设施代码会走。所以「domain 没有内部 barrel」根本不是问题——因为对外的合同面就放在 `public/`，domain 内部不直接暴露，这正是设计意图。

源码层面 ARCHITECTURE.md 的纪律执行得很干净。三类硬违规 Phase 0 已清零，本轮没发现回归。唯一实质跨 context 引用是 `prompt → chat`——`domain/prompt/logic/normalize-for-llm-export.ts` 引了 chat 的 content 解析与 model 类型，方向单向、语义合理（prompt 组装 LLM export 必须读 chat message 结构），但 ARCHITECTURE.md 的 documented exceptions 没把它列进去，属于「合法但未记录」的灰色地带。god module 候选核查后全部洗清：`connection.port.ts` 只有 46 行、`adapter.port.ts` 108 行、`vfs-path-mapper.ts` 166 行——都是单一职责的端口或原语文件，被广泛引用是 port 的正常现象。真正公共面偏宽的是 `src/public/chat.ts`（377 行，把 composer / annotate / user-vfs-turn 等大量内部 logic 暴露出去），这块要交给 L8 API 角度接手判。

documented exceptions 八条里**有一条已经失效**：第 2 条说 `default-compaction-action.ts` 可以 import `infra/prompt-template` 和 `infra/date-format`——但这个文件已经不存在了，整个 `domain/compaction/` 目录改名叫 `compaction-conditions/`，新目录下没有任何文件 import 那两个 infra 模块。这条例外是历史残留，应该从 ARCHITECTURE.md 里删掉。

包依赖层面问题就比较多啦。最严重的是 core 的 `devDependencies` 里挂了两个下游 driver 包（`@novel-master/tdbc-driver-better-sqlite3` 和 `@novel-master/tokenizer-driver-node`），而这两个 driver 的 `dependencies` 又都声明了 `@novel-master/core` ——这就构成了一条**通过 devDep 形成的事实环**。在 monorepo + workspace 链接的语境下不会真的拉两份 core，但语义上的架构倒置是确实存在的。根 `package.json` 把 `react-native-reanimated` 和 `react-native-worklets` 这两个纯 mobile 运行时依赖挂在了根级别（甚至加了 `overrides` 锁版本），等于让 cli/desktop 也间接背上了 mobile 的依赖图污染。再就是所有 driver / sksp / cloud-sync 包都把 core 放进 `dependencies` 而不是 `peerDependencies`——按可插拔 driver 的设计本意，core 应该是 peer（宿主 app 装哪份 core 就用哪份），现在这样意味着独立发布时会出现「装 driver 强制再装一份 core」的双重安装风险。

整体来说：**源码分层是仓库的系统性优点**（1700+ commit 里少见的纪律性），**包依赖描述是仓库的系统性弱点**（语义错位集中在 driver / core 这条边上）。两边对照看，源码 import 干净不等于包描述干净——这是一个非常典型的「源码纪律领先于包描述纪律」的样本。

---

## 源码维度

### 1. 分层违规：未发现回归

按指导要求未重扫三类已清零违规，仅做交叉验证：随机抽查 `domain/**` 下没有出现 `from '...service...'` 的反向依赖，`apps/**` 下没有出现 `@novel-master/core/(src|dist)` 的私路径 import。**保持清零状态。**

### 2. 灰色地带：prompt → chat 跨 context 引用

`packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts` 第 7–10 行：

```ts
import { messageBodyTextFromBlocks } from "../../chat/content/message-body-text.js";
import { textBlocks } from "../../chat/content/text-blocks.js";
import type { ChatMessage } from "../../chat/model/message.js";
import { readMessageMetadata } from "../../chat/model/message-metadata.js";
```

这条引用的方向是 prompt → chat（prompt 上下文在组装 LLM export 时需要读 chat 消息的 content block 与 metadata），单向、无环。语义上合理——prompt 在物理上必须理解 chat message 的结构才能做 zone 内 merge。ARCHITECTURE.md 的「Documented exceptions」清单目前没有把这条列进去，属于**合法但未记录**。

判定：**B**（open question，建议在 ARCHITECTURE.md 补一条 documented exception，而不是改代码）。

### 3. God module 职责审查

D0-1 列出的「god module 嫌疑」三个文件，逐个读了内容后全部洗清：

| 文件 | 行数 | 引用次数 | 实际职责 | 判定 |
|------|------|---------|---------|------|
| `infra/tdbc/connection.port.ts` | 46 | 80 | TDBC 连接 port 接口声明 | **C** 不是 god module——port 本就该被所有 repo 引用，46 行纯接口 |
| `infra/llm-protocol/ports/adapter.port.ts` | 108 | 36 | LLM 三协议 adapter port | **C** 同上，三协议共用 port 是设计 |
| `domain/vfs/logic/vfs-path-mapper.ts` | 166 | 42 | scope × logical/physical 路径互转 | **C** 单一职责（VfsScope ↔ 物理/逻辑路径映射），6 个 export 全部围绕同一抽象 |

42 次引用分布也合理：vfs 自己（logic/ports/service）占大头，外加 message-checkpoint（5 次，因为 checkpoint 表也要走 vfs 路径解析）、tool（4 次，builtin vfs-tools 用）、workplace、chat 的 scan-at-path 等下游。被多 context 引用是因为 path mapper 是 vfs 的**中心原语**，不是因为职责过载——拆分反而会增加调用方的心智负担。

**真正公共面过宽的是 `src/public/chat.ts`**：377 行，暴露了 chat model/schema/content/logic/service 全栈，包括 composer-draft、annotate-highlight、annotate-source-range、annotate-source-anchor、user-ops-log、user-vfs-turn-view 等大量实现细节。文件中段还有一条注释直接写：「净 diff 模块已退出 public；文件保留并标 @deprecated，仅供过渡期单测直接相对路径引用」——说明已经做过一轮瘦身但还没收尾。这块交给 **L8 API 稳定性** 接手判定哪些 export 可以收回去。

### 4. Documented exceptions 有效性（逐条核对）

ARCHITECTURE.md「Documented exceptions」共 6 条 bullet（覆盖 8 个文件）：

| # | 条款内容 | 当前状态 | 判定 |
|---|---------|---------|------|
| 1 | `domain/*/repositories/impl/sqlite-*.ts` 与 port 同 context | 结构性条款，仍成立——所有 sqlite-*.repository.ts 仍与 *.port.ts 同处 repositories/ | 保留 |
| 2 | `domain/compaction/action/default-compaction-action.ts` 可 import `infra/prompt-template` + `infra/date-format` | **文件已不存在**，目录改名 `compaction-conditions/`，新目录下无任何 infra import | **A 应删除** |
| 3 | `domain/provider/model/saved-model-settings-from-json.ts` 留在 model/ | 文件仍存在，wire 编解码 helper 性质未变 | 保留 |
| 4 | 3 个 infra-internal errors（sksp/sql-template/tdbc） | 3 个文件全部存在，仍是 infra-local 错误 | 保留 |
| 5 | `service/prompt/render-prompt.ts` 单文件 service | 文件仍存在，仍是单文件无 impl/ | 保留 |
| 6 | `domain/vfs/ports/vfs-service.port.ts` 由 service/vfs 实现 | 文件仍存在，builtin vfs-tools 仍只依赖 domain port | 保留 |

**第 2 条是唯一失效的 documented exception**——文件路径整条都过期了，对应的实际功能也消失了（compaction action 的概念被 compaction-conditions 取代）。这条留着的危害不大，但属于规范文档与代码漂移，应该清理。

### 5. 顶层 facade 完整性（重要更正）

> **本节是对指导文档前提的更正**：指导文档说「顶层 index.ts 只有 183 行，负担过重」「domain 缺 barrel，外部消费者通过顶层 facade 间接暴露」——这个判断基于的代码状态已经过时了。

当前实际是**两层 facade**：

**第一层：顶层 `@novel-master/core`**（`src/index.ts`，183 行）——只暴露**纯基础设施**，不碰任何 domain 语境：

| 类别 | 来源 | 暴露内容 |
|------|------|---------|
| SQL template | `infra/sql-template/index.js` | parser、evaluator、ast 等 |
| TDBC | `infra/tdbc/index.js` | open、registerDriver、executeTemplate 等 |
| Bootstrap | `bootstrap/novel-master-bootstrap.js` | bootstrapNovelMaster、SCHEMA_BOOT_VERSION |
| DB backup | `infra/db-backup/index.js` | dump/scrub/restore provider 三表 |
| Cloud sync | `infra/cloud-sync/index.js` | CloudSyncCoordinator、lease 等 |
| KKV / Preferences | `service/persistent-state` + `persistent-preferences` | createPersistentState、preference keys |
| Tool 运行时 | `domain/tool/` | ToolRegistry、ToolRunner、vfs-tools 注册器 |
| 序列化 | `infra/serialization/*` | parseText、stringifyText、decode、encode |

注意顶层 index 暴露了 `domain/tool/` 下的 builtin（`createVfsTools`、`registerBuiltinTools`）——这是唯一从顶层直接走的 domain 内容，原因是 tool runtime 被当成「跨语境基础设施」看待。除此之外顶层 index **完全不碰** chat/vfs/agent/prompt 这些领域语境。

**第二层：分语境 barrel `@novel-master/core/<ctx>`**（`src/public/<ctx>.ts`，13 个文件）：

`agent`、`chat`、`compaction`、`events`、`feature-flags`、`format`、`message-checkpoint`、`prompt`、`provider`、`regex`、`session-fs`、`vfs`、`workplace` ——每个文件聚合该语境对外的 model/schema/logic/service factory。`package.json` 的 `exports` 字段把这两个层次都登记了，apps 全部走 subpath import。

**apps 实际用量分布**（按 `from '@novel-master/core/<ctx>'` 计数）：

| subpath | 引用次数 | 说明 |
|---------|---------|------|
| chat | 93 | 最大消费方，与 public/chat.ts 377 行的宽度匹配 |
| vfs | 54 | path mapper + service factory + zip io |
| provider | 39 | provider/saved-model 配置 |
| agent | 38 | agent definition + registry |
| config-forms | 34 | 跨语境配置表单 |
| workplace | 31 | worktree 概念（已 rename） |
| events | 26 | event 配置 |
| prompt | 18 | prompt layout + render |
| regex | 15 | regex rule/group |
| compaction | 11 | 压缩条件 |
| kkv | 10 | 全局 KV |
| message-checkpoint | 8 | 检查点 |
| session-fs | 8 | session 文件系统 |
| feature-flags | 7 | 特性开关 |
| session-kkv | 6 | session 级 KV |
| sksp | 5 | secret store（走 infra/sksp/index） |
| format | 5 | 格式化 |

合计 **407 次** subpath import。对比之下，顶层 `@novel-master/core`（裸 import）在 apps 里出现次数很少（主要是 cli 入口、runtime 装配、test helper）。

**判定**：
- facade 设计本身是健康的，分语境 barrel 是对的方向。
- **B（轻微）**：`src/public/chat.ts` 377 行偏宽，把 composer/annotate/user-vfs-turn 等实现细节大量暴露——和 L8 有交叉。
- **B（轻微）**：顶层 `index.ts` 暴露了 `preference-keys.ts`、`workspace-state-keys.ts` 这类**实现细节常量**（如 `KEY_CURRENT_PROJECT_ID`、`PREF_KEY_*`），这些更像是内部存储格式而非公共 API；apps 直接读这些 key 绕过 PersistentState 抽象，存在耦合泄漏。

### 6. domain context 缺 barrel 的影响

domain 内部确实没有 `domain/<ctx>/index.ts`（按指导 §Phase 0 已确认）。但这不是问题——因为对外的合同面统一在 `src/public/<ctx>.ts`，domain 内部文件不直接对外（外部消费者走 subpath export，包 `exports` 字段严格控制）。这种「内部不 barrel，外部用专门 public 层」的结构反而避免了 re-export 链过长。

---

## 包依赖维度

### 异常清单

| # | 异常 | 严重度 | 现状 |
|---|------|-------|------|
| P1 | core `devDependencies` 含下游 driver 包 | **S** | `packages/core/package.json` 第 126–127 行：`@novel-master/tdbc-driver-better-sqlite3` + `@novel-master/tokenizer-driver-node` 都在 devDep。core 测试需要具体 driver 来跑，但制造了 core → driver 反向边，与 driver → core 正向边叠加成事实环 |
| P2 | 根 `package.json` 挂 mobile 专属运行时依赖 | **A** | 根 `dependencies`（第 42–45 行）：`react-native-reanimated` + `react-native-worklets`；还在 `overrides` 里锁了版本。这两个是纯 RN 运行时依赖，cli/desktop 间接背锅 |
| P3 | 所有 driver / sksp / cloud-sync 包把 core 放 `dependencies` 而非 `peerDependencies` | **A** | 详见下表 P3-1。按可插拔 driver 设计，core 应是 peer |
| P4 | `tdbc-driver-rn` 把 `better-sqlite3` 放 devDep | **B** | 第 29 行：`better-sqlite3` + `@types/better-sqlite3` 在 devDep，但 RN 端运行时是 `react-native-quick-sqlite`（已 peer）。better-sqlite3 出现在这里只是为了 Node 端跑 conformance test，符号混淆 |
| P5 | typescript 版本分裂 | **B** | 根 `^6.0.3` vs 多个子包（mobile/sksp-android/tokenizer-driver-rn）`^5.8.3`，独立安装时双重安装风险 |
| P6 | `tdbc-conformance` 在两个 driver devDep 里 | **B** | `tdbc-driver-better-sqlite3` + `tdbc-driver-rn` 都 devDep 它；conformance 自己 dep core，又增加一条 driver → conformance → core 的弱边 |

#### P3-1：driver / sksp / cloud-sync × core 摆放位置

| 包 | core 在哪个字段 | 应该在 | 备注 |
|---|---|---|---|
| `tdbc-driver-better-sqlite3` | dependencies | peerDependencies | TDBC driver 设计就是可插拔 |
| `tdbc-driver-rn` | dependencies | peerDependencies | 同上 |
| `tokenizer-driver-node` | dependencies | peerDependencies | NMTP driver 同理 |
| `tokenizer-driver-rn` | dependencies | peerDependencies | 同上 |
| `sksp-android` | dependencies | peerDependencies | secret store 实现，宿主自选 |
| `sksp-mac` | dependencies | peerDependencies | 同上 |
| `sksp-windows` | dependencies | peerDependencies | 同上 |
| `cloud-sync-driver-s3` | dependencies | peerDependencies | cloud sync driver 同理 |

7 个包全部用 dependencies 而非 peer——这是**系统性偏差**而非个例。

### 包依赖图：@novel-master/* × core × 是否成环

| 包 | 该包依赖 core 的方式 | core 依赖该包的方式（含 devDep） | 是否成环 | 严重度 |
|----|---------------------|-------------------------------|---------|-------|
| `@novel-master/core` | — | devDep: tdbc-driver-better-sqlite3、tokenizer-driver-node | — | — |
| `tdbc-driver-better-sqlite3` | **dependencies** | core devDep → 它 | **是（devDep 环）** | **S** |
| `tdbc-driver-rn` | **dependencies** | 无 | 否 | A（应为 peer） |
| `tokenizer-driver-node` | **dependencies** | core devDep → 它 | **是（devDep 环）** | **S** |
| `tokenizer-driver-rn` | **dependencies** | 无 | 否 | A（应为 peer） |
| `sksp-android` | **dependencies** | 无 | 否 | A（应为 peer） |
| `sksp-mac` | **dependencies** | 无 | 否 | A（应为 peer） |
| `sksp-windows` | **dependencies** | 无 | 否 | A（应为 peer） |
| `cloud-sync-driver-s3` | **dependencies** | 无 | 否 | A（应为 peer） |
| `tdbc-conformance` | dependencies | 间接（被两个 driver devDep 引用，driver 又 devDep 引 core） | **弱环** | B |

**两条 devDep 环的具体路径**：

```
core ──devDep──► tdbc-driver-better-sqlite3 ──dependencies──► core
core ──devDep──► tokenizer-driver-node ──dependencies──► core
```

在 npm workspace + 本地 link 语境下，环不会真的拉两份 core（workspace 把 `"*"` 解析到本地目录）。但语义上仍是架构倒置——一旦未来这些包独立发布到 npm（private 标记移除），或者切换到 pnpm strict 模式，环会立刻暴露成 install 错误。**这是本轮发现的唯一 S 级问题**。

### 包维度与源码维度的互相印证

| 现象 | 源码层 | 包描述层 | 关系 |
|------|-------|---------|------|
| driver → core 依赖方向 | 源码干净（driver 只 import core 的 port） | core 在 dependencies 而非 peer | 包描述比源码更宽松 |
| core → driver 反向边 | 源码无（core 不 import driver） | devDep 建立了一条源码层不存在的边 | 包描述制造了源码看不见的环 |
| apps → core 私路径 | 0 命中 | apps 在 dependencies 声明 core | 两层一致 |
| `prompt → chat` 跨 context | 源码有 | 包内 import，无 package.json 表达 | 两层维度不适用（包内部） |

---

## 必须的两张表

### 表 1：源码依赖关系总览（Top 10 被引用文件）

> 数据来源：D0-1 §3 + 本轮核查。去重后真实热点，排除 types/index 等重名聚合。

| 排名 | 文件 | 行数 | 被引用次数 | 引用方分布 | 性质判定 |
|------|------|------|----------|-----------|---------|
| 1 | `infra/tdbc/connection.port.ts` | 46 | 80 | 所有 sqlite repo impl + service | C port 被广泛依赖是设计预期 |
| 2 | `infra/llm-protocol/ports/adapter.port.ts` | 108 | 36 | openai/anthropic/gemini 三协议 adapter | C 三协议共用 port，符合设计 |
| 3 | `domain/vfs/logic/vfs-path-mapper.ts` | 166 | 42 | vfs（自身最大）+ message-checkpoint(5) + tool(4) + chat(3) + workplace(2) + service(vfs/workplace/agent/events/session-fs) | C 单一职责原语，非 god module |
| 4 | `domain/vfs/ports/vfs-entry.port.ts` | — | 28 | vfs repo + service + tool builtin | C vfs 持久化入口 |
| 5 | `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` | — | 24 | vfs service + 自家 logic | C vfs repo 实现，documented exception §1 允许同 context |
| 6 | `domain/chat/model/message.ts` | — | 44（聚合） | chat 自身 + prompt(跨 context) + service | C message 类型，被消费正常 |
| 7 | `service/chat/message.port.ts` | — | 22 | service/chat 内部 + apps 消费 | C service port |
| 8 | `infra/sql-template/template-helper.ts` | — | 22 | bootstrap + 各 sqlite repo | C SQL 模板复用 |
| 9 | `errors/vfs-errors.ts` | — | 22 | vfs 全栈 + tool + apps | C 包级 error 文件 |
| 10 | `domain/vfs/ports/vfs-service.port.ts` | — | 17 | service/vfs + tool builtin + apps | C documented exception §6，builtin vfs-tools 只依赖 domain port |

**结论**：Top 10 全部是 port / 错误文件 / 持久化 repo——都是端口型文件被广泛引用的预期模式，**没有真正的 god module**。vfs 占 5 席验证了 vfs 是耦合热点（与 D0-1 持久化分布一致），但热点都在端口上、不在实现上，分层是健康的。

### 表 2：包依赖图异常（@novel-master/* × core × 是否成环）

| 包 | 该包对 core 的依赖声明 | core 对该包的依赖声明 | 是否成环 | 偏离 | 严重度 |
|----|---------------------|---------------------|---------|------|-------|
| `@novel-master/core` | — | devDep: 2 个 driver | — | devDep 含下游 | S |
| `tdbc-driver-better-sqlite3` | dependencies | core devDep → 它 | **成环（devDep）** | core 应是 peer；环 | S |
| `tdbc-driver-rn` | dependencies | 无 | 否 | core 应是 peer；better-sqlite3 误进 devDep | A |
| `tokenizer-driver-node` | dependencies | core devDep → 它 | **成环（devDep）** | core 应是 peer；环 | S |
| `tokenizer-driver-rn` | dependencies | 无 | 否 | core 应是 peer | A |
| `sksp-android` | dependencies | 无 | 否 | core 应是 peer | A |
| `sksp-mac` | dependencies | 无 | 否 | core 应是 peer | A |
| `sksp-windows` | dependencies | 无 | 否 | core 应是 peer | A |
| `cloud-sync-driver-s3` | dependencies | 无 | 否 | core 应是 peer | A |
| `tdbc-conformance` | dependencies | 间接（被 driver devDep 引） | 弱环 | 共享测试套件定位合理 | B |

**7 个可插拔 driver / sksp / cloud-sync 包全部把 core 放进 dependencies 而非 peerDependencies**——这是 monorepo 包描述最大的系统性偏差。

---

## 待交叉的线索

| 本报告发现 | 可能交叉的角度 | 交叉点 |
|-----------|--------------|-------|
| `src/public/chat.ts` 377 行暴露过宽（含 composer/annotate/user-vfs-turn 实现细节 + @deprecated 残留） | **L8 API 稳定性** | L8 判定哪些 export 已被外部实际使用、哪些可以收回 |
| 顶层 `index.ts` 暴露 `preference-keys` / `workspace-state-keys` 实现细节常量 | **L8 API 稳定性** | apps 是否真的需要直接读这些 key，还是该走 PersistentState 抽象 |
| `prompt → chat` 跨 context 合法但未记录 | **L1 数据模型** | L1 验证 prompt 是否真的需要理解 chat message 内部结构 |
| typescript 版本根 6.0.3 vs 子包 5.8.3 分裂 | **L10 工程化基建** | 双重安装风险归 L10 主导 |
| driver 全部用 dependencies 而非 peer | **L6 跨端** | 三端独立打包时，core 是否会被打进 driver bundle（影响包体） |
| core devDep 环 / 根 package.json mobile 污染 | **L10 工程化基建** | install 行为、CI 拓扑排序受影响 |
| `vfs-path-mapper` 42 次引用分布到 6 个 context | **L1 数据模型** | message-checkpoint / chat / workplace 都依赖 vfs 路径解析，验证语义是否合理 |

---

## open_questions（交给 phase3）

1. **prompt → chat 跨 context 引用**：是否补入 ARCHITECTURE.md 的 documented exceptions？建议补——避免未来 review 反复怀疑这条。
2. **`src/public/chat.ts` 瘦身**：377 行暴露面是否需要收窄？需 L8 配合判定外部真实使用面。
3. **documented exception §2 清理**：`default-compaction-action.ts` 已不存在，是否直接从 ARCHITECTURE.md 删除该条？
4. **driver → core 改 peer**：7 个包同时把 core 从 dependencies 改成 peerDependencies，需要相应在 apps 端补 explicit dependencies（apps 都已经声明了 core，所以改动安全）；是否启动这个一次性整改？
5. **core devDep 解环**：把 `tdbc-driver-better-sqlite3` 和 `tokenizer-driver-node` 从 core 的 devDep 移出后，core 的测试用什么 driver 跑？可能需要把 core 的 driver-dependent 测试迁移到 `tdbc-conformance` 包或单独的集成测试 workspace。
6. **顶层 `index.ts` 暴露 preference/workspace keys**：是否把这些常量收回 PersistentState 抽象背后？
