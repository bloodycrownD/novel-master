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
import { AbortError } from "./create-abort-error.js";

/** `AbortScopeFactory.create` 入参；`controller` 优先于裸 `signal`（两者都给时都监听）。 */
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

/** abort 事件回调体：try/catch 包裹调 `fn("user-stop")`（清理钩子失败不反向打断调用方）。 */
const signalViewOnAbort = (fn: (reason: AbortReason) => void): void => {
  try {
    fn("user-stop");
  } catch {
    // 清理钩子失败不反向打断调用方。
  }
};

/** 裸 signal 订阅取消回调：已 aborted 直调 `fn("user-stop")`，否则挂 abort 监听（add/remove 同引用）并返回解绑函数。 */
const signalViewOnCancel = (signal: AbortSignal, fn: (reason: AbortReason) => void): (() => void) => {
  if (signal.aborted) {
    try {
      fn("user-stop");
    } catch {
      // 清理钩子失败不反向打断调用方。
    }
    return noop;
  }
  // nm-style: keep-closure — add/removeEventListener 必须同一 listener 引用（身份不变量），包装不可消除。
  const onAbort = (): void => {
    signalViewOnAbort(fn);
  };
  signal.addEventListener("abort", onAbort);
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
};

/** 裸 signal 视图的中断检查：已 aborted 即 user-stop 中断，否则 null。 */
const signalViewCheckpoint = (signal: AbortSignal): Interrupt | null => (signal.aborted ? { kind: "cancelled", reason: "user-stop" } : null);

