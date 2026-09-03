---
date: 2026-08-30
dependency: []
---

# 导入目录规则默认开启 迭代实现（impl-import）

## 请求

在 worktree `.woktree/import-dir-rule`（分支 `feat/import-dir-rule-default-on`，base 6c8a872）按 `docs/Iterations/import-dir-rule-default-on/spec.md` 实现 Step 1~4 全部内容 + Step 5 可选重构，Step 6 真机验收不做。按逻辑块提交（中文 commit message）。

## 实现要点

- 新增共享 helper `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts`：导出 `ensureImportDirRules`（导入事务内补行入口）、`backfillMissingDirRules`（求差/跳根/规范化内核，vfs-tools 复用）、`buildDefaultDirRule`（默认启用行构造，与 `setDirRule({logicalPath})` 无既有行时产物逐字段等价）。
- 键空间分离落地：查 VFS 表用 vfs `scopeKey`（session 为 `session:${projectId}:${sessionId}`），读写 workplace 表用 `workplaceScopeKey`（session 为 `session:${sessionId}`），T-I4 双向断言（workplace 键空间有行 + vfs 键空间无行）守卫。
- 两个导入服务（character-card-import / vfs-zip-io）在事务内、文件写入后、baseline 回填前接入；TestHook 各新增 `createWorkplaceRepo`（@internal，T-I5 注入坏 SQL 验证语句级失败不毒化事务——注意不能写 `(factory ?? Class)(tx)`，类没有 new 调不了，须显式分支）。
- T-C15 源码正则断言按 spec 主动删除改写为行为契约（正则实际不拦新标识符，但意图已脱节，spec 明令不得跳过改写）。
- mobile `VfsFileManager.tsx` `runImport` 删快照+补行循环，时序收敛「导入→reload→toast」；`defaultDirRuleForm` 仍被新建目录弹窗引用，保留。
- Step 5：`vfs-tools.ts` 的 `ensureDirRulesForNewPath` 切到 `backfillMissingDirRules` 内核，写入载体仍 service `setDirRule`，`BuiltinToolContext` 形状不变，27 用例全绿。

## 验证与结果

- core 全量 `npm test`：1786 pass / 0 fail；`vfs-tools` / `character-card-import` / `vfs-zip-io` / `ensure-import-dir-rules` 单独跑均全绿。
- mobile `tsc --noEmit -p tsconfig.build.json --ignoreDeprecations 6.0` exit=0（裸跑会撞存量 TS5101 baseUrl deprecation，TS 6.0.3 环境问题与本次无关）；`VfsFileManager.tsx` eslint 2 error 为存量 `react-hooks/exhaustive-deps`（L454/558，diff 外）。
- 提交链：4b4c072（helper+单测）→ da8edcd（角色卡接入+T-C15 改写）→ 8c06e9e（ZIP 接入）→ c7960f4（mobile 清理）→ 3190e9e（vfs-tools 内核复用）。

## CR fix-spec（spec-fix-import，round 1，2026-08-30）

按 review-import round 1 结论新建 `docs/Iterations/import-dir-rule-default-on/cr-fix-spec.md`（status=draft，dag_version=2，只改文档不改实现）。must-fix 四条：MF-1 [P1] 删 `ensureImportDirRules` 根短路（`prefix === "/"` 整体 return 把「根自身不补」扩大成「根前缀下全不补」，CLI `--path` 缺省 / desktop `resolveDirectoryPath` 缺省均为 `/`，bug 原样保留；内核 `backfillMissingDirRules` 已正确跳过 `/` 候选，删短路即可）+ 两导入测试文件各补根导入用例；MF-2 [P2] 删 `scope as unknown as WorkplaceScope` 双断言（`WorkplaceScope = VfsScope` 纯别名，workplace-types.ts:10 已核实）；MF-3 [P2] writeDefaultRule 回调侧逐目录 try/catch + warn（内核不动，vfs-tools 复用路径行为不变）+ 中途失败用例；MF-4 [P2] `vfs-zip-io.test.ts` 补 `testHook.createWorkplaceRepo` 同构故障注入用例（该钩子在两服务均存在、ZIP 侧零测试使用已核实）。deviation：spec 决策 7「跳过根路径」被误读扩大，对应 MF-1，修复后转 fixed。open questions 三条不阻塞（global/project scope 集成覆盖、`buildDefaultDirRule` 绕过 `assertLogicalPathAllowed`、决策 6 与 PRD 需求 4 措辞解释空间）。

## 环境坑

- worktree 无 node_modules 也无 dist：先 `pnpm install` 再 `npm run build`（core），否则测试撞 `@novel-master/core/*` → dist 解析失败。
- `pnpm install` 会生成 untracked 的 `pnpm-lock.yaml`（仓库跟踪的是 package-lock.json），收尾删除保持工作树干净。
- 本 worktree 的 stash list 里有两个用户旧 stash（thinking-context-toggle / feature-c-ui-optimization 时期的）：验证存量问题时**不要用 `git stash` + `git stash pop` 组合**——工作树干净时 stash 是空操作，pop 会弹出别人的旧条目造成 package-lock.json UU 冲突；本次已用 `git checkout HEAD -- package-lock.json` 恢复，旧 stash 无损。

## CR fix 闭合（fix-cr-import，2026-08-30）

按 cr-fix-spec 闭合全部 4 条 must-fix（从 e355cc5 起，四笔逻辑块提交）：

- MF-1（4500339）：删 `ensureImportDirRules` 的 `prefix === "/"` 整体 return 短路；helper 单测 T-I6 改写为「导入到根：子目录补行、根自身无规则行」；角色卡补 T-I7、ZIP 补 T-Z8 根导入用例（directoryPath="/"，断言子目录默认启用 + 根自身无行，根无行用 `wt.getDirRule("/") === undefined` 断言可行）。
- MF-2（3927e44）：删 `scope as unknown as WorkplaceScope` 双重断言与 `WorkplaceScope` import（纯别名直接传）。
- MF-3（80ce6ea）：`ensureImportDirRules` 的 writeDefaultRule 回调内逐目录 try/catch + console.warn，外层整体吞错仍作兜底；内核与 vfs-tools 路径未动。角色卡 T-I8 / ZIP T-Z9 中途失败用例：目录全集按 path 排序（sqlite `ORDER BY path`），对中间目录 `/角色/世界书` 注入抛错，断言之前/之后目录都补行、失败目录无行、仅 warn 一次。
- MF-4（7c4d938）：ZIP 侧 T-Z10 同构角色卡 T-I5 的 createWorkplaceRepo 坏 SQL 故障注入（逐目录容错后每目录各 warn 一次，不再断言 warn 次数，只断言导入成功/文件完整/无残留行）。

验证：core 全量 `npm test` 1791 pass / 0 fail（原 1786 + 新坦 5 条），`tsc --noEmit` exit=0；worktree 无 mobile 包，K 节 mobile tsc 口径不适用。拆逻辑块提交用了「先回退到只含 MF-1 的中间态再逐笔前向应用」的办法，避免手工切 hunk。
