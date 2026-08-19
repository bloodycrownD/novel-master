---
date: 2026-08-19
---

# 全局文件管理器（只读版）技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/global-fs-manager/prd.md`（方向已按用户三轮拍板收敛：**拼接路径视图 + 纯只读**）。

- 全局工作区 → 全库文件**只读浏览器**：从物理 `/` 渲染全部 VFS 文件（各域拼接为统一视图），可浏览、可查看文件内容，**不提供任何写操作**（新建/编辑/删除/重命名/移动/导入导出全部不进管理器）。
- **技能存储重定位**（未发布零迁移）：`/meta/skills` 从 global/project 域内部提升为独立 meta 域（新 scope kind），与 `template` 同层级。最终物理树：根 = `projects/` + `template/`（全局普通文件）+ `meta/`（全局技能）；项目层 = `template/`（工作区）+ `meta/`（项目技能）+ `sessions/{sid}/`。
- 不动既有三域存储：`vfs_entry` 维持 `(scope_key, path)` 逻辑树现状；所有层级均为**应用层拼接的派生视图**。
- 拆除 global→project pullTemplate 全链；project→session 初始化链保留（其 `meta/skills` 排除项随重定位删除）。

## 基线与依赖

- 本迭代基于 `feat/skills-integration` 分支形态开工：skill 能力已在该分支落地（**未发布、未合 main**）；Step 1 改写的 `packages/core/src/service/skills/impl/skills.service.ts` 等文件以该分支形态为准。
- 合并顺序约束：本迭代分支必须基于 `feat/skills-integration` 分支本身、或该分支合入 main 之后切出，避免 skill 能力缺位导致 Step 1 的改写失去落点。
- desktop / mobile 变更清单（见「变更点清单」）同样以 `feat/skills-integration` 分支形态为准；与 main 形态比对出的差异，先核对该分支再判断。

## 总体方案

1. **技能存储重定位**（core）：`vfs-path-mapper` 新增 meta 域 scope（`VfsScope` 加 `{kind:'global-meta'}` / `{kind:'project-meta',projectId}`；scopeKey `global:meta` / `project:{pid}:meta`；物理前缀 `/meta` / `/projects/{pid}/meta`）。SkillService 内部域解析改写新 scope（上层 `$` 引用/提示词索引/技能管理页/skill 工具均走 SkillService 抽象，零感知）。连锁：`initializeSessionWorkspace` 删 `excludePrefixes:["meta/skills"]`（技能已不在 project 域）；项目复制（D1 携带技能）额外拷 meta 域；技能 zip 导入导出与 `SkillDetailScreen`/`FileEditor` 的 skillRef scope 跟随。未发布无存量数据，不做迁移。
2. **只读物理树服务**（core 新增 `createPhysicalVfsService(conn)`，无 scope，映射层既有三域零改动）：
   - `list(physicalPath)`：目标目录涉及的 scope 逐个 `listEntriesUnderPrefix`（走 `idx_vfs_entry_scope_path` 索引）+ 应用层拼物理路径（global 拼 `/template`、global-meta 拼 `/meta`、project 拼 `/projects/{pid}/template`、project-meta 拼 `/projects/{pid}/meta`、session 拼 `/projects/{pid}/sessions/{sid}`）；懒加载（展开哪层查哪层）。虚拟目录合成：`/projects`、`/projects/{pid}` 及其 `template/`、`meta/`、`sessions/`、`sessions/{sid}` 子目录无表行，从 `chat_project`/`chat_session` 枚举合成（空项目/会话也显示目录行）。
   - `read(physicalPath)`：前缀解析 `{scope, logicalPath}`（先 `/projects/{pid}/sessions/{sid}/` → session；`/projects/{pid}/meta/` → project-meta；`/projects/{pid}/template/` → project；`/meta/` → global-meta；`/template/` → global；其余 → 无此文件）后走既有单 scope `ScopedVfsService.read`。
   - **无任何写方法**（类型层面即不存在）。
   - 三端 runtime 挂 `physicalVfs()` 工厂；CLI 本迭代不接 UI（`nm vfs` 维持 global 域语义；边界注明：`nm vfs` 写入的 `/x` 在物理树视图中对应 `/template/x`——global 域物理前缀为 `/template`，避免路径困惑）。
3. **pullTemplate 拆除**（与浏览功能正交）：core 拆 `projectTemplatePull`/`ProjectService.pullTemplate`；desktop 删 `PROJECTS_PULL_TEMPLATE` 全链 + `WorkspaceHeaderActions` session 分支（`showSync` 收窄 chat-only）；mobile 删 `projectPullFromParent`、`TemplatePullButton`/`pullFromParent` 类型收窄 session-only；CLI 删 `nm project template pull`。`sessionTemplatePull`/`initializeSessionWorkspace`/`copyScope`/`replaceVfsSubtree` 全保留；服务名 `TemplatePullService` 不改。

