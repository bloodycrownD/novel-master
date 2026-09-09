---
date: 2026-09-08
agile_trace: true
---

# provider-body-params 实现规格（SPEC）

## 根因 / 方案摘要

tool_stream 由 openai.adapter buildBody 硬编码注入（条件：stream + tools + isGlmToolStreamModel 模型名正则），不看服务商——第三方网关模型名带 glm 即中招。方案：删除注入与判定文件；新增 provider 级 bodyParams 配置（body_params_json 列），经 LlmChatRequest.extraBody 在三协议请求体组装**最后一步**合并（用户显式配置覆盖一切标准字段）；UI 双端表单提供 JSON 编辑与显式清空。

## 变更点清单

| 层 | 文件 | 改动 |
|---|---|---|
| schema | bootstrap/provider/provider-schema.ts | llm_provider 加列 body_params_json TEXT NOT NULL DEFAULT '{}' |
| schema | bootstrap/schema-align/schema-column-alignments.ts | llm_provider/body_params_json 幂等 ADD COLUMN 条目（DEFAULT 无需回填） |
| schema | bootstrap/novel-master-bootstrap.ts | SCHEMA_BOOT_VERSION 11→12 |
| domain | domain/provider/model/provider.ts | LlmProvider.bodyParams: Readonly<Record<string, unknown>> |
| repo | repositories/impl/sqlite-provider.repository.ts | parseBodyParams（对象根、任意 JSON 值、根非法降级 {}）；SELECT/insert/update 贯穿 |
| service | service/provider/provider.port.ts + impl/provider.service.ts | Create/Edit 加可选 bodyParams；create ?? {}、edit ?? 保留原值（显式 {} 即清空） |
| adapter | infra/llm-protocol/ports/adapter.port.ts | LlmChatRequest.extraBody?: Readonly<Record<string, unknown>> |
| adapter | impl/openai.adapter.ts | 删 tool_stream 块；buildBody 与 chatTextOnly 尾部 Object.assign(body, req.extraBody) |
| adapter | impl/anthropic.adapter.ts / gemini.adapter.ts | 各自请求体构建尾部同样合并 |
| adapter | logic/glm-tool-stream.ts | 整文件删除（连同其测试） |
| service | impl/model-request.service.ts | chat 调用传 extraBody: provider.bodyParams（listModels 为 GET 无 body，不动） |
| desktop | shared/ipc-types.ts / handlers/providers.ts / SettingsViews.tsx | DTO 加 bodyParams；表单「自定义参数」textarea（Headers 旁，强校验，空文本→显式 {}） |
| mobile | components/provider/ProviderForm.tsx / ProviderDetailScreen.tsx | bodyParamsJson 值 + parseBodyParamsJson 强校验（中文错误）+ 控件 + 反填；edit 恒显式提交 |
| docs | CHANGELOG.md | 新增「自定义参数」条目 + 变更「移除 tool_stream 非标注入」（含智谱直连自救提示） |

连带适配：test/bootstrap/regex-table-drop.test.ts 的 `user_version === 11` 字面量断言改为引用 SCHEMA_BOOT_VERSION 导入（版本推进不再连带挂）。

## 详细改动说明

- **合并顺序**：extraBody 在 sampling Object.assign 与 thinking 应用**之后**执行，保证用户配置对 temperature/top_p/max_tokens/reasoning_effort（及 anthropic/gemini 对应字段）的最终覆盖权。
- **值语义**：headers 全链 string-only；bodyParams 放宽任意 JSON 值（tool_stream 是 boolean）。读侧仅对「根不是 JSON 对象」降级 {}，值不再静默丢弃。
- **清空语义**：edit patch 显式传 `bodyParams: {}` = 清空；不传 = 保留原值。双端 UI 空文本保存映射为显式 {}。headers 的既有行为（truthy 才提交、清不掉）维持不动。
- **跨协议透传**：同一份 JSON 合并进所选协议请求体顶层；mobile 控件 label 注明「原样合并进请求体顶层」。
- **seed/备份**：seed-builtin-providers 不动（显式列清单走 DEFAULT）；provider 三表备份 scrub 语义不变，自定义参数不跨设备同步。

## 测试策略

### 测试用例

- openai.adapter.test.ts：EX-1 合并进顶层 / EX-2 覆盖 temperature / EX-3 不传零多余字段；anthropic、gemini 合并用例各一
- sqlite-provider.repository.test.ts：round-trip（boolean/number/嵌套）+ 脏值降级 {}
- bootstrap：A13 迁移（v11 老库补列 DEFAULT '{}'）、新库建齐、regex-table-drop 断言改引用常量
- mobile provider-form.test.tsx：清空语义 + 非法输入中文报错 + 值类型放宽

全量验证：core 1815/1815、desktop 116/116、mobile 183 套 1095/1095、双端 typecheck exit 0（core dist 重建时先删 tsconfig.tsbuildinfo 防增量跳过）。

## 风险与回滚方案

- **智谱直连回退**：若未来智谱官方端点重新出现 tool 缓冲卡顿，用户在「自定义参数」配 `{"tool_stream": true}` 即可恢复，无需发版。
- **回滚**：revert 三个 feat(core) 提交即回到 tool_stream 硬编码时代；schema 列为纯新增 DEFAULT，回滚代码不炸（多列无害，ALIGN 幂等）。
- **风险**：用户可覆盖 model/messages 等关键键导致请求失败——属「显式配置覆盖一切」的既定语义，UI placeholder 已示例正确用法。
