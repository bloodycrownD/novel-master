---
zone: d-readref-adv
agent: advocate（辩护人）
files_scanned:
  - packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts
  - packages/core/src/domain/tool/logic/build-tool-result-block.ts
  - packages/core/src/domain/tool/logic/skill-read-truncation.ts
  - packages/core/src/domain/chat/model/content-block.ts
  - packages/core/src/domain/chat/content/parse-message-content.ts
  - packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts
  - packages/core/src/domain/tool/builtin/vfs-tools.ts
  - packages/core/src/domain/tool/builtin/skill-tool.ts
  - packages/core/src/domain/tool/builtin/builtin-tool-context.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts
  - packages/core/src/service/agent/logic/run-agent-turn.ts
  - packages/core/src/service/agent/impl/agent-runner.ts
  - packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts
  - packages/core/src/service/chat/create-user-vfs-turn-service.ts
  - packages/core/src/service/vfs/impl/vfs.service.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts
  - packages/core/src/domain/tool/logic/format-tool-output.ts
  - packages/core/src/domain/prompt/model/prompt-render-context.ts
  - apps/desktop/shared/ipc-types.ts
  - apps/desktop/src/main/ipc/handlers/messages.ts
  - apps/desktop/src/main/services/session-prompt-input.service.ts
  - apps/mobile/src/services/session-prompt-input.service.ts
  - apps/cli/src/runtime.ts
  - docs/apm/RULE.md
  - docs/Iterations/read-tool-result-ref/spec.md
  - packages/core/test/{chat/hydrate-tool-results,chat/read-ref-prompt-parity,chat/skill-result-ref,tool/read-tool-result-ref,vfs/read-ref-count,vfs/read-ref-safety,service/agent/read-ref-production-smoke}.test.ts
---

## 摘要

v1.5.29 的「read 工具结果引用化」链：read / skill read / skill load 的 `tool_result`
不再存 `formatReadOutput` 全文，改存 `contentRef`（全局键 `(entryId, version)` +
冗余 `contentHash` + 自包含截断入参），发送提示词前 view-time hydrate 逐字节重放
wire 文本。`revision.ref_count` 的持有者从两类（checkpoint 指针 + live head）扩为三类，
新增 read 引用。链路 = 工具执行期同步 +1 → `buildToolResultBlock` 产引用块 →
`parse-message-content` 白名单三处同步 → `prepare-user-messages` 接线 hydrate →
六条删除路径 −1（先于 sweep）+ fork/copy 对源 revision +1 → `repairRefCounts` 期望值
三类化检出偏高泄漏。**辩护立场：这套实现在设计取舍、挂点覆盖、单源纪律、测试牙口上
都站得住，下面逐条给理由，同时如实列出 6 条让步。**

## 职责与边界

- **产出侧**：`vfs-tools.ts` read 分支、`skill-tool.ts` load/read 分支在**工具返回前**
  同步 `+1` 并把「head 定位三件套」放进输出；`build-tool-result-block.ts` 见到三件套
  即产 `contentRef` 块（`content` 置空串）。
- **存储侧**：`content-block.ts` 类型 + `parse-message-content.ts` 白名单回构 +
  `apps/desktop/shared/ipc-types.ts` DTO 镜像，三处必须同步（丢字段无告警）。
- **消费侧**：`hydrate-tool-results-for-prompt.ts` 在 `prepare-user-messages-for-prompt.ts`
  尾部接线，先于 `normalizeOrphanToolResultsForLlm`；主链与 token/压缩 parity 链共用
  prepare，自动同口径。
- **计数侧**：`revision-ref-count.ts` 提供 `collectReadRefs` / `aggregateReadRefs` /
  `adjustReadRefCount` / `aggregateReadRefsFromAllMessages` / `repairRefCounts`。
