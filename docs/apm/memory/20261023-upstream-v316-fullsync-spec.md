---
date: 2026-10-23 22:30
title: 上游 v3.16 全量纳入新迭代：spec-generate 启动（口述需求 + 三条既定政策）
keywords: upstream-sync, v3.16.2, fullsync, source-server, relay-v2, project-storage, ToolSearch, office-runtime, C1, C2, magic-context 端口
abstract: 用户拍板新迭代：上一轮 v3.16 同步的排除面全量纳入（五条产品线 source-server R3/relay v2/虚拟项目/ToolSearch/office-runtime + C1 模型与 Think 合并入口 + C2 组包管线统一与 MC 三端口重接 + 随行 B 项 + i18n 键级合并大头）。三条既定政策：①includeArchived 历史任务可删（P0 降级）；②UI 以 omz 为准（上游逻辑/后端照搬、UI 骨架保 omz）；③MC 三端口（transform/提示词段/工具描述）重接以 MC 测试套件为门禁。边界：与进行中的 upstream-v3.16-sync（U5-U12）不重叠，两轮成果最后可合并发版。需求来源=用户口述（本对话），锚定 docs/iterations/upstream-v3.16-sync/{summary,analysis-*}.md。探索分四区：C1+C2 融合面 / 远程家族（relay+source-server+B5 复活）/ 虚拟项目+ToolSearch+i18n 大头 / office-runtime+B7+品牌面。
---

user:
本次升级了什么？什么没升级？……我理解这些都是合理升级……上次没加入的内容这次都可以加入了，这是一个新迭代，可以进入spec阶段？

assistant:
v1.0.20 发布收尾（CHANGELOG 降序归一 1ff8cad9）→ 用户质疑 D 档排除理由 → 三点澄清（零基线=从零建子系统而非不可做 / includeArchived 是顺序问题 / C1C2 撞点解析）→ 用户三条拍板（历史任务可删 / UI 以 omz 为准 / MC 端口重接可接受）→ C1 确认不影响 MC 数据链路、C2 确认为适配层修改（风险在回归不在架构，MC 测试套件当门禁）→ 进入 spec-generate。
**探索完成（4 并行子代理全返回，Agent 通道恢复）**：①C1C2——composerOptions 可选 prop 旧点零破坏、contextUsage.tsx 上游只改 import、omz 内联装配与上游输出逐字段等价、MC 三端口挂点零改动实证、MC 全套测试清单+hydrator 测试空缺；②远程——R3 核心 +11.9k 可三期（一期 daemon 地基 3300/二期 Manager+registry 状态机[B5 吞并，omz connect 竞态实锤 registry:525-531]/三期 UX+5k）、relay 与 source-server 是不相干产品线且 relay 运行前提全在外部 Go relay 基础设施；③虚拟项目——存储 7 目录 +5.8k 零 source-server 依赖政策可落地、project-sidebar UI 71 文件 +10.7k、壳层 WorkspaceShellLayout 57 冲突块是融合主体、i18n 实测上游独有 1273（60% 死桶）/omz 独有 227/值冲突 159/品牌键 27；④office——面板宿主 MCP Apps 栈 omz 四模块全无=全量工作主体、omz 聊天预览已平价（7 文件 6 identical）、B7 checksum 源码级同源复验+不得整抄 migrations.ts、@arms/rum-electron 禁带。
**spec 落盘 docs/iterations/upstream-v316-fullsync/spec.md**（21 Step / 9 phase / 19 用例；四默认拍板：office 轻量/relay 缓行/ToolSearch 缓行/虚拟项目 UI=omz 骨架+组件 omz 化，均可翻转）。待用户确认 spec → spec-check-loop。
