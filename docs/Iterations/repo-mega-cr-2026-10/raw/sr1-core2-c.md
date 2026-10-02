---
zone: wave-b-core2 · 组 C（CS-07 归一版 + CS-08）
agent: sr1-core2-c（readonly reviewer · 条目组粒度 + core-misc 债务池抽验机位）
baseline_sha: fe79b781
files_scanned: |
  fix-spec/wave-b-core2.md（§0.2/§0.3/§7/§8/§11.2/§11.4/§11.5）
  fix-spec/wave-c2.md（§0 总览/C2-4/C2-5/N-1/N-2）
  ledger-v2.md（§2.4/§2.5/§3/§10 Wave B·C）
  synth/core-misc.md（M-02/M-06/M-10/M-15/M-16/M-17/M-18/M-19/M-31/M-32）
  docs/apm/RULE.md（消息正文存储条 / 迁移退役条 / SCHEMA_BOOT_VERSION 条 / 加 align 条目必 bump 条 / 验收断言牙齿条 / 性能护栏条）
  packages/core/src/bootstrap/vfs/vfs-revision-schema.ts
  packages/core/src/bootstrap/novel-master-bootstrap.ts
  packages/core/src/service/vfs/impl/vfs-batch-io.service.ts
  packages/core/src/domain/vfs/logic/vfs-batch-path.ts
  packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts
  packages/core/src/public/vfs.ts
  packages/core/src/domain/provider/logic/find-saved-model-references.ts
  packages/core/src/domain/provider/logic/builtin-providers.ts
  packages/core/src/domain/provider/logic/application-model-id.ts
  packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts
  packages/core/src/service/prompt/render-prompt.ts
  packages/core/src/infra/llm-protocol/logic/sse-line-buffer.ts
  packages/core/src/public/skills.ts
  packages/core/test/vfs/（目录清单 + vfs-batch-io.test.ts + vfs-gc-trigger.test.ts）
  packages/core/test/bootstrap/、test/message-checkpoint/、test/session-kkv/（目录清单）
  apps/desktop/src/main/services/vfs-batch.service.ts
  apps/desktop/test/vfs-batch-staging.test.ts
  apps/desktop/renderer/features/skills/skill-ui.ts
---

# sr1 · wave-b-core2 组 C 审查（CS-07 归一版 + CS-08）

## 摘要

本组两条：`CS-07`（blob 归零触发器不感知 `vfs_entry` 引用）与 `CS-08`（批量导出单文件分支不走
`exportRelativePath`，同名文件被静默丢弃）。核验结论：**CS-08 七要素齐备、行号逐条实测在位，可 Go**；
**CS-07 与 `wave-c2.md` 的 C2-5 是同一条 ledger 条目、两个分片各自宣告「对方不得立条」且修法在
覆盖面与存量库生效机制上实质冲突，当前 No-Go**。另抽验 core-misc 债务池 10/34 条（29.4%），
查出 5 处重复立项 / 已被覆盖、1 处标签不一致、0 处「已被修掉」。

---

## 1 · CS-07 谱系裁定

### 1.1 是不是同一条？——是。ledger §2.4 里 CS-07 只有一条。

`ledger-v2.md` §2.4（core-storage，12 条）逐行核对结果：**表体 12 行，ID 列只出现一次 `CS-07`**，
位于 `ledger-v2.md:124`：

```
| **CS-07** | `bootstrap/vfs/vfs-revision-schema.ts:44-54` | W6 + revalidate-a valid
             （DELETE 触发器确认无 `AND NOT EXISTS`） |
             DELETE 触发器加 `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)` |
             S（**须在 CS-06 之后**） |
```

**同名异实不成立**：§2.4 内不存在第二条 CS-07，也没有第二处不同的 `file:line` 或根因。
所谓「出现两次」发生在**另一层**——§10 波次提案表里同一 ID 被两个 Wave 各自列举：

| 位置 | 原文 | 性质 |
|---|---|---|
| `ledger-v2.md:457`（Wave B 末行） | 「**（同波顺带）** M-03 / M-04 / CS-02 / CS-04 / CS-07 / CS-08 / B / AM-3 / S-D-02 / **§6 #8** … 全部量级 S、零结构变更，打包成一个『P1-S 批次』PR」 | 条目被塞进「零结构变更」批次 |
| `ledger-v2.md:465`（Wave C「事务边界收窄」行） | 「… + **CS-06/07 revision 对齐** … CS-07 **必须在 CS-06 之后**」 | 条目被放进事务边界波，并带顺序依赖 |

