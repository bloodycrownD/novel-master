---
date: 2026-09-28
---

# read 工具结果引用化（read tool result ref）技术规格（SPEC）

需求来源：用户口述（2026-09-28 深夜方案讨论定案：「read 的 tool_result 存引用不存全文，发送提示词时实时查询」）
＋ 上游实测结论（`docs/apm/memory/20260927-worktree-123-verify-guide.md`：read 回显占 tool_result 的 92.5%（41.25MB/44.58MB）、全库精确 hash 重复 86.1%、跨会话重复率来源）
＋ 三路探索报告（消息生命周期 / 消费方全景 / revision 计数与 fork 链路，2026-09-28）。

前置依赖：无硬前置。与 `binary-blob-and-vfs-pack` Part B（VFS 混合打包）**正交可并行**：本方案引用的 revision/blob 若被 Part B 打包进 pack，hydrate 走 content store 统一读口（blob→member 分派）天然兼容——两方案在 `SqliteVfsContentStore.get` 收口处汇合。

---

## 设计目标

**新消息**的 read 工具结果从「消息里存格式化全文」改为「存引用 + 拼装时实时 hydrate 还原 wire 字节」。存量消息不动（不迁移）。

| 项 | 现状 | 改后 |
|---|---|---|
| read tool_result 存储 | `content` = formatReadOutput 全文（压缩落库，单条可达 50KB） | `contentRef` 引用（~200B JSON），`content` 置占位空串 |
| wire（发给 LLM） | content 直出 | hydrate 重放 `formatReadOutput`，**逐字节等值** |
| 跨会话重复读同一文件 | 每次全文各存一份（实测 86.1% 重复） | 多条消息共享同一 revision/blob，**零新增存储**（read 的内容 = 当时 head 的 blob，VFS 本来就存着） |
| 收益 | — | 新增 read 回显的存储 ≈ 0（现状每条约为其明文的 1/2.14 压缩份）；UI 桥载荷变小 |

**非目标**：存量 2409 条旧版纯文本 read 的迁移（无元数据不可定位，后续可选 CAS 兜底，另立课题）；write/edit/grep 等其它工具（回显本来就是小对象或与 VFS 无关）；消息侧块级 CAS 表（本方案用 VFS blob 当现成 CAS——read 内容在 VFS 已有内容寻址副本，不重复存）。

## 关键方案决策（讨论定案 + 探索修正）

1. **引用键用全局键 `(entryId, version)` + 冗余 `contentHash` 校验**——不用 `path`（导入重开 entry 会让 path 重绑新 entryId，实测第二个错位源）、不用裸 `contentHash`（无 revision 锚点则无法挂引用计数保活）。`entryId+version` 是全库全局键，**跨会话直接引用源会话的 revision**。
2. **read 引用是 revision.ref_count 的第三类持有者**（既有两类：checkpoint 指针 + live head）。sweep 谓词（`ref_count <= 0` 删）天然兼容——只要 +1 真实发生过，任何 sweep（消息删除/回滚删尾/会话删除/pull 清场）都不会误删。
3. **fork/复制不改 VFS 复制策略**（原「保留完整历史链」提案被取代）：fork 消息浅拷贝原样保留 `{entryId, version}`（指向**源会话**的 revision），fork 时对源 revision **+1** 即可——blob 全库共享、hydrate 按全局键定位，fork 的 entryId 重映射/head_version 归一/checkpoint 历史复制（探索报告列出的 9 条障碍）全部不需要。fork 后回滚语义维持现状（恢复到 fork 时活树）。
4. **read 执行时同步 +1（先于工具返回）**：堵住「read 返回 → 消息落库」之间的 sweep 窗口——历史 revision 被 GC 后内容不可再生（blob 触发器连带删），必须先占位。方向性取舍：宁多不少（read 后 append 前崩溃会留下 +1 泄漏，由 repair 检测兜底；反向误删则不可恢复）。
5. **pull（模板重置工作区）不释放 read 引用**：被引用的旧 revision/blob 留存到引用消息删除为止（ref_count>0 的孤儿行不会被 `ORPHAN_REVISION_GC_SQL` 删）。消息还在，引用就该活着——存储残留限于低频显式操作，接受。
6. **wire 字节等值是硬约束**：hydrate 必须重放 `formatReadOutput` 的完整输出（6 位行号、offset 起算、50KB 字节帽、截断提示行）。截断管线（`sliceLinesFromOffset` + `capUtf8BytesFill`）是纯函数，ref 自包含全部输入与派生参数（`offset/limit/returnedLines/totalLines/truncated/lastLineTruncated/nextOffset`）保证确定性重放。`formatReadOutput` 列为**冻结函数**（演进需版本化 + 重放一致性测试守护）。
7. **块演进走既有加法式可选字段先例**（ok/summary/meta 同款）：`ToolResultBlock` 新增可选 `contentRef`，`content` 保留 string 类型（引用态置空串）——**不改 content 的类型**（parse 层对非 string content 静默置 `""` 的地雷规避）。legacy 行（无 contentRef、content 有全文）行为完全不变。