- **不在本区**：VFS 存储格式、pack（Part B）、消息压缩、UI 卡片渲染链本体。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `ToolResultBlock.contentRef?: ReadResultRef \| SkillResultRef` | content-block.ts:59 | 加法式可选字段；`content` 保持 `string`（引用态空串） |
| `ReadResultRef` | content-block.ts:100-128 | `kind?: "read"`（缺省即 read）+ path/entryId/version/contentHash/totalBytes/offset/limit/returnedLines/totalLines/truncated/lastLineTruncated?/nextOffset? |
| `SkillResultRef` | content-block.ts:145-186 | `kind: "skill"` + `action: "load"\|"read"` + domain/name/files |
| `hydrateToolResultsForPrompt` | hydrate-tool-results-for-prompt.ts:323 | view-time；内存新对象，不写回 `content_json` |
| `ReadResultHydrateError` / `ReadResultHydrateErrorCode` | 同上 :69-94 | 四码 fail-fast：REPO_MISSING / REVISION_MISSING / CONTENT_DELETED / HASH_MISMATCH |
| `collectReadRefs` / `aggregateReadRefs` / `adjustReadRefCount` | revision-ref-count.ts:72 / 98 / 131 | 消息内去重、消息间累加；挂点两侧共用同一口径 |
| `aggregateReadRefsFromAllMessages` | revision-ref-count.ts:166 | repair 用；全库口径（read 引用跨会话） |
| `repairRefCounts(..., readRefs?)` | revision-ref-count.ts:275 | 期望值三类化；`overExpected` 只报告不自动修 |
| `resolveReadRefCountChannel` | run-agent-turn.ts:201 | +1 通道单点收口：显式注入优先，否则从 `revisionRepo` 推导 |
| `deriveSkillReadTruncation` / `deriveSkillLoadTruncation` | skill-read-truncation.ts:54 / 115 | 执行期与 hydrate 期**共用同一纯函数**（单源） |
| `BuiltinToolContext.adjustRevisionRefCount?` | builtin-tool-context.ts:234 | 可选注入；未注入即 legacy 全文回落 |

## 数据访问

| 资源 | 位置 | 性质 |
|---|---|---|
| `vfs_revision.ref_count` | sqlite-vfs-revision.repository.ts:426 `batchAdjustRefCountWithDelta` | 应用层维护；delta>0 缺行抛 NOT_FOUND（存在性校验），delta<0 命不中 no-op |
| `vfs_revision.content_hash` / `status` | 同上 :154 `findMetaByEntryAndVersion` | hydrate 零解码前置校验；schema CHECK 保证 active 行 hash 非空（vfs-revision-schema.ts:25） |
| `vfs_content_blob.ref_count` | vfs-revision-schema.ts:33-67 触发器 | **只由触发器维护**；`batchRepairRefCountFloor` 只改 `ref_count` 不改 `content_hash`，触发器不 fire，双计数器不重复计数 |
| `chat_message.content_json` | sqlite-message.repository.ts:263 `listBySession` / :285 `listBySessionFromSeq` | 删除路径收集 refs（两处**都不带 hidden 过滤**，hidden 消息的 refs 也被计入 −1，与「隐藏零操作」不冲突——隐藏不减、删除才减） |
| 全库 `chat_message` 扫描 | revision-ref-count.ts:169-177 | 仅 repair 路径；解析失败逐行 skip（期望值偏保守 = floor 不下调） |
| 进程内解压内容池 | infra/content-cache（8MB / 1024 entries 上限） | `contentStore.get` 命中即免解压；与 hydrate 的调用内 memo 叠加 |

## 依赖关系

**import 谁**

- hydrate → `format-tool-output`（冻结 formatter）、`skill-read-truncation`（单源推导）、
  `tool-output-limits`（`sliceLinesFromOffset` / `capUtf8BytesFill` / `truncateLine` / `capUtf8Bytes`）、
  `vfs-revision.port`（**只取 port，不扩 VfsService**）。
- `revision-ref-count` → `parse-message-content` + `message-content-codec`（压缩行解码）+ `integrity-repair`（类型）。
- `build-tool-result-block` → `content-block`（类型）+ `format-tool-output` + `skill-tool-ref`。
- chat 域**不反向依赖 builtin**：`skill-read-truncation` 落在 `domain/tool/logic/` 就是为了
  打破这条反向边（该文件头注释明确写了这条约束）。

**被谁消费**

- `prepare-user-messages-for-prompt` → agent-runner（LLM 主链）+ 双端
  `session-prompt-input.service`（token/压缩 parity 链）→ `buildPromptLlmInputFromLayout`。
- `message.service` / `session.service` / `project.service` / `truncate-tail-in-transaction`
  → 删除与复制的 6 条挂点。
- `createRevisionRefCountRepairOperation` → **仅测试**（见 D-6 让步）。

## 辩护理由清单

### B-1 「先 +1 后引用」的方向性取舍是本设计最重要的正确决策

