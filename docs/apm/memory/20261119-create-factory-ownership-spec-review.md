---
date: 2026-11-19 00:18
title: create-factory-ownership spec 三波核查工作流评审与 v2 重写
keywords: create-factory-ownership, spec 评审, 工作流并发, mention 口径, 假公开, 类型迁移, sksp 双 barrel
abstract: 用「主会话预核查 + 三波子代理（3 核查员并发 / 2 复核员并发 / 1 冷读评审）」评审了 error-channel-slim 的 create-factory-ownership spec，发现其调用量 40/24/11/11 全是 mention 口径（真实生产调用个位数）、85 当全量（实际 96）、类型迁移与 sksp 双 barrel 步骤缺失、core 无 jest；用户拍板「删 3 留 1 / Factory 短方法名 / bundle 收进 ChatServiceFactory」后整文件重写为 v2。
---

user:
开始干活了，看看 D:\worktree\error-channel-slim\docs\Iterations\create-factory-ownership\spec.md 这个，看看怎么优化吧。记得使用工作流，并发 3。

assistant:
加载 dynamic-workflows skill 后发现其专用工具（CreateWorkflow 等）在当前环境未挂载，改用 Agent 子代理按 DAG 波次跑，每波并发 ≤3。预检目标仓（HEAD b0c5f9645 即 spec 提交本身）后主会话先做了预核查，首次发现两大问题：spec 的「调用量实测 40/24/11/11」与 mention 数（含 import/注释/测试）吻合而真实生产调用是个位数；createVfsService 不在 public/vfs.ts 里。首次派 3 个子代理全被 provider 拒（子代理模型配置问题，用户修复后重派成功）。

user:
我的问题，我更换了子代理模型，现在应该可以了。

assistant:
重派 Wave 1 三个核查员（清单核对员 / 装配链核查员 / 下游影响核查员）并发核实：15 条发现，含 3 条 high——阶段 1 目标代码逐字段比对确认可编译且行为等价（spec 最核心部分可靠）；调用量 40/24/11/11 确为 mention 口径、createUsageStatsService 生产调用 0（38 处测试调用挤在 usage-stats.service.test.ts 一个文件）；vfs 组三个函数名写错（实际 createVfsBatchIoService 等带 Service 后缀）。Wave 2 两个复核员并发独立复核：5 条确认、1 条被推翻（session-fs 并不消费 MessageRollbackServiceOptions，注释原文「本地定义而非复用」）；确认 core 无 jest（node:test + mock.module + --experimental-test-module-mocks）、CreateVfsBatchIo/ZipIoOptions 文件私有、checkpoint-repo-wiring.ts 只能瘦身不整删（chat 域跨域消费 truncateTailInTransaction）、sksp 仅 linux/mac 经 sksp-node 消费且 node.ts 头注禁 node:crypto 进 RN 面。Wave 3 冷读评审员产出 24 条修订清单（15 must / 6 should）+ 2 个决策点，另抓到 75/86 自相矛盾、判据表缺裁决顺序、§四「一行不动」与 P1-3/P2-4 矛盾、check-style --all 只扫 core、apps/cli 门禁盲区等执行炸弹。

user:
（AskUserQuestion 拍板三问）

assistant:
用户全选推荐项：① 阶段 1 走「删 3 留 1」——删 createProjectService/createSessionService/createUsageStatsService（生产 0 引用、nm-code-style §4.1 假公开候选），createMessageService 保留改直构，44 处测试调用改写、public 撤 3 导出；② Factory 方法名用短名（VfsServiceFactory.create/createScoped/createBatchIo…，每组附现状名→方法名映射表）；③ createChatServices bundle 收进 ChatServiceFactory.createBundle。随后整文件重写 spec.md 为 v2（275→329 行）：数字层全按 96 窄口径重算（17 组、形态统计 27/12/58）、§二判据表加假公开行与裁决顺序、§三补类型迁移清单与各 Factory 映射表、§五补 cli 政策（已停止维护、不在验收、commit message 留档受影响符号）、§六验收改 11 条（check-style 三次显式路径跑法、dup-gate 借主仓脚本、§六.11 sksp RN 面检查）、§七风险表重写（MANY_EXPORTS 改前就红的前提不成立）、新增 §九核查证据。自查 grep 确认旧数字只以勘误形式残留、口径一致。
