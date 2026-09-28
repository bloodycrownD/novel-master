/**
 * blob-binary-normalization.service（mobile）单测：ic-21 busy 守卫接入。
 *
 * - busy（数据清理/备份/云同步互斥）置位期间归一循环暂停：热身与多轮
 *   守卫重试过后 core 搬运入口零调用（零搬运）；复位后下一轮恢复。
 * - 对照：无 busy/无 Agent 时热身后正常进入 core 调用。
 * - source 契约：循环顶与 shouldPause 两处守卫均为
 *   `isMobileAgentActive() || isMobileDbMaintenanceBusy()` 组合（两个条件
 *   缺一不可），import 取自 ./db-maintenance-busy。
 *
 * 照 db-maintenance.service.test.ts 的全模块 mock 版式；busy 模块用真
 * 实现（计数/令牌配对），时间轴走 fake timers。
 */
import {readFileSync} from 'fs';
import {join} from 'path';
import {scheduleMobileBlobBinaryNormalization} from '@/services/blob-binary-normalization.service';
import {
  acquireMobileDbMaintenanceBusy,
  isMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from '@/services/db-maintenance-busy';

const mockRunNormalization = jest.fn();
const mockAgentActive = jest.fn();

jest.mock('@novel-master/core', () => ({
  runBlobBinaryNormalization: (...args: unknown[]) =>
    mockRunNormalization(...args),
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

/** core 归一一轮的结果（done 收工形态；service 只消费 done/stalled）。 */
const DONE_RESULT = {done: true, stalled: false};

const serviceSource = readFileSync(
  join(__dirname, '../src/services/blob-binary-normalization.service.ts'),
  'utf8',
);

describe('blob-binary-normalization.service busy 守卫（ic-21）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRunNormalization.mockReset().mockResolvedValue(DONE_RESULT);
    mockAgentActive.mockReset().mockReturnValue(false);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // busy 计数前置清零断言：上一用例泄漏计数会让本用例的对照组假红
    expect(isMobileDbMaintenanceBusy()).toBe(false);
  });

  afterEach(() => {
    // 兜底：用例内 acquire 未配对释放时在此清零，避免跨用例污染
    if (isMobileDbMaintenanceBusy()) {
      releaseMobileDbMaintenanceBusy();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('busy 置位期间归一循环暂停（零搬运），复位后恢复', async () => {
    // 每用例新 runtime：模块级登记键按对象身份去重，跨用例不互相挡
    const runtime = {conn: {tag: `live-${Date.now()}`}} as never;
    acquireMobileDbMaintenanceBusy();

    scheduleMobileBlobBinaryNormalization(runtime);
    // 过热身（3s）+ 多轮守卫重试（5s×3）：仍在 busy 窗口内，零搬运
    await jest.advanceTimersByTimeAsync(3_000 + 5_000 * 3);
    expect(mockRunNormalization).not.toHaveBeenCalled();

    releaseMobileDbMaintenanceBusy();
    // 下一轮守卫重试放行，core 搬运入口被触
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockRunNormalization).toHaveBeenCalledTimes(1);
  });

  it('传入 core 的 shouldPause 同样认 busy：置位即 true、复位即 false', async () => {
    const runtime = {conn: {tag: `live-pause-${Date.now()}`}} as never;
    let capturedShouldPause: (() => boolean) | undefined;
    mockRunNormalization.mockImplementation(async (_conn, options) => {
      capturedShouldPause = options?.shouldPause;
      return DONE_RESULT;
    });

    scheduleMobileBlobBinaryNormalization(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(capturedShouldPause).toBeInstanceOf(Function);

    acquireMobileDbMaintenanceBusy();
    expect(capturedShouldPause!()).toBe(true);
    releaseMobileDbMaintenanceBusy();
    expect(capturedShouldPause!()).toBe(false);
  });

  it('对照：无 busy 无 Agent 时热身后正常进入 core 调用', async () => {
    const runtime = {conn: {tag: `live-ctrl-${Date.now()}`}} as never;

    scheduleMobileBlobBinaryNormalization(runtime);
    await jest.advanceTimersByTimeAsync(3_000);

    expect(mockRunNormalization).toHaveBeenCalledTimes(1);
  });

  it('source 契约：守卫组合含 Agent + busy 双条件，且循环顶与 shouldPause 两处消费', () => {
    // 组合函数体含两条件（去掉空白后匹配）；「两处守卫」以组合函数的
    // 消费次数钉住（循环顶 if + shouldPause 传参），缺任一条件都会让
    // 「数据清理 VACUUM 期间逐行短事务抢连接」回归
    const normalized = serviceSource.replace(/\s+/g, '');
    expect(normalized).toContain(
      'functionmobileNormalizationBlocked():boolean{returnisMobileAgentActive()||isMobileDbMaintenanceBusy();}',
    );
    // 两处消费：循环顶 if 判定 + shouldPause 传参（裸函数引用）
    expect(normalized).toContain('if(mobileNormalizationBlocked()){');
    expect(normalized).toContain('shouldPause:mobileNormalizationBlocked,');
    expect(serviceSource).toMatch(/from '\.\/db-maintenance-busy'/);
  });
});
