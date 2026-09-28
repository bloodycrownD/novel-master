/**
 * db-maintenance-busy（mobile）单测：ic-20 计数/令牌配对语义。
 *
 * - acquire/release 严格配对，`> 0` 即 busy；
 * - 多调用方嵌套（上层备份流程包住底层导出/导入）不互相提前清位：
 *   内层 release 后外层窗口内仍 busy；
 * - release 不降到负数（防御性钳制，不影响正常配对路径）。
 */
import {
  acquireMobileDbMaintenanceBusy,
  isMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from '@/services/db-maintenance-busy';

describe('db-maintenance-busy 计数配对（ic-20）', () => {
  afterEach(() => {
    // 用例内 acquire 未配对释放时兜底清零，避免跨用例污染
    while (isMobileDbMaintenanceBusy()) {
      releaseMobileDbMaintenanceBusy();
    }
  });

  it('初始态不 busy；acquire 后 busy，配对 release 后复位', () => {
    expect(isMobileDbMaintenanceBusy()).toBe(false);

    acquireMobileDbMaintenanceBusy();
    expect(isMobileDbMaintenanceBusy()).toBe(true);

    releaseMobileDbMaintenanceBusy();
    expect(isMobileDbMaintenanceBusy()).toBe(false);
  });

  it('嵌套 acquire（外层流程包底层函数）不互相提前清位', () => {
    acquireMobileDbMaintenanceBusy(); // 外层流程（如上层备份包装）
    acquireMobileDbMaintenanceBusy(); // 底层 exportDatabaseBackupToPath
    expect(isMobileDbMaintenanceBusy()).toBe(true);

    releaseMobileDbMaintenanceBusy(); // 底层先退出：外层窗口仍在
    expect(isMobileDbMaintenanceBusy()).toBe(true);

    releaseMobileDbMaintenanceBusy(); // 外层在 rebootstrap 完成后释放
    expect(isMobileDbMaintenanceBusy()).toBe(false);
  });

  it('release 多于 acquire 时不降到负语义（钳制 0，不影响后续配对）', () => {
    releaseMobileDbMaintenanceBusy();
    expect(isMobileDbMaintenanceBusy()).toBe(false);

    acquireMobileDbMaintenanceBusy();
    expect(isMobileDbMaintenanceBusy()).toBe(true);
    releaseMobileDbMaintenanceBusy();
    expect(isMobileDbMaintenanceBusy()).toBe(false);
  });
});
