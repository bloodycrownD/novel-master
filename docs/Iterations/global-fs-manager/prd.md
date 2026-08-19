---
date: 2026-08-19
dependency: []
---

# 全局文件管理器（只读版）PRD

## 背景

现状：「全局工作区」本质是模板库——数据存于 `vfs_entry` 表 global scope（物理前缀 `/template`），唯一用途是经 pullTemplate 破坏性快照灌入项目（删项目整树再拷贝 + 规则 copyScope）。用户在全局工作区看到 `meta/skills` 并非泄漏：全局技能物理上就住在 global 域，展示层从未过滤。

探索确认的三个数据事实（方案前提）：

1. VFS 纯虚拟（`vfs_entry`/`vfs_revision`/`vfs_content_blob` 三表），无磁盘镜像；「真实目录」= 物理路径树。
2. 会话元数据与消息是表行（`chat_session`/`chat_message`），不在文件树中；树中仅有各会话工作区文件（`/projects/{pid}/sessions/{sid}`）。
3. 物理树根 = `/template`（全局域）+ `/projects`（项目与会话）。

方向演变（用户多轮拍板，以下为最终收敛方向）：早期方案为「可写管理器 + `/template` 扁平化上提根目录」，经多轮讨论最终收敛为——

- **纯只读拼接路径视图**：全局工作区重定义为跨域真实文件只读浏览器（从物理 `/` 渲染）：可浏览、可查看文件内容；不提供任何写操作（新建/编辑/删除/重命名/移动/ZIP 导入导出均不进管理器）；只读本身即保护，不做额外路径保护。
- **技能存储重定位**：`/meta/skills` 从 global/project 域内部提升为独立 meta 域（新 scope kind），与 `template` 同层级；skill 能力未发布，零迁移。
- **`/template` 保留不扁平化**：最终物理树根 = `projects/` + `template/`（全局普通文件）+ `meta/`（全局技能）。
- **不动存储**：`vfs_entry` 维持三域现状 + 新增 meta 域 scope kind，零 DDL、SCHEMA_BOOT_VERSION 不动。
- **拆除同步链**：移除 global→project pullTemplate 全链；project→session 初始化链保留。

开工基线：`feat/skills-integration` 分支形态（skill 能力已在该分支开发、未发布未合 main，因此技能重定位无存量数据、零迁移）。

## 目标（含成功指标）

- 全局工作区从「无实际价值的模板中转站」变为可检视全部数据的真实只读浏览器：每个技能文件、每个项目工作区、每个会话工作区文件的真实位置一览无余，可查看内容。
- 技能文件拥有独立、清晰的存储位置（meta 域），不再混在普通文件域内部。
- 移除 pullTemplate 后行为可预期：新项目空启动，内容来源 = 项目复制 / ZIP 导入导出。
- 成功指标：全局管理器可浏览 `/` 下任意 VFS 文件并查看内容、全程无任何写入口；双端不再出现项目侧「从上级同步」入口；core 全量测试通过、代码无 pullTemplate 残留调用点。

## 用户与场景

- 高级用户：想看「我的数据到底存在哪」、查看某个技能文件或某个会话工作区里文件的内容。
- 全体用户：只读无破坏风险，无需额外告知误删风险；需要编辑时走各域既有入口（技能管理页、项目/会话工作区）。

## 范围

### 包含范围

- 跨域拼接只读视图：从物理 `/` 渲染全部 VFS 文件（各域拼接为统一视图），复用现有文件管理器的浏览与查看交互。
- 技能存储重定位：`/meta/skills` 提升为独立 meta 域（全局技能与项目技能各自成域），skill 能力未发布，零迁移。
- 移除 global→project pullTemplate 全链（core 服务、双端按钮、desktop IPC、CLI 命令）。

### 不包含范围

- 任何写操作进管理器（新建/编辑/删除/重命名/移动/ZIP 导入导出均不做；技能与文件的修改走各自既有入口）。
- 接入磁盘真实文件系统（明确否决：mobile 沙盒无可看内容，desktop 可删到 DB 本体）。
- 任何路径保护 / 删除确认强化（只读本身就是保护，管理器内无破坏性操作）。
- project→session 初始化链（`initializeSessionWorkspace` 保留不动）。
- SkillService 对外能力与技能管理 UI（仅存储域位置变化，能力与页面不动）。
- 会话消息 / 元数据的文件化呈现（表行不在文件树，本迭代不涉及）。
- CLI 的物理树浏览界面（`nm vfs` 维持 global 域语义不变）。

## 核心需求（3-7 条）

1. **只读物理树浏览**：全局管理器以拼接物理路径渲染 VFS 全树（根 = `projects/` + `template/` + `meta/`），支持展开浏览与点开查看文件内容；管理器内不存在任何写操作入口（新建/编辑/删除/重命名/移动/ZIP 导入导出均不提供）。
2. **技能存储重定位**：技能文件移入独立 meta 域，与 `template` 同层级；上层技能能力（技能生效、`$` 引用、提示词索引、技能管理页、skill 工具、导入导出）行为不变；skill 能力未发布，无存量数据，零迁移。
3. **同步链移除**：`projectTemplatePull`（含规则 copyScope global→project）、双端项目侧「从上级同步/初始化」、CLI `nm project template pull` 全部下线；project→session 初始化保留。
4. **双端入口与文案更新**：mobile「全局工作区」入口、desktop projects 视图全局面板改为新只读浏览器；清除「项目可通过从上级同步拉取」类文案。
5. **旧数据完整继承**：用户既有全局普通文件（`/template/*`）与项目数据在新视图原样可见；技能数据因未发布无存量，按新 meta 域位置呈现。
6. **数据生命周期完整**：项目删除时其 meta 域技能文件一并清理，不留孤儿数据。

## 验收标准

- Given 全局存在技能 `demo` 与用户文件 `note.md` When 打开全局管理器 Then 根下可见 `template/note.md`、`meta/skills/demo/SKILL.md` 与合成的 `projects/` 树（无扁平化，`template` 层级保留）。
- Given 任意项目 p 与会话 s When 展开根树 Then 可见 `projects/p/template/*`、`projects/p/meta/*` 与 `projects/p/sessions/s/*`；空项目/会话也显示目录行。
- Given 任意文件 When 在全局管理器点开 Then 可查看文件内容，且管理器全程无任何写入口（新建/编辑/删除/重命名/移动/ZIP 导入导出均不存在）。
- Given 任意项目 When 删除该项目 Then 其 meta 域技能文件一并清理，无孤儿数据。
- Given 双端任意项目工作区 When 检查 UI Then 不存在「从上级同步」入口；新建会话仍从项目工作区初始化。
- Given CLI `nm project template pull` When 执行 Then 命令已下线（不存在或明确提示）。
- Given 本次迭代合入 When 检查三端数据库 Then 零 DDL、SCHEMA_BOOT_VERSION 不动。
- core 全量测试通过；全仓 grep 无 pullTemplate 残留调用点。

## 风险与待确认项

- 只读即保护：管理器内无任何破坏性操作，误删风险整体消除；需要修改数据时走各域既有入口，工作流需在发布说明中提示。
- 技能重定位波及 SkillService 域解析、技能管理 UI 的 scope、skillRef 路由、zip 导入导出、项目复制等使用点——skill 能力未发布无存量数据，开发库作废重建即可，不做迁移。
- 「全局文件放根下后各项目可见」不再成立（同步已拆），全局文件仅存在于全局浏览器中——用户工作流变化需在发布说明中提示。