## 总体方案

### 数据结构：`contentRef` 块字段

```ts
// content-block.ts — ToolResultBlock 新增可选字段（加法式演进）
interface ReadResultRef {
  path: string;            // 展示用（hydrate 不依赖它定位）
  entryId: number;         // 全局键（源会话的 entry）
  version: number;         // 全局键
  contentHash: string;     // 冗余校验：hydrate 后比对，防版本错位/内容漂移
  totalBytes: number;      // 明文总字节
  offset: number;          // read 的输入参数（1 起始行号）
  limit?: number;          // read 的输入参数
  returnedLines: number; totalLines: number;
  truncated: boolean; lastLineTruncated?: boolean; nextOffset?: number;
}
// ToolResultBlock: { ..., contentRef?: ReadResultRef }
```

引用态 `content = ""`；`ok: true` 与 `summary`（"N lines" / "truncated · N/M lines"）照旧生成（UI 卡片只吃 summary，零改动）。

**三处同步**（parse 丢字段地雷，`failureReason` 已有丢失先例）：`content-block.ts` 接口 + `parse-message-content.ts` tool_result 分支回构白名单 + `apps/desktop/shared/ipc-types.ts` 的 `ContentBlockDto` 镜像（mobile 直接 import core 类型自动跟上）。

### 保活：read 引用计数（第三类持有者）

| 时机 | 操作 | 挂点 |
|---|---|---|
| read 工具执行 | **同步 +1**（工具返回前） | `vfs-tools.ts` read 分支（经 ctx 传 adjustRef 能力）或 buildToolResultBlock 前的 agent-runner 工具执行段 |
| 单条消息删除 | 解析被删消息 blocks 收集 read refs，批量 −1 | `message.service.ts delete` |
| 回滚/abort/批量删尾 | tail 消息的 refs 批量 −1（**先于 sweep**） | `truncate-tail-in-transaction.ts` |
| 会话删除（含子树） | 被删会话全部消息的 refs −1 | `deleteSessionTree` 内（`messages.deleteBySession` 附近；fork 出的**其它**会话的引用不受影响——ref_count 不归零、revision/blob 自动留存） |
| **项目删除** | 被删项目全部会话的消息 refs −1 | **`project.service.ts delete` 的 BFS 展开循环内（`messages.deleteBySession` 之前）——该路径自有事务、不经过 `deleteSessionTree`，是首轮审查抓出的独立挂点（P1）** |
| fork / 会话复制 | 复制消息中的 refs 对**源 revision** 批量 +1 | `message.service.ts fork` / `session.service.ts copy`（消息 batchInsert 后） |
| 置位/压缩/隐藏 | **零操作**（只 UPDATE hidden 列） | — |
| `updateContent`（用户编辑覆写） | 旧 blocks 的 refs −1、新 blocks 的 refs +1（若含） | `message.service.ts updateContent` |
| `message.service.truncateAfter`（公开 API） | 当前无生产调用方（仅 port 接口与测试）；实现时把其删除段收敛到 `truncateTailInTransaction` 共用（自动获得挂点），或单独补 −1——**禁止留无挂点的消息删除面** | `message.service.ts truncateAfter`（L372-429） |
| pull 重置工作区 | **不释放**（决策 5） | — |

