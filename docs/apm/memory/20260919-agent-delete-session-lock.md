---
date: 2026-09-19 01:05
title: 删除智能体会话锁死 bug：根因（删除不级联 + UI 有意锁卡成死锁）与 A+C 修复方案
keywords: agent, 智能体, 删除, 级联, 悬空, agentId, session, source none, 锁定, agentLocked, chat-session-detail-page
abstract: 用户报告删除智能体后会话中的智能体锁死无法切换。双探索子代理定位：agentRegistry.delete 不级联会话引用（agentId 悬空）→ meta 归一 source:'none' → 双端按 source!=='session' 锁卡只弹 toast，而重选恰是修复悬空的唯一途径，成死锁；发消息也会被 resolveAgentForProject 抛错拦住。拍板修复：删除时级联回退到工作区当前智能体 + none 态放开智能体卡为强制重选（模型卡保持锁）+ 切换服务端校验新 agentId 存在性。分支 fix/session-agent-locked-after-delete（自 main）。
---

user:
bug：删除智能体后，会话中的智能体直接锁定，无法切换。

assistant:
agile-dev 流程，敏捷名 session-agent-locked-after-delete，分支 fix/session-agent-locked-after-delete（从 main 拉，与未合并的 vfs 修复分支独立）。两个只读探索子代理（core 链路 / 双端 UI）结论一致：

【原因链】① agent-registry.service.ts delete()（142-170 行）只做存在性检查+禁删 general+删行+重置 workspace 指针，对引用该 agent 的 chat_session 不做任何处理——agent_config_json 是纯 JSON 文本列无外键，删后 agentId 悬空；② 会话 meta 加载时 resolveAgentForProject 用悬空 id 去 registry.get 抛 AgentRunResolveError（resolve-agent-for-project.ts:55-65），双端 meta handler 归一为 source:'none'（desktop prompt.ts:103-114 / mobile chat-agent-meta.ts:98-112）；③ 双端 UI 按 locked = source !== 'session' 锁卡（desktop SessionDetailDrawer.tsx:228 / mobile isAgentLocked chat-agent-meta.ts:138-143，三处消费），点击只弹「当前会话未绑定有效智能体」toast 不弹 picker——锁卡是 chat-session-detail-page 迭代拍板的行为（spec 风险表+双端源码断言测试钉死），但与删除不级联叠加成死锁：重选是修复悬空的唯一 UI 途径却被锁；④ 发消息同样走 resolveAgentForProject 被抛错拦住，会话完全不可用；⑤ 切换服务端通道（updateSessionAgentConfig / handleSessionsSetAgentBinding）不校验任何存在性——若 picker 能弹开，切换本可用；锁不在列表层。

【拍板修复方案】A 治本：删除时级联——引用被删 agent 的会话回退到工作区当前智能体（复用 resolveWorkspaceAgentForNewSession，state 优先→registry 首项；不选 general 因 picker 过滤 subagent mode）；repo 需新增按 agentId 扫会话改写 JSON 的方法（LIKE 预筛+逐条 parse）；级联放 core 编排（registry 层不反向依赖 sessions）。C 兜底：source='none' 时智能体卡改「强制重选」态（可点、弹 picker、文案「智能体已被删除，请重新选择」），模型卡保持锁定（isModelLocked 依赖 isAgentLocked 需拆分）；覆盖存量悬空与 cloud-sync 分批同步的暂时悬空。顺带：updateSessionAgentConfig 对非空新 agentId 补 registry 存在性校验（agentId:null 的 workspace 同步语义不变）；desktop 删除后调 notifyAgentConfigChanged 刷新。不推荐 B（读取侧静默回退 general，破坏不变式）。需同步改双端固化锁卡的测试（session-detail-drawer.test.ts:72-82、session-detail-screen.test.tsx:298-324）。

注意点：desktop none 分支的 PromptAgentMetaResponse 不带 agentId 字段，picker 高亮需要的话得补；delete() 先重置 workspace 指针再级联，fallback 才不会指向被删者；copy 会话继承 config、子会话也持有 config，扫描要全覆盖；遗留未查：cloud-sync agent/session 到达顺序、CLI 端切换入口。

user:
这是什么方案？删除后，允许重选就行，为什么感觉你这个方案这么麻烦？——那你说要「善后」什么？

assistant:
用户否掉级联方案，拍板最小修复：只放开重选。人家解释了「善后」的含义（删除时把引用会话悄悄改绑到默认智能体）及其否决理由——背着用户换智能体不诚实，还要处理 copy 会话/子会话/坏 JSON/空 registry 一堆边角。最终方案仅一条：双端 source==='none' 时智能体卡放开为待重选（可点、弹 picker、换绑即恢复），模型卡保持锁定，改掉双端固化锁死的测试断言；无 core 改动。首个实现子代理（带级联的大 prompt）被取消，未留半成品。

实现收口（子代理单轮）：desktop 85feda7d（SessionDetailDrawer 拆 agentLocked/agentDeleted，none 态弹 picker+重选 badge，加载中仍锁）+ mobile 98b70d83（chat-agent-meta 拆 isAgentLocked/isModelLocked/isAgentDeleted，三消费方同步）。验证：desktop 定向 12/12、mobile 24/24+关联 72/72、根 typecheck 全绿；desktop 全量 480/484 的 3 个失败是 Secret Service 环境既有问题（stash 基线取证）。主代理复核：亲跑双端定向测试通过、diffstat 9 文件与报告一致。留痕 docs/Iterations/agent-session-fixes-2026-09/（父 PRD 含「明确不做」记录）。