export const AbortScopeFactory = {
  isDevEnvironment(): boolean {
    const g = globalThis as { __DEV__?: boolean; process?: { env?: Record<string, string | undefined> } };
    if (g.__DEV__ === true) {
      return true;
    }
    return g.process?.env?.NODE_ENV !== "production";
  },

  warnInconsistentOptions(fields: string[]): void {
    if (fields.length === 0 || !AbortScopeFactory.isDevEnvironment()) {
      return;
    }
    console.warn(`[abort] createAbortScope 命中 controller memoize：复用既有实例，后续 opts 不一致（${fields.join(", ")}）`);
  },

  /** `rejectWith` 自身的异常也要能落到 reject 上，不能让它把取消钩子打断。 */
  abortPayload(rejectWith?: () => unknown): unknown {
    if (rejectWith === undefined) {
      return AbortError.create();
    }
    try {
      return rejectWith();
    } catch (error) {
      return error;
    }
  },

  /**
   * 平台协议例外：Promise 没有 Result 通道，取消只能 reject。
   *
   * 对 `work` 先挂旁路 `.catch(noop)`——abort 先 settle 时，`work` 之后的 reject
   * 不能变成 unhandledRejection；race 本身仍用原 promise。
   */
  raceWithCancel<T>(work: Promise<T>, isCancelled: () => boolean, subscribe: (fn: () => void) => () => void, rejectWith?: () => unknown): Promise<T> {
    void work.catch(noop);
    if (isCancelled()) {
      return Promise.reject(AbortScopeFactory.abortPayload(rejectWith));
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
        reject(AbortScopeFactory.abortPayload(rejectWith));
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
  },

  async yieldToUiAfter(checkpoint: () => Interrupt | null): Promise<Interrupt | null> {
    const hit = checkpoint();
    if (hit != null) {
      return hit;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return null;
  },

  deadlineOf(parent: AbortSignalView): number | null {
    const control = controls.get(parent as AbortScope);
    if (control !== undefined) {
      return control.disposed ? null : control.deadlineAt;
    }
    const value = (parent as { readonly deadlineAt?: number | null }).deadlineAt;
    return typeof value === "number" ? value : null;
  },

  buildScope(opts: CreateAbortScopeOptions): AbortScope {
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

    // nm-style: keep-closure — buildScope 簇状态机核心：reason/timer/disposed/listeners/children 是单 scope 私有可变状态，参数化需发明 7 槽 holder 改写全簇引用，零复用收益。
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

    // nm-style: keep-closure — 同 buildScope 簇：读写 disposed/reason 并调 abortInternal（keep 簇核心），提不出去。
    /** 外部 controller / 裸 signal 已 aborted 但事件没补发时，补一次协作中断。 */
    const reconcileSignal = (): void => {
      if (!disposed && reason === null && signal.aborted) {
        abortInternal("user-stop");
      }
    };

    // nm-style: keep-closure — 同 buildScope 簇：捕获 abortInternal 且内嵌 onAbort，拆法须先拆外层而外层属 keep 簇。
    /** 已判定未 aborted 的 signal 挂取消监听；返回解绑函数（controller / 裸 signal 共用同一形状）。 */
    const watchAbort = (target: AbortSignal): (() => void) => {
      // nm-style: keep-closure — add/removeEventListener 必须同一 listener 引用（生命周期不变量）。
      const onAbort = (): void => {
        abortInternal("user-stop");
      };
      target.addEventListener("abort", onAbort);
      return () => {
        target.removeEventListener("abort", onAbort);
      };
    };

    // nm-style: keep-closure — buildScope 簇：scope 公开方法本体，读 disposed/reason 并调 reconcileSignal。
    const checkpoint = (): Interrupt | null => {
      if (disposed) {
        return null;
      }
      reconcileSignal();
      return reason === null ? null : { kind: "cancelled", reason };
    };

    // nm-style: keep-closure — buildScope 簇：scope 公开方法本体，写 listeners 集合、读 disposed/reason。
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

    // nm-style: keep-closure — buildScope 簇：组合 checkpoint/onCancel 的公开方法；Promise reject 属平台协议例外通道。
    const race = <T>(work: Promise<T>, rejectWith?: () => unknown): Promise<T> => {
      if (disposed) {
        return work;
      }
      return AbortScopeFactory.raceWithCancel(work, () => checkpoint() != null, (fn) => onCancel(fn), rejectWith);
    };

    // nm-style: keep-closure — buildScope 簇：捕获后赋值的自引用 scope 与 dispose，子 scope 创建绑定本实例。
    const fork = (forkOpts?: { timeoutMs?: number }): AbortScope => {
      if (disposed) {
        const dead = AbortScopeFactory.buildScope({});
        dead.dispose();
        return dead;
      }
      const timeoutMs = forkOpts?.timeoutMs;
      return AbortScopeFactory.create({ parent: scope, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    };

    // nm-style: keep-closure — buildScope 簇：重绑定 disposed/timer/两个 removeListener 四变量，全簇参数化成本最高；释放逻辑与实例状态生命周期等长。
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
      yieldToUi: () => AbortScopeFactory.yieldToUiAfter(checkpoint),
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
    const parentDeadlineAt = opts.parent !== undefined ? AbortScopeFactory.deadlineOf(opts.parent) : null;
    deadlineAt = ownDeadlineAt !== null && parentDeadlineAt !== null ? Math.min(ownDeadlineAt, parentDeadlineAt) : ownDeadlineAt ?? parentDeadlineAt;
    if (reason === null && ownDeadlineAt !== null && (parentDeadlineAt === null || ownDeadlineAt <= parentDeadlineAt)) {
      timer = setTimeout(() => {
        abortInternal("timeout");
      }, Math.max(0, ownDeadlineAt - Date.now()));
    }

    return scope;
  },

  /** 后向 memoize 命中时：能补的 parent 级联补上，dev 下把不一致 opts 记一条 warn。 */
  reconcileExistingScope(scope: AbortScope, opts: CreateAbortScopeOptions): void {
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
    AbortScopeFactory.warnInconsistentOptions(fields);
  },

  /**
   * 创建可驱动 scope。
   *
   * 同一 `controller` 与 {@link AbortScopeFactory.fromController} 共用 WeakMap：命中即返回既有
   * 实例（后续 `parent` 会补挂、`timeoutMs` 被忽略，dev 下 warn）。
   */
  create(opts: CreateAbortScopeOptions = {}): AbortScope {
    const controller = opts.controller;
    if (controller !== undefined) {
      const existing = controllerScopes.get(controller);
      if (existing !== undefined) {
        AbortScopeFactory.reconcileExistingScope(existing, opts);
        return existing;
      }
    }
    const scope = AbortScopeFactory.buildScope(opts);
    if (controller !== undefined) {
      controllerScopes.set(controller, scope);
    }
    return scope;
  },

  /** 按 controller memoize 取 scope；`abort()` 反向委托 `controller.abort()`。 */
  fromController(controller: AbortController): AbortScope {
    const existing = controllerScopes.get(controller);
    return existing ?? AbortScopeFactory.create({ controller });
  },

  /** 裸 `AbortSignal` 只读适配：无定时器、无 dispose，reason 恒为 null。 */
  signalView(signal: AbortSignal): AbortSignalView {
    // nm-style: keep-closure — AbortSignalView.onCancel 实现位：绑定本视图的 signal 参数，race 与属性位两处共用同一引用。
    const onCancel = (fn: (reason: AbortReason) => void): (() => void) => signalViewOnCancel(signal, fn);
    return {
      signal,
      reason: null,
      checkpoint: () => signalViewCheckpoint(signal),
      yieldToUi: () => AbortScopeFactory.yieldToUiAfter(() => signalViewCheckpoint(signal)),
      race: (work, rejectWith) => AbortScopeFactory.raceWithCancel(work, () => signal.aborted, onCancel, rejectWith),
      onCancel,
    };
  },
} as const;
