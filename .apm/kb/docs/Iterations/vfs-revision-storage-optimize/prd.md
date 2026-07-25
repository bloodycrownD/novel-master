---
date: 2026-07-25
dependency: Iterations/message-checkpoint-v2/prd.md
---

# vfs-revision-storage-optimize PRD

## 背景

Message Checkpoint v2 已落地：checkpoint 只存整树 `{路径 → revision version}` 指针，正文落在 append-only 的 `vfs_revision`。回滚与删消息靠「live head ∪ checkpoint 指针」做 revision GC。

当前实现里，每次工作区写入都会升 version，并把整份正文再存进 revision，即使用户/Agent 写入内容与当前文件完全一样。真实用户备份库（约 109MB、仅少量项目与约 1200 条消息）里，revision 相邻同文占比约九成，库体积主要由重复全文撑大，而不是消息或项目数量本身。

失败补偿路径（user vfs 一批 tool 失败后的 `restoreMutatingPathHeads`）也不会清中间 revision，而是再 write 一遍旧内容，额外制造历史。这与「message 回滚才 GC」不是同一条路，但会加剧膨胀。

产品侧仍要保留：checkpoint 整树指针、按 message 回滚、FileEditor 不写 checkpoint。本需求只收紧「何时产生新历史」以及「正文怎么存」，不改回滚对外语义，也不做 git 式 delta。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 掐掉同文假历史 | 与当前文件正文完全相同的再次写入，不产生新的 revision version；相邻同文写入不再推高库体积 |
| 正文按内容共享 | 相同正文在库内只保留一份可寻址内容；多条 revision / live entry 可指向同一份 |
| 压缩落盘 | 共享正文以 zlib 压缩形态存储；样例级大库升级后体积明显下降（相对「明文全文 × 行数」） |
| 旧库可受益 | 打开/升级已有库时，已有 revision/entry 正文迁入压缩共享存储；不强制删除已有同文 version 行（指针与回滚语义保持） |
| 失败补偿不瞎堆历史 | user vfs 失败补偿不再靠「再 append 一条旧正文」糊弄；中间不可达 revision 可被清掉或不再产生 |
| 回滚语义不变 | 回滚到某条 message 后，工作区文件内容仍等于该 message 完成时的整树状态 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 长期写作用户 | 同一会话多轮 Agent 改稿、角色卡反复触碰；库文件不再因「没改也存一份」膨胀到百兆级 |
| 已有大库用户 | 升级客户端后打开旧库，体积因压缩与内容共享下降，历史消息仍可回滚 |
| 在聊天里改工作区的用户 | 一批 user vfs 操作部分失败需要拉回时，不因补偿路径再堆一串无用历史 |
| 写作者（FileEditor） | 保存但内容未变时，不应无故多出一版历史（与同文不升 version 一致） |

## 范围

### 包含范围

1. **同文不升 version**：相对当前 live 文件正文完全一致的写入，不新增 revision、不抬 head version（返回仍表示写成功，version 为当前值）。
2. **content_hash → 共享正文**：live entry 与 revision 都改为按内容指纹指向共享存储；明文不再作为迁移后的真源（列可空，值为 `NULL`）。
3. **zlib 压缩**：共享正文压缩后落库（算法定 zlib）。
4. **旧库迁移**：升级路径把已有正文迁入压缩共享存储；保留现有 `(path, version)` 与 checkpoint 指针；不强制 GC 同文 version 行；旧库须完成 `vfs_entry.content` 可空化（与 canonical DDL 一致）。
5. **失败补偿收敛（B）**：user vfs 失败补偿经不升版原语拨回快照 head / 硬删 absent；若快照为 present 但 live 已被删，仍按目标 revision 重建 live（不升版、不叠假历史）；directory 清掉快照外新文件并拨回快照内文件（补偿 list 遇路径不存在视为无快照外文件；快照里的 content 仅 capture 遗留，拨回只认 version）；restore 尝试结束后不论是否部分失败，仍做一次 sweep + 回收无引用共享正文。
6. 对外读写仍是完整 UTF-8 文本；目录无正文、不泄漏伪串 `"null"`；ZIP / 备份等用户可感知行为不因存法变化而丢内容。

### 不包含范围

1. git 式 **delta / pack**（只存差异）。
2. 改 message checkpoint 产品语义（仍整树指针；不改「只钉 version」）。
3. 把 checkpoint 改成「只记变更文件」或改存 blob id。
4. 强制清理历史同文 version 行（可作为后续优化，非本需求验收）。
5. Agent tool 失败时的全套补偿模型重做（本次聚焦 user vfs 失败补偿路径；Agent runner 现状可不引入同一套 restore，除非实现时发现同一写入口必须统一）。
6. 库外文件 blob、或改变「整库备份 = 全量」的假设。

