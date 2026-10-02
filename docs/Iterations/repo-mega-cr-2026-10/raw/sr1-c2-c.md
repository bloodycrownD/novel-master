---
zone: fix-spec/wave-c2 · 组 C（C2-7 / C2-8 / C2-9）
agent: readonly-reviewer（sr1-c2-c）
baseline: fe79b781（worktree D:\Dev\nm-worktree\mcr，分支 feat/repo-mega-cr）
files_scanned:
  - docs/Iterations/repo-mega-cr-2026-10/PLAN.md（第一、四章）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-c2.md（§0、C2-7、C2-8、C2-9、N-4/N-5）
  - docs/Iterations/repo-mega-cr-2026-10/fix-spec/SPEC.md
  - docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md（§2.4、§3、§7、§9、§10）
  - docs/Iterations/repo-mega-cr-2026-10/synth/core-storage.md（P2 17 条 / P3 G1–G12）
  - docs/apm/RULE.md（决策感知相关节目）
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/repositories/message.port.ts
  - packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts
  - packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts
  - packages/core/src/domain/vfs/logic/vfs-zip-parse.ts
  - packages/core/src/domain/vfs/logic/vfs-zip-validate.ts
  - packages/core/src/domain/skills/logic/preview-skill-zip.ts
  - packages/core/src/service/vfs/impl/vfs-zip-io.service.ts
  - packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts
  - packages/core/src/infra/sql-template/parser.ts
  - node_modules/fflate/esm/index.mjs（+ 实跑探针）
---

# sr1 · wave-c2 组 C 只读审查（C2-7 / C2-8 / C2-9 + core-storage 债务池抽验）

## 摘要

三条 P1 的**行号与引文全部在位**（最大漂移 8 行，均在方法体内），修法方向都对，三条都不是 No-Go。
但有 **3 处 must-fix**：C2-8 的第 3 步兜底方案**已被本轮实测证伪**（不是"待验证"，答案已经有了，且实测行为比 spec 假设的更糟：静默截断而非抛错）；C2-8 第 4 步的累加落点没写死（写进 `try` 里会被降级成 `INVALID_ZIP`）；
C2-9 的病症失败机理与现役驱动实测不符（`SQLITE_MAX_VARIABLE_NUMBER` 是 **32766 不是 999**），连带把 I1 变成无牙断言、并抽掉了 P1 的紧迫性依据。
债务池抽 10 条（65 条的 15%），代码现状全部仍在，定级全部合理，仅 2 条与 spec 存在**部分/潜在重复立项**风险。

---

## 一、逐条 verdict

### 1.1 C2-7 · `listBySessionOffset` 头投影 —— ✅ **Go**（1 处 must-fix-lite + 1 nit）

#### 行号与引文核对

| spec 声称 | 实读 | 结论 |
|---|---|---|
| `sqlite-message.repository.ts:335-351` | 方法签名 `:335` 起、`:351` 收尾，SQL 与 `LIMIT -1 OFFSET #{offset}` 逐字一致 | ✅ 精确 |
| `MESSAGE_SELECT_COLUMNS` 在 `:28`，21 列 | `:28`；逐列点数 = 21（id…duration_ms） | ✅ 精确 |
| 对照组 `:301-322` `listMessageHeadersBySession` | `:301-322` 精确；`:310` 的 SELECT 恰 6 列（id, session_id, seq, role, hidden, created_at_ms）；`:314-321` 是 `rows.map` | ✅ 精确 |
| `offset` clamp 在 `:339` | `:339` `Math.max(0, Math.floor(offset))` | ✅ 精确 |
| `message.port.ts:38-45` 返回签名 | `:45` `listBySessionOffset(sessionId, offset): Promise<ChatMessage[]>`，JSDoc `:38-44` | ✅ 精确 |
| `message.port.ts:7` 已有 `ChatMessageHeader` import | `:7` `import type { ChatMessage, ChatMessageHeader }` | ✅ 精确 |
| 唯一调用方 `backfill-baseline-checkpoints.ts:114-120` 只取 `.id` | `:114` 调用、`:117-120` `countCheckpointsForMessages(sessionId, segment.map((m) => m.id))` | ✅ 精确 |
| 「全仓只有一个调用方」 | `git grep listBySessionOffset` 实测：生产 1 处（`backfill-baseline-checkpoints.ts:114`）+ 端口/实现各 1 处 + 测试 `backfill-cursor.test.ts` | ✅ 成立 |
| `test/chat/message-visibility.test.ts:75` 有同款用例 | `:75` `it("listMessageHeadersBySession：头投影含 hidden…")` | ✅ 精确 |
| `backfill-cursor.test.ts:76-85` mock 位置 | `:76` 定义、`:85` 入 deps | ✅ 精确 |

