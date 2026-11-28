---
date: 2026-11-28 15:25
title: skill 工具 domain 必填 + 移除 LLM 600 秒整调用上限
keywords: skill, domain, 必填, 600s, callTimeout, 整调用预算, xhr.timeout, wholeCallTimeoutMs, LlmSseModule, llm-native-fetch-shim
abstract: 用户要求 skill 工具的 domain 改必填、移除模型请求 600 秒整调用上限。两件都已落地在 feat/mcp-support：read/write/edit 的 domain 必填（list 可不填），填错域报「在该域不存在」并指向实际所在域；流式三处与非流式的整调用预算全部移除，原生层默认不设 callTimeout，挂死的连接由用户手动终止。
---

user:
1. skill工具，目前domain不是强制填写，不填写默认为当前项目，我希望改成必填
2. llm的最长时间为600s，即使没断流也会直接断掉，我希望移除这个限制。毕竟网络请求正常，干嘛要断掉呢？ 先不动手，你看看？

assistant:
看了两处。skill 工具里只有 edit 强制 domain，read 缺省读生效副本、write 缺省 project、list 缺省合并视图。600 秒是三处叠出来的：core 流式的 XHR/fetch/native、安卓原生网络客户端的默认值、非流式 shim。要全去掉才生效。代价是：之前已经移除了空闲超时，这是最后一道自动断开，去掉后真正挂死的连接只能手动停止。安卓原生层的改动需要重新安装 APK。

user:
任务1：read 必填且填错报「当前域不存在」，list 可不填（缺省展示全部，填了只列对应域）。
非流式也移除，因为实际用户会自己判断是网络问题还是没请求完，10分钟的限制起不到作用，反而会限制正常使用

assistant:
落地情况（分支 feat/mcp-support，未合并）：

- skill 工具（be2592421、b3b0d79c6）：read / write / edit 的 domain 必填，缺了被参数校验拦下；list 可不填，不填列全部。read 显式指定域却找不到时报「在该域不存在」，并提示技能实际在哪个域；两边都没有就提示另一域也没有。不会再悄悄回落去读另一边。load 没动。给模型看的工具定义变了，自带工具的对比基线重新生成，差异只有 skill 的两段描述。
- 移除 600 秒（5c60acc85）：core 流式不再设 XHR 超时、不开整调用定时器、不向原生层下发预算；安卓原生网络客户端默认不设整调用超时（传 0 或负数 = 不设）；非流式传给原生的预算改为 0。超时错误的 timeoutMs 参数改为可选。
- 兼容：旧安装包的原生层把 0 当作「用默认 600 秒」，所以新代码配旧安装包时限制仍是 600 秒，装上新 APK 才真正解除。
- 验证：core 3720、移动端 2432、桌面端 786 全过（桌面端这次顺带补跑了之前欠着的 CR-03 / CR-04 / T-D2）。debug APK 已重新编译、覆盖安装、重新出包。

user:
我做啥？你自己做就行

assistant:
那就我自己收口：停 Metro、编 APK、覆盖安装、重启 Metro、重拉应用，全程没让你动手。装包时荣耀设备这次没弹确认门，直接 Success 了。
