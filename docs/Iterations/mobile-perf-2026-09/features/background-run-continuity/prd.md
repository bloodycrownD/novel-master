---
date: 2026-09-23
dependency: []
---

# 后台任务执行连续性 PRD（feature ③）

## 背景

mobile 端 app 退后台后，正在执行的 agent run / 子智能体任务停摆，切回前台立即继续。用户已实证常驻保活通知开关开/关都卡（排除 ROM 冻结进程为主因）。探索定案（2026-09-23）：RN Android 的 JS timers（setTimeout/setInterval）由原生 Timing 模块挂 Choreographer 帧回调驱动，`onHostPause` 摘回调、后台无 vsync → 所有到期 timer 不执行；而 SSE 流投递整流的 `setInterval(32ms)` 是 XHR 路径**唯一**投递通道（onprogress 只进缓冲），TDBC 事务内 16ms 量子让步的 `setTimeout(0)` 同停——网络数据照常到达 JS，但永不投递消费，`await 请求` 挂死；回前台 vsync 恢复，积压一次倾泻立刻继续。FGS 只保进程不被杀，不恢复 vsync。子代理派遣（task → await runChildAgent 长流式）必卡。

## 目标

app 在后台（含前台服务常驻态）时，agent run / 子代理任务持续推进：LLM 流数据持续投递消费、消息持续落库；回前台无需等待。前台行为与性能零回归。

## 核心需求

1. SSE chunk 投递不再依赖 Choreographer 驱动的 timer（数据到达即驱动）；
2. TDBC 量子让步在后台不再因 timer 停摆挂死事务；
3. run 链上其余 timer 依赖（重试退避等）盘点并处置：可低成本同机制覆盖的覆盖，其余登记为已知限制；
4. 前台整流/让步行为等价（性能与节奏零回归）；
5. desktop / CLI 零影响。

## 验收标准

- AC-1：真机后台场景：发送后切后台，子代理任务持续执行（DB 消息/run 状态持续增长），回前台内容已就绪无需等待（logcat/DB 打点双证）；
- AC-2：前台流式渲染行为与现状等价（既有 SSE/流式测试全绿 + 真机肉眼无节奏变化）；
- AC-3：core 全量 + mobile 全量测试全绿，typecheck 零错。