⇒ **谱系 = 一条台账条目（`ledger-v2.md:124`）+ 台账自身在 §10 的双波次列举**。
两处分片的作者都没有编造条目，但都在自己片里替台账做了归一裁决，且**裁决方向相反**：

- `wave-b-core2.md:1165-1178`（§11.2）：「CS-07 的**代码条目唯一落在本分片（§7）**；
  **wave-c2 不得重复立条**，只能在 CS-06 条目的依赖栏里注明…」
- `wave-c2.md:1131-1144`（N-2）：「**只立一条**：…七要素写在 **C2-5**…**`wave-b-core2.md` 的 P1-S 批次清单
  **移除 CS-07**，改为一条交叉引用」

这两条互斥，必须由 judge 裁。**本机给裁据如下。**

### 1.2 三处实质冲突（全部经 `fe79b781` 实测）

**冲突 A · 覆盖面：core2 只修 DELETE，c2 修 DELETE + UPDATE。**

core2 `§7 修法 1` 与证据栏明写「本条只改 DELETE 触发器（台账指定的修法；UPDATE 触发器的内容换
hash 场景由 DELETE 触发器同款兜底，**不在本条范围**）」。实测 `vfs-revision-schema.ts:57-68` 的
UPDATE 触发器有一处**逐字不同但等价的归零删除**：

```sql
-- :64-65（VFS_REVISION_UPDATE_TRIGGER_DDL 内）
DELETE FROM vfs_content_blob
WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL;
```

这不是 DELETE 触发器能兜住的场景：`UPDATE OF content_hash` 时旧 hash 走的是**这段** DELETE，
DELETE 触发器根本不会被触发。⇒ core2 的「同款兜底」推理**不成立**，留半个真实触发面。
**c2 的覆盖面更全。**

**冲突 B · 存量库生效机制：c2 修法 4 的「不需要 bump `SCHEMA_BOOT_VERSION`」是错的（最高优先）。**

实测 `packages/core/src/bootstrap/novel-master-bootstrap.ts:345-374`：

```ts
const bootVersion = await readSchemaBootVersion(tx);            // :350
if (bootVersion >= SCHEMA_BOOT_VERSION) {                        // :351
  … await runPendingSchemaMigrations(tx); … return;              // :353-357  ← 快路径直接返回
}
for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {              // :360-362  ← DDL 只在慢路径
  await tx.execute(sql);
}
…
await alignSchemaColumns(tx);                                   // :365  ← ALIGN 同在慢路径
```

而 `NOVEL_MASTER_SCHEMA_STATEMENTS`（`:125` 处 `...VFS_REVISION_SCHEMA_STATEMENTS`）就是触发器
DDL 的唯一装配点；全仓 grep `trg_revision_delete_dec_blob_ref` 只命中
`vfs-revision-schema.ts` / `novel-master-bootstrap.ts` / `test/vfs/vfs-gc-trigger.test.ts`，
**没有任何无条件执行段**（对照先例：索引 `idx_chat_message_pending_blob` 确实被放在 `:394-400`
的事务外无条件段，可见本仓知道这个手法，只是触发器没用上）。

⇒ 任何「改 DDL 常量本体」的路线（core2 方案①、c2 的改名方案）**对 `user_version >= 17` 的存量库
一律零效果**，因为它们的库根本走不到 `:360`。

- **core2 是对的**：其 `§7 风险 2` 明写「走 ②（bootstrap 对齐）… 正是 RULE『加 align 条目不 bump
  版本则永远补不上』描述的陷阱——**若走 ②，必须同时 bump `SCHEMA_BOOT_VERSION`**」。这条推导经实测成立。
- **c2 是错的**：`修法 4` 写「改名不新增语句 ⇒ bootstrap 幂等，**不需要 bump `SCHEMA_BOOT_VERSION`**」。
  改名只解决「同名 `IF NOT EXISTS` 不重建」，不解决「快路径压根不执行 DDL」。c2 自己的 `风险 R1`
  「忘了改名 ⇒ 改动对所有存量库零效果，而测试全绿」也只覆盖了改名这一半。
  ⇒ **更隐蔽的后果**：若照 c2 实现且不 bump，E3「旧名触发器仍在、新名触发器已建」在**真实存量库**
  上必红、在**新建测试库**（`user_version=0`，走慢路径）上恒绿 ⇒ 测试形态恰好掩盖缺陷本身，
  这正是 RULE「验收断言的牙齿」判据 ②「在我的测试约束下可能恒红吗」的镜像形态。

