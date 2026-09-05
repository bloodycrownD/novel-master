---
date: 2026-08-30
repo: .woktree/import-dir-rule
base_sha: 6c8a872
head_sha: 88f088c
prd: docs/Iterations/import-dir-rule-default-on/prd.md
spec: docs/Iterations/import-dir-rule-default-on/spec.md
review_round: 1
dag_version: 2
status: draft
review_source: review-import round 1
---

# 导入目录规则默认开启 — CR fix-spec（spec-fix-import wave）

本 wave 只改文档、不改实现代码。范围为 review-import round 1 的全部 must-fix（按 P0→P1→P2 顺序，本轮无 P0）。业务 spec / PRD 为只读参考，不修改。

## must-fix

### MF-1 [P1] 删除 ensureImportDirRules 的根路径整体短路

| 字段 | 内容 |
|---|---|
| id | import/MF-1 |
| 严重度 | P1 |
| 维度 | B（行为与 PRD 验收冲突）/ H（CLI --path 与 desktop resolveDirectoryPath 缺省路径） |
| 文件 | `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts`；用例补在 `packages/core/test/character-card/character-card-import.test.ts` 与 `packages/core/test/vfs/vfs-zip-io.test.ts`；另须同步改写 `packages/core/test/vfs/logic/ensure-import-dir-rules.test.ts` 的既有「T-I6: 根路径 / 跳过——零查询零写入」用例（该用例断言 prefix="/" 时零查询零写入，删短路后必红，改写为「导入到根：子目录补行、根自身无规则行」） |
| 问题 | `ensureImportDirRules` 中 `if (prefix === "/") { return; }` 把「根自身（`/`）不补」扩大成「根前缀下全部目录不补」。而 CLI `import-zip` / `import-character-card` 的 `--path` 缺省值就是 `/`，desktop `resolveDirectoryPath` 缺省也是 `/`，这些场景下导入目录全部不补行——PRD 要修的 bug 原样保留。内核 `backfillMissingDirRules` 已在候选循环内正确跳过 `/` 自身（`logicalPath === "/"` 时 continue），外层短路既多余又有害。 |
| 改法 | 1. 删除 `ensureImportDirRules` 内的 `prefix === "/"` 整体 return 短路（含相关注释），保留内核对 `/` 候选自身的跳过。2. 在两个导入测试文件各补一条用例：「导入到根：前缀下子目录补默认启用行、根自身 `/` 无规则行」。 |
| 验收 | 新增的根导入用例绿 + packages/core 全量 `npm test` 绿。 |
| 来源 | review-import round 1 |

### MF-2 [P2] 删除多余的双重类型断言

| 字段 | 内容 |
|---|---|
| id | import/MF-2 |
| 严重度 | P2 |
| 维度 | —（评审未标注） |
| 文件 | `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts` |
| 问题 | `scope as unknown as WorkplaceScope` 双重断言多余：`WorkplaceScope` 本就是 `VfsScope` 的纯类型别名（`packages/core/src/domain/workplace/model/workplace-types.ts` 中 `export type WorkplaceScope = VfsScope`），直接传 `scope` 即可。 |
| 改法 | 直接传 `scope` 给 `workplaceScopeKey`，删除双重断言；随之清理不再使用的 `WorkplaceScope` import（若无其他引用）。 |
| 验收 | tsc 通过（正式口径见 K 节）。 |
| 来源 | review-import round 1 |

### MF-3 [P2] 补行循环改为逐目录容错

| 字段 | 内容 |
|---|---|
| id | import/MF-3 |
| 严重度 | P2 |
| 维度 | —（评审未标注） |
| 文件 | `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts`；用例补在 `packages/core/test/character-card/character-card-import.test.ts` 与 `packages/core/test/vfs/vfs-zip-io.test.ts`（与 MF-1 同批补） |
| 问题 | 当前单个目录 `writeDefaultRule` 抛错会中断整个循环，剩余目录不再补行，只有外层整体 try/catch 兜底——弱化了 PRD 需求 4「单个目录的规则写入失败不阻断整体导入流程，其余目录的规则状态不受影响」的逐目录容错口径。 |
| 改法 | 在 `ensureImportDirRules` 调用侧的 `writeDefaultRule` 回调内做逐目录 try/catch + `console.warn`（内核 `backfillMissingDirRules` 不动，vfs-tools 复用路径行为保持不变）。补用例：「中途失败：已补目录保留、失败目录之后的目录仍补、导入整体成功」。 |
| 验收 | 新用例绿。 |
| 来源 | review-import round 1 |

### MF-4 [P2] 补 ZIP 服务 testHook.createWorkplaceRepo 的故障注入用例

| 字段 | 内容 |
|---|---|
| id | import/MF-4 |
| 严重度 | P2 |
| 维度 | —（评审未标注） |
| 文件 | `packages/core/test/vfs/vfs-zip-io.test.ts` |
| 问题 | ZIP 导入服务的 `testHook.createWorkplaceRepo` 钩子目前零测试使用（角色卡侧已有同构用例），「workplace repo 写入失败时 ZIP 导入仍成功」的行为无守卫。 |
| 改法 | 补一条与 T-I5（角色卡侧）同构的故障注入用例：`createWorkplaceRepo` 注入坏 repo，断言 ZIP 导入仍成功、已写文件完整。 |
| 验收 | 用例绿。 |
| 来源 | review-import round 1 |

## spec deviations

| 编号 | 决策 | 说明 | 状态 |
|---|---|---|---|
| 1 | spec 决策 7「跳过根路径」 | 实现把「`/` 自身不补」误读扩大为「`/` 前缀下全部不补」（整体 return 短路），与决策原意（对齐 `ensureDirRulesForNewPath` 既有约定，仅根自身不补）及 PRD 需求 1 冲突。对应 MF-1，修复后转 fixed。 | open → 待 MF-1 修复后 fixed |

## K 节 — 执行与验收建议

- 修复顺序：MF-1 → MF-2 → MF-3 → MF-4（MF-1/3 的用例可在同批补进两个测试文件）。
- 复跑（正式口径）：packages/core 全量 `npm test` + mobile `tsc --noEmit`。
- 手动验收追加：CLI `import-zip` 不带 `--path`（导入到根），确认子目录目录规则默认开启。

## 附录 — 待拍板（open questions，不阻塞）

1. 等价性 / 键空间集成测试目前只覆盖 session scope，global / project 路径无集成覆盖——是否补由作者权衡。
2. `buildDefaultDirRule` 绕过 `assertLogicalPathAllowed`（当前调用源头的路径均已经过校验，风险低；如需对齐，可在求得 prefix 后补一次校验）。
3. spec 决策 6「整体吞错」与 PRD 需求 4「逐目录容错」的措辞存在解释空间——MF-3 按 PRD 的精确读法修复（逐目录容错 + 整体兜底 warn 并存），spec 措辞是否回改另行拍板。