`vfs-tools.ts:237-247` 把 +1 放在**工具返回前**，`build-tool-result-block.ts:456-491`
凭「输出带 entryId ⟺ +1 已发生」产引用块。这条不变式把「有引用无计数」（hydrate 悬空、
LLM 收到空 tool_result）这个致命故障在结构上消灭了，而不是靠事后对账。

```
// vfs-tools.ts:241-247
const refAnchored = hasRefAnchor && ctx.adjustRevisionRefCount != null;
if (refAnchored) {
  await ctx.adjustRevisionRefCount([{ entryId: raw.entryId!, version: raw.version }], +1);
}
```

反向的漏 −1（消息删了但计数没落）只是存储泄漏；正向的漏 +1 是内容不可再生。两类错误
完全不对称，所以「宁多不少」不是省事，是唯一正确的方向。RULE.md:29 与 spec 决策 4
都把这句写成了显式拍板，实现与拍板逐字一致。**置信 confirmed。**

### B-2 六个删除挂点全覆盖，且 −1 一律先于 sweep

我逐条核对了全仓所有会删 `chat_message` 行的面（`git grep "DELETE FROM chat_message"` +
`deleteBySession` + `deleteAfterSeq` + `messages.delete`），确认**不存在无挂点的删除面**：

| 挂点 | 位置 | 先于 sweep？ |
|---|---|---|
| 单条删除 | message.service.ts:249 | 是（sweep 在 :263） |
| updateContent 换算 | message.service.ts:292-303 | 同事务内，无 sweep |
| fork +1 | message.service.ts:385-389 | — |
| truncateAfter 清空 / 截尾（两分支） | message.service.ts:491 / :531 | 无 sweep 段 |
| 回滚 / abort 删尾（共享事务） | truncate-tail-in-transaction.ts:81-85 | **是**（sweep 在 :95，注释把位置约束写成硬约束） |
| 会话树删 | session.service.ts:224-230 | — |
| 项目删（BFS 独立挂点） | project.service.ts:176-182 | — |
| copy +1 | session.service.ts:399-403 | — |

spec 变更点清单第 6 条特别点出「项目删除 BFS 循环内 −1 是首轮审查抓出的独立挂点」，
实现确实在 `messages.deleteBySession` 之前、且在**该路径自有事务内**（不经过
`deleteSessionTree`）补了挂点。这说明首轮 CR 的意见被完整吸收，不是「spec 写了但实现漏了」。

实测：`npx tsx --test test/vfs/read-ref-count.test.ts test/vfs/read-ref-safety.test.ts`
→ **15 pass / 0 fail**，T-RR4 五路径 + T-RR13 两例 + T-RR5~T-RR9 全绿。**置信 confirmed。**

### B-3 fork / copy 的「浅拷贝 + 对源 +1」是全方案里最漂亮的一处简化

spec 决策 3 记录了原始提案（「fork 保留完整历史链」）被推翻的过程——那条路要处理
entryId 重映射、head_version 归一、checkpoint 历史复制共 9 条障碍。改成
「消息浅拷贝原样保留 `(entryId, version)` 指向源会话 revision，fork 时对源 +1」之后，
9 条障碍全部不需要，而且 `copyVfsTree` 造出来的新 entryId 与消息里的旧 entryId
天然解耦（消息引用的本就是**源**会话的 revision）。

实测 T-RR6 / T-RR7 都通过：fork 后源 revision `ref_count` 按持有消息数 +1、fork 会话
按源键 hydrate 成功；`deleteSessionTree` 删源会话后被引用 revision/blob 留存。
这直接消灭了「源会话一删，fork 出来的会话就 hydrate 悬空」这个最反直觉的故障模式。

### B-4 hydrate 的校验链选的是「零解码前置比对」而不是「重算 SHA-256」，且损失面已如实登记

2026-09-29 性能修复轮把完整性校验从「对还原明文重算 sha256」（34KB/块 ≈ 0.27ms，
100 块 ≈ 27ms，占单次 hydrate 约 1/4）降为「比对 `revision.content_hash` 元数据列」。
hydrate-tool-results-for-prompt.ts:24-41 的文件头把三条论证和**损失面**都写了：
adler32 兜传输损坏、元数据比对挡版本错位、「同时改 blob 明文与其 hash 字段」的双改
等价于一条合法的另一版数据（且旧实现同样骗得过）。

