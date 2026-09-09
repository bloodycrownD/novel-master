---
date: 2026-09-06
dependency: Iterations/export-link-skill-mgmt-2026-09/prd.md
---

# 导出命名固定化 + desktop 技能导出入口 PRD

## 背景

应用现有用户可见导出共 5 类，命名现状（探索证据：`apps/mobile/src/services/db-backup.service.ts`、`apps/mobile/src/services/vfs-zip.service.ts`、`apps/desktop/src/main/services/db-backup.service.ts`、`apps/desktop/src/main/services/vfs-zip.service.ts`、双端 `agent-yaml.service.ts`）：

- 数据库备份：`novel-master-backup-{毫秒时间戳}.nmbackup`——时间戳不可读，用户保存后难以分辨。
- 技能 ZIP 导出（仅 mobile 有入口）：复用 VFS ZIP 通道，产出 `vfs-global-meta-meta-skills-{技能名}.zip`（全局）或 `vfs-project-{projectId UUID}-meta-meta-skills-{技能名}.zip`（项目）——「meta」出现两次、无「skill」字样、泄漏 UUID。
- Agent YAML：`{agent名}.agent.yaml`（`AgentDefinition` 主键即人类可读名）——已语义化，本轮列入验收锁定（用户点名，防口径含糊）。
- VFS 通用 ZIP：`vfs-{scope}-{UUID}-{路径拼接}.zip`——泄漏 scope 细节与 UUID（用户拍板本轮一并治理）。
- desktop 批量拖拽导出：保留 VFS 原名——合理，不动。

desktop 技能管理页只有 ZIP 导入（`NewSkillModal` 注释明示「本产品导出格式：根即技能目录」），没有导出入口——格式契约存在但桌面侧没接。

**全局工作区已移除（用户勘误，代码核实）**：desktop 原 global 面板不再展示（`nav-workspace.ts:16` 注释）；mobile 仅剩 `GlobalTemplateScreen`——已改为「文件浏览器」（profile 入口，physicalVfs 跨域拼接只读视图），readOnly 模式下所有行菜单置空、无任何导出入口。因此 VFS 通用导出的 UI 调用方只剩项目工作区与会话工作区。

导入侧兼容性已核实：desktop 导入过滤器同时收 `nmbackup`/`db` 扩展名（`db-backup.service.ts:186`），mobile 导入按 SQLite 魔数校验（`assertSqliteBackupAtPath`）与文件名无关——改名不破坏导出→导入闭环。VFS/技能 ZIP 的导入按包内容识别（ZIP 根结构），同样不依赖文件名。

## 目标（含成功指标）

导出文件默认名固定语义化：数据库备份 `nmbackup.db`、技能 `{技能名}.zip`、VFS 通用导出 `{目录名}.zip`（根导出 `{项目名}.zip`）；Agent YAML 维持 `{agent名}.agent.yaml`；desktop 补齐技能导出入口。成功指标：所有导出场景保存框默认名即最终可用名，用户零手动改名。

## 用户与场景

双端用户导出数据库备份做迁移/备份；分享或备份单个技能；导出工作区或子目录做迁移/分享；desktop 用户此前只能去 mobile 导技能。

## 范围

### 包含范围

1. 数据库备份默认文件名固定为 `nmbackup.db`（双端）。
2. 技能 ZIP 导出默认文件名改为 `{技能名}.zip`（mobile 现有入口改名）。
3. desktop 技能管理页新增「导出 ZIP」入口（对齐 mobile 行菜单位置），默认名 `{技能名}.zip`，产物格式与 mobile 一致（ZIP 根即技能目录），双端可互导。
4. VFS 通用 ZIP 导出命名改为 `{导出目标目录名}.zip`（用户拍板规则）：导出子目录时用目录名；导出顶级目录 `/` 时用**项目名**（会话工作区与项目工作区通用，session scope 经 projectId 解析项目名）；「单文件 → `{文件名}.zip`」为**函数级口径**（命名函数支持文件目标；双端 UI 现无文件级导出入口，本轮不新增，见 spec 总体方案 #5）。
5. Agent YAML 导出命名保持 `{agent名}.agent.yaml`（现状已达标，纳入验收防回归）。

### 不包含范围

- 云同步快照、拖拽导出的命名。
- 导出内容/压缩格式变更。
- 强制文件名（保存框中用户仍可改名，默认名只是建议值）。
- 同名消歧（同名项目/目录/技能导出同名文件，保存框可手动改名）。

## 核心需求（3-7 条）

1. `backupFileName()` 双端改为固定返回 `nmbackup.db`。
2. 技能导出文件名与 VFS ZIP 通道解耦：调用方可指定语义名 `{技能名}.zip`。
3. desktop SkillsManageView 行菜单增加「导出 ZIP」，走系统保存对话框（defaultPath 为 `{技能名}.zip`）。
4. `vfsZipExportFileName`（双端对称拷贝，两处同改）重写为目录名规则：目标目录名（根 `/` → 项目名；文件 → 文件名）+ `.zip`；scope/UUID/路径拼接全部不再进入文件名。global/global-meta 分支处理：global-meta 由技能导出改名覆盖，global 分支已无 UI 调用方（去留在 spec 阶段定）。
5. 技能 ZIP 与 Agent YAML 命名不回归（验收锁定）。

## 验收标准

- Given 双端任一端「导出数据库」 When 保存框弹出 Then 默认文件名为 `nmbackup.db`。
- Given mobile 技能管理页导出某技能 When 保存 Then 默认名为 `{技能名}.zip`。
- Given desktop 技能管理页 When 打开行菜单 Then 可见「导出 ZIP」且默认名 `{技能名}.zip`。
- Given desktop 导出的技能 ZIP When 在 mobile 导入 Then 成功识别为该技能（反向同理）。
- Given 名为 `nmbackup.db` 的备份文件 When 双端导入 Then 均成功恢复（魔数校验不受扩展名影响）。
- Given 项目工作区（或会话工作区）导出顶级目录 When 保存 Then 默认名为 `{项目名}.zip`。
- Given 导出工作区内某子目录 When 保存 Then 默认名为 `{目录名}.zip`。
- Given 命名函数对文件目标求值 When 调用 Then 返回 `{文件名}.zip`（函数级口径，无 UI 入口）。
- Given mobile/desktop 导出 agent When 保存 Then 默认名为 `{agent名}.agent.yaml`（现状锁定）。

## 风险与待确认项

- 全局与项目域同名技能、同名项目/目录导出会得到同名文件（保存框可手动改名，默认不做消歧）。
- session scope 根导出用项目名：项目重命名后导出名跟随新名（即时解析，无缓存问题）；同一项目多个会话导出同名 `{项目名}.zip` 属预期（会话内容可能不同，靠保存位置/手动改名区分）。
- 单文件导出已闭环为函数级口径（无 UI 入口、不新增；未来若加文件导出入口，命名函数已就位）。
- `vfsZipExportFileName` 的 global 分支为无 UI 调用方的死代码，spec 阶段决定清理或保留。
