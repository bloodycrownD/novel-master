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
import {DateTime} from '@novel-master/core/common';
import {ModalShell} from './ModalShell';
import {coreT} from '@/i18n/core';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
    visible: boolean;
    onClose: () => void;
    onConfirm: (from: Date, to: Date) => void;
    tokens: ThemeTokens;
};

/** 周一开头（中文月历惯例）。 */
const WEEKDAY_LABELS = [
    coreT({key: "ui.stats.weekday_mon"}),
    coreT({key: "ui.stats.weekday_tue"}),
    coreT({key: "ui.stats.weekday_wed"}),
    coreT({key: "ui.stats.weekday_thu"}),
    coreT({key: "ui.stats.weekday_fri"}),
    coreT({key: "ui.stats.weekday_sat"}),
    coreT({key: "ui.stats.weekday_sun"}),
];

/**
 * 压 primary 底的恒亮文字色：月历选中日数字与「确定」按钮文字都坐在
 * primary 色块上，明暗主题均取纯白。刻意不新增 token（仅此两处使用，
 * 其余取色仍走 useTheme tokens）。
 */
const TEXT_ON_PRIMARY = '#FFFFFF';

function monthLabel(year: number, month: number): string {
    return coreT({key: "ui.stats.month_label", params: {year: String(year), month: String(month + 1)}});
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
        onConfirm(DateTime.startOfDay(start), DateTime.startOfDay(end));
    };

    const dayCellState = (day: number): 'idle' | 'edge' | 'inRange' => {
        if (start == null) {
            return 'idle';
        }
        const date = new Date(viewYear, viewMonth, day);
        if (end != null) {
            if (DateTime.isSameDay(date, start) || DateTime.isSameDay(date, end)) {
                return 'edge';
            }
            if (date > start && date < end) {
                return 'inRange';
            }
            return 'idle';
        }
        return DateTime.isSameDay(date, start) ? 'edge' : 'idle';
    };

    const cells: Array<null | number> = [
        ...Array.from({length: leadingBlanks}, () => null),
        ...Array.from({length: daysInMonth}, (_, i) => i + 1),
    ];

    // 未选起点提示选起点；选了起点未选终点提示选终点；齐了显示区间
    let hintText: string;
    if (start == null) {
        hintText = coreT({key: "ui.stats.range_pick_start"});
    } else if (end == null) {
        hintText = coreT({key: "ui.stats.range_pick_end"});
    } else {
        hintText = `${coreT({key: "ui.stats.date_md", params: {month: String(start.getMonth() + 1), day: String(start.getDate())}})} — ${coreT({key: "ui.stats.date_md", params: {month: String(end.getMonth() + 1), day: String(end.getDate())}})}`;
    }

    return (
        <ModalShell
            visible={visible}
            onClose={onClose}
            variant="bottom"
            animationType="slide"
            panelStyle={styles.sheet}
        >
            <Text style={[styles.title, {color: tokens.text}]}>{coreT({key: "ui.stats.range_picker_title"})}</Text>
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
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>{hintText}</Text>
            <View style={styles.actionRow}>
                <Pressable
                    testID="month-range-clear"
                    onPress={() => {
                        setStart(undefined);
                        setEnd(undefined);
                    }}
                    style={[styles.actionBtn, {backgroundColor: tokens.bgSecondary}]}
                >
                    <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.clear"})}</Text>
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
                    <Text style={styles.confirmText}>{coreT({key: "ui.common.confirm"})}</Text>
                </Pressable>
            </View>
        </ModalShell>
    );
}

const styles = StyleSheet.create({
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
