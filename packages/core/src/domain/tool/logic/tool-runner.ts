/**
 * Tool runner: validate input/output and normalize errors.
 *
 * @module domain/tool/tool-runner
 */

import { AbortError } from "@/domain/abort/logic/create-abort-error.js";
import { AbortScopeFactory } from "@/domain/abort/logic/create-abort-scope.js";
import { AppError, AppErrorOps } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { AbortReason } from "@/errors/outcome.js";
import { FsCommand } from "./fs-command.js";
import { ToolPathPolicy } from "./tool-path-policy.js";
import type { ToolRegistry } from "./tool-registry.js";

/** A single tool invocation for parallel dispatch. */
export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

/** Outcome of one parallel tool invocation (errors are captured, not thrown). */
// 取消是控制流信号不是失败：`TOOL_CANCELLED` 命中时落 `{ ok: false, error, kind: "cancelled", reason }`。
// 保留 ok/error 让展示层（ToolResultBlock.build / ToolOutput.formatErrorForLlm）沿用既有 `AppErrorOps.is` 取消分类；
// `kind`/`reason` 供上层按 `Outcome.cancelled` 识别控制流（七期：取消改返回值传播）。
export type ParallelToolOutcome =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: unknown }
  | { readonly ok: false; readonly error: AppError; readonly kind: "cancelled"; readonly reason: AbortReason };

const DEFAULT_PARALLEL_CONCURRENCY = 8;

/** runner 直通的业务错误 key（原 ToolError 5 码 + 取消控制流码）；TOOL_SEARCH_* 等域内细分码仍包装为 TOOL_FAILED。 */
const TOOL_PASSTHROUGH_KEYS = new Set(["TOOL_NOT_FOUND", "TOOL_CONFLICT", "TOOL_INVALID_ARGUMENT", "TOOL_FAILED", "TOOL_FORBIDDEN", "TOOL_CANCELLED"]);

/**
 * 工具失败归一化：TOOL_* 族直通，其余包成 TOOL_FAILED（cause 带原错误）。
 * 工具闭包的 Err 返回值与未知异常共用这一条出口，模型可见错误不变。
 */
