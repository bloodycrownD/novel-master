/**
 * token-usage/format 纯函数单测（screens/C-4 拆分补充）。
 * 覆盖：hitRate 分母边界、formatHitRate 空态、isCustomRangeValid
 * 顺序校验（无跨度上限）、resolveRangeDays 各 RangeKind 映射、
 * toLocalDayKey 本地日键、速率与首字延迟的空态与数值分支。
 */
import {describe, expect, it} from '@jest/globals';
import {
  SUMMARY_EMPTY_TEXT,
  formatFirstTokenMs,
  formatHitRate,
  formatTokensPerSecond,
  hitRate,
  isCustomRangeValid,
  localDayKeyOffset,
  resolveRangeDays,
  toLocalDayKey,
} from '@/screens/stack/token-usage/format';

describe('token-usage/format', () => {
  describe('hitRate', () => {
    it('分母为 0 返回 null（无 cache 数据，展示空态而非 0）', () => {
      expect(hitRate(100, 0)).toBeNull();
    });

    it('分母为负返回 null', () => {
      expect(hitRate(100, -1)).toBeNull();
    });

    it('正常输入返回比值', () => {
      expect(hitRate(30, 100)).toBe(0.3);
      expect(hitRate(0, 100)).toBe(0);
    });
  });

  describe('formatHitRate', () => {
    it('null 显示横杠', () => {
      expect(formatHitRate(null)).toBe('—');
    });

    it('百分比取整', () => {
      expect(formatHitRate(0.256)).toBe('26%');
      expect(formatHitRate(1)).toBe('100%');
      expect(formatHitRate(0)).toBe('0%');
    });
  });

  describe('isCustomRangeValid', () => {
    it('同一天有效', () => {
      expect(
        isCustomRangeValid(new Date(2026, 0, 1), new Date(2026, 0, 1)),
      ).toBe(true);
    });

    it('十年区间也有效（跨度不设上限，T-M6）', () => {
      expect(
        isCustomRangeValid(new Date(2016, 0, 1), new Date(2026, 0, 1)),
      ).toBe(true);
    });

    it('to 早于 from 无效', () => {
      expect(
        isCustomRangeValid(new Date(2026, 0, 10), new Date(2026, 0, 1)),
      ).toBe(false);
    });
  });

  describe('resolveRangeDays（RangeKind → 自然日闭区间）', () => {
    it('today = {D, D}', () => {
      const now = new Date();
      expect(resolveRangeDays('today', null, null)).toEqual({
        fromDay: toLocalDayKey(now.getTime()),
        toDay: toLocalDayKey(now.getTime()),
      });
    });

    it('last7 = {D-6, D}、last30 = {D-29, D}（日历偏移，T-M2）', () => {
      const now = new Date();
      expect(resolveRangeDays('last7', null, null)).toEqual({
        fromDay: localDayKeyOffset(now, -6),
        toDay: toLocalDayKey(now.getTime()),
      });
      expect(resolveRangeDays('last30', null, null)).toEqual({
        fromDay: localDayKeyOffset(now, -29),
        toDay: toLocalDayKey(now.getTime()),
      });
    });

    it('custom 由选择器结果产日期字符串', () => {
      expect(
        resolveRangeDays('custom', new Date(2026, 2, 7), new Date(2026, 2, 8)),
      ).toEqual({fromDay: '2026-03-07', toDay: '2026-03-08'});
    });

    it('custom 未选定日期时兑底回退近 7 天（类型完备分支）', () => {
      const now = new Date();
      expect(resolveRangeDays('custom', null, null)).toEqual({
        fromDay: localDayKeyOffset(now, -6),
        toDay: toLocalDayKey(now.getTime()),
      });
    });
  });

  describe('toLocalDayKey', () => {
    it('本地日期补零为 yyyy-MM-dd', () => {
      expect(toLocalDayKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
      expect(toLocalDayKey(new Date(2026, 11, 31).getTime())).toBe(
        '2026-12-31',
      );
    });
  });

  describe('formatTokensPerSecond', () => {
    it('null 返回调用方空态文案', () => {
      expect(formatTokensPerSecond(null, SUMMARY_EMPTY_TEXT)).toBe('—');
    });

    it('小于 100 保留一位小数', () => {
      expect(formatTokensPerSecond(12.34, '—')).toBe('12.3 t/s');
    });

    it('大于等于 100 取整', () => {
      expect(formatTokensPerSecond(123.6, '—')).toBe('124 t/s');
    });
  });

  describe('formatFirstTokenMs', () => {
    it('null 返回调用方空态文案', () => {
      expect(formatFirstTokenMs(null, SUMMARY_EMPTY_TEXT)).toBe('—');
    });

    it('毫秒级取整展示', () => {
      expect(formatFirstTokenMs(850, '—')).toBe('850 ms');
    });

    it('秒级保留一位小数', () => {
      expect(formatFirstTokenMs(1850, '—')).toBe('1.9 s');
    });
  });
});
