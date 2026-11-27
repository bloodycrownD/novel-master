/**
 * MCP 工具适配（spec §六 / §D）：快照条目 → nm `ExternalTool`。description 同步取
 * 快照（装配期预算），inputJsonSchema 原样取 server 声明的 JSON Schema（模型侧参数
 * 定义与声明逐字段一致，本地不校验；未声明时给 `{type:"object", properties:{}}`），
 * run 委托连接管理器：
 * - 成功 → renderMcpToolResult 全文 → `Result.ok`；
 * - 连接 / 协议失败（`Result.err(McpFailure)`）→ `Result.err(TOOL_FAILED)`，
 *   detail 带原文前缀、cause 带 McpFailure；
 * - CallToolResult `isError: true` → 不抛异常，`Result.err(TOOL_FAILED)` + 原文；
 * - 取消（callTool 以 `Interrupt.cancelled` 返回，spec §五随通道迁移更新）→ `Result.err(TOOL_CANCELLED)`，
 *   不得包成 TOOL_FAILED；
 * - 结果超 50KB 照 curl / search 先例经 `OverflowSink.sink` 落盘（sink 会 throw，
 *   落盘失败回落字节截断，不让异常冒出 run）。
 *
 * 另有 `groupTool()`：智能体策略层的占位工具（spec §D）。MCP 是一个工具集合，
 * 在策略层面当作一个普通工具处理——智能体名单里只存 `mcp` 一个词，不存任何
 * 具体 MCP 工具名。占位在 `BuiltinTools.register` 时随自带工具进册（名单筛选、
 * 保存校验照旧按名字处理），装配期的唯一出口是被 `registerMcpTools` 注销并
 * 换成实际注册的 `mcp__` 工具，因此占位的 run 不可达，返回 `TOOL_FAILED` 兜底。
 * description 写死中文：core 运行时不持 locale，且该描述到不了模型（占位被
 * 注销）；两端工具目录的展示走 `ui.agent.tool_desc_mcp` i18n 键。
 *
 * 命名按内容主体（文件名带动词前缀 to-*，nm-style §9.7）：`McpToolAdapter`。
 *
 * @module domain/mcp/logic/to-nm-tool
 */

import { Encoding } from "@/common/encoding.js";
import { Guards } from "@/common/guards.js";
import { Json } from "@/common/json.js";
import { Text } from "@/common/text.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { Interrupt } from "@/errors/outcome.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { OverflowSink } from "@/domain/tool/builtin/overflow-sink.js";
import { TOOL_OUTPUT_MAX_BYTES } from "@/domain/tool/logic/tool-output-limits.js";
import type { ExternalTool } from "@/domain/tool/model/tool.js";
import type { McpFailure } from "../model/mcp-failure.js";
import type { McpToolSnapshot } from "../model/mcp-tool-snapshot.js";
import { McpToolResultRenderer } from "./render-mcp-tool-result.js";
import { McpToolSlug } from "./slugify-mcp-tool-name.js";

/** 工具结果整理成多行时的行宽（字符）。 */
const TOOL_RESULT_LINE_WIDTH = 300;

/** `toNmTool` 依赖：serverId 已绑定的调用通道（serverId 由装配点闭包进 call）。 */
export interface McpToolCallDeps {
    /** MCP 侧原始工具名 + 入参 + 取消信号；取消以 Interrupt.cancelled 返回，已知失败沿 Result.err。 */
    readonly call: (toolName: string, args: unknown, signal: AbortSignal) => Promise<Result<unknown, McpFailure> | Interrupt>;
}

/** ctx 未注入 signal 时（旧测试 mock）给 callTool 的永不中止信号。 */
const NEVER_ABORTED_SIGNAL: AbortSignal = new AbortController().signal;

/** server 未声明参数定义时给模型的兜底（部分厂商拒绝没有 properties 的对象定义）。 */
const NO_INPUT_JSON_SCHEMA: Readonly<Record<string, unknown>> = {type: "object", properties: {}};

/** 失败 detail 的原文前缀（与 description 同一命名约定）。 */
const detailPrefix = (serverId: string): string => `[MCP:${serverId}]`;

