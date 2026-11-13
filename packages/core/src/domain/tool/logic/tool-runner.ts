/**
 * Tool runner: validate input/output and normalize errors.
 *
 * @module domain/tool/tool-runner
 */

import { toolFailed, toolInvalidArgument, toolNotFound, toolPathForbidden } from "@/errors/tool-errors.js";
import { classifyMutatingToolCall } from "./fs-command-classify.js";
import { checkToolPathPolicy } from "./tool-path-policy.js";
import type { ToolRegistry } from "./tool-registry.js";

/** A single tool invocation for parallel dispatch. */
export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

/** Outcome of one parallel tool invocation (errors are captured, not thrown). */
export type ParallelToolOutcome = { readonly ok: true; readonly output: unknown } | { readonly ok: false; readonly error: unknown };

const DEFAULT_PARALLEL_CONCURRENCY = 8;

/**
 * Executes tools from a registry with schema validation and consistent errors.
 *
 * @remarks
 * - NOT_FOUND, INVALID_ARGUMENT, FAILED are always surfaced as {@link ToolError}.
 * - Underlying failures are preserved via `cause` (see {@link ToolError}).
 */
export class ToolRunner<Ctx = unknown> {
  constructor(private readonly registry: ToolRegistry<Ctx>) {}

  /**
   * Calls a tool by name with input and context.
   *
   * @throws ToolError NOT_FOUND when tool missing
   * @throws ToolError INVALID_ARGUMENT when input invalid
   * @throws ToolError FAILED when tool throws or output violates schema
   */
  async call<Output = unknown>(name: string, input: unknown, ctx: Ctx): Promise<Output> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw toolNotFound(name);
    }

    const parsedIn = tool.inputSchema.safeParse(input);
    if (!parsedIn.success) {
      throw toolInvalidArgument(name, parsedIn.error.issues);
    }

    // A-14: path 白名单二次校验（schema 之后的第二道闸）。
    // ctx 上没有 allowedPaths 时 checkToolPathPolicy 直接返回 null，向后兼容。
    const disallowedPath = checkToolPathPolicy(parsedIn.data, ctx);
    if (disallowedPath !== null) {
      throw toolPathForbidden(name, disallowedPath);
    }

    try {
      const signal = (ctx as { readonly signal?: AbortSignal } | null | undefined)?.signal;
      // 取消语义第一道（B-1）：进入时 signal 已 abort 就在**启动工具副作用之前**
      // 直接拒绝。竞速（下方）只让调用方 reject，不会阻止已启动的 work——写类
      // 工具副作用照常落盘；runParallel 的 worker 在 abort 后仍会从队列取下一
      // 个 call，靠这一道保证 abort 后不再发起新的 tool.run。
      if (signal?.aborted) throw toolFailed(name, new Error("工具调用已取消"));
      // 回合取消竞速（所有工具共用的兜底）：用户点停止 / 回合中断时 signal
      // abort，这里立即 reject，**不依赖工具自身监听**——否则 waiting 中的
      // 回合会被慢工具（curl / search 等长请求）占住线程、停止按钮点不动。
      // 工具内部仍应把 ctx.signal 传给 fetch / 子进程，让底层资源尽早释放。
      const work = tool.run(parsedIn.data, ctx);
      let out: unknown;
      if (signal == null) {
        out = await work;
      } else {
        const racing = new Promise<unknown>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("工具调用已取消"));
            return;
          }
          const onAbort = () => reject(new Error("工具调用已取消"));
          signal.addEventListener("abort", onAbort, { once: true });
          work.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (error: unknown) => {
              signal.removeEventListener("abort", onAbort);
              reject(error);
            }
          );
        });
        out = await racing;
      }

      if (tool.outputSchema) {
        const parsedOut = tool.outputSchema.safeParse(out);
        if (!parsedOut.success) {
          throw toolFailed(name, parsedOut.error);
        }
        return parsedOut.data as Output;
      }

      return out as Output;
    } catch (e: unknown) {
      // ToolError 用形状判定：跨 duplicate module 实例（src / dist）instanceof 会漏。
      if (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ToolError" && typeof (e as { code?: unknown }).code === "string") throw e;
      throw toolFailed(name, e);
    }
  }

  /**
   * Runs multiple tool calls in parallel with bounded concurrency.
   *
   * @remarks Individual failures are captured in {@link ParallelToolOutcome}; order matches `calls`.
   */
  async runParallel(calls: readonly ToolCall[], ctx: Ctx, options?: { concurrency?: number }): Promise<ParallelToolOutcome[]> {
    if (calls.length === 0) {
      return [];
    }
    const concurrency = Math.min(options?.concurrency ?? DEFAULT_PARALLEL_CONCURRENCY, calls.length);
    const outcomes: ParallelToolOutcome[] = new Array(calls.length);
    // 同 path 的突变调用串行化：每个 path 维护一条 tail promise 链。
    const pathTail = new Map<string, Promise<void>>();
    let nextIndex = 0;
    // nm-style: keep-local — §2 一行写完的中转变量：内联进 Promise.all(Array.from(...)) 会重新拆出多行实参。
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= calls.length) return;
        const call = calls[index]!;
        const paths = classifyMutatingToolCall(call.name, call.input).paths;
        let release: (() => void) | undefined;
        if (paths != null && paths.length > 0) {
          const prevTails = paths.map((path) => pathTail.get(path) ?? Promise.resolve());
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const myTail = Promise.all(prevTails).then(() => gate);
          for (const path of paths) {
            pathTail.set(path, myTail);
          }
          await Promise.all(prevTails);
        }
        try {
          try {
            outcomes[index] = {
              ok: true,
              output: await this.call(call.name, call.input, ctx),
            };
          } catch (error: unknown) {
            outcomes[index] = { ok: false, error };
          }
        } finally {
          release?.();
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return outcomes;
  }
}
