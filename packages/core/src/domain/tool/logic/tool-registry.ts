/**
 * Tool registry: store and resolve tools by unique name.
 *
 * @module domain/tool/tool-registry
 */

import { assert } from "@/common/assert.js";
import type { RegisteredTool } from "../model/tool.js";

/**
 * In-memory registry for tools.
 *
 * @remarks
 * Names are unique. Duplicate registrations are rejected (safer than last-wins).
 * 存储形态是 {@link RegisteredTool}：自带工具与外部工具（MCP）同住一张表，
 * 两者的判别与校验差异由消费方（ToolRunner / ToolDefinitions）处理。
 */
export class ToolRegistry<Ctx = unknown> {
    private readonly tools = new Map<string, RegisteredTool<Ctx>>();

    /**
   * Registers a tool.
   *
   * @remarks
   * 重名注册是装配期 API 误用（名字唯一是注册表不变量，调用方无法据其做运行时决策），
   * 按错误通道矩阵第 4 条走 assert 编程护栏，不进业务错误通道。
   */
    register(tool: RegisteredTool<Ctx>): void {
        assert(!this.tools.has(tool.name), `Tool already registered: ${tool.name}`);
        this.tools.set(tool.name, tool);
    }

    /** Removes a tool by name. Returns true if removed. */
    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    /** Returns a tool by name or `undefined`. */
    get(name: string): RegisteredTool<Ctx> | undefined {
        return this.tools.get(name);
    }

    /** Returns all registered tool names (in insertion order). */
    list(): string[] {
        return [...this.tools.keys()];
    }

    /**
   * Clears the registry (for tests only).
   * @internal
   */
    clear(): void {
        this.tools.clear();
    }
}
