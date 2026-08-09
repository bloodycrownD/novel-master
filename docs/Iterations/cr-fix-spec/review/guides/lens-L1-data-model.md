# L1：数据模型 & 持久化

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**数据模型和持久化**这一个角度扫遍 `packages/core` 全部模块。

## 你的一句话职责

查清这个仓库里**数据长什么样、存在哪、怎么读写、schema 和代码对不对得上**。你只看这一件事，别去管并发、架构分层、算法复杂度——那些有别的角度负责。

## 你的独有抓手

以下问题只有你这个角度能抓到，别的角度看不到：

- **一实体多张表**：同一个业务概念（比如 message）被设计成多张表，可能是因为迭代过程中没做 schema 合并
- **schema 与 domain model 漂移**：zod schema 定义了一套字段，但 TypeScript type 或运行时代码用的是另一套
- **缺索引**：热查询路径上没有对应索引，或者索引建了但查询没用上
- **N+1 查询**：循环里发起 SQL 查询，而不是批量取
- **migration 不幂等**：bootstrap/migration 脚本重跑会出问题
- **归一化不一致**：同一个值在不同表里格式不同（比如时间戳一处用毫秒一处用秒）
- **软删除 vs 硬删除语义混乱**：有的表有 deleted flag，有的直接 DELETE，同一套业务里混着用

## Phase 0 已确认的数据模型现实

Phase 0 侦察已定位全部 schema 文件和表分布，**不需重复发现**：

### 已知 schema 文件（13 个，均在 bootstrap/<ctx>/ 下）

| schema 文件 | CREATE 数 | 表/通途 |
|------------|----------|--------|
| `bootstrap/vfs/vfs-schema.ts` | 3 | vfs entry 主表 |
| `bootstrap/vfs/vfs-revision-schema.ts` | 2 | vfs revision 表 |
| `bootstrap/vfs/vfs-content-blob-schema.ts` | 1 | vfs content blob 表 |
| `bootstrap/chat/chat-schema.ts` | 4 | messages/sessions/projects 等 |
| `bootstrap/provider/provider-schema.ts` | 3 | provider/saved-model/model-suggestion |
| `bootstrap/workplace/workplace-schema.ts` | 4 | worktree/agent 配置（原 worktree，后 rename） |
| `bootstrap/message-checkpoint/message-checkpoint-schema.ts` | 3 | checkpoint 表 |
| `bootstrap/regex/regex-schema.ts` | 3 | rule/group |
| `bootstrap/session-kkv/session-kkv-schema.ts` | 2 | session 级 KV |
| `bootstrap/agent/agent-schema.ts` | 1 | agent-definition |
| `bootstrap/kkv/kkv-schema.ts` | 1 | 全局 KV |
| `bootstrap/sksp/sksp-schema.ts` | 1 | secret store 元数据 |
| `bootstrap/session-fs/session-fs-schema.ts` | ? | session 文件系统（与 session-kkv 可能重叠） |

### 已知迁移脚本（8 个，均在 bootstrap/schema-migrations/ 下，均带 v1/v2 后缀）

- `vfs-entry-id-redesign-v1`（9 个 CREATE，最大迁移）— vfs entry id 大重设计
- `provider-identity-v1`（4 CREATE）— provider 身份重构
- `rename-worktree-tables-to-workplace-v1`（2 CREATE）— worktree→workplace 整体改名
- `saved-model-identity-v1`（2 CREATE）— saved-model 身份
- `session-agent-config-v2` — session agent config 升 v2
- `vfs-content-blob-zlib-v1`（2 CREATE）— content blob 加 zlib 压缩
- `vfs-revision-ref-count-v1` — revision 加引用计数
- `drop-chat-session-user-vfs-pending-v1`（2 CREATE）— 清理 pending 状态

### 有/无持久化的 context（已确认）

**有持久化（10 个）**：vfs（3 表）、chat、provider、workplace、message-checkpoint、agent、regex、session-kkv、kkv、sksp

**无持久化（纯计算/编排）**：compaction-conditions、prompt、tool、events、events-config、depth、format、feature-flags、character-card

### 重叠嫌疑（L1 重点查）

- **session-fs vs session-kkv vs kkv**：三个 KV 相关 context。session-fs 是文件系统 session，session-kkv 是 session 级 KV，kkv 是全局 KV。职责是否重叠？
- **vfs 3 表设计**：entry/revision/content-blob 分表是否有必要？content-blob 为什么要独立表（且加了 zlib 压缩）？

## 读什么文件

### 核心目标

| 目录 | 看什么 |
|------|--------|
| `packages/core/src/bootstrap/*/` | 13 个 schema 文件的 DDL（清单见上） |
| `packages/core/src/bootstrap/schema-migrations/` | 8 个迁移脚本，查幂等性、是否可重跑 |
| `packages/core/src/bootstrap/schema-align/` | schema 对齐逻辑 |
| `packages/core/src/domain/*/model/*.schema.ts` | zod schema 定义 |
| `packages/core/src/domain/*/model/*.ts` | TypeScript 类型定义 |
| `packages/core/src/domain/*/repositories/` | repo port + sqlite 实现 |
| `packages/core/src/domain/*/repositories/impl/` | SQL 查询实现 |
| **重叠重点**：`bootstrap/session-fs/` + `bootstrap/session-kkv/` + `bootstrap/kkv/` | 职责重叠判定 |