## 核心需求（3-7 条）

1. **同文短路**：对已存在文件，若写入正文与当前 live 正文逐字相同，则不升 version、不追加 revision；调用方仍视为成功。
2. **共享正文存储**：不同 revision / live entry（可跨路径、跨 session）若正文相同，共享同一份按内容寻址的存储；revision 元数据仍用 `(path, version)` 供 checkpoint 引用。
3. **zlib 压缩存储**：共享正文以 zlib 压缩形式持久化；读取时对上层仍还原为完整文本。
4. **升级迁移**：已有库在升级过程中完成正文迁入与 `content` 可空化；迁移后旧明文列置 `NULL`，不再作为主存储；checkpoint 回滚仍可用。
5. **失败补偿不堆假历史**：user vfs 一批操作失败后的恢复，不得以「再 append 一条与目标相同的新 version」作为默认实现；应拨回（或重建）到补偿前 head，并避免留下仅因失败尝试产生的不可达 revision；部分 path 恢复失败时仍须完成约定清理。
6. **GC 与共享正文协调**：按现有可达性删除不可达 revision 行之后，须按**全库** entry∪revision 引用回收无主共享正文；禁止只按当前 session 局部引用集删 blob（否则会误伤其它 session）。

## 验收标准

- [ ] **Given** 某文件 live 正文为 C，**When** 再次写入完全相同的 C，**Then** head version 不变，且不新增该 path 的 revision 行。
- [ ] **Given** 两个不同 path 或两个不同 version 的正文相同，**When** 写入完成，**Then** 库内仅一份共享正文（按内容），revision / entry 各自保留自己的 version 指针与同一 `content_hash`。
- [ ] **Given** 样例级含大量同文 revision 的旧库，**When** 完成升级迁移，**Then** 库文件体积相对迁移前明显下降；抽样回滚到迁移前已存在的 checkpoint message，工作区正文与迁移前语义一致；迁移后 active 文件行 `content` 为 `NULL` 且仍可读出原文。
- [ ] **Given** user vfs 一批 mutating 操作部分失败触发补偿，**When** 补偿完成，**Then** 相关 path 的 live 内容回到批次开始时的状态，且不因补偿多出「仅用于写回旧文」的多余 version；失败尝试留下的不可达 revision 不应长期残留（在约定的清理时机后不可达即无）。
- [ ] **Given** present 快照文件在批次中被删掉（live 已不存在）但历史 revision 仍在，**When** 补偿执行，**Then** 该 path 按快照 version 重建为可读文件且无写回注水 version。
- [ ] **Given** directory 类 mutating 快照，批次中在目录下新建了快照外文件、改写或删除了快照内文件，**When** 补偿完成，**Then** 快照外新文件消失，快照内文件回到原 version/正文（含曾被删掉的文件可恢复），且无写回注水 version。
- [ ] **Given** user vfs 补偿过程中部分 path 恢复失败（composite error），**When** restore 尝试结束，**Then** 仍执行约定的 revision sweep 与共享正文回收（不因部分失败跳过清理）。
- [ ] **Given** 某 message 存在 checkpoint，**When** 用户回滚到该 message，**Then** 工作区整树文件内容仍等于该 checkpoint 所代表的完成态（与 v2 产品语义一致）。
- [ ] **Given** 导出 ZIP 或整库备份，**When** 用户导出/备份，**Then** 可得完整可读正文或可还原的整库，不因压缩/共享存储丢文件；读路径不得把 SQL `NULL` 变成伪串 `"null"`（含目录行双 NULL、不解共享正文）。
- [ ] **Given** 库内存在多个 session 的共享正文引用，**When** 仅对其中一个 session 做 revision sweep 后回收共享正文，**Then** 其它 session 仍引用的 blob 不得被删。
- [ ] 不做 delta；不要求本需求内删除历史同文 version 行。

## 风险与待确认项

- ~~live 工作区行（`vfs_entry`）是否也改为只存内容指纹、与 revision 共享同一正文池~~：**已定案（SPEC）**——entry 与 revision 共用 ContentStore；迁移后 `content=NULL`，真源为 `content_hash`；目录行 content/hash 皆 `NULL`；旧库经 table rebuild 去掉 `content NOT NULL`。
- 迁移耗时与大库首次打开体验：SPEC 已定为同步、可重入、失败事务不 mark applied；极大库首次打开耗时写入发布说明。PRD 要求「升级后体积下降且可回滚」可测。
- Agent tool 失败路径当前不走 user vfs 同一套补偿；若实现时写入口统一，可一并受益，但不把「重做 Agent 失败模型」列为独立产品范围。
- dependency 前置 `message-checkpoint-v2`：本迭代不改其 checkpoint 指针 / 可达性语义，无需改前置 PRD message。