## 变更点清单

**core**

| 文件 | 改动 |
|---|---|
| `domain/vfs/logic/vfs-path-mapper.ts` | 新增 meta 域 scope：`VfsScope` 加 `{kind:'global-meta'}` / `{kind:'project-meta',projectId}`；`scopeKey()` 生成 `global:meta` / `project:{pid}:meta`；物理前缀（`toPhysicalPath` / `scopePhysicalPrefix`）`/meta` / `/projects/{pid}/meta`；`toLogicalPath` 补对应两 case。既有三域 case 零改动 |
| `service/skills/impl/skills.service.ts` | 域解析改写 meta 域（改 `vfsForDomain` / `vfsForScope` / `scopeKeyOfLocation` 等内部函数——经核实源码中无 `resolveSkillVfs` 之名；逻辑路径 `/meta/skills/...` 不变）。**注意 `scopeKeyOfLocation` 双用途**：其返回值在 `deleteSkill` 里同时喂 `sweepRevisionsUnderScope`（VFS entry/revision 清理，重定位后**必须**拿 meta 域 key）与 `ruleRepo.remove(scopeKey, name)`（负清单 `skill_disabled_rule` 清理，负清单行的 scopeKey 现状硬编码 `project:{pid}`——见 `setDisabled`/`effectiveSkills`/`project.service.ts` 的 `removeScope`）。改写仅限 VFS 清理用途；负清单 scopeKey 维持 `project:{pid}` 语义（或拆成两个函数），`deleteSkill` 内负清单清理沿用旧 key，否则单技能删除后禁用行残留，用户重建同名技能会被意外禁用 |
| `service/skills/create-skills-service.ts` | 装配点：`SkillsServiceDeps` 增 global-meta / project-meta vfs 工厂注入（`createScopedVfsService` 新 scope kind 装配） |
| `service/template/logic/initialize-session-workspace.ts` | 删 `excludePrefixes:["meta/skills"]`（技能已不在 project 域） |
| `service/chat/impl/project.service.ts` | 项目复制额外拷 meta 域（D1 携带技能）；`delete()` 同步清理 `project:{pid}:meta` 域——现状事务内只 `deleteVfsPrefix` 清 `session:{pid}:{sid}`（L162-166）与 `project:{pid}`（L172），新 scopeKey 是独立键，不补即留孤儿 entry 行。GC 覆盖语义：`runDeferredBlobGc` 按全库引用集（entry ∪ revision 反查）回收 blob，与 scopeKey 无关，meta 域行天然纳入，无需为新 scope 特判；但 entry 行清理必须按 scopeKey 显式 `deleteVfsPrefix`（`delete()` 事务后既有的 `runDeferredBlobGc` 调用复用不动） |
| `domain/vfs/logic/strip-known-physical-prefixes.ts` | 错误 message 兜底脱敏补 meta 前缀：新增 project-meta（`/projects/{pid}/meta`）与 global-meta（`/meta`）两条剥离规则，顺序先具体后泛化（对齐既有三条的排布） |
| `service/vfs/create-physical-vfs-service.ts`（新）+ `impl/physical-vfs.service.ts`（新） | 只读物理树服务（list/read/虚拟目录合成/五前缀解析） |
| `service/template/template-pull.port.ts` + `impl/template-pull.service.ts` | 删 `projectTemplatePull` |
| `service/chat/project.port.ts` + `impl/project.service.ts` | 删 `pullTemplate` |
| `public/vfs.ts` / `public/workplace.ts` | 导出面核对 |
| 三端 `create-*-runtime.ts` / `apps/cli/src/runtime.ts` | 挂 `physicalVfs()` |

**desktop**：`ipc-types.ts`（删 `PROJECTS_PULL_TEMPLATE`；`WorkspacePanelScope` 加 `'physical'` + 只读行/读文件请求类型）、`handlers/projects.ts`/`handler-registry.ts`（删 handler；注册物理浏览 handler）、`resolve-vfs-scope.ts`（physical 分流）、`invoke-registry.ts`/`client.ts`、`renderer/features/workspace/WorkspaceHeaderActions.tsx`（删 session 分支 pull）、`nav-workspace.ts`+`ExplorerPane.tsx`+`WorkspaceTree.tsx`（projects 视图全局面板换只读物理树源；行 DTO 复用 `WorkplaceListRowDto`，纳入字段缺省；隐藏写操作菜单）、`PreviewPane`（只读预览路由）。