**冲突 C · 测试落点分裂。**

- core2 `§7 测试策略`：新建 `packages/core/test/vfs/vfs-revision-blob-trigger.test.ts`，理由是
  「既有的 `vfs/orphan-revision-gc.test.ts` / `revision-ref-count.test.ts` 覆盖的是 GC 与
  ref_count 期望值，**不覆盖触发器 SQL 本体**」。
  实测：`orphan-revision-gc.test.ts`、`revision-ref-count.test.ts` **确实存在**，且确实不覆盖触发器
  SQL —— 这个理由本身成立。但 core2 **漏看了真正的既有归属**：`packages/core/test/vfs/vfs-gc-trigger.test.ts`
  实测存在（214 行），`describe/it` 为 `T-G1: sweep 删除 revision → 触发器自动回收 orphan blob`、
  `T-G2: 模板替换链后无 orphan blob（sessionTemplatePull 载体）`、`T-G2/sweep: replaceVfsSubtree 后无 orphan blob…`
  —— 就是这个 DELETE 触发器的现有测试面。
- c2 `C2-5 测试策略`：E1/E2/E4 加进既有 `test/vfs/vfs-gc-trigger.test.ts`，并注明「该文件是这个
  触发器的既有归属」——**这是对的**。

⇒ 两个新文件路径并存会把同一触发器的守卫拆成两处，后续改触发器的人极易漏改一边。**采 c2 的落点。**

### 1.3 裁定

| 判项 | 结论 |
|---|---|
| 是否同一条 | **是**。`ledger-v2.md:124` 单条；双波次列举在 `:457` 与 `:465` |
| 哪片权威 | **wave-b-core2 §7**（其存量库生效推导经实测正确、依赖栏与 §0.3/§11.2 前后自洽、回归线 8 个文件实测全在） |
| 另一片处置 | **wave-c2 C2-5 注记化**：删掉七要素、保留一条交叉引用「CS-07 见 wave-b-core2 §7，须在 CS-06 之后」；但把它的**三样东西上收**到 core2 §7 —— ① UPDATE 触发器一并修；② 「触发器改名是更廉价的存量库机制」这条纪律（与指纹对齐叠加用更稳）；③ 测试落点并入 `vfs-gc-trigger.test.ts` |
| 归一后 `wave-c2.md:1131-1144`（N-2） | 整节改写为「已归一至 wave-b-core2 §7」；`N-1` 的顺序约束保留（它是跨片顺序的唯一权威表述） |
| 归一后 `wave-b-core2.md:1174-1176` | 措辞改为「本片为权威；wave-c2 N-2 已注记化」，避免与被注记化的原 N-2 文本互相引用 |
| 台账层遗留 | `ledger-v2.md:457` 把 CS-07 塞进「全部量级 S、零结构变更」的 P1-S 批次，与 `:465` 的 Wave C 格冲突。**台账本身就该修**：建议 §10 Wave B 末行的清单删掉 CS-07（或加「（顺序约束见 Wave C，代码改动不进本批）」注记） |

---

## 2 · 逐条 verdict 表

> 核验列含义：**行号** = 亲自打开 `fe79b781` 核对；**病症** = 从代码重推导；**修法** = 完备性；
> **验收** = 有牙齿；**回归线** = 实存。

### 2.1 CS-07（wave-b-core2 §7）

