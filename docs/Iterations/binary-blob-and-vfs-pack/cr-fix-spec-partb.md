# CR Fix Spec: Part B（VFS 内容打包 + 性能三件）全量 CR

## 元信息

| 项 | 值 |
|---|---|
| repo | `D:\Dev\nm-worktree\f-vfs-pack`（worktree，分支 `feat/vfs-content-pack`，勿切换） |
| base_sha | `9ca5f5ad`（merge-base，main@v1.5.28） |
| head_sha | `b3e27b1c`（merge main 进来的一笔；评审落盘后 HEAD 前进到 `59a57c87`（仅新增本 fix-spec 文档一笔，代码文件逐字未变），diff 校验请按 `b3e27b1c..HEAD -- packages apps CHANGELOG.md` 过滤文档提交） |
| prd_path | 未提供（需求来源为用户口述，见业务 spec 头部） |
| spec_path | `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（Part B + 实现期补充三为本轮基准） |
| review_round | 2 |
| dag_version | 3（wave-1 八路 scope → r1 spec-fix → r2 review-full 复检 → r2 定点修订落盘，复检报告 `cache/cr-r2-full.md`） |
| 评审模式 | scope 全量（八路并行：codec / store / task / schema / apps / tests / spec / merge）＋ r2 review-full 终审；信封一行、报告落盘 `cache/cr-r1-*.md` / `cr-r2-full.md` |
| fix_spec_path | `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-partb.md`（本文件） |
| 状态 | **execute-ready（spec-check-loop r2 judge 判 Go；待用户确认开工）**——CR 侧 fix-spec-ready；spec-check r1 三路分区审（A No-Go / B、C 有条件 Go）的 P0×1 / P1×11 / P2×24 已 doc-fix 落盘，r2 judge 逐条复核 36/36 闭合 + 六处代码抽读全吻合，其残留 P1×1（pbp-3 轮次口径）与 P2×2（pbm-9 文件时序 / 元信息措辞）已按 judge 建议补齐。开工前须用户确认 integrity-repair 二选一 + 开工指令；pbm-7 方案 A/B 拍板属合并轮门禁、不阻塞本轮 |

本轮汇总口径：八路 scope 共返回 P0×6 / P1×18 / P2×24（含跨节点同根因）。主代理去重合并后：**代码缺陷组 P0×2 / P1×12 / P2×19**（`pbp-` 前缀，合计 33 条）＋**合并动作组 P0×4 / P1×5 / P2×2**（`pbm-` 前缀，合并轮执行、不在分支上修）＋**spec 回填组 7 条**（`pbs-` 前缀，改业务 spec.md）＋**发版前门禁组 4 条**（manual/用户拍板）。两条主代理裁决已生效：① store/task 两路的 P0 同根因（put 抽回 ref_count）合并为 pbp-2；② merge 节点 M-06「条目移进 [1.5.29] 段」不采信——1.5.29 已发版打 tag（r2 复检已核 `git tag` 与 `git show v1.5.29:CHANGELOG.md`），未发布功能的条目一律落新建 `## [Unreleased]`（与 pbp-8 同一动作）。codec OQ4/OQ5 的跨 scope 授权：**已授权**（pbp-9/pbp-10 的收口改动跨 store/packing/normalization 三文件，均为本分支 diff 内文件）。

**r2 定点修订记录（按 `cache/cr-r2-full.md` §八清单逐项落盘）**：① pbp-2 改法补 deleteMemberRow 签名与顺序取舍；② pbp-4 改法补空组回滚与 member_count UPDATE；③ pbp-6 改法 SQL 记法改原始插值；④ pbp-3 验收补水位补写口径；⑤ 新增 pbs-7（spec L136 ref_count 纪律）；⑥ 计数 21→19（两处）；⑦ pbp-4/6 维度补 H（含 ON CONFLICT 先例注记）；⑧ 末尾补 H/I/J 维度声明；⑨ pbp-9/10/27 文件行号修正；⑩ integrity-repair deviation 改为显式二选一待拍板。覆盖度对账：八路报告 must-fix 逐条映射已全承载、无漏项（唯一漏项 L-1 已由 pbs-7 补；r2 §八的「38」计数口径与其自身算式不符，以逐条映射表为准）。

**spec-check-loop r1 修订记录（2026-10-01，三路分区审 `cache/sc-r1-{a,b,c}.md` → 主代理 doc-fix）**：分区 A No-Go / B、C 有条件 Go，合计 P0×1 / P1×11 / P2×24，已全部闭合——P0：pbp-3 补既有 W1-P1-1b 用例连带改动登记。P1：pbp-1 推导前提更正（超限成员独占组、只落段 0）；pbp-9 补删除分支测试连带面；pbs-6 扩为三处同改（补 L247）；门禁组 1 改「回捞+回记」（tmp/probe-db.gz 有 5 行落库结果，「无落痕」前提不成立）；pbp-33 替代断言限定 i=1/2；pbp-26 与执行纪律的 docs/apm/ 归属改主代理；pbm-10 验收限定 -- packages apps；pbm-9 补测试文件点名清单；pbm-11 补 L77 + spec 归属改分支版；pbm 组 6 条补验收 + pbp-8 锚点去版本号化；pbp-28 与 pbm-7 拍板时序登记。P2 全部落（计数/行号/锚点符号化/mock 补桩/装配指针/立论修正/同文件串行编排等，逐条见 sc 报告）。

> 执行纪律：本 fix-spec 由 code-dev-loop 执行时，`pbp-*` 在本分支（f-vfs-pack）修；`pbm-*` 只在合并回 main 的那一轮执行（分支上不做）；`pbs-*` 改本分支上的业务 spec.md；门禁组不阻塞 dev-ready。子代理一律不 git 写；**`docs/apm/` 的写入由主代理执行**——pbp-26（RULE.md VFS 打包条目口径对齐）虽属分支波条目，但落盘动作必须由主代理做，子代理只产出改后文案交主代理写盘（`docs/apm/` 纪律见 RULE「子代理不得写 docs/apm/」）。`pbs-*`（业务 spec.md）与 `pbm-*` 不受此限。

> **执行记录（2026-10-01，code-dev-loop dev-ready）**：执行范围 pbp-1~33 + pbs-1~7 + pbp-26 全部落地，提交链 00fb0a1e → 80243a6f → c5c93e10 → 326c9277 → 77692d03 → f8f71244 → 728d4218 → db67d179（wave-0~6 + desktop cr-05 竞态修复）；pbm 组与门禁组未越界实施。实现期偏差（均已记录于 cache/dev-w*.md）：pbp-4 空组处置选「事务内显式 DELETE pack 行」而非哨兵错（packOneGroup 无组级 catch，哨兵会抛穿整轮、违反「不中断」硬约束）；pbp-23 落 limit 分批+换 entry 早退、入口保持全量单批（完整 Map 喂收尾归因的语义不动）；pbp-31 的 T-VP2b 落在 content-store-pack.test.ts（避免与并行节点同文件）；T-VP13 红灯根因 = 任务读明文写入 decoded-content-cache 致断言热态命中（RULE「缓存后换观测面」家族坑实例，pbp-32 顺带冷态化+计时放宽 200ms fflate 口径）。verify：core 3115/3117（唯二红=usage-stats 时区既有基线）、desktop 631/631 全绿（cr-05 竞态确定性修复=补丁安装提前到删标记/插行之前，时序敏感实测）、mobile 1747/1750（3 红=worktree CRLF 行尾环境红，主仓同件绿、被测面分支 diff 零）、tsc 四处绿（renderer 422 为既有债族，对 main 基线 411 净增 1 条 TS6307=新测试 import main 服务同族形态）、core dist 已重建（中途一次漏 --noEmit 的 tsc 在 mobile src 吐 1288 个产物已按「untracked+同名源」判据清零）。cr-func 终检 func-ready: yes（矩阵 33/33+7/7+1/1、5 条牙齿抽查、独立复跑 tsc/eslint 绿）；minor D4=spec L340 措辞按 pbs 指示顺带改述（L77 常量名留分支形态正确，pbm-11 合并轮补齐）。**待用户**：integrity-repair 二选一 / pbm-7 方案 A/B / 合并轮（pbm 组）/ 门禁组（Hermes 探针回记、真机验收、不可降级确认）。

---

## Must-fix · 代码缺陷组（pbp-，在本分支修）

### pbp-1 [P0] fossil `applyDelta` 无输出规模闸门：几百字节坏 pack 行可把宿主进程 OOM 打死

