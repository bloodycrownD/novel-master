# APM 记忆：技能存储重定位（impl-s1 / global-fs-manager）

## 2026-08-19 impl-s1 节点启动

- 请求：在 worktree `.woktree/global-fs`（分支 `feat/global-fs-manager`）执行 Step 1「phase-skill-relocate」——把 `/meta/skills` 从 global/project 域内部提升为独立 meta 域（新 scope kind）。
- 关键改动面：
  - `vfs-path-mapper.ts` 新增 `global-meta` / `project-meta` scope。
  - `skills.service.ts` 域解析改 meta 域；注意 `scopeKeyOfLocation` 双用途：VFS 清理用 meta key，负清单（`skill_disabled_rule`）仍用 `project:{pid}`，否则删除技能后禁用行残留。
  - `create-skills-service.ts` 装配 meta vfs 工厂。
  - `initialize-session-workspace.ts` 删 `excludePrefixes:["meta/skills"]`。
  - `project.service.ts` 复制带 meta 域、delete() 清 `project:{pid}:meta`。
  - `strip-known-physical-prefixes.ts` 补两条 meta 剥离（先具体后泛化）。
  - mobile 侧 skillRef / skill zip 导入导出 scope 跟随改写。
- 阻塞测试：T-SR1 / T-SR2 / T-SR3。
- 排除：`infer-scope-from-path.ts` 不动；不做 Step 2/3/4。

## 2026-08-19 impl-s1 交付结果

- 三个 commit（feat/global-fs-manager）：6ae0445 mapper+脱敏+workplaceScopeKey；4d18789 core 重定位主体+T-SR1/2/3 测试；1f96b06 desktop/mobile 域指向跟随。
- 验证：core build + 全量 2025 测试全绿；mobile tsc + 5 个 jest 文件 57 测全绿；desktop tsc + 23 个相关 node 测试全绿。
- worktree 环境坑：worktree 无 node_modules，已在 worktree 根建 `node_modules/@novel-master/*` 软链（core 等指向 worktree 包并逐个 tsc 构建 dist，yaml 软链自主仓），`apps/desktop/node_modules` 整体软链主仓（无 @novel-master 内链，安全），并加 .git/info/exclude 本地排除。后续节点可直接复用。
- desktop 技能 zip 导入/单文件删除走 `workspaceScope: 'global-meta'/'project-meta'`（WorkspacePanelScope 扩展 + resolve-vfs-scope 分流）。