我核对了 `vfs-revision-schema.ts:25` 的 `CHECK (NOT (status = 'active' AND content_hash IS NULL))`
——active 行的 `content_hash` 非空是 schema 约束，所以元数据比对不存在「active 行缺指纹」
的漏网（hydrate-tool-results.test.ts:575 有专门用例钉这条）。同时
`sqlite-vfs-content-store.ts:80-86` 有进程内内容寻址解压池（8MB/1024 条上限），
与 hydrate 的调用内 memo 叠加，重复引用的解码成本已被压到接近零。

spec 的「实现期补充」段如实写了损失面（「blob 键不变、压缩字节被刻意重编码」不再可检，
需 DB 写权限，本地单用户威胁模型外）。**这是诚实的降本，不是掩盖。置信 confirmed。**

### B-5 「不做跨调用持久缓存」是刻意的安全取舍，不是性能疏忽

hydrate-tool-results-for-prompt.ts:110-115 的理由站得住：dangling / 已删除的
fail-fast 是**保活链的安全网**——revision 被 GC 或 mark-deleted 后，同一内存消息下一次
hydrate 必须继续报 MISSING / DELETED。跨调用持久缓存会把已消失的 revision 明文继续发出去，
把安全网悄悄盖住。缓存范围严格限定在「一次 prepare 装配内」。

而性能上的损失由 B-4 的内容寻址解压池补上了大部分：blob 明文本身是内容寻址的，
`lookupDecodedContentBody` 命中就免解压。所以「不跨调用缓存 wire 文本」的实际代价
远小于表面。**置信 confirmed。**

### B-6 memo 的 wire 键把 `action` 纳进去，堵的是一个真实且致命的坑

```
// hydrate-tool-results-for-prompt.ts:292-293
const actionKey = isSkill ? `skill:${ref.action}` : "read";
const wireKey = `${plainKey}:${actionKey}:${ref.offset}:${ref.limit ?? ""}:${ref.path}`;
```

skill read 与 skill load 的 ref 共享 `(entryId, version)`（load 后再 read 同一
SKILL.md 是**常态**）。若 action 不进键，第二次会拿 `formatReadOutput` 的 wire 去当
`formatSkillLoadOutput` 的 wire 发给 LLM——而这两个 formatter 的输出形态完全不同
（load 多一段「附属文件」尾注、truncated 时多一句续读提示）。明文键不含 kind/action
是**对的**（同一 revision 的同一版正文与消费方式无关），wire 键必须含，代码分得清。

同理，明文缓存键含**期望 hash**（`${entryId}:${version}:${ref.contentHash}`），
所以篡改过的 ref 不会借缓存绕过校验（hydrate-tool-results.test.ts:495 有专门用例）。

### B-7 skill 侧的截断管线做成了真正的「单源」，而 read 侧是「逐行同参复刻」——两者的取舍各有道理