**mobile**：`GlobalTemplateScreen.tsx`（banner 删「从上级同步」；数据源换 `runtime.physicalVfs()` + 根 `/`；标题语义改「文件浏览器」）、`VfsFileManager.tsx`（新增 `readOnly` 模式：隐藏新建/重命名/删除/移动/ZIP/批量/规则等全部写操作与更多菜单，保留目录导航；`pullFromParent` 收窄 session-only）、`FileEditorScreen.tsx`+`navigation/types.ts`（`scopeKind` 加 `physical` 只读分支：前缀解析后走单 scope read，保存按钮禁用）、`ChatSessionListPanel.tsx`（删 `projectPullFromParent`）、`TemplatePullButton.tsx`（缩窄）。

**CLI**：删 `project/template.ts` + `commands.ts` 对应 case；`session/template.ts` 保留。

**文档**：`README.md`、`docs/monorepo.md` pull 文案更新。

**测试删改**：core `template-pull.test.ts` 拆 3 例（L47/L68/L170）；`vfs-gc-trigger.test.ts` T-G2 两例换载体（`sessionTemplatePull` 或直调 `replaceVfsSubtree`，因果见 T-PR2）；CLI `workplace-e2e.test.ts` 拆 T1；mobile 集成测试 `TemplatePullButton` mock 核对（组件名不变则不动）。

## 受影响的路径反解逻辑

既有物理路径反解逻辑逐一核对新增 `/projects/{pid}/meta` 与 `/meta` 前缀的影响：

| 文件 | 判定 | 说明 |
|---|---|---|
| `domain/vfs/logic/infer-scope-from-path.ts` | **明确排除（不动）** | 迁移专用（旧库物理 path 反解回填）。`/projects/{pid}/meta/...` 不匹配 `PROJECT_TEMPLATE_RE`（该正则要求 `/template` 段，`meta` 段不命中），也不匹配 session/global 规则 → 未命中抛 `INVALID_PATH`，**不会误判**为 project template；本迭代零迁移，旧库不存在 meta 物理路径。「保持原样不动」经核对仍成立 |
| `domain/vfs/logic/strip-known-physical-prefixes.ts` | **需改（Step 1）** | 错误 message 兜底脱敏。现有三条规则不认识 meta 前缀，`/meta`、`/projects/{pid}/meta` 会残留在错误文案里；新增两条剥离规则（project-meta 在前、global-meta 在后，先具体后泛化） |
| `domain/vfs/logic/vfs-path-mapper.ts`（`toLogicalPath` / `toPhysicalPath`） | **需改（Step 1，属 mapper 变更本身）** | 按入参 scope 的前缀精确匹配后剥前缀，无跨域误判风险，仅需为 `global-meta` / `project-meta` 补 case（见变更点清单首行） |

## 详细实现步骤

- Step 1 — phase-skill-relocate — blocking: yes — qa: auto：meta 域 scope（mapper + SkillService 域解析改写）+ initialize-session-workspace 删排除项 + 项目复制拷 meta 域 + `ProjectService.delete()` 同步清理 `project:{pid}:meta` 域 + 脱敏规则补 meta 前缀 + skillRef/zip/UI scope 跟随 + 测试（未发布无存量，无迁移）。
- Step 2 — phase-pull-removal — blocking: yes — qa: auto：core 拆 `projectTemplatePull`/`ProjectService.pullTemplate` + `template-pull.test.ts` 删例 + GC 测试换载体。
- Step 3 — phase-pull-removal — blocking: yes — qa: auto：desktop 删 `PROJECTS_PULL_TEMPLATE` 全链 + `WorkspaceHeaderActions` session 分支；mobile 删 `projectPullFromParent` + 类型收窄；CLI 删命令；测试同步。
- Step 4 — phase-physical-service — blocking: yes — qa: auto：core 只读 `PhysicalVfsService`（list/read/虚拟目录/五前缀解析，含 meta 两域）+ 单测 + 三端 runtime 工厂。
- Step 5 — phase-physical-mobile — blocking: yes — qa: auto：`VfsFileManager` readOnly 模式 + `GlobalTemplateScreen` 换源与文案 + `FileEditorScreen` physical 只读分支 + jest。
- Step 6 — phase-physical-desktop — blocking: yes — qa: auto：`physical` 面板类型 + IPC + `resolve-vfs-scope` 分流 + `nav-workspace`/`ExplorerPane`/`WorkspaceTree` 只读换源 + PreviewPane 只读路由 + node 测试。
- Step 7 — phase-docs-cleanup — blocking: no — qa: auto：文案更新 + 残留 grep 验收 + `SCHEMA_BOOT_VERSION` 与 schema 相关文件零 diff 核对。
- Step 8 — phase-physical-ui-walkthrough — blocking: no — qa: manual_user：双端真机走查（五前缀浏览、文件内容查看、无任何写入口、pull 入口消失、技能管理/新建/导入导出回归）。