#### 病症从代码重推导

成立。`MESSAGE_SELECT_COLUMNS` 含 `content_json` / `raw_json` / `attachments_json`，而 `mapRows → rowToMessage → readRowContent`（`:127`/`:137`）会对每行调 `parseMessageContent`。叠加 `mapRows` 自带的分片让步（`:250-259`），offset=0 的一次调用等于「把全会话正文拉回并逐条 parse」。
按 RULE「每 step/每轮发送前的全量消息读必须头投影或 SQL 层滤 hidden」，本条属**同一族未收口点**，值得立。

#### 修法可行完备性（任务点 ①：消费方拿不到正文怎么办）

- **单一消费方零改动** ✅：`:119` 只 `.map(m => m.id)`，`segment.length` 在 `:121` 用到，头投影返回数组长度不变。
- **正文需求有现成替代口** ✅（这是 must-fix-lite 的落点）：`message.port.ts` 里 `listBySession:17`（含 hidden/不含 hidden 两种）、`listBySessionFromSeq:54`（`seq >= fromSeq`，语义上正是「跳过 offset 行取其后」的等价物）、`listBySessionTail:59`、`listBySessionPage:60` 都已存在。
  spec 的 R1 只写「新增调用方必须另起读口」，**没点名这些现成读口**——将来有人加第二个「要正文」的调用方时，最省事的正确动作是 `listBySessionFromSeq(cursor + 1)`，不是新起。建议修法第 1 步补一句点名。
- **端口窄化是唯一破坏面** ✅：实测只有一个生产调用方 + 一个 mock，无仓外消费者（`parseVfsZip` 那类 `public/*` 转发出面本条不涉及）。

#### 验收可测性（牙齿三判据）

| 判据 | 结论 |
|---|---|
| ① 有牙吗 | **G1 有牙**：断言 `Object.keys(rows[0])` 恰为 6 键，旧实现返回 21 键 ⇒ 必红。**G2 有牙**（clamp 边界 0/1/99/负数四条互不相同）。**G3 有牙**（旧实现 parse 次数 = N，新实现 = 0）。 |
| ② 会不会恒红 | 不会。三个 offset 档位产出 3/2/0/3 条，与 `LIMIT -1 OFFSET ?` + clamp 语义逐条对得上。 |
| ③ 一夹具一套期望 | 无冲突。 |

**nit**：`mapRows` 是**私有方法**，在 ESM 下不可 monkey-patch（RULE「ESM 下无法 monkey-patch」条），G3 的观测面应直接钉 `parseMessageContent`（实测存在：`domain/chat/content/parse-message-content.ts:471`，由 `readRowContent` `:127`/`:137` 调用，且测试脚本带 `--experimental-test-module-mocks`，`mock.module` 可用）。spec 写的「spy mapRows 或统计 parseMessageContent」二选一，建议删掉前半条，避免实施时卡壳。

#### 测试策略 / 回归线真实性

全部实存：`test/chat/`（60 文件）、`test/message-checkpoint/`（31 文件）、`test/service/chat/` 均在；`message-repository-yield.test.ts` 实存；命令形态符合 N-5（带 flag 的 `npm run test:fast -w packages/core -- <file>`）✅。

#### 依赖闭合

「无前置」✅。依赖栏附的「C2-2 与 C2-6 会顺带消费它」本组未逐字核 C2-2/C2-6 正文，标 **suspected**，交 judge 或邻组确认。

---

### 1.2 C2-8 · CS-09 ZIP 解析期体积/条数闸 —— ⚠️ **Go-conditional**（2 处 must-fix）

#### 行号与引文核对

| spec 声称 | 实读 | 结论 |
|---|---|---|
| `vfs-zip-central-dir.ts:173` `totalEntries` | `:173` `readUInt16LE(zipBytes, eocdOffset + 10)` | ✅ 精确 |
| `:199` `uncompressedSize` | `:199` `readUInt32LE(zipBytes, offset + 24)` | ✅ 精确 |
| `:224-230` `readLocalEntryData` + `entries.push` | `:224-230` 是 `readLocalEntryData(...)` 调用；`entries.push` 实际在 `:232-240` | ⚠️ **漂 8 行**（minor，方法体内） |
| `:85-115` `decompressEntryData` 先 inflate 后比对 | `:85-115` 精确；`:101` `inflateSync(compressed)` → `:102` 比对 | ✅ 精确 |
| `vfs-zip-validate.ts:17-18` 三常量 | `:17` 32MB、`:18` 5000、`:19` 512 | ✅ 精确（第三值 spec 未给行号） |
| `vfs-zip-validate.ts:195-207` 闸门 | `:195` entryCount、`:196-201` 条数闸、`:202-207` 体积闸，均抛 `PAYLOAD_TOO_LARGE` | ✅ 精确 |
| `vfs-zip-io.service.ts:189-192` parse→validate | `:189` parse、`:191-194` validate | ✅ 精确 |
| `preview-skill-zip.ts:35` 无任何 validate | `:35` `const entries = parseVfsZip(zipBytes);`，整函数（`:34-61`）零校验 | ✅ 精确 |