- 维度：B + D（安全）
- 文件：`packages/core/src/domain/vfs/content-store/logic/pack-codec.ts:247-253`（`decodeFossilChainSpans` 链式 apply 循环；`inflateFossilSegment` 在 261-269）
- 问题：`fossil-delta` 的 `applyDelta` 只信 delta 头自述的 `limit`（上界 2^32-1），输出规模与 delta 字节数、source 长度无任何比例约束。实测放大稳定 ~10,900×（4.8KB delta → 50MB 输出、heap 1.36GB）；把声明拉到 4GB 约需 400KB 高度重复的 copy 指令流，zlib 压缩比 ~1000:1 → **pack 行里约 400 字节的坏段即可一次 `contentStore.get()` 打死 desktop main 进程**（catch 不住的堆耗尽）。pack 永不重写 → 一次坏数据永久毒化每次读；`verifyVfsContentPacks`/`unpackVfsContent` 走同一条路，应急工具在最需要时变成崩溃源。段表的严校验挡不住它（段内容是合法 zlib 流，inflate 会成功）。定级依据（codec OQ1 主代理裁决）：本仓 spec 自认坏组存在（failedGroups 机制）且库文件存在跨设备拷贝/位翻转通路 → 按 P0 处理。
- 改法：`pack-codec.ts` 加模块级常量 `FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES = 1024 * 1024`；`decodeFossilChainSpans` 循环里 apply 前先 `getDeltaTargetSize(delta)`（fossil-delta 具名导出，`inflateFossilSegment` 的返回需提成局部变量再取 size），超过上限抛含「超过上限」与段号的 Error。**【r3 修订·推导前提更正】**闸门依据不是「单成员必 <1MB」——写侧对单成员超限有容错（`chunkCandidateGroups` 的 `current.length > 0` 前置让首个成员再大也收进组，`vfs-content-packing.ts:26-28/293-305`），真正成立的不变量是「**超限单成员必独占一组 → 只落 fossil 段 0、永远不经 applyDelta**」，故任何进入 `applyDelta` 的段其 targetSize 必 < `GROUP_PLAIN_BYTES_LIMIT`。常量注释按此措辞写，并补一句方向性提醒：「写侧若允许超限成员与他人同组，必须同步放宽本常量」。两处常量各写一句交叉引用注释（codec OQ2 采 (a) 方案：接受隐式耦合 + 注释互指，不起共享常量模块）。不要动 `verifyChecksum`。
- 验收/测试：`content-store-pack.test.ts` 防御用例加一条——手工构造 fossil pack（段 0 正常 + 段 1 伪造 delta 头声明 `limit=4_000_000_000` + copy 指令），断言抛含「超过上限」的 Error 且进程 `heapUsed` 增量 <50MB；牙齿自检：上限临时改 `Number.MAX_SAFE_INTEGER` 必须变红；`vfs-content-packing.test.ts` 回归全绿（正常 pack 每段 targetSize == 成员明文长，闸门不误伤）。
- 来源：cr-r1-codec#pb-codec-D-1

### pbp-2 [P0] put 抽回落 blob 行时不回算 ref_count：删 revision 撞 CHECK 失败 / 无 CHECK 时误删仍被引用的 blob 行（已复现）

- 维度：B
- 文件：`packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:92-111`（INSERT 语句 98-105）；增量部分在 `packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts:1033-1100`（unpackVfsContent）
- 问题：`ref_count` 只由 revision 三触发器维护，但 put 的回滚抽回路径（目标 hash 已是 member、blob 行不存在）INSERT 新 blob 行时该 hash 早已被若干 `vfs_revision` 行引用（当初 INSERT 时触发器 UPDATE 静默命中 0 行）→ blob 行 ref_count 落 0。后续删任一引用 revision → 触发器 `ref_count - 1` → 撞 `CHECK (ref_count >= 0)` 事务回滚（better-sqlite3 最小模型已复现 `CHECK constraint failed: ref_count >= 0`）；即便无 CHECK，触发器第二句会把仍被引用的 blob 行删掉 → 正文不可读。同仓正确先例：unpack 的 `INSERT ... (SELECT COUNT(*) FROM vfs_revision WHERE content_hash = ?)`。增量缺陷：unpack 只重算**自己 INSERT 的行**（`INSERT OR IGNORE` 命中既有行跳过），pbp-2 造成的 ref_count=0 残行 unpack 救不回。
- 改法：① put 的 INSERT 分支按「是否命中 member（=是否抽回）」分流——member 行存在时用 `(SELECT COUNT(*) FROM vfs_revision WHERE content_hash = #{contentHash})` 作为 ref_count 初值；**不要**把 COUNT 子查询无条件挂进每次 put 热路径（vfs_revision 无 content_hash 索引——`idx_vfs_revision_entry` 只在 entry_id 上，COUNT 是全表扫）；全新内容沿用 DEFAULT 0 原语句。**【r2 修订】「member 行存在」的判定二选一，必须显式选定**：(a) 把 `deleteMemberRow`（`sqlite-vfs-content-store.ts:410`，现返回 `Promise<void>`）签名改为 `Promise<boolean>`（`executeTemplate` 结果的 `.changes > 0`，`gc()` :404-406 同款用法），并**把 delete 提到 INSERT 之前**——:107-109 的「此刻删除」注释随之改述为「先删 member 再落 blob 行，中间崩溃窗口为无权威副本，put 幂等保活会自愈」；(b) 保持现有顺序，INSERT 前用一次轻量 `SELECT` 判 member 行存在（多一次查询、零时序变化）。推荐 (a)。② unpackVfsContent 事务内删 member 后（:1089 之后、memberRows 已在事务外读出）追加幂等修复：`UPDATE vfs_content_blob SET ref_count = (SELECT COUNT(*) FROM vfs_revision r WHERE r.content_hash = vfs_content_blob.content_hash) WHERE content_hash IN (本 pack 成员 hash)`。
- 验收/测试：构造 member-only hash H + 2 条引用 H 的 active revision → `put(H 的明文)` 抽回 → 断言 blob 行 ref_count==2；删 1 条不抛且 ref_count==1；删最后 1 条按触发器语义归零删行。反例自检：故意写回 ref_count=0 的 INSERT，断言第 3 步 DELETE 确实抛 CHECK。unpack 增量用例：造 ref_count=0 残行 → 跑 unpack → 断言 ref_count==COUNT 且后续 DELETE 不抛。**【r3 交叉登记】** pbp-22 把 unpack 改为默认 dryRun 后，本条新增的 unpack 用例必须改传 `{force:true}`（否则零写即过的假牙），pbp-22 验收同步登记。
- 来源：cr-r1-store#pb-store-B-1 + cr-r1-task#pb-task-B-4（同根因合并）

### pbp-3 [P1] 零候选水位 TOCTOU：指纹在谓词扫描之后采样，可把「有候选」形态钉成零候选水位、候选静默永久漏打包

- 维度：B
- 文件：`packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts:793-812`（收尾判定+写水位）、555-568 → 468-509（采样点）
- 问题：水位正确性前提是「写下水位时观察到的数据面 = 零候选扫描所覆盖的数据面」。当前时序：两次 `collectCandidateEntries`（入口+收尾）与指纹采样之间无事务无快照——收尾扫描返回 0 之后、指纹采样完成前落一个新版本，则指纹记录的是写入之后的数据面（revisionCount/blobCount/entryHeadDigest 已变）→ 下轮入口指纹比对**相等 → 短路谓词**，而 watermarkHit 分支不重扫 → 该候选永远不进打包（同一 entry 攒到下一个 ≥2 阈值前无变化打破水位）。不丢数据，但静默漏掉压缩收益 + 状态行误显「无需处理」。
- 改法：指纹采样挪到扫描**之前**（入口顺序固定：`:737` 水位查询 → `:738` 采 `fingerprintBefore` → 入口扫描；`watermarkHit === true` 时收尾段整体沿用现状——不采 `fingerprintAfter`、不写不清水位、`remaining` 仍取 0，避免稳态白算两次指纹）；收尾 `remaining===0 && failedGroups===0` 时再采 `fingerprintAfter`，前后一致才 `writeZeroCandidateWatermark(fingerprintBefore)`（改为接收指纹参数、去掉内部重算），不一致则 `clearZeroCandidateWatermark` 让下轮全扫。`matchesZeroCandidateWatermark` 与 status 短路路径不动。
- **【r3 修订·既有用例连带改动（P0 补登记；轮次口径经 sc-r2-judge 补全）】** 改法落地后，既有 `W1-P1-1b`（`vfs-content-packing.test.ts:997-1037`）的 `:1029-1032`「再次收敛后水位应重写」与 `:1036`「重写后的水位应继续生效（零谓词）」两条断言**不再成立**——打包轮有写入时 before≠after、水位本轮被清。执行时必须同步改写：① 打包轮跑完后断言水位**不存在**（`assert.equal(await kkv.get(..., 'zeroCandidateWatermark'), null)`）；② **再插入一轮空轮**（这一轮走完整扫描、收尾 before==after 把水位补写上），**再下一轮**才断言 `predicateQueries() === 0`——轮次链 = 打包轮（清水位）→ 补写轮（全扫 + 写水位）→ 短路轮（谓词 0）；既有 `:1034-1036` 的 `again` 探针必须挂在**短路轮**上（在 `:1029` 断言与 `again` 之间多插一次 `await runVfsContentPacking(...)`）。改法本身不变。
- 验收/测试：在「收尾扫描之后、指纹采样之前」注入一条 revision+blob 写入（用现有 SQL 拦截式 fake conn 的匹配钩子），断言本轮没写水位、下轮谓词真执行且该候选被打包；正向用例口径（r2 修订）：**「本轮无任何写入（含打包落库本身）时水位照写、下轮短路；本轮有打包写入时 before≠after、水位本轮必不写、下一轮空轮补写」**——不得把正向用例理解成「跑完一轮打包后仍应写水位」（打包落库会改 packCount/blobCount，指纹必不一致）。
- 来源：cr-r1-task#pb-task-B-1