依赖序：1 → {2,3,4} 可并行（4 依赖 1 的 meta scope）→ {5,6} 并行 → 7 → 8。

## 测试策略

### 测试用例

- T-SR1 — blocking: yes — 技能重定位：global 技能落 `global:meta` 域 `/meta/skills/...`，project 技能落 `project:{pid}:meta`；上层（effectiveSkills/readSkillFile/$ 引用/提示词索引/skill 工具）行为不变。→ Step 1
- T-SR2 — blocking: yes — 会话初始化不再需要排除项：project 域内容全部带入 session，技能天然不带；项目复制携带 meta 域技能。→ Step 1
- T-SR3 — blocking: yes — 项目删除无孤儿：`ProjectService.delete()` 后 `project:{pid}:meta` 与 `project:{pid}`、`session:{pid}:{sid}` 同样零 entry 残留；随后的 `runDeferredBlobGc` 后无 orphan blob。→ Step 1
- T-PR1 — blocking: yes — core 无 `projectTemplatePull`；session 创建/重置行为不变（保留用例全绿）。→ Step 2
- T-PR2 — blocking: yes — GC 覆盖不回退（T-G2 两例换载体后断言仍过）。换载体因果：两例直接调用 `projectTemplatePull`（`vfs-gc-trigger.test.ts` L147/L189），**Step 2 拆除该方法后测试编译失败**，故随 Step 2 换载体（`sessionTemplatePull` 或直调 `replaceVfsSubtree`）；第二例的「隔离豁免」断言另依赖 `projectTemplatePull` 内 `excludePrefixes:["meta/skills"]`（`template-pull.service.ts` L41），技能重定位（Step 1）后该豁免语义已消失，换载体时断言改盯 `replaceVfsSubtree` 的通用 sweep/GC 语义。→ Step 2
- T-PR3 — blocking: yes — 残留 grep：`projectTemplatePull|PROJECTS_PULL_TEMPLATE|projects\.pullTemplate|nm project template pull` 在 `packages/*/src`、`apps/*/src|renderer|shared`、`apps/*/test*` 零命中（**排除 `.woktree/`、`dist/`**；session 侧保留项不算）。→ Step 2/3/6（全绿时点在 desktop/CLI 拆除的 Step 3 之后）
- T-PB1 — blocking: yes — 物理根列目录：`template/`（全局普通文件）+ `meta/skills/*`（全局技能）+ 合成 `projects/` 树（含各项目 `template/`、`meta/`、`sessions/`）；空项目与空会话均显示目录行（`sessions/{sid}/` 同样合成）。→ Step 4
- T-PB2 — blocking: yes — `read` 五前缀解析正确（session → project-meta → project → `/meta/` global-meta → `/template/` global → 不存在）；`list`/`read` 之外服务无任何写方法（类型断言）。→ Step 4
- T-PB3 — blocking: yes — mobile：readOnly 模式下无新建/删除/更多菜单；点文件进只读预览（保存禁用）。→ Step 5
- T-PB4 — blocking: yes — desktop：physical 面板只读渲染与只读预览。→ Step 6
- T-PB5 — blocking: no — 真机走查清单。→ Step 8

### 命令

core：`npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test "test/**/*.test.ts" --test-ignore "test/**/performance.test.ts"`；mobile：`npx jest <文件>` + `tsc --noEmit -p tsconfig.build.json`；desktop：`node scripts/run-tests.mjs --test-concurrency=1 <文件>` + `npm run typecheck`。CRLF 文件禁 python 文本模式（历史假 diff 教训）。

## 风险与回滚方案

- **技能重定位波及面**：SkillService 域解析、技能管理 UI 的 scope、skillRef 路由、zip 导入导出路径、项目复制——均走既有抽象/单点，逐一跟随改写（T-SR1/2 盯住）；未发布无存量数据，开发库作废重建即可。
- **顺序敏感前缀解析**：先 session → project-meta → project → `/meta/`（global-meta）→ `/template/`（global），最后未命中报不存在；`infer-scope-from-path.ts`（迁移专用）保持原样不动（依据见「受影响的路径反解逻辑」：meta 路径未命中其规则会抛 `INVALID_PATH` 而非误判，且本迭代零迁移、旧库无 meta 物理路径）。
- **性能**：跨域列目录 = N scope 各一次索引查询；懒加载兜底，单机规模可接受；不做全表扫 SQL（path 无单列索引）。
- **SCHEMA_BOOT_VERSION**：不动（零 DDL/数据变更）。
- **回滚**：各 Step 独立提交独立 revert；`PhysicalVfsService` 为纯新增，删除即回滚；存储层本方案零触碰，无不可逆操作。