#### 病症从代码重推导

成立。`parseZipCentralDirectory`（`:165-246`）整段无累加、无上限，`entries` 数组（`:185`）随 `totalEntries`（uint16，上限 65535）无界增长；
`:206` 的 `assertNoZip64Marker(uncompressedSize)` 只挡 `0xffffffff`，其余任何 32 位值（最高约 4GB）直接放行到 `:224` 的解压。

#### 修法可行完备性（任务点 ②：累加点 / 越限即抛位置 / zip bomb 真能拦住吗）

**逐点判定：**

1. **第 0 步（fflate 回退不绕过）——位置写对了，这是本条成立的关键。** ✅
   spec 的落点是 `vfs-zip-parse.ts::parseVfsZip` 的 `catch (centralDirError)` 块内（实读 `:44`），在 `:46` 的 `parseVfsZipViaUnzipSync` **之前** rethrow。
   若把检查放进 `parseVfsZipViaCentralDirectory` 内部再 rethrow，会被 `:44` 的 catch 接住继续回退——spec 没有犯这个错，位置正确。

2. **第 2 步的累加点——位置正确。** ✅
   `declaredBytes` 必须在 `:199` 读到 `uncompressedSize` 之后、`:224` 进入 `readLocalEntryData`（→ `decompressEntryData` → `inflateSync`）**之前**累加并判。spec 写的正是「在 `readLocalEntryData` 之前」。

3. **zip bomb 真能拦住吗——分两种，答案不同：**
   - **声明型（常见形态）✅ 真能拦**：单条 DEFLATE 声明 2GB / 几百 KB 压缩体 ⇒ `declaredBytes = 2GB > 32MB` ⇒ 在 `inflateSync` **未被调用**前抛 `PAYLOAD_TOO_LARGE`。条数同理（`totalEntries` 在 `:173` 就能判，EOCD 之后、解压之前）。**这是本条的主战场，守住了。**
   - **谎报头（声明 1 字节、实际 2GB）❌ 仍拦不住**：第 2 步的 `maxEntryBytes` 比的是**声明值**，声明 1 字节照样放行；此时唯一兜底是第 3 步——**而第 3 步已被证伪，见下**。
     spec 自己在「已知限制」里承认这点，态度是对的，只是低估了后果（见 1.2.must-fix-1）。

4. **第 4 步（fflate 回退也判）——落点必须写死，否则整步静默失效。** ⚠️
   `parseVfsZipViaUnzipSync`（`vfs-zip-parse.ts:23-36`）的形状是 `try { unzipSync → for 循环建 Map → return } catch { throw vfsZipError("INVALID_ZIP") }`，**循环整体在 `try` 内**。
   若把累加/抛写进这个 `try`，`PAYLOAD_TOO_LARGE` 会被 `:33` 的 `catch` 吞掉并改写成 `INVALID_ZIP` ⇒ 闸门在最需要它的回退路径上完全无效，且 H4 会红。
   spec 写「`unzipSync` 之后立刻累加」但**没说必须在 `try` 之外**。这一条不写死，实施者极可能踩中。

5. **旁证（可写进 spec 加强定级）**：`fflate` 自己的 `unzipSync` 在 `esm/index.mjs:2704` 就是 `inflateSync(data.subarray(b, b+sc), { out: new u8(su) })`，`su` 直接取 zip 头 ⇒ **回退路径今天就带着同款「按头部尺寸预分配」的行为**。

#### ⚠️ must-fix-1：第 3 步（`out` 预分配）已被实测证伪，且实际后果比 spec 假设的更糟

spec 写「`inflateSync` 没有『最大输出』参数，兜底是给它传预分配的 `out`……谎报头会因为 `out` 容量不足而**失败**，而不是先分配 2GB」，并加了一道正确的施工闸「⚠️ 实施前必须先跑一条最小单测证明 fflate 在 `out` 不够时**抛错**而不是静默溢出；若实测不成立，退回现状」。

**本轮已把这条最小单测跑掉了（`node_modules/fflate@0.8.3`）：**

