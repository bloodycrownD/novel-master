---
date: 2026-09-08 21:30
title: provider-body-params 敏捷实现（tool_stream 移除 + 服务商自定义参数双端落地）
keywords: provider-body-params, 自定义参数, body_params_json, extraBody, tool_stream, SCHEMA_BOOT_VERSION 12, GLM, openai 网关
abstract: 用户报第三方 openai 协议网关拒收非标字段（未知请求字段: tool_stream），拍板移除 tool_stream 硬注入并为服务商新增「自定义参数」bodyParams（任意 JSON、原样合并进请求体顶层、可覆盖标准字段、空文本保存显式清空）。inline 模式单次完成 core schema v12/domain/service/三协议 adapter/双端表单/CHANGELOG，6 笔提交，core 1815 / desktop 116 / mobile 1095 全绿。
---

user:
inline 模式敏捷任务（全程中文）：worktree .worktree/provider-body-params，分支 feat/provider-body-params（基于集成分支 c825d7ce）。用户报「未知请求字段: tool_stream」——第三方 openai 协议网关严格校验拒绝非标字段。已拍板：1) 移除 openai.adapter 的 tool_stream 硬编码与 glm-tool-stream.ts（不做 seed 预填）2) llm_provider 新增 body_params_json TEXT NOT NULL DEFAULT '{}'（值任意 JSON，非 headers 的 string-only）3) 请求体组装最后一步合并 extraBody，用户显式配置覆盖一切（三协议统一）4) UI 空文本保存传显式 {} 清空（headers 行为不动）5) SCHEMA_BOOT_VERSION 11→12、ALIGN 加条目、重建 dist 前先删 tsbuildinfo。要求按逻辑块提交、core 全量测试必过、双端测试与 typecheck 过。

assistant:
全部完成，6 笔提交零阻塞。提交链：0be146dc（schema v12+ALIGN+A13 迁移用例+regex-table-drop 版本断言适配）、85cf6640（bodyParams 贯穿实体/仓储/服务/port、model-request.chat 透传 extraBody）、57eb0f93（删 tool_stream 硬注入与 glm-tool-stream.ts、三协议 extraBody 合并、EX-1/2/3+EX-ANT/EX-GEM 用例）、4f646a6d（desktop ipc-types+表单）、79ffac70（mobile 表单+清空语义用例）、57f6d54d（CHANGELOG 两条）。验证：core 1815 pass（NODE_ENV=development npm test -w @novel-master/core，先 rm tsconfig.tsbuildinfo 重建 dist）、desktop 116 pass + typecheck 过、mobile 1095 pass + typecheck 过。关键实现细节：extraBody 合并放 applyThinkingToBody 之后（确保 reasoning_effort 也可被覆盖）；gemini 的 generationConfig 整体可被 extraBody 覆盖；regex-table-drop.test.ts 原硬断言 user_version===11 挂了 3 例，改为引用 SCHEMA_BOOT_VERSION 导入（后续 bump 不再连带挂）；mobile edit patch 恒显式提交 bodyParams（空文本→{}），headers 空文本仍不写入（行为锁定用例）；desktop SettingsField 不支持 desc，说明并入 label；seed INSERT 显式列清单走 DEFAULT 不动；provider-model.service 的 listModels 是 GET 无 body 不合并。