计数复用 `batchAdjustRefCountWithDelta`（delta>0 缺行抛 NOT_FOUND 的守护语义正好用于 read +1 的存在性校验）。`repairRefCounts` 的期望值**扩展为三类持有者之和**（checkpoint 指针 + live head + read 引用）——保持只增不减哲学，但让「偏高泄漏」可检测（报告不自动修）。

**已知泄漏窗口**（如实登记）：read +1 已发生但消息未落库（进程崩溃 / agent abort 在 tool 执行后 append 前）→ 无主 +1。abort 截断路径会删已落库消息（其 refs 正常 −1）；未落库的 +1 留待 repair 检测。窗口极小（毫秒级），方向正确（宁多不少）。

### hydrate：wire 字节还原

新模块 `domain/chat/logic/hydrate-tool-results-for-prompt.ts`：

- 输入：消息 blocks；对含 `contentRef` 的 tool_result 块：`revisionRepo.findByEntryAndVersion(entryId, version)` 取明文（内部走 `contentStore.get(contentHash)`，与 Part B pack 读口天然汇合）→ `hashContent(明文)` 与 `ref.contentHash` 比对（不匹配 = 版本错位/数据漂移，fail-fast 报类型化错误）→ 以 `ref.offset/limit` 重放截断管线 → `formatReadOutput` 得 wire 文本 → 填回块 content（**内存态，不写回 content_json**——view-time hydrate 先例：prepare-user-messages-for-prompt 的 attach hydrate 同款纪律）。
- legacy 块（无 contentRef）零处理。
- **接线点**：`prepare-user-messages-for-prompt` 的 tool_result 透传分支（prepare-user-messages-for-prompt.ts:601-612）之后独立一步——LLM 装配主链与 token/压缩 parity 链（`serializePromptLlmInput` → `messageBodyTextFromBlocks`，双端 `session-prompt-input.service` 共用 prepare）**同时受益**，这是探索报告确认的最大结构性便利。
- `normalizeOrphanToolResultsForLlm` 的拍平发生在 hydrate 之后，自动正确。

### 读口扩展（port 缺口）

`VfsService` port 现只有 head read；底层能力已存在（`vfs-revision.port.ts findByEntryAndVersion` 解正文 + `contentStore.get`）。hydrate 直接用 revision repo（不扩 VfsService port——hydrate 是 core 内部拼装逻辑，不需要走 service 层）。

### 消费方处置表（探索报告逐点核实）

| 消费方 | 对 read content 的用法 | 处置 |
|---|---|---|
| LLM 装配（三 mapper） | content 直出（零变换） | **hydrate**（硬约束） |
| token 计数/压缩评估 parity 链 | messageBodyText 含全文 | **hydrate**（与主链共用 prepare，自动） |
| 孤儿 tool_result 拍平 | messageBodyText | **hydrate** 后自动正确 |
| 搜索 keyword 精筛 | **只匹配 text 块**（message-content-match.ts:40-48），tool_result 从不参与 | **零改动** |
| 双端 UI 工具卡 | 摘要链实为 `error.summary → summarizeToolInput(tool_use.input)`（read 必命中 `input.path`）→ `resultContent` 截断兜底；block 的 `result.summary` 不在这条链上 | **零改动**；引用态 content 空串最坏渲染空摘要、不炸——UI 回归用例按「summarizeToolInput 链」断言（勿按 `result.summary` 断言，会踩空） |
| 复制消息 | 只复制 text 块 | **零改动** |
| nmbackup | 整库 SQLite dump（消息+revision+blob 同库） | **零改动**（天然完整） |
| desktop DTO `bodyText` | `messageBodyText(msg)` 含全文，复制 fallback 用 | 引用态输出占位标记（`[read ref: path]` 级别，小改） |
| checkpoint capture / usage-stats / run_state / KKV | 不读 tool_result 内容 | **零改动** |

## 最终项目结构

