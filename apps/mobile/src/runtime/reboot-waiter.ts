/**
 * 重建 waiter 槽的「代际归属」规则（纯函数，无 React / RN 依赖）。
 *
 * 背景（cr1-cloudsync P1-2）：`retryAndWait` 的挂起槽原先是单个全局 ref，
 * 既没有代号也没有归属判定，于是**已被 cleanup 标记 cancelled 的旧 effect**
 * 在 `if (cancelled)` 收尾处、或它的异步链抛错走 `.catch` 时，会把槽里那个
 * 属于**更新一代**的 waiter 给 reject 掉；新代随后跑到 resolve 时槽已空，
 * 成了 no-op —— 重建明明成功，调用方（云同步 pull）却收到失败。
 *
 * 规则（本文件是它的唯一真源，context 只是调用方）：
 *
 * 1. **代际一致才兑现**：waiter 带一个 `generation` 代号（= 登记时的
 *    bootToken 代次）；`settleRebootWaiter` 只有在槽内 waiter 的代号与调用
 *    方传入的代号一致时才兑现并清空槽，不一致一律 no-op。旧代 effect 因此
 *    碰不到新代的 waiter。
 * 2. **入口不覆盖**：槽已被占用时，新调用**复用**（挂到同一个 waiter 上）
 *    而不是覆盖——覆盖会让先到那个调用方的 promise 彻底失主，只能等超时
 *    兜底。因此 `armRebootWaiter` 返回 `joined` 时调用方**不得**推进代号
 *    （推进会把在途的那一代变成谁也兑现不了的孤儿代）。
 *
 * 抽成纯函数是为了让归属规则能被单测直接钉住：不覆盖 + 代际校验这两条
 * 在 provider 层要 fake timers + 渲染才验得了，纯函数层是「必须有牙」的
 * 那一层。
 *
 * @module runtime/reboot-waiter
 */

/** 单个调用方的兑现口（对应 `new Promise` 的 resolve / reject）。 */
export interface RebootSettler<T> {
  resolve: (rt: T) => void;
  reject: (err: unknown) => void;
}

/**
 * 一代重建的挂起槽内容。
 *
 * `settlers` 是数组而不是单个 resolve/reject：入口「复用」时后来的调用方
 * 挂到同一个 waiter 上，兑现时一起兑现，谁都不失主。
 */
export interface RebootWaiter<T> {
  /** 归属代号 = 登记时的 bootToken 代次。 */
  generation: number;
  /** 仍在等这一代兑现的调用方（复用时追加）。 */
  settlers: RebootSettler<T>[];
}

/**
 * 挂起槽本身。形状刻意与 `useRef` 返回值一致（`{current}`），这样 provider
 * 里可以直接 `useRef(createRebootWaiterSlot())`，测试里直接传字面量。
 */
export interface RebootWaiterSlot<T> {
  current: RebootWaiter<T> | null;
}

export function createRebootWaiterSlot<T>(): RebootWaiterSlot<T> {
  return {current: null};
}

/**
 * `armRebootWaiter` 的结果。
 *
 * - `armed`：槽原本是空的，已按 `generation` 登记 —— 调用方**必须**推进
 *   bootToken 代号（新一代 effect 才会来兑现）。
 * - `joined`：槽已被占用，本次调用挂到了既有 waiter 上 —— 调用方**不得**
 *   推进代号，否则在途的那一代会变成谁也兑现不了的孤儿代。
 */
export type ArmRebootWaiterOutcome = 'armed' | 'joined';

/**
 * 登记一个等待方。
 *
 * 槽已被占用时**一律复用**（追加到 `settlers`），永不覆盖、不改既有代号：
 * 覆盖会让先到那个调用方的 promise 失主。
 */
export function armRebootWaiter<T>(
  slot: RebootWaiterSlot<T>,
  generation: number,
  settler: RebootSettler<T>,
): ArmRebootWaiterOutcome {
  const existing = slot.current;
  if (existing != null) {
    existing.settlers.push(settler);
    return 'joined';
  }
  slot.current = {generation, settlers: [settler]};
  return 'armed';
}

/**
 * 把槽内 waiter 的归属代号改绑到新代号（**不**新建 waiter、**不**换 settlers）。
 *
 * 用于无参 {@link retry} 这类「只推进代号、不新增等待方」的路径：槽里正挂着
 * 一代等待方时，下一代 effect 会用新代号来兑现，若不改绑，等待方就与唯一
 * 能兑现它的那一代对不上代号，只能悬到超时——这是修复引入的新丢事件风险，
 * 必须堵死。改绑后新代号生效、旧代号作废，被取代的旧 effect 依旧碰不到它
 * （代际校验照旧成立）。
 *
 * 槽为空时返回 false（无等待方需要改绑）。
 */
export function rebindRebootWaiterGeneration<T>(
  slot: RebootWaiterSlot<T>,
  generation: number,
): boolean {
  const waiter = slot.current;
  if (waiter == null) {
    return false;
  }
  waiter.generation = generation;
  return true;
}

/**
 * 取出并清空槽内 waiter —— **仅当代号一致**。
 *
 * 代号不符（调用方是被取代的旧代）时返回 null 且**完全不动槽**，这是
 * 「旧代不得碰新代 waiter」这条规则的落点。
 */
export function claimRebootWaiter<T>(
  slot: RebootWaiterSlot<T>,
  generation: number,
): RebootWaiter<T> | null {
  const waiter = slot.current;
  if (waiter == null || waiter.generation !== generation) {
    return null;
  }
  slot.current = null;
  return waiter;
}

/** `settleRebootWaiter` 的兑现内容。 */
export type RebootOutcome<T> =
  | {kind: 'resolve'; runtime: T}
  | {kind: 'reject'; error: unknown};

/**
 * 按代号兑现挂起的等待方。
 *
 * 代号一致 → 清空槽并把该代所有等待方（复用时可能不止一个）一起兑现；
 * 代号不一致或槽已空 → 返回 false 且不动槽（被取代的旧代 effect 到这里
 * 就是安全的 no-op）。
 */
export function settleRebootWaiter<T>(
  slot: RebootWaiterSlot<T>,
  generation: number,
  outcome: RebootOutcome<T>,
): boolean {
  const waiter = claimRebootWaiter(slot, generation);
  if (waiter == null) {
    return false;
  }
  for (const settler of waiter.settlers) {
    if (outcome.kind === 'resolve') {
      settler.resolve(outcome.runtime);
    } else {
      settler.reject(outcome.error);
    }
  }
  return true;
}