`skill-read-truncation.ts` 是本区设计最讲究的一处：skill read 的截断管线
（`truncateLine` 2000 字符 + `capUtf8Bytes` 整行丢弃）与 vfs read
（`capUtf8BytesFill` 末行填满）**不同**，wire 重放必须逐字节复刻各自那条；而
「执行时推导」在 `domain/tool/builtin`、`hydrate 时重放」在 `domain/chat/logic`，
chat 域不得反向依赖 builtin。所以推导被抽成 `domain/tool/logic/` 下的纯函数，
两侧共用同一份——skill-tool.ts:455/502 与 hydrate:180/206 调的是**同一个函数**，
不是复制两份。

read 侧没有抽单源（vfs-tools.ts:197-227 内联推导，hydrate:131-166 复刻），但注释
把「同样的 split / 同样的 sliceLinesFromOffset / 同样的 capUtf8BytesFill / 同样的
nextOffset 推导」逐项写明，且 T-RR2 四形态（整读 / offset 分页 / 50KB 字节帽 /
lastLineTruncated）真链路对比 `formatToolOutputForLlm` 基准。这是有意识的
「read 侧靠测试牙口、skill 侧靠共享函数」分工，不是疏漏。**置信 confirmed。**

### B-8 `kind` 缺省即 read + parse 侧**有意不回构 kind**：向后兼容的教科书做法

存量 content_json 与本分支之前的 read 引用块都没有 `kind` 键。
`parse-message-content.ts:136-139` 先按 `kind === "skill"` 分派、其余走 read 白名单；
`:189-195` 显式解释了为什么 read 分支**不**回构 `kind: "read"`：

> 落库 JSON 会凭空多一个键、round-trip 不再逐键稳定，还会让「哪些块带 kind」
> 这条判别规则退化成「read 也可能带」。

更关键的是分派**必须**在各自白名单之前——否则 read 白名单会静默吞掉 skill ref 的
`action/domain/name/files`，hydrate 拿不到 `files` 就重放不出「附属文件」尾注，
wire 逐字节失真。实现把这条写在了 `parseContentRef` 的函数头（:113-124）。
未知 `kind` 也 fail-fast（`:154-157`），不静默当 read 处理。**置信 confirmed。**

### B-9 三处同步（core 类型 / parse 白名单 / desktop DTO）都做了，且 DTO 按 kind 收窄

`apps/desktop/shared/ipc-types.ts:690-715` 的 `ContentBlockDto.contentRef` 判别口径
与 core 一致（`kind?: 'read'` 缺省即 read、skill 必带 `kind: 'skill'`），mobile 直接
import core 类型自动跟上。desktop 的 `bodyText` 占位（messages.ts:82-107）还按
`contentRef.kind` 窄化了文案——skill ref 标 `[skill ref: domain/name]` 而非误标
`[read ref: path]`，理由也写了（skill ref 的 path 是技能目录内的相对路径如 `SKILL.md`，
脱离 domain/name 单独投影既无信息量又会误导）。这是**在正确的地方多走了一步**。

### B-10 装配缺口选择 fail-fast 而非静默降级

`prepare-user-messages-for-prompt.ts:86-93` 的 runtime 注释写得很清楚：消息含
`contentRef` 块而 `revisionRepo` 未注入时抛 `READ_REF_REPO_MISSING`，
「空 tool_result 发给 LLM 正是引用化要杜绝的错文形态」。hydrate-tool-results.test.ts:371
有专门用例。反向装配（多注一个 repo）的风险是「静默发空串」——对 LLM 来说，
一个空 tool_result 比一次显式报错危险得多（模型会以为文件是空的）。

### B-11 双引用计数器的不变量在 repair 路径上守住了

`vfs_content_blob.ref_count` 由 SQLite 触发器维护（INSERT/DELETE/UPDATE OF content_hash），
`vfs_revision.ref_count` 由应用层维护。`batchRepairRefCountFloor` 只更新 `ref_count`
列、不改 `content_hash`，所以 `AFTER UPDATE OF content_hash` 触发器不会 fire，
两条路径不会重复计数。`revision-ref-count.ts:352-355` 与
`integrity-repair-dual-refcount.test.ts` 双向钉死了这条。read 引用加入期望值后
**没有触碰 blob 计数器**（`adjustReadRefCount` 只调 `batchAdjustRefCountWithDelta`），
不变量保持。

### B-12 `read` 的 +1 通道在四个装配点都真的注入了，且有生产链路 smoke 兜底

- 主 run：run-agent-turn.ts:918-920（经 `resolveReadRefCountChannel`）
- 子 run：run-agent-turn.ts:1275-1277（同源）
- U-A-U-A 用户操作链：create-user-vfs-turn-service.ts:72-73
- 旧测试 / 中间态：两者都缺 → `undefined` → read 回落 legacy 全文（不 +1、不产引用块）

`resolveReadRefCountChannel`（run-agent-turn.ts:201-223）把「显式注入优先、否则从
`revisionRepo` 推导、两者都缺返回 undefined」三态收敛到**一个函数**，主/子两个装配点
共用。`read-ref-production-smoke.test.ts` 三例分别锁这三种形态，第四例
（:116）跑真实 runner 全链：revisionRepo 注入 → read +1 产 contentRef 落库 →
下轮请求 history 含 hydrate 全文。

### B-13 legacy 兼容是真兼容，不是「应该没问题」

`ToolResultBlock.content` 保持 `string` 类型（引用态置空串）——这是 spec 决策 7 的
加法式演进，避开了「parse 层对非 string content 静默置 `""` 的地雷」。
T-RR12 三例（无 contentRef 的存量块 parse/序列化逐字节不变、legacy 纯文本块
round-trip 不变、buildToolResultBlock 对无 entryId 的旧形态输出走 legacy 全文）
与 hydrate-tool-results.test.ts:231（legacy 块零处理、消息原引用返回）、
:693（无 revisionRepo 的 legacy 消息行为不变）共同覆盖。

### B-14 与 pack（Part B）的正交性论证成立，且汇合点唯一

两条链都在 `contentStore.get` 收口：hydrate → `findByEntryAndVersion` → `contentStore.get`；
Part B 改造 `get` 加 member 分派且**签名不变**。read 引用保活的 revision 正是 Part B 的
打包候选，打包后 hydrate 走 member 分派读回明文，`ref.contentHash` 比对（元数据级，
B-4）不受影响。spec 风险段末尾还留了「两者都落地后需合跑一次回滚 + fork + checkpoint
套件回归」的合并后 QA 提醒。这是有前瞻的集成声明，不是口头正交。

## 让步清单

以下 6 条我**承认**是真实弱点，按严重度排序。每条都给了辩护侧的边界说明，请检察官
重点核这几条。

### D-1【P1】`overExpected` 泄漏检测在生产链路里是**死代码**——`createRevisionRefCountRepairOperation` 没有任何生产注册点

**证据**：`git grep -n "createRevisionRefCountRepairOperation"` 全仓只有 4 处非测试
命中，且**没有一处是注册**：

- `revision-ref-count.ts:357`（定义）
- `service/integrity-repair.ts:78`（**文档示例注释** `registry.register(createRevisionRefCountRepairOperation(...))`）
- `domain/provider/logic/provider-identity-repair.ts:18`（交叉引用注释）
- `packages/core/test/vfs/integrity-repair-dual-refcount.test.ts:18,86,131,165`（测试）

`novel-master-bootstrap.ts:421-423` 的 `IntegrityRepairRegistry` **只注册了
`createVfsEntrySequenceRepairOperation(conn)` 一个操作**。

**影响**：RULE.md:29 与 spec 测试策略 T-RR13 都把「无主 +1 由 `repairRefCounts`
三类期望值检测、只报告不自动修」写成风险②的兜底手段。这个兜底**当前不运行**。
叠加 B-1 的 +1 泄漏窗口（read 后 append 前崩溃 / abort 在 tool 执行后 append 前），
泄漏行会静默累积——虽然方向安全（ref_count 偏高 → revision 不被 GC → 只是存储占用），
但「可检测」这个承诺在生产是空的。

**辩护侧边界**：这不是实现写错，是**接线缺失**——`repairRefCounts` 本体、批量 floor、
`overExpected` 计算全都是完整且正确的（read-ref-count.test.ts:308-397 两例绿），
只差一个 registry.register。另外 `revision-ref-count.ts:270-271` 的 `@remarks`
写的是「bootstrap W3 作为全局 template 兜底以 (global, /) 触发」——**这句注释现在是
失效的**（bootstrap W3 段只注册 entry-sequence），注释与现实脱节也算一处 documentation drift。

**建议**：要么在 bootstrap W3 段补注册（注意 `aggregateReadRefsFromAllMessages` 是全库
`chat_message` 扫描 + 逐行 parse，启动路径跑这个需要评估代价，或挪到首次 idle/后台任务），
要么把 RULE.md:29 与 T-RR13 的措辞从「由 repair 检测兜底」降级为「repair 能力已就绪、
待接线」。**置信 confirmed。**

### D-2【P2】`updateContent` 的 +1 带 NOT_FOUND 守护，用户编辑含引用的消息会整条失败

**证据**：message.service.ts:303

```ts
// +1 带 NOT_FOUND 守护（batchAdjustRefCountWithDelta 语义）：新 blocks
// 引用的 revision 必须存在，悬空引用在落库前 fail-fast。
await adjustReadRefCount(revisions, collectReadRefs(content), +1);
```

`adjustReadRefCount`（revision-ref-count.ts:131-156）delta>0 时走
`batchAdjustRefCountWithDelta`，缺行抛 NOT_FOUND（sqlite-vfs-revision.repository.ts:447-456）。
这段在 `conn.transaction` 内，抛错会**回滚整条 updateContent**——用户的编辑保存失败。

**触发条件**：用户在 UI 编辑一条含 read 引用的消息，且编辑后的 blocks 仍携带
contentRef（复制粘贴 ref JSON、或某些编辑实现保留未知字段），而该 revision 恰好已被
GC/删除。窗口窄但非零。

**辩护侧边界**：这与 B-1 的方向性取舍是**同一个决策的两面**——+1 必须做存在性校验，
否则会造出「有引用无计数」的悬空。所以守护本身是对的。可争议的只是「失败粒度」：
当前是整条消息回滚，理论上可以降级为「丢弃新 blocks 里的悬空 ref 后保存」。
但那会引入「用户以为存了、其实 ref 被吃掉」的静默语义，我不主张改。
**建议**：至少在 `message.service.updateContent` 捕获 NOT_FOUND 并转成
`chatInvalidArgument` 之类的可读错误（现在是裸 VfsError 冒泡）。**置信 suspected**。

### D-3【P2】`read`/`skill` 的 +1 与「消息落库」不在同一事务，泄漏窗口比 spec 描述的「毫秒级」宽

**证据**：vfs-tools.ts:242-247 的 +1 在工具内；落库在 agent-runner.ts:912
`await session.append("user", { blocks: toolResults })`。两者之间隔着：

- `messageCheckpoint.capture`（agent-runner.ts:891-905，**事务 + VFS 对账，可能很慢**）
- `handleAbort("after_tool_checkpoint")` 检查（agent-runner.ts:908）——**命中就 break，
  tool_results 永不落库**

spec 风险② 写的是「量级毫秒窗口、abort 路径已覆盖已落库消息」。但 `after_tool_checkpoint`
这个 abort 断点恰好落在「+1 已发生、tool_results 未落库」的**正中**——这不是毫秒级，
是「checkpoint capture 的耗时 + 用户任意时刻点停」的量级。

**辩护侧边界**：方向仍然安全（+1 泄漏 = ref_count 偏高 = 不误删 = 存储残留），
这正是 B-1 的取舍所允许的。而且叠加 D-1（检测器没接线），这些泄漏行**既不会被发现也不会
被修**。两条让步叠在一起才是完整风险画像，单看任一条都不严重。
**置信 confirmed**（abort 断点位置与 +1/落库顺序已逐行核对）。

### D-4【P2】`formatReadOutput` 的「冻结」没有任何自动化守护——演进会静默漂移历史 wire

**证据**：RULE.md:29 与 spec 决策 6 都写「wire 逐字节等值是硬约束；`formatReadOutput`
列为**冻结函数**（演进需版本化 + 重放一致性测试守护）」。

但仓库里**没有**任何针对 `formatReadOutput` 的冻结断言：

- `format-tool-output.ts:41-67` 的函数体没有「冻结勿改」的代码级约束（只有文档）
- T-RR2 的四形态用例是「hydrate 重放 == **当前** `formatToolOutputForLlm` 输出」的
  **自洽对照**——两边调同一个 formatter，改了 formatter 两边一起变，用例照样绿
- `git grep "formatReadOutput"` 在 test 下只有 hydrate/skill-result-ref 的间接引用，
  没有任何 golden/snapshot 断言锁 wire 字节

**影响**：未来有人给 `formatReadOutput` 加一句提示语或改行号宽度，T-RR2 全绿、
所有现存 ref 的重放结果**集体漂移**、历史消息的 wire 与当初发给 LLM 的不再一致，
而 CI 不会有任何反应。spec 承诺的「重放一致性测试守护」目前**不存在**。

**辩护侧边界**：这不是引用化引入的风险（`formatReadOutput` 本来就在 wire 上），
但引用化把它从「改了只影响未来」升级成「改了一致性静默破裂」。当前实现把 ref 的
自包含参数（offset/limit/path/派生量）存得足够全，**未来做版本化重放的材料是齐的**——
所以是「守护缺失」而非「材料缺失」。
**建议**：加一条 golden 测试（固定输入 → 断言完整 wire 字符串字面量），
成本极低、直接把「冻结」从注释变成 CI 事实。**置信 confirmed。**

### D-5【P3】`read` 侧截断推导是「逐行复刻」而非共享单源，长期有漂移风险（skill 侧已做对）

**证据**：`vfs-tools.ts:197-227`（内联推导）与
`hydrate-tool-results-for-prompt.ts:131-166`（`replayReadWireText`）是**两份独立的
nextOffset 三分支推演**。而 skill 侧做成了真单源（`skill-read-truncation.ts` 被
skill-tool.ts:455/502 与 hydrate:180/206 共用）。

两份代码的注释都说「同样的 split / 同样的 sliceLinesFromOffset / 同样的
capUtf8BytesFill / 同样的 nextOffset 推导」，**但这是注释承诺，不是结构保证**。
T-RR2 是当前唯一的耦合检验，而按 D-4 的分析，T-RR2 是自洽对照——它能抓住
「两份实现不一致」，但**只在两边恰好被同一次改动同时影响或完全不影响的场景下**。
若有人只改 `vfs-tools.ts` 的 `nextOffset` 推导，T-RR2 会红（好）；若有人只改
hydrate 侧的，也会红（好）。所以 T-RR2 在这一点上**是有效的**，我下调严重度到 P3。

**辩护侧边界**：把 read 侧也抽成 `deriveReadTruncation` 单源（与 skill 侧对称）能
把结构保证从「测试」升级到「类型/模块边界」，代价是 `vfs-tools.ts` 多一个 import。
**置信 suspected**（风险真实但当前有测试兜底）。

### D-6【P3】`aggregateReadRefsFromAllMessages` 是全表扫描 + 逐行 parse，接线前需要评估代价

**证据**：revision-ref-count.ts:169-177 `SELECT id, content_encoding, content_blob,
content_json FROM chat_message` —— 无 WHERE、无 LIMIT，逐行 `decodeMessageContent` +
`parseMessageContent`。

与 D-1 关联：如果按 D-1 的建议在 bootstrap 启动路径注册 repair operation，这个全库扫描
会**每次冷启动跑一遍**。大会话库（数千条消息、压缩行占多数）下这是秒级起步。
spec 的性能修复轮对 hydrate 做过「每步读收窄」（368.2→23.9ms），可见本项目对此敏感。

**辩护侧边界**：这是 repair 路径的性质决定的（read 引用跨会话、repair 期望值必须按全库
口径对账，函数头 :159-164 已写明），不是随手写的。但它意味着 D-1 的修法不能是
「无脑往 bootstrap 加一行」。**建议**：若要接线，优先挂到已有的后台维护任务
（参照 `runMessageContentDecompress` 的调度形态）而非启动阻塞路径。
**置信 confirmed**（扫描形态已核）。

## 争议与存疑

1. **D-1 与 D-3 的耦合**是我最想请检察官一起看的：单看「+1 泄漏窗口」，方向安全、
   影响有限；单看「repair 没接线」，只是一个未使用的函数。但两条叠加 =
   「泄漏持续产生 + 泄漏不可检测」，实际风险高于两条之和。我没有把它们合并成
   一条 P1，因为它们确实是两个独立的缺陷（一个在写侧时序、一个在运维侧接线），
   合并会掩盖修复责任的归属。

2. **`create-user-vfs-turn-service.ts:72` 注入的 +1 通道在当前生产形态下是死的**：
   U-A-U-A 链路只跑 `fs`（rm/mkdir/mv）与 `write`（build-user-vfs-turn-op.ts:45-114），
   从不调 `read`，所以那条 `adjustRevisionRefCount` 注入目前不会被触发。我**不**把它
   报成缺陷——「与 agent 链路同款注入」是显式的对称性设计（注释写了），未来若 U-A-U-A
   支持 read 就自动生效。但请检察官确认这个读法：也可以主张它是「为不存在的能力预埋
   通道」的轻微冗余。我倾向 intentional。

3. **隐藏消息的 read 引用不被释放**（hide/show/hideRange/showRange/set-floor 全是零操作）。
   我核对了 `listBySession` / `listBySessionFromSeq` 都**不带** hidden 过滤
   （sqlite-message.repository.ts:273-274 只有 `options?.includeHidden === false`
   才加 `AND hidden = 0`），所以删除路径的 −1 **会**正确计入 hidden 消息的 refs。
   这与 RULE.md:29「置位/压缩/隐藏零操作」不冲突（隐藏不减、删除才减），我确认实现无误。
   但请注意一个语义后果：**压缩掉的旧消息只要还在库里就继续持有 revision**，
   存储占用比「隐藏即释放」的口径高。这是 spec 决策表明确接受的（消息还在，引用就该活着）。
   标 intentional，但检察官若从存储角度评估，这个取舍值得复述给用户。

4. **`ReadResultRef` 里 `totalBytes` / `returnedLines` / `totalLines` / `truncated` /
   `lastLineTruncated` / `nextOffset` 这些派生量在 hydrate 侧全部不被读取**
   （`git grep "ref.totalLines|ref.returnedLines|..."` 只在 content-block 注释和测试里出现）。
   hydrate 的 `replayReadWireText`（:131-166）**全部重算**这些值，只用 ref 里的
   `offset/limit/path` 三个入参。spec 决策 6 说 ref 自包含派生参数是为了「确定性重放」——
   实际上重放并不依赖它们，它们更像是「未来做版本化重放 / UI 展示诊断」的材料。
   我认为这**不是缺陷**（重算比重信更能防篡改，且派生量与重算结果一致由 T-RR2 保证），
   但请检察官确认口径：spec 的措辞（「ref 自包含全部输入与派生参数保证确定性重放」）
   容易让人以为重放会读这些字段。**标 intentional，但文档措辞可更精确。**