export const McpToolAdapter = {
    /** 快照条目 → nm 工具（name / description / inputJsonSchema 同步可得；run 委托 call）。 */
    // nm-style: keep-public — spec §六的工具适配契约：装配期注册与 7 处用例都按名字调用，适配体是完整的闭包工厂不是转手
    toNmTool: (snapshot: McpToolSnapshot, deps: McpToolCallDeps): ExternalTool<BuiltinToolContext> => {
        const name = McpToolSlug.toolName(snapshot.serverId, snapshot.toolName);
        const description = `${detailPrefix(snapshot.serverId)} ${snapshot.toolDescription ?? snapshot.toolName}`;
        const prefix = detailPrefix(snapshot.serverId);
        return {
            name,
            description: () => description,
            inputJsonSchema: snapshot.inputSchema ?? NO_INPUT_JSON_SCHEMA,
            async run(input: unknown, ctx: BuiltinToolContext): Promise<Result<string, AppError>> {
                const called = await deps.call(snapshot.toolName, input, ctx.signal ?? NEVER_ABORTED_SIGNAL);
                // 取消是控制流不是失败：callTool 以 Interrupt 表达（spec §五随通道迁移更新）；
                // MCP 无 replaced 生产者，与 cancelled 同收 TOOL_CANCELLED（穷尽处理）。
                if ("kind" in called) return Result.err(new AppError("TOOL_CANCELLED", {toolName: name}));
                if (!called.ok) return Result.err(new AppError("TOOL_FAILED", {toolName: name, cause: called.error, detail: `${prefix} ${called.error.detail}`}));
                const payload = Guards.isRecord(called.value) ? called.value : {};
                const rendered = McpToolResultRenderer.render(Array.isArray(payload.content) ? payload.content : []);
                // 结果是 JSON 就整理成多行再交给模型（与 curl / search 的落盘同一口径），其余文本原样。
                const text = Json.prettyJson(rendered, TOOL_RESULT_LINE_WIDTH) ?? rendered;
                // isError: true 不抛异常：模型收到「失败 + 原文」，原文全量保留在 detail。
                if (payload.isError === true) return Result.err(new AppError("TOOL_FAILED", {toolName: name, detail: `${prefix} ${text}`}));
                const bytes = Encoding.utf8ByteLength(text);
                if (bytes > TOOL_OUTPUT_MAX_BYTES) {
                    try {
                        // 全文落盘（read 可分页读回）；落盘失败照 curl 先例降级字节截断，不冒异常。
                        const sink = await OverflowSink.sink(ctx, {tool: name, content: text, contentType: "text/plain"});
                        return Result.ok(`${sink.message}\n保存路径：${sink.savedPath}`);
                    } catch {
                        return Result.ok(`${Text.sliceUtf8Bytes(text, TOOL_OUTPUT_MAX_BYTES)}\n\nOutput truncated (original ${bytes} bytes).`);
                    }
                }
                return Result.ok(text);
            },
        };
    },
    /**
     * 智能体策略层的占位工具（spec §D）：名为 `mcp` 的 `ExternalTool`，与其他
     * 无参数工具同一参数定义形状。`BuiltinTools.register` 注册它，让名单筛选
     * 与保存校验把 `mcp` 当已知名；装配期由 `registerMcpTools` 无条件注销。
     */
    // nm-style: keep-public — spec §D 点名 McpToolAdapter.groupTool()（register-builtin-tools 按名消费）；run 不可达的兜底实现就是占位的完整语义。
    groupTool: (): ExternalTool<BuiltinToolContext> => ({
        name: "mcp",
        description: () => "MCP 服务器提供的工具",
        inputJsonSchema: NO_INPUT_JSON_SCHEMA,
        // run 不可达：占位的唯一出口是装配期的注销与替换，到不了模型；兜底走
        // TOOL_FAILED（照 toNmTool 的失败通道），不走异常。
        async run(): Promise<Result<unknown, AppError>> {
            return Result.err(new AppError("TOOL_FAILED", {toolName: "mcp", detail: "占位工具不可调用：装配期应已被替换或注销"}));
        },
    }),
} as const;
