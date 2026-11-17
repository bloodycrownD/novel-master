/**
 * `AbortScope` / `AbortSignalView` 三形态工厂。
 *
 * 硬约束（RN / Hermes）：
 * - 不读 `signal.reason`（`abort-controller@3.0.0` 作传递依赖会丢 reason），
 *   reason 只存在 scope 自己身上；
 * - 不用 `AbortSignal.timeout` / `AbortSignal.any` / `scheduler.yield`，
 *   timeout 与父级联都自己实现。
 *
 * @module domain/abort/logic/create-abort-scope
 */

import type { AbortReason, AbortScope, AbortSignalView, Interrupt } from "@/domain/abort/model/abort-scope.js";
import { createAbortError } from "./create-abort-error.js";

/** `createAbortScope` 入参；`controller` 优先于裸 `signal`（两者都给时都监听）。 */
export interface CreateAbortScopeOptions {
  readonly signal?: AbortSignal;
  readonly controller?: AbortController;
  readonly parent?: AbortSignalView;
  readonly timeoutMs?: number;
}

/** 每个 scope 的内部控制面（不走 public 属性，父 scope 级联用）。 */
interface AbortScopeControl {
  addChild(child: AbortScope): void;
  removeChild(child: AbortScope): void;
  attachParent(parent: AbortSignalView): void;
  readonly deadlineAt: number | null;
  readonly disposed: boolean;
  readonly reason: AbortReason | null;
}

const controls = new WeakMap<AbortScope, AbortScopeControl>();
const controllerScopes = new WeakMap<AbortController, AbortScope>();

const noop = (): void => {};

function isDevEnvironment(): boolean {
  const g = globalThis as { __DEV__?: boolean; process?: { env?: Record<string, string | undefined> } };
  if (g.__DEV__ === true) {
    return true;
  }
  return g.process?.env?.NODE_ENV !== "production";
}

function warnInconsistentOptions(fields: string[]): void {
  if (fields.length === 0 || !isDevEnvironment()) {
    return;
  }
  console.warn(`[abort] createAbortScope 命中 controller memoize：复用既有实例，后续 opts 不一致（${fields.join(", ")}）`);
}

/** `rejectWith` 自身的异常也要能落到 reject 上，不能让它把取消钩子打断。 */
function abortPayload(rejectWith?: () => unknown): unknown {
  if (rejectWith === undefined) {
    return createAbortError();
  }
  try {
    return rejectWith();
  } catch (error) {
    return error;
  }
}

/**
 * 平台协议例外：Promise 没有 Result 通道，取消只能 reject。
 *
 * 对 `work` 先挂旁路 `.catch(noop)`——abort 先 settle 时，`work` 之后的 reject
 * 不能变成 unhandledRejection；race 本身仍用原 promise。
 */
function raceWithCancel<T>(work: Promise<T>, isCancelled: () => boolean, subscribe: (fn: () => void) => () => void, rejectWith?: () => unknown): Promise<T> {
  void work.catch(noop);
  if (isCancelled()) {
    return Promise.reject(abortPayload(rejectWith));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let off = noop;
    off = subscribe(() => {
      if (settled) {
        return;
      }
      settled = true;
      off();
      reject(abortPayload(rejectWith));
    });
    work.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        off();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        off();
        reject(error);
      }
    );
  });
}