| 核验项 | verdict | 证据 |
|---|---|---|
| 行号 | ✅ 全中 | `vfs-revision-schema.ts:44-54`（DELETE 触发器常量，含 `.trim()` 收尾）逐字一致；`:57-68`（UPDATE 触发器）一致；`:70-77` 注释「旧库由已退役的 migration 创建、现已并入 canonical DDL」一致；`:78-83` `VFS_REVISION_SCHEMA_STATEMENTS` 四条顺序一致；`vfs-batch-io.service.ts:100-101`（CS-06 触发条件源）逐字一致 |
| 病症重推导 | ✅ confirmed | 触发器体内 `UPDATE … ref_count - 1 WHERE content_hash = OLD.content_hash` + `DELETE … AND ref_count <= 0`，**全触发器体对 `vfs_entry` 零引用** ⇒ entry 侧引用不可见成立。附加发现：UPDATE 触发器 `:64-65` 有同款缺陷，core2 未收（见 §1.2 冲突 A） |
| 修法完备 | ⚠️ needs-fix | ① 缺 UPDATE 触发器（留半个触发面）；② `§7 修法 2` 存量库重建仍是「二选一、默认案 ②、执行时必须在 PR 里写明选了哪个」——**修法自身要求 impl 在实现时再决策一次**，违反「spec 须 execute-ready」；③ 方向正确的部分：默认案 ②（bootstrap 指纹对齐 + bump `SCHEMA_BOOT_VERSION`）经实测成立，但仓库**无既有指纹对齐实现**（`sqlite_master` 全仓仅出现在 bootstrap 的 8 处 + 1 条 migration 的建表 SQL 探测），须新造 |
| 验收有牙 | ⚠️ needs-fix | 行为断言 1（造「entry 有 hash 无 revision、ref_count=0」→ 删另一条 revision → `COUNT(*)` 仍为 1）**牙齿成立**（旧触发器下必红）；断言 2（无 entry 引用时仍回收）防反向错修，成立；断言 3（bootstrap 对齐）成立。**但验收命令写错**：`npm test -w @novel-master core`（缺 `/`，命令不可执行） |
| 回归线实存 | ✅（附一条过度预警） | 8 个文件全部实测存在：`test/vfs/orphan-revision-gc.test.ts`、`test/vfs/revision-ref-count.test.ts`、`test/message-checkpoint/{revision-gc,rollback-revision-backfill,deferred-revision-orphan-gc}.test.ts`、`test/session-kkv/deferred-file-cache-gc.test.ts`、`test/bootstrap/file-cache-schema.test.ts`、`test/bootstrap/bootstrap-no-migrate.test.ts`。**过度预警**：core2 称 `bootstrap-no-migrate.test.ts`「对 canonical DDL 语句集合有硬编码清单，新增对齐语句可能打红它」——实测该文件对 `TRIGGER`/`vfs`/`SCHEMA_STATEMENTS` **零引用**；且全仓**无任何测试快照 `VFS_REVISION_SCHEMA_STATEMENTS`** |
| 依赖闭合 | ⚠️ needs-fix | CS-06 硬依赖（wave-c2 C2-4）已写；CS-12 残留触发面已声明为纵深防御不完整面，正确。**但与 wave-c2 C2-5 的互斥未裁**（见 §1） |
| **CS-07 总结** | **CONDITIONAL** | 病症/行号/回归线三项满分；修法缺 UPDATE 触发器、存量库路线未收敛；验收命令笔误；跨片未裁。MF-C1~C6 闭合后可转 Go |

### 2.2 CS-08（wave-b-core2 §8）