- 源码路径：`esm/index.mjs:1239-1241` `inflateSync(data, opts) → inflt(data, { i: 2 }, opts && opts.out, …)`；
  `inflt` 内 `:239` `noBuf = !buf`、`:241` `resize = noBuf || st.i != 2`。
  传了 `out` ⇒ `noBuf=false` 且 `st.i==2` ⇒ **`resize === false`** ⇒ `:248-257` 的 `cbuf` 扩容分支**永不执行**，`buf` 永不增长。
- 实跑：`deflateSync(1000 字节)` → `inflateSync(comp, { out: new Uint8Array(10) })` ⇒ **返回 10 字节、无异常、无警告**。

**结论：fflate 0.8.3 在 `out` 不够时既不抛错也不溢出，而是「静默截断」。** 这比 spec 假设的失败模式更危险：

> 谎报头（声明 1 字节、实际 2GB）⇒ `out = min(1, remaining) = 1` 字节 ⇒ `inflateSync` 返回 1 字节 ⇒ `decompressEntryData:102` 的 `inflated.length !== uncompressedSize` 比的是 `1 !== 1` ⇒ **不抛** ⇒ 一条被截断的 entry 被当作合法正文收进 `entries`。

也就是说，第 3 步一旦照字面实施，会把「OOM」换成「静默数据损坏」，且现有长度比对完全兜不住。

**建议 doc-fix**：把第 3 步从「先验证再落」改写为「**已实测证伪，撤除**」，并把证据（fflate 0.8.3 `esm/index.mjs:1239-1241` + `:239-257` 的 `resize` 逻辑 + 探针结果）写进步骤说明；谎报头缺口写进「已知限制」时，**不能只写「失败前会多分配一次」**——那句对 STORE 分支成立，对 DEFLATE 谎报头不成立（那是真 OOM 面）。
若仍想要谎报头的硬防护，正解不是 `out`，而是**改用流式 `Inflate.push` + 自管累加**（在 `ondata` 回调里累计并中断），代价是偏离「最小改动」，需 judge 单独拍。

#### 验收可测性（牙齿三判据）

| 断言 | 判定 |
|---|---|
| H1 条数闸在解压前 + 尾部反证（损坏中央目录 + 超条数 ⇒ 必须 `PAYLOAD_TOO_LARGE` 而非 `INVALID_ZIP`） | ✅ **有牙且正中要害**：这一条专门钉第 0 步，后半段在旧实现下必红（会走回退 → `INVALID_ZIP`）。 |
| H2 体积闸在解压前 | ✅ 有牙；观测面按 N-5 取数量级（`heapUsed` 增量 < 8MB，5–10× 余量）并给了退化方案（给 fflate 打注入点计数），**符合 RULE「性能护栏取数量级回归线」**。 |
| H3 技能预检同闸 | ✅ 有牙（`previewSkillZip` 今天零校验）。 |
| H4 fflate 回退也被拦 | ⚠️ 期望对，但**会因 must-fix-2（落点）红**——正是它把第 4 步的落点问题顶出来。 |
| H5 `vfs-zip-parse.test.ts` 现有 7 条 | ✅ **实测 = 7 条**（`^\s*it\(` 计数）。 |
| H6 闸门值不变 32MB/5000/512 | ✅ 实测三值一致。 |
| H7 命令 | ✅ 带 flag，N-5 合规。 |
| `preview-skill-zip.test.ts` 4 条 | ✅ **实测 = 4 条**。 |
| 回归线 `test/character-card/` | ✅ 实存（4 文件），ZIP/卡片共用解析器的邻接面判断成立。 |

无恒红风险、无夹具冲突。

#### 测试策略 / 回归线真实性

新增 `test/vfs/vfs-zip-parse-limits.test.ts`（尚不存在，属正常新增）；「手工构造 zip 头只改 `uncompressedSize`/`totalEntries`」在 zlib 无 ZIP64 的前提下**技术上成立**（两个字段都是定宽 4 字节，改完仍能过 `assertNoZip64Marker`，前提是别改成 `0xffffffff`）。回归线四目录实存。

#### ⚠️ must-fix-2：第 4 步的抛点必须写在 `try` 之外

见上文 4.。建议修法第 4 步补一句：
「累加与 `PAYLOAD_TOO_LARGE` 抛出必须在 `parseVfsZipViaUnzipSync` 的 `try` **之外**（现有 `try { unzipSync … 循环 … } catch { throw INVALID_ZIP }` 会把闸门降级成 `INVALID_ZIP`）」。

#### 其他