async function yieldToUiAfter(checkpoint: () => Interrupt | null): Promise<Interrupt | null> {
  const hit = checkpoint();
  if (hit != null) {
    return hit;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return null;
}

function deadlineOf(parent: AbortSignalView): number | null {
  const control = controls.get(parent as AbortScope);
  if (control !== undefined) {
    return control.disposed ? null : control.deadlineAt;
  }
  const value = (parent as { readonly deadlineAt?: number | null }).deadlineAt;
  return typeof value === "number" ? value : null;
}

function buildScope(opts: CreateAbortScopeOptions): AbortScope {
  const controller = opts.controller ?? new AbortController();
  const sourceSignal = opts.signal;
  const signal = controller.signal;

  let reason: AbortReason | null = null;
  let disposed = false;
  let deadlineAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removeControllerListener: (() => void) | null = null;
  let removeSourceListener: (() => void) | null = null;
  const listeners = new Set<(reason: AbortReason) => void>();
  const children = new Set<AbortScope>();
  const parentDetachers = new Set<() => void>();
  const attachedParents = new Set<AbortSignalView>();
  let scope: AbortScope;

  const abortInternal = (nextReason: AbortReason): void => {
    if (disposed || reason !== null) {
      return;
    }
    reason = nextReason;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    controller.abort();
    const snapshot = [...listeners];
    listeners.clear();
    for (const fn of snapshot) {
      try {
        fn(nextReason);
      } catch {
        // 单个清理钩子失败不阻断取消流程，也不影响其余钩子。
      }
    }
    for (const child of [...children]) {
      child.abort("parent");
    }
  };

  /** 外部 controller / 裸 signal 已 aborted 但事件没补发时，补一次协作中断。 */
  const reconcileSignal = (): void => {
    if (!disposed && reason === null && signal.aborted) {
      abortInternal("user-stop");
    }
  };

  /** 已判定未 aborted 的 signal 挂取消监听；返回解绑函数（controller / 裸 signal 共用同一形状）。 */
  const watchAbort = (target: AbortSignal): (() => void) => {
    const onAbort = (): void => {
      abortInternal("user-stop");
    };
    target.addEventListener("abort", onAbort);
    return () => {
      target.removeEventListener("abort", onAbort);
    };
  };

  const checkpoint = (): Interrupt | null => {
    if (disposed) {
      return null;
    }
    reconcileSignal();
    return reason === null ? null : { kind: "cancelled", reason };
  };

  const onCancel = (fn: (reason: AbortReason) => void): (() => void) => {
    if (disposed) {
      return noop;
    }
    reconcileSignal();
    if (reason !== null) {
      try {
        fn(reason);
      } catch {
        // 清理钩子失败不反向打断调用方。
      }
      return noop;
    }
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  const race = <T>(work: Promise<T>, rejectWith?: () => unknown): Promise<T> => {
    if (disposed) {
      return work;
    }
    return raceWithCancel(work, () => checkpoint() != null, (fn) => onCancel(fn), rejectWith);
  };

  const fork = (forkOpts?: { timeoutMs?: number }): AbortScope => {
    if (disposed) {
      const dead = buildScope({});
      dead.dispose();
      return dead;
    }
    const timeoutMs = forkOpts?.timeoutMs;
    return createAbortScope({ parent: scope, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    removeControllerListener?.();
    removeControllerListener = null;
    removeSourceListener?.();
    removeSourceListener = null;
    for (const detach of [...parentDetachers]) {
      detach();
    }
    parentDetachers.clear();
    attachedParents.clear();
    // 正常完成不是取消：不执行自身 onCancel，只释放引用。
    listeners.clear();
    const snapshot = [...children];
    children.clear();
    for (const child of snapshot) {
      child.abort("parent");
    }
  };

  scope = {
    signal,
    get reason() {
      return reason;
    },
    get deadlineAt() {
      return deadlineAt;
    },
    checkpoint,
    yieldToUi: () => yieldToUiAfter(checkpoint),
    race,
    onCancel,
    abort: (nextReason: AbortReason = "user-stop") => {
      abortInternal(nextReason);
    },
    fork,
    dispose,
  };

  controls.set(scope, {
    addChild(child) {
      if (disposed) {
        return;
      }
      children.add(child);
      if (reason !== null) {
        child.abort("parent");
      }
    },
    removeChild(child) {
      children.delete(child);
    },
    attachParent(parent) {
      if (disposed || attachedParents.has(parent)) {
        return;
      }
      attachedParents.add(parent);
      const parentControl = controls.get(parent as AbortScope);
      if (parentControl !== undefined) {
        parentControl.addChild(scope);
        parentDetachers.add(() => {
          parentControl.removeChild(scope);
        });
        return;
      }
      parentDetachers.add(parent.onCancel(() => abortInternal("parent")));
    },
    get deadlineAt() {
      return deadlineAt;
    },
    get disposed() {
      return disposed;
    },
    get reason() {
      return reason;
    },
  });

  if (controller.signal.aborted) {
    abortInternal("user-stop");
  } else {
    removeControllerListener = watchAbort(controller.signal);
  }

  if (sourceSignal !== undefined && sourceSignal !== controller.signal) {
    if (sourceSignal.aborted) {
      abortInternal("user-stop");
    } else {
      removeSourceListener = watchAbort(sourceSignal);
    }
  }

  if (opts.parent !== undefined) {
    controls.get(scope)?.attachParent(opts.parent);
  }

  const ownDeadlineAt = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : null;
  const parentDeadlineAt = opts.parent !== undefined ? deadlineOf(opts.parent) : null;
  deadlineAt = ownDeadlineAt !== null && parentDeadlineAt !== null ? Math.min(ownDeadlineAt, parentDeadlineAt) : ownDeadlineAt ?? parentDeadlineAt;
  if (reason === null && ownDeadlineAt !== null && (parentDeadlineAt === null || ownDeadlineAt <= parentDeadlineAt)) {
    timer = setTimeout(() => {
      abortInternal("timeout");
    }, Math.max(0, ownDeadlineAt - Date.now()));
  }

  return scope;
}

/** 后向 memoize 命中时：能补的 parent 级联补上，dev 下把不一致 opts 记一条 warn。 */
function reconcileExistingScope(scope: AbortScope, opts: CreateAbortScopeOptions): void {
  const fields: string[] = [];
  if (opts.parent !== undefined) {
    controls.get(scope)?.attachParent(opts.parent);
    fields.push("parent");
  }
  if (opts.timeoutMs !== undefined) {
    fields.push("timeoutMs");
  }
  if (opts.signal !== undefined) {
    fields.push("signal");
  }
  warnInconsistentOptions(fields);
}

/**
 * 创建可驱动 scope。
 *
 * 同一 `controller` 与 {@link scopeFromController} 共用 WeakMap：命中即返回既有
 * 实例（后续 `parent` 会补挂、`timeoutMs` 被忽略，dev 下 warn）。
 */
export function createAbortScope(opts: CreateAbortScopeOptions = {}): AbortScope {
  const controller = opts.controller;
  if (controller !== undefined) {
    const existing = controllerScopes.get(controller);
    if (existing !== undefined) {
      reconcileExistingScope(existing, opts);
      return existing;
    }
  }
  const scope = buildScope(opts);
  if (controller !== undefined) {
    controllerScopes.set(controller, scope);
  }
  return scope;
}

/** 按 controller memoize 取 scope；`abort()` 反向委托 `controller.abort()`。 */
export function scopeFromController(controller: AbortController): AbortScope {
  const existing = controllerScopes.get(controller);
  return existing ?? createAbortScope({ controller });
}

/** 裸 `AbortSignal` 只读适配：无定时器、无 dispose，reason 恒为 null。 */
export function signalView(signal: AbortSignal): AbortSignalView {
  const onCancel = (fn: (reason: AbortReason) => void): (() => void) => {
    if (signal.aborted) {
      try {
        fn("user-stop");
      } catch {
        // 清理钩子失败不反向打断调用方。
      }
      return noop;
    }
    const onAbort = (): void => {
      try {
        fn("user-stop");
      } catch {
        // 同上。
      }
    };
    signal.addEventListener("abort", onAbort);
    return () => {
      signal.removeEventListener("abort", onAbort);
    };
  };
  const checkpoint = (): Interrupt | null => (signal.aborted ? { kind: "cancelled", reason: "user-stop" } : null);
  return {
    signal,
    reason: null,
    checkpoint,
    yieldToUi: () => yieldToUiAfter(checkpoint),
    race: (work, rejectWith) => raceWithCancel(work, () => signal.aborted, onCancel, rejectWith),
    onCancel,
  };
}