| 核验项 | verdict | 证据 |
|---|---|---|
| 行号 | ✅ 全中 | `vfs-batch-io.service.ts:399-406`（`if (existing != null && existing.entryKind === "file")` → `basenameOf(logical)` → `seenFileRels` 去重 → `continue`）逐字一致；对照 `:412`/`:426` 两处 `exportRelativePath` 一致；`basenameOf` `:153-159`、`exportRelativePath` `:164-178` 一致；`domain/vfs/logic/vfs-batch-path.ts:72-74`（`if (path === root) return "";`）一致；`domain/vfs/ports/vfs-batch-io.port.ts:76-80`（`BatchExportPlan` **只有 `files` 与 `mkdirPaths`**，无跳过通道）一致；`packages/core/src/public/vfs.ts:52` `BatchExportPlan` 对外导出一致；`apps/desktop/src/main/services/vfs-batch.service.ts:280-293`（`:291` 只判全空抛「导出内容为空」）与 `:295-299`（stagingRoot 权威构造）一致 |
| 病症重推导 | ✅ confirmed | 重跑控制流：选 `/卷一/第一章.md` 与 `/卷二/第一章.md` ⇒ 两分支都得 `第一章.md` ⇒ 第二个撞 `seenFileRels.has(fileRel)` 被 `continue` 吞掉。`plan.files`/`mkdirPaths` 无跳过通道、desktop `:291` 只判全空 ⇒ **静默丢一个文件，UI 零提示**，链路闭合 |
| 修法完备 | ✅ | 「不能换成 `exportRelativePath(logical, logical, …)`」的陷阱**实测成立**（`relativePathUnderAnchor(p,p)` 在 `:72-74` 返回空串，调用方 `:413` 的 `rel.length === 0 → continue` 会把单选文件整个丢掉）。本机复算语义表：`/卷一/第一章.md` + 父 `/卷一`，`selectionCount=1` ⇒ `under="第一章.md"`；`selectionCount=2` ⇒ `rootName="卷一"` ⇒ `"卷一/第一章.md"` —— 与 spec 一致。`parentLogicalOf` 的根目录分支亦复算通过：`/a.md` + 父 `/` ⇒ 多选时 `rootName=basenameOf("/")=""` ⇒ 返回 `under="a.md"`。`skipped` 设为**可选**字段（避免 TS2741 打红手写字面量）正确。`§修法 3` 只保证「不丢 + 信息到 main 进程」、UI 呈现划出本条并入债务池，边界清楚 |
| 验收有牙 | ⚠️ 一处二选一尾巴 | T-B10（`files.length === 2` 且两 `relativePath` 不等）牙齿成立：改回 `basenameOf` 必红（`files.length === 1`）。T-B11（单选仍得 `第一章.md`）**专门防锚点取自身的错修**，成立。编号 `T-B10/11/12` 与实测既有 `T-B1`~`T-B9`（`vfs-batch-io.test.ts`，188 行，T-B5 = `export plan keeps relative structure`）不撞。**但 T-B12 写成「若第 2 步已消除该场景，则改为断言 `plan.skipped` 为空数组…二选一」** —— 本机实测：新修法**并未**消除全部同名碰撞（选 `/卷一/a.md` + 目录 `/卷一`，文件分支得 `卷一/a.md`、目录分支也得 `卷一/a.md`，仍撞 `seenFileRels`）⇒ `skipped` 是**必需**通道不是死字段，二选一应定死 |
| 回归线实存 | ✅ | `test/vfs/vfs-batch-io.test.ts` 存在且恰含 T-B1~T-B9；`apps/desktop/test/vfs-batch-staging.test.ts` 实测**恰 4 条**（`返回非空 NativeImage` / `删除 staging 目录` / `IPC clearStaging 幂等` / `stage 后注册 TTL`）—— spec 写的「全部 4 条」精确命中 |
| 依赖闭合 | ⚠️ 一处欠账 | 无前置、无拍板项，正确。但「与 CS-05/09/10 同文件需人工确认 hunk 不交叠」是**软约束**：`wave-c2.md:550` 的 C2-1 依赖栏已写「与 C2-4 同文件同函数段，建议同 PR」，而 C3 与 C2-1 的合并顺序在两片里**都无人负责** |
| **CS-08 总结** | **PASS（可 Go）** | 唯一实质缺陷是 T-B12 的二选一尾巴（MF-C7）+ 依赖图欠一条 hunk 协调义务（MF-C8）。**本条是本组质量最高的一条** |

---

## 3 · core-misc 债务池抽验（10 / 34 ≈ 29.4%）

抽样口径：core-misc 债务池 = `ledger-v2.md:200` §3 的 **P2 25 + P3 9 = 34 条**，条目明细在
`synth/core-misc.md`（M-06~M-30 = P2 25 条、M-31~M-39 = P3 9 条，与 §3 计数逐条对齐）。
按 PLAN 第四章第 12 条「每轮对本簇债务池做 ≥10% 抽验」，本轮抽 **10 条（29.4%）**，
优先抽与本分片有交叉关系的（会被本片覆盖/重复立项的）+ 每级各取。

