---
date: 2026-09-23
dependency: []
---

# LLM 流式超时兜底 PRD（feature ⑤）

## 背景

高速 LLM（约 200 t/s）流式生成中途停住：应用不卡死，但该模型输出不再增长、界面持续等待；换模型（新会话）或重启应用后恢复。探索定案（2026-09-23）：传输层四类超时（connect/response/read/idle）全缺失——RN XHR 未设 timeout，TCP 半开/对端断流时四个回调一个不来、Promise 永不 settle；retry 只对 throw 生效，挂死不抛错；挂死时 runner finally 不执行、abort registry 不反注册，同会话被「已有进行中的生成」门禁锁死。「换模型恢复」最可能是服务端/中转 per-key/per-model 并发槽被挂死连接占用（客户端无 per-model 状态，排除性实证），重启断 TCP 释放槽位。与已登记遗留 bug「run 无超时挂死」同源。desktop fetch 路径（reader.read() 无限等）同构。

## 目标

流式请求任何阶段失联都能在有限时间内收敛（报错或重试），不产生永久挂起；挂死后会话立即可再发（registry 不泄漏）；为 provider 停流 vs 客户端不消费提供观测手段。

## 核心需求

1. 首字超时（first-chunk timeout）：请求发出后 N1 秒无任何响应数据 → 失败收敛；
2. 流空闲超时（stream idle timeout）：距上一 chunk > N2 秒无数据 → 失败收敛；
3. 超时语义分级：首字前超时可自动重试（无输出无副作用）；流中断（已有输出）不自动重试、落「生成失败」assistant 占位（复用 run-fail 落消息机制）；
4. 超时触发即以超时错误收敛（不得冒充用户取消、不得被吞成 partial 正常完成），请求连接随之中断清理；registry 反注册、会话解锁、failed 事件走既有失败收尾链；
5. 双传输路径覆盖：RN XHR 与 desktop/cli fetch；
6. 观测：触发时打点区分 provider 停流与客户端不消费。

## 验收标准

- AC-1：人为制造挂死（飞行模式/断流）后 N2 内 run 收敛为失败提示，会话可立即再发；
- AC-2：正常长流（含慢速模型、thinking 长静默段在阈值内）零误杀；
- AC-3：core 全量 + 双端测试全绿；真机高速模型长流稳定（manual）。

## 已知限制（登记）

- watchdog 依赖 setTimeout：app 后台 timer 停摆期间 watchdog 同停（与 feature ③ 同根因）；③ 交付后后台数据到达恢复推进、挂死检测在回前台后生效。后台挂死检测不为本期目标。
- 仅覆盖流式请求（postSse 路径）：非流式请求（provider adapter 的 stream:false / chatNonStream）不走流式传输，不受 watchdog 覆盖；非流式挂死为既有行为，不在本期目标内。
