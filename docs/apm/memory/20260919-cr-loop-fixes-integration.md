---
date: 2026-09-19 03:20
title: 集成分支 CR loop 第 1 轮收敛 fix-spec-ready（4 P1 + 7 P2）；第五轮 10-tag migration 清理结论：无可退役项
keywords: code-review-loop, cr-fix-spec, fix-spec-ready, fixes-integration, migration cleanup, 退役线 v1.5.9, diverged, EMPTY_AGENT_META, ALREADY_EXISTS
abstract: 对 fix/2026-09-fixes-integration（两迭代 12 提交）跑 code-review-loop：4 个 review-scope 并行 → 11 条 must-fix（4 P1：diverged missing 探测漏同源判定、session 空目录零覆盖+过时注释、ALREADY_EXISTS 三处分叉、EMPTY_AGENT_META 误判已删可点）→ spec-fix 落盘 → review-full 判定 fix-spec-ready。附带第五轮 10-tag migration 核查：退役线 v1.5.9，四条在册首发 v1.5.12/v1.5.17 全在保护期，本轮无可退役；下窗 v1.5.22（retire-pref）/v1.5.27（smart-sort 三条）。
---

user:
（code-review-loop）评审集成分支全部改动；并检查 10 个 tag 前的 migration，它们可以清理了。

assistant:
按 code-review-loop 跑了两轮：Wave1 四个只读 scope 并行（回滚恢复 / 重命名修复 / 智能体解锁 / migration 清查），11 条 must-fix 全有改法，spec-fix 子代理落盘 docs/Iterations/fixes-integration-2026-09/cr-fix-spec.md，round2 review-full 逐条核对可执行性并补查 D/E/F/H–J/K（无新 must-fix，4 条 K 节执行提示），判定 fix-spec-ready。

【4 条 P1】①rsrr/B-1：findMissingRevisionPointers 缺 diverged 同源判定——删除后同路径重建（锚点版本高于新 entry 最大版本）误报 BACKFILL_REQUIRED 阻断回滚主路径，反向则漏检真缺失变 VFS_RESTORE_FAILED；其余三处（restore/reconcile）都有同源分支唯独 missing 探测漏了。②rg/G-1：desktop session 分支空目录 rename 用例零覆盖，且用例注释写着「core 仍 NOT_FOUND」的过时错误事实。③rg/C-1：ALREADY_EXISTS→「名称不能重复」core/desktop/mobile 三处各写一份，应收敛到 formatVfsErrorForUser。④au/B-1：mobile 聊天顶栏 agentMeta state 为非空类型、初始 EMPTY_AGENT_META（source:'none'）→ isAgentDeleted 恒 true——meta 加载窗口内即可点「已删重选」甚至静默改绑（回归验收 3）；修法：state 改 ChatAgentMeta|undefined，refresh 开始置 undefined、失败不得回退 'none' 占位。
7 条 P2：diverged backfill 寻址（应指 cpEntryId）、diverged 行为测试、%/_ 路径 rename 测试、workspace-actions 补 create/default 两态、ChatError 归一双端不对称（推荐方向 b：仅 AgentRunResolveError 归 none，ChatError 走报错态——待用户拍板）、desktop meta 失败静默+文案误导（K 节建议中文兜底）、chat-tab 两消费方零测试。

【migration 第五轮核查结论（重要）】本轮无可退役项：退役线 = 最新 v1.5.19 往下数 10 个 = v1.5.9；四条在册 migration 首发 tag 为 retire-pref v1.5.12、smart-field/rename-example/capture-kind 均 v1.5.17，全部新于退役线；add-mcp-file-path-snapshot-v1 未发布必留。用户「可以清理了」的预期与算术不符——下窗：v1.5.22 时 retire-pref 到窗（BASELINE 12→13、最低支持 v1.5.5→v1.5.13）；v1.5.27 时 smart-sort 三条同窗（→v1.5.18，前置 OQ：rebuild 探针、builtin 描述兜底）。现状核对无问题（注册表 5 条、登记阵尾、SCHEMA_BOOT_VERSION=14 不动）。

待用户拍板后开工执行：条目 9 方向 b；OQ-1（PRD 验收 3 措辞按现状收窄）；其余 OQ 可延后。fix-spec 已提交在集成分支。

user:
修复吧。

assistant:
用户确认开工（条目 9 方向 b、OQ-1 收窄一并生效）。code-dev-loop 三波：wave-0 三个 impl 并行（core 回滚 diverged / vfs 文案收敛+测试 / agent 解锁加载态），7 个提交（316beab2/f7bbb2e9/b848eb18/c1e2b5d2/2cd41242/58e7da12/6f89f4e8）；wave-1 verify（子代理超时改主代理亲跑——孤儿 jest-worker 进程致卡，pkill 后正常）：core 全量 2139/2139、desktop 全量 494/498（3 失败为 Secret Service 环境存量与基线一致）、mobile 定向 45/45、根 typecheck 过、core dist 重建；wave-2 cr-func（readonly）矩阵逐条对照 func-ready: yes，实现期亮点：mobile agentMeta 改 ChatAgentMeta|undefined 并删 EMPTY_AGENT_META（useToast mock 每渲染新函数的无限重渲染坑用 ref 方案规避——把 showToast 放进 effect 依赖会炸，注释已载）、impl-core 节点做了撤修复验红的锚定抽查。dev-ready。cr-func 登记三项可接受偏差（mobile 失败 toast 附 error 详情与 desktop 形态不完全对称、desktop 条目 10 用源码断言替代组件 mock——既有测试形态、CHANGELOG 评估未留痕）与发版前待办：v1.5.20 发版时 Unreleased 需补约 5 条用户可感知修复（回滚复现/空目录改名/幽灵目录/VFS 中文文案/智能体删除后重选）。K4（loadFilePointerTree 单查询）按 spec 豁免未执行。真机已重启加载新 dist 继续测试。