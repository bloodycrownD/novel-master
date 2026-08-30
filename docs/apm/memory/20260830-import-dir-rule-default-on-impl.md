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

## 环境坑

- worktree 无 node_modules 也无 dist：先 `pnpm install` 再 `npm run build`（core），否则测试撞 `@novel-master/core/*` → dist 解析失败。
- `pnpm install` 会生成 untracked 的 `pnpm-lock.yaml`（仓库跟踪的是 package-lock.json），收尾删除保持工作树干净。
- 本 worktree 的 stash list 里有两个用户旧 stash（thinking-context-toggle / feature-c-ui-optimization 时期的）：验证存量问题时**不要用 `git stash` + `git stash pop` 组合**——工作树干净时 stash 是空操作，pop 会弹出别人的旧条目造成 package-lock.json UU 冲突；本次已用 `git checkout HEAD -- package-lock.json` 恢复，旧 stash 无损。
