# CR Fix Spec: character-card-import

## 元信息

- repo: `d:\Dev\Js\novel-master`
- base_sha: `61385b35`
- head_sha: `0fead242`
- prd_path: `.apm/kb/docs/Iterations/character-card-import/prd.md`
- spec_path: `.apm/kb/docs/Iterations/character-card-import/spec.md`
- review_round: 2
- dag_version: 3
- 状态：executed（core/G-1 已闭合）

## Must-fix（按 P0 → P1 → P2）

### core/G-1 [P1] Phase B 事务回滚缺 Z5 对称单测

- 维度：G + C-orch
- 文件：
  - `packages/core/test/character-card/character-card-import.test.ts`
  - 对照实现：`packages/core/src/service/vfs/impl/character-card-import.service.ts`（`testHook.throwOnInsertLogical`）
  - 镜像：`packages/core/test/vfs/vfs-zip-io.test.ts`（Z5: transaction failure rolls back domain）
- 问题：SPEC 不可破坏契约要求 Phase B「失败整事务回滚」。factory / `testHook.throwOnInsertLogical` 已按 ZIP 对齐「供回滚单测」，实现里也会在 insert 前按逻辑绝对路径抛错，但 **没有任何用例行使该钩子**。现有 T-C7/8/9 只钉兄弟保留 / 未确认 / 解析失败不删，**回滚点无 parity 证据**（C-orch：收敛无证据）。
- 改法：在 `character-card-import.test.ts` 增一条对齐 Z5 的用例，建议步骤：
  1. 目标子树先写入旧文件（如 `/角色/旧文件.md`，内容 `"old"`；或根路径对照 Z5 写 `/before.md`）。
  2. `createCharacterCardImportService(conn, { testHook: { throwOnInsertLogical: <将写入的某逻辑绝对路径> } })`——路径须等于 Phase B 即将 `insert` 的逻辑绝对路径之一（例如 `/角色/角色描述.md`，与 SAMPLE_V2 / 合成树一致）。
  3. 以 `confirmed: true` 调用 `import` 或 `importFromBytes`。
  4. `assert.rejects`；断言旧文件内容不变、新 md（合成树中的路径）不存在。
- 验收/测试：该用例 pass；与 ZIP Z5 对称（旧内容保留、新路径不存在）。
- 来源：review-scope-core / round 1
- 状态：**已由 code-dev-loop 闭合**（commit `43536490`）

## Spec deviations

none

## Open questions / 待拍板

> 附录：来自审查，**不阻塞** must-fix 写入与 fix-spec 收敛。

| id | 问题 |
|----|------|
| Q-phase-a-unit | Phase A 清单（`..` / `\` / 空段 / 超长 / 目标为 file → `INVALID_PATH`）目前几乎只靠合成树间接覆盖；合成树本身不会产出非法相对路径。是否要给 `validate-md-tree-paths` / `import(tree)` 补直接单测？（未认定必须） |
| Q-entries-object | 部分酒馆卡 `character_book.entries` 是对象而非数组；按 SPEC「非数组 ≡ 无有效世界书」会静默不建 `世界书/`。是否接受？（SPEC 已钉死，仅产品确认） |

## 已豁免（用户确认不修）

（本轮无）

## 合并后 QA（manual_user）

> 不阻塞 must-fix / CI；真机由用户执行。

- **Step 8** — Desktop 真机导入样卡 PNG/JSON，确认覆盖与 Toast「已导入角色卡」（T-C12）
- **Step 9** — Mobile 真机导入样卡，确认覆盖与 Toast（T-C12）

## Scope 备注（本 wave）

| scope | scope-ready | must-fix |
|-------|-------------|-----------|
| review-scope-core | no（待 `core/G-1` 写入后复审） | `core/G-1` [P1]（已写入本文件） |
| review-scope-apps | **yes** | 无 |

## K 节建议（下游执行时闭合）

- 实现 `core/G-1` 后跑：`npm run test:fast -- packages/core/test/character-card`（或仓库等价路径），并对照 `vfs-zip-io` Z5 一眼看齐。
- 文档/注释若需提及回滚测，与 ZIP testHook 口径保持一致。
- `9e68f8de` 为无关 hygiene（移除不存在的 vacuum 再导出）；执行本 fix-spec 时勿回滚；本迭代无需再改 schema-migrations。
- 可选：`apm kb index rebuild`。

## Fix-Spec Closure（本 wave）

| 项 | 状态 |
|----|------|
| fix-spec-ready | yes（待用户确认） |
| fix_spec_path | `.apm/kb/docs/Iterations/character-card-import/cr-fix-spec.md` |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入） | 0 / 1 / 0 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅ |
| base_sha / head_sha | `61385b35` / `0fead242` |
| 阻塞项 | 无（`core/G-1` 已执行并闭合） |