- **nit（定级论据缺失）**：`previewSkillZip` 是在 **Renderer 进程**跑的（desktop `NewSkillModal.tsx:101`、mobile `NewSkillModal.tsx:156`）。ZIP 炸弹打的是 UI 主线程 ⇒ 冻结/杀掉整个渲染进程，比主进程 OOM 更难受。spec 只写「技能预检同闸」，没把这句加重论据写进病症，建议补（不改修法）。
- **依赖闭合** ✅：「无前置」「与 C2-1 同波无耦合」成立（C2-1 只改事务边界）。
- **回滚**：无 schema 变更；常量搬家的 re-export 同 commit 回退 ✅ 口径正确。

---

### 1.3 C2-9 · CS-10 checkpoint 仓储三方法补 900 分片 —— ⚠️ **Go-conditional**（1 处 must-fix）

#### 行号与引文核对

| spec 声称 | 实读 | 结论 |
|---|---|---|
| `countCheckpointsForMessages` `:119-131` | 方法体 `:112-135`；`:119-121` bindings、`:126-132` SQL（IN 子句在 `:128-130`） | ✅ 命中（方法级起止比 spec 晚 7 行，spec 引的是方法体内部区间） |
| `listFilePointersForMessages` `:373-385` | 方法 `:366-388`；bindings `:373-375`、SQL `:379-386`（IN 在 `:382-384`） | ✅ 命中 |
| `deleteCheckpointsForMessages` `:398-408` | 方法 `:390-432`；`:398-401` bindings + `inClause`、查询 `:403-410` | ✅ 命中 |
| 同文件 `:40-41` 已有 `MULTI_VALUES_MAX_VARS = 900` | `:40` 注释、`:41` `const MULTI_VALUES_MAX_VARS = 900;` | ✅ **一字不差** |
| 同文件 `:50-76` `insertMultiValues` | `:50-76` 精确 | ✅ 精确 |
| 台账 `:112-130,366-386,390-400` 与实读差 7 行内 | 实读方法起点 `112 / 366 / 390` | ✅ 精确 |
| `parser.ts:41-55` / astCache `:45-53` | 注释「模板字符串通常数量有限（来自配置），缓存增长可控，不需要 LRU」在 `:43`；`class TemplateParser` `:45`；`astCache` `:46`；`parse` `:48-54` | ✅ 命中（有效区间 38-55 / 46-54，±1） |

#### 病症从代码重推导

**代码现状成立**：三处 `IN (#{id0}, #{id1}, …)` 逐条核对，`messageIds.map((_, i) => \`#{id${i}}\`)` 无任何分块；同文件 `:41` 的 900 常量与 `:226` 的注释（「块大小按 900 变量上限切（≤999，老版 SQLITE_MAX_VARIABLE_NUMBER 也安全）」）确证**同款先例在同文件**。

#### ⚠️ must-fix：失败机理与现役驱动实测不符，连带 I1 无牙、P1 定级依据被抽掉

spec 病症写：「老版 SQLite 的 `SQLITE_MAX_VARIABLE_NUMBER = 999` 会让 id 数超过阈值时**直接报错**（不是变慢，是失败）」，验收 I1 写「旧实现在 1000 左右即抛『too many SQL variables』」。

**本轮实测（desktop 侧真库驱动）：**

```
better-sqlite3 = 11.10.0 ；SELECT sqlite_version() = 3.49.2
40000 个命名占位符 → ERR: variable number must be between ?1 and ?32766
```

⇒ 现役 desktop 驱动的上限是 **32766**，不是 999。后果三条：

1. **I1 无牙**：按 RULE「牙齿判据① 有牙吗」——把实现改回旧形态，I1（「1200 个 id 不抛」）**同样绿**（32766 > 1200）。I1 的括号说明是事实错误。真正有牙的是 **I3**（任一次 `params.length ≤ 900`，旧实现 1200 个绑定必红）与 **I2**（结果等价）。
2. **P1 的紧迫性依据被抽掉**：真实触发面是 `message.service.ts:496`（清空会话，传全会话 id）、`:536`（截尾，传 tail id）、`backfill-baseline-checkpoints.ts:117`（传游标后 segment）。要真炸需单会话 > 32765 条消息 —— 罕见。
3. **mobile 侧未实测**：`op-sqlite` 自带 SQLite，实施时须按同一探针复核（不能照抄 desktop 的 32766）。

**建议 doc-fix**：C2-9 的病症与定级改述为「**防御性封顶 + 与同文件 `:41` 既有 900 口径统一**」，P1 → P2 或保留 P1 但换理由；修法本身（分块器 + 三方法改造）照落，因为它便宜、无 schema 变更、且顺带收窄了 `astCache` 的模板串集合（见下）。
同时把 I1 改为「**要么删掉，要么改成对旧实现也红的形态**（例如把夹具规模提到 33000 条 id，或直接只保留 I3 作差分断言）」。

#### 修法可行完备性（任务点 ③：900 的依据与既有 IN 分块先例是否同款）