| # | ID | 级 | 还在吗 | 定级合理？ | 已被覆盖 / 重复立项？ | 实测依据 | verdict |
|---|---|---|---|---|---|---|---|
| 1 | **M-02** desktop `buildNewSkillDoc` 裸插值 | synth 标 **P1** / ledger-v2 §2.10 脚注「现 **P2**」 | **在** | P2 合理 | 未被任何分片立条 | `apps/desktop/renderer/features/skills/skill-ui.ts` 的 `buildNewSkillDoc` 仍 `[ "---", \`name: ${name}\`, \`description: ${description}\`, … ]` 裸插值；Wave E 钩子③ 依赖栏只写「Wave B 同波」，而 Wave B 分片清单里**没有 M-02** | ⚠️ **标签不一致**：synth 标题仍 P1、ledger §3 按 P2 计数、§2.10 才有降级脚注；且 Wave E 钩子③ 的「Wave B 同波」前置**无落点**（Wave B 十张分片无一认领） |
| 2 | **M-06** SSE `data:` 无空格 | P2 | 在 | P2 合理（升级 Wave B 时理由充分） | **已被 `wave-b-core2 §2` 提前立条** | `wave-b-core2.md:196-297` 整节即 M-06；`ledger-v2.md:455` Wave B 明写「虽判 P2 但用户可感，提前到此波」 | ⚠️ **重复计数**：M-06 落地后 §3 core-misc P2 应 25→24，否则抽验口径长期失真 |
| 3 | **M-10** 协议层错误分类与可观测性缺口簇 | P2 | 在 | P2 合理 | **第 3 子项被重复立项** | M-10 三子项：①`providerId` 恒 undefined ②native 绕过 HTTP 状态码分类 ③未知 delta 静默丢弃。core2 §2 修法 3 提的「`unrecognizedLineCount` 可选字段」= 子项 ③ 的落点 | ⚠️ **半条重复**：core2 §2 修法 4 已把 BOM（子项 1 邻族）显式划出并注记「M-10 同族」，处置正确；但子项 ③ 被 core2 当「可选加强段」提前做了，M-10 那边又还挂着 ⇒ 须裁归属，否则两条各做一次 |
| 4 | **M-15** `SKILL_ENTRY_FILE` 单源建了没开出口 | P2 | **在** | P2 合理 | 未被覆盖 | `packages/core/src/public/skills.ts` 全文 20 个 export，**零 `SKILL_ENTRY_FILE` / `SKILLS_ROOT`** | ✅ **保留在池**（待认领） |
| 5 | **M-16** provider 域零消费派生群 9 份中 6 份死 | P2 | **在** | P2 合理 | 未被覆盖 | 逐符号 grep（`packages/core/src` + `apps/**`，排除 test）：`BUILTIN_KEY_TO_UUID`/`BUILTIN_UUID_TO_KEY`/`BUILTIN_PROVIDER_KEYS`/`BUILTIN_PROVIDER_IDS`/`BUILTIN_PROVIDER_UUIDS`/`builtinProtocolByProviderKey`/`builtinProtocolByProviderId` **生产零引用**，只命中自身定义与注释；synth 给的 7 个行号 `:105/:111/:120/:125/:128/:133/:140` **逐条在位** | ✅ **保留在池**；⚠️ 但 D-4 争议（这对双向映射是否为「跨库合并撞 id」预留）**未决** ⇒ 属 blocked-by-decision 面，不可直接执行 |
| 6 | **M-17** 删除守卫 `chat_project` 扫描结构上永空 + `prompts_json` 裸 `JSON.parse` | P2 | **在** | P2 合理 | **半条重复、半条未覆盖** | `find-saved-model-references.ts` 实测：`chat_project` 段仍在 `:66-90`；`:56` 的 `JSON.parse(String(row.prompts_json))` 仍**无 try/catch**（`prompts_json` 类型还标成非空 `string`）。core2 §5（M-04）只补了 `chat_session` 扫描、并称「`chat_project` 段当前无此保护，本条顺手对齐」——**顺手对齐的是 try/catch，不是删分支** | ⚠️ **须拆分归属**：M-17 主张①（删永空 `chat_project` 分支）未覆盖、主张②（`prompts_json` 裸 parse）未覆盖；只有「`chat_project` 段加 try/catch」与 M-04 重叠 |
| 7 | **M-18** 应用模型 id 归一：前缀早退绕过 `models/` 剥离 | P2 | **在** | P2 合理 | 未被覆盖 | `application-model-id.ts:49-52` 的 `startsWith(`${providerId}/`) → slice` 早退仍在，`:63-65` 的 `value.startsWith("models/")` 剥离在其后 ⇒ M-18 给的复现 `normalizeVendorModelId("openai","openai/models/gpt-4") → "models/gpt-4"` 逐字成立 | ✅ **保留在池** |
| 8 | **M-19** `skillsEnabled`/`skillsPrefix` 白名单漏字段 + persistCount 少门 | P2 | **在** | **P2 已过期**（见右） | **前半重复立项** | 前半 = `normalize-agent-prompt-layout.ts:61-73` 白名单（实测 `skillsEnabled`/`skillsPrefix` 确不在其中）——**已被 `wave-b-core2 §1`（N-P1-02）覆盖为 P1**。后半 = `render-prompt.ts:80-83` 的 `persistCount` 只看 `options?.skillsIndex?.length`、**不看 `layout.skillsEnabled`**（实测 `:81` 确无 `skillsEnabled` 判断）——**未被任何分片覆盖** | ⚠️ **须拆分**：F-1 核销进 N-P1-02；**F-2（persistCount 少门）留池**且**应升关注**——synth 判「当前不可达」成立（`budgetSkillsIndexEntries` 读的 `toolCtx.skills` 只在 registry 保留 skill 工具时注入），但那是**跨文件隐式不变量、无断言守护**，而 N-P1-02 落地后 `skillsEnabled:false` 的 agent 会真的开始走「关技能」路径 ⇒ 可达性上升 |
| 9 | **M-31** 死码与退役簇（14 项） | P3 | **在** | P3 合理 | **与 Wave D 批次 3 部分重叠** | 14 项中 `validate-prompt-blocks.ts` + `PromptBlock` 联合类型已进 `ledger-v2.md:477` Wave D 批次 3 ⭐新增目标③；`createProviderIdentityRepairOperation` 未注册已由 synth 标 intentional；其余约 11 项无归属 | ⚠️ **须对账**，否则 Wave D 执行时与本池重复立项 |
| 10 | **M-32** SSE 行缓冲层欠账 | P3 | **在** | P3 合理 | **未被覆盖** | `sse-line-buffer.ts` 实测：`:9` `SseLineBufferState = { readonly buffer: string }`（类型谎言）、`:24` `(state as { buffer: string }).buffer = trailing`（强转写 readonly）、`:19` `combined.split("\n")`（**只按 `\n` 切行 ⇒ 纯 `\r` 换行的流会被当成一整行**）、**无 buffer 上限** —— 四点全部原样在位。core2 §2 修法 1 新建 `sse-data-line.ts` 但**没动 `feedSseLines` 本身**，故本条未被碰过 | ✅ **保留在池**；⚠️ core2 §2 修法 4 的「不做 BOM 剥离」注记**范围写窄了**，应扩为「本条不改 `sse-line-buffer.ts` 任何一行」，否则实现者容易顺手改切行逻辑、与 M-32 将来落点 hunk 交叠 |

