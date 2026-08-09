# D0-1：代码地图 & 依赖分析

## 元信息
- 仓库：novel-master monorepo
- 侦察日期：2026-08-05
- 侦察范围：`packages/core/src` + `apps/{cli,desktop,mobile}` + 外部 driver packages

---

## 1. 模块体量排名

### `packages/core/src/` 顶层（总量）

| 层 | 文件数 | 行数 |
|----|--------|------|
| domain | 265 | 22 562 |
| service | 108 | 9 768 |
| infra | 101 | 7 120 |
| bootstrap | 28 | 2 661 |
| config-forms | 20 | 1 216 |
| public | 13 | 999 |
| errors | 17 | 894 |
| types | 1 | 17 |

domain 占总量近半，service 次之，infra 第三。bootstrap 体量集中在 `schema-migrations/`。

### `domain/<context>` 体量（Top 10 + 持久化标记）

| 排名 | context | 文件 | 行数 | 有持久化 | 备注 |
|------|---------|------|------|----------|------|
| 1 | chat | 65 | 6 797 | ✅ chat-schema | 双巨头之一，content/model/repositories 全栈 |
| 2 | vfs | 51 | 5 512 | ✅ 3 张表 | 双巨头之一，content-store + revision |
| 3 | tool | 14 | 1 727 | ❌ | 纯逻辑（registry/runner/builtin） |
| 4 | provider | 32 | 1 652 | ✅ provider-schema | model/saved-model/provider 三套 |
| 5 | workplace | 18 | 1 468 | ✅ workplace-schema | worktree/agent 配置 |
| 6 | message-checkpoint | 13 | 1 207 | ✅ message-checkpoint-schema | checkpoint + rollback |
| 7 | prompt | 12 | 1 006 | ❌ | 模板组装，依赖 chat |
| 8 | agent | 14 | 752 | ✅ agent-schema | 定义 + session |
| 9 | regex | 12 | 727 | ✅ regex-schema | 规则引擎 |
| 10 | character-card | 7 | 572 | ❌ | 纯解析 |
| 11 | events-config | 4 | 305 | ❌ | 事件配置 DAG |
| 12 | compaction-conditions | 7 | 195 | ❌ | 纯触发条件计算 |
| 13 | session-kkv | 4 | 185 | ✅ session-kkv-schema | KV 存储 |
| 14 | depth | 3 | 161 | ❌ | 深度切片计算 |
| 15 | kkv | 4 | 105 | ✅ kkv-schema | 通用 KV |
| 16 | events | 1 | 94 | ❌ | 事件总线 |
| 17 | format | 3 | 65 | ❌ | 格式化 |
| 18 | feature-flags | 1 | 32 | ❌ | 标志位 |

**观察**：
- `chat`（6 797）和 `vfs`（5 512）合计 12 309 行，占 domain 总量 55%——双巨头
- `compaction-conditions` 只有 195 行，但迭代频次很高（见 D0-2），「小代码大复杂度」的典型
- `session-kkv` + `session-fs` + `kkv` 是三个 KV 相关 context，可能存在职责重叠
- 有持久化的 context：chat、vfs（3 表）、provider、workplace、message-checkpoint、agent、regex、session-kkv、kkv、sksp（通过 bootstrap/sksp）

### `service/<ctx>` 体量

| 排名 | service | 文件 | 行数 |
|------|---------|------|------|
| 1 | vfs | 15 | 2 076 |
| 2 | agent | 15 | 1 684 |
| 3 | chat | 14 | 1 672 |
| 4 | provider | 11 | 875 |
| 5 | message-checkpoint | 6 | 550 |
| 6 | events | 6 | 538 |
| 7 | workplace | 5 | 503 |
| 8 | prompt | 3 | 396 |
| 9 | regex | 3 | 287 |
| 10 | compaction-conditions | 4 | 217 |
| 11 | persistent-preferences | 4 | 204 |
| 12 | persistent-state | 4 | 198 |
| 13 | template | 4 | 141 |
| 14 | events-config | 3 | 124 |
| 15 | session-kkv | 4 | 113 |
| 16 | session-fs | 3 | 111 |
| 17 | kkv | 4 | 79 |