### pbp-4 [P1] member INSERT 缺幂等等价物：主键冲突抛穿整轮（desktop rebootstrap 双循环并发可造出；CLI 命令直接失败）

- 维度：B + C-orch + H（兼容性：`ON CONFLICT ... DO NOTHING` 需 SQLite ≥3.24——mobile 侧 workplace/session-kkv/kkv 仓储早已在用同款 upsert 且是热路径，本条不新增兼容地板，r2 复检已核实先例）
- 文件：`packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts:677-693`
- 问题：骨架（blob 归一）的幂等由「谓词进 WHERE」免费得到；打包把谓词搬到 JS 侧先读后写，丢了保障且无等价物——`content_hash` 是 member 主键，重复 INSERT 是硬错误 → 组事务回滚 → 异常穿透整轮。可达路径：desktop rebootstrap（备份导入/云同步 pull）换连接时旧循环在 `isConnectionClosedError` 分支 continue 重取新 runtime 继续跑，而 `scheduleDesktopVfsContentPacking` 已为新 runtime 起第二条循环——两循环同连接并发推进可采到同批候选；外部手工 unpack 与打包任务并发同理。
- 改法：事务内 member INSERT 改 `ON CONFLICT(content_hash) DO NOTHING`，`res.changes > 0` 收进 `claimed` 集合（`ExecuteResult.changes` 在 :1083 已有同款用法）；`DELETE FROM vfs_content_blob` 只作用于 claimed 的 hash（未收编的 blob 行本就不归本组删）。**【r2 修订】现有语句顺序是先 INSERT pack 行（:664，拿 `lastInsertRowid`）再逐 member INSERT，因此两句收尾动作必须按下述执行、不得照 r1 原文**：① `claimed.size === 0` 时**抛哨兵错让组事务整体回滚**（或事务内显式 `DELETE FROM vfs_content_pack WHERE pack_id = ?`），**不得裸 return**——裸 return 会提交一个孤儿 pack 行；② pack 行的 `member_count` 已按 `utf8s.length` 落库，需补 `UPDATE vfs_content_pack SET member_count = ? WHERE pack_id = ?`（按 claimed.size）；`encoded.spans[index]` 仍按原 group 下标取、编码产物不重排。
- 验收/测试：预置「某 hash 既有 member 行又有 blob 行」跑任务——不抛、其余成员照常落库、无重复 member、被跳过 hash 的 blob 行仍在、done=true；并发用例（`Promise.all` 两轮同批候选）降为**可选补充**并注明「同连接并发起跑可能先撞事务互斥（better-sqlite3 嵌套事务抛 NESTED_TRANSACTION）而非主键冲突」，主判据以「预置 member 行 + 单轮任务」的确定性用例为准。
- 来源：cr-r1-task#pb-task-B-2

### pbp-5 [P1] stalled 判据在并发写下不成立：用户保存新版本即误判 stalled，连带跳过收尾 VACUUM（本轮空间收益留在库里不还）

- 维度：B
- 文件：`packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts:706-722`（不变量注释）、793-819（判据）、821（挂维护）
- 问题：推导「剩余候选 entry ≤ failedGroups」只在「本轮没有新数据写入」时成立——一次保存就把旧 head 的 hash 变成非 head 候选，攒到 ≥2 个不同非 head hash 的 entry 在收尾重扫里新增 → `remaining > failedGroups` → 误判 stalled → 两端调度本进程停手 + `done=false` 跳过收尾维护（freelist 页不归还文件系统）+ failedGroups 快照不写。首轮迁移扫描以秒计，期间 agent/云同步/聊天都在写 VFS，触发概率不低。
- 改法：`VfsPackCandidateEntry` 加 `maxVersion`（谓词已 SELECT `r.version`，数据现成），入口扫描记 `Map<entryId, maxVersion>`；收尾判据改为只对「本轮开始时已存在且期间无新版本」的 entry 生效（`before != null && e.maxVersion === before`），`stalled = attributable.length > failedGroups`。写水位前置条件维持「`tailEntries.length === 0`」全库口径不变。
- 验收/测试：任务期间向某 entry 追加更大版本号，断言 `stalled===false && done===true && maintCalls===1`；保留 T-VP20（真打转）`stalled===true` 不回归。
- 来源：cr-r1-task#pb-task-B-3

### pbp-6 [P1] findExistingBlobHashes 的 UNION ALL 双 IN 单语句绑参 1000，越过老版 SQLite 999 变量上限（老 Android 机型必踩）

- 维度：B + H（兼容性：老 Android 系统 SQLite 变量上限）
- 文件：`packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:325-337`
- 问题：`CHUNK_SIZE=500` × 两个 IN 子句 = 1000 变量；`SQLITE_MAX_VARIABLE_NUMBER` 在 SQLite 3.32 前默认 999，Android 系统 SQLite 到 API 31 仍是 3.28 一线（op-sqlite 走系统 SQLite）。调用方（seed-live-head-revisions / seed-fork-copy-parity / vfs-tree-copy）传整 scope hash 列表轻松过 500。仓内既有纪律：checkpoint repo 的多值块上限 900、各处 chunk 500 压在 999 内——新代码是全仓第一处越线。
- 改法（推荐）：IN 过滤外提到 UNION 子查询外层——`SELECT content_hash FROM (SELECT content_hash FROM vfs_content_blob UNION ALL SELECT content_hash FROM vfs_content_pack_member) WHERE content_hash IN (${placeholders})`。**【r2 修订】本函数走 `this.conn.query` 原始 `?` 位置参数 + 字符串插值（:328 `chunk.map(() => '?').join(',')`），不经 SqlTemplateParser——占位符必须用 `${placeholders}` 字符串拼接（非 `#{}` 模板记法），绑参收敛成单份 `[...chunk]`（500 变量/语句）**。（备选：CHUNK_SIZE 降 400，不推荐。）
- 验收/测试：补 chunk 满载 500 个已打包 hash 全判已存在的用例；防回归断言按「单语句实际绑定变量数 ≤500」写（推荐方案落地后语句只有 500 一档，无 400 档——那是备选方案的参数，勿在验收里找）。
- 来源：cr-r1-store#pb-store-B-2

### pbp-7 [P1] assertMinimumBaseline 被 hasBaseline.some() 短路：v1.3.10~v1.4.06 老库（有 saved-model-identity-v1 登记但 vfs_entry 无 content_hash 列）仍吃裸 no such column

- 维度：B
- 文件：`packages/core/src/bootstrap/novel-master-bootstrap.ts:328-340`（+375 调用点）
- 问题：`BASELINE_MIGRATION_IDS.some()` 任一命中即 return，而 `saved-model-identity-v1` 从 v1.3.10 起登记、`content_hash` 列 v1.4.07 才有——这类库 `detectLegacyShape` 不被求值，随后慢路径 DDL 的 `CREATE INDEX idx_vfs_entry_content_hash ON vfs_entry(content_hash)` 裸炸 `no such column`。本轮 commit 732579ea「别顶掉友好提示」只修了零登记形态，部分登记形态漏了。
- 改法：加 `hasVfsEntryWithoutContentHash(tx)` 专用探测（sqlite_master 查 vfs_entry 存在 + pragma_table_info 查无 content_hash 列），判定放在 `hasBaseline` 提前 return **之前**抛 `BASELINE_TOO_OLD_MESSAGE`。不动 some() 语义；`T-BL2`（fixture 无 vfs_entry 表）不受影响。
- 验收/测试：`vfs-entry-content-hash-index.test.ts` 加第 6 例——legacy vfs_entry + INSERT 一条 `BASELINE_MIGRATION_IDS[0]`，断言 `bootstrapNovelMaster` 抛 `BASELINE_TOO_OLD_MESSAGE`；牙齿自检：注释掉新探测必须变红（错误文案变成 no such column）。回归 `baseline-check.test.ts` 全量 **8 例**（非 6——`:33/:48/:62/:76/:90/:104/:121/:129`）、`provider-table-snapshot.test.ts`、`vfs-content-pack-schema.test.ts` 3/3。
- 来源：cr-r1-schema#pb-schema-B-1

### pbp-8 [P1] CHANGELOG 的 `## [Unreleased]` 标题被 merge b3e27b1c 吃掉：Part B 条目埋进已发布的 [1.5.28] 段、且段内出现两个 `### 变更`

