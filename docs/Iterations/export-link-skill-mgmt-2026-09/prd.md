---
date: 2026-09-06
dependency: []
---

# 导出命名·文件链接跳转·技能管理优化 PRD（总纲）

## 背景

2026-09-06 头脑风暴提出四个优化点，经代码探索核实：

1. **skill 工具编辑能力**——经核实工具本体自初版即有 `edit` action（oldString/newString/replaceAll，与 vfs edit 同一 replace 内核），「只支持全量写入」为误判，**本轮不改**（用户拍板）。
2. **导出命名糟糕**——数据库备份用毫秒时间戳、技能 ZIP 名泄漏实现细节（`vfs-global-meta-meta-skills-{名}.zip`）、VFS 通用导出泄漏 scope 与 UUID，且 desktop 无技能导出入口。
3. **markdown 文件链接跳浏览器**——聊天正文里的文件路径链接点击后走系统浏览器，无法打开聊天工作区对应文件；desktop 更是点外链整窗导航离开。
4. **技能管理页无重命名/改描述**——双端均无入口，mobile 明示「创建后不可改」。

本迭代承载 ②③④ 三个 feature。

## 目标（含成功指标）

- 导出文件默认名全部语义化固定名（数据库备份/技能/工作区目录导出），用户不再需要手动改名。
- 聊天中文件地址链接一键直达工作区文件预览。
- 技能支持重命名与描述编辑，管理体验对齐 agent 管理。

## 用户与场景

双端（mobile/desktop）用户：导出备份与技能分享、阅读 agent 产出正文时点引用链接、整理技能库。

## 范围

### 包含范围

- features/export-naming：导出命名固定化（数据库备份、技能 ZIP、VFS 通用 ZIP、Agent YAML 验收锁定）+ desktop 技能导出入口
- features/chat-link-file-nav：聊天 markdown 文件链接跳转工作区文件
- features/skill-rename-description：技能重命名与描述编辑

### 不包含范围

- skill 工具本体任何改动（edit 能力已存在）。
- 云同步快照命名（`snapshots/rev-{N}.nmbackup` 为内部版本语义，改固定名会破坏多版本保留）。
- Agent YAML 导出命名变更——现状 `{agent名}.agent.yaml` 已达标，仅纳入验收锁定（用户点名确认，不做改名）。
- 角色卡导出、会话/聊天记录导出（现无此功能，不在本轮新增）。

## 核心需求（3-7 条）

见三个 feature PRD。

## 验收标准

见三个 feature PRD；总纲层面要求三 feature 各自验收全部通过且互不阻塞。

## 风险与待确认项

- 聊天文件链接识别规则已按真机样本定稿（Typora 式三形态，详见 feature PRD）。
- 全局工作区已移除（用户勘误、代码核实）：VFS 通用导出的 UI 调用方只剩项目/会话工作区；`vfsZipExportFileName` global 分支为死代码（去留 spec 定）。
- VFS 通用导出的单文件 `{文件名}.zip` 为默认口径（用户明确的是目录名/项目名规则），随 PRD 一并确认。