function normalizeToolFailure(name: string, e: unknown): AppError {
  // 工具内部抛的 ToolError 族 AppError（5 码，key 在 name 上、code 是数字）直通；
  // 用形状判定：跨 duplicate module 实例（src / dist）instanceof 会漏。
  if (typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string" && TOOL_PASSTHROUGH_KEYS.has((e as { name: string }).name) && typeof (e as { code?: unknown }).code === "number") return e as AppError;
  return new AppError("TOOL_FAILED", {toolName: name, cause: e, detail: `Tool failed: ${name}`});
}

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
   * @remarks
   * - 已知失败（NOT_FOUND / INVALID_ARGUMENT / FORBIDDEN / FAILED）走 `Result.err`，
   *   与工具闭包 Err 共用 {@link normalizeToolFailure} 归一化出口（TOOL_* 直通、
   *   其余包 TOOL_FAILED），模型可见错误不变（五期门⑦：返回值通道）。
   * - 取消：进入时 signal 已 abort 直接 `Result.err(TOOL_CANCELLED)`（七期，返回值
   *   通道）；在途竞速以 `AbortError.create()` reject（平台协议例外，`isAbortLikeError`
   *   统一识别），由 {@link runParallel} 的 catch 收编。`TOOL_CANCELLED` 码保留作
   *   展示标签（UI 不弹错误文案）。
   */
  async call<Output = unknown>(name: string, input: unknown, ctx: Ctx): Promise<Result<Output, AppError>> {
    const tool = this.registry.get(name);
    if (!tool) {
      return Result.err(new AppError("TOOL_NOT_FOUND", {toolName: name, detail: `Tool not registered: ${name}`}));
    }

    const parsedIn = tool.inputSchema.safeParse(input);
    if (!parsedIn.success) {
      return Result.err(new AppError("TOOL_INVALID_ARGUMENT", {toolName: name, issues: parsedIn.error.issues, detail: `Invalid input for tool: ${name}`}));
    }

    // A-14: path 白名单二次校验（schema 之后的第二道闸）。
    // ctx 上没有 allowedPaths 时 ToolPathPolicy.check 直接返回 null，向后兼容。
    const disallowedPath = ToolPathPolicy.check(parsedIn.data, ctx);
    if (disallowedPath !== null) {
      return Result.err(new AppError("TOOL_FORBIDDEN", {toolName: name, path: disallowedPath, detail: `Tool path outside allowed scope: ${name} -> ${disallowedPath}`}));
    }

    try {
      const signal = (ctx as { readonly signal?: AbortSignal } | null | undefined)?.signal;
      // 取消语义第一道（B-1）：进入时 signal 已 abort 就在**启动工具副作用之前**
      // 沿 Result.err 返回 TOOL_CANCELLED（七期：不再 throw）。竞速（下方）只让
      // 调用方 reject，不会阻止已启动的 work——写类工具副作用照常落盘；runParallel
      // 的 worker 在 abort 后仍会从队列取下一个 call，靠这一道保证 abort 后不再
      // 发起新的 tool.run。
      if (signal?.aborted) return Result.err(new AppError("TOOL_CANCELLED", {toolName: name}));
      // 回合取消竞速（所有工具共用的兜底）：用户点停止 / 回合中断时 signal
      // abort，这里立即 reject，**不依赖工具自身监听**——否则 waiting 中的
      // 回合会被慢工具（curl / search 等长请求）占住线程、停止按钮点不动。
      // 工具内部仍应把 ctx.signal 传给 fetch / 子进程，让底层资源尽早释放。
      // 竞速交给 signalView（只读视图，不把 scope 传染进工具 API）；取消载荷用
      // AbortError.create()——race 的 reject 是平台协议例外（Promise 没有 Result 通道）。
      const work = tool.run(parsedIn.data, ctx);
      const out: Result<unknown, AppError> = signal == null ? await work : await AbortScopeFactory.signalView(signal).race(work, () => AbortError.create());

      // 工具闭包不再解包 throw（门⑦）：Err 交回 runner，与未知异常走同一条
      // 归一化出口（TOOL_* 直通、其余包 TOOL_FAILED），已知失败沿 Result.err
      // 接力（五期门⑦）；工具返回的 TOOL_CANCELLED 同样沿 Result.err 回来
      // （七期），在途竞速的取消是 AbortError，由下方 catch 原样放行。
      if (!out.ok) return Result.err(normalizeToolFailure(name, out.error));

      if (tool.outputSchema) {
        const parsedOut = tool.outputSchema.safeParse(out.value);
        if (!parsedOut.success) {
          return Result.err(new AppError("TOOL_FAILED", {toolName: name, cause: parsedOut.error, detail: `Tool failed: ${name}`}));
        }
        return Result.ok(parsedOut.data as Output);
      }

      return Result.ok(out.value as Output);
    } catch (e: unknown) {
      // 在途竞速的取消是 AbortError（平台协议例外）：原样上抛给 runParallel 收编，
      // 不能归一化成 TOOL_FAILED——否则 isAbortLikeError 认不出取消。形状判定只认
      // `name`（跨 duplicate module / Hermes 无 DOMException，instanceof 会失灵）。
      if (typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError") throw e;
      throw normalizeToolFailure(name, e);
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
    // 取消裁定（七期 §6.2）：`TOOL_CANCELLED` 命中即收成取消 outcome，沿返回值向上，
    // 不再往下抛。ctx 上仍是裸 signal（工具 API 不传染 scope），故 reason 按用户停止
    // 兜底；八期起在途竞速以 AbortError reject，走下方 catch 的失败 outcome 形态。
    const failedOutcome = (error: unknown): ParallelToolOutcome =>
      AppErrorOps.is(error, "TOOL_CANCELLED") ? { ok: false, error, kind: "cancelled", reason: "user-stop" } : { ok: false, error };
    // nm-style: keep-local — §2 一行写完的中转变量：内联进 Promise.all(Array.from(...)) 会重新拆出多行实参。
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= calls.length) return;
        const call = calls[index]!;
        const paths = FsCommand.classifyMutatingToolCall(call.name, call.input).paths;
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
            const result = await this.call(call.name, call.input, ctx);
            // 已知失败与取消都沿 Result.err 接力：TOOL_CANCELLED 收成取消 outcome
            // （保留 error 供展示层沿用 AppErrorOps.is 分类），其余原样落失败。
            outcomes[index] = result.ok ? { ok: true, output: result.value } : failedOutcome(result.error);
          } catch (error: unknown) {
            // 在途竞速的 reject（八期载荷 AbortError.create，平台协议例外）与未知异常
            // 同口收编，不再向上抛；AbortError 载荷原样保留，供上层用 isAbortLikeError
            // 识别取消（取消 outcome 形态只留给 TOOL_CANCELLED 返回值通道）。
            outcomes[index] = failedOutcome(error);
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