### 3.1 抽验小结

- **重复立项 / 已被覆盖：5 处** —— M-06（整条）、M-19 F-1、M-10 子项③、M-17 主张与 M-04 的重叠部分、M-31 与 Wave D 的重叠部分。
- **标签不一致：1 处** —— M-02（synth 标题 P1 vs §3 计数 P2 vs §2.10 降级脚注，三处口径不齐）。
- **已被修掉：0 处** —— 10 条抽样无一条病灶消失，**债务池计数无水分**，这点是干净的。
- **仍无分片认领、建议保留：M-15 / M-16（待 D-4 拍板）/ M-18 / M-32 / M-19-F2 / M-17-两主张**。

---

## 4 · must-fix 清单

| # | 条目 | 归属 | 级别 | must-fix 描述 |
|---|---|---|---|---|
| **MF-C1** | CS-07 | 组 C | **blocking** | `wave-b-core2.md:1174-1176`（§11.2「wave-c2 不得重复立条」）与 `wave-c2.md:1131-1144`（N-2「core2 移除 CS-07」）**互斥**，两片各自宣告权威。按本报告 §1.3：**core2 §7 为权威**、c2 C2-5 注记化；同步改写 c2 N-2 整节与 core2 §11.2 措辞（避免改完后仍互相引用）；并在 `fix-spec/SPEC.md` 依赖图登记「CS-06 → CS-07」单条 |
| **MF-C2** | CS-07 | 组 C | **blocking** | `§7 修法` 补 **UPDATE 触发器**：`VFS_REVISION_UPDATE_TRIGGER_DDL`（`vfs-revision-schema.ts:64-65`）的归零删除有**逐字同款缺陷**，且 `UPDATE OF content_hash` 场景 DELETE 触发器根本不会触发 ⇒ core2 现有「同款兜底」推理不成立，留半个真实触发面 |
| **MF-C3** | CS-07 | 组 C | **blocking** | `§7 验收` 命令 `npm test -w @novel-master core` → `npm test -w @novel-master/core`（缺 `/`，不可执行）。同片另扫：`§0.4` 批次验收线与 CS-08 的命令写法正确，仅此一处笔误 |
| **MF-C4** | CS-07 | 组 C | should-fix | 测试落点并入**既有** `packages/core/test/vfs/vfs-gc-trigger.test.ts`（实测存在，214 行，T-G1/T-G2 即该触发器现归属），删掉 `vfs-revision-blob-trigger.test.ts` 新文件方案；core2「须新文件」的理由改为「既有文件不覆盖触发器 SQL 本体，故在既有文件内补守卫断言」 |
| **MF-C5** | CS-07 | 组 C | **blocking** | `§7 修法 2` 的「① migration ② bootstrap 指纹对齐，**执行时必须在 PR 里写明选了哪个**」必须收敛为**单一默认案**——spec 阶段留二选一即非 execute-ready。默认案取 **② + bump `SCHEMA_BOOT_VERSION`**（实测依据：`alignSchemaColumns` 与 `NOVEL_MASTER_SCHEMA_STATEMENTS` 同在慢路径 `novel-master-bootstrap.ts:360-365`，存量库 `user_version >= 17` 走 `:351-357` 快路径直接 return）。同时把 c2 的「**触发器改名 `_v2`**」纪律上收为叠加项——它比指纹对齐更廉价、可作第二道锁，但**单靠改名不够** |
| **MF-C6** | CS-07 | 组 C | should-fix | 删/降级 `§回归线` 里「`bootstrap-no-migrate.test.ts` 对 canonical DDL 语句集合有硬编码清单，新增对齐语句可能打红它」的预警：实测该文件对 `TRIGGER`/`vfs`/`SCHEMA_STATEMENTS` **零引用**，全仓亦无任何测试快照 `VFS_REVISION_SCHEMA_STATEMENTS`（唯一引用者只有 `novel-master-bootstrap.ts` 自身与 `vfs-gc-trigger.test.ts`） |
| **MF-C7** | CS-08 | 组 C | should-fix | `§验收` T-B12 的「二选一」尾巴定死为「**断言 `plan.skipped` 记录被去重的项**」。实测依据：新修法**未**消除全部同名碰撞（选 `/卷一/a.md` + 目录 `/卷一` ⇒ 文件分支 `卷一/a.md`、目录分支 `卷一/a.md`，仍撞 `seenFileRels`）⇒ `skipped` 是必需通道、不是死字段，两条断言都要留 |
| **MF-C8** | CS-08 | 组 C | should-fix | 依赖栏的「与 CS-05/09/10 同文件需人工确认 hunk 不交叠」是软约束，两片都无人负责 C3 与 C2-1 的合并顺序（`wave-c2.md:550` C2-1 写「与 C2-4 同文件同函数段，建议同 PR」）。把 **C2-1（CS-05，`applyBatchIngest`）与 C3（CS-08，`planBatchExport`）同文件 hunk 协调义务**写进 `SPEC.md` 依赖图并指定责任人 |
| **MF-C9** | CS-07（c2 侧） | 跨片 · 供 judge | **blocking** | 删 `wave-c2.md:604-607` 修法 4「改名不新增语句 ⇒ bootstrap 幂等，**不需要 bump `SCHEMA_BOOT_VERSION`**」。实测该结论错误（见 §1.2 冲突 B）：快路径根本不执行 DDL 数组。且该错误会**制造假绿**——E3 在新建库（走慢路径）恒绿、在真实存量库必红 |
| **MF-C10** | CS-07（c2 侧） | 跨片 · 供 judge | must-fix | C2-5 的 `修法 5`、`测试策略`、`E5 命令` 引用 `test/bootstrap/bootstrap.test.ts` 与 `test/vfs/blob-gc.test.ts` —— 实测**两个文件都不存在**（分别是 `test/vfs/bootstrap.test.ts` / `test/bootstrap/bootstrap-ddl-smoke.test.ts`；`test/message-checkpoint/blob-gc.test.ts`）。因而无测试快照 statements 数组，`修法 5` 的前提落空 |
| **MF-C11** | 债务池 | 组 C | should-fix | `ledger-v2.md:200` §3 core-misc **P2 计数 25 须标注 M-06 已提前立项（落 wave-b-core2 §2）**，或直接改 24；`synth/core-misc.md:216` 的 M-06 标题同步加「已提前立项」标记。另把 `synth/core-misc.md:101` 的 **M-02 标题 `P1` 改 `P2`**（`ledger-v2.md:188` §2.10 已降级，三处口径须一致） |

---

## 5 · 结论

**组 C：No-Go**（当前不可 execute-ready）。

一句话理由：**CS-08 质量满分可直接 Go，而 CS-07 被 wave-c2 C2-5 抢注为权威、两片修法在覆盖面（UPDATE 触发器）与存量库生效机制（c2「不需要 bump `SCHEMA_BOOT_VERSION`」经实测为错）上实质冲突，加上 core2 版自身缺 UPDATE 触发器、验收命令笔误 —— MF-C1/C2/C3/C5/C9 五个 blocking 闭合后可复审转 Go。**

附核数：**verdict 2 条（PASS 1 / CONDITIONAL 1）**；must-fix **11 条（blocking 5 / should-fix 5 / 跨片 must-fix 1）**；
债务池抽样 **10 条（29.4% ≥ 10%）**，查出重复立项或已被覆盖 5 处、标签不一致 1 处、已被修掉 0 处。