- 维度：A + K
- 文件：`CHANGELOG.md:28-36`
- 问题：`## [1.5.28]` 已定稿并打 tag v1.5.28；merge 把主干段落并进来时吃掉 Unreleased 标题，只留条目 → 未发布功能被写进已发布段（git show v1.5.28:CHANGELOG.md 无此条，已核实）；下次发版按「Unreleased → 版本号」搬移找不到条目。**主代理裁决**：merge 节点「移进 [1.5.29] 段」的建议不采信——1.5.29 亦已发版打 tag，条目必须落**新建的 `## [Unreleased]`**。
- 改法：在**文件顶部最新已发布段之前**（分支波时为 `## [1.5.28]`，合并后为 `## [1.5.29]`——按「顶部已发布段」定位、勿写死版本号）新建 `## [Unreleased]` + `### 变更`，条目原文照搬；删除 1.5.28 段内的重复 `### 变更` 标题与条目。（合并轮的段叠放动作见 pbm-6，两者不重复做。）
- 验收：`findstr /n "Unreleased" CHANGELOG.md` 命中且行号在顶部最新已发布段之前；该已发布段内 `### 变更` 只出现一次；`git show v1.5.28:CHANGELOG.md` / `v1.5.29` 均不含本条目。
- 来源：cr-r1-schema#pb-schema-A-1（裁决修正 cr-r1-merge#M-06）

### pbp-9 [P1] format 分派逻辑两份逐字近似 + `VfsPackFormat` 死类型：收口 pack-codec 唯一导出口

- 维度：C + C-orch
- 文件：`pack-codec.ts:29-32`（死类型，生产零引用）；`sqlite-vfs-content-store.ts:43-55`（decodePackMemberPlaintexts）；`vfs-content-packing.ts:939-951`（decodePackMembersByFormat）
- 问题：format 值域+未知值防御是 pack-codec 自己的格式契约，却被两个 impl 各写一份——新增第三个 format 时漏一处就是「读路径认得、写侧不认」的静默分叉；`VfsPackFormat` 导出了没人用。
- 改法：pack-codec 新增导出 `decodePackMembers(format: string, packBytes, spans): Uint8Array[]`（内部按两常量分派、未知值抛「不支持的 vfs_content_pack.format」）；两处 impl 的私有分派函数删除改调它（`vfs-content-packing.ts:56-59` 对 `decodeFossilChainSpans`/`decodeZlibConcatSpans` 的未使用导入须同步清理）；`VfsPackFormat` 在收口后要么真被用上（decodePackMembers 上方窄化类型）要么删除，二选一，不允许继续「导出了没人用」。**【r3 补·连带面】** 选「删除」分支时必须同步改 `packages/core/test/vfs/content-store-pack.test.ts`（`:19` 删类型导入、`:54` `insertPackRows` 形参改 `format: string` 并在函数内按常量收窄），否则测试编译红；选「收口后真被用上」分支则无需动测试。跨 scope 改动已授权（codec OQ4）。
- 验收：`git grep -n "decodePackMemberPlaintexts\|decodePackMembersByFormat"` 为空；`git grep VfsPackFormat` 至少命中定义+一处真实使用（或删除分支下零命中且测试同步改）；两组测试全绿；`npx tsc --noEmit -p packages/core` 绿；牙齿自检：fossil 分支临时改抛错两组测试必红。
- 来源：cr-r1-codec#pb-codec-C-1

### pbp-10 [P1] `errorText` 第三份逐字副本：收口 `common/error-text`

- 维度：C（DRY）
- 文件：`zlib-accelerator.ts:37-39`、`packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:376`、`packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts:202`（三份私有副本；**注意全路径——node_modules 有 @novel-master/core 同名自链副本，勿改错文件**）
- 改法：新建 `packages/core/src/common/error-text.ts` 唯一实现（带 @module 注释），从 `common/index.ts` barrel 导出；三处删本地副本改 import（相对路径或 `@/` 以 `npx tsc --noEmit -p packages/core` 通过为准）。跨 scope 改动已授权（codec OQ5）。
- 验收：`git grep -n "function errorText"` 只命中一处；core tsc 绿；`zlib-accelerator.test.ts:191-198` 告警断言（依赖文案）绿。
- 来源：cr-r1-codec#pb-codec-C-2

### pbp-11 [P1] mobile 打包调度缺「循环退出即释放登记键」finally：收手后再调度静默 no-op

- 维度：C-orch
- 文件：`apps/mobile/src/services/vfs-content-packing.service.ts:107-115`（对照 `message-content-compaction.service.ts:93-99` 的正确形态）
- 问题：mobile 侧同语义三种写法（compaction 有条件 finally、packing 照抄更老的 blob 形态、desktop packing 反而有 finally）。爆炸半径今天有限（effect 依赖 [runtime]），但打包循环常态就是 done=true 收工——之后任何同 runtime 再调度（新增调用点/retry 复用/「立即收敛」按钮）会被无声吞掉，状态行显示剩余 N 组但没人搬。desktop 的 cr-05 已修过同款坑，mobile 等于复制了一遍。
- 改法：照 compaction 服务改条件 finally（`if (scheduledRuntime === runtime) scheduledRuntime = undefined`）；服务头注释补「登记键只在循环存活期间去重，收手后释放」。可选同批对齐 blob-binary-normalization.service.ts（同分叉另一半）。
- 验收：新增 `apps/mobile/__tests__/vfs-content-packing.service.test.ts`（**文件由本条建骨架，pbp-29 只在其上追加用例、不重复新建**）——同 runtime 连调两次只起一条循环；收手后再调重新起循环（core 入口被触第二次）。**【r3 补】** mock 面除 core 与 `isMobileAgentActive` 外还须桩掉 `@/services/db-maintenance-busy`（服务 `:34` import 了它，照 `message-content-compaction.service.test.ts:20-28` 版式补 `jest.mock('@/services/db-maintenance-busy', () => ({isMobileDbMaintenanceBusy: () => false}))`），否则测试环境加载真实模块。
- 来源：cr-r1-apps#pb-apps-C-1

### pbp-12 [P1] T-VP7 缺失：回滚链路在 pack 形态下零覆盖（spec 承诺 blocking: yes）

- 维度：G + A
- 文件：`packages/core/test/infra/vfs-content-packing.test.ts`（追加用例）
- 问题：spec L252 承诺 T-VP7（resetHeadToVersion / restore-path / revive-deleted-entry / checkpoint capture-restore / sweepSessionRevisions 在 pack 形态下全绿，blocking: yes）；`git grep "T-VP7"` 只命中 spec 自身。两张 pack 表只被本轮新测试构造，既有回滚套件跑纯 blob 形态——「既有回归全绿」证不了新形态下 member 分派在这些链路上走得通。
- 改法：追加「T-VP7：已打包 entry 的回滚/复活/checkpoint 链路」用例：seedEntry（4 历史版本+head）→ `runVfsContentPacking` 收敛（成员全进 member、blob 行已删）→ 依次跑 resetHeadToVersion（应触发 put 抽回）/ restore-path / revive-deleted-entry / checkpoint capture→restore / sweepSessionRevisions → 每步断言 `contentStore.get(该版本 hash)` 与原明文逐字节等值 + member 行数期望增减（抽回 −1、GC 归零时 pack 消失）。**【r3 补·装配口径】** 夹具沿用 `rollback-ref-count.test.ts` 版式——`SqliteVfsEntryRepository` + `SqliteVfsRevisionRepository` + `SqliteVfsContentStore` + `revision-aware-vfs.service` 跑 `resetHeadToVersion`，checkpoint 段用 `SqliteMessageCheckpointRepository`，`sweepSessionRevisions` 直接调 domain 函数；不需要起 message service 全链。
- 验收：至少一条用例在「成员已全部落 member」数据面上跑完五条链路全绿；仅跑旧形态回滚套件不算。
- 来源：cr-r1-tests#pb-tests-G-1 + cr-r1-spec#D1（同条合并）

### pbp-13 [P1] T-VP6 漏「超限文件仍走占位」半句：compressed_byte_len 复制口径的唯一理由零测试兜底

- 维度：G + A
- 文件：`packages/core/test/vfs/content-store-pack.test.ts:563-620`（追加）；消费端 `domain/workplace/logic/load-or-fill-file-cache.ts:176-207`
- 问题：spec L251 括注的两件事只覆盖了①（不回退 delta 长度）；②「闸门口径不变，超限文件仍走占位」零覆盖。**【r3 立论修正】** blob 形态的超限占位已由 `load-or-fill-file-cache.test.ts:72/96` 与 `assemble-workplace-display.test.ts:460` 覆盖（「grep 零命中」说法不实）；本条要补的只是 **pack/member 形态**——member 回退值若被改坏（如回退 `length` 段长），`probeOversizePlaceholder`（`load-or-fill-file-cache.ts:199`）会静默失真、超大文件被放行。
- 改法：T-VP6 内追加（或新 it）：直插 `compressed_byte_len` 必超 `CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES` 的 member + 必不超对照组；entry 指向该 hash（blob 行不存在）；经 `loadOrFillFileCache` workplace 链路读 path，断言超限组返回占位 body 含「已跳过，约」、对照组返回真实正文。
- 验收：把回退值临时改成 `memberRows[0].length`，超限组断言必须变红。
- 来源：cr-r1-tests#pb-tests-G-3