### grep 模式

```text
# 找所有 DDL
include: "packages/core/src/bootstrap/**/*.ts"
regex: "CREATE\s+(TABLE|INDEX|VIEW)|ALTER\s+TABLE"

# 找所有 zod schema 定义
include: "packages/core/src/domain/**/*.ts"
regex: "z\.(object|string|number|boolean|array|enum|union|optional|literal)\s*\("

# 找所有 repo 文件
include: "packages/core/src/domain/**/*.ts"
regex: "\.repository\.ts$"  # 用 find_path 找文件名

# 找 SQL 查询
include: "packages/core/src/domain/**/impl/**/*.ts"
regex: "SELECT|INSERT|UPDATE|DELETE\s+FROM"

# 找 N+1 嫌疑（循环 + 查询）
include: "packages/core/src/**/*.ts"
regex: "(for|while|forEach|map|reduce).*\n.*\.(query|get|find|select|fetch)\s*\("
```

## 相关 Iterations

这些迭代直接和数据模型/持久化相关，**必须读**它们的 prd.md / spec.md 来理解设计意图：

**高优先（必读）：**
- `storage-schema-alignment` — schema 对齐，当前 bootstrap/schema-align/ 的来源
- `message-checkpoint-v2` — message checkpoint 表结构重设计
- `vfs-revision-storage-optimize` — vfs revision 存储优化
- `vfs-version-redesign` — vfs 版本模型重设计
- `persistent-state-and-preferences` — 持久化偏好
- `message-visibility` — 消息可见性（可能涉及 flag 列）
- `message-set-floor` — 消息设定下限

**中优先（扫读）：**
- `agent-config-shape` — agent 配置的数据结构
- `global-config-system` — 全局配置体系
- `stored-config-validity` — 存储配置校验
- `session-kkv` / `kkv` — key-value 存储
- `chat-workspace-agent-sync` — 工作区同步涉及的数据模型

## 典型问题清单 & 检查手法

### 1. 一实体多张表
**怎么查**：把 bootstrap 里所有 CREATE TABLE 按业务概念分组。如果发现「message」「msg」「chat_message」分属不同表，或者 vfs 的 revision 有多张结构相似的表，就是嫌疑。

**判定标准**：如果两张表的字段重叠 >60%，且没有明确 spec 说明为什么要分开，标 A。

### 2. schema 与 type 漂移
**怎么查**：对每个 context 的 `model/`，对比 `*.schema.ts`（zod）和 `*.ts`（TypeScript type）。字段名、可选性、类型（string vs number）是否一致。

**判定标准**：字段不一致且无注释说明，标 A；只在边界条件（null vs undefined）不一致，标 B。

### 3. migration 幂等性
**怎么查**：读 `schema-migrations/` 和 `schema-align/` 的每个脚本，看有没有 `IF NOT EXISTS`、`CREATE TABLE IF NOT EXISTS`。如果是裸 `CREATE TABLE`，重跑会炸。

**判定标准**：不幂等且没有防重跑机制，标 A。

### 4. N+1 查询
**怎么查**：在 repo impl 里找「先查一个列表，再循环查详情」的模式。特别注意 message、vfs-revision、agent-config 这些容易有层级关系的实体。

**判定标准**：确认在热路径（用户可见的加载路径）上，标 A；只在冷路径（初始化/迁移），标 B。

### 5. 软/硬删除混用
**怎么查**：grep `DELETE FROM` 和 `deleted` / `hidden` / `visible` flag。看同一个 context 内是否混用了两种删除语义。

**判定标准**：同一 context 内混用且没有 spec 说明，标 A。

## 与其他角度的潜在冲突

你最容易和这些角度打架，先想清楚你的立场：

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L4 错误处理** | 你说「schema 合理」，L4 可能说「多步写没事务」 | 你的职责是评判 schema 设计本身，不带事务视角；冲突交给 phase3 裁决 |
| **L5 并发** | 你说「flag 列设计合理」，L5 可能说「flag 更新有竞态」 | 同上——你只评模型，不评并发 |
| **L3 架构** | 你说「这张表归这个 context」，L3 可能说「这个 context 不该有持久化」 | 如果 L3 说对了，你的发现升级为 A |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-01-data-model.md`。

在「结论」节，用叙述式讲清楚这个仓库的数据模型整体健康度——**不要一上来就列表**。先讲你的整体判断（比如「消息持久化经过多次迭代，schema 碎片化明显，vfs revision 的存储模型和 domain type 存在系统性漂移」），再展开具体发现。

在「发现清单」节，每条发现标严重度（S/A/B/C）+ 涉及模块 + 涉及文件。

在「待交叉的线索」节，明确写出你直觉会和哪个角度冲突、冲突点是什么——这能帮 phase3 快速定位交叉区。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 多张表存储同一实体且无合并机制（系统级） |
| **A** | schema 与 type 系统性漂移；migration 不幂等；N+1 在热路径 |
| **B** | 单个字段不一致；冷路径 N+1；缺非关键索引 |
| **C** | 命名不统一（snake_case vs camelCase 混用）；注释缺失 |
