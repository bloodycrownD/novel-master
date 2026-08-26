# fetch 工具 SPEC 审查第 1 轮修复（No-Go → 闭合）

日期：2026-08-26。审查对 `docs/Iterations/fetch-tool/spec.md` 第 1 轮 No-Go（1 P0 + 1 P1 + 5 P2），本轮全部闭合，只改 SPEC 不改实现代码。

## 修复内容

- **P0-1 inputSchema 顶层改 `z.object`**：原 `z.string().min(1)` 与工具线上格式冲突（`ToolUseBlock.input` 是 `Record<string, unknown>`，见 `packages/core/src/domain/chat/model/content-block.ts` L34；openai/gemini 适配层把 arguments JSON.parse 成对象下发）。改为 `z.object({ url: z.string().min(1).describe(...).superRefine(协议白名单) })`，run 读 `input.url`；T-FT1/T-FT13 入参改对象形式 `runner.call("fetch", { url: ... }, ctx)`；path policy 结论（url 不在 PATH_FIELDS）保留。
- **P1-1 五处计数锁补进变更点清单（#10）**：`packages/core/test/tool/agent-tool.test.ts` L124、`skill-tool.test.ts` L130、`tool-schema-descriptions.test.ts` L26、`vfs-tools.test.ts` L45（`registry.list().length === 9`）与 `packages/core/test/config-forms/agent-tool-catalog.test.ts` L15（`BUILTIN_TOOL_CATALOG.length === 9`），同步 9→10，catalog 测试顺带加 fetch 条目断言。
- **P2-1 截断论证纠正**：删掉「字符数截断保证字节预算内」的反向论证（字节≥字符，51200 字符含中文可达 ~150KB），改为按字节预算截断——TextEncoder 增量累计找预算内最大字符切点。
- **P2-2 originalBytes 双来源**：content-length 预检路径不读 body，originalBytes 回填 content-length 头数值；字段注释/JSDoc 注明两个来源（正常路径 utf8ByteLength 全量计算 / 预检路径回填头值）。T-FT9 补对应断言。
- **P2-3 T-FT4 超时可测**：注明用 node:test mock.timers 推进时钟（先例 `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` L59）；实现注明请求完成后 clearTimeout。
- **P2-4 T-FT11 改可行**：`summarizeToolSuccess` 未导出（`build-tool-result-block.ts` 内部函数），改经导出的 `buildToolResultBlock(toolUseId, outcome, { toolName: "fetch" })` 断言 summary 字段；字节格式化规则定为 1024 进位（B/KB/MB）、保留 1 位小数。
- **P2-5 路径修正 3 处**：`test/infra/llm-transport/llm-sse-transport.test.ts` → `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`（§2、测试策略、变更点 #8）。

## 关键事实（后续迭代可复用）

- 工具调用入参线上格式是对象，inputSchema 顶层必须 `z.object`，现有 9 个内置工具全是先例。
- 挂起的内部函数不能直接单测，要走其导出的包装（如 buildToolResultBlock）断言。
- node:test 的 mock.timers 是本项目推进时钟测超时的既定手法。