### pbp-14 [P1] T-VP19 断言弱化：析取 + 自推期望，预算粒度实现自由度被放任

- 维度：G
- 文件：`packages/core/test/infra/vfs-content-packing.test.ts:562-565`（析取）、`:575-580`（自推期望）
- 问题：`interrupted.done === false || interrupted.packedGroups < 3` 两分支任一——当前实现下 `syncBudgetMs:0` 必然「打完 1 组即收手」（组粒度预算检查），是确定口径却写成析取，实现改成 entry 粒度检查仍绿；resumed 期望用上一轮实测值自推，两轮都打 0 组时恒成立。
- 改法：`:562-565` 换确定口径 `deepEqual(interrupted, {done:false, packedGroups:1, failedGroups:0, stalled:false})`；`:575-580` 改守恒式 `interrupted.packedGroups + resumed.packedGroups === 3` + 显式 done/failedGroups/stalled 断言（interrupted.packedGroups 提成具名常量共用）。
- 验收：把 `vfs-content-packing.ts` 中 `packOneGroup` 调用之后的组粒度预算检查 `if (Date.now() >= deadline) return { done: false, packedGroups, failedGroups, stalled: false };`（HEAD `b3e27b1c` 下约在 :786，**按符号定位不要按行号**——前序波次 pbp-3/4/5 的同文件改动会使行号漂移）挪到 entry 粒度（或删掉），本用例必须变红。
- 来源：cr-r1-tests#pb-tests-G-2

### pbp-15 [P2] `decodeZlibConcatSpans` 缺空 spans 短路（与 fossil 版不对称，白做整组 inflate + 污染计数探针）

- 文件：`pack-codec.ts:107-117`
- 改法：计数自增前加 `if (spans.length === 0) return [];`（与 fossil 版 217-219 同形），`@returns` 补口径句。
- 验收：在 `packages/core/test/vfs/content-store-pack.test.ts` 的「pack-codec: T-VP11」describe 内加一条——`__resetVfsPackDecodeCountersForTests()` 后 `decodeZlibConcatSpans(concat.bytes, [])` 断言返回 `[]` **且** `__getVfsPackDecodeCountersForTests().zlibConcatInflates === 0`；牙齿自检：注释掉 `:111` 前的空 spans 短路，该用例必须变红。
- 来源：cr-r1-codec#pb-codec-B-1

### pbp-16 [P2] fossil 段 applyDelta/inflate 错误无上下文包装（裸 "bad checksum" 冒泡，链路末端可诊断性断崖）

- 文件：`pack-codec.ts:242-269`
- 改法：加 `segmentError(index, segment, phase, error)` 段级包装（含段号+offset/length+底层原因，`{cause}` 保底），inflate 与 applyDelta 各包 try/catch 重抛；`errorText` 复用 pbp-10 公共件。
- 验收：在 `content-store-pack.test.ts` 的防御用例内加一条——取 `fossil.bytes` 的段 2 区间，**在其 deflate 数据体中段（非流尾 4 字节 adler32）翻转 1 个字节**（如 `offset + Math.floor(length/2)`），断言抛错消息同时含 `段 2` 与 `inflate 失败`。**必须避开流尾 4 字节**：fflate 不校验 adler32，翻转会静默返回正确明文而不抛（`cache/cr-r1-codec.md` §0.4 已留档），该位置翻转会得到恒绿断言；首版不抛时改翻偏移、勿放宽断言。pbp-1 的「超过上限」用例断言消息含 `段 1`（两处上下文叠加，不冲突）。
- 来源：cr-r1-codec#pb-codec-E-1

### pbp-17 [P2] `level` 参数全链路未使用（死代码 + 宿主死分支 + 零覆盖）

- 文件：`zlib-accelerator.ts:25,74-77`、`zlib-codec.ts:34`、cli/desktop 两处宿主三元分支
- 改法：方案 A（推荐）——`zlib-accelerator.test.ts` 补 `tryZlibDeflate(TEXT_PLAIN, 9)` 往返断言 + 两宿主适配器补「level 透传预留」注释；或方案 B——全链路删 level 形参与死分支。二选一，注释与最终形态一致。
- 验收：A 案见测试命中带 level 调用；B 案 grep level 无输出；5 例全绿。
- 来源：cr-r1-codec#pb-codec-C-3

### pbp-18 [P2] 限频告警闩锁不随 `clearZlibCodecAccelerator` 重置（文档不符 + 测试顺序依赖隐患）

- 文件：`zlib-accelerator.ts:34,67-69`
- 改法：clear 时一并 `warned.deflate = false; warned.inflate = false;`，`@remarks` 改「告警闩锁按注册期计，注销即复位」。
- 验收：牙齿自检（必须做）——在 `:170` 用例前临时插一段「注册 throwing 加速器触发一次 deflate 抛错」，加复位的版本仍全绿、不加的必须变红。
- 来源：cr-r1-codec#pb-codec-C-4

### pbp-19 [P2] 段表防御分支四条零覆盖（含唯一防大数组分配的闸门）

- 文件：`content-store-pack.test.ts:243-267` 追加；对应 `pack-codec.ts:173/182/186/234`
- 改法：四条断言——`byteLength<4`；段数置 0；段数置 0xFFFFFFFF（同时断言 heapUsed 增量 <20MB）；offset 对 length 不符。加「段表长度区不完整」subarray(0,4) 用例。
- 验收：逐条改坏闸门条件（如 `<` 改 `<=`）断言逐条变红。
- 来源：cr-r1-codec#pb-codec-B-2

### pbp-20 [P2] `segmentIndexByOffset` 的 key 唯一性前提无注释（零长段撞车推理链只在读者脑子里）

- 文件：`pack-codec.ts:221-224`
- 改法：按报告给定的注释备案（写清「各段 length>0 由写侧保证；坏 pack 零长段撞车时仍是响亮失败非静默错读」）；`parseFossilSegmentTable` 的 @remarks「严格校验」措辞收窄为「段表自洽，不含段长>0」。
- 验收：纯注释；tsc 绿。
- 来源：cr-r1-codec#pb-codec-F-1

### pbp-21 [P2] `gc()` 返回值语义漂移（三行之和），`deferred-blob-gc.ts:13` JSDoc 失真

- 文件：`sqlite-vfs-content-store.ts:404-406`、`domain/vfs/logic/deferred-blob-gc.ts:13`
- 改法（最小）：两处注释统一成「回收的无引用 blob / member / 空 pack 行数合计」。T-VP4 补一条返回值 = 三表删除行之和的断言。
- 来源：cr-r1-store#pb-store-C-1

### pbp-22 [P2] `unpackVfsContent` 破坏性应急工具零防呆 + 中途失败无返回语义

- 文件：`vfs-content-packing.ts:1033-1100`、`infra/db-maintenance/index.ts:52`
- 改法：签名改 `(conn, options?: { dryRun?: boolean; force?: boolean })`——默认 dryRun（只统计不写库），真跑要求显式 `{force:true}`；返回值补 `dryRun: boolean`；函数头注释补「中途失败时前面的 pack 已展开、可重复执行续跑」；逐 pack try/catch、坏 pack 跳过并回报明细（codec OQ3 采纳并入）。
- 验收：不传 force 零写（pack/member/blob 行数不变）；dryRun 统计与真跑一致；既有 T-VP10/T-VP16 改传 force 断言不变；**pbp-2 新增的 unpack ref_count 修复用例同样改传 `{force:true}` 后仍断言 ref_count==COUNT**。
- 来源：cr-r1-task#pb-task-E-1（含 codec OQ3）

### pbp-23 [P2] 候选扫描无分页：一轮至少两次全量物化，收尾只需布尔却付全量代价

- 文件：`vfs-content-packing.ts:224-276`、739、796-798
- 改法：`collectCandidateEntries` 加 `{limit?, stopAfter?}` 可选参——收尾传 `failedGroups + 1` 早退；keyset 分页 `WHERE (r.entry_id, r.version) > (?, ?)`。**不得**换成 SQL 侧 COUNT/HAVING（丢「跨 entry 共享归首遇」语义会让 stalled 反向误报——代码注释 220-222 的对账设计必须保住）。
- 验收：候选跨多批数据集断言打包结果与不分页逐字节一致；收尾早退与全量判定一致。
- 来源：cr-r1-task#pb-task-E-2

### pbp-24 [P2] verify/unpack 一次载入全部 pack 字节 + N+1 查 member

- 文件：`vfs-content-packing.ts` 的 `verifyVfsContentPacks` 函数体（HEAD 约 :961-1013）与 `unpackVfsContent` 内的 pack 全量查询（HEAD 约 :1036-1042；**按 `SELECT pack_id, format, bytes FROM vfs_content_pack ORDER BY pack_id` 语句文本定位**——pbp-9 删除 `:939-951` 12 行后行号整体上移）
- 改法：两处改「先查 pack_id 列表（不带 bytes），逐 pack 按 id 取 bytes + 一次 member 查询」，组处理完即释放 plains。
- 验收：T-VP3 断言不变；加「SQL 执行次数 = 2×组数、无全量 bytes 查询」断言。
- 来源：cr-r1-task#pb-task-E-3

