---
date: 2026-09-08
dependency: []
---

# provider-body-params Feature PRD

## 背景与变更动机

用户在使用第三方 openai 协议网关时遭遇「未知请求字段: tool_stream」——应用此前对模型名匹配 GLM 正则（glm-4.6/4.7/5.x）的流式带工具请求**无差别硬编码注入** `tool_stream: true`（v1.4.21 为修智谱直连缓冲 bug 引入，判定只看模型名不看服务商），严格校验的网关直接拒绝。

同时验证（本迭代探索阶段）：流式 tool JSON 在协议层只攒完整才发 tool-use 事件（`tryEmitOpenAiToolUseIfComplete`）、UI 生成中指示由 `uiRunning || toolInvoking` 全程覆盖——**true/false 在当前界面观感无差**，tool_stream 的历史保护价值已消失。

## 范围说明（相对原需求）

两项联动变更，用户已拍板：

1. **移除 tool_stream 硬编码**：openai 协议请求体从此零非标字段；不做智谱 seed 预填（观感无差，且用户明确不需要）；智谱直连如需可经自定义参数自行配置回 `{"tool_stream": true}`。
2. **服务商配置高级字段新增「自定义参数」**：与现有 header JSON 并排，JSON 对象原样合并进请求体顶层——作为非标字段的通用显式出口（本次是 tool_stream，未来任何厂商特有字段都走这里，不再改代码）。

## 影响模块与接口

- core：llm_provider 表新增 body_params_json 列（SCHEMA_BOOT_VERSION 11→12）；provider 实体/仓储/服务贯穿 bodyParams；LlmChatRequest 新增 extraBody；openai/anthropic/gemini 三协议请求体组装最后一步合并；移除 tool_stream 注入与 glm-tool-stream.ts
- desktop / mobile：服务商表单高级区块新增「自定义参数」JSON 文本框（强校验、空文本保存显式清空）
- 不动：headers 既有行为、seed 内置服务商、备份/云同步（provider 三表 scrub 语义不变，自定义参数不跨设备）

## 验收标准

1. 第三方 openai 网关流式带工具请求不再携带 tool_stream，报错消失
2. 服务商配置「自定义参数」可保存任意 JSON 对象值（boolean/number/嵌套），chat 请求体顶层出现同名键
3. 自定义参数与标准字段（temperature/reasoning_effort 等）同名时，**用户配置覆盖标准值**
4. 三协议（openai/anthropic/gemini）行为一致
5. 空文本保存 = 显式清空（区别于「不传=保留原值」）；非法 JSON 保存时被 UI 拦截并提示
6. 存量 v11 库升级后自动补列，默认 '{}'；新库建齐
7. 智谱官方直连观感不退化（流式 tool 行为与移除前观感一致）

## 测试用例

- EX-1/2/3（openai）：extraBody 存在即合并进顶层 / 覆盖 temperature 冲突 / 不传时零多余字段
- anthropic/gemini 合并用例各一
- repository round-trip：boolean/number/嵌套对象值 + 脏值降级 {}
- schema 迁移 A13：v11 老库补列、DEFAULT '{}'
- mobile：清空语义（空文本→显式 {}）+ 非法输入中文报错
