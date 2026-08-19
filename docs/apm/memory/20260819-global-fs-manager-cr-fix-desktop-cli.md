# global-fs-manager CR 修复执行（impl-cr-desktop，desktop + cli 侧）

- 日期：2026-08-19
- 分支：feat/skills-integration（主仓），节点 impl-cr-desktop
- 事实来源：docs/Iterations/global-fs-manager/cr-fix-spec.md
- 前置：wave-0 core 侧已就绪（listTree 批量接口 `2c94190`、排序键 basename `6fbb4ce`、meta 双前缀 P0 `381a715`）

## 任务范围（只动 apps/desktop/** 与 apps/cli/**）

1. desktop/B-1 [P1]：handlePhysicalList 错误隔离——per-scope try/catch，NOT_FOUND 跳过该子树，其余域行照常返回。
2. desktop/B-2 [P2]：从循环逐层 vfs.list 改为 listTree 批量拉取。
3. desktop/C-1 [P2]：nav-workspace 删 WorkspaceScope 的 global 成员与 WORKSPACE_TITLES.global，兜底改 `?? "physical"`；保留 shared WorkspacePanelScope 的 'global' 与 ShellNavProvider L187 判定。
4. desktop/G-1 [P2]：补 /projects/{pid} 行 label 断言；修 docstring（「面板只读渲染」→ 明确仅覆盖 IPC 层）。
5. cli/G-2 [P2]：template-pull-e2e 补 `project template pull` 已下线负向断言（非 0 退出 + stderr 含 "Usage: nm project"）。

## 结果（2026-08-19 执行完毕，两个 commit）

- `05a671b` fix(desktop): physical 全树改 listTree + per-scope 错误隔离；nav-workspace 删 global 死分支
  - **B-1/B-2 关键设计**：core 的 listTree("/") 内部是 meta/template/projects 三段串行查询，
    任一失败整体 reject、无部分失败语义；因此 desktop 根请求按三顶层挂载点拆成三次
    listTree 调用（查询量与单次等价）换取 per-scope 隔离；非根请求单次 listTree，
    NOT_FOUND 降级为 ok:true + 空行集（旧实现整请求 ok:false）
  - 根请求的三个挂载点目录行由 handler 自行合成补齐（listTree 不含查询根行），
    scope 拉取失败时挂载点根行仍保留（面板显示空目录而非消失）
  - 测试注入方式：rt.physicalVfs() **每次返回新实例**（createPhysicalVfsService(conn)），
    wrap 实例方法无效，须 wrap runtime 上的工厂方法再 finally 恢复
- `5da4e76` test(cli): 补 project template pull 下线负向断言
  - 实测 stderr：`Usage: nm project <list|create|use|current|delete|copy|vfs|workplace> ...`

## 测试造数波及（wave-0 P0 的 desktop 侧对齐）

physical-vfs-ipc.test.ts 造数 `global-meta` 写 `/skills/...` 是旧约定（旧物理前缀 /meta）；
P0 修复后逻辑路径需自带 /meta 段，改为写 `/meta/skills/demo/skill.md`，否则
listTree("/meta") 为空、read NOT_FOUND（既有用例 1/5 红）。core 侧 T-PB1/T-PB2
已在 wave-0 同步，desktop 这份当时漏改。

## 验证

- apps/desktop `npm run typecheck` 通过（main/preload）
- renderer 侧 tsc -p tsconfig.renderer.json：nav-workspace/ShellNavProvider 无错误；
  PreviewPane 等存在**既有**错误（TextAnnotator 系列 + toCoreVfsScope TS2366——
  WorkspacePanelScope 含 physical 但 switch 未覆盖，physical 面板上线时遗留，非本次范围）
- `node scripts/run-tests.mjs --test-concurrency=1 test/physical-vfs-ipc.test.ts`：
  7 pass / 0 fail（6 既有 + 新增 2，原用例 1 内并入 label 断言）
- apps/cli `npm run typecheck` 通过；`tsx --test test/template-pull-e2e.test.ts`：
  新增 T4 绿；既有 T3 红（**基线即红**，stash 验证过）——session pull 后
  /extra.md 未被清掉，疑 core 侧 replaceVfsSubtree/pullTemplate 行为波及，待查

## 坑与教训

- 子目录里 `git stash push -- <相对pathspec>` 会拼成 `apps/desktop/apps/desktop` 失败，
  且 `&&` 断链后误弹了仓库里**别人的旧 stash**（feature-c-ui-optimization 的 WIP）
  导致 package-lock.json 冲突——恢复方式：`git restore --source=HEAD --staged --worktree
  package-lock.json`，旧 stash 原样保留。stash 指定 pathspec 必须在仓库根执行。
- `@novel-master/core/vfs` public 入口只导出 VfsError/isVfsError（无 vfsNotFound），
  测试注入用 `new VfsError("NOT_FOUND", msg, { path })` 构造。
- desktop 测试跑的是 packages/core/dist（非 src），core 改完要确认 dist 已重建。