```
packages/core/src/
  domain/chat/model/content-block.ts                     # ReadResultRef + ToolResultBlock.contentRef
  domain/chat/content/parse-message-content.ts           # tool_result 分支回构白名单 + contentRef
  domain/chat/logic/hydrate-tool-results-for-prompt.ts   # 新（引用→重放 formatReadOutput）
  domain/chat/logic/prepare-user-messages-for-prompt.ts  # 透传分支后接线 hydrate
  domain/tool/builtin/vfs-tools.ts                       # read 输出已含 version；经 ctx 增 adjustRef 挂点
  domain/tool/logic/build-tool-result-block.ts           # read 成功路径产 contentRef 块（content 置空串）
  domain/vfs/logic/revision-ref-count.ts                 # read 引用计数 helper + repair 期望值三类持有者
  domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts  # （若需）按引用批量聚合查询
  service/chat/impl/message.service.ts                   # delete/updateContent/fork 的 −1/+1；truncateAfter 删除段收敛共用
  service/message-checkpoint/logic/truncate-tail-in-transaction.ts # 删尾 −1（先于 sweep）
  service/chat/impl/session.service.ts                   # deleteSessionTree −1；copy +1
  service/chat/impl/project.service.ts                   # 项目删除 BFS 循环内 −1（独立挂点，不经 deleteSessionTree）
apps/desktop/shared/ipc-types.ts                         # ContentBlockDto 镜像 contentRef
apps/desktop/src/main/ipc/handlers/messages.ts           # bodyText 引用态占位
apps/mobile/e2e/fixtures/tool-turn-session.sql           # 加一条 contentRef 形态行（legacy 行保留作兼容样本）
packages/core/test/                                      # T-RR 系列（见测试策略）
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `content-block.ts` + `parse-message-content.ts` + `ipc-types.ts` | ReadResultRef 类型三处同步（parse 丢字段地雷） |
| 2 | `vfs-tools.ts` read 分支 | 输出附 entryId/contentHash/totalBytes（repo 层数据已在，port 透出）；read 执行同步 adjustRef +1 |
| 3 | `build-tool-result-block.ts` | read 成功路径产 contentRef（content=""、ok/summary 照旧） |
| 4 | `hydrate-tool-results-for-prompt.ts`（新）+ `prepare-user-messages-for-prompt.ts` | hydrate 接线（主链 + parity 链同受益） |
| 5 | `revision-ref-count.ts` | read 引用 helper（批量 +1/−1、按 (entryId,version) 去重）；repairRefCounts 期望值扩展三类持有者 |
| 6 | `message.service.ts` + `project.service.ts` | delete −1 / updateContent 换算 / fork +1；**项目删除 BFS 循环内 −1（独立挂点，不经 deleteSessionTree）** |
| 7 | `truncate-tail-in-transaction.ts` | 删尾消息 refs −1（先于 sweepSessionRevisions） |
| 8 | `session.service.ts` | deleteSessionTree −1 / copy +1 |
| 9 | `messages.ts`（desktop IPC） | bodyText 引用态占位标记 |
| 10 | e2e fixture + 测试 | T-RR 系列；fixture 加 ref 形态行 |
| 11 | 文档 | CHANGELOG Unreleased；RULE（read 引用第三类持有者约定、formatReadOutput 冻结约束） |

## 详细实现步骤

- Step 1 — phase-read-ref-schema — blocking: yes — qa: auto：ReadResultRef 三处同步（content-block / parse 白名单 / desktop DTO）+ 块 round-trip 测试（T-RR1、T-RR12）。
- Step 2 — phase-read-ref-tool — blocking: yes — qa: auto：read 输出扩展（entryId/contentHash/totalBytes 透出）+ read 执行同步 +1（T-RR3）+ buildToolResultBlock 产 contentRef 块。
- Step 3 — phase-read-ref-count — blocking: yes — qa: auto：全生命周期计数挂点（单删/删尾/updateContent/会话删的 −1；fork/copy 的 +1；先于 sweep）+ repair 期望值三类化（T-RR4、T-RR13）。
- Step 4 — phase-read-ref-hydrate — blocking: yes — qa: auto：hydrate 模块 + prepare 接线 + contentHash 校验 fail-fast + wire 逐字节等值（全形态：整读/offset/截断/lastLineTruncated）（T-RR2、T-RR11）。
- Step 5 — phase-read-ref-safety — blocking: yes — qa: auto：sweep 保活（read v3→edit v4→删无关消息后 v3 存活）、fork +1、源会话删除后 fork 引用仍活、pull 不释放、导入错位免疫（T-RR5~T-RR9）。
- Step 6 — phase-read-ref-apps — blocking: yes — qa: auto：desktop bodyText 占位 + UI 卡片回归（summary 渲染）+ e2e fixture 双形态 + 压缩/token 口径 parity（T-RR10）。
- Step 7 — phase-read-ref-regression — blocking: yes — qa: auto：core 全量（先重建 dist；重点 agent-run/checkpoint/rollback/fork 套件）+ 双端 + 全仓 typecheck。
- Step 8 — phase-read-ref-verify — blocking: no — qa: manual_user：真机验收——会话内 read 流式往返正常、历史会话打开正常（UI 卡片）、回滚/删除/fork/pull 四场景 hydrate 无缺失、新会话体积观测（连续 read 同一大文件 N 次，消息表增量 ≈ N×ref JSON 而非 N×全文）。

## 测试策略

- T-RR1 — blocking: yes — 块 round-trip：contentRef 全字段经 parse 后逐字段保留（防 parse 丢字段——failureReason 先例）（映射 Step 1）
- T-RR2 — blocking: yes — wire 逐字节等值：hydrate 重放 == 原 formatReadOutput 输出（整读/offset 分页/字节帽截断/lastLineTruncated 四形态）（映射 Step 4）
- T-RR3 — blocking: yes — read 执行同步 +1：工具返回前 ref_count 已 +1（先于任何落库）（映射 Step 2）
- T-RR4 — blocking: yes — 删除对账：单删/回滚删尾/abort 截断/会话删除/**项目删除**五路径的 −1 与消息内 refs 严格相等（同消息重复引用去重）（映射 Step 3）
- T-RR5 — blocking: yes — sweep 保活：「read v3 → edit v4 → 删另一条消息触发 sweep」后 v3 revision/blob 存活且 hydrate 可读（映射 Step 5）
- T-RR6 — blocking: yes — fork +1：fork 后源 revision ref_count 增加对应数量；fork 会话 hydrate 按源 (entryId,version) 定位成功（映射 Step 5）
- T-RR7 — blocking: yes — 源会话删除后 fork 会话引用仍活（deleteSessionTree 后被引用 revision/blob 留存）（映射 Step 5）
- T-RR8 — blocking: yes — pull 不释放：模板 pull 后被引用 revision 留存、消息 hydrate 正常（映射 Step 5）
- T-RR9 — blocking: yes — 导入错位免疫：ZIP/角色卡导入重开 entry 后，旧 entryId 的 read 引用仍定位（revision/blob 保活链）（映射 Step 5）
- T-RR10 — blocking: yes — 压缩/token 口径 parity：parity 链 hydrate 后的字符数与全文口径一致（阈值判定不受影响）（映射 Step 6）
- T-RR11 — blocking: yes — contentHash 校验：人为篡改 revision 内容后 hydrate fail-fast 报类型化错误（不静默发错文）（映射 Step 4）
- T-RR12 — blocking: yes — legacy 兼容：无 contentRef 的存量块读/发/渲染行为逐字节不变（映射 Step 1/6）
- T-RR13 — blocking: yes — repair 期望值三类化：read 引用计入期望值后，构造偏高泄漏可被检测报告（不自动修）（映射 Step 3）

## 风险与回滚方案

- 风险①（最高）：**计数漂移**——挂点多（6 条路径），漏一处 −1 = revision/blob 永久泄漏（无自愈）；漏 +1 = hydrate 悬空（NOT_FOUND fail-fast，消息可读但 wire 缺失）。缓解：T-RR4 严格对账 + repair 三类化检测（T-RR13）+ 方向性选择（宁多不少）。
- 风险②：**+1 泄漏窗口**（read 后 append 前崩溃/abort）——量级毫秒窗口、abort 路径已覆盖已落库消息；残余由 repair 报告。如实接受。
- 风险③：**formatReadOutput 演进导致历史 wire 漂移**——冻结约束 + T-RR2 守护；未来必须改版时 ref 内派生参数足够做版本化重放。
- 风险④：**append 无事务**（消息 INSERT 与计数分离）——现状 append 本就单 INSERT；+1 已前置到工具执行期（风险②方向），−1 路径全在事务内。
- 风险⑤：**双端 bodyText/复制 fallback**——desktop bodyText 占位标记；mobile 无 fallback 路径（探索确认）。
- **与 `binary-blob-and-vfs-pack` Part B 的集成备注（2026-09-29 审查轮确认正交）**：两者在 `contentStore.get` 汇合（本方案的 hydrate → `findByEntryAndVersion` → `contentStore.get`；Part B 改造 `get` 加 member 分派且签名不变）。read 引用保活的 revision（read 后 edit 变历史版本）正是 Part B 的打包候选——打包后 hydrate 走 member 分派读回明文，`ref.contentHash` 比对不受影响；read −1 到 0 → sweep 删 revision → Part B 的孤儿 member 清扫接力回收。任一先上线链路均闭合；**两者都落地后需合跑一次回滚 + fork + checkpoint 套件回归**（记入合并后 QA）。
- 回滚：feature flag 级——buildToolResultBlock 停产 contentRef 块（回退写全文形态），已落库的 contentRef 块继续 hydrate（读路径兼容两形态，永不丢弃）；全量清除需等后续迁移工具（非本期）。

## Context Bundle

```yaml
iteration_name: read-tool-result-ref
requirement_path: 用户口述（2026-09-28 深夜讨论）＋ docs/apm/memory/20260927-worktree-123-verify-guide.md
spec_path: docs/Iterations/read-tool-result-ref/spec.md
explore_summary: >
  read 输出已含 version、缺 entryId/contentHash（repo 层数据在手仅 port 未透出，vfs-service.port.ts:19-24）；
  ToolResultBlock={type,toolUseId,content:string,ok?,summary?,meta?}，content 是 formatReadOutput 格式化文本，
  块演进走加法式可选字段先例、parse 白名单必须三处同步（丢字段地雷有 failureReason 先例）；落库链
  agent-runner:768-816（append 无事务单 INSERT）；wire 链 prepare-user-messages 透传 tool_result + 三 mapper
  直出 content；搜索只匹配 text 块（不消费 tool_result）、UI 卡片只吃 summary（resultContent fallback 对 read
  不可达）、复制只取 text 块、nmbackup 整库 dump——消费面极窄；revision.ref_count=checkpoint 指针+live head
  两类持有者（adjustRef/batchAdjustRefCountWithDelta/repairRefCounts 只增不减），sweep 谓词 ref_count<=0 删，
  「turn 内 read v3→edit v4→checkpoint 只记 v4」的 v3 计数为 0 会被 sweep 删（read 引用第三类持有者的根因）；
  fork=copyVfsTree(新 entryId/head_version=1)+消息浅拷贝+seedForkCopyParity(全 checkpoint 指活树)——read 引用
  全局键直指源 revision + fork +1 即可，无需 fork 保留历史链（9 条障碍全部绕开）；pull=clearCheckpoints→
  sweep，ref_count>0 的 revision 自动留存。
