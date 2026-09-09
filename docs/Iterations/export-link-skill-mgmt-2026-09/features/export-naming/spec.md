---
date: 2026-09-06
---

# 导出命名固定化 + desktop 技能导出入口 技术规格（SPEC）

## 设计目标

按 PRD（同目录 `prd.md`）落地：数据库备份固定名 `nmbackup.db`、技能 ZIP `{技能名}.zip`、VFS 通用导出 `{目录名}.zip`（根 → `{项目名}.zip`）、Agent YAML 验收锁定、desktop 技能管理页补「导出 ZIP」入口。所有命名只是**保存框默认值**（用户可改），导入侧均不依赖文件名（已核实闭环）。

依据：探索报告 A（双端导出链、IPC、测试挂点，log 20260906-231624-508）。

## 总体方案

1. **备份命名**：双端对称私有函数 `backupFileName()` 直接改返回 `'nmbackup.db'`；desktop 保存框 filters 从 `["nmbackup"]` 扩为 `["db","nmbackup"]`（Windows 上默认名扩展与 filter 不匹配时 Electron 会自动追加 filter 扩展，产出 `nmbackup.db.nmbackup`，必须同步改）。
2. **VFS ZIP 命名**：命名推导保持**纯函数 + 调用方传名**的分层——纯函数 `zipBaseNameFromPath(targetPath)` 只做「子目录 → 末段名；根 → null；文件 → basename」；项目名由服务层查 `runtime.projects.get(projectId)`（session/project scope 均天然携带 projectId，desktop 主进程与 mobile runtime 都挂了 `projects: ProjectService`）。查询失败/域无项目名可解析时 fallback `'workspace.zip'`。`vfsZipExportFileName` 现有的 scope/UUID/路径拼接逻辑与 global 死分支全部删除。
3. **fileName 覆盖参数**：mobile `exportVfsZip` options 与 desktop `exportVfsZipWithDialog` options 加可选 `fileName`，有覆盖用覆盖（技能导出走它）；desktop `VfsZipRequest`（`ipc-types.ts`）加 `fileName?`，`handleVfsZipExport` 透传——`handleVfsZipImport` 共用该类型但不消费 fileName，零破坏。
4. **desktop 技能导出**：`SkillsManageView` 行菜单加「导出 ZIP」，调既有 `ipcVfsZipExport`，参数照 `NewSkillModal` 导入链的对称契约（`workspaceScope: domain==='global' ? 'global-meta' : 'project-meta'` + `projectId` + `directoryPath: /meta/skills/{name}`）附 `fileName: '{name}.zip'`。**无需新 IPC 通道**。
5. 单文件导出：双端 UI 均无文件级导出入口（mobile 文件行菜单无导出、desktop `zipDirectoryPathForTarget` 对文件行返回 null 且有反向测试锁定），PRD 的「`{文件名}.zip`」按**函数级口径**实现（纯函数对文件路径返回文件名），不新增 UI 入口。

