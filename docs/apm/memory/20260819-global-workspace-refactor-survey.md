---
date: 2026-08-19 22:00
title: 全局工作区重构（真实全局文件管理器）现状调研
keywords: 全局工作区, vfs scope, pullTemplate, replaceVfsSubtree, S0, meta/skills, 文件浏览器
abstract: 重构前的现状摸底：三域 VFS scope 模型、全局↔项目唯一同步链（pullTemplate）、双端全局工作区 UI 入口与 meta/skills 漏出原因、拆除关联的影响面清单。该调研直接催生了 global-fs-manager 迭代。
---

user:
计划大型重构：把「全局工作区」从当前语义改成「真实全局文件管理器（从 / 直接渲染全部文件）」，并移除全局工作区与项目工作区之间的同步/关联。先做现状调研。

assistant:
readonly 探索 core 的 vfs/workplace 服务 + 双端工作区 UI 入口后，现状报告如下：
- **三域 scope**：`domain/vfs/logic/vfs-path-mapper.ts`，scope_key = global / project:{pid} / session:{pid}:{sid}，物理前缀分别是 /template、/projects/{pid}/template、/projects/{pid}/sessions/{sid}；逻辑根都映射到各自物理前缀。
- **全局↔项目唯一同步链**：`projects.pullTemplate` → `DefaultTemplatePullService.projectTemplatePull`（replaceVfsSubtree global→project，excludePrefixes=meta/skills，worktree.copyScope 同步纳入/目录规则）。项目创建不拉全局；会话创建/重置走 project→session（initializeSessionWorkspace）。
- **UI 入口**：mobile ProfileTab「全局工作区」→ GlobalTemplateScreen（VfsFileManager scope=global）；desktop 侧栏 projects 视图映射 global 工作区面板（ExplorerPane 三面板 global/session/chat，标题「全局工作区」）；CLI `nm vfs` 固定 global scope。
- **meta/skills 漏出原因**：全局技能存 global VFS `/meta/skills/`，工作区列表 buildListRows 不过滤 /meta，故在全局工作区里漏出来。
- **拆除影响面**：pullTemplate 全链（core 服务 + 双端 UI 按钮/IPC + CLI template pull）、全局工作区 banner 文案、全局技能存储位置（依赖 global VFS 域）、项目模板引导方式（新项目现靠手动 pull 引导）。

assistant:
后续（同日）：基于此调研立项 global-fs-manager 迭代——技能存储重定位到独立 meta 域（见 `20260819-global-fs-manager-impl.md`）、全局工作区改只读物理树文件浏览器、拆除 pullTemplate 关联，已 dev-ready。