**观察**：
- service 顺序与 domain 基本一致（vfs/chat/agent 是 service 三大）
- `persistent-preferences` 和 `persistent-state` 是两个独立 service，但都封装 KKV——可能职责重叠

### `infra/<capability>` 体量

| 排名 | infra | 文件 | 行数 |
|------|-------|------|------|
| 1 | llm-protocol | 29 | 3 596 |
| 2 | sql-template | 12 | 938 |
| 3 | tokenizer | 16 | 747 |
| 4 | cloud-sync | 8 | 532 |
| 5 | tdbc | 9 | 313 |
| 6 | prompt-template | 3 | 226 |
| 7 | sksp | 7 | 221 |
| 8 | db-backup | 3 | 147 |
| 9 | serialization | 5 | 143 |
| 10 | nmtp | 4 | 103 |
| 11 | events | 1 | 62 |
| 12 | kkv | 1 | 20 |

**观察**：
- `llm-protocol`（3 596）独占鳌头，承载了 OpenAI/Anthropic/Gemini 三协议 + SSE 流式 + abort + partial blocks
- `tokenizer`（747）和 `nmtp`（103）分开，nmtp 是 driver 协议层
- `events` 在 infra 下只有 62 行，但 domain/events 有 94 行，service/events 有 538 行——事件编排集中在 service 层

### `bootstrap/<ctx>` 体量

| 排名 | bootstrap | 文件 | 行数 |
|------|-----------|------|------|
| 1 | schema-migrations | 11 | 2 033 |
| 2 | vfs | 3 | 127 |
| 3 | schema-align | 2 | 118 |
| 4 | provider | 2 | 67 |
| 5 | chat | 1 | 39 |
| 6 | message-checkpoint | 1 | 36 |
| 7 | workplace | 1 | 35 |
| 8 | regex | 1 | 35 |
| 9 | session-kkv | 1 | 16 |
| 10 | sksp | 1 | 15 |
| 11 | kkv | 1 | 14 |
| 12 | agent | 1 | 14 |
| 13 | session-fs | 1 | 7 |

**观察**：
- `schema-migrations`（2 033 行 / 11 文件）是 bootstrap 大头，全是版本化迁移脚本（带 v1 后缀）
- vfs schema 拆成 3 文件：vfs-schema、vfs-content-blob-schema、vfs-revision-schema——三张表的 DDL 分离
- 迁移脚本列表：drop-chat-session-user-vfs-pending-v1、provider-identity-v1、rename-worktree-tables-to-workplace-v1、saved-model-identity-v1、session-agent-config-v2、vfs-content-blob-zlib-v1、vfs-entry-id-redesign-v1、vfs-revision-ref-count-v1
- 历史痕迹明显：rename-worktree→workplace、drop-*-pending、session-agent-config-v2

### 三端 app 体量

| app | 文件 | 行数 |
|-----|------|------|
| apps/mobile | 284 | 35 766 |
| apps/desktop | 75 | 7 192 |
| apps/cli | 54 | 4 010 |

**观察**：
- mobile（35 766 行）是 desktop 的 5 倍、cli 的 9 倍——这是 L6 跨端一致性角度的核心张力
- mobile 还有独立的 android/ Kotlin 代码（5 个 kt/java 文件）
- 跨端 parity 的不对称性可能很大：mobile 上的逻辑很多没在 desktop/cli 上验证过

---

## 2. 分层违规扫描

### 违规一：domain → service（ARCHITECTURE.md 禁止）

**结果：0 命中。**

扫描方法：在 `packages/core/src/domain/**/*.ts` 下搜 `from '...service...'`。零命中，说明 domain 不反向依赖 service。这一条 ARCHITECTURE.md 的红线执行得很干净。

### 违规二：infra → service（ARCHITECTURE.md 禁止）