### pbp-25 [P2] 手动「数据清理」漏清 `nm-vfs-pack` 的 pending 标记（冷启动白跑一次全库 VACUUM）

- 文件：`packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:88-99`
- 改法：DELETE 条件补第二个元组 `(module='nm-vfs-pack' AND key='startupMaintenancePending')`（绑参）。
- 验收：预置该 key → 跑 runDatabaseMaintenance → 断言 key 不存在；blob-binary 侧用例不回归。
- 来源：cr-r1-task#pb-task-C-1

### pbp-26 [P2] RULE.md「谓词每次重扫」与水位短路口径漂移 + 缺两条新口径

- 文件：`docs/apm/RULE.md:29`（分支上该条目）
- 改法：按报告给定文案改为「稳态入口按 nm-vfs-pack/zeroCandidateWatermark 自失效指纹短路（…entryHeadDigest 兜住 resetHeadToVersion 面）」；补一句 `idx_vfs_entry_content_hash` 随 v18 canonical DDL 建出不单独 bump。**注意**：RULE.md 主仓与 worktree 双份，本条先改 worktree 分支版，合并轮按 pbm-8 对齐（主代理届时统一提交纪律）。
- 验收：grep「谓词每次重扫」零命中、grep zeroCandidateWatermark 命中。
- 来源：cr-r1-schema#pb-schema-F-1

### pbp-27 [P2] 导出面清理：`clearZlibCodecAccelerator` 撤出主入口（或显式声明）

- 文件：`packages/core/src/index.ts:67,109,119`、`main-entry-allowlist.json`
- 改法（推荐）：`clearZlibCodecAccelerator` 从主入口撤出，测试改子路径/相对 import，同步 allowlist 快照；`DEFAULT_VFS_PACK_SYNC_BUDGET_MS` 与 `VFS_PACK_KKV_MODULE` 保留（对齐既有先例）。
- 验收：快照测试绿；grep 命中集合与决策一致。
- 来源：cr-r1-schema#pb-schema-E-1

### pbp-28 [P2] v18 注释两表段补「快路径不补建」登记（与索引段一致）
- 文件：`novel-master-bootstrap.ts:117-124`
- 改法：按报告给定文案补齐（与 pbm-7 的方案 A 联动——若采纳方案 A，此注释随之改述为「事务外无条件段兜底」）。**【r3 时序登记】** 该拍板须在 pbp-28 开工前完成；未拍板则 pbp-28 一律按「快路径不补建」原措辞落笔，拍板结果为方案 A 时在合并轮一并改述。
- 验收：`git grep -n "user_version = 18" -- packages/core/src/bootstrap/novel-master-bootstrap.ts` 命中两段（撤回 v18 段 + 两表段），且两表段注释含「不补建 / `no such table: vfs_content_pack`」字样；`npx tsc --noEmit -p packages/core` 绿；`vfs-content-pack-schema.test.ts` 3/3 仍绿（该用例把「快路径不建两表」锁成期望行为，注释改动不得改测试）。
- 来源：cr-r1-schema#pb-schema-C-1

### pbp-29 [P2] 两端调度服务零契约测试（兄弟任务 16 条用例覆盖的正是逐字复制来的高风险分支）

- 文件：新增 `apps/desktop/test/vfs-content-packing-service.test.ts`；mobile 侧 `apps/mobile/__tests__/vfs-content-packing.service.test.ts` **由 pbp-11 建骨架，本条只在其上追加用例、不重复新建**
- 改法：照 blob/compaction 先例——desktop 至少 busy finally 复位（VACUUM 抛错也复位）+ 连接关闭重挂；mobile 至少 stalled 收手 + 守卫组合 source 契约 + 去重/重挂（与 pbp-11 的用例同文件承载）。核心「改错必红」：删 stalled 分支 mobile 用例必须红。
- 来源：cr-r1-apps#pb-apps-G-1 + cr-r1-tests#pb-tests-G-7（同条合并）

### pbp-30 [P2] 注释三处口径失真：rebootstrap 重挂高估 / jest 白名单链路写错 / 第三态「已完成」张力

- 文件：`apps/desktop/src/main/main.ts:182-184` + `apps/desktop/src/main/services/vfs-content-packing.service.ts:30-31,145-149`；`apps/mobile/jest.config.js:15-17`；双端 migration-row-value / storage-config-migration-values 注释
- 改法：① rebootstrap 措辞收敛为「轮内自愈；循环已收手则等下次冷启动——与 blob 归一/消息压缩同款边界」；② jest 注释改「经 moduleNameMapper 直连 dist/public/vfs.js 的 vfs 服务链路会拉到 fossil-delta」；③ 第三态注释补「『已完成』限定为当前候选已收敛这一轮」。（第三态文案本身是 spec 拍板不改。）
- 验收：`git grep -n "rebootstrap 重挂全在服务内" -- apps/desktop/src` 零命中；`git grep -n "经 core-shim" -- apps/mobile/jest.config.js` 零命中且该注释含 `dist/public/vfs.js` 字样；双端第三态注释均含「当前候选已收敛」字样；双端 typecheck 绿。
- 来源：cr-r1-apps#pb-apps-F-1/F-2/F-3

### pbp-31 [P2] T-VP2 断言对象被换成读路径优先级（spec 写的是打包后全量不变式）

- 文件：`content-store-pack.test.ts:366-413`（改名）+ `vfs-content-packing.test.ts` T-VP12 末尾（补断言）
- 改法：既有用例改名「T-VP2a：blob 命中优先于 member」；T-VP12 末尾补全量扫描 `SELECT COUNT(*) FROM vfs_entry WHERE content_hash IS NOT NULL AND content_hash NOT IN (SELECT content_hash FROM vfs_content_blob) === 0`。**【r3 澄清】** 这条断言实现的是 **T-VP2 的正常形态判据（head 落在 blob）**，不是 pbs-6 放宽后的 INV1 本身——跨 entry 归首遇导致的 member-only head 由 pbs-6 的宽松式 INV1 覆盖；本用例夹具的 head 一律经 `store.put` 落 blob 行、不含该形态，故不会被误红。
- 验收：删谓词里的 NOT EXISTS 整段，两处断言同时变红。
- 来源：cr-r1-tests#pb-tests-G-4

### pbp-32 [P2] T-VP13 计时护栏口径不同源（core 测试进程无加速器，跑 fflate 却卡 50ms）

- 文件：`vfs-content-packing.test.ts:871-874`
- 改法：计数断言（`fossilSegmentInflates===8`）作主牙齿；计时放宽 `<200` 并在 message 注明「fflate 口径」，或用例开头注册 node:zlib 加速器走生产同源后维持 50。
- 验收：阈值来源注释写明；CI 连跑 10 次不因该断言红。
- 来源：cr-r1-tests#pb-tests-G-5

### pbp-33 [P2] T-VP11 死变量 `expected`（noUnusedLocals 定时炸弹）

- 文件：`content-store-pack.test.ts:197`
- 改法（**默认：删**）：删掉 `:197` 的 `const expected = compressZlib(corpus[i]!);`（`noUnusedLocals` 定时炸弹、循环全程未消费）。改法（备选，须限定比较对象）：若要变成有价值断言，**只能在文本版本链成员上成立**——`for (let i = 1; i < 3; i++) assert.ok(table.segments[i]!.length < compressZlib(corpus[i]!).byteLength, 'delta 段应小于该成员独立压缩长')`（实测 i=1：118<169、i=2：112<230 成立）；**禁止写成 `i >= 1` 的全循环**——i=3 是 2048B 伪随机段，实测 delta 2071B > 独立压缩 2059B（高熵目标的 delta 必然略大于单独压缩），全循环断言会在正确实现上恒红。
- 验收：`tsc -p packages/core/tsconfig.test.json` 不新增错误；`:197` 行消失或被上述限定断言消费。
- 来源：cr-r1-tests#pb-tests-G-6

---

## Must-fix · 合并动作组（pbm-，只在合并回 main 的那一轮执行，分支上不做）

> 背景：`git merge-tree fe79b781 b3e27b1c` 模拟 = **19 文件文本冲突**（全部为 `CONFLICT (content)`；pbm 自身枚举 4+9+3+1+1+1 = 19，与实测一一对应），全部是「main 改名 + 分支追加 pack 符号」的并集解，无设计级冲突；汇合难度评级**少量手工（0.5~1 人日）**。语义侧好消息：read 引用化的 hydrate 链确认收口在 `contentStore.get`（findMeta 先比 hash 零解码 → 明文键空间一致 ⇒ 内容寻址保证等值），ref_count 第三类持有者无绕过 get 的直查旁路（`findContentSizeByPath` 唯一直查点分支已加 member 回退）——**read 引用 × pack 语义闭合，不阻塞合并**。详细逐 hunk 裁决见 `cache/cr-r1-merge.md`。

