/**
 * 重建 waiter 槽的代际归属规则单测（CR-F02 / cr1-cloudsync P1-2）。
 *
 * 覆盖 spec 要求的三条用例：旧代 reject 不影响新代 / 新代 resolve 正常 /
 * 入口复用不覆盖。纯函数层不需要 fake timers 与 provider 渲染。
 */

import {
  armRebootWaiter,
  claimRebootWaiter,
  createRebootWaiterSlot,
  rebindRebootWaiterGeneration,
  settleRebootWaiter,
  type RebootSettler,
  type RebootWaiterSlot,
} from '@/runtime/reboot-waiter';

interface FakeRuntime {
  readonly id: string;
}

/** 造一个可观测的等待方：resolve/reject 各自记录调用，便于断言「没被碰」。 */
function makeSettler(): RebootSettler<FakeRuntime> & {
  resolved: FakeRuntime[];
  rejected: unknown[];
} {
  const resolved: FakeRuntime[] = [];
  const rejected: unknown[] = [];
  return {
    resolved,
    rejected,
    resolve: rt => {
      resolved.push(rt);
    },
    reject: err => {
      rejected.push(err);
    },
  };
}

describe('reboot-waiter 代际归属规则', () => {
  let slot: RebootWaiterSlot<FakeRuntime>;

  beforeEach(() => {
    slot = createRebootWaiterSlot<FakeRuntime>();
  });

  it('新代 resolve 正常兑现，并清空槽', () => {
    const waiter = makeSettler();
    expect(armRebootWaiter(slot, 1, waiter)).toBe('armed');

    const rt = {id: 'rt-1'};
    expect(settleRebootWaiter(slot, 1, {kind: 'resolve', runtime: rt})).toBe(
      true,
    );
    expect(waiter.resolved).toEqual([rt]);
    expect(waiter.rejected).toEqual([]);
    expect(slot.current).toBeNull();
  });

  it('旧代 reject 不影响新代：槽内 waiter 不被兑现、也不被清空', () => {
    const newGen = makeSettler();
    expect(armRebootWaiter(slot, 2, newGen)).toBe('armed');

    // 被取代的旧代 effect 收尾/catch 时调用的 reject（cr1-cloudsync P1-2 的形状）
    const stale = new Error('重建 runtime 已取消，请重试');
    expect(settleRebootWaiter(slot, 1, {kind: 'reject', error: stale})).toBe(
      false,
    );
    expect(newGen.rejected).toEqual([]);
    expect(newGen.resolved).toEqual([]);
    expect(slot.current?.generation).toBe(2);

    // 新代随后 resolve 仍正常兑现（修复前这里已是 no-op）
    const rt = {id: 'rt-2'};
    expect(settleRebootWaiter(slot, 2, {kind: 'resolve', runtime: rt})).toBe(
      true,
    );
    expect(newGen.resolved).toEqual([rt]);
    expect(slot.current).toBeNull();
  });

  it('旧代 resolve 同样不得兑现新代 waiter（方向对称）', () => {
    const newGen = makeSettler();
    armRebootWaiter(slot, 5, newGen);

    const rt = {id: 'rt-stale'};
    expect(settleRebootWaiter(slot, 4, {kind: 'resolve', runtime: rt})).toBe(
      false,
    );
    expect(newGen.resolved).toEqual([]);
    expect(slot.current?.generation).toBe(5);
  });

  it('入口复用不覆盖：已有 waiter 时 joined，且既不改槽也不换代号', () => {
    const first = makeSettler();
    expect(armRebootWaiter(slot, 1, first)).toBe('armed');
    const firstWaiter = slot.current;

    const second = makeSettler();
    expect(armRebootWaiter(slot, 2, second)).toBe('joined');

    // 槽仍是第一次登记的那个对象（代号 1、settlers 长度 2）——没被覆盖
    expect(slot.current).toBe(firstWaiter);
    expect(slot.current?.generation).toBe(1);
    expect(slot.current?.settlers).toHaveLength(2);

    // 复用后由在途那一代兑现，两个调用方都拿到同一个 runtime，谁都不失主
    const rt = {id: 'rt-shared'};
    expect(settleRebootWaiter(slot, 1, {kind: 'resolve', runtime: rt})).toBe(
      true,
    );
    expect(first.resolved).toEqual([rt]);
    expect(second.resolved).toEqual([rt]);
    expect(slot.current).toBeNull();
  });

  it('复用方同代 reject 时也一起兑现（不会被单独丢下）', () => {
    const first = makeSettler();
    armRebootWaiter(slot, 7, first);
    const second = makeSettler();
    armRebootWaiter(slot, 8, second);

    const err = new Error('重建 runtime 超时，请重试');
    expect(settleRebootWaiter(slot, 7, {kind: 'reject', error: err})).toBe(
      true,
    );
    expect(first.rejected).toEqual([err]);
    expect(second.rejected).toEqual([err]);
  });

  it('槽为空时代号再对也不兑现（不凭空 resolve）', () => {
    const waiter = makeSettler();
    expect(settleRebootWaiter(slot, 0, {
      kind: 'resolve',
      runtime: {id: 'rt-x'},
    })).toBe(false);
    expect(claimRebootWaiter(slot, 0)).toBeNull();
    expect(waiter.resolved).toEqual([]);
  });

  it('兑现后槽被清空，同代号不能二次兑现', () => {
    const waiter = makeSettler();
    armRebootWaiter(slot, 3, waiter);
    expect(settleRebootWaiter(slot, 3, {
      kind: 'resolve',
      runtime: {id: 'rt-first'},
    })).toBe(true);
    expect(settleRebootWaiter(slot, 3, {
      kind: 'reject',
      error: new Error('too late'),
    })).toBe(false);
    expect(waiter.resolved).toHaveLength(1);
    expect(waiter.rejected).toEqual([]);
  });

  // 无参 retry 只推进代号、不新增等待方。改绑是防止「修复引入新的丢事件」：
  // 若不改绑，新一代 effect 兑现时代号对不上，等待方只能悬到超时。
  describe('rebindRebootWaiterGeneration', () => {
    it('把等待方改绑到新代号后，新一代能兑现、旧代号不能', () => {
      const waiter = makeSettler();
      armRebootWaiter(slot, 1, waiter);

      expect(rebindRebootWaiterGeneration(slot, 2)).toBe(true);
      expect(slot.current?.generation).toBe(2);

      // 旧代号已作废：被取代的那一代碰不到它
      expect(
        settleRebootWaiter(slot, 1, {
          kind: 'reject',
          error: new Error('stale'),
        }),
      ).toBe(false);
      expect(waiter.rejected).toEqual([]);

      // 新代号正常兑现
      const rt = {id: 'rt-rebound'};
      expect(settleRebootWaiter(slot, 2, {kind: 'resolve', runtime: rt})).toBe(
        true,
      );
      expect(waiter.resolved).toEqual([rt]);
    });

    it('改绑不换等待方：settlers 与槽对象身份都不变', () => {
      const first = makeSettler();
      armRebootWaiter(slot, 1, first);
      const before = slot.current;
      armRebootWaiter(slot, 1, makeSettler());

      rebindRebootWaiterGeneration(slot, 9);
      expect(slot.current).toBe(before);
      expect(slot.current?.settlers).toHaveLength(2);
    });

    it('槽为空时改绑返回 false，不凭空造等待方', () => {
      expect(rebindRebootWaiterGeneration(slot, 4)).toBe(false);
      expect(slot.current).toBeNull();
    });
  });
});