**结果：0 命中。**

同上，infra 也不反向依赖 service。

### 违规三：绕过 index.ts 的私路径 import

**结果：0 命中（apps/ 和外部 packages 均无）。**

扫描了 `apps/**/*.ts`、`apps/**/*.tsx`、`packages/**/*.ts` 下 `from '@novel-master/core/(src|dist)/'` 的引用——零命中。所有外部消费者都走 `@novel-master/core` 公共面。

### 违规四：domain 内部跨 context 私路径 import

**结果：极少（仅 1 处实质跨 context）。**

扫描了 domain 下所有相对路径 import。41 个 `../../` 级别的引用中，绝大多数是 repo impl 引用自己 context 的 `model/` / `schema.ts` / `*.port.ts`（ARCHITECTURE.md 明确允许）。

**唯一实质跨 context**：`domain/prompt/logic/normalize-for-llm-export.ts` → `domain/chat/`

```
import { messageBodyTextFromBlocks } from "../../chat/content/message-body-text.js";
import { textBlocks } from "../../chat/content/text-blocks.js";
import type { ChatMessage } from "../../chat/model/message.js";
import { readMessageMetadata } from "../../chat/model/message-metadata.js";
```

prompt → chat 的跨 context 引用。prompt 依赖 chat 的 content 解析和 model 类型。语义上合理（prompt 组装需要 chat 消息），但 ARCHITECTURE.md 没把这条列为 documented exception——L3 角度需要确认是否应补一条说明。

### 分层违规总评

**ARCHITECTURE.md 的依赖纪律执行得非常好**。四类硬违规扫描全清零。这是 1700+ commit 里难得的系统性优点——说明分层规则被严格维护了。

唯一的灰色地带是 prompt → chat 的跨 context 引用，但这不是「违规」而是「未被记录的合法依赖」。

---

## 3. God Module 候选（高频被引用文件）

按 import 文件名频次统计（含路径去重前的原始计数，名字独特的可信度高）：

| 文件名（去扩展） | 被引用次数 | 说明 |
|-----------------|----------|------|
| types | 875 | 重名聚合（多个 types.ts），不可信 |
| index | 376 | barrel 文件聚合，正常 |
| chat | 104 | chat context 的 barrel，正常 |
| **connection.port** | **80** | TDBC 连接 port——**真实热点** |
| vfs | 79 | vfs context 聚合 |
| agent | 73 | agent context 聚合 |
| errors | 62 | 多个 errors 文件聚合 |
| events | 51 | 事件相关聚合 |
| provider | 47 | provider context 聚合 |
| message | 44 | message 相关聚合 |
| **vfs-path-mapper** | **42** | 单一具体文件被引用 42 次——**god module** |
| adapter.port | 36 | LLM adapter port，正常 |
| workplace | 35 | workplace context 聚合 |
| **vfs-entry.port** | **28** | VFS entry port——**热点** |
| content-block | 27 | content block 定义 |
| prompt | 25 | prompt context 聚合 |
| **sqlite-vfs-entry.repository** | **24** | VFS repo 实现——**热点** |
| provider-errors | 23 | provider 错误 |
| message.port | 22 | message service port |
| template-helper | 22 | SQL template helper |
| vfs-errors | 22 | vfs 错误 |
| message-attachment.schema | 21 | schema 文件 |
| agent-definition | 20 | agent 定义 |
| session-kkv.port | 20 | session kkv port |
| message-checkpoint.port | 19 | checkpoint port |
| agent-prompt-layout | 19 | agent prompt layout |
| depth-slice | 18 | depth 切片 |
| vfs-service.port | 17 | vfs service port |

### God Module 结论

去重后真正的 god module（独特名字 + 高引用）：