### pbm-1 [P0] core 四文件 6 hunk 并集解（zlib-codec / index.ts / db-maintenance/index.ts / allowlist.json）
main 命名 + 分支 pack 符号取并集；**禁止**保留对已删除的 `impl/message-content-compaction.js` 的任何引用；**不要**去补 `PREF_KEY_CHAT_SUBAGENT_STREAM`（已存在）与 `DEFAULT_SUBAGENT_DEFINITION`（属 public 子路径）——「main 预存缺项」的说法不成立（两个子代理独立核实一致）。验证：package-exports 快照测试 + core tsc。

### pbm-2 [P0] 三端接线 9 文件并集解
统一口径：压缩域一律用 main 的 `*Decompress*` 命名、pack 域追加 `vfsPack`。含 cli/runtime（解压 5s + 归一 + 打包 30s 顺序）、desktop main.ts/db-maintenance.service/ipc-types/migration-row-value、mobile novel-master-context/StorageConfigScreen/storage-config-migration-values/db-maintenance.service。验证：三端 tsc + 定向测试 + 实机存储页四行渲染。

### pbm-3 [P0] 三个测试文件重写压缩域断言并保留 vfsPack 新用例
`apps/desktop/test/migration-row-value.test.ts`（夹具键 + 125 行 kind 序列改 `messageDecompress` 打头）、`apps/mobile/__tests__/db-maintenance.service.test.ts`（core mock 改名 + `stats.messageDecompress`）、`storage-config-migration-values.test.ts`（import/describe 改名 + 追加 vfsPackValue 三态夹具）。**不要「取一侧」解**——这是最易「以为解完、断言还在断已删字段」的地方。
验收：三份测试文件定向跑全绿 + desktop/mobile tsc 绿；`git grep -n "messageCompaction" -- apps/desktop/test apps/mobile/__tests__` 零命中。

### pbm-4 [P0] 静默破坏点：`apps/desktop/test/db-maintenance-vfs-pack-stats.test.ts:66`
`res.data.messageCompaction` → `messageDecompress`（+12/47 行注释）。**git 不报、tsc 必红**——本次汇合唯一一个「合并工具不会提醒」的点。

### pbm-5 [P1] package-lock / 版本号
两处 workspace version 取 main 的 **1.5.29**；fossil-delta 三处新增全保留；不把分支的 1.5.27 写进任何 package.json（分支 lock/package.json 本就不同步，以 main 为准）。
验收：`npm install --package-lock-only` 后 `git diff --exit-code package-lock.json` 为空（lock 内 apps/desktop、apps/mobile 两处 version 均 1.5.29，且含 fossil-delta 三处）。

### pbm-6 [P1] CHANGELOG：与 pbp-8 协同
分支侧已建 `## [Unreleased]`（pbp-8）后，合并轮把该段与 main 的 `[1.5.29]` 段正确叠放（Unreleased 在最上）。main 侧若有「read 引用条目落段」结构债（merge 节点 OQ-2 报告在 1.5.28 段尾）——**不动 main 既有内容**，登记给用户另行决定。
文件：`CHANGELOG.md`（合并冲突 hunk，位于文件顶部）。验收：合并后 `findstr /n "^## " CHANGELOG.md` 首行为 `## [Unreleased]`、次行为 `## [1.5.29] - 2026-09-30`；[1.5.28] 段内 `### 变更` 只出现一次；`git show v1.5.28:CHANGELOG.md` 与 `v1.5.29:CHANGELOG.md` 均不含「文件历史版本混合打包存储」。

### pbm-7 [P1] `user_version=18` 开发机库显式处置（需用户拍板，推荐方案 A）
风险：跑过「已撤回 v18（tool_use_count）」构建的开发机/测试机库合并后命中快路径 → pack 两表永不建出 → CLI 每条命令抛错、双端状态行退化 `—`。正式用户库不受影响（1.5.28/1.5.29 均停在 17）。方案 A（推荐）：照 main 的 `idx_chat_message_pending_blob` 先例在 bootstrap 事务外无条件段补三条幂等 pack DDL（同时保护未来任何占号又撤回）；方案 B：BOOT 取 19 + 要求重置开发机库。验证：user_version=18 无表库启动断言两表+索引建出、任务不抛；干净 17 库走慢路径回归。**【r2 编排提醒】pbm-7 与 pbp-7/pbp-28 同改 `novel-master-bootstrap.ts`（pbp 在分支波、pbm 在合并轮）——合并轮手改时注意 bootstrap hunk 归属，事务外段与探测族两处分开核。**

### pbm-8 [P1] RULE.md 双条目并存对齐
read 引用条目 + VFS 打包条目都留；分支条目的方法集描述与合并后 store 现状逐条对齐（与 pbp-26 联动）。
验收：`git grep -n "contentRef\|VFS 内容打包" docs/apm/RULE.md` 两条条目并存，且打包条目的方法集清单与合并后 `sqlite-vfs-content-store.ts` 实际方法逐条对得上。

### pbm-9 [P1] 合并后合跑回归（spec L328 承诺、当前无文档承载）
回滚 + fork + checkpoint 套件**与 read 引用化合跑**；补「read 引用 → pack 打包 → 再 hydrate」定向用例（断言 wire format 逐字节不变）。建议在 worktree 合并演练轮即执行。
**点名清单**：`packages/core/test/message-checkpoint/`（rollback / restore-path / checkpoint-capture-transactional / revision-gc 全部）+ `test/chat/fork-copy-parity.test.ts` + `test/chat/read-ref-prompt-parity.test.ts` + `test/vfs/read-ref-safety.test.ts` + `test/vfs/content-store-pack.test.ts` + `test/infra/vfs-content-packing.test.ts` 同跑；定向用例落在 `test/vfs/read-ref-safety.test.ts`。（`read-ref-prompt-parity` / `read-ref-safety` 为 **main 侧文件、合并后才存在**；「worktree 合并演练轮即执行」须在合并完成后跑，合并前跑路径不可解析。）

### pbm-10 [P2] 悬空符号与错口径注释清理
desktop/mobile 两份 db-maintenance.service 的 `{@link sampleMessageCompactionStatus}` 与「与 messageCompaction 同口径」、ipc-types 的 vfsPack 注释、cli 的「60+60+30」预算注释（实为 5s+归一+30s）、两端迁移卡「三行/消息正文压缩」措辞。
验收：`git grep -n "MessageCompaction\|messageCompaction" -- packages apps` 零命中（docs/ 下的历史 spec / fix-spec 属历史沿革说明，不计）；`git grep -n "sampleMessageCompactionStatus" -- packages apps` 零命中。

### pbm-11 [P2] spec L328 集成备注改述
合并后 spec.md 取**分支版**（main 自 9ca5f5ad 未改该文件），其中 L328 集成备注只提了 read 引用化迭代、漏了消息明文化——补一句。全文扫描并改齐对已改名符号的引用：**L77**（「沿用既有 `DEFAULT_COMPACTION_SYNC_BUDGET_MS` 口径」）与 L340（预算常量分叉）两处均改 `DEFAULT_DECOMPRESS_SYNC_BUDGET_MS`；L340 句尾「后者所在文件在未合并的 message-content-compression 分支上，本分支无法引用」改述为「已随 1.5.29 落地为 message-content-decompression，故同名不同模块」。
验收：`git grep -n "DEFAULT_COMPACTION_SYNC_BUDGET_MS" -- docs/Iterations/binary-blob-and-vfs-pack/spec.md` 零命中。

---

## Spec 回填组（pbs-，改本分支业务 spec.md）

| id | 内容 | 来源 |
|---|---|---|
| pbs-1 | L151 stalled 判据回填：entry 口径 + `>` 判据 + 不变量推导 + **pbp-5 的并发豁免条款**（maxVersion 归因） | task SD-1 + pbp-5 |
| pbs-2 | L153 补「让步粒度 = entry（组事务本身为短事务）」 | spec D8 |
| pbs-3 | 变更点 #16 KKV 总表补 `nm-vfs-pack` ×3（startupMaintenancePending / failedGroups / zeroCandidateWatermark） | spec D9 |
| pbs-4 | 变更点 **#13（测试）** 的「文件/变更」列补一句：`apps/mobile/jest.config.js` 的 `transformIgnorePatterns` 追加 `\|fossil-delta`（纯 ESM，经 moduleNameMapper 直连 `dist/public/vfs.js` 的 vfs 服务链路会拉到 pack-codec → fossil-delta，须纳入 babel transform）。**不改 #8**——#8 只描述调度与 UI 接线，不含测试配置 | spec D10 |
| pbs-5 | 「T 编号 → 实际用例文件」映射表（spec L275-289）补 **T-VP 二十行**：T-VP1~6/8/10~22 全部登记（T-VP7 行待 pbp-12 落地后回填，故本轮 20 行、终态 21 行——spec 的 T-VP 条目共 21 条、无 T-VP9）。每行三列照 cr-21/cr-06 先例：实际用例文件 + 用例名（带 `T-VPn` 前缀）+ 断言要点 | spec D11 |
| pbs-6 | INV1 表述改口径（**三处同改，缺一即 spec 自相矛盾**）：① spec L142 INV1 改述为「live head 必有权威副本（blob 行或 member 行）」并补一句成因（UNION member 判已存在 → tree-copy/seed 快路径可让 entry head 指向 member-only hash）；② **spec L247（T-VP2 正文）同步改述**为「打包任务跑完后所有 vfs_entry.content_hash 都有权威副本——正常形态下均为 blob 行，回归判据仍取 blob 全集」；③ integrity-repair 检测项（若做）加「或存在 member 行」前置 | store spec_deviations 2 + OQ1（经 sc-r1-b P1-1 补 L247） |
| pbs-7 | **【r2 新增，L-1 漏项】spec L136（put 抽回）补一句纪律：「绕过 revision 触发器新建 blob 行时，ref_count 必须现场重算（COUNT(vfs_revision WHERE content_hash=?)）」**——pbp-2 只修代码，不回填则未来照 spec 字面重写 put 会再踩同一坑 | cr-r1-store spec_deviations #1（经 cr-r2-full §1.3 指漏） |

