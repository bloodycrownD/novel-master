/**
 * Tool registry: store and resolve tools by unique name.
 *
 * @module domain/tool/tool-registry
 */

import { assert } from "@/common/assert.js";
import type { Tool } from "../model/tool.js";

/**
 * In-memory registry for tools.
 *
 * @remarks
 * Names are unique. Duplicate registrations are rejected (safer than last-wins).
 */
export class ToolRegistry<Ctx = unknown> {
    private readonly tools = new Map<string, Tool<any, any, Ctx>>();

    /**
   * Registers a tool.
   *
   * @remarks
   * 重名注册是装配期 API 误用（名字唯一是注册表不变量，调用方无法据其做运行时决策），
   * 按错误通道矩阵第 4 条走 assert 编程护栏，不进业务错误通道。
   */
    register(tool: Tool<any, any, Ctx>): void {
        assert(!this.tools.has(tool.name), `Tool already registered: ${tool.name}`);
        this.tools.set(tool.name, tool);
    }

    /** Removes a tool by name. Returns true if removed. */
    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    /** Returns a tool by name or `undefined`. */
    get(name: string): Tool<any, any, Ctx> | undefined {
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