- **数值同款 ✅**：同文件 `:41` 的 `MULTI_VALUES_MAX_VARS = 900` + `:226` 注释就是同款先例，注释口径（≤999 留余量）与 spec 逐字一致。**不是凭空拍的数。**
- **单位不同款 ⚠️（建议点名）**：仓内其它 IN/批切块切的是**行数**、不是变量预算——
  `sqlite-session-kkv.repository.ts:35` `GET_MANY_CHUNK_SIZE = 400`（key 数）、`sqlite-vfs-content-store.ts:32` `CONTENT_GETMANY_CHUNK_SIZE = 500`、`sqlite-vfs-revision.repository.ts:37/:40` `100/500`、`sqlite-vfs-entry.repository.ts:171/:798` `200`。
  spec 的 `chunkIdList(ids, fixedVars)` 是**「变量预算 − 固定变量」**口径（仓内首例）。修法本身没问题，但建议在常量注释里点明「本仓 IN 列表按变量数预算切（与 `:41` 同源），与上列按行数切的批操作不是同一口径」，免得后人以为写错了。
- **`fixedVars = 1` 核实 ✅**：三处的 SELECT/DELETE 都只多一个 `#{sessionId}`，块大小 `900 − 1 = 899`，「含 sessionId 共 ≤900」推导正确；「单次调用 arity 上界 899」✅。
- **零 id 早退保持原样 ✅**：`:116-118` / `:370-372` / `:394-396` 三处早退都在。
- **`deleteCheckpointsForMessages` 的顺序修法 ✅ 且事务前提核实成立**：
  `message.service.ts:481-499`（清空会话）与 `:522-541`（截尾）两条**大批量路径都在 `conn.transaction` 内** ⇒ R2 的「现状是单事务」成立，分块后仍是同一事务。
  `message-checkpoint.service.ts:147`（`release` 单条）在事务外，但恒 1 个 id ⇒ 1 块 ⇒ 语义不变 ✅。
  N-4 规则 4（「逐块 DELETE 仍在调用方外层事务内、不新开事务」）✅ 成立。

#### `astCache` 残余：spec 说对了，但漏了加分项

spec 第 6 条注记说「跨调用 arity 集合仍无界 ⇒ 8000 段会喂出最多 8000 种模板串」，**正确**（`parser.ts:46` 的 `Map` 无上界无淘汰）。
但应补一句反向结论：**分片恰恰把这个无界收窄成有界**——块固定 899、末块长度 1..899 ⇒ 每调用点最多 899 种模板串，而今天是 1..N 完全无界。这是 C2-9 的**净收益**，spec 只写了残余面，方向写偏了。
「不在本条做 parser 级 LRU」的边界划分 ✅ 与台账 §10 Wave C 原文一致。

#### 验收可测性（牙齿三判据）

| 判据 | 结论 |
|---|---|
| ① 有牙吗 | **I3 有牙**（差分断言：旧实现 1200 绑定 vs 新实现 ≤900）✅；**I2 有牙**（结果等价 + ref 语义）✅；**I1 无牙 ❌**（见 must-fix）；I4 有牙（边界四档互不相同）。 |
| ② 恒红吗 | I4 的 `id 数 = 0` 早退不发 SQL ✅ 可测；I3 用「包装 `conn` 计数」在真库夹具上可行，不涉及 ESM mock（无 `mock.module` 障碍）✅。 |
| ③ 一夹具一套期望 | 无冲突。R1 要求的「含重复 id 输入与整段版一致」需另起夹具，不能与 I2 的无重复夹具共用同一条用例名——建议在测试策略里点明「重复 id 用例独立命名」。 |

#### 测试策略 / 回归线真实性

新增 `test/message-checkpoint/checkpoint-in-clause-chunk.test.ts`（尚不存在）；复用 `checkpoint-seed-batch-perf.test.ts`（实存，且确为 `insertMultiValues` 的既有分块验证面）口径对齐 ✅。
回归线四组实存：`test/message-checkpoint/`（31 文件）、`test/infra/sql-template/`、`test/vfs/revision-ref-count.test.ts`、`test/chat/`。命令形态符合 N-5 ✅。

#### 其他

- **nit（注释承诺≠实现，Wave E 已有对口座）**：`message-checkpoint.service.ts:142-143` 的 JSDoc 写「`deleteCheckpointsForMessages` 本身就是一条**硬碰硬 SQL**」——分块后变成 N 条，该注释失真。建议在本条测试策略里加一句「同步改这条 JSDoc」。
- **依赖闭合** ✅：「无前置、可独立先落」成立。

---

## 二、core-storage 债务池抽验（ledger §3：P2 17 条 + P3 48 条 = 65 条，抽 10 条 = **15.4% ≥ 10%**）