1. **`connection.port`（80 次）**：TDBC 连接抽象，是所有 repo 实现的基础依赖。符合设计（port 本就该被广泛依赖），但 80 次说明它是单点耦合核心。
2. **`vfs-path-mapper`（42 次）**：单一具体文件被引用 42 次——这是真正的 god module 嫌疑。一个路径映射工具被 vfs 几乎所有文件引用，说明路径解析是 vfs 的中心枢纽。
3. **`vfs-entry.port`（28 次）** + **`sqlite-vfs-entry.repository`（24 次）**：vfs 持久化的核心入口，被大量 service 依赖。
4. **`message.port`（22 次）**：消息 service port，符合预期。

vfs 有 3 个文件在 Top 30（vfs-path-mapper / vfs-entry.port / sqlite-vfs-entry.repository）——验证了 vfs 是耦合热点的判断。L3 架构角度应重点关注 vfs-path-mapper 的职责是否过载。

---

## 4. 循环依赖检测

**结果：无 domain context 之间的循环依赖。**

扫描方法：构建 domain context 间的依赖邻接表（A context 的文件 import 了 B context 的文件 → A→B 边）。

domain 内部跨 context import 极少（见 §2），唯一一条是 `prompt → chat`。单向依赖，无环。

domain → infra 的依赖（ARCHITECTURE.md 允许）需要后续验证是否成环，但当前未发现 domain→infra→domain 的回链。

---

## 5. 持久化分布

### DDL 文件与表分布

| schema 文件 | CREATE 语句数 | 对应 context |
|------------|--------------|-------------|
| vfs-entry-id-redesign-v1.ts（迁移） | 9 | vfs（迁移脚本，重设计 entry id） |
| chat-schema.ts | 4 | chat |
| workplace-schema.ts | 4 | workplace |
| provider-identity-v1.ts（迁移） | 4 | provider（迁移） |
| regex-schema.ts | 3 | regex |
| vfs-schema.ts | 3 | vfs |
| message-checkpoint-schema.ts | 3 | message-checkpoint |
| provider-schema.ts | 3 | provider |
| vfs-content-blob-zlib-v1.ts（迁移） | 2 | vfs（content blob 压缩） |
| vfs-revision-schema.ts | 2 | vfs（revision） |
| session-kkv-schema.ts | 2 | session-kkv |
| saved-model-identity-v1.ts（迁移） | 2 | provider（saved model） |
| rename-worktree-tables-to-workplace-v1.ts（迁移） | 2 | workplace（rename） |
| drop-chat-session-user-vfs-pending-v1.ts（迁移） | 2 | chat/vfs（清理 pending） |
| agent-schema.ts | 1 | agent |
| kkv-schema.ts | 1 | kkv |
| sksp-schema.ts | 1 | sksp |
| vfs-content-blob-schema.ts | 1 | vfs（blob） |

### 持久化 context 清单

有 SQLite 持久化的 context（10 个）：
- **vfs**（3 张表：entry、revision、content-blob）—— 持久化最复杂
- **chat**（messages、sessions、projects 等）
- **provider**（provider、saved-model、model-suggestion）
- **workplace**（worktree/agent 配置）
- **message-checkpoint**（checkpoint）
- **agent**（agent-definition）
- **regex**（rule、group）
- **session-kkv**（session 级 KV）
- **kkv**（全局 KV）
- **sksp**（secret store 元数据）

无持久化的 context（纯计算/编排）：compaction-conditions、prompt、tool、events、events-config、depth、format、feature-flags、character-card

### 迁移脚本历史线索

`schema-migrations/` 下的 8 个迁移脚本揭示了重大设计变更：
- `rename-worktree-tables-to-workplace-v1` —— worktree 概念整体改名为 workplace
- `vfs-entry-id-redesign-v1`（9 个 CREATE）—— vfs entry id 大重设计
- `drop-chat-session-user-vfs-pending-v1` —— 清理 chat/session/user-vfs 的 pending 状态
- `session-agent-config-v2` —— session agent config 升 v2
- `vfs-content-blob-zlib-v1` —— content blob 加 zlib 压缩
- `vfs-revision-ref-count-v1` —— revision 加引用计数

这些都是「反复改过」的证据，vfs 和 session/agent config 是 schema 变更最频繁的区域。

