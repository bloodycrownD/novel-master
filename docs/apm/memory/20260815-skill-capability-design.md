---
date: 2026-08-15 05:30
title: skill 能力设计探索——global+project 两域存储与 UI 挂点结论
keywords: skill, SKILL.md, VFS scope, 提示词注入, 设置管理页, brain-storm
abstract: 用户想给应用加 skill 能力（类 AI IDE 的 SKILL.md），纠结 mobile/desktop 交互与会话隔离的冲突。四路探索确认：skill 存 VFS global+project 两域直读可完全绕开 session 复制链；注入走「常驻索引块 + 仿 task 工具按需拉正文」；编辑侧 global 域两端已有现成 UI，设置管理照 agent 管理骨架做。方案待用户拍板触发方式等细节。
---

user:
我想给应用加 skill 能力，skill 本身不复杂（像常见 AI IDE 那样当普通文件处理），但我们的工作区是会话隔离的，有点麻烦。skill 不需要这么强隔离，感觉全局 + 项目两个域就够了。而且除了文件编辑器，还想在设置里做可视化管理，mobile/desktop 的交互我还没有好思路。

assistant:
按 brain-storm 派了四路探索（VFS scope 机制、提示词拼装、文件编辑器 UI、设置页架构），关键结论：

1. 会话隔离不碍事：session 工作区是 project 树的一次性拷贝（initializeSessionWorkspace 的 replaceVfsSubtree），但 skill 读取可以在拼装时直接按 scopeKey 查 global / project:{pid} 两个域，完全绕开复制链。ScopedVfsService 本来就支持按 scope 建视图。而且 session 内 agent 工具读不到 global/project，反而契合「skill 由系统注入而非模型自己翻」的设计。
2. 不要复用 rule_snapshot/file_cache：那是会话生命周期缓存，语义是展示档位；skill 需要的是 front matter 元数据。要缓存就新开 kkv 域（域类型是开放字符串）。
3. 注入方案：skill 索引（name+description+来源域）做常驻小块，正文按需拉取——task 工具的 callableAgents「description lambda + 模型自选」模式是现成先例，照抄即可。注入点选 buildPromptLlmInputFromLayout（唯一拼装入口，三端预览免费生效），注意同步改 computeLlmExportZonesFromLayout。
4. 存储约定：VFS 下 /skills/{name}/SKILL.md，global + project 两域，同名 project 覆盖 global。启用/禁用如需要可参照 workplace 规则表的 scope_key + logical_path 模式建小表。
5. UI 现状比预想好：global 域两端已有完整浏览+编辑入口（mobile Profile→全局工作区 GlobalTemplateScreen；desktop Explorer 的 global 树）。「skill 当普通文件」基本零成本。缺口是 desktop 进项目/会话视图后 global 树不可见。
6. 设置管理：两端都有「列表→详情」现成范式（agent 管理），照抄骨架；mobile 编辑页可直接参数化复用 FileEditorScreen（scopeKind 路由参数现成），desktop 加 SettingsViewId 页内栈 push。两个视图是同一份 VFS 文件的两个窗口，无同步问题。

待拍板：触发方式（索引+skill 工具 vs 全文常驻）、同名覆盖语义、启用开关存哪、desktop 项目内 global 树可见性缺口要不要顺手补。
