# 全局工作区重构现状调研

## 2026-08-19 请求：全局工作区改为真实全局文件管理器的现状报告

- 用户计划大型重构：把「全局工作区」从当前语义改成「真实全局文件管理器（从 / 直接渲染全部文件）」，并移除全局工作区与项目工作区之间的同步/关联。
- 本次任务：readonly 探索 core 的 vfs/workplace 服务 + 双端工作区 UI 入口，产出现状报告（三域 VFS scope 模型、全局↔项目同步链路、双端全局工作区 UI、拆除关联的影响面）。
- 探索范围关键词：globalVfs/projectVfs/sessionVfs、pullFromParent、assembleWorkplaceDisplay、prefixPaths、S0 常驻前缀、TemplatePullButton、DirectoryRuleSheet、目录规则（纳入/跟随）。

## 结论摘要

- 三域 scope：`domain/vfs/logic/vfs-path-mapper.ts`，scope_key = global / project:{pid} / session:{pid}:{sid}，物理前缀 /template、/projects/{pid}/template、/projects/{pid}/sessions/{sid}；逻辑根都映射到各自物理前缀。
- 全局↔项目唯一同步链：`projects.pullTemplate` → `DefaultTemplatePullService.projectTemplatePull`（replaceVfsSubtree global→project，excludePrefixes=meta/skills，worktree.copyScope 同步纳入/目录规则）。项目创建不拉全局；会话创建/重置走 project→session（initializeSessionWorkspace）。
- UI 入口：mobile ProfileTab「全局工作区」→ GlobalTemplateScreen（VfsFileManager scope=global）；desktop 侧栏 projects 视图映射 global 工作区面板（ExplorerPane 三面板 global/session/chat，标题「全局工作区」）；CLI `nm vfs` 固定 global scope。
- meta/skills 可见原因：全局技能存 global VFS `/meta/skills/`，工作区列表 buildListRows 不过滤 /meta，故漏出。
- 拆除影响：pullTemplate 全链（core 服务 + 双端 UI 按钮/IPC + CLI template pull）、全局工作区 banner 文案、全局技能存储位置（依赖 global VFS 域）、项目模板引导方式（新项目现靠手动 pull 引导）。