---

## 发版前门禁组（不阻塞 dev-ready；manual / 用户拍板）

1. **Step 7 Hermes 真机探针（硬门禁；证据已存在，待「回捞 + 回记」而非补跑）**：探针脚本 `apps/mobile/src/services/__fossil-probe.ts` 已删除、落库结果在 `tmp/probe-db.gz` 的 `__fossil_probe_results` 表（5 行全 pass：`probe_start hermes=yes`；A 小语料 encode 21ms/decode 4ms；**B 1MB 语料 encode 12605ms / decode 429ms / roundtrip_equal=true**；C 7 段链 create 合计 317ms / apply 合计 71ms）。`tmp/` 在 `.gitignore`，git grep 检索不到——上游 cr-r1-spec OQ-1「无落痕」结论**不成立**。发版前动作：① 把上述结论逐字回记 spec L226（含「Hermes 1MB 编码 12.6s ≈ Node 1.85s 的 6.8×，落在 spec 预估 5-10× 区间；单组 1MB 编码占 30s 轮预算约 42%」）；② 把 DDL + 5 行结果导出为仓内可跟踪产物（如 `docs/Iterations/binary-blob-and-vfs-pack/hermes-probe-results.md`），防证据随 tmp 清理消失；③ spec L226 注明探针脚本已删与处置口径。**结论未回记 spec 前不得发版。**
2. **Step 13 真机验收**（L232）：VFS 体积对照 −4.5MB 量级 / fossil 组回滚 / checkpoint / 二次启动收敛 / 指标卡两态。
3. **风险⑤ 不可降级的用户知情确认**（L325）：发布后回退 APK 读不到已打包 hash；回退路径 = 新版跑 unpackVfsContent——但该工具目前无 CLI/UI 入口（merge OQ-6），发版前需拍板披露口径与应急入口归属。
4. **pbm-7 方案 A/B 拍板**（user_version=18 开发机库处置）。

---

## Spec deviations

- **open×1（待用户二选一，确认任一即闭合）**：`integrity-repair`「head hash 无 blob 行」检测项——spec L145 写「可选」、L325 写「增加检测项作防御」两处口径打架，实现两边都没做。**处置二选一（随开工确认一并拍板）**：(甲) 补检测项（按 pbs-6 的「或存在 member 行」前置，防 UNION member 常态下全量误报）；(乙) 显式按现状收窄——spec L325 改述为「不做独立检测，INV1 由谓词排除 head + put 抽回双重保证」。r2 复检指出：按 skill 规则 open deviation 须经用户确认「按现状收窄」才算 fixed——本条以显式二选一承载，用户确认后回填「已豁免」段或转 must-fix。
- 已闭合（由本 fix-spec 承载）：T-VP7 缺失（pbp-12）、CHANGELOG 归段（pbp-8）、stalled 口径（pbs-1）、KKV 总表（pbs-3）、spec L136 ref_count 纪律（pbs-7）等；零候选水位/索引/加速器三分叉均属「实现期补充三已登记」的合理收窄（评审复核论证注释成立——但水位的前提被 pbp-3 修正后才真正成立）。
- 记账备注（r2 复检登记、无需动作）：store deviation 3（COUNT 与 NOT IN 等价备查）、task SD-3/SD-4（pendingGate 合理补全的口径说明）为报告自判非偏离项。

## Open questions / 待拍板（不阻塞）

1. codec OQ1 threat model 定级——主代理已按 P0 处理（采信坏数据可达：verify/unpack 的存在即自认），如用户认为纯内部数据可降级，pbp-1 仍建议修（代价 8 行）。
2. apps OQ-1 rebootstrap 后主动重挂（行为变更，不建议本迭代）；OQ-2 isConnectionClosedError 无限重试上限（既有债）；OQ-3 采样串行度（毫秒级收益）；OQ-4 DTO 类型级联动断言。
3. tests OQ-4 `before` 钩子恒真装饰（扩三 key 或删）；OQ-5 content-store-pack 用例间隐式耦合（T-VP4 全局 gc 顺手收尾垃圾）；OQ-6 源码契约假牙上限；OQ-7 注入面按特征串收窄。
4. task OQ-1 INV2 静默 0 行 UPDATE 是否补检测（与 deviations open 项同族）；OQ-3 flush 的冗余 Set；OQ-4 entryHeadDigest 不覆盖 mtime/scope/path 的取舍确认。
5. schema OQ-3 CHANGELOG 分类（变更 vs 新增）发版时裁量；merge OQ-2 main CHANGELOG 结构债（不动）；OQ-3 加速器收益口径收窄（「仅 VFS/file_cache 读链」是否写进 RULE）；OQ-5 fossil-delta ESM 三条路（desktop/CLI/Metro）验证记录。

## 已豁免（用户确认不修）

（空——待用户对 OQ 表态后回填）

## 合并后 QA（manual_user，C 类不阻塞）

- pbm-9 合跑回归 + read 引用定向用例
- 门禁组 1~4（Hermes 探针 / 真机验收 / 不可降级确认 / v18 处置）
- 实机存储页四行渲染（desktop + mobile）；CLI 首启三任务串行耗时复核（5s+归一+30s 口径）

## K 节建议（下游执行时闭合）

- 全部改动完成后：`npm run build -w @novel-master/core` 重建 dist → core 全量（嵌套目录 globstar 已修的脚本）→ desktop（`--test-concurrency=2`）→ mobile（`--maxWorkers=2`）→ 三端 tsc。发版门照 RULE 的满负载假红纪律复跑。
- fix-spec 执行轮的提交分组：**每组内按文件串行**（同组多条改同一文件时必须依次落，不得并行编辑）——pbp-1/2（P0 一组）→ pbp-3/4/5（任务收敛三连，同改 `vfs-content-packing.ts`）→ pbp-6~8 → pbp-9/10/11 → 测试组（pbp-12~14、19、31~33；其中 `content-store-pack.test.ts` 四条按 pbp-33 → pbp-19 → pbp-31 → pbp-13 顺序串行）→ P2 余量（**pbp-28 待 pbm-7 拍板**）→ pbs 文档组。每波主代理统一提交（子代理不 git 写）。
- `docs/.iteration-state.yaml` 不由本 fix-spec 触碰。

---

## 未涉及 / 已核维度声明（r2 review-full 补齐）

- **H 兼容性**：涉及，均已承载——pbp-6（老 Android SQLite 999 变量上限）、pbp-4（`ON CONFLICT` UPSERT 语法地板，既有先例已核）；`fossil-delta@2` 纯 ESM 的 desktop/CLI/Metro 三端解析面属未闭合证据缺口，由门禁组与 OQ 表（merge OQ-5）承载，非新 must-fix。
- **I 可观测性**：已核，无新增——状态面四字段 + 3s 节流 + reset 钩子 + 坏组 warn 均在位（`vfs-content-packing.ts:166-175/872-932`）；可诊断性增量由 pbp-16（段级错误包装）承载。
- **J UI**：微涉入、只在注释/文案层（pbp-30、pbp-11/29 触及的调度服务边缘）；UI 布局、取值链、两态+第三态经 apps 报告核过无偏离（双端夹具 + desktop 整列 deepEqual 已兜底）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（条件：用户确认 integrity-repair 二选一 + 开工指令） |
| execute-ready（spec-check-loop） | **yes（r2 judge 判 Go，残留 3 项已按建议补齐；开工待用户确认）** |
| fix_spec_path | docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec-partb.md |
| dag_version / review_round | 4 / 2（CR loop）＋ spec-check r1 已修 |
| P0 / P1 / P2（已写入 fix-spec） | 代码组 2 / 12 / 19（合计 33）；合并组 4 / 5 / 2；spec 回填 7；门禁 4 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open×1（integrity-repair，显式二选一待用户拍板——确认任一即闭合；pbm-7 方案 A/B 拍板属合并轮门禁，不阻塞本轮 dev-ready） |
| C-orch | ✅（pbp-4/9/11、pbm-2/3） |
| C 类合并后 QA | 已列（不阻塞） |
| 维度覆盖 | A/B/C/C-orch/D/E/F/G/H/I/J/K 声明齐（H/I/J 见上节） |