---

## 6. 测试覆盖分布

| 测试目录 | 测试文件数 | 对应 src 行数 | 测试密度 |
|---------|----------|-------------|---------|
| infra | 52 | 7 120 | 1 测试/137 行 |
| chat | 49 | 6 797 | 1/139 |
| vfs | 31 | 5 512 | 1/178 |
| provider | 26 | 1 652 | 1/64（密） |
| agent | 18 | 752 | 1/42（密） |
| message-checkpoint | 17 | 1 207 | 1/71 |
| workplace | 17 | 1 468 | 1/86 |
| tool | 13 | 1 727 | 1/133 |
| prompt | 13 | 1 006 | 1/77 |
| service | 12 | — | — |
| bootstrap | 7 | 2 661 | 1/380（稀） |
| config-forms | 6 | 1 216 | 1/203 |
| character-card | 4 | 572 | 1/143 |
| events | 4 | 94 | 1/24（密） |
| **regex** | **3** | **727 + 287 service** | **1/338（极稀）** |
| **compaction-conditions** | **3** | **195 + 217 service** | 1/137 |
| events-config | 3 | 305 | 1/102 |
| depth | 2 | 161 | 1/80 |
| cloud-sync | 2 | 532 | 1/266（稀） |
| **session-kkv** | **1** | **185 + 113** | 1/298（极稀） |
| **kkv** | **1** | **105 + 79** | 1/184 |
| sksp | 1 | 221 | 1/221 |
| persistent-* | 各 1 | — | — |

### 测试覆盖盲区（L7 角度重点）

**测试极稀疏模块**（核心逻辑但测试不足）：
- `regex`：727 行核心引擎 + 287 service，只有 3 个测试文件——**严重不足**
- `cloud-sync`：532 行，2 个测试——同步逻辑是数据安全核心，测试不够
- `session-kkv` + `kkv`：基础 KV 存储，测试极少
- `bootstrap`：2 661 行 schema/migration，只有 7 个测试——迁移正确性风险高
- `compaction-conditions`：触发条件计算是核心，只有 3 测试

**测试密度健康的**：provider、agent、events、message-checkpoint、prompt

---

## 7. 初步观察（叙述式）

整体来看，这个仓库的**架构纪律执行得相当好**——分层违规扫描全清零，循环依赖不存在，外部消费者都走公共面。这是 1700+ commit 沉淀下来的难得优点，说明 `core-package-structure` 和 `core-architecture-style` 这两个迭代建立了有效约束并被持续遵守。

但体量分布极不均衡。**chat（6 797 行）和 vfs（5 512 行）是双巨头**，合计占 domain 一半多。更关键的是 vfs 有 3 张表、3 个 god module（`vfs-path-mapper` 42 次引用、`vfs-entry.port` 28 次、`sqlite-vfs-entry.repository` 24 次），加上 12+ 个相关 Iteration——vfs 是整个仓库复杂度最集中的区域。chat 紧随其后，且 prompt 依赖 chat 的 content 解析，形成 chat→prompt 的单向链。

`schema-migrations` 揭示了频繁的设计变更：worktree→workplace 整体改名、vfs-entry-id 大重设计（9 个 CREATE）、session-agent-config 升 v2、vfs content blob 加压缩。这些都是「没想清楚就改、改完再改」的痕迹，对应 Iteration 里的 vfs-version-redesign、storage-schema-alignment 等。

测试覆盖两极分化：provider/agent/events 测试密度健康，但 regex（3 测试覆盖 1 000+ 行）、cloud-sync、session-kkv、bootstrap 的测试严重不足。regex 引擎是核心逻辑之一，测试稀少是显著风险。

mobile（35 766 行）远超 desktop（7 192）和 cli（4 010），这种不对称意味着很多逻辑只在 mobile 上跑过——跨端 parity 风险集中在 mobile vs 其余两端。

下一步 D0-2 会基于体量 + 引用密度 + Iter 摇摆度，对模块打分定稿 phase2 切片候选。