impact_files:
  - packages/core/src/domain/chat/model/content-block.ts
  - packages/core/src/domain/chat/content/parse-message-content.ts
  - packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts (新)
  - packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts
  - packages/core/src/domain/tool/builtin/vfs-tools.ts
  - packages/core/src/domain/tool/logic/build-tool-result-block.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/service/message-checkpoint/logic/truncate-tail-in-transaction.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - apps/desktop/shared/ipc-types.ts + src/main/ipc/handlers/messages.ts
constraints:
  - wire 逐字节等值是硬约束；formatReadOutput 冻结（演进须版本化 + T-RR2 守护）
  - 块字段三处同步（content-block/parse 白名单/desktop DTO），parse 丢字段无告警
  - 计数方向宁多不少（泄漏可检测、误删不可恢复）；−1 必须先于 sweep
  - read 引用全局键 (entryId,version) 跨会话引用源 revision；fork 不改写引用只 +1
  - hydrate 是 view-time（不写回 content_json——attach hydrate 同款先例）
  - repairRefCounts 期望值扩展三类持有者，保持只增不减
  - 与 Part B（vfs-content-pack）正交：hydrate 走 contentStore.get 与 pack 读口天然汇合
  - mobile jest 消费 core dist；新增导出同步 main-entry-allowlist 快照
blocking_steps: [1, 2, 3, 4, 5, 6, 7]
```