> §3 只给计数与主题、**不出条目 ID**，故抽验对象取其上游 `synth/core-storage.md` 的 P2 表（CS-12…CS-28 共 17 条）与 P3 分组（G1–G12）。

| # | 条目 | 级 | 代码现状（`fe79b781` 实读） | 定级合理？ | 被 v1.5.29 / 其它条目覆盖？ | 与 spec 重复立项？ | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | **CS-12** `copyVfsTree` overlay 只抬 `head_version` 不 append revision | P2 | ✅ 仍在。`vfs-tree-copy.ts:243-260` 逐行确认：`nextUpdateVersion(repo, revisions, toScope.scopeKey, f.targetPath, null)` + `updateWithContentHash(...)`，无 `revisionRepo.append`、无 `transferLiveRef` | ✅ 合理（四个生产调用方目标皆空 scope，当前不可达；危险公共 API 值得留 P2） | ❌ 未被覆盖 | ❌ 无重复。`wave-c2.md` N-1 只把它**引用**为 CS-07 的另一制造者，未立项 | ✅ 通过 |
| 2 | **CS-14** TDBC port JSDoc 承诺 `NESTED_TRANSACTION` 但实为死锁 | P2 | ✅ 仍在。`connection.port.ts:37` 原文「Nested calls throw `NESTED_TRANSACTION`」；`tdbc-driver-better-sqlite3/src/connection.ts:46-54` 的 `if (this.inTransaction) throw` **确实在 `this.mutex.run(...)` 内部** ⇒ 重入时检查走不到，synth 的死锁判断结构上成立 | ✅ 合理（RULE 已记该陷阱为 intentional，缺陷仅在文档表述） | ⚠️ ledger §9 已提示「数量口径需更新」；**本轮核实第二份实现确在**：`sqlite-message.repository.ts:91` `runInTransactionOrConn`（另有原始份 `revision-aware-vfs.service.ts:302`） | ❌ 无重复。C2-2/C2-9 的「移出事务 / 不新开事务」结论以本条为前提，但**不是同一条目** | ✅ 通过 |
| 3 | **CS-15** `readOpenTagHeader` 不感知引号 | P2 | ✅ 仍在。`parser.ts:223` `const gt = template.indexOf(">", headerStart);` 无引号跳过 | ✅ 合理，但**可实施性依赖拍板项 #7** | ⚠️ ledger 拍板项 #7 已把「生产零使用」**部分证伪**（`sql-template/` 是 31 个 repo 的默认 SQL 出口，零使用的只是动态标签分支）。CS-15 的「生产零使用」仅对动态标签分支成立 ⇒ **台账未标 depends-on-★7，建议补标** | ❌ 无重复（与 C2-9 同文件不同函数） | ⚠️ 通过（补 depends-on-★7） |
| 4 | **CS-19** blob GC 全量物化 + 两表皆无 `content_hash` 索引 | P2 | ✅ 仍在。`sqlite-vfs-content-store.ts:207-221` `DELETE … WHERE content_hash NOT IN (SELECT … UNION SELECT …)`；`vfs-schema.ts:28` 只有 `idx_vfs_entry_scope_path`、`vfs-revision-schema.ts:30` 只有 `idx_vfs_revision_entry` ⇒ **两表 content_hash 索引确认皆无** | ✅ 合理（`vfs_revision` 是全仓最大表，`gc()` 挂 6 条热路径） | ❌ 未被覆盖 | ❌ 无重复。但与 **C2-5（CS-07）有耦合**：synth 自述「不能省掉 entry 侧判定，否则踩 CS-07」⇒ C2-5 落地时应回看本条修法 | ✅ 通过（记一条对 C2-5 的提醒） |
| 5 | **CS-24** `vfs-grep` `matchMode:"auto"` 直 `new RegExp` | P2 | ✅ 仍在。`vfs-grep.ts:39-42` `compileRegex = new RegExp(pattern, flags)`；`:48` 默认 `auto`；`:54-64` 无长度/命中数闸；`:72-83` `matchColumns` 无 `maxColumns` | ✅ 合理（suspected：pattern 由 LLM 决定、Hermes 同进程 UI 线程） | ❌ 未被覆盖 | ❌ 无重复 | ✅ 通过 |
| 6 | **CS-28** `SCHEMA_COLUMN_ALIGNMENTS` 加列无 `sinceBootVersion` 机械化守卫 | P2 | ✅ 仍在。`schema-column-alignments.ts:19` 数组元素**无 `sinceBootVersion` 字段**；`SCHEMA_BOOT_VERSION = 17`（`novel-master-bootstrap.ts:120`） | ✅ 合理（「未来会漏」而非「现在已漏」，本轮 21 条 ALIGN 仍合规） | ❌ 未被覆盖 | ⚠️ **潜在重复**：`SPEC.md` §2 把 `wave-e.md` 列为「防再犯钩子①~⑥ / 注释承诺≠实现」，若 wave-e 已把本条收进钩子 ⇒ 与本池条目重复立项。**需 wave-e 机位/judge 对账** | ⚠️ 通过（标 duplicate-risk） |
| 7 | **P3-G2①** `inferScopeFromPhysicalPath` 零消费 | P3 | ✅ 仍在。`git grep` 全仓只命中定义 `infer-scope-from-path.ts:43`，**零生产零测试引用** | ✅ 合理 | ❌ 未被覆盖 | ❌ 无重复（归 `wave-d` 死码批次，属批次制，合理） | ✅ 通过 |
| 8 | **P3-G2⑥** 三个「索引 DDL 常量」零消费者 | P3 | ✅ 仍在。`message-checkpoint-schema.ts:46` `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL`、`vfs-revision-schema.ts:29` `VFS_REVISION_ENTRY_INDEX_DDL`、`vfs-schema.ts:27` `VFS_ENTRY_SCOPE_PATH_INDEX_DDL` —— `git grep` **三个常量全仓均只有定义、零消费** | ✅ 合理 | ❌ 未被覆盖 | ❌ 无重复 | ✅ 通过 |
| 9 | **P3-G5②** `parseVfsZip` 中央目录失败静默降级到 fflate | P3 | ✅ 仍在。`vfs-zip-parse.ts:41-56`：`catch (centralDirError)` → 无条件 `parseVfsZipViaUnzipSync` ⇒ 跳过严格解析器的 ZIP64 marker / 加密位 / 方法白名单 / STORE 长度校验 | ✅ 合理 | ❌ 未被覆盖 | ⚠️ **部分重叠**：**C2-8 第 0/4 步覆盖了「降级路径要过体积/条数闸」这一半**；G5② 的另两半——①「降级路径至少保留方法白名单」、③「解码异常转 `INVALID_ZIP` 让回退只对结构不识别生效」——**未被 wave-c2 覆盖** | ⚠️ 通过（建议 C2-8 加交叉引用，G5② 剩余半边留池，**避免同一处代码两处立项**） |
| 10 | **P3-G7③+④** `batchAdjustRefCountWithDelta` 插值 SQL + `delta<0` 无下限守卫 | P3 | ✅ 病状仍在。`sqlite-vfs-revision.repository.ts:459-473`：`const deltaLiteral = delta > 0 ? \`+ ${delta}\` : \`${delta}\``（④插值）与 `UPDATE vfs_revision SET ref_count = ref_count ${deltaLiteral} WHERE …`（③无 `AND ref_count > 0`） | ✅ 合理 | ❌ 未被覆盖 | ❌ 无重复 | ⚠️ 通过（**synth 记的行号 `:369-375`/`:430` 已过期**，实读漂到 `:459-473`，约 +43；台账 P3 组内位置字段需刷新） |

