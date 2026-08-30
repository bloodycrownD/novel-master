/**
 * 轻量自定义日期区间选择 sheet：单月翻页月历（纯 RN View/Text），两次点选
 * 确定起止日（自动按时间先后排序），确认后回调 `onConfirm(from, to)`
 * （均为所选日本地 0 点；含边界的 366 天上限校验由调用方负责）。
 *
 * 无输入框，不需要键盘避让。容器风格参照 ModelPickerModal（AppModal +
 * 底部 sheet）。
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppModal} from './AppModal';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (from: Date, to: Date) => void;
  tokens: ThemeTokens;
};

/** 周一开头（中文月历惯例）。 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 压 primary 底的恒亮文字色：月历选中日数字与「确定」按钮文字都坐在
 * primary 色块上，明暗主题均取纯白。刻意不新增 token（仅此两处使用，
 * 其余取色仍走 useTheme tokens）。
 */
const TEXT_ON_PRIMARY = '#FFFFFF';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

export function MonthRangePickerSheet({
  visible,
  onClose,
  onConfirm,
  tokens,
}: Props) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [start, setStart] = useState<Date | undefined>();
  const [end, setEnd] = useState<Date | undefined>();

  // 每次打开重置：视图回到当前月，清空已选区间（照 FetchModelsSheet 的
  // 「关闭再打开重置」惯例）。
  useEffect(() => {
    if (visible) {
      const current = new Date();
      setViewYear(current.getFullYear());
      setViewMonth(current.getMonth());
      setStart(undefined);
      setEnd(undefined);
    }
  }, [visible]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // 周一起始偏移：getDay() 周日 = 0。
  const leadingBlanks = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const pickDay = (day: number) => {
    const picked = new Date(viewYear, viewMonth, day);
    if (start == null || end != null) {
      // 开始新的一轮选择。
      setStart(picked);
      setEnd(undefined);
      return;
    }
    // 第二次点选：与第一次按时间先后排成区间。
    if (picked.getTime() < start.getTime()) {
      setEnd(start);
      setStart(picked);
    } else {
      setEnd(picked);
    }
  };

  const confirm = () => {
    if (start == null || end == null) {
      return;
    }
    onConfirm(startOfDay(start), startOfDay(end));
  };

  const dayCellState = (day: number): 'idle' | 'edge' | 'inRange' => {
    if (start == null) {
      return 'idle';
    }
    const date = new Date(viewYear, viewMonth, day);
    if (end != null) {
      if (sameDay(date, start) || sameDay(date, end)) {
        return 'edge';
      }
      if (date > start && date < end) {
        return 'inRange';
      }
      return 'idle';
    }
    return sameDay(date, start) ? 'edge' : 'idle';
  };

  const cells: Array<null | number> = [
    ...Array.from({length: leadingBlanks}, () => null),
    ...Array.from({length: daysInMonth}, (_, i) => i + 1),
  ];

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}
        >
          <Text style={[styles.title, {color: tokens.text}]}>选择日期区间</Text>
          <View style={styles.monthNav}>
            <Pressable
              testID="month-range-prev"
              onPress={goToPrevMonth}
              style={styles.monthBtn}
            >
              <Text style={{color: tokens.primary}}>‹</Text>
            </Pressable>
            <Text
              testID="month-range-label"
              style={[styles.monthTitle, {color: tokens.text}]}
            >
              {monthLabel(viewYear, viewMonth)}
            </Text>
            <Pressable
              testID="month-range-next"
              onPress={goToNextMonth}
              style={styles.monthBtn}
            >
              <Text style={{color: tokens.primary}}>›</Text>
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {WEEKDAY_LABELS.map(label => (
              <Text
                key={label}
                style={[styles.weekLabel, {color: tokens.textSecondary}]}
              >
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (day == null) {
                return <View key={`blank-${index}`} style={styles.dayCell} />;
              }
              const state = dayCellState(day);
              return (
                <Pressable
                  key={`day-${day}`}
                  testID={`month-range-day-${day}`}
                  onPress={() => pickDay(day)}
                  style={[
                    styles.dayCell,
                    state === 'edge' && {backgroundColor: tokens.primary},
                    state === 'inRange' && {
                      backgroundColor: tokens.selection,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      {
                        color: state === 'edge' ? TEXT_ON_PRIMARY : tokens.text,
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            {start == null
              ? '先选起始日，再选结束日'
              : end == null
              ? '已选起始日，请选择结束日'
              : `${start.getMonth() + 1} 月 ${start.getDate()} 日 — ${
                  end.getMonth() + 1
                } 月 ${end.getDate()} 日`}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              testID="month-range-clear"
              onPress={() => {
                setStart(undefined);
                setEnd(undefined);
              }}
              style={[styles.actionBtn, {backgroundColor: tokens.bgSecondary}]}
            >
              <Text style={{color: tokens.textSecondary}}>清除</Text>
            </Pressable>
            <Pressable
              testID="month-range-confirm"
              onPress={confirm}
              disabled={start == null || end == null}
              style={[
                styles.actionBtn,
                styles.confirmBtn,
                {backgroundColor: tokens.primary},
                (start == null || end == null) && {opacity: 0.4},
              ]}
            >
              <Text style={styles.confirmText}>确定</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dayText: {
    fontSize: 14,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmBtn: {},
  confirmText: {
    color: TEXT_ON_PRIMARY,
    fontWeight: '600',
  },
});
