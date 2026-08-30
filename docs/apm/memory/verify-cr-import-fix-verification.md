# verify-cr-import（import-dir-rule default-on fix 增量验证）

- 日期：2026-08-30
- 节点：verify-cr-import（verify 类型）
- worktree：`.woktree/import-dir-rule-rule`（实际路径 `.woktree/import-dir-rule`），分支 `feat/import-dir-rule-default-on`，fix 后 HEAD 应为 7c4d938
- fix-spec：`docs/Iterations/import-dir-rule-default-on/cr-fix-spec.md`
- 任务：非实现者独立复跑
  1. `packages/core` 全量 `npm test`（实现者报告 1791 pass）
  2. `npx tsc --noEmit`
  3. `git log/diff e355cc5..HEAD` 核对增量范围（预期：ensure-import-dir-rules.ts、三个测试文件；fix-spec 不应被改）
  4. 抽查 MF-1：根短路已删、内核 `/` 候选跳过仍在、T-I6 改写为「根导入子目录补行」口径
- 约束：只跑命令与检查，禁止修改任何文件。

## 结果（2026-08-30 复跑）

- `npm test`：第一次 1791 tests / 1790 pass / 1 fail（失败名未捕获，tail 截断）；后续三次复跑均 1791 pass / 0 fail，判为偶发 flaky。
- `npx tsc --noEmit`：exit 0。
- 增量范围：e355cc5..HEAD 共 4 提交（MF-1→MF-4），改动 4 文件与预期完全一致，fix-spec 未被改。
- MF-1 抽查通过：根短路已删（ensureImportDirRules 无整体 return）、内核 `/` 跳过仍在（backfillMissingDirRules 65 行）、T-I6 已改写为「导入到根——子目录补行、根自身无规则行」。
- 遗留观察：worktree 有未提交改动 `docs/apm/memory/20260830-import-dir-rule-default-on-impl.md`。
