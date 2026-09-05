/**
 * token-usage/format 纯函数单测（screens/C-4 拆分补充）。
 * 覆盖：hitRate 分母边界、formatHitRate 空态、isCustomRangeValid
 * 上/下边界与跨年、toLocalDayKey 本地日键、速率与首字延迟的空态与数值分支。
 */
import {describe, expect, it} from '@jest/globals';
import {
  CUSTOM_RANGE_MAX_DAYS,
  SUMMARY_EMPTY_TEXT,
  formatFirstTokenMs,
  formatHitRate,
  formatTokensPerSecond,
  hitRate,
  isCustomRangeValid,
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
    it('同一天有效（含首尾 1 天）', () => {
      expect(
        isCustomRangeValid(new Date(2026, 0, 1), new Date(2026, 0, 1)),
      ).toBe(true);
    });

    it('恰好 366 天有效（含首尾）', () => {
      expect(
        isCustomRangeValid(new Date(2025, 0, 1), new Date(2025, 11, 31)),
      ).toBe(true);
    });

    it('367 天无效（超上限）', () => {
      expect(
        isCustomRangeValid(new Date(2025, 0, 1), new Date(2026, 0, 2)),
      ).toBe(false);
    });

    it('to 早于 from 无效（天数为负）', () => {
      expect(
        isCustomRangeValid(new Date(2026, 0, 10), new Date(2026, 0, 1)),
      ).toBe(false);
    });

    it('跨年区间按天数判定', () => {
      // 2025-12-01 → 2026-01-31 共 62 天，有效。
      expect(
        isCustomRangeValid(new Date(2025, 11, 1), new Date(2026, 0, 31)),
      ).toBe(true);
    });

    it('上限常量为 366', () => {
      expect(CUSTOM_RANGE_MAX_DAYS).toBe(366);
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