**抽验小结**：10/10 代码现状仍在；定级 10/10 合理（CS-15 需补 depends-on-★7）；0 条被 v1.5.29 消化（§9 附录消化的 7 条里没有本簇 P2/P3 抽中的任何一条）；
**2 条存在立项关系**：#6 CS-28 ↔ wave-e 防再犯钩子（潜在重复，待对账）、#9 P3-G5② ↔ C2-8（部分重叠，需交叉引用）。
**债务池无 stale 条目、无虚高定级** —— §3 的 core-storage 计数（17/48）可信。

---

## 三、结论

**组 C 判定：⚠️ Go-conditional**（3 条均非 No-Go；3 处 must-fix 全部是**文档级**改动，不动实现即闭合）

**一句话理由**：三条 P1 的行号、引文、修法方向与验收观测面全部对得上，C2-7 可以直接落；C2-8 的第 0 步位置写对了（闸门不会被 fflate 回退绕过）、声明型 zip bomb 真能拦住，但第 3 步兜底方案已被 fflate 0.8.3 实测证伪为「静默截断」且第 4 步抛点落进 `try` 内会被降级成 `INVALID_ZIP`，两处必须先改；C2-9 的分块修法正确且有同文件 900 先例，但病症的「999 直接报错」被实测推翻（现役 better-sqlite3 11.10.0 / SQLite 3.49.2 上限 **32766**），连带 I1 无牙、P1 定级依据被抽掉，改述 + 换掉 I1 后即可落；债务池抽 10 条（15.4%）全部仍在且定级合理，仅 CS-28 与 wave-e、G5② 与 C2-8 两处立项关系需对账。