## 最终项目结构（变更文件）

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/services/db-backup.service.ts` | `backupFileName()` → `'nmbackup.db'` |
| `apps/desktop/src/main/services/db-backup.service.ts` | 同上 + `exportDatabaseBackup` filters 加 `"db"` |
| `apps/mobile/src/services/vfs-zip.service.ts` | `vfsZipExportFileName` 重写为 `zipBaseNameFromPath` 纯函数 + 项目名解析；`exportVfsZip` options 加 `fileName?` |
| `apps/desktop/src/main/services/vfs-zip.service.ts` | 同构改动（双端逐字对称模式保留） |
| `apps/desktop/shared/ipc-types.ts` | `VfsZipRequest` 加 `fileName?` |
| `apps/desktop/src/main/ipc/handlers/vfs.ts` | `handleVfsZipExport` 透传 `fileName` |
| `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx` | `runSkillZipExport` 传 `fileName: '${skill.name}.zip'` |
| `apps/desktop/renderer/features/settings/SkillsManageView.tsx` | 行菜单加「导出 ZIP」+ 处理分支 |
| 测试 | 见测试策略 |

## 变更点清单

1. `backupFileName` 双端固定名（mobile `db-backup.service.ts:36` / desktop `db-backup.service.ts:37`）。
2. desktop filters `["db","nmbackup"]`（exportDatabaseBackup 两处 showSaveDialog 分支）。
3. `vfsZipExportFileName` 删五分支 scope 命名，改为：`fileName` 覆盖 > 根→项目名（服务层查 `projects.get`）> 子目录→末段 > fallback `'workspace.zip'`；global 分支删除（双端死代码，探索报告⑥核实）。
4. mobile `exportVfsZip` / desktop `exportVfsZipWithDialog` options 加 `fileName?`；desktop IPC 类型与 handler 透传。
5. mobile `runSkillZipExport` 附 `fileName`；desktop `SkillsManageView` 菜单项 + `ipcVfsZipExport` 调用。

## 详细实现步骤

- Step 1 — phase-export-backup-name — blocking: yes — qa: auto：mobile `db-backup.service.ts` 的 `backupFileName()` 改返回 `'nmbackup.db'`（常量 `BACKUP_EXT` 与 `exportDatabaseBackupToPath` 云同步路径不受影响，勿动）。
- Step 2 — phase-export-backup-name — blocking: yes — qa: auto：desktop `db-backup.service.ts` 同款改名；`exportDatabaseBackup` 的两处 `showSaveDialog` filters 改 `[{name: "Novel Master Backup", extensions: ["db", "nmbackup"]}]`。
- Step 3 — phase-export-zip-naming — blocking: yes — qa: auto：mobile `vfs-zip.service.ts`：新增纯函数 `zipBaseNameFromPath(targetPath: string): string | null`（子目录→末段、根→null、文件→basename）；`exportVfsZip` options 加 `fileName?`；文件名解析顺序 `options.fileName ?? (base ? base+'.zip' : 项目名+'.zip')`，项目名经 `runtime.projects.get((scope as {projectId?:string}).projectId)`（session/project 均有；抛错或无 projectId → `'workspace.zip'`）；删除旧 `vfsZipExportFileName`。
- Step 4 — phase-export-zip-naming — blocking: yes — qa: auto：desktop `vfs-zip.service.ts` 同构（`exportVfsZipWithDialog` options 加 `fileName?`、defaultPath 同规则、`runtime.projects.get` 解析项目名）；保持与 mobile 逐字对称的可对照结构。
- Step 5 — phase-export-zip-naming — blocking: yes — qa: auto：desktop `ipc-types.ts` `VfsZipRequest` 加 `readonly fileName?: string`；`handlers/vfs.ts` `handleVfsZipExport` 调 `exportVfsZipWithDialog` 时透传 `fileName: req.fileName`。
- Step 6 — phase-export-skill-desktop — blocking: yes — qa: auto：mobile `SkillsSettingsScreen.runSkillZipExport` 调 `exportVfsZip` 时附 `fileName: '${skill.name}.zip'`。
- Step 7 — phase-export-skill-desktop — blocking: yes — qa: auto：desktop `SkillsManageView` `menuItems` 加 `{label: "导出 ZIP", ...}`（排在「编辑」后「删除」前）；处理分支调 `ipcVfsZipExport({workspaceScope: domain==='global'?'global-meta':'project-meta', ...(domain==='project'?{projectId}:{}), directoryPath: '/meta/skills/'+name, fileName: name+'.zip'})`，完成后 toast。
- Step 8 — phase-export-changelog — blocking: no — qa: auto：CHANGELOG Unreleased 记行为变更（备份默认名、ZIP 命名、desktop 技能导出入口）。

## 测试策略

跑法约束：mobile jest 须 `NODE_ENV=test`（#22）；desktop 测试须 `NODE_ENV=development`（#26）；mobile 类型检查用官方 typecheck 脚本（#38）。

### 测试用例

- T-E1 — blocking: yes — Step 1/2：mobile `__tests__/db-backup.service.test.ts` 临时路径与 `saveDocuments` fileName 断言改 `nmbackup.db`（原 136/141 行正则）。
- T-E2 — blocking: yes — Step 2：desktop 新增（或扩 `electron-stub` 模式）断言 `showSaveDialog` 收到 `defaultPath: 'nmbackup.db'` 且 filters 含 `"db"`。
- T-E3 — blocking: yes — Step 3/4：mobile `vfs-zip.service.test.ts` 改写（原 126-143、215-228 断言）：①`fileName` 覆盖优先；②子目录 → `{末段}.zip`；③根 + mock `projects.get` → `{项目名}.zip`；④项目解析失败 → `workspace.zip`；⑤文件目标 → `{文件名}.zip`（函数级口径挂点）；⑥保留「aligned with Desktop」双端对齐断言思路（desktop 无既有 vfs-zip 服务测试，对齐断言落在 T-E4 handler 测试断言 defaultPath 与 mobile 同规则）。
- T-E4 — blocking: yes — Step 5：desktop handler 测试（`setupDesktopDbTestEnv` 真库直调模式）断言 `VfsZipRequest.fileName` 透传到 dialog defaultPath。
- T-E5 — blocking: yes — Step 7：desktop `SkillsManageView` 源码/渲染断言含「导出 ZIP」菜单与 `fileName: name+'.zip'` 参数（照 `workspace-zip-menu.test.ts` 模式）。
- T-E6 — blocking: yes — 全步：`agent-yaml.service.test.ts` 既有断言不回归（`{agent名}.agent.yaml` 锁定）。
- T-E7 — blocking: no — qa: manual_user：真机/桌面双端导出数据库、技能、工作区根与子目录，目检保存框默认名；desktop 导出的技能 ZIP 在 mobile 导入成功。

## 风险与回滚方案

- Windows filter 追加扩展：已用双扩展 filters 规避（T-E2 锁定）。
- 项目已删除时导出根目录：fallback `workspace.zip`，不阻断导出。
- 旧文件名无兼容负担：导入按 SQLite 魔数 / ZIP 根结构识别，不读文件名。
- 回滚：单 feature 分支 revert 即可，无数据迁移、无 schema 变更。
